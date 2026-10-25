/* 堤麟画板 · PS 钢笔／形状工具的「形状／路径／像素」模式（选项栏最前面那个下拉）
   原码：photocraft ui-egui/src/vector_ui.rs
     157-190 pen_commit：Path 模式＝path.set work（工作路径）、Shape 模式＝shape.create（形状层）
     386-399 options_bar：钢笔下拉 Path｜Shape；形状工具只有 Shape、填色勾＋前景色、描边宽
   原码没有、照 PS 2020 补的：
     形状工具也有「路径／像素」；像素＝直接画进当前像素层（前景色）；弯度钢笔／自由钢笔也认路径模式；
     形状模式的选项栏：填充色＋「无」、描边色＋「无」、描边宽（跟右下颜色面板同一组值：#fillColor／#strokeColor／#strokeW／Toolbar.fillNone）；
     路径模式的选项栏：建立：选区…／蒙版／形状；画好的路径进路径面板的「工作路径」（ps-window.js 路径段：填充／描边／载入选区／存储路径都在那）；
     路径模式下 Ctrl+Enter＝把工作路径载入为选区；选中的工作路径在画面上描一条细线（路径面板没开也看得到）。
   做法：工具照旧下它的建立命令（rect.drag、shape.bezier、freeformpen.draw…），这里在 CMD.redirects 接手：
     先照跑（会在矢量层生出形状），量出新生的形状 → 拿掉（新建的空矢量层也拿掉、当前层还原）→ 换成工作路径的子路径，或画进当前像素层。
     一个命令＝一步历史（工作路径随历史走：ps-type.js 的历史垫片）。弯度钢笔是每点一下改同一条，路径模式由 curvaturepen.js 自己写工作路径。
   只在 PS 版面（工具列不是 AI 版面）、目前工具是这几颗时才生效；agent 直接下命令可带 vecMode:"shape|path|pixels" 指定。
   另照 PS 2020 补：
     路径模式钢笔改工作路径：工作路径被选著时，钢笔的事件期间把它当虚拟矢量层（__work）⇒ 点端点接着画、自动添加／删除、Ctrl 直接选择、Alt 转换点都作用在它上面（withWork）；
     像素模式选项栏：模式／不透明度／消除锯齿（VecMode.pix，vecmode.set 也收）；
     形状模式选项栏改填色／描边／宽＝同时改当前形状层（vecmode.applyStyle，一步历史；AI 版面也出这组控件，接在工具自己的选项后面）。 */
