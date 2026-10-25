/* 堤麟画板 · 菜单实作（二）· Photoshop ▸ 图层 其余各项（命令名一律 ps.<原码 id>）
   menus/impl/ps-layer.js 管图层锁定等，这里的实作全放这支、不碰那支。
   照 ArtCraft photocraft 原码逐段翻：
   - engine/src/commands.rs        158-168 new_adjustment；531-546 create／releaseClippingMask；602-639 newFillLayer.solidColor／gradient；
                                   640-659 layer.setAdjustment；860-934 调整层命令表（跟 image.adjustments.* 同一张表、同一份参数）
   - engine/src/pattern_cmds.rs    295-316 placement／new_fill_layer（图案填充层）
   - engine/src/extra_cmds.rs      357-367 toggle_mask（链接图层蒙版）；494-531 rasterize_one（栅格化 ▸ 填充内容）
   - engine/src/layer_menu_cmds.rs 74-80 has_content_options；629-644 content_options（图层内容选项）
   - engine/src/vector_cmds.rs     537-590 shape_edit 的 op（合并形状四项）；908-1024 矢量蒙版（add／edit／delete／rasterize／toggle）；1026-1051 merge_components
   - engine/src/slice_cmds.rs      61-88 layer_bounds／layer_slice_rect、92-119 refresh、399-427 newLayerBasedSlice
   - compose/src/lib.rs            507-525 composite_stack（剪贴组：基底＋上面连续的剪贴层）、650-702 mask_vals／render_content、
                                   736-785 fill_frame／render_fill、1115-1139 调整层（复制背景→调整→按蒙版×不透明度用混合模式混回）、1410-1469 composite_atop_any
   - compose/src/gradient_fill.rs  20-140 Ramp（色标＋中点）／render；compose/src/pattern.rs 148-185 Placement；vector/src/lib.rs 88-122 CompiledVectorMask
   - doc/src/lib.rs                396-465 LayerContent（Adjustment／Fill）、Layer.clipped／vector_mask；doc/src/vector.rs 188-203 VectorMask
   我们的资料模型（不改 engine.js）：
     调整图层＝kind:'raster'（文件大小的透明画布）＋ L.adjust = {kind, params}（params 与 ps.image.adjustments.<kind> 同一份）
     填充图层＝kind:'raster' ＋ L.fillLayer = {type:'solid'|'gradient'|'pattern', …}；画布＝按参数算好的像素（像原码的 FillCache），参数变了才重算
     剪贴蒙版＝L.clipped:true；矢量蒙版＝L.vmask = {shapes:[形状（文件坐标）], inverted, enabled, linked, density, feather, ax, ay}
     取消链接的图层蒙版＝L.maskLinked:false ＋ L.maskAnchor:[x,y]；基于图层的切片＝Doc.slices
   合成：挂在 PsLayerStyle.has／draw 上（engine composite 与 ps-layer.js 的合并／拼合都走这两支），不碰 engine.js。 */
(function(){
'use strict';
if (window.PsLayer2) return;               // 防重复载入（测试 add_script_tag＋index.html 都挂时）
if (!window.PsLayerStyle || !window.PsLayer){ console.error('ps-layer2.js 要先载 menus/impl/ps-layer.js'); return; }

const L3 = (hant, hans, en) => Lang.cur === 'en' ? en : Lang.cur === 'zh-Hans' ? hans : hant;
const fail = msg => ({ok:false, error:msg});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isNum = v => typeof v === 'number' && isFinite(v);
const num = (p, k, d) => (p && p[k] !== undefined && p[k] !== null && p[k] !== '' && isFinite(+p[k])) ? +p[k] : d;
const bool = (p, k, d) => (p && typeof p[k] === 'boolean') ? p[k] : d;
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
const ctx2d = c => c.getContext('2d', {willReadFrequently:true});
const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
const hide = (o, k, v) => Object.defineProperty(o, k, {value:v, writable:true, configurable:true, enumerable:false});
const layerOf = p => Doc.byId((p && (p.id || p.layer || p.layerId)) || Doc.activeId);
const fgHex = () => { const e = document.getElementById('fillColor'); return (e && e.value) || '#000000'; };      // PS 版面：前景色＝第一个色块
const bgHex = () => { const e = document.getElementById('strokeColor'); return (e && e.value) || '#ffffff'; };   // 背景色＝第二个色块
const UI_OPEN = {ok:false, dialog:true};    // 界面开了对话框：这次不改文件（CMD.run 会把空的一步退掉）
const UIP = ' · ui:true＝开对话框（界面用）';
function hexOf(v, d){
  if (Array.isArray(v) && v.length >= 3) return '#' + v.slice(0, 3).map(x => Math.round(clamp(+x || 0, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  if (typeof v === 'string'){ const s = v.replace(/^#+/, ''); if (/^[0-9a-f]{6}$/i.test(s.slice(0, 6))) return '#' + s.slice(0, 6).toLowerCase(); if (/^[0-9a-f]{3}$/i.test(s)) return '#' + s.split('').map(c => c + c).join('').toLowerCase(); }
  return d;
}
const rgb01 = h => { const c = hexToRGB(h); return [c[0] / 255, c[1] / 255, c[2] / 255]; };
/* doc.next_layer_name(base)：现有「base N」最大的 N＋1 */
function nextName(base){
  let n = 0; const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' (\\d+)$');
  Doc.layers.forEach(L => { const m = re.exec(L.name); if (m) n = Math.max(n, +m[1]); });
  return base + ' ' + (n + 1);
}
/* doc.insert_above(active)：插在当前层之上并设为当前层 */
function insertAbove(L){
  const i = Doc.index(Doc.activeId); Doc.add(L, i < 0 ? Doc.layers.length : i + 1);
  // PS：插进剪贴组中间（上面那层是剪贴层）＝新层也成剪贴层（图层面板带 ↓）
  const up = Doc.layers[Doc.layers.indexOf(L) + 1];
  if (up && up.clipped && pkOf(up) === pkOf(L)) L.clipped = true;
  return L;
}
/* PS：新建调整／填充图层自带一个图层蒙版（有选区＝选区做蒙版、并取消选区；没有＝全白），建好就选中蒙版（缩图白框框住蒙版）。p.mask:false＝不带 */
function defaultMask(L, p){
  if (p && p.mask === false) return;
  const c = mkCanvas(Doc.width, Doc.height), x = ctx2d(c), def = Doc.sel ? 0 : 255;   // 预设色：照选区做＝黑底（显示选区），全白＝白
  if (Doc.sel){ x.drawImage(window.SelMask ? SelMask.maskCanvas(null) : (() => { const s = Doc.sel, q = mkCanvas(Doc.width, Doc.height), qx = ctx2d(q); qx.fillStyle = '#fff'; qx.fillRect(s.x, s.y, s.w, s.h); return q; })(), 0, 0); Doc.sel = null; }
  else { x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); }
  L.mask = {id:'M' + L.id + '_' + Date.now().toString(36), kind:'raster', name:'mask', visible:true, opacity:1, blend:'normal', mask:null, x:0, y:0, _cache:null, _cacheScale:0, data:{canvas:c, ctx:x}, defaultColor:def};
  Doc.maskEdit = L.id;
}

/* ═══════════ 新栏位进历史／工程档／复制 ═══════════
   engine.js 的 LAYER_EXTRA 是快照要带的图层栏位清单（snap 深拷、restore 原样写回）；这里把本档的栏位加进去。 */
const EXTRA2 = ['adjust', 'fillLayer', 'clipped', 'vmask', 'maskLinked', 'maskAnchor', 'video'];
if (typeof LAYER_EXTRA !== 'undefined' && Array.isArray(LAYER_EXTRA)) EXTRA2.forEach(k => { if (!LAYER_EXTRA.includes(k)) LAYER_EXTRA.push(k); });
else if (!History._ps2LayerShim){                 // 退路：engine 没有 LAYER_EXTRA 时自己包一层（同 ps-layer.js 28-62 的写法）
  const grab = L => { const o = {}; EXTRA2.forEach(k => { if (L[k] != null) o[k] = clone(L[k]); }); return o; };
  const put = s => { if (s && s.ps2Extra) Doc.layers.forEach((L, i) => { const o = s.ps2Extra[i] || {}; EXTRA2.forEach(k => { if (o[k] !== undefined) L[k] = clone(o[k]); else delete L[k]; }); }); };
  const s0 = History.snap, r0 = History.restore, ri0 = History.restoreInPlace;
  History.snap = function(){ const s = s0.apply(this, arguments); s.ps2Extra = Doc.layers.map(grab); return s; };
  History.restore = function(s){ const r = r0.apply(this, arguments); put(s); return r; };
  History.restoreInPlace = function(s){ const r = ri0.apply(this, arguments); put(s); return r; };
  History._ps2LayerShim = true;
}
/* 文件级的新栏位：Doc.slices（基于图层的切片）——快照另包一层 */
if (!History._ps2DocShim){
  const s0 = History.snap, r0 = History.restore, ri0 = History.restoreInPlace;
  const put = s => { if (s && s.ps2Slices !== undefined) Doc.slices = clone(s.ps2Slices) || []; };
  History.snap = function(){ const s = s0.apply(this, arguments); s.ps2Slices = clone(Doc.slices || []); return s; };
  History.restore = function(s){ const r = r0.apply(this, arguments); put(s); return r; };
  History.restoreInPlace = function(s){ const r = ri0.apply(this, arguments); put(s); return r; };
  History._ps2DocShim = true;
}
Doc.slices = Doc.slices || [];
{ const reset0 = Doc.reset; Doc.reset = function(){ this.slices = []; return reset0.apply(this, arguments); }; }
/* 工程档：每层的新栏位放 o.ps2，切片放 slices（serialize 只认它自己那几个键，所以在外面补） */
{
  const ser0 = Project.serialize, load0 = Project.load;
  Project.serialize = function(){
    const j = ser0.apply(this, arguments);
    (j.layers || []).forEach(o => { const L = Doc.byId(o.id); if (!L) return; const x = {}; EXTRA2.forEach(k => { if (L[k] != null) x[k] = clone(L[k]); }); if (Object.keys(x).length) o.ps2 = x; });
    if (Doc.slices && Doc.slices.length) j.slices = clone(Doc.slices);
    return j;
  };
  Project.load = async function(json){
    const r = await load0.apply(this, arguments);
    (json && json.layers || []).forEach(o => {
      if (!o.ps2) return; const L = Doc.byId(o.id); if (!L) return;
      Object.assign(L, clone(o.ps2));
      if (L.fillLayer) hide(L, '_fillKey', fillKey(L));      // 存档里的画布就是算好的像素：不必重算（图案库里没有那个图案也不会变透明）
    });
    Doc.slices = json && Array.isArray(json.slices) ? clone(json.slices) : [];
    if (window.UI) UI.refresh();
    return r;
  };
}
/* 复制图层（engine layer.duplicate 只带 style／fillOpacity／mask）：本档的栏位也跟着复制（原码 Layer::duplicate 整层 clone） */
{
  const c = CMD.map['layer.duplicate'];
  if (c && !c._ps2){ const run0 = c.run; c.run = p => { const src = Doc.byId((p && p.id) || Doc.activeId); const r = run0(p); if (r && r.id && src){ const N = Doc.byId(r.id); if (N) EXTRA2.forEach(k => { if (src[k] != null) N[k] = clone(src[k]); }); } return r; }; c._ps2 = true; }
}
/* 栅格化 ▸ 图层（engine layer.rasterize 只认矢量／文字层）：填充图层也算（extra_cmds.rs:494 rasterize_one kind=="fill"） */
{
  const c = CMD.map['layer.rasterize'];
  if (c && !c._ps2){ const run0 = c.run; c.run = p => { const L = Doc.byId((p && p.id) || Doc.activeId); if (L && L.fillLayer) return rasterizeFill(L); return run0(p); }; c._ps2 = true; }
}
/* 栅格化 ▸ 所有图层（ps-layer.js 那条）：填充图层也一起栅格化（extra_cmds.rs:533 rasterize_all 走 rasterize_one） */
{
  const c = CMD.map['ps.layer.rasterize.allLayers'];
  if (c && !c._ps2){ const run0 = c.run; c.run = p => { const r = run0(p) || {}; let n = 0; Doc.layers.forEach(L => { if (L.fillLayer){ rasterizeFill(L); n++; } }); if (n && r.rasterized !== undefined) r.rasterized += n; return r; }; c._ps2 = true; }
}
/* doc.inspect：每层多带调整／填充／剪贴／矢量蒙版，文件多带切片（给 agent 看） */
{
  const c = CMD.map['doc.inspect'];
  if (c && !c._ps2){ const run0 = c.run; c.run = p => {
    const r = run0(p);
    if (r && Array.isArray(r.layers)) r.layers.forEach(o => { const L = Doc.byId(o.id); if (!L) return;
      if (L.adjust) o.adjustment = L.adjust.kind;
      if (L.fillLayer) o.fillLayer = L.fillLayer.type;
      if (L.clipped) o.clipped = true;
      if (L.vmask) o.vectorMask = {enabled:L.vmask.enabled !== false, shapes:(L.vmask.shapes || []).length, inverted:!!L.vmask.inverted};
      if (L.maskLinked === false) o.maskLinked = false;
      if (L.video) o.video = {frames:L.video.frames.length, fps:L.video.fps};
    });
    if (r){ r.slices = (window.SliceKit && CMD.map['slice.list']) ? CMD.map['slice.list'].run({}).slices : sliceList(); if (Doc.timeline) r.timeline = Object.assign({}, Doc.timeline); }
    return r; }; c._ps2 = true; }
}

/* ═══════════ 混合（compose/src/psblend.rs blend_rgb：W3C 通式）═══════════ */
const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c){
  const l = lum(c), n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]);
  let o = c.slice();
  if (n < 0) o = o.map(v => l + (v - l) * l / (l - n));
  if (x > 1) o = o.map(v => l + (v - l) * (1 - l) / (x - l));
  return o;
}
const setLum = (c, l) => { const d = l - lum(c); return clipColor([c[0] + d, c[1] + d, c[2] + d]); };
const satOf = c => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
function setSat(c, s){
  const o = [0, 0, 0], [mn, md, mx] = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  if (c[mx] > c[mn]){ o[md] = (c[md] - c[mn]) * s / (c[mx] - c[mn]); o[mx] = s; }
  return o;
}
function blendCh(mode, b, s){
  switch (mode){
    case 'multiply': return b * s;
    case 'screen': return b + s - b * s;
    case 'overlay': return b <= 0.5 ? 2 * b * s : s + (2 * b - 1) - s * (2 * b - 1);
    case 'darken': return b < s ? b : s;
    case 'lighten': return b > s ? b : s;
    case 'difference': return b > s ? b - s : s - b;
    default: return s;
  }
}
/* out[0..2] ← B(cb, cs) */
function blendInto(mode, b0, b1, b2, s0, s1, s2, out){
  if (mode === 'hue' || mode === 'saturation' || mode === 'color' || mode === 'luminosity'){
    const cb = [b0, b1, b2], cs = [s0, s1, s2];
    const r = mode === 'hue' ? setLum(setSat(cs, satOf(cb)), lum(cb)) : mode === 'saturation' ? setLum(setSat(cb, satOf(cs)), lum(cb)) : mode === 'color' ? setLum(cs, lum(cb)) : setLum(cb, lum(cs));
    out[0] = r[0]; out[1] = r[1]; out[2] = r[2]; return out;
  }
  out[0] = blendCh(mode, b0, s0); out[1] = blendCh(mode, b1, s1); out[2] = blendCh(mode, b2, s2); return out;
}

/* ═══════════ 蒙版取值（compose/src/lib.rs:650 mask_vals：像素蒙版 × 矢量蒙版）═══════════ */
const vmaskOn = L => !!(L && L.vmask && L.vmask.enabled !== false);
/* 取消链接的像素蒙版：只有像素层的蒙版跟着图层走（engine composite 把蒙版画在图层自己的画布上），所以只对像素层有意义 */
const unlinkedMask = L => !!(L && L.mask && L.kind === 'raster' && L.maskLinked === false && Array.isArray(L.maskAnchor) && (L.maskAnchor[0] !== L.x || L.maskAnchor[1] !== L.y));
/* 矢量蒙版要涂白的那一份（编组／复合路径往下改；隐藏的不画） */
function whiten(s){
  const o = clone(s);
  const go = n => { if (n.visible === false) return; if (n.type === 'group'){ (n.children || []).forEach(go); return; } n.fill = '#ffffff'; n.stroke = 'none'; n.strokeWidth = 0; };
  go(o); return o;
}
/* vector/src/lib.rs:88 CompiledVectorMask：空路径＝全显示（反相＝全隐藏）；密度 d ⇒ 1 − d(1 − v)。白＋alpha＝显示度，文件空间（×scale） */
function vmaskCanvas(L, scale, W, H){
  const vm = L.vmask, key = JSON.stringify([vm, L.x, L.y, scale, W, H]);
  if (L._vmC && L._vmC.key === key) return L._vmC.c;
  let c = mkCanvas(W, H), x = c.getContext('2d');
  const shapes = (vm.shapes || []).filter(s => s && s.visible !== false);
  if (!shapes.length){ if (!vm.inverted){ x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); } }
  else {
    const off = vm.linked !== false ? [L.x - (vm.ax || 0), L.y - (vm.ay || 0)] : [0, 0];
    x.save(); x.translate(off[0] * scale, off[1] * scale); shapes.forEach(s => drawShape(x, whiten(s), scale)); x.restore();
    if (vm.inverted){ const t = mkCanvas(W, H), tx = t.getContext('2d'); tx.fillStyle = '#fff'; tx.fillRect(0, 0, W, H); tx.globalCompositeOperation = 'destination-out'; tx.drawImage(c, 0, 0); c = t; }
  }
  const d = vm.density === undefined ? 1 : clamp(+vm.density, 0, 1);
  if (d < 1){ const t = mkCanvas(W, H), tx = t.getContext('2d'); tx.fillStyle = `rgba(255,255,255,${1 - d})`; tx.fillRect(0, 0, W, H); tx.globalCompositeOperation = 'lighter'; tx.globalAlpha = d; tx.drawImage(c, 0, 0); c = t; }
  hide(L, '_vmC', {key, c});
  return c;
}
/* 像素蒙版画到文件空间（跟 engine composite 一样：蒙版拉成 W×H 贴在图层位置；取消链接时贴在 maskAnchor） */
function pixelMaskCanvas(L, scale, W, H){
  if (!L.mask) return null;
  const c = mkCanvas(W, H), x = c.getContext('2d');
  const at = unlinkedMask(L) ? L.maskAnchor : (L.kind === 'raster' ? [L.x, L.y] : [0, 0]);
  // 像素层的蒙版按自己画布原尺寸贴（画布可比文件大·⛔ 拉成文件大小）
  if (L.kind === 'raster') x.drawImage(renderLayer(L.mask, scale), at[0] * scale, at[1] * scale);
  else x.drawImage(renderLayer(L.mask, scale), at[0] * scale, at[1] * scale, W, H);
  return c;
}
/* 合在一起的蒙版值（Float32，W×H），没有蒙版回 null */
function maskValues(L, scale, W, H){
  const pm = pixelMaskCanvas(L, scale, W, H), vm = vmaskOn(L) ? vmaskCanvas(L, scale, W, H) : null;
  if (!pm && !vm) return null;
  const out = new Float32Array(W * H).fill(1);
  [pm, vm].forEach(c => { if (!c) return; const d = ctx2d(c).getImageData(0, 0, W, H).data; for (let i = 0; i < out.length; i++) out[i] *= d[i * 4 + 3] / 255; });
  return out;
}

/* ═══════════ 剪贴蒙版（compose/src/lib.rs:507 composite_stack）═══════════
   基底＝不剪贴的那一层；它上面连续的 clipped 层是一组。最底下就是 clipped 的层（下面没有基底）自己照常画。 */
const inDoc = L => Doc.layers.indexOf(L) >= 0;
/* 有图层组时剪贴组只在兄弟之间算（composite_stack 是对同一个 children 阵列跑的）：
   pk＝父 id；X 是「同父」⇒ 算；X 在某个同父兄弟组的子树里 ⇒ 跳过；其余（已经走出这个组）⇒ 停 */
const pkOf = L => (L && L.parent && Doc.byId(L.parent) && Doc.byId(L.parent).kind === 'group') ? L.parent : null;
function sibStep(X, pk){
  if (pkOf(X) === pk) return 'same';
  let p = pkOf(X), n = 0;
  while (p && n++ < 1000){ const G = Doc.byId(p); if (pkOf(G) === pk) return 'inside'; p = pkOf(G); }
  return 'out';
}
function baseOf(L){
  if (!L || !L.clipped) return null;
  const i = Doc.layers.indexOf(L); if (i <= 0) return null;
  const pk = pkOf(L);
  for (let j = i - 1; j >= 0; j--){
    const X = Doc.layers[j], s = sibStep(X, pk);
    if (s === 'inside') continue; if (s === 'out') return null;
    if (!X.clipped) return X;
  }
  return null;
}
function membersOf(B){
  if (!B || B.clipped) return [];
  const i = Doc.layers.indexOf(B); if (i < 0) return [];
  const pk = pkOf(B), out = [];
  for (let j = i + 1; j < Doc.layers.length; j++){
    const X = Doc.layers[j], s = sibStep(X, pk);
    if (s === 'inside') continue; if (s === 'out' || !X.clipped) break;
    out.push(X);
  }
  return out;
}
const visibleMembers = B => membersOf(B).filter(c => c.visible && c.opacity > 0);

/* ═══════════ 合成挂点：PsLayerStyle.has／draw ═══════════ */
const PLS = window.PsLayerStyle;
const has0 = PLS.has.bind(PLS), draw0 = PLS.draw.bind(PLS);
function special(L){
  if (!L) return false;
  if (L.adjust || vmaskOn(L) || unlinkedMask(L)) return true;
  if (!inDoc(L)) return false;                    // renderAlone 之类的拷贝：不算剪贴组
  if (baseOf(L)) return true;
  return visibleMembers(L).length > 0;
}
PLS.has = function(L){
  if (L && L.fillLayer) ensureFill(L);           // 填充图层：参数／文件大小变了就重算像素（FillCache 的意思）
  return special(L) || has0(L) || hasFx2(L);
};
PLS.draw = function(ctx, L, src, scale){
  if (!special(L)) return drawStyled(ctx, L, src, scale);
  scale = scale || 1;
  if (inDoc(L) && baseOf(L)) return;            // 剪贴组成员：基底那一层画的时候一起画了
  const W = ctx.canvas.width, H = ctx.canvas.height, mem = inDoc(L) ? visibleMembers(L) : [];
  if (L.adjust) return drawAdjustLayer(ctx, L, scale, mem);
  const iso = contentCanvas(L, scale, W, H, src);
  clipInto(iso, mem, scale);
  finalDraw(ctx, L, iso, scale);
};
/* 一层自己的内容（文件空间 W×H，已过像素蒙版＋矢量蒙版）；src＝composite 已过蒙版的那块（可省） */
function contentCanvas(L, scale, W, H, src){
  const c = mkCanvas(W, H), x = c.getContext('2d');
  const at = L.kind === 'raster' && (L.x || L.y) ? [L.x * scale, L.y * scale] : [0, 0];
  if (src && !unlinkedMask(L)) x.drawImage(src, at[0], at[1]);
  else if (L.mask && !unlinkedMask(L)){                       // 跟 composite 一样：内容与蒙版叠好再贴到位置
    // 像素层画布可比文件大（非破坏裁切）⇒ 内容与蒙版按画布原尺寸叠（同 engine compositeOne）·⛔ 拉成 W×H 再移出文件
    const R = L.kind === 'raster', src0 = renderLayer(L, scale);
    const m = mkCanvas(R ? src0.width : W, R ? src0.height : H), mx = m.getContext('2d');
    if (R){ mx.drawImage(src0, 0, 0); mx.globalCompositeOperation = 'destination-in'; mx.drawImage(renderLayer(L.mask, scale), 0, 0); }
    else { mx.drawImage(src0, 0, 0, W, H); mx.globalCompositeOperation = 'destination-in'; mx.drawImage(renderLayer(L.mask, scale), 0, 0, W, H); }
    x.drawImage(m, at[0], at[1]);
  } else {
    x.drawImage(renderLayer(L, scale), at[0], at[1]);
    if (unlinkedMask(L)){ x.globalCompositeOperation = 'destination-in'; x.drawImage(pixelMaskCanvas(L, scale, W, H), 0, 0); x.globalCompositeOperation = 'source-over'; }
  }
  if (vmaskOn(L)){ x.globalCompositeOperation = 'destination-in'; x.drawImage(vmaskCanvas(L, scale, W, H), 0, 0); x.globalCompositeOperation = 'source-over'; }
  return c;
}
/* 最后一笔：有图层样式就交给 ps-layer.js 的效果（内容已含剪贴层），没有就照层的不透明度×填充、混合模式贴上 */
function finalDraw(ctx, L, iso, scale){
  if (hasStyle(L)){ const P = Object.create(L); P.x = 0; P.y = 0; drawStyled(ctx, P, iso, scale); return; }
  blendDraw(ctx, iso, 0, 0, L.blend, L.opacity * (L.fillOpacity === undefined ? 1 : L.fillOpacity));
}
/* compose/src/lib.rs:1395 composite_atop：剪贴层有混合颜色带（engine BlendIf）⇒ 记底、照常合、按权重往底插值（「下一图层」看的是剪贴基底） */
function clipInto(iso, mem, scale){
  if (!mem.length) return;
  const W = iso.width, H = iso.height, ix = ctx2d(iso);
  for (const c of mem){
    if (!(window.BlendIf && BlendIf.enabled(c))){ clipOne(ix, c, scale, W, H); continue; }
    const before = ix.getImageData(0, 0, W, H).data;
    clipOne(ix, c, scale, W, H);
    const img = ix.getImageData(0, 0, W, H);
    if (BlendIf.apply(c, before, img, () => ctx2d(contentCanvas(c, scale, W, H, null)).getImageData(0, 0, W, H).data)) ix.putImageData(img, 0, 0);
  }
}
/* compose/src/lib.rs:1410 composite_atop_any：剪贴层「当底是不透明的」混上去，留底的 alpha */
function clipOne(ix, c, scale, W, H){
  const op = c.opacity * (c.fillOpacity === undefined ? 1 : c.fillOpacity);
  if (c.adjust){                                            // 调整层剪贴在基底上：只调基底
    const a = adjObj(c); if (!a) return;
    const img = ix.getImageData(0, 0, W, H);
    adjustMix(img.data, W, H, a, maskValues(c, scale, W, H), op, c.blend);
    ix.putImageData(img, 0, 0); return;
  }
  const cc = contentCanvas(c, scale, W, H, null);
  if (hasStyle(c)){                                         // 有效果：效果画在「当成不透明的底」上，再留底的 alpha
    const base = ix.getImageData(0, 0, W, H), o = mkCanvas(W, H), ox = ctx2d(o), od = new ImageData(new Uint8ClampedArray(base.data), W, H);
    for (let i = 3; i < od.data.length; i += 4) od.data[i] = 255;
    ox.putImageData(od, 0, 0);
    const P = Object.create(c); P.x = 0; P.y = 0; drawStyled(ox, P, cc, scale);
    const rd = ox.getImageData(0, 0, W, H).data, bd = base.data;
    for (let i = 0; i < bd.length; i += 4) if (bd[i + 3] > 0){ bd[i] = rd[i]; bd[i + 1] = rd[i + 1]; bd[i + 2] = rd[i + 2]; }
    ix.putImageData(base, 0, 0); return;
  }
  if (!c.blend || c.blend === 'normal'){                    // 正常模式＝canvas 的 source-atop（颜色 αs·Cs＋(1−αs)·Cb，alpha 留底的）
    ix.save(); ix.globalAlpha = op; ix.globalCompositeOperation = 'source-atop'; ix.drawImage(cc, 0, 0); ix.restore(); return;
  }
  const base = ix.getImageData(0, 0, W, H), bd = base.data, sd = ctx2d(cc).getImageData(0, 0, W, H).data, B = [0, 0, 0];
  for (let i = 0; i < bd.length; i += 4){
    if (bd[i + 3] <= 0) continue;
    const sa = sd[i + 3] / 255 * op; if (sa <= 0) continue;
    const b0 = bd[i] / 255, b1 = bd[i + 1] / 255, b2 = bd[i + 2] / 255;
    blendInto(c.blend, b0, b1, b2, sd[i] / 255, sd[i + 1] / 255, sd[i + 2] / 255, B);
    bd[i] = (b0 + (B[0] - b0) * sa) * 255; bd[i + 1] = (b1 + (B[1] - b1) * sa) * 255; bd[i + 2] = (b2 + (B[2] - b2) * sa) * 255;
  }
  ix.putImageData(base, 0, 0);
}

/* ═══════════ 调整图层（compose/src/lib.rs:1115-1139）═══════════ */
const ADJ_KINDS = ['brightnessContrast', 'levels', 'curves', 'exposure', 'vibrance', 'hueSaturation', 'colorBalance', 'blackWhite', 'photoFilter',
  'channelMixer', 'colorLookup', 'invert', 'posterize', 'threshold', 'gradientMap', 'selectiveColor'];
const ADJ_NAME = {   // 新层的名字照 PS（next_layer_name(adj.label())）
  brightnessContrast:['亮度/對比', '亮度/对比度', 'Brightness/Contrast'], levels:['色階', '色阶', 'Levels'], curves:['曲線', '曲线', 'Curves'],
  exposure:['曝光度', '曝光度', 'Exposure'], vibrance:['自然飽和度', '自然饱和度', 'Vibrance'], hueSaturation:['色相/飽和度', '色相/饱和度', 'Hue/Saturation'],
  colorBalance:['色彩平衡', '色彩平衡', 'Color Balance'], blackWhite:['黑白', '黑白', 'Black & White'], photoFilter:['相片濾鏡', '照片滤镜', 'Photo Filter'],
  channelMixer:['色版混合器', '通道混合器', 'Channel Mixer'], colorLookup:['顏色查詢', '颜色查找', 'Color Lookup'], invert:['負片效果', '反相', 'Invert'],
  posterize:['色調分離', '色调分离', 'Posterize'], threshold:['臨界值', '阈值', 'Threshold'], gradientMap:['漸層對應', '渐变映射', 'Gradient Map'],
  selectiveColor:['選取顏色', '可选颜色', 'Selective Color']
};
const NOT_PARAM = ['id', 'layer', 'layerId', 'ui', 'name', '__kind', 'clip', 'mask'];
const userKeys = p => Object.keys(p || {}).filter(k => !NOT_PARAM.includes(k) && p[k] !== undefined);
const pick = (p, ks) => { const o = {}; ks.forEach(k => { o[k] = p[k]; }); return o; };
/* adjust_params.rs from_params：给的键盖在目前值上（没给键＝预设）→ 存的 params（＝to_params，跟 image.adjustments.* 同一份格式）
   颜色查找另存原始键（lut 名／.cube 文字），因为 to_params 不带表 */
function normAdjust(kind, p, cur){
  const ks = userKeys(p);
  if (kind === 'colorLookup'){
    const out = ks.length ? Object.assign({}, cur ? cur.params : {}, pick(p, ks)) : {};
    PsImage.fromParams(kind, out, null);                     // 只为了验参数（错的会丢 PsBad）
    return out;
  }
  const base = (cur && ks.length) ? PsImage.fromParams(kind, cur.params, null) : null;
  return PsImage.toParams(PsImage.fromParams(kind, ks.length ? pick(p, ks) : {}, base));
}
/* 对话框预览中（ps-image.js 的调整对话框改跑 ps.layer.setAdjustment 时）用预览的参数 */
function previewLive(L){ const c = window.PsImage && PsImage.dlg.cur; return !!(c && c.o && c.o.id === 'layer.setAdjustment' && c.prev && c.prev.L === L && L._adjPreview); }
function adjObj(L){
  const A = previewLive(L) ? L._adjPreview : L.adjust; if (!A) return null;
  const key = JSON.stringify(A);
  if (L._adjObj && L._adjObj.key === key) return L._adjObj.a;
  let a = null; try { a = PsImage.fromParams(A.kind, A.params || {}, null); } catch (e){ console.warn(e); }
  hide(L, '_adjObj', {key, a}); return a;
}
/* 调整后的颜色按 k＝不透明度×蒙版、用混合模式混回；alpha 不动（u8 直通 RGBA 就地改；分段做，免得一次配好几十 MB） */
function adjustMix(d, W, H, a, mv, op, blend){
  const ROWS = 128, B = [0, 0, 0];
  for (let y0 = 0; y0 < H; y0 += ROWS){
    const y1 = Math.min(H, y0 + ROWS), n = (y1 - y0) * W, off = y0 * W;
    let any = false;
    for (let i = 0; i < n && !any; i++) if ((mv ? mv[off + i] : 1) * op > 0 && d[(off + i) * 4 + 3] > 0) any = true;
    if (!any) continue;
    const px = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) px[i] = d[off * 4 + i] / 255;
    const orig = px.slice();
    if (a.dither) PsImage.applyAdjustment(a, px, W, 0, y0);       // 仿色跟位置有关：逐格算
    else memoAdjust(a, px, orig, n);                                 // 其余调整只看颜色：同色只算一次
    for (let i = 0; i < n; i++){
      const k = op * (mv ? mv[off + i] : 1); if (k <= 0) continue;
      const j = i * 4, o = (off + i) * 4;
      const b0 = orig[j], b1 = orig[j + 1], b2 = orig[j + 2];
      if (!blend || blend === 'normal'){ B[0] = px[j]; B[1] = px[j + 1]; B[2] = px[j + 2]; }
      else blendInto(blend, b0, b1, b2, px[j], px[j + 1], px[j + 2], B);
      d[o] = (b0 + (B[0] - b0) * k) * 255; d[o + 1] = (b1 + (B[1] - b1) * k) * 255; d[o + 2] = (b2 + (B[2] - b2) * k) * 255;
    }
  }
}
/* 颜色 → 调整后颜色 的快取（直接映射 65536 格，挂在调整物件上；撞格的退回逐格算）。px／orig 是同一段的直通 RGBA 0..1 */
function memoAdjust(a, px, orig, n){
  let M = a._memo;
  if (!M){ M = {keys:new Int32Array(65536).fill(-1), vals:new Float32Array(65536 * 3)}; hide(a, '_memo', M); }
  const slotOf = k => ((k ^ (k >>> 13) ^ (k >>> 7)) * 2654435761 >>> 16) & 0xffff;
  const todo = [], keyAt = new Int32Array(n);
  for (let i = 0; i < n; i++){
    const j = i * 4; if (orig[j + 3] <= 0){ keyAt[i] = -1; continue; }
    const k = (Math.round(orig[j] * 255) << 16) | (Math.round(orig[j + 1] * 255) << 8) | Math.round(orig[j + 2] * 255), s = slotOf(k);
    keyAt[i] = k;
    if (M.keys[s] !== k){ M.keys[s] = k; todo.push(k); }
  }
  if (todo.length){
    const q = new Float32Array(todo.length * 4);
    todo.forEach((k, t) => { q[t * 4] = (k >>> 16 & 255) / 255; q[t * 4 + 1] = (k >>> 8 & 255) / 255; q[t * 4 + 2] = (k & 255) / 255; q[t * 4 + 3] = 1; });
    PsImage.applyAdjustment(a, q, todo.length, 0, 0);
    todo.forEach((k, t) => { const s = slotOf(k); if (M.keys[s] === k){ M.vals[s * 3] = q[t * 4]; M.vals[s * 3 + 1] = q[t * 4 + 1]; M.vals[s * 3 + 2] = q[t * 4 + 2]; } });
  }
  const one = new Float32Array(4);
  for (let i = 0; i < n; i++){
    const k = keyAt[i]; if (k < 0) continue;
    const j = i * 4, s = slotOf(k);
    if (M.keys[s] === k){ px[j] = M.vals[s * 3]; px[j + 1] = M.vals[s * 3 + 1]; px[j + 2] = M.vals[s * 3 + 2]; }
    else { one[0] = orig[j]; one[1] = orig[j + 1]; one[2] = orig[j + 2]; one[3] = 1; PsImage.applyAdjustment(a, one, 1, 0, 0); px[j] = one[0]; px[j + 1] = one[1]; px[j + 2] = one[2]; }   // 同一段里撞格被挤掉的
  }
}
function hash8(d){ let h = 2166136261; for (let i = 0; i < d.length; i++){ h ^= d[i]; h = Math.imul(h, 16777619); } return h >>> 0; }
function hashF(f){ let h = 2166136261; for (let i = 0; i < f.length; i += 3){ h ^= (f[i] * 255) | 0; h = Math.imul(h, 16777619); } return h >>> 0; }
/* 调整层画在 ctx（＝下面所有层合好的背景）上：复制背景→调整→（剪贴层贴在调整结果上）→按蒙版×不透明度混回 */
function drawAdjustLayer(ctx, L, scale, mem){
  const a = adjObj(L); if (!a) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const op = L.opacity * (L.fillOpacity === undefined ? 1 : L.fillOpacity); if (op <= 0) return;
  const mv = maskValues(L, scale, W, H);
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  // 结果缓存：背景、参数、蒙版都没变 ⇒ 直接贴上次的（滑鼠移动引起的重画不重算）
  const key = JSON.stringify([previewLive(L) ? L._adjPreview : L.adjust, scale, W, H, op, L.blend, mem.map(c => c.id)]) + '|' + (mv ? hashF(mv) : '') + '|' + hash8(d);
  if (L._adjOut && L._adjOut.key === key){ putAll(ctx, L._adjOut.img); return; }
  if (!mem.length) adjustMix(d, W, H, a, mv, op, L.blend);
  else {                                                     // 有剪贴层贴在调整层上（少见）：先整张调好、贴剪贴层，再混回
    const adj = new ImageData(new Uint8ClampedArray(d), W, H); adjustMix(adj.data, W, H, a, null, 1, 'normal');
    const c = mkCanvas(W, H); ctx2d(c).putImageData(adj, 0, 0); clipInto(c, mem, scale);
    const ad = ctx2d(c).getImageData(0, 0, W, H).data, B = [0, 0, 0];
    for (let i = 0; i < W * H; i++){
      const k = op * (mv ? mv[i] : 1); if (k <= 0) continue;
      const j = i * 4, b0 = d[j] / 255, b1 = d[j + 1] / 255, b2 = d[j + 2] / 255;
      if (!L.blend || L.blend === 'normal'){ B[0] = ad[j] / 255; B[1] = ad[j + 1] / 255; B[2] = ad[j + 2] / 255; }
      else blendInto(L.blend, b0, b1, b2, ad[j] / 255, ad[j + 1] / 255, ad[j + 2] / 255, B);
      d[j] = (b0 + (B[0] - b0) * k) * 255; d[j + 1] = (b1 + (B[1] - b1) * k) * 255; d[j + 2] = (b2 + (B[2] - b2) * k) * 255;
    }
  }
  putAll(ctx, img);
  hide(L, '_adjOut', {key, img});
}
/* 整张换掉（先放离屏画布再 copy 贴过去；直接 putImageData 到显示用的加速画布很慢） */
function putAll(ctx, img){
  const t = mkCanvas(img.width, img.height); ctx2d(t).putImageData(img, 0, 0);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'copy'; ctx.drawImage(t, 0, 0); ctx.restore();
}

