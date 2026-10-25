/* 弯度钢笔工具（PS P 那格 ps.pen-curvature）——PhotoCraft 没有这颗；照 VectorCraft 的「曲率工具」（Illustrator Shift+~，PS 弯度钢笔就是照它做的）逐段翻：
   vectorcraft/crates/
   - tools/src/draw2/curvature.rs 全档：
       每点一下加一点，路径以 Catmull-Rom 平滑穿过所有点；Alt＋点（新点）＝直角点；Alt＋点 或 双击 已有的点＝平滑⇄直角切换；
       拖已有的点＝移动它（拖超过 3 屏幕像素才算，一整拖一步历史）；点第一个点（≥3 点、还没闭合）＝闭合；
       Backspace／Delete＝删掉最后碰过的点（没碰过就删最后一点；剩不到 3 点就打开）；Esc／Enter＝结束这条；
       画的那条要「仍是唯一选中的物件、锚点数对得上」才算还在画（active），不然下一点开新路径；
       叠画：到游标的橡皮筋曲线（1px 蓝）＋每个点的方块（最后碰过的实心）
   - tools/src/draw2.rs:36-59 catmull_rom（直角点／开放路径两端／不到 3 点＝没把手；其余把手＝(下一点−上一点)/6）
   - engine/src/cmd/draw2.rs:552-585 curvature（path.curvature：没 id＝新路径用目前填色＋描边，两样都没有就黑描边；有 id＝整条换掉、选中它）
   我们这边：路径＝当前矢量层里的一个 bezier 形状（不是矢量层就新建一层，同钢笔）；「唯一选中的物件」＝VecSel 只选它。
   每一下都是一条 curvaturepen.set 命令（＝原码每个 Exec 一步历史）；拖点＝拖动中直接改形状预览、放开时退回原样再下一条命令（一步）。
   ── 原码没有、照 PS 2020 加的：
   点到当前矢量层已有 bezier 路径（钢笔等画的；已选的优先）的锚点＝接手那条（grab／adopt）：双击／Alt＋点＝平滑⇄直角、拖＝移动；
   接手来的点没动过就留原把手（点上带 h）；点到已选路径／正在画的路径的线段（5 屏幕像素内）＝在那里插一点（insertAt），两旁接手来的点改照 Catmull-Rom 顺过。 */

const CV_BLUE = '#4f9dff';                                           // draw2.rs:23 FEEDBACK
/* draw2.rs:39-59 catmull_rom（自带一份，跟 freeformpen.js 的同一套） */
function cvCatmull(points, closed){
  const n = points.length, A = [];
  for (let i = 0; i < n; i++){
    const p = points[i].p, ends = !closed && (i === 0 || i + 1 === n);
    // 我们加的（PS 2020：弯度钢笔改别的工具画的路径）：接手的点没动过就留着原来的把手
    if (points[i].h){ const h = points[i].h; A.push({x:p[0], y:p[1], in:h.in ? h.in.slice() : null, out:h.out ? h.out.slice() : null}); continue; }
    if (points[i].corner || ends || n < 3){ const a = {x:p[0], y:p[1], in:null, out:null}; if (points[i].corner && points[i].h0) a.h0 = JSON.parse(JSON.stringify(points[i].h0)); A.push(a); continue; }   // h0＝变直角前的原把手（相对锚点），回平滑时还原（PS）
    const pv = points[(i + n - 1) % n].p, nx = points[(i + 1) % n].p, t = [(nx[0] - pv[0]) / 6, (nx[1] - pv[1]) / 6];
    if (Math.hypot(t[0], t[1]) < 1e-9){ A.push({x:p[0], y:p[1], in:null, out:null}); continue; }
    A.push({x:p[0], y:p[1], in:[p[0] - t[0], p[1] - t[1]], out:[p[0] + t[0], p[1] + t[1]]});
  }
  return {anchors:A, closed:closed && n > 2};
}

