/* 剪刀（C）——照 VectorCraft 原始码逐段翻译：
     tools/src/draw2/anchor.rs   AnchorTool 的 "scissors" 分支：pointer Down（96-104）、cursor（187-193）；没有 overlays、没有修饰键分支
     tools/src/draw2.rs          hit_anchor（98-113）／hit_segment（116-126）／candidate_paths（79-95）→ 用共用层 VecSel.hitAnchor／hitSegment
     engine/src/cmd/draw2.rs     path.split 登记（66-74）与正文 split()（734-804）、sibling_with（249-261）
     geom/src/path.rs            SubPath::insert_anchor（254-270）、segment_is_line（216-221）、Anchor::has_in/has_out（129-134）；EPS＝1e-9（geom/src/lib.rs:24）
   行为：
     按下 ⇒ 先找容差 tol(4.0)（4 屏幕像素）内最近的锚点：有就在那个锚点剪（就算是开放路径的端点、剪不了也不再退去找线段）；
             没有锚点再找线段：在线段上 t 处剪（t≈0／≈1 当成剪在线段两端的锚点，否则先按 t 插一个锚点再剪）；都没有＝什么都不做。
     闭合路径 ⇒ 从剪口打开：锚点轮转成剪口在第一个，再在尾巴补一个剪口的复本（第一个留出去的把手、复本留进来的把手），两个都成直角点；整条选中。
     开放路径 ⇒ 剪成两条：剪口两边各一个锚点（前段的末点去掉出把手、后段的首点去掉进把手，都成直角点）；
               他们是同一个 node 只有一个 subpath 时另造一个 sibling node 插在原 node 上一层，两条都选中。
     开放路径的端点 ⇒ 报错「cannot split an open path at its end point」，文件不动、不留历史。
     游标：滑鼠下有线段＝十字（Crosshair），没有＝禁止（NotAllowed）。
   我们这边的对应：一个 bezier 形状＝他们一条只有一个 subpath 的路径（subpath 永远 0），所以「剪成两段」＝原形状改成前段、
     再 addShape 一个同外观的新 bezier 形状当后段，插在原形状的上一层（shapes 陣列 idx+1）；把手 null＝他们「把手等于锚点」。
   一刀（含插点）＝一条命令＝一步历史；选取状态（VecSel）随历史进退。 */