/* ═══════════ 填充图层（compose/src/lib.rs:736 fill_frame、771 render_fill；gradient_fill.rs；pattern.rs）═══════════ */
/* fill_frame：「与图层对齐」＝蒙版露出的范围（全隐藏底的像素蒙版画过的地方、矢量蒙版的路径外框），否则整个画布 */
function alphaBox(c){
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data, W = c.width;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 3, p = 0; i < d.length; i += 4, p++) if (d[i]){ const x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  return x1 < 0 ? null : {x:x0, y:y0, w:x1 + 1 - x0, h:y1 + 1 - y0};
}
const inter = (a, b) => { const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h); return x1 > x0 && y1 > y0 ? {x:x0, y:y0, w:x1 - x0, h:y1 - y0} : null; };
function fillFrame(L){
  let fr = {x:0, y:0, w:Doc.width, h:Doc.height};
  const f = L.fillLayer;
  if (f.type === 'gradient' && f.align === false) return fr;
  const m = L.mask;
  if (m && m.data && m.data.ctx.getImageData(0, 0, 1, 1).data[3] === 0){    // 底是隐藏的蒙版（全隐藏后画出来的）
    const b = alphaBox(m.data.canvas); const r = b && inter(b, fr); if (r) fr = r;
  }
  if (vmaskOn(L) && !L.vmask.inverted && (L.vmask.shapes || []).length){
    const b = alphaBox(vmaskCanvas(L, 1, Doc.width, Doc.height)); const r = b && inter(b, fr); if (r) fr = r;
  }
  return fr;
}
/* gradient_fill.rs:20 Ramp：色标（位置 0..1、颜色）＋每段中点（缺省 .5） */
function rampSample(stops, mids, t){
  if (!stops.length) return [0, 0, 0, 0];
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 0; i + 1 < stops.length; i++){
    const a = stops[i], b = stops[i + 1];
    if (t <= b[0]){
      const u = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0, m = clamp(mids[i] === undefined ? 0.5 : mids[i], 0.05, 0.95);
      const k = Math.abs(m - 0.5) < 1e-6 ? u : u <= m ? 0.5 * u / m : 0.5 + 0.5 * (u - m) / (1 - m);
      return [0, 1, 2, 3].map(c => a[1][c] + (b[1][c] - a[1][c]) * k);
    }
  }
  return stops[stops.length - 1][1];
}
/* color::dither_noise 的替代：位置决定的杂讯 0..1 */
function ditherNoise(x, y){ let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ 0x9e3779b9) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; return (h & 0xffff) / 65536; }
/* pattern.rs:86 Tile（预乘）＋111 sample（环绕双线性，像素中心在 i+0.5）（同 ps-edit.js renderPattern） */
function renderPatternInto(d, W, H, pat, place){
  const tw = pat.width, th = pat.height, tp = new Float32Array(tw * th * 4);
  for (let i = 0; i < tw * th; i++){ const a = pat.px[i * 4 + 3] / 255; tp[i * 4] = pat.px[i * 4] / 255 * a; tp[i * 4 + 1] = pat.px[i * 4 + 1] / 255 * a; tp[i * 4 + 2] = pat.px[i * 4 + 2] / 255 * a; tp[i * 4 + 3] = a; }
  const mod = (v, n) => ((v % n) + n) % n, acc = [0, 0, 0, 0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    let [u, v] = place(x + 0.5, y + 0.5); u -= 0.5; v -= 0.5;
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    acc[0] = acc[1] = acc[2] = acc[3] = 0;
    for (const [dy, wy] of [[0, 1 - fy], [1, fy]]){ if (wy === 0) continue;
      for (const [dx, wx] of [[0, 1 - fx], [1, fx]]){ if (wx === 0) continue;
        const j = (mod(y0 + dy, th) * tw + mod(x0 + dx, tw)) * 4, k = wx * wy;
        acc[0] += tp[j] * k; acc[1] += tp[j + 1] * k; acc[2] += tp[j + 2] * k; acc[3] += tp[j + 3] * k; } }
    const o = (y * W + x) * 4;
    if (acc[3] > 0){ d[o] = acc[0] / acc[3] * 255; d[o + 1] = acc[1] / acc[3] * 255; d[o + 2] = acc[2] / acc[3] * 255; d[o + 3] = Math.min(acc[3], 1) * 255; }
  }
}
/* pattern.rs:151 Placement::new(frame, link, phase, scale, angle)：原点＝（连结 ? 外框左上 : 0）＋相位；逆旋转、逆缩放 */
function placement(frame, f){
  const base = f.link !== false ? [frame.x, frame.y] : [0, 0], ox = base[0] + (f.phase ? f.phase[0] : 0), oy = base[1] + (f.phase ? f.phase[1] : 0);
  const s = f.scale, inv = (isFinite(s) && s > 1e-3) ? 1 / s : 1, a = (f.angle || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  return (x, y) => { const dx = x - ox, dy = y - oy; return [(dx * c - dy * sn) * inv, (dx * sn + dy * c) * inv]; };
}
const patternLib = () => (window.PsEdit && PsEdit.patterns) || null;
function fillKey(L){ return JSON.stringify([L.fillLayer, Doc.width, Doc.height, L.vmask || null, !!L.mask]); }
/* 按参数把填充像素算进画布（文件大小）。图案找不到时留着原来的像素（照原码是透明，但我们的工程档本来就存了算好的像素） */
function bakeFill(L){
  const f = L.fillLayer, W = Doc.width, H = Doc.height, cv = L.data.canvas;
  let pat = null;
  if (f.type === 'pattern'){ const lib = patternLib(); pat = lib ? (lib.resolve(f.pattern || '') || lib.resolve(f.name || '')) : null; if (!pat) return false; }
  if (cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; }
  const x = L.data.ctx, img = x.createImageData(W, H), d = img.data;
  if (f.type === 'solid'){
    const c = hexToRGB(f.color || '#000000'), a = Math.round(clamp(f.alpha === undefined ? 1 : f.alpha, 0, 1) * 255);
    for (let i = 0; i < d.length; i += 4){ d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a; }
  } else if (f.type === 'gradient'){
    const fr = fillFrame(L), fx = PsLayer.fx;
    const stops = (f.stops || []).map(([t, c, a]) => [clamp(+t || 0, 0, 1), rgb01(c).concat([a === undefined ? 1 : clamp(+a, 0, 1)])]).sort((p, q) => p[0] - q[0]);
    const [ang, sc, off] = fx.gradientLayout(f.style, f.angle, f.scale, f.offset || [0, 0], fr);
    for (let y = 0; y < H; y++) for (let x2 = 0; x2 < W; x2++){
      const t = fx.gradientT(f.style, ang, sc, !!f.reverse, off, fr, x2 + 0.5, y + 0.5), c = rampSample(stops, f.midpoints || [], t), o = (y * W + x2) * 4;
      let r = c[0], g = c[1], b = c[2];
      if (f.dither){ const n = (ditherNoise(x2, y) - 0.5) / 255; r = clamp(r + n, 0, 1); g = clamp(g + n, 0, 1); b = clamp(b + n, 0, 1); }
      d[o] = r * 255; d[o + 1] = g * 255; d[o + 2] = b * 255; d[o + 3] = c[3] * 255;
    }
  } else if (f.type === 'pattern') renderPatternInto(d, W, H, pat, placement(fillFrame(L), f));
  x.putImageData(img, 0, 0);
  Layer.invalidate(L);
  return true;
}
function ensureFill(L){
  const k = fillKey(L);
  if (L._fillKey === k) return;
  bakeFill(L);
  hide(L, '_fillKey', k);
}
const GSTYLES = ['linear', 'radial', 'angle', 'reflected', 'diamond'];
/* 参数 → 存的 fillLayer（commands.rs:602-639、pattern_cmds.rs:295／304）；cur＝改的时候盖在目前值上 */
function fillFrom(type, p, cur){
  const c = cur && cur.type === type ? cur : null;
  if (type === 'solid') return {type, color:hexOf(p.color, c ? c.color : fgHex())};
  if (type === 'gradient'){
    let stops;
    if (Array.isArray(p.stops) && p.stops.length >= 2) stops = p.stops.map(s => Array.isArray(s) ? [clamp(+s[0] || 0, 0, 1), hexOf(s[1], '#000000')].concat(s[2] !== undefined ? [clamp(+s[2], 0, 1)] : []) : null).filter(Boolean);
    else if (p.from !== undefined || p.to !== undefined || !c) stops = [[0, hexOf(p.from, c ? c.stops[0][1] : fgHex())], [1, hexOf(p.to, c ? c.stops[c.stops.length - 1][1] : bgHex())]];
    else stops = c.stops;
    const style = String(p.style || (c ? c.style : 'linear')).toLowerCase();
    if (!GSTYLES.includes(style)) throw new Error('unknown gradient style `' + p.style + '`');
    return {type, stops, angle:num(p, 'angle', c ? c.angle : 90), scale:clamp(num(p, 'scale', c ? c.scale * 100 : 100), 10, 150) / 100, style,
      reverse:bool(p, 'reverse', c ? c.reverse : false), dither:bool(p, 'dither', c ? !!c.dither : false), align:bool(p, 'align', c ? c.align !== false : true),
      offset:c && c.offset ? c.offset : [0, 0], midpoints:c && c.midpoints ? c.midpoints : []};
  }
  if (type === 'pattern'){
    const lib = patternLib(); if (!lib) throw new Error('the pattern library (menus/impl/ps-edit.js) is not loaded');
    const key = typeof p.pattern === 'string' ? p.pattern : (c ? c.pattern : '');
    const pat = lib.resolve(key); if (!pat) throw new Error(`no pattern "${key}" (see ps.pattern.list)`);
    const ph = Array.isArray(p.phase) ? [Number(p.phase[0]) || 0, Number(p.phase[1]) || 0] : (c ? c.phase : [0, 0]);
    return {type, pattern:pat.id, name:pat.name, scale:clamp(num(p, 'scale', c ? c.scale * 100 : 100) / 100, 0.01, 10), angle:num(p, 'angle', c ? c.angle : 0),
      link:bool(p, 'link', c ? c.link !== false : true), phase:ph};
  }
  throw new Error('unknown fill type `' + type + '`');
}
const FILL_NAME = {solid:['色彩填色', '颜色填充', 'Color Fill'], gradient:['漸層填色', '渐变填充', 'Gradient Fill'], pattern:['圖樣填色', '图案填充', 'Pattern Fill']};
function newFill(type, p){
  let f; try { f = fillFrom(type, p, null); } catch (e){ return fail(e.message); }
  const L = Layer.raster((p.name && String(p.name).trim()) || nextName(L3(...FILL_NAME[type])));
  L.fillLayer = f;
  insertAbove(L); defaultMask(L, p); ensureFill(L);
  return {id:L.id, fill:clone(f)};
}
function rasterizeFill(L){
  if (!L || !L.fillLayer) return fail('the layer is not a fill layer');
  ensureFill(L); delete L.fillLayer; hide(L, '_fillKey', null);
  return {id:L.id};
}

/* ═══════════ 对话框（DOM 照 ps-layer.js 的 .psl-* 样式；样式在 ps-layer.js 注入过，这里只补本档用到的）═══════════ */
(function injectCSS(){
  if (document.getElementById('psl2-css')) return;
  const st = document.createElement('style'); st.id = 'psl2-css';
  st.textContent = `.psl-dlg .psl2-note{color:#8a919c;font-size:12px;margin:6px 0 0;max-width:320px}
.psl-dlg .psl2-sw{display:inline-block;width:22px;height:22px;border:1px solid #555c68;vertical-align:middle;margin-right:4px;background-size:cover}`;
  document.head.appendChild(st);
})();
function closeDialog(){ document.querySelectorAll('.psl-bg').forEach(x => x.remove()); }
/* fields：[{key, label:[繁,简,英], type:'number'|'text'|'color'|'check'|'select', min, max, value, options:[[值, [繁,简,英]|字]]}] */
function dialog(name, title, fields, onOK, note){
  closeDialog();
  const bg = document.createElement('div'); bg.className = 'psl-bg';
  const box = document.createElement('div'); box.className = 'psl-dlg'; box.dataset.dlg = name;
  const h = document.createElement('h3'); h.textContent = L3(...title); box.appendChild(h);
  const grid = document.createElement('div'); grid.className = 'psl-grid'; box.appendChild(grid);
  const inputs = fields.map(f => {
    const lab = document.createElement('span'); lab.textContent = L3(...f.label);
    let inp;
    if (f.type === 'select'){
      inp = document.createElement('select');
      f.options.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = Array.isArray(l) ? L3(...l) : l; inp.appendChild(o); });
      inp.value = f.value;
    } else {
      inp = document.createElement('input');
      inp.type = f.type === 'check' ? 'checkbox' : f.type || 'number';
      if (f.type === 'check') inp.checked = !!f.value;
      else { if (f.min !== undefined) inp.min = f.min; if (f.max !== undefined) inp.max = f.max; inp.step = f.step || 'any'; inp.value = f.value; }
    }
    inp.dataset.key = f.key; grid.appendChild(lab); grid.appendChild(inp);
    return [f, inp];
  });
  if (note){ const n = document.createElement('div'); n.className = 'psl2-note'; n.textContent = L3(...note); box.appendChild(n); }
  const row = document.createElement('div'); row.className = 'psl-row';
  const ok = document.createElement('button'); ok.className = 'psl-ok'; ok.textContent = L3('確定', '确定', 'OK');
  const cc = document.createElement('button'); cc.className = 'psl-cancel'; cc.textContent = L3('取消', '取消', 'Cancel');
  row.appendChild(cc); row.appendChild(ok); box.appendChild(row);
  const done = () => {
    const v = {};
    inputs.forEach(([f, inp]) => {
      if (f.type === 'check') v[f.key] = inp.checked;
      else if (f.type === 'number' || !f.type){ let x = +inp.value; if (!isFinite(x)) x = f.value; if (f.min !== undefined) x = Math.max(f.min, x); if (f.max !== undefined) x = Math.min(f.max, x); v[f.key] = x; }
      else v[f.key] = inp.value;
    });
    closeDialog();
    let r; try { r = onOK(v); } catch (err){ console.error(err); }
    if (r && r.ok === false && r.error) console.warn(r.error);
    if (window.UI) UI.refresh();
  };
  ok.onclick = done; cc.onclick = closeDialog;
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName !== 'SELECT'){ e.preventDefault(); done(); } if (e.key === 'Escape') closeDialog(); e.stopPropagation(); });
  bg.appendChild(box); document.body.appendChild(bg);
  const first = box.querySelector('input,select'); if (first) first.focus();
  return box;
}
const STYLE_OPTS = [['linear', ['線性', '线性', 'Linear']], ['radial', ['放射狀', '径向', 'Radial']], ['angle', ['角度', '角度', 'Angle']], ['reflected', ['反射性', '对称的', 'Reflected']], ['diamond', ['菱形', '菱形', 'Diamond']]];
/* 填充层对话框（PS：颜色拾色器／渐变填充／图案填充）；L＝null 新建、否则改那一层 */
function openFillDialog(type, L){
  const cur = L ? L.fillLayer : null;
  const titles = {solid:['檢色器 (純色)', '拾色器（纯色）', 'Color Picker (Solid Color)'], gradient:['漸層填色', '渐变填充', 'Gradient Fill'], pattern:['圖樣填色', '图案填充', 'Pattern Fill']};
  // 纯色＝PS 的「拾色器（纯色）」（tools/colorpicker.js：色域／栏位、开着时点图像＝吸管）；改现有的层：拾色器开着时画面即时换色，取消＝回原色
  if (type === 'solid' && window.ColorPicker && ColorPicker.open){
    const label = {'zh-Hant':titles.solid[0], 'zh-Hans':titles.solid[1], en:titles.solid[2]};
    if (!L){ ColorPicker.open('solid', fgHex(), {label, command:'ps.layer.newFillLayer.solidColor', params:{}}); return UI_OPEN; }
    const orig = L.fillLayer, back = () => { if (Doc.byId(L.id) && L.fillLayer !== orig){ L.fillLayer = orig; ensureFill(L); if (window.UI) UI.draw(); } };
    ColorPicker.open('solid', orig.color, {label, command:'ps.layer.setFill', params:{id:L.id},
      onChange:c => { if (!Doc.byId(L.id)) return; L.fillLayer = Object.assign({}, orig, {color:c}); ensureFill(L); if (window.UI) UI.draw(); },
      onClose:back});
    return UI_OPEN;
  }
  let fields;
  if (type === 'solid') fields = [{key:'color', label:['顏色', '颜色', 'Color'], type:'color', value:cur ? cur.color : fgHex()}];
  else if (type === 'gradient') fields = [
    {key:'from', label:['起點顏色', '起点颜色', 'From'], type:'color', value:cur ? cur.stops[0][1] : fgHex()},
    {key:'to', label:['終點顏色', '终点颜色', 'To'], type:'color', value:cur ? cur.stops[cur.stops.length - 1][1] : bgHex()},
    {key:'style', label:['樣式', '样式', 'Style'], type:'select', value:cur ? cur.style : 'linear', options:STYLE_OPTS},
    {key:'angle', label:['角度', '角度', 'Angle'], value:cur ? cur.angle : 90, min:-180, max:180},
    {key:'scale', label:['縮放', '缩放', 'Scale'], value:cur ? Math.round(cur.scale * 100) : 100, min:10, max:150},
    {key:'reverse', label:['反轉', '反向', 'Reverse'], type:'check', value:cur ? cur.reverse : false},
    {key:'dither', label:['混色', '仿色', 'Dither'], type:'check', value:cur ? !!cur.dither : false},
    {key:'align', label:['與圖層對齊', '与图层对齐', 'Align with layer'], type:'check', value:cur ? cur.align !== false : true}];
  else {
    const lib = patternLib(), items = lib ? lib.load() : [];
    if (!items.length) return fail('no patterns');
    fields = [
      {key:'pattern', label:['圖樣', '图案', 'Pattern'], type:'select', value:cur ? cur.pattern : items[0].id, options:items.map(q => [q.id, q.name])},
      {key:'scale', label:['縮放', '缩放', 'Scale'], value:cur ? Math.round(cur.scale * 100) : 100, min:1, max:1000},
      {key:'angle', label:['角度', '角度', 'Angle'], value:cur ? cur.angle : 0, min:-180, max:180},
      {key:'link', label:['與圖層連結', '与图层链接', 'Link with Layer'], type:'check', value:cur ? cur.link !== false : true}];
  }
  dialog(L ? 'setFill' : 'newFill', titles[type], fields, v => L ? CMD.run('ps.layer.setFill', Object.assign({id:L.id}, v)) : CMD.run('ps.layer.newFillLayer.' + (type === 'solid' ? 'solidColor' : type), v));
  return UI_OPEN;
}
/* 调整层的参数对话框：借 ps-image.js 的调整对话框（同一套栏位、预览），确定改跑 ps.layer.setAdjustment */
function openAdjustDialog(L){
  if (!window.PsImage || !L || !L.adjust) return false;
  const f = PsImage.DIALOGS['image.adjustments.' + L.adjust.kind]; if (!f) return false;
  Doc.activeId = L.id;
  f(clone(L.adjust.params));
  const cur = PsImage.dlg.cur; if (!cur) return false;
  cur.o.id = 'layer.setAdjustment';                          // Dlg.ok() 跑 'ps.' + o.id；预览跑 PIXEL_OPS[o.id]
  if (cur.box) cur.box.dataset.adjLayer = L.id;
  PsImage.dlg.preview();
  return true;
}
if (window.PsImage) PsImage.PIXEL_OPS['layer.setAdjustment'] = (L, prm) => {   // 预览：不改像素，只记预览参数（合成时 adjObj 用它）
  if (!L || !L.adjust) return;
  try { hide(L, '_adjPreview', {kind:L.adjust.kind, params:normAdjust(L.adjust.kind, prm, L.adjust)}); } catch (e){ /* 参数还没填完：照旧 */ }
};
/* 选几个层（多层命令在图层面板还没有多选时，从菜单进来就让人勾） */
function pickLayers(name, title, list, pre, min, onOK, note){
  closeDialog();
  const box = dialog(name, title, [], () => {}, note);
  const lst = document.createElement('div'); lst.className = 'psl-lyr';
  [...list].reverse().forEach(L => {
    const lb = document.createElement('label'), cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = L.id; cb.checked = pre.includes(L.id);
    lb.appendChild(cb); lb.appendChild(document.createTextNode(' ' + L.name)); lst.appendChild(lb);
  });
  box.insertBefore(lst, box.querySelector('.psl-grid').nextSibling);
  box.querySelector('.psl-ok').onclick = () => {
    const ids = [...lst.querySelectorAll('input:checked')].map(i => i.value);
    closeDialog();
    if (ids.length < min) return;
    const r = onOK(ids); if (r && r.ok === false && r.error) console.warn(r.error);
    if (window.UI) UI.refresh();
  };
  return box;
}

