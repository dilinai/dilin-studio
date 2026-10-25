/* 椭圆（O）——照 VectorCraft 原始码逐段翻译（不是照 PS／AI 印象另写）。
   对照源：
     vectorcraft/crates/tools/src/shape.rs          ShapeTool（ellipse 分支）：pointer / key / overlays / drag_rect
     vectorcraft/crates/tools/src/guides.rs         snap_draw → Targets::collect / snap_point（智能参考线吸附）
     vectorcraft/crates/engine/src/cmd/create.rs    shape.ellipse {x,y,width,height}，rect_of 先 .abs() 翻正
     vectorcraft/crates/ui-egui/src/dialogs/tools.rs + shapes.rs   点一下不拖 ⇒ 尺寸对话框（预设 100×100、按下点当左上角）
     vectorcraft/crates/doc/src/lib.rs              Unit::parse / parse_measure（对话框栏位可打 "2in"、"100/2"）
     vectorcraft/crates/ui-egui/src/chrome.rs:457   状态列提示字
     vectorcraft/crates/ui-egui/src/canvas.rs:1180  Label／Measure 叠画的位置与样式；:1044 selection_overlay（预览时新物件的选取框）；:495 只有指针真的动了才送 Drag
     vectorcraft/crates/ui-egui/src/dialogs/form.rs、widgets.rs num_field、state.rs Dialog::f64   对话框长度栏的显示与提交
     vectorcraft/crates/doc/src/node.rs             Node::walk（不跳藏起来的层）、geometric_bounds、shows_center、LAYER_COLORS
     vectorcraft/crates/geom/src/shapes.rs          ellipse()：左上右下 4 个平滑锚点（吸附目标用）
   行为：
     拖曳 ＝ 画椭圆（按下点与放开点为对角）；Shift ＝ 正圆；Alt ＝ 从中心画；两个一起 ＝ 从中心画正圆
     修饰键只在「拖动」那一刻取样：放开前只按／放 Shift、Alt 而不动滑鼠，不改结果（原码 Up 只 Commit 最后一次预览）
     拖不满 2 个萤幕像素就放开 ＝ 当作「点一下」⇒ 跳尺寸对话框（宽、高），确定后以点下处为左上角建椭圆
     拖曳中 Esc ＝ 整笔取消；按下与拖曳的点会被智能参考线吸附（锚点／中心点优先，其次 x、y 各自对齐）
     拖曳中显示：真实形状（目前填色描边）＋ 路径外框 ＋ 洋红参考线 ＋ 游标右下的「宽／高」量测框
   改文件一律走命令：滑鼠拖曳 → ellipse.drag；对话框 → ellipse.create（agent 叫同样两条就能做到同样的事）。 */

/* ───────── 单位解析（照 doc/src/lib.rs parse_measure / number_unit）─────────
   本画板文件单位是 px；VectorCraft 里 Pixels 与 Points 都是 1:1，所以预设单位＝1。 */
const ELLIPSE_UNIT_PT = { pt:1, px:1, 'in':72, '"':72, mm:72/25.4, cm:72/2.54, m:72/0.0254,
                         ft:72*12, "'":72*12, yd:72*36, p:12, pc:12 };
