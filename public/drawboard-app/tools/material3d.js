/* 3D 材质吸管（PS：I，与吸管同一格）—— 原码没有·照 PS 2020 写
   ArtCraft PhotoCraft 没有 3D（没有 3D 图层、没有材质系统），grep 3D／Material 只有色彩管理与 3D LUT。
   PS 2020 的这颗：在 3D 物件上点一下＝把那一块表面的「材质」（漫射色／纹理、凹凸、光泽…一整组）载进「3D 材质拖放工具」，
   选项栏露出材质挑选器（色块预览＋材质库）。在非 3D 图层上 PS 什么都不做。
   我们没有 3D 图层 ⇒ 在一般图层上做它的「2D 版」：
     · 点一下＝从画面（所有可见图层合成后）取「材质」：
         颜色模式＝取那一点的颜色（1／3×3／5×5 取样，同吸管的 alpha 加权平均）
         图案模式＝以点按处为中心截一块 N×N 的合成画面当无缝贴图（靠画布边就往里挪）
     · 选项栏：材质色块预览、取样模式（颜色／图案）、取样大小、图案大小、材质库下拉（目前的前景色＋「编辑 ▸ 定义图案」的图案库）＋「载入所选」
     · 不改文件、不改前景色、不进历史（PS 的材质吸管也只是把材质交给拖放工具）
   取到的材质放在 window.Material3D.current，tools/drop3d.js（3D 材质拖放）读它来填。
   跟 PS 3D 的差别：材质只有「漫射」一个通道（颜色或贴图），没有凹凸／光泽／反射／不透明度贴图等；取样对象是画面像素、不是网格表面。
   另外做了真的 3D（本档下半「Scene3D」）——3D 图层（网格＋材质＋相机＋光源，软件光栅化）；当前层是 3D 层时：
     点网格＝载入那个表面的整组材质（漫射色／贴图／不透明度／光泽／高光）；在网格上拖＝照选项栏 3D 模式（旋转／滚动／拖动／滑动／缩放）动物件，空处拖＝动相机。
     非 3D 层照旧是上面的 2D 版。 */
(function(){
if (window.Material3D) return;

const STRINGS = {
  'zh-Hant':{'tool.material3d':'3D 材質滴管', 'opt.m3Mode':'取樣：', 'ui.m3Color':'顏色', 'ui.m3Pattern':'圖樣', 'opt.m3Sample':'樣本尺寸：', 'opt.m3Tile':'圖樣大小：',
             'opt.m3Lib':'材質：', 'ui.m3Fg':'目前的前景色', 'ui.m3Load':'載入選取的', 'ui.m3Point':'點狀樣本', 'ui.m3Avg3':'3×3 平均', 'ui.m3Avg5':'5×5 平均',
             'ui.m3Hint':'點一下畫面取材質（給 3D 材質拖移工具用）· 不改圖層'},
  'zh-Hans':{'tool.material3d':'3D 材质吸管', 'opt.m3Mode':'取样：', 'ui.m3Color':'颜色', 'ui.m3Pattern':'图案', 'opt.m3Sample':'取样大小：', 'opt.m3Tile':'图案大小：',
             'opt.m3Lib':'材质：', 'ui.m3Fg':'当前前景色', 'ui.m3Load':'载入所选', 'ui.m3Point':'取样点', 'ui.m3Avg3':'3×3 平均', 'ui.m3Avg5':'5×5 平均',
             'ui.m3Hint':'点一下画面取材质（给 3D 材质拖放工具用）· 不改图层'},
  'en':{'tool.material3d':'3D Material Eyedropper', 'opt.m3Mode':'Sample:', 'ui.m3Color':'Color', 'ui.m3Pattern':'Pattern', 'opt.m3Sample':'Sample Size:', 'opt.m3Tile':'Pattern Size:',
        'opt.m3Lib':'Material:', 'ui.m3Fg':'Current Foreground', 'ui.m3Load':'Load Selected', 'ui.m3Point':'Point Sample', 'ui.m3Avg3':'3 by 3 Average', 'ui.m3Avg5':'5 by 5 Average',
        'ui.m3Hint':'Click the image to pick up a material (for the 3D Material Drop tool) · layers unchanged'}
};
if (typeof Lang !== 'undefined') Lang.add(STRINGS);

const clampI = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
const hex2 = v => clampI(v, 0, 255).toString(16).padStart(2, '0');
/* "#rgb"／"#rrggbb[aa]"／[r,g,b,a](0..1) → [r,g,b,a] 0..255；解析不了回 null */
function parseColor(v){
  if (Array.isArray(v) && v.length >= 3){ const c = v.map(Number); if (!c.slice(0, 3).every(isFinite)) return null; return [c[0] * 255, c[1] * 255, c[2] * 255, (c[3] === undefined ? 1 : c[3]) * 255].map(x => clampI(x, 0, 255)); }
  if (typeof v !== 'string') return null;
  let h = v.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255];
}

const M3 = window.Material3D = {
  current: {kind:'color', rgba:[255, 255, 255, 255], name:'Default'},   // PS 的预设材质「默认」：白色漫射
  opt: {mode:'color', sampleSize:1, tileSize:32, lib:'fg'},
  parseColor,
  /* 材质在文件像素 (X,Y) 的颜色（图案以文件原点对齐、平铺） */
  pixelAt(X, Y, m){
    m = m || this.current;
    if (m.kind === 'pattern'){ const x = ((X % m.w) + m.w) % m.w, y = ((Y % m.h) + m.h) % m.h, i = (y * m.w + x) * 4; return [m.px[i], m.px[i + 1], m.px[i + 2], m.px[i + 3]]; }
    return m.rgba;
  },
  summary(m){
    m = m || this.current;
    return m.kind === 'pattern' ? {kind:'pattern', name:m.name, width:m.w, height:m.h, at:m.at || null}
                                : {kind:'color', name:m.name, rgba:m.rgba.slice(), hex:'#' + m.rgba.slice(0, 3).map(hex2).join('')};
  },
  /* 合成画面（文件坐标，含所有可见图层） */
  compositeData(){ const c = composite(1); return {w:c.width, h:c.height, d:c.getContext('2d', {willReadFrequently:true}).getImageData(0, 0, c.width, c.height).data}; },
  /* 颜色取样：n×n alpha 加权平均（同吸管）；全透明／画布外回 null */
  sampleColor(x, y, n){
    const img = this.compositeData(), X = Math.floor(x), Y = Math.floor(y), r = Math.floor((n || 1) / 2);
    if (X < 0 || Y < 0 || X >= img.w || Y >= img.h) return null;
    let a = 0, cr = 0, cg = 0, cb = 0;
    for (let yy = Y - r; yy <= Y + r; yy++) for (let xx = X - r; xx <= X + r; xx++){
      if (xx < 0 || yy < 0 || xx >= img.w || yy >= img.h) continue;
      const i = (yy * img.w + xx) * 4, al = img.d[i + 3];
      cr += img.d[i] * al; cg += img.d[i + 1] * al; cb += img.d[i + 2] * al; a += al;
    }
    const cnt = (2 * r + 1) * (2 * r + 1);
    if (a <= 0) return null;
    return [cr / a, cg / a, cb / a, a / cnt].map(v => clampI(v, 0, 255));
  },
  /* 图案取样：以 (x,y) 为中心 N×N，靠边就往里挪（文件比 N 小就用整张） */
  samplePattern(x, y, N){
    const img = this.compositeData();
    const w = Math.max(1, Math.min(N, img.w)), h = Math.max(1, Math.min(N, img.h));
    const x0 = clampI(Math.floor(x) - Math.floor(w / 2), 0, img.w - w), y0 = clampI(Math.floor(y) - Math.floor(h / 2), 0, img.h - h);
    if (Math.floor(x) < 0 || Math.floor(y) < 0 || Math.floor(x) >= img.w || Math.floor(y) >= img.h) return null;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let yy = 0; yy < h; yy++) px.set(img.d.subarray(((y0 + yy) * img.w + x0) * 4, ((y0 + yy) * img.w + x0 + w) * 4), yy * w * 4);
    return {kind:'pattern', w, h, px, name:'Sampled ' + w + '×' + h, at:[x0, y0]};
  },
  libItems(){ const P = window.PsEdit && PsEdit.patterns; try { return P ? P.load() : []; } catch(e){ return []; } },
  /* 选项栏的材质色块 */
  swatch(cv){
    const c = cv.getContext('2d'), W = cv.width, H = cv.height, m = this.current;
    c.clearRect(0, 0, W, H);
    if (m.kind === 'pattern'){
      const t = document.createElement('canvas'); t.width = m.w; t.height = m.h;
      t.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.px), m.w, m.h), 0, 0);
      c.fillStyle = c.createPattern(t, 'repeat'); c.fillRect(0, 0, W, H);
    } else { c.fillStyle = `rgba(${m.rgba[0]},${m.rgba[1]},${m.rgba[2]},${m.rgba[3] / 255})`; c.fillRect(0, 0, W, H); }
  },
  refreshUI(){ const s = document.getElementById('m3Swatch'); if (s) this.swatch(s); }
};

