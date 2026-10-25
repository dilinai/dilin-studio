/* 堤麟画板 · AI 路径橡皮擦工具（ai.path-eraser）
   照 VectorCraft 原码逐段翻：
     tools/src/draw2/gesture.rs:133,157-189,229  拖曳收折线；放开时「有选取」才跑 path.eraseSegments，宽度＝8 屏幕像素（cx.tol(8)）；叠画蓝线 1px；Esc 取消
     engine/src/cmd/draw2.rs:884-900 erase_segments  选中的路径（外框碰到 poly_bounds(pts, w)）沿轮廓线取样：离折线 ≤ w/2 的部分切掉（erase_outline／cut_subpath：
                                                 每段 24 等分取样、交界二分 30 次求准；闭合路径的头尾两片在锚点 0 接回一片），剩下的变成开放片段；
                                                 一个子路径的路径＝每片各成一个物件（第一片留原 id、其余同外观插在正上方）；全擦掉＝删掉；选中全部剩下的片；一步历史
   共用：tools/blobbrush.js 的 window.HandKit（cut_subpath、erase_outline、replace_with_pieces）。
   ── 没抄的 ──  无（原码也没有选项）。 */
(function(){
'use strict';
const HK = window.HandKit;

CMD.reg('patheraser.erase', {i18n:'', undoable:false,
  params:'{points:[[x,y]…] 文件坐标, width?:8（擦除宽度，文件单位，须 >0；工具用 8 屏幕像素换算）, layerId?} ＝ path.eraseSegments 路径橡皮擦：' +
         '只擦「选中的」路径：沿轮廓离这条折线 ≤ width/2 的部分切掉，剩下的成开放路径片段（同外观），选中它们；没有选取＝错误 → {ok, ids, layerId}'}, p => {
  const C = 'patheraser.erase';
  const r = HK.pointsParam(p, 'points', C); if (r.err) return r.err;
  const w = HK.f64(p, 'width', 8);
  if (!(HK.fin(w) && w > 0)) return {ok:false, error:C + ': width must be positive'};
  const L = HK.layerOf(p); if (!L) return {ok:false, error:C + ': not a vector layer'};
  const sel = HK.selIds(L);
  if (!sel.length) return {ok:false, error:C + ': nothing selected'};          // has_selection
  const f = HK.lockFail(L, C); if (f) return f;
  const pts = HK.toLayerPts(L, r.pts), plan = [];
  for (const e of HK.targetPaths(L, sel, HK.polyBounds(pts, w))){
    const pieces = HK.eraseOutline(HK.pdOf(e.s), q => HK.distToPolyline(pts, q) <= w / 2);
    if (pieces) plan.push([e, pieces]);
  }
  return HK.applyPlan(L, plan);
});

const PG = HK.gesture({finish(pts){
  const L = HK.layerOf({});
  if (!L || !HK.selIds(L).length) return;                                   // gesture.rs:133 "pathEraser" if has_sel
  CMD.run('patheraser.erase', {points:pts, width:HK.tol(8)});
}});
window.PathEraserTool = {g:PG};

Tools.reg({
  id:'patheraser', icon:'⌫', group:'vector', order:44, for:'vector', needs:'vector', opts:[], cursor:'crosshair',
  hint:'ui.peHint',
  strings:{
    'zh-Hant':{'tool.patheraser':'路徑橡皮擦工具', 'ui.peHint':'沿著選取的路徑拖曳＝擦掉拖過的那段路徑（要先選取路徑）｜Esc 取消'},
    'zh-Hans':{'tool.patheraser':'路径橡皮擦工具', 'ui.peHint':'沿选中的路径拖曳＝擦掉拖过的那段路径（要先选中路径）｜Esc 取消'},
    'en':{'tool.patheraser':'Path Eraser Tool', 'ui.peHint':'Drag along a selected path to erase the part under the drag (select a path first) | Esc: cancel'}
  },
  onDown(e, pt){ PG.down(e, pt); },
  onMove(e, pt, P){ PG.move(e, pt, P); },
  onUp(e, pt){ PG.up(e, pt); },
  onKey(e){ return PG.key(e); },
  onDeactivate(){ PG.reset(); },
  drawOverlay(ctx, s){ if (window.VecSel) VecSel.drawOverlay(ctx, s); PG.draw(ctx, s, HK.FEEDBACK, 1, false); }
});
})();