function ellipseParseF64(s){            // 照 Rust str::parse::<f64>：十进位／指数，另收 inf、infinity、nan（不分大小写，可带正负号）
  s = String(s);
  const m = /^([+-]?)(inf|infinity|nan)$/i.exec(s);
  if (m) return /nan/i.test(m[2]) ? NaN : (m[1] === '-' ? -Infinity : Infinity);
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : null;
}
/* number_unit（doc/src/lib.rs:265）：数字段只认 ASCII 数字、'.'、'-'；后面的单位只认这张表（回传「每单位几点」，没写单位回 null） */
function ellipseNumberUnit(s){
  s = String(s).trim();
  let end = 0;
  while (end < s.length && /[0-9.\-]/.test(s[end])) end++;
  const v = ellipseParseF64(s.slice(0, end).trim());
  if (v === null) return null;
  const u = s.slice(end).trim();
  if (u === '') return [v, null];
  if (!Object.prototype.hasOwnProperty.call(ELLIPSE_UNIT_PT, u)) return null;
  return [v, ELLIPSE_UNIT_PT[u]];
}
function ellipseParseMeasure(s, unit){
  s = String(s).trim();
  // 右边先拆的简单四则（"10+5"、"100/2"、"3in*2"）
  for (const op of ['+', '-', '*', '/']){
    const skip = s.length ? String.fromCodePoint(s.codePointAt(0)).length : 0;   // 第一个字不算运算子（负号）
    const j = s.slice(skip).lastIndexOf(op);
    if (j < 0) continue;
    const i = j + skip, l = s.slice(0, i), r = s.slice(i + 1);
    if (!l.trim()) continue;
    if (op === '+' || op === '-'){
      const a = ellipseParseMeasure(l, unit), b = ellipseParseMeasure(r, unit);
      if (a === null || b === null) return null;
      return op === '+' ? a + b : a - b;
    }
    // 乘数／除数是纯数字；它后面若带单位，算整个算式的单位
    const nu = ellipseNumberUnit(r); if (!nu) return null;
    const a = ellipseParseMeasure(l, nu[1] === null ? unit : nu[1]); if (a === null) return null;
    if (op === '*') return a * nu[0];
    return nu[0] === 0 ? null : a / nu[0];
  }
  // 派卡写法 "2p6"（2 派卡 6 点）
  const k = s.indexOf('p');
  if (k >= 0){
    const pa = s.slice(0, k), pt = s.slice(k + 1);
    if (pa !== '' && ellipseParseF64(pa.trim()) !== null && (pt === '' || ellipseParseF64(pt.trim()) !== null)
        && !s.endsWith('pt') && !s.endsWith('px')){
      return ellipseParseF64(pa.trim()) * 12 + (pt === '' ? 0 : ellipseParseF64(pt.trim()));
    }
  }
  const nu = ellipseNumberUnit(s); if (!nu) return null;
  return nu[0] * (nu[1] === null ? unit : nu[1]);
}
/* Unit::parse（lib.rs:189）＝ parse_measure(...).filter(is_finite)；解析不了回 null */
function ellipseUnitParse(s){
  const x = ellipseParseMeasure(String(s), 1);
  return (x !== null && Number.isFinite(x)) ? x : null;
}
/* Dialog::f64（ui-egui/src/state.rs:188）：数字直接收；字串走 Unit::Points.parse，不成就回预设 d；其他型别也回 d */
function ellipseLen(v, d){
  if (typeof v === 'number') return Number.isFinite(v) ? v : d;
  if (typeof v === 'string'){ const x = ellipseUnitParse(v); return x !== null ? x : d; }
  return d;
}
/* Unit::format（lib.rs:176-184）：小数 3 位、去尾 0 与小数点、"-0" 写成 "0"，再接单位（本画板 px） */
function ellipseFormatLen(v){
  let s = v.toFixed(3);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s + ' px';
}

/* ───────── drag_rect（shape.rs:97）─────────
   Shift：取 |dx|、|dy| 较大者成正方（Rust 的 signum(0)=+1，所以纯水平拖也会长出正圆）
   Alt：以按下点为中心（start-d … start+d）；最后 from_points 翻正成 x0<x1、y0<y1 */
function ellipseSignum(v){ return (v < 0 || Object.is(v, -0)) ? -1 : 1; }
function ellipseDragRect(start, p, m){
  let dx = p[0] - start[0], dy = p[1] - start[1];
  if (m.shift){
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = s * ellipseSignum(dx); dy = s * ellipseSignum(dy);
  }
  const a = m.alt ? [start[0] - dx, start[1] - dy] : [start[0], start[1]];
  const b = [start[0] + dx, start[1] + dy];
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
  return { x:x0, y:y0, width:Math.max(a[0], b[0]) - x0, height:Math.max(a[1], b[1]) - y0 };
}

/* ───────── 智能参考线（guides.rs）─────────
   Targets::collect：画板（＝文件）四角＋中心；每个看得见的物件：锚点（Path 才有）、外框四角、外框中心。
   snap_point：先找 tol 内最近的「点」（锚点／中心点）整点吸过去；没有就 x、y 各自对齐到最近的线。 */
