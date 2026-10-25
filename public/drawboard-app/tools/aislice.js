/* 切片工具（AI 版面 ai.slice，Shift+K）——照 VectorCraft 原码逐段翻译
   对照源（vectorcraft/crates/…）：
     tools/src/slice.rs 1-56     snap：先照绘图工具 snap_draw，再吸最近的标尺参考线（5 屏幕点内；参考线优先）；rect_json；has_area（宽高都 >1e-6）
     tools/src/slice.rs 58-135   SliceTool：按下（吸附）→ 拖超过 2 屏幕点才开始（Begin "Slice"）→ 每次拖曳预览 object.slice.create（Shift 正方、Alt 从中心；
                                 沿一轴拖＝没面积＝这次不预览）→ 放开＝提交一步；只点一下什么都不做；Esc 拖到一半＝取消；叠画＝吸附参考线＋「W/H」量测牌
     tools/src/shape.rs 97-104   drag_rect（Shift：较长边做正方；Alt：start 当中心）
     engine/src/cmd/slices.rs    object.slice.create（＝我们 ai-object.js 的 ai.object.slice.create：建用户切片、选中它）
   我们这边：拖曳中只画预览框（红线＝切片线色，canvas.rs:966-1011），放开才下一次 ai.object.slice.create ⇒ 同样一步历史。
            预览＝原码「最后一次有面积的预览」：沿一轴拖那几下不更新，放开提交的是上一个有面积的框（照 Preview/Commit 语义）。
   共用：window.AiBoxKit（aiartboard.js：snap_draw、Measure 牌）；本档挂 window.AiSliceKit（snap、dragRect、hasArea）给 aisliceselect 读。 */
(function(){
'use strict';
const K = window.AiBoxKit;
const LINE = '#ff3f3f';                                                          // canvas.rs 切片线色

/* slice.rs:33 has_area */
const hasArea = r => (r.x1 - r.x0) > 1e-6 && (r.y1 - r.y0) > 1e-6;
/* slice.rs:39 snap：snap_draw 后，x 吸最近的直参考线、y 吸最近的横参考线（tol 5 屏幕点） */
function snap(p){
  const [q, ov] = K.snapDraw(p), t = K.tol(5);
  const G = (window.AiView && AiView.flags.guides !== false) ? AiView.guides() : [];
  const nearest = (vertical, v) => { let best = null; for (const g of G){ if (!!g.vertical !== vertical || Math.abs(g.pos - v) > t) continue; if (!best || Math.abs(g.pos - v) < Math.abs(best.pos - v)) best = g; } return best; };
  const out = q.slice();
  const gx = nearest(true, p[0]); if (gx) out[0] = gx.pos;
  const gy = nearest(false, p[1]); if (gy) out[1] = gy.pos;
  return [out, ov];
}
/* shape.rs:97 drag_rect */
function dragRect(start, p, m){
  let d = [p[0] - start[0], p[1] - start[1]];
  if (m.shift){ const s = Math.max(Math.abs(d[0]), Math.abs(d[1])); d = [s * Math.sign(d[0]), s * Math.sign(d[1])]; }
  return m.alt ? K.rectFrom([start[0] - d[0], start[1] - d[1]], [start[0] + d[0], start[1] + d[1]]) : K.rectFrom(start, [start[0] + d[0], start[1] + d[1]]);
}
const rectJson = r => ({x:r.x0, y:r.y0, width:r.x1 - r.x0, height:r.y1 - r.y0});   // slice.rs:29

/* slice.rs:59 SliceTool */
const S = window.AiSliceTool = {start:null, last:[0, 0], began:false, guides:[], rect:null};
function down(e, pt){
  if (e.button !== undefined && e.button !== 0) return;
  const [p] = snap(pt);
  S.start = p; S.last = p; S.began = false; S.rect = null; S.guides = [];
}
function drag(e, pt){
  if (!S.start) return;
  const [p, guides] = snap(pt);
  S.last = p; S.guides = guides;
  if (!S.began){ if (Math.hypot(p[0] - S.start[0], p[1] - S.start[1]) < K.tol(2)) return; S.began = true; }
  const r = dragRect(S.start, p, K.mods(e));
  if (hasArea(r)) S.rect = r;                                                   // Preview("object.slice.create")
  UI.draw();
}
function up(){
  S.guides = [];
  const began = S.began, r = S.rect; S.began = false; S.start = null; S.rect = null;
  if (began && r){ const res = CMD.run('ai.object.slice.create', rectJson(r)); if (res && res.ok === false) console.warn(res.error); }   // Commit
  UI.draw();
}
function cancel(){ S.start = null; S.guides = []; S.rect = null; const b = S.began; S.began = false; if (window.UI) UI.draw(); return b; }
/* 智能参考线叠画（rect.js 的吸附回来的 {type:'line'|'label'}） */
function drawGuides(ctx, s, ov){
  if (!ov || !ov.length) return;
  ctx.save(); ctx.strokeStyle = '#ff2fd2'; ctx.fillStyle = '#ff2fd2'; ctx.lineWidth = 1; ctx.font = '10px sans-serif';
  for (const g of ov){
    if (g.type === 'line'){ ctx.beginPath(); ctx.moveTo(g.a[0] * s, g.a[1] * s); ctx.lineTo(g.b[0] * s, g.b[1] * s); ctx.stroke(); }
    else if (g.type === 'label') ctx.fillText(g.kind, g.p[0] * s + 6, g.p[1] * s - 4);
  }
  ctx.restore();
}
function overlay(ctx, s){
  if (!(S.start && S.began)) return;
  if (S.rect) K.drawRect(ctx, s, S.rect, LINE, false, 1);                         // 预览中的切片
  drawGuides(ctx, s, S.guides);
  K.drawMeasure(ctx, s, S.last, K.sizeLabel(Math.abs(S.last[0] - S.start[0]), Math.abs(S.last[1] - S.start[1])));   // slice.rs:119
}

window.AiSliceKit = {LINE, hasArea, snap, dragRect, rectJson, drawGuides};

const STRINGS = {
  'zh-Hant':{'ui.aislHint':'拖曳＝建立切片（Shift 正方、Alt 從中心；貼齊參考線）· Esc 取消'},
  'zh-Hans':{'ui.aislHint':'拖动＝创建切片（Shift 正方、Alt 从中心；吸附参考线）· Esc 取消'},
  'en':{'ui.aislHint':'Drag to make a slice (Shift: square, Alt: from the centre; snaps to guides) · Esc cancels'}
};
Tools.reg({
  id:'aislice', icon:'✂', group:'select', order:61, for:'vector', cursor:'crosshair', opts:[], strings:STRINGS,
  hint:'ui.aislHint',
  onDown(e, pt){ down(e, pt); },
  onMove(e, pt, P){ if (P.down && S.start) drag(e, pt); },
  onUp(){ up(); },
  onKey(e){ if (e.key === 'Escape' && S.began){ cancel(); return true; } return false; },   // slice.rs:110
  onDeactivate(){ cancel(); },
  drawOverlay(ctx, s){ overlay(ctx, s); }
});
})();
