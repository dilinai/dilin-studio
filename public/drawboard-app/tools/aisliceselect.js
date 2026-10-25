/* 切片选择工具（AI 版面 ai.slice-select）——照 VectorCraft 原码逐段翻译
   对照源（vectorcraft/crates/…）：
     tools/src/slice.rs 137-179   Drag（Move／Resize）、pickable（视图 ▸ 隐藏切片／锁定切片时都不能选）、
                                  slice_at（用户／对象切片里含这点的、重叠时取面积最小的；自动切片不算）、handle_at（选中的用户切片的 8 把手，tol 5）
     tools/src/slice.rs 181-258   按下：把手＝改大小；Shift 点切片＝加减选（object.slice.select toggle）；点已选的＝拖全部已选；点没选的＝只选它并拖它；
                                  点空处（没按 Shift、有选取）＝取消选取；拖超过 3 屏幕点才开始移动（Shift＝45° 约束）→ object.slice.move；
                                  把手拖＝scale_for_drag（Shift 等比、Alt 中心）→ object.slice.setRect（有面积才预览）；放开＝提交一步；
                                  双击＝（先只选它）开「切片选项」
     tools/src/slice.rs 260-318   Delete／Backspace（有选取、可选时才吃）＝object.slice.delete；Esc＝拖到一半取消；
                                  叠画＝选中切片的蓝框（用户切片且可选才画 8 把手）＋拖曳中的「W/H」量测牌；游标＝把手方向
   我们这边：接 ai-object.js 已有的切片资料与命令（AiR3.sliceLayout／selectedSlices、ai.object.slice.select／move／setRect／delete／options.dialog），
            视图 ▸ 隐藏／锁定切片＝AiView.flags.slicesHidden／slicesLocked（ai-view.js）。
            拖曳中只画预览（框跟着走），放开才下一次命令 ⇒ 同样一步历史。 */
