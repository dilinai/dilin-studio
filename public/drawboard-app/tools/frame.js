/* 图框工具（K，PS 版面 ps.frame）——原码没有·照 PS 2020 写
   ArtCraft／PhotoCraft 没有图框工具，只有「图层 ▸ 新建 ▸ 来自图层的画框」（engine/src/frame_cmds.rs 14-55：选中的层编组，
   组上挂一张只露框内的蒙版——clip_mask）。我们的画框沿用同一个做法（＝menus/impl/ps-layer2.js 的 ps.layer.new.frameFromLayers），
   再照 Photoshop 2020 的图框工具补齐：
     · 选项栏：矩形图框／椭圆图框（PS 2020 图框工具选项栏只有这两颗）；另放「置入图像…」「清除内容」（PS 在「属性」面板）
     · 拖曳＝画一个图框（Shift 正方／正圆、Alt 从中心）：
         当前层是有像素的像素层／智能对象（不是背景）、而且框跟它的内容有交集 ⇒ 那一层直接放进图框（PS「在图像上画图框＝把图像框起来」）；
         否则 ⇒ 空的图框（画面上看不到东西，图框工具开着时画出灰框与对角叉当占位）
     · 点一下图框＝选中它
     · 把图片档拖到图框上（不管现在是哪颗工具）＝放进图框、等比填满、置中；框里原来的图被换掉（PS「拖图进框／换图」）
     · 改图框（frame.set：框、形状）、把一层转换成图框（frame.convert＝PS 图层 ▸ 新建 ▸ 转换为图框）
   资料：画框＝kind:'group' 的组，G.data.frame = {shape:'rect'|'ellipse', rect:[x,y,w,h]（文件坐标）}，G.mask＝文件大小的蒙版画布（框内白、框外透明）；
         内容＝组里的子层（通常 0 或 1 层）。合成、存档、历史都走现有的组＋蒙版那一套（engine.js Groups.drawPlain）。
   跟 PS 2020 的差别：PS 的图框是一种专门的图层（缩图分「框／内容」两格、内容是智能对象、属性面板可加描边）；我们是「组＋蒙版」，
         内容是一般像素层。
   另补（照 PS 2020）：图框描边（frame.stroke：粗细／颜色／位置 内部·居中·外部；包 Groups.draw 画在组上面、不吃组蒙版；SVG 也补描边形状）；
         只移动内容（frame.moveContent：在有内容的图框里拖＝内容动、框不动；Alt＋拖＝照样画新图框）。 */
