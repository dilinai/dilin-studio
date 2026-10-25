/* 钢笔（P）——照 VectorCraft 原始码逐段翻译：vectorcraft/crates/tools/src/pen.rs
   （＋ engine/src/cmd/path.rs 的 path.appendAnchor／path.close／path.reverse、cmd/create.rs 的 path.create、
      geom/src/lib.rs 的 constrain_angle、ui-egui/src/canvas.rs 的 Drag 事件）
   点一下 ＝ 直角锚点；按住拖 ＝ 两边对称把手（曲线）；拖时按 Alt ＝ 只留出去那支把手（进来那支收回锚点上）
   第一个锚点拖出把手时不认 Alt（pen.rs:96-102 新路径那条分支永远对称）
   Shift ＝ 落点／把手锁 45°（落点先锁、再判是否点回起点；pen.rs:62-65）
   点回第一个锚点（5 屏幕像素内）＝ 收合；在起点上按住拖 ＝ 收合时顺便拉起点的把手（不按 Alt 两边对称，按 Alt 只改进来那支）
   没在画时，点「刚画好、仍是这层最上面那条」开放路径的末端 ＝ 接着画；点它的起点 ＝ 先反转方向再接着画（pen.rs:75-84）
   画到一半 Ctrl+Z ＝ 退掉最后一个锚点、Ctrl+Shift+Z／Ctrl+Y ＝ 补回（原码每个锚点各是一步历史）
   Enter／双击 ＝ 收成开放路径（只描边）；Esc ＝ 整条丢掉；Backspace ＝ 退掉最后一个锚点
   画的过程只在画面上预览，收笔那一刻才变成一条命令进图层（新路径走 shape.bezier、接着画的走 pen.setAnchors）。
   ── 原码没有、照 PS／AI 加的：见本档下半的 PenAuto ──
   自动添加／删除（选项栏可关）：悬在已选路径线段上＝「+」点下加锚点（转 addanchor.insert）、悬在已选路径锚点上＝「−」点下删锚点（转 delanchor.remove）；
     画路径中则对「正在画的这条」生效；悬在这条的起点／最后一点、或可接续路径的端点上让位原码；按着 Shift 暂停（AI 的做法）
   按住 Ctrl（Mac Cmd）＝临时直接选择（事件转交 Direct）；按住 Alt 且悬在已选路径的锚点／把手上（没在画）＝临时锚点工具（转交 AnchorPt）
   这些临时切换都不改 ToolState.cur；拖到一半松键照 PS：这一拖做完才回钢笔。
   钢笔收笔后那条路径成为「已选路径」（VecSel，跟 AI 一样画完就是选中的）。 */
