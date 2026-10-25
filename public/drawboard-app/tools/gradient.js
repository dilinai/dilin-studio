/* 渐变（G）——照 ArtCraft 的 Rust 原码逐段翻译
   一颗工具两套行为，用 (Doc.active||{}).kind 分岔：

   ▸ 像素层＝PhotoCraft「经典渐变」（Classic gradient）：拖出起点→终点，把渐变直接画进当前像素层
     对照源（photocraft/crates/…）：
       ui-egui/src/canvas.rs 1906-1913        拖曳预览：黑晕 3px＋白线 1px，两端半径 3 的白点
       ui-egui/src/canvas.rs 1942-1964        tool_move：⇧ 经 stroke_constraint::constrain → 渐变用 snap45(起点, 指针)
       ui-egui/src/canvas.rs 2205-2215        放开：|dx|+|dy| ≥ 2 才画；送 paint.gradient {from,to,style,reverse,dither,colors:[前景,背景],opacity}
       ui-egui/src/stroke_constraint.rs 35-70 snapped_dir／project／snap45（放开那一点也锁）
       ui-egui/src/panels.rs 637-671          选项栏：渐变色带、线性／径向／角度／对称／菱形、不透明度 1..100、反向、仿色
       ui-egui/src/state.rs 315-322, 421-425  选项预设：linear、不反向、仿色开、100%
       engine/src/paint_cmds.rs 74-131        paint.gradient：色标来源（colors 平均分布／gradient 预设名／stops＋transparency／目前渐变）、reverse、opacity、mode、dither 预设 true、area＝选区外框∩画布
       algo/src/paint.rs 20-56, 113-147       tool_gradient_t 五种形状、sample_stops、paint_gradient（覆盖度＝不透明度×选区、取像素中心、单色噪声仿色 ±½ 阶）
       color/src/lib.rs 16-22                 dither_noise（整数杂凑）
       color/src/blend.rs 322-342             composite（W3C 合成式，混合模式走 blend_rgb）
       engine/src/presets/gradients.rs        预设：内建九组、前景到背景、前景到透明、resolve（透明度色标并入、每段 4 等分取样）、gradient.presets.list/select/new/edit/reset
       engine/src/presets/mod.rs 199-292      find／unique_name／group_index／edit_groups（rename/delete/move/newGroup/renameGroup/deleteGroup）
   ▸ 矢量层＝VectorCraft 渐变工具（G）＋渐变批注器：给选中形状的填色（或描边）设渐变
       tools/src/xform/gradient.rs 1-582      批注器几何与命中顺序；手势：在物件上拖＝画渐变向量、拖起点或线条＝整条搬、拖终点＝改长度角度、终点外＝绕起点转、
                                              径向的焦点／长宽比把手、色标拖曳（Alt 复制、拖离 24px 删除）、中点菱形、点线条＝加色标、点物件内＝从那点套用；
                                              ⇧ 锁 45°（否则吸附智能参考线）；双击色标开浮窗；Delete／Backspace 删选中色标（不少于两个）、←→ 微移 1%（⇧ 10%）；Esc 取消
       engine/src/cmd/gradient.rs             paint.editGradient（apply_gradient_edit：kind／stops／reverse 镜像中点／angle／aspect、保焦点）、paint.setGradientGeom（vector_paint）、gradient.selectStop、parse_stops
       color/src/gradient.rs                  Gradient::sample（中点映射）、expanded_stops、insert／remove／move／duplicate_stop、set_midpoint、midpoint_pos／from_pos、
                                              GradientGeom fit／unit_frame／set_focal／keep_focal_from／transform、预设「白到黑」
       tools/src/guides.rs 31-172             智能参考线：锚点、外框角与中心、工作区域（＝画布）→ snap_point（先点、再 x／y 对齐）
       ui-egui/src/dialogs/gradient_stop.rs   双击色标的浮窗：颜色、不透明度 %、位置 %（gradient.stopEdit 是它的 confirm）
       geom/src/lib.rs 53-61                  constrain_angle_from

   🔴 矢量层的渐变资料格式（图层坐标）：
       shape.fill（或 shape.stroke）= {type:'linear'|'radial',
                                     stops:[{offset:0..1, color:'#rrggbb', opacity:0..1, midpoint?:0.13..0.87（缺省 .5，到下一个色标的中点）}],
                                     x1,y1,x2,y2,              线性：起点→终点；径向：x1,y1＝圆心，x2,y2＝向量终点（半径方向）
                                     r?,                       径向：半径＝|终点−圆心|（写入时自动算）
                                     aspect?,                  径向：椭圆长宽比（垂直于向量那轴／半径，缺省 1）
                                     fx?, fy?}                 径向：焦点（第一个色标所在处，缺省＝圆心）
     渲染：GradientFill.toCanvas(ctx, shape, scale, 'fill'|'stroke') → CanvasGradient（椭圆径向回 CanvasPattern）；engine.js drawShape 要接这一处。
   🔴 改文件的事全走 CMD：gradient.paint（像素）、gradient.setGeom／gradient.edit／gradient.stopEdit（矢量），都进历史；拖曳中只预览、放开一条命令一步历史。 */
