/* 堤麟画板 · 直接选择（A）—— 照 ArtCraft VectorCraft 原码逐段翻译
   主体：vectorcraft/crates/tools/src/direct.rs（DirectSelectionTool，group=false 那一支）
   命令正文：engine/src/cmd/select.rs（select.set／add／toggle／none／anchors／anchorsMany）
             engine/src/cmd/path.rs（path.moveAnchors／path.setHandle／path.deleteAnchors）
             engine/src/cmd/object.rs（object.transform 的平移＋copy、object.nudge）、cmd/edit.rs（edit.clear）
             geom/src/path.rs（Anchor::set_handle／translate）、geom/src/lib.rs（constrain_angle）、tools/src/bbox.rs（move_delta）
             doc/src/hit.rs（hit_test：描边／轮廓／填色）
             ui-egui/src/shortcuts.rs:296-307（方向键→object.nudge、Delete／Backspace→edit.clear）
   按下时的判定顺序（direct.rs:200-249）：把手 → 锚点 → 物件（线段或填色）→ 空白＝框选。
   拖曳走 Begin／Preview／Commit（lib.rs:1-7）：Begin 记下底稿，每次 Preview 先回底稿再套一次命令，放开时回底稿、正式 CMD.run 一次＝一步历史。
   选取状态一律存在 VecSel（tools/_vecsel.js），这里不另存。
   坐标：Pointer 给文件坐标；形状存图层坐标；命令收文件坐标（dx/dy 是位移，不必换算）。 */