/* ═══════════ 命令 ═══════════ */
const reg = (id, params, fn, undoable = true) => CMD.reg('ps.' + id, {i18n:'', params, undoable}, p => {
  try { return fn(p || {}); } catch (e){ if (e && e.constructor && e.constructor.name === 'PsBad') return fail(e.message); throw e; }   // ps-image.js 参数错丢的 PsBad ⇒ 回 ok:false
});

/* ── 新建填充图层 ── commands.rs:602／613、pattern_cmds.rs:304 */
reg('layer.newFillLayer.solidColor', '{color:"#rrggbb"=前景色, name?} 新建颜色填充图层（插在当前层之上；整个画布填这个颜色，之后可用 ps.layer.setFill 改）' + UIP,
  p => p.ui ? openFillDialog('solid', null) : newFill('solid', p));
reg('layer.newFillLayer.gradient', '{from:"#rrggbb"=前景色, to:"#rrggbb"=背景色 | stops:[[位置0..1,"#rrggbb",不透明0..1?]…], angle:度=90, style:"linear|radial|angle|reflected|diamond"="linear", reverse=false, scale:10..150=100, dither=false, align=true（与图层对齐）, name?} 新建渐变填充图层' + UIP,
  p => p.ui ? openFillDialog('gradient', null) : newFill('gradient', p));
reg('layer.newFillLayer.pattern', '{pattern:id|名字=图案库第一个（ps.pattern.list）, scale:1..1000=100, angle:度=0, link=true（与图层链接）, phase:[x,y]?, name?} 新建图案填充图层' + UIP,
  p => p.ui ? openFillDialog('pattern', null) : newFill('pattern', p));
reg('layer.setFill', '{id?, …同 newFillLayer.<种类> 的参数（给的盖在目前值上）} 改填充图层的内容（图层内容选项按确定走这条）', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (!L.fillLayer) return fail('the layer is not a fill layer');
  try { L.fillLayer = fillFrom(L.fillLayer.type, p, L.fillLayer); } catch (e){ return fail(e.message); }
  ensureFill(L);
  return {id:L.id, fill:clone(L.fillLayer)};
});
// extra_cmds.rs:657 layer.rasterize.fillContent
reg('layer.rasterize.fillContent', '{id?} 栅格化 ▸ 填充内容：填充图层变成普通像素层（像素留着）', p => rasterizeFill(layerOf(p)));

/* ── 新建调整图层 ── commands.rs:894-910 + 158 new_adjustment */
ADJ_KINDS.forEach(kind => {
  reg('layer.newAdjustmentLayer.' + kind, '{…同 ps.image.adjustments.' + kind + ' 的参数, name?} 新建「' + ADJ_NAME[kind][1] + '」调整图层（插在当前层之上；不改像素，合成时作用在下面所有的层；剪贴到下面一层就只调那一层）→ {id, kind, params}' + (kind === 'invert' ? '' : UIP), p => {
    let params; try { params = normAdjust(kind, p, null); } catch (e){ return fail(e.message); }
    const L = Layer.raster((p.name && String(p.name).trim()) || nextName(L3(...ADJ_NAME[kind])));
    L.adjust = {kind, params};
    insertAbove(L); defaultMask(L, p);
    if (p.ui && kind !== 'invert') setTimeout(() => openAdjustDialog(L), 0);   // PS：建好就开属性（调整参数）；取消＝留预设
    return {id:L.id, kind, params:clone(params)};
  });
});
// commands.rs:640 layer.setAdjustment：不给参数＝回预设；给了＝盖在目前值上
reg('layer.setAdjustment', '{id?, …该调整种类的参数（同 ps.image.adjustments.<kind>）} 改调整图层的参数（不给参数＝回预设）→ {id, kind, params}', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (!L.adjust) return fail('not an adjustment layer');
  try { L.adjust = {kind:L.adjust.kind, params:normAdjust(L.adjust.kind, p, L.adjust)}; } catch (e){ return fail(e.message); }
  return {id:L.id, kind:L.adjust.kind, params:clone(L.adjust.params)};
});

/* ── 图层内容选项… ── layer_menu_cmds.rs:629 content_options：回该层的编辑器种类；界面（ui:true）就开那个编辑器 */
reg('layer.layerContentOptions', '{id?} 图层内容选项：调整层／填充层／文字层回 {editor}；ui:true 开对应的对话框' + UIP, p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  const editor = L.adjust ? 'adjustment:' + L.adjust.kind : L.fillLayer ? 'fill' : L.kind === 'text' ? 'text' : L.kind === 'vector' ? 'shape' : null;
  if (!editor) return fail((L.kind === 'raster' ? 'Pixel' : L.kind) + ' layers have no content options');
  if (p.ui){
    if (L.adjust) openAdjustDialog(L);
    else if (L.fillLayer) openFillDialog(L.fillLayer.type, L);
    else if (L.kind === 'text') openTextDialog(L);
    else return {id:L.id, editor};
  }
  return {id:L.id, editor};
}, false);
function openTextDialog(L){
  const d = L.data;
  dialog('textOptions', ['文字選項', '文字选项', 'Type Options'], [
    {key:'text', label:['內容', '内容', 'Text'], type:'text', value:d.text},
    {key:'size', label:['大小', '大小', 'Size'], value:d.size, min:1, max:2000},
    {key:'color', label:['顏色', '颜色', 'Color'], type:'color', value:hexOf(d.color, '#000000')}],
    v => { const k = 'ps2opts' + Date.now(); CMD.run('text.edit', {layerId:L.id, text:v.text, coalesce:k}); return CMD.run('text.setStyle', {layerId:L.id, size:v.size, color:v.color, coalesce:k}); });
}

/* ── 剪贴蒙版 ── commands.rs:531／539 */
reg('layer.createClippingMask', '{id?, toggle?:bool（已剪贴就释放；菜单用）} 创建剪贴蒙版：这层只在下面那层（基底）有像素的地方显示', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (p.toggle && L.clipped){ delete L.clipped; return {clipped:false}; }
  L.clipped = true; return {clipped:true};
});
reg('layer.releaseClippingMask', '{id?} 释放剪贴蒙版', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  delete L.clipped; return {clipped:false};
});
/* PS：把一层拖进（或用 图层▸排列 移进）剪贴组中间（上面那层是剪贴层）⇒ 它自动变剪贴层；剪贴层被移出它那组（下面不再是原基底／同组剪贴层、上面也不是剪贴层）⇒ 自动释放。
   基底本身（上面有剪贴层的那层）搬动不改它的剪贴状态 */
function sibNeighbor(L, d){
  const pk = pkOf(L);
  for (let j = Doc.layers.indexOf(L) + d; j >= 0 && j < Doc.layers.length; j += d){
    const X = Doc.layers[j], s = sibStep(X, pk);
    if (s === 'inside') continue; if (s === 'out') return null; return X;
  }
  return null;
}
function clipAfterMove(L, was){
  if (!inDoc(L) || was.isBase) return;
  const up = sibNeighbor(L, +1), dn = sibNeighbor(L, -1);
  if (up && up.clipped && dn){ L.clipped = true; return; }
  if (!L.clipped) return;
  const b = was.base;
  if (dn && b && (dn === b || (dn.clipped && baseOf(dn) === b))) return;   // 还在原来那组里（例如换到组的最上面）
  delete L.clipped;
}
function hookClipMove(){
  ['layer.moveTo', 'layer.bringForward', 'layer.sendBackward', 'ps.layer.arrange.bringToFront', 'ps.layer.arrange.sendToBack'].forEach(n => {
    const c = CMD.map[n]; if (!c || c.__clipMove) return;
    const run0 = c.run;
    c.run = function(p){
      const L = Doc.byId((p && (p.id || p.layer || p.layerId)) || Doc.activeId);
      const was = L ? {base:baseOf(L), isBase:!L.clipped && membersOf(L).length > 0} : null;
      const r = run0.apply(this, arguments);
      if (was && r && r.ok !== false) try { clipAfterMove(L, was); } catch (e){ console.error(e); }
      return r;
    };
    c.__clipMove = true;
  });
}
hookClipMove(); window.addEventListener('load', hookClipMove);

/* ── 链接图层蒙版 ── extra_cmds.rs:357 toggle_mask("linked") */
reg('layer.layerMask.linked', '{id?, linked?:bool（缺省＝切换）} 链接／取消链接图层蒙版（取消链接后移动像素层，蒙版留在原地）→ {linked}', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  const m = L.mask || L.maskOff; if (!m) return fail('the layer has no layer mask');
  const cur = L.maskLinked !== false, v = typeof p.linked === 'boolean' ? p.linked : !cur;
  if (v === cur) return {linked:v};
  if (!v){ L.maskLinked = false; L.maskAnchor = [L.x, L.y]; }
  else {                                                     // 重新链接：蒙版画布搬到图层现在的位置，画面不变
    if (L.kind === 'raster' && Array.isArray(L.maskAnchor)){
      const dx = L.maskAnchor[0] - L.x, dy = L.maskAnchor[1] - L.y;
      if (dx || dy){ const c = m.data.canvas, t = mkCanvas(c.width, c.height); ctx2d(t).drawImage(c, 0, 0); m.data.ctx.clearRect(0, 0, c.width, c.height); m.data.ctx.drawImage(t, dx, dy); m._cache = null; }
    }
    delete L.maskLinked; delete L.maskAnchor;
  }
  return {linked:v};
});

/* ── 矢量蒙版 ── vector_cmds.rs:908-1024 */
function shapesInDoc(V){ return (V.data.shapes || []).filter(s => s.visible !== false).map(s => shiftShape(clone(s), V.x || 0, V.y || 0)); }
function parsePath(v){
  if (!Array.isArray(v)) throw new Error('`path` must be an array of shapes ({type:"rect"|"ellipse"|"bezier"…，文件坐标}) or anchors [{x,y,in?,out?}…]');
  if (v.length && v[0] && v[0].type === undefined && isNum(v[0].x)) return [{type:'bezier', closed:true, anchors:v.map(a => ({x:+a.x, y:+a.y, in:a.in || null, out:a.out || null}))}];
  return v.map(s => { if (!s || typeof s !== 'object' || !s.type) throw new Error('bad shape in `path`'); return clone(s); });
}
function vmaskInfo(L){ const v = L.vmask; return v ? {id:L.id, enabled:v.enabled !== false, linked:v.linked !== false, inverted:!!v.inverted, density:Math.round((v.density === undefined ? 1 : v.density) * 100), feather:v.feather || 0, shapes:(v.shapes || []).length} : {id:L.id, vectorMask:null}; }
function vmaskAdd(p, mode){
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (L.locks && L.locks.all) return fail(`layer "${L.name}" is locked`);
  let shapes = [];
  if (p.path !== undefined){ try { shapes = parsePath(p.path); } catch (e){ return fail(e.message); } }
  else if (mode === 'path'){
    const V = Doc.byId(p.from || p.pathLayer);
    if (!V || V.kind !== 'vector') return fail('no work path (give `path`, or `from`: a vector layer id whose shapes become the mask)');
    shapes = shapesInDoc(V);
  }
  L.vmask = {shapes, inverted:mode === 'hide', enabled:true, linked:true, density:1, feather:0, ax:L.x, ay:L.y};
  return vmaskInfo(L);
}
reg('layer.vectorMask.revealAll', '{id?} 矢量蒙版 ▸ 显示全部（空路径的矢量蒙版）', p => vmaskAdd(p, 'reveal'));
reg('layer.vectorMask.hideAll', '{id?} 矢量蒙版 ▸ 隐藏全部（空路径＋反相）', p => vmaskAdd(p, 'hide'));
reg('layer.vectorMask.currentPath', '{id?, from:矢量层 id（它的形状当路径）| path:[形状…文件坐标]|[{x,y,in?,out?}…]} 矢量蒙版 ▸ 当前路径（我们没有路径面板：用一个矢量层的形状当「当前路径」）' + UIP, p => {
  if (p.ui && p.path === undefined && !p.from){
    const vs = Doc.layers.filter(V => V.kind === 'vector' && V.data.shapes.length && V.id !== Doc.activeId);
    if (!vs.length) return fail('no work path: draw a shape on a vector layer first');
    const T = Doc.activeId;
    dialog('vmaskPath', ['目前路徑', '当前路径', 'Current Path'], [{key:'from', label:['路徑', '路径', 'Path'], type:'select', value:vs[vs.length - 1].id, options:vs.map(V => [V.id, V.name])}],
      v => CMD.run('ps.layer.vectorMask.currentPath', {id:T, from:v.from}),
      ['我們沒有路徑面板：選一個向量圖層，它的形狀就是路徑。', '我们没有路径面板：选一个矢量层，它的形状就是路径。', 'No Paths panel here: pick a vector layer — its shapes are the path.']);
    return UI_OPEN;
  }
  return vmaskAdd(p, 'path');
});
// vector_cmds.rs:941 vector_mask_edit
reg('layer.vectorMask.edit', '{id?, path?:[形状…]|[{x,y,…}…], enabled?:bool, linked?:bool, density?:0..100, feather?:px（只存，原码也还没羽化）, invert?:true（反相一次）} 改矢量蒙版 → 蒙版资讯', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  const v = L.vmask; if (!v) return fail('layer has no vector mask');
  if (p.path !== undefined){ try { v.shapes = parsePath(p.path); } catch (e){ return fail(e.message); } v.ax = L.x; v.ay = L.y; }
  if (typeof p.enabled === 'boolean') v.enabled = p.enabled;
  if (typeof p.linked === 'boolean' && p.linked !== (v.linked !== false)){
    if (!p.linked){ const dx = L.x - (v.ax || 0), dy = L.y - (v.ay || 0); if (dx || dy) v.shapes = v.shapes.map(s => shiftShape(s, dx, dy)); v.linked = false; }   // 取消链接：形状定在现在的位置
    else { v.linked = true; v.ax = L.x; v.ay = L.y; }
  }
  if (isNum(+p.density) && p.density !== undefined && p.density !== null) v.density = clamp(+p.density / 100, 0, 1);
  if (isNum(+p.feather) && p.feather !== undefined && p.feather !== null) v.feather = Math.max(0, +p.feather);
  if (p.invert === true) v.inverted = !v.inverted;
  return vmaskInfo(L);
});
reg('layer.vectorMask.delete', '{id?} 删除矢量蒙版', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (!L.vmask) return fail('layer has no vector mask');
  delete L.vmask; return {ok:true};
});
reg('layer.vectorMask.enabled', '{id?, enabled?:bool（缺省＝切换）} 启用／停用矢量蒙版 → {enabled}', p => {
  const L = layerOf(p); if (!L || !L.vmask) return fail('layer has no vector mask');
  L.vmask.enabled = typeof p.enabled === 'boolean' ? p.enabled : L.vmask.enabled === false; return {enabled:L.vmask.enabled};
});
reg('layer.vectorMask.linked', '{id?, linked?:bool（缺省＝切换）} 链接／取消链接矢量蒙版（取消后移动图层，矢量蒙版不动）→ {linked}', p => {
  const L = layerOf(p); if (!L || !L.vmask) return fail('layer has no vector mask');
  const v = typeof p.linked === 'boolean' ? p.linked : L.vmask.linked === false;
  CMD.map['ps.layer.vectorMask.edit'].run({id:L.id, linked:v});
  return {linked:L.vmask.linked !== false};
});
reg('layer.vectorMask.info', '{id?} 矢量蒙版资讯', p => { const L = layerOf(p); return L ? vmaskInfo(L) : fail('no active layer'); }, false);
// vector_cmds.rs:983 vector_mask_rasterize：矢量蒙版乘进像素蒙版（没有就先建一个全显示的）
reg('layer.rasterize.vectorMask', '{id?} 栅格化 ▸ 矢量蒙版：乘进图层蒙版、删掉矢量蒙版', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (!L.vmask) return fail('layer has no vector mask');
  const W = Doc.width, H = Doc.height, vm = vmaskCanvas(Object.assign(Object.create(L), {vmask:Object.assign({}, L.vmask, {enabled:true})}), 1, W, H);
  const R = L.kind === 'raster';
  let m = L.mask || L.maskOff;
  if (!m){
    const c = mkCanvas(R ? L.data.canvas.width : W, R ? L.data.canvas.height : H), x = ctx2d(c);
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    m = {id:'M2' + L.id, kind:'raster', name:'mask', visible:true, opacity:1, blend:'normal', mask:null, x:0, y:0, _cache:null, _cacheScale:0, data:{canvas:c, ctx:x}};
    L.mask = m;
  }
  const x = m.data.ctx; x.save(); x.globalCompositeOperation = 'destination-in';
  x.drawImage(vm, R ? -L.x : 0, R ? -L.y : 0);                // 像素层的蒙版在图层坐标
  x.restore(); m._cache = null;
  delete L.vmask;
  return {id:L.id};
});

/* ── 合并形状 ── vector_cmds.rs:566 shape_edit op（combine／subtract／intersect／exclude 套在第一个之后的子路径上）＋ 1027 merge_components
   我们的矢量层＝一个层里好几个形状（AI 式），PS 的「形状图层」＝一层一条路径（好几个子路径）。所以：
   目标＝选中的几个矢量层（Doc.selectedIds）或 ids／id；只有一层时＝那一层里的形状（有 VecSel 选取就只要选中的）。
   第一个（最底下）形状是基底，其余照运算合进去，算出来的轮廓（AIObj.arrangement 平面排列＋ tidyLoop 拟合回曲线）变成一个路径／复合路径，外观取基底的。 */
const OPS = {
  combine: m => m.some(Boolean),
  subtract: m => !!m[0] && !m.slice(1).some(Boolean),
  intersect: m => m.length > 0 && m.every(Boolean),
  exclude: m => m.filter(Boolean).length % 2 === 1
};
function vecTargets(p){
  let ids = Array.isArray(p.ids) && p.ids.length ? p.ids : p.id || p.layerId ? [p.id || p.layerId] : null;
  if (!ids && Array.isArray(Doc.selectedIds)) ids = Doc.selectedIds.filter(id => { const V = Doc.byId(id); return V && V.kind === 'vector'; });
  if (!ids || !ids.length){ const A = Doc.active(); ids = A && A.kind === 'vector' ? [A.id] : []; }
  return [...new Set(ids)].map(id => Doc.byId(id)).filter(V => V && V.kind === 'vector').sort((a, b) => Doc.index(a.id) - Doc.index(b.id));
}
function polysOf(s, dx, dy){
  const O = window.AIObj, sets = [];
  const leafPolys = n => { const v = VecSel.asBezier(n); if (!v || !v.anchors || v.anchors.length < 2) return []; const P = O.flatten(v).map(q => [q[0] + dx, q[1] + dy]); return P.length >= 2 ? [P] : []; };
  const go = n => {
    if (!n || n.visible === false) return;
    if (n.type === 'group'){ (n.children || []).forEach(go); return; }
    if (n.type === 'compound'){ const polys = []; (n.children || []).forEach(c => polys.push(...leafPolys(c))); if (polys.length) sets.push({polys, rule:n.rule === 'evenodd' ? 'evenodd' : 'nonzero'}); return; }
    const polys = leafPolys(n); if (polys.length) sets.push({polys, rule:'nonzero'});
  };
  go(s); return sets;
}
function styleOf(s){
  if (s.type === 'group'){ const f = (s.children || []).find(c => c.type !== 'group'); return f ? styleOf(f) : {fill:'#000000', stroke:'none', strokeWidth:0}; }
  return {fill:clone(s.fill === undefined ? 'none' : s.fill), stroke:clone(s.stroke === undefined ? 'none' : s.stroke), strokeWidth:s.strokeWidth || 0};
}
/* 环（文件坐标）→ 一个形状（图层坐标），外观照 st；一个环＝路径，多个＝复合路径（ai-object.js shapeNode 同） */
function shapeFromLoops(loops, st, dx, dy){
  const subs = loops.map(P => window.AIObj.tidyLoop(P)).filter(Boolean);
  if (!subs.length) return null;
  const mv = a => Object.assign({}, a, {x:a.x - dx, y:a.y - dy, in:a.in ? [a.in[0] - dx, a.in[1] - dy] : null, out:a.out ? [a.out[0] - dx, a.out[1] - dy] : null});
  if (subs.length === 1) return Object.assign({id:uid('S'), type:'bezier', anchors:subs[0].anchors.map(mv), closed:true}, st);
  return Object.assign({id:uid('S'), type:'compound', rule:'nonzero', children:subs.map(v => ({id:uid('S'), type:'bezier', anchors:v.anchors.map(mv), closed:true, fill:'none', stroke:'none', strokeWidth:0}))}, st);
}
function combineShapes(p, op, cmd){
  if (!window.AIObj || !window.VecSel) return fail('combine shapes needs menus/impl/ai-object.js and tools/_vecsel.js');
  const Vs = vecTargets(p);
  if (p.ui && !Vs.length){
    const all = Doc.layers.filter(V => V.kind === 'vector' && V.data.shapes.length);
    if (!all.length) return fail('no shape (vector) layers');
    pickLayers('pickShapes', ['合併形狀', '合并形状', 'Combine Shapes'], all, all.map(V => V.id), 1, ids => CMD.run(cmd, {ids}),
      ['勾選要合併的向量圖層（最下面那個形狀是基底）。', '勾选要合并的矢量层（最下面那个形状是基底）。', 'Tick the vector layers to combine (the bottom shape is the base).']);
    return UI_OPEN;
  }
  if (!Vs.length) return fail('not a shape layer (select a vector layer, or give ids)');
  const T = Vs[0];
  let items = [];
  if (Vs.length === 1){
    const sel = VecSel.layerId === T.id ? (VecSel.shapes || []) : [];
    items = T.data.shapes.filter(s => s.visible !== false && (sel.length < 2 || sel.includes(s.id))).map(s => ({V:T, s}));
  } else Vs.forEach(V => V.data.shapes.filter(s => s.visible !== false).forEach(s => items.push({V, s})));
  if (items.length < 2) return fail('need two or more shapes to combine');
  const sets = items.map(({V, s}) => { const ss = polysOf(s, V.x || 0, V.y || 0); return {polys:ss.flatMap(q => q.polys), rule:ss.length === 1 ? ss[0].rule : 'nonzero'}; });
  const loops = window.AIObj.arrangement(sets, OPS[op]);
  const out = shapeFromLoops(loops, styleOf(items[0].s), T.x || 0, T.y || 0);
  const used = new Set(items.map(it => it.s.id));
  const at = T.data.shapes.findIndex(s => used.has(s.id));
  T.data.shapes = T.data.shapes.filter(s => !used.has(s.id));
  if (out) T.data.shapes.splice(Math.max(0, Math.min(at, T.data.shapes.length)), 0, out);
  Layer.invalidate(T);
  Vs.slice(1).forEach(V => { V.data.shapes = V.data.shapes.filter(s => !used.has(s.id)); Layer.invalidate(V); if (!V.data.shapes.length) Doc.remove(V.id); });
  Doc.activeId = T.id;
  if (VecSel.clear) VecSel.clear();
  return {id:T.id, shape:out ? out.id : null, loops:loops.length};
}
reg('layer.combineShapes.unite', '{ids?:[矢量层…]|id?} 合并形状（联集）：几个形状合成一个轮廓（外观取最底下那个）' + UIP, p => combineShapes(p, 'combine', 'ps.layer.combineShapes.unite'));
reg('layer.combineShapes.subtractFrontShape', '{ids?|id?} 减去顶层形状：最底下的形状减掉其余的' + UIP, p => combineShapes(p, 'subtract', 'ps.layer.combineShapes.subtractFrontShape'));
reg('layer.combineShapes.intersectShapeAreas', '{ids?|id?} 与形状区域相交：只留全部都盖到的地方' + UIP, p => combineShapes(p, 'intersect', 'ps.layer.combineShapes.intersectShapeAreas'));
reg('layer.combineShapes.excludeOverlappingShapes', '{ids?|id?} 排除重叠形状：盖到奇数次的地方（重叠处挖空）' + UIP, p => combineShapes(p, 'exclude', 'ps.layer.combineShapes.excludeOverlappingShapes'));
// vector_cmds.rs:1027 merge_components：把路径运算「烤」成干净的轮廓——我们每层各自把它的形状（含复合路径的奇偶规则）合成一个轮廓
reg('layer.combineShapes.mergeShapeComponents', '{ids?|id?} 合并形状组件：每个矢量层里的形状（含复合路径的填色规则）烤成一个干净的轮廓' + UIP, p => {
  if (!window.AIObj || !window.VecSel) return fail('needs menus/impl/ai-object.js and tools/_vecsel.js');
  const Vs = vecTargets(p);
  if (p.ui && !Vs.length){
    const all = Doc.layers.filter(V => V.kind === 'vector' && V.data.shapes.length);
    if (!all.length) return fail('no shape (vector) layers');
    pickLayers('pickMerge', ['合併形狀元件', '合并形状组件', 'Merge Shape Components'], all, [], 1, ids => CMD.run('ps.layer.combineShapes.mergeShapeComponents', {ids}));
    return UI_OPEN;
  }
  if (!Vs.length) return fail('not a shape layer');
  let n = 0;
  Vs.forEach(V => {
    const shapes = V.data.shapes.filter(s => s.visible !== false); if (!shapes.length) return;
    const sets = shapes.flatMap(s => polysOf(s, 0, 0));
    const loops = window.AIObj.arrangement(sets, m => m.some(Boolean));
    const out = shapeFromLoops(loops, styleOf(shapes[0]), 0, 0);
    V.data.shapes = V.data.shapes.filter(s => s.visible === false).concat(out ? [out] : []);
    Layer.invalidate(V); n++;
  });
  if (VecSel.clear) VecSel.clear();
  return {merged:n};
});