/* ═══════════ 命令（都不改文件 ⇒ 不进历史） ═══════════ */
CMD.reg('material3d.sample', {i18n:'tool.material3d',
  params:'{x, y 文件坐标, mode?="color"|"pattern"（缺省＝选项栏的）, sampleSize?=1|3|5（颜色模式）, tileSize?=4..512（图案模式，N×N）} 从合成画面取材质给 3D 材质拖放用（同人点一下）；画布外／全透明回 ok:false → {ok, material:{kind, rgba?, hex?, name, width?, height?}}'},
  p => {
    const x = Number(p.x), y = Number(p.y); if (!isFinite(x) || !isFinite(y)) return {ok:false, error:'x,y required'};
    // 当前层是 3D 图层、点在网格上 ⇒ 载入那个表面的整组材质（PS 3D 材质吸管的本行）
    const L3d = Doc.active();
    if (S3.is3D(L3d)){
      const h = S3.pick(L3d, x, y);
      if (h){ M3.current = S3.currentFromMat((h.mesh.mats || [])[h.surface] || defMat()); M3.refreshUI();
        return {ok:true, material:M3.summary(), mesh:h.mesh.id, surface:h.surfaceName, material3d:clone3(M3.current.m3d)}; }
    }
    const mode = p.mode === 'pattern' || p.mode === 'color' ? p.mode : M3.opt.mode;
    let m = null;
    if (mode === 'pattern') m = M3.samplePattern(x, y, clampI(Number(p.tileSize) || M3.opt.tileSize, 4, 512));
    else { const c = M3.sampleColor(x, y, [1, 3, 5].includes(+p.sampleSize) ? +p.sampleSize : M3.opt.sampleSize); if (c) m = {kind:'color', rgba:c, name:'#' + c.slice(0, 3).map(hex2).join('')}; }
    if (!m) return {ok:false, error:'nothing to sample there (outside the canvas or fully transparent)'};
    M3.current = m; M3.refreshUI();
    return {ok:true, material:M3.summary()};
  });
CMD.reg('material3d.set', {i18n:'',
  params:'{color?:"#rrggbb[aa]"|[r,g,b,a](0..1) | pattern?:图案名或 id（「编辑 ▸ 定义图案」的图案库；""＝第一个）| foreground?:true（＝目前前景色）} 直接指定材质（＝选项栏材质库「载入所选」）→ {ok, material}'},
  p => {
    let m = null;
    if (p.color !== undefined){ const c = parseColor(p.color); if (!c) return {ok:false, error:'bad color'}; m = {kind:'color', rgba:c, name:p.name || ('#' + c.slice(0, 3).map(hex2).join(''))}; }
    else if (p.foreground){ const c = parseColor(window.UI ? UI.fill() : '#000000') || [0, 0, 0, 255]; m = {kind:'color', rgba:c, name:'#' + c.slice(0, 3).map(hex2).join('')}; }
    else if (p.pattern !== undefined){
      const P = window.PsEdit && PsEdit.patterns; const q = P ? P.resolve(String(p.pattern)) : null;
      if (!q) return {ok:false, error:'pattern not found: ' + p.pattern};
      m = {kind:'pattern', w:q.width, h:q.height, px:new Uint8ClampedArray(q.px), name:q.name};
    } else return {ok:false, error:'give color, foreground or pattern'};
    M3.current = m; M3.refreshUI();
    return {ok:true, material:M3.summary()};
  });
CMD.reg('material3d.get', {i18n:'', params:'{} 目前载入的材质 → {material:{kind, rgba?, hex?, name, width?, height?}}'}, () => ({material:M3.summary()}));
CMD.reg('material3d.options', {i18n:'', params:'{mode?:"color"|"pattern", sampleSize?:1|3|5, tileSize?:4..512} 材质吸管选项；{} 只读 → 目前选项'},
  p => {
    const o = M3.opt;
    if (p.mode === 'color' || p.mode === 'pattern') o.mode = p.mode;
    if ([1, 3, 5].includes(+p.sampleSize)) o.sampleSize = +p.sampleSize;
    if (p.tileSize !== undefined && isFinite(+p.tileSize)) o.tileSize = clampI(+p.tileSize, 4, 512);
    if (window.UI && ToolState.cur === 'material3d') UI.buildOptions('material3d');
    return Object.assign({}, o);
  });

/* ═══════════════════════════════════════════════════════════════════════════════════════
   真的 3D 图层（原码没有·照 PS 2020 3D 写）——window.Scene3D
   资料：3D 图层＝一张像素层带 L.d3（进历史：加进 LAYER_EXTRA 深拷；工程档：o.d3＋顶层 d3Textures）：
     L.d3 = { version:1,
       meshes:[{ id, name, preset:"cube|sphere|cylinder|cone|pyramid|donut|plane", size:[宽,高,深](px), pos:[x,y,z], rot:[rx,ry,rz](度), scale:1, visible:true,
                 mats:[每个表面一个材质 {name, diffuse:"#rrggbb", opacity:0..1, shininess:1..200, specular:0..1, texture:贴图 id|null, repeat:[u,v]}] }],
       camera:{ target:[x,y,z], yaw, pitch, roll（度）, distance, fov（度） },
       light:{ dir:[x,y,z]（指向光源）, intensity, ambient },
       selected: 网格 id|null }
     世界坐标：x 右、y 下、z 往画面里；原点投到图层画布中心；预设相机 fov 30°、距离＝焦距 ⇒ z=0 平面上 1 单位＝1 像素。
     贴图（来自图层内容或图案）不可变、放 Scene3D.tex（id → {w,h,px}），历史只记 id（同智能对象来源的做法）。
   画法：canvas 2D 软件光栅化——每个网格照预设生出三角形（含法线、UV、表面编号）→ 世界 → 相机 → 透视投影；
     逐像素：透视校正内插、Z 缓冲、Blinn-Phong（环境＋漫射＋高光，一盏平行光）、贴图（最近点、平铺）；2×2 超取样消锯齿；
     另留一张「点到哪个网格哪个表面」的拾取图（材质吸管／拖放点到的表面）。渲出的像素写进这层画布（3D 层的像素＝渲染结果）。
   操作（PS 3D 模式：旋转／滚动／拖动／滑动／缩放）：在网格上拖＝动物件、空处拖＝动相机；material3d.transform 一下一步历史。 */
const S3 = window.Scene3D = { tex:new Map(), ui:{mode:'orbit'}, _texSeq:0 };
const PRESETS3 = ['cube', 'sphere', 'cylinder', 'cone', 'pyramid', 'donut', 'plane'];
const MODES3 = ['orbit', 'roll', 'pan', 'slide', 'scale'];
const SURF_NAMES = {
  cube:['front', 'back', 'left', 'right', 'top', 'bottom'], sphere:['surface'], cylinder:['side', 'top', 'bottom'], cone:['side', 'base'],
  pyramid:['sides', 'base'], donut:['surface'], plane:['front']
};
const DEG = Math.PI / 180;
const clone3 = o => JSON.parse(JSON.stringify(o));
const hexOf = rgb => '#' + rgb.slice(0, 3).map(hex2).join('');
const rgbOf = h => { const c = parseColor(h) || [200, 200, 200, 255]; return c; };
const defMat = (hex) => ({name:'Default', diffuse:hex || '#c8c8c8', opacity:1, shininess:30, specular:0.25, texture:null, repeat:[1, 1]});
const is3D = L => !!(L && L.kind === 'raster' && L.d3 && Array.isArray(L.d3.meshes));
S3.is3D = is3D;

