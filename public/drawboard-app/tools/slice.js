/* 切片工具（C，PS 版面 ps.slice）——照 ArtCraft／PhotoCraft 的 Rust 原码逐段翻译
   对照源（photocraft/crates/…）：
     ui-egui/src/slice_ui.rs  17-34    SliceUi（selected＝选中切片的显示编号、hide_auto、drag）／SliceDrag::New|Move
     ui-egui/src/slice_ui.rs  40-52    slice_at（存的切片优先、后画的在上，其次自动切片）、rect_from（floor／ceil 成整数格）
     ui-egui/src/slice_ui.rs  55-107   pointer：切片工具 Down 记起点（锁定切片就不理）；Up 时框够大（宽高 ≥1 且其一 >2）＝slice.new、
                                       否则＝点一下选点到的切片；切片选择工具见 tools/sliceselect.js
     ui-egui/src/slice_ui.rs  118-195  draw_overlay：切片工具开着（或 视图▸显示▸切片 且有切片）才画；自动切片虚线（选择工具「隐藏自动切片」时不画）、
                                       用户／图层切片实线；选中＝2px 橘框＋用户切片 8 个把手；编号牌（偏好设置的切片颜色、显示切片编号；图层切片带「▪」）；
                                       拖曳预览：新切片＝白框＋虚线、移动＝橘框
     ui-egui/src/slice_ui.rs  197-241  selected_id（自动切片先升级）、open_options（切片选项对话框）、open_divide（划分切片对话框 横 2 竖 1）
     ui-egui/src/slice_ui.rs  243-284  选项栏：切片工具＝「样式：正常」＋「基于参考线的切片」；锁定时提示一句
     doc/src/slices.rs        14-152   SliceOrigin／SliceKind／Slice／Slices.next_id
     doc/src/slices.rs        169-260  clipped／auto_slices（沿每条切片边切格、同行合并、同列往下合并）／resolve（由上而下、由左而右编号、名字 <文件名>_NN）／base_name
     engine/src/slice_cmds.rs 27-56    unlocked／has_slices（命令的前提）
     engine/src/slice_cmds.rs 123-229  rect_param／hex_color／apply_options／target（id 或编号；自动切片的编号＝先升级成用户切片）／resolved_json
     engine/src/slice_cmds.rs 233-442  slice.new／fromGuides／set／promote／delete／divide／list／clear
   我们的资料：Doc.slices（menus/impl/ps-layer2.js 建的栏位，已进历史快照与工程档）——用户切片 {id, origin:'user', rect:[x,y,w,h], name, kind, url, target, message,
     alt, cellText, cellTextIsHtml, horizontalAlign, verticalAlign, background:'#rrggbb'|null, outsets}；图层切片 {origin:'layer', layer, outsets…}（外框跟着图层算，ps-layer2 sliceList）。
     自动切片不存，每次现算（同原码）。锁定切片＝PsView.lockSlices（ps.view.lockSlices）。
   原码没有、照 PS 2020 补的：拖切片时 Shift＝正方形、Alt＝从中心拉（slice_ui.rs 的 rect_from 不看修饰键）。
   切片选择工具（tools/sliceselect.js）共用这里的 window.SliceKit。 */
