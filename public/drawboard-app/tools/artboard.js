/* 画板工具（V，PS 版面 ps.artboard）——照 ArtCraft／PhotoCraft 的 Rust 原码逐段翻译；原码没有画板工具的滑鼠段，滑鼠手势照 PS 2020 补
   对照源（photocraft/crates/…）：
     engine/src/artboard_cmds.rs 20-35   PRESETS（十种预设尺寸）、GAP＝100（新画板跟最右边那块的间距）
     engine/src/artboard_cmds.rs 128-186 fit_canvas（画布往右／往下长到放得下每块画板）、next_artboard_name、new_artboard（缺省＝文件大小、放在最右边那块右边 100）
     engine/src/artboard_cmds.rs 234-281 set_props（「内容」面板／画板工具：改 X/Y＝连内容一起搬、改宽高＝从左上角改、预设、背景、名字；手改尺寸就清掉预设）
     ui-egui/src/artboard_ui.rs  13-41   pasteboard_rects：画布扣掉每块画板＝粘贴板（照纵向条切）——画成粘贴板颜色盖住板外
     ui-egui/src/artboard_ui.rs  43-55   draw_frames：每块画板外框（当前画板＝强调色，其余黑 α90）＋板名写在板子左上方（当前那块亮色）
     ui-egui/src/artboard_ui.rs  57-71   fit_artboard（视图 ▸ 按屏幕大小缩放画板：留 60／80 给板名，置中到当前画板或最后一块）
     ui-egui/src/artboard_ui.rs  73-135  properties：尺寸预设下拉（自定＋十种）、W/H、X/Y、画板背景颜色（白／黑／透明／其它…＋拾色）→ layer.artboard.set
     ui-egui/src/canvas.rs       1304-1331 有画板才画粘贴板与外框
   命令：建／改画板的正文已在 menus/impl/ps-layer2.js（ps.layer.new.artboard、ps.layer.artboard.set，照 artboard_cmds.rs 翻好）——本档的 artboard.* 叫它们，
         另补 PS 画板工具才有的：画板左／上方加板（文件往左上外扩）、复制画板、删画板、选画板、按屏幕缩放画板。
   照 PS 2020 补的滑鼠手势：画板外拖＝拉出新画板（Shift 正方、Alt 从中心）；点画板或板名＝选它；拖画板＝连内容搬（Alt 拖＝复制一块）；
     拖当前画板的 8 个把手＝改大小（内容不动；Shift 保持比例、Alt 绕中心）；当前画板四边的「＋」＝在那一边加一块同尺寸的新画板（Alt＋点＝复制这块画板过去）；
     双击板名＝改名；方向键＝移 1 px（Shift 10 px）；Delete＝删画板（连内容）。
   选项栏（PS 画板工具选项栏＋原码 properties）：大小预设、宽、高、⇄ 直式／横式、X、Y、画板背景、＋ 添加新画板、按屏幕缩放画板。
  另有：选项栏对齐 6 钮＋分布 8 钮（artboard.align／artboard.distribute，算法照 engine/src/layer_multi_cmds.rs 的 align／distribute 翻）；
    Shift＋点画板＝多选（原码没有画板滑鼠段·照 PS 2020；artboard.selectMany）。 */
