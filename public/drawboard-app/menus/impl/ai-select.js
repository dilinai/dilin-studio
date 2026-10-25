/* 堤麟画板 · 顶菜单实作 · Illustrator ▸ 选择（命令名 ai.<原码 id>）
   照 ArtCraft VectorCraft 原码逐段翻译：
     vectorcraft/crates/engine/src/cmd/select.rs  1-333   select.all／allOnArtboard／none／reselect／inverse／nextAbove／nextBelow、
                                                          select.same.*（fillColor strokeColor strokeWeight fillAndStroke opacity blendingMode appearance shapeType appearanceAttribute）、
                                                          select.object.*（allOnSameLayers strayPoints openPaths textObjects）、selectable／select_where／same_layers／by_kind
     vectorcraft/crates/engine/src/cmd/docmenu.rs 1-301   select.same.font*／textFillColor／textStrokeColor（same_text）、select.object.directionHandles／pointText／areaText、
                                                          select.save／recall／editSaved／savedList（存起来的选取＝session 状态、按文件分）
     vectorcraft/crates/engine/src/cmd/wand.rs           paint 比较（similar_paint 的「非纯色要完全相等」）——Same 系列本身用的是完全相等（select.rs:28-58）
     vectorcraft/crates/doc/src/node.rs 105-113, 458-475 kind_label（「形状」比的是这个标签）
     vectorcraft/crates/ui-egui/src/menus.rs 1918        存储所选对象…（原码直接存、不弹框；AI 实际弹「名称」框，我们照 AI 弹，栏位就是原码参数 name）
   我们这边的对应：
     ■ 「物件」＝矢量层里的一个 shape；物件选取＝tools/_vecsel.js 的 VecSel（一次只管一层）。
       ⇒ 原码跨所有图层收的（全部／相同／对象），我们收「那一层」（当前矢量层；相同＝参考物件那层）。
     ■ 文字物件＝文字层（kind:'text'）。它进不了 VecSel ⇒ 文字物件的选取放 AiSel.text（层 id 清单），画布上叠画虚线框；
       相同 ▸ 字体…／所有文本对象／点状／区域文字 走这一份。
     ■ 选取不进历史（Session::select 不推 undo；跟 direct.select 一致）；undo 时选取随那一步的快照回去。
   🔴 改文件的事全走 CMD。这支档只登记命令＋两个对话框（存储所选对象…／编辑所选对象…）＋本菜单的快捷键。 */
