/* 路径选择工具（PS A：ps.path-select）——照 PhotoCraft 原码逐段翻：
   photocraft/crates/ui-egui/src/
   - vector_ui.rs:219-267  PathTarget／targeted_vector_mask／target_path／path_selection_finish：
       拖一下＝整条路径平移（dx、dy 四舍五入；|dx|+|dy| < 0.5 不算）；动哪条：被点选的矢量蒙版 ＞ 当前形状层的路径 ＞ 工作路径
       （形状层走 shape.edit {move}、矢量蒙版走 layer.vectorMask.edit、工作路径走 path.set，各一步历史）
   - vector_ui.rs:304-342  draw_overlay：路径工具下画工作路径、当前形状层路径、被点选的矢量蒙版——1px accent 线；
       Path Selection 时连锚点一起画（6×6 白方块、accent 框）
   - vector_ui.rs:386-389  options_bar：只有一行提示「拖曳＝移动当前形状的路径或工作路径」（点选矢量蒙版时换句）
   - vector_ui.rs:199-214 path_to_selection ＋ path_selection_tests.rs 全档（#306）：⌘↩／Ctrl+Enter＝把路径载入为选区
       （Paths 面板选中的那条 ＞ 工作路径 ＞ 当前层的形状路径／矢量蒙版；没有路径＝报「No path…」不做事）
   - canvas.rs:2158  finish_gesture：Tool::PathSelection 放开时叫 path_selection_finish(起点, 终点)
   我们这边的对应：形状层＝矢量层（一层里可有多个形状＝PS 一个形状层里的多个路径组件）；矢量蒙版＝L.vmask.shapes（ps-layer2.js，文件坐标、链接时随图层位移）；
   工作路径＝Doc.workPath.subpaths（ps-type.js，文件坐标）；路径面板选中的＝PsWindow.paths.sel（ps-window.js）。
   我们没有「点选矢量蒙版缩图」的状态 ⇒ 当前层不是矢量层但有矢量蒙版，就当它被点选（原码同一条 if 顺序）。
   ── 原码没有、照 PS 2020 加的──
   - 点到路径组件（线上或填色里）＝只选它；Shift＋点＝加选／减选；拖已选的组件＝只移它们（没点到东西才照原码整条移）；
     Alt＋拖＝复制再移；拖时 Shift＝锁 45°；点空白不拖＝取消组件选取；Esc 同。
   - Delete／Backspace＝删选中的组件；方向键＝微移 1px（Shift 10px），Alt＋方向键＝复制再移。
   - 选中的组件锚点画实心（PS：实心＝选中的路径）；拖曳中画移动后的轮廓预览。
   矢量层上选中的组件就是 VecSel 选中的整个形状（直接选择、钢笔的自动加删点接得上）；工作路径／矢量蒙版的组件选取存在 PathSel.wsel。 */

