/* 堤麟画板 · 透视网格工具（AI：Shift+P，id perspgrid）—— 照 ArtCraft VectorCraft 原码逐段翻译
   主体：vectorcraft/crates/tools/src/distort/perspective.rs
           611-668   PlaneDrag（平面小部件：hit／preview（Shift＝物件跟着走、Alt＝复制品跟着走）／options 双击开平面选项）
           817-874   Handle 列举＋handles()：左右（第三）消失点、地平线、原点、左右平面范围、高度、格子大小小部件、左右地面点
           876-956   Press／translated／drag_handle：Shift 约束（消失点留在地平线、地面点与原点只走一个轴、范围与高度按整格）、Alt 两边范围一起拖
           958-1051  PerspectiveGridTool：按下（网格藏着就先显示；平面切换小部件＝选现用平面；平面小部件＝开始移动平面；
                     没锁网格时按在控制点＝开始编辑网格）、拖＝预览、放开＝一步历史、双击平面小部件＝平面选项、游标、换工具＝提交
         distort/perspective/view.rs:50-58   swing（锁定站点：拖一个消失点，另一个绕站点转）
         distort/perspective/widget.rs        平面切换小部件（模型在 menus/impl/ai-object.js 的 AiPersp.widgetAt／widgetHit）
         ui-egui/src/dialogs/perspective_plane.rs  平面选项对话框（位置、不移动／移动所有对象／复制所有对象；确定＝perspective.plane.move）
   资料与命令本体（⛔ 不另起一套）：menus/impl/ai-object.js 的 window.AiPersp（网格模型、单应、ai.perspective.* 物件命令）、
         menus/impl/ai-view.js（ai.perspective.grid.*、网格叠画、平面切换小部件点击、数字键 1–4）。本档只做工具手势，改文件一律 CMD.run。
   原码 Action::Begin／Preview／Commit：拖曳中把命令套在开始时的快照上只上画面，放开时回到快照、正式 CMD.run 一次＝一步历史（PerspKit.Pv）。
   本档另挂 window.PerspKit 给同组的 perspselect／measure／blend 共用（预览会话、物件命中、读数格式、量测标签、网格简画）。 */
(function(){
'use strict';
const P = () => window.AiPersp;
const clone = o => JSON.parse(JSON.stringify(o));
const fin = v => typeof v === 'number' && isFinite(v);
const zoom = () => Math.max((window.UI && UI.zoom) || 1, 1e-6);
const tolPx = px => px / zoom();                                     // ToolContext::tol(px)
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const T = k => (window.Lang ? Lang.t(k) : k);

/* ═══════════ 共用：PerspKit ═══════════ */
/* Begin／Preview／Commit：拖曳中命令套在快照上（只上画面），放开回快照再正式跑一次＝一步历史 */
const Pv = {
  base: null, last: null,
  active(){ return !!this.base; },
  begin(){ this.base = History.snap(); this.last = null; },
  show(id, params){
    if (!this.base) return null;
    History.restoreInPlace(this.base);
    let r;
    try { r = CMD.map[id].run(clone(params)); } catch (e){ console.error(e); r = {ok:false, error:String(e)}; }
    if (r && r.ok === false) History.restoreInPlace(this.base);
    else this.last = {id, params:clone(params)};
    if (window.UI) UI.draw();
    return r;
  },
  commit(){
    const b = this.base, l = this.last; this.base = null; this.last = null;
    if (!b) return null;
    History.restoreInPlace(b);
    const r = l ? CMD.run(l.id, l.params) : null;
    if (window.UI) UI.draw();
    return r;
  },
  cancel(){ if (this.base) History.restoreInPlace(this.base); this.base = null; this.last = null; if (window.UI) UI.draw(); }
};

/* cx.len：Unit::readout ＝ 两位小数＋单位缩写（AI 首选项 ▸ 单位 ▸ 常规；我们的文件单位 1 px ＝ 1 pt） */
function len(v){
  const A = P(); let u = null;
  try { const name = window.AiEdit && AiEdit.prefs ? AiEdit.prefs.get('unitsGeneral') : 'points'; u = A ? A.unitOf(name) : null; } catch (e){}
  if (!u) u = {points:1, suffix:'pt'};
  return `${(v / u.points).toFixed(2)} ${u.suffix}`;
}
const offsetLabel = (dx, dy) => `dX: ${len(dx)}\ndY: ${len(dy)}`;          // ToolContext::offset_label
const sizeLabel = (w, h) => `W: ${len(w)}\nH: ${len(h)}`;                 // ToolContext::size_label

/* Overlay::Measure：读数小框（萤幕像素大小固定） */
function drawLabel(ctx, s, p, text){
  const dpr = s / zoom(), lines = String(text).split('\n');
  ctx.save(); ctx.setLineDash([]);
  ctx.font = `${11 * dpr}px sans-serif`; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 8 * dpr, lh = 14 * dpr, h = lines.length * lh + 6 * dpr;
  const x = p[0] * s, y = p[1] * s;
  ctx.fillStyle = 'rgba(40,40,40,0.85)'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#ffffff'; lines.forEach((l, i) => ctx.fillText(l, x + 4 * dpr, y + 3 * dpr + i * lh));
  ctx.restore();
}
/* Overlay::Anchor：小方块（filled 实心） */
function drawAnchor(ctx, s, p, color, filled, size){
  const dpr = s / zoom(), r = size / 2 * dpr, x = p[0] * s, y = p[1] * s;
  ctx.save(); ctx.setLineDash([]); ctx.lineWidth = 1 * dpr;
  if (filled){ ctx.fillStyle = color; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); }
  else { ctx.fillStyle = '#ffffff'; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); }
  ctx.strokeStyle = color; ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
  ctx.restore();
}
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const rgba = c => `rgba(${c[0]},${c[1]},${c[2]},${(c.length > 3 ? c[3] : 255) / 255})`;