(function(){
'use strict';
const K = window.AiBoxKit, SK = window.AiSliceKit;
const R3 = () => window.AiR3;
const F = () => (window.AiView ? AiView.flags : {});
const pickable = () => !F().slicesHidden && !F().slicesLocked;                  // slice.rs:158
const layout = () => (R3() && R3().sliceLayout) ? R3().sliceLayout() : [];
const selected = () => (R3() && R3().selectedSlices) ? R3().selectedSlices() : [];
const userSlice = id => { const d = R3() && R3().doc ? R3().doc('slices') : null; return d ? d.list.find(x => x.id === id) || null : null; };
const area = r => (r.x1 - r.x0) * (r.y1 - r.y0);
const boundsOf = id => { const a = layout().find(x => x.id === id); return a ? a.rect : null; };   // slice_bounds（剪到画板后的）

/* slice.rs:163 slice_at */
function sliceAt(p){
  let best = null;
  for (const a of layout()){ if (a.source === 'auto' || !a.id || !K.contains(a.rect, p)) continue; if (!best || area(a.rect) < area(best.rect)) best = a; }
  return best ? best.id : null;
}
/* slice.rs:170 handle_at：选中的用户切片（原始矩形）的把手 */
function handleAt(p){
  for (const id of selected()){ const u = userSlice(id); if (!u) continue; const h = K.hitHandle(u.rect, p, K.tol(5)); if (h) return {id, handle:h, rect:Object.assign({}, u.rect)}; }
  return null;
}
const selectIds = ids => CMD.run('ai.object.slice.select', {slices:ids});

const T = window.AiSliceSelectTool = {drag:null};
function down(e, p){
  T.drag = null;
  if (e.button !== undefined && e.button !== 0) return;
  if (!pickable()) return;
  const m = K.mods(e);
  const h = handleAt(p);
  if (h){ T.drag = Object.assign({kind:'resize', began:false, preview:null}, h); return; }
  const sel = selected(), id = sliceAt(p);
  if (id && m.shift) CMD.run('ai.object.slice.select', {slices:[id], toggle:true});
  else if (id && sel.includes(id)) T.drag = {kind:'move', start:p.slice(), ids:sel.slice(), began:false, d:[0, 0]};
  else if (id){ T.drag = {kind:'move', start:p.slice(), ids:[id], began:false, d:[0, 0]}; selectIds([id]); }
  else if (!m.shift && sel.length) selectIds([]);
  UI.draw();
}
function drag(e, p){
  const d = T.drag; if (!d) return;
  const m = K.mods(e);
  if (d.kind === 'move'){
    if (!d.began){ if (Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) < K.tol(3)) return; d.began = true; }
    d.d = K.moveDelta(d.start, p, m.shift);
  } else {
    d.began = true;
    const r = K.scaleForDrag(d.rect, d.handle, p, m.shift, m.alt);
    if (SK.hasArea(r)) d.preview = r;
  }
  UI.draw();
}
function up(){
  const d = T.drag; T.drag = null;
  if (d && d.began){
    let r = null;
    if (d.kind === 'move'){ if (d.d[0] || d.d[1]) r = CMD.run('ai.object.slice.move', {slices:d.ids, dx:d.d[0], dy:d.d[1]}); }
    else if (d.preview) r = CMD.run('ai.object.slice.setRect', Object.assign({id:d.id}, SK.rectJson(d.preview)));
    if (r && r.ok === false) console.warn(r.error);
  }
  UI.draw();
}
function cancel(){ const b = !!(T.drag && T.drag.began); T.drag = null; if (window.UI) UI.draw(); return b; }
function dbl(p){
  T.drag = null;
  if (!pickable()) return;
  const id = sliceAt(p); if (!id) return;
  const sel = selected();
  if (!(sel.length === 1 && sel[0] === id)) selectIds([id]);
  if (CMD.map['ai.object.slice.options.dialog']) CMD.run('ai.object.slice.options.dialog', {});
}
/* slice.rs:274 overlays */
function overlay(ctx, s){
  const d = T.drag, moving = d && d.kind === 'move' && d.began;
  for (const id of selected()){
    let r = boundsOf(id); if (!r) continue;
    if (moving && d.ids.includes(id)) r = {x0:r.x0 + d.d[0], y0:r.y0 + d.d[1], x1:r.x1 + d.d[0], y1:r.y1 + d.d[1]};
    if (d && d.kind === 'resize' && d.id === id && d.preview) r = d.preview;
    K.drawRect(ctx, s, r, K.BLUE, false, 1);
    if (userSlice(id) && pickable()) K.drawHandles(ctx, s, r, K.BLUE);
  }
  if (d && d.kind === 'resize' && d.began){
    const r = d.preview || d.rect;
    K.drawMeasure(ctx, s, [r.x1 + K.tol(12), r.y1 + K.tol(12)], K.sizeLabel(r.x1 - r.x0, r.y1 - r.y0));
  } else if (moving){
    const u = d.ids.map(boundsOf).filter(Boolean).reduce((a, b) => !a ? b : {x0:Math.min(a.x0, b.x0), y0:Math.min(a.y0, b.y0), x1:Math.max(a.x1, b.x1), y1:Math.max(a.y1, b.y1)}, null);
    if (u){ const r = {x0:u.x0 + d.d[0], y0:u.y0 + d.d[1], x1:u.x1 + d.d[0], y1:u.y1 + d.d[1]}; K.drawMeasure(ctx, s, [r.x1 + K.tol(12), r.y1 + K.tol(12)], K.sizeLabel(r.x1 - r.x0, r.y1 - r.y0)); }
  }
}

const STRINGS = {
  'zh-Hant':{'ui.aisssHint':'點切片＝選取（Shift 加減選）· 拖曳＝移動（Shift 45°）· 拖把手改大小（Shift 等比、Alt 中心）· 雙擊＝切片選項 · Delete 刪除'},
  'zh-Hans':{'ui.aisssHint':'点切片＝选择（Shift 加减选）· 拖动＝移动（Shift 45°）· 拖把手改大小（Shift 等比、Alt 中心）· 双击＝切片选项 · Delete 删除'},
  'en':{'ui.aisssHint':'Click a slice to select it (Shift adds/removes) · drag to move (Shift: 45°) · drag a handle to resize (Shift: proportional, Alt: from centre) · double-click: Slice Options · Delete removes'}
};
Tools.reg({
  id:'aisliceselect', icon:'⬚', group:'select', order:62, for:'vector', cursor:'default', opts:[], strings:STRINGS,
  hint:'ui.aisssHint',
  onDown(e, pt){ down(e, pt); },
  onMove(e, pt, P){
    if (P.down && T.drag){ drag(e, pt); return; }
    const h = pickable() ? handleAt(pt) : null;                                    // slice.rs:305 cursor
    if (window.UI) UI.canvas.style.cursor = K.handleCursor(h && h.handle) || 'default';
  },
  onUp(){ up(); },
  onDblClick(e, pt){ dbl(pt); },
  onKey(e){
    if (e.ctrlKey || e.metaKey) return false;
    if ((e.key === 'Delete' || e.key === 'Backspace') && !T.drag && selected().length && pickable()){   // claims_key
      e.preventDefault(); const r = CMD.run('ai.object.slice.delete', {}); if (r && r.ok === false) console.warn(r.error); UI.draw(); return true;
    }
    if (e.key === 'Escape') return cancel();
    return false;
  },
  onDeactivate(){ cancel(); },
  drawOverlay(ctx, s){ overlay(ctx, s); }
});
})();
