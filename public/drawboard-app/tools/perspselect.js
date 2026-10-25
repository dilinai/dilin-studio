/* 堤麟画板 · 透视选区工具（AI：Shift+V，id perspselect）—— 照 ArtCraft VectorCraft 原码逐段翻译
   主体：vectorcraft/crates/tools/src/distort/perspective.rs
           1053-1122  SelDrag（Idle／Move／Scale／Plane）、selection_persp_box、persp_handle_at、resize_cursor、move_preview（读数 dX/dY 或 dZ）
           1124-1219  pointer：按下＝平面切换小部件选平面／平面小部件开始移动平面／选取的透视外框把手开始缩放／点到物件（没选中就改选它，
                      选到透视中的物件＝它的平面变现用平面）开始移动（Alt＝复制）／点空白＝取消选取；
                      拖＝离按下点 tol(3) 才开始移动、之后每下预览 perspective.move（拖曳中按 5＝沿平面法线移动）；
                      缩放把手＝scale_for_drag（Shift 等比、Alt 从中心）在平面坐标里、预览 perspective.transform；放开＝一步历史；
                      双击＝平面小部件开平面选项、透视中的文字＝编辑文本并换文字工具
           1220-1246  key：5 切换垂直移动；方向键＝perspective.nudge（Shift 大步、Alt 复制）——只在闲着、没选锚点、选取里有透视物件时吃键
           1247-1294  overlays（透视外框＋八个把手，平面色；读数）、cursor、deactivate（拖到一半换工具＝提交）
         tools/src/bbox.rs:5-92                      Handle（八把手、对角）、scale_for_drag
         engine/src/cmd/distortcmds.rs:1030-1048     perspective.nudge（键盘增量 ×10；在透视外框中心量；走 perspective.move）
   资料与命令本体：menus/impl/ai-object.js window.AiPersp（ai.perspective.move／transform／plane.set／plane.move／editText），本档只做手势与 perspselect.* 小命令；
   共用的预览会话／命中／读数在 tools/perspgrid.js 的 window.PerspKit。 */