function ellipseShapeGeom(s, ox, oy){
  let A = [], B = null;                 // A 锚点（形状自己的座标）、B 外框用的点
  const t = s.type;
  if (t === 'rect'){
    const x0 = Math.min(s.x, s.x + s.w), x1 = Math.max(s.x, s.x + s.w);
    const y0 = Math.min(s.y, s.y + s.h), y1 = Math.max(s.y, s.y + s.h);
    // shapes.rs rounded_rectangle：半径夹在短边一半以内；≈0 就是 4 角
    const rad = Math.min(Math.max(s.radius || 0, 0), (x1 - x0) / 2, (y1 - y0) / 2);
    A = rad <= 1e-9
      ? [[x0,y0],[x1,y0],[x1,y1],[x0,y1]]
      : [[x0+rad,y0],[x1-rad,y0],[x1,y0+rad],[x1,y1-rad],[x1-rad,y1],[x0+rad,y1],[x0,y1-rad],[x0,y0+rad]];
    B = [[x0,y0],[x1,y1]];
  } else if (t === 'ellipse'){
    // shapes.rs ellipse：左、上、右、下 4 个平滑锚点
    const x0 = Math.min(s.x, s.x + s.w), x1 = Math.max(s.x, s.x + s.w);
    const y0 = Math.min(s.y, s.y + s.h), y1 = Math.max(s.y, s.y + s.h);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    A = [[x0,cy],[cx,y0],[x1,cy],[cx,y1]];
    B = [[x0,y0],[x1,y1]];
  } else if (t === 'star' || t === 'polygon'){
    // 跟 engine.js drawShape 同一套顶点算法
    const n = s.points || (t === 'star' ? 5 : 6);
    const r1 = s.r1 || 0, r2 = (t === 'star' ? (s.r2 || 0) : r1);
    const rot = (s.rotation || 0) * Math.PI / 180 - Math.PI / 2;
    const steps = t === 'star' ? n * 2 : n;
    for (let i = 0; i < steps; i++){
      const r = (t === 'star' && i % 2) ? r2 : r1, a = rot + i * Math.PI * 2 / steps;
      A.push([s.cx + Math.cos(a) * r, s.cy + Math.sin(a) * r]);
    }
  } else if (t === 'path' || t === 'line'){
    A = (s.points || []).map(p => [p[0], p[1]]);
  } else if (t === 'bezier'){
    const An = s.anchors || [];
    A = An.map(a => [a.x, a.y]);
    // path.bounds()＝曲线的紧外框：每段三次贝兹对 x、y 各解导数＝0 的极值点（kurbo bounding_box 的做法）
    B = A.slice();
    const seg = (p, q) => {
      if (!p.out && !q.in) return;
      const c1 = p.out || [p.x, p.y], c2 = q.in || [q.x, q.y];
      const at = u => { const v = 1 - u;
        return [v*v*v*p.x + 3*v*v*u*c1[0] + 3*v*u*u*c2[0] + u*u*u*q.x,
                v*v*v*p.y + 3*v*v*u*c1[1] + 3*v*u*u*c2[1] + u*u*u*q.y]; };
      for (let k = 0; k < 2; k++){
        const p0 = k ? p.y : p.x, p1 = c1[k], p2 = c2[k], p3 = k ? q.y : q.x;
        // B'(u)/3 = a u² + b u + c
        const a = -p0 + 3*p1 - 3*p2 + p3, b = 2*(p0 - 2*p1 + p2), c = p1 - p0;
        const roots = [];
        if (Math.abs(a) < 1e-12){ if (Math.abs(b) > 1e-12) roots.push(-c / b); }
        else { const D = b*b - 4*a*c; if (D >= 0){ const r = Math.sqrt(D); roots.push((-b + r) / (2*a), (-b - r) / (2*a)); } }
        roots.forEach(u => { if (u > 0 && u < 1) B.push(at(u)); });
      }
    };
    for (let i = 1; i < An.length; i++) seg(An[i-1], An[i]);
    if (s.closed && An.length > 2) seg(An[An.length-1], An[0]);
  } else return null;
  B = B || A;
  if (!B.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  B.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
  return { anchors: A.map(p => [p[0] + ox, p[1] + oy]), bounds: {x0:x0+ox, y0:y0+oy, x1:x1+ox, y1:y1+oy} };
}
function ellipseCollectTargets(){
  const T = { points:[], xs:[], ys:[] };
  const addRect = (r, kind) => {
    const c = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
    for (const p of [[r.x0,r.y0],[r.x1,r.y0],[r.x1,r.y1],[r.x0,r.y1]]){
      T.xs.push([p[0], p, kind]); T.ys.push([p[1], p, kind]);
    }
    T.points.push([c, 'center']);
    T.xs.push([c[0], c, 'center']); T.ys.push([c[1], c, 'center']);
  };
  addRect({x0:0, y0:0, x1:Doc.width, y1:Doc.height}, 'artboard');   // for ab in doc.artboards（本画板＝整张文件一块）
  // doc.walk：逐个叶节点；budget 用完就不再收（每个锚点扣 1，在节点开头检查）。
  // 照原码：只看节点自己的 visible，不看所在图层——图层藏起来，里面的东西照样当吸附目标（Node::walk 不跳藏起来的层）。
  // 我们的形状没有自己的 visible ⇒ 全收；像素层＝层里一张 Image（外框＝那块画布）、文字层＝层里一个 Text（外框量字），一样不看层藏没藏。
  let budget = 20000;
  for (const L of Doc.layers){
    const ox = L.x || 0, oy = L.y || 0;
    if (L.kind === 'vector'){
      for (const s of (L.data.shapes || [])){
        if (budget === 0) break;
        const g = ellipseShapeGeom(s, ox, oy);
        if (!g) continue;
        g.anchors.forEach(a => { T.points.push([a, 'anchor']); budget = Math.max(0, budget - 1); });
        addRect(g.bounds, 'edge');
      }
    } else if (budget > 0){
      const b = L.kind === 'raster' ? ellipseRasterBounds(L, ox, oy) : ellipseTextBounds(L, ox, oy);
      if (b) addRect(b, 'edge');
    }
  }
  return T;
}
/* NodeKind::Image 的 geometric_bounds：整块图（像素层的画布）放在 (L.x, L.y) */
function ellipseRasterBounds(L, ox, oy){
  const c = L.data && L.data.canvas; if (!c) return null;
  // AI：置入的图是一个影像物件，智能参考线吸它自己的外框四角／中心（不是整张画板大小的像素层）；有置入记录（engine placeImageFromURL 的 _place）就用那块
  const pl = L._place; if (Array.isArray(pl) && pl.length === 4 && pl.every(Number.isFinite)) return {x0:ox + pl[0], y0:oy + pl[1], x1:ox + pl[0] + pl[2], y1:oy + pl[1] + pl[3]};
  return {x0:ox, y0:oy, x1:ox + c.width, y1:oy + c.height};
}
/* NodeKind::Text 的 geometric_bounds：用跟 renderLayer 一样的字型量每一行（字框高＝字型上下缘），对齐方式照 align */
function ellipseTextBounds(L, ox, oy){
  const d = L.data; if (!d || d.text === undefined) return null;
  const cv = ellipseTextBounds._c || (ellipseTextBounds._c = document.createElement('canvas').getContext('2d'));
  cv.font = `${d.weight||'normal'} ${d.size}px ${d.font}`;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  String(d.text).split('\n').forEach((line, i) => {
    const m = cv.measureText(line), w = m.width;
    const asc = m.fontBoundingBoxAscent !== undefined ? m.fontBoundingBoxAscent : d.size * 0.8;
    const des = m.fontBoundingBoxDescent !== undefined ? m.fontBoundingBoxDescent : d.size * 0.2;
    const left = (d.align === 'center') ? d.x - w/2 : (d.align === 'right' || d.align === 'end') ? d.x - w : d.x;
    const base = d.y + i * (+d.leading > 0 ? +d.leading : d.size * 1.25);
    x0 = Math.min(x0, left); x1 = Math.max(x1, left + w);
    y0 = Math.min(y0, base - asc); y1 = Math.max(y1, base + des);
  });
  if (!Number.isFinite(x0)) return null;
  return {x0:x0+ox, y0:y0+oy, x1:x1+ox, y1:y1+oy};
}
function ellipseSnapPoint(T, p, tol){
  let best = null, bd = Infinity;
  for (const [q, k] of T.points){
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d <= tol && d < bd){ best = [q, k]; bd = d; }
  }
  if (best) return { p:[best[0][0], best[0][1]], guides:[{label:best[1], p:best[0]}] };
  const out = [p[0], p[1]], guides = [];
  let bx = null, dx = Infinity;
  for (const e of T.xs){ const d = Math.abs(e[0] - p[0]); if (d <= tol && d < dx){ bx = e; dx = d; } }
  if (bx){ out[0] = bx[0]; guides.push({a:bx[1], b:[bx[0], p[1]]}); }
  let by = null, dy = Infinity;
  for (const e of T.ys){ const d = Math.abs(e[0] - p[1]); if (d <= tol && d < dy){ by = e; dy = d; } }
  if (by){ out[1] = by[0]; guides.push({a:by[1], b:[p[0], by[0]]}); }
  if (guides.length) guides.push({label:'align', p:[out[0], out[1]]});
  return { p:out, guides };
}
/* snap_draw：智能参考线关着就原样回；tol＝5 个萤幕像素换成文件单位（cx.tol(5.0)） */
function ellipseSnapDraw(p, on, zoom){
  if (!on) return { p:[p[0], p[1]], guides:[] };
  return ellipseSnapPoint(ellipseCollectTargets(), p, 5 / Math.max(zoom || 1, 1e-9));
}

