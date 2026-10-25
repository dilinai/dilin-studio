/* 堤麟画板 · AI 铅笔工具（ai.pencil，AI 版面 N）
   照 VectorCraft 原码逐段翻（pencil 那支）：
     tools/src/draw2/gesture.rs  按下＝收第一点；起点在「选中的开放路径」任一端的编辑范围（editWithin 12 屏幕像素）内＝接着画那条（末端先比）；
         拖曳＝每移 ≥1 屏幕像素收一点，第一次收到就 Begin、之后每次 Preview（拟合后的路径现场画出来）；
         放开＝离末点 ≥1 像素补收；没开始画（只点一下）＝什么都不做；Alt 放开、或（不是接着画、点数 >2、头尾在 closeWithin 15 屏幕像素内）＝闭合；Commit 一步历史；
         Esc＝取消这一笔；换工具＝照最后一次预览（不闭合）收下；
         选项（settings.rs:31 要记住）：fidelity 保真度 1.5（0.05..100）、fill 填色（缺省关）、editWithin 12（0..100）、closeWithin 15（0..100）
     engine/src/cmd/draw2.rs:443-550 fit_freehand／freehand（path.freehand，style "pencil"）：去抖、Catmull-Rom、simplify_with 拟合成贝兹；
         新路径＝描边色（无＝黑）、描边宽、fill 才填填色；extend＝接到既有开放路径的那一端（头尾近 max(tol·4, 6) 就闭合）；选中它。
   这条命令的几何跟 PS 版面「自由钢笔」是同一份原码（path.freehand）——tools/freeformpen.js 已逐段翻好：
     拟合用 window.FreehandFit、接着画用 ffExtendPath、改文件走它的 freeformpen.draw 命令本体（CMD.map 直接叫，不另推历史）；
     这颗工具自己的状态（手势、选项）与命令 aipencil.draw／aipencil.options 另立（AI 铅笔的选项跟 PS 自由钢笔分开记）。
   ── 没抄的 ──  AI 2020 铅笔选项的「保持选定」「Alt 键切换到平滑工具」原码没有，没加。压感原码没有。 */
