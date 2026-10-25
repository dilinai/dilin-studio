/* 加锚点（+）——照 VectorCraft 原始码逐段翻译：
     tools/src/draw2/anchor.rs     AnchorTool（id=="addAnchor" 那条路）：add、delete、pointer 的 Down 分支（Alt 对调成 delete）、cursor
     tools/src/draw2.rs            candidate_paths／hit_segment／hit_anchor（已在 tools/_vecsel.js 里，这里直接用）
     engine/src/cmd/path.rs        path.insertAnchor（insert_anchor）
     geom/src/path.rs              SubPath::insert_anchor（切段、新锚点与两邻把手怎么改、kind 定什么）、Anchor::has_in/has_out
     engine/src/cmd/draw2.rs       path.removeAnchor（Alt 分支要用；实作在 tools/delanchor.js，这里转过去）
     ui-egui/src/cursors.rs        pen(…, "+")／pen(…, "-") 游标图形
   行为（全照原码）：
     按下（不按 Alt）＝ hit_segment(容差 4 屏幕像素) 命中就 path.insertAnchor{段, t}；没命中什么都不做（anchor.rs:40-45）
     按下（按着 Alt）＝ hit_anchor(容差 4 屏幕像素) 命中就 path.removeAnchor；没命中什么都不做（anchor.rs:47-52、82-88）
     拖曳、放开、双击：什么都不做（anchor.rs:171 `_ => vec![]`）
     游标：不按 Alt＝钢笔＋「+」；按着 Alt＝钢笔＋「−」（anchor.rs:183-184）；悬停不画别的预览（AnchorTool 没有 overlay）
     叠画：只有共用的选取显示（canvas.rs:1053 direct 家族：选中路径的轮廓、锚点、把手）
   坐标：Pointer 给文件坐标，形状存图层坐标；命中走 VecSel（内部 toLayer），命令收的是段号与 t，跟坐标无关。 */
