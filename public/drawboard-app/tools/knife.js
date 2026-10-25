/* 堤麟画板 · AI 美工刀（ai.knife）
   照 VectorCraft 原码逐段翻：
     tools/src/draw2/gesture.rs:129,157-189,229  拖曳收折线（每移 ≥1 屏幕像素一点）、放开 ≥2 点就跑 path.knife；叠画＝蓝色虚线 1px；Esc 取消
     engine/src/cmd/draw2.rs:806-842 knife      沿折线切开「闭合」形状（有选取＝选中的，没选取＝全部；外框要碰到 poly_bounds(pts, 1)）：
                                                 刀口＝折线描成宽 0.05、平头、圆角接合的细条（KNIFE_GAP），形状 − 细条 后按连通拆成几块（components），
                                                 ≥2 块才算切开：第一块留原 id，其余（同外观）插在它正上方；全部切到的块被选中；一刀一步历史；没切开任何形状＝什么都不做
   共用：tools/blobbrush.js 的 window.HandKit（target_paths、components、replace_with_pieces、区域运算）。
   ── 没抄的 ──  原码也没有 Alt（直线刀）／Shift+Alt（45° 直线）——那是 AI 2020 的，这里照原码，没加。开放路径不切（原码 `if !pd.is_closed() continue`）。 */
(function(){
'use strict';
const HK = window.HandKit;
const KNIFE_GAP = 0.05;                                   // draw2.rs:809

CMD.reg('knife.cut', {i18n:'', undoable:false,
  params:'{points:[[x,y]…] 文件坐标（≥2 点）, layerId?} ＝ path.knife 美工刀：沿这条折线把闭合形状切开（有选取＝只切选中的；没选取＝整层），' +
         '刀口宽 0.05；切成 ≥2 块的形状：第一块留原 id、其余同外观插在正上方；选中全部的块；一个都没切开＝不改文件 → {ok, ids, layerId}'}, p => {
  const C = 'knife.cut';
  const r = HK.pointsParam(p, 'points', C); if (r.err) return r.err;
  if (r.pts.length < 2) return {ok:false, error:C + ': need at least two points'};
  const L = HK.layerOf(p); if (!L) return {ok:false, error:C + ': not a vector layer'};
  const f = HK.lockFail(L, C); if (f) return f;
  const pts = HK.toLayerPts(L, r.pts);
  const strip = HK.strokeLoops(pts, KNIFE_GAP, 'butt', 'round');
  const plan = [];
  for (const e of HK.targetPaths(L, HK.selIds(L), HK.polyBounds(pts, 1))){
    const pd = HK.pdOf(e.s);
    if (!pd.length || !pd.every(sp => sp.closed)) continue;
    const loops = HK.AO().arrangement([{polys:HK.flatPd(pd), rule:'nonzero'}, {polys:strip, rule:'nonzero'}], m => m[0] && !m[1]);
    const comps = HK.components(loops);
    if (comps.length >= 2) plan.push([e, comps.map(c => HK.loopsToPd(c)).filter(pd => pd.length)]);
  }
  return HK.applyPlan(L, plan.filter(x => x[1].length >= 2));
});

const KG = HK.gesture({finish(pts){ if (pts.length >= 2) CMD.run('knife.cut', {points:pts}); }});
window.KnifeTool = {g:KG};

Tools.reg({
  id:'knife', icon:'🔪', group:'vector', order:46, for:'vector', needs:'vector', opts:[], cursor:'crosshair',
  hint:'ui.knifeHint',
  strings:{
    'zh-Hant':{'tool.knife':'美工刀', 'ui.knifeHint':'拖曳劃過封閉形狀＝沿著劃線切開（有選取只切選取的）｜Esc 取消'},
    'zh-Hans':{'tool.knife':'美工刀', 'ui.knifeHint':'拖曳划过闭合形状＝沿划线切开（有选取只切选中的）｜Esc 取消'},
    'en':{'tool.knife':'Knife', 'ui.knifeHint':'Drag across closed shapes to cut them along the stroke (only the selected ones if any) | Esc: cancel'}
  },
  onDown(e, pt){ KG.down(e, pt); },
  onMove(e, pt, P){ KG.move(e, pt, P); },
  onUp(e, pt){ KG.up(e, pt); },
  onKey(e){ return KG.key(e); },
  onDeactivate(){ KG.reset(); },
  drawOverlay(ctx, s){ KG.draw(ctx, s, HK.FEEDBACK, 1, true); }
});
})();