(function(){
if (window.AiSel && window.AiSel.__loaded) return;          // index.html 与测试 add_script_tag 都挂时只跑一次

/* ═══════════ 小工具 ═══════════ */
const _cc = document.createElement('canvas').getContext('2d');
/* 颜料正规化：none／没写＝'none'；颜色字串 → 浏览器正规写法（#rrggbb 或 rgba(…)）；渐变物件 → JSON（Paint 的 == 是整个结构相等） */
function normPaint(p){
  if (p === undefined || p === null || p === '' || p === 'none' || p === 'transparent') return 'none';
  if (typeof p === 'object') return 'obj:' + JSON.stringify(p);
  _cc.fillStyle = '#010203'; _cc.fillStyle = String(p);
  const v = _cc.fillStyle;
  if (v === '#010203' && String(p).toLowerCase().replace(/\s/g, '') !== '#010203') return 'raw:' + String(p);
  return v.toLowerCase();
}
const fillOf = s => normPaint(s.fill);
const strokeOf = s => normPaint(s.stroke);
/* stroke_width：描边是 none 就当 0（画出来的粗细） */
const strokeW = s => strokeOf(s) === 'none' ? 0 : (+s.strokeWidth || 0);
const opOf = s => (typeof s.opacity === 'number') ? s.opacity : 1;
const blendOf = s => s.blend || 'normal';

/* node.rs:458-475 kind_label ＋ 105-113 LiveShape::label：活形状照它的标签，其余是 Path；参考线路径＝Guide */
function kindLabel(s){
  if (s.guide) return 'Guide';
  switch (s.type){
    case 'rect':    return (+s.radius || 0) > 0 ? 'Rounded Rectangle' : 'Rectangle';
    case 'ellipse': return 'Ellipse';
    case 'polygon': return 'Polygon';
    case 'line':    return 'Line';
    case 'mesh':    return 'Mesh';
    default:        return 'Path';      // star（原码星形不是活形状）、path、bezier
  }
}

/* 锚点数与开闭（PathData::anchor_count／is_closed）：活形状按 VecSel 的路径视图 */
function pathInfo(s){
  if (s.type === 'mesh') return null;
  const g = VecSel.asBezier(s);
  if (!g || !g.anchors) return null;
  return {anchors:g.anchors.length, closed:!!g.closed};
}

/* geometric_bounds（不含描边）：路径每段取 16 个样本点＋锚点（文件坐标） */
function shapeBounds(L, s){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; };
  if (s.type === 'mesh' && s.mesh && s.mesh.points) s.mesh.points.forEach(q => add(q.x, q.y));
  else {
    const g = VecSel.asBezier(s); if (!g || !g.anchors || !g.anchors.length) return null;
    g.anchors.forEach(a => add(a.x, a.y));
    for (const c of VecSel.segments(g)) for (let i = 1; i < 16; i++){ const q = VecSel.evalCubic(c, i / 16); add(q[0], q[1]); }
  }
  if (!isFinite(x0)) return null;
  return {x0:x0 + L.x, y0:y0 + L.y, x1:x1 + L.x, y1:y1 + L.y};
}

/* 选取能动到的矢量层：layerId → 当前层（矢量）→ 节点选取那层 */
function vecLayer(p){
  if (p && p.layerId){ const L = Doc.byId(p.layerId); return (L && L.kind === 'vector') ? L : null; }
  const A = Doc.active(); if (A && A.kind === 'vector') return A;
  const V = VecSel.layer(); if (V && V.kind === 'vector') return V;
  return null;
}
/* selectable（select.rs:100-112）：看得见、没锁的层里看得见、没锁的物件 */
const layerOpen = L => L && L.visible !== false && !L.locked;
const selectable = L => layerOpen(L) ? L.data.shapes.filter(s => s.visible !== false && !s.locked) : [];
/* 目前选中的物件（selection.objects，按选取顺序） */
function selected(){
  VecSel.prune();
  const L = VecSel.layer(); if (!L) return {L:null, ids:[]};
  return {L, ids:VecSel.shapes.slice()};
}
/* s.select(|_, sel| sel.set(ids))：整条选中、部分锚点清掉；文字物件选取一起换掉 */
function setSel(L, ids){
  AiSel.text = [];
  if (!L || !ids.length) VecSel.clear(); else VecSel.setShapes(L.id, ids);
}
const err = (cmd, m) => ({ok:false, error:`${cmd}: ${m}`});

/* ═══════════ 状态 ═══════════ */
const AiSel = window.AiSel = {
  __loaded: true,
  text: [],            // 选中的文字物件（文字层 id）
  last: null,          // last_selection_cmd：Reselect 重跑的那一条 {cmd, params}
  saved: [],           // 存起来的选取：[{doc:Doc.serial, name, layerId, ids, text}]（session 状态，跟原码一样不进文件）
  normPaint, kindLabel, shapeBounds, pathInfo,
  textLayers(){ return Doc.layers.filter(L => L.kind === 'text'); },
  /* 文字层的外框（文件坐标）：走 text.info 的排版，没有文字工具就估 */
  textBounds(L){
    try {
      if (CMD.map['text.info']){
        const i = CMD.map['text.info'].run({layerId:L.id});
        if (i && i.bounds) return {x0:i.bounds[0] + L.x, y0:i.bounds[1] + L.y, x1:i.bounds[2] + L.x, y1:i.bounds[3] + L.y};
      }
    } catch(e){}
    const d = L.data, n = String(d.text).split('\n').length;
    return {x0:d.x + L.x, y0:d.y + L.y - d.size, x1:d.x + L.x + d.size * String(d.text).length * 0.6, y1:d.y + L.y + d.size * 1.25 * (n - 1) + d.size * 0.25};
  },
  /* 文字物件选取的虚线框（画布叠画；ai-view 的全局叠画叫它，没载入 ai-view 就挂不上——只是看不到框，选取照样在） */
  drawOverlay(ctx, s){
    this.text = this.text.filter(id => { const L = Doc.byId(id); return L && L.kind === 'text'; });
    if (!this.text.length) return;
    ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = '#2f7fd8'; ctx.setLineDash([4, 3]);
    for (const id of this.text){
      const L = Doc.byId(id); if (!L.visible) continue;
      const b = this.textBounds(L);
      ctx.strokeRect(Math.round(b.x0 * s) + .5, Math.round(b.y0 * s) + .5, Math.round((b.x1 - b.x0) * s), Math.round((b.y1 - b.y0) * s));
    }
    ctx.restore();
  }
};

/* ═══════════ select.rs ═══════════ */
const PARAM_LAYER = 'layerId?（缺省＝当前矢量层；VecSel 一次只管一层，原码是跨所有图层）';

/* select.rs:114-119 all */
CMD.reg('ai.select.all', {i18n:'', params:`{${PARAM_LAYER}} 选择 ▸ 全部：选中这层所有看得见、没锁的物件 → {ok, count, layerId}`}, p => {
  const L = vecLayer(p); if (!L) return err('ai.select.all', 'no vector layer');
  const ids = selectable(L).map(s => s.id);
  setSel(L, ids);
  return {ok:true, count:ids.length, layerId:L.id};
});

/* select.rs:121-131 all_on_artboard：外框跟画板交集面积 > 0 或画板含外框中心；我们只有一个画板＝整张文件 */
CMD.reg('ai.select.allOnArtboard', {i18n:'', params:`{artboard?=0（我们只有 0 号画板＝整张文件）, ${PARAM_LAYER}} 选择 ▸ 现用画板上的全部对象：外框跟画板有交集（或中心落在画板里）的物件 → {ok, count}`}, p => {
  const i = p.artboard === undefined ? 0 : +p.artboard;
  if (i !== 0) return err('ai.select.allOnArtboard', 'no such artboard');
  const L = vecLayer(p); if (!L) return err('ai.select.allOnArtboard', 'no vector layer');
  const r = {x0:0, y0:0, x1:Doc.width, y1:Doc.height};
  const ids = selectable(L).filter(s => {
    const b = shapeBounds(L, s); if (!b) return false;
    const ix = Math.min(b.x1, r.x1) - Math.max(b.x0, r.x0), iy = Math.min(b.y1, r.y1) - Math.max(b.y0, r.y0);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    return (ix > 0 && iy > 0) || (cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1);
  }).map(s => s.id);
  setSel(L, ids);
  return {ok:true, count:ids.length, layerId:L.id};
});

/* select.rs:133-136 none（也清文字物件选取） */
CMD.reg('ai.select.none', {i18n:'', params:'{} 选择 ▸ 取消选择：清掉物件／锚点选取与文字物件选取'}, () => { VecSel.clear(); AiSel.text = []; return {ok:true}; });

/* select.rs:138-141 reselect：重跑上一条「相同」类选取命令（没有就什么都不做） */
CMD.reg('ai.select.reselect', {i18n:'', params:'{} 选择 ▸ 重新选择：重跑上一次的「相同 ▸ …」（同样的参数）；还没跑过就什么都不做 → 那条命令的结果'}, () => {
  if (!AiSel.last) return {ok:true, count:0};
  return CMD.run(AiSel.last.cmd, AiSel.last.params);
});

/* select.rs:143-148 inverse */
CMD.reg('ai.select.inverse', {i18n:'', params:`{${PARAM_LAYER}} 选择 ▸ 反向：这层看得见、没锁、目前没选中的物件 → {ok, count}`}, p => {
  const L = vecLayer(p); if (!L) return err('ai.select.inverse', 'no vector layer');
  const cur = VecSel.layerId === L.id ? VecSel.shapes : [];
  const ids = selectable(L).filter(s => !cur.includes(s.id)).map(s => s.id);
  setSel(L, ids);
  return {ok:true, count:ids.length, layerId:L.id};
});

/* select.rs:150-161 step：第一个选中物件在同层的上一个／下一个（越界什么都不做） */
function step(cmd, dir){
  const {L, ids} = selected();
  if (!ids.length) return err(cmd, 'nothing selected');
  const S = L.data.shapes, idx = S.findIndex(s => s.id === ids[0]), j = idx + dir;
  if (idx < 0 || j < 0 || j >= S.length) return {ok:true, changed:false};
  setSel(L, [S[j].id]);
  return {ok:true, changed:true, id:S[j].id};
}
CMD.reg('ai.select.nextAbove', {i18n:'', params:'{} 选择 ▸ 上方的下一个对象：改选第一个选中物件上面那一个（同一层，已是最上面就不动）→ {ok, changed, id?}'}, () => step('ai.select.nextAbove', +1));
CMD.reg('ai.select.nextBelow', {i18n:'', params:'{} 选择 ▸ 下方的下一个对象：改选第一个选中物件下面那一个 → {ok, changed, id?}'}, () => step('ai.select.nextBelow', -1));

/* select.rs:242-267 same／select_where（docmenu.rs:189-201 finish_same 同）：参考＝第一个选中物件；候选＝参考那层看得见、没锁的物件；记下给 Reselect */
function same(cmd, eq, p){
  const {L, ids} = selected();
  const ref = L && L.data.shapes.find(s => s.id === ids[0]);
  if (!ref) return err(cmd, 'nothing selected');
  const hits = selectable(L).filter(n => n.type !== 'group' && eq(n, ref)).map(n => n.id);
  setSel(L, hits);
  AiSel.last = {cmd, params:Object.assign({}, p || {})};
  return {ok:true, count:hits.length, ids:hits.slice(), layerId:L.id};
}
const SAME = {
  fillColor:     ['填充颜色：填色完全相同（select.rs:25-29）',            (a, b) => fillOf(a) === fillOf(b)],
  strokeColor:   ['描边颜色：描边色完全相同',                              (a, b) => strokeOf(a) === strokeOf(b)],
  strokeWeight:  ['描边粗细：粗细相差 < 1e-9（描边是 none 当 0）',          (a, b) => Math.abs(strokeW(a) - strokeW(b)) < 1e-9],
  fillAndStroke: ['填色和描边：填色与描边色都相同',                        (a, b) => fillOf(a) === fillOf(b) && strokeOf(a) === strokeOf(b)],
  opacity:       ['不透明度：物件 opacity 相差 < 1e-6（没写＝1）',          (a, b) => Math.abs(opOf(a) - opOf(b)) < 1e-6],
  blendingMode:  ['混合模式：物件 blend 相同（没写＝normal）',             (a, b) => blendOf(a) === blendOf(b)],
  appearance:    ['外观：填色、描边色、描边粗细、不透明度、混合模式全相同',  (a, b) => fillOf(a) === fillOf(b) && strokeOf(a) === strokeOf(b) && strokeW(a) === strokeW(b) && opOf(a) === opOf(b) && blendOf(a) === blendOf(b)],
  shapeType:     ['形状：kind_label 相同（矩形／圆角矩形／椭圆／多边形／直线／路径／网格／参考线）', (a, b) => kindLabel(a) === kindLabel(b)]
};
Object.entries(SAME).forEach(([k, [desc, eq]]) => {
  const cmd = 'ai.select.same.' + k;
  CMD.reg(cmd, {i18n:'', params:`{} 选择 ▸ 相同 ▸ ${desc}；参考＝第一个选中物件，候选＝它那一层看得见、没锁的物件 → {ok, count, ids}`}, p => same(cmd, eq, p));
});

/* select.rs:282-305 same_attribute：外观项目＝[0 填色, 1 描边]（由下往上，跟 appearance.items 同序）；item 缺省＝最上面的填色 */
const items = s => [{k:'fill', paint:fillOf(s)}, {k:'stroke', paint:strokeOf(s), w:strokeW(s)}];
const sameItem = (x, y) => x.k === y.k && x.paint === y.paint && (x.k !== 'stroke' || x.w === y.w);
CMD.reg('ai.select.same.appearanceAttribute', {i18n:'',
  params:'{item?: 外观项目索引（0＝填色、1＝描边；缺省＝最上面的填色）} 选择 ▸ 相同 ▸ 外观属性：选中带有同一个外观项目（同颜料；描边还要同粗细）的物件 → {ok, count, ids}'}, p => {
  const cmd = 'ai.select.same.appearanceAttribute';
  const {L, ids} = selected();
  const ref = L && L.data.shapes.find(s => s.id === ids[0]);
  if (!ref) return err(cmd, 'nothing selected');
  const its = items(ref);
  const it = (p.item !== undefined && its[+p.item]) ? its[+p.item] : its[0];
  return same(cmd, n => items(n).some(x => sameItem(x, it)), p);
});

/* select.rs:307-319 same_layers：选中物件所在层的全部看得见、没锁的物件 */
CMD.reg('ai.select.object.allOnSameLayers', {i18n:'', params:'{} 选择 ▸ 对象 ▸ 同一图层上的所有对象：选中物件那一层所有看得见、没锁的物件 → {ok, count}'}, () => {
  const {L, ids} = selected();
  if (!ids.length) return err('ai.select.object.allOnSameLayers', 'nothing selected');
  const hits = selectable(L).map(s => s.id);
  setSel(L, hits);
  return {ok:true, count:hits.length, layerId:L.id};
});

/* select.rs:321-333 by_kind（docmenu.rs:230-235 同）：所有看得见、没锁的层里收符合的物件。
   VecSel 一次只管一层 ⇒ 收到的物件若分在几层：当前层有就选当前层的，否则选第一个有命中的层；全部命中数也回报 */
function byKind(cmd, f){
  const per = [];
  for (const L of Doc.layers){
    if (L.kind !== 'vector' || !layerOpen(L)) continue;
    const hit = selectable(L).filter(f).map(s => s.id);
    if (hit.length) per.push({L, ids:hit});
  }
  const total = per.reduce((n, x) => n + x.ids.length, 0);
  const A = Doc.active();
  const pick = per.find(x => A && x.L.id === A.id) || per[0];
  setSel(pick ? pick.L : null, pick ? pick.ids : []);
  return {ok:true, count:pick ? pick.ids.length : 0, total, layerId:pick ? pick.L.id : null, layers:per.map(x => ({layerId:x.L.id, count:x.ids.length}))};
}
CMD.reg('ai.select.object.strayPoints', {i18n:'', params:'{} 选择 ▸ 对象 ▸ 游离点：只有一个锚点的路径 → {ok, count, total, layerId, layers}'},
  () => byKind('ai.select.object.strayPoints', s => { const i = pathInfo(s); return !!i && i.anchors === 1; }));
CMD.reg('ai.select.object.openPaths', {i18n:'', params:'{} 选择 ▸ 对象 ▸ 开放路径：没闭合的路径（直线、折线、开放的钢笔路径）→ {ok, count, total, layerId, layers}'},
  () => byKind('ai.select.object.openPaths', s => { const i = pathInfo(s); return !!i && !i.closed; }));

/* docmenu.rs:237-259 direction_handles：选中路径的每个锚点都选上（把手全露出来） */
CMD.reg('ai.select.object.directionHandles', {i18n:'', params:'{} 选择 ▸ 对象 ▸ 方向手柄：选中路径的所有锚点都直接选取（把手全部显示）→ {ok, anchors}'}, () => {
  const {L, ids} = selected();
  if (!ids.length) return err('ai.select.object.directionHandles', 'nothing selected');
  const items = [];
  for (const id of ids){
    const s = L.data.shapes.find(x => x.id === id), g = s && VecSel.asBezier(s);
    if (g && g.anchors) items.push([id, g.anchors.map((_, i) => i)]);
  }
  VecSel.clear(); AiSel.text = [];
  let total = 0;
  for (const [id, idx] of items){ VecSel.setAnchors(L.id, id, idx); total += idx.length; }
  return {ok:true, anchors:total};
});

/* ── 文字物件（文字层）── by_kind 的 Text 那几支（select.rs:68-71、docmenu.rs:63-73） */
function textKind(cmd, f){
  const ids = AiSel.textLayers().filter(L => layerOpen(L) && f(L)).map(L => L.id);
  VecSel.clear(); AiSel.text = ids;
  return {ok:true, count:ids.length, ids:ids.slice()};
}
CMD.reg('ai.select.object.textObjects', {i18n:'', params:'{} 选择 ▸ 对象 ▸ 所有文本对象：所有看得见、没锁的文字层（选取放 AiSel.text，画布上画虚线框）→ {ok, count, ids}'},
  () => textKind('ai.select.object.textObjects', () => true));
CMD.reg('ai.select.object.pointText', {i18n:'', params:'{} 选择 ▸ 对象 ▸ 点状文字对象：没有文字框的文字层 → {ok, count, ids}'},
  () => textKind('ai.select.object.pointText', L => !L.data.box));
CMD.reg('ai.select.object.areaText', {i18n:'', params:'{} 选择 ▸ 对象 ▸ 区域文字对象：有文字框（段落文字）的文字层 → {ok, count, ids}'},
  () => textKind('ai.select.object.areaText', L => !!L.data.box));

/* docmenu.rs:203-228 first_text_style／same_text：参考＝选取里第一个文字物件（没有就当前层若是文字层）；候选＝看得见、没锁的文字层 */
const W = {normal:'400', bold:'700', lighter:'300', bolder:'800'};
const styleOf = d => ({family:String(d.font || 'sans-serif'), style:W[d.weight] || String(d.weight || '400'), size:+d.size || 0,
  fill:normPaint(d.color), stroke:normPaint(d.stroke)});
function sameText(cmd, eq, p){
  AiSel.text = AiSel.text.filter(id => { const L = Doc.byId(id); return L && L.kind === 'text'; });
  let R = AiSel.text.length ? Doc.byId(AiSel.text[0]) : null;
  if (!R){ const A = Doc.active(); if (A && A.kind === 'text') R = A; }
  if (!R) return err(cmd, 'select a text object');
  const r = styleOf(R.data);
  const ids = AiSel.textLayers().filter(L => layerOpen(L) && eq(styleOf(L.data), r)).map(L => L.id);
  VecSel.clear(); AiSel.text = ids;
  AiSel.last = {cmd, params:Object.assign({}, p || {})};
  return {ok:true, count:ids.length, ids:ids.slice()};
}
const SAME_TEXT = {
  fontFamily:          ['字体系列：字型家族相同',                     (a, b) => a.family === b.family],
  fontFamilyStyle:     ['字体系列和样式：家族与字重相同',             (a, b) => a.family === b.family && a.style === b.style],
  fontFamilyStyleSize: ['字体系列、样式和大小：家族、字重、字号都相同', (a, b) => a.family === b.family && a.style === b.style && Math.abs(a.size - b.size) < 1e-6],
  fontSize:            ['字体大小：字号相同',                         (a, b) => Math.abs(a.size - b.size) < 1e-6],
  textFillColor:       ['文本填充颜色：文字颜色相同',                 (a, b) => a.fill === b.fill],
  textStrokeColor:     ['文本描边颜色：文字描边相同（我们的文字没有描边 ⇒ 全部相同）', (a, b) => a.stroke === b.stroke]
};
Object.entries(SAME_TEXT).forEach(([k, [desc, eq]]) => {
  const cmd = 'ai.select.same.' + k;
  CMD.reg(cmd, {i18n:'', params:`{} 选择 ▸ 相同 ▸ ${desc}；参考＝选取里第一个文字物件（没有就当前文字层），候选＝看得见、没锁的文字层 → {ok, count, ids}`}, p => sameText(cmd, eq, p));
});

/* ═══════════ 存起来的选取（docmenu.rs:261-301）：session 状态，按文件（Doc.serial）分 ═══════════ */
const DEFAULT_SEL_NAME = {'zh-Hant':'選取範圍', 'zh-Hans':'选区', en:'Selection'};
const mine = () => AiSel.saved.filter(x => x.doc === Doc.serial);
function defaultSelName(){
  const base = DEFAULT_SEL_NAME[Lang.cur] || 'Selection';
  let i = 1; while (mine().some(x => x.name === `${base} ${i}`)) i++;
  return `${base} ${i}`;
}
CMD.reg('ai.select.save', {i18n:'',
  params:'{name?（缺省＝「选区 N」）, dialog?:bool（true＝开「存储所选对象」对话框，确定后再跑这条）} 选择 ▸ 存储所选对象…：把目前的选取（物件＋文字物件）记下来（这次开着的程序里有效，跟原码一样不存进文件；同名覆盖）→ {ok, name}'}, p => {
  if (p.dialog) { Dlg.save(); return {ok:true, dialog:true}; }
  const {L, ids} = selected();
  if (!ids.length && !AiSel.text.length) return err('ai.select.save', 'nothing selected');
  const name = (typeof p.name === 'string' && p.name.trim()) ? p.name.trim() : defaultSelName();
  AiSel.saved = AiSel.saved.filter(x => !(x.doc === Doc.serial && x.name === name));
  AiSel.saved.push({doc:Doc.serial, name, layerId:L ? L.id : null, ids, text:AiSel.text.slice()});
  return {ok:true, name};
});
CMD.reg('ai.select.recall', {i18n:'', params:'{name} 载回存起来的选取（已删掉的物件略过；选择菜单底下列的那几项就是这条）→ {ok, count}'}, p => {
  const x = mine().find(v => v.name === p.name);
  if (!x) return err('ai.select.recall', `no saved selection \`${p.name}\``);
  const L = x.layerId ? Doc.byId(x.layerId) : null;
  const ids = (L && L.kind === 'vector') ? x.ids.filter(id => L.data.shapes.some(s => s.id === id)) : [];
  setSel(L, ids);
  AiSel.text = x.text.filter(id => { const T = Doc.byId(id); return T && T.kind === 'text'; });
  return {ok:true, count:ids.length + AiSel.text.length};
});
CMD.reg('ai.select.editSaved', {i18n:'', params:'{name, newName?: 改名, delete?: bool} 改名或删掉一个存起来的选取'}, p => {
  const x = mine().find(v => v.name === p.name);
  if (!x) return err('ai.select.editSaved', p.name === undefined ? 'missing name' : `no saved selection \`${p.name}\``);
  if (p.delete === true) AiSel.saved = AiSel.saved.filter(v => v !== x);
  else if (typeof p.newName === 'string' && p.newName.trim()){
    const nn = p.newName.trim();
    if (nn !== x.name && mine().some(v => v.name === nn)) return err('ai.select.editSaved', `a saved selection named \`${nn}\` exists`);
    x.name = nn;
  }
  return {ok:true};
});
CMD.reg('ai.select.savedList', {i18n:'', params:'{} 这份文件存起来的选取名 → {ok, names}'}, () => ({ok:true, names:mine().map(x => x.name)}));
/* 菜单「编辑所选对象…」（原码 select.editSelection 是 todo；照 select.editSaved 做对话框） */
CMD.reg('ai.select.editSelection', {i18n:'', params:'{} 选择 ▸ 编辑所选对象…：开对话框（列出存起来的选取，可改名、删除；确定＝ai.select.editSaved）；agent 请直接用 ai.select.editSaved'}, () => {
  if (!mine().length) return err('ai.select.editSelection', 'no saved selections (Select ▸ Save Selection…)');
  Dlg.edit(); return {ok:true, dialog:true};
});

/* ═══════════ 对话框（样式写在这里注入） ═══════════ */
const STR = {
  'zh-Hant':{'aisel.saveTitle':'儲存選取範圍', 'aisel.editTitle':'編輯選取範圍', 'aisel.name':'名稱：', 'aisel.newName':'新名稱：', 'aisel.delete':'刪除', 'aisel.ok':'確定', 'aisel.cancel':'取消'},
  'zh-Hans':{'aisel.saveTitle':'存储所选对象', 'aisel.editTitle':'编辑所选对象', 'aisel.name':'名称：', 'aisel.newName':'新名称：', 'aisel.delete':'删除', 'aisel.ok':'确定', 'aisel.cancel':'取消'},
  'en':{'aisel.saveTitle':'Save Selection', 'aisel.editTitle':'Edit Selection', 'aisel.name':'Name:', 'aisel.newName':'New name:', 'aisel.delete':'Delete', 'aisel.ok':'OK', 'aisel.cancel':'Cancel'}
};
if (typeof Lang !== 'undefined') Lang.add(STR);
if (!document.getElementById('aiDlgStyle')){
  const st = document.createElement('style'); st.id = 'aiDlgStyle';
  st.textContent = `.aidlg-back{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}
.aidlg{background:#2b2f36;color:#e6e8ec;border:1px solid #444a55;border-radius:6px;padding:14px 16px;min-width:280px;font:13px sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4)}
.aidlg .t{font-weight:600;margin-bottom:10px}
.aidlg label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0}
.aidlg input[type=text],.aidlg select{width:170px;background:#1d2026;color:#e6e8ec;border:1px solid #444a55;border-radius:3px;padding:3px 6px}
.aidlg .bar{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}`;
  document.head.appendChild(st);
}
/* 通用小对话框：rows＝[{k, label, type:'text'|'select'|'check', value, options}]；ok(values) 回 false 就不关 */
function dialog(id, title, rows, ok){
  const old = document.getElementById(id); if (old) old.remove();
  const back = document.createElement('div'); back.className = 'aidlg-back'; back.id = id;
  const box = document.createElement('div'); box.className = 'aidlg';
  box.innerHTML = `<div class="t">${Lang.t(title)}</div>`;
  const F = {};
  rows.forEach(r => {
    const l = document.createElement('label'); const sp = document.createElement('span'); sp.textContent = Lang.t(r.label); l.appendChild(sp);
    let el;
    if (r.type === 'select'){ el = document.createElement('select'); r.options.forEach(o => { const op = document.createElement('option'); op.value = o; op.textContent = o; el.appendChild(op); }); el.value = r.value; }
    else { el = document.createElement('input'); el.type = r.type === 'check' ? 'checkbox' : 'text'; if (r.type === 'check') el.checked = !!r.value; else el.value = r.value || ''; }
    el.dataset.k = r.k; l.appendChild(el); box.appendChild(l); F[r.k] = el;
  });
  const bar = document.createElement('div'); bar.className = 'bar';
  const close = () => { back.remove(); if (window.UI) UI.draw(); };
  const done = () => { const v = {}; for (const k in F) v[k] = F[k].type === 'checkbox' ? F[k].checked : F[k].value; if (ok(v) !== false) close(); };
  const b1 = document.createElement('button'); b1.textContent = Lang.t('aisel.cancel'); b1.dataset.act = 'cancel'; b1.onclick = close;
  const b2 = document.createElement('button'); b2.textContent = Lang.t('aisel.ok'); b2.dataset.act = 'ok'; b2.onclick = done;
  bar.appendChild(b1); bar.appendChild(b2); box.appendChild(bar);
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); done(); }
    else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); }
  });
  back.addEventListener('pointerdown', e => e.stopPropagation());
  back.appendChild(box); document.body.appendChild(back);
  const first = box.querySelector('input,select'); if (first){ first.focus(); if (first.select) first.select(); }
  return back;
}
const Dlg = AiSel.dialogs = {
  save(){ dialog('aiSelSaveDlg', 'aisel.saveTitle', [{k:'name', label:'aisel.name', type:'text', value:defaultSelName()}],
    v => { try { CMD.run('ai.select.save', {name:v.name}); } catch(e){ console.error(e); } }); },
  edit(){
    const names = mine().map(x => x.name);
    dialog('aiSelEditDlg', 'aisel.editTitle', [{k:'name', label:'aisel.name', type:'select', options:names, value:names[0]},
      {k:'newName', label:'aisel.newName', type:'text', value:''}, {k:'delete', label:'aisel.delete', type:'check', value:false}],
      v => { try { CMD.run('ai.select.editSaved', {name:v.name, newName:v.newName, delete:v.delete}); } catch(e){ console.error(e); } });
  }
};

