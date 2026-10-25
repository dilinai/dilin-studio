/* 移动工具（V）——照 ArtCraft／PhotoCraft 的 Rust 原码逐段翻译
   对照源（photocraft/crates/…）：
     ui-egui/src/canvas.rs           tool_event / finish_gesture / draw_drag_preview / Show Transform Controls
     ui-egui/src/move_mods.rs        ⇧ 锁轴（带迟滞）、⌥ 拖＝复制再移（合成一步）、方向键微移 1／⇧10 px
     ui-egui/src/move_ui.rs          拖的时候层就跟着游标走（整数位移），放开才落一条 translate
     ui-egui/src/snap_ui.rs ＋ engine/src/snap.rs   吸附（文件边／中线、别层边／中线、选区边）＋智慧参考线；拖时按 Ctrl 暂停吸附
     engine/src/pick_cmds.rs         自动选择（layer.pickAt）：按下点有像素的最上层；Ctrl 按下时反转这个选项
     engine/src/layer_multi_cmds.rs  translate / align / distribute
     ui-egui/src/transform_tool.rs   勾「显示变形控制项」后按把手 ⇒ 进自由变形（缩放／旋转／斜切）
   🔴 改文件的事全走 CMD：move.translate / move.pickAt / move.align / move.distribute / move.transform / move.options。
      拖曳中层跟着走只是「预览」：放开前先把位置还原，再跑一条 move.translate（一步历史），跟 PhotoCraft 一样。 */
(function(){

/* ── 常数（原码出处写在旁边） ── */
const SNAP_PX = 8;                         // snap_ui.rs:18  吸附距离＝8 个萤幕像素
const MOVE_DIRECTIONS = 4;                 // move_mods.rs:24  移动工具 ⇧ 锁水平／垂直
const TRANSFORM_DIRECTIONS = 8;            // move_mods.rs:26  自由变形里 ⇧ 锁 8 个方向
const HYSTERESIS_DEG = 8;                  // move_mods.rs:29  换轴要多越过 8°，免得在对角线附近闪
const DUPLICATE_THRESHOLD = 2;             // move_mods.rs:32  ⌥ 拖要真的动了 2 个萤幕像素才复制
const ACCENT = '#2f7fd8', SMART = '#ff00ff';
const TAU = Math.PI * 2;

/* Rust 的 f64::round 是「.5 远离零」，JS 的 Math.round 是「.5 往上」；照原码用前者 */
const rround = v => Math.sign(v) * Math.round(Math.abs(v));
const clamp7 = v => Math.max(-1e7, Math.min(1e7, v));

/* move_mods.rs:38 constrain —— 把位移锁到 n 个等分方向里最近的那个；prev 是上一次锁定的位移，
   没明显靠近别的方向前保持原方向（迟滞） */
function constrain(d, prev, n){
  const len = Math.hypot(d[0], d[1]);
  if (n === 0 || !isFinite(len) || len === 0) return d;
  const step = TAU / n;
  const a = Math.atan2(d[1], d[0]);
  let k = rround(a / step);
  if (prev && Math.hypot(prev[0], prev[1]) > 0){
    const kp = rround(Math.atan2(prev[1], prev[0]) / step);
    let off = (((a - kp * step) % TAU) + TAU) % TAU;          // rem_euclid
    off = Math.min(off, TAU - off);
    if (off < step / 2 + HYSTERESIS_DEG * Math.PI / 180) k = kp;
  }
  const s = Math.sin(k * step), c = Math.cos(k * step);
  const t = Math.max(0, d[0] * c + d[1] * s);
  const clean = v => Math.abs(v) < 1e-9 ? 0 : v;
  return [clean(t * c), clean(t * s)];
}

/* ── 图层外框（snap.rs layer_rect ＝ transform_bounds：图层「有像素」的外框，文件坐标 [x0,y0,x1,y1]） ── */
function alphaBounds(cv, ox, oy){
  const w = cv.width, h = cv.height; if (!w || !h) return null;
  const d = cv.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++){
    const row = y * w * 4;
    for (let x = 0; x < w; x++){
      if (d[row + x * 4 + 3]){
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; y1 = y;
      }
    }
  }
  return x1 < 0 ? null : [x0 + ox, y0 + oy, x1 + 1 + ox, y1 + 1 + oy];
}
/* 像素层的画布是图层坐标（要加 L.x/L.y）；矢量／文字层 renderLayer 出来已经是文件坐标 */
function layerRect(L){
  if (!L) return null;
  if (L.kind === 'raster') return alphaBounds(L.data.canvas, L.x, L.y);
  return alphaBounds(renderLayer(L, 1), 0, 0);
}
const union = rs => rs.reduce((a, b) => a ? [Math.min(a[0],b[0]), Math.min(a[1],b[1]), Math.max(a[2],b[2]), Math.max(a[3],b[3])] : b, null);

/* ── 自动选择（pick_cmds.rs layers_at）：该点有可见像素的层，最上面的先 ── */
function alphaAt(L, x, y){
  let cv, px = x, py = y;
  if (L.kind === 'raster'){ cv = L.data.canvas; px = x - L.x; py = y - L.y; }     // 铁律④：换成图层坐标
  else cv = renderLayer(L, 1);
  if (px < 0 || py < 0 || px >= cv.width || py >= cv.height) return 0;
  let a = cv.getContext('2d').getImageData(px, py, 1, 1).data[3] / 255;
  if (a > 0 && L.mask){                    // 遮罩跟 composite() 一样，贴在该层自己的画布上量
    const m = renderLayer(L.mask, 1);
    a *= (px < m.width && py < m.height) ? m.getContext('2d').getImageData(px, py, 1, 1).data[3] / 255 : 0;
  }
  return a;
}
function layersAt(x, y){
  const out = [];
  for (let i = Doc.layers.length - 1; i >= 0; i--){
    const L = Doc.layers[i];
    if (!L.visible) continue;
    if (alphaAt(L, x, y) > 0) out.push(L.id);
  }
  return out;
}

/* ── 吸附（engine/src/snap.rs 原样翻译） ── */
const isSmart = k => k === 'layerEdge' || k === 'layerCenter' || k === 'documentCenter';
function addRect(t, r, edge, center){
  const xs = [r[1], r[3]], ys = [r[0], r[2]];
  t.x.push({pos:r[0], kind:edge, span:xs}, {pos:r[2], kind:edge, span:xs}, {pos:(r[0]+r[2])/2, kind:center, span:xs});
  t.y.push({pos:r[1], kind:edge, span:ys}, {pos:r[3], kind:edge, span:ys}, {pos:(r[1]+r[3])/2, kind:center, span:ys});
}
const emptyTargets = () => ({x:[], y:[], grid:null});
const isEmpty = t => !t.x.length && !t.y.length && !t.grid;
function filtered(t, keep){ return {x:t.x.filter(a => keep(a.kind)), y:t.y.filter(a => keep(a.kind)), grid: keep('grid') ? t.grid : null}; }
/* SnapTargets::from_document；smart=true 时只留图层对齐（snap_ui.rs build） */
function buildTargets(exclude, smart){
  const W = Doc.width, H = Doc.height, t = emptyTargets();
  t.extent = [0, 0, W, H];
  addRect(t, [0, 0, W, H], 'documentEdge', 'documentCenter');                 // document
  for (const L of Doc.layers){                                                 // layers
    if (!L.visible || exclude.includes(L.id)) continue;
    const r = layerRect(L); if (r) addRect(t, r, 'layerEdge', 'layerCenter');
  }
  if (!smart && Doc.sel && Doc.sel.w > 0 && Doc.sel.h > 0){                    // selection（smart 时关）
    const s = Doc.sel, r = [s.x, s.y, s.x + s.w, s.y + s.h];
    t.x.push({pos:r[0], kind:'selection', span:[r[1], r[3]]}, {pos:r[2], kind:'selection', span:[r[1], r[3]]});
    t.y.push({pos:r[1], kind:'selection', span:[r[0], r[2]]}, {pos:r[3], kind:'selection', span:[r[0], r[2]]});
  }
  // 参考线（snap.rs SnapTarget::Guide）：PS 视图的标尺参考线（menus/impl/ps-view.js，跟 AI 共用 Doc.aiGuides）——视图 ▸ 对齐到 ▸ 参考线 勾着、参考线显示着才吸；格点仍空
  const PV = window.PsView;
  if (!smart && PV && PV.guides && PV.e && PV.e.guides && (!PV.snapTo || PV.snapTo.guides !== false) && (!PV.active || PV.active()))
    PV.guides().forEach(g => (g.vertical ? t.x : t.y).push({pos:g.pos, kind:'guide', span:[0, g.vertical ? H : W]}));
  return smart ? filtered(t, isSmart) : t;
}
/* SnapTargets::nearest —— 一个轴上 tol 内最近的目标；同距离时参考线优先 */
function nearest(t, vertical, v, tol){
  const list = vertical ? t.x : t.y;
  let best = null;
  const consider = a => {
    const d = Math.abs(a.pos - v); if (d > tol) return;
    const better = !best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && a.kind === 'guide' && best.t.kind !== 'guide');
    if (better) best = {d, t:a};
  };
  list.forEach(consider);
  if (t.grid){
    const g = rround(v / t.grid) * t.grid, e = t.extent || [0, 0, Doc.width, Doc.height];
    consider({pos:g, kind:'grid', span: vertical ? [e[1], e[3]] : [e[0], e[2]]});
  }
  return best ? best.t : null;
}
const line = (vertical, t, a, b) => ({vertical, pos:t.pos, from:Math.min(t.span[0], a, b), to:Math.max(t.span[1], a, b), kind:t.kind});
/* SnapTargets::snap_point —— 两轴各自吸到最近的目标 */
function snapPoint(t, p, tol){
  const out = p.slice(), lines = [];
  const a = nearest(t, true, p[0], tol);  if (a){ out[0] = a.pos; lines.push(line(true, a, p[1], p[1])); }
  const b = nearest(t, false, p[1], tol); if (b){ out[1] = b.pos; lines.push(line(false, b, out[0], out[0])); }
  return [out, lines];
}
/* SnapTargets::snap_rect —— 移动中的框：每个轴取「边或中线」里离目标最近的那个来修正 */
function snapRect(t, r, tol){
  const delta = [0, 0], lines = [];
  for (const [axis, vertical] of [[0, true], [1, false]]){
    const a = r[axis], b = r[axis + 2], anchors = [a, (a + b) / 2, b];
    let best = null;
    for (const v of anchors){
      const n = nearest(t, vertical, v, tol);
      if (n){ const d = n.pos - v; if (!best || Math.abs(d) < best[0]) best = [Math.abs(d), d]; }
    }
    if (!best) continue;
    const d = best[1]; delta[axis] = d;
    const other = vertical ? [r[1], r[3]] : [r[0], r[2]];
    for (const v of anchors){
      const moved = v + d, list = vertical ? t.x : t.y;
      let hit = list.filter(x => Math.abs(x.pos - moved) < 1e-6).sort((p, q) => (p.kind !== 'guide') - (q.kind !== 'guide'))[0];
      if (!hit && t.grid && Math.abs(rround(moved / t.grid) * t.grid - moved) < 1e-6) hit = {pos:moved, kind:'grid', span:other};
      if (hit) lines.push(line(vertical, hit, other[0], other[1]));
    }
  }
  return [delta, lines];
}

