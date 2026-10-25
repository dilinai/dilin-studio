/* 套索（L）——照 ArtCraft 的 Rust 原码逐段翻译
   一颗工具两套行为，按当前图层种类分岔（for:'common'）：
   ■ 像素层／文字层 ＝ PhotoCraft 的「套索」＋「多边形套索」（选项 kind:'free'|'poly' 代替他们两颗工具）→ 造像素选区 Doc.sel
     对照源（photocraft/crates/…）：
       ui-egui/src/canvas.rs  33-81      Drag（start／points／按下时的修饰键／reposition）、shift_to
       ui-egui/src/canvas.rs  263-286    freehand_tool：套索吃「这一帧所有的指针移动」（我们用 getCoalescedEvents）
       ui-egui/src/canvas.rs  1474-1555  拖曳要超过点击距离才算；没拖＝点一下（Down＋Up 同一点）
       ui-egui/src/canvas.rs  1794-1806  draw_tool_state：多边形进行中＝已点的点＋游标那一点画开放行军蚁，每个顶点 5×5 白方块黑框
       ui-egui/src/canvas.rs  1902-1905  拖曳预览：沿走过的点画开放行军蚁
       ui-egui/src/canvas.rs  1942-1964  tool_move：Space 按着＝整条套索跟着走（shift_to）；否则曼哈顿距离 >0.25 才记一点
       ui-egui/src/canvas.rs  2074-2085  多边形套索：按一下加一个顶点；已有 ≥3 点且点在第一点 8 个萤幕点内＝闭合
       ui-egui/src/canvas.rs  2110-2140  放开：最后一点不同才补进去
       ui-egui/src/canvas.rs  2196-2204  finish_gesture 套索：≥3 点 ⇒ select.lasso（模式看按下那一刻的修饰键）；否则有选区就 select.deselect
       ui-egui/src/canvas.rs  2253-2266  selection_mode、commit_polygon（≥3 点才选；模式看闭合那一下的修饰键）
       ui-egui/src/shortcuts.rs 273-306  多边形进行中：Enter 闭合（不带修饰键＝选项栏模式）、Esc 取消；L 键在同组（套索／多边形套索）里轮换
       ui-egui/src/hold_keys.rs 6,96-104 拖着套索时 Space＝重新定位（不变抓手）
       ui-egui/src/tool_feedback.rs      游标旁 ＋／−／× 模式标记、行军蚁（白底黑虚线 4 点）、selection_mode
       ui-egui/src/panels.rs  587-606, 791-797  选项栏：四个模式钮、羽化、消除锯齿；提示字（多边形进行中换成「按第一点或 Enter 闭合 · Esc 取消」）
       engine/src/selection_cmds.rs 300-316, 352-359  select.lasso：≥3 点、polygon 遮罩、羽化、set_selection 合成
       algo/src/selection.rs  76-151     coverage8、combine（replace／add／subtract／intersect，8 位量化；全空＝取消选择）
       algo/src/selection.rs  631-681    feather（σ＝半径/2）、polygon（奇偶规则；消除锯齿＝每列 4 条子扫描线、水平方向精确覆盖）
       algo/src/selection_blur.rs 620-656 feather 本体（截在 3σ、画布外当 0）
   ■ 矢量层 ＝ VectorCraft 的 LassoTool（Q）→ 圈锚点（走 VecSel，跟直接选择共用选取状态）
     对照源（vectorcraft/crates/…）：
       tools/src/xform/wand.rs 48-64     point_in_polygon（奇偶规则）
       tools/src/xform/wand.rs 66-160    LassoTool：Down 起点、Drag 距上一点 ≥1 萤幕点才记、Up：<3 点（没按 Shift/Alt）＝select.none；
                                         圈到的锚点 ⇒ select.anchorsMany（Shift＝add；Alt＝从目前锚点选取减掉）；Esc 取消；叠画＝深灰 1px 虚线
       engine/src/cmd/select.rs 218-240  select.anchorsMany：add=false 先清空；某条路径锚点全被圈到＝整条选中，否则并进部分选取
       engine/src/lib.rs 1058-1069       Session::select：选取不进历史（undo 时选取跟着那一步的快照回去）
   选区遮罩格式与合成共用 tools/marquee.js 的 SelMask（Doc.sel = {x,y,w,h, shape?:'mask'} ＋不可列举的 mask）。
   🔴 改文件的事全走 CMD：lasso.select／lasso.deselect（进历史）、lasso.anchors／lasso.anchorsMany（矢量锚点选取）、lasso.options、lasso.pointer（agent 送同一串滑鼠事件）。 */