const CV_WORK = {id:'work', x:0, y:0, work:true};                    // 工作路径（文件坐标）当成一个「图层」
const CurvaturePen = {
  pts: [],               // [{p:[x,y] 文件坐标, corner}]
  closed: false,
  id: null,              // {layerId, shapeId}：正在画的那条
  drag: null,            // {i, start, began, snap}
  current: null,         // 最后碰过的点（Backspace 删它）
  hover: null,

  tol(px){ return px / Math.max(UI.zoom, 1e-9); },
  /* 路径模式（PS 选项栏；tools/vecmode.js）：画进工作路径 */
  workMode(){ return this === window.CurvaturePen && !!(window.VecMode && VecMode.current() === 'path'); },
  shape(){ const r = this.id; if (!r) return null;
    if (r.work){ const w = Doc.workPath, s = w && Array.isArray(w.subpaths) ? w.subpaths[r.index] : null; return s && Array.isArray(s.anchors) ? {L:CV_WORK, s, work:true} : null; }
    const L = Doc.byId(r.layerId); const s = L && L.kind === 'vector' ? L.data.shapes.find(x => x.id === r.shapeId) : null; return s ? {L, s} : null; },
  /* curvature.rs:29-36 active：仍是唯一选中的物件、只有一条子路径、锚点数对得上 */
  active(){
    const h = this.shape(); if (!h) return null;
    if (h.work){ const ps = window.PsWindow && PsWindow.paths; return (this.workMode() && h.s.anchors.length === this.pts.length && (!ps || ps.sel === 'work')) ? h : null; }
    if (!window.VecSel || VecSel.layerId !== h.L.id || VecSel.shapes.length !== 1 || VecSel.shapes[0] !== h.s.id) return null;
    if (h.s.type !== 'bezier' || !h.s.anchors || h.s.anchors.length !== this.pts.length) return null;
    return h;
  },
  /* 我们加的：点位从文件里那条读回来（Ctrl+Z 退掉一次「拖点」后锚点数没变、原码仍当在画，但手上的点还是拖过的位置——下一点会把退掉的又写回去） */
  sync(h){
    const A = h.s.anchors, n = A.length;
    A.forEach((a, i) => {
      const q = this.pts[i]; if (!q) return;
      q.p = [a.x + h.L.x, a.y + h.L.y];
      if (q.h){ const m = v => v ? [v[0] + h.L.x, v[1] + h.L.y] : null; q.h = (a.in || a.out) ? {in:m(a.in), out:m(a.out)} : null; if (!q.h) q.corner = true; return; }
      if ((h.s.closed || (i > 0 && i < n - 1)) && n >= 3) q.corner = !a.in && !a.out;
      if (!a.in && !a.out && a.h0) q.h0 = JSON.parse(JSON.stringify(a.h0));
    });
    this.closed = !!h.s.closed && n > 2;
  },
  params(){
    const v = {points:this.pts.map(q => { const o = {x:q.p[0], y:q.p[1], corner:!!q.corner}; if (q.h){ o.in = q.h.in; o.out = q.h.out; } else if (q.corner && q.h0) o.h0 = q.h0; return o; }), closed:this.closed};
    if (this.id && this.id.work){ v.work = true; v.index = this.id.index; }
    else if (this.id){ v.shapeId = this.id.shapeId; v.layerId = this.id.layerId; }
    else if (this.workMode()) v.work = true;
    return v;
  },
  hitPoint(p){ const tol = this.tol(5); const i = this.pts.findIndex(q => Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) <= tol); return i < 0 ? null : i; },
  reset(){ this.pts = []; this.closed = false; this.id = null; this.drag = null; this.current = null; },
  exec(){ const r = CMD.run('curvaturepen.set', this.params()); if (r && r.ok !== false && !this.id){ if (r.work) this.id = {work:true, index:r.index}; else if (r.id) this.id = {layerId:r.layerId, shapeId:r.id}; } return r; },

  /* curvature.rs:68-105 pointer Down */
  down(e, pt){
    const p = [pt[0], pt[1]];
    let act = this.active();
    if (!act && this.id) this.reset();
    // PS 2020（原码只认自己正在画的那条）：点到图层上已有路径（钢笔等画的）的锚点／已选路径的线段＝接手那条接着改
    if (!act){ const g = this.grab(p); if (g){ this.adopt(g); act = this.active(); if (act && g.seg !== undefined){ this.insertAt(g.seg, p, e.altKey); return; } } }
    if (act) this.sync(act);
    if (act){
      const i = this.hitPoint(p);
      if (i !== null){
        this.current = i;
        if (e.altKey){ this.toggle(i); this.exec(); return; }
        if (i === 0 && !this.closed && this.pts.length >= 3){ this.closed = true; this.exec(); return; }
        this.drag = {i, start:p, began:false, snap:null};
        return;
      }
      // PS：点在路径线段上＝在那里加一点（不是接到尾端）
      const sg = this.segAt(this.pts, this.closed, p);
      if (sg !== null){ this.insertAt(sg, p, e.altKey); return; }
      if (!this.closed){
        this.pts.push({p, corner:!!e.altKey}); this.current = this.pts.length - 1;
        this.exec(); return;
      }
    }
    // 开新路径（第一点不认 Alt）
    this.reset();
    this.pts.push({p, corner:false}); this.current = 0;
    this.exec();                                                     // ＋ Notify("created")：记下新路径的 id
  },
  /* 平滑⇄直角。PS：带原把手的点变直角时记住原把手（h0，相对锚点），再变回平滑＝还原原把手；没记过的平滑＝照 Catmull-Rom 算 */
  toggle(i){
    const q = this.pts[i], rel = v => v ? [v[0] - q.p[0], v[1] - q.p[1]] : null, abs = v => v ? [q.p[0] + v[0], q.p[1] + v[1]] : null;
    if (q.h){ q.h0 = {in:rel(q.h.in), out:rel(q.h.out)}; q.h = null; q.corner = true; return; }
    if (q.corner && q.h0){ q.h = {in:abs(q.h0.in), out:abs(q.h0.out)}; q.h0 = null; q.corner = false; return; }
    q.corner = !q.corner; q.h0 = null;
  },
  /* 我们加的（PS 2020）：找图层上可接手的路径——当前矢量层的 bezier 路径（已选的优先）；点到锚点＝{i}，点到已选路径的线段＝{seg} */
  /* 顺序：路径模式先找工作路径 → 当前层 → 别的看得见的矢量层（由上往下；PS：点到别层的路径＝选到那层接手） */
  grab(p){
    const tol = this.tol(5), valid = s => s && Array.isArray(s.anchors) && s.anchors.length;
    const look = (L, list, selList) => {
      for (const s of list){ const i = s.anchors.findIndex(a => Math.hypot(a.x + L.x - p[0], a.y + L.y - p[1]) <= tol); if (i >= 0) return {L, s, i}; }
      for (const s of selList){ const seg = this.segAt(this.ptsOf(L, s), !!s.closed, p); if (seg !== null) return {L, s, seg}; }
      return null;
    };
    if (this.workMode() && Doc.workPath && Array.isArray(Doc.workPath.subpaths)){
      const ps = window.PsWindow && PsWindow.paths, list = Doc.workPath.subpaths.filter(valid);
      const g = look(CV_WORK, list, (!ps || ps.sel === 'work') ? list : []);
      if (g){ g.work = true; g.index = Doc.workPath.subpaths.indexOf(g.s); return g; }
    }
    const act = Doc.active(), layers = [act].concat(Doc.layers.slice().reverse().filter(L => L !== act));
    for (const L of layers){
      if (!L || L.kind !== 'vector' || !L.visible || (L.locks && L.locks.all)) continue;
      const sel = (window.VecSel && VecSel.layerId === L.id) ? VecSel.shapes : [];
      const list = L.data.shapes.filter(s => s.type === 'bezier' && valid(s) && s.visible !== false && !s.locked);
      list.sort((a, b) => (sel.includes(b.id) ? 1 : 0) - (sel.includes(a.id) ? 1 : 0));
      const g = look(L, list, L === act ? list.filter(s => sel.includes(s.id)) : []);
      if (g) return g;
    }
    return null;
  },
  ptsOf(L, s){
    const m = v => v ? [v[0] + L.x, v[1] + L.y] : null, n = s.anchors.length;
    return s.anchors.map((a, i) => {
      const h = (a.in || a.out) ? {in:m(a.in), out:m(a.out)} : null, q = {p:[a.x + L.x, a.y + L.y], corner:!h, h};
      if (!h && a.h0) q.h0 = JSON.parse(JSON.stringify(a.h0));
      return q;
    });
  },
  adopt(g){
    this.reset();
    this.pts = this.ptsOf(g.L, g.s); this.closed = !!g.s.closed && g.s.anchors.length > 2;
    if (g.i !== undefined) this.current = g.i;
    if (g.work){ this.id = {work:true, index:g.index}; if (window.PsWindow && PsWindow.paths) PsWindow.paths.sel = 'work'; return; }
    this.id = {layerId:g.L.id, shapeId:g.s.id};
    if (Doc.activeId !== g.L.id){ CMD.run('layer.select', {id:g.L.id}); if (window.UI) UI.refresh(); }     // 别层的路径：选到那层（PS）
    VecSel.setShapes(g.L.id, [g.s.id]);
  },
  /* 点在哪一段线段上（5 屏幕像素内；每段取样 24 点）→ 段的起点序号，或 null */
  segAt(pts, closed, p){
    if (pts.length < 2) return null;
    const sp = cvCatmull(pts, closed), A = sp.anchors, n = A.length, tol = this.tol(5);
    let best = null, bd = tol;
    for (let i = 0; i < (sp.closed ? n : n - 1); i++){
      const a = A[i], b = A[(i + 1) % n], p0 = [a.x, a.y], p1 = a.out || p0, p3 = [b.x, b.y], p2 = b.in || p3;
      for (let k = 1; k < 24; k++){
        const t = k / 24, u = 1 - t, w = [u*u*u, 3*u*u*t, 3*u*t*t, t*t*t];
        const x = w[0]*p0[0] + w[1]*p1[0] + w[2]*p2[0] + w[3]*p3[0], y = w[0]*p0[1] + w[1]*p1[1] + w[2]*p2[1] + w[3]*p3[1];
        const d = Math.hypot(x - p[0], y - p[1]); if (d < bd){ bd = d; best = i; }
      }
    }
    return best;
  },
  /* 在第 seg 段中间插一点（Alt＝直角点）；两旁接手来的点保留原把手会让曲线歪 ⇒ 它们改照 Catmull-Rom 重算（同 PS：加点后邻点重新顺过） */
  insertAt(seg, p, corner){
    const n = this.pts.length, j = seg + 1;
    [this.pts[seg], this.pts[j % n]].forEach(q => { if (q && q.h){ q.h = null; q.corner = false; } });
    this.pts.splice(j, 0, {p:p.slice(), corner:!!corner});
    this.current = j;
    this.exec();
  },
  /* :106-121 Drag：超过 3 屏幕像素才 Begin；之后每动一下 Preview */
  move(e, pt){
    const d = this.drag; if (!d) return false;
    const p = [pt[0], pt[1]];
    if (!d.began){
      if (Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) < this.tol(3)) return false;
      const h = this.shape(); if (!h) { this.drag = null; return false; }
      d.began = true; d.snap = VecSel.cloneShape(h.s);
    }
    const q = this.pts[d.i];
    if (q.h){ const dx = p[0] - q.p[0], dy = p[1] - q.p[1], m = v => v ? [v[0] + dx, v[1] + dy] : null; q.h = {in:m(q.h.in), out:m(q.h.out)}; }   // 接手来的点：把手跟着点走
    q.p = p;
    this.previewInPlace();
    return true;
  },
  /* 预览：直接改形状（不进历史），放开时退回再下命令 */
  previewInPlace(){
    const h = this.shape(); if (!h) return;
    const sp = cvCatmull(this.pts, this.closed), L = h.L;
    h.s.anchors = sp.anchors.map(a => ({x:a.x - L.x, y:a.y - L.y, in:a.in ? [a.in[0] - L.x, a.in[1] - L.y] : null, out:a.out ? [a.out[0] - L.x, a.out[1] - L.y] : null}));
    h.s.closed = sp.closed;
    Layer.invalidate(L);
  },
  /* :122-125 Up：开始拖过才 Commit */
  up(){
    const d = this.drag; this.drag = null;
    if (!d || !d.began) return;
    const h = this.shape(); if (h && d.snap){ VecSel.restoreShape(h.s, d.snap); Layer.invalidate(h.L); }
    this.exec();
  },
  /* 拖到一半取消：退回拖之前的样子与点位 */
  cancelDrag(){
    const d = this.drag; this.drag = null;
    if (!d || !d.began) return;
    const h = this.shape(); if (h && d.snap){ VecSel.restoreShape(h.s, d.snap); Layer.invalidate(h.L); }
  },
  /* :126-133 DoubleClick：点上＝平滑⇄直角 */
  dbl(pt){
    if (!this.active()) return;
    const i = this.hitPoint(pt); if (i === null) return;
    this.toggle(i);
    this.exec();
  },
  /* :141-159 key */
  key(e){
    const k = e.key;
    if (k === 'Escape' || k === 'Enter'){
      if (!this.id && !this.drag) return false;
      if (this.drag) this.cancelDrag();                               // 拖到一半：Action::Cancel（退回预览）
      this.reset(); return true;
    }
    if ((k === 'Backspace' || k === 'Delete') && this.active() && this.pts.length > 1 && !this.drag){
      e.preventDefault();
      const i = Math.min(this.current === null ? this.pts.length - 1 : this.current, this.pts.length - 1);
      this.pts.splice(i, 1);
      if (this.pts.length < 3) this.closed = false;
      this.current = null;
      this.exec(); return true;
    }
    return false;
  },
  /* :165-185 overlays */
  overlay(ctx, s){
    if (!this.active()) return;
    const dpr = s / Math.max(UI.zoom, 1e-9);
    ctx.save(); ctx.setLineDash([]);
    if (!this.closed && !this.drag && this.hover){
      const sp = cvCatmull(this.pts.concat([{p:this.hover, corner:false}]), false);
      ctx.strokeStyle = CV_BLUE; ctx.lineWidth = dpr; ctx.beginPath(); bezierPath(ctx, sp, s); ctx.stroke();
    }
    this.pts.forEach((q, i) => {
      const x = q.p[0] * s, y = q.p[1] * s, r = 3 * dpr;
      ctx.fillStyle = i === this.current ? CV_BLUE : '#fff'; ctx.fillRect(x - r, y - r, 2*r, 2*r);
      ctx.strokeStyle = CV_BLUE; ctx.lineWidth = dpr; ctx.strokeRect(x - r, y - r, 2*r, 2*r);
    });
    ctx.restore();
  }
};
window.CurvaturePen = CurvaturePen;

