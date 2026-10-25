/* 堤麟画板 · 菜单实作 · Photoshop ▸ 图层（命令名一律 ps.<原码 id>）
   照 ArtCraft photocraft 原码逐段翻：
   - engine/src/commands.rs        layer.new.layer／arrange（置顶置底）／layerMask.revealAll|hideAll|revealSelection|delete／mergeDown／flattenImage
   - engine/src/edit_cmds.rs       layer.new.layerViaCopy|layerViaCut（layer_via）／mergeVisible
   - engine/src/extra_cmds.rs      layer.new.layerFromBackground／拷贝粘贴样式／hideAllEffects／layerMask.enabled／rasterize.allLayers／delete.hiddenLayers
   - engine/src/layer_menu_cmds.rs layerMask.apply|fromTransparency|hideSelection／matting.*／blendingOptions／globalLight／createLayer／scaleEffects／quickExportAsPng|exportAs
   - engine/src/layer_multi_cmds.rs linkLayers／selectLinkedLayers／mergeLayers／arrange.reverse／lockLayers／renameLayer
   - engine/src/layer_style.rs     各效果的参数与预设；ui-egui/src/layer_style.rs 图层样式对话框（左栏效果清单＋右栏参数）
   - compose/src/effects.rs        效果渲染（投影／内阴影／外发光／内发光／光泽／描边／颜色叠加／渐变叠加）
   - algo/src/matting.rs           颜色净化 decontaminate、box_mean；algo/src/selection.rs edt（去边用）
   新增的图层栏位（都挂在图层物件上）：
     mask（已有：一张 raster 层，alpha＝显示度）、maskOff（停用中的蒙版）、style {enabled, items:[效果]}、fillOpacity 0..1、
     locks {transparency,pixels,position,artboard,all}、linkGroup 数字、isBackground
   Doc 上新增：globalLight {angle, altitude}、selectedIds（多选层；图层面板还没有多选）
   🔴 坐标铁律：像素层的蒙版与像素同在「图层坐标」（画布大小＝该层画布）；矢量／文字层的蒙版在文件坐标（renderLayer 已含位移）。 */
(function(){
'use strict';
if (window.PsLayer) return;                 // 防重复载入（测试 add_script_tag＋index.html 都挂时）

const L3 = (hant, hans, en) => Lang.cur === 'en' ? en : Lang.cur === 'zh-Hans' ? hans : hant;
const fail = msg => ({ok:false, error:msg});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (p, k, d) => (p && p[k] !== undefined && p[k] !== null && p[k] !== '' && isFinite(+p[k])) ? +p[k] : d;
const bool = (p, k, d) => (p && typeof p[k] === 'boolean') ? p[k] : d;
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w|0); c.height = Math.max(1, h|0); return c; };
const ctx2d = c => c.getContext('2d', {willReadFrequently:true});

/* ═══════════ 历史垫片：History 快照只存 id/kind/name/visible/opacity/blend/x/y/data，
   这里加挂的栏位（蒙版／样式／锁定／链接…）不进快照就会在任何一次 Ctrl+Z 后丢掉。
   先在这里包一层（只包一次、可与别人的包装串接）；这些改动并进 engine.js 后，engine 设 History._extraProps 即自动停用这层。 */
const EXTRA = ['mask', 'maskOff', 'style', 'fillOpacity', 'locks', 'linkGroup', 'isBackground'];
function cloneMask(m){
  if (!m || !m.data || !m.data.canvas) return m;
  const c = mkCanvas(m.data.canvas.width, m.data.canvas.height); ctx2d(c).drawImage(m.data.canvas, 0, 0);
  return Object.assign({}, m, {data:{canvas:c, ctx:ctx2d(c)}, _cache:null, _cacheScale:0});
}
const cloneExtra = (k, v) => v == null ? v : (k === 'mask' || k === 'maskOff') ? cloneMask(v) : typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
function grabExtra(L){ const o = {}; EXTRA.forEach(k => { if (L[k] !== undefined && L[k] !== null) o[k] = cloneExtra(k, L[k]); }); return o; }
function putExtra(L, o){
  EXTRA.forEach(k => {
    if (o && o[k] !== undefined) L[k] = cloneExtra(k, o[k]);
    else if (k === 'mask') L.mask = null;
    else delete L[k];
  });
}
if (!History._extraProps && !History._psLayerShim){
  const snap0 = History.snap, restore0 = History.restore, rip0 = History.restoreInPlace;
  const apply = s => {
    if (!s || !s.psExtra) return;
    Doc.layers.forEach((L, i) => putExtra(L, s.psExtra[i]));
    Doc.globalLight = s.psGlobalLight ? Object.assign({}, s.psGlobalLight) : undefined;
  };
  History.snap = function(){
    const s = snap0.apply(this, arguments);
    s.psExtra = Doc.layers.map(grabExtra);                         // 与 s.layers 同序
    s.psGlobalLight = Doc.globalLight ? Object.assign({}, Doc.globalLight) : null;
    return s;
  };
  History.restore = function(s){ const r = restore0.apply(this, arguments); apply(s); return r; };
  History.restoreInPlace = function(s){ const r = rip0.apply(this, arguments); apply(s); return r; };
  History._psLayerShim = true;
}

/* ═══════════ 共用小件 ═══════════ */
const layerOf = p => Doc.byId((p && (p.id || p.layer)) || Doc.activeId);
/* 多选：p.ids ＞ Doc.selectedIds（须含当前层，否则视为过期）＞ 当前层；一律由下到上 */
function idsOf(p){
  let ids = p && Array.isArray(p.ids) && p.ids.length ? p.ids : null;
  if (!ids && Array.isArray(Doc.selectedIds) && Doc.selectedIds.includes(Doc.activeId)) ids = Doc.selectedIds;
  if (!ids) ids = Doc.activeId ? [Doc.activeId] : [];
  return [...new Set(ids)].filter(id => Doc.byId(id)).sort((a, b) => Doc.index(a) - Doc.index(b));
}
/* extra_cmds.rs:45 is_background：名字是 Background＋透明锁＋位置锁＋像素层；我们的新文件不带锁 ⇒ 认最底一层叫「背景」的像素层 */
function isBackground(L){
  if (!L || Doc.layers[0] !== L || L.kind !== 'raster') return false;
  if (L.isBackground !== undefined) return !!L.isBackground;
  return ['背景', 'Background', Lang.t('layer.bg')].includes(L.name);
}
/* doc.next_layer_name("Layer")：现有「图层 N」最大的 N＋1 */
function nextLayerName(base){
  base = base || Lang.t('layer.untitled');
  let n = 0; const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' (\\d+)$');
  Doc.layers.forEach(L => { const m = re.exec(L.name); if (m) n = Math.max(n, +m[1]); });
  return base + ' ' + (n + 1);
}
/* extra_cmds.rs:343 unlock_background：变成普通层「图层 0」 */
function unlockBackground(L){
  L.name = Lang.t('layer.untitled') + ' 0';
  L.isBackground = false;
  if (L.locks){ L.locks.transparency = false; L.locks.position = false; }
}
const bgColor = () => { const e = document.getElementById('strokeColor'); return (e && e.value) || '#ffffff'; };   // PS 版面：背景色＝第二个色块
/* 层的像素在「文件坐标」的一张画布（像素层按位移贴；矢量／文字 renderLayer 已含位移） */
function docPixels(L){
  const c = mkCanvas(Doc.width, Doc.height), x = ctx2d(c);
  if (L.kind === 'raster') x.drawImage(L.data.canvas, L.x || 0, L.y || 0);
  else x.drawImage(renderLayer(L, 1), 0, 0);
  return c;
}
/* 选区覆盖度：白色＋alpha，画在 L 的空间（像素层＝图层坐标；L 省略或非像素层＝文件坐标） */
function selCanvas(L){
  const s = Doc.sel; if (!s) return null;
  const R = L && L.kind === 'raster' ? L : null;
  if (window.SelMask) return SelMask.maskCanvas(R);
  const c = R ? mkCanvas(R.data.canvas.width, R.data.canvas.height) : mkCanvas(Doc.width, Doc.height), x = ctx2d(c);
  x.fillStyle = '#fff'; x.fillRect(s.x - (R ? R.x : 0), s.y - (R ? R.y : 0), s.w, s.h); return c;
}
function alphaEmpty(c){
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
  return true;
}
const copyProps = (from, to) => Object.assign(to, {visible:from.visible, opacity:from.opacity, blend:from.blend});

/* 跟 engine composite() 一样画一层（含蒙版、不透明度、混合；有效果就走 PsLayerStyle）——合并／拼合用 */
function drawOne(ctx, L, scale){
  scale = scale || 1;
  if (!L.visible || L.opacity <= 0) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  let src = renderLayer(L, scale);
  if (L.mask){
    const m = mkCanvas(W, H), mx = m.getContext('2d');
    mx.drawImage(src, 0, 0, W, H);
    mx.globalCompositeOperation = 'destination-in';
    mx.drawImage(renderLayer(L.mask, scale), 0, 0, W, H);
    src = m;
  }
  if (PsLayerStyle.has(L)){ PsLayerStyle.draw(ctx, L, src, scale); return; }
  const off = L.kind === 'raster' && (L.x || L.y);
  blendDraw(ctx, src, off ? L.x * scale : 0, off ? L.y * scale : 0, L.blend, L.opacity * (L.fillOpacity === undefined ? 1 : L.fillOpacity));
}
/* 一组层压成一张文件大小的画布（由下到上） */
function flattenLayers(list, under){
  const c = mkCanvas(Doc.width, Doc.height), x = ctx2d(c);
  if (under){ x.fillStyle = under; x.fillRect(0, 0, c.width, c.height); }
  list.forEach(L => drawOne(x, L, 1));
  return c;
}
function rasterFrom(canvas, name){
  const N = Layer.raster(name);
  N.data.ctx.drawImage(canvas, 0, 0);
  return N;
}

/* ═══════════ 蒙版 ═══════════ */
let _mseq = 0;
function blankMask(L, reveal){
  const R = L.kind === 'raster';
  const c = mkCanvas(R ? L.data.canvas.width : Doc.width, R ? L.data.canvas.height : Doc.height), x = ctx2d(c);
  if (reveal){ x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); }
  // defaultColor＝PS 蒙版预设色（显示全部／隐藏选区＝白 255，隐藏全部／显示选区＝黑 0）：画布变大时新长出来的地方补这个色（menus/impl/ps-image.js geomOp）
  return {id:'M' + (++_mseq), kind:'raster', name:'mask', visible:true, opacity:1, blend:'normal', mask:null, x:0, y:0, _cache:null, _cacheScale:0, data:{canvas:c, ctx:x}, defaultColor:reveal ? 255 : 0};
}
/* commands.rs:1058 set_mask：加蒙版前，背景层先变「图层 0」（extra_cmds.rs:351 background_to_layer_for_mask） */
function setMask(L, m){
  if (m && isBackground(L)) unlockBackground(L);
  L.mask = m; delete L.maskOff;
  Doc.maskEdit = m ? L.id : (Doc.maskEdit === L.id ? null : Doc.maskEdit);   // PS：加了蒙版就是在编辑蒙版（缩图外框框住蒙版）
}
const maskOf = L => L.mask || L.maskOff || null;

