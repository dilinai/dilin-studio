/* 修复画笔（J）：Alt＋点＝设取样点（跟仿制图章共用取样槽）；拖曳＝把取样点那一带的「纹理」搬过来，颜色与明暗照落笔处四周（梯度域无缝贴上），放开时一次落笔（一步历史）。
   🔴 这支档是把 ArtCraft／PhotoCraft 的 Rust 原始码逐段翻译成 JS（算法照搬，不是凭 PS 印象另写）：
   - engine/src/retouch_cmds.rs 131–212、255–314   SampleLayers、composite_region、clone_sample、clone_result、pad_coverage、heal_region、healing_brush（paint.healingBrush）
   - algo/src/poisson.rs                          seamless_clone／solve_membrane（在 tools/spotheal.js 的 window.HealCore 里，两颗共用）
   - engine/src/presets/clone_source.rs           取样槽、mapping()（W/H、旋转、翻转）——直接用 tools/clone.js 露出的 window.CloneStamp（cs、mapping、transformMatrix）
   - ui-egui/src/retouch_ui.rs                    Alt 点设取样（cloneSource.set）、收笔叫命令（slot／offset／source 三条路）、没取样点报错、取样十字、选项栏（对齐、样本）
   - ui-egui/src/canvas.rs                        Tool::Healing：Alt 点只设取样；笔尖圆圈只有按住 Alt 才画中心十字（brush_tip_centre）
   - stroke_constraint.rs、stroke_trail.rs、brush_resize.rs   Shift 直线、Ctrl+Alt 改大小（HealCore 里，同 clone.js）
   他们的 app.ui.clone_source／clone_offset 与 tool_options.clone_aligned／clone_sample 是仿制图章与修复画笔「同一份」⇒ 这里读写 CloneStamp.ui 的 source／offset／aligned／sample。
   命令：heal.stroke / heal.setOptions（设取样点走 clone.sourceSet，同他们的 cloneSource.set） */
