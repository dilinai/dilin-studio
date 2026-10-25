/* 堤麟画板 · 编组选择工具 —— 照 ArtCraft VectorCraft 原码逐段翻译
   原码：
     tools/src/direct.rs（全档 461 行：DirectSelectionTool::new(group=true) 那几支——179-199 按下、264-279 拖物件、308-311／329-348 框选、
                          321-324 放开、352-362 叠画、363-368 游标（ArrowHollow）、423-436 测试：点到混合的关键物件／步骤）
     doc/src/hit.rs:60-188（hit_test：由上往下、剪切组只在剪切路径里算、编组往下钻、复合路径当叶子；Hit.ancestry＝[图层, 顶层物件, …, 叶子]）
     tools/src/bbox.rs:107-110（move_delta：Shift 锁 45°）
     engine/src/cmd/select.rs（select.set／select.add／select.none／select.anchorsMany）、cmd/object.rs:227（object.transform 平移＋copy）
   行为（direct.rs:179-199）：
     按下：没点到东西＝框选（Shift＝加选）；点到 ⇒ 由叶子往上（不含图层）找第一个还没选的：
           叶子还没选＝选叶子；叶子已选＝选它外面下一层编组（再点再往外一层）；
           目标已经在选取里＝不变；Shift 或叶子已选＝select.add（加选）；否则 select.set（只选它）
     拖：离 tol(3) 才开始；平移选取（Shift 锁 45°），放开时按着 Alt＝复制（object.transform {translate, copy:alt}）；放开＝Commit
     框选放开：框比 tol(3) 小＝（没按 Shift 时）全部取消选取；否则框到的每条路径的锚点（select.anchorsMany）
   我们这边：选取存 VecSel；编组里面的物件走 AiR3 的深层选取（VecSel.shapes 里放深层 id，ai-object.js 已补 prune 认得）；
     框选的锚点只能部分选中顶层路径（VecSel.anchors 只认顶层），深层路径要整条在框里才选（已知限制）。 */