const Direct = {
  st: null,          // 当前手势：{k:'anchors'|'object', start, began} | {k:'handle', id, layerId, ai, out} | {k:'marquee', start, cur, add}
  base: null,        // Begin 时的底稿 {L, shapes, vsel}
  last: null,        // 最后一次 Preview 的命令 {id, params}（Commit 时正式跑它）

  /* ── 小工具 ── */
  dist(a, b){ return Math.hypot(a[0]-b[0], a[1]-b[1]); },
  /* bbox.rs:107 move_delta：Shift ＝ geom::constrain_angle(d, 45°)（长度不变、锁到最近的 45° 方向） */
  moveDelta(from, to, shift){
    const d = [to[0]-from[0], to[1]-from[1]];
    if (!shift) return d;
    const len = Math.hypot(d[0], d[1]); if (len < 1e-9) return d;
    const step = Math.PI/4, a = Math.round(Math.atan2(d[1], d[0]) / step) * step;
    return [Math.cos(a)*len, Math.sin(a)*len];
  },
  vecLayer(){ const L = Doc.active(); return (L && L.kind === 'vector' && L.visible) ? L : null; },

  /* direct.rs:119-145 hit_anchor(selected_only=false)：由最上面的路径往下找，第一条有锚点落在容差内的路径、按锚点顺序第一个就回
     （跟 draw2.rs 的 hit_anchor 不同：不先看选中的、也不挑最近的——direct.rs 自己有一支） */
  hitAnchor(L, pt, tol){
    const p = VecSel.toLayer(L, pt), S = L.data.shapes;
    for (let k = S.length - 1; k >= 0; k--){
      const s = S[k], g = VecSel.asBezier(s); if (!g || !g.anchors) continue;          // 活形状用视图（回传仍是原物件）
      for (let i = 0; i < g.anchors.length; i++){ const a = g.anchors[i]; if (Math.hypot(a.x-p[0], a.y-p[1]) <= tol) return {s, idx:i}; }
    }
    return null;
  },
  /* direct.rs:147-162 hit_handle：只看「部分选中」路径（selection.anchors 有条目）里选中锚点的把手，先 out 后 in，第一个就回。
     🟢 多加的：部分选中都没命中时，再看「整条选中」的路径（我们的叠画对整条选中的路径也画把手——canvas.rs:1075 同——原码却拖不动它们）。 */
  hitHandle(pt, tol){
    const L = VecSel.layer(); if (!L || L.kind !== 'vector') return null;
    const p = VecSel.toLayer(L, pt);
    const test = (s, idx) => {
      const a = VecSel.asBezier(s).anchors[idx]; if (!a) return null;                  // 活形状用视图
      if (a.out && Math.hypot(a.out[0]-a.x, a.out[1]-a.y) > 1e-9 && Math.hypot(a.out[0]-p[0], a.out[1]-p[1]) <= tol) return {s, idx, out:true};
      if (a.in  && Math.hypot(a.in[0]-a.x,  a.in[1]-a.y)  > 1e-9 && Math.hypot(a.in[0]-p[0],  a.in[1]-p[1])  <= tol) return {s, idx, out:false};
      return null;
    };
    for (const id of VecSel.shapes){
      const set = VecSel.anchors[id]; if (!set) continue;
      const s = VecSel.findShape(id); if (!s || !VecSel.asBezier(s)) continue;
      for (const idx of set){ const h = test(s, idx); if (h) return h; }
    }
    for (const id of VecSel.shapes){
      if (VecSel.anchors[id]) continue;
      const s = VecSel.findShape(id), g = VecSel.asBezier(s); if (!g || !g.anchors) continue;
      for (let idx = 0; idx < g.anchors.length; idx++){ const h = test(s, idx); if (h) return h; }
    }
    return null;
  },
  /* 一个形状的轮廓（图层坐标），给命中测试与叠画共用；跟 engine.js drawShape 的几何一致 */
  shapePath(ctx, s, S, ox, oy){
    S = S || 1; ox = ox || 0; oy = oy || 0;
    const X = x => (x + ox) * S, Y = y => (y + oy) * S;
    if (s.type === 'rect'){
      const r = (s.radius||0) * S;
      if (r > 0 && ctx.roundRect) ctx.roundRect(X(s.x), Y(s.y), s.w*S, s.h*S, r); else ctx.rect(X(s.x), Y(s.y), s.w*S, s.h*S);
    } else if (s.type === 'ellipse'){
      ctx.ellipse(X(s.x + s.w/2), Y(s.y + s.h/2), Math.abs(s.w/2)*S, Math.abs(s.h/2)*S, 0, 0, Math.PI*2);
    } else if (s.type === 'star' || s.type === 'polygon'){
      const n = s.points || (s.type === 'star' ? 5 : 6), r1 = s.r1, r2 = (s.type === 'star' ? s.r2 : r1);
      const rot = (s.rotation||0) * Math.PI/180 - Math.PI/2, steps = s.type === 'star' ? n*2 : n;
      for (let i = 0; i < steps; i++){
        const r = (s.type === 'star' && i % 2) ? r2 : r1, a = rot + i*Math.PI*2/steps;
        const px = X(s.cx + Math.cos(a)*r), py = Y(s.cy + Math.sin(a)*r);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
    } else if (s.type === 'path' || s.type === 'line'){
      (s.points||[]).forEach((q, i) => i ? ctx.lineTo(X(q[0]), Y(q[1])) : ctx.moveTo(X(q[0]), Y(q[1])));
      if (s.closed) ctx.closePath();
    } else if (s.type === 'bezier'){
      const mv = h => h ? [h[0] + ox, h[1] + oy] : null;
      bezierPath(ctx, {anchors:(s.anchors||[]).map(a => ({x:a.x + ox, y:a.y + oy, in:mv(a.in), out:mv(a.out)})), closed:s.closed}, S);
    }
  },
  _hctx: null,
  /* doc/hit.rs:60-180 hit_test：由上往下，先描边（看得见的描边按它的宽度＋容差；没描边就是轮廓线容差内＝Outline），再填色（有填色且在里面）。
     容差＝cx.hit_options().tol＝cx.tol(3)。回传最上面命中的形状。 */
  hitTest(L, pt, tol){
    const p = VecSel.toLayer(L, pt);
    const c = this._hctx || (this._hctx = document.createElement('canvas').getContext('2d'));
    const S = L.data.shapes;
    for (let k = S.length - 1; k >= 0; k--){
      const s = S[k];
      c.beginPath(); this.shapePath(c, s);
      const sw = (s.stroke && s.stroke !== 'none') ? (s.strokeWidth||0) : 0;
      c.lineWidth = sw + 2*tol; c.lineJoin = 'round'; c.lineCap = 'round';
      if (c.isPointInStroke(p[0], p[1])) return s;
      const filled = s.fill && s.fill !== 'none';
      if (filled && c.isPointInPath(p[0], p[1], 'nonzero')) return s;
    }
    return null;
  },
  /* 照 PS 补：点到哪一段（锚点 i → j）、段上参数 t；描边宽一半＋容差内才算（点在填色里面不算线段） */
  hitSegment(L, s, pt, tol){
    const g = VecSel.asBezier(s); if (!g || !g.anchors || g.anchors.length < 2) return null;
    const p = VecSel.toLayer(L, pt), A = g.anchors, n = A.length;
    const lim = tol + ((s.stroke && s.stroke !== 'none') ? (s.strokeWidth || 0) / 2 : 0);
    let best = null;
    for (let i = 0; i < (g.closed ? n : n - 1); i++){
      const a = A[i], b = A[(i + 1) % n], c = dirSegCtl(a, b);
      for (let k = 1; k < 64; k++){
        const t = k / 64, q = dirBez(c, t), d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d <= lim && (!best || d < best.d)) best = {i, j:(i + 1) % n, t, d, curved:dirCurved(a, b)};
      }
    }
    return best;
  },

  /* ── Begin／Preview／Commit（lib.rs:1-7、engine lib.rs:1073 begin_interaction）── */
  begin(){
    const L = VecSel.layer() || Doc.active();
    this.base = {L, shapes:JSON.parse(JSON.stringify(L.data.shapes)), vsel:VecSel.snapshot()};
    this.last = null;
  },
  resetToBase(){
    const b = this.base; if (!b) return;
    b.L.data.shapes = JSON.parse(JSON.stringify(b.shapes)); VecSel.restore(b.vsel); Layer.invalidate(b.L);
  },
  /* Preview：回底稿、再套一次命令（只在画面上，不进历史） */
  preview(id, params){
    if (!this.base) return;
    this.resetToBase();
    try { CMD.map[id].run(params); } catch (err){ console.error(err); }
    this.last = {id, params};
    UI.draw();
  },
  /* Commit：回底稿后正式 CMD.run 最后那次预览 ⇒ 一步历史，跟 agent 走命令完全同一条路 */
  commit(){
    const last = this.last;
    if (this.base) this.resetToBase();
    this.base = null; this.last = null;
    if (last) CMD.run(last.id, last.params);
  },
  cancel(){ if (this.base) this.resetToBase(); this.base = null; this.last = null; },

  /* ── 滑鼠（direct.rs:175-351）── */
  down(e, pt){
    VecSel.prune();
    this.st = null;
    const L = this.vecLayer();
    const tol = VecSel.tol(4);                                       // direct.rs:177 cx.tol(4.0)
    // direct.rs:217-220 把手 → Begin("Reshape")，拖时 Preview path.setHandle
    const h = this.hitHandle(pt, tol);
    if (h){
      this.st = {k:'handle', id:h.s.id, layerId:VecSel.layerId, ai:h.idx, out:h.out};
      this.begin(); return;
    }
    if (!L) return;
    // direct.rs:226-236 锚点：Shift ＝ select.anchors toggle；没选过 ＝ set；已是部分选中的那颗 ＝ 不动（好让拖曳移动整组已选锚点）
    const a = this.hitAnchor(L, pt, tol);
    if (a){
      const part = VecSel.layerId === L.id ? VecSel.anchors[a.s.id] : null;
      const already = !!(part && part.includes(a.idx));
      this.st = {k:'anchors', start:pt, began:false};
      if (e.shiftKey) CMD.run('direct.selectAnchors', {id:a.s.id, anchors:[[0, a.idx]], mode:'toggle', layerId:L.id});
      else if (!already) CMD.run('direct.selectAnchors', {id:a.s.id, anchors:[[0, a.idx]], mode:'set', layerId:L.id});
      return;
    }
    // direct.rs:237-247 点到线段／填色：选整条（Shift ＝ select.toggle；没选或只是部分选中 ＝ select.set）
    const s = this.hitTest(L, pt, VecSel.tol(3));
    // 照 PS 2020 补（PS 版面，工作路径与形状层都算）：点到线段＝选那段两端的锚点，拖直线段只移这两颗、拖曲线段调两支把手让曲线跟着滑鼠；Alt 拖＝照旧复制整条
    const sg = s && !e.altKey && dirPS() ? this.hitSegment(L, s, pt, VecSel.tol(3)) : null;
    if (sg){
      const part = VecSel.layerId === L.id ? VecSel.anchors[s.id] : null;
      const both = !!(part && part.includes(sg.i) && part.includes(sg.j));
      if (e.shiftKey) CMD.run('direct.selectAnchors', {id:s.id, anchors:[[0, sg.i], [0, sg.j]], mode:'add', layerId:L.id});
      else if (!both) CMD.run('direct.selectAnchors', {id:s.id, anchors:[[0, sg.i], [0, sg.j]], mode:'set', layerId:L.id});
      this.st = sg.curved ? {k:'segment', id:s.id, layerId:L.id, seg:sg.i, t:sg.t, start:pt, began:false} : {k:'anchors', start:pt, began:false};
      return;
    }
    if (s){
      this.st = {k:'object', start:pt, began:false};
      const inSel = VecSel.layerId === L.id && VecSel.isShapeSelected(s.id);
      if (e.shiftKey) CMD.run('direct.selectToggle', {id:s.id, layerId:L.id});
      else if (!inSel || (VecSel.layerId === L.id && VecSel.anchors[s.id])) CMD.run('direct.select', {ids:[s.id], layerId:L.id});
      return;
    }
    // direct.rs:248 空白 ⇒ 框选（Shift ＝ 加选）
    this.st = {k:'marquee', start:pt, cur:pt, add:e.shiftKey};
  },

  move(e, pt){
    const st = this.st; if (!st) return;
    if (st.k === 'segment'){
      if (!st.began){ if (this.dist(pt, st.start) < VecSel.tol(3)) return; st.began = true; this.begin(); }
      this.preview('direct.bendSegment', {id:st.id, layerId:st.layerId, segment:st.seg, t:st.t, dx:pt[0] - st.start[0], dy:pt[1] - st.start[1]});
    } else if (st.k === 'anchors' || st.k === 'object'){
      // direct.rs:251-279：拖过 cx.tol(3) 才算开始（Begin("Move")），之后每一下 Preview
      if (!st.began){
        if (this.dist(pt, st.start) < VecSel.tol(3)) return;
        st.began = true; this.begin();
      }
      const d = this.moveDelta(st.start, pt, e.shiftKey);
      if (st.k === 'anchors') this.preview('direct.moveAnchors', {dx:d[0], dy:d[1]});
      else this.preview('direct.moveObjects', {dx:d[0], dy:d[1], copy:!!e.altKey});   // object.transform 平移，Alt ＝ 复制一份再移
    } else if (st.k === 'handle'){
      // direct.rs:280-285：把手跟着滑鼠，Alt ＝ independent（先变直角点、另一支不跟）
      // 我们多加的（Illustrator 同）：把手拖回锚点 4 屏幕像素内 ⇒ 放到锚点上＝这一支收掉（setHandle 里「等于锚点＝null」）
      let x = pt[0], y = pt[1];
      const f = dirFind(st.id, st.layerId), a = f && VecSel.asBezier(f.s) && VecSel.asBezier(f.s).anchors[st.ai];
      if (a){ const ad = VecSel.toDoc(f.L, [a.x, a.y]); if (this.dist(pt, ad) <= VecSel.tol(4)){ x = ad[0]; y = ad[1]; } }
      this.preview('direct.setHandle', {id:st.id, layerId:st.layerId, subpath:0, anchor:st.ai, which:st.out ? 'out' : 'in', x, y, independent:!!e.altKey});
    } else if (st.k === 'marquee'){
      st.cur = pt; UI.draw();                                         // direct.rs:308-311
    }
  },

  up(e, pt){
    const st = this.st; this.st = null; if (!st) return;
    if (st.k === 'anchors' || st.k === 'object' || st.k === 'segment'){ if (st.began) this.commit(); return; }   // direct.rs:321-324
    if (st.k === 'handle'){ this.commit(); return; }                                      // direct.rs:325-328
    if (st.k === 'marquee'){                                                              // direct.rs:329-348
      const x0 = Math.min(st.start[0], pt[0]), x1 = Math.max(st.start[0], pt[0]);
      const y0 = Math.min(st.start[1], pt[1]), y1 = Math.max(st.start[1], pt[1]);
      const t3 = VecSel.tol(3);
      if (x1 - x0 < t3 && y1 - y0 < t3){ if (!st.add) CMD.run('direct.selectNone', {}); return; }
      const L = this.vecLayer(); const items = [];
      if (L) for (const s of L.data.shapes){
        const g = VecSel.asBezier(s); if (!g || !g.anchors) continue;                    // 活形状用视图
        // kurbo Rect::contains：x0 ≤ x < x1、y0 ≤ y < y1（锚点换成文件坐标再比）
        const v = []; g.anchors.forEach((a, i) => { const q = VecSel.toDoc(L, [a.x, a.y]); if (q[0] >= x0 && q[0] < x1 && q[1] >= y0 && q[1] < y1) v.push([0, i]); });
        if (v.length) items.push({id:s.id, anchors:v});
      }
      CMD.run('direct.selectAnchorsMany', {items, add:st.add, layerId:L ? L.id : undefined});
    }
  }
};
window.Direct = Direct;