/* draw2.rs:554-585 path.curvature */
CMD.reg('curvaturepen.set', {i18n:'', undoable:true,
  params:'{points:[{x,y,corner?, in?:[x,y], out?:[x,y]（给了＝这点照用这对把手、不套 Catmull-Rom）}]（或 [[x,y]…]）文件坐标 ≥1 点, closed?:bool, shapeId?（给了＝整条换掉那条路径）, layerId?, work?:true（写进工作路径＝PS 路径模式）, index?（work 时换掉第几条子路径）} ' +
         '＝ 弯度钢笔（path.curvature）：Catmull-Rom 平滑穿过各点（corner＝直角点、开放路径两端没把手）；没 shapeId＝新路径画进当前矢量层（不是就新建），填色＋描边用目前的、两样都没有＝黑描边；选中它 → {ok, id, layerId}'}, p => {
  const C = 'curvaturepen.set';
  const pts = (Array.isArray(p.points) ? p.points : []).map(v => {
    const q = Array.isArray(v) ? [+v[0], +v[1]] : (v && typeof v === 'object') ? [+v.x, +v.y] : null;
    if (!(q && isFinite(q[0]) && isFinite(q[1]))) return null;
    const hv = k => (v && Array.isArray(v[k]) && isFinite(+v[k][0]) && isFinite(+v[k][1])) ? [+v[k][0], +v[k][1]] : null;
    const h = (!Array.isArray(v) && (hv('in') || hv('out'))) ? {in:hv('in'), out:hv('out')} : null;   // 给了 in／out 把手＝照用（接手别的路径时保留原把手）
    const h0v = k => (v && v.h0 && Array.isArray(v.h0[k]) && isFinite(+v.h0[k][0]) && isFinite(+v.h0[k][1])) ? [+v.h0[k][0], +v.h0[k][1]] : null;
    const h0 = (!Array.isArray(v) && v.h0 && (h0v('in') || h0v('out'))) ? {in:h0v('in'), out:h0v('out')} : null;   // 直角点记著的原把手（相对锚点）
    return {p:q, corner:!!(v && v.corner), h, h0};
  }).filter(Boolean);
  if (!pts.length) return {ok:false, error:C + ': need at least one point'};
  const sp = cvCatmull(pts, !!p.closed);
  /* 路径模式（PS 选项栏 ▸ 路径）：写进工作路径（文件坐标）；index＝换掉第几条子路径，没有＝加一条（工作路径没被选著＝换一条新的工作路径） */
  if (p.work){
    const ps = window.PsWindow && PsWindow.paths, sub = {closed:!!sp.closed, anchors:sp.anchors};
    const w = Doc.workPath && Array.isArray(Doc.workPath.subpaths) ? Doc.workPath : null;
    let index;
    if (Number.isInteger(p.index) && w && w.subpaths[p.index]){ w.subpaths[p.index] = sub; index = p.index; }
    else if (window.VecMode && VecMode.addToWork) index = VecMode.addToWork([sub]);
    else { Doc.workPath = w || {layerId:null, subpaths:[]}; index = Doc.workPath.subpaths.push(sub) - 1; }
    if (ps) ps.sel = 'work';
    if (window.VecSel) VecSel.clear();
    return {ok:true, work:true, index, anchors:sp.anchors.length, closed:!!sp.closed};
  }
  if (p.shapeId){
    const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
    const s = L && L.kind === 'vector' ? L.data.shapes.find(x => x.id === p.shapeId) : null;
    if (!s) return {ok:false, error:C + ': no such path'};
    const m = q => q ? [q[0] - L.x, q[1] - L.y] : null;
    if (s.type !== 'bezier') VecSel.ensureBezier(L, s);
    s.anchors = sp.anchors.map(a => { const o = {x:a.x - L.x, y:a.y - L.y, in:m(a.in), out:m(a.out)}; if (a.h0) o.h0 = a.h0; return o; });
    s.closed = !!sp.closed;
    Layer.invalidate(L);
    VecSel.setShapes(L.id, [s.id]);
    return {ok:true, id:s.id, layerId:L.id, anchors:s.anchors.length, closed:s.closed};
  }
  let fill = UI.fill(), stroke = UI.stroke(), sw = UI.strokeW();
  if ((!fill || fill === 'none') && (!stroke || stroke === 'none')){ stroke = '#000000'; sw = sw || 1; }
  const r = addShape({type:'bezier', anchors:sp.anchors, closed:!!sp.closed, fill:fill || 'none', stroke, strokeWidth:sw, layerId:p.layerId});
  if (!r || r.ok === false) return r;
  VecSel.setShapes(r.layerId, [r.id]);
  return {ok:true, id:r.id, layerId:r.layerId, anchors:sp.anchors.length, closed:!!sp.closed};
});
CMD.reg('curvaturepen.state', {i18n:'', params:'{} → {active, points:[{x,y,corner}], closed, shapeId, layerId, current}  弯度钢笔正在画的那条'}, () => {
  const a = CurvaturePen.active();
  return {ok:true, active:!!a, points:CurvaturePen.pts.map(q => ({x:q.p[0], y:q.p[1], corner:!!q.corner})), closed:CurvaturePen.closed,
          shapeId:CurvaturePen.id ? CurvaturePen.id.shapeId : null, layerId:CurvaturePen.id ? CurvaturePen.id.layerId : null, current:CurvaturePen.current};
});