/* ── 蒙版所有对象 ── layer_menu_cmds.rs:192 mask_all_objects：主体侦测（select_subject）的结果当蒙版（全隐藏底、找到的物件处显示） */
reg('layer.maskAllObjects', '{id?} 蒙版所有对象：找出画面里的主体／物件，做成这层的图层蒙版 → {bounds:[x,y,w,h]}', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (!window.PsSelect || typeof PsSelect.selectSubject !== 'function') return fail('object detection (select_subject) is not available');
  const W = Doc.width, H = Doc.height;
  const src = L.kind === 'raster' && !L.adjust && !L.fillLayer ? (() => { const c = mkCanvas(W, H); ctx2d(c).drawImage(L.data.canvas, L.x || 0, L.y || 0); return c; })() : composite(1);
  const reg0 = PsSelect.selectSubject(ctx2d(src).getImageData(0, 0, W, H).data, W, H);
  if (!reg0 || !reg0.mask) return fail('no objects were found');
  const R = L.kind === 'raster', c = mkCanvas(R ? L.data.canvas.width : W, R ? L.data.canvas.height : H), x = ctx2d(c);
  const img = x.createImageData(c.width, c.height), d = img.data, ox = R ? L.x || 0 : 0, oy = R ? L.y || 0 : 0;
  for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++){
    const X = xx + ox, Y = y + oy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const v = reg0.mask[Y * W + X], o = (y * c.width + xx) * 4; d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = v;
  }
  x.putImageData(img, 0, 0);
  L.mask = {id:'M2' + L.id + 'o', kind:'raster', name:'mask', visible:true, opacity:1, blend:'normal', mask:null, x:0, y:0, _cache:null, _cacheScale:0, data:{canvas:c, ctx:x}};
  delete L.maskOff;
  return {bounds:reg0.bbox || null};
});

/* ── 新建基于图层的切片 ── slice_cmds.rs:399 layer_based（切片跟着图层的外框＋效果走；Doc.slices） */
function layerBoundsOf(L){                                  // slice_cmds.rs:61 layer_bounds：像素外框（含效果外扩）
  const c = mkCanvas(Doc.width, Doc.height);
  PsLayer.drawOne(ctx2d(c), Object.assign({}, L, {visible:true, clipped:false}), 1);
  return alphaBox(c);
}
function sliceRect(sl){
  if (sl.origin !== 'layer') return sl.rect;
  const L = Doc.byId(sl.layer); if (!L) return null;
  const b = layerBoundsOf(L); if (!b) return null;
  const [t, le, bo, r] = sl.outsets || [0, 0, 0, 0];
  return [b.x - le, b.y - t, b.w + le + r, b.h + t + bo];
}
function sliceList(){
  return (Doc.slices || []).map((sl, i) => ({number:i + 1, id:sl.id, origin:sl.origin, name:sl.name || '', layer:sl.layer || null, rect:sliceRect(sl), url:sl.url || '', alt:sl.alt || ''})).filter(s => s.rect);
}
reg('layer.newLayerBasedSlice', '{id?, name?, url?, alt?} 新建基于图层的切片（跟着图层的外框＋效果走）→ {slice, rect:[x,y,w,h]}', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (L.adjust) return fail('adjustment layers have no bounds to slice');
  if (Doc.layers[0] === L && PsLayer.isBackground(L)) return fail("the Background layer can't have a layer-based slice");
  Doc.slices = Doc.slices || [];
  if (Doc.slices.some(s => s.layer === L.id)) return fail('the layer already has a layer-based slice');
  const b = layerBoundsOf(L); if (!b) return fail('Could not create a layer based slice because the layer is empty');
  const id = Doc.slices.reduce((m, s) => Math.max(m, s.id || 0), 0) + 1;
  Doc.slices.push({id, origin:'layer', layer:L.id, outsets:[0, 0, 0, 0], name:typeof p.name === 'string' ? p.name : '', url:typeof p.url === 'string' ? p.url : '', alt:typeof p.alt === 'string' ? p.alt : ''});
  return {slice:id, rect:[b.x, b.y, b.w, b.h]};
});
reg('slice.list', '{} 切片清单（基于图层的切片跟着图层算）→ {slices:[{number,id,origin,name,layer,rect:[x,y,w,h]}]}', () => ({slices:sliceList()}), false);
// 删除切片：tools/slice.js 的 slice.delete 是正本（PS 编号、自动切片不能删、锁定切片）；这里只是旧名转叫
reg('slice.delete', '{slice:id | number:n | slices:[id…]} 删除切片（转叫 slice.delete）', p => {
  if (CMD.map['slice.delete']) return CMD.map['slice.delete'].run(p);
  const ids = Array.isArray(p.slices) ? p.slices : [p.slice];
  const before = (Doc.slices || []).length;
  Doc.slices = (Doc.slices || []).filter(s => !ids.includes(s.id));
  return before === Doc.slices.length ? fail('none of the slices exist') : {deleted:before - Doc.slices.length};
});
/* ═══════════ 图层样式 ▸ 斜面和浮雕／图案叠加（engine/src/layer_style.rs:62 effect_from_params、compose/src/effects.rs）═══════════
   ps-layer.js 的效果管线只认八种效果；有这两种的层改走这里的 composeFx2（照 effects.rs:1141 composite_with_effects_prepared 整段，
   八种效果的算法跟 ps-layer.js 同一份——那几支它有公开的就直接用 PsLayer.fx）。 */
const FX = PsLayer.fx, INSIDE_EPS = 0.5 / 255, MAX_REACH = 512, BEVEL_H_EPS = 1e-5;
const STD_FX = ['dropShadow', 'innerShadow', 'outerGlow', 'innerGlow', 'satin', 'colorOverlay', 'gradientOverlay', 'stroke'];
const NEW_FX = ['bevelEmboss', 'patternOverlay'];
const fxItems = L => (L.style && Array.isArray(L.style.items) ? L.style.items : []).filter(e => e.enabled !== false && (STD_FX.includes(e.kind) || NEW_FX.includes(e.kind)));
const hasFx2 = L => !!(L && L.style && L.style.enabled !== false && Array.isArray(L.style.items) && L.style.items.some(e => e.enabled !== false && NEW_FX.includes(e.kind)));
const hasStyle = L => has0(L) || hasFx2(L);
const drawStyled = (ctx, L, src, scale) => hasFx2(L) ? drawFx2(ctx, L, src, scale) : draw0(ctx, L, src, scale);
function parseBlend(v, d){
  if (v === undefined || v === null || v === '') return d;
  const k = String(v).replace(/[\s_-]+/g, '').toLowerCase(), b = BLENDS.find(x => x.toLowerCase() === k);   // 不分大小写（colorDodge／Color Dodge／colordodge 都认）
  if (!b) throw new Error(`unknown blend mode \`${v}\``);
  return b;
}
const BSTYLES = {inner:'inner', outer:'outer', emboss:'emboss', pillow:'pillow', stroke:'stroke'}, BTECH = ['smooth', 'chiselHard', 'chiselSoft'];
/* layer_style.rs:126 bevelEmboss（高光／阴影的颜色模式不透明度原码命令不收、用 PS 预设；我们多收 highlight*／shadow* 给对话框用） */
function bevelFromParams(p){
  return {kind:'bevelEmboss', enabled:bool(p, 'enabled', true), style:BSTYLES[p.style] || 'inner', technique:BTECH.includes(p.technique) ? p.technique : 'smooth',
    depth:num(p, 'depth', 100) / 100, up:p.direction !== 'down', size:num(p, 'size', 5), soften:num(p, 'soften', 0), angle:num(p, 'angle', 120), altitude:num(p, 'altitude', 30),
    useGlobalLight:bool(p, 'useGlobalLight', true),
    highlightColor:hexOf(p.highlightColor, '#ffffff'), highlightBlend:parseBlend(p.highlightBlend, 'screen'), highlightOpacity:clamp(num(p, 'highlightOpacity', 75), 0, 100) / 100,
    shadowColor:hexOf(p.shadowColor, '#000000'), shadowBlend:parseBlend(p.shadowBlend, 'multiply'), shadowOpacity:clamp(num(p, 'shadowOpacity', 75), 0, 100) / 100,
    contour:bool(p, 'contour', false) ? {range:clamp(num(p, 'contourRange', 50) / 100, 0.01, 1)} : null,
    texture:(typeof p.texture === 'string' && p.texture) ? {pattern:p.texture, scale:clamp(num(p, 'textureScale', 100) / 100, 0.01, 10), depth:clamp(num(p, 'textureDepth', 100) / 100, -10, 10),
      invert:bool(p, 'textureInvert', false), link:bool(p, 'textureLink', true)} : null};
}
/* layer_style.rs:107 patternOverlay（pattern_cmds.rs:143 resolve_effect：名字／id 换成图案库里真的那个） */
function patternOverlayFromParams(p){
  const lib = patternLib(); if (!lib) throw new Error('the pattern library (menus/impl/ps-edit.js) is not loaded');
  const key = typeof p.pattern === 'string' ? p.pattern : '';
  const pat = lib.resolve(key); if (!pat) throw new Error(`no pattern "${key}" (see ps.pattern.list)`);
  return {kind:'patternOverlay', enabled:bool(p, 'enabled', true), blend:parseBlend(p.blend, 'normal'), opacity:clamp(num(p, 'opacity', 100), 0, 100) / 100,
    pattern:pat.id, name:pat.name, scale:clamp(num(p, 'scale', 100) / 100, 0.01, 10), angle:num(p, 'angle', 0), link:bool(p, 'link', true), phase:[num(p, 'phaseX', 0), num(p, 'phaseY', 0)]};
}
const resolvePat = e => { const lib = patternLib(); return lib ? (lib.resolve(e.pattern || '') || lib.resolve(e.name || '')) : null; };
/* 图案的预乘磁砖＋环绕双线性取样（pattern.rs:86 Tile／111 sample） */
function tileOf(pat){
  if (pat._tile) return pat._tile;
  const tw = pat.width, th = pat.height, tp = new Float32Array(tw * th * 4);
  for (let i = 0; i < tw * th; i++){ const a = pat.px[i * 4 + 3] / 255; tp[i * 4] = pat.px[i * 4] / 255 * a; tp[i * 4 + 1] = pat.px[i * 4 + 1] / 255 * a; tp[i * 4 + 2] = pat.px[i * 4 + 2] / 255 * a; tp[i * 4 + 3] = a; }
  const mod = (v, n) => ((v % n) + n) % n;
  const t = {sample(u, v, out){
    u -= 0.5; v -= 0.5; const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    out[0] = out[1] = out[2] = out[3] = 0;
    for (let dy = 0; dy < 2; dy++){ const wy = dy ? fy : 1 - fy; if (!wy) continue;
      for (let dx = 0; dx < 2; dx++){ const wx = dx ? fx : 1 - fx; if (!wx) continue;
        const j = (mod(y0 + dy, th) * tw + mod(x0 + dx, tw)) * 4, k = wx * wy;
        out[0] += tp[j] * k; out[1] += tp[j + 1] * k; out[2] += tp[j + 2] * k; out[3] += tp[j + 3] * k; } }
    if (out[3] > 0){ out[0] /= out[3]; out[1] /= out[3]; out[2] /= out[3]; out[3] = Math.min(out[3], 1); }
    return out; }};
  hide(pat, '_tile', t); return t;
}
/* pattern.rs:159 Placement::anchored */
function anchored(anchor, link, phase, scale, angle){
  const base = link ? anchor : [0, 0], ox = base[0] + phase[0], oy = base[1] + phase[1];
  const inv = (isFinite(scale) && scale > 1e-3) ? 1 / scale : 1, a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return (x, y) => { const dx = x - ox, dy = y - oy; return [(dx * c - dy * s) * inv, (dx * s + dy * c) * inv]; };
}

