/* 堤麟画板 · AI 连接工具（ai.join）
   照 VectorCraft 原码逐段翻：
     tools/src/draw2/gesture.rs:134,157-189  拖曳收折线（擦过两个开放端点）；放开 ≥2 点就跑 path.joinScrub，容差＝12 屏幕像素（edit_within 缺省 12）；叠画蓝线 1px；Esc 取消
     engine/src/cmd/draw2.rs:1025-1122 join_scrub：
       路径（有选取＝选中的，没选取＝全部；外框碰到 poly_bounds(pts, tol)）的开放子路径两端，离折线 ≤ tol 的收进来，按「沿折线的位置」（段号＋段内 t）排序，取最前面两个；
       两端相距 ≤ tol ⇒ 并成一点（放在两端中点，并掉的那端的外侧把手跟着平移）；否则用直线段连起来；
       同一条路径的头尾 ⇒ 闭合（并点时：拿掉末点，首点移到中点、进把手＝末点进把手平移过去）；
       两条不同路径 ⇒ A（擦到的是 A 的起点就先反转）＋ B（擦到的是 B 的终点就先反转）接成一条，留在 A（id 与外观都是 A 的）、删掉 B；选中 A；一步历史
     找不到两个端点 ⇒ {id:null}，不改文件。
   共用：tools/blobbrush.js 的 window.HandKit。
   ── 没抄的 ──  原码没有选项（AI 2020 的连接工具也没有）。 */
(function(){
'use strict';
const HK = window.HandKit;
const P2 = a => [a.x, a.y];
const revSp = sp => ({closed:sp.closed, anchors:sp.anchors.slice().reverse().map(a => ({x:a.x, y:a.y, in:a.out ? a.out.slice() : null, out:a.in ? a.in.slice() : null, kind:a.kind}))});
const translate = (a, d) => { a.x += d[0]; a.y += d[1]; if (a.in) a.in = HK.add(a.in, d); if (a.out) a.out = HK.add(a.out, d); };

CMD.reg('join.scrub', {i18n:'', undoable:false,
  params:'{points:[[x,y]…] 文件坐标, tolerance?:12（端点离折线多近算擦到；两端距离 ≤ 它就并成一点，否则用直线连；工具用 12 屏幕像素换算）, layerId?} ＝ path.joinScrub 连接工具：' +
         '沿折线最先擦到的两个开放端点接起来：同一条路径的头尾＝闭合；两条路径＝接成一条（留第一条的 id 与外观、删第二条）；选中结果；不到两个端点＝不改文件 → {ok, id|null, layerId}'}, p => {
  const C = 'join.scrub';
  const r = HK.pointsParam(p, 'points', C); if (r.err) return r.err;
  const tol = Math.max(HK.f64(p, 'tolerance', 12), 0);
  const L = HK.layerOf(p); if (!L) return {ok:false, error:C + ': not a vector layer'};
  const pts = HK.toLayerPts(L, r.pts);
  // 端点沿折线的位置：最近那段的 段号＋t
  const order = q => {
    if (pts.length === 1) return 0;
    let best = null;
    for (let i = 0; i + 1 < pts.length; i++){
      const a = pts[i], ab = HK.sub(pts[i + 1], a), l2 = HK.dot(ab, ab);
      const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, HK.dot(HK.sub(q, a), ab) / l2));
      const d = HK.dist(HK.add(a, HK.mul(ab, t)), q);
      if (!best || d < best[1]) best = [i + t, d];
    }
    return best[0];
  };
  const ends = [];
  for (const e of HK.targetPaths(L, HK.selIds(L), HK.polyBounds(pts, tol))){
    const sp = HK.pdOf(e.s)[0];
    if (!sp || sp.closed || sp.anchors.length < 2) continue;
    for (const [start, a] of [[true, sp.anchors[0]], [false, sp.anchors[sp.anchors.length - 1]]]){
      if (HK.distToPolyline(pts, P2(a)) <= tol) ends.push({o:order(P2(a)), e, sp, start, p:P2(a)});
    }
  }
  ends.sort((a, b) => a.o - b.o);
  if (ends.length < 2) return {ok:true, id:null};
  const f = HK.lockFail(L, C); if (f) return f;
  const A = ends[0], B = ends[1], mid = HK.lerp(A.p, B.p, 0.5), merge = HK.dist(A.p, B.p) <= tol;
  History.push();
  if (A.e.s === B.e.s){
    const sp = A.sp;
    if (merge && sp.anchors.length > 2){
      const l = sp.anchors.pop();
      translate(sp.anchors[0], HK.sub(mid, P2(sp.anchors[0])));
      sp.anchors[0].in = l.in ? HK.add(l.in, HK.sub(mid, P2(l))) : mid.slice();
      sp.anchors[0] = HK.withHandles(P2(sp.anchors[0]), sp.anchors[0].in || P2(sp.anchors[0]), sp.anchors[0].out || P2(sp.anchors[0]));
    }
    sp.closed = true;
    setOne(A.e, sp);
  } else {
    let x = A.start ? revSp(A.sp) : HK.clone(A.sp), y = B.start ? HK.clone(B.sp) : revSp(B.sp);
    if (merge && y.anchors.length){
      const yf = y.anchors.shift(), last = x.anchors[x.anchors.length - 1];
      translate(last, HK.sub(mid, P2(last)));
      const ho = yf.out ? HK.add(yf.out, HK.sub(mid, P2(yf))) : mid.slice();
      x.anchors[x.anchors.length - 1] = HK.withHandles(P2(last), last.in || P2(last), ho);
    }
    x.anchors = x.anchors.concat(y.anchors); x.closed = false;
    setOne(A.e, x);
    const i = B.e.arr.indexOf(B.e.s); if (i >= 0) B.e.arr.splice(i, 1);
  }
  Layer.invalidate(L);
  HK.select(L, [A.e.s.id]);
  return {ok:true, id:A.e.s.id, layerId:L.id, closed:!!A.e.s.closed, anchors:(A.e.s.anchors || []).length};
});
function setOne(e, sp){
  if (e.parent && e.parent.type === 'compound'){ e.s.type = 'bezier'; e.s.anchors = sp.anchors; e.s.closed = sp.closed; VecSel._cache.delete(e.s); }
  else HK.setGeometry(e.s, [sp]);                                        // path_mut：活形状（折线／直线）丢掉参数变 bezier
}