(function(){
'use strict';

/* ═══════════ 小工具 ═══════════ */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fin = v => typeof v === 'number' && isFinite(v);
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const hyp = a => Math.hypot(a[0], a[1]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pt2 = v => (Array.isArray(v) && v.length >= 2 && fin(+v[0]) && fin(+v[1])) ? [+v[0], +v[1]] : null;
const hex2 = v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
const toHex = c => '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
/* '#rgb'／'#rrggbb'／'#rrggbbaa' → [r,g,b,a] 0..1；不认得回 null */
function parseHex(s){
  if (typeof s !== 'string') return null;
  let h = s.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('');
  if (!/^([0-9a-f]{6}|[0-9a-f]{8})$/i.test(h)) return null;
  const b = i => parseInt(h.slice(i, i + 2), 16) / 255;
  return [b(0), b(2), b(4), h.length === 8 ? b(6) : 1];
}
/* 前景／背景＝我们的填色／描边两个色块（说明.md：PS 的前景背景色块＝我们的填色描边） */
const fgHex = () => (document.getElementById('fillColor') || {}).value || '#000000';
const bgHex = () => (document.getElementById('strokeColor') || {}).value || '#ffffff';
const zoomOf = () => Math.max((window.UI && UI.zoom) || 1, 1e-3);
const activeKind = () => (Doc.active() || {}).kind;

/* ═══════════════════════════════════════════════════════════════════════
   A. 像素层：PhotoCraft 经典渐变
   ═══════════════════════════════════════════════════════════════════════ */

/* ── presets/gradients.rs ── 预设 {name, stops:[[t, '#hex'|'foreground'|'background']], opacity:[[t, 0..1]]} */
function presetNew(name, colors){                         // GradientPreset::new：颜色平均分布
  const n = Math.max(colors.length, 2) - 1;
  return {name, stops:colors.map((c, i) => [i / n, c]), opacity:[]};
}
const fgToBg = () => ({name:'Foreground to Background', stops:[[0, 'foreground'], [1, 'background']], opacity:[]});
function builtin(){                                       // gradients.rs:200-324（颜色照抄）
  const fam = (prefix, sets) => sets.map((c, i) => presetNew(`${prefix} ${String(i + 1).padStart(2, '0')}`, c));
  return [
    {name:'Basics', items:[fgToBg(), {name:'Foreground to Transparent', stops:[[0, 'foreground'], [1, 'foreground']], opacity:[[0, 1], [1, 0]]}, presetNew('Black, White', ['#000000', '#ffffff'])]},
    {name:'Blues', items:fam('Blue', [['#0b3d91', '#4fa3e0'], ['#1c2a5a', '#3f6fd8', '#a8d4ff'], ['#00b4d8', '#03045e'], ['#5ec8f2', '#e6f6ff'], ['#253b80', '#20b2aa'], ['#89c2ff', '#1d4ed8', '#0a1a40']])},
    {name:'Purples', items:fam('Purple', [['#3c096c', '#c77dff'], ['#5a189a', '#e0aaff'], ['#240046', '#7b2cbf', '#f3d9ff'], ['#9d4edd', '#4361ee'], ['#6a0572', '#ab83a1'], ['#2d0b59', '#ff6fd8']])},
    {name:'Pinks', items:fam('Pink', [['#ff4d8d', '#ffd1e1'], ['#c9184a', '#ff8fab'], ['#ff70a6', '#ffd670'], ['#8e2c5a', '#f7a1c4', '#fff0f5'], ['#ff5fa2', '#a855f7'], ['#ffc2d6', '#ff2e63']])},
    {name:'Reds', items:fam('Red', [['#7f0000', '#ff3b30'], ['#d00000', '#ffba08'], ['#370617', '#9d0208', '#f48c06'], ['#e5383b', '#f5f3f4'], ['#a4161a', '#0b090a'], ['#ff595e', '#ffca3a']])},
    {name:'Oranges', items:fam('Orange', [['#ff6d00', '#ffd60a'], ['#e85d04', '#ffba08'], ['#9c3d0b', '#ff9e40', '#fff1d6'], ['#ff7b00', '#ff0054'], ['#fb8500', '#023047'], ['#ffb703', '#fb5607']])},
    {name:'Greens', items:fam('Green', [['#004b23', '#70e000'], ['#2d6a4f', '#b7e4c7'], ['#1b4332', '#40916c', '#d8f3dc'], ['#38b000', '#ccff33'], ['#0b6e4f', '#08a0a8'], ['#606c38', '#dda15e']])},
    {name:'Browns', items:fam('Brown', [['#3e2412', '#a47148'], ['#6f4518', '#e6ccb2'], ['#2b1708', '#7f5539', '#ddb892'], ['#8b5e34', '#ffd8a8'], ['#582f0e', '#b6ad90'], ['#4a3728', '#c08552', '#f3e9dc']])},
    {name:'Grays', items:fam('Gray', [['#212529', '#f8f9fa'], ['#495057', '#dee2e6'], ['#000000', '#6c757d', '#ffffff'], ['#343a40', '#adb5bd', '#343a40'], ['#8d99ae', '#2b2d42'], ['#e9ecef', '#ced4da', '#868e96']])}
  ];
}
const GP = { groups:builtin(), current:fgToBg() };       // s.presets.gradients／s.presets.gradient（出厂＝前景到背景）

const lerp4 = (a, b, t) => [0, 1, 2, 3].map(i => a[i] + (b[i] - a[i]) * t);
/* gradients.rs:60 sample：分段线性、两端夹住 */
function sampleP(stops, t, mix){
  if (!stops.length) return null;
  const f = stops[0];
  if (t <= f[0]) return Array.isArray(f[1]) ? f[1].slice() : f[1];
  for (let i = 0; i + 1 < stops.length; i++){
    const [t0, a] = stops[i], [t1, b] = stops[i + 1];
    if (t <= t1){ const u = t1 > t0 ? (t - t0) / (t1 - t0) : 1; return mix(a, b, u); }
  }
  const l = stops[stops.length - 1][1];
  return Array.isArray(l) ? l.slice() : l;
}
/* gradients.rs:90 resolve：颜色色标＋透明度色标合成 RGBA 色标（两边都在变时每段 4 等分取样） */
function resolvePreset(g, fg, bg){
  const rgb = c => c === 'foreground' ? [fg[0], fg[1], fg[2], 1] : c === 'background' ? [bg[0], bg[1], bg[2], 1]
                 : (() => { const h = parseHex(c) || [0, 0, 0]; return [h[0], h[1], h[2], 1]; })();
  let cs = (g.stops || []).map(([t, c]) => [clamp(t, 0, 1), rgb(c)]).sort((a, b) => a[0] - b[0]);
  if (!cs.length) cs = [[0, [fg[0], fg[1], fg[2], 1]], [1, [bg[0], bg[1], bg[2], 1]]];
  const os = (g.opacity || []).map(([t, a]) => [clamp(t, 0, 1), clamp(a, 0, 1)]).sort((a, b) => a[0] - b[0]);
  if (!os.length || os.every(o => Math.abs(o[1] - 1) < 1e-6)) return cs;
  const raw = cs.map(s => s[0]).concat(os.map(s => s[0]), [0, 1]).sort((a, b) => a - b);
  const ts = []; for (const t of raw) if (!ts.length || Math.abs(t - ts[ts.length - 1]) >= 1e-6) ts.push(t);   // dedup_by
  const all = [];
  for (let i = 0; i + 1 < ts.length; i++) for (let k = 0; k < 4; k++) all.push(ts[i] + (ts[i + 1] - ts[i]) * k / 4);
  all.push(1);
  return all.map(t => {
    const c = sampleP(cs, t, lerp4) || [0, 0, 0, 0];
    const a = sampleP(os, t, (x, y, u) => x + (y - x) * u);
    c[3] = a === null ? 1 : a;
    return [t, c];
  });
}
/* gradients.rs:166 from_params：{stops:[[t,"#hex"|"foreground"|"background"]…] 或 ["#hex"…]（平均分布）, transparency:[[t, 0..100]…]} */
function presetFromParams(name, p, cmd){
  const arr = p.stops;
  if (!Array.isArray(arr)) throw new Error(`${cmd}: missing \`stops\``);
  const stops = arr.map((s, i) => {
    let t = null, c = null;
    if (Array.isArray(s) && s.length === 2){ t = fin(s[0]) ? s[0] : null; c = typeof s[1] === 'string' ? s[1] : null; }
    else if (typeof s === 'string'){ t = arr.length > 1 ? i / (arr.length - 1) : 0; c = s; }
    if (t === null || c === null) throw new Error(`${cmd}: stops are [location, "#rrggbb"|"foreground"|"background"]`);
    if (c !== 'foreground' && c !== 'background'){
      const h = c.replace(/^#/, '');
      if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`${cmd}: bad stop colour \`${c}\``);
      c = '#' + h.toLowerCase();
    }
    return [clamp(t, 0, 1), c];
  });
  if (stops.length < 2) throw new Error(`${cmd}: a gradient needs at least 2 colour stops`);
  stops.sort((a, b) => a[0] - b[0]);
  const opacity = (Array.isArray(p.transparency) ? p.transparency : [])
    .filter(o => Array.isArray(o) && fin(o[0]) && fin(o[1])).map(o => [o[0], clamp(o[1] / 100, 0, 1)]).sort((a, b) => a[0] - b[0]);
  return {name, stops, opacity};
}
const presetJSON = g => ({name:g.name, stops:g.stops.map(s => s.slice()), transparency:(g.opacity || []).map(([t, a]) => [t, Math.round(a * 100)])});
/* mod.rs:199 find／209 unique_name／219 group_index */
function findPreset(name, group){
  for (let gi = 0; gi < GP.groups.length; gi++){
    const g = GP.groups[gi]; if (group && g.name !== group) continue;
    const ii = g.items.findIndex(x => x.name === name); if (ii >= 0) return [gi, ii];
  }
  return null;
}
function uniqueName(base){
  const taken = n => GP.groups.some(g => g.items.some(i => i.name === n));
  if (!taken(base)) return base;
  for (let i = 2; ; i++) if (!taken(`${base} ${i}`)) return `${base} ${i}`;
}
function groupIndex(group){
  if (group){ let i = GP.groups.findIndex(g => g.name === group); if (i < 0){ GP.groups.push({name:group, items:[]}); i = GP.groups.length - 1; } return i; }
  if (!GP.groups.length) GP.groups.push({name:'Presets', items:[]});
  return 0;
}
/* gradients.rs:339 tool_stops：colors 给了⇒null（交给 paint.gradient 平均分布）；否则 gradient 预设名 → stops → 目前渐变 */
function toolStops(p, fg, bg){
  if (Array.isArray(p.colors) && p.colors.length) return null;
  if (typeof p.gradient === 'string'){
    const f = findPreset(p.gradient); if (!f) throw new Error(`paint.gradient: no gradient preset "${p.gradient}"`);
    return resolvePreset(GP.groups[f[0]].items[f[1]], fg, bg);
  }
  if (p.stops !== undefined) return resolvePreset(presetFromParams('Custom', p, 'paint.gradient'), fg, bg);
  return resolvePreset(GP.current, fg, bg);
}
/* paint_cmds.rs:15 color()：[r,g,b,a?] 0..1 或 "#rrggbb(aa)"，认不得用前景 */
function legacyColor(v, d){
  if (Array.isArray(v) && v.length >= 3){ const c = v.map(x => +x || 0); return [c[0], c[1], c[2], c.length > 3 ? c[3] : 1]; }
  if (typeof v === 'string'){ const h = v.replace(/^#/, ''); if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return parseHex('#' + h); }
  return d.slice();
}

/* ── algo/paint.rs ── */
function gradT(shape, from, to, x, y){                    // paint.rs:21 tool_gradient_t
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const len = Math.max(Math.sqrt(dx * dx + dy * dy), 1e-6);
  const ux = dx / len, uy = dy / len, px = x - from[0], py = y - from[1];
  const along = px * ux + py * uy, across = -px * uy + py * ux;
  let t;
  if (shape === 'radial') t = Math.sqrt(px * px + py * py) / len;
  else if (shape === 'reflected') t = Math.abs(along) / len;
  else if (shape === 'diamond') t = (Math.abs(along) + Math.abs(across)) / len;
  else if (shape === 'angle'){ const a = Math.atan2(across, along) / (Math.PI * 2); t = ((a % 1) + 1) % 1; }
  else t = along / len;
  return clamp(t, 0, 1);
}
function sampleStops(stops, t){                           // paint.rs:39 sample_stops（不含中点）
  if (!stops.length) return [0, 0, 0, 0];
  if (stops.length === 1) return stops[0][1].slice();
  if (t <= stops[0][0]) return stops[0][1].slice();
  for (let i = 0; i + 1 < stops.length; i++){
    const a = stops[i], b = stops[i + 1];
    if (t <= b[0]){ const k = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0; return [0, 1, 2, 3].map(j => a[1][j] + (b[1][j] - a[1][j]) * k); }
  }
  return stops[stops.length - 1][1].slice();
}
function ditherNoise(x, y){                               // color/src/lib.rs:16 dither_noise
  let h = (Math.imul(x, 0x9E3779B1) ^ Math.imul(y, 0x85EBCA77)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2C1B3C6D) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  return (h & 0xFFFF) / 65535;
}
/* color/src/blend.rs：blend_rgb（W3C 可分离／不可分离混合）＋ composite */
const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c){
  const l = lum(c), n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]);
  let o = c.slice();
  if (n < 0) o = o.map(v => l + (v - l) * l / (l - n));
  if (x > 1) o = o.map(v => l + (v - l) * (1 - l) / (x - l));
  return o;
}
const setLum = (c, l) => { const d = l - lum(c); return clipColor(c.map(v => v + d)); };
const satOf = c => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
function setSat(c, s){
  const [mn, md, mx] = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const o = [0, 0, 0];
  if (c[mx] > c[mn]){ o[md] = (c[md] - c[mn]) * s / (c[mx] - c[mn]); o[mx] = s; }
  return o;
}
function blendRGB(mode, b, s){
  const sep = f => [f(b[0], s[0]), f(b[1], s[1]), f(b[2], s[2])];
  const screen = (x, y) => x + y - x * y;
  switch (mode){
    case 'multiply': return sep((x, y) => x * y);
    case 'screen': return sep(screen);
    case 'overlay': return sep((x, y) => x <= 0.5 ? y * 2 * x : screen(y, 2 * x - 1));   // Overlay(Cb,Cs)＝HardLight(Cs,Cb)
    case 'darken': return sep(Math.min);
    case 'lighten': return sep(Math.max);
    case 'difference': return sep((x, y) => Math.abs(x - y));
    case 'hue': return setLum(setSat(s, satOf(b)), lum(b));
    case 'saturation': return setLum(setSat(b, satOf(s)), lum(b));
    case 'color': return setLum(s, lum(b));
    case 'luminosity': return setLum(b, lum(s));
    default: return s.slice(0, 3);
  }
}
function composite(mode, d, s, opacity){                  // blend.rs:322
  const ab = d[3], as = s[3] * opacity;
  if (as <= 0) return d;
  const cb = [d[0], d[1], d[2]], cs = [s[0], s[1], s[2]], bl = blendRGB(mode, cb, cs);
  const ao = as + ab * (1 - as);
  if (ao <= 0) return [0, 0, 0, 0];
  const o = [0, 0, 0, ao];
  for (let i = 0; i < 3; i++) o[i] = ((1 - as) * ab * cb[i] + (1 - ab) * as * cs[i] + as * ab * bl[i]) / ao;
  return o;
}
/* paint.rs:115 paint_gradient（paint_cmds.rs:100-104 的 area 在这里算）。from/to 是文件坐标；L 的画布是图层坐标（铁律④） */
function paintGradient(L, from, to, shape, stops, reverse, opacity, mode, dither){
  const W = Doc.width, H = Doc.height, sel = Doc.sel;
  let x0 = 0, y0 = 0, x1 = W, y1 = H, cov = null, rectCov = null;
  if (sel){
    const bx0 = Math.floor(Math.min(sel.x, sel.x + sel.w)), bx1 = Math.ceil(Math.max(sel.x, sel.x + sel.w));
    const by0 = Math.floor(Math.min(sel.y, sel.y + sel.h)), by1 = Math.ceil(Math.max(sel.y, sel.y + sel.h));
    if (bx1 > bx0 && by1 > by0){ x0 = Math.max(bx0, 0); y0 = Math.max(by0, 0); x1 = Math.min(bx1, W); y1 = Math.min(by1, H); }  // content_bounds ∩ doc.bounds()
    if (window.SelMask) cov = SelMask.bytes(sel);                                                // selection.sample_channel(x,y,0)
    else rectCov = (X, Y) => (X >= sel.x && X < sel.x + sel.w && Y >= sel.y && Y < sel.y + sel.h) ? 1 : 0;
  }
  const ox = Math.round(L.x), oy = Math.round(L.y), cv = L.data.canvas;
  const lx0 = Math.max(x0 - ox, 0), ly0 = Math.max(y0 - oy, 0), lx1 = Math.min(x1 - ox, cv.width), ly1 = Math.min(y1 - oy, cv.height);
  if (lx1 <= lx0 || ly1 <= ly0) return 0;
  const w = lx1 - lx0, img = L.data.ctx.getImageData(lx0, ly0, w, ly1 - ly0), d = img.data;
  let n = 0;
  for (let ly = ly0; ly < ly1; ly++){
    const Y = ly + oy;
    for (let lx = lx0; lx < lx1; lx++){
      const X = lx + ox;
      const k = opacity * (cov ? cov[Y * W + X] / 255 : rectCov ? rectCov(X, Y) : 1);
      if (k <= 0) continue;
      const t = gradT(shape, from, to, X + 0.5, Y + 0.5);
      const c = sampleStops(stops, reverse ? 1 - t : t);
      if (dither){                                        // 一阶单色噪声打散 8 位色阶
        const nz = (ditherNoise(X, Y) - 0.5) / 255;
        for (let j = 0; j < 3; j++) c[j] = clamp(c[j] + nz, 0, 1);
      }
      const i = ((ly - ly0) * w + (lx - lx0)) * 4;
      const o = composite(mode, [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, d[i + 3] / 255], c, k);
      d[i] = Math.round(clamp(o[0], 0, 1) * 255); d[i + 1] = Math.round(clamp(o[1], 0, 1) * 255);
      d[i + 2] = Math.round(clamp(o[2], 0, 1) * 255); d[i + 3] = Math.round(clamp(o[3], 0, 1) * 255);
      n++;
    }
  }
  L.data.ctx.putImageData(img, lx0, ly0);
  return n;
}

const STYLES = ['linear', 'radial', 'angle', 'reflected', 'diamond'];
CMD.reg('gradient.paint', {i18n:'tool.gradient', undoable:true,
  params:'{from:[x,y], to:[x,y] 文件坐标, style="linear|radial|angle|reflected|diamond"="linear", colors?:["#rrggbb(aa)"|[r,g,b,a]…]（平均分布）, gradient?:预设名, stops?:[[t,"#rrggbb"|"foreground"|"background"]…], transparency?:[[t,0..100]…]（都没给＝目前渐变，见 gradient.presets.select）, reverse=false, dither=true, opacity=1..100=100, mode="normal|multiply|…"="normal", layerId?} 同 PhotoCraft paint.gradient：把渐变画进像素层；有选区只画选区内（覆盖度×不透明度）；像素中心取样；前景＝填色色块、背景＝描边色块 → {ok, painted:像素数}'},
  p => {
    const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
    if (!L || L.kind !== 'raster') return {ok:false, error:'gradient.paint: not a pixel layer'};
    const from = pt2(p.from), to = pt2(p.to);
    if (!from) return {ok:false, error:'gradient.paint: missing from'};
    if (!to) return {ok:false, error:'gradient.paint: missing to'};
    const shape = STYLES.includes(p.style) ? p.style : 'linear';
    const fg = parseHex(fgHex()), bg = parseHex(bgHex());
    let stops;
    try { stops = toolStops(p, fg, bg); } catch (e){ return {ok:false, error:e.message}; }
    if (!stops){
      const cols = p.colors.map(v => legacyColor(v, fg)), n = cols.length;
      stops = cols.map((c, i) => [n > 1 ? i / (n - 1) : 0, c]);
    }
    const reverse = p.reverse === true;
    const opacity = clamp((fin(p.opacity) ? p.opacity : 100) / 100, 0, 1);
    const mode = (typeof BLENDS !== 'undefined' && BLENDS.includes(p.mode)) ? p.mode : 'normal';
    const dither = p.dither !== false;                    // Photoshop 预设就仿色
    return {ok:true, painted:paintGradient(L, from, to, shape, stops, reverse, opacity, mode, dither)};
  });

/* gradient.presets.*（gradients.rs:459-527） */
CMD.reg('gradient.presets.list', {i18n:'', params:'{} → {groups:[{name, presets:[{name, stops, transparency}]}], current}'},
  () => ({ok:true, groups:GP.groups.map(g => ({name:g.name, presets:g.items.map(presetJSON)})), current:presetJSON(GP.current)}));
CMD.reg('gradient.presets.select', {i18n:'',
  params:'{preset:名 | stops:[[t,"#rrggbb"|"foreground"|"background"]…], transparency?, group?:组名} 设成目前渐变（渐变工具在像素层拖曳就画它；选「Foreground to Background」＝前景到背景） → {current}'},
  p => {
    let g;
    if (typeof p.preset === 'string'){
      const f = findPreset(p.preset, typeof p.group === 'string' ? p.group : null);
      if (!f) return {ok:false, error:`gradient.presets.select: no gradient preset "${p.preset}" (see gradient.presets.list)`};
      g = GP.groups[f[0]].items[f[1]];
    } else if (p.stops !== undefined){
      try { g = presetFromParams(typeof p.name === 'string' ? p.name : 'Custom', p, 'gradient.presets.select'); } catch (e){ return {ok:false, error:e.message}; }
    } else g = GP.current;
    GP.current = JSON.parse(JSON.stringify(g));
    refreshOptions();
    return {ok:true, current:presetJSON(GP.current)};
  });
CMD.reg('gradient.presets.new', {i18n:'', params:'{name="Custom", group?, stops?, transparency?（缺省＝目前渐变）} 新增预设（名字重复自动加编号） → {name, group}'}, p => {
  let g;
  try { g = p.stops !== undefined ? presetFromParams('', p, 'gradient.presets.new') : JSON.parse(JSON.stringify(GP.current)); } catch (e){ return {ok:false, error:e.message}; }
  g.name = uniqueName(typeof p.name === 'string' ? p.name : 'Custom');
  const gi = groupIndex(typeof p.group === 'string' ? p.group : null);
  GP.groups[gi].items.push(g); refreshOptions();
  return {ok:true, name:g.name, group:GP.groups[gi].name};
});
CMD.reg('gradient.presets.edit', {i18n:'',
  params:'{action:"rename|delete|move|newGroup|renameGroup|deleteGroup", preset:名|[名…], group?, name?, to?:组, index?} 同 PhotoCraft 预设面板的群组编辑'}, p => {
  const group = typeof p.group === 'string' ? p.group : null, need = (k) => { if (typeof p[k] !== 'string') throw new Error(`gradient.presets.edit: missing \`${k}\``); return p[k]; };
  try {
    switch (p.action){
      case 'rename': {
        const name = need('preset'), to = need('name'), f = findPreset(name, group);
        if (!f) throw new Error(`no preset "${name}"`);
        if (name !== to && findPreset(to)) throw new Error(`a preset named "${to}" already exists`);
        GP.groups[f[0]].items[f[1]].name = to; refreshOptions(); return {ok:true, name:to};
      }
      case 'delete': {
        const names = Array.isArray(p.preset) ? p.preset.filter(x => typeof x === 'string') : [need('preset')];
        for (const n of names){ const f = findPreset(n, group); if (!f) throw new Error(`no preset "${n}"`); GP.groups[f[0]].items.splice(f[1], 1); }
        refreshOptions(); return {ok:true, deleted:names.length};
      }
      case 'move': {
        const name = need('preset'), to = need('to'), f = findPreset(name, group);
        if (!f) throw new Error(`no preset "${name}"`);
        const [item] = GP.groups[f[0]].items.splice(f[1], 1), ti = groupIndex(to), list = GP.groups[ti].items;
        list.splice(fin(p.index) ? Math.min(Math.max(0, p.index | 0), list.length) : list.length, 0, item);
        refreshOptions(); return {ok:true, group:to};
      }
      case 'newGroup': {
        const base = typeof p.name === 'string' ? p.name : 'Group', taken = n => GP.groups.some(g => g.name === n);
        let name = base; if (taken(base)) for (let i = 1; ; i++) if (!taken(`${base} ${i}`)){ name = `${base} ${i}`; break; }
        GP.groups.push({name, items:[]}); refreshOptions(); return {ok:true, group:name};
      }
      case 'renameGroup': {
        const g = need('group'), to = need('name'), i = GP.groups.findIndex(x => x.name === g);
        if (i < 0) throw new Error(`no group "${g}"`);
        GP.groups[i].name = to; refreshOptions(); return {ok:true, group:to};
      }
      case 'deleteGroup': {
        const g = need('group'), i = GP.groups.findIndex(x => x.name === g);
        if (i < 0) throw new Error(`no group "${g}"`);
        const [r] = GP.groups.splice(i, 1); refreshOptions(); return {ok:true, group:g, deleted:r.items.length};
      }
      default: throw new Error(`unknown action ${p.action}`);
    }
  } catch (e){ return {ok:false, error:'gradient.presets.edit: ' + e.message}; }
});
CMD.reg('gradient.presets.reset', {i18n:'', params:'{append=false} 回复内建预设（append＝接在后面、组名重复加编号）'}, p => {
  const b = builtin();
  if (p.append === true){
    for (const g of b){ const taken = n => GP.groups.some(x => x.name === n); if (taken(g.name)) for (let i = 1; ; i++) if (!taken(`${g.name} ${i}`)){ g.name = `${g.name} ${i}`; break; } }
    GP.groups = GP.groups.concat(b);
  } else GP.groups = b;
  refreshOptions(); return {ok:true, groups:GP.groups.length};
});
/* PS 渐变面板选单「旧版渐变」：把 PS 2020 前的那几组追加进来（这里只收「金属」那组：金／银／铜／铬／钢条…，
   做金属立体字、金属按钮常用；颜色照 PS 旧版 Metals 的观感取，非逐点照抄） */
const LEGACY_METALS = [
  ['Gold', ['#7a5410', '#f6e27a', '#b88a2a', '#fff6c8', '#8a6014', '#e9c25a']],
  ['Silver', ['#6e6e6e', '#f4f4f4', '#9a9a9a', '#ffffff', '#5c5c5c', '#d8d8d8']],
  ['Copper', ['#5a2a10', '#e8a07a', '#8a4a20', '#ffd6bc', '#6b3010', '#c87a50']],
  ['Chrome', ['#1c2833', '#ffffff', '#4f6475', '#c9d6df', '#121a21', '#eef2f5']],
  ['Steel Bar', ['#3c3c3c', '#d6d6d6', '#7c7c7c', '#ffffff', '#4a4a4a']],
  ['Brass', ['#5c4a12', '#e2cf6e', '#8e7426', '#f8eeb4', '#6a5416']],
  ['Rose Gold', ['#7a4034', '#f5c7b8', '#b77464', '#ffe6dc', '#8a4c3e']]];
CMD.reg('gradient.presets.legacy', {i18n:'', params:'{} 追加 PS「旧版渐变」的金属组（Legacy Metals：Gold／Silver／Copper／Chrome／Steel Bar／Brass／Rose Gold）；已有就不重复 → {ok, group}'}, () => {
  const name = 'Legacy Metals';
  if (!GP.groups.some(g => g.name === name)) GP.groups.push({name, items:LEGACY_METALS.map(([n, c]) => presetNew(n, c))});
  refreshOptions(); return {ok:true, group:name};
});

/* 像素层的选项（state.rs 预设）与手势 */
const RO = {style:'linear', reverse:false, dither:true, opacity:100, mode:'normal'};
const RG = {drag:null};                                   // canvas.rs Drag：{start, end}
/* stroke_constraint.rs:53 snap45 */
function snap45(o, p){
  const dx = p[0] - o[0], dy = p[1] - o[1];
  if (!(isFinite(dx) && isFinite(dy)) || Math.hypot(dx, dy) < 1e-9) return p.slice();
  const step = Math.PI / 4, a = Math.round(Math.atan2(dy, dx) / step) * step, d = [Math.cos(a), Math.sin(a)];
  const t = dx * d[0] + dy * d[1];
  return [o[0] + d[0] * t, o[1] + d[1] * t];
}
const isFgToBg = () => GP.current.name === 'Foreground to Background' && JSON.stringify(GP.current.stops) === JSON.stringify([[0, 'foreground'], [1, 'background']]) && !(GP.current.opacity || []).length;
function rasterParams(from, to){
  const p = {from:from.slice(), to:to.slice(), style:RO.style, reverse:RO.reverse, dither:RO.dither, opacity:RO.opacity};
  if (RO.mode !== 'normal') p.mode = RO.mode;
  if (isFgToBg()) p.colors = [fgHex(), bgHex()];         // canvas.rs:2212 经典渐变送 [前景, 背景]；选了别的预设（我们加的）就交给目前渐变
  return p;
}
const R = {
  down(pt){ RG.drag = {start:pt.slice(), end:pt.slice()}; },
  move(pt, shift){ if (RG.drag) RG.drag.end = shift ? snap45(RG.drag.start, pt) : pt.slice(); },   // canvas.rs:1956-1958
  up(pt, shift){
    const d = RG.drag; if (!d) return null;
    this.move(pt, shift); RG.drag = null;
    if (Math.abs(d.end[0] - d.start[0]) + Math.abs(d.end[1] - d.start[1]) < 2) return null;           // canvas.rs:2206
    return CMD.run('gradient.paint', rasterParams(d.start, d.end));
  },
  draw(ctx, s){                                           // canvas.rs:1906-1913
    const d = RG.drag; if (!d) return;
    const dpr = s / zoomOf(), a = [d.start[0] * s, d.start[1] * s], b = [d.end[0] * s, d.end[1] * s];
    ctx.save(); ctx.setLineDash([]); ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3 * dpr; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 * dpr; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.fillStyle = '#fff';
    for (const q of [a, b]){ ctx.beginPath(); ctx.arc(q[0], q[1], 3 * dpr, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
};

/* ═══════════════════════════════════════════════════════════════════════
   B. 矢量层：VectorCraft 渐变工具＋批注器
   ═══════════════════════════════════════════════════════════════════════ */

/* color/src/gradient.rs Gradient::default：Illustrator 预设「白、黑」 */
const defaultStops = () => [{offset:0, color:'#ffffff', opacity:1, midpoint:0.5}, {offset:1, color:'#000000', opacity:1, midpoint:0.5}];
const normColor = c => {
  if (Array.isArray(c) && c.length >= 3) return toHex(c.map(v => +v || 0));            // color_json 的 [r,g,b] 0..1
  const h = parseHex(c); return h ? toHex(h) : null;
};
const cloneStops = st => st.map(s => Object.assign({}, s));

/* 仿射（kurbo Affine 系数 [m0,m1,m2,m3,m4,m5]：x' = m0·x + m2·y + m4，y' = m1·x + m3·y + m5） */
const aff = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
function affInv(m){
  const det = m[0] * m[3] - m[1] * m[2]; if (Math.abs(det) < 1e-300) return null;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

const GF = window.GradientFill = {
  isGrad(p){ return !!p && typeof p === 'object' && (p.type === 'linear' || p.type === 'radial') && Array.isArray(p.stops); },
  /* 色标整理：排序（同 offset 保原序）、补缺省 */
  stops(p){
    const st = ((p && p.stops) || []).map((s, i) => ({
      offset:clamp(+s.offset || 0, 0, 1), color:normColor(s.color) || '#000000',
      opacity:fin(+s.opacity) && s.opacity !== null && s.opacity !== '' ? clamp(+s.opacity, 0, 1) : 1,
      midpoint:fin(+s.midpoint) && s.midpoint !== null && s.midpoint !== '' ? clamp(+s.midpoint, 0.13, 0.87) : 0.5, _i:i}));
    st.sort((a, b) => (a.offset - b.offset) || (a._i - b._i));
    st.forEach(s => { delete s._i; });
    return st;
  },
  /* gradient.rs:94 sample_with：t 处的 [r,g,b,不透明度]（经中点映射：u=mid → 0.5） */
  sample(stops, t){
    if (!stops.length) return [0, 0, 0, 1];
    const rgb = s => parseHex(s.color) || [0, 0, 0];
    if (t <= stops[0].offset){ const c = rgb(stops[0]); return [c[0], c[1], c[2], stops[0].opacity]; }
    for (let i = 0; i + 1 < stops.length; i++){
      const a = stops[i], b = stops[i + 1];
      if (t <= b.offset){
        const span = Math.max(b.offset - a.offset, 1e-6), u = (t - a.offset) / span;
        const m = clamp(a.midpoint === undefined ? 0.5 : a.midpoint, 0.01, 0.99);
        const v = u < m ? 0.5 * u / m : 0.5 + 0.5 * (u - m) / (1 - m);
        const ca = rgb(a), cb = rgb(b);
        return [ca[0] + (cb[0] - ca[0]) * v, ca[1] + (cb[1] - ca[1]) * v, ca[2] + (cb[2] - ca[2]) * v, a.opacity + (b.opacity - a.opacity) * v];
      }
    }
    const l = stops[stops.length - 1], c = rgb(l); return [c[0], c[1], c[2], l.opacity];
  },
  /* gradient.rs:124 expanded：中点≠0.5 时补一个色标（中点两侧都是线性，所以补一个就分毫不差）→ [[t, r,g,b,a]…] */
  expanded(stops){
    const out = [];
    stops.forEach((s, i) => {
      const c = parseHex(s.color) || [0, 0, 0];
      out.push([s.offset, c[0], c[1], c[2], s.opacity]);
      const n = stops[i + 1], m = s.midpoint === undefined ? 0.5 : s.midpoint;
      if (n && Math.abs(m - 0.5) > 1e-3){ const t = s.offset + (n.offset - s.offset) * m; out.push([t].concat(GF.sample(stops, t))); }
    });
    return out;
  },
  /* 资料 → 几何（加 ox/oy 就成文件坐标）：{start, end, aspect, focal} */
  geom(p, ox, oy){
    ox = ox || 0; oy = oy || 0;
    const start = [(+p.x1 || 0) + ox, (+p.y1 || 0) + oy];
    let end;
    if (fin(+p.x2) && fin(+p.y2) && p.x2 !== null && p.y2 !== null) end = [+p.x2 + ox, +p.y2 + oy];
    else end = [start[0] + (fin(+p.r) ? +p.r : 0), start[1]];                     // 只给 r 的径向：向量朝右
    const aspect = (p.type === 'radial' && fin(+p.aspect) && +p.aspect > 0) ? +p.aspect : 1;
    const focal = (p.type === 'radial' && fin(+p.fx) && fin(+p.fy) && p.fx !== null && p.fy !== null) ? [+p.fx + ox, +p.fy + oy] : null;
    return {start, end, aspect, focal};
  },
  /* 几何（减 ox/oy 成图层坐标）＋色标 → 资料 */
  write(kind, stops, g, ox, oy){
    ox = ox || 0; oy = oy || 0;
    const o = {type:kind === 'radial' ? 'radial' : 'linear',
      stops:stops.map(s => { const r = {offset:s.offset, color:s.color, opacity:s.opacity}; if (Math.abs((s.midpoint === undefined ? 0.5 : s.midpoint) - 0.5) > 1e-9) r.midpoint = s.midpoint; return r; }),
      x1:g.start[0] - ox, y1:g.start[1] - oy, x2:g.end[0] - ox, y2:g.end[1] - oy};
    if (o.type === 'radial'){
      o.r = dist(g.start, g.end);
      if (Math.abs(g.aspect - 1) > 1e-12) o.aspect = g.aspect;
      if (g.focal){ o.fx = g.focal[0] - ox; o.fy = g.focal[1] - oy; }
    }
    return o;
  },
  /* GradientGeom::unit_frame：单位圆 → 椭圆（(1,0)→终点、(0,1)→垂直那轴×aspect） */
  unitFrame(g){
    const u = sub(g.end, g.start);
    return (dot(u, u) * Math.abs(g.aspect) > 1e-18) ? [u[0], u[1], -u[1] * g.aspect, u[0] * g.aspect, g.start[0], g.start[1]] : null;
  },
  /* set_focal：拉回椭圆内（0.99）；在圆心＝没有焦点 */
  setFocal(g, f){
    if (!f){ g.focal = null; return g; }
    const m = GF.unitFrame(g), mi = m && affInv(m); if (!mi){ g.focal = null; return g; }
    const q = aff(mi, f), r = hyp(q);
    g.focal = r > 1e-6 ? (r > 0.99 ? aff(m, mul(q, 0.99 / r)) : f.slice()) : null;
    return g;
  },
  /* keep_focal_from：改了向量／长宽比后，焦点留在椭圆里的同一相对位置 */
  keepFocalFrom(g, before){
    const mb = before && before.focal && GF.unitFrame(before), mbi = mb && affInv(mb);
    const rel = mbi ? aff(mbi, before.focal) : null;
    g.focal = null;
    const m = GF.unitFrame(g);
    if (rel && m) GF.setFocal(g, aff(m, rel));
    return g;
  },
  /* GradientGeom::param_at（给 agent／测试量用；文件或图层坐标皆可，跟 g 同一套） */
  paramAt(kind, g, p){
    const u = sub(g.end, g.start); if (dot(u, u) < 1e-18) return 0;
    if (kind !== 'radial') return dot(sub(p, g.start), u) / dot(u, u);
    const m = GF.unitFrame(g), mi = m && affInv(m); if (!mi) return 0;
    const q = aff(mi, p); if (!g.focal) return hyp(q);
    const f = aff(mi, g.focal), d = sub(q, f), a = dot(f, f) - 1;
    if (Math.abs(a) < 1e-12) return hyp(q);
    const b = dot(d, f);
    return (-b - Math.sqrt(Math.max(b * b - a * dot(d, d), 0))) / a;
  },
  rgba(c){ return `rgba(${Math.round(clamp(c[0], 0, 1) * 255)},${Math.round(clamp(c[1], 0, 1) * 255)},${Math.round(clamp(c[2], 0, 1) * 255)},${+clamp(c[3], 0, 1).toFixed(4)})`; },
  /* 🔴 给 engine.js drawShape 用：shape 的 fill（或 stroke）是渐变物件 ⇒ 回 CanvasGradient（椭圆径向回 CanvasPattern）；
     ctx＝正在画这层的画布（已 translate 过 L.x·scale）；scale＝drawShape 的 S（坐标都乘它）。不是渐变就原样回字串。 */
  toCanvas(ctx, shape, scale, which){
    const S = fin(scale) ? scale : 1;
    const p = (which && typeof which === 'object') ? which : shape[which === 'stroke' ? 'stroke' : 'fill'];
    if (!GF.isGrad(p)) return typeof p === 'string' ? p : 'rgba(0,0,0,0)';
    const st = GF.stops(p), ex = GF.expanded(st), g = GF.geom(p);
    if (!st.length) return 'rgba(0,0,0,0)';
    const len = dist(g.start, g.end);
    if (len < 1e-9) return GF.rgba(GF.sample(st, 0));                        // param_at＝0 ⇒ 全是第一个色标
    const addStops = gr => { ex.forEach(e => gr.addColorStop(clamp(e[0], 0, 1), GF.rgba(e.slice(1)))); return gr; };
    if (p.type === 'radial'){
      if (Math.abs(g.aspect - 1) > 1e-9) return GF._ellipse(ctx, g, S, addStops);
      const f = g.focal || g.start;
      return addStops(ctx.createRadialGradient(f[0] * S, f[1] * S, 0, g.start[0] * S, g.start[1] * S, len * S));
    }
    return addStops(ctx.createLinearGradient(g.start[0] * S, g.start[1] * S, g.end[0] * S, g.end[1] * S));
  },
  /* 椭圆径向：在跟目标画布同尺寸的离屏上，用单位圆框架（unit_frame）画一张，转成图样、图样矩阵＝当前变换的反矩阵 ⇒ 填色与描边都对得上 */
  _ellipse(ctx, g, S, addStops){
    const T = ctx.getTransform(), cv = ctx.canvas;
    const c = document.createElement('canvas'); c.width = Math.max(1, cv.width); c.height = Math.max(1, cv.height);
    const x = c.getContext('2d');
    x.setTransform(T);
    const m = GF.unitFrame(g), mi = affInv(m);
    x.transform(m[0] * S, m[1] * S, m[2] * S, m[3] * S, m[4] * S, m[5] * S);
    const fq = g.focal && mi ? aff(mi, g.focal) : [0, 0];
    x.fillStyle = addStops(x.createRadialGradient(fq[0], fq[1], 0, 0, 0, 1));
    x.fillRect(-1e4, -1e4, 2e4, 2e4);
    const pat = ctx.createPattern(c, 'no-repeat');
    pat.setTransform(T.inverse());
    return pat;
  },
  /* 给 engine.js shiftShape 与别的工具：整个渐变平移（就地） */
  shift(p, dx, dy){
    if (!GF.isGrad(p) || (!dx && !dy)) return p;
    ['x1', 'x2', 'fx'].forEach(k => { if (fin(p[k])) p[k] += dx; });
    ['y1', 'y2', 'fy'].forEach(k => { if (fin(p[k])) p[k] += dy; });
    return p;
  },
  /* GradientGeom::transform（gradient.rs:304-345）：给旋转／比例缩放工具套仿射 m=[a,b,c,d,e,f]（就地，图层坐标） */
  transform(p, m){
    if (!GF.isGrad(p)) return p;
    const g = GF.geom(p), kind = p.type;
    g.focal = g.focal ? aff(m, g.focal) : null;
    const lin = v => [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]], perp = v => [-v[1], v[0]];
    const start = aff(m, g.start), u = sub(g.end, g.start);
    if (dot(u, u) < 1e-18){ g.start = start; g.end = start.slice(); }
    else if (kind !== 'radial'){
      const far = aff(m, g.end), nrm = perp(lin(perp(u)));
      g.start = start; g.end = dot(nrm, nrm) > 1e-18 ? add(start, mul(nrm, dot(sub(far, start), nrm) / dot(nrm, nrm))) : far;
    } else {
      const lu = lin(u), lw = lin(mul(perp(u), g.aspect));
      const P = lu[0] * lu[0] + lw[0] * lw[0], Q = lu[1] * lu[1] + lw[1] * lw[1], Rr = lu[0] * lu[1] + lw[0] * lw[1];
      const disc = Math.sqrt((P - Q) ** 2 + 4 * Rr * Rr);
      const s1 = Math.sqrt(Math.max((P + Q + disc) / 2, 0)), s2 = Math.sqrt(Math.max((P + Q - disc) / 2, 0));
      let axis, len, other;
      if (disc <= 1e-12 * (P + Q)){ axis = mul(lu, 1 / Math.max(hyp(lu), 1e-300)); len = s1; other = s2; }
      else {
        const th = 0.5 * Math.atan2(2 * Rr, P - Q), e1 = [Math.cos(th), Math.sin(th)], e2 = perp(e1);
        if (Math.abs(dot(e1, lu)) >= Math.abs(dot(e2, lu))){ axis = e1; len = s1; other = s2; } else { axis = e2; len = s2; other = s1; }
      }
      if (dot(axis, lu) < 0) axis = mul(axis, -1);
      g.start = start; g.end = add(start, mul(axis, len)); g.aspect = len > 1e-12 ? other / len : 1;
    }
    const o = GF.write(kind, GF.stops(p), g);
    Object.keys(p).forEach(k => { delete p[k]; }); Object.assign(p, o);
    return p;
  },
  /* 给 engine.js Project.toSVG：一个 <linearGradient>/<radialGradient>（userSpaceOnUse，图层坐标；径向用单位圆＋gradientTransform 表达长宽比与焦点） */
  toSVG(p, id){
    if (!GF.isGrad(p)) return '';
    const f = v => +(+v).toFixed(4), st = GF.stops(p), g = GF.geom(p);
    const stops = GF.expanded(st).map(e => `<stop offset="${f(clamp(e[0], 0, 1))}" stop-color="${toHex(e.slice(1))}" stop-opacity="${f(e[4])}"/>`).join('');
    if (p.type === 'radial'){
      const m = GF.unitFrame(g) || [1, 0, 0, 1, g.start[0], g.start[1]], mi = affInv(m);
      const fq = g.focal && mi ? aff(mi, g.focal) : [0, 0];
      return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" fx="${f(fq[0])}" fy="${f(fq[1])}" gradientTransform="matrix(${m.map(f).join(' ')})">${stops}</radialGradient>`;
    }
    return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(g.start[0])}" y1="${f(g.start[1])}" x2="${f(g.end[0])}" y2="${f(g.end[1])}">${stops}</linearGradient>`;
  }
};

/* ── 色标编辑（color/src/gradient.rs 171-258；批注器、浮窗与 agent 共用）── */
const MIN_STOPS = 2;
function placeStop(arr, s){ let i = arr.findIndex(o => o.offset > s.offset); if (i < 0) i = arr.length; arr.splice(i, 0, s); return i; }
function insertStop(stops, offset){
  offset = clamp(offset, 0, 1);
  const c = GF.sample(stops, offset), v = cloneStops(stops);
  const i = placeStop(v, {offset, color:toHex(c), opacity:c[3], midpoint:0.5});
  return [v, i];
}
const removeStop = (stops, i) => (stops.length <= MIN_STOPS || i >= stops.length) ? null : cloneStops(stops).filter((_, k) => k !== i);
function moveStop(stops, i, offset){
  const v = cloneStops(stops); if (i >= v.length) return [v, i];
  const [s] = v.splice(i, 1); s.offset = clamp(offset, 0, 1);
  return [v, placeStop(v, s)];
}
function duplicateStop(stops, i, offset){
  const v = cloneStops(stops); if (!v[i]) return [v, i];
  return [v, placeStop(v, Object.assign({}, v[i], {offset:clamp(offset, 0, 1)}))];
}
function setMidpoint(stops, i, m){ const v = cloneStops(stops); if (v[i]) v[i].midpoint = clamp(m, 0.13, 0.87); return v; }
function midpointPos(stops, i){ const a = stops[i], b = stops[i + 1]; return (a && b) ? a.offset + (b.offset - a.offset) * a.midpoint : null; }
function midpointFromPos(stops, i, pos){ const a = stops[i], b = stops[i + 1]; if (!(a && b)) return null; return clamp((pos - a.offset) / Math.max(b.offset - a.offset, 1e-6), 0.13, 0.87); }
/* engine cmd/gradient.rs:144 parse_stops：≥2 个；offset 必填（夹 0..1）；color 合法；opacity >1 当百分比；midpoint 夹 .13..87；按 offset 排 */
function parseStops(v){
  if (!Array.isArray(v)) throw new Error('`stops` must be an array');
  if (v.length < 2) throw new Error('a gradient needs at least two stops');
  const out = v.map((st, i) => {
    if (!st || typeof st !== 'object') throw new Error(`stop ${i} must be an object`);
    const num = k => { if (st[k] === undefined || st[k] === null) return null; if (!fin(+st[k]) || typeof st[k] === 'boolean') throw new Error(`stop ${i}: \`${k}\` must be a number`); return +st[k]; };
    const off = num('offset'); if (off === null) throw new Error(`stop ${i} needs \`offset\``);
    const color = normColor(st.color); if (!color) throw new Error(`stop ${i} needs a valid \`color\``);
    let op = num('opacity'); op = op === null ? 1 : (op > 1 ? op / 100 : op);
    const mid = num('midpoint');
    return {offset:clamp(off, 0, 1), color, opacity:clamp(op, 0, 1), midpoint:clamp(mid === null ? 0.5 : mid, 0.13, 0.87), _i:i};
  });
  out.sort((a, b) => (a.offset - b.offset) || (a._i - b._i)); out.forEach(s => { delete s._i; });
  return out;
}
const stopsJSON = st => st.map(s => ({offset:s.offset, color:s.color, opacity:s.opacity, midpoint:s.midpoint}));

/* ── 几何：形状外框（文件坐标）、命中 ── */
function cubicExtent(p0, c1, c2, p3, box){
  for (const q of [p0, p3]){ box[0] = Math.min(box[0], q[0]); box[1] = Math.min(box[1], q[1]); box[2] = Math.max(box[2], q[0]); box[3] = Math.max(box[3], q[1]); }
  for (let ax = 0; ax < 2; ax++){
    const A = p3[ax] - 3 * c2[ax] + 3 * c1[ax] - p0[ax], B = 2 * (c2[ax] - 2 * c1[ax] + p0[ax]), C = c1[ax] - p0[ax];
    const ts = [];
    if (Math.abs(A) < 1e-12){ if (Math.abs(B) > 1e-12) ts.push(-C / B); }
    else { const D = B * B - 4 * A * C; if (D >= 0){ const r = Math.sqrt(D); ts.push((-B + r) / (2 * A), (-B - r) / (2 * A)); } }
    for (const t of ts) if (t > 0 && t < 1){
      const mt = 1 - t, v = mt * mt * mt * p0[ax] + 3 * mt * mt * t * c1[ax] + 3 * mt * t * t * c2[ax] + t * t * t * p3[ax];
      box[ax] = Math.min(box[ax], v); box[ax + 2] = Math.max(box[ax + 2], v);
    }
  }
}
/* node.geometric_bounds（图层坐标 + L.x/L.y ＝ 文件坐标）→ [x0,y0,x1,y1] 或 null */
function shapeBounds(L, s){
  const g = VecSel.asBezier(s); if (!g || !g.anchors || !g.anchors.length) return null;
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const A = g.anchors;
  if (A.length === 1) cubicExtent([A[0].x, A[0].y], [A[0].x, A[0].y], [A[0].x, A[0].y], [A[0].x, A[0].y], box);
  for (const c of VecSel.segments(g)) cubicExtent(c.p0, c.c1, c.c2, c.p3, box);
  return [box[0] + L.x, box[1] + L.y, box[2] + L.x, box[3] + L.y];
}
/* item_paint_bounds：填色＝几何外框；描边＝外扩半个描边宽（stroke_paint_bounds） */
function paintBounds(L, s, stroke){
  const b = shapeBounds(L, s); if (!b) return null;
  if (!stroke) return b;
  const h = (s.strokeWidth || 0) / 2; return [b[0] - h, b[1] - h, b[2] + h, b[3] + h];
}
/* GradientGeom::fit（gradient.rs:284）：线性＝过中心、按角度盖满外框；径向＝圆心在中心、半径＝长边一半 */
function fitGeom(kind, b, angleDeg){
  const c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], w = b[2] - b[0], h = b[3] - b[1];
  const a = angleDeg * Math.PI / 180, d = [Math.cos(a), -Math.sin(a)];
  if (kind === 'radial') return {start:c, end:add(c, mul(d, Math.max(w, h) / 2)), aspect:1, focal:null};
  const half = (w * Math.abs(d[0]) + h * Math.abs(d[1])) / 2;
  return {start:sub(c, mul(d, half)), end:add(c, mul(d, half)), aspect:1, focal:null};
}
const angleDeg = g => Math.atan2(-(g.end[1] - g.start[1]), g.end[0] - g.start[0]) * 180 / Math.PI;   // angle_deg（y 朝下，逆时针为正）
/* 形状的 Path2D（图层坐标），跟 engine bezierPath 同一套 */
function shapePath(s){
  const g = VecSel.asBezier(s); if (!g) return null;
  const p = new Path2D(); bezierPath(p, g, 1); return p;
}
let _hitCtx = null;
/* doc hit_test：最上层优先；有填色看内部、再看离路径（描边半宽＋容差）够不够近 */
function hitShape(L, pt, tol){
  if (!L || L.kind !== 'vector') return null;
  if (!_hitCtx) _hitCtx = document.createElement('canvas').getContext('2d');
  const p = [pt[0] - L.x, pt[1] - L.y], S = L.data.shapes;
  for (let i = S.length - 1; i >= 0; i--){
    const s = S[i], g = VecSel.asBezier(s); if (!g || !g.anchors || !g.anchors.length) continue;
    const path = shapePath(s);
    if (path && s.fill && s.fill !== 'none' && _hitCtx.isPointInPath(path, p[0], p[1])) return s;
    const n = VecSel.nearestOnShape(g, p), sw = (s.stroke && s.stroke !== 'none') ? (s.strokeWidth || 0) / 2 : 0;
    if (n && n.d <= tol + sw) return s;
  }
  return null;
}

/* ── 智能参考线（tools/src/guides.rs Targets::collect／snap_point）── 文件坐标 */
function snapTargets(){
  const t = {points:[], xs:[], ys:[]};
  const addRect = (r, kind) => {
    const c = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
    for (const p of [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]){ t.xs.push([p[0], p, kind]); t.ys.push([p[1], p, kind]); }
    t.points.push([c, 'center']); t.xs.push([c[0], c, 'center']); t.ys.push([c[1], c, 'center']);
  };
  addRect([0, 0, Doc.width, Doc.height], 'artboard');
  let budget = 20000;
  for (const L of Doc.layers){
    if (!L.visible || L.kind !== 'vector') continue;
    for (const s of L.data.shapes){
      if (budget <= 0) break;
      const g = VecSel.asBezier(s); if (!g || !g.anchors) continue;
      for (const a of g.anchors){ t.points.push([[a.x + L.x, a.y + L.y], 'anchor']); budget--; }
      const b = shapeBounds(L, s); if (b) addRect(b, 'path');
    }
  }
  return t;
}
function snapPoint(t, p, tol){
  let best = null;
  for (const [q, k] of t.points){ const d = dist(q, p); if (d <= tol && (!best || d < best.d)) best = {q, k, d}; }
  if (best) return {p:best.q.slice(), guides:[{label:best.k, at:best.q.slice()}]};
  const out = p.slice(), guides = [];
  let bx = null; for (const e of t.xs){ const d = Math.abs(e[0] - p[0]); if (d <= tol && (!bx || d < bx.d)) bx = {e, d}; }
  if (bx){ out[0] = bx.e[0]; guides.push({line:[bx.e[1], [bx.e[0], p[1]]]}); }
  let by = null; for (const e of t.ys){ const d = Math.abs(e[0] - p[1]); if (d <= tol && (!by || d < by.d)) by = {e, d}; }
  if (by){ out[1] = by.e[0]; guides.push({line:[by.e[1], [p[0], by.e[0]]]}); }
  if (guides.length) guides.push({label:'align', at:out.slice()});
  return {p:out, guides};
}
/* geom/src/lib.rs:53 constrain_angle_from */
function constrainAngleFrom(v, stepDeg, baseDeg){
  const len = hyp(v); if (len < 1e-9) return v.slice();
  const step = stepDeg * Math.PI / 180, base = -baseDeg * Math.PI / 180;
  const a = base + Math.round((Math.atan2(v[1], v[0]) - base) / step) * step;
  return [Math.cos(a) * len, Math.sin(a) * len];
}

/* ── 工具状态 ── */
const GV = {smartGuides:true, constrainAngle:0};          // View › Smart Guides（Illustrator 出厂开）、偏好设置的「限制角度」
const VG = {gesture:null, guides:[], selStop:null, preview:null, last:null, popover:null};

/* ToolContext：现在这层、选中的形状（选取顺序）、作用中的代理（填色／描边）、tol(px)＝萤幕像素换文件单位 */
function vcx(){
  const L = Doc.active(); if (!L || L.kind !== 'vector') return null;
  VecSel.prune();
  const ids = VecSel.layerId === L.id ? VecSel.shapes : [];
  const sel = ids.map(id => L.data.shapes.find(s => s.id === id)).filter(Boolean);
  return {L, sel, stroke:!!(window.Toolbar && Toolbar.activeSwatch === 'stroke'), tol:px => px / zoomOf()};
}
const paintKey = stroke => stroke ? 'stroke' : 'fill';

/* ── 批注器（xform/gradient.rs Annotator）：文件坐标 ── */
const HANDLE = 5, ROTATE = 14, STOP_GAP = 10, STOP_HIT = 6, MID_GAP = 7, MID_HIT = 5, BAR_HIT = 4, FOCAL_HIT = 3, CENTRE = 4.5, CENTRE_HIT = 8, OFF_BAR = 24, DRAG_START = 3;
const NUDGE = 0.01, NUDGE_BIG = 0.1;
function annotatorOf(cx){
  if (!cx) return null;
  for (const s of cx.sel){
    const p = s[paintKey(cx.stroke)];
    if (GF.isGrad(p)) return {shape:s, kind:p.type, geom:GF.geom(p, cx.L.x, cx.L.y), stops:GF.stops(p)};
  }
  return null;
}
const Ann = {
  vector: a => sub(a.geom.end, a.geom.start),
  at: (a, t) => add(a.geom.start, mul(Ann.vector(a), t)),
  normal(a){ const v = Ann.vector(a), l = hyp(v); return l < 1e-12 ? [0, 1] : [-v[1] / l, v[0] / l]; },
  stopPoint(cx, a, i){ const s = a.stops[i]; return s ? add(Ann.at(a, s.offset), mul(Ann.normal(a), cx.tol(STOP_GAP))) : null; },
  midPoint(cx, a, i){ const m = midpointPos(a.stops, i); return m === null ? null : sub(Ann.at(a, m), mul(Ann.normal(a), cx.tol(MID_GAP))); },
  project(a, p){ const v = Ann.vector(a), l2 = dot(v, v), d = sub(p, a.geom.start); return l2 < 1e-18 ? [0, hyp(d)] : [dot(d, v) / l2, dot(d, Ann.normal(a))]; },
  aspectPoint: a => sub(a.geom.start, mul(Ann.normal(a), hyp(Ann.vector(a)) * a.geom.aspect)),
  focalPoint: a => a.geom.focal || a.geom.start,
  offEllipse(a, p){ const m = GF.unitFrame(a.geom), mi = m && affInv(m); if (!mi) return null; const rho = hyp(aff(mi, p)); return rho > 1e-12 ? dist(p, a.geom.start) * Math.abs(1 - 1 / rho) : null; },
  /* 命中顺序：色标（后画的在上）→ 中点 → 终点 → 焦点（径向）→ 起点（径向用圆心环 8）→ 长宽比把手 → 终点外旋转 → 线条 → 椭圆上旋转 */
  hit(cx, a, p){
    const near = (q, r) => !!q && dist(q, p) <= cx.tol(r);
    const n = a.stops.length, radial = a.kind === 'radial';
    for (let i = n - 1; i >= 0; i--) if (near(Ann.stopPoint(cx, a, i), STOP_HIT)) return {part:'stop', i};
    for (let i = 0; i + 1 < n; i++) if (near(Ann.midPoint(cx, a, i), MID_HIT)) return {part:'mid', i};
    if (near(a.geom.end, HANDLE)) return {part:'end'};
    if (radial && near(Ann.focalPoint(a), FOCAL_HIT)) return {part:'focal'};
    if (near(a.geom.start, radial ? CENTRE_HIT : HANDLE)) return {part:'start'};
    if (radial && near(Ann.aspectPoint(a), HANDLE)) return {part:'aspect'};
    const [t, d] = Ann.project(a, p);
    if (t > 1 && near(a.geom.end, ROTATE)) return {part:'rotate'};
    if (hyp(Ann.vector(a)) > 1e-12 && t >= 0 && t <= 1 && d >= -cx.tol(BAR_HIT) && d <= cx.tol(STOP_GAP + STOP_HIT)) return {part:'bar', t};
    if (radial){ const e = Ann.offEllipse(a, p); if (e !== null && e <= cx.tol(BAR_HIT)) return {part:'rotate'}; }
    return null;
  }
};

/* 选中的色标（gradient.selectStop）：只在「同一份文件、同一层、第一个选中物件、同一个代理」时有效 */
const ownerOf = cx => cx ? {serial:Doc.serial, layerId:cx.L.id, shapeId:cx.sel.length ? cx.sel[0].id : null, stroke:cx.stroke} : null;
function selectedStop(cx){
  const s = VG.selStop; if (!s || !cx) return null;
  const o = ownerOf(cx);
  return (o.serial === s.owner.serial && o.layerId === s.owner.layerId && o.shapeId === s.owner.shapeId && o.stroke === s.owner.stroke) ? s.index : null;
}

/* ── 命令的本体（xform/gradient.rs 的 Action::Exec 都落到这里；拖曳预览直接叫本体、放开才 CMD.run 进历史）── */
function vLayer(p){
  const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  return (L && L.kind === 'vector') ? L : null;
}
function targetsOf(L, p){
  if (Array.isArray(p.ids)) return p.ids.map(id => L.data.shapes.find(s => s.id === id)).filter(Boolean);
  const ids = VecSel.layerId === L.id ? VecSel.shapes : [];
  return ids.map(id => L.data.shapes.find(s => s.id === id)).filter(Boolean);
}
const strokeParam = p => (typeof p.stroke === 'boolean') ? p.stroke : !!(window.Toolbar && Toolbar.activeSwatch === 'stroke');
/* cmd/gradient.rs:478 vector_paint：cur（原本的填色）＋编辑 e（文件坐标）→ 新的渐变资料；套不上回 null */
function vectorPaint(L, cur, e, bounds){
  const isG = GF.isGrad(cur);
  const kind = isG ? cur.type : 'linear', stops = isG ? GF.stops(cur) : defaultStops();
  const shown = isG ? GF.geom(cur, L.x, L.y) : (bounds ? fitGeom(kind, bounds, 0) : null);
  const vec = e.vector || (shown ? [shown.start, shown.end] : null);
  if (!vec) return null;
  const g = {start:vec[0].slice(), end:vec[1].slice(), aspect:e.aspect !== null ? e.aspect : (shown ? shown.aspect : 1), focal:null};
  if (kind === 'radial'){
    if (e.focal !== undefined) GF.setFocal(g, e.focal);
    else if (shown) GF.keepFocalFrom(g, shown);
  }
  return GF.write(kind, stops, g, L.x, L.y);
}
function setGeomBody(p){
  const C = 'gradient.setGeom';
  const L = vLayer(p); if (!L) return {ok:false, error:`${C}: not a vector layer`};
  const s0 = p.start !== undefined ? pt2(p.start) : null, e0 = p.end !== undefined ? pt2(p.end) : null;
  if ((p.start !== undefined && !s0) || (p.end !== undefined && !e0)) return {ok:false, error:`${C}: \`start\`/\`end\` must be [x, y]`};
  if (!!s0 !== !!e0) return {ok:false, error:`${C}: give both \`start\` and \`end\` [x, y] (or neither)`};
  let aspect = null;
  if (p.aspect !== undefined){ if (!fin(p.aspect)) return {ok:false, error:`${C}: \`aspect\` must be a number (%)`}; aspect = clamp(p.aspect / 100, 0.005, 327.67); }
  let focal;
  if (p.focal === null) focal = null;
  else if (p.focal !== undefined){ focal = pt2(p.focal); if (!focal) return {ok:false, error:`${C}: \`focal\` must be [x, y]`}; }
  const stroke = strokeParam(p), key = paintKey(stroke);
  const T = targetsOf(L, p);
  if (!T.length) return {ok:false, error:`${C}: nothing selected`};
  const e = {vector:s0 ? [s0, e0] : null, aspect, focal};
  for (const s of T){
    const np = vectorPaint(L, s[key], e, paintBounds(L, s, stroke));
    if (np){ s[key] = np; if (stroke && !(s.strokeWidth > 0)) s.strokeWidth = 1; }   // 描边设渐变但没有粗细⇒1（run_stroke_weight）
  }
  Layer.invalidate(L);
  return {ok:true, ids:T.map(s => s.id)};
}
/* cmd/gradient.rs:247 apply_gradient_edit_in */
function applyEdit(L, cur, p, bounds){
  const isG = GF.isGrad(cur);
  let kind = isG ? cur.type : 'linear', stops = isG ? GF.stops(cur) : defaultStops();
  let geom = isG ? GF.geom(cur, L.x, L.y) : null;
  let angle = geom ? angleDeg(geom) : 0;                 // gp.angle（放好的渐变＝向量的角度）
  if (typeof p.kind === 'string'){
    const k = p.kind.toLowerCase();
    if (k !== 'linear' && k !== 'radial') throw new Error(`unknown gradient kind \`${p.kind}\` (linear, radial)`);
    if (k !== kind){ kind = k; geom = null; }             // 换种类＝重新贴合外框
  }
  if (p.stops !== undefined) stops = parseStops(p.stops);
  if (p.reverse === true){                                // Gradient::reverse ＋ 中点镜像
    const n = stops.length, mids = stops.map(s => s.midpoint);
    stops = stops.slice().reverse().map(s => Object.assign({}, s, {offset:1 - s.offset}));
    stops.forEach((s, i) => { s.midpoint = i + 1 < n ? 1 - mids[n - 2 - i] : 0.5; });
  }
  if (!geom){ if (!bounds) return null; geom = fitGeom(kind, bounds, angle); }   // 没放过的渐变＝贴合外框（resolve）
  const before = {start:geom.start.slice(), end:geom.end.slice(), aspect:geom.aspect, focal:geom.focal ? geom.focal.slice() : null};
  if (p.angle !== undefined){
    if (!fin(p.angle)) throw new Error('`angle` must be a number (degrees)');
    const a = (((p.angle + 180) % 360) + 360) % 360 - 180, r = a * Math.PI / 180, dir = [Math.cos(r), -Math.sin(r)];
    const len = dist(geom.start, geom.end);
    if (kind === 'radial') geom.end = add(geom.start, mul(dir, len));
    else { const c = mul(add(geom.start, geom.end), 0.5); geom.start = sub(c, mul(dir, len / 2)); geom.end = add(c, mul(dir, len / 2)); }
  }
  if (p.aspect !== undefined){
    if (!fin(p.aspect)) throw new Error('`aspect` must be a number (%)');
    geom.aspect = clamp(p.aspect / 100, 0.005, 327.67);
  }
  if (kind === 'radial') GF.keepFocalFrom(geom, before); else geom.focal = null;
  return GF.write(kind, stops, geom, L.x, L.y);
}
function editBody(p){
  const C = 'gradient.edit';
  const L = vLayer(p); if (!L) return {ok:false, error:`${C}: not a vector layer`};
  const stroke = strokeParam(p), key = paintKey(stroke);
  const T = targetsOf(L, p);
  if (!T.length) return {ok:false, error:`${C}: nothing selected`};
  try {
    const out = T.map(s => applyEdit(L, s[key], p, paintBounds(L, s, stroke)));        // 先全部算好、再一起写（参数错就整条不动）
    T.forEach((s, i) => { if (out[i]){ s[key] = out[i]; if (stroke && !(s.strokeWidth > 0)) s.strokeWidth = 1; } });
  } catch (e){ return {ok:false, error:`${C}: ${e.message}`}; }
  Layer.invalidate(L);
  return {ok:true, ids:T.map(s => s.id)};
}

CMD.reg('gradient.setGeom', {i18n:'', undoable:true,
  params:'{start?:[x,y], end?:[x,y]（文件坐标；两个都给或都不给＝向量不动）, aspect?:%（径向：椭圆垂直轴／半径；缺省保留）, focal?:[x,y] 文件坐标 | null（径向焦点，拉回椭圆内；null＝回圆心；缺省＝留在椭圆里同一相对位置）, ids?:[shapeId…]（缺省＝选中的形状）, stroke?:bool（缺省＝工具栏作用中的是描边色块）, layerId?} 同 VectorCraft paint.setGradientGeom：设渐变向量（实色先变成预设「白→黑」线性渐变）→ {ok, ids}'},
  setGeomBody);
CMD.reg('gradient.edit', {i18n:'', undoable:true,
  params:'{kind?:"linear"|"radial"（换种类＝重新贴合外框）, stops?:[{offset 0..1, color "#rrggbb", opacity? 0..1（>1 当 %）, midpoint? 0.13..0.87}]（≥2）, reverse?:true（色标倒过来、中点镜像）, angle?:度, aspect?:%（径向）, ids?, stroke?:bool, layerId?} 同 VectorCraft paint.editGradient：就地改渐变（保留位置）；实色变成预设「白→黑」并贴合外框 → {ok, ids}'},
  editBody);
CMD.reg('gradient.selectStop', {i18n:'',
  params:'{index:色标索引（0＝起点那个）| null 清掉} 选第一个选中形状的渐变（作用中的代理）的一个色标：批注器、浮窗、Delete／←→ 都作用在它 → {ok, index}'}, p => {
  const C = 'gradient.selectStop';
  if (!('index' in p)) return {ok:false, error:`${C}: missing \`index\` (a stop index, or null to clear)`};
  const cx = vcx();
  if (p.index === null){ VG.selStop = null; return {ok:true, index:null}; }
  if (!Number.isInteger(p.index) || p.index < 0) return {ok:false, error:`${C}: \`index\` must be a whole number or null`};
  const first = cx && cx.sel[0], g = first && first[paintKey(cx.stroke)];
  if (!GF.isGrad(g)) return {ok:false, error:`${C}: the active paint is not a gradient`};
  const n = g.stops.length;
  if (p.index >= n) return {ok:false, error:`${C}: no stop ${p.index} (the gradient has ${n})`};
  VG.selStop = {index:p.index, owner:ownerOf(cx)};
  return {ok:true, index:p.index};
});
CMD.reg('gradient.select', {i18n:'', params:'{ids:[shapeId…], layerId?} 整条选这些形状、其余清掉（照 select.set；渐变工具在没选东西时按下＝选滑鼠下那个）'}, p => {
  const L = vLayer(p); if (!L) return {ok:false, error:'gradient.select: not a vector layer'};
  VecSel.setShapes(L.id, (p.ids || []).filter(id => L.data.shapes.some(s => s.id === id)));
  return {ok:true, ids:VecSel.shapes.slice()};
});
/* dialogs/gradient_stop.rs:176 apply／212 confirm：一次改完、一步历史 */
CMD.reg('gradient.stopEdit', {i18n:'', undoable:true,
  params:'{index?（缺省＝选中的色标）, color?:"#rrggbb", opacity?:0..100 %, location?:0..100 %} 同双击色标的浮窗按确定：改颜色／不透明度／位置（位置改了色标会重排，选中跟着它）→ {ok, index}'}, p => {
  const C = 'gradient.stopEdit', cx = vcx();
  const a = annotatorOf(cx);
  let i = fin(p.index) ? p.index | 0 : selectedStop(cx);
  if (!a || i === null || i === undefined || i < 0 || i >= a.stops.length) return {ok:false, error:`${C}: no gradient stop is selected`};
  let stops = cloneStops(a.stops);
  if (p.color !== undefined){ const c = typeof p.color === 'string' && /^#?[0-9a-f]{6}$/i.test(p.color.trim()) ? normColor(p.color.trim().replace(/^#?/, '#')) : null; if (!c) return {ok:false, error:`${C}: bad colour \`${p.color}\` (#rrggbb)`}; stops[i].color = c; }
  if (fin(p.opacity)) stops[i].opacity = clamp(p.opacity / 100, 0, 1);
  if (fin(p.location)) [stops, i] = moveStop(stops, i, p.location / 100);
  const r = editBody({stops:stopsJSON(stops), stroke:cx.stroke, ids:[a.shape.id]});
  if (r.ok === false) return r;
  VG.selStop = {index:i, owner:ownerOf(vcx())};
  return {ok:true, index:i};
});
CMD.reg('gradient.get', {i18n:'', params:'{id?（缺省＝第一个选中的有渐变的形状）, stroke?, layerId?} → {ok, id, paint:原始资料（图层坐标）, start, end, focal（文件坐标）, angle, selectedStop}'}, p => {
  const L = vLayer(p); if (!L) return {ok:false, error:'gradient.get: not a vector layer'};
  const stroke = strokeParam(p), key = paintKey(stroke);
  let s = p.id ? L.data.shapes.find(x => x.id === p.id) : targetsOf(L, {}).find(x => GF.isGrad(x[key]));
  if (!s || !GF.isGrad(s[key])) return {ok:false, error:'gradient.get: no gradient'};
  const g = GF.geom(s[key], L.x, L.y);
  return {ok:true, id:s.id, paint:JSON.parse(JSON.stringify(s[key])), start:g.start, end:g.end, aspect:g.aspect, focal:g.focal, angle:angleDeg(g), selectedStop:selectedStop(vcx())};
});

/* ── 手势（xform/gradient.rs press／drag／release／key／DoubleClick）── */
function beginPreview(cx){ VG.preview = {L:cx.L, snaps:cx.L.data.shapes.map(s => [s, VecSel.cloneShape(s)])}; }
function restorePreview(){
  const pv = VG.preview; if (!pv) return;
  for (const [s, snap] of pv.snaps) VecSel.restoreShape(s, snap);
  Layer.invalidate(pv.L);
}
function preview(cmd, params){                            // Action::Preview：在原样上套一次本体（不进历史）
  restorePreview();
  VG.last = {cmd, params};
  const fn = cmd === 'gradient.setGeom' ? setGeomBody : editBody;
  fn(params);
}
const geomParams = (cx, s, e) => ({start:s.slice(), end:e.slice(), stroke:cx.stroke});
const stopsParams = (cx, st) => ({stops:stopsJSON(st), stroke:cx.stroke});
const runSelectStop = i => { try { CMD.run('gradient.selectStop', {index:i}); } catch (e){} };

const V = {
  press(cx, p, m){
    const a = annotatorOf(cx), h = a ? Ann.hit(cx, a, p) : null;
    let grab;
    if (h){
      const geom = a.geom;
      if (h.part === 'stop'){ runSelectStop(h.i); grab = {k:'stop', index:h.i, from:a, copy:!!m.alt}; }
      else if (h.part === 'mid') grab = {k:'mid', index:h.i, from:a};
      else if (h.part === 'start') grab = {k:'move', geom, bar:null};
      else if (h.part === 'bar') grab = {k:'move', geom, bar:h.t};
      else if (h.part === 'end') grab = {k:'end', geom};
      else if (h.part === 'rotate'){ const v = Ann.vector(a), q = sub(p, geom.start); grab = {k:'rotate', geom, from:Math.atan2(q[1], q[0]) - Math.atan2(v[1], v[0])}; }
      else if (h.part === 'focal') grab = {k:'focal', geom};
      else if (h.part === 'aspect') grab = {k:'aspect', geom};
    } else {
      if (!cx.sel.length){                               // 什么都没选：按下＝选滑鼠下那个物件；空白处就什么都不做
        const s = hitShape(cx.L, p, cx.tol(3)); if (!s) return;
        CMD.run('gradient.select', {ids:[s.id]});
      }
      grab = {k:'art'};
    }
    const at = grab.k === 'art' ? snapDraw(cx, p).p : p.slice();   // 在物件上画的向量从吸附后的点起
    VG.gesture = {grab, at, began:false, vector:null, stop:undefined};
  },
  drag(cx, p, m){
    const g = VG.gesture; if (!g) return;
    if (!g.began){
      if (dist(p, g.at) < cx.tol(DRAG_START)) return;
      g.began = true; beginPreview(cx);                   // Action::Begin("Gradient")
    }
    const constrain = v => constrainAngleFrom(v, 45, GV.constrainAngle);
    let guides = [];
    const place = (from, to) => {
      if (m.shift) return add(from, constrain(sub(to, from)));
      const r = snapDraw(cx, to); guides = r.guides; return r.p;
    };
    const G = g.grab; let cmd, params;
    if (G.k === 'art'){ const end = place(g.at, p); g.vector = [g.at, end]; cmd = 'gradient.setGeom'; params = geomParams(cx, g.at, end); }
    else if (G.k === 'move'){ const st = place(G.geom.start, add(G.geom.start, sub(p, g.at))); cmd = 'gradient.setGeom'; params = geomParams(cx, st, add(st, sub(G.geom.end, G.geom.start))); }
    else if (G.k === 'end'){ cmd = 'gradient.setGeom'; params = geomParams(cx, G.geom.start, place(G.geom.start, p)); }
    else if (G.k === 'rotate'){
      const q = sub(p, G.geom.start), c = Math.cos(-G.from), sn = Math.sin(-G.from);
      let dir = [q[0] * c - q[1] * sn, q[0] * sn + q[1] * c];
      if (m.shift) dir = constrain(dir);
      const len = hyp(dir), L0 = dist(G.geom.start, G.geom.end);
      const end = len < 1e-12 ? G.geom.end : add(G.geom.start, mul(dir, L0 / len));
      cmd = 'gradient.setGeom'; params = geomParams(cx, G.geom.start, end);
    } else if (G.k === 'focal'){
      const f = add(G.geom.focal || G.geom.start, sub(p, g.at));
      cmd = 'gradient.setGeom'; params = geomParams(cx, G.geom.start, G.geom.end);
      params.focal = dist(f, G.geom.start) <= cx.tol(FOCAL_HIT) ? null : f;   // 拖回圆心＝置中
    } else if (G.k === 'aspect'){
      const across = Math.abs(Ann.project({geom:G.geom}, p)[1]);
      cmd = 'gradient.setGeom'; params = geomParams(cx, G.geom.start, G.geom.end);
      params.aspect = across / Math.max(dist(G.geom.start, G.geom.end), 1e-12) * 100;
    } else if (G.k === 'stop'){
      const [t0, d] = Ann.project(G.from, p), t = clamp(t0, 0, 1), st = G.from.stops;
      const removed = (!G.copy && Math.abs(d) > cx.tol(OFF_BAR)) ? removeStop(st, G.index) : null;
      let v, at;
      if (removed){ v = removed; at = null; }
      else [v, at] = G.copy ? duplicateStop(st, G.index, t) : moveStop(st, G.index, t);
      g.stop = at; cmd = 'gradient.edit'; params = stopsParams(cx, v);
    } else if (G.k === 'mid'){
      const st = G.from.stops, mm = midpointFromPos(st, G.index, clamp(Ann.project(G.from, p)[0], 0, 1));
      cmd = 'gradient.edit'; params = stopsParams(cx, setMidpoint(st, G.index, mm === null ? 0.5 : mm));
    }
    VG.guides = guides;
    if (cmd) preview(cmd, params);
  },
  release(cx, p){
    VG.guides = [];
    const g = VG.gesture; VG.gesture = null; if (!g) return;
    if (g.began){                                         // Action::Commit：拖曳的最后一个预览成为一步历史
      const last = VG.last; restorePreview(); VG.preview = null; VG.last = null;
      if (last) CMD.run(last.cmd, last.params);
      if (g.grab.k === 'stop'){
        if (g.stop !== undefined && g.stop !== null) runSelectStop(g.stop);
        else if (g.stop === null) runSelectStop(Math.min(g.grab.index, g.grab.from.stops.length - 2));   // 拖离删掉的：选补上那个位置的
      }
      return;
    }
    const cx2 = vcx(); if (!cx2) return;
    if (g.grab.k === 'move' && g.grab.bar !== null){      // 点线条＝在那里加色标（颜色取那一点的颜色），并选它
      const a = annotatorOf(cx2); if (!a) return;
      const [st, i] = insertStop(a.stops, g.grab.bar);
      CMD.run('gradient.edit', stopsParams(cx2, st)); runSelectStop(i);
      return;
    }
    if (g.grab.k === 'art'){                              // 点在选中的物件里＝从那一点套用渐变（向量沿用原本的，否则贴合外框的水平向量）
      const s = hitShape(cx2.L, p, cx2.tol(3)); if (!s || !cx2.sel.includes(s)) return;
      const cur = s[paintKey(cx2.stroke)];
      let v;
      if (GF.isGrad(cur)){ const gg = GF.geom(cur); v = sub(gg.end, gg.start); }
      else { const b = paintBounds(cx2.L, s, cx2.stroke); if (!b) return; const f = fitGeom('linear', b, 0); v = sub(f.end, f.start); }
      const params = geomParams(cx2, p, add(p, v)); params.ids = [s.id];
      CMD.run('gradient.setGeom', params);
    }
  },
  cancel(){                                               // Esc：取消正在拖的
    if (!VG.gesture) return false;
    const began = VG.gesture.began;
    VG.gesture = null; VG.guides = [];
    if (began){ restorePreview(); VG.preview = null; VG.last = null; }
    return began;
  },
  dblclick(cx, p){
    const a = annotatorOf(cx); if (!a) return;
    const h = Ann.hit(cx, a, p); if (!h || h.part !== 'stop') return;
    runSelectStop(h.i);
    Pop.open(h.i, Ann.stopPoint(cx, a, h.i) || p);
  },
  /* claims_key＋key：Delete／Backspace 删选中色标（剩两个就吃掉但不做事）、←→ 微移 */
  key(cx, e){
    if (!cx || (VG.gesture && VG.gesture.began)) return false;
    const k = e.key;
    if (!['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight'].includes(k)) return false;
    const a = annotatorOf(cx), i = selectedStop(cx);
    if (!a || i === null || i >= a.stops.length) return false;
    let v, sel;
    if (k === 'Delete' || k === 'Backspace'){
      v = removeStop(a.stops, i); if (!v) return true;
      sel = Math.min(i, v.length - 1);
    } else {
      const step = e.shiftKey ? NUDGE_BIG : NUDGE;
      [v, sel] = moveStop(a.stops, i, a.stops[i].offset + (k === 'ArrowLeft' ? -step : step));
    }
    CMD.run('gradient.edit', stopsParams(cx, v)); runSelectStop(sel);
    return true;
  },
  cursor(cx, p){
    const g = VG.gesture;
    if (g){ if (g.grab.k === 'stop' && g.stop === null) return 'not-allowed'; if (g.grab.k === 'rotate') return 'alias'; if (g.grab.k === 'art') return 'crosshair'; return 'move'; }
    const a = annotatorOf(cx), h = a ? Ann.hit(cx, a, p) : null;
    if (!h) return 'crosshair';
    return h.part === 'bar' ? 'copy' : h.part === 'rotate' ? 'alias' : 'move';
  }
};
function snapDraw(cx, p){ return GV.smartGuides ? snapPoint(snapTargets(), p, cx.tol(5)) : {p:p.slice(), guides:[]}; }

/* ── 双击色标的浮窗（dialogs/gradient_stop.rs）：颜色、不透明度 %、位置 %；Esc 或点别处关 ── */
const Pop = {
  open(i, chip){
    this.close();
    const d = document.createElement('div'); d.id = 'gradStopPop';
    const r = UI.canvas.getBoundingClientRect(), z = zoomOf();
    d.style.cssText = `position:fixed;left:${Math.round(r.left + chip[0] * z + 14)}px;top:${Math.round(r.top + chip[1] * z + 14)}px;z-index:50;background:#2a2d33;color:#e8eaed;border:1px solid #4a4f57;border-radius:4px;padding:8px 10px;font:12px sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4);display:flex;gap:8px;align-items:center`;
    const lab = (key, el) => { const l = document.createElement('label'); l.style.cssText = 'display:flex;gap:4px;align-items:center'; l.innerHTML = `<span>${Lang.t(key)}</span>`; l.appendChild(el); d.appendChild(l); };
    const col = document.createElement('input'); col.type = 'color'; col.dataset.pop = 'color';
    const op = document.createElement('input'); op.type = 'number'; op.min = 0; op.max = 100; op.style.width = '52px'; op.dataset.pop = 'opacity';
    const loc = document.createElement('input'); loc.type = 'number'; loc.min = 0; loc.max = 100; loc.step = 0.1; loc.style.width = '56px'; loc.dataset.pop = 'location';
    lab('ui.gradStopColor', col); lab('ui.gradStopOpacity', op); lab('ui.gradStopLocation', loc);
    const fill = () => {
      const cx = vcx(), a = annotatorOf(cx), k = selectedStop(cx);
      if (!a || k === null || !a.stops[k]){ this.close(); return; }      // 色标没了（undo、换选取）⇒ 关
      col.value = a.stops[k].color; op.value = Math.round(a.stops[k].opacity * 100); loc.value = +(a.stops[k].offset * 100).toFixed(1);
    };
    const run = p => { try { CMD.run('gradient.stopEdit', p); } catch (e){} fill(); UI.draw(); };
    col.oninput = () => run({color:col.value});
    op.onchange = () => run({opacity:+op.value});
    loc.onchange = () => run({location:+loc.value});
    d.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.stopPropagation(); this.close(); } });
    document.body.appendChild(d);
    this.el = d; fill();
    this._out = e => { if (this.el && !this.el.contains(e.target)) this.close(); };
    this._esc = e => { if (e.key === 'Escape') this.close(); };
    setTimeout(() => { document.addEventListener('pointerdown', this._out, true); document.addEventListener('keydown', this._esc, true); }, 0);
  },
  close(){
    if (this.el){ this.el.remove(); this.el = null; }
    if (this._out){ document.removeEventListener('pointerdown', this._out, true); this._out = null; }
    if (this._esc){ document.removeEventListener('keydown', this._esc, true); this._esc = null; }
  },
  el:null, _out:null, _esc:null
};

/* ── 叠画（xform/gradient.rs annotator_overlays；颜色 BAR #202020、LIGHT #f0f0f0）── */
const BAR = '#202020', LIGHT = '#f0f0f0', ACCENT = '#2f7fd8', MAGENTA = '#ff3dfc';
function drawVector(ctx, s){
  const cx = vcx(); if (!cx) return;
  const dpr = s / zoomOf(), P = q => [q[0] * s, q[1] * s];
  ctx.save(); ctx.setLineDash([]);
  // 选中物件的细框（选取回馈）
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 1;
  for (const sh of cx.sel){ const g = VecSel.asBezier(sh); if (!g) continue; ctx.save(); ctx.translate(cx.L.x * s, cx.L.y * s); ctx.beginPath(); bezierPath(ctx, g, s); ctx.stroke(); ctx.restore(); }
  let a = annotatorOf(cx);
  if (!a && VG.gesture && VG.gesture.vector) a = {kind:'linear', geom:{start:VG.gesture.vector[0], end:VG.gesture.vector[1], aspect:1, focal:null}, stops:defaultStops()};
  if (a){
    const st = P(a.geom.start), en = P(a.geom.end), selI = selectedStop(cx);
    const handle = (q, fill) => { ctx.beginPath(); ctx.arc(q[0], q[1], 3.5 * dpr, 0, Math.PI * 2); ctx.fillStyle = fill || '#fff'; ctx.fill(); ctx.strokeStyle = BAR; ctx.lineWidth = 1 * dpr; ctx.stroke(); };
    const m = a.kind === 'radial' ? GF.unitFrame(a.geom) : null;
    if (m){                                               // 径向：范围椭圆（亮实线＋暗虚线）、长宽比把手、圆心环
      ctx.beginPath();
      for (let i = 0; i <= 96; i++){ const t = i / 96 * Math.PI * 2, q = P(aff(m, [Math.cos(t), Math.sin(t)])); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
      ctx.lineWidth = 1 * dpr; ctx.strokeStyle = LIGHT; ctx.stroke();
      ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.strokeStyle = BAR; ctx.stroke(); ctx.setLineDash([]);
      handle(P(Ann.aspectPoint(a)));
      ctx.beginPath(); ctx.arc(st[0], st[1], CENTRE * dpr, 0, Math.PI * 2); ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = BAR; ctx.stroke();
    }
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = BAR; ctx.beginPath(); ctx.moveTo(st[0], st[1]); ctx.lineTo(en[0], en[1]); ctx.stroke();
    ctx.strokeStyle = LIGHT; ctx.beginPath(); ctx.moveTo(st[0], st[1] + dpr); ctx.lineTo(en[0], en[1] + dpr); ctx.stroke();
    handle(P(a.kind === 'radial' ? Ann.focalPoint(a) : a.geom.start));
    const r7 = 3.5 * dpr; ctx.fillStyle = BAR; ctx.fillRect(en[0] - r7, en[1] - r7, 2 * r7, 2 * r7);   // 终点：实心方块
    const len = hyp(Ann.vector(a));
    if (len > 1e-12){
      const r = cx.tol(4), v = Ann.vector(a), along = mul(v, r / len), across = mul(Ann.normal(a), r);
      for (let i = 0; i + 1 < a.stops.length; i++){        // 中点菱形
        const c = Ann.midPoint(cx, a, i); if (!c) continue;
        const pts = [sub(c, along), sub(c, across), add(c, along), add(c, across)].map(P);
        ctx.beginPath(); pts.forEach((q, k) => k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath();
        ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1 * dpr; ctx.strokeStyle = BAR; ctx.stroke();
      }
      a.stops.forEach((sp, i) => {                         // 色标：从线条拉一根到色块
        const q = P(Ann.stopPoint(cx, a, i)), b = P(Ann.at(a, sp.offset)), h = 4.5 * dpr;
        ctx.lineWidth = 1 * dpr; ctx.strokeStyle = BAR; ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
        const c = parseHex(sp.color) || [0, 0, 0];
        ctx.fillStyle = '#fff'; ctx.fillRect(q[0] - h, q[1] - h, 2 * h, 2 * h);
        ctx.fillStyle = GF.rgba([c[0], c[1], c[2], sp.opacity]); ctx.fillRect(q[0] - h, q[1] - h, 2 * h, 2 * h);
        ctx.lineWidth = (selI === i ? 2.5 : 1) * dpr; ctx.strokeStyle = selI === i ? ACCENT : BAR; ctx.strokeRect(q[0] - h, q[1] - h, 2 * h, 2 * h);
      });
    }
  }
  // 智能参考线回馈（洋红线与标签）
  ctx.lineWidth = 1 * dpr; ctx.strokeStyle = MAGENTA; ctx.fillStyle = MAGENTA; ctx.font = `${11 * dpr}px sans-serif`;
  for (const g of VG.guides){
    if (g.line){ const A = P(g.line[0]), B = P(g.line[1]); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); }
    if (g.label){ const q = P(g.at); ctx.fillText(g.label, q[0] + 6 * dpr, q[1] - 6 * dpr); }
  }
  ctx.restore();
}

/* ── agent 送滑鼠事件：跟人拿滑鼠走同一份手势（像素层／矢量层都行）── */
function dispatch(kind, pt, m){
  const k = activeKind();
  if (k === 'raster'){
    if (kind === 'down') R.down(pt);
    else if (kind === 'move') R.move(pt, m.shift);
    else if (kind === 'up') return R.up(pt, m.shift);
  } else if (k === 'vector'){
    const cx = vcx(); if (!cx) return null;
    if (kind === 'down') V.press(cx, pt, m);
    else if (kind === 'move') V.drag(cx, pt, m);
    else if (kind === 'up'){ if (VG.gesture && VG.gesture.began) V.drag(cx, pt, m); V.release(vcx(), pt); }
    else if (kind === 'dblclick') V.dblclick(cx, pt);
    else if (kind === 'key') return V.key(cx, {key:m.key, shiftKey:!!m.shift});
  }
  return null;
}
CMD.reg('gradient.pointer', {i18n:'',
  params:'{events:[{kind:"down"|"move"|"up"|"dblclick"|"key", x, y 文件坐标, shift?, alt?, key?（kind=key：Delete|Backspace|ArrowLeft|ArrowRight）}…]} 一串指针事件跑一次渐变手势（像素层＝拖出起终点画进去；矢量层＝批注器全部手势）；跟滑鼠同一份程式，所以 Shift 锁角、Alt 复制色标、拖离删除、吸附都一样 → {ok}'},
  p => {
    for (const e of (Array.isArray(p.events) ? p.events : [])){
      const pt = [Number(e.x) || 0, Number(e.y) || 0], m = {shift:!!e.shift, alt:!!e.alt, key:e.key};
      dispatch(e.kind, pt, m);
    }
    if (window.UI) UI.draw();
    return {ok:true};
  });

/* ── 选项（选项栏每个控件都只是叫这条）── */
CMD.reg('gradient.options', {i18n:'',
  params:'{style?:"linear|radial|angle|reflected|diamond", reverse?:bool, dither?:bool, opacity?:1..100, mode?:混合模式（像素层）, smartGuides?:bool, constrainAngle?:度（矢量层 Shift 锁角的基准）} → 目前选项'}, p => {
  if (STYLES.includes(p.style)) RO.style = p.style;
  if (typeof p.reverse === 'boolean') RO.reverse = p.reverse;
  if (typeof p.dither === 'boolean') RO.dither = p.dither;
  if (fin(p.opacity)) RO.opacity = clamp(p.opacity, 1, 100);
  if (typeof BLENDS !== 'undefined' && BLENDS.includes(p.mode)) RO.mode = p.mode;
  if (typeof p.smartGuides === 'boolean') GV.smartGuides = p.smartGuides;
  if (fin(p.constrainAngle)) GV.constrainAngle = p.constrainAngle;
  refreshOptions();
  return Object.assign({ok:true}, RO, {preset:GP.current.name}, GV);
});
function refreshOptions(){ if (window.UI && ToolState.cur === 'gradient') UI.buildOptions('gradient'); }

/* ── 三语 ── */
const STRINGS = {
  'zh-Hant':{'tool.gradient':'漸層',
    'opt.gradPreset':'漸層', 'opt.gradOpacity':'不透明度', 'opt.gradMode':'模式', 'opt.gradReverse':'反向', 'opt.gradDither':'混色',
    'opt.gradAngle':'角度', 'opt.gradAspect':'長寬比', 'opt.gradSmart':'智慧型參考線',
    'ui.gradLinear':'線性漸層', 'ui.gradRadial':'放射性漸層', 'ui.gradAngle':'角度漸層', 'ui.gradReflected':'反射性漸層', 'ui.gradDiamond':'菱形漸層',
    'ui.gradKindLinear':'線性', 'ui.gradKindRadial':'放射狀', 'ui.gradReverseBtn':'反轉漸層',
    'ui.gradStopColor':'顏色', 'ui.gradStopOpacity':'不透明度 %', 'ui.gradStopLocation':'位置 %',
    'ui.gradLegacy':'＋ 舊版漸層（金屬…）',
    'ui.gradRasterHint':'拖曳畫出漸層 · Shift 鎖 45° · 有選取範圍只畫範圍內',
    'ui.gradVectorHint':'拖過選取的物件設漸層 · 按物件內＝從該點套用 · 拖起點／線條移動、拖終點改長度角度、終點外旋轉 · 按線條加色標、拖色標移動（Alt 複製、拖離刪除）、雙擊色標改色 · Delete 刪色標、←→ 微移 · Shift 鎖角'},
  'zh-Hans':{'tool.gradient':'渐变',
    'opt.gradPreset':'渐变', 'opt.gradOpacity':'不透明度', 'opt.gradMode':'模式', 'opt.gradReverse':'反向', 'opt.gradDither':'仿色',
    'opt.gradAngle':'角度', 'opt.gradAspect':'长宽比', 'opt.gradSmart':'智能参考线',
    'ui.gradLinear':'线性渐变', 'ui.gradRadial':'径向渐变', 'ui.gradAngle':'角度渐变', 'ui.gradReflected':'对称渐变', 'ui.gradDiamond':'菱形渐变',
    'ui.gradKindLinear':'线性', 'ui.gradKindRadial':'径向', 'ui.gradReverseBtn':'反向渐变',
    'ui.gradStopColor':'颜色', 'ui.gradStopOpacity':'不透明度 %', 'ui.gradStopLocation':'位置 %',
    'ui.gradLegacy':'＋ 旧版渐变（金属…）',
    'ui.gradRasterHint':'拖动画出渐变 · Shift 锁 45° · 有选区只画选区内',
    'ui.gradVectorHint':'拖过选中物件设渐变 · 点物件内＝从那点套用 · 拖起点／线条移动、拖终点改长度角度、终点外旋转 · 点线条加色标、拖色标移动（Alt 复制、拖离删除）、双击色标改色 · Delete 删色标、←→ 微移 · Shift 锁角'},
  'en':{'tool.gradient':'Gradient',
    'opt.gradPreset':'Gradient', 'opt.gradOpacity':'Opacity', 'opt.gradMode':'Mode', 'opt.gradReverse':'Reverse', 'opt.gradDither':'Dither',
    'opt.gradAngle':'Angle', 'opt.gradAspect':'Aspect Ratio', 'opt.gradSmart':'Smart Guides',
    'ui.gradLinear':'Linear Gradient', 'ui.gradRadial':'Radial Gradient', 'ui.gradAngle':'Angle Gradient', 'ui.gradReflected':'Reflected Gradient', 'ui.gradDiamond':'Diamond Gradient',
    'ui.gradKindLinear':'Linear', 'ui.gradKindRadial':'Radial', 'ui.gradReverseBtn':'Reverse Gradient',
    'ui.gradStopColor':'Color', 'ui.gradStopOpacity':'Opacity %', 'ui.gradStopLocation':'Location %',
    'ui.gradLegacy':'+ Legacy Gradients (Metals…)',
    'ui.gradRasterHint':'Drag to draw a gradient  ·  Shift snaps to 45°  ·  only inside the selection',
    'ui.gradVectorHint':'Drag across selected art to set its gradient  ·  click inside art to apply from there  ·  drag the start or bar to move, the end to resize/rotate, past the end to rotate  ·  click the bar to add a stop, drag stops (Alt copies, off the bar deletes), double-click a stop to edit  ·  Delete removes a stop, ←→ nudge  ·  Shift constrains'}
};
if (typeof Lang !== 'undefined') Lang.add(STRINGS);

/* ── 选项栏 ── */
function btn(box, txt, tipKey, on, fn, data){
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = txt; b.title = Lang.t(tipKey);
  b.style.cssText = `margin:0 1px;min-width:24px;cursor:pointer;${on ? 'background:#2f7fd8;color:#fff;' : ''}`;
  Object.assign(b.dataset, data || {}); b.onclick = fn; box.appendChild(b); return b;
}
const sepEl = box => { const v = document.createElement('span'); v.style.cssText = 'display:inline-block;width:1px;height:18px;background:#555;margin:0 6px;vertical-align:middle'; box.appendChild(v); };
function rampCanvas(stops){                               // gradient_ui.rs:497 paint_ramp（棋盘格底）
  const c = document.createElement('canvas'); c.width = 96; c.height = 20; c.dataset.opt = 'ramp';
  c.style.cssText = 'vertical-align:middle;border:1px solid #555;margin:0 4px';
  const x = c.getContext('2d');
  for (let i = 0; i < 20; i++) for (let j = 0; j < 4; j++){ x.fillStyle = (i + j) % 2 ? '#ccc' : '#fff'; x.fillRect(i * 5, j * 5, 5, 5); }
  for (let k = 0; k < 96; k++){ const q = sampleStops(stops, k / 95); x.fillStyle = GF.rgba(q); x.fillRect(k, 0, 1, 20); }
  return c;
}
function buildRasterOptions(box, add){
  const set = p => { CMD.run('gradient.options', p); };
  // 预设（我们加的：PhotoCraft 经典模式只画前景→背景；这里选别的预设就画它）
  const ps = document.createElement('select'); ps.dataset.opt = 'preset';
  ps.innerHTML = GP.groups.map(g => `<optgroup label="${g.name}">${g.items.map(i => `<option value="${i.name.replace(/"/g, '&quot;')}"${i.name === GP.current.name ? ' selected' : ''}>${i.name}</option>`).join('')}</optgroup>`).join('')
    + (GP.groups.some(g => g.name === 'Legacy Metals') ? '' : `<option value="__legacy__">${Lang.t('ui.gradLegacy')}</option>`);   // PS 渐变面板选单「旧版渐变」
  ps.onchange = () => { if (ps.value === '__legacy__') CMD.run('gradient.presets.legacy', {}); else CMD.run('gradient.presets.select', {preset:ps.value}); };
  add('gradPreset', ps);
  box.appendChild(rampCanvas(resolvePreset(GP.current, parseHex(fgHex()), parseHex(bgHex()))));
  sepEl(box);
  [['linear', '▤', 'ui.gradLinear'], ['radial', '◎', 'ui.gradRadial'], ['angle', '◔', 'ui.gradAngle'], ['reflected', '⇔', 'ui.gradReflected'], ['diamond', '◇', 'ui.gradDiamond']]
    .forEach(([v, t, k]) => btn(box, t, k, RO.style === v, () => set({style:v}), {style:v}));
  sepEl(box);
  const md = document.createElement('select'); md.dataset.opt = 'mode';
  md.innerHTML = (typeof BLENDS !== 'undefined' ? BLENDS : ['normal']).map(b => `<option value="${b}"${RO.mode === b ? ' selected' : ''}>${Lang.t('blend.' + b)}</option>`).join('');
  md.onchange = () => set({mode:md.value}); add('gradMode', md);
  const op = document.createElement('input'); op.type = 'number'; op.min = 1; op.max = 100; op.value = RO.opacity; op.style.width = '56px'; op.dataset.opt = 'opacity';
  op.onchange = () => set({opacity:+op.value}); add('gradOpacity', op);
  const rv = document.createElement('input'); rv.type = 'checkbox'; rv.checked = RO.reverse; rv.dataset.opt = 'reverse';
  rv.onchange = () => set({reverse:rv.checked}); add('gradReverse', rv);
  const di = document.createElement('input'); di.type = 'checkbox'; di.checked = RO.dither; di.dataset.opt = 'dither';
  di.onchange = () => set({dither:di.checked}); add('gradDither', di);
  const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t('ui.gradRasterHint'); box.appendChild(h);
}
function buildVectorOptions(box, add){
  // VectorCraft 的渐变工具自己没有选项列（options() = Null），种类／反向／角度／长宽比在渐变面板；我们没有渐变面板，摆在这里（都叫 gradient.edit）
  const cx = vcx(), a = annotatorOf(cx);
  const edit = p => { try { CMD.run('gradient.edit', p); } catch (e){} refreshOptions(); };
  btn(box, Lang.t('ui.gradKindLinear'), 'ui.gradKindLinear', !!a && a.kind === 'linear', () => edit({kind:'linear'}), {kind:'linear'});
  btn(box, Lang.t('ui.gradKindRadial'), 'ui.gradKindRadial', !!a && a.kind === 'radial', () => edit({kind:'radial'}), {kind:'radial'});
  btn(box, '⇄', 'ui.gradReverseBtn', false, () => edit({reverse:true}), {opt:'reverseBtn'});
  sepEl(box);
  const an = document.createElement('input'); an.type = 'number'; an.step = 1; an.style.width = '60px'; an.dataset.opt = 'angle';
  an.value = a ? +angleDeg(a.geom).toFixed(1) : 0; an.onchange = () => edit({angle:+an.value}); add('gradAngle', an);
  const as = document.createElement('input'); as.type = 'number'; as.step = 1; as.min = 0.5; as.style.width = '60px'; as.dataset.opt = 'aspect';
  as.value = a ? +(a.geom.aspect * 100).toFixed(1) : 100; as.disabled = !a || a.kind !== 'radial'; as.onchange = () => edit({aspect:+as.value}); add('gradAspect', as);
  const sg = document.createElement('input'); sg.type = 'checkbox'; sg.checked = GV.smartGuides; sg.dataset.opt = 'smartGuides';
  sg.onchange = () => CMD.run('gradient.options', {smartGuides:sg.checked}); add('gradSmart', sg);
  const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t('ui.gradVectorHint'); box.appendChild(h);
}

/* ═══════════ 登记 ═══════════ */
const mods = e => ({shift:!!e.shiftKey, alt:!!e.altKey});
Tools.reg({
  id:'gradient', icon:'▦', key:'G', group:'raster', order:35, for:'common', opts:[], cursor:'crosshair',
  strings:STRINGS,
  onDown(e, pt){
    if (e.button !== undefined && e.button !== 0) return;          // 工具只跟左键
    Pop.close();
    const k = activeKind();
    if (k === 'raster'){ R.down(pt); UI.draw(); }
    else if (k === 'vector'){ const cx = vcx(); if (cx) V.press(cx, pt, mods(e)); UI.draw(); }
  },
  onMove(e, pt, P){
    const k = activeKind();
    if (k === 'raster'){ if (P.down && RG.drag){ R.move(pt, e.shiftKey); UI.draw(); } }
    else if (k === 'vector'){
      const cx = vcx(); if (!cx) return;
      if (P.down && VG.gesture){ V.drag(cx, pt, mods(e)); UI.draw(); }
      UI.canvas.style.cursor = V.cursor(cx, pt);
    }
  },
  onUp(e, pt){
    const k = activeKind();
    if (k === 'raster') R.up(pt, e.shiftKey);
    else if (k === 'vector'){ const cx = vcx(); if (cx){ if (VG.gesture && VG.gesture.began) V.drag(cx, pt, mods(e)); V.release(cx, pt); } }
    else RG.drag = null;
    UI.draw();
    if (k === 'vector') refreshOptions();
  },
  onDblClick(e, pt){ if (activeKind() === 'vector'){ const cx = vcx(); if (cx) V.dblclick(cx, pt); UI.draw(); } },
  onKey(e){
    if (e.key === 'Escape'){
      if (Pop.el){ Pop.close(); return true; }
      if (activeKind() === 'vector' && V.cancel()){ UI.draw(); return true; }
      return false;
    }
    if (activeKind() !== 'vector' || e.ctrlKey || e.metaKey || e.altKey) return false;
    const r = V.key(vcx(), e);
    if (r){ e.preventDefault(); UI.draw(); refreshOptions(); }
    return r;
  },
  onDeactivate(){ V.cancel(); RG.drag = null; Pop.close(); VG.guides = []; },
  drawOverlay(ctx, s){ const k = activeKind(); if (k === 'raster') R.draw(ctx, s); else if (k === 'vector') drawVector(ctx, s); },
  buildOptions(box, add){ if (activeKind() === 'vector') buildVectorOptions(box, add); else buildRasterOptions(box, add); }
});

/* 给测试／agent 看内部 */
window.GradientTool = {RO, GV, GP, VG, gradT, sampleStops, ditherNoise, snap45, resolvePreset, insertStop, removeStop, moveStop, duplicateStop, midpointPos, midpointFromPos, fitGeom, annotatorOf:() => annotatorOf(vcx()), selectedStop:() => selectedStop(vcx()), Ann};

})();