(function(){
'use strict';
if (window.VecMode) return;
const L3 = (a, b, c) => (typeof Lang !== 'undefined' && Lang.cur === 'en') ? c : (typeof Lang !== 'undefined' && Lang.cur === 'zh-Hans') ? b : a;
const PEN_TOOLS = ['pen', 'freeformpen', 'curvaturepen'], SHAPE_TOOLS = ['rect', 'ellipse', 'star', 'line', 'customshape'];
const CREATE = {'shape.bezier':'pen', 'freeformpen.draw':'freeformpen', 'rect.drag':'rect', 'rect.dialog':'rect', 'ellipse.drag':'ellipse', 'ellipse.create':'ellipse',
                'star.drag':'star', 'star.create':'star', 'line.drag':'line', 'line.dialog':'line', 'customshape.place':'customshape'};
const isPS = () => !(window.Toolbar && Toolbar.state && Toolbar.state().layout === 'ai');
const MODES = ['shape', 'path', 'pixels'];

const VecMode = window.VecMode = {
  modes:{},                                                       // 工具 id → 'shape'|'path'|'pixels'（PS 每颗工具各记各的）
  lastSW:3,
  pix:{blend:'normal', opacity:100, antiAlias:true},              // 像素模式选项栏：模式／不透明度／消除锯齿
  okFor(id, m){ return m === 'shape' || m === 'path' || (m === 'pixels' && SHAPE_TOOLS.includes(id)); },
  get(id){ id = id || ToolState.cur; const m = this.modes[id] || 'shape'; return this.okFor(id, m) ? m : 'shape'; },
  applies(id){ id = id || ToolState.cur; return (PEN_TOOLS.includes(id) || SHAPE_TOOLS.includes(id)) && isPS(); },
  current(){ return this.applies() ? this.get() : 'shape'; },
};

/* ── 命令 ── */
CMD.reg('vecmode.set', {i18n:'', params:'{mode?:"shape|path|pixels", tool?:工具 id（缺省＝目前工具）, blend?, opacity?:0..100, antiAlias?:bool（像素模式选项）} PS 钢笔／形状工具选项栏的模式（像素只给形状工具）→ {ok, tool, mode, pix}'}, p => {
  p = p || {};
  if (p.blend !== undefined){ if (!PIX_BLENDS.includes(p.blend)) return {ok:false, error:'vecmode.set: blend must be one of ' + PIX_BLENDS.join('|')}; VecMode.pix.blend = p.blend; }
  if (p.opacity !== undefined){ const o = +p.opacity; if (!isFinite(o)) return {ok:false, error:'vecmode.set: opacity 0..100'}; VecMode.pix.opacity = Math.max(0, Math.min(100, o)); }
  if (p.antiAlias !== undefined) VecMode.pix.antiAlias = !!p.antiAlias;
  if (p.mode === undefined) return {ok:true, tool:ToolState.cur, mode:VecMode.current(), pix:Object.assign({}, VecMode.pix)};
  const id = p.tool || ToolState.cur, m = p.mode;
  if (!PEN_TOOLS.includes(id) && !SHAPE_TOOLS.includes(id)) return {ok:false, error:`vecmode.set: ${id} has no Shape/Path/Pixels mode`};
  if (!MODES.includes(m) || !VecMode.okFor(id, m)) return {ok:false, error:`vecmode.set: mode must be ${SHAPE_TOOLS.includes(id) ? 'shape|path|pixels' : 'shape|path'}`};
  VecMode.modes[id] = m;
  if (window.UI && ToolState.cur === id) UI.buildOptions(id);
  return {ok:true, tool:id, mode:m, pix:Object.assign({}, VecMode.pix)};
});
CMD.reg('vecmode.state', {i18n:'', params:'{} → {tool, mode, applies, modes}'}, () => ({ok:true, tool:ToolState.cur, mode:VecMode.current(), applies:VecMode.applies(), modes:Object.assign({}, VecMode.modes)}));

/* 形状（图层坐标）→ 文件坐标的子路径（编组往下走；照 ps-window.js pathSubpaths） */
function subpathsOf(L, s, out){
  if (s.visible === false) return;
  if (Array.isArray(s.children)){ s.children.forEach(c => subpathsOf(L, c, out)); return; }
  const v = window.VecSel ? VecSel.asBezier(s) : (s.type === 'bezier' ? s : null);
  if (!v || !v.anchors || v.anchors.length < 2) return;
  const dx = L.x || 0, dy = L.y || 0, mv = q => q ? [q[0] + dx, q[1] + dy] : null;
  out.push({closed:!!v.closed, anchors:v.anchors.map(a => ({x:a.x + dx, y:a.y + dy, in:mv(a.in), out:mv(a.out)}))});
}
const paths = () => window.PsWindow && PsWindow.paths;
function refreshPanels(){ if (window.DlPanels && DlPanels.schedule) DlPanels.schedule('doc'); }
/* 加进工作路径：工作路径正被选著＝加一条子路径（PS），不然换一条新的工作路径 */
function addToWork(subs){
  const ps = paths(), keep = Doc.workPath && Array.isArray(Doc.workPath.subpaths) && (!ps || ps.sel === 'work' || ps.sel === null);
  const w = keep ? Doc.workPath : {layerId:null, subpaths:[]};
  const index = w.subpaths.length;
  w.subpaths.push(...subs); Doc.workPath = w;
  if (ps) ps.sel = 'work';
  refreshPanels();
  return index;
}
VecMode.addToWork = addToWork;

/* ═════ 工作路径当一个「虚拟矢量层」（id __work，不在 Doc.layers、不进历史快照）给钢笔编辑 ═════
   PS：路径模式下钢笔可点工作路径的端点接着画、自动添加／删除锚点、Ctrl＝直接选择、Alt＝转换点，都作用在工作路径上。
   本画板这些功能（pen.js 的 Pen／PenAuto、Direct、AnchorPt、addanchor／delanchor 命令）都是对「当前矢量层的形状」做的 ⇒
   钢笔的滑鼠／键盘事件期间把 Doc.active() 暂时指到虚拟层（Doc.byId('__work') 一直认得它），它们就原样作用在工作路径上；
   事件里有命令进了历史，就把虚拟层写回 Doc.workPath（历史快照在命令前拍、拍到的是旧的工作路径 ⇒ Ctrl+Z 退得回）。
   预览（拖把手中）只改虚拟层、不写回。 */
const WORK_ID = '__work';
const WL = {id:WORK_ID, kind:'vector', name:'Work Path', visible:true, opacity:1, blend:'normal', x:0, y:0, data:{shapes:[]}, _work:true, _sigSkip:true};
let wlJSON = null, wlIds = [], inWork = 0, curPt = null;
const subsJSON = () => JSON.stringify((Doc.workPath && Array.isArray(Doc.workPath.subpaths)) ? Doc.workPath.subpaths : []);
function wlBuild(){
  const j = subsJSON(); if (j === wlJSON) return;
  const subs = JSON.parse(j);
  WL.data.shapes = subs.map((sp, i) => ({id:wlIds[i] || ('W' + Math.random().toString(36).slice(2, 9)), type:'bezier', anchors:sp.anchors, closed:!!sp.closed, fill:'none', stroke:'none', strokeWidth:0}));
  wlIds = WL.data.shapes.map(s => s.id); wlJSON = j;
}
function wlSync(){
  const keep = WL.data.shapes.filter(s => s && s.type === 'bezier' && Array.isArray(s.anchors) && s.anchors.length);
  const subs = keep.map(s => ({closed:!!s.closed, anchors:JSON.parse(JSON.stringify(s.anchors))}));
  const j = JSON.stringify(subs); if (j === wlJSON) return;
  if (subs.length){ Doc.workPath = Object.assign({layerId:null}, Doc.workPath || {}, {subpaths:subs}); const ps = paths(); if (ps) ps.sel = 'work'; }
  else Doc.workPath = undefined;
  wlIds = keep.map(s => s.id); wlJSON = subsJSON();
  refreshPanels();
}
VecMode.workLayer = () => { wlBuild(); return WL; };
const byId0 = Doc.byId;
Doc.byId = function(id){ if (id === WORK_ID){ if (!inWork) wlBuild(); return (Doc.workPath && Doc.workPath.subpaths && Doc.workPath.subpaths.length) || inWork ? WL : null; } return byId0.apply(this, arguments); };
/* 钢笔在路径模式、工作路径被选著（路径面板）时才改工作路径；没被选著＝画一条新的工作路径（照 PS） */
function workActive(){
  if (ToolState.cur !== 'pen' || VecMode.current() !== 'path') return false;
  const ps = paths();
  return !!(Doc.workPath && Array.isArray(Doc.workPath.subpaths) && Doc.workPath.subpaths.length && (!ps || ps.sel === 'work'));
}
function withWork(fn, force){
  if (inWork || !(force ? workShown() : workActive())) return fn();
  wlBuild();
  const a0 = Doc.active, r0 = window.UI && UI.refresh, top0 = History.past[History.past.length - 1], n0 = History.past.length;
  let refresh = false;
  Doc.active = () => WL; inWork++;
  if (r0) UI.refresh = function(){ refresh = true; };                 // 事件中途别重画面板／换工具列版面（当前层其实还是原来那层）
  try { return fn(); }
  finally {
    inWork--; Doc.active = a0; if (r0) UI.refresh = r0;
    if (History.past.length !== n0 || History.past[History.past.length - 1] !== top0) wlSync();
    if (refresh && window.UI) UI.refresh();
  }
}
VecMode.withWork = withWork;
/* 钢笔「接着画」：原码只认刚画好、而且是这层最上面那条；工作路径上照 PS 认任何一条开放子路径的端点（滑鼠下那条） */
function hookPen(){
  const T = Tools.get('pen'); if (!T || T.__vmWork || !window.Pen) return; T.__vmWork = true;
  ['onDown', 'onMove', 'onUp', 'onDblClick', 'onKey', 'onUndoKey', 'drawOverlay'].forEach(k => {
    const f = T[k]; if (typeof f !== 'function') return;
    T[k] = function(e, pt){ if (Array.isArray(pt)) curPt = pt; const a = arguments; return withWork(() => f.apply(this, a)); };
  });
  const de = T.onDeactivate;
  T.onDeactivate = function(){ const r = withWork(() => de ? de.apply(this, arguments) : undefined); if (window.VecSel && VecSel.layerId === WORK_ID) VecSel.clear(); return r; };
  const c0 = Pen.continuable;
  Pen.continuable = function(){
    if (!inWork) return c0.apply(this, arguments);
    const p = curPt || this.hover, tol = this.tol(); if (!p) return null;
    let best = null, bd = tol;
    for (const s of WL.data.shapes){
      if (s.type !== 'bezier' || s.closed || !s.anchors || !s.anchors.length) continue;
      const f = s.anchors[0], l = s.anchors[s.anchors.length - 1];
      for (const q of [f, l]){ const d = Math.hypot(q.x - p[0], q.y - p[1]); if (d <= bd){ bd = d; best = s; } }
    }
    if (!best) return null;
    const f = best.anchors[0], l = best.anchors[best.anchors.length - 1];
    return {L:WL, s:best, first:[f.x, f.y], last:[l.x, l.y]};
  };
  document.addEventListener('keyup', e => { if (ToolState.cur === 'pen' && ['Control', 'Meta', 'Alt', 'Shift'].includes(e.key) && workActive()) withWork(() => PenAuto.modKey(e)); });
}
hookPen();
window.addEventListener('DOMContentLoaded', hookPen);

/* 直接选择工具单独用、路径选择工具按住 Ctrl（PS：暂时变直接选择）：工作路径在路径面板被选著（画面上看得到）时，
   点到它的把手／锚点／线段 ⇒ 这一下改工作路径；当前层不是形状层、或工作路径的锚点正选著时，点空白（框选）也算工作路径。
   不管是不是钢笔、是不是路径模式（PS 直接选择本来就认画面上的工作路径）。 */
function workShown(){
  const ps = paths();
  return !!(isPS() && Doc.workPath && Array.isArray(Doc.workPath.subpaths) && Doc.workPath.subpaths.length && (!ps || ps.sel === 'work' || ps.sel === null));
}
function directOnWork(pt){
  if (!workShown() || !window.Direct || !window.VecSel) return false;
  const hitWork = withWork(() => !!((VecSel.layerId === WORK_ID && Direct.hitHandle(pt, VecSel.tol(4))) || Direct.hitAnchor(WL, pt, VecSel.tol(4)) || Direct.hitTest(WL, pt, VecSel.tol(3))), true);
  if (hitWork) return true;
  const L = Direct.vecLayer();
  if (!L) return true;
  if ((VecSel.layerId === L.id && Direct.hitHandle(pt, VecSel.tol(4))) || Direct.hitAnchor(L, pt, VecSel.tol(4)) || Direct.hitTest(L, pt, VecSel.tol(3))) return false;
  return VecSel.layerId === WORK_ID;
}
VecMode.directOnWork = directOnWork;
function hookDirect(){
  const T = Tools.get('direct'); if (!T || T.__vmWork || !window.Direct) return; T.__vmWork = true;
  let g = false;                                                   // 这一下（按下到放开）是不是改工作路径
  const run = (on, f, self, a) => on ? withWork(() => f.apply(self, a), true) : f.apply(self, a);
  const d0 = T.onDown, m0 = T.onMove, u0 = T.onUp, k0 = T.onKey, o0 = T.drawOverlay, x0 = T.onDeactivate;
  T.onDown = function(e, pt){ g = directOnWork(pt); return run(g, d0, this, arguments); };
  T.onMove = function(){ return run(g, m0, this, arguments); };
  T.onUp = function(){ const r = run(g, u0, this, arguments); g = false; return r; };
  if (k0) T.onKey = function(){ return run(VecSel.layerId === WORK_ID && workShown(), k0, this, arguments); };
  if (o0) T.drawOverlay = function(){ return run((g || VecSel.layerId === WORK_ID) && workShown(), o0, this, arguments); };
  T.onDeactivate = function(){ g = false; const r = x0 ? x0.apply(this, arguments) : undefined; if (window.VecSel && VecSel.layerId === WORK_ID) VecSel.clear(); return r; };
}
function hookPathSel(){
  const T = Tools.get('pathselect'), D = Tools.get('direct'); if (!T || !D || T.__vmDirect) return; T.__vmDirect = true;
  let via = false;                                                 // 这一下按着 Ctrl ＝ 交给直接选择
  const d0 = T.onDown, m0 = T.onMove, u0 = T.onUp, o0 = T.drawOverlay;
  T.onDown = function(e, pt){
    via = !!((e.ctrlKey || e.metaKey) && (e.button === undefined || e.button === 0));
    if (via){ hookDirect(); return D.onDown(e, pt); }
    return d0.apply(this, arguments);
  };
  T.onMove = function(e, pt, P){ return via ? D.onMove(e, pt, P) : m0.apply(this, arguments); };
  T.onUp = function(e, pt){ if (via){ via = false; return D.onUp(e, pt); } return u0.apply(this, arguments); };
  T.drawOverlay = function(ctx, s){ const r = o0 ? o0.apply(this, arguments) : undefined; if (via || (window.VecSel && VecSel.layerId === WORK_ID && VecSel.shapes.length)) D.drawOverlay(ctx, s); return r; };
}
hookDirect(); hookPathSel();
window.addEventListener('DOMContentLoaded', () => { hookDirect(); hookPathSel(); });

/* 跑建立命令、把新生的形状改成工作路径／像素 */
function convert(id, base, q, m){
  const before = new Map(Doc.layers.map(L => [L.id, L.kind === 'vector' ? new Set(L.data.shapes.map(s => s.id)) : null]));
  const act0 = Doc.activeId, act0L = Doc.byId(act0);
  if (m === 'pixels' && !(act0L && act0L.kind === 'raster')) return {ok:false, error:L3('像素模式要畫在像素圖層上（在圖層面板選一個像素圖層）', '像素模式要画在像素图层上（在图层面板选一个像素图层）', 'Pixels mode draws into a pixel layer (select one in the Layers panel)')};
  if (m === 'pixels' && act0L.locks && (act0L.locks.all || act0L.locks.pixels)) return {ok:false, error:`layer "${act0L.name}" is locked`};
  const r = base.run(Object.assign({}, q, {vecMode:undefined}));
  if (r && r.ok === false) return r;
  const made = [];
  Doc.layers.forEach(L => { if (L.kind !== 'vector') return; const old = before.get(L.id); L.data.shapes.filter(s => !old || !old.has(s.id)).forEach(s => made.push({L, s})); });
  if (!made.length) return r;
  const subs = [], tmp = Layer.vector('tmp');
  made.forEach(({L, s}) => {
    subpathsOf(L, s, subs);
    const c = JSON.parse(JSON.stringify(s)); shiftShape(c, L.x || 0, L.y || 0);      // 暂时层在 (0,0)：形状搬成文件坐标
    tmp.data.shapes.push(c);
    L.data.shapes.splice(L.data.shapes.indexOf(s), 1); Layer.invalidate(L);
  });
  Doc.layers.filter(L => !before.has(L.id) && L.kind === 'vector' && !L.data.shapes.length).forEach(L => Doc.remove(L.id));
  if (Doc.byId(act0)) Doc.activeId = act0;
  if (window.VecSel) VecSel.clear();
  if (m === 'path'){
    if (!subs.length) return {ok:false, error:'nothing to make a path from'};
    const index = addToWork(subs);
    wlBuild();                                                     // 新的子路径＝已选（PS：画好就是选中的路径；钢笔可接着画、自动加删）
    const wid = wlIds[index];
    if (wid && window.VecSel) VecSel.setShapes(WORK_ID, [wid]);
    return {ok:true, mode:'path', workPath:true, index, subpaths:subs.length, id:wid, layerId:WORK_ID};
  }
  // 像素：照形状的样子（前景色填色／描边）画进当前像素层；选项栏的模式／不透明度／消除锯齿（PS）
  let img = renderLayer(tmp, 1); const L = Doc.byId(act0), px = VecMode.pix;
  if (!px.antiAlias){
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height); for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] >= 128 ? 255 : 0; x.putImageData(d, 0, 0); img = c;
  }
  const ctx = L.data.ctx, a = Math.max(0, Math.min(100, px.opacity)) / 100;
  if (px.blend === 'behind' || px.blend === 'clear'){               // 背后＝只画在透明处；清除＝照形状擦成透明
    ctx.save(); ctx.globalAlpha = a; ctx.globalCompositeOperation = px.blend === 'behind' ? 'destination-over' : 'destination-out';
    ctx.drawImage(img, -(L.x || 0), -(L.y || 0)); ctx.restore();
  } else blendDraw(ctx, img, -(L.x || 0), -(L.y || 0), px.blend, a);
  Layer.invalidate(L);
  return {ok:true, mode:'pixels', layer:L.id, blend:px.blend, opacity:px.opacity, antiAlias:px.antiAlias};
}
CMD.redirects.push((id, p) => {
  const tool = CREATE[id]; if (!tool || inWork) return null;            // 正在改工作路径（虚拟层）：照原命令画进它
  const forced = p && MODES.includes(p.vecMode) ? p.vecMode : null;
  const m = forced || (VecMode.applies() && (ToolState.cur === tool || (tool === 'pen' && PEN_TOOLS.includes(ToolState.cur))) ? VecMode.get() : 'shape');
  if (m === 'shape' || (m === 'pixels' && !SHAPE_TOOLS.includes(tool))) return null;
  const base = CMD.map[id]; if (!base) return null;
  return {undoable:true, run:q => convert(id, base, q || {}, m)};
});