(function(){

/* ── 常数（出处写在旁边） ── */
const CLICK_DIST = 6;          // egui max_click_dist：按下后移动没超过 6 点＝点一下（同 marquee.js）
const CLICK_TIME = 800;        // egui max_click_duration 0.8 s
const CLOSE_PX = 8;            // canvas.rs:2077  点回第一点 8 个萤幕点内＝闭合多边形
const DASH = 4;                // tool_feedback.rs:109  行军蚁虚线长（萤幕点）
const MODES = ['replace', 'add', 'subtract', 'intersect'];

/* selection.rs:78 coverage8：夹到 0..1、×255 四舍五入；NaN → 0 */
const coverage8 = v => (v > 0) ? Math.floor(Math.min(1, v) * 255 + 0.5) : 0;

/* ═══════════ 算法（algo/src/selection.rs 原样翻译；area 一律是整张文件 [0,0,W,H]） ═══════════ */

/* selection.rs:638-681 polygon：奇偶规则的多边形覆盖度。
   每列像素取 sub 条子扫描线（消除锯齿 4 条、否则 1 条，取在列内 (s+0.5)/sub 处），求与各边的交点 x、排序、两两配成跨段；
   消除锯齿时每格加「跨段与这格 [cx,cx+1) 的重叠长度」/sub（水平方向精确），否则格中心落在跨段里才算 1。最后夹到 ≤1。 */
function polygonMask(points, W, H, aa){
  const m = new Float32Array(W * H);
  const n = points.length;
  if (n < 3) return m;
  const sub = aa ? 4 : 1;
  // 多边形上下界外的列不会有交点（结果相同，只是省掉白算）
  let ymin = Infinity, ymax = -Infinity;
  for (const p of points){ if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1]; }
  const py0 = Math.max(0, Math.floor(ymin) - 1), py1 = Math.min(H, Math.ceil(ymax) + 1);
  const xs = [];
  for (let py = py0; py < py1; py++){
    for (let s = 0; s < sub; s++){
      const y = py + (s + 0.5) / sub;
      xs.length = 0;
      for (let i = 0; i < n; i++){
        const a = points[i], b = points[(i + 1) % n];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2){          // as_chunks::<2>：落单的最后一个丢掉
        const x0 = Math.max(xs[k], 0), x1 = Math.min(xs[k + 1], W);
        if (x1 <= x0) continue;
        const c0 = Math.floor(x0), c1 = Math.min(Math.ceil(x1), W);
        for (let cx = c0; cx < c1; cx++){
          let cov;
          if (aa) cov = Math.min(cx + 1, x1) - Math.max(cx, x0);
          else { const c = cx + 0.5; cov = (c >= x0 && c < x1) ? 1 : 0; }
          m[py * W + cx] += Math.max(cov, 0) / sub;
        }
      }
    }
  }
  for (let i = 0; i < m.length; i++) if (m[i] > 1) m[i] = 1;
  return m;
}

/* selection_blur.rs:620-656 feather（marquee.js 同一份）：可分离高斯，σ＝radius/2，<0.1 不动；核截在 ⌈3σ⌉；画布外当 0；只算有值外框外扩 r 那一块 */
function feather(m, w, h, radius){
  const sigma = Math.max(0, radius) / 2;
  if (sigma < 0.1) return m.slice();
  const r = Math.ceil(sigma * 3);
  let k = []; for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = k.reduce((a, b) => a + b, 0); k = k.map(v => v / sum);
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]){ if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; by1 = y; }
  const out = new Float32Array(m.length);
  if (bx1 < 0) return out;
  const X0 = Math.max(0, bx0 - r), X1 = Math.min(w - 1, bx1 + r), Y0 = Math.max(0, by0 - r), Y1 = Math.min(h - 1, by1 + r);
  const tmp = new Float32Array(m.length);
  for (let y = by0; y <= by1; y++) for (let x = X0; x <= X1; x++){
    let a = 0;
    for (let i = 0; i < k.length; i++){ const xx = x + i - r; if (xx >= 0 && xx < w) a += m[y * w + xx] * k[i]; }
    tmp[y * w + x] = a;
  }
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++){
    let a = 0;
    for (let i = 0; i < k.length; i++){ const yy = y + i - r; if (yy >= 0 && yy < h) a += tmp[yy * w + x] * k[i]; }
    out[y * w + x] = a;
  }
  return out;
}

/* selection.rs:128-151 combine：新遮罩先量化到 8 位格（q），再跟旧选区逐格合成；replace 直接写 */
function combine(old, mask, mode){
  const n = mask.length, out = new Uint8Array(n);
  const q = v => coverage8(v) / 255, at = i => old ? old[i] / 255 : 0;
  if (mode === 'add')            for (let i = 0; i < n; i++) out[i] = coverage8(Math.max(at(i), q(mask[i])));
  else if (mode === 'subtract')  for (let i = 0; i < n; i++) out[i] = coverage8(Math.max(at(i) - q(mask[i]), 0));
  else if (mode === 'intersect') for (let i = 0; i < n; i++) out[i] = coverage8(Math.min(at(i), q(mask[i])));
  else                           for (let i = 0; i < n; i++) out[i] = coverage8(mask[i]);
  return out;
}

/* selection_cmds.rs:300-305 读 points：[[x,y]…]，读不出数字的那一点丢掉（也收 {x,y}） */
function parsePoints(a){
  if (!Array.isArray(a)) return [];
  const out = [];
  for (const q of a){
    const x = Array.isArray(q) ? q[0] : (q && q.x), y = Array.isArray(q) ? q[1] : (q && q.y);
    if (typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y)) out.push([x, y]);
  }
  return out;
}

/* ═══════════ 像素选区命令（engine/src/selection_cmds.rs lasso） ═══════════ */
function selectLasso(p){
  const pts = parsePoints(p.points);
  if (pts.length < 3) return {ok:false, error:'lasso.select: needs at least 3 points'};
  if (!window.SelMask) return {ok:false, error:'lasso.select: SelMask (tools/marquee.js) not loaded'};
  const W = Doc.width, H = Doc.height;
  const aa = typeof p.antiAlias === 'boolean' ? p.antiAlias : true;                  // b(p,"antiAlias",true)
  const fe = Number(p.feather);                                                       // f(p,"feather",0)
  const mode = (typeof p.mode === 'string' && MODES.includes(p.mode)) ? p.mode : 'replace';   // SelectionMode::parse：不认得＝replace
  let mask = polygonMask(pts, W, H, aa);
  if (isFinite(fe) && fe > 0) mask = feather(mask, W, H, Math.min(fe, 1000));
  const old = mode === 'replace' ? null : SelMask.bytes();
  Doc.sel = SelMask.fromBytes(combine(old, mask, mode));                              // 全空 ⇒ null＝取消选择
  return {ok:true, selected:!!Doc.sel, selection:Doc.sel};
}
CMD.reg('lasso.select', {i18n:'tool.lasso', undoable:true,
  params:'{points:[[x,y]…] 文件坐标 ≥3 点（多边形，首尾自动相连）, mode="replace|add|subtract|intersect"="replace", antiAlias=true, feather=0..1000 px} 同 PhotoCraft select.lasso：奇偶规则填满；消除锯齿＝每列 4 条子扫描线、水平精确覆盖；羽化＝σ=半径/2 高斯；跟现有选区合成，全空＝取消选择 → {ok, selected, selection:{x,y,w,h, shape?:"mask"}|null}'},
  selectLasso);