/* ── 合成小件（psblend.rs composite：直通 alpha 的 W3C 通式；同 ps-layer.js compositePx）── */
const BB = [0, 0, 0];
function compositePx(mode, dst, i, r, g, b, as){
  if (as <= 0) return;
  const j = i * 4, ab = dst[j + 3], ao = as + ab * (1 - as);
  if (ao <= 0){ dst[j] = dst[j + 1] = dst[j + 2] = dst[j + 3] = 0; return; }
  if (mode === 'normal' || !mode){
    const kb = ab * (1 - as), inv = 1 / ao;
    dst[j] = (kb * dst[j] + as * r) * inv; dst[j + 1] = (kb * dst[j + 1] + as * g) * inv; dst[j + 2] = (kb * dst[j + 2] + as * b) * inv; dst[j + 3] = ao;
    return;
  }
  const k1 = (1 - as) * ab / ao, k2 = (1 - ab) * as / ao, k3 = as * ab / ao;
  const b0 = dst[j], b1 = dst[j + 1], b2 = dst[j + 2];
  blendInto(mode, b0, b1, b2, r, g, b, BB);
  dst[j] = k1 * b0 + k2 * r + k3 * BB[0]; dst[j + 1] = k1 * b1 + k2 * g + k3 * BB[1]; dst[j + 2] = k1 * b2 + k2 * b + k3 * BB[2]; dst[j + 3] = ao;
}
function paintColor(dst, m, rgb, blend, opacity){ for (let i = 0; i < m.length; i++){ const a = m[i] * opacity; if (a > 0) compositePx(blend, dst, i, rgb[0], rgb[1], rgb[2], a); } }
/* effects.rs:622 paint_fx（颜色或渐变） */
function paintFx(dst, m, paint, fr, big, blend, opacity){
  if (!paint.gradient){ paintColor(dst, m, rgb01(paint.color), blend, opacity); return; }
  const g = paint.gradient, A = rgb01(g.from), B = rgb01(g.to);
  const [angle, scale, off] = FX.gradientLayout(g.style, g.angle, g.scale, [0, 0], fr);
  for (let i = 0; i < m.length; i++){
    const a = m[i] * opacity; if (a <= 0) continue;
    const t = FX.gradientT(g.style, angle, scale, g.reverse, off, fr, big.x + (i % big.w) + 0.5, big.y + Math.floor(i / big.w) + 0.5);
    compositePx(blend, dst, i, A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t, a);
  }
}
/* effects.rs:595 paint_pattern：图案找不到就不画 */
function paintPattern(dst, m, e, place, big, k){
  const pat = resolvePat(e); if (!pat) return;
  const t = tileOf(pat), c = [0, 0, 0, 0];
  for (let i = 0; i < m.length; i++){
    const a = m[i] * e.opacity; if (a <= 0) continue;
    const [u, v] = place((big.x + (i % big.w) + 0.5) / k, (big.y + Math.floor(i / big.w) + 0.5) / k);
    t.sample(u, v, c);
    compositePx(e.blend, dst, i, c[0], c[1], c[2], c[3] * a);
  }
}
const strokeWidths = (st, k) => st.position === 'inside' ? [st.size * k, 0] : st.position === 'center' ? [st.size * k / 2, st.size * k / 2] : [0, st.size * k];
function strokeFrame(shape, big, outW){
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < big.h; y++) for (let x = 0; x < big.w; x++) if (shape[y * big.w + x] > INSIDE_EPS){ x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  if (x1 < 0) return {x:big.x, y:big.y, w:big.w, h:big.h};
  const g = isFinite(outW) ? Math.max(Math.ceil(Math.min(outW, MAX_REACH)) - 1, 0) : 0;
  return {x:big.x + x0 - g, y:big.y + y0 - g, w:x1 - x0 + 2 * g, h:y1 - y0 + 2 * g};
}
function strokeColorAt(st, fr, big){
  if (!st.gradient){ const c = rgb01(st.color); return () => c; }
  const g = st.gradient, A = rgb01(g.from), B = rgb01(g.to), out = [0, 0, 0];
  const [angle, scale, off] = FX.gradientLayout(g.style, g.angle, g.scale, [0, 0], fr);
  return i => { const t = FX.gradientT(g.style, angle, scale, g.reverse, off, fr, big.x + (i % big.w) + 0.5, big.y + Math.floor(i / big.w) + 0.5);
    out[0] = A[0] + (B[0] - A[0]) * t; out[1] = A[1] + (B[1] - A[1]) * t; out[2] = A[2] + (B[2] - A[2]) * t; return out; };
}
/* effects.rs:78 shifted（双线性）＋1058 satin_map */
function shifted(s, w, h, dx, dy, outside){
  const out = new Float32Array(w * h), fx = Math.floor(dx), fy = Math.floor(dy), ax = dx - fx, ay = dy - fy;
  const g = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? outside : s[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const sx = x - fx, sy = y - fy;
    const top = g(sx, sy) * (1 - ax) + g(sx - 1, sy) * ax, bot = g(sx, sy - 1) * (1 - ax) + g(sx - 1, sy - 1) * ax;
    out[y * w + x] = top * (1 - ay) + bot * ay;
  }
  return out;
}
const fxOffset = (angle, dist) => { const a = angle * Math.PI / 180; return [Math.round(-Math.cos(a) * dist), Math.round(Math.sin(a) * dist)]; };
function satinMap(shape, w, h, e, k){
  const [dx, dy] = fxOffset(e.angle, e.distance * k);
  const a = FX.tent(shifted(shape, w, h, dx, dy, 0), w, h, e.size * k), b = FX.tent(shifted(shape, w, h, -dx, -dy, 0), w, h, e.size * k);
  const m = new Float32Array(w * h);
  for (let i = 0; i < m.length; i++){ let v = Math.abs(a[i] - b[i]); if (e.invert) v = 1 - v; m[i] = v * shape[i]; }
  return m;
}
/* effects.rs:846 bevel_geom */
function bevelGeom(b, k){
  const size = Math.max(b.size * k, 1), emboss = b.style === 'emboss' || b.style === 'pillow';
  const paint = b.style === 'outer' ? 'outer' : emboss ? 'both' : 'inner';
  const width = emboss ? Math.ceil(size / 2) : size, smooth = b.technique === 'smooth';
  return {paint, width, size, depth:b.depth * (smooth ? width : size) * (b.up ? 1 : -1), pillow:b.style === 'pillow', chiselSoft:b.technique === 'chiselSoft' ? Math.max(size / 4, 1) : 0};
}
/* effects.rs:926 bevel_chisel_h */
function chiselH(paint, size, din, dout){
  if (paint === 'outer') return 1 - clamp(dout / size, 0, 1);
  if (paint === 'both') return din > 0 ? 0.5 + 0.5 * clamp(din / (size / 2), 0, 1) : 0.5 - 0.5 * clamp(dout / (size / 2), 0, 1);
  return clamp(din / size, 0, 1);
}
/* effects.rs:872 bevel_height：平滑＝形状过两次盒状模糊；雕刻＝到边的精确距离线性坡；轮廓、纹理、柔化 */
function bevelHeight(shape, w, h, b, g, k, big, anchor){
  let hm;
  if (b.technique === 'smooth'){ hm = Float32Array.from(shape); FX.tent(hm, w, h, g.width); }
  else {
    const din = FX.distInside(shape, w, h, false), dout = FX.distOutside(shape, w, h, false);
    hm = new Float32Array(w * h); for (let i = 0; i < hm.length; i++) hm[i] = chiselH(g.paint, g.size, din[i], dout[i]);
    if (g.chiselSoft > 0) FX.tent(hm, w, h, g.chiselSoft);
  }
  if (b.contour){ const r = clamp(b.contour.range, 0.01, 1); if (r < 0.999) for (let i = 0; i < hm.length; i++) hm[i] = Math.min(hm[i] / r, 1); }   // ranged_lut（线性轮廓）
  if (b.texture){
    const pat = resolvePat(b.texture);
    if (pat){
      const t = tileOf(pat), unit = Math.abs(b.depth) > 1e-6 ? Math.max(Math.abs(g.depth / b.depth), 1e-3) : Math.max(g.width, 1);
      const place = anchored(anchor, b.texture.link !== false, [0, 0], b.texture.scale * k, 0), kt = b.texture.depth / unit, c = [0, 0, 0, 0];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
        const [u, v] = place(big.x + x + 0.5, big.y + y + 0.5); t.sample(u, v, c);
        const l = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) * c[3];
        hm[y * w + x] += kt * (b.texture.invert ? 1 - l : l);
      }
    }
  }
  if (b.soften * k >= 1) FX.tent(hm, w, h, b.soften * k);
  return hm;
}
/* effects.rs:942 bevel_maps：高度图的梯度当法线，跟光的方向点积 → 高光／阴影两张图（浮雕类里外各一套再合） */
function bevelMaps(shape, w, h, b, light, k, big, anchor){
  const g = bevelGeom(b, k), hm = bevelHeight(shape, w, h, b, g, k, big, anchor);
  const ang = (b.useGlobalLight ? light.angle : b.angle) * Math.PI / 180, alt = (b.useGlobalLight ? light.altitude : b.altitude) * Math.PI / 180;
  const se = Math.sin(alt), ce = Math.cos(alt), Lv = [Math.cos(ang) * ce, -Math.sin(ang) * ce, se];
  const get = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : hm[y * w + x];
  const reachPast = g.paint === 'both';
  const onBevel = (x, y) => get(x, y) > BEVEL_H_EPS || (reachPast && (get(x + 1, y) > BEVEL_H_EPS || get(x - 1, y) > BEVEL_H_EPS || get(x, y + 1) > BEVEL_H_EPS || get(x, y - 1) > BEVEL_H_EPS));
  const shade = (depth, outer) => {
    const hi = new Float32Array(w * h), sh = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const i = y * w + x, gx = (get(x + 1, y) - get(x - 1, y)) * 0.5 * depth, gy = (get(x, y + 1) - get(x, y - 1)) * 0.5 * depth;
      const s = (-gx * Lv[0] - gy * Lv[1] + Lv[2]) / Math.sqrt(gx * gx + gy * gy + 1);
      const region = outer ? ((shape[i] < 1 - INSIDE_EPS && onBevel(x, y)) ? 1 : 0) : shape[i];
      if (!region) continue;
      const kk = s - se;
      if (kk > 0) hi[i] = clamp(kk / Math.max(1 - se, 1e-3), 0, 1) * region; else sh[i] = clamp(-kk / Math.max(se, 1e-3), 0, 1) * region;
    }
    return [hi, sh];
  };
  if (g.paint !== 'both') return {paint:g.paint, maps:shade(g.depth, g.paint === 'outer')};
  const [hi, sh] = shade(g.depth, false), [ho, so] = shade(g.pillow ? -g.depth : g.depth, true);
  const mix = (a, o) => { const v = new Float32Array(w * h); for (let i = 0; i < v.length; i++){ const s = shape[i]; v[i] = (s > INSIDE_EPS ? a[i] : 0) + o[i] * (1 - Math.min(s, 1)); } return v; };
  return {paint:'both', maps:[mix(hi, ho), mix(sh, so)]};
}
/* effects.rs:1077 build_maps */
function buildMaps2(items, shape, big, light, k, anchor){
  const {w, h} = big;
  const per = items.map(e =>
    e.kind === 'dropShadow' ? FX.shadowMap(shape, w, h, e, light, false, k) :
    e.kind === 'innerShadow' ? FX.shadowMap(shape, w, h, e, light, true, k) :
    e.kind === 'outerGlow' ? FX.glowMap(shape, w, h, e, false, k) :
    e.kind === 'innerGlow' ? FX.glowMap(shape, w, h, e, true, k) :
    e.kind === 'satin' ? satinMap(shape, w, h, e, k) :
    e.kind === 'bevelEmboss' ? bevelMaps(shape, w, h, e, light, k, big, anchor) : null);
  const hasStroke = items.some(e => e.kind === 'stroke');
  return {per, din:hasStroke ? FX.distInside(shape, w, h, true) : null, dout:hasStroke ? FX.distOutside(shape, w, h, true) : null};
}
/* effects.rs:1141 composite_with_effects_prepared（含图案叠加与斜面浮雕三种画法） */
function composeFx2(L, content, before, big, sb, k, maps, items){
  const n = big.w * big.h;
  const shape = new Float32Array(n); for (let i = 0; i < n; i++) shape[i] = content[i * 4 + 3];
  const light = Doc.globalLight || {angle:120, altitude:30};
  const anchor = [sb.x, sb.y];
  maps = maps || buildMaps2(items, shape, big, light, k, anchor);
  const work = Float32Array.from(before);
  const rev = items.map((e, i) => [i, e]).reverse();
  const fill = L.fillOpacity === undefined ? 1 : clamp(L.fillOpacity, 0, 1);
  for (const [i, e] of rev) if (e.kind === 'dropShadow'){
    const m = maps.per[i], c = rgb01(e.color), see = e.knocksOut ? 1 - fill : 0;
    for (let j = 0; j < n; j++){ const a = m[j] * (1 - shape[j] * see) * e.opacity; if (a > 0) compositePx(e.blend, work, j, c[0], c[1], c[2], a); }
  }
  for (const [i, e] of rev) if (e.kind === 'outerGlow') paintFx(work, maps.per[i], e, sb, big, e.blend, e.opacity);
  const lay = new Float32Array(n * 4);
  for (let j = 0; j < n; j++){ lay[j * 4] = content[j * 4]; lay[j * 4 + 1] = content[j * 4 + 1]; lay[j * 4 + 2] = content[j * 4 + 2]; lay[j * 4 + 3] = (shape[j] > INSIDE_EPS) ? fill : 0; }
  const rel = m => { const o = new Float32Array(n); for (let j = 0; j < n; j++) o[j] = (shape[j] > INSIDE_EPS) ? Math.min(m[j] / shape[j], 1) : 0; return o; };
  const full = new Float32Array(n); for (let j = 0; j < n; j++) full[j] = (shape[j] > INSIDE_EPS) ? 1 : 0;
  for (const [, e] of rev) if (e.kind === 'patternOverlay') paintPattern(lay, full, e, anchored([anchor[0] / k, anchor[1] / k], e.link !== false, e.phase || [0, 0], e.scale, e.angle), big, k);
  for (const [, e] of rev) if (e.kind === 'gradientOverlay') paintFx(lay, full, {gradient:e}, sb, big, e.blend, e.opacity);
  for (const [, e] of rev) if (e.kind === 'colorOverlay') paintColor(lay, full, rgb01(e.color), e.blend, e.opacity);
  for (const [i, e] of rev) if (e.kind === 'satin') paintColor(lay, rel(maps.per[i]), rgb01(e.color), e.blend, e.opacity);
  for (const [i, e] of rev) if (e.kind === 'innerGlow') paintFx(lay, rel(maps.per[i]), e, sb, big, e.blend, e.opacity);
  for (const [i, e] of rev) if (e.kind === 'innerShadow') paintColor(lay, rel(maps.per[i]), rgb01(e.color), e.blend, e.opacity);
  const strokes = items.filter(e => e.kind === 'stroke');
  const frameOf = st => st.gradient ? strokeFrame(shape, big, strokeWidths(st, k)[1]) : sb;
  for (const st of strokes.slice().reverse()){
    const [inW] = strokeWidths(st, k); if (inW <= 0) continue;
    const m = new Float32Array(n);
    for (let j = 0; j < n; j++) m[j] = (shape[j] > INSIDE_EPS) ? clamp(inW + 0.5 - maps.din[j], 0, 1) : 0;
    paintFx(lay, m, st, frameOf(st), big, st.blend, st.opacity);
  }
  // 斜面浮雕（内斜面／描边浮雕）：画在层上，相对形状
  for (const [i, e] of rev) if (e.kind === 'bevelEmboss' && maps.per[i].paint === 'inner'){
    paintColor(lay, rel(maps.per[i].maps[0]), rgb01(e.highlightColor), e.highlightBlend, e.highlightOpacity);
    paintColor(lay, rel(maps.per[i].maps[1]), rgb01(e.shadowColor), e.shadowBlend, e.shadowOpacity);
  }
  for (let j = 0; j < n; j++) lay[j * 4 + 3] *= Math.min(shape[j], 1);
  if (strokes.some(st => strokeWidths(st, k)[1] > 0)){
    const acc = new Float32Array(n * 4), cover = new Float32Array(n), px = new Float32Array(4);
    for (const st of strokes){
      const outW = strokeWidths(st, k)[1]; if (outW <= 0) continue;
      const col = strokeColorAt(st, frameOf(st), big);
      for (let j = 0; j < n; j++){
        const band = outW + 0.5 - maps.dout[j], kk = shape[j] > INSIDE_EPS ? 1 : (band <= 0 ? 0 : band >= 1 ? 1 : band);
        const sh = kk * st.opacity * (1 - cover[j]); if (sh <= 0) continue;
        cover[j] += sh;
        px[0] = work[j * 4]; px[1] = work[j * 4 + 1]; px[2] = work[j * 4 + 2]; px[3] = work[j * 4 + 3];
        const c = col(j); compositePx(st.blend, px, 0, c[0], c[1], c[2], 1);
        acc[j * 4] += sh * px[0] * px[3]; acc[j * 4 + 1] += sh * px[1] * px[3]; acc[j * 4 + 2] += sh * px[2] * px[3]; acc[j * 4 + 3] += sh * px[3];
      }
    }
    for (let j = 0; j < n; j++){
      const c = cover[j]; if (c <= 0) continue;
      const kk = 1 - Math.min(c, 1), pa = work[j * 4 + 3], alpha = pa * kk + acc[j * 4 + 3];
      if (alpha > 0){ for (let q = 0; q < 3; q++) work[j * 4 + q] = (work[j * 4 + q] * pa * kk + acc[j * 4 + q]) / alpha; work[j * 4 + 3] = Math.min(alpha, 1); }
    }
  }
  // 外斜面：画在背景上（层底下）
  for (const [i, e] of rev) if (e.kind === 'bevelEmboss' && maps.per[i].paint === 'outer'){
    paintColor(work, maps.per[i].maps[0], rgb01(e.highlightColor), e.highlightBlend, e.highlightOpacity);
    paintColor(work, maps.per[i].maps[1], rgb01(e.shadowColor), e.shadowBlend, e.shadowOpacity);
  }
  for (let j = 0; j < n; j++){ const a = lay[j * 4 + 3]; if (a > 0) compositePx(L.blend, work, j, lay[j * 4], lay[j * 4 + 1], lay[j * 4 + 2], a); }
  // 浮雕／枕状浮雕：合好之后里外一起打光
  for (const [i, e] of rev) if (e.kind === 'bevelEmboss' && maps.per[i].paint === 'both'){
    paintColor(work, maps.per[i].maps[0], rgb01(e.highlightColor), e.highlightBlend, e.highlightOpacity);
    paintColor(work, maps.per[i].maps[1], rgb01(e.shadowColor), e.shadowBlend, e.shadowOpacity);
  }
  const op = L.opacity === undefined ? 1 : L.opacity;
  if (op >= 1){ before.set(work); return before; }
  for (let j = 0; j < n; j++){
    const a = before[j * 4 + 3], b = work[j * 4 + 3], al = a + (b - a) * op;
    if (al <= 0){ before[j * 4] = before[j * 4 + 1] = before[j * 4 + 2] = before[j * 4 + 3] = 0; continue; }
    for (let c = 0; c < 3; c++) before[j * 4 + c] = (before[j * 4 + c] * a + (work[j * 4 + c] * b - before[j * 4 + c] * a) * op) / al;
    before[j * 4 + 3] = al;
  }
  return before;
}
/* effects.rs:39 margin（含斜面浮雕 size＋soften） */
function fxMargin2(items, k){
  let m = 0;
  for (const e of items){
    const r = (e.kind === 'dropShadow' || e.kind === 'innerShadow' || e.kind === 'satin') ? e.distance + e.size : (e.kind === 'outerGlow' || e.kind === 'innerGlow' || e.kind === 'stroke') ? e.size : e.kind === 'bevelEmboss' ? e.size + e.soften : 0;
    if (isFinite(r)) m = Math.max(m, r);
  }
  return Math.ceil(clamp(m * k, 0, MAX_REACH)) + 2;
}
/* 跟 PsLayerStyle.draw 同一套：层像素与背景读进来、算、写回 W×H 的 big 那一块（有结果缓存） */
function drawFx2(ctx, L, src, scale){
  scale = scale || 1;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const lc = mkCanvas(W, H), lx = ctx2d(lc);
  if (L.kind === 'raster' && (L.x || L.y)) lx.drawImage(src, L.x * scale, L.y * scale); else lx.drawImage(src, 0, 0);
  const sbox = alphaBox(lc); if (!sbox) return;
  const items = fxItems(L), mg = fxMargin2(items, scale);
  const x0 = Math.max(0, sbox.x - mg), y0 = Math.max(0, sbox.y - mg), x1 = Math.min(W, sbox.x + sbox.w + mg), y1 = Math.min(H, sbox.y + sbox.h + mg);
  const big = {x:x0, y:y0, w:x1 - x0, h:y1 - y0};
  const c8 = lx.getImageData(big.x, big.y, big.w, big.h).data, b8 = ctx.getImageData(big.x, big.y, big.w, big.h).data;
  const fkey = JSON.stringify([items, scale, Doc.globalLight || null, big, L.opacity, L.blend, L.fillOpacity]);
  const okey = fkey + '|' + hash8(c8) + '|' + hash8(b8);
  if (L._fx2Out && L._fx2Out.key === okey){ putBig(ctx, big, L._fx2Out.img); return; }
  const content = new Float32Array(c8.length); for (let i = 0; i < c8.length; i++) content[i] = c8[i] / 255;
  const before = new Float32Array(b8.length); for (let i = 0; i < b8.length; i++) before[i] = b8[i] / 255;
  composeFx2(L, content, before, big, sbox, scale, null, items);
  const img = ctx.createImageData(big.w, big.h); for (let i = 0; i < before.length; i++) img.data[i] = before[i] * 255;
  putBig(ctx, big, img);
  hide(L, '_fx2Out', {key:okey, img});
}
function putBig(ctx, b, img){
  const t = mkCanvas(b.w, b.h); ctx2d(t).putImageData(img, 0, 0);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
  ctx.globalCompositeOperation = 'copy'; ctx.drawImage(t, b.x, b.y); ctx.restore();
}
/* layer_style.rs:175 set_effect：同种已有就换掉（add:true 另加一个） */
function setEffect(L, fx, add){
  if (!L.style || !Array.isArray(L.style.items)) L.style = {enabled:true, items:[]};
  L.style.enabled = true;
  const at = add ? -1 : L.style.items.findIndex(e => e.kind === fx.kind);
  if (at >= 0) L.style.items[at] = fx; else L.style.items.push(fx);
}
const BEVEL_P = '{style:"inner|outer|emboss|pillow|stroke"="inner", technique:"smooth|chiselHard|chiselSoft"="smooth", depth:1..1000=100, direction:"up|down"="up", size:px=5, soften:px=0, angle=120, altitude=30, useGlobalLight=true, contour:bool, contourRange:1..100=50, texture:图案 id|名字?, textureScale=100, textureDepth:-1000..1000=100, textureInvert, textureLink=true, highlightColor="#ffffff", highlightBlend="screen", highlightOpacity=75, shadowColor="#000000", shadowBlend="multiply", shadowOpacity=75, add?, id?}';
reg('layer.layerStyle.bevelEmboss', BEVEL_P + ' 斜面和浮雕（同种已有就换掉，add:true 另加一个）' + UIP, p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (p.ui) return openBevelDialog(L);
  let fx; try { fx = bevelFromParams(p); if (fx.texture && !resolvePat(fx.texture)) throw new Error(`no pattern "${fx.texture.pattern}" (see ps.pattern.list)`); } catch (e){ return fail(e.message); }
  if (fx.texture){ const pat = resolvePat(fx.texture); fx.texture.pattern = pat.id; fx.texture.name = pat.name; }
  setEffect(L, fx, !!p.add); return {id:L.id};
});
reg('layer.layerStyle.patternOverlay', '{pattern:id|名字=图案库第一个, opacity:0..100=100, blend="normal", scale:1..1000=100, angle=0, link=true, phaseX, phaseY, add?, id?} 图案叠加' + UIP, p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (p.ui) return openPatternOverlayDialog(L);
  let fx; try { fx = patternOverlayFromParams(p); } catch (e){ return fail(e.message); }
  setEffect(L, fx, !!p.add); return {id:L.id};
});
const BLEND_OPTS = () => BLENDS.map(b => [b, Lang.t('blend.' + b)]);
function openBevelDialog(L){
  const cur = Object.assign(bevelFromParams({}), (L.style && L.style.items || []).find(e => e.kind === 'bevelEmboss') || {});
  dialog('bevelEmboss', ['斜角和浮雕', '斜面和浮雕', 'Bevel & Emboss'], [
    {key:'style', label:['樣式', '样式', 'Style'], type:'select', value:cur.style, options:[['outer', ['外斜角', '外斜面', 'Outer Bevel']], ['inner', ['內斜角', '内斜面', 'Inner Bevel']], ['emboss', ['浮雕', '浮雕效果', 'Emboss']], ['pillow', ['枕狀浮雕', '枕状浮雕', 'Pillow Emboss']], ['stroke', ['筆畫浮雕', '描边浮雕', 'Stroke Emboss']]]},
    {key:'technique', label:['技術', '方法', 'Technique'], type:'select', value:cur.technique, options:[['smooth', ['平滑', '平滑', 'Smooth']], ['chiselHard', ['雕鑿硬邊', '雕刻清晰', 'Chisel Hard']], ['chiselSoft', ['雕鑿柔邊', '雕刻柔和', 'Chisel Soft']]]},
    {key:'depth', label:['深度', '深度', 'Depth'], value:Math.round(cur.depth * 100), min:1, max:1000},
    {key:'direction', label:['方向', '方向', 'Direction'], type:'select', value:cur.up ? 'up' : 'down', options:[['up', ['上', '上', 'Up']], ['down', ['下', '下', 'Down']]]},
    {key:'size', label:['尺寸', '大小', 'Size'], value:cur.size, min:0, max:250},
    {key:'soften', label:['柔化', '软化', 'Soften'], value:cur.soften, min:0, max:16},
    {key:'angle', label:['角度', '角度', 'Angle'], value:cur.angle, min:-180, max:180},
    {key:'altitude', label:['高度', '高度', 'Altitude'], value:cur.altitude, min:0, max:90},
    {key:'useGlobalLight', label:['使用整體光源', '使用全局光', 'Use Global Light'], type:'check', value:cur.useGlobalLight},
    {key:'highlightBlend', label:['亮部模式', '高光模式', 'Highlight Mode'], type:'select', value:cur.highlightBlend, options:BLEND_OPTS()},
    {key:'highlightColor', label:['亮部顏色', '高光颜色', 'Highlight Color'], type:'color', value:cur.highlightColor},
    {key:'highlightOpacity', label:['亮部不透明度', '高光不透明度', 'Highlight Opacity'], value:Math.round(cur.highlightOpacity * 100), min:0, max:100},
    {key:'shadowBlend', label:['陰影模式', '阴影模式', 'Shadow Mode'], type:'select', value:cur.shadowBlend, options:BLEND_OPTS()},
    {key:'shadowColor', label:['陰影顏色', '阴影颜色', 'Shadow Color'], type:'color', value:cur.shadowColor},
    {key:'shadowOpacity', label:['陰影不透明度', '阴影不透明度', 'Shadow Opacity'], value:Math.round(cur.shadowOpacity * 100), min:0, max:100}],
    v => CMD.run('ps.layer.layerStyle.bevelEmboss', Object.assign({id:L.id}, v)));
  return UI_OPEN;
}
function openPatternOverlayDialog(L){
  const lib = patternLib(), items = lib ? lib.load() : []; if (!items.length) return fail('no patterns');
  const cur = (L.style && L.style.items || []).find(e => e.kind === 'patternOverlay') || {};
  dialog('patternOverlay', ['圖樣覆蓋', '图案叠加', 'Pattern Overlay'], [
    {key:'blend', label:['混合模式', '混合模式', 'Blend Mode'], type:'select', value:cur.blend || 'normal', options:BLEND_OPTS()},
    {key:'opacity', label:['不透明度', '不透明度', 'Opacity'], value:Math.round((cur.opacity === undefined ? 1 : cur.opacity) * 100), min:0, max:100},
    {key:'pattern', label:['圖樣', '图案', 'Pattern'], type:'select', value:cur.pattern || items[0].id, options:items.map(q => [q.id, q.name])},
    {key:'angle', label:['角度', '角度', 'Angle'], value:cur.angle || 0, min:-180, max:180},
    {key:'scale', label:['縮放', '缩放', 'Scale'], value:Math.round((cur.scale || 1) * 100), min:1, max:1000},
    {key:'link', label:['與圖層連結', '与图层链接', 'Link with Layer'], type:'check', value:cur.link !== false}],
    v => CMD.run('ps.layer.layerStyle.patternOverlay', Object.assign({id:L.id}, v)));
  return UI_OPEN;
}
/* 斜面和浮雕挂进 ps-layer.js 的图层样式对话框（PS：左栏第一项；结构＋阴影两段）；等高线／纹理不在栏位里、照原值带着走 */
if (PsLayer.fxExt){
  const O = (v, a, b, c) => [v, [a, b, c]];
  PsLayer.fxExt.bevelEmboss = {
    name:['斜角和浮雕', '斜面和浮雕', 'Bevel & Emboss'],
    defaults:{style:'inner', technique:'smooth', depth:100, direction:'up', size:5, soften:0, angle:120, useGlobalLight:true, altitude:30,
      highlightBlend:'screen', highlightColor:'#ffffff', highlightOpacity:75, shadowBlend:'multiply', shadowColor:'#000000', shadowOpacity:75},
    spec:[
      ['style', [O('outer', '外斜角', '外斜面', 'Outer Bevel'), O('inner', '內斜角', '内斜面', 'Inner Bevel'), O('emboss', '浮雕', '浮雕效果', 'Emboss'), O('pillow', '枕狀浮雕', '枕状浮雕', 'Pillow Emboss'), O('stroke', '筆畫浮雕', '描边浮雕', 'Stroke Emboss')], 0, ['樣式', '样式', 'Style']],
      ['technique', [O('smooth', '平滑', '平滑', 'Smooth'), O('chiselHard', '雕鑿硬邊', '雕刻清晰', 'Chisel Hard'), O('chiselSoft', '雕鑿柔邊', '雕刻柔和', 'Chisel Soft')], 0, ['技術', '方法', 'Technique']],
      ['depth', 1, 1000, ['深度', '深度', 'Depth']],
      ['direction', [O('up', '上', '上', 'Up'), O('down', '下', '下', 'Down')], 0, ['方向', '方向', 'Direction']],
      ['size', 0, 250, ['尺寸', '大小', 'Size']], ['soften', 0, 16, ['柔化', '软化', 'Soften']],
      ['angle', -180, 180, ['角度', '角度', 'Angle']], ['useGlobalLight', 'k', 0, ['使用整體光源', '使用全局光', 'Use Global Light']], ['altitude', 0, 90, ['高度', '高度', 'Altitude']],
      ['highlightBlend', 'b', 0, ['亮部模式', '高光模式', 'Highlight Mode']], ['highlightColor', 'c', 0, ['亮部顏色', '高光颜色', 'Highlight Color']], ['highlightOpacity', 0, 100, ['不透明度', '不透明度', 'Opacity']],
      ['shadowBlend', 'b', 0, ['陰影模式', '阴影模式', 'Shadow Mode']], ['shadowColor', 'c', 0, ['陰影顏色', '阴影颜色', 'Shadow Color']], ['shadowOpacity', 0, 100, ['不透明度', '不透明度', 'Opacity']]],
    valuesOf:e => Object.assign({style:e.style, technique:e.technique, depth:Math.round(e.depth * 100), direction:e.up ? 'up' : 'down', size:e.size, soften:e.soften, angle:e.angle,
      useGlobalLight:e.useGlobalLight, altitude:e.altitude, highlightBlend:e.highlightBlend, highlightColor:e.highlightColor, highlightOpacity:Math.round(e.highlightOpacity * 100),
      shadowBlend:e.shadowBlend, shadowColor:e.shadowColor, shadowOpacity:Math.round(e.shadowOpacity * 100)},
      e.contour ? {contour:true, contourRange:Math.round(e.contour.range * 100)} : {},
      e.texture ? {texture:e.texture.pattern, textureScale:Math.round(e.texture.scale * 100), textureDepth:Math.round(e.texture.depth * 100), textureInvert:e.texture.invert, textureLink:e.texture.link} : {}),
    fromParams:p => bevelFromParams(p)
  };
}
/* ps-layer.js 的图层样式对话框按确定走 setAll＝整组换掉、只认八种：本档这两种没在里面的照留着；
   replaceExt:[种类]＝对话框有列这几种（斜面和浮雕）⇒ 那几种照对话框的（没勾＝拿掉），其余照留 */
{
  const c = CMD.map['ps.layer.layerStyle.setAll'];
  if (c && !c._ps2){ const run0 = c.run; c.run = p => {
    const L = layerOf(p); const keep = L && L.style && Array.isArray(L.style.items) ? L.style.items.filter(e => NEW_FX.includes(e.kind)) : [];
    const mine = (p.effects || []).filter(e => NEW_FX.includes(e.kind)), q = Object.assign({}, p, {effects:(p.effects || []).filter(e => !NEW_FX.includes(e.kind))});
    const managed = Array.isArray(p.replaceExt) ? p.replaceExt : null;
    const r = run0(q);
    if (r && r.ok === false || !L) return r;
    const conv = e => e.kind === 'bevelEmboss' ? bevelFromParams(e) : patternOverlayFromParams(e);
    let add; try { add = managed ? keep.filter(e => !managed.includes(e.kind) && !mine.some(m => m.kind === e.kind)).concat(mine.map(conv)) : mine.length ? mine.map(conv) : keep; } catch (e){ return fail(e.message); }
    L.style.items = L.style.items.concat(add);
    return r; }; c._ps2 = true; }
}
/* 缩放效果：斜面浮雕的大小／柔化、图案叠加的缩放也跟着缩（image_cmds.rs:60 scale_effects） */
{
  const c = CMD.map['ps.layer.layerStyle.scaleEffects'];
  if (c && !c._ps2){ const run0 = c.run; c.run = p => {
    const L = layerOf(p);
    if (L && !p.ui && hasFx2(L) && !has0(L)){                // 只有这两种效果时 ps-layer.js 会说「没有效果」：这里自己缩
      const k = clamp(num(p, 'scale', 100), 1, 1000) / 100;
      L.style.items.forEach(e => { if (e.kind === 'bevelEmboss'){ e.size *= k; e.soften *= k; } else if (e.kind === 'patternOverlay') e.scale = clamp(e.scale * k, 0.01, 10); });
      return {ok:true};
    }
    const r = run0(p);
    if (L && !p.ui && r && r.ok !== false){ const k = clamp(num(p, 'scale', 100), 1, 1000) / 100; L.style.items.forEach(e => { if (e.kind === 'bevelEmboss'){ e.size *= k; e.soften *= k; } else if (e.kind === 'patternOverlay') e.scale = clamp(e.scale * k, 0.01, 10); }); }
    return r; }; c._ps2 = true; }
}

/* ═══════════ 视频图层（engine/src/video_cmds.rs 全档＋timeline_cmds.rs）═══════════
   原码：视频图层＝普通像素层多带一叠影格（Layer.video），画面＝时间轴播放头那一格（sync）。
   我们：L.video = {frames:[影格 id|null（空白）…], fps, showAltered, source:{kind:'blank'|'files'|'urls', names, urls?}}；
   影格像素放在 FRAMES（id → 画布，只增不改，所以历史里只要记 id）；Doc.timeline = {fps, duration, current, workStart, workEnd}。
   在影格上画的东西：换格／改影格前先把画面收回成那一格的新影格（原码的 show_altered）。 */
const FRAMES = new Map(); let _fseq = 0;
function putFrame(src){ const c = mkCanvas(src.width, src.height); ctx2d(c).drawImage(src, 0, 0); const id = 'F' + (++_fseq) + '_' + Date.now().toString(36); FRAMES.set(id, c); return id; }
const tlOf = () => Doc.timeline || null;
function tlClamp(t){ t.duration = Math.max(1, t.duration | 0); t.fps = t.fps > 0 ? t.fps : 30; t.current = clamp(t.current | 0, 0, t.duration - 1); t.workStart = clamp(t.workStart | 0, 0, t.duration - 1); t.workEnd = clamp(t.workEnd === undefined ? t.duration : t.workEnd | 0, t.workStart + 1, t.duration); return t; }
const newTimeline = (duration, fps) => tlClamp({fps, duration, current:0, workStart:0, workEnd:duration});
function canvasHash(L){ const c = L.data.canvas; return hash8(L.data.ctx.getImageData(0, 0, c.width, c.height).data); }
/* 画面（可能被画过）收回成目前那一格 */
function capture(L){
  const v = L.video; if (!v || !v.frames.length) return;
  const cur = Math.min(tlOf() ? tlOf().current : 0, v.frames.length - 1);
  if (L._vidShown && L._vidShown.at === cur && L._vidShown.id === v.frames[cur] && L._vidShown.h === canvasHash(L)) return;   // 没画过
  const blank = alphaBox(L.data.canvas) === null;
  v.frames[cur] = blank ? null : putFrame(L.data.canvas);
  hide(L, '_vidShown', {at:cur, id:v.frames[cur], h:canvasHash(L)});   // 收过了：下次存档不再收一次（不然每次存档都换新影格 id ⇒ 签名一直变、自动存档停不下来）
}
/* video_cmds.rs:14 sync：每个视频图层的画面＝播放头那一格 */
function videoSync(){
  const cur = tlOf() ? tlOf().current : 0;
  Doc.layers.forEach(L => {
    const v = L.video; if (!v || !v.frames.length) return;
    const at = Math.min(cur, v.frames.length - 1), id = v.frames[at], c = L.data.canvas;
    L.data.ctx.clearRect(0, 0, c.width, c.height);
    const f = id && FRAMES.get(id); if (f) L.data.ctx.drawImage(f, 0, 0);
    Layer.invalidate(L);
    hide(L, '_vidShown', {at, id, h:canvasHash(L)});
  });
}
const videoLayer = p => { const L = layerOf(p); return L && L.video ? L : null; };
/* video_cmds.rs:47 edit_video：改目前视频层的影格（在播放头那一格），时间轴长度跟着影格数，再 sync */
function editVideo(p, f){
  const L = videoLayer(p); if (!L) return fail('select a video layer');
  capture(L);
  const t = tlOf() || (Doc.timeline = newTimeline(1, L.video.fps || 30));
  const r = f(L.video, t.current, L); if (r && r.ok === false) return r;
  const n = L.video.frames.length;
  t.duration = Math.max(t.duration, Math.max(n, 1)); t.workEnd = Math.max(t.workEnd, t.duration); tlClamp(t);
  videoSync();
  return {frames:n};
}
reg('layer.videoLayers.newBlankVideoLayer', '{name?} 新建空白视频图层（没有时间轴就建一条 1 格 30fps；影格数＝时间轴长度）→ {id}', p => {
  if (!tlOf()) Doc.timeline = newTimeline(1, 30);
  const t = tlOf(), L = Layer.raster((p.name && String(p.name).trim()) || nextName(L3('視訊圖層', '视频图层', 'Video Layer')));
  L.video = {frames:new Array(Math.max(1, t.duration)).fill(null), fps:t.fps, showAltered:true, source:{kind:'blank'}};
  insertAbove(L); videoSync();
  return {id:L.id, frames:L.video.frames.length};
});
reg('layer.videoLayers.insertBlankFrame', '{id?} 在播放头之后插入空白帧 → {frames}', p => editVideo(p, (v, cur) => { v.frames.splice(Math.min(cur + 1, v.frames.length), 0, null); }));
reg('layer.videoLayers.duplicateFrame', '{id?} 复制播放头那一帧（插在后面）→ {frames}', p => editVideo(p, (v, cur) => { if (cur < v.frames.length) v.frames.splice(cur + 1, 0, v.frames[cur]); }));
reg('layer.videoLayers.deleteFrame', '{id?} 删除播放头那一帧（至少留一帧）→ {frames}', p => editVideo(p, (v, cur) => { if (v.frames.length > 1 && cur < v.frames.length) v.frames.splice(cur, 1); }));
reg('layer.videoLayers.restoreFrame', '{id?} 恢复帧：播放头那一帧回到空白（原码 restore_frame）→ {frames}', p => editVideo(p, (v, cur) => { if (cur < v.frames.length) v.frames[cur] = null; }));
reg('layer.videoLayers.restoreAllFrames', '{id?} 恢复所有帧：每一帧回到空白 → {frames}', p => editVideo(p, v => { v.frames = v.frames.map(() => null); }));
reg('layer.videoLayers.showAlteredVideo', '{id?} 显示已改变的视频（切换旗标）→ {showAltered}', p => { const r = editVideo(p, v => { v.showAltered = !v.showAltered; }); const L = videoLayer(p); return r.ok === false ? r : {showAltered:!!(L && L.video.showAltered)}; });
function rasterizeVideo(p){ const L = videoLayer(p); if (!L) return fail('select a video layer'); capture(L); delete L.video; return {rasterized:true}; }
reg('layer.videoLayers.rasterize', '{id?} 栅格化视频：丢掉影格、留目前这一格成普通像素层', rasterizeVideo);
reg('layer.rasterize.video', '{id?} 栅格化 ▸ 视频（同 layer.videoLayers.rasterize）', rasterizeVideo);
reg('layer.videoLayers.interpretFootage', '{id?, fps} 解释素材：改视频层的帧速率' + UIP, p => {
  const L = videoLayer(p); if (!L) return fail('select a video layer');
  if (p.ui){ dialog('interpretFootage', ['解譯素材', '解释素材', 'Interpret Footage'], [{key:'fps', label:['影格速率', '帧速率', 'Frame Rate'], value:L.video.fps || 30, min:0.01, max:240}], v => CMD.run('ps.layer.videoLayers.interpretFootage', {id:L.id, fps:v.fps})); return UI_OPEN; }
  return editVideo(p, v => { if (isNum(+p.fps) && +p.fps > 0) v.fps = +p.fps; });
});
/* 读影格：浏览器没有路径 ⇒ 界面开档案挑选（可多选＝图片序列，照档名排序）；agent 给 urls（网址／dataURL） */
function loadImage(url){ return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error('load failed: ' + String(url).slice(0, 80))); im.src = url; }); }
async function framesFrom(urls){
  const out = [];
  for (const u of urls){ const im = await loadImage(u); const c = mkCanvas(Doc.width, Doc.height); ctx2d(c).drawImage(im, 0, 0); out.push(putFrame(c)); }   // flattened：贴在文件左上
  return out;
}
function pickFiles(){
  return new Promise(res => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true; inp.style.display = 'none';
    inp.onchange = () => { const fs = [...inp.files].sort((a, b) => a.name.localeCompare(b.name)); inp.remove(); res(fs); };
    document.body.appendChild(inp); inp.click();
  });
}
const fileURL = f => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
/* 非同步的命令：自己记一步历史（同 engine layer.addImageFromURL 的写法） */
async function asyncStep(fn){
  History.push();
  try { const r = await fn(); if (r && r.ok === false) History.past.pop(); if (window.UI) UI.refresh(); return r; }
  catch (e){ History.restoreInPlace(History.past.pop()); if (window.UI) UI.refresh(); return fail(e.message); }
}
async function sourceFrom(p){
  if (Array.isArray(p.urls) && p.urls.length) return {urls:p.urls.slice(), names:p.urls.map((u, i) => (String(u).startsWith('data:') ? 'frame' + (i + 1) : String(u).split('/').pop()))};
  if (p.ui){ const fs = await pickFiles(); if (!fs.length) return null; return {urls:await Promise.all(fs.map(fileURL)), names:fs.map(f => f.name), local:true}; }
  return null;
}
CMD.reg('ps.layer.videoLayers.newVideoLayerFromFile', {i18n:'', undoable:false, params:'{urls:[图片网址或 dataURL…]（一张＝1 帧；多张＝图片序列）, fps=30, name?} 从文件新建视频图层（浏览器版：界面开档案挑选，可多选）→ {id, frames}' + UIP}, p => asyncStep(async () => {
  const src = await sourceFrom(p || {}); if (!src) return fail('need `urls` (UI: pick image files)');
  const frames = await framesFrom(src.urls), n = frames.length, fps = isNum(+p.fps) && +p.fps > 0 ? +p.fps : 30;
  if (!tlOf()) Doc.timeline = newTimeline(n, fps); else { Doc.timeline.duration = Math.max(Doc.timeline.duration, n); tlClamp(Doc.timeline); }
  const L = Layer.raster((p.name && String(p.name).trim()) || nextName(String(src.names[0] || 'Video').replace(/\.[^.]*$/, '')));
  L.video = {frames, fps, showAltered:true, source:src.local ? {kind:'files', names:src.names} : {kind:'urls', names:src.names, urls:src.urls}};
  insertAbove(L); videoSync();
  return {id:L.id, frames:n};
}));
CMD.reg('ps.layer.videoLayers.replaceFootage', {i18n:'', undoable:false, params:'{id?, urls:[…]} 替换素材：整叠影格换成新的图片（序列）→ {frames}' + UIP}, p => asyncStep(async () => {
  const L = videoLayer(p || {}); if (!L) return fail('select a video layer');
  const src = await sourceFrom(p || {}); if (!src) return fail('need `urls` (UI: pick image files)');
  const frames = await framesFrom(src.urls);
  return editVideo({id:L.id}, v => { v.frames = frames; v.source = src.local ? {kind:'files', names:src.names} : {kind:'urls', names:src.names, urls:src.urls}; });
}));
CMD.reg('ps.layer.videoLayers.reloadFrame', {i18n:'', undoable:false, params:'{id?} 重新载入帧：从素材来源（agent 给过的 urls）整叠重读；本机挑的档浏览器读不回来 → {frames}'}, p => asyncStep(async () => {
  const L = videoLayer(p || {}); if (!L) return fail('not a video layer');
  const s = L.video.source || {}; if (s.kind !== 'urls' || !s.urls) return fail('this layer has no file source to reload');
  const frames = await framesFrom(s.urls);
  return editVideo({id:L.id}, v => { v.frames = frames; });
}));
/* timeline_cmds.rs：时间轴（导航不进历史） */
function withTimeline(f){ Doc.layers.forEach(L => { if (L.video) capture(L); }); f(); if (Doc.timeline) tlClamp(Doc.timeline); videoSync(); if (window.UI) UI.refresh(); return tlInfo(); }
const tlInfo = () => ({timeline:Doc.timeline ? Object.assign({}, Doc.timeline, {time:Doc.timeline.current / Doc.timeline.fps}) : null});
reg('timeline.create', '{duration=30, fps=30} 建立视频时间轴 → {timeline}', p => withTimeline(() => { Doc.timeline = newTimeline(num(p, 'duration', 30) | 0, num(p, 'fps', 30)); }), false);
reg('timeline.delete', '{} 删除时间轴', () => withTimeline(() => { Doc.timeline = null; }), false);
reg('timeline.setFrame', '{frame} 跳到第几帧（0 起）→ {timeline}', p => { if (!tlOf()) return fail('no timeline (create one first)'); if (!isNum(+p.frame) || p.frame === undefined) return fail('need `frame`'); return withTimeline(() => { Doc.timeline.current = +p.frame | 0; }); }, false);
reg('timeline.nextFrame', '{} 下一帧', () => tlOf() ? withTimeline(() => { Doc.timeline.current = Math.min(Doc.timeline.current + 1, Doc.timeline.duration - 1); }) : fail('no timeline (create one first)'), false);
reg('timeline.previousFrame', '{} 上一帧', () => tlOf() ? withTimeline(() => { Doc.timeline.current = Math.max(Doc.timeline.current - 1, 0); }) : fail('no timeline (create one first)'), false);
reg('timeline.setProps', '{fps?, duration?, workStart?, workEnd?} 时间轴设定', p => tlOf() ? withTimeline(() => { ['fps', 'duration', 'workStart', 'workEnd'].forEach(k => { if (isNum(+p[k]) && p[k] !== undefined) Doc.timeline[k] = +p[k]; }); }) : fail('no timeline (create one first)'), false);
reg('timeline.info', '{} 时间轴资讯 → {timeline}', () => tlInfo(), false);
/* 时间轴进历史（新建视频图层会建它）、工程档带影格像素 */
if (!History._ps2TlShim){
  const s0 = History.snap, r0 = History.restore, ri0 = History.restoreInPlace;
  const put = s => { if (s && s.ps2Timeline !== undefined){ Doc.timeline = s.ps2Timeline ? Object.assign({}, s.ps2Timeline) : null; } };
  History.snap = function(){ const s = s0.apply(this, arguments); s.ps2Timeline = Doc.timeline ? Object.assign({}, Doc.timeline) : null; return s; };
  History.restore = function(s){ const r = r0.apply(this, arguments); put(s); return r; };
  History.restoreInPlace = function(s){ const r = ri0.apply(this, arguments); put(s); return r; };
  History._ps2TlShim = true;
}
{ const reset0 = Doc.reset; Doc.reset = function(){ this.timeline = null; return reset0.apply(this, arguments); }; }
{
  const ser0 = Project.serialize, load0 = Project.load;
  Project.serialize = function(){
    Doc.layers.forEach(L => { if (L.video) capture(L); });         // 先把画过的影格收回来，再存
    const j = ser0.apply(this, arguments);
    if (Doc.timeline) j.timeline = Object.assign({}, Doc.timeline);
    // 影格像素：跟像素层同一份票号快取（影格只增不改 ⇒ 存过的下次沿用；统计记 'frame:'+影格 id）
    const enc = (c, id) => Project.encodeExtra ? Project.encodeExtra(c, 'frame:' + id) : c.toDataURL('image/png');
    const vf = {}; Doc.layers.forEach(L => { if (L.video) L.video.frames.forEach(id => { if (id && FRAMES.has(id) && !vf[id]) vf[id] = enc(FRAMES.get(id), id); }); });
    if (Object.keys(vf).length) j.videoFrames = vf;
    return j;
  };
  // serializeAsync 先用 toBlob 编好影格；签名带上影格库里这些影格的像素票号（影格存在 Doc 外面的 FRAMES）
  const usedFrames = () => { const out = []; Doc.layers.forEach(L => { if (L.video) L.video.frames.forEach(id => { if (id && FRAMES.has(id)) out.push([id, FRAMES.get(id)]); }); }); return out; };
  if (Array.isArray(Project.asyncCanvases)) Project.asyncCanvases.push(() => { Doc.layers.forEach(L => { if (L.video) capture(L); }); return usedFrames().map(x => x[1]); });
  if (window.SiteHooks && Array.isArray(SiteHooks.extraSigs)) SiteHooks.extraSigs.push(() => 'vf:' + usedFrames().map(([id, c]) => id + '@' + (c.__dlPx || 0)).join(','));
  Project.load = async function(json){
    if (json && json.videoFrames) for (const [id, url] of Object.entries(json.videoFrames)){ try { const im = await loadImage(url); const c = mkCanvas(im.width, im.height); ctx2d(c).drawImage(im, 0, 0); FRAMES.set(id, c); } catch (_){ } }
    const r = await load0.apply(this, arguments);
    Doc.timeline = json && json.timeline ? tlClamp(Object.assign({}, json.timeline)) : null;
    videoSync();
    return r;
  };
}

