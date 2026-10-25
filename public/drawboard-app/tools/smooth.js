/* 堤麟画板 · AI 平滑工具（ai.smooth）
   照 VectorCraft 原码逐段翻：
     tools/src/draw2/gesture.rs:47,130-132,157-189,239-246  拖曳收折线；放开时「有选取且 ≥2 点」才跑 path.smoothRegion：半径＝12 屏幕像素（edit_within 缺省 12）、
                                                 保真度 fidelity（缺省 2.5，0.05..100，记住）；叠画蓝线 1px；Esc 取消
     engine/src/cmd/draw2.rs:902-1023  smooth_region／smooth_subpath／smooth_open／refit_run：
       选中的路径（外框碰到 poly_bounds(pts, radius)）上「离折线 ≤ radius」的锚点做记号；连续有记号的一串（前后各多带一个没记号的邻点）
       用 simplify_with（容差＝fidelity、转角 179°＝几乎不分段、不比原来点多）重拟合，头尾锚点位置与外侧把手不动；
       闭合路径：全部都有记号＝整条重拟合；否则转到一个没记号的锚点开头、复制一份接在尾巴当开放路径做，做完再接回闭合；
       有变才改（一步历史），回 {ids, before, after}（锚点数）；选取不变
   拟合（simplify_with）用 tools/freeformpen.js 已照 pathops/src/edit.rs、fit.rs 翻好的 window.FreehandFit.simplify。
   ── 没抄的 ──  AI 2020 平滑工具选项里的「平滑度」滑杆＝原码的 fidelity（照原码给数字栏）；其余原码没有。 */