const Pen = {
  anchors: [], active: false, dragging: false, dragAnchor: null, hover: null, nearStart: false,
  drag: null,        // {a, closing, first, orig:{in,out}}：这一次按下在拖哪个锚点
  redo: [],          // 画到一半 Ctrl+Z 退掉的锚点，Ctrl+Shift+Z 补回（画路径中自动加删点的那一步存成 {edit}）
  edits: [],         // 画路径中自动加／删点的步骤 [{before, after}]（每步一份快照，Ctrl+Z 按步退）
  cont: null,        // 接着画既有路径时：{layerId, shapeId, base:原有锚点数}
  last: null,        // 「选中的」开放路径（钢笔刚收成开放路径的那条）：{layerId, shapeId}
  mode: 'pen',       // 游标状态：pen | close（点下去会收合）| continue（点下去会接着画）

  /* 原码 cx.tol(5.0) = 5 屏幕像素换成文件单位 */
  tol(){ return 5 / UI.zoom; },
  dist(p, q){ return Math.hypot(p[0]-q[0], p[1]-q[1]); },
  /* geom::constrain_angle(v, 45°)：以 a 为原点把 pt 锁到最近的 45° 方向，长度不变 */
  constrain(a, pt){
    const dx = pt[0]-a.x, dy = pt[1]-a.y, d = Math.hypot(dx, dy);
    if (d < 1e-9) return [pt[0], pt[1]];
    const step = Math.PI/4, ang = Math.round(Math.atan2(dy, dx) / step) * step;
    return [a.x + Math.cos(ang)*d, a.y + Math.sin(ang)*d];
  },
  snap45(a, pt){ return this.constrain(a, pt); },          // 旧名字留着
  hitStart(pt){
    if (!this.anchors.length) return false;
    const a = this.anchors[0];
    return this.dist(pt, [a.x, a.y]) <= this.tol();
  },

  /* pen.rs active_path()：能被「接着画」的那条开放路径。
     我们没有物件选取，用「钢笔上一次收成的开放路径、而且仍是当前这层最上面那个形状」代替「选中的唯一一条开放路径」
     （原码里画别的东西会把选取换走——这里换成：这层又多了别的形状就不算了）。 */
  continuable(){
    const r = this.last; if (!r) return null;
    const L = Doc.byId(r.layerId);
    if (!L || L !== Doc.active() || L.kind !== 'vector') return null;
    const S = L.data.shapes, s = S[S.length-1];
    if (!s || s.id !== r.shapeId || s.type !== 'bezier' || s.closed || !s.anchors || s.anchors.length < 1) return null;
    const f = s.anchors[0], l = s.anchors[s.anchors.length-1];
    return {L, s, first:[f.x+L.x, f.y+L.y], last:[l.x+L.x, l.y+L.y]};
  },

  down(e, pt){
    let p = [pt[0], pt[1]];
    const tol = this.tol();
    if (this.active){
      const A = this.anchors, first = A[0], last = A[A.length-1];
      if (e.shiftKey) p = this.constrain(last, pt);                // pen.rs:62-64 先锁角度
      if (this.dist(p, [first.x, first.y]) <= tol){                 // pen.rs:65-68 再判点回起点
        if (A.length < 2){ this.cancel(); return; }                 // 只有一点：原码收成看不见的单点闭合路径；我们引擎要 ≥2 点，直接结束
        this.drag = {a:first, closing:true, orig:{in:first.in, out:first.out}};
        this.dragging = true; this.dragAnchor = first; this.hover = pt;
        return;                                                     // 放开时才收合（pen.rs:116-121）
      }
      const a = {x:p[0], y:p[1], in:null, out:null};
      A.push(a); this.redo = [];
      this.drag = {a, closing:false, first:false};
      this.dragging = true; this.dragAnchor = a; this.hover = pt;
      return;
    }
    // 没在画：点到可接续路径的一端 ⇒ 接着画（pen.rs:75-84）
    const c = this.continuable();
    if (c && (this.dist(p, c.last) <= tol || this.dist(p, c.first) <= tol)){
      if (this.dist(p, c.first) <= tol && this.dist(p, c.last) > tol)
        CMD.run('pen.reverse', {shapeId:c.s.id, layerId:c.L.id});   // 点的是起点：先反转方向（原码也是一步独立的 Exec）
      const c2 = this.continuable() || c;
      this.anchors = c2.s.anchors.map(a => ({
        x:a.x+c2.L.x, y:a.y+c2.L.y,
        in: a.in ? [a.in[0]+c2.L.x, a.in[1]+c2.L.y] : null,
        out: a.out ? [a.out[0]+c2.L.x, a.out[1]+c2.L.y] : null }));
      this.cont = {layerId:c2.L.id, shapeId:c2.s.id, base:this.anchors.length};
      this.active = true; this.redo = []; this.edits = []; this.hover = pt;
      return;                                                       // 这一下不落新点、也不拖
    }
    // 新路径的第一个锚点
    const a = {x:p[0], y:p[1], in:null, out:null};
    this.anchors = [a]; this.cont = null; this.redo = []; this.edits = [];
    this.active = true;
    this.drag = {a, closing:false, first:true};
    this.dragging = true; this.dragAnchor = a; this.hover = pt;
  },

  move(e, pt){
    this.hover = pt;
    this.updateMode(pt);
    const d = this.drag; if (!d) return;
    const a = d.a;
    const q = e.shiftKey ? this.constrain(a, pt) : [pt[0], pt[1]];   // pen.rs:91-94 把手锁 45°
    const has = this.dist(q, [a.x, a.y]) > 1e-9;                     // 原码没有拖曳门槛：滑鼠一动就是把手
    const mirror = has ? [2*a.x - q[0], 2*a.y - q[1]] : null;
    const out = has ? [q[0], q[1]] : null;
    if (d.closing){                                                  // pen.rs:104-108 + path.rs close()
      a.in = mirror;                                                 // 进起点的把手 = 拖点的镜射
      a.out = e.altKey ? d.orig.out : out;                           // 不按 Alt：出去那支跟着滑鼠（变平滑点）
    } else if (d.first){                                             // pen.rs:96-102 新路径第一点：永远对称
      a.out = out; a.in = mirror;
    } else {                                                         // pen.rs:110-114
      a.out = out; a.in = e.altKey ? null : mirror;                  // Alt：进来那支收回锚点（＝没有）
    }
  },

  up(){
    const d = this.drag;
    this.drag = null; this.dragging = false; this.dragAnchor = null;
    if (d && d.closing) this.finish(true);
  },

  updateMode(pt){
    let m = 'pen';
    if (this.active){ if (this.hitStart(pt)) m = 'close'; }        // pen.rs:164-166 PenClose
    else {
      const c = this.continuable(), tol = this.tol();
      if (c && (this.dist(pt, c.last) <= tol || this.dist(pt, c.first) <= tol)) m = 'continue';   // pen.rs:167-169
    }
    const changed = m !== this.mode;
    this.mode = m; this.nearStart = (m === 'close');
    return changed;
  },

  undoPoint(){
    if (this.drag) return;
    // 自动加／删点那一步（之后落的点都已退掉时锚点数正好等于那步做完的数）：整步退回
    const E = this.edits[this.edits.length-1];
    if (E && E.after.anchors.length === this.anchors.length){ this.edits.pop(); this.restoreEdit(E.before); this.redo.push({edit:E}); return; }
    if (this.cont && this.anchors.length <= this.cont.base){ this.cancel(); return; }   // 原有的点不退，只结束接续
    const a = this.anchors.pop(); if (a) this.redo.push(a);
    if (!this.anchors.length) this.cancel();
  },
  redoPoint(){
    if (this.drag || !this.active || !this.redo.length) return;
    const r = this.redo.pop();
    if (r && r.edit){ this.restoreEdit(r.edit.after); this.edits.push(r.edit); return; }
    this.anchors.push(r);
  },
  /* 画路径中自动加删点的快照：锚点（深拷贝）＋接续时原有点数 */
  snapEdit(){ return {anchors:JSON.parse(JSON.stringify(this.anchors)), base:this.cont ? this.cont.base : null}; },
  restoreEdit(s){
    this.anchors = JSON.parse(JSON.stringify(s.anchors));
    if (this.cont && s.base !== null) this.cont.base = s.base;
  },
  cancel(){
    this.anchors = []; this.active = false; this.dragging = false; this.dragAnchor = null; this.drag = null;
    this.nearStart = false; this.cont = null; this.redo = []; this.edits = []; this.mode = 'pen';
  },

  /* 路径还没收合时的颜色：开放路径只描边（没描边就用填色当描边色；两样都没有就用黑——path.create 的保底） */
  openStroke(){
    let c = UI.stroke() === 'none' ? UI.fill() : UI.stroke();
    if (!c || c === 'none') c = '#000000';
    return c;
  },

  finish(closed){
    const A = this.anchors, cont = this.cont;
    const base = cont ? cont.base : 0;
    // 双击会先落两个几乎重叠的锚点，收笔前把重的那个拿掉（只拿新加的点）
    if (A.length >= 2 && A.length > base){
      const p = A[A.length-2], q = A[A.length-1];
      if (Math.hypot(p.x-q.x, p.y-q.y) < 2 / UI.zoom) A.pop();
    }
    const out = A.map(a => ({x:a.x, y:a.y, in:a.in, out:a.out}));
    let r = null, selId = null, selL = null;
    if (cont){
      if (closed || A.length > base || this.edits.length){             // edits：只在原有那段自动加删过点也要存
        selId = cont.shapeId; selL = cont.layerId;
        const L = Doc.byId(cont.layerId);
        const s = L && L.data.shapes.find(x => x.id === cont.shapeId);
        const p = {shapeId:cont.shapeId, layerId:cont.layerId, anchors:out, closed:!!closed};
        if (closed && s && (!s.fill || s.fill === 'none')) p.fill = UI.fill();   // 收合了就跟新画的闭合路径一样带填色
        r = CMD.run('pen.setAnchors', p);
        this.last = closed ? null : {layerId:cont.layerId, shapeId:cont.shapeId};
      }
    } else if (A.length >= 2){
      r = CMD.run('shape.bezier', {
        anchors: out,
        closed: !!closed,
        fill: closed ? UI.fill() : 'none',
        stroke: this.openStroke(),
        strokeWidth: closed ? UI.strokeW() : (UI.strokeW() || 2)
      });
      this.last = (!closed && r && r.id) ? {layerId:r.layerId, shapeId:r.id} : null;
      if (r && r.id){ selId = r.id; selL = r.layerId; }
    }
    // 多做的（AI／PS 行为）：收好的路径就是「已选路径」⇒ 自动加删、Alt 锚点工具、换直接选择都接得上（选取不进历史，走 direct.select）
    if (selId && r && r.ok !== false && CMD.map['direct.select']) CMD.run('direct.select', {ids:[selId], layerId:selL});
    this.cancel();
    return r;
  }
};
window.Pen = Pen;