/* ── 向量小工具 ── */
const V = {
  add:(a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub:(a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul:(a, k) => [a[0] * k, a[1] * k, a[2] * k], dot:(a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len:a => Math.hypot(a[0], a[1], a[2]), norm:a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  rx:(p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; },
  ry:(p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; },
  rz:(p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; },
  /* 绕任意单位轴 k 转 a（Rodrigues） */
  rot:(v, k, a) => { const c = Math.cos(a), s = Math.sin(a), d = V.dot(k, v), x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
    return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)]; }
};
S3.V = V;

/* ── 网格预设（局部坐标，中心在原点；y 往下＝「上面」是 −y） ── */
function genMesh(m){
  const [w, h, d] = m.size, hw = w / 2, hh = h / 2, hd = d / 2, vs = [], ts = [];
  const vert = (p, n, uv) => { vs.push({p, n:V.norm(n), uv}); return vs.length - 1; };
  const quad = (a, b, c, e, n, sf) => { const i = vert(a, n, [0, 0]), j = vert(b, n, [1, 0]), k = vert(c, n, [1, 1]), l = vert(e, n, [0, 1]); ts.push([i, j, k, sf], [i, k, l, sf]); };
  const P = m.preset;
  if (P === 'cube'){
    quad([-hw, -hh, -hd], [hw, -hh, -hd], [hw, hh, -hd], [-hw, hh, -hd], [0, 0, -1], 0);
    quad([hw, -hh, hd], [-hw, -hh, hd], [-hw, hh, hd], [hw, hh, hd], [0, 0, 1], 1);
    quad([-hw, -hh, hd], [-hw, -hh, -hd], [-hw, hh, -hd], [-hw, hh, hd], [-1, 0, 0], 2);
    quad([hw, -hh, -hd], [hw, -hh, hd], [hw, hh, hd], [hw, hh, -hd], [1, 0, 0], 3);
    quad([-hw, -hh, hd], [hw, -hh, hd], [hw, -hh, -hd], [-hw, -hh, -hd], [0, -1, 0], 4);
    quad([-hw, hh, -hd], [hw, hh, -hd], [hw, hh, hd], [-hw, hh, hd], [0, 1, 0], 5);
  } else if (P === 'plane'){
    quad([-hw, -hh, 0], [hw, -hh, 0], [hw, hh, 0], [-hw, hh, 0], [0, 0, -1], 0);
  } else if (P === 'sphere'){
    const NS = 24, NL = 40, idx = [];
    for (let i = 0; i <= NS; i++){ const th = Math.PI * i / NS; idx.push([]);
      for (let j = 0; j <= NL; j++){ const ph = 2 * Math.PI * j / NL - Math.PI / 2;   // φ＝−90° 在正前方（−z）⇒ 贴图中线朝着看的人
        const n = [Math.sin(th) * Math.cos(ph), -Math.cos(th), Math.sin(th) * Math.sin(ph)];
        idx[i].push(vert([n[0] * hw, n[1] * hh, n[2] * hd], [n[0] / (hw || 1), n[1] / (hh || 1), n[2] / (hd || 1)], [j / NL, i / NS])); } }
    for (let i = 0; i < NS; i++) for (let j = 0; j < NL; j++){ const a = idx[i][j], b = idx[i][j + 1], c = idx[i + 1][j + 1], e = idx[i + 1][j]; ts.push([a, b, c, 0], [a, c, e, 0]); }
  } else if (P === 'cylinder' || P === 'cone'){
    const N = 40, cone = P === 'cone', side = [];
    for (let j = 0; j <= N; j++){ const ph = 2 * Math.PI * j / N - Math.PI / 2, cx = Math.cos(ph), cz = Math.sin(ph);
      const n = cone ? [cx * h / (hw || 1), -Math.max(hw, hd) / 1, cz * h / (hd || 1)] : [cx / (hw || 1), 0, cz / (hd || 1)];
      side.push([vert(cone ? [0, -hh, 0] : [cx * hw, -hh, cz * hd], n, [j / N, 0]), vert([cx * hw, hh, cz * hd], n, [j / N, 1])]); }
    for (let j = 0; j < N; j++){ const [a, e] = side[j], [b, c] = side[j + 1]; ts.push([a, b, c, 0], [a, c, e, 0]); }
    const cap = (y, ny, sf) => { const c0 = vert([0, y, 0], [0, ny, 0], [0.5, 0.5]), ring = [];
      for (let j = 0; j <= N; j++){ const ph = 2 * Math.PI * j / N - Math.PI / 2; ring.push(vert([Math.cos(ph) * hw, y, Math.sin(ph) * hd], [0, ny, 0], [0.5 + Math.cos(ph) / 2, 0.5 + Math.sin(ph) / 2])); }
      for (let j = 0; j < N; j++) ts.push([c0, ring[j], ring[j + 1], sf]); };
    if (cone) cap(hh, 1, 1); else { cap(-hh, -1, 1); cap(hh, 1, 2); }
  } else if (P === 'pyramid'){
    const apex = [0, -hh, 0], B = [[-hw, hh, -hd], [hw, hh, -hd], [hw, hh, hd], [-hw, hh, hd]];
    for (let k = 0; k < 4; k++){ const a = B[k], b = B[(k + 1) % 4], mid = V.mul(V.add(a, b), 0.5);
      const n = V.norm([mid[0] * h / ((hw || 1) * (hw || 1)), -1 / 1 * (Math.abs(mid[0]) + Math.abs(mid[2])) / (h || 1), mid[2] * h / ((hd || 1) * (hd || 1))]);
      const i = vert(apex, n, [0.5, 0]), j = vert(b, n, [1, 1]), l = vert(a, n, [0, 1]); ts.push([i, j, l, 0]); }
    quad(B[0], B[1], B[2], B[3], [0, 1, 0], 1);
  } else if (P === 'donut'){
    const NU = 40, NV = 20, R = Math.max(hw, hh) * 0.68, r = Math.max(hw, hh) * 0.32, idx = [];
    for (let i = 0; i <= NU; i++){ const ph = 2 * Math.PI * i / NU; idx.push([]);
      for (let j = 0; j <= NV; j++){ const th = 2 * Math.PI * j / NV;
        const n = [Math.cos(th) * Math.cos(ph), Math.cos(th) * Math.sin(ph), Math.sin(th)];
        idx[i].push(vert([(R + r * Math.cos(th)) * Math.cos(ph) * (hw / Math.max(hw, hh)), (R + r * Math.cos(th)) * Math.sin(ph) * (hh / Math.max(hw, hh)), r * Math.sin(th) * (hd / Math.max(hw, hh))], n, [i / NU, j / NV])); } }
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++){ const a = idx[i][j], b = idx[i + 1][j], c = idx[i + 1][j + 1], e = idx[i][j + 1]; ts.push([a, b, c, 0], [a, c, e, 0]); }
  }
  return {vs, ts};
}
S3.genMesh = genMesh;

/* ── 物件 → 世界：缩放 → Rx → Ry → Rz → 平移 ── */
function toWorldP(m, p){ const r = m.rot || [0, 0, 0]; let q = V.mul(p, m.scale || 1); q = V.rx(q, r[0] * DEG); q = V.ry(q, r[1] * DEG); q = V.rz(q, r[2] * DEG); return V.add(q, m.pos || [0, 0, 0]); }
function toWorldN(m, n){ const r = m.rot || [0, 0, 0]; let q = V.rx(n, r[0] * DEG); q = V.ry(q, r[1] * DEG); q = V.rz(q, r[2] * DEG); return q; }
/* ── 相机：位置与三轴（右、下、前）；f＝焦距（像素） ── */
function camOf(d3, W, H){
  const c = d3.camera, yaw = (c.yaw || 0) * DEG, pitch = (c.pitch || 0) * DEG, roll = (c.roll || 0) * DEG;
  const R = p => V.ry(V.rx(p, pitch), yaw);
  const fwd = V.norm(R([0, 0, 1]));
  let right = R([1, 0, 0]), down = R([0, 1, 0]);
  if (roll){ right = V.rot(right, fwd, roll); down = V.rot(down, fwd, roll); }
  const f = (H / 2) / Math.tan(Math.max(1, Math.min(170, c.fov || 30)) * DEG / 2);
  const dist = c.distance > 1 ? c.distance : f;
  const pos = V.sub(c.target || [0, 0, 0], V.mul(fwd, dist));
  return {pos, fwd, right, down, f, dist, cx:W / 2, cy:H / 2};
}
S3.camOf = camOf;
const toCam = (C, p) => { const q = V.sub(p, C.pos); return [V.dot(q, C.right), V.dot(q, C.down), V.dot(q, C.fwd)]; };
S3.project = (C, p) => { const q = toCam(C, p); return q[2] > 1 ? [C.cx + C.f * q[0] / q[2], C.cy + C.f * q[1] / q[2], q[2]] : null; };

