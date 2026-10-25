/* 实时上色选择工具（AI Shift+L）——照 VectorCraft 原始码逐段翻译：
     tools/src/builder.rs:500-548  LivePaintSelectionTool：
       Move ⇒ lp_hover（Alt＝找边），只留「现有实时上色组的面／边」那种（Part），区域不亮；
       Down ⇒ 点在某实时上色组的面上：Alt＝那组里 tol(4) 内最近的边、否则＝点下的面；
              (有命中, Shift) ⇒ select.toggle(那个)；(有命中, 没 Shift) ⇒ select.set([那个])；(没命中, Shift) ⇒ 什么都不做；(没命中, 没 Shift) ⇒ select.none；
       overlays＝lp_overlays（红色 4 像素粗的轮廓）；游标＝箭头
     tools/src/builder.rs:71-99    face_at／edge_near／live_paint_at（用 livepaint.js 的 LivePaintKit 与 ai-object 的 AiR3.livePaint）
   我们这边：面／边在实时上色组（编组）里面 ⇒ 用 AiR3.selectDeep 深层选取（VecSel 留深层 id，ai-object 那段负责画选取框）；
     原码选取不进历史（Session::select），这里同样不是 undoable。
   agent：livepaintselect.click {point, shift?, alt?} 跟滑鼠按下同一套判断。 */
(function(){
'use strict';
const KIT = () => window.LivePaintKit, LP = () => window.AiR3 && AiR3.livePaint;

/* 按下那一下要选什么：→ {L, id} | null */
function hitAt(pt, alt, tol){
  const h = KIT().liveAt(pt); if (!h) return null;
  const q = [pt[0] - h.L.x, pt[1] - h.L.y];
  const part = alt ? LP().edgeNear(h.g, q, tol) : LP().faceAt(h.g, q);
  return part ? {L:h.L, id:part.id} : null;
}
function click(pt, shift, alt, tol){
  const hit = hitAt(pt, alt, tol);
  if (hit && shift){                                                  // select.toggle
    const cur = VecSel.layerId === hit.L.id ? VecSel.shapes.slice() : [];
    const i = cur.indexOf(hit.id); if (i >= 0) cur.splice(i, 1); else cur.push(hit.id);
    AiR3.selectDeep(hit.L, cur);
  } else if (hit) AiR3.selectDeep(hit.L, [hit.id]);                   // select.set
  else if (shift) return {ok:true, ids:VecSel.shapes.slice(), changed:false};
  else AiR3.selectDeep(null, []);                                     // select.none
  return {ok:true, ids:VecSel.shapes.slice(), layerId:VecSel.layerId, hit:hit ? hit.id : null};
}

CMD.reg('livepaintselect.click', {i18n:'',
  params:'{point:[x,y] 文件坐标, shift?:false, alt?:false, tolerance?} 实时上色选择工具点一下（builder.rs:524-536）：点在实时上色组的面上＝选那个面（alt＝选那组 tolerance（缺省 4 屏幕像素）内最近的边）；'
    + 'shift＝加选／减选（切换）；没点到：没 shift＝全部取消选取、有 shift＝不变。选取不进历史 → {ok, ids, layerId, hit}'}, p => {
  if (!window.LivePaintKit || !LP()) return {ok:false, error:'livepaintselect.click: menus/impl/ai-object.js 没载入'};
  if (!Array.isArray(p.point) || !isFinite(+p.point[0]) || !isFinite(+p.point[1])) return {ok:false, error:'livepaintselect.click: missing point [x,y]'};
  return click([+p.point[0], +p.point[1]], !!p.shift, !!p.alt, p.tolerance !== undefined ? +p.tolerance : VecSel.tol(4));
});

const LPS = {cache:null, hover:null};
window.LivePaintSelectTool = LPS;
Tools.reg({
  id:'livepaintselect', icon:'◩', group:'vector', order:62, for:'vector', opts:[], cursor:'default', hint:'ui.livepaintselectHint',
  strings:{
    'zh-Hant':{'tool.livepaintselect':'即時上色選取工具', 'ui.livepaintselectHint':'點即時上色群組的一塊面＝選取它（Shift 加選／減選）；Alt＋點＝選取邊線；點空白＝取消選取'},
    'zh-Hans':{'tool.livepaintselect':'实时上色选择工具', 'ui.livepaintselectHint':'点实时上色组的一块面＝选中它（Shift 加选／减选）；Alt＋点＝选中边线；点空白＝取消选择'},
    'en':{'tool.livepaintselect':'Live Paint Selection Tool', 'ui.livepaintselectHint':'Click a face of a Live Paint group to select it (Shift adds / removes); Alt-click selects an edge; click empty space to deselect'}
  },
  onMove(e, pt){
    if (!window.LivePaintKit || !LP() || (e.buttons & 1)) return;
    if (!LPS.cache) LPS.cache = BuildKit.makeCache();
    const h = KIT().lpHover(LPS.cache, pt, !!e.altKey);
    LPS.hover = (h && h.part) ? h : null;                             // 只留 Part
    UI.draw();
  },
  onDown(e, pt){
    if (!window.LivePaintKit || !LP()) return;
    CMD.run('livepaintselect.click', {point:[pt[0], pt[1]], shift:!!e.shiftKey, alt:!!e.altKey});
    UI.draw();
  },
  onUp(){ UI.draw(); },
  onDeactivate(){ LPS.hover = null; },
  drawOverlay(ctx, s){
    VecSel.drawOverlay(ctx, s);
    if (LPS.cache) KIT().drawHover(ctx, s, LPS.hover, LPS.cache);
  }
});
})();