/* ═══════════ 图层样式：参数（layer_style.rs effect_from_params）═══════════ */
const FX_KINDS = ['dropShadow', 'innerShadow', 'outerGlow', 'innerGlow', 'satin', 'colorOverlay', 'gradientOverlay', 'stroke'];
const FX_NAME = {
  dropShadow:['陰影', '投影', 'Drop Shadow'], innerShadow:['內陰影', '内阴影', 'Inner Shadow'],
  outerGlow:['外光暈', '外发光', 'Outer Glow'], innerGlow:['內光暈', '内发光', 'Inner Glow'],
  satin:['緞面', '光泽', 'Satin'], colorOverlay:['顏色覆蓋', '颜色叠加', 'Color Overlay'],
  gradientOverlay:['漸層覆蓋', '渐变叠加', 'Gradient Overlay'], stroke:['筆畫', '描边', 'Stroke']
};
/* 别档挂进图层样式对话框的效果（ps-layer2：斜面和浮雕）：{name, defaults, spec, valuesOf(e), fromParams(p)}；setAll 由挂的那档包 */
const FX_EXT = {};
const fxName = k => L3(...(FX_NAME[k] || (FX_EXT[k] && FX_EXT[k].name) || [k, k, k]));
function parseBlend(v, d){
  if (v === undefined || v === null || v === '') return d;
  const k = String(v).replace(/[\s_-]+/g, '').toLowerCase(), b = BLENDS.find(x => x.toLowerCase() === k);   // 不分大小写（colorDodge／Color Dodge／colordodge 都认）
  if (!b) throw new Error(`unknown blend mode \`${v}\``);
  return b;
}
/* layer_style.rs:30 color：'#rrggbb' 或 [r,g,b]（0..1） */
function parseColor(v, d){
  if (Array.isArray(v) && v.length >= 3) return '#' + v.slice(0, 3).map(x => Math.round(clamp(+x || 0, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  if (typeof v === 'string'){ const s = v.replace('#', ''); if (/^[0-9a-f]{6}/i.test(s)) return '#' + s.slice(0, 6).toLowerCase(); }
  return d;
}
function effectFromParams(kind, p){
  const common = (blend, opacity) => ({kind, enabled:bool(p, 'enabled', true), blend:parseBlend(p.blend, blend), opacity:clamp(num(p, 'opacity', opacity * 100) / 100, 0, 1)});
  const shadow = (inner) => Object.assign(common('multiply', 0.75), {
    color:parseColor(p.color, '#000000'), angle:num(p, 'angle', 120), useGlobalLight:bool(p, 'useGlobalLight', true),
    distance:num(p, 'distance', 5), spread:num(p, inner ? 'choke' : 'spread', 0) / 100, size:num(p, 'size', 5),
    knocksOut:!inner && bool(p, 'knocksOut', true)});
  const glow = (inner) => Object.assign(common('screen', 0.75), {
    color:parseColor(p.color, '#ffffbe'), technique:p.technique === 'precise' ? 'precise' : 'softer',
    spread:num(p, inner ? 'choke' : 'spread', 0) / 100, size:num(p, 'size', 5), range:num(p, 'range', 50) / 100,
    source:p.source === 'center' ? 'center' : 'edge'});
  const gradient = () => ({from:parseColor(p.from, '#000000'), to:parseColor(p.to, '#ffffff'),
    style:['linear', 'radial', 'angle', 'reflected', 'diamond'].includes(String(p.style).toLowerCase()) ? String(p.style).toLowerCase() : 'linear',
    angle:num(p, 'angle', 90), scale:num(p, 'scale', 100) / 100, reverse:bool(p, 'reverse', false)});
  switch (kind){
    case 'dropShadow': return shadow(false);
    case 'innerShadow': return shadow(true);
    case 'outerGlow': return glow(false);
    case 'innerGlow': return glow(true);
    case 'stroke': return Object.assign(common('normal', 1), {size:num(p, 'size', 3),
      position:p.position === 'inside' ? 'inside' : p.position === 'center' ? 'center' : 'outside',
      color:parseColor(p.color, '#ff0000'), gradient:p.from !== undefined ? gradient() : null});
    case 'colorOverlay': return Object.assign(common('normal', 1), {color:parseColor(p.color, '#ff0000')});
    case 'gradientOverlay': return Object.assign(common('normal', 1), gradient());
    case 'satin': return Object.assign(common('multiply', 0.5), {color:parseColor(p.color, '#000000'),
      angle:num(p, 'angle', 19), distance:num(p, 'distance', 11), size:num(p, 'size', 14), invert:bool(p, 'invert', true)});
  }
  return null;
}
/* ui-egui layer_style.rs:174 values_of：效果 → 对话框／命令参数单位（%） */
function valuesOf(e){
  const v = {blend:e.blend, opacity:Math.round(e.opacity * 100)};
  if (e.kind === 'dropShadow' || e.kind === 'innerShadow') Object.assign(v, {color:e.color, angle:e.angle, distance:e.distance, size:e.size,
    [e.kind === 'dropShadow' ? 'spread' : 'choke']:Math.round(e.spread * 100), useGlobalLight:e.useGlobalLight}, e.kind === 'dropShadow' ? {knocksOut:e.knocksOut} : {});
  else if (e.kind === 'outerGlow' || e.kind === 'innerGlow') Object.assign(v, {color:e.color, size:e.size, range:Math.round(e.range * 100), technique:e.technique,
    [e.kind === 'outerGlow' ? 'spread' : 'choke']:Math.round(e.spread * 100)}, e.kind === 'innerGlow' ? {source:e.source} : {});
  else if (e.kind === 'stroke') Object.assign(v, {size:e.size, position:e.position, color:e.color});
  else if (e.kind === 'colorOverlay') v.color = e.color;
  else if (e.kind === 'gradientOverlay') Object.assign(v, {from:e.from, to:e.to, style:e.style, angle:e.angle, scale:Math.round(e.scale * 100), reverse:e.reverse});
  else if (e.kind === 'satin') Object.assign(v, {color:e.color, angle:e.angle, distance:e.distance, size:e.size, invert:e.invert});
  return v;
}
/* ui-egui layer_style.rs:135 defaults（对话框的预设；与命令预设只差描边颜色黑） */
const FX_DEFAULTS = {
  dropShadow:{blend:'multiply', color:'#000000', opacity:75, angle:120, useGlobalLight:true, distance:5, spread:0, size:5, knocksOut:true},
  innerShadow:{blend:'multiply', color:'#000000', opacity:75, angle:120, useGlobalLight:true, distance:5, choke:0, size:5},
  outerGlow:{blend:'screen', opacity:75, color:'#ffffbe', spread:0, size:5, range:50},
  innerGlow:{blend:'screen', opacity:75, color:'#ffffbe', source:'edge', choke:0, size:5},
  stroke:{size:3, position:'outside', blend:'normal', opacity:100, color:'#000000'},
  colorOverlay:{blend:'normal', color:'#ff0000', opacity:100},
  gradientOverlay:{blend:'normal', opacity:100, from:'#000000', to:'#ffffff', reverse:false, style:'linear', angle:90, scale:100},
  satin:{blend:'multiply', color:'#000000', opacity:50, angle:19, distance:11, size:14, invert:true}
};
function ensureStyle(L){ if (!L.style || !Array.isArray(L.style.items)) L.style = {enabled:true, items:[]}; return L.style; }

/* ═══════════ 效果渲染（compose/src/effects.rs 的 CPU 版照抄） ═══════════
   Map＝单通道 Float32Array（w×h）；Buffer＝直通 RGBA Float32Array（4×w×h，0..1）。 */
const INSIDE_EPS = 0.5 / 255;
const CHAMFER_INF = 1e20;
const MAX_REACH = 512;
const inside = a => a > INSIDE_EPS;

/* effects.rs:106 dt1（Felzenszwalb & Huttenlocher） */
function dt1(f, out, v, z, near, n){
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++){
    for (;;){
      const p = v[k];
      const s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s <= z[k] && k > 0){ k--; continue; }
      if (s <= z[k]){ v[0] = q; z[0] = -Infinity; z[1] = Infinity; break; }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity; break;
    }
  }
  k = 0;
  for (let q = 0; q < n; q++){
    while (z[k + 1] < q) k++;
    const p = v[k], d = q - p;
    out[q] = d * d + f[p]; if (near) near[q] = p;
  }
}
/* effects.rs:154 edt_nearest：到最近 inside 像素的欧氏距离＋那个像素的索引 */
function edtNearest(ins, w, h){
  const INF = 1e20, g = new Float64Array(w * h), nearRow = new Int32Array(w * h), nearest = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = ins[i] ? 0 : INF;
  const n = Math.max(w, h, 1), f = new Float64Array(n), o = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), nr = new Int32Array(n);
  for (let x = 0; x < w; x++){
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    dt1(f, o, v, z, nr, h);
    for (let y = 0; y < h; y++){ g[y * w + x] = o[y]; nearRow[y * w + x] = nr[y]; }
  }
  for (let y = 0; y < h; y++){
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    dt1(f, o, v, z, nr, w);
    for (let x = 0; x < w; x++){ g[y * w + x] = Math.sqrt(o[x]); const px = nr[x]; nearest[y * w + x] = nearRow[y * w + px] * w + px; }
  }
  return [g, nearest];
}
/* effects.rs:197 chamfer_from：5×5 倒角距离（1、√2、√5），起点值＝次像素边缘偏移 */
const CH_OX = [-1, -1, 0, 1, -1, 1, -2, 2], CH_OY = [0, -1, -1, -1, -2, -2, -1, -1], CH_WT = [1, Math.SQRT2, 1, Math.SQRT2, 2.236068, 2.236068, 2.236068, 2.236068];
function chamferFrom(d, w, h){
  // 前向一趟（已扫过的邻居）＋反向一趟（镜像）；邻居表摊平成数组，免得热回圈里解构
  for (let pass = 0; pass < 2; pass++){
    const sg = pass ? -1 : 1;
    for (let yy = 0; yy < h; yy++){
      const y = pass ? h - 1 - yy : yy;
      for (let xx = 0; xx < w; xx++){
        const x = pass ? w - 1 - xx : xx, i = y * w + x;
        let best = d[i];
        for (let k = 0; k < 8; k++){
          const nx = x + CH_OX[k] * sg, ny = y + CH_OY[k] * sg;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const c = d[ny * w + nx] + CH_WT[k]; if (c < best) best = c;
        }
        d[i] = best;
      }
    }
  }
  return d;
}
/* effects.rs:253 dist_outside_by */
function distOutside(s, w, h, chamfer){
  const n = w * h, out = new Float32Array(n);
  if (chamfer){
    const st = new Float32Array(n);
    for (let i = 0; i < n; i++) st[i] = s[i] > INSIDE_EPS ? 1 - Math.min(s[i], 1) : CHAMFER_INF;
    const d = chamferFrom(st, w, h);
    for (let i = 0; i < n; i++) out[i] = s[i] > INSIDE_EPS ? -0.5 : d[i] - 0.5;
    return out;
  }
  const ins = new Uint8Array(n); for (let i = 0; i < n; i++) ins[i] = s[i] > INSIDE_EPS ? 1 : 0;
  const [d, near] = edtNearest(ins, w, h);
  for (let i = 0; i < n; i++) out[i] = ins[i] ? -0.5 : d[i] - 0.5 + (1 - Math.min(s[near[i]], 1));
  return out;
}
/* effects.rs:299 local_coverage */
function localCoverage(s, w, h){
  const out = Float32Array.from(s);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const a = s[y * w + x]; if (a <= INSIDE_EPS) continue;
    let mx = a;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
      const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) mx = Math.max(mx, s[Y * w + X]);
    }
    out[y * w + x] = Math.min(a / mx, 1);
  }
  return out;
}
/* effects.rs:271 dist_inside_by */
function distInside(s, w, h, chamfer){
  const n = w * h, out = new Float32Array(n);
  if (chamfer){
    const cov = localCoverage(s, w, h), st = new Float32Array(n);
    for (let i = 0; i < n; i++) st[i] = s[i] <= INSIDE_EPS ? 0 : cov[i] < 1 - INSIDE_EPS ? cov[i] : CHAMFER_INF;
    const d = chamferFrom(st, w, h);
    for (let i = 0; i < n; i++) out[i] = s[i] <= INSIDE_EPS ? -0.5 : d[i] - 0.5;
    return out;
  }
  const outs = new Uint8Array(n); for (let i = 0; i < n; i++) outs[i] = s[i] <= INSIDE_EPS ? 1 : 0;
  const [d] = edtNearest(outs, w, h);
  for (let i = 0; i < n; i++) out[i] = outs[i] ? -0.5 : d[i] - 0.5;
  return out;
}
/* effects.rs:684-724 box_geom／box_line／tent_line：两次盒状模糊＝帐篷核，跑和 O(1) */
function boxGeom(bw){
  const half = Math.max(bw, 1) / 2, r = Math.max(0, Math.ceil(half - 0.5));
  return [r, clamp(half - (r - 0.5), 0, 1), 1 / Math.max(bw, 1)];
}
function boxLine(src, x0, dst, bw){
  const n = src.length, [r, f, norm] = boxGeom(bw), at = i => (i >= 0 && i < n) ? src[i] : 0;
  if (r === 0){ for (let k = 0; k < dst.length; k++) dst[k] = at(x0 + k); return; }
  let inner = 0; for (let i = x0 - (r - 1); i <= x0 + (r - 1); i++) inner += at(i);
  for (let k = 0; k < dst.length; k++){
    const x = x0 + k;
    dst[k] = (inner + f * (at(x - r) + at(x + r))) * norm;
    inner += at(x + r) - at(x - r + 1);
  }
}
function tentLine(src, bw){
  const [r] = boxGeom(bw), mid = new Float64Array(src.length + 2 * r), out = new Float64Array(src.length);
  boxLine(src, -r, mid, bw); boxLine(mid, r, out, bw);
  return out;
}
/* effects.rs:766 tent：先横后直 */
function tent(m, w, h, bw){
  if (!isFinite(bw) || boxGeom(bw)[0] === 0 || !m.length) return m;
  const row = new Float64Array(w);
  for (let y = 0; y < h; y++){ for (let x = 0; x < w; x++) row[x] = m[y * w + x]; const o = tentLine(row, bw); for (let x = 0; x < w; x++) m[y * w + x] = o[x]; }
  const col = new Float64Array(h);
  for (let x = 0; x < w; x++){ for (let y = 0; y < h; y++) col[y] = m[y * w + x]; const o = tentLine(col, bw); for (let y = 0; y < h; y++) m[y * w + x] = o[y]; }
  return m;
}
/* effects.rs:336 dilate（倒角距离，部分覆盖的像素从自己的覆盖度往外长） */
function dilate(s, w, h, r){
  if (r <= 0) return Float32Array.from(s);
  const d = distOutside(s, w, h, true), out = Float32Array.from(s);
  for (let i = 0; i < out.length; i++) out[i] = d[i] < 0 ? Math.min(out[i] + r, 1) : Math.max(out[i], clamp(r + 0.5 - d[i], 0, 1));
  return out;
}
/* effects.rs:78 shifted（双线性；出界读 outside） */
function shifted(s, w, h, dx, dy, outside){
  const out = new Float32Array(w * h), fx = Math.floor(dx), fy = Math.floor(dy), ax = dx - fx, ay = dy - fy;
  if (!ax && !ay){                                  // 整像素位移（offset 一律取整）：直接搬
    for (let y = 0; y < h; y++){ const sy = y - fy; for (let x = 0; x < w; x++){ const sx = x - fx; out[y * w + x] = (sx < 0 || sy < 0 || sx >= w || sy >= h) ? outside : s[sy * w + sx]; } }
    return out;
  }
  const g =(x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? outside : s[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const sx = x - fx, sy = y - fy;
    const top = g(sx, sy) * (1 - ax) + g(sx - 1, sy) * ax, bot = g(sx, sy - 1) * (1 - ax) + g(sx - 1, sy - 1) * ax;
    out[y * w + x] = top * (1 - ay) + bot * ay;
  }
  return out;
}
/* effects.rs:415 offset：影子往光的反方向，取整像素 */
const fxOffset = (angle, dist) => { const a = angle * Math.PI / 180; return [Math.round(-Math.cos(a) * dist), Math.round(Math.sin(a) * dist)]; };
/* effects.rs:527 spread_split */
const spreadSplit = (size, spread) => [Math.round(size * spread), size * (1 - spread)];
/* effects.rs:531 shadow_map */
function shadowMap(shape, w, h, e, light, inner, k){
  const angle = e.useGlobalLight ? light.angle : e.angle;
  const [dx, dy] = fxOffset(angle, e.distance * k);
  const src = inner ? shape.map(a => 1 - a) : shape;
  let m = shifted(src, w, h, dx, dy, inner ? 1 : 0);
  const [r, bw] = spreadSplit(e.size * k, e.spread);
  m = dilate(m, w, h, r); tent(m, w, h, bw);
  if (inner) for (let i = 0; i < m.length; i++) m[i] *= shape[i];
  return m;
}
/* effects.rs:368 glow_lut：contour(min(v / range, 1))（等高线只做线性） */
const rangedLut = (m, range) => { const r = isFinite(range) ? clamp(range, 0.01, 1) : 1; if (r >= 0.999) return m; for (let i = 0; i < m.length; i++) m[i] = Math.min(m[i] / r, 1); return m; };
/* effects.rs:548 glow_map */
function glowMap(shape, w, h, e, inner, k){
  const size = e.size * k;
  const src = inner ? (e.source === 'center' ? shape : shape.map(a => 1 - a)) : shape;
  let m;
  if (e.technique === 'precise'){
    const d = (inner && e.source === 'edge') ? distInside(shape, w, h, false) : distOutside(src, w, h, false);
    const solid = size * e.spread, soft = Math.max(size - solid, 1e-3);
    m = new Float32Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = d[i] <= solid ? 1 : clamp(1 - (d[i] - solid) / soft, 0, 1);
    if (inner && e.source === 'center') for (let i = 0; i < m.length; i++) m[i] = 1 - m[i];
  } else {
    const [r, bw] = spreadSplit(size, e.spread);
    m = dilate(src, w, h, r); tent(m, w, h, bw);
    if (inner && e.source === 'center'){
      const ee = dilate(shape.map(a => 1 - a), w, h, r); tent(ee, w, h, bw);
      m = ee.map(v => 1 - v);
    }
  }
  m = rangedLut(m, e.range);
  if (inner) for (let i = 0; i < m.length; i++) m[i] *= shape[i];
  return m;
}
/* effects.rs:1058 satin_map */
function satinMap(shape, w, h, e, k){
  const [dx, dy] = fxOffset(e.angle, e.distance * k);
  const a = tent(shifted(shape, w, h, dx, dy, 0), w, h, e.size * k), b = tent(shifted(shape, w, h, -dx, -dy, 0), w, h, e.size * k);
  const m = new Float32Array(w * h);
  for (let i = 0; i < m.length; i++){ let v = Math.abs(a[i] - b[i]); if (e.invert) v = 1 - v; m[i] = v * shape[i]; }
  return m;
}
/* effects.rs:1414 stroke_widths */
const strokeWidths = (st, k) => st.position === 'inside' ? [st.size * k, 0] : st.position === 'center' ? [st.size * k / 2, st.size * k / 2] : [0, st.size * k];

/* ── 混合（compose/src/psblend.rs composite：W3C 通式，直通 alpha）── */
const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c){
  const l = lum(c), n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]);
  let o = c.slice();
  if (n < 0) o = o.map(v => l + (v - l) * l / (l - n));
  if (x > 1) o = o.map(v => l + (v - l) * (1 - l) / (x - l));
  return o;
}
const setLum = (c, l) => { const d = l - lum(c); return clipColor([c[0] + d, c[1] + d, c[2] + d]); };
const sat = c => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
function setSat(c, s){
  const o = [0, 0, 0], idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [mn, md, mx] = idx;
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
function blendRGB(mode, cb, cs){
  const sep = f => [f(cb[0], cs[0]), f(cb[1], cs[1]), f(cb[2], cs[2])];
  switch (mode){
    case 'multiply': return sep((b, s) => b * s);
    case 'screen': return sep((b, s) => b + s - b * s);
    case 'overlay': return sep((b, s) => b <= 0.5 ? 2 * b * s : s + (2 * b - 1) - s * (2 * b - 1));
    case 'darken': return sep(Math.min);
    case 'lighten': return sep(Math.max);
    case 'difference': return sep((b, s) => Math.abs(b - s));
    case 'hue': return setLum(setSat(cs, sat(cb)), lum(cb));
    case 'saturation': return setLum(setSat(cb, sat(cs)), lum(cb));
    case 'color': return setLum(cs, lum(cb));
    case 'luminosity': return setLum(cb, lum(cs));
    default: return cs;
  }
}
/* 把来源 (r,g,b,a) 用 mode 合到 dst[i*4..] 上 */
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
  if (mode === 'hue' || mode === 'saturation' || mode === 'color' || mode === 'luminosity'){
    const cb = [dst[j], dst[j + 1], dst[j + 2]], cs = [r, g, b], B = blendRGB(mode, cb, cs);
    for (let c = 0; c < 3; c++) dst[j + c] = k1 * cb[c] + k2 * cs[c] + k3 * B[c];
  } else {                                          // 可分离的模式逐通道算，不配阵列（热回圈）
    const b0 = dst[j], b1 = dst[j + 1], b2 = dst[j + 2];
    dst[j] = k1 * b0 + k2 * r + k3 * blendCh(mode, b0, r);
    dst[j + 1] = k1 * b1 + k2 * g + k3 * blendCh(mode, b1, g);
    dst[j + 2] = k1 * b2 + k2 * b + k3 * blendCh(mode, b2, b);
  }
  dst[j + 3] = ao;
}
const hexRGB = h => { const c = hexToRGB(h || '#000000'); return [c[0] / 255, c[1] / 255, c[2] / 255]; };
/* effects.rs:509 paint／paint_color */
function paintColor(dst, m, rgb, blend, opacity){
  for (let i = 0; i < m.length; i++){ const a = m[i] * opacity; if (a > 0) compositePx(blend, dst, i, rgb[0], rgb[1], rgb[2], a); }
}
/* effects.rs:422 gradient_units／438 gradient_t；fill_layout.rs:29 gradient_layout（线性／对称的端点贴整像素） */
function gradientUnits(angle, w, h){
  const a = angle * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
  const len = Math.max(Math.sqrt((c * w) ** 2 + (s * h) ** 2), 1);
  const chord = Math.max(Math.min(w / Math.max(Math.abs(c), 1e-6), h / Math.max(Math.abs(s), 1e-6)), 1);
  return [chord, len];
}
function gradientLayout(style, angle, scale, offset, fr){
  const unchanged = [angle, scale, offset];
  if (!(style === 'linear' || style === 'reflected')) return unchanged;
  const w = Math.max(fr.w, 1), h = Math.max(fr.h, 1);
  const cx = fr.x + w / 2 + offset[0] * w, cy = fr.y + h / 2 + offset[1] * h;
  const chordOf = a => { const s = Math.sin(a), c = Math.cos(a); return Math.max(Math.min(w / Math.max(Math.abs(c), 1e-6), h / Math.max(Math.abs(s), 1e-6)), 1); };
  const a = angle * Math.PI / 180, half = chordOf(a) * Math.max(scale, 1e-3) / 2;
  const dx = Math.cos(a) * half, dy = -Math.sin(a) * half, snap = v => Math.floor(v + 1e-4);
  const end = [snap(cx + dx), snap(cy + dy)];
  let start, mid;
  if (style === 'reflected'){ start = [cx, cy]; mid = [cx, cy]; }
  else { start = [snap(cx - dx), snap(cy - dy)]; mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]; }
  const v = [end[0] - start[0], end[1] - start[1]], len = Math.hypot(v[0], v[1]);
  if (len < 0.5) return unchanged;
  const a2 = Math.atan2(-v[1], v[0]), span = style === 'reflected' ? 2 * len : len;
  return [a2 * 180 / Math.PI, span / chordOf(a2), [offset[0] + (mid[0] - cx) / w, offset[1] + (mid[1] - cy) / h]];
}
function gradientT(style, angle, scale, reverse, offset, fr, x, y){
  const w = Math.max(fr.w, 1), h = Math.max(fr.h, 1);
  const cx = fr.x + w / 2 + offset[0] * w, cy = fr.y + h / 2 + offset[1] * h;
  const a = angle * Math.PI / 180, s = Math.sin(a), c = Math.cos(a), dx = x - cx, dy = y - cy;
  const along = dx * c - dy * s, across = dx * s + dy * c;
  let [chord, len] = gradientUnits(angle, w, h); chord *= Math.max(scale, 1e-3); len *= Math.max(scale, 1e-3);
  const corner = 0.5 * (c - s);
  let t;
  if (style === 'reflected') t = Math.abs((along - corner) / (chord / 2));
  else if (style === 'radial') t = Math.sqrt(dx * dx + dy * dy) / (len / 2);
  else if (style === 'diamond') t = (Math.abs(along) + Math.abs(across)) / (len / 2);
  else if (style === 'angle'){ t = ((a - Math.atan2(-dy, dx)) / (2 * Math.PI)) % 1; if (t < 0) t += 1; }
  else t = (along - corner) / chord + 0.5;
  t = clamp(t, 0, 1);
  return reverse ? 1 - t : t;
}
/* effects.rs:622 paint_fx（颜色或渐变）；fr＝渐变排布框（文件像素），big＝这块缓冲在文件里的位置 */
function paintFx(dst, m, paint, fr, big, blend, opacity){
  if (!paint.gradient){ paintColor(dst, m, hexRGB(paint.color), blend, opacity); return; }
  const g = paint.gradient, A = hexRGB(g.from), B = hexRGB(g.to);
  const [angle, scale, off] = gradientLayout(g.style, g.angle, g.scale, [0, 0], fr);
  for (let i = 0; i < m.length; i++){
    const a = m[i] * opacity; if (a <= 0) continue;
    const x = big.x + (i % big.w) + 0.5, y = big.y + Math.floor(i / big.w) + 0.5;
    const t = gradientT(g.style, angle, scale, g.reverse, off, fr, x, y);
    compositePx(blend, dst, i, A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t, a);
  }
}
/* effects.rs:1427 stroke_frame */
function strokeFrame(shape, big, outW){
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < big.h; y++) for (let x = 0; x < big.w; x++) if (shape[y * big.w + x] > INSIDE_EPS){ x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  if (x1 < 0) return {x:big.x, y:big.y, w:big.w, h:big.h};
  const g = isFinite(outW) ? Math.max(Math.ceil(Math.min(outW, MAX_REACH)) - 1, 0) : 0;
  return {x:big.x + x0 - g, y:big.y + y0 - g, w:x1 - x0 + 2 * g, h:y1 - y0 + 2 * g};
}
/* effects.rs:1077 build_maps：每个效果的覆盖度图＋描边要的内外距离 */
function buildMaps(items, shape, big, light, k){
  const {w, h} = big;
  const per = items.map(e =>
    e.kind === 'dropShadow' ? shadowMap(shape, w, h, e, light, false, k) :
    e.kind === 'innerShadow' ? shadowMap(shape, w, h, e, light, true, k) :
    e.kind === 'outerGlow' ? glowMap(shape, w, h, e, false, k) :
    e.kind === 'innerGlow' ? glowMap(shape, w, h, e, true, k) :
    e.kind === 'satin' ? satinMap(shape, w, h, e, k) : null);
  const hasStroke = items.some(e => e.kind === 'stroke');
  return {per, din:hasStroke ? distInside(shape, w, h, true) : null, dout:hasStroke ? distOutside(shape, w, h, true) : null};
}
/* 描边某像素的颜色（颜色描边＝定值；渐变描边照 paint_fx 的渐变取样） */
function strokeColorAt(st, fr, big){
  if (!st.gradient){ const c = hexRGB(st.color); return () => c; }
  const g = st.gradient, A = hexRGB(g.from), B = hexRGB(g.to), out = [0, 0, 0];
  const [angle, scale, off] = gradientLayout(g.style, g.angle, g.scale, [0, 0], fr);
  return i => {
    const t = gradientT(g.style, angle, scale, g.reverse, off, fr, big.x + (i % big.w) + 0.5, big.y + Math.floor(i / big.w) + 0.5);
    out[0] = A[0] + (B[0] - A[0]) * t; out[1] = A[1] + (B[1] - A[1]) * t; out[2] = A[2] + (B[2] - A[2]) * t; return out;
  };
}
/* effects.rs:1141 composite_with_effects_prepared（不含矢量描边／外框那两支：我们的矢量层已渲成像素）
   L 只读：style.items、fillOpacity、opacity、blend；content＝该层像素（已过蒙版）；before＝底下的背景（会被改写成结果） */