/* ── 渲染：回 {img:ImageData(W×H), pick:Int32Array(W×H)}；ss＝超取样倍数 ── */
function renderScene(d3, W, H, ss){
  ss = ss || 2;
  const SW = W * ss, SH = H * ss, N = SW * SH;
  const col = new Float32Array(N * 4), zb = new Float32Array(N), pk = new Int32Array(N);
  const C = camOf(d3, SW, SH), L = d3.light || {}, Ld = V.norm(L.dir || [-0.45, -0.6, -0.65]);
  const amb = L.ambient === undefined ? 0.3 : L.ambient, inten = L.intensity === undefined ? 0.85 : L.intensity;
  d3.meshes.forEach((m, mi) => {
    if (m.visible === false) return;
    const g = genMesh(m), mats = m.mats || [];
    const P = g.vs.map(v => toWorldP(m, v.p)), Nw = g.vs.map(v => V.norm(toWorldN(m, v.n)));
    const Cq = P.map(p => toCam(C, p));
    const S = Cq.map(q => q[2] > 1 ? [C.cx + C.f * q[0] / q[2], C.cy + C.f * q[1] / q[2]] : null);
    for (const t of g.ts){
      const [i0, i1, i2, sf] = t, s0 = S[i0], s1 = S[i1], s2 = S[i2];
      if (!s0 || !s1 || !s2) continue;                       // 有一点在相机后面（近裁面 z≤1）：整个三角形略过
      const area = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s1[1] - s0[1]) * (s2[0] - s0[0]);
      if (Math.abs(area) < 1e-9) continue;
      const mat = mats[sf] || mats[0] || defMat(), base = rgbOf(mat.diffuse), tex = mat.texture ? S3.tex.get(mat.texture) : null, rep = mat.repeat || [1, 1];
      const op = mat.opacity === undefined ? 1 : mat.opacity, shin = mat.shininess || 30, spec = mat.specular === undefined ? 0.25 : mat.specular;
      const iz = [1 / Cq[i0][2], 1 / Cq[i1][2], 1 / Cq[i2][2]];
      const x0 = Math.max(0, Math.floor(Math.min(s0[0], s1[0], s2[0]))), x1 = Math.min(SW - 1, Math.ceil(Math.max(s0[0], s1[0], s2[0])));
      const y0 = Math.max(0, Math.floor(Math.min(s0[1], s1[1], s2[1]))), y1 = Math.min(SH - 1, Math.ceil(Math.max(s0[1], s1[1], s2[1])));
      const id = mi * 64 + sf + 1;
      for (let y = y0; y <= y1; y++){
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++){
          const px = x + 0.5;
          let b0 = ((s1[0] - px) * (s2[1] - py) - (s1[1] - py) * (s2[0] - px)) / area;
          let b1 = ((s2[0] - px) * (s0[1] - py) - (s2[1] - py) * (s0[0] - px)) / area;
          const b2 = 1 - b0 - b1;
          if (b0 < 0 || b1 < 0 || b2 < 0) continue;
          const w0 = b0 * iz[0], w1 = b1 * iz[1], w2 = b2 * iz[2], wz = w0 + w1 + w2, k = y * SW + x;
          if (wz <= zb[k]) continue;                          // Z 缓冲（存 1/z：越大越近）
          const q0 = w0 / wz, q1 = w1 / wz, q2 = w2 / wz;
          const n0 = Nw[i0], n1 = Nw[i1], n2 = Nw[i2], p0 = P[i0], p1 = P[i1], p2 = P[i2];
          let n = V.norm([n0[0] * q0 + n1[0] * q1 + n2[0] * q2, n0[1] * q0 + n1[1] * q1 + n2[1] * q2, n0[2] * q0 + n1[2] * q1 + n2[2] * q2]);
          const wp = [p0[0] * q0 + p1[0] * q1 + p2[0] * q2, p0[1] * q0 + p1[1] * q1 + p2[1] * q2, p0[2] * q0 + p1[2] * q1 + p2[2] * q2];
          const vv = V.norm(V.sub(C.pos, wp));
          if (V.dot(n, vv) < 0) n = V.mul(n, -1);             // 看到背面（平面的反面）：法线翻过来＝双面
          let r = base[0], gg = base[1], bb = base[2], a = 255 * op;
          if (tex){
            const u0 = g.vs[i0].uv, u1 = g.vs[i1].uv, u2 = g.vs[i2].uv;
            const u = (u0[0] * q0 + u1[0] * q1 + u2[0] * q2) * rep[0], v = (u0[1] * q0 + u1[1] * q1 + u2[1] * q2) * rep[1];
            const tx = ((Math.floor(u * tex.w) % tex.w) + tex.w) % tex.w, ty = ((Math.floor(v * tex.h) % tex.h) + tex.h) % tex.h, ti = (ty * tex.w + tx) * 4;
            r = tex.px[ti]; gg = tex.px[ti + 1]; bb = tex.px[ti + 2]; a = tex.px[ti + 3] * op;
          }
          if (a <= 0) continue;
          const diff = Math.max(0, V.dot(n, Ld)), hv = V.norm(V.add(Ld, vv)), sp = spec * Math.pow(Math.max(0, V.dot(n, hv)), shin) * 255 * inten;
          const lit = amb + inten * diff;
          zb[k] = wz; pk[k] = id;
          col[k * 4] = r * lit + sp; col[k * 4 + 1] = gg * lit + sp; col[k * 4 + 2] = bb * lit + sp; col[k * 4 + 3] = a;
        }
      }
    }
  });
  // 超取样缩回：预乘平均；拾取图取每格中间那个样本
  const img = new ImageData(W, H), d = img.data, pick = new Int32Array(W * H), cnt = ss * ss;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++){ const k = ((y * ss + j) * SW + x * ss + i) * 4, al = col[k + 3]; r += col[k] * al; g += col[k + 1] * al; b += col[k + 2] * al; a += al; }
    const o = (y * W + x) * 4;
    if (a > 0){ d[o] = Math.min(255, r / a); d[o + 1] = Math.min(255, g / a); d[o + 2] = Math.min(255, b / a); d[o + 3] = Math.min(255, a / cnt); }
    pick[y * W + x] = pk[(y * ss + (ss >> 1)) * SW + x * ss + (ss >> 1)];
  }
  return {img, pick};
}
S3.renderScene = renderScene;
/* 把场景渲进这层画布（3D 层的像素＝渲染结果） */
S3.render = function(L){
  if (!is3D(L)) return null;
  const c = L.data.canvas, r = renderScene(L.d3, c.width, c.height, L.d3.ss || 2);
  L.data.ctx.clearRect(0, 0, c.width, c.height); L.data.ctx.putImageData(r.img, 0, 0);
  Layer.invalidate(L); L._d3pick = {pick:r.pick, w:c.width, h:c.height, key:JSON.stringify(L.d3)};
  return r;
};
/* 文件坐标点到哪个网格的哪个表面 → {mesh, meshIndex, surface, surfaceName} | null */
S3.pick = function(L, X, Y){
  if (!is3D(L)) return null;
  const c = L.data.canvas, lx = Math.floor(X - (L.x || 0)), ly = Math.floor(Y - (L.y || 0));
  if (lx < 0 || ly < 0 || lx >= c.width || ly >= c.height) return null;
  let P = L._d3pick;
  if (!P || P.w !== c.width || P.h !== c.height || P.key !== JSON.stringify(L.d3)){ const r = renderScene(L.d3, c.width, c.height, L.d3.ss || 2); P = L._d3pick = {pick:r.pick, w:c.width, h:c.height, key:JSON.stringify(L.d3)}; }
  const v = P.pick[ly * c.width + lx]; if (!v) return null;
  const mi = Math.floor((v - 1) / 64), sf = (v - 1) % 64, m = L.d3.meshes[mi]; if (!m) return null;
  return {mesh:m, meshIndex:mi, surface:sf, surfaceName:(SURF_NAMES[m.preset] || [])[sf] || String(sf)};
};
/* 网格投到文件上的外框（叠画用） */
S3.meshBox = function(L, m){
  const c = L.data.canvas, C = camOf(L.d3, c.width, c.height), g = genMesh(m);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  g.vs.forEach(v => { const s = S3.project(C, toWorldP(m, v.p)); if (!s) return; x0 = Math.min(x0, s[0]); y0 = Math.min(y0, s[1]); x1 = Math.max(x1, s[0]); y1 = Math.max(y1, s[1]); });
  return isFinite(x0) ? [x0 + (L.x || 0), y0 + (L.y || 0), x1 + (L.x || 0), y1 + (L.y || 0)] : null;
};

