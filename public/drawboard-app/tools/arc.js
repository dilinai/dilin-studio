/* 弧形工具（AI 版面 ai.arc）＋ 共用的「直线段家族」底层 window.AiFamily（螺旋线／矩形网格／极坐标网格／光晕都读它）
   逐段照 ArtCraft／VectorCraft 原码翻：
     vectorcraft/crates/tools/src/draw2/family.rs 1-216    FamilyTool：Down 定起点（snap_draw）、拖超过 2 屏幕像素才 Begin、
                                                           Shift＝两轴等长（正方）、Alt＝从中心（弧形与两种网格）、拖时 ↑↓ 改螺旋段数／网格行数（同心圆数）、
                                                           ←→ 改网格列数（径向线数）、Esc 取消、点一下不拖＝Dialog、量尺寸小框 Overlay::Measure、选项与夹限
     vectorcraft/crates/tools/src/settings.rs 27-30        arc.closed／spiral.decay,segments,clockwise／rectangularGrid.rows,columns／polarGrid.concentric,radial 要记住
     vectorcraft/crates/tools/src/draw2.rs 22-34           FEEDBACK 蓝、这四颗都由 FamilyTool 建
     vectorcraft/crates/engine/src/cmd/create.rs 155-164, 310-360   shape.spiral／shape.arc／shape.rectangularGrid／shape.polarGrid：参数、预设、夹限；
                                                           弧形与螺旋线用目前填色＋描边（add_art），两种网格＝编组、每条线「填色无＋目前描边」（grid_group）
     vectorcraft/crates/geom/src/shapes.rs 9-169           KAPPA、rectangle、ellipse（4 平滑点）、arc、spiral、rectangular_grid、polar_grid 几何
     vectorcraft/crates/tools/src/guides.rs 160-172        snap_draw（我们借 line.js 露出的 lineSnapDraw，同一套智能参考线）
     vectorcraft/crates/tools/src/lib.rs 261-271           tol()＝px/zoom、size_label＝"W: …\nH: …"
     vectorcraft/crates/ui-egui/src/dialogs/tools.rs 10-83 点一下开的对话框：arc／spiral／rectangularGrid／polarGrid 原码落到 `_ => return`（没对话框）；
                                                           🔴 我们照 Illustrator 2020 补了「XX 工具选项」对话框（原码没有·照 AI 2020 写），栏位只收命令有的参数
   改文件只走 CMD：arc.create／arc.drag／arc.setOption（spiral.*／rectgrid.*／polargrid.* 在各自档里用 AiFamily.install 登记同一套）。 */
