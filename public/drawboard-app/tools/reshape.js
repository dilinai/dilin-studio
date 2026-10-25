/* 堤麟画板 · 整形工具 —— 照 ArtCraft VectorCraft 原码逐段翻译
   原码：
     tools/src/extra.rs:147-217（ReshapeTool：只对「选中的路径」、tol(4) 内抓最近的那一点；拖离 tol(2) 才开始；Shift＝位移锁 45°；
                                 Preview path.reshape {id, x, y, dx, dy, tol}；放开＝Commit；拖时 Esc＝取消；游标：抓着或停在可抓处＝移动，否则箭头）
     engine/src/cmd/path.rs:98-104（path.reshape 规格）、467-505（reshape：PathData::nearest 找最近的段与 t；离最近锚点 ≤ tol 就抓那颗，
                                 否则在那一点插一颗锚点（insert_anchor）；半径 r＝该子路径外框对角线一半（至少 1，可用 radius 指定）；
                                 被抓的那颗移满 (dx,dy)，其余锚点（连同两支把手）按 w＝(1−q²)²、q＝min(距离／r, 1) 跟着移）
     geom/src/path.rs:254-270（SubPath::insert_anchor：直线段插一颗直角点；曲线段 de Casteljau 切开，两侧把手改短、新点是平滑点）
   我们这边：一个 bezier 形状＝他们一条只有一个子路径的路径；活形状（矩形／椭圆／星形／折线）先 VecSel.ensureBezier 换成路径（＝path_mut 的 live=None）；
     「选中的路径」含编组选择工具选到的深层物件（XformKit.findDeep）；坐标：命令收文件坐标，形状存图层坐标。 */