(function(){
'use strict';
const T = k => (typeof Lang !== 'undefined' ? Lang.t(k) : k);
const KIT = () => {
  if (!window.XformKit) throw new Error('groupselect.js: tools/reflect.js（XformKit）没载入');
  return window.XformKit;
};

/* direct.rs:179-199：这一下要选谁 → {L, target, leaf, chain, mode:'set'|'add'|null} */
function pickTarget(pt, shift){
  const K = KIT();
  const h = K.hitTest(pt, VecSel.tol(3)); if (!h) return null;
  const sameLayer = VecSel.layerId === h.L.id;
  const selected = s => sameLayer && VecSel.shapes.includes(s.id);
  const up = h.chain.slice().reverse();                 // ancestry.skip(1).rev()：叶子 → … → 顶层物件
  const target = selected(h.leaf) ? (up.find(s => !selected(s)) || h.leaf) : h.leaf;
  const mode = selected(target) ? null : (shift || selected(h.leaf)) ? 'add' : 'set';
  return {L:h.L, target, leaf:h.leaf, chain:h.chain, mode};
}
function applyPick(r){
  if (!r || !r.mode) return;
  if (r.mode === 'set') VecSel.setShapes(r.L.id, [r.target.id]);
  else {
    if (VecSel.layerId !== r.L.id) VecSel.setShapes(r.L.id, []);
    VecSel.layerId = r.L.id;
    if (!VecSel.shapes.includes(r.target.id)) VecSel.shapes.push(r.target.id);
    delete VecSel.anchors[r.target.id];
  }
}
/* direct.rs:329-348 框选：所有可编辑路径落在框里的锚点 → select.anchorsMany（add＝Shift） */
function marqueeSelect(r, add){
  const K = KIT();
  const L = (VecSel.layer() && VecSel.layer().kind === 'vector') ? VecSel.layer() : (Doc.active() && Doc.active().kind === 'vector' ? Doc.active() : null);
  if (!L) return {count:0};
  if (!add) VecSel.clear();
  let count = 0;
  K.walk(L.data.shapes, (s, arr, i, par, chain) => {
    if (!K.isLeaf(s) || s.locked || s.visible === false || chain.some(a => a.locked || a.visible === false)) return;
    const v = VecSel.asBezier(s); if (!v || !v.anchors) return;
    const idx = []; v.anchors.forEach((a, k) => { const x = a.x + L.x, y = a.y + L.y; if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) idx.push(k); });
    if (!idx.length) return;
    const top = !par;
    if (top){
      if (idx.length < v.anchors.length){
        const cur = (VecSel.layerId === L.id && VecSel.anchors[s.id]) ? VecSel.anchors[s.id] : [];
        if (VecSel.layerId === L.id && VecSel.isShapeFullySelected(s.id)) return;
        VecSel.setAnchors(L.id, s.id, cur.concat(idx));
      } else VecSel.addShape(L.id, s.id);
      count++;
    } else if (idx.length === v.anchors.length){
      if (VecSel.layerId !== L.id) VecSel.setShapes(L.id, []);
      VecSel.layerId = L.id; if (!VecSel.shapes.includes(s.id)) VecSel.shapes.push(s.id);
      count++;
    }
  });
  return {count};
}
const moveDelta = (from, to, shift) => { const d = [to[0] - from[0], to[1] - from[1]]; return shift ? KIT().constrainAngle(d, 45) : d; };

/* ───────── 工具本体 ───────── */
let ses = null;
const GS = {
  st: null,          // {k:'move', start, began, L} | {k:'marquee', start, cur, add}
  busy(){ return !!this.st; },
  session(){ return ses || (ses = KIT().makeSession()); },
  cancel(){ if (ses) ses.cancel(); this.st = null; },
  down(e, pt){
    const r = pickTarget(pt, !!e.shiftKey);
    if (!r){ this.st = {k:'marquee', start:pt.slice(), cur:pt.slice(), add:!!e.shiftKey}; return; }
    this.st = {k:'move', start:pt.slice(), began:false, L:r.L};
    if (r.mode) CMD.run('groupselect.select', {ids:[r.target.id], layerId:r.L.id, add:r.mode === 'add'});
  },
  move(e, pt){
    const st = this.st; if (!st) return;
    if (st.k === 'marquee'){ st.cur = pt.slice(); UI.draw(); return; }
    if (!st.began){
      if (Math.hypot(pt[0] - st.start[0], pt[1] - st.start[1]) < VecSel.tol(3)) return;
      if (window.Locks && Locks.deny(st.L, 'position')){ this.st = null; return; }
      st.began = true; this.session().begin(st.L);           // Action::Begin("Move")
    }
    const d = moveDelta(st.start, pt, !!e.shiftKey);
    st.d = d;
    this.session().preview('groupselect.move', {dx:d[0], dy:d[1], copy:!!e.altKey});
    UI.draw();
  },
  up(e, pt){
    const st = this.st; this.st = null; if (!st) return;
    if (st.k === 'move'){
      if (st.began){ const s = this.session(); if (s.last) s.last.params.copy = !!e.altKey; s.commit(); }
      return;
    }
    const r = {x0:Math.min(st.start[0], pt[0]), y0:Math.min(st.start[1], pt[1]), x1:Math.max(st.start[0], pt[0]), y1:Math.max(st.start[1], pt[1])};
    if (r.x1 - r.x0 < VecSel.tol(3) && r.y1 - r.y0 < VecSel.tol(3)){ if (!st.add) CMD.run('groupselect.selectNone', {}); return; }
    CMD.run('groupselect.marquee', {x0:r.x0, y0:r.y0, x1:r.x1, y1:r.y1, add:st.add});
  },
  key(e){
    if (e.key === 'Escape' && this.st && (this.st.k === 'marquee' || this.st.began)){ e.preventDefault(); this.cancel(); return true; }
    return false;
  },
  drawOverlay(ctx, s){
    KIT().Draw.selection(ctx, s);
    const st = this.st;
    if (st && st.k === 'marquee'){                         // Overlay::Marquee
      const dp = s / UI.zoom, x = Math.min(st.start[0], st.cur[0]) * s, y = Math.min(st.start[1], st.cur[1]) * s;
      const w = Math.abs(st.cur[0] - st.start[0]) * s, h = Math.abs(st.cur[1] - st.start[1]) * s;
      ctx.save(); ctx.lineWidth = dp; ctx.setLineDash([4*dp, 3*dp]); ctx.strokeStyle = '#2f7fd8'; ctx.fillStyle = 'rgba(47,127,216,0.08)';
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); ctx.restore();
    }
  }
};
window.GroupSelectTool = GS;