/* ───────── 命令（agent 走这几条做得到跟滑鼠一样的事）───────── */

/* 由 id 找形状：给了 layerId 就只在那层找；没给就先找 VecSel 那层、再找当前层、再找全部矢量层 */
function dirFind(id, layerId){
  const tryL = L => (L && L.kind === 'vector') ? L.data.shapes.find(x => x.id === id) : null;
  if (layerId){ const L = Doc.byId(layerId), s = tryL(L); return s ? {L, s} : null; }
  for (const L of [VecSel.layer(), Doc.active()].concat(Doc.layers)){ const s = tryL(L); if (s) return {L, s}; }
  return null;
}
function dirLayer(p){
  const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  return (L && L.kind === 'vector') ? L : null;
}
/* [[subpath, anchor]…] 或 [anchor…] → 锚点索引（我们一条形状只有一个 subpath） */
function dirRefs(v){ return (v || []).map(r => Array.isArray(r) ? +r[1] : +r).filter(i => Number.isInteger(i) && i >= 0); }
const dirMv = (h, dx, dy) => h ? [h[0]+dx, h[1]+dy] : null;
/* PS 版面（工作路径／形状层）：拖线段照 PS 只动那一段 */
const dirPS = () => !(window.Toolbar && Toolbar.state && Toolbar.state().layout === 'ai');
const dirSegCtl = (a, b) => [[a.x, a.y], a.out || [a.x, a.y], b.in || [b.x, b.y], [b.x, b.y]];
const dirCurved = (a, b) => !!((a.out && Math.hypot(a.out[0]-a.x, a.out[1]-a.y) > 1e-9) || (b.in && Math.hypot(b.in[0]-b.x, b.in[1]-b.y) > 1e-9));
function dirBez(c, t){ const u = 1 - t, k0 = u*u*u, k1 = 3*u*u*t, k2 = 3*u*t*t, k3 = t*t*t; return [k0*c[0][0]+k1*c[1][0]+k2*c[2][0]+k3*c[3][0], k0*c[0][1]+k1*c[1][1]+k2*c[2][1]+k3*c[3][1]]; }
/* 平滑点：另一支把手跟着转、保持共线反向、长度不变 */
function dirKeepSmooth(a, moved, smooth){
  if (!smooth) return;
  const other = moved === 'out' ? 'in' : 'out', o = a[other], h = a[moved]; if (!o || !h) return;
  const len = Math.hypot(o[0]-a.x, o[1]-a.y), dx = a.x - h[0], dy = a.y - h[1], l = Math.hypot(dx, dy);
  if (l > 1e-9) a[other] = [a.x + dx*len/l, a.y + dy*len/l];
}
/* Anchor::translate（geom path.rs:138）：点与两支把手一起平移，kind 留着 */
function dirTranslateAnchor(a, dx, dy){ a.x += dx; a.y += dy; a.in = dirMv(a.in, dx, dy); a.out = dirMv(a.out, dx, dy); }
/* Node::transform(translate)：整个形状平移（bezier 自己逐点移以保住 kind；其余种类交给 engine 的 shiftShape） */
function dirTranslateShape(s, dx, dy){
  if (s.type === 'bezier') (s.anchors || []).forEach(a => dirTranslateAnchor(a, dx, dy));
  else shiftShape(s, dx, dy);
}