/* ── 自由变形的几何（transform_tool.rs） ── */
const corners = r => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
/* 选项栏的参考点定位器（PS：九个小方格）：名字 → 框自己的单位座标 (u, v) */
const LOCATOR = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'];
const LOC_UV = {tl:[0, 0], t:[.5, 0], tr:[1, 0], l:[0, .5], c:[.5, .5], r:[1, .5], bl:[0, 1], b:[.5, 1], br:[1, 1]};
const REF_PREF = 'dlc.xfRefPoint';                       // 「切换参考点」勾不勾（PS 记在偏好里；PS 2019 起预设不勾）
const quadRect = q => [Math.min(...q.map(p => p[0])), Math.min(...q.map(p => p[1])), Math.max(...q.map(p => p[0])), Math.max(...q.map(p => p[1]))];
function inQuad(q, p){                       // snap_ui.rs in_quad / transform_tool.rs inside（even-odd）
  let c = false;
  for (let i = 0; i < 4; i++){
    const a = q[i], b = q[(i + 3) % 4];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function nearHandle(q, p, tol){              // snap_ui.rs near_handle
  for (let i = 0; i < 4; i++){
    const a = q[i], b = q[(i + 1) % 4], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if ([a, mid].some(h => Math.hypot(h[0] - p[0], h[1] - p[1]) <= tol)) return true;
  }
  return false;
}
function hitXf(t, p, tol, showPivot){        // transform_tool.rs hit（PS 2020：选项栏「切换参考点」没勾＝参考点不画、也抓不到）
  const d = a => Math.hypot(a[0] - p[0], a[1] - p[1]);
  if (showPivot !== false && d(t.pivot) < tol) return {type:'pivot'};
  for (let i = 0; i < 4; i++) if (d(t.quad[i]) < tol) return {type:'corner', i};
  for (let i = 0; i < 4; i++){
    const a = t.quad[i], b = t.quad[(i + 1) % 4];
    if (d([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) < tol) return {type:'edge', i};
  }
  return {type: inQuad(t.quad, p) ? 'inside' : 'outside'};
}
/* algo/transform.rs Homography：单位框 → 四边形（扭曲／透视过的框也照它自己的轴缩放；transform_tool.rs apply_drag 用 rect_to_quad([0,0,1,1], quad0)） */
function squareToQuad(q){
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1];
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-12) return null;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}
const hApply = (m, x, y) => { const w = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]; };
function hInverse(m){
  const c = [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
             m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
             m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]];
  const det = m[0] * c[0] + m[1] * c[3] + m[2] * c[6];
  return Math.abs(det) < 1e-12 ? null : c.map(v => v / det);
}
function unitFrame(q){
  const H = squareToQuad(q), I = H && hInverse(H);
  return {apply:(u, v) => hApply(H, u, v), inv: I ? (x, y) => hApply(I, x, y) : null};
}
/* rect → quad 的对应（文件坐标；扭曲／透视预览用） */
function rectToQuadFn(r, q){
  const w = r[2] - r[0], h = r[3] - r[1], H = squareToQuad(q); if (!(w > 0 && h > 0) || !H) return null;
  return (x, y) => hApply(H, (x - r[0]) / w, (y - r[1]) / h);
}
/* 一个三角形的贴图（仿射）：来源 s0..s2（图片像素）→ 画面 d0..d2；剪裁往外撑一点免得露缝（同 ps-edit 变形预览） */
function texTri(ctx, img, s0, s1, s2, d0, d1, d2){
  const ax = s1[0] - s0[0], ay = s1[1] - s0[1], bx = s2[0] - s0[0], by = s2[1] - s0[1], det = ax * by - bx * ay;
  if (Math.abs(det) < 1e-12) return;
  const cx = d1[0] - d0[0], cy = d1[1] - d0[1], ex = d2[0] - d0[0], ey = d2[1] - d0[1];
  const m00 = (cx * by - ex * ay) / det, m01 = (ex * ax - cx * bx) / det, m10 = (cy * by - ey * ay) / det, m11 = (ey * ax - cy * bx) / det;
  const tx = d0[0] - m00 * s0[0] - m01 * s0[1], ty = d0[1] - m10 * s0[0] - m11 * s0[1];
  const g = [(d0[0] + d1[0] + d2[0]) / 3, (d0[1] + d1[1] + d2[1]) / 3];
  const grow = p => { const dx = p[0] - g[0], dy = p[1] - g[1], l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * 0.6, p[1] + dy / l * 0.6]; };
  const q0 = grow(d0), q1 = grow(d1), q2 = grow(d2);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.closePath(); ctx.clip();
  ctx.transform(m00, m10, m01, m11, tx, ty);
  const kx0 = Math.max(0, Math.floor(Math.min(s0[0], s1[0], s2[0])) - 2), ky0 = Math.max(0, Math.floor(Math.min(s0[1], s1[1], s2[1])) - 2);
  const kx1 = Math.min(img.width, Math.ceil(Math.max(s0[0], s1[0], s2[0])) + 2), ky1 = Math.min(img.height, Math.ceil(Math.max(s0[1], s1[1], s2[1])) + 2);
  if (kx1 > kx0 && ky1 > ky0) ctx.drawImage(img, kx0, ky0, kx1 - kx0, ky1 - ky0, kx0, ky0, kx1 - kx0, ky1 - ky0);   // 只画这一小块（整张图画 1152 次太慢）
  ctx.restore();
}
/* 原框 rect → 四边形 quad 的仿射矩阵 [a,b,c,d,e,f]（文件坐标）；不是平行四边形就回 null */
function rectQuadMatrix(rect, q){
  const w = rect[2] - rect[0], h = rect[3] - rect[1];
  if (!(w > 0 && h > 0)) return null;
  const tol = 1e-3 * Math.max(1, Math.abs(q[1][0] - q[0][0]) + Math.abs(q[3][1] - q[0][1]));
  if (Math.abs(q[2][0] - (q[1][0] + q[3][0] - q[0][0])) > tol || Math.abs(q[2][1] - (q[1][1] + q[3][1] - q[0][1])) > tol) return null;
  const a = (q[1][0] - q[0][0]) / w, b = (q[1][1] - q[0][1]) / w;
  const c = (q[3][0] - q[0][0]) / h, d = (q[3][1] - q[0][1]) / h;
  return [a, b, c, d, q[0][0] - a * rect[0] - c * rect[1], q[0][1] - b * rect[0] - d * rect[1]];
}

/* 把一个矢量形状套上仿射（图层坐标）。轴向缩放保留原种类；有旋转／斜切时矩形／椭圆／星形变成路径
   （PS 也是：活形状一转就变成一般路径）。 */
function xfShape(s, m){
  const ap = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const axis = Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
  const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const style = {id:s.id, fill:s.fill, stroke:s.stroke, strokeWidth:(s.strokeWidth || 0) * k};
  const box = () => { const a = ap(s.x, s.y), b = ap(s.x + s.w, s.y + s.h);
    return {x:Math.min(a[0], b[0]), y:Math.min(a[1], b[1]), w:Math.abs(b[0] - a[0]), h:Math.abs(b[1] - a[1])}; };
  if (s.type === 'rect'){
    if (axis) return Object.assign({}, s, style, box(), s.radius ? {radius:s.radius * Math.min(Math.abs(m[0]), Math.abs(m[3]))} : {});
    return Object.assign(style, {type:'path', closed:true, points:corners([s.x, s.y, s.x + s.w, s.y + s.h]).map(p => ap(p[0], p[1]))});
  }
  if (s.type === 'ellipse'){
    if (axis) return Object.assign({}, s, style, box());
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2, rx = s.w / 2, ry = s.h / 2, K = 0.5522847498;
    const A = [
      {x:cx + rx, y:cy, in:[cx + rx, cy - K * ry], out:[cx + rx, cy + K * ry]},
      {x:cx, y:cy + ry, in:[cx + K * rx, cy + ry], out:[cx - K * rx, cy + ry]},
      {x:cx - rx, y:cy, in:[cx - rx, cy + K * ry], out:[cx - rx, cy - K * ry]},
      {x:cx, y:cy - ry, in:[cx - K * rx, cy - ry], out:[cx + K * rx, cy - ry]}];
    return Object.assign(style, {type:'bezier', closed:true, anchors:A.map(a => ({x:ap(a.x, a.y)[0], y:ap(a.x, a.y)[1], in:ap(a.in[0], a.in[1]), out:ap(a.out[0], a.out[1])}))});
  }
  if (s.type === 'star' || s.type === 'polygon'){
    if (axis && Math.abs(m[0] - m[3]) < 1e-9 && m[0] > 0){
      const c = ap(s.cx, s.cy);
      return Object.assign({}, s, style, {cx:c[0], cy:c[1], r1:s.r1 * m[0]}, s.type === 'star' ? {r2:s.r2 * m[0]} : {});
    }
    const n = s.points || (s.type === 'star' ? 5 : 6), steps = s.type === 'star' ? n * 2 : n;
    const rot = (s.rotation || 0) * Math.PI / 180 - Math.PI / 2, pts = [];
    for (let i = 0; i < steps; i++){
      const r = (s.type === 'star' && i % 2) ? s.r2 : s.r1, a = rot + i * TAU / steps;
      pts.push(ap(s.cx + Math.cos(a) * r, s.cy + Math.sin(a) * r));
    }
    return Object.assign(style, {type:'path', closed:true, points:pts});
  }
  if (s.type === 'path' || s.type === 'line') return Object.assign({}, s, style, {points:(s.points || []).map(p => ap(p[0], p[1]))});
  if (s.type === 'bezier') return Object.assign({}, s, style, {anchors:(s.anchors || []).map(a => {
    const p = ap(a.x, a.y); return {x:p[0], y:p[1], in:a.in ? ap(a.in[0], a.in[1]) : null, out:a.out ? ap(a.out[0], a.out[1]) : null}; })});
  return s;
}

/* ═══════════════ 命令（agent 与滑鼠走同一条路） ═══════════════ */

/* engine/src/pick_cmds.rs pick */
CMD.reg('move.pickAt', {i18n:'', params:'{x, y 文件坐标, select=true, list=false} 自动选择：取该点有可见像素的最上层（照 PhotoCraft layer.pickAt）→ {layer:id|null} 或 list=true 时 {layers:[{layer,name}]}'}, p => {
  if (typeof p.x !== 'number' || typeof p.y !== 'number') return {ok:false, error:'missing x / y'};
  const hits = layersAt(Math.floor(p.x), Math.floor(p.y));
  if (p.list) return {layers: hits.map(id => ({layer:id, name:Doc.byId(id).name}))};
  if (!hits.length) return {layer:null};
  if (p.select !== false) Doc.activeId = hits[0];
  return {layer:hits[0]};
});

/* layer_multi_cmds.rs translate（＋move_mods.rs 的 ⌥ 复制：duplicate=true 时复制与移动同一步历史） */
CMD.reg('move.translate', {i18n:'', params:'{dx, dy 整数像素, layerId?, duplicate=false} 移动图层（像素／矢量／文字层一视同仁）；duplicate=true ＝ 先复制再移副本（⌥ 拖／⌥ 方向键），一步历史', undoable:true}, p => {
  let L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  if (!L) return {ok:false, error:'no active layer'};
  const dx = clamp7(rround(+p.dx || 0)), dy = clamp7(rround(+p.dy || 0));
  if (p.duplicate){
    const r = CMD.map['layer.duplicate'].run({id:L.id});
    if (!r || !r.id) return {ok:false, error:'duplicate failed'};
    L = Doc.byId(r.id);
  }
  if (dx || dy){ L.x += dx; L.y += dy; Layer.invalidate(L); }
  return {ok:true, id:L.id, x:L.x, y:L.y};
});

