/* 画板工具（AI 版面 ai.artboard，Shift+O）——照 VectorCraft 原码逐段翻译
   对照源（vectorcraft/crates/…）：
     tools/src/xform/artboard.rs 1-226   ArtboardTool：点画板＝当前画板（虚线框、8 把手、板名）；板内拖＝移动（moveArt 开＝连图稿、Shift＝45° 约束）；
                                          拖当前画板的把手＝改大小（Shift 等比、Alt 绕中心）；粘贴板上拖＝画新画板（Shift 正方）；双击＝画板选项；
                                          Delete／Backspace＝删当前画板（只剩一块不删）；Esc＝拖到一半取消，否则回选择工具
     tools/src/bbox.rs 1-110             Handle（8 把手顺序、pos、opposite、axes）、hit_handle、scale_for_drag、move_delta（Shift＝constrain_angle 45°）
     tools/src/guides.rs 160-172         snap_draw（对齐像素 → 对齐网格 → 智能参考线）
     tools/src/lib.rs 261-275            tol（屏幕点 → 文件单位）、size_label「W: … / H: …」、offset_label「dX: … / dY: …」（readout＝两位小数＋单位）
     engine/src/cmd/xform.rs 43-51, 371-413  artboard.move {index, dx, dy, moveArt}：搬画板＋（moveArt）完全落在画板里、没锁的顶层物件一起搬
     ui-egui/src/canvas.rs 1188-1194     Measure 牌（屏幕点 +14、灰底 92,92,92,235、白字 11px）
   我们这边（接 ai-object.js／ai-window.js 已有的 AI 画板资料，不另起一套）：
     · 画板＝AiR3.artboards：0 号＝画布本身（Doc.width/height），其余存 Doc.aiR3.artboards.extra；当前画板＝AiWindow.artboardSel（画板面板同一个）。
     · 新建＝ai.artboard.new、改大小＝ai.artboard.setProps、删＝ai.artboard.delete、选＝ai.artboard.select、双击＝ai.artboard.options（对话框）。
     · 原码没有的命令在本档登记：aiartboard.move（＝artboard.move）、aiartboard.options（工具选项 moveArt／active）。
     · 粘贴板：我们的画布元素只有文件那么大，0 号画板盖满整张画布 ⇒ 画布外（#canvasWrap 的灰底）按下也接进本工具（只在本工具时）。
   共用件（aislice／aisliceselect／printtiling 读）：window.AiBoxKit（把手、scale_for_drag、move_delta、snap_draw、Measure 牌、虚线框）。 */