(function(){
'use strict';

const L3 = (hant, hans, en) => Lang.cur === 'en' ? en : Lang.cur === 'zh-Hans' ? hans : hant;
const fail = error => ({ok:false, error});
const rround = v => Math.sign(v) * Math.round(Math.abs(v));
const fin = v => typeof v === 'number' && isFinite(v);
const nv = v => (v === null || v === undefined || v === '' || typeof v === 'boolean') ? NaN : +v;

/* artboard_cmds.rs:21 PRESETS（跟 ps-layer2 同一张表） */
const PRESETS = [['iPhone 14', 390, 844], ['iPhone 14 Pro Max', 430, 932], ['Android 1080p', 360, 640], ['iPad Pro 12.9', 1024, 1366], ['Web 1280', 1280, 800],
  ['Web 1366', 1366, 768], ['Web 1920', 1920, 1080], ['Instagram Post', 1080, 1080], ['Letter', 612, 792], ['A4', 595, 842]];
const GAP = 100;                 // artboard_cmds.rs:35
const PASTEBOARD = '#171717';    // 粘贴板颜色＝画布区底色（style.css #stage）
const ACCENT = '#2f7fd8';        // 强调色（style.css --accent）

const isBoard = L => !!L && L.kind === 'group' && L.data && L.data.artboard && Array.isArray(L.data.artboard.rect) && !Groups.parentOf(L);
/* doc.artboards()：顶层的画板（由下到上） */
const boards = () => Doc.layers.filter(isBoard);
/* artboard_of(active)：当前层所在的画板（自己或顶层祖先） */
const activeBoard = () => { const L = Doc.active(); return L ? Groups.artboardOf(L) : null; };
const rectOf = B => B.data.artboard.rect;
const inR = (r, p, pad) => p[0] >= r[0] - (pad || 0) && p[0] <= r[0] + r[2] + (pad || 0) && p[1] >= r[1] - (pad || 0) && p[1] <= r[1] + r[3] + (pad || 0);
const zoom = () => (window.UI && UI.zoom) || 1;
/* 点到哪块画板（上面的先算） */
function boardAt(pt){ const bs = boards(); for (let i = bs.length - 1; i >= 0; i--) if (inR(rectOf(bs[i]), pt)) return bs[i]; return null; }
/* 板名那一条（文件坐标；板子上方 16 个萤幕点，放不下就在板内左上） */
function labelRect(B){
  const r = rectOf(B), z = zoom(), h = 16 / z, w = Math.max(60, String(B.name).length * 8) / z;
  return r[1] - h >= 0 ? [r[0], r[1] - h, w, h] : [r[0], r[1], w, h];
}
function labelAt(pt){ const bs = boards(); for (let i = bs.length - 1; i >= 0; i--) if (inR(labelRect(bs[i]), pt)) return bs[i]; return null; }
/* 当前画板的 8 个把手（文件坐标）→ {hx, hy} */
function handleAt(B, pt){
  const r = rectOf(B), tol = 5 / zoom();
  const xs = [[r[0], -1], [r[0] + r[2] / 2, 0], [r[0] + r[2], 1]], ys = [[r[1], -1], [r[1] + r[3] / 2, 0], [r[1] + r[3], 1]];
  for (const [y, hy] of ys) for (const [x, hx] of xs){
    if (!hx && !hy) continue;
    if (Math.abs(pt[0] - x) <= tol && Math.abs(pt[1] - y) <= tol) return {hx, hy};
  }
  return null;
}
/* 四边的「＋」：边中点往外 18 个萤幕点；出了文件就改放板内（我们的画布事件只收文件范围内） */
function plusPts(B){
  const r = rectOf(B), d = 18 / zoom(), cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2;
  const out = (v, lo, hi, alt) => (v >= lo && v <= hi) ? v : alt;
  return {
    top:   [cx, out(r[1] - d, 0, Doc.height, r[1] + d)],
    bottom:[cx, out(r[1] + r[3] + d, 0, Doc.height, r[1] + r[3] - d)],
    left:  [out(r[0] - d, 0, Doc.width, r[0] + d), cy],
    right: [out(r[0] + r[2] + d, 0, Doc.width, r[0] + r[2] - d), cy]
  };
}
function plusAt(B, pt){
  const P = plusPts(B), rad = 8 / zoom();
  for (const k of Object.keys(P)) if (Math.hypot(pt[0] - P[k][0], pt[1] - P[k][1]) <= rad) return k;
  return null;
}

/* 文件往左／上外扩 ox, oy（PS 的画板画布会往四面长；原码 fit_canvas 只往右下长）：所有内容往右下搬、画布加大 */
function expandDoc(ox, oy){
  if (!ox && !oy) return;
  const shiftCanvas = M => {
    const c = M.data.canvas, n = document.createElement('canvas'); n.width = c.width + ox; n.height = c.height + oy;
    n.getContext('2d').drawImage(c, ox, oy);
    M.data.canvas = n; M.data.ctx = n.getContext('2d', {willReadFrequently:true}); M._cache = null;
  };
  for (const L of Doc.layers){
    if (L.kind !== 'group'){ L.x += ox; L.y += oy; Layer.invalidate(L); }
    if (L.kind !== 'raster') [L.mask, L.maskOff].forEach(M => { if (M && M.data && M.data.canvas) shiftCanvas(M); });   // 像素层的蒙版贴在层自己的画布上，跟着层走
    if (L.kind === 'group' && L.data){
      if (L.data.artboard && Array.isArray(L.data.artboard.rect)){ L.data.artboard.rect[0] += ox; L.data.artboard.rect[1] += oy; }
      if (L.data.frame && Array.isArray(L.data.frame.rect)){ L.data.frame.rect[0] += ox; L.data.frame.rect[1] += oy; }   // tools/frame.js 的画框
      Layer.invalidate(L);
    }
  }
  (Array.isArray(Doc.slices) ? Doc.slices : []).forEach(s => { if (s.origin !== 'layer' && Array.isArray(s.rect)){ s.rect[0] += ox; s.rect[1] += oy; } });
  try { if (window.PsView && PsView.guides) PsView.guides().forEach(g => { g.pos += g.vertical ? ox : oy; }); } catch (e){}
  if (Doc.sel) Doc.sel = Object.assign({}, Doc.sel, {x:Doc.sel.x + ox, y:Doc.sel.y + oy});
  Doc.width += ox; Doc.height += oy;
  if (window.UI && UI.fit) UI.fit();
}
/* 目标框要是落到负坐标，先外扩；回外扩量 */
function ensureRoom(x, y){
  const ox = x < 0 ? -x : 0, oy = y < 0 ? -y : 0;
  if (ox || oy) expandDoc(Math.ceil(ox), Math.ceil(oy));
  return [Math.ceil(ox), Math.ceil(oy)];
}
/* 画布长大后（fit_canvas）图框的蒙版要跟着换成新的文件大小（组蒙版是照文件大小拉的；tools/frame.js） */
const syncMasks = () => { if (window.FrameKit && FrameKit.syncMasks) FrameKit.syncMasks(); };
/* 画板连内容搬家时，板里的图框（组）不会被 Groups.shiftLayer 搬（组本身不带位移）⇒ 框与蒙版自己跟着搬 */
function shiftFramesIn(B, dx, dy){
  if (!B || (!dx && !dy) || !window.FrameKit) return;
  Groups.descendants(B).forEach(G => { if (FrameKit.isFrame(G)){ G.data.frame.rect[0] += dx; G.data.frame.rect[1] += dy; FrameKit.buildMask(G); } });
}
/* 命令里再叫命令：直接跑正文（CMD.run 巢状也会各推一步历史；外层这条已经推过了） */
const sub = (id, q) => CMD.map[id].run(q || {});
const need = id => CMD.map[id] ? null : fail(`${id} is not loaded (menus/impl/ps-layer2.js)`);
const boardOf = p => { const L = (p && (p.id || p.layer)) ? Doc.byId(p.id || p.layer) : Doc.active(); return L ? Groups.artboardOf(L) : null; };
const out = B => ({id:B.id, name:B.name, rect:rectOf(B).slice(), background:B.data.artboard.background, preset:B.data.artboard.preset || ''});

/* ═══════════ 命令（命名空间＝工具 id「artboard」） ═══════════ */
const BGP = 'background?:"white|black|transparent|custom", color?:"#rrggbb"';
CMD.reg('artboard.new', {i18n:'', undoable:true, params:`{rect?:[x,y,w,h] | x?,y?,width?,height?（缺省＝文件大小、放在最右边那块右边 100）, preset?:"${PRESETS.map(q => q[0]).join('|')}", name?, ${BGP}} 新建画板（负坐标＝文件往左上外扩；正文＝ps.layer.new.artboard，artboard_cmds.rs:153）→ {id, rect}`}, p => {
  const e = need('ps.layer.new.artboard'); if (e) return e;
  const q = Object.assign({}, p);
  if (Array.isArray(q.rect) && q.rect.length === 4){
    const r = q.rect.map(v => rround(nv(v)));
    if (r.some(v => !isFinite(v))) return fail('"rect" must be [x, y, width, height] with a positive size');
    const [ox, oy] = ensureRoom(r[0], r[1]); r[0] += ox; r[1] += oy; q.rect = r;
  } else if (fin(nv(q.x)) || fin(nv(q.y))){
    const [ox, oy] = ensureRoom(fin(nv(q.x)) ? nv(q.x) : 0, fin(nv(q.y)) ? nv(q.y) : 0);
    if (fin(nv(q.x))) q.x = nv(q.x) + ox; if (fin(nv(q.y))) q.y = nv(q.y) + oy;
  }
  const r = sub('ps.layer.new.artboard', q);
  if (!r || r.ok === false) return r || fail('artboard.new failed');
  syncMasks();
  return Object.assign({ok:true}, r);
});
CMD.reg('artboard.set', {i18n:'', undoable:true, params:`{id?（画板或里面的层；缺省＝当前画板）, rect?:[x,y,w,h] | x?,y?,width?,height?, preset?, name?, ${BGP}, moveContents=true（改 X/Y 时内容跟着搬；画板工具拖把手改大小用 false）} 改画板（正文＝ps.layer.artboard.set，artboard_cmds.rs:236）→ {id, rect}`}, p => {
  const e = need('ps.layer.artboard.set'); if (e) return e;
  const B = boardOf(p); if (!B) return fail('no artboard selected');
  const q = Object.assign({}, p, {id:B.id}); delete q.layer;
  const old = rectOf(B).slice();
  const x = Array.isArray(q.rect) ? nv(q.rect[0]) : fin(nv(q.x)) ? nv(q.x) : old[0];
  const y = Array.isArray(q.rect) ? nv(q.rect[1]) : fin(nv(q.y)) ? nv(q.y) : old[1];
  if (isFinite(x) && isFinite(y)){
    const [ox, oy] = ensureRoom(rround(x), rround(y));
    if (ox || oy){
      if (Array.isArray(q.rect)){ q.rect = q.rect.slice(); q.rect[0] = nv(q.rect[0]) + ox; q.rect[1] = nv(q.rect[1]) + oy; }
      else { q.x = rround(x) + ox; q.y = rround(y) + oy; }
    }
  }
  const before = rectOf(B).slice();
  const r = sub('ps.layer.artboard.set', q);
  if (r && r.ok !== false && q.moveContents !== false) shiftFramesIn(B, rectOf(B)[0] - before[0], rectOf(B)[1] - before[1]);
  syncMasks();
  return r;
});
/* PS「＋」：在这一边加一块同尺寸的画板（被别块占了就再往外推） */
function sideRect(B, side){
  const r = rectOf(B), [w, h] = [r[2], r[3]];
  const step = {right:[w + GAP, 0], left:[-(w + GAP), 0], bottom:[0, h + GAP], top:[0, -(h + GAP)]}[side];
  let c = [r[0] + step[0], r[1] + step[1], w, h];
  const hits = c2 => boards().some(o => { const q = rectOf(o); return c2[0] < q[0] + q[2] && c2[0] + c2[2] > q[0] && c2[1] < q[1] + q[3] && c2[1] + c2[3] > q[1]; });
  for (let n = 0; n < 1000 && hits(c); n++) c = [c[0] + step[0], c[1] + step[1], w, h];
  return c;
}
CMD.reg('artboard.add', {i18n:'', undoable:true, params:'{id?（缺省＝当前画板）, side:"right|left|top|bottom", duplicate=false（true＝连内容复制这块画板过去＝PS 的 Alt＋点「＋」）} 在画板旁边加一块同尺寸的新画板 → {id, rect}'}, p => {
  const B = boardOf(p); if (!B) return fail('no artboard selected');
  const side = p.side || 'right'; if (!['right', 'left', 'top', 'bottom'].includes(side)) return fail('side must be right|left|top|bottom');
  const c = sideRect(B, side), r = rectOf(B);
  if (p.duplicate) return sub('artboard.duplicate', {id:B.id, dx:c[0] - r[0], dy:c[1] - r[1]});
  return sub('artboard.new', {rect:c});
});
CMD.reg('artboard.duplicate', {i18n:'', undoable:true, params:'{id?（缺省＝当前画板）, dx=0, dy=0（复制品相对原画板的位移；负的会让文件往左上外扩）} 复制画板（连内容；名字加「 copy」）→ {id, rect}'}, p => {
  const e = need('ps.layer.artboard.set'); if (e) return e;
  const B = boardOf(p); if (!B) return fail('no artboard selected');
  const dx = fin(nv(p.dx)) ? rround(nv(p.dx)) : 0, dy = fin(nv(p.dy)) ? rround(nv(p.dy)) : 0;
  const r = rectOf(B);
  ensureRoom(r[0] + dx, r[1] + dy);
  const r2 = rectOf(B).slice();
  const d = sub('layer.duplicate', {id:B.id}); if (!d || !d.id) return fail('duplicate failed');
  const s = sub('ps.layer.artboard.set', {id:d.id, x:r2[0] + dx, y:r2[1] + dy});
  if (!s || s.ok === false) return s || fail('artboard.duplicate failed');
  shiftFramesIn(Doc.byId(d.id), dx, dy);
  syncMasks();
  Doc.activeId = d.id;
  return {ok:true, id:d.id, rect:rectOf(Doc.byId(d.id)).slice()};
});
CMD.reg('artboard.delete', {i18n:'', undoable:true, params:'{id?（缺省＝当前画板）} 删除画板（连里面的图层）→ {ok}'}, p => {
  const B = boardOf(p); if (!B) return fail('no artboard selected');
  return {ok:Doc.remove(B.id)};
});
CMD.reg('artboard.select', {i18n:'', params:'{id} 选中画板（当前层＝那个画板组；不进历史）→ {id}'}, p => {
  const B = boardOf(p); if (!B) return fail('no such artboard');
  Doc.activeId = B.id; Doc.selectedIds = null;
  if (window.UI) UI.refresh();
  return {ok:true, id:B.id};
});
CMD.reg('artboard.list', {i18n:'', params:'{} 全部画板（由下到上）→ {artboards:[{id,name,rect:[x,y,w,h],background,preset}], active}'}, () => {
  const A = activeBoard();
  return {ok:true, artboards:boards().map(out), active:A ? A.id : null};
});
/* ═══ 画板对齐／分布——照 photocraft engine/src/layer_multi_cmds.rs 翻：can_align 165、can_distribute 173、Edge 376-412、align 419-462、distribute 478-523
   原码作用在「选中的图层」上（外框＝layer_bounds）；PS 画板工具选项栏的对齐／分布钮也是这一组，我们套在选中的画板上（外框＝画板矩形）。
   选中的画板：p.ids ＞ Doc.selectedIds 里的画板（须含当前画板，否则当过期）＞ 当前画板。
   对齐 to：auto（原码：1 块＋有选区＝对齐选区外框；1 块没选区＝对齐画布；2 块以上＝联集外框）｜layers｜selection｜canvas；
   边的坐标都乘 2（中线才保持整数），位移＝div_euclid(目标×2 − 自己×2, 2)（往下取整）。
   分布：至少 3 块；按边（6 种）＝ 两端之间等分、位移 round；horizontally／vertically（＝PS「分布间距」）＝相邻等间距、两端不动、游标 round。
   每块用 artboard.set 搬（连内容一起搬、板里的图框跟着），整条命令一步历史。 */
function selectedBoards(p){
  const all = boards();
  let ids = Array.isArray(p && p.ids) ? p.ids : null;
  const A = activeBoard();
  if (!ids && Array.isArray(Doc.selectedIds) && A){
    const sel = Doc.selectedIds.map(id => Doc.byId(id)).filter(Boolean).map(L => Groups.artboardOf(L)).filter(Boolean);
    if (sel.includes(A)) ids = [...new Set(sel.map(B => B.id))];
  }
  if (!ids) ids = A ? [A.id] : [];
  return all.filter(B => ids.includes(B.id));
}
/* Edge::parse：原码名＋我们选项栏的短名 */
const EDGE_NAMES = {topEdges:'top', verticalCenters:'vcenter', bottomEdges:'bottom', leftEdges:'left', horizontalCenters:'hcenter', rightEdges:'right',
                    top:'top', vcenter:'vcenter', bottom:'bottom', left:'left', hcenter:'hcenter', right:'right'};
const ALIGNS = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'];
const DISTS = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom', 'hspace', 'vspace'];
const vertical = e => e === 'top' || e === 'vcenter' || e === 'bottom';
/* Rect → [x0,y0,x1,y1]；value2＝边坐标×2 */
const r4 = r => [r[0], r[1], r[0] + r[2], r[1] + r[3]];
function value2(e, R){
  const [a, b] = vertical(e) ? [R[1], R[3]] : [R[0], R[2]];
  return e === 'top' || e === 'left' ? 2 * a : e === 'bottom' || e === 'right' ? 2 * b : a + b;
}
const delta = (e, d) => vertical(e) ? [0, d] : [d, 0];
const divEuclid = (a, b) => { const q = Math.trunc(a / b), r = a - q * b; return r < 0 ? (b > 0 ? q - 1 : q + 1) : q; };
function moveBoardBy(B, dx, dy){
  if (!dx && !dy) return false;
  const r = rectOf(B), q = sub('artboard.set', {id:B.id, x:r[0] + dx, y:r[1] + dy});
  return !(q && q.ok === false);
}
const selBounds = () => { const s = Doc.sel; if (!s) return null; return [s.x, s.y, s.x + s.w, s.y + s.h]; };
CMD.reg('artboard.align', {i18n:'', undoable:true, params:`{align:"${ALIGNS.join('|')}"（也收原码名 topEdges|verticalCenters|bottomEdges|leftEdges|horizontalCenters|rightEdges）, to="auto"|"layers"|"selection"|"canvas", ids?:[画板 id…]（缺省＝图层面板多选里的画板，没多选＝当前画板）} 对齐画板（layer_multi_cmds.rs align：auto＝1 块有选区对选区、1 块没选区对画布、2 块以上对联集；内容跟着搬）→ {moved:[id…], artboards}`}, p => {
  const e = EDGE_NAMES[p && p.align]; if (!e) return fail(`align must be ${ALIGNS.join('|')}`);
  const to = p.to === undefined ? 'auto' : p.to;
  if (!['auto', 'layers', 'selection', 'canvas'].includes(to)) return fail(`\`to\` must be auto|layers|selection|canvas, not \`${to}\``);
  const bs = selectedBoards(p); if (!bs.length) return fail('no artboard selected');
  const items = bs.map(B => [B, r4(rectOf(B))]);
  const uni = items.reduce((a, [, R]) => a ? [Math.min(a[0], R[0]), Math.min(a[1], R[1]), Math.max(a[2], R[2]), Math.max(a[3], R[3])] : R.slice(), null);
  let target;
  if (to === 'canvas') target = [0, 0, Doc.width, Doc.height];
  else if (to === 'selection'){ target = selBounds(); if (!target) return fail('there is no selection to align to'); }
  else if (to === 'auto' && bs.length === 1) target = selBounds() || [0, 0, Doc.width, Doc.height];
  else target = uni;
  if (target[2] <= target[0] || target[3] <= target[1]) return fail('nothing to align to');
  const t2 = value2(e, target), moved = [];
  items.forEach(([B, R]) => { const [dx, dy] = delta(e, divEuclid(t2 - value2(e, R), 2)); if (moveBoardBy(B, dx, dy)) moved.push(B.id); });
  return {ok:true, moved, artboards:boards().map(out)};
});
CMD.reg('artboard.distribute', {i18n:'', undoable:true, params:`{distribute:"${DISTS.join('|')}"（left…bottom＝按那条边或中线等分；hspace／vspace＝相邻间距相等；也收原码名 topEdges…rightEdges、horizontally、vertically）, ids?（同 artboard.align）} 分布画板（layer_multi_cmds.rs distribute；至少 3 块）→ {moved, artboards}`}, p => {
  const k0 = p && p.distribute, kind = k0 === 'horizontally' ? 'hspace' : k0 === 'vertically' ? 'vspace' : (k0 === 'hspace' || k0 === 'vspace') ? k0 : EDGE_NAMES[k0];
  if (!kind) return fail(`distribute must be ${DISTS.join('|')}`);
  const bs = selectedBoards(p); if (bs.length < 3) return fail('distributing needs three or more artboards');
  let items = bs.map(B => [B, r4(rectOf(B))]);
  const n = items.length, moved = [];
  if (kind === 'hspace' || kind === 'vspace'){
    const v = kind === 'vspace', lo = R => v ? R[1] : R[0], hi = R => v ? R[3] : R[2];
    items.sort((a, b) => (lo(a[1]) + hi(a[1])) - (lo(b[1]) + hi(b[1])) || lo(a[1]) - lo(b[1]));
    const span = hi(items[n - 1][1]) - lo(items[0][1]), total = items.reduce((t, [, R]) => t + hi(R) - lo(R), 0);
    const gap = (span - total) / (n - 1);
    let cursor = lo(items[0][1]);
    items.forEach(([B, R]) => {
      const d = Math.round(cursor) - lo(R);
      if (moveBoardBy(B, v ? 0 : d, v ? d : 0)) moved.push(B.id);
      cursor += (hi(R) - lo(R)) + gap;
    });
  } else {
    items.sort((a, b) => value2(kind, a[1]) - value2(kind, b[1]));
    const first = value2(kind, items[0][1]), last = value2(kind, items[n - 1][1]);
    items.forEach(([B, R], i) => {
      const want2 = first + (last - first) * i / (n - 1);
      const [dx, dy] = delta(kind, Math.round((want2 - value2(kind, R)) / 2));
      if (moveBoardBy(B, dx, dy)) moved.push(B.id);
    });
  }
  return {ok:true, moved, artboards:boards().map(out)};
});
CMD.reg('artboard.selectMany', {i18n:'', params:'{ids:[画板 id…], add=false（true＝加进现有多选）} 多选画板（写进 Doc.selectedIds、当前层＝最后一块；不进历史）→ {ids}'}, p => {
  const want = (Array.isArray(p && p.ids) ? p.ids : []).map(id => Doc.byId(id)).filter(isBoard);
  if (!want.length) return fail('give ids of artboards');
  const cur = p.add ? selectedBoards({}) : [];
  const ids = [...new Set(cur.concat(want).map(B => B.id))];
  Doc.activeId = want[want.length - 1].id;
  Doc.selectedIds = ids.length > 1 ? ids.sort((a, b) => Doc.index(a) - Doc.index(b)) : null;
  if (window.UI) UI.refresh();
  return {ok:true, ids};
});
/* artboard_ui.rs:58 fit_artboard */
CMD.reg('artboard.fit', {i18n:'', params:'{id?} 视图 ▸ 按屏幕大小缩放画板：缩放并置中到当前画板（没有就最后一块）→ {zoom, artboard, bounds:[x0,y0,x1,y1]}'}, p => {
  let B = (p && p.id) ? boardOf(p) : activeBoard();
  if (!B){ const bs = boards(); B = bs[bs.length - 1]; }
  if (!B) return fail('the document has no artboards');
  const r = rectOf(B);
  const wrap = document.getElementById('canvasWrap');
  let aw = wrap ? wrap.clientWidth : 0, ah = wrap ? wrap.clientHeight : 0;
  if (aw <= 50){ aw = 1200; ah = 800; }
  const z = Math.max(0.01, Math.min(64, Math.min((aw - 60) / Math.max(1, r[2]), (ah - 80) / Math.max(1, r[3]))));
  if (window.UI) UI.setZoom(z);
  if (window.HandView) HandView.setCenter(r[0] + r[2] / 2, r[1] + r[3] / 2);
  if (window.UI) UI.draw();
  return {ok:true, zoom:window.UI ? UI.zoom : z, artboard:B.id, bounds:[r[0], r[1], r[0] + r[2], r[1] + r[3]]};
});

/* ═══════════ 叠画 ═══════════ */
/* artboard_ui.rs:15 pasteboard_rects：画布扣掉各画板（按画板的 x 边切纵条，条里扣掉横跨它的画板） */
function pasteboardRects(){
  const W = Doc.width, H = Doc.height;
  const bs = boards().map(b => { const r = rectOf(b); return [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(W, r[0] + r[2]), Math.min(H, r[1] + r[3])]; }).filter(r => r[2] > r[0] && r[3] > r[1]);
  let xs = [0, W]; bs.forEach(b => xs.push(b[0], b[2]));
  xs = [...new Set(xs)].sort((a, b) => a - b);
  const outR = [];
  for (let i = 0; i + 1 < xs.length; i++){
    const x0 = xs[i], x1 = xs[i + 1];
    const spans = bs.filter(b => b[0] <= x0 && b[2] >= x1).map(b => [b[1], b[3]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let y = 0;
    for (const [a, b] of spans){ if (a > y) outR.push([x0, y, x1, a]); y = Math.max(y, b); }
    if (y < H) outR.push([x0, y, x1, H]);
  }
  return outR;
}
/* canvas.rs:1305 有画板才画：粘贴板、外框与板名（artboard_ui.rs:44 draw_frames） */
function drawAll(ctx, s){
  const bs = boards(); if (!bs.length) return;
  const A = activeBoard();
  ctx.save();
  ctx.fillStyle = PASTEBOARD;
  pasteboardRects().forEach(r => ctx.fillRect(r[0] * s, r[1] * s, (r[2] - r[0]) * s, (r[3] - r[1]) * s));
  ctx.font = '11px sans-serif'; ctx.textBaseline = 'bottom';
  for (const B of bs){
    const r = rectOf(B), on = A === B;
    ctx.lineWidth = 1; ctx.strokeStyle = on ? ACCENT : 'rgba(0,0,0,0.353)';
    ctx.strokeRect(r[0] * s - 0.5, r[1] * s - 0.5, r[2] * s + 1, r[3] * s + 1);   // StrokeKind::Outside
    const above = r[1] * s - 4 >= 12;
    ctx.fillStyle = on ? '#d6d6d6' : '#9a9a9a';
    if (!above){ ctx.fillStyle = on ? ACCENT : 'rgba(80,80,80,0.9)'; }
    ctx.fillText(B.name, r[0] * s + (above ? 0 : 3), above ? r[1] * s - 4 : r[1] * s + 14);
  }
  ctx.restore();
}
function mount(){ if (window.UI && Array.isArray(UI.overlays) && !UI.overlays.includes(drawAll)) UI.overlays.push(drawAll); }
if (document.readyState === 'complete') mount(); else window.addEventListener('load', mount);

/* ═══════════ 手势 ═══════════ */
const AB = window.ArtboardKit = {
  drag:null,
  PRESETS, GAP, boards, activeBoard, boardAt, labelAt, labelRect, handleAt, plusPts, plusAt, pasteboardRects, expandDoc, sideRect, drawAll,
  /* 拖曳中的结果框 */
  result(d){
    const dx = d.cur[0] - d.start[0], dy = d.cur[1] - d.start[1];
    if (d.kind === 'new'){
      let e = d.cur.slice();
      if (d.mods.shift){ const k = Math.max(Math.abs(dx), Math.abs(dy)); e = [d.start[0] + (dx < 0 ? -k : k), d.start[1] + (dy < 0 ? -k : k)]; }
      const a = d.mods.alt ? [2 * d.start[0] - e[0], 2 * d.start[1] - e[1]] : d.start;
      const x0 = rround(Math.min(a[0], e[0])), y0 = rround(Math.min(a[1], e[1])), x1 = rround(Math.max(a[0], e[0])), y1 = rround(Math.max(a[1], e[1]));
      return [x0, y0, x1 - x0, y1 - y0];
    }
    const r = d.rect;
    if (d.kind === 'move') return [r[0] + rround(dx), r[1] + rround(dy), r[2], r[3]];
    // resize：拖的边跟着走；Alt＝对边也反向走（绕中心）；Shift＝保持原比例（角：较大那边说了算；边：另一轴按比例、绕中线）
    let x0 = r[0], y0 = r[1], x1 = r[0] + r[2], y1 = r[1] + r[3];
    const ddx = rround(dx), ddy = rround(dy);
    if (d.hx === -1){ x0 += ddx; if (d.mods.alt) x1 -= ddx; } else if (d.hx === 1){ x1 += ddx; if (d.mods.alt) x0 -= ddx; }
    if (d.hy === -1){ y0 += ddy; if (d.mods.alt) y1 -= ddy; } else if (d.hy === 1){ y1 += ddy; if (d.mods.alt) y0 -= ddy; }
    let w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    if (d.mods.shift && r[2] > 0 && r[3] > 0){
      const k = r[2] / r[3];
      if (d.hx && d.hy){ const sc = Math.max(w / r[2], h / r[3]); w = Math.round(r[2] * sc); h = Math.round(r[3] * sc); }
      else if (d.hx) h = Math.round(w / k); else w = Math.round(h * k);
      const fx = d.hx === -1 ? Math.max(x0, x1) : d.hx === 1 ? Math.min(x0, x1) : null;
      const fy = d.hy === -1 ? Math.max(y0, y1) : d.hy === 1 ? Math.min(y0, y1) : null;
      const cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2;
      const nx = d.mods.alt || fx === null ? Math.round(cx - w / 2) : d.hx === -1 ? fx - w : fx;
      const ny = d.mods.alt || fy === null ? Math.round(cy - h / 2) : d.hy === -1 ? fy - h : fy;
      return [nx, ny, Math.max(1, w), Math.max(1, h)];
    }
    return [Math.min(x0, x1), Math.min(y0, y1), Math.max(1, w), Math.max(1, h)];
  }
};
const mods = e => ({shift:!!e.shiftKey, alt:!!e.altKey});
const rebuild = () => { if (window.UI && ToolState.cur === 'artboard') UI.buildOptions('artboard'); if (window.UI) UI.draw(); };
const report = r => { if (r && r.ok === false && r.error) console.warn(r.error); return r; };

/* 工具自己的叠画：当前画板的把手、四个「＋」，拖曳预览 */
function drawTool(ctx, s){
  const A = activeBoard();
  ctx.save();
  if (A && !(AB.drag && AB.drag.kind !== 'plus')){
    const r = rectOf(A);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1;
    const xs = [r[0], r[0] + r[2] / 2, r[0] + r[2]], ys = [r[1], r[1] + r[3] / 2, r[1] + r[3]];
    ys.forEach((y, j) => xs.forEach((x, i) => { if (i === 1 && j === 1) return; ctx.fillRect(x * s - 3, y * s - 3, 6, 6); ctx.strokeRect(x * s - 3.5, y * s - 3.5, 7, 7); }));
    const P = plusPts(A);
    Object.values(P).forEach(([x, y]) => {
      ctx.beginPath(); ctx.arc(x * s, y * s, 8, 0, Math.PI * 2); ctx.fillStyle = 'rgba(47,127,216,0.85)'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x * s - 4, y * s); ctx.lineTo(x * s + 4, y * s); ctx.moveTo(x * s, y * s - 4); ctx.lineTo(x * s, y * s + 4); ctx.stroke();
    });
  }
  // 多选的画板：强调色粗框
  const sel = selectedBoards({});
  if (sel.length > 1){
    ctx.lineWidth = 2; ctx.strokeStyle = ACCENT;
    sel.forEach(B => { const r = rectOf(B); ctx.strokeRect(r[0] * s - 1, r[1] * s - 1, r[2] * s + 2, r[3] * s + 2); });
  }
  const d = AB.drag;
  if (d && d.kind !== 'plus' && d.moved){
    const r = AB.result(d);
    ctx.lineWidth = 1; ctx.strokeStyle = ACCENT; ctx.setLineDash([4, 3]);
    ctx.strokeRect(r[0] * s + 0.5, r[1] * s + 0.5, r[2] * s, r[3] * s);
    ctx.setLineDash([]); ctx.fillStyle = '#d6d6d6'; ctx.font = '11px sans-serif'; ctx.textBaseline = 'top';
    ctx.fillText(`${r[2]} × ${r[3]}`, r[0] * s + 3, (r[1] + r[3]) * s + 3);
  }
  ctx.restore();
}

const STRINGS = {
  'zh-Hant':{'tool.artboard':'工作區域', 'opt.abPreset':'大小', 'opt.abW':'寬', 'opt.abH':'高', 'opt.abX':'X', 'opt.abY':'Y', 'opt.abBg':'背景', 'ui.abCustom':'自訂',
    'ui.abOrient':'直式／橫式', 'ui.abAdd':'新增工作區域', 'ui.abFit':'依螢幕大小顯示工作區域', 'ui.abWhite':'白色', 'ui.abBlack':'黑色', 'ui.abTransparent':'透明', 'ui.abOther':'其他…',
    'ui.abRename':'工作區域名稱', 'ui.abHint':'工作區域外拖曳＝新增 · 拖曳工作區域＝移動（Alt 複製）· 拖把手改大小 · 點「＋」加一塊（Alt 複製）· 雙擊名稱改名'},
  'zh-Hans':{'tool.artboard':'画板', 'opt.abPreset':'大小', 'opt.abW':'宽', 'opt.abH':'高', 'opt.abX':'X', 'opt.abY':'Y', 'opt.abBg':'背景', 'ui.abCustom':'自定',
    'ui.abOrient':'纵向／横向', 'ui.abAdd':'添加新画板', 'ui.abFit':'按屏幕大小缩放画板', 'ui.abWhite':'白色', 'ui.abBlack':'黑色', 'ui.abTransparent':'透明', 'ui.abOther':'其它…',
    'ui.abRename':'画板名称', 'ui.abHint':'画板外拖动＝新建 · 拖画板＝移动（Alt 复制）· 拖把手改大小 · 点「＋」加一块（Alt 复制）· 双击板名改名'},
  'en':{'tool.artboard':'Artboard', 'opt.abPreset':'Size', 'opt.abW':'W', 'opt.abH':'H', 'opt.abX':'X', 'opt.abY':'Y', 'opt.abBg':'Background', 'ui.abCustom':'Custom',
    'ui.abOrient':'Portrait / Landscape', 'ui.abAdd':'Add New Artboard', 'ui.abFit':'Fit Artboard on Screen', 'ui.abWhite':'White', 'ui.abBlack':'Black', 'ui.abTransparent':'Transparent', 'ui.abOther':'Other…',
    'ui.abRename':'Artboard name', 'ui.abHint':'Drag outside boards to add one · drag a board to move (Alt copies) · handles resize · click + to add (Alt copies) · double-click the name to rename'}
};
/* 对齐／分布钮的提示（照 PS 2020 中文版移动／画板工具选项栏用语） */
{
  const T = {
    left:['靠左對齊', '左对齐', 'Align left edges'], hcenter:['水平居中', '水平居中对齐', 'Align horizontal centers'], right:['靠右對齊', '右对齐', 'Align right edges'],
    top:['頂端對齊', '顶对齐', 'Align top edges'], vcenter:['垂直居中', '垂直居中对齐', 'Align vertical centers'], bottom:['底部對齊', '底对齐', 'Align bottom edges']};
  const D = {
    top:['頂端均分', '按顶分布', 'Distribute top edges'], vcenter:['垂直居中均分', '垂直居中分布', 'Distribute vertical centers'], bottom:['底部均分', '按底分布', 'Distribute bottom edges'],
    left:['左邊均分', '按左分布', 'Distribute left edges'], hcenter:['水平居中均分', '水平居中分布', 'Distribute horizontal centers'], right:['右邊均分', '按右分布', 'Distribute right edges'],
    hspace:['水平均分間距', '水平分布间距', 'Distribute horizontal spacing'], vspace:['垂直均分間距', '垂直分布间距', 'Distribute vertical spacing']};
  ['zh-Hant', 'zh-Hans', 'en'].forEach((l, i) => {
    Object.keys(T).forEach(k => { STRINGS[l]['ui.abAlign_' + k] = T[k][i]; });
    Object.keys(D).forEach(k => { STRINGS[l]['ui.abDist_' + k] = D[k][i]; });
  });
  STRINGS['zh-Hant']['ui.abHint'] += ' · Shift＋點工作區域＝多選（對齊／均分）';
  STRINGS['zh-Hans']['ui.abHint'] += ' · Shift＋点画板＝多选（对齐／分布）';
  STRINGS['en']['ui.abHint'] += ' · Shift-click boards to multi-select (align / distribute)';
}
if (typeof Lang !== 'undefined') Lang.add(STRINGS);

Tools.reg({
  id:'artboard', icon:'▭', group:'select', order:12, for:'raster', cursor:'default', opts:[], strings:STRINGS,
  onDown(e, pt){
    AB.drag = null;
    if (e.button !== undefined && e.button !== 0) return;
    const A = activeBoard(), m = mods(e), base = {start:pt.slice(), cur:pt.slice(), mods:m, moved:false};
    if (A){
      const side = plusAt(A, pt);
      if (side){ AB.drag = Object.assign(base, {kind:'plus', id:A.id, side, alt:m.alt}); return; }
      const h = handleAt(A, pt);
      if (h){ AB.drag = Object.assign(base, {kind:'resize', id:A.id, hx:h.hx, hy:h.hy, rect:rectOf(A).slice()}); return; }
    }
    const B = labelAt(pt) || boardAt(pt);
    if (B && m.shift){                                             // Shift＋点画板＝加进／移出多选（PS；对齐／分布用）
      const cur = selectedBoards({}).map(X => X.id);
      if (cur.includes(B.id) && cur.length > 1){
        const rest = cur.filter(id => id !== B.id);
        Doc.selectedIds = rest.length > 1 ? rest : null; Doc.activeId = rest[rest.length - 1];
        if (window.UI) UI.refresh();
      } else CMD.run('artboard.selectMany', {ids:[B.id], add:true});
      rebuild(); return;
    }
    if (B){
      if (B !== A || (Array.isArray(Doc.selectedIds) && !selectedBoards({}).includes(B))) CMD.run('artboard.select', {id:B.id});
      AB.drag = Object.assign(base, {kind:'move', id:B.id, rect:rectOf(B).slice()});
      rebuild(); return;
    }
    AB.drag = Object.assign(base, {kind:'new'});
  },
  onMove(e, pt, P){
    const d = AB.drag;
    if (!d || !P.down){
      const A = activeBoard();
      if (window.UI) UI.canvas.style.cursor = A && plusAt(A, pt) ? 'pointer' : A && handleAt(A, pt) ? 'nwse-resize' : boardAt(pt) ? 'move' : 'crosshair';
      return;
    }
    d.cur = pt.slice(); d.mods = mods(e);
    if (Math.hypot(d.cur[0] - d.start[0], d.cur[1] - d.start[1]) * zoom() > 3) d.moved = true;
    UI.draw();
  },
  onUp(e, pt){
    const d = AB.drag; AB.drag = null;
    if (!d){ UI.draw(); return; }
    d.cur = pt.slice(); d.mods = mods(e);
    if (Math.hypot(d.cur[0] - d.start[0], d.cur[1] - d.start[1]) * zoom() > 3) d.moved = true;
    if (d.kind === 'plus'){
      const B = Doc.byId(d.id);
      if (B && plusAt(B, pt) === d.side) report(CMD.run('artboard.add', {id:d.id, side:d.side, duplicate:d.alt}));
    } else if (d.kind === 'new'){
      const r = AB.result(d);
      if (d.moved && r[2] >= 2 && r[3] >= 2) report(CMD.run('artboard.new', {rect:r}));
    } else if (d.kind === 'move' && d.moved){
      const r = AB.result(d), dx = r[0] - d.rect[0], dy = r[1] - d.rect[1];
      if (dx || dy){
        if (d.mods.alt) report(CMD.run('artboard.duplicate', {id:d.id, dx, dy}));
        else report(CMD.run('artboard.set', {id:d.id, x:r[0], y:r[1]}));
      }
    } else if (d.kind === 'resize' && d.moved){
      const r = AB.result(d), o = d.rect;
      if (r[0] !== o[0] || r[1] !== o[1] || r[2] !== o[2] || r[3] !== o[3]) report(CMD.run('artboard.set', {id:d.id, rect:r, moveContents:false}));
    }
    rebuild();
  },
  /* 双击板名＝改名（PS：图层面板／画布上的板名双击） */
  onDblClick(e, pt){
    const B = labelAt(pt); if (!B) return;
    const name = window.prompt(Lang.t('ui.abRename'), B.name);
    if (name && name !== B.name) report(CMD.run('artboard.set', {id:B.id, name}));
    rebuild();
  },
  onKey(e){
    const A = activeBoard(); if (!A || e.ctrlKey || e.metaKey) return false;
    const r = rectOf(A), k = e.shiftKey ? 10 : 1;
    const mv = {ArrowLeft:[-k, 0], ArrowRight:[k, 0], ArrowUp:[0, -k], ArrowDown:[0, k]}[e.key];
    if (mv && !e.altKey){ e.preventDefault(); report(CMD.run('artboard.set', {id:A.id, x:r[0] + mv[0], y:r[1] + mv[1]})); rebuild(); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.altKey){ e.preventDefault(); report(CMD.run('artboard.delete', {id:A.id})); rebuild(); return true; }
    return false;
  },
  onDeactivate(){ AB.drag = null; },
  drawOverlay(ctx, s){ drawTool(ctx, s); },
  /* PS 画板工具选项栏＋artboard_ui.rs:74 properties */
  buildOptions(box, add, mk){
    const A = activeBoard(), a = A ? A.data.artboard : null, r = A ? rectOf(A) : [0, 0, Doc.width, Doc.height];
    const set = q => { if (!A) return; report(CMD.run('artboard.set', Object.assign({id:A.id}, q))); rebuild(); };
    const sel = document.createElement('select'); sel.dataset.opt = 'preset'; sel.disabled = !A;
    sel.innerHTML = `<option value="">${Lang.t('ui.abCustom')}</option>` + PRESETS.map(q => `<option value="${q[0]}">${q[0]}（${q[1]}×${q[2]}）</option>`).join('');
    sel.value = a && a.preset ? a.preset : ''; sel.onchange = () => { if (sel.value) set({preset:sel.value}); };
    add('abPreset', sel);
    const numIn = (key, opt, v, fn) => { const n = mk('number', {value:v, step:1}); n.style.width = '62px'; n.dataset.opt = opt; n.disabled = !A; n.onchange = () => { const x = Math.round(+n.value); if (isFinite(x)) fn(x); }; add(key, n); return n; };
    numIn('abW', 'width', r[2], v => { if (v > 0) set({width:v}); });
    const sw = document.createElement('button'); sw.type = 'button'; sw.dataset.opt = 'orient'; sw.textContent = '⇄'; sw.title = Lang.t('ui.abOrient'); sw.disabled = !A;
    sw.onclick = () => set({width:r[3], height:r[2]}); box.appendChild(sw);
    numIn('abH', 'height', r[3], v => { if (v > 0) set({height:v}); });
    numIn('abX', 'x', r[0], v => set({x:v}));
    numIn('abY', 'y', r[1], v => set({y:v}));
    const bg = document.createElement('select'); bg.dataset.opt = 'background'; bg.disabled = !A;
    bg.innerHTML = [['white', 'ui.abWhite'], ['black', 'ui.abBlack'], ['transparent', 'ui.abTransparent'], ['custom', 'ui.abOther']].map(([v, k]) => `<option value="${v}">${Lang.t(k)}</option>`).join('');
    const cur = a ? a.background : 'white', custom = cur && !['white', 'black', 'transparent'].includes(cur);
    bg.value = custom ? 'custom' : (cur || 'white');
    const col = mk('color', {value:custom ? cur : '#ffffff'}); col.dataset.opt = 'bgColor'; col.disabled = !A; col.style.display = custom ? '' : 'none';
    bg.onchange = () => { if (bg.value === 'custom') set({background:'custom', color:col.value}); else set({background:bg.value}); };
    col.onchange = () => set({background:'custom', color:col.value});
    add('abBg', bg); box.appendChild(col);
    const btn = (txt, tip, opt, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.title = Lang.t(tip); b.dataset.opt = opt; b.style.margin = '0 2px'; b.onclick = fn; box.appendChild(b); return b; };
    btn('＋', 'ui.abAdd', 'add', () => { report(CMD.run('artboard.new', {})); rebuild(); });
    btn('⤢', 'ui.abFit', 'fit', () => CMD.run('artboard.fit', {})).disabled = !boards().length;
    // 对齐／分布（PS 画板工具选项栏同移动工具那组钮；1 块＝对齐画布，分布要 3 块）
    const nSel = selectedBoards({}).length;
    const sep = () => { const x = document.createElement('span'); x.style.cssText = 'display:inline-block;width:1px;height:18px;background:#555;margin:0 6px;vertical-align:middle'; box.appendChild(x); };
    sep();
    [['left', '⇤'], ['hcenter', '⇹'], ['right', '⇥'], ['top', '⤒'], ['vcenter', '⇳'], ['bottom', '⤓']].forEach(([k, t]) =>
      btn(t, 'ui.abAlign_' + k, 'align-' + k, () => { report(CMD.run('artboard.align', {align:k})); rebuild(); }).disabled = !nSel);
    sep();
    [['top', '≡↑'], ['vcenter', '≡↕'], ['bottom', '≡↓'], ['left', '⫴←'], ['hcenter', '⫴↔'], ['right', '⫴→'], ['hspace', '↔＝'], ['vspace', '↕＝']].forEach(([k, t]) =>
      btn(t, 'ui.abDist_' + k, 'dist-' + k, () => { report(CMD.run('artboard.distribute', {distribute:k})); rebuild(); }).disabled = nSel < 3);
    const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t('ui.abHint'); box.appendChild(h);
  }
});

})();