/* layer_multi_cmds.rs align：边的坐标乘 2 免得中线出小数 */
const EDGES = ['leftEdges', 'horizontalCenters', 'rightEdges', 'topEdges', 'verticalCenters', 'bottomEdges'];
const edgeV = e => e === 'topEdges' || e === 'verticalCenters' || e === 'bottomEdges';
function value2(e, r){
  const [a, b] = edgeV(e) ? [r[1], r[3]] : [r[0], r[2]];
  if (e === 'topEdges' || e === 'leftEdges') return 2 * a;
  if (e === 'bottomEdges' || e === 'rightEdges') return 2 * b;
  return a + b;
}
const selRect = () => Doc.sel ? [Doc.sel.x, Doc.sel.y, Doc.sel.x + Doc.sel.w, Doc.sel.y + Doc.sel.h] : null;
function bounded(ids){ return ids.map(id => Doc.byId(id)).filter(Boolean).map(L => [L, layerRect(L)]).filter(x => x[1]); }
CMD.reg('move.align', {i18n:'', params:'{edge:"leftEdges|horizontalCenters|rightEdges|topEdges|verticalCenters|bottomEdges", to:"auto|layers|selection|canvas"="auto", ids?:[layerId…] 缺省＝当前层} 对齐（auto：单层＋有选区⇒对选区；单层无选区⇒对画布；多层⇒对它们的联集）', undoable:true}, p => {
  const edge = p.edge; if (!EDGES.includes(edge)) return {ok:false, error:'unknown edge'};
  const ids = (p.ids && p.ids.length) ? p.ids : (Doc.activeId ? [Doc.activeId] : []);
  const to = p.to || 'auto';
  const items = bounded(ids);
  if (!items.length) return {ok:false, error:'the selected layers have no content to align'};
  let target;
  if (to === 'canvas') target = [0, 0, Doc.width, Doc.height];
  else if (to === 'selection'){ target = selRect(); if (!target) return {ok:false, error:'there is no selection to align to'}; }
  else if (to === 'auto' || to === 'layers'){
    if (to === 'auto' && ids.length === 1) target = selRect() || [0, 0, Doc.width, Doc.height];
    else target = union(items.map(x => x[1]));
  } else return {ok:false, error:'`to` must be auto|layers|selection|canvas'};
  if (!(target[2] > target[0] || target[3] > target[1])) return {ok:false, error:'nothing to align to'};
  const t2 = value2(edge, target); let moved = 0;
  for (const [L, r] of items){
    const d = Math.floor((t2 - value2(edge, r)) / 2);                         // div_euclid(2)
    if (!d) continue;
    if (edgeV(edge)) L.y += d; else L.x += d;
    Layer.invalidate(L); moved++;
  }
  return {moved};
});

/* layer_multi_cmds.rs distribute：要三层以上 */
CMD.reg('move.distribute', {i18n:'', params:'{kind:"leftEdges|horizontalCenters|rightEdges|topEdges|verticalCenters|bottomEdges|horizontally|vertically", ids:[layerId…] ≥3} 分布（horizontally/vertically＝间距相等，最外两层不动）', undoable:true}, p => {
  const items = bounded(p.ids || []);
  if (items.length < 3) return {ok:false, error:'distributing needs three or more layers with content'};
  const n = items.length, moves = [];
  if (p.kind === 'horizontally' || p.kind === 'vertically'){
    const v = p.kind === 'vertically';
    const lo = r => v ? r[1] : r[0], hi = r => v ? r[3] : r[2];
    items.sort((A, B) => (lo(A[1]) + hi(A[1])) - (lo(B[1]) + hi(B[1])) || lo(A[1]) - lo(B[1]));
    const span = hi(items[n - 1][1]) - lo(items[0][1]);
    const total = items.reduce((s, x) => s + hi(x[1]) - lo(x[1]), 0);
    const gap = (span - total) / (n - 1);
    let cursor = lo(items[0][1]);
    for (const [L, r] of items){
      const d = rround(cursor) - lo(r);
      moves.push(v ? [L, 0, d] : [L, d, 0]);
      cursor += (hi(r) - lo(r)) + gap;
    }
  } else if (EDGES.includes(p.kind)){
    items.sort((A, B) => value2(p.kind, A[1]) - value2(p.kind, B[1]));
    const first = value2(p.kind, items[0][1]), last = value2(p.kind, items[n - 1][1]);
    items.forEach(([L, r], i) => {
      const want2 = first + (last - first) * i / (n - 1);
      const d = rround((want2 - value2(p.kind, r)) / 2);
      moves.push(edgeV(p.kind) ? [L, 0, d] : [L, d, 0]);
    });
  } else return {ok:false, error:'unknown kind'};
  let moved = 0;
  for (const [L, dx, dy] of moves){ if (dx || dy){ L.x += dx; L.y += dy; Layer.invalidate(L); moved++; } }
  return {moved};
});

/* edit.transform 的仿射部分（transform_tool.rs commit → engine edit.transform） */
CMD.reg('move.transform', {i18n:'', params:'{layerId?, rect?:[x0,y0,x1,y1] 原框（文件坐标；缺省＝该层内容外框）, quad?:[[x,y]×4] 四角去处（左上起顺时针）| matrix?:[a,b,c,d,e,f] 文件坐标仿射, interpolation="bicubic|bilinear|nearest"} 自由变形：缩放／旋转／斜切／翻转；只收平行四边形（扭曲／透视不收）。矢量形状有旋转时变成路径；文字层：位移＋等比缩放直接改字位与字号，斜切／旋转／翻转／不等比记进图层的变形（data.xform），之后改字改样式照样带着', undoable:true}, p => {
  const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  if (!L) return {ok:false, error:'no active layer'};
  let M = p.matrix;
  if (!M){
    const rect = p.rect || layerRect(L);
    if (!rect) return {ok:false, error:'the layer is empty'};
    if (!p.quad || p.quad.length !== 4) return {ok:false, error:'need quad or matrix'};
    M = rectQuadMatrix(rect, p.quad);
    if (!M) return {ok:false, error:'quad must be a parallelogram (distort / perspective not supported)'};
  }
  if (M.length !== 6 || M.some(v => !isFinite(v))) return {ok:false, error:'bad matrix'};
  // 文件坐标的仿射 → 图层坐标（图层内容 = 文件坐标 − L.x/L.y；铁律④）
  const ox = L.x, oy = L.y;
  let m = [M[0], M[1], M[2], M[3], M[4] + M[0] * ox + M[2] * oy - ox, M[5] + M[1] * ox + M[3] * oy - oy];
  if (L.kind === 'raster'){
    const cv = L.data.canvas, ctx = L.data.ctx;
    // 像素层的画布跟文件一样大：变形后若超出画布会被切掉。先算变形后内容在文件里的外框，
    // 能整个放进画布就把图层原点归到 (0,0)，否则把原点挪到让内容从画布左上角开始（PhotoCraft 的层无边界，这里尽量不丢像素）
    const b = alphaBounds(cv, ox, oy);
    if (b){
      const pts = corners(b).map(([x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]);
      const bx0 = Math.min(...pts.map(p => p[0])), bx1 = Math.max(...pts.map(p => p[0]));
      const by0 = Math.min(...pts.map(p => p[1])), by1 = Math.max(...pts.map(p => p[1]));
      const nx = (bx0 >= 0 && bx1 <= cv.width) ? 0 : Math.floor(bx0);
      const ny = (by0 >= 0 && by1 <= cv.height) ? 0 : Math.floor(by0);
      m = [M[0], M[1], M[2], M[3], M[4] + M[0] * ox + M[2] * oy - nx, M[5] + M[1] * ox + M[3] * oy - ny];
      L.x = nx; L.y = ny;
    }
    const src = document.createElement('canvas'); src.width = cv.width; src.height = cv.height;
    src.getContext('2d').drawImage(cv, 0, 0);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    const ip = p.interpolation || 'bicubic';
    ctx.imageSmoothingEnabled = ip !== 'nearest';
    ctx.imageSmoothingQuality = ip === 'bicubic' ? 'high' : 'medium';
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  } else if (L.kind === 'vector'){
    L.data.shapes = L.data.shapes.map(s => xfShape(s, m));
  } else if (L.kind === 'text'){
    const d = L.data, X = TextXform.of(L);
    const simple = !X && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[0] - m[3]) < 1e-9 && m[0] > 0;
    if (simple){
      const q = [m[0] * d.x + m[4], m[3] * d.y + m[5]];
      d.x = q[0]; d.y = q[1]; d.size = d.size * m[0];
    } else {
      // 斜切／旋转／翻转／不等比＝记成这层的变形（图层坐标的仿射·画的时候套·字仍是字·改字改样式都带着）
      if (!(Math.abs(m[0] * m[3] - m[1] * m[2]) > 1e-9)) return {ok:false, error:'the transform collapses the text layer'};
      TextXform.set(L, TextXform.mul(m, X || TextXform.I));
    }
  }
  Layer.invalidate(L);
  return {ok:true, matrix:M};
});

/* 工具选项（state.rs ToolOptions 的 move_auto_select / move_show_transform；View›Snap、View›Show›Smart Guides） */
CMD.reg('move.options', {i18n:'', params:'{autoSelect?=true, showTransform?=false, snap?=true, smartGuides?=true} 移动工具选项；回传目前值'}, p => {
  ['autoSelect', 'showTransform', 'snap', 'smartGuides'].forEach(k => { if (typeof p[k] === 'boolean') MT.opt[k] = p[k]; });
  if (window.UI && ToolState.cur === 'move') UI.buildOptions('move');
  return Object.assign({}, MT.opt);
});

/* 自由变换框进行中（Ctrl+T）右键选单那几项（PS 2020）：换拖曳模式、或直接转框（旋转 180／90、翻转——绕参考点，确定时才真的变） */
CMD.reg('move.xfMode', {i18n:'', params:'{mode:"free|skew|distort|perspective"} 自由变换框进行中：换拖曳模式（斜切＝拖边斜切、扭曲＝拖角自由移、透视＝拖角对称移；同 Ctrl／Ctrl+Alt+Shift 拖）→ {mode}'}, p => {
  const t = MT.xf; if (!t) return {ok:false, error:'not transforming (Ctrl+T first)'};
  const m = String(p.mode || 'free'); if (!['free', 'skew', 'distort', 'perspective'].includes(m)) return {ok:false, error:'mode: free|skew|distort|perspective'};
  t.mode = m === 'free' ? null : m; if (window.UI) UI.draw();
  return {ok:true, mode:m};
});
CMD.reg('move.xfBox', {i18n:'', params:'{op:"rotate180|rotate90Cw|rotate90Ccw|flipHorizontal|flipVertical"} 自由变换框进行中：框绕参考点转／翻（Enter 才真的变换）→ {quad}'}, p => {
  const t = MT.xf; if (!t) return {ok:false, error:'not transforming (Ctrl+T first)'};
  const c = t.pivot, M = {rotate180:[-1, 0, 0, -1], rotate90Cw:[0, 1, -1, 0], rotate90Ccw:[0, -1, 1, 0], flipHorizontal:[-1, 0, 0, 1], flipVertical:[1, 0, 0, -1]}[p.op];
  if (!M) return {ok:false, error:'op: rotate180|rotate90Cw|rotate90Ccw|flipHorizontal|flipVertical'};
  t.quad = t.quad.map(q => { const x = q[0] - c[0], y = q[1] - c[1]; return [c[0] + M[0] * x + M[2] * y, c[1] + M[1] * x + M[3] * y]; });
  t.fields = null; MT.xfSyncBar();
  if (window.UI) UI.draw();
  return {ok:true, quad:t.quad.map(q => q.slice())};
});