/* path.rs:161-188 move_anchors：部分选中的路径只移那几颗锚点；整条选中的形状整个平移 */
function dirMoveAnchors(dx, dy){
  const L = VecSel.layer(); if (!L || VecSel.isEmpty()) return {ok:false, error:'nothing selected'};
  for (const id of VecSel.shapes){
    const s = L.data.shapes.find(x => x.id === id); if (!s) continue;
    const set = VecSel.anchors[id];
    if (set){ VecSel.ensureBezier(L, s); if (s.type === 'bezier') set.forEach(i => { if (s.anchors[i]) dirTranslateAnchor(s.anchors[i], dx, dy); }); }
    else dirTranslateShape(s, dx, dy);
  }
  Layer.invalidate(L); return {ok:true};
}
/* object.rs:207-225 apply_transform（平移）＋ edit.rs:338 duplicate_in：copy ＝ 先在原形状正上方复制一份、选取换成复制品，再移复制品 */
function dirMoveObjects(ids, dx, dy, copy){
  const L = VecSel.layer() || Doc.active(); if (!L || L.kind !== 'vector') return {ok:false, error:'not a vector layer'};
  ids = (ids || VecSel.shapes).filter(id => L.data.shapes.some(x => x.id === id));
  if (!ids.length) return {ok:false, error:'nothing selected'};
  let targets = ids;
  if (copy){
    targets = [];
    for (const id of ids){
      const i = L.data.shapes.findIndex(x => x.id === id); if (i < 0) continue;
      const c = JSON.parse(JSON.stringify(L.data.shapes[i])); c.id = uid('S');
      L.data.shapes.splice(i + 1, 0, c); targets.push(c.id);
    }
    VecSel.setShapes(L.id, targets);
  }
  for (const id of targets){ const s = L.data.shapes.find(x => x.id === id); if (s) dirTranslateShape(s, dx, dy); }
  Layer.invalidate(L); return {ok:true, ids:targets};
}
/* path.rs:433-465 delete_anchors：删掉部分选中的锚点；闭合路径删点＝从那里断开变开放；剩不到 2 点的形状整个删掉；选取清空 */
function dirDeleteAnchors(){
  const L = VecSel.layer(); if (!L || VecSel.isEmpty()) return {ok:false, error:'nothing selected'};
  for (const id of Object.keys(VecSel.anchors)){
    const s = L.data.shapes.find(x => x.id === id); VecSel.ensureBezier(L, s); if (!s || s.type !== 'bezier') continue;
    let A = s.anchors.slice(), closed = !!s.closed, off = null;
    const idxs = Array.from(new Set(VecSel.anchors[id])).sort((a, b) => b - a);    // set.iter().rev()：由大到小
    for (const ai0 of idxs){
      if (closed){
        // sp.anchors.rotate_left(ai+1); pop; closed=false
        const n = A.length; A = A.slice(ai0 + 1).concat(A.slice(0, ai0 + 1)); A.pop(); closed = false;
        off = n - ai0 - 1;          // 之后更小的原索引 i 落在 i + off（原码这里没换算、会删错点；我们换算了）
      } else {
        const ai = off === null ? ai0 : ai0 + off;
        if (ai < A.length) A.splice(ai, 1);
      }
    }
    if (A.length >= 2){ s.anchors = A; s.closed = closed; }
    else L.data.shapes = L.data.shapes.filter(x => x.id !== id);              // subpaths 都没了 ⇒ d.remove(id)
  }
  VecSel.clear(); Layer.invalidate(L); return {ok:true};
}

