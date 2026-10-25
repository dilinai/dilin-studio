/* 矩形（U）——逐段照抄 VectorCraft 的 ShapeTool（id = rectangle／roundedRectangle；我们这颗带圆角选项，等于两颗合一：
   圆角 = 0 时照 rectangle 走，> 0 时照 roundedRectangle 走）
   对照源（行号以 vectorcraft/crates 为根）：
   - tools/src/shape.rs                工具状态机：按下／拖曳／放开／↑↓／Esc／叠画（drag_rect、command、pointer、key、overlays）
   - tools/src/guides.rs               snap_draw ＝ 智能参考线吸附（VectorCraft 预设开）：锚点、中心、物件边、画板边
   - tools/src/lib.rs                  tol(px) ＝ 屏幕像素换文件单位；size_label「W: …\nH: …」；Overlay 种类
   - ui-egui/src/shortcuts.rs          拖着（busy）时只有 ↑↓（不带 Ctrl）、Esc 进工具，其余快捷键一律不响应
   - ui-egui/src/dialogs/tools.rs, shapes.rs, form.rs, state.rs   点一下（没拖）＝ 尺寸对话框，确定后在点下处画
   - engine/src/cmd/create.rs          shape.rectangle：rect_of 取正、radius ≥ 0
   - geom/src/shapes.rs                rounded_rectangle：圆角夹在短边一半；4／8 个锚点（吸附用）
   - doc/src/lib.rs                    Unit::parse ＝ parse_measure：栏位可打 10+5、100/2、3*2、1in、2p6
   - ui-egui/src/canvas.rs             Overlay::Line／Label／Measure 的画法与位移；theme.rs measure_bg
   builder.rs 是「形状建立程式」工具，跟矩形工具无关，读过、不抄。 */

/* Rust f64::signum：+0 也算 1（JS 的 Math.sign(0) 是 0，照抄会让 Shift 在一边为 0 时变成扁的） */
function rectSignum(v){ return (v > 0 || Object.is(v, 0)) ? 1 : -1; }

/* shape.rs:97-104 drag_rect：从 start 拖到 p 画出的矩形；Shift ＝ 正方形（取两边较长者、各保留自己的方向），Alt ＝ 从中心画 */
function rectDragRect(start, p, m){
  let dx = p[0] - start[0], dy = p[1] - start[1];
  if (m && m.shift){
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = s * rectSignum(dx); dy = s * rectSignum(dy);
  }
  // Rect::from_points(a, b)：两角取 min／max
  const a = (m && m.alt) ? [start[0] - dx, start[1] - dy] : [start[0], start[1]];
  const b = [start[0] + dx, start[1] + dy];
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
}