/* 自由变换框的选项栏（PS 2020）：切换参考点、九格定位器、X／Y（参考点位置）、W／H %、角度、水平／垂直斜切、插值；agent 跟点栏位走同一条 */
CMD.reg('move.xf', {i18n:'', refresh:'none', params:'{refPoint?:bool 切换参考点（显示／藏起；记在偏好里）, locator?:"tl|t|tr|l|c|r|bl|b|br" 参考点放到框的那一格, pivot?:[x,y] 参考点放这（文件坐标；框不动）, ' +
    'x?, y?（参考点搬到这里、框跟着）, w?, h?（%，相对原框）, angle?（度，正＝顺时针）, skewH?, skewV?（度）, interpolation?:"nearest|bilinear|bicubic"|null, commit?:true, cancel?:true} ' +
    '自由变换框进行中（Ctrl+T 之后）的选项栏；不给参数＝只读 → {ok, active, x, y, w, h, angle, skewH, skewV, refPoint, locator, quad, pivot, affine}；refPoint 不在变换中也能设'}, p => {
  p = p || {};
  if (typeof p.refPoint === 'boolean') MT.setRefShown(p.refPoint);
  const t = MT.xf;
  if (!t){
    if (Object.keys(p).some(k => k !== 'refPoint')) return {ok:false, error:'not transforming (Ctrl+T first)'};
    return {ok:true, active:false, refPoint:MT.refShown()};
  }
  if (p.interpolation !== undefined){
    const v = p.interpolation; if (v !== null && v !== '' && !['nearest', 'bilinear', 'bicubic'].includes(v)) return {ok:false, error:'interpolation: nearest|bilinear|bicubic|null'};
    t.interp = v || null;
  }
  if (p.locator !== undefined){ const r = MT.xfSetLocator(String(p.locator)); if (!r.ok) return r; }
  if (Array.isArray(p.pivot)){ const q = [+p.pivot[0], +p.pivot[1]]; if (!q.every(isFinite)) return {ok:false, error:'pivot: [x, y]'}; t.pivot = q; MT.xfSyncBar(); }
  if (['x', 'y', 'w', 'h', 'angle', 'skewH', 'skewV'].some(k => p[k] !== undefined)){ const r = MT.xfSetFields(p); if (!r.ok) return r; }
  if (p.commit){ MT.xfCommit(); return {ok:true, active:false, committed:true}; }
  if (p.cancel){ MT.xfCancel(); return {ok:true, active:false, cancelled:true}; }
  if (window.UI) UI.draw();
  return Object.assign({ok:true, active:true}, MT.xfInfo(), {quad:t.quad.map(q => q.slice()), pivot:t.pivot.slice()});
});