/* ── 拖曳量 → 改场景（PS 3D 五种模式；物件或相机）。d3 就地改 ── */
function applyDrag(L, d3, tgt, mode, dx, dy){
  const c = L.data.canvas, C = camOf(d3, c.width, c.height);
  if (tgt === 'camera'){
    const cam = d3.camera;
    if (mode === 'orbit'){ cam.yaw = (cam.yaw || 0) - dx * 0.5; cam.pitch = Math.max(-89, Math.min(89, (cam.pitch || 0) + dy * 0.5)); }
    else if (mode === 'roll') cam.roll = (cam.roll || 0) + dx * 0.5;
    else if (mode === 'pan'){ const k = C.dist / C.f; cam.target = V.sub(cam.target || [0, 0, 0], V.add(V.mul(C.right, dx * k), V.mul(C.down, dy * k))); }
    else if (mode === 'slide') cam.distance = Math.max(20, C.dist + dy * (C.dist / C.f) * 2);
    else if (mode === 'scale') cam.fov = Math.max(5, Math.min(120, (cam.fov || 30) * Math.exp(dy * 0.005)));
    return;
  }
  const m = d3.meshes.find(x => x.id === tgt); if (!m) return;
  m.rot = m.rot || [0, 0, 0]; m.pos = m.pos || [0, 0, 0];
  if (mode === 'orbit'){ m.rot[1] -= dx * 0.5; m.rot[0] += dy * 0.5; }
  else if (mode === 'roll') m.rot[2] += dx * 0.5;
  else if (mode === 'pan'){ const z = Math.max(1, toCam(C, m.pos)[2]), k = z / C.f; m.pos = V.add(m.pos, V.add(V.mul(C.right, dx * k), V.mul(C.down, dy * k))); }
  else if (mode === 'slide'){ const z = Math.max(1, toCam(C, m.pos)[2]), k = z / C.f; m.pos = V.add(m.pos, V.mul(C.fwd, dy * k * 2)); }
  else if (mode === 'scale') m.scale = Math.max(0.01, Math.min(100, (m.scale || 1) * Math.exp(-dy * 0.01)));
  m.rot = m.rot.map(a => ((a % 360) + 540) % 360 - 180);
}
S3.applyDrag = applyDrag;

/* ── 贴图登记 ── */
S3.addTexture = function(w, h, px){ const id = 'T' + Date.now().toString(36) + (++S3._texSeq); S3.tex.set(id, {w, h, px:new Uint8ClampedArray(px)}); return id; };
/* Material3D.current（颜色／图案／3D 材质）→ 网格材质 */
function matFromCurrent(m, mesh){
  if (m.m3d) return clone3(m.m3d);
  if (m.kind === 'pattern'){
    if (!m._texId || !S3.tex.has(m._texId)) m._texId = S3.addTexture(m.w, m.h, m.px);
    const sz = mesh ? Math.max(...mesh.size) * (mesh.scale || 1) : 100, rep = Math.max(1, Math.round(sz / Math.max(1, m.w)));
    return {name:m.name || 'Pattern', diffuse:'#ffffff', opacity:1, shininess:30, specular:0.25, texture:m._texId, repeat:[rep, rep]};
  }
  return {name:m.name || hexOf(m.rgba), diffuse:hexOf(m.rgba), opacity:(m.rgba[3] === undefined ? 255 : m.rgba[3]) / 255, shininess:30, specular:0.25, texture:null, repeat:[1, 1]};
}
S3.matFromCurrent = matFromCurrent;
/* 网格材质 → Material3D.current（吸管载入用；带 m3d 让拖放到 3D 表面时整组材质照搬） */
function currentFromMat(mat){
  const t = mat.texture ? S3.tex.get(mat.texture) : null;
  if (t) return {kind:'pattern', w:t.w, h:t.h, px:new Uint8ClampedArray(t.px), name:mat.name || 'Texture', _texId:mat.texture, m3d:clone3(mat)};
  const c = rgbOf(mat.diffuse); c[3] = Math.round((mat.opacity === undefined ? 1 : mat.opacity) * 255);
  return {kind:'color', rgba:c, name:mat.name || hexOf(c), m3d:clone3(mat)};
}
S3.currentFromMat = currentFromMat;

/* ── 历史／工程档：L.d3 进 LAYER_EXTRA（深拷）；贴图存顶层 d3Textures ── */
if (typeof LAYER_EXTRA !== 'undefined' && Array.isArray(LAYER_EXTRA) && !LAYER_EXTRA.includes('d3')) LAYER_EXTRA.push('d3');
if (!Project.__d3Hook){
  Project.__d3Hook = true;
  const ser0 = Project.serialize, load0 = Project.load;
  const texOut = id => { const t = S3.tex.get(id); if (!t) return null; const c = document.createElement('canvas'); c.width = t.w; c.height = t.h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(t.px), t.w, t.h), 0, 0); return {w:t.w, h:t.h, image:c.toDataURL('image/png')}; };
  Project.serialize = function(){
    const j = ser0.apply(this, arguments), used = new Set();
    (j.layers || []).forEach(o => { const L = Doc.byId(o.id); if (!is3D(L)) return; o.d3 = clone3(L.d3); L.d3.meshes.forEach(m => (m.mats || []).forEach(t => { if (t && t.texture) used.add(t.texture); })); });
    if (used.size){ j.d3Textures = {}; used.forEach(id => { const t = texOut(id); if (t) j.d3Textures[id] = t; }); }
    return j;
  };
  Project.load = async function(json){
    const T = json && json.d3Textures;
    if (T) await Promise.all(Object.keys(T).map(id => new Promise(res => {
      if (S3.tex.has(id)) return res();
      const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = T[id].w; c.height = T[id].h; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
        S3.tex.set(id, {w:c.width, h:c.height, px:x.getImageData(0, 0, c.width, c.height).data}); res(); }; im.onerror = () => res(); im.src = T[id].image; })));
    const r = await load0.apply(this, arguments);
    (json && json.layers || []).forEach(o => { if (!o.d3) return; const L = Doc.byId(o.id); if (L && L.kind === 'raster') L.d3 = clone3(o.d3); });
    return r;
  };
}
/* 复制图层带 3D 场景；栅格化 3D 图层＝拿掉 L.d3（像素留着，PS「栅格化 3D」） */
{
  const dup = CMD.map['layer.duplicate'];
  if (dup && !dup._d3){ const run0 = dup.run; dup.run = p => { const src = Doc.byId((p && p.id) || Doc.activeId); const r = run0(p); if (r && r.id && is3D(src)){ const N = Doc.byId(r.id); if (N) N.d3 = clone3(src.d3); } return r; }; dup._d3 = true; }
  const ras = CMD.map['layer.rasterize'];
  if (ras && !ras._d3){ const run0 = ras.run; ras.run = p => { const L = Doc.byId((p && p.id) || Doc.activeId); if (is3D(L)){ delete L.d3; delete L._d3pick; return {ok:true, id:L.id, rasterized3D:true}; } return run0(p); }; ras._d3 = true; }
}

/* ── 命令（命名空间＝material3d；改文件的都 undoable） ── */
const lay3 = p => { const L = p && p.layerId ? Doc.byId(p.layerId) : Doc.active(); return is3D(L) ? L : null; };
const need3 = (p, cmd) => { const L = lay3(p); if (!L) return {err:{ok:false, error:`${cmd}: the layer is not a 3D layer (make one with material3d.newMesh)`}}; const lk = window.Locks ? Locks.blocks(L, 'pixels') : null; if (lk) return {err:Locks.fail(L, lk, cmd)}; return {L}; };
const meshOf = (L, id) => id ? L.d3.meshes.find(m => m.id === id) : (L.d3.meshes.find(m => m.id === L.d3.selected) || L.d3.meshes[L.d3.meshes.length - 1]);
const num3 = v => Array.isArray(v) && v.length === 3 && v.every(x => typeof x === 'number' && isFinite(x));
let meshSeq = 0;

