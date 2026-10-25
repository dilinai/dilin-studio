/* 直线段（\）——照 VectorCraft 的 ShapeTool「lineSegment」分支逐段翻译，加上 PhotoCraft 直线工具（PS 的 U）的「粗细」选项。
   对照源（行号以 artcraft-src 为根）：
     vectorcraft/crates/tools/src/shape.rs:62-92      command：lineSegment ⇒ Alt＝按下点为中点（a = start − (p − start)、b = p），Shift＝b 绕 a 锁 45°
     vectorcraft/crates/tools/src/shape.rs:113-153    pointer：Down 吸附记起点；Drag 吸附、记修饰键、拖满 2 萤幕像素才开始；Up 有开始＝提交最后一次预览，没开始＝跳对话框
     vectorcraft/crates/tools/src/shape.rs:154-193    key：只有开始拖了才有反应；lineSegment 没有 ↑↓ 参数，只有 Esc 取消
     vectorcraft/crates/tools/src/shape.rs:194-204    overlays：开始后＝吸附参考线＋游标右下「W／H」量测框（量 last − start）
     vectorcraft/crates/geom/src/lib.rs:47-61         constrain_angle(v, 45)：长度不变、角度四舍五入到 45° 的倍数（EPS=1e-9 以下原样回）
     vectorcraft/crates/engine/src/cmd/create.rs:25、297-308   shape.line {x1,y1,x2,y2}（f64_req）→ LiveShape::Line；
                                                      外观：填色一律 None、描边＝目前描边（是 None 就用黑）、粗细＝max(描边宽, 0.1)；add_look ⇒ 新物件被选取（sel.set([id])）
     vectorcraft/crates/geom/src/shapes.rs:93-95      line(a, b)＝两个直角点的开放折线（我们存成 {type:'line', points:[[x1,y1],[x2,y2]]}）
     vectorcraft/crates/doc/src/node.rs:98-161、1076  LiveShape::Line；线段不显示中心点（shows_center_by_default 排除 Line）
     vectorcraft/crates/tools/src/guides.rs           snap_draw → Targets::collect／snap_point（智能参考线；tol＝5 萤幕像素）
     vectorcraft/crates/ui-egui/src/dialogs/tools.rs:18   点一下＝「直线段工具选项」对话框：{x, y, length:"100 pt", angle:0}
     vectorcraft/crates/ui-egui/src/dialogs/shapes.rs:19、32-35   确定 ⇒ shape.line {x1:x, y1:y, x2:x + l·cos a, y2:y − l·sin a}（角度逆时针、萤幕 y 朝下所以减）
     vectorcraft/crates/ui-egui/src/dialogs/form.rs:44-58、124-139、250-273   length 是长度栏（单位格式化）、angle 是一般字栏；栏位照键名排序（serde_json 无 preserve_order ⇒ Angle 在 Length 前）
     vectorcraft/crates/ui-egui/src/state.rs:188-201  Dialog::f64：数字原样、字串走 Unit::Points.parse、不成回预设
     vectorcraft/crates/doc/src/lib.rs:130-283        Unit::parse ＝ parse_measure（"2in"、"100/2"、"1p6"…）
     vectorcraft/crates/ui-egui/src/shortcuts.rs:148-237  工具忙着（按着滑鼠）时只有 Esc／↑↓ 进工具，其余快捷键不响应
     vectorcraft/crates/ui-egui/src/canvas.rs:1044、1167-1194   新物件选取框（图层色 1px＋4px 锚点方块）、洋红参考线、量测框画法
     vectorcraft/crates/tools/src/catalog.rs:45        lineSegment 快捷键 "\"
     photocraft/crates/ui-egui/src/vector_ui.rs:43-57、427-431   PS 直线：Shift 锁 45°（round(atan2/(π/4))·π/4，跟 constrain_angle 同一算法）、
                                                      长度 < 1 不建、选项栏「粗细」1..1000 px（state.rs:449 预设 3）
     photocraft/crates/vector/src/shapes.rs:113-119   PS 直线＝以粗细为宽的四边形（我们矢量层上用描边线等价画出）
   合并规则（两边都抄、不少）：描边宽 > 0 ⇒ 用描边宽（AI）；描边为「无」（宽 0）⇒ 颜色用黑（create.rs:304）、粗细用选项栏「粗细」（PS，预设 3），再夹 ≥ 0.1（create.rs:305）。
   改文件一律走命令：拖曳 → line.drag；对话框 → line.dialog；指定两端 → line.create；选项 → line.setOption。 */