/* —— select.*（select.rs）：选取不进历史（Session::select 不推 undo；undo 时选取跟着那一步的快照回去）—— */
CMD.reg('direct.select', {i18n:'', params:'{ids:[shapeId…], layerId?} 整条选这些形状，其余清掉（照 select.set）'}, p => {
  const L = dirLayer(p); if (!L) return {ok:false, error:'not a vector layer'};
  VecSel.setShapes(L.id, (p.ids || []).filter(id => L.data.shapes.some(x => x.id === id)));
  return {ok:true};
});
CMD.reg('direct.selectAdd', {i18n:'', params:'{ids:[shapeId…], layerId?} 加选这些形状（照 select.add：已在选取里的不动，部分选中的仍是部分选中）'}, p => {
  const L = dirLayer(p); if (!L) return {ok:false, error:'not a vector layer'};
  for (const id of (p.ids || [])){
    if (!L.data.shapes.some(x => x.id === id)) continue;
    if (!(VecSel.layerId === L.id && VecSel.isShapeSelected(id))) VecSel.addShape(L.id, id);
  }
  return {ok:true};
});
CMD.reg('direct.selectToggle', {i18n:'', params:'{id, layerId?} 选了就去掉、没选就整条加进来（照 select.toggle）'}, p => {
  const L = dirLayer(p); if (!L || !L.data.shapes.some(x => x.id === p.id)) return {ok:false, error:'no such shape'};
  if (VecSel.layerId === L.id && VecSel.isShapeSelected(p.id)) VecSel.removeShape(p.id); else VecSel.addShape(L.id, p.id);
  return {ok:true};
});
CMD.reg('direct.selectNone', {i18n:'', params:'{} 清掉矢量节点选取（照 select.none）'}, () => { VecSel.clear(); return {ok:true}; });
CMD.reg('direct.selectAnchors', {i18n:'',
  params:'{id, anchors:[[0,锚点索引]…]（或 [索引…]）, mode:"set"|"add"|"toggle"="set", layerId?} 选锚点（照 select.anchors）：set＝先清空全部再选这些；add＝并进这条路径已部分选中的锚点；toggle＝逐颗切换。整条选中的路径做 add／toggle 会变成「只选这几颗」（原码同）'}, p => {
  const L = dirLayer(p); const s = L && L.data.shapes.find(x => x.id === p.id), g = VecSel.asBezier(s);   // 选锚点不改文件：活形状用视图
  if (!g || !g.anchors) return {ok:false, error:'no such path'};
  const mode = p.mode || 'set';
  if (mode === 'set') VecSel.clear();
  const cur = (VecSel.layerId === L.id && VecSel.anchors[s.id]) ? VecSel.anchors[s.id].slice() : [];
  for (const r of dirRefs(p.anchors)){
    if (r >= g.anchors.length) continue;
    const k = cur.indexOf(r);
    if (mode === 'toggle' && k >= 0) cur.splice(k, 1); else if (k < 0) cur.push(r);
  }
  VecSel.setAnchors(L.id, s.id, cur);       // 切到一颗不剩 ⇒ 这条路径退出选取（原码留一个空集合，效果相同：什么也拖不动）
  return {ok:true};
});
CMD.reg('direct.selectAnchorsMany', {i18n:'',
  params:'{items:[{id, anchors:[[0,索引]…]}], add?:bool, layerId?} 框选的结果（照 select.anchorsMany）：add=false 先清空；某条路径的锚点全被框到＝整条选中，否则并进它的部分选取'}, p => {
  const L = dirLayer(p); if (!L) return {ok:false, error:'not a vector layer'};
  if (!p.add) VecSel.clear();
  for (const it of (p.items || [])){
    const s = L.data.shapes.find(x => x.id === it.id), g = VecSel.asBezier(s); if (!g || !g.anchors) continue;   // 活形状用视图
    const refs = Array.from(new Set(dirRefs(it.anchors))).filter(i => i < g.anchors.length);
    if (refs.length < g.anchors.length){
      const cur = (VecSel.layerId === L.id && VecSel.anchors[s.id]) ? VecSel.anchors[s.id] : [];
      VecSel.setAnchors(L.id, s.id, cur.concat(refs));
    } else VecSel.addShape(L.id, s.id);
  }
  return {ok:true};
});

