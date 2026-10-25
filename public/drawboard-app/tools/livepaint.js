/* 实时上色油漆桶（AI K）——照 VectorCraft 原始码逐段翻译：
     tools/src/builder.rs:71-99    face_at（画的顺序最后一个包含该点的面）、edge_near（tol 内最近的边）、live_paint_at（看得见的实时上色组、有面在点下，取最上面那个）
     tools/src/builder.rs:386-435  LpHover（None／Part＝现有实时上色组的面或边／Region＝还没变实时上色的选取的区域）、lp_hover、lp_overlays（红色 #ff2a2a、4 像素粗的轮廓）
     tools/src/builder.rs:437-498  LivePaintBucketTool：Move＝悬停（Shift＝找边）；Down：
                                     Shift ⇒ 点下的实时上色组（没有就找任何一个边在 tol(4) 内的组）→ livePaint.strokeEdge{group, point, tolerance: tol(4)}；
                                     否则点在某实时上色组的面上 ⇒ livePaint.fill{group, point}；
                                     否则点在选取的某个区域上 ⇒ livePaint.fill{ids（后→前）, point}（先把选中的路径做成实时上色组再填）；都不是＝什么都不做；游标十字
     engine/src/cmd/buildcmds.rs:552-602  lp_fill（缺省颜色＝目前填色）、lp_stroke_edge（缺省＝目前描边色与描边粗细；tolerance 缺省 4）
   接上菜单那份：实时上色组的资料结构与 livePaint.fill／strokeEdge 已在 menus/impl/ai-object.js（ai.livePaint.*、AiR3.livePaint）照同一份原码做好，
     本档不另起一套——滑鼠按下就叫 ai.livePaint.fill／ai.livePaint.strokeEdge（颜色、粗细带目前的填色／描边）；
     区域、取样、斜线网用 tools/shapebuilder.js 挂的 window.BuildKit。
   agent：livepaint.click {point, shift?} 做跟滑鼠按下完全一样的判断再叫上面那两条（一步历史）。 */