/* ───────── 命令（agent 与滑鼠走同一条）───────── */
function ellipsePaint(p){
  // 跟 VectorCraft 一样用「目前的填色／描边」（session.paint）；给了就用给的
  return {
    fill:        p.fill        !== undefined ? p.fill        : UI.fill(),
    stroke:      p.stroke      !== undefined ? p.stroke      : UI.stroke(),
    strokeWidth: p.strokeWidth !== undefined ? p.strokeWidth : UI.strokeW()
  };
}
function ellipseAdd(r, p){
  const res = CMD.map['shape.ellipse'].run(Object.assign(
    {x:r.x, y:r.y, w:r.width, h:r.height}, ellipsePaint(p), p.layerId ? {layerId:p.layerId} : {}));
  // create.rs add_look ⇒ sel.set([id])：新画的椭圆被选取（AI 一样；画完圆可直接 Ctrl+C／Ctrl+F）
  if (res && res.id && res.layerId && window.VecSel) VecSel.setShapes(res.layerId, [res.id]);
  return Object.assign({}, res, {x:r.x, y:r.y, width:r.width, height:r.height});
}
CMD.reg('ellipse.drag', {i18n:'', undoable:true,
  params:'{x1,y1 按下点, x2,y2 放开点（文件坐标）, shift=false 锁成正圆, alt=false 以按下点为中心, snap=false 两点先套智能参考线吸附, fill?, stroke?, strokeWidth?（预设＝目前颜色）, layerId?} 等同拿椭圆工具从 (x1,y1) 拖到 (x2,y2) → {id, layerId, x, y, width, height}'},
  p => {
    if (![p.x1, p.y1, p.x2, p.y2].every(v => typeof v === 'number' && Number.isFinite(v))) return {ok:false, error:'ellipse.drag: x1,y1,x2,y2 are required numbers'};
    let a = [p.x1, p.y1], b = [p.x2, p.y2];
    if (p.snap){ a = ellipseSnapDraw(a, true, UI.zoom).p; b = ellipseSnapDraw(b, true, UI.zoom).p; }
    return ellipseAdd(ellipseDragRect(a, b, {shift:!!p.shift, alt:!!p.alt}), p);
  });