/* —— 改文件的（进历史）—— */
CMD.reg('direct.moveAnchors', {i18n:'', undoable:true,
  params:'{dx, dy} 移动选中的锚点（照 path.moveAnchors）：部分选中的路径只移选中那几颗（连同把手），整条选中的形状整个平移'}, p => {
  return dirMoveAnchors(+p.dx || 0, +p.dy || 0);
});
CMD.reg('direct.setHandle', {i18n:'', undoable:true,
  params:'{id, subpath=0, anchor, which:"in"|"out", x, y 文件坐标, independent?:bool, layerId?} 把一支方向把手的端点放到 (x,y)（照 path.setHandle／Anchor::set_handle）：independent＝先把锚点变直角点、另一支不跟；平滑点（两支共线反向）另一支保持共线、长度不变'}, p => {
  const f = dirFind(p.id, p.layerId); if (f) VecSel.ensureBezier(f.L, f.s);   // path_mut：活形状转成路径
  if (!f || f.s.type !== 'bezier') return {ok:false, error:'no such path'};
  const {L, s} = f, a = s.anchors[+p.anchor];
  if (!a) return {ok:false, error:'no such anchor'};
  if (p.x === undefined || p.y === undefined) return {ok:false, error:'missing x/y'};
  const out = p.which !== 'in';
  const pos = VecSel.toLayer(L, [+p.x, +p.y]);
  if (p.independent) a.kind = 'corner';
  const smooth = VecSel.anchorKind(a) === 'smooth';
  const P = [a.x, a.y], none = q => Math.hypot(q[0]-P[0], q[1]-P[1]) <= 1e-9;   // 把手等于锚点 ＝ 没有把手（null）
  const other = out ? a.in : a.out;
  a[out ? 'out' : 'in'] = none(pos) ? null : pos;
  if (smooth){
    const len = other ? Math.hypot(other[0]-P[0], other[1]-P[1]) : 0;
    const dir = [P[0]-pos[0], P[1]-pos[1]], l = Math.hypot(dir[0], dir[1]);
    if (l > 1e-9){ const q = [P[0] + dir[0]*len/l, P[1] + dir[1]*len/l]; a[out ? 'in' : 'out'] = none(q) ? null : q; }
  }
  if (!a.in || !a.out) a.kind = 'corner';                     // 我们多加的：只剩一支（或没有）把手的锚点只能是直角点（Illustrator 同）
  Layer.invalidate(L); return {ok:true};
});
CMD.reg('direct.bendSegment', {i18n:'', undoable:true,
  params:'{id, segment:锚点索引 i（i→i+1 那段）, t:0..1 拖的那一点, dx, dy, layerId?} 照 PS 拖曲线段：锚点不动，调这段两支把手让 t 那一点跟着移 (dx,dy)；平滑点另一支跟着转'}, p => {
  const f = dirFind(p.id, p.layerId); if (f) VecSel.ensureBezier(f.L, f.s);
  if (!f || f.s.type !== 'bezier') return {ok:false, error:'no such path'};
  const A = f.s.anchors, n = A.length, i = +p.segment, j = (i + 1) % n;
  if (!(i >= 0 && i < n) || (j === 0 && !f.s.closed)) return {ok:false, error:'no such segment'};
  const a = A[i], b = A[j], dx = +p.dx || 0, dy = +p.dy || 0;
  const t = Math.max(0.02, Math.min(0.98, +p.t || 0.5));
  // Inkscape 拖曲线段的权重（两支把手分摊位移，t 那一点正好移 (dx,dy)）
  const w = t <= 1/6 ? 0 : t <= 0.5 ? Math.pow((6*t - 1) / 2, 3) / 2 : t <= 5/6 ? (1 - Math.pow((6*(1-t) - 1) / 2, 3)) / 2 + 0.5 : 1;
  const k0 = (1 - w) / (3*t*(1-t)*(1-t)), k1 = w / (3*t*t*(1-t));
  const sa = VecSel.anchorKind(a) === 'smooth', sb = VecSel.anchorKind(b) === 'smooth';
  const c = dirSegCtl(a, b);
  a.out = [c[1][0] + k0*dx, c[1][1] + k0*dy]; b.in = [c[2][0] + k1*dx, c[2][1] + k1*dy];
  dirKeepSmooth(a, 'out', sa); dirKeepSmooth(b, 'in', sb);
  Layer.invalidate(f.L); return {ok:true};
});
CMD.reg('direct.moveObjects', {i18n:'', undoable:true,
  params:'{dx, dy, copy?:bool, ids?:[shapeId…]} 整个形状平移（照 object.transform 的平移；直接选择拖线段／填色时用）：ids 缺省＝选中的形状；copy＝先在原形状上方复制、选取换成复制品再移（拖时按 Alt）'}, p => {
  return dirMoveObjects(p.ids, +p.dx || 0, +p.dy || 0, !!p.copy);
});
CMD.reg('direct.nudge', {i18n:'', undoable:true,
  params:'{dx:-1|0|1, dy:-1|0|1, big?:bool(×10), copy?:bool} 方向键微移（照 object.nudge，键盘增量 1）：有部分选中的锚点就移锚点（不复制），否则整个形状平移（copy＝复制再移）'}, p => {
  const k = p.big ? 10 : 1, dx = (+p.dx || 0) * k, dy = (+p.dy || 0) * k;
  if (VecSel.isEmpty()) return {ok:false, error:'nothing selected'};
  if (Object.keys(VecSel.anchors).length) return dirMoveAnchors(dx, dy);
  return dirMoveObjects(null, dx, dy, !!p.copy);
});
CMD.reg('direct.deleteAnchors', {i18n:'', undoable:true,
  params:'{} 删掉部分选中的锚点（照 path.deleteAnchors）：闭合路径删点会从那里断开成开放路径；剩不到 2 点的路径整条删掉；选取清空'}, () => dirDeleteAnchors());
