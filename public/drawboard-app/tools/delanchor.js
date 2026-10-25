/* 删除锚点（−）——照 VectorCraft 原始码逐段翻译：
     tools/src/draw2/anchor.rs     AnchorTool id=="deleteAnchor"：按下＝delete()（hit_anchor 容差 cx.tol(4.0)→path.removeAnchor）；
                                   按着 Alt 按下＝add()（hit_segment 容差 cx.tol(4.0)→path.insertAnchor）；拖曳／放开什么都不做；
                                   游标：不按 Alt＝PenDelete、按 Alt＝PenAdd；没有 overlays（叠画只有共用的选取显示）
     tools/src/draw2.rs            candidate_paths／hit_anchor／hit_segment（已在 _vecsel.js）
     engine/src/cmd/draw2.rs       path.removeAnchor（remove_anchor：删一点、邻段重新拟合）
     engine/src/cmd/path.rs        path.insertAnchor（insert_anchor）、path.deleteAnchors（delete_anchors：删直接选取的锚点，Delete 键走这条）
     geom/src/path.rs              Anchor::has_in/has_out（把手离锚点 > EPS=1e-9 才算有）、SubPath::insert_anchor
   我们这边：一个 bezier 形状＝他们一条只有一个 subpath 的路径（subpath 永远 0）；把手 null＝他们「把手等于 p」。 */
const DelAnchor = {
  alt: false,          // 目前 Alt 按着没（游标用）
  hover: null,         // 滑鼠目前的文件坐标（叠画提示用）
  hoverKey: null,      // 滑鼠下命中的东西（变了才重画）

  /* geom Anchor::has_in/has_out：把手存在且离锚点 > EPS */
  has(a, h){ return !!h && Math.hypot(h[0] - a.x, h[1] - a.y) > 1e-9; },
  /* 把「等于锚点」的把手存成 null（我们的惯例）*/
  norm(a, h){ return this.has(a, h) ? [h[0], h[1]] : null; },

  /* ToolContext::is_editable：图层要看得见；他们走整份文件，我们只认当前图层 */
  layer(){
    const L = Doc.active();
    return (L && L.kind === 'vector' && L.visible) ? L : null;
  },

  /* anchor.rs:47-52 delete()：容差内最近的锚点 → path.removeAnchor */
  del(pt){
    const L = this.layer(); if (!L) return null;
    const h = VecSel.hitAnchor(L, pt, VecSel.tol(4.0));
    if (!h) return null;                                           // 点不到锚点：什么都不做（vec![]）
    return CMD.run('delanchor.remove', {layerId:L.id, shapeId:h.s.id, subpath:0, anchor:h.idx});
  },
  /* anchor.rs:40-45 add()：容差内最近的线段点 → path.insertAnchor */
  add(pt){
    const L = this.layer(); if (!L) return null;
    const h = VecSel.hitSegment(L, pt, VecSel.tol(4.0));
    if (!h) return null;
    return CMD.run('delanchor.insert', {layerId:L.id, shapeId:h.s.id, subpath:0, segment:h.seg, t:h.t});
  },

  /* anchor.rs:181-186 cursor()：deleteAnchor 不按 Alt＝PenDelete，按 Alt＝PenAdd */
  cursorCss(alt){ return alt ? DEL_CURSOR_ADD : DEL_CURSOR_DEL; },
  setCursor(alt){
    this.alt = !!alt;
    if (ToolState.cur === 'delanchor' && window.UI && UI.canvas) UI.canvas.style.cursor = this.cursorCss(this.alt);
  }
};
window.DelAnchor = DelAnchor;