/* widget_hit_cx：平面切换小部件（显示网格时 ai-view 在画布上先接走；藏着时工具自己判） */
function widgetHit(g, p){
  const A = P(); if (!A) return null;
  const wo = A.widgetOpts ? A.widgetOpts() : {show:true, position:'topLeft'};
  if (!wo.show) return null;
  return A.widgetHit(g, A.ab0(), 1 / zoom(), wo.position, p);
}

/* ── 物件命中（doc/hit.rs hit_test → top_object）：由上往下第一个；路径＝描边（宽＋容差）或有填色在里面；容器＝任一子物件；
      混合＝关键物件与步骤；文字层（opts.text）＝外框（透视中的文字＝投影后的外框） ── */
let _hc = null;
const hctx = () => _hc || (_hc = document.createElement('canvas').getContext('2d'));
const painted = f => !!f && f !== 'none' && f !== '';
function bezPath(v){
  const P2 = new Path2D(), A = v.anchors; if (!A || !A.length) return P2;
  P2.moveTo(A[0].x, A[0].y);
  const seg = (a, b) => { const c1 = a.out || [a.x, a.y], c2 = b.in || [b.x, b.y]; P2.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], b.x, b.y); };
  for (let i = 1; i < A.length; i++) seg(A[i - 1], A[i]);
  if (v.closed && A.length > 1){ seg(A[A.length - 1], A[0]); P2.closePath(); }
  return P2;
}
function hitNode(s, p, tol){
  if (!s || s.visible === false || s.r3helper) return false;
  if (s.type === 'group' && s.live === 'blend' && window.AiR3 && AiR3.blendExpand){
    let nodes = []; try { nodes = AiR3.blendExpand(s) || []; } catch (e){}
    if (nodes.some(n => hitNode(n, p, tol))) return true;
  }
  if (Array.isArray(s.children)) return s.children.some(c => hitNode(c, p, tol));
  const v = window.VecSel ? VecSel.asBezier(s) : null;
  if (v && v.anchors && v.anchors.length){
    const P2 = bezPath(v), c = hctx();
    c.lineWidth = (painted(s.stroke) ? (+s.strokeWidth || 0) : 0) + 2 * tol; c.lineJoin = 'round'; c.lineCap = 'round';
    if (c.isPointInStroke(P2, p[0], p[1])) return true;
    return painted(s.fill) && c.isPointInPath(P2, p[0], p[1], 'nonzero');
  }
  const b = window.AIObj && AIObj.shapeBounds ? AIObj.shapeBounds(s, q => q, false) : null;
  return !!b && p[0] >= b.x0 - tol && p[0] <= b.x1 + tol && p[1] >= b.y0 - tol && p[1] <= b.y1 + tol;
}
function hitTop(pt, opts){
  opts = opts || {}; const tol = tolPx(3);
  for (let i = Doc.layers.length - 1; i >= 0; i--){
    const L = Doc.layers[i]; if (!L || L.visible === false) continue;
    if (L.kind === 'vector'){
      const p = [pt[0] - (L.x || 0), pt[1] - (L.y || 0)], S = L.data.shapes || [];
      for (let k = S.length - 1; k >= 0; k--){ const s = S[k]; if (s.locked) continue; if (hitNode(s, p, tol)) return {kind:'shape', L, s}; }
    } else if (L.kind === 'text' && opts.text && window.AiSel && AiSel.textBounds){
      const b = AiSel.textBounds(L);
      if (b && pt[0] >= b.x0 - tol && pt[0] <= b.x1 + tol && pt[1] >= b.y0 - tol && pt[1] <= b.y1 + tol) return {kind:'text', L};
    }
  }
  return null;
}
const tid = t => t.kind === 'shape' ? t.s.id : t.L.id;