CMD.reg('ellipse.create', {i18n:'', undoable:true,
  params:'{x, y 左上角（文件坐标，必填数字）, width=100, height=100（数字或带单位/算式的字串，如 "2in"、"100/2"、"1p6"；解析不了＝100；负数会翻正）, fill?, stroke?, strokeWidth?, layerId?} 等同用椭圆工具点一下、在尺寸对话框填宽高按确定 → {id, layerId, x, y, width, height}'},
  p => {
    // create.rs rect_of：x、y 是 f64_req（缺了或不是数字就报错）；宽高照对话框 d.f64("width", 100.0)
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return {ok:false, error:'ellipse.create: missing number `x`/`y`'};
    const x = p.x, y = p.y;
    const w = ellipseLen(p.width, 100), h = ellipseLen(p.height, 100);
    if (![x, y, w, h].every(Number.isFinite)) return {ok:false, error:'ellipse.create: invalid size'};
    // create.rs rect_of：Rect::new(x, y, x+w, y+h).abs()
    const x0 = Math.min(x, x + w), y0 = Math.min(y, y + h);
    return ellipseAdd({x:x0, y:y0, width:Math.abs(w), height:Math.abs(h)}, p);
  });

/* ───────── 工具状态（ShapeTool 的栏位：start / last / mods / began / guides）───────── */
const ELLIPSE_LAYER_COLORS = ['#4f80ff','#ff4f4f','#4fff4f','#4f4fff','#ffff4f','#ff4fff','#4fffff','#808080','#000000',
  '#ff6600','#008000','#008080','#cc9966','#993300','#9933ff','#ff9900','#000080','#ff99cc','#9999ff','#990000',
  '#666600','#ff9999','#990033','#99cc00','#996600','#660099','#bbbbbb'];