const JG = HK.gesture({finish(pts){ if (pts.length >= 2) CMD.run('join.scrub', {points:pts, tolerance:HK.tol(12)}); }});
window.JoinTool = {g:JG};

Tools.reg({
  id:'join', icon:'⫘', group:'vector', order:45, for:'vector', needs:'vector', opts:[], cursor:'crosshair',
  hint:'ui.joinHint',
  strings:{
    'zh-Hant':{'tool.join':'合併工具', 'ui.joinHint':'在兩個開放端點上塗抹＝把它們接起來（靠得近就併成一點，否則拉直線）｜同一條路徑的頭尾＝封閉｜Esc 取消'},
    'zh-Hans':{'tool.join':'连接工具', 'ui.joinHint':'在两个开放端点上涂抹＝把它们接起来（靠得近就并成一点，否则拉直线）｜同一条路径的头尾＝闭合｜Esc 取消'},
    'en':{'tool.join':'Join Tool', 'ui.joinHint':'Scrub over two open end points to join them (merged when close, else a straight segment) | Both ends of one path: close it | Esc: cancel'}
  },
  onDown(e, pt){ JG.down(e, pt); },
  onMove(e, pt, P){ JG.move(e, pt, P); },
  onUp(e, pt){ JG.up(e, pt); },
  onKey(e){ return JG.key(e); },
  onDeactivate(){ JG.reset(); },
  drawOverlay(ctx, s){ if (window.VecSel) VecSel.drawOverlay(ctx, s); JG.draw(ctx, s, HK.FEEDBACK, 1, false); }
});
})();