/* ── PS／AI 式自动切换（原码没有）──
   不另写一份节点编辑：加点走 addanchor.insert（画路径中走 AddAnchor.insertAnchor）、删点走 delanchor.remove、
   Ctrl 把按下／拖曳／放开整个转交 Direct、Alt 转交 AnchorPt。 */
const PenAuto = {
  on: (() => { try { return localStorage.getItem('dlc.pen.autoAddDelete') !== '0'; } catch (e){ return true; } })(),
  temp: null,        // 这一下按下转交给谁：'direct' | 'anchorpoint'（放开才还给钢笔）
  kind: null,        // 悬停状态：null＝钢笔原样 | 'add' | 'del' | 'direct' | 'anchorpoint'
  hit: null,         // 自动加删的命中：{kind, inPen?, shapeId?, layerId?, seg?, t?, q?, idx?, p?}（q／p 是文件坐标，叠画用）
  key: '',           // 悬停状态的比对键（变了才重画）
  mods: {ctrl:false, alt:false, shift:false},

  setOn(v){
    this.on = !!v;
    try { localStorage.setItem('dlc.pen.autoAddDelete', this.on ? '1' : '0'); } catch (e){}
  },
  /* 已选路径所在的层：当前层、矢量、看得见、而且 VecSel 选的就是这层 */
  selLayer(){
    const L = Doc.active();
    return (L && L.kind === 'vector' && L.visible && VecSel.layerId === L.id && !VecSel.isEmpty()) ? L : null;
  },

  /* 自动添加／删除：滑鼠下有什么可加可删（PS「自动添加/删除」）。容差＝加删锚点工具的 4 屏幕像素 */
  target(pt){
    const tol = VecSel.tol(4);
    if (Pen.active){
      // 画路径中：只认正在画的这条（它还不在文件里，是 Pen.anchors，文件坐标）
      const A = Pen.anchors; if (A.length < 2) return null;
      const f = A[0], l = A[A.length-1];
      if (Pen.dist(pt, [f.x, f.y]) <= Pen.tol() || Pen.dist(pt, [l.x, l.y]) <= Pen.tol()) return null;   // 起点＝收合、最后一点：让位原码
      let best = null;
      for (let i = 1; i < A.length - 1; i++){ const d = Pen.dist(pt, [A[i].x, A[i].y]); if (d <= tol && (!best || d < best.d)) best = {i, d}; }
      if (best) return {kind:'del', inPen:true, idx:best.i, p:[A[best.i].x, A[best.i].y]};
      const n = VecSel.nearestOnShape({anchors:A, closed:false}, pt);
      if (n && n.d <= tol) return {kind:'add', inPen:true, seg:n.seg, t:n.t, q:n.q};
      return null;
    }
    const L = this.selLayer(); if (!L) return null;
    const c = Pen.continuable();
    if (c && (Pen.dist(pt, c.last) <= Pen.tol() || Pen.dist(pt, c.first) <= Pen.tol())) return null;  // 接着画：让位原码
    const a = VecSel.hitAnchor(L, pt, tol, true);                   // 锚点先于线段（PS：悬在锚点上是「−」）
    if (a){
      const n = a.s.anchors.length;
      if (!a.s.closed && (a.idx === 0 || a.idx === n - 1)) return null;   // 开放路径端点：PS 是接着画、不删 ⇒ 交回原码
      const q = a.s.anchors[a.idx];
      return {kind:'del', shapeId:a.s.id, layerId:L.id, idx:a.idx, p:VecSel.toDoc(L, [q.x, q.y])};
    }
    const g = VecSel.hitSegment(L, pt, tol);                        // candidatePaths 选中的排前面：第一个命中不是选中的＝选中的都没中
    if (g && VecSel.isShapeSelected(g.s.id)) return {kind:'add', shapeId:g.s.id, layerId:L.id, seg:g.seg, t:g.t, q:VecSel.toDoc(L, g.q)};
    return null;
  },
  /* Alt 归锚点工具的条件：没在画、悬在已选路径的把手或锚点上（AnchorPt 自己的命中规则） */
  altTarget(pt){
    if (Pen.active || Pen.drag) return null;
    const L = Doc.active();
    if (!L || L.kind !== 'vector' || VecSel.layerId !== L.id) return null;
    const tol = VecSel.tol(4);
    return AnchorPt.hitHandle(L, pt, tol) || VecSel.hitAnchor(L, pt, tol, true);
  },

  /* 悬停：按修饰键与滑鼠下的东西定状态、换游标 */
  hover(e, pt){
    if (e) this.mods = {ctrl:!!(e.ctrlKey || e.metaKey), alt:!!e.altKey, shift:!!e.shiftKey};
    if (this.temp) return;
    const m = this.mods; let kind = null, hit = null;
    if (!Pen.drag){                                                 // 正在拖把手：一切归钢笔（含 Alt）
      if (m.ctrl) kind = 'direct';
      else if (!pt) {}
      else if (m.alt){ if (this.altTarget(pt)) kind = 'anchorpoint'; }
      else if (this.on && !m.shift){ hit = this.target(pt); if (hit) kind = hit.kind; }
    }
    this.kind = kind; this.hit = hit;
    this.key = kind ? kind + ':' + (hit ? [hit.shapeId, hit.idx, hit.seg, hit.t !== undefined ? hit.t.toFixed(3) : ''].join(',') : '') : '';
    this.applyCursor();
  },
  cursorCss(kind){
    const T = id => Tools.get(id) || {};
    if (kind === 'add') return window.AddAnchor ? AddAnchor.CUR_ADD : 'crosshair';
    if (kind === 'del') return window.AddAnchor ? AddAnchor.CUR_DEL : 'crosshair';
    if (kind === 'direct') return T('direct').cursor || 'default';
    if (kind === 'anchorpoint') return T('anchorpoint').cursor || 'crosshair';
    return T('pen').cursor || 'crosshair';
  },
  applyCursor(){
    if (!window.UI || !UI.canvas || ToolState.cur !== 'pen') return;
    const c = this.cursorCss(this.temp || this.kind);
    if (UI.canvas.style.cursor !== c) UI.canvas.style.cursor = c;
  },

  /* 按下：要转交／自动加删就做掉并回 true；否则回 false 让原码钢笔处理 */
  down(e, pt){
    this.temp = null;
    this.mods = {ctrl:!!(e.ctrlKey || e.metaKey), alt:!!e.altKey, shift:!!e.shiftKey};
    if (this.mods.ctrl){
      // PS：画路径中按 Ctrl 点下去＝结束这条（收成开放路径），再交给直接选择
      if (Pen.active) Pen.finish(false);
      this.temp = 'direct'; this.applyCursor();
      Direct.down(e, pt);
      return true;
    }
    if (this.mods.alt){
      if (!this.altTarget(pt)) return false;                        // 没悬在已选路径的锚点／把手上：Alt 归钢笔（原码）
      this.temp = 'anchorpoint'; this.applyCursor();
      AnchorPt.down(e, pt);
      return true;
    }
    if (!this.on || this.mods.shift) return false;                  // 选项关了／按着 Shift（AI：Shift 暂停自动切换）
    const h = this.target(pt); if (!h) return false;
    if (h.inPen) this.editPen(h);
    else if (h.kind === 'add') CMD.run('addanchor.insert', {shapeId:h.shapeId, segment:h.seg, t:h.t, layerId:h.layerId});
    else CMD.run('delanchor.remove', {shapeId:h.shapeId, anchor:h.idx, layerId:h.layerId});
    Pen.hover = pt; this.hover(e, pt);
    return true;
  },

  /* 画路径中在自己这条上加／删点：路径还没进文件，改 Pen.anchors；每下一步，Ctrl+Z 按步退 */
  editPen(h){
    const before = Pen.snapEdit();
    if (h.kind === 'add'){
      const idx = AddAnchor.insertAnchor({anchors:Pen.anchors, closed:false}, h.seg, h.t);   // 同 addanchor.insert 的本体
      if (Pen.cont && idx < Pen.cont.base) Pen.cont.base++;          // 插在接续前原有的那段里
    } else {
      if (!this.removeInPen(h.idx)) return;
      if (Pen.cont && h.idx < Pen.cont.base) Pen.cont.base--;
    }
    Pen.edits.push({before, after:Pen.snapEdit()}); Pen.redo = [];
  },
  /* 删正在画的这条的中间点：借 DelAnchor.removeAnchor 的纯几何部分（只改锚点阵列，不碰图层与历史）。
     删完它会把开放路径首点 in／末点 out 清掉——画路径中末点 out 是下一段要用的把手，照原样放回。 */
  removeInPen(idx){
    if (!window.DelAnchor || !DelAnchor.removeAnchor) return false;
    const A = Pen.anchors, keepIn = A[0].in, keepOut = A[A.length-1].out;
    const tmp = {type:'bezier', closed:false, anchors:JSON.parse(JSON.stringify(A))};
    const r = DelAnchor.removeAnchor(tmp, idx);
    if (!r || r.ok === false || tmp.anchors.length < 2) return false;
    Pen.anchors = tmp.anchors.map(a => ({x:a.x, y:a.y, in:a.in || null, out:a.out || null}));
    Pen.anchors[0].in = keepIn; Pen.anchors[Pen.anchors.length-1].out = keepOut;
    return true;
  },

  move(e, pt, P){
    if (this.temp === 'direct'){ if (P && P.down) Direct.move(e, pt); return true; }
    if (this.temp === 'anchorpoint'){ if (P && P.down && AnchorPt.st){ AnchorPt.drag(e, pt); UI.draw(); } return true; }
    return false;
  },
  up(e, pt){
    const t = this.temp; if (!t) return false;
    if (t === 'direct') Direct.up(e, pt); else AnchorPt.up(e, pt);
    this.temp = null;
    this.hover(e, pt);                                              // 放开时键已松 ⇒ 回钢笔游标
    return true;
  },
  /* 修饰键按下／放开：按目前滑鼠位置重算（onKey 只收 keydown，放开走下面的 keyup） */
  modKey(e){
    this.mods = {ctrl:!!(e.ctrlKey || e.metaKey), alt:!!e.altKey, shift:!!e.shiftKey};
    const was = this.key;
    this.hover(null, Pen.hover);
    if (this.key !== was && window.UI) UI.draw();
  },
  reset(){
    if (this.temp === 'direct'){ Direct.cancel(); Direct.st = null; }
    else if (this.temp === 'anchorpoint') AnchorPt.deactivate();
    this.temp = null; this.kind = null; this.hit = null; this.key = '';
    this.mods = {ctrl:false, alt:false, shift:false};
  },

  /* 叠画提示：会加点的位置画小圆、会删的锚点画红框（游标之外的提示，同删锚点工具） */
  drawHint(ctx, s){
    const h = this.hit; if (!h || this.temp || !this.kind) return;
    ctx.save(); ctx.setLineDash([]); ctx.lineWidth = 1.5;
    if (h.kind === 'add'){
      ctx.strokeStyle = '#2f7fd8'; ctx.beginPath(); ctx.arc(h.q[0]*s, h.q[1]*s, 4, 0, Math.PI*2); ctx.stroke();
    } else {
      ctx.strokeStyle = '#e8573f'; ctx.strokeRect(h.p[0]*s - 5, h.p[1]*s - 5, 10, 10);
    }
    ctx.restore();
  }
};
window.PenAuto = PenAuto;