/* 游标图：钢笔尖＋「−」（PenDelete）／「+」（PenAdd），热点在笔尖 */
function delCursorSvg(sign){
  const mark = sign === '+'
    ? "<path d='M15 19h7M18.5 15.5v7' stroke='#fff' stroke-width='3.4'/><path d='M15 19h7M18.5 15.5v7' stroke='#000' stroke-width='1.4'/>"
    : "<path d='M15 19h7' stroke='#fff' stroke-width='3.4'/><path d='M15 19h7' stroke='#000' stroke-width='1.4'/>";
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>" +
    "<path d='M1 1 L5 12 L9 13 L13 9 L12 5 Z' fill='#000' stroke='#fff' stroke-width='1.2' stroke-linejoin='round'/>" +
    "<path d='M1 1 L7 7' stroke='#fff' stroke-width='1'/><path d='M9 13 L14 18 L18 14 L13 9' fill='none' stroke='#000' stroke-width='1.4'/>" +
    mark + "</svg>";
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 1 1, crosshair`;
}
const DEL_CURSOR_DEL = delCursorSvg('-');
const DEL_CURSOR_ADD = delCursorSvg('+');

/* ── 命令（他们的 path.removeAnchor／path.insertAnchor／path.deleteAnchors 正文翻过来）── */
function delShape(p, C){
  const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  if (!L || L.kind !== 'vector') return {err:{ok:false, error:C + ': not a vector layer'}};
  let id = p.shapeId !== undefined ? p.shapeId : p.id;               // 他们叫 id，我们叫 shapeId，两个都收
  if (id === undefined && VecSel.layerId === L.id && VecSel.shapes.length) id = VecSel.shapes[0];
  if (id === undefined) return {err:{ok:false, error:C + ': missing shapeId'}};
  const s = L.data.shapes.find(x => x.id === id);
  VecSel.ensureBezier(L, s);                                         // path_mut：活形状一动锚点就转成路径（path.rs:115）
  if (!s || s.type !== 'bezier') return {err:{ok:false, error:C + ': object ' + id + ' is not a path'}};
  if ((+p.subpath || 0) !== 0) return {err:{ok:false, error:C + ': no such subpath'}};   // 我们一个形状只有一个 subpath
  return {L, s};
}
const delIdx = v => (Number.isInteger(+v) && +v >= 0 && v !== null && v !== '') ? +v : -1;   // usize_req

/* draw2.rs:589-653 remove_anchor */
CMD.reg('delanchor.remove', {i18n:'', undoable:true,
  params:'{shapeId(或 id)?, anchor, subpath?=0, layerId?} 删一个锚点并重新拟合邻段（照 VectorCraft path.removeAnchor）：' +
         '闭合路径或开放路径中间的点（且 ≥3 点）⇒ 两邻锚点保留外侧切线方向、把手拉长到跨两段——有把手的按 (l1+l2)/l 倍（最多 3 倍）拉长，没把手的一边朝被删点方向放弦长 1/3；两段都是直线就不动把手；' +
         '开放路径删完后首点 in、末点 out 清掉；剩 2 点的闭合路径有把手才保持闭合（透镜形），没把手就变开放；剩不到 2 点整个形状删掉并清空节点选取。' +
         'shapeId 缺省＝节点选取里的第一个形状。→ {ok, removedObject, count}'}, p => {
  const C = 'delanchor.remove';
  const {L, s, err} = delShape(p, C); if (err) return err;
  const ai = delIdx(p.anchor);
  if (ai < 0) return {ok:false, error:C + ': missing anchor'};
  if (ai >= s.anchors.length) return {ok:false, error:'no such anchor'};
  DelAnchor.removeAnchor(s, ai);                                     // 纯几何部分（钢笔画到一半删点也借这支）
  const A = s.anchors;
  Layer.invalidate(L);
  if (A.length < 2){                                                 // subpath 不成立 ⇒ 路径空了 ⇒ 删物件、清选取
    L.data.shapes.splice(L.data.shapes.indexOf(s), 1);
    VecSel.clear();
    return {ok:true, removedObject:true, count:0};
  }
  if (VecSel.layerId === L.id) delete VecSel.anchors[s.id];          // sel.anchors.remove(&id)：部分选取作废
  return {ok:true, removedObject:false, count:A.length};
});

/* draw2.rs:589-653 remove_anchor 的纯几何部分：只改 s.anchors／s.closed，不查图层、不 invalidate、不动 VecSel。
   回 {ok, count}；count<2 表示路径空了，由调用方决定删不删形状（命令删、钢笔画到一半的不删）。 */
DelAnchor.removeAnchor = function(s, ai){
  const A = s.anchors, n = A.length;
  if (!(ai >= 0 && ai < n)) return {ok:false, error:'no such anchor'};
  const D = DelAnchor, dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const interior = !!s.closed || (ai > 0 && ai + 1 < n);
  if (interior && n >= 3){
    const pi = (ai + n - 1) % n, ni = (ai + 1) % n;
    const prev = A[pi], a = A[ai], next = A[ni];
    // 保留外侧切线，拉长到跨过被删掉的两段
    const l1 = dist(prev, a), l2 = dist(a, next);
    const chord = Math.max(dist(prev, next), 1e-9);
    const firstLine = !D.has(prev, prev.out) && !D.has(a, a.in);
    const secondLine = !D.has(a, a.out) && !D.has(next, next.in);
    let hout = VecSel.hOut(prev), hin = VecSel.hIn(next);
    if (!(firstLine && secondLine)){
      // 有曲线：外侧把手拉长到跨两段；直的那一边朝被删点放弦长的 1/3
      if (D.has(prev, prev.out)){
        const k = Math.min((l1 + l2) / Math.max(l1, 1e-9), 3.0);
        hout = [prev.x + (prev.out[0] - prev.x) * k, prev.y + (prev.out[1] - prev.y) * k];
      } else {
        const k = chord / 3.0 / Math.max(l1, 1e-9);
        hout = [prev.x + (a.x - prev.x) * k, prev.y + (a.y - prev.y) * k];
      }
      if (D.has(next, next.in)){
        const k = Math.min((l1 + l2) / Math.max(l2, 1e-9), 3.0);
        hin = [next.x + (next.in[0] - next.x) * k, next.y + (next.in[1] - next.y) * k];
      } else {
        const k = chord / 3.0 / Math.max(l2, 1e-9);
        hin = [next.x + (a.x - next.x) * k, next.y + (a.y - next.y) * k];
      }
    }
    prev.out = D.norm(prev, hout);
    next.in = D.norm(next, hin);
  }
  A.splice(ai, 1);
  if (!s.closed && A.length){                                        // 开放路径：首点 in、末点 out 收回
    A[0].in = null;
    A[A.length - 1].out = null;
  }
  if (A.length < 3) s.closed = !!s.closed && A.length === 2 && A.some(a => D.has(a, a.in) || D.has(a, a.out));
  return {ok:true, count:A.length};
};

/* path.rs:505-519 insert_anchor ＋ geom/src/path.rs:254-270 SubPath::insert_anchor（Alt 分支用；与 addanchor.insert 同一份，正文在那边）*/
CMD.reg('delanchor.insert', {i18n:'', undoable:true,
  params:'{shapeId(或 id)?, segment, t?=0.5 (0..1), subpath?=0, layerId?} 在第 segment 段的 t 处加一个锚点、形状不变（照 VectorCraft path.insertAnchor）：' +
         '直线段加直角点；曲线段用 de Casteljau 切开，两邻点把手改短、新点是平滑点。shapeId 缺省＝节点选取里的第一个形状。→ {ok, anchor:新锚点索引}'}, p => {
  // 正文只留 addanchor.insert 一份（同一段 path.rs:505-519／geom path.rs:254-270 的翻译），这里转过去；参数名两边一样（shapeId／id、segment、t、subpath、layerId）
  const C = 'delanchor.insert';
  const {err} = delShape(p, C); if (err) return err;
  return CMD.map['addanchor.insert'].run(Object.assign({}, p, {shapeId: p.shapeId !== undefined ? p.shapeId : p.id}));
});

/* path.rs:433-465 delete_anchors：删掉「直接选取」的锚点（节点选取里有部分选中锚点的那些形状）。
   闭合路径删一点＝在那里打开（Illustrator 的 Delete 行为）；剩不到 2 点的形状删掉；最后清空节点选取。
   正文只留 direct.deleteAnchors 一份（tools/direct.js，同一段 path.rs:433-465 的翻译，并修掉原码「闭合路径一次删多点、第一刀转开后索引错位」的缺陷），这里转过去。 */
CMD.reg('delanchor.deleteAnchors', {i18n:'', undoable:true,
  params:'{} 删掉节点选取里「部分选中」的锚点（照 VectorCraft path.deleteAnchors／Delete 键）：闭合路径删点＝从那里打开（不重拟合），开放路径直接拿掉；剩不到 2 点的形状删掉；做完清空节点选取'}, () => {
  const L = VecSel.layer();
  if (!L || L.kind !== 'vector' || VecSel.isEmpty()) return {ok:false, error:'nothing selected'};   // has_selection
  if (!CMD.map['direct.deleteAnchors']) return {ok:false, error:'direct.deleteAnchors not loaded'};
  return CMD.map['direct.deleteAnchors'].run({});
});

Tools.reg({
  id:'delanchor', icon:'✒₋', key:'-', group:'vector', order:13, for:'vector', opts:[],
  cursor:DEL_CURSOR_DEL,
  hint:'ui.delanchorHint',
  strings:{
    'zh-Hant':{'tool.delanchor':'刪除錨點', 'ui.delanchorHint':'點錨點＝刪除並重新擬合相鄰曲線；按住 Alt 點路徑＝增加錨點；Delete＝刪除直接選取的錨點'},
    'zh-Hans':{'tool.delanchor':'删除锚点', 'ui.delanchorHint':'点锚点＝删除并重新拟合相邻曲线；按住 Alt 点路径＝添加锚点；Delete＝删除直接选取的锚点'},
    'en':{'tool.delanchor':'Delete Anchor Point', 'ui.delanchorHint':'Click an anchor to delete it (the neighbouring curve is re-fitted); Alt-click a path to add an anchor; Delete removes direct-selected anchors'}
  },
  /* anchor.rs:89-95：只有按下有事；Alt 对调成加锚点 */
  onDown(e, pt){
    DelAnchor.setCursor(e.altKey);
    if (e.altKey) DelAnchor.add(pt); else DelAnchor.del(pt);
    UI.draw();
  },
  /* 拖曳、放开：原码 _ => vec![]，什么都不做；只跟游标与叠画提示 */
  onMove(e, pt){
    const was = DelAnchor.hoverKey;
    DelAnchor.hover = pt;
    DelAnchor.setCursor(e.altKey);
    const k = delHoverKey(pt, e.altKey);
    if (k !== was){ DelAnchor.hoverKey = k; UI.draw(); }
  },
  onUp(){ UI.draw(); },
  onKey(e){
    if (e.key === 'Alt'){ DelAnchor.setCursor(true); if (DelAnchor.hover){ DelAnchor.hoverKey = delHoverKey(DelAnchor.hover, true); UI.draw(); } return false; }
    const k = (e.key || '').toLowerCase();
    // Delete／Backspace：有直接选取的锚点 ⇒ edit.clear 走 path.deleteAnchors（edit.rs:193-197）；没有就交回给整层的 edit.delete
    if ((k === 'delete' || k === 'backspace') && !e.ctrlKey && !e.metaKey && !e.altKey){
      VecSel.prune();
      if (VecSel.layerId && Object.keys(VecSel.anchors).length){ e.preventDefault(); CMD.run('delanchor.deleteAnchors', {}); UI.draw(); return true; }
    }
    return false;
  },
  onDeactivate(){ DelAnchor.hover = null; DelAnchor.hoverKey = null; DelAnchor.alt = false; },
  /* 原码 AnchorTool 没有 overlays()，画面上只有共用的选取显示（canvas.rs:1053 deleteAnchor 算 direct 模式）。
     我们加的：滑鼠下会被删的那个锚点画红框、Alt 时会加点的位置画小圆（原码只换游标）。 */
  drawOverlay(ctx, s){
    VecSel.drawOverlay(ctx, s);
    const h = DelAnchor.hover, L = DelAnchor.layer(); if (!h || !L) return;
    ctx.save(); ctx.setLineDash([]); ctx.lineWidth = 1.5; ctx.strokeStyle = '#e8573f';
    if (!DelAnchor.alt){
      const a = VecSel.hitAnchor(L, h, VecSel.tol(4.0));
      if (a){ const A = VecSel.asBezier(a.s).anchors, q = VecSel.toDoc(L, [A[a.idx].x, A[a.idx].y]); ctx.strokeRect(q[0]*s - 5, q[1]*s - 5, 10, 10); }   // 活形状用视图
    } else {
      const g = VecSel.hitSegment(L, h, VecSel.tol(4.0));
      if (g){ const q = VecSel.toDoc(L, g.q); ctx.strokeStyle = '#2f7fd8'; ctx.beginPath(); ctx.arc(q[0]*s, q[1]*s, 4, 0, Math.PI*2); ctx.stroke(); }
    }
    ctx.restore();
  }
});

/* 叠画提示的变化键：变了才重画 */
function delHoverKey(pt, alt){
  const L = DelAnchor.layer(); if (!L) return null;
  if (!alt){ const a = VecSel.hitAnchor(L, pt, VecSel.tol(4.0)); return a ? 'a:' + a.s.id + ':' + a.idx : null; }
  const g = VecSel.hitSegment(L, pt, VecSel.tol(4.0)); return g ? 's:' + g.s.id + ':' + g.seg + ':' + g.t.toFixed(3) : null;
}

/* 放开 Alt 时游标换回 PenDelete（onKey 只收得到 keydown）；视窗失焦当作放开 */
document.addEventListener('keyup', e => {
  if (e.key !== 'Alt' || ToolState.cur !== 'delanchor') return;
  DelAnchor.setCursor(false);
  if (DelAnchor.hover){ DelAnchor.hoverKey = delHoverKey(DelAnchor.hover, false); if (window.UI) UI.draw(); }
});
window.addEventListener('blur', () => { if (ToolState.cur === 'delanchor') DelAnchor.setCursor(false); });