Tools.reg({
  id:'curvaturepen', icon:'〰', group:'vector', order:13, for:'common', needs:'vector', opts:[], cursor:'crosshair',
  hint:'ui.cvHint',
  strings:{
    'zh-Hant':{'tool.curvaturepen':'曲線筆工具', 'ui.cvHint':'點一下＝加點（路徑平滑穿過各點）｜Alt＋點＝直角點｜雙擊或 Alt＋點已有的點＝平滑⇄直角｜拖點＝移動｜點路徑線段＝在那裡加點｜點第一點＝封閉｜Delete 刪點｜Esc／Enter 結束｜也能改鋼筆畫的路徑（雙擊錨點＝變弧線）'},
    'zh-Hans':{'tool.curvaturepen':'弯度钢笔工具', 'ui.cvHint':'点一下＝加点（路径平滑穿过各点）｜Alt＋点＝直角点｜双击或 Alt＋点已有的点＝平滑⇄直角｜拖点＝移动｜点路径线段＝在那里加点｜点第一点＝闭合｜Delete 删点｜Esc／Enter 结束｜也能改钢笔画的路径（双击锚点＝变弧线）'},
    'en':{'tool.curvaturepen':'Curvature Pen Tool', 'ui.cvHint':'Click to add a point (the path curves through them) | Alt+click: corner point | Double-click or Alt+click a point: smooth ⇄ corner | Drag a point to move it | Click a segment: add a point there | Click the first point: close | Delete removes a point | Esc / Enter: finish | Also edits paths drawn with the Pen (double-click an anchor to curve it)'}
  },
  onDown(e, pt){ if (e.button !== undefined && e.button !== 0) return; CurvaturePen.hover = pt; CurvaturePen.down(e, pt); UI.draw(); },
  onMove(e, pt, P){
    CurvaturePen.hover = [pt[0], pt[1]];
    if (P.down){ if (CurvaturePen.move(e, pt)) UI.draw(); return; }
    if (CurvaturePen.active()) UI.draw();                            // 橡皮筋跟着游标
  },
  onUp(){ CurvaturePen.up(); UI.draw(); },
  onDblClick(e, pt){ CurvaturePen.dbl(pt); UI.draw(); },
  onKey(e){ if (CurvaturePen.key(e)){ UI.draw(); return true; } return false; },
  /* curvature.rs:160-164 deactivate：拖到一半＝照预览收下 */
  onDeactivate(){
    const d = CurvaturePen.drag;
    if (d && d.began){ const h = CurvaturePen.shape(); if (h && d.snap){ VecSel.restoreShape(h.s, d.snap); Layer.invalidate(h.L); } CurvaturePen.drag = null; CurvaturePen.exec(); }
    CurvaturePen.reset(); CurvaturePen.hover = null;
  },
  /* 拖到一半 Ctrl+Z：先不让退（拖动中形状是预览） */
  onUndoKey(){ return !!(CurvaturePen.drag && CurvaturePen.drag.began); },
  drawOverlay(ctx, s){ CurvaturePen.overlay(ctx, s); }
});
