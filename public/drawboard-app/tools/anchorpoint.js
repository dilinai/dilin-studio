/* 锚点工具（Shift+C）——照 VectorCraft 原始码逐段翻译：
     tools/src/draw2/anchor.rs        id=="anchorPoint" 那条路（State::Convert／Handle／Reshape 三态；pointer 105-170、deactivate 174-180、cursor 194）
                                      ＋同档的 hit_handle（56-69：选中物件的「全部」锚点、先 out 后 in、第一个命中就回）
     tools/src/draw2.rs               hit_anchor（98-113）、hit_segment（116-126）→ 我们用 VecSel.hitAnchor／hitSegment
     engine/src/cmd/draw2.rs          path.convertAnchor（49-56 规格、655-701 实作）、path.reshapeSegment（57-64、703-730）
     engine/src/cmd/path.rs           path.setHandle（34-42、190-204）、path.convertAnchors（79-87、388-431）
     geom/src/path.rs                 Anchor::with_handles（124-128）、has_in／has_out（129-134）、set_handle（145-161）、retract（167-171）、is_collinear（174-179）
   行为：
     点锚点（没拖过门槛）＝有把手就转直角（两支把手收回、kind=corner）；没把手的直角点点了什么都不做
     在锚点上拖＝拉出对称平滑把手（out 在滑鼠处、in 镜射，kind=smooth）
     拖把手（只认「选中路径」的把手）＝只动这一支、另一支不动（independent:true ⇒ kind=corner）
     【我们多加·原码没有·照 Illustrator】点一下把手端点（没拖）＝只收掉这一支；把手拖回锚点 4 屏幕像素内放开＝同上（anchorpoint.removeHandle）
     拖线段＝重塑这一段：两支内侧控制点各加 v＝d／(3t(1-t))，B(t) 正好跟着滑鼠移 d
     锚点／线段要拖过 2 屏幕像素才算拖；把手一动就算（anchor.rs:119-120）
     拖曳中 Begin 记原状、每次 Preview 从原状重套一次命令（文件里直接看得到真实外观）、放开 Commit ⇒ 一步历史
     原码没有 Esc 处理（AnchorTool 没实作 key()，壳层 shortcuts.rs:149-166 在 busy 时也不替它取消）⇒ 我们也不吃 Esc
     拖到一半换工具 ⇒ 保留预览（Commit，anchor.rs:174-180）
   我们这边的锚点：{x, y, in:[x,y]|null, out:[x,y]|null, kind:'corner'|'smooth'}（图层坐标；null＝他们的「把手等于 p」）。
   命令收文件坐标、存图层坐标（图层被移动过也对）。 */

