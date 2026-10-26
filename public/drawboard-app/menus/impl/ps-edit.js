/* 堤麟画板 · Photoshop ▸ 编辑 菜单的实作（照 PhotoCraft 原码逐段翻成 JS）
   对照源（photocraft/crates/…，各段注释再标 档:行）：
     engine/src/edit_cmds.rs          剪切／拷贝／合并拷贝／粘贴／原位粘贴（lift 40-65、copy 73-89、clear_area 100-111、paste 115-140）、
                                      切换最终状态 324-328、再次变换 331-367、规格 402-445
     engine/src/commands.rs:279-288   清除 edit.clear；color_param 127-145；blend_from_str 152-156
     engine/src/extra_cmds.rs         描边 stroke 115-152、变换预设（旋转 180／90、翻转）261-280、贴入／外部粘贴 297-329、规格 548-583
     engine/src/fill_cmds.rs          填充 edit.fill 全档（contents／mode／opacity／preserveTransparency、content_aware 166-203、blend_tile 283-341）
     engine/src/edit_menu_cmds.rs     渐隐 fade 131-218、清理 purge 220-284、内容识别填充 286-425、定义画笔预设 495-504、查找和替换文本 556-709
     engine/src/transform_cmds.rs     edit.transform（transform_bounds 23-34、transform_layer 163-242、split_selected 245-269、
                                      composite_over 285-305、transform 320-399）
     engine/src/pattern_cmds.rs       内建图案 builtin 33-95、resolve 115-126、定义图案 define 186-232、placement 295-302
     engine/src/brush_cmds.rs:512-560 定义画笔预设（从选区取灰阶笔尖：暗度×不透明度×选区）
     engine/src/prefs.rs              首选项各区段栏位与预设值 156-511、prefs.get/set/reset 1318-1368、edit.preferences.<区段> 1370-1376
     algo/src/content_aware.rs        内容识别填充（取样、旋转／缩放／镜像变体拼贴、颜色适应 adapt_colors）
     algo/src/inpaint.rs:27-474       complete：多尺度 EM＋PatchMatch 补洞
     algo/src/poisson.rs:21-230       membrane_fill：级联多重网格＋SOR 的膜插值
     algo/src/selection.rs:540-622    欧氏距离变换 edt、expand／contract（描边的带子）
     algo/src/transform.rs:17-269     Homography、rect_to_quad、warp_surface（反向映射；最近／双线性／Catmull-Rom 双三次）
     compose/src/pattern.rs:78-194    图案平铺：Tile.sample（预乘、环绕双线性）、Placement.map、render
     color/src/blend.rs:151-342       27 种混合模式、composite（W3C 通式）
     color/src/lib.rs:16-22           dither_noise（溶解）
     ui-egui/src/fill_ui.rs           填充对话框栏位与「记住上次的选择」
     ui-egui/src/palette.rs           搜索（⌘K 命令面板）fuzzy_score 与列表
     ui-egui/src/menus.rs:286-384     菜单进入点：没参数＝开对话框／进交互框；有参数＝直接跑引擎命令
     ui-egui/src/prefs_ui.rs:414-470  编辑菜单各对话框的路由
   🔴 改文件的事全走 CMD；坐标一律是文件坐标，像素层改之前先换成图层坐标（铁律④）。
   命令命名：ps.<原码 id>；会进历史的引擎命令另有 <id>.dialog 给菜单开对话框（开对话框本身不留历史步）；
   不进历史的命令（首选项、定义图案…）用参数 {dialog:true} 开对话框。 */
(function(){
'use strict';
if (window.PsEdit) return;                 // index.html 与 menus/ps-edit.js 的自挂可能各载一次：只认第一次
const PE = window.PsEdit = {};

/* ═══════════ 小工具 ═══════════ */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const c01 = v => clamp(v, 0, 1);
const isNum = v => typeof v === 'number' && isFinite(v);
const fail = msg => ({ok:false, error:msg});
const T = k => Lang.t(k);

/* commands.rs:137 parse_hex（另收 #rgb） */
function parseHex(s){
  if (typeof s !== 'string') return null;
  let h = s.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  const b = i => parseInt(h.slice(i, i + 2), 16) / 255;
  return [b(0), b(2), b(4), h.length === 8 ? b(6) : 1];
}
/* commands.rs:127 color_param："#rrggbb" 或 [r,g,b,a]（0..1） */
function colorParam(p, k, dflt){
  const v = p[k];
  if (Array.isArray(v) && v.length >= 3){ const n = v.map(x => Number(x) || 0); return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1]; }
  if (typeof v === 'string') return parseHex(v) || dflt.slice();
  return dflt.slice();
}
const hexOf = c => '#' + c.slice(0, 3).map(v => Math.round(c01(v) * 255).toString(16).padStart(2, '0')).join('');
/* 前景色／背景色＝左工具栏两个色块（toolbar.js：前景＝#fillColor、背景＝#strokeColor） */
function fgColor(){ const el = document.getElementById('fillColor'); return parseHex(el ? el.value : '#000000') || [0, 0, 0, 1]; }
function bgColor(){ const el = document.getElementById('strokeColor'); return parseHex(el ? el.value : '#ffffff') || [1, 1, 1, 1]; }

/* 矩形一律 [x0,y0,x1,y1]（文件坐标） */
const Rc = {
  inter(a, b){ if (!a || !b) return null; const r = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]; return (r[2] > r[0] && r[3] > r[1]) ? r : null; },
  union(a, b){ return !a ? (b ? b.slice() : null) : !b ? a.slice() : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; },
  w: r => r[2] - r[0], h: r => r[3] - r[1],
  inflate: (r, d) => [r[0] - d, r[1] - d, r[2] + d, r[3] + d],
  eq: (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3],
};
const docRect = () => [0, 0, Doc.width, Doc.height];
/* 选区的外框（selection.content_bounds）；没选区回 null */
function selRect(){
  const s = Doc.sel; if (!s) return null;
  const r = [Math.floor(Math.min(s.x, s.x + s.w)), Math.floor(Math.min(s.y, s.y + s.h)), Math.ceil(Math.max(s.x, s.x + s.w)), Math.ceil(Math.max(s.y, s.y + s.h))];
  return (r[2] > r[0] && r[3] > r[1]) ? r : null;
}
/* 选区覆盖度：文件大小的 8 位阵列（tools/marquee.js 的 SelMask）；没选区回 null */
function selBytes(){ return (Doc.sel && window.SelMask) ? SelMask.bytes() : null; }

function layerOf(p){ return (p && p.layerId) ? Doc.byId(p.layerId) : Doc.active(); }
function pixelLayer(p){
  const L = layerOf(p);
  if (!L) return {error:'no active layer'};
  if (L.kind !== 'raster') return {error:`active layer is a ${L.kind} layer, not a pixel layer`};
  return {L};
}
/* 背景层（extra_cmds.rs:45 is_background）：图层菜单（menus/impl/ps-layer.js）有就用它的判法；没有＝最底一层叫「背景」的像素层，或 L.isBackground */
function isBg(L){
  if (window.PsLayer && PsLayer.isBackground) return PsLayer.isBackground(L);
  if (!L || Doc.layers[0] !== L || L.kind !== 'raster') return false;
  if (L.isBackground !== undefined) return !!L.isBackground;
  return ['背景', 'Background', T('layer.bg')].includes(L.name);
}
/* 锁定（L.locks，图层菜单加的栏位）：锁像素／全锁就不能改像素（edit_menu_cmds.rs:123 writable_surface） */
function lockedMsg(L){ const k = L && L.locks; return k && (k.all || k.pixels) ? `Could not complete your request because the layer "${L.name}" is locked` : null; }
const alphaLocked = L => !!((L.locks && L.locks.transparency) || isBg(L));      // 背景层不能有透明（锁透明度）
/* 要改像素的命令共用：像素层＋没锁 */
function editablePixels(p){ const pl = pixelLayer(p); if (pl.error) return pl; const m = lockedMsg(pl.L); return m ? {error:m} : pl; }
/* doc/src/lib.rs:824 next_layer_name：「底名 n」取最小没用过的 n */
function nextLayerName(base){
  const names = new Set(Doc.layers.map(L => L.name));
  for (let n = 1; n <= names.size + 1; n++){ const s = `${base} ${n}`; if (!names.has(s)) return s; }
  return base;
}
const canvasRect = L => [L.x, L.y, L.x + L.data.canvas.width, L.y + L.data.canvas.height];

/* 读画布 cv（原点在文件坐标 ox,oy）在文件区域 r 的像素（straight RGBA 0..255）；画布外读成透明 */
function readCanvas(cv, ox, oy, r){
  const w = Rc.w(r), h = Rc.h(r), out = new Uint8ClampedArray(w * h * 4);
  const lr = Rc.inter(r, [ox, oy, ox + cv.width, oy + cv.height]);
  if (!lr) return out;
  const lw = Rc.w(lr);
  const d = cv.getContext('2d', {willReadFrequently:true}).getImageData(lr[0] - ox, lr[1] - oy, lw, Rc.h(lr)).data;
  for (let y = lr[1]; y < lr[3]; y++){
    const so = (y - lr[1]) * lw * 4;
    out.set(d.subarray(so, so + lw * 4), ((y - r[1]) * w + (lr[0] - r[0])) * 4);
  }
  return out;
}
const readLayer = (L, r) => readCanvas(L.data.canvas, L.x, L.y, r);
/* 让像素层的画布盖住文件区域 r：PhotoCraft 的层没有边界，我们的像素层是一张画布——要写到画布外就把画布长大、图层原点跟着挪 */
function ensureCovers(L, r){
  if (window.LayerBox && LayerBox.growable(L)){ LayerBox.ensureCovers(L, r); return; }   // 统一入口（连跟着图层走的蒙版一起长·engine.js LayerBox）
  const cur = canvasRect(L), u = Rc.union(cur, r);
  if (Rc.eq(u, cur)) return;
  const c = document.createElement('canvas'); c.width = Rc.w(u); c.height = Rc.h(u);
  const x = c.getContext('2d', {willReadFrequently:true});
  x.drawImage(L.data.canvas, cur[0] - u[0], cur[1] - u[1]);
  L.data.canvas = c; L.data.ctx = x; L.x = u[0]; L.y = u[1];
}
function writeLayer(L, r, px){
  ensureCovers(L, r);
  L.data.ctx.putImageData(new ImageData(px, Rc.w(r), Rc.h(r)), r[0] - L.x, r[1] - L.y);
  Layer.invalidate(L);
}
/* 像素阵列里 alpha>0 的外框（Surface::content_bounds；prune 后的范围） */
function alphaBounds(px, r){
  const w = Rc.w(r), h = Rc.h(r);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3]){
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y;
  }
  return x1 < 0 ? null : [r[0] + x0, r[1] + y0, r[0] + x1 + 1, r[1] + y1 + 1];
}
function cropPx(px, r, c){
  const w = Rc.w(r), cw = Rc.w(c), out = new Uint8ClampedArray(cw * Rc.h(c) * 4);
  for (let y = c[1]; y < c[3]; y++){ const so = ((y - r[1]) * w + (c[0] - r[0])) * 4; out.set(px.subarray(so, so + cw * 4), (y - c[1]) * cw * 4); }
  return out;
}
/* 一层「有内容」的外框（文件坐标）：像素层量画布 alpha，矢量／文字层量渲染结果（move.js layerRect 同一套） */
function contentRect(L){
  if (L.kind === 'raster'){ const r = canvasRect(L); return alphaBounds(readLayer(L, r), r); }
  const cv = renderLayer(L, 1), r = [0, 0, cv.width, cv.height];
  return alphaBounds(cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, r);
}

/* ═══════════ 混合模式（color/src/blend.rs 151-342 原样翻译） ═══════════ */
const MODES = ['normal', 'dissolve', 'darken', 'multiply', 'colorBurn', 'linearBurn', 'darkerColor', 'lighten', 'screen', 'colorDodge',
  'linearDodge', 'lighterColor', 'overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix',
  'difference', 'exclusion', 'subtract', 'divide', 'hue', 'saturation', 'color', 'luminosity'];
const MODE_EN = {normal:'Normal', dissolve:'Dissolve', darken:'Darken', multiply:'Multiply', colorBurn:'Color Burn', linearBurn:'Linear Burn',
  darkerColor:'Darker Color', lighten:'Lighten', screen:'Screen', colorDodge:'Color Dodge', linearDodge:'Linear Dodge (Add)',
  lighterColor:'Lighter Color', overlay:'Overlay', softLight:'Soft Light', hardLight:'Hard Light', vividLight:'Vivid Light',
  linearLight:'Linear Light', pinLight:'Pin Light', hardMix:'Hard Mix', difference:'Difference', exclusion:'Exclusion',
  subtract:'Subtract', divide:'Divide', hue:'Hue', saturation:'Saturation', color:'Color', luminosity:'Luminosity'};
/* commands.rs:152 blend_from_str：去空白／底线／连字号／括号、不分大小写，比 label 或变体名 */
function modeFrom(s){
  const norm = x => String(x).toLowerCase().replace(/[ _\-()]/g, '');
  const want = norm(s);
  if (want === 'passthrough') return 'passThrough';
  return MODES.find(m => norm(m) === want || norm(MODE_EN[m]) === want) || null;
}
function colorBurn(cb, cs){ return cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min((1 - cb) / cs, 1); }
function colorDodge(cb, cs){ return cb <= 0 ? 0 : cs >= 1 ? 1 : Math.min(cb / (1 - cs), 1); }
function hardLight(cb, cs){ if (cs <= 0.5) return cb * 2 * cs; const s = 2 * cs - 1; return cb + s - cb * s; }
function softLightPs(cb, cs){ return cs <= 0.5 ? 2 * cb * cs + cb * cb * (1 - 2 * cs) : 2 * cb * (1 - cs) + Math.sqrt(Math.max(cb, 0)) * (2 * cs - 1); }
function blendChannel(m, cb, cs){
  switch (m){
    case 'darken': return Math.min(cb, cs);
    case 'multiply': return cb * cs;
    case 'colorBurn': return colorBurn(cb, cs);
    case 'linearBurn': return Math.max(cb + cs - 1, 0);
    case 'lighten': return Math.max(cb, cs);
    case 'screen': return cb + cs - cb * cs;
    case 'colorDodge': return colorDodge(cb, cs);
    case 'linearDodge': return Math.min(cb + cs, 1);
    case 'overlay': return hardLight(cs, cb);
    case 'softLight': return softLightPs(cb, cs);
    case 'hardLight': return hardLight(cb, cs);
    case 'vividLight': return cs <= 0.5 ? colorBurn(cb, 2 * cs) : colorDodge(cb, 2 * (cs - 0.5));
    case 'linearLight': return c01(cb + 2 * cs - 1);
    case 'pinLight': return cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * cs - 1);
    case 'hardMix': return cb + cs >= 1 - 1e-6 ? 1 : 0;
    case 'difference': return Math.abs(cb - cs);
    case 'exclusion': return cb + cs - 2 * cb * cs;
    case 'subtract': return Math.max(cb - cs, 0);
    case 'divide': return cs <= 0 ? (cb <= 0 ? 0 : 1) : Math.min(cb / cs, 1);
    default: return cs;                       // normal／dissolve／非分离模式（由 blendRgb 处理）
  }
}
const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c){
  const l = lum(c), n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]);
  let out = c.slice();
  if (n < 0){ const d = l - n; out = out.map(v => Math.abs(d) < 1e-12 ? l : l + (v - l) * l / d); }
  if (x > 1){ const d = x - l; out = out.map(v => Math.abs(d) < 1e-12 ? l : l + (v - l) * (1 - l) / d); }
  return out;
}
const setLum = (c, l) => { const d = l - lum(c); return clipColor([c[0] + d, c[1] + d, c[2] + d]); };
const sat = c => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
function setSat(c, s){
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [imin, imid, imax] = idx, out = [0, 0, 0];
  if (c[imax] > c[imin]){ out[imid] = (c[imid] - c[imin]) * s / (c[imax] - c[imin]); out[imax] = s; }
  out[imin] = 0;
  return out;
}
function blendRgb(m, cb, cs){
  switch (m){
    case 'hue': return setLum(setSat(cs, sat(cb)), lum(cb));
    case 'saturation': return setLum(setSat(cb, sat(cs)), lum(cb));
    case 'color': return setLum(cs, lum(cb));
    case 'luminosity': return setLum(cb, lum(cs));
    case 'darkerColor': return lum(cs) < lum(cb) ? cs : cb;
    case 'lighterColor': return lum(cs) > lum(cb) ? cs : cb;
    default: return [blendChannel(m, cb[0], cs[0]), blendChannel(m, cb[1], cs[1]), blendChannel(m, cb[2], cs[2])];
  }
}
/* blend.rs:322 composite：straight 来、straight 去；αo = αs + αb(1−αs)，αo·Co = (1−αs)αb·Cb + (1−αb)αs·Cs + αsαb·B(Cb,Cs) */
function composite4(m, d, s, opacity){
  const ab = d[3], as = s[3] * opacity;
  if (as <= 0) return d.slice();
  const cb = [d[0], d[1], d[2]], cs = [s[0], s[1], s[2]], b = blendRgb(m, cb, cs);
  const ao = as + ab * (1 - as);
  if (ao <= 0) return [0, 0, 0, 0];
  const o = [0, 0, 0, ao];
  for (let i = 0; i < 3; i++) o[i] = ((1 - as) * ab * cb[i] + (1 - ab) * as * cs[i] + as * ab * b[i]) / ao;
  return o;
}
/* fill_cmds.rs:217 lerp：预乘空间里 d 往 c 走 k（History 的「还原」用，连透明度一起换） */
function lerpPremul(d, c, k){
  const a = d[3] * (1 - k) + c[3] * k;
  if (a <= 0) return [0, 0, 0, 0];
  const ch = i => (d[i] * d[3] * (1 - k) + c[i] * c[3] * k) / a;
  return [ch(0), ch(1), ch(2), a];
}
/* color/src/lib.rs:16 dither_noise（u32 乘法溢出用 Math.imul） */
function ditherNoise(x, y){
  let h = (Math.imul(x | 0, 0x9E3779B1) ^ Math.imul(y | 0, 0x85EBCA77)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 0x2C1B3C6D) >>> 0; h = (h ^ (h >>> 12)) >>> 0;
  return (h & 0xFFFF) / 65535;
}

/* ═══════════ 剪贴板（edit_cmds.rs Clip：像素＋原来的位置） ═══════════ */
let Clip = null;              // {px:Uint8ClampedArray, bounds:[x0,y0,x1,y1]}
/* edit_cmds.rs:41 lift：选区内（或整层内容）的像素，alpha 乘上选区覆盖度，再裁到有内容的范围 */
function lift(srcPx, srcR, cov){
  const canvas = docRect();
  const area = Rc.inter(cov ? selRect() : (alphaBounds(srcPx, srcR) || null), canvas);
  if (!area) return null;
  const w = Rc.w(area), px = cropPx(srcPx, srcR, area), DW = Doc.width;
  if (cov) for (let y = area[1]; y < area[3]; y++) for (let x = area[0]; x < area[2]; x++){
    const i = ((y - area[1]) * w + (x - area[0])) * 4 + 3;
    px[i] = Math.round(px[i] * cov[y * DW + x] / 255);
  }
  const b = alphaBounds(px, area);
  return b ? {px: cropPx(px, area, b), bounds: b} : null;
}
/* edit_cmds.rs:73 copy */
function copyImpl(merged){
  let clip;
  const cov = selBytes();
  if (merged){
    const c = composite(1), r = docRect();
    clip = lift(c.getContext('2d').getImageData(0, 0, r[2], r[3]).data, r, cov);
  } else {
    const pl = pixelLayer({}); if (pl.error) return fail(pl.error);
    const r = canvasRect(pl.L);
    clip = lift(readLayer(pl.L, r), r, cov);
  }
  if (!clip) return fail('Could not copy: the selected area is empty');
  Clip = clip;
  const b = clip.bounds;
  return {ok:true, bounds:[b[0], b[1], b[2] - b[0], b[3] - b[1]]};
}
/* edit_cmds.rs:100 clear_area → pixels.rs:65 clear_surface：alpha ×(1−覆盖度)，清光的像素归零 */
function clearSelected(L){
  const cov = selBytes();
  const bg = isBg(L), bgc = bgColor();
  const area = bg ? Rc.inter(selRect() || docRect(), docRect()) : Rc.inter(Rc.inter(selRect() || docRect(), docRect()), canvasRect(L));
  if (!area) return;
  const px = readLayer(L, area), w = Rc.w(area), DW = Doc.width;
  for (let y = area[1]; y < area[3]; y++) for (let x = area[0]; x < area[2]; x++){
    const i = ((y - area[1]) * w + (x - area[0])) * 4;
    const k = cov ? cov[y * DW + x] / 255 : 1;
    if (k <= 0) continue;
    if (bg){                                   // 背景层不能透明：照覆盖度盖上背景色（pixels.rs fill_surface，锁透明度）
      for (let c = 0; c < 3; c++) px[i + c] = (bgc[c] * k + px[i + c] / 255 * (1 - k)) * 255;
      continue;
    }
    const a = px[i + 3] * (1 - k);
    if (a <= 0.5){ px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0; } else px[i + 3] = a;
  }
  writeLayer(L, area, px);
}
/* edit_cmds.rs:115 paste：in_place 保留原位；否则贴到 center（缺省画布中心）——但没给 center 且原位置整个在画布内时也原位 */
function pasteImpl(p, inPlace){
  if (!Clip) return fail('the clipboard is empty');
  const canvas = docRect(), b = Clip.bounds;
  let dx = 0, dy = 0;
  const center = Array.isArray(p.center) && p.center.length >= 2 ? [Number(p.center[0]) || 0, Number(p.center[1]) || 0] : null;
  const inside = Rc.eq(Rc.inter(b, canvas), b);
  if (!(inPlace || (inside && !center))){
    const c = center || [(canvas[0] + canvas[2]) / 2, (canvas[1] + canvas[3]) / 2];
    dx = Math.round(c[0] - (b[0] + b[2]) / 2); dy = Math.round(c[1] - (b[1] + b[3]) / 2);
  }
  const L = Layer.raster(nextLayerName(T('layer.untitled')));
  const r = [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
  writeLayer(L, r, new Uint8ClampedArray(Clip.px));
  const above = Doc.activeId ? Doc.index(Doc.activeId) + 1 : Doc.layers.length;
  Doc.add(L, above);
  Doc.sel = null;
  return {ok:true, layer:L.id, offset:[dx, dy]};
}
/* extra_cmds.rs:297 paste_into：贴到选区中心、加一张「只露选区」（外部粘贴＝反过来）的图层蒙版。
   蒙版要历史快照存得住（engine.js History._extraProps，或图层菜单的垫片 _psLayerShim）才挂真的蒙版；
   存不住就退一步：把蒙版直接乘进新层的 alpha（看起来一样、可以复原，但事后不能再改蒙版） */
function pasteIntoImpl(p, outside){
  const s = Doc.sel; if (!s) return fail('Paste Into needs a selection');
  if (!Clip) return fail('the clipboard is empty');
  const cov = new Uint8Array(selBytes());          // 贴上会清掉选区，先抄一份
  const b = selRect();
  const q = Object.assign({center:[(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]}, p.center ? {center:p.center} : {});
  const r = pasteImpl(q, false); if (r.ok === false) return r;
  const L = Doc.byId(r.layer);
  const masks = (History._extraProps || History._psLayerShim) && L.x === 0 && L.y === 0 && L.data.canvas.width === Doc.width && L.data.canvas.height === Doc.height;
  if (masks){
    // 蒙版＝跟图层一样大的灰阶（白＋alpha＝露出多少；composite 用 destination-in 套），跟图层菜单同一格式
    const W = Doc.width, H = Doc.height, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', {willReadFrequently:true}), img = x.createImageData(W, H), d = img.data;
    for (let i = 0; i < W * H; i++){ d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = outside ? 255 - cov[i] : cov[i]; }
    x.putImageData(img, 0, 0);
    L.mask = {id:'M' + L.id, kind:'raster', name:'mask', visible:true, opacity:1, blend:'normal', mask:null, x:0, y:0, _cache:null, _cacheScale:0, data:{canvas:c, ctx:x}};
    delete L.maskOff;
    r.mask = true;
    return r;
  }
  const area = Rc.inter(canvasRect(L), docRect());
  if (area){
    const px = readLayer(L, area), w = Rc.w(area), DW = Doc.width;
    for (let y = area[1]; y < area[3]; y++) for (let x = area[0]; x < area[2]; x++){
      const i = ((y - area[1]) * w + (x - area[0])) * 4 + 3, k = cov[y * DW + x] / 255;
      px[i] = Math.round(px[i] * (outside ? 1 - k : k));
    }
    writeLayer(L, area, px);
  }
  // 画布外的部分：贴入＝选区外全藏；外部粘贴＝选区外全露（不动）
  if (!outside) cropLayerTo(L, docRect());
  return r;
}
function cropLayerTo(L, r){
  const cr = canvasRect(L); if (Rc.eq(Rc.inter(cr, r), cr)) return;
  const keep = Rc.inter(cr, r);
  const px = keep ? readLayer(L, keep) : null;
  L.data.ctx.clearRect(0, 0, L.data.canvas.width, L.data.canvas.height);
  if (keep) writeLayer(L, keep, px);
}

CMD.reg('ps.edit.cut', {i18n:'', undoable:true, params:'{} 剪切：当前像素层选区内（没选区＝整层）拷进剪贴板再清掉（背景层改填背景色）→ {bounds:[x,y,w,h]}（edit_cmds.rs edit.cut）'}, () => {
  const pl = editablePixels({}); if (pl.error) return fail(pl.error);
  const r = copyImpl(false); if (r.ok === false) return r;
  clearSelected(pl.L);
  return r;
});
CMD.reg('ps.edit.copy', {i18n:'', params:'{} 拷贝：当前像素层选区内（没选区＝整层内容）进剪贴板（羽化的选区连半透明一起）→ {bounds:[x,y,w,h]}'}, () => copyImpl(false));
CMD.reg('ps.edit.copyMerged', {i18n:'', params:'{} 合并拷贝：所有可见层合成后的选区内像素进剪贴板 → {bounds:[x,y,w,h]}'}, () => copyImpl(true));
CMD.reg('ps.edit.paste', {i18n:'', undoable:true, params:'{center?:[x,y]} 粘贴成新像素层（在当前层上面）；没给 center 且原位置在画布内＝原位，否则贴到 center（缺省画布中心）；会取消选区 → {layer, offset:[dx,dy]}'},
  p => pasteImpl(p, false));
CMD.reg('ps.edit.pasteSpecial.pasteInPlace', {i18n:'', undoable:true, params:'{} 原位粘贴：贴回拷贝时的位置 → {layer, offset}'}, p => pasteImpl(p, true));
CMD.reg('ps.edit.pasteSpecial.pasteInto', {i18n:'', undoable:true, params:'{center?:[x,y]} 贴入：要有选区；贴到选区中心、加「只露选区」的图层蒙版（历史存不住蒙版时改乘进 alpha）；一步历史 → {layer, offset, mask?:true}'},
  p => pasteIntoImpl(p, false));
CMD.reg('ps.edit.pasteSpecial.pasteOutside', {i18n:'', undoable:true, params:'{center?:[x,y]} 外部粘贴：要有选区；贴到选区中心、蒙版只露选区外 → {layer, offset, mask?:true}'},
  p => pasteIntoImpl(p, true));
CMD.reg('ps.edit.clear', {i18n:'', undoable:true, params:'{layerId?} 清除：像素层选区内（照覆盖度，羽化选区半清）变透明，背景层改填背景色；没选区＝整个画布范围（commands.rs edit.clear）'}, p => {
  const pl = editablePixels(p); if (pl.error) return fail(pl.error);
  clearSelected(pl.L); return {ok:true};
});

/* edit_cmds.rs:324 toggle_last_state：能重做就重做，不然还原 */
CMD.reg('ps.edit.toggleLastState', {i18n:'', params:'{} 切换最终状态：有可重做的就重做一步，否则还原一步（Ctrl+Alt+Z）→ {ok, did:"redo"|"undo"}'}, () => {
  if (History.future.length) return {ok:History.redo(), did:'redo'};
  return {ok:History.undo(), did:'undo'};
});

/* ═══════════ 填充（fill_cmds.rs） ═══════════ */
const CONTENTS = ['foreground', 'background', 'color', 'contentAware', 'pattern', 'history', 'black', 'gray', 'white'];
function flagParam(p, k, d){
  const v = p[k];
  if (v === undefined || v === null) return {v:d};
  if (typeof v === 'boolean') return {v};
  return {error:`\`${k}\` must be true or false, not ${JSON.stringify(v)}`};
}
/* 来源：单色，或一块 rect 上的 straight RGBA（Float32，0..1） */
const srcColor = c => ({at:() => c});
function srcPixels(r, f){ const w = Rc.w(r); return {at:(x, y) => {
  if (x < r[0] || y < r[1] || x >= r[2] || y >= r[3]) return [0, 0, 0, 0];
  const i = ((y - r[1]) * w + (x - r[0])) * 4; return [f[i], f[i + 1], f[i + 2], f[i + 3]];
}}; }
const toF = u8 => { const f = new Float32Array(u8.length); for (let i = 0; i < u8.length; i++) f[i] = u8[i] / 255; return f; };

/* fill_cmds.rs:283 blend_tile：每格＝选区覆盖度×不透明度，按模式混进去；溶解＝按机率整格画或不画 */
function blendInto(L, area, src, cov, b){
  ensureCovers(L, area);
  const w = Rc.w(area), h = Rc.h(area), DW = Doc.width;
  const img = L.data.ctx.getImageData(area[0] - L.x, area[1] - L.y, w, h), d = img.data;
  const dissolve = b.mode === 'dissolve', blend = dissolve ? 'normal' : b.mode;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const X = area[0] + x, Y = area[1] + y;
    let k = (cov ? cov[Y * DW + X] / 255 : 1) * b.opacity;
    if (k <= 0) continue;
    const i = (y * w + x) * 4;
    const D = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, d[i + 3] / 255];
    const c = src.at(X, Y).slice();
    if (dissolve){ k = ditherNoise(X, Y) < c[3] * k ? 1 : 0; c[3] = 1; if (k <= 0) continue; }
    const o = (b.restore && blend === 'normal') ? lerpPremul(D, c, k) : composite4(blend, D, c, k);
    if (b.keepAlpha) o[3] = D[3];
    d[i] = o[0] * 255; d[i + 1] = o[1] * 255; d[i + 2] = o[2] * 255; d[i + 3] = o[3] * 255;
  }
  L.data.ctx.putImageData(img, area[0] - L.x, area[1] - L.y);
  Layer.invalidate(L);
}
/* 历史状态 i 的那一层（fill_cmds.rs:115-131）：缺省＝最旧的状态；i == 状态数＝目前文件。
   命令执行时 CMD.run 已经先 push 了一格（＝目前文件），所以「状态数」＝ past.length − 1 */
function historyLayer(p, L){
  const P = History.past.length - 1;
  let i = 0;
  if (p.state !== undefined && p.state !== null){
    if (!Number.isInteger(p.state) || p.state < 0) return {error:`\`state\` must be a history state index, not ${JSON.stringify(p.state)}`};
    i = p.state;
  }
  if (P <= 0 || i === P) return {cv:L.data.canvas, x:L.x, y:L.y};
  if (i > P) return {error:`no history state ${i} (0..=${P})`};
  const o = History.past[i].layers.find(q => q.id === L.id);
  if (!o || o.kind !== 'raster') return {error:'the target did not exist (as pixels, a mask or a channel) in that history state'};
  return {cv:o.data.canvas, x:o.x, y:o.y};
}
function fillCmd(p){
  let contents = 'color';
  if (p.contents !== undefined && p.contents !== null){
    if (typeof p.contents !== 'string') return fail(`edit.fill: \`contents\` must be a string, not ${JSON.stringify(p.contents)}`);
    contents = CONTENTS.find(k => k.toLowerCase() === p.contents.toLowerCase());
    if (!contents) return fail(`edit.fill: unknown contents \`${p.contents}\` (${CONTENTS.join('|')})`);
  }
  let mode = 'normal';
  if (p.mode !== undefined && p.mode !== null){
    if (typeof p.mode !== 'string') return fail(`edit.fill: \`mode\` must be a blend mode name, not ${JSON.stringify(p.mode)}`);
    mode = modeFrom(p.mode);
    if (!mode || mode === 'passThrough') return fail(`edit.fill: unknown blend mode \`${p.mode}\``);
  }
  let opacity = 1;
  if (p.opacity !== undefined && p.opacity !== null){
    if (!isNum(p.opacity)) return fail(`edit.fill: \`opacity\` must be a number 0..100, not ${JSON.stringify(p.opacity)}`);
    opacity = clamp(p.opacity, 0, 100) / 100;
  }
  const pr = flagParam(p, 'preserveTransparency', false); if (pr.error) return fail('edit.fill: ' + pr.error);
  const pl = editablePixels(p); if (pl.error) return fail(pl.error);
  const L = pl.L, docB = docRect();
  let area = selRect() || docB;
  const out = {ok:true, contents};
  let source;
  switch (contents){
    case 'foreground': source = srcColor(fgColor()); break;
    case 'background': source = srcColor(bgColor()); break;
    case 'color': source = srcColor(colorParam(p, 'color', fgColor())); break;
    case 'black': source = srcColor([0, 0, 0, 1]); break;
    case 'gray': source = srcColor([128 / 255, 128 / 255, 128 / 255, 1]); break;
    case 'white': source = srcColor([1, 1, 1, 1]); break;
    case 'pattern': {
      const pat = Patterns.resolve(typeof p.pattern === 'string' ? p.pattern : '');
      if (!pat) return fail(`edit.fill: no pattern "${p.pattern || ''}" (see ps.pattern.list)`);
      out.pattern = pat.id;
      // PS「脚本」勾选：图案不平铺，改由脚本（砖形／十字线织物／沿路径置入／随机／螺线／对称）一份份盖章（档尾「填充脚本」段）
      if (p.script !== undefined && p.script !== null && p.script !== false && p.script !== ''){
        if (!PE.fillScript) return fail('edit.fill: scripted patterns are not loaded');
        const r = PE.fillScript.render(p, pat, Rc.inter(area, docB) || area, selBytes());
        if (r.error) return fail('edit.fill: ' + r.error);
        area = r.area; source = srcPixels(r.area, r.px); out.script = r.script; out.stamps = r.stamps;
        break;
      }
      const pc = placement(p);
      // 原码：Photoshop 的填充以画布原点平铺（Placement::new(Rect::EMPTY, false, phase, scale, angle)）
      const place = makePlacement([0, 0], false, pc.phase, pc.scale, pc.angle);
      source = srcPixels(area, renderPattern(pat, place, area));
      break;
    }
    case 'history': {
      const hs = historyLayer(p, L); if (hs.error) return fail(hs.error);
      source = srcPixels(area, toF(readCanvas(hs.cv, hs.x, hs.y, area)));
      break;
    }
    case 'contentAware': {
      if (!Doc.sel) return fail('Content-Aware fill needs a selection');
      const fa = flagParam(p, 'colorAdaptation', true); if (fa.error) return fail('edit.fill: ' + fa.error);
      const r = contentAwareSource(L, fa.v, isNum(p.seed) ? p.seed : 1);
      if (r.error) return fail(r.error);
      source = r.src;
      break;
    }
  }
  area = Rc.inter(area, docB);
  if (!area) return out;
  blendInto(L, area, source, selBytes(), {mode, opacity, keepAlpha:pr.v || alphaLocked(L), restore:contents === 'history'});
  return out;
}
/* fill_cmds.rs:166 content_aware：取样窗＝选区外框外扩 max(¾ 边长, 32)，旋转／缩放／镜像都关 */
function contentAwareSource(L, adapt, seed){
  const hb = Rc.inter(selRect(), docRect());
  if (!hb) return {error:'the selection is outside the canvas'};
  const ext = Math.max(Rc.w(hb), Rc.h(hb));
  const win = Rc.inter(Rc.inflate(hb, Math.max(Math.floor(ext * 3 / 4), 32)), docRect());
  const w = Rc.w(win), h = Rc.h(win), cov = selBytes(), DW = Doc.width;
  const img = toF(readLayer(L, win));
  const hole = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) hole[y * w + x] = cov[(win[1] + y) * DW + win[0] + x] > 0 ? 1 : 0;
  if (hole.every(v => v)) return {error:'Content-Aware fill needs pixels outside the selection to sample from'};
  const source = new Uint8Array(w * h).fill(1);
  const filled = caFill(w, h, 4, img, hole, source, {colorAdaptation: adapt ? colorLevel('default') : colorLevel('none'), rotations:[], scale:false, mirror:false, seed});
  return {src: srcPixels(win, filled)};
}
CMD.reg('ps.edit.fill', {i18n:'', undoable:true,
  params:'{contents:"foreground|background|color|contentAware|pattern|history|black|gray|white"="color", color:"#rrggbb"|[r,g,b,a]=前景色（contents=color）, '
       + 'pattern:id|名字（contents=pattern；缺省＝第一个图案）, scale:%=100, angle:度, phase?:[x,y], '
       + 'script?:"brickFill|crossWeave|placeAlongPath|randomFill|spiral|symmetryFill"（contents=pattern；PS「脚本」：不平铺，改按脚本一份份放图案）, scriptOptions?:{…各脚本的栏位，见 ps.edit.fill.script.list}, path?:路径键（placeAlongPath；缺省＝路径面板选中的／工作路径）, '
       + 'state:历史状态序号?（contents=history；缺省＝最旧的状态）, '
       + 'colorAdaptation:bool=true（contents=contentAware）, seed?, mode:"normal|dissolve|multiply|…（27 种）"="normal", opacity:0..100=100, preserveTransparency:bool=false, layerId?} '
       + '填充当前像素层的选区（没选区＝整个画布）；一步历史（fill_cmds.rs edit.fill）'}, fillCmd);

/* ═══════════ 图案库（pattern_cmds.rs） ═══════════ */
function hash01(x, y, seed){                                   // pattern_cmds.rs:33
  let h = (Math.imul(x >>> 0, 0x8da6b343) ^ Math.imul(y >>> 0, 0xd8163841) ^ Math.imul(seed >>> 0, 0xcb1ab31f)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 0x5bd1e995) >>> 0; h = (h ^ (h >>> 15)) >>> 0;
  return (h & 0xffff) / 65535;
}
function fnv(h, bytes){ for (let i = 0; i < bytes.length; i++){ h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
/* 图案：{id, name, width, height, px:Uint8ClampedArray(straight RGBA)}；id 由名字＋尺寸＋像素算（doc/src/pattern.rs:30 同样的想法，32 位 FNV） */
function makePattern(name, w, h, px){
  const enc = new TextEncoder().encode(name);
  let h1 = fnv(0x811c9dc5, enc); h1 = fnv(h1, [w & 255, w >> 8, h & 255, h >> 8]); h1 = fnv(h1, px);
  const h2 = fnv(h1 ^ 0x9e3779b9, px);
  const hx = v => (v >>> 0).toString(16).padStart(8, '0');
  return {id:`${hx(h1)}-${hx(h2).slice(0, 4)}-${hx(h2).slice(4)}`, name, width:w, height:h, px};
}
function procedural(name, w, h, f){                            // pattern_cmds.rs:41
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const c = f(x, y), i = (y * w + x) * 4;
    px[i] = c01(c[0]) * 255; px[i + 1] = c01(c[1]) * 255; px[i + 2] = c01(c[2]) * 255; px[i + 3] = 255;
  }
  return makePattern(name, w, h, px);
}
function builtinPatterns(){                                    // pattern_cmds.rs:56-95
  const g = v => [v, v, v];
  return [
    procedural('Checkerboard', 16, 16, (x, y) => g((((x >> 3) + (y >> 3)) % 2 === 0) ? 0.8 : 1)),
    procedural('Diagonal Lines', 8, 8, (x, y) => g((x + y) % 8 < 2 ? 0.2 : 1)),
    procedural('Dots', 12, 12, (x, y) => { const dx = x + 0.5 - 6, dy = y + 0.5 - 6; return g(c01(Math.sqrt(dx * dx + dy * dy) - 3)); }),
    procedural('Grid', 16, 16, (x, y) => g(x === 0 || y === 0 ? 0.55 : 1)),
    procedural('Bricks', 32, 16, (x, y) => {
      const row = y >> 3, xo = (x + (row % 2 === 1 ? 8 : 0)) % 16;
      const mortar = y % 8 === 7 || xo === 15, n = hash01(x, y, 7) * 0.08;
      return mortar ? [0.78 + n, 0.76 + n, 0.72 + n] : [0.62 + n, 0.27 + n * 0.5, 0.2];
    }),
    procedural('Weave', 16, 16, (x, y) => {
      const over = (((x >> 2) + (y >> 2)) % 2) === 0, t = over ? (y % 4) / 3 : (x % 4) / 3;
      const v = 0.55 + 0.35 * (1 - Math.abs(2 * t - 1)); return [v, v * 0.92, v * 0.8];
    }),
    procedural('Paper Noise', 64, 64, (x, y) => {
      const oct = (cell, seed) => {
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell), fx = (x % cell) / cell, fy = (y % cell) / cell, n = 64 / cell;
        const v = (i, j) => hash01(i % n, j % n, seed), s = t => t * t * (3 - 2 * t), sx = s(fx), sy = s(fy);
        const a = v(cx, cy) + (v(cx + 1, cy) - v(cx, cy)) * sx, b = v(cx, cy + 1) + (v(cx + 1, cy + 1) - v(cx, cy + 1)) * sx;
        return a + (b - a) * sy;
      };
      return g(0.78 + 0.14 * oct(8, 1) + 0.08 * oct(2, 2));
    }),
  ];
}
/* 自己定义的图案存进浏览器（localStorage），重开还在（Photoshop 的图案库也是跨文件的 app 状态） */
const PAT_KEY = 'dlcanvas.ps.patterns';
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => { const t = atob(s), u = new Uint8ClampedArray(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
const Patterns = PE.patterns = {
  items: null,
  /* 存法：{v:2, items:[{builtin:原名, name}（内建，可改名／删／排顺序）| {id, name, width, height, px:base64 RGBA}（自己定义的）]} */
  load(){
    if (this.items) return this.items;
    const built = builtinPatterns();
    built.forEach(q => q.builtin = q.name);
    let st = null; try { st = JSON.parse(localStorage.getItem(PAT_KEY) || 'null'); } catch(e){}
    if (!st || st.v !== 2 || !Array.isArray(st.items)){ this.items = built; return this.items; }
    this.items = [];
    for (const o of st.items){
      if (o.builtin){ const q = built.find(x => x.builtin === o.builtin); if (q){ q.name = o.name || q.name; this.items.push(q); } }
      else if (o.px){ const q = makePattern(o.name, o.width, o.height, unb64(o.px)); if (o.id) q.id = o.id; if (!this.items.some(x => x.id === q.id)) this.items.push(q); }
    }
    return this.items;
  },
  save(){
    const items = this.load().map(q => q.builtin ? {builtin:q.builtin, name:q.name} : {id:q.id, name:q.name, width:q.width, height:q.height, px:b64(q.px)});
    try { localStorage.setItem(PAT_KEY, JSON.stringify({v:2, items})); return true; }
    catch(e){ return false; }                                 // 太大塞不进 localStorage：留在这次的记忆体里
  },
  /* pattern_cmds.rs:115 resolve：id 或名字；空字串＝第一个 */
  resolve(key){ const it = this.load(); if (!key) return it[0] || null; return it.find(q => q.id === key) || it.find(q => q.name === key) || null; },
};
/* pattern_cmds.rs:295 placement */
function placement(p){
  const num = (k, d) => isNum(p[k]) ? p[k] : d;
  const ph = Array.isArray(p.phase) ? [Number(p.phase[0]) || 0, Number(p.phase[1]) || 0] : [0, 0];
  return {scale:clamp(num('scale', 100) / 100, 0.01, 10), angle:num('angle', 0), link:p.link !== false, phase:ph};
}
/* compose/src/pattern.rs:159 Placement::anchored ＋ map */
function makePlacement(anchor, link, phase, scale, angle){
  const base = link ? anchor : [0, 0];
  const origin = [base[0] + phase[0], base[1] + phase[1]];
  const inv = (isFinite(scale) && scale > 1e-3) ? 1 / scale : 1, a = angle * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return {map(x, y){ const dx = x - origin[0], dy = y - origin[1]; return [(dx * c - dy * s) * inv, (dx * s + dy * c) * inv]; }};
}
/* pattern.rs:86 Tile（预乘）＋ 111 sample（环绕双线性，像素中心在 i+0.5）＋ 185 render → straight RGBA Float32 */
function renderPattern(pat, place, r){
  const tw = pat.width, th = pat.height, tp = new Float32Array(tw * th * 4);
  for (let i = 0; i < tw * th; i++){ const a = pat.px[i * 4 + 3] / 255; tp[i * 4] = pat.px[i * 4] / 255 * a; tp[i * 4 + 1] = pat.px[i * 4 + 1] / 255 * a; tp[i * 4 + 2] = pat.px[i * 4 + 2] / 255 * a; tp[i * 4 + 3] = a; }
  const mod = (v, n) => ((v % n) + n) % n;
  const w = Rc.w(r), h = Rc.h(r), out = new Float32Array(w * h * 4), acc = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    let [u, v] = place.map(r[0] + x + 0.5, r[1] + y + 0.5);
    u -= 0.5; v -= 0.5;
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    acc[0] = acc[1] = acc[2] = acc[3] = 0;
    for (const [dy, wy] of [[0, 1 - fy], [1, fy]]){ if (wy === 0) continue;
      for (const [dx, wx] of [[0, 1 - fx], [1, fx]]){ if (wx === 0) continue;
        const j = (mod(y0 + dy, th) * tw + mod(x0 + dx, tw)) * 4, k = wx * wy;
        acc[0] += tp[j] * k; acc[1] += tp[j + 1] * k; acc[2] += tp[j + 2] * k; acc[3] += tp[j + 3] * k; } }
    const o = (y * w + x) * 4;
    if (acc[3] > 0){ out[o] = acc[0] / acc[3]; out[o + 1] = acc[1] / acc[3]; out[o + 2] = acc[2] / acc[3]; out[o + 3] = Math.min(acc[3], 1); }
  }
  return out;
}
/* pattern_cmds.rs:186 define：区域＝rect 或选区外框或整个画布；取可见合成；限 4000×4000；没给名字＝「Pattern」「Pattern 2」… */
function definePattern(p){
  let r;
  if (Array.isArray(p.rect) && p.rect.length === 4) r = p.rect.map(v => Math.round(Number(v) || 0));
  else r = selRect() || docRect();
  r = Rc.inter(r, docRect());
  if (!r) return fail('edit.definePattern: the area is empty');
  if (Rc.w(r) > 4000 || Rc.h(r) > 4000) return fail('edit.definePattern: patterns are limited to 4000 × 4000 px');
  const px = new Uint8ClampedArray(composite(1).getContext('2d').getImageData(r[0], r[1], Rc.w(r), Rc.h(r)).data);
  const items = Patterns.load();
  let name = typeof p.name === 'string' && p.name.trim() ? p.name : null;
  if (!name){ const base = 'Pattern'; for (let i = 1; ; i++){ const n = i === 1 ? base : `${base} ${i}`; if (!items.some(q => q.name === n)){ name = n; break; } } }
  const pat = makePattern(name, Rc.w(r), Rc.h(r), px);
  if (!items.some(q => q.id === pat.id)) items.push(pat);
  Patterns.recent = pat.id;                                   // PS：刚定义的图案就是图案挑选器里目前那个
  const saved = Patterns.save();
  return {ok:true, pattern:pat.id, info:{id:pat.id, name, width:pat.width, height:pat.height}, saved};
}
CMD.reg('ps.edit.definePattern', {i18n:'', params:'{name?, rect?:[x0,y0,x1,y1]（缺省＝选区外框，没选区＝整个画布）, dialog?:true＝开「图案名称」对话框} 定义图案：取可见合成进图案库（存进浏览器，重开还在；填充的「图案」用它）→ {pattern:id, info, saved}'},
  p => p.dialog ? openDefineDialog('pattern') : definePattern(p));
CMD.reg('ps.pattern.list', {i18n:'', params:'{} 图案库清单（内建 7 个＋自己定义的）→ [{id,name,width,height}]'},
  () => Patterns.load().map(q => ({id:q.id, name:q.name, width:q.width, height:q.height})));

/* ═══════════ 定义画笔预设（edit_menu_cmds.rs:495 → brush_cmds.rs:512 define_from_selection） ═══════════ */
/* 取样笔尖的库在 tools/brush.js 的 BrushTips（同一个 localStorage 键 dlcanvas.ps.brushPresets；笔刷引擎画得出来）：这里只做「从选区／图层取灰阶」 */
const BrushPresets = PE.brushPresets = {
  list(){ return window.BrushTips ? BrushTips.list().filter(t => t.source !== 'builtin') : []; },
};
function defineBrushPreset(p){
  const pl = pixelLayer(p); if (pl.error) return fail(pl.error);
  let name = typeof p.name === 'string' ? p.name.trim() : '';
  if (!name){ const n = BrushPresets.list().filter(b => b.name.startsWith('Sampled Brush')).length + 1; name = `Sampled Brush ${n}`; }
  // 区域：选区外框；没选区＝这一层画布（PS：没选区时取整层内容）
  const area = Rc.inter(Doc.sel ? selRect() : canvasRect(pl.L), docRect());
  if (!area) return fail(Doc.sel ? 'brush.defineFromSelection: the selection is empty' : 'brush.defineFromLayer: the layer is outside the canvas');
  // 涂料量＝暗度×alpha×选区（黑＝满、白／透明＝没有，同 Photoshop）
  const w = Rc.w(area), h = Rc.h(area), px = readLayer(pl.L, area), cov = selBytes(), DW = Doc.width, v = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = (y * w + x) * 4, l = lum([px[i] / 255, px[i + 1] / 255, px[i + 2] / 255]);
    v[y * w + x] = c01((1 - l) * (px[i + 3] / 255) * (cov ? cov[(area[1] + y) * DW + area[0] + x] / 255 : 1));
  }
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (v[y * w + x] > 1e-4){ x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  if (x1 <= x0 || y1 <= y0) return fail('brush.defineFromSelection: the selected pixels contain no paint (all white or transparent)');
  const tw = x1 - x0, th = y1 - y0;
  if (Math.max(tw, th) > 2500) return fail(`brush.defineFromSelection: selection too large for a brush tip (${tw}×${th}; max 2500 px)`);
  const tip = new Uint8Array(tw * th);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) tip[(y - y0) * tw + (x - x0)] = Math.round(v[y * w + x] * 255);
  if (!CMD.map['brush.tips.add']) return fail('the brush engine (tools/brush.js) is not loaded');
  // 存进本机预设库＋这份档，并换成这支笔尖（PS：定义完就是目前的画笔）
  const r = CMD.map['brush.tips.add'].run({name, width:tw, height:th, alpha:tip, size:Math.max(tw, th), spacing:0.25, select:p.select !== false});
  if (!r || r.ok === false) return r || fail('brush.tips.add failed');
  return Object.assign({ok:true, name, id:r.tip.id, width:r.tip.width, height:r.tip.height, size:r.tip.size, saved:r.saved, applied:r.selected}, r.warning ? {warning:r.warning} : {}, r.note ? {note:r.note} : {});
}
CMD.reg('ps.edit.defineBrushPreset', {i18n:'', params:'{name?（缺省 "Sampled Brush N"）, layerId?, select?:bool=true（定义完换成这支）, dialog?:true＝开「画笔名称」对话框} 定义画笔预设：当前像素层选区内（没选区＝整层）的暗度×不透明度做成灰阶笔尖，存进本机画笔预设库与这份工程档，笔刷换成它 → {name,id,width,height,size,saved,applied}'},
  p => p.dialog ? openDefineDialog('brush') : defineBrushPreset(p));
CMD.reg('ps.brush.presets', {i18n:'', params:'{} 自己的取样笔尖清单（定义画笔预设、读入 .abr 的；内建的见 brush.tips.list）→ [{id,name,width,height,size,spacing}]'},
  () => BrushPresets.list().map(b => ({id:b.id, name:b.name, width:b.width, height:b.height, size:b.size, spacing:b.spacing})));

/* ═══════════ 选区距离变换（algo/src/selection.rs 540-622） ═══════════ */
function dt1(f, n, out, v, z){                // Felzenszwalb & Huttenlocher 一维平方距离变换
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
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
  for (let q = 0; q < n; q++){ while (z[k + 1] < q) k++; const d = q - v[k]; out[q] = d * d + f[v[k]]; }
}
function edt(inside, w, h){
  const g = new Float64Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = inside[i] ? 0 : 1e20;
  const n = Math.max(w, h, 1), f = new Float64Array(n), o = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++){ for (let y = 0; y < h; y++) f[y] = g[y * w + x]; dt1(f, h, o, v, z); for (let y = 0; y < h; y++) g[y * w + x] = o[y]; }
  for (let y = 0; y < h; y++){ for (let x = 0; x < w; x++) f[x] = g[y * w + x]; dt1(f, w, o, v, z); for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(o[x]); }
  return g;
}
function expand(m, w, h, r){
  const inside = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) inside[i] = m[i] >= 0.5 ? 1 : 0;
  const d = edt(inside, w, h), out = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = Math.max(m[i], c01(r + 1 - d[i]));
  return out;
}
function contract(m, w, h, r){
  const inv = new Float32Array(m.length); for (let i = 0; i < m.length; i++) inv[i] = 1 - m[i];
  const e = expand(inv, w, h, r); for (let i = 0; i < e.length; i++) e[i] = 1 - e[i];
  return e;
}

/* ═══════════ 描边（extra_cmds.rs:115 stroke） ═══════════ */
function strokeCmd(p){
  const width = clamp(isNum(p.width) ? p.width : 1, 1, 250);
  const color = colorParam(p, 'color', fgColor());
  color[3] *= c01((isNum(p.opacity) ? p.opacity : 100) / 100);
  const location = typeof p.location === 'string' ? p.location : 'center';
  const pl = editablePixels(p); if (pl.error) return fail(pl.error);
  const L = pl.L, DW = Doc.width, DH = Doc.height, N = DW * DH;
  const edge = new Float32Array(N);
  if (Doc.sel){ const b = selBytes(); for (let i = 0; i < N; i++) edge[i] = b[i] / 255; }
  else { const px = readLayer(L, docRect()); for (let i = 0; i < N; i++) edge[i] = px[i * 4 + 3] / 255; }   // 没选区：沿该层不透明的边
  let outer, inner;
  if (location === 'inside'){ outer = edge; inner = contract(edge, DW, DH, width); }
  else if (location === 'outside'){ outer = expand(edge, DW, DH, width); inner = edge; }
  else { outer = expand(edge, DW, DH, width / 2); inner = contract(edge, DW, DH, width / 2); }
  const band = new Float32Array(N);
  let x0 = DW, y0 = DH, x1 = -1, y1 = -1;
  for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++){
    const i = y * DW + x, v = c01(outer[i] - inner[i]);
    band[i] = Math.round(v * 255) / 255;                       // mask_to_surface：GRAY8
    if (band[i] > 0){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  }
  if (x1 < 0) return {ok:true};
  // pixels.rs:35 fill_surface：照带子的覆盖度用 Normal 盖上去（锁透明度＝alpha 不变）
  const area = [x0, y0, x1 + 1, y1 + 1], lockA = alphaLocked(L);
  ensureCovers(L, area);
  const w = Rc.w(area), img = L.data.ctx.getImageData(area[0] - L.x, area[1] - L.y, w, Rc.h(area)), d = img.data;
  for (let y = area[1]; y < area[3]; y++) for (let x = area[0]; x < area[2]; x++){
    const k = band[y * DW + x]; if (k <= 0) continue;
    const i = ((y - area[1]) * w + (x - area[0])) * 4;
    const da = d[i + 3] / 255, sa = color[3] * k, oa = sa + da * (1 - sa);
    if (oa > 0) for (let c = 0; c < 3; c++) d[i + c] = (color[c] * sa + d[i + c] / 255 * da * (1 - sa)) / oa * 255;
    d[i + 3] = (lockA ? da : oa) * 255;
  }
  L.data.ctx.putImageData(img, area[0] - L.x, area[1] - L.y);
  Layer.invalidate(L);
  return {ok:true};
}
CMD.reg('ps.edit.stroke', {i18n:'', undoable:true,
  params:'{width:1..250=1 px, color:"#rrggbb"|[r,g,b,a]=前景色, location:"inside|center|outside"="center", opacity:0..100=100, layerId?} 描边：沿选区边缘画一圈（没选区＝沿该层不透明内容的边）；一步历史（extra_cmds.rs edit.stroke）'},
  strokeCmd);

/* ═══════════ 内容识别填充（algo/src/inpaint.rs ＋ poisson.rs ＋ content_aware.rs） ═══════════ */
/* poisson.rs:100 sor */
const TOL = 2e-5, FINE_ITERS = 30, FINE_OMEGA = 1.7;
function sor(w, h, unknown, v, maxIter, omega){
  const cells = [], masks = [];
  for (let i = 0; i < w * h; i++) if (unknown[i]){
    const x = i % w, y = (i / w) | 0;
    cells.push(i); masks.push((x > 0 ? 1 : 0) | (x + 1 < w ? 2 : 0) | (y > 0 ? 4 : 0) | (y + 1 < h ? 8 : 0));
  }
  for (let it = 0; it < maxIter; it++){
    let maxD = 0;
    for (let c = 0; c < cells.length; c++){
      const i = cells[c], m = masks[c];
      let s, n;
      if (m === 15){ s = v[i - 1] + v[i + 1] + v[i - w] + v[i + w]; n = 4; }
      else {
        s = 0; n = 0;
        if (m & 1){ s += v[i - 1]; n++; } if (m & 2){ s += v[i + 1]; n++; }
        if (m & 4){ s += v[i - w]; n++; } if (m & 8){ s += v[i + w]; n++; }
        if (!n) continue;
      }
      const d = omega * (s / n - v[i]); v[i] += d;
      if (Math.abs(d) > maxD) maxD = Math.abs(d);
    }
    if (maxD < TOL) break;
  }
}
/* poisson.rs:37 solve_rec：级联多重网格（缩一半先解，双线性放回当初值，再 SOR 几轮） */
function solveRec(w, h, unknown, v, depth){
  let nUnknown = 0, sum = 0, nKnown = 0;
  for (let i = 0; i < w * h; i++){ if (unknown[i]) nUnknown++; else { sum += v[i]; nKnown++; } }
  if (!nUnknown || !nKnown) return;
  if (w >= 8 && h >= 8 && nUnknown > 64 && depth < 16){
    const cw = Math.ceil(w / 2), chh = Math.ceil(h / 2), cu = new Uint8Array(cw * chh).fill(1), cv = new Float32Array(cw * chh);
    for (let cy = 0; cy < chh; cy++) for (let cx = 0; cx < cw; cx++){
      let s = 0, n = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]){ const x = cx * 2 + dx, y = cy * 2 + dy; if (x < w && y < h && !unknown[y * w + x]){ s += v[y * w + x]; n++; } }
      if (n){ cu[cy * cw + cx] = 0; cv[cy * cw + cx] = s / n; }
    }
    solveRec(cw, chh, cu, cv, depth + 1);
    for (let y = 0; y < h; y++){
      const fy = clamp((y + 0.5) / 2 - 0.5, 0, chh - 1), y0 = Math.floor(fy), y1 = Math.min(y0 + 1, chh - 1), ty = fy - y0;
      for (let x = 0; x < w; x++){
        if (!unknown[y * w + x]) continue;
        const fx = clamp((x + 0.5) / 2 - 0.5, 0, cw - 1), x0 = Math.floor(fx), x1 = Math.min(x0 + 1, cw - 1), tx = fx - x0;
        const a = cv[y0 * cw + x0] + (cv[y0 * cw + x1] - cv[y0 * cw + x0]) * tx, b = cv[y1 * cw + x0] + (cv[y1 * cw + x1] - cv[y1 * cw + x0]) * tx;
        v[y * w + x] = a + (b - a) * ty;
      }
    }
    sor(w, h, unknown, v, FINE_ITERS, FINE_OMEGA);
  } else {
    const mean = sum / nKnown;
    for (let i = 0; i < w * h; i++) if (unknown[i]) v[i] = mean;
    sor(w, h, unknown, v, 2000, 1.85);
  }
}
/* poisson.rs:224 membrane_fill（逐通道） */
function membraneFill(w, h, ch, img, hole){
  const out = new Float32Array(w * h * ch), v = new Float32Array(w * h);
  for (let c = 0; c < ch; c++){
    for (let i = 0; i < w * h; i++) v[i] = hole[i] ? 0 : img[i * ch + c];
    solveRec(w, h, hole, v, 0);
    for (let i = 0; i < w * h; i++) out[i * ch + c] = v[i];
  }
  return out;
}
/* inpaint.rs:29 Rng：原码是 SplitMix64；JS 没有便宜的 64 位整数，换成 32 位 mulberry（一样是固定种子、结果可重现，但跟原码的乱数序列不同） */
function rngOf(seed){
  let s = (seed >>> 0) ^ 0x9E3779B9;
  return {
    next(){ s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0; },
    range(lo, hi){ return hi <= lo ? lo : lo + (this.next() % (hi - lo + 1)); },
  };
}
const CP = {patchRadius:3, emIters:8, minEmIters:2, pmIters:2, refineExtent:96};     // inpaint.rs:67 CompleteParams::default
function downsample(l, ch){                                    // inpaint.rs:82
  const w = Math.ceil(l.w / 2), h = Math.ceil(l.h / 2), img = new Float32Array(w * h * ch), hole = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    let n = 0; const o = (y * w + x) * ch;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]){
      const sx = x * 2 + dx, sy = y * 2 + dy; if (sx >= l.w || sy >= l.h) continue;
      const si = sy * l.w + sx;
      if (l.hole[si]) hole[y * w + x] = 1; else { for (let c = 0; c < ch; c++) img[o + c] += l.img[si * ch + c]; n++; }
    }
    if (n) for (let c = 0; c < ch; c++) img[o + c] /= n;
  }
  return {w, h, img, hole};
}
function integral(w, h, m){                                    // inpaint.rs:116
  const s = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++){ let row = 0; for (let x = 0; x < w; x++){ row += m[y * w + x] ? 1 : 0; s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + row; } }
  return s;
}
function windowCount(s, gw, gh, x0, y0, x1, y1){
  x0 = Math.max(x0, 0); y0 = Math.max(y0, 0); x1 = Math.min(Math.max(x1, 0), gw); y1 = Math.min(Math.max(y1, 0), gh);
  if (x1 <= x0 || y1 <= y0) return 0;
  const w1 = gw + 1; return s[y1 * w1 + x1] + s[y0 * w1 + x0] - s[y0 * w1 + x1] - s[y1 * w1 + x0];
}
function holeBbox(w, h, hole){
  let b = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (hole[y * w + x]){
    if (!b) b = [x, y, x + 1, y + 1]; else { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x + 1); b[3] = Math.max(b[3], y + 1); }
  }
  return b;
}
/* inpaint.rs:155 Solver */
function makeSolver(w, h, ch, r, img, hole, valid, validList, targets){
  const S = {w, h, ch, r, img, hole, valid, validList, targets};
  S.isValid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && valid[y * w + x] === 1;
  /* SSD／样本数；cutoff 提早出场 */
  S.dist = (tx0, ty0, sx0, sy0, cutoff) => {
    const full = (2 * r + 1) * (2 * r + 1) * ch;
    let sum = 0, n = 0;
    for (let dy = -r; dy <= r; dy++){
      const ty = ty0 + dy; if (ty < 0 || ty >= h) continue;
      const sy = sy0 + dy;
      for (let dx = -r; dx <= r; dx++){
        const tx = tx0 + dx; if (tx < 0 || tx >= w) continue;
        const ti = (ty * w + tx) * ch, si = (sy * w + sx0 + dx) * ch;
        for (let c = 0; c < ch; c++){ const d = img[ti + c] - img[si + c]; sum += d * d; }
        n += ch;
      }
      if (sum > cutoff * full) return Infinity;
    }
    return n === 0 ? Infinity : sum / n;
  };
  /* 一轮 PatchMatch：16 列一带，带内传播＋指数缩小的乱数搜寻（inpaint.rs:209） */
  S.patchmatch = (nnf, cost, pass, seed, radius) => {
    const BAND = 16, reverse = pass % 2 === 1, step = reverse ? -1 : 1;
    for (let bi = 0; bi * BAND < h; bi++){
      const rng = rngOf((seed ^ Math.imul(bi, 0x4F6CDD1D) ^ Math.imul(pass, 0x2545F491)) >>> 0);
      const y0 = bi * BAND, rows = Math.min(BAND, h - y0);
      for (let ry = 0; ry < rows; ry++){
        const ly = reverse ? rows - 1 - ry : ry, y = y0 + ly;
        for (let rx = 0; rx < w; rx++){
          const x = reverse ? w - 1 - rx : rx, i = y * w + x;
          if (!targets[i]) continue;
          let bx = nnf[i * 2], by = nnf[i * 2 + 1], bc = cost[i];
          const nx = x - step;
          if (nx >= 0 && nx < w){
            const j = y * w + nx, cx = nnf[j * 2] + step, cy = nnf[j * 2 + 1];
            if (S.isValid(cx, cy) && (cx !== bx || cy !== by)){ const d = S.dist(x, y, cx, cy, bc); if (d < bc){ bx = cx; by = cy; bc = d; } }
          }
          const nly = ly - step;
          if (nly >= 0 && nly < rows){
            const j = (y0 + nly) * w + x, cx = nnf[j * 2], cy = nnf[j * 2 + 1] + step;
            if (S.isValid(cx, cy) && (cx !== bx || cy !== by)){ const d = S.dist(x, y, cx, cy, bc); if (d < bc){ bx = cx; by = cy; bc = d; } }
          }
          for (let rad = radius; rad >= 1; rad = rad >> 1){
            const cx = bx + rng.range(-rad, rad), cy = by + rng.range(-rad, rad);
            if (S.isValid(cx, cy) && (cx !== bx || cy !== by)){ const d = S.dist(x, y, cx, cy, bc); if (d < bc){ bx = cx; by = cy; bc = d; } }
          }
          nnf[i * 2] = bx; nnf[i * 2 + 1] = by; cost[i] = bc;
        }
      }
    }
  };
  /* 投票：洞里每格＝盖到它的所有匹配补丁按相似度加权平均（σ² 取匹配代价的第 75 百分位，inpaint.rs:281） */
  S.vote = (nnf, cost) => {
    const cs = [];
    for (let i = 0; i < w * h; i++) if (targets[i] && isFinite(cost[i])) cs.push(cost[i]);
    let sigma2 = 1;
    if (cs.length){ cs.sort((a, b) => a - b); sigma2 = Math.max(cs[Math.min((cs.length * 3 / 4) | 0, cs.length - 1)], 1e-6); }
    const upd = [], acc = new Float64Array(ch);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      if (!hole[y * w + x]) continue;
      acc.fill(0); let wsum = 0;
      for (let dy = -r; dy <= r; dy++){
        const ty = y + dy; if (ty < 0 || ty >= h) continue;
        for (let dx = -r; dx <= r; dx++){
          const tx = x + dx; if (tx < 0 || tx >= w) continue;
          const ti = ty * w + tx;
          if (!targets[ti] || !isFinite(cost[ti])) continue;
          const sx = nnf[ti * 2] - dx, sy = nnf[ti * 2 + 1] - dy;
          const wt = Math.max(Math.exp(-cost[ti] / (2 * sigma2)), 1e-8), si = (sy * w + sx) * ch;
          for (let c = 0; c < ch; c++) acc[c] += img[si + c] * wt;
          wsum += wt;
        }
      }
      if (wsum > 0){ const o = (y * w + x) * ch; const vals = new Float32Array(ch); for (let c = 0; c < ch; c++) vals[c] = acc[c] / wsum; upd.push(o, vals); }
    }
    for (let k = 0; k < upd.length; k += 2) img.set(upd[k + 1], upd[k]);
  };
  /* 赢家全拿：洞里每格＝盖到它的补丁中代价最低者的对应像素（同代价取先看到的；没有可用补丁就留着投票的值） */
  S.voteBest = (nnf, cost) => {
    const out = Float32Array.from(img);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      if (!hole[y * w + x]) continue;
      let best = Infinity, bs = -1;
      for (let dy = -r; dy <= r; dy++){
        const ty = y + dy; if (ty < 0 || ty >= h) continue;
        for (let dx = -r; dx <= r; dx++){
          const tx = x + dx; if (tx < 0 || tx >= w) continue;
          const ti = ty * w + tx;
          if (!targets[ti] || !(cost[ti] < best)) continue;
          const sx = nnf[ti * 2] - dx, sy = nnf[ti * 2 + 1] - dy;
          if (sx < 0 || sy < 0 || sx >= w || sy >= h || hole[sy * w + sx]) continue;
          best = cost[ti]; bs = sy * w + sx;
        }
      }
      if (bs >= 0) for (let c = 0; c < ch; c++) out[(y * w + x) * ch + c] = img[bs * ch + c];
    }
    img.set(out);
  };
  return S;
}
/* inpaint.rs:351 complete：影像金字塔由粗到细，最粗一层用膜插值当初值；每层 EM（PatchMatch → 投票）。没有完整已知补丁可抄回 null。
   跟原码不同的三处（针对去除文字：细长的字形洞原码会糊成一片）：层数看洞的厚度、细层先用放大的对应场投票当初值、最细层最后赢家全拿 */
function complete(w, h, ch, img, hole, seed){
  const bb = holeBbox(w, h, hole); if (!bb) return Float32Array.from(img);
  const r = Math.max(CP.patchRadius, 1), psz = 2 * r + 1;
  const levels = [{w, h, img:Float32Array.from(img), hole:Uint8Array.from(hole)}];
  let ext = Math.max(bb[2] - bb[0], bb[3] - bb[1]);
  const exts = [ext];
  /* 金字塔要几层：原码看洞的外框（ext ≤ 2·补丁宽才停）。去字这种「细长、很多笔画」的洞外框很大、本身却很薄 ⇒
     缩到 1/32，笔画之间的好像素全被「任一子格是洞就算洞」吞掉、整条字框变成一个大洞，粗层只能糊一片、细层又照着糊的抄。
     改看洞的厚度（洞里离最近已知像素的最远距离，距离变换）：厚度 ≤ 补丁宽就不用再缩；块状的洞厚度≈外框一半，层数跟原码差不多 */
  let thick = 0;
  { const known = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) known[i] = hole[i] ? 0 : 1;
    const d = edt(known, w, h); for (let i = 0; i < w * h; i++) if (hole[i] && d[i] > thick) thick = d[i]; }
  for (;;){
    const l = levels[levels.length - 1];
    if (ext <= 2 * psz || thick <= psz || (l.w >> 1) < 3 * psz || (l.h >> 1) < 3 * psz) break;
    levels.push(downsample(l, ch)); ext = Math.ceil(ext / 2); exts.push(ext); thick = thick / 2 + 0.5;
  }
  const nlev = levels.length;
  let nnf = null, prev = null;
  for (let li = nlev - 1; li >= 0; li--){
    const lw = levels[li].w, lh = levels[li].h, lhole = levels[li].hole;
    let limg = Float32Array.from(levels[li].img);
    if (!prev) limg = membraneFill(lw, lh, ch, limg, lhole);
    else {
      for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) if (lhole[y * lw + x]){
        const sx = Math.min(x >> 1, prev.w - 1), sy = Math.min(y >> 1, prev.h - 1), d = (y * lw + x) * ch, s = (sy * prev.w + sx) * ch;
        for (let c = 0; c < ch; c++) limg[d + c] = prev.img[s + c];
      }
    }
    const hs = integral(lw, lh, lhole);
    const valid = new Uint8Array(lw * lh), validList = [], targets = new Uint8Array(lw * lh);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++){
      const cnt = windowCount(hs, lw, lh, x - r, y - r, x + r + 1, y + r + 1);
      const inside = x >= r && y >= r && x + r < lw && y + r < lh, i = y * lw + x;
      if (inside && cnt === 0){ valid[i] = 1; validList.push(x, y); }
      targets[i] = cnt > 0 ? 1 : 0;
    }
    if (!validList.length){
      if (li === 0) return null;
      prev = {w:lw, h:lh, img:limg}; nnf = null; continue;
    }
    const S = makeSolver(lw, lh, ch, r, limg, lhole, valid, validList, targets);
    const rng = rngOf((seed ^ (li << 20)) >>> 0);
    const nv = validList.length / 2, newNnf = new Int32Array(lw * lh * 2);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++){
      const i = y * lw + x; if (!targets[i]) continue;
      let cx = null, cy = null;
      if (nnf && prev){
        const pi = (y >> 1) * prev.w + (x >> 1);
        if (pi * 2 + 1 < nnf.length){ const ax = nnf[pi * 2] * 2 + (x % 2), ay = nnf[pi * 2 + 1] * 2 + (y % 2); if (S.isValid(ax, ay)){ cx = ax; cy = ay; } }
      }
      if (cx === null){ const k = rng.next() % nv; cx = validList[k * 2]; cy = validList[k * 2 + 1]; }
      newNnf[i * 2] = cx; newNnf[i * 2 + 1] = cy;
    }
    nnf = newNnf;
    /* 细一层的起始猜测：原码把粗层的「图」放大当初值（糊的）⇒ 这层的 PatchMatch 会偏去找一样平滑的来源、毛／颗粒都不见（一块块平平的）。
       照 Wexler 2007：用放大后的对应场（NNF）在这一层的真像素上先投一次票当初值 ⇒ 高频纹理一开始就在 */
    if (prev){
      const c0 = new Float32Array(lw * lh).fill(Infinity);
      for (let i = 0; i < lw * lh; i++) if (targets[i]) c0[i] = S.dist(i % lw, (i / lw) | 0, nnf[i * 2], nnf[i * 2 + 1], Infinity);
      S.vote(nnf, c0);
    }
    const refineOnly = li + 1 < nlev && exts[li] > CP.refineExtent;
    const em = li + 1 === nlev ? CP.emIters : refineOnly ? 1 : Math.max(CP.emIters >> (nlev - 1 - li), CP.minEmIters);
    const pmIters = refineOnly ? 1 : CP.pmIters, fullSearch = Math.max(lw, lh);
    const cost = new Float32Array(lw * lh).fill(Infinity);
    for (let it = 0; it < em; it++){
      for (let i = 0; i < lw * lh; i++) if (targets[i]) cost[i] = S.dist(i % lw, (i / lw) | 0, nnf[i * 2], nnf[i * 2 + 1], Infinity);
      const radius = refineOnly ? 2 : (li + 1 === nlev || it === 0) ? fullSearch : Math.min(4 * psz, fullSearch);
      for (let pass = 0; pass < pmIters; pass++) S.patchmatch(nnf, cost, pass + it * pmIters, (seed + li * 1000 + it) >>> 0, radius);
      S.vote(nnf, cost);
    }
    /* 最细那层最后一步：加权平均投票会把颗粒、毛边磨平（填进去的地方比四周「干净」一截，一看就是补过的）。
       改成「赢家全拿」：洞里每格取盖到它的补丁里代价最低那一块的对应像素 ⇒ 照抄真的纹理、颗粒，补丁彼此对齐的地方没有接缝 */
    if (li === 0 && em > 0){
      for (let i = 0; i < lw * lh; i++) if (targets[i]) cost[i] = S.dist(i % lw, (i / lw) | 0, nnf[i * 2], nnf[i * 2 + 1], Infinity);
      for (let pass = 0; pass < pmIters; pass++) S.patchmatch(nnf, cost, pass + em * pmIters, (seed + 7777) >>> 0, Math.min(4 * psz, fullSearch));
      S.voteBest(nnf, cost);
    }
    prev = {w:lw, h:lh, img:limg};
  }
  return prev ? prev.img : null;
}
/* content_aware.rs:44 rotation_level／55 color_level */
function rotationLevel(l){ return l === 'low' ? [-10, 10] : l === 'medium' ? [-20, 20] : l === 'high' ? [-35, 35] : l === 'full' ? [90, 180, 270] : []; }
function colorLevel(l){ return l === 'none' ? 0 : l === 'high' ? 0.65 : l === 'veryHigh' ? 0.9 : 0.35; }
/* content_aware.rs:83 sample／106 variant：取样窗旋转、缩放、镜像的副本 */
function sampleSrc(src, x, y, out){
  const {w, h, ch, img, ok} = src;
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return false;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1), tx = x - x0, ty = y - y0;
  if (!ok[y0 * w + x0] || !ok[y0 * w + x1] || !ok[y1 * w + x0] || !ok[y1 * w + x1]) return false;
  for (let c = 0; c < ch; c++){
    const p = (xx, yy) => img[(yy * w + xx) * ch + c];
    const top = p(x0, y0) + (p(x1, y0) - p(x0, y0)) * tx, bot = p(x0, y1) + (p(x1, y1) - p(x0, y1)) * tx;
    out[c] = top + (bot - top) * ty;
  }
  return true;
}
function variant(src, deg, scale, mirror){
  const {w, h, ch} = src, a = -deg * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
  const fw = w * scale, fh = h * scale;
  const ow = Math.max(Math.round(fw * Math.abs(c) + fh * Math.abs(s)), 1), oh = Math.max(Math.round(fw * Math.abs(s) + fh * Math.abs(c)), 1);
  const icx = (w - 1) / 2, icy = (h - 1) / 2, ocx = (ow - 1) / 2, ocy = (oh - 1) / 2;
  const out = {w:ow, h:oh, img:new Float32Array(ow * oh * ch), ok:new Uint8Array(ow * oh)}, px = new Float32Array(ch);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++){
    const dx = (x - ocx) / scale, dy = (y - ocy) / scale;
    let sx = icx + dx * c - dy * s; const sy = icy + dx * s + dy * c;
    if (mirror) sx = (w - 1) - sx;
    if (sampleSrc(src, sx, sy, px)){ const i = y * ow + x; out.ok[i] = 1; out.img.set(px, i * ch); }
  }
  return out;
}
function boxBlur(w, h, ch, v, r){                              // content_aware.rs:136
  if (r === 0) return Float32Array.from(v);
  const pass = (src, horizontal) => {
    const dst = new Float32Array(src.length), n = horizontal ? h : w, m = horizontal ? w : h, norm = 1 / (2 * r + 1);
    const idx = (line, k) => horizontal ? line * w + k : k * w + line;
    for (let line = 0; line < n; line++) for (let c = 0; c < ch; c++){
      const at = k => src[idx(line, clamp(k, 0, m - 1)) * ch + c];
      let acc = 0; for (let k = -r; k <= r; k++) acc += at(k);
      for (let k = 0; k < m; k++){ dst[idx(line, k) * ch + c] = acc * norm; acc += at(k + r + 1) - at(k - r); }
    }
    return dst;
  };
  return pass(pass(v, true), false);
}
function adaptColors(w, h, ch, img, hole, out, k){             // content_aware.rs:233
  const b = holeBbox(w, h, hole); if (!b) return;
  const r = clamp(Math.floor(Math.max(b[2] - b[0], b[3] - b[1]) / 6), 1, 32);
  const membrane = membraneFill(w, h, ch, img, hole), low = boxBlur(w, h, ch, out, r);
  for (let i = 0; i < w * h; i++) if (hole[i]) for (let c = 0; c < ch; c++){ const j = i * ch + c; out[j] = c01(out[j] + k * (membrane[j] - low[j])); }
}
/* content_aware.rs:163 fill：洞只从 source 允许、且不在洞里的格子抄；变体排在右边一栏（中间隔开比补丁还宽的未知带） */
function caFill(w, h, ch, img, hole, source, opts){
  if (!hole.some(v => v)) return Float32Array.from(img);
  const gap = 2 * CP.patchRadius + 2;
  const ok = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) ok[i] = !hole[i] && source[i] ? 1 : 0;
  const src = {w, h, ch, img, ok}, extra = [];
  if (opts.mirror) extra.push(variant(src, 0, 1, true));
  for (const d of opts.rotations) extra.push(variant(src, d, 1, false));
  if (opts.scale){ extra.push(variant(src, 0, 0.8, false)); extra.push(variant(src, 0, 1.25, false)); }
  const colW = extra.reduce((m, v) => Math.max(m, v.w), 0), colH = extra.reduce((s, v) => s + v.h + gap, 0);
  const mw = extra.length ? w + gap + colW : w, mh = Math.max(h, colH);
  const mimg = new Float32Array(mw * mh * ch), unknown = new Uint8Array(mw * mh).fill(1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const s = y * w + x, d = y * mw + x; mimg.set(img.subarray(s * ch, s * ch + ch), d * ch); unknown[d] = ok[s] ? 0 : 1; }
  let oy = 0;
  for (const v of extra){
    for (let y = 0; y < v.h; y++) for (let x = 0; x < v.w; x++){ const s = y * v.w + x, d = (oy + y) * mw + w + gap + x; mimg.set(v.img.subarray(s * ch, s * ch + ch), d * ch); unknown[d] = v.ok[s] ? 0 : 1; }
    oy += v.h + gap;
  }
  const filled = complete(mw, mh, ch, mimg, unknown, opts.seed >>> 0);
  let out = Float32Array.from(img);
  if (filled){
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (hole[y * w + x]){ const s = (y * mw + x) * ch, d = (y * w + x) * ch; for (let c = 0; c < ch; c++) out[d + c] = filled[s + c]; }
  } else out = membraneFill(w, h, ch, img, hole);
  if (opts.colorAdaptation > 0) adaptColors(w, h, ch, img, hole, out, opts.colorAdaptation);
  return out;
}
PE._algo = {complete, membraneFill, caFill, edt, expand, contract, composite4, blendRgb, modeFrom};

/* edit_menu_cmds.rs:312 content_aware_fill */
function cafCmd(p){
  const cmd = 'edit.contentAwareFill';
  const pl = editablePixels(p); if (pl.error) return fail(pl.error);
  const L = pl.L;
  if (!Doc.sel) return fail('make a selection around what to remove');
  const hb = Rc.inter(selRect(), docRect());
  if (!hb) return fail(cmd + ': the selection is outside the canvas');
  const ext = Math.max(Rc.w(hb), Rc.h(hb));
  const sampling = typeof p.sampling === 'string' ? p.sampling : 'auto';
  let custom = null;
  if (Array.isArray(p.area) && p.area.length >= 4){ const n = p.area.map(v => Math.round(Number(v) || 0)); custom = [n[0], n[1], n[0] + Math.max(n[2], 0), n[1] + Math.max(n[3], 0)]; }
  let win;
  if (sampling === 'auto') win = Rc.inflate(hb, Math.max(Math.floor(ext * 3 / 4), 32));
  else if (sampling === 'rectangular') win = Rc.inflate(hb, isNum(p.margin) ? clamp(Math.round(p.margin), 0, 100000) : Math.max(ext, 16));
  else if (sampling === 'custom'){ if (!custom) return fail(cmd + ': custom sampling needs `area` [x,y,w,h]（我们没有 Alpha 通道，`channel` 不收）'); win = Rc.inflate(Rc.union(custom, hb), 4); }
  else return fail(`${cmd}: unknown sampling \`${sampling}\` (auto|rectangular|custom)`);
  win = Rc.inter(win, docRect());
  const ca = typeof p.colorAdaptation === 'boolean' ? (p.colorAdaptation ? 'default' : 'none') : (typeof p.colorAdaptation === 'string' ? p.colorAdaptation : 'default');
  const opts = {colorAdaptation:colorLevel(ca), rotations:rotationLevel(typeof p.rotationAdaptation === 'string' ? p.rotationAdaptation : 'none'),
                scale:p.scale === true, mirror:p.mirror === true, seed:isNum(p.seed) ? p.seed : 1};
  const output = typeof p.output === 'string' ? p.output : 'current';
  if (!['current', 'new', 'duplicate'].includes(output)) return fail(cmd + ': `output` must be current|new|duplicate');
  const w = Rc.w(win), h = Rc.h(win), DW = Doc.width, selB = selBytes();
  const img = toF(readLayer(L, win));
  const cover = new Float32Array(w * h), hole = new Uint8Array(w * h), source = new Uint8Array(w * h).fill(1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const X = win[0] + x, Y = win[1] + y, i = y * w + x;
    cover[i] = selB[Y * DW + X] / 255; hole[i] = cover[i] > 0 ? 1 : 0;
    if (sampling === 'custom') source[i] = (X >= custom[0] && Y >= custom[1] && X < custom[2] && Y < custom[3]) ? 1 : 0;
  }
  const filled = caFill(w, h, 4, img, hole, source, opts);
  let nHole = 0; for (let i = 0; i < w * h; i++) if (hole[i]) nHole++;
  let target = L;
  if (output === 'new'){
    const N = Layer.raster(nextLayerName('Content-Aware Fill'));
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) if (hole[i]){ px[i * 4] = filled[i * 4] * 255; px[i * 4 + 1] = filled[i * 4 + 1] * 255; px[i * 4 + 2] = filled[i * 4 + 2] * 255; px[i * 4 + 3] = filled[i * 4 + 3] * cover[i] * 255; }
    writeLayer(N, win, px);
    Doc.add(N, Doc.index(L.id) + 1);
    return {ok:true, layer:N.id, filled:nHole, window:[win[0], win[1], w, h]};
  }
  if (output === 'duplicate'){
    const r = CMD.map['layer.duplicate'].run({id:L.id});
    target = Doc.byId(r.id); target.name = L.name + ' copy';
  }
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 4; c++){ const j = i * 4 + c, k = cover[i]; px[j] = (img[j] + (filled[j] - img[j]) * k) * 255; }
  writeLayer(target, win, px);
  return {ok:true, layer:target.id, filled:nHole, window:[win[0], win[1], w, h]};
}
CMD.reg('ps.edit.contentAwareFill', {i18n:'', undoable:true,
  params:'{sampling:"auto|rectangular|custom"="auto", margin?:px（rectangular）, area?:[x,y,w,h]（custom）, colorAdaptation:"default|none|high|veryHigh"="default", '
       + 'rotationAdaptation:"none|low|medium|high|full"="none", scale:bool=false, mirror:bool=false, output:"current|new|duplicate"="current", seed=1, layerId?} '
       + '内容识别填充：用选区四周的纹理把选区补起来（PatchMatch＋EM，照 algo/inpaint.rs）；要有选区 → {layer, filled 洞的格数, window:[x,y,w,h]}'}, cafCmd);

/* ═══════════ 内容识别缩放（algo/src/seam.rs 接缝裁剪 ＋ edit_menu_cmds.rs:429 content_aware_scale） ═══════════ */
const PROTECT_ENERGY = 1e4;
function seamEnergy(w, h, ch, img){                            // seam.rs:20：|∂x|+|∂y|（前后差都算）
  const e = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const xl = Math.max(x - 1, 0), xr = Math.min(x + 1, w - 1), yu = Math.max(y - 1, 0), yd = Math.min(y + 1, h - 1);
    let s = 0;
    for (let c = 0; c < ch; c++){
      const v = img[(y * w + x) * ch + c];
      s += Math.abs(img[(y * w + xr) * ch + c] - v) + Math.abs(v - img[(y * w + xl) * ch + c]);
      s += Math.abs(img[(yd * w + x) * ch + c] - v) + Math.abs(v - img[(yu * w + x) * ch + c]);
    }
    e[y * w + x] = s * 0.5;
  }
  return e;
}
function findSeam(w, h, e){                                    // seam.rs:40 动态规划找能量最低的直缝
  let cost = Float32Array.from(e.subarray(0, w)), next = new Float32Array(w);
  const from = new Uint8Array(w * h);
  for (let y = 1; y < h; y++){
    for (let x = 0; x < w; x++){
      let bv = cost[x], bf = 1;
      if (x > 0 && cost[x - 1] < bv){ bv = cost[x - 1]; bf = 0; }
      if (x + 1 < w && cost[x + 1] < bv){ bv = cost[x + 1]; bf = 2; }
      next[x] = bv + e[y * w + x]; from[y * w + x] = bf;
    }
    const t = cost; cost = next; next = t;
  }
  let x = 0; for (let i = 1; i < w; i++) if (cost[i] < cost[x]) x = i;
  const seam = new Int32Array(h);
  for (let y = h - 1; y >= 0; y--){ seam[y] = x; if (y > 0){ const f = from[y * w + x]; x = f === 0 ? x - 1 : f === 2 ? x + 1 : x; } }
  return seam;
}
function removeSeam(w, h, ch, img, seam){
  const out = new Float32Array((w - 1) * h * ch);
  let o = 0;
  for (let y = 0; y < h; y++){ const row = y * w * ch, sx = seam[y]; out.set(img.subarray(row, row + sx * ch), o); o += sx * ch; out.set(img.subarray(row + (sx + 1) * ch, row + w * ch), o); o += (w - sx - 1) * ch; }
  return out;
}
function transposeBuf(w, h, ch, img){ const out = new Float32Array(img.length); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const s = (y * w + x) * ch, d = (x * h + y) * ch; for (let c = 0; c < ch; c++) out[d + c] = img[s + c]; } return out; }
function carveWidth(w, h, ch, img, protect, newW){             // seam.rs:99
  newW = Math.max(newW, 1);
  if (newW === w || !w || !h) return Float32Array.from(img);
  const addP = (e, p) => { if (p) for (let i = 0; i < e.length; i++) e[i] += c01(p[i]) * PROTECT_ENERGY; };
  if (newW < w){
    let cur = img, cw = w, prot = protect;
    while (cw > newW){
      const e = seamEnergy(cw, h, ch, cur); addP(e, prot);
      const seam = findSeam(cw, h, e);
      cur = removeSeam(cw, h, ch, cur, seam); if (prot) prot = removeSeam(cw, h, 1, prot, seam);
      cw--;
    }
    return cur;
  }
  // 放大：每轮最多加现宽的一半，在缩小的副本上找 k 条最低的缝、映回原栏，把那几栏各复制一份（跟右邻平均）
  let cur = img, cw = w, prot = protect;
  while (cw < newW){
    const k = Math.min(newW - cw, Math.max(cw >> 1, 1));
    const idx = Array.from({length:h}, () => Array.from({length:cw}, (_, i) => i)), dup = Array.from({length:h}, () => []);
    let tmp = cur, tw = cw, tprot = prot;
    for (let n = 0; n < k; n++){
      if (tw <= 1) break;
      const e = seamEnergy(tw, h, ch, tmp); addP(e, tprot);
      const seam = findSeam(tw, h, e);
      for (let y = 0; y < h; y++) dup[y].push(idx[y].splice(seam[y], 1)[0]);
      tmp = removeSeam(tw, h, ch, tmp, seam); if (tprot) tprot = removeSeam(tw, h, 1, tprot, seam);
      tw--;
    }
    const added = dup[0].length; if (!added) break;
    const nw = cw + added, out = new Float32Array(nw * h * ch), np = prot ? new Float32Array(nw * h) : null;
    let o = 0, po = 0;
    for (let y = 0; y < h; y++){
      const d = dup[y].sort((a, b) => a - b), row = y * cw * ch;
      let di = 0;
      for (let x = 0; x < cw; x++){
        for (let c = 0; c < ch; c++) out[o++] = cur[row + x * ch + c];
        if (np) np[po++] = prot[y * cw + x];
        while (di < d.length && d[di] === x){
          const xr = Math.min(x + 1, cw - 1);
          for (let c = 0; c < ch; c++) out[o++] = (cur[row + x * ch + c] + cur[row + xr * ch + c]) * 0.5;
          if (np) np[po++] = prot[y * cw + x];
          di++;
        }
      }
    }
    cur = out; prot = np; cw = nw;
  }
  return cur;
}
function resizeBilinear(w, h, ch, img, nw, nh){                // seam.rs:198
  const out = new Float32Array(nw * nh * ch);
  if (!w || !h) return out;
  for (let y = 0; y < nh; y++){
    const fy = clamp((y + 0.5) * h / nh - 0.5, 0, h - 1), y0 = Math.floor(fy), ty = fy - y0, y1 = Math.min(y0 + 1, h - 1);
    for (let x = 0; x < nw; x++){
      const fx = clamp((x + 0.5) * w / nw - 0.5, 0, w - 1), x0 = Math.floor(fx), tx = fx - x0, x1 = Math.min(x0 + 1, w - 1);
      for (let c = 0; c < ch; c++){
        const p = (xx, yy) => img[(yy * w + xx) * ch + c];
        const top = p(x0, y0) + (p(x1, y0) - p(x0, y0)) * tx, bot = p(x0, y1) + (p(x1, y1) - p(x0, y1)) * tx;
        out[(y * nw + x) * ch + c] = top + (bot - top) * ty;
      }
    }
  }
  return out;
}
function carve(w, h, ch, img, protect, nw, nh){                // seam.rs:184：先宽、再转置做高
  nw = Math.max(nw, 1); nh = Math.max(nh, 1);
  const wide = carveWidth(w, h, ch, img, protect, nw);
  if (nh === h) return wide;
  const protT = protect ? transposeBuf(nw, h, 1, resizeBilinear(w, h, 1, protect, nw, h)) : null;
  const tall = carveWidth(h, nw, ch, transposeBuf(nw, h, ch, wide), protT, nh);
  return transposeBuf(nh, nw, ch, tall);
}
function skinMask(w, h, ch, img){                              // seam.rs:224（Kovač 等 2003 的 RGB 规则）
  const m = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++){
    const r = img[i * ch] * 255, g = img[i * ch + 1] * 255, b = img[i * ch + 2] * 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (r > 95 && g > 40 && b > 20 && mx - mn > 15 && Math.abs(r - g) > 15 && r > g && r > b) m[i] = 1;
  }
  return m;
}
function cascaleCmd(p){
  const cmd = 'edit.contentAwareScale';
  const pl = editablePixels(p); if (pl.error) return fail(pl.error);
  const L = pl.L;
  const region = Doc.sel ? Rc.inter(selRect(), docRect()) : contentRect(L);
  if (!region) return fail('nothing to scale: the layer is empty');
  const w = Rc.w(region), h = Rc.h(region);
  const dim = (k, pct, cur) => {
    const v = isNum(p[k]) ? p[k] : isNum(p[pct]) ? cur * p[pct] / 100 : cur;
    return (v >= 1 && v <= 60000) ? Math.round(v) : null;
  };
  const nw = dim('width', 'scaleX', w), nh = dim('height', 'scaleY', h);
  if (nw === null) return fail(cmd + ': `width` must be 1..60000 px');
  if (nh === null) return fail(cmd + ': `height` must be 1..60000 px');
  const amount = clamp(isNum(p.amount) ? p.amount : 100, 0, 100) / 100;
  if (p.protect !== undefined && p.protect !== null && p.protect !== 'none') return fail(cmd + ': `protect` must be "none"（我们没有 Alpha 通道）');
  const img = toF(readLayer(L, region));
  const protect = p.protectSkinTones === true ? skinMask(w, h, 4, img) : null;
  const carved = amount > 0 ? carve(w, h, 4, img, protect, nw, nh) : null;
  const plain = amount < 1 ? resizeBilinear(w, h, 4, img, nw, nh) : null;
  let out = carved || plain;
  if (carved && plain){ out = new Float32Array(carved.length); for (let i = 0; i < out.length; i++) out[i] = plain[i] + (carved[i] - plain[i]) * amount; }
  // 清掉原区域、写回 (x0,y0) 起 nw×nh
  const old = readLayer(L, region); old.fill(0); writeLayer(L, region, old);
  const px = new Uint8ClampedArray(nw * nh * 4); for (let i = 0; i < px.length; i++) px[i] = out[i] * 255;
  const dst = [region[0], region[1], region[0] + nw, region[1] + nh];
  writeLayer(L, dst, px);
  return {ok:true, from:[w, h], to:[nw, nh], bounds:[dst[0], dst[1], nw, nh]};
}
CMD.reg('ps.edit.contentAwareScale', {i18n:'', undoable:true,
  params:'{width?:px, height?:px（或 scaleX／scaleY:1..400 %）, amount:0..100=100（0＝普通双线性缩放）, protectSkinTones:bool=false, layerId?} '
       + '内容识别缩放：选区（没选区＝该层内容外框）用接缝裁剪改成新尺寸，左上角不动（algo/seam.rs）→ {from, to, bounds}'}, cascaleCmd);
function openCascaleDialog(){
  const pl = pixelLayer({}); if (pl.error) return fail(pl.error);
  const region = Doc.sel ? Rc.inter(selRect(), docRect()) : contentRect(pl.L);
  if (!region) return fail('nothing to scale: the layer is empty');
  return Dlg.open({cmd:'ps.edit.contentAwareScale', title:T('pse.cascale'),
    rows:[
      {k:'width', label:T('pse.w'), type:'number', value:Rc.w(region), min:1, suffix:'px'},
      {k:'height', label:T('pse.h'), type:'number', value:Rc.h(region), min:1, suffix:'px'},
      {k:'amount', label:T('pse.amount'), type:'number', value:100, min:0, max:100, suffix:'%'},
      {k:'protectSkinTones', label:'', type:'check', text:T('pse.protectSkin'), value:false},
    ],
    ok(val){ return runCmd('ps.edit.contentAwareScale', {width:val.width, height:val.height, amount:isFinite(val.amount) ? val.amount : 100, protectSkinTones:val.protectSkinTones}); }});
}
CMD.reg('ps.edit.contentAwareScale.dialog', {i18n:'', params:'{} 开「内容识别缩放」对话框（宽高预填选区／内容外框；Ctrl+Alt+Shift+C）；确定＝跑 ps.edit.contentAwareScale'}, () => openCascaleDialog());
PE._algo2 = {carve, findSeam, seamEnergy};

/* ═══════════ 预设管理器／导出导入预设（edit_menu_cmds.rs:711-861） ═══════════ */
const PRESET_KINDS = ['brushes', 'customShapes', 'patterns'];
function presetNames(kind){
  if (kind === 'brushes') return BrushPresets.list().map(b => b.name);
  if (kind === 'customShapes') return [];                      // 我们没有自定形状库（定义自定形状没做）
  if (kind === 'patterns') return Patterns.load().map(q => q.name);
  return null;
}
function presetManager(p){
  const cmd = 'edit.presets.presetManager', action = typeof p.action === 'string' ? p.action : 'list';
  if (action === 'list'){
    const kinds = typeof p.kind === 'string' ? [p.kind] : PRESET_KINDS, out = {ok:true};
    for (const k of kinds){ const n = presetNames(k); if (!n) return fail(`${cmd}: unknown preset kind \`${k}\``); out[k] = n; }
    return out;
  }
  const kind = p.kind; const names = presetNames(kind);
  if (!names) return fail(`${cmd}: unknown preset kind \`${kind}\` (${PRESET_KINDS.join('|')})`);
  let i;
  if (Number.isInteger(p.index)){ if (p.index < 0 || p.index >= names.length) return fail(`${cmd}: no preset ${p.index}`); i = p.index; }
  else if (typeof p.name === 'string'){ i = names.indexOf(p.name); if (i < 0) return fail(`${cmd}: no preset named \`${p.name}\``); }
  else return fail(`${cmd}: give \`index\` or \`name\``);
  const list = kind === 'brushes' ? BrushPresets.list() : Patterns.load();
  if (action === 'rename'){
    const nn = typeof p.newName === 'string' ? p.newName.trim() : '';
    if (!nn) return fail(cmd + ': missing `newName`');
    list[i].name = nn;
  } else if (action === 'delete') list.splice(i, 1);
  else if (action === 'move'){
    if (!Number.isInteger(p.to)) return fail(cmd + ': missing `to`');
    const [x] = list.splice(i, 1); list.splice(Math.min(Math.max(p.to, 0), list.length), 0, x);
  } else return fail(`${cmd}: unknown action \`${action}\` (list|rename|delete|move)`);
  if (kind === 'brushes') BrushPresets.save(list); else Patterns.save();
  return {ok:true, [kind]:presetNames(kind)};
}
CMD.reg('ps.edit.presets.presetManager', {i18n:'',
  params:'{action:"list|rename|delete|move"="list", kind:"brushes|customShapes|patterns", index?|name?, newName?, to?, dialog?:true＝开预设管理器} 预设管理器：管图案库与「定义画笔预设」存的笔尖（存进浏览器）'},
  p => p.dialog ? openPresetDialog() : presetManager(p));
const PRESET_FORMAT = 'dilin-presets', PRESET_FORMAT_OLD = 'photocraft-presets';   // 旧档照收
function exportImport(p){
  const cmd = 'edit.presets.exportImportPresets';
  const kinds = Array.isArray(p.kinds) ? p.kinds : ['brushes', 'customShapes'];
  const want = k => kinds.includes(k);
  const action = typeof p.action === 'string' ? p.action : 'export';
  if (action === 'export'){
    const data = {format:PRESET_FORMAT, version:1, brushes:want('brushes') ? BrushPresets.list() : [], customShapes:[]};
    return {ok:true, data, brushes:data.brushes.length, customShapes:0};
  }
  if (action === 'import'){
    let data = p.data;
    if (data === undefined) return fail(cmd + ': missing `data` (an exported preset file)');
    if (typeof data === 'string'){ try { data = JSON.parse(data); } catch(e){ return fail(`${cmd}: not a preset file: ${e.message}`); } }
    if (!data || data.format !== PRESET_FORMAT && data.format !== PRESET_FORMAT_OLD) return fail(`${cmd}: not a preset file (format \`${data && data.format}\`)`);
    let nb = 0;
    if (want('brushes')) for (const b of (data.brushes || [])){ if (b && typeof b.name === 'string' && typeof b.tip === 'string'){ BrushPresets.put(b); nb++; } }
    return {ok:true, brushes:nb, customShapes:0};
  }
  return fail(`${cmd}: unknown action \`${action}\` (export|import)`);
}
CMD.reg('ps.edit.presets.exportImportPresets', {i18n:'',
  params:'{action:"export|import"="export", kinds?:["brushes","customShapes"], data?:匯出的 JSON（import）, dialog?:true＝开对话框（导出＝下载 .pcpresets、导入＝挑档）} 导出／导入预设（格式同 PhotoCraft .pcpresets）'},
  p => p.dialog ? openPresetsIODialog() : exportImport(p));
function openPresetDialog(){
  let kind = 'patterns';
  return Dlg.open({cmd:'ps.edit.presets.presetManager', title:T('pse.presetManager'),
    rows:[
      {k:'kind', label:T('pse.presetType'), type:'select', value:kind, options:[['patterns', T('pse.pk.patterns')], ['brushes', T('pse.pk.brushes')]]},
      {k:'newName', label:T('pse.newName'), type:'text', value:''},
    ],
    build(body, addRow, f, rows){
      const row = div('pse-row'), lb = document.createElement('span'); lb.className = 'lb'; lb.textContent = T('pse.presets'); row.appendChild(lb);
      const sel = document.createElement('select'); sel.size = 8; sel.dataset.k = 'index'; sel.style.minWidth = '220px'; row.appendChild(sel); body.insertBefore(row, body.children[1]); f.index = sel;
      PE._presetFill = () => { const names = presetNames(f.kind.value) || []; const keep = sel.value; sel.innerHTML = ''; names.forEach((n, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = n; sel.appendChild(o); }); if (keep && +keep < names.length) sel.value = keep; };
      f.kind.addEventListener('change', PE._presetFill); PE._presetFill();
      sel.addEventListener('change', () => { f.newName.value = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : ''; });
    },
    extra:[
      {key:'pse.rename', act:'rename', fn:v => { const r = presetManager({action:'rename', kind:v.kind, index:+v.index, newName:v.newName}); PE._presetFill(); return r; }},
      {key:'pse.delete', act:'delete', fn:v => { const r = presetManager({action:'delete', kind:v.kind, index:+v.index}); PE._presetFill(); return r; }},
    ],
    ok(){ return {ok:true}; }});
}
function openPresetsIODialog(){
  return Dlg.open({cmd:'ps.edit.presets.exportImportPresets', title:T('pse.presetsIO'),
    rows:[{k:'action', label:T('pse.action'), type:'select', value:'export', options:[['export', T('pse.export')], ['import', T('pse.import')]]}],
    ok(val){
      if (val.action === 'export'){
        const r = exportImport({action:'export'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(r.data)], {type:'application/json'}));
        a.download = 'presets.pcpresets'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        return r;
      }
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pcpresets,application/json';
      inp.onchange = () => { const f = inp.files[0]; if (f) f.text().then(t => { const r = exportImport({action:'import', data:t}); if (r.ok === false) console.warn(r.error); }); };
      inp.click();
      return {ok:true};
    }});
}

/* ═══════════ 渐隐（edit_menu_cmds.rs:131-218） ═══════════ */
/* 原码只在「刚做完滤镜／调整／绘画／填充／描边」时可用（记下那条命令）；我们的命令表看不到别人跑了什么，
   所以改成：最后一步改到了当前像素层就能渐隐那一步（前一个历史快照 vs 现在） */
function fadeCmd(p){
  const opacity = clamp(isNum(p.opacity) ? p.opacity : 100, 0, 100) / 100;
  const mode = modeFrom(typeof p.mode === 'string' ? p.mode : 'normal');
  if (!mode || mode === 'passThrough') return fail('edit.fade: unknown blend mode');
  const pl = editablePixels(p); if (pl.error) return fail(pl.error);
  const L = pl.L, past = History.past;
  if (past.length < 2) return fail('nothing to fade');               // CMD.run 已 push 一格（＝目前），再往前一格才是「那一步之前」
  const prev = past[past.length - 2].layers.find(o => o.id === L.id);
  if (!prev || prev.kind !== 'raster') return fail('the layer did not exist before this step');
  const area = Rc.union([prev.x, prev.y, prev.x + prev.data.canvas.width, prev.y + prev.data.canvas.height], canvasRect(L));
  const before = readCanvas(prev.data.canvas, prev.x, prev.y, area), after = readLayer(L, area);
  const n = Rc.w(area) * Rc.h(area);
  for (let i = 0; i < n; i++){
    const j = i * 4;
    const b = [before[j] / 255, before[j + 1] / 255, before[j + 2] / 255, before[j + 3] / 255];
    const a = [after[j] / 255, after[j + 1] / 255, after[j + 2] / 255, after[j + 3] / 255];
    const tgt = mode === 'normal' ? a : composite4(mode, b, a, 1);
    const o = lerpPremul(b, tgt, opacity);
    after[j] = o[0] * 255; after[j + 1] = o[1] * 255; after[j + 2] = o[2] * 255; after[j + 3] = o[3] * 255;
  }
  writeLayer(L, area, after);
  return {ok:true, opacity:opacity * 100, mode:MODE_EN[mode]};
}
CMD.reg('ps.edit.fade', {i18n:'', undoable:true,
  params:'{opacity:0..100=100, mode:"normal|multiply|screen|overlay|softLight|hardLight|darken|lighten|difference|color|luminosity|…"="normal"} 渐隐：把当前像素层的上一步结果按不透明度／模式跟那一步之前混回去（Ctrl+Shift+F）'}, fadeCmd);

/* ═══════════ 清理（edit_menu_cmds.rs:231 purge） ═══════════ */
function purge(what){
  const items = [];
  if ((what === 'undo' || what === 'all') && History.past.length){ History.future.length = 0; History.past.pop(); items.push('undo'); }
  if ((what === 'clipboard' || what === 'all') && Clip){ Clip = null; items.push('clipboard'); }
  if ((what === 'histories' || what === 'all') && (History.past.length || History.future.length)){ History.clear(); items.push('histories'); }
  return {ok:true, purged:items, message:items.length ? 'purged ' + items.join(', ') : 'nothing to purge'};
}
CMD.reg('ps.edit.purge.undo', {i18n:'', params:'{} 清理 ▸ 还原：丢掉最近一步的还原点（那一步再也不能还原）与所有重做'}, () => purge('undo'));
CMD.reg('ps.edit.purge.clipboard', {i18n:'', params:'{} 清理 ▸ 剪贴板：清空 ps.edit.copy 的剪贴板'}, () => purge('clipboard'));
CMD.reg('ps.edit.purge.histories', {i18n:'', params:'{} 清理 ▸ 历史记录：清空全部还原／重做'}, () => purge('histories'));
CMD.reg('ps.edit.purge.videoCache', {i18n:'', params:'{} 清理 ▸ 视频高速缓存：没有视频层，什么都不用清'}, () => ({ok:true, purged:[], message:'nothing to purge (no video layers)'}));
CMD.reg('ps.edit.purge.all', {i18n:'', params:'{} 清理 ▸ 全部：还原＋剪贴板＋历史记录'}, () => purge('all'));

/* ═══════════ 自由变换／变换（transform_cmds.rs ＋ algo/transform.rs ＋ extra_cmds.rs 预设） ═══════════ */
const Hm = {
  apply(m, x, y){ const w = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]; },
  mul(a, b){ const r = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]; return r; },
  inverse(m){
    const c = [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
               m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
               m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]];
    const det = m[0] * c[0] + m[1] * c[3] + m[2] * c[6];
    return Math.abs(det) < 1e-12 ? null : c.map(v => v / det);
  },
  squareToQuad(q){
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
    if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1];
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null;
    const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
    return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
  },
  rectToQuad(r, q){
    const w = r[2] - r[0], h = r[3] - r[1]; if (!(w > 0 && h > 0)) return null;
    const s = this.squareToQuad(q); if (!s) return null;
    return this.mul(s, [1 / w, 0, -r[0] / w, 0, 1 / h, -r[1] / h, 0, 0, 1]);
  },
};
const catmullRom = t => { const t2 = t * t, t3 = t2 * t; return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2]; };
const interpOf = s => (s === 'nearest' || s === 'nearestNeighbor') ? 'nearest' : s === 'bilinear' ? 'bilinear' : 'bicubic';
/* algo/transform.rs:129 warp_surface：pre（预乘 Float32，文件区域 pr）里 srcRect 那块按 m 映射；回传 {rect, px（straight u8）} 或 null。
   （原码缩到一半以下会先用 resize 预缩防锯齿；这里没做，缩很小时双三次会有些锯齿） */
function warp(pre, pr, srcRect, m, interp){
  const inv = Hm.inverse(m); if (!inv) return null;
  const cs = [[srcRect[0], srcRect[1]], [srcRect[2], srcRect[1]], [srcRect[2], srcRect[3]], [srcRect[0], srcRect[3]]].map(([x, y]) => Hm.apply(m, x, y));
  if (cs.some(c => !isFinite(c[0]) || !isFinite(c[1]))) return null;
  const lim = 1 << 20;
  const dst = [Math.max(Math.floor(Math.min(...cs.map(c => c[0]))), -lim) - 1, Math.max(Math.floor(Math.min(...cs.map(c => c[1]))), -lim) - 1,
               Math.min(Math.ceil(Math.max(...cs.map(c => c[0]))), lim) + 1, Math.min(Math.ceil(Math.max(...cs.map(c => c[1]))), lim) + 1];
  const pw = Rc.w(pr), dw = Rc.w(dst), dh = Rc.h(dst), out = new Uint8ClampedArray(dw * dh * 4);
  const at = (x, y, c) => (x < srcRect[0] || y < srcRect[1] || x >= srcRect[2] || y >= srcRect[3]) ? 0 : pre[((y - pr[1]) * pw + (x - pr[0])) * 4 + c];
  const acc = [0, 0, 0, 0];
  let any = false;
  for (let y = dst[1]; y < dst[3]; y++) for (let x = dst[0]; x < dst[2]; x++){
    let [u, v] = Hm.apply(inv, x + 0.5, y + 0.5); u -= 0.5; v -= 0.5;
    if (u < srcRect[0] - 1 || v < srcRect[1] - 1 || u > srcRect[2] || v > srcRect[3]) continue;
    acc[0] = acc[1] = acc[2] = acc[3] = 0;
    if (interp === 'nearest'){
      const ix = Math.floor(u + 0.5), iy = Math.floor(v + 0.5);
      for (let c = 0; c < 4; c++) acc[c] = at(ix, iy, c);
    } else if (interp === 'bilinear'){
      const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
      for (const [dy, wy] of [[0, 1 - fy], [1, fy]]) for (const [dx, wx] of [[0, 1 - fx], [1, fx]]) for (let c = 0; c < 4; c++) acc[c] += at(ix + dx, iy + dy, c) * wx * wy;
    } else {
      const ix = Math.floor(u), iy = Math.floor(v), wx = catmullRom(u - ix), wy = catmullRom(v - iy);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++){ const k = wx[i] * wy[j]; for (let c = 0; c < 4; c++) acc[c] += at(ix - 1 + i, iy - 1 + j, c) * k; }
    }
    const al = c01(acc[3]); if (al <= 0) continue;
    any = true;
    const o = ((y - dst[1]) * dw + (x - dst[0])) * 4;
    out[o] = c01(acc[0] / al) * 255; out[o + 1] = c01(acc[1] / al) * 255; out[o + 2] = c01(acc[2] / al) * 255; out[o + 3] = al * 255;
  }
  return any ? {rect:dst, px:out} : null;
}
const premul = px => { const f = new Float32Array(px.length); for (let i = 0; i < px.length; i += 4){ const a = px[i + 3] / 255; f[i] = px[i] / 255 * a; f[i + 1] = px[i + 1] / 255 * a; f[i + 2] = px[i + 2] / 255 * a; f[i + 3] = a; } return f; };
/* transform_cmds.rs:23 transform_bounds：内容外框 ∩ 选区外框 */
function transformBounds(L){
  const c = contentRect(L); if (!c) return null;
  return Doc.sel ? Rc.inter(c, selRect()) : c;
}
/* 选区轮廓跟着像素走（transform_cmds.rs:393：warp_gray(selection, bilinear)） */
function warpSelection(m){
  const b = selBytes(); if (!b) return;
  const W = Doc.width, H = Doc.height, r = selRect(), px = new Uint8ClampedArray(Rc.w(r) * Rc.h(r) * 4);
  for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++){ const i = ((y - r[1]) * Rc.w(r) + (x - r[0])) * 4; px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = b[y * W + x]; }
  const wv = warp(premul(px), r, r, m, 'bilinear');
  const out = new Uint8Array(W * H);
  if (wv){ const k = Rc.inter(wv.rect, docRect()); if (k) for (let y = k[1]; y < k[3]; y++) for (let x = k[0]; x < k[2]; x++) out[y * W + x] = wv.px[((y - wv.rect[1]) * Rc.w(wv.rect) + (x - wv.rect[0])) * 4 + 3]; }
  Doc.sel = SelMask.fromBytes(out);
}
let lastXf = null;                       // 「再次」用：最近一次 edit.transform 的参数（原码翻 journal）
/* transform_cmds.rs:320 transform（本体，不碰历史；由会进历史的命令呼叫） */
function transformImpl(p){
  const L = layerOf(p); if (!L) return fail('no active layer');
  // transform_cmds.rs:165：背景层先变普通层「图层 0」；锁位置／全锁不能变换
  if (isBg(L)){ L.name = T('layer.untitled') + ' 0'; L.isBackground = false; if (L.locks){ L.locks.transparency = false; L.locks.position = false; } }
  if (L.locks && (L.locks.position || L.locks.all)) return fail(`layer "${L.name}" is locked`);
  let rect;
  if (Array.isArray(p.rect) && p.rect.length === 4) rect = p.rect.map(v => Number(v) || 0);
  else { const b = L.kind === 'smart' ? contentRect(L) : transformBounds(L); if (!b) return fail('nothing to transform'); rect = b; }
  // 智能对象：变换存在智能对象上（仿射并进 transform、扭曲／透视记一步 persp），换内容后重渲照套（PS；engine Smart.transform）
  if (L.kind === 'smart' && window.Smart && Smart.transform){
    let q;
    if (Array.isArray(p.quad)){
      if (p.quad.length !== 4 || p.quad.some(a => !Array.isArray(a) || a.length < 2 || !isNum(+a[0]) || !isNum(+a[1]))) return fail('edit.transform: quad must be [[x,y]×4]');
      q = {rect, quad:p.quad.map(a => [+a[0], +a[1]]), tail:!!p.smartTail};
      if (!Hm.rectToQuad(rect, q.quad) || !Hm.inverse(Hm.rectToQuad(rect, q.quad))) return fail('edit.transform: degenerate quad');
    } else if (Array.isArray(p.matrix)){
      const v = p.matrix.map(Number).filter(isFinite); if (v.length !== 6) return fail('edit.transform: matrix must be [a, b, c, d, e, f]');
      q = {matrix:v};
    } else return fail('edit.transform: pass `quad` (where the rect\'s corners go) or `matrix`');
    const r = Smart.transform(L, q); if (r && r.ok === false) return r;
    if (!p._quiet) lastXf = q.quad ? {rect, quad:q.quad, interpolation:interpOf(p.interpolation || Prefs.interp())} : {matrix:q.matrix, interpolation:interpOf(p.interpolation || Prefs.interp())};
    return {ok:true, rect, smart:true, persp:!!r.persp};
  }
  let m;
  if (Array.isArray(p.quad)){
    if (p.quad.length !== 4 || p.quad.some(q => !Array.isArray(q) || q.length < 2 || !isNum(+q[0]) || !isNum(+q[1]))) return fail('edit.transform: quad must be [[x,y]×4]');
    m = Hm.rectToQuad(rect, p.quad.map(q => [+q[0], +q[1]]));
    if (!m) return fail('edit.transform: degenerate quad');
  } else if (Array.isArray(p.matrix)){
    const v = p.matrix.map(Number).filter(isFinite);
    if (v.length !== 6) return fail('edit.transform: matrix must be [a, b, c, d, e, f]');
    m = [v[0], v[2], v[4], v[1], v[3], v[5], 0, 0, 1];          // 仿射 [a b c d e f]：(x,y) → (a·x + c·y + e, b·x + d·y + f)
  } else return fail('edit.transform: pass `quad` (where the rect\'s corners go) or `matrix`');
  if (!Hm.inverse(m)) return fail('edit.transform: the transform collapses the layer');
  const affine = Math.abs(m[6]) < 1e-12 && Math.abs(m[7]) < 1e-12;
  const interp = interpOf(typeof p.interpolation === 'string' ? p.interpolation : Prefs.interp());
  if (L.kind !== 'raster'){
    // 文字／矢量层整层动（原码 Shape/Text 走 affine）；扭曲／透视要先栅格化
    if (!affine) return fail(`Distort and Perspective need a rasterized layer (Layer › Rasterize; this is a ${L.kind} layer)`);
    const M = [m[0] / m[8], m[3] / m[8], m[1] / m[8], m[4] / m[8], m[2] / m[8], m[5] / m[8]];
    const r = CMD.map['move.transform'].run({layerId:L.id, matrix:M});      // 直接叫本体：历史已经由外层命令 push 过
    if (r && r.ok === false) return r;
  } else {
    // transform_layer：有选区只搬选中的像素（split_selected → warp → composite_over），没选区整层搬
    const cr = canvasRect(L), px = readLayer(L, cr), cov = selBytes();
    let rest = null;
    if (cov){
      rest = new Uint8ClampedArray(px);
      const w = Rc.w(cr), W = Doc.width, H = Doc.height;
      for (let y = cr[1]; y < cr[3]; y++) for (let x = cr[0]; x < cr[2]; x++){
        const i = ((y - cr[1]) * w + (x - cr[0])) * 4 + 3, k = (x >= 0 && y >= 0 && x < W && y < H) ? cov[y * W + x] / 255 : 0;
        const a = px[i]; px[i] = Math.round(a * k); rest[i] = Math.round(a * (1 - k));
      }
    }
    const src = alphaBounds(px, cr);
    const wv = src ? warp(premul(px), cr, src, m, interp) : null;
    // 新画布：至少盖住文件；有选区时还要盖住原画布（剩下没搬的像素）
    const nr = Rc.union(Rc.union(docRect(), wv ? wv.rect : null), rest ? cr : null);
    const c = document.createElement('canvas'); c.width = Rc.w(nr); c.height = Rc.h(nr);
    const ctx = c.getContext('2d', {willReadFrequently:true});
    if (rest) ctx.putImageData(new ImageData(rest, Rc.w(cr), Rc.h(cr)), cr[0] - nr[0], cr[1] - nr[1]);
    if (wv){                                                   // composite_over：Normal 盖上去（drawImage 就是 source-over）
      const t = document.createElement('canvas'); t.width = Rc.w(wv.rect); t.height = Rc.h(wv.rect);
      t.getContext('2d').putImageData(new ImageData(wv.px, t.width, t.height), 0, 0);
      ctx.drawImage(t, wv.rect[0] - nr[0], wv.rect[1] - nr[1]);
    }
    L.data.canvas = c; L.data.ctx = ctx; L.x = nr[0]; L.y = nr[1];
    Layer.invalidate(L);
  }
  if (Doc.sel) warpSelection(m);
  if (p._quiet) return {ok:true, rect};                       // 智能对象重渲时借用（engine Smart.applyOp persp）：不记「再次」
  lastXf = Array.isArray(p.quad) ? {rect, quad:p.quad.map(q => [+q[0], +q[1]]), interpolation:interp} : {matrix:p.matrix.map(Number), interpolation:interp};
  return {ok:true, rect};
}
CMD.reg('ps.edit.transform', {i18n:'', undoable:true,
  params:'{layerId?, rect?:[x0,y0,x1,y1] 原框（缺省＝该层内容外框 ∩ 选区外框）, quad?:[[x,y]×4] 四角去处（左上起顺时针；不是平行四边形＝扭曲／透视）| matrix?:[a,b,c,d,e,f] 仿射, '
       + 'interpolation:"bicubic|bilinear|nearest"=首选项「图像插值方法」} 自由变换引擎（transform_cmds.rs edit.transform）：像素层有选区只搬选中的像素、选区轮廓跟着走；文字／矢量层整层（只收仿射）'},
  transformImpl);
/* extra_cmds.rs:261 transform_preset：整数位移＋最近邻，像素原封不动地排列 */
function presetMatrix(kind, L){
  const b = transformBounds(L); if (!b) return null;
  const sx = b[0] + b[2], sy = b[1] + b[3], cx = sx / 2, cy = sy / 2;
  return kind === 'rotate180' ? [-1, 0, 0, -1, sx, sy]
       : kind === 'rotate90Cw' ? [0, 1, -1, 0, Math.round(cx + cy), Math.round(cy - cx)]
       : kind === 'rotate90Ccw' ? [0, -1, 1, 0, Math.round(cx - cy), Math.round(cx + cy)]
       : kind === 'flipHorizontal' ? [-1, 0, 0, 1, sx, 0] : [1, 0, 0, -1, 0, sy];
}
for (const [k, zh] of [['rotate180', '旋转 180 度'], ['rotate90Cw', '顺时针旋转 90 度'], ['rotate90Ccw', '逆时针旋转 90 度'], ['flipHorizontal', '水平翻转'], ['flipVertical', '垂直翻转']]){
  CMD.reg('ps.edit.transform.' + k, {i18n:'', undoable:true, params:`{layerId?} 变换 ▸ ${zh}：绕该层内容（∩ 选区）外框中心，最近邻、像素不失真（extra_cmds.rs transform_preset）`}, p => {
    const L = layerOf(p); if (!L) return fail('no active layer');
    const m = presetMatrix(k, L); if (!m) return fail('nothing to transform');
    return transformImpl({layerId:L.id, matrix:m, interpolation:'nearest'});
  });
}
/* 交互框：PhotoCraft 的菜单「自由变换／缩放／旋转／斜切」都是 transform_tool::begin（menus.rs:365-370）——我们的交互框在移动工具里（tools/move.js MoveTool.xfBegin） */
function beginInteractive(){
  const L = Doc.active(); if (!L) return fail('no active layer');
  if (!window.MoveTool) return fail('the Move tool is not loaded');
  if (MoveTool.xf) return {ok:true, transform:true};
  if (window.UI && UI.pick) { try { UI.pick('move'); } catch(e){} }
  if (window.ToolState && ToolState.cur !== 'move' && window.UI) UI.setTool('move');
  if (!MoveTool.xfBegin()) return fail('Could not transform: the layer is empty');
  if (window.UI) UI.draw();
  return {ok:true, transform:true};
}
const hasParams = p => p && Object.keys(p).some(k => k !== 'dialog');
function pivotOf(p, L){
  if (Array.isArray(p.pivot) && p.pivot.length >= 2) return [+p.pivot[0], +p.pivot[1]];
  const b = transformBounds(L); return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null;
}
const aboutPivot = (a, b, c, d, pv) => [a, b, c, d, pv[0] - a * pv[0] - c * pv[1], pv[1] - b * pv[0] - d * pv[1]];
CMD.reg('ps.edit.freeTransform', {i18n:'', params:'{} ＝进自由变换交互框（移动工具的框：角等比缩放、框外拖旋转、Ctrl 拖边斜切，Enter 确定）；{quad|matrix, rect?, interpolation?, layerId?} ＝直接变换（转给 ps.edit.transform，一步历史）'},
  p => hasParams(p) ? CMD.run('ps.edit.transform', p) : beginInteractive());
CMD.reg('ps.edit.transform.scale', {i18n:'', params:'{} ＝进变换框；{sx:%=100, sy:%=sx, pivot?:[x,y]（缺省＝内容外框中心）, interpolation?, layerId?} ＝直接缩放（一步历史）'}, p => {
  if (!hasParams(p)) return beginInteractive();
  const L = layerOf(p); if (!L) return fail('no active layer');
  const pv = pivotOf(p, L); if (!pv) return fail('nothing to transform');
  const sx = (isNum(p.sx) ? p.sx : 100) / 100, sy = (isNum(p.sy) ? p.sy : (isNum(p.sx) ? p.sx : 100)) / 100;
  return CMD.run('ps.edit.transform', {layerId:L.id, matrix:aboutPivot(sx, 0, 0, sy, pv), interpolation:p.interpolation});
});
CMD.reg('ps.edit.transform.rotate', {i18n:'', params:'{} ＝进变换框；{angle:度（正＝顺时针，同 PS）, pivot?:[x,y], interpolation?, layerId?} ＝直接旋转（一步历史）'}, p => {
  if (!hasParams(p)) return beginInteractive();
  const L = layerOf(p); if (!L) return fail('no active layer');
  const pv = pivotOf(p, L); if (!pv) return fail('nothing to transform');
  const a = (isNum(p.angle) ? p.angle : 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return CMD.run('ps.edit.transform', {layerId:L.id, matrix:aboutPivot(c, s, -s, c, pv), interpolation:p.interpolation});
});
CMD.reg('ps.edit.transform.skew', {i18n:'', params:'{} ＝进变换框；{kx:度=0 水平斜切, ky:度=0 垂直斜切, pivot?:[x,y], interpolation?, layerId?} ＝直接斜切（一步历史）'}, p => {
  if (!hasParams(p)) return beginInteractive();
  const L = layerOf(p); if (!L) return fail('no active layer');
  const pv = pivotOf(p, L); if (!pv) return fail('nothing to transform');
  const tx = Math.tan((isNum(p.kx) ? p.kx : 0) * Math.PI / 180), ty = Math.tan((isNum(p.ky) ? p.ky : 0) * Math.PI / 180);
  return CMD.run('ps.edit.transform', {layerId:L.id, matrix:aboutPivot(1, ty, tx, 1, pv), interpolation:p.interpolation});
});
for (const k of ['distort', 'perspective']){
  CMD.reg('ps.edit.transform.' + k, {i18n:'', params:`{} ＝开「${k === 'distort' ? '扭曲' : '透视'}」对话框（四个角的坐标）；{quad:[[x,y]×4] 内容外框四角的去处（左上起顺时针）, rect?, interpolation?, layerId?} ＝直接变（像素层；一步历史）`},
    p => hasParams(p) ? CMD.run('ps.edit.transform', Object.assign({}, p, {dialog:undefined})) : openQuadDialog(k));
}
/* 给 agent 的好找别名（任何种类的层都能用；像素层走 ps.edit.transform 重采样，文字／矢量层整层仿射） */
CMD.reg('layer.scale', {i18n:'', params:'{sx:%, sy?:%=sx | width?/height?:目标 px（量的是内容外框，只给一边＝等比）, pivot?:[x,y]|"center"|"topLeft"="center", interpolation?, layerId?} 缩放整层内容（像素层也行；有选区只缩选中的）→ {ok, rect}'}, p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  const b = transformBounds(L); if (!b) return fail('nothing to scale: the layer is empty');
  const bw = b[2] - b[0], bh = b[3] - b[1];
  let sx = isNum(p.sx) ? p.sx / 100 : null, sy = isNum(p.sy) ? p.sy / 100 : null;
  if (isNum(p.width) && p.width > 0) sx = p.width / bw;
  if (isNum(p.height) && p.height > 0) sy = p.height / bh;
  if (sx === null && sy === null) return fail('layer.scale: give sx (%) or width/height (px)');
  if (sx === null) sx = sy; if (sy === null) sy = sx;
  const pv = Array.isArray(p.pivot) ? [+p.pivot[0], +p.pivot[1]] : p.pivot === 'topLeft' ? [b[0], b[1]] : [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  return CMD.run('ps.edit.transform', {layerId:L.id, matrix:aboutPivot(sx, 0, 0, sy, pv), interpolation:p.interpolation});
});
CMD.reg('layer.rotate', {i18n:'', params:'{angle:度（正＝顺时针）, pivot?:[x,y]（缺省＝内容外框中心）, interpolation?, layerId?} 旋转整层内容 → 同 ps.edit.transform.rotate'},
  p => CMD.run('ps.edit.transform.rotate', Object.assign({angle:0}, p)));
CMD.reg('layer.flip', {i18n:'', params:'{direction:"horizontal|vertical"="horizontal", layerId?} 翻转整层内容 → 同 ps.edit.transform.flipHorizontal／flipVertical'},
  p => CMD.run(p.direction === 'vertical' ? 'ps.edit.transform.flipVertical' : 'ps.edit.transform.flipHorizontal', {layerId:p.layerId}));
/* edit_cmds.rs:331 transform_again：重放最近一次 edit.transform（quad 版：把原来的 rect→quad 套到现在的外框上） */
CMD.reg('ps.edit.transform.again', {i18n:'', params:'{layerId?, duplicate?:bool} 变换 ▸ 再次：对当前层重做最近一次变换（Ctrl+Shift+T；一步历史）。变换记的是文件坐标（参考点位置＋角度／缩放），所以每按一次都绕同一个参考点再转同样的角度；' +
    'duplicate=true ＝ PS 的 Ctrl+Shift+Alt+T（再次变换并复制）：先复制当前层（新层在上面、成为当前层）再变换副本，复制＋变换合成一步历史 → {ok, rect, id?}'}, p => {
  if (!lastXf) return fail('there is no transform to repeat');
  const L = layerOf(p); if (!L) return fail('no active layer');
  const build = T_ => {
    const q = {layerId:T_.id, interpolation:lastXf.interpolation};
    if (lastXf.quad){
      const h = Hm.rectToQuad(lastXf.rect, lastXf.quad); if (!h) return fail("the last transform can't be repeated");
      const b = transformBounds(T_); if (!b) return fail('nothing to transform');
      q.rect = b; q.quad = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(([x, y]) => Hm.apply(h, x, y));
    } else q.matrix = lastXf.matrix;
    return q;
  };
  if (!p.duplicate){ const q = build(L); return q.ok === false ? q : CMD.run('ps.edit.transform', q); }
  // Ctrl+Shift+Alt+T：复制＋变换＝一步（照 move.translate duplicate 的作法：自己 push 一次，里面直接叫命令本体）
  const q0 = build(L); if (q0.ok === false) return q0;
  History.push();
  const back = r => { History.restoreInPlace(History.past.pop()); return r; };
  const d = CMD.map['layer.duplicate'].run({id:L.id});
  const N = d && d.id && Doc.byId(d.id); if (!N) return back(fail('duplicate failed'));
  Doc.activeId = N.id;
  const q = build(N); if (q.ok === false) return back(q);
  const r = CMD.map['ps.edit.transform'].run(q);
  if (r && r.ok === false) return back(r);
  return Object.assign({}, r, {id:N.id, duplicate:true});
});
/* 移动工具的自由变换框确定时走 move.transform：也记进「再次」，没指定插值就用首选项的（原码 transform_tool commit → edit.transform 同一条） */
(function wrapMoveTransform(){
  const c = CMD.map['move.transform']; if (!c || c._psWrapped) return;
  const orig = c.run;
  c.run = p => {
    const q = Object.assign({}, p);
    if (q.interpolation === undefined) q.interpolation = Prefs.interp();
    const r = orig(q);
    if (!(r && r.ok === false)){
      if (Array.isArray(q.quad) && q.quad.length === 4 && Array.isArray(q.rect)) lastXf = {rect:q.rect.slice(), quad:q.quad.map(x => x.slice()), interpolation:q.interpolation};
      else if (Array.isArray(q.matrix)) lastXf = {matrix:q.matrix.slice(), interpolation:q.interpolation};
    }
    return r;
  };
  c._psWrapped = true;
})();

/* ═══════════ 查找和替换文本（edit_menu_cmds.rs:556-709） ═══════════ */
function findMatches(text, find, cs, whole){
  if (!find) return [];
  const norm = c => cs ? c : c.toLowerCase();
  const needle = Array.from(find).map(norm).join(''), out = [];
  const word = c => !!c && /[\p{L}\p{N}_]/u.test(c);
  let at = 0;
  while (at < text.length){
    let hay = '', end = at;
    for (const c of text.slice(at)){ if (hay.length >= needle.length) break; hay += norm(c); end += c.length; }
    if (hay === needle){
      const before = Array.from(text.slice(0, at)).pop(), after = Array.from(text.slice(end))[0];
      if (!whole || (!word(before) && !word(after))){ out.push([at, end]); at = end; continue; }
    }
    at += Array.from(text.slice(at))[0].length;
  }
  return out;
}
let findCursor = null;                     // [layerId, start, end]
function typeLayers(forward){ const ids = Doc.layers.slice().reverse().filter(L => L.kind === 'text').map(L => L.id); return forward ? ids : ids.reverse(); }
function findReplace(p){
  const cmd = 'edit.findAndReplaceText';
  if (typeof p.find !== 'string' || !p.find) return fail(cmd + ': missing `find`');
  const find = p.find, replace = typeof p.replace === 'string' ? p.replace : '';
  const cs = p.caseSensitive === true, whole = p.wholeWord === true, forward = p.forward !== false, allLayers = p.allLayers !== false;
  const action = typeof p.action === 'string' ? p.action : 'changeAll';
  let layers = typeLayers(forward);
  if (!layers.length) return fail('the document has no type layers');
  if (!allLayers){ const a = layerOf(p); layers = layers.filter(id => a && id === a.id); }
  const textOf = id => { const L = Doc.byId(id); return L && L.kind === 'text' ? String(L.data.text) : null; };
  const setText = (id, t) => { const L = Doc.byId(id); L.data.text = t; Layer.invalidate(L); };
  if (action === 'changeAll'){
    const plan = layers.map(id => [id, findMatches(textOf(id) || '', find, cs, whole)]).filter(x => x[1].length);
    const count = plan.reduce((s, x) => s + x[1].length, 0);
    if (!count) return {ok:true, count:0, layers:0};
    History.push();                                           // 有改才进历史（一步「全部替换」）
    for (const [id, ms] of plan){ let t = textOf(id); for (const [a, b] of ms.slice().reverse()) t = t.slice(0, a) + replace + t.slice(b); setText(id, t); }
    findCursor = null;
    return {ok:true, count, layers:plan.length};
  }
  if (!['find', 'change', 'changeFind'].includes(action)) return fail(`${cmd}: unknown action \`${action}\` (find|change|changeFind|changeAll)`);
  let changed = null;
  if (action !== 'find' && findCursor){
    const [id, a, b] = findCursor, t = textOf(id);
    if (t !== null && findMatches(t, find, cs, whole).some(m => m[0] === a && m[1] === b)){
      History.push();
      setText(id, t.slice(0, a) + replace + t.slice(b));
      const end = a + replace.length; findCursor = [id, end, end]; changed = {layer:id, start:a, end};
      if (action === 'change') return {ok:true, changed};
    }
  }
  const cur = findCursor, start = cur ? Math.max(layers.indexOf(cur[0]), 0) : 0;
  for (let k = 0; k <= layers.length; k++){
    const id = layers[(start + k) % layers.length], t = textOf(id); if (t === null) continue;
    const ms = findMatches(t, find, cs, whole);
    let hit;
    if (k === 0 && cur && cur[0] === id) hit = forward ? ms.find(m => m[0] >= cur[2]) : ms.slice().reverse().find(m => m[1] <= cur[1]);
    else hit = forward ? ms[0] : ms[ms.length - 1];
    if (hit){ findCursor = [id, hit[0], hit[1]]; Doc.activeId = id; return {ok:true, found:{layer:id, start:hit[0], end:hit[1], text:t.slice(hit[0], hit[1])}, changed}; }
  }
  findCursor = null;
  return {ok:true, found:null, changed};
}
CMD.reg('ps.edit.findAndReplaceText', {i18n:'',
  params:'{find, replace="", action:"changeAll|find|change|changeFind"="changeAll", caseSensitive=false, wholeWord=false, forward=true, allLayers=true, dialog?:true＝开对话框} '
       + '查找和替换文本（文字层）；有替换才进历史（一步）→ changeAll：{count, layers}；其他：{found:{layer,start,end,text}|null, changed}'},
  p => p.dialog ? openFindDialog() : findReplace(p));

/* ═══════════ 首选项（engine/src/prefs.rs；只摆我们真的接得上的栏位——原码 HIDDEN_UNTIL_IMPLEMENTED：没作用的控件比没有还糟） ═══════════ */
const PREF_KEY = 'dlcanvas.ps.prefs';
const PREF_DEFAULTS = {                    // prefs.rs 各区段 Default（只列有接上的）
  general:{imageInterpolation:'bicubicAutomatic', zoomWithScrollWheel:false},
  interface:{language:null, canvasColor:'default', canvasCustomColor:'#282828'},
  tools:{showTooltips:true},
  performance:{historyStates:null},
  transparencyAndGamut:{gridSize:'medium', gridColors:'light', customLight:'#ffffff', customDark:'#cccccc'},
};
const PREF_CHOICES = {
  'general.imageInterpolation':['bicubicAutomatic', 'nearestNeighbor', 'bilinear', 'bicubic', 'bicubicSmoother', 'bicubicSharper', 'preserveDetails'],
  'interface.language':['zh-Hant', 'zh-Hans', 'en'],
  'interface.canvasColor':['default', 'black', 'darkGray', 'mediumGray', 'lightGray', 'custom'],
  'transparencyAndGamut.gridSize':['none', 'small', 'medium', 'large'],
  'transparencyAndGamut.gridColors':['light', 'medium', 'dark', 'red', 'orange', 'green', 'blue', 'purple', 'custom'],
};
const HISTORY_LIMIT0 = History.limit;
const SECTIONS = [['general', 'General'], ['interface', 'Interface'], ['tools', 'Tools'], ['performance', 'Performance'], ['transparencyAndGamut', 'Transparency & Gamut']];
const Prefs = PE.prefs = {
  saved: null,                             // 用户真的改过的值（没改过的不套用，不动画板原本的样子）
  load(){ if (!this.saved){ try { this.saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch(e){ this.saved = {}; } } return this.saved; },
  /* 目前值（预设＋改过的；有些预设读画板现况：语言、历史步数） */
  view(){
    const s = this.load(), v = JSON.parse(JSON.stringify(PREF_DEFAULTS));
    v.interface.language = Lang.cur; v.performance.historyStates = History.limit;
    for (const sec in s) if (v[sec]) Object.assign(v[sec], s[sec]);
    return v;
  },
  get(path){
    const v = this.view(); if (!path) return v;
    return path.split('.').reduce((o, k) => (o && typeof o === 'object' && k in o) ? o[k] : undefined, v);
  },
  check(path, val){
    const [sec, key] = path.split('.');
    if (!PREF_DEFAULTS[sec] || !(key in PREF_DEFAULTS[sec])) return `unknown preference \`${path}\``;
    const ch = PREF_CHOICES[path];
    if (ch && !ch.includes(val)) return `invalid value for \`${path}\`: ${JSON.stringify(val)} (${ch.join('|')})`;
    if (path === 'performance.historyStates' && !(Number.isInteger(val) && val >= 1 && val <= 1000)) return '`performance.historyStates` must be 1..1000';
    if (['canvasCustomColor', 'customLight', 'customDark'].includes(key) && !parseHex(String(val))) return `\`${path}\` must be "#rrggbb"`;
    if (['zoomWithScrollWheel', 'showTooltips'].includes(key) && typeof val !== 'boolean') return `\`${path}\` must be true or false`;
    return null;
  },
  /* prefs.rs:1324 prefs_set：全部先验过再写（全有或全无） */
  set(changes){
    for (const [k, v] of changes){ const e = this.check(k, v); if (e) return e; }
    const s = this.load();
    for (const [k, v] of changes){
      // 介面语言跟右上角的语言选单是同一个设定（Lang 自己存 dlcanvas.lang）：不另存，免得两边打架
      if (k === 'interface.language'){ if (v !== Lang.cur) Lang.set(v); continue; }
      const [sec, key] = k.split('.'); (s[sec] = s[sec] || {})[key] = v;
    }
    try { localStorage.setItem(PREF_KEY, JSON.stringify(s)); } catch(e){}
    this.apply(changes.map(c => c[0]));
    return null;
  },
  reset(path){
    const s = this.load();
    if (!path){ this.saved = {}; } else if (!path.includes('.')){ delete s[path]; } else { const [sec, key] = path.split('.'); if (s[sec]) delete s[sec][key]; }
    try { localStorage.setItem(PREF_KEY, JSON.stringify(this.saved)); } catch(e){}
    this.apply(null, true);
  },
  interp(){ const v = this.get('general.imageInterpolation'); return v === 'nearestNeighbor' ? 'nearest' : v === 'bilinear' ? 'bilinear' : 'bicubic'; },
  /* 把值套到画板上（套得上的才摆进对话框） */
  apply(keys, all){
    const s = this.load(), has = (sec, k) => s[sec] && k in s[sec];
    const want = k => all || !keys || keys.includes(k);
    if (want('performance.historyStates')){
      const lim = has('performance', 'historyStates') ? s.performance.historyStates : HISTORY_LIMIT0;     // 没改过（或回出厂值）＝engine.js 原本的步数
      History.limit = lim; while (History.past.length > History.limit) History.past.shift();
    }
    // 画布外围颜色（prefs_ui.rs:58 pasteboard_color）
    const stage = document.getElementById('stage');
    if (stage && (all || !keys || keys.some(k => k.startsWith('interface.canvas')))){
      const c = this.get('interface.canvasColor');
      const col = {black:'#000000', darkGray:'rgb(40,40,40)', mediumGray:'rgb(83,83,83)', lightGray:'rgb(184,184,184)', custom:this.get('interface.canvasCustomColor')}[c];
      stage.style.background = col || '';
    }
    // 工具提示（工具栏懸停小牌 .tbtip）
    styleTag('pse-notips', this.get('tools.showTooltips') === false ? '.tbtip{display:none !important}' : '');
    // 透明区棋盘格（prefs.rs:487 TransparencyAndGamut::square／colors）：只在改过时套用，没改过保留画板原本的深色棋盘
    const view = document.getElementById('view');
    if (view && s.transparencyAndGamut && Object.keys(s.transparencyAndGamut).length){
      const t = this.get('transparencyAndGamut');
      const sq = {none:0, small:4, medium:8, large:16}[t.gridSize];
      const cols = {light:['#ffffff', '#cccccc'], medium:['#999999', '#666666'], dark:['#666666', '#333333'], red:['#ffffff', '#ffcccc'], orange:['#ffffff', '#ffe5cc'],
                    green:['#ffffff', '#ccffcc'], blue:['#ffffff', '#cce5ff'], purple:['#ffffff', '#e5ccff'], custom:[t.customLight, t.customDark]}[t.gridColors];
      if (!sq) view.style.background = '#ffffff';
      else {
        view.style.background = `linear-gradient(45deg,${cols[1]} 25%,transparent 25%,transparent 75%,${cols[1]} 75%),linear-gradient(45deg,${cols[1]} 25%,${cols[0]} 25%,${cols[0]} 75%,${cols[1]} 75%)`;
        view.style.backgroundSize = `${sq * 2}px ${sq * 2}px`; view.style.backgroundPosition = `0 0,${sq}px ${sq}px`;
      }
    } else if (view && all){ view.style.background = ''; view.style.backgroundSize = ''; view.style.backgroundPosition = ''; }
  },
};
CMD.reg('ps.prefs.get', {i18n:'', params:'{path?:"section.key"（缺省＝全部）} 读首选项（prefs.rs prefs.get）'}, p => {
  const v = Prefs.get(typeof p.path === 'string' ? p.path : '');
  return v === undefined ? fail(`unknown preference \`${p.path}\``) : v;
});
CMD.reg('ps.prefs.set', {i18n:'', params:'{path:"section.key", value} 或 {values:{"section.key":value,…}} 改首选项（先验过、全有或全无；存进浏览器）。可改：general.imageInterpolation|zoomWithScrollWheel、interface.language|canvasColor|canvasCustomColor、tools.showTooltips、performance.historyStates、transparencyAndGamut.gridSize|gridColors|customLight|customDark'}, p => {
  const ch = [];
  if (typeof p.path === 'string'){ if (!('value' in p)) return fail('prefs.set: missing `value`'); ch.push([p.path, p.value]); }
  if (p.values && typeof p.values === 'object') for (const k in p.values) ch.push([k, p.values[k]]);
  if (!ch.length) return fail('prefs.set: give `path` and `value`, or `values: {path: value, …}`');
  const e = Prefs.set(ch); if (e) return fail('prefs.set: ' + e);
  const out = {}; ch.forEach(([k]) => out[k] = Prefs.get(k)); return out;
});
CMD.reg('ps.prefs.reset', {i18n:'', params:'{path?:"section|section.key"（缺省＝全部）} 首选项回出厂值'}, p => { Prefs.reset(typeof p.path === 'string' ? p.path : null); return Prefs.get(typeof p.path === 'string' ? p.path : ''); });
for (const [sec, title] of SECTIONS){
  CMD.reg('ps.edit.preferences.' + sec, {i18n:'', params:`{dialog?:true＝开「首选项」对话框停在这一区段} 首选项 ▸ ${title}：回这一区段的值 {section,title,values}（prefs.rs edit.preferences.${sec}）`},
    p => p.dialog ? openPrefsDialog(sec) : {ok:true, section:sec, title, values:Prefs.get(sec)});
}
/* 「用滚轮缩放」（general.zoomWithScrollWheel）：开着时不按 Ctrl 滚轮也绕游标缩放（ui.js 的滚轮只认 Ctrl） */
function bindWheel(){
  const wrap = document.getElementById('canvasWrap'); if (!wrap || wrap._psWheel) return;
  wrap._psWheel = true;
  wrap.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey || Prefs.get('general.zoomWithScrollWheel') !== true || !window.UI) return;
    e.preventDefault();
    UI.wheelZoom(e);   // 同 Ctrl＋滚轮：滚动中先 CSS 缩放、停手才重画
  }, {passive:false});
}

/* ═══════════ 搜索（ui-egui/src/palette.rs：⌘K 命令面板） ═══════════ */
function fuzzyScore(q, text){                                   // palette.rs:9
  if (!q) return 0;
  const t = Array.from(text.toLowerCase());
  let score = 0, ti = 0, last = null;
  for (const qc of Array.from(q.toLowerCase())){
    let found = false;
    while (ti < t.length){
      if (t[ti] === qc){ score += (last === ti - 1) ? 8 : 1; if (ti === 0 || t[ti - 1] === ' ') score += 5; last = ti; ti++; found = true; break; }
      ti++;
    }
    if (!found) return null;
  }
  return score - Math.floor(t.length / 8);
}
const nameOf = x => (x.n && (x.n[Lang.cur] || x.n.en)) || x.id || '';
function searchHits(q){
  const hits = [];
  if (window.Menubar && window.MenuTrees){
    MenuTrees.walk(Menubar.app, (it, path) => {
      if (it.sep || it.sub || it.header) return;
      const pth = path.slice(1).map(nameOf), top = MenuTrees[Menubar.app][path[0]];
      const label = nameOf(it).replace(/…$/, ''), crumbs = [nameOf(top)].concat(pth).join(' › ');
      const s = fuzzyScore(q, `${label} ${crumbs} ${(it.n && it.n.en) || ''}`);
      if (s === null) return;
      hits.push({score:s, id:it.id, label, detail:crumbs + (it.key ? '   ' + it.key : ''), enabled:Menubar.enabled(it), item:it});
    });
  }
  if (typeof toolsFor === 'function') toolsFor(window.Menubar ? Menubar.kind : 'raster').filter(t => !t.sep).forEach(t => {
    const label = T('tool.' + t.id), s = fuzzyScore(q, label + ' ' + t.id);
    if (s !== null) hits.push({score:s + 2, id:'tool:' + t.id, label, detail:`${T('pse.tool')}   ${t.key || ''}`, enabled:true, tool:t.id});
  });
  hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return hits.slice(0, 12);
}
const Palette = PE.palette = {
  el:null, sel:0, hits:[],
  toggle(){ if (this.el) this.close(); else this.open(); return {ok:true, open:!!this.el}; },
  open(){
    this.close(); ensureStyle();
    const back = div('pse-back pse-pal-back'), box = div('pse-pal'); back.dataset.palette = '1';
    const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = T('pse.searchHint'); inp.className = 'pse-pal-q';
    const list = div('pse-pal-list'), foot = div('pse-pal-foot'); foot.textContent = T('pse.searchFoot');
    box.append(inp, list, foot); back.appendChild(box);
    back.addEventListener('pointerdown', e => { if (e.target === back) this.close(); e.stopPropagation(); });
    back.addEventListener('mousedown', e => e.stopPropagation());
    inp.addEventListener('input', () => { this.sel = 0; this.render(inp.value, list); });
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'ArrowDown'){ e.preventDefault(); this.sel = Math.min(this.sel + 1, Math.max(this.hits.length - 1, 0)); this.render(inp.value, list); }
      else if (e.key === 'ArrowUp'){ e.preventDefault(); this.sel = Math.max(this.sel - 1, 0); this.render(inp.value, list); }
      else if (e.key === 'Enter'){ e.preventDefault(); const h = this.hits[this.sel]; if (h && h.enabled) this.run(h); }
      else if (e.key === 'Escape'){ e.preventDefault(); this.close(); }
    });
    document.body.appendChild(back); this.el = back; this.sel = 0; this.render('', list);
    inp.focus(); setTimeout(() => inp.focus(), 0);
  },
  render(q, list){
    this.hits = searchHits(q); list.innerHTML = '';
    if (!this.hits.length){ const e = div('pse-pal-none'); e.textContent = T('pse.searchNone'); list.appendChild(e); }
    this.hits.forEach((h, i) => {
      const row = div('pse-pal-row' + (i === this.sel ? ' on' : '') + (h.enabled ? '' : ' off'));
      row.dataset.id = h.id;
      const a = document.createElement('span'); a.className = 'l'; a.textContent = h.label;
      const b = document.createElement('span'); b.className = 'd'; b.textContent = h.detail;
      row.append(a, b);
      row.addEventListener('click', () => { if (h.enabled) this.run(h); });
      list.appendChild(row);
    });
  },
  run(h){
    this.close();
    if (h.tool){ if (window.UI) UI.pick(h.tool); return; }
    if (h.item && window.Menubar) Menubar.run(h.item);
  },
  close(){ if (this.el){ this.el.remove(); this.el = null; } },
};
CMD.reg('ps.edit.search', {i18n:'', params:'{} ＝开／关搜索面板（Ctrl+F：模糊搜寻所有菜单项与工具，Enter 执行）；{query} ＝只回传前 12 个结果 [{id,label,detail,enabled}]'}, p => {
  if (typeof p.query === 'string') return searchHits(p.query).map(h => ({id:h.id, label:h.label, detail:h.detail, enabled:h.enabled}));
  return Palette.toggle();
});

/* ═══════════ 对话框（照原码各对话框的栏位；DOM 与样式都在这支档里） ═══════════ */
function div(cls){ const d = document.createElement('div'); if (cls) d.className = cls; return d; }
function styleTag(id, css){ let s = document.getElementById(id); if (!s){ s = document.createElement('style'); s.id = id; document.head.appendChild(s); } s.textContent = css; }
function ensureStyle(){
  if (document.getElementById('pse-style')) return;
  styleTag('pse-style', `
.pse-back{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center}
.pse-dlg{background:#2b2f36;color:#e6e8ec;border:1px solid #444a55;border-radius:6px;padding:14px 16px;min-width:320px;max-width:640px;font:13px sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45)}
.pse-dlg .pse-title{font-weight:600;margin-bottom:10px}
.pse-dlg .pse-sec{margin:10px 0 4px;color:#9aa3b0;font-size:12px;border-bottom:1px solid #444a55;padding-bottom:3px}
.pse-row{display:flex;align-items:center;gap:10px;margin:6px 0}
.pse-row>.lb{width:132px;text-align:right;color:#b8bec8;flex:0 0 auto}
.pse-row input[type=text],.pse-row input[type=number],.pse-row select{background:#1d2026;color:#e6e8ec;border:1px solid #444a55;border-radius:3px;padding:3px 6px}
.pse-row input[type=number]{width:80px}
.pse-row input[type=color]{width:46px;height:22px;padding:0;border:1px solid #444a55;background:#1d2026}
.pse-row.hide{display:none}
.pse-err{color:#ff8d7a;min-height:16px;margin-top:6px;font-size:12px}
.pse-bar{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.pse-bar button{background:#3a404a;color:#e6e8ec;border:1px solid #555c68;border-radius:4px;padding:4px 14px;cursor:pointer}
.pse-bar button.pri{background:#2f7fd8;border-color:#2f7fd8}
.pse-prefs{display:flex;gap:14px}
.pse-prefs .nav{display:flex;flex-direction:column;gap:2px;min-width:150px;border-right:1px solid #444a55;padding-right:8px}
.pse-prefs .nav div{padding:4px 8px;border-radius:3px;cursor:pointer;color:#c8ced8}
.pse-prefs .nav div.on{background:#2f7fd8;color:#fff}
.pse-prefs .pane{min-width:330px}
.pse-pal-back{align-items:flex-start;padding-top:110px;background:rgba(0,0,0,.43)}
.pse-pal{width:560px;background:#2b2f36;border:1px solid #444a55;border-radius:8px;padding:10px;box-shadow:0 18px 48px rgba(0,0,0,.5);color:#e6e8ec;font:13px sans-serif}
.pse-pal-q{width:100%;box-sizing:border-box;background:transparent;border:none;border-bottom:1px solid #444a55;color:#e6e8ec;font-size:15px;padding:4px 6px 8px;outline:none}
.pse-pal-list{margin-top:6px}
.pse-pal-row{display:flex;justify-content:space-between;align-items:center;height:32px;padding:0 12px;border-radius:4px;cursor:pointer}
.pse-pal-row:hover{background:#363b44}.pse-pal-row.on{background:#284a73}
.pse-pal-row.off{color:#7a808a}
.pse-pal-row .d{color:#8a919c;font-size:11.5px}
.pse-pal-none{color:#7a808a;padding:6px 12px}
.pse-pal-foot{color:#7a808a;font-size:11px;margin-top:4px;padding:0 6px}
`);
}
/* 一个对话框：o = {cmd, title, rows:[…], ok(vals) → 结果, extraButtons?} ；每个控件带 data-k，按钮带 data-act */
const Dlg = PE.dialog = {
  cur:null,
  open(o){
    this.close(); ensureStyle();
    const back = div('pse-back'), box = div('pse-dlg');
    box.dataset.cmd = o.cmd;
    const title = div('pse-title'); title.textContent = o.title; box.appendChild(title);
    const f = {}, rows = {};
    const body = div('pse-body'); box.appendChild(body);
    const addRow = (r, host) => {
      if (r.section){ const s = div('pse-sec'); s.textContent = r.section; host.appendChild(s); return; }
      const row = div('pse-row'); if (r.k) rows[r.k] = row;
      const lb = document.createElement('span'); lb.className = 'lb'; lb.textContent = r.label || ''; row.appendChild(lb);
      let el;
      if (r.type === 'select'){ el = document.createElement('select'); r.options.forEach(([v, t]) => { const op = document.createElement('option'); op.value = v; op.textContent = t; el.appendChild(op); }); el.value = r.value; }
      else if (r.type === 'check'){ el = document.createElement('input'); el.type = 'checkbox'; el.checked = !!r.value; const l = document.createElement('label'); l.style.cssText = 'display:flex;align-items:center;gap:6px'; l.appendChild(el); const t = document.createElement('span'); t.textContent = r.text || ''; l.appendChild(t); row.appendChild(l); }
      else { el = document.createElement('input'); el.type = r.type === 'number' ? 'number' : r.type === 'color' ? 'color' : 'text'; el.value = r.value; if (r.min !== undefined) el.min = r.min; if (r.max !== undefined) el.max = r.max; if (r.step !== undefined) el.step = r.step; }
      el.dataset.k = r.k; f[r.k] = el;
      if (r.type !== 'check') row.appendChild(el);
      if (r.suffix){ const s = document.createElement('span'); s.textContent = r.suffix; row.appendChild(s); }
      host.appendChild(row);
    };
    (o.rows || []).forEach(r => addRow(r, body));
    if (o.build) o.build(body, addRow, f, rows);
    const err = div('pse-err'); box.appendChild(err);
    const bar = div('pse-bar');
    const val = () => { const v = {}; for (const k in f){ const e = f[k]; v[k] = e.type === 'checkbox' ? e.checked : e.type === 'number' ? (e.value === '' ? NaN : +e.value) : e.value; } return v; };
    const btn = (key, act, fn, pri) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = T(key); b.dataset.act = act; if (pri) b.className = 'pri'; b.onclick = fn; bar.appendChild(b); return b; };
    const ok = () => {
      let r; try { r = o.ok(val()); } catch(e){ r = fail(String(e && e.message || e)); }
      if (r && r.ok === false){ err.textContent = r.error || 'error'; return; }
      if (r && r.keepOpen){ err.textContent = r.message || ''; return; }
      this.close(); if (window.UI){ UI.refresh(); }
    };
    (o.extra || []).forEach(x => btn(x.key, x.act, () => { const r = x.fn(val()); err.textContent = (r && (r.error || r.message)) || ''; if (window.UI) UI.refresh(); }));
    btn('pse.cancel', 'cancel', () => this.close());
    btn('pse.ok', 'ok', ok, true);
    box.appendChild(bar);
    back.appendChild(box);
    // 键盘全在对话框里吃掉，别让画板的快捷键（Delete＝清除、V＝移动…）收到
    box.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON'){ e.preventDefault(); ok(); }
      else if (e.key === 'Escape'){ e.preventDefault(); this.close(); }
    });
    back.addEventListener('pointerdown', e => e.stopPropagation());
    back.addEventListener('mousedown', e => e.stopPropagation());
    document.body.appendChild(back);
    this.cur = {el:back, cmd:o.cmd, f, rows};
    if (o.after) o.after(f, rows);
    const first = Array.from(box.querySelectorAll('input,select')).find(e => e.offsetParent !== null);   // 首选项的其他区段是藏着的：聚焦看得到的第一个
    const focus = () => { if (this.cur && this.cur.el === back && first){ first.focus(); if (first.select) try { first.select(); } catch(e){} } };
    focus(); setTimeout(focus, 0);
    return {ok:true, dialog:o.cmd};
  },
  close(){ if (this.cur){ this.cur.el.remove(); this.cur = null; } },
};
/* 对话框记住上次的选择（fill_ui.rs：prefs.dialogs["edit.fill"]） */
const DLG_KEY = 'dlcanvas.ps.dialogs';
const Remember = {
  get(id){ try { return (JSON.parse(localStorage.getItem(DLG_KEY) || '{}') || {})[id] || {}; } catch(e){ return {}; } },
  put(id, v){ try { const all = JSON.parse(localStorage.getItem(DLG_KEY) || '{}') || {}; all[id] = v; localStorage.setItem(DLG_KEY, JSON.stringify(all)); } catch(e){} },
};
const modeOptions = list => (list || MODES).map(m => [m, T('pse.mode.' + m)]);
const runCmd = (id, p) => { const r = CMD.run(id, p); if (window.UI) UI.draw(); return r; };

/* 填充…（fill_ui.rs：内容 9 选 1，跟着内容出「颜色／自定图案／颜色适应」；混合：模式、不透明度、保留透明区域） */
function openFillDialog(){
  const pl = pixelLayer({}); if (pl.error) return fail(pl.error);
  const keep = Remember.get('edit.fill');
  const pats = Patterns.load();
  const v = (k, d) => keep[k] !== undefined ? keep[k] : d;
  return Dlg.open({cmd:'ps.edit.fill', title:T('pse.fill'),
    rows:[
      {k:'contents', label:T('pse.contents'), type:'select', value:v('contents', 'foreground'), options:CONTENTS.map(c => [c, T('pse.c.' + c)])},
      {k:'color', label:T('pse.color'), type:'color', value:v('color', hexOf(fgColor()))},
      {section:T('pse.options')},                                      // PS 2020：「选项」一组（内容识别＝颜色适应、图案＝自定图案）
      {k:'pattern', label:T('pse.customPattern'), type:'select', value:[Patterns.recent, keep.pattern].find(id => id && pats.some(q => q.id === id)) || (pats[0] || {}).id, options:pats.map(q => [q.id, q.name])},
      // PS 2020：「☐ 脚本(S)：［砖形填充 ▾］」同一列；勾了才能挑，确定＝开该脚本自己的对话框
      {k:'scriptName', label:'', type:'select', value:v('scriptName', 'brickFill'), options:(PE.fillScript ? PE.fillScript.names : []).map(s => [s, T('pse.script.' + s)])},
      {k:'colorAdaptation', label:'', type:'check', text:T('pse.colorAdaptation'), value:v('colorAdaptation', true)},
      {section:T('pse.blending')},
      {k:'mode', label:T('pse.mode'), type:'select', value:v('mode', 'normal'), options:modeOptions()},
      {k:'opacity', label:T('pse.opacity'), type:'number', value:v('opacity', 100), min:0, max:100, suffix:'%'},
      {k:'preserveTransparency', label:'', type:'check', text:T('pse.preserveTransparency'), value:v('preserveTransparency', false)},
    ],
    after(f, rows){
      // 「脚本(S)」勾选格塞进下拉那一列的标签位置
      const sc = document.createElement('input'); sc.type = 'checkbox'; sc.dataset.k = 'script'; sc.checked = !!keep.script; f.script = sc;
      const lb = rows.scriptName.querySelector('.lb'), l = document.createElement('label'); l.style.cssText = 'display:inline-flex;align-items:center;gap:6px;justify-content:flex-end;width:100%';
      const t = document.createElement('span'); t.textContent = T('pse.scriptChk'); l.append(sc, t); lb.appendChild(l);
      const sync = () => { const c = f.contents.value; rows.color.classList.toggle('hide', c !== 'color'); rows.pattern.classList.toggle('hide', c !== 'pattern'); rows.scriptName.classList.toggle('hide', c !== 'pattern' || !PE.fillScript); rows.colorAdaptation.classList.toggle('hide', c !== 'contentAware'); f.scriptName.disabled = !sc.checked; };
      f.contents.addEventListener('change', sync); sc.addEventListener('change', sync); sync();
    },
    ok(val){
      Remember.put('edit.fill', val);
      const p = {contents:val.contents, mode:val.mode, opacity:isFinite(val.opacity) ? clamp(Math.round(val.opacity), 0, 100) : 100, preserveTransparency:val.preserveTransparency};
      if (val.contents === 'color') p.color = val.color;
      if (val.contents === 'pattern'){ p.pattern = val.pattern; Patterns.recent = val.pattern; }
      if (val.contents === 'contentAware') p.colorAdaptation = val.colorAdaptation;
      // 勾了脚本：PS 先关填充框、再开那个脚本自己的对话框（预览＋参数；确定才真的填）
      if (val.contents === 'pattern' && val.script && PE.fillScript){
        const r = PE.fillScript.check(val.scriptName); if (r && r.ok === false) return r;
        return PE.fillScript.openDialog(Object.assign(p, {script:val.scriptName}));   // 自己的 DOM，不经 Dlg：填充框照常关
      }
      return runCmd('ps.edit.fill', p);
    }});
}
CMD.reg('ps.edit.fill.dialog', {i18n:'', params:'{} 开「填充」对话框（Shift+F5）；确定＝跑 ps.edit.fill（内容＝图案且勾「脚本」＝改开该脚本的对话框）'}, () => openFillDialog());
/* 描边…（原码用参数说明生成的通用对话框：宽度、颜色、位置、不透明度） */
function openStrokeDialog(){
  const pl = pixelLayer({}); if (pl.error) return fail(pl.error);
  const keep = Remember.get('edit.stroke'), v = (k, d) => keep[k] !== undefined ? keep[k] : d;
  return Dlg.open({cmd:'ps.edit.stroke', title:T('pse.stroke'),
    rows:[
      {section:T('pse.strokeSec')},
      {k:'width', label:T('pse.width'), type:'number', value:v('width', 1), min:1, max:250, suffix:'px'},
      {k:'color', label:T('pse.color'), type:'color', value:hexOf(fgColor())},
      {section:T('pse.location')},
      {k:'location', label:T('pse.location'), type:'select', value:v('location', 'center'), options:['inside', 'center', 'outside'].map(x => [x, T('pse.loc.' + x)])},
      {section:T('pse.blending')},
      {k:'opacity', label:T('pse.opacity'), type:'number', value:v('opacity', 100), min:0, max:100, suffix:'%'},
    ],
    ok(val){
      Remember.put('edit.stroke', {width:val.width, location:val.location, opacity:val.opacity});
      return runCmd('ps.edit.stroke', {width:isFinite(val.width) ? val.width : 1, color:val.color, location:val.location, opacity:isFinite(val.opacity) ? val.opacity : 100});
    }});
}
CMD.reg('ps.edit.stroke.dialog', {i18n:'', params:'{} 开「描边」对话框；确定＝跑 ps.edit.stroke'}, () => openStrokeDialog());
/* 内容识别填充…（prefs_ui.rs:434：通用对话框，拿掉 margin／seed／channel） */
function openCafDialog(){
  const pl = pixelLayer({}); if (pl.error) return fail(pl.error);
  if (!Doc.sel) return fail('Content-Aware Fill needs a selection on a pixel layer');
  const keep = Remember.get('edit.contentAwareFill'), v = (k, d) => keep[k] !== undefined ? keep[k] : d;
  const b = selRect();
  return Dlg.open({cmd:'ps.edit.contentAwareFill', title:T('pse.caf'),
    rows:[
      {section:T('pse.sampling')},
      {k:'sampling', label:T('pse.samplingArea'), type:'select', value:v('sampling', 'auto'), options:['auto', 'rectangular', 'custom'].map(x => [x, T('pse.samp.' + x)])},
      {k:'area', label:T('pse.area'), type:'text', value:`${Math.max(0, b[0] - 40)}, ${Math.max(0, b[1] - 40)}, ${Rc.w(b) + 80}, ${Rc.h(b) + 80}`},
      {section:T('pse.fillSettings')},
      {k:'colorAdaptation', label:T('pse.colorAdaptation'), type:'select', value:v('colorAdaptation', 'default'), options:['none', 'default', 'high', 'veryHigh'].map(x => [x, T('pse.ca.' + x)])},
      {k:'rotationAdaptation', label:T('pse.rotationAdaptation'), type:'select', value:v('rotationAdaptation', 'none'), options:['none', 'low', 'medium', 'high', 'full'].map(x => [x, T('pse.ra.' + x)])},
      {k:'scale', label:'', type:'check', text:T('pse.scale'), value:v('scale', false)},
      {k:'mirror', label:'', type:'check', text:T('pse.mirror'), value:v('mirror', false)},
      {section:T('pse.outputSettings')},
      {k:'output', label:T('pse.outputTo'), type:'select', value:v('output', 'current'), options:['current', 'new', 'duplicate'].map(x => [x, T('pse.out.' + x)])},
    ],
    after(f, rows){ const sync = () => rows.area.classList.toggle('hide', f.sampling.value !== 'custom'); f.sampling.addEventListener('change', sync); sync(); },
    ok(val){
      Remember.put('edit.contentAwareFill', {sampling:val.sampling, colorAdaptation:val.colorAdaptation, rotationAdaptation:val.rotationAdaptation, scale:val.scale, mirror:val.mirror, output:val.output});
      const p = {sampling:val.sampling, colorAdaptation:val.colorAdaptation, rotationAdaptation:val.rotationAdaptation, scale:val.scale, mirror:val.mirror, output:val.output};
      if (val.sampling === 'custom') p.area = String(val.area).split(/[,\s]+/).filter(Boolean).map(Number);
      return runCmd('ps.edit.contentAwareFill', p);
    }});
}
CMD.reg('ps.edit.contentAwareFill.dialog', {i18n:'', params:'{} 开「内容识别填充」对话框（要有选区）；确定＝跑 ps.edit.contentAwareFill'}, () => openCafDialog());
/* 渐隐…（原码通用对话框：不透明度、模式） */
function openFadeDialog(){
  if (History.past.length < 1) return fail('nothing to fade');
  return Dlg.open({cmd:'ps.edit.fade', title:T('pse.fade'),
    rows:[
      {k:'opacity', label:T('pse.opacity'), type:'number', value:100, min:0, max:100, suffix:'%'},
      {k:'mode', label:T('pse.mode'), type:'select', value:'normal', options:modeOptions(['normal', 'multiply', 'screen', 'overlay', 'softLight', 'hardLight', 'darken', 'lighten', 'difference', 'color', 'luminosity'])},
    ],
    ok(val){ return runCmd('ps.edit.fade', {opacity:isFinite(val.opacity) ? val.opacity : 100, mode:val.mode}); }});
}
CMD.reg('ps.edit.fade.dialog', {i18n:'', params:'{} 开「渐隐」对话框（Ctrl+Shift+F）；确定＝跑 ps.edit.fade'}, () => openFadeDialog());
/* 定义图案… ／ 定义画笔预设…：只问名字 */
function openDefineDialog(kind){
  if (kind === 'brush'){ const pl = pixelLayer({}); if (pl.error) return fail(pl.error); }   // 没选区＝取整层（defineBrushPreset）
  const items = Patterns.load();
  let dflt;
  if (kind === 'pattern'){ for (let i = 1; ; i++){ const n = i === 1 ? 'Pattern' : `Pattern ${i}`; if (!items.some(q => q.name === n)){ dflt = n; break; } } }
  else dflt = `Sampled Brush ${BrushPresets.list().filter(b => b.name.startsWith('Sampled Brush')).length + 1}`;
  const id = kind === 'pattern' ? 'ps.edit.definePattern' : 'ps.edit.defineBrushPreset';
  return Dlg.open({cmd:id, title:T(kind === 'pattern' ? 'pse.patternName' : 'pse.brushName'),
    rows:[{k:'name', label:T('pse.name'), type:'text', value:dflt}],
    ok(val){ return runCmd(id, {name:val.name}); }});
}
/* 扭曲／透视：四个角的坐标（我们的变换框只收平行四边形，所以用数字给） */
function openQuadDialog(kind){
  const L = Doc.active(); if (!L) return fail('no active layer');
  if (L.kind !== 'raster' && L.kind !== 'smart') return fail(`Distort and Perspective need a rasterized layer or a smart object (this is a ${L.kind} layer)`);
  const b = L.kind === 'smart' ? contentRect(L) : transformBounds(L); if (!b) return fail('nothing to transform');
  const cs = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]], names = ['tl', 'tr', 'br', 'bl'];
  return Dlg.open({cmd:'ps.edit.transform.' + kind, title:T('pse.' + kind),
    rows:[{section:T('pse.quadHint')}].concat(cs.map((c, i) => ({k:names[i], label:T('pse.corner.' + names[i]), type:'text', value:`${c[0]}, ${c[1]}`}))),
    ok(val){
      const quad = names.map(n => String(val[n]).split(/[,\s]+/).filter(Boolean).map(Number));
      if (quad.some(q => q.length < 2 || !q.every(isFinite))) return fail('x, y');
      return runCmd('ps.edit.transform', {rect:b, quad});
    }});
}
/* 查找和替换文本…（PS 的对话框：查找内容、更改为、搜索所有图层、向前、区分大小写、全字匹配；完成／查找下一个／更改／全部更改／更改/查找） */
function openFindDialog(){
  if (!typeLayers(true).length) return fail('the document has no type layers');
  const keep = Remember.get('edit.findAndReplaceText');
  const rows = [
    {k:'find', label:T('pse.findWhat'), type:'text', value:keep.find || ''},
    {k:'replace', label:T('pse.changeTo'), type:'text', value:keep.replace || ''},
    {k:'allLayers', label:'', type:'check', text:T('pse.allLayers'), value:keep.allLayers !== false},
    {k:'forward', label:'', type:'check', text:T('pse.forward'), value:keep.forward !== false},
    {k:'caseSensitive', label:'', type:'check', text:T('pse.caseSensitive'), value:!!keep.caseSensitive},
    {k:'wholeWord', label:'', type:'check', text:T('pse.wholeWord'), value:!!keep.wholeWord},
  ];
  const go = action => val => {
    Remember.put('edit.findAndReplaceText', val);
    const r = runCmd('ps.edit.findAndReplaceText', Object.assign({}, val, {action}));
    if (r && r.ok === false) return r;
    if (action === 'changeAll') return {ok:true, message:T('pse.replaced').replace('{n}', r.count)};
    return {ok:true, message:r.found ? `“${r.found.text}”` : T('pse.notFound')};
  };
  return Dlg.open({cmd:'ps.edit.findAndReplaceText', title:T('pse.findReplace'), rows,
    extra:[{key:'pse.findNext', act:'find', fn:go('find')}, {key:'pse.change', act:'change', fn:go('change')}, {key:'pse.changeFind', act:'changeFind', fn:go('changeFind')}],
    ok(val){ const r = go('changeAll')(val); return r.ok === false ? r : {ok:true}; }});
}
/* 首选项…：左边区段清单、右边该区段的栏位；确定＝ps.prefs.set（全有或全无） */
function openPrefsDialog(section){
  const cur = Prefs.view();
  const SEC_ROWS = {
    general:[{k:'general.imageInterpolation', label:T('pse.pref.imageInterpolation'), type:'select', options:PREF_CHOICES['general.imageInterpolation'].map(x => [x, T('pse.interp.' + x)])},
             {k:'general.zoomWithScrollWheel', label:'', type:'check', text:T('pse.pref.zoomWithScrollWheel')}],
    interface:[{k:'interface.language', label:T('pse.pref.language'), type:'select', options:[['zh-Hant', '繁體中文'], ['zh-Hans', '简体中文'], ['en', 'English']]},
               {k:'interface.canvasColor', label:T('pse.pref.canvasColor'), type:'select', options:PREF_CHOICES['interface.canvasColor'].map(x => [x, T('pse.cc.' + x)])},
               {k:'interface.canvasCustomColor', label:T('pse.pref.customColor'), type:'color'}],
    tools:[{k:'tools.showTooltips', label:'', type:'check', text:T('pse.pref.showTooltips')}],
    performance:[{k:'performance.historyStates', label:T('pse.pref.historyStates'), type:'number', min:1, max:1000}],
    transparencyAndGamut:[{k:'transparencyAndGamut.gridSize', label:T('pse.pref.gridSize'), type:'select', options:PREF_CHOICES['transparencyAndGamut.gridSize'].map(x => [x, T('pse.gs.' + x)])},
                          {k:'transparencyAndGamut.gridColors', label:T('pse.pref.gridColors'), type:'select', options:PREF_CHOICES['transparencyAndGamut.gridColors'].map(x => [x, T('pse.gc.' + x)])},
                          {k:'transparencyAndGamut.customLight', label:T('pse.pref.customLight'), type:'color'},
                          {k:'transparencyAndGamut.customDark', label:T('pse.pref.customDark'), type:'color'}],
  };
  const all = [].concat(...Object.values(SEC_ROWS));
  all.forEach(r => { r.value = r.k.split('.').reduce((o, k) => o[k], cur); });
  let el = null;
  const r = Dlg.open({cmd:'ps.edit.preferences', title:T('pse.prefs'),
    build(body, addRow, f){
      const wrap = div('pse-prefs'), nav = div('nav'), pane = div('pane');
      wrap.append(nav, pane); body.appendChild(wrap);
      const panes = {};
      SECTIONS.forEach(([sec]) => {
        const it = div(sec === section ? 'on' : ''); it.textContent = T('pse.sec.' + sec); it.dataset.sec = sec; nav.appendChild(it);
        const pn = div(); pn.dataset.sec = sec; pn.style.display = sec === section ? '' : 'none'; panes[sec] = pn; pane.appendChild(pn);
        SEC_ROWS[sec].forEach(row => addRow(row, pn));
        it.onclick = () => { nav.querySelectorAll('div').forEach(d => d.classList.toggle('on', d === it)); Object.entries(panes).forEach(([k, p]) => p.style.display = k === sec ? '' : 'none'); };
      });
      el = f;
    },
    ok(val){
      const ch = [];
      for (const row of all){
        let v = val[row.k];
        if (row.type === 'number') v = Math.round(v);
        if (JSON.stringify(v) !== JSON.stringify(row.value)) ch.push([row.k, v]);
      }
      if (!ch.length) return {ok:true};
      const values = {}; ch.forEach(([k, v]) => values[k] = v);
      return CMD.run('ps.prefs.set', {values});
    }});
  if (Dlg.cur) Dlg.cur.el.querySelector('.pse-dlg').dataset.section = section;
  return r;
}
PE.open = {fill:openFillDialog, stroke:openStrokeDialog, caf:openCafDialog, fade:openFadeDialog, find:openFindDialog, prefs:openPrefsDialog, quad:openQuadDialog};

/* ═══════════ 快捷键（只接 Photoshop 菜单这一组；画板本来没接的才接） ═══════════
   Ctrl+X／C／Shift+C／V／Shift+V、Ctrl+Alt+Shift+V 贴入、Ctrl+Alt+Shift+C 内容识别缩放、Shift+F5 填充、Ctrl+Shift+T 再次、Ctrl+Shift+F 渐隐、Ctrl+F 搜索、Ctrl+K 首选项。
   不接：Ctrl+T（浏览器保留给新分页，网页拦不到）、Delete（ui.js 已对到 edit.delete，钢笔等工具也用 Backspace）。
   挂在 window 捕获阶段：比 ui.js 的 document 监听早，接了就停传，免得 Shift+Backspace 之类被画板再处理一次。 */
window.addEventListener('keydown', e => {
  // 对话框开着、焦点却不在框里（例如点了框外）：Esc 照样关
  if (Dlg.cur && e.key === 'Escape' && !Dlg.cur.el.contains(e.target)){ e.preventDefault(); e.stopPropagation(); Dlg.close(); return; }
  if (!window.Menubar || Menubar.app !== 'ps' || Dlg.cur || Palette.el || (PE.fillScript && PE.fillScript.cur)) return;
  const t = e.target;
  if (t && (/^(input|select|textarea)$/i.test(t.tagName) || t.isContentEditable)) return;
  const ctrl = e.ctrlKey || e.metaKey, c = e.code;
  let act = null;
  if (ctrl && !e.altKey){
    if (c === 'KeyX' && !e.shiftKey) act = () => runCmd('ps.edit.cut');
    else if (c === 'KeyC') act = () => runCmd(e.shiftKey ? 'ps.edit.copyMerged' : 'ps.edit.copy');
    else if (c === 'KeyV') act = () => runCmd(e.shiftKey ? 'ps.edit.pasteSpecial.pasteInPlace' : 'ps.edit.paste');
    else if (c === 'KeyT' && e.shiftKey) act = () => runCmd('ps.edit.transform.again');
    else if (c === 'KeyF' && e.shiftKey) act = () => runCmd('ps.edit.fade.dialog');
    else if (c === 'KeyF' && !e.shiftKey) act = () => runCmd('ps.edit.search');                       // PS 2020：搜索＝Ctrl+F
    else if (c === 'KeyK' && !e.shiftKey) act = () => runCmd('ps.edit.preferences.general', {dialog:true}); // PS：Ctrl+K＝首选项
  } else if (ctrl && e.altKey && e.shiftKey && c === 'KeyV') act = () => runCmd('ps.edit.pasteSpecial.pasteInto');
  else if (ctrl && e.altKey && e.shiftKey && c === 'KeyC') act = () => runCmd('ps.edit.contentAwareScale.dialog');
  else if (ctrl && e.altKey && e.shiftKey && c === 'KeyT') act = () => runCmd('ps.edit.transform.again', {duplicate:true});   // PS：再次变换并复制（菜单上没有这项，只有快捷键）
  else if (!ctrl && !e.altKey && e.shiftKey && e.key === 'F5') act = () => runCmd('ps.edit.fill.dialog');
  // PS：Alt+Delete／Backspace＝填前景色、Ctrl+Delete＝填背景色（加 Shift＝保留透明区域）；Ctrl+Shift+Alt+N＝不开框直接新建图层
  if (!act && (c === 'Delete' || c === 'Backspace') && (e.altKey !== ctrl)) act = () => runCmd('ps.edit.fill', {contents:e.altKey ? 'foreground' : 'background', preserveTransparency:e.shiftKey});
  if (!act && ctrl && e.altKey && e.shiftKey && c === 'KeyN') act = () => runCmd('layer.newRaster');
  if (!act) return;
  e.preventDefault(); e.stopPropagation();
  try { const r = act(); if (r && r.ok === false) console.warn(r.error); } catch(err){ console.error(err); }
}, true);

/* ═══════════ 三语字串 ═══════════ */
const MODE_ZH = {
  'zh-Hant':{normal:'正常', dissolve:'溶解', darken:'變暗', multiply:'色彩增值', colorBurn:'加深顏色', linearBurn:'線性加深', darkerColor:'顏色變暗',
    lighten:'變亮', screen:'濾色', colorDodge:'加亮顏色', linearDodge:'線性加亮 (增加)', lighterColor:'顏色變亮', overlay:'覆蓋', softLight:'柔光',
    hardLight:'實光', vividLight:'強烈光源', linearLight:'線性光源', pinLight:'小光源', hardMix:'實色疊印混合', difference:'差異化', exclusion:'排除',
    subtract:'減去', divide:'分割', hue:'色相', saturation:'飽和度', color:'顏色', luminosity:'明度'},
  'zh-Hans':{normal:'正常', dissolve:'溶解', darken:'变暗', multiply:'正片叠底', colorBurn:'颜色加深', linearBurn:'线性加深', darkerColor:'深色',
    lighten:'变亮', screen:'滤色', colorDodge:'颜色减淡', linearDodge:'线性减淡（添加）', lighterColor:'浅色', overlay:'叠加', softLight:'柔光',
    hardLight:'强光', vividLight:'亮光', linearLight:'线性光', pinLight:'点光', hardMix:'实色混合', difference:'差值', exclusion:'排除',
    subtract:'减去', divide:'划分', hue:'色相', saturation:'饱和度', color:'颜色', luminosity:'明度'},
};
const STR = {
  'zh-Hant':{
    'pse.cascale':'內容感知比例', 'pse.w':'寬度：', 'pse.h':'高度：', 'pse.amount':'總量：', 'pse.protectSkin':'保護膚色',
    'pse.presetManager':'預設集管理員', 'pse.presetType':'預設集類型：', 'pse.pk.patterns':'圖樣', 'pse.pk.brushes':'筆刷', 'pse.presets':'項目：', 'pse.newName':'新名稱：',
    'pse.rename':'重新命名', 'pse.delete':'刪除', 'pse.presetsIO':'轉存/讀入預設集', 'pse.action':'動作：', 'pse.export':'轉存預設集', 'pse.import':'讀入預設集',
    'pse.ok':'確定', 'pse.cancel':'取消', 'pse.tool':'工具', 'pse.name':'名稱：',
    'pse.fill':'填滿', 'pse.contents':'內容：', 'pse.color':'顏色：', 'pse.customPattern':'自訂圖樣：', 'pse.colorAdaptation':'顏色適應',
    'pse.options':'選項', 'pse.blending':'混合', 'pse.mode':'模式：', 'pse.opacity':'不透明：', 'pse.preserveTransparency':'保留透明度',
    'pse.c.foreground':'前景色', 'pse.c.background':'背景色', 'pse.c.color':'顏色…', 'pse.c.contentAware':'內容感知', 'pse.c.pattern':'圖樣',
    'pse.c.history':'步驟記錄', 'pse.c.black':'黑色', 'pse.c.gray':'50% 灰色', 'pse.c.white':'白色',
    'pse.stroke':'筆畫', 'pse.strokeSec':'筆畫', 'pse.width':'寬度：', 'pse.location':'位置', 'pse.loc.inside':'內側', 'pse.loc.center':'居中', 'pse.loc.outside':'外側',
    'pse.caf':'內容感知填色', 'pse.sampling':'取樣區域選項', 'pse.samplingArea':'取樣區域：', 'pse.samp.auto':'自動', 'pse.samp.rectangular':'矩形', 'pse.samp.custom':'自訂',
    'pse.area':'自訂區域 x, y, 寬, 高：', 'pse.fillSettings':'填色設定', 'pse.rotationAdaptation':'旋轉適應：', 'pse.scale':'縮放', 'pse.mirror':'鏡射',
    'pse.ca.none':'無', 'pse.ca.default':'預設', 'pse.ca.high':'高', 'pse.ca.veryHigh':'非常高',
    'pse.ra.none':'無', 'pse.ra.low':'低', 'pse.ra.medium':'中', 'pse.ra.high':'高', 'pse.ra.full':'完整',
    'pse.outputSettings':'輸出設定', 'pse.outputTo':'輸出至：', 'pse.out.current':'目前圖層', 'pse.out.new':'新增圖層', 'pse.out.duplicate':'複製圖層',
    'pse.fade':'淡化', 'pse.patternName':'圖樣名稱', 'pse.brushName':'筆刷名稱',
    'pse.distort':'扭曲', 'pse.perspective':'透視', 'pse.quadHint':'內容外框四角移到（x, y）',
    'pse.corner.tl':'左上：', 'pse.corner.tr':'右上：', 'pse.corner.br':'右下：', 'pse.corner.bl':'左下：',
    'pse.findReplace':'尋找和取代文字', 'pse.findWhat':'尋找目標：', 'pse.changeTo':'變更為：', 'pse.allLayers':'搜尋所有圖層', 'pse.forward':'向前',
    'pse.caseSensitive':'區分大小寫', 'pse.wholeWord':'全字拼寫須相符', 'pse.findNext':'尋找下一個', 'pse.change':'變更', 'pse.changeFind':'變更/尋找',
    'pse.replaced':'已取代 {n} 處', 'pse.notFound':'找不到',
    'pse.prefs':'偏好設定', 'pse.sec.general':'一般', 'pse.sec.interface':'介面', 'pse.sec.tools':'工具', 'pse.sec.performance':'效能', 'pse.sec.transparencyAndGamut':'透明度與色域',
    'pse.pref.imageInterpolation':'影像內插補點：', 'pse.pref.zoomWithScrollWheel':'用滾輪縮放', 'pse.pref.language':'UI 語言：', 'pse.pref.canvasColor':'標準螢幕模式：',
    'pse.pref.customColor':'自訂顏色：', 'pse.pref.showTooltips':'顯示工具提示', 'pse.pref.historyStates':'步驟記錄狀態：',
    'pse.pref.gridSize':'格點大小：', 'pse.pref.gridColors':'格點顏色：', 'pse.pref.customLight':'亮色：', 'pse.pref.customDark':'暗色：',
    'pse.interp.bicubicAutomatic':'環迴增值法 (自動)', 'pse.interp.nearestNeighbor':'最接近像素 (保留硬邊)', 'pse.interp.bilinear':'縱橫增值法', 'pse.interp.bicubic':'環迴增值法 (平滑漸層)',
    'pse.interp.bicubicSmoother':'環迴增值法更平滑 (放大)', 'pse.interp.bicubicSharper':'環迴增值法更銳利 (縮小)', 'pse.interp.preserveDetails':'保留細節 (放大)',
    'pse.cc.default':'預設', 'pse.cc.black':'黑色', 'pse.cc.darkGray':'深灰色', 'pse.cc.mediumGray':'中灰色', 'pse.cc.lightGray':'淺灰色', 'pse.cc.custom':'選取自訂顏色…',
    'pse.gs.none':'無', 'pse.gs.small':'小', 'pse.gs.medium':'中', 'pse.gs.large':'大',
    'pse.gc.light':'淺色', 'pse.gc.medium':'中間色', 'pse.gc.dark':'深色', 'pse.gc.red':'紅色', 'pse.gc.orange':'橙色', 'pse.gc.green':'綠色', 'pse.gc.blue':'藍色', 'pse.gc.purple':'紫色', 'pse.gc.custom':'自訂',
    'pse.searchHint':'搜尋指令、工具…', 'pse.searchNone':'沒有相符的指令', 'pse.searchFoot':'↑↓ 選擇   Enter 執行   Esc 關閉',
  },
  'zh-Hans':{
    'pse.cascale':'内容识别缩放', 'pse.w':'宽度：', 'pse.h':'高度：', 'pse.amount':'数量：', 'pse.protectSkin':'保护肤色',
    'pse.presetManager':'预设管理器', 'pse.presetType':'预设类型：', 'pse.pk.patterns':'图案', 'pse.pk.brushes':'画笔', 'pse.presets':'项目：', 'pse.newName':'新名称：',
    'pse.rename':'重命名', 'pse.delete':'删除', 'pse.presetsIO':'导出/导入预设', 'pse.action':'动作：', 'pse.export':'导出预设', 'pse.import':'导入预设',
    'pse.ok':'确定', 'pse.cancel':'取消', 'pse.tool':'工具', 'pse.name':'名称：',
    'pse.fill':'填充', 'pse.contents':'内容：', 'pse.color':'颜色：', 'pse.customPattern':'自定图案：', 'pse.colorAdaptation':'颜色适应',
    'pse.options':'选项', 'pse.blending':'混合', 'pse.mode':'模式：', 'pse.opacity':'不透明度：', 'pse.preserveTransparency':'保留透明区域',
    'pse.c.foreground':'前景色', 'pse.c.background':'背景色', 'pse.c.color':'颜色…', 'pse.c.contentAware':'内容识别', 'pse.c.pattern':'图案',
    'pse.c.history':'历史记录', 'pse.c.black':'黑色', 'pse.c.gray':'50% 灰色', 'pse.c.white':'白色',
    'pse.stroke':'描边', 'pse.strokeSec':'描边', 'pse.width':'宽度：', 'pse.location':'位置', 'pse.loc.inside':'内部', 'pse.loc.center':'居中', 'pse.loc.outside':'居外',
    'pse.caf':'内容识别填充', 'pse.sampling':'取样区域选项', 'pse.samplingArea':'取样区域：', 'pse.samp.auto':'自动', 'pse.samp.rectangular':'矩形', 'pse.samp.custom':'自定',
    'pse.area':'自定区域 x, y, 宽, 高：', 'pse.fillSettings':'填充设置', 'pse.rotationAdaptation':'旋转适应：', 'pse.scale':'缩放', 'pse.mirror':'镜像',
    'pse.ca.none':'无', 'pse.ca.default':'默认', 'pse.ca.high':'高', 'pse.ca.veryHigh':'非常高',
    'pse.ra.none':'无', 'pse.ra.low':'低', 'pse.ra.medium':'中', 'pse.ra.high':'高', 'pse.ra.full':'完整',
    'pse.outputSettings':'输出设置', 'pse.outputTo':'输出到：', 'pse.out.current':'当前图层', 'pse.out.new':'新建图层', 'pse.out.duplicate':'复制图层',
    'pse.fade':'渐隐', 'pse.patternName':'图案名称', 'pse.brushName':'画笔名称',
    'pse.distort':'扭曲', 'pse.perspective':'透视', 'pse.quadHint':'内容外框四角移到（x, y）',
    'pse.corner.tl':'左上：', 'pse.corner.tr':'右上：', 'pse.corner.br':'右下：', 'pse.corner.bl':'左下：',
    'pse.findReplace':'查找和替换文本', 'pse.findWhat':'查找内容：', 'pse.changeTo':'更改为：', 'pse.allLayers':'搜索所有图层', 'pse.forward':'向前',
    'pse.caseSensitive':'区分大小写', 'pse.wholeWord':'全字匹配', 'pse.findNext':'查找下一个', 'pse.change':'更改', 'pse.changeFind':'更改/查找',
    'pse.replaced':'已替换 {n} 处', 'pse.notFound':'没找到',
    'pse.prefs':'首选项', 'pse.sec.general':'常规', 'pse.sec.interface':'界面', 'pse.sec.tools':'工具', 'pse.sec.performance':'性能', 'pse.sec.transparencyAndGamut':'透明度与色域',
    'pse.pref.imageInterpolation':'图像插值：', 'pse.pref.zoomWithScrollWheel':'用滚轮缩放', 'pse.pref.language':'UI 语言：', 'pse.pref.canvasColor':'标准屏幕模式：',
    'pse.pref.customColor':'自定颜色：', 'pse.pref.showTooltips':'显示工具提示', 'pse.pref.historyStates':'历史记录状态：',
    'pse.pref.gridSize':'网格大小：', 'pse.pref.gridColors':'网格颜色：', 'pse.pref.customLight':'亮色：', 'pse.pref.customDark':'暗色：',
    'pse.interp.bicubicAutomatic':'两次立方（自动）', 'pse.interp.nearestNeighbor':'邻近（硬边缘）', 'pse.interp.bilinear':'两次线性', 'pse.interp.bicubic':'两次立方（平滑渐变）',
    'pse.interp.bicubicSmoother':'两次立方（较平滑）（扩大）', 'pse.interp.bicubicSharper':'两次立方（较锐利）（缩减）', 'pse.interp.preserveDetails':'保留细节（扩大）',
    'pse.cc.default':'默认', 'pse.cc.black':'黑色', 'pse.cc.darkGray':'深灰', 'pse.cc.mediumGray':'中灰', 'pse.cc.lightGray':'浅灰', 'pse.cc.custom':'选择自定颜色…',
    'pse.gs.none':'无', 'pse.gs.small':'小', 'pse.gs.medium':'中', 'pse.gs.large':'大',
    'pse.gc.light':'浅', 'pse.gc.medium':'中', 'pse.gc.dark':'深', 'pse.gc.red':'红色', 'pse.gc.orange':'橙色', 'pse.gc.green':'绿色', 'pse.gc.blue':'蓝色', 'pse.gc.purple':'紫色', 'pse.gc.custom':'自定',
    'pse.searchHint':'搜索命令、工具…', 'pse.searchNone':'没有匹配的命令', 'pse.searchFoot':'↑↓ 选择   Enter 执行   Esc 关闭',
  },
  'en':{
    'pse.cascale':'Content-Aware Scale', 'pse.w':'Width:', 'pse.h':'Height:', 'pse.amount':'Amount:', 'pse.protectSkin':'Protect Skin Tones',
    'pse.presetManager':'Preset Manager', 'pse.presetType':'Preset Type:', 'pse.pk.patterns':'Patterns', 'pse.pk.brushes':'Brushes', 'pse.presets':'Presets:', 'pse.newName':'New name:',
    'pse.rename':'Rename', 'pse.delete':'Delete', 'pse.presetsIO':'Export/Import Presets', 'pse.action':'Action:', 'pse.export':'Export Presets', 'pse.import':'Import Presets',
    'pse.ok':'OK', 'pse.cancel':'Cancel', 'pse.tool':'Tool', 'pse.name':'Name:',
    'pse.fill':'Fill', 'pse.contents':'Contents:', 'pse.color':'Color:', 'pse.customPattern':'Custom Pattern:', 'pse.colorAdaptation':'Color Adaptation',
    'pse.options':'Options', 'pse.blending':'Blending', 'pse.mode':'Mode:', 'pse.opacity':'Opacity:', 'pse.preserveTransparency':'Preserve Transparency',
    'pse.c.foreground':'Foreground Color', 'pse.c.background':'Background Color', 'pse.c.color':'Color…', 'pse.c.contentAware':'Content-Aware', 'pse.c.pattern':'Pattern',
    'pse.c.history':'History', 'pse.c.black':'Black', 'pse.c.gray':'50% Gray', 'pse.c.white':'White',
    'pse.stroke':'Stroke', 'pse.strokeSec':'Stroke', 'pse.width':'Width:', 'pse.location':'Location', 'pse.loc.inside':'Inside', 'pse.loc.center':'Center', 'pse.loc.outside':'Outside',
    'pse.caf':'Content-Aware Fill', 'pse.sampling':'Sampling Area Options', 'pse.samplingArea':'Sampling Area:', 'pse.samp.auto':'Auto', 'pse.samp.rectangular':'Rectangular', 'pse.samp.custom':'Custom',
    'pse.area':'Custom area x, y, w, h:', 'pse.fillSettings':'Fill Settings', 'pse.rotationAdaptation':'Rotation Adaptation:', 'pse.scale':'Scale', 'pse.mirror':'Mirror',
    'pse.ca.none':'None', 'pse.ca.default':'Default', 'pse.ca.high':'High', 'pse.ca.veryHigh':'Very High',
    'pse.ra.none':'None', 'pse.ra.low':'Low', 'pse.ra.medium':'Medium', 'pse.ra.high':'High', 'pse.ra.full':'Full',
    'pse.outputSettings':'Output Settings', 'pse.outputTo':'Output To:', 'pse.out.current':'Current Layer', 'pse.out.new':'New Layer', 'pse.out.duplicate':'Duplicate Layer',
    'pse.fade':'Fade', 'pse.patternName':'Pattern Name', 'pse.brushName':'Brush Name',
    'pse.distort':'Distort', 'pse.perspective':'Perspective', 'pse.quadHint':'Move the corners of the content bounds to (x, y)',
    'pse.corner.tl':'Top left:', 'pse.corner.tr':'Top right:', 'pse.corner.br':'Bottom right:', 'pse.corner.bl':'Bottom left:',
    'pse.findReplace':'Find and Replace Text', 'pse.findWhat':'Find What:', 'pse.changeTo':'Change To:', 'pse.allLayers':'Search All Layers', 'pse.forward':'Forward',
    'pse.caseSensitive':'Case Sensitive', 'pse.wholeWord':'Whole Word Only', 'pse.findNext':'Find Next', 'pse.change':'Change', 'pse.changeFind':'Change/Find',
    'pse.replaced':'{n} replaced', 'pse.notFound':'Not found',
    'pse.prefs':'Preferences', 'pse.sec.general':'General', 'pse.sec.interface':'Interface', 'pse.sec.tools':'Tools', 'pse.sec.performance':'Performance', 'pse.sec.transparencyAndGamut':'Transparency & Gamut',
    'pse.pref.imageInterpolation':'Image Interpolation:', 'pse.pref.zoomWithScrollWheel':'Zoom with Scroll Wheel', 'pse.pref.language':'UI Language:', 'pse.pref.canvasColor':'Standard Screen Mode:',
    'pse.pref.customColor':'Custom Color:', 'pse.pref.showTooltips':'Show Tool Tips', 'pse.pref.historyStates':'History States:',
    'pse.pref.gridSize':'Grid Size:', 'pse.pref.gridColors':'Grid Colors:', 'pse.pref.customLight':'Light:', 'pse.pref.customDark':'Dark:',
    'pse.interp.bicubicAutomatic':'Bicubic Automatic', 'pse.interp.nearestNeighbor':'Nearest Neighbor (preserve hard edges)', 'pse.interp.bilinear':'Bilinear', 'pse.interp.bicubic':'Bicubic (smooth gradients)',
    'pse.interp.bicubicSmoother':'Bicubic Smoother (enlargement)', 'pse.interp.bicubicSharper':'Bicubic Sharper (reduction)', 'pse.interp.preserveDetails':'Preserve Details (enlargement)',
    'pse.cc.default':'Default', 'pse.cc.black':'Black', 'pse.cc.darkGray':'Dark Gray', 'pse.cc.mediumGray':'Medium Gray', 'pse.cc.lightGray':'Light Gray', 'pse.cc.custom':'Select Custom Color…',
    'pse.gs.none':'None', 'pse.gs.small':'Small', 'pse.gs.medium':'Medium', 'pse.gs.large':'Large',
    'pse.gc.light':'Light', 'pse.gc.medium':'Medium', 'pse.gc.dark':'Dark', 'pse.gc.red':'Red', 'pse.gc.orange':'Orange', 'pse.gc.green':'Green', 'pse.gc.blue':'Blue', 'pse.gc.purple':'Purple', 'pse.gc.custom':'Custom',
    'pse.searchHint':'Search commands, tools and panels…', 'pse.searchNone':'No matching commands', 'pse.searchFoot':'↑↓ navigate   Enter run   Esc close',
  },
};
for (const m of MODES){ STR.en['pse.mode.' + m] = MODE_EN[m]; STR['zh-Hant']['pse.mode.' + m] = MODE_ZH['zh-Hant'][m]; STR['zh-Hans']['pse.mode.' + m] = MODE_ZH['zh-Hans'][m]; }
Lang.add(STR);

/* 页面载好后：套用存下来的首选项、接滚轮 */
function boot(){ bindWheel(); Prefs.apply(null, false); }
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0)); else boot();

PE.clip = () => Clip ? {bounds:Clip.bounds.slice(), w:Rc.w(Clip.bounds), h:Rc.h(Clip.bounds)} : null;
PE.lastTransform = () => lastXf;
})();

/* ════════════════════════════════════════════════════════════════════════════════════════════════
   编辑菜单其余各项照原码抄。🔴 以下各段接在档尾、不改上面既有段落。
   每段一个自足的 IIFE（各自有 PE._pse3_<段> 防重挂）：
     首选项全 18 区段／单位与标尺／网格参考线接视图菜单／光标／历史记录日志／自动存储恢复／键盘快捷键／菜单／工具栏（prefs.rs、prefs_ui.rs、rulers.rs）
     剪切／拷贝／粘贴走 PS／AI 共用剪贴簿 DlClipboard（menus/impl/clipboard.js）
     颜色设置／指定配置文件／转换为配置文件（color_cmds.rs、cms/）
     变换 ▸ 变形＋四个拆分变形（warp_cmds.rs、geom/warp.rs、algo/warp.rs）
     操控变形／透视变形（distort_cmds.rs、algo/puppet.rs、algo/perspective.rs）
     自动对齐图层／自动混合图层（align_cmds.rs、algo/panorama.rs、features.rs、pyramid.rs）
     拼写检查／定义自定形状／迁移预设（type_spell_cmds.rs、text/spell.rs、edit_menu_cmds.rs、migrate_cmds.rs）
   ════════════════════════════════════════════════════════════════════════════════════════════════ */

/* ═══════════ 首选项全 18 区段／单位与标尺／网格／光标／历史记录日志／自动存储恢复／键盘快捷键／菜单／工具栏
   照 photocraft：engine/src/prefs.rs（各区段栏位与预设 156-711、choices 855-887、range 890-909、is_color 912-929、
   HIDDEN_UNTIL_IMPLEMENTED 782-847、normalize_shortcut 1081-1147、prefs.set／reset 1318-1368、keyboard_shortcuts 1379-1433、
   menus 1436-1473、toolbar 1476-1490、specs 1509-1567）；ui-egui/src/prefs_ui.rs（对话框 529-846、快捷键／菜单／工具栏页 850-1036、
   confirm 1129-1157、history_log 280-309、autosave 227-277）；ui-egui/src/rulers.rs（nice_step 37-48、draw_grid 71-93、draw_rulers 165-260）；
   ui-egui/src/canvas.rs:1600-1660（Preferences › Cursors 的笔尖圈／十字线／其它光标）。
   做法：既有的 PsEdit.prefs（本档 1783-1905 行）只认 5 个区段；这里不动那段，改在它的物件上包一层（view／check／set／reset／apply），
   让 18 个区段全收、照原码验值；对话框换成 18 区段版（DOM 惯例同旧版：cmd='ps.edit.preferences'、.pse-prefs .nav div[data-sec]、data-k='区段.键'）。
   🔴 原码规矩「没作用的控件比没有还糟」（prefs.rs:776）：对话框只摆画板真的接上的栏位；接不上的照样存、照样 prefs.get/set 得到，只是不摆。 */
(function(){
'use strict';
const PE = window.PsEdit; if (!PE || PE._pse3_prefs) return; PE._pse3_prefs = true;
const T = k => Lang.t(k);
const fail = msg => ({ok:false, error:msg});
const P = PE.prefs, Dlg = PE.dialog;
const PREF_KEY = 'dlcanvas.ps.prefs';
const clone = o => JSON.parse(JSON.stringify(o));

/* ── prefs.rs:156-711 各区段 Default（全部栏位，含藏起来的） ── */
const FULL = {
  general:{colorPicker:'adobe', imageInterpolation:'bicubicAutomatic', beepWhenDone:false, exportClipboard:true, resizeImageDuringPlace:true,
    alwaysCreateSmartObjectsWhenPlacing:true, zoomWithScrollWheel:false, animatedZoom:true, zoomResizesWindows:false, useLegacyFreeTransform:false, autoShowHomeScreen:true},
  interface:{theme:'proMedium', canvasColor:'default', canvasCustomColor:'#282828', canvasBorder:'dropShadow', uiScale:'auto', language:'auto',
    uiFontSize:'small', showChannelsInColor:false, dynamicColorSliders:true, showMenuColors:true, showTooltips:true},
  workspace:{autoCollapseIconPanels:false, autoShowHiddenPanels:true, openDocumentsAsTabs:true, enableFloatingDocumentWindowDocking:true, largeTabs:false,
    enableNarrowOptionsBar:false, rememberWorkspaceChanges:true},
  tools:{showTooltips:true, useShiftKeyForToolSwitch:false, zoomClickedPointToCenter:false, enableFlickPanning:true, varyRoundBrushHardnessOnHud:true,
    snapVectorToolsAndTransformsToPixelGrid:true, showTransformationValues:true, overscroll:true, doubleClickLayerMaskLaunchesSelectAndMask:true,
    rightClickWithPaintingTools:'brushPicker', useTabletPressure:true},
  historyLog:{enabled:false, destination:'metadata', filePath:'', detail:'concise'},
  fileHandling:{imagePreviews:'always', lowercaseExtension:true, saveInBackground:true, autosave:true, autosaveMinutes:10, recoverOnLaunch:true,
    ignoreExifProfileTag:false, askBeforeSavingLayeredTiff:true, maximizePsdCompatibility:'always', recentFileCount:20, recentFiles:[]},
  export:{quickExportFormat:'png', quickExportLocation:'ask', jpegQuality:85, metadata:'copyright', convertToSrgb:true},
  performance:{memoryUsageMb:8192, historyStates:50, cacheLevels:4, cacheTileSize:8192, useGpu:true, gpuBackend:'auto', effectCacheMb:768, legacyCompositing:false},
  scratchDisks:{disks:[{path:'(system temp)', enabled:true}]},
  cursors:{painting:'normalTip', showCrosshairInBrushTip:false, showOnlyCrosshairWhilePainting:false, other:'standard', brushPreviewColor:'#ff0000'},
  transparencyAndGamut:{gridSize:'medium', gridColors:'light', customLight:'#ffffff', customDark:'#cccccc', gamutWarningColor:'#808080', gamutWarningOpacity:100},
  unitsAndRulers:{rulers:'pixels', typeUnits:'points', columnWidth:180, gutter:12, printResolution:300, screenResolution:72, pointSize:'postScript'},
  guidesGridAndSlices:{guideColor:'#4affff', guideStyle:'lines', smartGuideColor:'#ff00ff', gridColor:'#8c8c8c', gridStyle:'lines', gridlineEvery:1,
    gridUnit:'inches', subdivisions:4, sliceColor:'#38b5ff', showSliceNumbers:true},
  plugIns:{useAdditionalPluginsFolder:false, additionalPluginsFolder:'', showExtensionPanels:true, allowScriptsToConnect:false, generatorEnabled:false},
  type:{smartQuotes:true, missingGlyphProtection:true, showFontNamesInEnglish:true, useEscToCommit:true, textEngine:'worldReady', fontPreview:'medium',
    fillNewTypeLayersWithPlaceholder:true, recentFonts:10},
  enhancedControls:{scrubbySliderAcceleration:true, touchGestures:true, zoomWithTrackpadPinch:true, rotateViewWithTrackpad:false},
  rawDefaults:{colorSpace:'adobeRgb', bitDepth:'16', resolution:300, sharpenFor:'none', openAsSmartObject:false, applyAutoTone:false},
  integrations:{allowAgentControl:true, controlPort:0},
};
/* prefs.rs:755 SECTIONS（PS 的顺序） */
const SECTIONS = ['general', 'interface', 'workspace', 'tools', 'historyLog', 'fileHandling', 'export', 'performance', 'scratchDisks', 'cursors',
  'transparencyAndGamut', 'unitsAndRulers', 'guidesGridAndSlices', 'plugIns', 'type', 'enhancedControls', 'rawDefaults', 'integrations'];
const UNITS = ['pixels', 'inches', 'cm', 'mm', 'points', 'picas', 'percent'];
const LINE_STYLES = ['lines', 'dashedLines', 'dots'];
/* prefs.rs:855 choices */
const CHOICES = {
  'general.colorPicker':['adobe', 'system'],
  'general.imageInterpolation':['bicubicAutomatic', 'nearestNeighbor', 'bilinear', 'bicubic', 'bicubicSmoother', 'bicubicSharper', 'preserveDetails'],
  'interface.theme':['pro', 'proMedium', 'studio', 'studioLight', 'classic'],
  'interface.canvasColor':['default', 'black', 'darkGray', 'mediumGray', 'lightGray', 'custom'],
  'interface.canvasBorder':['dropShadow', 'line', 'none'],
  'interface.uiScale':['auto', '100', '200'],
  'interface.uiFontSize':['tiny', 'small', 'medium', 'large'],
  'historyLog.destination':['metadata', 'textFile', 'both'],
  'historyLog.detail':['sessionsOnly', 'concise', 'detailed'],
  'fileHandling.imagePreviews':['always', 'never', 'ask'], 'fileHandling.maximizePsdCompatibility':['always', 'never', 'ask'],
  'export.quickExportFormat':['png', 'jpg', 'gif', 'webp'], 'export.quickExportLocation':['ask', 'sameFolder'], 'export.metadata':['none', 'copyright', 'all'],
  'cursors.painting':['standard', 'precise', 'normalTip', 'fullSizeTip'], 'cursors.other':['standard', 'precise'],
  'tools.rightClickWithPaintingTools':['brushPicker', 'erase'],
  'transparencyAndGamut.gridSize':['none', 'small', 'medium', 'large'],
  'transparencyAndGamut.gridColors':['light', 'medium', 'dark', 'red', 'orange', 'green', 'blue', 'purple', 'custom'],
  'unitsAndRulers.rulers':UNITS, 'guidesGridAndSlices.gridUnit':UNITS,
  'unitsAndRulers.typeUnits':['points', 'pixels', 'mm'], 'unitsAndRulers.pointSize':['postScript', 'traditional'],
  'guidesGridAndSlices.guideStyle':LINE_STYLES, 'guidesGridAndSlices.gridStyle':LINE_STYLES,
  'type.textEngine':['modern', 'eastAsian', 'worldReady'], 'type.fontPreview':['off', 'small', 'medium', 'large', 'extraLarge', 'huge'],
  'rawDefaults.colorSpace':['srgb', 'adobeRgb', 'proPhoto', 'displayP3'], 'rawDefaults.bitDepth':['8', '16'], 'rawDefaults.sharpenFor':['none', 'screen', 'glossy', 'matte'],
  'performance.gpuBackend':['auto', 'vulkan', 'dx12', 'metal', 'gl', 'cpu'],
};
/* prefs.rs:890 range */
const RANGE = {
  'fileHandling.autosaveMinutes':[1, 240], 'fileHandling.recentFileCount':[0, 100], 'export.jpegQuality':[1, 100],
  'performance.memoryUsageMb':[256, 1048576], 'performance.historyStates':[1, 1000], 'performance.cacheLevels':[1, 8], 'performance.cacheTileSize':[256, 16384],
  'performance.effectCacheMb':[16, 65536], 'transparencyAndGamut.gamutWarningOpacity':[1, 100],
  'unitsAndRulers.columnWidth':[0, 10000], 'unitsAndRulers.gutter':[0, 10000], 'unitsAndRulers.printResolution':[1, 10000], 'unitsAndRulers.screenResolution':[1, 10000],
  'rawDefaults.resolution':[1, 10000], 'guidesGridAndSlices.gridlineEvery':[0.001, 10000], 'guidesGridAndSlices.subdivisions':[1, 100],
  'type.recentFonts':[0, 50], 'integrations.controlPort':[0, 65535],
};
/* 原码是 u32 的栏位（serde 收不下小数） */
const INTS = new Set(['fileHandling.autosaveMinutes', 'fileHandling.recentFileCount', 'export.jpegQuality', 'performance.memoryUsageMb', 'performance.historyStates',
  'performance.cacheLevels', 'performance.cacheTileSize', 'performance.effectCacheMb', 'transparencyAndGamut.gamutWarningOpacity', 'guidesGridAndSlices.subdivisions',
  'type.recentFonts', 'integrations.controlPort']);
/* prefs.rs:912 is_color */
const COLOR_KEYS = new Set(['guideColor', 'smartGuideColor', 'gridColor', 'sliceColor', 'canvasCustomColor', 'brushPreviewColor', 'gamutWarningColor', 'customLight', 'customDark']);
/* prefs.rs:1440 菜单颜色 */
const MENU_COLORS = ['none', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'gray'];
/* 旧版（本档 1785 行）认得的键：照旧由旧的 check 验（介面语言只收三语） */
const OLD_KEYS = new Set(['general.imageInterpolation', 'general.zoomWithScrollWheel', 'interface.language', 'interface.canvasColor', 'interface.canvasCustomColor',
  'tools.showTooltips', 'performance.historyStates', 'transparencyAndGamut.gridSize', 'transparencyAndGamut.gridColors', 'transparencyAndGamut.customLight', 'transparencyAndGamut.customDark']);

/* 对话框摆出来的栏位：原码可见的（总表减 HIDDEN_UNTIL_IMPLEMENTED）再减掉画板接不上的（网页没有：主画面、介面主题与缩放、
   数位板压力、右键笔刷选单、最近档案清单（档案菜单管）、快速导出（档案菜单管）、记忆体／GPU、增效工具资料夹、色域警告、
   切片颜色与编号（PS 这边还没有切片）） */
const SHOWN = {
  general:['imageInterpolation', 'zoomWithScrollWheel'],
  interface:['language', 'canvasColor', 'canvasCustomColor', 'canvasBorder', 'showMenuColors', 'showTooltips'],
  workspace:[],
  tools:['showTooltips', 'useShiftKeyForToolSwitch'],
  historyLog:['enabled', 'destination', 'filePath', 'detail'],
  fileHandling:['autosave', 'autosaveMinutes', 'recoverOnLaunch'],
  export:[],
  performance:['historyStates'],
  scratchDisks:[],
  cursors:['painting', 'showCrosshairInBrushTip', 'showOnlyCrosshairWhilePainting', 'other'],
  transparencyAndGamut:['gridSize', 'gridColors', 'customLight', 'customDark'],
  unitsAndRulers:['rulers', 'pointSize'],
  guidesGridAndSlices:['guideColor', 'guideStyle', 'smartGuideColor', 'gridColor', 'gridStyle', 'gridlineEvery', 'gridUnit', 'subdivisions'],
  plugIns:[], type:[], enhancedControls:[], rawDefaults:[], integrations:[],
};

/* ═══════════ 首选项存取：包在 PsEdit.prefs 上 ═══════════ */
const old = {view:P.view.bind(P), check:P.check.bind(P), apply:P.apply.bind(P)};
const save = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(P.saved || {})); } catch(e){} };
/* prefs.rs:943 keyed：shortcuts.<命令 id>、menus.colors.<命令 id>（id 里有点） */
function keyed(path){
  for (const pre of ['shortcuts.', 'menus.colors.']) if (path.startsWith(pre)) return [pre.slice(0, -1), path.slice(pre.length)];
  return null;
}
P.view = function(){
  const v = old.view(), s = this.load();
  for (const sec of SECTIONS) v[sec] = Object.assign(clone(FULL[sec]), v[sec] || {}, s[sec] ? clone(s[sec]) : {});
  v.shortcuts = Object.assign({}, s.shortcuts || {});
  v.menus = {hidden:((s.menus || {}).hidden || []).slice(), colors:Object.assign({}, (s.menus || {}).colors || {})};
  v.toolbar = {hidden:((s.toolbar || {}).hidden || []).slice(), order:((s.toolbar || {}).order || []).slice()};
  return v;
};
P.get = function(path){
  const v = this.view(); if (!path) return v;
  const kd = keyed(path); if (kd){ const m = kd[0] === 'shortcuts' ? v.shortcuts : v.menus.colors; return m[kd[1]]; }
  return path.split('.').reduce((o, k) => (o && typeof o === 'object' && k in o) ? o[k] : undefined, v);
};
/* prefs.rs:988 check_value ＋ serde 的型别检查 */
P.check = function(path, val){
  const kd = keyed(path);
  if (kd){
    if (kd[0] === 'shortcuts'){
      if (val === null) return null;
      if (typeof val !== 'string') return `shortcut for \`${kd[1]}\` must be a string`;
      if (val && !normSc(val)) return `\`${val}\` is not a valid shortcut (e.g. Ctrl+Shift+N, F7)`;
      return null;
    }
    if (val !== null && !MENU_COLORS.includes(val)) return `unknown colour \`${val}\` (${MENU_COLORS.join('|')})`;
    return null;
  }
  if (path === 'menus' || path === 'toolbar' || path === 'shortcuts'){
    if (!val || typeof val !== 'object' || Array.isArray(val)) return `\`${path}\` needs an object`;
    if (path === 'shortcuts'){ for (const id in val){ const e = this.check('shortcuts.' + id, val[id]); if (e) return e; } return null; }
    for (const k in val){
      if (!(path === 'menus' ? ['hidden', 'colors'] : ['hidden', 'order']).includes(k)) return `unknown preference \`${path}.${k}\``;
      if (k === 'colors'){ if (!val.colors || typeof val.colors !== 'object') return '`menus.colors` needs an object'; for (const id in val.colors){ const e = this.check('menus.colors.' + id, val.colors[id]); if (e) return e; } }
      else if (!Array.isArray(val[k]) || !val[k].every(x => typeof x === 'string')) return `\`${path}.${k}\` must be a list of ids`;
    }
    return null;
  }
  const parts = path.split('.'), sec = parts[0], key = parts[1];
  if (parts.length !== 2 || !FULL[sec] || !(key in FULL[sec])) return `unknown preference \`${path}\``;
  if (OLD_KEYS.has(path)) return old.check(path, val);
  const ch = CHOICES[path];
  if (ch){
    if (typeof val !== 'string') return `\`${path}\` must be one of ${ch.join('|')}`;
    if (!ch.includes(val)) return `\`${path}\` must be one of ${ch.join('|')} (got \`${val}\`)`;
    return null;
  }
  const d = FULL[sec][key];
  if (RANGE[path]){
    if (typeof val !== 'number' || !isFinite(val)) return `\`${path}\` must be a number`;
    const [lo, hi] = RANGE[path];
    if (val < lo || val > hi) return `\`${path}\` must be within ${lo}..${hi} (got ${val})`;
  }
  if (INTS.has(path) && !Number.isInteger(val)) return `invalid value for \`${path}\`: expected a whole number`;
  if (COLOR_KEYS.has(key) && (typeof val !== 'string' || !/^\s*#?[0-9a-f]{6}\s*$/i.test(val))) return `\`${path}\` must be a #rrggbb colour`;
  if (typeof d === 'boolean' && typeof val !== 'boolean') return `\`${path}\` must be true or false`;
  if (typeof d === 'number' && (typeof val !== 'number' || !isFinite(val))) return `\`${path}\` must be a number`;
  if (typeof d === 'string' && typeof val !== 'string') return `\`${path}\` must be a string`;
  if (Array.isArray(d) && !Array.isArray(val)) return `\`${path}\` must be a list`;
  return null;
};
/* 区段整块给（prefs.rs:1283 set_pref：整区段＝逐键合并、每个都验）⇒ 展开成「区段.键」 */
function expand(changes){
  const out = [];
  for (const [k, v] of changes){
    if (FULL[k] && v && typeof v === 'object' && !Array.isArray(v)){ for (const kk in v) out.push([k + '.' + kk, v[kk]]); }
    else if (k === '' && v && typeof v === 'object'){ for (const kk in v) out.push(...expand([[kk, v[kk]]])); }
    else out.push([k, v]);
  }
  return out;
}
/* prefs.rs:1324 prefs_set：全部先验过再写（全有或全无） */
P.set = function(changes){
  changes = expand(changes);
  for (const [k, v] of changes){ const e = this.check(k, v); if (e) return e; }
  const s = this.load();
  for (const [k, v] of changes){
    if (k === 'interface.language'){ if (v !== Lang.cur) Lang.set(v); continue; }   // 跟右上角语言选单同一个设定（旧版同）
    const kd = keyed(k);
    if (kd){
      const m = kd[0] === 'shortcuts' ? (s.shortcuts = s.shortcuts || {}) : ((s.menus = s.menus || {}).colors = s.menus.colors || {});
      if (v === null || (kd[0] === 'menus.colors' && v === 'none')) delete m[kd[1]]; else m[kd[1]] = kd[0] === 'shortcuts' && v ? normSc(v) : v;   // prefs.rs:1032 快捷键存正规写法；null＝回预设
      continue;
    }
    if (k === 'shortcuts'){ s.shortcuts = {}; for (const id in v) if (v[id] !== null) s.shortcuts[id] = v[id] ? normSc(v[id]) : ''; continue; }
    if (k === 'menus' || k === 'toolbar'){ s[k] = Object.assign({}, s[k] || {}, clone(v)); continue; }
    const [sec, key] = k.split('.');
    let val = v;
    if (COLOR_KEYS.has(key)) val = '#' + String(v).trim().replace(/^#/, '').toLowerCase();
    (s[sec] = s[sec] || {})[key] = val;
  }
  save();
  this.apply(changes.map(c => c[0]));
  return null;
};
/* prefs.rs:1051 reset：全部／一个区段／一个键 */
P.reset = function(path){
  const s = this.load();
  if (!path) this.saved = {};
  else {
    const kd = keyed(path);
    if (kd){ const m = kd[0] === 'shortcuts' ? s.shortcuts : (s.menus || {}).colors; if (m) delete m[kd[1]]; }
    else if (!path.includes('.')) delete s[path];
    else { const [sec, key] = path.split('.'); if (s[sec]) delete s[sec][key]; }
  }
  save();
  this.apply(null, true);
};
P.apply = function(keys, all){
  old.apply(keys, all);
  try { applyMine(keys, all); } catch(e){ console.error(e); }
};

/* ═══════════ 单位（prefs.rs:96-154 Unit::from_px／to_px／suffix／decimals；PointSize::per_inch） ═══════════ */
const SUFFIX = {pixels:'px', inches:'in', cm:'cm', mm:'mm', points:'pt', picas:'pica', percent:'%'};
const DECIMALS = {pixels:0, points:1, percent:1, mm:1, inches:2, cm:2, picas:2};
function fromPx(u, px, dpi, extent, ppi){
  dpi = Math.max(dpi, 1e-6);
  switch (u){
    case 'inches': return px / dpi;
    case 'cm': return px / dpi * 2.54;
    case 'mm': return px / dpi * 25.4;
    case 'points': return px / dpi * ppi;
    case 'picas': return px / dpi * ppi / 12;
    case 'percent': return px / Math.max(extent, 1e-6) * 100;
    default: return px;
  }
}
function toPx(u, v, dpi, extent, ppi){
  dpi = Math.max(dpi, 1e-6);
  switch (u){
    case 'inches': return v * dpi;
    case 'cm': return v / 2.54 * dpi;
    case 'mm': return v / 25.4 * dpi;
    case 'points': return v / Math.max(ppi, 1e-6) * dpi;
    case 'picas': return v * 12 / Math.max(ppi, 1e-6) * dpi;
    case 'percent': return v * extent / 100;
    default: return v;
  }
}
const docDpi = () => Math.max(1, +Doc.dpi || 72);
const ppiOf = () => P.get('unitsAndRulers.pointSize') === 'traditional' ? 72.27 : 72;
/* prefs.rs:541 UnitsAndRulers::format */
function fmtLen(px, axis){
  const u = P.get('unitsAndRulers.rulers');
  const v = fromPx(u, px, docDpi(), axis === 'y' ? Doc.height : Doc.width, ppiOf());
  return v.toFixed(DECIMALS[u] || 0);
}
const Units = PE.units = {fromPx, toPx, SUFFIX, format:fmtLen, unit:() => P.get('unitsAndRulers.rulers'), suffix:() => SUFFIX[P.get('unitsAndRulers.rulers')] || 'px'};

/* 状态列：游标位置与文件大小照「标尺单位」显示（panels.rs:1010 Info 面板同一套）；像素单位维持原样 */
function hookStatus(){
  if (!window.UI || UI._pse3Status) return; UI._pse3Status = true;
  const setPos0 = UI.setPos.bind(UI);
  UI.setPos = function(pt){
    if (Units.unit() === 'pixels') setPos0(pt);
    else { const el = document.getElementById('stPos'); if (el) el.textContent = `${fmtLen(pt[0], 'x')}, ${fmtLen(pt[1], 'y')} ${Units.suffix()}`; }
  };
  const refresh0 = UI.refresh.bind(UI);
  UI.refresh = function(){ refresh0(); sizeReadout(); };
}
function sizeReadout(){
  const el = document.getElementById('stSize'); if (!el) return;
  el.textContent = Units.unit() === 'pixels' ? `${Doc.width} × ${Doc.height}` : `${fmtLen(Doc.width, 'x')} × ${fmtLen(Doc.height, 'y')} ${Units.suffix()}`;
}

/* ═══════════ 网格／参考线／标尺：画的是视图菜单（menus/impl/ps-view.js 的 PsView：显示 ▸ 网格、标尺、参考线）
   这里把首选项接进去（rulers.rs:71 draw_grid、99 draw_guides、165 draw_rulers 读的就是这两区段）：
   · 网格间隔＝gridlineEvery×gridUnit（prefs.rs:582 major_px，含 percent 与点／派卡大小）、子网格、网格颜色、网格样式（直线／虚线／网点）
   · 参考线颜色与样式、智能参考线颜色
   · 标尺刻度照「单位与标尺 ▸ 标尺」的单位（rulers.rs:180-235；像素以外 nice_step 可取小数） */
const RULER = 16;
/* rulers.rs:37 nice_step */
function niceStep(min, whole){
  let step = whole ? 1 : 0.001;
  for (;;){ for (const m of [1, 2, 2.5, 5]) if ((m !== 2.5 || !whole) && step * m >= min) return step * m; step *= 10; }
}
const majorPx = () => { const g = P.get('guidesGridAndSlices'); return Math.max(toPx(g.gridUnit, Math.max(g.gridlineEvery, 1e-3), docDpi(), Doc.width, ppiOf()), 1e-3); };
const dashOf = (style, dpr) => style === 'dashedLines' ? [4 * dpr, 3 * dpr] : style === 'dots' ? [1 * dpr, 2 * dpr] : [];   // egui dashed_line(4,3)／dotted_line(间距 3)
function syncView(){
  const V = window.PsView; if (!V || !V.grid) return;
  const g = P.get('guidesGridAndSlices');
  Object.assign(V.grid, {every:g.gridlineEvery, unit:g.gridUnit, subdivisions:g.subdivisions, color:g.gridColor, guide:g.guideColor, smart:g.smartGuideColor,
                         style:g.gridStyle, guideStyle:g.guideStyle});
  if (V._pse3) return; V._pse3 = true;
  V.majorPx = majorPx;                                             // 原版只认英寸／公分／公釐／点(72)／派卡：换成 prefs.rs Unit::to_px 全套
  const grid0 = V.drawGrid, guides0 = V.drawGuides;
  /* 网格／参考线样式：原版只画直线；照 rulers.rs styled_line 加虚线、网点（直线时原样交回原版） */
  const styled = (fn, key) => function(ctx, s){
    const st = this.grid[key] || 'lines';
    if (st === 'lines') return fn.call(this, ctx, s);
    const dpr = s / (UI.zoom || 1), sl = ctx.setLineDash.bind(ctx);
    ctx.setLineDash = () => {};                                    // 原版 save/restore 之间不会再设虚线；先设好、挡掉它清掉
    sl(dashOf(st, dpr));
    try { return fn.call(this, ctx, s); } finally { delete ctx.setLineDash; sl([]); }
  };
  V.drawGrid = styled(grid0, 'style');
  V.drawGuides = styled(guides0, 'guideStyle');
  /* 标尺：像素单位交回原版；其它单位照 rulers.rs:180-235 换算刻度与标字 */
  const rulers0 = V.drawRulers;
  V.drawRulers = function(){
    if (Units.unit() === 'pixels') return rulers0.call(this);
    const R = this.rulersShown() ? this.ensureRulers() : null;
    document.body.classList.toggle('ps-rulers', !!R);
    if (!R) return;
    const view = document.getElementById('view'), vr = view.getBoundingClientRect(), wr = R.wrap.getBoundingClientRect();
    const z = UI.zoom, dpr = Math.min(window.devicePixelRatio || 1, 2), u = Units.unit(), ppi = ppiOf(), dpi = docDpi(), flip = this.flipped();
    const hover = (window.Pointer && Pointer.hover) || null;
    const label = (v, step) => step >= 1 ? String(Math.round(v)) : String(+v.toFixed(2));
    const paint = (cv, vertical) => {
      const w = vertical ? RULER : Math.max(1, wr.width - RULER), h = vertical ? Math.max(1, wr.height - RULER) : RULER;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = '#262626'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#3a3a3a'; c.lineWidth = 1; c.beginPath();
      if (vertical){ c.moveTo(w - .5, 0); c.lineTo(w - .5, h); } else { c.moveTo(0, h - .5); c.lineTo(w, h - .5); } c.stroke();
      c.strokeStyle = '#7a7a7a'; c.fillStyle = '#9a9a9a'; c.font = '9px sans-serif'; c.textBaseline = 'top';
      const ppu = Math.max(toPx(u, 1, dpi, vertical ? Doc.height : Doc.width, ppi), 1e-9);
      const step = niceStep(60 / Math.max(z * ppu, 1e-6), false);
      const org = vertical ? wr.top + RULER : wr.left + RULER, len = vertical ? h : w;
      const scr = d => vertical ? vr.top + d * z : vr.left + (flip ? Doc.width - d : d) * z;          // 文件 → 画面
      const doc = q => vertical ? (q - vr.top) / z : (flip ? Doc.width - (q - vr.left) / z : (q - vr.left) / z);
      const sAt = un => scr(un * ppu) - org;
      const a = doc(org) / ppu, b = doc(org + len) / ppu, lo = Math.min(a, b), hi = Math.max(a, b);
      for (let v = Math.floor(lo / step) * step, n = 0; v <= hi && n < 4000; v += step, n++){
        const p = Math.round(sAt(v)) + .5;
        c.beginPath(); if (vertical){ c.moveTo(w - RULER, p); c.lineTo(w, p); } else { c.moveTo(p, h - RULER); c.lineTo(p, h); } c.stroke();
        const t = label(v, step);
        if (vertical) Array.from(t).forEach((ch, i) => c.fillText(ch, 3, p + 2 + i * 8.5)); else c.fillText(t, p + 2, 1);
        for (let k = 1; k < 10; k++){
          const m = Math.round(sAt(v + step * k / 10)) + .5, l = k === 5 ? 6 : 3;
          c.beginPath(); if (vertical){ c.moveTo(w - l, m); c.lineTo(w, m); } else { c.moveTo(m, h - l); c.lineTo(m, h); } c.stroke();
        }
      }
      if (hover){
        const p = Math.round(scr(vertical ? hover[1] : hover[0]) - org) + .5;
        c.strokeStyle = '#d6d6d6'; c.beginPath(); if (vertical){ c.moveTo(0, p); c.lineTo(w, p); } else { c.moveTo(p, 0); c.lineTo(p, h); } c.stroke();
      }
    };
    paint(R.top, false); paint(R.left, true);
    const wv = document.getElementById('canvasWrap').getBoundingClientRect();
    this._rulerKey = [vr.left, vr.top, vr.width, wv.width, wv.height, UI.zoom, this.flipped()].join(',');   // 同原版 rulerKey：画面没动就不重画
  };
}
CMD.reg('ps.prefs.formatLength', {i18n:'', params:'{px, axis?:"x"|"y"="x"} 把文件像素长度换成标尺单位（首选项 ▸ 单位与标尺；百分比按该轴边长）→ {unit, suffix, value, text}'}, p => {
  if (typeof p.px !== 'number' || !isFinite(p.px)) return fail('`px` must be a number');
  const u = Units.unit(), v = fromPx(u, p.px, docDpi(), p.axis === 'y' ? Doc.height : Doc.width, ppiOf());
  return {ok:true, unit:u, suffix:SUFFIX[u], value:v, text:fmtLen(p.px, p.axis) + ' ' + SUFFIX[u]};
});

/* ═══════════ 光标（canvas.rs:1600-1660）：笔刷类工具的笔尖圈／十字线，其它工具的标准／精确 ═══════════ */
const PAINT_TOOLS = ['brush', 'eraser', 'clone'];
function crossAt(ctx, s, pt, len){
  const z = UI.zoom || 1, dpr = s / z, cx = pt[0] * s, cy = pt[1] * s;
  ctx.save();
  for (const [w, c] of [[2.5, 'rgba(0,0,0,' + (140 / 255) + ')'], [1, 'rgba(255,255,255,' + (220 / 255) + ')']]){
    ctx.lineWidth = w * dpr; ctx.strokeStyle = c; ctx.beginPath();
    ctx.moveTo(cx - len * dpr, cy); ctx.lineTo(cx + len * dpr, cy); ctx.moveTo(cx, cy - len * dpr); ctx.lineTo(cx, cy + len * dpr); ctx.stroke();
  }
  ctx.restore();
}
function hookCursors(){
  for (const id of PAINT_TOOLS){
    const Tl = window.Tools && Tools.get(id); if (!Tl || !Tl.drawOverlay || Tl._pse3Cur) continue;
    Tl._pse3Cur = true;
    const orig = Tl.drawOverlay;
    Tl.drawOverlay = function(ctx, s){
      const c = P.get('cursors');
      if (this._resize || (c.painting === 'normalTip' && !c.showCrosshairInBrushTip && !c.showOnlyCrosshairWhilePainting)) return orig.call(this, ctx, s);
      const h = this._hover, painting = !!this._drag;
      // 标准／精确／作画中只显示十字：不画笔尖圈（把 _hover 暂时拿掉，其他叠画照旧）
      const noRing = c.painting === 'standard' || c.painting === 'precise' || (painting && c.showOnlyCrosshairWhilePainting);
      const hard0 = ToolState.hardness;
      if (noRing) this._hover = null;
      else if (c.painting === 'fullSizeTip') ToolState.hardness = 1;   // 全尺寸＝整个直径（normalTip 才是 50% 等高线）
      try { orig.call(this, ctx, s); } finally { this._hover = h; ToolState.hardness = hard0; }
      if (!h) return;
      if (c.painting === 'precise') crossAt(ctx, s, h, 6);
      else if (painting && c.showOnlyCrosshairWhilePainting && c.painting !== 'standard') crossAt(ctx, s, h, 5);
      else if (c.painting !== 'standard' && c.showCrosshairInBrushTip) crossAt(ctx, s, h, 3);
    };
  }
  if (window.UI && !UI._pse3Cursor){
    UI._pse3Cursor = true;
    const setTool0 = UI.setTool.bind(UI);
    UI.setTool = function(id){ setTool0(id); cursorCss(); };
  }
}
function cursorCss(){
  if (!window.UI || !UI.canvas) return;
  const id = ToolState.cur, Tl = Tools.get(id) || {}, c = P.get('cursors');
  let cur = Tl.cursor || 'crosshair';
  if (PAINT_TOOLS.includes(id) && c.painting === 'standard') cur = 'default';                       // 标准＝系统箭头（PS 是工具图示）
  else if (['move', 'text', 'eyedropper'].includes(id) && c.other === 'precise') cur = 'crosshair';   // 其它光标＝精确：移动／文字／吸管也用十字（canvas.rs:1650）
  UI.canvas.style.cursor = cur;                                                                      // 其余＝工具自己登记的（同 UI.setTool）
}

/* ═══════════ 历史记录日志（prefs_ui.rs:280 history_log）：执行过的命令照「仅工作进程／简明／详细」记下来 ═══════════ */
const LOG_KEY = 'dlcanvas.ps.historyLog', LOG_MAX = 400000;
const HLog = {
  meta:[], serial:-1,
  label(id){ const f = window.Menubar && Menubar.findImpl(id); return f ? Menubar.name(f.item).replace(/…$/, '') : id; },
  record(id, params){
    const hl = P.get('historyLog'); if (!hl.enabled) return;
    let line;
    if (hl.detail === 'sessionsOnly'){ if (!['file.new', 'file.open', 'file.openProject', 'ps.file.close'].includes(id)) return; line = this.label(id); }
    else if (hl.detail === 'detailed'){ let ps = ''; try { ps = JSON.stringify(params || {}); } catch(e){} line = `${this.label(id)}  ${id} ${ps.length > 400 ? ps.slice(0, 400) + '…' : ps}`; }
    else line = this.label(id);
    if (hl.destination !== 'textFile'){ if (this.serial !== Doc.serial){ this.meta = []; this.serial = Doc.serial; } this.meta.push(line); }   // 中继资料：跟着这份文件
    if (hl.destination !== 'metadata'){                                                                  // 文本文件：存进浏览器、可下载
      try { let t = (localStorage.getItem(LOG_KEY) || '') + line + '\n'; if (t.length > LOG_MAX) t = t.slice(t.length - LOG_MAX); localStorage.setItem(LOG_KEY, t); } catch(e){}
    }
  },
};
CMD.reg('ps.prefs.historyLog', {i18n:'', params:'{action?:"get"|"clear"|"download"="get"} 首选项 ▸ 历史记录 的日志：get＝回 {file:文本文件那份, metadata:这份文件的}；clear 清空；download 下载文本文件（档名＝historyLog.filePath，缺省 history-log.txt）'}, p => {
  const a = p.action || 'get';
  const file = (() => { try { return localStorage.getItem(LOG_KEY) || ''; } catch(e){ return ''; } })();
  if (a === 'clear'){ try { localStorage.removeItem(LOG_KEY); } catch(e){} HLog.meta = []; return {ok:true}; }
  if (a === 'download'){ download(new Blob([file], {type:'text/plain'}), (P.get('historyLog.filePath') || '').split(/[\\/]/).pop() || 'history-log.txt'); return {ok:true, bytes:file.length}; }
  if (a !== 'get') return fail('action must be get|clear|download');
  return {ok:true, file, metadata:HLog.serial === Doc.serial ? HLog.meta.slice() : []};
});

/* ═══════════ 自动存储恢复信息（prefs_ui.rs:227 autosave）：有没存的改动、每 N 分钟存一份进浏览器；下次开页面提示恢复 ═══════════ */
const REC_KEY = 'dlcanvas.ps.recovery';
const Auto = {
  dirty:false, next:0, sessionId:String(Date.now()) + Math.random().toString(36).slice(2, 6),
  tick(){
    const fh = P.get('fileHandling'); const now = Date.now(), iv = Math.max(1, fh.autosaveMinutes) * 60000;
    if (!fh.autosave) return;
    if (!this.next || this.next > now + iv){ this.next = now + iv; return; }
    if (now < this.next) return;
    this.next = now + iv;
    if (this.dirty) this.saveNow();
  },
  saveNow(){
    try { localStorage.setItem(REC_KEY, JSON.stringify({time:Date.now(), session:this.sessionId, project:Project.serialize()})); this.dirty = false; return true; }
    catch(e){ return false; }
  },
  read(){ try { return JSON.parse(localStorage.getItem(REC_KEY) || 'null'); } catch(e){ return null; } },
  banner(){
    const r = this.read(); const bar = document.getElementById('statusbar');
    if (!bar || !r || r.session === this.sessionId || !P.get('fileHandling.recoverOnLaunch')) return;
    const el = document.createElement('span'); el.id = 'pse3Recover'; el.className = 'pse3-recover';
    el.innerHTML = `<span>${T('pse3.rec.found').replace('{t}', new Date(r.time).toLocaleString())}</span> <a data-act="restore">${T('pse3.rec.restore')}</a> <a data-act="discard">${T('pse3.rec.discard')}</a>`;
    el.querySelector('[data-act="restore"]').onclick = () => { CMD.run('ps.prefs.recovery', {action:'restore'}); el.remove(); };
    el.querySelector('[data-act="discard"]').onclick = () => { CMD.run('ps.prefs.recovery', {action:'discard'}); el.remove(); };
    bar.appendChild(el);
  },
};
CMD.reg('ps.prefs.recovery', {i18n:'', params:'{action?:"status"|"saveNow"|"restore"|"discard"="status"} 首选项 ▸ 文件处理 的自动存储恢复信息：status 看有没有恢复档；saveNow 立刻存一份；restore 开回恢复档；discard 丢掉'}, p => {
  const a = p.action || 'status', r = Auto.read();
  if (a === 'saveNow') return Auto.saveNow() ? {ok:true} : fail('could not save recovery information (browser storage full?)');
  if (a === 'discard'){ try { localStorage.removeItem(REC_KEY); } catch(e){} return {ok:true}; }
  if (a === 'restore'){ if (!r) return fail('no recovery information'); return Project.load(r.project).then(() => ({ok:true, time:r.time})); }
  if (a !== 'status') return fail('action must be status|saveNow|restore|discard');
  return {ok:true, exists:!!r, time:r ? r.time : null, fromThisPage:!!r && r.session === Auto.sessionId, dirty:Auto.dirty};
});

/* ═══════════ 键盘快捷键（prefs.rs:1081 normalize_shortcut；1379 keyboard_shortcuts）═══════════
   画板用 Windows 写法：Cmd 与 Ctrl 合成 Ctrl（菜单树的 key 已把原码的 Cmd 换成 Ctrl）；顺序 Ctrl+Alt+Shift+键。 */
function capWord(s){
  const f = s[0], rest = s.slice(1);
  if (/[a-z]/i.test(f)){ if (/^f$/i.test(f) && /^\d+$/.test(rest)) return 'F' + rest; return f.toUpperCase() + rest.toLowerCase(); }
  return s;
}
function normSc(s){
  s = String(s || '').trim(); if (!s) return null;
  let ctrl = false, alt = false, shift = false, key = null;
  const plusKey = s.endsWith('++') || s === '+';
  const body = plusKey ? s.replace(/\++$/, '') : s;
  for (const part of body.split('+').filter(Boolean)){
    const l = part.toLowerCase();
    if (['cmd', 'command', '⌘', 'meta', 'super', 'ctrl', 'control', '⌃'].includes(l)) ctrl = true;
    else if (['alt', 'option', 'opt', '⌥'].includes(l)) alt = true;
    else if (['shift', '⇧'].includes(l)) shift = true;
    else { if (key) return null; key = [...part].length === 1 ? part.toUpperCase() : capWord(part); }
  }
  if (plusKey){ if (key) return null; key = '+'; }
  if (!key) return null;
  return (ctrl ? 'Ctrl+' : '') + (alt ? 'Alt+' : '') + (shift ? 'Shift+' : '') + key;
}
/* 键盘事件 → 写法（prefs_ui.rs:352 shortcut_text） */
const CODE_KEY = {Semicolon:';', Quote:"'", Equal:'=', Minus:'-', BracketLeft:'[', BracketRight:']', Backslash:'\\', Comma:',', Period:'.', Slash:'/', Backquote:'`',
  NumpadAdd:'+', NumpadSubtract:'-', Space:'Space', Enter:'Enter', NumpadEnter:'Enter', Tab:'Tab', Backspace:'Backspace', Delete:'Delete', Escape:'Escape',
  ArrowLeft:'Arrowleft', ArrowRight:'Arrowright', ArrowUp:'Arrowup', ArrowDown:'Arrowdown', Home:'Home', End:'End', PageUp:'Pageup', PageDown:'Pagedown', Insert:'Insert'};
function eventSc(e){
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return null;
  const c = e.code || '';
  let k = /^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5) : /^Numpad\d$/.test(c) ? c.slice(6) : /^F\d+$/.test(c) ? c : CODE_KEY[c] || (e.key && e.key.length === 1 ? e.key.toUpperCase() : null);
  if (!k) return null;
  return normSc((e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + (k === '+' ? '+' : k) + (k === '+' ? '+' : ''));
}
/* 可绑的项：Photoshop 菜单树里每个有 id 的叶子（原码 bindable＝命令表；我们的命令 id 就是菜单项的原码 id） */
function bindable(){
  const out = [], seen = new Set();
  MenuTrees.walk('ps', (it, path) => {
    if (it.sep || it.sub || !it.id || seen.has(it.id)) return;
    seen.add(it.id);
    out.push({id:it.id, item:it, top:path[0], path:path.slice(1).map(p => Menubar.name(p)), label:Menubar.name(it), def:it.key ? normSc(it.key) : null});
  });
  return out;
}
const scOverrides = () => Object.assign({}, (P.load().shortcuts) || {});
/* prefs.rs:1068 shortcut：使用者改过的（'' ＝拿掉），否则预设 */
function effSc(ov, id, def){ return (id in ov) ? (ov[id] || null) : def; }
function conflicts(list, ov){
  const by = {};
  for (const b of list){ const s = effSc(ov, b.id, b.def); if (s) (by[s] = by[s] || []).push(b.id); }
  return Object.entries(by).filter(([, ids]) => ids.length > 1).map(([shortcut, commands]) => ({shortcut, commands}));
}
function keyboardShortcuts(p){
  const cmd = 'edit.keyboardShortcuts', list = bindable();
  const s = P.load();
  let ov = Object.assign({}, s.shortcuts || {});
  if (p.reset === true) ov = {};
  else if (Array.isArray(p.reset)) p.reset.forEach(id => delete ov[id]);
  if (p.set && typeof p.set === 'object'){
    const next = Object.assign({}, ov);
    for (const id in p.set){
      if (!list.some(b => b.id === id) && !p.allowUnknown) return fail(`${cmd}: unknown command \`${id}\``);
      const v = p.set[id];
      if (v === null){ delete next[id]; continue; }
      if (typeof v !== 'string') return fail(`${cmd}: shortcut for \`${id}\` must be a string`);
      if (v && !normSc(v)) return fail(`${cmd}: \`${v}\` is not a valid shortcut (e.g. Ctrl+Shift+N, F7)`);
      next[id] = v ? normSc(v) : '';
    }
    // 跟 Photoshop 一样：快捷键给了新命令，就从原来那条拿掉（prefs.rs:1400）
    if (p.removeConflicts !== false){
      for (const id in p.set){
        const sc = typeof p.set[id] === 'string' ? normSc(p.set[id]) : null; if (!sc) continue;
        for (const b of list) if (b.id !== id && effSc(next, b.id, b.def) === sc) next[b.id] = '';
      }
    }
    ov = next;
  }
  if (p.reset !== undefined || p.set){ s.shortcuts = ov; save(); P.apply(['shortcuts']); }
  const f = typeof p.filter === 'string' ? p.filter.toLowerCase() : null;
  const commands = list.filter(b => !f ? (p.list || b.id in ov) : (b.id.toLowerCase().includes(f) || b.label.toLowerCase().includes(f)))
    .map(b => ({id:b.id, label:b.label, menu:[b.top, ...b.path], default:b.def, shortcut:effSc(ov, b.id, b.def)}));
  return {overrides:ov, commands, conflicts:conflicts(list, ov)};
}
CMD.reg('ps.edit.keyboardShortcuts', {i18n:'', params:'{set?:{"<菜单项 id>":"Ctrl+Shift+X"|""(拿掉)|null(回预设)}, reset?:true|["<id>",…], removeConflicts?:bool=true（新键从原主人拿掉）, filter?:str, list?:bool=false, allowUnknown?:bool, dialog?:true＝开「键盘快捷键和菜单」对话框} 键盘快捷键（Ctrl+Alt+Shift+K；只管 Photoshop 菜单；存进浏览器）→ {overrides, commands:[{id,label,menu,default,shortcut}], conflicts}（prefs.rs keyboard_shortcuts）'},
  p => p.dialog ? openShortcuts(0) : keyboardShortcuts(p));

/* prefs.rs:1436 menus：藏项／上色 */
function menusCmd(p){
  const ids = k => Array.isArray(p[k]) ? p[k].filter(x => typeof x === 'string') : [];
  if (p.color && typeof p.color === 'object') for (const id in p.color){ const c = p.color[id]; if (typeof c === 'string' && !MENU_COLORS.includes(c)) return fail(`edit.menus: unknown colour \`${c}\` (${MENU_COLORS.join('|')})`); }
  const s = P.load();
  let m = {hidden:((s.menus || {}).hidden || []).slice(), colors:Object.assign({}, (s.menus || {}).colors || {})};
  if (p.reset === true) m = {hidden:[], colors:{}};
  for (const id of ids('hide')) if (!m.hidden.includes(id)) m.hidden.push(id);
  const show = ids('show'); m.hidden = m.hidden.filter(h => !show.includes(h));
  if (p.color && typeof p.color === 'object') for (const id in p.color){ const c = p.color[id]; if (typeof c === 'string' && c !== 'none') m.colors[id] = c; else delete m.colors[id]; }
  s.menus = m; save(); P.apply(['menus']);
  return clone(m);
}
CMD.reg('ps.edit.menus', {i18n:'', params:'{hide?:["<菜单项 id>",…], show?:[…], color?:{"<id>":"red|orange|yellow|green|blue|violet|gray|none"}, reset?:bool, dialog?:true＝开对话框的「菜单」页} 菜单（Ctrl+Alt+Shift+M）：藏 Photoshop 菜单项、给项上色（首选项 ▸ 界面 ▸ 显示菜单颜色 开着才画）→ {hidden, colors}（prefs.rs menus）'},
  p => p.dialog ? openShortcuts(1) : menusCmd(p));
/* prefs.rs:1476 toolbar：藏工具／排顺序 */
function toolbarCmd(p){
  const ids = k => Array.isArray(p[k]) ? p[k].filter(x => typeof x === 'string') : null;
  const s = P.load();
  let t = {hidden:((s.toolbar || {}).hidden || []).slice(), order:((s.toolbar || {}).order || []).slice()};
  if (p.reset === true) t = {hidden:[], order:[]};
  if (ids('hidden')) t.hidden = ids('hidden');
  if (ids('order')) t.order = ids('order');
  s.toolbar = t; save(); P.apply(['toolbar']);
  return clone(t);
}
CMD.reg('ps.edit.toolbar', {i18n:'', params:'{hidden?:["<工具栏项 id，例 ps.sponge>",…], order?:[…（排在前面的格）], reset?:bool, dialog?:true＝开对话框的「工具栏」页} 工具栏：藏 Photoshop 工具栏上的工具（藏掉的仍在「⋯ 所有工具」抽屉里）、改格子顺序 → {hidden, order}（prefs.rs toolbar）'},
  p => p.dialog ? openShortcuts(2) : toolbarCmd(p));
PE.shortcuts = {normalize:normSc, fromEvent:eventSc, bindable, effective:id => { const b = bindable().find(x => x.id === id); return b ? effSc(scOverrides(), id, b.def) : null; }};

/* 快捷键分派：使用者改过的键 ⇒ 跑那一项（只在 Photoshop 菜单出现时）；原本的键被拿掉 ⇒ 吃掉不让旧的处理器跑。
   挂 window 捕获阶段；本档前面那支快捷键处理器（2286 行）比这支早挂、拦不到它 ⇒ 另在 CMD.run 包一层：键盘事件当中、那条命令的预设键已经被拿掉，就不跑。 */
function scState(){
  if (!window.Menubar || Menubar.app !== 'ps') return null;
  const ov = scOverrides(); if (!Object.keys(ov).length) return null;
  const list = bindable();
  const bound = {}, removed = {};
  for (const b of list){ const e = effSc(ov, b.id, b.def); if (e) bound[e] = b; }
  for (const b of list) if (b.def && effSc(ov, b.id, b.def) !== b.def && !bound[b.def]) removed[b.def] = b;
  return {ov, bound, removed, list};
}
window.addEventListener('keydown', e => {
  if (Dlg.cur || (PE.palette && PE.palette.el)) return;
  const t = e.target; if (t && (/^(input|select|textarea)$/i.test(t.tagName) || t.isContentEditable)) return;
  const st = scState(); if (!st) return;
  const sc = eventSc(e); if (!sc) return;
  const b = st.bound[sc];
  if (b && b.id in st.ov){                                   // 改过的键 ⇒ 跑那一项（跟点菜单一样）
    e.preventDefault(); e.stopPropagation(); e.__pse3sc = b.id;
    if (Menubar.enabled(b.item)) Menubar.run(b.item);
    return;
  }
  if (st.removed[sc]){ e.preventDefault(); e.stopPropagation(); e.__pse3sc = ''; }   // 预设键被拿掉了 ⇒ 什么都不做
}, true);

/* 兜底：PS 菜单上标了的键，一律按得到——
   各菜单实作自己接的键照旧先跑；这一下没有任何命令跑过、也没人 preventDefault，才照菜单项跑（跟点菜单一样）。
   挂在 window 冒泡阶段（最后一个听到）；改过的键已在上面那支捕获监听处理。 */
let _scRanIn = null;
(function markRun(){ if (CMD._pseKeyMark) return; CMD._pseKeyMark = true; const r0 = CMD.run.bind(CMD);
  CMD.run = function(){ const ev = window.event; if (ev && ev.type === 'keydown') _scRanIn = ev; return r0.apply(null, arguments); }; })();
window.addEventListener('keydown', e => {
  if (e.defaultPrevented || _scRanIn === e || !window.Menubar || Menubar.app !== 'ps' || Dlg.cur || (PE.palette && PE.palette.el)) return;
  const t = e.target; if (t && (/^(input|select|textarea)$/i.test(t.tagName) || t.isContentEditable)) return;
  const sc = eventSc(e); if (!sc) return;
  const st = scState(), ov = st ? st.ov : {};
  const b = bindable().find(x => effSc(ov, x.id, x.def) === sc); if (!b || !Menubar.enabled(b.item)) return;
  e.preventDefault(); Menubar.run(b.item);
});

/* ═══════════ CMD.run 包一层：历史记录日志、自动存储的「有改动」、被拿掉的预设快捷键 ═══════════ */
(function wrapRun(){
  if (CMD._pse3Run) return; CMD._pse3Run = true;
  const run0 = CMD.run.bind(CMD);
  CMD.run = function(id, params){
    const ev = window.event;
    if (ev && ev.type === 'keydown' && ev.__pse3sc === undefined){
      const st = scState();
      if (st){
        const sc = eventSc(ev), b = st.list.find(x => x.def === sc && (x.item.impl === id || (x.item.impl && x.item.impl.cmd === id)));
        if (b && effSc(st.ov, b.id, b.def) !== b.def) return {ok:false, error:`the shortcut ${sc} was removed from ${b.id}`};
      }
    }
    const r = run0(id, params);
    const c = CMD.map[id];
    const okr = !(r && r.ok === false);
    if (okr && c && (c.undoable || /^file\./.test(id))){ Auto.dirty = true; try { HLog.record(id, params); } catch(e){} }
    return r;
  };
})();

/* ═══════════ 菜单：藏项、上色、显示改过的快捷键（包 Menubar.panel；只管 Photoshop 菜单） ═══════════ */
const MENU_TINT = {red:'rgba(224,72,72,.38)', orange:'rgba(232,140,48,.38)', yellow:'rgba(222,200,40,.38)', green:'rgba(70,170,80,.38)',
  blue:'rgba(60,120,220,.40)', violet:'rgba(150,90,210,.40)', gray:'rgba(140,140,140,.40)'};
function hookMenubar(){
  if (!window.Menubar || Menubar._pse3) return; Menubar._pse3 = true;
  const panel0 = Menubar.panel.bind(Menubar);
  Menubar.panel = function(items, level){
    const dd = panel0(items, level);
    if (this.app !== 'ps') return dd;
    const v = P.view(), hidden = new Set(v.menus.hidden), colors = v.interface.showMenuColors ? v.menus.colors : {}, ov = v.shortcuts;
    const kids = Array.from(dd.children);
    items.forEach((it, i) => {
      const el = kids[i]; if (!el || it.sep) return;
      const id = it.id || (it.n && it.n.en) || '';
      if (hidden.has(id)){ el.remove(); return; }
      if (colors[id] && MENU_TINT[colors[id]]){ el.style.background = MENU_TINT[colors[id]]; el.dataset.color = colors[id]; }
      if (it.id && it.id in ov){ const kb = el.querySelector('.kb'); if (kb) kb.textContent = ov[it.id] || ''; }
    });
    // 藏掉之后：连续、开头、结尾的分隔线收掉
    let prevSep = true; const rest = Array.from(dd.children);
    rest.forEach((el, i) => { const sep = el.classList.contains('mbsep'); if (sep && (prevSep || i === rest.length - 1)) el.remove(); prevSep = sep; });
    const last = dd.lastElementChild; if (last && last.classList.contains('mbsep')) last.remove();
    return dd;
  };
}

/* ═══════════ 工具栏：藏工具、排顺序（包 Toolbar.build／openFlyout；只管 Photoshop 版面） ═══════════ */
function hookToolbar(){
  if (!window.Toolbar || Toolbar._pse3) return; Toolbar._pse3 = true;
  const build0 = Toolbar.build.bind(Toolbar);
  Toolbar.build = function(kind){ build0(kind); try { applyToolbar(); } catch(e){ console.error(e); } };
  const fly0 = Toolbar.openFlyout.bind(Toolbar);
  Toolbar.openFlyout = function(key){
    fly0(key);
    if (this.layout && this.layout.id === 'ps' && this.fly){ const h = new Set(P.get('toolbar').hidden); this.fly.querySelectorAll('.tbfi[data-item]').forEach(r => { if (h.has(r.dataset.item)) r.remove(); }); }
  };
  // 首选项 ▸ 工具 ▸ 使用 Shift 键切换工具：开着时同一个键不按 Shift 不轮换（只选回那格表面的工具），Shift＋键才轮换（prefs.rs:264）
  const key0 = Toolbar.onKey.bind(Toolbar);
  Toolbar.onKey = function(e){
    if (!this.layout || this.layout.id !== 'ps' || !P.get('tools.useShiftKeyForToolSwitch') || e.ctrlKey || e.metaKey || e.altKey || !e.key || e.key.length !== 1 || !/[a-z]/i.test(e.key)) return key0(e);
    const low = e.key.toLowerCase();
    if (['x', 'd'].includes(low) && !e.shiftKey) return key0(e);
    const hit = this.groups.filter(g => g.kind !== 'row').find(g => g.items.some(it => it.key && it.key.toLowerCase() === low));
    if (!hit) return key0(e);
    const surf = this.surfaced(hit);
    if (!e.shiftKey){
      if (surf.impl && surf.impl === ToolState.cur) return true;              // 已经是这格的工具：不轮换
      if (surf.impl && Tools.get(surf.impl) && surf.key && surf.key.toLowerCase() === low){ this.choose(surf.id, {user:true}); return true; }
      return key0(e);
    }
    return key0({key:e.key.toLowerCase(), shiftKey:false, ctrlKey:false, metaKey:false, altKey:false, code:e.code, preventDefault(){}, stopPropagation(){}});   // Shift＋键 ⇒ 照原本的轮换
  };
}
function applyToolbar(){
  if (!window.Toolbar || !Toolbar.layout || Toolbar.layout.id !== 'ps') return;
  const t = P.get('toolbar'), hidden = new Set(t.hidden);
  for (const g of Toolbar.groups){
    if (!/^s\d+$/.test(g.key)) continue;
    const vis = g.items.filter(it => !hidden.has(it.id));
    const btn = document.querySelector(`#toolbar .tb[data-slot="${g.key}"]`); if (!btn) continue;
    if (!vis.length){ btn.style.display = 'none'; btn.dataset.pse3Hidden = '1'; continue; }
    if (hidden.has(Toolbar.surfaced(g).id)) Toolbar.surface(g, g.items.indexOf(vis[0]));
  }
  if (t.order.length){
    const grid = document.querySelector('#toolbar .tbgrid'); if (!grid) return;
    const slots = [];
    for (const id of t.order){ const f = Toolbar.groupOf(id); if (f && /^s\d+$/.test(f.g.key) && !slots.includes(f.g.key)) slots.push(f.g.key); }
    if (!slots.length) return;
    grid.querySelectorAll('.tbgap').forEach(x => x.remove());
    slots.slice().reverse().forEach(k => { const b = grid.querySelector(`.tb[data-slot="${k}"]`); if (b) grid.insertBefore(b, grid.firstChild); });
  }
  Toolbar.sync(ToolState.cur);
}

/* ═══════════ 首选项套用（只管这一段新接的；旧的 5 区段由旧 apply 管） ═══════════ */
function applyMine(keys, all){
  const s = P.load(), want = pre => all || !keys || keys.some(k => k === pre || k.startsWith(pre + '.') || k === pre.split('.')[0]);
  hookStatus(); syncView(); hookCursors(); hookMenubar(); hookToolbar();
  // 工具提示：界面 ▸ 显示工具提示 与 工具 ▸ 显示工具提示 两个都开才显示（prefs_ui.rs:176 sync_tooltips）
  if (P.get('interface.showTooltips') === false || P.get('tools.showTooltips') === false){ let st = document.getElementById('pse-notips'); if (!st){ st = document.createElement('style'); st.id = 'pse-notips'; document.head.appendChild(st); } st.textContent = '.tbtip{display:none !important}'; }
  // 画布边界（prefs.rs:201 canvasBorder）：只在改过时套用（没改过＝画板原本的投影）
  const view = document.getElementById('view');
  if (view && want('interface.canvasBorder')){
    const b = s.interface && s.interface.canvasBorder;
    view.style.boxShadow = b === 'line' ? '0 0 0 1px #000' : b === 'none' ? 'none' : '';
  }
  if (want('cursors')) cursorCss();
  if (window.UI && UI.canvas){ sizeReadout(); UI.draw(); }
  if (window.PsView && PsView.e && PsView.e.rulers && PsView.drawRulers) PsView.drawRulers();
  if (want('menus') && window.Menubar && Menubar.openKey) Menubar.close();
  if ((want('toolbar') || all) && window.Toolbar && Toolbar.layout && Toolbar.layout.id === 'ps' && window.UI && UI._tbKind) Toolbar.build(Toolbar.kind);
}

/* ═══════════ 首选项对话框（prefs_ui.rs:649 prefs_body：左边 18 区段、右边该区段的栏位；接不上的区段写「还不能用」；「重置此区段」） ═══════════ */
const sel = (opts, pre) => opts.map(x => [x, T(pre + x)]);
function rowFor(sec, key){
  const path = sec + '.' + key, d = FULL[sec][key];
  const old = {
    'general.imageInterpolation':{label:T('pse.pref.imageInterpolation'), type:'select', options:sel(CHOICES['general.imageInterpolation'], 'pse.interp.')},
    'general.zoomWithScrollWheel':{type:'check', text:T('pse.pref.zoomWithScrollWheel')},
    'interface.language':{label:T('pse.pref.language'), type:'select', options:[['zh-Hant', '繁體中文'], ['zh-Hans', '简体中文'], ['en', 'English']]},
    'interface.canvasColor':{label:T('pse.pref.canvasColor'), type:'select', options:sel(CHOICES['interface.canvasColor'], 'pse.cc.')},
    'interface.canvasCustomColor':{label:T('pse.pref.customColor'), type:'color'},
    'tools.showTooltips':{type:'check', text:T('pse.pref.showTooltips')},
    'performance.historyStates':{label:T('pse.pref.historyStates'), type:'number', min:1, max:1000},
    'transparencyAndGamut.gridSize':{label:T('pse.pref.gridSize'), type:'select', options:sel(CHOICES['transparencyAndGamut.gridSize'], 'pse.gs.')},
    'transparencyAndGamut.gridColors':{label:T('pse.pref.gridColors'), type:'select', options:sel(CHOICES['transparencyAndGamut.gridColors'], 'pse.gc.')},
    'transparencyAndGamut.customLight':{label:T('pse.pref.customLight'), type:'color'},
    'transparencyAndGamut.customDark':{label:T('pse.pref.customDark'), type:'color'},
  }[path];
  if (old) return Object.assign({k:path, label:''}, old);
  const lab = T('pse3.pref.' + path);
  if (typeof d === 'boolean') return {k:path, label:'', type:'check', text:lab};
  if (CHOICES[path]){
    const pre = CHOICES[path] === UNITS ? 'pse3.unit.' : CHOICES[path] === LINE_STYLES ? 'pse3.line.' : 'pse3.ch.' + path + '.';
    return {k:path, label:lab, type:'select', options:sel(CHOICES[path], pre)};
  }
  if (COLOR_KEYS.has(key)) return {k:path, label:lab, type:'color'};
  if (typeof d === 'number'){ const r = RANGE[path] || []; return {k:path, label:lab, type:'number', min:r[0], max:r[1], step:INTS.has(path) ? 1 : 'any'}; }
  return {k:path, label:lab, type:'text'};
}
function openPrefs(section){
  if (!SECTIONS.includes(section)) section = 'general';
  const cur = P.view();
  const rowsBy = {};
  for (const sec of SECTIONS) rowsBy[sec] = SHOWN[sec].map(k => Object.assign(rowFor(sec, k), {value:cur[sec][k]}));
  const all = [].concat(...Object.values(rowsBy));
  const r = Dlg.open({cmd:'ps.edit.preferences', title:T('pse.prefs'),
    build(body, addRow, f){
      body.parentNode.classList.add('pse3-prefsdlg');
      const wrap = document.createElement('div'); wrap.className = 'pse-prefs';
      const nav = document.createElement('div'); nav.className = 'nav';
      const pane = document.createElement('div'); pane.className = 'pane';
      wrap.append(nav, pane); body.appendChild(wrap);
      const panes = {};
      SECTIONS.forEach(sec => {
        const it = document.createElement('div'); it.className = (sec === section ? 'on' : '') + (rowsBy[sec].length ? '' : ' empty');
        it.textContent = T('pse.sec.' + sec); it.dataset.sec = sec; nav.appendChild(it);
        const pn = document.createElement('div'); pn.dataset.sec = sec; pn.style.display = sec === section ? '' : 'none'; panes[sec] = pn; pane.appendChild(pn);
        const h = document.createElement('div'); h.className = 'pse3-sectitle'; h.textContent = T('pse.sec.' + sec); pn.appendChild(h);
        if (!rowsBy[sec].length){ const m = document.createElement('div'); m.className = 'pse3-na'; m.textContent = T('pse3.notAvailable'); pn.appendChild(m); }
        rowsBy[sec].forEach(row => addRow(row, pn));
        if (rowsBy[sec].length){                                         // 重置此区段（prefs_ui.rs:707）：表单回出厂值，按确定才存
          const b = document.createElement('button'); b.type = 'button'; b.className = 'pse3-reset'; b.dataset.act = 'resetSection'; b.textContent = T('pse3.resetSection');
          b.onclick = () => rowsBy[sec].forEach(row => { const e = f[row.k]; if (!e || row.k === 'interface.language') return; const dv = row.k === 'performance.historyStates' ? (PE._historyLimit0 || 50) : FULL[sec][row.k.split('.')[1]]; if (e.type === 'checkbox') e.checked = !!dv; else e.value = dv; e.dispatchEvent(new Event('change')); });
          pn.appendChild(b);
        }
        it.onclick = () => { nav.querySelectorAll('div').forEach(d => d.classList.toggle('on', d === it)); Object.entries(panes).forEach(([k, q]) => q.style.display = k === sec ? '' : 'none'); body.parentNode.dataset.section = sec; };
      });
    },
    ok(val){
      const ch = [];
      for (const row of all){
        let v = val[row.k];
        if (row.type === 'number'){ if (!isFinite(v)) return fail(`\`${row.k}\` must be a number`); if (INTS.has(row.k) || row.k === 'performance.historyStates') v = Math.round(v); }
        if (JSON.stringify(v) !== JSON.stringify(row.value)) ch.push([row.k, v]);
      }
      if (!ch.length) return {ok:true};
      const values = {}; ch.forEach(([k, v]) => values[k] = v);
      return CMD.run('ps.prefs.set', {values});
    }});
  if (Dlg.cur) Dlg.cur.el.querySelector('.pse-dlg').dataset.section = section;
  return r;
}
PE._historyLimit0 = PE._historyLimit0 || 40;
for (const sec of SECTIONS){
  CMD.reg('ps.edit.preferences.' + sec, {i18n:'', params:`{dialog?:true＝开「首选项」对话框停在这一区段} 首选项 ▸ ${sec}：回这一区段的值 {section,title,values}（prefs.rs edit.preferences.${sec}；改值用 ps.prefs.set）`},
    p => p.dialog ? openPrefs(sec) : {ok:true, section:sec, title:T('pse.sec.' + sec), values:P.get(sec)});
}
PE.open.prefs = openPrefs;
CMD.reg('ps.prefs.set', {i18n:'', params:'{path:"section.key"|"section"(整区段物件)|"shortcuts.<id>"|"menus.colors.<id>", value} 或 {values:{…}} 改首选项（照 prefs.rs 验：选项、范围、#rrggbb、整数；全有或全无；存进浏览器）。18 区段全收（区段与预设值见 ps.prefs.get）'}, p => {
  const ch = [];
  if (typeof p.path === 'string'){ if (!('value' in p)) return fail('prefs.set: missing `value`'); ch.push([p.path, p.value]); }
  if (p.values && typeof p.values === 'object') for (const k in p.values) ch.push([k, p.values[k]]);
  if (!ch.length) return fail('prefs.set: give `path` and `value`, or `values: {path: value, …}`');
  const e = P.set(ch); if (e) return fail('prefs.set: ' + e);
  const out = {}; expand(ch).forEach(([k]) => out[k] = P.get(k)); return out;
});

/* ═══════════ 键盘快捷键和菜单 对话框（prefs_ui.rs:850 shortcuts_body：三页——键盘快捷键／菜单／工具栏） ═══════════ */
function openShortcuts(tab){
  const list = bindable();
  const v = P.view();
  const st = {tab, filter:'', ov:Object.assign({}, v.shortcuts), hidden:v.menus.hidden.slice(), colors:Object.assign({}, v.menus.colors),
              tbHidden:v.toolbar.hidden.slice(), selected:'', capture:false, message:''};
  const tops = {}; MenuTrees.list('ps').forEach(({key, tree}) => tops[key] = Menubar.name(tree));
  let host = null, msgEl = null;
  const render = () => {
    if (!host) return;
    host.innerHTML = '';
    const tabs = document.createElement('div'); tabs.className = 'pse3-tabs';
    ['pse3.sc.tabKeys', 'pse3.sc.tabMenus', 'pse3.sc.tabToolbar'].forEach((k, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pse3-tab' + (st.tab === i ? ' on' : ''); b.dataset.tab = String(i); b.textContent = T(k);
      b.onclick = () => { st.tab = i; st.capture = false; render(); }; tabs.appendChild(b);
    });
    host.appendChild(tabs);
    if (st.tab === 2){ renderToolbarTab(); return; }
    const sr = document.createElement('div'); sr.className = 'pse-row';
    const sl = document.createElement('span'); sl.className = 'lb'; sl.textContent = T('pse3.sc.search'); sr.appendChild(sl);
    const q = document.createElement('input'); q.type = 'text'; q.className = 'pse3-sc-filter'; q.placeholder = T('pse3.sc.searchHint'); q.value = st.filter;
    q.oninput = () => { st.filter = q.value; renderList(); }; sr.appendChild(q); host.appendChild(sr);
    const box = document.createElement('div'); box.className = 'pse3-sc-list'; host.appendChild(box);
    const renderList = () => {
      box.innerHTML = '';
      const needle = st.filter.toLowerCase(); let lastTop = '';
      for (const b of list){
        const cur = effSc(st.ov, b.id, b.def);
        const hay = `${tops[b.top]} ${b.path.join(' ')} ${b.label} ${cur || ''}`.toLowerCase();
        if (needle && !hay.includes(needle) && !b.id.toLowerCase().includes(needle)) continue;
        if (b.top !== lastTop){ const h = document.createElement('div'); h.className = 'pse3-sc-top'; h.textContent = tops[b.top]; box.appendChild(h); lastTop = b.top; }
        const row = document.createElement('div'); row.className = 'pse3-sc-row' + (st.selected === b.id ? ' on' : ''); row.dataset.id = b.id;
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = (b.path.length ? b.path.join(' › ') + ' › ' : '') + b.label; row.appendChild(nm);
        nm.onclick = () => { st.selected = b.id; renderList(); };
        if (st.tab === 0){
          const k = document.createElement('button'); k.type = 'button'; k.className = 'pse3-sc-key' + (b.id in st.ov ? ' mod' : ''); k.dataset.id = b.id;
          k.textContent = st.selected === b.id && st.capture ? T('pse3.sc.press') : (cur || '');
          k.onclick = () => { st.selected = b.id; st.capture = true; st.message = ''; renderList(); setMsg(); const kk = box.querySelector(`.pse3-sc-key[data-id="${CSS.escape(b.id)}"]`); if (kk) kk.focus(); };
          row.appendChild(k);
          const m = document.createElement('span'); m.className = 'mk'; m.textContent = b.id in st.ov ? T('pse3.sc.modified') : ''; row.appendChild(m);
        } else {
          const lab = document.createElement('label'); lab.className = 'vis';
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'pse3-mn-vis'; cb.dataset.id = b.id; cb.checked = !st.hidden.includes(b.id);
          cb.onchange = () => { if (cb.checked) st.hidden = st.hidden.filter(h => h !== b.id); else if (!st.hidden.includes(b.id)) st.hidden.push(b.id); };
          lab.append(cb, document.createTextNode(T('pse3.sc.visible'))); row.appendChild(lab);
          const cs = document.createElement('select'); cs.className = 'pse3-mn-col'; cs.dataset.id = b.id;
          MENU_COLORS.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = T('pse3.color.' + c); cs.appendChild(o); });
          cs.value = st.colors[b.id] || 'none';
          cs.onchange = () => { if (cs.value === 'none') delete st.colors[b.id]; else st.colors[b.id] = cs.value; };
          row.appendChild(cs);
        }
        box.appendChild(row);
      }
    };
    renderList();
    const bar = document.createElement('div'); bar.className = 'pse3-sc-bar';
    const btn = (key, act, fn) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.act = act; b.textContent = T(key); b.onclick = () => { fn(); renderList(); setMsg(); }; bar.appendChild(b); };
    if (st.tab === 0){
      btn('pse3.sc.useDefault', 'useDefault', () => { if (st.selected){ delete st.ov[st.selected]; st.message = T('pse3.sc.msgDefault'); } });
      btn('pse3.sc.delete', 'deleteShortcut', () => { if (st.selected){ st.ov[st.selected] = ''; st.message = T('pse3.sc.msgRemoved'); } });
      btn('pse3.sc.resetAll', 'resetAll', () => { st.ov = {}; st.message = T('pse3.sc.msgResetAll'); });
    } else btn('pse3.sc.showAll', 'showAll', () => { st.hidden = []; st.colors = {}; });
    host.appendChild(bar);
    msgEl = document.createElement('div'); msgEl.className = 'pse3-sc-msg'; host.appendChild(msgEl); setMsg();
  };
  const setMsg = () => { if (msgEl){ msgEl.textContent = st.message; msgEl.classList.toggle('warn', /!/.test(st.message) || st.message.includes(T('pse3.sc.inUseMark'))); } };
  const renderToolbarTab = () => {
    const box = document.createElement('div'); box.className = 'pse3-sc-list';
    TOOLBAR_LAYOUTS.ps.slots.forEach(slot => slot.items.forEach(it => {
      const row = document.createElement('div'); row.className = 'pse3-sc-row';
      const lab = document.createElement('label'); lab.className = 'vis';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'pse3-tb-vis'; cb.dataset.id = it.id; cb.checked = !st.tbHidden.includes(it.id);
      cb.onchange = () => { if (cb.checked) st.tbHidden = st.tbHidden.filter(h => h !== it.id); else if (!st.tbHidden.includes(it.id)) st.tbHidden.push(it.id); };
      lab.append(cb, document.createTextNode(' ' + (it.n[Lang.cur] || it.n.en))); row.appendChild(lab);
      const k = document.createElement('span'); k.className = 'mk'; k.textContent = it.key || ''; row.appendChild(k);
      box.appendChild(row);
    }));
    host.appendChild(box);
    const bar = document.createElement('div'); bar.className = 'pse3-sc-bar';
    const b = document.createElement('button'); b.type = 'button'; b.dataset.act = 'restoreToolbar'; b.textContent = T('pse3.sc.restore');
    b.onclick = () => { st.tbHidden = []; render(); }; bar.appendChild(b); host.appendChild(bar);
  };
  const r = Dlg.open({cmd:'ps.edit.keyboardShortcuts', title:T('pse3.sc.title'),
    build(body){
      body.parentNode.classList.add('pse3-scdlg');
      host = document.createElement('div'); host.className = 'pse3-sc'; body.appendChild(host);
      // 按键录制：比对话框自己的 Enter／Esc 早接（挂在外框的捕获阶段）
      body.parentNode.addEventListener('keydown', e => {
        if (!st.capture || st.tab !== 0 || !st.selected) return;
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;          // 只按修饰键：等真正的键（prefs_ui.rs:386）
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape'){ st.capture = false; }
        else if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey){ st.ov[st.selected] = ''; st.capture = false; st.message = T('pse3.sc.msgRemoved'); }
        else {
          const sc = eventSc(e);
          if (sc){
            const clash = list.filter(b => b.id !== st.selected && effSc(st.ov, b.id, b.def) === sc).map(b => [tops[b.top], ...b.path, b.label.replace(/…$/, '')].join(' › '));
            st.ov[st.selected] = sc; st.capture = false;
            st.message = clash.length ? T('pse3.sc.msgInUse').replace('{k}', sc).replace('{c}', clash.join('、')) : T('pse3.sc.msgAssigned').replace('{k}', sc);
          }
        }
        render();
      }, true);
      render();
    },
    ok(){
      // prefs_ui.rs:1135 confirm：新键从「没改过、预设就是这键」的原主人拿掉；整份换掉（reset＋set）；菜单与工具栏照存
      const ov = Object.assign({}, st.ov);
      for (const [id, sc] of Object.entries(ov)) if (sc) for (const b of list) if (b.id !== id && !(b.id in ov) && b.def === normSc(sc)) ov[b.id] = '';
      const a = CMD.run('ps.edit.keyboardShortcuts', {reset:true, set:ov, allowUnknown:true, removeConflicts:false}); if (a && a.ok === false) return a;
      CMD.run('ps.edit.menus', {reset:true, hide:st.hidden, color:st.colors});
      CMD.run('ps.edit.toolbar', {hidden:st.tbHidden});
      return {ok:true};
    }});
  return r;
}
PE.open.shortcuts = openShortcuts;

/* ═══════════ 样式（本段自己的；别改 style.css） ═══════════ */
(function style(){
  if (document.getElementById('pse3-prefs-style')) return;
  const s = document.createElement('style'); s.id = 'pse3-prefs-style';
  s.textContent = `
.pse-dlg.pse3-prefsdlg{max-width:820px}
.pse3-prefsdlg .pse-prefs .nav{min-width:170px;max-height:440px;overflow:auto}
.pse3-prefsdlg .pse-prefs .nav div.empty{color:#7a808a}
.pse3-prefsdlg .pse-prefs .pane{min-width:420px;max-height:440px;overflow:auto}
.pse3-sectitle{font-weight:600;margin:2px 0 8px}
.pse3-na{color:#7a808a;margin:6px 0}
.pse3-reset{margin-top:10px;background:#3a404a;color:#e6e8ec;border:1px solid #555c68;border-radius:4px;padding:3px 10px;cursor:pointer}
.pse-dlg.pse3-scdlg{max-width:760px;width:720px}
.pse3-tabs{display:flex;gap:6px;margin-bottom:8px}
.pse3-tab{background:#3a404a;color:#c8ced8;border:1px solid #555c68;border-radius:12px;padding:3px 12px;cursor:pointer}
.pse3-tab.on{background:#2f7fd8;border-color:#2f7fd8;color:#fff}
.pse3-sc-filter{width:260px}
.pse3-sc-list{max-height:380px;overflow:auto;border:1px solid #444a55;border-radius:4px;padding:4px 6px;margin-top:6px}
.pse3-sc-top{font-weight:600;margin:8px 0 2px;color:#e6e8ec}
.pse3-sc-row{display:flex;align-items:center;gap:10px;padding:1px 4px;border-radius:3px}
.pse3-sc-row:nth-child(even){background:rgba(255,255,255,.03)}
.pse3-sc-row.on{background:#284a73}
.pse3-sc-row .nm{flex:1;color:#b8bec8;cursor:pointer;padding-left:10px}
.pse3-sc-key{min-width:130px;background:#1d2026;color:#e6e8ec;border:1px solid #444a55;border-radius:3px;padding:1px 6px;font-size:12px;cursor:pointer}
.pse3-sc-key.mod{color:#7fb6ff}
.pse3-sc-row .mk{width:70px;color:#7a808a;font-size:11px}
.pse3-sc-row .vis{display:flex;align-items:center;gap:4px;color:#b8bec8}
.pse3-sc-bar{display:flex;gap:8px;margin-top:8px}
.pse3-sc-bar button{background:#3a404a;color:#e6e8ec;border:1px solid #555c68;border-radius:4px;padding:3px 10px;cursor:pointer}
.pse3-sc-msg{min-height:16px;margin-top:6px;color:#b8bec8;font-size:12px}
.pse3-sc-msg.warn{color:#ffb35c}
.pse3-recover{color:#ffcf7a}
.pse3-recover a{color:#7fb6ff;cursor:pointer;margin-left:6px;text-decoration:underline}
`;
  document.head.appendChild(s);
})();

/* ═══════════ 三语字串 ═══════════ */
(function strings(){
  const L = {'zh-Hant':{}, 'zh-Hans':{}, en:{}};
  const add = (k, t, s, e) => { L['zh-Hant'][k] = t; L['zh-Hans'][k] = s; L.en[k] = e; };
  // 区段名（prefs.rs:755；旧版已有 general／interface／tools／performance／transparencyAndGamut）
  add('pse.sec.workspace', '工作區', '工作区', 'Workspace'); add('pse.sec.historyLog', '步驟記錄', '历史记录', 'History Log');
  add('pse.sec.fileHandling', '檔案處理', '文件处理', 'File Handling'); add('pse.sec.export', '轉存', '导出', 'Export');
  add('pse.sec.scratchDisks', '暫存磁碟', '暂存盘', 'Scratch Disks'); add('pse.sec.cursors', '游標', '光标', 'Cursors');
  add('pse.sec.unitsAndRulers', '單位與尺標', '单位与标尺', 'Units & Rulers'); add('pse.sec.guidesGridAndSlices', '參考線、格點與切片', '参考线、网格和切片', 'Guides, Grid & Slices');
  add('pse.sec.plugIns', '增效模組', '增效工具', 'Plug-ins'); add('pse.sec.type', '文字', '文字', 'Type');
  add('pse.sec.enhancedControls', '增強控制項', '增强型控件', 'Enhanced Controls'); add('pse.sec.rawDefaults', 'Camera Raw 預設值', 'Camera Raw 默认值', 'Camera Raw Defaults');
  add('pse.sec.integrations', 'AI 整合', 'AI 集成', 'Integrations');
  add('pse3.notAvailable', '這些設定在畫板還不能用。', '这些设置在画板还不能用。', "These settings aren't available in this canvas yet.");
  add('pse3.resetSection', '重設此區段', '重置此区段', 'Reset Section');
  // 栏位
  add('pse3.pref.interface.canvasBorder', '邊界：', '边界：', 'Border:');
  add('pse3.pref.interface.showMenuColors', '顯示選單顏色', '显示菜单颜色', 'Show Menu Colors');
  add('pse3.pref.interface.showTooltips', '顯示工具提示', '显示工具提示', 'Show Tooltips');
  add('pse3.pref.tools.useShiftKeyForToolSwitch', '使用 Shift 鍵切換工具', '使用 Shift 键切换工具', 'Use Shift Key for Tool Switch');
  add('pse3.pref.historyLog.enabled', '步驟記錄', '历史记录', 'History Log');
  add('pse3.pref.historyLog.destination', '儲存記錄項目至：', '将记录项目存储到：', 'Save Log Items To:');
  add('pse3.pref.historyLog.filePath', '文字檔名稱：', '文本文件名：', 'Text File:');
  add('pse3.pref.historyLog.detail', '編輯記錄項目：', '编辑记录项目：', 'Edit Log Items:');
  add('pse3.pref.fileHandling.autosave', '自動儲存回復資訊', '自动存储恢复信息', 'Automatically Save Recovery Information');
  add('pse3.pref.fileHandling.autosaveMinutes', '間隔（分鐘）：', '间隔（分钟）：', 'Every (minutes):');
  add('pse3.pref.fileHandling.recoverOnLaunch', '開啟時提示回復文件', '打开时提示恢复文档', 'Offer to Recover on Launch');
  add('pse3.pref.cursors.painting', '繪畫游標：', '绘画光标：', 'Painting Cursors:');
  add('pse3.pref.cursors.showCrosshairInBrushTip', '在筆刷筆尖中顯示十字線', '在画笔笔尖显示十字线', 'Show Crosshair in Brush Tip');
  add('pse3.pref.cursors.showOnlyCrosshairWhilePainting', '繪畫時僅顯示十字線', '绘画时仅显示十字线', 'Show Only Crosshair While Painting');
  add('pse3.pref.cursors.other', '其他游標：', '其它光标：', 'Other Cursors:');
  add('pse3.pref.unitsAndRulers.rulers', '尺標：', '标尺：', 'Rulers:');
  add('pse3.pref.unitsAndRulers.pointSize', '點/派卡大小：', '点/派卡大小：', 'Point/Pica Size:');
  add('pse3.pref.guidesGridAndSlices.guideColor', '參考線顏色：', '参考线颜色：', 'Guide Color:');
  add('pse3.pref.guidesGridAndSlices.guideStyle', '參考線樣式：', '参考线样式：', 'Guide Style:');
  add('pse3.pref.guidesGridAndSlices.smartGuideColor', '智慧型參考線顏色：', '智能参考线颜色：', 'Smart Guide Color:');
  add('pse3.pref.guidesGridAndSlices.gridColor', '格點顏色：', '网格颜色：', 'Grid Color:');
  add('pse3.pref.guidesGridAndSlices.gridStyle', '格點樣式：', '网格样式：', 'Grid Style:');
  add('pse3.pref.guidesGridAndSlices.gridlineEvery', '格線間隔：', '网格线间隔：', 'Gridline Every:');
  add('pse3.pref.guidesGridAndSlices.gridUnit', '格線單位：', '网格线单位：', 'Gridline Unit:');
  add('pse3.pref.guidesGridAndSlices.subdivisions', '細分：', '子网格：', 'Subdivisions:');
  // 选项
  [['pixels', '像素', '像素', 'Pixels'], ['inches', '英寸', '英寸', 'Inches'], ['cm', '公分', '厘米', 'Centimeters'], ['mm', '公釐', '毫米', 'Millimeters'],
   ['points', '點', '点', 'Points'], ['picas', '派卡', '派卡', 'Picas'], ['percent', '百分比', '百分比', 'Percent']].forEach(([k, t, s, e]) => add('pse3.unit.' + k, t, s, e));
  [['lines', '線條', '直线', 'Lines'], ['dashedLines', '虛線', '虚线', 'Dashed Lines'], ['dots', '點', '网点', 'Dots']].forEach(([k, t, s, e]) => add('pse3.line.' + k, t, s, e));
  const ch = (path, rows) => rows.forEach(([k, t, s, e]) => add('pse3.ch.' + path + '.' + k, t, s, e));
  ch('interface.canvasBorder', [['dropShadow', '陰影', '投影', 'Drop Shadow'], ['line', '線條', '直线', 'Line'], ['none', '無', '无', 'None']]);
  ch('historyLog.destination', [['metadata', '中繼資料', '元数据', 'Metadata'], ['textFile', '文字檔', '文本文件', 'Text File'], ['both', '兩者', '两者', 'Both']]);
  ch('historyLog.detail', [['sessionsOnly', '僅限工作階段', '仅限工作进程', 'Sessions Only'], ['concise', '簡明', '简明', 'Concise'], ['detailed', '詳細', '详细', 'Detailed']]);
  ch('cursors.painting', [['standard', '標準', '标准', 'Standard'], ['precise', '精確', '精确', 'Precise'], ['normalTip', '正常筆刷筆尖', '正常画笔笔尖', 'Normal Brush Tip'], ['fullSizeTip', '全尺寸筆刷筆尖', '全尺寸画笔笔尖', 'Full Size Brush Tip']]);
  ch('cursors.other', [['standard', '標準', '标准', 'Standard'], ['precise', '精確', '精确', 'Precise']]);
  ch('unitsAndRulers.pointSize', [['postScript', 'PostScript (72 點/英寸)', 'PostScript (72 点/英寸)', 'PostScript (72 points/inch)'], ['traditional', '傳統 (72.27 點/英寸)', '传统 (72.27 点/英寸)', 'Traditional (72.27 points/inch)']]);
  // 键盘快捷键和菜单
  add('pse3.sc.title', '鍵盤快速鍵和選單', '键盘快捷键和菜单', 'Keyboard Shortcuts and Menus');
  add('pse3.sc.tabKeys', '鍵盤快速鍵', '键盘快捷键', 'Keyboard Shortcuts'); add('pse3.sc.tabMenus', '選單', '菜单', 'Menus'); add('pse3.sc.tabToolbar', '工具列', '工具栏', 'Toolbar');
  add('pse3.sc.search', '搜尋', '搜索', 'Search'); add('pse3.sc.searchHint', '指令或快速鍵', '命令或快捷键', 'command or shortcut');
  add('pse3.sc.press', '請按鍵…', '请按键…', 'Press keys…'); add('pse3.sc.modified', '已修改', '已修改', 'modified'); add('pse3.sc.visible', '可見度', '可见性', 'Visible');
  add('pse3.sc.useDefault', '使用預設值', '使用默认值', 'Use Default'); add('pse3.sc.delete', '刪除快速鍵', '删除快捷键', 'Delete Shortcut');
  add('pse3.sc.resetAll', '全部回復預設值', '全部恢复默认值', 'Reset All to Defaults'); add('pse3.sc.showAll', '顯示所有選單項目', '显示所有菜单项目', 'Show All Menu Items');
  add('pse3.sc.restore', '恢復預設值', '恢复默认值', 'Restore Defaults');
  add('pse3.sc.msgDefault', '已回復預設值。', '已恢复默认值。', 'Default restored.'); add('pse3.sc.msgRemoved', '已移除快速鍵。', '已移除快捷键。', 'Shortcut removed.');
  add('pse3.sc.msgResetAll', '全部快速鍵已回復為 Photoshop 預設值。', '全部快捷键已恢复为 Photoshop 默认值。', 'All shortcuts reset to Photoshop defaults.');
  add('pse3.sc.msgAssigned', '已指定 {k}。', '已指定 {k}。', '{k} assigned.');
  add('pse3.sc.msgInUse', '{k} 已被「{c}」使用，按確定後會從那裡移除！', '{k} 已被「{c}」使用，按确定后会从那里移除！', '{k} is already in use by {c} and will be removed from it when you click OK!');
  add('pse3.sc.inUseMark', '！', '！', '!');
  [['none', '無', '无', 'None'], ['red', '紅色', '红色', 'Red'], ['orange', '橙色', '橙色', 'Orange'], ['yellow', '黃色', '黄色', 'Yellow'], ['green', '綠色', '绿色', 'Green'],
   ['blue', '藍色', '蓝色', 'Blue'], ['violet', '紫色', '紫色', 'Violet'], ['gray', '灰色', '灰色', 'Gray']].forEach(([k, t, s, e]) => add('pse3.color.' + k, t, s, e));
  add('pse3.rec.found', '有自動儲存的回復檔（{t}）', '有自动存储的恢复档（{t}）', 'Recovery information found ({t})');
  add('pse3.rec.restore', '回復', '恢复', 'Recover'); add('pse3.rec.discard', '丟棄', '丢弃', 'Discard');
  Lang.add(L);
})();

/* ═══════════ 开机：套用存下来的首选项、每 15 秒看一次自动存储、提示恢复 ═══════════ */
function boot3(){
  PE._historyLimit0 = PE._historyLimit0 || 40;
  P.apply(null, false);
  setInterval(() => { try { Auto.tick(); } catch(e){} }, 15000);
  setTimeout(() => { try { Auto.banner(); } catch(e){} }, 300);
}
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => setTimeout(boot3, 10)); else boot3();
})();

/* ═══════════ PS 编辑的剪切／拷贝／粘贴改走共用剪贴簿 DlClipboard（menus/impl/clipboard.js）
   PS 与 AI 两边的剪切／拷贝／粘贴共用同一份；顺手写进系统剪贴簿（DlClipboard 放进去时自己 publish）；
   贴上时内部是空的、系统剪贴簿有图 ⇒ 贴成新像素层。
   做法（本档前面的剪贴板段 253-386 行不动，这里在命令外面包一层）：
   · 拷贝／合并拷贝／剪切：先照原段 lift（edit_cmds.rs:41）算出同一块像素，原命令跑成功后放进 DlClipboard（像素格式＝原段的 Clip：{px, bounds}）。
     当前层是文字层（PS 不能拷文字层的像素）⇒ 整层放进去（DlClipboard.setLayer）；剪切＝整层拷走再删掉该层（一步历史）。
   · 粘贴／原位粘贴／贴入／外部粘贴：DlClipboard 里是 PS 自己刚拷的那份 ⇒ 交回原命令（原段的 Clip 一模一样）；
     是别人放的（AI 拷的矢量物件、整层、AI 那边放的像素）⇒ 这里贴：像素照原段 pasteImpl／pasteIntoImpl（edit_cmds.rs:115、extra_cmds.rs:297）逐段抄；
     矢量物件＝新矢量层（形状原样、可再编辑）；文字整层＝新文字层。
     DlClipboard 是空的 ⇒ 读系统剪贴簿（非同步），有图就贴成新像素层（DlClipboard.pasteImage）。
   · 清理 ▸ 剪贴板／全部：连 DlClipboard 一起清。
   DlClipboard 没载入时一切照原命令。 */
(function(){
'use strict';
const PE = window.PsEdit; if (!PE || PE._pse3_clip) return; PE._pse3_clip = true;
const DC = () => window.DlClipboard || null;
const fail = msg => ({ok:false, error:msg});

/* —— 本档前面的小工具（闭包里拿不到，照抄同一套） —— */
const Rc = {
  inter(a, b){ if (!a || !b) return null; const r = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]; return (r[2] > r[0] && r[3] > r[1]) ? r : null; },
  union(a, b){ return !a ? (b ? b.slice() : null) : !b ? a.slice() : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; },
  w: r => r[2] - r[0], h: r => r[3] - r[1],
  eq: (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3],
};
const docRect = () => [0, 0, Doc.width, Doc.height];
function selRect(){
  const s = Doc.sel; if (!s) return null;
  const r = [Math.floor(Math.min(s.x, s.x + s.w)), Math.floor(Math.min(s.y, s.y + s.h)), Math.ceil(Math.max(s.x, s.x + s.w)), Math.ceil(Math.max(s.y, s.y + s.h))];
  return (r[2] > r[0] && r[3] > r[1]) ? r : null;
}
const selBytes = () => (Doc.sel && window.SelMask) ? SelMask.bytes() : null;
const canvasRect = L => [L.x, L.y, L.x + L.data.canvas.width, L.y + L.data.canvas.height];
function readCanvas(cv, ox, oy, r){
  const w = Rc.w(r), h = Rc.h(r), out = new Uint8ClampedArray(w * h * 4);
  const lr = Rc.inter(r, [ox, oy, ox + cv.width, oy + cv.height]);
  if (!lr) return out;
  const lw = Rc.w(lr);
  const d = cv.getContext('2d', {willReadFrequently:true}).getImageData(lr[0] - ox, lr[1] - oy, lw, Rc.h(lr)).data;
  for (let y = lr[1]; y < lr[3]; y++){ const so = (y - lr[1]) * lw * 4; out.set(d.subarray(so, so + lw * 4), ((y - r[1]) * w + (lr[0] - r[0])) * 4); }
  return out;
}
const readLayer = (L, r) => readCanvas(L.data.canvas, L.x, L.y, r);
function ensureCovers(L, r){
  if (window.LayerBox && LayerBox.growable(L)){ LayerBox.ensureCovers(L, r); return; }   // 统一入口（连跟着图层走的蒙版一起长·engine.js LayerBox）
  const cur = canvasRect(L), u = Rc.union(cur, r);
  if (Rc.eq(u, cur)) return;
  const c = document.createElement('canvas'); c.width = Rc.w(u); c.height = Rc.h(u);
  const x = c.getContext('2d', {willReadFrequently:true});
  x.drawImage(L.data.canvas, cur[0] - u[0], cur[1] - u[1]);
  L.data.canvas = c; L.data.ctx = x; L.x = u[0]; L.y = u[1];
}
function writeLayer(L, r, px){ ensureCovers(L, r); L.data.ctx.putImageData(new ImageData(px, Rc.w(r), Rc.h(r)), r[0] - L.x, r[1] - L.y); Layer.invalidate(L); }
function alphaBounds(px, r){
  const w = Rc.w(r), h = Rc.h(r); let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  return x1 < 0 ? null : [r[0] + x0, r[1] + y0, r[0] + x1 + 1, r[1] + y1 + 1];
}
function cropPx(px, r, c){
  const w = Rc.w(r), cw = Rc.w(c), out = new Uint8ClampedArray(cw * Rc.h(c) * 4);
  for (let y = c[1]; y < c[3]; y++){ const so = ((y - r[1]) * w + (c[0] - r[0])) * 4; out.set(px.subarray(so, so + cw * 4), (y - c[1]) * cw * 4); }
  return out;
}
function nextLayerName(base){
  const names = new Set(Doc.layers.map(L => L.name));
  for (let n = 1; n <= names.size + 1; n++){ const s = `${base} ${n}`; if (!names.has(s)) return s; }
  return base;
}

/* edit_cmds.rs:41 lift（＝本档 256 行）：选区内（或整层内容）的像素，alpha 乘选区覆盖度，裁到有内容的范围 */
function lift(srcPx, srcR, cov){
  const area = Rc.inter(cov ? selRect() : (alphaBounds(srcPx, srcR) || null), docRect());
  if (!area) return null;
  const w = Rc.w(area), px = cropPx(srcPx, srcR, area), DW = Doc.width;
  if (cov) for (let y = area[1]; y < area[3]; y++) for (let x = area[0]; x < area[2]; x++){
    const i = ((y - area[1]) * w + (x - area[0])) * 4 + 3;
    px[i] = Math.round(px[i] * cov[y * DW + x] / 255);
  }
  const b = alphaBounds(px, area);
  return b ? {px:cropPx(px, area, b), bounds:b} : null;
}
/* edit_cmds.rs:73 copy 的取像素那一半（不动剪贴板） */
function grab(merged){
  const cov = selBytes();
  if (merged){ const c = composite(1), r = docRect(); return lift(c.getContext('2d').getImageData(0, 0, r[2], r[3]).data, r, cov); }
  const L = Doc.active(); if (!L || L.kind !== 'raster') return null;
  const r = canvasRect(L); return lift(readLayer(L, r), r, cov);
}

/* —— 包命令 —— */
const orig = {};
['ps.edit.cut', 'ps.edit.copy', 'ps.edit.copyMerged', 'ps.edit.paste', 'ps.edit.pasteSpecial.pasteInPlace', 'ps.edit.pasteSpecial.pasteInto',
 'ps.edit.pasteSpecial.pasteOutside', 'ps.edit.purge.clipboard', 'ps.edit.purge.all'].forEach(id => { orig[id] = CMD.map[id]; });
let psSerial = -1;           // DlClipboard 里那份是不是 PS 自己刚拷的（序号对得上 ⇒ 原段的 Clip 一模一样）
const mine = () => { const d = DC(), c = d && d.get(); return !!(c && c.kind === 'pixels' && c.serial === psSerial); };
function rereg(id, extra, fn){
  const o = orig[id]; if (!o) return;
  CMD.reg(id, {i18n:o.i18n || '', undoable:!!o.undoable, params:o.params + extra}, fn);
}
const PSTAG = {from:'ps'};
/* 拷贝／合并拷贝 */
['ps.edit.copy', 'ps.edit.copyMerged'].forEach(id => rereg(id, '；放进 PS／AI 共用剪贴簿 DlClipboard（也写进系统剪贴簿）；当前层是文字层 ⇒ 整层拷进去', p => {
  const d = DC(), merged = id === 'ps.edit.copyMerged';
  const L = Doc.active();
  if (d && !merged && L && L.kind === 'text'){ d.setLayer(L); psSerial = -1; return {ok:true, layer:L.id, kind:'layer'}; }
  const g = d ? grab(merged) : null;
  const r = orig[id].run(p);
  if (d && g && !(r && r.ok === false)){ d.setPixels(g.px, g.bounds, PSTAG); psSerial = d.serial; }
  return r;
}));
/* 剪切 */
rereg('ps.edit.cut', '；放进共用剪贴簿 DlClipboard；当前层是文字层 ⇒ 整层拷进去再删掉该层', p => {
  const d = DC(), L = Doc.active();
  if (d && L && L.kind === 'text'){
    if (L.locks && L.locks.all) return fail(`Could not complete your request because the layer "${L.name}" is locked`);
    d.setLayer(L); psSerial = -1; Doc.remove(L.id); return {ok:true, layer:L.id, kind:'layer'};
  }
  const g = d ? grab(false) : null;
  const r = orig['ps.edit.cut'].run(p);
  if (d && g && !(r && r.ok === false)){ d.setPixels(g.px, g.bounds, PSTAG); psSerial = d.serial; }
  return r;
});

/* edit_cmds.rs:115 paste（＝本档 306 行 pasteImpl，来源换成 {px, bounds}） */
function pastePixels(src, p, inPlace){
  const canvas = docRect(), b = src.bounds;
  let dx = 0, dy = 0;
  const center = Array.isArray(p.center) && p.center.length >= 2 ? [Number(p.center[0]) || 0, Number(p.center[1]) || 0] : null;
  const inside = Rc.eq(Rc.inter(b, canvas), b);
  if (!(inPlace || (inside && !center))){
    const c = center || [(canvas[0] + canvas[2]) / 2, (canvas[1] + canvas[3]) / 2];
    dx = Math.round(c[0] - (b[0] + b[2]) / 2); dy = Math.round(c[1] - (b[1] + b[3]) / 2);
  }
  const L = Layer.raster(nextLayerName(Lang.t('layer.untitled')));
  writeLayer(L, [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy], new Uint8ClampedArray(src.px));
  const above = Doc.activeId ? Doc.index(Doc.activeId) + 1 : Doc.layers.length;
  Doc.add(L, above);
  Doc.sel = null;
  return {ok:true, layer:L.id, offset:[dx, dy]};
}
/* 矢量物件（AI 拷的）贴进 PS：新矢量层、形状原样（同样的「在画布内且没给中心＝原位，否则置中」） */
function pasteShapes(c, p, inPlace){
  const b = c.bounds ? [c.bounds.x0, c.bounds.y0, c.bounds.x1, c.bounds.y1] : null;
  let dx = 0, dy = 0;
  const center = Array.isArray(p.center) && p.center.length >= 2 ? [Number(p.center[0]) || 0, Number(p.center[1]) || 0] : null;
  if (b && !inPlace){
    const inside = b[0] >= 0 && b[1] >= 0 && b[2] <= Doc.width && b[3] <= Doc.height;
    if (!inside || center){ const q = center || [Doc.width / 2, Doc.height / 2]; dx = Math.round(q[0] - (b[0] + b[2]) / 2); dy = Math.round(q[1] - (b[1] + b[3]) / 2); }
  }
  const above = () => Doc.activeId ? Doc.index(Doc.activeId) + 1 : Doc.layers.length;
  const ids = [];
  if ((c.shapes || []).length){
    const L = Layer.vector((c.sourceLayer && c.sourceLayer.name) || nextLayerName(Lang.t('layer.vector')));
    L.data.shapes = c.shapes.map(s => { const t = JSON.parse(JSON.stringify(s)); shiftShape(t, dx, dy); t.id = 'S' + Math.random().toString(36).slice(2, 9); return t; });
    Doc.add(L, above()); ids.push(L.id);
  }
  for (const T of c.texts || []){
    const L = Layer.text(T.name, JSON.parse(JSON.stringify(T.data)));
    Object.assign(L, {visible:T.visible !== false, opacity:T.opacity == null ? 1 : T.opacity, blend:T.blend || 'normal', x:(T.x || 0) + dx, y:(T.y || 0) + dy});
    Doc.add(L, above()); ids.push(L.id);
  }
  if (!ids.length) return fail('the clipboard is empty');
  Doc.sel = null;
  return {ok:true, layer:ids[ids.length - 1], layers:ids, offset:[dx, dy], kind:'shapes'};
}
/* 整层（PS 拷的文字层、或 agent 放的）：照原样复制一层（像素层走 pastePixels） */
function pasteLayer(c, p, inPlace){
  const o = c.layer;
  if (o.kind === 'raster') return pastePixels({px:o.px, bounds:o.bounds}, p, inPlace);
  const L = o.kind === 'vector' ? Layer.vector(o.name) : Layer.text(o.name, JSON.parse(JSON.stringify(o.data)));
  if (o.kind === 'vector') L.data = JSON.parse(JSON.stringify(o.data));
  Object.assign(L, {visible:o.visible !== false, opacity:o.opacity == null ? 1 : o.opacity, blend:o.blend || 'normal', x:o.x || 0, y:o.y || 0});
  ['style', 'fillOpacity'].forEach(k => { if (o[k] !== undefined) L[k] = JSON.parse(JSON.stringify(o[k])); });
  if (Array.isArray(p.center) && !inPlace){
    const cv = renderLayer(L, 1), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const b = alphaBounds(d, [0, 0, cv.width, cv.height]);
    if (b){ const dx = Math.round(p.center[0] - (b[0] + b[2]) / 2), dy = Math.round(p.center[1] - (b[1] + b[3]) / 2); L.x += dx; L.y += dy; }
  }
  Doc.add(L, Doc.activeId ? Doc.index(Doc.activeId) + 1 : Doc.layers.length);
  Doc.sel = null;
  return {ok:true, layer:L.id, kind:'layer'};
}
/* 系统剪贴簿（内部空的时候）：有图 ⇒ 新像素层（非同步，回 Promise） */
function pasteSystem(p){
  const d = DC(); if (!d) return null;
  return d.readSystem().then(sys => {
    if (!sys || !sys.image) return fail('the clipboard is empty');
    return d.pasteImage(sys.image, Array.isArray(p.center) ? {center:p.center} : null).then(r => Object.assign({ok:true, system:true}, r));
  });
}
function pasteAny(id, p, inPlace){
  const d = DC(), c = d && d.get();
  if (!d || mine()) return orig[id].run(p);                       // PS 自己拷的 ⇒ 原命令（原段 Clip 一模一样）
  if (!c) return pasteSystem(p) || orig[id].run(p);
  if (c.kind === 'pixels') return pastePixels(c, p, inPlace);
  if (c.kind === 'shapes') return pasteShapes(c, p, inPlace);
  return pasteLayer(c, p, inPlace);
}
rereg('ps.edit.paste', '；来源＝共用剪贴簿 DlClipboard：PS 拷的像素、AI 拷的矢量物件（贴成新矢量层）、整层（复制成一层）；剪贴簿空的 ⇒ 读系统剪贴簿的图（回 Promise）', p => pasteAny('ps.edit.paste', p, false));
rereg('ps.edit.pasteSpecial.pasteInPlace', '；来源同 ps.edit.paste', p => pasteAny('ps.edit.pasteSpecial.pasteInPlace', p, true));

/* extra_cmds.rs:297 paste_into（＝本档 327 行 pasteIntoImpl）：来源不是 PS 自己拷的 ⇒ 先换成像素（DlClipboard.asPixels：矢量／文字照画面渲成像素），照原段贴、挂蒙版 */
function pasteIntoPixels(src, p, outside){
  const s = Doc.sel; if (!s) return fail('Paste Into needs a selection');
  const cov = new Uint8Array(selBytes());
  const b = selRect();
  const q = Object.assign({center:[(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]}, p.center ? {center:p.center} : {});
  const r = pastePixels(src, q, false);
  const L = Doc.byId(r.layer);
  const masks = (History._extraProps || History._psLayerShim) && L.x === 0 && L.y === 0 && L.data.canvas.width === Doc.width && L.data.canvas.height === Doc.height;
  if (masks){
    const W = Doc.width, H = Doc.height, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', {willReadFrequently:true}), img = x.createImageData(W, H), dd = img.data;
    for (let i = 0; i < W * H; i++){ dd[i * 4] = dd[i * 4 + 1] = dd[i * 4 + 2] = 255; dd[i * 4 + 3] = outside ? 255 - cov[i] : cov[i]; }
    x.putImageData(img, 0, 0);
    L.mask = {id:'M' + L.id, kind:'raster', name:'mask', visible:true, opacity:1, blend:'normal', mask:null, x:0, y:0, _cache:null, _cacheScale:0, data:{canvas:c, ctx:x}};
    delete L.maskOff;
    r.mask = true;
    return r;
  }
  const area = Rc.inter(canvasRect(L), docRect());
  if (area){
    const px = readLayer(L, area), w = Rc.w(area), DW = Doc.width;
    for (let y = area[1]; y < area[3]; y++) for (let x = area[0]; x < area[2]; x++){
      const i = ((y - area[1]) * w + (x - area[0])) * 4 + 3, k = cov[y * DW + x] / 255;
      px[i] = Math.round(px[i] * (outside ? 1 - k : k));
    }
    writeLayer(L, area, px);
  }
  if (!outside){                                                   // 画布外的部分：贴入＝全藏（本档 360 行 cropLayerTo）
    const cr = canvasRect(L), keep = Rc.inter(cr, docRect());
    if (!Rc.eq(keep, cr)){ const px = keep ? readLayer(L, keep) : null; L.data.ctx.clearRect(0, 0, L.data.canvas.width, L.data.canvas.height); if (keep) writeLayer(L, keep, px); }
  }
  return r;
}
['ps.edit.pasteSpecial.pasteInto', 'ps.edit.pasteSpecial.pasteOutside'].forEach(id => rereg(id, '；来源同 ps.edit.paste（矢量／文字先照画面渲成像素）', p => {
  const d = DC(), c = d && d.get();
  if (!d || !c || mine()) return orig[id].run(p);
  if (!Doc.sel) return fail('Paste Into needs a selection');
  const src = d.asPixels(); if (!src) return fail('the clipboard is empty');
  return pasteIntoPixels(src, p, id.endsWith('pasteOutside'));
}));

/* 清理 ▸ 剪贴板／全部：共用剪贴簿一起清 */
['ps.edit.purge.clipboard', 'ps.edit.purge.all'].forEach(id => rereg(id, '（连 PS／AI 共用剪贴簿一起清）', p => {
  const r = orig[id].run(p); const d = DC(); if (d) d.clear(); psSerial = -1; return r;
}));

/* PsEdit.clip()：看的是「下一次粘贴会贴什么」——PS 自己拷的（原段 Clip）或共用剪贴簿里别人放的 */
const clip0 = PE.clip;
PE.clip = function(){
  const d = DC(), c = d && d.get();
  if (!d || mine() || !c) return (d && !c) ? null : clip0();
  const p = d.asPixels(); if (!p) return null;
  return {bounds:p.bounds.slice(), w:Rc.w(p.bounds), h:Rc.h(p.bounds), kind:c.kind, shared:true};
};
PE.clipShared = () => { const d = DC(); return d ? Object.assign({fromPs:mine()}, d.info()) : null; };
})();

/* ═══════════ color（照 photocraft engine/src/color_cmds.rs ＋ cms/src 抄） ═══════════
   编辑 ▸ 颜色设置… ／ 指定配置文件… ／ 转换为配置文件…（＋ 给 agent 查的 ps.edit.profileInfo）
   对照源（photocraft/crates/…）：
     engine/src/color_cmds.rs     ColorSettings 101-173、validate_settings 176-194、ColorState.working/resolve 211-232、
                                  document_profile 434-440、composite_profile 443-453、resolve_profile 457-479、profile_json 496-506、
                                  convert_document 624-644（convert_color 543-557、convert_layer_colors 567-610）、
                                  assign_profile 708-730、convert_to_profile 732-744、profile_info 746-762、color_settings 811-876、specs 933-972
     engine/src/display_color.rs  画面显示转换：DISPLAY_INTENT/BPC 33-34、monitor 164-186、canvas_display 189-219、is_identity 129-141、encode_rgba8 86-100
     engine/src/prefs.rs:1228-1290  colorSettings 跟首选项存一起，prefs.get/set 的 `colorSettings.*` 走颜色设置
     cms/src/builtin.rs           内建配置文件（原色、白点、TRC）、colorants（D50 适应＋s15Fixed16 量化＋中性修正）、from_id 别名
     cms/src/math.rs              3×3 矩阵、Bradford、rgb_to_xyz_matrix、s15f16_round
     cms/src/curve.rs             curv/para 曲线与反函数（para 0–4、mirror）
     cms/src/profile.rs:221-339   media_white、gray_as_rgb、supports_intent、device_to_pcs／pcs_to_device
     cms/src/pipeline.rs          各级（Curves／InvCurves／Matrix／Clamp01）、optimize（去恒等、合并相邻 3×3）
     cms/src/transform.rs         Transform::new／from_pipeline（尾端反曲线拆成 x^¼ 输出表）、run_u8（8 位：Shaper 核＝曲线表＋f32 矩阵）、
                                  link_stages／connection（绝对比色白点缩放、黑场补偿）／black_point
     cms/src/write.rs:9-70        存进文件的配置文件参数是 s15Fixed16（文件标记后读回来的曲线参数是量化过的）
     ui-egui/src/prefs_ui.rs:414-424、filter_dialog.rs:44-107,150-200  对话框＝照命令参数说明生成的栏位（选项缺省取第一个；颜色设置先填目前值）
   🔴 浮点：原码 8 位路径是 f32 运算，这里每一步用 Math.fround 照做，结果跟原码逐位一致（对照程序 用原码 crate 跑过对照）。
   我们的文件只有 RGB（和本档加的「灰度」标记：像素存成 R=G=B，同原码灰度文件的合成方式 profile.rs:228 gray_as_rgb）；
   原码转到 CMYK／Lab 会把文件模式换成 CMYK／Lab，我们没有这两种模式 ⇒ 这两种目标报错。 */
(function(){
'use strict';
const PE = window.PsEdit; if (!PE || PE._pse3_color) return; PE._pse3_color = true;
const T = k => Lang.t(k);
const fail = msg => ({ok:false, error:msg});
const f32 = Math.fround;
const isNum = v => typeof v === 'number' && isFinite(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ═══════════ math.rs ═══════════ */
const D50 = [0.9642, 1.0, 0.8249];                                     // math.rs:8
const D65_XY = [0.3127, 0.3290];                                       // math.rs:12
const mul = (a, b) => [0, 1, 2].map(i => [0, 1, 2].map(j => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));   // math.rs:19
const apply = (m, v) => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
function invert(m){                                                    // math.rs:39
  const d = det(m);
  if (!isFinite(d) || Math.abs(d) < 1e-12) return null;
  const inv = 1.0 / d;
  return [
    [(m[1][1] * m[2][2] - m[1][2] * m[2][1]) * inv, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * inv, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * inv],
    [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) * inv, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * inv, (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * inv],
    [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) * inv, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * inv, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * inv],
  ];
}
const xyToXyz = ([x, y]) => [x / y, 1.0, (1.0 - x - y) / y];          // math.rs:55
const BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
function bradford(src, dst){                                           // math.rs:64
  const inv = invert(BRADFORD), s = apply(BRADFORD, src), d = apply(BRADFORD, dst);
  const scale = [[d[0] / s[0], 0, 0], [0, d[1] / s[1], 0], [0, 0, d[2] / s[2]]];
  return mul(inv, mul(scale, BRADFORD));
}
function rgbToXyzMatrix(r, g, b, white){                              // math.rs:76
  const xr = xyToXyz(r), xg = xyToXyz(g), xb = xyToXyz(b);
  const m = [[xr[0], xg[0], xb[0]], [xr[1], xg[1], xb[1]], [xr[2], xg[2], xb[2]]];
  const mi = invert(m); if (!mi) return null;
  const s = apply(mi, white);
  return m.map(row => [row[0] * s[0], row[1] * s[1], row[2] * s[2]]);
}
const roundHalfAway = t => t < 0 ? -Math.round(-t) : Math.round(t);   // Rust f64::round（半数远离零）
const s15 = v => roundHalfAway(v * 65536.0) / 65536.0;                // math.rs:166 s15f16_round
const d50q = () => [s15(D50[0]), s15(D50[1]), s15(D50[2])];

/* ═══════════ curve.rs（曲线：{t:'id'} | {t:'gamma', g} | {t:'para', kind, p:[g,a,b,c,d,e,f]}） ═══════════ */
const Cv = {
  id: () => ({t:'id'}),
  gamma: g => ({t:'gamma', g}),
  para: (kind, p) => ({t:'para', kind, p:p.concat([0, 0, 0, 0, 0, 0, 0]).slice(0, 7)}),
  srgb: () => Cv.para(3, [2.4, 1.0 / 1.055, 0.055 / 1.055, 1.0 / 12.92, 0.04045, 0, 0]),   // curve.rs:24 srgb_trc
  count: kind => kind === 0 ? 1 : kind === 1 ? 3 : kind === 2 ? 4 : kind === 3 ? 5 : 7,   // curve.rs:30 param_count
  isIdentity(c){                                                       // curve.rs:41
    if (c.t === 'id') return true;
    if (c.t === 'gamma') return Math.abs(c.g - 1.0) < 1e-9;
    if (c.t === 'para' && c.kind === 0) return Math.abs(c.p[0] - 1.0) < 1e-9;
    return false;
  },
  eval64(c, x){                                                        // curve.rs:55
    if (c.t === 'id') return x;
    if (c.t === 'gamma') return mirror(x, v => Math.pow(v, c.g));
    return para(c.kind, c.p, x);
  },
  eval(c, x){ return c.t === 'id' ? x : f32(Cv.eval64(c, x)); },     // curve.rs:65（f32）
  inv64(c, y){                                                         // curve.rs:74
    if (c.t === 'id') return y;
    if (c.t === 'gamma') return Math.abs(c.g) < 1e-12 ? y : mirror(y, v => Math.pow(v, 1.0 / c.g));
    const r = paraInverse(c.kind, c.p, y);
    return r === null ? numericInverse(x => para(c.kind, c.p, x), y) : r;
  },
  inv(c, y){ return c.t === 'id' ? y : f32(Cv.inv64(c, y)); },
  /* 存进文件再读回（write.rs:40 curve_elem → profile.rs:536 para）：参数量化成 s15Fixed16；para 0 读回来是 Gamma */
  quantize(c){
    if (c.t === 'gamma') return Cv.gamma(s15(c.g));
    if (c.t === 'para'){ const n = Cv.count(c.kind), p = c.p.map((v, i) => i < n ? s15(v) : 0); return c.kind === 0 ? Cv.gamma(p[0]) : Cv.para(c.kind, p); }
    return c;
  },
};
const mirror = (x, f) => x < 0 ? -f(-x) : f(x);                       // curve.rs:107
const pw = (base, g) => base <= 0 ? 0 : Math.pow(base, g);             // curve.rs:111
function para(kind, p, x){                                             // curve.rs:115
  const [g, a, b, c, d, e, f] = p;
  switch (kind){
    case 0: return mirror(x, v => Math.pow(v, g));
    case 1: return (a !== 0 && x >= -b / a) ? pw(a * x + b, g) : 0;
    case 2: return (a !== 0 && x >= -b / a) ? pw(a * x + b, g) + c : c;
    case 3:
      if (x < 0 && b === 0 && d === 0) return -para(kind, p, -x);
      return x >= d ? pw(a * x + b, g) : c * x;
    default: return x >= d ? pw(a * x + b, g) + e : c * x + f;
  }
}
function paraInverse(kind, p, y){                                      // curve.rs:154
  const [g, a, b, c, d, e, f] = p;
  if (Math.abs(g) < 1e-12) return null;
  const root = v => v <= 0 ? 0 : Math.pow(v, 1.0 / g);
  switch (kind){
    case 0: return mirror(y, v => Math.pow(v, 1.0 / g));
    case 1: if (a === 0) return null; return y <= 0 ? -b / a : (root(y) - b) / a;
    case 2: if (a === 0) return null; return y <= c ? -b / a : (root(y - c) - b) / a;
    case 3: {
      if (a === 0) return null;
      if (y < 0 && b === 0 && d === 0){ const r = paraInverse(kind, p, -y); return r === null ? null : -r; }
      const yd = pw(a * d + b, g);
      return y >= yd ? (root(y) - b) / a : (c !== 0 ? y / c : 0);
    }
    default: {
      if (a === 0) return null;
      const yd = pw(a * d + b, g) + e;
      return y >= yd ? (root(y - e) - b) / a : (c !== 0 ? (y - f) / c : 0);
    }
  }
}
function numericInverse(fn, y){                                        // curve.rs:209
  const f0 = fn(0), f1 = fn(1), inc = f1 >= f0;
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++){ const mid = 0.5 * (lo + hi), v = fn(mid); if ((v < y) === inc) lo = mid; else hi = mid; }
  return 0.5 * (lo + hi);
}

/* ═══════════ builtin.rs：内建配置文件 ═══════════
   colorants：原色→XYZ 矩阵，白点不是 D50 就 Bradford 适应到 D50；量化成 s15Fixed16，每列把误差补到绝对值最大那格（中性保持中性） */
function colorants(r, g, b, white){                                    // builtin.rs:131
  const m = rgbToXyzMatrix(r, g, b, white), d50 = d50q();
  const adapt = (Math.abs(white[0] - D50[0]) < 1e-3 && Math.abs(white[2] - D50[2]) < 1e-3) ? null : bradford(white, D50);
  let m50;
  if (adapt) m50 = mul(adapt, m);
  else { const s = apply(m, [1, 1, 1]); m50 = m.map((row, i) => row.map(v => v * (D50[i] / s[i]))); }
  const q = m50.map(row => row.map(s15));
  q.forEach((row, i) => {
    const err = d50[i] - (row[0] + row[1] + row[2]);
    let k = 0; for (let j = 1; j < 3; j++) if (Math.abs(row[j]) >= Math.abs(row[k])) k = j;   // max_by：一样大取后面那个
    row[k] = s15(row[k] + err);
  });
  return q;
}
/* 内建清单（builtin.rs:17-115 Builtin：id／描述／色彩空间）；bytes＝原码 ICC 编码后的长度（cmsprobe 量的），给 profileInfo */
const PRIM = {                                                          // builtin.rs:214
  srgb: [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]],
  p3: [[0.680, 0.320], [0.265, 0.690], [0.150, 0.060]],
  adobe: [[0.64, 0.33], [0.21, 0.71], [0.15, 0.06]],
  romm: [[0.7347, 0.2653], [0.1596, 0.8404], [0.0366, 0.0001]],
  bt2020: [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046]],
};
// 工作用 CMYK：载到 menus/impl/cmyk-swop.js ＝ PS 预设「U.S. Web Coated (SWOP) v2」的近似（拾色器、文件模式、校样共用）；没载才是原码合成铜版纸 synth.rs:32
const COATED_DESC = window.SwopCmyk ? 'U.S. Web Coated (SWOP) v2 (Dilin approximation)' : 'Dilin Coated CMYK (synthetic, 300% TAC, medium GCR)';
const BUILTINS = [
  {id:'srgb', description:'sRGB IEC61966-2.1', space:'rgb', bytes:652, build:() => rgbProfile(PRIM.srgb, xyToXyz(D65_XY), Cv.srgb())},
  {id:'display-p3', description:'Display P3', space:'rgb', bytes:636, build:() => rgbProfile(PRIM.p3, xyToXyz(D65_XY), Cv.srgb())},
  {id:'adobe-rgb-compat', description:'Adobe RGB (1998)-compatible (Dilin)', space:'rgb', bytes:680, build:() => rgbProfile(PRIM.adobe, xyToXyz(D65_XY), Cv.gamma(563.0 / 256.0))},
  {id:'prophoto-compat', description:'ProPhoto RGB-compatible (ROMM primaries, Dilin)', space:'rgb', bytes:648, build:() => rgbProfile(PRIM.romm, D50, Cv.gamma(1.8))},
  {id:'linear-srgb', description:'Linear sRGB (Dilin)', space:'rgb', bytes:648, build:() => rgbProfile(PRIM.srgb, xyToXyz(D65_XY), Cv.gamma(1.0))},
  {id:'rec2020', description:'Rec. ITU-R BT.2020 (Dilin)', space:'rgb', bytes:680, build:() => {
    const a = 1.099;                                                    // builtin.rs:229：Rec.709 OETF 反函数
    return rgbProfile(PRIM.bt2020, xyToXyz(D65_XY), Cv.para(3, [1.0 / 0.45, 1.0 / a, (a - 1.0) / a, 1.0 / 4.5, 0.081, 0, 0]));
  }},
  {id:'gray-gamma-2.2', description:'Gray Gamma 2.2 (Dilin)', space:'gray', bytes:480, build:() => grayProfile(Cv.gamma(2.2))},
  {id:'sgray', description:'sGray (sRGB tone curve, Dilin)', space:'gray', bytes:512, build:() => grayProfile(Cv.srgb())},
  {id:'lab-d50', description:'Lab D50 identity (Dilin)', space:'lab', bytes:616, cls:'ColorSpace', lut:true, intents:['perceptual'], build:() => ({})},
  {id:'coated-cmyk', description:COATED_DESC, space:'cmyk', bytes:236844, cls:'Output', lut:true, intents:['perceptual', 'relative', 'saturation', 'absolute'], build:() => ({})},
];
const BY_ID = {}; BUILTINS.forEach(b => BY_ID[b.id] = b);
function rgbProfile(prim, white, trc){ return {matrix:colorants(prim[0], prim[1], prim[2], white), trc:[trc, trc, trc]}; }
function grayProfile(trc){ return {grayTrc:trc}; }
const SPACE_NAME = {rgb:'Rgb', gray:'Gray', cmyk:'Cmyk', lab:'Lab'};
const _gen = {}, _parsed = {};
/* 内建配置文件本体（Builtin::profile，原码生成的那份） */
function builtin(id){
  if (_gen[id]) return _gen[id];
  const b = BY_ID[id];
  const p = Object.assign({key:id, id, description:b.description, space:b.space, cls:b.cls || 'Display', version:[4, 0x30], white:d50q(),
                           lut:!!b.lut, intents:b.intents || ['perceptual', 'relative', 'saturation', 'absolute'], bytes:b.bytes}, b.build());
  return (_gen[id] = p);
}
/* 文件标记的配置文件（document_profile → profile_from_bytes：ICC 位元组读回来，曲线参数是 s15Fixed16 量化过的；内容 hash 跟原本那份一样） */
function parsed(id){
  if (_parsed[id]) return _parsed[id];
  const g = builtin(id), p = Object.assign({}, g);
  if (g.trc) p.trc = g.trc.map(Cv.quantize);
  if (g.grayTrc) p.grayTrc = Cv.quantize(g.grayTrc);
  return (_parsed[id] = p);
}
/* builtin.rs:94 from_id：去掉非英数字、不分大小写；几个别名；或描述全名 */
function fromId(s){
  const n = String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const A = {srgb:'srgb', srgbiec6196621:'srgb', srgbiec61966:'srgb', p3:'display-p3', displayp3:'display-p3',
    adobergb:'adobe-rgb-compat', adobergb1998:'adobe-rgb-compat', adobergbcompat:'adobe-rgb-compat', clayrgb:'adobe-rgb-compat',
    prophoto:'prophoto-compat', prophotorgb:'prophoto-compat', prophotocompat:'prophoto-compat', romm:'prophoto-compat', rommrgb:'prophoto-compat',
    linearsrgb:'linear-srgb', srgblinear:'linear-srgb', linear:'linear-srgb', rec2020:'rec2020', bt2020:'rec2020',
    gray:'gray-gamma-2.2', graygamma22:'gray-gamma-2.2', gamma22:'gray-gamma-2.2', sgray:'sgray', graysrgb:'sgray',
    lab:'lab-d50', labd50:'lab-d50', cielab:'lab-d50', cmyk:'coated-cmyk', coatedcmyk:'coated-cmyk', defaultcmyk:'coated-cmyk', photocraftcoatedcmyk:'coated-cmyk', dilincoatedcmyk:'coated-cmyk', uswebcoatedswopv2:'coated-cmyk', swop:'coated-cmyk'};
  if (A[n]) return A[n];
  const b = BUILTINS.find(x => x.description.toLowerCase() === String(s).toLowerCase());
  return b ? b.id : null;
}
const DEFAULT_OF = {rgb:'srgb', gray:'sgray', cmyk:'coated-cmyk', lab:'lab-d50'};      // builtin.rs:122 default_for
/* profile.rs:231 gray_as_rgb：灰度曲线放到 R、G、B，每个对到白点的三分之一 ⇒ (v,v,v) 就是灰 v 的颜色（灰度文件的合成用它） */
function grayAsRgb(p){
  if (!p.grayTrc) return null;
  const w = D50, c = p.grayTrc;
  return {key:'gray-as-rgb:' + p.key, id:p.id, description:p.description + ' (as RGB)', space:'rgb', cls:p.cls, version:p.version, white:p.white,
          matrix:[[w[0] / 3, w[0] / 3, w[0] / 3], [w[1] / 3, w[1] / 3, w[1] / 3], [w[2] / 3, w[2] / 3, w[2] / 3]], trc:[c, c, c]};
}

/* ═══════════ pipeline.rs ＋ profile.rs 的 device_to_pcs／pcs_to_device ═══════════
   级：{t:'curves', cs} | {t:'inv', cs} | {t:'mat', rows, cols, m:[…], off:[…]} | {t:'clamp'}（我们的配置文件全是矩阵／TRC，PCS＝XYZ，用不到 Lab 那几级） */
const mat3 = m => ({t:'mat', rows:3, cols:3, m:[].concat(m[0], m[1], m[2]), off:[0, 0, 0]});
function unsupported(p){ return new Error(`colour management: unsupported ICC feature: ${SPACE_NAME[p.space] || p.space} profile without AToB tags`); }
function deviceToPcs(p){                                               // profile.rs:279
  if (p.space === 'rgb'){ if (!p.matrix || !p.trc) throw unsupported(p); return [{t:'curves', cs:p.trc.slice()}, mat3(p.matrix)]; }
  if (p.space === 'gray'){ return [{t:'curves', cs:[p.grayTrc]}, {t:'mat', rows:3, cols:1, m:D50.slice(), off:[0, 0, 0]}]; }
  throw unsupported(p);
}
function pcsToDevice(p){                                               // profile.rs:311
  if (p.space === 'rgb'){ const inv = invert(p.matrix); if (!inv) throw new Error('colour management: invalid ICC profile: singular colorant matrix'); return [mat3(inv), {t:'inv', cs:p.trc.slice()}]; }
  if (p.space === 'gray') return [{t:'mat', rows:1, cols:3, m:[0, 1, 0], off:[0]}, {t:'inv', cs:[p.grayTrc]}];
  throw unsupported(p);
}
const stageOut = (s, n) => s.t === 'mat' ? s.rows : n;
const chans = p => p.space === 'gray' ? 1 : p.space === 'cmyk' ? 4 : 3;
/* Stage::run（f32 的 v；矩阵用 f64 累加再转 f32） */
function runStage(s, v, n){
  if (s.t === 'curves'){ for (let i = 0; i < s.cs.length; i++) v[i] = Cv.eval(s.cs[i], v[i]); return n; }
  if (s.t === 'inv'){ for (let i = 0; i < s.cs.length; i++) v[i] = Cv.inv(s.cs[i], v[i]); return n; }
  if (s.t === 'mat'){
    const o = [];
    for (let r = 0; r < s.rows; r++){ let acc = s.off[r]; for (let c = 0; c < s.cols; c++) acc += s.m[r * s.cols + c] * v[c]; o[r] = f32(acc); }
    for (let r = 0; r < s.rows; r++) v[r] = o[r];
    return s.rows;
  }
  if (s.t === 'clamp'){ for (let i = 0; i < n; i++) v[i] = clamp(v[i], 0, 1); return n; }
  return n;
}
function pipeEval(pipe, input){                                        // pipeline.rs:177
  const v = new Array(16).fill(0);
  for (let i = 0; i < pipe.inputs; i++) v[i] = f32(input[i]);
  let n = pipe.inputs;
  for (const s of pipe.stages) n = runStage(s, v, n);
  return v.slice(0, pipe.outputs);
}
function optimize(stages){                                             // pipeline.rs:188
  const out = [];
  for (const s of stages){
    let noop = false;
    if (s.t === 'curves' || s.t === 'inv') noop = s.cs.every(Cv.isIdentity);
    else if (s.t === 'mat' && s.rows === 3 && s.cols === 3) noop = s.off.every(o => Math.abs(o) < 1e-12) && s.m.every((v, i) => Math.abs(v - (i % 4 === 0 ? 1 : 0)) < 1e-12);
    if (noop) continue;
    const last = out[out.length - 1];
    if (last && last.t === 'mat' && last.rows === 3 && last.cols === 3 && s.t === 'mat' && s.rows === 3 && s.cols === 3){   // 相邻 3×3 合并
      const a = last.m, oa = last.off, b = s.m, ob = s.off, m = new Array(9).fill(0), off = [0, 0, 0];
      for (let r = 0; r < 3; r++){
        for (let c = 0; c < 3; c++){ let acc = -0; for (let k = 0; k < 3; k++) acc += b[r * 3 + k] * a[k * 3 + c]; m[r * 3 + c] = acc; }
        let acc = -0; for (let k = 0; k < 3; k++) acc += b[r * 3 + k] * oa[k]; off[r] = acc + ob[r];
      }
      out.pop(); out.push({t:'mat', rows:3, cols:3, m, off});
      continue;
    }
    out.push(s);
  }
  return out;
}

/* ═══════════ transform.rs ═══════════ */
const INTENTS = ['perceptual', 'relative', 'saturation', 'absolute'];
/* lib.rs:63 Intent::parse：去非英数字、不分大小写 */
function intentParse(s){
  const n = String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  return ({perceptual:'perceptual', '0':'perceptual', relative:'relative', relativecolorimetric:'relative', colorimetric:'relative', '1':'relative',
           saturation:'saturation', '2':'saturation', absolute:'absolute', absolutecolorimetric:'absolute', '3':'absolute'})[n] || null;
}
/* transform.rs:592 black_point：矩阵／TRC 配置文件＝设备 0 进 PCS 的 Y（夹在 0..0.5） */
function blackPoint(p){
  if (p.space === 'lab') return 0;
  const st = deviceToPcs(p), pipe = {inputs:chans(p), outputs:3, stages:st};
  pipe.outputs = st.reduce((n, s) => stageOut(s, n), pipe.inputs);
  const o = pipeEval(pipe, new Array(chans(p)).fill(0));
  return clamp(o[1], 0, 0.5);
}
/* transform.rs:560 connection：绝对比色＝媒体白点缩放；否则开了黑场补偿且两边黑场不同＝XYZ 里线性对齐黑场、白点不动 */
function connection(src, dst, intent, bpc){
  if (intent === 'absolute'){
    const ws = src.white, wd = dst.white, s = [ws[0] / wd[0], ws[1] / wd[1], ws[2] / wd[2]];   // v4 配置文件 media_white＝wtpt（profile.rs:221）
    if (s.every(v => Math.abs(v - 1) < 1e-6)) return null;
    return {scale:s, offset:[0, 0, 0]};
  }
  if (!bpc) return null;
  const bs = blackPoint(src), bd = blackPoint(dst);
  if (Math.abs(bs - bd) < 1e-6) return null;
  const w = D50, scale = [1, 1, 1], offset = [0, 0, 0];
  for (let i = 0; i < 3; i++){ const s = bs * w[i], d = bd * w[i], a = (w[i] - d) / (w[i] - s); scale[i] = a; offset[i] = w[i] * (1 - a); }
  return {scale, offset};
}
const OUT_TABLE = 4096, TABLE_1D = 4096;
/* Transform::new → link_stages → from_pipeline（optimize；尾端反曲线拆成 x^¼ 输出表；头部是「曲线＋矩阵」就用 Shaper 核，否则走精确管线） */
function makeTransform(src, dst, intent, bpc){
  const stages = deviceToPcs(src);                                     // transform.rs:529 link_stages
  const dSt = pcsToDevice(dst);
  const adj = connection(src, dst, intent, bpc);
  if (adj) stages.push({t:'mat', rows:3, cols:3, m:[adj.scale[0], 0, 0, 0, adj.scale[1], 0, 0, 0, adj.scale[2]], off:adj.offset.slice()});
  stages.push(...dSt);
  const inputs = chans(src);
  const opt = optimize(stages);
  const pipe = {inputs, stages:opt, outputs:opt.reduce((n, s) => stageOut(s, n), inputs)};
  const t = {src, dst, intent, bpc, inputs, outputs:pipe.outputs, pipe, post:null, core:null};
  let head = opt.slice();
  const last = head[head.length - 1];
  if (last && last.t === 'inv' && last.cs.length === pipe.outputs){   // transform.rs:130：尾端反曲线 → 输出表
    t.post = last.cs.map(c => {
      const tb = new Float32Array(OUT_TABLE);
      for (let i = 0; i < OUT_TABLE; i++){ const u = i / (OUT_TABLE - 1); tb[i] = clamp(Cv.inv64(c, u * u * u * u), 0, 1); }
      return tb;
    });
    head.pop();
    if (head.length && head[head.length - 1].t === 'clamp') head.pop();
  }
  const shaper = (cs, m) => ({kind:'shaper',
    curves8:(cs || []).map(c => { const a = new Float32Array(256); for (let i = 0; i < 256; i++) a[i] = Cv.eval64(c, i / 255.0); return a; }),
    matrix:m ? {rows:m.rows, cols:m.cols, m:Float32Array.from(m.m), off:Float32Array.from(m.off)} : null});
  if (head.length === 0) t.core = shaper(null, null);
  else if (head.length === 1 && head[0].t === 'curves' && head[0].cs.length === inputs) t.core = shaper(head[0].cs, null);
  else if (head.length === 1 && head[0].t === 'mat') t.core = shaper(null, head[0]);
  else if (head.length === 2 && head[0].t === 'curves' && head[0].cs.length === inputs && head[1].t === 'mat') t.core = shaper(head[0].cs, head[1]);
  else t.core = {kind:'exact'};                                        // 纯解析的级（没有 CLUT）一律精确算（transform.rs:159）
  return t;
}
/* Post::eval：输出表以 x^¼ 为索引（f32） */
function postEval(tb, x){
  const u = f32(f32(Math.sqrt(f32(Math.sqrt(clamp(x, 0, 1))))) * (OUT_TABLE - 1));
  const i = Math.min(Math.trunc(u), OUT_TABLE - 2), f = f32(u - i);
  return f32(tb[i] + f32(f32(tb[i + 1] - tb[i]) * f));
}
const q8 = v => { const r = Math.trunc(f32(f32(clamp(v, 0, 1) * 255) + 0.5)); return r > 255 ? 255 : r < 0 ? 0 : r; };   // (v.clamp(0,1)*255+0.5) as u8
/* run_u8：一个 8 位像素（inputs 个通道）→ outputs 个 8 位值 */
function tU8(t, sp){
  const out = new Array(t.outputs);
  if (t.core.kind === 'shaper'){
    const c8 = t.core.curves8, M = t.core.matrix, v = [], mid = [];
    for (let k = 0; k < t.inputs; k++) v[k] = c8.length ? c8[k][sp[k]] : f32(sp[k] / 255);
    if (!M) for (let k = 0; k < t.inputs; k++) mid[k] = v[k];
    else for (let r = 0; r < M.rows; r++){ let s = M.off[r]; for (let c = 0; c < M.cols; c++) s = f32(s + f32(M.m[r * M.cols + c] * v[c])); mid[r] = s; }
    for (let k = 0; k < t.outputs; k++) out[k] = q8(t.post ? postEval(t.post[k], mid[k]) : mid[k]);
    return out;
  }
  const o = pipeEval(t.pipe, Array.from({length:t.inputs}, (_, k) => f32(sp[k] / 255)));   // Core::Exact：整条管线
  for (let k = 0; k < t.outputs; k++) out[k] = q8(o[k]);
  return out;
}
const tEval = (t, c) => pipeEval(t.pipe, c);                           // Transform::eval（精确）
/* 一整块 RGBA8（ImageData.data）原地转：gray 进＝取 R；gray 出＝写到 R=G=B；alpha 不动；同色连续时沿用上一个结果 */
function convertRgba(t, d){
  let pr = -1, pg = -1, pb = -1, o = null;
  for (let i = 0; i < d.length; i += 4){
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r !== pr || g !== pg || b !== pb){ o = tU8(t, t.inputs === 1 ? [r] : [r, g, b]); pr = r; pg = g; pb = b; }
    if (t.outputs === 1){ d[i] = d[i + 1] = d[i + 2] = o[0]; } else { d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; }
  }
}
/* display_color.rs:129 is_identity：格点（灰度文件只看中性轴）都在半个 8 位阶以内 */
function isIdentity(t, neutralOnly){
  const lim = f32(0.5 / 255);
  const chk = v => { const o = tEval(t, v); return [0, 1, 2].every(i => Math.abs(f32(o[i] - v[i])) <= lim); };
  if (neutralOnly){ for (let i = 0; i <= 32; i++){ const x = f32(i / 32); if (!chk([x, x, x])) return false; } return true; }
  const N = 9, s = N - 1;
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) if (!chk([f32(r / s), f32(g / s), f32(b / s)])) return false;
  return true;
}

/* ═══════════ 颜色设置（color_cmds.rs:101-194；存在浏览器 localStorage，同原码跟首选项存一起 prefs.rs:1228） ═══════════ */
const SET_KEY = 'dlcanvas.ps.colorSettings';
const TEXT_GAMMA = 1.45;                                               // compose/src/psblend.rs:138
const DEFAULTS = () => ({workingRgb:'srgb', workingCmyk:'coated-cmyk', workingGray:'sgray', policyRgb:'preserve', policyCmyk:'preserve', policyGray:'preserve',
  askOnMismatch:true, askOnPaste:true, askOnMissing:false, intent:'relative', bpc:true, dither:true, blendTextGamma:TEXT_GAMMA, monitorProfile:'auto'});
const FIELD_TYPE = {workingRgb:'string', workingCmyk:'string', workingGray:'string', policyRgb:'policy', policyCmyk:'policy', policyGray:'policy',
  askOnMismatch:'boolean', askOnPaste:'boolean', askOnMissing:'boolean', intent:'string', bpc:'boolean', dither:'boolean', blendTextGamma:'number', monitorProfile:'string'};
const POLICIES = ['preserve', 'convert', 'off'];
const policyParse = s => ({preserve:'preserve', preserveEmbedded:'preserve', convert:'convert', convertToWorking:'convert', off:'off'})[s] || null;   // color_cmds.rs:91
/* serde 反序列化（#[serde(default)]：少的栏位补预设、多的不理；型别不对＝错） */
function fromJson(o){
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('expected an object');
  const s = DEFAULTS();
  for (const k in FIELD_TYPE){
    if (!(k in o)) continue;
    const v = o[k], ty = FIELD_TYPE[k];
    if (ty === 'policy'){ if (!POLICIES.includes(v)) throw new Error(`unknown variant \`${v}\` for \`${k}\`, expected one of preserve, convert, off`); }
    else if (ty === 'number'){ if (!isNum(v)) throw new Error(`\`${k}\` must be a number`); }
    else if (typeof v !== ty) throw new Error(`\`${k}\` must be a ${ty}`);
    s[k] = v;
  }
  return s;
}
let settings = null;
function loadSettings(){
  if (settings) return settings;
  try { settings = fromJson(JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch(e){ settings = DEFAULTS(); }   // 读不懂＝预设（prefs.rs:1246 unwrap_or_default）
  return settings;
}
function saveSettings(s){ settings = s; try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch(e){} }
const sameSettings = (a, b) => Object.keys(FIELD_TYPE).every(k => a[k] === b[k]);

/* ═══════════ 文件的配置文件（Doc.iccProfile＝内建 id 或 null（没标记）；Doc.colorMode＝'gray' 或空（RGB）） ═══════════ */
const docSpace = () => Doc.colorMode === 'gray' ? 'gray' : 'rgb';      // mode_space
const MODE_NAME = {rgb:'Rgb', gray:'Grayscale'};
/* resolve_profile（color_cmds.rs:457）：内建 id／别名／描述、"working"（＝该模式的内建预设）、"document"；.icc 路径在浏览器读不到 */
function resolveProfile(spec, mode){
  if (spec === 'working' || spec === 'default') return builtin(DEFAULT_OF[mode || docSpace()]);
  if (spec === 'working-cmyk' || spec === 'workingCmyk') return builtin('coated-cmyk');
  if (spec === 'working-rgb' || spec === 'workingRgb') return builtin('srgb');
  if (spec === 'working-gray' || spec === 'workingGray') return builtin('sgray');
  if (spec === 'document') return documentProfile();
  const id = fromId(spec); if (id) return builtin(id);
  const lower = String(spec).toLowerCase();
  if (lower.endsWith('.icc') || lower.endsWith('.icm') || spec.includes('/') || spec.includes('\\'))
    throw new Error(`cannot read profile \`${spec}\`: the browser canvas has no file system access (use a built-in id: ${BUILTINS.map(b => b.id).join(', ')})`);
  throw new Error(`unknown profile \`${spec}\` (built-ins: ${BUILTINS.map(b => b.id).join(', ')}, or a path to an .icc file)`);
}
/* ColorState::working（:214）：颜色设置的工作空间，解析不了或色彩空间不对就用内建预设 */
function working(space){
  const s = loadSettings(), spec = space === 'rgb' ? s.workingRgb : space === 'cmyk' ? s.workingCmyk : space === 'gray' ? s.workingGray : null;
  if (spec){ try { const p = resolveProfile(spec, space); if (p.space === space) return p; } catch(e){} }
  return builtin(DEFAULT_OF[space]);
}
/* ColorState::resolve（:224）："working…" 读颜色设置 */
function resolve(spec, mode){
  if (spec === 'working' || spec === 'default') return working(mode || docSpace());
  if (spec === 'working-cmyk' || spec === 'workingCmyk') return working('cmyk');
  if (spec === 'working-rgb' || spec === 'workingRgb') return working('rgb');
  if (spec === 'working-gray' || spec === 'workingGray') return working('gray');
  return resolveProfile(spec, mode);
}
/* document_profile（:434）：标记的配置文件（色彩空间对得上模式时）；否则该模式的内建预设 */
function documentProfile(){
  const id = Doc.iccProfile;
  if (id && BY_ID[id]){ const p = parsed(id); if (p.space === docSpace()) return p; }
  return builtin(DEFAULT_OF[docSpace()]);
}
/* composite_profile（:443）：RGB＝文件配置文件；灰度＝它的曲线当 RGB 看 */
function compositeProfile(){
  if (docSpace() === 'rgb') return documentProfile();
  return grayAsRgb(documentProfile()) || grayAsRgb(builtin('sgray')) || builtin('srgb');
}
/* display_color.rs:164 monitor：auto＝平台给的显示器配置文件（浏览器拿不到，画布本来就按 sRGB 送出去）⇒ sRGB */
function monitor(){
  const m = loadSettings().monitorProfile;
  if (!m || m === 'auto') return builtin('srgb');
  try { const p = resolveProfile(m, 'rgb'); if (p.space === 'rgb') return p; } catch(e){}
  return builtin('srgb');
}

/* ═══════════ 画面显示转换（display_color.rs canvas_display：文件配置文件 → 显示器，相对比色＋黑场补偿） ═══════════ */
const DISPLAY_INTENT = 'relative', DISPLAY_BPC = true;                 // display_color.rs:33-34
const _disp = new Map();
const isLinearRgb = p => p.space === 'rgb' && !!p.matrix && !!p.trc && p.trc.every(Cv.isIdentity);   // :114
function canvasDisplay(){
  const space = docSpace(), mon = monitor();
  const key = `${space}|${Doc.iccProfile || ''}|${mon.key}`;
  if (_disp.has(key)) return _disp.get(key);
  const comp = compositeProfile();
  const encode = isLinearRgb(comp);                                    // 线性合成：画布存 sRGB 编码值，来源改成同原色＋sRGB 曲线（:119 srgb_curve_twin）
  const source = encode ? Object.assign({}, comp, {key:'twin:' + comp.key, trc:[Cv.srgb(), Cv.srgb(), Cv.srgb()]}) : comp;
  let t = null;
  if (source.key !== mon.key){ t = makeTransform(source, mon, DISPLAY_INTENT, DISPLAY_BPC); if (isIdentity(t, space === 'gray')) t = null; }
  const d = {encode, source, monitor:mon, transform:t, identity:!encode && !t};
  if (_disp.size > 32) _disp.clear();
  _disp.set(key, d);
  return d;
}
let _enc = null;
/* :87 encode_table：线性 → sRGB 编码 8 位（color/src/convert.rs:156 linear_to_srgb，f32） */
function encodeTable(){
  if (_enc) return _enc;
  _enc = new Uint8Array(65536);
  const pw24 = f32(1 / 2.4);
  for (let i = 0; i < 65536; i++){
    const v = f32(i / 65535);
    const e = v <= f32(0.0031308) ? f32(v * f32(12.92)) : f32(f32(f32(1.055) * f32(Math.pow(v, pw24))) - f32(0.055));
    _enc[i] = Math.min(255, Math.trunc(f32(f32(e * 255) + 0.5)));
  }
  return _enc;
}
/* CanvasDisplay::to_rgba8：合成好的 8 位 RGBA → 显示器值（原地） */
function displayPixels(d, data){
  if (d.encode){
    const tb = encodeTable(), code = v => tb[Math.trunc(f32(f32(f32(v / 255) * 65535) + 0.5))];
    for (let i = 0; i < data.length; i += 4){ if (!data[i + 3]) continue; data[i] = code(data[i]); data[i + 1] = code(data[i + 1]); data[i + 2] = code(data[i + 2]); }
  }
  if (d.transform){
    const t = d.transform; let pr = -1, pg = -1, pb = -1, o = null;
    for (let i = 0; i < data.length; i += 4){
      if (!data[i + 3]) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r !== pr || g !== pg || b !== pb){ o = tU8(t, [r, g, b]); pr = r; pg = g; pb = b; }
      data[i] = o[0]; data[i + 1] = o[1]; data[i + 2] = o[2];
    }
  }
}
function applyDisplay(target){
  if (!target || !target.width || !target.height) return;
  const d = canvasDisplay(); if (d.identity) return;
  const ctx = target.getContext('2d'), img = ctx.getImageData(0, 0, target.width, target.height);
  displayPixels(d, img.data);
  ctx.putImageData(img, 0, 0);
}
/* 挂到 UI.viewComposite（ui.js:246 画 #view 那一次的合成挂点）：🔴 串接、不覆盖——ai-view.js 也挂在这里（它在 DOMContentLoaded 才挂，
   可能比我们晚）⇒ 把这个栏位做成存取器：谁设定都存成「内层」，画的时候先叫内层（或 composite）合成，再套显示转换 */
function hookView(){
  if (!window.UI || UI.__pse3ColorHook) return;
  UI.__pse3ColorHook = true;
  // 后来挂的有两种：ai-view 那种不串前一支（直接画）、ps-view 那种先读 UI.viewComposite（＝outer）再串它。
  // 两种都对：设定一次就叠一层（stack），outer 被重入一次就往下叫一层；最外面那一次画完才套显示转换（以前只存一支 inner，ps-view 串回 outer 会无穷递回）
  const stack = UI.viewComposite ? [UI.viewComposite] : [];
  let depth = 0;
  const outer = function(s, target){
    const k = stack.length - 1 - depth;
    depth++;
    let r;
    try { r = k >= 0 ? stack[k].call(UI, s, target) : composite(s, target); } finally { depth--; }
    if (depth === 0){ try { if (target === UI.canvas) applyDisplay(target); } catch(e){ console.error(e); } }
    return r;
  };
  Object.defineProperty(UI, 'viewComposite', {configurable:true, enumerable:true, get:() => outer, set:v => { if (v && v !== outer && !stack.includes(v)) stack.push(v); }});
}
if (typeof window !== 'undefined'){
  if (window.UI) hookView(); else window.addEventListener('DOMContentLoaded', hookView);
}

/* ═══════════ 历史／新文件／工程档：Doc.iccProfile、Doc.colorMode 跟着走（engine.js 的 History.snap 不认这两栏 ⇒ 这里包一层，同 ps-layer.js _psLayerShim 的写法） ═══════════ */
if (!History._pse3ColorShim){
  const snap0 = History.snap, restore0 = History.restore, rip0 = History.restoreInPlace;
  const put = s => { if (!s || !('pse3Color' in s)) return; Doc.iccProfile = s.pse3Color.icc || null; Doc.colorMode = s.pse3Color.mode || undefined; };
  History.snap = function(){ const s = snap0.apply(this, arguments); s.pse3Color = {icc:Doc.iccProfile || null, mode:Doc.colorMode || null}; return s; };
  History.restore = function(s){ const r = restore0.apply(this, arguments); put(s); return r; };
  History.restoreInPlace = function(s){ const r = rip0.apply(this, arguments); put(s); return r; };
  History._pse3ColorShim = true;
  const reset0 = Doc.reset;
  Doc.reset = function(){ Doc.iccProfile = null; Doc.colorMode = undefined; return reset0.apply(this, arguments); };   // 新文件：没标记、RGB
  const ser0 = Project.serialize, load0 = Project.load;
  Project.serialize = function(){ const j = ser0.apply(this, arguments); j.iccProfile = Doc.iccProfile || null; j.colorMode = Doc.colorMode || null; return j; };   // 工程档带着配置文件（原码存进 PSD 1039）
  Project.load = function(json){ Doc.iccProfile = (json && BY_ID[json.iccProfile]) ? json.iccProfile : null; Doc.colorMode = (json && json.colorMode === 'gray') ? 'gray' : undefined; return load0.apply(this, arguments); };
}

/* ═══════════ 指定配置文件（color_cmds.rs:708 assign_profile）：只换标记，像素不动 ═══════════ */
function assignProfile(p){
  const spec = p && p.profile;
  if (typeof spec !== 'string') return fail('edit.assignProfile: missing `profile`');
  let id = null, desc = 'none';
  if (spec !== 'none'){
    let prof; try { prof = resolve(spec, null); } catch(e){ return fail(e.message); }
    if (prof.space !== docSpace()) return fail(`profile \`${prof.description}\` is ${SPACE_NAME[prof.space]}; the document is ${MODE_NAME[docSpace()]}`);
    id = prof.id; desc = prof.description;
  }
  Doc.iccProfile = id;
  return {ok:true, profile:desc};
}

/* ═══════════ 转换为配置文件（color_cmds.rs:732 convert_to_profile → :624 convert_document） ═══════════
   每个像素层从文件配置文件转到目标（意图、黑场补偿）；蒙版、选区不动；形状／文字／图层样式的颜色也转（convert_layer_colors）；文件标记成目标 */
const HEX = /^#[0-9a-f]{6}$/i;
/* convert_color（:543）：颜色在旧模式才转；精确管线、结果夹 0..1。我们的颜色都是 #rrggbb（RGB）⇒ 从灰度文件转出去时不动（原码同：颜色模式不是 from） */
function convertHex(h, t, fromSpace, toSpace){
  if (fromSpace !== 'rgb') return h;
  const c = [1, 3, 5].map(i => f32(parseInt(h.slice(i, i + 2), 16) / 255));
  const o = tEval(t, c).map(v => clamp(v, 0, 1));
  const rgb = toSpace === 'gray' ? [o[0], o[0], o[0]] : o;
  return '#' + rgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
/* 形状（填色／描边／渐变色标／网格点）、文字、图层样式里所有 #rrggbb 都是颜色 */
function convertColorsIn(obj, fn){
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)){
    const v = obj[k];
    if (typeof v === 'string' && HEX.test(v)) obj[k] = fn(v);
    else if (v && typeof v === 'object') convertColorsIn(v, fn);
  }
}
function convertToProfile(p){
  const spec = p && p.profile;
  if (typeof spec !== 'string') return fail('edit.convertToProfile: missing `profile`');
  let dst; try { dst = resolve(spec, null); } catch(e){ return fail(e.message); }
  const s = loadSettings();
  let intent = s.intent && intentParse(s.intent) || 'relative';                // intent_or(p, settings.intent())
  if (p.intent !== undefined){ intent = intentParse(p.intent); if (!intent) return fail(`unknown intent \`${p.intent}\` (perceptual|relative|saturation|absolute)`); }
  const bpc = typeof p.bpc === 'boolean' ? p.bpc : s.bpc;              // bool_param(p, "bpc", settings.bpc)
  if (dst.space === 'lab' || dst.space === 'cmyk')
    return fail(`cannot convert to ${dst.description}: this canvas has no ${SPACE_NAME[dst.space] === 'Lab' ? 'Lab' : 'CMYK'} document mode (RGB and Grayscale only)`);
  const src = documentProfile(), fromSpace = docSpace(), toSpace = dst.space;
  let t; try { t = makeTransform(src, dst, intent, bpc); } catch(e){ return fail(e.message); }
  for (const L of Doc.layers){                                         // for_each_surface（masks=false）
    if (L.kind === 'raster' && L.data && L.data.canvas && L.data.canvas.width && L.data.canvas.height){
      const c = L.data.canvas, ctx = L.data.ctx, img = ctx.getImageData(0, 0, c.width, c.height);
      convertRgba(t, img.data);
      ctx.putImageData(img, 0, 0);
    }
    const fn = h => convertHex(h, t, fromSpace, toSpace);
    if (L.kind === 'vector' || L.kind === 'text') convertColorsIn(L.data, fn);
    if (L.style) convertColorsIn(L.style, fn);
    Layer.invalidate(L);
  }
  Doc.colorMode = toSpace === 'gray' ? 'gray' : undefined;
  Doc.iccProfile = dst.id;
  return {ok:true, profile:dst.description, mode:MODE_NAME[toSpace], intent, bpc};
}

/* ═══════════ profile_info（:746）＋ profile_json（:496） ═══════════ */
function profileJson(p){
  return {id:p.id, description:p.description, colorSpace:SPACE_NAME[p.space], class:p.cls || 'Display', version:'4.3', bytes:BY_ID[p.id] ? BY_ID[p.id].bytes : null,
          lut:!!p.lut, intents:(p.intents || INTENTS).slice()};
}
function profileInfo(p){
  const builtins = BUILTINS.map(b => ({id:b.id, description:b.description, colorSpace:SPACE_NAME[b.space]}));
  let info;
  if (p && typeof p.profile === 'string'){ let prof; try { prof = resolveProfile(p.profile, null); } catch(e){ return fail(e.message); } info = profileJson(prof); }
  else { info = profileJson(documentProfile()); info.embedded = !!(Doc.iccProfile && BY_ID[Doc.iccProfile]); info.mode = MODE_NAME[docSpace()]; }
  return {profile:info, builtins};
}

/* ═══════════ 颜色设置（:811 color_settings） ═══════════ */
function validate(c){                                                  // :176 validate_settings
  for (const [space, spec] of [['rgb', c.workingRgb], ['cmyk', c.workingCmyk], ['gray', c.workingGray]]){
    const p = resolveProfile(spec, space);
    if (p.space !== space) return `working space \`${spec}\` is ${SPACE_NAME[p.space]}, not ${SPACE_NAME[space]}`;
  }
  const m = c.monitorProfile;
  if (!(m === '' || m === 'auto')){ const p = resolveProfile(m, 'rgb'); if (p.space !== 'rgb') return `monitor profile \`${m}\` is ${SPACE_NAME[p.space]}, not RGB`; }
  if (!intentParse(c.intent)) return `unknown intent \`${c.intent}\` (perceptual|relative|saturation|absolute)`;
  return null;
}
function validateSafe(c){ try { return validate(c); } catch(e){ return e.message; } }
function settingsReport(){
  const c = loadSettings();
  return {settings:Object.assign({}, c), working:{rgb:working('rgb').description, cmyk:working('cmyk').description, gray:working('gray').description},
          monitor:monitor().description, monitorDetected:false};
}
function colorSettings(p){
  const cmd = 'edit.colorSettings';
  let next = Object.assign({}, loadSettings());
  if (p.reset === true) next = DEFAULTS();
  const str = k => typeof p[k] === 'string' ? p[k] : undefined;
  for (const k of ['workingRgb', 'workingCmyk', 'workingGray', 'monitorProfile']) if (str(k) !== undefined) next[k] = str(k);
  for (const k of ['policyRgb', 'policyCmyk', 'policyGray']){
    if (typeof p[k] === 'string'){ const v = policyParse(p[k]); if (!v) return fail(`${cmd}: \`${k}\` must be preserve|convert|off`); next[k] = v; }
  }
  for (const k of ['askOnMismatch', 'askOnPaste', 'askOnMissing', 'bpc', 'dither']) if (typeof p[k] === 'boolean') next[k] = p[k];
  if (str('intent') !== undefined) next.intent = intentParse(p.intent) || p.intent;
  if (p.blendTextGamma !== undefined){
    const v = p.blendTextGamma;
    if (v === false) next.blendTextGamma = 1.0;
    else if (v === true) next.blendTextGamma = TEXT_GAMMA;
    else if (isNum(v) && v >= 1.0 && v <= 2.2) next.blendTextGamma = f32(v);
    else return fail(`${cmd}: \`blendTextGamma\` must be 1.0..2.2 or a bool`);
  }
  const e = validateSafe(next); if (e) return fail(`${cmd}: ${e}`);
  if (!sameSettings(next, loadSettings())){ saveSettings(next); _disp.clear(); if (window.UI) UI.draw(); }
  return settingsReport();
}

/* ═══════════ 命令 ═══════════ */
const PROFILE_IDS_ASSIGN = ['working', 'srgb', 'display-p3', 'adobe-rgb-compat', 'prophoto-compat', 'linear-srgb', 'rec2020', 'gray-gamma-2.2', 'sgray', 'lab-d50', 'coated-cmyk', 'none'];   // specs 939
const PROFILE_IDS_CONVERT = ['srgb', 'display-p3', 'adobe-rgb-compat', 'prophoto-compat', 'linear-srgb', 'rec2020', 'gray-gamma-2.2', 'sgray', 'lab-d50', 'coated-cmyk', 'working'];   // specs 948
const hasParams = p => p && Object.keys(p).some(k => k !== 'dialog');
CMD.reg('ps.edit.colorSettings', {i18n:'', undoable:false,
  params:'{} 或 {dialog:true} ＝开「颜色设置」对话框；{get:true} ＝只读；改设定：{workingRgb:"srgb|display-p3|adobe-rgb-compat|prophoto-compat|linear-srgb|rec2020", workingCmyk:"coated-cmyk", workingGray:"sgray|gray-gamma-2.2", '
       + 'policyRgb|policyCmyk|policyGray:"preserve|convert|off", askOnMismatch:bool=true, askOnPaste:bool=true, askOnMissing:bool=false, intent:"relative|perceptual|saturation|absolute", '
       + 'blendTextGamma:1.0..2.2|bool=1.45, bpc:bool=true, dither:bool=true, monitorProfile:"auto|srgb|display-p3|adobe-rgb-compat|prophoto-compat|rec2020", reset:bool=false} '
       + '先验过再存（存进浏览器 localStorage「dlcanvas.ps.colorSettings」，不进历史）→ {settings, working:{rgb,cmyk,gray 描述}, monitor, monitorDetected}（color_cmds.rs color_settings）'},
  p => p.get === true ? settingsReport() : hasParams(p) ? colorSettings(p) : openSettingsDialog());
CMD.reg('ps.edit.assignProfile', {i18n:'', undoable:true,
  params:'{profile:"working|srgb|display-p3|adobe-rgb-compat|prophoto-compat|linear-srgb|rec2020|gray-gamma-2.2|sgray|none"} 指定配置文件：只换文件的配置文件标记、像素数值不变；画面按新配置文件解读再转到显示器（sRGB）⇒ 看起来颜色会变。色彩空间要跟文件模式一样（RGB 文件只能指定 RGB 的）→ {ok, profile:描述}（color_cmds.rs assign_profile）'},
  assignProfile);
CMD.reg('ps.edit.assignProfile.dialog', {i18n:'', params:'{} 开「指定配置文件」对话框（确定＝跑 ps.edit.assignProfile，一步历史）'}, () => openAssignDialog());
CMD.reg('ps.edit.convertToProfile', {i18n:'', undoable:true,
  params:'{profile:"srgb|display-p3|adobe-rgb-compat|prophoto-compat|linear-srgb|rec2020|gray-gamma-2.2|sgray|working", intent:"perceptual|relative|saturation|absolute"=颜色设置的意图（预设 relative）, bpc:bool=颜色设置（预设 true）} '
       + '转换为配置文件：每个像素层的像素从目前配置文件转到目标（矩阵／TRC，8 位 f32 同原码），形状／文字／图层样式的颜色也转，蒙版不动；转完文件标记成目标。转到灰度＝文件变灰度（像素存 R=G=B）。lab-d50／coated-cmyk 我们没有那种文件模式会报错 → {ok, profile, mode, intent, bpc}（color_cmds.rs convert_to_profile）'},
  convertToProfile);
CMD.reg('ps.edit.convertToProfile.dialog', {i18n:'', params:'{} 开「转换为配置文件」对话框（确定＝跑 ps.edit.convertToProfile，一步历史）'}, () => openConvertDialog());
CMD.reg('ps.edit.profileInfo', {i18n:'', undoable:false, params:'{profile?:"<内建 id>|document"=document} 查配置文件：{profile:{id,description,colorSpace,class,version,bytes,lut,intents, embedded?, mode?}, builtins:[{id,description,colorSpace}]}（color_cmds.rs profile_info）'},
  p => profileInfo(p || {}));

/* doc.inspect 顺便带上配置文件（给 agent 一眼看到） */
(function(){
  const c = CMD.map['doc.inspect']; if (!c || c._pse3Color) return;
  const o = c.run; c.run = p => { const r = o(p); if (r && typeof r === 'object'){ const d = documentProfile(); r.colorProfile = {id:Doc.iccProfile || null, description:d.description, mode:MODE_NAME[docSpace()], embedded:!!Doc.iccProfile}; } return r; };
  c._pse3Color = true;
})();
/* prefs.rs:1260-1290：prefs.get／set 的 `colorSettings.*` 走颜色设置。
   「首选项」段（_pse3-prefs.js）会重新登记 ps.prefs.get／set，而且接档顺序不定 ⇒ 现在包一次，之后谁再 CMD.reg 这两条也立刻包上 */
function wrapPrefs(){
  const g = CMD.map['ps.prefs.get'], s = CMD.map['ps.prefs.set'];
  if (g && !g._pse3Color){
    const o = g.run;
    g.run = p => {
      const path = p && typeof p.path === 'string' ? p.path : '';
      if (path === 'colorSettings' || path.startsWith('colorSettings.')){
        const rest = path.slice('colorSettings'.length).replace(/^\./, ''), cur = Object.assign({}, loadSettings());
        if (!rest) return cur;
        return (rest in cur) ? cur[rest] : fail(`unknown preference \`${path}\``);
      }
      const r = o(p);
      if (!path && r && typeof r === 'object' && r.ok !== false) r.colorSettings = Object.assign({}, loadSettings());
      return r;
    };
    g._pse3Color = true;
  }
  if (s && !s._pse3Color){
    const o = s.run;
    s.run = p => {
      const ch = [];
      if (p && typeof p.path === 'string') ch.push([p.path, p.value]);
      if (p && p.values && typeof p.values === 'object') for (const k in p.values) ch.push([k, p.values[k]]);
      const mine = ch.filter(([k]) => k === 'colorSettings' || k.startsWith('colorSettings.'));
      if (!mine.length) return o(p);
      // set_pref（:1265）：整份转成 JSON、改那条路径、再反序列化、验过才存
      let cur = Object.assign({}, loadSettings());
      for (const [k, v] of mine){
        if (p.path === k && !('value' in p)) return fail('prefs.set: missing `value`');
        const sub = k.slice('colorSettings'.length).replace(/^\./, '');
        if (!sub){ if (!v || typeof v !== 'object') return fail(`prefs.set: invalid value for \`${k}\`: expected an object`); cur = v; }
        else { if (sub.includes('.') || !(sub in FIELD_TYPE)) return fail(`prefs.set: unknown preference \`${k}\``); cur = Object.assign({}, cur, {[sub]:v}); }
        try { cur = fromJson(cur); } catch(e){ return fail(`prefs.set: invalid value for \`${k}\`: ${e.message}`); }
      }
      const e = validateSafe(cur); if (e) return fail('prefs.set: ' + e);
      const others = ch.filter(x => !mine.includes(x));                 // 其他首选项交给原本那条（先验 colorSettings，再写别的）
      if (others.length){ const q = {values:{}}; others.forEach(([k, v]) => q.values[k] = v); const r = o(q); if (r && r.ok === false) return r; }
      saveSettings(cur); _disp.clear(); if (window.UI) UI.draw();
      const out = {}; ch.forEach(([k]) => { out[k] = CMD.map['ps.prefs.get'].run({path:k}); });
      return out;
    };
    s._pse3Color = true;
  }
}
wrapPrefs();
if (!CMD._pse3ColorReg){
  const reg0 = CMD.reg;
  CMD.reg = function(id){ const r = reg0.apply(this, arguments); if (id === 'ps.prefs.get' || id === 'ps.prefs.set') wrapPrefs(); return r; };
  CMD._pse3ColorReg = true;
}

/* ═══════════ 对话框（filter_dialog.rs：照参数说明生成栏位，选项缺省取第一个；颜色设置先填目前值 prefs_ui.rs:414） ═══════════ */
const profileLabel = id => id === 'none' ? T('pse3.color.none') : id === 'working' ? T('pse3.color.working.' + docSpace()) + ' - ' + working(docSpace()).description : BY_ID[id].description;
const intentOptions = list => list.map(i => [i, T('pse3.color.intent.' + i)]);
const runCmd = (id, p) => { const r = CMD.run(id, p); if (window.UI) UI.draw(); return r; };
function openAssignDialog(){
  return PE.dialog.open({cmd:'ps.edit.assignProfile', title:T('pse3.color.assign.title'),
    rows:[{label:T('pse3.color.docProfile'), k:'__cur', type:'text', value:documentProfile().description},
          {k:'profile', label:T('pse3.color.assign.profile'), type:'select', value:'working', options:PROFILE_IDS_ASSIGN.map(id => [id, profileLabel(id)])}],
    after:f => { f.__cur.readOnly = true; f.__cur.style.width = '300px'; },
    ok:v => runCmd('ps.edit.assignProfile', {profile:v.profile})});
}
function openConvertDialog(){
  return PE.dialog.open({cmd:'ps.edit.convertToProfile', title:T('pse3.color.convert.title'),
    rows:[{section:T('pse3.color.sec.source')},
          {label:T('pse3.color.docProfile'), k:'__cur', type:'text', value:documentProfile().description},
          {section:T('pse3.color.sec.dest')},
          {k:'profile', label:T('pse3.color.convert.profile'), type:'select', value:'srgb', options:PROFILE_IDS_CONVERT.map(id => [id, profileLabel(id)])},
          {section:T('pse3.color.sec.conv')},
          {k:'intent', label:T('pse3.color.intent'), type:'select', value:'perceptual', options:intentOptions(INTENTS)},
          {k:'bpc', label:'', type:'check', value:true, text:T('pse3.color.bpc')}],
    after:f => { f.__cur.readOnly = true; f.__cur.style.width = '300px'; },
    ok:v => runCmd('ps.edit.convertToProfile', {profile:v.profile, intent:v.intent, bpc:v.bpc})});
}
const SETTING_ROWS = () => {
  const ids = l => l.map(id => [id, BY_ID[id].description]);
  const pol = sp => POLICIES.map(v => [v, T('pse3.color.policy.' + v + (v === 'convert' ? '.' + sp : ''))]);
  return [
    {section:T('pse3.color.sec.working')},
    {k:'workingRgb', label:T('pse3.color.rgb'), type:'select', options:ids(['srgb', 'display-p3', 'adobe-rgb-compat', 'prophoto-compat', 'linear-srgb', 'rec2020'])},
    {k:'workingCmyk', label:T('pse3.color.cmyk'), type:'select', options:ids(['coated-cmyk'])},
    {k:'workingGray', label:T('pse3.color.gray'), type:'select', options:ids(['sgray', 'gray-gamma-2.2'])},
    {section:T('pse3.color.sec.policy')},
    {k:'policyRgb', label:T('pse3.color.rgb'), type:'select', options:pol('rgb')},
    {k:'policyCmyk', label:T('pse3.color.cmyk'), type:'select', options:pol('cmyk')},
    {k:'policyGray', label:T('pse3.color.gray'), type:'select', options:pol('gray')},
    {k:'askOnMismatch', label:T('pse3.color.mismatch'), type:'check', text:T('pse3.color.askOpen')},
    {k:'askOnPaste', label:'', type:'check', text:T('pse3.color.askPaste')},
    {k:'askOnMissing', label:T('pse3.color.missing'), type:'check', text:T('pse3.color.askOpen')},
    {section:T('pse3.color.sec.conv')},
    {k:'intent', label:T('pse3.color.intent'), type:'select', options:intentOptions(['relative', 'perceptual', 'saturation', 'absolute'])},
    {k:'bpc', label:'', type:'check', text:T('pse3.color.bpc')},
    {k:'dither', label:'', type:'check', text:T('pse3.color.dither')},
    {section:T('pse3.color.sec.adv')},
    {k:'blendTextGamma', label:T('pse3.color.textGamma'), type:'number', min:1, max:2.2, step:0.01},
    {k:'monitorProfile', label:T('pse3.color.monitor'), type:'select', options:[['auto', T('pse3.color.monitor.auto')]].concat(ids(['srgb', 'display-p3', 'adobe-rgb-compat', 'prophoto-compat', 'rec2020']))},
  ];
};
function fillSettings(f){
  const c = loadSettings();
  for (const k in f){ if (!(k in c)) continue; const e = f[k]; if (e.type === 'checkbox') e.checked = !!c[k]; else e.value = k === 'blendTextGamma' ? String(+(+c[k]).toFixed(2)) : c[k]; }
}
function openSettingsDialog(){
  const c = loadSettings();
  const rows = SETTING_ROWS().map(r => r.k ? Object.assign({value:c[r.k]}, r) : r);
  return PE.dialog.open({cmd:'ps.edit.colorSettings', title:T('pse3.color.settings.title'), rows,
    build:(body, addRow, f, rws) => {
      // 引擎（PS 的「转换选项 ▸ 引擎」）：原码 ColorSettings 没有这栏，只有内建的 photocraft-cms 一种 ⇒ 只显示、不存
      const r = document.createElement('div'); r.className = 'pse-row';
      const lb = document.createElement('span'); lb.className = 'lb'; lb.textContent = T('pse3.color.engine'); r.appendChild(lb);
      const v = document.createElement('span'); v.textContent = 'Dilin CMS'; v.style.color = '#9aa3b0'; r.appendChild(v);
      if (rws.intent) rws.intent.parentNode.insertBefore(r, rws.intent);
    },
    after:f => { f.blendTextGamma.value = String(+(+c.blendTextGamma).toFixed(2)); },
    extra:[{key:'pse3.color.defaults', act:'reset', fn:() => { const r = CMD.run('ps.edit.colorSettings', {reset:true}); if (PE.dialog.cur) fillSettings(PE.dialog.cur.f); return r && r.ok === false ? r : {message:T('pse3.color.resetDone')}; }}],
    ok:v => {
      const q = {};
      for (const k in v){ if (k.startsWith('__')) continue; q[k] = v[k]; }
      if (!isNum(q.blendTextGamma)) return fail('edit.colorSettings: `blendTextGamma` must be 1.0..2.2 or a bool');
      return CMD.run('ps.edit.colorSettings', q);
    }});
}

/* ═══════════ 三语 ═══════════ */
Lang.add({
  'zh-Hant':{
    'pse3.color.settings.title':'顏色設定', 'pse3.color.assign.title':'指定描述檔', 'pse3.color.convert.title':'轉換為描述檔',
    'pse3.color.sec.working':'工作色域', 'pse3.color.sec.policy':'色彩管理策略', 'pse3.color.sec.conv':'轉換選項', 'pse3.color.sec.adv':'進階控制',
    'pse3.color.sec.source':'來源色域', 'pse3.color.sec.dest':'目的地色域',
    'pse3.color.rgb':'RGB：', 'pse3.color.cmyk':'CMYK：', 'pse3.color.gray':'灰階：',
    'pse3.color.policy.preserve':'保留內嵌描述檔', 'pse3.color.policy.convert.rgb':'轉換為使用中的 RGB', 'pse3.color.policy.convert.cmyk':'轉換為使用中的 CMYK',
    'pse3.color.policy.convert.gray':'轉換為使用中的灰階', 'pse3.color.policy.off':'關閉',
    'pse3.color.mismatch':'描述檔不符：', 'pse3.color.missing':'遺失描述檔：', 'pse3.color.askOpen':'開啟時詢問', 'pse3.color.askPaste':'貼上時詢問',
    'pse3.color.engine':'引擎：', 'pse3.color.intent':'方式：', 'pse3.color.bpc':'使用黑色點補償', 'pse3.color.dither':'使用遞色 (8 位元/色版影像)',
    'pse3.color.textGamma':'使用 Gamma 混合文字顏色：', 'pse3.color.monitor':'顯示器描述檔：', 'pse3.color.monitor.auto':'自動（系統顯示器；瀏覽器內＝sRGB）',
    'pse3.color.intent.perceptual':'知覺', 'pse3.color.intent.relative':'相對公制色度', 'pse3.color.intent.saturation':'飽和度', 'pse3.color.intent.absolute':'絕對公制色度',
    'pse3.color.defaults':'預設值', 'pse3.color.resetDone':'已回復預設值',
    'pse3.color.docProfile':'描述檔：', 'pse3.color.assign.profile':'指定描述檔：', 'pse3.color.convert.profile':'描述檔：',
    'pse3.color.none':'不要對此文件做色彩管理', 'pse3.color.working.rgb':'使用中的 RGB', 'pse3.color.working.gray':'使用中的灰階',
  },
  'zh-Hans':{
    'pse3.color.settings.title':'颜色设置', 'pse3.color.assign.title':'指定配置文件', 'pse3.color.convert.title':'转换为配置文件',
    'pse3.color.sec.working':'工作空间', 'pse3.color.sec.policy':'色彩管理方案', 'pse3.color.sec.conv':'转换选项', 'pse3.color.sec.adv':'高级控制',
    'pse3.color.sec.source':'源空间', 'pse3.color.sec.dest':'目标空间',
    'pse3.color.rgb':'RGB：', 'pse3.color.cmyk':'CMYK：', 'pse3.color.gray':'灰色：',
    'pse3.color.policy.preserve':'保留嵌入的配置文件', 'pse3.color.policy.convert.rgb':'转换为工作中的 RGB', 'pse3.color.policy.convert.cmyk':'转换为工作中的 CMYK',
    'pse3.color.policy.convert.gray':'转换为工作中的灰色', 'pse3.color.policy.off':'关',
    'pse3.color.mismatch':'配置文件不匹配：', 'pse3.color.missing':'缺少配置文件：', 'pse3.color.askOpen':'打开时询问', 'pse3.color.askPaste':'粘贴时询问',
    'pse3.color.engine':'引擎：', 'pse3.color.intent':'意图：', 'pse3.color.bpc':'使用黑场补偿', 'pse3.color.dither':'使用仿色（8 位/通道图像）',
    'pse3.color.textGamma':'用灰度系数混合文本颜色：', 'pse3.color.monitor':'显示器配置文件：', 'pse3.color.monitor.auto':'自动（系统显示器；浏览器内＝sRGB）',
    'pse3.color.intent.perceptual':'可感知', 'pse3.color.intent.relative':'相对比色', 'pse3.color.intent.saturation':'饱和度', 'pse3.color.intent.absolute':'绝对比色',
    'pse3.color.defaults':'默认值', 'pse3.color.resetDone':'已恢复默认值',
    'pse3.color.docProfile':'配置文件：', 'pse3.color.assign.profile':'指定配置文件：', 'pse3.color.convert.profile':'配置文件：',
    'pse3.color.none':'不对此文档进行色彩管理', 'pse3.color.working.rgb':'工作中的 RGB', 'pse3.color.working.gray':'工作中的灰色',
  },
  en:{
    'pse3.color.settings.title':'Color Settings', 'pse3.color.assign.title':'Assign Profile', 'pse3.color.convert.title':'Convert to Profile',
    'pse3.color.sec.working':'Working Spaces', 'pse3.color.sec.policy':'Color Management Policies', 'pse3.color.sec.conv':'Conversion Options', 'pse3.color.sec.adv':'Advanced Controls',
    'pse3.color.sec.source':'Source Space', 'pse3.color.sec.dest':'Destination Space',
    'pse3.color.rgb':'RGB:', 'pse3.color.cmyk':'CMYK:', 'pse3.color.gray':'Gray:',
    'pse3.color.policy.preserve':'Preserve Embedded Profiles', 'pse3.color.policy.convert.rgb':'Convert to Working RGB', 'pse3.color.policy.convert.cmyk':'Convert to Working CMYK',
    'pse3.color.policy.convert.gray':'Convert to Working Gray', 'pse3.color.policy.off':'Off',
    'pse3.color.mismatch':'Profile Mismatches:', 'pse3.color.missing':'Missing Profiles:', 'pse3.color.askOpen':'Ask When Opening', 'pse3.color.askPaste':'Ask When Pasting',
    'pse3.color.engine':'Engine:', 'pse3.color.intent':'Intent:', 'pse3.color.bpc':'Use Black Point Compensation', 'pse3.color.dither':'Use Dither (8-bit/channel images)',
    'pse3.color.textGamma':'Blend Text Colors Using Gamma:', 'pse3.color.monitor':'Monitor Profile:', 'pse3.color.monitor.auto':'Auto (system display; sRGB in the browser)',
    'pse3.color.intent.perceptual':'Perceptual', 'pse3.color.intent.relative':'Relative Colorimetric', 'pse3.color.intent.saturation':'Saturation', 'pse3.color.intent.absolute':'Absolute Colorimetric',
    'pse3.color.defaults':'Defaults', 'pse3.color.resetDone':'Defaults restored',
    'pse3.color.docProfile':'Profile:', 'pse3.color.assign.profile':'Assign Profile:', 'pse3.color.convert.profile':'Profile:',
    'pse3.color.none':"Don't Color Manage This Document", 'pse3.color.working.rgb':'Working RGB', 'pse3.color.working.gray':'Working Gray',
  },
});

/* 给测试／agent 除错用：配置文件与转换的本体 */
PE.color = {grayAsRgb, builtin, parsed, makeTransform, tU8, tEval, isIdentity, canvasDisplay, documentProfile, resolve, settings:() => Object.assign({}, loadSettings()), BUILTINS};
})();

/* ═══════════ warp（照 photocraft engine/src/warp_cmds.rs ＋ geom/src/warp.rs ＋ algo/src/warp.rs ＋ ui-egui/src/transform_tool.rs、menus.rs:371-383 抄） ═══════════
   编辑 ▸ 变换 ▸ 变形（Warp）与四个拆分变形项。
   - ps.edit.transform.warp：没参数＝进互动变形模式（transform_tool.rs begin_warp 189-222）；有参数＝转给 ps.edit.transform.warp.apply（menus.rs:371-374）
   - ps.edit.transform.warp.apply：引擎命令 edit.transform.warp（warp_cmds.rs:204-227 apply，一步历史）
   - ps.edit.transform.splitWarp*／removeWarpSplit：拆分网格（warp_cmds.rs:238-311）；变形模式开着时从菜单点＝拆目前的网格（menus.rs:375-383 → transform_tool.rs split 631-643）
   🔴 坐标一律是文件坐标；像素层画布原点在 (L.x, L.y)。 */
(function(){
'use strict';
const PE = window.PsEdit; if (!PE || PE._pse3_warp) return; PE._pse3_warp = true;
const T = k => Lang.t(k);
const isNum = v => typeof v === 'number' && isFinite(v);
const fail = msg => ({ok:false, error:msg});
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const c01 = v => clamp(v, 0, 1);

/* ═══════════ 样式（geom/warp.rs:16-145 WarpStyle） ═══════════ */
const STYLES = ['none', 'custom', 'arc', 'arcLower', 'arcUpper', 'arch', 'bulge', 'shellLower', 'shellUpper', 'flag', 'wave', 'fish', 'rise', 'fisheye', 'inflate', 'squeeze', 'twist'];
const isPreset = s => s !== 'none' && s !== 'custom';                                        // warp.rs:142
const psdName = s => 'warp' + s[0].toUpperCase() + s.slice(1);                                // warp.rs:66 psd_name
/* warp.rs:137 parse：短 id 或 PSD 名（不分大小写、去空白；所以 "Arc Lower" 这种 label 也认） */
function parseStyle(s){
  if (typeof s !== 'string') return null;
  const k = s.replace(/\s+/g, '').toLowerCase();
  return STYLES.find(w => w.toLowerCase() === k || psdName(w).toLowerCase() === k) || null;
}

/* ═══════════ 预设样式的映射（geom/warp.rs:147-271 StyleWarp） ═══════════ */
/* warp.rs:165 StyleWarp::new：bend／扭曲是百分比（-100..100）；不是预设、全 0 或空框 ⇒ null */
function styleWarp(style, bend, hDistort, vDistort, vertical, bounds){
  if (!isPreset(style)) return null;
  const [x0, y0, x1, y1] = bounds;
  const hw = (x1 - x0) / 2, hh = (y1 - y0) / 2;
  if (!(hw > 0 && hh > 0)) return null;
  const pct = v => (typeof v === 'number' && isFinite(v)) ? clamp(v / 100, -1, 1) : 0;
  const b = pct(bend), hd = pct(hDistort), vd = pct(vDistort);
  if (b === 0 && hd === 0 && vd === 0) return null;
  return {style, b, hd, vd, vertical:!!vertical, c:[(x0 + x1) / 2, (y0 + y1) / 2], h:[hw, hh]};
}
/* warp.rs:251 arc：盒子的中线变成跨 b×180° 的圆弧 */
function arc(u, v, b, aspect){
  if (Math.abs(b) < 1e-6) return [u, v];
  const half = aspect, thetaMax = b * Math.PI / 2, r = half / thetaMax, theta = u * thetaMax, rr = r - v;
  const x = rr * Math.sin(theta), y = r - rr * Math.cos(theta);
  return [x / half, y];
}
function lerp2(a, b, t){ t = c01(t); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }   // warp.rs:268
/* warp.rs:206 bend：各样式在正规化空间里的映射；aspect＝沿轴／横轴的半长比 */
function swBend(sw, u, v, aspect){
  const b = sw.b, PI = Math.PI, H = Math.PI / 2;
  const bell = Math.max(1 - u * u, 0);
  switch (sw.style){
    case 'arc': return arc(u, v, b, aspect);
    case 'arcLower': return lerp2([u, v], arc(u, v, b, aspect), (v + 1) / 2);
    case 'arcUpper': return lerp2([u, v], arc(u, v, b, aspect), (1 - v) / 2);
    case 'arch': return [u, v - b * bell];                                    // 每一栏同一条抛物线往上（b>0），竖线保持竖直
    case 'bulge': return [u, v * (1 + b * bell)];
    case 'shellLower': return [u, v + b * bell * (v + 1) / 2];                // 下缘外鼓、上缘不动
    case 'shellUpper': return [u, v - b * bell * (1 - v) / 2];
    case 'flag': return [u, v - b * 0.5 * Math.sin(PI * u)];
    case 'wave': return [u, v - b * 0.5 * Math.sin(PI * u + v * H)];
    case 'fish': return [u, v * (1 + b * 0.6 * (1 - u) * Math.sqrt(bell)) - b * 0.35 * bell];   // 头（左）胖、尾细、往上弯
    case 'rise': return [u, v - b * 0.5 * Math.sin(H * u)];
    case 'fisheye': { const r2 = Math.min(u * u + v * v, 1), k = 1 + b * (1 - r2); return [u * k, v * k]; }
    case 'inflate': { const bu = Math.max(1 - v * v, 0), bv = bell; return [u * (1 + b * 0.5 * bu), v * (1 + b * 0.5 * bv)]; }
    case 'squeeze': return [u * (1 + b * 0.5 * Math.max(1 - v * v, 0)), v * (1 - b * 0.5 * bell)];
    case 'twist': {
      const r = Math.sqrt(u * u + v * v);
      if (r >= 1) return [u, v];
      const a = b * H * (1 - r) * (1 - r), s = Math.sin(a), c = Math.cos(a);   // 在等向的框里转，宽盒子也是圆的
      const x = u * aspect, y = v;
      return [(x * c - y * s) / aspect, x * s + y * c];
    }
    default: return [u, v];
  }
}
/* warp.rs:188 apply：映一个点 */
function swApply(sw, x, y){
  const dx = x - sw.c[0], dy = y - sw.c[1];
  const [u, v, hu, hv] = sw.vertical ? [dy / sw.h[1], dx / sw.h[0], sw.h[1], sw.h[0]] : [dx / sw.h[0], dy / sw.h[1], sw.h[0], sw.h[1]];
  let [u2, v2] = swBend(sw, u, v, hu / hv);
  if (sw.hd !== 0) v2 *= Math.max(1 + sw.hd * u2, 0.05);                    // 扭曲：沿各轴类似透视的收窄
  if (sw.vd !== 0) u2 *= Math.max(1 + sw.vd * v2, 0.05);
  const [ox, oy] = sw.vertical ? [v2 * sw.h[0], u2 * sw.h[1]] : [u2 * sw.h[0], v2 * sw.h[1]];
  return [sw.c[0] + ox, sw.c[1] + oy];
}

/* ═══════════ 贝兹网格（geom/warp.rs:273-519 BezierMesh：{us, vs, points}，points 逐列、文件坐标） ═══════════ */
function bernstein(t){ const s = 1 - t; return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t]; }   // warp.rs:273
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
/* warp.rs:283 de Casteljau：7 点（左 0..3、右 3..6） */
function splitCubic(p, t){
  const a = lerp(p[0], p[1], t), b = lerp(p[1], p[2], t), c = lerp(p[2], p[3], t);
  const d = lerp(a, b, t), e = lerp(b, c, t), f = lerp(d, e, t);
  return [p[0], a, d, f, e, c, p[3]];
}
/* warp.rs:295 Bernstein 在 t=0,1/3,2/3,1 的内插矩阵的反矩阵 */
const BERN_INV = [[1, 0, 0, 0], [-5 / 6, 3, -1.5, 1 / 3], [1 / 3, -1.5, 3, -5 / 6], [0, 0, 0, 1]];
const nxOf = m => 3 * (m.us.length - 1) + 1;                                  // warp.rs:354
const nyOf = m => 3 * (m.vs.length - 1) + 1;
/* warp.rs:321 fit：在每块的三等分点内插 f（正规化 → 输出）；对双三次（含仿射）映射是精确的 */
function meshFit(f, us, vs){
  const pc = us.length - 1, pr = vs.length - 1, nx = 3 * pc + 1, ny = 3 * pr + 1;
  const points = new Array(nx * ny);
  for (let pj = 0; pj < pr; pj++) for (let pi = 0; pi < pc; pi++){
    const s = [];                                                              // s[列 j][栏 i]
    for (let j = 0; j < 4; j++){ const row = []; for (let i = 0; i < 4; i++){
      const u = us[pi] + (us[pi + 1] - us[pi]) * i / 3, t = vs[pj] + (vs[pj + 1] - vs[pj]) * j / 3;
      row.push(f(u, t)); } s.push(row); }
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++){
      const acc = [0, 0];
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++){ const k = BERN_INV[j][a] * BERN_INV[i][b]; acc[0] += k * s[a][b][0]; acc[1] += k * s[a][b][1]; }
      points[(3 * pj + j) * nx + 3 * pi + i] = acc;
    }
  }
  return {us, vs, points};
}
/* warp.rs:312 identity：cols×rows 块的恒等网格（PS 缺省 1×1＝4×4 控制点） */
function meshIdentity(bounds, cols, rows){
  cols = clamp(Math.floor(cols) || 1, 1, 64); rows = clamp(Math.floor(rows) || 1, 1, 64);
  const us = [], vs = [];
  for (let i = 0; i <= cols; i++) us.push(i / cols);
  for (let i = 0; i <= rows; i++) vs.push(i / rows);
  return meshFit((s, t) => [bounds[0] + s * (bounds[2] - bounds[0]), bounds[1] + t * (bounds[3] - bounds[1])], us, vs);
}
/* warp.rs:366 is_valid：节点 0..1 递增、点数对、都是有限数 */
function meshValid(m){
  if (!m || !Array.isArray(m.us) || !Array.isArray(m.vs) || !Array.isArray(m.points)) return false;
  const knots = k => k.length >= 2 && k.every(isNum) && k[0] === 0 && k[k.length - 1] === 1 && k.every((v, i) => i === 0 || v > k[i - 1]);
  return knots(m.us) && knots(m.vs) && m.points.length === nxOf(m) * nyOf(m)
    && m.points.every(p => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]));
}
/* warp.rs:374 locate：s 落在哪一块、块内参数 */
function locate(knots, s){
  const n = knots.length - 1; s = clamp(s, 0, 1);
  let i = 0;
  while (i + 1 < n && s > knots[i + 1]) i++;
  const w = knots[i + 1] - knots[i];
  return [i, w > 0 ? (s - knots[i]) / w : 0];
}
/* warp.rs:386 eval：曲面在正规化 (s, t) 的点 */
function meshEval(m, s, t){
  const [pi, a] = locate(m.us, s), [pj, b] = locate(m.vs, t);
  const ba = bernstein(a), bb = bernstein(b), nx = nxOf(m), out = [0, 0];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++){
    const p = m.points[(3 * pj + j) * nx + 3 * pi + i], k = ba[i] * bb[j];
    out[0] += p[0] * k; out[1] += p[1] * k;
  }
  return out;
}
/* warp.rs:405 split_u：在 s 把那一栏块切开（竖的拆分线；精确，曲面不变）；离现有边界太近回 false */
function meshSplitU(m, s){
  const [pi, a] = locate(m.us, s);
  if (!(a >= 0.01 && a <= 0.99)) return false;
  const nx = nxOf(m), ny = nyOf(m), pts = [];
  for (let j = 0; j < ny; j++){
    const row = m.points.slice(j * nx, (j + 1) * nx);
    pts.push(...row.slice(0, 3 * pi));
    pts.push(...splitCubic([row[3 * pi], row[3 * pi + 1], row[3 * pi + 2], row[3 * pi + 3]], a));
    pts.push(...row.slice(3 * pi + 4));
  }
  m.points = pts;
  m.us.splice(pi + 1, 0, clamp(s, 0, 1));
  return true;
}
/* warp.rs:466 transpose */
function meshTranspose(m){
  const nx = nxOf(m), ny = nyOf(m), pts = new Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts[i * ny + j] = m.points[j * nx + i];
  m.points = pts; const t = m.us; m.us = m.vs; m.vs = t;
}
function meshSplitV(m, t){ meshTranspose(m); const ok = meshSplitU(m, t); meshTranspose(m); return ok; }   // warp.rs:425
/* warp.rs:435 remove_split_u：拿掉内部竖边界 k，两栏并一栏（来自没改过的拆分就精确；否则外侧点保留、内侧把手外插） */
function meshRemoveSplitU(m, k){
  if (k === 0 || k + 1 >= m.us.length) return false;
  const a = (m.us[k] - m.us[k - 1]) / (m.us[k + 1] - m.us[k - 1]);
  const nx = nxOf(m), ny = nyOf(m), pts = [], c0 = 3 * (k - 1);
  for (let j = 0; j < ny; j++){
    const row = m.points.slice(j * nx, (j + 1) * nx);
    const p0 = row[c0], q1 = row[c0 + 1], r2 = row[c0 + 5], p3 = row[c0 + 6];
    const p1 = [(q1[0] - (1 - a) * p0[0]) / a, (q1[1] - (1 - a) * p0[1]) / a];        // 反 de Casteljau：q1 = lerp(p0, p1, a)
    const p2 = [(r2[0] - a * p3[0]) / (1 - a), (r2[1] - a * p3[1]) / (1 - a)];        // r2 = lerp(p2, p3, a)
    pts.push(...row.slice(0, c0), p0, p1, p2, p3, ...row.slice(c0 + 7));
  }
  m.points = pts; m.us.splice(k, 1);
  return true;
}
function meshRemoveSplitV(m, k){ meshTranspose(m); const ok = meshRemoveSplitU(m, k); meshTranspose(m); return ok; }   // warp.rs:459
const meshMap = (m, f) => ({us:m.us.slice(), vs:m.vs.slice(), points:m.points.map(p => f(p))});   // warp.rs:479 map_points
const meshClone = m => ({us:m.us.slice(), vs:m.vs.slice(), points:m.points.map(p => [p[0], p[1]])});
/* warp.rs:485 param_at：离 p 最近的曲面点的 (s, t)（粗搜 48×48 再 12 步牛顿）；拆分线放在点的位置用 */
function meshParamAt(m, p){
  const n = 48; let best = [0.5, 0.5, Infinity];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++){
    const s = i / n, t = j / n, q = meshEval(m, s, t), d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < best[2]) best = [s, t, d];
  }
  let s = best[0], t = best[1];
  for (let k = 0; k < 12; k++){
    const h = 1e-5, q = meshEval(m, s, t), qs = meshEval(m, s + h, t), qt = meshEval(m, s, t + h);
    const a = (qs[0] - q[0]) / h, b = (qt[0] - q[0]) / h, c = (qs[1] - q[1]) / h, d = (qt[1] - q[1]) / h;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-12) break;
    const ex = p[0] - q[0], ey = p[1] - q[1];
    s = clamp(s + (d * ex - b * ey) / det, 0, 1);
    t = clamp(t + (a * ey - c * ex) / det, 0, 1);
  }
  return [s, t];
}

/* ═══════════ 一个完整的变形（geom/warp.rs:521-646 Warp：{style, bend, hDistort, vDistort, vertical, bounds, mesh}） ═══════════ */
const warpNone = bounds => ({style:'none', bend:0, hDistort:0, vDistort:0, vertical:false, bounds:bounds.slice(), mesh:null});   // warp.rs:545
const warpPreset = (style, bend, bounds) => Object.assign(warpNone(bounds), {style, bend});                                     // warp.rs:550
const warpCustom = (mesh, bounds) => Object.assign(warpNone(bounds), {style:'custom', mesh});                                   // warp.rs:555
const warpClone = w => Object.assign({}, w, {bounds:w.bounds.slice(), mesh:w.mesh ? meshClone(w.mesh) : null});
const boxPoint = (w, s, t) => [w.bounds[0] + s * (w.bounds[2] - w.bounds[0]), w.bounds[1] + t * (w.bounds[3] - w.bounds[1])];   // warp.rs:578
/* warp.rs:584 map：源点 → 输出。回一支函数 (x, y) → [x', y']（预设先备好 StyleWarp，热路径不重算） */
function warpMapper(w){
  if (w.style === 'none') return (x, y) => [x, y];
  if (w.style === 'custom'){
    const m = w.mesh; if (!m) return (x, y) => [x, y];
    const b = w.bounds, bw = b[2] - b[0], bh = b[3] - b[1];
    if (bw <= 0 || bh <= 0) return (x, y) => [x, y];
    return (x, y) => meshEval(m, (x - b[0]) / bw, (y - b[1]) / bh);
  }
  const sw = styleWarp(w.style, w.bend, w.hDistort, w.vDistort, w.vertical, w.bounds);
  return sw ? (x, y) => swApply(sw, x, y) : (x, y) => [x, y];
}
/* warp.rs:564 is_identity：框里每一点都映回自己（1e-9 px 内） */
function warpIsIdentity(w){
  if (w.style === 'none') return true;
  if (w.style === 'custom'){
    const m = w.mesh; if (!m) return true;
    const id = meshFit((s, t) => boxPoint(w, s, t), m.us.slice(), m.vs.slice());
    return m.points.every((a, i) => Math.abs(a[0] - id.points[i][0]) < 1e-9 && Math.abs(a[1] - id.points[i][1]) < 1e-9);
  }
  return !styleWarp(w.style, w.bend, w.hDistort, w.vDistort, w.vertical, w.bounds);
}
/* warp.rs:608 to_mesh：预设用 cols×rows 块去配；自订直接回自己的网格 */
function warpToMesh(w, cols, rows){
  if (w.style === 'custom' && w.mesh) return meshClone(w.mesh);
  cols = clamp(cols, 1, 64); rows = clamp(rows, 1, 64);
  const us = [], vs = [];
  for (let i = 0; i <= cols; i++) us.push(i / cols);
  for (let i = 0; i <= rows; i++) vs.push(i / rows);
  const f = warpMapper(w);
  return meshFit((s, t) => { const p = boxPoint(w, s, t); return f(p[0], p[1]); }, us, vs);
}

/* ═══════════ 参数（warp_cmds.rs:73-111 warp_from_params） ═══════════ */
const bad = (cmd, msg) => new Error(`${cmd}: ${msg}`);                        // EngineError::BadParams
/* serde 把 JSON 解成 Warp／BezierMesh（style、bounds 必填；其余缺省 0／false／null） */
function parseMesh(v){
  if (!v || typeof v !== 'object' || !Array.isArray(v.us) || !Array.isArray(v.vs) || !Array.isArray(v.points)) throw new Error('expected {us:[…], vs:[…], points:[[x,y]…]}');
  return {us:v.us.map(Number), vs:v.vs.map(Number), points:v.points.map(p => Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [NaN, NaN])};
}
function parseWarp(v){
  if (!v || typeof v !== 'object') throw new Error('expected a warp object');
  const style = parseStyle(v.style); if (!style) throw new Error(`unknown variant "${v.style}"`);
  if (!Array.isArray(v.bounds) || v.bounds.length !== 4 || !v.bounds.every(x => isNum(+x))) throw new Error('missing or bad field `bounds` ([x0,y0,x1,y1])');
  const num = k => { if (v[k] === undefined || v[k] === null) return 0; if (!isNum(+v[k])) throw new Error(`bad field \`${k}\``); return +v[k]; };
  const w = warpNone(v.bounds.map(Number));
  w.style = style; w.bend = num('bend'); w.hDistort = num('hDistort'); w.vDistort = num('vDistort'); w.vertical = !!v.vertical;
  w.mesh = (v.mesh === undefined || v.mesh === null) ? null : parseMesh(v.mesh);
  return w;
}
function warpFromParams(cmd, p, rect){
  if (p.warp !== undefined && p.warp !== null){
    let w; try { w = parseWarp(p.warp); } catch (e){ throw bad(cmd, `bad \`warp\`: ${e.message}`); }
    if (w.mesh && !meshValid(w.mesh)) throw bad(cmd, 'malformed warp mesh');
    return w;
  }
  const num = (k, d) => isNum(p[k]) ? p[k] : d;
  let style;
  if (typeof p.style === 'string'){ style = parseStyle(p.style); if (!style) throw bad(cmd, `unknown warp style "${p.style}"`); }
  else if (p.mesh !== undefined || p.grid !== undefined) style = 'custom';
  else throw bad(cmd, 'pass `style` (arc, flag, …, custom), `mesh` or `warp`');
  const w = warpPreset(style, num('bend', 50), rect);
  w.hDistort = num('hDistort', 0); w.vDistort = num('vDistort', 0);
  w.vertical = typeof p.vertical === 'boolean' ? p.vertical : false;
  if (style === 'custom'){
    if (p.mesh !== undefined){
      let m; try { m = parseMesh(p.mesh); } catch (e){ throw bad(cmd, `bad \`mesh\`: ${e.message}`); }
      if (!meshValid(m)) throw bad(cmd, 'malformed mesh (need (3·cols+1)×(3·rows+1) points and knots 0..1)');
      w.mesh = m;
    } else {
      const g = Array.isArray(p.grid) ? p.grid : null;
      const at = i => (g && Number.isInteger(g[i]) && g[i] >= 0) ? g[i] : 1;
      w.mesh = meshIdentity(rect, at(0), at(1));
    }
  }
  return w;
}

/* ═══════════ 重采样（algo/src/warp.rs:49-311） ═══════════ */
const catmullRom = t => { const t2 = t * t, t3 = t2 * t; return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2]; };   // warp.rs:18
const CELL = 4, MAX_CELLS = 512;                                               // warp.rs:25-27
const rw = r => r[2] - r[0], rh = r => r[3] - r[1];
const rinter = (a, b) => { if (!a || !b) return null; const r = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]; return (r[2] > r[0] && r[3] > r[1]) ? r : null; };
const runion = (a, b) => !a ? (b ? b.slice() : null) : !b ? a.slice() : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const docRect = () => [0, 0, Doc.width, Doc.height];
/* warp.rs:86 warp_triangles：每个顶点是 [目的x, 目的y, 源x, 源y]（文件像素）；三角形在目的空间光栅化、源位置用重心座标内插，
   再到 src 取样（预乘；最近／双线性／Catmull-Rom 双三次）。后面的三角形盖前面的（折叠处右下那格赢）。
   src＝预乘 Float32、n 个通道（最后一个是 alpha）、刚好盖住 srcRect；回 {rect, px（straight Float32，n 通道）} 或 null。
   原码按 256 格分块平行算、每块只读源的足迹；结果与整张一次算相同，这里整张一次算。 */
function warpTriangles(src, srcRect, n, verts, tris, interp){
  if (!rw(srcRect) || !rh(srcRect) || !tris.length) return null;
  if (verts.some(v => !isFinite(v[0]) || !isFinite(v[1]))) return null;
  const lim = 1 << 20;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of tris) for (const i of t){ const v = verts[i]; x0 = Math.min(x0, v[0]); y0 = Math.min(y0, v[1]); x1 = Math.max(x1, v[0]); y1 = Math.max(y1, v[1]); }
  let dst = [Math.floor(Math.max(x0, -lim)) - 1, Math.floor(Math.max(y0, -lim)) - 1, Math.ceil(Math.min(x1, lim)) + 1, Math.ceil(Math.min(y1, lim)) + 1];
  // 浏览器记忆体有限：目的范围最多到文件四周各 1024 px 外（原码的层没有边界；拖到那么远的像素会被裁掉）
  const pad = 1024;
  dst = rinter(dst, [-pad, -pad, Doc.width + pad, Doc.height + pad]); if (!dst) return null;
  const dw = rw(dst), dh = rh(dst);
  const uv = new Float64Array(dw * dh * 2).fill(NaN);                        // 每个目的像素的源位置（NaN＝没盖到）
  const eps = -1e-9;
  for (const t of tris){
    const A = verts[t[0]], B = verts[t[1]], C = verts[t[2]];
    const det = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
    if (Math.abs(det) < 1e-12) continue;
    const bx0 = Math.max(Math.floor(Math.min(A[0], B[0], C[0]) - 0.5), dst[0]), by0 = Math.max(Math.floor(Math.min(A[1], B[1], C[1]) - 0.5), dst[1]);
    const bx1 = Math.min(Math.ceil(Math.max(A[0], B[0], C[0]) + 0.5), dst[2]), by1 = Math.min(Math.ceil(Math.max(A[1], B[1], C[1]) + 0.5), dst[3]);
    for (let y = by0; y < by1; y++){
      const py = y + 0.5;
      for (let x = bx0; x < bx1; x++){
        const px = x + 0.5;
        const l1 = ((px - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (py - A[1])) / det;
        const l2 = ((B[0] - A[0]) * (py - A[1]) - (px - A[0]) * (B[1] - A[1])) / det;
        const l0 = 1 - l1 - l2;
        if (l0 < eps || l1 < eps || l2 < eps) continue;
        const o = ((y - dst[1]) * dw + (x - dst[0])) * 2;
        uv[o] = l0 * A[2] + l1 * B[2] + l2 * C[2]; uv[o + 1] = l0 * A[3] + l1 * B[3] + l2 * C[3];
      }
    }
  }
  const sw = rw(srcRect), a = n - 1;
  const at = (x, y, c) => (x < srcRect[0] || y < srcRect[1] || x >= srcRect[2] || y >= srcRect[3]) ? 0 : src[((y - srcRect[1]) * sw + (x - srcRect[0])) * n + c];
  const out = new Float32Array(dw * dh * n), acc = new Float64Array(n);
  const snap = t => Math.abs(t - Math.round(t)) < 1e-7 ? Math.round(t) : t;   // 双三次：贴近格点就吸上去，恒等才精确
  let any = false;
  for (let o = 0; o < dw * dh; o++){
    const qu = uv[o * 2]; if (qu !== qu) continue;
    let u = qu - 0.5, v = uv[o * 2 + 1] - 0.5;
    acc.fill(0);
    if (interp === 'nearest'){
      const ix = Math.floor(u + 0.5), iy = Math.floor(v + 0.5);
      for (let c = 0; c < n; c++) acc[c] = at(ix, iy, c);
    } else if (interp === 'bilinear'){
      const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
      const W4 = [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]];
      for (const [dx, dy, k] of W4) for (let c = 0; c < n; c++) acc[c] += at(ix + dx, iy + dy, c) * k;
    } else {
      u = snap(u); v = snap(v);
      const ix = Math.floor(u), iy = Math.floor(v), wx = catmullRom(u - ix), wy = catmullRom(v - iy);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++){
        const k = wx[i] * wy[j]; if (k === 0) continue;
        for (let c = 0; c < n; c++) acc[c] += at(ix - 1 + i, iy - 1 + j, c) * k;
      }
    }
    const al = c01(acc[a]);
    if (al <= 1e-6) continue;                                                  // 浮点杂讯不留看不见的颜色
    any = true;
    const b = o * n;
    for (let c = 0; c < a; c++) out[b + c] = c01(acc[c] / al);
    out[b + a] = al;
  }
  return any ? {rect:dst, px:out} : null;
}
/* warp.rs:52 warp_mesh_surface：源矩形切成约 4 px 的细格、顶点往前映、每格两个三角形 */
function warpMeshSurface(src, srcRect, f, interp, n){
  if (!(rw(srcRect) > 0 && rh(srcRect) > 0)) return null;
  const sw = rw(srcRect), sh = rh(srcRect);
  const nx = clamp(Math.ceil(sw / CELL), 1, MAX_CELLS), ny = clamp(Math.ceil(sh / CELL), 1, MAX_CELLS);
  const verts = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++){
    const sx = srcRect[0] + sw * i / nx, sy = srcRect[1] + sh * j / ny;
    const d = f(sx, sy);
    verts.push([d[0], d[1], sx, sy]);
  }
  const w1 = nx + 1, tris = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
    const a = j * w1 + i;
    tris.push([a, a + 1, a + w1 + 1]); tris.push([a, a + w1 + 1, a + w1]);
  }
  return warpTriangles(src, srcRect, n, verts, tris, interp);
}
/* 选区跟着变（warp.rs:288 warp_mesh_gray，缺省值 0；warp_cmds.rs:221-223 用双线性） */
function warpSelection(f){
  const b = window.SelMask ? SelMask.bytes() : null; if (!b) return;
  const W = Doc.width, H = Doc.height;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b[y * W + x]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  if (x1 < 0){ Doc.sel = null; return; }
  const r = [x0, y0, x1 + 1, y1 + 1], sw = rw(r), src = new Float32Array(sw * rh(r) * 2);
  for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++){ const i = ((y - r[1]) * sw + (x - r[0])) * 2; src[i] = b[y * W + x] / 255; src[i + 1] = 1; }   // 带 alpha 的灰阶（alpha 1 ⇒ 预乘不变）
  const wv = warpMeshSurface(src, r, f, 'bilinear', 2);
  const out = new Uint8Array(W * H);
  if (wv){
    const k = rinter(wv.rect, docRect()), ww = rw(wv.rect);
    if (k) for (let y = k[1]; y < k[3]; y++) for (let x = k[0]; x < k[2]; x++){
      const o = ((y - wv.rect[1]) * ww + (x - wv.rect[0])) * 2;
      const g = Math.round(wv.px[o] * 255), a = Math.round(wv.px[o + 1] * 255);   // 变形结果存成 8 位灰阶＋alpha，再压回缺省值上：g·a + 0·(1−a)
      out[y * W + x] = Math.round(g * a / 255);
    }
  }
  Doc.sel = SelMask.fromBytes(out);                                           // 全空＝没选区（.filter(!is_empty)）
}

/* ═══════════ 引擎命令 edit.transform.warp（warp_cmds.rs:113-227） ═══════════ */
const canvasRect = L => [L.x, L.y, L.x + L.data.canvas.width, L.y + L.data.canvas.height];
function alphaBounds(px, r){
  const w = rw(r), h = rh(r); let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  return x1 < 0 ? null : [r[0] + x0, r[1] + y0, r[0] + x1 + 1, r[1] + y1 + 1];
}
/* 一层有内容的外框（文件坐标）：像素层量画布 alpha，矢量／文字层量渲染结果 */
function contentRect(L){
  if (L.kind === 'raster'){ const c = L.data.canvas; if (!c.width || !c.height) return null; return alphaBounds(L.data.ctx.getImageData(0, 0, c.width, c.height).data, canvasRect(L)); }
  const cv = renderLayer(L, 1);
  return alphaBounds(cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, [0, 0, cv.width, cv.height]);
}
function selRect(){
  const s = Doc.sel; if (!s) return null;
  const r = [Math.floor(Math.min(s.x, s.x + s.w)), Math.floor(Math.min(s.y, s.y + s.h)), Math.ceil(Math.max(s.x, s.x + s.w)), Math.ceil(Math.max(s.y, s.y + s.h))];
  return (r[2] > r[0] && r[3] > r[1]) ? r : null;
}
/* transform_cmds.rs:23 transform_bounds（＝warp_cmds.rs:50 warp_bounds，我们没有智能对象）：内容外框 ∩ 选区外框 */
function warpBounds(L){ const c = contentRect(L); if (!c) return null; return Doc.sel ? rinter(c, selRect()) : c; }
function isBg(L){
  if (window.PsLayer && PsLayer.isBackground) return PsLayer.isBackground(L);
  if (!L || Doc.layers[0] !== L || L.kind !== 'raster') return false;
  if (L.isBackground !== undefined) return !!L.isBackground;
  return ['背景', 'Background', T('layer.bg')].includes(L.name);
}
const interpOf = s => (s === 'nearest' || s === 'nearestNeighbor') ? 'nearest' : s === 'bilinear' ? 'bilinear' : 'bicubic';
const prefInterp = () => (PE.prefs && PE.prefs.interp) ? PE.prefs.interp() : 'bicubic';

/* warp_cmds.rs:113 warp_layer（像素层这一支；文字／形状层照原码报错；我们没有群组、智能对象） */
function warpLayer(L, f, rect, interp){
  // 114-121：背景层先浮成普通层「图层 0」；锁位置／全锁不能变形
  if (isBg(L)){ L.name = T('layer.untitled') + ' 0'; L.isBackground = false; if (L.locks){ L.locks.position = false; L.locks.transparency = false; } }
  if (L.locks && (L.locks.position || L.locks.all)) return `layer "${L.name}" is locked`;
  if (L.kind === 'text') return 'Warp needs rasterized type (or use Type › Warp Text)';               // warp_cmds.rs:129
  if (L.kind === 'vector') return 'Warp needs a rasterized shape (Layer › Rasterize › Shape)';       // warp_cmds.rs:130（我们的矢量层＝原码的形状层）
  if (L.kind !== 'raster') return 'nothing to warp';
  const cr = canvasRect(L), cw = rw(cr), N = cw * rh(cr);
  const px = cw && rh(cr) ? L.data.ctx.getImageData(0, 0, cw, rh(cr)).data : new Uint8ClampedArray(0);
  const cov = (Doc.sel && window.SelMask) ? SelMask.bytes() : null;
  const W = Doc.width, H = Doc.height;
  // 要搬的像素（lifted）与留下的（rest），都在画布范围 cr
  let lifted, rest;
  if (cov){
    // transform_cmds.rs:245 split_selected：alpha 乘选区覆盖度／乘（1−覆盖度）
    lifted = new Uint8ClampedArray(px); rest = new Uint8ClampedArray(px);
    for (let i = 0; i < N; i++){
      const x = cr[0] + i % cw, y = cr[1] + ((i / cw) | 0);
      const k = (x >= 0 && y >= 0 && x < W && y < H) ? cov[y * W + x] / 255 : 0, a = px[i * 4 + 3] / 255;
      lifted[i * 4 + 3] = Math.round(a * k * 255); rest[i * 4 + 3] = Math.round(a * (1 - k) * 255);
    }
  } else {
    // 159-171：框外的内容留在原地（clear_surface(rest, rect)：框内整格清成空像素）
    lifted = px; rest = new Uint8ClampedArray(px);
    const k = rinter(rect, cr);
    if (k) for (let y = k[1]; y < k[3]; y++) rest.fill(0, ((y - cr[1]) * cw + (k[0] - cr[0])) * 4, ((y - cr[1]) * cw + (k[2] - cr[0])) * 4);
  }
  // warp_mesh_surface(lifted, rect)：只取 rect 里的源像素（预乘 Float32）
  const sw = rw(rect), sh = rh(rect), src = new Float32Array(sw * sh * 4);
  for (let y = rect[1]; y < rect[3]; y++) for (let x = rect[0]; x < rect[2]; x++){
    if (x < cr[0] || y < cr[1] || x >= cr[2] || y >= cr[3]) continue;
    const s = ((y - cr[1]) * cw + (x - cr[0])) * 4, o = ((y - rect[1]) * sw + (x - rect[0])) * 4, a = lifted[s + 3] / 255;
    src[o] = lifted[s] / 255 * a; src[o + 1] = lifted[s + 1] / 255 * a; src[o + 2] = lifted[s + 2] / 255 * a; src[o + 3] = a;
  }
  const wv = warpMeshSurface(src, rect, f, interp, 4);
  // 新画布：至少盖住文件、留下的像素、变形结果
  let top = null, topR = null;
  if (wv){
    top = new Uint8ClampedArray(wv.px.length);
    for (let i = 0; i < top.length; i++) top[i] = Math.round(wv.px[i] * 255);   // 变形结果存成 8 位
    topR = alphaBounds(top, wv.rect);
  }
  const nr = runion(runion(docRect(), alphaBounds(rest, cr)), topR);
  const nw = rw(nr), out = new Uint8ClampedArray(nw * rh(nr) * 4);
  const kr = rinter(cr, nr);
  if (kr) for (let y = kr[1]; y < kr[3]; y++){ const so = ((y - cr[1]) * cw + (kr[0] - cr[0])) * 4; out.set(rest.subarray(so, so + rw(kr) * 4), ((y - nr[1]) * nw + (kr[0] - nr[0])) * 4); }
  if (topR){
    // transform_cmds.rs:285 composite_over：Normal 盖上去（straight alpha）
    const tw = rw(wv.rect);
    for (let y = topR[1]; y < topR[3]; y++) for (let x = topR[0]; x < topR[2]; x++){
      const t = ((y - wv.rect[1]) * tw + (x - wv.rect[0])) * 4, ta = top[t + 3] / 255;
      if (!top[t + 3]) continue;
      const d = ((y - nr[1]) * nw + (x - nr[0])) * 4, da = out[d + 3] / 255, oa = ta + da * (1 - ta);
      if (oa > 0) for (let c = 0; c < 3; c++) out[d + c] = Math.round((top[t + c] / 255 * ta + out[d + c] / 255 * da * (1 - ta)) / oa * 255);
      out[d + 3] = Math.round(oa * 255);
    }
  }
  const c = document.createElement('canvas'); c.width = nw; c.height = rh(nr);
  const ctx = c.getContext('2d', {willReadFrequently:true});
  ctx.putImageData(new ImageData(out, nw, rh(nr)), 0, 0);
  L.data.canvas = c; L.data.ctx = ctx; L.x = nr[0]; L.y = nr[1];
  Layer.invalidate(L);
  // 176-180：链接的图层蒙版跟着变——我们的蒙版是另一张画布、没有「链接」栏位，ps.edit.transform 也没动它；这里同样不动
  return null;
}
/* warp_cmds.rs:184 target：哪一层、哪个框（rect 四舍五入成整数；缺省＝warp_bounds） */
function target(p, cmd){
  const id = p.layerId !== undefined ? p.layerId : p.layer;
  const L = id !== undefined ? Doc.byId(id) : Doc.active();
  if (!L) throw new Error(id !== undefined ? `no such layer ${id}` : 'no active layer');
  let rect;
  if (Array.isArray(p.rect) && p.rect.length === 4) rect = p.rect.map(v => Math.round(Number(v) || 0));
  else rect = warpBounds(L);
  if (!rect || !(rect[2] > rect[0] && rect[3] > rect[1])) throw bad(cmd, 'nothing to warp');
  return [L, rect];
}
/* warp_cmds.rs:204 apply */
function apply(p, cmd){
  let L, rect, w;
  try { [L, rect] = target(p, cmd); w = warpFromParams(cmd, p, rect); } catch (e){ return fail(e.message); }
  if (warpIsIdentity(w)){
    History.past.pop();                       // 原码在 s.edit 之前就回 ⇒ 不留历史步（CMD.run 已经替这条 undoable 命令 push 过一次，拿掉）
    return {ok:true, layerId:L.id, changed:false};
  }
  const interp = interpOf(typeof p.interpolation === 'string' ? p.interpolation : prefInterp());
  const f = warpMapper(w);
  const err = warpLayer(L, f, rect, interp);
  if (err) return fail(err);
  if (Doc.sel) warpSelection(f);              // 221-223：选区轮廓跟着变（双线性）
  return {ok:true, layerId:L.id, changed:true, rect};
}

/* ═══════════ 拆分（warp_cmds.rs:229-311） ═══════════ */
/* 238 split_warp：在 w 的网格上拆分（或拿掉最靠近 at 的拆分线）；预设先变自订 */
function splitWarp(w, at, how){
  const mesh = warpToMesh(w, 1, 1);
  let [s, t] = at ? meshParamAt(mesh, at) : [0.5, 0.5];
  // 没给点 ⇒ 拆在 (s, t) 所在那一块的正中
  const mid = (k, v) => { let i = k.findIndex((x, j) => j > 0 && v <= x) - 1; if (i < 0) i = k.length - 2; return (k[i] + k[i + 1]) / 2; };
  if (!at){ s = mid(mesh.us, s); t = mid(mesh.vs, t); }
  let ok;
  if (how === 'crosswise'){ const a = meshSplitU(mesh, s), b = meshSplitV(mesh, t); ok = a || b; }
  else if (how === 'horizontal') ok = meshSplitV(mesh, t);                   // 横的拆分线分开列；竖的分开栏
  else if (how === 'vertical') ok = meshSplitU(mesh, s);
  else {
    const near = (k, v) => { let best = null; for (let i = 1; i < k.length - 1; i++) if (best === null || Math.abs(k[i] - v) < Math.abs(k[best] - v)) best = i; return best; };
    const iu = near(mesh.us, s), iv = near(mesh.vs, t);
    const du = iu === null ? Infinity : Math.abs(mesh.us[iu] - s), dv = iv === null ? Infinity : Math.abs(mesh.vs[iv] - t);
    if (iu !== null && du <= dv) ok = meshRemoveSplitU(mesh, iu);
    else if (iv !== null) ok = meshRemoveSplitV(mesh, iv);
    else if (iu !== null) ok = meshRemoveSplitU(mesh, iu);
    else ok = false;
  }
  return ok ? warpCustom(mesh, w.bounds) : null;
}
const parseAt = p => (Array.isArray(p.at) && p.at.length >= 2 && isNum(+p.at[0]) && isNum(+p.at[1])) ? [+p.at[0], +p.at[1]] : null;
/* 275 split（引擎）：给了 warp／mesh／style ⇒ 拆它、回拆好的；否则原码改「当前智能对象存的变形」——我们没有智能对象 ⇒ 照原码 291-293 报错 */
function splitCmd(p, cmd, how){
  const at = parseAt(p);
  if (p.warp !== undefined || p.mesh !== undefined || p.style !== undefined){
    let rect = [0, 0, 1, 1];
    if (Array.isArray(p.rect)){ const v = p.rect.map(x => Number(x) || 0); rect = [v[0], v[1] !== undefined ? v[1] : 0, v[2] !== undefined ? v[2] : 1, v[3] !== undefined ? v[3] : 1]; }
    let w; try { w = warpFromParams(cmd, p, rect); } catch (e){ return fail(e.message); }
    const out = splitWarp(w, at, how);
    if (!out) return fail(`${cmd}: nothing to split or remove there`);
    return {ok:true, warp:out};
  }
  const L = (p.layerId || p.layer) ? Doc.byId(p.layerId || p.layer) : Doc.active();
  if (!L) return fail('no active layer');
  if (L.kind !== 'smart' || !window.Smart || !Smart.tail) return fail(`${cmd}: pass the warp being edited (\`warp\`), or select a warped smart object`);
  /* 293-310：改当前智能对象存的变形（没有＝内容外框上的「无」变形）；我们的变形在文件坐标 ⇒ at 不用反变换。
     尾端是透视（persp）＝先把它化成跟着四角的自订网格（同 enter_warp 216-221）再拆，换掉那一步 */
  if (L.locks && (L.locks.position || L.locks.all)) return fail(`layer "${L.name}" is locked`);
  const t = Smart.tail(L);
  let w, rect, replace = false;
  try {
    if (t && t.type === 'warp' && t.rect){ rect = t.rect.map(Math.round); w = warpFromParams(cmd, t.params, rect); replace = true; }
    else if (t && t.type === 'persp'){
      rect = t.rect.map(Math.round); const h = rectToQuad(rect, t.quad); if (!h) return fail(`${cmd}: degenerate quad`);
      w = warpCustom(meshMap(meshIdentity(rect, 1, 1), q => h(q[0], q[1])), rect); replace = true;
    } else {
      rect = contentRect(L); if (!rect) return fail(`${cmd}: nothing to warp`);
      w = warpCustom(meshIdentity(rect, 1, 1), rect);
    }
  } catch (e){ return fail(e.message); }
  const out = splitWarp(w, at, how);
  if (!out) return fail(`${cmd}: nothing to split or remove there`);
  History.push();
  const d = L.data; d.ops = d.ops || [];
  if (replace) d.ops.pop();
  d.ops.push({type:'warp', params:{rect:rect.slice(), warp:warpClone(out)}, at:[L.x, L.y]});
  Layer.invalidate(L);
  if (window.UI) UI.refresh();
  return {ok:true, layer:L.id, warp:warpClone(out)};
}

/* ═══════════ 互动变形模式（transform_tool.rs begin 40-90、enter_warp 199-222、warp_pointer 593-628、draw_warp 712-790、warp_options_bar 893-963、commit 292-327） ═══════════ */
let M = null;                                  // {layerId, rect, warp, tex, rest, opacity, drag, bar}
const ACCENT = '#2f8cff';
/* 自由变换框带过来时用：rect → quad 的单应矩阵（algo/transform.rs rect_to_quad） */
function rectToQuad(r, q){
  const w = r[2] - r[0], h = r[3] - r[1]; if (!(w > 0 && h > 0)) return null;
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let S;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) S = [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1];
  else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null;
    const g = (sx * dy2 - dx2 * sy) / den, hh = (dx1 * sy - sx * dy1) / den;
    S = [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh, 1];
  }
  return (x, y) => { const u = (x - r[0]) / w, v = (y - r[1]) / h, d = S[6] * u + S[7] * v + S[8]; return [(S[0] * u + S[1] * v + S[2]) / d, (S[3] * u + S[4] * v + S[5]) / d]; };
}
const corners = r => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
function mkCanvas(w, h){ const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }

/* begin_warp：没有变换框就先开（begin），再换到变形模式（enter_warp） */
function begin(){
  if (M) return {ok:true, warp:true};                                         // 已在变形模式：enter_warp 什么都不做
  let L = Doc.active(), rect = null, quad = null, xfTail = false;
  if (window.MoveTool && MoveTool.xf){                                        // 自由变换进行中 ⇒ 框的形状带进变形（enter_warp 216-221）
    const xf = MoveTool.xf; L = Doc.byId(xf.layerId) || L; rect = xf.rect.slice(); quad = xf.quad.map(q => q.slice()); xfTail = !!xf.smartTail;
    MoveTool.xfCancel();
  }
  if (!L) return fail('no active layer');
  /* 智能对象（enter_warp 199-214：智能对象存着的变形＝拿来接着编）：最后一步是变形／透视 ⇒ 预览用那步之前的样子，网格从那步来，确定时换掉那一步（非破坏、不叠） */
  let smartTail = null, warp0 = null;
  if (L.kind === 'smart' && window.Smart && Smart.tail){
    const t = Smart.tail(L);
    if (t && t.type === 'warp' && !rect && t.rect){
      try { rect = t.rect.map(Math.round); warp0 = warpFromParams('edit.transform.warp', t.params, rect); smartTail = t; } catch (e){ warp0 = null; rect = null; }
    } else if (t && t.type === 'persp' && (!rect || xfTail)){
      if (!rect){ rect = t.rect.slice(); quad = t.quad.map(q => q.slice()); }
      smartTail = t;
    }
  }
  if (!rect){ rect = warpBounds(L); if (!rect) return fail('Could not transform: the layer is empty'); }
  rect = rect.map(Math.round);
  // 预览文件：要搬的像素拿掉（有选区＝把选中的像素抽出来；没有＝整层藏起来）；移动的像素做成一张贴图
  const tw = rw(rect), th = rh(rect), tex = mkCanvas(tw, th), tx = tex.getContext('2d');
  let rest = null;
  if (Doc.sel && L.kind === 'raster' && window.SelMask){
    const cr = canvasRect(L), cw = rw(cr), ch = rh(cr), cov = SelMask.bytes(), W = Doc.width, H = Doc.height;
    const img = L.data.ctx.getImageData(0, 0, cw, ch), lift = new ImageData(cw, ch), rst = new ImageData(cw, ch);
    lift.data.set(img.data); rst.data.set(img.data);
    for (let i = 0; i < cw * ch; i++){
      const x = cr[0] + i % cw, y = cr[1] + ((i / cw) | 0), k = (x >= 0 && y >= 0 && x < W && y < H) ? cov[y * W + x] / 255 : 0, a = img.data[i * 4 + 3];
      lift.data[i * 4 + 3] = Math.round(a * k); rst.data[i * 4 + 3] = Math.round(a * (1 - k));
    }
    rest = mkCanvas(cw, ch); rest.getContext('2d').putImageData(rst, 0, 0);
    const lc = mkCanvas(cw, ch); lc.getContext('2d').putImageData(lift, 0, 0);
    tx.drawImage(lc, cr[0] - rect[0], cr[1] - rect[1]);
  } else if (L.kind === 'raster') tx.drawImage(L.data.canvas, L.x - rect[0], L.y - rect[1]);
  else if (smartTail) tx.drawImage(Smart.base(L, smartTail.index), -rect[0], -rect[1]);   // 智能对象改尾端那步：贴图＝那步之前
  else tx.drawImage(renderLayer(L, 1), -rect[0], -rect[1]);                  // 文字／矢量层：预览用渲染结果（transform_tool.rs preview_image 250-263）
  // enter_warp：自订网格跟着现在的框（框没动过＝恒等）
  let mesh = meshIdentity(rect, 1, 1);
  if (quad && quad.some((q, i) => Math.abs(q[0] - corners(rect)[i][0]) > 1e-9 || Math.abs(q[1] - corners(rect)[i][1]) > 1e-9)){
    const h = rectToQuad(rect, quad); if (h) mesh = meshMap(mesh, p => h(p[0], p[1]));
  }
  M = {layerId:L.id, rect, warp:warp0 || warpCustom(mesh, rect), tex, rest, drag:null, bar:null, smartTail:!!smartTail, undo:[], armed:null, hover:null,
       dirty:!!(smartTail && smartTail.type === 'persp' && quad && quad.some((q, i) => Math.abs(q[0] - smartTail.quad[i][0]) > 1e-6 || Math.abs(q[1] - smartTail.quad[i][1]) > 1e-6))};
  attach();
  buildBar();
  UI.draw();
  return {ok:true, warp:true, rect:rect.slice()};
}
/* transform_tool.rs:292 commit：恒等就什么都不做（不留历史）；否则跑 edit.transform.warp（一步历史） */
function commit(){
  if (!M) return {ok:true};
  const st = M; end();
  if (st.smartTail ? !st.dirty : warpIsIdentity(st.warp)){ UI.draw(); return {ok:true, changed:false}; }   // 智能对象接着编、没改过：不留历史
  const q = {layerId:st.layerId, rect:st.rect, warp:warpClone(st.warp), interpolation:prefInterp()};
  if (st.smartTail) q.smartTail = true;                                         // 换掉智能对象尾端那步（不叠）
  const r = CMD.run('ps.edit.transform.warp.apply', q);
  if (r && r.ok === false){ if (typeof Locks !== 'undefined' && Locks.notify) Locks.notify(r.error); console.warn(r.error); }
  UI.draw();
  return r;
}
function cancel(){ if (!M) return; end(); UI.draw(); }                        // transform_tool.rs:329
function end(){ detach(); if (M && M.bar) M.bar.remove(); M = null; if (UI.canvas) UI.canvas.style.cursor = ''; }

/* 滑鼠：变形模式开着时画布上的指标事件全归它（transform_tool.rs:387 pointer → warp_pointer） */
const toDoc = e => { const b = UI.canvas.getBoundingClientRect(); return [(e.clientX - b.left) / UI.zoom, (e.clientY - b.top) / UI.zoom]; };
const tolDoc = () => 8 / Math.max(UI.zoom, 0.01);
/* 580 warp_hit：tol 内最近的控制点 */
function warpHit(w, p, tol){
  const m = w.mesh; if (!m) return null;
  let best = null, bd = Infinity;
  m.points.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < tol && d < bd){ bd = d; best = i; } });
  return best;
}
/* 593 warp_pointer：锚点（块角）连两侧把手一起拖；预设第一次按下就变成自订网格 */
function warpPointer(kind, p){
  const w = M.warp;
  if (kind === 'down' && M.armed){                                             // PS 2020：选项栏按了拆分钮 ⇒ 在点的地方切（切完回一般拖点）
    const out = splitWarp(w, p, M.armed);
    if (out){ snap(); M.warp = out; M.dirty = true; }
    if (M.barEls) M.barEls.err.textContent = out ? '' : T('pse3.warp.noSplit');
    armSplit(null); M.drag = null;
    return;
  }
  if (kind === 'down'){
    if (!w.mesh || w.style !== 'custom') M.warp = warpCustom(warpToMesh(w, 1, 1), w.bounds);
    const i = warpHit(M.warp, p, tolDoc());
    M.drag = i === null ? null : {i, start:p.slice(), pts0:M.warp.mesh.points.map(q => q.slice()), before:{warp:warpClone(w), dirty:!!M.dirty}};
    syncBar();
    return;
  }
  const d = M.drag, m = M.warp.mesh;
  if (d && m){
    const dx = p[0] - d.start[0], dy = p[1] - d.start[1], nx = nxOf(m), ny = nyOf(m), ci = d.i % nx, cj = (d.i / nx) | 0;
    const moved = [d.i];
    if (ci % 3 === 0 && cj % 3 === 0) for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]){
      const a = ci + di, b = cj + dj;
      if (a >= 0 && b >= 0 && a < nx && b < ny) moved.push(b * nx + a);
    }
    for (const k of moved) m.points[k] = [d.pts0[k][0] + dx, d.pts0[k][1] + dy];
    if ((dx || dy) && d.before){ M.undo.push(d.before); d.before = null; }      // 这一拖＝变形模式里的一步（Ctrl+Z 退）
    if (dx || dy) M.dirty = true;
  }
  if (kind === 'up') M.drag = null;
}
function onPointer(e){
  if (!M || !window.UI || !UI.canvas) return;
  const cv = UI.canvas, onCanvas = e.target === cv;
  if (e.type === 'pointerdown'){
    if (!onCanvas || e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch(_){}
    warpPointer('down', toDoc(e)); UI.draw();
  } else if (e.type === 'pointermove'){
    if (!M.drag && !onCanvas) return;
    e.stopPropagation();
    const p = toDoc(e);
    if (M.drag){ warpPointer('move', p); UI.draw(); }
    else if (M.armed){ M.hover = p; cv.style.cursor = 'crosshair'; UI.draw(); }   // 拆分钮按着：拆分线跟着游标预览
    else cv.style.cursor = (M.warp.style !== 'custom' || warpHit(M.warp, p, tolDoc()) !== null) ? 'crosshair' : 'default';   // 645 cursor
  } else if (e.type === 'pointerup' || e.type === 'pointercancel'){
    if (!M.drag && !onCanvas) return;
    e.stopPropagation();
    if (M.drag){ warpPointer('up', toDoc(e)); UI.draw(); }
  } else if (e.type === 'dblclick' && onCanvas){ e.stopPropagation(); }
}
/* 键盘：Enter 确定、Esc 取消（选项列的栏位里按也一样）；Ctrl+Z 在模式里＝取消变形（不去退文件的历史） */
function onKey(e){
  if (!M || (PE.dialog && PE.dialog.cur)) return;
  const t = e.target, inBar = !!(M.bar && t && M.bar.contains(t));
  if (!inBar && t && (/^(input|select|textarea)$/i.test(t.tagName) || t.isContentEditable)) return;
  if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); if (inBar && t.tagName === 'INPUT' && t.type === 'number') t.dispatchEvent(new Event('change')); commit(); }
  else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); if (M.armed) armSplit(null); else cancel(); }   // 拆分钮按着：Esc 先放掉拆分
  else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')){ e.preventDefault(); e.stopPropagation();   // PS：变形模式里 Ctrl+Z＝退上一下（拖点／拆分／换样式）；退到底再按＝取消变形
    if (M.drag) return;
    const u = M.undo.pop(); if (!u){ cancel(); return; }
    M.warp = u.warp; M.dirty = u.dirty; armSplit(null); syncBar(); UI.draw(); }
}
const EVTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'dblclick'];
function attach(){
  EVTS.forEach(t => window.addEventListener(t, onPointer, true));
  window.addEventListener('keydown', onKey, true);
  if (!UI.overlays.includes(drawOverlay)) UI.overlays.push(drawOverlay);
}
function detach(){
  EVTS.forEach(t => window.removeEventListener(t, onPointer, true));
  window.removeEventListener('keydown', onKey, true);
  const i = UI.overlays.indexOf(drawOverlay); if (i >= 0) UI.overlays.splice(i, 1);
}
window.__pse3Cancel = window.__pse3Cancel || [];
window.__pse3Cancel.push(() => cancel());

/* 叠画（712 draw_warp）：搬动的像素拿掉后的文件、变形后的贴图（32×32 细网格贴图）、控制网格（块边界实线、三等分细线）、锚点方块／把手圆点 */
function texTri(ctx, img, s0, s1, s2, d0, d1, d2){
  const ax = s1[0] - s0[0], ay = s1[1] - s0[1], bx = s2[0] - s0[0], by = s2[1] - s0[1], det = ax * by - bx * ay;
  if (Math.abs(det) < 1e-12) return;
  const cx = d1[0] - d0[0], cy = d1[1] - d0[1], ex = d2[0] - d0[0], ey = d2[1] - d0[1];
  const m00 = (cx * by - ex * ay) / det, m01 = (ex * ax - cx * bx) / det, m10 = (cy * by - ey * ay) / det, m11 = (ey * ax - cy * bx) / det;
  const tx = d0[0] - m00 * s0[0] - m01 * s0[1], ty = d0[1] - m10 * s0[0] - m11 * s0[1];
  // 剪裁三角形往外撑一点点，免得相邻三角形之间露缝
  const g = [(d0[0] + d1[0] + d2[0]) / 3, (d0[1] + d1[1] + d2[1]) / 3];
  const grow = p => { const dx = p[0] - g[0], dy = p[1] - g[1], l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * 0.6, p[1] + dy / l * 0.6]; };
  const q0 = grow(d0), q1 = grow(d1), q2 = grow(d2);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.closePath(); ctx.clip();
  ctx.setTransform(m00, m10, m01, m11, tx, ty);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}
function drawOverlay(ctx, s){
  if (!M) return;
  const L = Doc.byId(M.layerId); if (!L){ cancel(); return; }
  // 放大模式 ctx.canvas 是叠画代理的假物件 ⇒ 底图交给 UI.redrawBase（ui.js）
  if (M.rest){ const keep = L.data; L.data = {canvas:M.rest, ctx:M.rest.getContext('2d')}; try { UI.redrawBase(ctx, s); } finally { L.data = keep; } }
  else { const vis = L.visible; L.visible = false; try { UI.redrawBase(ctx, s); } finally { L.visible = vis; } }
  const dpr = s / UI.zoom, r = M.rect, w = M.warp, f = warpMapper(w), n = 32;
  if (L.visible){
    const V = [], tw = M.tex.width, th = M.tex.height;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++){
      const u = i / n, v = j / n, q = f(r[0] + u * rw(r), r[1] + v * rh(r));
      V.push({d:[q[0] * s, q[1] * s], t:[u * tw, v * th]});
    }
    ctx.save(); ctx.globalAlpha = L.opacity * (L.fillOpacity === undefined ? 1 : L.fillOpacity);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++){
      const a = j * (n + 1) + i, A = V[a], B = V[a + 1], C = V[a + n + 2], D = V[a + n + 1];
      texTri(ctx, M.tex, A.t, B.t, C.t, A.d, B.d, C.d);
      texTri(ctx, M.tex, A.t, C.t, D.t, A.d, C.d, D.d);
    }
    ctx.restore();
  }
  const m = warpToMesh(w, 1, 1), scr = p => [p[0] * s, p[1] * s];
  const curve = (fu, fv) => { ctx.beginPath(); for (let k = 0; k <= 40; k++){ const t = k / 40, p = scr(meshEval(m, fu === null ? t : fu, fv === null ? t : fv)); k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); } ctx.stroke(); };
  ctx.save();
  const lines = (knots, along) => knots.forEach((k0, idx) => {
    if (idx === knots.length - 1) return;
    const k1 = knots[idx + 1];
    ctx.strokeStyle = 'rgba(47,140,255,.7)'; ctx.lineWidth = 0.75 * dpr;
    for (const third of [1, 2]){ const k = k0 + (k1 - k0) * third / 3; along ? curve(k, null) : curve(null, k); }
    ctx.strokeStyle = ACCENT; ctx.lineWidth = dpr;
    if (idx === 0) along ? curve(k0, null) : curve(null, k0);
    along ? curve(k1, null) : curve(null, k1);
  });
  lines(m.us, true); lines(m.vs, false);
  if (M.armed && M.hover && M.armed !== 'remove'){                             // 拆分预览：游标所在的曲面参数线（虚线）
    const [hs, ht] = meshParamAt(m, M.hover);
    ctx.save(); ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.strokeStyle = ACCENT; ctx.lineWidth = dpr;
    if (M.armed !== 'horizontal') curve(hs, null);
    if (M.armed !== 'vertical') curve(null, ht);
    ctx.restore();
  }
  if (w.style === 'custom'){                                                   // 预设从选项列改，不露控制点（766-768）
    const nx = nxOf(m), ny = nyOf(m), P = (i, j) => scr(m.points[j * nx + i]);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
      const p = P(i, j), anchor = i % 3 === 0 && j % 3 === 0, handle = (i % 3 === 0) !== (j % 3 === 0);
      if (anchor){
        const hw = 3.5 * dpr; ctx.fillStyle = '#fff'; ctx.fillRect(p[0] - hw, p[1] - hw, 2 * hw, 2 * hw);
        ctx.strokeStyle = ACCENT; ctx.lineWidth = dpr; ctx.strokeRect(p[0] - hw + dpr / 2, p[1] - hw + dpr / 2, 2 * hw - dpr, 2 * hw - dpr);
      } else if (handle){
        const [ai, aj] = i % 3 === 0 ? [i, j % 3 === 1 ? j - 1 : j + 1] : [i % 3 === 1 ? i - 1 : i + 1, j];   // 把手连到同列／同栏最近的锚点
        const a = P(ai, aj);
        ctx.strokeStyle = ACCENT; ctx.lineWidth = dpr; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p[0], p[1], 3.5 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else { ctx.fillStyle = ACCENT; ctx.beginPath(); ctx.arc(p[0], p[1], 2.5 * dpr, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  ctx.restore();
}

/* 选项列（893 warp_options_bar）：变形：[样式] ｜ 预设：垂直 ☐ 弯曲 H V ｜ 自订：拆分 交叉／垂直／水平／移去 ｜ 切换自由变换 ⊘ ✓ */
function ensureStyle(){
  if (document.getElementById('pse3-warp')) return;
  const st = document.createElement('style'); st.id = 'pse3-warp';
  st.textContent = `
.pse3-warp-bar{position:fixed;z-index:8500;display:flex;align-items:center;gap:6px;background:#2b2f36;color:#e6e8ec;border:1px solid #444a55;border-radius:5px;padding:4px 8px;font:12px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)}
.pse3-warp-bar .lb{color:#9aa3b0}
.pse3-warp-bar select,.pse3-warp-bar input[type=number]{background:#1d2026;color:#e6e8ec;border:1px solid #444a55;border-radius:3px;padding:2px 4px}
.pse3-warp-bar input[type=number]{width:56px}
.pse3-warp-bar button{background:#3a404a;color:#e6e8ec;border:1px solid #555c68;border-radius:3px;padding:2px 8px;cursor:pointer}
.pse3-warp-bar button.pri{background:#2f7fd8;border-color:#2f7fd8}
.pse3-warp-bar .grp{display:flex;align-items:center;gap:5px}
.pse3-warp-bar .grp.hide{display:none}
.pse3-warp-bar .sep{width:1px;height:18px;background:#555c68}
.pse3-warp-bar .err{color:#ff8d7a;max-width:260px}`;
  document.head.appendChild(st);
}
function buildBar(){
  ensureStyle();
  const bar = document.createElement('div'); bar.className = 'pse3-warp-bar'; bar.dataset.warpBar = '1';
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const label = k => el('span', 'lb', T(k));
  bar.appendChild(label('pse3.warp.warp'));
  const sel = el('select'); sel.dataset.k = 'style';
  STYLES.forEach(s => { const o = el('option', null, T('pse3.warp.style.' + s)); o.value = s; sel.appendChild(o); });
  bar.appendChild(sel);
  const pre = el('span', 'grp'); pre.dataset.grp = 'preset';
  const vl = el('label'); vl.style.cssText = 'display:flex;align-items:center;gap:3px';
  const vc = el('input'); vc.type = 'checkbox'; vc.dataset.k = 'vertical'; vl.appendChild(vc); vl.appendChild(el('span', null, T('pse3.warp.vertical')));
  pre.appendChild(vl);
  const nums = {};
  [['bend', 'pse3.warp.bend'], ['hDistort', 'pse3.warp.h'], ['vDistort', 'pse3.warp.v']].forEach(([k, key]) => {
    pre.appendChild(label(key));
    const i = el('input'); i.type = 'number'; i.min = -100; i.max = 100; i.step = 1; i.dataset.k = k; nums[k] = i;
    pre.appendChild(i); pre.appendChild(el('span', 'lb', '%'));
  });
  bar.appendChild(pre);
  const cus = el('span', 'grp'); cus.dataset.grp = 'custom';
  cus.appendChild(el('span', 'sep')); cus.appendChild(label('pse3.warp.split'));
  // PS 2020：拆分钮是「模式」——按下后游标在图上预览拆分线，点哪里就在哪里切（切完自动放开）；再按一次／Esc＝放掉
  const splitBtns = {};
  [['splitWarpCrosswise', 'pse3.warp.crosswise', 'crosswise'], ['splitWarpVertically', 'pse3.warp.splitV', 'vertical'], ['splitWarpHorizontally', 'pse3.warp.splitH', 'horizontal'], ['removeWarpSplit', 'pse3.warp.remove', 'remove']].forEach(([id, key, how]) => {
    const b = el('button', null, T(key)); b.type = 'button'; b.dataset.act = id; b.dataset.split = how; b.title = T(key + 'Tip') + T('pse3.warp.clickTip');
    b.onclick = () => { err.textContent = ''; armSplit(M && M.armed === how ? null : how); };
    cus.appendChild(b); splitBtns[how] = b;
  });
  // 网格（PS 2020「网格：默认／3×3／4×4／5×5」）：照现在的形状重配成 n×n 块
  cus.appendChild(label('pse3.warp.grid'));
  const grid = el('select'); grid.dataset.k = 'grid';
  [['1', 'pse3.warp.gridDefault'], ['3', '3 × 3'], ['4', '4 × 4'], ['5', '5 × 5'], ['custom', 'pse3.warp.gridCustom']].forEach(([v, k]) => { const o = el('option', null, /^\d/.test(k) ? k : T(k)); o.value = v; if (v === 'custom') o.disabled = true; grid.appendChild(o); });
  grid.onchange = () => { if (!M || grid.value === 'custom') return; const n = +grid.value; setGrid(n); };
  cus.appendChild(grid);
  bar.appendChild(cus);
  const err = el('span', 'err'); bar.appendChild(err);
  bar.appendChild(el('span', 'sep'));
  const btn = (txt, key, act, fn, pri) => { const b = el('button', pri ? 'pri' : null, txt); b.type = 'button'; b.title = T(key); b.dataset.act = act; b.onclick = fn; bar.appendChild(b); return b; };
  btn('⊞', 'pse3.warp.toggle', 'toggle', () => { cancel(); CMD.run('ps.edit.freeTransform'); });   // 959 leave_warp：回自由变换框（变形的改动丢掉）
  btn('⊘', 'pse3.warp.cancel', 'cancel', () => cancel());
  btn('✓', 'pse3.warp.commit', 'commit', () => commit(), true);
  // 改样式（905-909）：自订＝现在的网格；无＝恒等网格；预设＝新的预设（从预设换来保留弯曲，否则 50）
  sel.onchange = () => {
    if (!M) return;
    const w = M.warp, b = M.rect.slice(), s = sel.value;
    snap();
    M.warp = s === 'custom' ? warpCustom(warpToMesh(w, 1, 1), b) : s === 'none' ? warpCustom(meshIdentity(b, 1, 1), b) : warpPreset(s, isPreset(w.style) ? w.bend : 50, b);
    M.dirty = true; syncBar(); UI.draw();
  };
  vc.onchange = () => { if (M && isPreset(M.warp.style)){ M.warp.vertical = vc.checked; M.dirty = true; UI.draw(); } };
  for (const k in nums){
    const i = nums[k], upd = () => { if (!M || !isPreset(M.warp.style)) return; const v = parseFloat(i.value); if (isFinite(v)){ M.warp[k] = clamp(v, -100, 100); M.dirty = true; UI.draw(); } };
    i.addEventListener('input', upd); i.addEventListener('change', upd);
  }
  bar.addEventListener('pointerdown', e => e.stopPropagation());
  document.body.appendChild(bar);
  const host = (UI.wrap || UI.canvas).getBoundingClientRect();
  bar.style.left = Math.round(host.left + 8) + 'px'; bar.style.top = Math.round(host.top + 8) + 'px';
  M.bar = bar; M.barEls = {sel, vc, nums, pre, cus, err, splitBtns, grid};
  syncBar();
}
function syncBar(){
  if (!M || !M.barEls) return;
  const e = M.barEls, w = M.warp, pre = isPreset(w.style);
  e.sel.value = w.style;
  e.pre.classList.toggle('hide', !pre); e.cus.classList.toggle('hide', pre);
  if (pre){ e.vc.checked = !!w.vertical; e.nums.bend.value = w.bend; e.nums.hDistort.value = w.hDistort; e.nums.vDistort.value = w.vDistort; }
  if (e.splitBtns) for (const k in e.splitBtns) e.splitBtns[k].classList.toggle('pri', M.armed === k);
  if (e.grid){ const m = w.mesh, n = m ? m.us.length - 1 : 1, even = k => k.every((v, i) => Math.abs(v - i / (k.length - 1)) < 1e-9);
    e.grid.value = (!m || (m.vs.length - 1 === n && even(m.us) && even(m.vs) && [1, 3, 4, 5].includes(n))) ? String(n) : 'custom'; }
}
/* 变形模式里的一步（给 Ctrl+Z 退）：记下改之前的变形 */
function snap(){ if (M) M.undo.push({warp:warpClone(M.warp), dirty:!!M.dirty}); }
/* 拆分钮的模式：how＝crosswise|vertical|horizontal|remove|null（放掉） */
function armSplit(how){
  if (!M) return;
  M.armed = how || null; if (!how) M.hover = null;
  syncBar(); if (window.UI) UI.draw();
}
/* 网格：照现在的形状（预设先化成网格）在 n×n 均分的块上重配（warp.rs:321 fit）；恒等网格换完还是恒等 */
function setGrid(n){
  if (!M) return {ok:false, error:'not in warp mode'};
  n = clamp(Math.floor(n) || 1, 1, 64);
  const w = M.warp, f = warpMapper(w), k = []; for (let i = 0; i <= n; i++) k.push(i / n);
  snap();
  M.warp = warpCustom(meshFit((s, t) => { const p = boxPoint(w, s, t); return f(p[0], p[1]); }, k.slice(), k.slice()), w.bounds);
  if (!warpIsIdentity(M.warp)) M.dirty = true;
  syncBar(); if (window.UI) UI.draw();
  return {ok:true, warp:warpClone(M.warp)};
}

/* ═══════════ 登记命令 ═══════════ */
const hasParams = p => p && Object.keys(p).some(k => k !== 'dialog');
const P = '{layerId?, rect?:[x0,y0,x1,y1]（变形的框；缺省＝该层内容外框 ∩ 选区外框）, style:"custom|none|arc|arcLower|arcUpper|arch|bulge|shellLower|shellUpper|flag|wave|fish|rise|fisheye|inflate|squeeze|twist", '
  + 'bend:%=50（-100..100）, hDistort:%=0, vDistort:%=0, vertical:false, mesh?:{us:[0,…,1], vs:[0,…,1], points:[[x,y]…]}（(3·栏+1)×(3·列+1) 个控制点、逐列、文件坐标）, grid?:[栏,列], '
  + 'warp?:{style, bend, hDistort, vDistort, vertical, bounds:[x0,y0,x1,y1], mesh?}（完整的变形物件，拆分命令回的就是它）, interpolation:"bicubic|bilinear|nearest"=首选项「图像插值」}';
CMD.reg('ps.edit.transform.warp', {i18n:'', params:'{} ＝进互动变形模式（4×4 贝兹网格：拖锚点连把手、拖把手；选项列选样式／弯曲／水平垂直扭曲、拆分；Enter 确定＝一步历史、Esc 取消）；'
  + '有参数 ＝ 直接变形（转给 ps.edit.transform.warp.apply）：' + P},
  p => hasParams(p) ? CMD.run('ps.edit.transform.warp.apply', p) : begin());
CMD.reg('ps.edit.transform.warp.apply', {i18n:'', undoable:true, params:P + ' 变形引擎（warp_cmds.rs edit.transform.warp）：像素层重采样；有选区只变选中的像素、选区轮廓跟着变；文字／矢量层要先栅格化（报错）；恒等变形不留历史 → {ok, layerId, changed, rect}'},
  p => apply(p, 'edit.transform.warp'));
/* 变换选区 ▸ 变形（PS：选择 ▸ 变换选区 之后 编辑 ▸ 变换 ▸ 变形／右键「变形」）：只变选区遮罩、不动像素；同一套变形网格与映射（warpMapper），遮罩双线性重采样（warpSelection） */
function selWarp(p, C){
  if (!Doc.sel || !window.SelMask) return {error:`${C}: no selection`};
  let rect, w;
  try {
    rect = (Array.isArray(p.rect) && p.rect.length === 4) ? p.rect.map(v => Math.round(Number(v) || 0)) : selRect();
    if (!rect || !(rect[2] > rect[0] && rect[3] > rect[1])) throw new Error(`${C}: nothing to warp`);
    w = warpFromParams(C, p, rect);
  } catch (e){ return {error:e.message}; }
  return {rect, w};
}
PE.selWarp = (p, C) => { const r = selWarp(p, C || 'select.transformSelection.warp'); if (r.error) return r; if (warpIsIdentity(r.w)) return {changed:false, rect:r.rect}; warpSelection(warpMapper(r.w)); return {changed:true, rect:r.rect}; };
CMD.reg('ps.select.transformSelection.warp', {i18n:'', undoable:true, params:P.replace('{layerId?, rect?:[x0,y0,x1,y1]（变形的框；缺省＝该层内容外框 ∩ 选区外框）', '{rect?:[x0,y0,x1,y1]（变形的框；缺省＝选区外框）')
  + ' 变换选区 ▸ 变形：照变形样式／网格只变形选区的轮廓（遮罩双线性重采样），像素不动；跑出画布的部分切掉；恒等变形不留历史 → {ok, changed, rect, bounds:[x,y,w,h]|null}'}, p => {
  const C = 'select.transformSelection.warp', r = PE.selWarp(p, C);
  if (r.error) return fail(r.error);
  if (!r.changed){ History.past.pop(); return {ok:true, changed:false}; }      // 同 warp.apply：恒等不留一步空的 Ctrl+Z
  return {ok:true, changed:true, rect:r.rect, bounds:Doc.sel ? [Doc.sel.x, Doc.sel.y, Doc.sel.w, Doc.sel.h] : null};
});
CMD.reg('ps.select.transformSelection.warp.dialog', {i18n:'', undoable:false,
  params:'{} 打开「变换选区：变形」对话框（样式、弯曲 %、水平／垂直扭曲 %、垂直方向），改的同时画布上预览选区；确定＝跑 ps.select.transformSelection.warp（一步历史），取消＝选区回原样。没有选区＝不开'}, () => {
  if (!Doc.sel) return fail('no selection');
  const orig = Doc.sel, R = {style:'arc', bend:50, hDistort:0, vDistort:0, vertical:false};
  const preview = () => { Doc.sel = orig; const r = PE.selWarp(R); if (window.UI) UI.draw(); return r; };
  const L3w = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, en:c}), tr = o => o[(window.Lang && Lang.cur) || 'zh-Hans'] || o.en;
  const back = document.createElement('div'); back.className = 'pswarpsel-back';
  back.style.cssText = 'position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.25)';
  const box = document.createElement('div'); box.id = 'warpSelDlg';
  box.style.cssText = 'background:#2a2d33;color:#e8eaed;border:1px solid #4a4f57;border-radius:6px;padding:14px 16px;font:13px sans-serif;min-width:300px;box-shadow:0 8px 24px rgba(0,0,0,.45)';
  box.innerHTML = `<div style="font-weight:bold;margin-bottom:10px">${tr(L3w('變形選取範圍：彎曲', '变换选区：变形', 'Transform Selection: Warp'))}</div>`;
  const rowOf = (label, input) => { const r = document.createElement('label'); r.style.cssText = 'display:flex;justify-content:space-between;gap:10px;margin:6px 0;align-items:center'; const s = document.createElement('span'); s.textContent = tr(label); r.appendChild(s); r.appendChild(input); box.appendChild(r); return input; };
  const sel = document.createElement('select'); sel.dataset.k = 'style';
  STYLES.filter(s => s !== 'none' && s !== 'custom').forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = T('pse3.warp.style.' + s); sel.appendChild(o); });
  sel.value = R.style; rowOf(L3w('樣式：', '样式：', 'Style:'), sel);
  const num = (k, label) => { const n = document.createElement('input'); n.type = 'number'; n.min = -100; n.max = 100; n.step = 1; n.value = R[k]; n.style.width = '70px'; n.dataset.k = k; rowOf(label, n); return n; };
  const nb = num('bend', L3w('彎曲 (%)：', '弯曲 (%)：', 'Bend (%):')), nh = num('hDistort', L3w('水平扭曲 (%)：', '水平扭曲 (%)：', 'Horizontal Distortion (%):')), nv = num('vDistort', L3w('垂直扭曲 (%)：', '垂直扭曲 (%)：', 'Vertical Distortion (%):'));
  const vt = document.createElement('input'); vt.type = 'checkbox'; vt.dataset.k = 'vertical'; rowOf(L3w('垂直', '垂直', 'Vertical'), vt);
  const err = document.createElement('div'); err.style.cssText = 'color:#ff8080;min-height:16px;font-size:12px'; box.appendChild(err);
  const read = () => { R.style = sel.value; R.bend = +nb.value || 0; R.hDistort = +nh.value || 0; R.vDistort = +nv.value || 0; R.vertical = vt.checked; const r = preview(); err.textContent = r.error || ''; };
  [sel, nb, nh, nv, vt].forEach(x => { x.oninput = read; x.onchange = read; });
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:10px';
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const cancel = () => { Doc.sel = orig; close(); if (window.UI) UI.draw(); };
  const ok = () => { Doc.sel = orig; close(); const r = CMD.run('ps.select.transformSelection.warp', Object.assign({}, R)); if (r && r.ok === false) console.warn('[warp selection]', r.error); };   // 先收回预览，历史快照才是原选区
  const b1 = document.createElement('button'); b1.textContent = tr(L3w('取消', '取消', 'Cancel')); b1.dataset.act = 'cancel'; b1.onclick = cancel;
  const b2 = document.createElement('button'); b2.textContent = tr(L3w('確定', '确定', 'OK')); b2.dataset.act = 'ok'; b2.onclick = ok;
  bar.appendChild(b1); bar.appendChild(b2); box.appendChild(bar);
  const onKey = e => { if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); cancel(); } else if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); ok(); } };
  document.addEventListener('keydown', onKey, true);
  back.appendChild(box); document.body.appendChild(back);
  read();
  return {ok:true, dialog:'ps.select.transformSelection.warp'};
});
const S = '{warp:{…}（正在编辑的变形；回拆好的）| style／mesh（同 ps.edit.transform.warp）, rect?:[x0,y0,x1,y1]=[0,0,1,1], at?:[x,y]（文件坐标；缺省＝所在那块的中间）} → {ok, warp}（不进历史）；'
  + '变形模式开着、没给 warp ⇒ 拆目前的网格（画面即时更新）；不在变形模式又没给 warp ⇒ 改当前智能对象存的变形（{layerId?}；没变形＝在内容外框上新建、尾端是扭曲透视＝先化成网格；一步历史 → {layer, warp}），不是智能对象＝报错（warp_cmds.rs:275-311）';
for (const [id, how, zh] of [['splitWarpCrosswise', 'crosswise', '交叉拆分变形'], ['splitWarpHorizontally', 'horizontal', '水平拆分变形'], ['splitWarpVertically', 'vertical', '垂直拆分变形'], ['removeWarpSplit', 'remove', '移去变形拆分']]){
  const cmd = 'edit.transform.' + id;
  CMD.reg('ps.edit.transform.' + id, {i18n:'', params:`${zh}：` + S}, p => {
    p = p || {};
    if (M && p.warp === undefined){                                            // menus.rs:375-383 → transform_tool.rs:631 split
      const out = splitWarp(M.warp, parseAt(p), how);
      if (!out) return fail(`${cmd}: nothing to split or remove there`);
      snap(); M.warp = out; M.dirty = true; syncBar(); if (window.UI) UI.draw();
      return {ok:true, warp:warpClone(out)};
    }
    return splitCmd(p, cmd, how);
  });
}

/* 给测试／agent：几何函数与模式状态 */
PE.warp = {
  state: () => M ? {layerId:M.layerId, rect:M.rect.slice(), warp:warpClone(M.warp), dragging:!!M.drag, smartTail:!!M.smartTail, dirty:!!M.dirty, armed:M.armed || null} : null,
  begin, commit, cancel, setGrid, armSplit,
  map: (w, x, y) => warpMapper(typeof w === 'object' ? parseWarp(w) : w)(x, y),
  isIdentity: w => warpIsIdentity(parseWarp(w)),
  preset: (style, bend, bounds) => warpPreset(parseStyle(style), bend, bounds),
};

/* ═══════════ 三语 ═══════════ */
const NAMES = {
  'zh-Hant':{none:'無', custom:'自訂', arc:'弧形', arcLower:'下弧形', arcUpper:'上弧形', arch:'拱形', bulge:'凸出', shellLower:'下凹殼形', shellUpper:'上凸殼形',
    flag:'旗形', wave:'波形', fish:'魚形', rise:'上升', fisheye:'魚眼', inflate:'膨脹', squeeze:'擠壓', twist:'扭轉'},
  'zh-Hans':{none:'无', custom:'自定', arc:'扇形', arcLower:'下弧', arcUpper:'上弧', arch:'拱形', bulge:'凸起', shellLower:'贝壳', shellUpper:'花冠',
    flag:'旗帜', wave:'波浪', fish:'鱼形', rise:'增加', fisheye:'鱼眼', inflate:'膨胀', squeeze:'挤压', twist:'扭转'},
  en:{none:'None', custom:'Custom', arc:'Arc', arcLower:'Arc Lower', arcUpper:'Arc Upper', arch:'Arch', bulge:'Bulge', shellLower:'Shell Lower', shellUpper:'Shell Upper',
    flag:'Flag', wave:'Wave', fish:'Fish', rise:'Rise', fisheye:'Fisheye', inflate:'Inflate', squeeze:'Squeeze', twist:'Twist'},
};
const STR = {
  'zh-Hant':{'pse3.warp.warp':'彎曲：', 'pse3.warp.vertical':'垂直', 'pse3.warp.bend':'彎曲：', 'pse3.warp.h':'水平：', 'pse3.warp.v':'垂直：', 'pse3.warp.split':'分割：',
    'pse3.warp.crosswise':'交叉', 'pse3.warp.splitV':'垂直', 'pse3.warp.splitH':'水平', 'pse3.warp.remove':'移除',
    'pse3.warp.crosswiseTip':'交叉分割彎曲', 'pse3.warp.splitVTip':'垂直分割彎曲', 'pse3.warp.splitHTip':'水平分割彎曲', 'pse3.warp.removeTip':'移除彎曲分割',
    'pse3.warp.toggle':'在任意變形和彎曲模式之間切換', 'pse3.warp.cancel':'取消彎曲 (Esc)', 'pse3.warp.commit':'確定彎曲 (Enter)',
    'pse3.warp.grid':'網格：', 'pse3.warp.gridDefault':'預設', 'pse3.warp.gridCustom':'自訂', 'pse3.warp.clickTip':'（按下後在影像上按一下＝在那裡分割）', 'pse3.warp.noSplit':'這裡太靠近現有的分割線'},
  'zh-Hans':{'pse3.warp.warp':'变形：', 'pse3.warp.vertical':'垂直', 'pse3.warp.bend':'弯曲：', 'pse3.warp.h':'H：', 'pse3.warp.v':'V：', 'pse3.warp.split':'拆分：',
    'pse3.warp.crosswise':'交叉', 'pse3.warp.splitV':'垂直', 'pse3.warp.splitH':'水平', 'pse3.warp.remove':'移去',
    'pse3.warp.crosswiseTip':'交叉拆分变形', 'pse3.warp.splitVTip':'垂直拆分变形', 'pse3.warp.splitHTip':'水平拆分变形', 'pse3.warp.removeTip':'移去变形拆分',
    'pse3.warp.toggle':'在自由变换和变形模式之间切换', 'pse3.warp.cancel':'取消变形 (Esc)', 'pse3.warp.commit':'提交变形 (Enter)',
    'pse3.warp.grid':'网格：', 'pse3.warp.gridDefault':'默认', 'pse3.warp.gridCustom':'自定', 'pse3.warp.clickTip':'（按下后在图像上单击＝在那里拆分）', 'pse3.warp.noSplit':'这里离现有的拆分线太近'},
  en:{'pse3.warp.warp':'Warp:', 'pse3.warp.vertical':'Vertical', 'pse3.warp.bend':'Bend:', 'pse3.warp.h':'H:', 'pse3.warp.v':'V:', 'pse3.warp.split':'Split:',
    'pse3.warp.crosswise':'Crosswise', 'pse3.warp.splitV':'Vertical', 'pse3.warp.splitH':'Horizontal', 'pse3.warp.remove':'Remove',
    'pse3.warp.crosswiseTip':'Split Warp Crosswise', 'pse3.warp.splitVTip':'Split Warp Vertically', 'pse3.warp.splitHTip':'Split Warp Horizontally', 'pse3.warp.removeTip':'Remove Warp Split',
    'pse3.warp.toggle':'Switch between free transform and warp modes', 'pse3.warp.cancel':'Cancel warp (Esc)', 'pse3.warp.commit':'Commit warp (Enter)',
    'pse3.warp.grid':'Grid:', 'pse3.warp.gridDefault':'Default', 'pse3.warp.gridCustom':'Custom', 'pse3.warp.clickTip':' (then click on the image to split there)', 'pse3.warp.noSplit':'Too close to an existing split'},
};
for (const lang of Object.keys(NAMES)) for (const s of STYLES) STR[lang]['pse3.warp.style.' + s] = NAMES[lang][s];
Lang.add(STR);
})();

/* ═══════════ puppet（编辑 ▸ 操控变形／透视变形；照 photocraft 原码抄） ═══════════
   对照源（photocraft/crates/…）：
     engine/src/distort_cmds.rs        参数 puppet_params 61-84、perspective_params 86-106、interp 108-110、
                                       puppet_surface 153-160、perspective_surface 162-170、run_on_layer 233-272、
                                       deform_selected 308-325、puppet 327-336、perspective 338-362、规格 364-420
     engine/src/transform_cmds.rs      split_selected 245-269、composite_over 284-305
     algo/src/puppet.rs                build_mesh 128-242、Csr 244-331、BandChol 333-406、locate 437-454、
                                       PuppetSolver 460-740、deform／render／puppet_warp 742-771
     algo/src/perspective.rs           linked_corners／unify 46-79、straighten 106-152、PerspectiveMap 154-235、plane_point 254-263
     algo/src/warp.rs                  warp_mesh_surface 49-80、warp_triangles 82-283、warp_mesh_gray 285-311
     algo/src/transform.rs             Homography 17-98、Interp::parse 110-117
     ui-egui/src/puppet_ui.rs          互动：点网格加图钉、拖图钉、Alt 点删、选项列、Enter 确定（全档）
     ui-egui/src/perspective_ui.rs     互动：版面画平面（角会吸附）→ 变形拖角 → 拉直、Enter 确定（全档）
     ui-egui/src/distort_ui.rs         菜单路由 menu 100-123、键盘 keys 142-183、容差 tolerance 218-222
   原码对智能对象把参数存成智能滤镜（layer.smartObjects.*）——我们没有智能对象，只做像素层。 */
(function(){
'use strict';
const PE = window.PsEdit; if (!PE || PE._pse3_puppet) return; PE._pse3_puppet = true;
const T = k => Lang.t(k);

/* ═══════════ 小工具（与 ps-edit.js 同一套，那边没导出就在这里再写一份） ═══════════ */
const isNum = v => typeof v === 'number' && isFinite(v);
const fail = msg => ({ok:false, error:msg});
const c01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const Rc = {
  inter(a, b){ if (!a || !b) return null; const r = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]; return (r[2] > r[0] && r[3] > r[1]) ? r : null; },
  union(a, b){ return !a ? (b ? b.slice() : null) : !b ? a.slice() : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; },
  w: r => r[2] - r[0], h: r => r[3] - r[1],
};
const docRect = () => [0, 0, Doc.width, Doc.height];
const canvasRect = L => [L.x, L.y, L.x + L.data.canvas.width, L.y + L.data.canvas.height];
const layerOf = p => (p && (p.layerId || p.layer)) ? Doc.byId(p.layerId || p.layer) : Doc.active();
function readLayer(L){
  const r = canvasRect(L), c = L.data.canvas;
  const px = c.width && c.height ? new Uint8ClampedArray(L.data.ctx.getImageData(0, 0, c.width, c.height).data) : new Uint8ClampedArray(0);
  return {r, px};
}
/* 像素阵列里 alpha>0 的外框（Surface::content_bounds） */
function alphaBounds(px, r){
  const w = Rc.w(r), h = Rc.h(r);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++){ const o = y * w * 4; for (let x = 0; x < w; x++) if (px[o + x * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; } }
  return x1 < 0 ? null : [r[0] + x0, r[1] + y0, r[0] + x1 + 1, r[1] + y1 + 1];
}
function cropPx(px, r, c){
  const w = Rc.w(r), cw = Rc.w(c), out = new Uint8ClampedArray(cw * Rc.h(c) * 4);
  for (let y = c[1]; y < c[3]; y++){ const so = ((y - r[1]) * w + (c[0] - r[0])) * 4; out.set(px.subarray(so, so + cw * 4), (y - c[1]) * cw * 4); }
  return out;
}
/* 背景层判法（同 ps-edit.js isBg／ps-layer.js isBackground） */
function isBg(L){
  if (window.PsLayer && PsLayer.isBackground) return PsLayer.isBackground(L);
  if (!L || Doc.layers[0] !== L || L.kind !== 'raster') return false;
  if (L.isBackground !== undefined) return !!L.isBackground;
  return ['背景', 'Background', T('layer.bg')].includes(L.name);
}
/* distort_cmds.rs:214 float_background：背景层浮成普通层「图层 0」（变形会露出透明） */
function floatBackground(L){
  if (!isBg(L)) return;
  L.name = T('layer.untitled') + ' 0'; L.isBackground = false;
  if (L.locks){ L.locks.transparency = false; L.locks.position = false; }
}
/* distort_cmds.rs:222 check_locks(l, position=true)：锁像素／全锁／锁位置都挡 */
function lockedMsg(L){ const k = L && L.locks; return k && (k.all || k.pixels || k.position) ? `Could not complete your request because the layer "${L.name}" is locked` : null; }
const selBytes = () => (Doc.sel && window.SelMask) ? SelMask.bytes() : null;
/* algo/transform.rs:110 Interp::parse；distort_cmds.rs:108 缺省 bicubic */
const interpOf = s => (s === 'nearest' || s === 'nearestNeighbor') ? 'nearest' : s === 'bilinear' ? 'bilinear' : 'bicubic';
/* undoable 命令「没改东西」（原码回 changed:false、不进历史）：把 CMD.run 先推的那一步拿掉 */
const noChange = r => { History.past.pop(); return r; };

/* ═══════════ Homography（algo/transform.rs:17-98） ═══════════ */
const Hm = {
  apply(m, x, y){ const w = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]; },
  mul(a, b){ const r = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]; return r; },
  inverse(m){
    const c = [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
               m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
               m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]];
    const det = m[0] * c[0] + m[1] * c[3] + m[2] * c[6];
    return Math.abs(det) < 1e-12 ? null : c.map(v => v / det);
  },
  squareToQuad(q){                       // transform.rs:62
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
    if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1];
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null;
    const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
    return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
  },
  rectToQuad(r, q){                      // transform.rs:81
    const w = r[2] - r[0], h = r[3] - r[1]; if (!(w > 0 && h > 0)) return null;
    const s = this.squareToQuad(q); if (!s) return null;
    return this.mul(s, [1 / w, 0, -r[0] / w, 0, 1 / h, -r[1] / h, 0, 0, 1]);
  },
};

/* ═══════════ 网格重采样（algo/warp.rs） ═══════════ */
const catmullRom = t => { const t2 = t * t, t3 = t2 * t; return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2]; };
/* 表面 S = {r:[x0,y0,x1,y1] 文件坐标, px:Uint8ClampedArray straight RGBA}
   warp.rs:86 warp_triangles：每个顶点 [目的, 来源]；三角形在目的空间扫描、来源位置按重心插值，
   后面的三角形盖前面的（深度顺序）；预乘取样（最近／双线性／Catmull-Rom 双三次）。回 S 或 null（全空）。
   （原码按 tile 分格平行；分格只影响「读来源的范围」＝来源 ±3 ∩ src_rect，整张做结果一样） */
function warpTriangles(S, srcRect, verts, tris, interp){
  if (!srcRect || !tris.length) return null;                                                   // warp.rs:97
  if (verts.some(v => !isFinite(v[0][0]) || !isFinite(v[0][1]))) return null;                  // warp.rs:100
  const lim = 1 << 20;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of tris) for (const i of t){ const p = verts[i][0]; if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }
  const dst = [Math.floor(Math.max(x0, -lim)) - 1, Math.floor(Math.max(y0, -lim)) - 1, Math.ceil(Math.min(x1, lim)) + 1, Math.ceil(Math.min(y1, lim)) + 1];   // warp.rs:111
  const dw = Rc.w(dst), dh = Rc.h(dst);
  const uv = new Float64Array(dw * dh * 2).fill(NaN);                                          // 每个目的像素的来源位置（NaN＝没盖到）
  for (const tri of tris){                                                                     // warp.rs:154-179
    const [p0, s0] = verts[tri[0]], [p1, s1] = verts[tri[1]], [p2, s2] = verts[tri[2]];
    const det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    if (Math.abs(det) < 1e-12) continue;
    const bx0 = Math.max(Math.floor(Math.min(p0[0], p1[0], p2[0]) - 0.5), dst[0]);
    const by0 = Math.max(Math.floor(Math.min(p0[1], p1[1], p2[1]) - 0.5), dst[1]);
    const bx1 = Math.min(Math.ceil(Math.max(p0[0], p1[0], p2[0]) + 0.5), dst[2]);
    const by1 = Math.min(Math.ceil(Math.max(p0[1], p1[1], p2[1]) + 0.5), dst[3]);
    const eps = -1e-9;
    for (let y = by0; y < by1; y++){
      const py = y + 0.5;
      for (let x = bx0; x < bx1; x++){
        const px = x + 0.5;
        const l1 = ((px - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (py - p0[1])) / det;
        const l2 = ((p1[0] - p0[0]) * (py - p0[1]) - (px - p0[0]) * (p1[1] - p0[1])) / det;
        const l0 = 1 - l1 - l2;
        if (l0 < eps || l1 < eps || l2 < eps) continue;
        const o = ((y - dst[1]) * dw + (x - dst[0])) * 2;
        uv[o] = l0 * s0[0] + l1 * s1[0] + l2 * s2[0]; uv[o + 1] = l0 * s0[1] + l1 * s1[1] + l2 * s2[1];
      }
    }
  }
  // 来源：src_rect 那块预乘成浮点（warp.rs:195-201）；src_rect 外读成 0
  const sr = Rc.inter(srcRect, S.r); if (!sr) return null;
  const sw = Rc.w(sr), sh = Rc.h(sr), Sw = Rc.w(S.r), pre = new Float32Array(sw * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++){
    const si = ((y + sr[1] - S.r[1]) * Sw + (x + sr[0] - S.r[0])) * 4, di = (y * sw + x) * 4, a = S.px[si + 3] / 255;
    pre[di] = S.px[si] / 255 * a; pre[di + 1] = S.px[si + 1] / 255 * a; pre[di + 2] = S.px[si + 2] / 255 * a; pre[di + 3] = a;
  }
  const out = new Uint8ClampedArray(dw * dh * 4), acc = [0, 0, 0, 0];
  const add = (x, y, k) => { if (x < sr[0] || y < sr[1] || x >= sr[2] || y >= sr[3]) return; const i = ((y - sr[1]) * sw + (x - sr[0])) * 4; acc[0] += pre[i] * k; acc[1] += pre[i + 1] * k; acc[2] += pre[i + 2] * k; acc[3] += pre[i + 3] * k; };
  const snap = t => Math.abs(t - Math.round(t)) < 1e-7 ? Math.round(t) : t;                   // warp.rs:239 贴齐像素格，恒等变换才逐位相同
  let any = false;
  for (let o = 0, n = dw * dh; o < n; o++){                                                    // warp.rs:213-268
    const qu = uv[o * 2]; if (qu !== qu) continue;
    let u = qu - 0.5, v = uv[o * 2 + 1] - 0.5;
    acc[0] = acc[1] = acc[2] = acc[3] = 0;
    if (interp === 'nearest') add(Math.floor(u + 0.5), Math.floor(v + 0.5), 1);
    else if (interp === 'bilinear'){
      const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
      add(ix, iy, (1 - fx) * (1 - fy)); add(ix + 1, iy, fx * (1 - fy)); add(ix, iy + 1, (1 - fx) * fy); add(ix + 1, iy + 1, fx * fy);
    } else {
      u = snap(u); v = snap(v);
      const ix = Math.floor(u), iy = Math.floor(v), wx = catmullRom(u - ix), wy = catmullRom(v - iy);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++){ const k = wx[i] * wy[j]; if (k !== 0) add(ix - 1 + i, iy - 1 + j, k); }
    }
    const al = c01(acc[3]);
    if (al <= 1e-6) continue;                                                                  // 浮点杂讯别在透明处留颜色
    any = true;
    const b = o * 4;
    out[b] = c01(acc[0] / al) * 255; out[b + 1] = c01(acc[1] / al) * 255; out[b + 2] = c01(acc[2] / al) * 255; out[b + 3] = al * 255;
  }
  return any ? {r:dst, px:out} : null;
}
/* warp.rs:52 warp_mesh_surface：来源矩形细分成 ≤4px 的格子（每边最多 512 格），顶点往前映射，格子拆两个三角形 */
function warpMeshSurface(S, srcRect, f, interp){
  if (!srcRect) return null;
  const sw = Rc.w(srcRect), sh = Rc.h(srcRect);
  const nx = Math.min(Math.max(Math.ceil(sw / 4), 1), 512), ny = Math.min(Math.max(Math.ceil(sh / 4), 1), 512);
  const verts = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++){
    const sx = srcRect[0] + sw * i / nx, sy = srcRect[1] + sh * j / ny;
    verts.push([f(sx, sy), [sx, sy]]);
  }
  const w1 = nx + 1, tris = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){ const a = j * w1 + i; tris.push([a, a + 1, a + w1 + 1], [a, a + w1 + 1, a + w1]); }
  return warpTriangles(S, srcRect, verts, tris, interp);
}

/* ═══════════ 操控变形：网格（algo/puppet.rs:128-242） ═══════════ */
const DENSITY_CELLS = {fewer:12, normal:20, more:32};                                          // puppet.rs:66
const ALPHA_MIN = 0.05;                                                                        // puppet.rs:126
function buildMesh(S, bounds, density, expansion){
  const mesh = {verts:[], tris:[], spacing:0};
  if (!bounds) return mesh;
  const long = Math.max(Rc.w(bounds), Rc.h(bounds));
  const spacing = Math.max(long / DENSITY_CELLS[density], 2);
  const e = Math.min(Math.max(expansion, -200), 200);
  // 覆盖度画在方块格上（一块＝四分之一格或更小）
  const g = Math.max(Math.floor(spacing / 4), 1);
  const pad = Math.ceil(Math.max(e, 0)) + g;
  const area = [bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad];
  const bw = Math.floor((Rc.w(area) + g - 1) / g), bh = Math.floor((Rc.h(area) + g - 1) / g);
  let cov = new Uint8Array(bw * bh);
  const Sw = Rc.w(S.r), thr = ALPHA_MIN * 255;                                                   // alpha（0..1）> 0.05
  for (let y = bounds[1]; y < bounds[3]; y++){
    const by = Math.floor((y - area[1]) / g), so = (y - S.r[1]) * Sw;
    for (let x = bounds[0]; x < bounds[2]; x++) if (S.px[(so + x - S.r[0]) * 4 + 3] > thr) cov[by * bw + Math.floor((x - area[0]) / g)] = 1;
  }
  // 按扩展量长大／缩小（方块单位的圆形印章，puppet.rs:177-205）
  const eb = Math.round(Math.abs(e) / g);
  if (eb > 0){
    const src = cov, grow = e > 0; cov = new Uint8Array(bw * bh);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++){
      let hit = !grow;
      stamp: for (let dy = -eb; dy <= eb; dy++) for (let dx = -eb; dx <= eb; dx++){
        if (dx * dx + dy * dy > eb * eb) continue;
        const x = bx + dx, y = by + dy;
        const v = x >= 0 && y >= 0 && x < bw && y < bh && src[y * bw + x];
        if (grow && v){ hit = true; break stamp; }
        if (!grow && !v){ hit = false; break stamp; }
      }
      cov[by * bw + bx] = hit ? 1 : 0;
    }
  }
  // 碰到覆盖方块的格子，每格拆两个三角形（对角线交错）
  const ox = area[0], oy = area[1];
  const cw = Math.ceil(bw * g / spacing), ch = Math.ceil(bh * g / spacing);
  const index = new Int32Array((cw + 1) * (ch + 1)).fill(-1);
  mesh.spacing = spacing;
  const vtx = (i, j) => { const k = j * (cw + 1) + i; if (index[k] < 0){ index[k] = mesh.verts.length; mesh.verts.push([ox + i * spacing, oy + j * spacing]); } return index[k]; };
  for (let cj = 0; cj < ch; cj++) for (let ci = 0; ci < cw; ci++){
    const bx0 = Math.floor(ci * spacing / g), by0 = Math.floor(cj * spacing / g);
    const bx1 = Math.min(Math.ceil((ci + 1) * spacing / g), bw), by1 = Math.min(Math.ceil((cj + 1) * spacing / g), bh);
    let any = false;
    for (let y = by0; y < by1 && !any; y++) for (let x = bx0; x < bx1; x++) if (cov[y * bw + x]){ any = true; break; }
    if (!any) continue;
    const a = vtx(ci, cj), b = vtx(ci + 1, cj), c = vtx(ci + 1, cj + 1), d = vtx(ci, cj + 1);
    if ((ci + cj) % 2 === 0){ mesh.tris.push([a, b, c], [a, c, d]); }
    else { mesh.tris.push([a, b, d], [b, c, d]); }
  }
  return mesh;
}

/* ═══════════ 稀疏矩阵、带状 Cholesky（puppet.rs:244-406） ═══════════ */
function csrFromTriplets(n, I, J, V){
  const ord = Array.from({length:I.length}, (_, k) => k).sort((a, b) => (I[a] - I[b]) || (J[a] - J[b]));   // 稳定排序（sort_by_key）
  const rows = new Int32Array(n + 1), cols = [], vals = [];
  let li = -1, lj = -1;
  for (const k of ord){
    const i = I[k], j = J[k], v = V[k];
    if (i === li && j === lj){ vals[vals.length - 1] += v; continue; }
    li = i; lj = j; cols.push(j); vals.push(v); rows[i + 1] = cols.length;
  }
  for (let i = 0; i < n; i++) rows[i + 1] = Math.max(rows[i + 1], rows[i]);
  const diag = new Float64Array(n).fill(1);
  for (let i = 0; i < n; i++) for (let k = rows[i]; k < rows[i + 1]; k++) if (cols[k] === i && vals[k] > 0) diag[i] = vals[k];
  return {rows, cols:Int32Array.from(cols), vals:Float64Array.from(vals), diag};
}
function csrMul(A, x, out){
  for (let i = 0; i < out.length; i++){ let s = 0; for (let k = A.rows[i]; k < A.rows[i + 1]; k++) s += A.vals[k] * x[A.cols[k]]; out[i] = s; }
}
/* 雅可比预条件共轭梯度，从 x 暖启动（puppet.rs:294） */
function csrSolve(A, b, x){
  const n = b.length, r = new Float64Array(n);
  csrMul(A, x, r);
  for (let i = 0; i < n; i++) r[i] = b[i] - r[i];
  let bn = 0; for (let i = 0; i < n; i++) bn += b[i] * b[i]; bn = Math.max(Math.sqrt(bn), 1e-30);
  const z = new Float64Array(n); for (let i = 0; i < n; i++) z[i] = r[i] / A.diag[i];
  const p = Float64Array.from(z), ap = new Float64Array(n);
  let rz = 0; for (let i = 0; i < n; i++) rz += r[i] * z[i];
  const iters = Math.min(Math.max(4 * n, 50), 2000);
  for (let it = 0; it < iters; it++){
    let rn = 0; for (let i = 0; i < n; i++) rn += r[i] * r[i];
    if (Math.sqrt(rn) <= 1e-12 * bn) break;
    csrMul(A, p, ap);
    let pap = 0; for (let i = 0; i < n; i++) pap += p[i] * ap[i];
    if (Math.abs(pap) < 1e-300) break;
    const alpha = rz / pap;
    for (let i = 0; i < n; i++){ x[i] += alpha * p[i]; r[i] -= alpha * ap[i]; }
    for (let i = 0; i < n; i++) z[i] = r[i] / A.diag[i];
    let rz2 = 0; for (let i = 0; i < n; i++) rz2 += r[i] * z[i];
    const beta = rz2 / rz; rz = rz2;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }
}
/* 带状 Cholesky A = L·Lᵀ（puppet.rs:345）：带太宽或不正定回 null（改用 CG） */
function bandChol(A){
  const n = A.diag.length; let p = 0;
  for (let i = 0; i < n; i++) for (let k = A.rows[i]; k < A.rows[i + 1]; k++) p = Math.max(p, Math.abs(i - A.cols[k]));
  if (n * (p + 1) > 40000000) return null;
  const w = p + 1, l = new Float64Array(n * w);
  for (let i = 0; i < n; i++) for (let k = A.rows[i]; k < A.rows[i + 1]; k++){ const j = A.cols[k]; if (j <= i) l[i * w + (j + p - i)] = A.vals[k]; }
  for (let i = 0; i < n; i++){
    const lo = Math.max(i - p, 0);
    for (let j = lo; j <= i; j++){
      const jlo = Math.max(j - p, 0, lo);
      let s = l[i * w + (j + p - i)];
      for (let k = jlo; k < j; k++) s -= l[i * w + (k + p - i)] * l[j * w + (k + p - j)];
      if (i === j){ if (!(s > 0) || !isFinite(s)) return null; l[i * w + p] = Math.sqrt(s); }
      else l[i * w + (j + p - i)] = s / l[j * w + p];
    }
  }
  return {n, p, l};
}
function cholSolve(C, b, x){                                                                    // puppet.rs:388
  const {n, p, l} = C, w = p + 1, y = Float64Array.from(b);
  for (let i = 0; i < n; i++){ let s = y[i]; for (let k = Math.max(i - p, 0); k < i; k++) s -= l[i * w + (k + p - i)] * y[k]; y[i] = s / l[i * w + p]; }
  for (let i = n - 1; i >= 0; i--){ let s = y[i]; const e = Math.min(i + p + 1, n); for (let k = i + 1; k < e; k++) s -= l[k * w + (i + p - k)] * x[k]; x[i] = s / l[i * w + p]; }
}

/* ═══════════ ARAP 求解（puppet.rs:408-740） ═══════════ */
const dist2 = (a, b) => (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);
function cot(a, b, c){                                                                          // a 那个角的余切
  const u0 = b[0] - a[0], u1 = b[1] - a[1], v0 = c[0] - a[0], v1 = c[1] - a[1];
  const cross = Math.abs(u0 * v1 - u1 * v0);
  return cross < 1e-12 ? 0 : (u0 * v0 + u1 * v1) / cross;
}
/* puppet.rs:437 locate：图钉落在哪个三角形（重心坐标）；在网格外就绑最近的顶点 */
function locate(mesh, p){
  const X = mesh.verts;
  for (const t of mesh.tris){
    const a = X[t[0]], b = X[t[1]], c = X[t[2]];
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(det) < 1e-12) continue;
    const l1 = ((p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1])) / det;
    const l2 = ((b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1])) / det;
    const l0 = 1 - l1 - l2;
    if (l0 >= -1e-9 && l1 >= -1e-9 && l2 >= -1e-9) return {verts:t.slice(), bary:[l0, l1, l2]};
  }
  let i = 0, bd = Infinity;
  X.forEach((v, k) => { const d = dist2(v, p); if (d < bd){ bd = d; i = k; } });               // min_by：一样近取第一个
  return {verts:[i, i, i], bary:[1, 0, 0]};
}
class PuppetSolver {
  /* puppet.rs:463 new：图钉原位 pinSrc、哪几根图钉固定旋转 fixedRot */
  constructor(mesh, pinSrc, fixedRot){
    this.mesh = mesh;
    const X = mesh.verts, nv = X.length;
    this.empty = nv === 0;
    if (this.empty) return;
    this.w = mesh.tris.map(t => { const a = X[t[0]], b = X[t[1]], c = X[t[2]]; return [0.5 * cot(a, b, c), 0.5 * cot(b, c, a), 0.5 * cot(c, a, b)]; });
    this.bound = pinSrc.map(p => locate(mesh, p));
    // 连通块（三角形边上的并查集）
    const parent = Int32Array.from({length:nv}, (_, i) => i);
    const find = i => { while (parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (const t of mesh.tris) for (let k = 1; k < 3; k++){ const a = find(t[0]), b = find(t[k]); if (a !== b) parent[a] = b; }
    const pinnedRoot = new Uint8Array(nv);
    for (const b of this.bound) for (const v of b.verts) pinnedRoot[find(v)] = 1;
    this.anchored = Array.from({length:nv}, (_, v) => !pinnedRoot[find(v)]);                    // 没图钉的块原地不动
    // 固定旋转的图钉：它最近那个顶点周围的三角形
    this.pinTris = this.bound.map((b, k) => {
      if (!fixedRot[k]) return [];
      let v = b.verts[0], bd = dist2(X[v], pinSrc[k]);
      for (let q = 1; q < 3; q++){ const d = dist2(X[b.verts[q]], pinSrc[k]); if (d < bd){ bd = d; v = b.verts[q]; } }
      const out = []; mesh.tris.forEach((t, i) => { if (t.includes(v)) out.push(i); }); return out;
    });
    const I = [], J = [], V = [];
    const push = (i, j, v) => { I.push(i); J.push(j); V.push(v); };
    let diagSum = 0;
    mesh.tris.forEach((t, ti) => { const wt = this.w[ti]; for (let k = 0; k < 3; k++){ const i = t[(k + 1) % 3], j = t[(k + 2) % 3], wk = wt[k]; push(i, i, wk); push(j, j, wk); push(i, j, -wk); push(j, i, -wk); diagSum += 2 * wk; } });
    this.pinWeight = 1e4 * Math.max(diagSum / Math.max(nv, 1), 1);
    for (const b of this.bound) for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) push(b.verts[a], b.verts[c], this.pinWeight * b.bary[a] * b.bary[c]);
    this.anchored.forEach((an, v) => { if (an) push(v, v, this.pinWeight); });
    this.matrix = csrFromTriplets(nv, I, J, V);
    this.chol = bandChol(this.matrix);
  }
  /* puppet.rs:563 local：每个三角形的最佳旋转（刚性）／旋转×缩放（扭曲）／旋转×√缩放（正常）；固定旋转的图钉压过去 */
  local(v, mode, fixed){
    const X = this.mesh.verts;
    const rots = this.mesh.tris.map((t, ti) => {
      const wt = this.w[ti]; let s0 = 0, s1 = 0, s2 = 0, s3 = 0, norm = 0;
      for (let k = 0; k < 3; k++){
        const i = t[(k + 1) % 3], j = t[(k + 2) % 3];
        const d0 = v[i][0] - v[j][0], d1 = v[i][1] - v[j][1], e0 = X[i][0] - X[j][0], e1 = X[i][1] - X[j][1];
        s0 += wt[k] * d0 * e0; s1 += wt[k] * d0 * e1; s2 += wt[k] * d1 * e0; s3 += wt[k] * d1 * e1;
        norm += wt[k] * (e0 * e0 + e1 * e1);
      }
      const c = s0 + s3, sn = s2 - s1, th = Math.atan2(sn, c);
      let scale = mode === 'rigid' ? 1 : mode === 'normal' ? Math.sqrt(Math.hypot(c, sn) / Math.max(norm, 1e-12)) : Math.hypot(c, sn) / Math.max(norm, 1e-12);
      if (!(isFinite(scale) && scale > 0)) scale = 1;
      const st = Math.sin(th), ct = Math.cos(th);
      return [scale * ct, -scale * st, scale * st, scale * ct];
    });
    this.pinTris.forEach((tris, k) => {
      const deg = fixed[k];
      if (deg !== null && deg !== undefined){ const a = deg * Math.PI / 180, s = Math.sin(a), c = Math.cos(a); for (const t of tris) rots[t] = [c, -s, s, c]; }
    });
    return rots;
  }
  /* puppet.rs:606 global：每轴一次稀疏 SPD 解（带状 Cholesky，退而求其次 CG） */
  global(rots, pinDst, v){
    const nv = v.length, X = this.mesh.verts, bx = new Float64Array(nv), by = new Float64Array(nv);
    this.mesh.tris.forEach((t, ti) => {
      const wt = this.w[ti], r = rots[ti];
      for (let k = 0; k < 3; k++){
        const i = t[(k + 1) % 3], j = t[(k + 2) % 3], e0 = X[i][0] - X[j][0], e1 = X[i][1] - X[j][1];
        const re0 = r[0] * e0 + r[1] * e1, re1 = r[2] * e0 + r[3] * e1;
        bx[i] += wt[k] * re0; by[i] += wt[k] * re1; bx[j] -= wt[k] * re0; by[j] -= wt[k] * re1;
      }
    });
    this.bound.forEach((b, q) => { const d = pinDst[q]; for (let k = 0; k < 3; k++){ bx[b.verts[k]] += this.pinWeight * b.bary[k] * d[0]; by[b.verts[k]] += this.pinWeight * b.bary[k] * d[1]; } });
    this.anchored.forEach((an, i) => { if (an){ bx[i] += this.pinWeight * X[i][0]; by[i] += this.pinWeight * X[i][1]; } });
    const sx = Float64Array.from(v, p => p[0]), sy = Float64Array.from(v, p => p[1]);
    if (this.chol){ cholSolve(this.chol, bx, sx); cholSolve(this.chol, by, sy); }
    else { csrSolve(this.matrix, bx, sx); csrSolve(this.matrix, by, sy); }
    for (let i = 0; i < nv; i++) v[i] = [sx[i], sy[i]];
  }
  /* puppet.rs:654 solve：pinDst、固定旋转（度）、iterations 轮 local/global，有 init 就暖启动（原码另回每轮能量，只是监看，这里不算） */
  solve(pinDst, rotations, mode, iterations, init){
    if (this.empty) return [];
    const nv = this.mesh.verts.length, X = this.mesh.verts;
    const warm = init && init.length === nv;
    const v = warm ? init.map(p => p.slice()) : X.map(p => p.slice());
    if (!warm){
      // 从 R = I 起步；有固定旋转的图钉就按「到各图钉距离的反比」加权它们的角度（ARAP 本身转得慢）
      const rotated = [];
      this.bound.forEach((b, k) => {
        const deg = rotations[k]; if (deg === null || deg === undefined) return;
        let p0 = 0, p1 = 0; for (let q = 0; q < 3; q++){ p0 += b.bary[q] * X[b.verts[q]][0]; p1 += b.bary[q] * X[b.verts[q]][1]; }
        rotated.push([[p0, p1], deg * Math.PI / 180]);
      });
      const r = this.mesh.tris.map(t => {
        if (!rotated.length) return [1, 0, 0, 1];
        const c = [(X[t[0]][0] + X[t[1]][0] + X[t[2]][0]) / 3, (X[t[0]][1] + X[t[1]][1] + X[t[2]][1]) / 3];
        let sw = 0, sa = 0;
        for (const [p, a] of rotated){ const w = 1 / (dist2(p, c) + 1); sw += w; sa += w * a; }
        const s = Math.sin(sa / sw), co = Math.cos(sa / sw);
        return [co, -s, s, co];
      });
      this.global(r, pinDst, v);
    }
    for (let it = 0; it < iterations; it++){ const rots = this.local(v, mode, rotations); this.global(rots, pinDst, v); }
    return v;
  }
  /* puppet.rs:726 draw_order：重叠处，离深度高的图钉近的三角形画在上面 */
  drawOrder(depths, pinSrc){
    const n = this.mesh.tris.length, order = Array.from({length:n}, (_, i) => i);
    if (this.empty || depths.every(d => d === 0) || !pinSrc.length) return order;
    const X = this.mesh.verts;
    const d = order.map(t => {
      const tr = this.mesh.tris[t], c = [(X[tr[0]][0] + X[tr[1]][0] + X[tr[2]][0]) / 3, (X[tr[0]][1] + X[tr[1]][1] + X[tr[2]][1]) / 3];
      let k = 0, bd = Infinity; pinSrc.forEach((p, q) => { const e = dist2(p, c); if (e < bd){ bd = e; k = q; } });
      return depths[k] || 0;
    });
    return order.sort((a, b) => d[a] - d[b]);
  }
}
const ITERATIONS = 40;                                                                          // puppet.rs:743
/* puppet.rs:746 deform ＋ 761 render ＋ 768 puppet_warp */
function puppetDeform(S, bounds, w, iterations){
  const mesh = buildMesh(S, bounds, w.density, w.expansion);
  const src = w.pins.map(p => p.src), fixed = w.pins.map(p => p.rotate !== null && p.rotate !== undefined);
  const solver = new PuppetSolver(mesh, src, fixed);
  const v = solver.solve(w.pins.map(p => p.dst), w.pins.map(p => p.rotate === undefined ? null : p.rotate), w.mode, iterations, null);
  const order = solver.drawOrder(w.pins.map(p => p.depth || 0), src);
  return {solver, v, order};
}
function puppetRender(S, bounds, mesh, deformed, order, interp){
  const verts = deformed.map((d, i) => [d, mesh.verts[i]]);
  return warpTriangles(S, bounds, verts, order.map(t => mesh.tris[t]), interp);
}
const rem360 = r => ((r % 360) + 360) % 360;
const puppetIdentity = w => w.pins.every(p => p.src[0] === p.dst[0] && p.src[1] === p.dst[1] && (p.rotate === null || p.rotate === undefined || rem360(p.rotate) === 0));   // puppet.rs:111
/* distort_cmds.rs:154 puppet_surface（网格外的像素丢掉） */
function puppetSurface(S, w, interp){
  const b = alphaBounds(S.px, S.r);
  if (puppetIdentity(w) || !b) return S;
  const {solver, v, order} = puppetDeform(S, b, w, ITERATIONS);
  if (solver.empty) throw new Error('Could not use Puppet Warp: no opaque pixels');
  return puppetRender(S, b, solver.mesh, v, order, interp);
}

/* ═══════════ 透视变形（algo/perspective.rs） ═══════════ */
const LINK_EPS = 0.5;
const unitToQuad = q => Hm.rectToQuad([0, 0, 1, 1], q);
const near = (a, b) => Math.abs(a[0] - b[0]) <= LINK_EPS && Math.abs(a[1] - b[1]) <= LINK_EPS;
const clonePlanes = ps => ps.map(p => ({src:p.src.map(c => c.slice()), dst:p.dst.map(c => c.slice())}));
const pairIn = (g, pi, ci) => g.some(([a, b]) => a === pi && b === ci);
/* perspective.rs:47 linked_corners：来源里重合（半像素内）的角一组 */
function linkedCorners(planes){
  const groups = [];
  planes.forEach((p, pi) => p.src.forEach((c, ci) => {
    const g = groups.find(g => { const [a, b] = g[0], o = planes[a].src[b]; return Math.abs(o[0] - c[0]) <= LINK_EPS && Math.abs(o[1] - c[1]) <= LINK_EPS; });
    if (g) g.push([pi, ci]); else groups.push([[pi, ci]]);
  }));
  return groups;
}
/* perspective.rs:66 unify：连着的角来源、目的各取平均 */
function unify(planes){
  for (const g of linkedCorners(planes)){
    if (g.length < 2) continue;
    const n = g.length;
    const s = g.reduce((a, [p, c]) => [a[0] + planes[p].src[c][0] / n, a[1] + planes[p].src[c][1] / n], [0, 0]);
    const d = g.reduce((a, [p, c]) => [a[0] + planes[p].dst[c][0] / n, a[1] + planes[p].dst[c][1] / n], [0, 0]);
    for (const [p, c] of g){ planes[p].src[c] = s.slice(); planes[p].dst[c] = d.slice(); }
  }
}
/* perspective.rs:115 Straighten::parse */
function parseStraighten(s){
  const t = String(s).toLowerCase();
  return (t === 'h' || t === 'horizontal' || t === 'level') ? 'horizontal' : (t === 'v' || t === 'vertical') ? 'vertical' : (t === 'auto' || t === 'both') ? 'auto' : null;
}
/* perspective.rs:127 straighten：目的边接近水平的拉成水平、接近垂直的拉成垂直（45° 内），连着的角一起动 */
function straighten(planes, mode){
  unify(planes);
  const groups = linkedCorners(planes);
  const groupOf = (p, c) => { const i = groups.findIndex(g => pairIn(g, p, c)); return i < 0 ? 0 : i; };
  const pos = groups.map(g => planes[g[0][0]].dst[g[0][1]].slice());
  const edges = [];
  for (let p = 0; p < planes.length; p++) for (let k = 0; k < 4; k++) edges.push([groupOf(p, k), groupOf(p, (k + 1) % 4)]);
  for (const [a, b] of edges){
    const pa = pos[a], pb = pos[b], dx = Math.abs(pb[0] - pa[0]), dy = Math.abs(pb[1] - pa[1]);
    if (dy <= dx && (mode === 'horizontal' || mode === 'auto')){ const y = (pa[1] + pb[1]) / 2; pos[a][1] = y; pos[b][1] = y; }
    else if (dx < dy && (mode === 'vertical' || mode === 'auto')){ const x = (pa[0] + pb[0]) / 2; pos[a][0] = x; pos[b][0] = x; }
  }
  groups.forEach((g, i) => { for (const [pi, ci] of g) planes[pi].dst[ci] = pos[i].slice(); });
}
/* perspective.rs:82 edge_uv：(边上那一点的平面坐标, 那条边修正量的权重) */
function edgeUv(k, u, v){ return k === 0 ? [[u, 0], 1 - v] : k === 1 ? [[1, v], u] : k === 2 ? [[u, 1], v] : [[0, v], 1 - u]; }
function distToQuad(q, p){                                                                      // perspective.rs:237
  let best = Infinity;
  for (let k = 0; k < 4; k++){
    const a = q[k], b = q[(k + 1) % 4], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.min(Math.max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0), 1) : 0;
    best = Math.min(best, Math.sqrt((a[0] + t * dx - p[0]) ** 2 + (a[1] + t * dy - p[1]) ** 2));
  }
  return best;
}
/* perspective.rs:156 PerspectiveMap::new：每个平面 M_i = H_dst ∘ H_src⁻¹；共用的边记下邻居。有平面退化回 null */
function perspectiveMap(planesIn){
  if (!planesIn.length) return null;
  const planes = clonePlanes(planesIn); unify(planes);
  const maps = [];
  for (let i = 0; i < planes.length; i++){
    const p = planes[i];
    const src = unitToQuad(p.src); if (!src) return null;
    const srcInv = Hm.inverse(src); if (!srcInv) return null;
    const dst = unitToQuad(p.dst); if (!dst) return null;
    const shared = [0, 1, 2, 3].map(k => {
      const a = p.src[k], b = p.src[(k + 1) % 4];
      const j = planes.findIndex((o, j) => j !== i && [0, 1, 2, 3].some(m => { const c = o.src[m], d = o.src[(m + 1) % 4]; return (near(a, c) && near(b, d)) || (near(a, d) && near(b, c)); }));
      return j < 0 ? null : j;
    });
    maps.push({src, srcInv, dst, quad:p.src, shared});
  }
  const locateP = (x, y) => {                                                                   // perspective.rs:189
    let best = [0, Infinity, 0, 0];
    for (let i = 0; i < maps.length; i++){
      const [u, v] = Hm.apply(maps[i].srcInv, x, y);
      if (u >= -1e-9 && u <= 1 + 1e-9 && v >= -1e-9 && v <= 1 + 1e-9) return [i, u, v];
      const d = distToQuad(maps[i].quad, [x, y]);
      if (d < best[1]) best = [i, d, u, v];
    }
    return [best[0], best[2], best[3]];
  };
  return {
    /* perspective.rs:205 map：平面的单应，再加共用边的修正（两边平面对边上那点的像取平均，往对边线性淡出） */
    map(x, y){
      const [i, u, v] = locateP(x, y), pm = maps[i];
      let [ox, oy] = Hm.apply(pm.dst, u, v);
      if (!isFinite(ox) || !isFinite(oy)) return [x, y];
      const cu = c01(u), cv = c01(v);
      pm.shared.forEach((j, k) => {
        if (j === null) return;
        const [e, w] = edgeUv(k, cu, cv); if (w <= 0) return;
        const mine = Hm.apply(pm.dst, e[0], e[1]), q = Hm.apply(pm.src, e[0], e[1]), other = maps[j];
        const [ou, ov] = Hm.apply(other.srcInv, q[0], q[1]), theirs = Hm.apply(other.dst, ou, ov);
        const target = [(mine[0] + theirs[0]) / 2, (mine[1] + theirs[1]) / 2];
        ox += w * (target[0] - mine[0]); oy += w * (target[1] - mine[1]);
      });
      return [ox, oy];
    },
  };
}
const perspIdentity = planes => planes.every(p => p.src.every((a, k) => Math.abs(a[0] - p.dst[k][0]) < 1e-9 && Math.abs(a[1] - p.dst[k][1]) < 1e-9));   // perspective.rs:232
function planePoint(p, u, v, dst){                                                              // perspective.rs:255
  const q = dst ? p.dst : p.src, h = unitToQuad(q);
  return h ? Hm.apply(h, u, v) : q[0].slice();
}
/* distort_cmds.rs:163 perspective_surface */
function perspectiveSurface(S, planes, interp){
  const b = alphaBounds(S.px, S.r);
  if (perspIdentity(planes) || !b) return S;
  const m = perspectiveMap(planes); if (!m) return S;
  return warpMeshSurface(S, b, (x, y) => m.map(x, y), interp);
}
/* warp.rs:288 warp_mesh_gray：图层蒙版（我们的蒙版＝文件大小画布、alpha 是值）跟着变形，外面补默认值。
   原码 Surface 有「默认像素」；我们拿左上角那格当默认值。蒙版画布不是文件大小的就不动（回 false） */
function warpMaskGray(M, f){
  const c = M && M.data && M.data.canvas; if (!c) return false;
  if (c.width !== Doc.width || c.height !== Doc.height) return false;
  const W = c.width, H = c.height, ctx = M.data.ctx || c.getContext('2d', {willReadFrequently:true});
  const img = ctx.getImageData(0, 0, W, H), d = img.data, def = d[3];
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] !== def){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return true;
  const src = [x0, y0, x1 + 1, y1 + 1], sw = Rc.w(src), tmp = new Uint8ClampedArray(sw * Rc.h(src) * 4);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++){ const i = ((y - y0) * sw + (x - x0)) * 4; tmp[i] = d[(y * W + x) * 4 + 3]; tmp[i + 3] = 255; }
  const w = warpMeshSurface({r:src, px:tmp}, src, f, 'bilinear');
  for (let i = 0; i < d.length; i += 4){ d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = def; }
  if (w){
    const k = Rc.inter(w.r, [0, 0, W, H]), ww = Rc.w(w.r);
    if (k) for (let y = k[1]; y < k[3]; y++) for (let x = k[0]; x < k[2]; x++){
      const i = ((y - w.r[1]) * ww + (x - w.r[0])) * 4, a = w.px[i + 3] / 255;
      d[(y * W + x) * 4 + 3] = w.px[i] * a + def * (1 - a);
    }
  }
  ctx.putImageData(img, 0, 0);
  M._cache = null; M._cacheScale = 0;
  return true;
}

/* ═══════════ 有选区：只搬选中的像素（distort_cmds.rs:310 deform_selected） ═══════════ */
/* transform_cmds.rs:285 composite_over：top 用正常模式盖在 dst 上（straight alpha），dst 会长大到盖住 top */
function compositeOver(dst, top){
  const tb = top && alphaBounds(top.px, top.r); if (!tb) return dst;
  const nr = Rc.union(dst.r, tb), nw = Rc.w(nr), out = new Uint8ClampedArray(nw * Rc.h(nr) * 4), dw = Rc.w(dst.r), tw = Rc.w(top.r);
  for (let y = dst.r[1]; y < dst.r[3]; y++){ const so = (y - dst.r[1]) * dw * 4; out.set(dst.px.subarray(so, so + dw * 4), ((y - nr[1]) * nw + (dst.r[0] - nr[0])) * 4); }
  for (let y = tb[1]; y < tb[3]; y++) for (let x = tb[0]; x < tb[2]; x++){
    const ti = ((y - top.r[1]) * tw + (x - top.r[0])) * 4, di = ((y - nr[1]) * nw + (x - nr[0])) * 4;
    const ta = top.px[ti + 3] / 255, da = out[di + 3] / 255, oa = ta + da * (1 - ta);
    if (oa > 0) for (let c = 0; c < 3; c++) out[di + c] = (top.px[ti + c] * ta + out[di + c] * da * (1 - ta)) / oa;
    out[di + 3] = oa * 255;
  }
  return {r:nr, px:out};
}
function deformSelected(S, cov, f){
  if (!cov) return f(S);
  // transform_cmds.rs:245 split_selected：选中的 alpha×k 抬起来、剩下的 alpha×(1−k)
  const W = Doc.width, H = Doc.height, w = Rc.w(S.r), lifted = new Uint8ClampedArray(S.px), rest = new Uint8ClampedArray(S.px);
  for (let y = S.r[1]; y < S.r[3]; y++) for (let x = S.r[0]; x < S.r[2]; x++){
    const i = ((y - S.r[1]) * w + (x - S.r[0])) * 4 + 3, k = (x >= 0 && y >= 0 && x < W && y < H) ? cov[y * W + x] / 255 : 0, a = S.px[i];
    lifted[i] = a * k; rest[i] = a * (1 - k);
  }
  const moved = f({r:S.r, px:lifted});
  return compositeOver({r:S.r, px:rest}, moved);
}
/* 结果写回图层：新画布至少盖住文件（同 ps-edit.js transformImpl） */
function setLayerSurface(L, S){
  const b = S ? alphaBounds(S.px, S.r) : null, nr = Rc.union(docRect(), b);
  const c = document.createElement('canvas'); c.width = Rc.w(nr); c.height = Rc.h(nr);
  const x = c.getContext('2d', {willReadFrequently:true});
  if (b) x.putImageData(new ImageData(cropPx(S.px, S.r, b), Rc.w(b), Rc.h(b)), b[0] - nr[0], b[1] - nr[1]);
  L.data.canvas = c; L.data.ctx = x; L.x = nr[0]; L.y = nr[1];
  Layer.invalidate(L);
}
/* distort_cmds.rs:233 run_on_layer（moves＝true）：背景层先浮起来 → 查锁 → 要像素层 → 改 → 连着的蒙版跟着变（maskFn） */
function runOnLayer(p, label, f, maskFn){
  const L = layerOf(p); if (!L) return fail('no active layer');
  floatBackground(L);
  const m = lockedMsg(L); if (m) return fail(m);
  if (L.kind !== 'raster') return fail(`${label} needs a pixel layer (rasterize it first)`);
  const out = deformSelected(readLayer(L), selBytes(), f);
  setLayerSurface(L, out);
  if (maskFn && L.mask) maskFn(L.mask);
  return {ok:true, layer:L.id, layerId:L.id, changed:true};
}

/* ═══════════ 参数（distort_cmds.rs:61-106） ═══════════ */
const pt2 = v => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number');
function puppetParams(p){
  const pins = [];
  if (p.pins !== undefined && p.pins !== null){
    const bad = `bad \`pins\` (each {"src":[x,y],"dst":[x,y],"rotate":deg?,"depth":n?})`;
    if (!Array.isArray(p.pins)) return {error:bad};
    for (const q of p.pins){
      if (!q || typeof q !== 'object' || !pt2(q.src) || !pt2(q.dst)) return {error:bad};
      if (q.rotate !== undefined && q.rotate !== null && typeof q.rotate !== 'number') return {error:bad};
      if (q.depth !== undefined && q.depth !== null && !Number.isInteger(q.depth)) return {error:bad};
      pins.push({src:q.src.slice(), dst:q.dst.slice(), rotate:(typeof q.rotate === 'number') ? q.rotate : null, depth:q.depth || 0});
    }
  }
  if (pins.some(q => q.src.concat(q.dst).some(v => !isFinite(v)) || (q.rotate !== null && !isFinite(q.rotate)))) return {error:'pin coordinates must be finite'};
  let mode = 'normal', density = 'normal';
  if (typeof p.mode === 'string'){ mode = p.mode.toLowerCase(); if (!['rigid', 'normal', 'distort'].includes(mode)) return {error:`unknown mode "${p.mode}" (rigid|normal|distort)`}; }
  if (typeof p.density === 'string'){
    const d = p.density.toLowerCase();
    density = (d === 'fewer' || d === 'fewerpoints') ? 'fewer' : d === 'normal' ? 'normal' : (d === 'more' || d === 'morepoints') ? 'more' : null;
    if (!density) return {error:`unknown density "${p.density}" (fewer|normal|more)`};
  }
  const expansion = typeof p.expansion === 'number' ? p.expansion : 2;
  if (!isFinite(expansion) || Math.abs(expansion) > 200) return {error:'`expansion` must be -200..200 px'};
  return {warp:{pins, mode, density, expansion}};
}
function perspectiveParams(p){
  if (p.planes === undefined || p.planes === null) return {error:'pass `planes`: [{"src":[[x,y]×4],"dst":[[x,y]×4]}]'};
  const bad = 'bad `planes` (each {"src":[4×[x,y]],"dst":[4×[x,y]]})';
  if (!Array.isArray(p.planes)) return {error:bad};
  const quad = q => Array.isArray(q) && q.length === 4 && q.every(pt2);
  if (p.planes.some(q => !q || !quad(q.src) || !quad(q.dst))) return {error:bad};
  const planes = clonePlanes(p.planes);
  if (!planes.length) return {error:'`planes` is empty'};
  if (planes.some(q => q.src.concat(q.dst).some(c => !isFinite(c[0]) || !isFinite(c[1])))) return {error:'plane corners must be finite'};
  if (typeof p.straighten === 'string'){
    const m = parseStraighten(p.straighten); if (!m) return {error:`unknown straighten "${p.straighten}" (horizontal|vertical|auto)`};
    straighten(planes, m);
  }
  if (!perspectiveMap(planes)) return {error:'a plane is degenerate (its corners must form a quad)'};
  return {planes};
}
/* 原码 pins 的 JSON 写法：rotate 没有就不写、depth 0 不写（puppet.rs:81-85） */
const pinOut = q => { const o = {src:q.src.slice(), dst:q.dst.slice()}; if (q.rotate !== null && q.rotate !== undefined) o.rotate = q.rotate; if (q.depth) o.depth = q.depth; return o; };

/* ═══════════ 引擎命令 ═══════════ */
CMD.reg('ps.edit.puppetWarp.apply', {i18n:'', undoable:true,
  params:'{pins:[{src:[x,y] 图钉原位, dst:[x,y] 拖到哪, rotate?:度（固定这根图钉周围的旋转；不给＝自动）, depth?:整数（重叠时深度高的图钉附近画在上面）}…], mode:"rigid|normal|distort"="normal", density:"fewer|normal|more"="normal", '
       + 'expansion:px=2（-200..200，网格超出不透明区多少；负＝缩）, interpolation:"bicubic|bilinear|nearest"="bicubic", layerId?} 操控变形（distort_cmds.rs edit.puppetWarp）：不透明区铺三角网格、ARAP（尽量刚性）解变形再重采样；'
       + '有选区只变选中的像素；网格外的像素丢掉；文件坐标；没动的图钉＝不变（changed:false、不进历史）'}, p => {
  const pr = puppetParams(p || {}); if (pr.error) return fail(pr.error);
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (puppetIdentity(pr.warp)) return noChange({ok:true, layer:L.id, layerId:L.id, changed:false});   // distort_cmds.rs:331
  const it = interpOf(p.interpolation), t0 = performance.now();
  const r = runOnLayer(p, 'Puppet Warp', S => puppetSurface(S, pr.warp, it), null);              // 原码操控变形不动蒙版（mask＝None）
  if (r.ok !== false) r.ms = performance.now() - t0;
  return r;
});
CMD.reg('ps.edit.perspectiveWarp.apply', {i18n:'', undoable:true,
  params:'{planes:[{src:[[x,y]×4] 版面画的四边形, dst:[[x,y]×4] 变形后的四角}…]（角从左上起顺时针；来源里重合（半像素内）的角算连着、会共用位置）, straighten?:"horizontal|vertical|auto"（先把接近水平／垂直的边拉正）, '
       + 'interpolation:"bicubic|bilinear|nearest"="bicubic", layerId?} 透视变形（distort_cmds.rs edit.perspectiveWarp）：每个平面一个单应、共用的边接缝连续；有选区只变选中的像素；图层蒙版跟着变；回 {planes}（拉直后的）'}, p => {
  const pr = perspectiveParams(p || {}); if (pr.error) return fail(pr.error);
  const L = layerOf(p); if (!L) return fail('no active layer');
  const planes = pr.planes;
  if (perspIdentity(planes)) return noChange({ok:true, layer:L.id, layerId:L.id, changed:false, planes});   // distort_cmds.rs:342
  const it = interpOf(p.interpolation), map = perspectiveMap(planes);
  const r = runOnLayer(p, 'Perspective Warp', S => perspectiveSurface(S, planes, it), M => warpMaskGray(M, (x, y) => map.map(x, y)));
  if (r.ok !== false) r.planes = planes;
  return r;
});

/* ═══════════ 互动模式（ui-egui/src/distort_ui.rs ＋ puppet_ui.rs ＋ perspective_ui.rs） ═══════════ */
const ACCENT = '#2f7fd8';
let SES = null, dragging = false;
const tolerance = () => 8 / Math.max(UI.zoom || 1, 0.01);                                       // distort_ui.rs:219
function snapTexture(L){
  const c = document.createElement('canvas'); c.width = L.data.canvas.width; c.height = L.data.canvas.height;
  c.getContext('2d').drawImage(L.data.canvas, 0, 0); return c;
}
/* 起始检查（distort_ui.rs:47 active_pixels ＋ 锁） */
function beginCheck(name){
  if (window.MoveTool && MoveTool.xf) return {error:'finish Free Transform first'};
  const L = Doc.active(); if (!L) return {error:'no active layer'};
  if (L.kind !== 'raster') return {error:`needs a pixel layer or smart object (active layer is a ${L.kind} layer; rasterize it first)`};
  const m = lockedMsg(L); if (m) return {error:m};
  const S = readLayer(L), bounds = alphaBounds(S.px, S.r);
  if (!bounds) return {error:`Could not use ${name}: the layer is empty`};
  return {L, S, bounds};
}
/* 画面：原层藏起来合成一次、再把预览画在上面（distort_ui.rs:87 display_doc） */
function baseFrame(ctx, s, L){
  const vis = L.visible; L.visible = false; try { UI.redrawBase(ctx, s); } finally { L.visible = vis; }   // 放大模式 ctx.canvas 是假物件 ⇒ UI.redrawBase
  if (Doc.sel){ const {x, y, w, h} = Doc.sel; ctx.save(); ctx.setLineDash([5, 4]); ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.strokeRect(x * s + .5, y * s + .5, w * s, h * s); ctx.strokeStyle = '#000'; ctx.setLineDash([0, 4, 5, 0]); ctx.strokeRect(x * s + .5, y * s + .5, w * s, h * s); ctx.restore(); }
  return vis;
}
/* 贴图三角形：每个三角形「来源→目的」的仿射，裁成三角形贴上去（原码是 GPU 贴图网格） */
function drawTextured(ctx, s, tex, tx, ty, tris, D, R, alpha){
  ctx.save(); ctx.globalAlpha = alpha;
  for (const t of tris){
    const p0 = R[t[0]], p1 = R[t[1]], p2 = R[t[2]], q0 = D[t[0]], q1 = D[t[1]], q2 = D[t[2]];
    const u1x = p1[0] - p0[0], u1y = p1[1] - p0[1], u2x = p2[0] - p0[0], u2y = p2[1] - p0[1], det = u1x * u2y - u2x * u1y;
    if (Math.abs(det) < 1e-12) continue;
    const v1x = q1[0] - q0[0], v1y = q1[1] - q0[1], v2x = q2[0] - q0[0], v2y = q2[1] - q0[1];
    const a = (v1x * u2y - v2x * u1y) / det, c = (v2x * u1x - v1x * u2x) / det, b = (v1y * u2y - v2y * u1y) / det, d = (v2y * u1x - v1y * u2x) / det;
    const e = q0[0] - a * p0[0] - c * p0[1], f = q0[1] - b * p0[0] - d * p0[1];
    const P = [q0, q1, q2].map(q => [q[0] * s, q[1] * s]), cx = (P[0][0] + P[1][0] + P[2][0]) / 3, cy = (P[0][1] + P[1][1] + P[2][1]) / 3;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.beginPath();
    P.forEach((q, i) => { const dx = q[0] - cx, dy = q[1] - cy, l = Math.hypot(dx, dy) || 1, x = q[0] + dx / l * 0.6, y = q[1] + dy / l * 0.6; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });   // 外扩 0.6px 免接缝
    ctx.closePath(); ctx.clip();
    ctx.setTransform(s * a, s * b, s * c, s * d, s * e, s * f);
    ctx.drawImage(tex, tx, ty);
    ctx.restore();
  }
  ctx.restore();
}

/* ── 操控变形 session（puppet_ui.rs:22-111） ── */
const ROT_RING = 5;                                                                             // Alt 旋转圈半径＝5×点选容差（约 40 萤幕 px）
class PuppetSession {
  constructor(L, S, bounds, preset){
    this.kind = 'puppet'; this.layerId = L.id; this.S = S; this.bounds = bounds;
    this.warp = {pins:[], mode:'normal', density:'normal', expansion:2};                       // puppet_ui.rs:140
    if (preset) this.warp = {pins:preset.pins.map(q => ({src:q.src.slice(), dst:q.dst.slice(), rotate:q.rotate, depth:q.depth})), mode:preset.mode, density:preset.density, expansion:preset.expansion};   // 智能滤镜再编辑：带回上次的图钉与选项
    this.showMesh = true; this.selected = null; this.drag = null; this.rot = null;
    this.mesh = {verts:[], tris:[]}; this.solver = null; this.deformed = []; this.order = [];
    this.tex = snapTexture(L); this.tx = L.x; this.ty = L.y;
    this.opacity = L.opacity * (L.fillOpacity === undefined ? 1 : L.fillOpacity);
  }
  describe(){
    return {layer:this.layerId, pins:this.warp.pins.map(pinOut), mode:this.warp.mode, density:this.warp.density, expansion:this.warp.expansion,
            showMesh:this.showMesh, vertices:this.mesh.verts.length, triangles:this.mesh.tris.length, selected:this.selected};
  }
  rebuildMesh(){ this.mesh = buildMesh(this.S, this.bounds, this.warp.density, this.warp.expansion); this.rebind(); }
  /* 图钉增减、固定／放开旋转：换新的解算器 */
  rebind(){
    const src = this.warp.pins.map(p => p.src), fixed = this.warp.pins.map(p => p.rotate !== null);
    this.solver = new PuppetSolver(this.mesh, src, fixed);
    this.solve(true);
  }
  /* exact＝照引擎从头解 40 轮；拖动中＝暖启动 6 轮 */
  solve(exact){
    const sv = this.solver; if (!sv) return;
    const w = this.warp, warm = (!exact && this.deformed.length === this.mesh.verts.length) ? this.deformed : null;
    this.deformed = sv.solve(w.pins.map(p => p.dst), w.pins.map(p => p.rotate), w.mode, exact ? ITERATIONS : 6, warm);
    this.order = sv.drawOrder(w.pins.map(p => p.depth), w.pins.map(p => p.src));
  }
  pinAt(p, tol){
    let best = null, bd = Infinity;
    this.warp.pins.forEach((q, i) => { const d = Math.hypot(q.dst[0] - p[0], q.dst[1] - p[1]); if (d <= tol && d < bd){ bd = d; best = i; } });
    return best;
  }
  /* 变形后网格上的一点在原位哪里（新图钉钉在那） */
  restOf(p){
    for (let k = this.order.length - 1; k >= 0; k--){
      const tri = this.mesh.tris[this.order[k]], a = this.deformed[tri[0]], b = this.deformed[tri[1]], c = this.deformed[tri[2]];
      const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      if (Math.abs(det) < 1e-12) continue;
      const l1 = ((p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1])) / det;
      const l2 = ((b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1])) / det;
      const l0 = 1 - l1 - l2;
      if (l0 >= 0 && l1 >= 0 && l2 >= 0){ const X = this.mesh.verts, ra = X[tri[0]], rb = X[tri[1]], rc = X[tri[2]]; return [l0 * ra[0] + l1 * rb[0] + l2 * rc[0], l0 * ra[1] + l1 * rb[1] + l2 * rc[1]]; }
    }
    return null;
  }
  /* puppet_ui.rs:204 pointer */
  down(p, alt){
    const i = this.pinAt(p, tolerance());
    if (i !== null){
      if (alt){ this.warp.pins.splice(i, 1); this.selected = null; this.rebind(); }
      else { this.selected = i; this.drag = i; }
    } else if (alt){
      /* PS 2020（原码没有）：选中图钉后按住 Alt、游标放在图钉旁边（不在图钉上）拖＝绕图钉旋转（旋转变「固定」、角度跟着拖） */
      const k = this.selected, pin = k !== null ? this.warp.pins[k] : null;
      if (pin && Math.hypot(p[0] - pin.dst[0], p[1] - pin.dst[1]) <= ROT_RING * tolerance()){
        if (pin.rotate === null){ pin.rotate = this.autoAngle(k); this.rebind(); }
        this.rot = {i:k, a0:Math.atan2(p[1] - pin.dst[1], p[0] - pin.dst[0]), r0:pin.rotate};
      }
    } else {
      const src = this.restOf(p);
      if (src){ this.warp.pins.push({src, dst:p.slice(), rotate:null, depth:0}); this.selected = this.warp.pins.length - 1; this.drag = this.selected; this.rebind(); }
    }
    Bar.render();
  }
  /* 图钉现在的（自动）旋转角：它所在三角形「原位→变形后」仿射的转角（度，取整）；固定旋转从这个角起步，画面不会跳 */
  autoAngle(k){
    const b = this.solver && this.solver.bound && this.solver.bound[k], X = this.mesh.verts, D = this.deformed;
    if (!b || D.length !== X.length) return 0;
    const [i0, i1, i2] = b.verts; if (i0 === i1 && i1 === i2) return 0;
    const u1 = [X[i1][0] - X[i0][0], X[i1][1] - X[i0][1]], u2 = [X[i2][0] - X[i0][0], X[i2][1] - X[i0][1]];
    const v1 = [D[i1][0] - D[i0][0], D[i1][1] - D[i0][1]], v2 = [D[i2][0] - D[i0][0], D[i2][1] - D[i0][1]], det = u1[0] * u2[1] - u2[0] * u1[1];
    if (Math.abs(det) < 1e-12) return 0;
    const a = (v1[0] * u2[1] - v2[0] * u1[1]) / det, c = (v2[0] * u1[0] - v1[0] * u2[0]) / det, bb = (v1[1] * u2[1] - v2[1] * u1[1]) / det, d = (v2[1] * u1[0] - v1[1] * u2[0]) / det;
    return Math.round(Math.atan2(bb - c, a + d) * 180 / Math.PI) || 0;
  }
  /* PS 2020：Delete／Backspace 删选中的图钉（原码没有） */
  removeSelected(){
    if (this.selected === null || this.selected >= this.warp.pins.length) return false;
    this.warp.pins.splice(this.selected, 1); this.selected = null; this.rebind(); Bar.render();
    return true;
  }
  move(p){
    if (this.rot){ this.rotateTo(p, false); return; }
    const pin = this.drag !== null ? this.warp.pins[this.drag] : null;
    if (pin && (pin.dst[0] !== p[0] || pin.dst[1] !== p[1])){ pin.dst = p.slice(); this.solve(false); }
  }
  rotateTo(p, exact){
    const r = this.rot, pin = this.warp.pins[r.i]; if (!pin) return;
    let a = r.r0 + (Math.atan2(p[1] - pin.dst[1], p[0] - pin.dst[0]) - r.a0) * 180 / Math.PI;
    a = Math.round(((a + 540) % 360 + 360) % 360 - 180) || 0;                                   // -180..180、整数度（同 PS 选项列）
    if (a !== pin.rotate || exact){ pin.rotate = a; this.solve(exact); }
  }
  up(p){
    if (this.rot){ this.rotateTo(p, true); this.rot = null; Bar.render(); return; }
    if (this.drag === null) return;
    const pin = this.warp.pins[this.drag]; this.drag = null;
    if (pin) pin.dst = p.slice();
    this.solve(true);
  }
  /* puppet_ui.rs:248 draw */
  draw(ctx, s){
    const L = Doc.byId(this.layerId); if (!L) return;
    const vis = baseFrame(ctx, s, L), dpr = s / (UI.zoom || 1);
    if (vis && this.deformed.length) drawTextured(ctx, s, this.tex, this.tx, this.ty, this.order.map(t => this.mesh.tris[t]), this.deformed, this.mesh.verts, this.opacity);
    if (this.showMesh && this.deformed.length){
      ctx.save(); ctx.strokeStyle = 'rgba(40,40,40,0.59)'; ctx.lineWidth = 0.6 * dpr; ctx.beginPath();
      const seen = new Set();
      for (const tri of this.mesh.tris) for (let k = 0; k < 3; k++){
        const i = Math.min(tri[k], tri[(k + 1) % 3]), j = Math.max(tri[k], tri[(k + 1) % 3]), key = i * 1e6 + j;
        if (seen.has(key)) continue; seen.add(key);
        const p = this.deformed[i], q = this.deformed[j]; ctx.moveTo(p[0] * s, p[1] * s); ctx.lineTo(q[0] * s, q[1] * s);
      }
      ctx.stroke(); ctx.restore();
    }
    // 图钉：黄底黑圈，选中的中间一点黑（照 PS）
    ctx.save();
    this.warp.pins.forEach((p, i) => {
      const cx = p.dst[0] * s, cy = p.dst[1] * s;
      ctx.beginPath(); ctx.arc(cx, cy, 5.5 * dpr, 0, Math.PI * 2); ctx.fillStyle = 'rgb(255,214,10)'; ctx.fill();
      ctx.lineWidth = 1.25 * dpr; ctx.strokeStyle = '#000'; ctx.stroke();
      if (this.selected === i){
        ctx.beginPath(); ctx.arc(cx, cy, 2 * dpr, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
        if (p.rotate !== null){
          const a = p.rotate * Math.PI / 180, R = (this.rot ? ROT_RING * 8 : 18) * dpr;      // Alt 拖着转的时候画大圈（PS 的旋转圈）
          ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.lineWidth = dpr; ctx.strokeStyle = '#fff'; if (this.rot) ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
        }
      }
    });
    ctx.restore();
  }
  /* puppet_ui.rs:291 options_bar */
  bar(el){
    const w = this.warp;
    Bar.title(el, 'pse3.puppet.title');
    Bar.select(el, 'mode', 'pse3.puppet.mode', [['rigid', 'pse3.puppet.m.rigid'], ['normal', 'pse3.puppet.m.normal'], ['distort', 'pse3.puppet.m.distort']], w.mode, v => { w.mode = v; this.solve(true); });
    Bar.select(el, 'density', 'pse3.puppet.density', [['fewer', 'pse3.puppet.d.fewer'], ['normal', 'pse3.puppet.d.normal'], ['more', 'pse3.puppet.d.more']], w.density, v => { w.density = v; this.rebuildMesh(); });
    Bar.number(el, 'expansion', 'pse3.puppet.expansion', w.expansion, -50, 100, 'px', v => { w.expansion = v; this.rebuildMesh(); });
    Bar.check(el, 'showMesh', 'pse3.puppet.showMesh', this.showMesh, v => { this.showMesh = v; });
    Bar.sep(el);
    const i = this.selected;
    if (i !== null && i < w.pins.length){
      const pin = w.pins[i];
      Bar.label(el, 'pse3.puppet.pinDepth');
      Bar.button(el, '+', 'depthUp', () => { pin.depth += 1; this.solve(true); }, 'pse3.puppet.depthUp');
      Bar.button(el, '−', 'depthDown', () => { pin.depth -= 1; this.solve(true); }, 'pse3.puppet.depthDown');
      Bar.select(el, 'rotate', 'pse3.puppet.rotate', [['auto', 'pse3.puppet.r.auto'], ['fixed', 'pse3.puppet.r.fixed']], pin.rotate !== null ? 'fixed' : 'auto', v => { pin.rotate = v === 'fixed' ? this.autoAngle(i) : null; this.rebind(); Bar.render(); });
      if (pin.rotate !== null) Bar.number(el, 'angle', null, pin.rotate, -360, 360, '°', v => { pin.rotate = v; this.solve(true); });
      Bar.sep(el);
    }
    Bar.button(el, T('pse3.puppet.removeAll'), 'removeAll', () => { w.pins.length = 0; this.selected = null; this.rebind(); Bar.render(); });
    Bar.hint(el, 'pse3.puppet.hint');
    Bar.commitCancel(el, 'pse3.puppet.commit');
  }
  /* puppet_ui.rs:160 commit：没动＝直接结束；不然跑引擎命令（一步历史） */
  commit(){
    end();
    if (puppetIdentity(this.warp)) return {ok:true, committed:false};
    const p = {pins:this.warp.pins.map(pinOut), mode:this.warp.mode, density:this.warp.density, expansion:this.warp.expansion, layerId:this.layerId};
    PE._pse3PuppetLast = {cmd:'ps.edit.puppetWarp.apply', params:JSON.parse(JSON.stringify(p))};
    return runCommit('ps.edit.puppetWarp.apply', p);
  }
  /* puppet_ui.rs:171 control（{ui:{…}}） */
  control(ui){
    let remesh = false;
    if (typeof ui.mode === 'string'){ const m = ui.mode.toLowerCase(); if (!['rigid', 'normal', 'distort'].includes(m)) return fail('mode: rigid|normal|distort'); this.warp.mode = m; }
    if (typeof ui.density === 'string'){ const r = puppetParams({density:ui.density}); if (r.error) return fail('density: fewer|normal|more'); this.warp.density = r.warp.density; remesh = true; }
    if (isNum(ui.expansion)){ this.warp.expansion = Math.min(Math.max(ui.expansion, -200), 200); remesh = true; }
    if (typeof ui.showMesh === 'boolean') this.showMesh = ui.showMesh;
    /* 图钉（PS 选项列：选中图钉的旋转／深度、删图钉） */
    let rebind = false;
    if (ui.pin && typeof ui.pin === 'object'){
      const k = ui.pin.index, pin = Number.isInteger(k) ? this.warp.pins[k] : null; if (!pin) return fail('pin.index out of range');
      this.selected = k;
      if (ui.pin.rotate === null || ui.pin.rotate === 'auto'){ if (pin.rotate !== null) rebind = true; pin.rotate = null; }
      else if (isNum(ui.pin.rotate)){ if (pin.rotate === null) rebind = true; pin.rotate = Math.max(-360, Math.min(360, ui.pin.rotate)); }
      if (Number.isInteger(ui.pin.depth)) pin.depth = ui.pin.depth;
    }
    if (Number.isInteger(ui.removePin)){ if (!this.warp.pins[ui.removePin]) return fail('removePin out of range'); this.selected = ui.removePin; this.removeSelected(); }
    if (remesh) this.rebuildMesh(); else if (rebind) this.rebind(); else this.solve(true);
    Bar.render(); UI.draw();
    return Object.assign({ok:true}, this.describe());
  }
}

/* ── 透视变形 session（perspective_ui.rs:21-114） ── */
const GRID = 40;
class PerspSession {
  constructor(L, S, bounds){
    this.kind = 'perspective'; this.layerId = L.id; this.bounds = bounds;
    this.planes = []; this.mode = 'layout'; this.drag = null; this.grid = [];
    this.tex = snapTexture(L); this.tx = L.x; this.ty = L.y;
    this.opacity = L.opacity * (L.fillOpacity === undefined ? 1 : L.fillOpacity);
    this.updateGrid();
  }
  describe(){ return {layer:this.layerId, mode:this.mode, planes:clonePlanes(this.planes)}; }
  updateGrid(){
    const b = this.bounds, map = this.mode === 'warp' ? perspectiveMap(this.planes) : null;
    this.grid = []; this.rest = [];
    for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++){
      const x = b[0] + Rc.w(b) * i / GRID, y = b[1] + Rc.h(b) * j / GRID;
      this.rest.push([x, y]); this.grid.push(map ? map.map(x, y) : [x, y]);
    }
  }
  corners(p){ return this.mode === 'layout' ? this.planes[p].src : this.planes[p].dst; }
  cornerAt(p, tol){
    let best = null, bd = tol;
    this.planes.forEach((_, pi) => this.corners(pi).forEach((c, ci) => { const d = Math.hypot(c[0] - p[0], c[1] - p[1]); if (d <= bd){ bd = d; best = [pi, ci]; } }));
    return best;
  }
  snap(p, tol, skip){
    for (let pi = 0; pi < this.planes.length; pi++) for (let ci = 0; ci < 4; ci++){
      const c = this.planes[pi].src[ci];
      if (!pairIn(skip, pi, ci) && Math.hypot(c[0] - p[0], c[1] - p[1]) <= tol) return c.slice();
    }
    return p.slice();
  }
  setCorner(group, p){ for (const [pi, ci] of group){ if (this.mode === 'layout') this.planes[pi].src[ci] = p.slice(); this.planes[pi].dst[ci] = p.slice(); } }
  setMode(m){ this.mode = m; if (m === 'warp') unify(this.planes); this.updateGrid(); }   // perspective_ui.rs:158
  /* perspective_ui.rs:193 pointer */
  down(p){
    const tol = tolerance(), hit = this.cornerAt(p, tol);
    if (hit){
      const [pi, ci] = hit, c = this.corners(pi)[ci];
      const group = linkedCorners(this.planes).find(g => pairIn(g, pi, ci)) || [[pi, ci]];   // 连着的角一起动
      this.drag = {kind:'corner', group, offset:[c[0] - p[0], c[1] - p[1]]};
    } else if (this.mode === 'layout') this.drag = {kind:'new', start:this.snap(p, tol, []), cur:p.slice()};
  }
  move(p){
    const d = this.drag; if (!d) return;
    if (d.kind === 'new'){ d.cur = p.slice(); return; }
    let q = [p[0] + d.offset[0], p[1] + d.offset[1]];
    if (this.mode === 'layout') q = this.snap(q, tolerance(), d.group);
    this.setCorner(d.group, q);
    if (this.mode === 'warp') this.updateGrid();
  }
  up(p){
    const d = this.drag; this.drag = null; const tol = tolerance();
    if (d && d.kind === 'new'){
      const e = this.snap(p, tol, []), s = d.start;
      const x0 = Math.min(s[0], e[0]), y0 = Math.min(s[1], e[1]), x1 = Math.max(s[0], e[0]), y1 = Math.max(s[1], e[1]);
      if (x1 - x0 > 4 && y1 - y0 > 4){
        const q = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(c => this.snap(c, tol, []));   // 吸附的角保持准确
        this.planes.push({src:q.map(c => c.slice()), dst:q.map(c => c.slice())});
      }
    } else if (d && d.kind === 'corner'){
      let q = [p[0] + d.offset[0], p[1] + d.offset[1]];
      if (this.mode === 'layout') q = this.snap(q, tol, d.group);
      this.setCorner(d.group, q);
    }
    this.updateGrid(); Bar.render();
  }
  /* perspective_ui.rs:252 draw */
  draw(ctx, s){
    const L = Doc.byId(this.layerId); if (!L) return;
    const vis = baseFrame(ctx, s, L), dpr = s / (UI.zoom || 1), warp = this.mode === 'warp';
    if (vis){
      if (!warp || perspIdentity(this.planes)){ ctx.save(); ctx.globalAlpha = this.opacity; ctx.drawImage(this.tex, this.tx * s, this.ty * s, this.tex.width * s, this.tex.height * s); ctx.restore(); }
      else {
        const tris = [];
        for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++){ const a = j * (GRID + 1) + i; tris.push([a, a + 1, a + GRID + 2], [a, a + GRID + 2, a + GRID + 1]); }
        drawTextured(ctx, s, this.tex, this.tx, this.ty, tris, this.grid, this.rest, this.opacity);
      }
    }
    const S = q => [q[0] * s, q[1] * s];
    ctx.save();
    for (const p of this.planes){
      // 平面里三等分的格线（同 PS），再画外框与四角
      ctx.strokeStyle = 'rgba(255,255,255,0.59)'; ctx.lineWidth = 0.75 * dpr; ctx.beginPath();
      for (let k = 1; k < 3; k++){
        const t = k / 3;
        let a = S(planePoint(p, t, 0, warp)), b = S(planePoint(p, t, 1, warp)); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        a = S(planePoint(p, 0, t, warp)); b = S(planePoint(p, 1, t, warp)); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
      const pts = (warp ? p.dst : p.src).map(S);
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.stroke();
      for (const q of pts){ ctx.beginPath(); ctx.arc(q[0], q[1], 4.5 * dpr, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1.25 * dpr; ctx.strokeStyle = ACCENT; ctx.stroke(); }
    }
    const d = this.drag;
    if (d && d.kind === 'new'){ const a = S(d.start), b = S(d.cur); ctx.strokeStyle = ACCENT; ctx.lineWidth = dpr; ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); }
    ctx.restore();
  }
  /* perspective_ui.rs:294 options_bar */
  bar(el){
    Bar.title(el, 'pse3.persp.title');
    Bar.tab(el, 'pse3.persp.layout', 'layout', this.mode === 'layout', () => { this.setMode('layout'); Bar.render(); });
    Bar.tab(el, 'pse3.persp.warp', 'warp', this.mode === 'warp', () => { if (this.planes.length){ this.setMode('warp'); Bar.render(); } });
    Bar.sep(el);
    if (this.mode === 'warp'){
      for (const [k, m] of [['straighten', 'vertical'], ['level', 'horizontal'], ['both', 'auto']])
        Bar.button(el, T('pse3.persp.' + k), 'straighten-' + m, () => { straighten(this.planes, m); this.updateGrid(); }, 'pse3.persp.' + k + 'Tip');
    } else {
      const n = document.createElement('span'); n.textContent = T('pse3.persp.planes').replace('{n}', this.planes.length); n.dataset.k = 'planeCount'; el.appendChild(n);
      Bar.button(el, T('pse3.persp.remove'), 'removePlanes', () => { this.planes.length = 0; this.updateGrid(); Bar.render(); });
    }
    Bar.hint(el, this.mode === 'warp' ? 'pse3.persp.hintWarp' : 'pse3.persp.hint');
    Bar.commitCancel(el, 'pse3.persp.commit');
  }
  commit(){
    end();
    if (!this.planes.length || perspIdentity(this.planes)) return {ok:true, committed:false};   // perspective_ui.rs:152
    const p = {planes:clonePlanes(this.planes), layerId:this.layerId};
    PE._pse3PerspLast = {cmd:'ps.edit.perspectiveWarp.apply', params:JSON.parse(JSON.stringify(p))};
    return runCommit('ps.edit.perspectiveWarp.apply', p);
  }
  /* perspective_ui.rs:168 control */
  control(ui){
    if (typeof ui.mode === 'string') this.setMode(ui.mode === 'warp' ? 'warp' : 'layout');
    if (ui.planes !== undefined){ const r = perspectiveParams({planes:ui.planes}); if (r.error) return fail('bad planes: ' + r.error); this.planes = r.planes; this.updateGrid(); }
    if (typeof ui.straighten === 'string'){ const m = parseStraighten(ui.straighten); if (!m) return fail('straighten: horizontal|vertical|auto'); straighten(this.planes, m); this.updateGrid(); }
    Bar.render(); UI.draw();
    return Object.assign({ok:true}, this.describe());
  }
}
function runCommit(id, p){
  const r = CMD.run(id, p);
  if (r && r.ok === false && window.Locks && Locks.notify) Locks.notify(r.error);              // 原码把错误显示在状态列
  if (window.UI) UI.refresh();
  return r;
}

/* ── 进／出模式、滑鼠、键盘 ── */
function enter(s){ end(); SES = s; dragging = false; Bar.render(); UI.draw(); }
function end(){ if (!SES) return; SES = null; dragging = false; Bar.hide(); if (window.UI) UI.draw(); }
(window.__pse3Cancel = window.__pse3Cancel || []).push(() => end());
/* 叠画挂点：并进 ps-edit.js 后这段比 ui.js 早载入（index.html 里 ui.js 在菜单实作后面）⇒ 有 UI 才挂，没有就等 DOMContentLoaded */
const hookOverlay = () => { if (!window.UI || UI.__pse3PuppetOv) return; UI.__pse3PuppetOv = true; UI.overlays.push((ctx, s) => { if (SES) SES.draw(ctx, s); }); };
if (window.UI) hookOverlay(); else window.addEventListener('DOMContentLoaded', hookOverlay);
const toDoc = e => { const b = UI.canvas.getBoundingClientRect(), z = UI.zoom || 1; return [(e.clientX - b.left) / z, (e.clientY - b.top) / z]; };
window.addEventListener('pointerdown', e => {
  if (!SES || e.target !== UI.canvas || e.button !== 0) return;
  e.stopPropagation(); e.preventDefault();
  dragging = true; SES.down(toDoc(e), e.altKey); UI.draw();
}, true);
window.addEventListener('pointermove', e => {
  if (!SES || !dragging) return;
  e.stopPropagation(); e.preventDefault();
  SES.move(toDoc(e)); UI.draw();
}, true);
const upHandler = e => {
  if (!SES || !dragging) return;
  e.stopPropagation(); e.preventDefault();
  dragging = false; SES.up(toDoc(e)); UI.draw();
};
window.addEventListener('pointerup', upHandler, true);
window.addEventListener('pointercancel', upHandler, true);
/* distort_ui.rs:144 keys：Enter 确定、Esc 取消；模式中其他键都不给画板（原码回 true＝跳过其余快捷键） */
window.addEventListener('keydown', e => {
  if (!SES) return;
  const t = e.target, inBar = Bar.el && Bar.el.contains(t), field = t && /^(input|select|textarea)$/i.test(t.tagName);
  if (inBar && field){
    if (e.key === 'Enter' || e.key === 'Escape'){ e.preventDefault(); t.blur(); }
    e.stopPropagation(); return;
  }
  if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); SES.commit(); return; }
  if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); end(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && SES.kind === 'puppet' && !field){ e.preventDefault(); e.stopPropagation(); if (SES.removeSelected()) UI.draw(); return; }   // PS：删选中的图钉
  e.stopPropagation();
}, true);

/* ── 浮动选项列（原码的 options bar） ── */
const Bar = {
  el:null,
  render(){
    if (!SES){ this.hide(); return; }
    if (!this.el){
      this.el = document.createElement('div'); this.el.className = 'pse3pw-bar';
      ['pointerdown', 'mousedown', 'click'].forEach(k => this.el.addEventListener(k, e => e.stopPropagation()));
      document.body.appendChild(this.el);
    }
    this.el.dataset.mode = SES.kind;
    this.el.innerHTML = '';
    SES.bar(this.el);
    const host = UI.wrap || UI.canvas.parentElement, r = host.getBoundingClientRect();
    this.el.style.left = (r.left + 8) + 'px'; this.el.style.top = (r.top + 8) + 'px';
  },
  hide(){ if (this.el){ this.el.remove(); this.el = null; } },
  span(el, key, cls){ const s = document.createElement('span'); if (cls) s.className = cls; if (key){ s.textContent = T(key); s.dataset.i18n = key; } el.appendChild(s); return s; },
  title(el, key){ this.span(el, key, 'ttl'); },
  label(el, key){ this.span(el, key); },
  hint(el, key){ this.span(el, key, 'hint'); },
  sep(el){ this.span(el, null, 'sep'); },
  select(el, k, key, opts, value, fn){
    if (key) this.label(el, key);
    const s = document.createElement('select'); s.dataset.k = k;
    opts.forEach(([v, ok]) => { const o = document.createElement('option'); o.value = v; o.textContent = T(ok); o.dataset.i18n = ok; s.appendChild(o); });
    s.value = value; s.onchange = () => { fn(s.value); UI.draw(); };
    el.appendChild(s); return s;
  },
  number(el, k, key, value, min, max, suffix, fn){
    if (key) this.label(el, key);
    const i = document.createElement('input'); i.type = 'number'; i.dataset.k = k; i.value = value; i.min = min; i.max = max; i.style.width = '56px';
    i.onchange = () => { const v = +i.value; if (isFinite(v) && i.value !== ''){ const c = Math.min(Math.max(v, min), max); i.value = c; fn(c); UI.draw(); } };
    el.appendChild(i); if (suffix) this.span(el, null).textContent = suffix; return i;
  },
  check(el, k, key, value, fn){
    const l = document.createElement('label'), c = document.createElement('input'); c.type = 'checkbox'; c.dataset.k = k; c.checked = !!value;
    c.onchange = () => { fn(c.checked); UI.draw(); };
    l.appendChild(c); const t = document.createElement('span'); t.textContent = T(key); t.dataset.i18n = key; l.appendChild(t); el.appendChild(l); return c;
  },
  button(el, text, act, fn, tipKey){
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.dataset.act = act;
    if (tipKey){ b.title = T(tipKey); b.dataset.i18nTitle = tipKey; }
    b.onclick = () => { fn(); UI.draw(); }; el.appendChild(b); return b;
  },
  tab(el, key, act, on, fn){ const b = this.button(el, T(key), act, fn); b.dataset.i18n = key; b.classList.add('tab'); if (on) b.classList.add('on'); return b; },
  commitCancel(el, commitKey){
    const ok = this.button(el, '✓', 'commit', () => { if (SES) SES.commit(); }, commitKey); ok.classList.add('pri');
    this.button(el, '⊘', 'cancel', () => end(), 'pse3.common.cancel');
  },
};
document.addEventListener('change', e => { if (e.target && e.target.id === 'langSel' && SES) setTimeout(() => Bar.render(), 0); });
(function style(){
  if (document.getElementById('pse3-puppet')) return;
  const st = document.createElement('style'); st.id = 'pse3-puppet';
  st.textContent = `.pse3pw-bar{position:fixed;z-index:9000;display:flex;align-items:center;flex-wrap:wrap;gap:6px;max-width:calc(100vw - 340px);background:#2b2f36;color:#e6e8ec;border:1px solid #444a55;border-radius:6px;padding:6px 10px;font:12px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)}
.pse3pw-bar .ttl{font-weight:600;margin-right:4px}
.pse3pw-bar .sep{width:1px;height:18px;background:#555c68;margin:0 2px}
.pse3pw-bar .hint{color:#9aa3b0;font-size:11px}
.pse3pw-bar select,.pse3pw-bar input[type=number]{background:#1f2329;color:#e6e8ec;border:1px solid #555c68;border-radius:3px;padding:2px 4px;font:12px sans-serif}
.pse3pw-bar label{display:flex;align-items:center;gap:4px;cursor:pointer}
.pse3pw-bar button{background:#3a404a;color:#e6e8ec;border:1px solid #555c68;border-radius:4px;padding:2px 10px;cursor:pointer;font:12px sans-serif}
.pse3pw-bar button.tab.on{background:#2f7fd8;border-color:#2f7fd8}
.pse3pw-bar button.pri{background:#2f7fd8;border-color:#2f7fd8}`;
  document.head.appendChild(st);
})();

/* ═══════════ 菜单进入点（distort_ui.rs:101 menu：没参数＝进互动模式；{ui:{…}}＝控制进行中的模式；其他参数＝直接跑引擎命令） ═══════════ */
const hasParams = p => p && Object.keys(p).some(k => k !== 'dialog' && p[k] !== undefined);
function entry(kind, applyId, name, Sess){
  return p => {
    if (p && p.ui && typeof p.ui === 'object'){
      if (!SES || SES.kind !== kind) return fail(`${name} is not active`);
      if (p.ui.commit === true){ const r = SES.commit(); return r && r.ok === false ? r : Object.assign({committed:true}, r || {}); }
      if (p.ui.cancel === true){ end(); return {ok:true, cancelled:true}; }
      return SES.control(p.ui);
    }
    if (hasParams(p)) return CMD.run(applyId, p);
    if (SES && SES.kind === kind) return Object.assign({ok:true}, {[kind]:SES.describe()});
    /* PS：编辑 ▸ 操控变形／透视变形 碰到智能对象＝走智能对象那条（代理层互动，确定＝记成智能滤镜，非破坏、可再编辑） */
    const A = Doc.active(), smartCmd = 'ps.layer.smartObjects.' + (kind === 'puppet' ? 'puppetWarp' : 'perspectiveWarp');
    if (A && A.kind === 'smart' && CMD.map[smartCmd]) return CMD.run(smartCmd, {});
    return openDistort(kind, name, Sess, null);
  };
}
/* 开互动模式；preset＝智能滤镜再编辑时带回的参数（puppet：{pins, mode, density, expansion}；perspective：{planes}） */
function openDistort(kind, name, Sess, preset){
  const c = beginCheck(name); if (c.error) return fail(c.error);
  const s = new Sess(c.L, c.S, c.bounds, kind === 'puppet' ? preset : null);
  if (kind === 'puppet'){ s.rebuildMesh(); if (!s.mesh.tris.length) return fail('Could not use Puppet Warp: no opaque pixels'); }
  else if (preset && Array.isArray(preset.planes) && preset.planes.length){ s.planes = clonePlanes(preset.planes); s.setMode('warp'); }
  enter(s);
  return Object.assign({ok:true}, {[kind]:s.describe()});
}
/* 智能滤镜再编辑（PS：双击图层面板里的「操控变形」智能滤镜）：ps-layer2 的代理层准备好后调这个 */
function reopen(kind, params){
  if (kind === 'puppet'){ const r = puppetParams(params || {}); if (r.error) return fail(r.error); return openDistort('puppet', 'Puppet Warp', PuppetSession, r.warp); }
  if (kind === 'perspective'){ const r = perspectiveParams(params || {}); return openDistort('perspective', 'Perspective Warp', PerspSession, r.error ? null : r); }
  return fail('unknown warp kind');
}
CMD.reg('ps.edit.puppetWarp', {i18n:'',
  params:'{} ＝对当前像素层进「操控变形」互动模式（画面上铺网格：点一下加图钉、拖图钉变形、Alt+点删图钉、Delete 删选中图钉、选中后 Alt+在图钉旁拖＝旋转（变固定）；智能对象＝转去 ps.layer.smartObjects.puppetWarp 记成智能滤镜；选项列：模式／浓度／扩展／显示网格、选中图钉的深度与旋转；Enter 确定＝跑 ps.edit.puppetWarp.apply 一步历史，Esc 取消）；'
       + '{ui:{mode?, density?, expansion?, showMesh?, pin?:{index, rotate?:度|null（null＝自动）, depth?}, removePin?:index, commit?:true, cancel?:true}} ＝控制进行中的模式；{pins, mode?, density?, expansion?, interpolation?, layerId?} ＝直接变（转给 ps.edit.puppetWarp.apply）'},
  entry('puppet', 'ps.edit.puppetWarp.apply', 'Puppet Warp', PuppetSession));
CMD.reg('ps.edit.perspectiveWarp', {i18n:'',
  params:'{} ＝对当前像素层进「透视变形」互动模式（版面：在图上拖出平面、拖角对准透视线，角放到别的平面角旁会吸附连起来；变形：拖角（连着的一起动）、拉直／拉平／两者；Enter 确定＝跑 ps.edit.perspectiveWarp.apply 一步历史，Esc 取消）；'
       + '{ui:{mode?:"layout|warp", planes?, straighten?, commit?:true, cancel?:true}} ＝控制进行中的模式；{planes, straighten?, interpolation?, layerId?} ＝直接变（转给 ps.edit.perspectiveWarp.apply）'},
  entry('perspective', 'ps.edit.perspectiveWarp.apply', 'Perspective Warp', PerspSession));
PE.distort = {session:() => SES ? Object.assign({kind:SES.kind}, SES.describe()) : null, end, reopen, _algo:{buildMesh, PuppetSolver, perspectiveMap, straighten, warpTriangles, warpMeshSurface}};

/* ═══════════ 三语 ═══════════ */
Lang.add({
  'zh-Hant':{
    'pse3.puppet.title':'操控彎曲', 'pse3.puppet.mode':'模式：', 'pse3.puppet.m.rigid':'剛性', 'pse3.puppet.m.normal':'正常', 'pse3.puppet.m.distort':'扭曲',
    'pse3.puppet.density':'密度：', 'pse3.puppet.d.fewer':'較少點', 'pse3.puppet.d.normal':'正常', 'pse3.puppet.d.more':'較多點',
    'pse3.puppet.expansion':'擴展：', 'pse3.puppet.showMesh':'顯示網紋', 'pse3.puppet.pinDepth':'圖釘深度：',
    'pse3.puppet.depthUp':'將選取的圖釘往前移', 'pse3.puppet.depthDown':'將選取的圖釘往後移',
    'pse3.puppet.rotate':'旋轉：', 'pse3.puppet.r.auto':'自動', 'pse3.puppet.r.fixed':'固定', 'pse3.puppet.removeAll':'移除所有圖釘',
    'pse3.puppet.commit':'確認操控彎曲 (Enter)', 'pse3.puppet.hint':'在網紋上按一下加入圖釘，拖移圖釘來彎曲；Alt+按一下圖釘可刪除（或按 Delete）；選取圖釘後按住 Alt 在圖釘旁拖移可旋轉',
    'pse3.persp.title':'透視彎曲', 'pse3.persp.layout':'版面', 'pse3.persp.warp':'彎曲',
    'pse3.persp.straighten':'拉直', 'pse3.persp.level':'水平', 'pse3.persp.both':'兩者',
    'pse3.persp.straightenTip':'自動拉直接近垂直的線段', 'pse3.persp.levelTip':'自動調整接近水平的線段', 'pse3.persp.bothTip':'自動拉直並調整水平',
    'pse3.persp.planes':'{n} 個平面', 'pse3.persp.remove':'移除平面', 'pse3.persp.commit':'確認透視彎曲 (Enter)',
    'pse3.persp.hint':'沿影像的透視線拖出平面，再切換到「彎曲」', 'pse3.persp.hintWarp':'拖移角點來彎曲（連在一起的角會一起移動）',
    'pse3.common.cancel':'取消 (Esc)',
  },
  'zh-Hans':{
    'pse3.puppet.title':'操控变形', 'pse3.puppet.mode':'模式：', 'pse3.puppet.m.rigid':'刚性', 'pse3.puppet.m.normal':'正常', 'pse3.puppet.m.distort':'扭曲',
    'pse3.puppet.density':'浓度：', 'pse3.puppet.d.fewer':'较少点', 'pse3.puppet.d.normal':'正常', 'pse3.puppet.d.more':'较多点',
    'pse3.puppet.expansion':'扩展：', 'pse3.puppet.showMesh':'显示网格', 'pse3.puppet.pinDepth':'图钉深度：',
    'pse3.puppet.depthUp':'将选中的图钉前移', 'pse3.puppet.depthDown':'将选中的图钉后移',
    'pse3.puppet.rotate':'旋转：', 'pse3.puppet.r.auto':'自动', 'pse3.puppet.r.fixed':'固定', 'pse3.puppet.removeAll':'移去所有图钉',
    'pse3.puppet.commit':'提交操控变形 (Enter)', 'pse3.puppet.hint':'在网格上单击添加图钉，拖动图钉变形；Alt+单击图钉删除（或按 Delete）；选中图钉后按住 Alt 在图钉旁拖动可旋转',
    'pse3.persp.title':'透视变形', 'pse3.persp.layout':'版面', 'pse3.persp.warp':'变形',
    'pse3.persp.straighten':'拉直', 'pse3.persp.level':'拉平', 'pse3.persp.both':'两者',
    'pse3.persp.straightenTip':'自动拉直接近垂直的线段', 'pse3.persp.levelTip':'自动对接近水平的线段进行水平调整', 'pse3.persp.bothTip':'自动拉直并水平调整',
    'pse3.persp.planes':'{n} 个平面', 'pse3.persp.remove':'移去平面', 'pse3.persp.commit':'提交透视变形 (Enter)',
    'pse3.persp.hint':'沿图像的透视线拖出平面，再切换到「变形」', 'pse3.persp.hintWarp':'拖动角点变形（连在一起的角一起移动）',
    'pse3.common.cancel':'取消 (Esc)',
  },
  en:{
    'pse3.puppet.title':'Puppet Warp', 'pse3.puppet.mode':'Mode:', 'pse3.puppet.m.rigid':'Rigid', 'pse3.puppet.m.normal':'Normal', 'pse3.puppet.m.distort':'Distort',
    'pse3.puppet.density':'Density:', 'pse3.puppet.d.fewer':'Fewer Points', 'pse3.puppet.d.normal':'Normal', 'pse3.puppet.d.more':'More Points',
    'pse3.puppet.expansion':'Expansion:', 'pse3.puppet.showMesh':'Show Mesh', 'pse3.puppet.pinDepth':'Pin Depth:',
    'pse3.puppet.depthUp':'Bring the selected pin forward', 'pse3.puppet.depthDown':'Send the selected pin backward',
    'pse3.puppet.rotate':'Rotate:', 'pse3.puppet.r.auto':'Auto', 'pse3.puppet.r.fixed':'Fixed', 'pse3.puppet.removeAll':'Remove All Pins',
    'pse3.puppet.commit':'Commit Puppet Warp (Enter)', 'pse3.puppet.hint':'Click the mesh to add pins, drag pins to warp; Alt-click a pin (or press Delete) to remove it; Alt-drag near the selected pin to rotate it',
    'pse3.persp.title':'Perspective Warp', 'pse3.persp.layout':'Layout', 'pse3.persp.warp':'Warp',
    'pse3.persp.straighten':'Straighten', 'pse3.persp.level':'Level', 'pse3.persp.both':'Both',
    'pse3.persp.straightenTip':'Automatically straighten near-vertical line segments', 'pse3.persp.levelTip':'Automatically level near-horizontal line segments', 'pse3.persp.bothTip':'Automatically straighten and level',
    'pse3.persp.planes':'{n} plane(s)', 'pse3.persp.remove':'Remove Planes', 'pse3.persp.commit':'Commit Perspective Warp (Enter)',
    'pse3.persp.hint':'Perspective Warp: draw planes along the image\'s perspective, then switch to Warp', 'pse3.persp.hintWarp':'Drag corners to warp (linked corners move together)',
    'pse3.common.cancel':'Cancel (Esc)',
  },
});
})();

/* ═══════════ align（照 photocraft engine/src/align_cmds.rs 抄） ═══════════
   编辑 ▸ 自动对齐图层…／自动混合图层…
   对照源（photocraft/crates/…，各段注释再标 档:行）：
     engine/src/align_cmds.rs     selected_pixel_layers 33-36、two_layers 38-41、auto_align 43-122、pixels 125-128、auto_blend 130-215、specs 223-233
     engine/src/photo_cmds.rs     REGISTER_SIDE 47、luma_alpha 104-127、register 131-148、warp_placed 159-165、plane_matrix 168-173、
                                  roi_of 176-189、seam_blend 205-368、seam_order 375-388
     algo/src/panorama.rs         Layout／Projection／Motion 41-146、fit_motion 149-173、ransac_motion 176-218、Placement 220-346、
                                  detect 358-363、match_pairs 388-411、focal_from_homography 415-437、align 479-521、too_stretched 525-552、
                                  align_layout 554-721、photometric 768-775（本命令只走得到早退那段）、seam_labels 877-984、
                                  blend_levels 989-997、reduce／expand 999-1052、push_pull 1056-1096、multiband 1101-1221
     algo/src/features.rs         Rng 46-61、blur 63-82、harris 86-151、pairs 154-169、describe 173-210、hamming 212、match_descriptors 217-242、
                                  solve 247-273、least_squares 276-288、normaliser 291-297、fit 300-341
     algo/src/pyramid.rs          reduce／expand 26-87、gaussian／laplacian／collapse 90-126、auto_levels 129-137、blend 140-170、
                                  box_blur1 172-191、winner_take_all 194-208、stack_weights 212-230
     algo/src/photo_util.rs       solve_dense 6-36、Rng（SplitMix64）152-164
     algo/src/transform.rs        Homography 17-98、Interp 103-118、catmull_rom 120-124、warp_surface 129-269
     algo/src/warp.rs             CELL／MAX_CELLS 25-27、warp_mesh_surface 52-80、warp_triangles 86-282
     ui-egui/src/prefs_ui.rs:420-433  两个对话框＝通用对话框（栏位照 specs，拿掉 reference）；没启用时回「… is not available right now」
   资料：PhotoCraft 的 Surface 是无边界的浮点图；这里用 {r:[x0,y0,x1,y1]（文件坐标）, px:Float32Array 直通 RGBA 0..1}，区外读成透明。
   🔴 坐标铁律：像素层画布原点在 (L.x, L.y)；读层＝画布按原点摆进文件坐标，写回时新画布的原点就是结果的范围左上角。 */
(function(){
'use strict';
const PE = window.PsEdit; if (!PE || PE._pse3_align) return; PE._pse3_align = true;
const T = k => Lang.t(k);
const fail = msg => ({ok:false, error:msg});
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const U32MAX = 0xFFFFFFFF;
/* Rust 的 f64::round／f32::round：一半往外进（JS Math.round 对负的 .5 往上） */
const roundAway = v => v < 0 ? -Math.round(-v) : Math.round(v);

/* 矩形一律 [x0,y0,x1,y1]（文件坐标） */
const Rc = {
  w: r => r[2] - r[0], h: r => r[3] - r[1],
  inter(a, b){ if (!a || !b) return null; const r = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]; return (r[2] > r[0] && r[3] > r[1]) ? r : null; },
  union(a, b){ return !a ? (b ? b.slice() : null) : !b ? a.slice() : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; },
};
const docRect = () => [0, 0, Doc.width, Doc.height];

/* ═══════════ 浮点图（photocraft Surface 的替身） ═══════════ */
function surfOfCanvas(cv, ox, oy){
  const d = cv.getContext('2d', {willReadFrequently:true}).getImageData(0, 0, cv.width, cv.height).data;
  const px = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) px[i] = d[i] / 255;
  return {r:[ox, oy, ox + cv.width, oy + cv.height], px};
}
const surfOfLayer = L => surfOfCanvas(L.data.canvas, L.x, L.y);
/* Surface::read_region：区域 r 的 RGBA（区外透明） */
function readRegion(S, r){
  const w = Rc.w(r), h = Rc.h(r), out = new Float32Array(w * h * 4);
  const lr = Rc.inter(S.r, r); if (!lr) return out;
  const sw = Rc.w(S.r), lw = Rc.w(lr);
  for (let y = lr[1]; y < lr[3]; y++){
    const so = ((y - S.r[1]) * sw + (lr[0] - S.r[0])) * 4;
    out.set(S.px.subarray(so, so + lw * 4), ((y - r[1]) * w + (lr[0] - r[0])) * 4);
  }
  return out;
}
/* Surface::content_bounds（RGBA 的预设像素＝全透明 ⇒ alpha>0 的外框）；空回 null */
function contentBounds(S){
  const w = Rc.w(S.r), h = Rc.h(S.r);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (S.px[(y * w + x) * 4 + 3] > 0){
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y;
  }
  return x1 < 0 ? null : [S.r[0] + x0, S.r[1] + y0, S.r[0] + x1 + 1, S.r[1] + y1 + 1];
}
const emptySurf = () => ({r:[0, 0, 0, 0], px:new Float32Array(0)});
/* 浮点 RGBA → 一张画布（8 位：round(v·255)，同 U8 Surface 写入） */
function canvasOf(px, w, h){
  const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h);
  const x = c.getContext('2d', {willReadFrequently:true});
  if (w > 0 && h > 0){
    const img = x.createImageData(w, h), d = img.data;
    for (let i = 0; i < w * h * 4; i++) d[i] = Math.round(clamp(px[i], 0, 1) * 255);
    x.putImageData(img, 0, 0);
  }
  return {c, x};
}

/* ═══════════ 3×3 投影矩阵（transform.rs:17-98 Homography，列优先＝row-major 9 个数） ═══════════ */
const Hm = {
  ID: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  T: (dx, dy) => [1, 0, dx, 0, 1, dy, 0, 0, 1],
  apply(m, x, y){ const w = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]; },
  mul(a, b){
    const r = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    return r;
  },
  inverse(m){
    const c = [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
               m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
               m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]];
    const det = m[0] * c[0] + m[1] * c[3] + m[2] * c[6];
    if (Math.abs(det) < 1e-12) return null;
    return c.map(v => v / det);
  },
  /* transform.rs:91 local_scale：(x,y) 附近的线性缩放（雅可比行列式开根号） */
  localScale(m, x, y){
    const e = 0.5, a = this.apply(m, x - e, y), b = this.apply(m, x + e, y), c = this.apply(m, x, y - e), d = this.apply(m, x, y + e);
    const jx = [b[0] - a[0], b[1] - a[1]], jy = [d[0] - c[0], d[1] - c[1]];
    return Math.sqrt(Math.abs(jx[0] * jy[1] - jx[1] * jy[0]));
  },
};

/* ═══════════ 固定种子乱数（features.rs:46 ＝ photo_util.rs:152 SplitMix64；u64 用 BigInt 才跟原码一模一样） ═══════════ */
const U64 = (1n << 64n) - 1n;
class Rng {
  constructor(seed){ this.s = BigInt.asUintN(64, BigInt(seed)); }
  next(){
    this.s = (this.s + 0x9E3779B97F4A7C15n) & U64;
    let z = this.s;
    z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & U64;
    z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & U64;
    return z ^ (z >> 31n);
  }
  unit(){ return Number(this.next() >> 11n) / 9007199254740992; }
  below(n){ return Number(this.next() % BigInt(Math.max(n, 1))); }
}

/* ═══════════ features.rs：角点、描述子、配对、模型拟合 ═══════════ */
const PATCH_RADIUS = 15;                                   // features.rs:44
/* features.rs:63 blur ＝ pyramid.rs:172 box_blur1：两趟方框（横、纵），边缘夹住 */
function boxBlur(w, h, v, r){
  const pass = (src, horiz) => {
    const dst = new Float32Array(src.length);
    const n = horiz ? h : w, m = horiz ? w : h, d = 2 * r + 1;
    for (let line = 0; line < n; line++){
      const at = k => { k = k < 0 ? 0 : k > m - 1 ? m - 1 : k; return horiz ? src[line * w + k] : src[k * w + line]; };
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += at(k);
      for (let k = 0; k < m; k++){
        dst[horiz ? line * w + k : k * w + line] = acc / d;
        acc += at(k + r + 1) - at(k - r);
      }
    }
    return dst;
  };
  return pass(pass(v, true), false);
}
/* features.rs:86 harris：Sobel → 结构张量（两趟方框近似高斯窗）→ det − 0.04·trace²；
   3×3 非极大抑制、≥ 峰值 1%、描述子补丁要整个在 valid 里；照分数排、用粗格子保证最小间距 */
function harris(w, h, img, max, minDist, valid){
  if (w < 2 * PATCH_RADIUS + 3 || h < 2 * PATCH_RADIUS + 3) return [];
  const N = w * h;
  let xx = new Float32Array(N), yy = new Float32Array(N), xy = new Float32Array(N);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++){
    const i = y * w + x, u = i - w, d = i + w;
    const gx = (img[u + 1] + 2 * img[i + 1] + img[d + 1]) - (img[u - 1] + 2 * img[i - 1] + img[d - 1]);
    const gy = (img[d - 1] + 2 * img[d] + img[d + 1]) - (img[u - 1] + 2 * img[u] + img[u + 1]);
    xx[i] = gx * gx; yy[i] = gy * gy; xy[i] = gx * gy;
  }
  xx = boxBlur(w, h, boxBlur(w, h, xx, 1), 1); yy = boxBlur(w, h, boxBlur(w, h, yy, 1), 1); xy = boxBlur(w, h, boxBlur(w, h, xy, 1), 1);
  const r = new Float32Array(N);
  let peak = 0;
  for (let i = 0; i < N; i++){ const t = xx[i] + yy[i]; r[i] = xx[i] * yy[i] - xy[i] * xy[i] - 0.04 * t * t; if (r[i] > peak) peak = r[i]; }
  if (peak <= 0) return [];
  const m = PATCH_RADIUS + 1, cand = [];
  for (let y = m; y < h - m; y++) for (let x = m; x < w - m; x++){
    const v = r[y * w + x];
    if (v < peak * 0.01) continue;
    let isMax = true;
    for (let dy = -1; dy <= 1 && isMax; dy++) for (let dx = -1; dx <= 1; dx++){ if ((dx || dy) && r[(y + dy) * w + x + dx] > v){ isMax = false; break; } }
    if (!isMax) continue;
    if (valid){
      let all = true;
      for (let yy2 = y - PATCH_RADIUS; yy2 <= y + PATCH_RADIUS && all; yy2 += 5) for (let xx2 = x - PATCH_RADIUS; xx2 <= x + PATCH_RADIUS; xx2 += 5) if (!valid[yy2 * w + xx2]){ all = false; break; }
      if (!all) continue;
    }
    cand.push({x, y, score:v});
  }
  cand.sort((a, b) => (b.score - a.score) || (a.y - b.y) || (a.x - b.x));
  // 最小间距：粗格子占位（features.rs:132-149）
  const cell = Math.max(minDist, 1);
  const gw = Math.ceil(w / cell) + 1, gh = Math.ceil(h / cell) + 1;
  const grid = Array.from({length:gw * gh}, () => []);
  const out = [];
  for (const c of cand){
    const gx = Math.floor(c.x / cell), gy = Math.floor(c.y / cell);
    let near = false;
    for (let yy2 = Math.max(gy - 1, 0); yy2 <= Math.min(gy + 1, gh - 1) && !near; yy2++)
      for (let xx2 = Math.max(gx - 1, 0); xx2 <= Math.min(gx + 1, gw - 1) && !near; xx2++)
        for (const q of grid[yy2 * gw + xx2]) if (Math.hypot(q[0] - c.x, q[1] - c.y) < minDist){ near = true; break; }
    if (near) continue;
    grid[gy * gw + gx].push([c.x, c.y]);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}
/* features.rs:154 pairs：256 组 BRIEF 比较点（固定种子、σ=31/5 的高斯、夹在 ±13），f32 */
let _pairs = null;
function briefPairs(){
  if (_pairs) return _pairs;
  const rng = new Rng(0x0B21EF00n);
  const gauss = () => { const u = Math.max(rng.unit(), 1e-12), v = rng.unit(); return Math.fround(clamp(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * 31 / 5, -13, 13)); };
  _pairs = [];
  for (let i = 0; i < 256; i++) _pairs.push([gauss(), gauss(), gauss(), gauss()]);
  return _pairs;
}
/* features.rs:173 describe：平滑后的 31×31 补丁，按强度质心方向转（upright＝不转），256 位（8 个 u32） */
function describe(w, h, img, corners, upright){
  const smooth = boxBlur(w, h, img, 2), P = briefPairs();
  const at = (x, y) => smooth[clamp(roundAway(y), 0, h - 1) * w + clamp(roundAway(x), 0, w - 1)];
  return corners.map(c => {
    let s = 0, co = 1;
    if (!upright){
      let m10 = 0, m01 = 0; const r = PATCH_RADIUS;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r){
        const v = at(c.x + dx, c.y + dy); m10 += dx * v; m01 += dy * v;
      }
      const a = Math.atan2(m01, m10); s = Math.sin(a); co = Math.cos(a);
    }
    const d = new Uint32Array(8);
    for (let i = 0; i < 256; i++){
      const p = P[i];
      const ax = c.x + p[0] * co - p[1] * s, ay = c.y + p[0] * s + p[1] * co;
      const bx = c.x + p[2] * co - p[3] * s, by = c.y + p[2] * s + p[3] * co;
      if (at(ax, ay) < at(bx, by)) d[i >> 5] |= (1 << (i & 31));
    }
    return d;
  });
}
function pop32(v){ v = v - ((v >>> 1) & 0x55555555); v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return Math.imul((v + (v >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24; }
/* features.rs:212 hamming */
function hamming(a, b){ let n = 0; for (let i = 0; i < 8; i++) n += pop32((a[i] ^ b[i]) >>> 0); return n; }
/* features.rs:217 match_descriptors：最近邻＋Lowe 比值检验（f32 比）＋双向最近 */
function matchDescriptors(a, b, ratio){
  const best = (d, set) => {
    let fj = -1, f1 = U32MAX, second = U32MAX;
    for (let j = 0; j < set.length; j++){
      const hd = hamming(d, set[j]);
      if (hd < f1){ second = f1; fj = j; f1 = hd; } else if (hd < second) second = hd;
    }
    return fj < 0 ? null : [fj, f1, second];
  };
  const rf = Math.fround(ratio), out = [];
  for (let i = 0; i < a.length; i++){
    const r = best(a[i], b); if (!r) continue;
    const [j, d1, d2] = r;
    if (d1 > 80 || (d2 !== U32MAX && d1 > Math.fround(rf * d2))) continue;
    const back = best(b[j], a);
    if (back && back[0] === i) out.push([i, j]);
  }
  return out;
}
/* features.rs:247 solve：高斯消去＋部分主元（奇异门槛 1e-12） */
function solveF(n, a, b){
  a = a.slice(); b = b.slice();
  for (let c = 0; c < n; c++){
    let p = c; for (let i = c + 1; i < n; i++) if (Math.abs(a[i * n + c]) >= Math.abs(a[p * n + c])) p = i;   // max_by：同大取后面那个
    if (Math.abs(a[p * n + c]) < 1e-12) return null;
    if (p !== c){ for (let k = 0; k < n; k++){ const t = a[c * n + k]; a[c * n + k] = a[p * n + k]; a[p * n + k] = t; } const t = b[c]; b[c] = b[p]; b[p] = t; }
    for (let r = c + 1; r < n; r++){
      const f = a[r * n + c] / a[c * n + c];
      for (let k = c; k < n; k++) a[r * n + k] -= f * a[c * n + k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--){ let s = 0; for (let k = r + 1; k < n; k++) s += a[r * n + k] * x[k]; x[r] = (b[r] - s) / a[r * n + r]; }
  return x;
}
/* photo_util.rs:6 solve_dense：同上，门槛 1e-14、f==0 跳过、解要有限 */
function solveDense(n, a, b){
  a = a.slice(); b = b.slice();
  for (let col = 0; col < n; col++){
    let piv = col; for (let i = col + 1; i < n; i++) if (Math.abs(a[i * n + col]) >= Math.abs(a[piv * n + col])) piv = i;
    if (Math.abs(a[piv * n + col]) < 1e-14) return null;
    if (piv !== col){ for (let k = 0; k < n; k++){ const t = a[col * n + k]; a[col * n + k] = a[piv * n + k]; a[piv * n + k] = t; } const t = b[col]; b[col] = b[piv]; b[piv] = t; }
    const d = a[col * n + col];
    for (let r = col + 1; r < n; r++){
      const f = a[r * n + col] / d;
      if (f === 0) continue;
      for (let k = col; k < n; k++) a[r * n + k] -= f * a[col * n + k];
      b[r] -= f * b[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--){ let s = 0; for (let k = r + 1; k < n; k++) s += a[r * n + k] * x[k]; x[r] = (b[r] - s) / a[r * n + r]; }
  return x.every(v => isFinite(v)) ? x : null;
}
/* features.rs:276 least_squares：正规方程 */
function leastSquares(rows, n){
  const ata = new Array(n * n).fill(0), atb = new Array(n).fill(0);
  for (const [r, b] of rows) for (let i = 0; i < n; i++){ atb[i] += r[i] * b; for (let j = 0; j < n; j++) ata[i * n + j] += r[i] * r[j]; }
  return solveF(n, ata, atb);
}
/* features.rs:291 normaliser：Hartley 正规化（质心到原点、平均距离 √2） */
function normaliser(pts){
  const n = Math.max(pts.length, 1);
  let cx = 0, cy = 0; for (const p of pts){ cx += p[0]; cy += p[1]; } cx /= n; cy /= n;
  let d = 0; for (const p of pts) d += Math.hypot(p[0] - cx, p[1] - cy); d /= n;
  const s = d > 1e-12 ? Math.SQRT2 / d : 1;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}
/* features.rs:300 fit：平移（平均位移）／相似（4 参数最小二乘）／投影（正规化 DLT） */
function fitModel(model, src, dst){
  const n = src.length;
  if (model === 'translation'){
    if (!n) return null;
    let tx = 0, ty = 0; for (let i = 0; i < n; i++){ tx += dst[i][0] - src[i][0]; ty += dst[i][1] - src[i][1]; }
    return [1, 0, tx / n, 0, 1, ty / n, 0, 0, 1];
  }
  if (model === 'similarity'){
    if (n < 2) return null;
    const rows = [];
    for (let i = 0; i < n; i++){ const s = src[i], d = dst[i]; rows.push([[s[0], -s[1], 1, 0], d[0]], [[s[1], s[0], 0, 1], d[1]]); }
    const v = leastSquares(rows, 4); if (!v) return null;
    return [v[0], -v[1], v[2], v[1], v[0], v[3], 0, 0, 1];
  }
  if (n < 4) return null;
  const ts = normaliser(src), td = normaliser(dst), rows = [];
  for (let i = 0; i < n; i++){
    const [x, y] = Hm.apply(ts, src[i][0], src[i][1]), [u, v] = Hm.apply(td, dst[i][0], dst[i][1]);
    rows.push([[x, y, 1, 0, 0, 0, -u * x, -u * y], u], [[0, 0, 0, x, y, 1, -v * x, -v * y], v]);
  }
  const hh = leastSquares(rows, 8); if (!hh) return null;
  const tdi = Hm.inverse(td); if (!tdi) return null;
  const m = Hm.mul(Hm.mul(tdi, [hh[0], hh[1], hh[2], hh[3], hh[4], hh[5], hh[6], hh[7], 1]), ts);
  const k = m[8];
  return Math.abs(k) > 1e-12 ? m.map(v => v / k) : null;
}

/* ═══════════ panorama.rs：版式、运动模型、Placement ═══════════ */
const LAYOUTS = ['auto', 'perspective', 'cylindrical', 'spherical', 'collage', 'reposition'];
const Layout = {
  parse: s => LAYOUTS.includes(s) ? s : null,                                        // panorama.rs:53
  projection: l => l === 'cylindrical' ? 'cylinder' : l === 'spherical' ? 'sphere' : 'plane',   // :74
  motion: l => (l === 'auto' || l === 'perspective') ? 'homography' : (l === 'cylindrical' || l === 'spherical') ? 'euclidean' : l === 'collage' ? 'similarity' : 'translation',   // :81
};
const Motion = {                                                                      // panorama.rs:110-146
  minPoints: m => m === 'translation' ? 1 : (m === 'euclidean' || m === 'similarity') ? 2 : 4,
  nParams: m => m === 'translation' ? 2 : m === 'euclidean' ? 3 : m === 'similarity' ? 4 : 8,
  toParams(m, h){
    const q = h.map(v => v / h[8]);
    if (m === 'translation') return [q[2], q[5]];
    if (m === 'euclidean') return [Math.atan2(q[3], q[0]), q[2], q[5]];
    if (m === 'similarity') return [q[0], q[3], q[2], q[5]];
    return q.slice(0, 8);
  },
  toH(m, p){
    if (m === 'translation') return [1, 0, p[0], 0, 1, p[1], 0, 0, 1];
    if (m === 'euclidean'){ const s = Math.sin(p[0]), c = Math.cos(p[0]); return [c, -s, p[1], s, c, p[2], 0, 0, 1]; }
    if (m === 'similarity') return [p[0], -p[1], p[2], p[1], p[0], p[3], 0, 0, 1];
    return [p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], 1];
  },
};
/* panorama.rs:149 fit_motion：欧氏（转＋移）用 Procrustes，其余转给 features::fit */
function fitMotion(motion, src, dst){
  if (motion !== 'euclidean') return fitModel(motion, src, dst);
  const n = src.length; if (n < 2) return null;
  let cs = [0, 0], cd = [0, 0];
  for (const p of src){ cs = [cs[0] + p[0] / n, cs[1] + p[1] / n]; }
  for (const p of dst){ cd = [cd[0] + p[0] / n, cd[1] + p[1] / n]; }
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++){
    const a = [src[i][0] - cs[0], src[i][1] - cs[1]], b = [dst[i][0] - cd[0], dst[i][1] - cd[1]];
    sxx += a[0] * b[0] + a[1] * b[1]; sxy += a[0] * b[1] - a[1] * b[0];
  }
  const th = Math.atan2(sxy, sxx), s = Math.sin(th), c = Math.cos(th);
  return [c, -s, cd[0] - (c * cs[0] - s * cs[1]), s, c, cd[1] - (s * cs[0] + c * cs[1]), 0, 0, 1];
}
/* panorama.rs:176 ransac_motion：随机最小样本、内点最多者胜，再用全部内点重拟合 */
function ransacMotion(motion, src, dst, iters, threshold, seed){
  const k = Motion.minPoints(motion), n = src.length;
  if (n < k) return null;
  const rng = new Rng(BigInt(seed) ^ 0x5EED0FA1n);
  const inliersOf = h => { const out = []; for (let i = 0; i < n; i++){ const [x, y] = Hm.apply(h, src[i][0], src[i][1]); if (isFinite(x) && Math.hypot(x - dst[i][0], y - dst[i][1]) <= threshold) out.push(i); } return out; };
  let best = null;
  for (let it = 0; it < Math.max(iters, 1); it++){
    let idx = [];
    if (n === k) idx = Array.from({length:k}, (_, i) => i);
    while (idx.length < k){ const i = rng.below(n); if (!idx.includes(i)) idx.push(i); }
    const h = fitMotion(motion, idx.map(i => src[i]), idx.map(i => dst[i])); if (!h) continue;
    const inl = inliersOf(h);
    if (!best || inl.length > best[1].length) best = [h, inl];
  }
  if (!best) return null;
  const [h, inl] = best;
  if (inl.length < k) return null;
  const h2 = fitMotion(motion, inl.map(i => src[i]), inl.map(i => dst[i])) || h;
  const inl2 = inliersOf(h2);
  return inl2.length >= inl.length ? [h2, inl2] : [h, inl];
}
/* panorama.rs:220-346 Placement：图像 px →（去畸变）→ 投影（平面／圆柱／球面）→ 2-D 运动 → 全景 px */
const Pl = {
  make: (projection, focal, center, k1, h) => ({projection, focal, center, k1, h}),
  project(pl, x, y){
    let dx = x - pl.center[0], dy = y - pl.center[1];
    if (pl.k1 !== 0){ const s = 1 + pl.k1 * (dx * dx + dy * dy) / (pl.focal * pl.focal); dx *= s; dy *= s; }
    const f = pl.focal;
    if (pl.projection === 'plane') return [dx, dy];
    if (pl.projection === 'cylinder') return [f * Math.atan2(dx, f), f * dy / Math.hypot(dx, f)];
    return [f * Math.atan2(dx, f), f * Math.atan2(dy, Math.hypot(dx, f))];
  },
  unproject(pl, a, b){
    const f = pl.focal; let dx, dy;
    if (pl.projection === 'plane'){ dx = a; dy = b; }
    else if (pl.projection === 'cylinder'){ const th = a / f; if (Math.abs(th) >= 1.55) return null; dx = f * Math.tan(th); dy = b / Math.cos(th); }
    else { const th = a / f, ph = b / f; if (Math.abs(th) >= 1.55 || Math.abs(ph) >= 1.55) return null; dx = f * Math.tan(th); dy = f * Math.tan(ph) / Math.cos(th); }
    if (pl.k1 !== 0){
      // r_u = r_d (1 + k1 r_d² / f²) 用牛顿法反解 r_d
      const ru = Math.hypot(dx, dy);
      if (ru > 1e-9){
        let rd = ru;
        for (let i = 0; i < 8; i++){
          const g = rd * (1 + pl.k1 * rd * rd / (f * f)) - ru, dg = 1 + 3 * pl.k1 * rd * rd / (f * f);
          if (Math.abs(dg) < 1e-9) break;
          rd -= g / dg;
        }
        if (!(isFinite(rd) && rd > 0)) return null;
        dx *= rd / ru; dy *= rd / ru;
      }
    }
    return [dx + pl.center[0], dy + pl.center[1]];
  },
  forward(pl, x, y){ const p = this.project(pl, x, y); return Hm.apply(pl.h, p[0], p[1]); },
  inverse(pl, u, v){
    const inv = Hm.inverse(pl.h); if (!inv) return null;
    const w = inv[6] * u + inv[7] * v + inv[8]; if (w <= 1e-12) return null;
    const [a, b] = Hm.apply(inv, u, v);
    return this.unproject(pl, a, b);
  },
  scaled(pl, k){
    const s = [k, 0, 0, 0, k, 0, 0, 0, 1], si = [1 / k, 0, 0, 0, 1 / k, 0, 0, 0, 1];
    return {projection:pl.projection, focal:pl.focal * k, center:[pl.center[0] * k, pl.center[1] * k], k1:pl.k1, h:Hm.mul(Hm.mul(s, pl.h), si)};
  },
  translated(pl, dx, dy){ return Object.assign({}, pl, {h:Hm.mul(Hm.T(dx, dy), pl.h)}); },
  bounds(pl, w, h){
    const b = [Infinity, Infinity, -Infinity, -Infinity], n = 32;
    for (let i = 0; i <= n; i++){
      const t = i / n;
      for (const [x, y] of [[t * w, 0], [t * w, h], [0, t * h], [w, t * h]]){
        const [u, v] = this.forward(pl, x, y);
        if (isFinite(u) && isFinite(v)){ b[0] = Math.min(b[0], u); b[1] = Math.min(b[1], v); b[2] = Math.max(b[2], u); b[3] = Math.max(b[3], v); }
      }
    }
    return b;
  },
};
/* panorama.rs:358 detect：最多 max 个角点＋描述子 */
function detect(w, h, luma, valid, max){
  const minDist = Math.fround(clamp(Math.fround(Math.max(w, h) / 70), 3, 20));
  const corners = harris(w, h, luma, max, minDist, valid);
  const desc = describe(w, h, luma, corners, false);
  return {w, h, points:corners.map(c => [c.x, c.y]), desc};
}
/* panorama.rs:388 match_pairs：两两配对 → RANSAC 投影 → Brown–Lowe 验证（内点 > 8 + 0.3·配对数、且 ≥ 10） */
function matchPairs(feats){
  const n = feats.length, out = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++){
    const fa = feats[a], fb = feats[b];
    if (fa.points.length < 6 || fb.points.length < 6) continue;
    const m = matchDescriptors(fb.desc, fa.desc, 0.8);
    if (m.length < 8) continue;
    const src = m.map(([i]) => fb.points[i]), dst = m.map(([, j]) => fa.points[j]);
    const thr = clamp(Math.max(fa.w, fa.h) / 300, 1.5, 4);
    const r = ransacMotion('homography', src, dst, 1200, thr, a * 131 + b); if (!r) continue;
    const [hm, inl] = r;
    if (inl.length < 8 + 0.3 * m.length || inl.length < 10) continue;
    out.push({a, b, pts_a:inl.map(i => dst[i]), pts_b:inl.map(i => src[i]), homography:hm});   // homography：b → a
  }
  return out;
}
/* panorama.rs:415 focal_from_homography：转动相机 H = K R K⁻¹ ⇒ K⁻¹HK 的行／列正交等长 */
function focalFromHomography(h, ca, cb){
  const m = Hm.mul(Hm.mul(Hm.T(-ca[0], -ca[1]), h), Hm.T(cb[0], cb[1]));
  const pick = (c1, c2) => {
    const ok = ([n, d]) => (Math.abs(d) > 1e-12 && n / d > 0) ? [n / d, Math.abs(d)] : null;
    const a = ok(c1), b = ok(c2);
    if (a && b) return a[1] >= b[1] ? a[0] : b[0];
    if (a) return a[0]; if (b) return b[0];
    return null;
  };
  const f1 = pick([-(m[0] * m[1] + m[3] * m[4]), m[6] * m[7]], [m[1] * m[1] + m[4] * m[4] - m[0] * m[0] - m[3] * m[3], m[6] * m[6] - m[7] * m[7]]);
  const f0 = pick([-(m[2] * m[5]), m[0] * m[3] + m[1] * m[4]], [m[5] * m[5] - m[2] * m[2], m[0] * m[0] + m[1] * m[1] - m[3] * m[3] - m[4] * m[4]]);
  if (f0 !== null && f1 !== null) return Math.sqrt(Math.sqrt(f0 * f1));
  if (f0 !== null) return Math.sqrt(f0); if (f1 !== null) return Math.sqrt(f1);
  return null;
}
const basePlacement = (f, projection, focal, k1) => Pl.make(projection, focal, [f.w / 2, f.h / 2], k1, Hm.ID.slice());
/* panorama.rs:479 align：没给焦距就从各对投影矩阵估（中位数）；Auto＝透视，太拉伸改圆柱，又高又宽改球面 */
function align(feats, matches, opts){
  const n = feats.length;
  if (n < 2 || !matches.length) return null;
  let focal = (opts.focal != null && opts.focal > 1) ? opts.focal : null;
  if (focal === null){
    let fs = matches.map(m => { const fa = feats[m.a], fb = feats[m.b]; return focalFromHomography(m.homography, [fa.w / 2, fa.h / 2], [fb.w / 2, fb.h / 2]); }).filter(f => f !== null && isFinite(f));
    const side = Math.max(1, ...feats.map(f => Math.max(f.w, f.h)));
    fs = fs.filter(f => f > side * 0.2 && f < side * 20).sort((a, b) => a - b);
    focal = fs.length ? fs[Math.floor(fs.length / 2)] : side;
  }
  if (opts.layout !== 'auto') return alignLayout(feats, matches, opts, opts.layout, focal);
  const a = alignLayout(feats, matches, opts, 'perspective', focal);
  if (a && !tooStretched(feats, a)) return Object.assign(a, {layout:'perspective'});
  const cyl = alignLayout(feats, matches, opts, 'cylindrical', focal);
  if (!cyl) return null;
  let y0 = Infinity, y1 = -Infinity;
  cyl.placements.forEach((p, i) => { if (p){ const b = Pl.bounds(p, feats[i].w, feats[i].h); y0 = Math.min(y0, b[1]); y1 = Math.max(y1, b[3]); } });
  if ((y1 - y0) / cyl.focal > 1.4) return alignLayout(feats, matches, opts, 'spherical', cyl.focal);
  return cyl;
}
/* panorama.rs:525 too_stretched：某张面积变化超过 0.3..3 倍、翻面、过地平线，或水平视角 > 110° */
function tooStretched(feats, a){
  let x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < a.placements.length; i++){
    const p = a.placements[i]; if (!p) continue;
    const w = feats[i].w, h = feats[i].h, cs = [[0, 0], [w, 0], [w, h], [0, h]];
    const c = cs.map(([x, y]) => Pl.forward(p, x, y));
    let area = 0; for (let k = 0; k < 4; k++) area += c[k][0] * c[(k + 1) % 4][1] - c[(k + 1) % 4][0] * c[k][1];
    const ratio = area / 2 / (w * h);
    if (!isFinite(ratio) || !(ratio >= 0.3 && ratio <= 3)) return true;
    const m = p.h;
    for (const [x, y] of cs){ const q = Pl.project(p, x, y); if (m[6] * q[0] + m[7] * q[1] + m[8] <= 0) return true; }
    for (const [u] of c){ x0 = Math.min(x0, u); x1 = Math.max(x1, u); }
  }
  const fov = 2 * Math.atan((x1 - x0) / 2 / a.focal);
  return fov > 110 * Math.PI / 180;
}
/* panorama.rs:554 align_layout：投影空间里两两 RANSAC → 最大生成树（Prim）从参考层串接 → LM 光束平差（数值雅可比） */
function alignLayout(feats, matches, opts, layout, focal){
  const n = feats.length, projection = Layout.projection(layout), motion = Layout.motion(layout);
  const pairs = [], edges = [];
  for (const m of matches){
    const pa = basePlacement(feats[m.a], projection, focal, 0), pb = basePlacement(feats[m.b], projection, focal, 0);
    const qa = m.pts_a.map(p => Pl.project(pa, p[0], p[1])), qb = m.pts_b.map(p => Pl.project(pb, p[0], p[1]));
    const thr = clamp(Math.max(feats[m.a].w, feats[m.a].h) / 250, 2, 5);
    const r = ransacMotion(motion, qb, qa, 600, thr, m.a * 977 + m.b); if (!r) continue;
    const [hm, inl] = r;
    if (inl.length < 8 || inl.length < 0.5 * m.pts_a.length) continue;
    edges.push([m.a, m.b, inl.length, hm]);
    // 光束平差每对最多用 80 个均匀分布的内点
    const step = Math.max(Math.ceil(inl.length / 80), 1);
    const sel = inl.filter((_, k) => k % step === 0);
    pairs.push({a:m.a, b:m.b, pa:sel.map(i => m.pts_a[i]), pb:sel.map(i => m.pts_b[i])});
  }
  if (!edges.length) return null;
  const degree = new Array(n).fill(0);
  for (const e of edges){ degree[e[0]] += e[2]; degree[e[1]] += e[2]; }
  let reference;
  if (opts.reference != null && opts.reference < n) reference = opts.reference;
  else {
    // 连得最多的；同分取靠中间的（Rust max_by：全等取后面那个）
    const half = Math.trunc(n / 2), cmp = (i, j) => (degree[i] - degree[j]) || (Math.abs(j - half) - Math.abs(i - half));
    reference = 0; for (let i = 1; i < n; i++) if (!(cmp(reference, i) > 0)) reference = i;
  }
  const tf = new Array(n).fill(null);
  const rc = [feats[reference].w / 2, feats[reference].h / 2];
  tf[reference] = Hm.T(rc[0], rc[1]);
  for (;;){
    let best = null;
    for (const e of edges){
      let cand = null;
      if (tf[e[0]] && !tf[e[1]]) cand = [e[1], Hm.mul(tf[e[0]], e[3])];                 // e.3：b → a
      else if (!tf[e[0]] && tf[e[1]]){ const inv = Hm.inverse(e[3]); if (inv) cand = [e[0], Hm.mul(tf[e[1]], inv)]; }
      if (cand && (!best || e[2] > best[1])) best = [cand[0], e[2], cand[1]];
    }
    if (!best) break;
    tf[best[0]] = best[2];
  }
  const placed = []; for (let i = 0; i < n; i++) if (tf[i]) placed.push(i);
  if (placed.length < 2) return null;
  // 光束平差（Levenberg–Marquardt）
  const movable = placed.filter(i => i !== reference);
  const mp = Motion.nParams(motion), refineFocal = projection !== 'plane', nGlob = (opts.geometric ? 1 : 0) + (refineFocal ? 1 : 0);
  let params = [];
  movable.forEach(i => { params.push(...Motion.toParams(motion, tf[i])); });
  if (opts.geometric) params.push(0);
  if (refineFocal) params.push(Math.log(focal));
  const nPar = params.length;
  const decode = p => {
    const k1 = opts.geometric ? p[movable.length * mp] : 0, f = refineFocal ? Math.exp(p[nPar - 1]) : focal;
    return feats.map((ft, i) => {
      let h;
      if (i === reference) h = tf[reference];
      else { const k = movable.indexOf(i); if (k < 0) return null; h = Motion.toH(motion, p.slice(k * mp, (k + 1) * mp)); }
      return Object.assign(basePlacement(ft, projection, f, k1), {h});
    });
  };
  const residuals = p => {
    const pl = decode(p), r = [];
    for (const pd of pairs){
      const a = pl[pd.a], b = pl[pd.b]; if (!a || !b) continue;
      for (let i = 0; i < pd.pa.length; i++){
        const [ua, va] = Pl.forward(a, pd.pa[i][0], pd.pa[i][1]), [ub, vb] = Pl.forward(b, pd.pb[i][0], pd.pb[i][1]);
        r.push(ua - ub, va - vb);
      }
    }
    // 全局项的软先验：对数少时别跑飞
    if (opts.geometric) r.push(p[movable.length * mp] * 20);
    if (refineFocal) r.push((p[nPar - 1] - Math.log(focal)) * 2);
    return r;
  };
  const cost = r => { let s = 0; for (const v of r) s += v * v; return s; };
  let cur = residuals(params), lambda = 1e-3;
  if (nPar > 0 && movable.length){
    for (let it = 0; it < 40; it++){
      const mRes = cur.length;
      const cols = [];
      for (let j = 0; j < nPar; j++){
        const step = 1e-6 * (1 + Math.abs(params[j]));
        const pp = params.slice(); pp[j] += step; const rp = residuals(pp);
        pp[j] -= 2 * step; const rm = residuals(pp);
        const col = new Float64Array(mRes); for (let i = 0; i < mRes; i++) col[i] = (rp[i] - rm[i]) / (2 * step);
        cols.push(col);
      }
      const jtj = new Array(nPar * nPar).fill(0), jtr = new Array(nPar).fill(0);
      for (let a = 0; a < nPar; a++){
        let s = 0; for (let i = 0; i < mRes; i++) s += cols[a][i] * cur[i]; jtr[a] = -s;
        for (let b = a; b < nPar; b++){ let v = 0; for (let i = 0; i < mRes; i++) v += cols[a][i] * cols[b][i]; jtj[a * nPar + b] = v; jtj[b * nPar + a] = v; }
      }
      let improved = false;
      for (let t = 0; t < 8; t++){
        const A = jtj.slice();
        for (let d = 0; d < nPar; d++) A[d * nPar + d] += lambda * (jtj[d * nPar + d] + 1e-9);
        const delta = solveDense(nPar, A, jtr);
        if (!delta){ lambda *= 10; continue; }
        const trial = params.map((p, i) => p + delta[i]), rt = residuals(trial);
        if (cost(rt) < cost(cur)){
          const gain = cost(cur) - cost(rt);
          params = trial; cur = rt; lambda = Math.max(lambda * 0.3, 1e-9);
          improved = gain > 1e-10 * Math.max(cost(cur), 1e-12);
          break;
        }
        lambda *= 10;
      }
      if (!improved) break;
    }
  }
  const placements = decode(params);
  const nRes = Math.max(pairs.reduce((s, p) => s + p.pa.length, 0), 1);
  const rms = Math.sqrt(cost(cur.slice(0, Math.min(cur.length - nGlob, cur.length))) / nRes);
  const k1 = opts.geometric ? params[movable.length * mp] : 0;
  return {layout, reference, placements, focal:refineFocal ? Math.exp(params[nPar - 1]) : focal, k1, pairs:edges.map(e => [e[0], e[1], e[2]]), rms};
}

/* ═══════════ photo_cmds.rs：登记、变形 ═══════════ */
const REGISTER_SIDE = 1200;                                  // photo_cmds.rs:47
/* photo_cmds.rs:104 luma_alpha：area 范围的亮度（按覆盖度加权平均）与覆盖度，k×k 方框降采样 */
function lumaAlpha(S, area, k){
  const w = Rc.w(area), h = Rc.h(area);
  const sw = Math.max(Math.ceil(w / k), 1), sh = Math.max(Math.ceil(h / k), 1);
  const l = new Float32Array(sw * sh), a = new Float32Array(sw * sh), cnt = new Float32Array(sw * sh);
  const px = readRegion(S, area);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const o = (y * w + x) * 4, al = px[o + 3], i = Math.floor(y / k) * sw + Math.floor(x / k);
    l[i] += (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) * al;
    a[i] += al; cnt[i] += 1;
  }
  for (let i = 0; i < sw * sh; i++){ const c = Math.max(cnt[i], 1); l[i] = a[i] > 0 ? l[i] / a[i] : 0; a[i] /= c; }
  return [sw, sh, l, a];
}
/* photo_cmds.rs:131 register：降到最长边 ≤ 1200 做特征、配对、对齐，再把 Placement 放大回原尺寸 */
function register(images, layout, reference, geometric, focal35){
  const side = Math.max(1, ...images.map(([, r]) => Math.max(Rc.w(r), Rc.h(r))));
  const k = Math.max(Math.ceil(side / REGISTER_SIDE), 1);
  const feats = images.map(([s, r]) => {
    const [w, h, l, a] = lumaAlpha(s, r, k);
    let valid = null;
    if (a.some(v => v < 0.5)){ valid = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) valid[i] = a[i] > 0.5 ? 1 : 0; }
    return detect(w, h, l, valid, 800);
  });
  const matches = matchPairs(feats);
  const focal = focal35 != null ? focal35 / 36 * side / k : null;
  const a = align(feats, matches, {layout, focal, reference, geometric});
  if (!a) return null;
  return Object.assign(a, {placements:a.placements.map(p => p ? Pl.scaled(p, k) : null), focal:a.focal * k, rms:a.rms * k});
}
/* photo_cmds.rs:168 plane_matrix：平面、无畸变的 Placement 的投影矩阵（surface px → 全景 px） */
function planeMatrix(pl, origin){
  if (!(pl.projection === 'plane' && pl.k1 === 0)) return null;
  return Hm.mul(pl.h, [1, 0, -pl.center[0] - origin[0], 0, 1, -pl.center[1] - origin[1], 0, 0, 1]);
}
/* photo_cmds.rs:159 warp_placed：平面＝一个投影矩阵（warp_surface）；其余＝网格变形（warp_mesh_surface） */
function warpPlaced(S, rect, origin, pl, offset, interp){
  pl = Pl.translated(pl, offset[0], offset[1]);
  const h = planeMatrix(pl, origin);
  if (h) return warpSurface(S, rect, h, interp);
  return warpMeshSurface(S, rect, (x, y) => Pl.forward(pl, x - origin[0], y - origin[1]), interp);
}
/* transform.rs:111 Interp::parse */
const interpOf = s => (s === 'nearest' || s === 'nearestNeighbor') ? 'nearest' : s === 'bilinear' ? 'bilinear' : 'bicubic';
/* transform.rs:120 catmull_rom */
function catmullRom(t){ const t2 = t * t, t3 = t2 * t; return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2]; }
/* 预乘的取样窗：rect 范围，区外读 0 */
function premulWindow(S, rect){
  const src = readRegion(S, rect);
  for (let i = 0; i < src.length; i += 4){ const a = src[i + 3]; src[i] *= a; src[i + 1] *= a; src[i + 2] *= a; }
  return src;
}
/* 在 (u,v)（像素中心已减 0.5）取样四通道到 acc（transform.rs:212-242 ＝ warp.rs 同段；snap＝warp.rs 双三次贴格） */
function sample(acc, src, rect, u, v, interp, snap){
  const sw = Rc.w(rect);
  const at = (x, y, c) => (x < rect[0] || y < rect[1] || x >= rect[2] || y >= rect[3]) ? 0 : src[((y - rect[1]) * sw + (x - rect[0])) * 4 + c];
  acc[0] = acc[1] = acc[2] = acc[3] = 0;
  if (interp === 'nearest'){
    const ix = Math.floor(u + 0.5), iy = Math.floor(v + 0.5);
    for (let c = 0; c < 4; c++) acc[c] = at(ix, iy, c);
  } else if (interp === 'bilinear'){
    const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
    for (const [dy, wy] of [[0, 1 - fy], [1, fy]]) for (const [dx, wx] of [[0, 1 - fx], [1, fx]]) for (let c = 0; c < 4; c++) acc[c] += at(ix + dx, iy + dy, c) * wx * wy;
  } else {
    if (snap){ const s = t => Math.abs(t - Math.round(t)) < 1e-7 ? Math.round(t) : t; u = s(u); v = s(v); }
    const ix = Math.floor(u), iy = Math.floor(v), wx = catmullRom(u - ix), wy = catmullRom(v - iy);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++){
      const k = wx[i] * wy[j]; if (snap && k === 0) continue;
      for (let c = 0; c < 4; c++) acc[c] += at(ix - 1 + i, iy - 1 + j, c) * k;
    }
  }
}
/* transform.rs:145-155 大幅缩小（< 50%）先预缩：原码用 resample.rs 双三次 resize_surface；这里用预乘方框平均缩 1/f 倍（f 是 2 的负幂）——近似 */
function preReduce(S, f){
  const q = Math.round(1 / f), r0 = S.r;
  const r = [Math.floor(r0[0] * f), Math.floor(r0[1] * f), Math.ceil(r0[2] * f), Math.ceil(r0[3] * f)];
  const w = Rc.w(r), h = Rc.h(r), px = new Float32Array(w * h * 4), src = premulWindow(S, [r[0] * q, r[1] * q, r[2] * q, r[3] * q]), sw = w * q;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const s = [0, 0, 0, 0];
    for (let yy = 0; yy < q; yy++) for (let xx = 0; xx < q; xx++){ const o = ((y * q + yy) * sw + x * q + xx) * 4; for (let c = 0; c < 4; c++) s[c] += src[o + c]; }
    const o = (y * w + x) * 4, a = s[3] / (q * q);
    if (a > 0){ for (let c = 0; c < 3; c++) px[o + c] = s[c] / (q * q) / a; px[o + 3] = a; }
  }
  return {r, px};
}
/* transform.rs:129 warp_surface：反向映射（目的像素中心 → 来源）、预乘取样；结果在扭后四角的外框（多一像素） */
function warpSurface(S, rect, h, interp){
  if (!rect) return emptySurf();
  let srcRect = rect;
  const scale = Hm.localScale(h, (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2);
  if (interp !== 'nearest' && scale < 0.5 && scale > 0){
    const f = Math.min(Math.pow(2, Math.ceil(Math.log2(scale))), 1);
    S = preReduce(S, f);
    h = Hm.mul(h, [1 / f, 0, 0, 0, 1 / f, 0, 0, 0, 1]);
    srcRect = [Math.floor(rect[0] * f), Math.floor(rect[1] * f), Math.ceil(rect[2] * f), Math.ceil(rect[3] * f)];
  }
  const inv = Hm.inverse(h); if (!inv) return emptySurf();
  const cs = [[srcRect[0], srcRect[1]], [srcRect[2], srcRect[1]], [srcRect[2], srcRect[3]], [srcRect[0], srcRect[3]]].map(([x, y]) => Hm.apply(h, x, y));
  if (cs.some(c => !isFinite(c[0]) || !isFinite(c[1]))) return emptySurf();
  const lim = 1 << 20;
  const bx0 = Math.max(Math.floor(Math.min(...cs.map(c => c[0]))), -lim) - 1, by0 = Math.max(Math.floor(Math.min(...cs.map(c => c[1]))), -lim) - 1;
  const bx1 = Math.min(Math.ceil(Math.max(...cs.map(c => c[0]))), lim) + 1, by1 = Math.min(Math.ceil(Math.max(...cs.map(c => c[1]))), lim) + 1;
  const dst = [bx0, by0, bx1, by1], dw = bx1 - bx0, dh = by1 - by0;
  const src = premulWindow(S, srcRect), out = new Float32Array(dw * dh * 4), acc = [0, 0, 0, 0];
  for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++){
    let [u, v] = Hm.apply(inv, x + 0.5, y + 0.5);
    u -= 0.5; v -= 0.5;
    if (!(isFinite(u) && isFinite(v))) continue;
    if (u < srcRect[0] - 1 || v < srcRect[1] - 1 || u > srcRect[2] || v > srcRect[3]) continue;
    sample(acc, src, srcRect, u, v, interp, false);
    const al = clamp(acc[3], 0, 1); if (al <= 0) continue;
    const o = ((y - by0) * dw + (x - bx0)) * 4;
    for (let c = 0; c < 3; c++) out[o + c] = clamp(acc[c] / al, 0, 1);
    out[o + 3] = al;
  }
  return {r:dst, px:out};
}
/* warp.rs:52 warp_mesh_surface：来源切成 4px 的格子、顶点正向映射、每格两个三角形在目的空间光栅化（重心插值来源位置），后画的盖前面 */
const CELL = 4, MAX_CELLS = 512;
function warpMeshSurface(S, rect, f, interp){
  if (!rect) return emptySurf();
  const sw = Rc.w(rect), sh = Rc.h(rect);
  const nx = clamp(Math.ceil(sw / CELL), 1, MAX_CELLS), ny = clamp(Math.ceil(sh / CELL), 1, MAX_CELLS);
  const verts = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++){
    const sx = rect[0] + sw * i / nx, sy = rect[1] + sh * j / ny;
    verts.push([f(sx, sy), [sx, sy]]);
  }
  const w1 = nx + 1, tris = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){ const a = j * w1 + i; tris.push([a, a + 1, a + w1 + 1], [a, a + w1 + 1, a + w1]); }
  return warpTriangles(S, rect, verts, tris, interp);
}
/* warp.rs:86 warp_triangles（不分砖：整个目的范围一次做；分砖在原码只为平行与省记忆体，结果相同） */
function warpTriangles(S, srcRect, verts, tris, interp){
  if (!srcRect || !tris.length) return emptySurf();
  if (verts.some(v => !isFinite(v[0][0]) || !isFinite(v[0][1]))) return emptySurf();
  const lim = 1 << 20;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of tris) for (const i of t){ const p = verts[i][0]; x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const dst = [Math.floor(Math.max(x0, -lim)) - 1, Math.floor(Math.max(y0, -lim)) - 1, Math.ceil(Math.min(x1, lim)) + 1, Math.ceil(Math.min(y1, lim)) + 1];
  const w = Rc.w(dst), h = Rc.h(dst);
  const uv = new Float64Array(w * h * 2).fill(NaN);
  for (const tri of tris){
    const [[p0, s0], [p1, s1], [p2, s2]] = tri.map(v => verts[v]);
    const det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    if (Math.abs(det) < 1e-12) continue;
    const bx0 = Math.max(Math.floor(Math.min(p0[0], p1[0], p2[0]) - 0.5), dst[0]), by0 = Math.max(Math.floor(Math.min(p0[1], p1[1], p2[1]) - 0.5), dst[1]);
    const bx1 = Math.min(Math.ceil(Math.max(p0[0], p1[0], p2[0]) + 0.5), dst[2]), by1 = Math.min(Math.ceil(Math.max(p0[1], p1[1], p2[1]) + 0.5), dst[3]);
    const eps = -1e-9;
    for (let y = by0; y < by1; y++){
      const py = y + 0.5;
      for (let x = bx0; x < bx1; x++){
        const px = x + 0.5;
        const l1 = ((px - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (py - p0[1])) / det;
        const l2 = ((p1[0] - p0[0]) * (py - p0[1]) - (px - p0[0]) * (p1[1] - p0[1])) / det;
        const l0 = 1 - l1 - l2;
        if (l0 < eps || l1 < eps || l2 < eps) continue;
        const o = ((y - dst[1]) * w + (x - dst[0])) * 2;
        uv[o] = l0 * s0[0] + l1 * s1[0] + l2 * s2[0]; uv[o + 1] = l0 * s0[1] + l1 * s1[1] + l2 * s2[1];
      }
    }
  }
  const src = premulWindow(S, srcRect), out = new Float32Array(w * h * 4), acc = [0, 0, 0, 0];
  for (let o = 0; o < w * h; o++){
    const qx = uv[o * 2]; if (isNaN(qx)) continue;
    sample(acc, src, srcRect, qx - 0.5, uv[o * 2 + 1] - 0.5, interp, true);
    const al = clamp(acc[3], 0, 1);
    if (al <= 1e-6) continue;                                // 浮点杂讯别在透明处留颜色
    for (let c = 0; c < 3; c++) out[o * 4 + c] = clamp(acc[c] / al, 0, 1);
    out[o * 4 + 3] = al;
  }
  return {r:dst, px:out};
}

/* ═══════════ panorama.rs：接缝与多频段混合 ═══════════ */
/* photo_cmds.rs:176 roi_of：颜色通道（RGB）＋覆盖度 */
function roiOf(S, area){
  const raw = readRegion(S, area), w = Rc.w(area), h = Rc.h(area);
  const px = new Float32Array(w * h * 3), alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++){ px[i * 3] = raw[i * 4]; px[i * 3 + 1] = raw[i * 4 + 1]; px[i * 3 + 2] = raw[i * 4 + 2]; alpha[i] = raw[i * 4 + 3]; }
  return {x0:area[0], y0:area[1], w, h, ch:3, px, alpha};
}
/* panorama.rs:877 seam_labels：照 order 一张张加；新图跟已合成的重叠区里，沿颜色差最小的路（DP，同 seam carving）切开，自己那一侧归自己 */
function seamLabels(w, h, luma, cover, order){
  const label = new Int32Array(w * h).fill(-1);
  for (const img of order){
    const cov = cover[img], overlap = new Uint8Array(w * h);
    let sx = 0, sy = 0, no = 0, nx = 0, ny = 0, nn = 0;
    for (let i = 0; i < w * h; i++){
      if (!cov[i]) continue;
      nx += i % w; ny += Math.floor(i / w); nn++;
      if (label[i] >= 0){ overlap[i] = 1; sx += i % w; sy += Math.floor(i / w); no++; }
      else label[i] = img;
    }
    if (no === 0 || nn === no) continue;
    const ox = sx / no, oy = sy / no, cx = nx / nn, cy = ny / nn;
    const vertical = Math.abs(cx - ox) >= Math.abs(cy - oy);
    const positive = vertical ? cx > ox : cy > oy;           // 这张图在接缝横轴的递增那一侧？
    const cost = i => Math.fround(0.002 + Math.abs(luma[img][i] - luma[label[i]][i]));
    const lines = vertical ? h : w, len = vertical ? w : h;
    const idx = (line, k) => vertical ? line * w + k : k * w + line;
    const acc = new Float64Array(w * h).fill(Infinity), from = new Int32Array(w * h).fill(-1);
    let prevLine = -1;
    for (let line = 0; line < lines; line++){
      let any = false; for (let k = 0; k < len; k++) if (overlap[idx(line, k)]){ any = true; break; }
      if (!any) continue;
      for (let k = 0; k < len; k++){
        const i = idx(line, k); if (!overlap[i]) continue;
        let best0 = 0, best1 = -1;
        if (prevLine >= 0 && prevLine + 1 === line){
          best0 = Infinity; best1 = -1;
          for (const dk of [-1, 0, 1]){
            const kk = k + dk; if (kk < 0 || kk >= len) continue;
            const j = idx(prevLine, kk);
            if (acc[j] < best0){ best0 = acc[j]; best1 = kk; }
          }
          if (best1 < 0) best0 = 0;
        }
        acc[i] = best0 + cost(i); from[i] = best1;
      }
      prevLine = line;
    }
    // 从最便宜的一端回溯；走不到的行各自取本行最便宜的格
    const seam = new Int32Array(lines).fill(-1);
    let line = lines;
    while (line > 0){
      line--;
      if (seam[line] >= 0) continue;
      let kBest = -1; for (let k = 0; k < len; k++) if (overlap[idx(line, k)] && (kBest < 0 || acc[idx(line, k)] < acc[idx(line, kBest)])) kBest = k;
      if (kBest < 0) continue;
      let l = line, k = kBest;
      for (;;){
        seam[l] = k;
        const f = from[idx(l, k)];
        if (f < 0 || l === 0) break;
        l--;
        if (seam[l] >= 0) break;
        k = f;
      }
    }
    for (let ln = 0; ln < lines; ln++){
      const s = seam[ln]; if (s < 0) continue;
      for (let k = 0; k < len; k++){ const i = idx(ln, k); if (overlap[i] && ((positive && k > s) || (!positive && k < s))) label[i] = img; }
    }
  }
  return label;
}
/* panorama.rs:989 blend_levels */
function blendLevels(w, h){ let s = Math.min(w, h), n = 1; while (s > 16 && n < 7){ s = Math.floor(s / 2); n++; } return n; }
/* panorama.rs:999 reduce：可分 5 阶二项式再隔点取 */
function panReduce(w, h, ch, src){
  const nw = Math.ceil(w / 2), nh = Math.ceil(h / 2), K = [1, 4, 6, 4, 1];
  const tmp = new Float32Array(nw * h * ch);
  for (let y = 0; y < h; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < ch; c++){
    let s = 0; for (let t = 0; t < 5; t++){ const xx = clamp(2 * x + t - 2, 0, w - 1); s += K[t] * src[(y * w + xx) * ch + c]; }
    tmp[(y * nw + x) * ch + c] = s / 16;
  }
  const out = new Float32Array(nw * nh * ch);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < ch; c++){
    let s = 0; for (let t = 0; t < 5; t++){ const yy = clamp(2 * y + t - 2, 0, h - 1); s += K[t] * tmp[(yy * nw + x) * ch + c]; }
    out[(y * nw + x) * ch + c] = s / 16;
  }
  return [nw, nh, out];
}
/* panorama.rs:1032 expand：半像素对齐的双线性放大 */
function panExpand(sw, sh, ch, src, w, h){
  const out = new Float32Array(w * h * ch);
  for (let y = 0; y < h; y++){
    const fy = clamp((y + 0.5) / 2 - 0.5, 0, sh - 1), y0 = Math.floor(fy), ty = fy - y0, y1 = Math.min(y0 + 1, sh - 1);
    for (let x = 0; x < w; x++){
      const fx = clamp((x + 0.5) / 2 - 0.5, 0, sw - 1), x0 = Math.floor(fx), tx = fx - x0, x1 = Math.min(x0 + 1, sw - 1);
      for (let c = 0; c < ch; c++){
        const p = (xx, yy) => src[(yy * sw + xx) * ch + c];
        const top = p(x0, y0) + (p(x1, y0) - p(x0, y0)) * tx, bot = p(x0, y1) + (p(x1, y1) - p(x0, y1)) * tx;
        out[(y * w + x) * ch + c] = top + (bot - top) * ty;
      }
    }
  }
  return out;
}
/* panorama.rs:1056 push_pull：权重 0 的像素用周围填（金字塔不会把图外的黑吸进来） */
function pushPull(w, h, ch, px, wt){
  if (w <= 1 && h <= 1) return;
  const nw = Math.ceil(w / 2), nh = Math.ceil(h / 2);
  const cpx = new Float32Array(nw * nh * ch), cw = new Float32Array(nw * nh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y * w + x, j = (y >> 1) * nw + (x >> 1), a = wt[i];
    cw[j] += a; for (let c = 0; c < ch; c++) cpx[j * ch + c] += a * px[i * ch + c];
  }
  let zero = false, pos = false;
  for (let j = 0; j < nw * nh; j++){
    if (cw[j] > 0){ for (let c = 0; c < ch; c++) cpx[j * ch + c] /= cw[j]; cw[j] = 1; }
    if (cw[j] === 0) zero = true; else if (cw[j] > 0) pos = true;
  }
  if (zero && pos) pushPull(nw, nh, ch, cpx, cw);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y * w + x;
    if (wt[i] < 1){ const j = (y >> 1) * nw + (x >> 1), a = wt[i]; for (let c = 0; c < ch; c++) px[i * ch + c] = a * px[i * ch + c] + (1 - a) * cpx[j * ch + c]; }
  }
}
/* panorama.rs:1101 multiband：各图（ROI 外扩、对齐到最粗层格子）的拉普拉斯金字塔 × 接缝遮罩的高斯金字塔，逐层加权平均后合回 */
function multiband(w, h, imgs, weights, levels){
  const ch = imgs.length ? imgs[0].ch : 1;
  levels = Math.max(levels, 1);
  const alignN = 1 << (levels - 1);
  const sizes = [[w, h]];
  for (let l = 1; l < levels; l++){ const [pw, ph] = sizes[sizes.length - 1]; sizes.push([Math.ceil(pw / 2), Math.ceil(ph / 2)]); }
  const acc = sizes.map(([lw, lh]) => new Float32Array(lw * lh * ch)), wsum = sizes.map(([lw, lh]) => new Float32Array(lw * lh));
  const margin = alignN * 4;
  const bands = imgs.map((im, k) => {
    const gx0 = Math.floor(Math.max(im.x0 - margin, 0) / alignN) * alignN, gy0 = Math.floor(Math.max(im.y0 - margin, 0) / alignN) * alignN;
    const gx1 = Math.min(im.x0 + im.w + margin, w), gy1 = Math.min(im.y0 + im.h + margin, h);
    const gw = Math.max(gx1 - gx0, 1), gh = Math.max(gy1 - gy0, 1);
    const px = new Float32Array(gw * gh * ch), cov = new Float32Array(gw * gh), wt = new Float32Array(gw * gh);
    for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++){
      const gx = im.x0 + x - gx0, gy = im.y0 + y - gy0;
      if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue;
      const i = y * im.w + x, g = gy * gw + gx;
      cov[g] = im.alpha[i]; wt[g] = weights[k][i] * Math.min(im.alpha[i], 1);
      for (let c = 0; c < ch; c++) px[g * ch + c] = im.px[i * ch + c];
    }
    const bin = new Float32Array(gw * gh); for (let i = 0; i < gw * gh; i++) bin[i] = cov[i] > 0.5 ? 1 : 0;
    pushPull(gw, gh, ch, px, bin);
    // 颜色取拉普拉斯、权重取高斯
    const lap = [], gau = [];
    let cw = gw, chh = gh, cur = px, cwt = wt;
    for (let l = 0; l < levels; l++){
      if (l + 1 === levels){ lap.push([cw, chh, cur]); gau.push(cwt); break; }
      const [nw, nh, down] = panReduce(cw, chh, ch, cur), up = panExpand(nw, nh, ch, down, cw, chh);
      const band = new Float32Array(cur.length); for (let i = 0; i < cur.length; i++) band[i] = cur[i] - up[i];
      lap.push([cw, chh, band]); gau.push(cwt);
      cwt = panReduce(cw, chh, 1, cwt)[2]; cw = nw; chh = nh; cur = down;
    }
    return [gx0, gy0, lap, gau];
  });
  for (const [gx0, gy0, lap, gau] of bands){
    lap.forEach(([lw, lh, band], l) => {
      const g = gau[l], ox = gx0 >> l, oy = gy0 >> l, [pw, ph] = sizes[l];
      for (let y = 0; y < lh; y++){
        const py = oy + y; if (py >= ph) break;
        for (let x = 0; x < lw; x++){
          const px = ox + x; if (px >= pw) break;
          const i = y * lw + x, p = py * pw + px, k = g[i];
          if (k <= 0) continue;
          wsum[l][p] += k;
          for (let c = 0; c < ch; c++) acc[l][p * ch + c] += k * band[i * ch + c];
        }
      }
    });
  }
  for (let l = 0; l < levels; l++){
    const [pw, ph] = sizes[l];
    for (let p = 0; p < pw * ph; p++){ const k = wsum[l][p]; for (let c = 0; c < ch; c++) acc[l][p * ch + c] = k > 1e-8 ? acc[l][p * ch + c] / k : 0; }
  }
  // 合回
  let cur = acc[levels - 1];
  for (let l = levels - 2; l >= 0; l--){
    const [pw, ph] = sizes[l], [sw, sh] = sizes[l + 1], up = panExpand(sw, sh, ch, cur, pw, ph);
    const nx = new Float32Array(pw * ph * ch); for (let i = 0; i < nx.length; i++) nx[i] = acc[l][i] + up[i];
    cur = nx;
  }
  // 覆盖度：各图的联集
  const cov = new Float32Array(w * h);
  for (const im of imgs) for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++){
    const px = im.x0 + x, py = im.y0 + y; if (px < 0 || py < 0 || px >= w || py >= h) continue;
    const p = py * w + px; cov[p] = Math.max(cov[p], im.alpha[y * im.w + x]);
  }
  return [cur, cov];
}
/* photo_cmds.rs:205 seam_blend（auto_blend 用法：gains=false、geometry=None）。
   panorama.rs:768 photometric 在 gain=false、vignette=false 时 773 行就早退回恒等 ⇒ 增益／暗角校正那段这里走不到（那是 Photomerge 的），整段略过。
   回传：每张图的接缝遮罩（ROI 范围）与合成图（canvas 范围 RGBA）。原码另回每张图「接缝内换成混合色」的像素层，auto_blend 不用（只取 .1 遮罩与 composite），略过 */
function seamBlend(warped, canvas, order, seamless){
  const n = warped.length;
  const rois = warped.map(S => { const b = Rc.inter(contentBounds(S), canvas); return b ? roiOf(S, b) : {x0:0, y0:0, w:0, h:0, ch:3, px:new Float32Array(0), alpha:new Float32Array(0)}; });
  // 接缝在 ≤ 1000 px 的格子上找
  const cw = Math.max(Rc.w(canvas), 1), chh = Math.max(Rc.h(canvas), 1);
  const s = Math.max(Math.ceil(Math.max(cw, chh) / 1000), 1), gw = Math.ceil(cw / s), gh = Math.ceil(chh / s);
  const luma = [], cover = [];
  rois.forEach(roi => {
    const acc0 = new Float64Array(gw * gh), acc1 = new Float64Array(gw * gh), acc2 = new Uint32Array(gw * gh);
    for (let y = 0; y < roi.h; y++) for (let x = 0; x < roi.w; x++){
      const u = roi.x0 - canvas[0] + x, v = roi.y0 - canvas[1] + y;
      const g = Math.min(Math.floor(v / s), gh - 1) * gw + Math.min(Math.floor(u / s), gw - 1), k = y * roi.w + x;
      let l = 0; for (let c = 0; c < roi.ch; c++) l += roi.px[k * roi.ch + c];
      acc0[g] += l / roi.ch; acc1[g] += roi.alpha[k]; acc2[g]++;
    }
    const lu = new Float32Array(gw * gh), cv = new Uint8Array(gw * gh);
    for (let g = 0; g < gw * gh; g++) if (acc2[g] > 0){ lu[g] = acc0[g] / acc2[g]; cv[g] = acc1[g] / (s * s) > 0.98 ? 1 : 0; }
    luma.push(lu); cover.push(cv);
  });
  const labels = seamLabels(gw, gh, luma, cover, order);
  // 全尺寸权重：接缝标签；标签那张图在这里没覆盖时，退回 order 里最早覆盖它的那张
  const rank = new Array(n).fill(Infinity); order.forEach((i, k) => { rank[i] = k; });
  const alphaAt = (j, x, y) => { const r = rois[j], lx = x - r.x0, ly = y - r.y0; return (lx < 0 || ly < 0 || lx >= r.w || ly >= r.h) ? 0 : r.alpha[ly * r.w + lx]; };
  const weights = rois.map((roi, i) => {
    const wt = new Float32Array(roi.w * roi.h);
    for (let k = 0; k < roi.w * roi.h; k++){
      const x = roi.x0 + k % roi.w, y = roi.y0 + Math.floor(k / roi.w);
      if (roi.alpha[k] < 0.5) continue;
      const u = x - canvas[0], v = y - canvas[1];
      const lab = labels[Math.min(Math.floor(v / s), gh - 1) * gw + Math.min(Math.floor(u / s), gw - 1)];
      if (lab === i){ wt[k] = 1; continue; }
      if (lab >= 0 && alphaAt(lab, x, y) >= 0.5) continue;
      let first = -1; for (let j = 0; j < n; j++) if (alphaAt(j, x, y) >= 0.5 && (first < 0 || rank[j] < rank[first])) first = j;
      if (first === i) wt[k] = 1;
    }
    return wt;
  });
  // ROI 换成相对 canvas 的坐标再混
  const local = rois.map(r => Object.assign({}, r, {x0:r.x0 - canvas[0], y0:r.y0 - canvas[1]}));
  const levels = seamless ? Math.min(blendLevels(cw, chh), 7) : 1;
  const [blend, cov] = multiband(cw, chh, local, weights, levels);
  const composite = new Float32Array(cw * chh * 4);
  for (let i = 0; i < cw * chh; i++){ for (let c = 0; c < 3; c++) composite[i * 4 + c] = clamp(blend[i * 3 + c], 0, 1); composite[i * 4 + 3] = cov[i]; }
  return {rois, weights, composite};
}
/* photo_cmds.rs:375 seam_order：参考图先，其余照中心离参考中心的距离 */
function seamOrder(warped, reference){
  const centre = S => { const b = contentBounds(S) || [0, 0, 0, 0]; return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
  const rc = centre(warped[Math.min(reference, warped.length - 1)]);
  const order = warped.map((_, i) => i);
  const d = order.map(i => { const c = centre(warped[i]); return Math.hypot(c[0] - rc[0], c[1] - rc[1]); });
  order.sort((a, b) => ((a !== reference) - (b !== reference)) || (d[a] - d[b]) || (a - b));
  return order;
}

/* ═══════════ pyramid.rs：多分辨率混合（堆叠用） ═══════════ */
const PK = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
/* pyramid.rs:26 reduce（Burt & Adelson REDUCE） */
function pyrReduce(l, ch){
  const w = Math.ceil(l.w / 2), h = Math.ceil(l.h / 2);
  const tmp = new Float32Array(w * l.h * ch);
  for (let y = 0; y < l.h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 5; k++){
    const sx = clamp(2 * x + k - 2, 0, l.w - 1);
    for (let c = 0; c < ch; c++) tmp[(y * w + x) * ch + c] += PK[k] * l.px[(y * l.w + sx) * ch + c];
  }
  const px = new Float32Array(w * h * ch);
  for (let y = 0; y < h; y++) for (let k = 0; k < 5; k++){
    const sy = clamp(2 * y + k - 2, 0, l.h - 1);
    for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) px[(y * w + x) * ch + c] += PK[k] * tmp[(sy * w + x) * ch + c];
  }
  return {w, h, px};
}
/* pyramid.rs:55 expand（补零＋同一滤波、×4 增益） */
function pyrExpand(l, ch, w, h){
  const tmp = new Float32Array(w * l.h * ch);
  for (let y = 0; y < l.h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 5; k++){
    const t = x + k - 2; if (((t % 2) + 2) % 2 !== 0) continue;
    const sx = clamp(t / 2, 0, l.w - 1);
    for (let c = 0; c < ch; c++) tmp[(y * w + x) * ch + c] += 2 * PK[k] * l.px[(y * l.w + sx) * ch + c];
  }
  const out = new Float32Array(w * h * ch);
  for (let y = 0; y < h; y++) for (let k = 0; k < 5; k++){
    const t = y + k - 2; if (((t % 2) + 2) % 2 !== 0) continue;
    const sy = clamp(t / 2, 0, l.h - 1);
    for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) out[(y * w + x) * ch + c] += 2 * PK[k] * tmp[(sy * w + x) * ch + c];
  }
  return out;
}
/* pyramid.rs:90 gaussian／104 laplacian／119 collapse／129 auto_levels */
function gaussianPyr(w, h, ch, px, levels){
  const out = [{w, h, px:Float32Array.from(px)}];
  while (out.length < Math.max(levels, 1)){ const last = out[out.length - 1]; if (last.w <= 1 && last.h <= 1) break; out.push(pyrReduce(last, ch)); }
  return out;
}
function laplacianPyr(w, h, ch, px, levels){
  const g = gaussianPyr(w, h, ch, px, levels);
  return g.map((l, i) => {
    if (i + 1 === g.length) return l;
    const up = pyrExpand(g[i + 1], ch, l.w, l.h), d = new Float32Array(l.px.length);
    for (let k = 0; k < d.length; k++) d[k] = l.px[k] - up[k];
    return {w:l.w, h:l.h, px:d};
  });
}
function collapsePyr(pyr, ch){
  let cur = pyr[pyr.length - 1];
  for (let i = pyr.length - 2; i >= 0; i--){
    const l = pyr[i], up = pyrExpand(cur, ch, l.w, l.h), d = new Float32Array(l.px.length);
    for (let k = 0; k < d.length; k++) d[k] = l.px[k] + up[k];
    cur = {w:l.w, h:l.h, px:d};
  }
  return cur.px;
}
function autoLevels(w, h){ let n = 1, s = Math.min(w, h); while (s > 8 && n < 10){ s = Math.floor(s / 2); n++; } return n; }
/* pyramid.rs:140 blend：每层用自己平滑过的权重加权平均，合回、夹 0..1 */
function pyrBlend(w, h, ch, images, weights, levels){
  levels = Math.max(levels, 1);
  let acc = null, wsum = null;
  images.forEach((img, n) => {
    const lp = laplacianPyr(w, h, ch, img, levels), gp = gaussianPyr(w, h, 1, weights[n], levels);
    if (!acc) acc = lp.map(l => ({w:l.w, h:l.h, px:new Float32Array(l.px.length)}));
    if (!wsum) wsum = gp.map(l => ({w:l.w, h:l.h, px:new Float32Array(l.px.length)}));
    lp.forEach((l, li) => {
      const g = gp[li];
      for (let i = 0; i < l.w * l.h; i++){ const k = g.px[i]; wsum[li].px[i] += k; for (let c = 0; c < ch; c++) acc[li].px[i * ch + c] += k * l.px[i * ch + c]; }
    });
  });
  if (!acc) return new Float32Array(w * h * ch);
  acc.forEach((l, li) => { const sl = wsum[li]; for (let i = 0; i < l.w * l.h; i++){ const k = sl.px[i]; for (let c = 0; c < ch; c++) l.px[i * ch + c] = k > 1e-6 ? l.px[i * ch + c] / k : 0; } });
  const out = collapsePyr(acc, ch);
  for (let i = 0; i < out.length; i++) out[i] = clamp(out[i], 0, 1);
  return out;
}
/* 照 PS 补「无缝色调和颜色」（堆叠）：原码是多频段混合（pyramid.rs blend），两张图底色不同时会在物件四周留一圈原图的颜色（光晕）。
   PS 的无缝色调是梯度域：每块区域保留自己那张图的纹理（梯度），颜色在接缝上跟旁边接齐。
   做法：先放「覆盖最多」那张当底，其余每张在它赢的那块（权重 1、不透明）做一次 seamless clone（Pérez 2003；借 HealCore 的 poisson.rs 翻译）。 */
function poissonStack(w, h, imgs, weights){
  const N = w * h, area = weights.map(wt => { let n = 0; for (let i = 0; i < N; i++) if (wt[i] > 0.5) n++; return n; });
  const base = area.indexOf(Math.max(...area));
  let out = Float32Array.from(imgs[base]);
  imgs.forEach((src, k) => {
    if (k === base || !area[k]) return;
    const m = new Uint8Array(N);
    // 叠在底图上的这张：它整块不透明的范围都算（平坦的物件内部清晰度低、会被判给底图，但它跟这张的原背景差得远 ⇒ 下面的 α 会认回物件）
    for (let i = 0; i < N; i++) m[i] = src[i * 4 + 3] > 0.5 ? 1 : 0;
    // src 透明处先补色（fillHoles）：多重网格的粗格会把遮罩外的 (dst−src) 平均进来，透明格的 src＝0 会把整块抬亮
    const S = fillHoles(w, h, src), D = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++){ S[i] *= 255; D[i] = out[i] * 255; }          // poisson.rs 的收敛门槛是照 0..255 定的
    // 遮罩里「跟原图背景同色的那圈」（例：扩展选区多带进来的原图天空）不算物件：用遮罩边上的原图颜色往里调和内插当「原图背景」，
    // 跟它差不到 24（RGB 和，0..255）的格子交回新背景；剩下真正的物件才做 seamless clone（边界就贴着物件，色调跟新背景接齐）
    // 「原图背景」只取遮罩内缘那一圈的真实颜色（遮罩外是补出来的色、不准）：内缘当已知、遮罩里面当洞；遮罩外填内缘平均色免得粗格被带偏
    const edge = new Uint8Array(N), hole = new Uint8Array(N), T = new Float32Array(N * 4), avg = [0, 0, 0, 0]; let ne = 0;
    for (let i = 0; i < N; i++){ if (!m[i]) continue; const x = i % w, y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w]){ edge[i] = 1; ne++; for (let c = 0; c < 4; c++) avg[c] += S[i * 4 + c]; } else hole[i] = 1; }
    for (let i = 0; i < N; i++) for (let c = 0; c < 4; c++) T[i * 4 + c] = m[i] ? S[i * 4 + c] : avg[c] / Math.max(1, ne);
    const est = HealCore.membraneFill(w, h, 4, T, hole);
    // 色调只在「重叠区」（物件四周那圈原图背景）换成新背景，物件本身的颜色原封不动（不把新背景的颜色染进主体）：
    // 每格估物件覆盖度 α（跟原图背景差多少；差 ≥ 72 当全是物件），去背：新色＝原色＋(1−α)·(新背景−原图背景)
    //   α＝1 ⇒ 原色；α＝0 ⇒ 新背景（＋原图背景的细小纹理）；边上半透明的格子把原图背景的色偏换成新背景的（不留一圈原图的颜色）
    for (let i = 0; i < N; i++){
      if (!m[i]) continue;
      const diff = Math.abs(S[i * 4] - est[i * 4]) + Math.abs(S[i * 4 + 1] - est[i * 4 + 1]) + Math.abs(S[i * 4 + 2] - est[i * 4 + 2]);
      const a = edge[i] ? 0 : clamp((diff - 12) / 60, 0, 1);
      for (let c = 0; c < 3; c++) out[i * 4 + c] = (S[i * 4 + c] + (1 - a) * (D[i * 4 + c] - est[i * 4 + c])) / 255;
      out[i * 4 + 3] = Math.max(out[i * 4 + 3], src[i * 4 + 3]);
    }
  });
  for (let i = 0; i < out.length; i++) out[i] = clamp(out[i], 0, 1);
  return out;
}
PE.autoBlendKit = {poissonStack:(...a) => poissonStack(...a), fillHoles:(...a) => fillHoles(...a), stackWeights:(...a) => stackWeights(...a)};   // 给测试
/* 照 PS 补：多频段混合前把每张图透明处的颜色用周围不透明的颜色补满（push-pull：一路 2×2 缩到底，再由粗往细填洞）。
   原码直接拿透明格的 (0,0,0) 进拉普拉斯金字塔 ⇒ 透明边的黑台阶在粗层被权重抹开，融合层在物件四周出现一圈光晕／暗边。
   只补 RGB，alpha 照旧（透明处权重本来就是 0） */
function fillHoles(w, h, px){
  const out = Float32Array.from(px);
  let hole = false; for (let i = 3; i < px.length; i += 4) if (px[i] < 0.999){ hole = true; break; }
  if (!hole) return out;
  const levels = [];                                               // 每层 {w,h,c:[r*a,g*a,b*a,a]}
  let cw = w, chh = h, cur = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++){ const a = px[i * 4 + 3]; cur[i * 4] = px[i * 4] * a; cur[i * 4 + 1] = px[i * 4 + 1] * a; cur[i * 4 + 2] = px[i * 4 + 2] * a; cur[i * 4 + 3] = a; }
  levels.push({w:cw, h:chh, c:cur});
  while (cw > 1 || chh > 1){
    const nw = Math.max(1, Math.ceil(cw / 2)), nh = Math.max(1, Math.ceil(chh / 2)), nx = new Float32Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++){
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++){
        const sx = Math.min(cw - 1, 2 * x + dx), sy = Math.min(chh - 1, 2 * y + dy), j = (sy * cw + sx) * 4, k = (y * nw + x) * 4;
        for (let c = 0; c < 4; c++) nx[k + c] += cur[j + c] / 4;
      }
    }
    cw = nw; chh = nh; cur = nx; levels.push({w:cw, h:chh, c:cur});
  }
  // 由粗往细：每层的颜色＝自己（预乘÷alpha）跟上一层（较粗）按 alpha 混
  let up = null;
  for (let li = levels.length - 1; li >= 0; li--){
    const L = levels[li], col = new Float32Array(L.w * L.h * 3);
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++){
      const k = (y * L.w + x), a = up ? Math.min(1, L.c[k * 4 + 3]) : (L.c[k * 4 + 3] > 1e-6 ? 1 : 0);   // 最粗那层没得往上借：有墨就全用自己的
      let ur = 0, ug = 0, ub = 0;
      if (up){ const U = levels[li + 1], ux = Math.min(U.w - 1, x >> 1), uy = Math.min(U.h - 1, y >> 1), u = (uy * U.w + ux) * 3; ur = up[u]; ug = up[u + 1]; ub = up[u + 2]; }
      const own = a > 1e-6 ? 1 / L.c[k * 4 + 3] : 0;
      col[k * 3]     = a * (L.c[k * 4] * own)     + (1 - a) * ur;
      col[k * 3 + 1] = a * (L.c[k * 4 + 1] * own) + (1 - a) * ug;
      col[k * 3 + 2] = a * (L.c[k * 4 + 2] * own) + (1 - a) * ub;
    }
    up = col;
  }
  for (let i = 0; i < w * h; i++){ if (px[i * 4 + 3] >= 0.999) continue; out[i * 4] = up[i * 3]; out[i * 4 + 1] = up[i * 3 + 1]; out[i * 4 + 2] = up[i * 3 + 2]; }
  return out;
}
/* pyramid.rs:194 winner_take_all：每像素分数最高的那张权重 1 */
function winnerTakeAll(scores, n){
  const out = scores.map(() => new Float32Array(n));
  for (let i = 0; i < n; i++){
    let b0 = 0, b1 = -Infinity;
    scores.forEach((s, k) => { if (s[i] > b1){ b0 = k; b1 = s[i]; } });
    if (b1 > -Infinity) out[b0][i] = 1;
  }
  return out;
}
/* pyramid.rs:212 stack_weights：景深合成——平滑后的 |∇²L| 最大的那张赢 */
function stackWeights(w, h, luma, alpha){
  const radius = clamp(Math.floor(Math.min(w, h) / 64), 2, 12);
  const scores = luma.map((l, n) => {
    const lap = new Float32Array(w * h), al = alpha[n];
    // 照 PS 补（原码 pyramid.rs:221 直接拿透明格的 0 来算）：透明的邻格不算图像内容、当成跟中心一样——
    // 不然「只有一块的图层」（例如抠出来贴上的飞机连一圈天空）在透明边上 |∇²L| 爆大，整圈边框都判成它最清楚，融不掉方框
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const i = y * w + x; if (!(al[i] > 0.5)) continue;
      const c = l[i], nb = j => al[j] > 0.5 ? l[j] : c;
      const xl = Math.max(x - 1, 0), xr = Math.min(x + 1, w - 1), yu = Math.max(y - 1, 0), yd = Math.min(y + 1, h - 1);
      lap[i] = Math.abs(nb(y * w + xl) + nb(y * w + xr) + nb(yu * w + x) + nb(yd * w + x) - 4 * c);
    }
    const b = boxBlur(w, h, lap, radius), a = alpha[n], sc = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) sc[i] = a[i] > 0.5 ? b[i] : -1;
    return sc;
  });
  return winnerTakeAll(scores, w * h);
}

/* ═══════════ 图层：选哪几层、锁、背景层、蒙版 ═══════════ */
function isBg(L){
  if (window.PsLayer && PsLayer.isBackground) return PsLayer.isBackground(L);
  if (!L || Doc.layers[0] !== L || L.kind !== 'raster') return false;
  if (L.isBackground !== undefined) return !!L.isBackground;
  return ['背景', 'Background', T('layer.bg')].includes(L.name);
}
/* 背景层被搬动／加蒙版 ⇒ 变成普通层「图层 0」（照 PS；ps-layer.js unlockBackground 同一套） */
function floatBackground(L){
  if (!isBg(L)) return;
  L.name = T('layer.untitled') + ' 0'; L.isBackground = false;
  if (L.locks){ L.locks.transparency = false; L.locks.position = false; }
}
const lockedMsg = L => `Could not complete your request because the layer "${L.name}" is locked`;
function hasContent(L){
  const cv = L.data.canvas; if (!cv.width || !cv.height) return false;
  const d = L.data.ctx.getImageData(0, 0, cv.width, cv.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
  return false;
}
/* align_cmds.rs:33 selected_pixel_layers：选中的层里的像素层，由下到上。
   我们的图层面板没有多选：p.layers／p.ids ＞ Doc.selectedIds（图层菜单的多选，须含当前层）＞ 全部可见、有内容的像素层 */
function targetIds(p){
  p = p || {};
  let ids = Array.isArray(p.layers) && p.layers.length ? p.layers : Array.isArray(p.ids) && p.ids.length ? p.ids : null;
  if (ids){ for (const id of ids) if (!Doc.byId(id)) return {error:`no such layer: ${id}`}; }
  else if (Array.isArray(Doc.selectedIds) && Doc.selectedIds.length >= 2 && Doc.selectedIds.includes(Doc.activeId)) ids = Doc.selectedIds.filter(id => Doc.byId(id));
  else ids = Doc.layers.filter(L => L.kind === 'raster' && L.visible && hasContent(L)).map(L => L.id);
  ids = [...new Set(ids)].filter(id => { const L = Doc.byId(id); return L && L.kind === 'raster'; });
  ids.sort((a, b) => Doc.index(a) - Doc.index(b));
  return {ids};
}
/* 蒙版（engine 与 ps-layer.js 同一格式）：一张跟图层画布一样大的画布，白＋alpha＝露出多少；
   composite 把图层画布与蒙版都拉成文件大小再套 ⇒ 要画布＝文件大小、原点 (0,0) 才对得准 ⇒ 要挂蒙版的层先摆正（画布外的像素会裁掉） */
function normalizeToDoc(L){
  const cv = L.data.canvas;
  if (L.x === 0 && L.y === 0 && cv.width === Doc.width && cv.height === Doc.height) return;
  const c = document.createElement('canvas'); c.width = Doc.width; c.height = Doc.height;
  const x = c.getContext('2d', {willReadFrequently:true});
  x.drawImage(cv, L.x, L.y);
  L.data.canvas = c; L.data.ctx = x; L.x = 0; L.y = 0; Layer.invalidate(L);
}
let _mseq = 0;
const maskObj = (c, x) => ({id:'Mal' + (++_mseq), kind:'raster', name:'mask', visible:true, opacity:1, blend:'normal', mask:null, x:0, y:0, _cache:null, _cacheScale:0, data:{canvas:c, ctx:x}});

/* ═══════════ align_cmds.rs:43 auto_align ═══════════ */
function autoAlign(p){
  const t = targetIds(p); if (t.error) return fail(t.error);
  const ids = t.ids;
  if (ids.length < 2) return fail('select two or more pixel layers');
  const projection = typeof p.projection === 'string' ? p.projection : 'auto';
  const layout = Layout.parse(projection);
  if (!layout) return fail(`unknown projection \`${projection}\` (auto|perspective|cylindrical|spherical|collage|reposition)`);
  let reference = ids[0];
  if (p.reference !== undefined && p.reference !== null){
    if (!ids.includes(p.reference)) return fail(`reference ${p.reference} is not a selected pixel layer`);
    reference = p.reference;
  }
  const refIdx = Math.max(ids.indexOf(reference), 0);
  const area = docRect();
  // 有蒙版的层先摆正（蒙版跟着一起变形，格式要求画布＝文件）；没蒙版的层原样读（画布外的像素也算）
  const Ls = ids.map(id => Doc.byId(id));
  const surfs = Ls.map(L => surfOfLayer(L));
  const geometric = p.geometricCorrection === true;
  // 我们的文件没有 EXIF ⇒ focal35 恒为 None（原码 align_cmds.rs:63 读 doc.metadata.exif）
  const al = register(surfs.map(s => [s, area]), layout, refIdx, geometric, null);
  if (!al) return fail("Auto-Align couldn't find enough matching detail between the layers");
  const interp = interpOf(typeof p.interpolation === 'string' ? p.interpolation : 'bicubic');
  const planar = al.layout === 'perspective' || al.layout === 'collage' || al.layout === 'reposition';
  const inliers = new Array(ids.length).fill(0);
  for (const [a, b, n] of al.pairs){ inliers[a] += n; inliers[b] += n; }
  // 平面版式参考层不动；圆柱／球面每层都重投影
  const moves = [], failed = [];
  for (let i = 0; i < ids.length; i++){
    if (!al.placements[i]) failed.push(ids[i]);
    else if (i !== refIdx || !planar) moves.push(i);
  }
  if (!moves.length) return fail("Auto-Align couldn't find enough matching detail between the layers");
  // 锁：会搬的层要能改像素与位置（PS：锁定的层不能自动对齐）
  for (const i of moves){ const L = Ls[i]; if (Locks.blocks(L, ['pixels', 'position'])) return fail(lockedMsg(L)); }
  const warped = moves.map(i => {
    const L = Ls[i], pl = al.placements[i];
    const masked = !!(L.mask || L.maskOff);
    const S = masked ? readDocSurf(L) : surfs[i];
    const b = contentBounds(S);
    const px = b ? warpPlaced(S, b, [0, 0], pl, [0, 0], interp) : S;
    let mask = null;
    const M = L.mask || L.maskOff;
    if (M){
      const ms = surfOfCanvas(M.data.canvas, 0, 0), mb = contentBounds(ms);
      mask = mb ? warpPlaced(ms, mb, [0, 0], pl, [0, 0], 'bilinear') : ms;
    }
    return {L, px, mask, masked};
  });
  // s.edit：写回（一步历史由 CMD.run 负责）
  for (const {L, px, mask, masked} of warped){
    floatBackground(L);
    const cb = contentBounds(px);
    const rect = masked ? docRect() : (Rc.union(docRect(), cb) || docRect());   // 没蒙版：画布涵盖文件＋搬出去的像素
    const {c, x} = canvasOf(readRegion(px, rect), Rc.w(rect), Rc.h(rect));
    L.data.canvas = c; L.data.ctx = x; L.x = rect[0]; L.y = rect[1]; Layer.invalidate(L);
    if (mask){
      const M = L.mask || L.maskOff, mc = canvasOf(readRegion(mask, docRect()), Doc.width, Doc.height);
      M.data.canvas = mc.c; M.data.ctx = mc.x; M._cache = null; M._cacheScale = 0;
    }
  }
  const model = al.layout === 'reposition' ? 'reposition' : al.layout === 'collage' ? 'collage' : (al.layout === 'perspective' || al.layout === 'auto') ? 'perspective' : al.layout;
  const aligned = moves.filter(i => al.placements[i]).map(i => {
    const m = planeMatrix(al.placements[i], [0, 0]);
    return {layer:ids[i], model, matches:inliers[i], matrix:m ? m.map(v => +v.toFixed(6)) : null};
  });
  return {ok:true, reference, layout:al.layout, focal:al.focal, rms:al.rms, aligned, failed};
}
/* 有蒙版的层：摆到文件范围读（画布外裁掉，跟 normalizeToDoc 一致） */
function readDocSurf(L){
  const c = document.createElement('canvas'); c.width = Doc.width; c.height = Doc.height;
  c.getContext('2d').drawImage(L.data.canvas, L.x, L.y);
  return surfOfCanvas(c, 0, 0);
}

/* ═══════════ align_cmds.rs:130 auto_blend ═══════════ */
function autoBlend(p){
  const t = targetIds(p); if (t.error) return fail(t.error);
  const ids = t.ids;
  if (ids.length < 2) return fail('select two or more pixel layers');
  const method = p.method === undefined || p.method === null ? 'panorama' : p.method;
  if (method !== 'panorama' && method !== 'stack') return fail('`method` must be panorama|stack');
  const seamless = typeof p.seamlessTones === 'boolean' ? p.seamlessTones : true;
  const Ls = ids.map(id => Doc.byId(id));
  for (const L of Ls) if (Locks.blocks(L, 'all')) return fail(lockedMsg(L));   // 全部锁定连蒙版都不能加
  const surfs = Ls.map(L => surfOfLayer(L));
  let area = null;
  for (const S of surfs) area = Rc.union(area, contentBounds(S));
  area = Rc.inter(area, docRect());
  if (!area) return fail('the selected layers are empty');
  const w = Rc.w(area), h = Rc.h(area);
  const imgs = [], luma = [], alpha = [];
  for (const S of surfs){
    const px = readRegion(S, area), lv = new Float32Array(w * h), av = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++){ lv[i] = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]; av[i] = px[i * 4 + 3]; }
    imgs.push(px); luma.push(lv); alpha.push(av);
  }
  let weights, blended = null;
  if (method === 'stack'){
    weights = stackWeights(w, h, luma, alpha);
    if (seamless) blended = (window.HealCore && HealCore.seamlessClone) ? poissonStack(w, h, imgs, weights) : pyrBlend(w, h, 4, imgs.map(px => fillHoles(w, h, px)), weights, autoLevels(w, h));
  } else {
    // 全景：接缝走两张图一致的地方，多频段混合（photo_cmds）
    const order = seamOrder(surfs, 0);
    const b = seamBlend(surfs, area, order, seamless);
    weights = b.rois.map((roi, i) => {
      const out = new Float32Array(w * h), wt = b.weights[i];
      for (let y = 0; y < roi.h; y++) for (let x = 0; x < roi.w; x++){
        const ax = roi.x0 + x - area[0], ay = roi.y0 + y - area[1];
        if (ax >= 0 && ay >= 0 && ax < w && ay < h) out[ay * w + ax] = wt[y * roi.w + x];
      }
      return out;
    });
    if (seamless) blended = b.composite;
  }
  // s.edit：每层一张「全藏」蒙版，area 里写权重
  ids.forEach((id, n) => {
    const L = Doc.byId(id);
    floatBackground(L);
    normalizeToDoc(L);
    const c = document.createElement('canvas'); c.width = Doc.width; c.height = Doc.height;
    const x = c.getContext('2d', {willReadFrequently:true}), img = x.createImageData(w, h), d = img.data, wt = weights[n];
    for (let i = 0; i < w * h; i++){ d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = Math.round(clamp(wt[i], 0, 1) * 255); }
    x.putImageData(img, area[0], area[1]);
    L.mask = maskObj(c, x); delete L.maskOff;
    Layer.invalidate(L);
  });
  let newId = null;
  if (blended){
    // PS：结果层叫「<最上面那层的名字> (合并)」
    const topL = Doc.byId(ids[ids.length - 1]), N = Layer.raster((topL ? topL.name : T('layer.untitled')) + T('pse3.align.mergedSuffix'));
    const {c} = canvasOf(blended, w, h);
    N.data.ctx.drawImage(c, area[0], area[1]);
    Doc.add(N, Doc.index(ids[ids.length - 1]) + 1);        // insert_above(top)，并设为当前层
    newId = N.id;
  }
  return {ok:true, method, layers:ids, blended:newId};
}
/* doc/src/lib.rs next_layer_name：「底名 n」取最小没用过的 n */
function nextLayerName(base){
  const names = new Set(Doc.layers.map(L => L.name));
  for (let n = 1; n <= names.size + 1; n++){ const s = `${base} ${n}`; if (!names.has(s)) return s; }
  return base;
}

/* ═══════════ 对话框（prefs_ui.rs:420 通用对话框：栏位照 specs、拿掉 reference） ═══════════ */
function ensureStyle(){
  if (document.getElementById('pse3-align')) return;
  const s = document.createElement('style'); s.id = 'pse3-align';
  s.textContent = `
.pse3-al-radios{display:grid;grid-template-columns:repeat(3,auto);gap:4px 14px}
.pse3-al-radios label{display:flex;align-items:center;gap:5px;cursor:pointer;white-space:nowrap}
.pse3-al-info{color:#9aa3b0;font-size:12px;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;
  document.head.appendChild(s);
}
/* 单选组：画面上是一排 radio，值放在一个藏起来的 data-k 控件里（对话框收值走它） */
function radioGroup(body, f, k, label, options, value){
  const row = document.createElement('div'); row.className = 'pse-row';
  const lb = document.createElement('span'); lb.className = 'lb'; lb.textContent = label; row.appendChild(lb);
  const box = document.createElement('div'); box.className = 'pse3-al-radios';
  const hid = document.createElement('input'); hid.type = 'hidden'; hid.dataset.k = k; hid.value = value; f[k] = hid;
  options.forEach(([v, txt]) => {
    const l = document.createElement('label'), r = document.createElement('input');
    r.type = 'radio'; r.name = 'pse3-al-' + k; r.value = v; r.checked = v === value;
    r.addEventListener('change', () => { if (r.checked) hid.value = v; });
    const s = document.createElement('span'); s.textContent = txt;
    l.appendChild(r); l.appendChild(s); box.appendChild(l);
  });
  row.appendChild(box); row.appendChild(hid); body.appendChild(row);
}
function infoRow(body, ids){
  const row = document.createElement('div'); row.className = 'pse-row';
  const lb = document.createElement('span'); lb.className = 'lb'; lb.textContent = T('pse3.align.layers'); row.appendChild(lb);
  const v = document.createElement('span'); v.className = 'pse3-al-info';
  v.textContent = ids.map(id => Doc.byId(id).name).join('、') + ` (${ids.length})`;
  row.appendChild(v); body.appendChild(row);
}
/* prefs_ui.rs:421 没启用（选不到两层像素层）：不开框、回「… is not available right now」 */
function notAvailable(label){
  const msg = T('pse3.align.need2');
  if (window.Locks && Locks.notify) Locks.notify(msg);
  return fail(`${label} is not available right now: select two or more pixel layers`);
}
function openAlignDialog(){
  const t = targetIds({});
  if (t.error || t.ids.length < 2) return notAvailable('Auto-Align Layers');
  ensureStyle();
  return PE.dialog.open({cmd:'ps.edit.autoAlignLayers', title:T('pse3.align.alignTitle'), rows:[],
    build(body, addRow, f){
      infoRow(body, t.ids);
      // PS 版面的顺序：自动／透视／拼贴／圆柱／球面／调整位置
      radioGroup(body, f, 'projection', T('pse3.align.projection'),
        ['auto', 'perspective', 'collage', 'cylindrical', 'spherical', 'reposition'].map(v => [v, T('pse3.align.p.' + v)]), 'auto');
      addRow({section:T('pse3.align.lens')}, body);
      addRow({k:'geometricCorrection', label:'', type:'check', text:T('pse3.align.geometric'), value:false}, body);
      addRow({k:'interpolation', label:T('pse3.align.interp'), type:'select', value:'bicubic',
        options:['bicubic', 'bilinear', 'nearest'].map(v => [v, T('pse3.align.i.' + v)])}, body);
    },
    ok(v){ return CMD.run('ps.edit.autoAlignLayers', {projection:v.projection, geometricCorrection:!!v.geometricCorrection, interpolation:v.interpolation}); },
  });
}
function openBlendDialog(){
  const t = targetIds({});
  if (t.error || t.ids.length < 2) return notAvailable('Auto-Blend Layers');
  ensureStyle();
  return PE.dialog.open({cmd:'ps.edit.autoBlendLayers', title:T('pse3.align.blendTitle'), rows:[],
    build(body, addRow, f){
      infoRow(body, t.ids);
      radioGroup(body, f, 'method', T('pse3.align.method'), ['panorama', 'stack'].map(v => [v, T('pse3.align.m.' + v)]), 'panorama');
      addRow({k:'seamlessTones', label:'', type:'check', text:T('pse3.align.seamless'), value:true}, body);
    },
    ok(v){ return CMD.run('ps.edit.autoBlendLayers', {method:v.method, seamlessTones:!!v.seamlessTones}); },
  });
}

/* ═══════════ 登记（align_cmds.rs:223 specs） ═══════════ */
CMD.reg('ps.edit.autoAlignLayers', {i18n:'', undoable:true, params:'{projection:"auto"|"perspective"|"cylindrical"|"spherical"|"collage"|"reposition"="auto"（reposition＝仅调整位置）, reference?:图层 id（不动的参考层；缺省＝最底下那层）, geometricCorrection:bool=false（几何扭曲：多估一个径向畸变 k1）, interpolation:"bicubic"|"bilinear"|"nearest"="bicubic", layers?|ids?:[图层 id…]（缺省＝Doc.selectedIds 多选里的像素层；没多选＝全部可见、有内容的像素层）} 自动对齐图层：Harris 角点＋steered BRIEF 两两配对、RANSAC＋Brown–Lowe 验证、从参考层的最大生成树串接、LM 光束平差，再把各层重采样搬过去（至少 2 层；一步历史）→ {reference, layout, focal, rms, aligned:[{layer, model, matches, matrix}], failed:[对不上的层 id]}（align_cmds.rs auto_align）'}, p => autoAlign(p || {}));
CMD.reg('ps.edit.autoAlignLayers.dialog', {i18n:'', params:'{} 开「自动对齐图层」对话框（投影：自动／透视／拼贴／圆柱／球面／仅调整位置；镜头校正：几何扭曲；插值）；确定＝跑 ps.edit.autoAlignLayers。不到两层像素层时不开框、回错误'}, () => openAlignDialog());
CMD.reg('ps.edit.autoBlendLayers', {i18n:'', undoable:true, params:'{method:"panorama"|"stack"="panorama"（全景图｜堆叠图像）, seamlessTones:bool=true（无缝色调和颜色：另加一层多频段混合好的「混合 n」）, layers?|ids?:[图层 id…]（缺省同自动对齐）} 自动混合图层：每层加一张图层蒙版——堆叠＝每像素最清楚（平滑后 |∇²L| 最大）那层露出；全景＝每区一层、接缝走在两层颜色一致处（至少 2 层；一步历史）→ {method, layers, blended:新层 id|null}（align_cmds.rs auto_blend）'}, p => autoBlend(p || {}));
CMD.reg('ps.edit.autoBlendLayers.dialog', {i18n:'', params:'{} 开「自动混合图层」对话框（混合方法：全景图／堆叠图像；无缝色调和颜色）；确定＝跑 ps.edit.autoBlendLayers。不到两层像素层时不开框、回错误'}, () => openBlendDialog());

/* 给自测／别的段用 */
PE._alignAlgo = {harris, describe, matchDescriptors, fitModel, ransacMotion, register, warpSurface, warpMeshSurface, seamLabels, multiband, pyrBlend, stackWeights, Pl, Hm, Rng};

Lang.add({
  'zh-Hant':{
    'pse3.align.alignTitle':'自動對齊圖層', 'pse3.align.blendTitle':'自動混合圖層', 'pse3.align.layers':'圖層',
    'pse3.align.projection':'投影', 'pse3.align.p.auto':'自動', 'pse3.align.p.perspective':'透視', 'pse3.align.p.collage':'拼貼',
    'pse3.align.p.cylindrical':'圓筒形', 'pse3.align.p.spherical':'球面', 'pse3.align.p.reposition':'僅重新定位',
    'pse3.align.lens':'鏡頭校正', 'pse3.align.geometric':'幾何扭曲', 'pse3.align.interp':'內插補點',
    'pse3.align.i.bicubic':'環迴增值法', 'pse3.align.i.bilinear':'縱橫增值法', 'pse3.align.i.nearest':'最接近像素',
    'pse3.align.method':'混合方式', 'pse3.align.m.panorama':'全景', 'pse3.align.m.stack':'堆疊影像', 'pse3.align.seamless':'無縫色調和顏色',
    'pse3.align.blended':'混合', 'pse3.align.mergedSuffix':' (合併)', 'pse3.align.need2':'需要兩個以上的像素圖層（選取圖層或讓它們可見）',
  },
  'zh-Hans':{
    'pse3.align.alignTitle':'自动对齐图层', 'pse3.align.blendTitle':'自动混合图层', 'pse3.align.layers':'图层',
    'pse3.align.projection':'投影', 'pse3.align.p.auto':'自动', 'pse3.align.p.perspective':'透视', 'pse3.align.p.collage':'拼贴',
    'pse3.align.p.cylindrical':'圆柱', 'pse3.align.p.spherical':'球面', 'pse3.align.p.reposition':'仅调整位置',
    'pse3.align.lens':'镜头校正', 'pse3.align.geometric':'几何扭曲', 'pse3.align.interp':'插值',
    'pse3.align.i.bicubic':'两次立方', 'pse3.align.i.bilinear':'两次线性', 'pse3.align.i.nearest':'邻近',
    'pse3.align.method':'混合方法', 'pse3.align.m.panorama':'全景图', 'pse3.align.m.stack':'堆叠图像', 'pse3.align.seamless':'无缝色调和颜色',
    'pse3.align.blended':'混合', 'pse3.align.mergedSuffix':' (合并)', 'pse3.align.need2':'需要两个以上的像素图层（选择图层或让它们可见）',
  },
  en:{
    'pse3.align.alignTitle':'Auto-Align Layers', 'pse3.align.blendTitle':'Auto-Blend Layers', 'pse3.align.layers':'Layers',
    'pse3.align.projection':'Projection', 'pse3.align.p.auto':'Auto', 'pse3.align.p.perspective':'Perspective', 'pse3.align.p.collage':'Collage',
    'pse3.align.p.cylindrical':'Cylindrical', 'pse3.align.p.spherical':'Spherical', 'pse3.align.p.reposition':'Reposition',
    'pse3.align.lens':'Lens Correction', 'pse3.align.geometric':'Geometric Distortion', 'pse3.align.interp':'Interpolation',
    'pse3.align.i.bicubic':'Bicubic', 'pse3.align.i.bilinear':'Bilinear', 'pse3.align.i.nearest':'Nearest Neighbor',
    'pse3.align.method':'Blend Method', 'pse3.align.m.panorama':'Panorama', 'pse3.align.m.stack':'Stack Images', 'pse3.align.seamless':'Seamless Tones and Colors',
    'pse3.align.blended':'Blended', 'pse3.align.mergedSuffix':' (merged)', 'pse3.align.need2':'Needs two or more pixel layers (select them or make them visible)',
  },
});
})();

/* ═══════════ misc（照 photocraft 抄：拼写检查、定义自定形状、迁移预设） ═══════════
   对照源（photocraft/crates/…）：
     engine/src/type_spell_cmds.rs        edit.checkSpelling：list／change／changeAll／addToDictionary／removeFromDictionary／suggest（全档 1-327）
     text/src/spell.rs                    Dictionary：from_list 49-78、check 89-110、suggest 114-166、misspellings 169-175、words 192-209、distance 220-251
     engine/src/type_cmds.rs:60,338       norm_text、replace_text（我们的文字层没有字元样式段 ⇒ 只换字串）
     ui-egui/src/type_panels_ui.rs        拼写检查对话框 39-51（SpellDialog）、720-861（refresh／open／窗口与按钮动作）
     engine/src/edit_menu_cmds.rs         CustomShape 32-37、current_path 506-529、can_define_shape 531-534、define_custom_shape 536-552、规格 916-924
     engine/src/presets/shapes.rs         fit 300-313（形状塞进矩形，可保比例）、place 327-362（自定形状工具放形状）、new_preset 364-386（正规化到 100 方格）
     ui-egui/src/vector_ui.rs:85-92       自定形状工具：拖出的矩形 → preset_panels.rs:793 finish_custom_shape → shape.presets.place
     engine/src/migrate_cmds.rs           edit.presets.migratePresets（全档 1-116）：读预设／首选项 JSON，按组名补进库
     engine/src/presets/mod.rs:36-42,63-117  Group{name,items}、PresetState 各库、Persisted 栏位名（gradients／styles／shapes／pattern_groups／tool_presets／custom_shapes）
     doc/src/vector.rs:26-125             Path／Subpath／Knot／PathOp／FillRule 的序列化样子（迁移读 shapes 用）
   储存（浏览器 localStorage）：
     dlcanvas.ps.userDictionary   拼写检查的使用者字典（原码存在偏好 prefs.userDictionary；PE.prefs.check 不认新键，所以另存）
     dlcanvas.ps.customShapes     自定形状库（正规化到 100×100 方格的贝兹路径）
     dlcanvas.ps.migratedPresets  迁移进来、我们还没有对应库的预设组（渐变／样式／图案组／工具预设）——留着给以后的面板用，也让再迁移一次不重复加 */
(function(){
'use strict';
const PE = window.PsEdit; if (!PE || PE._pse3_misc) return; PE._pse3_misc = true;
const T = k => Lang.t(k);
const fail = msg => ({ok:false, error:msg});
const isNum = v => typeof v === 'number' && isFinite(v);
const LS = {
  get(k, d){ try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch(e){ return d; } },
  put(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch(e){ return false; } },
};
/* 字典档跟这支档放一起（收尾会并进 ps-edit.js，同一个资料夹） */
const HERE = (document.currentScript && document.currentScript.src) || (location.href.replace(/[^/]*$/, '') + 'menus/impl/ps-edit.js');
const DICT_URL = new URL('ps-edit-dict/en_US-scowl-50.txt.gz', HERE).href;

/* 画面上提示一句（原码：app.ui.status ＋ status_error） */
function toast(msg, bad){
  let d = document.getElementById('pse3-misc-toast');
  if (!d){
    d = document.createElement('div'); d.id = 'pse3-misc-toast'; d.setAttribute('role', 'status');
    document.body.appendChild(d);
  }
  d.className = bad ? 'bad' : '';
  d.textContent = msg; d.style.display = 'block';
  clearTimeout(toast._t); toast._t = setTimeout(() => { d.style.display = 'none'; }, 3600);
}
function ensureStyle(){
  if (document.getElementById('pse3-misc')) return;
  const s = document.createElement('style'); s.id = 'pse3-misc';
  s.textContent = `
#pse3-misc-toast{position:fixed;left:50%;top:60px;transform:translateX(-50%);z-index:10002;background:#2b2f36;color:#e6e8ec;border:1px solid #444a55;padding:7px 16px;border-radius:4px;font:12px sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4);pointer-events:none}
#pse3-misc-toast.bad{background:#5a2a2a;border-color:#7a3a3a}
.pse3-spell .pse3-cols{display:flex;gap:16px;align-items:flex-start}
.pse3-spell .pse3-cols>.pse-body{flex:1 1 auto}
.pse3-spell .pse3-cols>.pse-bar{flex-direction:column;justify-content:flex-start;margin-top:0;gap:5px}
.pse3-spell .pse3-cols>.pse-bar button{width:110px}
.pse3-spell .pse3-cols>.pse-bar button[data-act=ok]{margin-bottom:8px}
.pse3-spell .pse3-cols>.pse-bar button:disabled{opacity:.45;cursor:default}
.pse3-spell .pse-row>.lb{width:96px}
.pse3-spell select[data-k=suggestions]{min-width:180px;background:#1d2026;color:#e6e8ec;border:1px solid #444a55;border-radius:3px}
.pse3-spell input[data-k=word]{opacity:.85}
.pse3-spell .pse3-msg{min-height:16px;margin:4px 0 0 106px;font-size:12px;color:#c8ced8}
`;
  document.head.appendChild(s);
}

/* ═══════════ 字元工具（Rust 的 char 方法对到 Unicode 性质） ═══════════ */
const RE_ALPHA = /\p{Alphabetic}/u, RE_NUM = /\p{N}/u, RE_UPPER = /\p{Uppercase}/u;
const isAlpha = c => RE_ALPHA.test(c);                    // char::is_alphabetic
const isNumeric = c => RE_NUM.test(c);                    // char::is_numeric（Nd／Nl／No）
const isAlnum = c => isAlpha(c) || isNumeric(c);          // char::is_alphanumeric
const isUpper = c => RE_UPPER.test(c);                    // char::is_uppercase
const chars = s => Array.from(s);                         // Rust 的 chars()：按码位
const lower = s => s.toLowerCase();
const asciiLower = s => s.replace(/[A-Z]/g, c => c.toLowerCase());   // eq_ignore_ascii_case
const normText = s => String(s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');   // type_cmds.rs:60 norm_text

/* ═══════════ 字典（text/src/spell.rs） ═══════════ */
/* spell.rs:179 normalize：排版撇号 → ' */
const normalize = w => w.replace(/[’‘ʼ]/g, "'");
/* spell.rs:183 capitalize */
function capitalize(w){ const c = chars(w); return c.length ? c[0].toUpperCase() + c.slice(1).join('') : ''; }
/* spell.rs:192 words：字母／数字（中间可夹撇号）的字元区段 [起, 迄)（字元索引；连字号会切开） */
function words(text){
  const isApos = c => c === "'" || c === '’' || c === 'ʼ';
  const cs = chars(text), out = [];
  let start = null;
  for (let i = 0; i < cs.length; i++){
    const c = cs[i];
    const innerApos = isApos(c) && start !== null && i + 1 < cs.length && isAlpha(cs[i + 1]);
    if (isAlnum(c) || innerApos){ if (start === null) start = i; }
    else if (start !== null){ out.push([start, i]); start = null; }
  }
  if (start !== null) out.push([start, cs.length]);
  return out;
}
/* spell.rs:211-251 Damerau–Levenshtein（OSA）距离，超过 max 回 null；三列暂存重复用 */
const Rows = {p2:new Int32Array(64), p:new Int32Array(64), c:new Int32Array(64)};
function distance(a, b, max){
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > max) return null;
  if (Rows.p.length < m + 1){ Rows.p2 = new Int32Array(m + 1); Rows.p = new Int32Array(m + 1); Rows.c = new Int32Array(m + 1); }
  let prev2 = Rows.p2, prev = Rows.p, cur = Rows.c;
  prev2.fill(0, 0, m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  cur.fill(0, 0, m + 1);
  for (let i = 1; i <= n; i++){
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++){
      const cost = a[i - 1] !== b[j - 1] ? 1 : 0;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max){ Rows.p2 = prev2; Rows.p = prev; Rows.c = cur; return null; }
    const t = prev2; prev2 = prev; prev = cur; cur = t;      // swap(prev2, prev)；swap(prev, cur)
  }
  Rows.p2 = prev2; Rows.p = prev; Rows.c = cur;
  return prev[m] <= max ? prev[m] : null;
}
const cps = s => chars(s).map(c => c.codePointAt(0));
/* spell.rs:49 from_list：一行一字；「#NN」设定后面那些字的等级（SCOWL 10＝最常用 … 50） */
function fromList(list){
  const wordsMap = new Map(), byLower = new Map();
  let level = 50;
  for (const line of list.split('\n')){
    const w = line.trim();
    if (w.startsWith('#')){ const l = w.slice(1); if (/^\+?\d+$/.test(l) && +l <= 255) level = +l; continue; }
    if (!w || wordsMap.has(w)) continue;
    wordsMap.set(w, level);
    const lw = lower(w);
    if (!byLower.has(lw)) byLower.set(lw, []);
    byLower.get(lw).push(w);
  }
  const byLen = [];
  for (const [lw, forms] of byLower){
    const cc = cps(lw), n = cc.length;
    while (byLen.length <= n) byLen.push([]);
    let lvl = Infinity; for (const f of forms){ const v = wordsMap.get(f); if (v !== undefined && v < lvl) lvl = v; }
    byLen[n].push([lw, cc, lvl === Infinity ? 50 : lvl]);
  }
  return new Dictionary(wordsMap, byLower, byLen);
}
class Dictionary {
  constructor(w, bl, bn){ this.words = w; this.byLower = bl; this.byLen = bn; }
  get size(){ return this.words.size; }
  /* spell.rs:89 check：拼对没有（user＝使用者字典＋全部忽略，比的是小写） */
  check(word, user){
    let w = normalize(word);
    if (w.endsWith("'s") && w.length > 2) w = w.slice(0, -2);              // strip_suffix("'s")，剥完不能是空的
    w = w.replace(/^'+|'+$/g, '');                                       // trim_matches('\'')
    const cs = chars(w);
    if (!w || cs.some(isNumeric) || !cs.some(isAlpha)) return true;
    const lw = lower(w);
    if ((user && user.has(lw)) || this.words.has(w)) return true;
    const forms = this.byLower.get(lw);
    if (!forms) return false;
    const allCaps = cs.filter(isAlpha).every(isUpper);
    const firstCap = isUpper(cs[0]) && cs.slice(1).every(c => !isUpper(c));
    // "the" → "The"/"THE"；"Paris" → "PARIS"；"NASA" 只认原样（上面已比过）
    return forms.some(f => {
      const fLower = chars(f).every(c => !isUpper(c));
      return allCaps || (fLower && firstCap) || (firstCap && capitalize(f) === w);
    });
  }
  /* spell.rs:114 suggest：最多 max 个，距离近的先、同距离「同一组字母换了顺序」的先、再按常用等级、再按字母；套上原字的大小写样式 */
  suggest(word, max){
    const w = normalize(word), lw = lower(w), lc = cps(lw), n = lc.length;
    const maxD = n <= 4 ? 1 : 2;
    const sorted = lc.slice().sort((a, b) => a - b);
    const anagram = cc => { if (cc.length !== sorted.length) return false; const v = cc.slice().sort((a, b) => a - b); for (let i = 0; i < v.length; i++) if (v[i] !== sorted[i]) return false; return true; };
    const found = [];
    for (let len = Math.max(0, n - maxD); len <= n + maxD; len++){
      const bucket = this.byLen[len]; if (!bucket) continue;
      for (const [cand, cc, lvl] of bucket){
        const d = distance(lc, cc, maxD);
        if (d !== null) found.push([d, anagram(cc) ? 0 : 1, lvl, cand]);
      }
    }
    found.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]) || (x[3] < y[3] ? -1 : x[3] > y[3] ? 1 : 0));
    const wc = chars(w), alpha = wc.filter(isAlpha);
    const allCaps = alpha.every(isUpper) && alpha.length > 1;
    const firstCap = wc.length > 0 && isUpper(wc[0]);
    const out = [];
    for (const f of found){
      // 常用（小写）形先于专有名词："brwon" → "brown"，再 "Brown"
      const forms = (this.byLower.get(f[3]) || []).slice();
      forms.sort((a, b) => (chars(a).some(isUpper) ? 1 : 0) - (chars(b).some(isUpper) ? 1 : 0));   // 稳定排序（sort_by_key）
      for (const form of forms){
        const s = allCaps ? form.toUpperCase() : firstCap ? capitalize(form) : form;
        if (!out.includes(s) && s !== w) out.push(s);
      }
      if (out.length >= max) break;
    }
    return out.slice(0, max);
  }
  /* spell.rs:169 misspellings（区段是字元索引） */
  misspellings(text, user){
    const cs = chars(text);
    return words(text).filter(([a, b]) => !this.check(cs.slice(a, b).join(''), user)).map(([a, b]) => ({start:a, end:b, word:cs.slice(a, b).join('')}));
  }
}
/* spell.rs:39 english()：第一次用才载（fetch＋gzip 解开），载完快取 */
const Spell = PE.spell = {
  dict:null, _p:null, url:DICT_URL,
  ready(){ return !!this.dict; },
  load(){
    if (this.dict) return Promise.resolve(this.dict);
    if (!this._p){
      this._p = (async () => {
        const r = await fetch(this.url);
        if (!r.ok) throw new Error(`spelling dictionary: HTTP ${r.status}`);
        const buf = new Uint8Array(await r.arrayBuffer());
        let text;
        if (buf[0] === 0x1f && buf[1] === 0x8b){        // 服务器若已替我们解压（Content-Encoding: gzip）就不是 gzip 头了
          const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
          text = await new Response(ds).text();
        } else text = new TextDecoder().decode(buf);
        this.dict = fromList(text);
        return this.dict;
      })();
      this._p.catch(() => { this._p = null; });
    }
    return this._p;
  },
  fromList, words, distance:(a, b, m) => distance(cps(a), cps(b), m),
};

/* 使用者字典（原码 prefs.user_dictionary） */
const UD_KEY = 'dlcanvas.ps.userDictionary';
const UserDict = PE.userDictionary = {
  list(){ const v = LS.get(UD_KEY, []); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; },
  save(l){ return LS.put(UD_KEY, l); },
};

/* ═══════════ 拼写检查命令（type_spell_cmds.rs） ═══════════ */
const SPELL = 'edit.checkSpelling';
/* :35 type_layers：文字层，由上到下（图层面板顺序），跳过全锁的 */
const typeLayers = () => Doc.layers.slice().reverse().filter(L => L.kind === 'text' && !(L.locks && L.locks.all));
/* :52 accepted：使用者字典＋ignore，小写 */
function accepted(p){
  const set = new Set(UserDict.list().map(lower));
  if (Array.isArray(p.ignore)) p.ignore.filter(x => typeof x === 'string').forEach(x => set.add(lower(x)));
  return set;
}
const layerKey = p => p.layer !== undefined ? p.layer : p.layerId;
/* :60 layers_param：allLayers:false 或给了 layer ⇒ 只查那一层（缺省＝当前层） */
function layersParam(p){
  const all = typeLayers();
  if (p.allLayers === false || layerKey(p) !== undefined){
    const id = layerKey(p) !== undefined ? layerKey(p) : Doc.activeId;
    return all.filter(L => L.id === id);
  }
  return all;
}
const maxSugg = p => (Number.isInteger(p.suggestions) && p.suggestions >= 0) ? p.suggestions : 5;
/* :71 list */
function spellList(p, dict){
  const ok = accepted(p), max = maxSugg(p), out = [];
  for (const L of layersParam(p)){
    const t = String(L.data.text);
    for (const m of dict.misspellings(t, ok)) out.push({layer:L.id, start:m.start, end:m.end, word:m.word, suggestions:dict.suggest(m.word, max)});
  }
  return {ok:true, misspellings:out, count:out.length};
}
const lockMsg = L => (L.locks && (L.locks.all || L.locks.pixels)) ? `Could not complete your request because the layer "${L.name}" is locked` : null;
/* :89 change：换掉一处（给了 word 就先核对那段还是它）——一步历史 */
function spellChange(p){
  const need = k => fail(`${SPELL}: \`change\` needs \`${k}\``);
  const id = layerKey(p); if (id === undefined) return need('layer');
  if (!Number.isInteger(p.start) || p.start < 0) return need('start');
  if (!Number.isInteger(p.end) || p.end < 0) return need('end');
  if (typeof p.replace !== 'string') return need('replace');
  const L = Doc.byId(id);
  if (!L || L.kind !== 'text') return fail(`${SPELL}: layer ${id} is not a type layer`);
  const cs = chars(String(L.data.text)), n = cs.length;
  const a = Math.min(p.start, n), b = Math.min(Math.max(p.end, p.start), n);     // byte_at：超过尾巴＝尾巴
  const cur = cs.slice(a, b).join('');
  if (typeof p.word === 'string' && cur !== p.word) return fail(`${SPELL}: the text at ${p.start}..${p.end} is ${JSON.stringify(cur)}, not ${JSON.stringify(p.word)}`);
  const lm = lockMsg(L); if (lm) return fail(lm);
  History.push();                                         // s.edit("Check Spelling")：一步历史
  const to = normText(p.replace);
  cs.splice(a, b - a, ...chars(to));
  L.data.text = cs.join(''); Layer.invalidate(L);
  return {ok:true, changed:1, layer:L.id, start:p.start, end:p.start + chars(p.replace).length};
}
/* :115 changeAll：整个字、分大小写，查的那些层里全部换掉——有换才一步历史 */
function spellChangeAll(p){
  if (typeof p.word !== 'string' || !p.word) return fail(`${SPELL}: \`changeAll\` needs \`word\``);
  if (typeof p.replace !== 'string') return fail(`${SPELL}: \`changeAll\` needs \`replace\``);
  const plan = [];
  for (const L of layersParam(p)){
    const cs = chars(String(L.data.text));
    const hits = words(String(L.data.text)).filter(([a, b]) => cs.slice(a, b).join('') === p.word);
    if (hits.length) plan.push([L, hits]);
  }
  const count = plan.reduce((s, [, h]) => s + h.length, 0);
  if (count > 0){
    for (const [L] of plan){ const lm = lockMsg(L); if (lm) return fail(lm); }
    History.push();
    const to = chars(normText(p.replace));
    for (const [L, hits] of plan){
      const cs = chars(String(L.data.text));
      for (let i = hits.length - 1; i >= 0; i--) cs.splice(hits[i][0], hits[i][1] - hits[i][0], ...to);   // 由后往前换，前面的索引不动
      L.data.text = cs.join(''); Layer.invalidate(L);
    }
  }
  return {ok:true, changed:count, layers:plan.length};
}
/* :146 add_word：单一个字（不能有空白）；已有（不分 ASCII 大小写）就不加；按小写排序 */
function spellAdd(p){
  const w = typeof p.word === 'string' ? p.word.trim() : '';
  if (!w || /\s/.test(w)) return fail(`${SPELL}: \`add\` needs a single \`word\``);
  const l = UserDict.list();
  let added = false;
  if (!l.some(x => asciiLower(x) === asciiLower(w))){
    l.push(w);
    l.sort((a, b) => { const x = lower(a), y = lower(b); return x < y ? -1 : x > y ? 1 : 0; });   // sort_by_key(to_lowercase)，稳定
    UserDict.save(l); added = true;
  }
  return {ok:true, added, word:w, userDictionary:UserDict.list()};
}
/* :166 remove_word */
function spellRemove(p){
  const w = typeof p.word === 'string' ? p.word : '';
  const l = UserDict.list(), k = l.filter(x => asciiLower(x) !== asciiLower(w));
  const removed = k.length !== l.length;
  if (removed) UserDict.save(k);
  return {ok:true, removed, userDictionary:UserDict.list()};
}
/* 要字典的动作：字典还没载就回 Promise（载完再算） */
const withDict = f => Spell.dict ? f(Spell.dict) : Spell.load().then(f, e => fail(`${SPELL}: ${e.message}`));
/* :176 check_spelling 分派；:39 has_type＝启用条件（原码 execute 先查启用：没文字层任何动作都报错） */
function checkSpelling(p){
  p = p || {};
  if (!typeLayers().length) return fail(`${SPELL}: the document has no type layers`);
  const action = typeof p.action === 'string' ? p.action : 'list';
  switch (action){
    case 'list': case 'check': return withDict(d => spellList(p, d));
    case 'change': return spellChange(p);
    case 'changeAll': return spellChangeAll(p);
    case 'add': case 'addToDictionary': return spellAdd(p);
    case 'removeFromDictionary': return spellRemove(p);
    case 'suggest': {
      const w = typeof p.word === 'string' ? p.word : '';
      return withDict(d => ({ok:true, word:w, correct:d.check(w, accepted(p)), suggestions:d.suggest(w, maxSugg(p))}));
    }
    default: return fail(`${SPELL}: unknown action ${JSON.stringify(action)}`);
  }
}
/* 不登记成 undoable：只有 change／changeAll 真的改到字的那一刻自己 History.push()（一步）；list／add／remove／suggest 不留历史步 */
CMD.reg('ps.edit.checkSpelling', {i18n:'',
  params:'{action:"list|change|changeAll|addToDictionary|removeFromDictionary|suggest"="list", allLayers:bool=true, layer?:图层id（只查那一层）, ignore?:[字]（本次全部忽略）, suggestions:n=5; '
       + 'change：layer, start, end（字元索引）, word?（核对）, replace; changeAll：word, replace; addToDictionary／removeFromDictionary／suggest：word} '
       + '拼写检查（英文 SCOWL-50 字典＋使用者字典，存浏览器 dlcanvas.ps.userDictionary）→ list：{misspellings:[{layer,start,end,word,suggestions}], count}；change／changeAll 各一步历史；字典第一次用要载，那时回 Promise'},
  checkSpelling);

/* ── 拼写检查对话框（type_panels_ui.rs:720-861） ── */
function openSpellDialog(allLayers){
  if (!typeLayers().length){ const e = fail(`${SPELL}: the document has no type layers`); toast(T('pse3.misc.noType'), true); return e; }
  return Spell.load().then(() => buildSpellDialog(allLayers !== false), e => { toast(e.message, true); return fail(e.message); });
}
function buildSpellDialog(allLayers){
  ensureStyle();
  const st = {items:[], index:0, ignore:[], changeTo:'', allLayers};      // SpellDialog（:41-51）
  let F = null, msg = null, sugg = null, box = null;
  const item = () => st.items[st.index] || null;
  const run = p => { const r = CMD.run('ps.edit.checkSpelling', p); if (r && r.ok === false) toast(r.error, true); return r; };
  /* :720 refresh_spelling */
  const refresh = () => {
    const r = run({action:'list', allLayers:st.allLayers, ignore:st.ignore, suggestions:8});
    st.items = (r && r.misspellings) || [];
    st.changeTo = (item() && item().suggestions[0]) || '';
    paint();
  };
  const paint = () => {
    if (!F) return;
    const it = item();
    F.word.value = it ? it.word : '';
    F.changeTo.value = st.changeTo; F.changeTo.disabled = !it;
    sugg.innerHTML = '';
    (it ? it.suggestions : []).forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; sugg.appendChild(o); });
    sugg.value = it && it.suggestions.includes(st.changeTo) ? st.changeTo : '';
    F.allLayers.checked = st.allLayers;
    msg.textContent = it ? '' : T('pse3.misc.spellDone');                  // :795「Spell check complete.」
    box.querySelectorAll('.pse-bar button').forEach(b => { if (b.dataset.act !== 'ok') b.disabled = !it; });
  };
  /* :822-861 按钮动作 */
  const act = a => {
    const it = item(), word = it ? it.word : '';
    st.changeTo = F.changeTo.value;
    if (a === 'relist'){ st.index = 0; refresh(); return; }
    if (!it) return;
    if (a === 'ignore'){ st.index++; st.changeTo = (item() && item().suggestions[0]) || ''; paint(); }
    else if (a === 'ignoreAll'){ st.ignore.push(word); refresh(); }
    else if (a === 'add'){ run({action:'addToDictionary', word}); refresh(); }
    else if (a === 'change'){ run({action:'change', layer:it.layer, start:it.start, end:it.end, word, replace:st.changeTo}); refresh(); }
    else if (a === 'changeAll'){ run({action:'changeAll', word, replace:st.changeTo, allLayers:st.allLayers}); refresh(); }
    if (window.UI) UI.draw();
  };
  const r = PE.dialog.open({cmd:'ps.edit.checkSpelling.dialog', title:T('pse3.misc.spellTitle'),
    rows:[
      {k:'word', label:T('pse3.misc.notInDict'), type:'text', value:''},
      {k:'changeTo', label:T('pse3.misc.changeTo'), type:'text', value:''},
    ],
    build(body, addRow, f){
      const row = document.createElement('div'); row.className = 'pse-row';
      const lb = document.createElement('span'); lb.className = 'lb'; lb.textContent = T('pse3.misc.suggestions'); row.appendChild(lb);
      sugg = document.createElement('select'); sugg.size = 6; sugg.dataset.k = 'suggestions'; row.appendChild(sugg);
      body.appendChild(row);
      addRow({k:'allLayers', label:'', type:'check', text:T('pse3.misc.allLayers'), value:allLayers}, body);
      msg = document.createElement('div'); msg.className = 'pse3-msg'; body.appendChild(msg);
      F = f;
    },
    extra:[
      {key:'pse3.misc.ignore', act:'ignore', fn:() => act('ignore')},
      {key:'pse3.misc.ignoreAll', act:'ignoreAll', fn:() => act('ignoreAll')},
      {key:'pse3.misc.change', act:'change', fn:() => act('change')},
      {key:'pse3.misc.changeAll', act:'changeAll', fn:() => act('changeAll')},
      {key:'pse3.misc.add', act:'add', fn:() => act('add')},
    ],
    after(f){
      box = f.word.closest('.pse-dlg'); box.classList.add('pse3-spell');
      f.word.readOnly = true; f.word.tabIndex = -1;
      // 版面照原码：左边字段，右边一排按钮（「完成」在最上面）；我们没有「取消」
      const body = box.querySelector('.pse-body'), bar = box.querySelector('.pse-bar'), cols = document.createElement('div');
      cols.className = 'pse3-cols'; box.insertBefore(cols, body); cols.appendChild(body); cols.appendChild(bar);
      const done = bar.querySelector('[data-act=ok]'); done.textContent = T('pse3.misc.done'); bar.insertBefore(done, bar.firstChild);
      const cancel = bar.querySelector('[data-act=cancel]'); if (cancel) cancel.style.display = 'none';
      f.changeTo.addEventListener('input', () => { st.changeTo = f.changeTo.value; });
      sugg.addEventListener('change', () => { st.changeTo = sugg.value; f.changeTo.value = sugg.value; });
      sugg.addEventListener('dblclick', () => { if (sugg.value){ st.changeTo = sugg.value; f.changeTo.value = sugg.value; act('change'); } });
      f.allLayers.addEventListener('change', () => { st.allLayers = f.allLayers.checked; act('relist'); });
      refresh();
      setTimeout(() => { if (f.changeTo && !f.changeTo.disabled){ f.changeTo.focus(); f.changeTo.select(); } }, 0);
    },
    ok(){ return {ok:true}; }});                          // 「完成」：关窗
  PE._spellState = st;
  return Object.assign({}, r, {dialog:'checkSpelling', misspellings:st.items});
}
CMD.reg('ps.edit.checkSpelling.dialog', {i18n:'', params:'{allLayers:bool=true} 开「拼写检查」对话框（不在词典中／更改为／建议／忽略／全部忽略／更改／全部更改／添加／完成、检查所有图层）；按钮走 ps.edit.checkSpelling'},
  p => openSpellDialog((p || {}).allLayers));

/* ═══════════ 自定形状（edit_menu_cmds.rs:506-552、presets/shapes.rs:300-386） ═══════════
   我们的存法（与分辨率无关）：{name, group?, fillRule:'nonzero'|'evenodd', subpaths:[{closed, op:'combine'|'join'|'subtract'|'intersect'|'exclude', anchors:[{x,y,in:[x,y]|null,out:[x,y]|null}]}]}
   座标正规化进 100×100 方格（保比例置中，shapes.rs:376 new_preset 的做法）；放的时候再 fit 到要的矩形。 */
const CS_KEY = 'dlcanvas.ps.customShapes';
const CustomShapes = PE.customShapes = {
  list(){ const v = LS.get(CS_KEY, []); return Array.isArray(v) ? v.filter(x => x && typeof x.name === 'string' && Array.isArray(x.subpaths)) : []; },
  save(l){ return LS.put(CS_KEY, l); },
  find(name, group){ return this.list().find(c => c.name === name && (group === undefined || (c.group || '') === group)) || null; },
};
const r4 = v => Math.round(v * 1e4) / 1e4;
const mapPt = (q, f) => q ? f(q[0], q[1]) : null;
function mapSubpaths(subs, f){
  return subs.map(sp => ({closed:!!sp.closed, op:sp.op || 'combine', anchors:sp.anchors.map(a => { const p = f(a.x, a.y); return {x:p[0], y:p[1], in:mapPt(a.in, f), out:mapPt(a.out, f)}; })}));
}
/* vector.rs:162 control_bounds：锚点与把手全算 */
function controlBounds(subs){
  let b = null;
  const add = q => { if (!q) return; if (!b) b = [q[0], q[1], q[0], q[1]]; else { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); } };
  subs.forEach(sp => sp.anchors.forEach(a => { add([a.x, a.y]); add(a.in); add(a.out); }));
  return b;
}
/* shapes.rs:300 fit：路径（控制点外框）映到 rect=[x,y,w,h]；keep＝保比例置中 */
function fitSubpaths(subs, rect, keep){
  const b = controlBounds(subs); if (!b) return subs;
  const bw = Math.max(b[2] - b[0], 1e-9), bh = Math.max(b[3] - b[1], 1e-9);
  let sx = rect[2] / bw, sy = rect[3] / bh, ox = rect[0], oy = rect[1];
  if (keep){ const k = Math.min(sx, sy); ox += (rect[2] - bw * k) / 2; oy += (rect[3] - bh * k) / 2; sx = sy = k; }
  return mapSubpaths(subs, (x, y) => [sx * x + ox - b[0] * sx, sy * y + oy - b[1] * sy]);
}
/* 一个形状 → 子路径（编组展开、复合路径的成员「join」进同一块、藏起来的跳过；活形状用 VecSel.asBezier 的几何视图） */
function shapeSubpaths(s, out, rule){
  if (!s || s.visible === false) return;
  if (s.type === 'group' && Array.isArray(s.children)){ s.children.forEach(c => shapeSubpaths(c, out, rule)); return; }
  if (s.type === 'compound' && Array.isArray(s.children)){
    const n0 = out.length;
    s.children.forEach(c => shapeSubpaths(c, out, rule));
    for (let i = n0; i < out.length; i++) out[i].op = i === n0 ? 'combine' : 'join';      // PathOp::Join：同一块一起填（custom shape 的洞）
    if (s.rule === 'evenodd') rule.evenodd = true;
    return;
  }
  const v = window.VecSel ? VecSel.asBezier(s) : (s.type === 'bezier' ? s : null);
  if (!v || !v.anchors || v.anchors.length < 2) return;
  out.push({closed:!!v.closed, op:'combine', anchors:v.anchors.map(a => ({x:a.x, y:a.y, in:a.in ? a.in.slice() : null, out:a.out ? a.out.slice() : null}))});
}
const vecHasPath = L => { const o = []; L.data.shapes.forEach(s => shapeSubpaths(s, o, {})); return o.length > 0; };
/* edit_menu_cmds.rs:508 current_path 的对应（我们没有路径面板）：
   指定 layerId ＞ 当前层是矢量层 ＞ 最上面一层有路径的矢量层（原码最后一步退到「最后存的路径」doc.paths.last()，同样是整份文件找）；
   那层若有矢量节点选取（VecSel）只取选中的形状，不然整层 */
function definePath(p){
  let L = null;
  if (p.layerId !== undefined){
    L = Doc.byId(p.layerId);
    if (!L || L.kind !== 'vector' || !vecHasPath(L)) return {error:'edit.defineCustomShape: no such path'};
  } else {
    const A = Doc.active();
    if (A && A.kind === 'vector' && vecHasPath(A)) L = A;
    else L = Doc.layers.slice().reverse().find(x => x.kind === 'vector' && vecHasPath(x)) || null;
  }
  if (!L) return {error:'select a path or shape layer first'};                            // :533 can_define_shape
  const sel = window.VecSel && VecSel.layerId === L.id && VecSel.shapes.length ? VecSel.shapes : null;
  const subs = [], rule = {};
  L.data.shapes.filter(s => !sel || sel.includes(s.id)).forEach(s => shapeSubpaths(s, subs, rule));
  if (!subs.length) return {error:'edit.defineCustomShape: no such path'};
  const doc = mapSubpaths(subs, (x, y) => [x + L.x, y + L.y]);                            // 图层坐标 → 文件坐标
  return {L, subpaths:doc, fillRule:rule.evenodd ? 'evenodd' : 'nonzero', fromSelection:!!sel};
}
const nextShapeName = () => `Shape ${CustomShapes.list().length + 1}`;
/* :536 define_custom_shape：同名就换掉路径，不然加在后面；没给名字＝「Shape N」 */
function defineCustomShape(p){
  const src = definePath(p); if (src.error) return fail(src.error);
  const name = (typeof p.name === 'string' && p.name.trim()) ? p.name.trim() : nextShapeName();
  const norm = fitSubpaths(src.subpaths, [0, 0, 100, 100], true).map(sp => ({closed:sp.closed, op:sp.op, anchors:sp.anchors.map(a => ({x:r4(a.x), y:r4(a.y), in:a.in && a.in.map(r4), out:a.out && a.out.map(r4)}))}));
  const l = CustomShapes.list(), it = {name, fillRule:src.fillRule, subpaths:norm};
  const i = l.findIndex(c => c.name === name);
  if (i >= 0) l[i] = Object.assign({}, l[i], it); else l.push(it);
  const saved = CustomShapes.save(l);
  return {ok:true, name, count:l.length, subpaths:norm.length, layerId:src.L.id, fromSelection:src.fromSelection, saved};
}
function openDefineShapeDialog(){
  const src = definePath({});
  if (src.error){ toast(T('pse3.misc.noPath'), true); return fail(src.error); }      // 原码 prefs_ui.rs:421：不能用就回「… is not available right now」、不开框
  return PE.dialog.open({cmd:'ps.edit.defineCustomShape', title:T('pse3.misc.shapeName'),
    rows:[{k:'name', label:T('pse.name'), type:'text', value:nextShapeName()}],
    ok(v){ const r = CMD.run('ps.edit.defineCustomShape', {name:v.name, layerId:src.L.id}); if (r && r.ok !== false) toast(T('pse3.misc.shapeDefined').replace('{name}', r.name)); return r; }});
}
CMD.reg('ps.edit.defineCustomShape', {i18n:'',
  params:'{name?（缺省 "Shape N"；同名＝换掉）, layerId?:矢量层（缺省＝当前矢量层，不是就取最上面一层有形状的矢量层）, dialog?:true＝开「形状名称」对话框} '
       + '定义自定形状：那层选中的形状（矢量节点选取）或整层形状的路径，正规化后存进自定形状库（浏览器 dlcanvas.ps.customShapes）→ {name, count, subpaths}；不进历史'},
  p => (p && p.dialog) ? openDefineShapeDialog() : defineCustomShape(p || {}));
CMD.reg('ps.shape.customList', {i18n:'', params:'{} 自定形状库清单（定义自定形状／迁移预设存的）→ {shapes:[{name, group, subpaths, fillRule}], count}'},
  () => { const l = CustomShapes.list(); return {ok:true, shapes:l.map(c => ({name:c.name, group:c.group || '', subpaths:c.subpaths.length, fillRule:c.fillRule || 'nonzero'})), count:l.length}; });

/* 有号面积（看锚点＋把手多边形就够分方向） */
function signedArea(sp){
  const P = []; sp.anchors.forEach(a => { if (a.in) P.push(a.in); P.push([a.x, a.y]); if (a.out) P.push(a.out); });
  let s = 0; for (let i = 0; i < P.length; i++){ const p = P[i], q = P[(i + 1) % P.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2;
}
const reverseSub = sp => Object.assign({}, sp, {anchors:sp.anchors.slice().reverse().map(a => ({x:a.x, y:a.y, in:a.out, out:a.in}))});
/* shapes.rs:327 place（＋ preset_panels.rs:793 finish_custom_shape）：fit 到 rect，填前景色，画成矢量层里的贝兹 */
function placeCustom(p){
  const cmd = 'ps.shape.placeCustom';
  const name = typeof p.name === 'string' ? p.name : (typeof p.preset === 'string' ? p.preset : '');
  if (!name.trim()) return fail(`${cmd}: missing \`name\``);
  const shape = CustomShapes.find(name, typeof p.group === 'string' ? p.group : undefined);
  if (!shape) return fail(`${cmd}: no shape "${name}" (see ps.shape.customList)`);
  let v;
  if (Array.isArray(p.rect) && p.rect.length === 4) v = p.rect.map(x => Number(x) || 0);
  else if ([p.x, p.y, p.w, p.h].every(isNum)) v = [p.x, p.y, p.w, p.h];
  else { const side = Math.min(Doc.width, Doc.height) * 0.5; v = [(Doc.width - side) / 2, (Doc.height - side) / 2, side, side]; }
  // 负的宽高（往左上拖）翻成正的
  const [x, wd] = v[2] < 0 ? [v[0] + v[2], -v[2]] : [v[0], v[2]];
  const [y, hd] = v[3] < 0 ? [v[1] + v[3], -v[3]] : [v[1], v[3]];
  if (wd < 1 || hd < 1) return fail(`${cmd}: the shape rect is empty`);
  const rect = [x, y, wd, hd], keep = p.keepAspect !== false;
  let subs = fitSubpaths(shape.subpaths, rect, keep);
  let L;
  if (p.layerId !== undefined){ L = Doc.byId(p.layerId); if (!L || L.kind !== 'vector') return fail(`${cmd}: layer ${p.layerId} is not a vector layer`); }
  else { const A = Doc.active(); L = A && A.kind === 'vector' ? A : null; }
  if (L){ const lm = lockMsg(L); if (lm) return fail(lm); }
  else L = activeVector(true);                            // engine.js：当前不是矢量层就新建一层（shape.* 同一套）
  const paint = {fill:p.fill !== undefined ? p.fill : (window.UI ? UI.fill() : '#000000'), stroke:p.stroke !== undefined ? p.stroke : 'none', strokeWidth:isNum(p.strokeWidth) ? p.strokeWidth : 0};
  if (typeof p.layerName === 'string') L.name = p.layerName;
  const bz = sp => ({type:'bezier', anchors:sp.anchors, closed:sp.closed});
  let r;
  if (subs.length === 1) r = addShape(Object.assign(bz(subs[0]), paint, {layerId:L.id}));
  else if (window.ObjRender){
    // 多个子路径＝一个复合路径；有减去／排除／奇偶就用 evenodd（近似 PathOp 的逐块运算），不然 nonzero 且「combine」各块转同向（＝联集）
    const evenodd = shape.fillRule === 'evenodd' || subs.some(sp => sp.op === 'subtract' || sp.op === 'exclude');
    if (!evenodd) subs = subs.map(sp => (sp.op !== 'join' && signedArea(sp) < 0) ? reverseSub(sp) : sp);
    const NO = {fill:'none', stroke:'none', strokeWidth:0};
    r = addShape(Object.assign({type:'compound', rule:evenodd ? 'evenodd' : 'nonzero', children:subs.map(sp => Object.assign({id:uid('S')}, bz(sp), NO))}, paint, {layerId:L.id}));
  } else {
    const ids = subs.map(sp => addShape(Object.assign(bz(sp), paint, {layerId:L.id})).id);
    r = {id:ids[0], ids, layerId:L.id};
  }
  if (!r || r.ok === false) return r || fail(`${cmd}: could not place the shape`);
  return Object.assign({ok:true, preset:shape.name, rect}, r);
}
CMD.reg('ps.shape.placeCustom', {i18n:'', undoable:true,
  params:'{name（自定形状名）, x, y, w, h（文件坐标；或 rect:[x,y,w,h]；缺省＝画布正中、短边一半的正方形；负宽高＝往左上）, keepAspect:bool=true, fill?（缺省＝前景色）, stroke?, strokeWidth?, layerId?（缺省＝当前矢量层，不是就新建一层）, group?} '
       + '自定形状工具：把库里的形状 fit 进矩形、画成矢量层里的贝兹（多个子路径＝复合路径）→ {id, layerId, preset, rect}'},
  p => placeCustom(p || {}));

/* ═══════════ 迁移预设（migrate_cmds.rs） ═══════════ */
const MIG_KEY = 'dlcanvas.ps.migratedPresets';
const migStore = () => { const v = LS.get(MIG_KEY, {}); return (v && typeof v === 'object') ? v : {}; };
/* :23 groups：v[key] 解成 Vec<Group<T>>，解不了（任何一组不对）就当空的 */
function groupsOf(v, key, item){
  const a = v && v[key];
  if (!Array.isArray(a)) return [];
  const ok = a.every(g => g && typeof g === 'object' && typeof g.name === 'string' && Array.isArray(g.items) && (!item || g.items.every(item)));
  return ok ? a : [];
}
/* :11 merge_groups：组名库里没有才加 */
function mergeGroups(cur, incoming, onAdd){
  let added = 0;
  for (const g of incoming){ if (!cur.some(e => e.name === g.name)){ cur.push(g); if (onAdd) onAdd(g); added++; } }
  return added;
}
/* doc/src/vector.rs 的 Path（serde 样子：{subpaths:[{closed, knots:[{anchor:{x,y}, in_ctrl, out_ctrl, smooth}], op:"Combine"…}], fill_rule:"NonZero"|"EvenOdd"}）→ 我们的子路径 */
const pt = q => Array.isArray(q) ? [Number(q[0]), Number(q[1])] : (q && typeof q === 'object') ? [Number(q.x), Number(q.y)] : null;
const OPS = {Combine:'combine', Subtract:'subtract', Intersect:'intersect', Exclude:'exclude', Join:'join'};
function fromPcPath(path){
  if (!path || !Array.isArray(path.subpaths)) return null;
  const subs = [];
  for (const sp of path.subpaths){
    if (!sp || !Array.isArray(sp.knots)) return null;
    const anchors = [];
    for (const k of sp.knots){
      const a = pt(k && k.anchor); if (!a || !a.every(isFinite)) return null;
      const i = pt(k.in_ctrl) || a, o = pt(k.out_ctrl) || a;
      const same = (q, r) => Math.abs(q[0] - r[0]) < 1e-9 && Math.abs(q[1] - r[1]) < 1e-9;
      anchors.push({x:a[0], y:a[1], in:same(i, a) ? null : i, out:same(o, a) ? null : o});
    }
    if (anchors.length) subs.push({closed:!!sp.closed, op:OPS[sp.op] || 'combine', anchors});
  }
  return subs.length ? {subpaths:subs, fillRule:path.fill_rule === 'EvenOdd' ? 'evenodd' : 'nonzero'} : null;
}
/* 自定形状的两种来源格式：原码（{name, path:Path}）或我们自己的（{name, subpaths, fillRule}） */
function toCustom(it, group){
  if (!it || typeof it.name !== 'string') return null;
  let g = null;
  if (it.path) g = fromPcPath(it.path);
  else if (Array.isArray(it.subpaths) && it.subpaths.every(sp => sp && Array.isArray(sp.anchors))) g = {subpaths:it.subpaths, fillRule:it.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'};
  if (!g) return null;
  const subs = fitSubpaths(g.subpaths, [0, 0, 100, 100], true);          // 正规化（shapes.rs:376）
  const o = {name:it.name, fillRule:g.fillRule, subpaths:subs};
  if (group) o.group = group;
  return o;
}
/* 跟 ps-edit.js makePattern 同一个算法（图案 id＝名字＋尺寸＋像素的 FNV） */
function fnv(h, bytes){ for (let i = 0; i < bytes.length; i++){ h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
function makePattern(name, w, h, px){
  let h1 = fnv(0x811c9dc5, new TextEncoder().encode(name)); h1 = fnv(h1, [w & 255, w >> 8, h & 255, h >> 8]); h1 = fnv(h1, px);
  const h2 = fnv(h1 ^ 0x9e3779b9, px), hx = v => (v >>> 0).toString(16).padStart(8, '0');
  return {id:`${hx(h1)}-${hx(h2).slice(0, 4)}-${hx(h2).slice(4)}`, name, width:w, height:h, px};
}
function unb64(s){ const t = atob(s), u = new Uint8ClampedArray(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; }
function uniqueName(name, taken){
  const free = n => !taken.some(t => t.toLowerCase() === n.toLowerCase());
  if (free(name)) return name;
  for (let i = 2; ; i++){ const n = `${name} ${i}`; if (free(n)) return n; }
}
/* :27 migrate：整份首选项（有 presets 段）或光秃秃的预设物件；按组名补进库 */
function migrate(p){
  const cmd = 'edit.presets.migratePresets';
  let root;
  if (p.data !== undefined && p.data !== null){
    if (typeof p.data === 'string'){ try { root = JSON.parse(p.data); } catch(e){ return fail(`${cmd}: the file is not JSON: ${e.message}`); } }
    else root = p.data;
  } else if (typeof p.path === 'string') return fail(`${cmd}: a web page cannot read \`${p.path}\` from disk — pass \`data\` (the file's text) or \`dialog:true\` to pick the file`);
  else return fail(`${cmd}: need \`data\` (a presets or preferences file's text) or \`dialog:true\``);
  if (!root || typeof root !== 'object') return fail(`${cmd}: not a presets or preferences file`);
  const v = (root.presets !== undefined) ? root.presets : root;
  const M = migStore();
  ['gradients', 'styles', 'shapes', 'patternGroups', 'toolPresets'].forEach(k => { if (!Array.isArray(M[k])) M[k] = []; });
  // 我们还没有渐变／样式／工具预设库：组整个收进 dlcanvas.ps.migratedPresets（以后的面板读它）
  const g = mergeGroups(M.gradients, groupsOf(v, 'gradients'));
  const st = mergeGroups(M.styles, groupsOf(v, 'styles'));
  // 形状组：组名记下来，形状进自定形状库（带组名；名字撞了加「 2」）
  const cs = CustomShapes.list();
  const shapeGroups = groupsOf(v, 'shapes', it => !!toCustom(it));
  const known = M.shapes.map(n => typeof n === 'string' ? {name:n} : n);
  const sh = mergeGroups(known, shapeGroups, grp => {
    grp.items.forEach(it => { const c = toCustom(it, grp.name); c.name = uniqueName(c.name, cs.map(x => x.name)); cs.push(c); });
  });
  M.shapes = known.map(x => x.name);
  // 图案组：原码只存图案名字（图案本身在图案库），收进 migratedPresets
  const pt2 = mergeGroups(M.patternGroups, groupsOf(v, 'pattern_groups', n => typeof n === 'string'));
  // 工具预设：平的清单、按名字
  let tp = 0;
  if (Array.isArray(v && v.tool_presets) && v.tool_presets.every(t => t && typeof t.name === 'string')){
    for (const t of v.tool_presets) if (!M.toolPresets.some(e => e.name === t.name)){ M.toolPresets.push(t); tp++; }
  }
  // ── 原码无（我们的库）：导出／导入预设档（.pcpresets 的 brushes／customShapes）与图案像素（patterns:[{name,width,height,px:base64 RGBA}]）也收，按名字补 ──
  let nb = 0, np = 0, nc = 0;
  const brushes = Array.isArray(v && v.brushes) ? v.brushes : [];
  if (brushes.length && PE.brushPresets){
    const have = PE.brushPresets.list().map(b => b.name);
    for (const b of brushes) if (b && typeof b.name === 'string' && typeof b.tip === 'string' && !have.includes(b.name)){ PE.brushPresets.put(b); have.push(b.name); nb++; }
  }
  const pats = Array.isArray(v && v.patterns) ? v.patterns : [];
  if (pats.length && PE.patterns){
    const items = PE.patterns.load();
    for (const q of pats){
      if (!q || typeof q.name !== 'string' || typeof q.px !== 'string' || !(q.width > 0) || !(q.height > 0)) continue;
      if (items.some(x => x.name === q.name)) continue;
      let px; try { px = unb64(q.px); } catch(e){ continue; }
      if (px.length !== q.width * q.height * 4) continue;
      const pat = makePattern(q.name, q.width, q.height, px);
      if (!items.some(x => x.id === pat.id)){ items.push(pat); np++; }
    }
    if (np) PE.patterns.save();
  }
  const extraShapes = Array.isArray(v && v.customShapes) ? v.customShapes : Array.isArray(v && v.custom_shapes) ? v.custom_shapes : [];
  for (const it of extraShapes){ const c = toCustom(it); if (c && !cs.some(x => x.name === c.name)){ cs.push(c); nc++; } }
  const total = g + st + sh + pt2 + tp;
  if (sh || nc) CustomShapes.save(cs);
  if (total) LS.put(MIG_KEY, M);
  return {ok:true, migrated:total + nb + np + nc,
          added:{gradients:g, styles:st, shapes:sh, patternGroups:pt2, toolPresets:tp, brushes:nb, patterns:np, customShapes:nc}};
}
/* 菜单：网页拿不到路径 ⇒ 开档案挑选器，读进来照上面解析 */
function openMigratePicker(){
  const old = document.getElementById('pse3-migrate-file'); if (old) old.remove();
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,.pcpresets,.pcprefs,application/json';
  inp.id = 'pse3-migrate-file'; inp.style.display = 'none';
  document.body.appendChild(inp);                         // 挂进页面再 click（脱离文件的 input 有的浏览器／自动化不出挑选器）
  inp.onchange = () => {
    const f = inp.files && inp.files[0]; inp.remove(); if (!f) return;
    f.text().then(t => {
      const r = CMD.run('ps.edit.presets.migratePresets', {data:t});
      PE._migrateLast = r;
      if (r && r.ok === false) toast(r.error, true);
      else toast(T('pse3.misc.migrated').replace('{n}', r.migrated));
    });
  };
  inp.click();
  return {ok:true, dialog:'file'};
}
CMD.reg('ps.edit.presets.migratePresets', {i18n:'',
  params:'{data:"<预设档／首选项档的 JSON 文字>"（或物件）| dialog?:true＝开档案挑选器 | path（网页读不到本机路径，会回错误）} '
       + '迁移预设：照 PhotoCraft 读 presets（或首选项档的 presets 段）的 gradients／styles／shapes／pattern_groups／tool_presets，库里没有的组才加；'
       + '另收 brushes／patterns／customShapes 进我们的画笔预设／图案／自定形状库 → {migrated, added:{gradients,styles,shapes,patternGroups,toolPresets,brushes,patterns,customShapes}}；不进历史'},
  p => (p && p.dialog) ? openMigratePicker() : migrate(p || {}));

/* ═══════════ 取消函数（测试架 __base() 叫） ═══════════ */
window.__pse3Cancel = window.__pse3Cancel || [];
window.__pse3Cancel.push(() => { const d = document.getElementById('pse3-misc-toast'); if (d) d.style.display = 'none'; });

/* ═══════════ 三语 ═══════════ */
Lang.add({
  'zh-Hant':{
    'pse3.misc.spellTitle':'拼字檢查', 'pse3.misc.notInDict':'不在字典中：', 'pse3.misc.changeTo':'變更為：', 'pse3.misc.suggestions':'建議：',
    'pse3.misc.ignore':'略過', 'pse3.misc.ignoreAll':'全部略過', 'pse3.misc.change':'變更', 'pse3.misc.changeAll':'全部變更', 'pse3.misc.add':'增加',
    'pse3.misc.done':'完成', 'pse3.misc.allLayers':'檢查所有圖層', 'pse3.misc.spellDone':'拼字檢查完成。', 'pse3.misc.noType':'文件裡沒有文字圖層，無法拼字檢查。',
    'pse3.misc.shapeName':'形狀名稱', 'pse3.misc.noPath':'無法定義自訂形狀：請先選取路徑或形狀圖層（文件裡沒有向量圖層）。', 'pse3.misc.shapeDefined':'已定義自訂形狀「{name}」',
    'pse3.misc.migrated':'已移轉 {n} 組預設集',
  },
  'zh-Hans':{
    'pse3.misc.spellTitle':'拼写检查', 'pse3.misc.notInDict':'不在词典中：', 'pse3.misc.changeTo':'更改为：', 'pse3.misc.suggestions':'建议：',
    'pse3.misc.ignore':'忽略', 'pse3.misc.ignoreAll':'全部忽略', 'pse3.misc.change':'更改', 'pse3.misc.changeAll':'全部更改', 'pse3.misc.add':'添加',
    'pse3.misc.done':'完成', 'pse3.misc.allLayers':'检查所有图层', 'pse3.misc.spellDone':'拼写检查完成。', 'pse3.misc.noType':'文档里没有文字图层，无法拼写检查。',
    'pse3.misc.shapeName':'形状名称', 'pse3.misc.noPath':'无法定义自定形状：请先选择路径或形状图层（文档里没有矢量图层）。', 'pse3.misc.shapeDefined':'已定义自定形状「{name}」',
    'pse3.misc.migrated':'已迁移 {n} 组预设',
  },
  en:{
    'pse3.misc.spellTitle':'Check Spelling', 'pse3.misc.notInDict':'Not in Dictionary:', 'pse3.misc.changeTo':'Change To:', 'pse3.misc.suggestions':'Suggestions:',
    'pse3.misc.ignore':'Ignore', 'pse3.misc.ignoreAll':'Ignore All', 'pse3.misc.change':'Change', 'pse3.misc.changeAll':'Change All', 'pse3.misc.add':'Add',
    'pse3.misc.done':'Done', 'pse3.misc.allLayers':'Check All Layers', 'pse3.misc.spellDone':'Spell check complete.', 'pse3.misc.noType':'The document has no type layers to check.',
    'pse3.misc.shapeName':'Shape Name', 'pse3.misc.noPath':'Define Custom Shape is not available: select a path or shape layer first (the document has no vector layers).', 'pse3.misc.shapeDefined':'Defined custom shape "{name}"',
    'pse3.misc.migrated':'Migrated {n} preset sets',
  },
});
ensureStyle();
})();

/* ═══════════ 填充 ▸ 脚本（PS 2020「填充」对话框：内容＝图案 → ☐ 脚本(S)：砖形填充／十字线织物／沿路径置入／随机填充／螺线／对称填充）
   PS 的这六个是 Presets/Deco 里的 .jsx：每个都拿「自定图案」那一块当图章，照自己的规则一份份盖下去（不是平铺），
   盖完的结果照填充框的模式／不透明度／保留透明区域混进当前像素层（有选区＝只在选区里）；一步历史。
   入口：ps.edit.fill {contents:'pattern', script, scriptOptions}（本档 fillCmd 遇到 script 就叫 PE.fillScript.render）。
   各脚本的对话框：左边预览（沿路径置入＝一条示范曲线，其他＝一块示范区域）、右边栏位（数字＋滑杆）、确定／复位／取消。
   随机（颜色／亮度随机性、随机填充的位置）一律用固定种子的乱数（scriptOptions.seed，缺省 1）：同样的参数＝同样的结果。 */
(function(){
'use strict';
const PE = window.PsEdit; if (!PE || PE._pse3_fillScript) return; PE._pse3_fillScript = true;
const T = k => Lang.t(k);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fail = msg => ({ok:false, error:msg});
const isNum = v => typeof v === 'number' && isFinite(v);
const DEG = Math.PI / 180;

/* ── 各脚本的栏位（顺序＝对话框由上到下；k＝scriptOptions 的键） ── */
const RAND = [{k:'colorRandomness', min:0, max:1, step:0.01, def:0, dec:2}, {k:'brightnessRandomness', min:0, max:1, step:0.01, def:0, dec:2}];
const SPEC = {
  brickFill:[{k:'patternScale', min:0.1, max:1.25, step:0.01, def:1, dec:2}, {k:'spacing', min:0, max:100, step:1, def:0, unit:'px'},
             {k:'rowOffset', min:0, max:100, step:1, def:50, unit:'%'}, ...RAND, {k:'angle', min:-180, max:180, step:1, def:0, unit:'deg'}],
  crossWeave:[{k:'patternScale', min:0.1, max:1.25, step:0.01, def:1, dec:2}, ...RAND, {k:'angle', min:-180, max:180, step:1, def:0, unit:'deg'}],
  placeAlongPath:[{k:'patternScale', min:0.1, max:1.25, step:0.01, def:1, dec:2}, {k:'spacing', min:0, max:70, step:1, def:0, unit:'px'},
             {k:'adjustSpacing', type:'check', def:false}, {k:'angleFromPath', min:-90, max:90, step:1, def:0, unit:'deg'},
             {k:'distanceFromPath', min:0, max:100, step:1, def:0, unit:'px'}, {k:'alternate', type:'check', def:true},
             {k:'scaleProgression', min:50, max:150, step:1, def:100, unit:'%'}, {k:'skipRotation', type:'check', def:false}, ...RAND],
  randomFill:[{k:'density', min:0.1, max:5, step:0.1, def:1, dec:1}, {k:'minScale', min:0.1, max:1.25, step:0.01, def:0.5, dec:2},
             {k:'maxScale', min:0.1, max:1.25, step:0.01, def:1, dec:2}, {k:'rotate', type:'check', def:true}, ...RAND],
  spiral:[{k:'patternScale', min:0.1, max:1.25, step:0.01, def:0.5, dec:2}, {k:'spacing', min:0, max:100, step:1, def:5, unit:'px'},
          {k:'turnSpacing', min:10, max:400, step:1, def:60, unit:'px'}, {k:'rotate', type:'check', def:true}, ...RAND],
  symmetryFill:[{k:'symmetry', type:'select', options:['p1', 'p2', 'pm', 'pg', 'pmm', 'p4'], def:'p4'}, {k:'patternScale', min:0.1, max:1.25, step:0.01, def:0.5, dec:2},
          {k:'translateX', min:-200, max:200, step:1, def:0, unit:'px'}, {k:'translateY', min:-200, max:200, step:1, def:0, unit:'px'},
          {k:'angle', min:-180, max:180, step:1, def:0, unit:'deg'}, ...RAND],
};
const NAMES = ['brickFill', 'crossWeave', 'placeAlongPath', 'randomFill', 'spiral', 'symmetryFill'];   // PS 下拉的顺序
const NEEDS_PATH = {placeAlongPath:true};
const defaults = name => { const o = {}; SPEC[name].forEach(s => o[s.k] = s.def); return o; };
/* scriptOptions → 正规化（未给＝缺省；数字夹进范围） */
function normalize(name, so){
  const o = defaults(name); so = so && typeof so === 'object' ? so : {};
  for (const s of SPEC[name]){
    const v = so[s.k]; if (v === undefined || v === null) continue;
    if (s.type === 'check'){ if (typeof v !== 'boolean') return {error:`scriptOptions.${s.k} must be true or false`}; o[s.k] = v; }
    else if (s.type === 'select'){ if (!s.options.includes(v)) return {error:`scriptOptions.${s.k} must be one of ${s.options.join('|')}`}; o[s.k] = v; }
    else { if (!isNum(v)) return {error:`scriptOptions.${s.k} must be a number ${s.min}..${s.max}`}; o[s.k] = clamp(v, s.min, s.max); }
  }
  o.seed = isNum(so.seed) ? so.seed : 1;
  return {o};
}
/* 固定种子乱数（mulberry32） */
function rng(seed){ let a = (seed * 0x9e3779b1) >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ── 路径：取子路径、平坦化、按弧长取点与切线 ── */
function pathPolys(key){
  const P = window.PsWindow && PsWindow.paths; if (!P || !P.subpaths) return null;
  const k = key !== undefined && key !== null ? key : P.current({}); if (k === undefined) return null;
  const subs = P.subpaths(k); if (!subs || !subs.length) return null;
  return subs.filter(sp => sp.anchors && sp.anchors.length >= 2).map(sp => { const pts = P.flatten(sp); pts.closed = !!sp.closed; return pts; });
}
function arcTable(pts){ const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return cum; }
function pointAt(pts, cum, s, closed){
  const L = cum[cum.length - 1];
  if (closed) s = ((s % L) + L) % L; else s = clamp(s, 0, L);
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1){ const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const seg = cum[hi] - cum[lo], t = seg > 1e-9 ? (s - cum[lo]) / seg : 0;
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
}
function tangentAt(pts, cum, s, closed){
  const L = cum[cum.length - 1], h = Math.min(1.5, L / 4);
  const a = pointAt(pts, cum, closed ? s - h : Math.max(0, s - h), closed), b = pointAt(pts, cum, closed ? s + h : Math.min(L, s + h), closed);
  const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1; return [dx / n, dy / n];
}

/* ── 图章：{x, y（中心，文件坐标）, rot（弧度）, sx, sy（缩放，负＝镜像）, hue（度）, bri（倍数）} ── */
function jitter(o, r){
  return {hue:o.colorRandomness > 0 ? (r() * 2 - 1) * 180 * o.colorRandomness : 0, bri:o.brightnessRandomness > 0 ? 1 + (r() * 2 - 1) * o.brightnessRandomness : 1};
}
const GEN = {
  /* 沿路径置入：每条子路径从起点开始，图章中心间隔＝(前一份宽＋这份宽)/2＋间距（宽＝图案宽×缩放）；
     角度 0＝图案的直轴垂直于路径、90＝顺着路径；与路径的距离＝沿法线外移（替代图案＝一份在这边、下一份在那边）；
     缩放连续性＝每多一份缩放乘一次；调整间距以适合＝把间距摊匀让每条闭合子路径首尾刚好接上；跳过符号旋转＝不跟着切线转 */
  placeAlongPath(pat, o, g){
    const out = [], r = rng(o.seed), prog = o.scaleProgression / 100;
    for (const pts of g.polys){
      const cum = arcTable(pts), L = cum[cum.length - 1], closed = pts.closed; if (L < 1) continue;
      const sizes = [], centers = [];
      let sc = o.patternScale, w = pat.width * sc, s = w / 2;
      for (let i = 0; i < 20000; i++){
        if (i > 0 && (closed ? s + w / 2 > L + 0.5 : s > L + 0.5)) break;
        sizes.push(sc); centers.push(s);
        const nsc = sc * prog; if (nsc < 0.005) break;
        const nw = pat.width * nsc; s += w / 2 + o.spacing + nw / 2; sc = nsc; w = nw;
      }
      const n = centers.length;
      if (o.adjustSpacing && n > 1){
        const w0 = pat.width * sizes[0] / 2, wl = pat.width * sizes[n - 1] / 2;
        const step = closed ? L / n : (L - w0 - wl) / (n - 1);
        for (let i = 0; i < n; i++) centers[i] = w0 + i * step;
      }
      for (let i = 0; i < n; i++){
        const p = pointAt(pts, cum, centers[i], closed), t = tangentAt(pts, cum, centers[i], closed), nrm = [-t[1], t[0]];
        const side = o.alternate && (out.length % 2) ? -1 : 1, d = o.distanceFromPath * side;
        const rot = (o.skipRotation ? 0 : Math.atan2(t[1], t[0])) + o.angleFromPath * DEG;
        out.push(Object.assign({x:p[0] + nrm[0] * d, y:p[1] + nrm[1] * d, rot, sx:sizes[i], sy:sizes[i]}, jitter(o, r)));
      }
    }
    return out;
  },
  /* 砖形填充：一格＝图案×缩放＋间距；每一行比上一行横移「行之间的位移」%；每一份绕自己中心转「图案旋转角度」 */
  brickFill(pat, o, g){
    const out = [], r = rng(o.seed), cw = pat.width * o.patternScale + o.spacing, ch = pat.height * o.patternScale + o.spacing;
    if (cw < 1 || ch < 1) return out;
    const [x0, y0, x1, y1] = g.area, pad = Math.hypot(cw, ch);
    for (let row = Math.floor(-pad / ch); y0 + row * ch < y1 + pad; row++){
      const off = ((row * o.rowOffset / 100 * cw) % cw + cw) % cw;
      for (let c = Math.floor(-pad / cw) - 1; x0 + c * cw + off < x1 + pad; c++)
        out.push(Object.assign({x:x0 + (c + 0.5) * cw + off, y:y0 + (row + 0.5) * ch, rot:o.angle * DEG, sx:o.patternScale, sy:o.patternScale}, jitter(o, r)));
    }
    return out;
  },
  /* 十字线织物：方格（边长＝图案长边×缩放）里一格横放、一格直放，像编织 */
  crossWeave(pat, o, g){
    const out = [], r = rng(o.seed), u = Math.max(pat.width, pat.height) * o.patternScale; if (u < 1) return out;
    const [x0, y0, x1, y1] = g.area, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + u;
    const c = Math.cos(o.angle * DEG), s = Math.sin(o.angle * DEG), n = Math.ceil(R / u);
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++){
      const lx = (i + 0.5) * u, ly = (j + 0.5) * u;
      out.push(Object.assign({x:cx + lx * c - ly * s, y:cy + lx * s + ly * c, rot:o.angle * DEG + (((i + j) & 1) ? Math.PI / 2 : 0), sx:o.patternScale, sy:o.patternScale}, jitter(o, r)));
    }
    return out;
  },
  /* 随机填充：份数＝密度×面积÷（图案面积×平均缩放²）；位置／缩放（最小～最大缩放因子）／转角（勾「旋转图案」）都随机；中心不在选区里的不要 */
  randomFill(pat, o, g){
    const out = [], r = rng(o.seed), [x0, y0, x1, y1] = g.area, lo = Math.min(o.minScale, o.maxScale), hi = Math.max(o.minScale, o.maxScale), m = (lo + hi) / 2;
    const n = Math.min(20000, Math.round(o.density * (x1 - x0) * (y1 - y0) / Math.max(1, pat.width * pat.height * m * m)));
    for (let i = 0, tries = 0; i < n && tries < n * 4; tries++){
      const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0), sc = lo + (hi - lo) * r(), rot = o.rotate ? r() * Math.PI * 2 : 0;
      if (g.cov && !g.cov[Math.floor(y) * g.docW + Math.floor(x)]) continue;
      out.push(Object.assign({x, y, rot, sx:sc, sy:sc}, jitter(o, r))); i++;
    }
    return out;
  },
  /* 螺线：从填充范围中心往外的阿基米德螺线（圈距＝相邻两圈的距离），沿螺线每隔（图案宽×缩放＋间距）放一份；勾「旋转图案」＝跟着切线转 */
  spiral(pat, o, g){
    const out = [], r = rng(o.seed), [x0, y0, x1, y1] = g.area, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, maxR = Math.hypot(x1 - x0, y1 - y0) / 2 + pat.width * o.patternScale;
    const b = o.turnSpacing / (2 * Math.PI), step = Math.max(1, pat.width * o.patternScale + o.spacing);
    let th = Math.max(0.5, step / Math.max(1, o.turnSpacing) * 2), acc = step;
    while (b * th < maxR && out.length < 20000){
      const rr = b * th, dth = Math.min(0.05, 1 / Math.max(rr, 1)), ds = Math.hypot(rr, b) * dth; acc += ds; th += dth;
      if (acc < step) continue; acc = 0;
      const x = cx + rr * Math.cos(th), y = cy + rr * Math.sin(th), tx = b * Math.cos(th) - rr * Math.sin(th), ty = b * Math.sin(th) + rr * Math.cos(th);
      out.push(Object.assign({x, y, rot:o.rotate ? Math.atan2(ty, tx) : 0, sx:o.patternScale, sy:o.patternScale}, jitter(o, r)));
    }
    return out;
  },
  /* 对称填充：边长 c＝图案长边×缩放的格子，2×2 格一组按壁纸群排（p1 平移／p2 180° 旋转／pm 镜像／pg 滑移镜像／pmm 双向镜像／p4 90° 旋转），整组可平移、可转角 */
  symmetryFill(pat, o, g){
    const out = [], r = rng(o.seed), sc = o.patternScale, c = Math.max(pat.width, pat.height) * sc; if (c < 1) return out;
    const [x0, y0, x1, y1] = g.area, ox = x0 + o.translateX, oy = y0 + o.translateY, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const R = Math.hypot(x1 - x0, y1 - y0) / 2 + Math.hypot(o.translateX, o.translateY) + 2 * c, n = Math.ceil(R / (2 * c)) + 1;
    const ca = Math.cos(o.angle * DEG), sa = Math.sin(o.angle * DEG);
    const bx = Math.round((cx - ox) / (2 * c)), by = Math.round((cy - oy) / (2 * c));
    for (let j = by - n; j <= by + n; j++) for (let i = bx - n; i <= bx + n; i++) for (let q = 0; q < 4; q++){
      const qx = q & 1, qy = q >> 1;
      let lx = (2 * i + qx + 0.5) * c, ly = (2 * j + qy + 0.5) * c, rot = 0, sx = sc, sy = sc;
      switch (o.symmetry){
        case 'p2': if ((qx + qy) & 1) rot = Math.PI; break;
        case 'pm': if (qx) sx = -sc; break;
        case 'pg': if (qx){ sy = -sc; ly += c / 2; } break;
        case 'pmm': if (qx) sx = -sc; if (qy) sy = -sc; break;
        case 'p4': rot = [0, 1, 3, 2][q] * Math.PI / 2; break;
      }
      // 整组绕填充范围中心转 angle
      const dx = ox + lx - cx, dy = oy + ly - cy;
      out.push(Object.assign({x:cx + dx * ca - dy * sa, y:cy + dx * sa + dy * ca, rot:rot + o.angle * DEG, sx, sy}, jitter(o, r)));
    }
    return out;
  },
};

/* ── 盖章：图案块做成画布（快取），颜色／亮度随机性＝那一份先调色再盖 ── */
const tileCache = new Map();
function tileCanvas(pat){
  let c = tileCache.get(pat.id); if (c) return c;
  c = document.createElement('canvas'); c.width = pat.width; c.height = pat.height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pat.px), pat.width, pat.height), 0, 0);
  if (tileCache.size > 16) tileCache.clear(); tileCache.set(pat.id, c); return c;
}
/* 色相转 hue 度（YIQ 平面上转）＋亮度乘 bri */
function tinted(pat, hue, bri){
  const c = document.createElement('canvas'); c.width = pat.width; c.height = pat.height;
  const src = pat.px, im = new ImageData(pat.width, pat.height), d = im.data, a = hue * DEG, cs = Math.cos(a), sn = Math.sin(a);
  for (let i = 0; i < src.length; i += 4){
    const R = src[i], G = src[i + 1], B = src[i + 2];
    const y = 0.299 * R + 0.587 * G + 0.114 * B, I = 0.596 * R - 0.274 * G - 0.322 * B, Q = 0.211 * R - 0.523 * G + 0.312 * B;
    const I2 = I * cs - Q * sn, Q2 = I * sn + Q * cs, Y = y * bri;
    d[i] = Y + 0.956 * I2 + 0.621 * Q2; d[i + 1] = Y - 0.272 * I2 - 0.647 * Q2; d[i + 2] = Y - 1.106 * I2 + 1.703 * Q2; d[i + 3] = src[i + 3];
  }
  c.getContext('2d').putImageData(im, 0, 0); return c;
}
function stampInto(ctx, pat, stamps, ox, oy){
  const base = tileCanvas(pat), hw = pat.width / 2, hh = pat.height / 2;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  for (const s of stamps){
    const img = (s.hue || s.bri !== 1) ? tinted(pat, s.hue || 0, s.bri) : base;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(s.x - ox, s.y - oy); ctx.rotate(s.rot); ctx.scale(s.sx, s.sy);
    ctx.drawImage(img, -hw, -hh);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/* 给 fillCmd：p＝ps.edit.fill 的参数、area＝填充范围（选区外框∩画布，或整个画布）→ {area, px:Float32 straight RGBA, script, stamps} */
function render(p, pat, area, cov){
  const name = typeof p.script === 'string' ? NAMES.find(n => n.toLowerCase() === p.script.toLowerCase()) : null;
  if (!name) return {error:`unknown script \`${p.script}\` (${NAMES.join('|')})`};
  const nz = normalize(name, p.scriptOptions); if (nz.error) return {error:nz.error};
  const g = {area, cov, docW:Doc.width};
  if (NEEDS_PATH[name]){ g.polys = pathPolys(p.path); if (!g.polys || !g.polys.length) return {error:T('pse.so.needPath')}; }
  const stamps = GEN[name](pat, nz.o, g);
  const w = area[2] - area[0], h = area[3] - area[1], c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); stampInto(ctx, pat, stamps, area[0], area[1]);
  const u8 = ctx.getImageData(0, 0, w, h).data, px = new Float32Array(u8.length);
  for (let i = 0; i < u8.length; i++) px[i] = u8[i] / 255;
  return {area, px, script:name, stamps:stamps.length};
}
function check(name){
  if (!SPEC[name]) return fail(`unknown script \`${name}\``);
  if (NEEDS_PATH[name] && !(pathPolys() || []).length) return fail(T('pse.so.needPath'));
  return {ok:true};
}

/* ── 对话框 ── */
const LAST = {};                                                   // 这次开着的期间记住各脚本上回的值（PS 也是）
const PW = 300, PH = 380;
function previewCurve(){                                           // 示范曲线（PS 预览也是一条固定的 S 形曲线）
  const pts = []; for (let i = 0; i <= 200; i++){ const t = i / 200, u = 1 - t;
    const P = [[4, PH - 40], [PW * 0.55, PH * 0.6], [PW * 0.45, PH * 0.4], [PW - 4, 30]];
    pts.push([u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0], u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1]]); }
  pts.closed = false; return pts;
}
function ensureCss(){
  if (document.getElementById('pse-fs-style')) return;
  const s = document.createElement('style'); s.id = 'pse-fs-style'; s.textContent = `
.pse-fs{max-width:none!important;display:flex;flex-direction:column}
.pse-fs .wrap{display:flex;gap:14px;align-items:flex-start}
.pse-fs canvas.prev{background:#fff;border:1px solid #444a55;width:${PW}px;height:${PH}px}
.pse-fs .col{width:300px}
.pse-fs .fr{display:flex;align-items:center;gap:6px;margin:4px 0}
.pse-fs .fr .lb{width:120px;text-align:right;color:#b8bec8}
.pse-fs .fr input[type=number],.pse-fs .fr select{background:#1d2026;color:#e6e8ec;border:1px solid #444a55;border-radius:3px;padding:2px 5px;width:64px}
.pse-fs .fr select{width:150px}
.pse-fs input[type=range]{width:100%;margin:0 0 4px}
.pse-fs .btns{display:flex;flex-direction:column;gap:8px;min-width:84px}
.pse-fs .btns button{background:#3a404a;color:#e6e8ec;border:1px solid #555c68;border-radius:4px;padding:4px 14px;cursor:pointer}
.pse-fs .btns button.pri{background:#2f7fd8;border-color:#2f7fd8}
.pse-fs .err{color:#ff8d7a;min-height:16px;font-size:12px;margin-top:6px}`;
  document.head.appendChild(s);
}
const unitText = u => u === 'px' ? T('pse.so.px') : u === 'deg' ? T('pse.so.deg') : u === '%' ? '%' : '';
const FS = {
  names:NAMES, spec:SPEC, defaults, render, check, cur:null,
  close(){ if (this.cur){ this.cur.el.remove(); this.cur = null; } },
  /* p＝填充框收集到的 {pattern, mode, opacity, preserveTransparency, script} */
  openDialog(p){
    const name = NAMES.find(n => n === p.script); if (!name) return fail(`unknown script \`${p.script}\``);
    const ck = check(name); if (ck.ok === false) return ck;
    const pat = PE.patterns.resolve(typeof p.pattern === 'string' ? p.pattern : ''); if (!pat) return fail('no pattern');
    this.close(); ensureCss();
    const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
    const back = mk('div', 'pse-back'), box = mk('div', 'pse-dlg pse-fs'); box.dataset.cmd = 'ps.edit.fill.script'; box.dataset.script = name;
    box.appendChild(mk('div', 'pse-title', T('pse.script.' + name)));
    const wrap = mk('div', 'wrap'), cv = mk('canvas', 'prev'); cv.width = PW; cv.height = PH; cv.dataset.k = 'preview';
    const col = mk('div', 'col'), btns = mk('div', 'btns'); wrap.append(cv, col, btns); box.appendChild(wrap);
    const err = mk('div', 'err'); box.appendChild(err);
    // 预设：自定（PS 这一栏只有「自定」，存不了新预设）
    const pr = mk('div', 'fr'), ps = mk('select'); ps.dataset.k = 'preset'; const op = mk('option', '', T('pse.so.custom')); op.value = 'custom'; ps.appendChild(op);
    pr.append(mk('span', 'lb', T('pse.so.preset')), ps); col.appendChild(pr);
    const F = {}, start = Object.assign(defaults(name), LAST[name] || {});
    for (const s of SPEC[name]){
      const r = mk('div', 'fr');
      if (s.type === 'check'){
        const c = mk('input'); c.type = 'checkbox'; c.dataset.k = s.k; c.checked = !!start[s.k];
        const l = mk('label'); l.style.cssText = 'display:flex;align-items:center;gap:6px;margin-left:126px'; l.append(c, mk('span', '', T('pse.so.' + s.k))); r.appendChild(l); col.appendChild(r);
        F[s.k] = {s, get:() => c.checked, set:v => { c.checked = !!v; }}; c.addEventListener('change', () => redraw());
        continue;
      }
      if (s.type === 'select'){
        const sel = mk('select'); sel.dataset.k = s.k; s.options.forEach(v => { const o = mk('option', '', T('pse.so.' + s.k + '.' + v)); o.value = v; sel.appendChild(o); }); sel.value = start[s.k];
        r.append(mk('span', 'lb', T('pse.so.' + s.k)), sel); col.appendChild(r);
        F[s.k] = {s, get:() => sel.value, set:v => { sel.value = v; }}; sel.addEventListener('change', () => redraw());
        continue;
      }
      const num = mk('input'); num.type = 'number'; num.dataset.k = s.k; num.min = s.min; num.max = s.max; num.step = s.step;
      const sl = mk('input'); sl.type = 'range'; sl.dataset.k = s.k; sl.dataset.slider = '1'; sl.min = s.min; sl.max = s.max; sl.step = s.step;
      const fmt = v => s.dec ? (+v).toFixed(s.dec).replace(/0+$/, '').replace(/\.$/, '') : String(Math.round(v));
      const set = v => { v = clamp(+v, s.min, s.max); num.value = fmt(v); sl.value = v; };
      set(start[s.k]);
      r.append(mk('span', 'lb', T('pse.so.' + s.k)), num, mk('span', '', unitText(s.unit))); col.appendChild(r); col.appendChild(sl);
      num.addEventListener('input', () => { const v = parseFloat(num.value); if (isFinite(v)){ sl.value = clamp(v, s.min, s.max); redraw(); } });
      num.addEventListener('change', () => { const v = parseFloat(num.value); set(isFinite(v) ? v : s.def); redraw(); });
      sl.addEventListener('input', () => { num.value = fmt(sl.value); redraw(); });
      F[s.k] = {s, get:() => { const v = parseFloat(num.value); return isFinite(v) ? clamp(v, s.min, s.max) : s.def; }, set};
    }
    const vals = () => { const o = {}; for (const k in F) o[k] = F[k].get(); return o; };
    /* 预览：沿路径置入＝示范曲线（灰线）上盖章；其他＝整块示范区域 */
    let raf = 0;
    const draw = () => {
      raf = 0; const x = cv.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = '#fff'; x.fillRect(0, 0, PW, PH);
      const o = normalize(name, vals()).o, g = {area:[0, 0, PW, PH], cov:null, docW:PW};
      if (NEEDS_PATH[name]){ const c = previewCurve(); g.polys = [c]; x.strokeStyle = '#b8b8b8'; x.lineWidth = 1; x.beginPath(); c.forEach((q, i) => i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1])); x.stroke(); }
      const st = GEN[name](pat, o, g); stampInto(x, pat, st, 0, 0); cv.dataset.stamps = st.length;
    };
    const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
    const btn = (key, act, fn, pri) => { const b = mk('button', pri ? 'pri' : '', T(key)); b.type = 'button'; b.dataset.act = act; b.onclick = fn; btns.appendChild(b); return b; };
    const ok = () => {
      const so = vals(); LAST[name] = so;
      const q = Object.assign({}, p, {contents:'pattern', script:name, scriptOptions:so});
      let r; try { r = CMD.run('ps.edit.fill', q); } catch(e){ r = fail(String(e && e.message || e)); }
      if (r && r.ok === false){ err.textContent = r.error || 'error'; return; }
      this.close(); if (window.UI){ UI.refresh(); UI.draw(); }
    };
    btn('pse.ok', 'ok', ok, true);
    btn('pse.so.reset', 'reset', () => { const d = defaults(name); for (const k in F) F[k].set(d[k]); err.textContent = ''; redraw(); });
    btn('pse.cancel', 'cancel', () => this.close());
    back.appendChild(box);
    box.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON'){ e.preventDefault(); ok(); }
      else if (e.key === 'Escape'){ e.preventDefault(); this.close(); }
    });
    back.addEventListener('pointerdown', e => e.stopPropagation());
    back.addEventListener('mousedown', e => e.stopPropagation());
    document.body.appendChild(back);
    this.cur = {el:back, name, box};
    draw();
    const first = col.querySelector('input[type=number]'); if (first){ first.focus(); try { first.select(); } catch(e){} }
    return {ok:true, dialog:'ps.edit.fill.script', script:name};
  },
};
PE.fillScript = FS;
// 对话框开着时 Esc 焦点在框外也关
window.addEventListener('keydown', e => { if (FS.cur && e.key === 'Escape' && !FS.cur.el.contains(e.target)){ e.preventDefault(); e.stopPropagation(); FS.close(); } }, true);

CMD.reg('ps.edit.fill.script.dialog', {i18n:'', params:'{script:"brickFill|crossWeave|placeAlongPath|randomFill|spiral|symmetryFill", pattern?:id|名字, mode?, opacity?, preserveTransparency?, path?} '
     + '开那个填充脚本的对话框（左预览、右栏位、确定／复位／取消；＝填充框选「图案」勾「脚本」按确定后出来的那个）；确定＝跑 ps.edit.fill {contents:"pattern", script, scriptOptions}'},
  p => FS.openDialog(Object.assign({mode:'normal', opacity:100, preserveTransparency:false}, p || {})));
CMD.reg('ps.edit.fill.script.list', {i18n:'', params:'{} 填充脚本清单与各自的 scriptOptions 栏位（k、范围、缺省、单位；沿路径置入要一条路径） → [{id, name, needsPath, options:[…]}]'},
  () => NAMES.map(n => ({id:n, name:T('pse.script.' + n), needsPath:!!NEEDS_PATH[n], options:SPEC[n].map(s => Object.assign({}, s))})));

/* ── 三语 ── */
Lang.add({
  'zh-Hant':{
    'pse.scriptChk':'指令碼(S)：', 'pse.script.brickFill':'磚塊填滿', 'pse.script.crossWeave':'十字織紋', 'pse.script.placeAlongPath':'沿路徑放置', 'pse.script.randomFill':'隨機填滿', 'pse.script.spiral':'螺旋', 'pse.script.symmetryFill':'對稱填滿',
    'pse.so.preset':'預設集：', 'pse.so.custom':'自訂', 'pse.so.reset':'重設', 'pse.so.px':'像素', 'pse.so.deg':'度', 'pse.so.needPath':'「沿路徑放置」需要一條路徑：請先建立或選取路徑。',
    'pse.so.patternScale':'圖樣縮放：', 'pse.so.spacing':'間距：', 'pse.so.adjustSpacing':'調整間距以符合', 'pse.so.angleFromPath':'與路徑的角度：', 'pse.so.distanceFromPath':'與路徑的距離：',
    'pse.so.alternate':'替代圖樣', 'pse.so.scaleProgression':'縮放進度：', 'pse.so.skipRotation':'略過符號旋轉', 'pse.so.colorRandomness':'顏色隨機性：', 'pse.so.brightnessRandomness':'亮度隨機性：',
    'pse.so.rowOffset':'列之間的位移：', 'pse.so.angle':'圖樣旋轉角度：', 'pse.so.density':'密度：', 'pse.so.minScale':'最小縮放係數：', 'pse.so.maxScale':'最大縮放係數：', 'pse.so.rotate':'旋轉圖樣',
    'pse.so.turnSpacing':'螺旋間距：', 'pse.so.symmetry':'對稱類型：', 'pse.so.translateX':'圖樣平移 X：', 'pse.so.translateY':'圖樣平移 Y：',
    'pse.so.symmetry.p1':'平移 (p1)', 'pse.so.symmetry.p2':'180° 旋轉 (p2)', 'pse.so.symmetry.pm':'鏡射 (pm)', 'pse.so.symmetry.pg':'滑移鏡射 (pg)', 'pse.so.symmetry.pmm':'雙向鏡射 (pmm)', 'pse.so.symmetry.p4':'90° 旋轉 (p4)',
  },
  'zh-Hans':{
    'pse.scriptChk':'脚本(S)：', 'pse.script.brickFill':'砖形填充', 'pse.script.crossWeave':'十字线织物', 'pse.script.placeAlongPath':'沿路径置入', 'pse.script.randomFill':'随机填充', 'pse.script.spiral':'螺线', 'pse.script.symmetryFill':'对称填充',
    'pse.so.preset':'预设：', 'pse.so.custom':'自定', 'pse.so.reset':'复位', 'pse.so.px':'像素', 'pse.so.deg':'度', 'pse.so.needPath':'「沿路径置入」需要一条路径：请先建立或选中路径。',
    'pse.so.patternScale':'图案缩放：', 'pse.so.spacing':'间距：', 'pse.so.adjustSpacing':'调整间距以适合', 'pse.so.angleFromPath':'与路径的角度：', 'pse.so.distanceFromPath':'与路径的距离：',
    'pse.so.alternate':'替代图案', 'pse.so.scaleProgression':'缩放连续性：', 'pse.so.skipRotation':'跳过符号旋转', 'pse.so.colorRandomness':'颜色随机性：', 'pse.so.brightnessRandomness':'亮度随机性：',
    'pse.so.rowOffset':'行之间的位移：', 'pse.so.angle':'图案旋转角度：', 'pse.so.density':'密度：', 'pse.so.minScale':'最小缩放因子：', 'pse.so.maxScale':'最大缩放因子：', 'pse.so.rotate':'旋转图案',
    'pse.so.turnSpacing':'螺线间距：', 'pse.so.symmetry':'对称类型：', 'pse.so.translateX':'图案平移 X：', 'pse.so.translateY':'图案平移 Y：',
    'pse.so.symmetry.p1':'平移 (p1)', 'pse.so.symmetry.p2':'180° 旋转 (p2)', 'pse.so.symmetry.pm':'镜像 (pm)', 'pse.so.symmetry.pg':'滑移镜像 (pg)', 'pse.so.symmetry.pmm':'双向镜像 (pmm)', 'pse.so.symmetry.p4':'90° 旋转 (p4)',
  },
  en:{
    'pse.scriptChk':'Script:', 'pse.script.brickFill':'Brick Fill', 'pse.script.crossWeave':'Cross Weave', 'pse.script.placeAlongPath':'Place Along Path', 'pse.script.randomFill':'Random Fill', 'pse.script.spiral':'Spiral', 'pse.script.symmetryFill':'Symmetry Fill',
    'pse.so.preset':'Preset:', 'pse.so.custom':'Custom', 'pse.so.reset':'Reset', 'pse.so.px':'pixels', 'pse.so.deg':'degrees', 'pse.so.needPath':'Place Along Path needs a path: make or select a path first.',
    'pse.so.patternScale':'Pattern Scale:', 'pse.so.spacing':'Spacing:', 'pse.so.adjustSpacing':'Adjust spacing to fit', 'pse.so.angleFromPath':'Angle from path:', 'pse.so.distanceFromPath':'Distance from path:',
    'pse.so.alternate':'Alternate patterns', 'pse.so.scaleProgression':'Scale progression:', 'pse.so.skipRotation':'Skip symbol rotation', 'pse.so.colorRandomness':'Color randomness:', 'pse.so.brightnessRandomness':'Brightness randomness:',
    'pse.so.rowOffset':'Offset between rows:', 'pse.so.angle':'Pattern rotate angle:', 'pse.so.density':'Density:', 'pse.so.minScale':'Minimum scale factor:', 'pse.so.maxScale':'Maximum scale factor:', 'pse.so.rotate':'Rotate pattern',
    'pse.so.turnSpacing':'Spiral spacing:', 'pse.so.symmetry':'Symmetry:', 'pse.so.translateX':'Pattern translate X:', 'pse.so.translateY':'Pattern translate Y:',
    'pse.so.symmetry.p1':'Translation (p1)', 'pse.so.symmetry.p2':'180° rotation (p2)', 'pse.so.symmetry.pm':'Mirror (pm)', 'pse.so.symmetry.pg':'Glide reflection (pg)', 'pse.so.symmetry.pmm':'Double mirror (pmm)', 'pse.so.symmetry.p4':'90° rotation (p4)',
  },
});
})();