/* ───────── 单位解析（照 doc/src/lib.rs parse_measure；本画板文件单位 px，与 pt 一样 1:1）───────── */
const LINE_UNIT_PT = { pt:1, px:1, 'in':72, '"':72, mm:72/25.4, cm:72/2.54, m:72/0.0254,
                       ft:72*12, "'":72*12, yd:72*36, p:12, pc:12 };
/* Rust str::parse::<f64>：十进位／指数，另收 inf、infinity、nan（不分大小写，可带正负号） */
function lineParseF64(s){
  s = String(s);
  const m = /^([+-]?)(inf|infinity|nan)$/i.exec(s);
  if (m) return /nan/i.test(m[2]) ? NaN : (m[1] === '-' ? -Infinity : Infinity);
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : null;
}
/* number_unit：数字段只认 ASCII 数字、'.'、'-'；后面的单位只认表上的（回传 [值, 每单位几点|null]） */
function lineNumberUnit(s){
  s = String(s).trim();
  let end = 0;
  while (end < s.length && /[0-9.\-]/.test(s[end])) end++;
  const v = lineParseF64(s.slice(0, end).trim());
  if (v === null) return null;
  const u = s.slice(end).trim();
  if (u === '') return [v, null];
  if (!Object.prototype.hasOwnProperty.call(LINE_UNIT_PT, u)) return null;
  return [v, LINE_UNIT_PT[u]];
}
function lineParseMeasure(s, unit){
  s = String(s).trim();
  for (const op of ['+', '-', '*', '/']){                 // 右边先拆的简单四则
    const skip = s.length ? String.fromCodePoint(s.codePointAt(0)).length : 0;   // 第一个字不算运算子（负号）
    const j = s.slice(skip).lastIndexOf(op);
    if (j < 0) continue;
    const i = j + skip, l = s.slice(0, i), r = s.slice(i + 1);
    if (!l.trim()) continue;
    if (op === '+' || op === '-'){
      const a = lineParseMeasure(l, unit), b = lineParseMeasure(r, unit);
      if (a === null || b === null) return null;
      return op === '+' ? a + b : a - b;
    }
    const nu = lineNumberUnit(r); if (!nu) return null;    // 乘数／除数是纯数字；它后面若带单位，算整个算式的单位
    const a = lineParseMeasure(l, nu[1] === null ? unit : nu[1]); if (a === null) return null;
    if (op === '*') return a * nu[0];
    return nu[0] === 0 ? null : a / nu[0];
  }
  const k = s.indexOf('p');                               // 派卡写法 "2p6"
  if (k >= 0){
    const pa = s.slice(0, k), pt = s.slice(k + 1);
    if (pa !== '' && lineParseF64(pa.trim()) !== null && (pt === '' || lineParseF64(pt.trim()) !== null)
        && !s.endsWith('pt') && !s.endsWith('px')){
      return lineParseF64(pa.trim()) * 12 + (pt === '' ? 0 : lineParseF64(pt.trim()));
    }
  }
  const nu = lineNumberUnit(s); if (!nu) return null;
  return nu[0] * (nu[1] === null ? unit : nu[1]);
}
/* Unit::parse（lib.rs:189）＝ parse_measure(...).filter(is_finite) */
function lineUnitParse(s){
  const x = lineParseMeasure(String(s), 1);
  return (x !== null && Number.isFinite(x)) ? x : null;
}
/* Dialog::f64（state.rs:188）：数字原样（非有限＝预设）；字串走 Unit::Points.parse，不成回预设；其他型别回预设 */
function lineF64(v, d){
  if (typeof v === 'number') return Number.isFinite(v) ? v : d;
  if (typeof v === 'string'){ const x = lineUnitParse(v); return x !== null ? x : d; }
  return d;
}
/* Unit::format（lib.rs:176-184）：小数 3 位、去尾 0 与小数点、"-0" 写成 "0"，再接单位 */
function lineFormatLen(v){
  let s = v.toFixed(3);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s + ' px';
}