function composeFx(L, content, before, big, sb, k, maps){
  const n = big.w * big.h;
  const shape = new Float32Array(n); for (let i = 0; i < n; i++) shape[i] = content[i * 4 + 3];
  const items = L.style.items.filter(e => e.enabled !== false && FX_KINDS.includes(e.kind));
  const light = Doc.globalLight || {angle:120, altitude:30};
  maps = maps || buildMaps(items, shape, big, light, k);
  const work = Float32Array.from(before);
  const rev = items.map((e, i) => [i, e]).reverse();
  const fill = L.fillOpacity === undefined ? 1 : clamp(L.fillOpacity, 0, 1);
  // 外部效果：投影、外发光，直接合在背景上
  for (const [i, e] of rev) if (e.kind === 'dropShadow'){
    const m = maps.per[i], c = hexRGB(e.color), see = e.knocksOut ? 1 - fill : 0;
    for (let j = 0; j < n; j++){ const a = m[j] * (1 - shape[j] * see) * e.opacity; if (a > 0) compositePx(e.blend, work, j, c[0], c[1], c[2], a); }
  }
  for (const [i, e] of rev) if (e.kind === 'outerGlow') paintFx(work, maps.per[i], e, sb, big, e.blend, e.opacity);
  // 这一层：内容按填充不透明度，内部效果相对形状画上去，最后才乘形状 alpha
  const lay = new Float32Array(n * 4);
  for (let j = 0; j < n; j++){ lay[j * 4] = content[j * 4]; lay[j * 4 + 1] = content[j * 4 + 1]; lay[j * 4 + 2] = content[j * 4 + 2]; lay[j * 4 + 3] = (shape[j] > INSIDE_EPS) ? fill : 0; }
  const rel = m => { const o = new Float32Array(n); for (let j = 0; j < n; j++) o[j] = (shape[j] > INSIDE_EPS) ? Math.min(m[j] / shape[j], 1) : 0; return o; };
  let full = null; const getFull = () => { if (!full){ full = new Float32Array(n); for (let j = 0; j < n; j++) full[j] = (shape[j] > INSIDE_EPS) ? 1 : 0; } return full; };
  for (const [, e] of rev) if (e.kind === 'gradientOverlay') paintFx(lay, getFull(), {gradient:e}, sb, big, e.blend, e.opacity);
  for (const [, e] of rev) if (e.kind === 'colorOverlay') paintColor(lay, getFull(), hexRGB(e.color), e.blend, e.opacity);
  for (const [i, e] of rev) if (e.kind === 'satin') paintColor(lay, rel(maps.per[i]), hexRGB(e.color), e.blend, e.opacity);
  for (const [i, e] of rev) if (e.kind === 'innerGlow') paintFx(lay, rel(maps.per[i]), e, sb, big, e.blend, e.opacity);
  for (const [i, e] of rev) if (e.kind === 'innerShadow') paintColor(lay, rel(maps.per[i]), hexRGB(e.color), e.blend, e.opacity);
  // 描边：内侧部分画在层上（下面那个先画）
  const strokes = items.filter(e => e.kind === 'stroke');
  const frameOf = st => st.gradient ? strokeFrame(shape, big, strokeWidths(st, k)[1]) : sb;
  for (const st of strokes.slice().reverse()){
    const [inW] = strokeWidths(st, k); if (inW <= 0) continue;
    const m = new Float32Array(n);
    for (let j = 0; j < n; j++) m[j] = (shape[j] > INSIDE_EPS) ? clamp(inW + 0.5 - maps.din[j], 0, 1) : 0;
    paintFx(lay, m, st, frameOf(st), big, st.blend, st.opacity);
  }
  for (let j = 0; j < n; j++) lay[j * 4 + 3] *= Math.min(shape[j], 1);
  // 描边外侧部分：垫在层下面、用自己的模式合在背景上；上面的描边盖住下面的（base＝此刻的 work，回圈里不改 work，故不另拷）
  if (strokes.some(st => strokeWidths(st, k)[1] > 0)){
    const acc = new Float32Array(n * 4), cover = new Float32Array(n), px = new Float32Array(4);
    for (const st of strokes){
      const outW = strokeWidths(st, k)[1]; if (outW <= 0) continue;
      const col = strokeColorAt(st, frameOf(st), big);
      for (let j = 0; j < n; j++){
        // 形状里面：只补「层没盖住」的那一份（effects.rs outline_share）——填充 100% 时边缘半透明像素底下照样垫满；
        // 填充 0＝层是空的 ⇒ 里面不垫描边，剩一圈外框（PS「填充 0＋外侧描边」做空心字／空心线条）
        const band0 = outW + 0.5 - maps.dout[j], band = band0 <= 0 ? 0 : band0 >= 1 ? 1 : band0;
        let kk = band;
        if (shape[j] > INSIDE_EPS){ const out = 1 - Math.min(shape[j], 1), rest = 1 - Math.min(lay[j * 4 + 3], 1); kk = rest <= 1e-6 ? 1 : Math.min(out / rest, 1); }
        const sh = kk * st.opacity * (1 - cover[j]); if (sh <= 0) continue;
        cover[j] += sh;
        // 描边以 100% 覆盖合在背景上的样子（effects.rs:1339 paint_fx(blended, ones…)）
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
  // 层（带内部效果）用层的模式合到外部结果上
  for (let j = 0; j < n; j++){ const a = lay[j * 4 + 3]; if (a > 0) compositePx(L.blend, work, j, lay[j * 4], lay[j * 4 + 1], lay[j * 4 + 2], a); }
  // 图层不透明度作用在整叠上（mix_premul）
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
function fxMargin(items, k){
  let m = 0;
  for (const e of items){
    const r = (e.kind === 'dropShadow' || e.kind === 'innerShadow' || e.kind === 'satin') ? e.distance + e.size : (e.kind === 'outerGlow' || e.kind === 'innerGlow' || e.kind === 'stroke') ? e.size : 0;
    if (isFinite(r)) m = Math.max(m, r);
  }
  return Math.ceil(clamp(m * k, 0, MAX_REACH)) + 2;
}
function writeBuf(ctx, b, buf){
  const img = ctx.createImageData(b.w, b.h);
  const d = img.data;                               // Uint8ClampedArray 自己会夹住与四舍五入
  for (let i = 0; i < buf.length; i++) d[i] = buf[i] * 255;
  putRect(ctx, b, img);
  return img;
}
/* 把一块 ImageData 换进 ctx 的 b 矩形：先放进离屏画布、再 clip＋copy 贴过去（直接 putImageData 到显示用的加速画布很慢） */
function putRect(ctx, b, img){
  const t = mkCanvas(b.w, b.h); ctx2d(t).putImageData(img, 0, 0);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
  ctx.globalCompositeOperation = 'copy'; ctx.drawImage(t, b.x, b.y);
  ctx.restore();
}
/* 层像素（文件空间，已过蒙版）的 alpha 外框 */
function alphaBox(c){
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data, W = c.width;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 3, p = 0; i < d.length; i += 4, p++) if (d[i]){ const x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  return x1 < 0 ? null : {x:x0, y:y0, w:x1 + 1 - x0, h:y1 + 1 - y0};
}
/* 8 位 → 0..1 浮点（独立小函数，热回圈好让引擎最佳化） */
function toF32(u8){ const o = new Float32Array(u8.length); for (let i = 0; i < u8.length; i++) o[i] = u8[i] * (1 / 255); return o; }
/* FNV 杂凑：start＝3 只看 alpha，start＝0 全部通道 */
function hash8(d, start){ let h = 2166136261; const step = start === 3 ? 4 : 1; for (let i = start; i < d.length; i += step){ h ^= d[i]; h = Math.imul(h, 16777619); } return h >>> 0; }

const PsLayerStyle = window.PsLayerStyle = {
  /* 命令参数（百分比单位）⇒ 一个效果（PSD 汇入接图层样式用） */
  fromParams(kind, p){ return effectFromParams(kind, p); },
  /* 这层有没有要画的效果 */
  has(L){ return !!(L && L.style && L.style.enabled !== false && Array.isArray(L.style.items) && L.style.items.some(e => e.enabled !== false && FX_KINDS.includes(e.kind))); },
  /* 给 composite() 用：把带效果的层画到 ctx（背景）上，取代原本那一笔 drawImage。src＝renderLayer 结果（已过蒙版），scale＝渲染倍率 */
  draw(ctx, L, src, scale){
    scale = scale || 1;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const ox = L.kind === 'raster' && (L.x || L.y) ? L.x * scale : 0, oy = L.kind === 'raster' && (L.x || L.y) ? L.y * scale : 0;
    // 层像素的外框按「来源像素票号＋尺寸＋位移＋画面尺寸」缓存——原本每次重画每个带效果的层都开一张整张画面大的画布、
    // 整张读回来找外框（17 层描边字×每次重画约 0.8 秒）；票号没变＝像素没变（engine.js PX）⇒ 外框不变，只读外框那一块。
    const tok = PX.tok(src), bkey = tok === undefined ? null : [tok, src.width, src.height, ox, oy, W, H].join('|');
    let sbox;
    if (bkey && L._fxBox && L._fxBox.key === bkey) sbox = L._fxBox.box;
    else {
      const lc = mkCanvas(W, H), lx = ctx2d(lc);
      lx.drawImage(src, ox, oy);
      sbox = alphaBox(lc);
      Object.defineProperty(L, '_fxBox', {value:bkey ? {key:bkey, box:sbox} : null, writable:true, configurable:true, enumerable:false});
    }
    if (!sbox) return;
    const items = L.style.items.filter(e => e.enabled !== false && FX_KINDS.includes(e.kind));
    const mg = fxMargin(items, scale);
    const x0 = Math.max(0, sbox.x - mg), y0 = Math.max(0, sbox.y - mg), x1 = Math.min(W, sbox.x + sbox.w + mg), y1 = Math.min(H, sbox.y + sbox.h + mg);
    const big = {x:x0, y:y0, w:x1 - x0, h:y1 - y0};
    const lc = mkCanvas(big.w, big.h);                     // 只开外框（＋效果边距）那一块
    ctx2d(lc).drawImage(src, ox - big.x, oy - big.y);
    const c8 = ctx2d(lc).getImageData(0, 0, big.w, big.h).data, b8 = ctx.getImageData(big.x, big.y, big.w, big.h).data;
    const hide = (k, v) => Object.defineProperty(L, k, {value:v, writable:true, configurable:true, enumerable:false});
    // 结果缓存：层像素、背景、效果参数、层的不透明度／模式都没变 ⇒ 直接贴上次的结果（滑鼠移动引起的重画不重算）
    const fkey = JSON.stringify([items, scale, Doc.globalLight || null, big, L.opacity, L.blend, L.fillOpacity]);
    const okey = fkey + '|' + hash8(c8, 0) + '|' + hash8(b8, 0);
    if (L._fxOut && L._fxOut.key === okey){ putRect(ctx, big, L._fxOut.img); return; }
    // 覆盖度图只跟形状（alpha）与效果参数有关 ⇒ 按这两样缓存，免得每次重画都重算距离场
    const mkey = fkey + '|' + hash8(c8, 3);
    let maps = L._fxMaps && L._fxMaps.key === mkey ? L._fxMaps.maps : null;
    const content = toF32(c8);
    if (!maps){
      const shape = new Float32Array(big.w * big.h); for (let i = 0; i < shape.length; i++) shape[i] = content[i * 4 + 3];
      maps = buildMaps(items, shape, big, Doc.globalLight || {angle:120, altitude:30}, scale);
      hide('_fxMaps', {key:mkey, maps});
    }
    const before = toF32(b8);
    composeFx(L, content, before, big, sbox, scale, maps);
    const img = writeBuf(ctx, big, before);
    hide('_fxOut', {key:okey, img});
  },
  /* 渲出一层「连同效果」的样子（透明底、文件大小）——测试与 agent 自己看用 */
  renderAlone(L){
    const c = mkCanvas(Doc.width, Doc.height);
    drawOne(ctx2d(c), Object.assign({}, L, {visible:true}), 1);
    return c;
  }
};

/* ═══════════ 对话框（DOM＋样式都在本档注入，不碰 style.css） ═══════════ */
(function injectCSS(){
  if (document.getElementById('psl-css')) return;
  const st = document.createElement('style'); st.id = 'psl-css';
  st.textContent = `
.psl-bg{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:10000}
.psl-dlg{background:#2b2f36;color:#e6e8eb;padding:14px 18px;border-radius:6px;min-width:260px;max-height:86vh;overflow:auto;font:13px sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)}
.psl-dlg h3{margin:0 0 10px;font-size:14px}
.psl-grid{display:grid;grid-template-columns:auto 150px;gap:7px 10px;align-items:center}
.psl-grid>span{color:#aab0ba}
.psl-grid input[type=number],.psl-grid input[type=text],.psl-grid select{width:100%;box-sizing:border-box;background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:3px 6px}
.psl-grid input[type=color]{width:60px;height:22px;padding:0;border:1px solid #444a54;background:none}
.psl-row{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.psl-row button{background:#3a404a;color:#e6e8eb;border:1px solid #555c68;border-radius:3px;padding:4px 14px;cursor:pointer}
.psl-row button.psl-ok{background:#2f7fd8;border-color:#2f7fd8;color:#fff}
.psl-fxwrap{display:flex;gap:14px}
.psl-fxlist{width:170px;border-right:1px solid #444a54;padding-right:8px}
.psl-fxlist div{padding:4px 6px;border-radius:3px;cursor:pointer;display:flex;gap:6px;align-items:center}
.psl-fxlist div.sel{background:#3d4654}
.psl-fxlist .hdr{color:#8a919c;cursor:default}
.psl-lyr{max-height:260px;overflow:auto;border:1px solid #444a54;border-radius:3px;padding:4px 8px;margin-top:4px}
.psl-lyr label{display:block;padding:2px 0}
.psl-bif{margin-top:14px;border-top:1px solid #444a54;padding-top:10px;width:276px}
.psl-bif-hd{display:flex;gap:8px;align-items:center;margin-bottom:6px}
.psl-bif-hd select{background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:2px 6px}
.psl-bif-lab{display:flex;gap:8px;color:#aab0ba;margin-top:6px}
.psl-bif-lab .psl-bif-num{color:#e6e8eb;min-width:52px}
.psl-bif-lab .psl-bif-num[data-bival$="white"]{margin-left:auto;text-align:right}
.psl-bif-track{position:relative;height:24px;margin:2px 6px 0;user-select:none}
.psl-bif-bar{position:absolute;left:0;right:0;top:0;height:12px;border:1px solid #555c68}
.psl-bif-h{position:absolute;top:13px;width:10px;height:10px;cursor:ew-resize;clip-path:polygon(50% 0,100% 100%,0 100%);box-sizing:border-box}
.psl-bif-h.lo,.psl-bif-h.hi{width:6px}
.psl-bif-h.lo{clip-path:polygon(100% 0,100% 100%,0 100%)}
.psl-bif-h.hi{clip-path:polygon(0 0,100% 100%,0 100%)}
.psl-bif-track::after{content:"";position:absolute;left:-6px;right:-6px;top:13px;height:10px;background:#8a919c;z-index:0}
.psl-bif-h{z-index:1}
.psl-bif-h.blk{background:#000}
.psl-bif-h.wht{background:#fff}`;
  document.head.appendChild(st);
})();
function closeDialog(){ document.querySelectorAll('.psl-bg').forEach(x => { const f = x._onClose; x._onClose = null; if (f) f(); x.remove(); }); }
/* fields：[{key, label:[繁,简,英], type:'number'|'text'|'color'|'check'|'select', min, max, step, value, options:[[值,[繁,简,英]]]}] */
function fieldRow(grid, f, val){
  const lab = document.createElement('span'); lab.textContent = L3(...f.label);
  let inp;
  if (f.type === 'select'){
    inp = document.createElement('select');
    f.options.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = Array.isArray(l) ? L3(...l) : l; inp.appendChild(o); });
    inp.value = val;
  } else {
    inp = document.createElement('input');
    inp.type = f.type === 'check' ? 'checkbox' : f.type || 'number';
    if (f.type === 'check') inp.checked = !!val;
    else { if (f.min !== undefined) inp.min = f.min; if (f.max !== undefined) inp.max = f.max; inp.step = f.step || 'any'; inp.value = val; }
  }
  inp.dataset.key = f.key;
  grid.appendChild(lab); grid.appendChild(inp);
  return inp;
}
function readField(inp, f){
  if (f.type === 'check') return inp.checked;
  if (f.type === 'number' || !f.type){ let v = +inp.value; if (!isFinite(v)) v = f.value; if (f.min !== undefined) v = Math.max(f.min, v); if (f.max !== undefined) v = Math.min(f.max, v); return v; }
  return inp.value;
}
function dialog(name, title, fields, onOK, extra){
  closeDialog();
  const bg = document.createElement('div'); bg.className = 'psl-bg';
  const box = document.createElement('div'); box.className = 'psl-dlg'; box.dataset.dlg = name;
  const h = document.createElement('h3'); h.textContent = L3(...title); box.appendChild(h);
  const grid = document.createElement('div'); grid.className = 'psl-grid'; box.appendChild(grid);
  const inputs = fields.map(f => [f, fieldRow(grid, f, f.value)]);
  if (extra) extra(box);
  const row = document.createElement('div'); row.className = 'psl-row';
  const ok = document.createElement('button'); ok.className = 'psl-ok'; ok.textContent = L3('確定', '确定', 'OK');
  const cc = document.createElement('button'); cc.className = 'psl-cancel'; cc.textContent = L3('取消', '取消', 'Cancel');
  row.appendChild(cc); row.appendChild(ok); box.appendChild(row);
  const done = () => {
    const vals = {}; inputs.forEach(([f, inp]) => { vals[f.key] = readField(inp, f); });
    closeDialog();
    try { const r = onOK(vals, box); if (r && r.ok === false && r.error) console.warn(r.error); } catch(err){ console.error(err); }
    if (window.UI && UI.draw) UI.draw();
  };
  ok.onclick = done; cc.onclick = closeDialog;
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName !== 'SELECT'){ e.preventDefault(); done(); } if (e.key === 'Escape') closeDialog(); });
  bg.appendChild(box); document.body.appendChild(bg);
  const first = box.querySelector('input,select'); if (first) first.focus();
  return box;
}
const BLEND_OPTS = () => BLENDS.map(b => [b, Lang.t('blend.' + b)]);
const UI_OPEN = {ok:false, dialog:true};          // 界面开了对话框：这次不改文件（CMD.run 会把空的一步退掉）
/* 选层对话框：多层命令在图层面板还没有多选时，从菜单进来就让人勾要哪几层 */
function pickLayers(name, title, min, onOK){
  const sel = new Set(idsOf({}));
  dialog(name, title, [], (v, box) => {
    const ids = [...box.querySelectorAll('.psl-lyr input:checked')].map(i => i.value);
    if (ids.length < min) return fail('need ≥' + min + ' layers');
    return onOK(ids);
  }, box => {
    const list = document.createElement('div'); list.className = 'psl-lyr';
    [...Doc.layers].reverse().forEach(L => {
      const lb = document.createElement('label'), cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = L.id; cb.checked = sel.has(L.id);
      lb.appendChild(cb); lb.appendChild(document.createTextNode(' ' + L.name)); list.appendChild(lb);
    });
    box.insertBefore(list, box.querySelector('.psl-grid').nextSibling);
  });
}