/* ═══════════════ 工具本体 ═══════════════ */
const MT = window.MoveTool = {
  // Photoshop 出厂：自动选择勾着、显示变形控制项不勾、吸附开、智慧参考线开（state.rs:453-455、view_cmds.rs:42、state.rs:523）
  opt: {autoSelect:true, showTransform:false, snap:true, smartGuides:true},
  drag: null,          // 一次拖曳：{layerId, start, points, alt, last, dupFrom, orig, translated}
  snap: null,          // snap_ui.rs ActiveSnap：{gesture, start, targets, smart, disabled}
  snapLines: [],
  xf: null,            // 自由变形：{layerId, rect, quad, pivot, gesture}
  _ctl: null,          // 变形控制项外框的快取
  constrain, layerRect, layersAt,

  zoom(){ return Math.max(UI.zoom, 0.01); },
  tol(){ return SNAP_PX / this.zoom(); },                    // snap_ui.rs tolerance

  /* ── 吸附：snap_ui.rs begin / apply / filter_event ── */
  snapBegin(p, gesture, exclude){
    this.snapLines = [];
    if (!gesture){ this.snap = null; return; }
    const targets = this.opt.snap ? buildTargets(exclude, false) : emptyTargets();
    const smart = (gesture.type === 'move' && this.opt.smartGuides) ? buildTargets(exclude, true) : emptyTargets();
    this.snap = {gesture, start:p.slice(), targets, smart, disabled:false};
  },
  snapApply(p){
    const s = this.snap; if (!s) return p;
    if (s.disabled){ this.snapLines = []; return p; }
    const tol = this.tol(); let out, lines;
    // 参考点（pivot）：先吸变换框自己的九个定位点（PS：拖参考点靠近中心／角／边中点会吸住），没有再照轴吸（参考线交叉点＝两轴各吸一条）
    const hitPt = s.gesture.pts && this.opt.snap ? s.gesture.pts.find(q => Math.hypot(q[0] - p[0], q[1] - p[1]) <= tol) : null;
    if (hitPt){ out = hitPt.slice(); lines = []; }
    else if (s.gesture.type === 'point') [out, lines] = snapPoint(s.targets, p, tol);
    else {
      const d = [p[0] - s.start[0], p[1] - s.start[1]], r = s.gesture.rect;
      const set = isEmpty(s.targets) ? s.smart : s.targets;
      let adj; [adj, lines] = snapRect(set, [r[0] + d[0], r[1] + d[1], r[2] + d[0], r[3] + d[1]], tol);
      out = [p[0] + adj[0], p[1] + adj[1]];
    }
    this.snapLines = lines;
    return out;
  },
  /* Ctrl（不是 Mac 的 ⌘）在「拖的途中」按着 ⇒ 这次暂停吸附；只在按下那一刻按的 Ctrl 属于自动选择 */
  snapEvent(p, e, up){
    if (!this.snap) return p;
    this.snap.disabled = !!(e.ctrlKey && !e.metaKey);
    const q = this.snapApply(p);
    if (up){ this.snap = null; this.snapLines = []; }
    return q;
  },

  /* ── move_mods.rs drag_to：⇧ 锁轴、⌥ 第一次真的动了才复制 ── */
  dragTo(p, e){
    const d = this.drag;
    let v = [p[0] - d.start[0], p[1] - d.start[1]];
    if (e.shiftKey) v = constrain(v, d.last, MOVE_DIRECTIONS);
    d.last = v;
    if (d.alt && d.dupFrom === null && Math.hypot(v[0], v[1]) * this.zoom() >= DUPLICATE_THRESHOLD){
      d.dupFrom = this.duplicate(d);
      d.alt = false;                                          // 一次拖曳只复制一次，失败也一样
    }
    return [d.start[0] + v[0], d.start[1] + v[1]];
  },
  duplicate(d){
    this.restore();                                           // 先把预览位移还回去，复制出来的才在原处
    const from = History.past.length;
    const r = CMD.run('layer.duplicate', {id:d.layerId});
    if (!r || !r.id) return null;
    const N = Doc.byId(r.id);
    d.layerId = N.id; d.orig = {x:N.x, y:N.y};
    return from;
  },
  /* move_ui.rs：拖的时候层就停在游标那（整数位移）——只是预览，放开前会还原 */
  preview(){
    const d = this.drag, L = d && Doc.byId(d.layerId); if (!L) return;
    const end = d.points[d.points.length - 1];
    L.x = d.orig.x + clamp7(rround(end[0] - d.start[0]));
    L.y = d.orig.y + clamp7(rround(end[1] - d.start[1]));
    if (L.kind !== 'raster') Layer.invalidate(L);
  },
  restore(){
    const d = this.drag, L = d && Doc.byId(d.layerId); if (!L) return;
    if (L.x !== d.orig.x || L.y !== d.orig.y){ L.x = d.orig.x; L.y = d.orig.y; Layer.invalidate(L); }
  },
  /* move_mods.rs fold_history：⌥ 拖的「复制」和「移动」并成一步（把移动那一步的快照拿掉，退一步就回到复制前） */
  fold(d){ if (d.dupFrom !== null && d.translated && History.past.length > d.dupFrom + 1) History.past.pop(); },

  /* move_mods.rs nudge：方向键 1 px、⇧ 10 px、⌥ 先复制；自由变形中改推框 */
  nudge(dx, dy, dup){
    if (this.xf){
      this.xf.quad = this.xf.quad.map(q => [q[0] + dx, q[1] + dy]);
      this.xf.pivot = [this.xf.pivot[0] + dx, this.xf.pivot[1] + dy];
      this.xfSyncBar(); UI.draw(); return;
    }
    if (this.drag) return;
    CMD.run('move.translate', {dx, dy, duplicate:!!dup});
  },

  /* ── 显示变形控制项（canvas.rs transform_controls_rect / _hit） ── */
  controlsRect(){
    if (!this.opt.showTransform || this.xf || this.drag) return null;
    const L = Doc.active(); if (!L) return null;
    const key = [L.id, L.x, L.y, History.past.length, History.future.length, Doc.layers.length].join('|');
    if (!this._ctl || this._ctl.key !== key || this._ctl.data !== L.data) this._ctl = {key, data:L.data, rect:layerRect(L)};
    return this._ctl.rect;
  },
  controlsHit(pt){
    const r = this.controlsRect(); if (!r) return false;
    const z = this.zoom(), p = [pt[0] * z, pt[1] * z], R = r.map(v => v * z);      // 萤幕像素里判
    const cx = (R[0] + R[2]) / 2, cy = (R[1] + R[3]) / 2;
    const hs = [[R[0], R[1]], [cx, R[1]], [R[2], R[1]], [R[2], cy], [R[2], R[3]], [cx, R[3]], [R[0], R[3]], [R[0], cy]];
    const inR = (e) => p[0] >= R[0] - e && p[0] <= R[2] + e && p[1] >= R[1] - e && p[1] <= R[3] + e;
    return hs.some(h => Math.hypot(h[0] - p[0], h[1] - p[1]) <= 8) || (inR(18) && !inR(5));
  },

  /* ── 自由变形（transform_tool.rs begin / pointer / apply_drag / commit / cancel） ── */
  xfBegin(){
    const L = Doc.active(); if (!L) return false;
    if (window.Locks && Locks.deny(L, 'position', {bgFloat:true})) return false;   // 锁位置／全锁：不进变形框（transform_cmds.rs:170）
    // 智能对象最后一步是扭曲／透视：框就是那个四边形（PS：智能对象记得自己的变换框），确定时改那一步、不再叠一步重采样
    const t = (L.kind === 'smart' && window.Smart && Smart.tail) ? Smart.tail(L) : null;
    if (t && t.type === 'persp'){
      const c = [t.quad.reduce((a, p) => a + p[0], 0) / 4, t.quad.reduce((a, p) => a + p[1], 0) / 4];
      this.xf = {layerId:L.id, rect:t.rect.slice(), quad:t.quad.map(p => p.slice()), quad0:t.quad.map(p => p.slice()), pivot:c, gesture:null, smartTail:true, tailIndex:t.index};
      UI.buildOptions('move');
      return true;
    }
    const b = layerRect(L);
    if (!b){ console.warn('Could not transform: the layer is empty'); return false; }
    this.xf = {layerId:L.id, rect:b.slice(), quad:corners(b), quad0:corners(b), pivot:[(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], gesture:null};
    UI.buildOptions('move');
    return true;
  },
  xfDown(e, pt){
    const t = this.xf, tol = this.tol();
    let p = pt;
    t.fields = null;                                           // 选项栏打过的角度／斜切（见 xfInfo）：一动滑鼠就改回从框推算
    const showPv = this.refShown();
    // snap_ui.rs begin：靠近把手 ⇒ 点吸附；框内 ⇒ 整框吸附；框外（旋转）不吸
    // 参考点（PS：拖参考点会吸参考线／参考线交叉点、文件边、别层边，也吸变换框的九个定位点；按着 Ctrl 不吸）——起点不吸，放哪吸哪
    if (hitXf(t, pt, tol, showPv).type === 'pivot'){
      this.snapBegin(pt, {type:'point', pts:LOCATOR.map(k => this.xfLocatorPt(k))}, [t.layerId]);
    }
    else if (nearHandle(t.quad, pt, tol)){
      this.snapBegin(pt, {type:'point'}, [t.layerId]);
      if (this.snap && e.ctrlKey && !e.metaKey) this.snap.disabled = true;   // Ctrl 拖（扭曲／斜切）＝不吸附：起点也不吸，不然起点吸了终点没吸，角会偏
      p = this.snapApply(pt);
    }
    else if (inQuad(t.quad, pt)) this.snapBegin(pt, {type:'transformMove', rect:quadRect(t.quad)}, [t.layerId]);
    else this.snapBegin(pt, null);
    let h = hitXf(t, p, tol, showPv);
    if (e.altKey && (h.type === 'inside' || h.type === 'outside')){ t.pivot = p.slice(); h = {type:'pivot'}; }   // ⌥ 点＝把参考点放这（参考点藏着也照放，PS 同）
    t.gesture = {hit:h, start:p.slice(), quad0:t.quad.map(q => q.slice()), pivot0:t.pivot.slice()};
  },
  xfApply(p, e){
    const s = this.xf, g = s.gesture; if (!g) return;
    const dx = p[0] - g.start[0], dy = p[1] - g.start[1];
    let shift = e.shiftKey, alt = e.altKey, cmd = e.ctrlKey || e.metaKey;
    const h = g.hit;
    // 右键选单选了 斜切／扭曲／透视（PS：框留在那个模式，不按 Ctrl 也照那个模式拖）
    if (s.mode === 'distort' && (h.type === 'corner' || h.type === 'edge')){ cmd = true; if (h.type === 'corner'){ alt = false; } }
    else if (s.mode === 'perspective' && h.type === 'corner'){ cmd = alt = shift = true; }
    else if (s.mode === 'skew' && h.type === 'edge') cmd = true;
    if (h.type === 'inside'){
      let d = [dx, dy];
      if (shift) d = constrain(d, [s.quad[0][0] - g.quad0[0][0], s.quad[0][1] - g.quad0[0][1]], TRANSFORM_DIRECTIONS);
      s.quad = g.quad0.map(q => [q[0] + d[0], q[1] + d[1]]);
      s.pivot = [g.pivot0[0] + d[0], g.pivot0[1] + d[1]];
    } else if (h.type === 'pivot'){
      s.pivot = p.slice();
    } else if (h.type === 'outside'){
      const a0 = Math.atan2(g.start[1] - g.pivot0[1], g.start[0] - g.pivot0[0]);
      const a1 = Math.atan2(p[1] - g.pivot0[1], p[0] - g.pivot0[0]);
      let da = a1 - a0;
      if (shift){                                              // ⇧：结果角度锁 15°
        const base = Math.atan2(g.quad0[1][1] - g.quad0[0][1], g.quad0[1][0] - g.quad0[0][0]);
        const step = 15 * Math.PI / 180;
        da = rround((base + da) / step) * step - base;
      }
      const sn = Math.sin(da), cs = Math.cos(da), c = g.pivot0;
      s.quad = g.quad0.map(q => { const x = q[0] - c[0], y = q[1] - c[1]; return [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs]; });
    } else if (h.type === 'corner' && cmd && alt && shift){
      // 透视（transform_tool.rs:451）：角沿主方向移，同一边的另一角反向移（左上 0、右上 1、右下 2、左下 3）
      const i = h.i, horiz = Math.abs(dx) >= Math.abs(dy);
      const j = horiz ? [1, 0, 3, 2][i] : [3, 2, 1, 0][i];
      const mx = horiz ? dx : 0, my = horiz ? 0 : dy;
      s.quad = g.quad0.map(q => q.slice());
      s.quad[i] = [g.quad0[i][0] + mx, g.quad0[i][1] + my];
      s.quad[j] = [g.quad0[j][0] - mx, g.quad0[j][1] - my];
    } else if (h.type === 'corner' && cmd){
      // 扭曲（transform_tool.rs:472）：Ctrl 拖角＝那个角自由移动
      s.quad = g.quad0.map(q => q.slice());
      s.quad[h.i] = [g.quad0[h.i][0] + dx, g.quad0[h.i][1] + dy];
    } else if (h.type === 'edge' && cmd){
      // 斜切：这条边的两角一起动（⇧ 只沿边）；⌥ 对边反向
      const a = h.i, b = (h.i + 1) % 4; let mx = dx, my = dy;
      if (shift){
        const ev = [g.quad0[b][0] - g.quad0[a][0], g.quad0[b][1] - g.quad0[a][1]], l2 = ev[0] * ev[0] + ev[1] * ev[1];
        const t = l2 > 0 ? (dx * ev[0] + dy * ev[1]) / l2 : 0; mx = t * ev[0]; my = t * ev[1];
      }
      s.quad = g.quad0.map(q => q.slice());
      s.quad[a] = [g.quad0[a][0] + mx, g.quad0[a][1] + my];
      s.quad[b] = [g.quad0[b][0] + mx, g.quad0[b][1] + my];
      if (alt){
        const c = (h.i + 2) % 4, d = (h.i + 3) % 4;
        s.quad[c] = [g.quad0[c][0] - mx, g.quad0[c][1] - my];
        s.quad[d] = [g.quad0[d][0] - mx, g.quad0[d][1] - my];
      }
    } else if (h.type === 'corner' || h.type === 'edge'){
      // 在框自己的单位座标里算，旋转／斜切过的框也沿它自己的轴缩放
      const H = unitFrame(g.quad0); if (!H.inv) return;
      const [u, v] = H.inv(p[0], p[1]), [pu, pv] = H.inv(g.pivot0[0], g.pivot0[1]);
      const r = [0, 0, 1, 1];
      const MU = {c0:[[1,0],[1,0]], c1:[[0,1],[1,0]], c2:[[0,1],[0,1]], c3:[[1,0],[0,1]], e0:[[0,0],[1,0]], e1:[[0,1],[0,0]], e2:[[0,0],[0,1]], e3:[[1,0],[0,0]]}
        [(h.type === 'corner' ? 'c' : 'e') + h.i];
      const mu = MU[0], mv = MU[1];
      if (mu[0]) r[0] = u; if (mu[1]) r[2] = u; if (mv[0]) r[1] = v; if (mv[1]) r[3] = v;
      if (alt){                                                // ⌥：对参考点对称
        if (mu[0]) r[2] = 2 * pu - r[0]; if (mu[1]) r[0] = 2 * pu - r[2];
        if (mv[0]) r[3] = 2 * pv - r[1]; if (mv[1]) r[1] = 2 * pv - r[3];
      }
      if (h.type === 'corner' && !shift){                      // 角默认等比（PS CC），⇧ 才自由
        const sx = r[2] - r[0], sy = r[3] - r[1];
        const k = Math.abs(sx) > Math.abs(sy) ? Math.abs(sx) : Math.abs(sy);
        const sg = v => v > 0 || Object.is(v, 0) ? 1 : -1;     // f64::signum：+0 → 1
        const nx = k * sg(sx), ny = k * sg(sy);
        const ax = alt ? pu : (mu[0] ? r[2] : r[0]), ay = alt ? pv : (mv[0] ? r[3] : r[1]);
        const fx = alt ? 0.5 : (mu[0] ? 1 : 0), fy = alt ? 0.5 : (mv[0] ? 1 : 0);
        r[0] = ax - nx * fx; r[2] = r[0] + nx; r[1] = ay - ny * fy; r[3] = r[1] + ny;
      }
      s.quad = [H.apply(r[0], r[1]), H.apply(r[2], r[1]), H.apply(r[2], r[3]), H.apply(r[0], r[3])];
      s.pivot = H.apply(pu, pv);
    }
    this.xfSyncBar();
  },
  xfEnd(){
    this.xf = null; this.snap = null; this.snapLines = [];
    if (UI.canvas) UI.canvas.style.cursor = 'move';
    if (ToolState.cur === 'move') UI.buildOptions('move');
  },
  xfCommit(){
    const t = this.xf; if (!t) return;
    this.xfEnd();
    const q0 = t.quad0 || corners(t.rect);
    const same = t.quad.every((q, i) => Math.abs(q[0] - q0[i][0]) < 1e-9 && Math.abs(q[1] - q0[i][1]) < 1e-9);
    if (!same){                                                // 没动过就不留历史（PS 也是）
      // 平行四边形＝仿射走 move.transform；扭曲／透视（或改智能对象存的透视框）走 ps.edit.transform（transform_tool.rs:322 commit → edit.transform 收 quad）
      const affine = !!rectQuadMatrix(t.rect, t.quad) && !t.smartTail;
      const id = affine || !CMD.map['ps.edit.transform'] ? 'move.transform' : 'ps.edit.transform';
      const p = {layerId:t.layerId, rect:t.rect, quad:t.quad};
      if (t.smartTail) p.smartTail = true;
      if (t.interp) p.interpolation = t.interp;                 // 选项栏「插值」
      const r = CMD.run(id, p);
      if (r && r.ok === false){ console.warn(r.error); if (!r.locked && window.Locks && Locks.notify) Locks.notify(r.error); }   // 失败那步 CMD.run 已经退掉了，这里再 pop 会吃掉上一步（例如刚按的锁定）
    }
    UI.draw();
  },
  xfCancel(){ if (this.xf){ const f = this.xf.onCancel; this.xfEnd(); if (f) f(); UI.draw(); } },   // onCancel：置入后的变形框 Esc＝连置入一起取消（ps-file.js placeTransform）
  xfCursor(pt){
    const t = this.xf; if (!t || !UI.canvas) return;
    const h = hitXf(t, pt, this.tol(), this.refShown());
    const c = h.type === 'corner' ? (h.i % 2 ? 'nesw-resize' : 'nwse-resize')
            : h.type === 'edge' ? (h.i % 2 ? 'ew-resize' : 'ns-resize')
            : h.type === 'pivot' ? 'crosshair' : h.type === 'inside' ? 'move' : 'alias';
    UI.canvas.style.cursor = c;
  },

  /* ── 自由变换的选项栏（PS 2020：☐切换参考点 · 九格定位器 · X Y · W 🔗 H · ∠ · 斜切 H V · 插值 · ⊘ ✓） ── */
  refShown(){ try { return localStorage.getItem(REF_PREF) === '1'; } catch(e){ return false; } },
  setRefShown(on){ try { localStorage.setItem(REF_PREF, on ? '1' : '0'); } catch(e){} this.xfSyncBar(); if (window.UI) UI.draw(); },
  xfLocatorPt(k){ const t = this.xf, uv = LOC_UV[k]; if (!t || !uv) return null; return unitFrame(t.quad).apply(uv[0], uv[1]); },
  xfLocatorAt(){ const t = this.xf; if (!t) return null; const tol = 0.01;
    return LOCATOR.find(k => { const q = this.xfLocatorPt(k); return q && Math.abs(q[0] - t.pivot[0]) < tol && Math.abs(q[1] - t.pivot[1]) < tol; }) || null; },
  /* 现在这个框相对原框的分解：L ＝ R(角度)·[[1, tan 斜H],[tan 斜V, 1]]·diag(W%, H%)；扭曲／透视过（不是平行四边形）⇒ 只有 X／Y */
  xfInfo(){
    const t = this.xf; if (!t) return null;
    const out = {x:t.pivot[0], y:t.pivot[1], affine:false, refPoint:this.refShown(), locator:this.xfLocatorAt(), interpolation:t.interp || null};
    const M = t.smartTail ? null : rectQuadMatrix(t.rect, t.quad); if (!M) return out;
    out.affine = true;
    if (t.fields) return Object.assign(out, t.fields);
    const th = Math.atan2(M[1], M[0]), sx = Math.hypot(M[0], M[1]), cs = Math.cos(th), sn = Math.sin(th);
    const vx = cs * M[2] + sn * M[3], vy = -sn * M[2] + cs * M[3];           // R(−θ)·v
    const clean = v => Math.abs(v) < 1e-9 ? 0 : v;
    return Object.assign(out, {w:clean(sx * 100), h:clean(vy * 100), angle:clean(th * 180 / Math.PI), skewH:clean(Math.abs(vy) > 1e-12 ? Math.atan(vx / vy) * 180 / Math.PI : 0), skewV:0});
  },
  /* 选项栏打数字（或 agent 给值）：照 PS，绕参考点重算整个框；X／Y＝参考点搬到那里（框跟着） */
  xfSetFields(v){
    const t = this.xf; if (!t) return {ok:false, error:'not transforming (Ctrl+T first)'};
    const cur = this.xfInfo(), num = k => (v[k] !== undefined && v[k] !== null && v[k] !== '' && isFinite(+v[k])) ? +v[k] : undefined;
    const want = {}; ['x', 'y', 'w', 'h', 'angle', 'skewH', 'skewV'].forEach(k => { const n = num(k); if (n !== undefined) want[k] = n; });
    if (!cur.affine){
      if (['w', 'h', 'angle', 'skewH', 'skewV'].some(k => k in want)) return {ok:false, error:'the box is distorted: only X / Y can be typed'};
      const dx = ('x' in want ? want.x : cur.x) - cur.x, dy = ('y' in want ? want.y : cur.y) - cur.y;
      t.quad = t.quad.map(q => [q[0] + dx, q[1] + dy]); t.pivot = [t.pivot[0] + dx, t.pivot[1] + dy];
      this.xfSyncBar(); if (window.UI) UI.draw(); return {ok:true};
    }
    const f = Object.assign({}, cur, want);
    if (Math.abs(f.w) < 1e-6 || Math.abs(f.h) < 1e-6) return {ok:false, error:'W and H cannot be 0%'};
    if (Math.abs(f.skewH) >= 89.99 || Math.abs(f.skewV) >= 89.99) return {ok:false, error:'skew must be between -90° and 90°'};
    const M = rectQuadMatrix(t.rect, t.quad), det = M[0] * M[3] - M[1] * M[2];
    const ex = t.pivot[0] - M[4], ey = t.pivot[1] - M[5];
    const p0 = [(M[3] * ex - M[2] * ey) / det, (-M[1] * ex + M[0] * ey) / det];      // 参考点在原框里的位置
    const th = f.angle * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
    const tH = Math.tan(f.skewH * Math.PI / 180), tV = Math.tan(f.skewV * Math.PI / 180), sx = f.w / 100, sy = f.h / 100;
    const k = [sx, tV * sx, tH * sy, sy];                                     // K·S（列主序 a b c d）
    const Lm = [cs * k[0] - sn * k[1], sn * k[0] + cs * k[1], cs * k[2] - sn * k[3], sn * k[2] + cs * k[3]];
    const pv = [f.x, f.y];
    t.quad = corners(t.rect).map(q => { const x = q[0] - p0[0], y = q[1] - p0[1]; return [pv[0] + Lm[0] * x + Lm[2] * y, pv[1] + Lm[1] * x + Lm[3] * y]; });
    t.pivot = pv.slice();
    t.fields = {w:f.w, h:f.h, angle:f.angle, skewH:f.skewH, skewV:f.skewV};
    this.xfSyncBar(); if (window.UI) UI.draw();
    return {ok:true};
  },
  xfSetLocator(k){
    const t = this.xf; if (!t) return {ok:false, error:'not transforming (Ctrl+T first)'};
    const q = this.xfLocatorPt(k); if (!q) return {ok:false, error:'locator: tl|t|tr|l|c|r|bl|b|br'};
    t.pivot = q; this.xfSyncBar(); if (window.UI) UI.draw(); return {ok:true};
  },
  /* 拖曳中只改栏位的值（不整排重建，免得一直重画选项栏） */
  xfSyncBar(){
    const box = document.getElementById('optBody'); if (!box || !this.xf) return;
    const bar = box.querySelector('.xfbar'); if (!bar) return;
    const I = this.xfInfo(), fmt = v => (Math.round(v * 100) / 100).toFixed(2);
    const set = (k, v, on) => { const el = bar.querySelector(`[data-xf="${k}"]`); if (!el) return; if (document.activeElement !== el) el.value = v === undefined ? '' : fmt(v); el.disabled = !on; };
    set('x', I.x, true); set('y', I.y, true);
    ['w', 'h', 'angle', 'skewH', 'skewV'].forEach(k => set(k, I[k], I.affine));
    const cb = bar.querySelector('[data-xf="refToggle"]'); if (cb) cb.checked = I.refPoint;
    // 定位器：参考点藏着时整组变灰不能点（PS 2020）；参考点刚好在某一格上＝那格实心
    bar.querySelectorAll('[data-loc]').forEach(b => { const on = b.dataset.loc === I.locator; b.disabled = !I.refPoint; b.classList.toggle('on', on);
      b.style.background = on ? (I.refPoint ? '#e6e8eb' : '#6b7079') : 'transparent'; b.style.opacity = I.refPoint ? '1' : '.45'; b.style.cursor = I.refPoint ? 'pointer' : 'default'; });
  },
  xfBar(box){
    const L3 = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, en:c})[Lang.cur] || b;
    const bar = document.createElement('span'); bar.className = 'xfbar';
    bar.style.cssText = 'display:inline-flex;align-items:center;gap:4px;flex-wrap:nowrap;white-space:nowrap';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.xf = 'refToggle'; cb.title = Lang.t('ui.xfRefToggle');
    cb.onchange = () => CMD.run('move.xf', {refPoint:cb.checked});
    bar.appendChild(cb);
    const grid = document.createElement('span'); grid.dataset.xf = 'locator'; grid.title = Lang.t('ui.xfLocator');
    grid.style.cssText = 'display:inline-grid;grid-template-columns:repeat(3,7px);gap:1px;margin:0 4px;vertical-align:middle';
    LOCATOR.forEach(k => { const b = document.createElement('button'); b.type = 'button'; b.dataset.loc = k;
      b.style.cssText = 'width:7px;height:7px;padding:0;margin:0;border:1px solid #9aa0a8;background:transparent;cursor:pointer;min-width:0';
      b.onclick = () => CMD.run('move.xf', {locator:k}); grid.appendChild(b); });
    bar.appendChild(grid);
    // 🔗 链住：改 W 时 H 跟着同比例（PS「保持长宽比」）
    const linked = (k, v) => { const I = this.xfInfo(), o = k === 'w' ? 'h' : 'w', p = {[k]:v};
      if (this.xfLinked && I.affine && Math.abs(I[k]) > 1e-9) p[o] = I[o] * v / I[k]; return p; };
    const field = (k, label, unit, title) => {
      const l = document.createElement('label'); l.style.cssText = 'display:inline-flex;align-items:center;gap:2px';
      const s = document.createElement('span'); s.textContent = label; l.appendChild(s);
      const i = document.createElement('input'); i.type = 'text'; i.dataset.xf = k; i.style.cssText = 'width:62px'; if (title) i.title = title;
      i.onchange = () => {
        if (i.dataset.esc){ delete i.dataset.esc; this.xfSyncBar(); return; }
        const v = parseFloat(i.value);
        if (isFinite(v)){ const r = CMD.run('move.xf', (k === 'w' || k === 'h') ? linked(k, v) : {[k]:v}); if (r && r.ok === false) console.warn(r.error); }
        this.xfSyncBar();
      };
      // Enter＝套用（失焦触发 change）；Esc＝放弃这格打的字
      i.onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); i.blur(); } else if (e.key === 'Escape'){ e.preventDefault(); i.dataset.esc = '1'; i.blur(); } };
      i.addEventListener('blur', () => { delete i.dataset.esc; this.xfSyncBar(); });
      l.appendChild(i);
      if (unit){ const u = document.createElement('span'); u.textContent = unit; u.style.color = '#9aa0a8'; l.appendChild(u); }
      bar.appendChild(l); return i;
    };
    const px = L3('像素', '像素', 'px');
    field('x', 'X:', px); field('y', 'Y:', px);
    field('w', 'W:', '%');
    const link = document.createElement('button'); link.type = 'button'; link.dataset.xf = 'link'; link.textContent = '∞'; link.title = Lang.t('ui.xfLink');
    const paintLink = () => { link.style.background = this.xfLinked ? '#3b6fb6' : ''; link.style.color = this.xfLinked ? '#fff' : ''; };
    link.style.cssText = 'min-width:20px;padding:0 3px;cursor:pointer'; paintLink();
    link.onclick = () => { this.xfLinked = !this.xfLinked; paintLink(); };
    bar.appendChild(link);
    field('h', 'H:', '%');
    field('angle', '∠', '°', Lang.t('ui.xfAngle'));
    field('skewH', 'H:', '°', Lang.t('ui.xfSkewH')); field('skewV', 'V:', '°', Lang.t('ui.xfSkewV'));
    const ip = document.createElement('select'); ip.dataset.xf = 'interpolation'; ip.title = Lang.t('ui.xfInterp');
    [['', L3('使用偏好設定', '使用首选项', 'Preference')], ['nearest', L3('最接近像素', '邻近', 'Nearest Neighbor')], ['bilinear', L3('縱橫增值', '两次线性', 'Bilinear')], ['bicubic', L3('環迴增值', '两次立方', 'Bicubic')]]
      .forEach(([v, n]) => { const o = document.createElement('option'); o.value = v; o.textContent = n; ip.appendChild(o); });
    ip.value = (this.xf && this.xf.interp) || ''; ip.onchange = () => CMD.run('move.xf', {interpolation:ip.value || null});
    bar.appendChild(ip);
    box.appendChild(bar);
    this.xfSyncBar();
  },

  /* ── 叠画 ── */
  dashSel(ctx, s){
    if (!Doc.sel) return;
    const {x, y, w, h} = Doc.sel;
    ctx.save(); ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
    ctx.strokeStyle = '#fff'; ctx.strokeRect(x * s + .5, y * s + .5, w * s, h * s);
    ctx.strokeStyle = '#000'; ctx.setLineDash([0, 4, 5, 0]); ctx.strokeRect(x * s + .5, y * s + .5, w * s, h * s);
    ctx.restore();
  },
  handles(ctx, pts, dpr){
    const hw = 3.5 * dpr;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = ACCENT; ctx.lineWidth = dpr;
    pts.forEach(p => { ctx.fillRect(p[0] - hw, p[1] - hw, 2 * hw, 2 * hw); ctx.strokeRect(p[0] - hw + dpr / 2, p[1] - hw + dpr / 2, 2 * hw - dpr, 2 * hw - dpr); });
  },
  /* transform_tool.rs draw_overlay：原层藏起来、画变形后的预览、框、八个把手、参考点 */
  drawXf(ctx, s, dpr){
    const t = this.xf, L = Doc.byId(t.layerId); if (!L) return;
    const vis = L.visible;
    L.visible = false; try { UI.redrawBase(ctx, s); } finally { L.visible = vis; }     // 只为这一格画面暂时藏起来，马上还原（放大模式 ctx.canvas 是假物件 ⇒ 交给 UI.redrawBase）
    this.dashSel(ctx, s);
    const M = t.smartTail ? null : rectQuadMatrix(t.rect, t.quad);
    if (M && vis){
      ctx.save(); ctx.globalAlpha = L.opacity;
      ctx.setTransform(s * M[0], s * M[1], s * M[2], s * M[3], s * M[4], s * M[5]);
      if (L.kind === 'raster') ctx.drawImage(L.data.canvas, L.x, L.y); else ctx.drawImage(renderLayer(L, 1), 0, 0);
      ctx.restore();
    } else if (vis){
      // 扭曲／透视：rect→quad 的射影，切 24×24 格、每格两个三角形贴（transform_tool.rs:672 同样切 24×24）
      const f = rectToQuadFn(t.rect, t.quad);
      if (f){
        let img, ox = 0, oy = 0;
        if (t.smartTail) img = this._tailImg && this._tailImg.key === Smart.key(L) ? this._tailImg.c : (this._tailImg = {key:Smart.key(L), c:Smart.base(L, t.tailIndex)}).c;
        else if (L.kind === 'raster'){ img = L.data.canvas; ox = L.x; oy = L.y; }
        else img = renderLayer(L, 1);
        const n = 24, r = t.rect, V = [];
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++){
          const x = r[0] + (r[2] - r[0]) * i / n, y = r[1] + (r[3] - r[1]) * j / n, d = f(x, y);
          V.push({t:[x - ox, y - oy], d:[d[0] * s, d[1] * s]});
        }
        ctx.save(); ctx.globalAlpha = L.opacity;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++){
          const a = j * (n + 1) + i, A = V[a], B = V[a + 1], C = V[a + n + 2], D = V[a + n + 1];
          texTri(ctx, img, A.t, B.t, C.t, A.d, B.d, C.d);
          texTri(ctx, img, A.t, C.t, D.t, A.d, C.d, D.d);
        }
        ctx.restore();
      }
    }
    // 上面整张重合成会把 PS 视图画在合成上的参考线／格点盖掉（menus/impl/ps-view.js PsView.post）；PS 变换时参考线照样看得到（例：参考点要拖到参考线交叉点）⇒ 补画回来
    if (window.PsView && PsView.drawOverlays && (!PsView.active || PsView.active()) && !(UI.magnified && UI.magnified())){
      try { ctx.save(); PsView.drawOverlays(ctx, s); } catch(e){ console.error(e); } finally { ctx.restore(); }
    }
    const P = t.quad.map(q => [q[0] * s, q[1] * s]);
    ctx.save(); ctx.strokeStyle = ACCENT; ctx.lineWidth = dpr;
    ctx.beginPath(); P.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.stroke();
    const mids = P.map((p, i) => [(p[0] + P[(i + 1) % 4][0]) / 2, (p[1] + P[(i + 1) % 4][1]) / 2]);
    this.handles(ctx, P.concat(mids), dpr);
    if (!this.refShown()){ ctx.restore(); return; }            // PS 2020：「切换参考点」没勾＝不画参考点
    const c = [t.pivot[0] * s, t.pivot[1] * s];
    ctx.lineWidth = dpr; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(c[0], c[1], 5 * dpr, 0, TAU); ctx.stroke();
    ctx.lineWidth = 0.5 * dpr; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(c[0], c[1], 5 * dpr, 0, TAU); ctx.stroke();
    ctx.lineWidth = dpr; ctx.strokeStyle = '#fff'; ctx.beginPath();
    ctx.moveTo(c[0] - 8 * dpr, c[1]); ctx.lineTo(c[0] + 8 * dpr, c[1]); ctx.moveTo(c[0], c[1] - 8 * dpr); ctx.lineTo(c[0], c[1] + 8 * dpr); ctx.stroke();
    ctx.restore();
  },
  /* canvas.rs draw_transform_controls */
  drawControls(ctx, s, dpr){
    const r = this.controlsRect(); if (!r) return;
    const R = r.map(v => v * s), cx = (R[0] + R[2]) / 2, cy = (R[1] + R[3]) / 2;
    ctx.save(); ctx.strokeStyle = ACCENT; ctx.lineWidth = dpr; ctx.strokeRect(R[0], R[1], R[2] - R[0], R[3] - R[1]);
    this.handles(ctx, [[R[0], R[1]], [cx, R[1]], [R[2], R[1]], [R[2], cy], [R[2], R[3]], [cx, R[3]], [R[0], R[3]], [R[0], cy]], dpr);
    ctx.restore();
  },
  /* snap_ui.rs draw：被移动的外框（主色）＋智慧参考线（洋红） */
  drawSnap(ctx, s, dpr){
    const sn = this.snap; if (!sn) return;
    ctx.save(); ctx.lineWidth = dpr;
    if (sn.gesture.type === 'move' && this.drag){
      const last = this.drag.points[this.drag.points.length - 1];
      const d = [last[0] - sn.start[0], last[1] - sn.start[1]], r = sn.gesture.rect;
      ctx.strokeStyle = ACCENT;
      ctx.strokeRect((r[0] + d[0]) * s, (r[1] + d[1]) * s, (r[2] - r[0]) * s, (r[3] - r[1]) * s);
    }
    if (this.opt.smartGuides){
      ctx.strokeStyle = SMART; ctx.beginPath();
      for (const l of this.snapLines){
        if (!isSmart(l.kind)) continue;
        const px = Math.round(l.pos * s) + .5;
        if (l.vertical){ ctx.moveTo(px, l.from * s); ctx.lineTo(px, l.to * s); }
        else { ctx.moveTo(l.from * s, px); ctx.lineTo(l.to * s, px); }
      }
      ctx.stroke();
    }
    ctx.restore();
  }
};