const Scissors = {
  EPS: 1e-9,
  cursorHit: null,

  /* Anchor::has_in/has_out：把手离锚点超过 EPS 才算有 */
  has(h, a){ return !!h && Math.hypot(h[0] - a.x, h[1] - a.y) > this.EPS; },
  /* 他们的把手等于锚点＝没有把手；我们存 null */
  norm(h, p){ return (h && Math.hypot(h[0] - p[0], h[1] - p[1]) > this.EPS) ? [h[0], h[1]] : null; },
  clone(a){
    const o = {x:a.x, y:a.y, in:a.in ? [a.in[0], a.in[1]] : null, out:a.out ? [a.out[0], a.out[1]] : null};
    if (a.kind) o.kind = a.kind;
    return o;
  },

  /* SubPath::insert_anchor(seg, t)（geom/src/path.rs:254-270）：在第 seg 段的 t 处插一个锚点、形状不变，回传新锚点索引 */
  insertAnchor(A, closed, seg, t){
    const n = A.length, i0 = seg % n, i1 = (seg + 1) % n;
    const c = VecSel.segment({anchors:A, closed}, seg);
    const line = !this.has(A[i0].out, A[i0]) && !this.has(A[i1].in, A[i1]);        // segment_is_line
    const [l, r] = VecSel.splitCubic(c, t);                                          // c.subsegment(0..t)／(t..1)
    const p = l.p3;
    let mid;
    if (line) mid = {x:p[0], y:p[1], in:null, out:null, kind:'corner'};             // Anchor::corner(l.p3)
    else {
      A[i0].out = this.norm(l.c1, [A[i0].x, A[i0].y]);                               // anchors[i0].h_out = l.p1
      A[i1].in  = this.norm(r.c2, [A[i1].x, A[i1].y]);                               // anchors[i1].h_in  = r.p2
      mid = {x:p[0], y:p[1], in:this.norm(l.c2, p), out:this.norm(r.c1, p), kind:'smooth'};
    }
    A.splice(seg + 1, 0, mid);
    return seg + 1;
  },

  /* path.split 正文（engine/src/cmd/draw2.rs:734-804）。p＝{anchor} 或 {segment, t}；全部在复本上算，出错就不动文件 */
  split(L, s, p){
    const C = 'scissors.cut';
    const anchor = (Number.isInteger(p.anchor) && p.anchor >= 0) ? p.anchor : null;       // as_u64：负数／小数当没给
    const seg = (Number.isInteger(p.segment) && p.segment >= 0) ? p.segment : null;
    if (anchor === null && seg === null) return {ok:false, error:C + ': need `anchor` or `segment` + `t`'};
    if (p.t !== undefined && (typeof p.t !== 'number' || !isFinite(p.t))) return {ok:false, error:C + ': invalid t'};
    const t = (p.t === undefined) ? 0.5 : p.t;                                              // f64_or(p, "t", 0.5)
    if (p.subpath !== undefined && p.subpath !== 0) return {ok:false, error:'no such subpath'};   // 我们一个形状只有 subpath 0

    VecSel.ensureBezier(L, s);                                                              // path_mut：活形状转成路径（draw2.rs:156-165）
    const A = s.anchors.map(a => this.clone(a));
    const n = A.length, closed = !!s.closed;
    let k;
    if (anchor !== null){
      if (anchor < n) k = anchor;
      else return {ok:false, error:'no such anchor'};
    } else if (seg < VecSel.segCount(s)){
      if (t <= 1e-6) k = seg;
      else if (t >= 1 - 1e-6) k = (seg + 1) % n;
      else k = this.insertAnchor(A, closed, seg, t);
    } else return {ok:false, error:'no such segment'};

    if (closed){                                                                            // draw2.rs:765-777
      const R = A.slice(k).concat(A.slice(0, k));                                           // rotate_left(k)
      const last = this.clone(R[0]);
      last.out = null;                                                                      // last.h_out = last.p
      R[0].in = null;                                                                       // anchors[0].h_in = anchors[0].p
      last.kind = 'corner'; R[0].kind = 'corner';
      R.push(last);
      s.anchors = R; s.closed = false;
      Layer.invalidate(L);
      VecSel.setShapes(L.id, [s.id]);                                                       // sel.set([id])
      return {ok:true, ids:[s.id], layerId:L.id};
    }
    const n2 = A.length;
    if (k === 0 || k + 1 >= n2) return {ok:false, error:'cannot split an open path at its end point'};   // draw2.rs:779-781
    const left = A.slice(0, k + 1).map(a => this.clone(a));
    const right = A.slice(k).map(a => this.clone(a));
    left[k].out = null; left[k].kind = 'corner';                                           // left.anchors[k].h_out = lp
    right[0].in = null; right[0].kind = 'corner';                                           // right.anchors[0].h_in = lp

    // sibling_with：复制原 node 的全部外观、换上后段的几何；新 id 走 addShape 发
    const props = JSON.parse(JSON.stringify(s));
    delete props.id;
    const docA = right.map(a => ({x:a.x + L.x, y:a.y + L.y, in:a.in ? [a.in[0] + L.x, a.in[1] + L.y] : null, out:a.out ? [a.out[0] + L.x, a.out[1] + L.y] : null}));
    const r = addShape(Object.assign(props, {type:'bezier', anchors:docA, closed:false, layerId:L.id}));
    if (!r || !r.id) return {ok:false, error:(r && r.error) || 'cannot add the second piece'};
    const S = L.data.shapes;
    const ni = S.findIndex(x => x.id === r.id), nsh = S[ni];
    nsh.anchors = right;                                                                    // 用图层坐标原值（addShape 的平移会丢 kind）
    S.splice(ni, 1);
    const oi = S.indexOf(s);
    S.splice(oi + 1, 0, nsh);                                                               // d.insert(parent, idx + 1, node)：插在原形状上一层
    s.anchors = left;                                                                       // path.subpaths[0] = left
    Layer.invalidate(L);
    VecSel.setShapes(L.id, [s.id, nsh.id]);                                                 // sel.set([id, nid])
    return {ok:true, ids:[s.id, nsh.id], layerId:L.id};
  },

  /* 滑鼠／cutAt 用的命中：先锚点、再线段（anchor.rs:97-103）→ scissors.cut 的参数；没命中回 null */
  pick(L, pt, tol){
    const ha = VecSel.hitAnchor(L, pt, tol);
    if (ha) return {layerId:L.id, shapeId:ha.s.id, anchor:ha.idx};
    const hs = VecSel.hitSegment(L, pt, tol);
    if (hs) return {layerId:L.id, shapeId:hs.s.id, segment:hs.seg, t:hs.t};
    return null;
  },
  /* candidate_paths 只收 is_editable（看得见、没锁）的路径：隐藏的层不剪 */
  layer(p){
    const L = (p && p.layerId) ? Doc.byId(p.layerId) : Doc.active();
    return (L && L.kind === 'vector') ? L : null;
  },
  /* 没给 shapeId：先用选中的第一条 bezier，没有就用这层最上面那条 */
  shapeOf(L, id){
    const B = L.data.shapes.filter(x => { const g = VecSel.asBezier(x); return g && g.anchors && g.anchors.length; });   // 活形状也算路径
    if (id !== undefined && id !== null) return B.find(x => x.id === id) || null;
    if (VecSel.layerId === L.id) for (const sid of VecSel.shapes){ const s = B.find(x => x.id === sid); if (s) return s; }
    return B.length ? B[B.length - 1] : null;
  },
  /* cursor()（anchor.rs:187-193）：底下有线段＝十字，没有＝禁止 */
  updateCursor(pt){
    const L = this.layer(), hit = !!(L && L.visible && VecSel.hitSegment(L, pt, VecSel.tol(4)));
    if (hit !== this.cursorHit){ this.cursorHit = hit; UI.canvas.style.cursor = hit ? 'crosshair' : 'not-allowed'; }
  }
};
window.Scissors = Scissors;