/* ───────── 几何（shape.rs:77-81 ＋ geom/lib.rs:47-61）───────── */
function lineRustRound(x){ return Math.sign(x) * Math.round(Math.abs(x)); }   // Rust f64::round：.5 远离 0
/* constrain_angle_from(v, step, base=0)：长度 < EPS 原样回；否则角度取到最近的 step 倍数、长度不变 */
function lineConstrainAngle(v, stepDeg){
  const len = Math.hypot(v[0], v[1]);
  if (len < 1e-9) return [v[0], v[1]];
  const step = stepDeg * Math.PI / 180, base = 0;
  const a = base + lineRustRound((Math.atan2(v[1], v[0]) - base) / step) * step;
  return [Math.cos(a) * len, Math.sin(a) * len];
}
/* ShapeTool::command 的 lineSegment 分支：
     Alt ⇒ (a, b) = (start − (p − start), p)：按下点成了中点；
     Shift ⇒ b = a + constrain_angle(b − a, 45°)——注意是「绕 a 锁角」，所以 Alt+Shift 时中点不一定还在按下点（照抄原码，不改） */
function lineCommand(start, p, m){
  let a, b;
  if (m && m.alt){ a = [start[0] - (p[0] - start[0]), start[1] - (p[1] - start[1])]; b = [p[0], p[1]]; }
  else { a = [start[0], start[1]]; b = [p[0], p[1]]; }
  if (m && m.shift){ const c = lineConstrainAngle([b[0] - a[0], b[1] - a[1]], 45); b = [a[0] + c[0], a[1] + c[1]]; }
  return {x1:a[0], y1:a[1], x2:b[0], y2:b[1]};
}