/* ── doc/src/lib.rs:130-283 Unit::parse ＝ parse_measure（我们的文件单位是 px，跟 Rust 的 pt 一样都是 1） ── */
const RECT_UNITS = { pt:1, px:1, in:72, '"':72, mm:72/25.4, cm:72/2.54, m:72/0.0254, ft:72*12, "'":72*12, yd:72*36, p:12, pc:12 };
/* Rust str::parse::<f64>()：可带正负号、小数点、指数，或 inf／infinity／nan */
function rectRustF64(s){
  if (!/^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?|inf|infinity|nan)$/i.test(s)) return null;
  const t = s.replace(/^[+-]/, '').toLowerCase(), neg = s[0] === '-';
  if (t === 'inf' || t === 'infinity') return neg ? -Infinity : Infinity;
  if (t === 'nan') return NaN;
  return parseFloat(s);
}
/* number_unit：数字＋可有可无的单位（12、3 mm、2in）→ {v, k: 该单位每单位几 pt | null} */
function rectNumberUnit(s){
  s = s.trim();
  let end = 0;
  while (end < s.length && /[0-9.\-]/.test(s[end])) end++;
  const v = rectRustF64(s.slice(0, end).trim());
  if (v == null) return null;
  const u = s.slice(end).trim();
  if (u === '') return {v, k:null};
  if (!Object.prototype.hasOwnProperty.call(RECT_UNITS, u)) return null;
  return {v, k:RECT_UNITS[u]};
}
function rectParseMeasure(s, defK){
  s = s.trim();
  // 右边的四则运算（Illustrator 栏位可打 "10+5"、"100/2"、"3in*2"）
  for (const op of ['+', '-', '*', '/']){
    const skip = s.length ? String.fromCodePoint(s.codePointAt(0)).length : 0;   // 跳过第一个字元：开头的负号不是运算子
    let i = s.slice(skip).lastIndexOf(op);
    if (i < 0) continue;
    i += skip;
    const l = s.slice(0, i), r = s.slice(i + 1);
    if (!l.trim()) continue;
    if (op === '+' || op === '-'){
      const a = rectParseMeasure(l, defK), b = rectParseMeasure(r, defK);
      if (a == null || b == null) return null;
      return op === '+' ? a + b : a - b;
    }
    // 乘数／除数是纯数字；它后面的单位是整个算式的单位（"1080/2 px"）
    const nu = rectNumberUnit(r); if (!nu) return null;
    const a = rectParseMeasure(l, nu.k == null ? defK : nu.k); if (a == null) return null;
    if (op === '*') return a * nu.v;
    return nu.v === 0 ? null : a / nu.v;
  }
  // 派卡：2p6 ＝ 2×12＋6 pt
  const pi = s.indexOf('p');
  if (pi >= 0){
    const p = s.slice(0, pi), pt = s.slice(pi + 1);
    if (p !== '' && rectRustF64(p.trim()) != null && (pt === '' || rectRustF64(pt.trim()) != null) && !s.endsWith('pt') && !s.endsWith('px')){
      const b = pt === '' ? null : rectRustF64(pt.trim());
      return rectRustF64(p.trim()) * 12 + (b == null ? 0 : b);        // NaN 会被 Unit::parse 的 is_finite 挡掉
    }
  }
  const nu = rectNumberUnit(s); if (!nu) return null;
  return nu.v * (nu.k == null ? defK : nu.k);
}
/* state.rs:188-194 Dialog::f64：数字原样；字串用 Unit::Points.parse（结果须是有限数），解析不了就用预设值 */
function rectF64(v, d){
  if (typeof v === 'number') return Number.isFinite(v) ? v : d;
  if (typeof v !== 'string') return d;
  const x = rectParseMeasure(v, 1);
  return (x == null || !Number.isFinite(x)) ? d : x;
}

/* kurbo bounding_box：一段三次贝兹的精确外框（端点＋导数为 0 的极值点） */
function rectCubicExtent(p0, c1, c2, p3, out){
  out.push(p0, p3);
  for (const k of [0, 1]){
    const A = p3[k] - 3*c2[k] + 3*c1[k] - p0[k], B = 2*(c2[k] - 2*c1[k] + p0[k]), C = c1[k] - p0[k];
    const ts = [];
    if (Math.abs(A) < 1e-12){ if (Math.abs(B) > 1e-12) ts.push(-C / B); }
    else {
      const D = B*B - 4*A*C;
      if (D >= 0){ const q = Math.sqrt(D); ts.push((-B + q) / (2*A), (-B - q) / (2*A)); }
    }
    for (const t of ts){
      if (!(t > 0 && t < 1)) continue;
      const u = 1 - t;
      out.push([0, 1].map(j => u*u*u*p0[j] + 3*u*u*t*c1[j] + 3*u*t*t*c2[j] + t*t*t*p3[j]));
    }
  }
}