window.PerspKit = {Pv, len, offsetLabel, sizeLabel, drawLabel, drawAnchor, widgetHit, hitTop, hitNode, bezPath, tid, tolPx, zoom, rgb, rgba};

/* ═══════════ 透视网格工具 ═══════════ */
const NEAR_ORIGIN_PX = 24;                                             // perspective.rs:838
/* perspective.rs:842-844 cell_steps：格子小部件离原点至少 24 萤幕像素（往上数几格） */
const cellSteps = (g, tol) => Math.min(Math.max(Math.ceil(NEAR_ORIGIN_PX * tol / Math.max(g.cell, 1e-9)), 1), 1e6);
const toPage = (g, pl, q) => { const A = P(), h = A.homography(g, pl); return h ? A.Hm.apply(h, q) : null; };
const toPlane = (g, pl, p) => { const A = P(), h = A.homography(g, pl), hi = h && A.Hm.inverse(h); return hi ? A.Hm.apply(hi, p) : null; };
/* perspective.rs:846-874 handles（tol＝每萤幕像素的文件单位） */
function handles(g, tol){
  const o = [g.origin[0], g.origin[1]];
  const v = [['vpLeft', [g.vpLeft, g.horizon]]];
  if (g.kind !== 1) v.push(['vpRight', [g.vpRight, g.horizon]]);
  if (g.kind === 3) v.push(['vpVertical', [g.vpVertical[0], g.vpVertical[1]]]);
  v.push(['origin', o]);
  const at = (h, pl, q) => { const p = toPage(g, pl, q); if (p) v.push([h, p]); };
  at('extentLeft', 'left', [g.extent, 0]);
  at('extentRight', 'right', [P().rightExtent(g), 0]);
  at('height', 'left', [0, g.height]);
  at('cell', 'left', [0, g.cell * cellSteps(g, tol)]);
  for (const [h, pl] of [['groundLeft', 'left'], ['groundRight', 'right']]){
    const p = toPage(g, pl, [g.cell, 0]);
    if (p && dist(p, o) > 1e-9){ const d = dist(p, o); v.push([h, [o[0] + (p[0] - o[0]) / d * NEAR_ORIGIN_PX * tol, o[1] + (p[1] - o[1]) / d * NEAR_ORIGIN_PX * tol]]); }
  }
  v.push(['horizon', [g.origin[0], g.horizon]]);
  return v;
}
const HANDLES = ['vpLeft', 'vpRight', 'vpVertical', 'horizon', 'origin', 'extentLeft', 'extentRight', 'height', 'groundLeft', 'groundRight', 'cell'];
/* perspective.rs:886-894 translated：整个网格（连消失点、地平线）平移 */
function translated(g, d){
  const n = clone(g);
  n.origin = [g.origin[0] + d[0], g.origin[1] + d[1]]; n.horizon += d[1];
  n.vpLeft += d[0]; n.vpRight += d[0]; n.vpVertical = [g.vpVertical[0] + d[0], g.vpVertical[1] + d[1]];
  return n;
}
/* view.rs:50-58 swing：锁定站点时拖一个消失点，另一个绕站点转（视角变、观者不动） */
function swing(g, left, x){
  const A = P(), st = A.station(g), off = left ? st.x - x : x - st.x;
  if (off <= 1e-6 || st.distance <= 0) return;
  const a = Math.atan2(off, st.distance) * 180 / Math.PI;
  A.setStation(g, st, left ? 90 - a : a);
}
/* perspective.rs:899-956 drag_handle：press＝{handle, grid, at, steps}；m＝{shift, alt} */
function dragHandle(press, p, m){
  const A = P(), g = press.grid, n = clone(g), h = press.handle;
  const alongAxis = q => { const d = [q[0] - press.at[0], q[1] - press.at[1]]; if (!m.shift) return d; return Math.abs(d[0]) >= Math.abs(d[1]) ? [d[0], 0] : [0, d[1]]; };
  const cells = v => m.shift ? Math.max(Math.round(v / g.cell), 1) * g.cell : Math.max(v, g.cell);
  if (h === 'vpLeft' || h === 'vpRight'){
    if (!m.shift) n.horizon = p[1];
    const left = h === 'vpLeft';
    if (g.lockStation && g.kind !== 1) swing(n, left, p[0]);
    else if (left) n.vpLeft = p[0]; else n.vpRight = p[0];
  } else if (h === 'vpVertical') n.vpVertical = [p[0], p[1]];
  else if (h === 'horizon') n.horizon = p[1];
  else if (h === 'origin'){ const d = alongAxis(p); n.origin = [g.origin[0] + d[0], g.origin[1] + d[1]]; }
  else if (h === 'groundLeft' || h === 'groundRight') return valid(translated(g, alongAxis(p)), g);
  else if (h === 'extentLeft' || h === 'extentRight'){
    const q = toPlane(g, h === 'extentRight' ? 'right' : 'left', p);
    if (q){ const e = cells(q[0]); if (h === 'extentLeft' || m.alt) n.extent = e; if (h === 'extentRight' || m.alt) n.extentRight = e; }
  } else if (h === 'height'){ const q = toPlane(g, 'left', p); if (q) n.height = cells(q[1]); }
  else if (h === 'cell'){ const q = toPlane(g, 'left', p); if (q) n.cell = Math.max(q[1] / press.steps, 0.5); }
  return valid(n, g);
}
const valid = (n, g) => P().validate(n) ? clone(g) : n;
/* PlaneDrag（perspective.rs:611-649） */
function planeDragHit(g, tol, p){
  if (!g.visible) return null;
  const w = P().planeWidgets(g).find(x => dist(x[1], p) <= tol); if (!w) return null;
  return {plane:w[0], anchor:w[1], press:p.slice(), offset:P().offset(g, w[0]), grid:clone(g)};
}
function planeDragParams(d, g, p, m){
  g = d.grid || g;                                                   // 按下时的网格（预览中网格已被改过）
  const off = P().depthAt(g, d.plane, d.offset, d.anchor, [d.anchor[0] + p[0] - d.press[0], d.anchor[1] + p[1] - d.press[1]]);
  if (off == null) return null;
  return {plane:d.plane, offset:off, objects:m.alt ? 'copy' : m.shift ? 'move' : 'none'};
}
const gridDef = g => { const o = clone(g); delete o.attached; return o; };