(function(){
'use strict';
const P = () => window.AiPersp, K = () => window.PerspKit;
const clone = o => JSON.parse(JSON.stringify(o));
const fin = v => typeof v === 'number' && isFinite(v);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* ═══════════ bbox.rs Handle／scale_for_drag ═══════════ */
const HANDLES = ['topLeft', 'top', 'topRight', 'right', 'bottomRight', 'bottom', 'bottomLeft', 'left'];
function hpos(h, r){
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  return {topLeft:[r.x0, r.y0], top:[cx, r.y0], topRight:[r.x1, r.y0], right:[r.x1, cy], bottomRight:[r.x1, r.y1], bottom:[cx, r.y1], bottomLeft:[r.x0, r.y1], left:[r.x0, cy]}[h];
}
const opposite = h => HANDLES[(HANDLES.indexOf(h) + 4) % 8];
const isCorner = h => HANDLES.indexOf(h) % 2 === 0;
const hAxes = h => (h === 'top' || h === 'bottom') ? [false, true] : (h === 'left' || h === 'right') ? [true, false] : [true, true];
/* bbox.rs:70-92 → kurbo 仿射 [a,b,c,d,e,f] */
function scaleForDrag(r, h, p, proportional, fromCenter){
  const o = fromCenter ? [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2] : hpos(opposite(h), r);
  const st = hpos(h, r), [ax, ay] = hAxes(h);
  const d0 = [st[0] - o[0], st[1] - o[1]], d1 = [p[0] - o[0], p[1] - o[1]];
  let sx = ax && Math.abs(d0[0]) > 1e-9 ? d1[0] / d0[0] : 1, sy = ay && Math.abs(d0[1]) > 1e-9 ? d1[1] / d0[1] : 1;
  const sg = v => v < 0 ? -1 : 1;
  if (proportional){
    if (isCorner(h)){ const s = Math.abs(sx) > Math.abs(sy) ? sx : sy; sx = Math.abs(s) * sg(sx); sy = Math.abs(s) * sg(sy); }
    else if (ax) sy = Math.abs(sx); else sx = Math.abs(sy);
  }
  const cl = s => Math.abs(s) < 1e-4 ? 1e-4 * (s < 0 ? -1 : 1) : s;
  sx = cl(sx); sy = cl(sy);
  return [sx, 0, 0, sy, o[0] - sx * o[0], o[1] - sy * o[1]];
}
const affRect = (a, r) => { const xs = [r.x0 * a[0] + a[4], r.x1 * a[0] + a[4]], ys = [r.y0 * a[3] + a[5], r.y1 * a[3] + a[5]]; return {x0:Math.min(...xs), y0:Math.min(...ys), x1:Math.max(...xs), y1:Math.max(...ys)}; };

/* ═══════════ 选取与透视外框（perspective.rs:447-464 plane_bounds、721-745 mapped_bounds） ═══════════ */
function selIds(){
  const out = [];
  if (window.VecSel && VecSel.layer()) out.push(...VecSel.shapes);
  if (window.AiSel) out.push(...AiSel.text);
  return out;
}
const targetsOf = ids => (P() && ids.length) ? P().rootsOf({ids}) : [];
const attachmentOf = t => P().attachmentOf(t);
const planeBounds = (g, ts) => P().planeBounds(g, ts);     // perspective.rs:449-464（menus/impl/ai-object.js AiPersp）
/* selection_persp_box → {plane, depth, rect, h} */
function perspBox(g, ids){
  const A = P(); if (!A) return null;
  const pb = planeBounds(g, targetsOf(ids || selIds())); if (!pb) return null;
  const h = A.homographyAt(g, pb.plane, pb.depth); return h ? Object.assign(pb, {h}) : null;
}
const handleAt = (box, p, tol) => HANDLES.find(k => { const q = P().Hm.apply(box.h, hpos(k, box.rect)); return q && dist(q, p) <= tol; }) || null;
/* perspective.rs:1090-1099 resize_cursor */
function resizeCursor(d){
  let a = Math.atan2(-d[1], d[0]) * 180 / Math.PI; a = ((a % 180) + 180) % 180;
  if (!(a >= 22.5 && a < 157.5)) return 'ew-resize';
  if (a < 67.5) return 'nesw-resize';
  if (a < 112.5) return 'ns-resize';
  return 'nwse-resize';
}

/* ═══════════ 工具状态 ═══════════ */
const PS = window.PerspSelTool = {
  drag: null,        // {kind:'move', ids, from, last, began, perp, copy} | {kind:'scale', ids, plane, depth, rect, handle} | {kind:'plane', d}
  measure: null,     // [点, 文字]
  hoverPt: null,
  busy(){ return !!this.drag; },
  /* perspective.rs:1103-1121 move_preview */
  movePreview(){
    const d = this.drag; if (!d || d.kind !== 'move') return;
    const A = P(), g = A.current();
    const v = {ids:d.ids, from:d.from, to:d.last, copy:d.copy, perpendicular:d.perp};
    if (g.plane !== 'none') v.plane = g.plane;
    const t0 = targetsOf(d.ids.slice(0, 1))[0];
    const at = (t0 && attachmentOf(t0)) || (g.plane !== 'none' ? [g.plane, A.offset(g, g.plane)] : null);
    this.measure = null;
    if (at){
      if (d.perp){ const z = A.depthAt(g, at[0], at[1], d.from, d.last); if (z != null) this.measure = [d.last, `dZ: ${K().len(z - at[1])}`]; }
      else { const dv = A.planeDelta(g, at[0], at[1], d.from, d.last); if (dv) this.measure = [d.last, K().offsetLabel(dv[0], dv[1])]; }
    }
    K().Pv.show('ai.perspective.move', v);
  },
  down(e, p){
    const A = P(), KK = K(); if (!A || !KK) return;
    this.measure = null;
    const g = A.current();
    const w = (!g.visible) ? KK.widgetHit(g, p) : null;               // 显示时 ai-view 先接走小部件的点击
    if (w){ CMD.run('ai.perspective.plane.set', {plane:w}); return; }
    const pw = g.visible ? A.planeWidgets(g).find(x => dist(x[1], p) <= KK.tolPx(6)) : null;
    if (pw){ this.drag = {kind:'plane', d:{plane:pw[0], anchor:pw[1], press:p.slice(), offset:A.offset(g, pw[0]), grid:clone(g)}}; KK.Pv.begin(); return; }   // Begin("Move Plane")
    const box = perspBox(g);
    const hk = box && handleAt(box, p, KK.tolPx(5));
    if (hk){ this.drag = {kind:'scale', ids:selIds(), plane:box.plane, depth:box.depth, rect:box.rect, handle:hk}; KK.Pv.begin(); return; }   // Begin("Scale in Perspective")
    const hit = KK.hitTop(p, {text:true});
    if (!hit){ CMD.run('perspselect.select', {ids:[]}); return; }
    const top = KK.tid(hit), cur = selIds();
    let ids;
    if (cur.includes(top)) ids = cur;
    else { CMD.run('perspselect.select', {ids:[top]}); ids = [top]; }
    const a = attachmentOf(hit);                                         // 选到透视中的物件＝它的平面变现用平面
    if (a && a[0] !== g.plane) CMD.run('ai.perspective.plane.set', {plane:a[0]});
    this.drag = {kind:'move', ids, from:p.slice(), last:p.slice(), began:false, perp:false, copy:e.altKey};
  },
  move(e, p){
    this.hoverPt = p;
    const d = this.drag; if (!d) return;
    const A = P(), KK = K();
    if (d.kind === 'move'){
      d.copy = e.altKey;
      if (!d.began && dist(p, d.from) < KK.tolPx(3)){ d.last = p.slice(); return; }
      if (!d.began){ d.began = true; KK.Pv.begin(); }                    // Begin("Move in Perspective"／"Copy in Perspective")
      d.last = p.slice(); this.movePreview(); return;
    }
    if (d.kind === 'scale'){
      const h = A.homographyAt(A.current(), d.plane, d.depth), hi = h && A.Hm.inverse(h), q = hi && A.Hm.apply(hi, p);
      if (!q) return;
      const m = scaleForDrag(d.rect, d.handle, q, e.shiftKey, e.altKey), nr = affRect(m, d.rect);
      this.measure = [p.slice(), KK.sizeLabel(nr.x1 - nr.x0, nr.y1 - nr.y0)];
      KK.Pv.show('ai.perspective.transform', {ids:d.ids, matrix:m});
      return;
    }
    if (d.kind === 'plane'){
      const g = d.d.grid, off = A.depthAt(g, d.d.plane, d.d.offset, d.d.anchor, [d.d.anchor[0] + p[0] - d.d.press[0], d.d.anchor[1] + p[1] - d.d.press[1]]);
      if (off != null) KK.Pv.show('ai.perspective.plane.move', {plane:d.d.plane, offset:off, objects:e.altKey ? 'copy' : e.shiftKey ? 'move' : 'none'});
    }
  },
  up(){
    const d = this.drag; this.drag = null; this.measure = null;
    if (!d) return;
    if (d.kind === 'move' && !d.began) return;
    K().Pv.commit();
  },
  dblClick(e, p){
    const A = P(), KK = K(), g = A.current();
    const pw = g.visible ? A.planeWidgets(g).find(x => dist(x[1], p) <= KK.tolPx(6)) : null;
    if (pw){ CMD.run('perspgrid.planeDialog', {plane:pw[0]}); return; }
    const hit = KK.hitTop(p, {text:true});                               // 透视中的文字：编辑文本，再换文字工具
    if (hit && hit.kind === 'text' && A.projectionOf(hit.L)){
      const r = CMD.run('ai.perspective.editText', {id:hit.L.id});
      if (r && r.ok !== false && window.UI && UI.pick) UI.pick('text');
    }
  },
  /* perspective.rs:1220-1246 key／claims_key */
  claimsArrows(){
    if (this.drag) return false;
    if (window.VecSel && Object.keys(VecSel.anchors || {}).length) return false;
    const A = P(); if (!A) return false;
    return targetsOf(selIds()).some(t => !!attachmentOf(t));
  },
  key(e){
    if (e.key === '5' && this.drag && this.drag.kind === 'move'){
      this.drag.perp = !this.drag.perp;
      if (this.drag.began) this.movePreview();
      return true;
    }
    const dir = {ArrowLeft:[-1, 0], ArrowRight:[1, 0], ArrowUp:[0, -1], ArrowDown:[0, 1]}[e.key];
    if (!dir || !this.claimsArrows()) return false;
    CMD.run('perspselect.nudge', {dx:dir[0], dy:dir[1], big:e.shiftKey, copy:e.altKey});
    return true;
  },
  deactivate(){ this.measure = null; const d = this.drag; this.drag = null; if (d && !(d.kind === 'move' && !d.began)) K().Pv.commit(); },
  cursor(p){
    const A = P(), KK = K(); if (!A || !KK || !p) return 'default';
    const d = this.drag;
    if (d && ((d.kind === 'move' && d.began) || d.kind === 'plane')) return 'move';
    const g = A.current();
    if (g.visible && A.planeWidgets(g).some(x => dist(x[1], p) <= KK.tolPx(6))) return 'move';
    const box = perspBox(g);
    if (box){
      const k = (d && d.kind === 'scale') ? d.handle : handleAt(box, p, KK.tolPx(5));
      if (k){ const a = A.Hm.apply(box.h, hpos(k, box.rect)), c = A.Hm.apply(box.h, [(box.rect.x0 + box.rect.x1) / 2, (box.rect.y0 + box.rect.y1) / 2]); if (a && c) return resizeCursor([a[0] - c[0], a[1] - c[1]]); }
    }
    return 'default';
  },
  syncCursor(){ if (window.UI && UI.canvas && ToolState.cur === 'perspselect') UI.canvas.style.cursor = this.cursor(this.hoverPt); },
  /* perspective.rs:1247-1266 overlays */
  drawOverlay(ctx, s){
    const A = P(), KK = K(); if (!A || !KK) return;
    if (window.VecSel) VecSel.drawOverlay(ctx, s);
    const box = perspBox(A.current());
    if (box){
      const col = KK.rgb(A.PLANE_COLOR[box.plane]), r = box.rect;
      const cs = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].map(q => A.Hm.apply(box.h, q)).filter(Boolean);
      ctx.save(); ctx.setLineDash([]); ctx.strokeStyle = col; ctx.lineWidth = s / KK.zoom();
      if (cs.length === 4){ ctx.beginPath(); cs.forEach((q, i) => i ? ctx.lineTo(q[0] * s, q[1] * s) : ctx.moveTo(q[0] * s, q[1] * s)); ctx.closePath(); ctx.stroke(); }
      ctx.restore();
      for (const k of HANDLES){ const q = A.Hm.apply(box.h, hpos(k, r)); if (q) KK.drawAnchor(ctx, s, q, col, false, 6); }
    }
    if (this.measure) KK.drawLabel(ctx, s, this.measure[0], this.measure[1]);
  }
};

/* ═══════════ 命令 ═══════════ */
const reg = (id, meta, fn) => CMD.reg(id, Object.assign({i18n:''}, meta), p => fn(p || {}));
const pt2 = v => Array.isArray(v) && v.length === 2 && v.every(fin) ? [v[0], v[1]] : null;
/* select.set {ids}：形状（同一个矢量层）与文字层；空＝取消选取（选取不进文件、不进历史） */
reg('perspselect.select', {params:'{ids:[形状 id 或文字层 id]}（空阵列＝取消选取）透视选区工具点选（＝原码 select.set）：形状只认第一个形状所在那层的 → {ok, ids}'}, p => {
  const ids = Array.isArray(p.ids) ? p.ids : [];
  const shapes = [], texts = []; let L0 = null;
  for (const id of ids){
    const T = Doc.byId && Doc.byId(id);
    if (T && T.kind === 'text'){ texts.push(id); continue; }
    const h = window.AiR3 && AiR3.findDeep(id); if (!h) continue;
    if (!L0) L0 = h.L; if (h.L === L0) shapes.push(id);
  }
  if (window.AiSel) AiSel.text = texts;
  if (shapes.length) VecSel.setShapes(L0.id, shapes); else VecSel.clear();
  if (window.UI) UI.draw();
  return {ok:true, ids:shapes.concat(texts)};
});
reg('perspselect.box', {params:'{ids?}（缺省＝目前选取）选取的透视外框 → {ok, box:{plane, depth, rect:{x0,y0,x1,y1}（平面坐标）, handles:{topLeft:[x,y]…（文件坐标）}} | null}'}, p => {
  const A = P(); if (!A) return {ok:false, error:'perspselect.box: perspective grid unavailable'};
  const b = perspBox(A.current(), Array.isArray(p.ids) ? p.ids : null);
  if (!b) return {ok:true, box:null};
  const hs = {}; HANDLES.forEach(k => { hs[k] = A.Hm.apply(b.h, hpos(k, b.rect)); });
  return {ok:true, box:{plane:b.plane, depth:b.depth, rect:b.rect, handles:hs}};
});
reg('perspselect.scale', {undoable:false, params:'{handle: topLeft|top|topRight|right|bottomRight|bottom|bottomLeft|left, to:[x,y] 文件坐标, shift?: 等比, alt?: 从中心, ids?（缺省＝目前选取）} ＝拖透视外框的把手（bbox.rs scale_for_drag 在平面坐标里）；一步历史（ai.perspective.transform）→ {ok, ids, matrix}'}, p => {
  const C = 'perspselect.scale', A = P(); if (!A) return {ok:false, error:C + ': perspective grid unavailable'};
  if (!HANDLES.includes(p.handle)) return {ok:false, error:C + ': unknown handle'};
  const to = pt2(p.to); if (!to) return {ok:false, error:C + ': missing to [x,y]'};
  const ids = Array.isArray(p.ids) ? p.ids : selIds();
  const b = perspBox(A.current(), ids); if (!b) return {ok:false, error:C + ": the selection isn't in perspective"};
  const hi = A.Hm.inverse(b.h), q = hi && A.Hm.apply(hi, to); if (!q) return {ok:false, error:C + ": the pointer is beyond the plane's horizon"};
  const m = scaleForDrag(b.rect, p.handle, q, !!p.shift, !!p.alt);
  const r = CMD.run('ai.perspective.transform', {ids, matrix:m});
  return r && r.ok === false ? r : Object.assign({}, r, {matrix:m});
});
/* distortcmds.rs:1030-1048 perspective.nudge */
reg('perspselect.nudge', {undoable:false, params:'{dx, dy（方向，各夹到 −1…1）, big?: Shift（×10）, copy?: Alt（移动复制品）} 方向键在透视中微移选取：步长＝首选项「键盘增量」，在透视外框中心量；走 ai.perspective.move（一步历史）→ {ok, ids}'}, p => {
  const C = 'perspselect.nudge', A = P(); if (!A) return {ok:false, error:C + ': perspective grid unavailable'};
  const dx = p.dx === undefined ? 0 : +p.dx, dy = p.dy === undefined ? 0 : +p.dy;
  if (!(isFinite(dx) && isFinite(dy)) || (dx === 0 && dy === 0)) return {ok:false, error:C + ": dx and dy give the arrow's direction"};
  let inc = 1; try { if (window.AiEdit && AiEdit.prefs){ const v = +AiEdit.prefs.get('keyboardIncrement'); if (v > 0) inc = v; } } catch (e){}
  const k = inc * (p.big ? 10 : 1);
  const ids = selIds(); if (!ids.length) return {ok:false, error:C + ': nothing selected'};
  const b = perspBox(A.current(), ids); if (!b) return {ok:false, error:C + ": the selection isn't in perspective"};
  const from = A.Hm.apply(b.h, [(b.rect.x0 + b.rect.x1) / 2, (b.rect.y0 + b.rect.y1) / 2]); if (!from) return {ok:false, error:C + ": the pointer is beyond the plane's horizon"};
  const cl = v => Math.max(-1, Math.min(1, v));
  return CMD.run('ai.perspective.move', {ids, from, to:[from[0] + cl(dx) * k, from[1] + cl(dy) * k], copy:!!p.copy});
});

const STR = {
  'zh-Hant':{'ui.psHint':'點選＝選取（透視中的物件＝切到它的平面）｜拖曳＝在平面內移動（Alt 複製；拖曳中按 5＝沿法線移動）｜拖透視外框把手＝縮放（Shift 等比、Alt 從中心）｜方向鍵＝透視中微移（Shift ×10、Alt 複製）｜雙擊透視文字＝編輯文字'},
  'zh-Hans':{'ui.psHint':'点选＝选取（透视中的对象＝切到它的平面）｜拖曳＝在平面内移动（Alt 复制；拖曳中按 5＝沿法线移动）｜拖透视外框把手＝缩放（Shift 等比、Alt 从中心）｜方向键＝透视中微移（Shift ×10、Alt 复制）｜双击透视文字＝编辑文本'},
  'en':{'ui.psHint':'Click to select (an object in perspective activates its plane) | Drag to move within its plane (Alt copies; press 5 while dragging to move perpendicular) | Drag a box handle to scale (Shift proportional, Alt from centre) | Arrow keys nudge in perspective (Shift ×10, Alt copies) | Double-click type in perspective to edit it'}
};
Tools.reg({
  id:'perspselect', icon:'⬚', group:'vector', order:301, for:'vector', opts:[],
  cursor:'default', hint:'ui.psHint', strings:STR,
  onDown(e, pt){ PS.hoverPt = pt; PS.down(e, pt); PS.syncCursor(); UI.draw(); },
  onMove(e, pt){ PS.move(e, pt); PS.syncCursor(); if (!PS.busy()) UI.draw(); },
  onUp(e, pt){ PS.up(e, pt); PS.syncCursor(); UI.draw(); },
  onDblClick(e, pt){ PS.dblClick(e, pt); UI.draw(); },
  onKey(e){ const r = PS.key(e); if (r){ e.preventDefault(); UI.draw(); } return r; },
  onDeactivate(){ PS.deactivate(); },
  drawOverlay(ctx, s){ PS.drawOverlay(ctx, s); }
});
})();