CMD.reg('lasso.deselect', {i18n:'', undoable:true, params:'{} 取消选择（同 select.deselect；套索点一下、或拖不满 3 点就是这条）'},
  () => { Doc.sel = null; return {ok:true}; });

/* ═══════════ 矢量锚点选取（vectorcraft wand.rs LassoTool ＋ cmd/select.rs anchors_many） ═══════════ */
/* wand.rs:48-64 point_in_polygon（奇偶规则） */
function pointInPolygon(poly, p){
  const n = poly.length; if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++){
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const vecLayer = p => {
  const L = (p && p.layerId) ? Doc.byId(p.layerId) : Doc.active();
  return (L && L.kind === 'vector') ? L : null;
};
/* 锚点参照：[subpath, idx] 或 idx（我们一个形状只有一个 subpath＝0） */
const parseRefs = a => (Array.isArray(a) ? a : []).map(r => Array.isArray(r) ? ((r[0] | 0) === 0 ? r[1] : -1) : r)
  .filter(i => Number.isInteger(i) && i >= 0);

/* select.rs:218-240 anchors_many */
function anchorsMany(L, items, add){
  if (!add) VecSel.clear();
  for (const it of (items || [])){
    const s = it && L.data.shapes.find(x => x.id === it.id), g = VecSel.asBezier(s);   // 活形状用视图（选锚点不改文件）
    if (!g || !g.anchors) continue;
    const n = g.anchors.length;
    const refs = Array.from(new Set(parseRefs(it.anchors))).filter(i => i < n);
    if (refs.length < n){
      // 🟢 我们改的：原码 add 时对「整条已选中」的路径会 entry().or_default() 建出部分集合，反而把它缩成只剩这几颗；PS/AI 加选不会缩，这里保持整条
      if (add && VecSel.layerId === L.id && VecSel.isShapeFullySelected(s.id)) continue;
      const cur = (VecSel.layerId === L.id && VecSel.anchors[s.id]) ? VecSel.anchors[s.id] : [];
      VecSel.setAnchors(L.id, s.id, cur.concat(refs));
    } else VecSel.addShape(L.id, s.id);
  }
}
CMD.reg('lasso.anchorsMany', {i18n:'',
  params:'{items:[{id:形状id, anchors:[[0,锚点索引]…]（或 [索引…]）}], add?=false, layerId?=当前层} 照 select.anchorsMany：add=false 先清空；某条路径的锚点全列到＝整条选中，否则并进它的部分选取（整条已选的路径 add 时保持整条）。选取不进历史 → {ok, selection}'},
  p => {
    const L = vecLayer(p); if (!L) return {ok:false, error:'lasso.anchorsMany: not a vector layer'};
    anchorsMany(L, p.items, !!p.add);
    return {ok:true, selection:VecSel.snapshot()};
  });

/* wand.rs:99-137 LassoTool 放开那一段：圈里有哪些锚点 → 选取 */
function lassoAnchors(p){
  const L = vecLayer(p); if (!L) return {ok:false, error:'lasso.anchors: not a vector layer'};
  const poly = parsePoints(p.points);
  const mode = p.mode === 'add' || p.mode === 'subtract' ? p.mode : 'set';
  const add = mode === 'add', sub = mode === 'subtract';
  if (poly.length < 3){                                                     // wand.rs:103-105
    if (!add && !sub) VecSel.clear();
    return {ok:true, hits:[], selection:VecSel.snapshot()};
  }
  // 每条可编辑路径里落在圈内的锚点（锚点存图层坐标 ⇒ 加 L.x/L.y 换成文件坐标再比；铁律④）；图层看不见＝不可选（is_visible）
  const hits = [];
  if (L.visible) for (const s of L.data.shapes){
    const g = VecSel.asBezier(s); if (!g || !g.anchors) continue;
    const v = []; g.anchors.forEach((a, i) => { if (pointInPolygon(poly, [a.x + L.x, a.y + L.y])) v.push(i); });
    if (v.length) hits.push({id:s.id, anchors:v});
  }
  if (sub){
    // wand.rs:118-134：目前的锚点选取减掉圈到的；减到一颗不剩的路径退出选取
    if (VecSel.layerId !== L.id) return {ok:true, hits, selection:VecSel.snapshot()};   // 选取在别层：这层圈不到它的锚点，原样不动
    const items = [];
    for (const id of VecSel.shapes){
      const s = L.data.shapes.find(x => x.id === id), g = VecSel.asBezier(s); if (!g || !g.anchors) continue;
      const cur = VecSel.anchors[id] ? VecSel.anchors[id].slice() : g.anchors.map((_, i) => i);
      const h = hits.find(x => x.id === id), remove = h ? h.anchors : [];
      const rest = cur.filter(i => !remove.includes(i));
      if (rest.length) items.push({id, anchors:rest});
    }
    anchorsMany(L, items, false);
  } else anchorsMany(L, hits, add);
  return {ok:true, hits, selection:VecSel.snapshot()};
}
CMD.reg('lasso.anchors', {i18n:'',
  params:'{points:[[x,y]…] 文件坐标（圈的折线，首尾自动相连）, mode="set"|"add"|"subtract"="set", layerId?=当前层} 照 VectorCraft 套索放开：圈内（奇偶规则）的锚点 ⇒ set＝只选它们；add（Shift）＝加选；subtract（Alt）＝从目前锚点选取减掉。<3 点：set＝取消选取，add/subtract＝不动。只看当前矢量层且图层要看得见。选取不进历史 → {ok, hits:[{id, anchors:[索引…]}], selection}'},
  lassoAnchors);

/* ═══════════ 画面小工具（tool_feedback.rs） ═══════════ */
/* tool_feedback.rs:41-73 selection_mode：⇧⌥ 交集、⇧ 增加、⌥ 减去，否则看选项栏 */
function selectionMode(bar, m){
  if (m.shift && m.alt) return 'intersect';
  if (m.shift) return 'add';
  if (m.alt) return 'subtract';
  return MODES[Math.min(3, Math.max(0, bar | 0))];
}
/* tool_feedback.rs:113-142 ants：白实线底＋黑虚线 */
function ants(ctx, pts, closed, dpr){
  if (pts.length < 2) return;
  ctx.save(); ctx.lineWidth = 1;
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); if (closed) ctx.closePath();
  ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.setLineDash([DASH * dpr, DASH * dpr]); ctx.strokeStyle = '#000'; ctx.stroke();
  ctx.restore();
}
/* tool_feedback.rs:84-106 draw_badge：游标右下 (30,11) 点，白字黑晕 */
function drawBadge(ctx, p, mode, dpr){
  if (mode === 'replace') return;
  const c = [p[0] + 30 * dpr, p[1] + 11 * dpr], h = 3.5 * dpr;
  let segs;
  if (mode === 'add') segs = [[[c[0] - h, c[1]], [c[0] + h, c[1]]], [[c[0], c[1] - h], [c[0], c[1] + h]]];
  else if (mode === 'subtract') segs = [[[c[0] - h, c[1]], [c[0] + h, c[1]]]];
  else { const k = h * 0.8; segs = [[[c[0] - k, c[1] - k], [c[0] + k, c[1] + k]], [[c[0] - k, c[1] + k], [c[0] + k, c[1] - k]]]; }
  ctx.save();
  for (const [w, col] of [[3, 'rgba(0,0,0,0.78)'], [1.2, '#fff']]){
    ctx.lineWidth = w * dpr; ctx.strokeStyle = col; ctx.beginPath();
    segs.forEach(([a, b]) => { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }); ctx.stroke();
  }
  ctx.restore();
}

