/* 内容感知移动工具（PS J，ps.content-move）——🔴 原码没有·照 PS 2020 写（ArtCraft／PhotoCraft 没有这颗工具）。
   算法借现成的：window.HealCore（tools/spotheal.js：complete＝algo/src/inpaint.rs 的 PatchMatch＋EM 内容识别、healRegion／seamlessClone＝algo/src/poisson.rs）、
   window.PatchKit（tools/patch.js：选区平移、内缘过渡、贴回图层、内容预览、套索手势）、tools/lasso.js 的 lasso.select、window.SelMask。
   PS 2020 的行为（我们照做）：
   - 圈选区同修补工具（没选区／选区外拖＝套索；Shift 加、Alt 减、Shift+Alt 交集；点一下＝取消选择）
   - 在选区里拖＝把选中的东西拖到别处（看得到内容跟着走），放开：
       「移动」：原处用内容识别补掉、东西放到新位置并融进那里
       「扩展」：原处不动，复制一份到新位置（拉长／加高用）
       结构 1–7：放下那块的边缘要多「硬」（7＝几乎原样、越小边缘越宽地跟四周过渡）
       颜色 0–10：放下那块的颜色要多融进新位置四周（0＝不调色）
       对所有图层取样：从整份文件合成取样、写进当前层
       投影时变换（Transform On Drop）：放下后出现外框与四角把手，可拖角缩放（Shift 等比）、拖框内移动、框外 40 点内拖＝绕中心旋转（Shift 每 15°；
         选项栏出「角度」栏可直接打数字）、再远点一下＝确认；Enter／双击确认、Esc 取消（旋转：contentmove.apply 收 angle）
   - 完成后选区跟着在新位置（PS）
   命令：contentmove.apply / contentmove.setOptions；圈选区走 lasso.select */
