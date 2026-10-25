/* 堤麟画板 · 混合工具（AI：W，id blend）—— 照 ArtCraft VectorCraft 原码逐段翻译
   主体：vectorcraft/crates/tools/src/meshblend.rs:1-141（BlendTool）
     hit_top：游标下最上面的物件（top_object）；anchor_at：该路径（复合路径＝第一个成员）第一条子路径上离游标最近、在 tol(5) 内的锚点
     按下：Alt ＝ 开「混合选项」（并重新开始）；
           点空白 ＝ 重新开始；
           还没有第一个 ＝ 记下它（物件＋点到的锚点）并 select.set 选它；
           已有第一个（点过的，或刚做好、还选着的那个混合＝chained）且点到别的物件 ＝ object.blend.make {ids:[第一个, 这个]}
             （点在锚点上＝starts:[第一个的锚点, 这个的锚点]＝从那个锚点混），做好后 chained：下一下再点一个物件＝把它加进这个混合当下一个关键物件；
           点到同一个 ＝ 什么都不做
     双击 ＝ 开「混合选项」；换工具 ＝ 重新开始
     叠画：第一个的回馈点（点到的锚点，否则外框中心）＝蓝色 #4f9dff 实心 6 方块
     游标：锚点上＝BlendAnchor、物件上＝BlendObject、空白＝Blend
   ui-egui/src/dialogs/blend_options.rs：混合选项对话框（间距：平滑颜色／指定的步数／指定的距离；取向：对齐页面／对齐路径）
   资料与命令本体（⛔ 不另起一套）：menus/impl/ai-object.js 的 ai.object.blend.make（活混合 {type:'group', live:'blend'}、starts）、
     ai.object.blend.options.dialog（混合选项对话框）。本档的手势一律走 blend.click（agent 用同一条）。
   物件命中共用 tools/perspgrid.js 的 PerspKit.hitTop（图层被移动过也对：先减 L.x／L.y）。 */