(function(){
  const EPS = 1e-9;                                                   // geom/src/lib.rs EPS
  /* Anchor::has_in／has_out：把手离锚点 > EPS 才算有；我们 null＝没有 */
  const hasH = (a, h) => !!h && Math.hypot(h[0] - a.x, h[1] - a.y) > EPS;
  /* 他们「把手等于 p＝没把手」；我们存成 null */
  const norm = (a, h) => hasH(a, h) ? [h[0], h[1]] : null;
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

  /* 找路径（他们的 path_mut(d, id)＋subpaths.get(si)；我们一个 bezier 形状＝一条只有 subpath 0 的路径） */
  function findPath(p, C){
    const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
    if (!L || L.kind !== 'vector') return {err:{ok:false, error:C + ': not a vector layer'}};
    let id = p.shapeId;
    if (id === undefined || id === null){                             // 缺省：这层第一条选中的路径
      if (VecSel.layerId === L.id) id = VecSel.shapes.find(x => { const s = L.data.shapes.find(y => y.id === x); return s && VecSel.asBezier(s); });
      if (id === undefined) return {err:{ok:false, error:C + ': missing shapeId'}};
    }
    const s = L.data.shapes.find(x => x.id === id);
    VecSel.ensureBezier(L, s);                                        // path_mut：活形状（矩形／椭圆…）一动锚点就转成路径（path.rs:115）
    if (!s || s.type !== 'bezier' || !Array.isArray(s.anchors)) return {err:{ok:false, error:C + ': no such path'}};
    if ((p.subpath || 0) !== 0) return {err:{ok:false, error:C + ': no such subpath'}};
    return {L, s};
  }
  /* serde as_u64：非负整数才收 */
  const asU = v => (typeof v === 'number' && Number.isInteger(v) && v >= 0) ? v : null;

  /* SubPath::insert_anchor（geom/src/path.rs:254-270）：在第 seg 段参数 t 切开，插入新锚点，回新锚点索引 */
  function insertAnchor(s, seg, t){
    const A = s.anchors, n = A.length;
    const c = VecSel.segment(s, seg);                                 // CubicBez(a.p, a.h_out, b.h_in, b.p)
    const i0 = seg % n, i1 = (seg + 1) % n;
    const line = !hasH(A[i0], A[i0].out) && !hasH(A[i1], A[i1].in);   // segment_is_line
    const [l, r] = VecSel.splitCubic(c, t);                           // subsegment(0..t)、subsegment(t..1)
    let mid;
    if (line){
      mid = {x:l.p3[0], y:l.p3[1], in:null, out:null};                // Anchor::corner(l.p3)：直线段插直角点，两邻不动
    } else {
      A[i0].out = norm(A[i0], l.c1);                                  // 前锚点 out ← l.p1
      A[i1].in  = norm(A[i1], r.c2);                                  // 后锚点 in  ← r.p2
      mid = {x:l.p3[0], y:l.p3[1], in:null, out:null, kind:'smooth'}; // 新锚点：in＝l.p2、out＝r.p1、kind＝Smooth
      mid.in = norm(mid, l.c2); mid.out = norm(mid, r.c1);
    }
    A.splice(seg + 1, 0, mid);
    return seg + 1;
  }

  /* path.removeAnchor（draw2.rs:589-653）的翻译在 tools/delanchor.js（delanchor.remove）；本档的 Alt 分支转过去用，不另留一份 */

  /* ── 命令（agent 走这几条做得到跟滑鼠一样的事）── */
  CMD.reg('addanchor.insert', {i18n:'', undoable:true,
    params:'{shapeId?（缺省＝这层第一条选中的路径）, segment:段号 0 起（段 i＝锚点 i→i+1；闭合路径最后一段回到锚点 0）, t=0.5（0..1，超出夹住）, subpath?=0, layerId?} ' +
           '在该段参数 t 处插一个锚点、形状不变（照 VectorCraft path.insertAnchor／SubPath::insert_anchor：直线段插直角点、两邻不动；' +
           '曲线段用 de Casteljau 切开，新锚点 kind=smooth、in/out＝切后两段的内侧控制点，前锚点 out 与后锚点 in 缩成切后的把手）→ {ok, anchor:新锚点索引}'}, p => {
    const {L, s, err} = findPath(p, 'addanchor.insert'); if (err) return err;
    const seg = asU(p.segment);
    if (seg === null) return {ok:false, error:'addanchor.insert: missing segment'};
    if (seg >= VecSel.segCount(s)) return {ok:false, error:'addanchor.insert: no such segment'};
    let t = (typeof p.t === 'number' && isFinite(p.t)) ? p.t : 0.5;
    t = Math.max(0, Math.min(1, t));
    const idx = insertAnchor(s, seg, t);
    // 多做的一步（原码没有）：这条路径若是「部分选中」，把插入点之后的选中索引往后挪一格，免得选中的锚点错位
    if (VecSel.layerId === L.id && VecSel.anchors[s.id]) VecSel.anchors[s.id] = VecSel.anchors[s.id].map(i => i >= idx ? i + 1 : i);
    Layer.invalidate(L);
    return {ok:true, anchor:idx, shapeId:s.id, layerId:L.id};
  });

  CMD.reg('addanchor.remove', {i18n:'', undoable:true,
    params:'{shapeId?（缺省＝这层第一条选中的路径）, anchor:锚点索引, subpath?=0, layerId?} 删一个锚点并重拉两邻把手（照 VectorCraft path.removeAnchor：' +
           '中间点／闭合路径且 ≥3 点时，两邻外侧把手按 (l1+l2)/l 拉长至多 3 倍，没把手的一侧朝被删点放弦长 1/3；两段都是直线则不动；' +
           '开放路径两端的朝外把手清掉；剩 <2 点整条删掉）→ {ok, removedObject}'}, p => {
    // 正文只留 delanchor.remove 一份（同一段 draw2.rs:589-653 的翻译），这里转过去；参数名两边一样
    const {err} = findPath(p, 'addanchor.remove'); if (err) return err;
    return CMD.map['delanchor.remove'].run(Object.assign({}, p));
  });

  /* 等同用这颗工具在 (x,y) 点一下（anchor.rs pointer Down 分支）；滑鼠也走这条 */
  CMD.reg('addanchor.click', {i18n:'',
    params:'{x, y 文件坐标, alt?:bool, tol?:文件单位（缺省 4 屏幕像素）, layerId?} 等同用加锚点工具在 (x,y) 点一下：' +
           '不按 Alt＝点到线段就在最近点插锚点（addanchor.insert）；alt=true＝点到锚点就删掉（addanchor.remove）；点不到什么都不做 → {ok, hit, …}'}, p => {
    const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
    if (!L || L.kind !== 'vector' || !L.visible) return {ok:true, hit:false};   // candidate_paths 只收 is_editable 的
    const pt = [+p.x, +p.y];
    const tol = (typeof p.tol === 'number' && p.tol >= 0) ? p.tol : VecSel.tol(4);
    if (p.alt){
      const h = VecSel.hitAnchor(L, pt, tol, false);
      if (!h) return {ok:true, hit:false};
      return Object.assign({hit:true}, CMD.run('addanchor.remove', {shapeId:h.s.id, anchor:h.idx, layerId:L.id}));
    }
    const h = VecSel.hitSegment(L, pt, tol);
    if (!h) return {ok:true, hit:false};
    return Object.assign({hit:true}, CMD.run('addanchor.insert', {shapeId:h.s.id, segment:h.seg, t:h.t, layerId:L.id}));
  });

  /* ── 游标：照 cursors.rs pen()——笔尖朝左上热点，右下角带「+」或「−」；白晕黑墨；整体右下挪 2 像素好放白晕 ── */
  function penCursor(badge){
    const o = 2, P = (x, y) => `${x + o},${y + o}`;
    const ln = (a, b) => `<line x1="${a[0]+o}" y1="${a[1]+o}" x2="${b[0]+o}" y2="${b[1]+o}" stroke="#fff" stroke-width="3"/>` +
                         `<line x1="${a[0]+o}" y1="${a[1]+o}" x2="${b[0]+o}" y2="${b[1]+o}" stroke="#000" stroke-width="1.2"/>`;
    const poly = [P(0,0), P(4,12), P(8,16), P(16,8), P(12,4)].join(' ');
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">` +
      `<polygon points="${poly}" fill="none" stroke="#fff" stroke-width="3"/>` +
      `<polygon points="${poly}" fill="#000" stroke="#000" stroke-width="1"/>` +
      `<circle cx="${6+o}" cy="${6+o}" r="1.4" fill="#fff"/>` + ln([10,14], [14,18]);
    const b = [16, 14];
    svg += ln([b[0], b[1]+3], [b[0]+6, b[1]+3]);                                     // 横
    if (badge === '+') svg += ln([b[0]+3, b[1]], [b[0]+3, b[1]+6]);                  // 竖
    svg += '</svg>';
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${o} ${o}, crosshair`;   // canvas.rs:385 系统游标退回 Crosshair
  }
  const CUR_ADD = penCursor('+'), CUR_DEL = penCursor('-');
  const setCursor = alt => { if (window.UI && UI.canvas && ToolState.cur === 'addanchor') UI.canvas.style.cursor = alt ? CUR_DEL : CUR_ADD; };

  const AddAnchor = { CUR_ADD, CUR_DEL, insertAnchor };
  window.AddAnchor = AddAnchor;

  Tools.reg({
    id:'addanchor', icon:'✒₊', key:'+', group:'vector', order:12, for:'vector', opts:[],
    hint:'ui.addanchorHint', cursor:CUR_ADD,
    strings:{
      'zh-Hant':{'tool.addanchor':'增加錨點', 'ui.addanchorHint':'點路徑線段＝在那裡加一個錨點（形狀不變）；按住 Alt 點錨點＝刪除錨點'},
      'zh-Hans':{'tool.addanchor':'添加锚点', 'ui.addanchorHint':'点路径线段＝在那里加一个锚点（形状不变）；按住 Alt 点锚点＝删除锚点'},
      'en':{'tool.addanchor':'Add Anchor Point', 'ui.addanchorHint':'Click a path segment to add an anchor there (shape unchanged); Alt-click an anchor to delete it'}
    },
    /* anchor.rs:82-88：只在按下那一刻做事 */
    onDown(e, pt){
      CMD.run('addanchor.click', {x:pt[0], y:pt[1], alt:!!e.altKey});
      UI.draw();
    },
    /* anchor.rs:181-184：游标跟着 Alt 换 */
    onMove(e){ setCursor(!!e.altKey); },
    onKey(e){ if (e.key === 'Alt') setCursor(true); return false; },
    onDeactivate(){},
    drawOverlay(ctx, s){ VecSel.drawOverlay(ctx, s); }
  });

  // 放开 Alt 时游标换回「+」（ui.js 只把 keydown 交给工具）；切走视窗时也换回
  document.addEventListener('keyup', e => { if (e.key === 'Alt') setCursor(false); });
  window.addEventListener('blur', () => setCursor(false));
  // 美式键盘的「+」要按 Shift：ui.js 比对符号键时不看 Shift，这里不用再补认
})();