const PS_BLUE = '#2f7fd8';
const PathSel = {
  wsel: null,            // 工作路径／矢量蒙版的组件选取：{kind:'work'|'vmask', layerId, idx:[…]}
  drag: null,            // {start, last, mode:'comp'|'whole', target, copy, shift}

  tol(px){ return (px === undefined ? 4 : px) / Math.max(UI.zoom, 1e-9); },

  /* ── 目标（vector_ui.rs:227-248）── */
  vmaskOff(L){ const v = L.vmask; return v && v.linked !== false ? [L.x - (v.ax || 0), L.y - (v.ay || 0)] : [0, 0]; },
  /* 一个形状的几何视图（文件坐标，可能多条：复合路径／编组展开）*/
  shapeViews(s, ox, oy){
    const out = [];
    const go = n => {
      if (!n || n.visible === false) return;
      if ((n.type === 'group' || n.type === 'compound') && Array.isArray(n.children)){ n.children.forEach(go); return; }
      const v = n.type === 'bezier' ? n : (window.VecSel ? VecSel.asBezier(n) : null);
      if (!v || !v.anchors || !v.anchors.length) return;
      const m = q => q ? [q[0] + ox, q[1] + oy] : null;
      out.push({closed:!!v.closed, anchors:v.anchors.map(a => ({x:a.x + ox, y:a.y + oy, in:m(a.in), out:m(a.out)}))});
    };
    go(s); return out;
  },
  /* 一个目标的组件清单：[{key（形状 id 或索引）, views:[{closed, anchors}]}]，由下到上 */
  comps(t){
    if (!t) return [];
    if (t.kind === 'shape') return t.L.data.shapes.filter(s => !s.locked && s.visible !== false).map(s => ({key:s.id, views:this.shapeViews(s, t.L.x, t.L.y)})).filter(c => c.views.length);
    if (t.kind === 'vmask'){ const o = this.vmaskOff(t.L); return (t.L.vmask.shapes || []).map((s, i) => ({key:i, views:this.shapeViews(s, o[0], o[1])})).filter(c => c.views.length); }
    if (t.kind === 'work') return ((Doc.workPath && Doc.workPath.subpaths) || []).map((sp, i) => ({key:i, views:(sp && sp.anchors && sp.anchors.length) ? [{closed:!!sp.closed, anchors:sp.anchors}] : []})).filter(c => c.views.length);
    return [];
  },
  /* 画面上看得到的全部目标（叠画、命中都用；顺序＝原码 target_path 的优先序） */
  targets(){
    const out = [], L = Doc.active();
    if (L && L.kind !== 'vector' && L.vmask && (L.vmask.shapes || []).length) out.push({kind:'vmask', L});   // targeted_vector_mask（!Shape）
    if (L && L.kind === 'vector' && L.visible !== false) out.push({kind:'shape', L});
    if (Doc.workPath && Array.isArray(Doc.workPath.subpaths) && Doc.workPath.subpaths.length) out.push({kind:'work'});
    return out;
  },
  /* 原码 target_path：拖空白处整条移的那一条 */
  mainTarget(){ return this.targets().find(t => this.comps(t).length) || null; },
  /* agent 用：照参数找目标 */
  targetFrom(p){
    const k = p.target;
    if (!k) return this.mainTarget();
    if (k === 'work') return (Doc.workPath && Doc.workPath.subpaths && Doc.workPath.subpaths.length) ? {kind:'work'} : null;
    const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
    if (!L) return null;
    if (k === 'shape') return L.kind === 'vector' ? {kind:'shape', L} : null;
    if (k === 'vmask') return (L.vmask && (L.vmask.shapes || []).length) ? {kind:'vmask', L} : null;
    return null;
  },
  sameTarget(a, b){ return !!a && !!b && a.kind === b.kind && (a.kind === 'work' || a.L === b.L); },

  /* ── 组件选取 ── */
  selectedKeys(t){
    if (!t) return [];
    if (t.kind === 'shape') return (window.VecSel && VecSel.layerId === t.L.id) ? VecSel.shapes.filter(id => t.L.data.shapes.some(s => s.id === id)) : [];
    const w = this.wsel; if (!w || w.kind !== t.kind || (t.kind === 'vmask' && w.layerId !== t.L.id)) return [];
    const n = t.kind === 'work' ? ((Doc.workPath && Doc.workPath.subpaths) || []).length : (t.L.vmask.shapes || []).length;
    return w.idx.filter(i => i < n);
  },
  setSelected(t, keys){
    if (t.kind === 'shape'){ this.wsel = null; if (window.VecSel) VecSel.setShapes(t.L.id, keys); return; }
    if (window.VecSel) VecSel.clear();
    this.wsel = keys.length ? {kind:t.kind, layerId:t.kind === 'vmask' ? t.L.id : null, idx:keys.slice().sort((a, b) => a - b)} : null;
  },
  clearAll(){ this.wsel = null; if (window.VecSel) VecSel.clear(); },
  anySelected(){ return this.targets().some(t => this.selectedKeys(t).length); },

  /* ── 命中：线上（4 屏幕像素）或闭合路径的填色里（非零绕数）；最上面的先 ── */
  _hitCtx: null,
  hitComp(pt){
    const tol = this.tol(4);
    const ctx = this._hitCtx || (this._hitCtx = document.createElement('canvas').getContext('2d'));
    for (const t of this.targets()){
      const C = this.comps(t);
      for (let i = C.length - 1; i >= 0; i--){
        const c = C[i];
        for (const v of c.views){
          const n = VecSel.nearestOnShape({anchors:v.anchors, closed:v.closed}, pt);
          if ((n && n.d <= tol) || (v.anchors.length === 1 && Math.hypot(v.anchors[0].x - pt[0], v.anchors[0].y - pt[1]) <= tol)) return {target:t, key:c.key};
        }
        if (c.views.some(v => v.closed)){
          const P = new Path2D(); c.views.forEach(v => { const q = new Path2D(); bezierPathP(q, v); P.addPath(q); });
          if (ctx.isPointInPath(P, pt[0], pt[1], 'nonzero')) return {target:t, key:c.key};
        }
      }
    }
    return null;
  },

  /* ── 滑鼠 ── */
  down(e, pt){
    const hit = this.hitComp(pt);
    if (hit){
      const sel = this.selectedKeys(hit.target);
      let keys;
      if (e.shiftKey){
        keys = sel.includes(hit.key) ? sel.filter(k => k !== hit.key) : sel.concat([hit.key]);
        if (!this.sameTarget(hit.target, this.selTarget())) keys = [hit.key];
        CMD.run('pathselect.select', this.selParams(hit.target, keys, 'set'));
        if (!keys.includes(hit.key)){ this.drag = null; return; }      // 减选掉了：这一下不拖
      } else if (!sel.includes(hit.key)){
        CMD.run('pathselect.select', this.selParams(hit.target, [hit.key], 'set'));
      }
      this.drag = {start:[pt[0], pt[1]], last:[pt[0], pt[1]], mode:'comp', target:hit.target, copy:!!e.altKey, shift:false};
      return;
    }
    // 没点到路径：照原码，拖＝整条（目标路径）移
    this.drag = {start:[pt[0], pt[1]], last:[pt[0], pt[1]], mode:'whole', target:this.mainTarget(), copy:!!e.altKey, shift:false};
  },
  constrain(d, on){
    if (!on) return d;
    const len = Math.hypot(d[0], d[1]); if (len < 1e-9) return d;
    const a = Math.round(Math.atan2(d[1], d[0]) / (Math.PI / 4)) * (Math.PI / 4);
    return [len * Math.cos(a), len * Math.sin(a)];
  },
  move(e, pt){ const d = this.drag; if (!d) return; d.last = [pt[0], pt[1]]; d.shift = !!e.shiftKey; if (e.altKey) d.copy = true; },
  delta(d){ d = d || this.drag; return d ? this.constrain([d.last[0] - d.start[0], d.last[1] - d.start[1]], d.shift) : [0, 0]; },
  up(e, pt){
    const d = this.drag; this.drag = null; if (!d) return;
    d.last = [pt[0], pt[1]]; d.shift = !!e.shiftKey;
    const [dx, dy] = this.delta(d);
    if (Math.abs(dx) + Math.abs(dy) < 0.5){                           // vector_ui.rs:252 没拖
      if (d.mode === 'whole' && !e.shiftKey) CMD.run('pathselect.select', {mode:'clear'});   // PS：点空白＝取消选取
      return;
    }
    if (!d.target) return;
    const p = {dx, dy, copy:d.copy};
    Object.assign(p, this.selParams(d.target, d.mode === 'comp' ? this.selectedKeys(d.target) : [], 'set'));
    if (d.mode === 'whole') p.whole = true;
    delete p.mode;
    CMD.run('pathselect.move', p);
  },
  selTarget(){ return this.targets().find(t => this.selectedKeys(t).length) || null; },
  selParams(t, keys, mode){
    const p = {target:t.kind, mode};
    if (t.kind !== 'work') p.layerId = t.L.id;
    if (t.kind === 'shape') p.ids = keys; else p.indices = keys;
    return p;
  },
  /* 方向键／Delete 用：选中的组件 */
  selectionParams(){ const t = this.selTarget(); return t ? this.selParams(t, this.selectedKeys(t), 'set') : null; },

  /* ── 叠画（vector_ui.rs:304-342，加：选中组件的锚点实心、拖曳中的移动预览）── */
  overlay(ctx, s){
    if (window.AiView && AiView.edgesHidden && AiView.edgesHidden()) return;
    const d = this.drag, [ddx, ddy] = this.delta(), dpr = s / Math.max(UI.zoom, 1e-9);
    ctx.save(); ctx.setLineDash([]);
    for (const t of this.targets()){
      const sel = this.selectedKeys(t);
      for (const c of this.comps(t)){
        const on = sel.includes(c.key);
        for (const v of c.views){
          ctx.strokeStyle = PS_BLUE; ctx.lineWidth = dpr;
          ctx.beginPath(); bezierPath(ctx, v, s); ctx.stroke();
          v.anchors.forEach(a => {
            const x = a.x * s, y = a.y * s, r = 3 * dpr;
            ctx.fillStyle = on ? PS_BLUE : '#fff'; ctx.fillRect(x - r, y - r, 2*r, 2*r);
            ctx.strokeStyle = PS_BLUE; ctx.strokeRect(x - r, y - r, 2*r, 2*r);
          });
        }
        // 拖曳中：移动后的轮廓（虚线）
        const moving = d && (Math.abs(ddx) + Math.abs(ddy) >= 0.5) && this.sameTarget(d.target, t) && (d.mode === 'whole' || on);
        if (moving){
          ctx.save(); ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.strokeStyle = PS_BLUE; ctx.lineWidth = dpr;
          for (const v of c.views){
            const m = q => q ? [q[0] + ddx, q[1] + ddy] : null;
            ctx.beginPath(); bezierPath(ctx, {closed:v.closed, anchors:v.anchors.map(a => ({x:a.x + ddx, y:a.y + ddy, in:m(a.in), out:m(a.out)}))}, s); ctx.stroke();
          }
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }
};
window.PathSel = PathSel;

/* bezierPath 的 Path2D 版（命中测试用；文件坐标） */
function bezierPathP(P, v){
  const A = v.anchors; if (!A.length) return;
  P.moveTo(A[0].x, A[0].y);
  const seg = (p, q) => { if (!p.out && !q.in){ P.lineTo(q.x, q.y); return; } const c1 = p.out || [p.x, p.y], c2 = q.in || [q.x, q.y]; P.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], q.x, q.y); };
  for (let i = 1; i < A.length; i++) seg(A[i-1], A[i]);
  if (v.closed && A.length >= 2){ seg(A[A.length-1], A[0]); P.closePath(); }
}

/* ───────── 命令 ───────── */
const psFail = e => ({ok:false, error:e});
CMD.reg('pathselect.select', {i18n:'',
  params:'{mode:"set"|"add"|"toggle"|"clear"="set", target?:"shape"|"work"|"vmask"（缺省＝原码的目标：当前层矢量蒙版＞当前矢量层＞工作路径）, layerId?, ids?:[形状 id]（shape）, indices?:[组件索引]（work／vmask）} ' +
         '选路径组件（PS 路径选择点一下／Shift+点）；矢量层上＝VecSel 整个形状选中 → {ok, target, selected}'}, p => {
  if (p.mode === 'clear'){ PathSel.clearAll(); return {ok:true, selected:[]}; }
  const t = PathSel.targetFrom(p); if (!t) return psFail('pathselect.select: no path (draw one with the Pen tool or make a work path)');
  const all = PathSel.comps(t).map(c => c.key);
  const want = (t.kind === 'shape' ? (p.ids || []) : (p.indices || []).map(Number)).filter(k => all.includes(k));
  const cur = PathSel.selectedKeys(t);
  let keys = want;
  if (p.mode === 'add') keys = cur.concat(want.filter(k => !cur.includes(k)));
  else if (p.mode === 'toggle') keys = cur.filter(k => !want.includes(k)).concat(want.filter(k => !cur.includes(k)));
  PathSel.setSelected(t, keys);
  return {ok:true, target:t.kind, layerId:t.L ? t.L.id : null, selected:keys};
});

/* 一个形状／子路径平移（文件坐标的位移） */
const psShiftSub = (sp, dx, dy) => ({closed:sp.closed, anchors:sp.anchors.map(a => Object.assign({}, a, {x:a.x + dx, y:a.y + dy, in:a.in ? [a.in[0] + dx, a.in[1] + dy] : null, out:a.out ? [a.out[0] + dx, a.out[1] + dy] : null}))});
const psRekey = s => { const o = JSON.parse(JSON.stringify(s)); const go = n => { n.id = uid('S'); (n.children || []).forEach(go); }; go(o); return o; };

/* vector_ui.rs:250-267 path_selection_finish（＋ PS 的组件移动／Alt 复制） */
CMD.reg('pathselect.move', {i18n:'', undoable:true,
  params:'{dx, dy（文件坐标，四舍五入；|dx|+|dy|<0.5 不动）, target?:"shape"|"work"|"vmask", layerId?, whole?:bool（整条路径移＝原码拖曳；缺省＝有选中组件就只移它们，没有就整条）, ' +
         'ids?:[形状 id]／indices?:[组件索引]（缺省＝目前选中的）, copy?:bool（先复制再移，PS Alt+拖）} ＝ 路径选择工具拖一下 → {ok, target, moved}'}, p => {
  const C = 'pathselect.move';
  const dx = Math.round(+p.dx || 0), dy = Math.round(+p.dy || 0);
  if (Math.abs(+p.dx || 0) + Math.abs(+p.dy || 0) < 0.5) return psFail(C + ': nothing to move');
  const t = PathSel.targetFrom(p); if (!t) return psFail(C + ': no path to move');
  if (t.L && window.Locks){ const k = Locks.blocks(t.L, t.kind === 'shape' ? ['pixels', 'position'] : 'all'); if (k) return Locks.fail(t.L, k, C); }
  const all = PathSel.comps(t).map(c => c.key);
  let keys;
  if (p.whole) keys = all;
  else {
    const given = t.kind === 'shape' ? p.ids : (p.indices ? p.indices.map(Number) : undefined);
    keys = (given || PathSel.selectedKeys(t)).filter(k => all.includes(k));
    if (!keys.length && !given) keys = all;                          // 没选组件：照原码整条
  }
  if (!keys.length) return psFail(C + ': nothing selected');
  let moved = keys;
  if (t.kind === 'shape'){
    const S = t.L.data.shapes;
    if (p.copy){
      const copies = [];
      for (const k of keys){ const i = S.findIndex(s => s.id === k); const c = psRekey(S[i]); copies.push(c); }
      copies.forEach(c => S.push(c)); moved = copies.map(c => c.id);
    }
    moved.forEach(id => shiftShape(S.find(s => s.id === id), dx, dy));
    Layer.invalidate(t.L);
    if (!p.whole || p.copy) PathSel.setSelected(t, moved);
  } else if (t.kind === 'vmask'){
    const S = t.L.vmask.shapes;
    if (p.copy){ const n0 = S.length; keys.forEach(i => S.push(psRekey(S[i]))); moved = keys.map((_, j) => n0 + j); }
    moved.forEach(i => { S[i] = shiftShape(S[i], dx, dy); });
    Layer.invalidate(t.L);
    if (!p.whole || p.copy) PathSel.setSelected(t, moved);
  } else {
    const W = Doc.workPath;
    W.subpaths = W.subpaths.slice();
    if (p.copy){ const n0 = W.subpaths.length; keys.forEach(i => W.subpaths.push(JSON.parse(JSON.stringify(W.subpaths[i])))); moved = keys.map((_, j) => n0 + j); }
    moved.forEach(i => { W.subpaths[i] = psShiftSub(W.subpaths[i], dx, dy); });
    if (!p.whole || p.copy) PathSel.setSelected(t, moved);
  }
  return {ok:true, target:t.kind, layerId:t.L ? t.L.id : null, moved, dx, dy};
});

/* PS：Delete＝删选中的路径组件 */
CMD.reg('pathselect.delete', {i18n:'', undoable:true,
  params:'{target?, layerId?, ids?／indices?（缺省＝选中的组件）} 删掉路径组件（PS 路径选择选中后按 Delete）→ {ok, deleted}'}, p => {
  const C = 'pathselect.delete';
  const t = p.target ? PathSel.targetFrom(p) : (PathSel.selTarget() || PathSel.targetFrom(p)); if (!t) return psFail(C + ': no path');
  if (t.L && window.Locks){ const k = Locks.blocks(t.L, t.kind === 'shape' ? 'pixels' : 'all'); if (k) return Locks.fail(t.L, k, C); }
  const given = t.kind === 'shape' ? p.ids : (p.indices ? p.indices.map(Number) : undefined);
  const keys = given || PathSel.selectedKeys(t);
  if (!keys.length) return psFail(C + ': nothing selected');
  if (t.kind === 'shape'){ t.L.data.shapes = t.L.data.shapes.filter(s => !keys.includes(s.id)); Layer.invalidate(t.L); }
  else if (t.kind === 'vmask'){ t.L.vmask.shapes = t.L.vmask.shapes.filter((_, i) => !keys.includes(i)); Layer.invalidate(t.L); }
  else { Doc.workPath.subpaths = Doc.workPath.subpaths.filter((_, i) => !keys.includes(i)); if (!Doc.workPath.subpaths.length) Doc.workPath = undefined; }
  PathSel.setSelected(t, []);
  return {ok:true, target:t.kind, deleted:keys.length};
});

/* vector_ui.rs:187-214 active_path_name ＋ path_to_selection（⌘↩ / Ctrl+Enter） */
CMD.reg('pathselect.toSelection', {i18n:'', undoable:true,
  params:'{operation?:"new|add|subtract|intersect"="new", feather?:px, antiAlias?:bool=true} ＝ Ctrl+Enter（⌘↩）：把路径载入为选区——路径面板选中的那条＞工作路径＞当前矢量层／矢量蒙版；没有路径就回错误说明 → {ok, path}'}, p => {
  const C = 'pathselect.toSelection';
  const L = Doc.active(), panelSel = window.PsWindow && PsWindow.paths ? PsWindow.paths.sel : null;
  const has = k => k === 'work' ? !!(Doc.workPath && Doc.workPath.subpaths && Doc.workPath.subpaths.length) : !!(Doc.byId(k) && Doc.byId(k).kind === 'vector');
  let key = (panelSel && has(panelSel)) ? panelSel : has('work') ? 'work' : (L && L.kind === 'vector') ? L.id : null;
  const q = {}; ['operation', 'feather', 'antiAlias'].forEach(k => { if (p[k] !== undefined) q[k] = p[k]; });
  if (key && CMD.map['ps.path.toSelection']){ const r = CMD.map['ps.path.toSelection'].run(Object.assign({path:key}, q)); return Object.assign({path:key}, r); }
  // 矢量蒙版（路径面板没列）：自己算涵盖度
  if (L && L.vmask && (L.vmask.shapes || []).length && window.SelMask){
    const t = {kind:'vmask', L}, c = document.createElement('canvas'); c.width = Doc.width; c.height = Doc.height;
    const x = c.getContext('2d'); if (+q.feather > 0) x.filter = `blur(${q.feather / 2}px)`;
    x.beginPath(); PathSel.comps(t).forEach(cp => cp.views.forEach(v => bezierPath(x, v, 1))); x.fillStyle = '#fff'; x.fill('nonzero');
    const d = x.getImageData(0, 0, c.width, c.height).data, n = c.width * c.height, out = new Uint8Array(n);
    const old = Doc.sel && SelMask.bytes ? SelMask.bytes(Doc.sel) : null, op = q.operation || 'new'; let any = 0;
    for (let i = 0; i < n; i++){ let a = d[i * 4 + 3]; if (q.antiAlias === false) a = a >= 128 ? 255 : 0; const o = old ? old[i] : 0;
      out[i] = op === 'add' ? Math.max(a, o) : op === 'subtract' ? Math.max(o - a, 0) : op === 'intersect' ? Math.min(a, o) : a; any |= out[i]; }
    Doc.sel = any ? SelMask.fromBytes(out) : null;
    return {ok:true, path:'vmask', selected:!!any};
  }
  return psFail('No path to make a selection from: draw one with the Pen tool or select one in the Paths panel.');
});

CMD.reg('pathselect.state', {i18n:'', params:'{} → {targets:[{kind, layerId, components, selected}], main}  看路径选择工具现在看得到哪些路径、选了哪些组件'}, () => {
  const T = PathSel.targets(), m = PathSel.mainTarget();
  return {ok:true, main:m ? m.kind : null, targets:T.map(t => ({kind:t.kind, layerId:t.L ? t.L.id : null, components:PathSel.comps(t).map(c => c.key), selected:PathSel.selectedKeys(t)}))};
});

Tools.reg({
  id:'pathselect', icon:'➤', group:'vector', order:5, for:'common', opts:[], cursor:'default',
  hint:'ui.pathselHint',
  strings:{
    'zh-Hant':{'tool.pathselect':'路徑選取工具', 'ui.pathselHint':'拖曳＝移動目前形狀的路徑或工作路徑｜點路徑＝選取組件、Shift＋點＝加減選、Alt＋拖＝複製｜Delete 刪除、方向鍵微移｜Ctrl+Enter＝載入為選取範圍',
               'ui.pathselNoPath':'沒有可做成選取範圍的路徑：先用鋼筆工具畫一條，或在路徑面板選一條。'},
    'zh-Hans':{'tool.pathselect':'路径选择工具', 'ui.pathselHint':'拖曳＝移动当前形状的路径或工作路径｜点路径＝选组件、Shift＋点＝加减选、Alt＋拖＝复制｜Delete 删除、方向键微移｜Ctrl+Enter＝载入为选区',
               'ui.pathselNoPath':'没有可做成选区的路径：先用钢笔工具画一条，或在路径面板选一条。'},
    'en':{'tool.pathselect':'Path Selection Tool', 'ui.pathselHint':'Drag to move the active shape\'s path or the Work Path | Click a path: select component, Shift+click: add/remove, Alt+drag: duplicate | Delete, arrow keys nudge | Ctrl+Enter: load as selection',
          'ui.pathselNoPath':'No path to make a selection from: draw one with the Pen tool or select one in the Paths panel.'}
  },
  onDown(e, pt){ if (e.button !== undefined && e.button !== 0) return; PathSel.down(e, pt); UI.draw(); },
  onMove(e, pt, P){ if (!P.down || !PathSel.drag) return; PathSel.move(e, pt); UI.draw(); },
  onUp(e, pt){ PathSel.up(e, pt); UI.draw(); },
  onKey(e){
    const k = e.key;
    if (k === 'Enter' && (e.ctrlKey || e.metaKey)){
      e.preventDefault();
      const r = CMD.run('pathselect.toSelection', {});
      if (r && r.ok === false && window.Locks) Locks.notify(Lang.t('ui.pathselNoPath'));
      UI.draw(); return true;
    }
    if (e.ctrlKey || e.metaKey) return false;
    if (k === 'Escape'){ if (PathSel.drag){ PathSel.drag = null; UI.draw(); return true; } if (PathSel.anySelected()){ CMD.run('pathselect.select', {mode:'clear'}); UI.draw(); return true; } return false; }
    const sp = PathSel.selectionParams(); if (!sp) return false;
    if (k === 'Delete' || k === 'Backspace'){ e.preventDefault(); delete sp.mode; CMD.run('pathselect.delete', sp); UI.draw(); return true; }
    const dir = {ArrowLeft:[-1, 0], ArrowRight:[1, 0], ArrowUp:[0, -1], ArrowDown:[0, 1]}[k];
    if (dir){
      e.preventDefault(); const m = e.shiftKey ? 10 : 1; delete sp.mode;
      CMD.run('pathselect.move', Object.assign(sp, {dx:dir[0] * m, dy:dir[1] * m, copy:!!e.altKey})); UI.draw(); return true;
    }
    return false;
  },
  onDeactivate(){ PathSel.drag = null; },
  drawOverlay(ctx, s){ PathSel.overlay(ctx, s); }
});