/* 智能参考线（guides.rs:57-75）用的几何：某个 shape 的锚点（Path 的 anchors）与几何外框（geometric_bounds），换成文件坐标（加图层位移） */
function rectShapeGeom(s, ox, oy){
  const P = (x, y) => [x + ox, y + oy];
  let anchors = [];
  if (s.type === 'rect'){
    const x0 = Math.min(s.x, s.x + s.w), x1 = Math.max(s.x, s.x + s.w);
    const y0 = Math.min(s.y, s.y + s.h), y1 = Math.max(s.y, s.y + s.h);
    // shapes.rs:19-39 rounded_rectangle：rad 夹在短边一半，≤1e-9 就是 4 角（shapes.rs:13-16），否则 8 锚点
    const rad = Math.min(Math.max(s.radius || 0, 0), (x1 - x0) / 2, (y1 - y0) / 2);
    if (rad <= 1e-9) anchors = [P(x0,y0), P(x1,y0), P(x1,y1), P(x0,y1)];
    else anchors = [P(x0+rad,y0), P(x1-rad,y0), P(x1,y0+rad), P(x1,y1-rad), P(x1-rad,y1), P(x0+rad,y1), P(x0,y1-rad), P(x0,y0+rad)];
    return { anchors, bounds: {x0:x0+ox, y0:y0+oy, x1:x1+ox, y1:y1+oy} };
  }
  if (s.type === 'ellipse'){
    const cx = s.x + s.w/2, cy = s.y + s.h/2, rx = Math.abs(s.w/2), ry = Math.abs(s.h/2);
    anchors = [P(cx-rx,cy), P(cx,cy-ry), P(cx+rx,cy), P(cx,cy+ry)];          // shapes.rs:42-57 ellipse：左、上、右、下
    return { anchors, bounds: {x0:cx-rx+ox, y0:cy-ry+oy, x1:cx+rx+ox, y1:cy+ry+oy} };
  }
  let pts = [];
  if (s.type === 'star' || s.type === 'polygon'){
    // 顶点照我们 engine.js drawShape 的画法（跟 shapes.rs:60-84 同一套：第一个顶点朝上、逆时针前进）
    const n = s.points || (s.type === 'star' ? 5 : 6);
    const steps = s.type === 'star' ? n*2 : n, rot = (s.rotation||0)*Math.PI/180 - Math.PI/2;
    for (let i = 0; i < steps; i++){
      const r = (s.type === 'star' && i % 2) ? s.r2 : s.r1, a = rot + i*Math.PI*2/steps;
      pts.push(P(s.cx + Math.cos(a)*r, s.cy + Math.sin(a)*r));
    }
    anchors = pts;
  } else if (s.type === 'path' || s.type === 'line'){
    anchors = pts = (s.points || []).map(p => P(p[0], p[1]));
  } else if (s.type === 'bezier'){
    const A = s.anchors || [];
    anchors = A.map(a => P(a.x, a.y));
    // path.rs:368-379 bounds：只有一个锚点＝那一点；否则曲线本身的精确外框（不含把手）
    if (A.length === 1) pts = [anchors[0]];
    else {
      const seg = (p, q) => {
        const c1 = p.out || [p.x, p.y], c2 = q.in || [q.x, q.y];
        rectCubicExtent(P(p.x, p.y), P(c1[0], c1[1]), P(c2[0], c2[1]), P(q.x, q.y), pts);
      };
      for (let i = 1; i < A.length; i++) seg(A[i-1], A[i]);
      if (s.closed && A.length > 2) seg(A[A.length-1], A[0]);
    }
  } else return null;
  if (!pts.length) return null;                                            // 空路径：geometric_bounds＝None
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { anchors, bounds: {x0:Math.min(...xs), y0:Math.min(...ys), x1:Math.max(...xs), y1:Math.max(...ys)} };
}

