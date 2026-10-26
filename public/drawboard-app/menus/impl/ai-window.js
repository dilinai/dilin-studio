/* 堤麟画板 · 顶菜单实作 · Illustrator ▸ 窗口（命令名 ai.<原码 id>）
   外壳用 menus/impl/panels.js（window.DlPanels）；历史记录、导航器、信息、动作、图层借 ps-window.js 定义好的面板（同一个面板、同一份文件）。
   照 ArtCraft VectorCraft 原码逐段翻译：
     ui-egui/src/menus.rs 868-946, 1143-1156, 2024-2088   window.control／taskBar／toolbar／toolbarAdvanced／toolbarColumns、window.panel {panel}、勾选、窗口菜单树
                                                           （原码图标面板一次只开一个、属性／图层／库只切不关；🔴 ⇒ 我们改成每个面板各自开关）
     ui-egui/src/workspaces.rs 14-292                      九个内建工作区（基本功能＝UiState 预设，其余列出的差异）、重置／新建／管理（改名、删除；内建不能删改）
     ui-egui/src/panels/*.rs                               各面板栏位（align、pathfinder、stroke、transparency、transform、appearance、swatches、color、color_guide、
                                                           color_themes、gradient、artboards、attributes、brushes、symbols、graphic_styles、doc_info、info、links、magic_wand、
                                                           separations、css_properties、flattener_preview、asset_export、image_trace、pattern_options、character、paragraph、opentype、tabs、text_styles）
     ui-egui/src/panels/swatches.rs 1101-1156、color/src/libraries.rs 58-439   色板库（OKLCH 算出来的 9 个色板库＋5 个渐变库）、Default Swatches（color/src/swatch.rs:80-154）
     ui-egui/src/panels/graphic_styles.rs 746-799、doc/src/style_libs.rs 146-153  图形样式库（6 个）
     color/src/harmony.rs 1-345                            颜色参考的 21 条和谐规则、变化格（深浅／冷暖／鲜艳）
     engine/src/cmd/object.rs 806-904                      object.distribute／distributeSpacing、object.setBounds
   我们这边：
     ■ 描边（端点、边角、斜接限制、虚线）、透明度（混合模式、不透明度）、属性（填色规则）在 engine.js 的 drawShape 没有 ⇒ 执行期包一层 drawShape 把这几个栏位套进 canvas（不改 engine.js）。
     ■ 路径查找器面板的十个钮＝把选取编组、套 ai-effect 的「活」路径查找器效果、再扩展外观（借 AiFx 照 pathops/pathfinder.rs 算好的结果），一步历史。
   各面板补深（照 panels/*.rs 逐个面板；新栏位都在形状上 ⇒ 历史快照、工程档自动带）：
     ■ 描边：对齐描边内侧／外侧（s.strokeAlign）、40 种箭头（startArrow／endArrow／arrowScale／arrowAlign，arrow.rs）、宽度配置文件（s.profile／profileFlip，width.rs）、虚线对齐、面板菜单（配置文件增删重置）
     ■ 透明度：不透明蒙版（s.opMask＝{art, clip, invert, linked, disabled}；制作／释放／剪切／反相／链接／停用／只看蒙版）、隔离混合、挖空组（只记状态）、面板菜单全套
     ■ 外观：多层填色／描边（s.apStack）、眼睛、复制／删除项目、清除、简化至基本外观；画笔：默认库 14 支真的画（书法／散布／艺术／图案／毛刷）、新建、扩展
     ■ 对齐：关键对象（ai.select.key）、对齐画板（选取中心所在的 AiR3 画板）；画板面板＝ai-object.js 的 AiR3 画板（新建／复制／删除／上下移／改名／删除空画板）
     ■ 色板、符号（实例 s.symbol）、图形样式、链接、资源导出（PNG／JPG／SVG 格式列）、图案选项、渐变（加删色标、中点、不透明度）、变换、字符／段落／OpenType、文档信息、CSS、拼合器、分色、颜色参考／主题 的面板菜单
     ■ SVG 导出不认这几个新栏位（箭头、配置文件、画笔、蒙版、多层外观只在画面／PNG 出现）——engine Project.toSVG 要接才有。 */
(function(){
if (window.AiWindow && window.AiWindow.__loaded) return;
if (!window.DlPanels){ console.warn('[ai-window] 需要 menus/impl/panels.js'); return; }
const P = window.DlPanels, el = P.el.bind(P), T = P.t;
const L3 = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, en:c});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clone = v => JSON.parse(JSON.stringify(v));
const hex2 = v => ('0' + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2);
const rgbHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);
const hexRgb = h => { h = String(h || '#000000').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0]; };
const has = id => !!CMD.map[id];
const peek = (id, p) => CMD.map[id] ? CMD.map[id].run(p || {}) : null;
const runCmd = (id, p) => { try { const r = CMD.run(id, p || {}); if (r && r.ok === false) console.warn('[ai-window]', id, r.error); return r; } catch(e){ console.error(e); return {ok:false, error:String(e)}; } };
const btn = (label, title, onclick, opt) => el('button', Object.assign({text:label, title:title ? T(title) : null, onclick}, opt || {}));
const row = (label, ...kids) => el('div', {class:'row'}, [label !== null ? el('span', {text:T(label)}) : null, ...kids]);
const err = (c, m) => ({ok:false, error:`${c}: ${m}`});
const AiWindow = window.AiWindow = {__loaded:true};

/* ═══════════ 选取（VecSel：一层、选中的物件 id） ═══════════ */
function sel(p){
  p = p || {};
  const L = p.layerId ? Doc.byId(p.layerId) : (window.VecSel && VecSel.layer());
  if (!L || L.kind !== 'vector') return {L:null, R:[]};
  const ids = Array.isArray(p.ids) ? p.ids : (window.VecSel ? VecSel.shapes : []);
  return {L, R:L.data.shapes.filter(s => ids.includes(s.id))};
}
const leaves = s => (s.type === 'group' || s.type === 'compound') && Array.isArray(s.children) && s.type !== 'compound' ? s.children.flatMap(leaves) : [s];
const docF = L => (p => [p[0] + L.x, p[1] + L.y]);
function bounds(L, s, visual){ try { return window.AIObj ? AIObj.shapeBounds(s, docF(L), !!visual) : null; } catch(e){ return null; } }
function unionB(L, R, visual){ return R.reduce((r, s) => { const b = bounds(L, s, visual); return !b ? r : !r ? b : {x0:Math.min(r.x0, b.x0), y0:Math.min(r.y0, b.y0), x1:Math.max(r.x1, b.x1), y1:Math.max(r.y1, b.y1)}; }, null); }
function done(L){ Layer.invalidate(L); return {ok:true, ids:sel().R.map(s => s.id)}; }
AiWindow.sel = sel;

/* ═══════════ drawShape 补丁：描边端点／边角／斜接／虚线、不透明度、混合、填色规则（stroke.rs、transparency.rs、attributes.rs 的栏位） ═══════════ */
const CAP = {butt:'butt', round:'round', square:'square', projecting:'square'}, JOIN = {miter:'miter', round:'round', bevel:'bevel'};
const BLEND = {normal:'source-over', darken:'darken', multiply:'multiply', colorBurn:'color-burn', lighten:'lighten', screen:'screen', colorDodge:'color-dodge', overlay:'overlay', softLight:'soft-light',
  hardLight:'hard-light', difference:'difference', exclusion:'exclusion', hue:'hue', saturation:'saturation', color:'color', luminosity:'luminosity'};
/* ── 描边面板的对齐描边、箭头、宽度配置文件，画笔面板的画笔描边，外观面板的多层填色／描边，透明度面板的不透明蒙版——
     engine.js 的 drawShape 都没有 ⇒ 一样在这里执行期包一层（不改 engine.js）。照原码：
       effects/src/stroke/arrow.rs（40 种箭头：前 10 种 shape、其余 local 局部单位；inset／tip／extend）、effects/src/stroke/width.rs（宽度配置文件＝填色外框）、
       doc/src/appearance.rs:58-280（Arrowhead、WidthProfile.PRESETS 7 种）、brush/src/defaults.rs（默认画笔库 14 支）、brush/src/calli.rs（椭圆笔尖扫掠）、
       ui-egui/src/panels/transparency.rs（不透明蒙版：clip／invert／link／disable）。 */
const V2 = {add:(a, b) => [a[0] + b[0], a[1] + b[1]], sub:(a, b) => [a[0] - b[0], a[1] - b[1]], mul:(a, k) => [a[0] * k, a[1] * k], dot:(a, b) => a[0] * b[0] + a[1] * b[1],
  len:a => Math.hypot(a[0], a[1]), unit:a => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; }};
/* 形状 → 折线（画布单位＝图层坐标×S）：[{pts, closed}]；跟 engine drawShape 的几何一致 */
function flat(s, S){
  const out = [], push = (pts, closed) => { if (pts.length >= 2) out.push({pts:pts.map(p => [p[0] * S, p[1] * S]), closed}); };
  if (!s) return out;
  if (s.type === 'compound' || s.type === 'group'){ (s.children || []).forEach(c => flat(Object.assign({}, c, {closed:c.closed !== false}), 1).forEach(x => push(x.pts, s.type === 'compound' ? (c.closed !== false) : x.closed))); return out; }
  if (s.type === 'rect'){
    const r = Math.min(Math.max(0, s.radius || 0), Math.abs(s.w) / 2, Math.abs(s.h) / 2), x = s.x, y = s.y, w = s.w, h = s.h;
    if (r > 0){ const pts = [], arc = (cx, cy, a0) => { for (let i = 0; i <= 8; i++){ const a = a0 + i * Math.PI / 16; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
      arc(x + w - r, y + r, -Math.PI / 2); arc(x + w - r, y + h - r, 0); arc(x + r, y + h - r, Math.PI / 2); arc(x + r, y + r, Math.PI); push(pts, true); }
    else push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
  } else if (s.type === 'ellipse'){
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2, pts = []; for (let i = 0; i < 96; i++){ const a = i / 96 * Math.PI * 2; pts.push([cx + Math.cos(a) * Math.abs(s.w / 2), cy + Math.sin(a) * Math.abs(s.h / 2)]); } push(pts, true);
  } else if (s.type === 'star' || s.type === 'polygon'){
    const n = s.points || (s.type === 'star' ? 5 : 6), steps = s.type === 'star' ? n * 2 : n, rot = (s.rotation || 0) * Math.PI / 180 - Math.PI / 2, pts = [];
    for (let i = 0; i < steps; i++){ const r = (s.type === 'star' && i % 2) ? s.r2 : s.r1, a = rot + i * Math.PI * 2 / steps; pts.push([s.cx + Math.cos(a) * r, s.cy + Math.sin(a) * r]); } push(pts, true);
  } else if (s.type === 'path' || s.type === 'line'){ push((s.points || []).map(p => [p[0], p[1]]), !!s.closed); }
  else if (s.type === 'bezier'){
    const A = s.anchors || []; if (!A.length) return out; const pts = [[A[0].x, A[0].y]];
    const seg = (p, q) => { if (!p.out && !q.in){ pts.push([q.x, q.y]); return; } const c1 = p.out || [p.x, p.y], c2 = q.in || [q.x, q.y];
      for (let i = 1; i <= 24; i++){ const t = i / 24, u = 1 - t; pts.push([u * u * u * p.x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * q.x, u * u * u * p.y + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * q.y]); } };
    for (let i = 1; i < A.length; i++) seg(A[i - 1], A[i]);
    if (s.closed && A.length >= 2){ seg(A[A.length - 1], A[0]); pts.pop(); }
    push(pts, !!s.closed);
  }
  return out;
}
AiWindow.flat = flat;
/* 折线的弧长参数：at(d) → {p, t（单位切线）} */
function track(pts, closed){
  const P = closed ? pts.concat([pts[0]]) : pts, cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + V2.len(V2.sub(P[i], P[i - 1])));
  const L = cum[cum.length - 1];
  const at = d => { d = clamp(d, 0, L); let i = 1; while (i < P.length - 1 && cum[i] < d) i++; const seg = cum[i] - cum[i - 1] || 1, u = (d - cum[i - 1]) / seg;
    return {p:V2.add(P[i - 1], V2.mul(V2.sub(P[i], P[i - 1]), u)), t:V2.unit(V2.sub(P[i], P[i - 1]))}; };
  return {P, cum, L, at};
}
/* 从开头／结尾剪掉 d0／d1 弧长 */
function trimPts(pts, d0, d1){
  const T = track(pts, false); if (d0 + d1 >= T.L) return [];
  const out = [T.at(d0).p]; for (let i = 1; i < pts.length - 1; i++) if (T.cum[i] > d0 && T.cum[i] < T.L - d1) out.push(pts[i]); out.push(T.at(T.L - d1).p); return out;
}

/* ── 箭头（arrow.rs）── */
const ARROWS = ['Arrow', 'ArrowOpen', 'Barbed', 'Concave', 'DoubleArrow', 'HalfArrowLeft', 'HalfArrowRight', 'Chevron', 'Feather', 'Swallowtail', 'Triangle', 'TriangleOpen', 'TriangleReverse', 'TriangleBar',
  'Kite', 'Leaf', 'Drop', 'Circle', 'CircleOpen', 'HalfCircle', 'Oval', 'Target', 'Square', 'SquareOpen', 'Tag', 'TagOpen', 'Diamond', 'DiamondOpen', 'Hexagon', 'HexagonOpen', 'Star', 'Cross', 'Plus', 'Bar',
  'DoubleBar', 'DotOnBar', 'Slash', 'DoubleSlash', 'Bracket', 'Fork'];
const ARROW_LABEL = {Triangle:'Triangle', TriangleOpen:'Triangle (open)', Circle:'Circle', CircleOpen:'Circle (open)', Square:'Square', SquareOpen:'Square (open)', Bar:'Bar', Diamond:'Diamond', Arrow:'Arrow',
  ArrowOpen:'Arrow (open)', Barbed:'Barbed', HalfArrowLeft:'Half Arrow (left)', HalfArrowRight:'Half Arrow (right)', Concave:'Concave', DoubleBar:'Double Bar', Feather:'Feather', DotOnBar:'Dot on Bar', Chevron:'Chevron',
  DoubleArrow:'Double Arrow', Target:'Target', Star:'Star', Cross:'Cross', Plus:'Plus', Hexagon:'Hexagon', HexagonOpen:'Hexagon (open)', Tag:'Tag', TagOpen:'Tag (open)', HalfCircle:'Half Circle', Drop:'Drop',
  Slash:'Slash', DoubleSlash:'Double Slash', DiamondOpen:'Diamond (open)', TriangleReverse:'Reverse Triangle', Swallowtail:'Swallowtail', Bracket:'Bracket', Fork:'Fork', Leaf:'Leaf', Kite:'Kite', TriangleBar:'Triangle to Bar', Oval:'Oval'};
const HEX = 2 * 1.7320508075688772, NOTCH = 0.7;
const LOCAL_STOP = {Target:['W', 4], TagOpen:['W', 4], DiamondOpen:['W', 4], HexagonOpen:['W', HEX], DoubleBar:['A', 0.375], DotOnBar:['A', 0.375], Bracket:['A', 0.3], Fork:['A', 2.7], HalfArrowLeft:['A', 1.3],
  HalfArrowRight:['A', 1.3], Feather:['A', 1.3], Swallowtail:['A', 1.4], Chevron:['A', 1.0], Slash:['A', 1.2], DoubleSlash:['A', 1.05], DoubleArrow:['A', 1.7], HalfCircle:['A', 1.0], Concave:['A', 2.6], Hexagon:['A', HEX / 2]};
function arrowInset(kind, hw, cap){
  const l = 4 * hw, ring = 0.5 * hw, solid = back => Math.max(back / 2, cap), hollow = back => Math.max(back - ring / 2, back - ring + cap);
  if (['Triangle', 'Circle', 'Square', 'Diamond'].includes(kind)) return solid(l);
  if (kind === 'Arrow') return solid(NOTCH * l);
  if (kind === 'Bar') return solid(0.75 * hw);
  if (['TriangleOpen', 'CircleOpen', 'SquareOpen'].includes(kind)) return hollow(l);
  if (kind === 'ArrowOpen') return Math.max(hw * Math.sqrt(l * l + l * l / 4) / (l / 2), cap);
  const st = LOCAL_STOP[kind] || ['A', 2.0];
  return st[0] === 'W' ? hollow(st[1] * hw) : Math.max(st[1] * hw, cap);
}
function polyPath(t, pts){ t.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) t.lineTo(pts[i][0], pts[i][1]); t.closePath(); }
function ringPath(t, pts, wall){
  polyPath(t, pts); const n = pts.length; let area = 0; for (let i = 0; i < n; i++){ const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - a[1] * b[0]; }
  const inward = e => area > 0 ? [-e[1], e[0]] : [e[1], -e[0]];
  const inner = pts.map((cur, i) => { const prev = pts[(i + n - 1) % n], next = pts[(i + 1) % n], n1 = inward(V2.unit(V2.sub(cur, prev))), n2 = inward(V2.unit(V2.sub(next, cur)));
    return V2.add(cur, V2.mul(V2.add(n1, n2), wall / (1 + V2.dot(n1, n2)))); }).reverse();
  polyPath(t, inner);
}
const circ = (t, c, r, ccw) => { t.moveTo(c[0] + r, c[1]); t.arc(c[0], c[1], r, 0, Math.PI * 2, !!ccw); t.closePath(); };
function starPts(c, radii, n, a0){ return Array.from({length:n}, (_, i) => { const a = a0 + i * 2 * Math.PI / n, r = radii[i % radii.length]; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]; }); }
function plusPts(h, k, turn){ const arm = [[k, h], [k, k], [h, k]], c = Math.cos(turn), s = Math.sin(turn), out = [];
  for (let q = 0; q < 4; q++) arm.forEach(([x, y]) => { const [u, v] = [[x, y], [y, -x], [-x, -y], [-y, x]][q]; out.push([2 + u * c - v * s, u * s + v * c]); }); return out; }
/* 一个箭头的外框（arrow.rs shape()／local()）加进目前的 path */
function arrowPath(t, kind, tip, dir, hw){
  const n = [-dir[1], dir[0]], l = 4 * hw, half = l / 2, base = V2.sub(tip, V2.mul(dir, l)), centre = V2.sub(tip, V2.mul(dir, half));
  const A = (p, k) => V2.add(p, V2.mul(n, k));
  const tri = [tip, A(base, half), A(base, -half)], sq = [A(tip, half), A(base, half), A(base, -half), A(tip, -half)];
  switch (kind){
    case 'Triangle': return polyPath(t, tri);
    case 'TriangleOpen': return ringPath(t, tri, 0.5 * hw);
    case 'Arrow': return polyPath(t, [tip, A(base, half), V2.sub(tip, V2.mul(dir, NOTCH * l)), A(base, -half)]);
    case 'ArrowOpen': { const a = A(base, half), b = A(base, -half), ua = V2.unit(V2.sub(a, tip)), ub = V2.unit(V2.sub(b, tip)), na = [-ua[1], ua[0]], nb = [ub[1], -ub[0]];
      const inner = V2.sub(tip, V2.mul(dir, hw * V2.len(V2.sub(a, tip)) / half)); return polyPath(t, [tip, a, V2.add(a, V2.mul(na, hw)), inner, V2.add(b, V2.mul(nb, hw)), b]); }
    case 'Circle': return circ(t, centre, half);
    case 'CircleOpen': circ(t, centre, half); return circ(t, centre, half - 0.5 * hw, true);
    case 'Square': return polyPath(t, sq);
    case 'SquareOpen': return ringPath(t, sq, 0.5 * hw);
    case 'Diamond': return polyPath(t, [tip, A(centre, half), base, A(centre, -half)]);
    case 'Bar': { const b = 0.75 * hw; return polyPath(t, [A(tip, half), V2.sub(A(tip, half), V2.mul(dir, b)), V2.sub(A(tip, -half), V2.mul(dir, b)), A(tip, -half)]); }
  }
  // local()：x 从箭尖往回、y 横过去（指向方向的右边为正）；一单位＝hw
  t.save(); t.transform(-dir[0] * hw, -dir[1] * hw, n[0] * hw, n[1] * hw, tip[0], tip[1]);
  const P = pts => polyPath(t, pts), R = pts => ringPath(t, pts, 0.5), hexagon = starPts([HEX / 2, 0], [2], 6, Math.PI / 6);
  switch (kind){
    case 'Barbed': P([[0, 0], [3.6, 2], [2.6, 0.55], [4, 0.55], [4, -0.55], [2.6, -0.55], [3.6, -2]]); break;
    case 'HalfArrowLeft': P([[0, 0], [4, -2], [3, -0.5], [3, 0.5], [1, 0.5]]); break;
    case 'HalfArrowRight': P([[0, 0], [4, 2], [3, 0.5], [3, -0.5], [1, -0.5]]); break;
    case 'Concave': t.moveTo(0, 0); t.quadraticCurveTo(2.4, 0.4, 4, 2); t.lineTo(4, -2); t.quadraticCurveTo(2.4, -0.4, 0, 0); t.closePath(); break;
    case 'DoubleBar': P([[0, -2], [0.75, -2], [0.75, 2], [0, 2]]); P([[1.5, -2], [2.25, -2], [2.25, 2], [1.5, 2]]); break;
    case 'Feather': P([[0, 0.5], [1.4, 2], [4, 2], [2.6, 0.5], [2.6, -0.5], [4, -2], [1.4, -2], [0, -0.5]]); break;
    case 'DotOnBar': P([[0, -2], [0.75, -2], [0.75, 2], [0, 2]]); circ(t, [2.5, 0], 1.25); break;
    case 'Chevron': P([[0, 0], [2, 2], [4, 2], [2, 0], [4, -2], [2, -2]]); break;
    case 'DoubleArrow': P([[0, 0], [2.2, 1.8], [1.9, 0.5], [4, 2], [3.4, 0], [4, -2], [1.9, -0.5], [2.2, -1.8]]); break;
    case 'Target': circ(t, [2, 0], 2); circ(t, [2, 0], 1.5, true); circ(t, [2, 0], 0.75); break;
    case 'Star': P(starPts([2, 0], [2, 0.85], 10, Math.PI)); break;
    case 'Cross': P(plusPts(2.2, 0.4, Math.PI / 4)); break;
    case 'Plus': P(plusPts(1.9, 0.4, 0)); break;
    case 'Hexagon': P(hexagon); break;
    case 'HexagonOpen': R(hexagon); break;
    case 'Tag': P([[0, 0], [1.6, 2], [4, 2], [4, -2], [1.6, -2]]); break;
    case 'TagOpen': R([[0, 0], [1.6, 2], [4, 2], [4, -2], [1.6, -2]]); break;
    case 'HalfCircle': t.moveTo(2, 2); t.arc(2, 0, 2, Math.PI / 2, Math.PI * 1.5, false); t.closePath(); break;
    case 'Drop': { const c = [2.6, 0], r = 1.4, a = Math.PI - Math.acos(r / c[0]); t.moveTo(0, 0); t.lineTo(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r); t.arc(c[0], c[1], r, a, -a, true); t.closePath(); break; }
    case 'Slash': P([[0, 2], [0.8, 2], [2.4, -2], [1.6, -2]]); break;
    case 'DoubleSlash': P([[0, 2], [0.7, 2], [2.1, -2], [1.4, -2]]); P([[1.6, 2], [2.3, 2], [3.7, -2], [3, -2]]); break;
    case 'DiamondOpen': R([[0, 0], [2, 2], [4, 0], [2, -2]]); break;
    case 'TriangleReverse': P([[0, 2], [4, 0], [0, -2]]); break;
    case 'Swallowtail': P([[0, 2], [4, 2], [2.8, 0], [4, -2], [0, -2]]); break;
    case 'Bracket': P([[0, 2], [2, 2], [2, 1.4], [0.6, 1.4], [0.6, -1.4], [2, -1.4], [2, -2], [0, -2]]); break;
    case 'Fork': P([[0, 2], [3, 2], [3, -2], [0, -2], [0, -1.4], [2.4, -1.4], [2.4, 1.4], [0, 1.4]]); break;
    case 'Leaf': t.moveTo(0, 0); t.quadraticCurveTo(2, 3.2, 4, 0); t.quadraticCurveTo(2, -3.2, 0, 0); t.closePath(); break;
    case 'Kite': P([[0, 0], [1.3, 1.7], [4, 0], [1.3, -1.7]]); break;
    case 'TriangleBar': P([[0, 2], [0.6, 2], [0.6, 0.25], [4, 1.8], [4, -1.8], [0.6, -0.25], [0.6, -2], [0, -2]]); break;
    case 'Oval': t.moveTo(4, 0); t.ellipse(2, 0, 2, 1.2, 0, 0, Math.PI * 2); t.closePath(); break;
  }
  t.restore();
}
AiWindow.arrows = {list:ARROWS, label:ARROW_LABEL, path:arrowPath};

/* ── 宽度配置文件（appearance.rs:247 PRESETS；width.rs：左右偏移 width/2·factor(t) 的填色外框） ── */
const PROFILES = [['uniform', 'Uniform', [[0, 1, 1], [1, 1, 1]]], ['lens', 'Lens', [[0, 0, 0], [0.5, 1, 1], [1, 0, 0]]], ['taperStart', 'Taper Start', [[0, 0, 0], [1, 1, 1]]],
  ['taperEnd', 'Taper End', [[0, 1, 1], [1, 0, 0]]], ['pinch', 'Pinch', [[0, 1, 1], [0.5, 0.25, 0.25], [1, 1, 1]]], ['teardrop', 'Teardrop', [[0, 0, 0], [0.2, 1, 1], [1, 0, 0]]],
  ['wave', 'Wave', [[0, 0.3, 0.3], [0.25, 1, 1], [0.5, 0.3, 0.3], [0.75, 1, 1], [1, 0.3, 0.3]]]];
const profAt = (p, t) => { if (!p || !p.length) return [1, 1]; if (t <= p[0][0]) return [p[0][1], p[0][2]];
  for (let i = 1; i < p.length; i++) if (t <= p[i][0]){ const a = p[i - 1], b = p[i], u = (t - a[0]) / Math.max(1e-9, b[0] - a[0]); return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; }
  const l = p[p.length - 1]; return [l[1], l[2]]; };
const PF_KEY = 'dlAiWidthProfiles.v1';
const savedProfiles = () => { try { return JSON.parse(localStorage.getItem(PF_KEY) || '[]'); } catch(e){ return []; } };
function profileEntries(){ return PROFILES.map(([id, label, points]) => ({id, label, points, builtIn:true})).concat(savedProfiles().map(p => ({id:p.name, label:p.name, points:p.points, builtIn:false}))); }
const profileId = pts => { if (!pts) return 'uniform'; const e = profileEntries().find(x => JSON.stringify(x.points) === JSON.stringify(pts)); return e ? e.id : 'custom'; };
AiWindow.profiles = {entries:profileEntries, at:profAt, id:profileId};
/* 折线加密：每段切成 ≤ step 长（宽度沿路径变化才看得出来） */
function densify(pts, closed, step){
  const out = [], n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++){ const a = pts[i], b = pts[(i + 1) % n], k = Math.max(1, Math.ceil(V2.len(V2.sub(b, a)) / step)); for (let j = 0; j < k; j++) out.push(V2.add(a, V2.mul(V2.sub(b, a), j / k))); }
  if (!closed) out.push(pts[n - 1]); return out;
}
function profileFill(t, subs, half, pts, flip){
  t.beginPath();
  subs.forEach(sub0 => {
    const sub = {pts:densify(sub0.pts, sub0.closed, Math.max(1, half / 2)), closed:sub0.closed};
    const P = sub.pts, n = P.length, T = track(P, sub.closed), L = T.L || 1, left = [], right = [];
    for (let i = 0; i < n; i++){
      const a = sub.closed ? P[(i + n - 1) % n] : P[Math.max(0, i - 1)], b = sub.closed ? P[(i + 1) % n] : P[Math.min(n - 1, i + 1)];
      const tg = V2.unit(V2.sub(b, a)), nl = [tg[1], -tg[0]];
      let tt = T.cum[i] / L; if (flip && flip.along) tt = 1 - tt; let [fl, fr] = profAt(pts, tt); if (flip && flip.across) [fl, fr] = [fr, fl];
      left.push(V2.add(P[i], V2.mul(nl, half * fl))); right.push(V2.sub(P[i], V2.mul(nl, half * fr)));
    }
    if (sub.closed){ polyPath(t, left); polyPath(t, right.slice().reverse()); }
    else polyPath(t, left.concat(right.reverse()));
  });
  t.fillStyle = t.strokeStyle; t.fill('nonzero');
}

/* ── 画笔（brush/src/defaults.rs 默认库 14 支；calli.rs 椭圆笔尖；艺术／散布／图案画笔＝把图稿沿路径弯过去） ── */
const cubicPts = (p0, c1, c2, p1, n) => Array.from({length:n}, (_, i) => { const t = (i + 1) / n, u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]]; });
const ellPts = (cx, cy, rx, ry, n) => Array.from({length:n || 24}, (_, i) => { const a = i / (n || 24) * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
const rectPts = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const grayK = k => rgbHex((1 - k) * 255, (1 - k) * 255, (1 - k) * 255);
const ART = {
  taper:() => [{polys:[[[0, 0]].concat(cubicPts([0, 0], [30, -2.7], [70, -2.7], [100, 0], 16), cubicPts([100, 0], [70, 2.7], [30, 2.7], [0, 0], 16).slice(0, -1))], color:'#000000'}],
  charcoal:() => { const J = [0.82, 1, 0.9, 0.7, 0.95, 0.85, 1, 0.75, 0.92, 0.8, 0.98, 0.72, 0.88, 1, 0.78, 0.93, 0.86, 0.7, 0.97, 0.83, 0.9, 0.76, 1, 0.85], n = 24, pts = [];
    for (let i = 0; i <= n; i++){ const x = 100 * i / n, e = Math.pow(Math.sin(Math.PI * x / 100), 0.6); pts.push([x, -3 * e * J[i % J.length]]); }
    for (let i = n - 1; i >= 1; i--){ const x = 100 * i / n, e = Math.pow(Math.sin(Math.PI * x / 100), 0.6); pts.push([x, 3 * e * J[(i * 7 + 3) % J.length]]); }
    const st = (y, x0, x1) => ({polys:[ellPts((x0 + x1) / 2, y, (x1 - x0) / 2, 0.35, 16)], color:'#ffffff'});
    return [{polys:[pts], color:grayK(0.85)}, st(-1.2, 20, 45), st(0.9, 55, 85), st(0.1, 8, 22)]; },
  arrow:() => [{polys:[rectPts(0, -1, 84, 1)], color:'#000000'}, {polys:[[[80, -4], [100, 0], [80, 4]]], color:'#000000'}],
  dot:() => [{polys:[ellPts(0, 0, 2, 2, 20)], color:'#000000'}],
  confetti:() => [{polys:[rectPts(-1.5, -1.5, 1.5, 1.5)], color:'#000000'}, {polys:[rectPts(0.5, 0.5, 2.5, 2.5)], color:grayK(0.45)}],
  leaf:() => [{polys:[[[0, 0]].concat(cubicPts([0, 0], [2, -3], [4, -3], [6, -3], 6), cubicPts([6, -3], [8, -3], [10, -3], [12, 0], 6), cubicPts([12, 0], [10, 3], [8, 3], [6, 3], 6), cubicPts([6, 3], [4, 3], [2, 3], [0, 0], 6).slice(0, -1))], color:'#3f8f4a'},
    {polys:[rectPts(1, -0.2, 11, 0.2)], color:'#c9e8b5'}],
  chain:() => [{polys:[ellPts(7, 0, 6, 3, 28), ellPts(7, 0, 4, 1.4, 28).reverse()], color:'#000000'}, {polys:[rectPts(0, -0.6, 1.5, 0.6)], color:'#000000'}, {polys:[rectPts(12.5, -0.6, 14, 0.6)], color:'#000000'}],
  stitch:() => [{polys:[rectPts(1.5, -0.75, 8.5, 0.75)], color:'#000000', box:[0, 10]}],
  diamond:() => [{polys:[[[0, 0], [4, -3], [8, 0], [4, 3]]], color:'#000000'}]
};
const BRUSHES_DEFAULT = [
  {name:'3 pt. Round', type:'calligraphic', angle:0, roundness:100, size:3}, {name:'6 pt. Flat', type:'calligraphic', angle:45, roundness:15, size:6}, {name:'10 pt. Oval', type:'calligraphic', angle:30, roundness:45, size:10},
  {name:'Charcoal', type:'art', art:'charcoal', colorization:'tints'}, {name:'Tapered Stroke', type:'art', art:'taper'}, {name:'Arrow', type:'art', art:'arrow', guides:[0, 0.78], colorization:'tints'},
  {name:'Dots', type:'scatter', art:'dot', spacing:[160, 160], colorization:'tints'},
  {name:'Confetti', type:'scatter', art:'confetti', size:[60, 140], spacing:[120, 220], scatter:[-150, 150], rotation:[-180, 180], colorization:'tints'},
  {name:'Leaves', type:'scatter', art:'leaf', size:[80, 120], spacing:[90, 130], scatter:[-60, 60], rotation:[-35, 35], relative:true, colorization:'none'},
  {name:'Chain', type:'pattern', art:'chain', fit:'stretch'}, {name:'Stitches', type:'pattern', art:'stitch', fit:'stretch'}, {name:'Diamonds', type:'pattern', art:'diamond', spacing:25, fit:'addSpace'},
  {name:'Bristle Round', type:'bristle', shape:'round', size:3, density:50, thickness:50, opacity:75}, {name:'Bristle Flat Fan', type:'bristle', shape:'flatFan', size:9, density:80, thickness:25, opacity:55}];
const BR = AiWindow.brushes = {list:null, current:null, view:'list', hidden:[]};
const brushList = () => { if (!BR.list) BR.list = clone(BRUSHES_DEFAULT); return BR.list; };
const brushArt = b => typeof b.art === 'string' ? (ART[b.art] ? ART[b.art]() : []) : (b.art || []);
const lum = c => { const [r, g, b] = hexRgb(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
const tint = (artColor, strokeColor, mode) => { if (mode !== 'tints' || typeof strokeColor !== 'string' || strokeColor === 'none') return artColor;
  const k = 1 - lum(artColor), s = hexRgb(strokeColor); return rgbHex(...s.map(v => 255 + (v - 255) * k)); };
function artBox(art){ let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; art.forEach(it => { if (it.box){ x0 = Math.min(x0, it.box[0]); x1 = Math.max(x1, it.box[1]); } it.polys.forEach(P => P.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); })); }); return {x0, x1, y0, y1}; }
const dens = (P, step) => { const out = []; P.forEach((p, i) => { const q = P[(i + 1) % P.length], d = V2.len(V2.sub(q, p)), n = Math.max(1, Math.ceil(d / step)); for (let k = 0; k < n; k++) out.push(V2.add(p, V2.mul(V2.sub(q, p), k / n))); }); return out; };
let _seed = 1; const rnd = () => { _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; };
const hashStr = s => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 2147483647; return h || 1; };
/* 画笔描边 → 片段 [{polys:[[x,y]…], color, rule}]（画布单位）；k＝描边粗细×S（画笔图稿以 1pt 为准，粗细放大） */
function brushPieces(b, s, S){
  const subs = flat(s, S), k = Math.max(0.05, (s.strokeWidth || 1)) * S, col = typeof s.stroke === 'string' ? s.stroke : '#000000', out = [];
  _seed = hashStr(s.id || 'x');
  subs.forEach(sub => {
    const T = track(sub.pts, sub.closed); if (T.L < 1e-6) return;
    const right = d => { const a = T.at(d); return {p:a.p, n:[-a.t[1], a.t[0]], t:a.t}; };
    if (b.type === 'calligraphic' || b.type === 'bristle'){
      const ang = (b.angle || 0) * Math.PI / 180, u = [Math.cos(ang), -Math.sin(ang)], v = [-u[1], u[0]], a = Math.max(1e-4, (b.size || 3) * k / 2 / S * S), bb = Math.max(1e-4, a * clamp((b.roundness === undefined ? 100 : b.roundness) / 100, 0.01, 1));
      const sup = d => { const du = V2.dot(u, d), dv = V2.dot(v, d), den = Math.max(1e-12, Math.hypot(a * du, bb * dv)); return V2.add(V2.mul(u, a * a * du / den), V2.mul(v, bb * bb * dv / den)); };
      const N = Math.max(8, Math.ceil(T.L / 2)), L = [], R = [];
      for (let i = 0; i <= N; i++){ const q = right(T.L * i / N), nl = [q.t[1], -q.t[0]], o = sup(nl); L.push(V2.add(q.p, o)); R.push(V2.sub(q.p, o)); }
      if (b.type === 'bristle'){
        const strands = Math.round(4 + (b.density || 50) / 10), op = clamp((b.opacity || 75) / 100, 0.05, 1);
        for (let j = 0; j < strands; j++){ const f = strands === 1 ? 0 : j / (strands - 1) * 2 - 1, w = Math.max(0.3, a * 2 * (b.thickness || 50) / 100 / strands * 1.6);
          const line = []; for (let i = 0; i <= N; i++){ const q = right(T.L * i / N), nl = [q.t[1], -q.t[0]]; line.push(V2.add(q.p, V2.mul(nl, f * a * (b.shape === 'flatFan' ? 1 : Math.sqrt(1 - f * f) + 0.2)))); }
          out.push({line, width:w, color:col, alpha:op * (0.6 + 0.4 * rnd())}); }
        return;
      }
      out.push({polys:[L.concat(R.reverse())], color:col});
      out.push({polys:[nibPts(sub.pts[0], u, v, a, bb)], color:col});
      if (!sub.closed) out.push({polys:[nibPts(sub.pts[sub.pts.length - 1], u, v, a, bb)], color:col});
      return;
    }
    const art = brushArt(b), box = artBox(art), aw = Math.max(1e-6, box.x1 - box.x0);
    const map = (x, y, x0, len, sc) => { const q = right(clamp(x0 + (x - box.x0) * len / aw, 0, T.L)); return V2.add(q.p, V2.mul(q.n, y * sc)); };
    if (b.type === 'art'){
      const g = b.guides || [0, 1], g0 = box.x0 + g[0] * aw, g1 = box.x0 + g[1] * aw, fixedA = (g0 - box.x0) * k, fixedB = (box.x1 - g1) * k, mid = Math.max(0, T.L - fixedA - fixedB);
      const along = x => x < g0 ? (x - box.x0) * k : x > g1 ? T.L - (box.x1 - x) * k : fixedA + (g1 > g0 ? (x - g0) / (g1 - g0) * mid : 0);
      art.forEach(it => out.push({polys:it.polys.map(P => dens(P, Math.max(0.5, aw / 60)).map(([x, y]) => { const q = right(clamp(along(x), 0, T.L)); return V2.add(q.p, V2.mul(q.n, y * k)); })), color:tint(it.color, col, b.colorization)}));
      return;
    }
    if (b.type === 'pattern'){
      const tw = aw * k, gap = (b.spacing || 0) / 100 * tw, per = tw + gap; let n = Math.max(1, Math.round(T.L / per)), sc = T.L / (n * per);
      if (b.fit === 'addSpace'){ n = Math.max(1, Math.floor((T.L + gap) / per)); sc = 1; }
      const extra = b.fit === 'addSpace' && n > 1 ? (T.L - n * tw) / n - gap : 0;
      for (let i = 0; i < n; i++){ const x0 = i * (per + extra) * sc;
        art.forEach(it => out.push({polys:it.polys.map(P => dens(P, Math.max(0.5, aw / 20)).map(([x, y]) => map(x, y, x0, tw * sc, k))), color:tint(it.color, col, b.colorization)})); }
      return;
    }
    if (b.type === 'scatter'){
      const rng = (r, d) => r ? r[0] + (r[1] - r[0]) * rnd() : d;
      let d = 0;
      while (d <= T.L + 1e-6){
        const size = rng(b.size, 100) / 100, q = right(d), off = rng(b.scatter, 0) / 100 * aw * k * size, rot = rng(b.rotation, 0) * Math.PI / 180 + (b.relative ? Math.atan2(q.t[1], q.t[0]) : 0);
        const c = V2.add(q.p, V2.mul(q.n, off)), cs = Math.cos(rot), sn = Math.sin(rot), sc = k * size;
        art.forEach(it => out.push({polys:it.polys.map(P => P.map(([x, y]) => [c[0] + (x * cs - y * sn) * sc, c[1] + (x * sn + y * cs) * sc])), color:tint(it.color, col, b.colorization)}));
        d += Math.max(0.5, rng(b.spacing, 100) / 100 * aw * k * size);
      }
    }
  });
  return out;
}
function nibPts(c, u, v, a, b){ return Array.from({length:20}, (_, i) => { const t = i / 20 * Math.PI * 2; return V2.add(c, V2.add(V2.mul(u, Math.cos(t) * a), V2.mul(v, Math.sin(t) * b))); }); }
function paintPieces(t, pieces){
  pieces.forEach(pc => {
    t.save();
    if (pc.line){ t.globalAlpha *= pc.alpha || 1; t.strokeStyle = pc.color; t.lineWidth = pc.width; t.lineCap = 'round'; t.lineJoin = 'round'; t.setLineDash([]); t.beginPath(); t.moveTo(...pc.line[0]); pc.line.slice(1).forEach(p => t.lineTo(p[0], p[1])); t.stroke(); }
    else { t.beginPath(); pc.polys.forEach(P => { if (P.length >= 2) polyPath(t, P); }); t.fillStyle = pc.color; t.fill(pc.rule || 'nonzero'); }
    t.restore();
  });
}

/* ── 描边：箭头（arrow.rs pieces：头放在第一个开放子路径的起点、最后一个的终点；tip＝箭尖在端点、线缩短 inset；extend＝路径不变、箭尖往外 inset） ── */
function strokeArrows(t, s, S, subs){
  const w = (s.strokeWidth || 0) * S, cap = s.cap === 'butt' ? 0 : w / 2, sc = s.arrowScale || [100, 100];
  const hw = end => Math.max(0.25 * S, (s.strokeWidth || 0) * (end ? sc[1] : sc[0]) / 100 * S), tipMode = s.arrowAlign === 'tip';
  const firstI = subs.length && !subs[0].closed ? 0 : -1, lastI = subs.length && !subs[subs.length - 1].closed ? subs.length - 1 : -1, heads = [];
  const lines = subs.map(x => x.pts.slice());
  const place = (kind, i, atStart) => {
    const P = subs[i].pts, h = hw(!atStart), ins = arrowInset(kind, h, cap), endPt = atStart ? P[0] : P[P.length - 1];
    let k = atStart ? 1 : P.length - 2; while (k > 0 && k < P.length - 1 && V2.len(V2.sub(P[k], endPt)) < 1e-9) k += atStart ? 1 : -1;
    const outward = V2.unit(V2.sub(endPt, P[clamp(k, 0, P.length - 1)]));
    let tip, dir;
    if (tipMode){ const T = track(P, false), cut = T.at(atStart ? ins : T.L - ins).p; const v = V2.sub(endPt, cut); dir = V2.len(v) > 1e-9 ? V2.unit(v) : outward; tip = endPt; }
    else { tip = V2.add(endPt, V2.mul(outward, ins)); dir = outward; }
    heads.push({kind, tip, dir, h, ins, i, atStart});
  };
  if (s.startArrow && firstI >= 0) place(s.startArrow, firstI, true);
  if (s.endArrow && lastI >= 0) place(s.endArrow, lastI, false);
  if (tipMode) heads.forEach(hd => { const P = lines[hd.i]; lines[hd.i] = hd.atStart ? trimPts(P, hd.ins, 0) : trimPts(P, 0, hd.ins); });
  t.beginPath(); lines.forEach((P, i) => { if (P.length < 2) return; t.moveTo(P[0][0], P[0][1]); P.slice(1).forEach(p => t.lineTo(p[0], p[1])); if (subs[i].closed) t.closePath(); }); t.stroke();
  t.save(); t.setLineDash([]); t.beginPath(); heads.forEach(hd => arrowPath(t, hd.kind, hd.tip, hd.dir, hd.h)); t.fillStyle = t.strokeStyle; t.fill('nonzero'); t.restore();
}
const hasArrows = s => !!(s.startArrow || s.endArrow);
const strokeStyled = s => !!(s && (s.cap || s.join || s.miterLimit || (Array.isArray(s.dash) && s.dash.length) || s.fillRule === 'evenOdd' || s.strokeAlign === 'inside' || s.strokeAlign === 'outside' || hasArrows(s) || s.profile || s.brush));
/* 代理 ctx 的 stroke()：画笔 ＞ 宽度配置文件 ＞ 箭头 ＞ 内侧／外侧 ＞ 一般 */
function customStroke(t, s, S){
  const b = s.brush && brushList().find(x => x.name === s.brush);
  if (b){ paintPieces(t, brushPieces(b, s, S)); return; }
  const subs = (s.profile || hasArrows(s)) ? flat(s, S) : null;
  if (s.profile && subs.length){
    profileFill(t, subs, (s.strokeWidth || 0) * S / 2, s.profile, s.profileFlip);
    return;
  }
  if (hasArrows(s) && subs.some(x => !x.closed)) return strokeArrows(t, s, S, subs);
  const closedish = s.type !== 'line' && !((s.type === 'path' || s.type === 'bezier') && !s.closed);
  if ((s.strokeAlign === 'inside' || s.strokeAlign === 'outside') && closedish){
    t.save();
    if (s.strokeAlign === 'inside') t.clip(s.fillRule === 'evenOdd' || s.rule === 'evenodd' ? 'evenodd' : 'nonzero');
    else { t.rect(-1e7, -1e7, 2e7, 2e7); t.clip('evenodd'); }
    t.lineWidth = t.lineWidth * 2; t.stroke(); t.restore(); return;
  }
  t.stroke();
}

/* ── 外观堆叠（appearance.rs：多层填色／描边；s.apStack＝由下到上 [{kind:'fill'|'stroke', paint?, width?, visible?, opacity?, primary?}]；primary＝原本的 s.fill／s.stroke） ── */
function drawStack(W, ctx, s, S){
  const base = Object.assign({}, s); delete base.apStack;
  s.apStack.forEach(it => {
    if (!it || it.visible === false) return;
    const c = Object.assign({}, base);
    if (it.kind === 'fill'){ c.stroke = 'none'; c.strokeWidth = 0; if (!it.primary) c.fill = it.paint; ['startArrow', 'endArrow', 'profile', 'brush'].forEach(k => delete c[k]); }
    else { c.fill = 'none'; if (!it.primary){ c.stroke = it.paint; c.strokeWidth = it.width === undefined ? (s.strokeWidth || 1) : it.width; ['startArrow', 'endArrow', 'profile', 'brush', 'dash'].forEach(k => delete c[k]); } }
    if (it.opacity !== undefined && it.opacity < 1){ ctx.save(); ctx.globalAlpha *= clamp(it.opacity, 0, 1); try { W(ctx, c, S); } finally { ctx.restore(); } }
    else W(ctx, c, S);
  });
}

/* ── 不透明蒙版（transparency.rs；s.opMask＝{art:[形状…（同一层的图层坐标）], clip, invert, linked, disabled}）：蒙版图稿的明度＝物件的不透明度 ── */
function drawMasked(W, ctx, s, S){
  const cv = ctx.canvas, m = s.opMask, w = cv.width, h = cv.height, tf = ctx.getTransform();
  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.setTransform(tf); return [c, x]; };
  const body = Object.assign({}, s); ['opMask', 'opacity', 'blend'].forEach(k => delete body[k]);
  const [oc, ox] = mk(); W(ox, body, S);
  const [mc, mx] = mk(); mx.save(); mx.setTransform(1, 0, 0, 1, 0, 0); mx.fillStyle = m.clip !== false ? '#000' : '#fff'; mx.fillRect(0, 0, w, h); mx.restore();
  (m.art || []).forEach(a => W(mx, a, S));
  const od = ox.getImageData(0, 0, w, h), md = mx.getImageData(0, 0, w, h).data, o = od.data, inv = !!m.invert;
  for (let i = 0; i < o.length; i += 4){ if (!o[i + 3]) continue; let l = (0.299 * md[i] + 0.587 * md[i + 1] + 0.114 * md[i + 2]) / 255; if (inv) l = 1 - l; o[i + 3] = Math.round(o[i + 3] * l); }
  ox.putImageData(od, 0, 0);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (s.opacity !== undefined && s.opacity < 1) ctx.globalAlpha *= clamp(+s.opacity, 0, 1);
  if (s.blend && BLEND[s.blend]) ctx.globalCompositeOperation = BLEND[s.blend];
  ctx.drawImage(oc, 0, 0); ctx.restore();
}
AiWindow.viewMask = null;     // Alt 点蒙版缩图＝只看蒙版（transparency.viewOpacityMask）：{layerId, id}

const fxOn = s => Array.isArray(s.effects) && s.effects.some(e => e && e.visible !== false);
function hookDraw(){
  if (window.__aiWinDraw || typeof window.drawShape !== 'function') return;
  window.__aiWinDraw = true;
  const orig = window.drawShape;
  const W = function(ctx, s, scale){
    if (!s || s.visible === false || s.type === 'mesh') return orig.call(this, ctx, s, scale);
    const vm = AiWindow.viewMask;
    if (vm && vm.id === s.id && s.opMask){ ctx.save(); ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = s.opMask.clip !== false ? '#000' : '#fff'; ctx.restore(); (s.opMask.art || []).forEach(a => W(ctx, a, scale)); ctx.restore(); return; }
    if (s.opMask && !s.opMask.disabled && Array.isArray(s.opMask.art) && ctx.canvas && ctx.getTransform) return drawMasked(W, ctx, s, scale);
    const op = s.opacity !== undefined && s.opacity < 1, bl = s.blend && s.blend !== 'normal' && BLEND[s.blend];
    if (op || bl){
      ctx.save(); if (op) ctx.globalAlpha *= clamp(+s.opacity, 0, 1); if (bl) ctx.globalCompositeOperation = BLEND[s.blend];
      const c = Object.assign({}, s); delete c.opacity; delete c.blend;
      try { return W(ctx, c, scale); } finally { ctx.restore(); }
    }
    if (fxOn(s)) return orig.call(this, ctx, s, scale);              // 效果：ai-effect 算好的图稿会再回来走这里（外观／描边在那时套）
    if (Array.isArray(s.apStack) && s.apStack.length && s.type !== 'group') return drawStack(W, ctx, s, scale);
    if (!strokeStyled(s)) return orig.call(this, ctx, s, scale);
    ctx.save();
    if (Array.isArray(s.dash) && s.dash.length) ctx.setLineDash(s.dash.map(v => Math.max(0, +v || 0) * scale));
    if (s.miterLimit) ctx.miterLimit = +s.miterLimit;
    const prox = new Proxy(ctx, {
      get(t, k){
        if (k === 'fill' && s.fillRule === 'evenOdd') return (...a) => a.length ? t.fill(...a) : t.fill('evenodd');
        if (k === 'stroke') return (...a) => a.length ? t.stroke(...a) : customStroke(t, s, scale);
        if (k === 'setLineDash' && Array.isArray(s.dash) && s.dash.length) return () => {};
        const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; },
      set(t, k, v){ if (k === 'lineCap' && s.cap) v = CAP[s.cap] || v; if (k === 'lineJoin' && s.join) v = JOIN[s.join] || v; if (k === 'miterLimit' && s.miterLimit) v = +s.miterLimit; t[k] = v; return true; }
    });
    try { return orig.call(this, prox, s, scale); } finally { ctx.restore(); }
  };
  window.drawShape = W;
  // 跟 ai-object／ai-effect 的包装同一规矩：toString 给原文（别的档／测试拿 drawShape 原始码判断共用层接了没）
  window.drawShape.toString = () => String(orig);
  // 链接的蒙版跟着物件搬（shiftShape：移动工具、方向键、对齐…）
  if (typeof window.shiftShape === 'function' && !window.shiftShape.__aiMask){
    const sh0 = window.shiftShape;
    const sh = function(s, dx, dy){ const r = sh0.apply(this, arguments); if (s && s.opMask && s.opMask.linked !== false && Array.isArray(s.opMask.art)) s.opMask.art.forEach(a => sh0(a, dx, dy)); return r; };
    sh.__aiMask = true; sh.toString = () => String(sh0); window.shiftShape = sh;
  }
}
hookDraw(); window.addEventListener('DOMContentLoaded', hookDraw);

/* ═══════════ 外观命令（填色、描边、透明度、属性） ═══════════ */
const reg = (id, params, fn, undoable) => CMD.reg(id, {i18n:'', params, undoable:undoable !== false}, fn);
reg('ai.paint.set', '{fill?:"#rrggbb"|"none", stroke?:"#rrggbb"|"none", strokeWidth?, ids?, layerId?} 色板／颜色面板：把选中物件（编组里每个成员）改成这个填色／描边 → {ok, ids}', p => {
  const t = sel(p); if (!t.R.length) return err('ai.paint.set', 'nothing selected');
  t.R.flatMap(leaves).forEach(s => { if (p.fill !== undefined) s.fill = p.fill; if (p.stroke !== undefined){ s.stroke = p.stroke; if (p.stroke !== 'none' && !(s.strokeWidth > 0)) s.strokeWidth = 1; } if (p.strokeWidth !== undefined) s.strokeWidth = Math.max(0, +p.strokeWidth); });
  return done(t.L);
});
/* AI 2020 Shift+X「互换填色和描边」（工具栏色块旁的弯箭头）：选中物件（编组里每个成员）填色↔描边——描边是「无」⇒ 填色变无；填色是「无」⇒ 描边变无；
   描边宽没设过＝1 pt（AI 描边面板缺省）。例：复制一份（无填色、黑描边）按 Shift+X ⇒ 黑色实心、无描边 */
reg('ai.paint.swap', '{ids?, layerId?} 互换填色和描边（AI Shift+X）：选中物件每个成员的填色↔描边（纯色／无；渐变等物件色不动）→ {ok, ids, skipped}', p => {
  const t = sel(p); if (!t.R.length) return err('ai.paint.swap', 'nothing selected');
  let skipped = 0;
  t.R.flatMap(leaves).forEach(s => {
    const f = s.fill === undefined ? 'none' : s.fill, st = (s.stroke && s.stroke !== 'none' && s.strokeWidth > 0) ? s.stroke : 'none';
    if (typeof f !== 'string' || typeof st !== 'string'){ skipped++; return; }
    s.fill = st; s.stroke = f;
    if (f !== 'none' && !(s.strokeWidth > 0)) s.strokeWidth = 1;
  });
  const r = done(t.L); if (r && typeof r === 'object') r.skipped = skipped;
  return r;
});
const ARROW_ALIAS = k => k === null || k === 'none' || k === 'None' ? null : ARROWS.find(a => a.toLowerCase() === String(k).toLowerCase().replace(/[^a-z]/g, '')) || ARROWS.find(a => ARROW_LABEL[a].toLowerCase() === String(k).toLowerCase());
const isOpenShape = s => s.type === 'line' || ((s.type === 'path' || s.type === 'bezier') && !s.closed);
reg('ai.stroke.set', '{weight?, cap?:"butt|round|projecting", join?:"miter|round|bevel", miterLimit?:1..500, dash?:[dash,gap,…]|null, alignDashes?:bool|"exact|fit", align?:"center|inside|outside"（内侧／外侧只给闭合路径）, ' +
  'startArrow?/endArrow?: 箭头名（' + ARROWS.join('|') + '）| null, arrowScale?:[起点%, 终点%], arrowAlign?:"extend|tip", swapArrows?:true, profile?: 宽度配置文件 id（uniform|lens|taperStart|taperEnd|pinch|teardrop|wave|存下的名字）| [[t,左,右]…], flipProfile?:"along|across", ids?} ' +
  '描边面板（stroke.rs；箭头 arrow.rs、宽度配置文件 width.rs 在本档的 drawShape 包装里画）→ {ok, ids}', p => {
  const t = sel(p); if (!t.R.length) return err('ai.stroke.set', 'nothing selected');
  if (p.cap !== undefined && !CAP[p.cap]) return err('ai.stroke.set', 'cap must be butt|round|projecting');
  if (p.join !== undefined && !JOIN[p.join]) return err('ai.stroke.set', 'join must be miter|round|bevel');
  if (p.align !== undefined && !['center', 'inside', 'outside'].includes(p.align)) return err('ai.stroke.set', 'align must be center|inside|outside');
  for (const k of ['startArrow', 'endArrow']) if (p[k] !== undefined && p[k] !== null && p[k] !== 'none' && !ARROW_ALIAS(p[k])) return err('ai.stroke.set', `unknown arrowhead \`${p[k]}\` (one of ${ARROWS.join(', ')})`);
  let prof;
  if (p.profile !== undefined){
    if (p.profile === null || p.profile === 'uniform') prof = null;
    else if (Array.isArray(p.profile)) prof = p.profile.map(q => [clamp(+q[0], 0, 1), Math.max(0, +q[1]), Math.max(0, +(q[2] === undefined ? q[1] : q[2]))]).sort((a, b) => a[0] - b[0]);
    else { const e = profileEntries().find(x => x.id === p.profile || x.label === p.profile); if (!e) return err('ai.stroke.set', `unknown width profile \`${p.profile}\``); prof = clone(e.points); }
  }
  t.R.flatMap(leaves).forEach(s => {
    if (p.weight !== undefined){ s.strokeWidth = Math.max(0, +p.weight || 0); if (s.strokeWidth > 0 && (!s.stroke || s.stroke === 'none')) s.stroke = '#000000'; }
    if (p.cap !== undefined) s.cap = p.cap; if (p.join !== undefined) s.join = p.join;
    if (p.miterLimit !== undefined) s.miterLimit = clamp(+p.miterLimit || 10, 1, 500);
    if (p.dash !== undefined){ if (!p.dash || !p.dash.length) delete s.dash; else { const d = p.dash.map(Number).filter(v => isFinite(v) && v >= 0); s.dash = d.length % 2 ? d.concat(d) : d; if (s.dash.every(v => !v)) delete s.dash; } }   // 只给虚线没给间隙＝间隙跟虚线一样长
    if (p.alignDashes !== undefined) s.alignDashes = p.alignDashes === true || p.alignDashes === 'fit';
    if (p.align !== undefined){ if (p.align === 'center' || !isOpenShape(s)) s.strokeAlign = p.align; if (s.strokeAlign === 'center') delete s.strokeAlign; }   // 开放路径只能居中（stroke.rs:166）
    if (p.startArrow !== undefined){ const a = ARROW_ALIAS(p.startArrow); if (a) s.startArrow = a; else delete s.startArrow; }
    if (p.endArrow !== undefined){ const a = ARROW_ALIAS(p.endArrow); if (a) s.endArrow = a; else delete s.endArrow; }
    if (p.swapArrows){ const a = s.startArrow, b = s.endArrow; if (b) s.startArrow = b; else delete s.startArrow; if (a) s.endArrow = a; else delete s.endArrow; if (s.arrowScale) s.arrowScale = [s.arrowScale[1], s.arrowScale[0]]; }
    if (Array.isArray(p.arrowScale)) s.arrowScale = [clamp(+p.arrowScale[0] || 100, 1, 1000), clamp(+(p.arrowScale[1] === undefined ? p.arrowScale[0] : p.arrowScale[1]) || 100, 1, 1000)];
    if (p.arrowAlign !== undefined){ if (p.arrowAlign === 'tip') s.arrowAlign = 'tip'; else delete s.arrowAlign; }
    if ((p.startArrow !== undefined || p.endArrow !== undefined || p.weight !== undefined) && (s.startArrow || s.endArrow) && (!s.stroke || s.stroke === 'none')){ s.stroke = '#000000'; if (!(s.strokeWidth > 0)) s.strokeWidth = 1; }
    if (p.profile !== undefined){ if (prof) s.profile = clone(prof); else { delete s.profile; delete s.profileFlip; } }
    if (p.flipProfile === 'along' || p.flipProfile === 'across'){ if (s.profile){ s.profileFlip = Object.assign({}, s.profileFlip); s.profileFlip[p.flipProfile] = !s.profileFlip[p.flipProfile]; } }
  });
  return done(t.L);
});
reg('ai.stroke.widthProfile.add', '{name?, points?:[[t,左,右]…]（缺省＝选中描边的配置文件）} 描边面板菜单 ▸ 添加到配置文件…（stroke.rs:422）：存成自订宽度配置文件（存在这台机器）→ {ok, name}', p => {
  const s = selInfo().first, pts = Array.isArray(p.points) ? p.points : s && s.profile; if (!pts) return err('ai.stroke.widthProfile.add', 'the selected stroke has no width profile');
  const L = savedProfiles(); let name = String(p.name || '').trim(); if (!name){ let i = 1; while (L.some(x => x.name === 'Width Profile ' + i)) i++; name = 'Width Profile ' + i; }
  if (PROFILES.some(x => x[1] === name) || L.some(x => x.name === name)) return err('ai.stroke.widthProfile.add', `\`${name}\` is taken`);
  L.push({name, points:clone(pts)}); try { localStorage.setItem(PF_KEY, JSON.stringify(L)); } catch(e){} return {ok:true, name};
}, false);
reg('ai.stroke.widthProfile.delete', '{name?（缺省＝选中描边用的那个存下的配置文件）} 描边面板菜单 ▸ 删除配置文件 → {ok}', p => {
  const L = savedProfiles(), s = selInfo().first, name = p.name || (s && s.profile ? profileId(s.profile) : null), i = L.findIndex(x => x.name === name);
  if (i < 0) return err('ai.stroke.widthProfile.delete', 'no saved profile to delete (built-in profiles stay)'); L.splice(i, 1); try { localStorage.setItem(PF_KEY, JSON.stringify(L)); } catch(e){} return {ok:true};
}, false);
reg('ai.stroke.widthProfile.reset', '{} 描边面板菜单 ▸ 重置配置文件：删掉所有存下的宽度配置文件 → {ok, removed}', () => { const n = savedProfiles().length; try { localStorage.removeItem(PF_KEY); } catch(e){} return {ok:true, removed:n}; }, false);
reg('ai.transparency.set', '{blend?:"normal|darken|multiply|colorBurn|lighten|screen|colorDodge|overlay|softLight|hardLight|difference|exclusion|hue|saturation|color|luminosity", opacity?:0..100, ids?} 透明度面板（transparency.rs）→ {ok, ids}', p => {
  const t = sel(p); if (!t.R.length) return err('ai.transparency.set', 'nothing selected');
  if (p.blend !== undefined && !BLEND[p.blend]) return err('ai.transparency.set', 'unknown blend mode');
  if (p.knockout !== undefined && !['on', 'off', 'neutral'].includes(p.knockout)) return err('ai.transparency.set', 'knockout must be on|off|neutral');
  t.R.forEach(s => { if (p.blend !== undefined) s.blend = p.blend; if (p.opacity !== undefined) s.opacity = clamp(+p.opacity, 0, 100) / 100;
    if (p.isolate !== undefined){ if (p.isolate) s.isolate = true; else delete s.isolate; }
    if (p.knockout !== undefined){ if (p.knockout === 'neutral') delete s.knockout; else s.knockout = p.knockout; }
    if (p.knockoutShape !== undefined){ if (p.knockoutShape) s.knockoutShape = true; else delete s.knockoutShape; } });
  return done(t.L);
});
/* ── 不透明蒙版（transparency.rs 面板＋菜单；engine/src/cmd 的 transparency.*OpacityMask） ── */
const TP = AiWindow.transparencyPrefs = {newClip:true, newInvert:false, pageIsolate:false, pageKnockout:false};
const maskTarget = p => { const t = sel(p); return {t, s:t.R.find(s => s.opMask) || t.R[0] || null}; };
reg('ai.transparency.makeOpacityMask', '{ids?} 制作蒙版（transparency.rs:145）：选中 2 个以上＝最上面那个当蒙版图稿、下面的是被蒙的物件；只选 1 个＝空蒙版（全黑＝裁掉、可再编辑）→ {ok, id}', p => {
  const t = sel(p); if (!t.R.length) return err('ai.transparency.makeOpacityMask', 'select the art (and, on top of it, the mask object)');
  const S = t.L.data.shapes, order = t.R.slice().sort((a, b) => S.indexOf(a) - S.indexOf(b));
  let target, art = [];
  if (order.length >= 2){ const top = order[order.length - 1]; art = [top]; S.splice(S.indexOf(top), 1); const rest = order.slice(0, -1);
    if (rest.length === 1) target = rest[0];
    else { VecSel.setShapes(t.L.id, rest.map(s => s.id)); const g = CMD.map['ai.object.group'] ? CMD.map['ai.object.group'].run({}) : null; target = t.L.data.shapes.find(s => s.id === (g && g.id)) || rest[0]; } }
  else target = order[0];
  if (target.opMask) return err('ai.transparency.makeOpacityMask', 'the object already has an opacity mask');
  target.opMask = {art:clone(art), clip:TP.newClip, invert:TP.newInvert, linked:true, disabled:false};
  VecSel.setShapes(t.L.id, [target.id]); Layer.invalidate(t.L); return {ok:true, id:target.id};
});
reg('ai.transparency.releaseOpacityMask', '{ids?} 释放蒙版：蒙版图稿放回物件上面、物件不再被蒙 → {ok, ids}', p => {
  const t = sel(p), R = t.R.filter(s => s.opMask); if (!R.length) return err('ai.transparency.releaseOpacityMask', 'no opacity mask on the selection');
  const S = t.L.data.shapes, out = [];
  R.forEach(s => { const art = clone(s.opMask.art || []); delete s.opMask; art.forEach(a => { a.id = 'S' + Math.random().toString(36).slice(2, 9); out.push(a.id); }); S.splice(S.indexOf(s) + 1, 0, ...art); out.unshift(s.id); });
  if (AiWindow.viewMask && R.some(s => s.id === AiWindow.viewMask.id)) AiWindow.viewMask = null;
  VecSel.setShapes(t.L.id, out); Layer.invalidate(t.L); return {ok:true, ids:out};
});
reg('ai.transparency.setOpacityMask', '{clip?:bool, invert?:bool, linked?:bool, disabled?:bool, ids?} 蒙版选项：剪切、反相蒙版、链接、停用 → {ok}', p => {
  const t = sel(p), R = t.R.filter(s => s.opMask); if (!R.length) return err('ai.transparency.setOpacityMask', 'no opacity mask on the selection');
  R.forEach(s => ['clip', 'invert', 'linked', 'disabled'].forEach(k => { if (typeof p[k] === 'boolean') s.opMask[k] = p[k]; })); return done(t.L);
});
[['enableOpacityMask', {disabled:false}, '启用不透明蒙版'], ['disableOpacityMask', {disabled:true}, '停用不透明蒙版（Shift+点蒙版缩图）'], ['linkOpacityMask', {linked:true}, '链接不透明蒙版'], ['unlinkOpacityMask', {linked:false}, '取消链接不透明蒙版']]
  .forEach(([k, q, nm]) => reg('ai.transparency.' + k, `{ids?} 透明度面板菜单 ▸ ${nm} → {ok}`, p => CMD.map['ai.transparency.setOpacityMask'].run(Object.assign({}, p, q))));
reg('ai.transparency.viewOpacityMask', '{id?|null} 只看蒙版（Alt+点蒙版缩图；再叫一次或 null＝回正常）→ {ok, viewing}', p => {
  const {t, s} = maskTarget(p); if (p.id === null || (AiWindow.viewMask && (!s || AiWindow.viewMask.id === s.id))){ AiWindow.viewMask = null; if (t.L) Layer.invalidate(t.L); return {ok:true, viewing:false}; }
  if (!s || !s.opMask) return err('ai.transparency.viewOpacityMask', 'no opacity mask on the selection');
  AiWindow.viewMask = {layerId:t.L.id, id:s.id}; Layer.invalidate(t.L); return {ok:true, viewing:true};
}, false);
reg('ai.transparency.opacityMaskInfo', '{} 选中物件的蒙版 → [{id, clip, invert, linked, disabled, art:n}]', () => sel().R.filter(s => s.opMask).map(s => ({id:s.id, clip:s.opMask.clip !== false, invert:!!s.opMask.invert, linked:s.opMask.linked !== false, disabled:!!s.opMask.disabled, art:(s.opMask.art || []).length})), false);
reg('ai.transparency.toggleNewMasksClipping', '{} 菜单 ▸ 新建不透明蒙版为剪切蒙版（勾）→ {ok, on}', () => ({ok:true, on:(TP.newClip = !TP.newClip)}), false);
reg('ai.transparency.toggleNewMasksInverted', '{} 菜单 ▸ 新建不透明蒙版为反相蒙版（勾）→ {ok, on}', () => ({ok:true, on:(TP.newInvert = !TP.newInvert)}), false);
reg('ai.transparency.togglePageIsolatedBlending', '{} 菜单 ▸ 页面隔离混合（只记状态，跟原码一样存在文件）→ {ok, on}', () => ({ok:true, on:(TP.pageIsolate = !TP.pageIsolate)}), false);
reg('ai.transparency.togglePageKnockoutGroup', '{} 菜单 ▸ 页面挖空组（只记状态）→ {ok, on}', () => ({ok:true, on:(TP.pageKnockout = !TP.pageKnockout)}), false);
reg('ai.attributes.set', '{overprintFill?, overprintStroke?, showCenter?, note?, url?, imageMap?:"none|rectangle|polygon", fillRule?:"nonZero|evenOdd", ids?} 属性面板（attributes.rs；填色规则＝path.setFillRule）→ {ok, ids}', p => {
  const t = sel(p); if (!t.R.length) return err('ai.attributes.set', 'nothing selected');
  t.R.forEach(s => { ['overprintFill', 'overprintStroke', 'showCenter', 'note', 'url', 'imageMap'].forEach(k => { if (p[k] !== undefined) s[k] = p[k]; });
    if (p.fillRule !== undefined) leaves(s).forEach(x => { if (p.fillRule === 'evenOdd') x.fillRule = 'evenOdd'; else delete x.fillRule; }); });
  return done(t.L);
});

/* ═══════════ 对齐／分布（object.rs:735-904） ═══════════ */
function moveShape(L, s, dx, dy){ if (dx || dy){ shiftShape(s, dx, dy); } }
reg('ai.object.distribute', '{horizontal?:"left|center|right", vertical?:"top|center|bottom", bounds?:"preview"} 对齐面板 ▸ 分布对象（object.rs:806：按那个边排序，两端不动、中间平均；少于 3 个不动）→ {ok}', p => {
  const t = sel(p); if (t.R.length < 1) return err('ai.object.distribute', 'nothing selected');
  const horiz = !!p.horizontal; if (!p.horizontal && !p.vertical) return err('ai.object.distribute', 'give horizontal or vertical');
  const k = p.horizontal || p.vertical;
  const key = r => horiz ? (k === 'left' ? r.x0 : k === 'right' ? r.x1 : (r.x0 + r.x1) / 2) : (k === 'top' ? r.y0 : k === 'bottom' ? r.y1 : (r.y0 + r.y1) / 2);
  const items = t.R.map(s => ({s, r:bounds(t.L, s, p.bounds === 'preview')})).filter(x => x.r).sort((a, b) => key(a.r) - key(b.r));
  const n = items.length; if (n < 3) return {ok:true};
  const first = key(items[0].r), last = key(items[n - 1].r);
  items.forEach((it, i) => { const d = first + (last - first) * i / (n - 1) - key(it.r); horiz ? moveShape(t.L, it.s, d, 0) : moveShape(t.L, it.s, 0, d); });
  return done(t.L);
});
reg('ai.object.distributeSpacing', '{axis:"horizontal|vertical"="horizontal", spacing?: 间距（缺省＝两端不动平均分）} 对齐面板 ▸ 分布间距（object.rs:856）→ {ok}', p => {
  const t = sel(p); const horiz = p.axis !== 'vertical';
  const items = t.R.map(s => ({s, r:bounds(t.L, s, p.bounds === 'preview')})).filter(x => x.r).sort((a, b) => horiz ? a.r.x0 - b.r.x0 : a.r.y0 - b.r.y0);
  const n = items.length; if (n < 2) return err('ai.object.distributeSpacing', 'select two or more objects');
  const size = r => horiz ? r.x1 - r.x0 : r.y1 - r.y0, start = r => horiz ? r.x0 : r.y0;
  const gap = typeof p.spacing === 'number' ? p.spacing : ((horiz ? items[n - 1].r.x1 - items[0].r.x0 : items[n - 1].r.y1 - items[0].r.y0) - items.reduce((a, i) => a + size(i.r), 0)) / (n - 1);
  let pos = start(items[0].r);
  items.forEach(it => { const d = pos - start(it.r); horiz ? moveShape(t.L, it.s, d, 0) : moveShape(t.L, it.s, 0, d); pos += size(it.r) + gap; });
  return done(t.L);
});

/* ── 关键对象（select.rs:185 select.key：只能是选取里的一个；object.rs:750 reference_rect：to:"key"＝对齐它、它自己不动；to:"artboard"＝选取中心所在的画板） ── */
const KEY = AiWindow.key = {layerId:null, id:null};
const keyValid = () => { const t = sel(); return KEY.id && t.L && t.L.id === KEY.layerId && t.R.some(s => s.id === KEY.id) ? t.R.find(s => s.id === KEY.id) : null; };
AiWindow.keyObject = keyValid;
reg('ai.select.key', '{id?: 选取里的物件 id | null（清掉＝对齐面板菜单 ▸ 取消关键对象）} 设关键对象（对齐面板「对齐关键对象」用；不在选取里的不收）→ {ok, key}', p => {
  const t = sel(); if (p.id === null || p.id === undefined){ KEY.id = null; KEY.layerId = null; if (window.UI) UI.draw(); return {ok:true, key:null}; }
  if (!t.R.some(s => s.id === p.id)) return err('ai.select.key', 'the key object must be one of the selected objects');
  KEY.id = p.id; KEY.layerId = t.L.id; if (window.UI) UI.draw(); return {ok:true, key:p.id};
}, false);
(function wrapAlign(){
  const c = CMD.map['ai.object.align']; if (!c || c.__aiKey) return; c.__aiKey = true;
  const run0 = c.run;
  c.run = function(p){
    p = p || {};
    if (p.to !== 'key' && p.to !== 'artboard') return run0.call(this, p);
    const t = sel(p); if (!t.R.length) return err('ai.object.align', 'nothing selected');
    const preview = p.bounds === 'preview';
    let r, skip = null;
    if (p.to === 'key'){ const k = keyValid(); if (!k) return err('ai.object.align', 'no key object (ai.select.key)'); r = bounds(t.L, k, preview); skip = k.id; }
    else { const b = unionB(t.L, t.R, preview), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, A = window.AiR3 && AiR3.artboards ? AiR3.artboards() : [{rect:{x0:0, y0:0, x1:Doc.width, y1:Doc.height}}];
      const hit = A.find(a => cx >= a.rect.x0 && cx <= a.rect.x1 && cy >= a.rect.y0 && cy <= a.rect.y1) || A[0]; r = hit.rect; }
    t.R.forEach(s => { if (s.id === skip) return; const b = bounds(t.L, s, preview); if (!b) return;
      const dx = p.horizontal === 'left' ? r.x0 - b.x0 : p.horizontal === 'center' ? (r.x0 + r.x1) / 2 - (b.x0 + b.x1) / 2 : p.horizontal === 'right' ? r.x1 - b.x1 : 0;
      const dy = p.vertical === 'top' ? r.y0 - b.y0 : p.vertical === 'center' ? (r.y0 + r.y1) / 2 - (b.y0 + b.y1) / 2 : p.vertical === 'bottom' ? r.y1 - b.y1 : 0;
      if (dx || dy) shiftShape(s, dx, dy); });
    return done(t.L);
  };
  c.params = (c.params || '') + '；to:"key"＝对齐关键对象（ai.select.key，它不动）、to:"artboard"＝选取中心所在的画板（AiR3 画板）';
})();
/* 关键对象叠画：粗蓝框（AI 的关键对象外框） */
function keyOverlay(ctx, s){
  const k = AL.to === 'key' ? keyValid() : null; if (!k) return;
  const L = Doc.byId(KEY.layerId), b = bounds(L, k, false); if (!b) return;
  ctx.save(); ctx.strokeStyle = '#2f7fd8'; ctx.lineWidth = 3; ctx.setLineDash([]); ctx.strokeRect(b.x0 * s - 1, b.y0 * s - 1, (b.x1 - b.x0) * s + 2, (b.y1 - b.y0) * s + 2); ctx.restore();
}
function hookOverlay(){ if (window.UI && Array.isArray(UI.overlays) && !UI.__aiKeyOv){ UI.__aiKeyOv = true; UI.overlays.push((c, s) => keyOverlay(c, s)); } }
hookOverlay(); window.addEventListener('DOMContentLoaded', hookOverlay);

/* ═══════════ 画板（panels/artboards.rs、engine layer.rs:289-316、panelcmds.rs:37-73）——用 ai-object.js 的 AiR3 画板（0＝画布本身，其余存 Doc.aiR3.artboards.extra；对象 ▸ 画板、全选画板上的、导出都认它） ═══════════ */
const ABX = () => window.AiR3 && AiR3.doc ? AiR3.doc('artboards') : null;
const abList = () => window.AiR3 && AiR3.artboards ? AiR3.artboards() : [{index:0, id:1, name:'Artboard 1', rect:{x0:0, y0:0, x1:Doc.width, y1:Doc.height}}];
const abName = id => ({'zh-Hant':'工作區域 ', 'zh-Hans':'画板 ', en:'Artboard '}[(window.Lang && Lang.cur) || 'en'] || 'Artboard ') + id;
const abNextId = () => Math.max(1, ...abList().map(a => a.id)) + 1;
AiWindow.artboardSel = 0;
reg('ai.artboard.new', '{x?, y?, width?, height?, name?}（缺省＝最后一个画板右边 20、同大小）画板面板 ＋／菜单 ▸ 新建画板（layer.rs:289 artboard_new）→ {ok, index}', p => {
  const X = ABX(); if (!X) return err('ai.artboard.new', 'needs menus/impl/ai-object.js (AiR3)');
  const last = abList().slice(-1)[0].rect, w0 = last.x1 - last.x0, h0 = last.y1 - last.y0;
  const x = isFinite(+p.x) && p.x !== undefined ? +p.x : last.x1 + 20, y = isFinite(+p.y) && p.y !== undefined ? +p.y : last.y0;
  const w = Math.max(1, +p.width || w0), h = Math.max(1, +p.height || h0), id = abNextId();
  X.extra.push({id, name:typeof p.name === 'string' && p.name.trim() ? p.name.trim() : abName(abList().length + 1), rect:{x0:x, y0:y, x1:x + w, y1:y + h}});
  AiWindow.artboardSel = abList().length - 1; return {ok:true, index:abList().length - 1};
});
reg('ai.artboard.duplicate', '{index?=选中的} 画板面板菜单 ▸ 复制画板（panelcmds.rs:56：放在最右边画板右边 20、名字加 copy；画板上的图稿不复制，同原码）→ {ok, index}', p => {
  const X = ABX(); if (!X) return err('ai.artboard.duplicate', 'needs AiR3'); const all = abList(), i = p.index === undefined ? AiWindow.artboardSel : +p.index, src = all[i];
  if (!src) return err('ai.artboard.duplicate', 'no such artboard');
  const right = Math.max(...all.map(a => a.rect.x1)), dx = right + 20 - src.rect.x0;
  X.extra.push({id:abNextId(), name:src.name + ' copy', rect:{x0:src.rect.x0 + dx, y0:src.rect.y0, x1:src.rect.x1 + dx, y1:src.rect.y1}});
  AiWindow.artboardSel = abList().length - 1; return {ok:true, index:abList().length - 1};
});
reg('ai.artboard.delete', '{index?=选中的} 删除画板（layer.rs:304：至少留一个；画板 1＝画布本身，不能删）→ {ok}', p => {
  const X = ABX(); if (!X) return err('ai.artboard.delete', 'needs AiR3'); const i = p.index === undefined ? AiWindow.artboardSel : +p.index, n = abList().length;
  if (n <= 1) return err('ai.artboard.delete', 'a document needs at least one artboard'); if (!(i >= 0 && i < n)) return err('ai.artboard.delete', 'no such artboard');
  if (i === 0) return err('ai.artboard.delete', 'artboard 1 is the document canvas and can\'t be deleted (resize it, or delete the others)');
  X.extra.splice(i - 1, 1); AiWindow.artboardSel = Math.min(AiWindow.artboardSel, abList().length - 1); return {ok:true};
});
reg('ai.artboard.reorder', '{index, to} 画板面板 ↑／↓（panelcmds.rs:37 artboard.reorder）：改画板编号（画板 1＝画布固定在第一个）→ {ok}', p => {
  const X = ABX(); if (!X) return err('ai.artboard.reorder', 'needs AiR3'); const n = abList().length, i = +p.index, to = clamp(+p.to | 0, 1, n - 1);
  if (!(i >= 1 && i < n)) return err('ai.artboard.reorder', i === 0 ? 'artboard 1 is the document canvas and stays first' : 'no such artboard');
  const a = X.extra.splice(i - 1, 1)[0]; X.extra.splice(to - 1, 0, a); AiWindow.artboardSel = to; return {ok:true};
});
reg('ai.artboard.deleteEmpty', '{} 画板面板菜单 ▸ 删除空画板：上面没有任何可见图稿的画板（画板 1＝画布不删）→ {ok, removed}', () => {
  const X = ABX(); if (!X) return err('ai.artboard.deleteEmpty', 'needs AiR3');
  const boxes = []; Doc.layers.forEach(L => { if (!L.visible) return; if (L.kind === 'vector') L.data.shapes.forEach(s => { const b = bounds(L, s, true); if (b) boxes.push(b); }); else if (L.kind === 'raster' && L.data && L.data.canvas) boxes.push({x0:L.x, y0:L.y, x1:L.x + L.data.canvas.width, y1:L.y + L.data.canvas.height}); });
  const hit = r => boxes.some(b => b.x0 < r.x1 && b.x1 > r.x0 && b.y0 < r.y1 && b.y1 > r.y0), before = X.extra.length;
  X.extra = X.extra.filter(a => hit(a.rect)); AiWindow.artboardSel = 0; return {ok:true, removed:before - X.extra.length};
});
reg('ai.artboard.select', '{index} 画板面板：选一个画板（面板的「目前画板」，菜单项作用在它）→ {ok, index}', p => { const n = abList().length, i = +p.index; if (!(i >= 0 && i < n)) return err('ai.artboard.select', 'no such artboard'); AiWindow.artboardSel = i; return {ok:true, index:i}; }, false);
reg('ai.artboard.options', '{index?} 画板面板菜单 ▸ 画板选项…：名称／X／Y／宽／高对话框，确定＝ai.artboard.setProps → {ok, dialog}', p => {
  const i = p.index === undefined ? AiWindow.artboardSel : +p.index, a = abList()[i]; if (!a) return err('ai.artboard.options', 'no such artboard');
  P.dialog({id:'aiArtboardOpts', title:L3('工作區域選項', '画板选项', 'Artboard Options'), fields:[{k:'name', type:'text', label:L3('名稱：', '名称：', 'Name:'), value:a.name},
    {k:'x', type:'number', label:'X:', value:Math.round(a.rect.x0)}, {k:'y', type:'number', label:'Y:', value:Math.round(a.rect.y0)},
    {k:'width', type:'number', label:L3('寬度：', '宽度：', 'Width:'), value:Math.round(a.rect.x1 - a.rect.x0), min:1}, {k:'height', type:'number', label:L3('高度：', '高度：', 'Height:'), value:Math.round(a.rect.y1 - a.rect.y0), min:1}],
    ok:v => CMD.run('ai.artboard.setProps', Object.assign({index:i}, v))});
  return {ok:true, dialog:'artboardOptions'};
}, false);

/* ═══════════ 路径查找器（pathfinder.rs：编组 → 活效果 → 扩展外观；一步历史） ═══════════ */
const PF = [['unite', 'pathfinder.add', '⊕', L3('聯集', '联集', 'Unite')], ['minusFront', 'pathfinder.subtract', '⊖', L3('減去上層', '减去顶层', 'Minus Front')],
  ['intersect', 'pathfinder.intersect', '⊗', L3('交集', '交集', 'Intersect')], ['exclude', 'pathfinder.exclude', '⊘', L3('差集', '差集', 'Exclude')],
  ['divide', 'pathfinder.divide', '◫', L3('分割', '分割', 'Divide')], ['trim', 'pathfinder.trim', '◧', L3('剪除', '修边', 'Trim')], ['merge', 'pathfinder.merge', '◨', L3('合併', '合并', 'Merge')],
  ['crop', 'pathfinder.crop', '◩', L3('裁切', '裁剪', 'Crop')], ['outline', 'pathfinder.outline', '◻', L3('外框', '轮廓', 'Outline')], ['minusBack', 'pathfinder.minusBack', '◪', L3('依後減去', '减去后方对象', 'Minus Back')]];
PF.forEach(([op, fx]) => reg('ai.object.pathfinder.' + op, `{} 路径查找器 ▸ ${op}（形状模式要 2 个以上物件；分割与轮廓 1 个就行）→ {ok, ids}`, p => {
  const C = 'ai.object.pathfinder.' + op, t = sel(p), min = op === 'divide' || op === 'outline' ? 1 : 2;
  if (t.R.length < min) return err(C, `select ${min} or more objects`);
  const R = (id, q) => { const c = CMD.map[id]; if (!c) throw new Error('missing ' + id); const r = c.run(q || {}); if (r && r.ok === false) throw new Error(r.error || id); return r; };
  try {
    let gid = t.R.length === 1 && t.R[0].type === 'group' ? t.R[0].id : null;
    if (!gid){ const g = R('ai.object.group', {}); gid = g.id || (VecSel.shapes[0]); }
    R('ai.effect.apply', {effect:fx, ids:[gid], layerId:t.L.id});
    R('ai.effect.expandAppearance', {ids:[gid], layerId:t.L.id});
    // 形状模式的结果是一个（复合）形状，不是编组：编组里只剩一个就拆掉（pathfinder.rs unite／minusFront／intersect／exclude 回单一路径）
    const g = t.L.data.shapes.find(s => s.id === gid);
    if (['unite', 'minusFront', 'intersect', 'exclude'].includes(op) && g && g.type === 'group' && g.children && g.children.length === 1){ VecSel.setShapes(t.L.id, [gid]); R('ai.object.ungroup', {}); }
  } catch(e){ return err(C, e.message); }
  AiWindow.lastPathfinder = op;
  return done(t.L);
}));

/* ═══════════ 变换（transform.rs：X/Y/W/H、旋转、倾斜、翻转；矩阵交给 scale.transform） ═══════════ */
const REF = (r, i) => [[r.x0, (r.x0 + r.x1) / 2, r.x1][i % 3], [r.y0, (r.y0 + r.y1) / 2, r.y1][Math.min(2, Math.floor(i / 3))]];
const xformRun = (m, t) => { const c = CMD.map['scale.transform']; if (!c) throw new Error('missing scale.transform'); const r = c.run({matrix:m, layerId:t.L.id, ids:t.R.map(s => s.id)}); if (r && r.ok === false) throw new Error(r.error); };
const about = (o, a, b, c, d) => [a, b, c, d, o[0] - a * o[0] - c * o[1], o[1] - b * o[0] - d * o[1]];
/* 对象菜单单（menus/impl/ai-object.js，先载）已登记 ai.object.rotate／reflect／shear 正本（活矩形保活、copy、absolute、origin、外框角度 bboxAngle…）。
   有就不盖掉（以前后载的这份盖掉它，对象 ▸ 变换 ▸ 旋转…会把活矩形变成路径、对称…的复制失效）：只给正本补上面板用的 reference（九宫格参考点）⇒ 换成 origin */
function regXf(id, params, fn){
  const prev = CMD.map[id];
  if (!prev) return reg(id, params, fn);
  const run0 = prev.run;
  prev.run = function(p){
    p = p || {};
    if (p.reference !== undefined && p.origin === undefined){
      const t = sel(p), r = t.R.length ? unionB(t.L, t.R, false) : null;
      if (r) p = Object.assign({}, p, {origin:REF(r, clamp(+p.reference | 0, 0, 8))});
    }
    return run0.call(this, p);
  };
  prev.params = (prev.params || '') + '；reference?:0..8（九宫格参考点，给了就换成 origin；变换面板用）';
}
reg('ai.object.setBounds', '{x?, y?, width?, height?, reference?:0..8=4（九宫格）, proportional?:bool} 变换面板 X/Y/宽/高（object.rs set_bounds）→ {ok}', p => {
  const t = sel(p); if (!t.R.length) return err('ai.object.setBounds', 'nothing selected');
  const r = unionB(t.L, t.R, false); if (!r) return err('ai.object.setBounds', 'no bounds');
  const ref = p.reference === undefined ? 4 : clamp(+p.reference | 0, 0, 8), o = REF(r, ref), w = r.x1 - r.x0, h = r.y1 - r.y0;
  let sx = typeof p.width === 'number' && w > 0 ? p.width / w : 1, sy = typeof p.height === 'number' && h > 0 ? p.height / h : 1;
  if (p.proportional){ if (typeof p.width === 'number' && typeof p.height !== 'number') sy = sx; else if (typeof p.height === 'number' && typeof p.width !== 'number') sx = sy; }
  try {
    if (sx !== 1 || sy !== 1) xformRun(about(o, sx, 0, 0, sy), t);
    const dx = typeof p.x === 'number' ? p.x - o[0] : 0, dy = typeof p.y === 'number' ? p.y - o[1] : 0;
    if (dx || dy) xformRun([1, 0, 0, 1, dx, dy], t);
  } catch(e){ return err('ai.object.setBounds', e.message); }
  return done(t.L);
});
regXf('ai.object.rotate', '{angle:度（逆时针为正）, reference?:0..8=4} 变换面板 ▸ 旋转 → {ok}', p => {
  const t = sel(p); if (!t.R.length) return err('ai.object.rotate', 'nothing selected');
  const r = unionB(t.L, t.R, false), o = REF(r, p.reference === undefined ? 4 : +p.reference), a = -(+p.angle || 0) * Math.PI / 180;
  try { xformRun(about(o, Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)), t); } catch(e){ return err('ai.object.rotate', e.message); }
  return done(t.L);
});
regXf('ai.object.shear', '{angle:度, axis:"horizontal|vertical"="horizontal", reference?} 变换面板 ▸ 倾斜 → {ok}', p => {
  const t = sel(p); if (!t.R.length) return err('ai.object.shear', 'nothing selected');
  const r = unionB(t.L, t.R, false), o = REF(r, p.reference === undefined ? 4 : +p.reference), k = Math.tan((+p.angle || 0) * Math.PI / 180);
  try { xformRun(p.axis === 'vertical' ? about(o, 1, k, 0, 1) : about(o, 1, 0, -k, 1), t); } catch(e){ return err('ai.object.shear', e.message); }
  return done(t.L);
});
regXf('ai.object.reflect', '{axis:"vertical"（水平翻转）|"horizontal"（垂直翻转）, reference?} 变换面板 ▸ 翻转 → {ok}', p => {
  const t = sel(p); if (!t.R.length) return err('ai.object.reflect', 'nothing selected');
  const r = unionB(t.L, t.R, false), o = REF(r, p.reference === undefined ? 4 : +p.reference);
  try { xformRun(p.axis === 'horizontal' ? about(o, 1, 0, 0, -1) : about(o, -1, 0, 0, 1), t); } catch(e){ return err('ai.object.reflect', e.message); }
  return done(t.L);
});

reg('ai.object.setLiveShape', '{radius?: 圆角（活矩形）, sides?: 3..20（活多边形）, ids?} 变换面板／属性面板的活形状栏位（transform.rs:106-117 object.setLiveShape）→ {ok, ids}', p => {
  const t = sel(p), R = t.R.filter(s => (p.radius !== undefined && s.type === 'rect') || (p.sides !== undefined && s.type === 'polygon'));
  if (!R.length) return err('ai.object.setLiveShape', 'select a live rectangle (radius) or polygon (sides)');
  R.forEach(s => { if (s.type === 'rect') s.radius = Math.max(0, +p.radius || 0); else s.points = clamp(Math.round(+p.sides || 6), 3, 20); });
  return done(t.L);
});

/* ═══════════ 色板（color/src/swatch.rs:80-154 预设；左键＝套到选取（填色或描边，看工具栏哪个色块在前）） ═══════════ */
const DEFAULT_SWATCHES = [['[None]', 'none'], ['White', '#ffffff'], ['Black', '#000000'], ['Red', '#ed1c24'], ['Orange Red', '#f15a24'], ['Orange', '#f7931e'], ['Amber', '#fbb03b'], ['Yellow', '#fcee21'],
  ['Yellow Green', '#d9e021'], ['Lime', '#8cc63f'], ['Green', '#39b54a'], ['Emerald', '#009245'], ['Teal', '#006837'], ['Aqua', '#22b573'], ['Cyan Green', '#00a99d'], ['Cyan', '#29abe2'], ['Azure', '#0071bc'],
  ['Blue', '#2e3192'], ['Indigo', '#1b1464'], ['Violet', '#662d91'], ['Purple', '#93278f'], ['Magenta', '#9e005d'], ['Rose', '#d4145a'], ['Pink', '#ed1e79'],
  ['Brown', '#c7b299'], ['Tan', '#998675'], ['Coffee', '#736357'], ['Chocolate', '#534741'], ['Sand', '#c69c6d'], ['Copper', '#a67c52'], ['Rust', '#8c6239'], ['Walnut', '#754c24'], ['Espresso', '#603813'],
  ['White, Black', {kind:'linear', stops:[[0, '#ffffff'], [1, '#000000']]}], ['Radial White, Black', {kind:'radial', stops:[[0, '#ffffff'], [1, '#000000']]}],
  ['Sunset', {kind:'linear', stops:[[0, '#fbb03b'], [1, '#d4145a']]}], ['Ocean', {kind:'linear', stops:[[0, '#29abe2'], [1, '#2e3192']]}]];
const DEFAULT_GROUPS = [['Grays', [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1].map(k => [`K=${Math.round(k * 100)}`, rgbHex((1 - k) * 255, (1 - k) * 255, (1 - k) * 255)])],
  ['Brights', [['Bright Red', '#ff1d25'], ['Bright Yellow', '#ffe600'], ['Bright Green', '#00e676'], ['Bright Blue', '#2979ff'], ['Bright Violet', '#d500f9']]]];
const SW = AiWindow.swatches = {list:null, groups:null, view:'grid'};
const swList = () => { if (!SW.list){ SW.list = clone(DEFAULT_SWATCHES); SW.groups = clone(DEFAULT_GROUPS); } return SW.list; };
const activeStroke = () => !!(window.Toolbar && Toolbar.activeSwatch === 'stroke');
const gradPaint = g => ({stops:g.stops.map(([o, c]) => ({offset:o, color:c, opacity:1})), kind:g.kind});
function applyPaint(v, stroke, name){
  const t = sel();
  if (typeof v === 'object'){
    if (!t.R.length) return err('ai.swatch.apply', 'select an object to apply a gradient');
    return CMD.map['gradient.edit'] ? CMD.map['gradient.edit'].run({kind:v.kind, stops:gradPaint(v).stops, stroke, ids:t.R.flatMap(leaves).map(s => s.id), layerId:t.L.id}) : err('ai.swatch.apply', 'no gradient command');
  }
  if (v !== 'none') CMD.map['eyedropper.setColors'].run(stroke ? {background:v} : {foreground:v});
  // [无]：目前填色／描边也设成无（AI 工具栏的填色块变红斜线）
  if (window.Toolbar){
    if (stroke){ if (v === 'none'){ const w = document.getElementById('strokeW'); if (w && +w.value > 0){ w.value = 0; w.dispatchEvent(new Event('input')); } } }
    else Toolbar.fillNone = v === 'none';
    if (Toolbar.refreshColors) Toolbar.refreshColors();
  }
  // AI：手上是形状生成器／实时上色工具时，点色板只换「要上的颜色」，不改选中的物件（例：框选全部圆 → Shift+M → 色板点橙色，圆不变色）
  if (t.R.length && !['shapebuilder', 'livepaint'].includes(window.ToolState && ToolState.cur)) return CMD.map['ai.paint.set'].run(stroke ? {stroke:v} : {fill:v});
  return {ok:true, color:v, name};
}
reg('ai.swatch.apply', '{index?:序号 | name?:色板名, stroke?:bool（缺省＝工具栏作用中的色块）} 色板面板：点一个色板＝套到选中物件（没选＝设成目前填色／描边色）→ {ok}', p => {
  const L = swList(), all = L.concat(SW.groups.flatMap(g => g[1]));
  const s = typeof p.name === 'string' ? all.find(x => x[0] === p.name) : all[+p.index];
  if (!s) return err('ai.swatch.apply', 'no such swatch');
  return applyPaint(s[1], p.stroke === undefined ? activeStroke() : !!p.stroke, s[0]);
});
reg('ai.swatch.new', '{name?, color?:"#rrggbb"（缺省＝目前填色）} 新增色板 → {ok, name}', p => { const L = swList(); const c = p.color || document.getElementById('fillColor').value; const name = p.name || c; L.push([name, c]); return {ok:true, name}; }, false);
reg('ai.swatch.delete', '{name? | names?:[…]（缺省＝面板选中的）| group?: 颜色组名（整组删）} 删除色板（用到它的物件颜色不变，同原码：Art using a deleted global swatch keeps its colour）→ {ok, deleted}', p => {
  swList(); if (p.group){ const i = SW.groups.findIndex(g => g[0] === p.group); if (i < 0) return err('ai.swatch.delete', 'no such colour group'); SW.groups.splice(i, 1); return {ok:true, deleted:1}; }
  const names = p.name ? [p.name] : Array.isArray(p.names) ? p.names : SW.sel; let n = 0;
  names.forEach(nm => { if (nm === '[None]') return; for (const L of [SW.list].concat(SW.groups.map(g => g[1]))){ const i = L.findIndex(x => x[0] === nm); if (i >= 0){ L.splice(i, 1); n++; break; } } });
  if (!n) return err('ai.swatch.delete', 'no such swatch'); SW.sel = []; return {ok:true, deleted:n};
}, false);
reg('ai.swatch.resetDefaults', '{replace?:bool} 窗口 ▸ 色板库 ▸ 默认色板（swatchlib.rs:49-57：补回缺的预设色板与组；replace＝整个换回预设）→ {ok, added}', p => {
  const L = swList(); let n = 0;
  if (p.replace){ SW.list = clone(DEFAULT_SWATCHES); SW.groups = clone(DEFAULT_GROUPS); return {ok:true, added:DEFAULT_SWATCHES.length}; }
  DEFAULT_SWATCHES.forEach(s => { if (!L.some(x => x[0] === s[0])){ L.push(clone(s)); n++; } });
  DEFAULT_GROUPS.forEach(g => { if (!SW.groups.some(x => x[0] === g[0])){ SW.groups.push(clone(g)); n++; } });
  return {ok:true, added:n};
}, false);
reg('ai.swatch.list', '{} → {ok, swatches:[{name, value}], groups}', () => ({ok:true, swatches:swList().map(s => ({name:s[0], value:s[1]})), groups:SW.groups.map(g => ({name:g[0], swatches:g[1].map(s => ({name:s[0], value:s[1]}))}))}), false);
/* 色板面板菜单（swatches.rs menu：新建颜色组、复制、合并、删除、取消颜色组编组、选择所有未使用的、添加使用的颜色、按名称／类型排序、缩图／列表、查找栏、色板选项…） */
SW.sel = []; SW.find = ''; SW.showFind = false;
const swFind = name => { swList(); for (const L of [SW.list].concat(SW.groups.map(g => g[1]))){ const i = L.findIndex(x => x[0] === name); if (i >= 0) return {L, i, s:L[i]}; } return null; };
const swKind = v => v === 'none' ? 0 : typeof v === 'string' ? 1 : 2;
function usedPaints(){ const out = new Set(); Doc.layers.forEach(L => { if (L.kind !== 'vector') return; const walk = s => { if (s.children) s.children.forEach(walk); [s.fill, s.stroke].forEach(v => { if (typeof v === 'string' && v !== 'none') out.add(v.toLowerCase()); }); }; L.data.shapes.forEach(walk); }); return out; }
reg('ai.swatch.newGroup', '{name?, names?:[色板名…]（缺省＝面板选中的色板；没选＝选中物件用到的颜色）} 新建颜色组…（ui.newColorGroup）→ {ok, name, count}', p => {
  swList(); let names = Array.isArray(p.names) ? p.names : SW.sel.slice(), items = names.map(n => swFind(n)).filter(Boolean).filter(x => typeof x.s[1] === 'string' && x.s[1] !== 'none');
  let colors = items.map(x => clone(x.s));
  if (!colors.length){ const t = sel(); const set = new Set(); t.R.flatMap(leaves).forEach(s => [s.fill, s.stroke].forEach(v => { if (typeof v === 'string' && v !== 'none') set.add(v); })); colors = [...set].map(c => [c, c]); }
  if (!colors.length) return err('ai.swatch.newGroup', 'select swatches or art with colours');
  let name = String(p.name || '').trim(); if (!name){ let i = 1; while (SW.groups.some(g => g[0] === 'Color Group ' + i)) i++; name = 'Color Group ' + i; }
  items.forEach(x => { if (x.L === SW.list) x.L.splice(x.L.indexOf(x.s), 1); });
  SW.groups.push([name, colors]); SW.sel = []; return {ok:true, name, count:colors.length};
}, false);
reg('ai.swatch.duplicate', '{names?（缺省＝选中的）} 复制色板（名字加 copy）→ {ok, names}', p => {
  const names = Array.isArray(p.names) ? p.names : p.name ? [p.name] : SW.sel; const out = [];
  names.forEach(n => { const f = swFind(n); if (!f || f.s[1] === 'none') return; let nn = n + ' copy', k = 2; while (swFind(nn)) nn = `${n} copy ${k++}`; f.L.splice(f.i + 1, 0, [nn, clone(f.s[1])]); out.push(nn); });
  if (!out.length) return err('ai.swatch.duplicate', 'select swatches to duplicate'); SW.sel = out; return {ok:true, names:out};
}, false);
reg('ai.swatch.merge', '{names?（缺省＝选中的，≥2）} 合并色板：留第一个，其余删掉；用到其余颜色的物件改用第一个（swatch.merge）→ {ok, recolored}', p => {
  const names = Array.isArray(p.names) ? p.names : SW.sel; const items = names.map(swFind).filter(x => x && typeof x.s[1] === 'string' && x.s[1] !== 'none');
  if (items.length < 2) return err('ai.swatch.merge', 'select two or more colour swatches'); const keep = items[0].s[1], drop = items.slice(1).map(x => x.s[1].toLowerCase()); let n = 0;
  Doc.layers.forEach(L => { if (L.kind !== 'vector') return; let hit = false; const walk = s => { if (s.children) s.children.forEach(walk); ['fill', 'stroke'].forEach(k => { if (typeof s[k] === 'string' && drop.includes(s[k].toLowerCase())){ s[k] = keep; hit = true; n++; } }); }; L.data.shapes.forEach(walk); if (hit) Layer.invalidate(L); });
  items.slice(1).forEach(x => { const f = swFind(x.s[0]); if (f) f.L.splice(f.i, 1); }); SW.sel = [items[0].s[0]]; return {ok:true, recolored:n};
});
reg('ai.swatch.ungroup', '{group} 取消颜色组编组：组里的色板放回色板清单 → {ok, count}', p => {
  const i = SW.groups.findIndex(g => g[0] === p.group); if (i < 0) return err('ai.swatch.ungroup', 'no such colour group'); const g = SW.groups.splice(i, 1)[0]; swList().push(...g[1]); return {ok:true, count:g[1].length};
}, false);
reg('ai.swatch.unused', '{} 选择所有未使用的色板（文件里没有物件用到的实色色板）→ {ok, names}', () => { const used = usedPaints(); const names = swList().concat(SW.groups.flatMap(g => g[1])).filter(s => typeof s[1] === 'string' && s[1] !== 'none' && !used.has(s[1].toLowerCase())).map(s => s[0]); SW.sel = names; return {ok:true, names}; }, false);
reg('ai.swatch.addUsedColors', '{} 添加使用的颜色：文件里用到、色板没有的实色加进色板 → {ok, added}', () => { const have = new Set(swList().concat(SW.groups.flatMap(g => g[1])).filter(s => typeof s[1] === 'string').map(s => s[1].toLowerCase())); let n = 0;
  usedPaints().forEach(c => { if (!have.has(c)){ const [r, g, b] = hexRgb(c); swList().push([`R=${r} G=${g} B=${b}`, c]); n++; } }); return {ok:true, added:n}; }, false);
reg('ai.swatch.sortByName', '{} 按名称排序（[无] 留第一个）→ {ok}', () => { const L = swList(), none = L.filter(s => s[1] === 'none'); SW.list = none.concat(L.filter(s => s[1] !== 'none').sort((a, b) => a[0].localeCompare(b[0]))); return {ok:true}; }, false);
reg('ai.swatch.sortByKind', '{} 按类型排序（无 → 实色 → 渐变；同类保持次序）→ {ok}', () => { SW.list = swList().map((s, i) => [s, i]).sort((a, b) => swKind(a[0][1]) - swKind(b[0][1]) || a[1] - b[1]).map(x => x[0]); return {ok:true}; }, false);
reg('ai.swatch.edit', '{name, newName?, color?:"#rrggbb"} 色板选项…（ui.swatchOptions）：改名／改颜色；用到旧颜色的物件跟着改（全局色板行为）→ {ok}', p => {
  const f = swFind(p.name); if (!f || f.s[1] === 'none') return err('ai.swatch.edit', 'no such swatch'); const old = f.s[1];
  if (p.newName && p.newName !== p.name){ if (swFind(p.newName)) return err('ai.swatch.edit', 'that name is taken'); f.s[0] = String(p.newName); SW.sel = [f.s[0]]; }
  if (p.color && typeof old === 'string' && /^#?[0-9a-f]{6}$/i.test(p.color)){ const c = '#' + p.color.replace('#', '').toLowerCase(); f.s[1] = c;
    Doc.layers.forEach(L => { if (L.kind !== 'vector') return; let hit = false; const walk = s => { if (s.children) s.children.forEach(walk); ['fill', 'stroke'].forEach(k => { if (typeof s[k] === 'string' && s[k].toLowerCase() === old.toLowerCase()){ s[k] = c; hit = true; } }); }; L.data.shapes.forEach(walk); if (hit) Layer.invalidate(L); }); }
  return {ok:true};
});
reg('ai.swatch.options', '{name?（缺省＝选中的）} 开「色板选项」对话框（名称、颜色）→ {ok, dialog}', p => {
  const n = p.name || SW.sel[0], f = n && swFind(n); if (!f || typeof f.s[1] !== 'string' || f.s[1] === 'none') return err('ai.swatch.options', 'select a colour swatch');
  P.dialog({id:'aiSwatchOpts', title:L3('色票選項', '色板选项', 'Swatch Options'), fields:[{k:'newName', type:'text', label:L3('色票名稱：', '色板名称：', 'Swatch Name:'), value:f.s[0]}, {k:'color', type:'color', label:L3('顏色：', '颜色：', 'Color:'), value:f.s[1]}],
    ok:v => CMD.run('ai.swatch.edit', {name:f.s[0], newName:v.newName, color:v.color})});
  return {ok:true, dialog:'swatchOptions'};
}, false);
reg('ai.swatch.select', '{names:[色板名…]} 色板面板的选取（Shift／Ctrl+点）→ {ok, names}', p => { SW.sel = (p.names || []).filter(n => swFind(n)); return {ok:true, names:SW.sel.slice()}; }, false);
reg('ai.swatch.view', '{mode:"grid"|"list", find?: 字串（查找栏）, showFind?: bool} 色板面板：缩图／列表视图、查找栏 → {ok}', p => { if (p.mode === 'grid' || p.mode === 'list') SW.view = p.mode; if (typeof p.find === 'string') SW.find = p.find; if (typeof p.showFind === 'boolean') SW.showFind = p.showFind; return {ok:true, view:SW.view}; }, false);

/* ═══════════ 色板库（color/src/libraries.rs：OKLCH 算出来、超出 sRGB 就降彩度） ═══════════ */
function oklabToSrgb(l, a, b){
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b, m_ = l - 0.1055613458 * a - 0.0638541728 * b, s_ = l - 0.0894841775 * a - 1.2914855480 * b;
  const l3 = l_ * l_ * l_, m3 = m_ * m_ * m_, s3 = s_ * s_ * s_;
  return [4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3, -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3, -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3]
    .map(v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
}
function oklch(l, c, h){
  const sn = Math.sin(h * Math.PI / 180), cs = Math.cos(h * Math.PI / 180), at = c => oklabToSrgb(l, c * cs, c * sn), fits = rgb => rgb.every(v => v >= -1e-4 && v <= 1.0001);
  let rgb = at(c);
  if (!fits(rgb)){ let lo = 0, hi = c; for (let i = 0; i < 24; i++){ const mid = (lo + hi) / 2; if (fits(at(mid))) lo = mid; else hi = mid; } rgb = at(lo); }
  return rgbHex(...rgb.map(v => Math.round(clamp(v, 0, 1) * 255)));
}
const labOf = (l, c, h) => [l, c * Math.cos(h * Math.PI / 180), c * Math.sin(h * Math.PI / 180)];
const mixLab = (a, b, t) => { const p = [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t); return oklch(p[0], Math.hypot(p[1], p[2]), Math.atan2(p[2], p[1]) * 180 / Math.PI); };
const gray = k => rgbHex((1 - k) * 255, (1 - k) * 255, (1 - k) * 255);                  // Color::gray(k)：K 值（0＝白）
const ramp = (name, n, l0, l1, c, h) => [name, Array.from({length:n}, (_, i) => { const t = i / Math.max(1, n - 1); return [`${name} ${i + 1}`, oklch(l0 + (l1 - l0) * t, c(t), h(t))]; })];
const HUES = [['Red', 25], ['Orange', 55], ['Amber', 75], ['Yellow', 100], ['Lime', 125], ['Green', 145], ['Teal', 180], ['Cyan', 205], ['Azure', 235], ['Blue', 265], ['Violet', 295], ['Magenta', 330]];
const hueRow = (prefix, l, c) => [prefix, HUES.map(([n, h]) => [`${prefix} ${n}`, oklch(l, c, h)])];
const even = (name, kind, colors) => [name, {kind, stops:colors.map((c, i) => [i / Math.max(1, colors.length - 1), c])}];
const lch = pts => pts.map(([l, c, h]) => oklch(l, c, h));
function scale(name, n, anchors){ const pts = anchors.map(([l, c, h]) => labOf(l, c, h)), segs = pts.length - 1;
  return [name, Array.from({length:n}, (_, i) => { const t = i / (n - 1) * segs, k = Math.min(Math.floor(t), pts.length - 2); return [`${name} ${i + 1}`, mixLab(pts[k], pts[k + 1], t - k)]; })]; }
function harmonyGroups(){
  const bases = [['Coral', hsbHex(8, 0.68, 0.94)], ['Teal', hsbHex(176, 0.72, 0.62)]], rules = ['Complementary', 'Split Complementary', 'Analogous', 'Triad', 'Tetrad', 'Pentagram'];
  const out = []; bases.forEach(([bn, base]) => rules.forEach(rule => { const name = `${rule} ${bn}`; out.push([name, Harmony.apply(rule, base).map((c, i) => [`${name} ${i + 1}`, c])]); })); return out;
}
const SWATCH_LIBS = [
  ['web-safe-216', 'Web Safe 216', () => { const s = []; for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++){ const c = rgbHex(r * 51, g * 51, b * 51); s.push([c.toUpperCase(), c]); } return {swatches:s, groups:[]}; }],
  ['grays-neutrals', 'Grays and Neutrals', () => ({swatches:[], groups:[['Grays', Array.from({length:21}, (_, i) => [`K=${i * 5}`, gray(i / 20)])], ramp('Warm Gray', 9, 0.95, 0.25, () => 0.012, () => 70), ramp('Cool Gray', 9, 0.95, 0.25, () => 0.015, () => 250),
    ['Neutrals', [['Ivory', 0.96, 0.02, 95], ['Linen', 0.92, 0.02, 70], ['Oat', 0.86, 0.035, 80], ['Greige', 0.72, 0.02, 75], ['Stone', 0.66, 0.015, 95], ['Taupe', 0.56, 0.03, 50], ['Slate', 0.48, 0.025, 250], ['Charcoal', 0.30, 0.01, 260]].map(([n, l, c, h]) => [n, oklch(l, c, h)])]]})],
  ['earth-tones', 'Earth Tones', () => ({swatches:[], groups:[['Clay', 0.10, 40], ['Terracotta', 0.13, 35], ['Ochre', 0.11, 80], ['Umber', 0.06, 60], ['Sand', 0.05, 85], ['Olive', 0.08, 115], ['Moss', 0.07, 130]]
    .map(([n, c, h]) => ramp(n, 6, 0.86, 0.34, t => c * (0.6 + 0.4 * (1 - Math.pow(2 * t - 1, 2))), () => h))})],
  ['skin-tone-ramps', 'Skin Tone Ramps', () => ({swatches:[], groups:[['Rosy', 0.075, 35], ['Neutral', 0.07, 55], ['Golden', 0.08, 70], ['Olive', 0.06, 85]].map(([n, c, h]) => ramp(n, 8, 0.93, 0.32, t => c * (0.45 + 0.75 * t - 0.35 * t * t), t => h - 8 * t))})],
  ['pastels', 'Pastels', () => ({swatches:[], groups:[hueRow('Pastel', 0.91, 0.055), hueRow('Soft', 0.84, 0.085)]})],
  ['brights', 'Brights', () => ({swatches:[], groups:[hueRow('Vivid', 0.72, 0.4), hueRow('Deep', 0.52, 0.4)]})],
  ['metallic-gradients', 'Metallic Gradients', () => ({swatches:[['Gold', 0.78, 0.12, 85], ['Silver', 0.80, 0.005, 250], ['Bronze', 0.62, 0.09, 65], ['Copper', 0.64, 0.12, 45], ['Brass', 0.76, 0.10, 95], ['Chrome', 0.72, 0.012, 230],
    ['Rose Gold', 0.76, 0.07, 30], ['Gunmetal', 0.45, 0.015, 250], ['Platinum', 0.86, 0.008, 90], ['Pewter', 0.60, 0.01, 200]].map(([n, l, c, h]) => [n, {kind:'linear', stops:[[0, 0.16], [0.3, 0], [0.5, -0.2], [0.72, 0.12], [1, -0.06]].map(([at, dl]) => [at, oklch(clamp(l + dl, 0.05, 0.98), c, h)])}]), groups:[]})],
  ['perceptual-scales', 'Perceptual Scales', () => ({swatches:[], groups:[['Ember', [[0.22, 0.10, 300], [0.55, 0.18, 30], [0.93, 0.15, 100]]], ['Lagoon', [[0.25, 0.07, 265], [0.60, 0.12, 200], [0.93, 0.12, 130]]],
    ['Dusk', [[0.20, 0.08, 280], [0.60, 0.15, 330], [0.92, 0.07, 60]]], ['Moss', [[0.25, 0.05, 150], [0.92, 0.07, 110]]], ['Ink', [[0.20, 0.02, 260], [0.96, 0.01, 260]]],
    ['Clay to Teal', [[0.45, 0.12, 40], [0.96, 0.01, 80], [0.45, 0.09, 200]]], ['Plum to Olive', [[0.40, 0.11, 330], [0.96, 0.01, 90], [0.45, 0.09, 120]]]].map(([n, a]) => scale(n, 9, a))})],
  ['harmony-sets', 'Harmony Sets', () => ({swatches:[], groups:harmonyGroups()})]];
const GRADIENT_LIBS = [
  ['spectrum-gradients', 'Spectrum Gradients', () => ({swatches:[even('Spectrum', 'linear', Array.from({length:7}, (_, i) => oklch(0.72, 0.4, 25 + i * 60))), even('Soft Spectrum', 'linear', lch([[0.88, 0.08, 25], [0.9, 0.08, 145], [0.86, 0.08, 265], [0.88, 0.08, 25]]))]
    .concat(HUES.map((h, i) => { const b = HUES[(i + 2) % 12]; return even(`${h[0]} to ${b[0]}`, 'linear', [oklch(0.7, 0.4, h[1]), oklch(0.7, 0.4, b[1])]); })), groups:[]})],
  ['sky-gradients', 'Sky Gradients', () => ({swatches:[['Dawn', [[0.45, 0.08, 280], [0.72, 0.12, 350], [0.9, 0.09, 75]]], ['Noon', [[0.55, 0.13, 250], [0.78, 0.09, 235], [0.95, 0.03, 220]]], ['Sunset', [[0.35, 0.09, 300], [0.62, 0.18, 20], [0.85, 0.15, 70]]],
    ['Dusk', [[0.25, 0.07, 275], [0.48, 0.1, 310], [0.7, 0.1, 30]]], ['Night', [[0.15, 0.04, 270], [0.3, 0.07, 265]]], ['Overcast', [[0.62, 0.015, 240], [0.86, 0.01, 230]]]].map(([n, p]) => even(n, 'linear', lch(p))), groups:[]})],
  ['neutral-gradients', 'Neutral Gradients', () => ({swatches:[even('White to Black', 'linear', [gray(0), gray(1)]), even('Light Grays', 'linear', [gray(0), gray(0.4)]), even('Dark Grays', 'linear', [gray(0.6), gray(1)]),
    even('Warm Grays', 'linear', lch([[0.95, 0.012, 70], [0.3, 0.012, 70]])), even('Cool Grays', 'linear', lch([[0.95, 0.015, 250], [0.3, 0.015, 250]])),
    ['Fade to Transparent', {kind:'linear', stops:[[0, gray(1)], [1, gray(1)]], opacity:[1, 0]}], ['White Fade', {kind:'linear', stops:[[0, gray(0)], [1, gray(0)]], opacity:[1, 0]}], ['Vignette', {kind:'radial', stops:[[0, gray(1)], [0.6, gray(1)], [1, gray(1)]], opacity:[0, 0, 0.7]}]], groups:[]})],
  ['duotone-gradients', 'Duotone Gradients', () => ({swatches:[['Coral', 0.7, 30, 'Navy', 0.32, 265], ['Plum', 0.38, 330, 'Lime', 0.88, 125], ['Teal', 0.5, 190, 'Gold', 0.85, 90], ['Indigo', 0.3, 280, 'Peach', 0.86, 55], ['Forest', 0.35, 150, 'Rose', 0.8, 0]]
    .map(([a, la, ha, b, lb, hb]) => even(`${a} and ${b}`, 'linear', [oklch(la, 0.15, ha), oklch(lb, 0.15, hb)])), groups:[]})],
  ['radial-glows', 'Radial Glows', () => ({swatches:HUES.map(([n, h]) => { const c = oklch(0.78, 0.2, h); return [`${n} Glow`, {kind:'radial', stops:[[0, '#ffffff'], [0.25, c], [1, c]], opacity:[1, 1, 0]}]; }), groups:[]})]];
const LIBS = SWATCH_LIBS.concat(GRADIENT_LIBS), _libCache = {};
const library = id => { const d = LIBS.find(x => x[0] === id); if (!d) return null; return _libCache[id] || (_libCache[id] = Object.assign({id, name:d[1]}, d[2]())); };
AiWindow.library = library;
reg('ai.window.swatchLibrary', '{library: id（web-safe-216|grays-neutrals|earth-tones|skin-tone-ramps|pastels|brights|metallic-gradients|perceptual-scales|harmony-sets|spectrum-gradients|sky-gradients|neutral-gradients|duotone-gradients|radial-glows）| null（关）} 窗口 ▸ 色板库 ▸ 这个库：开色板库面板（library_panel.rs:119-133）→ {ok, open, name, count}', p => {
  if (p.library === null){ P.close('aiSwatchLib'); return {ok:true, open:false}; }
  const L = library(p.library); if (!L) return err('window.swatchLibrary', `unknown library \`${p.library}\``);
  AiWindow.libOpen = L.id; P.close('aiSwatchLib'); P.open('aiSwatchLib');
  return {ok:true, open:true, name:L.name, count:L.swatches.length + L.groups.reduce((a, g) => a + g[1].length, 0)};
}, false);
reg('ai.swatch.library.add', '{library, names:[色板名…], apply?:"fill"|"stroke"} 色板库：加进文件色板（apply＝顺便套到选取）→ {ok, added}', p => {
  const L = library(p.library); if (!L) return err('swatch.library.add', 'unknown library');
  const all = L.swatches.concat(L.groups.flatMap(g => g[1])), pick = all.filter(s => (p.names || []).includes(s[0]));
  if (!pick.length) return err('swatch.library.add', 'no such swatches');
  const list = swList(); let n = 0; pick.forEach(s => { if (!list.some(x => x[0] === s[0])){ list.push(clone(s)); n++; } });
  if (p.apply === 'fill' || p.apply === 'stroke') applyPaint(pick[0][1], p.apply === 'stroke', pick[0][0]);
  return {ok:true, added:n};
});

/* 存储色板库…（dialogs/save_swatch_library.rs：名称、格式 .vcswatches／.gpl／.css；color/src/palette_io.rs）、其它库…（读 .vcswatches／.gpl） */
function paletteText(name, list, fmt){
  const solid = list.filter(s => typeof s[1] === 'string' && s[1] !== 'none');
  if (fmt === 'gpl') return `GIMP Palette\nName: ${name}\nColumns: 10\n#\n` + solid.map(s => { const c = hexRgb(s[1]); return `${String(c[0]).padStart(3)} ${String(c[1]).padStart(3)} ${String(c[2]).padStart(3)}\t${s[0]}`; }).join('\n') + '\n';
  if (fmt === 'css') return ':root {\n' + solid.map(s => `  --${s[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'swatch'}: ${s[1]};`).join('\n') + '\n}\n';
  return JSON.stringify({format:'dilin-swatches', name, swatches:list.map(s => ({name:s[0], paint:s[1]}))}, null, 1);
}
reg('ai.ui.saveSwatchLibrary', '{name?, format?:"vcswatches|gpl|css"="vcswatches", dialog?:true} 窗口 ▸ 色板库 ▸ 存储色板…：把文件的色板存成色板库档（下载）→ {ok, bytes}', p => {
  if (p.dialog){ P.dialog({id:'aiSaveSw', title:L3('儲存色票', '存储色板', 'Save Swatch Library'), fields:[{k:'name', type:'text', label:L3('名稱：', '名称：', 'Name:'), value:'Untitled'},
    {k:'format', type:'select', label:L3('格式：', '格式：', 'Format:'), value:'vcswatches', options:[['vcswatches', 'Swatches (.vcswatches)'], ['gpl', 'GPL Palette (.gpl)'], ['css', 'CSS Custom Properties (.css)']]},
    {type:'note', label:L3('GPL 色盤只保留實色（RGB）。', 'GPL 调色板只保留实色（RGB）。', 'GPL palettes keep solid colours only, as RGB.')}], ok:v => CMD.run('ai.ui.saveSwatchLibrary', v)}); return {ok:true, dialog:'saveSwatchLibrary'}; }
  const fmt = ['vcswatches', 'gpl', 'css'].includes(p.format) ? p.format : 'vcswatches', name = p.name || 'Untitled', txt = paletteText(name, swList().concat(SW.groups.flatMap(g => g[1])), fmt);
  download(new Blob([txt], {type:'text/plain'}), `${name}.${fmt}`); return {ok:true, bytes:txt.length};
}, false);
function parsePalette(name, text){
  try { const j = JSON.parse(text); if (j && Array.isArray(j.swatches)) return {name:j.name || name, swatches:j.swatches.map(s => [s.name, s.paint || s.color]).filter(s => s[1])}; } catch(e){}
  const sw = []; String(text).split(/\r?\n/).forEach(l => { const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/.exec(l); if (m) sw.push([m[4].trim() || rgbHex(+m[1], +m[2], +m[3]), rgbHex(+m[1], +m[2], +m[3])]); });
  return sw.length ? {name, swatches:sw} : null;
}
reg('ai.window.swatchLibrary.other', '{text?, name?}（不给 text＝开档案挑选器）窗口 ▸ 色板库 ▸ 其它库…：读 .vcswatches／.gpl 当色板库打开 → {ok, name, count}', p => {
  const openLib = (name, text) => { const L = parsePalette(name, text); if (!L) return err('swatchLibrary.other', 'not a swatch library');
    const id = 'file:' + L.name; _libCache[id] = {id, name:L.name, swatches:L.swatches, groups:[]}; if (!LIBS.some(x => x[0] === id)) LIBS.push([id, L.name, () => _libCache[id]]);
    AiWindow.libOpen = id; P.close('aiSwatchLib'); P.open('aiSwatchLib'); return {ok:true, name:L.name, count:L.swatches.length}; };
  if (typeof p.text === 'string') return openLib(p.name || 'Library', p.text);
  const inp = el('input', {type:'file', accept:'.vcswatches,.gpl,.json,text/plain', style:'display:none'});
  inp.onchange = () => { const f = inp.files[0]; if (f) f.text().then(t => openLib(f.name.replace(/\.[^.]+$/, ''), t)); inp.remove(); };
  document.body.appendChild(inp); inp.click(); return {ok:true, dialog:'filePicker'};
}, false);

/* ═══════════ 颜色参考／颜色主题（color/src/harmony.rs） ═══════════ */
function hsbOf(hex){ const [r, g, b] = hexRgb(hex).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d){ h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return [h, mx ? d / mx : 0, mx]; }
function hsbHex(h, s, v){ h = ((h % 360) + 360) % 360 / 60; const c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.min(5, Math.floor(h))]; return rgbHex((r + m) * 255, (g + m) * 255, (b + m) * 255); }
const t_ = turn => [turn, 1, 1], soft = turn => [turn, 0.5, 1], deep = turn => [turn, 1, 0.6], hc = turn => [turn, 1, 'c'], sv = (turn, s, v) => [turn, s, v];
const RULES = {'Complementary':[t_(0), t_(180)], 'Complementary 2':[t_(0), soft(0), t_(180), soft(180)], 'Split Complementary':[t_(0), t_(150), t_(210)], 'Left Complement':[t_(0), t_(-30), t_(150)],
  'Right Complement':[t_(0), t_(30), t_(210)], 'Analogous':[t_(0), t_(30), t_(-30)], 'Analogous 2':[t_(0), t_(30), t_(60), t_(-30), t_(-60)],
  'Monochromatic':[t_(0), sv(0, 0.5, 1), sv(0, 1, 0.6), sv(0, 0.25, 1), sv(0, 1, 0.35)], 'Shades':[t_(0), sv(0, 1, 0.8), sv(0, 1, 0.6), sv(0, 1, 0.4), sv(0, 1, 0.2)],
  'Triad':[t_(0), t_(120), t_(240)], 'Triad 2':[t_(0), t_(120), soft(120), t_(240), soft(240)], 'Triad 3':[t_(0), t_(120), deep(120), t_(240), deep(240)],
  'Tetrad':[t_(0), t_(60), t_(180), t_(240)], 'Tetrad 2':[t_(0), t_(90), t_(180), t_(270)], 'Tetrad 3':[t_(0), t_(30), t_(180), t_(210)], 'Compound':[t_(0), t_(40), t_(160), t_(200)],
  'Compound 2':[t_(0), t_(-40), t_(160), t_(200)], 'High Contrast':[t_(0), hc(180)], 'High Contrast 2':[t_(0), hc(0), t_(180), hc(180)], 'High Contrast 3':[t_(0), hc(120), hc(240)],
  'Pentagram':[t_(0), t_(72), t_(144), t_(216), t_(288)]};
const Harmony = AiWindow.harmony = {
  rules: Object.keys(RULES),
  apply(rule, base){ const [h, s, v] = hsbOf(base), T0 = RULES[rule] || RULES.Complementary;
    return [base].concat(T0.slice(1).map(([turn, sat, br]) => hsbHex(h + turn, clamp(s * sat, 0, 1), clamp(br === 'c' ? (v >= 0.5 ? v * 0.3 : 0.7 + 0.3 * v) : v * br, 0, 1)))); },
  /* harmony.rs:300-319 variation：深浅＝往黑／白内插、冷暖＝往 (0.2,0.45,1)／(1,0.55,0.1) 内插×0.6、鲜艳＝饱和度往 0／1 */
  variation(c, step, o){ if (!step) return c; const f = Math.min(1, Math.abs(step) / Math.max(1, o.steps)) * (0.1 + 0.8 * clamp(o.amount, 0, 100) / 100), a = hexRgb(c);
    const lerp = (b, k) => rgbHex(...a.map((v, i) => v + (b[i] - v) * k));
    if (o.variation === 'warmCool') return lerp(step < 0 ? [51, 114.75, 255] : [255, 140.25, 25.5], f * 0.6);
    if (o.variation === 'vividMuted'){ const [h, s, v] = hsbOf(c); return hsbHex(h, clamp(step < 0 ? s * (1 - f) : s + (1 - s) * f, 0, 1), v); }
    return lerp(step < 0 ? [0, 0, 0] : [255, 255, 255], f); }
};
const CG = AiWindow.colorGuide = {base:null, rule:'Complementary', opts:{variation:'tintsShades', steps:4, amount:50}};
reg('ai.colorGuide.get', '{base?:"#rrggbb"（缺省＝面板的基色）, rule?, variation?:"tintsShades|warmCool|vividMuted", steps?:1..20, amount?:0..100} 颜色参考 → {ok, base, rule, colors, grid}', p => {
  if (p.base) CG.base = p.base; if (p.rule){ if (!RULES[p.rule]) return err('colorGuide', 'unknown rule'); CG.rule = p.rule; }
  ['variation', 'steps', 'amount'].forEach(k => { if (p[k] !== undefined) CG.opts[k] = p[k]; });
  const base = CG.base || '#e67828', colors = Harmony.apply(CG.rule, base), n = clamp(CG.opts.steps | 0, 1, 20);
  return {ok:true, base, rule:CG.rule, colors, grid:colors.map(c => Array.from({length:2 * n + 1}, (_, i) => Harmony.variation(c, i - n, CG.opts)))};
}, false);

reg('ai.colorGuide.saveSwatches', '{group?:bool=true} 颜色参考：把和谐颜色存成颜色组（▦ 钮）或一个个色板（菜单 ▸ 将颜色存储为色板）→ {ok, count}', p => {
  const r = CMD.map['ai.colorGuide.get'].run({}); swList();
  if (p.group !== false){ SW.groups.push([uniqName(SW.groups.map(g => ({name:g[0]})), CG.rule), r.colors.map((c, i) => [`${CG.rule} ${i + 1}`, c])]); }
  else r.colors.forEach(c => { if (!swList().some(s => s[1] === c)) swList().push([c.toUpperCase(), c]); });
  P.refresh('aiSwatches'); return {ok:true, count:r.colors.length};
}, false);
/* 颜色主题（color_themes.rs 菜单：编辑主题、添加到色板、删除主题、存储主题） */
reg('ai.colorTheme.save', '{name?, colors?:[…]（缺省＝建立页目前的 5 色）, rule?} 存储主题到「我的主题」→ {ok, name}', p => {
  const cols = Array.isArray(p.colors) && p.colors.length ? p.colors : AiWindow.themeColors(); const name = String(p.name || CT.name || '').trim() || `Theme ${CT.mine.length + 1}`;
  CT.mine.push({name, colors:cols, rule:p.rule || CT.rule}); try { localStorage.setItem('dlAiThemes', JSON.stringify(CT.mine)); } catch(e){} return {ok:true, name};
}, false);
reg('ai.colorTheme.delete', '{name} 删除主题 → {ok}', p => { const i = CT.mine.findIndex(t => t.name === p.name); if (i < 0) return err('colorTheme.delete', 'no such theme'); CT.mine.splice(i, 1); try { localStorage.setItem('dlAiThemes', JSON.stringify(CT.mine)); } catch(e){} return {ok:true}; }, false);
reg('ai.colorTheme.addToSwatches', '{name?（缺省＝建立页目前的）} 主题加进色板（一个颜色组）→ {ok}', p => {
  const th = p.name ? CT.mine.find(t => t.name === p.name) : {name:CT.name || CT.rule, colors:AiWindow.themeColors()}; if (!th) return err('colorTheme.addToSwatches', 'no such theme');
  swList(); SW.groups.push([th.name, th.colors.map((c, i) => [`${th.name} ${i + 1}`, c])]); P.refresh('aiSwatches'); return {ok:true};
}, false);

/* ═══════════ 符号、图形样式（存在这份文件里；不进工程档） ═══════════ */
const store = k => { if (Doc._aiWinSerial !== Doc.serial){ Doc._aiWinSerial = Doc.serial; Doc.aiSymbols = []; Doc.aiGraphicStyles = [{name:'Default Graphic Style', look:{fill:'#ffffff', stroke:'#000000', strokeWidth:1}}]; } return Doc[k]; };
const LOOK_KEYS = ['fill', 'stroke', 'strokeWidth', 'opacity', 'blend', 'cap', 'join', 'dash', 'miterLimit', 'effects', 'strokeAlign', 'startArrow', 'endArrow', 'arrowScale', 'arrowAlign', 'profile', 'profileFlip', 'brush', 'apStack'];
reg('ai.symbol.new', '{name?, replace?:bool=true} 符号面板 ＋：把选中的物件存成符号（replace＝选中的图稿换成这个符号的第一个实例）→ {ok, name}', p => {
  const t = sel(p); if (!t.R.length) return err('symbol.new', 'nothing selected'); const S = store('aiSymbols');
  const name = p.name || uniqName(S, 'New Symbol'); S.push({name, shapes:clone(t.R).map(x => { delete x.symbol; return x; }), x:t.L.x, y:t.L.y}); AiWindow.curSymbol = name;
  if (p.replace !== false){ t.R.forEach(x => { const i = t.L.data.shapes.indexOf(x); if (i >= 0) t.L.data.shapes.splice(i, 1); }); const n = symbolArt(S[S.length - 1]); shiftShape(n, 0, 0); t.L.data.shapes.push(n); VecSel.setShapes(t.L.id, [n.id]); Layer.invalidate(t.L); }   // 原码：选中的图稿变成第一个实例
  return {ok:true, name};
});
reg('ai.symbol.place', '{name} 符号面板 ▸ 置入符号实例：复制一份放进目前的矢量层 → {ok, ids}', p => {
  const s = store('aiSymbols').find(x => x.name === p.name); if (!s) return err('symbol.place', 'no such symbol');
  let L = Doc.active(); if (!L || L.kind !== 'vector') return err('symbol.place', 'select a vector layer');
  const n = symbolArt(s); shiftShape(n, s.x - L.x, s.y - L.y); L.data.shapes.push(n); const ids = [n.id];       // 实例＝一个物件（多个形状包成编组），带 symbol 名
  VecSel.setShapes(L.id, ids); Layer.invalidate(L); return {ok:true, ids};
});
reg('ai.symbol.delete', '{name} 删除符号 → {ok}', p => { const S = store('aiSymbols'), i = S.findIndex(x => x.name === p.name); if (i < 0) return err('symbol.delete', 'no such symbol'); S.splice(i, 1); return {ok:true}; }, false);
reg('ai.graphicStyle.new', '{name?} 图形样式面板 ＋：选中物件的外观（填色、描边、不透明度、混合、效果）存成样式 → {ok, name}', p => {
  const t = sel(p); if (!t.R.length) return err('graphicStyle.new', 'nothing selected'); const G = store('aiGraphicStyles'), s = leaves(t.R[0])[0], look = {};
  LOOK_KEYS.forEach(k => { if (s[k] !== undefined) look[k] = clone(s[k]); }); const name = p.name || `Graphic Style ${G.length}`; G.push({name, look}); return {ok:true, name};
}, false);
reg('ai.graphicStyle.apply', '{name, add?:bool} 套用图形样式到选中物件 → {ok}', p => {
  const g = store('aiGraphicStyles').find(x => x.name === p.name); if (!g) return err('graphicStyle.apply', 'no such style');
  const t = sel(p); if (!t.R.length) return err('graphicStyle.apply', 'nothing selected');
  t.R.flatMap(leaves).forEach(s => { if (!p.add) LOOK_KEYS.forEach(k => { if (k !== 'fill' && k !== 'stroke') delete s[k]; }); Object.assign(s, clone(g.look)); s.graphicStyle = g.name; });
  return done(t.L);
});
reg('ai.graphicStyle.delete', '{name} 删除图形样式（用到它的物件保留外观、不再链接）→ {ok}', p => { const G = store('aiGraphicStyles'), i = G.findIndex(x => x.name === p.name); if (i <= 0) return err('graphicStyle.delete', 'cannot delete');
  G.splice(i, 1); eachShape(s => { if (s.graphicStyle === p.name){ delete s.graphicStyle; return true; } }); return {ok:true}; }, false);
/* 走遍所有矢量层的物件（含编组成员）：fn 回 true＝改到了 ⇒ 那层重画 */
function eachShape(fn){ Doc.layers.forEach(L => { if (L.kind !== 'vector') return; let hit = false; const walk = s => { if (fn(s, L)) hit = true; if (Array.isArray(s.children)) s.children.forEach(walk); }; L.data.shapes.forEach(walk); if (hit) Layer.invalidate(L); }); }
const uniqName = (list, base) => { let n = base, k = 2; while (list.some(x => x.name === n)) n = `${base} ${k++}`; return n; };
/* 图形样式面板菜单（graphic_styles.rs menu） */
reg('ai.graphicStyle.duplicate', '{name} 复制图形样式 → {ok, name}', p => { const G = store('aiGraphicStyles'), g = G.find(x => x.name === p.name); if (!g) return err('graphicStyle.duplicate', 'no such style');
  const name = uniqName(G, g.name + ' copy'); G.splice(G.indexOf(g) + 1, 0, {name, look:clone(g.look)}); return {ok:true, name}; }, false);
reg('ai.graphicStyle.breakLink', '{} 断开图形样式的链接：选中物件外观留着、不再跟样式走 → {ok}', p => { const t = sel(p); if (!t.R.length) return err('graphicStyle.breakLink', 'nothing selected'); t.R.flatMap(leaves).forEach(s => delete s.graphicStyle); return done(t.L); });
reg('ai.graphicStyle.unused', '{} 选择所有未使用的样式 → {ok, names}', () => { const used = new Set(); eachShape(s => { if (s.graphicStyle) used.add(s.graphicStyle); }); const names = store('aiGraphicStyles').filter((g, i) => i > 0 && !used.has(g.name)).map(g => g.name); AiWindow.gsSel = names; return {ok:true, names}; }, false);
reg('ai.graphicStyle.sortByName', '{} 按名称排序（默认样式留第一个）→ {ok}', () => { const G = store('aiGraphicStyles'), rest = G.slice(1).sort((a, b) => a.name.localeCompare(b.name)); G.splice(1, G.length - 1, ...rest); return {ok:true}; }, false);
reg('ai.graphicStyle.redefine', '{name} 重新定义图形样式：换成选中物件的外观；用到它的物件跟着改 → {ok, updated}', p => {
  const g = store('aiGraphicStyles').find(x => x.name === p.name); if (!g) return err('graphicStyle.redefine', 'no such style'); const t = sel(p); if (!t.R.length) return err('graphicStyle.redefine', 'nothing selected');
  const s0 = leaves(t.R[0])[0], look = {}; LOOK_KEYS.forEach(k => { if (s0[k] !== undefined) look[k] = clone(s0[k]); }); g.look = look; let n = 0;
  eachShape(s => { if (s.graphicStyle === g.name && !s.children){ LOOK_KEYS.forEach(k => { if (k !== 'fill' && k !== 'stroke') delete s[k]; }); Object.assign(s, clone(look)); n++; return true; } }); return {ok:true, updated:n};
});
reg('ai.graphicStyle.merge', '{names:[…]（≥2）} 合并图形样式：留第一个的外观、名字接起来，用到其余的改用合并后那个 → {ok, name}', p => {
  const G = store('aiGraphicStyles'), L = (p.names || []).map(n => G.find(x => x.name === n)).filter(Boolean); if (L.length < 2) return err('graphicStyle.merge', 'select two or more styles');
  const name = uniqName(G.filter(x => !L.includes(x)), L.map(x => x.name).join(' ')), look = clone(L[0].look), old = L.map(x => x.name);
  L.forEach(x => G.splice(G.indexOf(x), 1)); G.push({name, look}); eachShape(s => { if (old.includes(s.graphicStyle)){ s.graphicStyle = name; return true; } }); AiWindow.gsSel = [name]; return {ok:true, name};
});
reg('ai.graphicStyle.rename', '{name, to} 图形样式选项…：改名（用到它的物件跟着）→ {ok}', p => { const G = store('aiGraphicStyles'), g = G.find(x => x.name === p.name), to = String(p.to || '').trim(); if (!g) return err('graphicStyle.rename', 'no such style');
  if (!to || G.some(x => x.name === to)) return err('graphicStyle.rename', 'name is empty or taken'); g.name = to; eachShape(s => { if (s.graphicStyle === p.name){ s.graphicStyle = to; return true; } }); AiWindow.gsSel = [to]; return {ok:true}; }, false);
reg('ai.graphicStyle.list', '{} → {ok, styles:[{name, look}], used:[名…]}', () => { const used = new Set(); eachShape(s => { if (s.graphicStyle) used.add(s.graphicStyle); }); return {ok:true, styles:clone(store('aiGraphicStyles')), used:[...used]}; }, false);
/* 符号面板（symbols.rs）：实例＝放进来的物件带 symbol:<名字>（多个物件放成一个编组），才能选实例、断开链接、替换、重新定义 */
reg('ai.symbol.duplicate', '{name} 复制符号 → {ok, name}', p => { const S = store('aiSymbols'), s = S.find(x => x.name === p.name); if (!s) return err('symbol.duplicate', 'no such symbol'); const name = uniqName(S, s.name + ' copy'); S.splice(S.indexOf(s) + 1, 0, Object.assign(clone(s), {name})); return {ok:true, name}; }, false);
reg('ai.symbol.rename', '{name, to} 符号选项…：改名（实例跟着）→ {ok}', p => { const S = store('aiSymbols'), s = S.find(x => x.name === p.name), to = String(p.to || '').trim(); if (!s) return err('symbol.rename', 'no such symbol');
  if (!to || S.some(x => x.name === to)) return err('symbol.rename', 'name is empty or taken'); s.name = to; eachShape(x => { if (x.symbol === p.name){ x.symbol = to; return true; } }); if (AiWindow.curSymbol === p.name) AiWindow.curSymbol = to; return {ok:true}; }, false);
reg('ai.symbol.selectInstances', '{name} 选择所有实例（目前图层里的）→ {ok, ids}', p => { const L = Doc.active(); if (!L || L.kind !== 'vector') return err('symbol.selectInstances', 'select a vector layer'); const ids = L.data.shapes.filter(s => s.symbol === p.name).map(s => s.id); VecSel.setShapes(L.id, ids); if (window.UI) UI.refresh(); return {ok:true, ids}; }, false);
reg('ai.symbol.breakLink', '{} 断开符号链接：选中的实例变回一般图稿 → {ok}', p => { const t = sel(p), R = t.R.filter(s => s.symbol); if (!R.length) return err('symbol.breakLink', 'select a symbol instance'); R.forEach(s => delete s.symbol); return done(t.L); });
function symbolArt(s, at){
  const shapes = s.shapes.map(sh => { const c = clone(sh); c.id = 'S' + Math.random().toString(36).slice(2, 9); return c; });
  let node = shapes.length === 1 ? shapes[0] : {id:'S' + Math.random().toString(36).slice(2, 9), type:'group', children:shapes};
  node.symbol = s.name; return node;
}
reg('ai.symbol.replace', '{name} 替换符号：选中的实例换成这个符号（左上角对齐原实例）→ {ok, ids}', p => {
  const S = store('aiSymbols').find(x => x.name === p.name); if (!S) return err('symbol.replace', 'no such symbol'); const t = sel(p), R = t.R.filter(s => s.symbol); if (!R.length) return err('symbol.replace', 'select a symbol instance');
  const ids = R.map(old => { const b = bounds(t.L, old, false), n = symbolArt(S), L = t.L; L.data.shapes.splice(L.data.shapes.indexOf(old), 1, n); const nb = bounds(L, n, false); if (b && nb) shiftShape(n, b.x0 - nb.x0, b.y0 - nb.y0); return n.id; });
  VecSel.setShapes(t.L.id, ids); return done(t.L);
});
reg('ai.symbol.redefine', '{name} 重新定义符号：换成选中的图稿；所有图层里的实例跟着换（左上角不动）→ {ok, updated}', p => {
  const S = store('aiSymbols').find(x => x.name === p.name); if (!S) return err('symbol.redefine', 'no such symbol'); const t = sel(p), art = t.R.filter(s => s.symbol !== p.name); if (!art.length) return err('symbol.redefine', 'select the new art');
  S.shapes = clone(art).map(s => { delete s.symbol; return s; }); S.x = t.L.x; S.y = t.L.y; let n = 0;
  Doc.layers.forEach(L => { if (L.kind !== 'vector') return; L.data.shapes.forEach((old, i) => { if (old.symbol !== p.name) return; const b = bounds(L, old, false), nn = symbolArt(S); L.data.shapes[i] = nn; const nb = bounds(L, nn, false); if (b && nb) shiftShape(nn, b.x0 - nb.x0, b.y0 - nb.y0); n++; }); Layer.invalidate(L); });
  return {ok:true, updated:n};
});
reg('ai.symbol.list', '{} → {ok, symbols:[{name, shapes:n, instances:n}]}', () => { const c = {}; eachShape(s => { if (s.symbol) c[s.symbol] = (c[s.symbol] || 0) + 1; }); return {ok:true, symbols:store('aiSymbols').map(s => ({name:s.name, shapes:s.shapes.length, instances:c[s.name] || 0}))}; }, false);

/* 图形样式库（doc/src/style_libs.rs:146-252）：「阴影和发光」9 个照抄（一层填色、第一层描边、效果交给 ai-effect）；
   其余 5 个库靠多层填色／描边堆叠（双线、三线、偏移描边…），我们的物件只有一层填色一层描边 ⇒ 没做 */
const SG = (opacity, x, y, blur, color) => ({id:'stylize.dropShadow', params:{mode:'multiply', opacity, x, y, blur, color}, visible:true});
const STYLE_LIBS = {'shadows-glows':['Shadows and Glows', [
  ['Soft Shadow', {fill:'#f4f1ea', stroke:'none', effects:[SG(45, 4, 4, 6, '#1d1b2a')]}],
  ['Hard Shadow', {fill:'#ffd166', stroke:'#1d1b2a', strokeWidth:2, effects:[{id:'stylize.dropShadow', params:{mode:'normal', opacity:100, x:5, y:5, blur:0, color:'#1d1b2a'}, visible:true}]}],
  ['Lifted Card', {fill:'#ffffff', stroke:'#d9d9e3', strokeWidth:0.5, effects:[SG(30, 0, 8, 12, '#2b2d42')]}],
  ['Halo', {fill:'#2b2d42', stroke:'none', effects:[{id:'stylize.outerGlow', params:{mode:'normal', opacity:90, blur:8, color:'#8ecae6'}, visible:true}]}],
  ['Neon Tube', {fill:'none', stroke:'#ff4fd8', strokeWidth:4, cap:'round', join:'round', effects:[{id:'stylize.outerGlow', params:{mode:'normal', opacity:85, blur:7, color:'#ff4fd8'}, visible:true}]}],
  ['Inner Light', {fill:'#3a86ff', stroke:'none', effects:[{id:'stylize.innerGlow', params:{mode:'screen', opacity:70, blur:9, color:'#ffffff', source:'center'}, visible:true}]}],
  ['Ember', {fill:'#e85d04', stroke:'none', effects:[{id:'stylize.innerGlow', params:{mode:'screen', opacity:80, blur:6, color:'#ffba08', source:'edge'}, visible:true}, {id:'stylize.outerGlow', params:{mode:'normal', opacity:70, blur:5, color:'#dc2f02'}, visible:true}]}],
  ['Feathered', {fill:'#8338ec', stroke:'none', effects:[{id:'stylize.feather', params:{radius:6}, visible:true}]}],
  ['Haze', {fill:'#06d6a0', stroke:'none', opacity:0.8, effects:[{id:'blur.gaussian', params:{radius:3}, visible:true}]}]]]};
reg('ai.window.graphicStyleLibrary', '{library:"shadows-glows"|null} 窗口 ▸ 图形样式库 ▸ 这个库：开库面板（点一个＝加进图形样式并套到选取）→ {ok, open, name, count}', p => {
  if (p.library === null){ P.close('aiStyleLib'); return {ok:true, open:false}; }
  const L = STYLE_LIBS[p.library]; if (!L) return err('window.graphicStyleLibrary', `unknown library \`${p.library}\``);
  AiWindow.styleLibOpen = p.library; P.close('aiStyleLib'); P.open('aiStyleLib'); return {ok:true, open:true, name:L[0], count:L[1].length};
}, false);
reg('ai.graphicStyle.addFromLibrary', '{library, name, apply?:bool=true, add?:bool} 图形样式库：加进文件的图形样式，apply＝顺便套到选取 → {ok}', p => {
  const L = STYLE_LIBS[p.library]; if (!L) return err('graphicStyle.addFromLibrary', 'unknown library'); const s = L[1].find(x => x[0] === p.name); if (!s) return err('graphicStyle.addFromLibrary', 'no such style');
  const G = store('aiGraphicStyles'); if (!G.some(g => g.name === s[0])) G.push({name:s[0], look:clone(s[1])});
  if (p.apply !== false && sel().R.length) return CMD.map['ai.graphicStyle.apply'].run({name:s[0], add:!!p.add});
  return {ok:true};
});
P.define('aiStyleLib', {title:L3('繪圖樣式資料庫', '图形样式库', 'Graphic Style Library'), w:250,
  refresh(b){ b.innerHTML = ''; const L = STYLE_LIBS[AiWindow.styleLibOpen]; if (!L) return; const box = P.els.aiStyleLib; if (box) box.querySelector('.dlp-t').textContent = L[0];
    const g = el('div', {class:'grid'}); b.appendChild(g);
    L[1].forEach(([n, look]) => g.appendChild(el('div', {class:'sw', title:n, dataset:{name:n}, style:`width:40px;height:40px;background:${look.fill !== 'none' ? look.fill : '#fff'};border:${Math.min(4, look.strokeWidth || 0)}px solid ${look.stroke && look.stroke !== 'none' ? look.stroke : 'transparent'}`,
      onclick:e => { runCmd('ai.graphicStyle.addFromLibrary', {library:AiWindow.styleLibOpen, name:n, add:e.altKey}); P.refresh('aiGraphicStyles'); }}))); }});

/* ═══════════ 文档信息（engine/src/cmd/docinfo.rs） ═══════════ */
reg('ai.document.info', '{selectionOnly?:bool} 文档信息：文件、物件计数、字体 → {ok, document, objects, fonts}', p => {
  const c = {Paths:0, 'Compound Paths':0, Groups:0, 'Clipping Masks':0, 'Text Objects':0, Images:0, 'Gradient Objects':0, 'Gradient Meshes':0, 'Objects with Effects':0, Guides:0};
  const walk = s => { if (s.type === 'group'){ c.Groups++; if (s.clip) c['Clipping Masks']++; s.children.forEach(walk); return; } if (s.type === 'compound') c['Compound Paths']++; else if (s.type === 'mesh') c['Gradient Meshes']++; else c.Paths++;
    if (s.guide) c.Guides++; if ((s.fill && typeof s.fill === 'object') || (s.stroke && typeof s.stroke === 'object')) c['Gradient Objects']++; if (Array.isArray(s.effects) && s.effects.length) c['Objects with Effects']++; };
  const t = p.selectionOnly ? sel() : null, fonts = new Set();
  Doc.layers.forEach(L => { if (L.kind === 'vector') (t ? (t.L === L ? t.R : []) : L.data.shapes).forEach(walk); else if (!t && L.kind === 'text'){ c['Text Objects']++; fonts.add(L.data.font); } else if (!t) c.Images++; });
  return {ok:true, document:{Name:T(L3('未命名', '未标题', 'Untitled')), 'Color Mode':'RGB', Units:'Pixels', Artboards:`1 (${Doc.width} × ${Doc.height})`, Swatches:swList().length}, objects:c, fonts:[...fonts]};
}, false);

/* ═══════════ CSS 属性（crates/svg/src/css.rs：units px、dimensions 开、position 关） ═══════════ */
reg('ai.css.selection', '{position?:bool=false, dimensions?:bool=true} CSS 属性面板：选中物件的 CSS → {ok, css}', p => {
  const t = sel(p); if (!t.R.length) return {ok:true, css:''};
  const out = t.R.slice(0, 300).map((s, i) => { const b = bounds(t.L, s, false) || {x0:0, y0:0, x1:0, y1:0}, lines = [];
    const cls = '.' + (s.name || `st${i}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    if (p.position === true){ lines.push('position: absolute;', `left: ${Math.round(b.x0)}px;`, `top: ${Math.round(b.y0)}px;`); }
    if (p.dimensions !== false){ lines.push(`width: ${Math.round(b.x1 - b.x0)}px;`, `height: ${Math.round(b.y1 - b.y0)}px;`); }
    if (typeof s.fill === 'string' && s.fill !== 'none') lines.push(`background: ${s.fill};`);
    else if (s.fill && typeof s.fill === 'object' && Array.isArray(s.fill.stops)) lines.push(`background: linear-gradient(${s.fill.stops.map(q => `${q.color} ${Math.round((q.offset || 0) * 100)}%`).join(', ')});`);
    if (s.stroke && s.stroke !== 'none' && s.strokeWidth > 0) lines.push(`border: ${s.strokeWidth}px ${s.dash ? 'dashed' : 'solid'} ${typeof s.stroke === 'string' ? s.stroke : '#000'};`);
    if (s.type === 'ellipse') lines.push('border-radius: 50%;'); else if (s.radius) lines.push(`border-radius: ${s.radius}px;`);
    if (s.opacity !== undefined && s.opacity < 1) lines.push(`opacity: ${+s.opacity.toFixed(2)};`); if (s.blend && s.blend !== 'normal') lines.push(`mix-blend-mode: ${BLEND[s.blend].replace('source-over', 'normal')};`);
    return `${cls} {\n  ${lines.join('\n  ')}\n}`; });
  return {ok:true, css:out.join('\n\n')};
}, false);

/* ═══════════ 分色预览（separations.rs：CMYK 各版的眼睛；借 PsProof 的合成 CMYK） ═══════════ */
const Sep = AiWindow.separations = {on:false, plates:{C:true, M:true, Y:true, K:true}};
/* 视图菜单单（menus/impl/ai-view.js，先载）已登记 ai.view.separationsPreview＝正本（状态 AiView.separations、版名用全名、画面查表在 AiView.viewComposite）。
   有它就不再另登记一份（以前后载的这份把它盖掉，视图 ▸ 校样设置 ▸ 自定… 就失效）：这里只把面板的 C/M/Y/K 短名、all 换成它认的参数，
   面板读的 Sep.on／Sep.plates 改成照 AiView.separations 算；自己那套 PsProof 叠画（hookSep）也不挂，免得画两次 */
const SEPN = {C:'Cyan', M:'Magenta', Y:'Yellow', K:'Black'};
const viewSep = CMD.map['ai.view.separationsPreview'];
const sepShared = !!(viewSep && window.AiView);
if (sepShared){
  const run0 = viewSep.run;
  viewSep.run = function(p){
    p = Object.assign({}, p || {});
    ['toggle', 'only'].forEach(k => { if (SEPN[p[k]]) p[k] = SEPN[p[k]]; });
    if (p.all){ delete p.all; if (p.on === false) p = {on:false}; else { delete p.toggle; delete p.only; p.plates = Object.values(SEPN); } }
    const r = run0.call(this, p);
    if (window.UI && UI.canvas) UI.draw();
    return r;
  };
  viewSep.params = (viewSep.params || '') + '；版名也收 C|M|Y|K 短名，{all:true} ＝四版全开（分色预览面板用）';
  Object.defineProperty(Sep, 'on', {get:() => !!AiView.separations, set(){}});
  Object.defineProperty(Sep, 'plates', {get:() => { const s = AiView.separations; const o = {}; Object.entries(SEPN).forEach(([k, n]) => { o[k] = !s || s.includes(n); }); return o; }, set(){}});
}
if (!sepShared) reg('ai.view.separationsPreview', '{on?:bool, toggle?:"C|M|Y|K", only?:"C|M|Y|K", all?:true} 分色预览：打开后画面用合成铜版纸 CMYK 分色、只印勾着的版 → {ok, on, plates}', p => {
  if (typeof p.on === 'boolean') Sep.on = p.on;
  if (p.toggle && Sep.plates[p.toggle] !== undefined){ Sep.plates[p.toggle] = !Sep.plates[p.toggle]; Sep.on = true; }
  if (p.only && Sep.plates[p.only] !== undefined){ Object.keys(Sep.plates).forEach(k => Sep.plates[k] = k === p.only); Sep.on = true; }
  if (p.all) Object.keys(Sep.plates).forEach(k => Sep.plates[k] = true);
  if (window.UI) UI.draw(); return {ok:true, on:Sep.on, plates:Object.assign({}, Sep.plates)};
}, false);
function hookSep(){
  if (sepShared || !window.UI || UI.__aiSepHook) return; UI.__aiSepHook = true;
  const prev = UI.viewComposite;
  UI.viewComposite = function(s, target){
    const out = prev ? prev.apply(this, arguments) : composite(s, target);
    if (Sep.on && window.Menubar && Menubar.app === 'ai' && window.PsProof){ const m = Object.keys(Sep.plates).filter(k => Sep.plates[k]).join('') || '-'; try { PsProof.apply(target, {kind:'plates:' + m, name:'working-cmyk', intent:'relative', bpc:true}, null); } catch(e){ console.error(e); } }
    return out;
  };
}
if (window.UI && UI.canvas) hookSep(); else window.addEventListener('DOMContentLoaded', () => setTimeout(hookSep, 0));

/* ═══════════ 画笔（brushes.rs：brush.list／apply／setCurrent／remove／new／duplicate／delete、object.expandBrush） ═══════════ */
const brushTargets = p => { const t = sel(p); return {t, R:t.R.flatMap(leaves).filter(s => s.type !== 'mesh')}; };
reg('ai.brush.list', '{} 画笔面板的画笔 → {ok, brushes:[{name, type}], current}', () => ({ok:true, brushes:brushList().map(b => ({name:b.name, type:b.type})), current:BR.current}), false);
reg('ai.brush.get', '{name} 一支画笔的定义 → {ok, brush}', p => { const b = brushList().find(x => x.name === p.name); return b ? {ok:true, brush:clone(Object.assign({}, b, {art:typeof b.art === 'string' ? b.art : '(custom)'}))} : err('ai.brush.get', 'no such brush'); }, false);
reg('ai.brush.apply', '{name, ids?} 点画笔＝选中物件的描边换成这支画笔（没描边＝黑 1pt）→ {ok, ids}', p => {
  const b = brushList().find(x => x.name === p.name); if (!b) return err('ai.brush.apply', `no brush \`${p.name}\``); const {t, R} = brushTargets(p); if (!R.length) return err('ai.brush.apply', 'nothing selected');
  R.forEach(s => { s.brush = b.name; if (!s.stroke || s.stroke === 'none' || typeof s.stroke !== 'string') s.stroke = '#000000'; if (!(s.strokeWidth > 0)) s.strokeWidth = 1; }); BR.current = b.name; return done(t.L);
});
reg('ai.brush.setCurrent', '{name|null} 没选东西时点画笔＝之后画的路径用它（画笔工具的目前画笔）→ {ok}', p => { if (p.name !== null && !brushList().some(x => x.name === p.name)) return err('ai.brush.setCurrent', 'no such brush'); BR.current = p.name; return {ok:true}; }, false);
reg('ai.brush.remove', '{ids?} 移去画笔描边（选中物件回一般描边）→ {ok}', p => { const {t, R} = brushTargets(p); const H = R.filter(s => s.brush); if (!H.length) return err('ai.brush.remove', 'the selection has no brush stroke'); H.forEach(s => delete s.brush); return done(t.L); });
reg('ai.brush.new', '{type:"art"|"scatter"|"pattern"="art", name?} 新建画笔：选中的图稿当画笔图稿（艺术画笔沿路径拉长、散布画笔沿路径撒、图案画笔沿路径铺）→ {ok, name}', p => {
  const t = sel(p); if (!t.R.length) return err('ai.brush.new', 'select the art for the brush'); const type = ['art', 'scatter', 'pattern'].includes(p.type) ? p.type : 'art';
  const art = []; t.R.flatMap(leaves).forEach(s => { const subs = flat(s, 1); if (!subs.length) return; art.push({polys:subs.map(x => x.pts), color:typeof s.fill === 'string' && s.fill !== 'none' ? s.fill : typeof s.stroke === 'string' && s.stroke !== 'none' ? s.stroke : '#000000', rule:s.type === 'compound' && s.rule === 'evenodd' ? 'evenodd' : 'nonzero'}); });
  const box = artBox(art), cx = type === 'scatter' ? (box.x0 + box.x1) / 2 : box.x0, cy = (box.y0 + box.y1) / 2;
  art.forEach(it => { it.polys = it.polys.map(P => P.map(([x, y]) => [x - cx, y - cy])); });
  const kind = {art:'Art Brush', scatter:'Scatter Brush', pattern:'Pattern Brush'}[type], name = p.name || uniqName(brushList(), kind + ' 1').replace(/ 1 (\d+)$/, ' $1');
  brushList().push(Object.assign({name, type, art}, type === 'scatter' ? {spacing:[100, 100]} : type === 'pattern' ? {fit:'stretch'} : {})); return {ok:true, name};
}, false);
reg('ai.brush.duplicate', '{name} 复制画笔 → {ok, name}', p => { const L = brushList(), b = L.find(x => x.name === p.name); if (!b) return err('ai.brush.duplicate', 'no such brush'); const name = uniqName(L, b.name + ' copy'); L.splice(L.indexOf(b) + 1, 0, Object.assign(clone(b), {name})); return {ok:true, name}; }, false);
reg('ai.brush.delete', '{name} 删除画笔（用它的描边回一般描边）→ {ok}', p => { const L = brushList(), i = L.findIndex(x => x.name === p.name); if (i < 0) return err('ai.brush.delete', 'no such brush'); L.splice(i, 1); eachShape(s => { if (s.brush === p.name){ delete s.brush; return true; } }); if (BR.current === p.name) BR.current = null; return {ok:true}; });
reg('ai.brush.view', '{mode?:"thumbnail"|"list", show?:{calligraphic?,scatter?,art?,bristle?,pattern?}} 画笔面板菜单：缩图／列表视图、显示哪几类 → {ok}', p => {
  if (p.mode === 'thumbnail' || p.mode === 'list') BR.view = p.mode; if (p.show) Object.entries(p.show).forEach(([k, v]) => { BR.hidden = BR.hidden.filter(x => x !== k); if (!v) BR.hidden.push(k); }); return {ok:true, view:BR.view, hidden:BR.hidden.slice()}; }, false);
reg('ai.brush.expand', '{ids?} 扩展画笔描边（object.expandBrush）：画笔画出来的形状变成真的路径（编组），原路径删掉 → {ok, ids}', p => {
  const t = sel(p), R = t.R.filter(s => s.brush); if (!R.length) return err('ai.brush.expand', 'select a brush stroke'); const S = t.L.data.shapes, out = [];
  R.forEach(s => { const b = brushList().find(x => x.name === s.brush); if (!b) return;
    const kids = brushPieces(b, s, 1).map(pc => { const polys = pc.line ? [] : pc.polys.filter(P => P.length >= 3);
      if (pc.line){ return {id:'S' + Math.random().toString(36).slice(2, 9), type:'path', points:pc.line, closed:false, fill:'none', stroke:pc.color, strokeWidth:pc.width, opacity:pc.alpha, cap:'round', join:'round'}; }
      const sub = P => ({id:'S' + Math.random().toString(36).slice(2, 9), type:'bezier', closed:true, anchors:P.map(([x, y]) => ({x, y, in:null, out:null}))});
      return polys.length === 1 ? Object.assign(sub(polys[0]), {fill:pc.color, stroke:'none', strokeWidth:0}) : {id:'S' + Math.random().toString(36).slice(2, 9), type:'compound', rule:pc.rule === 'evenodd' ? 'evenodd' : 'nonzero', children:polys.map(sub), fill:pc.color, stroke:'none', strokeWidth:0}; });
    const g = {id:'S' + Math.random().toString(36).slice(2, 9), type:'group', children:kids}; S.splice(S.indexOf(s), 1, g); out.push(g.id); });
  VecSel.setShapes(t.L.id, out); return done(t.L);
});

/* ═══════════ 外观（appearance.rs：多层填色／描边、复制项目、移去项目、显示／隐藏、清除、简化至基本外观） ═══════════ */
const apOf = s => Array.isArray(s.apStack) && s.apStack.length ? s.apStack : [{kind:'fill', primary:true}, {kind:'stroke', primary:true}];
/* 外观看的选取连编组里面的（编组选择／直接选择工具点进编组选到的成员，VecSel.shapes 放的是深层 id）：
   AI 外观面板选到编组里的路径＝列出 编组 ▸ 路径 的描边／填色，就地改那一个成员 */
function selDeep(p){
  p = p || {};
  const L = p.layerId ? Doc.byId(p.layerId) : (window.VecSel && VecSel.layer());
  if (!L || L.kind !== 'vector') return {L:null, R:[], up:new Map()};
  const ids = Array.isArray(p.ids) ? p.ids : (window.VecSel ? VecSel.shapes : []), R = [], up = new Map();
  const walk = (arr, par) => arr.forEach(s => { if (par) up.set(s, par); if (ids.includes(s.id)) R.push(s); if (s.type === 'group' && Array.isArray(s.children)) walk(s.children, s); });
  walk(L.data.shapes, null);
  return {L, R, up};
}
AiWindow.selDeep = selDeep;
const apTargets = p => { const t = selDeep(p); return {t, R:t.R.filter(s => s.type !== 'group' && s.type !== 'mesh')}; };
const apItemPaint = (s, it) => it.primary ? (it.kind === 'fill' ? s.fill : s.stroke) : it.paint;
reg('ai.appearance.list', '{} 选中第一个物件的外观堆叠（由上到下，跟面板一样）→ {ok, items:[{index, kind, paint, width?, visible, opacity, primary}], effects}', () => {
  const {R} = apTargets({}), s = R[0]; if (!s) return {ok:true, items:[]}; const st = apOf(s);
  return {ok:true, items:st.map((it, i) => ({index:st.length - 1 - i, kind:it.kind, paint:clone(apItemPaint(s, it)), width:it.kind === 'stroke' ? (it.primary ? s.strokeWidth || 0 : it.width) : undefined, visible:it.visible !== false, opacity:it.opacity === undefined ? 1 : it.opacity, primary:!!it.primary})).reverse(), effects:clone(s.effects || [])};
}, false);
reg('ai.appearance.addFill', '{paint?（缺省＝目前填色）} 添加新填色（放在最上面）→ {ok}', p => { const {t, R} = apTargets(p); if (!R.length) return err('ai.appearance.addFill', 'nothing selected');
  R.forEach(s => { s.apStack = apOf(s).slice(); s.apStack.push({kind:'fill', paint:p.paint || (typeof s.fill === 'string' && s.fill !== 'none' ? s.fill : ((document.getElementById('fillColor') || {}).value || '#000000'))}); }); return done(t.L); });
reg('ai.appearance.addStroke', '{paint?, width?} 添加新描边（放在最上面）→ {ok}', p => { const {t, R} = apTargets(p); if (!R.length) return err('ai.appearance.addStroke', 'nothing selected');
  R.forEach(s => { s.apStack = apOf(s).slice(); s.apStack.push({kind:'stroke', paint:p.paint || (typeof s.stroke === 'string' && s.stroke !== 'none' ? s.stroke : ((document.getElementById('strokeColor') || {}).value || '#000000')), width:p.width === undefined ? Math.max(1, s.strokeWidth || 1) : Math.max(0, +p.width)}); }); return done(t.L); });
const apIdx = (s, i) => { const st = apOf(s); i = +i; return i >= 0 && i < st.length ? st.length - 1 - i : -1; };   // 面板序号（由上到下）→ 堆叠序号（由下到上）
reg('ai.appearance.duplicateItem', '{index（面板由上到下的序号，见 ai.appearance.list）} 复制项目（复制品放在它上面）→ {ok}', p => { const {t, R} = apTargets(p); const s = R[0]; if (!s) return err('ai.appearance.duplicateItem', 'nothing selected');
  const k = apIdx(s, p.index); if (k < 0) return err('ai.appearance.duplicateItem', 'no such item'); const st = apOf(s).slice(), it = st[k];
  const c = it.primary ? {kind:it.kind, paint:clone(apItemPaint(s, it)), width:it.kind === 'stroke' ? s.strokeWidth : undefined, visible:it.visible, opacity:it.opacity} : clone(it);
  st.splice(k + 1, 0, c); s.apStack = st; return done(t.L); });
reg('ai.appearance.removeItem', '{index} 移去项目（原本那层填色／描边＝改成无）→ {ok}', p => { const {t, R} = apTargets(p); const s = R[0]; if (!s) return err('ai.appearance.removeItem', 'nothing selected');
  const k = apIdx(s, p.index); if (k < 0) return err('ai.appearance.removeItem', 'no such item'); const st = apOf(s).slice(), it = st[k];
  if (it.primary){ if (it.kind === 'fill') s.fill = 'none'; else { s.stroke = 'none'; s.strokeWidth = 0; } } else st.splice(k, 1); s.apStack = st; if (st.every(x => x.primary && x.visible !== false && x.opacity === undefined)) delete s.apStack; return done(t.L); });
reg('ai.appearance.setItem', '{index, visible?, paint?, width?, opacity?:0..100} 改一层：眼睛（显示／隐藏）、颜色、粗细、不透明度 → {ok}', p => { const {t, R} = apTargets(p); const s = R[0]; if (!s) return err('ai.appearance.setItem', 'nothing selected');
  const k = apIdx(s, p.index); if (k < 0) return err('ai.appearance.setItem', 'no such item'); const st = apOf(s).map(x => Object.assign({}, x)), it = st[k];
  if (typeof p.visible === 'boolean') it.visible = p.visible; if (p.opacity !== undefined) it.opacity = clamp(+p.opacity, 0, 100) / 100;
  if (p.paint !== undefined){ if (it.primary) s[it.kind] = p.paint; else it.paint = p.paint; }
  if (p.width !== undefined){ if (it.primary) s.strokeWidth = Math.max(0, +p.width); else it.width = Math.max(0, +p.width); }
  s.apStack = st; return done(t.L); });
reg('ai.appearance.moveItem', '{from, to}（面板序号）拖动一层改堆叠次序 → {ok}', p => { const {t, R} = apTargets(p); const s = R[0]; if (!s) return err('ai.appearance.moveItem', 'nothing selected');
  const a = apIdx(s, p.from), b = apIdx(s, p.to); if (a < 0 || b < 0) return err('ai.appearance.moveItem', 'no such item'); const st = apOf(s).slice(); const [it] = st.splice(a, 1); st.splice(b, 0, it); s.apStack = st; return done(t.L); });
reg('ai.appearance.clear', '{} 清除外观：填色、描边都无，效果、额外的填色／描边都拿掉 → {ok}', p => { const {t, R} = apTargets(p); if (!R.length) return err('ai.appearance.clear', 'nothing selected');
  R.forEach(s => { s.fill = 'none'; s.stroke = 'none'; s.strokeWidth = 0; ['apStack', 'effects', 'opacity', 'blend', 'brush', 'profile', 'startArrow', 'endArrow', 'dash', 'graphicStyle'].forEach(k => delete s[k]); }); return done(t.L); });
reg('ai.appearance.reduceToBasic', '{} 简化至基本外观：只留原本那层填色＋描边（额外的层、效果拿掉）→ {ok}', p => { const {t, R} = apTargets(p); if (!R.length) return err('ai.appearance.reduceToBasic', 'nothing selected');
  R.forEach(s => { delete s.apStack; delete s.effects; delete s.graphicStyle; }); return done(t.L); });
reg('ai.appearance.showAllHidden', '{} 显示所有隐藏的属性（眼睛全开）→ {ok}', p => { const {t, R} = apTargets(p); if (!R.length) return err('ai.appearance.showAllHidden', 'nothing selected');
  R.forEach(s => { if (s.apStack) s.apStack.forEach(x => delete x.visible); (s.effects || []).forEach(e => { e.visible = true; }); }); return done(t.L); });
AiWindow.newArtBasic = true;
reg('ai.appearance.setNewArtBasic', '{on?} 新图稿具有基本外观（勾）→ {ok, on}', p => ({ok:true, on:(AiWindow.newArtBasic = typeof p.on === 'boolean' ? p.on : !AiWindow.newArtBasic)}), false);

/* ═══════════ 链接（links.rs：我们的「置入图像」＝像素层／智能对象；L.src＝云盘引用＝链接，否则＝嵌入） ═══════════ */
const linkLayers = () => Doc.layers.filter(L => L.kind === 'raster' || L.kind === 'smart').slice().reverse();
function linkInfo(L){
  const errs = (window.Project && Project.lastLoadErrors) || [], miss = errs.some(e => e.layerId === L.id);
  const w = L.kind === 'raster' ? L.data.canvas.width : (L.data && L.data.source && (window.Doc && Doc.smartSources) ? (Doc.smartSources[L.data.source.id] || {}).w : null) || Doc.width;
  const h = L.kind === 'raster' ? L.data.canvas.height : (L.data && L.data.source && Doc.smartSources ? (Doc.smartSources[L.data.source.id] || {}).h : null) || Doc.height;
  const linked = !!(L.src && L.src.file_id) || !!(L.kind === 'smart' && L.data && L.data.source && Doc.smartSources && Doc.smartSources[L.data.source.id] && Doc.smartSources[L.data.source.id].linked);
  return {id:L.id, name:L.name, kind:L.kind, status:miss ? 'missing' : linked ? 'linked' : 'embedded', fileId:L.src ? L.src.file_id : null, width:w, height:h, x:L.x, y:L.y, ppi:72, format:'PNG', colorSpace:'RGB'};
}
reg('ai.links.list', '{show?:"all|missing|modified|embedded"} 链接面板：文件里置入的影像（像素层、智能对象）→ {ok, links:[{id, name, status:"linked|embedded|missing", width, height, …}]}', p => {
  let L = linkLayers().map(linkInfo); if (p.show && p.show !== 'all') L = L.filter(x => p.show === 'embedded' ? x.status === 'embedded' : p.show === 'missing' ? x.status === 'missing' : false); return {ok:true, links:L};
}, false);
reg('ai.links.goTo', '{id} 转至链接：选这层、视图对准它 → {ok}', p => { const L = Doc.byId(p.id); if (!L) return err('ai.links.goTo', 'no such layer'); CMD.run('layer.select', {id:L.id}); if (CMD.map['ps.view.fitLayersOnScreen']) CMD.run('ps.view.fitLayersOnScreen', {layerIds:[L.id]}); return {ok:true}; }, false);
reg('ai.links.embed', '{id?（缺省＝目前层）} 嵌入影像：云盘引用拿掉、像素存进档案（智能对象：链接档改嵌入）→ {ok}', p => {
  const L = p.id ? Doc.byId(p.id) : Doc.active(); if (!L || (L.kind !== 'raster' && L.kind !== 'smart')) return err('ai.links.embed', 'select a placed image (raster layer)');
  if (L.kind === 'smart'){ const c = CMD.map['layer.smartObjects.convertToEmbedded']; if (c){ const sel0 = Doc.activeId; Doc.activeId = L.id; try { return c.run({id:L.id}); } finally { if (Doc.byId(sel0)) Doc.activeId = sel0; } } return err('ai.links.embed', 'smart-object embed command missing'); }
  if (!L.src) return err('ai.links.embed', 'already embedded'); if (window.DilinCanvas && DilinCanvas.setLayerSource) DilinCanvas.setLayerSource(L.id, null); else delete L.src; return {ok:true};
});
reg('ai.links.relink', '{id?, url?: 图片网址或 dataURL（不给＝开档案挑选器）, file_id?} 重新链接…：换掉这层的影像（同大小放回原位置）→ {ok}', p => {
  const L = p.id ? Doc.byId(p.id) : Doc.active(); if (!L || (L.kind !== 'raster' && L.kind !== 'smart')) return err('ai.links.relink', 'select a placed image (raster layer)');
  if (L.kind === 'smart'){ const c = CMD.map['layer.smartObjects.relinkToFile']; return c ? c.run(Object.assign({}, p, {id:L.id})) : err('ai.links.relink', 'smart-object relink command missing'); }
  const put = url => new Promise(res => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => { History.push && History.push(); const c = L.data.canvas, x = L.data.ctx || c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); if (p.file_id && DilinCanvas.setLayerSource) DilinCanvas.setLayerSource(L.id, {file_id:p.file_id}); Layer.invalidate(L); if (window.UI) UI.refresh(); res(true); }; img.onerror = () => res(false); img.src = url; });
  if (typeof p.url === 'string'){ AiWindow.lastRelink = put(p.url); return {ok:true, pending:true}; }
  const inp = el('input', {type:'file', accept:'image/*', style:'display:none'}); inp.onchange = () => { const f = inp.files[0]; if (f) AiWindow.lastRelink = put(URL.createObjectURL(f)); inp.remove(); }; document.body.appendChild(inp); inp.click(); return {ok:true, dialog:'filePicker'};
}, false);
reg('ai.links.update', '{id?} 更新链接（重载云盘引用；没有引用＝不用更新）→ {ok}', p => { const L = p.id ? Doc.byId(p.id) : Doc.active(); if (!L || !L.src) return {ok:true, updated:false};
  const h = window.__dlSiteHooks; if (!h || !h.resolveRef) return err('ai.links.update', 'no host resolveRef hook to reload the link'); const src = clone(L.src);
  AiWindow.lastRelink = Promise.resolve(h.resolveRef(src)).then(u => CMD.map['ai.links.relink'].run({id:L.id, url:typeof u === 'string' ? u : u && u.url, file_id:src.file_id})); return {ok:true, updated:true, pending:true}; }, false);

/* ═══════════ 资源导出（asset_export.rs；资源本身在 ai-object.js 的 ai.assets.*）：每个资源照「导出设定」的格式列（PNG／JPG／SVG × 倍率 × 后缀）各出一个档 ═══════════ */
const AE = AiWindow.assetExport = {formats:[{format:'png', scale:1, suffix:''}], sel:[]};
function assetSVG(a){
  const hs = (a.nodes || []).map(id => window.AiR3 && AiR3.findDeep ? AiR3.findDeep(id) : null).filter(Boolean); if (!hs.length) return null;
  const b = hs.map(h => AIObj.shapeBounds(h.s, docF(h.L), true)).reduce((r, x) => !x ? r : !r ? x : {x0:Math.min(r.x0, x.x0), y0:Math.min(r.y0, x.y0), x1:Math.max(r.x1, x.x1), y1:Math.max(r.y1, x.y1)}, null); if (!b) return null;
  const esc = v => String(v).replace(/[<>&"]/g, c => ({'<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;'}[c]));
  const body = hs.map(h => Project._svgLayer({id:h.L.id, kind:'vector', visible:true, opacity:1, x:h.L.x, y:h.L.y, data:{shapes:[h.s]}}, null, esc, () => '')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(b.x1 - b.x0)}" height="${Math.ceil(b.y1 - b.y0)}" viewBox="${b.x0} ${b.y0} ${b.x1 - b.x0} ${b.y1 - b.y0}">\n${body}</svg>`;
}
reg('ai.assets.exportAs', '{assets?:[资源 id…]（缺省＝面板选的，没选＝全部）, formats?:[{format:"png"|"jpg"|"svg", scale?:倍率, suffix?}]（缺省＝面板的导出设定）, render?:bool（true＝不下载、回内容给 agent）} 资源导出面板 ▸ 导出 → {ok, files:[{name, width?, height?, dataURL?|svg?}]}', p => {
  const all = (peek('ai.assets.list') || {}).assets || []; if (!all.length) return err('ai.assets.exportAs', 'no assets yet: collect art for export first (ai.assets.add)');
  const ids = Array.isArray(p.assets) ? p.assets.map(Number) : AE.sel.length ? AE.sel : all.map(a => a.id), fm = Array.isArray(p.formats) && p.formats.length ? p.formats : AE.formats, files = [];
  const A = (window.AiR3 && AiR3.doc ? AiR3.doc('assets').list : []).filter(a => ids.includes(a.id));
  for (const a of A) for (const f of fm){
    const fmt = ['png', 'jpg', 'svg'].includes(f.format) ? f.format : 'png', scale = Math.max(0.01, +f.scale || 1), name = a.name + (f.suffix || (scale !== 1 && fmt !== 'svg' ? `@${scale}x` : '')) + '.' + fmt;
    if (fmt === 'svg'){ const svg = assetSVG(a); if (!svg) continue; const o = {name}; if (p.render) o.svg = svg; else download(new Blob([svg], {type:'image/svg+xml'}), name); files.push(o); continue; }
    let c = AiR3.renderAsset(a, scale); if (!c) continue;
    if (fmt === 'jpg'){ const j = document.createElement('canvas'); j.width = c.width; j.height = c.height; const x = j.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, j.width, j.height); x.drawImage(c, 0, 0); c = j; }
    const mime = fmt === 'jpg' ? 'image/jpeg' : 'image/png', o = {name, width:c.width, height:c.height};
    if (p.render) o.dataURL = c.toDataURL(mime); else c.toBlob(bl => { if (bl) download(bl, name); }, mime, 0.92);
    files.push(o);
  }
  return {ok:true, files};
}, false);
reg('ai.assets.settings', '{formats?:[{format, scale, suffix}], select?:[资源 id…]} 资源导出面板的导出设定（格式列）与选取 → {ok, formats, selected}', p => {
  if (Array.isArray(p.formats)) AE.formats = p.formats.filter(f => f && ['png', 'jpg', 'svg'].includes(f.format)).map(f => ({format:f.format, scale:Math.max(0.01, +f.scale || 1), suffix:String(f.suffix || '')}));
  if (!AE.formats.length) AE.formats = [{format:'png', scale:1, suffix:''}]; if (Array.isArray(p.select)) AE.sel = p.select.map(Number); return {ok:true, formats:clone(AE.formats), selected:AE.sel.slice()};
}, false);

/* ═══════════ 文档信息「存储…」、CSS 复制／导出（doc_info.rs、css_properties.rs 菜单） ═══════════ */
reg('ai.document.info.save', '{selectionOnly?, render?} 文档信息面板菜单 ▸ 存储…：存成文字档（下载；render＝回文字）→ {ok, text}', p => {
  const r = CMD.map['ai.document.info'].run({selectionOnly:!!p.selectionOnly}), lines = ['Document:'].concat(Object.entries(r.document).map(([k, v]) => `  ${k}: ${v}`), ['Objects:'], Object.entries(r.objects).map(([k, v]) => `  ${k}: ${v}`), ['Fonts:'], r.fonts.length ? r.fonts.map(f => '  ' + f) : ['  None']);
  const text = lines.join('\n') + '\n'; if (!p.render) download(new Blob([text], {type:'text/plain'}), 'Document Info.txt'); return {ok:true, text};
}, false);
reg('ai.css.export', '{all?:bool（全部矢量物件；缺省＝选中的）, position?, dimensions?, render?} CSS 属性面板菜单 ▸ 导出所选 CSS…／全部导出…（下载 .css）→ {ok, css}', p => {
  let css;
  if (p.all){ const parts = []; Doc.layers.forEach(L => { if (L.kind !== 'vector') return; const r = CMD.map['ai.css.selection'].run({position:p.position, dimensions:p.dimensions, layerId:L.id, ids:L.data.shapes.map(s => s.id)}); if (r.css) parts.push(r.css); }); css = parts.join('\n\n'); }
  else css = CMD.map['ai.css.selection'].run({position:p.position, dimensions:p.dimensions}).css;
  if (!css) return err('ai.css.export', 'no CSS (select art)'); if (!p.render) download(new Blob([css + '\n'], {type:'text/css'}), p.all ? 'styles.css' : 'selection.css'); return {ok:true, css};
}, false);

/* ═══════════ OpenType（opentype.rs：数字样式＋7 个开关；存在文字层 data.features，跟 PS 文字单的 ps.type.openType.* 同一份；canvas 画得出来的只有标准连字） ═══════════ */
const OTF = [['liga', 'Standard Ligatures', '標準連字', '标准连字'], ['calt', 'Contextual Alternates', '依上下文替代字', '上下文替代字'], ['dlig', 'Discretionary Ligatures', '自由連字', '自由连字'], ['swsh', 'Swash', '花飾字', '花饰字'],
  ['smcp', 'Small Caps', '小型大寫字', '小型大写字母'], ['ordn', 'Ordinals', '序數字', '序数字'], ['frac', 'Fractions', '分數字', '分数字']];
const FIGS = ['Default Figure', 'Tabular Lining', 'Proportional Oldstyle', 'Tabular Oldstyle'];
const textTargetL = () => { const L = Doc.active(); return L && L.kind === 'text' ? L : null; };
reg('ai.text.setFeatures', '{figure?:"' + FIGS.join('|') + '", liga?, calt?, dlig?, swsh?, smcp?, ordn?, frac?:bool, reset?:true, layerId?} OpenType 面板 → {ok, features}', p => {
  const L = p.layerId ? Doc.byId(p.layerId) : textTargetL(); if (!L || L.kind !== 'text') return err('ai.text.setFeatures', 'select a text object');
  const f = p.reset ? {} : Object.assign({}, L.data.features);
  OTF.forEach(([k]) => { if (typeof p[k] === 'boolean') f[k] = p[k]; });
  if (p.figure !== undefined){ const i = FIGS.indexOf(p.figure); if (i < 0) return err('ai.text.setFeatures', 'figure must be one of ' + FIGS.join(', ')); f.tnum = i === 1 || i === 3; f.onum = i >= 2; }
  L.data.features = f; Layer.invalidate(L); return {ok:true, features:clone(f)};
});

/* ═══════════ 面板 ═══════════ */
/* 文件一改／每帧（why＝doc|draw）时正在面板里打字 ⇒ 先别重画（会把输入框砍掉）；面板自己按钮叫的 P.refresh(id) 照画 */
const busy = (b, why) => (why === 'doc' || why === 'draw' || why === 'open') && P.typing(b);
const selInfo = () => { const t = sel(); return {t, n:t.R.length, first:t.R.length ? leaves(t.R[0])[0] : null}; };
const AI = id => () => window.Menubar && Menubar.app === 'ai' ? id : id;
void AI;
function swatchEl(v, title, onclick, extra){
  const bgc = typeof v === 'object' ? `linear-gradient(90deg,${v.stops.map(s => s[1] + ' ' + Math.round(s[0] * 100) + '%').join(',')})` : v === 'none' ? 'linear-gradient(45deg,#fff 45%,#e33 45%,#e33 55%,#fff 55%)' : v;
  return el('div', Object.assign({class:'sw', title, style:`background:${bgc}`, onclick}, extra || {}));
}
/* 对齐（align.rs） */
const AL = {to:'selection', preview:false};
const HO = AiWindow.hideOptions = {};          // 各面板菜单「隐藏选项」
const hideItem = id => ({label:HO[id] ? L3('顯示選項', '显示选项', 'Show Options') : L3('隱藏選項', '隐藏选项', 'Hide Options'), run:() => { HO[id] = !HO[id]; P.refresh(id); }});
P.define('aiAlign', {title:L3('對齊', '对齐', 'Align'), w:260,
  menu:() => [hideItem('aiAlign'), {sep:true}, {label:L3('使用預視邊界', '使用预览边界', 'Use Preview Bounds'), checked:AL.preview, run:() => { AL.preview = !AL.preview; }},
    {label:L3('取消關鍵物件', '取消关键对象', 'Cancel Key Object'), disabled:AL.to !== 'key', run:() => { runCmd('ai.select.key', {id:null}); AL.to = 'selection'; P.refresh('aiAlign'); }},
    {label:L3('對齊字符邊界', '对齐字形边界', 'Align to Glyph Bounds'), disabled:true, run(){}}],
  refresh(b){ b.innerHTML = ''; const {n, t} = selInfo();
    if (AL.to === 'key' && n && !keyValid()) runCmd('ai.select.key', {id:t.R[t.R.length - 1].id});      // 选「对齐关键对象」时先用最上面那个当关键对象（再从下面的清单换）
    const bnd = AL.preview ? 'preview' : undefined;
    const al = (k, v, ic, tip) => btn(ic, tip, () => runCmd('ai.object.align', Object.assign({[k]:v, bounds:bnd}, {to:n === 1 && AL.to === 'selection' ? 'artboard' : AL.to})), {disabled:n < 1, dataset:{al:k + ':' + v}});
    b.appendChild(el('div', {class:'hint', text:T(L3('對齊物件：', '对齐对象：', 'Align Objects:'))}));
    b.appendChild(el('div', {class:'grid'}, [al('horizontal', 'left', '⇤', L3('水平齊左', '水平左对齐', 'Horizontal Align Left')), al('horizontal', 'center', '⇹', L3('水平居中', '水平居中对齐', 'Horizontal Align Center')), al('horizontal', 'right', '⇥', L3('水平齊右', '水平右对齐', 'Horizontal Align Right')),
      al('vertical', 'top', '⤒', L3('垂直齊上', '垂直顶对齐', 'Vertical Align Top')), al('vertical', 'center', '⇳', L3('垂直居中', '垂直居中对齐', 'Vertical Align Center')), al('vertical', 'bottom', '⤓', L3('垂直齊下', '垂直底对齐', 'Vertical Align Bottom'))]));
    if (HO.aiAlign) return;
    const ds = (k, v, ic) => btn(ic, null, () => runCmd('ai.object.distribute', {[k]:v, bounds:bnd}), {disabled:n < 2, dataset:{ds:k + ':' + v}});
    b.appendChild(el('div', {class:'hint', text:T(L3('均分物件：', '分布对象：', 'Distribute Objects:'))}));
    b.appendChild(el('div', {class:'grid'}, [ds('vertical', 'top', '⤒'), ds('vertical', 'center', '⇳'), ds('vertical', 'bottom', '⤓'), ds('horizontal', 'left', '⇤'), ds('horizontal', 'center', '⇹'), ds('horizontal', 'right', '⇥')]));
    const sp = el('input', {type:'number', min:0, step:1, value:0, disabled:AL.to !== 'key'});
    b.appendChild(el('div', {class:'hint', text:T(L3('均分間距：', '分布间距：', 'Distribute Spacing:'))}));
    b.appendChild(el('div', {class:'grid'}, [btn('⇕', L3('垂直均分間距', '垂直分布间距', 'Vertical Distribute Space'), () => runCmd('ai.object.distributeSpacing', {axis:'vertical', spacing:AL.to === 'key' ? +sp.value : undefined}), {disabled:n < 2, dataset:{sp:'v'}}),
      btn('⇔', L3('水平均分間距', '水平分布间距', 'Horizontal Distribute Space'), () => runCmd('ai.object.distributeSpacing', {axis:'horizontal', spacing:AL.to === 'key' ? +sp.value : undefined}), {disabled:n < 2, dataset:{sp:'h'}}), sp]));
    b.appendChild(el('div', {class:'hint', text:T(L3('對齊：', '对齐：', 'Align To:'))}));
    b.appendChild(el('div', {class:'grid'}, [['selection', L3('對齊選取範圍', '对齐所选对象', 'Align to Selection')], ['key', L3('對齊關鍵物件', '对齐关键对象', 'Align to Key Object')], ['artboard', L3('對齊工作區域', '对齐画板', 'Align to Artboard')]]
      .map(([k, n2]) => btn(T(n2), null, () => { AL.to = k; if (k !== 'key') runCmd('ai.select.key', {id:null}); P.refresh('aiAlign'); if (window.UI) UI.draw(); }, {class:AL.to === k ? 'on' : '', dataset:{to:k}}))));
    if (AL.to === 'key'){
      const ks = el('select', {dataset:{k:'key'}, disabled:!n}); (t.R || []).forEach(s => ks.appendChild(el('option', {value:s.id, text:(s.name || s.type) + ' · ' + s.id})));
      const k0 = keyValid(); if (k0) ks.value = k0.id; ks.onchange = () => { runCmd('ai.select.key', {id:ks.value}); P.refresh('aiAlign'); };
      b.appendChild(row(L3('關鍵物件：', '关键对象：', 'Key Object:'), ks));
    }
  }});
/* 路径查找器（pathfinder.rs） */
P.define('aiPathfinder', {title:L3('路徑管理員', '路径查找器', 'Pathfinder'), w:260,
  // pathfinder.rs:65-77：陷印…、路径查找器选项…、建立／释放／扩展复合形状 原码就是灰的（menu_item(..., false, false)）
  menu:() => [{label:L3('補漏白…', '陷印…', 'Trap…'), disabled:true, run(){}},
    {label:AiWindow.lastPathfinder ? {'zh-Hant':'重複 ' + AiWindow.lastPathfinder, 'zh-Hans':'重复 ' + AiWindow.lastPathfinder, en:'Repeat ' + AiWindow.lastPathfinder} : L3('重複路徑管理員', '重复路径查找器', 'Repeat Pathfinder'), disabled:!AiWindow.lastPathfinder || !selInfo().n, run:() => runCmd('ai.object.pathfinder.' + AiWindow.lastPathfinder)},
    {label:L3('路徑管理員選項…', '路径查找器选项…', 'Pathfinder Options…'), disabled:true, run(){}}, {sep:true},
    {label:L3('製作複合形狀', '建立复合形状', 'Make Compound Shape'), disabled:true, run(){}}, {label:L3('釋放複合形狀', '释放复合形状', 'Release Compound Shape'), disabled:true, run(){}},
    {label:L3('展開複合形狀', '扩展复合形状', 'Expand Compound Shape'), disabled:true, run(){}}],
  refresh(b){ b.innerHTML = ''; const {n} = selInfo();
    const pb = ([op, , ic, name]) => btn(ic, name, () => runCmd('ai.object.pathfinder.' + op), {disabled:n < (op === 'divide' || op === 'outline' ? 1 : 2), dataset:{op}});
    b.appendChild(el('div', {class:'hint', text:T(L3('形狀模式：', '形状模式：', 'Shape Modes:'))}));
    b.appendChild(el('div', {class:'grid'}, PF.slice(0, 4).map(pb).concat([btn(T(L3('展開', '扩展', 'Expand')), L3('擴展套用在複合形狀（Alt+形狀模式）——規劃中', '扩展用于复合形状（Alt+形状模式）——规划中', 'Expand applies to compound shapes (Alt-click a shape mode) — on the roadmap'), null, {disabled:true})])));
    b.appendChild(el('div', {class:'hint', text:T(L3('路徑管理員：', '路径查找器：', 'Pathfinders:'))}));
    b.appendChild(el('div', {class:'grid'}, PF.slice(4).map(pb)));
  }});
/* 描边（stroke.rs） */
P.define('aiStroke', {title:L3('筆畫', '描边', 'Stroke'), w:270,
  refresh(b, _a, why){
    if (busy(b, why)) return;
    b.innerHTML = ''; const {n, first:s} = selInfo(), dis = !n;
    const w = el('select', {disabled:dis, dataset:{k:'weight'}}); [0.25, 0.5, 0.75, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].forEach(v => w.appendChild(el('option', {value:v, text:v + ' px'})));
    const wv = s ? (s.strokeWidth || 0) : 1; if (![...w.options].some(o => +o.value === wv)) w.insertBefore(el('option', {value:wv, text:wv + ' px'}), w.firstChild); w.value = wv;
    w.onchange = () => runCmd('ai.stroke.set', {weight:+w.value});
    b.appendChild(row(L3('寬度：', '粗细：', 'Weight:'), w));
    const seg = (k, opts, cur) => el('div', {class:'grid'}, opts.map(([v, ic, tip]) => btn(ic, tip, () => runCmd('ai.stroke.set', {[k]:v}), {disabled:dis, class:cur === v ? 'on' : '', dataset:{[k]:v}})));
    b.appendChild(row(L3('端點：', '端点：', 'Cap:'), seg('cap', [['butt', '⊢', L3('平端點', '平头端点', 'Butt Cap')], ['round', '◖', L3('圓端點', '圆头端点', 'Round Cap')], ['projecting', '⊏', L3('方形端點', '方头端点', 'Projecting Cap')]], s ? (s.cap || 'round') : null)));
    b.appendChild(row(L3('尖角：', '边角：', 'Corner:'), seg('join', [['miter', '⌜', L3('尖角', '斜接连接', 'Miter Join')], ['round', '◜', L3('圓角', '圆角连接', 'Round Join')], ['bevel', '⌌', L3('斜角', '斜角连接', 'Bevel Join')]], s ? (s.join || 'round') : null)));
    const ml = el('input', {type:'number', min:1, max:500, value:s && s.miterLimit || 10, disabled:dis || !(s && s.join === 'miter'), dataset:{k:'miterLimit'}}); ml.onchange = () => runCmd('ai.stroke.set', {miterLimit:+ml.value});
    b.appendChild(row(L3('限制：', '限制：', 'Limit:'), ml, el('span', {text:'x'})));
    const canAlign = !!(s && !isOpenShape(s)), al = s ? (s.strokeAlign || 'center') : null;
    b.appendChild(row(L3('對齊筆畫：', '对齐描边：', 'Align Stroke:'), el('div', {class:'grid'}, [['center', '▣', L3('筆畫置中對齊', '使描边居中对齐', 'Align Stroke to Center')], ['inside', '◘', L3('筆畫內側對齊', '使描边内侧对齐', 'Align Stroke to Inside')], ['outside', '◙', L3('筆畫外側對齊', '使描边外侧对齐', 'Align Stroke to Outside')]]
      .map(([v, ic, tip]) => btn(ic, tip, () => runCmd('ai.stroke.set', {align:v}), {disabled:dis || (v !== 'center' && !canAlign), class:al === v ? 'on' : '', dataset:{align:v}})))));
    if (HO.aiStroke) return;
    // 虚线（stroke.rs:174-219：六格 dash/gap；没给 gap＝跟 dash 一样；关掉时记住上次的格子）
    const dash = el('input', {type:'checkbox', disabled:dis, dataset:{k:'dashed'}}); dash.checked = !!(s && s.dash && s.dash.length);
    const last = AiWindow.dashLast || [12, null, null, null, null, null];
    const pattern = f => { const out = []; for (let i = 0; i < 3; i++){ const d0 = f[i * 2]; if (d0 === null || d0 === undefined || d0 === '') break; const g = f[i * 2 + 1]; out.push(Math.max(0, +d0), Math.max(0, g === null || g === undefined || g === '' ? +d0 : +g)); } return out.every(v => !v) ? [] : out; };
    dash.onchange = () => { if (!dash.checked){ AiWindow.dashLast = [0, 1, 2, 3, 4, 5].map(i => s && s.dash && s.dash[i] !== undefined ? s.dash[i] : null); runCmd('ai.stroke.set', {dash:null}); } else runCmd('ai.stroke.set', {dash:pattern(last), alignDashes:AiWindow.dashAlign !== false}); };
    const fit = !s || s.alignDashes !== false;
    b.appendChild(el('div', {class:'row'}, [el('label', {class:'row', style:'flex:1;margin:0'}, [dash, el('span', {text:T(L3('虛線', '虚线', 'Dashed Line'))})]),
      btn('┅', L3('保留虛線和間隔的精確長度', '保留虚线和间隙的精确长度', 'Exact dash lengths'), () => runCmd('ai.stroke.set', {alignDashes:false}), {disabled:!dash.checked, class:dash.checked && !fit ? 'on' : '', dataset:{dashAlign:'exact'}}),
      btn('┋', L3('將虛線與邊角和路徑終點對齊', '使虚线与边角和路径终端对齐', 'Fit dashes to corners and ends'), () => runCmd('ai.stroke.set', {alignDashes:true}), {disabled:!dash.checked, class:dash.checked && fit ? 'on' : '', dataset:{dashAlign:'fit'}})]));
    const d = el('div', {class:'grid'}); const vals = (s && s.dash) || [];
    for (let i = 0; i < 6; i++){ const f = el('input', {type:'number', min:0, value:vals[i] !== undefined ? vals[i] : '', placeholder:i % 2 ? T(L3('間隔', '间隙', 'gap')) : T(L3('虛線', '虚线', 'dash')), disabled:!dash.checked, style:'width:38px', dataset:{d:i}});
      f.onchange = () => { const arr = [...d.querySelectorAll('input')].map(x => x.value === '' ? null : +x.value); runCmd('ai.stroke.set', {dash:pattern(arr)}); }; d.appendChild(f); }
    b.appendChild(d);
    // 箭头（stroke.rs:221-264：起点／终点下拉（画出箭头预览）、互换、缩放（可链接）、对齐：延伸／箭尖在端点）
    const arrowSel = (k, start) => { const cur = s ? s[k] || null : null, bt = el('button', {class:'aiarrow', dataset:{arrow:k}, disabled:dis, title:T(start ? L3('起點', '起点', 'Start arrowhead') : L3('終點', '终点', 'End arrowhead')), style:'width:72px;height:22px;padding:0'});
      bt.appendChild(arrowPreview(cur, start, 62, 16)); bt.onclick = () => arrowMenu(bt, k, start, cur); return bt; };
    b.appendChild(row(L3('箭頭：', '箭头：', 'Arrowheads:'), arrowSel('startArrow', true), arrowSel('endArrow', false), btn('⇄', L3('互換起點和終點箭頭', '互换箭头起始处和结束处', 'Swap start and end arrowheads'), () => runCmd('ai.stroke.set', {swapArrows:true}), {disabled:dis, dataset:{act:'swapArrows'}})));
    const head = !!(s && (s.startArrow || s.endArrow)), sc = (s && s.arrowScale) || [100, 100];
    const scf = i => { const x = el('input', {type:'number', min:1, max:1000, value:sc[i], disabled:!head, style:'width:50px', dataset:{k:'arrowScale' + i}}); x.onchange = () => { const v = clamp(+x.value || 100, 1, 1000), a = sc.slice(); a[i] = v; if (AiWindow.arrowLink) a[1 - i] = v; runCmd('ai.stroke.set', {arrowScale:a}); }; return x; };
    b.appendChild(row(L3('縮放：', '缩放：', 'Scale:'), scf(0), el('span', {text:'%'}), scf(1), el('span', {text:'%'}), btn(AiWindow.arrowLink ? '🔗' : '⛓', L3('連結箭頭起點和終點縮放', '链接箭头起始处和结束处缩放', 'Link start and end arrowhead scales'), () => { AiWindow.arrowLink = !AiWindow.arrowLink; P.refresh('aiStroke'); }, {class:AiWindow.arrowLink ? 'on' : ''})));
    const aa = s && s.arrowAlign === 'tip' ? 'tip' : 'extend';
    b.appendChild(row(L3('對齊：', '对齐：', 'Align:'), btn('⇥', L3('延伸箭頭尖端超過路徑終點', '将箭头提示扩展到路径终点外', 'Tip extends past the end point'), () => runCmd('ai.stroke.set', {arrowAlign:'extend'}), {disabled:!head, class:head && aa === 'extend' ? 'on' : '', dataset:{arrowAlign:'extend'}}),
      btn('⇤', L3('將箭頭尖端放置於路徑終點', '将箭头提示放置于路径终点处', 'Tip on the end point'), () => runCmd('ai.stroke.set', {arrowAlign:'tip'}), {disabled:!head, class:head && aa === 'tip' ? 'on' : '', dataset:{arrowAlign:'tip'}})));
    // 宽度配置文件（stroke.rs:266-279：下拉画出轮廓、沿着翻转、横过翻转）
    const pf = el('button', {disabled:dis, dataset:{k:'profile'}, style:'width:110px;height:22px;padding:0', title:T(L3('可變寬度描述檔', '变量宽度配置文件', 'Variable Width Profile'))});
    pf.appendChild(profilePreview(s && s.profile, 100, 14)); pf.onclick = () => profileMenu(pf, s && s.profile);
    const canFlip = !!(s && s.profile);
    b.appendChild(row(L3('描述檔：', '配置文件：', 'Profile:'), pf, btn('↔', L3('沿著翻轉', '纵向翻转', 'Flip Along'), () => runCmd('ai.stroke.set', {flipProfile:'along'}), {disabled:!canFlip, dataset:{flip:'along'}}),
      btn('↕', L3('橫過翻轉', '横向翻转', 'Flip Across'), () => runCmd('ai.stroke.set', {flipProfile:'across'}), {disabled:!canFlip, dataset:{flip:'across'}})));
  },
  menu:() => { const s = selInfo().first, saved = !!(s && s.profile && profileEntries().some(e => !e.builtIn && e.id === profileId(s.profile)));
    return [hideItem('aiStroke'), {sep:true},
      {label:L3('新增至描述檔…', '添加到配置文件…', 'Add to Profiles…'), disabled:!(s && s.profile), run:() => P.dialog({id:'aiAddProfile', title:L3('可變寬度描述檔', '变量宽度配置文件', 'Variable Width Profile'), fields:[{k:'name', type:'text', label:L3('描述檔名稱：', '配置文件名称：', 'Profile Name:'), value:'Width Profile ' + (savedProfiles().length + 1)}], ok:v => CMD.run('ai.stroke.widthProfile.add', {name:v.name})})},
      {label:L3('刪除描述檔', '删除配置文件', 'Delete Profile'), disabled:!saved, run:() => runCmd('ai.stroke.widthProfile.delete')},
      {label:L3('重設描述檔', '重置配置文件', 'Reset Profiles'), disabled:!savedProfiles().length, run:() => runCmd('ai.stroke.widthProfile.reset')}]; }});
/* 箭头预览：白底小画布，照 arrow_doc（stroke.rs:284）画一条线＋箭头 */
function arrowPreview(kind, start, w, h){
  const dpr = 2, c = el('canvas', {width:w * dpr, height:h * dpr, style:`width:${w}px;height:${h}px;display:block;pointer-events:none`}), x = c.getContext('2d');
  x.scale(dpr, dpr); x.strokeStyle = x.fillStyle = '#ddd'; x.lineWidth = 1.5;
  if (!kind){ x.beginPath(); x.moveTo(3, h / 2); x.lineTo(w - 3, h / 2); x.stroke(); return c; }
  const hw = 1.5 * 500 / 3 / 100, ins = arrowInset(kind, hw, 0.75), tip = start ? [3, h / 2] : [w - 3, h / 2], dir = start ? [-1, 0] : [1, 0];
  x.beginPath(); x.moveTo(start ? 3 + ins : 3, h / 2); x.lineTo(start ? w - 3 : w - 3 - ins, h / 2); x.stroke();
  x.beginPath(); arrowPath(x, kind, tip, dir, hw); x.fill('nonzero'); return c;
}
function arrowMenu(anchor, key, start, cur){
  const pop = el('div', {class:'dlp-pop', style:'max-height:340px;overflow:auto;min-width:190px'});
  [null].concat(ARROWS).forEach(a => { const it = el('div', {class:'dlp-pi', dataset:{arrow:a || 'none'}, style:'display:flex;align-items:center;gap:8px' + (a === cur ? ';background:#2f7fd8;color:#fff' : ''),
    onclick:() => { pop.remove(); runCmd('ai.stroke.set', {[key]:a}); }}); it.appendChild(arrowPreview(a, start, 56, 14)); it.appendChild(el('span', {text:a ? ARROW_LABEL[a] : T(L3('無', '无', 'None'))})); pop.appendChild(it); });
  P.popup(pop, anchor);
}
function profilePreview(pts, w, h){
  const dpr = 2, c = el('canvas', {width:w * dpr, height:h * dpr, style:`width:${w}px;height:${h}px;display:block;pointer-events:none`}), x = c.getContext('2d'); x.scale(dpr, dpr);
  x.fillStyle = '#ddd'; x.beginPath(); const half = h / 2 - 1, n = 32, top = [], bot = [];
  for (let i = 0; i <= n; i++){ const t = i / n, [l, r] = pts ? profAt(pts, t) : [0.35, 0.35]; top.push([t * w, h / 2 - l * half]); bot.push([t * w, h / 2 + r * half]); }
  polyPath(x, top.concat(bot.reverse())); x.fill(); return c;
}
function profileMenu(anchor, cur){
  const pop = el('div', {class:'dlp-pop', style:'max-height:340px;overflow:auto;min-width:190px'}), cid = profileId(cur); let div = true;
  profileEntries().forEach(e => { if (!e.builtIn && div){ pop.appendChild(el('div', {class:'dlp-sep'})); div = false; }
    const it = el('div', {class:'dlp-pi', dataset:{profile:e.id}, style:'display:flex;align-items:center;gap:8px' + (e.id === cid ? ';background:#2f7fd8;color:#fff' : ''), onclick:() => { pop.remove(); runCmd('ai.stroke.set', {profile:e.id}); }});
    it.appendChild(profilePreview(e.id === 'uniform' ? null : e.points, 70, 14)); it.appendChild(el('span', {text:e.label})); pop.appendChild(it); });
  P.popup(pop, anchor);
}
/* 透明度（transparency.rs） */
P.define('aiTransparency', {title:L3('透明度', '透明度', 'Transparency'), w:250,
  refresh(b, _a, why){ if (busy(b, why)) return;
    b.innerHTML = ''; const {n, t} = selInfo(), s = n ? t.R[0] : null;
    const bl = el('select', {disabled:!n, dataset:{k:'blend'}});
    [['normal', '正常', '正常', 'Normal'], null, ['darken', '變暗', '变暗', 'Darken'], ['multiply', '色彩增值', '正片叠底', 'Multiply'], ['colorBurn', '加深顏色', '颜色加深', 'Color Burn'], null, ['lighten', '變亮', '变亮', 'Lighten'], ['screen', '濾色', '滤色', 'Screen'], ['colorDodge', '加亮顏色', '颜色减淡', 'Color Dodge'], null,
     ['overlay', '覆蓋', '叠加', 'Overlay'], ['softLight', '柔光', '柔光', 'Soft Light'], ['hardLight', '實光', '强光', 'Hard Light'], null, ['difference', '差異化', '差值', 'Difference'], ['exclusion', '排除', '排除', 'Exclusion'], null,
     ['hue', '色相', '色相', 'Hue'], ['saturation', '飽和度', '饱和度', 'Saturation'], ['color', '顏色', '混色', 'Color'], ['luminosity', '明度', '明度', 'Luminosity']]
      .forEach(o => bl.appendChild(o ? el('option', {value:o[0], text:T(L3(o[1], o[2], o[3]))}) : el('option', {disabled:true, text:'──────'})));
    bl.value = s && s.blend || 'normal'; bl.onchange = () => runCmd('ai.transparency.set', {blend:bl.value});
    const op = el('input', {type:'number', min:0, max:100, value:Math.round((s && s.opacity !== undefined ? s.opacity : 1) * 100), disabled:!n, dataset:{k:'opacity'}}); op.onchange = () => runCmd('ai.transparency.set', {opacity:+op.value});
    b.appendChild(el('div', {class:'row'}, [bl, el('span', {text:T(L3('不透明度：', '不透明度：', 'Opacity:'))}), op, el('span', {text:'%'})]));
    // 缩图与不透明蒙版（transparency.rs:66-160）：物件缩图｜链接钮｜蒙版缩图（点＝只看蒙版切换；Shift＝停用／启用）＋ 制作蒙版／释放、剪切、反相蒙版
    const m = s && s.opMask, row2 = el('div', {class:'row', style:'align-items:flex-start'});
    if (!HO.aiTransThumbs){
      row2.appendChild(thumb(s, 48, false));
      if (m){ row2.appendChild(btn(m.linked !== false ? '🔗' : '⛓', m.linked !== false ? L3('取消連結遮色片', '取消链接蒙版', 'Unlink the mask') : L3('連結遮色片', '链接蒙版', 'Link the mask'), () => runCmd('ai.transparency.setOpacityMask', {linked:m.linked === false}), {dataset:{act:'maskLink'}, style:'align-self:center'}));
        const mt = thumb(s, 48, true); mt.dataset.act = 'maskThumb'; mt.title = T(L3('按一下＝只檢視遮色片；Shift＋按一下＝停用／啟用', '单击＝只查看蒙版；Shift＋单击＝停用／启用', 'Click to view only the mask; Shift-click to disable or enable it'));
        mt.style.cursor = 'pointer'; mt.onclick = e => e.shiftKey ? runCmd(m.disabled ? 'ai.transparency.enableOpacityMask' : 'ai.transparency.disableOpacityMask') : runCmd('ai.transparency.viewOpacityMask', {});
        if (AiWindow.viewMask && s && AiWindow.viewMask.id === s.id) mt.style.outline = '2px solid #2f7fd8'; row2.appendChild(mt); }
      else row2.appendChild(el('div', {style:'width:48px;height:48px;border:1px dashed #555;box-sizing:border-box'}));
    }
    const ck = (k, label, on, en) => { const c = el('input', {type:'checkbox', disabled:!en, dataset:{k}}); c.checked = !!on; c.onchange = () => runCmd('ai.transparency.setOpacityMask', {[k]:c.checked}); return el('label', {class:'row', style:'margin:1px 0'}, [c, el('span', {text:T(label)})]); };
    row2.appendChild(el('div', {}, [btn(T(m ? L3('釋放', '释放', 'Release') : L3('製作遮色片', '制作蒙版', 'Make Mask')), null, () => runCmd(m ? 'ai.transparency.releaseOpacityMask' : 'ai.transparency.makeOpacityMask'), {disabled:!n, dataset:{act:m ? 'releaseMask' : 'makeMask'}}),
      ck('clip', L3('剪裁', '剪切', 'Clip'), m ? m.clip !== false : TP.newClip, !!m), ck('invert', L3('負片遮色片', '反相蒙版', 'Invert Mask'), m ? m.invert : TP.newInvert, !!m)]));
    b.appendChild(row2);
    if (!HO.aiTransparency){
      const c3 = (k, label, on) => { const c = el('input', {type:'checkbox', disabled:!n, dataset:{k}}); c.checked = !!on; c.onchange = () => runCmd('ai.transparency.set', {[k]:c.checked}); return el('label', {class:'row', style:'margin:1px 0'}, [c, el('span', {text:T(label)})]); };
      b.appendChild(c3('isolate', L3('隔離混合', '隔离混合', 'Isolate Blending'), s && s.isolate));
      const ko = el('input', {type:'checkbox', disabled:!n, dataset:{k:'knockout'}}); ko.checked = !!(s && s.knockout === 'on'); ko.indeterminate = !!(s && !s.knockout);
      ko.onchange = () => runCmd('ai.transparency.set', {knockout:!s || !s.knockout ? 'on' : s.knockout === 'on' ? 'neutral' : 'on'});   // on → 中性 → off（原码 Knockout::cycle）
      ko.oncontextmenu = e => { e.preventDefault(); runCmd('ai.transparency.set', {knockout:'off'}); };
      b.appendChild(el('label', {class:'row', style:'margin:1px 0'}, [ko, el('span', {text:T(L3('去底色群組', '挖空组', 'Knockout Group'))})]));
      b.appendChild(c3('knockoutShape', L3('不透明度和遮色片用來定義去底色形狀', '不透明度和蒙版用来定义挖空形状', 'Opacity & Mask Define Knockout Shape'), s && s.knockoutShape));
    }
    if (!n) b.appendChild(el('div', {class:'hint', text:T(L3('未選取物件', '未选择对象', 'No Selection'))}));
  },
  menu:() => { const {t} = selInfo(), s = t.R[0], m = s && s.opMask;
    return [{label:HO.aiTransThumbs ? L3('顯示縮圖', '显示缩览图', 'Show Thumbnails') : L3('隱藏縮圖', '隐藏缩览图', 'Hide Thumbnails'), run:() => { HO.aiTransThumbs = !HO.aiTransThumbs; P.refresh('aiTransparency'); }}, hideItem('aiTransparency'), {sep:true},
      {label:L3('製作不透明遮色片', '建立不透明蒙版', 'Make Opacity Mask'), disabled:!s || !!m, run:() => runCmd('ai.transparency.makeOpacityMask')},
      {label:L3('釋放不透明遮色片', '释放不透明蒙版', 'Release Opacity Mask'), disabled:!m, run:() => runCmd('ai.transparency.releaseOpacityMask')},
      {label:m && m.disabled ? L3('啟用不透明遮色片', '启用不透明蒙版', 'Enable Opacity Mask') : L3('停用不透明遮色片', '停用不透明蒙版', 'Disable Opacity Mask'), disabled:!m, run:() => runCmd(m.disabled ? 'ai.transparency.enableOpacityMask' : 'ai.transparency.disableOpacityMask')},
      {label:m && m.linked === false ? L3('連結不透明遮色片', '链接不透明蒙版', 'Link Opacity Mask') : L3('取消連結不透明遮色片', '取消链接不透明蒙版', 'Unlink Opacity Mask'), disabled:!m, run:() => runCmd(m.linked === false ? 'ai.transparency.linkOpacityMask' : 'ai.transparency.unlinkOpacityMask')}, {sep:true},
      {label:L3('新增不透明遮色片為剪裁', '新建不透明蒙版为剪切蒙版', 'New Opacity Masks Are Clipping'), checked:TP.newClip, run:() => runCmd('ai.transparency.toggleNewMasksClipping')},
      {label:L3('新增不透明遮色片為負片', '新建不透明蒙版为反相蒙版', 'New Opacity Masks Are Inverted'), checked:TP.newInvert, run:() => runCmd('ai.transparency.toggleNewMasksInverted')}, {sep:true},
      {label:L3('頁面隔離混合', '页面隔离混合', 'Page Isolated Blending'), checked:TP.pageIsolate, run:() => runCmd('ai.transparency.togglePageIsolatedBlending')},
      {label:L3('頁面去底色群組', '页面挖空组', 'Page Knockout Group'), checked:TP.pageKnockout, run:() => runCmd('ai.transparency.togglePageKnockoutGroup')}]; }});
/* 物件／蒙版缩图（transparency.rs node_thumb）：把物件（或蒙版图稿）缩画到 size×size */
function thumb(s, size, mask){
  const c = el('canvas', {width:size, height:size, style:`width:${size}px;height:${size}px;border:1px solid #555;background:#fff;box-sizing:border-box`}); if (!s) return c;
  const L = sel().L, x = c.getContext('2d'), m = s.opMask, art = mask ? (m ? m.art || [] : []) : [Object.assign({}, s, {opMask:undefined})];
  if (mask){ x.fillStyle = m && m.clip !== false ? '#000' : '#fff'; x.fillRect(0, 0, size, size); }
  const B = (mask ? art.concat([s]) : art).map(a => bounds(L, a, true)).filter(Boolean).reduce((r, q) => !r ? q : {x0:Math.min(r.x0, q.x0), y0:Math.min(r.y0, q.y0), x1:Math.max(r.x1, q.x1), y1:Math.max(r.y1, q.y1)}, null); if (!B) return c;
  const k = (size - 4) / Math.max(1, B.x1 - B.x0, B.y1 - B.y0); x.save(); x.translate(2 - (B.x0 - L.x) * k, 2 - (B.y0 - L.y) * k);
  try { art.forEach(a => window.drawShape(x, Object.assign({}, a, {opMask:undefined}), k)); } catch(e){} x.restore();
  if (mask && m && m.disabled){ x.strokeStyle = '#dc2828'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, 0); x.lineTo(size, size); x.moveTo(size, 0); x.lineTo(0, size); x.stroke(); }
  return c;
}
/* 变换（transform.rs） */
const TR = {ref:4, link:false};
P.define('aiTransform', {title:L3('變形', '变换', 'Transform'), w:270,
  refresh(b, _a, why){ if (busy(b, why)) return;
    b.innerHTML = ''; const {n, t} = selInfo(), r = n ? unionB(t.L, t.R, false) : null;
    const grid = el('div', {style:'display:grid;grid-template-columns:repeat(3,10px);gap:3px;margin-right:6px'});
    for (let i = 0; i < 9; i++) grid.appendChild(el('div', {style:`width:9px;height:9px;border:1px solid #888;cursor:pointer;background:${TR.ref === i ? '#2f7fd8' : 'transparent'}`, dataset:{ref:i}, onclick:() => { TR.ref = i; P.refresh('aiTransform'); }}));
    const o = r ? REF(r, TR.ref) : [0, 0];
    const f = (k, v) => { const x = el('input', {type:'number', value:r ? Math.round(v * 100) / 100 : '', disabled:!n, dataset:{k}}); x.onchange = () => runCmd('ai.object.setBounds', {[k]:+x.value, reference:TR.ref, proportional:TR.link}); return x; };
    b.appendChild(el('div', {class:'row'}, [grid, el('div', {}, [row('X:', f('x', o[0])), row('Y:', f('y', o[1]))]), el('div', {}, [row('W:', f('width', r ? r.x1 - r.x0 : 0)), row('H:', f('height', r ? r.y1 - r.y0 : 0))]),
      btn(TR.link ? '🔗' : '⛓', L3('強制等比例', '约束宽度和高度比例', 'Constrain Width and Height Proportions'), () => { TR.link = !TR.link; P.refresh('aiTransform'); }, {class:TR.link ? 'on' : ''})]));
    const rot = el('input', {type:'number', step:15, min:-360, max:360, value:0, disabled:!n, dataset:{k:'rotate'}}); rot.onchange = () => runCmd('ai.object.rotate', {angle:+rot.value, reference:TR.ref});
    const sh = el('input', {type:'number', value:0, disabled:!n, dataset:{k:'shear'}}); sh.onchange = () => runCmd('ai.object.shear', {angle:+sh.value, reference:TR.ref});
    b.appendChild(row(L3('旋轉：', '旋转：', 'Rotate:'), rot, el('span', {text:'°'}), el('span', {text:T(L3('傾斜：', '倾斜：', 'Shear:'))}), sh, el('span', {text:'°'})));
    b.appendChild(el('div', {class:'bar', style:'justify-content:flex-start'}, [btn('⇋', L3('水平翻轉', '水平翻转', 'Flip Horizontal'), () => runCmd('ai.object.reflect', {axis:'vertical', reference:TR.ref}), {disabled:!n}),
      btn('⇵', L3('垂直翻轉', '垂直翻转', 'Flip Vertical'), () => runCmd('ai.object.reflect', {axis:'horizontal', reference:TR.ref}), {disabled:!n})]));
    if (HO.aiTransform) return;
    // 活形状栏位（transform.rs:100-120：矩形圆角、多边形边数）
    const s = n === 1 ? t.R[0] : null;
    if (s && s.type === 'rect'){ const r = el('input', {type:'number', min:0, value:s.radius || 0, dataset:{k:'radius'}}); r.onchange = () => runCmd('ai.object.setLiveShape', {radius:+r.value}); b.appendChild(row(L3('圓角半徑：', '圆角半径：', 'Corner Radius:'), r)); }
    if (s && s.type === 'polygon'){ const r = el('input', {type:'number', min:3, max:20, value:s.points || 6, dataset:{k:'sides'}}); r.onchange = () => runCmd('ai.object.setLiveShape', {sides:+r.value}); b.appendChild(row(L3('邊數：', '边数：', 'Sides:'), r)); }
    // 缩放圆角／缩放描边和效果（transform.rs:131-140；跟比例缩放工具同一份偏好 scale.options）
    const so = peek('scale.options', {}) || {};
    const ck = (k, label) => { const c = el('input', {type:'checkbox', dataset:{k}}); c.checked = !!so[k]; c.onchange = () => runCmd('scale.options', {[k]:c.checked}); return el('label', {class:'row', style:'margin:1px 0'}, [c, el('span', {text:T(label)})]); };
    b.appendChild(ck('corners', L3('縮放圓角', '缩放圆角', 'Scale Corners'))); b.appendChild(ck('strokes', L3('縮放筆畫和效果', '缩放描边和效果', 'Scale Strokes & Effects')));
  },
  // transform.rs:155-178 菜单：变换对象／图案／两者、使用符号的注册点 原码是灰的（menu_item(..., false, …)）
  menu:() => { const n = selInfo().n, so = peek('scale.options', {}) || {};
    return [hideItem('aiTransform'), {sep:true}, {label:L3('水平翻轉', '水平翻转', 'Flip Horizontal'), disabled:!n, run:() => runCmd('ai.object.reflect', {axis:'vertical', reference:TR.ref})},
      {label:L3('垂直翻轉', '垂直翻转', 'Flip Vertical'), disabled:!n, run:() => runCmd('ai.object.reflect', {axis:'horizontal', reference:TR.ref})}, {sep:true},
      {label:L3('縮放筆畫和效果', '缩放描边和效果', 'Scale Strokes & Effects'), checked:!!so.strokes, run:() => { runCmd('scale.options', {strokes:!so.strokes}); P.refresh('aiTransform'); }}, {sep:true},
      {label:L3('僅變形物件', '仅变换对象', 'Transform Object Only'), checked:true, disabled:true, run(){}}, {label:L3('僅變形圖樣', '仅变换图案', 'Transform Pattern Only'), disabled:true, run(){}},
      {label:L3('變形兩者', '变换两者', 'Transform Both'), disabled:true, run(){}}, {sep:true}, {label:L3('使用符號的註冊點', '使用符号的注册点', 'Use Registration Point for Symbol'), disabled:true, run(){}}]; }});
/* 外观（appearance.rs：物件列、由上到下的描边／填色列（眼睛、色块、粗细、不透明度子列）、fx 列、物件不透明度列、底下一排钮；菜单） */
const AP = AiWindow.appearancePanel = {sel:null, thumb:true};
P.define('aiAppearance', {title:L3('外觀', '外观', 'Appearance'), w:280,
  refresh(b, _a, why){ if (busy(b, why)) return; b.innerHTML = ''; let {n, first:s0, t} = selInfo();
    const dp = selDeep(), deep = !n && dp.R.length ? dp.R[0] : null;     // 只选到编组里的成员（编组选择／直接选择工具）
    if (deep){ n = dp.R.length; t = {L:dp.L, R:dp.R}; s0 = leaves(deep)[0]; }
    if (!n){ b.appendChild(el('div', {class:'hint', text:T(L3('未選取物件（新圖稿的外觀）', '未选择对象（新图稿外观）', 'No Selection (new art appearance)'))}));
      b.appendChild(el('div', {class:'kv'}, [el('b', {text:T(L3('筆畫：', '描边：', 'Stroke:'))}), el('span', {text:UI.stroke() + ' ' + UI.strokeW() + ' px'}), el('b', {text:T(L3('填色：', '填色：', 'Fill:'))}), el('span', {text:UI.fill()})])); return; }
    // 单选一个编组＝看编组自己的外观（编组 / 效果 / 内容 / 不透明度）；否则看第一个路径
    const grp = t.R.length === 1 && t.R[0].type === 'group' ? t.R[0] : null;
    const s = grp || t.R.find(x => x.type !== 'group') || s0, mixed = !grp && t.R.flatMap(leaves).some(x => JSON.stringify([x.fill, x.stroke, x.strokeWidth]) !== JSON.stringify([s.fill, s.stroke, s.strokeWidth]));
    const GRP = L3('群組', '编组', 'Group'), PATH = L3('路徑', '路径', 'Path');
    const fxName = e => (window.AiFx && AiFx.fxTitle ? AiFx.fxTitle(e.id) : e.id);
    // 选到的是编组里的成员：上面先列外层编组（有效果就带 fx 记号），像 AI 的「编组 ▸ 路径」
    if (deep){ const chain = []; for (let q = dp.up.get(deep); q; q = dp.up.get(q)) chain.unshift(q);
      chain.forEach(g => b.appendChild(el('div', {class:'row', dataset:{apParent:g.id}}, [el('b', {text:T(GRP)}), Array.isArray(g.effects) && g.effects.length ? el('span', {class:'hint', text:'fx', style:'margin-left:auto;font-style:italic'}) : null]))); }
    const head = el('div', {class:'row'}); if (AP.thumb) head.appendChild(thumb(t.R[0], 28, false));
    head.appendChild(el('span', {class:'hint', dataset:{apHead:grp ? 'group' : 'path'}, text:mixed ? T(L3('混合外觀', '混合外观', 'Mixed Appearances')) : (s.graphicStyle ? `${T(PATH)}: ${s.graphicStyle}` : (t.R[0].type === 'group' ? T(GRP) : T(PATH)))})); b.appendChild(head);
    const list = el('div', {class:'list aplist'}); b.appendChild(list);
    const items = grp ? [] : (peek('ai.appearance.list', {}) || {}).items || [];
    const fx = Array.isArray(s.effects) && !deep ? s.effects : [];
    items.forEach(it => {
      const on = AP.sel === it.index, eye = el('span', {text:it.visible ? '◉' : '○', style:'cursor:pointer;width:14px', dataset:{eye:it.index}, title:T(L3('切換可見度', '切换可视性', 'Toggle visibility')), onclick:e => { e.stopPropagation(); runCmd('ai.appearance.setItem', {index:it.index, visible:!it.visible}); }});
      const sw = swatchEl(typeof it.paint === 'object' && it.paint ? {stops:(it.paint.stops || []).map(q => [q.offset || 0, q.color])} : (it.paint || 'none'), '', null);
      const r = el('div', {class:'li' + (on ? ' on' : ''), dataset:{ap:it.index, kind:it.kind}, onclick:() => { AP.sel = on ? null : it.index; P.refresh('aiAppearance'); }}, [eye, el('span', {text:T(it.kind === 'fill' ? L3('填色：', '填色：', 'Fill:') : L3('筆畫：', '描边：', 'Stroke:')), style:'min-width:38px'}), sw]);
      if (it.kind === 'stroke'){ const w = el('input', {type:'number', min:0, step:0.5, value:it.width || 0, style:'width:46px', dataset:{apw:it.index}, onclick:e => e.stopPropagation()}); w.onchange = () => runCmd('ai.appearance.setItem', {index:it.index, width:+w.value}); r.appendChild(w); r.appendChild(el('span', {text:'pt'})); }
      const cp = el('input', {type:'color', value:typeof it.paint === 'string' && it.paint !== 'none' ? it.paint : '#000000', style:'width:22px;height:18px;padding:0;border:0', dataset:{apc:it.index}, onclick:e => e.stopPropagation()}); cp.onchange = () => runCmd('ai.appearance.setItem', {index:it.index, paint:cp.value}); r.appendChild(cp);
      list.appendChild(r);
      list.appendChild(el('div', {class:'li', style:'padding-left:22px;color:#999', dataset:{apop:it.index}}, [el('span', {text:T(L3('不透明度：', '不透明度：', 'Opacity:'))}),
        (() => { const o = el('input', {type:'number', min:0, max:100, value:Math.round(it.opacity * 100), style:'width:46px', dataset:{apo:it.index}}); o.onchange = () => runCmd('ai.appearance.setItem', {index:it.index, opacity:+o.value}); return o; })(), el('span', {text:'%'})]));
    });
    // 效果列：名字照菜单（合并、圆角…），点名字＝开对话框就地改（没参数的效果没有对话框）
    const fxDlg = e => window.AiFx && AiFx.CAT && AiFx.CAT[e.id] && Object.keys(AiFx.CAT[e.id].defaults).length > 0;
    fx.forEach((e, i) => list.appendChild(el('div', {class:'li', dataset:{fx:i, fxId:e.id}}, [el('span', {text:e.visible === false ? '○' : '◉', style:'cursor:pointer;width:14px', onclick:() => runCmd('ai.effect.setParams', {index:i, visible:e.visible === false})}),
      el('span', {text:fxName(e), dataset:{fxName:i}, style:'flex:1' + (fxDlg(e) ? ';cursor:pointer;text-decoration:underline' : ''), onclick:() => { if (fxDlg(e)) runCmd('ai.effect.dialog', {effect:e.id, index:i}); }}),
      el('span', {text:'fx', style:'font-style:italic;color:#999;margin-right:6px'}), el('span', {text:'🗑', style:'cursor:pointer', onclick:() => runCmd('ai.effect.remove', {index:i})})])));
    if (grp) list.appendChild(el('div', {class:'li', dataset:{apContents:'1'}}, [el('span', {text:'', style:'width:14px'}), el('span', {text:T(L3('內容', '内容', 'Contents'))})]));
    list.appendChild(el('div', {class:'li'}, [el('span', {text:T(L3('不透明度：', '不透明度：', 'Opacity:'))}), el('span', {text:s.opacity === undefined || s.opacity >= 1 ? T(L3('預設', '默认值', 'Default')) : Math.round(s.opacity * 100) + '%' + (s.blend && s.blend !== 'normal' ? ' ' + s.blend : '')})]));
    const selIt = AP.sel !== null && items.some(x => x.index === AP.sel);
    b.appendChild(el('div', {class:'bar'}, [btn('▭', L3('新增筆畫', '添加新描边', 'Add New Stroke'), () => runCmd('ai.appearance.addStroke'), {dataset:{act:'addStroke'}}),
      btn('■', L3('新增填色', '添加新填色', 'Add New Fill'), () => runCmd('ai.appearance.addFill'), {dataset:{act:'addFill'}}),
      btn('fx', L3('新增效果', '添加新效果', 'Add New Effect'), e => AiWindow.fxMenu(e.currentTarget), {disabled:!has('ai.effect.dialog')}),
      btn('⊘', L3('清除外觀', '清除外观', 'Clear Appearance'), () => runCmd('ai.appearance.clear'), {dataset:{act:'clear'}}),
      btn('⧉', L3('複製所選項目', '复制所选项目', 'Duplicate Selected Item'), () => runCmd('ai.appearance.duplicateItem', {index:AP.sel}), {disabled:!selIt, dataset:{act:'dupItem'}}),
      btn('🗑', L3('刪除所選項目', '删除所选项目', 'Delete Selected Item'), () => { runCmd('ai.appearance.removeItem', {index:AP.sel}); AP.sel = null; }, {disabled:!selIt, dataset:{act:'delItem'}})]));
  },
  menu:() => { const n = selInfo().n, selIt = AP.sel !== null, g = selInfo().first && selInfo().first.graphicStyle;
    return [{label:L3('新增填色', '添加新填色', 'Add New Fill'), disabled:!n, run:() => runCmd('ai.appearance.addFill')}, {label:L3('新增筆畫', '添加新描边', 'Add New Stroke'), disabled:!n, run:() => runCmd('ai.appearance.addStroke')}, {sep:true},
      {label:L3('複製項目', '复制项目', 'Duplicate Item'), disabled:!selIt, run:() => runCmd('ai.appearance.duplicateItem', {index:AP.sel})}, {label:L3('移除項目', '移除项目', 'Remove Item'), disabled:!selIt, run:() => { runCmd('ai.appearance.removeItem', {index:AP.sel}); AP.sel = null; }},
      {label:L3('清除外觀', '清除外观', 'Clear Appearance'), disabled:!n, run:() => runCmd('ai.appearance.clear')}, {label:L3('減少至基本外觀', '简化至基本外观', 'Reduce to Basic Appearance'), disabled:!n, run:() => runCmd('ai.appearance.reduceToBasic')},
      {label:L3('新增圖稿具有基本外觀', '新建图稿具有基本外观', 'New Art Has Basic Appearance'), checked:AiWindow.newArtBasic, run:() => runCmd('ai.appearance.setNewArtBasic')}, {sep:true},
      {label:AP.thumb ? L3('隱藏縮圖', '隐藏缩览图', 'Hide Thumbnail') : L3('顯示縮圖', '显示缩览图', 'Show Thumbnail'), run:() => { AP.thumb = !AP.thumb; P.refresh('aiAppearance'); }},
      {label:g ? {'zh-Hant':'重新定義圖形樣式「' + g + '」', 'zh-Hans':'重新定义图形样式「' + g + '」', en:`Redefine Graphic Style "${g}"`} : L3('重新定義圖形樣式', '重新定义图形样式', 'Redefine Graphic Style'), disabled:!g, run:() => runCmd('ai.graphicStyle.redefine', {name:g})},
      {label:L3('顯示所有隱藏的屬性', '显示所有隐藏的属性', 'Show All Hidden Attributes'), disabled:!n, run:() => runCmd('ai.appearance.showAllHidden')}]; }});
AiWindow.fxMenu = anchor => {
  // AI 外观面板 fx 钮＝效果菜单从「Illustrator 效果」那段起（3D…路径查找器▸合并、风格化▸圆角…、Photoshop 效果），子菜单一样展开；用顶菜单同一套下拉
  const tree = window.MenuTrees && MenuTrees.ai && MenuTrees.ai.effect, i0 = tree ? tree.items.findIndex(it => it.header) : -1;
  if (i0 >= 0 && window.CtxMenu && CtxMenu.open && anchor && anchor.ownerDocument === document){ const r = anchor.getBoundingClientRect(); return CtxMenu.open(tree.items.slice(i0), r.left, r.bottom + 2); }
  const L = peek('ai.effect.list') || {}, cat = (L.catalog || []).filter(c => c.menu);
  const pop = el('div', {class:'dlp-pop', style:'max-height:60vh;overflow:auto'}); cat.forEach(c => pop.appendChild(el('div', {class:'dlp-pi', text:(Array.isArray(c.menu) ? c.menu.join(' › ') + ' › ' : '') + c.label, onclick:() => { pop.remove(); runCmd('ai.effect.dialog', {effect:c.id}); }})));
  P.popup(pop, anchor);
};
/* 色板（swatches.rs：查找栏、缩图格／列表、颜色组当资料夹、[无] 在最前；Shift／Ctrl+点多选；双击＝色板选项；底下一排钮；面板菜单） */
P.define('aiSwatches', {title:L3('色票', '色板', 'Swatches'), w:270,
  refresh(b, _a, why){ if (busy(b, why)) return; b.innerHTML = ''; const L = swList(), all = L.concat(SW.groups.flatMap(g => g[1])), q = SW.find.trim().toLowerCase();
    if (SW.showFind){ const f = el('input', {type:'text', value:SW.find, placeholder:T(L3('尋找', '查找', 'Find')), dataset:{k:'find'}, style:'width:100%;margin-bottom:4px'}); f.oninput = () => { runCmd('ai.swatch.view', {find:f.value}); P.refresh('aiSwatches'); setTimeout(() => { const g = b.querySelector('input[data-k=find]'); if (g){ g.focus(); g.setSelectionRange(g.value.length, g.value.length); } }, 0); }; b.appendChild(f); }
    const pick = (e, nm, apply) => { if (e.shiftKey || e.ctrlKey || e.metaKey){ const s = SW.sel.includes(nm) ? SW.sel.filter(x => x !== nm) : SW.sel.concat([nm]); runCmd('ai.swatch.select', {names:s}); P.refresh('aiSwatches'); return; }
      runCmd('ai.swatch.select', {names:[nm]}); apply(); P.refresh('aiSwatches'); };
    const tile = (s, apply) => { const on = SW.sel.includes(s[0]);
      if (SW.view === 'list') return el('div', {class:'li' + (on ? ' on' : ''), dataset:{name:s[0]}, onclick:e => pick(e, s[0], apply), ondblclick:() => runCmd('ai.swatch.options', {name:s[0]})}, [swatchEl(s[1], s[0], null), el('span', {text:s[0]})]);
      const d = swatchEl(s[1], s[0], e => pick(e, s[0], apply), {dataset:{name:s[0]}, ondblclick:() => runCmd('ai.swatch.options', {name:s[0]})}); if (on) d.style.outline = '2px solid #2f7fd8'; return d; };
    const box = () => el('div', {class:SW.view === 'list' ? 'list' : 'grid'});
    const grid = box(); b.appendChild(grid);
    L.forEach((s, i) => { if (q && !s[0].toLowerCase().includes(q)) return; grid.appendChild(tile(s, e => runCmd('ai.swatch.apply', {index:i}))); });
    SW.groups.forEach(g => { const items = g[1].filter(s => !q || s[0].toLowerCase().includes(q)); if (q && !items.length) return;
      b.appendChild(el('div', {class:'sec', text:'📁 ' + g[0], dataset:{group:g[0]}, style:'cursor:pointer', onclick:() => { runCmd('ai.swatch.select', {names:g[1].map(s => s[0])}); P.refresh('aiSwatches'); }}));
      const gg = box(); items.forEach(s => gg.appendChild(tile(s, () => runCmd('ai.swatch.apply', {index:all.indexOf(s)})))); b.appendChild(gg); });
    b.appendChild(el('div', {class:'bar'}, [btn('📚', L3('色票資料庫選單', '色板库菜单', 'Swatch Libraries menu'), e => libMenu(e.currentTarget)),
      btn('▦', SW.view === 'list' ? L3('縮圖檢視', '缩览图视图', 'Thumbnail View') : L3('清單檢視', '列表视图', 'List View'), () => { runCmd('ai.swatch.view', {mode:SW.view === 'list' ? 'grid' : 'list'}); P.refresh('aiSwatches'); }, {dataset:{act:'view'}}),
      btn('⚙', L3('色票選項', '色板选项', 'Swatch Options'), () => runCmd('ai.swatch.options'), {disabled:SW.sel.length !== 1, dataset:{act:'options'}}),
      btn('📁', L3('新增顏色群組', '新建颜色组', 'New Color Group'), () => { runCmd('ai.swatch.newGroup'); P.refresh('aiSwatches'); }, {dataset:{act:'newGroup'}}),
      btn('＋', L3('新增色票', '新建色板', 'New Swatch'), () => { runCmd('ai.swatch.new'); P.refresh('aiSwatches'); }, {dataset:{act:'new'}}),
      btn('🗑', L3('刪除色票', '删除色板', 'Delete Swatch'), () => { runCmd('ai.swatch.delete'); P.refresh('aiSwatches'); }, {disabled:!SW.sel.length, dataset:{act:'delete'}})]));
  },
  menu:() => { const ns = SW.sel.length, grp = SW.groups.find(g => g[1].some(s => SW.sel.includes(s[0])));
    const R = (c, p) => () => { runCmd(c, p || {}); P.refresh('aiSwatches'); };
    return [{label:L3('新增色票…', '新建色板…', 'New Swatch…'), run:() => P.dialog({id:'aiNewSwatch', title:L3('新增色票', '新建色板', 'New Swatch'), fields:[{k:'name', type:'text', label:L3('色票名稱：', '色板名称：', 'Swatch Name:'), value:cur()}, {k:'color', type:'color', label:L3('顏色：', '颜色：', 'Color:'), value:cur()}], ok:v => { const r = CMD.run('ai.swatch.new', v); P.refresh('aiSwatches'); return r; }})},
      {label:L3('新增顏色群組…', '新建颜色组…', 'New Color Group…'), run:() => P.dialog({id:'aiNewGroup', title:L3('新增顏色群組', '新建颜色组', 'New Color Group'), fields:[{k:'name', type:'text', label:L3('名稱：', '名称：', 'Name:'), value:'Color Group ' + (SW.groups.length + 1)}], ok:v => { const r = CMD.run('ai.swatch.newGroup', {name:v.name}); P.refresh('aiSwatches'); return r; }})}, {sep:true},
      {label:L3('複製色票', '复制色板', 'Duplicate Swatch'), disabled:!ns, run:R('ai.swatch.duplicate')}, {label:L3('合併色票', '合并色板', 'Merge Swatches'), disabled:ns < 2, run:R('ai.swatch.merge')},
      {label:L3('刪除色票', '删除色板', 'Delete Swatch'), disabled:!ns, run:R('ai.swatch.delete')}, {sep:true},
      {label:L3('取消顏色群組', '取消颜色组编组', 'Ungroup Color Group'), disabled:!grp, run:R('ai.swatch.ungroup', {group:grp && grp[0]})},
      {label:L3('選取所有未使用的', '选择所有未使用的色板', 'Select All Unused'), run:R('ai.swatch.unused')}, {label:L3('增加使用的顏色', '添加使用的颜色', 'Add Used Colors'), run:R('ai.swatch.addUsedColors')}, {sep:true},
      {label:L3('依名稱排序', '按名称排序', 'Sort by Name'), run:R('ai.swatch.sortByName')}, {label:L3('依類型排序', '按类型排序', 'Sort by Kind'), run:R('ai.swatch.sortByKind')}, {sep:true},
      {label:L3('縮圖檢視', '缩览图视图', 'Thumbnail View'), checked:SW.view !== 'list', run:R('ai.swatch.view', {mode:'grid'})}, {label:L3('清單檢視', '列表视图', 'List View'), checked:SW.view === 'list', run:R('ai.swatch.view', {mode:'list'})},
      {label:L3('顯示尋找欄位', '显示查找栏', 'Show Find Field'), checked:SW.showFind, run:R('ai.swatch.view', {showFind:!SW.showFind})}, {sep:true},
      {label:L3('色票選項…', '色板选项…', 'Swatch Options…'), disabled:ns !== 1, run:R('ai.swatch.options')}, {label:L3('特別色…', '专色…', 'Spot Colors…'), disabled:true, run(){}}, {sep:true},
      {label:L3('儲存色票資料庫…', '存储色板库…', 'Save Swatch Library…'), run:() => runCmd('ai.ui.saveSwatchLibrary', {dialog:true})}]; }});
function libMenu(anchor){
  const pop = el('div', {class:'dlp-pop'}); LIBS.forEach(([id, name]) => pop.appendChild(el('div', {class:'dlp-pi', text:name, onclick:() => { pop.remove(); runCmd('ai.window.swatchLibrary', {library:id}); }})));
  P.popup(pop, anchor, {above:true});
}
/* 色板库面板（library_panel.rs:161-344） */
P.define('aiSwatchLib', {title:L3('色票資料庫', '色板库', 'Swatch Library'), w:270, h:320,
  refresh(b){ b.innerHTML = ''; const L = library(AiWindow.libOpen); if (!L){ b.appendChild(el('div', {class:'hint', text:'—'})); return; }
    const box = P.els.aiSwatchLib; if (box) box.querySelector('.dlp-t').textContent = L.name;
    const add = (list) => { const g = el('div', {class:'grid'}); list.forEach(s => g.appendChild(swatchEl(s[1], s[0], e => { if (e.shiftKey || e.ctrlKey) return; runCmd('ai.swatch.library.add', {library:L.id, names:[s[0]], apply:activeStroke() ? 'stroke' : 'fill'}); }, {dataset:{name:s[0]}}))); b.appendChild(g); };
    if (L.swatches.length) add(L.swatches);
    L.groups.forEach(g => { b.appendChild(el('div', {class:'sec', text:'📁 ' + g[0]})); add(g[1]); });
    const i = LIBS.findIndex(x => x[0] === L.id);
    b.appendChild(el('div', {class:'bar'}, [btn('◀', null, () => runCmd('ai.window.swatchLibrary', {library:LIBS[(i + LIBS.length - 1) % LIBS.length][0]})), btn('▶', null, () => runCmd('ai.window.swatchLibrary', {library:LIBS[(i + 1) % LIBS.length][0]})),
      btn(T(L3('加入色票', '添加到色板', 'Add to Swatches')), null, () => { runCmd('ai.swatch.library.add', {library:L.id, names:L.swatches.concat(L.groups.flatMap(g => g[1])).map(s => s[0])}); P.refresh('aiSwatches'); })]));
  }});
/* 颜色（color.rs：灰度／RGB／HSB／CMYK／Web 安全 RGB） */
const CM = {mode:'RGB'};
P.define('aiColor', {title:L3('顏色', '颜色', 'Color'), w:270,
  menu:() => [hideItem('aiColor'), {sep:true}].concat(['Grayscale', 'RGB', 'HSB', 'CMYK', 'Web Safe RGB'].map(m => ({label:{'zh-Hant':m, 'zh-Hans':m, en:m}, checked:CM.mode === m, run:() => { CM.mode = m; P.refresh('aiColor'); }})))
    .concat([{sep:true}, {label:L3('負片', '反相', 'Invert'), run:() => { const c = hexRgb(cur()); setCur(rgbHex(255 - c[0], 255 - c[1], 255 - c[2])); }},
      {label:L3('補色', '补色', 'Complement'), run:() => { const [h, s, v] = hsbOf(cur()); setCur(hsbHex(h + 180, s, v)); }}, {sep:true},
      {label:L3('建立新色票…', '创建新色板…', 'Create New Swatch…'), run:() => P.dialog({id:'aiNewSwatch', title:L3('新增色票', '新建色板', 'New Swatch'), fields:[{k:'name', type:'text', label:L3('色票名稱：', '色板名称：', 'Swatch Name:'), value:cur()}, {k:'color', type:'color', label:L3('顏色：', '颜色：', 'Color:'), value:cur()}], ok:v => { const r = CMD.run('ai.swatch.new', v); P.refresh('aiSwatches'); return r; }})},
      {label:L3('拷貝顏色值（十六進位）', '复制颜色值（十六进制）', 'Copy Color Value (Hex)'), run:() => { try { navigator.clipboard.writeText(cur().replace('#', '').toUpperCase()); } catch(e){} AiWindow.lastCopiedHex = cur().replace('#', '').toUpperCase(); }}]),
  refresh(b, _a, why){ if ((why === 'doc' || why === 'draw') && P.typing(b, {skip:['checkbox', 'radio', 'button', 'range', 'color']})) return;
    b.innerHTML = ''; const c = hexRgb(cur());
    const chans = CM.mode === 'Grayscale' ? [['K', 0, 100, Math.round((1 - (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255) * 100)]]
      : CM.mode === 'HSB' ? (([h, s, v]) => [['H', 0, 360, Math.round(h)], ['S', 0, 100, Math.round(s * 100)], ['B', 0, 100, Math.round(v * 100)]])(hsbOf(cur()))
      : CM.mode === 'CMYK' ? ((k => [['C', 0, 100, k < 1 ? Math.round((1 - c[0] / 255 - k) / (1 - k) * 100) : 0], ['M', 0, 100, k < 1 ? Math.round((1 - c[1] / 255 - k) / (1 - k) * 100) : 0], ['Y', 0, 100, k < 1 ? Math.round((1 - c[2] / 255 - k) / (1 - k) * 100) : 0], ['K', 0, 100, Math.round(k * 100)]])(1 - Math.max(...c) / 255))
      : [['R', 0, 255, c[0]], ['G', 0, 255, c[1]], ['B', 0, 255, c[2]]];
    const vals = chans.map(ch => ch[3]);
    const apply = () => { let hx;
      if (CM.mode === 'Grayscale') hx = rgbHex(...Array(3).fill(255 * (1 - vals[0] / 100)));
      else if (CM.mode === 'HSB') hx = hsbHex(vals[0], vals[1] / 100, vals[2] / 100);
      else if (CM.mode === 'CMYK'){ const k = vals[3] / 100; hx = rgbHex(...[0, 1, 2].map(i => 255 * (1 - vals[i] / 100) * (1 - k))); }
      else { let v = vals.slice(); if (CM.mode === 'Web Safe RGB') v = v.map(x => Math.round(x / 51) * 51); hx = rgbHex(...v); }
      setCur(hx); };
    b.appendChild(el('div', {class:'row'}, [el('div', {style:`width:26px;height:26px;border:1px solid #000;background:${cur()}`}), el('span', {class:'hint', text:(activeStroke() ? T(L3('筆畫', '描边', 'Stroke')) : T(L3('填色', '填色', 'Fill'))) + ' · ' + CM.mode})]));
    if (!HO.aiColor) chans.forEach(([n, lo, hi], i) => { const r = el('input', {type:'range', min:lo, max:hi, value:vals[i], dataset:{ch:n}}), f = el('input', {type:'number', min:lo, max:hi, value:vals[i], dataset:{chn:n}});
      r.onchange = () => { vals[i] = +r.value; apply(); }; r.oninput = () => { f.value = r.value; }; f.onchange = () => { vals[i] = clamp(+f.value, lo, hi); apply(); }; b.appendChild(row(n, r, f)); });
    if (!HO.aiColor && CM.mode !== 'Grayscale' && CM.mode !== 'CMYK'){ const hx = el('input', {type:'text', value:cur().replace('#', '').toUpperCase(), style:'width:70px', dataset:{k:'hex'}}); hx.onchange = () => setCur('#' + hx.value.replace('#', '')); b.appendChild(row('#', hx)); }
    const sp = el('canvas', {width:240, height:46, style:'width:100%;height:46px;cursor:crosshair', class:'aispec'}); b.appendChild(sp);
    const x = sp.getContext('2d'); for (let i = 0; i < 240; i++){ for (let j = 0; j < 46; j += 2){ const t = j / 46; x.fillStyle = hsbHex(i * 1.5, t < .5 ? t * 2 : 1, t < .5 ? 1 : 2 - t * 2); x.fillRect(i, j, 1, 2); } }
    sp.onclick = e => { const r = sp.getBoundingClientRect(), d = x.getImageData(Math.round((e.clientX - r.left) / r.width * 239), Math.round((e.clientY - r.top) / r.height * 45), 1, 1).data; setCur(rgbHex(d[0], d[1], d[2])); };
    b.appendChild(el('div', {class:'grid'}, [swatchEl('none', '[None]', () => applyPaint('none', activeStroke())), swatchEl('#000000', 'Black', () => setCur('#000000')), swatchEl('#ffffff', 'White', () => setCur('#ffffff'))]));
  }});
function cur(){ return document.getElementById(activeStroke() ? 'strokeColor' : 'fillColor').value; }
function setCur(h){ applyPaint(h, activeStroke()); if (window.Toolbar && Toolbar.refreshColors) Toolbar.refreshColors(); P.refresh('aiColor'); }
/* 颜色参考（color_guide.rs） */
P.define('aiColorGuide', {title:L3('色彩參考', '颜色参考', 'Color Guide'), w:280,
  menu:() => [['tintsShades', L3('顯示淺色/暗色', '显示淡色/暗色', 'Show Tints/Shades')], ['warmCool', L3('顯示暖色/冷色', '显示冷色/暖色', 'Show Warm/Cool')], ['vividMuted', L3('顯示鮮豔/柔和', '显示亮光/暗光', 'Show Vivid/Muted')]]
    .map(([k, n]) => ({label:n, checked:CG.opts.variation === k, run:() => { CG.opts.variation = k; P.refresh('aiColorGuide'); }}))
    .concat([{sep:true}, {label:L3('將顏色儲存為色票', '将颜色存储为色板', 'Save Colors as Swatches'), run:() => runCmd('ai.colorGuide.saveSwatches', {group:false})},
      {label:L3('色彩參考選項…', '颜色参考选项…', 'Color Guide Options…'), run:() => P.dialog({id:'aiCgOpts', title:L3('色彩參考選項', '颜色参考选项', 'Color Guide Options'), fields:[{k:'steps', type:'number', label:L3('步驟：', '步骤：', 'Steps:'), value:CG.opts.steps, min:1, max:20}, {k:'amount', type:'number', label:L3('變化：', '变化：', 'Variation:'), value:CG.opts.amount, min:0, max:100}],
        ok:v => { const r = CMD.run('ai.colorGuide.get', {steps:clamp(Math.round(v.steps || 4), 1, 20), amount:clamp(v.amount === null ? 50 : v.amount, 0, 100)}); P.refresh('aiColorGuide'); return r; }})},
      {label:L3('將顏色限制為色票資料庫（未做）', '将颜色限制为色板库（未做）', 'Limit colors to swatch library (not done)'), disabled:true, run(){}}]),
  refresh(b){ b.innerHTML = ''; if (!CG.base) CG.base = '#e67828';
    const r = CMD.map['ai.colorGuide.get'].run({});
    const rule = el('select', {dataset:{k:'rule'}}); Harmony.rules.forEach(n => rule.appendChild(el('option', {value:n, text:n}))); rule.value = CG.rule; rule.onchange = () => { CG.rule = rule.value; P.refresh('aiColorGuide'); };
    b.appendChild(el('div', {class:'row'}, [swatchEl(r.base, T(L3('設定基色為目前顏色', '将基色设置为当前颜色', 'Set base color to the current color')), () => { CG.base = cur(); P.refresh('aiColorGuide'); }, {dataset:{base:1}, style:`background:${r.base};width:28px;height:28px`}), rule]));
    b.appendChild(el('div', {style:'display:flex;height:22px;margin:4px 0'}, r.colors.map(c => el('div', {style:`flex:1;background:${c};cursor:pointer`, title:c, dataset:{hc:c}, onclick:() => setCur(c)}))));
    const sides = {tintsShades:['Shades', 'Tints'], warmCool:['Cool', 'Warm'], vividMuted:['Muted', 'Vivid']}[CG.opts.variation];
    b.appendChild(el('div', {class:'row hint'}, [el('span', {text:sides[0], style:'flex:1'}), el('span', {text:sides[1]})]));
    r.grid.forEach(rowc => b.appendChild(el('div', {style:'display:flex;height:16px;margin-bottom:2px'}, rowc.map(c => el('div', {style:`flex:1;background:${c};cursor:pointer;border:1px solid #0003`, title:c, onclick:() => setCur(c)})))));
    b.appendChild(el('div', {class:'bar'}, [btn('▦', L3('將色彩群組儲存至色票面板', '将颜色组保存到色板面板', 'Save color group to Swatch panel'), () => runCmd('ai.colorGuide.saveSwatches', {group:true}), {dataset:{act:'saveGroup'}})]));
  }});
/* 颜色主题（color_themes.rs） */
const CT = {rule:'Analogous 2', base:rgbHex(0.1 * 255, 0.55 * 255, 0.6 * 255), name:'', mine:(() => { try { return JSON.parse(localStorage.getItem('dlAiThemes') || '[]'); } catch(e){ return []; } })(), tab:0};
AiWindow.themeColors = () => CT.rule === 'Custom' ? (CT.custom || [CT.base]) : (() => { const a = Harmony.apply(CT.rule, CT.base); const o = a.slice(); let k = 0; while (o.length < 5){ const i = k % a.length, pass = Math.floor(k / a.length); o.push(Harmony.variation(a[i], (i + pass) % 2 === 0 ? 3 : -3, {variation:'tintsShades', steps:4, amount:50})); k++; } return o.slice(0, 5); })();
P.define('aiColorThemes', {title:L3('色彩主題', '颜色主题', 'Color Themes'), w:280,
  menu:() => { const th = CT.tab === 1 ? CT.mine[CT.pick] : null;
    return CT.tab === 1 ? [{label:L3('編輯主題', '编辑主题', 'Edit Theme'), disabled:!th, run:() => { CT.rule = th.rule || 'Custom'; CT.custom = th.colors.slice(); CT.base = th.colors[0]; CT.name = th.name; if (CT.rule !== 'Custom') CT.custom = null; CT.tab = 0; P.refresh('aiColorThemes'); }},
        {label:L3('新增至色票', '添加到色板', 'Add to Swatches'), disabled:!th, run:() => runCmd('ai.colorTheme.addToSwatches', {name:th.name})}, {label:L3('刪除主題', '删除主题', 'Delete Theme'), disabled:!th, run:() => { runCmd('ai.colorTheme.delete', {name:th.name}); CT.pick = null; P.refresh('aiColorThemes'); }}]
      : [{label:L3('儲存主題', '存储主题', 'Save Theme'), run:() => { runCmd('ai.colorTheme.save', {}); CT.tab = 1; P.refresh('aiColorThemes'); }}, {label:L3('新增至色票', '添加到色板', 'Add to Swatches'), run:() => runCmd('ai.colorTheme.addToSwatches', {})}]; },
  refresh(b, _a, why){ if (busy(b, why)) return; b.innerHTML = '';
    b.appendChild(el('div', {class:'grid', style:'margin-bottom:6px'}, [btn(T(L3('建立', '创建', 'Create')), null, () => { CT.tab = 0; P.refresh('aiColorThemes'); }, {class:CT.tab ? '' : 'on', dataset:{tab:'create'}}), btn(T(L3('我的主題', '我的主题', 'My Themes')), null, () => { CT.tab = 1; P.refresh('aiColorThemes'); }, {class:CT.tab ? 'on' : '', dataset:{tab:'mine'}})]));
    if (CT.tab === 0){
      const r = el('select', {dataset:{k:'rule'}}); ['Custom'].concat(Harmony.rules).forEach(n => r.appendChild(el('option', {value:n, text:n}))); r.value = CT.rule; r.onchange = () => { CT.rule = r.value; P.refresh('aiColorThemes'); };
      b.appendChild(row(L3('規則', '规则', 'Rule'), r));
      const cols = AiWindow.themeColors();
      b.appendChild(el('div', {style:'display:flex;height:34px;margin:6px 0'}, cols.map(c => el('div', {style:`flex:1;background:${c};cursor:pointer`, title:c, onclick:() => setCur(c)}))));
      const hx = el('input', {type:'text', value:CT.base, style:'width:80px', dataset:{k:'base'}}); hx.onchange = () => { CT.base = hx.value; P.refresh('aiColorThemes'); };
      const nm = el('input', {type:'text', value:CT.name, placeholder:T(L3('名稱', '名称', 'Name')), dataset:{k:'name'}}); nm.onchange = () => { CT.name = nm.value; };
      b.appendChild(row('#', hx, btn('💧', L3('用目前顏色', '用当前颜色', 'From current color'), () => { CT.base = cur(); P.refresh('aiColorThemes'); }))); b.appendChild(row(L3('名稱', '名称', 'Name'), nm));
      b.appendChild(el('div', {class:'bar'}, [btn(T(L3('儲存', '保存', 'Save')), null, () => { runCmd('ai.colorTheme.save', {name:CT.name}); CT.tab = 1; P.refresh('aiColorThemes'); }, {dataset:{act:'saveTheme'}}),
        btn(T(L3('加入色票', '添加到色板', 'Add to Swatches')), null, () => runCmd('ai.colorTheme.addToSwatches', {}), {dataset:{act:'themeToSwatches'}})]));
    } else {
      if (!CT.mine.length) b.appendChild(el('div', {class:'hint', text:T(L3('還沒有儲存的主題', '还没有存储的主题', 'No saved themes yet'))}));
      CT.mine.forEach((th, i) => b.appendChild(el('div', {class:'li' + (CT.pick === i ? ' on' : ''), dataset:{theme:th.name}, onclick:() => { CT.pick = i; P.refresh('aiColorThemes'); }}, [el('span', {text:th.name, style:'flex:1'}), el('div', {style:'display:flex;width:90px;height:14px'}, th.colors.map(c => el('div', {style:`flex:1;background:${c}`}))),
        el('span', {text:'🗑', style:'cursor:pointer', onclick:e => { e.stopPropagation(); runCmd('ai.colorTheme.delete', {name:th.name}); CT.pick = null; P.refresh('aiColorThemes'); }})])));
    }
  }});
/* 渐变（gradient.rs：缩图、类型、填色／描边代理、角度、长宽比、反向、渐变滑块（点下面＝加色标、点色标＝选、拖到外面＝删）、选中色标的颜色／不透明度／位置、中点；接 tools/gradient.js 的 gradient.edit／get） */
const GP = AiWindow.gradientPanel = {stop:0};
const stopsOf = g => (g && g.paint && g.paint.stops || []).map(s => ({offset:s.offset, color:s.color, opacity:s.opacity === undefined ? 1 : s.opacity, midpoint:s.midpoint === undefined ? 0.5 : s.midpoint}));
const lerpHex = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return rgbHex(...A.map((v, i) => v + (B[i] - v) * t)); };
reg('ai.gradient.addStop', '{location: 0..100 %, color?（缺省＝那个位置的颜色）} 渐变面板：在滑块上加一个色标（gradient.rs：点渐变条下方）→ {ok, index}', p => {
  const g = peek('gradient.get', {stroke:activeStroke()}); if (!g || g.ok === false || !g.paint) return err('ai.gradient.addStop', 'the active paint is not a gradient');
  const st = stopsOf(g), at = clamp(+p.location || 0, 0, 100) / 100; let i = st.findIndex(s => s.offset > at); if (i < 0) i = st.length;
  const a = st[Math.max(0, i - 1)], b = st[Math.min(st.length - 1, i)], u = b.offset > a.offset ? (at - a.offset) / (b.offset - a.offset) : 0;
  st.splice(i, 0, {offset:at, color:p.color || lerpHex(a.color, b.color, u), opacity:a.opacity + (b.opacity - a.opacity) * u, midpoint:0.5});
  const r = CMD.map['gradient.edit'].run({stops:st, stroke:activeStroke()}); if (r && r.ok === false) return r; GP.stop = i; return {ok:true, index:i};
});
reg('ai.gradient.deleteStop', '{index?（缺省＝选中的）} 删除色标（至少留 2 个；gradient.rs：拖离滑块）→ {ok}', p => {
  const g = peek('gradient.get', {stroke:activeStroke()}); if (!g || g.ok === false || !g.paint) return err('ai.gradient.deleteStop', 'the active paint is not a gradient');
  const st = stopsOf(g), i = p.index === undefined ? GP.stop : +p.index; if (st.length <= 2) return err('ai.gradient.deleteStop', 'a gradient needs at least two stops'); if (!st[i]) return err('ai.gradient.deleteStop', 'no such stop');
  st.splice(i, 1); const r = CMD.map['gradient.edit'].run({stops:st, stroke:activeStroke()}); if (r && r.ok === false) return r; GP.stop = Math.max(0, i - 1); return {ok:true};
});
reg('ai.gradient.setMidpoint', '{index（左边那个色标）, location: 13..87 %} 渐变滑块上的菱形：两个色标之间的中点 → {ok}', p => {
  const g = peek('gradient.get', {stroke:activeStroke()}); if (!g || g.ok === false || !g.paint) return err('ai.gradient.setMidpoint', 'the active paint is not a gradient');
  const st = stopsOf(g), i = +p.index; if (!st[i] || i >= st.length - 1) return err('ai.gradient.setMidpoint', 'no midpoint after that stop');
  st[i].midpoint = clamp(+p.location || 50, 13, 87) / 100; return CMD.map['gradient.edit'].run({stops:st, stroke:activeStroke()});
});
P.define('aiGradient', {title:L3('漸層', '渐变', 'Gradient'), w:280,
  refresh(b, _a, why){ if (busy(b, why)) return;
    b.innerHTML = ''; const g = peek('gradient.get', {stroke:activeStroke()}), ok = g && g.ok !== false && g.paint, {n} = selInfo();
    const ffg = activeStroke() ? null : peek('gradient.freeform.get', {}), ff = ffg && ffg.ok !== false ? ffg : null;   // 任意形状渐变（只给填色）
    const stops = ok ? stopsOf(g) : []; if (GP.stop >= stops.length) GP.stop = Math.max(0, stops.length - 1);
    const kind = ff ? 'freeform' : ok ? (g.paint.kind || 'linear') : null, ramp = stops.length ? `linear-gradient(90deg,${stops.map(s => { const [r, gg, bb] = hexRgb(s.color); return `rgba(${r},${gg},${bb},${s.opacity}) ${Math.round(s.offset * 100)}%`; }).join(',')})` : 'linear-gradient(90deg,#fff,#000)';
    b.appendChild(el('div', {class:'row'}, [el('div', {style:`width:34px;height:34px;border:1px solid #000;background:${ramp}`}),
      el('div', {}, [row(L3('類型：', '类型：', 'Type:'), ...[['linear', '▭', L3('線性', '线性', 'Linear')], ['radial', '◎', L3('放射狀', '径向', 'Radial')]].map(([k, ic, nm]) => btn(ic, nm, () => runCmd('gradient.edit', {kind:k, stroke:activeStroke()}), {disabled:!n, class:kind === k ? 'on' : '', dataset:{kind:k}})),
        btn('◇', L3('任意形狀漸層', '任意形状渐变', 'Freeform Gradient'), () => runCmd('gradient.freeform.apply', {}), {disabled:!n || activeStroke(), class:kind === 'freeform' ? 'on' : '', dataset:{kind:'freeform'}})),
        row(L3('筆畫：', '描边：', 'Stroke:'), btn(activeStroke() ? T(L3('筆畫', '描边', 'Stroke')) : T(L3('填色', '填色', 'Fill')), L3('填色／筆畫（作用中的色塊）', '填色／描边（作用中的色块）', 'Fill / Stroke proxy'), () => { if (window.Toolbar){ Toolbar.activeSwatch = activeStroke() ? 'fill' : 'stroke'; if (Toolbar.refreshColors) Toolbar.refreshColors(); } P.refresh('aiGradient'); }, {dataset:{act:'proxy'}}))])]));
    if (ff){                                              // 任意形状：「绘制：点／线」、选中色标点的颜色／不透明度／扩展（AI 渐变面板同一格）
      const sel = ff.selectedPoint, pt = sel !== null && sel !== undefined ? ff.points[sel] : null;
      b.appendChild(row(L3('繪製：', '绘制：', 'Draw:'), ...[['points', L3('點', '点', 'Points')], ['lines', L3('線', '线', 'Lines')]].map(([k, nm]) => btn(T(nm), nm, () => runCmd('gradient.freeform.setMode', {mode:k}), {class:ff.mode === k ? 'on' : '', dataset:{ffmode:k}}))));
      if (pt){
        const c = el('input', {type:'color', value:pt.color, dataset:{k:'ffColor'}}); c.onchange = () => runCmd('gradient.freeform.setPoint', {index:sel, color:c.value});
        const op = el('input', {type:'number', min:0, max:100, value:Math.round(pt.opacity), dataset:{k:'ffOpacity'}}); op.onchange = () => runCmd('gradient.freeform.setPoint', {index:sel, opacity:+op.value});
        const sp = el('input', {type:'number', min:0, max:100, value:Math.round(pt.spread), dataset:{k:'ffSpread'}}); sp.onchange = () => runCmd('gradient.freeform.setPoint', {index:sel, spread:+sp.value});
        b.appendChild(row(L3('色標：', '色标：', 'Stop:'), c, el('span', {text:T(L3('不透明度：', '不透明度：', 'Opacity:'))}), op, el('span', {text:'%'})));
        b.appendChild(row(L3('展開：', '扩展：', 'Spread:'), sp, el('span', {text:'%'}), btn('🗑', L3('刪除色標', '删除色标', 'Delete Stop'), () => runCmd('gradient.freeform.deletePoint', {index:sel}), {disabled:ff.points.length <= 1, dataset:{act:'ffDelete'}})));
      }
      b.appendChild(el('div', {class:'hint', text:T(L3('用漸層工具：拖色標點移動、在物件內按一下加點、Alt＋按一下刪點', '用渐变工具：拖色标点移动、在物件内单击加点、Alt＋单击删点', 'With the Gradient tool: drag a stop to move it, click inside the art to add one, Alt-click to remove it'))}));
      return;
    }
    if (!HO.aiGradient){
      const ang = el('input', {type:'number', min:-180, max:180, value:ok && g.angle !== undefined ? Math.round(g.angle) : 0, disabled:!ok, dataset:{k:'angle'}}); ang.onchange = () => runCmd('gradient.edit', {angle:+ang.value, stroke:activeStroke()});
      b.appendChild(row(L3('角度：', '角度：', 'Angle:'), ang, el('span', {text:'°'}), btn('⇄', L3('反轉漸層', '反向渐变', 'Reverse Gradient'), () => runCmd('gradient.edit', {reverse:true, stroke:activeStroke()}), {disabled:!ok, dataset:{act:'reverse'}})));
      if (kind === 'radial'){ const asp = el('input', {type:'number', min:0.5, value:g.paint.aspect || 100, dataset:{k:'aspect'}}); asp.onchange = () => runCmd('gradient.edit', {aspect:+asp.value, stroke:activeStroke()}); b.appendChild(row(L3('外觀比例：', '长宽比：', 'Aspect Ratio:'), asp, el('span', {text:'%'}))); }
    }
    // 渐变滑块：色带＋色标（点＝选；点色带下方空白＝加色标；Alt+点色标＝删）＋中点菱形
    const bar = el('div', {class:'agbar', style:`position:relative;height:18px;border:1px solid #000;background:${ramp},repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/8px 8px;margin:6px 6px 0`});
    const track = el('div', {class:'agstops', style:'position:relative;height:16px;margin:0 6px 6px;cursor:copy', title:T(L3('按一下新增色標；Alt＋按一下色標刪除', '单击添加色标；Alt＋单击色标删除', 'Click to add a stop; Alt-click a stop to delete it'))});
    if (ok) track.onclick = e => { if (e.target !== track) return; const r = track.getBoundingClientRect(); runCmd('ai.gradient.addStop', {location:(e.clientX - r.left) / r.width * 100}); };
    stops.forEach((s, i) => { track.appendChild(el('div', {dataset:{stop:i}, title:`${s.color} ${Math.round(s.offset * 100)}%`, style:`position:absolute;left:calc(${s.offset * 100}% - 6px);top:0;width:12px;height:14px;background:${s.color};border:2px solid ${i === GP.stop ? '#2f7fd8' : '#888'};box-sizing:border-box;cursor:pointer`,
      onclick:e => { e.stopPropagation(); if (e.altKey){ runCmd('ai.gradient.deleteStop', {index:i}); return; } GP.stop = i; runCmd('gradient.selectStop', {index:i}); P.refresh('aiGradient'); }}));
      if (i < stops.length - 1){ const m = s.offset + (stops[i + 1].offset - s.offset) * s.midpoint; bar.appendChild(el('div', {dataset:{mid:i}, title:T(L3('中點', '中点', 'Midpoint')), style:`position:absolute;left:calc(${m * 100}% - 4px);top:-6px;width:8px;height:8px;background:#ddd;transform:rotate(45deg);cursor:pointer`, onclick:() => { GP.mid = i; P.refresh('aiGradient'); }})); } });
    b.appendChild(bar); b.appendChild(track);
    if (stops.length){ const s = stops[GP.stop];
      const op = el('input', {type:'number', min:0, max:100, value:Math.round(s.opacity * 100), dataset:{k:'stopOpacity'}}); op.onchange = () => runCmd('gradient.stopEdit', {index:GP.stop, opacity:+op.value});
      const loc = el('input', {type:'number', min:0, max:100, value:Math.round(s.offset * 100), dataset:{k:'stopLocation'}}); loc.onchange = () => runCmd('gradient.stopEdit', {index:GP.stop, location:+loc.value});
      const c = el('input', {type:'color', value:s.color, dataset:{k:'stopColor'}}); c.onchange = () => runCmd('gradient.stopEdit', {index:GP.stop, color:c.value});
      b.appendChild(row(L3('色標：', '色标：', 'Stop:'), c, el('span', {text:T(L3('不透明度：', '不透明度：', 'Opacity:'))}), op, el('span', {text:'%'})));
      b.appendChild(row(L3('位置：', '位置：', 'Location:'), loc, el('span', {text:'%'}), btn('🗑', L3('刪除色標', '删除色标', 'Delete Stop'), () => runCmd('ai.gradient.deleteStop', {index:GP.stop}), {disabled:stops.length <= 2, dataset:{act:'deleteStop'}})));
      if (GP.mid !== undefined && GP.mid < stops.length - 1){ const mp = el('input', {type:'number', min:13, max:87, value:Math.round(stops[GP.mid].midpoint * 100), dataset:{k:'midpoint'}}); mp.onchange = () => runCmd('ai.gradient.setMidpoint', {index:GP.mid, location:+mp.value});
        b.appendChild(row(L3('中點：', '中点：', 'Midpoint:'), mp, el('span', {text:'%'}))); }
    }
    if (!n) b.appendChild(el('div', {class:'hint', text:T(L3('選取物件後按類型套用漸層', '选中物件后按类型套用渐变', 'Select an object, then pick a type to apply a gradient'))}));
  },
  menu:() => { const g = peek('gradient.get', {stroke:activeStroke()}), ok = g && g.ok !== false && g.paint;
    return [hideItem('aiGradient'), {sep:true}, {label:L3('新增至色票', '添加到色板', 'Add to Swatches'), disabled:!ok, run:() => { const st = stopsOf(g); swList().push([uniqName(swList().map(x => ({name:x[0]})), 'New Gradient Swatch'), {kind:g.paint.kind || 'linear', stops:st.map(s => [s.offset, s.color])}]); P.refresh('aiSwatches'); }},
      {label:L3('反轉漸層', '反向渐变', 'Reverse Gradient'), disabled:!ok, run:() => runCmd('gradient.edit', {reverse:true, stroke:activeStroke()})},
      {label:L3('重設為白色至黑色', '重置为白色到黑色', 'Reset to White, Black'), disabled:!selInfo().n, run:() => runCmd('gradient.edit', {stops:[{offset:0, color:'#ffffff'}, {offset:1, color:'#000000'}], stroke:activeStroke()})}]; }});
/* 画板（panels/artboards.rs：编号清单（双击改名）、选项钮、↑↓、新建、删除；菜单） */
P.define('aiArtboards', {title:L3('工作區域', '画板', 'Artboards'), w:250,
  refresh(b, _a, why){ if (busy(b, why)) return; b.innerHTML = ''; const A = abList(); if (AiWindow.artboardSel >= A.length) AiWindow.artboardSel = A.length - 1; const sel0 = AiWindow.artboardSel;
    const list = el('div', {class:'list', style:'min-height:90px'}); b.appendChild(list);
    A.forEach((a, i) => { const r = el('div', {class:'li' + (i === sel0 ? ' on' : ''), dataset:{ab:i}, onclick:() => { CMD.map['ai.artboard.select'].run({index:i}); list.querySelectorAll('.li').forEach(x => x.classList.toggle('on', x === r));
          clearTimeout(AiWindow._abT); AiWindow._abT = setTimeout(() => { if (!r.querySelector('input')) P.refresh('aiArtboards'); }, 350); },     // 慢一拍再重画：免得双击改名的第二下点到重画后的新列
        ondblclick:() => { clearTimeout(AiWindow._abT); const inp = el('input', {type:'text', value:a.name, dataset:{k:'abName'}, style:'flex:1'}); nm.replaceWith(inp); inp.focus(); inp.select();
          let fdone = false; const fin = ok => { if (fdone) return; fdone = true; if (ok && inp.value.trim() && inp.value !== a.name) runCmd('ai.artboard.setProps', {index:i, name:inp.value.trim()}); P.refresh('aiArtboards'); };
          inp.onkeydown = e => { if (e.key === 'Enter') fin(true); else if (e.key === 'Escape') fin(false); e.stopPropagation(); }; inp.onblur = () => fin(true); }});
      const nm = el('span', {text:a.name, style:'flex:1'});
      r.appendChild(el('span', {text:String(i + 1), style:'width:16px;text-align:right;color:#999'})); r.appendChild(nm);
      r.appendChild(el('span', {class:'hint', text:`${Math.round(a.rect.x1 - a.rect.x0)}×${Math.round(a.rect.y1 - a.rect.y0)}`}));
      r.appendChild(el('span', {text:'⚙', style:'cursor:pointer', title:T(L3('工作區域選項', '画板选项', 'Artboard Options')), dataset:{abopt:i}, onclick:e => { e.stopPropagation(); runCmd('ai.artboard.select', {index:i}); runCmd('ai.artboard.options', {index:i}); }}));
      list.appendChild(r); });
    b.appendChild(el('div', {class:'bar'}, [btn('⊞', L3('重新排列所有工作區域', '重新排列所有画板', 'Rearrange All Artboards'), () => runCmd('ai.artboard.rearrange.dialog'), {disabled:!has('ai.artboard.rearrange.dialog') || A.length < 2}),
      btn('↑', L3('上移', '上移', 'Move Up'), () => runCmd('ai.artboard.reorder', {index:sel0, to:sel0 - 1}), {disabled:sel0 < 2, dataset:{act:'abUp'}}),
      btn('↓', L3('下移', '下移', 'Move Down'), () => runCmd('ai.artboard.reorder', {index:sel0, to:sel0 + 1}), {disabled:sel0 < 1 || sel0 + 1 >= A.length, dataset:{act:'abDown'}}),
      btn('＋', L3('新增工作區域', '新建画板', 'New Artboard'), () => runCmd('ai.artboard.new'), {dataset:{act:'abNew'}}),
      btn('🗑', L3('刪除工作區域', '删除画板', 'Delete Artboard'), () => runCmd('ai.artboard.delete', {index:sel0}), {disabled:A.length < 2 || sel0 === 0, dataset:{act:'abDelete'}})])); },
  menu:() => { const n = abList().length, i = AiWindow.artboardSel;
    return [{label:L3('新增工作區域', '新建画板', 'New Artboard'), run:() => runCmd('ai.artboard.new')}, {label:L3('複製工作區域', '复制画板', 'Duplicate Artboards'), run:() => runCmd('ai.artboard.duplicate', {index:i})},
      {label:L3('刪除工作區域', '删除画板', 'Delete Artboards'), disabled:n < 2 || i === 0, run:() => runCmd('ai.artboard.delete', {index:i})},
      {label:L3('重新命名', '重命名', 'Rename'), run:() => { const r = P.els.aiArtboards && P.els.aiArtboards.querySelector(`.li[data-ab="${i}"]`); if (r) r.dispatchEvent(new r.ownerDocument.defaultView.MouseEvent('dblclick', {bubbles:true})); }},
      {label:L3('刪除空白工作區域', '删除空画板', 'Delete Empty Artboards'), disabled:n < 2, run:() => runCmd('ai.artboard.deleteEmpty')}, {sep:true},
      {label:L3('轉換為工作區域', '转换为画板', 'Convert to Artboards'), disabled:!selInfo().n || !has('ai.artboard.convertToArtboards'), run:() => runCmd('ai.artboard.convertToArtboards')},
      {label:L3('工作區域選項…', '画板选项…', 'Artboard Options…'), run:() => runCmd('ai.artboard.options', {index:i})},
      {label:L3('重新排列所有工作區域…', '重新排列所有画板…', 'Rearrange All Artboards…'), disabled:n < 2 || !has('ai.artboard.rearrange.dialog'), run:() => runCmd('ai.artboard.rearrange.dialog')}, {sep:true},
      {label:L3('符合圖稿邊界', '适合图稿边界', 'Fit to Artwork Bounds'), disabled:!has('ai.artboard.fitToArt'), run:() => runCmd('ai.artboard.fitToArt', {index:i})}]; }});
/* 属性（attributes.rs） */
P.define('aiAttributes', {title:L3('屬性', '属性', 'Attributes'), w:260,
  menu:() => [hideItem('aiAttributes')],
  refresh(b, _a, why){ if (busy(b, why)) return;
    b.innerHTML = ''; const {n, t} = selInfo(), s = n ? t.R[0] : {}, dis = !n;
    const ck = (k, label) => { const c = el('input', {type:'checkbox', disabled:dis, dataset:{k}}); c.checked = !!s[k]; c.onchange = () => runCmd('ai.attributes.set', {[k]:c.checked}); return el('label', {class:'row'}, [c, el('span', {text:T(label)})]); };
    b.appendChild(el('div', {class:'row'}, [ck('overprintFill', L3('套印填色', '叠印填充', 'Overprint Fill')), ck('overprintStroke', L3('套印筆畫', '叠印描边', 'Overprint Stroke'))]));
    b.appendChild(el('div', {class:'grid'}, [btn(T(L3('不顯示中心', '不显示中心', "Don't Show Center")), null, () => runCmd('ai.attributes.set', {showCenter:false}), {disabled:dis, class:!s.showCenter ? 'on' : ''}), btn(T(L3('顯示中心', '显示中心', 'Show Center')), null, () => runCmd('ai.attributes.set', {showCenter:true}), {disabled:dis, class:s.showCenter ? 'on' : ''}),
      btn('⇄', L3('反轉路徑方向', '反转路径方向', 'Reverse Path Direction'), () => s.type === 'bezier' ? runCmd('pen.reverse', {shapeId:s.id, layerId:t.L.id}) : null, {disabled:dis || s.type !== 'bezier'}),
      btn(T(L3('非零', '非零缠绕', 'Non-Zero')), null, () => runCmd('ai.attributes.set', {fillRule:'nonZero'}), {disabled:dis, class:n && s.fillRule !== 'evenOdd' ? 'on' : '', dataset:{rule:'nonZero'}}),
      btn(T(L3('奇偶', '奇偶', 'Even-Odd')), null, () => runCmd('ai.attributes.set', {fillRule:'evenOdd'}), {disabled:dis, class:s.fillRule === 'evenOdd' ? 'on' : '', dataset:{rule:'evenOdd'}})]));
    if (HO.aiAttributes) return;
    const im = el('select', {disabled:dis}); [['none', L3('無', '无', 'None')], ['rectangle', L3('矩形', '矩形', 'Rectangle')], ['polygon', L3('多邊形', '多边形', 'Polygon')]].forEach(([v, nm]) => im.appendChild(el('option', {value:v, text:T(nm)}))); im.value = s.imageMap || 'none'; im.onchange = () => runCmd('ai.attributes.set', {imageMap:im.value});
    const url = el('input', {type:'text', value:s.url || '', disabled:dis, placeholder:'URL'}); url.onchange = () => runCmd('ai.attributes.set', {url:url.value});
    b.appendChild(row(L3('影像地圖：', '图像映射：', 'Image Map:'), im)); b.appendChild(row('URL:', url, btn(T(L3('瀏覽器', '浏览器', 'Browser')), null, () => { if (s.url) window.open(s.url, '_blank', 'noopener'); }, {disabled:!s.url})));
    const note = el('textarea', {rows:3, style:'width:100%;background:#1e1e1e;color:#ddd;border:1px solid #3a3a3a', disabled:dis}); note.value = s.note || ''; note.onchange = () => runCmd('ai.attributes.set', {note:note.value});
    b.appendChild(note);
  }});
/* 画笔（brushes.rs：按类型分段（书法／散布／艺术／毛刷／图案）的缩图格或列表（画出预览）；点＝套到选取（没选＝目前画笔）；底下：库（原码 roadmap）、移去画笔描边、扩展、新建、删除；菜单） */
const BKINDS = [['calligraphic', L3('書法', '书法', 'Calligraphic')], ['scatter', L3('散落', '散点', 'Scatter')], ['art', L3('線條圖', '艺术', 'Art')], ['bristle', L3('毛刷', '毛刷', 'Bristle')], ['pattern', L3('圖樣', '图案', 'Pattern')]];
function brushPreview(b, w, h){
  const c = el('canvas', {width:w * 2, height:h * 2, style:`width:${w}px;height:${h}px;background:#fff;display:block;pointer-events:none`}), x = c.getContext('2d');
  const s = {id:'pv' + b.name, type:'bezier', closed:false, fill:'none', stroke:'#000000', strokeWidth:1, anchors:[{x:h * 0.5, y:h * 0.5, in:null, out:[h * 0.5 + (w - h) * 0.35, h * 0.1]}, {x:w - h * 0.5, y:h * 0.5, in:[h * 0.5 + (w - h) * 0.65, h * 0.9], out:null}]};
  try { paintPieces(x, brushPieces(b, s, 2)); } catch(e){} return c;
}
P.define('aiBrushes', {title:L3('筆刷', '画笔', 'Brushes'), w:270,
  refresh(b){ b.innerHTML = ''; const L = brushList(), {n, t} = selInfo(), selB = n ? (t.R.flatMap(leaves).find(s => s.brush) || {}).brush : null;
    const list = el('div', {class:'list', style:'min-height:100px;padding:2px'}); b.appendChild(list);
    BKINDS.forEach(([k]) => { if (BR.hidden.includes(k)) return; const grp = L.filter(x => x.type === k); if (!grp.length) return;
      const box = el('div', {style:BR.view === 'list' ? '' : 'display:flex;flex-wrap:wrap;gap:3px;padding:2px 0'});
      grp.forEach(br => { const on = selB ? selB === br.name : BR.current === br.name, click = () => { runCmd(n ? 'ai.brush.apply' : 'ai.brush.setCurrent', {name:br.name}); P.refresh('aiBrushes'); };
        if (BR.view === 'list') box.appendChild(el('div', {class:'li' + (on ? ' on' : ''), dataset:{brush:br.name}, title:br.name, onclick:click}, [brushPreview(br, 72, 22), el('span', {text:br.name})]));
        else { const tl = el('div', {dataset:{brush:br.name}, title:br.name, onclick:click, style:`cursor:pointer;outline:${on ? '2px solid #2f7fd8' : '1px solid #444'}`}); tl.appendChild(brushPreview(br, 60, 26)); box.appendChild(tl); } });
      list.appendChild(box); list.appendChild(el('div', {class:'dlp-sep'})); });
    b.appendChild(el('div', {class:'bar'}, [btn('📚', L3('筆刷資料庫', '画笔库', 'Brush Libraries'), () => runCmd('ai.window.brushLibrary'), {disabled:!CMD.map['ai.window.brushLibrary']}),
      btn('✕', L3('移除筆刷筆畫', '移去画笔描边', 'Remove Brush Stroke'), () => runCmd('ai.brush.remove'), {disabled:!selB, dataset:{act:'removeBrush'}}),
      btn('⤢', L3('展開筆刷筆畫', '扩展画笔描边', 'Expand Brush Strokes'), () => runCmd('ai.brush.expand'), {disabled:!selB, dataset:{act:'expandBrush'}}),
      btn('＋', L3('從選取範圍建立線條圖筆刷', '用所选图稿新建艺术画笔', 'New Art Brush from Selection'), () => { runCmd('ai.brush.new', {type:'art'}); P.refresh('aiBrushes'); }, {disabled:!n, dataset:{act:'newBrush'}}),
      btn('🗑', L3('刪除筆刷', '删除画笔', 'Delete Brush'), () => { runCmd('ai.brush.delete', {name:selB || BR.current}); P.refresh('aiBrushes'); }, {disabled:!(selB || BR.current), dataset:{act:'deleteBrush'}})])); },
  menu:() => { const {n, t} = selInfo(), selB = n ? (t.R.flatMap(leaves).find(s => s.brush) || {}).brush : null, target = selB || BR.current, R = (c, p) => () => { runCmd(c, p || {}); P.refresh('aiBrushes'); };
    return [{label:L3('新增散落筆刷…', '新建散点画笔…', 'New Scatter Brush…'), disabled:!n, run:R('ai.brush.new', {type:'scatter'})}, {label:L3('新增線條圖筆刷…', '新建艺术画笔…', 'New Art Brush…'), disabled:!n, run:R('ai.brush.new', {type:'art'})},
      {label:L3('新增圖樣筆刷…', '新建图案画笔…', 'New Pattern Brush…'), disabled:!n, run:R('ai.brush.new', {type:'pattern'})},
      {label:L3('複製筆刷', '复制画笔', 'Duplicate Brush'), disabled:!target, run:R('ai.brush.duplicate', {name:target})}, {label:L3('刪除筆刷', '删除画笔', 'Delete Brush'), disabled:!target, run:R('ai.brush.delete', {name:target})},
      {label:L3('移除筆刷筆畫', '移去画笔描边', 'Remove Brush Stroke'), disabled:!selB, run:R('ai.brush.remove')}, {label:L3('展開筆刷筆畫', '扩展画笔描边', 'Expand Brush Strokes'), disabled:!selB, run:R('ai.brush.expand')}, {sep:true}]
      .concat(BKINDS.map(([k, nm]) => ({label:{'zh-Hant':'顯示' + nm['zh-Hant'] + '筆刷', 'zh-Hans':'显示' + nm['zh-Hans'] + '画笔', en:'Show ' + nm.en + ' Brushes'}, checked:!BR.hidden.includes(k), run:R('ai.brush.view', {show:{[k]:BR.hidden.includes(k)}})})))
      .concat([{sep:true}, {label:L3('縮圖檢視', '缩览图视图', 'Thumbnail View'), checked:BR.view !== 'list', run:R('ai.brush.view', {mode:'thumbnail'})}, {label:L3('清單檢視', '列表视图', 'List View'), checked:BR.view === 'list', run:R('ai.brush.view', {mode:'list'})}]); }});
/* 符号（symbols.rs：缩图格／列表；点＝选、双击＝置入；底下：库（原码 roadmap）、置入、替换、断开链接、新建、删除；菜单） */
function shapesThumb(shapes, size){
  const c = el('canvas', {width:size, height:size, style:`width:${size}px;height:${size}px;background:#fff;display:block;pointer-events:none`}), x = c.getContext('2d'), L = {x:0, y:0};
  const B = shapes.map(s => { try { return AIObj.shapeBounds(s, p => p, true); } catch(e){ return null; } }).filter(Boolean).reduce((r, q) => !r ? q : {x0:Math.min(r.x0, q.x0), y0:Math.min(r.y0, q.y0), x1:Math.max(r.x1, q.x1), y1:Math.max(r.y1, q.y1)}, null);
  if (!B) return c; void L; const k = (size - 4) / Math.max(1, B.x1 - B.x0, B.y1 - B.y0); x.translate(2 - B.x0 * k, 2 - B.y0 * k); try { shapes.forEach(s => window.drawShape(x, s, k)); } catch(e){} return c;
}
P.define('aiSymbols', {title:L3('符號', '符号', 'Symbols'), w:260,
  refresh(b){ b.innerHTML = ''; const S = store('aiSymbols'), {n, t} = selInfo(), inst = t.R.filter(s => s.symbol);
    const list = el('div', {class:AiWindow.symView === 'list' ? 'list' : 'grid', style:'min-height:60px'}); b.appendChild(list);
    if (!S.length) list.appendChild(el('div', {class:'hint', style:'padding:4px', text:T(L3('選取物件後按 ＋ 新增符號', '选中对象后按 ＋ 新建符号', 'Select art and click New Symbol to make one.'))}));
    S.forEach(s => { const on = AiWindow.curSymbol === s.name, pick = () => { AiWindow.curSymbol = s.name; P.refresh('aiSymbols'); }, place = () => runCmd('ai.symbol.place', {name:s.name});
      if (AiWindow.symView === 'list') list.appendChild(el('div', {class:'li' + (on ? ' on' : ''), dataset:{name:s.name}, onclick:pick, ondblclick:place}, [shapesThumb(s.shapes, 20), el('span', {text:s.name})]));
      else { const tl = el('div', {dataset:{name:s.name}, title:s.name, onclick:pick, ondblclick:place, style:`cursor:pointer;outline:${on ? '2px solid #2f7fd8' : '1px solid #444'}`}); tl.appendChild(shapesThumb(s.shapes, 40)); list.appendChild(tl); } });
    const cur = AiWindow.curSymbol && S.some(s => s.name === AiWindow.curSymbol);
    b.appendChild(el('div', {class:'bar'}, [btn('📚', L3('符號資料庫', '符号库', 'Symbol Libraries'), () => runCmd('ai.window.symbolLibrary'), {disabled:!CMD.map['ai.window.symbolLibrary']}),
      btn('⤓', L3('置入符號實例', '置入符号实例', 'Place Symbol Instance'), () => runCmd('ai.symbol.place', {name:AiWindow.curSymbol}), {disabled:!cur, dataset:{act:'place'}}),
      btn('⇆', L3('取代符號', '替换符号', 'Replace Symbol'), () => runCmd('ai.symbol.replace', {name:AiWindow.curSymbol}), {disabled:!cur || !inst.length, dataset:{act:'replace'}}),
      btn('⛓', L3('斷開符號連結', '断开符号链接', 'Break Link to Symbol'), () => runCmd('ai.symbol.breakLink'), {disabled:!inst.length, dataset:{act:'breakLink'}}),
      btn('＋', L3('新增符號', '新建符号', 'New Symbol'), () => { runCmd('ai.symbol.new'); P.refresh('aiSymbols'); }, {disabled:!n, dataset:{act:'new'}}),
      btn('🗑', L3('刪除符號', '删除符号', 'Delete Symbol'), () => { runCmd('ai.symbol.delete', {name:AiWindow.curSymbol}); P.refresh('aiSymbols'); }, {disabled:!cur, dataset:{act:'delete'}})])); },
  menu:() => { const S = store('aiSymbols'), c = AiWindow.curSymbol && S.some(s => s.name === AiWindow.curSymbol) ? AiWindow.curSymbol : null, {n, t} = selInfo(), inst = t.R.some(s => s.symbol), R = (k, p) => () => { runCmd(k, p || {}); P.refresh('aiSymbols'); };
    return [{label:L3('新增符號…', '新建符号…', 'New Symbol…'), disabled:!n, run:() => P.dialog({id:'aiNewSymbol', title:L3('符號選項', '符号选项', 'Symbol Options'), fields:[{k:'name', type:'text', label:L3('名稱：', '名称：', 'Name:'), value:uniqName(S, 'New Symbol')}], ok:v => { const r = CMD.run('ai.symbol.new', {name:v.name}); P.refresh('aiSymbols'); return r; }})},
      {label:L3('重新定義符號', '重新定义符号', 'Redefine Symbol'), disabled:!c || !n, run:R('ai.symbol.redefine', {name:c})}, {label:L3('複製符號', '复制符号', 'Duplicate Symbol'), disabled:!c, run:R('ai.symbol.duplicate', {name:c})},
      {label:L3('刪除符號', '删除符号', 'Delete Symbol'), disabled:!c, run:R('ai.symbol.delete', {name:c})}, {label:L3('編輯符號', '编辑符号', 'Edit Symbol'), disabled:true, run(){}}, {sep:true},
      {label:L3('置入符號實例', '置入符号实例', 'Place Symbol Instance'), disabled:!c, run:R('ai.symbol.place', {name:c})}, {label:L3('取代符號', '替换符号', 'Replace Symbol'), disabled:!c || !inst, run:R('ai.symbol.replace', {name:c})},
      {label:L3('斷開符號連結', '断开符号链接', 'Break Link to Symbol'), disabled:!inst, run:R('ai.symbol.breakLink')}, {label:L3('選取所有實例', '选择所有实例', 'Select All Instances'), disabled:!c, run:R('ai.symbol.selectInstances', {name:c})},
      {label:L3('符號選項…', '符号选项…', 'Symbol Options…'), disabled:!c, run:() => P.dialog({id:'aiSymbolOpts', title:L3('符號選項', '符号选项', 'Symbol Options'), fields:[{k:'to', type:'text', label:L3('名稱：', '名称：', 'Name:'), value:c}], ok:v => { const r = CMD.run('ai.symbol.rename', {name:c, to:v.to}); P.refresh('aiSymbols'); return r; }})}, {sep:true},
      {label:L3('縮圖檢視', '缩览图视图', 'Thumbnail View'), checked:AiWindow.symView !== 'list', run:() => { AiWindow.symView = 'grid'; P.refresh('aiSymbols'); }}, {label:L3('清單檢視', '列表视图', 'List View'), checked:AiWindow.symView === 'list', run:() => { AiWindow.symView = 'list'; P.refresh('aiSymbols'); }}]; }});
/* 图形样式（graphic_styles.rs：缩图（画在方块上）／小／大列表；点＝套用（Alt＝加上去）、Shift／Ctrl＝多选、双击＝选项；底下：库、断开链接、新建、删除；菜单） */
AiWindow.gsSel = []; AiWindow.gsView = 'thumb';
P.define('aiGraphicStyles', {title:L3('繪圖樣式', '图形样式', 'Graphic Styles'), w:260,
  refresh(b){ b.innerHTML = ''; const G = store('aiGraphicStyles'), V = AiWindow.gsView, box = el('div', {class:V === 'thumb' ? 'grid' : 'list'}); b.appendChild(box);
    G.forEach(g => { const on = AiWindow.gsSel.includes(g.name), sq = {id:'gs_' + g.name, type:'rect', x:6, y:6, w:28, h:28, radius:0, ...clone(g.look)};
      const click = e => { if (e.shiftKey || e.ctrlKey || e.metaKey){ AiWindow.gsSel = on ? AiWindow.gsSel.filter(x => x !== g.name) : AiWindow.gsSel.concat([g.name]); P.refresh('aiGraphicStyles'); return; } AiWindow.gsSel = [g.name]; runCmd('ai.graphicStyle.apply', {name:g.name, add:e.altKey}); P.refresh('aiGraphicStyles'); };
      const opts = () => P.dialog({id:'aiGsOpts', title:L3('繪圖樣式選項', '图形样式选项', 'Graphic Style Options'), fields:[{k:'to', type:'text', label:L3('樣式名稱：', '样式名称：', 'Style Name:'), value:g.name}], ok:v => { const r = CMD.run('ai.graphicStyle.rename', {name:g.name, to:v.to}); P.refresh('aiGraphicStyles'); return r; }});
      const cv = shapesThumb([sq], V === 'large' ? 40 : V === 'small' ? 18 : 40);
      if (V === 'thumb'){ const tl = el('div', {class:'sw', title:g.name, dataset:{name:g.name}, onclick:click, ondblclick:opts, style:`width:42px;height:42px;outline:${on ? '2px solid #2f7fd8' : 'none'}`}); tl.appendChild(cv); box.appendChild(tl); }
      else box.appendChild(el('div', {class:'li' + (on ? ' on' : ''), dataset:{name:g.name}, onclick:click, ondblclick:opts}, [cv, el('span', {text:g.name})])); });
    const one = AiWindow.gsSel.length === 1 && AiWindow.gsSel[0] !== G[0].name ? AiWindow.gsSel[0] : null;
    b.appendChild(el('div', {class:'bar'}, [btn('📚', L3('繪圖樣式資料庫', '图形样式库', 'Graphic Style Libraries'), e => { const pop = el('div', {class:'dlp-pop'}); const libs = CMD.map['ai.library.list'] ? (CMD.run('ai.library.list', {kind:'graphicStyle'}).libraries || []) : null; // 资料库面板（menus/impl/ai-libraries.js）
      if (libs) libs.forEach(l => pop.appendChild(el('div', {class:'dlp-pi', text:l.name, onclick:() => { pop.remove(); runCmd('ai.window.graphicStyleLibrary.open', {library:l.id}); }})));
      else Object.entries(STYLE_LIBS).forEach(([id, l]) => pop.appendChild(el('div', {class:'dlp-pi', text:l[0], onclick:() => { pop.remove(); runCmd('ai.window.graphicStyleLibrary', {library:id}); }}))); P.popup(pop, e.currentTarget, {above:true}); }),
      btn('⛓', L3('斷開繪圖樣式連結', '断开图形样式链接', 'Break Link to Graphic Style'), () => runCmd('ai.graphicStyle.breakLink'), {disabled:!selInfo().n, dataset:{act:'breakLink'}}),
      btn('＋', L3('新增繪圖樣式', '新建图形样式', 'New Graphic Style'), () => { runCmd('ai.graphicStyle.new'); P.refresh('aiGraphicStyles'); }, {disabled:!selInfo().n, dataset:{act:'new'}}),
      btn('🗑', L3('刪除繪圖樣式', '删除图形样式', 'Delete Graphic Style'), () => { AiWindow.gsSel.slice().forEach(nm => runCmd('ai.graphicStyle.delete', {name:nm})); AiWindow.gsSel = []; P.refresh('aiGraphicStyles'); }, {disabled:!one && AiWindow.gsSel.length < 2, dataset:{act:'delete'}})])); },
  menu:() => { const G = store('aiGraphicStyles'), sl = AiWindow.gsSel, one = sl.length === 1 ? sl[0] : null, R = (c, p) => () => { runCmd(c, p || {}); P.refresh('aiGraphicStyles'); };
    return [{label:L3('新增繪圖樣式…', '新建图形样式…', 'New Graphic Style…'), disabled:!selInfo().n, run:() => P.dialog({id:'aiNewGs', title:L3('繪圖樣式選項', '图形样式选项', 'Graphic Style Options'), fields:[{k:'name', type:'text', label:L3('樣式名稱：', '样式名称：', 'Style Name:'), value:uniqName(G, 'Graphic Style')}], ok:v => { const r = CMD.run('ai.graphicStyle.new', {name:v.name}); P.refresh('aiGraphicStyles'); return r; }})},
      {label:L3('複製繪圖樣式', '复制图形样式', 'Duplicate Graphic Style'), disabled:!one, run:R('ai.graphicStyle.duplicate', {name:one})}, {label:L3('合併繪圖樣式', '合并图形样式', 'Merge Graphic Styles'), disabled:sl.length < 2, run:R('ai.graphicStyle.merge', {names:sl})},
      {label:L3('刪除繪圖樣式', '删除图形样式', 'Delete Graphic Style'), disabled:!sl.length, run:() => { sl.slice().forEach(nm => runCmd('ai.graphicStyle.delete', {name:nm})); AiWindow.gsSel = []; P.refresh('aiGraphicStyles'); }}, {sep:true},
      {label:L3('斷開繪圖樣式連結', '断开图形样式链接', 'Break Link to Graphic Style'), disabled:!selInfo().n, run:R('ai.graphicStyle.breakLink')}, {label:L3('選取所有未使用的', '选择所有未使用的样式', 'Select All Unused'), run:R('ai.graphicStyle.unused')},
      {label:L3('依名稱排序', '按名称排序', 'Sort by Name'), run:R('ai.graphicStyle.sortByName')}, {sep:true},
      ...[['thumb', L3('縮圖檢視', '缩览图视图', 'Thumbnail View')], ['small', L3('小型清單檢視', '小列表视图', 'Small List View')], ['large', L3('大型清單檢視', '大列表视图', 'Large List View')]].map(([v, nm]) => ({label:nm, checked:AiWindow.gsView === v, run:() => { AiWindow.gsView = v; P.refresh('aiGraphicStyles'); }})), {sep:true},
      {label:L3('取代字元顏色', '覆盖字符颜色', 'Override Character Color'), disabled:true, run(){}}, {label:L3('繪圖樣式選項…', '图形样式选项…', 'Graphic Style Options…'), disabled:!one, run:() => P.dialog({id:'aiGsOpts', title:L3('繪圖樣式選項', '图形样式选项', 'Graphic Style Options'), fields:[{k:'to', type:'text', label:L3('樣式名稱：', '样式名称：', 'Style Name:'), value:one}], ok:v => { const r = CMD.run('ai.graphicStyle.rename', {name:one, to:v.to}); P.refresh('aiGraphicStyles'); return r; }})}]; }});
/* 文档信息（doc_info.rs：仅所选对象、全部类别／单一类别、存储…） */
const DI_CATS = [['document', 'Document'], ['objects', 'Objects'], ['fonts', 'Fonts']];
P.define('aiDocInfo', {title:L3('文件資訊', '文档信息', 'Document Info'), w:260,
  menu:() => [{label:L3('僅限選取範圍', '仅所选对象', 'Selection Only'), checked:!!AiWindow.diSel, run:() => { AiWindow.diSel = !AiWindow.diSel; P.refresh('aiDocInfo'); }}, {sep:true},
    {label:L3('所有類別', '全部类别', 'All Categories'), checked:!AiWindow.diCat, run:() => { AiWindow.diCat = null; P.refresh('aiDocInfo'); }},
    ...DI_CATS.map(([k, nm]) => ({label:{'zh-Hant':nm, 'zh-Hans':nm, en:nm}, checked:AiWindow.diCat === k, run:() => { AiWindow.diCat = k; P.refresh('aiDocInfo'); }})), {sep:true},
    {label:L3('儲存…', '存储…', 'Save…'), run:() => runCmd('ai.document.info.save', {selectionOnly:!!AiWindow.diSel})}],
  refresh(b){ b.innerHTML = ''; const r = CMD.map['ai.document.info'].run({selectionOnly:!!AiWindow.diSel}), c = AiWindow.diCat;
    const kv = o => { const d = el('div', {class:'kv'}); Object.entries(o).forEach(([k, v]) => { d.appendChild(el('b', {text:k + ':'})); d.appendChild(el('span', {text:String(v)})); }); return d; };
    if (!c || c === 'document'){ b.appendChild(el('div', {class:'sec', text:'Document'})); b.appendChild(kv(r.document)); }
    if (!c || c === 'objects'){ b.appendChild(el('div', {class:'sec', text:'Objects'})); b.appendChild(kv(r.objects)); }
    if (!c || c === 'fonts'){ b.appendChild(el('div', {class:'sec', text:'Fonts'})); b.appendChild(el('div', {class:'hint', text:r.fonts.join(', ') || 'None'})); } }});
/* 链接（links.rs：清单＝置入的影像（像素层、智能对象），状态 链接／嵌入／遗失；链接资讯；底下：重新链接、转至链接、更新链接、编辑原稿（灰）；菜单） */
AiWindow.linkShow = 'all'; AiWindow.linkInfo = true;
P.define('aiLinks', {title:L3('連結', '链接', 'Links'), w:270,
  refresh(b){ b.innerHTML = ''; const R = (peek('ai.links.list', {show:AiWindow.linkShow}) || {}).links || [], list = el('div', {class:'list'}); b.appendChild(list);
    const curL = Doc.active(), cid = curL && (curL.kind === 'raster' || curL.kind === 'smart') ? curL.id : null;
    R.forEach(x => list.appendChild(el('div', {class:'li' + (x.id === cid ? ' on' : ''), dataset:{id:x.id, status:x.status}, onclick:() => runCmd('layer.select', {id:x.id}), ondblclick:() => runCmd('ai.links.goTo', {id:x.id})},
      [el('span', {text:x.name, style:'flex:1'}), el('span', {text:x.status === 'embedded' ? '▣' : x.status === 'missing' ? '⚠' : '🔗', title:x.status})])));
    if (!R.length) list.appendChild(el('div', {class:'hint', style:'padding:4px', text:T(L3('沒有影像', '没有图像', 'No images'))}));
    const x = R.find(y => y.id === cid);
    if (x && AiWindow.linkInfo){ b.appendChild(el('div', {class:'sec', text:T(L3('連結資訊', '链接信息', 'Link Info'))}));
      b.appendChild(el('div', {class:'kv'}, [['Name', x.name], ['Format', x.format], ['Color Space', x.colorSpace], ['Location', x.fileId ? 'cloud:' + x.fileId : '—'], ['PPI', x.ppi], ['Dimensions', `${x.width} × ${x.height}`], ['Status', x.status === 'linked' ? 'Linked' : x.status === 'missing' ? 'Missing' : 'Embedded']]
        .flatMap(([k, v]) => [el('b', {text:k + ':'}), el('span', {text:String(v)})]))); }
    b.appendChild(el('div', {class:'bar'}, [btn(T(L3('重新連結…', '重新链接…', 'Relink…')), null, () => runCmd('ai.links.relink', {id:cid}), {disabled:!cid, dataset:{act:'relink'}}),
      btn(T(L3('跳至連結', '转至链接', 'Go To Link')), null, () => runCmd('ai.links.goTo', {id:cid}), {disabled:!cid, dataset:{act:'goTo'}}),
      btn(T(L3('更新連結', '更新链接', 'Update Link')), null, () => runCmd('ai.links.update', {id:cid}), {disabled:!(x && x.status === 'linked'), dataset:{act:'update'}}),
      btn(T(L3('編輯原稿', '编辑原稿', 'Edit Original')), L3('未做：網頁版沒有外部編輯程式', '未做：网页版没有外部编辑程序', 'Not done: no external editor on the web'), null, {disabled:true})])); },
  menu:() => { const L = Doc.active(), cid = L && (L.kind === 'raster' || L.kind === 'smart') ? L.id : null, x = cid ? ((peek('ai.links.list', {}) || {}).links || []).find(y => y.id === cid) : null;
    const show = v => ({label:{all:L3('全部顯示', '显示全部', 'Show All'), missing:L3('顯示遺失', '显示缺失', 'Show Missing'), modified:L3('顯示修改', '显示已修改', 'Show Modified'), embedded:L3('顯示嵌入', '显示嵌入', 'Show Embedded')}[v], checked:AiWindow.linkShow === v, run:() => { AiWindow.linkShow = v; P.refresh('aiLinks'); }});
    return [{label:L3('重新連結…', '重新链接…', 'Relink…'), disabled:!cid, run:() => runCmd('ai.links.relink', {id:cid})}, {label:L3('重新連結至資料夾…', '重新链接到文件夹…', 'Relink to Folder…'), disabled:true, run(){}},
      {label:L3('跳至連結', '转至链接', 'Go To Link'), disabled:!cid, run:() => runCmd('ai.links.goTo', {id:cid})}, {label:L3('更新連結', '更新链接', 'Update Link'), disabled:!(x && x.status === 'linked'), run:() => runCmd('ai.links.update', {id:cid})},
      {label:L3('編輯原稿', '编辑原稿', 'Edit Original'), disabled:true, run(){}}, {sep:true},
      {label:L3('嵌入影像', '嵌入图像', 'Embed Image(s)'), disabled:!(x && x.status !== 'embedded'), run:() => runCmd('ai.links.embed', {id:cid})}, {label:L3('取消嵌入…', '取消嵌入…', 'Unembed…'), disabled:true, run(){}},
      {label:L3('置入選項…', '置入选项…', 'Placement Options…'), disabled:true, run(){}}, {label:L3('在 Finder 中顯示', '在 Finder 中显示', 'Show in Folder'), disabled:!(x && x.fileId && window.__dlSiteHooks && __dlSiteHooks.revealRef), run:() => __dlSiteHooks.revealRef({file_id:x.fileId})}, {sep:true},
      show('all'), show('missing'), show('modified'), show('embedded'), {sep:true},
      {label:L3('顯示連結資訊', '显示链接信息', 'Show Link Info'), checked:AiWindow.linkInfo, run:() => { AiWindow.linkInfo = !AiWindow.linkInfo; P.refresh('aiLinks'); }}]; }});
/* 魔棒（magic_wand.rs → wand.vecOptions；菜单：显示／隐藏描边选项、透明度选项、重置） */
AiWindow.mwShow = {stroke:true, transparency:true};
P.define('aiMagicWand', {title:L3('魔術棒', '魔棒', 'Magic Wand'), w:270,
  refresh(b, _a, why){ if (busy(b, why)) return;
    b.innerHTML = ''; const o = peek('wand.vecOptions', {}) || {};
    const rowW = (ck, tol, label, max) => { const c = el('input', {type:'checkbox', dataset:{k:ck}}); c.checked = !!o[ck]; c.onchange = () => runCmd('wand.vecOptions', {[ck]:c.checked});
      const t = tol ? el('input', {type:'number', min:0, max, value:o[tol], dataset:{k:tol}}) : null; if (t) t.onchange = () => runCmd('wand.vecOptions', {[tol]:+t.value});
      return el('div', {class:'row'}, [c, el('span', {text:T(label), style:'flex:1'}), t ? el('span', {text:T(L3('容許度：', '容差：', 'Tolerance:'))}) : null, t]); };
    b.appendChild(rowW('fillColor', 'fillTolerance', L3('填色', '填充颜色', 'Fill Color'), 255));
    if (AiWindow.mwShow.stroke){ b.appendChild(rowW('strokeColor', 'strokeTolerance', L3('筆畫顏色', '描边颜色', 'Stroke Color'), 255)); b.appendChild(rowW('strokeWeight', 'weightTolerance', L3('筆畫寬度', '描边粗细', 'Stroke Weight'), 1000)); }
    if (AiWindow.mwShow.transparency){ b.appendChild(rowW('opacity', 'opacityTolerance', L3('不透明度', '不透明度', 'Opacity'), 100)); b.appendChild(rowW('blendingMode', null, L3('漸變模式', '混合模式', 'Blending Mode'))); }
  },
  menu:() => [['stroke', L3('筆畫選項', '描边选项', 'Stroke Options')], ['transparency', L3('透明度選項', '透明度选项', 'Transparency Options')]].map(([k, nm]) => ({label:{'zh-Hant':(AiWindow.mwShow[k] ? '隱藏' : '顯示') + nm['zh-Hant'], 'zh-Hans':(AiWindow.mwShow[k] ? '隐藏' : '显示') + nm['zh-Hans'], en:(AiWindow.mwShow[k] ? 'Hide ' : 'Show ') + nm.en}, run:() => { AiWindow.mwShow[k] = !AiWindow.mwShow[k]; P.refresh('aiMagicWand'); }}))
    .concat([{sep:true}, {label:L3('重設', '重置', 'Reset'), run:() => { runCmd('wand.vecOptions', {reset:true}); P.refresh('aiMagicWand'); }}])});
/* 分色预览（separations.rs；菜单：叠印预览、校样颜色、显示所有版） */
P.define('aiSeparations', {title:L3('分色預視', '分色预览', 'Separations Preview'), w:250,
  menu:() => [{label:L3('疊印預視', '叠印预览', 'Overprint Preview'), checked:!!(window.AiView && AiView.flags.overprintPreview), disabled:!has('ai.view.overprintPreview'), run:() => runCmd('ai.view.overprintPreview')},
    {label:L3('校樣色彩', '校样颜色', 'Proof Colors'), checked:!!(window.AiView && AiView.flags.proofColors), disabled:!has('ai.view.proofColors'), run:() => runCmd('ai.view.proofColors', {on:!(window.AiView && AiView.flags.proofColors)})},
    {label:L3('顯示所有色版', '显示所有版', 'Show All Plates'), disabled:!Sep.on, run:() => runCmd('ai.view.separationsPreview', {all:true, on:true})}],
  refresh(b){ b.innerHTML = '';
    const on = el('input', {type:'checkbox', dataset:{k:'on'}}); on.checked = Sep.on; on.onchange = () => runCmd('ai.view.separationsPreview', {on:on.checked});
    b.appendChild(el('label', {class:'row'}, [on, el('span', {text:T(L3('疊印預視（分色）', '叠印预览（分色）', 'Overprint Preview (separations)'))})]));
    const list = el('div', {class:'list'}); b.appendChild(list);
    list.appendChild(el('div', {class:'li', onclick:() => runCmd('ai.view.separationsPreview', {all:true, on:true})}, [el('span', {text:Object.values(Sep.plates).every(Boolean) ? '◉' : '○'}), el('span', {text:'CMYK'})]));
    [['C', 'Cyan', '#00aeef'], ['M', 'Magenta', '#ec008c'], ['Y', 'Yellow', '#fff200'], ['K', 'Black', '#000']].forEach(([k, n, c]) => list.appendChild(el('div', {class:'li', dataset:{plate:k},
      onclick:e => runCmd('ai.view.separationsPreview', e.altKey ? {only:k} : {toggle:k})}, [el('span', {text:Sep.plates[k] ? '◉' : '○'}), el('span', {style:`width:10px;height:10px;background:${c};display:inline-block`}), el('span', {text:n})])));
    b.appendChild(el('div', {class:'sec', text:T(L3('校樣設定', '校样设置', 'Proof Setup'))}));
    const tg = el('select'); [['legacyMacRgb', 'Legacy Macintosh RGB (Gamma 1.8)'], ['srgb', 'Internet Standard RGB (sRGB)'], ['monitorRgb', 'Monitor RGB'], ['protanopia', 'Color blindness – Protanopia-type'], ['deuteranopia', 'Color blindness – Deuteranopia-type']]
      .forEach(([v, nm]) => tg.appendChild(el('option', {value:v, text:nm}))); if (window.AiView) tg.value = AiView.proof.target; tg.onchange = () => runCmd('ai.view.proofSetup', {target:tg.value});
    b.appendChild(tg);
    const pc = el('input', {type:'checkbox'}); pc.checked = !!(window.AiView && AiView.flags.proofColors); pc.onchange = () => runCmd('ai.view.proofColors', {on:pc.checked});
    b.appendChild(el('label', {class:'row'}, [pc, el('span', {text:T(L3('校樣色彩', '校样颜色', 'Proof Colors'))})])); }});
/* CSS 属性（css_properties.rs：选中物件的 CSS；产生全部 CSS；菜单：复制所选样式、导出所选 CSS…、全部导出…、产生 CSS、绝对位置、宽度和高度） */
const CSSO = AiWindow.cssOpts = {position:false, dimensions:true, all:false};
P.define('aiCss', {title:L3('CSS 內容', 'CSS 属性', 'CSS Properties'), w:300, h:280,
  menu:() => [{label:L3('拷貝選取的樣式', '复制所选样式', 'Copy Selected Style'), disabled:!selInfo().n, run:() => { const r = CMD.map['ai.css.selection'].run({position:CSSO.position, dimensions:CSSO.dimensions}); try { navigator.clipboard.writeText(r.css); } catch(e){} }},
    {label:L3('轉存選取的 CSS…', '导出所选 CSS…', 'Export Selected CSS…'), disabled:!selInfo().n, run:() => runCmd('ai.css.export', {position:CSSO.position, dimensions:CSSO.dimensions})},
    {label:L3('全部轉存…', '全部导出…', 'Export All…'), run:() => runCmd('ai.css.export', {all:true, position:CSSO.position, dimensions:CSSO.dimensions})}, {sep:true},
    {label:L3('產生 CSS', '生成 CSS', 'Generate CSS'), checked:CSSO.all, run:() => { CSSO.all = !CSSO.all; P.refresh('aiCss'); }}, {sep:true},
    {label:L3('絕對位置', '绝对位置', 'Absolute Position'), checked:CSSO.position, run:() => { CSSO.position = !CSSO.position; P.refresh('aiCss'); }},
    {label:L3('寬度和高度', '宽度和高度', 'Width and Height'), checked:CSSO.dimensions, run:() => { CSSO.dimensions = !CSSO.dimensions; P.refresh('aiCss'); }},
    {label:L3('未命名物件', '未命名对象', 'Unnamed Objects'), checked:true, disabled:true, run(){}}, {label:L3('點陣化不支援的圖稿', '栅格化不受支持的图稿', 'Rasterize Unsupported Art'), disabled:true, run(){}}],
  refresh(b){ b.innerHTML = ''; const css = CSSO.all && !selInfo().n ? ((peek('ai.css.export', {all:true, render:true, position:CSSO.position, dimensions:CSSO.dimensions}) || {}).css || '') : CMD.map['ai.css.selection'].run({position:CSSO.position, dimensions:CSSO.dimensions}).css;
    const pre = el('pre', {style:'background:#1e1e1e;border:1px solid #3a3a3a;padding:6px;margin:0;min-height:120px;white-space:pre-wrap;font:11px monospace', text:css || T(L3('選取物件以檢視 CSS，或「產生 CSS」看整份文件', '选择对象以查看 CSS，或「生成 CSS」看整份文件', 'Select objects to see their CSS, or Generate CSS for the whole document.')), class:'csspre'});
    b.appendChild(pre);
    b.appendChild(el('div', {class:'bar'}, [btn(T(L3('拷貝', '复制', 'Copy')), null, () => { try { navigator.clipboard.writeText(css); } catch(e){} }, {disabled:!css}),
      btn(T(L3('轉存…', '导出…', 'Export…')), null, () => runCmd('ai.css.export', {all:CSSO.all && !selInfo().n, position:CSSO.position, dimensions:CSSO.dimensions}), {disabled:!css, dataset:{act:'cssExport'}})])); }});
/* 拼合器预览（flattener_preview.rs：反白 透明物件＝不透明度<100%、混合模式不是正常、有不透明蒙版；菜单：刷新、显示选项、适合窗口、存储预设（灰）） */
const FL = {hl:'transparent', opts:true};
P.define('aiFlattener', {title:L3('平面化預視', '拼合器预览', 'Flattener Preview'), w:280,
  menu:() => [{label:L3('重新整理', '刷新', 'Refresh'), run:() => P.refresh('aiFlattener')}, {label:L3('顯示選項', '显示选项', 'Show Options'), checked:FL.opts, run:() => { FL.opts = !FL.opts; P.refresh('aiFlattener'); }},
    {label:L3('符合視窗大小', '适合窗口大小', 'Fit in Window'), run:() => P.refresh('aiFlattener')}, {label:L3('儲存透明度平面化預設集…', '存储透明度拼合器预设…', 'Save Transparency Flattener Preset…'), disabled:true, run(){}}],
  refresh(b){ b.innerHTML = '';
    const hs = el('select', {dataset:{k:'highlight'}}); [['none', 'None (Color Preview)'], ['transparent', 'Transparent Objects'], ['affected', 'All Affected Objects']].forEach(([v, n]) => hs.appendChild(el('option', {value:v, text:n}))); hs.value = FL.hl; hs.onchange = () => { FL.hl = hs.value; P.refresh('aiFlattener'); };
    b.appendChild(el('div', {class:'row'}, [btn(T(L3('重新整理', '刷新', 'Refresh')), null, () => P.refresh('aiFlattener'), {dataset:{act:'refresh'}}), el('span', {text:T(L3('反白：', '突出显示：', 'Highlight:'))}), hs]));
    if (FL.opts) b.appendChild(el('div', {class:'hint', text:T(L3('疊印：保留　預設集：[中解析度]', '叠印：保留　预设：[中分辨率]', 'Overprints: Preserve   Preset: [Medium Resolution]'))}));
    const k = Math.min(260 / Doc.width, 160 / Doc.height), cv = el('canvas', {width:Math.round(Doc.width * k), height:Math.round(Doc.height * k), style:'display:block;margin-top:6px;background:#fff'}); b.appendChild(cv);
    const x = cv.getContext('2d'); let n = 0;
    try { x.drawImage(composite(k), 0, 0); } catch(e){}
    if (FL.hl !== 'none'){ x.fillStyle = 'rgba(128,128,128,.7)'; x.fillRect(0, 0, cv.width, cv.height);
      const boxes = [];
      Doc.layers.forEach(L => { if (L.kind !== 'vector' || !L.visible) return; L.data.shapes.forEach(s => { const tr = (s.opacity !== undefined && s.opacity < 1) || (s.blend && s.blend !== 'normal') || !!s.opMask;
        const r = bounds(L, s, true); if (!r) return; if (tr){ n++; boxes.push(r); } else if (FL.hl === 'affected' && boxes.some(q => q.x0 < r.x1 && q.x1 > r.x0 && q.y0 < r.y1 && q.y1 > r.y0)){ n++; boxes.push(r); } }); });
      boxes.forEach(r => { x.fillStyle = 'rgba(255,0,0,.75)'; x.fillRect(r.x0 * k, r.y0 * k, (r.x1 - r.x0) * k, (r.y1 - r.y0) * k); }); }
    b.appendChild(el('div', {class:'hint', dataset:{k:'count'}, text:`${n} objects/areas highlighted`})); }});
/* 资源导出（asset_export.rs：资源缩图格（点选、Shift 多选、双击改名）、拖拉区＝＋；导出设定（格式列：PNG／JPG／SVG × 倍率 × 后缀，可加列）、导出；菜单） */
P.define('aiAssetExport', {title:L3('資產轉存', '资源导出', 'Asset Export'), w:290,
  refresh(b, _a, why){ if (busy(b, why)) return; b.innerHTML = ''; const A = (peek('ai.assets.list', {}) || {}).assets || []; AE.sel = AE.sel.filter(id => A.some(a => a.id === id));
    const g = el('div', {class:'grid', style:'min-height:50px;border:1px dashed #555;padding:4px'}); b.appendChild(g);
    A.forEach(a => { const on = AE.sel.includes(a.id), x = (window.AiR3 && AiR3.doc ? AiR3.doc('assets').list : []).find(v => v.id === a.id), c = x && AiR3.renderAsset ? AiR3.renderAsset(x, Math.min(1, 56 / Math.max(1, a.bounds ? Math.max(a.bounds[2], a.bounds[3]) : 56))) : null;
      const tl = el('div', {dataset:{asset:a.id}, title:a.name + '\n' + T(L3('按兩下重新命名', '双击重命名', 'Double-click to rename')), style:`width:64px;cursor:pointer;text-align:center;font-size:10px;outline:${on ? '2px solid #2f7fd8' : '1px solid #3a3a3a'}`,
        onclick:e => { AE.sel = e.shiftKey || e.ctrlKey || e.metaKey ? (on ? AE.sel.filter(i => i !== a.id) : AE.sel.concat([a.id])) : [a.id]; P.refresh('aiAssetExport'); },
        ondblclick:() => P.dialog({id:'aiAssetName', title:L3('重新命名資產', '重命名资源', 'Rename Asset'), fields:[{k:'name', type:'text', label:L3('名稱：', '名称：', 'Name:'), value:a.name}], ok:v => { const r = CMD.run('ai.assets.rename', {asset:a.id, name:v.name}); P.refresh('aiAssetExport'); return r; }})});
      const th = el('div', {style:'height:44px;display:flex;align-items:center;justify-content:center;background:#fff'}); if (c){ c.style.maxWidth = '60px'; c.style.maxHeight = '42px'; th.appendChild(c); } tl.appendChild(th); tl.appendChild(el('div', {text:a.name, style:'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'})); g.appendChild(tl); });
    if (!A.length) g.appendChild(el('div', {class:'hint', text:T(L3('把圖稿拖到這裡或按「＋」收集資產', '把图稿拖到这里或按「＋」收集资源', 'Drag art here or press + to collect assets'))}));
    b.appendChild(el('div', {class:'bar', style:'justify-content:flex-start'}, [btn('＋', L3('加入選取的圖稿（Alt：作為單一資產）', '添加所选图稿（Alt：作为单个资源）', 'Add Selected Artwork (Alt: as one asset)'), e => { runCmd('ai.assets.add', {multiple:!e.altKey}); P.refresh('aiAssetExport'); }, {disabled:!selInfo().n, dataset:{act:'add'}}),
      btn('🗑', L3('移除選取的資產', '移去所选资源', 'Remove Selected Assets'), () => { runCmd('ai.assets.remove', {assets:AE.sel}); AE.sel = []; P.refresh('aiAssetExport'); }, {disabled:!AE.sel.length, dataset:{act:'remove'}})]));
    b.appendChild(el('div', {class:'sec', text:T(L3('轉存設定', '导出设置', 'Export Settings'))}));
    AE.formats.forEach((f, i) => { const sc = el('select', {dataset:{fmtScale:i}}); [0.5, 1, 1.5, 2, 3, 4].forEach(v => sc.appendChild(el('option', {value:v, text:v + 'x'}))); sc.value = f.scale; sc.disabled = f.format === 'svg';
      const sf = el('input', {type:'text', value:f.suffix, placeholder:T(L3('後置字元', '后缀', 'Suffix')), style:'width:56px', dataset:{fmtSuffix:i}});
      const fm = el('select', {dataset:{fmtFormat:i}}); [['png', 'PNG'], ['jpg', 'JPG'], ['svg', 'SVG']].forEach(([v, nm]) => fm.appendChild(el('option', {value:v, text:nm}))); fm.value = f.format;
      const upd = () => { const F = clone(AE.formats); F[i] = {format:fm.value, scale:+sc.value, suffix:sf.value}; runCmd('ai.assets.settings', {formats:F}); P.refresh('aiAssetExport'); };
      sc.onchange = upd; sf.onchange = upd; fm.onchange = upd;
      b.appendChild(el('div', {class:'row'}, [sc, sf, fm, btn('−', null, () => { runCmd('ai.assets.settings', {formats:AE.formats.filter((_, j) => j !== i)}); P.refresh('aiAssetExport'); }, {disabled:AE.formats.length < 2})])); });
    b.appendChild(el('div', {class:'bar'}, [btn(T(L3('＋ 新增縮放', '＋ 添加缩放', '+ Add Scale')), null, () => { runCmd('ai.assets.settings', {formats:AE.formats.concat([{format:'png', scale:2, suffix:'@2x'}])}); P.refresh('aiAssetExport'); }, {dataset:{act:'addScale'}}),
      btn(T(L3('轉存', '导出', 'Export')), L3('轉存選取的資產（沒選＝全部）', '导出所选资源（没选＝全部）', 'Export the selected assets (else all of them)'), () => runCmd('ai.assets.exportAs', {}), {disabled:!A.length, dataset:{act:'export'}})])); },
  menu:() => { const A = (peek('ai.assets.list', {}) || {}).assets || [], n = selInfo().n;
    return [{label:L3('將選取的圖稿加入為單一資產', '将所选图稿添加为单个资源', 'Add Selected Artwork as One Asset'), disabled:!n, run:() => { runCmd('ai.assets.add', {multiple:false}); P.refresh('aiAssetExport'); }},
      {label:L3('將選取的圖稿加入為多個資產', '将所选图稿添加为多个资源', 'Add Selected Artwork as Multiple Assets'), disabled:!n, run:() => { runCmd('ai.assets.add', {multiple:true}); P.refresh('aiAssetExport'); }}, {sep:true},
      {label:L3('選取所有資產', '选择所有资源', 'Select All Assets'), disabled:!A.length, run:() => { AE.sel = A.map(a => a.id); P.refresh('aiAssetExport'); }},
      {label:L3('移除選取的資產', '移去所选资源', 'Remove Selected Assets'), disabled:!AE.sel.length, run:() => { runCmd('ai.assets.remove', {assets:AE.sel}); AE.sel = []; P.refresh('aiAssetExport'); }}, {sep:true},
      {label:L3('轉存為螢幕適用…', '导出为多种屏幕所用格式…', 'Export for Screens…'), disabled:!has('ai.file.exportForScreens'), run:() => runCmd('ai.file.exportForScreens')}]; }});
/* 图像描摹（image_trace.rs）：正式面板在 menus/impl/ai-trace.js（来源像素层下拉＋输出新矢量层，后载会盖掉这里）；没载它时这里退回开 ai-object.js 的「图像描摹 ▸ 建立」对话框 */
P.define('aiImageTrace', {title:L3('影像描圖', '图像描摹', 'Image Trace'), w:270,
  refresh(b){ b.innerHTML = ''; b.appendChild(el('div', {class:'hint', text:T(L3('選取影像後按「描圖」', '选中图像后按「描摹」', 'Select an image, then Trace'))}));
    b.appendChild(el('div', {class:'bar'}, [btn(T(L3('描圖…', '描摹…', 'Trace…')), null, () => runCmd('ai.imageTrace.make.dialog', {}), {disabled:!has('ai.imageTrace.make.dialog'), dataset:{act:'trace'}})])); }});
/* 库（mod.rs:168-180 原码就是这段说明） */
P.define('aiLibraries', {title:L3('資料庫', '库', 'Libraries'), w:250,
  refresh(b){ b.innerHTML = ''; b.appendChild(el('div', {style:'font-size:36px;text-align:center', text:'📚'})); b.appendChild(el('div', {style:'text-align:center;font-weight:600', text:T(L3('本機資料庫', '本地库', 'Local Libraries'))}));
    b.appendChild(el('div', {class:'hint', style:'text-align:center', text:T(L3('把圖稿、顏色與文字樣式拖到這裡，就能在不同文件間重複使用。資料庫存在這台機器上，不用帳號。', '把图稿、颜色和文字样式拖到这里，就能在不同文档之间重复使用。库存在这台机器上，不需要账号。', 'Drag art, colors and text styles here to reuse them across documents. Libraries are stored on this machine — no account required.'))})); }});
/* 图案选项（pattern_options.rs：只在图案编辑模式能改；栏位接 ai-object.js 的 ai.pattern.options、ai.object.pattern.done／cancel／saveCopy／edit） */
P.define('aiPatternOptions', {title:L3('圖樣選項', '图案选项', 'Pattern Options'), w:280,
  menu:() => { const pe = Doc.aiR3 && Doc.aiR3.patternEdit;
    return [{label:L3('儲存拷貝', '存储副本', 'Save a Copy'), disabled:!pe, run:() => runCmd('ai.object.pattern.saveCopy')}, {label:L3('完成', '完成', 'Done'), disabled:!pe, run:() => runCmd('ai.object.pattern.done')}, {label:L3('取消', '取消', 'Cancel'), disabled:!pe, run:() => runCmd('ai.object.pattern.cancel')}]; },
  refresh(b, _a, why){ if (busy(b, why)) return; b.innerHTML = ''; const pe = Doc.aiR3 && Doc.aiR3.patternEdit;
    if (!pe){ b.appendChild(el('div', {class:'hint', text:T(L3('只在圖樣編輯模式下可用', '仅在图案编辑模式下可用', 'Pattern options are available in pattern editing mode.'))}));
      b.appendChild(el('div', {class:'bar', style:'justify-content:flex-start'}, [btn(T(L3('編輯圖樣', '编辑图案', 'Edit Pattern')), L3('編輯選取物件的圖樣填色', '编辑所选对象的图案填色', 'Edit the selected object\'s pattern'), () => runCmd('ai.object.pattern.edit', {}), {disabled:!has('ai.object.pattern.edit'), dataset:{act:'editPattern'}})])); return; }
    const pt = ((peek('ai.pattern.list', {}) || {}).patterns || []).find(x => x.name === pe.pattern) || {}; const set = q => runCmd('ai.pattern.options', Object.assign({name:pe.pattern}, q));
    const num = (k, v, lab, o) => { const x = el('input', Object.assign({type:'number', value:v === undefined ? '' : Math.round(v * 100) / 100, dataset:{k}}, o || {})); x.onchange = () => set({[k]:+x.value}); return row(lab, x); };
    const nm = el('input', {type:'text', value:pe.pattern, dataset:{k:'name'}}); nm.onchange = () => set({newName:nm.value}); b.appendChild(row(L3('名稱：', '名称：', 'Name:'), nm));
    const tt = el('select', {dataset:{k:'tileType'}}); [['grid', 'Grid'], ['brickByRow', 'Brick by Row'], ['brickByColumn', 'Brick by Column'], ['hexByColumn', 'Hex by Column'], ['hexByRow', 'Hex by Row']].forEach(([v, n]) => tt.appendChild(el('option', {value:v, text:n})));
    tt.value = pt.tileType || 'grid'; tt.onchange = () => set({tileType:tt.value}); b.appendChild(row(L3('拼貼類型：', '拼贴类型：', 'Tile Type:'), tt));
    if (/^brick/.test(pt.tileType)){ const bo = el('select', {dataset:{k:'brickOffset'}}); [[0.5, '1/2'], [1 / 3, '1/3'], [0.25, '1/4'], [0.2, '1/5']].forEach(([v, n]) => bo.appendChild(el('option', {value:v, text:n}))); bo.value = pt.brickOffset; bo.onchange = () => set({brickOffset:+bo.value}); b.appendChild(row(L3('磚紋位移：', '砖形位移：', 'Brick Offset:'), bo)); }
    b.appendChild(num('width', pt.width, L3('寬度：', '宽度：', 'Width:'), {min:1})); b.appendChild(num('height', pt.height, L3('高度：', '高度：', 'Height:'), {min:1}));
    const ck = (k, lab) => { const c = el('input', {type:'checkbox', dataset:{k}}); c.checked = !!pt[k]; c.onchange = () => set({[k]:c.checked}); return el('label', {class:'row', style:'margin:1px 0'}, [c, el('span', {text:T(lab)})]); };
    b.appendChild(ck('sizeTileToArt', L3('拼貼調整為圖稿大小', '将拼贴调整为图稿大小', 'Size Tile to Art')));
    b.appendChild(num('hSpacing', pt.hSpacing, L3('水平間距：', '水平间距：', 'H Spacing:'))); b.appendChild(num('vSpacing', pt.vSpacing, L3('垂直間距：', '垂直间距：', 'V Spacing:')));
    const ov = pt.overlap || {h:'left', v:'top'};
    b.appendChild(row(L3('重疊：', '重叠：', 'Overlap:'), ...[['h', 'left', L3('左側在前', '左侧在前', 'Left in Front')], ['h', 'right', L3('右側在前', '右侧在前', 'Right in Front')], ['v', 'top', L3('頂部在前', '顶部在前', 'Top in Front')], ['v', 'bottom', L3('底部在前', '底部在前', 'Bottom in Front')]]
      .map(([a, v, tip]) => btn({left:'◧', right:'◨', top:'⬒', bottom:'⬓'}[v], tip, () => set({overlap:Object.assign({}, ov, {[a]:v})}), {class:ov[a] === v ? 'on' : '', dataset:{overlap:a + ':' + v}}))));
    b.appendChild(el('div', {class:'sec', text:''}));
    const cp = el('select', {dataset:{k:'copies'}}); [3, 5, 7, 9].forEach(v => cp.appendChild(el('option', {value:v, text:`${v} x ${v}`}))); cp.value = pt.copies || 5; cp.onchange = () => set({copies:+cp.value}); b.appendChild(row(L3('拷貝：', '份数：', 'Copies:'), cp));
    b.appendChild(num('dimCopies', pt.dimCopies, L3('拷貝變暗至：', '副本变暗至：', 'Dim Copies to:'), {min:0, max:100}));
    b.appendChild(ck('showTileEdge', L3('顯示拼貼邊緣', '显示拼贴边缘', 'Show Tile Edge'))); b.appendChild(ck('showSwatchBounds', L3('顯示色票邊界', '显示色板边界', 'Show Swatch Bounds')));
    b.appendChild(el('div', {class:'bar'}, [btn(T(L3('儲存拷貝', '存储副本', 'Save a Copy')), null, () => runCmd('ai.object.pattern.saveCopy'), {dataset:{act:'saveCopy'}}), btn(T(L3('完成', '完成', 'Done')), null, () => runCmd('ai.object.pattern.done'), {dataset:{act:'done'}}),
      btn(T(L3('取消', '取消', 'Cancel')), null, () => runCmd('ai.object.pattern.cancel'), {dataset:{act:'cancel'}})])); }});
/* 属性面板（properties.rs：没选＝文件／视图开关；有选＝变换、外观、对齐、路径查找器、快速动作） */
P.define('aiProperties', {title:L3('內容', '属性', 'Properties'), w:270,
  refresh(b, _a, why){ if (busy(b, why)) return;
    b.innerHTML = ''; const {n, t} = selInfo(), V = window.AiView;
    if (!n){
      b.appendChild(el('div', {class:'sec', text:T(L3('尺標與格點', '标尺和网格', 'Rulers & Grids'))}));
      const tg = (cmd, on, label) => { const c = el('input', {type:'checkbox', dataset:{cmd}}); c.checked = !!on; c.onchange = () => runCmd(cmd, {on:c.checked}); return el('label', {class:'row'}, [c, el('span', {text:T(label)})]); };
      if (V){ b.appendChild(tg('ai.view.rulers', V.flags.rulers, L3('尺標', '标尺', 'Rulers'))); b.appendChild(tg('ai.view.grid', V.flags.grid, L3('格點', '网格', 'Grid'))); b.appendChild(tg('ai.view.transparencyGrid', V.flags.transparencyGrid, L3('透明度格點', '透明度网格', 'Transparency Grid')));
        b.appendChild(el('div', {class:'sec', text:T(L3('參考線', '参考线', 'Guides'))})); b.appendChild(tg('ai.view.guides', V.flags.guides, L3('參考線', '参考线', 'Guides'))); b.appendChild(tg('ai.view.smartGuides', V.flags.smartGuides, L3('智慧型參考線', '智能参考线', 'Smart Guides')));
        b.appendChild(el('div', {class:'sec', text:T(L3('靠齊選項', '对齐选项', 'Snap Options'))})); b.appendChild(tg('ai.view.snapToPoint', V.flags.snapToPoint, L3('靠齊控制點', '对齐点', 'Snap to Point'))); b.appendChild(tg('ai.view.snapToGrid', V.flags.snapToGrid, L3('靠齊格點', '对齐网格', 'Snap to Grid'))); }
      return;
    }
    b.appendChild(el('div', {class:'sec', text:T(L3('變形', '变换', 'Transform'))}));
    const r = unionB(t.L, t.R, false);
    const f = (k, v) => { const x = el('input', {type:'number', value:r ? Math.round(v) : '', dataset:{k}}); x.onchange = () => runCmd('ai.object.setBounds', {[k]:+x.value, reference:0}); return x; };
    b.appendChild(row('X', f('x', r ? r.x0 : 0), el('span', {text:'Y'}), f('y', r ? r.y0 : 0))); b.appendChild(row('W', f('width', r ? r.x1 - r.x0 : 0), el('span', {text:'H'}), f('height', r ? r.y1 - r.y0 : 0)));
    b.appendChild(el('div', {class:'sec', text:T(L3('外觀', '外观', 'Appearance'))}));
    const s = leaves(t.R[0])[0], op = el('input', {type:'number', min:0, max:100, value:Math.round((t.R[0].opacity === undefined ? 1 : t.R[0].opacity) * 100), dataset:{k:'opacity'}}); op.onchange = () => runCmd('ai.transparency.set', {opacity:+op.value});
    b.appendChild(row(L3('填色', '填色', 'Fill'), swatchEl(typeof s.fill === 'string' ? s.fill : '#ccc', '', () => P.open('aiSwatches')), el('span', {text:T(L3('筆畫', '描边', 'Stroke'))}), swatchEl(typeof s.stroke === 'string' ? s.stroke : 'none', '', () => P.open('aiStroke')), el('span', {text:(s.strokeWidth || 0) + 'px'})));
    const sw = el('input', {type:'number', min:0, step:0.5, value:s.strokeWidth || 0, dataset:{k:'strokeWeight'}}); sw.onchange = () => runCmd('ai.stroke.set', {weight:+sw.value});
    b.appendChild(row(L3('筆畫寬度', '描边粗细', 'Stroke'), sw, el('span', {text:'pt'})));
    if (n === 1 && t.R[0].type === 'rect'){ const r2 = el('input', {type:'number', min:0, value:t.R[0].radius || 0, dataset:{k:'radius'}}); r2.onchange = () => runCmd('ai.object.setLiveShape', {radius:+r2.value}); b.appendChild(row(L3('圓角半徑', '圆角半径', 'Corner Radius:'), r2)); }
    if (n === 1 && t.R[0].type === 'polygon'){ const r2 = el('input', {type:'number', min:3, max:20, value:t.R[0].points || 6, dataset:{k:'sides'}}); r2.onchange = () => runCmd('ai.object.setLiveShape', {sides:+r2.value}); b.appendChild(row(L3('邊數', '边数', 'Sides:'), r2)); }
    b.appendChild(row(L3('不透明度', '不透明度', 'Opacity'), op, el('span', {text:'%'})));
    b.appendChild(el('div', {class:'sec', text:T(L3('對齊', '对齐', 'Align'))}));
    b.appendChild(el('div', {class:'grid'}, [['horizontal', 'left', '⇤'], ['horizontal', 'center', '⇹'], ['horizontal', 'right', '⇥'], ['vertical', 'top', '⤒'], ['vertical', 'center', '⇳'], ['vertical', 'bottom', '⤓']]
      .map(([k, v, ic]) => btn(ic, null, () => runCmd('ai.object.align', {[k]:v, to:n === 1 ? 'artboard' : 'selection'})))));
    if (n > 1){ b.appendChild(el('div', {class:'sec', text:T(L3('路徑管理員', '路径查找器', 'Pathfinder'))})); b.appendChild(el('div', {class:'grid'}, PF.slice(0, 4).map(([op2, , ic, nm]) => btn(ic, nm, () => runCmd('ai.object.pathfinder.' + op2))))); }
    b.appendChild(el('div', {class:'sec', text:T(L3('快速動作', '快速操作', 'Quick Actions'))}));
    const qa = [['ai.object.group', L3('群組', '编组', 'Group')], ['ai.object.ungroup', L3('解散群組', '取消编组', 'Ungroup')], ['ai.object.arrange.bringToFront', L3('移至最前', '置于顶层', 'Bring to Front')]].filter(([c]) => has(c));
    b.appendChild(el('div', {class:'grid'}, qa.map(([c, nm]) => btn(T(nm), null, () => runCmd(c)))));
  }});
/* 内容相关任务栏（窗口 ▸ 上下文任务栏：选了东西就给几个常用动作） */
P.define('aiTaskBar', {title:L3('內容相關任務列', '上下文任务栏', 'Contextual Task Bar'), w:320,
  refresh(b){ b.innerHTML = ''; const {n} = selInfo();
    const acts = n ? [['ai.object.group', L3('群組', '编组', 'Group')], ['ai.object.arrange.bringToFront', L3('移至最前', '置于顶层', 'Bring to Front')], ['ai.object.arrange.sendToBack', L3('移至最後', '置于底层', 'Send to Back')]] : [['ai.select.all', L3('全選', '全选', 'Select All')]];
    b.appendChild(el('div', {class:'grid'}, acts.filter(([c]) => has(c)).map(([c, nm]) => btn(T(nm), null, () => runCmd(c)))));
    if (n > 1) b.appendChild(el('div', {class:'grid', style:'margin-top:4px'}, PF.slice(0, 4).map(([op, , ic, nm]) => btn(ic, nm, () => runCmd('ai.object.pathfinder.' + op))))); }});
/* 文字面板：字符／段落／OpenType／制表符／字符样式／段落样式（character.rs、paragraph.rs、opentype.rs、tabs.rs、text_styles.rs）
   我们的文字层（tools/text.js＋ai-type.js 的渲染）只有整层一种样式：字体、样式、大小、颜色、对齐、字距（tracking）、OpenType 开关有接；
   行距、字距微调、垂直／水平缩放、基线偏移、字符旋转、缩进、段前段后、连字、制表符 渲染器都没有（行距固定 size×1.25）⇒ 栏位照摆、灰掉、提示原因。 */
const textTarget = () => { const L = Doc.active(); return L && L.kind === 'text' ? L : null; };
const NOT_RENDER = L3('未做：文字渲染器沒有這一項（整層一種樣式、行距固定 1.25 倍）', '未做：文字渲染器没有这一项（整层一种样式、行距固定 1.25 倍）', 'Not done: the type renderer has no such attribute (one style per layer, fixed 1.25 leading)');
const greyField = (label, ph) => row(label, el('input', {type:'number', disabled:true, placeholder:ph || '', title:T(NOT_RENDER), style:'width:58px'}));
P.define('aiCharacter', {title:L3('字元', '字符', 'Character'), w:280,
  menu:() => [hideItem('aiCharacter'), {sep:true}, ...[['全部大寫字', '全部大写字母', 'All Caps'], ['小型大寫字', '小型大写字母', 'Small Caps'], ['上標', '上标', 'Superscript'], ['下標', '下标', 'Subscript'], ['底線', '下划线', 'Underline'], ['刪除線', '删除线', 'Strikethrough'], ['不換行', '不断字', 'No Break']]
      .map(([a, b2, c]) => ({label:L3(a, b2, c), disabled:true, run(){}})), {sep:true},
    {label:L3('重新整理字體清單', '刷新字体列表', 'Refresh Font List'), disabled:!has('ai.text.fonts'), run:() => { runCmd('ai.text.fonts'); P.refresh('aiCharacter'); }},
    {label:L3('重設面板', '重置面板', 'Reset Panel'), disabled:!textTarget(), run:() => { runCmd('ai.text.setStyle', {size:12, tracking:0, fontStyle:'Regular'}); }}],
  refresh(b, _a, why){ if (busy(b, why)) return;
    b.innerHTML = ''; const L = textTarget(), d = L ? L.data : {}, dis = !L;
    if (!L) b.appendChild(el('div', {class:'hint', text:T(L3('選取文字物件來編輯字元屬性', '选择文字对象来编辑字符属性', 'Select a text object to edit its character attributes.'))}));
    const F = peek('ai.text.fonts') || peek('text.fonts') || {families:['sans-serif', 'serif', 'monospace']}, fam = el('select', {disabled:dis, dataset:{k:'font'}}); (F.families || []).forEach(f => fam.appendChild(el('option', {value:f, text:f})));
    if (d.font && ![...fam.options].some(o => o.value === d.font)) fam.insertBefore(el('option', {value:d.font, text:d.font}), fam.firstChild); fam.value = d.font || 'sans-serif';
    fam.onchange = () => runCmd('ai.text.setStyle', {font:fam.value}); b.appendChild(fam);
    const sty = el('select', {disabled:dis, dataset:{k:'fontStyle'}}); ['Regular', 'Bold', 'Italic', 'Bold Italic', 'Light'].forEach(s => sty.appendChild(el('option', {value:s, text:s})));
    sty.value = String(d.weight) === '700' || d.weight === 'bold' ? 'Bold' : String(d.weight) === '300' ? 'Light' : 'Regular'; sty.onchange = () => runCmd('ai.text.setStyle', {fontStyle:sty.value}); b.appendChild(sty);
    const sz = el('select', {disabled:dis, dataset:{k:'size'}}); [6, 7, 8, 9, 10, 11, 12, 14, 18, 21, 24, 36, 48, 60, 72, 96].forEach(v => sz.appendChild(el('option', {value:v, text:v + ' pt'}))); if (d.size && ![...sz.options].some(o => +o.value === d.size)) sz.insertBefore(el('option', {value:d.size, text:d.size + ' pt'}), sz.firstChild); sz.value = d.size || 12;
    sz.onchange = () => runCmd('ai.text.setStyle', {size:+sz.value});
    const tr = el('input', {type:'number', step:10, value:d.tracking || 0, disabled:dis, dataset:{k:'tracking'}}); tr.onchange = () => runCmd('ai.text.setStyle', {tracking:+tr.value});
    const ld = el('input', {type:'number', disabled:true, value:d.size ? Math.round(d.size * 1.25 * 10) / 10 : '', title:T(NOT_RENDER), style:'width:58px', dataset:{k:'leading'}});
    b.appendChild(row(L3('大小：', '字号：', 'Size:'), sz, el('span', {text:T(L3('行距', '行距', 'Leading'))}), ld));
    b.appendChild(row(L3('字距微調：', '字偶间距：', 'Kerning:'), el('input', {type:'text', disabled:true, value:'Auto', title:T(NOT_RENDER), style:'width:50px'}), el('span', {text:'VA'}), tr));
    const col = el('input', {type:'color', value:d.color || '#000000', disabled:dis, dataset:{k:'color'}}); col.onchange = () => runCmd('ai.text.setStyle', {color:col.value}); b.appendChild(row(L3('顏色：', '颜色：', 'Color:'), col));
    if (HO.aiCharacter) return;
    b.appendChild(greyField(L3('垂直縮放：', '垂直缩放：', 'Vertical Scale %'), '100')); b.appendChild(greyField(L3('水平縮放：', '水平缩放：', 'Horizontal Scale %'), '100'));
    b.appendChild(greyField(L3('基線微調：', '基线偏移：', 'Baseline Shift'), '0')); b.appendChild(greyField(L3('字元旋轉：', '字符旋转：', 'Character Rotation'), '0°'));
  }});
P.define('aiParagraph', {title:L3('段落', '段落', 'Paragraph'), w:280,
  menu:() => [hideItem('aiParagraph'), {sep:true}, {label:L3('連字…', '连字…', 'Hyphenation…'), disabled:true, run(){}}, {label:L3('齊行…', '对齐…', 'Justification…'), disabled:true, run(){}}, {sep:true},
    {label:L3('Adobe 單行視覺構圖器', '单行书写器', 'Single-line Composer'), checked:true, disabled:true, run(){}}, {label:L3('Adobe 段落視覺構圖器', '段落书写器', 'Every-line Composer'), disabled:true, run(){}}, {sep:true},
    {label:L3('重設面板', '重置面板', 'Reset Panel'), disabled:!textTarget(), run:() => runCmd('ai.text.setStyle', {align:'left'})}],
  refresh(b){ b.innerHTML = ''; const L = textTarget(), d = L ? L.data : {};
    if (!L) b.appendChild(el('div', {class:'hint', text:T(L3('選取文字物件來編輯段落屬性', '选择文字对象来编辑段落属性', 'Select a text object to edit its paragraph attributes.'))}));
    b.appendChild(el('div', {class:'grid'}, [['left', '⫷', L3('靠左對齊', '左对齐', 'Align left')], ['center', '≡', L3('置中對齊', '居中对齐', 'Align center')], ['right', '⫸', L3('靠右對齊', '右对齐', 'Align right')],
      ['justifyLeft', '▤', L3('末行靠左齊行', '两端对齐，末行左对齐', 'Justify with last line aligned left')], ['justifyCenter', '▥', L3('末行置中齊行', '两端对齐，末行居中对齐', 'Justify with last line aligned center')],
      ['justifyRight', '▦', L3('末行靠右齊行', '两端对齐，末行右对齐', 'Justify with last line aligned right')], ['justifyAll', '■', L3('強制齊行', '全部两端对齐', 'Justify all lines')]]
      .map(([k, ic, tip]) => btn(ic, ['left', 'center', 'right'].includes(k) ? tip : {'zh-Hant':tip['zh-Hant'] + '（未做）', 'zh-Hans':tip['zh-Hans'] + '（未做）', en:tip.en + ' (not done)'}, () => runCmd('ai.text.setStyle', {align:k}), {disabled:!L || !['left', 'center', 'right'].includes(k), class:(d.align || 'left') === k && L ? 'on' : '', dataset:{align:k}}))));
    if (HO.aiParagraph) return;
    [[L3('左邊縮排：', '左缩进：', 'Left Indent')], [L3('右邊縮排：', '右缩进：', 'Right Indent')], [L3('首行左邊縮排：', '首行左缩进：', 'First-line Left Indent')], [L3('段前間距：', '段前间距：', 'Space Before Paragraph')], [L3('段後間距：', '段后间距：', 'Space After Paragraph')]].forEach(([l]) => b.appendChild(greyField(l, '0')));
    b.appendChild(el('label', {class:'row'}, [el('input', {type:'checkbox', disabled:true, title:T(NOT_RENDER)}), el('span', {text:T(L3('連字', '连字', 'Hyphenate'))})]));
  }});
P.define('aiOpenType', {title:'OpenType', w:260,
  menu:() => [{label:L3('重設 OpenType 功能', '重置 OpenType 功能', 'Reset OpenType Features'), disabled:!textTarget(), run:() => runCmd('ai.text.setFeatures', {reset:true})}],
  refresh(b){ b.innerHTML = ''; const L = textTarget(); if (!L){ b.appendChild(el('div', {class:'hint', text:T(L3('選取文字來設定 OpenType 功能', '选择文字来设置 OpenType 功能', 'Select text to set its OpenType features.'))})); return; }
    const f = L.data.features || {}, on = k => k === 'liga' ? f.liga !== false : !!f[k];
    const fig = el('select', {dataset:{k:'figure'}}); FIGS.forEach(n => fig.appendChild(el('option', {value:n, text:n}))); fig.value = FIGS[(f.tnum ? 1 : 0) + (f.onum ? 2 : 0)]; fig.onchange = () => runCmd('ai.text.setFeatures', {figure:fig.value});
    b.appendChild(row(L3('數字：', '数字：', 'Figure:'), fig));
    OTF.forEach(([k, en, ht, hs]) => { const c = el('input', {type:'checkbox', dataset:{k}}); c.checked = on(k); c.onchange = () => runCmd('ai.text.setFeatures', {[k]:c.checked}); b.appendChild(el('label', {class:'row', style:'margin:1px 0'}, [c, el('span', {text:T(L3(ht, hs, en))})])); });
    if (+L.data.tracking && on('liga')) b.appendChild(el('div', {class:'hint', text:T(L3('字距調整時不使用連字', '字距调整时不使用连字', 'Ligatures are off while the text is tracked.'))}));
    b.appendChild(el('div', {class:'hint', text:T(L3('畫面上只有標準連字看得出來（canvas 沒有其他 OpenType 功能）', '画面上只有标准连字看得出来（canvas 没有其他 OpenType 功能）', 'Only standard ligatures show on screen (canvas has no other OpenType features)'))})); }});
/* 制表符（tabs.rs：text.tabs.set／clear）——我们的文字渲染器不展开 Tab 字元 ⇒ 尺规照摆、全部灰掉 */
P.define('aiTabs', {title:L3('定位點', '制表符', 'Tabs'), w:300,
  menu:() => [{label:L3('清除全部定位點', '清除全部制表符', 'Clear All Tabs'), disabled:true, run(){}}, {label:L3('刪除定位點', '删除制表符', 'Delete Tab'), disabled:true, run(){}}, {label:L3('重複定位點', '重复制表符', 'Repeat Tab'), disabled:true, run(){}}],
  refresh(b){ b.innerHTML = ''; b.appendChild(el('div', {class:'grid'}, [['↓', L3('靠左定位點', '左对齐制表符', 'Left-Justified Tab')], ['⊥', L3('置中定位點', '居中对齐制表符', 'Center-Justified Tab')], ['↧', L3('靠右定位點', '右对齐制表符', 'Right-Justified Tab')], ['.↓', L3('小數點定位點', '小数点对齐制表符', 'Decimal-Justified Tab')]].map(([ic, tip]) => btn(ic, tip, null, {disabled:true}))
      .concat([el('span', {text:'X:'}), el('input', {type:'number', disabled:true, style:'width:50px'}), el('span', {text:T(L3('前導字元：', '前导符：', 'Leader:'))}), el('input', {type:'text', disabled:true, style:'width:30px'})])));
    b.appendChild(el('div', {style:'height:22px;border:1px solid #3a3a3a;margin-top:4px;background:repeating-linear-gradient(90deg,#555 0 1px,transparent 1px 20px)'}));
    b.appendChild(el('div', {class:'hint', text:T(L3('未做：文字渲染器不展開 Tab 字元，沒有定位點（原碼 tabs.rs 要 text.tabs.set）', '未做：文字渲染器不展开 Tab 字符，没有制表符（原码 tabs.rs 要 text.tabs.set）', 'Not done: the type renderer doesn\'t expand tab characters (tabs.rs needs text.tabs.set)'))})); }});
const TS = AiWindow.textStyles = {char:[], para:[]};
const stylesPanel = (key, title) => P.define(key === 'char' ? 'aiCharStyles' : 'aiParaStyles', {title, w:250,
  refresh(b){ b.innerHTML = ''; const list = el('div', {class:'list'}); b.appendChild(list);
    list.appendChild(el('div', {class:'li', text:key === 'char' ? '[Normal Character Style]' : '[Normal Paragraph Style]'}));
    TS[key].forEach(s => list.appendChild(el('div', {class:'li', text:s.name, dataset:{name:s.name}, onclick:() => runCmd('ai.text.setStyle', clone(s.attrs))})));
    b.appendChild(el('div', {class:'bar'}, [btn('＋', L3('建立新樣式', '创建新样式', 'Create New Style'), () => { const L = textTarget(); if (!L) return; const a = key === 'char' ? {font:L.data.font, size:L.data.size, color:L.data.color} : {align:L.data.align};
      TS[key].push({name:`${key === 'char' ? 'Character' : 'Paragraph'} Style ${TS[key].length + 1}`, attrs:a}); P.refresh(key === 'char' ? 'aiCharStyles' : 'aiParaStyles'); }, {disabled:!textTarget()}),
      btn('🗑', L3('刪除', '删除', 'Delete'), () => { TS[key].pop(); P.refresh(key === 'char' ? 'aiCharStyles' : 'aiParaStyles'); }, {disabled:!TS[key].length})])); }});
stylesPanel('char', L3('字元樣式', '字符样式', 'Character Styles')); stylesPanel('para', L3('段落樣式', '段落样式', 'Paragraph Styles'));
/* 信息面板（info.rs）在 AI 模式多显示填色／描边 */
if (P.defs.info && !P.defs.info.__ai){ const d = P.defs.info, r0 = d.refresh; d.__ai = true; d.refresh = function(b, api, why){ r0.call(this, b, api, why); if (!(window.Menubar && Menubar.app === 'ai')) return;
  let x = b.querySelector('.iai'); if (!x){ x = el('div', {class:'kv iai'}); b.appendChild(x); } x.innerHTML = '';
  const {n, first:s} = selInfo(); const f = s ? s.fill : UI.fill(), st = s ? s.stroke : UI.stroke();
  [['Fill:', typeof f === 'string' ? f : 'gradient'], ['Stroke:', typeof st === 'string' ? st : 'gradient'], ['W×H:', n ? (b2 => b2 ? `${Math.round(b2.x1 - b2.x0)} × ${Math.round(b2.y1 - b2.y0)}` : '—')(unionB(sel().L, sel().R)) : '—']]
    .forEach(([k, v]) => { x.appendChild(el('b', {text:k})); x.appendChild(el('span', {text:v})); }); }; }

/* ═══════════ 窗口 ▸ 面板项（menus.rs:880-902；每个面板各自开关，见下面 ai.window.panel） ═══════════ */
const MAP = {actions:'actions', align:'aiAlign', appearance:'aiAppearance', artboards:'aiArtboards', assetExport:'aiAssetExport', attributes:'aiAttributes', brushes:'aiBrushes', color:'aiColor', colorGuide:'aiColorGuide',
  colorThemes:'aiColorThemes', cssProperties:'aiCss', docInfo:'aiDocInfo', flattenerPreview:'aiFlattener', gradient:'aiGradient', graphicStyles:'aiGraphicStyles', history:'history', imageTrace:'aiImageTrace', info:'info',
  layers:'layers', libraries:'aiLibraries', links:'aiLinks', magicWand:'aiMagicWand', navigator:'navigator', pathfinder:'aiPathfinder', patternOptions:'aiPatternOptions', properties:'aiProperties', separations:'aiSeparations',
  stroke:'aiStroke', swatches:'aiSwatches', symbols:'aiSymbols', transform:'aiTransform', transparency:'aiTransparency', character:'aiCharacter', charStyles:'aiCharStyles', openType:'aiOpenType', paragraph:'aiParagraph',
  paraStyles:'aiParaStyles', tabs:'aiTabs'};
const DOCK_TABS = ['properties', 'layers', 'libraries'];
const W = AiWindow.state = {dockTab:'properties', openPanel:null};
AiWindow.isOpen = k => k === 'glyphs' ? !!(window.AiType && AiType.glyphsOpen && AiType.glyphsOpen()) : P.isOpen(MAP[k]);
/* 🔴 原码（menus.rs:880）图标面板一次只开一个、属性／图层／库是停靠分页只切不关；
   我们改成每个面板各自开关（勾＝开着＝看得到），属性／图层／库也一样开了再点＝关。W.openPanel 只记「最后开的那个」给工作区存档用。 */
reg('ai.window.panel', `{panel:"${Object.keys(MAP).concat(['glyphs']).join('|')}", on?:bool} 窗口 ▸ 面板：每个面板各自开关（开着再点＝关；勾＝开着）；像素专用／向量专用的面板在对不上的图层开不了 → {ok, panel, open}`, p => {
  const k = p.panel;
  if (k === 'glyphs'){ if (!has('ai.window.panel.glyphs')) return err('window.panel', 'no glyphs panel (ai-type)'); return CMD.map['ai.window.panel.glyphs'].run(typeof p.on === 'boolean' ? {show:p.on} : {}); }
  const id = MAP[k]; if (!id || !P.has(id)) return err('window.panel', `unknown panel \`${k}\``);
  const want = typeof p.on === 'boolean' ? p.on : !P.isOpen(id);
  if (want){ P.open(id); if (P.isOpen(id)){ if (DOCK_TABS.includes(k)) W.dockTab = k; else W.openPanel = k; } }
  else { P.close(id); if (W.openPanel === k) W.openPanel = null; }
  return {ok:true, panel:k, open:P.isOpen(id)};
}, false);
Object.keys(MAP).forEach(k => reg('ai.window.panel.' + k, `{on?} 窗口 ▸ ${k}（同 ai.window.panel {panel:"${k}"}）`, p => CMD.map['ai.window.panel'].run({panel:k, on:p.on}), false));
/* control／taskBar／toolbar／toolbarColumns（menus.rs:868-872） */
reg('ai.window.control', '{on?} 窗口 ▸ 控制：顶上的控制栏（＝我们的选项栏）→ {ok, on}', p => ({ok:true, on:P.toggle('options', p.on)}), false);
reg('ai.window.taskBar', '{on?} 窗口 ▸ 上下文任务栏 → {ok, on}', p => ({ok:true, on:P.toggle('aiTaskBar', p.on)}), false);
reg('ai.window.toolbar', '{on?} 窗口 ▸ 工具（左侧工具栏）→ {ok, on}', p => ({ok:true, on:P.toggle('tools', p.on)}), false);
reg('ai.window.toolbarColumns', '{} 窗口 ▸ 工具栏 ▸ 单栏／双栏：切换（原码没有勾）→ {ok, cols}', () => {
  if (!window.Toolbar) return err('window.toolbarColumns', 'no toolbar');
  localStorage.setItem('dlcanvas.tb.cols', Toolbar.cols === 2 ? '1' : '2'); Toolbar.build(Toolbar.kind); Toolbar.sync(ToolState.cur); return {ok:true, cols:Toolbar.cols};
}, false);

/* ═══════════ 工作区（workspaces.rs） ═══════════ */
const ESS = {control:false, rulers:false, toolbar:true, double:false, taskBar:true, dock:true, dockTab:'properties', openPanel:null};
const BUILTIN = {'Essentials':{}, 'Essentials Classic':{control:true, rulers:true, taskBar:false, openPanel:'color'}, 'Automation':{control:true, dockTab:'layers', openPanel:'actions'},
  'Layout':{control:true, rulers:true, dockTab:'layers', openPanel:'align'}, 'Painting':{control:true, double:true, openPanel:'brushes'}, 'Printing and Proofing':{control:true, rulers:true, openPanel:'info'},
  'Tracing':{control:true, dockTab:'layers', taskBar:false}, 'Typography':{control:true, rulers:true, openPanel:'character'}, 'Web':{control:true, rulers:true, openPanel:'symbols'}};
const WSK = 'dlAiWorkspaces.v1';
const WS = AiWindow.workspace = {cur:'Essentials', custom:(() => { try { return JSON.parse(localStorage.getItem(WSK) || '{}'); } catch(e){ return {}; } })(), save(){ try { localStorage.setItem(WSK, JSON.stringify(this.custom)); } catch(e){} }};
/* 存下来的工作区：openPanels＝当时开着的所有 AI 面板（面板各自开关之后一个工作区可以有好几个面板） */
function capture(){ return {control:P.isOpen('options'), rulers:!!(window.AiView && AiView.flags.rulers), toolbar:P.isOpen('tools'), double:!!(window.Toolbar && Toolbar.cols === 2), taskBar:P.isOpen('aiTaskBar'), dock:true, dockTab:W.dockTab, openPanel:W.openPanel,
  openPanels:Object.keys(MAP).filter(k => !DOCK_TABS.includes(k) && P.isOpen(MAP[k]))}; }
function applyWs(w){
  const s = Object.assign({}, ESS, w);
  P.toggle('options', !!s.control); P.toggle('tools', !!s.toolbar); P.toggle('aiTaskBar', !!s.taskBar);
  if (window.AiView && has('ai.view.rulers')) CMD.map['ai.view.rulers'].run({on:!!s.rulers});
  if (window.Toolbar && (Toolbar.cols === 2) !== !!s.double){ localStorage.setItem('dlcanvas.tb.cols', s.double ? '2' : '1'); Toolbar.build(Toolbar.kind); Toolbar.sync(ToolState.cur); }
  const want = Array.isArray(s.openPanels) ? s.openPanels : s.openPanel ? [s.openPanel] : [];
  Object.keys(MAP).forEach(k => { if (!DOCK_TABS.includes(k) && !want.includes(k) && MAP[k] !== 'layers' && P.isOpen(MAP[k]) && MAP[k].startsWith('ai')) P.close(MAP[k]); });
  W.openPanel = null; want.forEach(k => { if (MAP[k]) CMD.map['ai.window.panel'].run({panel:k, on:true}); });
  W.dockTab = s.dockTab; if (s.dockTab === 'layers') P.open('layers'); else if (s.dockTab === 'properties') P.open('aiProperties');
  if (window.UI) UI.draw();
}
const findWs = n => { const k = Object.keys(WS.custom).find(x => x.toLowerCase() === String(n).toLowerCase()) || Object.keys(BUILTIN).find(x => x.toLowerCase() === String(n).toLowerCase()); return k; };
reg('ai.window.workspace', `{name:"${Object.keys(BUILTIN).join('|')}"|存下来的名字} 窗口 ▸ 工作区 ▸ 这个工作区（不分大小写，先找自订的）→ {ok, workspace}`, p => {
  const k = findWs(p.name); if (!k) return err('window.workspace', `unknown workspace (one of ${Object.keys(BUILTIN).concat(Object.keys(WS.custom)).join(', ')})`);
  WS.cur = k; applyWs(WS.custom[k] || BUILTIN[k]); refreshWsMenu(); return {ok:true, workspace:k};
}, false);
reg('ai.window.workspace.reset', '{} 窗口 ▸ 工作区 ▸ 重置<目前工作区> → {ok, workspace}', () => { applyWs(WS.custom[WS.cur] || BUILTIN[WS.cur] || {}); return {ok:true, workspace:WS.cur}; }, false);
reg('ai.window.workspace.new', '{name?（不给＝开「新建工作区」对话框）} 窗口 ▸ 工作区 ▸ 新建工作区…：存下目前的栏、工具栏与面板配置并设为目前 → {ok, workspace}', p => {
  if (p.name === undefined){ let i = 1; while (WS.custom['Workspace ' + i]) i++;
    P.dialog({id:'aiNewWs', title:L3('新增工作區', '新建工作区', 'New Workspace'), fields:[{k:'name', type:'text', label:L3('名稱：', '名称：', 'Name:'), value:'Workspace ' + i}, {type:'note', label:L3('儲存目前的列、工具列與面板配置。', '存储当前的栏、工具栏和面板布局。', 'Saves the current bars, toolbar and panel layout.')}],
      ok:v => CMD.run('ai.window.workspace.new', {name:v.name})}); return {ok:true, dialog:'newWorkspace'}; }
  const name = String(p.name).trim(); if (!name) return err('window.workspace.new', "workspace name can't be empty");
  if (BUILTIN[name]) return err('window.workspace.new', `\`${name}\` is built in`);
  WS.custom[name] = capture(); WS.save(); WS.cur = name; refreshWsMenu(); return {ok:true, workspace:name};
}, false);
reg('ai.window.workspace.rename', '{name, to} 改名（内建的不能改）→ {ok}', p => {
  const k = findWs(p.name); if (!k || BUILTIN[k]) return err('window.workspace.rename', 'only saved workspaces can be renamed');
  const to = String(p.to || '').trim(); if (!to || BUILTIN[to] || WS.custom[to]) return err('window.workspace.rename', 'name is empty, built in or taken');
  WS.custom[to] = WS.custom[k]; delete WS.custom[k]; if (WS.cur === k) WS.cur = to; WS.save(); refreshWsMenu(); return {ok:true};
}, false);
reg('ai.window.workspace.delete', '{name} 删除（内建的不能删；删目前的会回基本功能）→ {ok}', p => {
  const k = findWs(p.name); if (!k) return err('window.workspace.delete', 'no such workspace'); if (BUILTIN[k]) return err('window.workspace.delete', `\`${k}\` is built in and can't be deleted`);
  delete WS.custom[k]; WS.save(); if (WS.cur === k){ WS.cur = 'Essentials'; applyWs({}); } refreshWsMenu(); return {ok:true};
}, false);
reg('ai.window.workspace.list', '{} → {ok, current, workspaces, custom}', () => ({ok:true, current:WS.cur, workspaces:Object.keys(BUILTIN), custom:Object.keys(WS.custom)}), false);
reg('ai.window.workspace.manage', '{} 窗口 ▸ 工作区 ▸ 管理工作区…（清单＋名称栏＋新建／改名／删除；内建的不能选）→ {ok, dialog}', () => {
  let picked = Object.keys(WS.custom)[0] || null;
  const d = P.dialog({id:'aiManageWs', title:L3('管理工作區', '管理工作区', 'Manage Workspaces'), fields:[{k:'name', type:'text', label:L3('名稱：', '名称：', 'Name:'), value:picked || ''}], ok:() => true, okLabel:L3('確定', '确定', 'OK')});
  const list = el('div', {class:'mwlist', style:'max-height:180px;overflow:auto;border:1px solid #444a55;margin:6px 0'});
  const draw = () => { list.innerHTML = ''; Object.keys(BUILTIN).concat(Object.keys(WS.custom)).forEach(n => list.appendChild(el('div', {text:n, style:`padding:3px 6px;${BUILTIN[n] ? 'color:#777' : 'cursor:pointer'};${n === picked ? 'background:#2f7fd8;color:#fff' : ''}`,
    onclick:() => { if (BUILTIN[n]) return; picked = n; d.fields.name.inp.value = n; draw(); }}))); };
  const tools = el('div', {style:'display:flex;gap:6px'}, [el('button', {text:T(L3('新增', '新建', 'New')), onclick:() => { CMD.run('ai.window.workspace.new', {name:d.fields.name.inp.value}); picked = d.fields.name.inp.value; draw(); }}),
    el('button', {text:T(L3('重新命名', '重命名', 'Rename')), onclick:() => { if (picked && CMD.run('ai.window.workspace.rename', {name:picked, to:d.fields.name.inp.value}).ok) picked = d.fields.name.inp.value; draw(); }}),
    el('button', {text:T(L3('刪除', '删除', 'Delete')), onclick:() => { if (picked) CMD.run('ai.window.workspace.delete', {name:picked}); picked = null; draw(); }})]);
  d.box.insertBefore(list, d.box.querySelector('label')); d.box.insertBefore(tools, d.box.querySelector('.msg')); draw();
  return {ok:true, dialog:'manageWorkspaces'};
}, false);
function refreshWsMenu(){
  const t = window.MenuTrees && MenuTrees.ai && MenuTrees.ai.window; if (!t) return;
  const sub = t.items.find(it => it.sub && it.sub.some(x => x.id === 'window.workspace.essentials')); if (!sub) return;
  sub.sub = sub.sub.filter(x => !x._saved);
  const at = sub.sub.findIndex(x => x.sep), extra = Object.keys(WS.custom).map(n => ({n:{'zh-Hant':n, 'zh-Hans':n, en:n}, id:'window.workspace.user.' + n, radio:'workspace', _saved:true, impl:{cmd:'ai.window.workspace', params:{name:n}, checked:() => WS.cur === n}}));
  if (extra.length) sub.sub.splice(at, 0, {sep:true, _saved:true}, ...extra);
}
AiWindow.refreshWsMenu = refreshWsMenu;
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', refreshWsMenu); else refreshWsMenu();
})();