(function(){
'use strict';

const FEEDBACK = '#4f9dff';                                   // draw2.rs:23
const KAPPA = 0.5522847498307936;                             // shapes.rs:10
const fin = v => typeof v === 'number' && isFinite(v);
const nid = () => uid('S');
const zoom = () => Math.max((window.UI && UI.zoom) || 1, 1e-9);
const tol = px => px / zoom();                                // lib.rs:261 tol
/* serde 的 as_u64：非负整数才算，不然 null（unwrap_or 走预设） */
const asU64 = v => (typeof v === 'number' && Number.isInteger(v) && v >= 0) ? v : null;
/* 对话框／选项栏打进来的字串数字 → 我们宽松一点：取整（原码 DragValue 存成浮点再 as_u64 会落回预设） */
/* Rust f64::signum：0.0 当正（回 1），跟 Math.sign(0)=0 不同 */
const sgn = v => (v < 0 || Object.is(v, -0)) ? -1 : 1;
const toU = v => { const n = typeof v === 'string' ? parseFloat(v) : v; return fin(n) ? Math.max(0, Math.trunc(n)) : null; };

/* ═════════════ 几何（geom/src/shapes.rs，全是文件坐标；回我们 engine 的 shape 物件） ═════════════ */
const rectAbs = (x0, y0, x1, y1) => ({x0:Math.min(x0, x1), y0:Math.min(y0, y1), x1:Math.max(x0, x1), y1:Math.max(y0, y1)});
const Geom = {
  KAPPA,
  /* shapes.rs:93-95 line：开放直线（我们用 engine 的 line 种类，跟直线段工具同一种） */
  line(a, b){ return {type:'line', points:[[a[0], a[1]], [b[0], b[1]]], closed:false}; },
  /* shapes.rs:12-16 rectangle：4 个直角点，从左上顺时针 */
  rectangle(r){
    const c = (x, y) => ({x, y, in:null, out:null, kind:'corner'});
    return {type:'bezier', anchors:[c(r.x0, r.y0), c(r.x1, r.y0), c(r.x1, r.y1), c(r.x0, r.y1)], closed:true};
  },
  /* shapes.rs:41-57 ellipse：4 个平滑点（左、上、右、下），h_in＝p＋hin、h_out＝p−hin */
  ellipse(r){
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, rx = (r.x1 - r.x0) / 2, ry = (r.y1 - r.y0) / 2;
    const kx = rx * KAPPA, ky = ry * KAPPA;
    const s = (x, y, hx, hy) => ({x, y, in:[x + hx, y + hy], out:[x - hx, y - hy], kind:'smooth'});
    return {type:'bezier', anchors:[s(cx - rx, cy, 0, ky), s(cx, cy - ry, -kx, 0), s(cx + rx, cy, 0, -ky), s(cx, cy + ry, kx, 0)], closed:true};
  },
  /* shapes.rs:97-111 arc：四分之一椭圆，从 a 到 b；corner＝(b.x, a.y)，把手＝端点往 corner 走 KAPPA；closed 多一个直角点 (a.x, b.y) */
  arc(a, b, closed){
    const k = KAPPA;                                          // KAPPA * (1 + slope.clamp(-1,1) * 0)：slope 原码乘 0，等于没作用
    const corner = [b[0], a[1]];
    const h1 = [a[0] + (corner[0] - a[0]) * k, a[1] + (corner[1] - a[1]) * k];
    const h2 = [b[0] + (corner[0] - b[0]) * k, b[1] + (corner[1] - b[1]) * k];
    const anchors = [{x:a[0], y:a[1], in:null, out:h1, kind:'corner'}, {x:b[0], y:b[1], in:h2, out:null, kind:'corner'}];
    if (closed) anchors.push({x:a[0], y:b[1], in:null, out:null, kind:'corner'});
    return {type:'bezier', anchors, closed:!!closed};
  },
  /* shapes.rs:113-135 spiral：每段 1/4 圈、半径每段 ×decay；最后整条反向（从中心那端开始） */
  spiral(c, radius, decayPercent, segments, clockwise){
    const decay = Math.min(0.9999, Math.max(0.05, decayPercent / 100));
    const dir = clockwise ? 1 : -1;
    const A = [];
    let r = radius;
    for (let i = 0; i <= segments; i++){
      const a = dir * i * Math.PI / 2;
      const p = [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
      const t = [-Math.sin(a) * dir, Math.cos(a) * dir];      // 这段四分之一圆弧的切线方向
      const rPrev = r / decay, rNext = r * decay;
      const ki = KAPPA * (r + rPrev) / 2, ko = KAPPA * (r + rNext) / 2;
      A.push({x:p[0], y:p[1], in:i === 0 ? null : [p[0] - t[0] * ki, p[1] - t[1] * ki],
              out:i === segments ? null : [p[0] + t[0] * ko, p[1] + t[1] * ko], kind:'smooth'});
      r *= decay;
    }
    // SubPath::reverse：锚点倒序、把手 in／out 对调
    const rev = A.reverse().map(a => ({x:a.x, y:a.y, in:a.out, out:a.in, kind:a.kind}));
    return {type:'bezier', anchors:rev, closed:false};
  },
  /* shapes.rs:137-153 rectangular_grid：先横线（rows 条）、再直线（columns 条）、最后外框矩形 */
  rectangularGrid(r, h, v, frame){
    const out = [], W = r.x1 - r.x0, H = r.y1 - r.y0;
    for (let i = 1; i <= h; i++){ const y = r.y0 + H * i / (h + 1); out.push(Geom.line([r.x0, y], [r.x1, y])); }
    for (let i = 1; i <= v; i++){ const x = r.x0 + W * i / (v + 1); out.push(Geom.line([x, r.y0], [x, r.y1])); }
    if (frame) out.push(Geom.rectangle(r));
    return out;
  },
  /* shapes.rs:155-169 polar_grid：concentric+1 个同心椭圆（最外那个＝外框）、再 radial 条（至少 1）从中心出去的线，第一条朝正上 */
  polarGrid(r, concentric, radial){
    const out = [], cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, W = r.x1 - r.x0, H = r.y1 - r.y0;
    for (let i = 1; i <= concentric + 1; i++){
      const f = i / (concentric + 1), w = W * f, h = H * f;
      out.push(Geom.ellipse({x0:cx - w / 2, y0:cy - h / 2, x1:cx + w / 2, y1:cy + h / 2}));
    }
    const n = Math.max(radial, 1);
    for (let i = 0; i < n; i++){
      const a = -Math.PI / 2 + 2 * Math.PI * i / n;
      out.push(Geom.line([cx, cy], [cx + W / 2 * Math.cos(a), cy + H / 2 * Math.sin(a)]));
    }
    return out;
  }
};

/* ═════════════ 外观（create.rs add_art／grid_group） ═════════════ */
/* add_art：目前填色＋描边＋描边宽（弧形、螺旋线） */
const artLook = p => ({
  fill:        p.fill        !== undefined ? p.fill        : UI.fill(),
  stroke:      p.stroke      !== undefined ? p.stroke      : UI.stroke(),
  strokeWidth: p.strokeWidth !== undefined ? p.strokeWidth : UI.strokeW()
});
/* grid_group：每条线「填色无＋目前描边＋描边宽」。🔴 我们加的：描边是「无」（我们预设描边宽 0）⇒ 用黑 1px，不然网格整个看不见 */
const gridLook = p => {
  let stroke = p.stroke !== undefined ? p.stroke : UI.stroke();
  let sw = p.strokeWidth !== undefined ? p.strokeWidth : UI.strokeW();
  if (!stroke || stroke === 'none' || !(sw > 0)){ stroke = (stroke && stroke !== 'none') ? stroke : '#000000'; sw = sw > 0 ? sw : 1; }
  return {fill:'none', stroke, strokeWidth:sw};
};
/* 落进当前矢量层并选中它（add_look／grid_group 的 sel.set([id])） */
function place(shape, p){
  if (p.layerId) shape.layerId = p.layerId;
  const r = addShape(shape);
  if (!r || r.ok === false || !r.id) return r || {ok:false, error:'not a vector layer'};
  if (window.VecSel) VecSel.setShapes(r.layerId, [r.id]);
  return {ok:true, id:r.id, layerId:r.layerId};
}
/* 编组（我们的 group 资料结构＝menus/impl/ai-object.js 那份：{type:'group', children}） */
const group = (children, name) => {
  const g = {type:'group', children:children.map(c => Object.assign(c, {id:nid()})), fill:'none', stroke:'none', strokeWidth:0};
  if (name) g.name = name;
  return g;
};

/* ═════════════ 四颗工具的命令（create.rs 的参数解析 → 几何 → 落地） ═════════════ */
const reqNums = (p, keys, C) => keys.every(k => fin(p[k])) ? null : {ok:false, error:`${C}: ${keys.join(', ')} are required numbers`};
/* create.rs:155-164 rect_of：x,y,width,height 必填，Rect::new(x,y,x+w,y+h).abs() */
const rectOf = (p, C) => {
  const e = reqNums(p, ['x', 'y', 'width', 'height'], C); if (e) return e;
  return rectAbs(p.x, p.y, p.x + p.width, p.y + p.height);
};
const Build = {
  /* create.rs:322-326 arc */
  arc(p){
    const e = reqNums(p, ['x1', 'y1', 'x2', 'y2'], 'arc.create'); if (e) return e;
    return Object.assign(Geom.arc([p.x1, p.y1], [p.x2, p.y2], p.closed === true), artLook(p));
  },
  /* create.rs:310-320 spiral：radius 必填；decay 缺省 80；segments as_u64 缺省 10 夹 2..1000；clockwise 缺省 true */
  spiral(p){
    const e = reqNums(p, ['cx', 'cy', 'radius'], 'spiral.create'); if (e) return e;
    const decay = fin(p.decay) ? p.decay : 80;
    const seg = Math.min(1000, Math.max(2, asU64(p.segments) === null ? 10 : p.segments));
    const cw = typeof p.clockwise === 'boolean' ? p.clockwise : true;
    return Object.assign(Geom.spiral([p.cx, p.cy], p.radius, decay, seg, cw), artLook(p));
  },
  /* create.rs:348-353 rect_grid：rows／columns as_u64 缺省 5、最多 999；frame 永远 true */
  rectgrid(p){
    const r = rectOf(p, 'rectgrid.create'); if (r.ok === false) return r;
    const rows = Math.min(999, asU64(p.rows) === null ? 5 : p.rows), cols = Math.min(999, asU64(p.columns) === null ? 5 : p.columns);
    const look = gridLook(p);
    return group(Geom.rectangularGrid(r, rows, cols, true).map(s => Object.assign(s, look)), p.name);
  },
  /* create.rs:355-360 polar_grid */
  polargrid(p){
    const r = rectOf(p, 'polargrid.create'); if (r.ok === false) return r;
    const c = Math.min(999, asU64(p.concentric) === null ? 5 : p.concentric), rad = Math.min(999, asU64(p.radial) === null ? 5 : p.radial);
    const look = gridLook(p);
    return group(Geom.polarGrid(r, c, rad).map(s => Object.assign(s, look)), p.name);
  }
};

/* ═════════════ 量尺寸小框（lib.rs size_label、canvas.rs 画在游标右下 14px；跟星形工具同一种画法） ═════════════ */
function drawMeasure(ctx, s, at, w, h){
  const dpr = s / zoom();
  const lines = [`W: ${w.toFixed(2)} px`, `H: ${h.toFixed(2)} px`];
  ctx.save();
  ctx.font = `${11 * dpr}px sans-serif`; ctx.textBaseline = 'top';
  const tw = Math.max(...lines.map(t => ctx.measureText(t).width));
  const x = at[0] * s + 14 * dpr, y = at[1] * s + 14 * dpr, bw = tw + 12 * dpr, bh = lines.length * 13 * dpr + 8 * dpr;
  ctx.fillStyle = 'rgba(64,64,64,0.92)';
  if (ctx.roundRect){ ctx.beginPath(); ctx.roundRect(x, y, bw, bh, 3 * dpr); ctx.fill(); } else ctx.fillRect(x, y, bw, bh);
  ctx.fillStyle = '#fff';
  lines.forEach((t, i) => ctx.fillText(t, x + 6 * dpr, y + 4 * dpr + i * 13 * dpr));
  ctx.restore();
}

/* ═════════════ 小对话框（星形／直线段那种样式；栏位：{key, label, value, kind:'num'|'check'|'radio', choices?}） ═════════════ */
const Dialog = {
  el: null,
  open(title, fields, onOk){
    this.close();
    const T = k => Lang.t(k);
    const bg = document.createElement('div');
    bg.id = 'aiFamilyDialog';
    bg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;z-index:9999';
    const box = document.createElement('div');
    box.style.cssText = 'background:#2b2f36;color:#e6e8eb;padding:14px 18px;border-radius:6px;min-width:260px;max-height:90vh;overflow:auto;font:13px sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)';
    const h = document.createElement('div'); h.textContent = title; h.style.cssText = 'font-weight:bold;margin-bottom:10px'; box.appendChild(h);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:auto 120px;gap:7px 10px;align-items:center';
    const F = {};
    const inStyle = 'width:100%;box-sizing:border-box;background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:3px 6px';
    fields.forEach(f => {
      const l = document.createElement('span'); l.textContent = T(f.label); l.style.color = '#aab0ba';
      let inp;
      if (f.kind === 'check'){ inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!f.value; }
      else if (f.kind === 'radio'){
        inp = document.createElement('select'); inp.style.cssText = inStyle;
        f.choices.forEach(([v, lab]) => { const o = document.createElement('option'); o.value = v; o.textContent = T(lab); inp.appendChild(o); });
        inp.value = f.value;
      } else { inp = document.createElement('input'); inp.type = 'number'; inp.value = f.value; inp.style.cssText = inStyle; }
      inp.name = f.key;
      grid.appendChild(l); grid.appendChild(inp); F[f.key] = inp;
    });
    box.appendChild(grid);
    const row = document.createElement('div'); row.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px';
    const bNo = document.createElement('button'); bNo.textContent = T('ui.afCancel'); bNo.dataset.act = 'cancel'; bNo.name = 'cancel';
    const bOk = document.createElement('button'); bOk.textContent = T('ui.afOk'); bOk.dataset.act = 'ok'; bOk.name = 'ok';
    row.appendChild(bNo); row.appendChild(bOk); box.appendChild(row);
    bg.appendChild(box); document.body.appendChild(bg);
    this.el = bg;
    const values = () => {
      const v = {};
      fields.forEach(f => {
        const i = F[f.key];
        if (f.kind === 'check') v[f.key] = i.checked;
        else if (f.kind === 'radio') v[f.key] = i.value;
        else { const n = parseFloat(i.value); v[f.key] = isFinite(n) ? n : f.value; }   // d.f64(key, 预设)
      });
      return v;
    };
    const ok = () => { const v = values(); this.close(); onOk(v); if (window.UI) UI.draw(); };
    const no = () => { this.close(); if (window.UI) UI.draw(); };
    bOk.onclick = e => { e.stopPropagation(); ok(); };
    bNo.onclick = e => { e.stopPropagation(); no(); };
    bg.addEventListener('pointerdown', e => { if (e.target === bg){ e.stopPropagation(); no(); } });
    bg.addEventListener('keydown', e => {
      e.stopPropagation();                                      // 对话框开着时按键不漏给画板快捷键
      if (e.key === 'Enter'){ e.preventDefault(); ok(); }
      else if (e.key === 'Escape'){ e.preventDefault(); no(); }
    });
    const first = fields.findIndex(f => f.kind !== 'check' && f.kind !== 'radio' && !f.skipFocus);
    if (first >= 0){ const i = F[fields[first].key]; i.focus(); i.select(); }
    else bOk.focus();
  },
  close(){ if (this.el){ this.el.remove(); this.el = null; } },
  isOpen(){ return !!this.el; }
};

/* ═════════════ FamilyTool（family.rs）：一颗工具一个实例 ═════════════ */
/* family.rs:28-49 预设、settings.rs 要记住的键 */
const DEFAULTS = {
  arc:      {closed:false},
  spiral:   {decay:80, segments:10, clockwise:true},
  rectgrid: {rows:5, columns:5},
  polargrid:{concentric:5, radial:5}
};
const LABEL = {arc:'Arc', spiral:'Spiral', rectgrid:'Rectangular Grid', polargrid:'Polar Grid'};   // family.rs:51-58 label（历史名）

function makeFamily(id){
  const T = {
    id,
    opts: Object.assign({}, DEFAULTS[id]),
    start: null, last: [0, 0], mods: {shift:false, alt:false}, began: false,
    preview: null,                   // 最后一次 Action::Preview 的命令参数（放开＝Commit 就照它落地）
    _optEls: {},

    /* settings.rs：存进偏好（localStorage），换工具／重开都还在 */
    load(){
      try { const s = localStorage.getItem('dilin.' + id + '.opts'); if (s){ const o = JSON.parse(s); Object.keys(DEFAULTS[id]).forEach(k => { if (o[k] !== undefined) this.setOption(k, o[k], true); }); } } catch(e){}
    },
    save(){ try { localStorage.setItem('dilin.' + id + '.opts', JSON.stringify(this.opts)); } catch(e){} },
    /* family.rs:205-215 set_option（同样的夹限；rows／concentric、columns／radial 是同一格） */
    setOption(key, v, quiet){
      const o = this.opts;
      if (key === 'closed' && id === 'arc') o.closed = typeof v === 'boolean' ? v : o.closed;
      else if (key === 'decay' && id === 'spiral') o.decay = Math.min(150, Math.max(5, fin(v) ? v : o.decay));
      else if (key === 'segments' && id === 'spiral') o.segments = Math.min(1000, Math.max(2, asU64(v) === null ? 10 : v));
      else if (key === 'clockwise' && id === 'spiral') o.clockwise = typeof v === 'boolean' ? v : o.clockwise;
      else if ((key === 'rows' || key === 'concentric') && (id === 'rectgrid' || id === 'polargrid')) o[id === 'rectgrid' ? 'rows' : 'concentric'] = Math.min(999, asU64(v) === null ? 5 : v);
      else if ((key === 'columns' || key === 'radial') && (id === 'rectgrid' || id === 'polargrid')) o[id === 'rectgrid' ? 'columns' : 'radial'] = Math.min(999, asU64(v) === null ? 5 : v);
      else return false;
      if (!quiet) this.save();
      this.syncOpt();
      return true;
    },
    options(){ return Object.assign({}, this.opts); },        // family.rs:197-204
    syncOpt(){
      Object.entries(this._optEls).forEach(([k, el]) => {
        if (!el || document.activeElement === el) return;
        if (el.type === 'checkbox') el.checked = !!this.opts[k]; else el.value = this.opts[k];
      });
    },
    rows(){ return id === 'rectgrid' ? this.opts.rows : this.opts.concentric; },
    cols(){ return id === 'rectgrid' ? this.opts.columns : this.opts.radial; },
    setRows(n){ this.setOption(id === 'rectgrid' ? 'rows' : 'concentric', n); },
    setCols(n){ this.setOption(id === 'rectgrid' ? 'columns' : 'radial', n); },

    /* family.rs:60-67 rect：Shift＝取 |dx|、|dy| 大的那个当两轴（保留方向）；Alt＝以按下点为中心 */
    rect(start, p, m){
      let dx = p[0] - start[0], dy = p[1] - start[1];
      if (m.shift){ const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = s * sgn(dx); dy = s * sgn(dy); }
      return m.alt ? rectAbs(start[0] - dx, start[1] - dy, start[0] + dx, start[1] + dy) : rectAbs(start[0], start[1], start[0] + dx, start[1] + dy);
    },
    /* family.rs:69-103 command：一次拖曳 → 那条命令的参数 */
    command(start, p, m, over){
      const o = Object.assign({}, this.opts, over || {});
      if (id === 'spiral'){
        const r = Math.max(Math.hypot(p[0] - start[0], p[1] - start[1]), 0.01);
        return {cx:start[0], cy:start[1], radius:r, decay:o.decay, segments:o.segments, clockwise:o.clockwise};
      }
      if (id === 'rectgrid'){ const r = this.rect(start, p, m); return {x:r.x0, y:r.y0, width:r.x1 - r.x0, height:r.y1 - r.y0, rows:o.rows, columns:o.columns}; }
      if (id === 'polargrid'){ const r = this.rect(start, p, m); return {x:r.x0, y:r.y0, width:r.x1 - r.x0, height:r.y1 - r.y0, concentric:o.concentric, radial:o.radial}; }
      // arc：Shift 两轴等长；Alt＝a＝start−d、b＝start＋d
      let dx = p[0] - start[0], dy = p[1] - start[1];
      if (m.shift){ const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = s * sgn(dx); dy = s * sgn(dy); }
      const a = m.alt ? [start[0] - dx, start[1] - dy] : [start[0], start[1]], b = [start[0] + dx, start[1] + dy];
      return {x1:a[0], y1:a[1], x2:b[0], y2:b[1], closed:o.closed};
    },

    /* ── 滑鼠：family.rs:113-144 pointer ── */
    down(e, pt){
      // Down：start＝snap_draw(pos)（智能参考线；借直线段工具的 lineSnapDraw，开关同 ToolState.smartGuides）
      let p = [pt[0], pt[1]];
      if (typeof window.lineSnapDraw === 'function') p = window.lineSnapDraw(p, ToolState.smartGuides !== false).p;
      this.start = p; this.last = p.slice(); this.began = false; this.preview = null;
    },
    move(e, pt){
      if (!this.start) return false;
      this.last = [pt[0], pt[1]];
      this.mods = {shift:!!e.shiftKey, alt:!!e.altKey};
      if (!this.began){
        if (Math.hypot(pt[0] - this.start[0], pt[1] - this.start[1]) < tol(2)) return false;
        this.began = true;                                       // Action::Begin(label)
      }
      this.preview = this.command(this.start, this.last, this.mods);   // Action::Preview
      return true;
    },
    up(){
      const s = this.start; if (!s) return;
      this.start = null;
      if (this.began){
        this.began = false;
        const c = this.preview; this.preview = null;
        if (c) CMD.run(id + '.create', c);                      // Action::Commit：最后那次预览落地，一步历史
      } else {
        this.preview = null;
        this.openDialog(s[0], s[1]);                             // Action::Dialog(id, {x, y})
      }
    },
    /* family.rs:145-184 key：只在 began 时有反应 */
    key(e){
      if (!this.start || !this.began) return false;
      const k = e.key;
      let changed = false;
      if (id === 'spiral' && k === 'ArrowUp'){ this.setOption('segments', Math.min(this.opts.segments + 1, 1000)); changed = true; }
      else if (id === 'spiral' && k === 'ArrowDown'){ this.setOption('segments', Math.max(this.opts.segments - 1, 2)); changed = true; }
      else if ((id === 'rectgrid' || id === 'polargrid') && k === 'ArrowUp'){ this.setRows(Math.min(this.rows() + 1, 999)); changed = true; }
      else if ((id === 'rectgrid' || id === 'polargrid') && k === 'ArrowDown'){ this.setRows(Math.max(this.rows() - 1, 0)); changed = true; }
      else if ((id === 'rectgrid' || id === 'polargrid') && k === 'ArrowRight'){ this.setCols(Math.min(this.cols() + 1, 999)); changed = true; }
      else if ((id === 'rectgrid' || id === 'polargrid') && k === 'ArrowLeft'){ this.setCols(Math.max(this.cols() - 1, 0)); changed = true; }
      if (changed){
        e.preventDefault();
        this.preview = this.command(this.start, this.last, this.mods);
        return true;
      }
      if (k === 'Escape'){ this.cancel(); return true; }      // Action::Cancel
      return false;
    },
    cancel(){ this.start = null; this.began = false; this.preview = null; },

    /* 点一下的对话框（原码没有·照 AI 2020 写；只收命令有的参数） */
    openDialog(x, y){
      const t = 'tool.' + id;
      if (id === 'arc'){
        // AI 2020「弧线段工具选项」：X 轴长度、Y 轴长度、类型（开放／闭合）；参考点＝点下去那点（左上），终点＝(x+X, y+Y)
        Dialog.open(Lang.t(t) + ' ' + Lang.t('ui.afOptions'), [
          {key:'lengthX', label:'ui.afLenX', value:100}, {key:'lengthY', label:'ui.afLenY', value:100},
          {key:'closed', label:'opt.arcClosed', value:this.opts.closed, kind:'check'}
        ], v => CMD.run('arc.create', {x1:x, y1:y, x2:x + v.lengthX, y2:y + v.lengthY, closed:!!v.closed}));
      } else if (id === 'spiral'){
        // AI 2020「螺旋线」：半径、衰减、段数、样式（顺／逆时针）；点下去那点＝中心
        Dialog.open(Lang.t(t), [
          {key:'radius', label:'ui.afRadius', value:50}, {key:'decay', label:'opt.spDecay', value:this.opts.decay},
          {key:'segments', label:'opt.spSegments', value:this.opts.segments},
          {key:'clockwise', label:'opt.spCw', value:this.opts.clockwise, kind:'check'}
        ], v => CMD.run('spiral.create', {cx:x, cy:y, radius:v.radius, decay:v.decay, segments:toU(v.segments), clockwise:!!v.clockwise}));
      } else {
        // AI 2020「矩形网格工具选项」／「极坐标网格工具选项」：宽、高、两种分隔线数；参考点＝点下去那点（左上）
        const grid = id === 'rectgrid';
        Dialog.open(Lang.t(t) + ' ' + Lang.t('ui.afOptions'), [
          {key:'width', label:'ui.afW', value:100}, {key:'height', label:'ui.afH', value:100},
          {key:'a', label:grid ? 'opt.rgRows' : 'opt.pgConc', value:this.rows()},
          {key:'b', label:grid ? 'opt.rgCols' : 'opt.pgRad', value:this.cols()}
        ], v => CMD.run(id + '.create', grid ? {x, y, width:v.width, height:v.height, rows:toU(v.a), columns:toU(v.b)}
                                              : {x, y, width:v.width, height:v.height, concentric:toU(v.a), radial:toU(v.b)}));
      }
    },

    /* 叠画：预览＝把这条命令画出来（用真的外观），加量尺寸小框（family.rs:185-193） */
    overlay(ctx, s){
      const p = this.preview;
      if (!p || !this.began || !this.start) return;
      const sh = Build[id](Object.assign({}, p));
      if (sh && sh.ok !== false){ try { drawShape(ctx, sh, s); } catch(e){} }
      drawMeasure(ctx, s, this.last, Math.abs(this.last[0] - this.start[0]), Math.abs(this.last[1] - this.start[1]));
    }
  };
  T.load();
  return T;
}

/* 一颗工具的命令＋Tools.reg（四颗都走这里；各自的档只叫 AiFamily.install(id)） */
const PARAMS = {
  arc:      ['{x1, y1, x2, y2 起点与终点（文件坐标）, closed=false 闭合（多一个直角点 (x1,y2)）, fill?, stroke?, strokeWidth?, layerId?}',
             '＝VectorCraft shape.arc：四分之一椭圆弧，从 (x1,y1) 鼓向 (x2,y1) 那角、到 (x2,y2)；外观＝目前填色＋描边 → {ok, id, layerId}',
             '{x0, y0 按下点, x1, y1 放开点, shift=false 两轴等长, alt=false 以按下点为中心, closed?=工具选项, …外观}'],
  spiral:   ['{cx, cy 中心, radius 半径, decay=80 衰减 %（实际夹 5..99.99）, segments=10 段数（每段 1/4 圈，2..1000）, clockwise=true, fill?, stroke?, strokeWidth?, layerId?}',
             '＝VectorCraft shape.spiral：从中心那端开始的螺旋线；外观＝目前填色＋描边 → {ok, id, layerId}',
             '{x0, y0 按下点＝中心, x1, y1 放开点（半径＝距离）, decay?, segments?, clockwise?（缺＝工具选项）, …外观}'],
  rectgrid: ['{x, y, width, height（负数会翻正）, rows=5 横分隔线数（0..999）, columns=5 直分隔线数（0..999）, stroke?, strokeWidth?, layerId?}',
             '＝VectorCraft shape.rectangularGrid：编组＝rows 条横线＋columns 条直线＋外框矩形；每条填色无、描边＝目前描边（描边为无＝黑 1px，我们加的）→ {ok, id, layerId}',
             '{x0, y0 按下点, x1, y1 放开点, shift=false 正方, alt=false 以按下点为中心, rows?, columns?（缺＝工具选项）, …外观}'],
  polargrid:['{x, y, width, height, concentric=5 同心圆分隔线数（0..999，画 concentric+1 个椭圆）, radial=5 径向分隔线数（0..999，至少画 1 条）, stroke?, strokeWidth?, layerId?}',
             '＝VectorCraft shape.polarGrid：编组＝同心椭圆＋从中心出去的线（第一条朝正上）；每条填色无、描边＝目前描边（描边为无＝黑 1px）→ {ok, id, layerId}',
             '{x0, y0 按下点, x1, y1 放开点, shift=false 正圆, alt=false 以按下点为中心, concentric?, radial?（缺＝工具选项）, …外观}']
};
const OPTKEYS = {arc:['closed'], spiral:['decay', 'segments', 'clockwise'], rectgrid:['rows', 'columns'], polargrid:['concentric', 'radial']};
const LOOK_KEYS = ['fill', 'stroke', 'strokeWidth', 'layerId', 'name'];

const STRINGS = {
  'zh-Hant':{
    'tool.arc':'弧形工具', 'tool.spiral':'螺旋工具', 'tool.rectgrid':'矩形格線工具', 'tool.polargrid':'放射網格工具',
    'opt.arcClosed':'封閉', 'opt.spDecay':'衰減 %', 'opt.spSegments':'區段', 'opt.spCw':'順時針',
    'opt.rgRows':'水平分隔線', 'opt.rgCols':'垂直分隔線', 'opt.pgConc':'同心圓分隔線', 'opt.pgRad':'放射狀分隔線',
    'ui.afOk':'確定', 'ui.afCancel':'取消', 'ui.afOptions':'選項', 'ui.afLenX':'X 軸長度', 'ui.afLenY':'Y 軸長度', 'ui.afRadius':'半徑', 'ui.afW':'寬度', 'ui.afH':'高度',
    'ui.arcHint':'拖＝畫弧（Shift 兩軸等長、Alt 從中心）· Esc 取消 · 點一下＝輸入數值',
    'ui.spiralHint':'拖＝從中心畫（半徑＝拖的距離）· 拖時 ↑↓ 增減區段、Esc 取消 · 點一下＝輸入數值',
    'ui.rgHint':'拖＝畫格線（Shift 正方、Alt 從中心）· 拖時 ↑↓ 水平分隔線、←→ 垂直分隔線、Esc 取消 · 點一下＝輸入數值',
    'ui.pgHint':'拖＝畫放射網格（Shift 正圓、Alt 從中心）· 拖時 ↑↓ 同心圓、←→ 放射線、Esc 取消 · 點一下＝輸入數值'
  },
  'zh-Hans':{
    'tool.arc':'弧形工具', 'tool.spiral':'螺旋线工具', 'tool.rectgrid':'矩形网格工具', 'tool.polargrid':'极坐标网格工具',
    'opt.arcClosed':'闭合', 'opt.spDecay':'衰减 %', 'opt.spSegments':'段数', 'opt.spCw':'顺时针',
    'opt.rgRows':'水平分隔线', 'opt.rgCols':'垂直分隔线', 'opt.pgConc':'同心圆分隔线', 'opt.pgRad':'径向分隔线',
    'ui.afOk':'确定', 'ui.afCancel':'取消', 'ui.afOptions':'选项', 'ui.afLenX':'X 轴长度', 'ui.afLenY':'Y 轴长度', 'ui.afRadius':'半径', 'ui.afW':'宽度', 'ui.afH':'高度',
    'ui.arcHint':'拖＝画弧（Shift 两轴等长、Alt 从中心）· Esc 取消 · 点一下＝输入数值',
    'ui.spiralHint':'拖＝从中心画（半径＝拖的距离）· 拖时 ↑↓ 增减段数、Esc 取消 · 点一下＝输入数值',
    'ui.rgHint':'拖＝画网格（Shift 正方、Alt 从中心）· 拖时 ↑↓ 水平分隔线、←→ 垂直分隔线、Esc 取消 · 点一下＝输入数值',
    'ui.pgHint':'拖＝画极坐标网格（Shift 正圆、Alt 从中心）· 拖时 ↑↓ 同心圆、←→ 径向线、Esc 取消 · 点一下＝输入数值'
  },
  'en':{
    'tool.arc':'Arc Tool', 'tool.spiral':'Spiral Tool', 'tool.rectgrid':'Rectangular Grid Tool', 'tool.polargrid':'Polar Grid Tool',
    'opt.arcClosed':'Closed', 'opt.spDecay':'Decay %', 'opt.spSegments':'Segments', 'opt.spCw':'Clockwise',
    'opt.rgRows':'Horizontal Dividers', 'opt.rgCols':'Vertical Dividers', 'opt.pgConc':'Concentric Dividers', 'opt.pgRad':'Radial Dividers',
    'ui.afOk':'OK', 'ui.afCancel':'Cancel', 'ui.afOptions':'Options', 'ui.afLenX':'Length X-Axis', 'ui.afLenY':'Length Y-Axis', 'ui.afRadius':'Radius', 'ui.afW':'Width', 'ui.afH':'Height',
    'ui.arcHint':'Drag to draw an arc (Shift: equal axes, Alt: from the centre) · Esc cancels · Click for exact values',
    'ui.spiralHint':'Drag from the centre (radius = drag distance) · while dragging ↑↓ change segments, Esc cancels · Click for exact values',
    'ui.rgHint':'Drag to draw a grid (Shift: square, Alt: from the centre) · while dragging ↑↓ rows, ←→ columns, Esc cancels · Click for exact values',
    'ui.pgHint':'Drag to draw a polar grid (Shift: circle, Alt: from the centre) · while dragging ↑↓ concentric, ←→ radial, Esc cancels · Click for exact values'
  }
};
if (typeof Lang !== 'undefined') Lang.add(STRINGS);
const HINT = {arc:'ui.arcHint', spiral:'ui.spiralHint', rectgrid:'ui.rgHint', polargrid:'ui.pgHint'};
const ORDER = {arc:51, spiral:52, rectgrid:53, polargrid:54};

const tools = {};
function install(id){
  if (tools[id]) return tools[id];
  const T = makeFamily(id);
  tools[id] = T;
  const [pCreate, dCreate, pDrag] = PARAMS[id];
  CMD.reg(id + '.create', {i18n:'', undoable:true, params:pCreate + ' 文件坐标。' + dCreate}, p => {
    p = p || {};
    const sh = Build[id](Object.assign({}, p));
    if (!sh || sh.ok === false) return sh;
    return place(sh, p);
  });
  CMD.reg(id + '.drag', {i18n:'', undoable:true,
    params:pDrag + ' 文件坐标。＝拿' + LABEL[id] + '工具从 (x0,y0) 拖到 (x1,y1) 放开（family.rs command）→ {ok, id, layerId}'}, p => {
    p = p || {};
    if (![p.x0, p.y0, p.x1, p.y1].every(fin)) return {ok:false, error:id + '.drag: x0,y0,x1,y1 are required numbers'};
    const over = {};
    OPTKEYS[id].forEach(k => { if (p[k] !== undefined) over[k] = p[k]; });
    const c = T.command([p.x0, p.y0], [p.x1, p.y1], {shift:!!p.shift, alt:!!p.alt}, over);
    LOOK_KEYS.forEach(k => { if (p[k] !== undefined) c[k] = p[k]; });
    const sh = Build[id](c);
    if (!sh || sh.ok === false) return sh;
    return Object.assign(place(sh, c), {params:c});
  });
  CMD.reg(id + '.setOption', {i18n:'',
    params:'{' + OPTKEYS[id].join(', ') + '}（都可不给＝只读）' + LABEL[id] + ' 工具选项（settings.rs 记住的那几项；夹限照 family.rs set_option）→ 目前选项'}, p => {
    p = p || {};
    OPTKEYS[id].forEach(k => { if (p[k] !== undefined) T.setOption(k, p[k]); });
    return T.options();
  });

  Tools.reg({
    id, icon:'◠', group:'vector', order:ORDER[id], for:'vector', needs:'vector', opts:[], cursor:'crosshair',
    hint:HINT[id], strings:STRINGS,
    onDown(e, pt){ if (e.button !== undefined && e.button !== 0) return; T.down(e, pt); },
    onMove(e, pt, P){ if (!P.down) return; if (T.move(e, pt)) UI.draw(); },
    onUp(){ T.up(); UI.draw(); },
    onKey(e){ const r = T.key(e); if (r) UI.draw(); return r; },
    onDeactivate(){ T.cancel(); Dialog.close(); },
    buildOptions(box, add, mk){
      T._optEls = {};
      const num = (k, lab, min, max, step) => {
        const n = mk('number', {min, max, step:step || 1, value:T.opts[k]});
        n.style.width = '64px';
        n.onchange = () => { CMD.run(id + '.setOption', {[k]:step ? +n.value : toU(n.value)}); n.value = T.opts[k]; };
        T._optEls[k] = n; add(lab, n);
      };
      const chk = (k, lab) => {
        const c = mk('checkbox', {checked:!!T.opts[k]});
        c.onchange = () => CMD.run(id + '.setOption', {[k]:c.checked});
        T._optEls[k] = c; add(lab, c);
      };
      if (id === 'arc') chk('closed', 'arcClosed');
      else if (id === 'spiral'){ num('decay', 'spDecay', 5, 150, 0.5); num('segments', 'spSegments', 2, 1000); chk('clockwise', 'spCw'); }
      else if (id === 'rectgrid'){ num('rows', 'rgRows', 0, 999); num('columns', 'rgCols', 0, 999); }
      else { num('concentric', 'pgConc', 0, 999); num('radial', 'pgRad', 0, 999); }
    },
    drawOverlay(ctx, s){ T.overlay(ctx, s); }
  });
  return T;
}

window.AiFamily = {Geom, Build, Dialog, drawMeasure, install, tools, FEEDBACK, KAPPA, place, group, artLook, tol, fin, asU64, toU};
install('arc');
})();