const RectTool = {
  /* shape.rs:12-24 ShapeTool 的栏位（corner_radius 用我们共用的 ToolState.radius） */
  start: null,          // 按下点（已吸附）
  last: [0, 0],         // 最后一次拖曳点（已吸附）
  mods: {shift:false, alt:false},
  began: false,         // 拖超过 2 屏幕像素才算开始画（之前放开＝点一下）
  guides: [],           // 吸附时的品红参考线／标签
  smartGuides: true,    // ToolContext.smart_guides（lib.rs:477 预设开）
  dialog: null,

  tol(px){ return px / Math.max(UI.zoom, 1e-9); },          // lib.rs:261-263 ToolContext::tol
  busy(){ return !!this.start; },                            // shape.rs:110-112

  /* guides.rs:40-77 Targets::collect：画板（＝整张文件）＋每个形状。
     照抄：Rust 的 walk 只看「节点自己」的 visible，图层是容器、被跳过但还是会走进去，
     所以隐藏图层里的形状一样是吸附目标（我们的形状没有自己的 visible，等于全都看得见）。 */
  collectTargets(){
    const t = {points:[], xs:[], ys:[]};
    const addRect = (r, kind) => {
      const c = [(r.x0 + r.x1)/2, (r.y0 + r.y1)/2];
      for (const p of [[r.x0,r.y0], [r.x1,r.y0], [r.x1,r.y1], [r.x0,r.y1]]){
        t.xs.push([p[0], p, kind]); t.ys.push([p[1], p, kind]);
      }
      t.points.push([c, 'center']); t.xs.push([c[0], c, 'center']); t.ys.push([c[1], c, 'center']);
    };
    addRect({x0:0, y0:0, x1:Doc.width, y1:Doc.height}, 'artboard');
    let budget = 20000;
    for (const L of Doc.layers){
      if (L.kind !== 'vector') continue;
      for (const s of L.data.shapes){
        if (budget === 0) continue;
        const g = rectShapeGeom(s, L.x || 0, L.y || 0); if (!g) continue;
        for (const a of g.anchors){ t.points.push([a, 'anchor']); budget = Math.max(0, budget - 1); }
        addRect(g.bounds, 'edge');
      }
    }
    return t;
  },
  /* guides.rs:102-124 Targets::snap_point：先找最近的点（锚点／中心）；没有就 x、y 各自对齐 */
  snapPoint(t, p, tol){
    let best = null, bd = Infinity;
    for (const [q, k] of t.points){ const d = Math.hypot(q[0]-p[0], q[1]-p[1]); if (d <= tol && d < bd){ best = [q, k]; bd = d; } }
    if (best) return [[best[0][0], best[0][1]], [{type:'label', p:best[0], kind:best[1]}]];
    const out = [p[0], p[1]], ov = [];
    let bx = null, dx = Infinity;
    for (const e of t.xs){ const d = Math.abs(e[0]-p[0]); if (d <= tol && d < dx){ bx = e; dx = d; } }
    if (bx){ out[0] = bx[0]; ov.push({type:'line', a:bx[1], b:[bx[0], p[1]]}); }
    let by = null, dy = Infinity;
    for (const e of t.ys){ const d = Math.abs(e[0]-p[1]); if (d <= tol && d < dy){ by = e; dy = d; } }
    if (by){ out[1] = by[0]; ov.push({type:'line', a:by[1], b:[p[0], by[0]]}); }
    if (ov.length) ov.push({type:'label', p:out.slice(), kind:'align'});
    return [out, ov];
  },
  /* guides.rs:160-172 snap_draw：没开智能参考线就原样回（对齐像素／格点我们没有） */
  snapDraw(p){
    if (!this.smartGuides) return [[p[0], p[1]], []];
    return this.snapPoint(this.collectTargets(), p, this.tol(5));
  },

  /* shape.rs:61-92 command：这一拖要下的命令参数（我们的 shape.rect 用 w/h，并一律带 radius） */
  command(start, p, m){
    const r = rectDragRect(start, p, m);
    return {x:r.x, y:r.y, w:r.w, h:r.h, radius:ToolState.radius};
  },

  /* shape.rs:113-153 pointer() */
  down(e, pt){
    const [p] = this.snapDraw(pt);
    this.start = p; this.last = [pt[0], pt[1]]; this.began = false;   // Rust：last 记的是没吸附的 ev.pos
  },
  drag(e, pt){
    if (!this.start) return;
    const [pos, g] = this.snapDraw(pt);
    this.guides = g;
    this.last = pos;
    this.mods = {shift:!!e.shiftKey, alt:!!e.altKey};                  // 修饰键只在滑鼠动时更新（Rust 一样）
    if (!this.began){
      if (Math.hypot(pos[0]-this.start[0], pos[1]-this.start[1]) < this.tol(2)) return;
      this.began = true;                                                // Action::Begin("Rectangle")
    }
    // Action::Preview：预览在 drawOverlay 里按 start／last／mods 现算
  },
  up(){
    const s = this.start; if (!s) return;
    this.start = null; this.guides = [];
    if (this.began){
      this.began = false;
      // Action::Commit：留下最后一次预览＝最后一次拖曳点与当时的修饰键（不看放开那一下的位置）
      CMD.run('rect.drag', { x1:s[0], y1:s[1], x2:this.last[0], y2:this.last[1],
        shift:this.mods.shift, alt:this.mods.alt, radius:ToolState.radius,
        fill:UI.fill(), stroke:UI.stroke(), strokeWidth:UI.strokeW() });
    } else {
      this.openDialog(s[0], s[1]);                                      // Action::Dialog("rectangle"|"roundedRectangle", {x, y})
    }
  },
  /* shape.rs:154-193 key()：只在已经开始画时有反应；↑↓ 改圆角（roundedRectangle 段：+1／−1 不低于 0），Esc 取消 */
  key(e){
    if (!(this.start && this.began)) return false;
    const k = e.key;
    // shortcuts.rs:218-221：↑↓ 用 consume_key(Modifiers::NONE)——egui 不比 Shift／Alt，但带 Ctrl／⌘ 就不算
    if ((k === 'ArrowUp' || k === 'ArrowDown') && !(e.ctrlKey || e.metaKey)){
      e.preventDefault();
      const r = k === 'ArrowUp' ? ToolState.radius + 1 : Math.max(ToolState.radius - 1, 0);
      CMD.run('rect.setOption', {radius:r});                            // 会顺手刷新选项栏与画面（预览跟着变）
      return true;
    }
    if (k === 'Escape'){
      e.preventDefault();
      this.cancel(); UI.draw();                                         // Action::Cancel
      return true;
    }
    return false;
  },
  cancel(){ this.start = null; this.began = false; this.guides = []; },

  /* shape.rs:194-204 overlays()：开始画之后才有——吸附参考线＋游标旁的尺寸胶囊；外加预览本体（Rust 的 Preview 直接画进文件） */
  measureText(){
    const s = this.start || [0, 0];
    const dx = Math.abs(this.last[0] - s[0]), dy = Math.abs(this.last[1] - s[1]);   // 照抄：量的是 last−start，不是算出来的矩形
    // lib.rs:269 size_label ＋ doc/lib.rs:217 readout「{:.2} 单位」
    return `${Lang.t('ui.rectW')}: ${dx.toFixed(2)} px\n${Lang.t('ui.rectH')}: ${dy.toFixed(2)} px`;
  },
  previewShape(){
    if (!(this.start && this.began)) return null;
    const c = this.command(this.start, this.last, this.mods);
    return {type:'rect', x:c.x, y:c.y, w:c.w, h:c.h, radius:c.radius, fill:UI.fill(), stroke:UI.stroke(), strokeWidth:UI.strokeW()};
  },
  overlay(ctx, s){
    const sh = this.previewShape(); if (!sh) return;
    const dpr = s / Math.max(UI.zoom, 1e-9);
    ctx.save();
    const L = Doc.active();
    if (L && L.kind === 'vector') ctx.globalAlpha = L.opacity;
    drawShape(ctx, sh, s);                                              // 跟落定后同一支渲染函数
    ctx.restore();
    // 智能参考线：品红 #ff3dfc（guides.rs:10 MAGENTA），canvas.rs:1167-1183 线 1px，标签在点右上 (8,-14)、11px
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = '#ff3dfc'; ctx.lineWidth = dpr;
    ctx.font = `${11*dpr}px sans-serif`; ctx.textBaseline = 'top';
    for (const o of this.guides){
      if (o.type === 'line'){
        ctx.beginPath(); ctx.moveTo(o.a[0]*s, o.a[1]*s); ctx.lineTo(o.b[0]*s, o.b[1]*s); ctx.stroke();
      } else if (o.type === 'label'){
        ctx.fillText(Lang.t('ui.rectSnap.' + o.kind), o.p[0]*s + 8*dpr, o.p[1]*s - 14*dpr);
      }
    }
    ctx.restore();
    // canvas.rs:1188-1194 Overlay::Measure：游标右下 (14,14)，灰底 rgba(92,92,92,235)（theme.rs:120）圆角 3，白字 11px，内距 6/4
    const lines = this.measureText().split('\n');
    ctx.save();
    ctx.font = `${11*dpr}px sans-serif`; ctx.textBaseline = 'top';
    const lh = 13*dpr, tw = Math.max(...lines.map(t => ctx.measureText(t).width));
    const x = this.last[0]*s + 14*dpr, y = this.last[1]*s + 14*dpr;
    const w = tw + 12*dpr, h = lh*lines.length + 8*dpr;
    ctx.fillStyle = 'rgba(92,92,92,0.92)';
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, 3*dpr); else ctx.rect(x, y, w, h); ctx.fill();
    ctx.fillStyle = '#fff';
    lines.forEach((t, i) => ctx.fillText(t, x + 6*dpr, y + 4*dpr + i*lh));
    ctx.restore();
  },

  /* dialogs/tools.rs:14-15 open_tool_dialog：rectangle ＝ 宽 100、高 100；roundedRectangle 再多一格圆角。
     x、y 是点下处（form.rs:129 不显示）。圆角 = 0 走 rectangle、> 0 走 roundedRectangle（圆角格预填工具目前的圆角）。 */
  dialogOpen(){ return !!this.dialog; },
  openDialog(x, y){
    this.closeDialog();
    const rounded = ToolState.radius > 0;
    const back = document.createElement('div');
    back.id = 'rectDialog';
    back.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#2b2f36;color:#e6e8ec;border:1px solid #444a55;border-radius:6px;padding:14px 16px;min-width:240px;font:13px sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4)';
    const title = document.createElement('div');
    title.textContent = Lang.t(rounded ? 'ui.rectRounded' : 'tool.rect'); title.style.cssText = 'font-weight:600;margin-bottom:10px';
    box.appendChild(title);
    const fields = {};
    const row = (k, label, v) => {
      const l = document.createElement('label');
      l.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0';
      const sp = document.createElement('span'); sp.textContent = Lang.t(label); l.appendChild(sp);
      const inp = document.createElement('input'); inp.type = 'text'; inp.value = v; inp.dataset.k = k;
      inp.style.cssText = 'width:110px;background:#1d2026;color:#e6e8ec;border:1px solid #444a55;border-radius:3px;padding:3px 6px';
      l.appendChild(inp); box.appendChild(l); fields[k] = inp;
    };
    row('width', 'ui.rectDlgW', '100 px');
    row('height', 'ui.rectDlgH', '100 px');
    if (rounded) row('radius', 'opt.radius', ToolState.radius + ' px');
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px';
    const mkBtn = (key, fn) => { const b = document.createElement('button'); b.textContent = Lang.t(key); b.dataset.act = key; b.onclick = fn; bar.appendChild(b); return b; };
    // shapes.rs:23-46 confirm → shape.rectangle {x, y, width, height, radius}
    const ok = () => {
      const p = {x, y, width:fields.width.value, height:fields.height.value,
                 fill:UI.fill(), stroke:UI.stroke(), strokeWidth:UI.strokeW()};
      if (fields.radius) p.radius = fields.radius.value;
      this.closeDialog();
      CMD.run('rect.dialog', p);
    };
    mkBtn('ui.rectCancel', () => this.closeDialog());
    mkBtn('ui.rectOK', ok);
    box.appendChild(bar);
    // shortcuts.rs:135-143：对话框开着时 Esc 关掉、其余快捷键不响应；Enter ＝ OK（mod.rs:115）
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); ok(); }
      else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); this.closeDialog(); }
    });
    back.appendChild(box);
    back.addEventListener('pointerdown', e => e.stopPropagation());
    document.body.appendChild(back);
    this.dialog = {el:back, x, y};
    fields.width.focus(); fields.width.select();
  },
  closeDialog(){
    if (this.dialog){ this.dialog.el.remove(); this.dialog = null; }
    UI.draw();
  }
};
window.RectTool = RectTool;