/* ═══════════ 本菜单的快捷键（AI 模式＝当前层是矢量层时；照菜单树上写的 key） ═══════════ */
const CODE = c => /^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5)
  : ({BracketLeft:'[', BracketRight:']', Semicolon:';', Quote:"'", Equal:'=', Minus:'-', Comma:',', Period:'.', Slash:'/', Backslash:'\\'})[c] || null;
function comboOf(e){
  const k = CODE(e.code) || (e.key && e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return [(e.ctrlKey || e.metaKey) ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', k].filter(Boolean).join('+');
}
const normKey = k => { const p = k.split('+'), key = p.pop(); return ['Ctrl', 'Alt', 'Shift'].filter(m => p.includes(m)).concat([key.length === 1 ? key.toUpperCase() : key]).join('+'); };
AiSel.keyFor = (menuKey, e) => {
  if (!window.Menubar || Menubar.app !== 'ai' || !MenuTrees.ai || !MenuTrees.ai[menuKey]) return null;
  if (/input|select|textarea/i.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable)) return null;
  if (document.querySelector('.aidlg-back')) return null;
  const c = comboOf(e); let hit = null;
  const go = items => items.forEach(it => { if (hit || it.sep) return; if (it.key && normKey(it.key) === c && Menubar.enabled(it)) hit = it; if (it.sub) go(it.sub); });
  go(MenuTrees.ai[menuKey].items);
  return hit;
};
window.addEventListener('keydown', e => {
  const it = AiSel.keyFor('select', e); if (!it) return;
  e.preventDefault(); e.stopImmediatePropagation();
  Menubar.run(it);
}, true);

})();