/* hold_keys.rs:102-104 repositions：拖着套索时 Space 归套索「重新定位」，不变抓手。
   抓手那支档的名单（HAND_REPOSITION_TOOLS，全域 const）还没有 lasso ⇒ 执行时加进去（不改它的档） */
function handReposition(){
  try { if (typeof HAND_REPOSITION_TOOLS !== 'undefined' && HAND_REPOSITION_TOOLS.add) HAND_REPOSITION_TOOLS.add('lasso'); } catch(_){}
}
handReposition();

/* 工具栏 PS 版面的「套索／多边形套索」两项都对到本工具时，L 键交给工具栏轮换（它会套 lasso.options kind）；否则我们自己轮换 */
function toolbarWired(){
  try {
    if (!window.Toolbar || !Toolbar.layout || Toolbar.layout.id !== 'ps') return false;
    return ['ps.lasso', 'ps.lasso-poly'].every(id => { const f = Toolbar.groupOf(id); return f && f.g.items[f.i].impl === 'lasso'; });
  } catch(_){ return false; }
}
function toolbarSurface(kind){
  try {
    if (!toolbarWired()) return;
    const f = Toolbar.groupOf(kind === 'poly' ? 'ps.lasso-poly' : 'ps.lasso');
    if (f && (Toolbar.cur[f.g.key] | 0) !== f.i) Toolbar.surface(f.g, f.i);
  } catch(_){}
}