(function(){
'use strict';

/* ═══════════ 共用小件（bbox.rs／guides.rs／lib.rs） ═══════════ */
const zoom = () => Math.max((window.UI && UI.zoom) || 1, 1e-9);
const tol = px => px / zoom();                                                   // lib.rs:261
const BLUE = '#4a7cff';                                                          // xform.rs:50 BLUE
/* bbox.rs:19 Handle::ALL 顺序：左上、上、右上、右、右下、下、左下、左 */
const HANDLES = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'];
const cen = r => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
function hpos(h, r){                                                             // bbox.rs:22 pos
  const c = cen(r);
  return {tl:[r.x0, r.y0], t:[c[0], r.y0], tr:[r.x1, r.y0], r:[r.x1, c[1]], br:[r.x1, r.y1], b:[c[0], r.y1], bl:[r.x0, r.y1], l:[r.x0, c[1]]}[h];
}
const opposite = h => HANDLES[(HANDLES.indexOf(h) + 4) % 8];                    // bbox.rs:36
const isCorner = h => HANDLES.indexOf(h) % 2 === 0;                              // bbox.rs:38
const axes = h => (h === 't' || h === 'b') ? [false, true] : (h === 'l' || h === 'r') ? [true, false] : [true, true];   // bbox.rs:42
function hitHandle(r, p, t){                                                     // bbox.rs:52
  for (const h of HANDLES){ const q = hpos(h, r); if (Math.abs(q[0] - p[0]) <= t && Math.abs(q[1] - p[1]) <= t) return h; }
  return null;
}
/* bbox.rs:70 scale_for_drag(...).transform_rect_bbox(r)：直接回新矩形 */
function scaleForDrag(r, h, p, proportional, fromCenter){
  const o = fromCenter ? cen(r) : hpos(opposite(h), r), st = hpos(h, r), [ax, ay] = axes(h);
  const d0 = [st[0] - o[0], st[1] - o[1]], d1 = [p[0] - o[0], p[1] - o[1]];
  let sx = (ax && Math.abs(d0[0]) > 1e-9) ? d1[0] / d0[0] : 1;
  let sy = (ay && Math.abs(d0[1]) > 1e-9) ? d1[1] / d0[1] : 1;
  const sg = v => v < 0 ? -1 : 1;
  if (proportional){
    if (isCorner(h)){ const s = Math.abs(sx) > Math.abs(sy) ? sx : sy; sx = Math.abs(s) * sg(sx); sy = Math.abs(s) * sg(sy); }
    else if (ax) sy = Math.abs(sx); else sx = Math.abs(sy);
  }
  const clamp = s => Math.abs(s) < 1e-4 ? 1e-4 * (s < 0 ? -1 : 1) : s;
  sx = clamp(sx); sy = clamp(sy);
  const X = v => o[0] + (v - o[0]) * sx, Y = v => o[1] + (v - o[1]) * sy;
  const a = X(r.x0), b = X(r.x1), c = Y(r.y0), d = Y(r.y1);
  return {x0:Math.min(a, b), y0:Math.min(c, d), x1:Math.max(a, b), y1:Math.max(c, d)};
}
/* bbox.rs:107 move_delta：Shift＝geom constrain_angle(d, 45°)（长度不变、角度取最近的 45° 倍数） */
function moveDelta(from, to, shift){
  const d = [to[0] - from[0], to[1] - from[1]];
  if (!shift) return d;
  const len = Math.hypot(d[0], d[1]); if (len < 1e-9) return d;
  const step = Math.PI / 4, a = Math.round(Math.atan2(d[1], d[0]) / step) * step;
  return [Math.cos(a) * len, Math.sin(a) * len];
}
const rectFrom = (a, b) => ({x0:Math.min(a[0], b[0]), y0:Math.min(a[1], b[1]), x1:Math.max(a[0], b[0]), y1:Math.max(a[1], b[1])});
const contains = (r, p) => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;   // kurbo Rect::contains（含边）
/* guides.rs:160 snap_draw：对齐像素 → 对齐网格 → 智能参考线（借 rect.js 的 RectTool：Targets::collect／snap_point 已翻好） */
function snapDraw(p){
  const F = window.AiView ? AiView.flags : {};
  if (F.snapToPixel) return [[Math.round(p[0]), Math.round(p[1])], []];
  if (F.snapToGrid && window.AiView){ const g = AiView.gridSet.spacing / Math.max(1, AiView.gridSet.subdivisions); return [[Math.round(p[0] / g) * g, Math.round(p[1] / g) * g], []]; }
  if (F.smartGuides === false || !window.RectTool) return [[p[0], p[1]], []];
  return RectTool.snapPoint(RectTool.collectTargets(), p, tol(5));
}
/* lib.rs:265 readout（一般单位＝pt；我们 1 文件单位＝1 pt） */
const len = v => `${(+v).toFixed(2)} pt`;
const sizeLabel = (w, h) => `W: ${len(w)}\nH: ${len(h)}`;
const offsetLabel = (dx, dy) => `dX: ${len(dx)}\ndY: ${len(dy)}`;
/* canvas.rs:1188 Measure 牌 */
function drawMeasure(ctx, s, p, text){
  const lines = String(text).split('\n');
  ctx.save(); ctx.font = '11px sans-serif'; ctx.textBaseline = 'top';
  const w = Math.max(...lines.map(t => ctx.measureText(t).width)) + 12, h = lines.length * 13 + 8;
  const x = p[0] * s + 14, y = p[1] * s + 14;
  ctx.fillStyle = 'rgba(92,92,92,0.92)'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#fff'; lines.forEach((t, i) => ctx.fillText(t, x + 6, y + 4 + i * 13));
  ctx.restore();
}
/* Overlay::Path（虚线／实线框）＋ Overlay::Anchor（空心方块 size 7） */
function drawRect(ctx, s, r, color, dashed, width){
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width || 1; ctx.setLineDash(dashed ? [4, 3] : []);
  ctx.strokeRect(Math.round(r.x0 * s) + 0.5, Math.round(r.y0 * s) + 0.5, Math.round((r.x1 - r.x0) * s), Math.round((r.y1 - r.y0) * s));
  ctx.restore();
}
function drawHandles(ctx, s, r, color){
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([]);
  for (const h of HANDLES){ const q = hpos(h, r); const x = Math.round(q[0] * s) - 3.5, y = Math.round(q[1] * s) - 3.5; ctx.fillRect(x, y, 7, 7); ctx.strokeRect(x, y, 7, 7); }
  ctx.restore();
}
/* Overlay::Marquee（拖框）：细虚线 */
function drawMarquee(ctx, s, r){ drawRect(ctx, s, r, '#808080', true, 1); }
/* 游标（artboard.rs:194） */
const handleCursor = h => !h ? null : (h === 't' || h === 'b') ? 'ns-resize' : (h === 'l' || h === 'r') ? 'ew-resize' : (h === 'tl' || h === 'br') ? 'nwse-resize' : 'nesw-resize';
const mods = e => ({shift:!!(e && e.shiftKey), alt:!!(e && e.altKey)});
const R3 = () => window.AiR3;
const L3 = (hant, hans, en) => (window.Lang && Lang.cur === 'en') ? en : (window.Lang && Lang.cur === 'zh-Hans') ? hans : hant;

/* 画布外（#canvasWrap 灰底＝粘贴板）按下：只给登记过的工具（例：aiartboard），换算成文件坐标交给 Pointer（指针抓在 wrap 上，后续移动／放开都到这里） */
const PasteboardTools = new Set();
let pbDrag = null;
function bindPasteboard(){
  const wrap = document.getElementById('canvasWrap'), cv = window.UI && UI.canvas;
  if (!wrap || !cv || wrap.__aiPasteboard) return;
  wrap.__aiPasteboard = true;
  const toDoc = e => { const b = cv.getBoundingClientRect(); return [(e.clientX - b.left) / UI.zoom, (e.clientY - b.top) / UI.zoom]; };
  wrap.addEventListener('pointerdown', e => {
    if (e.target !== wrap || !PasteboardTools.has(ToolState.cur) || e.button !== 0) return;
    if (typeof HandTemp !== 'undefined' && HandTemp.space) return;
    pbDrag = e.pointerId; try { wrap.setPointerCapture(e.pointerId); } catch (_){}
    Pointer.onDown(e, toDoc(e));
  });
  wrap.addEventListener('pointermove', e => { if (pbDrag === e.pointerId) Pointer.onMove(e, toDoc(e)); });
  const up = e => { if (pbDrag !== e.pointerId) return; pbDrag = null; Pointer.onUp(e, toDoc(e)); };
  wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
  wrap.addEventListener('dblclick', e => { if (e.target === wrap && PasteboardTools.has(ToolState.cur)) Pointer.onDblClick(e, toDoc(e)); });
}
if (document.readyState === 'complete') bindPasteboard(); else window.addEventListener('load', bindPasteboard);

const Kit = window.AiBoxKit = {HANDLES, hpos, opposite, isCorner, axes, hitHandle, scaleForDrag, moveDelta, rectFrom, contains, snapDraw, tol, zoom,
  len, sizeLabel, offsetLabel, drawMeasure, drawRect, drawHandles, drawMarquee, handleCursor, mods, BLUE, PasteboardTools};

/* ═══════════ 命令（命名空间＝工具 id「aiartboard」） ═══════════ */
const boards = () => (R3() && R3().artboards) ? R3().artboards() : [{index:0, id:1, name:'Artboard 1', rect:{x0:0, y0:0, x1:Doc.width, y1:Doc.height}}];
const fail = error => ({ok:false, error});
const AB = window.AiArtboardTool = {active:0, moveArt:true, drag:null, preview:null};   // artboard.rs:22 ArtboardTool（active＝画板面板的当前画板）
const getActive = () => { const n = boards().length; const a = window.AiWindow ? AiWindow.artboardSel : AB.active; AB.active = Math.max(0, Math.min(n - 1, a | 0)); return AB.active; };
const setActive = i => { AB.active = i; if (CMD.map['ai.artboard.select']) CMD.run('ai.artboard.select', {index:i}); else if (window.AiWindow) AiWindow.artboardSel = i; };

/* xform.rs:371 artboard_move：完全落在画板里（几何外框）、没锁的顶层物件（图层没锁住位置）一起搬 */
function artInside(r){
  const out = [];
  for (const L of Doc.layers){
    if (L.kind !== 'vector' || (window.Locks && Locks.blocks(L, 'position'))) continue;
    for (const s of L.data.shapes){
      if (s.locked) continue;
      const b = window.AIObj ? AIObj.shapeBounds(s, q => [q[0] + L.x, q[1] + L.y], false) : null;
      if (b && contains(r, [b.x0, b.y0]) && contains(r, [b.x1, b.y1])) out.push({L, s});
    }
  }
  return out;
}
CMD.reg('aiartboard.move', {i18n:'', undoable:true, params:'{index（0＝画布）, dx, dy, moveArt?=false（true＝完全落在画板里、没锁的顶层物件一起搬）} 移动画板（xform.rs:371 artboard.move；画布那块＝改画布原点 crop.apply，取整）→ {ok, index, moved:[物件 id…]}'}, p => {
  const all = boards(), i = Math.floor(+p.index);
  if (!(i >= 0 && i < all.length)) return fail('aiartboard.move: no such artboard');
  let dx = isFinite(+p.dx) ? +p.dx : 0, dy = isFinite(+p.dy) ? +p.dy : 0;
  if (i === 0){ dx = Math.round(dx); dy = Math.round(dy); }                      // 画布原点只能整数挪（crop.apply）
  const r = all[i].rect, art = p.moveArt === true ? artInside(r) : [];
  const sh = window.shiftShape;
  art.forEach(({L, s}) => { sh(s, dx, dy); Layer.invalidate(L); });
  const res = CMD.map['ai.artboard.setProps'].run({index:i, x:r.x0 + dx, y:r.y0 + dy, width:r.x1 - r.x0, height:r.y1 - r.y0});
  if (res && res.ok === false) return res;
  return {ok:true, index:i, moved:art.map(a => a.s.id)};
});
CMD.reg('aiartboard.options', {i18n:'', params:'{moveArt?: bool（移动画板时连图稿一起搬，预设开）, active?: 当前画板编号（0 起）} 画板工具选项（artboard.rs:208-218；不进历史）；不给参数＝读 → {ok, active, moveArt}'}, p => {
  if (typeof p.moveArt === 'boolean') AB.moveArt = p.moveArt;
  if (p.active !== undefined){ const i = Math.floor(+p.active); if (!(i >= 0 && i < boards().length)) return fail('aiartboard.options: no such artboard'); setActive(i); }
  if (window.UI && ToolState.cur === 'aiartboard') UI.draw();
  return {ok:true, active:getActive(), moveArt:AB.moveArt};
});

/* ═══════════ 手势（artboard.rs:56-142） ═══════════ */
function down(e, pt){
  AB.drag = null; AB.preview = null;
  if (e.button !== undefined && e.button !== 0) return;
  const all = boards(), a = getActive();
  const r = all[a] && all[a].rect;
  if (r){ const h = hitHandle(r, pt, tol(5)); if (h){ AB.drag = {kind:'resize', index:a, handle:h, rect:Object.assign({}, r), began:false}; return; } }
  let hit = -1; for (let i = all.length - 1; i >= 0; i--) if (contains(all[i].rect, pt)){ hit = i; break; }
  if (hit >= 0){ setActive(hit); AB.drag = {kind:'move', index:hit, start:pt.slice(), began:false, d:[0, 0]}; }
  else { const [p] = snapDraw(pt); AB.drag = {kind:'create', start:p, cur:p}; }
  if (window.UI) UI.draw();
}
function move(e, pt){
  const d = AB.drag; if (!d) return;
  const m = mods(e), all = boards();
  if (d.kind === 'move'){
    if (!d.began){ if (Math.hypot(pt[0] - d.start[0], pt[1] - d.start[1]) < tol(3)) return; d.began = true; }
    d.d = moveDelta(d.start, pt, m.shift);
    const r = all[d.index] && all[d.index].rect;
    AB.preview = r ? {x0:r.x0 + d.d[0], y0:r.y0 + d.d[1], x1:r.x1 + d.d[0], y1:r.y1 + d.d[1]} : null;
  } else if (d.kind === 'resize'){
    d.began = true;
    AB.preview = scaleForDrag(d.rect, d.handle, pt, m.shift, m.alt);
  } else if (d.kind === 'create'){
    let [cur] = snapDraw(pt);
    if (m.shift){ const dx = cur[0] - d.start[0], dy = cur[1] - d.start[1], s = Math.max(Math.abs(dx), Math.abs(dy)); cur = [d.start[0] + (dx < 0 ? -s : s), d.start[1] + (dy < 0 ? -s : s)]; }
    d.cur = cur;
  }
  UI.draw();
}
const report = r => { if (r && r.ok === false && r.error) console.warn(r.error); return r; };
function up(e, pt){
  const d = AB.drag; AB.drag = null;
  const pv = AB.preview; AB.preview = null;
  if (!d){ UI.draw(); return; }
  if (d.kind === 'move' && d.began){
    if (d.d[0] || d.d[1]) report(CMD.run('aiartboard.move', {index:d.index, dx:d.d[0], dy:d.d[1], moveArt:AB.moveArt}));
  } else if (d.kind === 'resize' && d.began && pv){
    report(CMD.run('ai.artboard.setProps', {index:d.index, x:pv.x0, y:pv.y0, width:pv.x1 - pv.x0, height:pv.y1 - pv.y0}));
  } else if (d.kind === 'create'){
    const r = rectFrom(d.start, d.cur);
    if (!(r.x1 - r.x0 < tol(3) || r.y1 - r.y0 < tol(3))){
      const res = report(CMD.run('ai.artboard.new', {x:r.x0, y:r.y0, width:r.x1 - r.x0, height:r.y1 - r.y0}));
      if (res && res.ok !== false) setActive(boards().length - 1);                // notify("created")：新画板＝当前
    }
  }
  UI.draw();
}
/* Esc／换工具：拖到一半＝取消（我们拖曳中只画预览、放开才下命令 ⇒ 丢掉预览即可） */
function cancel(){ const busy = !!(AB.drag && (AB.drag.began || AB.drag.kind === 'create')); AB.drag = null; AB.preview = null; if (window.UI) UI.draw(); return busy; }

/* artboard.rs:170 overlays */
function overlay(ctx, s){
  const d = AB.drag;
  if (d && d.kind === 'create'){
    const r = rectFrom(d.start, d.cur);
    drawMarquee(ctx, s, r);
    drawMeasure(ctx, s, [d.cur[0] + tol(12), d.cur[1] + tol(12)], sizeLabel(r.x1 - r.x0, r.y1 - r.y0));
    return;
  }
  const all = boards(), a = getActive(), ab = all[a]; if (!ab) return;
  const r = AB.preview || ab.rect;
  drawRect(ctx, s, r, BLUE, true, 1);
  drawHandles(ctx, s, r, BLUE);
  ctx.save(); ctx.fillStyle = BLUE; ctx.font = '11px sans-serif'; ctx.textBaseline = 'top';
  ctx.fillText(`${String(a + 1).padStart(2, '0')} - ${ab.name}`, r.x0 * s, (r.y0 - tol(14)) * s);
  ctx.restore();
  if (d && d.kind === 'resize' && d.began) drawMeasure(ctx, s, [r.x1 + tol(12), r.y1 + tol(12)], sizeLabel(r.x1 - r.x0, r.y1 - r.y0));
}

const STRINGS = {
  'zh-Hant':{'opt.aiabMoveArt':'移動/拷貝含工作區域的圖稿', 'ui.aiabHint':'工作區域外拖曳＝新增（Shift 正方）· 拖曳工作區域＝移動（Shift 45°）· 拖把手改大小（Shift 等比、Alt 中心）· 雙擊＝選項 · Delete 刪除 · Esc 回選取工具',
    'ui.aiabDelete':'刪除工作區域', 'ui.aiabOptions':'工作區域選項'},
  'zh-Hans':{'opt.aiabMoveArt':'移动/复制带画板的图稿', 'ui.aiabHint':'画板外拖动＝新建（Shift 正方）· 拖画板＝移动（Shift 45°）· 拖把手改大小（Shift 等比、Alt 中心）· 双击＝画板选项 · Delete 删除 · Esc 回选择工具',
    'ui.aiabDelete':'删除画板', 'ui.aiabOptions':'画板选项'},
  'en':{'opt.aiabMoveArt':'Move/Copy Artwork with Artboard', 'ui.aiabHint':'Drag off the artboards to add one (Shift: square) · drag an artboard to move it (Shift: 45°) · drag a handle to resize (Shift: proportional, Alt: from centre) · double-click: options · Delete removes · Esc: Selection tool',
    'ui.aiabDelete':'Delete Artboard', 'ui.aiabOptions':'Artboard Options'}
};
PasteboardTools.add('aiartboard');

Tools.reg({
  id:'aiartboard', icon:'▭', group:'select', order:60, for:'vector', cursor:'crosshair', opts:[], strings:STRINGS,
  onDown(e, pt){ down(e, pt); },
  onMove(e, pt, P){
    if (AB.drag && P.down){ move(e, pt); return; }
    // artboard.rs:194 cursor
    const all = boards(), r = all[getActive()] && all[getActive()].rect, h = r ? hitHandle(r, pt, tol(5)) : null;
    if (window.UI) UI.canvas.style.cursor = handleCursor(h) || (all.some(a => contains(a.rect, pt)) ? 'move' : 'crosshair');
  },
  onUp(e, pt){ up(e, pt); },
  onDblClick(){
    AB.drag = null; AB.preview = null;
    const a = getActive(); if (boards()[a] && CMD.map['ai.artboard.options']) CMD.run('ai.artboard.options', {index:a});
  },
  onKey(e){
    if (e.ctrlKey || e.metaKey) return false;
    if ((e.key === 'Delete' || e.key === 'Backspace') && !AB.drag){
      e.preventDefault();
      const n = boards().length, i = getActive();
      if (n <= 1 || i >= n) return true;
      const r = report(CMD.run('ai.artboard.delete', {index:i}));
      if (r && r.ok !== false) setActive(Math.max(0, i - 1));
      UI.draw(); return true;
    }
    if (e.key === 'Escape'){
      if (!cancel() && window.UI) UI.pick('move');                                 // SwitchTool("selection")
      return true;
    }
    return false;
  },
  onDeactivate(){ cancel(); },
  drawOverlay(ctx, s){ overlay(ctx, s); },
  buildOptions(box, add){
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = AB.moveArt; cb.dataset.opt = 'moveArt';
    cb.onchange = () => CMD.run('aiartboard.options', {moveArt:cb.checked});
    add('aiabMoveArt', cb);
    const btn = (txt, tip, opt, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.title = Lang.t(tip); b.dataset.opt = opt; b.style.margin = '0 2px'; b.onclick = fn; box.appendChild(b); return b; };
    btn('⚙', 'ui.aiabOptions', 'options', () => CMD.run('ai.artboard.options', {index:getActive()}));
    btn('🗑', 'ui.aiabDelete', 'delete', () => { const i = getActive(); const r = report(CMD.run('ai.artboard.delete', {index:i})); if (r && r.ok !== false) setActive(Math.max(0, i - 1)); UI.draw(); });
    const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t('ui.aiabHint'); box.appendChild(h);
  }
});

})();