/* 方向键表（⌥＋方向键也从 onKey 进来：ui.js 先问工具再过滤修饰键） */
const ARROWS = {ArrowLeft:[-1, 0], ArrowRight:[1, 0], ArrowUp:[0, -1], ArrowDown:[0, 1]};

const STRINGS = {
    'zh-Hant':{'opt.autoSelect':'自動選取', 'opt.showTransform':'顯示變形控制項', 'opt.snap':'對齊吸附',
      'ui.alignLeft':'對齊左邊緣', 'ui.alignHCenter':'對齊水平中心', 'ui.alignRight':'對齊右邊緣',
      'ui.alignTop':'對齊上邊緣', 'ui.alignVCenter':'對齊垂直中心', 'ui.alignBottom':'對齊下邊緣', 'ui.alignMore':'對齊…',
      'ui.xfCommit':'確定變形 (Enter)', 'ui.xfCancel':'取消變形 (Esc)',
      'ui.moveHint':'拖移作用中圖層 · Shift 鎖水平／垂直 · Alt 拖＝拷貝 · 拖時按 Ctrl 暫停吸附 · Ctrl 按下＝反轉自動選取 · 方向鍵微移（Shift 10px）',
      'ui.xfHint':'角＝等比縮放（Shift 自由、Alt 對中心）· 邊＝單軸 · 框外拖＝旋轉（Shift 15°）· Ctrl 拖邊＝斜切 · Ctrl 拖角＝扭曲（Ctrl+Alt+Shift＝透視）· 拖參考點／Alt＋點＝改旋轉中心（會吸參考線）· Enter 確定 · Esc 取消',
      'ui.xfRefToggle':'切換參考點', 'ui.xfLocator':'參考點位置', 'ui.xfLink':'維持外觀比例', 'ui.xfAngle':'設定旋轉', 'ui.xfSkewH':'設定水平傾斜', 'ui.xfSkewV':'設定垂直傾斜', 'ui.xfInterp':'內插補點'},
    'zh-Hans':{'opt.autoSelect':'自动选择', 'opt.showTransform':'显示变换控件', 'opt.snap':'对齐吸附',
      'ui.alignLeft':'左对齐', 'ui.alignHCenter':'水平居中对齐', 'ui.alignRight':'右对齐',
      'ui.alignTop':'顶对齐', 'ui.alignVCenter':'垂直居中对齐', 'ui.alignBottom':'底对齐', 'ui.alignMore':'对齐…',
      'ui.xfCommit':'提交变换 (Enter)', 'ui.xfCancel':'取消变换 (Esc)',
      'ui.moveHint':'拖动当前图层 · Shift 锁水平／垂直 · Alt 拖＝复制 · 拖时按 Ctrl 暂停吸附 · 按下时按 Ctrl＝反转自动选择 · 方向键微移（Shift 10px）',
      'ui.xfHint':'角＝等比缩放（Shift 自由、Alt 绕中心）· 边＝单轴 · 框外拖＝旋转（Shift 15°）· Ctrl 拖边＝斜切 · Ctrl 拖角＝扭曲（Ctrl+Alt+Shift＝透视）· 拖参考点／Alt＋点＝改旋转中心（会吸参考线）· Enter 提交 · Esc 取消',
      'ui.xfRefToggle':'切换参考点', 'ui.xfLocator':'参考点位置', 'ui.xfLink':'保持长宽比', 'ui.xfAngle':'设置旋转', 'ui.xfSkewH':'设置水平斜切', 'ui.xfSkewV':'设置垂直斜切', 'ui.xfInterp':'插值'},
    'en':{'opt.autoSelect':'Auto-Select', 'opt.showTransform':'Show Transform Controls', 'opt.snap':'Snap',
      'ui.alignLeft':'Align left edges', 'ui.alignHCenter':'Align horizontal centers', 'ui.alignRight':'Align right edges',
      'ui.alignTop':'Align top edges', 'ui.alignVCenter':'Align vertical centers', 'ui.alignBottom':'Align bottom edges', 'ui.alignMore':'Align…',
      'ui.xfCommit':'Commit transform (Enter)', 'ui.xfCancel':'Cancel transform (Esc)',
      'ui.moveHint':'Drag to move the active layer · Shift: lock axis · Alt-drag: copy · hold Ctrl while dragging: no snapping · Ctrl at the press: invert Auto-Select · arrows nudge (Shift 10px)',
      'ui.xfHint':'Corner: proportional (Shift free, Alt about centre) · edge: one axis · drag outside: rotate (Shift 15°) · Ctrl-drag edge: skew · Ctrl-drag corner: distort (Ctrl+Alt+Shift: perspective) · drag the reference point / Alt-click: move the pivot (snaps to guides) · Enter commits · Esc cancels',
      'ui.xfRefToggle':'Toggle reference point', 'ui.xfLocator':'Reference point location', 'ui.xfLink':'Maintain aspect ratio', 'ui.xfAngle':'Set rotation', 'ui.xfSkewH':'Set horizontal skew', 'ui.xfSkewV':'Set vertical skew', 'ui.xfInterp':'Interpolation'}
};
/* _registry.js 用 window.Lang 判断要不要并字串，但 Lang 是 const，ui.js 载入前 window.Lang 还不存在 ⇒ 字串会漏。这里自己并一次 */
if (typeof Lang !== 'undefined') Lang.add(STRINGS);