/* 图层内容的外框与像素（新建网格时当贴图） */
function layerContent(L){
  const c = L.data.canvas, W = c.width, H = c.height; if (!W || !H) return null;
  const d = L.data.ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  return {box:[x0, y0, w, h], px:L.data.ctx.getImageData(x0, y0, w, h).data};
}
CMD.reg('material3d.newMesh', {i18n:'tool.material3d', undoable:true,
  params:`{preset:"${PRESETS3.join('|')}"="cube", x?, y?（文件坐标；网格中心落点，缺省＝图层中心／来源内容中心）, size?:px（缺省＝画布短边 40%）, width?, height?, depth?, `
       + 'color?:"#rrggbb"（漫射色；缺省＝目前载入的材质）, fromLayer?:bool（缺省＝当前像素层有内容且不是背景＝把这层转成 3D 层、内容当贴图包在网格上；plane＝PS「从图层新建 3D 明信片」）, '
       + 'newLayer?:bool（true＝一定新开一层；当前层已是 3D 层时缺省＝加进同一个场景）, rotation?:[rx,ry,rz]} '
       + 'PS 3D ▸ 从图层新建网格 ▸ 网格预设：建 3D 图层（网格＋材质＋相机＋光源）并渲染 → {layerId, meshId, surfaces}'}, p => {
  const preset = p.preset === undefined ? 'cube' : p.preset;
  if (!PRESETS3.includes(preset)) return {ok:false, error:`preset must be ${PRESETS3.join('|')}`};
  let L = Doc.active(), add = is3D(L) && p.newLayer !== true, src = null;
  const isBg = X => !!(window.Locks && Locks.isBg ? Locks.isBg(X) : X && X.isBackground);
  if (!add){
    const usable = L && L.kind === 'raster' && !isBg(L) && !is3D(L);
    const content = usable ? layerContent(L) : null;
    const from = p.fromLayer === undefined ? !!content : !!p.fromLayer;
    if (from && !content) return {ok:false, error:'fromLayer: the current layer has no pixels (or is the Background / not a pixel layer)'};
    if (from){ const lk = window.Locks ? Locks.blocks(L, 'pixels') : null; if (lk) return Locks.fail(L, lk, 'material3d.newMesh'); src = content; }
    else { L = Layer.raster(L3('3D 圖層', '3D 图层', '3D Layer') + ' ' + (Doc.layers.filter(is3D).length + 1)); const i = Doc.index(Doc.activeId); Doc.add(L, i < 0 ? Doc.layers.length : i + 1); }
  }
  const c = L.data.canvas, W = c.width, H = c.height;
  if (!add) L.d3 = {version:1, meshes:[], camera:{target:[0, 0, 0], yaw:0, pitch:0, roll:0, distance:0, fov:30}, light:{dir:[-0.45, -0.6, -0.65], intensity:0.85, ambient:0.3}, selected:null, ss:2};
  if (!(L.d3.camera.distance > 1)) L.d3.camera.distance = (H / 2) / Math.tan(15 * DEG);
  const short = Math.min(W, H);
  let sz = typeof p.size === 'number' && p.size > 0 ? p.size : (src ? Math.max(src.box[2], src.box[3]) : Math.round(short * 0.4));
  let w = sz, h = sz, d = sz;
  if (preset === 'plane'){ d = 0; if (src && !(p.size > 0)){ w = src.box[2]; h = src.box[3]; } }
  if (typeof p.width === 'number' && p.width > 0) w = p.width; if (typeof p.height === 'number' && p.height > 0) h = p.height; if (typeof p.depth === 'number' && p.depth >= 0) d = p.depth;
  // 落点：文件坐标 → 图层坐标 → 世界（z＝0 平面，1 单位＝1 像素；相机动过就照相机反推）
  let cxDoc = typeof p.x === 'number' ? p.x : src ? src.box[0] + src.box[2] / 2 + (L.x || 0) : (L.x || 0) + W / 2;
  let cyDoc = typeof p.y === 'number' ? p.y : src ? src.box[1] + src.box[3] / 2 + (L.y || 0) : (L.y || 0) + H / 2;
  const C = camOf(L.d3, W, H), sx = cxDoc - (L.x || 0) - W / 2, sy = cyDoc - (L.y || 0) - H / 2, depth = C.dist;
  const pos = V.add(C.pos, V.add(V.mul(C.fwd, depth), V.add(V.mul(C.right, sx * depth / C.f), V.mul(C.down, sy * depth / C.f))));
  let mat;
  if (typeof p.color === 'string'){ if (!parseColor(p.color)) return {ok:false, error:'bad color'}; mat = defMat(hexOf(parseColor(p.color))); }
  else mat = matFromCurrent(M3.current, null);
  if (src){ const id = S3.addTexture(src.box[2], src.box[3], src.px); mat = Object.assign(defMat('#ffffff'), {name:L3('圖層材質', '图层材质', 'Layer Material'), texture:id, repeat:[1, 1]}); }
  const n = (SURF_NAMES[preset] || ['surface']).length;
  const m = {id:'M' + Date.now().toString(36) + (++meshSeq), name:L3({cube:'立方體', sphere:'球體', cylinder:'圓柱體', cone:'圓錐', pyramid:'金字塔', donut:'圓環', plane:'明信片'}[preset], {cube:'立方体', sphere:'球体', cylinder:'圆柱体', cone:'圆锥', pyramid:'金字塔', donut:'圆环', plane:'明信片'}[preset], {cube:'Cube', sphere:'Sphere', cylinder:'Cylinder', cone:'Cone', pyramid:'Pyramid', donut:'Donut', plane:'Postcard'}[preset]),
    preset, size:[w, h, d], pos, rot:num3(p.rotation) ? p.rotation.slice() : (preset === 'plane' || preset === 'donut' || preset === 'sphere' ? [0, 0, 0] : [-20, 30, 0]), scale:1, visible:true, mats:Array.from({length:n}, () => clone3(mat))};
  L.d3.meshes.push(m); L.d3.selected = m.id;
  if (!add && !L.name.startsWith('3D')) L.name = L.name + ' (3D)';
  Doc.activeId = L.id;
  S3.render(L);
  return {ok:true, layerId:L.id, meshId:m.id, surfaces:SURF_NAMES[preset]};
});
CMD.reg('material3d.transform', {i18n:'', undoable:true,
  params:`{mode:"${MODES3.join('|')}"（PS 3D 模式：旋转／滚动／拖动／滑动／缩放）, dx, dy（滑鼠拖了几个文件像素）, target?:"object"|"camera"="object", meshId?（缺省＝选中的网格）, layerId?} `
       + '照滑鼠拖曳量动网格或相机（物件：旋转 0.5°/px、拖动＝跟着游标平移、滑动＝前后、缩放＝往上拖放大；相机：绕目标转、滚动、平移目标、推近拉远、改视角）→ {mesh?, camera}'}, p => {
  const {L, err} = need3(p, 'material3d.transform'); if (err) return err;
  if (!MODES3.includes(p.mode)) return {ok:false, error:`mode must be ${MODES3.join('|')}`};
  const dx = +p.dx || 0, dy = +p.dy || 0; if (!dx && !dy) return {ok:false, error:'dx/dy are 0'};
  let tgt = 'camera';
  if (p.target !== 'camera'){ const m = meshOf(L, p.meshId); if (!m) return {ok:false, error:'no such mesh'}; tgt = m.id; L.d3.selected = m.id; }
  applyDrag(L, L.d3, tgt, p.mode, dx, dy);
  S3.render(L);
  const m = tgt === 'camera' ? null : L.d3.meshes.find(x => x.id === tgt);
  return {ok:true, mesh:m ? {id:m.id, pos:m.pos.slice(), rot:m.rot.slice(), scale:m.scale} : null, camera:clone3(L.d3.camera)};
});
CMD.reg('material3d.setMesh', {i18n:'', undoable:true, params:'{meshId?, layerId?, position?:[x,y,z], rotation?:[rx,ry,rz]（度）, scale?, size?:[w,h,d], visible?, name?, select?:true} 直接设网格（PS 属性面板「坐标」）→ {mesh}'}, p => {
  const {L, err} = need3(p, 'material3d.setMesh'); if (err) return err;
  const m = meshOf(L, p.meshId); if (!m) return {ok:false, error:'no such mesh'};
  if (p.position !== undefined){ if (!num3(p.position)) return {ok:false, error:'position must be [x,y,z]'}; m.pos = p.position.slice(); }
  if (p.rotation !== undefined){ if (!num3(p.rotation)) return {ok:false, error:'rotation must be [rx,ry,rz]'}; m.rot = p.rotation.slice(); }
  if (p.size !== undefined){ if (!num3(p.size) || p.size.some(v => v < 0)) return {ok:false, error:'size must be [w,h,d] ≥ 0'}; m.size = p.size.slice(); }
  if (p.scale !== undefined){ if (!(+p.scale > 0)) return {ok:false, error:'scale must be > 0'}; m.scale = +p.scale; }
  if (typeof p.visible === 'boolean') m.visible = p.visible;
  if (p.name) m.name = String(p.name);
  L.d3.selected = m.id;
  S3.render(L);
  return {ok:true, mesh:clone3(m)};
});
CMD.reg('material3d.setCamera', {i18n:'', undoable:true, params:'{layerId?, yaw?, pitch?, roll?（度）, distance?, target?:[x,y,z], fov?（度）, reset?:true（回预设视图）} 设 3D 相机（PS 3D 面板「目前视图」）→ {camera}'}, p => {
  const {L, err} = need3(p, 'material3d.setCamera'); if (err) return err;
  const cam = L.d3.camera, H = L.data.canvas.height;
  if (p.reset) Object.assign(cam, {target:[0, 0, 0], yaw:0, pitch:0, roll:0, fov:30, distance:(H / 2) / Math.tan(15 * DEG)});
  ['yaw', 'pitch', 'roll'].forEach(k => { if (typeof p[k] === 'number' && isFinite(p[k])) cam[k] = p[k]; });
  if (typeof p.distance === 'number' && p.distance > 1) cam.distance = p.distance;
  if (typeof p.fov === 'number' && p.fov >= 1 && p.fov <= 170) cam.fov = p.fov;
  if (p.target !== undefined){ if (!num3(p.target)) return {ok:false, error:'target must be [x,y,z]'}; cam.target = p.target.slice(); }
  S3.render(L);
  return {ok:true, camera:clone3(cam)};
});
CMD.reg('material3d.setLight', {i18n:'', undoable:true, params:'{layerId?, dir?:[x,y,z]（指向光源的方向）, intensity?:0..2, ambient?:0..1} 设无限光（PS 3D 预设的无限光）→ {light}'}, p => {
  const {L, err} = need3(p, 'material3d.setLight'); if (err) return err;
  const li = L.d3.light;
  if (p.dir !== undefined){ if (!num3(p.dir) || !V.len(p.dir)) return {ok:false, error:'dir must be a non-zero [x,y,z]'}; li.dir = p.dir.slice(); }
  if (typeof p.intensity === 'number') li.intensity = Math.max(0, Math.min(2, p.intensity));
  if (typeof p.ambient === 'number') li.ambient = Math.max(0, Math.min(1, p.ambient));
  S3.render(L);
  return {ok:true, light:clone3(li)};
});
CMD.reg('material3d.setSurface', {i18n:'', undoable:true,
  params:'{layerId?, meshId?, surface?:编号或名字（front/back/left/right/top/bottom、side/top/bottom、side/base…；缺省＝全部表面）, '
       + 'material?:{color?:"#rrggbb", opacity?:0..1, shininess?:1..200, specular?:0..1, pattern?:图案名或 id, repeat?:[u,v]}（缺省＝目前载入的材质）} 套材质到网格表面（PS 3D 材质拖放落在表面上）→ {mesh, surfaces}'}, p => {
  const {L, err} = need3(p, 'material3d.setSurface'); if (err) return err;
  const m = meshOf(L, p.meshId); if (!m) return {ok:false, error:'no such mesh'};
  const names = SURF_NAMES[m.preset] || ['surface'];
  let idx = names.map((_, i) => i);
  if (p.surface !== undefined && p.surface !== null){ const i = typeof p.surface === 'number' ? p.surface : names.indexOf(String(p.surface)); if (!(i >= 0 && i < names.length)) return {ok:false, error:`surface must be 0..${names.length - 1} or ${names.join('|')}`}; idx = [i]; }
  let mat = matFromCurrent(M3.current, m);
  const q = p.material || {};
  if (q.pattern !== undefined){ const P = window.PsEdit && PsEdit.patterns, r = P ? P.resolve(String(q.pattern)) : null; if (!r) return {ok:false, error:'pattern not found'}; mat = matFromCurrent({kind:'pattern', w:r.width, h:r.height, px:r.px, name:r.name}, m); }
  if (q.color !== undefined){ const c = parseColor(q.color); if (!c) return {ok:false, error:'bad color'}; mat = Object.assign(mat, {diffuse:hexOf(c), texture:null, name:hexOf(c)}); }
  if (typeof q.opacity === 'number') mat.opacity = Math.max(0, Math.min(1, q.opacity));
  if (typeof q.shininess === 'number') mat.shininess = Math.max(1, Math.min(200, q.shininess));
  if (typeof q.specular === 'number') mat.specular = Math.max(0, Math.min(1, q.specular));
  if (Array.isArray(q.repeat) && q.repeat.length === 2 && q.repeat.every(v => v > 0)) mat.repeat = q.repeat.slice();
  m.mats = m.mats || [];
  idx.forEach(i => { m.mats[i] = clone3(mat); });
  L.d3.selected = m.id;
  S3.render(L);
  return {ok:true, mesh:m.id, surfaces:idx.map(i => names[i]), material:clone3(mat)};
});
CMD.reg('material3d.pick', {i18n:'', params:'{x, y（文件坐标）, layerId?} 点到哪个网格哪个表面（不改文件）→ {meshId, surface, surfaceName, material}'}, p => {
  const L = lay3(p); if (!L) return {ok:false, error:'not a 3D layer'};
  const h = S3.pick(L, +p.x, +p.y); if (!h) return {ok:false, error:'no 3D surface there'};
  return {ok:true, meshId:h.mesh.id, surface:h.surface, surfaceName:h.surfaceName, material:clone3((h.mesh.mats || [])[h.surface] || defMat())};
});
CMD.reg('material3d.scene', {i18n:'', params:'{layerId?} 看 3D 场景（网格、表面、材质、相机、光源）→ {meshes, camera, light, selected}'}, p => {
  const L = lay3(p); if (!L) return {ok:false, error:'not a 3D layer'};
  const d = clone3(L.d3); d.meshes.forEach(m => { m.surfaces = SURF_NAMES[m.preset]; });
  return Object.assign({ok:true, layerId:L.id}, d);
});
CMD.reg('material3d.mode', {i18n:'', params:`{mode?:"${MODES3.join('|')}"} 3D 模式（选项栏五颗钮；两颗 3D 工具共用）；{} 只读 → {mode}`}, p => {
  if (p && p.mode !== undefined){ if (!MODES3.includes(p.mode)) return {ok:false, error:`mode must be ${MODES3.join('|')}`}; S3.ui.mode = p.mode; }
  if (window.UI && (ToolState.cur === 'material3d' || ToolState.cur === 'drop3d')) UI.buildOptions(ToolState.cur);
  return {ok:true, mode:S3.ui.mode};
});