/* 路径模式选项栏「建立：形状」：工作路径变成一个形状层（用目前的填色／描边；工作路径留着，照 PS） */
CMD.reg('ps.path.makeShape', {i18n:'', undoable:true, params:'{path?:"work"（缺省＝工作路径）} 路径模式选项栏「建立：形状」：用目前填色／描边把工作路径做成形状层（矢量层）→ {ok, id}'}, () => {
  const w = Doc.workPath; if (!w || !Array.isArray(w.subpaths) || !w.subpaths.length) return {ok:false, error:'no work path'};
  let fill = UI.fill(), stroke = UI.stroke(), sw = UI.strokeW();
  if ((!fill || fill === 'none') && (!stroke || stroke === 'none')){ stroke = '#000000'; sw = sw || 1; }
  let n = 1; while (Doc.layers.some(L => L.name === L3('形狀 ', '形状 ', 'Shape ') + n)) n++;
  const L = Layer.vector(L3('形狀 ', '形状 ', 'Shape ') + n);
  w.subpaths.forEach(sp => L.data.shapes.push({id:'S' + Math.random().toString(36).slice(2, 9), type:'bezier', anchors:JSON.parse(JSON.stringify(sp.anchors)), closed:!!sp.closed, fill:fill || 'none', stroke:stroke || 'none', strokeWidth:sw || 0}));
  Doc.add(L);
  return {ok:true, id:L.id};
});