/* ───────── 智能参考线（guides.rs；跟椭圆单同一套翻译，自己留一份免得互相牵动）───────── */
function lineShapeGeom(s, ox, oy){
  let A = [], B = null;
  const t = s.type;
  if (t === 'rect'){
    const x0 = Math.min(s.x, s.x + s.w), x1 = Math.max(s.x, s.x + s.w);
    const y0 = Math.min(s.y, s.y + s.h), y1 = Math.max(s.y, s.y + s.h);
    const rad = Math.min(Math.max(s.radius || 0, 0), (x1 - x0) / 2, (y1 - y0) / 2);   // shapes.rs rounded_rectangle
    A = rad <= 1e-9
      ? [[x0,y0],[x1,y0],[x1,y1],[x0,y1]]
      : [[x0+rad,y0],[x1-rad,y0],[x1,y0+rad],[x1,y1-rad],[x1-rad,y1],[x0+rad,y1],[x0,y1-rad],[x0,y0+rad]];
    B = [[x0,y0],[x1,y1]];
  } else if (t === 'ellipse'){
    const x0 = Math.min(s.x, s.x + s.w), x1 = Math.max(s.x, s.x + s.w);
    const y0 = Math.min(s.y, s.y + s.h), y1 = Math.max(s.y, s.y + s.h);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    A = [[x0,cy],[cx,y0],[x1,cy],[cx,y1]];                // shapes.rs ellipse：左上右下
    B = [[x0,y0],[x1,y1]];
  } else if (t === 'star' || t === 'polygon'){
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
    B = A.slice();                                        // path.bounds()：曲线紧外框＝端点＋每段导数为 0 的极值点
    const seg = (p, q) => {
      if (!p.out && !q.in) return;
      const c1 = p.out || [p.x, p.y], c2 = q.in || [q.x, q.y];
      const at = u => { const v = 1 - u;
        return [v*v*v*p.x + 3*v*v*u*c1[0] + 3*v*u*u*c2[0] + u*u*u*q.x,
                v*v*v*p.y + 3*v*v*u*c1[1] + 3*v*u*u*c2[1] + u*u*u*q.y]; };
      for (let k = 0; k < 2; k++){
        const p0 = k ? p.y : p.x, p1 = c1[k], p2 = c2[k], p3 = k ? q.y : q.x;
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
function lineCollectTargets(){
  const T = { points:[], xs:[], ys:[] };
  const addRect = (r, kind) => {
    const c = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
    for (const p of [[r.x0,r.y0],[r.x1,r.y0],[r.x1,r.y1],[r.x0,r.y1]]){ T.xs.push([p[0], p, kind]); T.ys.push([p[1], p, kind]); }
    T.points.push([c, 'center']); T.xs.push([c[0], c, 'center']); T.ys.push([c[1], c, 'center']);
  };
  addRect({x0:0, y0:0, x1:Doc.width, y1:Doc.height}, 'artboard');   // doc.artboards（本画板＝整张文件一块）
  // doc.walk：只看节点自己的 visible（我们的形状没有）⇒ 图层藏起来里面的东西照样当目标；budget 每个锚点扣 1
  let budget = 20000;
  for (const L of Doc.layers){
    const ox = L.x || 0, oy = L.y || 0;
    if (L.kind === 'vector'){
      for (const s of (L.data.shapes || [])){
        if (budget === 0) break;
        const g = lineShapeGeom(s, ox, oy); if (!g) continue;
        g.anchors.forEach(a => { T.points.push([a, 'anchor']); budget = Math.max(0, budget - 1); });
        addRect(g.bounds, 'edge');
      }
    } else if (budget > 0 && L.kind === 'raster' && L.data && L.data.canvas){
      const pl = L._place;                                // AI：置入的图＝影像物件，吸它自己的外框（engine placeImageFromURL 记的 _place）
      if (Array.isArray(pl) && pl.length === 4 && pl.every(Number.isFinite)) addRect({x0:ox + pl[0], y0:oy + pl[1], x1:ox + pl[0] + pl[2], y1:oy + pl[1] + pl[3]}, 'edge');
      else addRect({x0:ox, y0:oy, x1:ox + L.data.canvas.width, y1:oy + L.data.canvas.height}, 'edge');   // NodeKind::Image 外框
    }
  }
  return T;
}
function lineSnapPoint(T, p, tol){
  let best = null, bd = Infinity;
  for (const [q, k] of T.points){ const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d <= tol && d < bd){ best = [q, k]; bd = d; } }
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
/* snap_draw：智能参考线关着就原样回；tol＝cx.tol(5.0)＝5 萤幕像素 */
function lineSnapDraw(p, on){
  if (!on) return { p:[p[0], p[1]], guides:[] };
  return lineSnapPoint(lineCollectTargets(), p, 5 / Math.max(UI.zoom || 1, 1e-9));
}

/* ───────── 外观（create.rs:301-306 ＋ PS 粗细）───────── */
if (ToolState.lineWeight === undefined) ToolState.lineWeight = 3;       // photocraft state.rs:449 line_weight: 3.0
if (ToolState.smartGuides === undefined) ToolState.smartGuides = true;  // VectorCraft 预设开
function lineLook(p){
  const sw = UI.strokeW();
  // 线只描边不填色；描边是「无」⇒ 黑（create.rs:304）
  const stroke = (p.stroke !== undefined && p.stroke !== null && p.stroke !== 'none') ? p.stroke
               : (sw > 0 && UI.stroke() !== 'none' ? UI.stroke() : '#000000');
  // 粗细：给了就用；否则描边宽 > 0 用描边宽（AI），描边为无用选项栏「粗细」（PS）；最后夹 ≥ 0.1（create.rs:305 stroke_width.max(0.1)）
  let w = (typeof p.strokeWidth === 'number' && Number.isFinite(p.strokeWidth)) ? p.strokeWidth
        : (sw > 0 ? sw : ToolState.lineWeight);
  return { fill:'none', stroke, strokeWidth: Math.max(w, 0.1) };
}

/* ───────── 命令（agent 与滑鼠走同一条）───────── */
function lineAdd(c, p){
  const look = lineLook(p);
  const res = addShape(Object.assign({type:'line', points:[[c.x1, c.y1], [c.x2, c.y2]], closed:false}, look,
                                     p.layerId ? {layerId:p.layerId} : {}));
  if (res && res.id && window.VecSel) VecSel.setShapes(res.layerId, [res.id]);   // add_look：sel.set([id])，新画的线被选取
  return Object.assign({}, res, {x1:c.x1, y1:c.y1, x2:c.x2, y2:c.y2, stroke:look.stroke, strokeWidth:look.strokeWidth});
}
const lineNum = v => typeof v === 'number' && Number.isFinite(v);
CMD.reg('line.create', {i18n:'', undoable:true,
  params:'{x1, y1, x2, y2 两端（文件坐标，必填数字）, stroke?（预设＝目前描边色；描边为无＝黑）, strokeWidth?（预设＝描边宽；描边为无＝选项栏粗细；最小 0.1）, layerId?} ＝ VectorCraft shape.line：建一条直线段（只描边不填色），建好后选取它 → {id, layerId, x1, y1, x2, y2, stroke, strokeWidth}'},
  p => {
    if (![p.x1, p.y1, p.x2, p.y2].every(lineNum)) return {ok:false, error:'line.create: x1,y1,x2,y2 are required numbers'};   // f64_req
    return lineAdd({x1:p.x1, y1:p.y1, x2:p.x2, y2:p.y2}, p);
  });
CMD.reg('line.drag', {i18n:'', undoable:true,
  params:'{x1,y1 按下点, x2,y2 放开点（文件坐标）, shift=false 绕起点锁 45°, alt=false 以按下点为中点, snap=false 两点先套智能参考线吸附, stroke?, strokeWidth?, layerId?} 等同拿直线段工具从 (x1,y1) 拖到 (x2,y2) → {id, layerId, x1, y1, x2, y2, …}'},
  p => {
    if (![p.x1, p.y1, p.x2, p.y2].every(lineNum)) return {ok:false, error:'line.drag: x1,y1,x2,y2 are required numbers'};
    let a = [p.x1, p.y1], b = [p.x2, p.y2];
    if (p.snap){ a = lineSnapDraw(a, true).p; b = lineSnapDraw(b, true).p; }
    return lineAdd(lineCommand(a, b, {shift:!!p.shift, alt:!!p.alt}), p);
  });
CMD.reg('line.dialog', {i18n:'', undoable:true,
  params:'{x, y 起点（文件坐标）, length=100（数字或带单位／算式字串："2in"、"100/2"、"1p6"）, angle=0（度，逆时针为正；数字或字串）, stroke?, strokeWidth?, layerId?} 等同点一下后在「直线段工具选项」填长度角度按确定：终点＝(x + length·cos a, y − length·sin a) → {id, layerId, x1, y1, x2, y2, …}'},
  p => {
    const x = lineF64(p.x, 0), y = lineF64(p.y, 0);                     // shapes.rs:24 d.f64("x", 0.0)
    const l = lineF64(p.length, 100), a = lineF64(p.angle, 0) * Math.PI / 180;
    const c = {x1:x, y1:y, x2:x + l * Math.cos(a), y2:y - l * Math.sin(a)};
    if (![c.x1, c.y1, c.x2, c.y2].every(Number.isFinite)) return {ok:false, error:'line.dialog: invalid values'};
    return lineAdd(c, p);
  });
CMD.reg('line.setOption', {i18n:'',
  params:'{weight? 粗细 1..1000 px（描边为无时线的粗细；PS 直线工具的 Weight，预设 3）, smartGuides? 拖曳时吸附锚点／中心／边（预设 true）} → 目前选项；不给参数＝读'},
  p => {
    if (p.weight !== undefined){ const v = +p.weight; ToolState.lineWeight = Math.min(Math.max(Number.isFinite(v) ? v : 3, 1), 1000); }
    if (p.smartGuides !== undefined) ToolState.smartGuides = !!p.smartGuides;
    if (ToolState.cur === 'line' && window.UI) UI.buildOptions('line');
    return {weight:ToolState.lineWeight, smartGuides:ToolState.smartGuides !== false};
  });

/* ───────── 工具状态（ShapeTool 栏位：start / last / mods / began / guides）───────── */
const LINE_LAYER_COLORS = ['#4f80ff','#ff4f4f','#4fff4f','#4f4fff','#ffff4f','#ff4fff','#4fffff','#808080','#000000',
  '#ff6600','#008000','#008080','#cc9966','#993300','#9933ff','#ff9900','#000080','#ff99cc','#9999ff','#990000',
  '#666600','#ff9999','#990033','#99cc00','#996600','#660099','#bbbbbb'];      // doc/src/node.rs LAYER_COLORS
const LineTool = {
  start: null, last: [0, 0], mods: {shift:false, alt:false}, began: false, guides: [], dlg: null,

  busy(){ return !!this.start; },                         // shape.rs:110
  reset(){ this.start = null; this.began = false; this.guides = []; },
  /* 「直线段工具选项」对话框：栏位照键名排序 ⇒ 角度、长度；长度是长度栏（离开栏位换算＋格式化），角度是一般字栏 */
  openDialog(x, y){
    this.closeDialog();
    const t = k => Lang.t(k);
    const bg = document.createElement('div');
    bg.id = 'lineDlg';
    bg.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.25)';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--bg2,#262626);color:var(--fg,#d6d6d6);border:1px solid var(--line,#3a3a3a);border-radius:6px;padding:14px 16px;min-width:260px;font:13px sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)';
    const h = document.createElement('div');
    h.textContent = t('ui.lineDlgTitle'); h.style.cssText = 'font-weight:bold;margin-bottom:10px';
    box.appendChild(h);
    const row = (key, label, value) => {
      const r = document.createElement('label');
      r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0';
      const sp = document.createElement('span'); sp.textContent = label; sp.style.color = 'var(--fg2,#9a9a9a)';
      const inp = document.createElement('input'); inp.type = 'text'; inp.name = key; inp.value = value;
      inp.style.cssText = 'width:120px;background:var(--bg3,#2f2f2f);color:inherit;border:1px solid var(--line,#3a3a3a);border-radius:3px;padding:3px 6px';
      inp.addEventListener('focus', () => inp.select());
      r.appendChild(sp); r.appendChild(inp); box.appendChild(r);
      return inp;
    };
    const aIn = row('angle', t('ui.lineDlgAngle'), '0');                // tools.rs:18 angle: 0（数字 ⇒ d.str 显示 "0"）
    const lIn = row('length', t('ui.lineDlgLength'), lineFormatLen(100));   // length: "100 pt" ⇒ 显示 100 px
    // widgets.rs num_field：离开栏位时字串改过就 Unit::parse，成功才收、失败退回旧值
    lIn._val = 100;
    lIn.commit = () => {
      if (lIn.value !== lineFormatLen(lIn._val)){ const v = lineUnitParse(lIn.value); if (v !== null) lIn._val = v; }
      lIn.value = lineFormatLen(lIn._val);
    };
    lIn.addEventListener('blur', () => lIn.commit());
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px';
    const mkBtn = (label, name, primary) => {
      const b = document.createElement('button'); b.textContent = label; b.name = name;
      b.style.cssText = 'padding:4px 14px;border-radius:3px;border:1px solid var(--line,#3a3a3a);cursor:pointer;color:#fff;background:' + (primary ? 'var(--accent,#2f7fd8)' : 'var(--bg3,#2f2f2f)');
      btns.appendChild(b); return b;
    };
    const cancel = mkBtn(t('ui.lineCancel'), 'cancel', false);
    const okB = mkBtn(t('ui.lineOK'), 'ok', true);
    box.appendChild(btns); bg.appendChild(box);
    const confirm = () => {
      lIn.commit();                                       // 正在打的那一栏先收
      const length = lIn._val, angle = aIn.value;         // 角度是一般字栏：原字串交给 Dialog::f64（解析不了＝0）
      this.closeDialog();
      CMD.run('line.dialog', {x, y, length, angle});
    };
    okB.onclick = e => { e.stopPropagation(); confirm(); };
    cancel.onclick = e => { e.stopPropagation(); this.closeDialog(); };
    bg.addEventListener('pointerdown', e => { if (e.target === bg){ e.stopPropagation(); this.closeDialog(); } });
    bg.addEventListener('keydown', e => {
      e.stopPropagation();                                // 对话框开着时按键不漏给画板快捷键
      if (e.key === 'Enter'){ e.preventDefault(); confirm(); }
      else if (e.key === 'Escape'){ e.preventDefault(); this.closeDialog(); }
    });
    document.body.appendChild(bg);
    this.dlg = bg;
    lIn.focus(); lIn.select();                            // 我们加的：游标先落在长度栏（原码不自动聚焦）
  },
  closeDialog(){ if (this.dlg){ this.dlg.remove(); this.dlg = null; } }
};
window.LineTool = LineTool;

const LINE_STRINGS = {
  'zh-Hant':{
    'tool.line':'直線段',
    'ui.lineHint':'拖曳＝畫直線｜Shift＝鎖 45°｜Alt＝從中點畫｜點一下＝輸入長度角度｜拖曳中 Esc 取消｜描邊為無時用「粗細」畫黑線',
    'ui.lineDlgTitle':'直線區段工具選項', 'ui.lineDlgAngle':'角度：', 'ui.lineDlgLength':'長度：', 'ui.lineOK':'確定', 'ui.lineCancel':'取消',
    'ui.lineW':'寬', 'ui.lineH':'高',
    'ui.lineSnap.anchor':'錨點', 'ui.lineSnap.center':'中心點', 'ui.lineSnap.align':'對齊',
    'opt.lineWeight':'粗細', 'opt.lineSmartGuides':'智慧型參考線'
  },
  'zh-Hans':{
    'tool.line':'直线段',
    'ui.lineHint':'拖曳＝画直线｜Shift＝锁 45°｜Alt＝从中点画｜点一下＝输入长度角度｜拖曳中 Esc 取消｜描边为无时用「粗细」画黑线',
    'ui.lineDlgTitle':'直线段工具选项', 'ui.lineDlgAngle':'角度：', 'ui.lineDlgLength':'长度：', 'ui.lineOK':'确定', 'ui.lineCancel':'取消',
    'ui.lineW':'宽', 'ui.lineH':'高',
    'ui.lineSnap.anchor':'锚点', 'ui.lineSnap.center':'中心点', 'ui.lineSnap.align':'对齐',
    'opt.lineWeight':'粗细', 'opt.lineSmartGuides':'智能参考线'
  },
  'en':{
    'tool.line':'Line Segment',
    'ui.lineHint':'Drag to draw | Shift: 45° steps | Alt: from midpoint | Click for length & angle | Esc while dragging cancels | Stroke None: black line at Weight',
    'ui.lineDlgTitle':'Line Segment Tool Options', 'ui.lineDlgAngle':'Angle:', 'ui.lineDlgLength':'Length:', 'ui.lineOK':'OK', 'ui.lineCancel':'Cancel',
    'ui.lineW':'W', 'ui.lineH':'H',
    'ui.lineSnap.anchor':'anchor', 'ui.lineSnap.center':'center', 'ui.lineSnap.align':'align',
    'opt.lineWeight':'Weight', 'opt.lineSmartGuides':'Smart Guides'
  }
};
Lang.add(LINE_STRINGS);   // Lang 是 const、登记处判 window.Lang 可能还没挂上 ⇒ 自己并进字典

Tools.reg({
  id:'line', icon:'╲', key:'\\', group:'vector', order:35, for:'vector', needs:'vector', opts:[],
  hint:'ui.lineHint', cursor:'crosshair', strings:LINE_STRINGS,

  /* 选项栏：PS 的「粗细」（1..1000 px）＋ VectorCraft 的智能参考线开关 */
  buildOptions(box, add, mk){
    const w = mk('number', {min:1, max:1000, step:1, value:ToolState.lineWeight});
    w.style.width = '58px';
    w.onchange = () => CMD.run('line.setOption', {weight:+w.value});
    add('lineWeight', w);
    const c = mk('checkbox', {checked: ToolState.smartGuides !== false});
    c.onchange = () => { ToolState.smartGuides = c.checked; };
    add('lineSmartGuides', c);
  },

  /* PointerKind::Down：吸附后的点当起点；last 记原始点；began 归零 */
  onDown(e, pt){
    if (e.button !== undefined && e.button !== 0) return;
    const S = LineTool;
    S.start = lineSnapDraw(pt, ToolState.smartGuides !== false).p;
    S.last = [pt[0], pt[1]];
    S.began = false;
  },
  /* PointerKind::Drag：吸附、记修饰键（只有滑鼠动时才取样）；没拖满 2 萤幕像素不开始 */
  onMove(e, pt, P){
    const S = LineTool;
    if (!P.down || !S.start) return;
    const sn = lineSnapDraw(pt, ToolState.smartGuides !== false);
    S.guides = sn.guides;
    S.last = sn.p;
    S.mods = {shift:!!e.shiftKey, alt:!!e.altKey};
    if (!S.began){
      if (Math.hypot(S.last[0] - S.start[0], S.last[1] - S.start[1]) < 2 / Math.max(UI.zoom, 1e-9)) return;
      S.began = true;                                     // Action::Begin("Line")
    }
    UI.draw();                                            // Action::Preview
  },
  /* PointerKind::Up：开始过 ⇒ Commit（＝最后一次预览：最后拖到的点＋当时的修饰键）；没开始 ⇒ 对话框 */
  onUp(){
    const S = LineTool;
    const s = S.start; if (!s){ UI.draw(); return; }
    S.start = null; S.guides = [];
    if (S.began){
      S.began = false;
      CMD.run('line.drag', {x1:s[0], y1:s[1], x2:S.last[0], y2:S.last[1], shift:S.mods.shift, alt:S.mods.alt});
    } else {
      UI.draw();
      S.openDialog(s[0], s[1]);
    }
  },
  /* key()：lineSegment 没有 ↑↓ 参数；开始拖了才吃 Esc */
  onKey(e){
    const S = LineTool;
    if (!S.start || !S.began) return false;
    if (e.key === 'Escape'){ e.preventDefault(); S.reset(); UI.draw(); return true; }
    return false;
  },
  onDeactivate(){ LineTool.reset(); LineTool.closeDialog(); },

  /* overlays()：
     闲着 ⇒ 画目前的物件选取（canvas.rs 选取叠画；新画的线 add_look 后是选中的）
     拖着 ⇒ ① 预览＝真的那条线（目前描边）＋ 新物件选取框（图层色 1px 线＋两端 4px 实心方块；线段不显示中心点 node.rs:1076）
            ② 洋红智能参考线与标签（点右上 8,-14）  ③ 游标右下 14,14 的灰底量测框「宽／高」（量 last − start） */
  drawOverlay(ctx, s){
    const S = LineTool;
    if (!S.start || !S.began){ if (window.VecSel) VecSel.drawOverlay(ctx, s); return; }
    const dpr = s / Math.max(UI.zoom, 1e-9);
    const c = lineCommand(S.start, S.last, S.mods);
    const look = lineLook({});
    const L = Doc.active();
    ctx.save();
    if (L && L.kind === 'vector') ctx.globalAlpha = L.opacity;
    drawShape(ctx, Object.assign({type:'line', points:[[c.x1, c.y1], [c.x2, c.y2]]}, look), s);
    ctx.restore();
    ctx.save();
    const li = L && L.kind === 'vector' ? Math.max(0, Doc.index(L.id)) : Doc.layers.length;
    const col = LINE_LAYER_COLORS[li % LINE_LAYER_COLORS.length];
    ctx.beginPath(); ctx.moveTo(c.x1*s, c.y1*s); ctx.lineTo(c.x2*s, c.y2*s);
    ctx.lineWidth = 1 * dpr; ctx.strokeStyle = col; ctx.stroke();
    [[c.x1, c.y1], [c.x2, c.y2]].forEach(p => { const q = 2 * dpr; ctx.fillStyle = col; ctx.fillRect(p[0]*s - q, p[1]*s - q, 2*q, 2*q); });
    const MAGENTA = '#ff3dfc';
    ctx.font = `${11*dpr}px sans-serif`; ctx.textBaseline = 'top';
    for (const g of S.guides){
      if (g.a){
        ctx.beginPath(); ctx.moveTo(g.a[0]*s, g.a[1]*s); ctx.lineTo(g.b[0]*s, g.b[1]*s);
        ctx.lineWidth = 1 * dpr; ctx.strokeStyle = MAGENTA; ctx.stroke();
      } else if (g.label){
        ctx.fillStyle = MAGENTA;
        ctx.fillText(Lang.t('ui.lineSnap.' + g.label), g.p[0]*s + 8*dpr, g.p[1]*s - 14*dpr);
      }
    }
    const dx = Math.abs(S.last[0] - S.start[0]), dy = Math.abs(S.last[1] - S.start[1]);
    const lines = [`${Lang.t('ui.lineW')}: ${dx.toFixed(2)} px`, `${Lang.t('ui.lineH')}: ${dy.toFixed(2)} px`];
    const bx = S.last[0]*s + 14*dpr, by = S.last[1]*s + 14*dpr;
    const tw = Math.max(...lines.map(l => ctx.measureText(l).width)), lh = 13 * dpr;
    ctx.fillStyle = 'rgba(92,92,92,' + (235/255) + ')';  // theme.rs measure_bg (92,92,92,235)
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, tw + 12*dpr, lh*lines.length + 8*dpr, 3*dpr);
    else ctx.rect(bx, by, tw + 12*dpr, lh*lines.length + 8*dpr);
    ctx.fill();
    ctx.fillStyle = '#fff';
    lines.forEach((l, i) => ctx.fillText(l, bx + 6*dpr, by + 4*dpr + i*lh));
    ctx.restore();
  }
});

/* shortcuts.rs:148-237：按着滑鼠（工具忙）时只有 Esc（与 ↑↓，直线段没用到）进工具，其余快捷键（Ctrl+Z、换工具键…）不响应。
   ui.js 的 keydown 先处理 Ctrl+Z 才问工具 ⇒ 这里用捕获阶段先拦。 */
document.addEventListener('keydown', e => {
  if (ToolState.cur !== 'line' || !LineTool.busy()) return;
  if (/input|select|textarea/i.test(e.target.tagName)) return;
  const T = Tools.get('line'); if (T) T.onKey(e);
  e.stopPropagation();
  if (e.ctrlKey || e.metaKey) e.preventDefault();
}, true);