/* ═════════════════════════════════════════════════════════════════════════════
   选择菜单其余原码有实作的项
     vectorcraft engine/src/cmd/select.rs:64-67     select.object.clippingMasks（by_kind：NodeKind::Path { clipping: true }）
     vectorcraft engine/src/cmd/select.rs:78-86, 269-280  select.same.graphicStyle（same_graphic_style：第一个选中物件链接的图形样式，样式外观要同步 linked_style）
     vectorcraft engine/src/cmd/style.rs:177-179    linked_style ＝ graphic_style 存在且 in_sync（外观跟样式一样）
     vectorcraft engine/src/cmd/docmenu.rs:16-23    select.same.symbolInstance（同一个符号的实例）
     vectorcraft engine/src/cmd/docmenu.rs:74-86    select.object.brushStrokes（描边带画笔）／bristleBrushStrokes（画笔名含 bristle）
     vectorcraft engine/src/cmd/select.rs:242-267, 321-333  same／select_where／by_kind：走进编组里面（命中的不再往下）
   我们的资料栏位（对到原码 Node 的栏位）：s.graphicStyle＝图形样式 id（样式表 Doc.aiR3.graphicStyles=[{id,name,fill,stroke,strokeWidth}]）、
     s.type==='symbol' 且 s.symbol＝符号名、s.brush＝描边用的画笔名、s.clipping＝剪切路径。
   🔴 老实说：目前画板里还没有建立图形样式／符号／画笔描边的界面（窗口菜单的那几个面板没做），所以这三类实务上选到 0 个；
      剪切蒙版可以（对象 ▸ 剪切蒙版 ▸ 建立 产生的剪切路径都带 clipping）。命中的若在编组里面，走 AiR3 深层选取。 */