/* ═══════════ 图层面板（PS）：底部按钮列「fx／添加图层蒙版／创建新的填充或调整图层／创建新组」、⌥ 点两层交界＝创建／释放剪贴蒙版、剪贴层列标示 ═══════════
   按钮一律走现有命令（跟菜单同一条路）；ui.js 的 drawLayerList 包一层补剪贴标示（不改 ui.js 本体） */
const FOOT_FILL = [['solidColor', ['純色…', '纯色…', 'Solid Color…']], ['gradient', ['漸層…', '渐变…', 'Gradient…']], ['pattern', ['圖樣…', '图案…', 'Pattern…']]];
const FOOT_ADJ = [['brightnessContrast'], ['levels'], ['curves'], ['exposure'], null, ['vibrance'], ['hueSaturation'], ['colorBalance'], ['blackWhite'], ['photoFilter'], ['channelMixer'], ['colorLookup'], null,
  ['invert'], ['posterize'], ['threshold'], ['gradientMap'], ['selectiveColor']];
const FOOT_FX = [['blendingOptions', ['混合選項…', '混合选项…', 'Blending Options…']], null, ['bevelEmboss', ['斜角和浮雕…', '斜面和浮雕…', 'Bevel & Emboss…']], ['stroke', ['筆畫…', '描边…', 'Stroke…']],
  ['innerShadow', ['內陰影…', '内阴影…', 'Inner Shadow…']], ['innerGlow', ['內光暈…', '内发光…', 'Inner Glow…']], ['satin', ['緞面…', '光泽…', 'Satin…']], ['colorOverlay', ['顏色覆蓋…', '颜色叠加…', 'Color Overlay…']],
  ['gradientOverlay', ['漸層覆蓋…', '渐变叠加…', 'Gradient Overlay…']], ['patternOverlay', ['圖樣覆蓋…', '图案叠加…', 'Pattern Overlay…']], ['outerGlow', ['外光暈…', '外发光…', 'Outer Glow…']], ['dropShadow', ['陰影…', '投影…', 'Drop Shadow…']]];
const footNotify = r => { if (r && r.ok === false && r.error && !r.dialog && window.Locks && Locks.notify) Locks.notify(r.error); return r; };
function closeFootMenu(){ document.querySelectorAll('.psl2-menu').forEach(m => m.remove()); }
function footMenu(btn, items){
  closeFootMenu();
  const m = document.createElement('div'); m.className = 'psl2-menu';
  items.forEach(it => {
    if (!it){ m.appendChild(Object.assign(document.createElement('div'), {className:'sep'})); return; }
    const d = document.createElement('div'); d.className = 'it'; d.dataset.item = it.id; d.textContent = it.label;
    d.onclick = e => { e.stopPropagation(); closeFootMenu(); try { footNotify(it.run()); } catch (err){ console.error(err); } };
    m.appendChild(d);
  });
  document.body.appendChild(m);
  const b = btn.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(innerWidth - m.offsetWidth - 4, b.left)) + 'px';
  m.style.top = Math.max(4, b.top - m.offsetHeight - 2) + 'px';             // PS：往上展开
  setTimeout(() => document.addEventListener('pointerdown', function off(e){ if (!m.contains(e.target)){ closeFootMenu(); document.removeEventListener('pointerdown', off, true); } }, true), 0);
  return m;
}
const FOOT = {
  fx(btn){
    return footMenu(btn, FOOT_FX.map(x => x && {id:x[0], label:L3(...x[1]), run:() => { const L = Doc.active(); if (!L) return fail('no active layer');
      if (x[0] === 'bevelEmboss' && PsLayer.fxExt && PsLayer.fxExt.bevelEmboss && PsLayer.openStyleDialog){ PsLayer.openStyleDialog(L, 'bevelEmboss'); return {ok:true, dialog:'opened'}; }   // PS：fx ▸ 斜面和浮雕＝图层样式对话框停在那页
      const id = 'ps.layer.layerStyle.' + x[0]; return CMD.map[id] ? CMD.run(id, {id:L.id, ui:true}) : fail('missing ' + id); }}));
  },
  /* 添加图层蒙版（PS）：有选区＝显示选区（⌥＝隐藏选区）、没选区＝显示全部（⌥＝隐藏全部）；已经有图层蒙版＝加矢量蒙版 */
  mask(btn, e){
    const L = Doc.active(); if (!L) return fail('no active layer');
    const alt = !!(e && e.altKey);
    if ((L.mask || L.maskOff) && !L.vmask) return CMD.run(alt ? 'ps.layer.vectorMask.hideAll' : 'ps.layer.vectorMask.revealAll', {id:L.id});
    if (L.mask || L.maskOff) return fail('the layer already has a layer mask and a vector mask');
    return CMD.run(Doc.sel ? (alt ? 'ps.layer.layerMask.hideSelection' : 'ps.layer.layerMask.revealSelection') : (alt ? 'ps.layer.layerMask.hideAll' : 'ps.layer.layerMask.revealAll'), {id:L.id});
  },
  adj(btn){
    const items = FOOT_FILL.map(([k, n]) => ({id:'fill.' + k, label:L3(...n), run:() => CMD.run('ps.layer.newFillLayer.' + k, {ui:true})})).concat([null],
      FOOT_ADJ.map(x => x && {id:'adj.' + x[0], label:L3(...ADJ_NAME[x[0]]) + '…', run:() => {
        const r = CMD.run('ps.layer.newAdjustmentLayer.' + x[0], {});
        if (r && r.ok !== false && window.DlPanels && DlPanels.open) DlPanels.open('properties');   // PS：建好调整层就在属性面板调
        return r; }}));
    return footMenu(btn, items);
  },
  group(){ return CMD.run('ps.layer.new.group', {}); }
};
function buildFoot(){
  const bar = document.querySelector('.layerbtns'); if (!bar || bar.querySelector('[data-lb]')) return;
  const tips = {fx:['增加圖層樣式', '添加图层样式', 'Add a layer style'], mask:['增加圖層遮色片', '添加图层蒙版', 'Add layer mask'], adj:['建立新填色或調整圖層', '创建新的填充或调整图层', 'Create new fill or adjustment layer'], group:['建立新群組', '创建新组', 'Create a new group']};
  const first = bar.firstElementChild;
  const sv = d => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle">${d}</svg>`;
  [['fx', 'fx'], ['mask', sv('<rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>')],
   ['adj', sv('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>')],
   ['group', sv('<path d="M3 6h7l2 2h9v11H3z"/>')]].forEach(([k, ic]) => {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.lb = k; if (k === 'fx') b.textContent = ic; else b.innerHTML = ic; b.title = L3(...tips[k]);
    b.addEventListener('mouseenter', () => { b.title = L3(...tips[k]); });   // 换语言后提示跟着换（按钮在启动时就建好了）
    if (k === 'fx') b.style.cssText = 'font-style:italic;font-weight:bold';
    b.onclick = e => { e.stopPropagation(); try { footNotify(FOOT[k](b, e)); } catch (err){ console.error(err); } };
    bar.insertBefore(b, first);
  });
}
/* ⌥＋点两层的交界（PS：游标变剪贴图示）＝上面那层剪贴到下面那层；已剪贴＝释放 */
const CLIP_EDGE = 6;
function clipEdgeAt(e){
  const row = e.target && e.target.closest && e.target.closest('#layerList .lrow[data-id]'); if (!row || row.classList.contains('sfrow')) return null;
  const rows = [...document.querySelectorAll('#layerList .lrow[data-id]:not(.sfrow)')].filter(r => r.style.display !== 'none'), i = rows.indexOf(row), b = row.getBoundingClientRect();
  if (e.clientY - b.top <= CLIP_EDGE && i > 0) return {upper:rows[i - 1].dataset.id, lower:row.dataset.id};
  if (b.bottom - e.clientY <= CLIP_EDGE && i + 1 < rows.length) return {upper:row.dataset.id, lower:rows[i + 1].dataset.id};
  return null;
}
function clipAt(e){
  const h = clipEdgeAt(e); if (!h) return null;
  const U = Doc.byId(h.upper); if (!U) return null;
  return footNotify(CMD.run(U.clipped ? 'ps.layer.releaseClippingMask' : 'ps.layer.createClippingMask', {id:U.id}));
}
(function hookLayerList(){
  const box = document.getElementById('layerList');
  if (box && !box._ps2clip){
    box._ps2clip = true;
    box.addEventListener('click', e => { if (!e.altKey || e.ctrlKey || e.metaKey) return; if (e.target.closest && e.target.closest('.eye,.tw')) return;
      if (clipEdgeAt(e)){ e.stopPropagation(); e.preventDefault(); clipAt(e); } }, true);
    box.addEventListener('mousemove', e => { const r = e.target.closest && e.target.closest('#layerList .lrow'); if (r) r.style.cursor = e.altKey && clipEdgeAt(e) ? 'alias' : ''; });
  }
  if (!document.getElementById('psl2-foot-css')){
    const st = document.createElement('style'); st.id = 'psl2-foot-css';
    st.textContent = `.psl2-menu{position:fixed;z-index:10040;background:#2b2f36;color:#e6e8eb;border:1px solid #444a55;border-radius:4px;padding:4px 0;font:12px sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.45);min-width:150px}
.psl2-menu .it{padding:3px 16px;cursor:pointer;white-space:nowrap}.psl2-menu .it:hover{background:#2f7fd8;color:#fff}.psl2-menu .sep{height:1px;background:#444a55;margin:4px 0}
#layerList .lrow .clipmark{flex:0 0 12px;width:12px;text-align:center;opacity:.85;font-size:12px}#layerList .lrow.clipbase .nm{text-decoration:underline}`;
    document.head.appendChild(st);
  }
  buildFoot();
})();
/* 图层列：剪贴层前面一个 ↓（缩进），基底层名字加底线（PS） */
function decorateClipRows(){
  document.querySelectorAll('#layerList .lrow[data-id]:not(.sfrow)').forEach(row => {
    const L = Doc.byId(row.dataset.id); if (!L) return;
    if (baseOf(L)){
      row.classList.add('clipped');
      const th = row.querySelector('canvas.thumb'), m = document.createElement('span'); m.className = 'clipmark'; m.textContent = '↓'; m.title = L3('剪裁遮色片', '剪贴蒙版', 'Clipping mask');
      if (th) th.before(m); else row.appendChild(m);
    } else if (visibleMembers(L).length || membersOf(L).length) row.classList.add('clipbase');
  });
}
/* 图像 ▸ 画布大小：调整／填充图层是「整张文件」的内容 ⇒ 跟着新画布摆回 (0,0)；它们的蒙版扩成新画布大小，
   新长出来的地方照蒙版的预设色 M.defaultColor（PsMaskFill.white；旧档没存才看四边），同 PS */
function hookCanvasSize(){
  const c = CMD.map['ps.image.canvasSize']; if (!c || c.__ps2Mask) return;
  const run0 = c.run;
  c.run = function(p){
    // 先记下调整／填充层蒙版原来的样子（画布大小那支会把蒙版画布扩大、新的地方留透明＝藏起来）
    const before = new Map();
    Doc.layers.forEach(L => { const M = L.mask; if ((L.adjust || L.fillLayer) && M && M.data && M.data.canvas){
      const o = M.data.canvas, k = mkCanvas(o.width, o.height); ctx2d(k).drawImage(o, 0, 0);
      before.set(L.id, {copy:k, at:[(L.x || 0) + (M.x || 0), (L.y || 0) + (M.y || 0)], reveal:window.PsMaskFill && PsMaskFill.white ? PsMaskFill.white(M) : ctx2d(k).getImageData(0, 0, 1, 1).data[3] > 127}); } });
    const r = run0.apply(this, arguments);
    if (r && r.ok !== false) Doc.layers.forEach(L => {
      if (!(L.adjust || L.fillLayer)) return;
      const b = before.get(L.id), M = L.mask, off = Array.isArray(r.offset) ? r.offset : [0, 0];
      if (b && M && M.data){
        const n = mkCanvas(Doc.width, Doc.height), nx = ctx2d(n), x0 = b.at[0] + off[0], y0 = b.at[1] + off[1];
        if (b.reveal){ nx.fillStyle = '#ffffff'; nx.fillRect(0, 0, n.width, n.height); nx.clearRect(x0, y0, b.copy.width, b.copy.height); }
        nx.drawImage(b.copy, x0, y0);
        M.data = {canvas:n, ctx:nx}; M.x = 0; M.y = 0; M._cache = null; M._cacheScale = 0;
      }
      L.x = 0; L.y = 0;
      if (L.fillLayer){ hide(L, '_fillKey', null); ensureFill(L); }
      Layer.invalidate(L);
    });
    return r;
  };
  c.__ps2Mask = true;
}
function hookUIList(){
  hookCanvasSize();
  if (!window.UI || UI.__ps2ClipHook) return;
  UI.__ps2ClipHook = true;
  const list = UI.drawLayerList;
  UI.drawLayerList = function(){ const r = list.apply(this, arguments); try { decorateClipRows(); } catch (e){ console.error(e); } return r; };
}
if (window.UI) hookUIList(); else window.addEventListener('DOMContentLoaded', hookUIList);

/* 对外（菜单 checked、测试） */
window.PsLayer2 = {
  FOOT, buildFoot, defaultMask, ADJ_KINDS, special, baseOf, membersOf, adjObj, ensureFill, bakeFill, fillFrame, maskValues, vmaskCanvas, openAdjustDialog, openFillDialog, closeDialog, sliceList,
  active: () => Doc.active(),
  clipped: () => { const L = Doc.active(); return !!(L && L.clipped); },
  maskLinked: () => { const L = Doc.active(); return !!(L && (L.mask || L.maskOff) && L.maskLinked !== false); },
  vmaskEnabled: () => { const L = Doc.active(); return !!(L && L.vmask && L.vmask.enabled !== false); },
  vmaskLinked: () => { const L = Doc.active(); return !!(L && L.vmask && L.vmask.linked !== false); },
  showAltered: () => { const L = Doc.active(); return !!(L && L.video && L.video.showAltered); },
  frames: FRAMES, videoSync, capture,
  /* 档尾那段（组／画板／智能对象／智能滤镜，另一个 IIFE）共用的小工具 */
  _h: {L3, fail, clamp, isNum, num, bool, mkCanvas, ctx2d, clone, hide, layerOf, fgHex, bgHex, UI_OPEN, UIP, hexOf, nextName, insertAbove, dialog, closeDialog, reg, asyncStep, alphaBox, pickFiles, fileURL, loadImage, sourceFrom}
};
if (window.UI && UI.refresh) UI.refresh();
})();

/* ═══════════════════════════════════════════════════════════════════════════
   图层组／画板／画框／智能对象／智能滤镜：图层菜单里这几类共 41 项＋滤镜 ▸ 转换为智能滤镜。
   资料模型与合成在 engine.js（Groups、Smart、SmartStore；图层面板树状在 ui.js），这里是命令（ps.<原码 id>）与对话框。照 photocraft 原码：
   - engine/src/commands.rs        397-405 layer.new.group；660-697 layer.moveTo（engine.js 登记）
   - engine/src/layer_multi_cmds.rs 27-33 top_level；370-376 layer_bounds；614-638 group_layers（新建 ▸ 从图层建立组 与 图层编组 同一支）
   - engine/src/extra_cmds.rs      423-443 ungroup；457-531 content_pixels／rasterize_one（栅格化 ▸ 智能对象）
   - engine/src/artboard_cmds.rs   1-260 PRESETS／GAP／fit_canvas／next_artboard_name／set_artboard／new_artboard／artboard_from_group／artboard_from_layers／set_props
   - engine/src/frame_cmds.rs      14-55 clip_mask／frame_from_layers（编组＋组上一张只露框内的蒙版）
   - engine/src/smart_cmds.rs      452-532 layer_to_smart／convert；536-555 via_copy；557-590 set_source／replace_contents／export_contents；592-645 edit_contents／commit_child；
                                   652-672 update_all；674-761 智能滤镜编辑；763-934 enablement 与命令表
   - engine/src/layer_menu_cmds.rs 313-341 stack_mode；344-370 reveal_in_finder
   - engine/src/warp_cmds.rs       113-150 warp_layer 的 Smart 分支、204-228 apply；distort_cmds.rs 230-262 run_on_layer（智能对象的操控／透视变形＝记成智能滤镜）
   - engine/src/filters.rs:219     滤镜碰到智能对象 ⇒ add_smart_filter（smart_cmds.rs:354；有选区＝滤镜蒙版）
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
if (window.PsLayer3) return;
if (!window.PsLayer2 || !PsLayer2._h || !window.Groups || !window.Smart){ console.error('ps-layer2.js 缺少 engine.js 的 Groups／Smart'); return; }
const {L3, fail, clamp, num, mkCanvas, ctx2d, clone, layerOf, UI_OPEN, UIP, nextName, dialog, reg, asyncStep, alphaBox} = PsLayer2._h;
const isGroup = L => !!L && L.kind === 'group';
const isSmart = L => !!L && L.kind === 'smart';
const NOTP = ['id', 'layer', 'layerId', 'ui', 'dialog', 'ids'];
const cleanP = p => { const o = {}; Object.keys(p || {}).forEach(k => { if (!NOTP.includes(k) && p[k] !== undefined) o[k] = clone(p[k]); }); return o; };
const smartOf = p => { const L = layerOf(p); return isSmart(L) ? L : null; };
const notSmart = () => fail('the active layer is not a smart object');
const pk = L => (L && L.parent !== undefined) ? L.parent : null;
/* 文件里第一次出现组之前：把每层的 parent 定成 null（顶层），之后 normalize 才不会去猜 */
const pinParents = () => { if (!Groups.any()) Doc.layers.forEach(L => { if (L.parent === undefined) L.parent = null; }); };
const refresh = () => { if (window.UI) UI.refresh(); };

/* layer_multi_cmds.rs:370 layer_bounds：不透明像素的外框（组＝子层联集）→ {x,y,w,h}｜null */
function boundsOf(L){
  if (!L) return null;
  if (isGroup(L)){
    let r = null;
    Groups.children(L).forEach(C => { const b = boundsOf(C); if (!b) return; if (!r) r = b; else { const x0 = Math.min(r.x, b.x), y0 = Math.min(r.y, b.y); r = {x:x0, y:y0, w:Math.max(r.x + r.w, b.x + b.w) - x0, h:Math.max(r.y + r.h, b.y + b.h) - y0}; } });
    return r;
  }
  const raster = L.kind === 'raster', c = raster ? L.data.canvas : renderLayer(L, 1);
  const b = alphaBox(c); if (!b) return null;
  return raster ? {x:b.x + L.x, y:b.y + L.y, w:b.w, h:b.h} : b;
}
const unionB = (a, b) => !a ? b : !b ? a : (() => { const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y); return {x:x0, y:y0, w:Math.max(a.x + a.w, b.x + b.w) - x0, h:Math.max(a.y + a.h, b.y + b.h) - y0}; })();
/* 选中的层（ids ＞ id ＞ Doc.selectedIds ＞ 当前层）→ top_level：祖先也被选了的不算（选了组＝连子层），由下到上 */
function selectedIds(p){
  let ids = Array.isArray(p.ids) && p.ids.length ? p.ids.slice() : (p.id || p.layer || p.layerId) ? [p.id || p.layer || p.layerId]
          : (window.PsLayer && PsLayer.idsOf ? PsLayer.idsOf({}) : (Doc.activeId ? [Doc.activeId] : []));
  ids = [...new Set(ids)].filter(id => Doc.byId(id));
  const set = new Set(ids);
  return ids.filter(id => !Groups.ancestors(Doc.byId(id)).some(G => set.has(G.id))).sort((a, b) => Doc.index(a) - Doc.index(b));
}
const blendOpts = withPass => (withPass ? ['passThrough'] : []).concat(BLENDS).map(b => [b, Lang.t('blend.' + b)]);

/* ═══════════ 图层组 ═══════════ */
const groupBase = () => L3('群組', '组', 'Group');
/* group_layers：在最上面那层之上插一个组（同一个父），选中的层按原来的先后搬进去；当前层＝新组 */
function groupLayers(ids, name){
  if (!ids.length) return null;
  pinParents();
  const Ls = ids.map(id => Doc.byId(id)), top = Ls[Ls.length - 1];
  const G = Layer.group(name || nextName(groupBase()));
  G.parent = pk(top);
  Doc.layers.splice(Doc.index(top.id) + 1, 0, G);
  Ls.forEach(L => { L.parent = G.id; });
  Groups.rebuild(Groups.tree());
  Doc.activeId = G.id; Doc.selectedIds = null;
  return G;
}
function applyGroupOpts(G, p){
  if (p.blend !== undefined){ if (!['passThrough', ...BLENDS].includes(p.blend)) return `unknown blend mode \`${p.blend}\``; G.blend = p.blend; }
  if (p.opacity !== undefined){ const o = +p.opacity; G.opacity = clamp(o > 1 ? o / 100 : o, 0, 1); }
  return null;
}
/* PS「新建组」对话框：名称／模式／不透明度 */
function groupDialog(cmd, extra){
  dialog('newGroup', ['新增群組', '新建组', 'New Group'], [
    {key:'name', label:['名稱', '名称', 'Name'], type:'text', value:nextName(groupBase())},
    {key:'blend', label:['模式', '模式', 'Mode'], type:'select', value:'passThrough', options:blendOpts(true)},
    {key:'opacity', label:['不透明度 (%)', '不透明度 (%)', 'Opacity (%)'], value:100, min:0, max:100}
  ], v => CMD.run(cmd, Object.assign({}, extra || {}, {name:v.name, blend:v.blend, opacity:v.opacity / 100})));
  return UI_OPEN;
}
reg('layer.new.group', '{name?="组 N", blend?="passThrough", opacity?:0..1} 新建组（空的、插在当前层之上＝当前层的兄弟；commands.rs:397）→ {id, layer}' + UIP, p => {
  if (p.ui) return groupDialog('ps.layer.new.group');
  pinParents();
  const G = Layer.group(p.name || nextName(groupBase()));
  const e = applyGroupOpts(G, p); if (e) return fail(e);
  const A = Doc.active(), i = A ? Doc.index(A.id) : Doc.layers.length - 1;
  G.parent = A ? pk(A) : null;
  Doc.layers.splice(i + 1, 0, G);
  Groups.rebuild(Groups.tree()); Doc.activeId = G.id; Doc.selectedIds = null;
  return {id:G.id, layer:G.id};
});
const groupFrom = p => {
  const ids = selectedIds(p); if (!ids.length) return fail('no layer selected');
  const G = groupLayers(ids, p.name);
  const e = applyGroupOpts(G, p); if (e) return fail(e);
  return {id:G.id, layer:G.id, children:Groups.children(G).map(C => C.id)};
};
reg('layer.new.groupFromLayers', '{ids?|id?（缺省＝选中的层／当前层）, name?, blend?, opacity?} 从图层建立组（同 图层编组；layer_multi_cmds.rs:614 group_layers）→ {id, children}' + UIP, p => p.ui ? groupDialog('ps.layer.new.groupFromLayers', p.ids ? {ids:p.ids} : null) : groupFrom(p));
reg('layer.groupLayers', '{ids?|id?（缺省＝选中的层／当前层）, name?} 图层编组 Ctrl+G：选中的层搬进一个新组（组插在最上面那层的位置）→ {id, children}', groupFrom);
/* extra_cmds.rs:423 ungroup：子层照原顺序放回组的位置（组的父底下），组拿掉；当前层＝最上面那个子层 */
reg('layer.ungroupLayers', '{id?} 取消图层编组 Ctrl+Shift+G：当前组的子层搬出来放在组的位置、组删掉 → {ok, children}', p => {
  const G = layerOf(p); if (!isGroup(G)) return fail('the active layer is not a group');
  const kids = Groups.children(G);
  kids.forEach(k => { k.parent = pk(G); });
  Doc.layers.splice(Doc.index(G.id), 1);
  Groups.rebuild(Groups.tree());
  Doc.activeId = kids.length ? kids[kids.length - 1].id : (Doc.layers.length ? Doc.layers[Doc.layers.length - 1].id : null);
  Doc.selectedIds = null;
  return {ok:true, children:kids.map(k => k.id)};
});