(function(){
'use strict';
const HK = window.HandKit;
const PO = HK.loadOpts('aipencil', {fidelity:1.5, fill:false, editWithin:12, closeWithin:15});   // gesture.rs:47-58
const FF = () => { if (!window.FreehandFit) throw new Error('tools/freeformpen.js（FreehandFit）没载入'); return window.FreehandFit; };

const AP = {
  points:[], active:false, began:false, extend:null,
  /* gesture.rs:80-97 find_extend */
  findExtend(p){
    const L = Doc.active(); if (!L || L.kind !== 'vector' || VecSel.layerId !== L.id) return null;
    const tol = HK.tol(PO.editWithin);
    for (const id of VecSel.shapes){
      const s = L.data.shapes.find(x => x.id === id); if (!s || s.locked || s.visible === false) continue;
      const v = VecSel.asBezier(s); if (!v || v.closed || !v.anchors || !v.anchors.length) continue;
      const f = v.anchors[0], l = v.anchors[v.anchors.length - 1];
      if (Math.hypot(p[0] - (l.x + L.x), p[1] - (l.y + L.y)) <= tol) return {layerId:L.id, shapeId:id, end:'end'};
      if (Math.hypot(p[0] - (f.x + L.x), p[1] - (f.y + L.y)) <= tol) return {layerId:L.id, shapeId:id, end:'start'};
    }
    return null;
  },
  /* gesture.rs:100-112 freehand_params */
  params(closed){
    const v = {points:this.points.map(q => [q[0], q[1]]), fidelity:PO.fidelity, closed, fill:PO.fill};
    if (this.extend) v.extend = this.extend;
    return v;
  },
  down(e, pt){
    if (e && e.button !== undefined && e.button !== 0) return;
    this.points = [[pt[0], pt[1]]]; this.active = true; this.began = false;
    this.extend = this.findExtend(pt);
  },
  move(e, pt, P){
    if (!this.active || !(P && P.down)) return;
    const l = this.points[this.points.length - 1];
    if (Math.hypot(l[0] - pt[0], l[1] - pt[1]) < HK.tol(1)) return;
    this.points.push([pt[0], pt[1]]); this.began = true; UI.draw();
  },
  up(e, pt){
    if (!this.active) return;
    const l = this.points[this.points.length - 1];
    if (Math.hypot(l[0] - pt[0], l[1] - pt[1]) >= HK.tol(1)) this.points.push([pt[0], pt[1]]);
    try { this.finish(!!(e && e.altKey)); } finally { this.reset(); UI.draw(); }
  },
  /* gesture.rs:114-126 finish */
  finish(alt){
    if (!this.began) return null;
    const P = this.points, near = P.length > 2 && Math.hypot(P[0][0] - P[P.length-1][0], P[0][1] - P[P.length-1][1]) <= HK.tol(PO.closeWithin);
    return CMD.run('aipencil.draw', this.params(alt || (!this.extend && near)));
  },
  reset(){ this.points = []; this.active = false; this.began = false; this.extend = null; },
  preview(){
    if (!this.active || !this.began || this.points.length < 2) return null;
    const tol = HK.clamp(PO.fidelity, 0.05, 100, 1.5);
    if (this.extend && typeof ffExtendPath === 'function'){
      const L = Doc.byId(this.extend.layerId), s = L && L.data.shapes.find(x => x.id === this.extend.shapeId), v = s && VecSel.asBezier(s);
      if (v) return {ext:true, sp:ffExtendPath(v, L, this.points, tol, this.extend.end === 'start'), s};
    }
    return {sp:FF().fitFreehand(this.points, tol, false)};
  }
};
window.AiPencil = Object.assign(AP, {opts:PO});

CMD.reg('aipencil.draw', {i18n:'', undoable:true,
  params:'{points:[[x,y]…] 文件坐标（≥2 点）, fidelity?:1.5（拟合容差 0.05..100）, closed?:bool, fill?:bool（用填色；缺省不填）, ' +
         'extend?:{shapeId, layerId?, end:"start"|"end"}（接到这条开放路径的那一端）, layerId?} ＝ AI 铅笔拖一笔（path.freehand，style pencil）：' +
         '去抖→Catmull-Rom→最小二乘拟合成贝兹；新路径画进当前矢量层（不是就新建）、描边＝描边色（无＝黑、宽 0＝1）、选中它 → {ok, id, layerId, anchors, closed}'}, p => {
  const base = CMD.map['freeformpen.draw'];
  if (!base) return {ok:false, error:'aipencil.draw: tools/freeformpen.js not loaded'};
  const L = p.layerId ? Doc.byId(p.layerId) : (p.extend && p.extend.layerId ? Doc.byId(p.extend.layerId) : Doc.active());
  if (L && L.kind === 'vector'){ const f = HK.lockFail(L, 'aipencil.draw'); if (f) return f; }
  return base.run(p);
});
CMD.reg('aipencil.options', {i18n:'',
  params:'{fidelity?:0.05..100（保真度，缺省 1.5）, fill?:bool（填色新铅笔线条）, editWithin?:0..100 屏幕像素（编辑所选路径的范围，12）, closeWithin?:0..100（闭合范围，15）} → 目前选项；不给参数＝只读（gesture.rs set_option）'}, p => {
  p = p || {};
  if (p.fidelity !== undefined) PO.fidelity = HK.clamp(+p.fidelity, 0.05, 100, PO.fidelity);
  if (p.fill !== undefined) PO.fill = !!p.fill;
  if (p.editWithin !== undefined) PO.editWithin = HK.clamp(+p.editWithin, 0, 100, PO.editWithin);
  if (p.closeWithin !== undefined) PO.closeWithin = HK.clamp(+p.closeWithin, 0, 100, PO.closeWithin);
  HK.saveOpts('aipencil', PO);
  if (ToolState.cur === 'aipencil' && window.UI) UI.buildOptions('aipencil');
  return {ok:true, fidelity:PO.fidelity, fill:PO.fill, editWithin:PO.editWithin, closeWithin:PO.closeWithin};
});

Tools.reg({
  id:'aipencil', icon:'✏', group:'vector', order:42, for:'vector', needs:'vector', opts:[], cursor:'crosshair',
  hint:'ui.apHint',
  strings:{
    'zh-Hant':{'tool.aipencil':'鉛筆工具', 'ui.apHint':'拖曳＝手繪路徑（自動擬合成曲線）｜Alt 放開或回到起點附近＝封閉｜從選取的開放路徑端點拖＝接著畫｜Esc 取消',
               'opt.apFid':'保真度：', 'opt.apFill':'填滿新鉛筆筆觸', 'opt.apEdit':'編輯所選路徑範圍：', 'opt.apClose':'封閉路徑範圍：'},
    'zh-Hans':{'tool.aipencil':'铅笔工具', 'ui.apHint':'拖曳＝手绘路径（自动拟合成曲线）｜Alt 放开或回到起点附近＝闭合｜从选中的开放路径端点拖＝接着画｜Esc 取消',
               'opt.apFid':'保真度：', 'opt.apFill':'填充新铅笔描边', 'opt.apEdit':'编辑所选路径范围：', 'opt.apClose':'闭合路径范围：'},
    'en':{'tool.aipencil':'Pencil Tool', 'ui.apHint':'Drag to draw a freehand path (fitted to curves) | Release with Alt or end near the start: close | Drag from an end of the selected open path: continue it | Esc: cancel',
          'opt.apFid':'Fidelity:', 'opt.apFill':'Fill new pencil strokes', 'opt.apEdit':'Edit selected paths within:', 'opt.apClose':'Close paths when ends are within:'}
  },
  buildOptions(box, add, mk){
    const num = (key, k, min, max, step) => {
      const n = mk('number', {min, max, step, value:PO[k], id:'ap_' + k}); n.style.width = '56px';
      n.onchange = () => CMD.run('aipencil.options', {[k]:+n.value}); add(key, n);
    };
    num('apFid', 'fidelity', 0.05, 100, 0.5);
    const f = mk('checkbox', {checked:PO.fill, id:'ap_fill'}); f.onchange = () => { CMD.run('aipencil.options', {fill:f.checked}); f.blur(); }; add('apFill', f);
    num('apEdit', 'editWithin', 0, 100, 1);
    num('apClose', 'closeWithin', 0, 100, 1);
  },
  onDown(e, pt){ AP.down(e, pt); UI.draw(); },
  onMove(e, pt, P){ AP.move(e, pt, P); },
  onUp(e, pt){ AP.up(e, pt); },
  onKey(e){ if (e.key === 'Escape' && AP.active){ AP.reset(); UI.draw(); return true; } return false; },   // gesture.rs:195-201
  onDeactivate(){ if (AP.active && AP.began) AP.finish(false); AP.reset(); },                         // gesture.rs:213-219
  drawOverlay(ctx, s){
    if (window.VecSel) VecSel.drawOverlay(ctx, s);
    const pv = AP.preview(); if (!pv) return;
    const dpr = s / Math.max(UI.zoom || 1, 1e-9);
    ctx.save();
    const st = pv.ext ? {stroke:pv.s.stroke, strokeWidth:pv.s.strokeWidth, fill:pv.s.fill} :
      {stroke:UI.stroke() === 'none' ? '#000000' : UI.stroke(), strokeWidth:UI.strokeW() || 1, fill:PO.fill ? UI.fill() : 'none'};
    drawShape(ctx, Object.assign({type:'bezier', anchors:pv.sp.anchors, closed:pv.sp.closed}, st), s);
    ctx.strokeStyle = HK.FEEDBACK; ctx.lineWidth = dpr; ctx.setLineDash([]);
    ctx.beginPath(); bezierPath(ctx, pv.sp, s); ctx.stroke();
    ctx.restore();
  }
});
})();