document.addEventListener('keyup', e => {
  if (ToolState.cur !== 'pen') return;
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) PenAuto.modKey(e);
});
window.addEventListener('blur', () => { if (ToolState.cur === 'pen' && !PenAuto.temp){ PenAuto.mods = {ctrl:false, alt:false, shift:false}; PenAuto.hover(null, Pen.hover); } });

/* ── 命令（agent 走这几条做得到跟滑鼠一样的事）── */
function penShape(p, C){
  const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  if (!L || L.kind !== 'vector') return {err:{ok:false, error:'not a vector layer'}};
  const s = L.data.shapes.find(x => x.id === p.shapeId);
  if (!s || s.type !== 'bezier') return {err:{ok:false, error:C + ': no such pen path'}};
  return {L, s};
}
const penMv = (h, dx, dy) => h ? [h[0]+dx, h[1]+dy] : null;
const penAnchor = (a, dx, dy) => ({x:+a.x+dx, y:+a.y+dy, in:penMv(a.in||null, dx, dy), out:penMv(a.out||null, dx, dy)});

CMD.reg('pen.reverse', {i18n:'', undoable:true,
  params:'{shapeId, layerId?} 反转钢笔路径方向：锚点倒序、每点 in/out 对调（照 VectorCraft path.reverse / SubPath::reverse）'}, p => {
  const {L, s, err} = penShape(p, 'pen.reverse'); if (err) return err;
  s.anchors = s.anchors.slice().reverse().map(a => ({x:a.x, y:a.y, in:a.out||null, out:a.in||null}));
  Layer.invalidate(L); return {ok:true};
});
CMD.reg('pen.appendAnchor', {i18n:'', undoable:true,
  params:'{shapeId, x, y, in?:[x,y], out?:[x,y], layerId?} 文件坐标；在开放钢笔路径末端加一个锚点（照 path.appendAnchor；已闭合的会报错）'}, p => {
  const {L, s, err} = penShape(p, 'pen.appendAnchor'); if (err) return err;
  if (s.closed) return {ok:false, error:'path is already closed'};
  if (p.x === undefined || p.y === undefined) return {ok:false, error:'missing x/y'};
  s.anchors.push(penAnchor(p, -L.x, -L.y));
  Layer.invalidate(L); return {ok:true, count:s.anchors.length};
});
CMD.reg('pen.close', {i18n:'', undoable:true,
  params:'{shapeId, in?:[x,y] 进起点的把手(文件坐标), independent?:bool, fill?, layerId?} 收合开放钢笔路径（照 path.close：给 in 时 independent=false 会把起点出去那支镜射成平滑点）；原本没填色就补上 fill（缺省用当前填色）'}, p => {
  const {L, s, err} = penShape(p, 'pen.close'); if (err) return err;
  if (s.closed) return {ok:false, error:'path is already closed'};
  s.closed = true;
  const f = s.anchors[0];
  if (p.in && f){
    f.in = [p.in[0]-L.x, p.in[1]-L.y];
    if (!p.independent) f.out = [2*f.x - f.in[0], 2*f.y - f.in[1]];
  }
  if (!s.fill || s.fill === 'none') s.fill = p.fill || UI.fill();
  Layer.invalidate(L); return {ok:true};
});
CMD.reg('pen.setAnchors', {i18n:'', undoable:true,
  params:'{shapeId, anchors:[{x,y,in?,out?}] 文件坐标, closed?, fill?, stroke?, strokeWidth?, layerId?} 整条换掉钢笔路径的锚点（钢笔「接着画」收笔时用，一步历史）'}, p => {
  const {L, s, err} = penShape(p, 'pen.setAnchors'); if (err) return err;
  const A = (p.anchors||[]).map(a => penAnchor(a, -L.x, -L.y));
  if (A.length < 2) return {ok:false, error:'need ≥2 anchors'};
  s.anchors = A;
  if (p.closed !== undefined) s.closed = !!p.closed;
  ['fill','stroke','strokeWidth'].forEach(k => { if (p[k] !== undefined) s[k] = p[k]; });
  Layer.invalidate(L); return {ok:true, id:s.id, layerId:L.id};
});