/* ── 两颗 3D 工具共用的滑鼠：在 3D 层上按下 → 拖＝3D 模式动物件（按在网格上）或相机（按在空处）；没拖＝点一下（交回工具） ── */
S3.down = function(e, pt){
  const L = Doc.active(); if (!is3D(L)) return false;
  const h = S3.pick(L, pt[0], pt[1]);
  S3.drag = {L, start:pt.slice(), cur:pt.slice(), target:h ? h.mesh.id : 'camera', d3:clone3(L.d3), moved:false, client:[e.clientX, e.clientY]};
  return true;
};
S3.move = function(e, pt){
  const d = S3.drag; if (!d) return false;
  d.cur = pt.slice();
  if (!d.moved && Math.hypot(e.clientX - d.client[0], e.clientY - d.client[1]) > 3) d.moved = true;
  if (d.moved){                                       // 即时预览：从按下时的场景套总拖曳量（不进历史）
    if (window.Locks && Locks.blocks(d.L, 'pixels')) return true;
    const t = clone3(d.d3); applyDrag(d.L, t, d.target, S3.ui.mode, d.cur[0] - d.start[0], d.cur[1] - d.start[1]);
    d.L.d3 = t; S3.render(d.L); UI.draw();
  }
  return true;
};
/* 放开：拖过＝退回按下时的场景、改走 material3d.transform 一步历史；回 'drag'｜'click'｜null */
S3.up = function(e, pt){
  const d = S3.drag; S3.drag = null; if (!d) return null;
  if (!d.moved) return 'click';
  d.L.d3 = d.d3; S3.render(d.L);
  const q = {mode:S3.ui.mode, dx:pt[0] - d.start[0], dy:pt[1] - d.start[1], layerId:d.L.id};
  if (d.target === 'camera') q.target = 'camera'; else q.meshId = d.target;
  const r = CMD.run('material3d.transform', q);
  if (r && r.ok === false && r.error) console.warn(r.error);
  UI.refresh();
  return 'drag';
};
S3.cancel = function(){ const d = S3.drag; S3.drag = null; if (d && d.moved){ d.L.d3 = d.d3; S3.render(d.L); } };
/* 叠画：选中网格的投影外框＋模式字 */
S3.overlay = function(ctx, s){
  const L = Doc.active(); if (!is3D(L)) return;
  const m = L.d3.meshes.find(x => x.id === L.d3.selected); if (!m) return;
  const b = S3.meshBox(L, m); if (!b) return;
  ctx.save(); ctx.strokeStyle = '#2d8cf0'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
  ctx.strokeRect(b[0] * s + 0.5, b[1] * s + 0.5, (b[2] - b[0]) * s, (b[3] - b[1]) * s);
  ctx.setLineDash([]); ctx.fillStyle = '#2d8cf0'; ctx.font = '11px sans-serif'; ctx.textBaseline = 'bottom';
  ctx.fillText(m.name + ' · ' + Lang.t('ui.m3Mode_' + S3.ui.mode), b[0] * s, b[1] * s - 2);
  ctx.restore();
};
/* 选项栏：3D 模式五颗钮＋新建网格（PS 3D 面板「从预设新建网格」） */
S3.buildBar = function(box){
  const sep = () => { const x = document.createElement('span'); x.style.cssText = 'display:inline-block;width:1px;height:18px;background:#555;margin:0 6px;vertical-align:middle'; box.appendChild(x); };
  sep();
  const lab = document.createElement('span'); lab.textContent = Lang.t('opt.m3Mode3d'); lab.style.marginRight = '3px'; box.appendChild(lab);
  [['orbit', '⟳'], ['roll', '↻'], ['pan', '✥'], ['slide', '⇕'], ['scale', '⤢']].forEach(([k, t]) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.title = Lang.t('ui.m3Mode_' + k); b.dataset.opt = 'mode3d-' + k;
    b.style.cssText = 'margin:0 1px;min-width:24px' + (S3.ui.mode === k ? ';background:#2f7fd8;color:#fff' : '');
    b.onclick = () => CMD.run('material3d.mode', {mode:k}); box.appendChild(b);
  });
  sep();
  const ps = document.createElement('select'); ps.dataset.opt = 'newMesh';
  ps.innerHTML = `<option value="">${Lang.t('ui.m3NewMesh')}</option>` + PRESETS3.map(k => `<option value="${k}">${Lang.t('ui.m3Preset_' + k)}</option>`).join('');
  ps.onchange = () => { const v = ps.value; ps.value = ''; if (!v) return; const r = CMD.run('material3d.newMesh', {preset:v}); if (r && r.ok === false) console.warn(r.error); UI.refresh(); };
  box.appendChild(ps);
};
Lang.add({
  'zh-Hant':{'opt.m3Mode3d':'3D 模式：', 'ui.m3Mode_orbit':'環繞 3D 物件', 'ui.m3Mode_roll':'滾動 3D 物件', 'ui.m3Mode_pan':'拖移 3D 物件', 'ui.m3Mode_slide':'滑動 3D 物件', 'ui.m3Mode_scale':'縮放 3D 物件',
    'ui.m3NewMesh':'從預設新增網格…', 'ui.m3Preset_cube':'立方體', 'ui.m3Preset_sphere':'球體', 'ui.m3Preset_cylinder':'圓柱體', 'ui.m3Preset_cone':'圓錐', 'ui.m3Preset_pyramid':'金字塔', 'ui.m3Preset_donut':'圓環', 'ui.m3Preset_plane':'3D 明信片'},
  'zh-Hans':{'opt.m3Mode3d':'3D 模式：', 'ui.m3Mode_orbit':'旋转 3D 对象', 'ui.m3Mode_roll':'滚动 3D 对象', 'ui.m3Mode_pan':'拖动 3D 对象', 'ui.m3Mode_slide':'滑动 3D 对象', 'ui.m3Mode_scale':'缩放 3D 对象',
    'ui.m3NewMesh':'从预设创建网格…', 'ui.m3Preset_cube':'立方体', 'ui.m3Preset_sphere':'球体', 'ui.m3Preset_cylinder':'圆柱体', 'ui.m3Preset_cone':'圆锥', 'ui.m3Preset_pyramid':'金字塔', 'ui.m3Preset_donut':'圆环', 'ui.m3Preset_plane':'3D 明信片'},
  'en':{'opt.m3Mode3d':'3D Mode:', 'ui.m3Mode_orbit':'Orbit the 3D Object', 'ui.m3Mode_roll':'Roll the 3D Object', 'ui.m3Mode_pan':'Drag the 3D Object', 'ui.m3Mode_slide':'Slide the 3D Object', 'ui.m3Mode_scale':'Scale the 3D Object',
    'ui.m3NewMesh':'New Mesh from Preset…', 'ui.m3Preset_cube':'Cube', 'ui.m3Preset_sphere':'Sphere', 'ui.m3Preset_cylinder':'Cylinder', 'ui.m3Preset_cone':'Cone', 'ui.m3Preset_pyramid':'Pyramid', 'ui.m3Preset_donut':'Donut', 'ui.m3Preset_plane':'3D Postcard'}
});
const L3 = (hant, hans, en) => Lang.cur === 'en' ? en : Lang.cur === 'zh-Hans' ? hans : hant;