/* ── 命令（agent 走这两条做得到跟滑鼠一样的事；每条一步历史，连插点带剪）── */
CMD.reg('scissors.cut', {i18n:'', undoable:true,
  params:'{shapeId?, layerId?, subpath?=0, anchor} 在第 anchor 个锚点剪 | {shapeId?, layerId?, subpath?=0, segment, t=0.5} 在第 segment 段的 t 处剪（t≤1e-6／≥1−1e-6 当成剪在该段两端的锚点，否则先按 t 插锚点再剪）。'
        + '照 VectorCraft path.split：闭合路径从剪口打开成一条开放路径（剪口锚点轮到第一个、尾巴补一个复本，两个都成直角点，选中它）；'
        + '开放路径剪成两条（原形状留前段、新形状＝后段、同外观、插在原形状上一层，两条都选中）；开放路径的端点剪不了（报错、不留历史）。'
        + 'shapeId 缺省＝目前选中的第一条钢笔路径，没有就用这层最上面那条。→ {ok, ids:[原形状id, 新形状id?], layerId}'}, p => {
  const L = Scissors.layer(p); if (!L) return {ok:false, error:'not a vector layer'};
  const s = Scissors.shapeOf(L, p.shapeId); if (!s) return {ok:false, error:'scissors.cut: no such pen path'};
  return Scissors.split(L, s, p);
});
CMD.reg('scissors.cutAt', {i18n:'', undoable:true,
  params:'{x, y, layerId?, tol?} 文件坐标；照剪刀工具按下那一下：先找 tol（缺省 4 屏幕像素换成文件单位）内最近的锚点、没有再找线段，然后同 scissors.cut。点不到东西回 {ok:false}、不留历史'}, p => {
  const L = Scissors.layer(p); if (!L) return {ok:false, error:'not a vector layer'};
  if (typeof p.x !== 'number' || typeof p.y !== 'number') return {ok:false, error:'missing x/y'};
  const q = Scissors.pick(L, [p.x, p.y], (typeof p.tol === 'number') ? p.tol : VecSel.tol(4));
  if (!q) return {ok:false, error:'no path under the point'};
  return Scissors.split(L, Scissors.shapeOf(L, q.shapeId), q);
});

Tools.reg({
  id:'scissors', icon:'✂', key:'C', group:'vector', order:15, for:'vector', opts:[],
  hint:'ui.scissorsHint', cursor:'not-allowed',
  strings:{
    'zh-Hant':{'tool.scissors':'剪刀', 'ui.scissorsHint':'點路徑上的錨點或線段把它剪斷：開放路徑變兩條，封閉路徑從剪口打開成一條開放路徑；開放路徑的端點剪不了'},
    'zh-Hans':{'tool.scissors':'剪刀', 'ui.scissorsHint':'点路径上的锚点或线段把它剪断：开放路径变两条，闭合路径从剪口打开成一条开放路径；开放路径的端点剪不了'},
    'en':{'tool.scissors':'Scissors', 'ui.scissorsHint':'Click an anchor or a segment to split the path there: an open path becomes two, a closed path opens at the cut; the end points of an open path cannot be split'}
  },
  /* 只有按下有动作（anchor.rs:96-104）；拖曳、放开、修饰键都不管 */
  onDown(e, pt){
    const L = Scissors.layer();
    if (!L || !L.visible) return;
    const q = Scissors.pick(L, pt, VecSel.tol(4));
    if (!q) return;                                       // 点不到：vec![]，什么都不做
    CMD.run('scissors.cut', q);                           // 开放路径端点：命令回 {ok:false}，文件与历史都不动
    UI.draw();
  },
  onMove(e, pt){ if (!e.buttons) Scissors.updateCursor(pt); },
  onDeactivate(){ Scissors.cursorHit = null; },
  /* 原码剪刀没有自己的 overlays；画布上只有选取显示（选中路径的轮廓与锚点） */
  drawOverlay(ctx, s){ VecSel.drawOverlay(ctx, s); }
});