CMD.reg('direct.clear', {i18n:'', undoable:true,
  params:'{ids?} Delete／Backspace（照 edit.clear）：没给 ids 又有部分选中的锚点 ⇒ 删锚点（direct.deleteAnchors）；否则删掉 ids（缺省＝选中的形状）整个形状；选取清空'}, p => {
  if (!p.ids && Object.keys(VecSel.anchors).length) return dirDeleteAnchors();
  const L = VecSel.layer() || Doc.active(); if (!L || L.kind !== 'vector') return {ok:false, error:'not a vector layer'};
  const ids = p.ids || VecSel.shapes.slice(); if (!ids.length) return {ok:false, error:'nothing selected'};
  L.data.shapes = L.data.shapes.filter(x => !ids.includes(x.id));
  VecSel.clear(); Layer.invalidate(L); return {ok:true};
});

/* 原码 Cursor::ArrowHollow（direct.rs:363-368；corner widget 那支我们没有）：空心箭头 */
const DIRECT_CURSOR = 'url("data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='20' height='22'><path d='M2.5 1.5 L2.5 17 L6.5 13.2 L9.4 19.6 L12 18.4 L9.2 12.2 L14.6 12.2 Z' fill='white' stroke='black' stroke-width='1.2' stroke-linejoin='round'/></svg>"
) + '") 2 1, default';