/* ═══════════ 命令 ═══════════ */
const reg = (id, params, fn, undoable = true) => CMD.reg('ps.' + id, {i18n:'', params, undoable}, fn);
const UIP = ' · ui:true＝开对话框（界面用）';

/* ── 新建 ── */
// commands.rs:388 layer.new.layer：插在当前层上面、名字「图层 N」
reg('layer.new.layer', '{name?, ui?} 新建像素层，插在当前层之上' + UIP, p => {
  if (p.ui){
    dialog('newLayer', ['新增圖層', '新建图层', 'New Layer'], [{key:'name', label:['名稱', '名称', 'Name'], type:'text', value:nextLayerName()}],
      v => CMD.run('ps.layer.new.layer', {name:v.name}));
    return UI_OPEN;
  }
  const name = (p.name && String(p.name).trim()) || nextLayerName();
  const L = Layer.raster(name), i = Doc.index(Doc.activeId);
  Doc.add(L, i < 0 ? Doc.layers.length : i + 1);
  return {id:L.id};
});
// extra_cmds.rs:333 layer_from_background
reg('layer.new.layerFromBackground', '{} 背景层变成普通层「图层 0」（解开透明与位置锁）', () => {
  const L = Doc.layers[0];
  if (!isBackground(L)) return fail('the document has no Background layer');
  unlockBackground(L); Doc.activeId = L.id;
  return {id:L.id};
});
// edit_cmds.rs:142 layer_via
function layerVia(cut){
  const L = Doc.active(); if (!L) return fail('no active layer');
  const sel = Doc.sel;
  if (!sel && !cut){                               // 没选区：通过拷贝＝复制整层（PS）
    const N = L.kind === 'raster' ? Layer.raster(L.name + ' copy', L.data.canvas.width, L.data.canvas.height)
            : L.kind === 'vector' ? Layer.vector(L.name + ' copy') : Layer.text(L.name + ' copy', JSON.parse(JSON.stringify(L.data)));
    if (L.kind === 'raster') N.data.ctx.drawImage(L.data.canvas, 0, 0);
    else if (L.kind === 'vector') N.data.shapes = JSON.parse(JSON.stringify(L.data.shapes));
    Object.assign(N, {visible:L.visible, opacity:L.opacity, blend:L.blend, x:L.x, y:L.y});
    putExtra(N, grabExtra(L)); delete N.locks; delete N.isBackground; delete N.linkGroup;   // dup.locks = Default
    Doc.add(N, Doc.index(L.id) + 1);
    return {id:N.id};
  }
  if (cut && L.kind !== 'raster') return fail('active layer is a ' + L.kind + ' layer, not a pixel layer');
  // lift：层像素（文件坐标）× 选区覆盖度
  const c = docPixels(L), x = ctx2d(c);
  if (sel){ x.globalCompositeOperation = 'destination-in'; x.drawImage(selCanvas(null), 0, 0); x.globalCompositeOperation = 'source-over'; }
  if (alphaEmpty(c)) return fail('Could not complete the command: the selected area is empty');
  if (cut){                                        // clear_area：背景层填背景色，其余清透明
    const ctx = L.data.ctx, m = sel ? selCanvas(L) : null;
    ctx.save();
    if (isBackground(L)){
      const t = mkCanvas(L.data.canvas.width, L.data.canvas.height), tx = ctx2d(t);
      if (m) tx.drawImage(m, 0, 0); else { tx.fillStyle = '#fff'; tx.fillRect(0, 0, t.width, t.height); }
      tx.globalCompositeOperation = 'source-in'; tx.fillStyle = bgColor(); tx.fillRect(0, 0, t.width, t.height);
      ctx.drawImage(t, 0, 0);
    } else if (m){ ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(m, 0, 0); }
    else ctx.clearRect(0, 0, L.data.canvas.width, L.data.canvas.height);
    ctx.restore();
  }
  const N = rasterFrom(c, nextLayerName());
  Doc.add(N, Doc.index(L.id) + 1);
  Doc.sel = null;                                  // PS：拷贝／剪切成新层后取消选区（原码 layer_via 留着；同一步历史，Ctrl+Z 选区回来）
  return {id:N.id};
}
reg('layer.new.layerViaCopy', '{} 选区内像素拷成新层（没选区＝复制整层）', () => layerVia(false));
reg('layer.new.layerViaCut', '{} 选区内像素剪成新层（只限像素层；背景层剪掉处填背景色）', () => layerVia(true));

/* ── 删除 ── */
// extra_cmds.rs:388 delete_where(!visible)
reg('layer.delete.hiddenLayers', '{} 删除所有隐藏的层（至少留一层）→ {deleted}', () => {
  const keep = Doc.layers.filter(L => L.visible);
  const n = Doc.layers.length - keep.length;
  if (!keep.length) return fail('a document must keep at least one layer');
  Doc.layers = keep;
  if (!Doc.byId(Doc.activeId)) Doc.activeId = keep[keep.length - 1].id;
  return {deleted:n};
});

/* ── 重命名 ── layer_multi_cmds.rs:582 */
reg('layer.renameLayer', '{id?, name} 图层改名' + UIP, p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (p.ui){
    dialog('rename', ['重新命名圖層', '重命名图层', 'Rename Layer'], [{key:'name', label:['名稱', '名称', 'Name'], type:'text', value:L.name}],
      v => CMD.run('ps.layer.renameLayer', {id:L.id, name:v.name}));
    return UI_OPEN;
  }
  const name = p.name === undefined ? '' : String(p.name).trim();
  if (!name) return fail('missing `name`');
  L.name = name; return {ok:true};
});