const AnchorPt = {
  EPS: 1e-9,                       // geom/src/lib.rs:24 EPS
  st: null,                        // null＝State::Idle；{kind:'convert'|'handle'|'reshape', layerId, shapeId, ai, out, seg, t, start, began, orig, last}

  /* ── 几何小帮手（抄 geom/src/path.rs）── */
  dist(p, q){ return Math.hypot(p[0]-q[0], p[1]-q[1]); },
  hp(a, h){ return h ? [h[0], h[1]] : [a.x, a.y]; },                                   // 我们的 null ＝ 他们的「把手等于 p」
  hasIn(a){ return !!a.in && Math.hypot(a.in[0]-a.x, a.in[1]-a.y) > this.EPS; },       // Anchor::has_in
  hasOut(a){ return !!a.out && Math.hypot(a.out[0]-a.x, a.out[1]-a.y) > this.EPS; },   // Anchor::has_out
  /* 把手跟锚点重合（≤EPS）就写成 null，免得留下「看不见的把手」 */
  norm(a){ if (!this.hasIn(a)) a.in = null; if (!this.hasOut(a)) a.out = null; return a; },
  kindOf(a){ return a.kind || VecSel.anchorKind(a); },                                 // kind 缺省（钢笔画的）按几何推
  retract(a){ a.in = null; a.out = null; a.kind = 'corner'; },                           // Anchor::retract
  /* is_collinear（path.rs:174-179）：注意长度用 max(1.0)，跟 VecSel.anchorKind 不同，照抄 */
  isCollinear(p, a, b){
    const va = [a[0]-p[0], a[1]-p[1]], vb = [b[0]-p[0], b[1]-p[1]];
    const cross = va[0]*vb[1] - va[1]*vb[0], dot = va[0]*vb[0] + va[1]*vb[1];
    return Math.abs(cross) <= 1e-6 * Math.max(Math.hypot(va[0], va[1]), 1) * Math.max(Math.hypot(vb[0], vb[1]), 1) && dot < 0;
  },
  /* Anchor::with_handles（path.rs:124-128）：共线反向且两支都不为零 ⇒ smooth，否则 corner */
  withHandles(p, hin, hout){
    const smooth = this.isCollinear(p, hin, hout) && this.dist(hin, p) > this.EPS && this.dist(hout, p) > this.EPS;
    return this.norm({x:p[0], y:p[1], in:[hin[0], hin[1]], out:[hout[0], hout[1]], kind: smooth ? 'smooth' : 'corner'});
  },

  /* ── 三条命令的本体（坐标一律图层坐标；先验参数、再动手，失败不留半套改动）── */
  /* path.convertAnchor（draw2.rs:655-701） */
  opConvert(s, ai, smooth, target){
    const A = s.anchors, n = A.length;
    if (!(Number.isInteger(ai) && ai >= 0 && ai < n)) return {ok:false, error:'no such anchor'};
    const prev = (ai > 0 || s.closed) ? [A[(ai + n - 1) % n].x, A[(ai + n - 1) % n].y] : null;
    const next = (ai + 1 < n || s.closed) ? [A[(ai + 1) % n].x, A[(ai + 1) % n].y] : null;
    const a = A[ai], p = [a.x, a.y];
    if (!smooth){ this.retract(a); return {ok:true}; }
    if (target){
      if (this.dist(target, p) > 1e-9){                       // 出去那支在 (x,y)、进来那支镜射
        a.out = [target[0], target[1]];
        a.in = [p[0] - (target[0] - p[0]), p[1] - (target[1] - p[1])];
        a.kind = 'smooth';
      } else this.retract(a);
    } else {                                                  // 没给 x/y：把手平行 prev→next、长度各为到邻点距离的 1/3
      const pp = prev || p, nn = next || p;
      const dir = [nn[0] - pp[0], nn[1] - pp[1]], l = Math.hypot(dir[0], dir[1]);
      if (l > 1e-9){
        const u = [dir[0] / l, dir[1] / l], li = this.dist(p, pp) / 3, lo = this.dist(p, nn) / 3;
        a.in = [p[0] - u[0]*li, p[1] - u[1]*li];
        a.out = [p[0] + u[0]*lo, p[1] + u[1]*lo];
        a.kind = 'smooth';
      } else a.kind = this.kindOf(a);                         // 原码这时什么都不改；我们只把 kind 明写出来
    }
    this.norm(a);
    return {ok:true};
  },
  /* path.setHandle → Anchor::set_handle（path.rs:145-161） */
  opSetHandle(s, ai, out, pos, independent){
    const a = s.anchors[ai];
    if (!(Number.isInteger(ai) && a)) return {ok:false, error:'no such anchor'};
    let kind = this.kindOf(a);
    if (independent) kind = 'corner';                         // independent 先把锚点变直角
    const p = [a.x, a.y], smooth = kind === 'smooth';
    const mk = out ? 'out' : 'in', ok = out ? 'in' : 'out';
    const other = this.hp(a, a[ok]);
    a[mk] = [pos[0], pos[1]];
    if (smooth){                                              // 平滑点：另一支转到同一直线上、长度不变
      const len = this.dist(other, p), dir = [p[0] - pos[0], p[1] - pos[1]], l = Math.hypot(dir[0], dir[1]);
      if (l > 1e-9) a[ok] = [p[0] + dir[0] * (len / l), p[1] + dir[1] * (len / l)];
    }
    a.kind = kind;
    this.norm(a);
    return {ok:true};
  },
  /* 原码没有这条（照 Illustrator 补，单独删一支把手）：只收回一支把手，另一支不动；
     剩一支的锚点只能是直角点（Illustrator 同） */
  opRemoveHandle(s, ai, out){
    const a = s.anchors[ai];
    if (!(Number.isInteger(ai) && a)) return {ok:false, error:'no such anchor'};
    const mk = out ? 'out' : 'in';
    if (!(out ? this.hasOut(a) : this.hasIn(a))) return {ok:false, error:'no such handle'};
    a[mk] = null; a.kind = 'corner';
    this.norm(a);
    return {ok:true};
  },
  /* path.reshapeSegment（draw2.rs:703-730） */
  opReshape(s, seg, t, dx, dy){
    t = Math.min(0.95, Math.max(0.05, (typeof t === 'number' && isFinite(t)) ? t : 0.5));
    if (!(isFinite(dx) && isFinite(dy))) return {ok:false, error:'invalid delta'};
    if (!(Number.isInteger(seg) && seg >= 0 && seg < VecSel.segCount(s))) return {ok:false, error:'no such segment'};
    const A = s.anchors, n = A.length;
    const k = 3 * t * (1 - t), v = [dx / k, dy / k];          // 两支内侧控制点都移 v ⇒ B(t) 移 3t(1-t)·v
    const i0 = seg % n, i1 = (seg + 1) % n;
    const a = A[i0], ao = this.hp(a, a.out);
    A[i0] = this.withHandles([a.x, a.y], this.hp(a, a.in), [ao[0] + v[0], ao[1] + v[1]]);
    const b = A[i1], bi = this.hp(b, b.in);
    A[i1] = this.withHandles([b.x, b.y], [bi[0] + v[0], bi[1] + v[1]], this.hp(b, b.out));
    return {ok:true};
  },

  /* ── 命令参数 → 本体（命令与拖曳预览共用这一条路；x/y 是文件坐标）── */
  apply: {
    'anchorpoint.convert'(L, s, p){
      const smooth = p.to === 'smooth';
      const has = typeof p.x === 'number' && typeof p.y === 'number';
      return AnchorPt.opConvert(s, +p.anchor, smooth, has ? VecSel.toLayer(L, [p.x, p.y]) : null);
    },
    'anchorpoint.setHandle'(L, s, p){
      if (!(typeof p.x === 'number' && typeof p.y === 'number' && isFinite(p.x) && isFinite(p.y))) return {ok:false, error:'missing x/y'};
      return AnchorPt.opSetHandle(s, +p.anchor, p.which !== 'in', VecSel.toLayer(L, [p.x, p.y]), !!p.independent);
    },
    'anchorpoint.removeHandle'(L, s, p){
      return AnchorPt.opRemoveHandle(s, +p.anchor, p.which !== 'in');
    },
    'anchorpoint.reshapeSegment'(L, s, p){
      const n = v => (v === undefined || v === null) ? 0 : +v;
      return AnchorPt.opReshape(s, +p.segment, p.t === undefined ? 0.5 : +p.t, n(p.dx), n(p.dy));
    }
  },
  resolve(p, C){
    const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
    if (!L || L.kind !== 'vector') return {err:{ok:false, error:C + ': not a vector layer'}};
    const sid = p.shapeId !== undefined ? p.shapeId : p.id;
    const s = L.data.shapes.find(x => x.id === sid);
    VecSel.ensureBezier(L, s);                                // path_mut：活形状一动锚点就转成路径（draw2.rs:156-165）
    if (!s || s.type !== 'bezier' || !s.anchors) return {err:{ok:false, error:C + ': no such path'}};
    if (p.subpath !== undefined && +p.subpath !== 0) return {err:{ok:false, error:C + ': no such subpath'}};   // 我们一个形状只有一条 subpath
    return {L, s};
  },

  /* ── 命中 ── */
  layer(){ const L = Doc.active(); return (L && L.kind === 'vector') ? L : null; },
  /* anchor.rs:56-69 hit_handle：选中物件（selection.objects）的「每一个」锚点都算（不管锚点有没有部分选中），
     依选取顺序、锚点顺序，先看 out 再看 in，第一个落在容差内的就回（不是找最近） */
  hitHandle(L, pt, tol){
    if (VecSel.layerId !== L.id) return null;
    const p = VecSel.toLayer(L, pt);
    for (const id of VecSel.shapes){
      const s = L.data.shapes.find(x => x.id === id), g = VecSel.asBezier(s);   // 活形状用视图
      if (!g || !g.anchors) continue;
      for (let i = 0; i < g.anchors.length; i++){
        const a = g.anchors[i];
        if (this.hasOut(a) && this.dist(a.out, p) <= tol) return {s, idx:i, out:true};
        if (this.hasIn(a) && this.dist(a.in, p) <= tol) return {s, idx:i, out:false};
      }
    }
    return null;
  },
  shapeOf(st){
    const L = Doc.byId(st.layerId);
    const s = L && L.kind === 'vector' ? L.data.shapes.find(x => x.id === st.shapeId) : null;
    return s && VecSel.asBezier(s) ? {L, s} : null;          // 活形状也收（拖曳预览时才转）
  },

  /* ── 滑鼠（anchor.rs:105-170）── */
  down(e, pt){
    this.st = null;
    const L = this.layer(); if (!L) return;
    const tol = VecSel.tol(4);                                // cx.tol(4.0)
    let h;
    if ((h = this.hitHandle(L, pt, tol)))
      this.st = {kind:'handle', layerId:L.id, shapeId:h.s.id, ai:h.idx, out:h.out, began:false};
    else if ((h = VecSel.hitAnchor(L, pt, tol)))
      this.st = {kind:'convert', layerId:L.id, shapeId:h.s.id, ai:h.idx, start:[pt[0], pt[1]], began:false};
    else if ((h = VecSel.hitSegment(L, pt, tol)))
      this.st = {kind:'reshape', layerId:L.id, shapeId:h.s.id, seg:h.seg, t:h.t, start:[pt[0], pt[1]], began:false};
  },
  drag(e, pt){
    const st = this.st; if (!st) return;
    // 锚点／线段：离按下点 ≥ cx.tol(2.0) 才算拖；把手：一动就算（anchor.rs:117-121）
    const far = st.kind === 'handle' ? true : this.dist(pt, st.start) >= VecSel.tol(2);
    if (!st.began){
      if (!far) return;
      // Action::Begin(Convert→"Convert Anchor Point"，其余→"Reshape")：记下原状（快照）
      const r = this.shapeOf(st); if (!r){ this.st = null; return; }
      st.label = st.kind === 'convert' ? 'Convert Anchor Point' : 'Reshape';
      st.orig = VecSel.cloneShape(r.s);                       // 整个形状拍下（活形状预览时会被转成路径，Commit 前要还原成原种类）
      st.began = true;
    }
    // Action::Preview：每次都从原状重套一次命令（取代上一个预览）
    const base = {shapeId:st.shapeId, layerId:st.layerId, subpath:0};
    const r = this.shapeOf(st); if (!r){ this.st = null; return; }
    VecSel.restoreShape(r.s, st.orig); VecSel.ensureBezier(r.L, r.s);
    let cmd, params;
    if (st.kind === 'convert'){ cmd = 'anchorpoint.convert'; params = Object.assign(base, {anchor:st.ai, to:'smooth', x:pt[0], y:pt[1]}); }
    else if (st.kind === 'handle'){
      const a = r.s.anchors[st.ai], which = st.out ? 'out' : 'in';
      // 我们多加的（Illustrator 同）：把手拖回锚点 4 屏幕像素内 ⇒ 这一支收掉（原码要正好重合才算，滑鼠办不到）
      if (a && this.dist(VecSel.toLayer(r.L, pt), [a.x, a.y]) <= VecSel.tol(4)){ cmd = 'anchorpoint.removeHandle'; params = Object.assign(base, {anchor:st.ai, which}); }
      else { cmd = 'anchorpoint.setHandle'; params = Object.assign(base, {anchor:st.ai, which, x:pt[0], y:pt[1], independent:true}); }
    }
    else { cmd = 'anchorpoint.reshapeSegment'; params = Object.assign(base, {segment:st.seg, t:st.t, dx:pt[0] - st.start[0], dy:pt[1] - st.start[1]}); }
    const res = this.apply[cmd](r.L, r.s, params);
    Layer.invalidate(r.L);
    if (res && res.ok !== false) st.last = {cmd, params};
  },
  /* Action::Commit：把文件退回 Begin 的原状，再用最后一个预览的参数正式跑一次命令 ⇒ 刚好一步历史 */
  commit(st){
    const r = this.shapeOf(st);
    if (r && st.orig){ VecSel.restoreShape(r.s, st.orig); Layer.invalidate(r.L); }
    if (r && st.last) CMD.run(st.last.cmd, st.last.params);
  },
  up(e, pt){
    const st = this.st; this.st = null;                       // std::mem::replace(&mut self.state, Idle)
    if (!st) return;
    if (st.began){ this.commit(st); return; }
    if (st.kind === 'handle'){                                // 我们多加的（Illustrator 同）：点一下把手端点（没拖）⇒ 只收掉这一支
      CMD.run('anchorpoint.removeHandle', {shapeId:st.shapeId, layerId:st.layerId, subpath:0, anchor:st.ai, which: st.out ? 'out' : 'in'});
      return;
    }
    if (st.kind === 'convert'){                               // 没拖：有把手的锚点 ⇒ 转直角；没把手 ⇒ 什么都不做
      const r = this.shapeOf(st), a = r && VecSel.asBezier(r.s).anchors[st.ai];   // 活形状用视图看有没有把手
      if (a && (this.hasIn(a) || this.hasOut(a)))
        CMD.run('anchorpoint.convert', {shapeId:st.shapeId, layerId:st.layerId, subpath:0, anchor:st.ai, to:'corner'});
    }
  },
  deactivate(){                                               // anchor.rs:174-180：拖到一半换工具 ⇒ Commit
    const st = this.st; this.st = null;
    if (st && st.began) this.commit(st);
  }
};
window.AnchorPt = AnchorPt;