/* ═══════════ 工具本体 ═══════════ */
const own = {mode:0, feather:0, antiAlias:true};
const LS = window.LassoTool = {
  // kind 是我们把「套索／多边形套索」两颗并成一颗多出来的；模式／羽化／消除锯齿在他们是全部选取工具共用一份
  //（app.ui.selection_mode、tool_options.feather／anti_alias）⇒ 跟选框共用 MarqueeTool.opt，没载入才用自己的
  opt: {kind:'free'},
  drag: null,          // 自由套索手势（canvas.rs Drag）：{start, points, press, reposition, moved, t0, client0}
  poly: [],            // 多边形套索已点的顶点（app.ui.polygon，文件坐标）
  vec: {points:[], active:false},   // 矢量套索（wand.rs LassoTool）
  hover: null, held: {shift:false, alt:false}, space: false,
  _badgeShown: false, _optKey: null,

  shared(){ return (window.MarqueeTool && MarqueeTool.opt) || own; },
  zoom(){ return Math.max(UI.zoom || 1, 0.01); },
  isVector(){ return (Doc.active() || {}).kind === 'vector'; },
  badge(){ return selectionMode(this.shared().mode, this.drag ? this.drag.press : this.held); },
  last(){ const d = this.drag; return d.points.length ? d.points[d.points.length - 1] : d.start; },

  /* ── 自由套索（像素层） ── */
  freeDown(pt, m){
    this.drag = {start:pt.slice(), points:[pt.slice()], press:{shift:!!m.shift, alt:!!m.alt}, reposition:!!m.space,
                 moved:!!m.moved, t0:performance.now(), client0:m.client || null};
  },
  /* canvas.rs:59-74 shift_to：起点和每一点都平移，让最后一点落在 to */
  shiftTo(to){
    const d = this.drag, last = this.last();
    const dx = to[0] - last[0], dy = to[1] - last[1];
    if (!isFinite(dx) || !isFinite(dy)) return;
    d.start = [d.start[0] + dx, d.start[1] + dy];
    d.points = d.points.map(p => [p[0] + dx, p[1] + dy]);
    if (!d.points.length) d.points.push(to.slice());
  },
  freeMove(pt, m){                                     // canvas.rs:1951-1962
    const d = this.drag; if (!d) return;
    if (m.space !== undefined) d.reposition = !!m.space;
    if (d.reposition){ this.shiftTo(pt); return; }
    const last = this.last();
    if (Math.abs(last[0] - pt[0]) + Math.abs(last[1] - pt[1]) > 0.25) d.points.push(pt.slice());
  },
  freeUp(pt, m){                                       // canvas.rs:2110-2140
    const d = this.drag; if (!d) return null;
    this.drag = null;
    if (!d.moved) return this.finishFree([pt.slice()], d.press);     // 点一下：Down＋Up 同一点 ⇒ 只有 1 点
    if (m.space !== undefined) d.reposition = !!m.space;
    if (d.reposition) { this.drag = d; this.shiftTo(pt); this.drag = null; }
    const last = d.points.length ? d.points[d.points.length - 1] : d.start;
    if (last[0] !== pt[0] || last[1] !== pt[1]) d.points.push(pt.slice());
    return this.finishFree(d.points, d.press);
  },
  /* canvas.rs:2196-2204 finish_gesture 的套索段 */
  finishFree(points, press){
    const o = this.shared();
    if (points.length >= 3){
      return CMD.run('lasso.select', {points:points.map(p => [p[0], p[1]]), mode:selectionMode(o.mode, press),
        antiAlias:o.antiAlias !== false, feather:o.feather || 0});       // 原码没把羽化传下去（选项栏却有这格）⇒ 我们传
    }
    if (Doc.sel) CMD.run('lasso.deselect');            // is_enabled("select.deselect")＝有选区才做
    return null;
  },

  /* ── 多边形套索（像素层） ── */
  polyDown(pt, m){                                     // canvas.rs:2074-2085
    const p0 = this.poly[0];
    const close = p0 && this.poly.length >= 3 && Math.hypot(p0[0] - pt[0], p0[1] - pt[1]) < CLOSE_PX / this.zoom();
    if (close) return this.commitPoly(m);
    this.poly.push(pt.slice());
    if (this.poly.length === 1) this.rebuildOptions();   // 提示字换成「按第一点或 Enter 闭合」（panels.rs:597-605）
    return null;
  },
  commitPoly(m){                                       // canvas.rs:2259-2266
    const pts = this.poly; this.poly = [];
    this.rebuildOptions();
    if (pts.length < 3) return null;
    const o = this.shared();
    return CMD.run('lasso.select', {points:pts.map(p => [p[0], p[1]]), mode:selectionMode(o.mode, m || {}),
      antiAlias:o.antiAlias !== false, feather:o.feather || 0});
  },
  /* 🟢 我们加的（PS 有、原码没有）：按两下闭合。第二下的按下已补进一个几乎同位置的点 ⇒ 先把尾巴上重复的点去掉 */
  polyDbl(m){
    if (!this.poly.length) return null;
    const tol = CLOSE_PX / this.zoom();
    while (this.poly.length >= 2){
      const a = this.poly[this.poly.length - 1], b = this.poly[this.poly.length - 2];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < tol) this.poly.pop(); else break;
    }
    return this.commitPoly(m);
  },
  /* shortcuts.rs:273-289 Enter 闭合（不带修饰键）／Esc 取消；🟢 Backspace／Delete 删掉上一点是我们加的（PS 有） */
  polyKey(key){
    if (!this.poly.length) return false;
    if (key === 'Enter'){ this.commitPoly({}); return true; }
    if (key === 'Escape'){ this.poly = []; this.rebuildOptions(); return true; }
    if (key === 'Backspace' || key === 'Delete'){ this.poly.pop(); if (!this.poly.length) this.rebuildOptions(); return true; }
    return false;
  },

  /* ── 矢量套索（wand.rs LassoTool） ── */
  vecDown(pt){ this.vec = {points:[pt.slice()], active:true}; },
  vecMove(pt){
    const v = this.vec; if (!v.active) return;
    const q = v.points[v.points.length - 1];
    if (!q || Math.hypot(q[0] - pt[0], q[1] - pt[1]) >= VecSel.tol(1)) v.points.push(pt.slice());   // cx.tol(1.0)＝1 萤幕点
  },
  vecUp(m){
    const v = this.vec; if (!v.active) return null;
    const poly = v.points; this.vec = {points:[], active:false};
    // 放开那一刻的修饰键：Alt（减）先看，再 Shift（加）
    return CMD.run('lasso.anchors', {points:poly.map(p => [p[0], p[1]]), mode:m.alt ? 'subtract' : m.shift ? 'add' : 'set'});
  },
  vecCancel(){ const was = this.vec.active; this.vec = {points:[], active:false}; return was; },

  reset(){ this.drag = null; this.poly = []; this.vec = {points:[], active:false}; },
  rebuildOptions(){ if (window.UI && ToolState.cur === 'lasso') UI.buildOptions('lasso'); },
  redrawHover(){
    if (ToolState.cur !== 'lasso' || !window.UI) return;
    const show = !this.isVector() && this.badge() !== 'replace';
    if (show || this._badgeShown || this.drag || this.poly.length) UI.draw();
    this._badgeShown = show;
  },

  /* ── 叠画 ── */
  draw(ctx, s){
    const dpr = s / this.zoom();
    // 图层种类变了（同一颗工具、选项栏要换一套）⇒ 重建选项栏
    const key = (this.isVector() ? 'v' : 'r') + (this.poly.length ? 'p' : '');
    if (this._optKey !== key){ this._optKey = key; if (ToolState.cur === 'lasso') UI.buildOptions('lasso'); }
    // 现有选区不是满格矩形 ⇒ 画真正的边界（outline.rs；满格矩形 ui.js 已画）
    const sel = Doc.sel;
    if (sel && sel.mask && window.SelMask){
      const sc = p => [Math.round(p[0] * s) + 0.5, Math.round(p[1] * s) + 0.5];
      ctx.save(); ctx.lineWidth = 1;
      ctx.beginPath(); SelMask.outline(sel).forEach(([a, b]) => { const A = sc(a), B = sc(b); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); });
      ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([DASH * dpr, DASH * dpr]); ctx.strokeStyle = '#000'; ctx.stroke();
      ctx.restore();
    }
    const S = p => [p[0] * s, p[1] * s];
    if (this.isVector()){
      VecSel.drawOverlay(ctx, s);                      // 圈到的锚点（跟直接选择同一份选取）
      const v = this.vec;
      if (v.active && v.points.length >= 2){           // wand.rs:150-155 Overlay::Path 深灰 1px 虚线、不闭合
        ctx.save(); ctx.lineWidth = 1 * dpr; ctx.strokeStyle = 'rgb(64,64,64)'; ctx.setLineDash([DASH * dpr, DASH * dpr]);
        ctx.beginPath(); v.points.map(S).forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
        ctx.restore();
      }
      return;
    }
    const d = this.drag;
    if (d && d.moved) ants(ctx, d.points.map(S), false, dpr);            // canvas.rs:1902-1905
    if (this.poly.length){                                               // canvas.rs:1796-1806
      const pts = this.poly.map(S);
      if (this.hover) pts.push(S(this.hover));
      ants(ctx, pts, false, dpr);
      const h = 2.5 * dpr;
      ctx.save(); ctx.lineWidth = 1 * dpr;
      for (const p of pts.slice(0, this.poly.length)){
        ctx.fillStyle = '#fff'; ctx.fillRect(p[0] - h, p[1] - h, 2 * h, 2 * h);
        ctx.strokeStyle = '#000'; ctx.strokeRect(p[0] - h - 0.5 * dpr, p[1] - h - 0.5 * dpr, 2 * h + dpr, 2 * h + dpr);
      }
      ctx.restore();
    }
    if (this.hover) drawBadge(ctx, S(this.hover), this.badge(), dpr);
  }
};