/* ── 命令（agent 与滑鼠走同一条路） ── */
CMD.reg('rect.drag', {i18n:'', undoable:true,
  params:'{x1,y1 按下点, x2,y2 最后拖到的点（文件坐标）, shift?=false 正方形（取较长边）, alt?=false 以按下点为中心, radius?=工具圆角, fill?, stroke?, strokeWidth?, layerId?} → {id, layerId, rect}  ＝ 矩形工具拖一下（不吸附；要吸附请先自己算好点）'},
  p => {
    const r = rectDragRect([+p.x1, +p.y1], [+p.x2, +p.y2], {shift:!!p.shift, alt:!!p.alt});
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite)) return {ok:false, error:'invalid size'};
    const radius = Math.max(+(p.radius === undefined ? ToolState.radius : p.radius) || 0, 0);
    const o = {type:'rect', x:r.x, y:r.y, w:r.w, h:r.h, radius};
    ['fill', 'stroke', 'strokeWidth', 'layerId'].forEach(k => { if (p[k] !== undefined) o[k] = p[k]; });
    const res = addShape(o);
    return Object.assign({rect:r}, res);
  });
CMD.reg('rect.dialog', {i18n:'', undoable:true,
  params:'{x, y 左上角（文件坐标）, width=100, height=100, radius=0（三者可给数字或字串：可打算式如 "10+5"、"100/2"，可带单位 px/pt/in/mm/cm/p，派卡 "2p6"）, fill?, stroke?, strokeWidth?, layerId?} → {id, layerId}  ＝ 矩形工具点一下后的尺寸对话框按确定'},
  p => {
    const x = rectF64(p.x, 0), y = rectF64(p.y, 0);
    const w = rectF64(p.width, 100), h = rectF64(p.height, 100);
    const radius = Math.max(rectF64(p.radius, 0), 0);                   // create.rs:168 radius.max(0)
    // create.rs:155-164 rect_of：Rect::new(x, y, x+w, y+h).abs()
    const o = {type:'rect', x:Math.min(x, x+w), y:Math.min(y, y+h), w:Math.abs(w), h:Math.abs(h), radius};
    ['fill', 'stroke', 'strokeWidth', 'layerId'].forEach(k => { if (p[k] !== undefined) o[k] = p[k]; });
    return addShape(o);
  });