/* ── 图层样式 ── layer_style.rs:175 set_effect */
FX_KINDS.forEach(kind => {
  const P = {
    dropShadow:'{color:"#rrggbb", opacity:0..100=75, blend="multiply", angle:deg=120, useGlobalLight=true, distance:px=5, spread:0..100=0, size:px=5, knocksOut=true, add?, id?}',
    innerShadow:'{color="#000000", opacity:0..100=75, blend="multiply", angle=120, useGlobalLight=true, distance=5, choke:0..100=0, size=5, add?, id?}',
    outerGlow:'{color="#ffffbe", opacity:0..100=75, blend="screen", technique:"softer|precise", spread:0..100=0, size=5, range:1..100=50, add?, id?}',
    innerGlow:'{color="#ffffbe", opacity:0..100=75, blend="screen", technique:"softer|precise", source:"edge|center", choke:0..100=0, size=5, range=50, add?, id?}',
    stroke:'{size:px=3, position:"outside|inside|center", color="#ff0000", from?, to?, style?, angle?, scale?（给 from 就是渐变描边）, opacity:0..100=100, blend="normal", add?, id?}',
    colorOverlay:'{color="#ff0000", opacity:0..100=100, blend="normal", add?, id?}',
    gradientOverlay:'{from="#000000", to="#ffffff", style:"linear|radial|angle|reflected|diamond", angle=90, scale:10..150=100, reverse=false, opacity=100, blend="normal", add?, id?}',
    satin:'{color="#000000", opacity:0..100=50, blend="multiply", angle=19, distance=11, size=14, invert=true, add?, id?}'
  }[kind];
  reg('layer.layerStyle.' + kind, P + ' 加／换一个效果（同种已有就换掉，add:true 另加一个）' + UIP, p => {
    const L = layerOf(p); if (!L) return fail('no active layer');
    if (p.ui){ openStyleDialog(L, kind); return UI_OPEN; }
    let fx; try { fx = effectFromParams(kind, p); } catch(err){ return fail(err.message); }
    const st = ensureStyle(L); st.enabled = true;
    const at = p.add ? -1 : st.items.findIndex(e => e.kind === kind);
    if (at >= 0) st.items[at] = fx; else st.items.push(fx);
    return {id:L.id};
  });
});
// layer_menu_cmds.rs:389 blending_options＋433-494 blend_if_entries／blend_if_channel／blend_range（混合颜色带：资料与合成在 engine.js BlendIf）
// blendIf：null＝回缺省；{channel, thisLayer?, underlying?} 或其阵列；只给一边就留另一边；不带 blendIf＝不动它
const BLEND_IF_P = 'blendIf?:null|{channel:"gray"|"red"|"green"|"blue"|0..3, thisLayer?:[黑,白]|[黑低,黑高,白低,白高], underlying?:同左}|[…多个]（0..255 递增；Alt 拆开＝4 值；只给一边保留另一边；null＝重设）';
function blendingOptions(L, p){
  const ents = p.blendIf === undefined ? undefined : BlendIf.entries(p.blendIf, BlendIf.mode());   // 先验完再动层
  if (p.blend !== undefined) L.blend = parseBlend(p.blend, L.blend);
  if (p.opacity !== undefined) L.opacity = clamp(+p.opacity / 100, 0, 1);
  if (p.fillOpacity !== undefined) L.fillOpacity = clamp(+p.fillOpacity / 100, 0, 1);
  if (ents !== undefined) BlendIf.applyEntries(L, ents);
}
reg('layer.layerStyle.blendingOptions', '{id?, blend?, opacity:0..100?, fillOpacity:0..100?, ' + BLEND_IF_P + '} 混合选项（填充不透明度只压层自己的像素，效果不受影响；混合颜色带按本层／底下的通道值藏像素）' + UIP, p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (p.ui){ openStyleDialog(L, 'blending'); return UI_OPEN; }
  try { blendingOptions(L, p); } catch(err){ return fail(err.message); }
  return {ok:true};
});
// ui-egui layer_style.rs:308 apply：混合选项 → 清空 → 逐个开着的效果（一步历史）
reg('layer.layerStyle.setAll', '{id?, blending?:{blend,opacity,fillOpacity, ' + BLEND_IF_P + '}, effects:[{kind, …该效果参数}], globalLight?:{angle, altitude}（对话框里勾「使用全局光」改了角度／高度＝改全局光，同一步）} 整组换掉（图层样式对话框按确定走这条）', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  try {
    const items = (p.effects || []).map(e => { const fx = effectFromParams(e.kind, e); if (!fx) throw new Error('unknown effect ' + e.kind); return fx; });
    if (p.blending) blendingOptions(L, p.blending);
    L.style = {enabled:true, items};
    if (p.globalLight){ const g = p.globalLight, cur = Doc.globalLight || {angle:120, altitude:30};
      Doc.globalLight = {angle:((num(g, 'angle', cur.angle) + 180) % 360 + 360) % 360 - 180, altitude:clamp(num(g, 'altitude', cur.altitude), 0, 90)}; }
  } catch(err){ return fail(err.message); }
  return {ok:true, effects:L.style.items.length};
});
// extra_cmds.rs:604 拷贝／粘贴图层样式（剪贴簿存效果＋混合模式＋填充不透明度）
let styleClip = null;
reg('layer.layerStyle.copyLayerStyle', '{id?} 拷贝图层样式', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  styleClip = {style:JSON.parse(JSON.stringify(L.style || {enabled:true, items:[]})), blend:L.blend, fillOpacity:L.fillOpacity === undefined ? 1 : L.fillOpacity};
  return {ok:true, effects:styleClip.style.items.length};
}, false);
reg('layer.layerStyle.pasteLayerStyle', '{id?|ids?} 粘贴图层样式（要先拷贝过）', p => {
  if (!styleClip) return fail('no layer style has been copied');
  const ids = p.id || p.layer ? [layerOf(p) && layerOf(p).id].filter(Boolean) : idsOf(p);
  if (!ids.length) return fail('no active layer');
  ids.forEach(id => { const L = Doc.byId(id); L.style = JSON.parse(JSON.stringify(styleClip.style)); L.blend = styleClip.blend; L.fillOpacity = styleClip.fillOpacity; });
  return {ok:true};
});
// layer_style.rs:265 clear
reg('layer.layerStyle.clear', '{id?} 清除图层样式', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  L.style = {enabled:true, items:[]}; return {ok:true};
});
// layer_menu_cmds.rs:501 global_light
reg('layer.layerStyle.globalLight', '{angle:-180..180=120, altitude:0..90=30} 全局光（投影／内阴影勾「使用全局光」时用这个角度）' + UIP, p => {
  const cur = Doc.globalLight || {angle:120, altitude:30};
  if (p.ui){
    dialog('globalLight', ['整體光源', '全局光', 'Global Light'], [
      {key:'angle', label:['角度', '角度', 'Angle'], value:cur.angle, min:-180, max:180},
      {key:'altitude', label:['高度', '高度', 'Altitude'], value:cur.altitude, min:0, max:90}],
      v => CMD.run('ps.layer.layerStyle.globalLight', v));
    return UI_OPEN;
  }
  let angle = num(p, 'angle', cur.angle); const altitude = clamp(num(p, 'altitude', cur.altitude), 0, 90);
  angle = ((angle + 180) % 360 + 360) % 360 - 180;
  Doc.globalLight = {angle, altitude};
  return {angle, altitude};
});
// layer_menu_cmds.rs:553 create_layer：每个效果单独渲成一层（下方：投影／外发光／外侧描边；上方：其余），原层留像素、去掉效果
reg('layer.layerStyle.createLayer', '{id?} 把效果拆成独立的像素层 → {layers}', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (!PsLayerStyle.has(L)) return fail('the layer has no layer effects');
  const items = L.style.items.filter(e => e.enabled !== false && FX_KINDS.includes(e.kind));
  const lay0 = docPixels(Object.assign({}, L, {mask:null}));
  // 蒙版要算进形状（effects 的形状来自过了蒙版的 alpha）
  if (L.mask){ const x = ctx2d(lay0); x.globalCompositeOperation = 'destination-in'; x.drawImage(L.mask.data.canvas, L.kind === 'raster' ? L.x : 0, L.kind === 'raster' ? L.y : 0); }
  const below = [], above = [];
  for (const e of items){
    const e1 = Object.assign({}, e, {blend:'normal', opacity:1});
    const alone = {style:{enabled:true, items:[e1]}, fillOpacity:0, opacity:1, blend:'normal', kind:'raster', x:0, y:0, data:{canvas:lay0}, visible:true};
    const c = mkCanvas(Doc.width, Doc.height);
    PsLayerStyle.draw(ctx2d(c), alone, lay0, 1);
    const N = rasterFrom(c, Lang.cur === 'en' ? `${L.name}'s ${fxName(e.kind)}` : `${L.name} 的${fxName(e.kind)}`);
    N.blend = e.blend; N.opacity = e.opacity;
    (e.kind === 'dropShadow' || e.kind === 'outerGlow' || (e.kind === 'stroke' && e.position === 'outside') ? below : above).push(N);
  }
  L.style.items = [];
  let at = Doc.index(L.id);
  below.forEach(N => { Doc.layers.splice(at, 0, N); at++; });
  above.forEach((N, k) => Doc.layers.splice(at + 1 + k, 0, N));
  Doc.activeId = L.id;
  return {layers:below.length + above.length, ids:below.concat(above).map(N => N.id)};
});
// extra_cmds.rs:369 set_all_effects；菜单是勾选式 ⇒ toggle
function allFxHidden(){ const w = Doc.layers.filter(L => L.style && L.style.items && L.style.items.length); return w.length > 0 && w.every(L => L.style.enabled === false); }
reg('layer.layerStyle.hideAllEffects', '{toggle?:bool} 隐藏所有图层的效果（toggle:true 且已全隐藏 ⇒ 改为显示）', p => {
  const show = !!p.toggle && allFxHidden();
  Doc.layers.forEach(L => { if (L.style && L.style.items && L.style.items.length) L.style.enabled = show; });
  return {hidden:!show};
});
reg('layer.layerStyle.showAllEffects', '{} 显示所有图层的效果', () => {
  Doc.layers.forEach(L => { if (L.style && L.style.items && L.style.items.length) L.style.enabled = true; });
  return {hidden:false};
});
// layer_menu_cmds.rs:514 scale_effects＋image_cmds.rs:60
reg('layer.layerStyle.scaleEffects', '{id?, scale:1..1000=100} 缩放效果（大小／距离按比例）' + UIP, p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (!PsLayerStyle.has(L)) return fail('the layer has no layer effects');
  if (p.ui){
    dialog('scaleEffects', ['縮放效果', '缩放效果', 'Scale Effects'], [{key:'scale', label:['縮放', '缩放', 'Scale'] , value:100, min:1, max:1000}],
      v => CMD.run('ps.layer.layerStyle.scaleEffects', {id:L.id, scale:v.scale}));
    return UI_OPEN;
  }
  const k = clamp(num(p, 'scale', 100), 1, 1000) / 100;
  L.style.items.forEach(e => {
    if (e.kind === 'dropShadow' || e.kind === 'innerShadow' || e.kind === 'satin'){ e.distance *= k; e.size *= k; }
    else if (e.kind === 'outerGlow' || e.kind === 'innerGlow' || e.kind === 'stroke') e.size *= k;
  });
  return {ok:true};
});

/* 图层样式对话框（ui-egui/src/layer_style.rs：左栏 混合选项＋效果清单〔勾选〕；右栏 参数；确定＝setAll 一步） */
const SPEC = {
  dropShadow:[['blend', 'b'], ['color', 'c'], ['opacity', 0, 100], ['angle', -180, 180], ['useGlobalLight', 'k'], ['distance', 0, 300], ['spread', 0, 100], ['size', 0, 250], ['knocksOut', 'k']],
  innerShadow:[['blend', 'b'], ['color', 'c'], ['opacity', 0, 100], ['angle', -180, 180], ['useGlobalLight', 'k'], ['distance', 0, 300], ['choke', 0, 100], ['size', 0, 250]],
  outerGlow:[['blend', 'b'], ['opacity', 0, 100], ['color', 'c'], ['spread', 0, 100], ['size', 0, 250], ['range', 1, 100]],
  innerGlow:[['blend', 'b'], ['opacity', 0, 100], ['color', 'c'], ['source', ['edge', 'center']], ['choke', 0, 100], ['size', 0, 250]],
  stroke:[['size', 1, 250], ['position', ['outside', 'inside', 'center']], ['blend', 'b'], ['opacity', 0, 100], ['color', 'c']],
  colorOverlay:[['blend', 'b'], ['color', 'c'], ['opacity', 0, 100]],
  gradientOverlay:[['blend', 'b'], ['opacity', 0, 100], ['from', 'c'], ['to', 'c'], ['reverse', 'k'], ['style', ['linear', 'radial', 'angle', 'reflected', 'diamond']], ['angle', -180, 180], ['scale', 10, 150]],
  satin:[['blend', 'b'], ['color', 'c'], ['opacity', 0, 100], ['angle', -180, 180], ['distance', 0, 250], ['size', 0, 250], ['invert', 'k']],
  blending:[['blend', 'b'], ['opacity', 0, 100], ['fillOpacity', 0, 100]]
};
const LBL = {
  blend:['混合模式', '混合模式', 'Blend Mode'], color:['顏色', '颜色', 'Color'], opacity:['不透明度', '不透明度', 'Opacity'], angle:['角度', '角度', 'Angle'],
  distance:['距離', '距离', 'Distance'], spread:['展開', '扩展', 'Spread'], choke:['填塞', '阻塞', 'Choke'], size:['尺寸', '大小', 'Size'],
  knocksOut:['圖層去底陰影', '图层挖空投影', 'Layer Knocks Out Drop Shadow'], range:['範圍', '范围', 'Range'], source:['來源', '源', 'Source'],
  position:['位置', '位置', 'Position'], from:['起點', '起点', 'From'], to:['終點', '终点', 'To'], reverse:['反向', '反向', 'Reverse'],
  style:['樣式', '样式', 'Style'], scale:['縮放', '缩放', 'Scale'], invert:['負片效果', '反相', 'Invert'], fillOpacity:['填滿不透明度', '填充不透明度', 'Fill Opacity'],
  edge:['邊緣', '边缘', 'Edge'], center:['中央', '居中', 'Center'], outside:['外部', '外部', 'Outside'], inside:['內部', '内部', 'Inside'],
  linear:['線性', '线性', 'Linear'], radial:['放射狀', '径向', 'Radial'], reflected:['反射性', '对称的', 'Reflected'], diamond:['菱形', '菱形', 'Diamond']
};
LBL.angleStyle = ['角度', '角度', 'Angle'];
LBL.useGlobalLight = ['使用整體光源', '使用全局光', 'Use Global Light'];
/* 混合选项页下半：PS「混合颜色带」——通道下拉＋本图层／下一图层两条渐层条，各一对黑、白三角；
   拖三角改值（即时预览）；按住 Alt 拖没拆开的三角＝拆成两半、拖往哪边就拉哪一半；拆开的半边各自拖；旁边数字（拆开显示「a / b」）。
   资料：st.bif（engine BlendIf 格式）、st.bifCh＝目前看的索引（0 灰、1..3 RGB；单通道文件只有 1） */
const BIF_CH_LBL = {gray:['灰色', '灰色', 'Gray'], red:['紅', '红', 'Red'], green:['綠', '绿', 'Green'], blue:['藍', '蓝', 'Blue'],
  cyan:['青', '青色', 'Cyan'], magenta:['洋紅', '洋红', 'Magenta'], yellow:['黃', '黄色', 'Yellow'], black:['黑', '黑色', 'Black'],
  lightness:['明度', '明度', 'Lightness'], a:['a', 'a', 'a'], b:['b', 'b', 'b']};