Tools.reg({
  id:'move', icon:'✛', key:'V', group:'select', order:10, for:'common', opts:[], cursor:'move',
  strings:STRINGS,

  onDown(e, pt){
    // 自由变形进行中：所有指标事件都归它（canvas.rs tool_event → transform_tool::pointer）
    if (MT.xf){ MT.xfDown(e, pt); UI.draw(); return; }
    // 勾了「显示变形控制项」且按在把手／旋转带上 ⇒ 进自由变形（canvas.rs begin_transform_controls_at）
    if (MT.opt.showTransform && MT.controlsHit(pt) && MT.xfBegin()){ MT.xfDown(e, pt); UI.draw(); return; }
    // 自动选择（或关着时 Ctrl 按下）先挑按下点最上面有像素的层（canvas.rs:2019）
    const command = e.ctrlKey || e.metaKey;
    if (MT.opt.autoSelect !== command) CMD.run('move.pickAt', {x:pt[0], y:pt[1]});
    const L = Doc.active(); if (!L) return;
    // 锁位置／全锁：这层拖不动（layer_multi_cmds.rs:226 move_layers「is position-locked」）；⌥ 拖是复制出新层再移，照样放行
    if (!e.altKey && window.Locks && Locks.deny(L, 'position')) return;
    const rect = layerRect(L);
    MT.snapBegin(pt, rect ? {type:'move', rect} : null, [L.id]);
    MT.drag = {layerId:L.id, start:pt.slice(), points:[pt.slice()], alt:e.altKey, last:null, dupFrom:null, orig:{x:L.x, y:L.y}, translated:false};
  },
  onMove(e, pt, P){
    if (MT.xf){
      if (P.down && MT.xf.gesture){ MT.xfApply(MT.snapEvent(pt, e, false), e); UI.draw(); }
      else MT.xfCursor(pt);
      return;
    }
    const d = MT.drag; if (!P.down || !d) return;
    let p = MT.snapEvent(pt, e, false);
    p = MT.dragTo(p, e);
    const last = d.points[d.points.length - 1];
    if (Math.abs(last[0] - p[0]) + Math.abs(last[1] - p[1]) > 0.25) d.points.push(p);   // canvas.rs tool_move
    MT.preview(); UI.draw();
  },
  onUp(e, pt){
    if (MT.xf){
      if (MT.xf.gesture){ MT.xfApply(MT.snapEvent(pt, e, true), e); MT.xf.gesture = null; }
      UI.draw(); return;
    }
    const d = MT.drag; if (!d){ UI.draw(); return; }
    let p = MT.snapEvent(pt, e, true);
    p = MT.dragTo(p, e);
    MT.restore(); MT.drag = null;
    // 原处按下放开＝只是点一下（选层），绝不移动（canvas.rs:2129）
    if (d.points.length < 2 && pt[0] === d.start[0] && pt[1] === d.start[1]){ MT.fold(d); UI.draw(); return; }
    const last = d.points[d.points.length - 1];
    if (last[0] !== p[0] || last[1] !== p[1]) d.points.push(p);
    const end = d.points[d.points.length - 1];
    const dx = rround(end[0] - d.start[0]), dy = rround(end[1] - d.start[1]);   // finish_gesture Tool::Move
    if (dx || dy){ CMD.run('move.translate', {dx, dy, layerId:d.layerId}); d.translated = true; }
    MT.fold(d);
    UI.draw();
  },
  onDblClick(){ if (MT.xf) MT.xfCommit(); },                 // canvas.rs:1556 双击＝确定变形
  onKey(e){
    if (MT.xf){
      if (e.key === 'Enter'){ e.preventDefault(); MT.xfCommit(); return true; }
      if (e.key === 'Escape'){ MT.xfCancel(); return true; }
    }
    const d = ARROWS[e.key];
    if (d && !e.ctrlKey && !e.metaKey){      // move_mods.rs:158-195 方向键 1px、⇧ 10px、⌥ 先复制再移（ui.js 已改成先问工具再过滤修饰键）
      e.preventDefault(); const k = e.shiftKey ? 10 : 1; MT.nudge(d[0] * k, d[1] * k, !!e.altKey); return true;
    }
    return false;
  },
  onDeactivate(){
    if (MT.drag){ MT.restore(); MT.drag = null; }
    if (MT.xf) MT.xfCommit();
    MT.snap = null; MT.snapLines = [];
  },
  drawOverlay(ctx, s){
    const dpr = s / UI.zoom;
    if (MT.xf) MT.drawXf(ctx, s, dpr);
    else MT.drawControls(ctx, s, dpr);
    MT.drawSnap(ctx, s, dpr);
  },
  /* panels.rs:711 选项栏：自动选择 ☐ · 显示变形控制项 ☐ · 三颗对齐 ＋「…」；变形中换成 ✓ ⊘ */
  buildOptions(box, add, mk){
    const btn = (txt, tipKey, fn, extra) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = txt; b.title = Lang.t(tipKey);
      b.style.cssText = 'margin:0 2px;min-width:26px;cursor:pointer';
      if (extra) Object.assign(b.dataset, extra);
      b.onclick = fn; box.appendChild(b); return b;
    };
    const hint = key => { const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t(key); box.appendChild(h); };
    if (MT.xf){
      MT.xfBar(box);                                           // ☐参考点 · 定位器 · X Y W H ∠ 斜切 · 插值（PS 2020 自由变换选项栏）
      btn('⊘', 'ui.xfCancel', () => MT.xfCancel(), {xf:'cancel'});
      btn('✓', 'ui.xfCommit', () => MT.xfCommit(), {xf:'commit'});
      const bar = box.querySelector('.xfbar'); if (bar) bar.title = Lang.t('ui.xfHint');   // 栏位排满了：操作提示改成滑过整排时的提示（PS 选项栏也不放说明文字）
      return;
    }
    [['autoSelect', 'autoSelect'], ['showTransform', 'showTransform'], ['snap', 'snap']].forEach(([key, prop]) => {
      const c = mk('checkbox', {checked:MT.opt[prop]}); c.dataset.opt = prop;
      c.onchange = () => { CMD.run('move.options', {[prop]:c.checked}); UI.draw(); };
      add(key, c);
    });
    const sep = document.createElement('span'); sep.style.cssText = 'display:inline-block;width:1px;height:18px;background:#555;margin:0 6px;vertical-align:middle'; box.appendChild(sep);
    const align = edge => { CMD.run('move.align', {edge}); UI.draw(); };   // 失败时 CMD.run 自己会退掉那一步（不要再 pop，会吃掉上一步）
    btn('├', 'ui.alignLeft', () => align('leftEdges'), {align:'leftEdges'});
    btn('┼', 'ui.alignHCenter', () => align('horizontalCenters'), {align:'horizontalCenters'});
    btn('┤', 'ui.alignRight', () => align('rightEdges'), {align:'rightEdges'});
    const sel = document.createElement('select'); sel.title = Lang.t('ui.alignMore'); sel.dataset.alignMore = '1';
    sel.innerHTML = `<option value="">…</option>` + [['leftEdges', 'ui.alignLeft'], ['horizontalCenters', 'ui.alignHCenter'], ['rightEdges', 'ui.alignRight'],
      ['topEdges', 'ui.alignTop'], ['verticalCenters', 'ui.alignVCenter'], ['bottomEdges', 'ui.alignBottom']]
      .map(([v, k]) => `<option value="${v}">${Lang.t(k)}</option>`).join('');
    sel.onchange = () => { if (sel.value) align(sel.value); sel.value = ''; };
    box.appendChild(sel);
    hint('ui.moveHint');
  }
});

})();