/* ═══════════ 画板（artboard_cmds.rs：画板＝顶层组＋data.artboard；合成在 engine Groups.draw）═══════════ */
const PRESETS = [['iPhone 14', 390, 844], ['iPhone 14 Pro Max', 430, 932], ['Android 1080p', 360, 640], ['iPad Pro 12.9', 1024, 1366], ['Web 1280', 1280, 800],
  ['Web 1366', 1366, 768], ['Web 1920', 1920, 1080], ['Instagram Post', 1080, 1080], ['Letter', 612, 792], ['A4', 595, 842]];
const GAP = 100;                                                     // 新画板跟最右边那块之间的空（PS）
const artboards = () => Doc.layers.filter(L => isGroup(L) && L.data && L.data.artboard && !Groups.parentOf(L));
const abName = () => L3('工作區域', '画板', 'Artboard');
function nextArtboardName(){ const names = artboards().map(A => A.name); for (let n = 1; ; n++){ const s = abName() + ' ' + n; if (!names.includes(s)) return s; } }
/* fit_canvas：画布往右／往下长到放得下每一块画板 */
function fitCanvas(){
  let w = Doc.width, h = Doc.height;
  artboards().forEach(A => { const r = A.data.artboard.rect; w = Math.max(w, r[0] + r[2]); h = Math.max(h, r[1] + r[3]); });
  w = clamp(Math.round(w), 1, 300000); h = clamp(Math.round(h), 1, 300000);
  if (w !== Doc.width || h !== Doc.height){ Doc.width = w; Doc.height = h; if (window.UI) UI.fit(); }
}
/* background_param：white|black|transparent|custom（＋color）→ 存 'white'|'black'|'transparent'|'#rrggbb' */
function bgParam(p){
  const custom = p.color !== undefined ? (PsLayer2._h.hexOf(p.color, null) || '#ffffff') : null;
  if (p.background === undefined || p.background === null) return {v:custom};
  if (p.background === 'white' || p.background === 'black' || p.background === 'transparent') return {v:p.background};
  if (p.background === 'custom' || p.background === 'other') return {v:custom || 'white'};
  const hx = PsLayer2._h.hexOf(p.background, null); if (hx) return {v:hx};
  return {error:`unknown background \`${p.background}\` (white|black|transparent|custom)`};
}
/* rect_param：rect:[x,y,w,h] 或 x/y/width/height 盖在 base 上 */
function rectParam(p, base){
  if (Array.isArray(p.rect)){
    const v = p.rect.map(x => Math.round(+x));
    if (v.length !== 4 || v.some(x => !isFinite(x)) || v[2] <= 0 || v[3] <= 0) return {error:'"rect" must be [x, y, width, height] with a positive size'};
    return {r:v};
  }
  const g = (k, d) => (p[k] !== undefined && p[k] !== null && isFinite(+p[k])) ? Math.round(+p[k]) : d;
  const r = [g('x', base[0]), g('y', base[1]), g('width', base[2]), g('height', base[3])];
  if (r[2] <= 0 || r[3] <= 0) return {error:'the artboard size must be positive'};
  return {r};
}
function setArtboard(G, a){ G.data.artboard = a; G.data.expanded = true; delete G.clipped; }   // 画板跟穿透组一样合成
function artboardDialog(cmd, extra, withSize){
  const fields = [{key:'name', label:['名稱', '名称', 'Name'], type:'text', value:nextArtboardName()}];
  if (withSize) fields.push(
    {key:'preset', label:['文件類型', '画板预设', 'Preset'], type:'select', value:'', options:[['', L3('自訂', '自定', 'Custom')]].concat(PRESETS.map(q => [q[0], `${q[0]}（${q[1]}×${q[2]}）`]))},
    {key:'width', label:['寬度', '宽度', 'Width'], value:Doc.width, min:1, max:30000},
    {key:'height', label:['高度', '高度', 'Height'], value:Doc.height, min:1, max:30000});
  fields.push({key:'background', label:['工作區域背景', '画板背景', 'Artboard Background'], type:'select', value:'white',
    options:[['white', ['白色', '白色', 'White']], ['black', ['黑色', '黑色', 'Black']], ['transparent', ['透明', '透明', 'Transparent']]]});
  dialog('newArtboard', ['新增工作區域', '新建画板', 'New Artboard'], fields, v => {
    const q = Object.assign({}, extra || {}, {name:v.name, background:v.background});
    if (withSize){ if (v.preset) q.preset = v.preset; else { q.width = v.width; q.height = v.height; } }
    return CMD.run(cmd, q);
  });
  return UI_OPEN;
}
reg('layer.new.artboard', '{preset?:"' + PRESETS.map(q => q[0]).join('|') + '", rect?:[x,y,w,h] | x?,y?,width?,height?（缺省＝文件大小，放在最右边那块画板右边 100px；没有画板＝0,0）, background?:"white|black|transparent|custom"="white", color?:"#rrggbb", name?="画板 N"} '
  + '新建画板（顶层组＋板框；画布往右下长到放得下；artboard_cmds.rs:154）→ {id, rect}' + UIP, p => {
  if (p.ui) return artboardDialog('ps.layer.new.artboard', null, true);
  const preset = p.preset ? String(p.preset) : '';
  let pw = Doc.width, ph = Doc.height;
  if (preset){ const q = PRESETS.find(x => x[0].toLowerCase() === preset.toLowerCase()); if (!q) return fail(`unknown preset \`${preset}\``); pw = q[1]; ph = q[2]; }
  const abs = artboards();
  const base = abs.length ? [Math.max(...abs.map(A => A.data.artboard.rect[0] + A.data.artboard.rect[2])) + GAP, Math.min(...abs.map(A => A.data.artboard.rect[1])), pw, ph] : [0, 0, pw, ph];
  const rr = (!preset || p.rect) ? rectParam(p, base) : rectParam({x:p.x, y:p.y}, base);
  if (rr.error) return fail(rr.error);
  const bg = bgParam(p); if (bg.error) return fail(bg.error);
  pinParents();
  const G = Layer.group(p.name ? String(p.name) : nextArtboardName());
  setArtboard(G, {rect:rr.r, background:bg.v || 'white', preset});
  G.parent = null; Doc.layers.push(G); Doc.activeId = G.id; Doc.selectedIds = null;
  fitCanvas();
  return {id:G.id, layer:G.id, rect:rr.r.slice()};
});
reg('layer.new.artboardFromGroup', '{id?（顶层的组）, background?, color?, name?} 来自图层组的画板：板框＝组内容的外框（artboard_cmds.rs:188）→ {id, rect}' + UIP, p => {
  const G = layerOf(p);
  if (p.ui && isGroup(G)) return artboardDialog('ps.layer.new.artboardFromGroup', {id:G.id}, false);
  if (!isGroup(G) || (G.data && G.data.artboard) || Groups.parentOf(G)) return fail('artboards are made from a top-level layer group');
  const bg = bgParam(p); if (bg.error) return fail(bg.error);
  const b = boundsOf(G) || {x:0, y:0, w:Doc.width, h:Doc.height};
  if (p.name) G.name = String(p.name);
  setArtboard(G, {rect:[b.x, b.y, b.w, b.h], background:bg.v || 'white', preset:''});
  Doc.activeId = G.id; fitCanvas();
  return {id:G.id, layer:G.id, rect:[b.x, b.y, b.w, b.h]};
});
reg('layer.new.artboardFromLayers', '{ids?|id?（缺省＝选中的层）, name?, background?, color?} 来自图层的画板：选中的层搬进一块新画板、板框＝它们内容的联集（artboard_cmds.rs:208）→ {id, rect}' + UIP, p => {
  if (p.ui) return artboardDialog('ps.layer.new.artboardFromLayers', p.ids ? {ids:p.ids} : null, false);
  const ids = selectedIds(p);
  if (!ids.length || ids.some(id => Groups.artboardOf(Doc.byId(id)))) return fail('select layers that are not in an artboard');
  const bg = bgParam(p); if (bg.error) return fail(bg.error);
  pinParents();
  const Ls = ids.map(id => Doc.byId(id));
  let b = null; Ls.forEach(L => { b = unionB(b, boundsOf(L)); });
  b = b || {x:0, y:0, w:Doc.width, h:Doc.height};
  const G = Layer.group(p.name ? String(p.name) : nextArtboardName());
  setArtboard(G, {rect:[b.x, b.y, b.w, b.h], background:bg.v || 'white', preset:''});
  G.parent = null; Ls.forEach(L => { L.parent = G.id; });
  Doc.layers.push(G); Groups.rebuild(Groups.tree());
  Doc.activeId = G.id; Doc.selectedIds = null; fitCanvas();
  return {id:G.id, layer:G.id, rect:[b.x, b.y, b.w, b.h]};
});
/* 内容面板／画板工具（artboard_cmds.rs:240 set_props）：改板框位置大小、背景、预设、名字；改 x/y 时内容跟着搬 */
reg('layer.artboard.set', '{id?（画板或里面的层）, rect?:[x,y,w,h] | x?,y?,width?,height?, preset?, background?, color?, name?, moveContents=true} 改画板 → {id, rect}', p => {
  const L = layerOf(p), G = L ? Groups.artboardOf(L) : null; if (!G) return fail('the layer is not an artboard');
  const old = G.data.artboard, base = old.rect.slice();
  const preset = p.preset !== undefined ? String(p.preset) : null;
  if (preset){ const q = PRESETS.find(x => x[0].toLowerCase() === preset.toLowerCase()); if (!q) return fail(`unknown preset \`${preset}\``); base[2] = q[1]; base[3] = q[2]; }
  const rr = rectParam(p, base); if (rr.error) return fail(rr.error);
  const bg = bgParam(p); if (bg.error) return fail(bg.error);
  const dx = rr.r[0] - old.rect[0], dy = rr.r[1] - old.rect[1];
  if (p.moveContents !== false && (dx || dy)) Groups.descendants(G).forEach(D => Groups.shiftLayer(D, dx, dy));
  G.data.artboard = {rect:rr.r, background:bg.v !== undefined && bg.v !== null ? bg.v : old.background, preset:preset !== null ? preset : old.preset};
  if (p.name) G.name = String(p.name);
  fitCanvas();
  return {id:G.id, rect:rr.r.slice()};
});

/* ═══════════ 画框（frame_cmds.rs：选中的层编组，组上一张蒙版只露它们内容的外框）═══════════ */
reg('layer.new.frameFromLayers', '{ids?|id?, name?} 来自图层的画框：编组＋组蒙版只露内容外框 → {layer, frame:[x,y,w,h]}', p => {
  const ids = selectedIds(p); if (!ids.length) return fail('select a layer');
  const G = groupLayers(ids, p.name);
  const b = boundsOf(G) || {x:0, y:0, w:Doc.width, h:Doc.height};
  const c = mkCanvas(Doc.width, Doc.height), x = ctx2d(c);
  x.fillStyle = '#ffffff'; x.fillRect(b.x, b.y, b.w, b.h);                // clip_mask：框内显示、框外隐藏
  G.mask = {id:'M' + G.id, kind:'raster', name:'mask', visible:true, opacity:1, blend:'normal', mask:null, x:0, y:0, _cache:null, _cacheScale:0, data:{canvas:c, ctx:x}};
  return {layer:G.id, id:G.id, frame:[b.x, b.y, b.w, b.h]};
});

/* ═══════════ 智能对象 ═══════════ */
const setSource = (L, e) => { L.data.source = {id:e.id, name:e.name, type:e.type}; Layer.invalidate(L); };
/* smart_cmds.rs:521 convert：这层（组＝连子孙）做成内嵌文件、换成一个智能对象（外观一模一样）；可见／不透明度／混合（穿透→正常）／剪贴／锁留在智能对象上 */
function toSmart(L){
  if (!L) return fail('no active layer');
  const r = Smart.fromLayer(L);
  if (!r) return fail('the layer is empty, so there is nothing to convert');
  const bg = !!(window.PsLayer && PsLayer.isBackground && PsLayer.isBackground(L));
  const S = Layer.smart(bg ? L3('圖層 0', '图层 0', 'Layer 0') : L.name, {source:{id:r.entry.id, name:r.entry.name, type:r.entry.type}, transform:[1, 0, 0, 1, r.rect[0], r.rect[1]]});
  S.visible = L.visible; S.opacity = L.opacity; S.blend = L.blend === 'passThrough' ? 'normal' : L.blend;
  if (L.clipped) S.clipped = true;
  if (!bg && L.locks) S.locks = clone(L.locks);
  if (L.parent !== undefined) S.parent = L.parent;
  const desc = isGroup(L) ? new Set(Groups.descendants(L).map(D => D.id)) : null;
  Doc.layers[Doc.index(L.id)] = S;
  if (desc) for (let k = Doc.layers.length - 1; k >= 0; k--) if (desc.has(Doc.layers[k].id)) Doc.layers.splice(k, 1);
  Doc.activeId = S.id; Doc.selectedIds = null;
  return {ok:true, id:S.id, layer:S.id, source:r.entry.id, rect:r.rect};
}
reg('layer.smartObjects.convertToSmartObject', '{id?} 转换为智能对象：这层（组＝整组）做成内嵌文件（裁到内容外框），画面不变；之后可变换、加智能滤镜、编辑内容不失真 → {id, source, rect}', p => toSmart(layerOf(p)));
reg('filter.convertForSmartFilters', '{id?} 转换为智能滤镜（＝转换为智能对象；已经是智能对象就不行）——之后滤镜菜单的滤镜套在它上面都会变成可再改的智能滤镜 → {id}', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (isSmart(L)) return fail('the layer is already a smart object');
  return toSmart(L);
});
/* smart_cmds.rs:536 via_copy：复制一个内容独立的智能对象（链接档改成嵌入）；插在原层之上 */
reg('layer.smartObjects.newSmartObjectViaCopy', '{id?} 通过拷贝新建智能对象（名字加「 copy」；内容各自独立，编辑其中一个不影响另一个）→ {id}', p => {
  const L = smartOf(p); if (!L) return notSmart();
  const r = CMD.map['layer.duplicate'].run({id:L.id}); if (!r || !r.id) return fail('duplicate failed');
  const N = Doc.byId(r.id), e = Smart.sourceOf(N);
  if (e && e.linked){ const c = Object.assign({}, e); delete c.id; delete c.linked; delete c._json; setSource(N, SmartStore.put(c)); }
  return {id:N.id, layer:N.id};
});
/* 栅格化（extra_cmds.rs:494 rasterize_one 的 smart 分支：内容换成像素，蒙版／样式／不透明度留着） */
const rasterSmart = p => { const L = layerOf(p); if (!isSmart(L)) return fail('the layer is not a smart layer'); return CMD.map['layer.rasterize'].run({id:L.id}); };
reg('layer.rasterize.smartObject', '{id?} 栅格化 ▸ 智能对象：内容换成目前的外观像素（id、蒙版、样式、不透明度都留着）', rasterSmart);
reg('layer.smartObjects.rasterize', '{id?} 智能对象 ▸ 栅格化（同 ps.layer.rasterize.smartObject）', rasterSmart);
/* 堆栈模式（layer_menu_cmds.rs:313 stack_mode；统计在 engine Smart.stackCanvas，照 algo/src/stack.rs） */
for (const m of Smart.STACK.concat('none')){
  reg('layer.smartObjects.stackMode.' + m, '{id?} 堆栈模式：' + (m === 'none' ? '无（回到一般合成）' : m + '——内容的各层（只有一个组就用组里的层）逐格逐色版算这个统计量') + ' → {stackMode}', p => {
    const L = smartOf(p); if (!L) return notSmart();
    L.data.stackMode = m === 'none' ? null : m; Layer.invalidate(L);
    return {ok:true, stackMode:L.data.stackMode};
  });
}

/* ── 内容：嵌入／链接／替换／导出 ── */
const baseName = s => String(s || '').split(/[\\/]/).pop().split('?')[0] || 'contents';
/* 一份 .dlcanvas（JSON）做成内嵌文件（里面的智能对象来源先载） */
async function entryFromProject(json, name, extra){
  if (!json || json.format !== Project.FORMAT) throw new Error('不是堤麟画板的工程档');
  const errors = [];
  if (json.smartSources) for (const [id, so] of Object.entries(json.smartSources)) await Project._sourceIn(id, so, errors);
  const layers = (json.layers || []).map(o => o.ps2 ? Object.assign({}, o, {x2:Object.assign({}, o.x2 || {}, o.ps2)}) : o);   // 顶层的菜单档栏位（ps2）当成内嵌层的 x2
  const id = SmartStore.newId();
  await Project._sourceIn(id, {type:'layers', name, w:json.width, h:json.height, layers}, errors);
  const e = SmartStore.get(id); if (!e) throw new Error('载不进来');
  Object.assign(e, extra || {});
  return e;
}
/* 网址（图或 .dlcanvas）做成来源；extra 例：{linked:{url}} */
async function entryFromURL(url, name, extra){
  if (/\.dlcanvas(\?|$)/i.test(url)){ const json = await (await fetch(url)).json(); return entryFromProject(json, name || baseName(url), extra); }
  return Smart.imageEntry(url, name || baseName(url), extra);
}
/* 本机挑一个档（图或 .dlcanvas）——本机档进画板先问网站宿主（说明.md「给网站宿主的钩子」）：图片可回 fileId（存成云盘引用） */
function pickOne(accept){
  return new Promise(res => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept || 'image/*,.dlcanvas'; inp.style.display = 'none';
    inp.onchange = () => { const f = inp.files[0] || null; inp.remove(); res(f); };
    document.body.appendChild(inp); inp.click();
  });
}
async function entryFromLocal(file, linkIfHost){
  if (/\.dlcanvas$/i.test(file.name)) return {entry:await entryFromProject(JSON.parse(await file.text()), file.name)};
  const ans = await SiteHooks.askLocal(file, 'image');
  if (ans.handled) return {handled:true};
  const url = URL.createObjectURL(file);
  try {
    const e = await Smart.imageEntry(url, file.name);
    if (ans.fileId){
      const fid = await Promise.resolve(ans.fileId).catch(() => null);
      if (fid){ if (linkIfHost) e.linked = {file_id:String(fid)}; else e.src = {file_id:String(fid)}; e._json = null; }
    }
    return {entry:e};
  } finally { URL.revokeObjectURL(url); }
}
/* 来源的档案（导出内容／转成链接档用）：图＝PNG；内嵌文件＝.dlcanvas（里面的智能对象来源一起带） */
async function contentsFile(e){
  if (e.type === 'image'){
    const blob = await new Promise(res => e.image.toBlob(res, 'image/png'));
    return {blob, name:/\.(png|jpe?g|webp|gif)$/i.test(e.name) ? e.name.replace(/\.[^.]*$/, '.png') : e.name + '.png', type:'image/png'};
  }
  const stats = {encoded:[], reused:[], refs:[]}, gen = Project._gen;
  const json = {format:Project.FORMAT, version:Project.VERSION, createdBy:'堤麟画板', width:e.w, height:e.h, layers:e.layers.map(L => Project._layerOut(L, true, stats, gen, true))};
  const ids = Smart.collect(e.layers);
  if (ids.size){ json.smartSources = {}; ids.forEach(id => { const s = SmartStore.get(id); if (s) json.smartSources[id] = Project._sourceOut(s, true, stats, gen); }); }
  const txt = JSON.stringify(json);
  return {blob:new Blob([txt], {type:'application/json'}), name:/\.dlcanvas$/i.test(e.name) ? e.name : e.name.replace(/\.[^.]*$/, '') + '.dlcanvas', type:'application/json'};
}
/* 智能对象的来源换掉（smart_cmds.rs:562 set_source：变换与滤镜留着，重渲）——非同步：自己记一步历史 */
const swapSource = (p, make) => asyncStep(async () => {
  const L = smartOf(p || {}); if (!L) return notSmart();
  const r = await make(L, Smart.sourceOf(L));
  if (r && r.handled){ History.past.pop(); return {ok:true, handled:true, by:'host'}; }   // 网站宿主接手了：这次不改文件
  if (!r || r.ok === false) return r || fail('nothing to do');
  setSource(L, r.entry);
  return Object.assign({ok:true, layer:L.id, source:r.entry.id}, r.info || {});
});
reg('layer.smartObjects.replaceContents', '{id?, url?（图或 .dlcanvas 网址／dataURL）| file_id?（云盘档，经宿主 resolveRef）| project?:{.dlcanvas JSON}} 替换内容（变换、智能滤镜留着）→ {layer, source}' + UIP, p => swapSource(p, async () => {
  if (p.ui){ const f = await pickOne(); if (!f) return fail('no file chosen'); return entryFromLocal(f, false); }
  if (p.project) return {entry:await entryFromProject(p.project, p.name || 'contents.dlcanvas')};
  if (p.file_id){ const r = await Smart.resolve({file_id:p.file_id}); if (!r.url) return fail(r.error); return {entry:await entryFromURL(r.url, p.name, {src:{file_id:String(p.file_id)}})}; }
  if (p.url) return {entry:await entryFromURL(String(p.url), p.name)};
  return fail('pass `url`, `file_id` or `project` (UI: pick a file)');
}), false);
reg('layer.smartObjects.relinkToFile', '{id?, url? | file_id?} 重新链接到文件：来源改成链接（网址或云盘档；存档只存链接）→ {layer, source, linked}' + UIP, p => swapSource(p, async () => {
  if (p.ui){
    const f = await pickOne('image/*'); if (!f) return fail('no file chosen');
    const r = await entryFromLocal(f, true); if (r.handled || !r.entry) return r;
    return {entry:r.entry, info:r.entry.linked ? {linked:r.entry.linked} : {embedded:true, note:'没有网站宿主可链接：内容改成嵌入'}};
  }
  if (p.file_id){ const r = await Smart.resolve({file_id:p.file_id}); if (!r.url) return fail(r.error); const e = await entryFromURL(r.url, p.name, {linked:{file_id:String(p.file_id)}}); return {entry:e, info:{linked:e.linked}}; }
  if (p.url){ const e = await entryFromURL(String(p.url), p.name, {linked:{url:String(p.url)}}); return {entry:e, info:{linked:e.linked}}; }
  return fail('pass `url` or `file_id`');
}), false);
/* 重新读链接档（smart_cmds.rs:831 updateModifiedContent／652 update_all） */
async function reloadLinked(e){
  const r = await Smart.resolve(e.linked); if (!r.url) throw new Error(r.error);
  return entryFromURL(r.url, e.name, {linked:clone(e.linked)});
}
reg('layer.smartObjects.updateModifiedContent', '{id?} 更新修改的内容：链接档重新读一次（嵌入的不行）→ {layer, source}', p => swapSource(p, async (L, e) => {
  if (!e || !e.linked) return fail('the smart object is embedded');
  return {entry:await reloadLinked(e)};
}), false);
reg('layer.smartObjects.updateAllModifiedContent', '{} 更新所有修改的内容：每个链接档的智能对象都重新读 → {updated:[层 id]}', () => asyncStep(async () => {
  const updated = [];
  for (const L of Doc.layers.filter(isSmart)){
    const e = Smart.sourceOf(L); if (!e || !e.linked) continue;
    try { setSource(L, await reloadLinked(e)); updated.push(L.id); } catch (err){ console.warn(err); }
  }
  return {ok:true, updated};
}), false);
reg('layer.smartObjects.convertToEmbedded', '{id?} 转换为嵌入对象：链接档的内容拷进文件（之后跟原档无关）→ {layer, source}', p => {
  const L = smartOf(p); if (!L) return notSmart();
  const e = Smart.sourceOf(L); if (!e || !e.linked) return fail('the smart object is embedded');
  if (!Smart.available(e)) return fail('the linked file can\'t be read');
  const c = Object.assign({}, e); delete c.id; delete c.linked; delete c._json; delete c._comp; delete c._stack;
  setSource(L, SmartStore.put(c));
  return {ok:true, layer:L.id, source:L.data.source.id};
});
/* 转换为链接对象（smart_cmds.rs:851：把内容写成一个档再链接过去）——浏览器写不了磁碟：交给网站宿主存进云盘拿 file_id */
reg('layer.smartObjects.convertToLinked', '{id?} 转换为链接对象：内容存成一个档（图＝PNG、内嵌文件＝.dlcanvas）交给网站宿主存进云盘，来源改成链接 {file_id}；'
  + '宿主要提供 window.__dlSiteHooks.storeFile(file) → {file_id}（图也可走 onLocalFile 回 fileId）；本机版没有宿主 ⇒ 报错（请改用「导出内容」）→ {layer, linked}' + UIP, p => swapSource(p, async (L, e) => {
  if (!e || !Smart.available(e)) return fail('the smart object\'s contents are unavailable');
  const f = await contentsFile(e), file = new File([f.blob], f.name, {type:f.type});
  const Hs = window.__dlSiteHooks; let fid = null;
  if (Hs && typeof Hs.storeFile === 'function'){ const r = await Hs.storeFile(file); fid = r && (r.file_id || r.fileId || (typeof r === 'string' ? r : null)); }
  else if (e.type === 'image' && SiteHooks.hasLocalHook()){ const ans = await SiteHooks.askLocal(file, 'image'); fid = ans.fileId ? await Promise.resolve(ans.fileId).catch(() => null) : null; }
  else return fail('convert to linked needs the site host (window.__dlSiteHooks.storeFile) to store the file; use Export Contents instead');
  if (!fid) return fail('the host did not return a file_id');
  const c = Object.assign({}, e); delete c.id; delete c._json; c.linked = {file_id:String(fid)}; delete c.src;
  return {entry:SmartStore.put(c), info:{linked:{file_id:String(fid)}}};
}), false);
/* 导出内容（smart_cmds.rs:583 export_contents）：下载来源档（图＝PNG、内嵌文件＝.dlcanvas）——网站版要覆写成存进云盘 */
reg('layer.smartObjects.exportContents', '{id?, name?} 导出内容：把智能对象的来源存成档（图＝.png；内嵌文件＝.dlcanvas，里面的智能对象一起带）→ {fileName, bytes}', async p => {
  const L = smartOf(p || {}); if (!L) return notSmart();
  const e = Smart.sourceOf(L); if (!Smart.available(e)) return fail('the smart object\'s contents are unavailable');
  const f = await contentsFile(e);
  const name = p && p.name ? String(p.name) + f.name.slice(f.name.lastIndexOf('.')) : f.name;
  download(f.blob, name);
  return {ok:true, fileName:name, bytes:f.blob.size, type:e.type};
}, false);
/* 在 Finder 中显示（layer_menu_cmds.rs:344）：只有链接档有档案；浏览器＝开那个网址（云盘档问宿主 revealRef） */
reg('layer.smartObjects.revealInFinder', '{id?, dryRun?} 显示链接档：网址＝开新分页；云盘档＝叫宿主 window.__dlSiteHooks.revealRef({file_id})；嵌入的没有档案可显示 → {url|file_id}', p => {
  const L = smartOf(p); if (!L) return notSmart();
  const e = Smart.sourceOf(L), k = e && e.linked;
  if (!k) return fail('embedded smart objects have no file to reveal');
  if (k.url){ if (!p.dryRun) window.open(k.url, '_blank', 'noopener'); return {ok:true, url:k.url}; }
  const Hs = window.__dlSiteHooks;
  if (Hs && typeof Hs.revealRef === 'function'){ if (!p.dryRun) Hs.revealRef({file_id:k.file_id}); return {ok:true, file_id:k.file_id}; }
  return p.dryRun ? {ok:true, file_id:k.file_id} : fail('the site host has no revealRef for cloud files');
}, false);
/* 编辑内容（smart_cmds.rs:592 edit_contents／609 commit_child；engine Smart.beginSession／endSession） */
reg('layer.smartObjects.editContents', '{id?} 编辑内容：文件暂时换成智能对象的内嵌档来编辑（画面上方一条「完成并更新／取消」）；改完叫 ps.layer.smartObjects.saveContents（写回、母文件一步历史）或 closeContents → {editing, document}', p => {
  const L = smartOf(p); if (!L) return notSmart();
  return Smart.beginSession(L);
}, false);
reg('layer.smartObjects.saveContents', '{} （编辑内容中）完成：内容写回那个智能对象（新的一份内嵌档、母文件一步历史）、回到母文件 → {updated, layer, source}', () => Smart.session ? Smart.endSession(true) : fail("this document isn't smart object contents"), false);
reg('layer.smartObjects.closeContents', '{save=false} （编辑内容中）关闭：save=true＝同 saveContents；否则丢掉这次的修改回到母文件', p => Smart.session ? Smart.endSession(!!p.save) : fail("this document isn't smart object contents"), false);