const EllipseTool = {
  start: null, last: [0, 0], mods: {shift:false, alt:false}, began: false, guides: [], dlg: null,

  reset(){ this.start = null; this.began = false; this.guides = []; },
  /* 尺寸对话框（dialogs/tools.rs：width/height 预设 "100 pt"；本画板单位 px） */
  openDialog(x, y){
    this.closeDialog();
    const t = k => Lang.t(k);
    const bg = document.createElement('div');
    bg.id = 'ellipseDlg';
    bg.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.25)';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--bg2,#262626);color:var(--fg,#d6d6d6);border:1px solid var(--line,#3a3a3a);border-radius:6px;padding:14px 16px;min-width:240px;font:13px sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)';
    const h = document.createElement('div');
    h.textContent = t('tool.ellipse'); h.style.cssText = 'font-weight:bold;margin-bottom:10px';
    box.appendChild(h);
    /* form.rs length_field → widgets.rs num_field：
       显示 Unit::format(值)；离开栏位（或按 Enter）时字串若改过就 Unit::parse，成功才存成新值，失败保留旧值并把字改回去 */
    const field = (key, label) => {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0';
      const sp = document.createElement('span'); sp.textContent = label; sp.style.color = 'var(--fg2,#9a9a9a)';
      const inp = document.createElement('input'); inp.type = 'text'; inp.name = key;
      inp.style.cssText = 'width:120px;background:var(--bg3,#2f2f2f);color:inherit;border:1px solid var(--line,#3a3a3a);border-radius:3px;padding:3px 6px';
      inp._val = 100;                                   // dialogs/tools.rs:14 预设 "100 pt"（本画板单位 px，1:1）
      // AI：对话框记得上一次按「确定」的宽高（例：先 180×180、再点一下框里就是 180）
      if (this.lastSize && isFinite(this.lastSize[key === 'width' ? 0 : 1])) inp._val = this.lastSize[key === 'width' ? 0 : 1];
      inp.value = ellipseFormatLen(inp._val);
      inp.commit = () => {
        const shown = ellipseFormatLen(inp._val), old = inp._val;
        if (inp.value !== shown){ const v = ellipseUnitParse(inp.value); if (v !== null) inp._val = v; }
        inp.value = ellipseFormatLen(inp._val);
        // AI 2020：宽高中间的锁链（约束宽度和高度比例）按下时，改一栏另一栏照比例跟着变
        if (inp._val !== old && this.dlgLock && inp.other && old){ const o = inp.other; o._val = o._val * inp._val / old; o.value = ellipseFormatLen(o._val); }
      };
      inp.addEventListener('blur', () => inp.commit());
      inp.addEventListener('focus', () => inp.select()); // select_all_on_focus
      row.appendChild(sp); row.appendChild(inp); box.appendChild(row);
      return inp;
    };
    const wIn = field('width', t('ui.ellipseWidth')), hIn = field('height', t('ui.ellipseHeight'));
    wIn.other = hIn; hIn.other = wIn;
    /* 宽高右边的锁链钮（AI 2020「约束宽度和高度比例」）：记得上一次的状态 */
    this.dlgLock = !!this.lastLock;
    const lk = document.createElement('button'); lk.type = 'button'; lk.name = 'constrain'; lk.title = t('ui.ellipseConstrain');
    const paintLk = () => {
      lk.innerHTML = '<svg width="12" height="22" viewBox="0 0 12 22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="1" width="8" height="8" rx="4"/><rect x="2" y="13" width="8" height="8" rx="4"/>'
        + (this.dlgLock ? '<line x1="6" y1="7" x2="6" y2="15"/>' : '') + '</svg>';
      lk.setAttribute('aria-pressed', this.dlgLock ? 'true' : 'false');
      lk.style.background = this.dlgLock ? 'var(--accent,#2f7fd8)' : 'var(--bg3,#2f2f2f)'; };
    lk.style.cssText = 'position:absolute;right:-26px;top:50%;transform:translateY(-50%);width:22px;height:34px;padding:0;border:1px solid var(--line,#3a3a3a);border-radius:3px;color:#fff;cursor:pointer;font-size:11px';
    lk.onclick = e => { e.stopPropagation(); wIn.commit(); hIn.commit(); this.dlgLock = this.lastLock = !this.dlgLock; paintLk(); };
    paintLk();
    const pair = document.createElement('div'); pair.style.cssText = 'position:relative;margin-right:28px';
    box.insertBefore(pair, wIn.parentNode); pair.appendChild(wIn.parentNode); pair.appendChild(hIn.parentNode); pair.appendChild(lk);
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px';
    const mkBtn = (label, name, primary) => {
      const b = document.createElement('button'); b.textContent = label; b.name = name;
      b.style.cssText = 'padding:4px 14px;border-radius:3px;border:1px solid var(--line,#3a3a3a);cursor:pointer;color:#fff;background:' + (primary ? 'var(--accent,#2f7fd8)' : 'var(--bg3,#2f2f2f)');
      btns.appendChild(b); return b;
    };
    const cancel = mkBtn(t('ui.ellipseCancel'), 'cancel', false);
    const okB = mkBtn(t('ui.ellipseOK'), 'ok', true);
    box.appendChild(btns); bg.appendChild(box);
    const confirm = () => {
      // 正在打的那一栏先收（egui 按 Enter＝栏位失焦提交）；shapes.rs confirm：d.f64("width", 100.0)
      wIn.commit(); hIn.commit();
      const w = wIn._val, hh = hIn._val;
      this.lastSize = [w, hh];
      this.closeDialog();
      CMD.run('ellipse.create', {x, y, width:w, height:hh});
    };
    okB.onclick = e => { e.stopPropagation(); confirm(); };
    cancel.onclick = e => { e.stopPropagation(); this.closeDialog(); };
    bg.addEventListener('pointerdown', e => { if (e.target === bg){ e.stopPropagation(); this.closeDialog(); } });
    bg.addEventListener('keydown', e => {
      e.stopPropagation();                              // 对话框开着时，按键不漏给画板快捷键
      if (e.key === 'Enter'){ e.preventDefault(); confirm(); }
      else if (e.key === 'Escape'){ e.preventDefault(); this.closeDialog(); }
    });
    document.body.appendChild(bg);
    this.dlg = bg;
    wIn.focus(); wIn.select();
  },
  closeDialog(){ if (this.dlg){ this.dlg.remove(); this.dlg = null; } }
};
window.EllipseTool = EllipseTool;
if (ToolState.smartGuides === undefined) ToolState.smartGuides = true;   // VectorCraft 预设开（tooling.rs:33）