/* ───────── 命令 ───────── */
CMD.reg('groupselect.select', {i18n:'',
  params:'{ids:[物件 id…（可以是编组里面的）], layerId?, add?:bool} 选这些物件（add＝加选，照 select.add；否则照 select.set 只选它们）→ {ok, ids}'}, p => {
  p = p || {};
  const K = KIT();
  const ids = Array.isArray(p.ids) ? p.ids : [];
  let L = p.layerId ? Doc.byId(p.layerId) : null;
  if (!L) for (const C of [VecSel.layer(), Doc.active()].concat(Doc.layers)){ if (ids.length && K.findDeep(C, ids[0])){ L = C; break; } }
  if (!L || L.kind !== 'vector') return {ok:false, error:'groupselect.select: no such object'};
  const ok = ids.filter(id => K.findDeep(L, id));
  if (!ok.length) return {ok:false, error:'groupselect.select: no such object'};
  if (p.add) ok.forEach(id => applyPick({L, target:{id}, mode:'add'}));
  else VecSel.setShapes(L.id, ok);
  if (window.UI) UI.draw();
  return {ok:true, ids:VecSel.shapes.slice(), layerId:L.id};
});
CMD.reg('groupselect.click', {i18n:'',
  params:'{x, y（文件坐标）, shift?:bool} ＝用编组选择工具点一下：第一下选点到的物件（编组里面那个），再点同一处＝加选外面一层编组（一路往外）；Shift＝加选；点空白＝（没按 Shift）全部取消选取 → {ok, target, leaf, ancestry:[顶层…叶子], selected:[…]}'}, p => {
  p = p || {};
  if (!KIT().fin(+p.x) || !KIT().fin(+p.y)) return {ok:false, error:'groupselect.click: x, y are required numbers'};
  const r = pickTarget([+p.x, +p.y], !!p.shift);
  if (!r){ if (!p.shift) VecSel.clear(); if (window.UI) UI.draw(); return {ok:true, target:null, selected:VecSel.shapes.slice()}; }
  applyPick(r);
  if (window.UI) UI.draw();
  return {ok:true, target:r.target.id, leaf:r.leaf.id, ancestry:r.chain.map(s => s.id), layerId:r.L.id, selected:VecSel.shapes.slice()};
});
CMD.reg('groupselect.selectNone', {i18n:'', params:'{} 全部取消选取（照 select.none）'}, () => { VecSel.clear(); if (window.UI) UI.draw(); return {ok:true}; });
CMD.reg('groupselect.marquee', {i18n:'',
  params:'{x0, y0, x1, y1（文件坐标）, add?:bool} 框选（照 select.anchorsMany）：框到的锚点选起来（顶层路径可以只选部分锚点；编组里面的路径整条在框里才选）；add＝加选 → {ok, count}'}, p => {
  p = p || {};
  const K = KIT();
  if (![p.x0, p.y0, p.x1, p.y1].every(v => K.fin(+v))) return {ok:false, error:'groupselect.marquee: x0,y0,x1,y1 are required numbers'};
  const r = {x0:Math.min(+p.x0, +p.x1), y0:Math.min(+p.y0, +p.y1), x1:Math.max(+p.x0, +p.x1), y1:Math.max(+p.y0, +p.y1)};
  const out = marqueeSelect(r, !!p.add);
  if (window.UI) UI.draw();
  return {ok:true, count:out.count, selected:VecSel.shapes.slice()};
});
CMD.reg('groupselect.move', {i18n:'', undoable:true,
  params:'{dx, dy（文件单位）, copy?:bool（＝放开时按着 Alt）, ids?, layerId?} 平移选中的物件（照 object.transform 的平移；编组里面的物件也行）；copy＝先在原处正上方复制再移复制品 → {ok, ids}'}, p => {
  p = p || {};
  const K = KIT();
  const t = K.targets(p, 'groupselect.move'); if (t.err) return t.err;
  const g = K.guard(t.L, 'position', 'groupselect.move'); if (g) return g;
  return K.applyTransform(t.L, t.list, K.A.translate(+p.dx || 0, +p.dy || 0), {copy:!!p.copy});
});

const GS_STRINGS = {
  'zh-Hant':{'ui.groupselectHint':'點一下＝選取群組裡的那個物件 · 同一處再點＝加選外面一層群組 · Shift＝加選 · 拖＝移動（Shift 鎖 45°、放開時按 Alt＝拷貝）· 拖空白＝框選錨點'},
  'zh-Hans':{'ui.groupselectHint':'点一下＝选中编组里的那个物件 · 同一处再点＝加选外面一层编组 · Shift＝加选 · 拖＝移动（Shift 锁 45°、放开时按 Alt＝复制）· 拖空白＝框选锚点'},
  'en':{'ui.groupselectHint':'Click selects the object inside its group · click it again to add the next enclosing group · Shift adds · drag moves (Shift: 45°, Alt at release: copy) · drag empty space to marquee anchors'}
};
if (typeof Lang !== 'undefined') Lang.add(GS_STRINGS);

/* direct.rs:363-368：游标＝空心箭头（带＋，跟 AI 的编组选择游标一样） */
const GS_CURSOR = 'url("data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='20' height='22'><path d='M2 2 L2 17 L6 13 L9 20 L11.5 19 L8.5 12 L14 12 Z' fill='white' stroke='black' stroke-width='1.2' stroke-linejoin='round'/>" +
  "<path d='M15 15h5M17.5 12.5v5' stroke='white' stroke-width='3'/><path d='M15 15h5M17.5 12.5v5' stroke='black' stroke-width='1.2'/></svg>") + '") 2 2, default';

Tools.reg({
  id:'groupselect', group:'select', order:12, for:'vector', opts:[], cursor:GS_CURSOR, hint:'ui.groupselectHint',
  onDown(e, pt){ GS.down(e, pt); UI.draw(); },
  onMove(e, pt){ GS.move(e, pt); },
  onUp(e, pt){ GS.up(e, pt); UI.draw(); },
  onKey(e){ const r = GS.key(e); if (r) UI.draw(); return r; },
  onDeactivate(){ GS.cancel(); },
  drawOverlay(ctx, s){ GS.drawOverlay(ctx, s); }
});
})();