/* ── 选项栏 ── */
function setColor(id, v){ const e = document.getElementById(id); if (!e) return; e.value = v; e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); }
/* 形状模式选项栏改填色／描边＝同时改当前选中的形状层（PS）：当前层是矢量层时，有选到的形状＝那几个、没有＝这层全部 */
function styleTargets(){
  const L = Doc.active(); if (!L || L.kind !== 'vector' || L._work) return null;
  const sel = (window.VecSel && VecSel.layerId === L.id) ? VecSel.shapes.filter(id => L.data.shapes.some(s => s.id === id)) : [];
  const ids = sel.length ? sel.slice() : L.data.shapes.map(s => s.id);
  return ids.length ? {L, ids} : null;
}
CMD.reg('vecmode.applyStyle', {i18n:'', undoable:true, params:'{fill?:"#rrggbb"|"none", stroke?:"#rrggbb"|"none", strokeWidth?:px, layerId?, ids?:[形状 id]} 形状模式选项栏改填色／描边／描边宽＝同时改当前选中的形状层（缺省：选到的形状，没选＝这层全部）；一步历史 → {ok, n}'}, p => {
  p = p || {};
  const L = p.layerId ? Doc.byId(p.layerId) : Doc.active(); if (!L || L.kind !== 'vector' || L._work) return {ok:false, error:'vecmode.applyStyle: the current layer is not a shape layer'};
  if (L.locks && L.locks.all) return {ok:false, error:`layer "${L.name}" is locked`};
  const t = styleTargets(), ids = Array.isArray(p.ids) ? p.ids : (t && t.L === L ? t.ids : L.data.shapes.map(s => s.id));
  let n = 0;
  L.data.shapes.forEach(sh => {
    if (!ids.includes(sh.id)) return;
    if (p.fill !== undefined) sh.fill = p.fill;
    if (p.stroke !== undefined) sh.stroke = p.stroke;
    if (p.strokeWidth !== undefined && isFinite(+p.strokeWidth)) sh.strokeWidth = Math.max(0, +p.strokeWidth);
    n++;
  });
  if (!n) return {ok:false, error:'vecmode.applyStyle: nothing to restyle'};
  Layer.invalidate(L); return {ok:true, n, layerId:L.id};
});
/* 拖颜色挑选器（input 事件）时形状层即时跟着变（PS）：只改画面、不进历史；放开（change）先还原再正式下 vecmode.applyStyle ⇒ 一步历史 */
let live = null;                                                   // {L, orig:{形状 id → {fill, stroke, strokeWidth}}}
function livePreview(patch){
  const t = styleTargets(); if (!t || (t.L.locks && t.L.locks.all)) return;
  if (!live || live.L !== t.L){ unpreview(); live = {L:t.L, orig:{}}; t.L.data.shapes.forEach(sh => { if (t.ids.includes(sh.id)) live.orig[sh.id] = {fill:sh.fill, stroke:sh.stroke, strokeWidth:sh.strokeWidth}; }); }
  t.L.data.shapes.forEach(sh => { if (live.orig[sh.id]) Object.assign(sh, patch); });
  Layer.invalidate(t.L); if (window.UI) UI.draw();
}
function unpreview(){
  if (!live) return; const {L, orig} = live; live = null;
  L.data.shapes.forEach(sh => { if (orig[sh.id]) Object.assign(sh, orig[sh.id]); });
  Layer.invalidate(L);
}
VecMode.livePreview = livePreview;
function applyStyle(p){ unpreview(); if (!styleTargets()) return; const r = CMD.run('vecmode.applyStyle', p); if (r && r.ok === false && window.Locks && Locks.notify) Locks.notify(r.error); if (window.UI) UI.draw(); }
/* 像素模式的「模式」：PS 2020 图层混合的 27 种（engine.js BLENDS，同 PS 选单顺序）＋绘画专用的「背后」「清除」（PS 排在溶解后面） */
const PIX_EXTRA = {behind:['背後', '背后', 'Behind'], clear:['清除', '清除', 'Clear']};
const PIX_BLENDS = BLENDS.slice(0, 2).concat(['behind', 'clear'], BLENDS.slice(2));
const PIX_SEP = new Set(['darken', 'lighten', 'overlay', 'difference', 'hue']);   // 这几项前面画分隔线（PS 选单分组）
const blendLabel = v => PIX_EXTRA[v] ? L3(...PIX_EXTRA[v]) : Lang.t('blend.' + v);
let barKey = '';
const keyOf = id => [id, VecMode.applies(id), !!styleTargets(), VecMode.get(id)].join('|');
/* 当前层换了（PS⇄AI 版面、像素层⇄形状层）：选项栏跟着重建（只有这几颗工具、而且状态真的变了才重建） */
function hookRefresh(){
  if (!window.UI || UI.__vmRefresh) return; UI.__vmRefresh = true;
  const r0 = UI.refresh;
  UI.refresh = function(){ const r = r0.apply(this, arguments); try { const id = ToolState.cur; if ((PEN_TOOLS.includes(id) || SHAPE_TOOLS.includes(id)) && keyOf(id) !== barKey) UI.buildOptions(id); } catch (e){} return r; };
}
window.addEventListener('DOMContentLoaded', () => setTimeout(hookRefresh, 0));
function bar(box, id){
  barKey = keyOf(id);
  const ps = VecMode.applies(id);
  const styleOnly = !ps && (PEN_TOOLS.includes(id) || SHAPE_TOOLS.includes(id)) && !!styleTargets();   // AI 版面（当前层是形状层）：只出填色／描边
  if (!ps && !styleOnly) return;
  const wrap = document.createElement('span'); wrap.className = 'vecmode'; wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-right:10px;flex-shrink:0;white-space:nowrap';
  if (ps){
    const sel = document.createElement('select'); sel.dataset.k = 'vecMode';
    [['shape', L3('形狀', '形状', 'Shape')], ['path', L3('路徑', '路径', 'Path')], ['pixels', L3('像素', '像素', 'Pixels')]].forEach(([v, t]) => {
      if (!VecMode.okFor(id, v)) return; const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
    sel.value = VecMode.get(id);
    sel.onchange = () => CMD.run('vecmode.set', {tool:id, mode:sel.value});
    wrap.appendChild(sel);
  }
  const lab = t => { const s = document.createElement('span'); s.textContent = t; s.style.color = '#aab'; wrap.appendChild(s); return s; };
  const chk = (k, on, text) => { const c = document.createElement('input'); c.type = 'checkbox'; c.dataset.k = k; c.checked = on; const l = document.createElement('label'); l.style.cssText = 'display:inline-flex;align-items:center;gap:2px;cursor:pointer'; l.appendChild(c); l.appendChild(document.createTextNode(text)); wrap.appendChild(l); return c; };
  const m = ps ? VecMode.get(id) : 'shape';
  if (m === 'shape'){
    lab(L3('填色：', '填充：', 'Fill:'));
    const fc = document.createElement('input'); fc.type = 'color'; fc.dataset.k = 'vmFill'; fc.value = (document.getElementById('fillColor') || {}).value || '#000000';
    wrap.appendChild(fc);
    const fn = chk('vmFillNone', !!(window.Toolbar && Toolbar.fillNone), L3('無', '无', 'None'));
    const fset = () => { setColor('fillColor', fc.value); if (window.Toolbar){ Toolbar.fillNone = false; fn.checked = false; } };
    fc.oninput = () => { fset(); livePreview({fill:fc.value}); };
    fc.onchange = () => { fset(); applyStyle({fill:fc.value}); };
    fn.onchange = () => { if (window.Toolbar) Toolbar.fillNone = fn.checked; applyStyle({fill:fn.checked ? 'none' : fc.value}); if (window.UI) UI.draw(); };
    lab(L3('筆畫：', '描边：', 'Stroke:'));
    const sc = document.createElement('input'); sc.type = 'color'; sc.dataset.k = 'vmStroke'; sc.value = (document.getElementById('strokeColor') || {}).value || '#000000';
    wrap.appendChild(sc);
    const swEl = document.getElementById('strokeW'), sw0 = swEl ? +swEl.value || 0 : 0;
    const sn = chk('vmStrokeNone', sw0 <= 0, L3('無', '无', 'None'));
    const w = document.createElement('input'); w.type = 'number'; w.min = 0; w.max = 288; w.step = 'any'; w.dataset.k = 'vmStrokeW'; w.value = sw0; w.style.width = '52px';
    const setW = v => { if (swEl){ swEl.value = v; swEl.dispatchEvent(new Event('input', {bubbles:true})); swEl.dispatchEvent(new Event('change', {bubbles:true})); } };
    const sset = () => { setColor('strokeColor', sc.value); if (sn.checked){ sn.checked = false; const v = VecMode.lastSW || 1; w.value = v; setW(v); } };
    sc.oninput = () => { sset(); livePreview({stroke:sc.value, strokeWidth:+w.value}); };
    sc.onchange = () => { sset(); applyStyle({stroke:sc.value, strokeWidth:+w.value}); };
    sn.onchange = () => {
      if (sn.checked){ if (+w.value > 0) VecMode.lastSW = +w.value; w.value = 0; setW(0); applyStyle({stroke:'none'}); }
      else { const v = VecMode.lastSW || 1; w.value = v; setW(v); applyStyle({stroke:sc.value, strokeWidth:v}); } };
    w.onchange = () => { const v = Math.max(0, Math.min(288, +w.value || 0)); w.value = v; if (v > 0) VecMode.lastSW = v; sn.checked = v <= 0; setW(v); applyStyle(v > 0 ? {stroke:sc.value, strokeWidth:v} : {stroke:'none'}); };
    /* 照 PS：描边宽可拖——拖「宽度」标签左右改值（Shift ×10）、▾ 弹出滑杆；拖动中形状层即时变（不进历史），放开记一步 */
    const wv = v => Math.max(0, Math.min(288, Math.round(v * 10) / 10));
    const wLive = v => { v = wv(v); w.value = v; sl.value = v; livePreview(v > 0 ? {stroke:sc.value, strokeWidth:v} : {stroke:'none'}); };
    const wDone = () => w.onchange();
    const scrub = lab(L3('寬度：', '宽度：', 'Width:')); scrub.dataset.k = 'vmStrokeWScrub'; scrub.style.cursor = 'ew-resize'; scrub.style.userSelect = 'none';
    scrub.title = L3('左右拖曳改寬度（Shift ×10）', '左右拖动改宽度（Shift ×10）', 'Drag left/right to change (Shift ×10)');
    scrub.onpointerdown = ev => {
      ev.preventDefault(); const x0 = ev.clientX, v0 = +w.value || 0; let moved = false;
      const mv = e2 => { const d = e2.clientX - x0; if (!moved && Math.abs(d) < 1) return; moved = true; wLive(v0 + d * (e2.shiftKey ? 10 : 1)); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (moved) wDone(); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    };
    wrap.appendChild(w); lab('px');
    const sl = document.createElement('input'); sl.type = 'range'; sl.min = 0; sl.max = 288; sl.step = 0.5; sl.value = sw0; sl.dataset.k = 'vmStrokeWSlider'; sl.style.cssText = 'width:120px;display:none';
    sl.oninput = () => wLive(+sl.value); sl.onchange = wDone;
    const dd = document.createElement('button'); dd.type = 'button'; dd.dataset.act = 'vmStrokeWDrop'; dd.textContent = '▾'; dd.style.cssText = 'padding:0 4px';
    dd.onclick = () => { sl.style.display = sl.style.display === 'none' ? '' : 'none'; };
    wrap.appendChild(dd); wrap.appendChild(sl);
  } else if (m === 'path'){
    lab(L3('製作：', '建立：', 'Make:'));
    const b = (k, t, fn) => { const e = document.createElement('button'); e.type = 'button'; e.dataset.act = k; e.textContent = t; e.onclick = () => { const r = fn(); if (r && r.ok === false && window.Locks && Locks.notify) Locks.notify(r.error); if (window.UI) UI.refresh(); }; wrap.appendChild(e); };
    b('vmSel', L3('選取範圍…', '选区…', 'Selection…'), () => CMD.run('ps.path.toSelection', {path:'work'}));
    b('vmMask', L3('遮色片', '蒙版', 'Mask'), () => CMD.run('ps.path.vectorMask', {path:'work'}));
    b('vmShape', L3('形狀', '形状', 'Shape'), () => CMD.run('ps.path.makeShape', {}));
  } else {
    // 像素模式（PS）：模式／不透明度／消除锯齿
    lab(L3('模式：', '模式：', 'Mode:'));
    const bs = document.createElement('select'); bs.dataset.k = 'vmBlend';
    PIX_BLENDS.forEach(v => {
      if (PIX_SEP.has(v)){ const s = document.createElement('option'); s.disabled = true; s.textContent = '──────'; bs.appendChild(s); }
      const o = document.createElement('option'); o.value = v; o.textContent = blendLabel(v); bs.appendChild(o); });
    bs.value = VecMode.pix.blend; bs.onchange = () => CMD.run('vecmode.set', {blend:bs.value}); wrap.appendChild(bs);
    lab(L3('不透明度：', '不透明度：', 'Opacity:'));
    const op = document.createElement('input'); op.type = 'number'; op.min = 0; op.max = 100; op.dataset.k = 'vmOpacity'; op.value = VecMode.pix.opacity; op.style.width = '48px';
    op.onchange = () => { const v = Math.max(0, Math.min(100, +op.value || 0)); op.value = v; CMD.run('vecmode.set', {opacity:v}); };
    wrap.appendChild(op); lab('%');
    const aa = chk('vmAA', VecMode.pix.antiAlias, L3('消除鋸齒', '消除锯齿', 'Anti-alias'));
    aa.onchange = () => CMD.run('vecmode.set', {antiAlias:aa.checked});
  }
  box.appendChild(wrap);
}
function hook(){
  [...PEN_TOOLS, ...SHAPE_TOOLS].forEach(id => {
    const T = Tools.get(id); if (!T || T.__vecMode) return; T.__vecMode = true;
    const orig = T.buildOptions;
    // PS 版面：模式下拉放最前面（同 PS）；AI 版面（当前层是形状层）：填色／描边接在工具自己的选项后面
    T.buildOptions = function(box, add, mk){ const ps = VecMode.applies(id); if (ps) bar(box, id); const r = orig ? orig.call(this, box, add, mk) : undefined; if (!ps) bar(box, id); return r; };
  });
}
hook();
window.addEventListener('DOMContentLoaded', hook);
/* 版面换了（PS⇄AI）就重画选项栏（模式下拉只在 PS 版面出现） */
document.addEventListener('change', e => { if (e.target && e.target.id === 'langSel' && window.UI) setTimeout(() => UI.buildOptions(ToolState.cur), 0); });

/* 选中的工作路径：画面上描一条细线（PS：路径面板选中的路径一直显示；面板开着时 ps-window.js 自己画） */
const ov = () => { if (!window.UI || !Array.isArray(UI.overlays) || UI.__vecModeOv) return; UI.__vecModeOv = true; UI.overlays.push((ctx, s) => {
  const ps = paths(); if (!ps || ps.sel !== 'work' || (window.DlPanels && DlPanels.isOpen && DlPanels.isOpen('paths'))) return;
  const w = Doc.workPath; if (!w || !Array.isArray(w.subpaths) || !w.subpaths.length) return;
  ctx.save(); ctx.beginPath();
  w.subpaths.forEach(sp => { const A = sp.anchors; if (!A || !A.length) return; ctx.moveTo(A[0].x * s, A[0].y * s);
    const seg = (p, q) => { const c1 = p.out || [p.x, p.y], c2 = q.in || [q.x, q.y]; ctx.bezierCurveTo(c1[0] * s, c1[1] * s, c2[0] * s, c2[1] * s, q.x * s, q.y * s); };
    for (let i = 1; i < A.length; i++) seg(A[i - 1], A[i]); if (sp.closed){ seg(A[A.length - 1], A[0]); ctx.closePath(); } });
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.stroke(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.restore(); }); };
if (window.UI && UI.overlays) ov(); else window.addEventListener('DOMContentLoaded', () => setTimeout(ov, 0));

/* 路径模式：Ctrl+Enter＝工作路径载入为选区（钢笔画到一半先收笔；photocraft vector_ui.rs:200 path_to_selection） */
window.addEventListener('keydown', e => {
  if (!(e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || VecMode.current() !== 'path') return;
  const t = e.target; if (t && /^(input|select|textarea)$/i.test(t.tagName)) return;
  if (window.Pen && Pen.active) Pen.finish(false);
  if (window.CurvaturePen && ToolState.cur === 'curvaturepen') CurvaturePen.reset();
  if (!Doc.workPath || !Doc.workPath.subpaths || !Doc.workPath.subpaths.length) return;
  e.preventDefault(); e.stopPropagation();
  CMD.run('ps.path.toSelection', {path:'work'}); if (window.UI) UI.draw();
}, true);
})();