(function(){
const H = window.HealCore, K = window.PatchKit;
if (!H || !K){ console.error('contentmove.js: 要先载 tools/spotheal.js（HealCore）与 tools/patch.js（PatchKit）'); return; }
const RC = H.RC, L3 = K.L3;
const asNum = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const C = 'contentmove.apply';

/* 文件遮罩 b 在连续坐标 (u,v)（像素中心在 i+0.5）的双线性覆盖度 0..1 */
function maskAt(b, u, v){
  const W = Doc.width, Hh = Doc.height, fx = u - 0.5, fy = v - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const g = (x, y) => (x < 0 || y < 0 || x >= W || y >= Hh) ? 0 : b[y*W + x] / 255;
  const a = g(x0, y0) + (g(x0+1, y0) - g(x0, y0))*tx, c = g(x0, y0+1) + (g(x0+1, y0+1) - g(x0, y0+1))*tx;
  return a + (c - a)*ty;
}
function moveApply(p){
  const t = K.targetLayer(p); if (t.error) return {ok:false, error:`${C}: ${t.error}`};
  const L = t.L, b = K.selBytes(); if (!b) return {ok:false, error:`${C}: needs a selection (lasso.select / marquee.select, or drag with the tool)`};
  const tb = K.bytesBox(b); if (!tb) return {ok:false, error:`${C}: the selection is empty`};
  const mode = p.mode === undefined ? 'move' : p.mode;
  if (mode !== 'move' && mode !== 'extend') return {ok:false, error:`${C}: unknown mode \`${mode}\` (move|extend)`};
  const structure = Math.round(clamp(asNum(p.structure, 4), 1, 7)), color = Math.round(clamp(asNum(p.color, 0), 0, 10));
  const dx = Math.round(asNum(p.dx, 0)), dy = Math.round(asNum(p.dy, 0));
  let db = [tb[0]+dx, tb[1]+dy, tb[2]+dx, tb[3]+dy];
  if (Array.isArray(p.box) && p.box.length === 4 && p.box.every(v => typeof v === 'number' && isFinite(v))){
    const q = p.box.map(Math.round);
    db = [Math.min(q[0], q[2]), Math.min(q[1], q[3]), Math.max(q[0], q[2]), Math.max(q[1], q[3])];
    if (RC.w(db) < 1 || RC.h(db) < 1) return {ok:false, error:`${C}: \`box\` is empty`};
  }
  // 放置时变形的旋转：angle＝度，顺时针，绕放下外框的中心转（PS 自由变换的旋转）
  let angle = asNum(p.angle, 0); angle = ((angle % 360) + 540) % 360 - 180; if (Math.abs(angle) < 1e-6) angle = 0;
  if (!angle && db[0] === tb[0] && db[1] === tb[1] && db[2] === tb[2] && db[3] === tb[3]) return {ok:false, error:`${C}: nothing moved (dx/dy are 0, no box and no angle)`};
  const lf = H.lockFail(L, C); if (lf) return lf;
  const lock = H.lockAlpha(L);
  const sx = RC.w(db) / RC.w(tb), sy = RC.h(db) / RC.h(tb);
  const rad = angle * Math.PI / 180, ca = Math.cos(rad), sa = Math.sin(rad), cx = (db[0] + db[2]) / 2, cy = (db[1] + db[3]) / 2;
  // 目的连续坐标 → 来源连续坐标：先绕中心转回去（−angle），再照外框缩放对回选区外框
  const toSrc = (X, Y) => {
    if (angle){ const ux = X - cx, uy = Y - cy; X = cx + ux*ca + uy*sa; Y = cy - ux*sa + uy*ca; }
    return [tb[0] + (X - db[0]) / sx, tb[1] + (Y - db[1]) / sy];
  };
  // 放下那块转过之后的外框（文件坐标）：四角转完取外接矩形
  let rb = db;
  if (angle){
    const cs = [[db[0], db[1]], [db[2], db[1]], [db[2], db[3]], [db[0], db[3]]].map(([x, y]) => [cx + (x - cx)*ca - (y - cy)*sa, cy + (x - cx)*sa + (y - cy)*ca]);
    rb = [Math.floor(Math.min(...cs.map(c => c[0]))), Math.floor(Math.min(...cs.map(c => c[1]))), Math.ceil(Math.max(...cs.map(c => c[0]))), Math.ceil(Math.max(...cs.map(c => c[1])))];
  }
  const S = K.sourceOf(L, p.sampleAllLayers === true);
  const uni = [Math.min(tb[0], rb[0]), Math.min(tb[1], rb[1]), Math.max(tb[2], rb[2]), Math.max(tb[3], rb[3])];
  const rect = RC.intersect(RC.inflate(uni, K.caMargin(tb, structure)), K.docRect());
  if (RC.empty(rect)) return {ok:false, error:`${C}: lands outside the canvas`};
  const w = RC.w(rect), h = RC.h(rect);
  const base = H.readRegion(S, rect);
  // 1 原处：移动＝内容识别补掉；扩展＝不动
  const hole = Uint8Array.from(K.cropCov(b, rect), v => v > 0 ? 1 : 0);
  const filled = mode === 'move' ? K.fillHole(base, hole) : base;
  // 2 新位置：放下那块的覆盖度（遮罩跟着缩放）与内容（双线性）
  const D = new Float32Array(w*h), Dm = new Uint8Array(w*h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const X = rect[0] + x, Y = rect[1] + y; if (X < rb[0] - 1 || X >= rb[2] + 1 || Y < rb[1] - 1 || Y >= rb[3] + 1) continue;
    const [u, v] = toSrc(X + 0.5, Y + 0.5), c = clamp(maskAt(b, u, v), 0, 1);
    if (c > 0.002){ D[y*w + x] = c; Dm[y*w + x] = 1; }
  }
  const map = { isTranslation: () => sx === 1 && sy === 1 && !angle, offset: () => [tb[0] - db[0], tb[1] - db[1]], map: (X, Y) => toSrc(X, Y) };
  const obj = H.cloneSample(S, rect, map);
  const adapted = K.adaptPatch(obj, filled, Dm, color);           // 新位置：取样内容（颜色＝融进那里的程度）
  // 结构：边缘过渡宽 7−结构 像素（7＝硬边）
  const ramp = K.innerRamp(Dm, w, h, 7 - structure);
  const out = { rect:rect.slice(), ch:4, data:Float32Array.from(filled.data) };
  for (let i = 0; i < w*h; i++){
    const k = D[i] * ramp[i]; if (!(k > 0)) continue;
    for (let c = 0; c < 4; c++) out.data[i*4+c] = filled.data[i*4+c] + (adapted.data[i*4+c] - filled.data[i*4+c]) * k;
  }
  const holeRing = mode === 'move' ? H.dilate(w, h, hole, 1) : new Uint8Array(w*h);
  const wt = Float32Array.from(holeRing, (v, i) => (v || Dm[i]) ? 1 : 0);
  const dmg = K.putRegion(L, out, wt, lock);
  // 3 选区跟着到新位置
  const nb = new Uint8Array(Doc.width * Doc.height);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (D[y*w + x]) nb[(rect[1]+y)*Doc.width + rect[0] + x] = Math.round(D[y*w + x]*255);
  Doc.sel = SelMask.fromBytes(nb);
  return { ok:true, mode, box:db, scale:[sx, sy], angle, damage:[dmg[0], dmg[1], dmg[2]-dmg[0], dmg[3]-dmg[1]], selection:Doc.sel };
}
CMD.reg(C, {i18n:'tool.contentmove', undoable:true,
  params:'{dx, dy:选区拖了多少（文件像素，取整）, box?:[x0,y0,x1,y1] 放下后外框（投影时变换：给了就照它缩放，不给＝选区外框+d）, angle=0（投影时变换的旋转：度，顺时针，绕放下外框中心）, mode="move"|"extend"="move"（移动＝原处内容识别补掉；扩展＝原处保留、复制过去）, '
       + 'structure=1..7=4（放下那块边缘过渡：7＝硬边）, color=0..10=0（放下那块融进四周颜色的程度）, sampleAllLayers=false, layerId?=当前层} 要先有选区；完成后选区在新位置 → {ok, box, scale, damage, selection}'},
  moveApply);

/* ───────── 选项与界面 ───────── */
const U = { mode:'move', structure:4, color:0, sampleAll:false, transformOnDrop:false, selMode:'replace',
            drag:null, xf:null, hover:null, status:null, prev:null };
CMD.reg('contentmove.setOptions', {i18n:'',
  params:'{mode?:"move"|"extend", structure?:1..7, color?:0..10, sampleAllLayers?:bool, transformOnDrop?:bool, selMode?:"replace"|"add"|"subtract"|"intersect"（圈选区的模式）} 滑鼠用的选项（＝选项栏）'}, p => {
  if (p.mode !== undefined){ if (p.mode !== 'move' && p.mode !== 'extend') return {ok:false, error:`contentmove.setOptions: unknown mode \`${p.mode}\``}; U.mode = p.mode; }
  if (typeof p.structure === 'number') U.structure = Math.round(clamp(p.structure, 1, 7));
  if (typeof p.color === 'number') U.color = Math.round(clamp(p.color, 0, 10));
  if (typeof p.sampleAllLayers === 'boolean') U.sampleAll = p.sampleAllLayers;
  if (typeof p.transformOnDrop === 'boolean') U.transformOnDrop = p.transformOnDrop;
  if (K.SEL_MODES.includes(p.selMode)) U.selMode = p.selMode;
  if (window.UI && ToolState.cur === 'contentmove') UI.buildOptions('contentmove');
  return { ok:true, mode:U.mode, structure:U.structure, color:U.color, sampleAllLayers:U.sampleAll, transformOnDrop:U.transformOnDrop, selMode:U.selMode };
});
function setStatus(st){
  U.status = st;
  const el = document.getElementById('cmStatus'); if (el) el.textContent = st ? (st.key ? Lang.t(st.key) : String(st.text || '')) : '';
}
function commit(params){
  const r = CMD.run(C, Object.assign({ mode:U.mode, structure:U.structure, color:U.color, sampleAllLayers:U.sampleAll }, params));
  setStatus(r && r.ok === false ? {text:r.error} : null);
  return r;
}
function srcOf(L){
  return U.sampleAll ? {c:composite(1), x:0, y:0} : {c:L.data.canvas, x:L.x, y:L.y};
}
/* 投影时变换：外框（xf.box＝没转之前的外框）＋ xf.angle（度，顺时针，绕外框中心）；四角把手、框内拖＝移、框外近处拖＝旋转（PS 自由变换） */
const HANDLE = 5, ROT_ZONE = 40;           // 框外 40 个萤幕点内＝旋转区；再远点一下＝确认
const ctrOf = bx => [(bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2];
/* 外框局部（没转）↔ 文件坐标 */
function toWorld(xf, p){ const c = ctrOf(xf.box), a = (xf.angle || 0) * Math.PI / 180, ux = p[0] - c[0], uy = p[1] - c[1];
  return [c[0] + ux*Math.cos(a) - uy*Math.sin(a), c[1] + ux*Math.sin(a) + uy*Math.cos(a)]; }
function toLocal(xf, p){ const c = ctrOf(xf.box), a = (xf.angle || 0) * Math.PI / 180, ux = p[0] - c[0], uy = p[1] - c[1];
  return [c[0] + ux*Math.cos(a) + uy*Math.sin(a), c[1] - ux*Math.sin(a) + uy*Math.cos(a)]; }
function corners(bx){ return [[bx[0], bx[1]], [bx[2], bx[1]], [bx[2], bx[3]], [bx[0], bx[3]]]; }
function hitCorner(pt){
  const r = (HANDLE + 3) / UI.zoom, cs = corners(U.xf.box).map(c => toWorld(U.xf, c));
  for (let i = 0; i < 4; i++) if (Math.abs(pt[0] - cs[i][0]) <= r && Math.abs(pt[1] - cs[i][1]) <= r) return i;
  return -1;
}
const inBox = (bx, pt) => pt[0] >= bx[0] && pt[0] <= bx[2] && pt[1] >= bx[1] && pt[1] <= bx[3];
const inXf = pt => inBox(U.xf.box, toLocal(U.xf, pt));
/* 在框外的旋转区（局部坐标离外框 ≤ ROT_ZONE 个萤幕点） */
function inRotZone(pt){
  const q = toLocal(U.xf, pt), b = U.xf.box, z = ROT_ZONE / UI.zoom;
  const dx = Math.max(b[0] - q[0], 0, q[0] - b[2]), dy = Math.max(b[1] - q[1], 0, q[1] - b[3]);
  return (dx || dy) && Math.hypot(dx, dy) <= z;
}
const angOf = (c, p) => Math.atan2(p[1] - c[1], p[0] - c[0]) * 180 / Math.PI;
function xfCommit(){
  const xf = U.xf; U.xf = null;
  if (!xf) return;
  commit({ dx:xf.box[0] - xf.tb[0], dy:xf.box[1] - xf.tb[1], box:xf.box.slice(), angle:xf.angle || 0 });
  UI.refresh();
  if (ToolState.cur === 'contentmove') UI.buildOptions('contentmove');
}
function xfCancel(){ U.xf = null; if (ToolState.cur === 'contentmove') UI.buildOptions('contentmove'); UI.draw(); }

const tool = Tools.reg({
  id:'contentmove', icon:'⇢', group:'raster', order:43, for:'raster', needs:'raster',
  ui:U,
  strings: K.toStrings(Object.assign({
    'tool.contentmove':  L3('內容感知移動工具', '内容感知移动工具', 'Content-Aware Move Tool'),
    'opt.cm.mode':       L3('模式：', '模式：', 'Mode:'),
    'ui.cm.move':        L3('移動', '移动', 'Move'),
    'ui.cm.extend':      L3('延伸', '扩展', 'Extend'),
    'opt.cm.structure':  L3('結構：', '结构：', 'Structure:'),
    'opt.cm.color':      L3('顏色：', '颜色：', 'Color:'),
    'ui.cm.sampleAll':   L3('取樣全部圖層', '对所有图层取样', 'Sample All Layers'),
    'ui.cm.transformOnDrop': L3('放下時變形', '投影时变换', 'Transform On Drop'),
    'ui.cm.xfHint':      L3('拖曳角落縮放（Shift 等比）・框外拖曳旋轉（Shift 15°）・Enter 確認・Esc 取消', '拖角缩放（Shift 等比）・框外拖动旋转（Shift 15°）・Enter 确认・Esc 取消', 'Drag a corner to scale (Shift: proportional) · drag outside to rotate (Shift: 15°) · Enter to commit · Esc to cancel'),
    'opt.cm.angle':      L3('角度：', '角度：', 'Angle:'),
  }, K.KIT_STRINGS)),

  /* 选项栏照 PS 2020：选区四钮｜模式 移动/扩展｜结构｜颜色｜对所有图层取样｜投影时变换 */
  buildOptions(box, add, mk){
    K.modeButtons(box, U.selMode, m => CMD.run('contentmove.setOptions', {selMode:m}));
    const md = document.createElement('select'); md.dataset.opt = 'cmMode';
    ['move', 'extend'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = Lang.t('ui.cm.' + v); md.appendChild(o); });
    md.value = U.mode; md.onchange = () => CMD.run('contentmove.setOptions', {mode:md.value});
    add('cm.mode', md);
    const num = (key, lo, hi, v) => { const n = mk('number', {min:lo, max:hi, value:v}); n.dataset.opt = key; n.style.width = '48px';
      n.onchange = () => { if (n.value !== '' && isFinite(+n.value)) CMD.run('contentmove.setOptions', {[key]: +n.value}); }; add('cm.' + key, n); };
    num('structure', 1, 7, U.structure);
    num('color', 0, 10, U.color);
    const chk = (key, on, f) => { const l = document.createElement('label'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on; cb.dataset.opt = key;
      cb.onchange = () => f(cb.checked); l.appendChild(cb); const t = document.createElement('span'); t.textContent = Lang.t('ui.cm.' + key); l.appendChild(t); box.appendChild(l); };
    chk('sampleAll', U.sampleAll, v => CMD.run('contentmove.setOptions', {sampleAllLayers:v}));
    chk('transformOnDrop', U.transformOnDrop, v => CMD.run('contentmove.setOptions', {transformOnDrop:v}));
    if (U.xf){                                 // 变形中：角度栏（PS 自由变换选项栏的「旋转」）
      const an = mk('number', {min:-180, max:180, step:0.1, value:Math.round((U.xf.angle || 0) * 10) / 10}); an.dataset.opt = 'cmAngle'; an.style.width = '56px';
      an.onchange = () => { if (U.xf && an.value !== '' && isFinite(+an.value)){ U.xf.angle = ((+an.value % 360) + 540) % 360 - 180; UI.draw(); } };
      add('cm.angle', an);
    }
    const st = document.createElement('span'); st.id = 'cmStatus'; st.style.color = '#e8573f'; box.appendChild(st);
    setStatus(U.xf ? {key:'ui.cm.xfHint'} : U.status);
  },

  onDown(e, pt, P){
    U.hover = pt;
    const L = Doc.active();
    if (!L || L.kind !== 'raster'){ setStatus({key:'ui.pk.needRaster'}); P.down = false; return; }
    if (U.xf){
      const i = hitCorner(pt);
      if (i >= 0){ U.drag = { type:'corner', i, box0:U.xf.box.slice() }; return; }
      if (inXf(pt)){ U.drag = { type:'xmove', start:pt.slice(), box0:U.xf.box.slice() }; return; }
      if (inRotZone(pt)){ U.drag = { type:'rotate', a0:U.xf.angle || 0, p0:angOf(ctrOf(U.xf.box), pt) }; return; }   // 框外近处拖＝旋转（PS）
      xfCommit(); P.down = false; return;                // 再远点一下＝确认（PS）
    }
    const inside = Doc.sel && SelMask.coverage(Math.floor(pt[0]), Math.floor(pt[1])) > 0 && !e.shiftKey && !e.altKey;
    if (inside){
      if (window.Locks && Locks.deny(L, 'pixels')){ P.down = false; return; }
      const b = K.selBytes(), bb = b && K.bytesBox(b);
      if (bb){
        const s = srcOf(L);
        U.drag = { type:'move', start:pt.slice(), off:[0, 0], b, box:bb, client0:[e.clientX, e.clientY], moved:false,
                   content:K.contentCanvas(s.c, s.x, s.y, b, bb, 0, 0) };
        UI.draw(); return;
      }
    }
    U.drag = { type:'lasso', points:[pt.slice()], mode:K.modeFrom(e, U.selMode), client0:[e.clientX, e.clientY], moved:false };
    UI.draw();
  },
  onMove(e, pt, P){
    U.hover = pt;
    const d = U.drag;
    if (d && P.down){
      if (d.type === 'lasso'){
        if (!d.moved && K.screenDist(e, d) > K.CLICK_DIST) d.moved = true;
        const last = d.points[d.points.length-1];
        if (Math.abs(last[0]-pt[0]) + Math.abs(last[1]-pt[1]) > 0.25) d.points.push(pt.slice());
      } else if (d.type === 'move'){
        d.off = [Math.round(pt[0] - d.start[0]), Math.round(pt[1] - d.start[1])];
      } else if (d.type === 'xmove'){
        const ox = Math.round(pt[0] - d.start[0]), oy = Math.round(pt[1] - d.start[1]), b0 = d.box0;
        U.xf.box = [b0[0]+ox, b0[1]+oy, b0[2]+ox, b0[3]+oy];
      } else if (d.type === 'rotate'){
        // 绕外框中心转；Shift＝每 15° 一格（PS）
        let a = d.a0 + angOf(ctrOf(U.xf.box), pt) - d.p0;
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        U.xf.angle = ((a % 360) + 540) % 360 - 180;
        const el = document.querySelector('#optBody [data-opt="cmAngle"]'); if (el) el.value = String(Math.round(U.xf.angle * 10) / 10);
      } else if (d.type === 'corner'){
        // 对角固定；Shift＝等比（照原外框的长宽比）。转过的框：在外框局部坐标里算，再把中心转回文件坐标
        const b0 = d.box0, i = d.i, fx = (i === 1 || i === 2) ? b0[0] : b0[2], fy = (i >= 2) ? b0[1] : b0[3];
        const a = (U.xf.angle || 0) * Math.PI / 180;
        if (!a){
          let nx = Math.round(pt[0]), ny = Math.round(pt[1]);
          if (e.shiftKey){
            const tb = U.xf.tb, s = Math.max(Math.abs(nx - fx) / RC.w(tb), Math.abs(ny - fy) / RC.h(tb));
            nx = fx + Math.sign(nx - fx || 1) * Math.round(RC.w(tb) * s); ny = fy + Math.sign(ny - fy || 1) * Math.round(RC.h(tb) * s);
          }
          const bx = [Math.min(fx, nx), Math.min(fy, ny), Math.max(fx, nx), Math.max(fy, ny)];
          if (RC.w(bx) >= 1 && RC.h(bx) >= 1) U.xf.box = bx;
        } else {
          const F = toWorld({box:b0, angle:U.xf.angle}, [fx, fy]), wx = pt[0] - F[0], wy = pt[1] - F[1];
          let vx = wx*Math.cos(a) + wy*Math.sin(a), vy = -wx*Math.sin(a) + wy*Math.cos(a);
          if (e.shiftKey){ const tb = U.xf.tb, s = Math.max(Math.abs(vx) / RC.w(tb), Math.abs(vy) / RC.h(tb)); vx = Math.sign(vx || 1) * RC.w(tb) * s; vy = Math.sign(vy || 1) * RC.h(tb) * s; }
          const w = Math.round(Math.abs(vx)), h = Math.round(Math.abs(vy));
          if (w >= 1 && h >= 1){
            const c = [F[0] + (vx/2)*Math.cos(a) - (vy/2)*Math.sin(a), F[1] + (vx/2)*Math.sin(a) + (vy/2)*Math.cos(a)];
            const x0 = Math.round(c[0] - w / 2), y0 = Math.round(c[1] - h / 2);
            U.xf.box = [x0, y0, x0 + w, y0 + h];
          }
        }
      }
    }
    UI.draw();
  },
  onUp(e, pt){
    const d = U.drag; U.drag = null;
    if (!d){ UI.draw(); return; }
    if (d.type === 'lasso'){
      const last = d.points[d.points.length-1];
      if (last[0] !== pt[0] || last[1] !== pt[1]) d.points.push(pt.slice());
      K.lassoFinish(d);
      UI.refresh(); return;
    }
    if (d.type === 'corner' || d.type === 'xmove' || d.type === 'rotate'){ UI.draw(); return; }
    const off = [Math.round(pt[0] - d.start[0]), Math.round(pt[1] - d.start[1])];
    if (!off[0] && !off[1]){ UI.draw(); return; }
    if (U.transformOnDrop){
      U.xf = { tb:d.box, box:[d.box[0]+off[0], d.box[1]+off[1], d.box[2]+off[0], d.box[3]+off[1]], angle:0, content:d.content };
      UI.buildOptions('contentmove'); UI.draw(); return;
    }
    commit({ dx:off[0], dy:off[1] });
    UI.refresh();
  },
  onDblClick(){ if (U.xf) xfCommit(); },
  onKey(e){
    if (U.xf && e.key === 'Enter'){ xfCommit(); return true; }
    if (e.key === 'Escape'){
      if (U.xf){ xfCancel(); setStatus(null); return true; }
      if (U.drag){ U.drag = null; UI.draw(); return true; }
    }
    return false;
  },
  onDeactivate(){ if (U.xf) xfCommit(); U.drag = null; U.hover = null; },

  drawOverlay(ctx, s){
    const d = U.drag, dpr = s / UI.zoom;
    if (d && d.type === 'lasso'){ K.drawLassoPath(ctx, s, d.points); return; }
    if (d && d.type === 'move'){
      if (d.off[0] || d.off[1]){
        ctx.save(); ctx.imageSmoothingEnabled = s < 1; ctx.globalAlpha = 0.9;
        ctx.drawImage(d.content, (d.box[0]+d.off[0])*s, (d.box[1]+d.off[1])*s, d.content.width*s, d.content.height*s); ctx.restore();
      }
      K.drawShiftedSel(ctx, s, Doc.sel, d.off[0], d.off[1]);
      return;
    }
    const xf = U.xf; if (!xf) return;
    const bx = xf.box, c = ctrOf(bx), a = (xf.angle || 0) * Math.PI / 180;
    // 在外框局部坐标里画（绕中心转 angle）：内容预览、外框、四角把手
    ctx.save(); ctx.translate(c[0]*s, c[1]*s); ctx.rotate(a); ctx.translate(-c[0]*s, -c[1]*s);
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 0.9;
    ctx.drawImage(xf.content, bx[0]*s, bx[1]*s, RC.w(bx)*s, RC.h(bx)*s); ctx.restore();
    ctx.lineWidth = dpr; ctx.strokeStyle = '#2d8cf0';
    ctx.strokeRect(bx[0]*s + 0.5, bx[1]*s + 0.5, RC.w(bx)*s, RC.h(bx)*s);
    corners(bx).forEach(q => { ctx.fillStyle = '#fff'; ctx.fillRect(q[0]*s - HANDLE*dpr, q[1]*s - HANDLE*dpr, 2*HANDLE*dpr, 2*HANDLE*dpr);
      ctx.strokeRect(q[0]*s - HANDLE*dpr, q[1]*s - HANDLE*dpr, 2*HANDLE*dpr, 2*HANDLE*dpr); });
    ctx.restore();
    // 中心点（旋转参考点）
    ctx.save(); ctx.strokeStyle = '#2d8cf0'; ctx.lineWidth = dpr; ctx.beginPath(); ctx.arc(c[0]*s, c[1]*s, 4*dpr, 0, Math.PI*2); ctx.stroke(); ctx.restore();
  }
});

window.ContentMoveTool = tool;
})();