/* ── 选项（lasso.options：选项栏每个控件都只是叫这条） ── */
CMD.reg('lasso.options', {i18n:'',
  params:'{kind?="free"|"poly"（套索／多边形套索）, mode?=0..3 或 "replace|add|subtract|intersect"（新选区／增加／减去／交集）, feather?=0..1000 px, antiAlias?=bool} → 目前全部选项。mode／feather／antiAlias 跟选框共用一份（PhotoCraft 全部选取工具共用 selection_mode／feather／anti_alias）；换 kind 会丢掉进行中的多边形'},
  p => {
    const o = LS.shared();
    if ((p.kind === 'free' || p.kind === 'poly') && p.kind !== LS.opt.kind){
      LS.opt.kind = p.kind; LS.poly = []; LS.drag = null;
      toolbarSurface(p.kind);
    }
    if (p.mode !== undefined){ const i = typeof p.mode === 'string' ? MODES.indexOf(p.mode) : (p.mode | 0); if (i >= 0 && i <= 3) o.mode = i; }
    if (p.feather !== undefined && isFinite(+p.feather)) o.feather = Math.min(1000, Math.max(0, +p.feather));
    if (typeof p.antiAlias === 'boolean') o.antiAlias = p.antiAlias;
    LS.rebuildOptions();
    if (window.UI && ToolState.cur === 'lasso') UI.draw();
    return {kind:LS.opt.kind, mode:MODES[o.mode | 0], feather:o.feather || 0, antiAlias:o.antiAlias !== false};
  });

/* ── agent 送滑鼠事件：跟人拿滑鼠走同一组 freeDown/Move/Up、polyDown/Dbl/Key、vecDown/Move/Up ── */
CMD.reg('lasso.pointer', {i18n:'',
  params:'{events:[{kind:"down"|"move"|"up"|"dblclick"|"key", x, y 文件坐标, shift?, alt?, space?（自由套索拖的途中按着＝整条跟着走）, key?:"Enter"|"Escape"|"Backspace"（kind="key" 用）}…], kind?="free"|"poly"（先套这个选项）} ' +
         '一串指针事件跑一次套索手势，按当前图层种类分岔：像素层自由套索＝down→move…→up（down 的 shift/alt 定增加／减去／交集；down 后没 move 就 up＝点一下＝取消选择）；' +
         '像素层多边形套索＝每个 down 加一点、down 在第一点 8 萤幕点内＝闭合（那一下的 shift/alt 定模式）、dblclick 闭合、key Enter 闭合／Escape 取消／Backspace 删上一点；' +
         '矢量层＝down→move…→up 圈锚点（up 的 shift＝加、alt＝减）、key Escape 取消 → {ok, selection, vsel, polygon}'},
  p => {
    if (p.kind === 'free' || p.kind === 'poly') CMD.map['lasso.options'].run({kind:p.kind});
    const evs = Array.isArray(p.events) ? p.events : [];
    for (const e of evs){
      const pt = [Number(e.x) || 0, Number(e.y) || 0];
      const m = {shift:!!e.shift, alt:!!e.alt, space:!!e.space};
      LS.hover = pt;
      if (LS.isVector()){
        if (e.kind === 'down') LS.vecDown(pt);
        else if (e.kind === 'move') LS.vecMove(pt);
        else if (e.kind === 'up') LS.vecUp(m);
        else if (e.kind === 'key' && e.key === 'Escape') LS.vecCancel();
      } else if (LS.opt.kind === 'poly'){
        if (e.kind === 'down') LS.polyDown(pt, m);
        else if (e.kind === 'dblclick') LS.polyDbl(m);
        else if (e.kind === 'key') LS.polyKey(e.key);
      } else {
        if (e.kind === 'down') LS.freeDown(pt, m);
        else if (e.kind === 'move' && LS.drag){ LS.drag.moved = true; LS.freeMove(pt, m); }
        else if (e.kind === 'up' && LS.drag) LS.freeUp(pt, m);
        else if (e.kind === 'key' && e.key === 'Escape') LS.drag = null;
      }
    }
    if (window.UI) UI.draw();
    return {ok:true, selection:Doc.sel, vsel:VecSel.snapshot(), polygon:LS.poly.map(q => q.slice())};
  });