(function(){
'use strict';

const L3 = (hant, hans, en) => (typeof Lang !== 'undefined' && Lang.cur === 'en') ? en : (typeof Lang !== 'undefined' && Lang.cur === 'zh-Hans') ? hans : hant;
const fail = error => ({ok:false, error});
/* Rust f64::round：.5 远离零 */
const rround = v => Math.sign(v) * Math.round(Math.abs(v));
const fin = v => typeof v === 'number' && isFinite(v);
const num = v => (v === null || v === undefined || v === '' || typeof v === 'boolean') ? NaN : +v;
/* commands.rs int：整数参数 */
const intP = (p, k) => { const v = num(p && p[k]); return isFinite(v) ? Math.trunc(v) : null; };

/* ── 矩形：内部一律 {x0,y0,x1,y1}（photocraft_geom::Rect），存档一律 [x,y,w,h] ── */
const R = (x0, y0, x1, y1) => ({x0, y0, x1, y1});
const rw = r => Math.max(0, r.x1 - r.x0), rh = r => Math.max(0, r.y1 - r.y0);
const isEmpty = r => !r || r.x1 <= r.x0 || r.y1 <= r.y0;
const inter = (a, b) => { const r = R(Math.max(a.x0, b.x0), Math.max(a.y0, b.y0), Math.min(a.x1, b.x1), Math.min(a.y1, b.y1)); return isEmpty(r) ? R(0, 0, 0, 0) : r; };
const fromXYWH = a => R(a[0], a[1], a[0] + a[2], a[1] + a[3]);
const toXYWH = r => [r.x0, r.y0, rw(r), rh(r)];
const contains = (r, x, y) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
const canvasRect = () => R(0, 0, Doc.width, Doc.height);

/* Doc.slices（ps-layer2 建的；还没载就自己开） */
const list = () => (Array.isArray(Doc.slices) ? Doc.slices : (Doc.slices = []));
const getSlice = id => list().find(s => s.id === id) || null;
/* slices.rs:143 next_id */
const nextId = () => list().reduce((m, s) => Math.max(m, s.id || 0), 0) + 1;
/* slices.rs:98 Slice::default（origin 预设 User） */
const blankSlice = (id, rect) => ({id, origin:'user', layer:null, name:'', rect:toXYWH(rect), kind:'image', url:'', target:'', message:'', alt:'',
  cellText:'', cellTextIsHtml:false, horizontalAlign:0, verticalAlign:0, background:null, outsets:[0, 0, 0, 0]});

/* 存的切片现在的外框：用户切片＝rect；图层切片＝图层外框＋外扩（slice_cmds.rs:83 layer_slice_rect；我们由 ps-layer2 sliceList 现算） */
function storedRect(sl){
  if (sl.origin === 'layer'){
    const P2 = window.PsLayer2;
    if (!P2 || !P2.sliceList) return null;
    const o = P2.sliceList().find(x => x.id === sl.id);
    return o && o.rect ? fromXYWH(o.rect) : null;
  }
  return Array.isArray(sl.rect) && sl.rect.length === 4 ? fromXYWH(sl.rect) : null;
}

/* slices.rs:171 clipped：每个存的切片夹进画布、空的丢掉 */
function clipped(){
  const canvas = canvasRect();
  return list().map(s => { const r = storedRect(s); return [s.id, r ? inter(r, canvas) : R(0, 0, 0, 0)]; }).filter(([, r]) => !isEmpty(r));
}

/* slices.rs:179 auto_slices：画布沿每条切片边切成格子，空格同一行连成一段，再把左右边一样、上下相接的段往下并 */
function autoSlices(canvas, taken){
  if (isEmpty(canvas)) return [];
  let xs = [canvas.x0, canvas.x1], ys = [canvas.y0, canvas.y1];
  for (const t of taken){
    const r = inter(t, canvas); if (isEmpty(r)) continue;
    xs.push(r.x0, r.x1); ys.push(r.y0, r.y1);
  }
  const uniq = a => [...new Set(a)].sort((p, q) => p - q);
  xs = uniq(xs); ys = uniq(ys);
  const covered = (x0, y0) => taken.some(r => x0 >= r.x0 && x0 < r.x1 && y0 >= r.y0 && y0 < r.y1);
  const runs = [];
  for (let j = 0; j + 1 < ys.length; j++){
    let start = null;
    for (let i = 0; i + 1 < xs.length; i++){
      const free = !covered(xs[i], ys[j]);
      if (free && start === null) start = xs[i];
      else if (!free && start !== null){ runs.push(R(start, ys[j], xs[i], ys[j + 1])); start = null; }
    }
    if (start !== null) runs.push(R(start, ys[j], xs[xs.length - 1], ys[j + 1]));
  }
  const out = [];
  for (const r of runs){
    const prev = out.find(p => p.x0 === r.x0 && p.x1 === r.x1 && p.y1 === r.y0);
    if (prev) prev.y1 = r.y1; else out.push(r);
  }
  return out;
}

/* slices.rs:256 base_name：文件名去副档名、只留字母数字 - _ */
function baseName(){
  let n = 'Untitled';
  try { if (window.PsFile && PsFile.state) n = PsFile.state().name || n; } catch (e){}
  n = String(n); const i = n.lastIndexOf('.'); if (i > 0) n = n.slice(0, i);
  const s = [...n].map(c => /[\p{L}\p{N}_-]/u.test(c) ? c : '_').join('');
  return s || 'Untitled';
}

/* slices.rs:232 resolve：存的（夹过）＋自动切片，按 (y0, x0) 排好编号（稳定排序：同位置时存的在前） */
function resolve(){
  const base = baseName();
  const stored = clipped();
  const rects = stored.map(([, r]) => r);
  const all = stored.map(([id, r]) => ({id, rect:r})).concat(autoSlices(canvasRect(), rects).map(r => ({id:null, rect:r})));
  all.sort((a, b) => (a.rect.y0 - b.rect.y0) || (a.rect.x0 - b.rect.x0));
  const single = all.length === 1;
  return all.map((o, i) => {
    const s = o.id !== null ? getSlice(o.id) : null, number = i + 1;
    const name = s && s.name ? s.name : single ? base : `${base}_${String(number).padStart(2, '0')}`;
    return {number, id:o.id, origin:s ? (s.origin || 'user') : 'auto', rect:o.rect, name, kind:s ? (s.kind || 'image') : 'image'};
  });
}

/* slice_ui.rs:41 slice_at：点到的切片——存的优先（越后画的越上面），其次自动切片 */
function sliceAt(x, y){
  const xi = Math.floor(x), yi = Math.floor(y);
  const order = r => { if (r.id === null) return 0; const i = list().findIndex(s => s.id === r.id); return i < 0 ? 0 : i + 1; };
  let best = null, bk = -1;
  for (const r of resolve()){ if (!contains(r.rect, xi, yi)) continue; const k = order(r); if (k >= bk){ best = r; bk = k; } }   // max_by_key：同分取最后一个
  return best;
}

/* slice_ui.rs:48 rect_from：两点 → 整数格（小的 floor、大的 ceil） */
function rectFrom(a, b){
  return R(Math.floor(Math.min(a[0], b[0])), Math.floor(Math.min(a[1], b[1])), Math.ceil(Math.max(a[0], b[0])), Math.ceil(Math.max(a[1], b[1])));
}
/* 照 PS 补：Shift＝正方形、Alt＝从中心（end 改过再交给 rect_from） */
function dragRect(start, cur, m){
  let e = cur.slice();
  if (m && m.shift){ const dx = e[0] - start[0], dy = e[1] - start[1], k = Math.max(Math.abs(dx), Math.abs(dy)); e = [start[0] + (dx < 0 ? -k : k), start[1] + (dy < 0 ? -k : k)]; }
  if (m && m.alt) return rectFrom([2 * start[0] - e[0], 2 * start[1] - e[1]], e);
  return rectFrom(start, e);
}

const locked = () => !!(window.PsView && PsView.lockSlices);
const LOCKED_MSG = 'slices are locked (View › Lock Slices)';

/* slice_cmds.rs:123 rect_param：rect:[x,y,w,h] 或 x/y/width/height 四个都给；宽高要 > 0 */
function rectParam(p){
  const f = v => { const x = num(v); return isFinite(x) ? rround(x) : null; };
  if (Array.isArray(p.rect) && p.rect.length === 4){
    const v = p.rect.map(f);
    if (v.every(x => x !== null) && v[2] > 0 && v[3] > 0) return R(v[0], v[1], v[0] + v[2], v[1] + v[3]);
    return null;
  }
  if (p.x === undefined || p.y === undefined || p.width === undefined || p.height === undefined) return null;
  const x = f(p.x), y = f(p.y), w = f(p.width), h = f(p.height);
  if ([x, y, w, h].some(v => v === null)) return null;
  return w > 0 && h > 0 ? R(x, y, x + w, y + h) : null;
}
/* slice_cmds.rs:136 hex_color */
const hexColor = s => { const t = String(s).replace(/^#+/, ''); return /^[0-9a-f]{6}$/i.test(t) ? '#' + t.toLowerCase() : null; };
/* slices.rs:88 SliceKind::from_id */
const kindFrom = s => ({image:'image', img:'image', noImage:'noImage', none:'noImage', 'no-image':'noImage', table:'table'})[s] || null;

/* slice_cmds.rs:146 apply_options：p 里有给的切片选项写进 sl；回错误字串或 null */
function applyOptions(sl, p, cmd){
  const text = k => typeof p[k] === 'string' ? p[k] : null;
  if (text('name') !== null) sl.name = p.name;
  const kv = text('kind') !== null ? p.kind : text('type');
  if (kv !== null){ const k = kindFrom(kv); if (!k) return `${cmd}: unknown slice type \`${kv}\` (image|noImage|table)`; sl.kind = k; }
  for (const [k, slot] of [['url', 'url'], ['target', 'target'], ['message', 'message'], ['alt', 'alt'], ['cellText', 'cellText']]) if (text(k) !== null) sl[slot] = p[k];
  if (typeof p.cellTextIsHtml === 'boolean') sl.cellTextIsHtml = p.cellTextIsHtml;
  for (const k of ['horizontalAlign', 'verticalAlign']){ const v = intP(p, k); if (v !== null && v >= 0) sl[k] = Math.min(v, 4); }
  if (typeof p.background === 'string'){
    if (p.background === 'none' || p.background === '') sl.background = null;
    else { const c = hexColor(p.background); if (!c) return `${cmd}: background is "none" or "#rrggbb"`; sl.background = c; }
  }
  if (Array.isArray(p.outsets) && p.outsets.length === 4){
    sl.outsets = (sl.outsets || [0, 0, 0, 0]).slice();
    p.outsets.forEach((v, i) => { const x = num(v); sl.outsets[i] = Math.max(-10000, Math.min(10000, isFinite(x) ? Math.trunc(x) : 0)); });
  }
  const r = rectParam(p);
  if (r){
    if (sl.origin === 'layer'){ sl.origin = 'user'; sl.layer = null; }   // 改图层切片的几何＝变成用户切片
    sl.rect = toXYWH(r);
  }
  return null;
}

/* slice_cmds.rs:190 target："slice"（id）或 "number"（显示编号）；promote＝自动切片的编号先升级成用户切片（同一步） → {id}|{error} */
function target(p, cmd, promote){
  const sid = intP(p, 'slice');
  if (sid !== null && sid >= 0){ const s = getSlice(sid); return s ? {id:s.id} : {error:`${cmd}: no slice with id ${sid}`}; }
  const n = intP(p, 'number');
  if (n === null || n <= 0) return {error:`${cmd}: give "slice" (id) or "number"`};
  const r = resolve().find(x => x.number === n);
  if (!r) return {error:`${cmd}: no slice number ${n}`};
  if (r.id !== null) return {id:r.id};
  if (!promote) return {error:`${cmd}: slice ${n} is an auto slice`};
  const id = nextId();
  list().push(blankSlice(id, r.rect));
  return {id, promoted:true};
}

/* slice_cmds.rs:212 resolved_json */
function resolvedJson(r){
  const s = r.id !== null ? getSlice(r.id) : null;
  return {number:r.number, id:r.id, origin:r.origin, name:r.name, rect:toXYWH(r.rect), kind:r.kind,
    layer:s && s.layer ? s.layer : null, url:s ? s.url || '' : '', target:s ? s.target || '' : '', message:s ? s.message || '' : '',
    alt:s ? s.alt || '' : '', cellText:s ? s.cellText || '' : '', background:s && s.background ? s.background : null};
}
const numberOf = id => { const r = resolve().find(x => x.id === id); return r ? r.number : null; };

/* ═══════════ 命令（slice_cmds.rs:444 specs；命名空间＝工具 id「slice」） ═══════════ */
const OPTS = '"name","kind":"image|noImage|table","url","target","message","alt","cellText","cellTextIsHtml","horizontalAlign":0..4,"verticalAlign":0..4,"background":"none|#rrggbb"';
CMD.reg('slice.new', {i18n:'', undoable:true, params:`{rect:[x,y,w,h] | x,y,width,height（文件坐标，夹进画布）, 切片选项 ${OPTS}?} 切片工具画一个用户切片（slice_cmds.rs:233）→ {slice:id, number}`}, p => {
  if (locked()) return fail(LOCKED_MSG);
  const r0 = rectParam(p); if (!r0) return fail('slice.new: give "rect":[x,y,w,h] (or x, y, width, height)');
  const rect = inter(r0, canvasRect()); if (isEmpty(rect)) return fail('slice.new: the slice is outside the canvas');
  const id = nextId(), sl = blankSlice(id, rect);
  const e = applyOptions(sl, p, 'slice.new'); if (e) return fail(e);
  sl.rect = toXYWH(rect);
  list().push(sl);
  const number = numberOf(id);
  SK.ui.selected = number;
  return {ok:true, slice:id, number};
});
CMD.reg('slice.fromGuides', {i18n:'', undoable:true, params:'{} 基于参考线的切片：画布内的参考线把画布切成格子，取代现有全部切片（slice_cmds.rs:253）→ {slices:个数}'}, () => {
  if (locked()) return fail(LOCKED_MSG);
  const W = Doc.width, H = Doc.height;
  const G = (window.PsView && PsView.guides) ? PsView.guides() : (Array.isArray(Doc.aiGuides) ? Doc.aiGuides : []);
  let xs = [0, W], ys = [0, H];
  G.forEach(g => { const v = rround(+g.pos); if (!isFinite(v)) return; if (g.vertical){ if (v > 0 && v < W) xs.push(v); } else if (v > 0 && v < H) ys.push(v); });
  if (xs.length === 2 && ys.length === 2) return fail('the document has no guides inside the canvas');
  xs = [...new Set(xs)].sort((a, b) => a - b); ys = [...new Set(ys)].sort((a, b) => a - b);
  const rects = [];
  for (let j = 0; j + 1 < ys.length; j++) for (let i = 0; i + 1 < xs.length; i++) rects.push(R(xs[i], ys[j], xs[i + 1], ys[j + 1]));
  list().length = 0;                                     // PS 会取代现有的每个切片
  rects.forEach(r => list().push(blankSlice(nextId(), r)));
  SK.ui.selected = null;
  return {ok:true, slices:rects.length};
});
CMD.reg('slice.set', {i18n:'', undoable:true, params:`{slice:id | number:n（自动切片＝先升级成用户切片，同一步）, ${OPTS}?, outsets:[上,左,下,右]?（图层切片）, rect:[x,y,w,h]?（移动／改大小；图层切片会变成用户切片）} 切片选项（slice_cmds.rs:286）→ 那个切片`}, p => {
  if (locked()) return fail(LOCKED_MSG);
  const t = target(p, 'slice.set', true); if (t.error) return fail(t.error);
  const sl = getSlice(t.id); if (!sl) return fail('slice.set: slice vanished');
  const e = applyOptions(sl, p, 'slice.set'); if (e) return fail(e);
  const r = resolve().find(x => x.id === t.id);
  if (!r) return {ok:true, slice:t.id, offCanvas:true};           // 原码：改完了才发现在画布外 ⇒ 报错（但那一步已记）；我们回 ok 并标 offCanvas
  SK.ui.selected = r.number;
  return Object.assign({ok:true, slice:t.id}, resolvedJson(r));
});
CMD.reg('slice.promote', {i18n:'', undoable:true, params:'{slice:id | number:n} 提升：自动切片或图层切片 → 用户切片（slice_cmds.rs:313）→ {slice}'}, p => {
  if (locked()) return fail(LOCKED_MSG);
  const t = target(p, 'slice.promote', true); if (t.error) return fail(t.error);
  const sl = getSlice(t.id);
  if (sl && sl.origin === 'layer'){                                // 图层切片：不再跟着图层走（外框定在现在的位置）
    const r = storedRect(sl);
    sl.origin = 'user'; sl.layer = null;
    if (r) sl.rect = toXYWH(r);
  } else if (!t.promoted) return {ok:false, unchanged:true, slice:t.id, error:'slice.promote: already a user slice'};   // 没改到东西：不留空的一步
  return {ok:true, slice:t.id};
});
CMD.reg('slice.delete', {i18n:'', undoable:true, params:'{slice:id | number:n | slices:[id…]} 删除切片（自动切片不能删；slice_cmds.rs:342）→ {deleted}'}, p => {
  if (locked()) return fail(LOCKED_MSG);
  if (!list().length) return fail('the document has no user or layer-based slices');
  let ids;
  if (Array.isArray(p.slices)){
    ids = p.slices.map(v => intP({v}, 'v')).filter(id => id !== null && getSlice(id));
    if (!ids.length) return fail('slice.delete: none of the slices exist');
  } else { const t = target(p, 'slice.delete', false); if (t.error) return fail(t.error); ids = [t.id]; }
  const before = list().length;
  Doc.slices = list().filter(s => !ids.includes(s.id));
  SK.ui.selected = null;
  return {ok:true, deleted:before - Doc.slices.length};
});
CMD.reg('slice.divide', {i18n:'', undoable:true, params:'{slice:id | number:n, horizontal:n=1（往下切几块）, vertical:n=1（往右切几块）} 划分切片（第一块留原来的选项；slice_cmds.rs:352）→ {slices:[id…], count}'}, p => {
  if (locked()) return fail(LOCKED_MSG);
  const down = Math.max(1, Math.min(1000, intP(p, 'horizontal') ?? 1)), across = Math.max(1, Math.min(1000, intP(p, 'vertical') ?? 1));
  if (down === 1 && across === 1) return fail('slice.divide: give "horizontal" (slices down) and/or "vertical" (slices across) > 1');
  const t = target(p, 'slice.divide', true); if (t.error) return fail(t.error);
  const src = getSlice(t.id); if (!src) return fail('slice.divide: no such slice');
  const r = storedRect(src); if (!r) return fail('slice.divide: no such slice');
  if (rw(r) < across || rh(r) < down) return fail('slice.divide: the slice is too small to divide that many times');
  const L0 = list(), pos = Math.max(0, L0.findIndex(s => s.id === t.id));
  Doc.slices = L0.filter(s => s.id !== t.id);
  const ids = [], parts = [];
  const W = rw(r), H = rh(r);
  for (let j = 0; j < down; j++) for (let i = 0; i < across; i++){
    const x0 = r.x0 + Math.trunc(W * i / across), x1 = r.x0 + Math.trunc(W * (i + 1) / across);
    const y0 = r.y0 + Math.trunc(H * j / down), y1 = r.y0 + Math.trunc(H * (j + 1) / down);
    const nid = ids.length ? Math.max(nextId(), Math.max(...ids) + 1) : t.id;
    ids.push(nid);
    // 第一块留原来的选项（但变成用户切片），其余是新的空白切片
    const sl = parts.length ? blankSlice(nid, R(x0, y0, x1, y1)) : Object.assign(JSON.parse(JSON.stringify(src)), {id:nid, origin:'user', layer:null, rect:[x0, y0, x1 - x0, y1 - y0]});
    parts.push(sl);
  }
  parts.forEach((sl, k) => Doc.slices.splice(Math.min(pos + k, Doc.slices.length), 0, sl));
  return {ok:true, slices:ids, count:down * across};
});
CMD.reg('slice.list', {i18n:'', params:'{} 全部切片（含自动切片）照 PS 编号 → {slices:[{number,id,origin:auto|layer|user,name,rect:[x,y,w,h],kind,layer,url,target,message,alt,cellText,background}], locked, selected}'}, () =>
  ({ok:true, slices:resolve().map(resolvedJson), locked:locked(), selected:SK.ui.selected}));
CMD.reg('slice.clear', {i18n:'', undoable:true, params:'{} 视图 ▸ 清除切片：删掉每个用户切片与图层切片（slice_cmds.rs:435）→ {cleared}'}, () => {
  if (locked()) return fail(LOCKED_MSG);
  const n = list().length; if (!n) return fail('the document has no user or layer-based slices');
  Doc.slices = []; SK.ui.selected = null;
  return {ok:true, cleared:n};
});
CMD.reg('slice.select', {i18n:'', params:'{number?:n | slice?:id（都不给＝取消选取）} 切片选择工具选中的切片（只是界面状态，不进历史）→ {selected}'}, p => {
  if (p.slice !== undefined && p.slice !== null){ const n = numberOf(intP(p, 'slice')); if (n === null) return fail('no such slice'); SK.ui.selected = n; }
  else if (p.number !== undefined && p.number !== null){ const n = intP(p, 'number'); if (!resolve().some(r => r.number === n)) return fail('no such slice number'); SK.ui.selected = n; }
  else SK.ui.selected = null;
  if (window.UI) UI.draw();
  return {ok:true, selected:SK.ui.selected};
});
CMD.reg('slice.options', {i18n:'', params:'{hideAuto?:bool} 切片选择工具选项栏 ▸ 隐藏自动切片（界面状态）→ {hideAuto}'}, p => {
  if (typeof p.hideAuto === 'boolean') SK.ui.hideAuto = p.hideAuto;
  if (window.UI) UI.draw();
  return {ok:true, hideAuto:SK.ui.hideAuto};
});

/* ═══════════ 叠画（slice_ui.rs:118 draw_overlay） ═══════════ */
function prefs(){
  let color = '#38b5ff', numbers = true;
  try { const g = window.PsEdit && PsEdit.prefs && PsEdit.prefs.get('guidesGridAndSlices'); if (g){ if (hexColor(g.sliceColor)) color = hexColor(g.sliceColor); if (typeof g.showSliceNumbers === 'boolean') numbers = g.showSliceNumbers; } } catch (e){}
  return {color, numbers};
}
const toolOn = () => typeof ToolState !== 'undefined' && (ToolState.cur === 'slice' || ToolState.cur === 'sliceselect');
const SELECTED = '#ffb000';
function hexA(hex, a){ const h = hexColor(hex) || '#38b5ff'; return `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`; }
function drawAll(ctx, s){
  const on = toolOn();
  const show = window.PsView ? PsView.shows(PsView.show.slices) : true;
  if (!(on || (show && list().length))) return;
  const {color, numbers} = prefs();
  const all = resolve();
  const sr = r => [r.x0 * s, r.y0 * s, rw(r) * s, rh(r) * s];
  ctx.save();
  for (const pass of [true, false]){                     // 先画自动切片（虚线、在底下），再画用户／图层切片
    for (const r of all.filter(r => (r.origin === 'auto') === pass)){
      if (pass && (!on || SK.ui.hideAuto)) continue;
      const [x, y, w, h] = sr(r.rect), sel = SK.ui.selected === r.number;
      ctx.lineWidth = 1;
      if (pass){ ctx.setLineDash([3, 3]); ctx.strokeStyle = hexA(color, 0.7); }
      else { ctx.setLineDash([]); ctx.strokeStyle = color; }
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);    // StrokeKind::Inside
      ctx.setLineDash([]);
      if (sel && on){
        ctx.lineWidth = 2; ctx.strokeStyle = SELECTED; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        if (r.origin === 'user') handlePts(x, y, w, h).forEach(([cx, cy]) => { ctx.fillStyle = SELECTED; ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5); });
      }
      if (numbers && w > 18 && h > 12){
        const label = String(r.number).padStart(2, '0') + (r.origin === 'layer' ? ' ▪' : '');
        ctx.font = '10px sans-serif';
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = pass ? 'rgb(110,110,110)' : (sel && on) ? SELECTED : color;
        ctx.fillRect(x + 2, y + 2, tw + 6, 13);
        ctx.fillStyle = '#fff'; ctx.textBaseline = 'top'; ctx.fillText(label, x + 5, y + 3.5);
      }
    }
  }
  ctx.restore();
}
/* 8 个把手（左上、右上、左下、右下、上中、下中、左中、右中——slice_ui.rs:148 的顺序） */
function handlePts(x, y, w, h){ return [[x, y], [x + w, y], [x, y + h], [x + w, y + h], [x + w / 2, y], [x + w / 2, y + h], [x, y + h / 2], [x + w, y + h / 2]]; }
/* 拖曳预览（slice_ui.rs:182） */
function drawDrag(ctx, s){
  const d = SK.ui.drag; if (!d) return;
  const {color} = prefs();
  ctx.save();
  if (d.kind === 'new'){
    const r = dragRect(d.start, d.cur, d.mods);
    ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.strokeRect(r.x0 * s, r.y0 * s, rw(r) * s, rh(r) * s);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = color; ctx.strokeRect(r.x0 * s, r.y0 * s, rw(r) * s, rh(r) * s);
  } else if (d.kind === 'move' || d.kind === 'resize'){
    const r = SK.dragResult(d);
    ctx.lineWidth = 2; ctx.strokeStyle = SELECTED; ctx.strokeRect(r.x0 * s + 1, r.y0 * s + 1, rw(r) * s - 2, rh(r) * s - 2);
  }
  ctx.restore();
}

/* 全局叠画挂点（切片工具没开时，视图▸显示▸切片 也要看得到）——ui.js 最后才载，等 load 再挂 */
function mount(){ if (window.UI && Array.isArray(UI.overlays) && !UI.overlays.includes(drawAll)) UI.overlays.push(drawAll); }
if (document.readyState === 'complete') mount(); else window.addEventListener('load', mount);

/* 共用的小对话框（借 ps-layer2 的 dialog；没载就不开） */
function dialog(name, title, fields, onOK){
  const h = window.PsLayer2 && PsLayer2._h;
  if (!h || !h.dialog) return null;
  return h.dialog(name, title, fields, onOK);
}

const SK = window.SliceKit = {
  ui:{selected:null, hideAuto:false, drag:null},
  R, rw, rh, isEmpty, fromXYWH, toXYWH, inter, rround,
  list, getSlice, storedRect, autoSlices, resolve, sliceAt, rectFrom, dragRect, locked, resolvedJson, numberOf, handlePts,
  drawAll, drawDrag, dialog, L3,
  /* 移动／改大小拖曳的结果框（sliceselect.js 设 dragResult 的细节；这里给预设） */
  dragResult(d){ return d.rect; }
};

/* ═══════════ 工具 ═══════════ */
const STRINGS = {
  'zh-Hant':{'tool.slice':'切片', 'ui.sliceStyle':'樣式：正常', 'ui.sliceFromGuides':'以參考線為準的切片', 'ui.sliceLocked':'切片已鎖定（檢視 ▸ 鎖定切片）',
    'ui.sliceHint':'拖曳出切片（Shift 正方形、Alt 從中心）· 點一下＝選取點到的切片'},
  'zh-Hans':{'tool.slice':'切片', 'ui.sliceStyle':'样式：正常', 'ui.sliceFromGuides':'基于参考线的切片', 'ui.sliceLocked':'切片已锁定（视图 ▸ 锁定切片）',
    'ui.sliceHint':'拖出切片（Shift 正方形、Alt 从中心）· 点一下＝选中点到的切片'},
  'en':{'tool.slice':'Slice', 'ui.sliceStyle':'Style: Normal', 'ui.sliceFromGuides':'Slices From Guides', 'ui.sliceLocked':'Slices are locked (View › Lock Slices)',
    'ui.sliceHint':'Drag to draw a slice (Shift square, Alt from centre) · click selects the slice under the pointer'}
};
if (typeof Lang !== 'undefined') Lang.add(STRINGS);
const mods = e => ({shift:!!e.shiftKey, alt:!!e.altKey});

Tools.reg({
  id:'slice', icon:'✂', group:'raster', order:300, for:'raster', cursor:'crosshair', opts:[], strings:STRINGS,
  /* slice_ui.rs:63-67 Down：没锁就开始画 */
  onDown(e, pt){
    if (e.button !== undefined && e.button !== 0) return;
    SK.ui.drag = locked() ? null : {kind:'new', start:pt.slice(), cur:pt.slice(), mods:mods(e)};
  },
  onMove(e, pt, P){
    const d = SK.ui.drag; if (!d || !P.down) return;
    d.cur = pt.slice(); d.mods = mods(e); UI.draw();
  },
  /* slice_ui.rs:83-92 Up：框够大＝slice.new；太小＝点一下选点到的切片 */
  onUp(e, pt){
    const d = SK.ui.drag; SK.ui.drag = null;
    if (!d || d.kind !== 'new'){ UI.draw(); return; }
    const r = dragRect(d.start, pt, mods(e));
    if (rw(r) >= 1 && rh(r) >= 1 && (rw(r) > 2 || rh(r) > 2)){
      const v = CMD.run('slice.new', {rect:toXYWH(r)});
      if (v && v.ok !== false) SK.ui.selected = v.number;
    } else { const h = sliceAt(pt[0], pt[1]); SK.ui.selected = h ? h.number : null; }
    UI.draw();
  },
  onDeactivate(){ SK.ui.drag = null; },
  drawOverlay(ctx, s){ drawDrag(ctx, s); },
  /* slice_ui.rs:251-256、280-282 选项栏 */
  buildOptions(box){
    const lab = document.createElement('span'); lab.style.cssText = 'color:#9aa3ad;margin-right:6px'; lab.textContent = Lang.t('ui.sliceStyle'); box.appendChild(lab);
    const b = document.createElement('button'); b.type = 'button'; b.dataset.opt = 'fromGuides'; b.textContent = Lang.t('ui.sliceFromGuides');
    b.disabled = locked(); b.onclick = () => { const r = CMD.run('slice.fromGuides', {}); if (r && r.ok === false && r.error) console.warn(r.error); UI.draw(); };
    box.appendChild(b);
    if (locked()){ const n = document.createElement('span'); n.style.cssText = 'color:#9aa3ad;font-size:11px;margin-left:8px'; n.textContent = Lang.t('ui.sliceLocked'); box.appendChild(n); }
    const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t('ui.sliceHint'); box.appendChild(h);
  }
});

})();