(function(){
'use strict';
const HK = window.HandKit;
const SM = HK.loadOpts('smooth', {fidelity:2.5});        // gesture.rs:47
const FF = () => { if (!window.FreehandFit) throw new Error('tools/freeformpen.js（FreehandFit）没载入'); return window.FreehandFit; };
const P2 = a => [a.x, a.y];

/* draw2.rs:904-919 refit_run */
function refitRun(anchors, tol){
  const piece = {anchors:HK.clone(anchors), closed:false};
  const fitted = FF().simplify(piece, tol, 179);
  if (!fitted || !fitted.anchors || fitted.anchors.length < 2) return HK.clone(anchors);
  const out = HK.clone(fitted.anchors), f = anchors[0], l = anchors[anchors.length - 1], last = out.length - 1;
  out[0].x = f.x; out[0].y = f.y; out[0].in = f.in ? f.in.slice() : null;
  out[last].x = l.x; out[last].y = l.y; out[last].out = l.out ? l.out.slice() : null;
  return out.map(a => HK.withHandles(P2(a), a.in || P2(a), a.out || P2(a)));
}
/* draw2.rs:952-977 smooth_open */
function smoothOpen(anchors, marked, tol){
  const n = anchors.length, runs = [];
  for (let i = 0; i < n; i++){
    if (marked[i]){ const a = i; while (i + 1 < n && marked[i + 1]) i++; runs.push([a, i]); }
  }
  let out = HK.clone(anchors);
  for (const [a, b] of runs.reverse()){
    const lo = Math.max(a - 1, 0), hi = Math.min(b + 1, n - 1);
    if (hi - lo < 2) continue;
    const nw = refitRun(out.slice(lo, hi + 1), tol);
    out.splice(lo, hi - lo + 1, ...nw);
  }
  return out;
}
/* draw2.rs:921-950 smooth_subpath → 新子路径或 null */
function smoothSubpath(sp, near, tol){
  const n = sp.anchors.length, marked = sp.anchors.map(a => near(P2(a)));
  if (n < 3 || !marked.some(Boolean)) return null;
  if (sp.closed){
    const k = marked.indexOf(false);
    if (k < 0){ const f = FF().simplify({anchors:HK.clone(sp.anchors), closed:true}, tol, 179); return f ? {anchors:f.anchors, closed:true} : null; }
    const A = sp.anchors.slice(k).concat(sp.anchors.slice(0, k)), m = marked.slice(k).concat(marked.slice(0, k));
    A.push(A[0]); m.push(false);
    const res = smoothOpen(A, m, tol);
    const l = res.pop(); if (!l) return null;
    if (res.length) res[0].in = l.in ? l.in.slice() : null;
    return {anchors:res, closed:true};
  }
  return {anchors:smoothOpen(sp.anchors, marked, tol), closed:false};
}
const geoKey = sp => JSON.stringify([sp.closed, sp.anchors.map(a => [a.x, a.y, a.in, a.out])]);

/* draw2.rs:979-1023 smooth_region */
CMD.reg('smooth.region', {i18n:'', undoable:false,
  params:'{points:[[x,y]…] 文件坐标, radius?:12（离折线多远的锚点算拖过，文件单位；工具用 12 屏幕像素换算）, fidelity?:2.5（拟合容差 0.05..100）, layerId?} ＝ path.smoothRegion 平滑工具：' +
         '只动「选中的」路径：拖过的那一串锚点重拟合成较少、较平顺的曲线（头尾锚点与外侧把手不动）；没有选取＝错误；没变化＝不改文件 → {ok, ids, before, after}（锚点数）'}, p => {
  const C = 'smooth.region';
  const r = HK.pointsParam(p, 'points', C); if (r.err) return r.err;
  const radius = Math.max(HK.f64(p, 'radius', 12), 0);
  const tol = HK.clamp(HK.f64(p, 'fidelity', 2.5), 0.05, 100, 2.5);
  const L = HK.layerOf(p); if (!L) return {ok:false, error:C + ': not a vector layer'};
  const sel = HK.selIds(L);
  if (!sel.length) return {ok:false, error:C + ': nothing selected'};          // has_selection
  const f = HK.lockFail(L, C); if (f) return f;
  const pts = HK.toLayerPts(L, r.pts), near = q => HK.distToPolyline(pts, q) <= radius;
  const plan = []; let before = 0, after = 0;
  for (const e of HK.targetPaths(L, sel, HK.polyBounds(pts, radius))){
    const pd = HK.pdOf(e.s); let changed = false;
    const subs = pd.map(sp => {
      const n = smoothSubpath(sp, near, tol);
      if (n && n.anchors.length >= 2 && geoKey(n) !== geoKey(sp)){ changed = true; return n; }
      return sp;
    });
    if (changed){
      before += pd.reduce((s, sp) => s + sp.anchors.length, 0); after += subs.reduce((s, sp) => s + sp.anchors.length, 0);
      plan.push([e, subs]);
    }
  }
  if (!plan.length) return {ok:true, ids:[], before:0, after:0};
  History.push();
  for (const [e, subs] of plan){
    if (e.parent && e.parent.type === 'compound'){ e.s.type = 'bezier'; e.s.anchors = subs[0].anchors; e.s.closed = subs[0].closed; VecSel._cache.delete(e.s); }
    else HK.setGeometry(e.s, subs);                                        // path_mut：活形状丢掉参数
  }
  Layer.invalidate(L);
  VecSel.prune();
  return {ok:true, ids:plan.map(x => x[0].s.id), before, after, layerId:L.id};
});
CMD.reg('smooth.options', {i18n:'',
  params:'{fidelity?:0.05..100（保真度＝拟合容差，缺省 2.5；越大越平滑）} 平滑工具选项（gesture.rs set_option）；不给参数＝只读 → {ok, fidelity}'}, p => {
  if (p && p.fidelity !== undefined) SM.fidelity = HK.clamp(+p.fidelity, 0.05, 100, SM.fidelity);
  HK.saveOpts('smooth', SM);
  if (ToolState.cur === 'smooth'){ const n = document.getElementById('sm_fid'); if (n && document.activeElement !== n) n.value = SM.fidelity; }
  return {ok:true, fidelity:SM.fidelity};
});

const SG = HK.gesture({finish(pts){
  const L = HK.layerOf({});
  if (!L || !HK.selIds(L).length || pts.length < 2) return;               // gesture.rs:130 "smooth" if has_sel && pts.len() >= 2
  CMD.run('smooth.region', {points:pts, radius:HK.tol(12), fidelity:SM.fidelity});
}});
window.SmoothTool = {opts:SM, g:SG};

Tools.reg({
  id:'smooth', icon:'∿', group:'vector', order:43, for:'vector', needs:'vector', opts:[], cursor:'crosshair',
  hint:'ui.smHint',
  strings:{
    'zh-Hant':{'tool.smooth':'平滑工具', 'ui.smHint':'沿著選取的路徑拖曳＝把拖過的那段變平滑（減少錨點）｜要先選取路徑｜Esc 取消', 'opt.smFid':'保真度：'},
    'zh-Hans':{'tool.smooth':'平滑工具', 'ui.smHint':'沿选中的路径拖曳＝把拖过的那段变平滑（减少锚点）｜要先选中路径｜Esc 取消', 'opt.smFid':'保真度：'},
    'en':{'tool.smooth':'Smooth Tool', 'ui.smHint':'Drag along a selected path to smooth that part (fewer anchors) | Select a path first | Esc: cancel', 'opt.smFid':'Fidelity:'}
  },
  buildOptions(box, add, mk){
    const n = mk('number', {min:0.05, max:100, step:0.5, value:SM.fidelity, id:'sm_fid'}); n.style.width = '60px';
    n.onchange = () => CMD.run('smooth.options', {fidelity:+n.value}); add('smFid', n);
  },
  onDown(e, pt){ SG.down(e, pt); },
  onMove(e, pt, P){ SG.move(e, pt, P); },
  onUp(e, pt){ SG.up(e, pt); },
  onKey(e){ return SG.key(e); },
  onDeactivate(){ SG.reset(); },
  drawOverlay(ctx, s){ if (window.VecSel) VecSel.drawOverlay(ctx, s); SG.draw(ctx, s, HK.FEEDBACK, 1, false); }
});
})();