/* ── 键盘：修饰键（游标旁标记）、Space（拖着时重新定位） ── */
const typing = el => !!el && (el.isContentEditable || /^(input|select|textarea)$/i.test(el.tagName));
window.addEventListener('keydown', e => {
  if (typing(e.target)) return;
  if (e.key === 'Shift' || e.key === 'Alt'){
    LS.held = {shift:e.shiftKey, alt:e.altKey};
    if (ToolState.cur !== 'lasso') return;
    if (e.key === 'Alt') e.preventDefault();                 // 别让浏览器把焦点交给选单列
    LS.redrawHover(); return;
  }
  if (e.code === 'Space' || e.key === ' '){
    handReposition();
    LS.space = true;
    if (LS.drag && ToolState.cur === 'lasso') LS.drag.reposition = true;   // hold_keys.rs：拖着套索时 Space＝重新定位
  }
}, true);
window.addEventListener('keyup', e => {
  if (e.key === 'Shift' || e.key === 'Alt'){
    LS.held = {shift:e.shiftKey, alt:e.altKey};
    if (ToolState.cur === 'lasso') LS.redrawHover();
    return;
  }
  if (e.code === 'Space' || e.key === ' '){ LS.space = false; if (LS.drag) LS.drag.reposition = false; }
}, true);
window.addEventListener('blur', () => { LS.held = {shift:false, alt:false}; LS.space = false; });

/* 浏览器把一帧里的多次移动合并成一个 pointermove；套索是手绘工具，要全部拿回来（canvas.rs:1486-1512 pointer_moves） */
function coalesced(e, pt){
  const list = (e && e.getCoalescedEvents) ? e.getCoalescedEvents() : [];
  if (!list || list.length <= 1 || !UI.canvas) return [pt];
  const b = UI.canvas.getBoundingClientRect();
  return list.map(c => [(c.clientX - b.left) / UI.zoom, (c.clientY - b.top) / UI.zoom]);
}

/* ── 三语 ── */
const STRINGS = {
  'zh-Hant':{'ui.lassoFree':'套索工具', 'ui.lassoPoly':'多邊形套索工具',
    'ui.lassoNew':'新增選取範圍', 'ui.lassoAdd':'增加至選取範圍  (Shift)', 'ui.lassoSub':'從選取範圍中減去  (Alt)', 'ui.lassoInt':'與選取範圍相交  (Shift+Alt)',
    'opt.feather':'羽化', 'opt.antiAlias':'消除鋸齒',
    'ui.lassoHint':'拖曳（套索）或按點（多邊形套索） · Shift 增加 · Alt 減去 · Shift+Alt 相交 · 按一下取消選取 · 拖曳中 Space 移動套索 · L 切換套索／多邊形套索',
    'ui.lassoPolyHint':'按一下第一個點或按 Enter 以閉合 · 按兩下也閉合 · Backspace 刪掉上一點 · Esc 取消',
    'ui.lassoVecHint':'拖曳圈住錨點 · Shift 增加 · Alt 減去 · 圈空白處取消選取 · Esc 取消'},
  'zh-Hans':{'ui.lassoFree':'套索工具', 'ui.lassoPoly':'多边形套索工具',
    'ui.lassoNew':'新选区', 'ui.lassoAdd':'添加到选区  (Shift)', 'ui.lassoSub':'从选区减去  (Alt)', 'ui.lassoInt':'与选区交叉  (Shift+Alt)',
    'opt.feather':'羽化', 'opt.antiAlias':'消除锯齿',
    'ui.lassoHint':'拖动（套索）或单击各点（多边形套索） · Shift 添加 · Alt 减去 · Shift+Alt 交叉 · 单击取消选择 · 拖动中 Space 移动套索 · L 切换套索／多边形套索',
    'ui.lassoPolyHint':'单击起点或按 ↵ 闭合 · 双击也闭合 · Backspace 删去上一点 · Esc 取消',
    'ui.lassoVecHint':'拖动圈住锚点 · Shift 添加 · Alt 减去 · 圈空白处取消选择 · Esc 取消'},
  'en':{'ui.lassoFree':'Lasso Tool', 'ui.lassoPoly':'Polygonal Lasso Tool',
    'ui.lassoNew':'New selection', 'ui.lassoAdd':'Add to selection  (Shift)', 'ui.lassoSub':'Subtract from selection  (Alt)', 'ui.lassoInt':'Intersect with selection  (Shift+Alt)',
    'opt.feather':'Feather', 'opt.antiAlias':'Anti-alias',
    'ui.lassoHint':'Drag (lasso) or click points (polygonal)  ·  Shift add  ·  Alt subtract  ·  Shift+Alt intersect  ·  click to deselect  ·  Space moves it while dragging  ·  L switches Lasso/Polygonal',
    'ui.lassoPolyHint':'Click the first point or press Enter to close  ·  double-click also closes  ·  Backspace removes the last point  ·  Esc cancels',
    'ui.lassoVecHint':'Drag a loop around anchor points  ·  Shift add  ·  Alt subtract  ·  an empty loop deselects  ·  Esc cancels'}
};
if (typeof Lang !== 'undefined') Lang.add(STRINGS);