(function(){
'use strict';
const K = () => window.PerspKit;
const fin = v => typeof v === 'number' && isFinite(v);
const FEEDBACK = '#4f9dff';
const isBlend = s => !!s && s.type === 'group' && s.live === 'blend';

/* meshblend.rs:51-62 anchor_at（tol＝5 萤幕像素；点是文件坐标） */
function anchorAt(L, s, pt){
  let v = null;
  if (s.type === 'compound') v = s.children && s.children[0] ? VecSel.asBezier(s.children[0]) : null;
  else v = VecSel.asBezier(s);
  if (!v || !v.anchors || !v.anchors.length) return null;
  const p = [pt[0] - (L.x || 0), pt[1] - (L.y || 0)], tol = K().tolPx(5);
  let bi = -1, bd = Infinity;
  v.anchors.forEach((a, i) => { const d = Math.hypot(a.x - p[0], a.y - p[1]); if (d < bd){ bd = d; bi = i; } });
  return bd <= tol ? bi : null;
}
/* meshblend.rs:65-68 pick：最上面的物件＋点到的锚点 */
function pick(pt){
  const h = K().hitTop(pt); if (!h || h.kind !== 'shape') return null;
  return {L:h.L, id:h.s.id, start:anchorAt(h.L, h.s, pt)};
}
const findShape = (L, id) => { const h = window.AiR3 && AiR3.findDeep(id, L); return h ? h.s : null; };

const BT = window.BlendTool = {
  first: null,       // {L, id, start}
  chained: false,    // 刚做好一个混合：下一下点的物件加进它
  anchorAt, pick,
  busy(){ return !!this.first; },
  reset(){ this.first = null; this.chained = false; },
  /* meshblend.rs:72-77 first：点过的，或刚做好、还选着的那个混合 */
  firstPick(){
    if (this.first) return this.first;
    if (!this.chained || !window.VecSel) return null;
    const L = VecSel.layer(); if (!L || VecSel.shapes.length !== 1) return null;
    const s = findShape(L, VecSel.shapes[0]);
    return isBlend(s) ? {L, id:s.id, start:null} : null;
  },
  /* meshblend.rs:84-113 pointer（Down／DoubleClick） */
  click(pt, alt){
    if (alt) return this.options();
    const f = this.firstPick(), q = pick(pt);
    if (!q){ this.reset(); return {ok:true, action:'reset'}; }
    if (!f){
      this.first = q;
      VecSel.setShapes(q.L.id, [q.id]); if (window.AiSel) AiSel.text = [];      // select.set {ids:[top]}
      return {ok:true, action:'first', id:q.id, start:q.start};
    }
    if (f.id !== q.id && findShape(f.L, f.id)){
      this.first = null; this.chained = true;
      const p = {ids:[f.id, q.id]};
      if (f.start !== null || q.start !== null) p.starts = [f.start, q.start];
      const r = CMD.run('ai.object.blend.make', p);
      if (r && r.ok === false) this.chained = false;
      return Object.assign({action:'make', params:p}, r);
    }
    return {ok:true, action:'none'};
  },
  options(){ this.reset(); const r = CMD.run('ai.object.blend.options.dialog', {}); return Object.assign({action:'options'}, r); },
  cursorKind(pt){ const q = pick(pt); return !q ? 'blend' : q.start !== null ? 'blendAnchor' : 'blendObject'; },
  /* meshblend.rs:114-126 overlays */
  drawOverlay(ctx, s){
    const f = this.firstPick(); if (!f || !K()) return;
    const sh = findShape(f.L, f.id); if (!sh) return;
    let p = null;
    if (f.start !== null){
      const v = sh.type === 'compound' ? (sh.children[0] && VecSel.asBezier(sh.children[0])) : VecSel.asBezier(sh);
      const a = v && v.anchors && v.anchors[f.start]; if (a) p = [a.x + (f.L.x || 0), a.y + (f.L.y || 0)];
    }
    if (!p && window.AIObj){ const b = AIObj.shapeBounds(sh, q => [q[0] + (f.L.x || 0), q[1] + (f.L.y || 0)], false); if (b) p = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; }
    if (p) K().drawAnchor(ctx, s, p, FEEDBACK, true, 6);
  },
  syncCursor(pt){
    if (!window.UI || !UI.canvas || ToolState.cur !== 'blend' || !pt) return;
    const k = this.cursorKind(pt);
    UI.canvas.style.cursor = k === 'blendAnchor' ? 'cell' : k === 'blendObject' ? 'pointer' : 'crosshair';
  }
};

/* ── 命令（人与 agent 同一条）── */
CMD.reg('blend.click', {i18n:'', undoable:false, params:'{x, y 文件坐标, alt?: Alt 点＝开混合选项} ＝拿混合工具点一下：第一下记下物件（点在锚点上＝从那个锚点混）并选它；第二下点别的物件＝ai.object.blend.make（一步历史）；做好后再点物件＝加进这个混合；点空白＝重新开始 → {ok, action: first|make|none|reset|options, id?, start?, params?}'}, p => {
  if (!fin(p.x) || !fin(p.y)) return {ok:false, error:'blend.click: x, y are required numbers'};
  const r = BT.click([p.x, p.y], !!p.alt);
  if (window.UI) UI.draw();
  return r;
});
CMD.reg('blend.state', {i18n:'', params:'{} 混合工具的状态 → {ok, first:{id, start, layerId}|null, chained}'}, () => {
  const f = BT.firstPick();
  return {ok:true, first:f ? {id:f.id, start:f.start, layerId:f.L.id} : null, chained:BT.chained};
});
CMD.reg('blend.reset', {i18n:'', params:'{} 混合工具重新开始（忘掉第一个物件）→ {ok}'}, () => { BT.reset(); if (window.UI) UI.draw(); return {ok:true}; });

const STR = {
  'zh-Hant':{'ui.blHint':'依序點兩個物件＝建立漸變（點在錨點上＝從該錨點漸變）｜建好再點物件＝加進漸變｜點空白＝重新開始｜Alt＋點或雙擊＝漸變選項'},
  'zh-Hans':{'ui.blHint':'依次点两个对象＝建立混合（点在锚点上＝从该锚点混合）｜建好再点对象＝加进混合｜点空白＝重新开始｜Alt＋点或双击＝混合选项'},
  'en':{'ui.blHint':'Click two objects to blend them (click an anchor to blend from it) | Click another object to add it to the blend | Click empty canvas to start over | Alt-click or double-click for Blend Options'}
};
Tools.reg({
  id:'blend', icon:'◐', group:'vector', order:303, for:'vector', opts:[],
  cursor:'crosshair', hint:'ui.blHint', strings:STR,
  onDown(e, pt){ CMD.run('blend.click', {x:pt[0], y:pt[1], alt:!!e.altKey}); BT.syncCursor(pt); },
  onMove(e, pt){ BT.syncCursor(pt); },
  onUp(){ UI.draw(); },
  onDblClick(){ BT.options(); UI.draw(); },
  onDeactivate(){ BT.reset(); },
  buildOptions(box){
    const b = document.createElement('button'); b.textContent = Lang.t('ai3b.title'); b.onclick = () => BT.options();
    box.appendChild(b);
  },
  drawOverlay(ctx, s){ BT.drawOverlay(ctx, s); }
});
})();