CMD.reg('rect.setOption', {i18n:'',
  params:'{radius? 圆角（≥0；0＝直角矩形）, smartGuides? 拖曳时吸附锚点／中心／边（预设 true）} → 目前选项；不给参数＝读  ＝ 矩形工具选项'},
  p => {
    // shape.rs:215 cornerRadius：as_f64 不了就 12，再夹到 ≥ 0
    if (p.radius !== undefined){ const v = +p.radius; ToolState.radius = Math.max(Number.isFinite(v) ? v : 12, 0); }
    if (p.smartGuides !== undefined) RectTool.smartGuides = !!p.smartGuides;
    if (ToolState.cur === 'rect' && window.UI) UI.buildOptions('rect');   // 选项栏的圆角数字跟着变
    return {radius:ToolState.radius, smartGuides:RectTool.smartGuides};
  });

Tools.reg({
  id:'rect', icon:'▢', key:'U', group:'vector', order:20, for:'vector', needs:'vector', opts:['radius'],
  hint:'ui.rectHint',
  strings:{
    'zh-Hant':{'ui.rectHint':'拖曳＝畫｜Shift＋拖＝正方形｜Alt＋拖＝從中心｜點一下＝輸入精確尺寸｜拖時 ↑↓ 改圓角、Esc 取消',
               'ui.rectW':'寬', 'ui.rectH':'高', 'ui.rectDlgW':'寬度', 'ui.rectDlgH':'高度', 'ui.rectOK':'確定', 'ui.rectCancel':'取消',
               'ui.rectRounded':'圓角矩形',
               'ui.rectSnap.anchor':'錨點', 'ui.rectSnap.center':'中心', 'ui.rectSnap.edge':'路徑', 'ui.rectSnap.artboard':'畫板', 'ui.rectSnap.align':'對齊'},
    'zh-Hans':{'ui.rectHint':'拖曳＝画｜Shift＋拖＝正方形｜Alt＋拖＝从中心｜点一下＝输入精确尺寸｜拖时 ↑↓ 改圆角、Esc 取消',
               'ui.rectW':'宽', 'ui.rectH':'高', 'ui.rectDlgW':'宽度', 'ui.rectDlgH':'高度', 'ui.rectOK':'确定', 'ui.rectCancel':'取消',
               'ui.rectRounded':'圆角矩形',
               'ui.rectSnap.anchor':'锚点', 'ui.rectSnap.center':'中心', 'ui.rectSnap.edge':'路径', 'ui.rectSnap.artboard':'画板', 'ui.rectSnap.align':'对齐'},
    'en':{'ui.rectHint':'Drag to draw | Shift+Drag: square | Alt+Drag: from center | Click: exact size | ↑↓ while dragging: corner radius, Esc: cancel',
          'ui.rectW':'W', 'ui.rectH':'H', 'ui.rectDlgW':'Width', 'ui.rectDlgH':'Height', 'ui.rectOK':'OK', 'ui.rectCancel':'Cancel',
          'ui.rectRounded':'Rounded Rectangle',
          'ui.rectSnap.anchor':'anchor', 'ui.rectSnap.center':'center', 'ui.rectSnap.edge':'path', 'ui.rectSnap.artboard':'artboard', 'ui.rectSnap.align':'align'}
  },
  onDown(e, pt){ if (e.button !== undefined && e.button !== 0) return; RectTool.down(e, pt); },
  onMove(e, pt, P){ if (!P.down || !RectTool.start) return; RectTool.drag(e, pt); UI.draw(); },
  onUp(){ RectTool.up(); UI.draw(); },
  onKey(e){ return RectTool.key(e); },
  onDeactivate(){ RectTool.cancel(); },
  drawOverlay(ctx, s){ RectTool.overlay(ctx, s); }
});

/* shortcuts.rs:148-237：工具忙着（按着滑鼠，start 有值）时，只有 Esc 与 ↑↓ 进工具，
   其余快捷键（Ctrl+Z、单键换工具、Delete……）一律不响应，直到放开。
   ui.js 的 keydown 先处理 Ctrl+Z 等组合键才问工具，所以这里用捕获阶段先拦下。 */
document.addEventListener('keydown', e => {
  if (ToolState.cur !== 'rect' || !RectTool.busy()) return;
  if (/input|select|textarea/i.test(e.target.tagName)) return;
  RectTool.key(e);
  e.stopPropagation();
  if (e.ctrlKey || e.metaKey) e.preventDefault();
}, true);