const ELLIPSE_STRINGS = {
  'zh-Hant':{
    'ui.ellipseHint':'拖曳＝畫橢圓｜Shift＋拖＝正圓｜Alt＋拖＝從中心畫｜點一下＝輸入精確尺寸｜拖曳中 Esc 取消',
    'ui.ellipseWidth':'寬度', 'ui.ellipseHeight':'高度', 'ui.ellipseOK':'確定', 'ui.ellipseCancel':'取消', 'ui.ellipseConstrain':'強制寬度和高度比例',
    'ui.ellipseW':'寬', 'ui.ellipseH':'高',
    'ui.snap.anchor':'錨點', 'ui.snap.center':'中心點', 'ui.snap.align':'對齊',
    'opt.smartGuides':'智慧型參考線'
  },
  'zh-Hans':{
    'ui.ellipseHint':'拖曳＝画椭圆｜Shift＋拖＝正圆｜Alt＋拖＝从中心画｜点一下＝输入精确尺寸｜拖曳中 Esc 取消',
    'ui.ellipseWidth':'宽度', 'ui.ellipseHeight':'高度', 'ui.ellipseOK':'确定', 'ui.ellipseCancel':'取消', 'ui.ellipseConstrain':'约束宽度和高度比例',
    'ui.ellipseW':'宽', 'ui.ellipseH':'高',
    'ui.snap.anchor':'锚点', 'ui.snap.center':'中心点', 'ui.snap.align':'对齐',
    'opt.smartGuides':'智能参考线'
  },
  'en':{
    'ui.ellipseHint':'Drag to draw | Shift+Drag: circle | Alt+Drag: from center | Click for exact size | Esc while dragging cancels',
    'ui.ellipseWidth':'Width', 'ui.ellipseHeight':'Height', 'ui.ellipseOK':'OK', 'ui.ellipseCancel':'Cancel', 'ui.ellipseConstrain':'Constrain Width and Height Proportions',
    'ui.ellipseW':'W', 'ui.ellipseH':'H',
    'ui.snap.anchor':'anchor', 'ui.snap.center':'center', 'ui.snap.align':'align',
    'opt.smartGuides':'Smart Guides'
  }
};
// 登记处用 window.Lang 判断，但 i18n.js 的 Lang 是 const、此刻还没挂到 window ⇒ 自己并进字典
Lang.add(ELLIPSE_STRINGS);