Tools.reg({
  id:'lasso', icon:'➰', key:'L', group:'select', order:22, for:'common', opts:[],
  strings:STRINGS,

  onDown(e, pt){
    if (e.button !== undefined && e.button !== 0){ LS.drag = null; return; }    // 工具只跟左键（canvas.rs:1462）
    handReposition();
    LS.hover = pt; LS.held = {shift:e.shiftKey, alt:e.altKey};
    const m = {shift:e.shiftKey, alt:e.altKey};
    if (LS.isVector()){ LS.vecDown(pt); UI.draw(); return; }
    if (LS.opt.kind === 'poly'){ LS.polyDown(pt, m); UI.draw(); return; }
    LS.freeDown(pt, Object.assign(m, {space:LS.space, client:[e.clientX, e.clientY]}));
  },
  onMove(e, pt, P){
    LS.hover = pt; LS.held = {shift:e.shiftKey, alt:e.altKey};
    if (LS.isVector()){ if (P.down && LS.vec.active){ LS.vecMove(pt); UI.draw(); } return; }
    if (LS.opt.kind === 'poly'){ if (LS.poly.length) UI.draw(); else LS.redrawHover(); return; }   // 多边形：橡皮筋跟着游标
    const d = LS.drag;
    if (!P.down || !d){ LS.redrawHover(); return; }
    // egui：移动超过点击距离（或按太久）才认定是拖；之前的移动不送给工具
    if (!d.moved){
      const c = d.client0, far = c ? Math.hypot(e.clientX - c[0], e.clientY - c[1]) > CLICK_DIST : true;
      if (!far && performance.now() - d.t0 <= CLICK_TIME) return;
      d.moved = true;
    }
    for (const q of coalesced(e, pt)) LS.freeMove(q, {space:LS.space});
    UI.draw();
  },
  onUp(e, pt){
    if (LS.isVector()){ if (LS.vec.active) LS.vecUp({shift:e.shiftKey, alt:e.altKey}); UI.draw(); return; }
    if (LS.opt.kind === 'poly'){ UI.draw(); return; }
    const d = LS.drag;
    if (d && !d.moved && performance.now() - d.t0 > CLICK_TIME) d.moved = true;
    LS.freeUp(pt, {space:LS.space});
    UI.draw();
  },
  onDblClick(e){
    if (LS.isVector() || LS.opt.kind !== 'poly') return;
    LS.polyDbl({shift:e.shiftKey, alt:e.altKey}); UI.draw();
  },
  onKey(e){
    const k = e.key;
    if (LS.isVector()){
      if (k === 'Escape' && LS.vecCancel()){ UI.draw(); return true; }        // wand.rs:142-148
      return false;
    }
    if (LS.poly.length && !e.ctrlKey && !e.metaKey && LS.polyKey(k)){ UI.draw(); return true; }
    if (k === 'Escape' && LS.drag){ LS.drag = null; UI.draw(); return true; }   // 🟢 我们加的：拖到一半 Esc 放弃
    // shortcuts.rs:294-305：已经是套索时按 L ⇒ 套索／多边形套索轮换（工具栏两项都接上了就让工具栏轮换、它会套选项）
    if (k.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey){
      if (toolbarWired()) return false;
      CMD.run('lasso.options', {kind:LS.opt.kind === 'free' ? 'poly' : 'free'});
      UI.draw(); return true;
    }
    return false;
  },
  onDeactivate(){ LS.reset(); LS.hover = null; LS._optKey = null; },
  drawOverlay(ctx, s){ LS.draw(ctx, s); },

  /* panels.rs:587-606 选项栏 ＋ 791-797 提示；矢量层（VectorCraft 套索没有选项）只给提示 */
  buildOptions(box, add, mk){
    const hint = key => { const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.dataset.hint = key; h.textContent = Lang.t(key); box.appendChild(h); };
    if (LS.isVector()){ hint('ui.lassoVecHint'); return; }
    const o = LS.shared();
    const set = p => { CMD.run('lasso.options', p); UI.draw(); };
    const btn = (txt, tipKey, on, fn, data) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = txt; b.title = Lang.t(tipKey);
      b.style.cssText = `margin:0 1px;min-width:24px;cursor:pointer;${on ? 'background:#2f7fd8;color:#fff;' : ''}`;
      Object.assign(b.dataset, data || {}); b.onclick = fn; box.appendChild(b); return b;
    };
    const sep = () => { const v = document.createElement('span'); v.style.cssText = 'display:inline-block;width:1px;height:18px;background:#555;margin:0 6px;vertical-align:middle'; box.appendChild(v); };
    btn('➰', 'ui.lassoFree', LS.opt.kind === 'free', () => set({kind:'free'}), {kind:'free'});
    btn('⬠', 'ui.lassoPoly', LS.opt.kind === 'poly', () => set({kind:'poly'}), {kind:'poly'});
    sep();
    [['□', 'ui.lassoNew'], ['＋', 'ui.lassoAdd'], ['−', 'ui.lassoSub'], ['⧉', 'ui.lassoInt']].forEach(([t, k], i) =>
      btn(t, k, (o.mode | 0) === i, () => set({mode:i}), {mode:MODES[i]}));
    sep();
    const fe = mk('number', {min:0, max:1000, step:1, value:o.feather || 0}); fe.style.width = '56px'; fe.dataset.opt = 'feather';
    fe.onchange = () => set({feather:+fe.value}); add('feather', fe);
    const aa = mk('checkbox', {checked:o.antiAlias !== false}); aa.dataset.opt = 'antiAlias';
    aa.onchange = () => set({antiAlias:aa.checked}); add('antiAlias', aa);
    hint(LS.opt.kind === 'poly' && LS.poly.length ? 'ui.lassoPolyHint' : 'ui.lassoHint');
  }
});

})();