/* ═══════════ 文字层变形 ═══════════
   L.data.xform＝[a,b,c,d,e,f]：图层坐标里的仿射（字照平常排好之后再套这一步；位移 L.x/L.y 仍照常、变形跟着走）。
   画：在 renderLayer 最外层包一道（加粗／仿斜体／变形文字／修饰文字都先画好，再整张套变形）；存档：跟着 data 一起存（旧版读到不认就照平的画）。 */
const TextXform = window.TextXform = {
  I: [1, 0, 0, 1, 0, 0],
  of(L){ const m = L && L.kind === 'text' && L.data && L.data.xform; return Array.isArray(m) && m.length === 6 && m.every(v => typeof v === 'number' && isFinite(v)) ? m : null; },
  /* 图层坐标的变形 → 文件坐标（文件点 p ⇒ L.xy ＋ X(p − L.xy)） */
  doc(L){
    const m = this.of(L); if (!m) return null;
    const ox = L.x || 0, oy = L.y || 0;
    return [m[0], m[1], m[2], m[3], m[4] + ox - m[0] * ox - m[2] * oy, m[5] + oy - m[1] * ox - m[3] * oy];
  },
  mul(A, B){ return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]]; },
  apply(M, x, y){ return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]; },
  inv(M){ const det = M[0] * M[3] - M[1] * M[2]; if (!(Math.abs(det) > 1e-12)) return null; const a = M[3] / det, b = -M[1] / det, c = -M[2] / det, d = M[0] / det; return [a, b, c, d, -(a * M[4] + c * M[5]), -(b * M[4] + d * M[5])]; },
  set(L, m){
    const r = m.map(v => Math.abs(v) < 1e-12 ? 0 : +v.toPrecision(12));
    if (r.every((v, i) => Math.abs(v - this.I[i]) < 1e-9)) delete L.data.xform; else L.data.xform = r;
  },
  /* 读回：矩阵＋人看得懂的拆法（缩放 sx／sy、角度、水平斜切，正＝顺时针；PS 选项栏同一套） */
  info(L){
    const m = this.of(L); if (!m) return {xform:null};
    const [a, b, c, d] = m, sx = Math.hypot(a, b), det = a * d - b * c, ang = Math.atan2(b, a), sh = (a * c + b * d) / (det || 1);
    return {xform:m.slice(), scaleX:+(sx * 100).toFixed(3), scaleY:+(det / (sx || 1) * 100).toFixed(3), angle:+(ang * 180 / Math.PI).toFixed(3), skewH:+(Math.atan(sh) * 180 / Math.PI).toFixed(3)};
  },
  install(){
    const o = window.renderLayer;
    if (typeof o !== 'function' || o.__textXf) return false;
    const w = function(L, scale){
      const c = o.apply(this, arguments);
      const M = c && TextXform.doc(L); if (!M) return c;
      const key = M.join(',') + '|' + scale;
      if (L._xfSrc === c && L._xfKey === key && L._xfOut) return L._xfOut;
      const out = document.createElement('canvas'); out.width = c.width; out.height = c.height;
      const x = out.getContext('2d'); x.imageSmoothingQuality = 'high';
      x.setTransform(M[0], M[1], M[2], M[3], M[4] * scale, M[5] * scale);
      x.drawImage(c, 0, 0);
      L._xfSrc = c; L._xfKey = key; L._xfOut = out;
      return out;
    };
    Object.keys(o).forEach(k => { if (k.startsWith('__')) w[k] = o[k]; });
    w.__textXf = true; w.toString = () => String(o);
    window.renderLayer = w;
    return true;
  },
};
/* 等别的档都包好（它们在 load 时包）再包在最外面 */
(function(){
  const go = () => setTimeout(() => { if (TextXform.install() && window.UI && UI.canvas) UI.draw(); }, 0);
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
})();
CMD.reg('text.transform', {i18n:'', params:'{layerId?, reset?:bool} 文字层的变形（斜切／旋转等记在图层上、字仍可改）：不给参数＝读回 {xform:[a,b,c,d,e,f]|null, scaleX, scaleY, angle, skewH}；reset=true＝拿掉变形回到平的。要斜切／旋转用 ps.edit.transform.skew／rotate、move.transform 或 Ctrl+T 框', undoable:true}, p => {
  p = p || {};
  const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  if (!L || L.kind !== 'text') return {ok:false, error:'not a text layer'};
  if (p.reset){ delete L.data.xform; Layer.invalidate(L); }
  return Object.assign({ok:true, layerId:L.id}, TextXform.info(L));
});