const BIF_GRAD = {red:'#ff0000', green:'#00ff00', blue:'#0000ff'};
function blendIfPane(pane, st, mode, preview){
  const one = BlendIf.colorChannels(mode) === 1, names = BlendIf.channelNames(mode);
  const opts = one ? [[1, 'gray']] : [[0, 'gray']].concat(names.map((n, i) => [i + 1, n]));
  if (!opts.some(o => o[0] === st.bifCh)) st.bifCh = opts[0][0];
  const sec = document.createElement('div'); sec.className = 'psl-bif'; sec.dataset.sec = 'blendIf';
  const hd = document.createElement('div'); hd.className = 'psl-bif-hd';
  const t = document.createElement('span'); t.textContent = L3('混合範圍：', '混合颜色带：', 'Blend If:');
  const sel = document.createElement('select'); sel.dataset.bik = 'channel';
  opts.forEach(([i, n]) => { const o = document.createElement('option'); o.value = String(i); o.textContent = L3(...BIF_CH_LBL[n]); sel.appendChild(o); });
  sel.value = String(st.bifCh);
  sel.onchange = () => { st.bifCh = +sel.value; draw(); };
  hd.appendChild(t); hd.appendChild(sel); sec.appendChild(hd);
  const rows = [['this', 0, ['此圖層：', '本图层：', 'This Layer:']], ['under', 1, ['下面圖層：', '下一图层：', 'Underlying Layer:']]];
  const parts = {};
  rows.forEach(([side, si, lbl]) => {
    const lab = document.createElement('div'); lab.className = 'psl-bif-lab';
    const nm = document.createElement('span'); nm.textContent = L3(...lbl);
    const vb = document.createElement('span'); vb.className = 'psl-bif-num'; vb.dataset.bival = side + '-black';
    const vw = document.createElement('span'); vw.className = 'psl-bif-num'; vw.dataset.bival = side + '-white';
    lab.appendChild(nm); lab.appendChild(vb); lab.appendChild(vw); sec.appendChild(lab);
    const track = document.createElement('div'); track.className = 'psl-bif-track'; track.dataset.bi = side;
    const bar = document.createElement('div'); bar.className = 'psl-bif-bar'; track.appendChild(bar);
    sec.appendChild(track);
    parts[side] = {si, track, bar, vb, vw};
  });
  pane.appendChild(sec);
  const cur = si => BlendIf.toBytes(BlendIf.get(st.bif, st.bifCh)[si]);
  const put = (si, q) => { const p = BlendIf.get(st.bif, st.bifCh); p[si] = BlendIf.fromBytes(q); st.bif = BlendIf.set(st.bif, st.bifCh, p); };
  // 拖：j＝0..3（黑低／黑高／白低／白高）；'b'／'w'＝没拆的黑／白（两半一起）
  const startDrag = (e, side, which) => {
    e.preventDefault(); e.stopPropagation();
    const P = parts[side], W = P.track.getBoundingClientRect().width, x0 = e.clientX, q0 = cur(P.si);
    let j = which;
    const splitting = e.altKey && (which === 'b' || which === 'w');
    if (splitting) j = null;                       // Alt 拖没拆的：等第一下移动看往哪边
    const move = ev => {
      const dx = ev.clientX - x0; if (splitting && j === null){ if (!dx) return; j = which === 'b' ? (dx > 0 ? 1 : 0) : (dx > 0 ? 3 : 2); }
      const q = q0.slice(), base = j === 'b' ? q0[0] : j === 'w' ? q0[3] : q0[j];
      const v = Math.round(base + dx * 255 / Math.max(1, W - 1));
      if (j === 'b'){ q[0] = q[1] = Math.max(0, Math.min(q[2], v)); }
      else if (j === 'w'){ q[2] = q[3] = Math.max(q[1], Math.min(255, v)); }
      else q[j] = Math.max(j > 0 ? q[j - 1] : 0, Math.min(j < 3 ? q[j + 1] : 255, v));
      put(P.si, q); draw(); preview();
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  };
  const handle = (P, side, which, v, cls) => {
    const h = document.createElement('div'); h.className = 'psl-bif-h ' + cls; h.dataset.h = side + '-' + which;
    h.style.left = 'calc(' + (v / 255 * 100) + '% - ' + (cls.includes('lo') ? 6 : cls.includes('hi') ? 0 : 5) + 'px)';
    h.onmousedown = e => startDrag(e, side, which);
    P.track.appendChild(h);
  };
  function draw(){
    const ch = opts.find(o => o[0] === st.bifCh)[1], to = BIF_GRAD[ch] || '#ffffff';
    Object.keys(parts).forEach(side => {
      const P = parts[side], q = cur(P.si);
      P.bar.style.background = 'linear-gradient(to right, #000000, ' + to + ')';
      P.track.querySelectorAll('.psl-bif-h').forEach(h => h.remove());
      if (q[0] === q[1]) handle(P, side, 'b', q[0], 'blk');
      else { handle(P, side, 0, q[0], 'blk lo'); handle(P, side, 1, q[1], 'blk hi'); }
      if (q[2] === q[3]) handle(P, side, 'w', q[2], 'wht');
      else { handle(P, side, 2, q[2], 'wht lo'); handle(P, side, 3, q[3], 'wht hi'); }
      P.vb.textContent = q[0] === q[1] ? String(q[0]) : q[0] + ' / ' + q[1];
      P.vw.textContent = q[2] === q[3] ? String(q[2]) : q[2] + ' / ' + q[3];
    });
  }
  draw();
}
function openStyleDialog(L, select){
  // initial_fields：每种效果 {on, 参数}，没有的用预设
  const st = {selected:null, on:{}, p:{}};
  st.p.blending = {blend:L.blend, opacity:Math.round(L.opacity * 100), fillOpacity:Math.round((L.fillOpacity === undefined ? 1 : L.fillOpacity) * 100)};
  let first = null;
  const EXT = Object.keys(FX_EXT), KINDS = FX_KINDS.concat(EXT);       // 别档挂进来的（斜面和浮雕）排在八种后面；清单上照 PS 排最前
  KINDS.forEach(k => {
    const ex = L.style && L.style.items ? L.style.items.find(e => e.kind === k) : null;
    if (ex && !first) first = k;
    st.on[k] = !!(ex && ex.enabled !== false);
    st.p[k] = FX_EXT[k] ? Object.assign({}, FX_EXT[k].defaults, ex ? FX_EXT[k].valuesOf(ex) : {}) : Object.assign({}, FX_DEFAULTS[k], ex ? valuesOf(ex) : {});
  });
  st.selected = select || first || 'dropShadow';
  if (select && select !== 'blending') st.on[select] = true;
  // 全局光（PS）：勾「使用全局光」的效果，角度／高度栏显示的就是全局光；在任一个改了＝全局光跟着改、其它勾着的一起变；确定＝setAll 同一步写回 Doc.globalLight
  const gl0 = Doc.globalLight ? Object.assign({}, Doc.globalLight) : undefined;
  st.gl = Object.assign({angle:120, altitude:30}, gl0 || {});
  const syncGL = () => KINDS.forEach(k => { const q = st.p[k]; if (!q || !q.useGlobalLight) return; if ('angle' in q) q.angle = st.gl.angle; if ('altitude' in q) q.altitude = st.gl.altitude; });
  syncGL();
  closeDialog();
  // 混合颜色带：对话框里改的是 st.bif（即时预览＝暂时挂到层上画）；取消／关掉＝挂回原来的；确定＝挂回原来的再走 setAll 一步
  const bifOrig = L.blendIf, bifMode = BlendIf.mode();
  st.bif = L.blendIf ? JSON.parse(JSON.stringify(L.blendIf)) : {ranges:[]};
  st.bifCh = (() => { const r = st.bif.ranges.findIndex(p => !p.every(x => BlendIf.isFull(x))); return r >= 0 ? r : BlendIf.channelIndex('gray', bifMode); })();
  const bifRestore = () => { if (bifOrig === undefined) delete L.blendIf; else L.blendIf = bifOrig; };
  const bifPreview = () => { if (BlendIf.isDefault(st.bif)) delete L.blendIf; else L.blendIf = JSON.parse(JSON.stringify(st.bif)); if (window.UI && UI.draw) UI.draw(); };
  // PS 2020「预览」（预设勾着）：对话框里改什么画面即时跟着变（暂时挂到层上画，不进历史）；取消／关掉＝挂回原来的；确定＝挂回原来的再走 setAll 一步
  const orig = {style:L.style === undefined ? undefined : JSON.parse(JSON.stringify(L.style)), blend:L.blend, opacity:L.opacity, fillOpacity:L.fillOpacity};
  const fxRestore = () => { if (orig.style === undefined) delete L.style; else L.style = JSON.parse(JSON.stringify(orig.style));
    L.blend = orig.blend; L.opacity = orig.opacity; if (orig.fillOpacity === undefined) delete L.fillOpacity; else L.fillOpacity = orig.fillOpacity;
    if (gl0 === undefined) delete Doc.globalLight; else Doc.globalLight = Object.assign({}, gl0); };
  const fxOf = k => FX_EXT[k] ? FX_EXT[k].fromParams(Object.assign({kind:k}, st.p[k])) : effectFromParams(k, Object.assign({kind:k}, st.p[k]));
  st.previewOn = true;
  let pvT = 0;
  const fxPreview = () => {
    clearTimeout(pvT);
    pvT = setTimeout(() => {
      if (!bg.isConnected) return;
      fxRestore();
      if (st.previewOn){
        try {
          save();
          const items = KINDS.filter(k => st.on[k]).map(fxOf).filter(Boolean);
          if (orig.style && Array.isArray(orig.style.items)) orig.style.items.forEach(e => { if (!KINDS.includes(e.kind)) items.push(JSON.parse(JSON.stringify(e))); });   // 对话框没列的（图案叠加）照留
          L.style = {enabled:true, items};
          Doc.globalLight = Object.assign({}, st.gl);
          const b = st.p.blending; L.blend = parseBlend(b.blend, L.blend); L.opacity = clamp(+b.opacity / 100, 0, 1); L.fillOpacity = clamp(+b.fillOpacity / 100, 0, 1);
        } catch (err){ fxRestore(); }                                  // 栏位一时打不完整（例如空着）＝先照原样
      }
      if (window.UI && UI.draw) UI.draw();
    }, 60);
  };
  const bg = document.createElement('div'); bg.className = 'psl-bg';
  bg.style.background = 'transparent';                                 // PS 的图层样式对话框不压暗画面（预览要看得清）
  bg._onClose = () => { clearTimeout(pvT); bifRestore(); fxRestore(); if (window.UI && UI.draw) UI.draw(); };
  const box = document.createElement('div'); box.className = 'psl-dlg'; box.dataset.dlg = 'layerStyle';
  const h = document.createElement('h3'); h.textContent = L3('圖層樣式', '图层样式', 'Layer Style'); box.appendChild(h);
  const wrap = document.createElement('div'); wrap.className = 'psl-fxwrap'; box.appendChild(wrap);
  const list = document.createElement('div'); list.className = 'psl-fxlist'; wrap.appendChild(list);
  const pane = document.createElement('div'); pane.style.minWidth = '280px'; wrap.appendChild(pane);
  const save = () => {
    const cur = st.p[st.selected]; if (!cur) return;
    const prev = {angle:cur.angle, altitude:cur.altitude, g:cur.useGlobalLight};
    pane.querySelectorAll('[data-key]').forEach(inp => {
      const k = inp.dataset.key;
      cur[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? (+inp.value) : inp.value;
    });
    if (cur.useGlobalLight){                                           // 勾着全局光：刚改的角度／高度＝新的全局光；刚勾上＝套用目前全局光
      if (prev.g){ if ('angle' in cur && cur.angle !== prev.angle) st.gl.angle = +cur.angle; if ('altitude' in cur && cur.altitude !== prev.altitude) st.gl.altitude = +cur.altitude; }
      syncGL();
      const sync = (k, v) => { const inp = pane.querySelector(`[data-key="${k}"]`); if (inp && +inp.value !== v) inp.value = v; };
      sync('angle', st.gl.angle); if ('altitude' in cur) sync('altitude', st.gl.altitude);
    }
  };
  const drawPane = () => {
    pane.innerHTML = '';
    const t = document.createElement('div'); t.style.cssText = 'font-weight:bold;margin-bottom:8px';
    t.textContent = st.selected === 'blending' ? L3('混合選項', '混合选项', 'Blending Options') : fxName(st.selected); pane.appendChild(t);
    const grid = document.createElement('div'); grid.className = 'psl-grid'; pane.appendChild(grid);
    (SPEC[st.selected] || FX_EXT[st.selected].spec).forEach(([key, a, b, lb]) => {
      const f = {key, label:lb || (key === 'angle' ? LBL.angleStyle : LBL[key])};
      if (a === 'b'){ f.type = 'select'; f.options = BLEND_OPTS(); }
      else if (a === 'c') f.type = 'color';
      else if (a === 'k') f.type = 'check';
      else if (Array.isArray(a)){ f.type = 'select'; f.options = a.map(v => Array.isArray(v) ? v : [v, LBL[v] || (v === 'angle' ? LBL.angleStyle : v)]); }
      else { f.type = 'number'; f.min = a; f.max = b; }
      const inp = fieldRow(grid, f, st.p[st.selected][key]);
      if (f.type === 'color') colorSwatch(inp, st.selected);
    });
    if (st.selected === 'blending') blendIfPane(pane, st, bifMode, bifPreview);
  };
  // 色块：PS 点色块开 Adobe 拾色器（tools/colorpicker.js；标题「拾色器（描边颜色）」等）；拾色器开着时画面即时跟着变，取消＝回原色
  const PICK_LBL = {stroke:['筆畫顏色', '描边颜色', 'Stroke Color'], dropShadow:['陰影顏色', '阴影颜色', 'Shadow Color'], innerShadow:['陰影顏色', '阴影颜色', 'Shadow Color'],
    outerGlow:['光暈顏色', '发光颜色', 'Glow Color'], innerGlow:['光暈顏色', '发光颜色', 'Glow Color'], colorOverlay:['覆蓋顏色', '叠加颜色', 'Overlay Color'], satin:['緞面顏色', '光泽颜色', 'Satin Color']};
  const colorSwatch = (inp, kind) => {
    if (!window.ColorPicker || !ColorPicker.open) return;                // 没载拾色器＝照旧浏览器选色框
    inp.addEventListener('click', e => {
      e.preventDefault();
      const prev = inp.value, n = PICK_LBL[kind] || ['顏色', '颜色', 'Color'];
      const label = {'zh-Hant':`檢色器 (${n[0]})`, 'zh-Hans':`拾色器（${n[1]}）`, en:`Color Picker (${n[2]})`};
      const put = c => { if (/^#[0-9a-f]{6}$/i.test(c)){ inp.value = c; fxPreview(); } };
      ColorPicker.open('layerStyle', prev, {label, onChange:put, onClose:() => put(prev), onOk:put});
    });
  };
  const drawList = () => {
    list.innerHTML = '';
    const hd = document.createElement('div'); hd.className = 'hdr'; hd.textContent = L3('樣式', '样式', 'Styles'); list.appendChild(hd);
    const bo = document.createElement('div'); bo.dataset.kind = 'blending'; bo.textContent = L3('混合選項', '混合选项', 'Blending Options');
    if (st.selected === 'blending') bo.classList.add('sel');
    bo.onclick = () => { save(); st.selected = 'blending'; drawList(); drawPane(); };
    list.appendChild(bo);
    EXT.concat(['stroke', 'innerShadow', 'innerGlow', 'satin', 'colorOverlay', 'gradientOverlay', 'outerGlow', 'dropShadow']).forEach(k => {   // PS 清单顺序（斜面和浮雕在最前）
      const row = document.createElement('div'); row.dataset.kind = k; if (k === st.selected) row.classList.add('sel');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = st.on[k];
      cb.onclick = e => { e.stopPropagation(); save(); st.on[k] = cb.checked; fxPreview(); };
      const nm = document.createElement('span'); nm.textContent = fxName(k);
      row.appendChild(cb); row.appendChild(nm);
      row.onclick = () => { save(); st.selected = k; st.on[k] = true; drawList(); drawPane(); fxPreview(); };
      list.appendChild(row);
    });
  };
  drawList(); drawPane();
  pane.addEventListener('input', fxPreview); pane.addEventListener('change', fxPreview);
  const row = document.createElement('div'); row.className = 'psl-row';
  const pvl = document.createElement('label'); pvl.style.cssText = 'margin-right:auto;display:flex;align-items:center;gap:4px;cursor:pointer';
  const pvc = document.createElement('input'); pvc.type = 'checkbox'; pvc.checked = true; pvc.dataset.key2 = 'preview';
  pvc.onchange = () => { st.previewOn = pvc.checked; fxPreview(); };
  pvl.appendChild(pvc); pvl.appendChild(document.createTextNode(L3('預視', '预览', 'Preview'))); row.appendChild(pvl);
  const ok = document.createElement('button'); ok.className = 'psl-ok'; ok.textContent = L3('確定', '确定', 'OK');
  const cc = document.createElement('button'); cc.className = 'psl-cancel'; cc.textContent = L3('取消', '取消', 'Cancel');
  row.appendChild(cc); row.appendChild(ok); box.appendChild(row);
  ok.onclick = () => {
    save(); closeDialog();   // 关窗会先把预览挂的混合颜色带挂回原来的（历史记的是改之前）
    // 原清单顺序（KINDS）里开着的效果，各带自己的参数
    const effects = KINDS.filter(k => st.on[k]).map(k => Object.assign({kind:k}, st.p[k]));
    const blending = Object.assign({}, st.p.blending);
    const g0 = gl0 || {angle:120, altitude:30}, glMoved = st.gl.angle !== g0.angle || st.gl.altitude !== g0.altitude;
    const nCh = BlendIf.colorChannels(bifMode);
    if (!BlendIf.isDefault(st.bif) || !BlendIf.isDefault(bifOrig))   // 没碰过、原来也没有 ⇒ 不带（照原码：不带 blendIf 不动它）
      blending.blendIf = BlendIf.isDefault(st.bif) ? null
        : Array.from({length:nCh + 1}, (_, i) => { const p = BlendIf.get(st.bif, i); return {channel:i, thisLayer:BlendIf.toBytes(p[0]), underlying:BlendIf.toBytes(p[1])}; });
    const r = CMD.run('ps.layer.layerStyle.setAll', Object.assign({id:L.id, blending, effects}, EXT.length ? {replaceExt:EXT} : {}, glMoved ? {globalLight:Object.assign({}, st.gl)} : {}));
    if (r && r.ok === false) console.warn(r.error);
    if (window.UI && UI.draw) UI.draw();
  };
  cc.onclick = closeDialog;
  bg.appendChild(box); document.body.appendChild(bg);
  if (select && select !== 'blending') fxPreview();                     // 从 fx 选单点进来那个效果已勾上 ⇒ 画面马上显示（PS 同）
  return box;
}

/* ── 图层蒙版 ── commands.rs:547-569、layer_menu_cmds.rs:124-187、extra_cmds.rs:357 */
reg('layer.layerMask.revealAll', '{id?} 加一个全白（全显示）的图层蒙版', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  setMask(L, blankMask(L, true)); return {ok:true};
});
reg('layer.layerMask.hideAll', '{id?} 加一个全黑（全隐藏）的图层蒙版', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  setMask(L, blankMask(L, false)); return {ok:true};
});
reg('layer.layerMask.revealSelection', '{id?} 用选区做蒙版（选区内显示）', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (!Doc.sel) return fail('no selection');
  const m = blankMask(L, false); m.data.ctx.drawImage(selCanvas(L), 0, 0);
  setMask(L, m); Doc.sel = null; return {ok:true};   // PS：选区变成蒙版后就取消选区（同 hideSelection）
});
reg('layer.layerMask.hideSelection', '{id?} 用选区做蒙版（选区内隐藏），并取消选择', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (!Doc.sel) return fail('no selection');
  const m = blankMask(L, true), x = m.data.ctx;
  x.globalCompositeOperation = 'destination-out'; x.drawImage(selCanvas(L), 0, 0); x.globalCompositeOperation = 'source-over';
  setMask(L, m); Doc.sel = null; return {ok:true};
});
reg('layer.layerMask.fromTransparency', '{id?} 透明度变成蒙版、像素变不透明（只限像素层）', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (L.kind !== 'raster') return fail('active layer is a ' + L.kind + ' layer, not a pixel layer');
  const cv = L.data.canvas, img = L.data.ctx.getImageData(0, 0, cv.width, cv.height), d = img.data;
  const m = blankMask(L, false), mi = m.data.ctx.createImageData(cv.width, cv.height), md = mi.data;
  for (let i = 0; i < d.length; i += 4){ md[i] = md[i + 1] = md[i + 2] = 255; md[i + 3] = d[i + 3]; d[i + 3] = 255; }
  m.data.ctx.putImageData(mi, 0, 0); L.data.ctx.putImageData(img, 0, 0);
  L.mask = m; delete L.maskOff; return {ok:true};
});
reg('layer.layerMask.delete', '{id?} 删除图层蒙版', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  L.mask = null; delete L.maskOff; return {ok:true};
});
reg('layer.layerMask.apply', '{id?} 应用图层蒙版：像素 alpha 乘上蒙版，再删掉蒙版（只限像素层）', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (L.kind !== 'raster') return fail('active layer is a ' + L.kind + ' layer, not a pixel layer');
  const m = maskOf(L); if (!m) return fail('the layer has no layer mask');
  const x = L.data.ctx; x.save(); x.globalCompositeOperation = 'destination-in'; x.drawImage(m.data.canvas, 0, 0); x.restore();
  L.mask = null; delete L.maskOff; return {ok:true};
});
reg('layer.layerMask.enabled', '{id?, enabled?:bool（缺省＝切换）} 启用／停用图层蒙版 → {enabled}', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (!maskOf(L)) return fail('the layer has no layer mask');
  const on = typeof p.enabled === 'boolean' ? p.enabled : !L.mask;
  if (on && !L.mask){ L.mask = L.maskOff; delete L.maskOff; }
  else if (!on && L.mask){ L.maskOff = L.mask; L.mask = null; }
  return {enabled:on};
});

/* ── 栅格化 ▸ 所有图层 ── extra_cmds.rs:533 rasterize_all */
reg('layer.rasterize.allLayers', '{} 所有矢量／文字层都算成像素层 → {rasterized}', () => {
  let n = 0;
  Doc.layers = Doc.layers.map(L => {
    if (L.kind === 'raster') return L;
    const N = Layer.raster(L.name); N.data.ctx.drawImage(renderLayer(L, 1), 0, 0);
    copyProps(L, N); putExtra(N, grabExtra(L));
    if (L.id === Doc.activeId) Doc.activeId = N.id;
    n++; return N;
  });
  return {rasterized:n};
});
/* ── 栅格化 ▸ 图层样式（PS 2020：图层面板右键「栅格化图层样式」同一条）──
   这层连效果烤成像素（同 文件 ▸ 脚本 ▸ 拼合所有图层效果 的烤法 PsFile.bakeLayer：效果各照自己的混合模式合在透明底上、蒙版一起烤进去、填充不透明度烤进去回 100%）；
   去掉样式；不透明度、混合模式、名字、id 留着（PS 一样）。文字／形状／智能对象层一起变像素层。 */