Tools.reg({
  id:'ellipse', icon:'◯', key:'O', group:'vector', order:30, for:'vector', needs:'vector', opts:[],
  hint:'ui.ellipseHint', cursor:'crosshair', strings:ELLIPSE_STRINGS,

  buildOptions(box, add, mk){
    const c = mk('checkbox', {checked: ToolState.smartGuides !== false});
    c.onchange = () => { ToolState.smartGuides = c.checked; };
    add('smartGuides', c);
  },

  /* PointerKind::Down：吸附后的点当起点；last 记原始点；began 归零 */
  onDown(e, pt){
    const S = EllipseTool;
    S.start = ellipseSnapDraw(pt, ToolState.smartGuides !== false, UI.zoom).p;
    S.last = [pt[0], pt[1]];
    S.began = false;
  },
  /* PointerKind::Drag：吸附、记 mods；没拖满 2 个萤幕像素前不开始；开始后每次都重算预览 */
  onMove(e, pt, P){
    const S = EllipseTool;
    if (!P.down || !S.start) return;
    const sn = ellipseSnapDraw(pt, ToolState.smartGuides !== false, UI.zoom);
    S.guides = sn.guides;
    S.last = sn.p;
    S.mods = {shift:!!e.shiftKey, alt:!!e.altKey};
    if (!S.began){
      if (Math.hypot(S.last[0] - S.start[0], S.last[1] - S.start[1]) < 2 / Math.max(UI.zoom, 1e-9)) return;
      S.began = true;
    }
    UI.draw();
  },
  /* PointerKind::Up：开始过 ⇒ 提交（就是最后那次预览）；没开始过 ⇒ 当点一下，跳尺寸对话框 */
  onUp(){
    const S = EllipseTool;
    const s = S.start; if (!s){ UI.draw(); return; }
    S.start = null; S.guides = [];
    if (S.began){
      S.began = false;
      CMD.run('ellipse.drag', {x1:s[0], y1:s[1], x2:S.last[0], y2:S.last[1], shift:S.mods.shift, alt:S.mods.alt});
    } else {
      UI.draw();
      S.openDialog(s[0], s[1]);
    }
  },
  /* key()：椭圆没有 ↑↓ 可调的参数；只有「已开始拖」时 Esc 取消 */
  onKey(e){
    const S = EllipseTool;
    if (!S.start || !S.began) return false;
    if (e.key === 'Escape'){ S.reset(); UI.draw(); return true; }
    return false;
  },
  onDeactivate(){ EllipseTool.reset(); EllipseTool.closeDialog(); },

  /* overlays()：只有 start 有值且已开始时才画
     ① 预览＝真的那颗椭圆（目前填色描边；VectorCraft 是把命令真的跑在快照上）＋新物件被选取时的路径外框与 4 锚点
     ② 智能参考线（洋红线＋标签，标签在点的右上 8,-14 萤幕像素）
     ③ 量测框：游标右下 14,14 萤幕像素，灰底白字「宽: …  高: …」（量的是原始拖曳量，不含 Shift 修正） */
  drawOverlay(ctx, s){
    const S = EllipseTool;
    if (!S.start || !S.began) return;
    const dpr = s / Math.max(UI.zoom, 1e-9);
    const r = ellipseDragRect(S.start, S.last, S.mods);
    ctx.save();
    drawShape(ctx, {type:'ellipse', x:r.x, y:r.y, w:r.width, h:r.height,
                    fill:UI.fill(), stroke:UI.stroke(), strokeWidth:UI.strokeW()}, s);
    // canvas.rs selection_overlay：新物件被选取 ⇒ 1px 图层色外框＋4 个实心 4px 锚点方块＋中心点（shows_center_by_default：形状工具画的显示中心）
    // 图层色＝LAYER_COLORS[第几层 % 27]（node.rs:33；新层按建立顺序轮）
    const L = Doc.active();
    const li = L && L.kind === 'vector' ? Math.max(0, Doc.index(L.id)) : Doc.layers.length;
    const blue = ELLIPSE_LAYER_COLORS[li % ELLIPSE_LAYER_COLORS.length];
    ctx.beginPath();
    ctx.ellipse((r.x + r.width/2)*s, (r.y + r.height/2)*s, r.width/2*s, r.height/2*s, 0, 0, Math.PI*2);
    ctx.lineWidth = 1 * dpr; ctx.strokeStyle = blue; ctx.stroke();
    const cx = r.x + r.width/2, cy = r.y + r.height/2;
    [[r.x, cy], [cx, r.y], [r.x + r.width, cy], [cx, r.y + r.height], [cx, cy]].forEach(p => {
      const q = 2 * dpr;                                 // anchor_square size 4.0
      ctx.fillStyle = blue; ctx.fillRect(p[0]*s - q, p[1]*s - q, 2*q, 2*q);
    });
    const MAGENTA = '#ff3dfc';
    ctx.font = `${11*dpr}px sans-serif`; ctx.textBaseline = 'top';
    for (const g of S.guides){
      if (g.a){
        ctx.beginPath(); ctx.moveTo(g.a[0]*s, g.a[1]*s); ctx.lineTo(g.b[0]*s, g.b[1]*s);
        ctx.lineWidth = 1 * dpr; ctx.strokeStyle = MAGENTA; ctx.stroke();
      } else if (g.label){
        ctx.fillStyle = MAGENTA;
        ctx.fillText(Lang.t('ui.snap.' + g.label), g.p[0]*s + 8*dpr, g.p[1]*s - 14*dpr);
      }
    }
    const dx = Math.abs(S.last[0] - S.start[0]), dy = Math.abs(S.last[1] - S.start[1]);
    const lines = [`${Lang.t('ui.ellipseW')}: ${dx.toFixed(2)} px`, `${Lang.t('ui.ellipseH')}: ${dy.toFixed(2)} px`];
    const bx = S.last[0]*s + 14*dpr, by = S.last[1]*s + 14*dpr;
    const tw = Math.max(...lines.map(l => ctx.measureText(l).width));
    const lh = 13 * dpr;
    ctx.fillStyle = 'rgba(92,92,92,' + (235/255) + ')';   // theme.rs:120 measure_bg = (92,92,92,235)
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, tw + 12*dpr, lh*lines.length + 8*dpr, 3*dpr);
    else ctx.rect(bx, by, tw + 12*dpr, lh*lines.length + 8*dpr);
    ctx.fill();
    ctx.fillStyle = '#fff';
    lines.forEach((l, i) => ctx.fillText(l, bx + 6*dpr, by + 4*dpr + i*lh));
    ctx.restore();
  }
});
