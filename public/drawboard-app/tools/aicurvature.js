/* 曲率工具（AI 版面 ai.curvature，Shift+~）——照 vectorcraft/crates/tools/src/draw2/curvature.rs 全档（CurvatureTool）＋
   draw2.rs:36-59 catmull_rom ＋ engine/src/cmd/draw2.rs path.curvature。
   这份原码 PS 那颗「弯度钢笔」（tools/curvaturepen.js，window.CurvaturePen）已逐段翻过；AI 这颗是同一支 Rust 档 ⇒ 不另抄一份，
   用 Object.create(CurvaturePen) 借它的方法（down／move／up／dbl／key／overlay……全用 this），状态自己一份，互不干扰：
     每点一下加一点，路径以 Catmull-Rom 平滑穿过所有点；Alt＋点（新点）＝直角点；Alt＋点 或 双击 已有的点＝平滑⇄直角；
     拖已有的点＝移动（超过 3 屏幕像素才算，一整拖一步历史）；点第一个点（≥3 点、未闭合）＝闭合；
     Backspace／Delete＝删最后碰过的点（剩不到 3 点就打开）；Esc／Enter＝结束这条；画的那条要仍是唯一选中、锚点数对得上才算还在画；
     叠画：到游标的橡皮筋曲线（1px 蓝）＋每点方块（最后碰过的实心）；换工具时拖到一半＝照预览收下。
   改文件只走 CMD：aicurvature.set（＝path.curvature，内部叫 curvaturepen.set 的同一份实作）；aicurvature.state 读状态。 */
(function(){
'use strict';
if (!window.CurvaturePen){ console.error('aicurvature: tools/curvaturepen.js 没载入'); return; }

const AC = Object.create(window.CurvaturePen);
Object.assign(AC, {pts:[], closed:false, id:null, drag:null, current:null, hover:null});
/* 每个 Exec 一步历史：走自己命名空间的命令 */
AC.exec = function(){
  const r = CMD.run('aicurvature.set', this.params());
  if (r && r.ok !== false && r.id && !this.id) this.id = {layerId:r.layerId, shapeId:r.id};
  return r;
};
window.AiCurvature = AC;

CMD.reg('aicurvature.set', {i18n:'', undoable:true,
  params:'{points:[{x,y,corner?}]（或 [[x,y]…]）文件坐标 ≥1 点, closed?:bool, shapeId?（给了＝整条换掉那条路径）, layerId?} ' +
         '＝ AI 曲率工具（VectorCraft path.curvature）：Catmull-Rom 平滑穿过各点（corner＝直角点、开放路径两端没把手）；没 shapeId＝新路径画进当前矢量层，' +
         '填色＋描边用目前的、两样都没有＝黑描边；选中它 → {ok, id, layerId, anchors, closed}'},
  p => CMD.map['curvaturepen.set'].run(p || {}));
CMD.reg('aicurvature.state', {i18n:'', params:'{} → {active, points:[{x,y,corner}], closed, shapeId, layerId, current}  曲率工具正在画的那条'}, () => {
  const a = AC.active();
  return {ok:true, active:!!a, points:AC.pts.map(q => ({x:q.p[0], y:q.p[1], corner:!!q.corner})), closed:AC.closed,
          shapeId:AC.id ? AC.id.shapeId : null, layerId:AC.id ? AC.id.layerId : null, current:AC.current};
});

Tools.reg({
  id:'aicurvature', icon:'〰', group:'vector', order:14, for:'vector', needs:'vector', opts:[], cursor:'crosshair',
  hint:'ui.acvHint',
  strings:{
    'zh-Hant':{'tool.aicurvature':'曲率工具', 'ui.acvHint':'點一下＝加點（路徑平滑穿過各點）｜Alt＋點＝尖角點｜雙擊或 Alt＋點已有的點＝平滑⇄尖角｜拖點＝移動｜點第一點＝封閉｜Delete 刪點｜Esc／Enter 結束'},
    'zh-Hans':{'tool.aicurvature':'曲率工具', 'ui.acvHint':'点一下＝加点（路径平滑穿过各点）｜Alt＋点＝角点｜双击或 Alt＋点已有的点＝平滑⇄角点｜拖点＝移动｜点第一点＝闭合｜Delete 删点｜Esc／Enter 结束'},
    'en':{'tool.aicurvature':'Curvature Tool', 'ui.acvHint':'Click to add a point (the path curves through them) | Alt+click: corner point | Double-click or Alt+click a point: smooth ⇄ corner | Drag a point to move it | Click the first point: close | Delete removes a point | Esc / Enter: finish'}
  },
  onDown(e, pt){ if (e.button !== undefined && e.button !== 0) return; AC.hover = pt; AC.down(e, pt); UI.draw(); },
  onMove(e, pt, P){
    AC.hover = [pt[0], pt[1]];
    if (P.down){ if (AC.move(e, pt)) UI.draw(); return; }
    if (AC.active()) UI.draw();                                   // 橡皮筋跟着游标
  },
  onUp(){ AC.up(); UI.draw(); },
  onDblClick(e, pt){ AC.dbl(pt); UI.draw(); },
  onKey(e){ if (AC.key(e)){ UI.draw(); return true; } return false; },
  /* curvature.rs:160-164 deactivate：拖到一半＝照预览收下 */
  onDeactivate(){
    const d = AC.drag;
    if (d && d.began){ const h = AC.shape(); if (h && d.snap){ VecSel.restoreShape(h.s, d.snap); Layer.invalidate(h.L); } AC.drag = null; AC.exec(); }
    AC.reset(); AC.hover = null;
  },
  onUndoKey(){ return !!(AC.drag && AC.drag.began); },            // 拖到一半 Ctrl+Z 先不让退（形状是预览）
  drawOverlay(ctx, s){ AC.overlay(ctx, s); }
});
if (typeof Lang !== 'undefined') Lang.add(Tools.get('aicurvature').strings);
})();