const PG = window.PerspGridTool = {
  drag: null,          // Press {handle, grid, at, steps}
  plane: null,         // PlaneDrag
  last: null,          // 拖曳中的预览网格
  hoverPt: null,
  busy(){ return !!(this.drag || this.plane); },
  down(e, pt){
    const A = P(); if (!A) return;
    const g0 = A.current();
    if (!g0.visible) CMD.run('ai.perspective.grid.show', {visible:true});          // 网格藏着：先显示
    const hit = widgetHit(g0, pt);
    if (hit){ CMD.run('ai.perspective.plane.set', {plane:hit}); return; }
    const d = planeDragHit(g0, tolPx(6), pt);
    if (d){ this.plane = d; Pv.begin(); return; }                                   // Begin("Move Plane")
    const g = A.current(), tol = tolPx(6);
    if (!g.locked){
      let best = null;
      for (const [h, q] of handles(g, tolPx(1))){ const dd = dist(q, pt); if (dd <= tol && (!best || dd < best[1])) best = [h, dd]; }
      if (best){ this.drag = {handle:best[0], grid:clone(g), at:pt.slice(), steps:cellSteps(g, tolPx(1))}; this.last = null; }   // Begin("Edit Perspective Grid")
    }
  },
  move(e, pt){
    this.hoverPt = pt;
    const m = {shift:e.shiftKey, alt:e.altKey};
    if (this.plane){
      const pr = planeDragParams(this.plane, P().current(), pt, m);
      if (pr) Pv.show('ai.perspective.plane.move', pr);
      return;
    }
    if (this.drag){
      const n = dragHandle(this.drag, pt, m);
      this.last = n; P().store(n); UI.draw();                                           // Preview perspective.grid.set（只上画面）
    }
  },
  up(e, pt){
    if (this.plane){ this.plane = null; Pv.commit(); return; }
    if (this.drag){
      const press = this.drag, n = this.last; this.drag = null; this.last = null;
      P().store(press.grid);                                                             // 回到按下时的网格，再正式跑一次
      if (n && !P().sameGrid(n, press.grid)) CMD.run('ai.perspective.grid.set', gridDef(n));
      UI.draw();
    }
  },
  dblClick(e, pt){
    const g = P().current(), d = planeDragHit(g, tolPx(6), pt);
    if (d) CMD.run('perspgrid.planeDialog', {plane:d.plane});
  },
  deactivate(){ if (this.busy()) this.up({}, this.hoverPt || [0, 0]); },
  /* perspective.rs:1026-1041 cursor */
  cursor(pt){
    const A = P(); if (!A || !pt) return 'default';
    const g = A.current(), tol = tolPx(6);
    if (this.plane || planeDragHit(g, tol, pt)) return 'move';
    if (g.locked) return 'default';
    const h = handles(g, tolPx(1)).find(x => dist(x[1], pt) <= tol);
    if (!h) return 'default';
    if (['horizon', 'height', 'cell'].includes(h[0])) return 'ns-resize';
    if (h[0] === 'extentLeft' || h[0] === 'extentRight') return 'ew-resize';
    return 'move';
  },
  syncCursor(){ if (window.UI && UI.canvas && ToolState.cur === 'perspgrid') UI.canvas.style.cursor = this.cursor(this.hoverPt); },
  handles(){ const A = P(); return A ? handles(A.current(), tolPx(1)) : []; },
  /* perspective.rs:1013-1025 overlays：消失点实心 7、地面点实心 5、格子小部件把手、其余空心 6 */
  drawOverlay(ctx, s){
    const A = P(); if (!A) return;
    const ink = '#202020';
    for (const [h, p] of handles(A.current(), tolPx(1))){
      if (h === 'vpLeft' || h === 'vpRight' || h === 'vpVertical') drawAnchor(ctx, s, p, ink, true, 7);
      else if (h === 'groundLeft' || h === 'groundRight') drawAnchor(ctx, s, p, ink, true, 5);
      else if (h === 'cell'){ const dpr = s / zoom(); ctx.save(); ctx.fillStyle = '#ffffff'; ctx.strokeStyle = ink; ctx.lineWidth = dpr; ctx.beginPath(); ctx.arc(p[0] * s, p[1] * s, 3.5 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore(); }
      else drawAnchor(ctx, s, p, ink, false, 6);
    }
  }
};

/* ═══════════ 命令（agent 与滑鼠同一条路） ═══════════ */
const reg = (id, meta, fn) => CMD.reg(id, Object.assign({i18n:''}, meta), p => fn(p || {}));
const pt2 = v => Array.isArray(v) && v.length === 2 && v.every(fin) ? [v[0], v[1]] : null;
reg('perspgrid.handles', {params:'{} 透视网格工具的控制点（文件坐标）→ {ok, handles:[{handle: vpLeft|vpRight|vpVertical|origin|extentLeft|extentRight|height|cell|groundLeft|groundRight|horizon, x, y}], planeWidgets:[{plane, x, y}], locked}'}, () => {
  const A = P(); if (!A) return {ok:false, error:'perspgrid.handles: perspective grid unavailable'};
  const g = A.current();
  return {ok:true, handles:handles(g, tolPx(1)).map(([h, p]) => ({handle:h, x:p[0], y:p[1]})), planeWidgets:A.planeWidgets(g).map(([pl, p]) => ({plane:pl, x:p[0], y:p[1]})), locked:!!g.locked};
});
reg('perspgrid.dragHandle', {undoable:false, params:'{handle（见 perspgrid.handles）, to:[x,y] 放开点, from?:[x,y] 按下点（缺省＝控制点所在）, shift?: 约束（消失点留在地平线、原点／地面点只走一个轴、范围与高度按整格）, alt?: 左右范围一起拖} ＝拿透视网格工具拖一个控制点（perspective.rs drag_handle）；网格锁定时失败；一步历史（ai.perspective.grid.set）→ {ok, grid}'}, p => {
  const C = 'perspgrid.dragHandle', A = P(); if (!A) return {ok:false, error:C + ': perspective grid unavailable'};
  if (!HANDLES.includes(p.handle)) return {ok:false, error:`${C}: unknown handle \`${p.handle}\``};
  const to = pt2(p.to); if (!to) return {ok:false, error:C + ': missing to [x,y]'};
  if (!A.current().visible) CMD.run('ai.perspective.grid.show', {visible:true});
  const g = A.current(); if (g.locked) return {ok:false, error:C + ': the grid is locked'};
  const hs = handles(g, tolPx(1)), hp = hs.find(x => x[0] === p.handle); if (!hp) return {ok:false, error:`${C}: this grid has no \`${p.handle}\` handle`};
  const from = pt2(p.from) || hp[1];
  const n = dragHandle({handle:p.handle, grid:clone(g), at:from, steps:cellSteps(g, tolPx(1))}, to, {shift:!!p.shift, alt:!!p.alt});
  if (A.sameGrid(n, g)) return {ok:true, grid:gridDef(g), changed:false};
  return CMD.run('ai.perspective.grid.set', gridDef(n));
});
reg('perspgrid.dragPlane', {undoable:false, params:'{plane: left|right|ground, to:[x,y], from?:[x,y]（缺省＝平面小部件菱形所在）, shift?: 平面上的物件跟着走, alt?: 复制品跟着走} ＝拖平面小部件：平面沿法线移动（perspective.rs PlaneDrag）；一步历史（ai.perspective.plane.move）→ {ok, plane, offset, ids}'}, p => {
  const C = 'perspgrid.dragPlane', A = P(); if (!A) return {ok:false, error:C + ': perspective grid unavailable'};
  const to = pt2(p.to); if (!to) return {ok:false, error:C + ': missing to [x,y]'};
  const g = A.current(), w = A.planeWidgets(g).find(x => x[0] === p.plane); if (!w) return {ok:false, error:C + ': plane must be left|right|ground'};
  const from = pt2(p.from) || w[1];
  const pr = planeDragParams({plane:w[0], anchor:w[1], press:from, offset:A.offset(g, w[0])}, g, to, {shift:!!p.shift, alt:!!p.alt});
  if (!pr) return {ok:false, error:C + ": the pointer is beyond the plane's horizon"};
  return CMD.run('ai.perspective.plane.move', pr);
});
/* dialogs/perspective_plane.rs：平面选项（双击平面小部件／ui.perspectivePlane） */
reg('perspgrid.planeDialog', {params:'{plane?: left|right|ground（缺省＝现用平面）} 开平面选项对话框（＝双击平面小部件）：位置（沿法线，0＝网格定义的原位）、不移动／移动所有对象／复制所有对象；确定＝ai.perspective.plane.move → {ok, dialog}'}, p => {
  const C = 'perspgrid.planeDialog', A = P(); if (!A || !window.AiR3) return {ok:false, error:C + ': perspective grid unavailable'};
  const g = A.current();
  const plane = p.plane === undefined ? g.plane : A.planeParse(p.plane);
  if (!plane || (p.plane !== undefined && plane === 'none')) return {ok:false, error:C + ': plane must be left, right or ground'};
  if (plane === 'none') return {ok:false, error:C + ': no active perspective plane'};
  const title = plane === 'right' ? 'ui.pgRightPlane' : plane === 'ground' ? 'ui.pgGroundPlane' : 'ui.pgLeftPlane';
  AiR3.form('perspectivePlane', title, [
    {key:'location', label:'ui.pgLocation', type:'number', value:A.offset(g, plane)},
    {key:'objects', type:'radio', value:'none', options:[['none', 'ui.pgNoMove'], ['move', 'ui.pgMoveAll'], ['copy', 'ui.pgCopyAll']]}
  ], v => CMD.run('ai.perspective.plane.move', {plane, offset:+v.location || 0, objects:['none', 'move', 'copy'].includes(v.objects) ? v.objects : 'none'}));
  return {ok:true, dialog:'perspectivePlane', plane};
});

const STR = {
  'zh-Hant':{'ui.pgHint':'拖曳消失點／地平線／原點／範圍／高度／格點大小｜Shift＝約束（整格、單軸、留在地平線）｜Alt＝兩邊範圍一起｜點格點切換小工具＝選現用平面｜拖平面小工具＝移動平面（Shift 物件跟著、Alt 複製）｜雙擊平面小工具＝平面選項',
    'ui.pgLeftPlane':'左側平面', 'ui.pgRightPlane':'右側平面', 'ui.pgGroundPlane':'水平平面', 'ui.pgLocation':'位置：', 'ui.pgNoMove':'不移動', 'ui.pgMoveAll':'移動所有物件', 'ui.pgCopyAll':'拷貝所有物件'},
  'zh-Hans':{'ui.pgHint':'拖曳消失点／地平线／原点／范围／高度／网格大小｜Shift＝约束（整格、单轴、留在地平线）｜Alt＝两边范围一起｜点平面切换构件＝选现用平面｜拖平面构件＝移动平面（Shift 对象跟着、Alt 复制）｜双击平面构件＝平面选项',
    'ui.pgLeftPlane':'左侧平面', 'ui.pgRightPlane':'右侧平面', 'ui.pgGroundPlane':'水平平面', 'ui.pgLocation':'位置：', 'ui.pgNoMove':'不移动', 'ui.pgMoveAll':'移动所有对象', 'ui.pgCopyAll':'复制所有对象'},
  'en':{'ui.pgHint':'Drag vanishing points / horizon / origin / extents / height / grid cell | Shift constrains | Alt drags both extents | Click the Plane Switching Widget to pick the active plane | Drag a plane widget to move the plane (Shift moves objects, Alt copies) | Double-click it for plane options',
    'ui.pgLeftPlane':'Left Plane', 'ui.pgRightPlane':'Right Plane', 'ui.pgGroundPlane':'Horizontal Plane', 'ui.pgLocation':'Location:', 'ui.pgNoMove':'Do Not Move', 'ui.pgMoveAll':'Move All Objects', 'ui.pgCopyAll':'Copy All Objects'}
};

Tools.reg({
  id:'perspgrid', icon:'▦', group:'vector', order:300, for:'vector', opts:[],
  cursor:'default', hint:'ui.pgHint', strings:STR,
  onDown(e, pt){ PG.hoverPt = pt; PG.down(e, pt); PG.syncCursor(); UI.draw(); },
  onMove(e, pt){ PG.move(e, pt); PG.syncCursor(); if (!PG.busy()) UI.draw(); },
  onUp(e, pt){ PG.up(e, pt); PG.syncCursor(); UI.draw(); },
  onDblClick(e, pt){ PG.dblClick(e, pt); UI.draw(); },
  onDeactivate(){ PG.deactivate(); },
  drawOverlay(ctx, s){ PG.drawOverlay(ctx, s); }
});
})();