/* ── 命令（agent 走这几条做得到跟滑鼠一样的事）── */
CMD.reg('anchorpoint.convert', {i18n:'', undoable:true,
  params:'{shapeId, anchor, to:"corner"|"smooth", x?, y?, layerId?, subpath?=0} 转换锚点（照 path.convertAnchor）：' +
         'to=corner ⇒ 两支把手收回、kind=corner；to=smooth 给 x/y（文件坐标）⇒ out 在 (x,y)、in 镜射、kind=smooth（x/y 就在锚点上则收回成直角）；' +
         'to=smooth 不给 x/y ⇒ 把手平行「前一点→后一点」、长度各为到邻点距离的 1/3（开放路径端点那侧收回）'}, p => {
  const {L, s, err} = AnchorPt.resolve(p, 'anchorpoint.convert'); if (err) return err;
  const r = AnchorPt.apply['anchorpoint.convert'](L, s, p);
  if (r.ok !== false) Layer.invalidate(L);
  return r;
});
CMD.reg('anchorpoint.setHandle', {i18n:'', undoable:true,
  params:'{shapeId, anchor, which:"in"|"out", x, y, independent?:bool, layerId?, subpath?=0} 把某锚点的一支把手放到 (x,y)（文件坐标；照 path.setHandle / Anchor::set_handle）：' +
         'independent=true ⇒ 锚点先变 corner、只动这一支（锚点工具拖把手就是这样）；independent=false 且锚点是 smooth ⇒ 另一支转到同一直线反向、长度不变'}, p => {
  const {L, s, err} = AnchorPt.resolve(p, 'anchorpoint.setHandle'); if (err) return err;
  const r = AnchorPt.apply['anchorpoint.setHandle'](L, s, p);
  if (r.ok !== false) Layer.invalidate(L);
  return r;
});
CMD.reg('anchorpoint.removeHandle', {i18n:'', undoable:true,
  params:'{shapeId, anchor, which:"in"|"out", layerId?, subpath?=0} 只收掉某锚点的一支把手、另一支不动、锚点变 corner（原码没有；照 Illustrator：锚点工具点一下把手端点／把把手拖回锚点）；那一支本来就没有 ⇒ 报错'}, p => {
  const {L, s, err} = AnchorPt.resolve(p, 'anchorpoint.removeHandle'); if (err) return err;
  const r = AnchorPt.apply['anchorpoint.removeHandle'](L, s, p);
  if (r.ok !== false) Layer.invalidate(L);
  return r;
});
CMD.reg('anchorpoint.reshapeSegment', {i18n:'', undoable:true,
  params:'{shapeId, segment, t=0.5, dx=0, dy=0, layerId?, subpath?=0} 弯曲第 segment 段（锚点 segment → segment+1），让段上参数 t 那一点移动 (dx,dy)（照 path.reshapeSegment）：' +
         't 夹在 0.05..0.95；两端内侧把手各加 v=(dx,dy)/(3t(1-t))，两端锚点的 kind 按把手是否共线重判'}, p => {
  const {L, s, err} = AnchorPt.resolve(p, 'anchorpoint.reshapeSegment'); if (err) return err;
  const r = AnchorPt.apply['anchorpoint.reshapeSegment'](L, s, p);
  if (r.ok !== false) Layer.invalidate(L);
  return r;
});
/* path.convertAnchors（path.rs:388-431）：控制列上的「转换选中锚点」按钮；对 VecSel 选中的锚点（整条选中＝全部锚点）一起转 */
CMD.reg('anchorpoint.convertAnchors', {i18n:'', undoable:true,
  params:'{to:"corner"|"smooth"} 把直接选取选中的锚点（整条选中＝该路径全部锚点）一起转换（照 path.convertAnchors）：' +
         'corner ⇒ 收回把手；smooth ⇒ 把手平行「前一点→后一点」、长度各为到邻点距离的 1/3；没有选取 ⇒ 报错'}, p => {
  VecSel.prune();
  const L = VecSel.layer(), T = VecSel.selectedAnchors();
  if (!L || !T.length) return {ok:false, error:'anchorpoint.convertAnchors: no selection'};
  const smooth = p.to === 'smooth';
  T.forEach(({s}) => VecSel.ensureBezier(L, s));              // path_mut：活形状先转成路径（索引跟视图一样）
  T.forEach(({s, idx}) => AnchorPt.opConvert(s, idx, smooth, null));
  Layer.invalidate(L);
  return {ok:true, count:T.length};
});