/* 自动添加／删除的开关（PS 选项栏「自动添加/删除」）；agent 用这条做得到跟勾选框一样的事 */
CMD.reg('pen.options', {i18n:'',
  params:'{autoAddDelete?:bool} 钢笔选项（不进历史）：autoAddDelete＝悬在已选路径线段上点下加锚点、悬在锚点上点下删锚点（PS「自动添加/删除」，缺省开）；不给参数＝只查 → {ok, autoAddDelete}'}, p => {
  if (p && p.autoAddDelete !== undefined){
    PenAuto.setOn(!!p.autoAddDelete);
    const c = document.getElementById('penAutoAD'); if (c) c.checked = PenAuto.on;
  }
  return {ok:true, autoAddDelete:PenAuto.on};
});

Tools.reg({
  id:'pen', icon:'✒', key:'P', group:'vector', order:10, for:'vector', needs:'vector', opts:[],
  hint:'ui.penHint',
  strings:{
    'zh-Hant':{'ui.penHint':'點一下＝直角點，按住拖＝曲線（Alt 只拉一邊、Shift 鎖 45°）；點回起點收合（在起點上拖可拉把手）；點剛畫好的開放路徑端點＝接著畫；Enter 收筆，Esc 取消，Backspace／Ctrl+Z 退一點；懸在已選路徑線段＝加錨點、懸在錨點＝刪錨點；按住 Ctrl＝直接選擇、Alt（在錨點／把手上）＝錨點工具',
               'opt.penAutoAddDelete':'自動增加/刪除'},
    'zh-Hans':{'ui.penHint':'点一下＝直角点，按住拖＝曲线（Alt 只拉一边、Shift 锁 45°）；点回起点闭合（在起点上拖可拉把手）；点刚画好的开放路径端点＝接着画；Enter 收笔，Esc 取消，Backspace／Ctrl+Z 退一点；悬在已选路径线段＝加锚点、悬在锚点＝删锚点；按住 Ctrl＝直接选择、Alt（在锚点／把手上）＝锚点工具',
               'opt.penAutoAddDelete':'自动添加/删除'},
    'en':{'ui.penHint':'Click = corner, drag = curve (Alt: one handle, Shift: 45°); click the first point to close (drag there to pull its handles); click an end of the open path you just drew to continue it; Enter to finish, Esc to cancel, Backspace / Ctrl+Z to undo a point; over a selected path: segment = add anchor, anchor = delete anchor; hold Ctrl = Direct Selection, Alt (on an anchor / handle) = Anchor Point tool',
          'opt.penAutoAddDelete':'Auto Add/Delete'}
  },
  /* 选项栏：PS 的「自动添加/删除」勾选框 */
  buildOptions(box, add, mk){
    const c = mk('checkbox', {checked:PenAuto.on, id:'penAutoAD'});
    c.onchange = () => { CMD.run('pen.options', {autoAddDelete:c.checked}); c.blur(); };
    add('penAutoAddDelete', c);
  },
  onDown(e, pt){
    if (PenAuto.down(e, pt)){ UI.draw(); return; }                 // 转交／自动加删（原码之外加的）
    Pen.down(e, pt); UI.draw();
  },
  onMove(e, pt, P){
    if (PenAuto.move(e, pt, P)) return;                             // 这一下转交给临时工具
    const was = Pen.mode, wasK = PenAuto.key;
    Pen.move(e, pt);
    PenAuto.hover(e, pt);
    if (Pen.active || Pen.mode !== was || PenAuto.key !== wasK) UI.draw();      // 没按着也要跟：橡皮筋线、收合／接续提示、加删提示
  },
  onUp(e, pt){
    if (PenAuto.up(e, pt)){ UI.draw(); return; }
    Pen.up(); UI.draw();
  },
  onDblClick(){ if (Pen.active){ Pen.finish(false); UI.draw(); } },
  /* 画到一半的 Ctrl+Z／Ctrl+Shift+Z／Ctrl+Y：原码每落一点就是一步历史，所以这时的退回＝退一个锚点、重做＝补回。
     没在画时不吃，交给文件历史。 */
  onUndoKey(e){
    if (PenAuto.temp) return true;                                  // 临时工具拖到一半：先不让退（同锚点工具），免得预览乱掉
    if (!Pen.active) return false;
    const k = (e.key || '').toLowerCase();
    if (k === 'z' && !e.shiftKey) Pen.undoPoint();
    else if (k === 'z' && e.shiftKey) Pen.redoPoint();
    else return false;
    UI.draw(); return true;
  },
  onKey(e){
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)){ PenAuto.modKey(e); return false; }   // 修饰键：换游标／提示，不吃
    if (!Pen.active) return false;
    const k = e.key.toLowerCase();
    if (k === 'enter'){ e.preventDefault(); Pen.finish(false); UI.draw(); return true; }
    if (k === 'escape'){ Pen.cancel(); UI.draw(); return true; }
    if (k === 'backspace' || k === 'delete'){ e.preventDefault(); Pen.undoPoint(); UI.draw(); return true; }
    return false;
  },
  /* 画到一半换工具：够两点就收成开放路径，不够就丢掉 */
  onDeactivate(){ PenAuto.reset(); if (Pen.active) Pen.finish(false); Pen.mode = 'pen'; Pen.nearStart = false; },
  /* 预览：
     ① 路径用它收成开放路径后的真实描边画一次（原码路径一落点就在文件里、照真外观显示）
     ② 蓝色路径线＋把手＋锚点（原码的选取显示）
     ③ 滑鼠没按着时：上一点到滑鼠的橡皮筋（pen.rs:140-153：实线、1 像素、上一点有出把手就用二次曲线 quad_to(out, 滑鼠)）
     ④ 靠近起点＝红圈（PenClose）；没在画时靠近可接续路径的端点＝绿圈（PenContinue） */
  drawOverlay(ctx, s){
    if (!Pen.active){
      // 加的：已选路径（PS 钢笔下也看得到）；临时工具在动时用它自己的叠画（框选虚线、锚点工具拖曳中的路径）
      if (PenAuto.temp === 'direct') Tools.get('direct').drawOverlay(ctx, s);
      else if (PenAuto.temp === 'anchorpoint') Tools.get('anchorpoint').drawOverlay(ctx, s);
      else VecSel.drawOverlay(ctx, s);
      PenAuto.drawHint(ctx, s);
      if (Pen.mode === 'continue' && Pen.hover){
        const c = Pen.continuable(); if (!c) return;
        const tol = Pen.tol();
        const end = Pen.dist(Pen.hover, c.last) <= tol ? c.last : c.first;
        ctx.save(); ctx.beginPath(); ctx.arc(end[0]*s, end[1]*s, 9, 0, Math.PI*2);
        ctx.strokeStyle = '#2aa84a'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      }
      return;
    }
    if (!Pen.anchors.length) return;
    const A = Pen.anchors, blue = '#2f7fd8';
    ctx.save();
    if (A.length >= 2){
      drawShape(ctx, {type:'bezier', anchors:A, closed:false, fill:'none',
                      stroke:Pen.openStroke(), strokeWidth:UI.strokeW() || 2}, s);
    }
    ctx.lineWidth = 1.5; ctx.strokeStyle = blue;
    ctx.beginPath(); bezierPath(ctx, {anchors:A, closed:false}, s); ctx.stroke();
    if (Pen.hover && !Pen.drag){
      const p = A[A.length-1], h = Pen.hover;
      ctx.setLineDash([]); ctx.strokeStyle = blue; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(p.x*s, p.y*s);
      if (p.out && Math.hypot(p.out[0]-p.x, p.out[1]-p.y) > 1e-9) ctx.quadraticCurveTo(p.out[0]*s, p.out[1]*s, h[0]*s, h[1]*s);
      else ctx.lineTo(h[0]*s, h[1]*s);
      ctx.stroke();
    }
    A.forEach((a, i) => {
      ctx.strokeStyle = blue; ctx.lineWidth = 1;
      [a.in, a.out].forEach(h => {
        if (!h) return;
        ctx.beginPath(); ctx.moveTo(a.x*s, a.y*s); ctx.lineTo(h[0]*s, h[1]*s); ctx.stroke();
        ctx.beginPath(); ctx.arc(h[0]*s, h[1]*s, 3.5, 0, Math.PI*2); ctx.fillStyle = blue; ctx.fill();
      });
      const last = i === A.length-1;
      ctx.fillStyle = last ? blue : '#fff'; ctx.fillRect(a.x*s-3.5, a.y*s-3.5, 7, 7);
      ctx.strokeStyle = blue; ctx.strokeRect(a.x*s-3.5, a.y*s-3.5, 7, 7);
    });
    if (Pen.nearStart){
      ctx.beginPath(); ctx.arc(A[0].x*s, A[0].y*s, 9, 0, Math.PI*2);
      ctx.strokeStyle = '#e8573f'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.restore();
    PenAuto.drawHint(ctx, s);
  }
});