(function(){
'use strict';

const L3 = (hant, hans, en) => Lang.cur === 'en' ? en : Lang.cur === 'zh-Hans' ? hans : hant;
const fail = error => ({ok:false, error});
const rround = v => Math.sign(v) * Math.round(Math.abs(v));
const nv = v => (v === null || v === undefined || v === '' || typeof v === 'boolean') ? NaN : +v;

const isFrame = L => !!L && L.kind === 'group' && L.data && L.data.frame && Array.isArray(L.data.frame.rect);
const frames = () => Doc.layers.filter(isFrame);
/* 一层所在的画框（自己是画框、或父是画框） */
const frameOf = L => !L ? null : isFrame(L) ? L : (Groups.parentOf(L) && isFrame(Groups.parentOf(L)) ? Groups.parentOf(L) : null);
const frameFromP = p => frameOf((p && (p.id || p.layer)) ? Doc.byId(p.id || p.layer) : Doc.active());
function shapeHas(fr, pt){
  const [x, y, w, h] = fr.rect;
  if (fr.shape === 'ellipse'){ const rx = w / 2, ry = h / 2; if (rx <= 0 || ry <= 0) return false; const dx = (pt[0] - x - rx) / rx, dy = (pt[1] - y - ry) / ry; return dx * dx + dy * dy <= 1; }
  return pt[0] >= x && pt[0] <= x + w && pt[1] >= y && pt[1] <= y + h;
}
/* 点到的画框（上面的先算） */
function frameAt(pt){ const fs = frames(); for (let i = fs.length - 1; i >= 0; i--) if (fs[i].visible !== false && shapeHas(fs[i].data.frame, pt)) return fs[i]; return null; }
const contentOf = G => Groups.children(G);

/* frame_cmds.rs:23 clip_mask：框内露、框外藏（椭圆图框＝椭圆） */
function buildMask(G){
  const fr = G.data.frame, c = document.createElement('canvas'); c.width = Doc.width; c.height = Doc.height;
  const x = c.getContext('2d', {willReadFrequently:true});
  x.fillStyle = '#ffffff';
  const [rx, ry, rw, rh] = fr.rect;
  if (fr.shape === 'ellipse'){ x.beginPath(); x.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2); x.fill(); }
  else x.fillRect(rx, ry, rw, rh);
  G.mask = {id:'M' + G.id, kind:'raster', name:'mask', visible:true, opacity:1, blend:'normal', mask:null, x:0, y:0, _cache:null, _cacheScale:0, data:{canvas:c, ctx:x}};
  delete G.maskOff;
  Layer.invalidate(G);
}
/* 文件尺寸变了（画板长画布、裁剪…）：蒙版重做成新的文件大小（组的蒙版是照文件大小拉的） */
function syncMasks(){ frames().forEach(G => { const c = G.mask && G.mask.data && G.mask.data.canvas; if (!c || c.width !== Doc.width || c.height !== Doc.height) buildMask(G); }); }

/* 一层内容的外框（文件坐标 [x,y,w,h]；空的回 null） */
function alphaBox(c){
  const W = c.width, H = c.height; if (!W || !H) return null;
  const d = c.getContext('2d', {willReadFrequently:true}).getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}
function boundsOf(L){
  if (!L || L.kind === 'group') return null;
  if (L.kind === 'raster'){ const b = alphaBox(L.data.canvas); return b ? [b[0] + L.x, b[1] + L.y, b[2], b[3]] : null; }
  return alphaBox(renderLayer(L, 1));
}
const overlaps = (a, b) => a && b && a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
const isBg = L => !!(window.PsLayer && PsLayer.isBackground && PsLayer.isBackground(L));
/* 这一层能不能被画进图框（照 PS：有内容的像素层／智能对象，不是背景、不在别的图框里） */
const framable = L => !!L && (L.kind === 'raster' || L.kind === 'smart') && !isBg(L) && !frameOf(L);

function nextName(){
  const base = L3('框架', '画框', 'Frame'), re = new RegExp('^' + base + ' (\\d+)$');
  let n = 0; Doc.layers.forEach(L => { const m = re.exec(L.name); if (m) n = Math.max(n, +m[1]); });
  return base + ' ' + (n + 1);
}
function rectParam(p){
  if (!Array.isArray(p.rect) || p.rect.length !== 4) return null;
  const r = p.rect.map(v => rround(nv(v)));
  return r.every(isFinite) && r[2] >= 1 && r[3] >= 1 ? r : null;
}
const pinParents = () => { if (!Groups.any()) Doc.layers.forEach(L => { if (L.parent === undefined) L.parent = null; }); };

/* ═══════════ 命令（命名空间＝工具 id「frame」） ═══════════ */
CMD.reg('frame.new', {i18n:'', undoable:true, params:'{rect:[x,y,w,h]（文件坐标）, shape:"rect|ellipse"="rect", layer?:图层 id（把这层放进图框＝框住它；缺省＝空图框）, name?="画框 N"} 画一个图框（组＋只露框内的蒙版，同 frame_cmds.rs clip_mask）→ {id, frame:[x,y,w,h], shape, content}'}, p => {
  const r = rectParam(p); if (!r) return fail('frame.new: give "rect":[x,y,w,h] with a size of at least 1');
  const shape = p.shape === 'ellipse' ? 'ellipse' : 'rect';
  if (p.shape !== undefined && p.shape !== 'rect' && p.shape !== 'ellipse') return fail('shape must be rect|ellipse');
  let C = null;
  if (p.layer !== undefined && p.layer !== null){
    C = Doc.byId(p.layer); if (!C) return fail('no such layer');
    if (C.kind === 'group') return fail('a group or frame can not go into a frame');
    if (frameOf(C)) return fail('the layer is already in a frame');
    if (isBg(C)) return fail("the Background layer can't go into a frame");
  }
  syncMasks();
  pinParents();
  const G = Layer.group(p.name ? String(p.name) : nextName());
  G.data.frame = {shape, rect:r};
  const A = Doc.active();
  if (C){
    G.parent = C.parent === undefined ? null : C.parent;
    Doc.layers.splice(Doc.index(C.id) + 1, 0, G);
    C.parent = G.id;
  } else if (A && A.kind === 'group' && !isFrame(A)){            // 当前层是组／画板：新图框放进去、最上面
    G.parent = A.id; Doc.layers.splice(Doc.index(A.id), 0, G);
  } else if (A){
    const F = frameOf(A), at = F || A;                           // 当前层在图框里：新图框放在那个图框上面
    G.parent = at.parent === undefined ? null : at.parent; Doc.layers.splice(Doc.index(at.id) + 1, 0, G);
  } else { G.parent = null; Doc.layers.push(G); }
  buildMask(G);
  Groups.rebuild(Groups.tree());
  Doc.activeId = G.id; Doc.selectedIds = null;
  return {ok:true, id:G.id, layer:G.id, frame:r.slice(), shape, content:C ? C.id : null};
});
CMD.reg('frame.set', {i18n:'', undoable:true, params:'{id?（画框或框里的层；缺省＝当前层所在的画框）, rect?:[x,y,w,h], shape?:"rect|ellipse", name?} 改图框（内容不动）→ {id, frame, shape}'}, p => {
  const G = frameFromP(p); if (!G) return fail('no frame selected');
  if (p.rect !== undefined){ const r = rectParam(p); if (!r) return fail('"rect" must be [x,y,w,h] with a size of at least 1'); G.data.frame.rect = r; }
  if (p.shape !== undefined){ if (p.shape !== 'rect' && p.shape !== 'ellipse') return fail('shape must be rect|ellipse'); G.data.frame.shape = p.shape; }
  if (p.name) G.name = String(p.name);
  buildMask(G);
  return {ok:true, id:G.id, frame:G.data.frame.rect.slice(), shape:G.data.frame.shape};
});
/* ═══ 图框描边（PS 2020 属性面板「描边」：颜色、粗细、位置 内部／居中／外部）＋ 只移动内容 ═══ */
const STROKE_POS = ['inside', 'center', 'outside'];
CMD.reg('frame.stroke', {i18n:'', undoable:true, params:'{id?（画框或框里的层；缺省＝当前图框）, width?:px（0＝不描边）, color?:"#rrggbb", position?:"inside|center|outside"="inside", enabled?:bool} 图框描边（照 PS 属性面板；画在框内容上面、框外不被蒙版裁掉）→ {stroke}'}, p => {
  const G = frameFromP(p); if (!G) return fail('no frame selected');
  const cur = Object.assign({width:0, color:'#000000', position:'inside'}, G.data.frame.stroke || {});
  if (p.width !== undefined){ const w = nv(p.width); if (!isFinite(w) || w < 0 || w > 1000) return fail('width must be 0..1000'); cur.width = w; }
  if (p.color !== undefined){ if (!/^#[0-9a-f]{6}$/i.test(String(p.color))) return fail('color must be #rrggbb'); cur.color = String(p.color).toLowerCase(); }
  if (p.position !== undefined){ if (!STROKE_POS.includes(p.position)) return fail('position must be inside|center|outside'); cur.position = p.position; }
  if (p.enabled === false) cur.width = 0;
  if (p.enabled === true && !(cur.width > 0)) cur.width = 1;
  if (cur.width > 0) G.data.frame.stroke = cur; else delete G.data.frame.stroke;
  Layer.invalidate(G);
  return {ok:true, id:G.id, stroke:G.data.frame.stroke ? Object.assign({}, G.data.frame.stroke) : null};
});
CMD.reg('frame.moveContent', {i18n:'', undoable:true, params:'{id?（画框或框里的层；缺省＝当前图框）, dx, dy（文件像素）} 只移动图框里的内容、框不动（PS：图框内容另选来拖）→ {moved:[图层 id…]}'}, p => {
  const G = frameFromP(p); if (!G) return fail('no frame selected');
  const dx = nv(p.dx), dy = nv(p.dy);
  if (!isFinite(dx) || !isFinite(dy)) return fail('dx, dy required');
  if (!dx && !dy) return fail('nothing to move (dx, dy are 0)');
  const kids = Groups.descendants(G).filter(K => K.kind !== 'group');
  if (!kids.length) return fail('the frame is empty');
  const lk = kids.find(K => window.Locks && Locks.blocks && Locks.blocks(K, 'position'));
  if (lk) return fail('a content layer is locked (position)');
  kids.forEach(K => Groups.shiftLayer(K, rround(dx), rround(dy)));
  Layer.invalidate(G);
  return {ok:true, id:G.id, moved:kids.map(K => K.id), dx:rround(dx), dy:rround(dy)};
});
/* 描边画法：内部＝裁在框内、线宽×2；外部＝裁在框外（evenodd 挖掉框）、线宽×2；居中＝直接描 */
function strokePath(ctx, fr, s){
  const [x, y, w, h] = fr.rect;
  ctx.beginPath();
  if (fr.shape === 'ellipse') ctx.ellipse((x + w / 2) * s, (y + h / 2) * s, w / 2 * s, h / 2 * s, 0, 0, Math.PI * 2);
  else ctx.rect(x * s, y * s, w * s, h * s);
}
function drawStroke(ctx, G, scale, alpha){
  const fr = G.data.frame, st = fr.stroke; if (!st || !(st.width > 0)) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const pos = st.position || 'inside';
  if (pos === 'inside'){ strokePath(ctx, fr, scale); ctx.clip(); }
  else if (pos === 'outside'){
    ctx.beginPath(); ctx.rect(-1e5, -1e5, 2e5, 2e5);
    const [x, y, w, h] = fr.rect;
    if (fr.shape === 'ellipse'){ ctx.moveTo((x + w) * scale, (y + h / 2) * scale); ctx.ellipse((x + w / 2) * scale, (y + h / 2) * scale, w / 2 * scale, h / 2 * scale, 0, 0, Math.PI * 2); }
    else ctx.rect(x * scale, y * scale, w * scale, h * scale);
    ctx.clip('evenodd');
  }
  strokePath(ctx, fr, scale);
  ctx.lineWidth = st.width * scale * (pos === 'center' ? 1 : 2);
  ctx.lineJoin = 'miter'; ctx.strokeStyle = st.color || '#000000'; ctx.stroke();
  ctx.restore();
}
/* 接到合成：包 Groups.draw——图框组（穿透或隔离）画完后再画描边在上面（不吃组蒙版）；engine 不必改 */
if (!Groups.__frameStroke){
  Groups.__frameStroke = true;
  const draw0 = Groups.draw;
  let inner = 0;
  Groups.draw = function(ctx, G, scale){
    if (inner || !isFrame(G) || !G.data.frame.stroke || !(G.data.frame.stroke.width > 0)) return draw0.call(this, ctx, G, scale);
    const done = draw0.call(this, ctx, G, scale);
    if (!done){ inner++; try { compositeOne(ctx, G, scale); } finally { inner--; } }   // 隔离组：先照常叠（compositeOne 里再问一次 draw，这次放行）
    drawStroke(ctx, G, scale, G.opacity === undefined ? 1 : G.opacity);
    return true;
  };
}
/* 接到 SVG：图框组的 <g> 后面补一个描边形状 */
if (Project._svgLayer && !Project.__frameStroke){
  Project.__frameStroke = true;
  const sv0 = Project._svgLayer;
  Project._svgLayer = function(L){
    const o = sv0.apply(this, arguments);
    if (!o || !isFrame(L) || !L.data.frame.stroke || !(L.data.frame.stroke.width > 0)) return o;
    const fr = L.data.frame, st = fr.stroke, [x, y, w, h] = fr.rect, pos = st.position || 'inside';
    // 内部／外部：把描边路径往内／外缩放半个线宽（矩形）或改半径（椭圆）＝跟画面一样的落点
    const k = pos === 'inside' ? -st.width / 2 : pos === 'outside' ? st.width / 2 : 0;
    const op = L.opacity !== 1 ? ` opacity="${L.opacity}"` : '';
    const shp = fr.shape === 'ellipse'
      ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${Math.max(0, w / 2 + k)}" ry="${Math.max(0, h / 2 + k)}"`
      : `<rect x="${x - k}" y="${y - k}" width="${Math.max(0, w + 2 * k)}" height="${Math.max(0, h + 2 * k)}"`;
    return o + `${shp} fill="none" stroke="${st.color}" stroke-width="${st.width}" data-frame-stroke="${L.id}"${op}/>\n`;
  };
}

CMD.reg('frame.clear', {i18n:'', undoable:true, params:'{id?} 清除图框内容（框留着、变回空图框）→ {removed}'}, p => {
  const G = frameFromP(p); if (!G) return fail('no frame selected');
  const kids = contentOf(G); if (!kids.length) return fail('the frame is empty');
  kids.forEach(K => Doc.remove(K.id));
  Doc.activeId = G.id;
  return {ok:true, removed:kids.length};
});
CMD.reg('frame.convert', {i18n:'', undoable:true, params:'{id?（缺省＝当前层）, shape:"rect|ellipse"="rect"} 转换为图框：图框＝这层内容的外框，这层放进去（PS 图层 ▸ 新建 ▸ 转换为图框）→ {id, frame}'}, p => {
  const L = (p && (p.id || p.layer)) ? Doc.byId(p.id || p.layer) : Doc.active();
  if (!L) return fail('no active layer');
  if (L.kind === 'group') return fail('select a layer that is not a group');
  const b = boundsOf(L); if (!b) return fail('the layer is empty');
  return CMD.map['frame.new'].run({rect:b, shape:p.shape || 'rect', layer:L.id});
});
/* 放图进框：等比填满（fill）或整张放进（fit）、置中；框里原来的图换掉。非同步（等图载完才进历史，同 layer.addImageFromURL） */
CMD.reg('frame.place', {i18n:'', params:'{id?（缺省＝当前画框）, url（http／data／blob）, fit:"fill|fit"="fill", name?} 把一张图放进图框（PS 拖图进框／换图）→ Promise<{id, content, placed:[x,y,w,h]}>'}, p => {
  const G = frameFromP(p); if (!G) return fail('no frame selected');
  if (!p.url) return fail('missing `url`');
  const serial = Doc.serial, gid = G.id;
  return new Promise((res, rej) => {
    const im = new Image(); if (!/^(data|blob):/i.test(String(p.url))) im.crossOrigin = 'anonymous';
    im.onload = () => {
      const F = Doc.byId(gid);
      if (Doc.serial !== serial || !F) return rej(new Error('document changed while loading: ' + String(p.url).slice(0, 80)));
      History.push();
      syncMasks();
      contentOf(F).forEach(K => Doc.remove(K.id));
      const [fx, fy, fw, fh] = F.data.frame.rect, iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
      const k = p.fit === 'fit' ? Math.min(fw / iw, fh / ih) : Math.max(fw / iw, fh / ih);
      const w = iw * k, h = ih * k, x = fx + (fw - w) / 2, y = fy + (fh - h) / 2;
      // 同 layer.addImageFromURL，画布只开放置矩形（∩文件）那么大、用 N.x/N.y 定位（整数格、小数留画布里，像素跟旧版一样）
      const X0 = Math.max(0, Math.floor(x)), Y0 = Math.max(0, Math.floor(y)), X1 = Math.min(Doc.width, Math.ceil(x + w)), Y1 = Math.min(Doc.height, Math.ceil(y + h));
      const N = Layer.raster(p.name ? String(p.name) : L3('影像', '图像', 'Image'), Math.max(1, X1 - X0), Math.max(1, Y1 - Y0));
      if (X1 > X0 && Y1 > Y0){ N.x = X0; N.y = Y0; }
      N.data.ctx.imageSmoothingQuality = 'high';
      N.data.ctx.drawImage(im, x - N.x, y - N.y, w, h);
      N.parent = F.id;
      Doc.layers.splice(Doc.index(F.id), 0, N);
      Groups.rebuild(Groups.tree());
      Doc.activeId = F.id; Doc.selectedIds = null;
      if (window.UI) UI.refresh();
      res({ok:true, id:F.id, content:N.id, placed:[x, y, w, h]});
    };
    im.onerror = () => rej(new Error('image failed to load: ' + String(p.url).slice(0, 80)));
    im.src = p.url;
  });
});
CMD.reg('frame.list', {i18n:'', params:'{} 全部图框 → {frames:[{id,name,shape,rect:[x,y,w,h],content:[图层 id…]}]}'}, () =>
  ({ok:true, frames:frames().map(G => ({id:G.id, name:G.name, shape:G.data.frame.shape, rect:G.data.frame.rect.slice(), content:contentOf(G).map(K => K.id)}))}));
CMD.reg('frame.options', {i18n:'', params:'{shape?:"rect|ellipse"} 图框工具选项栏：要画矩形还是椭圆图框（界面状态）→ {shape}'}, p => {
  if (p.shape === 'rect' || p.shape === 'ellipse') FK.opt.shape = p.shape;
  else if (p.shape !== undefined) return fail('shape must be rect|ellipse');
  if (window.UI && ToolState.cur === 'frame') UI.buildOptions('frame');
  return {ok:true, shape:FK.opt.shape};
});

/* ═══════════ 手势与叠画 ═══════════ */
const FK = window.FrameKit = {
  opt:{shape:'rect'}, drag:null,
  isFrame, frames, frameOf, frameAt, shapeHas, buildMask, syncMasks, boundsOf,
  /* 拖曳的框：Shift＝正方／正圆、Alt＝从中心（PS 的形状手感）；整数 */
  rectOf(d){
    const dx = d.cur[0] - d.start[0], dy = d.cur[1] - d.start[1];
    let e = d.cur.slice();
    if (d.mods.shift){ const k = Math.max(Math.abs(dx), Math.abs(dy)); e = [d.start[0] + (dx < 0 ? -k : k), d.start[1] + (dy < 0 ? -k : k)]; }
    const a = d.mods.alt ? [2 * d.start[0] - e[0], 2 * d.start[1] - e[1]] : d.start;
    const x0 = rround(Math.min(a[0], e[0])), y0 = rround(Math.min(a[1], e[1])), x1 = rround(Math.max(a[0], e[0])), y1 = rround(Math.max(a[1], e[1]));
    return [x0, y0, x1 - x0, y1 - y0];
  }
};
const mods = e => ({shift:!!e.shiftKey, alt:!!e.altKey});
const report = r => { if (r && r.ok === false && r.error) console.warn(r.error); return r; };
const rebuild = () => { if (window.UI && ToolState.cur === 'frame') UI.buildOptions('frame'); if (window.UI) UI.draw(); };
function pathShape(ctx, shape, r, s){
  ctx.beginPath();
  if (shape === 'ellipse') ctx.ellipse((r[0] + r[2] / 2) * s, (r[1] + r[3] / 2) * s, Math.max(0, r[2] / 2 * s), Math.max(0, r[3] / 2 * s), 0, 0, Math.PI * 2);
  else ctx.rect(r[0] * s + 0.5, r[1] * s + 0.5, r[2] * s, r[3] * s);
}
function drawTool(ctx, s){
  const A = frameOf(Doc.active());
  ctx.save();
  for (const G of frames()){
    if (G.visible === false) continue;
    const fr = G.data.frame, r = fr.rect, empty = !contentOf(G).length;
    if (empty){                                                    // 空图框的占位：灰框＋对角叉（画面上看得到要往哪放）
      ctx.save(); pathShape(ctx, fr.shape, r, s); ctx.clip();
      ctx.strokeStyle = 'rgba(150,150,150,0.8)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(r[0] * s, r[1] * s); ctx.lineTo((r[0] + r[2]) * s, (r[1] + r[3]) * s); ctx.moveTo((r[0] + r[2]) * s, r[1] * s); ctx.lineTo(r[0] * s, (r[1] + r[3]) * s); ctx.stroke();
      ctx.restore();
    }
    pathShape(ctx, fr.shape, r, s);
    ctx.lineWidth = G === A ? 2 : 1; ctx.strokeStyle = G === A ? '#2f7fd8' : 'rgba(150,150,150,0.9)'; ctx.stroke();
  }
  const d = FK.drag;
  if (d && d.moved){
    const r = FK.rectOf(d);
    pathShape(ctx, FK.opt.shape, r, s);
    ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.strokeStyle = '#2f7fd8'; ctx.stroke();
  }
  ctx.restore();
}

/* 把图片档拖到图框上＝放进图框（不管现在哪颗工具；不在图框上就交给原本的拖放＝置入新层） */
function docPt(e){
  const c = window.UI && UI.canvas; if (!c) return null;
  const b = c.getBoundingClientRect(), z = UI.zoom || 1;
  return [(e.clientX - b.left) / z, (e.clientY - b.top) / z];
}
function onDrop(e){
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f || !/^image\//.test(f.type || '')) return;
  const pt = docPt(e); if (!pt) return;
  const G = frameAt(pt); if (!G) return;
  e.preventDefault(); e.stopPropagation();
  const url = URL.createObjectURL(f);
  Promise.resolve(CMD.run('frame.place', {id:G.id, url, name:f.name.replace(/\.[^.]+$/, '')})).catch(err => console.error(err)).finally(() => setTimeout(() => URL.revokeObjectURL(url), 1000));
}
function mount(){
  const w = document.getElementById('canvasWrap'); if (!w || w._frameDrop) return;
  w._frameDrop = true; w.addEventListener('drop', onDrop, true);
}
if (document.readyState === 'complete') mount(); else window.addEventListener('load', mount);
/* 选项栏「置入图像…」：挑一张图放进当前图框 */
function pickInto(G){
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (!f) return; const url = URL.createObjectURL(f);
    Promise.resolve(CMD.run('frame.place', {id:G.id, url, name:f.name.replace(/\.[^.]+$/, '')})).catch(err => console.error(err)).finally(() => { rebuild(); setTimeout(() => URL.revokeObjectURL(url), 1000); }); };
  inp.click();
}

const STRINGS = {
  'zh-Hant':{'tool.frame':'邊框', 'ui.frameRect':'建立新的矩形邊框', 'ui.frameEllipse':'建立新的橢圓形邊框', 'ui.framePlace':'置入影像…', 'ui.frameClear':'清除內容',
    'ui.frameHint':'拖曳畫出邊框（Shift 正方／正圓、Alt 從中心）· 畫在選取的影像圖層上＝把它框起來 · 點一下選取邊框 · 把圖片拖到邊框上＝放進去'},
  'zh-Hans':{'tool.frame':'图框', 'ui.frameRect':'创建新的矩形画框', 'ui.frameEllipse':'创建新的椭圆画框', 'ui.framePlace':'置入图像…', 'ui.frameClear':'清除内容',
    'ui.frameHint':'拖出图框（Shift 正方／正圆、Alt 从中心）· 画在选中的图像层上＝把它框起来 · 点一下选中图框 · 把图片拖到图框上＝放进去'},
  'en':{'tool.frame':'Frame', 'ui.frameRect':'Create a new rectangular frame', 'ui.frameEllipse':'Create a new elliptical frame', 'ui.framePlace':'Place Image…', 'ui.frameClear':'Clear Contents',
    'ui.frameHint':'Drag to draw a frame (Shift square/circle, Alt from centre) · draw over the selected image layer to frame it · click selects a frame · drop an image on a frame to fill it'}
};
/* 描边、只移动内容的字串 */
Object.assign(STRINGS['zh-Hant'], {'ui.frameStroke':'筆畫', 'ui.frameStroke_inside':'內部', 'ui.frameStroke_center':'居中', 'ui.frameStroke_outside':'外部'});
Object.assign(STRINGS['zh-Hans'], {'ui.frameStroke':'描边', 'ui.frameStroke_inside':'内部', 'ui.frameStroke_center':'居中', 'ui.frameStroke_outside':'外部'});
Object.assign(STRINGS['en'], {'ui.frameStroke':'Stroke', 'ui.frameStroke_inside':'Inside', 'ui.frameStroke_center':'Center', 'ui.frameStroke_outside':'Outside'});
STRINGS['zh-Hant']['ui.frameHint'] += ' · 在有內容的邊框裡拖曳＝只移動內容（Alt＋拖＝畫新邊框）';
STRINGS['zh-Hans']['ui.frameHint'] += ' · 在有内容的图框里拖＝只移动内容（Alt＋拖＝画新图框）';
STRINGS['en']['ui.frameHint'] += ' · drag inside a filled frame to move only its content (Alt-drag draws a new frame)';
if (typeof Lang !== 'undefined') Lang.add(STRINGS);

Tools.reg({
  id:'frame', icon:'⊠', group:'raster', order:310, for:'raster', cursor:'crosshair', opts:[], strings:STRINGS,
  onDown(e, pt){
    FK.drag = null;
    if (e.button !== undefined && e.button !== 0) return;
    // 在有内容的图框里按下（不按 Alt）＝拖曳只移动内容、框不动（Alt＋拖＝照样画新图框）
    const G = !e.altKey ? frameAt(pt) : null;
    const content = G ? Groups.descendants(G).filter(K => K.kind !== 'group') : [];
    FK.drag = {start:pt.slice(), cur:pt.slice(), mods:mods(e), moved:false, content:content.length ? {G, kids:content, applied:[0, 0]} : null};
  },
  onMove(e, pt, P){
    const d = FK.drag; if (!d || !P.down) return;
    d.cur = pt.slice(); d.mods = mods(e);
    if (Math.hypot(d.cur[0] - d.start[0], d.cur[1] - d.start[1]) * ((window.UI && UI.zoom) || 1) > 3) d.moved = true;
    if (d.content && d.moved){                                   // 即时预览：直接挪内容层（放开时退回、改走 frame.moveContent 一步历史）
      const c = d.content, tx = rround(d.cur[0] - d.start[0]), ty = rround(d.cur[1] - d.start[1]);
      if (tx !== c.applied[0] || ty !== c.applied[1]){ c.kids.forEach(K => Groups.shiftLayer(K, tx - c.applied[0], ty - c.applied[1])); c.applied = [tx, ty]; Layer.invalidate(c.G); }
    }
    UI.draw();
  },
  onUp(e, pt){
    const d = FK.drag; FK.drag = null;
    if (!d){ UI.draw(); return; }
    d.cur = pt.slice(); d.mods = mods(e);
    if (d.content){
      const c = d.content;
      if (c.applied[0] || c.applied[1]){ c.kids.forEach(K => Groups.shiftLayer(K, -c.applied[0], -c.applied[1])); Layer.invalidate(c.G); }
      const tx = rround(d.cur[0] - d.start[0]), ty = rround(d.cur[1] - d.start[1]);
      if (d.moved && (tx || ty)){
        if (Doc.activeId !== c.G.id) CMD.run('layer.select', {id:c.G.id});
        report(CMD.run('frame.moveContent', {id:c.G.id, dx:tx, dy:ty}));
        rebuild(); return;
      }
      if (!d.moved){ CMD.run('layer.select', {id:c.G.id}); rebuild(); return; }
    }
    const r = FK.rectOf(d);
    if (r[2] < 2 || r[3] < 2){                                   // 点一下＝选点到的图框
      const G = frameAt(pt);
      if (G) CMD.run('layer.select', {id:G.id});
      rebuild(); return;
    }
    const A = Doc.active(), q = {rect:r, shape:FK.opt.shape};
    if (framable(A) && overlaps(boundsOf(A), r)) q.layer = A.id;   // 画在选中的图像层上＝把它框起来
    report(CMD.run('frame.new', q));
    rebuild();
  },
  onDeactivate(){
    const d = FK.drag; FK.drag = null;
    if (d && d.content && (d.content.applied[0] || d.content.applied[1])){ d.content.kids.forEach(K => Groups.shiftLayer(K, -d.content.applied[0], -d.content.applied[1])); Layer.invalidate(d.content.G); }
  },
  drawOverlay(ctx, s){ drawTool(ctx, s); },
  /* PS 2020 图框工具选项栏：矩形／椭圆两颗；（PS 属性面板的）置入图像、清除内容 */
  buildOptions(box){
    const G = frameOf(Doc.active());
    const btn = (txt, tip, opt, on, fn) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.title = Lang.t(tip); b.dataset.opt = opt;
      b.style.cssText = 'margin:0 2px;min-width:26px' + (on ? ';background:#2f7fd8;color:#fff' : ''); b.onclick = fn; box.appendChild(b); return b;
    };
    btn('▭', 'ui.frameRect', 'shape-rect', FK.opt.shape === 'rect', () => CMD.run('frame.options', {shape:'rect'}));
    btn('◯', 'ui.frameEllipse', 'shape-ellipse', FK.opt.shape === 'ellipse', () => CMD.run('frame.options', {shape:'ellipse'}));
    const sep = document.createElement('span'); sep.style.cssText = 'display:inline-block;width:1px;height:18px;background:#555;margin:0 6px;vertical-align:middle'; box.appendChild(sep);
    btn(Lang.t('ui.framePlace'), 'ui.framePlace', 'place', false, () => { if (G) pickInto(G); }).disabled = !G;
    btn(Lang.t('ui.frameClear'), 'ui.frameClear', 'clear', false, () => { report(CMD.run('frame.clear', {id:G.id})); rebuild(); }).disabled = !G || !contentOf(G).length;
    // 描边（PS 属性面板）：粗细、颜色、位置
    const st = G && G.data.frame.stroke || {width:0, color:'#000000', position:'inside'};
    const lab = t => { const x = document.createElement('span'); x.textContent = Lang.t(t); x.style.margin = '0 3px 0 8px'; box.appendChild(x); };
    lab('ui.frameStroke');
    const wIn = document.createElement('input'); wIn.type = 'number'; wIn.min = 0; wIn.max = 1000; wIn.step = 1; wIn.value = st.width || 0; wIn.dataset.opt = 'strokeWidth'; wIn.style.width = '48px'; wIn.disabled = !G;
    wIn.onchange = () => { const v = Math.max(0, +wIn.value); if (G && isFinite(v) && v !== ((G.data.frame.stroke && G.data.frame.stroke.width) || 0)){ report(CMD.run('frame.stroke', {id:G.id, width:v})); rebuild(); } };
    box.appendChild(wIn);
    const cIn = document.createElement('input'); cIn.type = 'color'; cIn.value = st.color || '#000000'; cIn.dataset.opt = 'strokeColor'; cIn.disabled = !G; cIn.style.margin = '0 3px';
    cIn.onchange = () => { if (G){ report(CMD.run('frame.stroke', {id:G.id, color:cIn.value, width:(G.data.frame.stroke && G.data.frame.stroke.width) || 1})); rebuild(); } };
    box.appendChild(cIn);
    const pSel = document.createElement('select'); pSel.dataset.opt = 'strokePos'; pSel.disabled = !G;
    pSel.innerHTML = STROKE_POS.map(k => `<option value="${k}">${Lang.t('ui.frameStroke_' + k)}</option>`).join('');
    pSel.value = st.position || 'inside';
    pSel.onchange = () => { if (G && pSel.value !== ((G.data.frame.stroke && G.data.frame.stroke.position) || 'inside')){ report(CMD.run('frame.stroke', {id:G.id, position:pSel.value})); rebuild(); } };
    box.appendChild(pSel);
    const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t('ui.frameHint'); box.appendChild(h);
  }
});

})();