/* 游标：原码 anchor.rs:194 是 Cursor::Pen（跟钢笔同一只）。我们给它一只 PS 式「转换点」游标（笔尖加 ^），
   不然钢笔按 Alt 临时切成锚点工具时画面上看不出来。白晕黑墨，热点在笔尖。 */
AnchorPt.CURSOR = (() => {
  const o = 2;
  const ln = (a, b) => `<line x1="${a[0]+o}" y1="${a[1]+o}" x2="${b[0]+o}" y2="${b[1]+o}" stroke="#fff" stroke-width="3"/>` +
                       `<line x1="${a[0]+o}" y1="${a[1]+o}" x2="${b[0]+o}" y2="${b[1]+o}" stroke="#000" stroke-width="1.2"/>`;
  const P = (x, y) => `${x + o},${y + o}`;
  const poly = [P(0,0), P(4,12), P(8,16), P(16,8), P(12,4)].join(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">` +
    `<polygon points="${poly}" fill="none" stroke="#fff" stroke-width="3"/>` +
    `<polygon points="${poly}" fill="#000" stroke="#000" stroke-width="1"/>` +
    `<circle cx="${6+o}" cy="${6+o}" r="1.4" fill="#fff"/>` + ln([10,14], [14,18]) +
    ln([16, 20], [19, 15]) + ln([19, 15], [22, 20]) +                                   // ^ 记号
    `</svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${o} ${o}, crosshair`;
})();

Tools.reg({
  id:'anchorpoint', icon:'⌃', key:'C', shift:true, group:'vector', order:14, for:'vector', opts:[],
  cursor:AnchorPt.CURSOR,                                     // anchor.rs:194 Cursor::Pen；我们改用带 ^ 的钢笔游标（见上）
  hint:'ui.anchorpointHint',
  strings:{
    'zh-Hant':{'tool.anchorpoint':'錨點工具',
               'ui.anchorpointHint':'點平滑錨點＝轉直角（兩支把手都收）；在錨點上拖＝拉出對稱把手；拖把手＝只動這一支（選取中的路徑才抓得到把手）；點一下把手端點或把它拖回錨點＝只刪這一支；拖線段＝彎曲這一段'},
    'zh-Hans':{'tool.anchorpoint':'锚点工具',
               'ui.anchorpointHint':'点平滑锚点＝转直角（两支把手都收）；在锚点上拖＝拉出对称把手；拖把手＝只动这一支（选中的路径才抓得到把手）；点一下把手端点或把它拖回锚点＝只删这一支；拖线段＝弯曲这一段'},
    'en':{'tool.anchorpoint':'Anchor Point Tool',
          'ui.anchorpointHint':'Click a smooth anchor = corner (both handles retract); drag an anchor = pull out smooth handles; drag a handle = move it alone (handles of selected paths); click a handle end or drag it back onto the anchor = remove just that handle; drag a segment = reshape it'}
  },
  onDown(e, pt){ AnchorPt.down(e, pt); UI.draw(); },
  onMove(e, pt, P){ if (P.down && AnchorPt.st){ AnchorPt.drag(e, pt); UI.draw(); } },
  onUp(e, pt){ AnchorPt.up(e, pt); UI.draw(); },
  onDeactivate(){ AnchorPt.deactivate(); },
  /* 原码没有这条：拖曳中文件里是预览，这时让 Ctrl+Z／Y 动文件历史会把预览弄乱 ⇒ 拖到一半先不让退 */
  onUndoKey(){ return !!(AnchorPt.st && AnchorPt.st.began); },
  /* 叠画：选中路径的锚点与把手（共用层）＋拖曳中正在改的那条路径（蓝线＋动到的锚点与把手） */
  drawOverlay(ctx, s){
    VecSel.drawOverlay(ctx, s);
    const st = AnchorPt.st; if (!st || !st.began) return;
    const r = AnchorPt.shapeOf(st); if (!r) return;
    const L = r.L, sh = r.s, blue = '#2f7fd8';
    const D = a => ({x:a.x + L.x, y:a.y + L.y, in:a.in ? [a.in[0] + L.x, a.in[1] + L.y] : null, out:a.out ? [a.out[0] + L.x, a.out[1] + L.y] : null});
    const A = sh.anchors.map(D);
    ctx.save(); ctx.setLineDash([]); ctx.lineWidth = 1; ctx.strokeStyle = blue;
    ctx.beginPath(); bezierPath(ctx, {anchors:A, closed:sh.closed}, s); ctx.stroke();
    const idx = st.kind === 'reshape' ? [st.seg % A.length, (st.seg + 1) % A.length] : [st.ai];
    idx.forEach(i => {
      const a = A[i]; if (!a) return;
      [a.in, a.out].forEach(h => {
        if (!h) return;
        ctx.strokeStyle = blue; ctx.beginPath(); ctx.moveTo(a.x*s, a.y*s); ctx.lineTo(h[0]*s, h[1]*s); ctx.stroke();
        ctx.fillStyle = blue; ctx.beginPath(); ctx.arc(h[0]*s, h[1]*s, 2.5, 0, Math.PI*2); ctx.fill();
      });
      ctx.fillStyle = blue; ctx.fillRect(a.x*s - 3.5, a.y*s - 3.5, 7, 7);
    });
    ctx.restore();
  }
});