/* ═══════════ 工具 ═══════════ */
/* 选项栏（照 PS 3D 材质吸管／拖放的材质挑选器）：色块＋材质库下拉＋载入所选｜取样模式｜取样大小｜图案大小 */
function buildMaterialPicker(box, add, mk){
  const sw = document.createElement('canvas'); sw.id = 'm3Swatch'; sw.width = 26; sw.height = 20;
  sw.style.cssText = 'border:1px solid #888;vertical-align:middle;margin-right:4px;background:#fff';
  box.appendChild(sw); M3.swatch(sw);
  const lib = document.createElement('select'); lib.id = 'm3Lib'; lib.dataset.opt = 'lib';
  lib.innerHTML = `<option value="fg">${Lang.t('ui.m3Fg')}</option>` + M3.libItems().map(q => `<option value="pat:${String(q.id).replace(/"/g, '')}">${String(q.name).replace(/</g, '&lt;')}</option>`).join('');
  lib.value = M3.opt.lib; if (lib.value !== M3.opt.lib) lib.value = 'fg';
  lib.onchange = () => { M3.opt.lib = lib.value; };
  add('m3Lib', lib);
  const ld = document.createElement('button'); ld.type = 'button'; ld.dataset.opt = 'load'; ld.textContent = Lang.t('ui.m3Load');
  ld.onclick = () => { const v = lib.value; CMD.run('material3d.set', v === 'fg' ? {foreground:true} : {pattern:v.slice(4)}); };
  box.appendChild(ld);
}
window.Material3DPicker = buildMaterialPicker;

Tools.reg({
  id:'material3d', icon:'💧', group:'raster', order:96, for:'raster', opts:[], cursor:'crosshair',
  strings:STRINGS, hint:'ui.m3Hint',
  buildOptions(box, add, mk){
    buildMaterialPicker(box, add, mk);
    const o = M3.opt;
    const md = document.createElement('select'); md.dataset.opt = 'mode';
    md.innerHTML = `<option value="color">${Lang.t('ui.m3Color')}</option><option value="pattern">${Lang.t('ui.m3Pattern')}</option>`;
    md.value = o.mode; md.onchange = () => CMD.run('material3d.options', {mode:md.value}); add('m3Mode', md);
    const ss = document.createElement('select'); ss.dataset.opt = 'sampleSize';
    ss.innerHTML = `<option value="1">${Lang.t('ui.m3Point')}</option><option value="3">${Lang.t('ui.m3Avg3')}</option><option value="5">${Lang.t('ui.m3Avg5')}</option>`;
    ss.value = String(o.sampleSize); ss.onchange = () => CMD.run('material3d.options', {sampleSize:+ss.value}); add('m3Sample', ss);
    const ts = mk('number', {min:4, max:512, value:o.tileSize}); ts.dataset.opt = 'tileSize'; ts.style.width = '56px';
    ts.onchange = () => CMD.run('material3d.options', {tileSize:+ts.value}); add('m3Tile', ts);
    S3.buildBar(box);
  },
  onDown(e, pt, P){
    if (e.button !== undefined && e.button !== 0) return;
    if (S3.down(e, pt)) return;                     // 3D 层：先看拖不拖（拖＝3D 模式，没拖＝放开时吸材质）
    CMD.run('material3d.sample', {x:pt[0], y:pt[1]});
    P.down = false;
  },
  onMove(e, pt){ S3.move(e, pt); },
  onUp(e, pt){ const r = S3.up(e, pt); if (r === 'click') CMD.run('material3d.sample', {x:pt[0], y:pt[1]}); if (r) UI.draw(); },
  onDeactivate(){ S3.cancel(); },
  drawOverlay(ctx, s){ S3.overlay(ctx, s); }
});
})();