/* ── 变形（warp_cmds.rs：智能对象的变形存起来、每次从来源重渲；操控／透视变形＝记成智能滤镜 distort_cmds.rs:230） ── */
const WARPP = '{id?, style:"none|custom|arc|arcLower|arcUpper|arch|bulge|shellLower|shellUpper|flag|wave|fish|rise|fisheye|inflate|squeeze|twist", bend:%=50, hDistort?, vDistort?, vertical?, rect?:[x0,y0,x1,y1]（缺省＝没变形时的内容外框）, mesh?, grid?, warp?:{完整变形物件}, interpolation?}';
reg('layer.smartObjects.warp', WARPP + ' 智能对象 ▸ 变形：存成智能对象的变形（取代旧的；style:"none"＝拿掉），不失真；不给参数＝进互动变形（同 编辑 ▸ 变换 ▸ 变形，Enter 确定）→ {layer, changed, rect}', p => {
  const L = smartOf(p); if (!L) return notSmart();
  const keys = Object.keys(cleanP(p));
  if (!CMD.map['ps.edit.transform.warp.apply']) return fail('the warp engine (menus/impl/ps-edit.js) is not loaded');
  if (!keys.length || p.ui){ Doc.activeId = L.id; const r = CMD.run('ps.edit.transform.warp', {}); return (r && r.ok === false) ? r : UI_OPEN; }
  const ops = L.data.ops || [];
  L.data.ops = ops.filter(o => o.type !== 'warp'); Layer.invalidate(L);
  if (p.style === 'none') return {ok:true, layer:L.id, changed:ops.length !== L.data.ops.length};
  if (p.style === undefined && !p.mesh && !p.grid && !p.warp) return fail('pass `style` (arc, flag, …, custom), `mesh` or `warp`');
  const q = cleanP(p);
  if (!Array.isArray(q.rect) || q.rect.length !== 4){ const b = boundsOf(L); if (!b) return fail('nothing to warp'); q.rect = [b.x, b.y, b.x + b.w, b.y + b.h]; }
  L.data.ops.push({type:'warp', params:q, at:[L.x, L.y]}); Layer.invalidate(L);
  return {ok:true, layer:L.id, changed:true, rect:q.rect.slice()};
});
/* 操控变形／透视变形的代理：一张暂时的像素层（智能对象目前的外观、不进历史不进签名）给 ps-edit 的互动模式用；确定时改道记成智能滤镜 */
let proxy = null;
function endProxy(){
  if (!proxy) return;
  const {P, L} = proxy; clearInterval(proxy.timer); proxy = null;
  const i = Doc.layers.indexOf(P); if (i >= 0) Doc.layers.splice(i, 1);
  delete L._proxyHide;
  if (Doc.activeId === P.id) Doc.activeId = L.id;
  refresh();
}
/* editIndex＝再编辑第几个智能滤镜（PS 双击滤镜名）：代理层只套它下面的滤镜，互动模式带回它的参数，确定＝改那个滤镜的参数（不叠新的） */
function startProxy(L, beginCmd, editIndex){
  if (!CMD.map[beginCmd]) return fail('menus/impl/ps-edit.js is not loaded');
  endProxy();
  const d = L.data, edit = Number.isInteger(editIndex) ? (d.filters || [])[editIndex] : null;
  if (Number.isInteger(editIndex) && (!edit || 'ps.' + edit.command !== beginCmd.replace('ps.edit.', 'ps.layer.smartObjects.'))) return fail('`index` is not a ' + beginCmd.slice(8) + ' smart filter of this layer');
  const P = Layer.raster(L.name);
  if (edit){ const all = d.filters; d.filters = all.slice(0, editIndex); try { P.data.ctx.drawImage(Smart.render(L), 0, 0); } finally { d.filters = all; } }
  else P.data.ctx.drawImage(Smart.render(L), 0, 0);
  P._sigSkip = true; P._proxyOf = L.id; if (L.parent !== undefined) P.parent = L.parent;
  Doc.layers.splice(Doc.index(L.id) + 1, 0, P); L._proxyHide = true; Doc.activeId = P.id;
  proxy = {P, L, editIndex:edit ? editIndex : null};
  const r = edit ? PsEdit.distort.reopen(beginCmd === 'ps.edit.puppetWarp' ? 'puppet' : 'perspective', edit.params) : CMD.run(beginCmd, {});
  if (r && r.ok === false){ endProxy(); return r; }
  proxy.timer = setInterval(() => { if (!(window.PsEdit && PsEdit.distort && PsEdit.distort.session())) endProxy(); }, 200);
  return {ok:true, mode:'interactive', layer:L.id};
}
/* add_smart_filter（smart_cmds.rs:354）：有选区又还没有滤镜蒙版 ⇒ 选区变滤镜蒙版；滤镜记到最上面 */
function selMask(L){
  const c = mkCanvas(Doc.width, Doc.height), x = ctx2d(c);
  if (window.SelMask && Doc.sel && SelMask.bytes){
    const by = SelMask.bytes(), img = x.createImageData(c.width, c.height);
    for (let i = 0; i < by.length && i * 4 < img.data.length; i++){ img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = by[i]; }
    x.putImageData(img, 0, 0);
  } else if (Doc.sel){ x.fillStyle = '#ffffff'; x.fillRect(Doc.sel.x, Doc.sel.y, Doc.sel.w, Doc.sel.h); }
  return {id:'F' + L.id, kind:'raster', name:'filter mask', visible:true, opacity:1, blend:'normal', mask:null, x:L.x, y:L.y, enabled:true, _cache:null, _cacheScale:0, data:{canvas:c, ctx:x}};
}
function addFilter(L, command, params){
  const d = L.data; d.filters = d.filters || [];
  if (Doc.sel && !L.filterMask) L.filterMask = selMask(L);
  d.filters.push({command, params:params || {}, blend:'normal', opacity:1, visible:true});
  Layer.invalidate(L);
  return {ok:true, layer:L.id, smartFilter:d.filters.length - 1, command};
}
const pinsIdentity = q => Array.isArray(q.pins) && q.pins.every(t => t.src[0] === t.dst[0] && t.src[1] === t.dst[1] && !t.rotate);
const planesIdentity = q => Array.isArray(q.planes) && q.planes.every(pl => pl.src.every((v, i) => v[0] === pl.dst[i][0] && v[1] === pl.dst[i][1])) && !q.straighten;
for (const [id, beginCmd, applyCmd, key] of [['layer.smartObjects.puppetWarp', 'ps.edit.puppetWarp', 'ps.edit.puppetWarp.apply', 'pins'],
                                             ['layer.smartObjects.perspectiveWarp', 'ps.edit.perspectiveWarp', 'ps.edit.perspectiveWarp.apply', 'planes']]){
  const what = key === 'pins' ? '操控变形 {pins:[{src,dst,rotate?,depth?}…], mode?, density?, expansion?}' : '透视变形 {planes:[{src:[[x,y]×4], dst:[[x,y]×4]}…], straighten?}';
  reg(id, '{id?, …同 ps.edit.' + (key === 'pins' ? 'puppetWarp' : 'perspectiveWarp') + '.apply} 智能对象 ▸ ' + what + '：记成一个智能滤镜（可关、可删、可改参数；distort_cmds.rs:230）；不给参数＝进互动模式（确定＝记成智能滤镜）；只给 index＝再编辑那个智能滤镜（PS 双击滤镜名：带回原参数，确定＝改它、不叠新的）→ {layer, smartFilter}', p => {
    const L = smartOf(p); if (!L) return notSmart();
    if (!p[key]) return startProxy(L, beginCmd, p.index);
    if (!CMD.map[applyCmd]) return fail('menus/impl/ps-edit.js is not loaded');
    const q = cleanP(p);
    if (key === 'pins' ? pinsIdentity(q) : planesIdentity(q)) return {ok:true, layer:L.id, changed:false};
    History.push();
    return addFilter(L, id, q);
  }, false);
}

/* ═══════════ 智能滤镜（smart_cmds.rs:674-761、866-932）═══════════ */
function needFilters(L){
  if (!isSmart(L)) return notSmart();
  if (!(L.data.filters || []).length) return fail('the smart object has no smart filters');
  return null;
}
function filterIndex(p, L){
  const n = L.data.filters.length;
  if (p.index === undefined || p.index === null) return {i:n - 1};
  const i = +p.index;
  return Number.isInteger(i) && i >= 0 && i < n ? {i} : {error:`\`index\` must be 0..${n} (0 = bottom filter)`};
}
reg('layer.smartFilter.disableSmartFilters', '{id?, enabled?:bool（不给＝切换）} 停用智能滤镜：整叠滤镜关掉（每个滤镜自己的开关不动）→ {enabled}', p => {
  const L = layerOf(p), e = needFilters(L); if (e) return e;
  L.data.filtersEnabled = typeof p.enabled === 'boolean' ? p.enabled : L.data.filtersEnabled === false;
  Layer.invalidate(L); return {ok:true, enabled:L.data.filtersEnabled};
});
reg('layer.smartFilter.deleteFilterMask', '{id?} 删除滤镜蒙版', p => {
  const L = smartOf(p); if (!L) return notSmart();
  if (!L.filterMask) return fail('the smart object has no filter mask');
  delete L.filterMask; Layer.invalidate(L); return {ok:true};
});
reg('layer.smartFilter.disableFilterMask', '{id?, enabled?:bool（不给＝切换）} 停用滤镜蒙版 → {enabled}', p => {
  const L = smartOf(p); if (!L) return notSmart();
  if (!L.filterMask) return fail('the smart object has no filter mask');
  L.filterMask.enabled = typeof p.enabled === 'boolean' ? p.enabled : L.filterMask.enabled === false;
  Layer.invalidate(L); return {ok:true, enabled:L.filterMask.enabled};
});
reg('layer.smartFilter.blendingOptions', '{id?, index?（0＝最底下的滤镜；缺省＝最上面）, blend?, opacity?:0..1（>1 当百分比）} 智能滤镜的混合选项 → {index, blend, opacity}' + UIP, p => {
  const L = layerOf(p), e = needFilters(L); if (e) return e;
  const fi = filterIndex(p, L); if (fi.error) return fail(fi.error);
  const f = L.data.filters[fi.i];
  if (p.ui){
    dialog('sfBlend', ['混合選項', '混合选项', 'Blending Options'], [
      {key:'blend', label:['模式', '模式', 'Mode'], type:'select', value:f.blend || 'normal', options:blendOpts(false)},
      {key:'opacity', label:['不透明度 (%)', '不透明度 (%)', 'Opacity (%)'], value:Math.round((f.opacity === undefined ? 1 : f.opacity) * 100), min:0, max:100}
    ], v => CMD.run('ps.layer.smartFilter.blendingOptions', {id:L.id, index:fi.i, blend:v.blend, opacity:v.opacity / 100}));
    return UI_OPEN;
  }
  if (p.blend !== undefined && !BLENDS.includes(p.blend)) return fail(`unknown blend mode \`${p.blend}\``);
  if (p.blend !== undefined) f.blend = p.blend;
  if (p.opacity !== undefined){ const o = +p.opacity; f.opacity = clamp(o > 1 ? o / 100 : o, 0, 1); }
  Layer.invalidate(L); return {ok:true, index:fi.i, blend:f.blend || 'normal', opacity:f.opacity === undefined ? 1 : f.opacity};
});
reg('layer.smartFilter.clearSmartFilters', '{id?} 清除智能滤镜（连滤镜蒙版）', p => {
  const L = layerOf(p), e = needFilters(L); if (e) return e;
  L.data.filters = []; delete L.filterMask; Layer.invalidate(L); return {ok:true};
});
reg('layer.smartFilter.setVisible', '{id?, index?, visible?:bool（不给＝切换）} 显示／隐藏一个智能滤镜（图层面板滤镜那列的眼睛）→ {index, visible}', p => {
  const L = layerOf(p), e = needFilters(L); if (e) return e;
  const fi = filterIndex(p, L); if (fi.error) return fail(fi.error);
  const f = L.data.filters[fi.i]; f.visible = typeof p.visible === 'boolean' ? p.visible : f.visible === false;
  Layer.invalidate(L); return {ok:true, index:fi.i, visible:f.visible};
});
reg('layer.smartFilter.setParams', '{id?, index?, params:{…}（盖在原参数上）, replace?:bool（true＝整组换掉，重开对话框按确定用）} 改一个智能滤镜的参数 → {index, params}', p => {
  const L = layerOf(p), e = needFilters(L); if (e) return e;
  if (!p.params || typeof p.params !== 'object') return fail('pass `params` (merged into the filter\'s parameters)');
  const fi = filterIndex(p, L); if (fi.error) return fail(fi.error);
  const f = L.data.filters[fi.i]; f.params = p.replace === true ? clone(p.params) : Object.assign({}, f.params || {}, clone(p.params));
  Layer.invalidate(L); return {ok:true, index:fi.i, params:clone(f.params)};
});
/* 照 PS（原码没有）：图层面板双击智能滤镜名＝用原参数重开那个滤镜的对话框（即时预览），确定＝改参数（一步历史）、取消＝不动 */
reg('layer.smartFilter.edit', '{id?, index?（0＝最底下的滤镜；缺省＝最上面）} 重开智能滤镜的对话框（图层面板双击滤镜名）；agent 直接改参数用 ps.layer.smartFilter.setParams → {ok:false, dialog:true}', p => {
  const L = layerOf(p), e = needFilters(L); if (e) return e;
  const fi = filterIndex(p, L); if (fi.error) return fail(fi.error);
  const f = L.data.filters[fi.i];
  if (!(window.PsFilter && PsFilter.editSmartFilter) || !String(f.command || '').startsWith('filter.')) return CMD.run('ps.layer.smartFilter.blendingOptions', {id:L.id, index:fi.i, ui:true});
  const r = PsFilter.editSmartFilter(L, fi.i);
  return r && r.ok === false ? fail(r.error) : UI_OPEN;
}, false);
reg('layer.smartFilter.delete', '{id?, index?} 删掉一个智能滤镜', p => {
  const L = layerOf(p), e = needFilters(L); if (e) return e;
  const fi = filterIndex(p, L); if (fi.error) return fail(fi.error);
  L.data.filters.splice(fi.i, 1); Layer.invalidate(L); return {ok:true, index:fi.i};
});
reg('layer.smartFilter.move', '{id?, index?, to} 智能滤镜换顺序（0＝最底下）', p => {
  const L = layerOf(p), e = needFilters(L); if (e) return e;
  const fi = filterIndex(p, L); if (fi.error) return fail(fi.error);
  const n = L.data.filters.length, to = +p.to;
  if (!Number.isInteger(to) || to < 0 || to >= n) return fail(`\`to\` must be 0..${n}`);
  const [f] = L.data.filters.splice(fi.i, 1); L.data.filters.splice(to, 0, f);
  Layer.invalidate(L); return {ok:true, index:to};
});

/* 有组时的向下合并（layer.mergeDown；layer_multi_cmds.rs:640 只选一层＝向下合并） */
function mergeDownTree(L){
  if (!L) return fail('no active layer');
  let parts;
  if (isGroup(L)) parts = [L];
  else { const sib = Groups.children(Groups.parentOf(L)); const i = sib.indexOf(L); if (i <= 0) return fail('no layer below to merge into'); parts = [sib[i - 1], L]; }
  const low = parts[0];
  const N = Layer.raster(low.name); N.data.ctx.drawImage(Groups.flatten(parts, 1), 0, 0);
  if (!isGroup(low)){ N.id = low.id; N.blend = low.blend === 'passThrough' ? 'normal' : low.blend; }
  if (low.parent !== undefined) N.parent = low.parent;
  const gone = new Set(); parts.forEach(X => { gone.add(X.id); if (isGroup(X)) Groups.descendants(X).forEach(D => gone.add(D.id)); });
  const out = Doc.layers.flatMap(X => X === low ? [N] : gone.has(X.id) ? [] : [X]);
  Doc.layers.splice(0, Doc.layers.length, ...out); Doc.activeId = N.id; return {id:N.id};
}
/* ═══════════ 改道：别的命令碰到组／智能对象（CMD.redirects，engine 照样把关、进历史、报改动）═══════════ */
const editTarget = p => (p && (p.layerId || p.layer)) ? Doc.byId(p.layerId || p.layer) : Doc.active();
/* 平行四边形：rect [x0,y0,x1,y1] 的四角 → quad 的仿射（跟 move.transform 收的一样；扭曲／透视不收） */
function quadMatrix(rect, quad){
  const w = rect[2] - rect[0], h = rect[3] - rect[1]; if (!(w > 0 && h > 0) || !Array.isArray(quad) || quad.length !== 4) return null;
  const [q0, q1, q2, q3] = quad, a = (q1[0] - q0[0]) / w, b = (q1[1] - q0[1]) / w, c = (q3[0] - q0[0]) / h, d = (q3[1] - q0[1]) / h;
  if (Math.abs(q1[0] + q3[0] - q0[0] - q2[0]) > 0.5 || Math.abs(q1[1] + q3[1] - q0[1] - q2[1]) > 0.5) return null;
  return [a, b, c, d, q0[0] - a * rect[0] - c * rect[1], q0[1] - b * rect[0] - d * rect[1]];
}
const rectOf = L => { const b = boundsOf(L); return b ? [b.x, b.y, b.x + b.w, b.y + b.h] : null; };
/* 智能对象的自由变换：没有变形就并进 transform（下次从来源一次重采样，不累积失真）；有变形就记成一步仿射（排在变形之后） */
/* 四角不是平行四边形（扭曲／透视）＝记一步 persp（非破坏，换内容后照套；PS 行为，原码 transform_cmds.rs:198 不支援）——见 engine Smart.transform */
function transformSmart(L, p){
  if (p.matrix) return Smart.transform(L, {matrix:p.matrix});
  const rect = p.rect || rectOf(L); if (!rect) return {ok:false, error:'the layer is empty'};
  if (!p.quad) return {ok:false, error:'need quad or matrix'};
  return Smart.transform(L, {rect, quad:p.quad, tail:!!p.smartTail});
}
CMD.redirects.push((id, p) => {
  /* 自由变换：智能对象＝改变换；组＝每个子层用同一个框、同一个四角变（photocraft transform 递归子层） */
  if (id === 'move.transform'){
    const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
    if (isSmart(L)) return {undoable:true, run:q => transformSmart(L, q)};
    if (isGroup(L)) return {undoable:true, run:q => {
      const rect = q.rect || rectOf(L); if (!rect && !q.matrix) return {ok:false, error:'the layer is empty'};
      const base = CMD.map['move.transform'].run, out = [];
      for (const D of Groups.descendants(L)){
        if (isGroup(D)) continue;
        const r = isSmart(D) ? transformSmart(D, Object.assign({}, q, {rect})) : base(Object.assign({}, q, {layerId:D.id, rect}));
        if (r && r.ok === false) out.push(D.name + '：' + r.error);
      }
      return {ok:true, skipped:out};
    }};
  }
  /* 编辑 ▸ 变换 ▸ 变形 碰到智能对象（互动变形按 Enter）＝加一步变形（文件坐标、记下当时位置） */
  if (id === 'ps.edit.transform.warp.apply'){
    const L = editTarget(p); if (!isSmart(L)) return null;
    /* smartTail:true（变形模式是从尾端那步透视／变形开的）＝换掉那一步，不再叠一步（照原码 warp_cmds.rs:204：智能对象只存一个变形） */
    return {undoable:true, run:q => {
      const d = L.data; d.ops = d.ops || [];
      if (q.smartTail && Smart.tail(L)) d.ops.pop();
      const params = cleanP(q); delete params.smartTail;
      d.ops.push({type:'warp', params, at:[L.x, L.y]}); Layer.invalidate(L); return {ok:true, layerId:L.id, changed:true};
    }};
  }
  /* 操控／透视变形碰到智能对象（或它的代理层）＝记成智能滤镜（distort_cmds.rs:244） */
  if (id === 'ps.edit.puppetWarp.apply' || id === 'ps.edit.perspectiveWarp.apply'){
    let L = editTarget(p), from = null;
    if (L && L._proxyOf){ from = L; L = Doc.byId(L._proxyOf); }
    if (!isSmart(L)) return null;
    const cmd = id === 'ps.edit.puppetWarp.apply' ? 'layer.smartObjects.puppetWarp' : 'layer.smartObjects.perspectiveWarp';
    return {undoable:true, run:q => {
      const ei = from && proxy ? proxy.editIndex : null;
      if (from){ const s = History.past[History.past.length - 1]; if (s && s.activeId === from.id) s.activeId = L.id; endProxy(); }
      const f = Number.isInteger(ei) ? (L.data.filters || [])[ei] : null;
      if (f && f.command === cmd){ f.params = cleanP(q); Layer.invalidate(L); return {ok:true, layer:L.id, smartFilter:ei, command:cmd, edited:true}; }   // 再编辑：改原滤镜参数（PS）
      return addFilter(L, cmd, cleanP(q));
    }};
  }
  /* 滤镜碰到智能对象＝智能滤镜（filters.rs:219）；上次滤镜也是 */
  if (/^ps\.filter\./.test(id) && !p.dialog && !p.list && id !== 'ps.filter.filterGallery.list' && id !== 'ps.filter.convertForSmartFilters'){
    const L = (p.layer !== undefined && p.layer !== null && p.layer !== '') ? Doc.byId(p.layer) : p.layerId ? Doc.byId(p.layerId) : Doc.active();
    if (!isSmart(L)) return null;
    let fid = id.slice(3), params = p;
    if (id === 'ps.filter.lastFilter'){ const last = window.PsFilter && PsFilter.last(); if (!last || !last.id) return null; fid = last.id; params = last.params || {}; }
    if (!window.PsFilter) return null;
    let known = false; try { known = !!(PsFilter.SURF_OPS[fid] || PsFilter.paramsFor(fid, cleanP(params))); } catch (e){ known = false; }
    if (!known) return null;
    return {undoable:true, run:() => addFilter(L, fid, cleanP(params))};
  }
  /* 有组时：合并／拼合／删隐藏层／栅格化所有图层 要认树（不然组跟子层会各画一次） */
  if (!Groups.any()) return null;
  if (id === 'ps.layer.flattenImage') return {undoable:true, run:() => {
    const N = Layer.raster(Lang.t('layer.bg')); N.data.ctx.drawImage(Groups.flatten(Groups.topLevel(), 1, '#ffffff'), 0, 0);
    N.isBackground = true; N.locks = {transparency:true, pixels:false, position:true, artboard:false, all:false}; N.parent = null;
    Doc.layers.splice(0, Doc.layers.length, N); Doc.activeId = N.id; return {id:N.id};
  }};
  if (id === 'ps.layer.mergeVisible') return {undoable:true, run:() => {
    const vis = Groups.topLevel().filter(L => L.visible);
    if (vis.length < 2 && !(vis.length === 1 && isGroup(vis[0]))) return fail('there are not enough visible layers to merge');
    const base = vis[0], bg = !!(window.PsLayer && PsLayer.isBackground && PsLayer.isBackground(base));
    const N = Layer.raster(isGroup(base) ? base.name : base.name); N.data.ctx.drawImage(Groups.flatten(vis, 1, bg ? '#ffffff' : null), 0, 0);
    if (bg){ N.isBackground = true; if (base.locks) N.locks = clone(base.locks); }
    N.parent = null;
    const gone = new Set(); vis.forEach(L => { gone.add(L.id); if (isGroup(L)) Groups.descendants(L).forEach(D => gone.add(D.id)); });
    const out = Doc.layers.flatMap(L => L === base ? [N] : gone.has(L.id) ? [] : [L]);
    Doc.layers.splice(0, Doc.layers.length, ...out); Doc.activeId = N.id; return {id:N.id};
  }};
  /* 向下合并：当前层是组＝合并组（整组压成一层）；否则跟下面那个兄弟合（下面是组也一样整组压） */
  if (id === 'ps.layer.mergeDown') return {undoable:true, run:q => mergeDownTree(layerOf(q))};
  if (id === 'ps.layer.mergeLayers') return {undoable:true, run:q => {
    const ids = selectedIds(q);
    if (ids.length < 2) return mergeDownTree(Doc.byId(ids[0]));
    const Ls = ids.map(i => Doc.byId(i)), vis = Ls.filter(L => L.visible), top = Ls[Ls.length - 1];
    if (!vis.length) return fail('the selected layers are all hidden');
    const N = Layer.raster(top.name); N.data.ctx.drawImage(Groups.flatten(vis, 1), 0, 0);
    if (top.locks) N.locks = clone(top.locks);
    if (top.parent !== undefined) N.parent = top.parent;
    const gone = new Set(); Ls.forEach(X => { gone.add(X.id); if (isGroup(X)) Groups.descendants(X).forEach(D => gone.add(D.id)); });
    const out = Doc.layers.flatMap(X => X === top ? [N] : gone.has(X.id) ? [] : [X]);
    Doc.layers.splice(0, Doc.layers.length, ...out); Doc.activeId = N.id; Doc.selectedIds = [N.id]; return {id:N.id};
  }};
  if (id === 'ps.layer.delete.hiddenLayers') return {undoable:true, run:() => {
    const gone = new Set();
    Doc.layers.forEach(L => { if (!L.visible){ gone.add(L.id); if (isGroup(L)) Groups.descendants(L).forEach(D => gone.add(D.id)); } });
    if (gone.size >= Doc.layers.length) return fail('a document must keep at least one layer');
    const keep = Doc.layers.filter(L => !gone.has(L.id)); const n = Doc.layers.length - keep.length;
    Doc.layers.splice(0, Doc.layers.length, ...keep);
    if (!Doc.byId(Doc.activeId)) Doc.activeId = keep[keep.length - 1].id;
    return {deleted:n};
  }};
  return null;
});
/* 栅格化 ▸ 所有图层：智能对象也栅格化（rasterize_all 走 rasterize_one）；组不是内容层、跳过——原来那支会把组算成一张图 */
CMD.redirects.push((id, p) => {
  if (id !== 'ps.layer.rasterize.allLayers') return null;
  const smarts = Doc.layers.filter(isSmart), groups = Doc.layers.filter(isGroup);
  if (!smarts.length && !groups.length) return null;
  return {undoable:true, run:q => {
    smarts.forEach(L => CMD.map['layer.rasterize'].run({id:L.id}));
    const parents = Doc.layers.map(L => L.parent);
    groups.forEach(G => { G.kind = 'raster'; });               // 暂时当成像素层（原来那支只转非像素层）
    let r;
    try { r = CMD.map['ps.layer.rasterize.allLayers'].run(q) || {}; }
    finally { groups.forEach(G => { G.kind = 'group'; }); }
    Doc.layers.forEach((L, i) => { if (parents[i] !== undefined && L.parent === undefined) L.parent = parents[i]; });   // 转出来的新层留在原来的组里
    if (r && typeof r.rasterized === 'number') r.rasterized += smarts.length;
    return r;
  }};
});

/* ═══════════ 对外（菜单勾选、测试）═══════════ */
window.PsLayer3 = {
  boundsOf, selectedIds, artboards, PRESETS, transformSmart, quadMatrix, endProxy,
  proxy: () => proxy,
  stackMode: () => { const L = Doc.active(); return isSmart(L) ? (L.data.stackMode || null) : null; },
  filtersDisabled: () => { const L = Doc.active(); return !!(isSmart(L) && L.data.filtersEnabled === false); },
  filterMaskDisabled: () => { const L = Doc.active(); return !!(isSmart(L) && L.filterMask && L.filterMask.enabled === false); }
};
refresh();
})();