reg('layer.rasterize.layerStyle', '{id?} 栅格化图层样式：效果烤进像素、去掉 fx（不透明度／混合模式留着；蒙版、填充不透明度烤进去）→ {id}', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (!PsLayerStyle.has(L)) return fail('the layer has no layer effects');
  if (L.kind === 'group' || L.adjust) return fail('cannot rasterize the layer style of a group or adjustment layer');
  if (!window.PsFile || !PsFile.bakeLayer) return fail('menus/impl/ps-file.js is not loaded');
  const b = PsFile.bakeLayer(L, true);
  PsFile.toRaster(L, b);
  delete L.style; L.mask = null; delete L.fillOpacity; delete L.fillLayer;   // 停用中的蒙版（maskOff）没烤进去 ⇒ 照旧留着
  return {id:L.id};
});

/* ── 排列 ── commands.rs:1037 arrange（背景层不动；置底停在背景层之上） */
function arrangeTo(p, top){
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (isBackground(L)) return fail('layer can\'t move further');
  const i = Doc.index(L.id), floor = isBackground(Doc.layers[0]) ? 1 : 0;
  const j = top ? Doc.layers.length - 1 : floor;
  if (i === j) return fail('layer can\'t move further');
  Doc.layers.splice(i, 1); Doc.layers.splice(j, 0, L);
  return {ok:true};
}
reg('layer.arrange.bringToFront', '{id?} 置为顶层', p => arrangeTo(p, true));
reg('layer.arrange.sendToBack', '{id?} 置为底层（停在背景层之上）', p => arrangeTo(p, false));
// layer_multi_cmds.rs:593 reverse：选中的层在各自的位置上倒序
reg('layer.arrange.reverse', '{ids:[…]≥2 缺省＝多选／当前层} 选中的层倒过来排' + UIP, p => {
  let ids = idsOf(p);
  if (p.ui && ids.length < 2){ pickLayers('pickReverse', ['反轉', '反向', 'Reverse'], 2, ids => CMD.run('ps.layer.arrange.reverse', {ids})); return UI_OPEN; }
  if (ids.length < 2) return fail('select two or more layers to reverse');
  const slots = ids.map(id => Doc.index(id)), objs = ids.map(id => Doc.byId(id)).reverse();
  slots.forEach((s, k) => { Doc.layers[s] = objs[k]; });
  return {ok:true};
});

/* ── 锁定 ── layer_multi_cmds.rs:557 lock_layers（存进 L.locks）；照锁拒改在 engine.js 的 Locks（CMD.run 最外层把关＋工具按下时挡），
   图层面板「锁定：」四颗钮与 agent 别名 layer.lock／layer.unlock 都叫这条 */
const LOCK_KEYS = ['transparency', 'pixels', 'position', 'artboard', 'all'];
reg('layer.lockLayers', '{ids?, transparency?, pixels?, position?, artboard?, all?:bool}（都不给＝切换「全部锁定」）' + UIP, p => {
  const ids = idsOf(p); if (!ids.length) return fail('no layer selected');
  if (p.ui){
    const L0 = Doc.byId(ids[ids.length - 1]), cur = L0.locks || {};
    dialog('lockLayers', ['鎖定圖層', '锁定图层', 'Lock Layers'], [
      {key:'all', label:['全部', '全部', 'All'], type:'check', value:!!cur.all},
      {key:'transparency', label:['透明度', '透明区域', 'Transparency'], type:'check', value:!!cur.transparency},
      {key:'pixels', label:['影像', '图像', 'Pixels'], type:'check', value:!!cur.pixels},
      {key:'position', label:['位置', '位置', 'Position'], type:'check', value:!!cur.position},
      {key:'artboard', label:['工作區域', '画板', 'Artboard'], type:'check', value:!!cur.artboard}],
      v => CMD.run('ps.layer.lockLayers', Object.assign({ids}, v)));
    return UI_OPEN;
  }
  const given = LOCK_KEYS.filter(k => typeof p[k] === 'boolean').map(k => [k, p[k]]);
  const allLocked = ids.every(id => (Doc.byId(id).locks || {}).all);
  const set = given.length ? given : [['all', !allLocked]];
  ids.forEach(id => { const L = Doc.byId(id); L.locks = Object.assign({transparency:false, pixels:false, position:false, artboard:false, all:false}, L.locks || {}); set.forEach(([k, v]) => { L.locks[k] = v; }); });
  return {layers:ids.length};
});

/* ── 链接 ── layer_multi_cmds.rs:528 link_layers（已是同一组＝取消链接）／144 select_linked */
reg('layer.linkLayers', '{ids:[…]≥2 缺省＝多选／当前层} 链接图层（已是同一链接组就取消）→ {linked}' + UIP, p => {
  const ids = idsOf(p);
  const g0 = ids.length ? Doc.byId(ids[0]).linkGroup : undefined;
  if (p.ui && ids.length < 2 && g0 === undefined){ pickLayers('pickLink', ['連結圖層', '链接图层', 'Link Layers'], 2, ids => CMD.run('ps.layer.linkLayers', {ids})); return UI_OPEN; }
  if (!ids.length) return fail('no layer selected');
  if (ids.length === 1 && g0 === undefined) return fail('select two or more layers to link');
  const groups = ids.map(id => Doc.byId(id).linkGroup);
  const unlink = groups[0] !== undefined && groups.every(g => g === groups[0]);
  const next = Doc.layers.reduce((m, L) => Math.max(m, L.linkGroup || 0), 0) + 1;
  ids.forEach(id => { const L = Doc.byId(id); if (unlink) delete L.linkGroup; else L.linkGroup = next; });
  const cnt = {}; Doc.layers.forEach(L => { if (L.linkGroup !== undefined) cnt[L.linkGroup] = (cnt[L.linkGroup] || 0) + 1; });
  Doc.layers.forEach(L => { if (L.linkGroup !== undefined && cnt[L.linkGroup] < 2) delete L.linkGroup; });   // 落单的不算链接
  return {linked:!unlink};
});
reg('layer.selectLinkedLayers', '{ids?} 选择与选中层链接的所有层（写进 Doc.selectedIds，不进历史）→ {selected, ids}', p => {
  const ids = idsOf(p);
  const gs = new Set(ids.map(id => Doc.byId(id).linkGroup).filter(g => g !== undefined));
  if (!gs.size) return fail('the selected layers are not linked');
  const out = Doc.layers.filter(L => gs.has(L.linkGroup)).map(L => L.id);
  Doc.selectedIds = out;
  return {selected:out.length, ids:out};
}, false);

/* ── 合并 ── */
// commands.rs:570 merge_down＋pixels.rs:101：下层＋本层一起渲成下层（保留下层 id／名字／混合模式，不透明度 100%）
function mergeDown(L){
  const i = Doc.index(L.id); if (i <= 0) return fail('no layer below to merge into');
  const lower = Doc.layers[i - 1];
  const N = rasterFrom(flattenLayers([lower, L]), lower.name);
  N.id = lower.id; N.blend = lower.blend; N.opacity = 1;
  if (isBackground(lower)){ N.isBackground = true; if (lower.locks) N.locks = Object.assign({}, lower.locks); }   // 并进背景层还是背景层（PS）
  Doc.layers.splice(i - 1, 2, N); Doc.activeId = N.id;
  return {id:N.id};
}
reg('layer.mergeDown', '{id?} 向下合并', p => { const L = layerOf(p); return L ? mergeDown(L) : fail('no active layer'); });
// layer_multi_cmds.rs:640 merge_layers：只选一层＝向下合并；多层＝压成最上那层（隐藏的丢掉）
reg('layer.mergeLayers', '{ids?}（一层＝向下合并；多层＝合成一层放在最上那层的位置，隐藏的选中层丢掉）', p => {
  const ids = idsOf(p);
  if (ids.length < 2){ const L = Doc.byId(ids[0]); return L ? mergeDown(L) : fail('no active layer'); }
  const top = Doc.byId(ids[ids.length - 1]);
  const vis = ids.map(id => Doc.byId(id)).filter(L => L.visible);
  if (!vis.length) return fail('the selected layers are all hidden');
  const N = rasterFrom(flattenLayers(vis), top.name);
  if (top.locks) N.locks = Object.assign({}, top.locks);
  const set = new Set(ids);
  Doc.layers = Doc.layers.flatMap(L => L === top ? [N] : set.has(L.id) ? [] : [L]);
  Doc.activeId = N.id; Doc.selectedIds = [N.id];
  return {id:N.id};
});
// edit_cmds.rs:179 merge_visible：可见的压成一层放在最低那层的位置；隐藏的留着
reg('layer.mergeVisible', '{} 合并可见图层（最低一层是背景就垫白）', () => {
  const vis = Doc.layers.filter(L => L.visible);
  if (vis.length < 2) return fail('there are not enough visible layers to merge');
  const base = vis[0], bg = isBackground(base);
  const N = rasterFrom(flattenLayers(vis, bg ? '#ffffff' : null), base.name);
  if (base.locks) N.locks = Object.assign({}, base.locks);
  if (bg) N.isBackground = true;
  Doc.layers = Doc.layers.flatMap(L => L === base ? [N] : L.visible ? [] : [L]);
  Doc.activeId = N.id;
  return {id:N.id};
});
// commands.rs:590 flattenImage：整份压成一层「背景」，垫白，锁透明与位置
reg('layer.flattenImage', '{} 拼合图像：所有层压成一层背景（垫白）', () => {
  const N = rasterFrom(flattenLayers(Doc.layers, '#ffffff'), Lang.t('layer.bg'));
  N.isBackground = true; N.locks = {transparency:true, pixels:false, position:true, artboard:false, all:false};
  Doc.layers = [N]; Doc.activeId = N.id;
  return {id:N.id};
});

/* ── 修边 ── layer_menu_cmds.rs:226-309 */
function editRGBA(L, f){
  if (!L) return fail('no active layer');
  if (L.kind !== 'raster') return fail('active layer is a ' + L.kind + ' layer, not a pixel layer');
  const cv = L.data.canvas, img = L.data.ctx.getImageData(0, 0, cv.width, cv.height);
  f(img.data, cv.width, cv.height);
  L.data.ctx.putImageData(img, 0, 0);
  return {ok:true};
}
// algo selection.rs:580 edt（到最近 inside 像素的距离）
function edt(ins, w, h){ return edtNearest(ins, w, h)[0]; }
/* layer_menu_cmds.rs:228 defringe：离透明处 width 以内的边缘像素，从里往外一圈圈取内侧邻居的平均色（alpha 不动） */
function defringe(d, w, h, width){
  const n = w * h, outside = new Uint8Array(n);
  let any = false; for (let i = 0; i < n; i++) if (d[i * 4 + 3] / 255 <= 0.01){ outside[i] = 1; any = true; }
  if (!any) return;
  const dist = edt(outside, w, h), known = new Uint8Array(n);
  let todo = [];
  for (let i = 0; i < n; i++){ if (!outside[i] && dist[i] > width) known[i] = 1; if (!outside[i] && !known[i]) todo.push(i); }
  const NB = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  while (todo.length){
    const next = [], upd = [];
    for (const i of todo){
      const x = i % w, y = (i / w) | 0; let r = 0, g = 0, b = 0, c = 0;
      for (const [dx, dy] of NB){
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const j = Y * w + X; if (known[j]){ r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; c++; }
      }
      if (c) upd.push([i, r / c, g / c, b / c]); else next.push(i);
    }
    if (!upd.length) break;                       // 孤立的边，附近没有核心色
    for (const [i, r, g, b] of upd){ d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; known[i] = 1; }
    todo = next;
  }
}
reg('layer.matting.defringe', '{id?, width:1..200=1} 去边' + UIP, p => {
  const L = layerOf(p);
  if (p.ui){ if (!L || L.kind !== 'raster') return fail('not a pixel layer');
    dialog('defringe', ['邊緣修淨', '去边', 'Defringe'], [{key:'width', label:['寬度', '宽度', 'Width'], value:1, min:1, max:200, step:1}], v => CMD.run('ps.layer.matting.defringe', {id:L.id, width:v.width}));
    return UI_OPEN; }
  const width = Math.round(clamp(num(p, 'width', 1), 1, 200));
  return editRGBA(L, (d, w, h) => defringe(d, w, h, width));
});
// layer_menu_cmds.rs:279 remove_matte：把叠过黑／白底的半透明颜色还原
function removeMatte(L, white){
  return editRGBA(L, d => {
    for (let i = 0; i < d.length; i += 4){
      const a = d[i + 3] / 255; if (!(a > 0 && a < 1)) continue;
      for (let c = 0; c < 3; c++){ const v = d[i + c] / 255; d[i + c] = Math.round(clamp(white ? (v - (1 - a)) / a : v / a, 0, 1) * 255); }
    }
  });
}
reg('layer.matting.removeBlackMatte', '{id?} 移去黑色杂边', p => removeMatte(layerOf(p), false));
reg('layer.matting.removeWhiteMatte', '{id?} 移去白色杂边', p => removeMatte(layerOf(p), true));
// algo matting.rs:89 box_mean
function boxMean(src, w, h, r){
  const tmp = new Float32Array(w * h), pre = new Float64Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++){
    for (let x = 0; x < w; x++) pre[x + 1] = pre[x] + src[y * w + x];
    for (let x = 0; x < w; x++){ const lo = Math.max(0, x - r), hi = Math.min(w, x + r + 1); tmp[y * w + x] = (pre[hi] - pre[lo]) / (hi - lo); }
  }
  const out = new Float32Array(w * h), col = new Float64Array((h + 1) * w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) col[(y + 1) * w + x] = col[y * w + x] + tmp[y * w + x];
  for (let y = 0; y < h; y++){ const lo = Math.max(0, y - r), hi = Math.min(h, y + r + 1), nn = hi - lo; for (let x = 0; x < w; x++) out[y * w + x] = (col[hi * w + x] - col[lo * w + x]) / nn; }
  return out;
}
/* algo matting.rs:485 decontaminate：半透明边缘的颜色往附近不透明像素的颜色靠（alpha＝层自己的 alpha） */
function decontaminate(d, w, h, radius, amount){
  const n = w * h, rad = Math.ceil(Math.max(radius, 3)), am = clamp(amount, 0, 100) / 100;
  const al = new Float32Array(n), wts = new Float32Array(n);
  for (let i = 0; i < n; i++){ al[i] = d[i * 4 + 3] / 255; wts[i] = al[i] >= 0.98 ? al[i] : 0; }
  const soft = a => a > 0.02 && a < 0.98;
  let anySoft = false; for (let i = 0; i < n; i++) if (soft(al[i])){ anySoft = true; break; }
  if (!anySoft) return;
  const den = boxMean(wts, w, h, rad), den2 = boxMean(wts, w, h, rad * 4);
  for (let c = 0; c < 3; c++){
    const v = new Float32Array(n); for (let i = 0; i < n; i++) v[i] = wts[i] * d[i * 4 + c] / 255;
    const n1 = boxMean(v, w, h, rad), n2 = boxMean(v, w, h, rad * 4);
    for (let i = 0; i < n; i++){
      const a = al[i]; if (!soft(a)) continue;
      const k = am * clamp((1 - a) * 4, 0, 1); if (!k) continue;
      const cur = d[i * 4 + c] / 255;
      const f = den[i] > 1e-4 ? n1[i] / den[i] : den2[i] > 1e-4 ? n2[i] / den2[i] : cur;
      d[i * 4 + c] = Math.round(clamp(cur + (f - cur) * k, 0, 1) * 255);
    }
  }
}
reg('layer.matting.colorDecontaminate', '{id?, amount:0..100=100, radius:1..100=4} 颜色净化' + UIP, p => {
  const L = layerOf(p);
  if (p.ui){ if (!L || L.kind !== 'raster') return fail('not a pixel layer');
    dialog('decontaminate', ['色彩淨化', '颜色净化', 'Color Decontaminate'], [
      {key:'amount', label:['總量', '数量', 'Amount'], value:100, min:0, max:100},
      {key:'radius', label:['強度', '半径', 'Radius'], value:4, min:1, max:100}],
      v => CMD.run('ps.layer.matting.colorDecontaminate', {id:L.id, amount:v.amount, radius:v.radius}));
    return UI_OPEN; }
  const amount = clamp(num(p, 'amount', 100), 0, 100), radius = clamp(num(p, 'radius', 4), 1, 100);
  return editRGBA(L, (d, w, h) => decontaminate(d, w, h, radius, amount));
});