Tools.reg({
  id:'direct', icon:'↖', key:'A', group:'select', order:15, for:'vector', opts:[],
  cursor: DIRECT_CURSOR,
  hint:'ui.directHint',
  strings:{
    'zh-Hant':{'tool.direct':'直接選擇', 'ui.directHint':'點錨點＝選它（Shift 加減選）；點線段／填色＝選整條；拖空白＝框選錨點（Shift 加選）；拖已選錨點＝移動（Shift 鎖 45°）；拖整條＝移動（Alt 複製）；拖把手＝改曲線（Alt 只動這一支；拖回錨點上＝刪這一支）；方向鍵微移（Shift ×10）；Delete 刪錨點'},
    'zh-Hans':{'tool.direct':'直接选择', 'ui.directHint':'点锚点＝选它（Shift 加减选）；点线段／填色＝选整条；拖空白＝框选锚点（Shift 加选）；拖已选锚点＝移动（Shift 锁 45°）；拖整条＝移动（Alt 复制）；拖把手＝改曲线（Alt 只动这一支；拖回锚点上＝删这一支）；方向键微移（Shift ×10）；Delete 删锚点'},
    'en':{'tool.direct':'Direct Selection', 'ui.directHint':'Click an anchor to select it (Shift toggles); click a segment / fill to select the path; drag empty space to marquee anchors (Shift adds); drag selected anchors to move (Shift: 45°); drag a path to move it (Alt copies); drag a handle to reshape (Alt: this handle only; drop it on the anchor to remove it); arrows nudge (Shift ×10); Delete removes anchors'}
  },
  onDown(e, pt){ Direct.down(e, pt); UI.draw(); },
  onMove(e, pt, P){ if (P.down) Direct.move(e, pt); },
  onUp(e, pt){ Direct.up(e, pt); UI.draw(); },
  /* 键盘：direct.rs 本身没有 key／claims_key；Illustrator 的方向键与 Delete 是全域快捷键（shortcuts.rs:296-307）。
     我们的全域 Delete 是「清空整层」（edit.delete），所以有节点选取时由这颗工具先接住，照原码改走 edit.clear／object.nudge 的语义。 */
  onKey(e){
    if (Direct.st) return false;
    if (VecSel.isEmpty() || !VecSel.layer()) return false;
    const k = e.key;
    const arrows = {ArrowLeft:[-1, 0], ArrowRight:[1, 0], ArrowUp:[0, -1], ArrowDown:[0, 1]};
    if (arrows[k] && !e.ctrlKey && !e.metaKey){
      e.preventDefault();
      CMD.run('direct.nudge', {dx:arrows[k][0], dy:arrows[k][1], big:e.shiftKey, copy:e.altKey});
      UI.draw(); return true;
    }
    if ((k === 'Delete' || k === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey){
      e.preventDefault(); CMD.run('direct.clear', {}); UI.draw(); return true;
    }
    return false;
  },
  onDeactivate(){ Direct.cancel(); Direct.st = null; },
  /* 叠画：选取（VecSel 共用：路径轮廓、锚点实心／空心、选中锚点的把手）＋ 整条选中的非贝兹形状的轮廓（canvas.rs:1059 node_outline）＋ 框选虚线（Overlay::Marquee） */
  drawOverlay(ctx, s){
    VecSel.drawOverlay(ctx, s);
    const L = (window.AiView && AiView.edgesHidden()) ? null : VecSel.layer();   // AI 视图 ▸ 隐藏边缘
    if (L && L.visible){
      ctx.save(); ctx.strokeStyle = '#2f7fd8'; ctx.lineWidth = 1; ctx.setLineDash([]);
      for (const id of VecSel.shapes){
        const sh = L.data.shapes.find(x => x.id === id); if (!sh || sh.type === 'bezier') continue;
        ctx.beginPath(); Direct.shapePath(ctx, sh, s, L.x, L.y); ctx.stroke();
      }
      ctx.restore();
    }
    const st = Direct.st;
    if (st && st.k === 'marquee'){
      const x = Math.min(st.start[0], st.cur[0]) * s, y = Math.min(st.start[1], st.cur[1]) * s;
      const w = Math.abs(st.cur[0] - st.start[0]) * s, h = Math.abs(st.cur[1] - st.start[1]) * s;
      ctx.save(); ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
      ctx.strokeStyle = '#fff'; ctx.strokeRect(x + .5, y + .5, w, h);
      ctx.strokeStyle = '#000'; ctx.setLineDash([0, 4, 5, 0]); ctx.strokeRect(x + .5, y + .5, w, h);
      ctx.restore();
    }
  }
});