(function(){
'use strict';
if (window.__aiR3_selMisc) return; window.__aiR3_selMisc = true;
const R3 = window.AiR3;
const err = (cmd, m) => ({ok:false, error:`${cmd}: ${m}`});
const layerOpen = L => L && L.visible !== false && !L.locked;
const isCont = s => !!s && (s.type === 'group' || s.type === 'compound') && Array.isArray(s.children);
/* 目前选中的第一个物件（深层也算） */
function firstSelected(){
  VecSel.prune();
  const L = VecSel.layer(); if (!L || !VecSel.shapes.length) return {L:null, ref:null};
  const h = R3.findDeep(VecSel.shapes[0], L);
  return {L, ref:h ? h.s : null};
}
/* select_where（select.rs:250-267）：一层里看得见、没锁的物件，f 命中就收（不再往下），否则走进它的成员 */
function selectWhere(L, f){
  const ids = [];
  const visit = s => { if (s.visible !== false && !s.locked && f(s)) { ids.push(s.id); return; } if (isCont(s)) s.children.forEach(visit); };
  L.data.shapes.forEach(visit);
  return ids;
}
function finishSame(cmd, L, ids, p){
  R3.selectDeep(L, ids);
  AiSel.last = {cmd, params:Object.assign({}, p || {})};
  return {ok:true, count:ids.length, ids:ids.slice(), layerId:L.id};
}
/* by_kind（select.rs:321-333）：所有看得见、没锁的层，整棵树走（l.walk）。VecSel 一次只管一层：当前层有就选当前层的，否则第一个有命中的层 */
function byKind(cmd, f){
  const per = [];
  for (const L of Doc.layers){
    if (L.kind !== 'vector' || !layerOpen(L)) continue;
    const hit = []; R3.walk(L.data.shapes, s => { if (f(s)) hit.push(s.id); });
    if (hit.length) per.push({L, ids:hit});
  }
  const total = per.reduce((n, x) => n + x.ids.length, 0);
  const A = Doc.active();
  const pick = per.find(x => A && x.L.id === A.id) || per[0];
  if (pick) R3.selectDeep(pick.L, pick.ids); else { VecSel.clear(); AiSel.text = []; }
  return {ok:true, count:pick ? pick.ids.length : 0, total, layerId:pick ? pick.L.id : null, layers:per.map(x => ({layerId:x.L.id, count:x.ids.length}))};
}

/* ── 图形样式（select.rs:269-280、style.rs:177-179） ── */
const styles = () => (Doc.aiR3 && Array.isArray(Doc.aiR3.graphicStyles)) ? Doc.aiR3.graphicStyles : [];
const N = AiSel.normPaint;
const inSync = (s, g) => N(s.fill) === N(g.fill) && N(s.stroke) === N(g.stroke) && Math.abs((+s.strokeWidth || 0) - (+g.strokeWidth || 0)) < 1e-9;
const linkedStyle = s => { if (!s || s.graphicStyle === undefined || s.graphicStyle === null) return null; const g = styles().find(x => x.id === s.graphicStyle); return g && inSync(s, g) ? g : null; };
CMD.reg('ai.select.same.graphicStyle', {i18n:'', params:'{} 选择 ▸ 相同 ▸ 图形样式：第一个选中物件链接的图形样式（s.graphicStyle，且外观跟样式同步），选中同一层里链接到同一个样式的物件；没链接样式＝失败 → {ok, count, ids}'}, p => {
  const cmd = 'ai.select.same.graphicStyle';
  const {L, ref} = firstSelected();
  const g = linkedStyle(ref);
  if (!g) return err(cmd, 'the selection has no graphic style');
  return finishSame(cmd, L, selectWhere(L, n => n.graphicStyle === g.id && !!linkedStyle(n)), p);
});
/* ── 符号实例（docmenu.rs:16-23：same，容器不算） ── */
CMD.reg('ai.select.same.symbolInstance', {i18n:'', params:'{} 选择 ▸ 相同 ▸ 符号实例：第一个选中物件是符号实例（type:"symbol"）时，选中同一层里同一个符号（s.symbol）的实例；不是符号＝选到 0 个 → {ok, count, ids}'}, p => {
  const cmd = 'ai.select.same.symbolInstance';
  const {L, ref} = firstSelected();
  if (!ref) return err(cmd, 'nothing selected');
  const eq = (a, b) => a.type === 'symbol' && b.type === 'symbol' && a.symbol === b.symbol;
  return finishSame(cmd, L, selectWhere(L, n => !isCont(n) && eq(n, ref)), p);
});
/* ── 画笔描边（docmenu.rs:74-86） ── */
const brushOf = s => (typeof s.brush === 'string' && s.brush) ? s.brush : (s.brush && typeof s.brush === 'object' && s.brush.name) ? String(s.brush.name) : null;
CMD.reg('ai.select.object.brushStrokes', {i18n:'', params:'{} 选择 ▸ 对象 ▸ 画笔描边：描边带画笔（s.brush）的物件 → {ok, count, total, layerId, layers}'},
  () => byKind('ai.select.object.brushStrokes', s => !!brushOf(s)));
CMD.reg('ai.select.object.bristleBrushStrokes', {i18n:'', params:'{} 选择 ▸ 对象 ▸ 毛刷画笔描边：画笔名含「bristle」（不分大小写）的物件 → {ok, count, total, layerId, layers}'},
  () => byKind('ai.select.object.bristleBrushStrokes', s => { const b = brushOf(s); return !!b && b.toLowerCase().includes('bristle'); }));
/* ── 剪切蒙版（select.rs:64-67） ── */
CMD.reg('ai.select.object.clippingMasks', {i18n:'', params:'{} 选择 ▸ 对象 ▸ 剪切蒙版：所有剪切路径（剪切组的 children[0]，clipping:true），在编组里面＝深层选取 → {ok, count, total, layerId, layers}'},
  () => byKind('ai.select.object.clippingMasks', s => s.clipping === true));
})();

/* 选择 ▸ 对象 ▸ 切片：照 vectorcraft engine/src/cmd/slices.rs:131, 619-624 select_all（所有用户切片＋对象切片放进切片选取；物件选取清掉） */
(function(){
'use strict';
if (window.__aiR3_selSlices) return; window.__aiR3_selSlices = true;
CMD.reg('ai.select.object.slices', {i18n:'', params:'{} 选择 ▸ 对象 ▸ 切片：选中所有用户切片与对象切片（切片选取；物件选取清掉）→ {ok, count, ids}'}, () => {
  const R3 = window.AiR3; if (!R3 || !R3.sliceIds) return {ok:false, error:'ai.select.object.slices: slices not loaded'};
  const ids = R3.sliceIds(); R3.setSliceSel(ids);
  return {ok:true, count:ids.length, ids};
});
})();