(function(){
'use strict';
const K = () => window.BuildKit, LP = () => window.AiR3 && AiR3.livePaint;
const toL = (L, p) => [p[0] - L.x, p[1] - L.y];

/* 走遍一层看得见的物件（隐藏的子树不进去） */
function walkVisible(arr, cb){ (arr || []).forEach(n => { if (!n || n.visible === false) return; cb(n); if (Array.isArray(n.children)) walkVisible(n.children, cb); }); }
function walkAll(arr, cb){ (arr || []).forEach(n => { if (!n) return; cb(n); if (Array.isArray(n.children)) walkAll(n.children, cb); }); }
const vecLayers = () => Doc.layers.filter(L => L.kind === 'vector');
/* live_paint_at：看得见的实时上色组里有面在点下（文件坐标）的，取画的顺序最后一个（最上面）→ {L, g} */
function liveAt(pt){
  let hit = null;
  for (const L of vecLayers()){
    if (!L.visible) continue;
    walkVisible(L.data.shapes, n => { if (K().isLP(n) && LP().faceAt(n, toL(L, pt))) hit = {L, g:n}; });
  }
  return hit;
}
/* 任何一个实时上色组有边在 tol 内（builder.rs:463-469：走全部，取最后一个） */
function edgeGroupAt(pt, tol){
  let hit = null;
  for (const L of vecLayers()) walkAll(L.data.shapes, n => { if (K().isLP(n) && LP().edgeNear(n, toL(L, pt), tol)) hit = {L, g:n}; });
  return hit;
}
/* lp_hover（builder.rs:399-423）→ null | {part, L} | {region, L} */
function lpHover(cache, pt, edge){
  const tol = VecSel.tol(4), h = liveAt(pt);
  if (h){
    const part = edge ? LP().edgeNear(h.g, toL(h.L, pt), tol) : LP().faceAt(h.g, toL(h.L, pt));
    return part ? {part, L:h.L} : null;
  }
  if (edge){
    let found = null;
    for (const L of vecLayers()) walkAll(L.data.shapes, n => { if (K().isLP(n)){ const e = LP().edgeNear(n, toL(L, pt), tol); if (e) found = {part:e, L}; } });
    if (found) return found;
  }
  const SL = VecSel.layer();
  const selIsLive = !!SL && SL.kind === 'vector' && K().sortedRoots(SL).some(K().isLP);
  if (!selIsLive){ const i = cache.at(pt); if (i >= 0) return {region:i, L:cache.L}; }
  return null;
}
/* lp_overlays：红色 4 像素粗的轮廓（面＝闭合、边＝开放） */
function drawHover(ctx, s, h, cache){
  if (!h) return;
  ctx.save(); ctx.strokeStyle = K().HIGHLIGHT_RED; ctx.lineWidth = 4; ctx.setLineDash([]); ctx.lineJoin = 'round';
  if (h.part){
    const v = VecSel.asBezier(h.part); if (v && v.anchors && v.anchors.length){
      const P = AIObj.flatten(v);
      K().pathLoops(ctx, h.L, [P], s, !!v.closed); ctx.stroke();
    }
  } else if (h.region !== undefined){
    const r = cache.regs[h.region]; if (r){ K().pathLoops(ctx, h.L, r.loops, s); ctx.stroke(); }
  }
  ctx.restore();
}
/* 按下那一下（builder.rs:458-486）要叫哪条命令：→ {cmd, params} | null */
function decide(cache, pt, shift, paint){
  const tol = VecSel.tol(4), point = [pt[0], pt[1]];
  if (shift){
    const g = liveAt(pt) || edgeGroupAt(pt, tol);
    return g ? {cmd:'ai.livePaint.strokeEdge', params:{group:g.g.id, point, tolerance:tol, color:paint.stroke, width:paint.width}} : null;
  }
  const g = liveAt(pt);
  if (g) return {cmd:'ai.livePaint.fill', params:{group:g.g.id, point, color:paint.fill}};
  if (cache.at(pt) >= 0){
    cache.reset();
    const L = VecSel.layer();
    return {cmd:'ai.livePaint.fill', params:{ids:K().sortedRoots(L).map(s => s.id), layerId:L.id, point, color:paint.fill}};
  }
  return null;
}
/* 目前的填色／描边（Session.paint.fill／stroke／stroke_width） */
const curPaint = () => ({fill:UI.fill(), stroke:UI.stroke(), width:UI.strokeW()});

const LPB = {cache:null, hover:null, shift:false};
window.LivePaintKit = {liveAt, edgeGroupAt, lpHover, drawHover, decide, curPaint};
window.LivePaintTool = LPB;

CMD.reg('livepaint.click', {i18n:'',
  params:'{point:[x,y] 文件坐标, shift?:false, color?, width?, tolerance?} 实时上色油漆桶点一下（builder.rs:458-486，跟滑鼠按下同一套判断）：'
    + 'shift＝点下（或边在 tolerance 内，缺省 4 屏幕像素）的实时上色组，把最近的边描边（ai.livePaint.strokeEdge，颜色／粗细缺省＝目前描边）；'
    + '否则点在实时上色组的面上＝那个面填色（ai.livePaint.fill，缺省＝目前填色）；否则点在选中物件的某个区域上＝先把选中的物件做成实时上色组再填色；都不是回 {ok:false}。'
    + '一步历史 → {ok, cmd, group, face?|edge?}'}, p => {
  if (!window.BuildKit || !LP()) return {ok:false, error:'livepaint.click: menus/impl/ai-object.js 没载入'};
  if (!Array.isArray(p.point) || !isFinite(+p.point[0]) || !isFinite(+p.point[1])) return {ok:false, error:'livepaint.click: missing point [x,y]'};
  const pt = [+p.point[0], +p.point[1]], paint = curPaint();
  if (p.color !== undefined){ if (p.shift) paint.stroke = String(p.color); else paint.fill = String(p.color); }
  if (p.width !== undefined) paint.width = +p.width;
  const d = decide(K().makeCache(), pt, !!p.shift, paint);
  if (!d) return {ok:false, error:'livepaint.click: nothing to paint at that point'};
  if (p.tolerance !== undefined && d.params.tolerance !== undefined) d.params.tolerance = +p.tolerance;
  const r = CMD.run(d.cmd, d.params);
  return Object.assign({cmd:d.cmd}, r);
});

Tools.reg({
  id:'livepaint', icon:'◪', group:'vector', order:61, for:'vector', opts:[], cursor:'crosshair', hint:'ui.livepaintHint',
  strings:{
    'zh-Hant':{'tool.livepaint':'即時上色油漆桶工具', 'ui.livepaintHint':'點一塊面＝填上目前的填色（選取的路徑會先變成即時上色群組）；Shift＋點邊線＝套上目前的筆畫'},
    'zh-Hans':{'tool.livepaint':'实时上色工具', 'ui.livepaintHint':'点一块面＝填上目前的填色（选中的路径会先变成实时上色组）；Shift＋点边线＝套上目前的描边'},
    'en':{'tool.livepaint':'Live Paint Bucket Tool', 'ui.livepaintHint':'Click a face to fill it with the current fill (selected paths become a Live Paint group first); Shift-click an edge to apply the current stroke'}
  },
  onMove(e, pt){
    if (!window.BuildKit || !LP()) return;
    if (!LPB.cache) LPB.cache = K().makeCache();
    if (e.buttons & 1) return;
    LPB.hover = lpHover(LPB.cache, pt, !!e.shiftKey); LPB.shift = !!e.shiftKey;
    UI.draw();
  },
  onDown(e, pt){
    if (!window.BuildKit || !LP()) return;
    if (!LPB.cache) LPB.cache = K().makeCache();
    LPB.hover = null;
    const d = decide(LPB.cache, pt, !!e.shiftKey, curPaint());
    if (d) CMD.run(d.cmd, d.params);
    UI.draw();
  },
  onUp(){ UI.draw(); },
  onDeactivate(){ LPB.hover = null; if (LPB.cache) LPB.cache.reset(); },
  drawOverlay(ctx, s){
    VecSel.drawOverlay(ctx, s);
    if (LPB.cache) drawHover(ctx, s, LPB.hover, LPB.cache);
  }
});
})();
