/* 标尺工具 ruler（PS「尺標工具／标尺工具」，跟吸管同一格 I）—— 逐段翻译自 ArtCraft photocraft 原码：
   ① ui-egui/src/analysis_ui.rs
        :200-202   tolerance＝7 屏幕像素／缩放（点到端点的容差）
        :208-217   constrain：Shift ⇒ 以「固定的那一端」为圆心锁 45° 的倍数，长度不变
        :219-221   set_ruler：每一步都叫 image.analysis.rulerTool {start,end,protractor}
        :232-254   Down：①Alt＋按在端点上 ⇒ 从那个顶点拉量角器第二臂（按在终点就先把起终点对调，让顶点＝start）；
                         ②按在量角器端 ⇒ 拖量角器；③按在终点 ⇒ 拖终点；④按在起点 ⇒ 拖起点；⑤其他 ⇒ 新的一条（起点＝终点＝按下点）
        :255-264   Move：新线／终点 ⇒ end＝constrain(start, p)；起点 ⇒ start＝constrain(end, p)；量角器 ⇒ protractor＝constrain(start, p)
        :265-269   Up：新线且长度 < 0.5（点一下没拖）⇒ 清掉标尺
        :340-366   draw_overlay：只在标尺工具作用中画；每段 3px 半透明黑＋1px 白，端点画十字（臂 5px，黑 3px 底＋白 1px）
        :404-437   选项栏：X Y W H A L1 L2 读数（两位小数；勾「使用测量比例」时 X/Y/W/H/L1/L2 乘比例、角度不乘）、
                   「使用测量比例」、「拉直图层」（image.analysis.straightenLayer）、「清除」（rulerTool clear）；没有标尺时两钮灰掉
        :903-928   测试：拖出 → 拖终点＋Shift 锁垂直 → Alt 从起点拉量角器 90° → 远处点一下＝清除；整个过程不进历史
   ② engine/src/analysis_cmds.rs
        :555-577   ruler_info（X/Y＝起点、W/H、角度：y 朝上逆时针 −180…180；有量角器＝两臂夹角 0…180、L1/L2）
        :579-616   ruler_tool（set_quiet：文件资料但不进历史）
        :632-666   straighten（转到最近的轴；背景层＝转画布再裁、否则只转当前层；标尺清掉）
   ③ doc/src/analysis.rs:60-68 Ruler {start, end, protractor?}（start＝量角器的顶点）
   资料与命令本体：menus/impl/ps-image.js 已照 analysis_cmds.rs 翻好 Doc.measurement.ruler 与 ps.image.analysis.rulerTool／straightenLayer
   （本档不另存一份，工具一律叫那几条命令）。本档登记 ruler.* 给 agent：ruler.gesture 跟人拖一下走同一支 press/drag/release。
   坐标：标尺量的是文件坐标（不是图层坐标），图层被移动过不影响落点。 */