(function(){
const H = window.HealCore;
if (!H){ console.error('heal.js: window.HealCore（tools/spotheal.js）没载到'); return; }
const { RC, asNum, asBool, roundAway } = H;
const SAMPLES = ['current', 'currentAndBelow', 'all'];

/* 跟仿制图章共用的那份界面状态（clone.js 没载到就用自己的一份） */
const OWN = { source:null, offset:null, aligned:true, sample:'current' };
const SU = () => (window.CloneStamp && CloneStamp.ui) || OWN;
const activeSlot = () => window.CloneStamp ? CloneStamp.cs.slots[Math.min(CloneStamp.cs.active, 4)] : null;

/* 没有 clone.js 时的退路：只认 source／offset 参数、恒等变换 */
function FallbackMap(source, anchor){ this.source = source; this.anchor = anchor; }
FallbackMap.prototype.isTranslation = () => true;
FallbackMap.prototype.offset = function(){ return [roundAway(this.source[0]-this.anchor[0]), roundAway(this.source[1]-this.anchor[1])]; };
FallbackMap.prototype.map = function(x, y){ return [this.source[0] + x - this.anchor[0], this.source[1] + y - this.anchor[1]]; };
const pt2 = (p, k) => { const a = p[k]; return (Array.isArray(a) && typeof a[0] === 'number' && typeof a[1] === 'number') ? [a[0], a[1]] : null; };
/* clone_mapping（retouch_cmds.rs:186）＝ presets::clone_source::mapping */
function mappingFor(p, first, cmd){
  if (window.CloneStamp && CloneStamp.mapping){
    const r = CloneStamp.mapping(p, first);
    if (r.error) return { error: r.error.replace(/^clone\.stamp/, cmd) };
    return r;
  }
  const off = pt2(p, 'offset'), anchor = pt2(p, 'anchor') || first;
  if (off) return { map: new FallbackMap([anchor[0]+off[0], anchor[1]+off[1]], anchor) };
  const src = pt2(p, 'source');
  if (src) return { map: new FallbackMap(src, anchor) };
  return { error:`${cmd}: missing \`source\` ([x,y]) or \`offset\` ([dx,dy])` };
}

/* ───────── retouch_cmds.rs healing_brush() ───────── */
function healingBrush(p, opts){
  const C = 'heal.stroke';
  const b = H.parseBrush(p, C); if (b.error) return {ok:false, error:b.error};
  const { pts, brush, L } = b;
  const which = typeof p.sampleLayer === 'string' ? p.sampleLayer : 'current';
  if (!SAMPLES.includes(which)) return {ok:false, error:`${C}: unknown sampleLayer \`${which}\` (current|currentAndBelow|all)`};
  const mode = typeof p.mode === 'string' ? p.mode : 'normal';
  if (!BLENDS.includes(mode)) return {ok:false, error:`${C}: unknown blend mode \`${mode}\``};
  const aligned = asBool(p.aligned, true);
  if (!(opts && opts.live)){ const lf = H.lockFail(L, C); if (lf) return lf; }
  const r = mappingFor(p, pts[0], C); if (r.error) return {ok:false, error:r.error};
  const map = r.map, off = map.offset();
  const { rect:bounds, cov:c0 } = H.strokeCoverage(pts, brush);
  const S = H.sourceBuffer(L, which);
  let dmg;
  if (opts && opts.live){
    // 边拖边显示（我们加的，照 PS：拖的时候先看到取样处的原样，放开才融色）：只贴 clone_sample，不解 Poisson
    const paint = H.cloneSample(S, bounds, map);
    dmg = H.applyCoverage(L, bounds, c0, brush.opacity, paint, mode, H.lockAlpha(L));
  } else {
    const { rect:g, cov } = H.padCoverage(bounds, c0, 2);
    const src = H.cloneSample(S, g, map);
    // 要把纹理配进去的目的地：这层本身；取样多层时＝看得到的合成（空层上修复也对得上画面）
    const dst = H.readRegion(S, g);
    const mask = new Uint8Array(cov.length);
    for (let i = 0; i < cov.length; i++) mask[i] = cov[i] > 0 ? 1 : 0;
    const healed = H.healRegion(src, dst, mask);
    dmg = H.applyCoverage(L, g, cov, brush.opacity, healed, mode, H.lockAlpha(L));
  }
  // clone_result：aligned 时位移延续；非 aligned 每笔都回到原取样点
  const f = pts[0], src = pt2(p, 'source') || [f[0] + off[0], f[1] + off[1]];
  return { ok:true, damage:[dmg[0], dmg[1], dmg[2]-dmg[0], dmg[3]-dmg[1]], offset:off, aligned, nextSource: aligned ? null : src };
}

CMD.reg('heal.stroke', {i18n:'', undoable:true,
  params:'{points:[[x,y,pressure?],…] 文件坐标（必填）, source?:[sx,sy] 取样点（对准第一点）| offset?:[dx,dy] 源−目的, anchor?:[x,y], '
       + 'aligned=true（true＝整笔固定位移且记进取样槽，后续笔延续；false＝每笔都从取样点重来）, '
       + 'sampleLayer="current"|"currentAndBelow"|"all", size=工具大小 px, hardness=0..100（工具硬度）, opacity=1..100=100, flow=1..100=100, spacing=1..1000（% of size）=25, '
       + 'mode="normal"|"multiply"|…=normal, scale?:[w%,h%], rotation?:度, flipH?, flipV?（给了就盖过取样槽的变换）, layerId?} '
       + '没给 source/offset 就用 clone.sourceSet 设好的作用中取样槽（与仿制图章共用）。取样处的纹理＋落笔处四周的颜色（梯度域无缝贴上） → {damage:[x,y,w,h], offset:[dx,dy], aligned, nextSource}'},
  p => healingBrush(p));
CMD.reg('heal.setOptions', {i18n:'', params:'{aligned?:bool, sampleLayer?:"current"|"currentAndBelow"|"all", size?:px, hardness?:0..100} 滑鼠作画用的选项（＝选项栏；对齐与样本跟仿制图章同一份）'}, p => {
  const su = SU();
  if (typeof p.aligned === 'boolean') su.aligned = p.aligned;
  if (SAMPLES.includes(p.sampleLayer)) su.sample = p.sampleLayer;
  if (typeof p.size === 'number') ToolState.size = Math.min(Math.max(Math.round(p.size), 1), 5000);
  if (typeof p.hardness === 'number') ToolState.hardness = Math.min(Math.max(p.hardness, 0), 100) / 100;
  if (window.UI && ToolState.cur === 'heal' && !U.resize) UI.buildOptions('heal');
  return { aligned:su.aligned, sampleLayer:su.sample, size:ToolState.size, hardness:Math.round(ToolState.hardness*100) };
});

/* ───────── 界面（retouch_ui.rs／canvas.rs） ───────── */
const U = {
  drag:null, lastEnd:null, trail:null, resize:null, blocked:false,
  hover:null, alt:false, shift:false, status:null, statusError:false
};
const fmt = (s, kv) => s.replace(/\{(\w+)\}/g, (m, k) => kv[k] !== undefined ? kv[k] : m);
function showStatus(){
  const el = document.getElementById('healStatus'); if (!el) return;
  const st = U.status || (SU().source ? null : {key:'ui.healSetSource'});
  el.textContent = !st ? '' : st.key ? fmt(Lang.t(st.key), st.args || {}) : String(st.text || '');
  el.style.color = (U.status && U.statusError) ? '#e8573f' : '#7a8290';
}
function setStatus(st, error){ U.status = st; U.statusError = !!error; showStatus(); }

/* retouch_ui.rs set_source：四舍五入、清掉位移、写进作用中的取样槽（cloneSource.set＝我们的 clone.sourceSet） */
function setSource(x, y){
  const su = SU();
  su.source = [roundAway(x), roundAway(y)]; su.offset = null;
  if (CMD.map['clone.sourceSet']) CMD.run('clone.sourceSet', {source:[roundAway(x), roundAway(y)]});
  if (ToolState.cur === 'heal') UI.buildOptions('heal');
  setStatus({key:'ui.healSourceAt', args:{x:x.toFixed(0), y:y.toFixed(0)}}, false);
}
/* finish_stroke：作用中的槽有取样点就交给引擎；否则 offset（aligned）或 source；都没有就报错不画 */
function strokeParams(points){
  const su = SU(), slot = activeSlot();
  const p = { aligned:su.aligned, sampleLayer:su.sample };
  if (!(slot && slot.source)){
    if (su.offset && su.aligned) p.offset = su.offset.slice();
    else if (su.source) p.source = su.source.slice();
    else return null;
  }
  p.points = points.map(q => [q[0], q[1], q[2]]);
  return p;
}
/* 边拖边显示：按下备份这层；每帧还原上一帧画过的那块，再用目前为止的点重贴一次「原样取样」（不进历史，aligned 槽也不动）；
   放开整层还原，走 CMD heal.stroke 正式落一次（解 Poisson、进历史） */
const Live = {
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
    const p = strokeParams(points); if (!p) return;
    this.restore(); p.layerId = this.L.id;
    const s = activeSlot(), keep = s ? (s.anchor ? s.anchor.slice() : null) : null;
    const r = healingBrush(p, {live:true});
    if (s) s.anchor = keep;                       // 预览不配对：配对留给放开那次正式落笔
    if (r && r.ok) this.dmg = r.damage;
  },
  end(){ this.restore(); this.L = null; this.bak = null; }
};
function finishStroke(points){
  Live.end();
  const p = strokeParams(points);
  if (!p){ setStatus({key:'ui.healNoSource'}, true); return; }
  const r = CMD.run('heal.stroke', p);
  if (r && r.ok === false){ setStatus({text:r.error}, true); return; }
  const su = SU();
  su.offset = (su.aligned && r && r.offset) ? r.offset.slice() : null;
}
function resizeUpdate(x, y){
  const r = U.resize;
  const [size, hardness] = H.resized(r.start, x - r.anchor[0], y - r.anchor[1], UI.zoom);
  if (ToolState.size === size && ToolState.hardness === hardness) return;
  CMD.map['heal.setOptions'].run({size, hardness:hardness*100});
}
/* preset_panels.rs clone_sample_point ＋ retouch_ui.rs draw_source_marker：笔尖此刻对应的取样点 */
function markerPoint(){
  const at = (U.drag && U.drag.points.length) ? U.drag.points[U.drag.points.length-1] : U.hover;
  const su = SU(), s = activeSlot();
  if (s && s.source){
    const stroking = U.drag ? U.drag.start : null;
    const anchor = su.aligned ? (s.anchor || stroking) : stroking;
    if (anchor && at){
      const m = CloneStamp.transformMatrix(s.scale, s.rotation, s.flipH, s.flipV), dx = at[0]-anchor[0], dy = at[1]-anchor[1];
      return [s.source[0] + m[0]*dx + m[1]*dy, s.source[1] + m[2]*dx + m[3]*dy];
    }
    return s.source;
  }
  if (su.offset && at) return [at[0]+su.offset[0], at[1]+su.offset[1]];
  if (!su.offset && su.source) return su.source;
  return null;
}

const tool = Tools.reg({
  id:'heal', icon:'✙', group:'raster', order:42, for:'raster', needs:'raster', opts:['size','hardness'],
  cursor:'none',
  ui:U, shared:SU, healingBrush, markerPoint,
  trailCoverage: (x, y) => U.trail ? U.trail.cov[y*U.trail.w + x] : 0,
  live: Live,

  strings:{
    'zh-Hant':{ 'opt.aligned':'對齊', 'opt.sample':'樣本',
      'opt.sample.current':'目前圖層', 'opt.sample.currentAndBelow':'目前及下方圖層', 'opt.sample.all':'所有圖層',
      'ui.healSetSource':'按住 Alt 點一下設定取樣點', 'ui.healNoSource':'請先按住 Alt 點一下，設定要修復的取樣點',
      'ui.healSourceAt':'取樣點已設在 {x}, {y}', 'ui.healDiameter':'直徑：', 'ui.healHardness':'硬度：' },
    'zh-Hans':{ 'opt.aligned':'对齐', 'opt.sample':'样本',
      'opt.sample.current':'当前图层', 'opt.sample.currentAndBelow':'当前和下方图层', 'opt.sample.all':'所有图层',
      'ui.healSetSource':'按住 Alt 点一下设置取样点', 'ui.healNoSource':'请先按住 Alt 点一下，设置要修复的取样点',
      'ui.healSourceAt':'取样点已设在 {x}, {y}', 'ui.healDiameter':'直径：', 'ui.healHardness':'硬度：' },
    'en':{ 'opt.aligned':'Aligned', 'opt.sample':'Sample',
      'opt.sample.current':'Current Layer', 'opt.sample.currentAndBelow':'Current & Below', 'opt.sample.all':'All Layers',
      'ui.healSetSource':'Alt-click to set the source', 'ui.healNoSource':'Alt-click to define a source point to heal from',
      'ui.healSourceAt':'Source set at {x}, {y}', 'ui.healDiameter':'Diameter:', 'ui.healHardness':'Hardness:' }
  },

  /* retouch_ui.rs:156-169：对齐、样本下拉；还没取样点时提示「Alt 点设取样」 */
  buildOptions(box, add, mk){
    const su = SU();
    const cb = mk('checkbox', {checked:su.aligned});
    cb.dataset.opt = 'aligned';
    cb.onchange = () => CMD.run('heal.setOptions', {aligned:cb.checked});
    add('aligned', cb);
    const sel = document.createElement('select');
    sel.dataset.opt = 'sample';
    SAMPLES.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = Lang.t('opt.sample.'+v); sel.appendChild(o); });
    sel.value = su.sample;
    sel.onchange = () => CMD.run('heal.setOptions', {sampleLayer:sel.value});
    add('sample', sel);
    const st = document.createElement('span'); st.id = 'healStatus'; st.style.color = '#7a8290';
    box.appendChild(st);
    showStatus();
  },

  onDown(e, pt, P){
    U.alt = e.altKey; U.shift = e.shiftKey; U.hover = pt; U.blocked = false;
    if (e.ctrlKey && e.altKey && !U.drag){
      U.resize = { anchor:pt.slice(), start:[ToolState.size, ToolState.hardness] };
      UI.draw(); return;
    }
    // canvas.rs:2054：Alt 点只设取样点（也不问要不要点阵化、不看图层锁）
    if (e.altKey){ setSource(pt[0], pt[1]); P.down = false; UI.draw(); return; }
    const L0 = Doc.active();
    if (L0 && L0.kind === 'raster' && window.Locks && Locks.deny(L0, 'pixels')){ U.blocked = true; return; }
    P.ensureRaster();
    const from = (e.shiftKey && U.lastEnd) ? U.lastEnd.slice() : null;
    const pr = H.pressure(e);
    const points = [[pt[0], pt[1], pr]];
    if (from) points.unshift([from[0], from[1], pr]);
    U.drag = { start: from || pt.slice(), points, axis:null };
    U.trail = H.trailNew();
    H.trailFeed(U.trail, U.drag.points, ToolState.size);
    Live.begin(); Live.update(U.drag.points);
    UI.draw();
  },
  onMove(e, pt, P){
    U.alt = e.altKey; U.shift = e.shiftKey; U.hover = pt;
    if (U.resize){ resizeUpdate(pt[0], pt[1]); UI.draw(); return; }
    const d = U.drag;
    if (d && P.down){
      const last = d.points.length ? d.points[d.points.length-1] : d.start;
      const q = H.constrain(d, last, pt, e.shiftKey);
      if (!d.points.length || Math.abs(last[0]-q[0]) + Math.abs(last[1]-q[1]) > 0.25) d.points.push([q[0], q[1], H.pressure(e)]);
      H.trailFeed(U.trail, d.points, ToolState.size);
      Live.update(d.points);
    }
    UI.draw();
  },
  onUp(e, pt){
    U.alt = e.altKey; U.shift = e.shiftKey;
    if (U.resize){ resizeUpdate(pt[0], pt[1]); U.resize = null; CMD.run('heal.setOptions', {}); return; }
    if (U.blocked){ U.blocked = false; UI.draw(); return; }
    const d = U.drag; U.drag = null; U.trail = null;
    if (!d){ UI.draw(); return; }
    const last = d.points.length ? d.points[d.points.length-1] : d.start;
    const q = H.constrain(d, last, pt, e.shiftKey);
    if (!d.points.length || last[0] !== q[0] || last[1] !== q[1]) d.points.push([q[0], q[1], d.points.length ? last[2] : 1]);
    U.lastEnd = d.points[d.points.length-1].slice(0, 2);
    finishStroke(d.points);
    UI.refresh();
  },
  onDeactivate(){ if (U.drag) Live.end(); U.drag = null; U.trail = null; U.resize = null; U.hover = null; U.blocked = false; },

  /* canvas.rs brush_tip_centre：修复画笔跟仿制图章一样，按住 Alt 才出中心（这里同 clone.js 换成取样瞄准圈） */
  drawOverlay(ctx, s){
    H.drawCommon(ctx, s, U, { trail: !Live.dmg, marker: markerPoint, aim: U.alt, centre: () => U.alt, readout:['ui.healDiameter', 'ui.healHardness'] });
  }
});

function modKey(e){
  if (ToolState.cur !== 'heal' || !window.UI || !UI.canvas) return;
  if (e.key === 'Alt' || e.key === 'Shift'){
    if (e.altKey !== U.alt || e.shiftKey !== U.shift){ U.alt = e.altKey; U.shift = e.shiftKey; UI.draw(); }
  }
}
document.addEventListener('keydown', modKey);
document.addEventListener('keyup', modKey);
window.addEventListener('DOMContentLoaded', () => {
  const v = document.getElementById('view');
  if (v) v.addEventListener('pointerleave', () => { if (ToolState.cur === 'heal' && !U.drag){ U.hover = null; UI.draw(); } });
});

window.HealBrush = tool;
/* 描边路径（PS 路径面板 ▸ 描边路径 ▸ 修复画笔）：同滑鼠收笔那包参数；没取样点回 null */
tool.pathParams = (L, points) => { const p = strokeParams(points); if (p) p.layerId = L.id; return p; };
})();