(function(){
'use strict';
const K = window.XformKit;
if (!K){ console.error('reshape.js: tools/reflect.js（XformKit）没载入'); return; }
const {fin, dist, constrainAngle} = K;

/* 选中、可编辑的路径（selection.objects 里的叶子）里，tol 内最近的点 → {L, s, at(文件坐标)} */
function hit(pt, tol){
  if (!window.VecSel) return null;
  VecSel.prune();
  const L = VecSel.layer(); if (!L || L.kind !== 'vector' || !L.visible) return null;
  if (L.locks && L.locks.all) return null;
  for (const id of VecSel.shapes){
    const h = K.findDeep(L, id); if (!h || !K.isLeaf(h.s)) continue;
    if (h.s.locked || h.s.visible === false || h.chain.some(a => a.locked || a.visible === false)) continue;
    const n = VecSel.nearestOnShape(h.s, [pt[0] - L.x, pt[1] - L.y]);
    if (n && n.d <= tol) return {L, s:h.s, at:[n.q[0] + L.x, n.q[1] + L.y]};
  }
  return null;
}

/* path.rs:467-505 reshape（坐标：图层坐标）→ 被抓锚点的索引 */
function reshapePath(s, at, delta, tol, radius){
  const A = s.anchors; if (!A || !A.length) return -1;
  const n = VecSel.nearestOnShape(s, at); if (!n) return -1;
  let grabbed = -1, bd = Infinity;
  A.forEach((a, i) => { const d = Math.hypot(a.x - at[0], a.y - at[1]); if (d < bd){ bd = d; grabbed = i; } });
  if (!(bd <= tol)) grabbed = insertAnchor(s, n.seg, n.t);
  const o = [A[grabbed].x, A[grabbed].y];
  let r = radius;
  if (!(fin(r))){
    const b = K.viewBounds(s, q => q);
    r = b ? Math.max(Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2, 1) : 1;
  }
  A.forEach((a, i) => {
    let w = 1;
    if (i !== grabbed){ const q = Math.min(Math.hypot(a.x - o[0], a.y - o[1]) / r, 1); w = (1 - q*q) ** 2; }
    const v = [delta[0] * w, delta[1] * w];
    a.x += v[0]; a.y += v[1];
    if (a.in) a.in = [a.in[0] + v[0], a.in[1] + v[1]];
    if (a.out) a.out = [a.out[0] + v[0], a.out[1] + v[1]];
  });
  return grabbed;
}
/* geom path.rs:254-270 SubPath::insert_anchor(seg, t) → 新锚点索引（seg+1） */
function insertAnchor(s, seg, t){
  const A = s.anchors, n = A.length, i0 = seg % n, i1 = (seg + 1) % n;
  const c = VecSel.segment(s, seg);
  const line = !A[i0].out && !A[i1].in;                      // segment_is_line：两支把手都等于锚点
  const [l, r] = VecSel.splitCubic(c, t);
  let mid;
  if (line) mid = {x:l.p3[0], y:l.p3[1], in:null, out:null, kind:'corner'};
  else {
    A[i0].out = l.c1.slice(); A[i1].in = r.c2.slice();
    mid = {x:l.p3[0], y:l.p3[1], in:l.c2.slice(), out:r.c1.slice(), kind:'smooth'};
  }
  A.splice(seg + 1, 0, mid);
  return seg + 1;
}

/* ───────── 工具本体（extra.rs:147-217）───────── */
const ses = K.makeSession();
const RS = {
  grab: null,        // {L, id, at}
  began: false,
  hover: false,
  ses,
  busy(){ return !!this.grab; },
  cancel(){ ses.cancel(); this.grab = null; this.began = false; },
  down(e, pt){
    const h = hit(pt, VecSel.tol(4));
    this.grab = h ? {L:h.L, id:h.s.id, at:h.at} : null;
    this.began = false;
  },
  move(e, pt){
    if (!this.grab){ this.hover = !!hit(pt, VecSel.tol(4)); return; }
    const g = this.grab;
    let d = [pt[0] - g.at[0], pt[1] - g.at[1]];
    if (e.shiftKey) d = constrainAngle(d, 45);
    if (!this.began){
      if (Math.hypot(d[0], d[1]) < VecSel.tol(2)) return;
      if (window.Locks && Locks.deny(g.L, 'pixels')){ this.grab = null; return; }
      this.began = true; ses.begin(g.L);                    // Action::Begin("Reshape")
    }
    ses.preview('reshape.apply', {id:g.id, layerId:g.L.id, x:g.at[0], y:g.at[1], dx:d[0], dy:d[1], tol:VecSel.tol(4)});
    UI.draw();
  },
  up(){
    this.grab = null;
    if (this.began){ this.began = false; ses.commit(); }
  },
  key(e){
    if (e.key === 'Escape' && this.grab){ e.preventDefault(); const b = this.began; this.cancel(); return b || true; }
    return false;
  },
  cursor(){ return (this.grab || this.hover) ? 'move' : 'default'; },
  syncCursor(){ if (window.UI && UI.canvas && ToolState.cur === 'reshape') UI.canvas.style.cursor = this.cursor(); }
};
window.ReshapeTool = RS;

CMD.reg('reshape.apply', {i18n:'', undoable:true,
  params:'{id:路径（形状）id, x, y 抓的点（文件坐标，会落到路径上最近的那点）, dx, dy 位移, tol?=3（离现有锚点这么近就抓那颗、否则在那点插一颗新锚点）, radius?（影响半径，缺省＝路径外框对角线的一半）, layerId?} ' +
         '照 path.reshape（整形工具拖一下）：被抓的锚点移满 (dx,dy)，其余锚点连同把手按 (1−q²)² 衰减跟着移（q＝距离／半径，到半径外不动）；活形状先转成钢笔路径 → {ok, id, anchor（被抓锚点索引）, inserted}'}, p => {
  p = p || {};
  if (!fin(+p.x) || !fin(+p.y)) return {ok:false, error:'reshape.apply: x, y are required numbers'};
  if (!p.id) return {ok:false, error:'reshape.apply: missing id'};
  let L = p.layerId ? Doc.byId(p.layerId) : null, h = null;
  for (const C of (L ? [L] : [VecSel.layer(), Doc.active()].concat(Doc.layers))){ h = K.findDeep(C, p.id); if (h){ L = C; break; } }
  if (!h || !K.isLeaf(h.s)) return {ok:false, error:'reshape.apply: no such path ' + p.id};
  const g = K.guard(L, 'pixels', 'reshape.apply'); if (g) return g;
  const s = h.s;
  if (!VecSel.ensureBezier(L, s) || !s.anchors || !s.anchors.length) return {ok:false, error:'empty path'};
  const n0 = s.anchors.length;
  const tol = Math.max(fin(+p.tol) ? +p.tol : 3, 0);
  const a = reshapePath(s, [+p.x - L.x, +p.y - L.y], [+p.dx || 0, +p.dy || 0], tol, fin(+p.radius) && p.radius !== null && p.radius !== undefined ? +p.radius : undefined);
  if (a < 0) return {ok:false, error:'empty path'};
  delete s.bboxAngle;
  Layer.invalidate(L);
  return {ok:true, id:s.id, anchor:a, inserted:s.anchors.length > n0};
});

const RS_STRINGS = {
  'zh-Hant':{'ui.reshapeHint':'先選取路徑 · 拖路徑上的一點＝那一點被拉過去、附近的錨點平順跟著動（沒有錨點會先加一顆）· Shift 鎖 45° · 拖時 Esc 取消'},
  'zh-Hans':{'ui.reshapeHint':'先选中路径 · 拖路径上的一点＝那一点被拉过去、附近的锚点平顺跟着动（没有锚点会先加一颗）· Shift 锁 45° · 拖时 Esc 取消'},
  'en':{'ui.reshapeHint':'Select a path first · drag a point on it: that point moves and the anchors around follow smoothly (an anchor is added there if needed) · Shift: 45° · Esc cancels a drag'}
};
if (typeof Lang !== 'undefined') Lang.add(RS_STRINGS);

Tools.reg({
  id:'reshape', group:'vector', order:64, for:'vector', opts:[], cursor:'default', hint:'ui.reshapeHint',
  onDown(e, pt){ RS.down(e, pt); RS.syncCursor(); UI.draw(); },
  onMove(e, pt){ RS.move(e, pt); RS.syncCursor(); if (!RS.began) UI.draw(); },
  onUp(e, pt){ RS.up(e, pt); RS.syncCursor(); UI.draw(); },
  onKey(e){ const r = RS.key(e); if (r) UI.draw(); return r; },
  onDeactivate(){ RS.cancel(); RS.hover = false; },
  drawOverlay(ctx, s){ K.Draw.selection(ctx, s); }
});
})();