(function(){
const RulerTool = window.RulerTool = {
  drag: null,              // 'new' | 0 起点 | 1 终点 | 2 量角器（analysis_ui.rs:19-30 Drag::RulerNew／RulerHandle）
  useScale: false,         // 选项栏「使用测量比例」（AnalysisUi.use_measurement_scale）
  bar: null                // 选项栏读数的 span（叠画时顺手刷新）
};
const zoom = () => Math.max((window.UI && UI.zoom) || 1, 0.01);
const tolerance = () => 7 / zoom();                                     // :200-202
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/* :208-217 constrain */
function constrain(from, to, shift){
  if (!shift) return [to[0], to[1]];
  const dx = to[0] - from[0], dy = to[1] - from[1], q = Math.PI / 4;
  const a = Math.round(Math.atan2(dy, dx) / q) * q, l = Math.hypot(dx, dy);
  return [from[0] + l * Math.cos(a), from[1] + l * Math.sin(a)];
}
const meas = () => Doc.measurement || {};
const curRuler = () => { const r = meas().ruler; return r ? {start:r.start.slice(), end:r.end.slice(), protractor:r.protractor ? r.protractor.slice() : null} : null; };
const scaleOf = () => Object.assign({pixelLength:1, logicalLength:1, units:'pixels'}, meas().scale || {});
const factor = sc => sc.pixelLength > 0 ? sc.logicalLength / sc.pixelLength : 1;
const round4 = v => Math.round(v * 10000) / 10000;
const has = id => !!CMD.map[id];
/* :219-221 set_ruler */
function setRuler(r){
  if (!has('ps.image.analysis.rulerTool')) return {ok:false, error:'ps.image.analysis.rulerTool missing (menus/impl/ps-image.js not loaded)'};
  return CMD.run('ps.image.analysis.rulerTool', {start:r.start, end:r.end, protractor:r.protractor || null});
}
/* analysis_cmds.rs:555-577 ruler_info（同 ps-image.js 那份；读数要在这里算，免得每次重画都过一次命令） */
function rulerInfo(r, sc){
  const dx = r.end[0] - r.start[0], dy = r.end[1] - r.start[1], l1 = Math.hypot(dx, dy), f = factor(sc);
  if (!r.protractor) return {x:r.start[0], y:r.start[1], w:dx, h:dy, angle:round4(Math.atan2(-dy, dx) * 180 / Math.PI), l1:round4(l1), l2:null, length:round4(l1 * f), units:sc.units, protractor:false};
  const ex = r.protractor[0] - r.start[0], ey = r.protractor[1] - r.start[1];
  let a = Math.abs((Math.atan2(-dy, dx) - Math.atan2(-ey, ex)) * 180 / Math.PI); if (a > 180) a = 360 - a;
  return {x:r.start[0], y:r.start[1], w:dx, h:dy, angle:round4(a), l1:round4(l1), l2:round4(Math.hypot(ex, ey)), length:round4(l1 * f), units:sc.units, protractor:true};
}
/* 选项栏读数（:415-426）：勾了「使用测量比例」X/Y/W/H/L1/L2 乘比例，角度不乘 */
function readout(){
  const r = curRuler(); if (!r) return null;
  const sc = scaleOf(), info = rulerInfo(r, sc), f = RulerTool.useScale ? factor(sc) : 1, m = v => v === null ? null : v * f;
  return {x:m(info.x), y:m(info.y), w:m(info.w), h:m(info.h), angle:info.angle, l1:m(info.l1), l2:m(info.l2), units:RulerTool.useScale ? sc.units : 'pixels', protractor:info.protractor};
}

/* ── 手势本体（:232-269）：滑鼠与 ruler.gesture 都走这三支 ── */
function press(p, mods){
  const tol = tolerance(), near = q => dist(p, q) <= tol;
  const r = curRuler();
  if (r && mods.alt && (near(r.start) || near(r.end))){                  // :238-245 Alt＋端点 ⇒ 量角器
    if (near(r.end) && !near(r.start)){ const t = r.start; r.start = r.end; r.end = t; }
    r.protractor = [p[0], p[1]];
    setRuler(r); RulerTool.drag = 2;
  } else if (r && r.protractor && near(r.protractor)) RulerTool.drag = 2;     // :246
  else if (r && near(r.end)) RulerTool.drag = 1;                              // :247
  else if (r && near(r.start)) RulerTool.drag = 0;                            // :248
  else { setRuler({start:[p[0], p[1]], end:[p[0], p[1]], protractor:null}); RulerTool.drag = 'new'; }   // :249-252
  return RulerTool.drag;
}
function drag(p, mods){
  const d = RulerTool.drag, r = curRuler(); if (d === null || !r) return;
  if (d === 'new' || d === 1) r.end = constrain(r.start, p, mods.shift);       // :258
  else if (d === 0) r.start = constrain(r.end, p, mods.shift);                 // :259
  else r.protractor = constrain(r.start, p, mods.shift);                       // :260
  setRuler(r);
}
function release(){
  const d = RulerTool.drag; RulerTool.drag = null;
  const r = curRuler();
  if (d === 'new' && r && dist(r.start, r.end) < 0.5 && has('ps.image.analysis.rulerTool')) CMD.run('ps.image.analysis.rulerTool', {clear:true});   // :266-268
}

/* ───────── 命令（agent 与滑鼠同一条路）───────── */
const pt2 = v => Array.isArray(v) && v.length >= 2 && isFinite(v[0]) && isFinite(v[1]) ? [+v[0], +v[1]] : null;
CMD.reg('ruler.gesture', {i18n:'', params:'{from:[x,y], to:[x,y]|path:[[x,y]…], alt?:bool, shift?:bool, zoom?:缩放=目前} 文件坐标；跟人用标尺工具从 from 按下、拖到 to 放开完全一样'
  + '（按在端点 7 屏幕像素内＝拖那一端；Alt＋按在端点＝从那顶点拉量角器；Shift＝锁 45°；没拖开＝清除标尺；不进历史）→ {ok, drag, ruler, info}'}, p => {
  const a = pt2(p.from); if (!a) return {ok:false, error:'ruler.gesture: pass `from`: [x, y]'};
  const path = Array.isArray(p.path) ? p.path.map(pt2).filter(Boolean) : (pt2(p.to) ? [pt2(p.to)] : []);
  const z0 = window.UI ? UI.zoom : 1; if (isFinite(p.zoom) && p.zoom > 0 && window.UI) UI.zoom = +p.zoom;
  let d;
  try {
    const mods = {alt:!!p.alt, shift:!!p.shift};
    d = press(a, mods); path.forEach(q => drag(q, mods)); release();
  } finally { if (window.UI) UI.zoom = z0; }
  const r = curRuler();
  return {ok:true, drag:d, ruler:r, info:r ? rulerInfo(r, scaleOf()) : null};
});
CMD.reg('ruler.set', {i18n:'', params:'{start:[x,y], end:[x,y], protractor?:[x,y]|null} 直接放一条标尺（start＝量角器顶点；不进历史）→ {ok, ruler, info}'}, p => {
  const s = pt2(p.start), e = pt2(p.end); if (!s || !e) return {ok:false, error:'ruler.set: pass `start` and `end`'};
  return setRuler({start:s, end:e, protractor:p.protractor ? pt2(p.protractor) : null});
});
CMD.reg('ruler.clear', {i18n:'', params:'{} 选项栏「清除」：拿掉标尺线（不进历史）→ {ok, ruler:null}'}, () =>
  has('ps.image.analysis.rulerTool') ? CMD.run('ps.image.analysis.rulerTool', {clear:true}) : {ok:false, error:'ps.image.analysis.rulerTool missing'});
CMD.reg('ruler.info', {i18n:'', params:'{} 选项栏读数（照「使用测量比例」换算）→ {ok, ruler, readout:{x,y,w,h,angle,l1,l2,units,protractor}|null, useMeasurementScale}'}, () =>
  ({ok:true, ruler:curRuler(), readout:readout(), useMeasurementScale:RulerTool.useScale}));
CMD.reg('ruler.setOptions', {i18n:'', params:'{useMeasurementScale?:bool} 选项栏「使用测量比例」（只影响读数）→ {ok, useMeasurementScale}'}, p => {
  if (typeof p.useMeasurementScale === 'boolean') RulerTool.useScale = p.useMeasurementScale;
  if (window.UI && ToolState.cur === 'ruler') UI.buildOptions('ruler');
  return {ok:true, useMeasurementScale:RulerTool.useScale};
});
CMD.reg('ruler.straighten', {i18n:'', params:'{crop?:bool=(当前层是背景)} 选项栏「拉直图层」：按标尺线转到最近的水平／垂直（一步历史），之后标尺清掉 → 同 ps.image.analysis.straightenLayer'}, p => {
  if (!curRuler()) return {ok:false, error:'no ruler line'};
  if (!has('ps.image.analysis.straightenLayer')) return {ok:false, error:'ps.image.analysis.straightenLayer missing'};
  return CMD.run('ps.image.analysis.straightenLayer', typeof p.crop === 'boolean' ? {crop:p.crop} : {});
});

/* ───────── 工具 ───────── */
const fmt = v => v === null || v === undefined ? '' : v.toFixed(2);
function refreshBar(){
  const b = RulerTool.bar; if (!b || !b.x || !b.x.isConnected) return;
  const r = readout();
  for (const k of ['x', 'y', 'w', 'h', 'angle', 'l1', 'l2']){ const s = b[k]; if (s) s.textContent = r ? fmt(r[k]) : ''; }
  if (b.straighten) b.straighten.disabled = !r;
  if (b.clear) b.clear.disabled = !r;
}
Tools.reg({
  id:'ruler', icon:'📏', group:'misc', order:22, for:'raster', opts:[],
  hint:'ui.rulerHint',
  strings:{
    'zh-Hant':{ 'tool.ruler':'尺標工具', 'opt.rulerX':'X:', 'opt.rulerY':'Y:', 'opt.rulerW':'W:', 'opt.rulerH':'H:', 'opt.rulerA':'A:', 'opt.rulerL1':'L1:', 'opt.rulerL2':'L2:',
                'opt.rulerUseScale':'使用測量比例', 'ui.rulerStraighten':'拉直圖層', 'ui.rulerClear':'清除',
                'ui.rulerHint':'拖曳量距離與角度 · Shift 鎖 45° · 拖端點可調整 · Alt＋拖端點拉量角器' },
    'zh-Hans':{ 'tool.ruler':'标尺工具', 'opt.rulerX':'X:', 'opt.rulerY':'Y:', 'opt.rulerW':'W:', 'opt.rulerH':'H:', 'opt.rulerA':'A:', 'opt.rulerL1':'L1:', 'opt.rulerL2':'L2:',
                'opt.rulerUseScale':'使用测量比例', 'ui.rulerStraighten':'拉直图层', 'ui.rulerClear':'清除',
                'ui.rulerHint':'拖曳量距离与角度 · Shift 锁 45° · 拖端点可调整 · Alt＋拖端点拉量角器' },
    'en':     { 'tool.ruler':'Ruler Tool', 'opt.rulerX':'X:', 'opt.rulerY':'Y:', 'opt.rulerW':'W:', 'opt.rulerH':'H:', 'opt.rulerA':'A:', 'opt.rulerL1':'L1:', 'opt.rulerL2':'L2:',
                'opt.rulerUseScale':'Use Measurement Scale', 'ui.rulerStraighten':'Straighten Layer', 'ui.rulerClear':'Clear',
                'ui.rulerHint':'Drag to measure distance and angle · Shift: 45° steps · drag an end point to adjust · Alt-drag an end point for a protractor' }
  },
  buildOptions(box){
    const b = RulerTool.bar = {};
    const keys = [['x', 'rulerX'], ['y', 'rulerY'], ['w', 'rulerW'], ['h', 'rulerH'], ['angle', 'rulerA'], ['l1', 'rulerL1'], ['l2', 'rulerL2']];
    keys.forEach(([k, s]) => {
      const l = document.createElement('label'); l.style.cssText = 'gap:3px';
      const t = document.createElement('span'); t.textContent = Lang.t('opt.' + s); t.style.color = '#9aa3b0';
      const v = document.createElement('span'); v.dataset.ruler = k; v.style.cssText = 'font-family:monospace;min-width:52px;display:inline-block';
      l.appendChild(t); l.appendChild(v); box.appendChild(l); b[k] = v;
    });
    const cl = document.createElement('label'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.ruler = 'useScale'; cb.checked = RulerTool.useScale;
    cb.onchange = () => CMD.run('ruler.setOptions', {useMeasurementScale:cb.checked});
    const ct = document.createElement('span'); ct.textContent = Lang.t('opt.rulerUseScale'); cl.appendChild(cb); cl.appendChild(ct); box.appendChild(cl);
    const btn = (key, cmd) => { const x = document.createElement('button'); x.textContent = Lang.t('ui.' + key); x.dataset.ruler = key; x.onclick = () => { const r = CMD.run(cmd, {}); if (r && r.ok === false && window.console) console.warn(r.error); refreshBar(); }; box.appendChild(x); return x; };
    b.straighten = btn('rulerStraighten', 'ruler.straighten');
    b.clear = btn('rulerClear', 'ruler.clear');
    refreshBar();
  },
  onDown(e, pt){ press(pt, {alt:e.altKey, shift:e.shiftKey}); refreshBar(); UI.draw(); },
  onMove(e, pt, P){ if (!P.down || RulerTool.drag === null) return; drag(pt, {alt:e.altKey, shift:e.shiftKey}); refreshBar(); UI.draw(); },
  onUp(e, pt){ release(); refreshBar(); UI.draw(); },
  onDeactivate(){ RulerTool.drag = null; },
  /* :348-366 draw_overlay：只在标尺工具作用中画 */
  drawOverlay(ctx, s){
    refreshBar();
    const r = curRuler(); if (!r) return;
    const d = Math.min(window.devicePixelRatio || 1, 2), P = q => [Math.floor(q[0] * s) + 0.5, Math.floor(q[1] * s) + 0.5];   // 对齐像素中心，1px 白线才不糊成两行灰
    const segs = [[P(r.start), P(r.end)]]; if (r.protractor) segs.push([P(r.start), P(r.protractor)]);
    const line = (a, b, w, c) => { ctx.lineWidth = w * d; ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
    const handle = p => { for (const [w, c] of [[3, '#000'], [1, '#fff']]){ line([p[0] - 5 * d, p[1]], [p[0] + 5 * d, p[1]], w, c); line([p[0], p[1] - 5 * d], [p[0], p[1] + 5 * d], w, c); } };
    ctx.save(); ctx.setLineDash([]); ctx.lineCap = 'butt';
    for (const sg of segs){ line(sg[0], sg[1], 3, 'rgba(0,0,0,0.63)'); line(sg[0], sg[1], 1, '#fff'); handle(sg[1]); }
    handle(P(r.start));
    ctx.restore();
  }
});
/* 菜单的标尺／计数面板开着时，menus/impl/ps-image.js 的画布捕获监听看到手上是标尺／计数工具就让开 ⇒ 按下照常交给这颗工具 */
})();