/* ── 只导出当前层 ── layer_menu_cmds.rs:650 layer_document：层单独渲（可见、正常模式）、裁到有像素的范围 */
function layerImage(L, k){
  const c = mkCanvas(Doc.width, Doc.height);
  drawOne(ctx2d(c), Object.assign({}, L, {visible:true, blend:'normal'}), 1);
  const b = alphaBox(c); if (!b) return null;
  const W = Math.max(1, Math.round(b.w * k)), H = Math.max(1, Math.round(b.h * k)), o = mkCanvas(W, H), ox = o.getContext('2d');
  ox.imageSmoothingQuality = 'high'; ox.drawImage(c, b.x, b.y, b.w, b.h, 0, 0, W, H);
  return o;
}
function exportLayer(L, k, fmt, name){
  if (!L) return fail('no active layer');
  const c = layerImage(L, k); if (!c) return fail('the layer is empty');
  const mime = fmt === 'jpg' || fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  let out = c;
  if (mime === 'image/jpeg'){ out = mkCanvas(c.width, c.height); const x = out.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(c, 0, 0); }
  return new Promise(res => out.toBlob(b => { download(b, (name || L.name) + '.' + ext); res({width:c.width, height:c.height, bytes:b.size}); }, mime, 0.92));
}
reg('layer.quickExportAsPng', '{id?, name?} 当前层单独导出成 PNG（裁到有像素的范围，浏览器下载）', p => exportLayer(layerOf(p), 1, 'png', p.name), false);
reg('layer.exportAs', '{id?, format:"png|jpg|webp"="png", scale:1..1000=100, name?} 当前层导出为…（浏览器下载）' + UIP, p => {
  const L = layerOf(p);
  if (p.ui){ if (!L) return fail('no active layer');
    dialog('exportAs', ['轉存為', '导出为', 'Export As'], [
      {key:'format', label:['格式', '格式', 'Format'], type:'select', value:'png', options:[['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP']]},
      {key:'scale', label:['縮放', '缩放', 'Scale'], value:100, min:1, max:1000}],
      v => CMD.run('ps.layer.exportAs', {id:L.id, format:v.format, scale:v.scale}));
    return {ok:true, dialog:true}; }
  return exportLayer(L, clamp(num(p, 'scale', 100), 1, 1000) / 100, String(p.format || 'png').toLowerCase(), p.name);
}, false);

/* ── 给 agent 看：图层上新增的那些栏位（doc.inspect 还没带） ── */
reg('layer.info', '{id?} 当前层的蒙版／样式／填充不透明度／锁定／链接／背景 → {…}', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  return {id:L.id, name:L.name, kind:L.kind, isBackground:isBackground(L), mask:maskOf(L) ? {enabled:!!L.mask} : null,
    style:L.style ? JSON.parse(JSON.stringify(L.style)) : null, fillOpacity:L.fillOpacity === undefined ? 1 : L.fillOpacity,
    locks:L.locks || null, linkGroup:L.linkGroup === undefined ? null : L.linkGroup, globalLight:Doc.globalLight || {angle:120, altitude:30}};
}, false);

/* ═══════════ 编辑图层蒙版（照 PS 2020；原码 photocraft 没有「画在蒙版上」）═══════════
   Doc.maskEdit＝正在编辑蒙版的那层 id（加蒙版时自动设、点蒙版缩图设、点图层缩图清）。这层是当前层、又有蒙版时，
   绘图命令（画笔／铅笔／渐变／填充／油漆桶／橡皮擦／模糊锐化涂抹减淡加深海绵）改画在蒙版上：
   蒙版暂时变成一张不透明灰阶图（灰＝露出多少）顶替这层的像素给命令画，画完灰阶写回蒙版（白＋alpha），像素原封不动。
   历史：CMD 在改道之前就推快照（快照里是真的像素＋蒙版），一步 Ctrl+Z。橡皮擦在蒙版上＝刷背景色（PS）。 */
const MASK_PAINT = /^(brush\.stroke|pencil\.stroke|gradient\.paint|ps\.edit\.fill|bucket\.fill|paint\.(stroke|fillRect|bucket)|eraser\.stroke|blur\.stroke|sharpen\.stroke|smudge\.stroke|dodge\.stroke|burn\.stroke|sponge\.stroke)$/;
const MASK_FILTER = /^ps\.filter\.(?!lastFilter$|filterGallery\.list$|vanishingPoint$|liquify$|cameraRaw$|adaptiveWideAngle$|lensCorrection$|render\.(flame|tree|pictureFrame)$)/;
const MASK_TOOLS = new Set(['brush', 'pencil', 'eraser', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'mixer', 'gradient', 'bucket']);
function maskEditing(){ const L = Doc.active(); return L && Doc.maskEdit === L.id && L.mask && L.mask.data ? L : null; }
const bgLum = () => { const e = document.getElementById('strokeColor'); const h = (e && e.value) || '#ffffff'; return 0.299 * parseInt(h.slice(1, 3), 16) + 0.587 * parseInt(h.slice(3, 5), 16) + 0.114 * parseInt(h.slice(5, 7), 16); };
/* 蒙版换上：这层的像素暂时换成一张不透明的灰阶图（灰＝蒙版 alpha），所有像素命令／工具／滤镜就画在它上面；
   writeBack＝灰阶写回蒙版（擦成透明的地方＝背景色的亮度，PS）；end＝换回像素。换上期间：
   ・合成（engine compositeOne）看 L._maskSwap ⇒ 照真的像素画、蒙版用灰阶图即时算 ⇒ 拖曳中直接看到蒙版效果
   ・历史快照（History.snap 包一层）照真的像素与换上前的蒙版记 */
const MaskSwap = {
  begin(L){
    if (L._maskSwap) return L._maskSwap;
    const M = L.mask, mc = M.data.canvas, W = mc.width, H = mc.height;
    const g = mkCanvas(W, H), gx = ctx2d(g), md = M.data.ctx.getImageData(0, 0, W, H), gd = gx.createImageData(W, H);
    for (let i = 0; i < W * H; i++){ const a = md.data[i * 4 + 3]; gd.data[i * 4] = gd.data[i * 4 + 1] = gd.data[i * 4 + 2] = a; gd.data[i * 4 + 3] = 255; }
    gx.putImageData(gd, 0, 0);
    const h = L._maskSwap = {L, M, gray:{canvas:g, ctx:gx}, keep:{data:L.data, x:L.x, y:L.y, locks:L.locks}, live:null};
    L.data = h.gray; L.x = M.x || 0; L.y = M.y || 0; if (L.locks) L.locks = Object.assign({}, L.locks, {transparency:false});
    return h;
  },
  /* 灰阶 → 蒙版的 alpha（out 给了就写进那张画布，不给就写回真的蒙版） */
  toMask(h, out){
    const g = h.gray.canvas, W = g.width, H = g.height, src = h.gray.ctx.getImageData(0, 0, W, H).data, bgl = bgLum();
    const tgt = out || h.M.data, nd = tgt.ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++){
      const a = src[i * 4 + 3] / 255, lum = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];
      nd.data[i * 4] = nd.data[i * 4 + 1] = nd.data[i * 4 + 2] = 255; nd.data[i * 4 + 3] = Math.round(a * lum + (1 - a) * bgl);
    }
    tgt.ctx.putImageData(nd, 0, 0);
  },
  writeBack(h){ this.toMask(h); h.M._cache = null; h.M._cacheScale = 0; Layer.invalidate(h.L); },
  end(h){
    const L = h.L; if (L._maskSwap !== h) return;
    L.data = h.keep.data; L.x = h.keep.x; L.y = h.keep.y; if (h.keep.locks) L.locks = h.keep.locks;
    delete L._maskSwap; Layer.invalidate(L);
  },
  /* 合成用的替身：真的像素＋即时灰阶算出来的蒙版 */
  view(L){
    const h = L._maskSwap; if (!h) return L;
    const g = h.gray.canvas;
    if (!h.live || h.live.data.canvas.width !== g.width || h.live.data.canvas.height !== g.height){ const c = mkCanvas(g.width, g.height); h.live = Object.assign({}, h.M, {data:{canvas:c, ctx:ctx2d(c)}}); }
    this.toMask(h, h.live.data); h.live._cache = null; h.live._cacheScale = 0;
    const P = Object.create(L); P.data = h.keep.data; P.x = h.keep.x; P.y = h.keep.y; P.mask = h.live; P._maskSwap = null;
    return P;
  }
};
/* 历史快照：换上期间照真的像素记 */
if (!History._maskSwapShim){
  const snap0 = History.snap;
  History.snap = function(){
    const sw = Doc.layers.filter(L => L._maskSwap).map(L => L._maskSwap);
    if (!sw.length) return snap0.apply(this, arguments);
    sw.forEach(h => { h.L.data = h.keep.data; h.L.x = h.keep.x; h.L.y = h.keep.y; });
    try { return snap0.apply(this, arguments); }
    finally { sw.forEach(h => { h.L.data = h.gray; h.L.x = h.M.x || 0; h.L.y = h.M.y || 0; }); }
  };
  History._maskSwapShim = true;
}
/* 选中蒙版时 Ctrl+I／Ctrl+L 等调整、Ctrl+T 变换改的是蒙版（同 PS），不改像素。
   调整：同绘图命令画在灰阶上。变换：只变蒙版（填充／调整图层没选蒙版也一样：它们的内容铺满整张，PS 变的就是蒙版）；
   变出文件外的部分裁掉、空出来的地方＝黑（藏），同 PS 透视收窄蒙版后露出的那圈。 */
const MASK_ADJUST = /^(ps\.)?image\.adjustments\./;
const MASK_XFORM = /^ps\.edit\.transform(\.(scale|rotate|skew|distort|perspective|flipHorizontal|flipVertical|rotate180|rotate90Cw|rotate90Ccw|again))?$/;
const XF_NEEDS_PARAMS = /\.(scale|rotate|skew|distort|perspective)$/;
function maskXformLayer(id, p){
  const tid = p && (p.layerId || p.layer || p.id);
  const L = tid ? Doc.byId(tid) : Doc.active();
  if (!L || !L.mask || !L.mask.data) return null;
  if (Doc.maskEdit === L.id && L.id === Doc.activeId) return L;
  return (L.fillLayer || L.adjust) ? L : null;
}
function flattenMaskGray(h){
  const L = h.L, W = Doc.width, H = Doc.height, g = h.gray.canvas;
  const c = mkCanvas(W, H), x = ctx2d(c);
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H); x.drawImage(g, (L.x || 0), (L.y || 0));
  h.gray.canvas = c; h.gray.ctx = x; L.x = 0; L.y = 0;
  const mc = mkCanvas(W, H); h.M.data = {canvas:mc, ctx:ctx2d(mc)}; h.M.x = 0; h.M.y = 0;
}
CMD.redirects.push((id, p) => {
  if (!MASK_XFORM.test(id)) return null;
  if (XF_NEEDS_PARAMS.test(id) && !(p && Object.keys(p).some(k => k !== 'dialog' && p[k] !== undefined))) return null;   // 进交互框／开对话框：照旧
  const L = maskXformLayer(id, p); if (!L) return null;
  const c = CMD.map[id];
  return {undoable:true, run:q => {
    const own = !L._maskSwap, h = MaskSwap.begin(L);
    let r;
    try { r = c.run(Object.assign({}, q, {layerId:L.id})); if (!(r && r.ok === false)){ flattenMaskGray(h); MaskSwap.writeBack(h); } }
    finally { if (own) MaskSwap.end(h); }
    return r && typeof r === 'object' ? Object.assign({}, r, {mask:true}) : r;
  }};
});
/* 绘图命令：画在蒙版上（已经换上＝工具拖曳中，只写回；没换上＝自己换、画、写回、换回） */
CMD.redirects.push((id, p) => {
  const paint = MASK_PAINT.test(id) || (MASK_ADJUST.test(id) && !(p && p.dialog)), filt = MASK_FILTER.test(id);
  if (!paint && !filt) return null;
  const L = maskEditing(); if (!L) return null;
  const tid = p && (p.layerId || p.layer || p.id);
  if (tid && tid !== L.id) return null;
  const c = CMD.map[id];
  if (filt){
    if (p && p.dialog) return null;                                  // 开对话框：照旧（预览由 ps-filter 的对话框看 PsLayer.maskEditing 处理）
    const fid = id.slice(3);
    if (!(window.PsFilter && PsFilter.run)) return null;
    return {undoable:true, run:q => {                                // 滤镜作用在蒙版（PS：选中蒙版缩图时滤镜套在蒙版上）
      const own = !L._maskSwap, h = MaskSwap.begin(L);
      let r;
      try { r = PsFilter.run(fid, Object.assign({}, q, {layer:L.id})); MaskSwap.writeBack(h); }
      finally { if (own) MaskSwap.end(h); }
      return Object.assign({ok:true}, r && typeof r === 'object' ? r : {}, {mask:true});
    }};
  }
  return {undoable:c.undoable, run:q => {
    const own = !L._maskSwap, h = MaskSwap.begin(L);
    let r;
    try { r = c.run(q); MaskSwap.writeBack(h); }
    finally { if (own) MaskSwap.end(h); }
    return r && typeof r === 'object' ? Object.assign({}, r, {mask:true}) : r;
  }};
});
/* 工具拖曳：按下就换上（预览直接画在灰阶上、合成照蒙版效果显示），放开等工具的命令跑完再换回 */
function hookPointer(){
  if (typeof Pointer === 'undefined' || Pointer._maskSwap) return;
  const d0 = Pointer.onDown.bind(Pointer), u0 = Pointer.onUp.bind(Pointer);
  Pointer.onDown = function(e, pt){
    const L = maskEditing(), T = window.Tools && Tools.current();
    if (L && T && MASK_TOOLS.has(T.id) && e.button !== 2 && !L._maskSwap) MaskSwap.begin(L);
    return d0(e, pt);
  };
  Pointer.onUp = function(e, pt){
    try { return u0(e, pt); }
    finally { Doc.layers.forEach(L => { if (L._maskSwap){ const h = L._maskSwap; MaskSwap.end(h); } }); if (window.UI) UI.draw(); }
  };
  Pointer._maskSwap = true;
}
hookPointer();
reg('layer.layerMask.target', '{id?, target:"mask"|"pixels"} 编辑蒙版／编辑像素（PS：点图层面板的蒙版缩图／图层缩图）；mask 时绘图命令画在蒙版上（灰阶：白＝露、黑＝藏）→ {target}', p => {
  const L = layerOf(p); if (!L) return fail('no active layer');
  if (p.target === 'mask'){ if (!L.mask) return fail('the layer has no layer mask'); Doc.maskEdit = L.id; Doc.activeId = L.id; }
  else if (Doc.maskEdit === L.id) Doc.maskEdit = null;
  if (window.UI) UI.refresh();
  return {ok:true, target:Doc.maskEdit === L.id ? 'mask' : 'pixels'};
}, false);
/* 图层面板：图层缩图右边的蒙版缩图（ui.js 图层列叫这支）；框住的那个＝正在编辑的（PS 的白角框） */
function maskThumb(L, row){
  const m = maskOf(L); if (!m || !m.data) return;
  const th = row.querySelector('canvas.thumb'), editing = Doc.maskEdit === L.id && !!L.mask;
  const c = document.createElement('canvas'); c.className = 'thumb mthumb'; c.width = 30; c.height = 24; c.dataset.maskOf = L.id;
  try { const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 30, 24); x.drawImage(m.data.canvas, 0, 0, 30, 24); } catch (e){}
  c.style.cssText = 'margin-left:0;outline-offset:1px;' + (editing ? 'outline:2px solid #e8e8e8;' : '') + (L.mask ? '' : 'opacity:.5;');   // 停用的蒙版淡一点（PS 打红叉）
  c.title = L3('圖層遮色片（按一下＝編輯遮色片）', '图层蒙版（单击＝编辑蒙版）', 'Layer mask (click to edit the mask)');
  c.onclick = e => { e.stopPropagation(); if (Doc.activeId !== L.id) CMD.run('layer.select', {id:L.id}); CMD.run('ps.layer.layerMask.target', {id:L.id, target:'mask'}); };
  if (th){
    if (editing) th.style.outline = 'none'; else if (Doc.activeId === L.id && L.mask) th.style.outline = '2px solid #e8e8e8';
    th.addEventListener('click', e => { if (!(e.ctrlKey || e.metaKey) && Doc.maskEdit === L.id) CMD.run('ps.layer.layerMask.target', {id:L.id, target:'pixels'}); });
    // PS：图层缩图跟蒙版缩图中间一个链条（链接中才看得到；点它＝链接／取消链接）
    const lk = document.createElement('span'), linked = L.maskLinked !== false;
    lk.className = 'mlink'; lk.dataset.linked = linked ? '1' : '0';
    lk.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:9px;flex:0 0 9px;cursor:pointer;' + (linked ? '' : 'opacity:0;');
    lk.innerHTML = '<svg width="7" height="14" viewBox="0 0 7 14"><rect x="1" y="0.8" width="5" height="5.4" rx="2.5" fill="none" stroke="#d0d0d0" stroke-width="1.2"/><rect x="1" y="7.8" width="5" height="5.4" rx="2.5" fill="none" stroke="#d0d0d0" stroke-width="1.2"/><line x1="3.5" y1="4.5" x2="3.5" y2="9.5" stroke="#d0d0d0" stroke-width="1.2"/></svg>';
    lk.title = L3('連結圖層遮色片', '链接图层蒙版', 'Link layer mask');
    lk.onclick = e => { e.stopPropagation(); if (CMD.map['ps.layer.layerMask.linked']) CMD.run('ps.layer.layerMask.linked', {id:L.id}); if (window.UI) UI.refresh(); };
    th.after(lk); lk.after(c);
  } else row.appendChild(c);
}

/* 对外（菜单 checked、测试） */
window.PsLayer = {
  maskThumb, maskEditing, MaskSwap,
  isBackground, idsOf, allFxHidden, drawOne, flattenLayers, closeDialog, openStyleDialog, fxExt:FX_EXT,
  maskEnabled: () => { const L = Doc.active(); return !!(L && L.mask); },
  fx:{distOutside, distInside, tent, shadowMap, glowMap, composeFx, gradientT, gradientLayout}
};
})();
