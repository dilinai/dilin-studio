/* 堤麟画板 · 顶菜单实作 · Illustrator ▸ 视图（命令名 ai.<原码 id>）
   照 ArtCraft VectorCraft 原码逐段翻译：
     ui-egui/src/menus.rs 130-156        视图命令表（id、快捷键、参数）
     ui-egui/src/menus.rs 763-867        flag() 切换（outline pixelPreview trimView edges artboards rulers boundingBox guides smartGuides grid snapTo*）、
                                         view.saved.new 由程式补目前视角、view.goto*、zoomIn/zoomOut（next_zoom）、setZoom、fit*、presentation、screenMode
     ui-egui/src/menus.rs 1110-1171      checked()（勾选状态）  1178-1211 dynamic_label（隐藏／显示 …、轮廓／预览、视图 n 的名字）
     ui-egui/src/menus.rs 2277-2293      新建视图…／编辑视图… 的名称对话框（预设名 View n；编辑＝name／newName／delete）
     ui-egui/src/state.rs 43-57          ZOOM_STOPS／next_zoom（AI 的级距）  126-175 ViewFlags 与出厂预设
     ui-egui/src/canvas.rs 115-141       fit（画板适合窗口／全部适合窗口／实际大小：(区−60)/尺寸，夹 3.13%…64000%）
     ui-egui/src/canvas.rs 143-340       画布：轮廓模式白纸、透明度网格、网格、参考线（整个画布区一条线）、隐藏边缘时不画选取、标尺占 16 点
     ui-egui/src/canvas.rs 633-744       grid()（细分 ≥6 屏幕点才画细格、主线 60/255 黑、细线 22/255 黑）、ruler_label、rulers()（≥50 点一个标号、主／中／小刻度 16／7／4）
     ui-egui/src/theme.rs 116-119        标尺底 #2f2f2f、刻度 #8a8a8a、智能参考线 #ff3dfc、参考线 #4affff
     render/src/lib.rs 936-955, 1178-1188, 1282-1317  轮廓模式：路径＝1 像素黑细线、文字＝字形轮廓细线、图像＝外框细线
     render/src/proof.rs 1-157、color/src/cms/mod.rs 469-542  校样颜色（画面后处理 17³ LUT；旧版 Mac RGB＝gamma 1.8、色盲＝Machado 2009 矩阵）
     engine/src/cmd/views.rs 1-130       view.saved.new／edit／list（最多 25 个，存在文件里、可以 undo）、view.transparencyGrid
     engine/src/cmd/docmenu.rs 303-435   参考线：make／release／lock／clear、guide.add／remove／move（锁住时不能删／移）
     engine/src/cmd/colormgmt.rs 81-100  view.proofSetup／proofColors／overprintPreview
     tools/src/guides.rs 159-185         snap_draw（对齐像素＝取整、对齐网格＝格距/细分）、snap_pick（对齐点或智能参考线开时才吸）
   我们这边的对应：
     ■ 画布叠画（轮廓、像素预览、网格、参考线、校样、白纸）：要换掉 UI.draw 画画面那一次的合成 ⇒ 最后「共用层钩子」段：
       共用层有挂点就只挂接口；还没加就在执行期包住 UI.draw 与 composite（只在画画面那一次换掉）。
     ■ 参考线（标尺参考线）、存下来的视图＝文件资料：放 Doc.aiGuides／Doc.aiViews；过渡钩子把它们接进 History 快照与工程档。
     ■ 只在「AI 模式」（Menubar.app==='ai'＝当前层是矢量层）才画这些东西；像素层（PS 菜单）的视图归 PS 那边处理。 */
(function(){
if (window.AiView && window.AiView.__loaded) return;

/* ═══════════ 状态（state.rs ViewFlags::default；校样 proof.rs ProofView） ═══════════ */
const AiView = window.AiView = {
  __loaded: true,
  flags: {rulers:false, globalRulers:false, grid:false, guides:true, smartGuides:true, outline:false, pixelPreview:false,
          snapToGrid:false, snapToPoint:true, snapToPixel:false, artboards:true, edges:true, trimView:false,
          overprint:false, transparencyGrid:true, gradientAnnotator:true, guidesLocked:false, proofColors:false},
  proof: {target:'workingCmyk'},
  gridSet: {spacing:72, subdivisions:8},               // doc/src/lib.rs:351-357 Grid 预设（72／8）
  newGuide: null,                                      // 从标尺拉出来的新参考线 {vertical, pos}
  guideDrag: null,                                     // 拖曳中的参考线 {index, pos}
  active(){ return window.Menubar ? Menubar.app === 'ai' : ((Doc.active() || {}).kind === 'vector'); },
  guides(){ return Array.isArray(Doc.aiGuides) ? Doc.aiGuides : (Doc.aiGuides = []); },
  views(){ return Array.isArray(Doc.aiViews) ? Doc.aiViews : (Doc.aiViews = []); },
  boundingBox(){ return window.AiSelectTool ? !!AiSelectTool.showBBox : !!(window.MoveTool && MoveTool.opt && MoveTool.opt.showTransform); },   // AI 选择工具（tools/aiselect.js）为准
  rulersShown(){ return this.active() && this.flags.rulers && !(window.Toolbar && Toolbar.screen === 'presentation'); }
};
const RULER = 16;                                       // canvas.rs:14
const GUIDE = '#4affff', SMART = '#ff3dfc';             // theme.rs:118-119
const err = (cmd, m) => ({ok:false, error:`${cmd}: ${m}`});
const run = (id, p) => CMD.map[id] ? CMD.map[id].run(p || {}) : null;   // 选项类命令直接叫（不推历史、不重画两次）
const clone = v => JSON.parse(JSON.stringify(v));
/* flag()：给 on／locked 就设，没给就切换 */
function flag(key, p, pk){
  const v = typeof p[pk || 'on'] === 'boolean' ? p[pk || 'on'] : !AiView.flags[key];
  AiView.flags[key] = v; return v;
}

/* ═══════════ 几何小工具（跟 ai-select 同一套） ═══════════ */
function shapePath(sh, S){                               // 借 engine 的 drawShape 拿路径（画出来的跟叠画的是同一个形状）
  const P = new Path2D();
  const shim = {save(){}, restore(){}, beginPath(){}, fill(){}, stroke(){},
    moveTo:(...a) => P.moveTo(...a), lineTo:(...a) => P.lineTo(...a), closePath:() => P.closePath(),
    rect:(...a) => P.rect(...a), roundRect:(...a) => P.roundRect(...a), ellipse:(...a) => P.ellipse(...a),
    bezierCurveTo:(...a) => P.bezierCurveTo(...a), arc:(...a) => P.arc(...a)};
  drawShape(shim, Object.assign({}, sh, {fill:'none', stroke:'none'}), S);
  return P;
}
function shapeBounds(L, s){
  if (window.AiSel && AiSel.shapeBounds) return AiSel.shapeBounds(L, s);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  if (s.type === 'mesh' && s.mesh) s.mesh.points.forEach(q => add(q.x, q.y));
  else { const g = VecSel.asBezier(s); if (!g || !g.anchors) return null; g.anchors.forEach(a => add(a.x, a.y));
    for (const c of VecSel.segments(g)) for (let i = 1; i < 16; i++){ const q = VecSel.evalCubic(c, i / 16); add(q[0], q[1]); } }
  return isFinite(x0) ? {x0:x0 + L.x, y0:y0 + L.y, x1:x1 + L.x, y1:y1 + L.y} : null;
}
/* Document::art_bounds：看得见的图稿外框（参考线不算） */
function artBounds(){
  let b = null;
  const U = r => { if (!r) return; b = b ? {x0:Math.min(b.x0, r.x0), y0:Math.min(b.y0, r.y0), x1:Math.max(b.x1, r.x1), y1:Math.max(b.y1, r.y1)} : r; };
  for (const L of Doc.layers){
    if (!L.visible) continue;
    if (L.kind === 'vector') L.data.shapes.forEach(s => { if (s.visible !== false && !s.guide) U(shapeBounds(L, s)); });
    else if (L.kind === 'text') U(window.AiSel ? AiSel.textBounds(L) : null);
    else U({x0:L.x, y0:L.y, x1:L.x + L.data.canvas.width, y1:L.y + L.data.canvas.height});
  }
  return b;
}

/* ═══════════ 画面：轮廓／像素预览／白纸／校样（canvas.rs 172-264、render/lib.rs 轮廓模式） ═══════════ */
function drawOutline(ctx, s){
  ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.setLineDash([]);
  for (const L of Doc.layers){
    if (!L.visible) continue;
    ctx.save(); ctx.translate(L.x * s + .5, L.y * s + .5);   // +0.5：落在整数像素上的细线画成实的 1 像素（不糊成两格灰）
    if (L.kind === 'vector'){
      for (const sh of L.data.shapes){
        if (sh.visible === false || sh.guide) continue;
        if (sh.type === 'mesh'){                           // 网格：外框细线（我们的渲染器没有网格的路径）
          const b = shapeBounds({x:0, y:0}, sh); if (b) ctx.strokeRect(b.x0 * s, b.y0 * s, (b.x1 - b.x0) * s, (b.y1 - b.y0) * s);
          continue;
        }
        ctx.stroke(shapePath(sh, s));                      // render/lib.rs:952-955 hairline 黑
      }
    } else if (L.kind === 'text'){                         // render/lib.rs:1180-1188 字形轮廓 1 像素黑
      const d = L.data;
      ctx.font = `${d.weight || 'normal'} ${d.size * s}px ${d.font}`; ctx.textAlign = d.align; ctx.textBaseline = 'alphabetic';
      const lines = (window.TypeTool && TypeTool.wrapLines) ? TypeTool.wrapLines(d) : String(d.text).split('\n');
      lines.forEach((ln, i) => ctx.strokeText(ln, d.x * s, (d.y + i * d.size * 1.25) * s));
    } else {                                               // render/lib.rs:1313-1317 图像外框
      ctx.strokeRect(0, 0, Math.round(L.data.canvas.width * s) - 1, Math.round(L.data.canvas.height * s) - 1);
    }
    ctx.restore();
  }
  ctx.restore();
}
/* 校样（color/src/cms/mod.rs proof_srgb）：一个 sRGB 颜色 → 模拟后的颜色 */
const s2l = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const l2s = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
const PROTANOPIA   = [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]];
const DEUTERANOPIA = [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]];
const cvd = (c, M) => { const l = c.map(s2l); return M.map(r => l2s(Math.min(1, Math.max(0, r[0] * l[0] + r[1] * l[1] + r[2] * l[2])))); };
const PROOF_FN = {
  legacyMacRgb: c => c.map(v => l2s(Math.pow(v, 1.8))),
  protanopia:   c => cvd(c, PROTANOPIA),
  deuteranopia: c => cvd(c, DEUTERANOPIA),
  srgb: null, monitorRgb: null                            // proof.rs:94 这两个不处理
};
const PROOF_TARGETS = ['legacyMacRgb', 'srgb', 'monitorRgb', 'protanopia', 'deuteranopia'];
const _luts = {};
function proofLut(t){                                    // ProofLut::build：17³ 格点
  if (_luts[t]) return _luts[t];
  const N = 17, f = PROOF_FN[t], lut = new Float32Array(N * N * N * 3);
  let k = 0;
  for (let r = 0; r < N; r++) for (let g = 0; g < N; g++) for (let b = 0; b < N; b++){
    const o = f([r / (N - 1), g / (N - 1), b / (N - 1)]); lut[k++] = o[0]; lut[k++] = o[1]; lut[k++] = o[2];
  }
  return (_luts[t] = lut);
}
function applyProof(canvas, t){                          // proof.rs:92-117 post：每个不透明像素查表（三线性内插）
  if (!PROOF_FN[t]) return;
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  const img = ctx.getImageData(0, 0, W, H), d = img.data, lut = proofLut(t), N = 17, M = N - 1;
  const at = (r, g, b, c) => lut[((r * N + g) * N + b) * 3 + c];
  let li = -1, lo = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4){
    if (d[i + 3] === 0) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    if (key !== li){
      li = key;
      const fr = d[i] / 255 * M, fg = d[i + 1] / 255 * M, fb = d[i + 2] / 255 * M;
      const r0 = Math.min(M - 1, Math.floor(fr)), g0 = Math.min(M - 1, Math.floor(fg)), b0 = Math.min(M - 1, Math.floor(fb));
      const dr = fr - r0, dg = fg - g0, db = fb - b0;
      for (let c = 0; c < 3; c++){
        const c00 = at(r0, g0, b0, c) * (1 - db) + at(r0, g0, b0 + 1, c) * db, c01 = at(r0, g0 + 1, b0, c) * (1 - db) + at(r0, g0 + 1, b0 + 1, c) * db;
        const c10 = at(r0 + 1, g0, b0, c) * (1 - db) + at(r0 + 1, g0, b0 + 1, c) * db, c11 = at(r0 + 1, g0 + 1, b0, c) * (1 - db) + at(r0 + 1, g0 + 1, b0 + 1, c) * db;
        lo[c] = Math.round(((c00 * (1 - dg) + c01 * dg) * (1 - dr) + (c10 * (1 - dg) + c11 * dg) * dr) * 255);
      }
    }
    d[i] = lo[0]; d[i + 1] = lo[1]; d[i + 2] = lo[2];
  }
  ctx.putImageData(img, 0, 0);
}

/* 画面用的合成：c0＝原本的 composite；只在 UI.draw 画 #view 那一次被换上 */
AiView.viewComposite = function(c0, s, target){
  const F = this.flags;
  const proof = F.proofColors && PROOF_FN[this.proof.target];
  if (!F.outline && !F.pixelPreview && F.transparencyGrid && !proof) c0(s, target);
  else {
    const W = Math.max(1, Math.round(Doc.width * s)), H = Math.max(1, Math.round(Doc.height * s));
    target.width = W; target.height = H;
    const ctx = target.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    if (F.outline) drawOutline(ctx, s);                    // canvas.rs:190-194 轮廓模式：白画板＋细线
    else {
      const art = F.pixelPreview ? c0(1) : c0(s);          // 像素预览：按 1 文件像素算图，再放大（不插值）
      if (!F.transparencyGrid){ ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); }   // 透明度网格关＝白纸
      ctx.save(); ctx.imageSmoothingEnabled = !F.pixelPreview; ctx.drawImage(art, 0, 0, W, H); ctx.restore();
    }
    if (proof) applyProof(target, this.proof.target);
  }
  this.drawOverlays(target.getContext('2d'), s);
  return target;
};

/* ═══════════ 叠画：网格、参考线、文字物件选取框、选取（没画选取的工具） ═══════════ */
const VSEL_TOOLS = ['addanchor', 'anchorpoint', 'delanchor', 'direct', 'lasso', 'line', 'pen', 'rotate', 'scale', 'scissors', 'wand'];
AiView.drawGrid = function(ctx, s){                      // canvas.rs:633-656 grid()
  const sp = this.gridSet.spacing, sub = sp / Math.max(1, this.gridSet.subdivisions), z = UI.zoom;
  const step = sub * z >= 6 ? sub : sp;
  if (step * z < 4) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.save(); ctx.lineWidth = 1;
  const line = (major, vert, v) => {
    ctx.strokeStyle = `rgba(0,0,0,${(major ? 60 : 22) / 255})`; ctx.beginPath();
    const p = Math.round(v * s) + .5;
    if (vert){ ctx.moveTo(p, 0); ctx.lineTo(p, H); } else { ctx.moveTo(0, p); ctx.lineTo(W, p); }
    ctx.stroke();
  };
  const isMajor = v => Math.abs(v / sp - Math.round(v / sp)) < 1e-6;
  for (let i = 0; i * step <= Doc.width; i++) line(isMajor(i * step), true, i * step);
  for (let i = 0; i * step <= Doc.height; i++) line(isMajor(i * step), false, i * step);
  ctx.restore();
};
AiView.drawGuides = function(ctx, s){                    // canvas.rs:296-307 参考线＋参考线路径
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = GUIDE; ctx.setLineDash([]);
  this.guides().forEach((g, i) => {
    const pos = (this.guideDrag && this.guideDrag.index === i) ? this.guideDrag.pos : g.pos;
    const p = Math.round(pos * s) + .5; ctx.beginPath();
    if (g.vertical){ ctx.moveTo(p, 0); ctx.lineTo(p, H); } else { ctx.moveTo(0, p); ctx.lineTo(W, p); }
    ctx.stroke();
  });
  for (const L of Doc.layers){
    if (L.kind !== 'vector' || !L.visible) continue;
    for (const sh of L.data.shapes){
      if (!sh.guide || sh.visible === false) continue;
      ctx.save(); ctx.translate(L.x * s + .5, L.y * s + .5); ctx.stroke(shapePath(sh, s)); ctx.restore();
    }
  }
  ctx.restore();
};
AiView.drawOverlays = function(ctx, s){
  const F = this.flags;
  if (F.grid) this.drawGrid(ctx, s);
  if (F.guides) this.drawGuides(ctx, s);
  const ng = this.newGuide;                              // 从标尺拉出来、还没放的那一条
  if (ng && ng.pos !== null){
    ctx.save(); ctx.strokeStyle = GUIDE; ctx.lineWidth = 1; ctx.beginPath();
    const p = Math.round(ng.pos * s) + .5;
    if (ng.vertical){ ctx.moveTo(p, 0); ctx.lineTo(p, ctx.canvas.height); } else { ctx.moveTo(0, p); ctx.lineTo(ctx.canvas.width, p); }
    ctx.stroke(); ctx.restore();
  }
  if (F.edges){                                          // canvas.rs:317-326 隐藏边缘＝不画选取
    if (window.AiSel) AiSel.drawOverlay(ctx, s);
    // 没画选取的工具（选择／移动…）的锚点改在 AiView.drawVecSel 画（UI.overlays 叠画层）：画进合成图的话，换工具沿用旧合成时会不见
  }
};
/* 没画选取的工具也看得到选中物件的锚点（AI 选取一直看得到）——每次 draw 都画，含悬停／换工具沿用合成那种 */
AiView.drawVecSel = function(ctx, s){
  if (!this.active() || !this.flags.edges || VSEL_TOOLS.includes(ToolState.cur)) return;
  const T = window.Tools && Tools.current();
  if (T && T.drawOverlay && /VecSel\.drawOverlay/.test(String(T.drawOverlay))) return;   // 工具自己画了
  if (window.VecSel && !VecSel.isEmpty()) VecSel.drawOverlay(ctx, s);
};

/* ═══════════ 标尺（canvas.rs:658-744）：#canvasWrap 里上、左各一条 16 点的画布 ═══════════ */
function rulerLabel(v, step){
  const dec = step >= 1 ? 0 : Math.ceil(-Math.log10(step));
  const t = v.toFixed(dec);
  return /^-?[0.]*$/.test(t) ? '0' : t;
}
AiView.ensureRulers = function(){
  const wrap = document.getElementById('canvasWrap'); if (!wrap) return null;
  let top = document.getElementById('aiRulerTop');
  if (!top){
    top = document.createElement('canvas'); top.id = 'aiRulerTop'; top.className = 'airuler';
    const left = document.createElement('canvas'); left.id = 'aiRulerLeft'; left.className = 'airuler';
    const corner = document.createElement('div'); corner.id = 'aiRulerCorner'; corner.className = 'airuler';
    wrap.appendChild(top); wrap.appendChild(left); wrap.appendChild(corner);
    [[top, false], [left, true]].forEach(([el, vertical]) => el.addEventListener('pointerdown', e => Rulers.down(e, vertical)));
  }
  return {wrap, top, left:document.getElementById('aiRulerLeft'), corner:document.getElementById('aiRulerCorner')};
};
AiView.drawRulers = function(){
  const shown = this.rulersShown();
  const R = shown ? this.ensureRulers() : null;
  document.body.classList.toggle('ai-rulers', !!R);
  if (!R) return;
  const view = document.getElementById('view'), b = view.getBoundingClientRect(), wr = R.wrap.getBoundingClientRect();
  const z = UI.zoom, dpr = Math.min(window.devicePixelRatio || 1, 2);
  const hover = (window.Pointer && Pointer.hover) || null;
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const step = steps.find(v => v * z >= 50) || 10000, minor = step / 10;
  const near = (x, k) => Math.abs(Math.round(x / k) * k - x) < minor * 0.01;
  const paint = (cv, vertical) => {
    const w = vertical ? RULER : Math.max(1, wr.width - RULER), h = vertical ? Math.max(1, wr.height - RULER) : RULER;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#2f2f2f'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#1b1b1b'; c.lineWidth = 1; c.beginPath();
    if (vertical){ c.moveTo(w - .5, 0); c.lineTo(w - .5, h); } else { c.moveTo(0, h - .5); c.lineTo(w, h - .5); }
    c.stroke();
    c.strokeStyle = c.fillStyle = '#8a8a8a'; c.font = '9.5px sans-serif'; c.textBaseline = 'top';
    // 文件坐标 v 落在这条标尺的哪个位置（以标尺自己左上为原点）
    const org = vertical ? (b.top - (wr.top + RULER)) : (b.left - (wr.left + RULER));
    const len = vertical ? h : w;
    const a = (0 - org) / z, e = (len - org) / z;
    for (let i = Math.floor(a / minor); i * minor <= e; i++){
      const v = i * minor, sp = Math.round(org + v * z) + .5;
      const major = near(v, step), mid = near(v, step / 2);
      const tl = major ? RULER : mid ? 7 : 4;
      c.beginPath();
      if (vertical){ c.moveTo(w - tl, sp); c.lineTo(w, sp); } else { c.moveTo(sp, h - tl); c.lineTo(sp, h); }
      c.stroke();
      if (major){
        const t = rulerLabel(v, step);
        if (vertical) Array.from(t).forEach((ch, k) => c.fillText(ch, 4, sp + 2 + k * 8.5));   // 纵向标号一个字一行（canvas.rs:725-735）
        else c.fillText(t, sp + 2, 1);
      }
    }
    if (hover){                                           // 游标所在位置的细线（canvas.rs:739-743）
      const sp = Math.round(org + (vertical ? hover[1] : hover[0]) * z) + .5;
      c.strokeStyle = '#e6e6e6'; c.beginPath();
      if (vertical){ c.moveTo(0, sp); c.lineTo(w, sp); } else { c.moveTo(sp, 0); c.lineTo(sp, h); }
      c.stroke();
    }
  };
  paint(R.top, false); paint(R.left, true);
  this._rulerKey = [b.left, b.top, b.width, b.height, wr.width, wr.height, z].join(',');
};
/* 抓手平移只改 CSS 不重画 ⇒ 标尺开着时每帧量一下画布位置，变了就重画标尺 */
(function watch(){
  requestAnimationFrame(watch);
  if (!AiView.flags.rulers || !window.UI || !document.getElementById('aiRulerTop')) return;
  const v = document.getElementById('view'), w = document.getElementById('canvasWrap'); if (!v || !w) return;
  const b = v.getBoundingClientRect(), wr = w.getBoundingClientRect();
  const k = [b.left, b.top, b.width, b.height, wr.width, wr.height, UI.zoom].join(',');
  if (k !== AiView._rulerKey && AiView.rulersShown()) AiView.drawRulers();
})();

/* 画面点 → 文件点（跟 ui.js toDoc 同一套） */
const toDoc = (cx, cy) => { const b = document.getElementById('view').getBoundingClientRect(); return [(cx - b.left) / UI.zoom, (cy - b.top) / UI.zoom]; };
const overRuler = (cx, cy) => {
  if (!AiView.rulersShown()) return false;
  const wr = document.getElementById('canvasWrap').getBoundingClientRect();
  return cx < wr.left + RULER || cy < wr.top + RULER;
};
/* 从标尺拉参考线（AI：上标尺拉出水平线、左标尺拉出垂直线；放在标尺外才算数）＝ ai.guide.add */
const Rulers = {
  down(e, vertical){
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    AiView.newGuide = {vertical, pos:null};
    const mv = ev => { const d = toDoc(ev.clientX, ev.clientY); AiView.newGuide.pos = vertical ? d[0] : d[1]; UI.draw(); };
    const up = ev => {
      window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true);
      const g = AiView.newGuide; AiView.newGuide = null;
      if (g && g.pos !== null && !overRuler(ev.clientX, ev.clientY)) CMD.run('ai.guide.add', {vertical, pos:g.pos});
      else UI.draw();
    };
    window.addEventListener('pointermove', mv, true); window.addEventListener('pointerup', up, true);
  }
};
/* 用选择工具拖现有的参考线（锁住时不行）；拖回标尺上＝删掉（＝ ai.guide.move／ai.guide.remove） */
function guideAt(cx, cy){
  const b = document.getElementById('view').getBoundingClientRect();
  if (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) return -1;
  const d = toDoc(cx, cy), tol = 3 / UI.zoom;
  let best = -1, bd = Infinity;
  AiView.guides().forEach((g, i) => { const dd = Math.abs((g.vertical ? d[0] : d[1]) - g.pos); if (dd <= tol && dd < bd){ bd = dd; best = i; } });
  return best;
}
function guideGrab(e){
  if (e.button !== 0 || !AiView.active() || !AiView.flags.guides || AiView.flags.guidesLocked) return;
  if (!['move', 'direct'].includes(ToolState.cur) || e.target.id !== 'view') return;
  const i = guideAt(e.clientX, e.clientY); if (i < 0) return;
  e.preventDefault(); e.stopPropagation();
  const g = AiView.guides()[i], x0 = e.clientX, y0 = e.clientY;
  AiView.guideDrag = {index:i, pos:g.pos};
  const mv = ev => { const d = toDoc(ev.clientX, ev.clientY); AiView.guideDrag.pos = g.vertical ? d[0] : d[1]; UI.draw(); };
  const up = ev => {
    window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true);
    const pos = AiView.guideDrag.pos; AiView.guideDrag = null;
    if (overRuler(ev.clientX, ev.clientY)) CMD.run('ai.guide.remove', {index:i});
    else if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 0) CMD.run('ai.guide.move', {index:i, pos});
    else UI.draw();
  };
  window.addEventListener('pointermove', mv, true); window.addEventListener('pointerup', up, true);
}

/* ═══════════ 命令：开关（menus.rs 763-820 flag） ═══════════ */
const TOG = [
  ['outline',          'outline',           '轮廓／预览：图稿只画 1 像素黑细线（路径、文字字形轮廓、图像外框），画板白底'],
  ['overprintPreview', 'overprint',         '叠印预览（我们的物件没有「叠印」属性 ⇒ 画面不变；状态给 agent 读）'],
  ['pixelPreview',     'pixelPreview',      '像素预览：按 1 文件像素算图再不插值放大'],
  ['trimView',         'trimView',          '裁切视图：隐藏画板外的东西（我们的画布本来就只画画板范围）'],
  ['edges',            'edges',             '隐藏／显示边缘：关掉就不画选中物件的路径、锚点与文字物件框'],
  ['artboards',        'artboards',         '隐藏／显示画板：关掉画板的阴影外框与底'],
  ['rulers',           'rulers',            '显示／隐藏标尺：画布区上、左各一条 16 点的标尺（像素刻度、游标细线、从标尺拉参考线）'],
  ['rulers.global',    'globalRulers',      '更改为全局标尺／画板标尺（原码 todo；我们只有一个画板、原点都在左上 ⇒ 刻度相同）'],
  ['transparencyGrid', 'transparencyGrid',  '显示／隐藏透明度网格：关掉＝透明处画白纸（我们预设开，跟原本画布一样）'],
  ['gradientAnnotator','gradientAnnotator', '隐藏／显示渐变批注者：关掉＝渐变工具不画控制条'],
  ['guides',           'guides',            '隐藏／显示参考线'],
  ['grid',             'grid',              '显示／隐藏网格：每 72 像素一条主线、8 细分（细格 ≥6 屏幕像素才画）'],
  ['snapToGrid',       'snapToGrid',        '对齐网格：画形状、钢笔、直线、渐变时落点吸到 9 像素细格'],
  ['snapToPixel',      'snapToPixel',       '对齐像素：画形状等落点取整（优先于对齐网格）']
];
TOG.forEach(([id, key, desc]) => {
  CMD.reg('ai.view.' + id, {i18n:'', params:`{on?: bool（缺省＝切换）} 视图 ▸ ${desc} → {ok, on}`}, p => ({ok:true, on:flag(key, p)}));
});
/* 智能参考线／对齐点：VectorCraft 是 ToolContext 一个栏位给所有工具；我们各工具各存一份 ⇒ 切换时推给它们 */
function pushSnap(){
  const on = AiView.flags.smartGuides, pick = AiView.flags.snapToPoint || on;   // guides.rs:177 snap_pick：对齐点或智能参考线
  if (window.ToolState) ToolState.smartGuides = on;                              // 椭圆、直线
  if (window.RectTool) RectTool.smartGuides = on;
  run('move.options', {smartGuides:on}); run('gradient.options', {smartGuides:on});
  run('rotate.options', {snap:pick}); run('scale.options', {snap:pick});
}
CMD.reg('ai.view.smartGuides', {i18n:'', params:'{on?: bool} 视图 ▸ 智能参考线：开关所有工具的智能参考线吸附（矩形、椭圆、直线、选择、渐变；旋转／比例缩放的参考点吸附＝对齐点或智能参考线）→ {ok, on}'},
  p => { const v = flag('smartGuides', p); pushSnap(); return {ok:true, on:v}; });
CMD.reg('ai.view.snapToPoint', {i18n:'', params:'{on?: bool} 视图 ▸ 对齐点：旋转／比例缩放点参考点时吸到锚点或中心（智能参考线开着也会吸）→ {ok, on}'},
  p => { const v = flag('snapToPoint', p); pushSnap(); return {ok:true, on:v}; });
CMD.reg('ai.view.boundingBox', {i18n:'', params:'{on?: bool} 视图 ▸ 隐藏／显示定界框（Shift+Ctrl+B）：选择工具的定界框与把手（隐藏时不能拖把手缩放／旋转，仍可拖移）；移动工具的变换控制框跟着 → {ok, on}'}, p => {
  const v = typeof p.on === 'boolean' ? p.on : !AiView.boundingBox();
  if (window.AiSelectTool){ AiSelectTool.showBBox = v; if (window.UI && UI.ctx) UI.draw(); }
  run('move.options', {showTransform:v});
  return {ok:true, on:AiView.boundingBox()};
});

/* ═══════════ 屏幕模式（menus.rs 851-861）：0 正常、1 带菜单栏全屏、2 全屏、3 演示文稿 ═══════════ */
const SCREENS = ['standard', 'fullmenu', 'full', 'presentation'];
const curScreen = () => Math.max(0, SCREENS.indexOf(window.Toolbar ? Toolbar.screen : 'standard'));
CMD.reg('ai.view.screenMode', {i18n:'', params:'{mode?: 0 正常屏幕模式 | 1 带有菜单栏的全屏模式 | 2 全屏模式 | 3 演示文稿模式（缺省＝在 0..2 之间轮换）} 视图 ▸ 屏幕模式 → {ok, mode}'}, p => {
  const m = typeof p.mode === 'number' ? Math.min(3, Math.max(0, p.mode | 0)) : (curScreen() + 1) % 3;
  if (window.Toolbar) Toolbar.screenMode(SCREENS[m]);
  return {ok:true, mode:m};
});
CMD.reg('ai.view.presentation', {i18n:'', params:'{} 视图 ▸ 演示文稿模式（再按一次回正常屏幕模式）→ {ok, mode}'}, () => {
  const m = curScreen() === 3 ? 0 : 3;
  if (window.Toolbar) Toolbar.screenMode(SCREENS[m]);
  return {ok:true, mode:m};
});

/* ═══════════ 校样（colormgmt.rs 81-100） ═══════════ */
CMD.reg('ai.view.proofSetup', {i18n:'', params:'{target?: "legacyMacRgb"|"srgb"|"monitorRgb"|"protanopia"|"deuteranopia"（工作中的 CMYK 我们没有色彩描述档）, proof?: bool（顺便打开校样颜色）} 视图 ▸ 校样设置 → {ok, target, proofColors}'}, p => {
  if (p.target !== undefined){
    if (!PROOF_TARGETS.includes(p.target)) return err('ai.view.proofSetup', `unsupported target \`${p.target}\``);
    AiView.proof.target = p.target;
  }
  if (p.proof === true) AiView.flags.proofColors = true;
  return {ok:true, target:AiView.proof.target, proofColors:AiView.flags.proofColors};
});
CMD.reg('ai.view.proofColors', {i18n:'', params:'{on?: bool} 视图 ▸ 校样颜色：画面按校样设置模拟（旧版 Mac RGB＝gamma 1.8、红／绿色盲）→ {ok, on, target}'}, p => {
  const v = flag('proofColors', p);
  return {ok:true, on:v, target:AiView.proof.target};
});

/* ═══════════ 缩放（state.rs 43-57、canvas.rs 115-141、menus.rs 821-850） ═══════════ */
const ZOOM_STOPS = [3.13, 4.17, 6.25, 8.33, 12.5, 16.67, 25, 33.33, 50, 66.67, 100, 150, 200, 300, 400, 600, 800, 1200, 1600, 2400, 3200, 4800, 6400, 12800, 25600, 64000];
function nextZoom(z, up){
  const pct = z * 100;
  const s = up ? (ZOOM_STOPS.find(v => v > pct + 0.01) || 64000) : ([...ZOOM_STOPS].reverse().find(v => v < pct - 0.01) || 3.13);
  return s / 100;
}
const zclamp = z => Math.min(640, Math.max(0.0313, z));
/* 画布区（canvas_rect）：#canvasWrap 扣掉标尺 */
function canvasRect(){
  const r = document.getElementById('canvasWrap').getBoundingClientRect(), k = AiView.rulersShown() ? RULER : 0;
  return {left:r.left + k, top:r.top + k, width:r.width - k, height:r.height - k};
}
/* 画布区正中对着的文件点（原码的 view.center） */
function viewCenterDoc(){ const r = canvasRect(); return toDoc(r.left + r.width / 2, r.top + r.height / 2); }
/* 设视角：zoom 与「画布区正中对着的文件点」 */
function setView(zoom, center){
  const r = canvasRect(), c = center || viewCenterDoc();
  if (window.ZoomView) ZoomView.anchorView([r.left + r.width / 2, r.top + r.height / 2], c, zoom);
  else UI.setZoom(zoom);
  return {ok:true, zoom:UI.zoom * 100, center:viewCenterDoc()};
}
CMD.reg('ai.view.zoomIn',  {i18n:'', params:'{} 放大一级（AI 级距 …66.67%、100%、150%、200%…；中心不动）→ {ok, zoom（百分比）}'}, () => setView(nextZoom(UI.zoom, true)));
CMD.reg('ai.view.zoomOut', {i18n:'', params:'{} 缩小一级（AI 级距）→ {ok, zoom}'}, () => setView(nextZoom(UI.zoom, false)));
CMD.reg('ai.view.setZoom', {i18n:'', params:'{zoom: 百分比（100＝实际大小）, center?: [x,y] 文件坐标} 直接设缩放与中心 → {ok, zoom, center}'},
  p => setView(zclamp((typeof p.zoom === 'number' ? p.zoom : 100) / 100), Array.isArray(p.center) ? [+p.center[0] || 0, +p.center[1] || 0] : null));
function fit(how){
  const ab = {x0:0, y0:0, x1:Doc.width, y1:Doc.height};
  let t = ab;
  if (how === 'all'){ const a = artBounds(); if (a) t = {x0:Math.min(a.x0, 0), y0:Math.min(a.y0, 0), x1:Math.max(a.x1, Doc.width), y1:Math.max(a.y1, Doc.height)}; }
  const c = [(t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2];
  if (how === 'actual') return setView(1, c);
  const r = canvasRect();
  const z = Math.min((r.width - 60) / Math.max(1, t.x1 - t.x0), (r.height - 60) / Math.max(1, t.y1 - t.y0));
  return setView(zclamp(z), c);
}
CMD.reg('ai.view.fitArtboard', {i18n:'', params:'{} 视图 ▸ 画板适合窗口大小：缩放＝(画布区−60)/画板，画板置中（不像 PS 夹在 100%）→ {ok, zoom, center}'}, () => fit('artboard'));
CMD.reg('ai.view.fitAll', {i18n:'', params:'{} 视图 ▸ 全部适合窗口大小：画板＋所有看得见的图稿外框一起放进画布区 → {ok, zoom, center}'}, () => fit('all'));
CMD.reg('ai.view.actualSize', {i18n:'', params:'{} 视图 ▸ 实际大小：100% 并把画板置中 → {ok, zoom, center}'}, () => fit('actual'));

/* ═══════════ 参考线（docmenu.rs 303-435） ═══════════ */
const lockedErr = cmd => AiView.flags.guidesLocked ? err(cmd, 'guides are locked') : null;
CMD.reg('ai.view.guides.lock', {i18n:'', params:'{locked?: bool（缺省＝切换）} 视图 ▸ 参考线 ▸ 锁定／解锁参考线（锁住后不能拖、删、移）→ {ok, locked}'},
  p => ({ok:true, locked:flag('guidesLocked', p, 'locked')}));
CMD.reg('ai.guide.add', {i18n:'', undoable:true, params:'{vertical: bool, pos: 文件坐标（垂直线＝x、水平线＝y）} 新增一条标尺参考线 → {ok, index}'}, p => {
  const pos = Number(p.pos); if (!isFinite(pos)) return err('ai.guide.add', 'missing pos');
  AiView.guides().push({vertical:!!p.vertical, pos});
  return {ok:true, index:AiView.guides().length - 1};
});
CMD.reg('ai.guide.remove', {i18n:'', undoable:true, params:'{index} 删一条标尺参考线（锁住时不行）'}, p => {
  const e = lockedErr('ai.guide.remove'); if (e) return e;
  const i = +p.index; if (!(i >= 0 && i < AiView.guides().length)) return err('ai.guide.remove', 'no such guide');
  AiView.guides().splice(i, 1); return {ok:true};
});
CMD.reg('ai.guide.move', {i18n:'', undoable:true, params:'{index, pos} 移一条标尺参考线（锁住时不行）'}, p => {
  const e = lockedErr('ai.guide.move'); if (e) return e;
  const i = +p.index; if (!(i >= 0 && i < AiView.guides().length)) return err('ai.guide.move', 'no such guide');
  const pos = Number(p.pos); if (!isFinite(pos)) return err('ai.guide.move', 'missing pos');
  AiView.guides()[i].pos = pos; return {ok:true};
});
CMD.reg('ai.guide.list', {i18n:'', params:'{} → {ok, guides:[{vertical,pos}], guidePaths:[{layerId, id}], locked, visible}'}, () => {
  const paths = [];
  Doc.layers.forEach(L => { if (L.kind === 'vector') L.data.shapes.forEach(s => { if (s.guide) paths.push({layerId:L.id, id:s.id}); }); });
  return {ok:true, guides:clone(AiView.guides()), guidePaths:paths, locked:AiView.flags.guidesLocked, visible:AiView.flags.guides};
});
/* 参考线路径：原码是路径上的 guide 旗标、渲染器跳过它。我们的 engine.js 不认这个旗标 ⇒ 把外观收进 s.guide、填色描边设成 none，
   画面上由上面的 drawGuides 用参考线颜色画；释放时外观原样放回。（engine.js 的 drawShape 若认 s.guide，就可以不用收外观） */
function toGuide(L, s){
  if (s.guide || s.type === 'mesh') return false;
  s.guide = {fill:s.fill === undefined ? null : s.fill, stroke:s.stroke === undefined ? null : s.stroke, strokeWidth:s.strokeWidth === undefined ? null : s.strokeWidth};
  s.fill = 'none'; s.stroke = 'none'; Layer.invalidate(L); return true;
}
function fromGuide(L, s){
  const g = s.guide; if (!g) return false;
  ['fill', 'stroke', 'strokeWidth'].forEach(k => { if (g[k] === null) delete s[k]; else s[k] = g[k]; });
  delete s.guide; Layer.invalidate(L); return true;
}
CMD.reg('ai.view.guides.make', {i18n:'', undoable:true, params:'{} 视图 ▸ 参考线 ▸ 建立参考线：选中的路径变成参考线（不印、参考线颜色细线），取消选取 → {ok, count}'}, () => {
  VecSel.prune();
  const L = VecSel.layer(); let n = 0;
  if (L) for (const id of VecSel.shapes){ const s = L.data.shapes.find(x => x.id === id); if (s && toGuide(L, s)) n++; }
  if (!n) return err('ai.view.guides.make', 'select paths');
  VecSel.clear();
  return {ok:true, count:n};
});
CMD.reg('ai.view.guides.release', {i18n:'', undoable:true, params:'{} 视图 ▸ 参考线 ▸ 释放参考线：选中的参考线路径（没选＝全部没锁的）变回路径并选中 → {ok, count}'}, () => {
  const all = [];
  Doc.layers.forEach(L => { if (L.kind === 'vector') L.data.shapes.forEach(s => { if (s.guide) all.push({L, s}); }); });
  const sel = all.filter(x => VecSel.layerId === x.L.id && VecSel.isShapeSelected(x.s.id));
  const targets = sel.length ? sel : all.filter(x => x.L.visible !== false && !x.L.locked && !x.s.locked);
  if (!targets.length) return err('ai.view.guides.release', 'no guides');
  targets.forEach(x => fromGuide(x.L, x.s));
  const L0 = targets[0].L;                               // VecSel 一次只管一层：选第一条那层的
  VecSel.setShapes(L0.id, targets.filter(x => x.L === L0).map(x => x.s.id));
  return {ok:true, count:targets.length};
});
CMD.reg('ai.view.guides.clear', {i18n:'', undoable:true, params:'{} 视图 ▸ 参考线 ▸ 清除参考线：删掉所有标尺参考线与参考线路径 → {ok, count}'}, () => {
  let n = AiView.guides().length;
  Doc.layers.forEach(L => {
    if (L.kind !== 'vector') return;
    const k = L.data.shapes.length; L.data.shapes = L.data.shapes.filter(s => !s.guide);
    if (L.data.shapes.length !== k){ n += k - L.data.shapes.length; Layer.invalidate(L); }
  });
  if (!n) return {ok:true, count:0};
  Doc.aiGuides = []; VecSel.prune();
  return {ok:true, count:n};
});

/* ═══════════ 存下来的视图（views.rs；menus.rs 768-788、2277-2293） ═══════════ */
const MAX_VIEWS = 25;
const VIEW_BASE = {'zh-Hant':'檢視', 'zh-Hans':'视图', en:'View'};
const viewName = () => { const b = VIEW_BASE[Lang.cur] || 'View'; let i = 1; while (AiView.views().some(v => v.name === `${b} ${i}`)) i++; return `${b} ${i}`; };
CMD.reg('ai.view.saved.new', {i18n:'',
  params:'{name?（缺省＝「视图 N」）, center?: [x,y], zoom?（1＝100%；center／zoom 缺省＝目前视角）, rotation?: 度, dialog?: bool（开「新建视图」对话框）} 视图 ▸ 新建视图…：把视角存进文件（最多 25 个、可 undo、随工程档走）→ {ok, name, index}'}, p => {
  if (p.dialog){ Dlg.newView(); return {ok:true, dialog:true}; }
  const C = 'ai.view.saved.new';
  const cur = viewCenterDoc();
  const center = Array.isArray(p.center) ? [+p.center[0], +p.center[1]] : cur;
  if (!center.every(isFinite)) return err(C, 'missing center [x, y]');
  const zoom = p.zoom === undefined ? UI.zoom : +p.zoom;
  if (!(isFinite(zoom) && zoom > 0)) return err(C, 'zoom must be positive');
  if (AiView.views().length >= MAX_VIEWS) return err(C, `a document keeps at most ${MAX_VIEWS} views`);
  const name = (typeof p.name === 'string' && p.name.trim()) ? p.name.trim() : viewName();
  if (AiView.views().some(v => v.name === name)) return err(C, `a view named \`${name}\` exists`);
  History.push();                                        // s.edit("New View")：真的存了才进历史（开对话框那一下不进）
  AiView.views().push({name, center, zoom, rotation:+p.rotation || 0});
  return {ok:true, name, index:AiView.views().length - 1};
});
CMD.reg('ai.view.saved.edit', {i18n:'',
  params:'{name, newName?, delete?: bool, dialog?: bool（开「编辑视图」对话框）} 视图 ▸ 编辑视图…：改名或删除（可 undo）；不给 name ＝列出 → {ok, views}'}, p => {
  const C = 'ai.view.saved.edit';
  if (p.dialog){ if (!AiView.views().length) return err(C, 'no saved views (View ▸ New View…)'); Dlg.editView(); return {ok:true, dialog:true}; }
  if (typeof p.name !== 'string') return {ok:true, views:clone(AiView.views())};
  const i = AiView.views().findIndex(v => v.name === p.name);
  if (i < 0) return err(C, `no view named \`${p.name}\``);
  if (p.delete === true){ History.push(); AiView.views().splice(i, 1); return {ok:true, deleted:p.name}; }
  const nn = typeof p.newName === 'string' ? p.newName.trim() : '';
  if (!nn) return err(C, 'give newName or delete');
  if (AiView.views().some(v => v.name === nn)) return err(C, `a view named \`${nn}\` exists`);
  History.push(); AiView.views()[i].name = nn;
  return {ok:true, name:nn};
});
CMD.reg('ai.view.saved.list', {i18n:'', params:'{} → {ok, views:[{name, center, zoom, rotation}]}'}, () => ({ok:true, views:clone(AiView.views())}));
CMD.reg('ai.view.goto', {i18n:'', params:'{n: 1..} 切到第 n 个存下来的视图（视图菜单底下那几项）→ {ok, name}'}, p => {
  const v = AiView.views()[(+p.n || 0) - 1];
  if (!v) return err('ai.view.goto', 'no such view');
  setView(zclamp(v.zoom), v.center.slice());
  return {ok:true, name:v.name};
});

/* 给 agent：目前所有视图状态 */
CMD.reg('ai.view.state', {i18n:'', params:'{} → {ok, flags, boundingBox, proof, screen, zoom, guides, views}'}, () => ({ok:true, flags:Object.assign({}, AiView.flags),
  boundingBox:AiView.boundingBox(), proof:Object.assign({}, AiView.proof), screen:window.Toolbar ? Toolbar.screen : 'standard', zoom:UI.zoom,
  guides:clone(AiView.guides()), views:clone(AiView.views())}));

/* ═══════════ 对话框（新建视图…／编辑视图…；样式注入） ═══════════ */
const STR = {
  'zh-Hant':{'aiview.newTitle':'新增檢視', 'aiview.editTitle':'編輯檢視', 'aiview.name':'名稱：', 'aiview.newName':'新名稱：', 'aiview.delete':'刪除', 'aiview.ok':'確定', 'aiview.cancel':'取消'},
  'zh-Hans':{'aiview.newTitle':'新建视图', 'aiview.editTitle':'编辑视图', 'aiview.name':'名称：', 'aiview.newName':'新名称：', 'aiview.delete':'删除', 'aiview.ok':'确定', 'aiview.cancel':'取消'},
  'en':{'aiview.newTitle':'New View', 'aiview.editTitle':'Edit Views', 'aiview.name':'Name:', 'aiview.newName':'New name:', 'aiview.delete':'Delete', 'aiview.ok':'OK', 'aiview.cancel':'Cancel'}
};
if (typeof Lang !== 'undefined') Lang.add(STR);
if (!document.getElementById('aiViewStyle')){
  const st = document.createElement('style'); st.id = 'aiViewStyle';
  st.textContent = `.aivdlg-back{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}
.aivdlg{background:#2b2f36;color:#e6e8ec;border:1px solid #444a55;border-radius:6px;padding:14px 16px;min-width:280px;font:13px sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4)}
.aivdlg .t{font-weight:600;margin-bottom:10px}
.aivdlg label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0}
.aivdlg input[type=text],.aivdlg select{width:170px;background:#1d2026;color:#e6e8ec;border:1px solid #444a55;border-radius:3px;padding:3px 6px}
.aivdlg .bar{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.airuler{position:absolute;z-index:6;display:none;background:#2f2f2f}
body.ai-rulers .airuler{display:block}
#aiRulerTop{left:${RULER}px;top:0;height:${RULER}px;cursor:s-resize}
#aiRulerLeft{left:0;top:${RULER}px;width:${RULER}px;cursor:e-resize}
#aiRulerCorner{left:0;top:0;width:${RULER}px;height:${RULER}px;border-right:1px solid #1b1b1b;border-bottom:1px solid #1b1b1b;box-sizing:border-box;
  background:linear-gradient(#8a8a8a,#8a8a8a) center/9px 1px no-repeat,linear-gradient(#8a8a8a,#8a8a8a) center/1px 9px no-repeat,#2f2f2f}
body.ai-noab #view{box-shadow:none !important;background:transparent !important}`;
  document.head.appendChild(st);
}
function dialog(id, title, rows, ok){
  const old = document.getElementById(id); if (old) old.remove();
  const back = document.createElement('div'); back.className = 'aivdlg-back'; back.id = id;
  const box = document.createElement('div'); box.className = 'aivdlg';
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
  const b1 = document.createElement('button'); b1.textContent = Lang.t('aiview.cancel'); b1.dataset.act = 'cancel'; b1.onclick = close;
  const b2 = document.createElement('button'); b2.textContent = Lang.t('aiview.ok'); b2.dataset.act = 'ok'; b2.onclick = done;
  bar.appendChild(b1); bar.appendChild(b2); box.appendChild(bar);
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); done(); }
    else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); }
  });
  back.addEventListener('pointerdown', e => e.stopPropagation());
  back.appendChild(box); document.body.appendChild(back);
  const first = box.querySelector('input,select'); if (first){ first.focus(); if (first.select) first.select(); }
}
const Dlg = AiView.dialogs = {
  newView(){ dialog('aiViewNewDlg', 'aiview.newTitle', [{k:'name', label:'aiview.name', type:'text', value:viewName()}],
    v => { try { CMD.run('ai.view.saved.new', {name:v.name}); } catch(e){ console.error(e); } }); },
  editView(){
    const names = AiView.views().map(v => v.name);
    dialog('aiViewEditDlg', 'aiview.editTitle', [{k:'name', label:'aiview.name', type:'select', options:names, value:names[0]},
      {k:'newName', label:'aiview.newName', type:'text', value:''}, {k:'delete', label:'aiview.delete', type:'check', value:false}],
      v => { try { CMD.run('ai.view.saved.edit', {name:v.name, newName:v.newName, delete:v.delete}); } catch(e){ console.error(e); } });
  }
};

/* ═══════════ 本菜单的快捷键（AI 模式；照菜单树上写的 key） ═══════════ */
const CODE = c => /^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5)
  : ({BracketLeft:'[', BracketRight:']', Semicolon:';', Quote:"'", Equal:'=', Minus:'-', Comma:',', Period:'.', Slash:'/', Backslash:'\\'})[c] || null;
const comboOf = e => [(e.ctrlKey || e.metaKey) ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '',
  CODE(e.code) || (e.key && e.key.length === 1 ? e.key.toUpperCase() : e.key)].filter(Boolean).join('+');
const normKey = k => { const p = k.split('+'), key = p.pop(); return ['Ctrl', 'Alt', 'Shift'].filter(m => p.includes(m)).concat([key.length === 1 ? key.toUpperCase() : key]).join('+'); };
window.addEventListener('keydown', e => {
  if (!window.Menubar || Menubar.app !== 'ai' || !MenuTrees.ai || !MenuTrees.ai.view) return;
  if (/input|select|textarea/i.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable)) return;
  if (document.querySelector('.aivdlg-back,.aidlg-back')) return;
  const c = comboOf(e); let hit = null;
  const go = items => items.forEach(it => { if (hit || it.sep) return; if (it.key && normKey(it.key) === c && Menubar.enabled(it)) hit = it; if (it.sub) go(it.sub); });
  go(MenuTrees.ai.view.items);
  if (!hit) return;
  e.preventDefault(); e.stopImmediatePropagation();
  Menubar.run(hit);
}, true);

/* ═══════════════════════════════════════════════════════════════════════════
   共用层钩子（正式挂点在 ui.js／_vecsel.js／_registry.js／engine.js）；
   这里先看共用层有没有加：加了就只挂接口，没加就在执行期包一层（过渡钩子）。两边做的事一样：
   ① UI.viewComposite(s, target)：画 #view 那一次的合成（轮廓、像素预览、白纸、校样＋网格／参考线／选取叠画）
      UI.toolOverlayHidden(T)：渐变批注者关掉时不叫渐变工具的 drawOverlay；画完（UI.overlays）更新标尺与「隐藏画板」
   ② VecSel.drawOverlay：隐藏边缘时不画
   ③ Pointer.onDown/onMove/onUp/onDblClick：对齐像素／对齐网格（只给画东西的工具）
   ④ History.snap/restore/restoreInPlace、Doc.reset、Project.serialize/load：Doc.aiGuides／Doc.aiViews 进历史、进工程档、开新档清空
   ═══════════════════════════════════════════════════════════════════════════ */
const SNAP_TOOLS = ['rect', 'ellipse', 'star', 'line', 'pen', 'gradient'];
AiView.snapPt = function(pt){                            // guides.rs:160-167 snap_draw 的前两支
  if (!pt || !this.active() || !SNAP_TOOLS.includes(ToolState.cur)) return pt;
  if (this.flags.snapToPixel) return [Math.round(pt[0]), Math.round(pt[1])];
  if (this.flags.snapToGrid){ const g = this.gridSet.spacing / Math.max(1, this.gridSet.subdivisions); return [Math.round(pt[0] / g) * g, Math.round(pt[1] / g) * g]; }
  return pt;
};
AiView.edgesHidden = function(){ return this.active() && this.flags.edges === false; };
/* Doc 上的 AI 资料：给 History／Project 用 */
AiView.docSnap = function(){ return {guides:clone(this.guides()), views:clone(this.views())}; };
AiView.docRestore = function(d){ Doc.aiGuides = d ? clone(d.guides || []) : []; Doc.aiViews = d ? clone(d.views || []) : []; };
AiView.afterDraw = function(){
  document.body.classList.toggle('ai-noab', this.active() && !this.flags.artboards);
  this.drawRulers();
};
const has = (f, re) => typeof f === 'function' && re.test(String(f));
function hookDraw(){
  if (!window.UI || UI.__aiViewHook) return;
  UI.__aiViewHook = true;
  UI.viewComposite = function(s, target){
    const c0 = AiView._base || window.composite;
    return AiView.active() ? AiView.viewComposite(c0, s, target) : c0(s, target);
  };
  UI.toolOverlayHidden = T => AiView.active() && !AiView.flags.gradientAnnotator && !!T && T.id === 'gradient';
  if (Array.isArray(UI.overlays)) UI.overlays.push((ctx, s) => AiView.drawVecSel(ctx, s));   // 不管 UI.draw 有没有被别档包过都挂（叠画层每次 draw 都画）
  const orig = UI.draw;
  if (has(orig, /viewComposite/)){                       // 共用层已经有挂点
    if (Array.isArray(UI.overlays)) UI.overlays.push(() => AiView.afterDraw());
    else UI.draw = function(){ try { return orig.apply(this, arguments); } finally { AiView.afterDraw(); } };
  } else {                                               // 过渡：画 #view 那一次把 composite 换掉
    UI.draw = function(){
      if (!AiView.active()){ try { return orig.apply(this, arguments); } finally { AiView.afterDraw(); } }
      const c0 = window.composite; AiView._base = c0;
      window.composite = function(s, target){ return (target && target === UI.canvas) ? UI.viewComposite(s, target) : c0(s, target); };
      const T = Tools.current(), hide = UI.toolOverlayHidden(T), od = hide ? T.drawOverlay : null;
      if (hide) T.drawOverlay = null;
      try { return orig.apply(this, arguments); }
      finally { window.composite = c0; AiView._base = null; if (hide) T.drawOverlay = od; AiView.afterDraw(); }
    };
  }
  const wrap = document.getElementById('canvasWrap');
  if (wrap){
    wrap.addEventListener('pointerdown', guideGrab, true);
    wrap.addEventListener('pointermove', () => { if (AiView.rulersShown()) AiView.drawRulers(); });
  }
}
if (window.VecSel && !VecSel.__aiViewHook && !has(VecSel.drawOverlay, /edgesHidden/)){
  VecSel.__aiViewHook = true;
  const o = VecSel.drawOverlay;
  VecSel.drawOverlay = function(){ if (AiView.edgesHidden()) return; return o.apply(this, arguments); };
}
if (window.Pointer && !Pointer.__aiViewHook && !has(Pointer.onDown, /snapPt/)){
  Pointer.__aiViewHook = true;
  ['onDown', 'onMove', 'onUp', 'onDblClick'].forEach(k => { const o = Pointer[k]; Pointer[k] = function(e, pt){ return o.call(this, e, AiView.snapPt(pt)); }; });
}
if (!History.__aiViewHook && !has(History.snap, /docSnap/)){
  History.__aiViewHook = true;
  const snap = History.snap;
  History.snap = function(){ const s = snap.apply(this, arguments); s.aiDoc = AiView.docSnap(); return s; };
  ['restore', 'restoreInPlace'].forEach(k => {
    const o = History[k];
    History[k] = function(s){ const r = o.apply(this, arguments); if (s && s.aiDoc) AiView.docRestore(s.aiDoc); return r; };
  });
}
if (!Doc.__aiViewHook && !has(Doc.reset, /docRestore/)){
  Doc.__aiViewHook = true;
  const reset = Doc.reset;
  Doc.reset = function(){ AiView.docRestore(null); return reset.apply(this, arguments); };
}
if (!Project.__aiViewHook && !has(Project.serialize, /aiGuides/)){
  Project.__aiViewHook = true;
  const ser = Project.serialize, load = Project.load;
  Project.serialize = function(){ const o = ser.apply(this, arguments); if (AiView.guides().length) o.aiGuides = clone(AiView.guides()); if (AiView.views().length) o.aiViews = clone(AiView.views()); return o; };
  Project.load = async function(json){
    AiView.docRestore(null);
    const r = await load.apply(this, arguments);
    AiView.docRestore({guides:Array.isArray(json.aiGuides) ? json.aiGuides : [], views:Array.isArray(json.aiViews) ? json.aiViews : []});
    if (window.UI) UI.draw();
    return r;
  };
}
if (window.UI) hookDraw(); else window.addEventListener('DOMContentLoaded', hookDraw);
if (window.UI && UI.canvas) UI.draw();

})();

/* ═════════════════════════════════════════════════════════════════════════════
   共用钩子（视图这一头）：
     ① 文件级资料 Doc.aiR3（对象菜单各段登记的画板、切片、资源、透视网格、图案…）
        链式包 AiView.docSnap／docRestore（engine 的 History.snap／restore 与 Doc.reset 都叫它）＋ Project.serialize／load（工程档存 aiR3）
     ② 画面叠画：链式包 AiView.drawOverlays，逐个叫 AiR3.overlays（各段登记）
     ③ 深层选取的叠画：选中的若是编组里面的物件（剪切蒙版编辑内容等），画它的轮廓（canvas.rs selection_overlay 同色）
   ═════════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
if (!window.AiView || !window.AiR3 || AiView.__r3Hook) return;
AiView.__r3Hook = true;
const clone = o => JSON.parse(JSON.stringify(o));
const snap0 = AiView.docSnap, rest0 = AiView.docRestore;
AiView.docSnap = function(){ const o = snap0.apply(this, arguments); o.r3 = clone(Doc.aiR3 || {}); return o; };
AiView.docRestore = function(d){ const r = rest0.apply(this, arguments); Doc.aiR3 = (d && d.r3) ? clone(d.r3) : {}; return r; };
/* window.Project 要到 ui.js 才挂，本档载入时只有全域名字 Project（engine.js 的 const），所以用 typeof 判 */
if (typeof Project !== 'undefined' && !Project.__r3Hook){
  Project.__r3Hook = true;
  const ser = Project.serialize, load = Project.load;
  Project.serialize = function(){ const o = ser.apply(this, arguments); if (Doc.aiR3 && Object.keys(Doc.aiR3).length) o.aiR3 = clone(Doc.aiR3); return o; };
  Project.load = async function(json){
    const r = await load.apply(this, arguments);
    Doc.aiR3 = (json && json.aiR3 && typeof json.aiR3 === 'object') ? clone(json.aiR3) : {};
    if (window.UI) UI.draw();
    return r;
  };
}
const ov0 = AiView.drawOverlays;
AiView.drawOverlays = function(ctx, s){
  const r = ov0.apply(this, arguments);
  for (const f of AiR3.overlays){ try { f(ctx, s); } catch (e){ console.error(e); } }
  return r;
};
/* ③ 深层选取的轮廓 */
AiR3.overlays.push(function(ctx, s){
  if (!AiView.flags.edges || !window.VecSel || VecSel.isEmpty()) return;
  const L = VecSel.layer(); if (!L || L.kind !== 'vector' || !L.visible) return;
  const deep = VecSel.shapes.filter(id => !L.data.shapes.some(x => x.id === id)).map(id => AiR3.findDeep(id, L)).filter(Boolean);
  if (!deep.length) return;
  ctx.save(); ctx.translate(L.x * s, L.y * s); ctx.strokeStyle = '#2f7fd8'; ctx.lineWidth = 1;
  for (const h of deep){ ctx.beginPath(); ObjRender.addPath(ctx, h.s, s); ctx.stroke(); }
  ctx.restore();
});
})();

/* ═════════════════════════════════════════════════════════════════════════════
   视图菜单其余各项（照 VectorCraft 原码）：
     ■ 校样设置 ▸ 工作中的 CMYK：color/src/cms/mod.rs:470-490 proof_srgb（WorkingCmyk：sRGB → 工作 CMYK → 显示 sRGB）、
         cms/generic.rs 1-453「VectorCraft Generic CMYK (SWOP-like)」参数式印刷模型（网点扩大＋Demichel 混八原色＋K 密度饱和、
         Lab→CMYK 用 LM 解 CMY＋GCR 黑版＋UCR 总墨量、四种演色意图＋黑场补偿）、cms/lab.rs（XYZ／Lab D50、sRGB 矩阵）、
         mod.rs:131-135 预设（意图＝相对比色、黑场补偿开）、mod.rs:617-656 ProofLut（17³ 三线性）、render/src/proof.rs:92-117 post
     ■ 校样设置 ▸ 自定…（原码 window.panel {panel:"separations"}）：ui-egui/src/panels/separations.rs（分色预览面板：
         叠印预览（分色）开关、CMYK 四版眼睛、校样目标、校样颜色、模拟纸色、叠印预览）、engine/src/cmd/colormgmt.rs:434-461 view.separationsPreview、
         render/src/proof.rs:37-61 plate_color（只开一版＝灰阶网点覆盖、多版＝关掉的版墨量归零再转回显示色）
         我们：原码在 prepare 时换文件里的颜色；我们改成对画面像素查 17³ 表（平涂色结果一样；渐变／影像逐像素算，原码按色标算）
     ■ 隐藏边角构件：ui-egui/src/menus.rs:133, 766, 1185（flag corner_widgets，预设开）、canvas.rs:1122-1133 画法、
         tools/src/corners.rs 1-140 CornerWidgets::of（单选一个活矩形、最少内缩 10 屏幕点、边太短不画）与 CornerDrag（沿内对角线拖＝四角一起改圆角）
     ■ 隐藏文本串接：menus.rs:135, 790, 1186（flag text_threads，预设开，Cmd+Shift+Y）、canvas.rs:320-322, 943-961 thread_overlay
         （选中的串接文字框之间连线、出入口白方块）。我们的串接资料放 Doc.aiR3.textThreads=[[文字层 id…]…]——目前画板还没有建立串接的界面，所以平常没线可画。
   ═════════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
if (!window.AiView || window.__aiR3_viewMisc) return; window.__aiR3_viewMisc = true;
const R3 = window.AiR3;

/* ═════ lab.rs ═════ */
const D50 = [0.96422, 1.0, 0.82521];
const EPS = 216 / 24389, KAPPA = 24389 / 27;
const lab = (l, a, b) => ({l, a, b});
const chroma = c => Math.hypot(c.a, c.b);
const hue = c => { let h = Math.atan2(c.b, c.a) * 180 / Math.PI; h %= 360; if (h < 0) h += 360; return h; };
const fromLch = (l, c, h) => { const r = h * Math.PI / 180; return {l, a:c * Math.cos(r), b:c * Math.sin(r)}; };
function xyzToLab(x){
  const f = t => t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
  const fx = f(x[0] / D50[0]), fy = f(x[1] / D50[1]), fz = f(x[2] / D50[2]);
  return {l:116 * fy - 16, a:500 * (fx - fy), b:200 * (fy - fz)};
}
function labToXyz(c){
  const fy = (c.l + 16) / 116, fx = fy + c.a / 500, fz = fy - c.b / 200;
  const inv = f => { const f3 = f * f * f; return f3 > EPS ? f3 : (116 * f - 16) / KAPPA; };
  const y = c.l > KAPPA * EPS ? fy * fy * fy : c.l / KAPPA;
  return [inv(fx) * D50[0], y * D50[1], inv(fz) * D50[2]];
}
const s2l = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const l2s = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
const SRGB_TO_XYZ = [[0.4360747, 0.3850649, 0.1430804], [0.2225045, 0.7168786, 0.0606169], [0.0139322, 0.0971045, 0.7141733]];
const XYZ_TO_SRGB = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const mul3 = (m, v) => [m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2], m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2], m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2]];
const srgbToXyz = rgb => mul3(SRGB_TO_XYZ, rgb.map(s2l));
const xyzToSrgb = x => mul3(XYZ_TO_SRGB, x).map(v => { const e = l2s(Math.min(1, Math.max(0, v))); return e > 0.99999 ? 1 : e < 1e-6 ? 0 : e; });
const srgbToLab = rgb => xyzToLab(srgbToXyz(rgb));
const labToSrgb = c => xyzToSrgb(labToXyz(c));

/* ═════ generic.rs：VectorCraft Generic CMYK (SWOP-like) ═════ */
const PARAMS = {
  paper:lab(93.0, -0.5, 2.5),
  solids:[lab(55, -37, -50), lab(48, 74, -3), lab(24, 22, -46), lab(89, -5, 93), lab(50, -65, 27), lab(47, 68, 48), lab(24, 1, 0)],   // C M CM Y CY MY CMY
  black:lab(19, 0.5, 0.5), dotGain:[0.20, 0.20, 0.20, 0.22], tac:3.0, bg:{start:0.1, maxK:0.95, gamma:1.25}
};
const GBD_L = 51, GBD_H = 72;
function solve3(a, b){
  const det3 = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const det = det3(a); if (Math.abs(det) < 1e-12) return null;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++){ const m = a.map(r => r.slice()); for (let r = 0; r < 3; r++) m[r][i] = b[r]; out[i] = det3(m) / det; }
  return out;
}
class GenericCmyk {
  constructor(p){
    this.p = p;
    const paper = labToXyz(p.paper);
    this.paper = paper;
    this.prim = [paper].concat(p.solids.map(labToXyz));
    const kx = labToXyz(p.black), DMAX = 2.0, sat = d => DMAX * (1 - Math.exp(-d / DMAX));
    this.primK = this.prim.map(pr => [0, 1, 2].map(ch => {
      const di = -Math.log10(Math.max(pr[ch] / paper[ch], 1e-6)), dk = -Math.log10(Math.max(kx[ch] / paper[ch], 1e-6));
      const d = sat(di + dk) * dk / Math.max(sat(dk), 1e-6);
      return paper[ch] * Math.pow(10, -Math.max(d, di));
    }));
    this.blackRel = [0, 0, 0];
    let best = [1, 1, 1];
    for (const k of [0.8, 0.9, 1.0]){ const rest = Math.max(p.tac - k, 0) / 3, cmy = Math.min(rest, 1); const x = this.toXyzRel([cmy, cmy, cmy, k]); if (x[1] < best[1]) best = x; }
    this.blackRel = best;
    this._gbd = null;
  }
  static gain(a, g){ a = Math.min(1, Math.max(0, a)); return Math.min(1, Math.max(0, a + 4 * g * a * (1 - a))); }
  toXyz(cmyk){
    const dg = this.p.dotGain, c = GenericCmyk.gain(cmyk[0], dg[0]), m = GenericCmyk.gain(cmyk[1], dg[1]), y = GenericCmyk.gain(cmyk[2], dg[2]), k = GenericCmyk.gain(cmyk[3], dg[3]);
    const out = [0, 0, 0];
    for (let i = 0; i < 8; i++){
      const w = ((i & 1) ? c : 1 - c) * ((i & 2) ? m : 1 - m) * ((i & 4) ? y : 1 - y);
      if (w === 0) continue;
      for (let ch = 0; ch < 3; ch++) out[ch] += w * ((1 - k) * this.prim[i][ch] + k * this.primK[i][ch]);
    }
    return out;
  }
  toXyzRel(cmyk){ const x = this.toXyz(cmyk); return [x[0] * D50[0] / this.paper[0], x[1] * D50[1] / this.paper[1], x[2] * D50[2] / this.paper[2]]; }
  toLabRel(cmyk){ return xyzToLab(this.toXyzRel(cmyk)); }
  toSrgb(cmyk, absolute){ return xyzToSrgb(absolute ? this.toXyz(cmyk) : this.toXyzRel(cmyk)); }
  solveCmy(target, k, init){
    let x = init.map(v => Math.min(1, Math.max(0, v)));
    const f = x => { const l = this.toLabRel([x[0], x[1], x[2], k]); return [l.l - target.l, l.a - target.a, l.b - target.b]; };
    let r = f(x), err = r[0]*r[0] + r[1]*r[1] + r[2]*r[2], lambda = 1e-3;
    for (let it = 0; it < 40; it++){
      if (err < 1e-4) break;
      const j = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let col = 0; col < 3; col++){
        const h = x[col] > 0.5 ? -1e-3 : 1e-3, xp = x.slice(); xp[col] += h; const rp = f(xp);
        for (let row = 0; row < 3; row++) j[row][col] = (rp[row] - r[row]) / h;
      }
      const a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0];
      for (let p = 0; p < 3; p++){ for (let q = 0; q < 3; q++) a[p][q] = j[0][p]*j[0][q] + j[1][p]*j[1][q] + j[2][p]*j[2][q]; g[p] = -(j[0][p]*r[0] + j[1][p]*r[1] + j[2][p]*r[2]); }
      let improved = false;
      for (let t = 0; t < 8; t++){
        const al = a.map((row, p) => row.map((v, q) => p === q ? v + lambda * (a[p][p] + 1e-3) : v));
        const d = solve3(al, g); if (!d){ lambda *= 10; continue; }
        const xn = [0, 1, 2].map(i => Math.min(1, Math.max(0, x[i] + d[i]))), rn = f(xn), en = rn[0]*rn[0] + rn[1]*rn[1] + rn[2]*rn[2];
        if (en < err){
          const step = Math.max(Math.abs(xn[0] - x[0]), Math.abs(xn[1] - x[1]), Math.abs(xn[2] - x[2]));
          x = xn; r = rn; err = en; lambda = Math.max(lambda * 0.3, 1e-7); improved = step > 1e-6; break;
        }
        lambda *= 10;
      }
      if (!improved) break;
    }
    return x;
  }
  static initialCmy(target, k){ const rgb = labToSrgb(target), d = Math.max(1 - k, 0.05); return rgb.map(v => Math.min(1, Math.max(0, (1 - v - k) / d))); }
  blackForGrey(grey){ const bg = this.p.bg; if (grey <= bg.start) return 0; return Math.min(1, Math.max(0, Math.pow(Math.min(1, Math.max(0, (grey - bg.start) / (1 - bg.start))), bg.gamma) * bg.maxK)); }
  separate(target){
    if (target.l >= 99.99 && Math.abs(target.a) < 0.01 && Math.abs(target.b) < 0.01) return [0, 0, 0, 0];
    const cmy0 = this.solveCmy(target, 0, GenericCmyk.initialCmy(target, 0));
    const grey = Math.min(cmy0[0], cmy0[1], cmy0[2]);
    let k = this.blackForGrey(grey);
    const l0 = this.toLabRel([cmy0[0], cmy0[1], cmy0[2], 0]).l;
    if (l0 > target.l + 1) k = Math.max(k, Math.min(1, Math.max(0, (l0 - target.l) / Math.max(l0, 1))));
    let cmy = k > 0 ? this.solveCmy(target, k, GenericCmyk.initialCmy(target, k)) : cmy0;
    for (let i = 0; i < 6; i++){
      const sum = cmy[0] + cmy[1] + cmy[2] + k;
      if (sum <= this.p.tac + 1e-3 || k >= 1) break;
      k = Math.min(k + (sum - this.p.tac) * 0.5, 1);
      cmy = this.solveCmy(target, k, cmy);
    }
    const sum = cmy[0] + cmy[1] + cmy[2] + k;
    if (sum > this.p.tac){ const s = Math.min(1, Math.max(0, (this.p.tac - k) / Math.max(cmy[0] + cmy[1] + cmy[2], 1e-6))); cmy = cmy.map(v => v * s); }
    return [cmy[0], cmy[1], cmy[2], k].map(v => v < 1e-4 ? 0 : Math.min(v, 1));
  }
  gbd(){
    if (this._gbd) return this._gbd;
    const cmax = new Float32Array(GBD_L * GBD_H), cusp = Array.from({length:GBD_H}, () => [0, 50]), n = 16;
    for (let ki = 0; ki <= 5; ki++){ const k = ki / 5;
      for (let ci = 0; ci <= n; ci++) for (let mi = 0; mi <= n; mi++) for (let yi = 0; yi <= n; yi++){
        const c = ci / n, m = mi / n, y = yi / n;
        if (c + m + y + k > this.p.tac + 1e-3) continue;
        const lb = this.toLabRel([c, m, y, k]);
        const li = Math.min(Math.round(lb.l / 2), GBD_L - 1), hi = Math.min(Math.floor(hue(lb) / 5), GBD_H - 1), ch = chroma(lb);
        const at = Math.max(0, li) * GBD_H + hi; if (ch > cmax[at]) cmax[at] = ch;
        if (ch > cusp[hi][0]) cusp[hi] = [ch, lb.l];
      } }
    const smooth = Float32Array.from(cmax);
    for (let li = 0; li < GBD_L; li++) for (let hi = 0; hi < GBD_H; hi++){ const get = h => cmax[li * GBD_H + (h % GBD_H)]; smooth[li * GBD_H + hi] = Math.max(get(hi), get(hi + 1), get(hi + GBD_H - 1)); }
    for (let hi = 0; hi < GBD_H; hi++){
      const col = []; for (let li = 0; li < GBD_L; li++) col.push(smooth[li * GBD_H + hi]);
      const known = []; for (let li = 0; li < GBD_L; li++) if (col[li] > 0) known.push(li);
      for (let li = 0; li < GBD_L; li++){
        if (col[li] > 0) continue;
        const below = [...known].reverse().find(k => k < li), above = known.find(k => k > li);
        smooth[li * GBD_H + hi] = (below !== undefined && above !== undefined) ? col[below] + (col[above] - col[below]) * (li - below) / (above - below) : 0;
      }
    }
    return (this._gbd = {cmax:smooth, cuspL:cusp.map(c => c[1])});
  }
  maxChroma(l, h){
    const g = this.gbd(), lf = Math.min(Math.min(100, Math.max(0, l)) / 2, GBD_L - 1);
    let hf = (h % 360 + 360) % 360 / 5;
    const l0 = Math.floor(lf), h0 = Math.floor(hf), l1 = Math.min(l0 + 1, GBD_L - 1), h1 = (h0 + 1) % GBD_H, tl = lf - l0, th = hf - h0;
    const at = (li, hi) => g.cmax[li * GBD_H + (hi % GBD_H)];
    const a = at(l0, h0) * (1 - th) + at(l0, h1) * th, b = at(l1, h0) * (1 - th) + at(l1, h1) * th;
    return a * (1 - tl) + b * tl;
  }
  cuspL(h){ return this.gbd().cuspL[Math.min(Math.floor(((h % 360) + 360) % 360 / 5), GBD_H - 1)]; }
  gamutMap(src, intent, bpc){
    if (intent === 'absolute'){ const x = labToXyz(src); return xyzToLab([x[0] * D50[0] / this.paper[0], x[1] * D50[1] / this.paper[1], x[2] * D50[2] / this.paper[2]]); }
    let c = src;
    if (bpc || intent === 'perceptual' || intent === 'saturation'){
      const x = labToXyz(c), bp = this.blackRel;
      c = xyzToLab([0, 1, 2].map(i => bp[i] + x[i] * (1 - bp[i] / D50[i])));
    }
    if (intent === 'perceptual'){
      const ch = chroma(c);
      if (ch > 1e-3){
        const h = hue(c), cmax0 = Math.max(this.maxChroma(c.l, h), 1);
        if (ch > cmax0){ const w = Math.min(1, Math.max(0, (ch - cmax0) / ch)) * 0.9; c = {l:c.l + (this.cuspL(h) - c.l) * w, a:c.a, b:c.b}; }
        const cmax = Math.max(this.maxChroma(c.l, h), 1), r = ch / cmax, KNEE = 0.75;
        const r2 = r > KNEE ? KNEE + (1 - KNEE) * (1 - Math.exp(-(r - KNEE) / (1 - KNEE))) : r;
        c = fromLch(c.l, r2 * cmax * 0.995, hue(c));
      }
      return c;
    }
    if (intent === 'saturation'){
      const ch = chroma(c), h = hue(c);
      if (ch > 1e-3){
        let l = c.l; const cmax = this.maxChroma(l, h);
        if (ch > cmax){ const cl = this.cuspL(h); l += (cl - l) * Math.min(1, Math.max(0, (ch - cmax) / Math.max(ch, 1))); }
        c = fromLch(l, Math.min(ch * 1.1, this.maxChroma(l, h) * 0.995), h);
      }
      return c;
    }
    return c;
  }
  fromSrgb(rgb, intent, bpc){ return this.separate(this.gamutMap(srgbToLab(rgb), intent, bpc)); }
}
const GC = new GenericCmyk(PARAMS);
const naiveRgbToCmyk = ([r, g, b]) => { const k = 1 - Math.max(r, g, b); if (k >= 1) return [0, 0, 0, 1]; return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k]; };

/* ═════ 校样状态（mod.rs:600-610 ProofSetup；预设 意图＝相对比色、模拟纸色关；黑场补偿＝颜色设置预设开） ═════ */
const INTENTS = ['perceptual', 'relative', 'saturation', 'absolute'];
const parseIntent = s => { const k = String(s).toLowerCase().replace(/[ _-]/g, ''); return k === 'perceptual' ? 'perceptual' : (k === 'relative' || k === 'relativecolorimetric') ? 'relative' : k === 'saturation' ? 'saturation' : (k === 'absolute' || k === 'absolutecolorimetric') ? 'absolute' : null; };
if (!AiView.proof.intent) AiView.proof.intent = 'relative';
if (AiView.proof.simulatePaper === undefined) AiView.proof.simulatePaper = false;
if (AiView.proof.bpc === undefined) AiView.proof.bpc = true;
AiView.separations = null;                                   // 分色预览：null＝关；否则＝看得见的版名
const PLATES = ['Cyan', 'Magenta', 'Yellow', 'Black'];
AiView.cmyk = {GC, srgbToLab, labToSrgb, srgbToCmyk:(rgb, intent) => GC.fromSrgb(rgb, intent || AiView.proof.intent, AiView.proof.bpc), cmykToSrgb:(c, abs) => GC.toSrgb(c, !!abs), naiveRgbToCmyk};

/* proof_srgb（WorkingCmyk）与 plate_color 的像素版 */
function proofFn(){
  const P = AiView.proof;
  if (AiView.separations){
    const vis = AiView.separations.slice();
    return rgb => {
      const ink = GC.fromSrgb(rgb, P.intent, P.bpc);
      if (vis.length === 1){ const i = PLATES.indexOf(vis[0]); const v = 1 - (i >= 0 ? ink[i] : 0); return [v, v, v]; }
      const c = ink.map((v, i) => vis.includes(PLATES[i]) ? v : 0);
      return GC.toSrgb(c, P.simulatePaper);
    };
  }
  if (AiView.flags.proofColors && P.target === 'workingCmyk') return rgb => GC.toSrgb(GC.fromSrgb(rgb, P.intent, P.bpc), P.simulatePaper);
  return null;
}
const lutKey = () => JSON.stringify([AiView.separations, AiView.proof.intent, AiView.proof.simulatePaper, AiView.proof.bpc, AiView.flags.proofColors && AiView.proof.target]);
const _luts = new Map();
function lutFor(){
  const key = lutKey(); if (_luts.has(key)) return _luts.get(key);
  const f = proofFn(); if (!f) return null;
  const N = 17, lut = new Float32Array(N * N * N * 3); let k = 0;
  for (let r = 0; r < N; r++) for (let g = 0; g < N; g++) for (let b = 0; b < N; b++){ const o = f([r / 16, g / 16, b / 16]); lut[k++] = o[0]; lut[k++] = o[1]; lut[k++] = o[2]; }
  if (_luts.size >= 8) _luts.delete(_luts.keys().next().value);
  _luts.set(key, lut); return lut;
}
AiView.cmyk.lut = lutFor;
function applyLut(canvas, lut){                               // proof.rs:92-117 post（预乘 alpha 处理照原码 un/re-premul，我们画布是非预乘 ⇒ 直接查）
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  const img = ctx.getImageData(0, 0, W, H), d = img.data, N = 17, M = 16;
  const at = (r, g, b, c) => lut[((r * N + g) * N + b) * 3 + c];
  let li = -1; const lo = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4){
    if (d[i + 3] === 0) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    if (key !== li){
      li = key;
      const fr = d[i] / 255 * M, fg = d[i + 1] / 255 * M, fb = d[i + 2] / 255 * M;
      const r0 = Math.min(M - 1, Math.floor(fr)), g0 = Math.min(M - 1, Math.floor(fg)), b0 = Math.min(M - 1, Math.floor(fb)), dr = fr - r0, dg = fg - g0, db = fb - b0;
      for (let c = 0; c < 3; c++){
        const c00 = at(r0, g0, b0, c) * (1 - db) + at(r0, g0, b0 + 1, c) * db, c01 = at(r0, g0 + 1, b0, c) * (1 - db) + at(r0, g0 + 1, b0 + 1, c) * db;
        const c10 = at(r0 + 1, g0, b0, c) * (1 - db) + at(r0 + 1, g0, b0 + 1, c) * db, c11 = at(r0 + 1, g0 + 1, b0, c) * (1 - db) + at(r0 + 1, g0 + 1, b0 + 1, c) * db;
        lo[c] = Math.round(Math.min(1, Math.max(0, (c00 * (1 - dg) + c01 * dg) * (1 - dr) + (c10 * (1 - dg) + c11 * dg) * dr)) * 255);
      }
    }
    d[i] = lo[0]; d[i + 1] = lo[1]; d[i + 2] = lo[2];
  }
  ctx.putImageData(img, 0, 0);
}
/* 画面合成：CMYK 校样／分色时，先照旧合成（不叠画），查表，再叠画 */
const vc0 = AiView.viewComposite;
AiView.viewComposite = function(c0, s, target){
  const lut = lutFor();
  if (!lut) return vc0.apply(this, arguments);
  const od = this.drawOverlays; this.drawOverlays = function(){};
  try { vc0.call(this, c0, s, target); } finally { this.drawOverlays = od; }
  applyLut(target, lut);
  this.drawOverlays(target.getContext('2d'), s);
  return target;
};

/* ═════ 命令 ═════ */
const err = (cmd, m) => ({ok:false, error:`${cmd}: ${m}`});
const prevProof = CMD.map['ai.view.proofSetup'];
CMD.reg('ai.view.proofSetup', {i18n:'', params:'{target?: "workingCmyk"|"legacyMacRgb"|"srgb"|"monitorRgb"|"protanopia"|"deuteranopia", intent?: "perceptual"|"relative"|"saturation"|"absolute", simulatePaper?: bool, proof?: bool（顺便打开校样颜色）} 视图 ▸ 校样设置（colormgmt.rs:388-411；工作中的 CMYK＝VectorCraft Generic CMYK 印刷模型）→ {ok, target, intent, simulatePaper, proofColors}'}, p => {
  const C = 'ai.view.proofSetup';
  let intent = null;
  if (p.intent !== undefined){ intent = parseIntent(p.intent); if (!intent) return err(C, `unknown rendering intent \`${p.intent}\``); }
  if (p.target === 'workingCmyk' || p.target === 'cmyk'){ AiView.proof.target = 'workingCmyk'; if (p.proof === true) AiView.flags.proofColors = true; }
  else if (p.target !== undefined || p.proof !== undefined){ const r = prevProof.run(p); if (r && r.ok === false) return r; }
  if (intent) AiView.proof.intent = intent;
  if (typeof p.simulatePaper === 'boolean') AiView.proof.simulatePaper = p.simulatePaper;
  return {ok:true, target:AiView.proof.target, intent:AiView.proof.intent, simulatePaper:AiView.proof.simulatePaper, proofColors:AiView.flags.proofColors};
});
const platesJson = () => ({on:!!AiView.separations, plates:PLATES.map(n => ({name:n, spot:false, visible:!AiView.separations || AiView.separations.includes(n), rgb:GC.toSrgb(PLATES.map(x => x === n ? 1 : 0), false)}))});
CMD.reg('ai.view.separationsPreview', {i18n:'', params:'{on?: bool, plates?: ["Cyan"|"Magenta"|"Yellow"|"Black"…]（看得见的版）, only?: 版名（只看这一版＝灰阶网点覆盖）, toggle?: 版名} 分色预览（colormgmt.rs:434-461）→ {ok, on, plates:[{name, visible, rgb}]}'}, p => {
  const C = 'ai.view.separationsPreview';
  const check = n => PLATES.includes(n) ? n : null;
  if (typeof p.on === 'boolean') AiView.separations = p.on ? (AiView.separations || PLATES.slice()) : null;
  if (Array.isArray(p.plates)){ const v = []; for (const n of p.plates){ if (!check(n)) return err(C, `unknown plate \`${n}\``); v.push(n); } AiView.separations = v; }
  if (typeof p.only === 'string'){ if (!check(p.only)) return err(C, `unknown plate \`${p.only}\``); AiView.separations = [p.only]; }
  if (typeof p.toggle === 'string'){
    if (!check(p.toggle)) return err(C, `unknown plate \`${p.toggle}\``);
    const vis = AiView.separations || (AiView.separations = PLATES.slice()), i = vis.indexOf(p.toggle);
    if (i >= 0) vis.splice(i, 1); else vis.push(p.toggle);
  }
  return Object.assign({ok:true}, platesJson());
});
/* 校样设置 ▸ 自定…（window.panel separations）：面板照 separations.rs 的栏位做成对话框；确定＝跑 view.separationsPreview／proofSetup／proofColors／overprintPreview */
CMD.reg('ai.view.separations.panel', {i18n:'', params:'{} 视图 ▸ 校样设置 ▸ 自定…：开「分色预览」面板（separations.rs：分色开关、CMYK 四版、校样目标、校样颜色、模拟纸色、叠印预览、演色意图）→ {ok, dialog}'}, () => {
  const P = AiView.proof, sep = AiView.separations;
  const TG = [['workingCmyk', 'ai3v.workingCmyk'], ['legacyMacRgb', 'ai3v.legacyMac'], ['srgb', 'ai3v.srgb'], ['monitorRgb', 'ai3v.monitor'], ['protanopia', 'ai3v.protan'], ['deuteranopia', 'ai3v.deutan']];
  AIObj.Dlg.open('separations', 'ai3v.sepTitle', [
    {key:'sepOn', label:'ai3v.sepOn', type:'check', value:!!sep},
    {key:'Cyan', label:'ai3v.cyan', type:'check', value:!sep || sep.includes('Cyan')}, {key:'Magenta', label:'ai3v.magenta', type:'check', value:!sep || sep.includes('Magenta')},
    {key:'Yellow', label:'ai3v.yellow', type:'check', value:!sep || sep.includes('Yellow')}, {key:'Black', label:'ai3v.black', type:'check', value:!sep || sep.includes('Black')},
    {label:'ai3v.proofSetup', type:'head'},
    {key:'target', label:'ai3v.target', type:'select', value:P.target, options:TG},
    {key:'intent', label:'ai3v.intent', type:'select', value:P.intent, options:INTENTS.map(i => [i, 'ai3v.i.' + i])},
    {key:'proofColors', label:'ai3v.proofColors', type:'check', value:!!AiView.flags.proofColors},
    {key:'simulatePaper', label:'ai3v.simPaper', type:'check', value:!!P.simulatePaper},
    {key:'overprint', label:'ai3v.overprint', type:'check', value:!!AiView.flags.overprint}
  ], v => {
    let r = CMD.run('ai.view.proofSetup', {target:v.target, intent:v.intent, simulatePaper:v.simulatePaper}); if (r && r.ok === false) return r;
    CMD.run('ai.view.proofColors', {on:v.proofColors});
    if (CMD.map['ai.view.overprintPreview']) CMD.run('ai.view.overprintPreview', {on:v.overprint});
    return CMD.run('ai.view.separationsPreview', v.sepOn ? {plates:PLATES.filter(n => v[n])} : {on:false});
  });
  return {ok:true, dialog:'separations'};
});

/* ═════ 边角构件（corners.rs CornerWidgets／CornerDrag） ═════ */
const flags = AiView.flags;
if (flags.cornerWidgets === undefined) flags.cornerWidgets = true;     // state.rs:174 corner_widgets 预设开
if (flags.textThreads === undefined) flags.textThreads = true;         // state.rs:176 text_threads 预设开
const flip = (key, p) => { const v = typeof p.on === 'boolean' ? p.on : !flags[key]; flags[key] = v; return v; };
CMD.reg('ai.view.cornerWidget', {i18n:'', params:'{on?: bool} 视图 ▸ 隐藏／显示边角构件：选取／直接选择工具单选一个矩形时，四角内侧的圆点（拖它＝四角一起改圆角）→ {ok, on}'}, p => ({ok:true, on:flip('cornerWidgets', p)}));
CMD.reg('ai.view.textThreads', {i18n:'', params:'{on?: bool} 视图 ▸ 隐藏／显示文本串接：选中的串接文字框之间画连线（串接资料 Doc.aiR3.textThreads）→ {ok, on}'}, p => ({ok:true, on:flip('textThreads', p)}));
const MIN_INSET_PX = 10, MIN_SIDE_PX = 3 * MIN_INSET_PX;
const CORNERS = [[[0, 0], [1, 1]], [[1, 0], [-1, 1]], [[1, 1], [-1, -1]], [[0, 1], [1, -1]]];
/* CornerWidgets::of：选取正好一个能编辑的活矩形；widget 中心（文件坐标） */
AiView.cornerWidgets = function(zoom){
  if (!this.active() || !flags.cornerWidgets || !window.VecSel || VecSel.shapes.length !== 1) return null;
  const L = VecSel.layer(); if (!L || L.kind !== 'vector' || L.locked) return null;
  const s = L.data.shapes.find(x => x.id === VecSel.shapes[0]);
  if (!s || s.type !== 'rect' || s.locked || s.visible === false || VecSel.anchors[s.id]) return null;
  const w = Math.abs(s.w), h = Math.abs(s.h), x0 = Math.min(s.x, s.x + s.w) + L.x, y0 = Math.min(s.y, s.y + s.h) + L.y, r = +s.radius || 0;
  if (Math.min(w, h) * zoom < MIN_SIDE_PX) return null;
  const pts = CORNERS.map(([[fx, fy], [sx, sy]]) => { const ix = Math.min(Math.max(r, MIN_INSET_PX / zoom), w / 2), iy = Math.min(Math.max(r, MIN_INSET_PX / zoom), h / 2); return [x0 + fx * w + sx * ix, y0 + fy * h + sy * iy]; });
  return {L, s, w, h, radius:r, points:pts};
};
const CW_TOOLS = ['move', 'direct'];
R3.overlays.push(function(ctx, s){
  if (!flags.edges || !CW_TOOLS.includes(ToolState.cur)) return;
  const W = AiView.cornerWidgets(UI.zoom); if (!W) return;
  ctx.save(); ctx.lineWidth = 1;
  for (const q of W.points){
    const x = q[0] * s, y = q[1] * s;
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#2f7fd8'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fillStyle = '#2f7fd8'; ctx.fill();
  }
  ctx.restore();
});
/* CornerDrag：按在圆点上（5 屏幕点内）拖＝沿那个角的内对角线改圆角（起始半径＋位移投影/2，夹在 0…短边/2）；拖过 3 点才开始，一步历史 */
let cdrag = null;
function docPt(e){ const b = UI.canvas.getBoundingClientRect(); return [(e.clientX - b.left) / UI.zoom, (e.clientY - b.top) / UI.zoom]; }
function cwDown(e){
  if (e.button !== 0 || !CW_TOOLS.includes(ToolState.cur)) return;
  const W = AiView.cornerWidgets(UI.zoom); if (!W) return;
  const p = docPt(e), tol = 5 / UI.zoom;
  let k = -1, best = Infinity; W.points.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d <= tol && d < best){ best = d; k = i; } });
  if (k < 0) return;
  e.stopImmediatePropagation(); e.preventDefault();
  try { UI.canvas.setPointerCapture(e.pointerId); } catch (x){}
  cdrag = {W, k, start:p, began:false, r0:W.radius};
}
function cwMove(e){
  if (!cdrag) return;
  e.stopImmediatePropagation();
  const p = docPt(e), d = cdrag;
  if (!d.began){ if (Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) < 3 / UI.zoom) return; d.began = true; History.push(); }
  const [, [sx, sy]] = CORNERS[d.k];
  d.W.s.radius = Math.min(Math.max(d.r0 + ((p[0] - d.start[0]) * sx + (p[1] - d.start[1]) * sy) / 2, 0), Math.min(d.W.w, d.W.h) / 2);
  Layer.invalidate(d.W.L); UI.draw();
}
function cwUp(e){ if (!cdrag) return; e.stopImmediatePropagation(); cdrag = null; UI.refresh(); }
function hookCanvas(){
  if (!window.UI || !UI.canvas || UI.canvas.__r3cw) return;
  UI.canvas.__r3cw = true;
  UI.canvas.addEventListener('pointerdown', cwDown, true);
  UI.canvas.addEventListener('pointermove', cwMove, true);
  UI.canvas.addEventListener('pointerup', cwUp, true);
}
/* index.html 里本档比 ui.js 先载：DOMContentLoaded 时 UI.init 还没跑（它的监听排在后面），所以等一拍再挂 */
if (window.UI && UI.canvas) hookCanvas(); else window.addEventListener('DOMContentLoaded', () => setTimeout(hookCanvas, 0));

/* ═════ 文本串接线（canvas.rs:943-961 thread_overlay） ═════ */
R3.overlays.push(function(ctx, s){
  if (!flags.edges || !flags.textThreads) return;
  const th = (Doc.aiR3 && Array.isArray(Doc.aiR3.textThreads)) ? Doc.aiR3.textThreads : [];
  const sel = (window.AiSel && AiSel.text) || [];
  for (const t of th){
    if (!t.some(id => sel.includes(id))) continue;
    const fr = t.map(id => Doc.byId(id)).filter(L => L && L.kind === 'text').map(L => AiSel.textBounds(L));
    ctx.save(); ctx.strokeStyle = '#2f7fd8'; ctx.lineWidth = 1;
    for (let i = 0; i + 1 < fr.length; i++){
      const o = [fr[i].x1 * s, fr[i].y1 * s], n = [fr[i + 1].x0 * s, fr[i + 1].y0 * s];
      ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(n[0], n[1]); ctx.stroke();
      for (const q of [o, n]){ ctx.fillStyle = '#fff'; ctx.fillRect(q[0] - 3.5, q[1] - 3.5, 7, 7); ctx.strokeRect(q[0] - 3.5, q[1] - 3.5, 7, 7); ctx.beginPath(); ctx.moveTo(q[0] - 2, q[1]); ctx.lineTo(q[0] + 2, q[1]); ctx.stroke(); }
    }
    ctx.restore();
  }
});

Lang.add({
  'zh-Hant':{'ai3v.sepTitle':'分色預視', 'ai3v.sepOn':'疊印預視（分色）', 'ai3v.cyan':'青色', 'ai3v.magenta':'洋紅色', 'ai3v.yellow':'黃色', 'ai3v.black':'黑色',
    'ai3v.proofSetup':'校樣設定', 'ai3v.target':'模擬裝置', 'ai3v.intent':'演算比對方式', 'ai3v.proofColors':'校樣色彩', 'ai3v.simPaper':'模擬紙張顏色', 'ai3v.overprint':'疊印預視',
    'ai3v.workingCmyk':'工作中的 CMYK', 'ai3v.legacyMac':'舊版 Macintosh RGB (Gamma 1.8)', 'ai3v.srgb':'網際網路標準 RGB (sRGB)', 'ai3v.monitor':'顯示器 RGB', 'ai3v.protan':'色盲 - 紅色盲類型', 'ai3v.deutan':'色盲 - 綠色盲類型',
    'ai3v.i.perceptual':'感應式', 'ai3v.i.relative':'相對公制色度', 'ai3v.i.saturation':'飽和度', 'ai3v.i.absolute':'絕對公制色度'},
  'zh-Hans':{'ai3v.sepTitle':'分色预览', 'ai3v.sepOn':'叠印预览（分色）', 'ai3v.cyan':'青色', 'ai3v.magenta':'洋红', 'ai3v.yellow':'黄色', 'ai3v.black':'黑色',
    'ai3v.proofSetup':'校样设置', 'ai3v.target':'要模拟的设备', 'ai3v.intent':'渲染方法', 'ai3v.proofColors':'校样颜色', 'ai3v.simPaper':'模拟纸张颜色', 'ai3v.overprint':'叠印预览',
    'ai3v.workingCmyk':'工作中的 CMYK', 'ai3v.legacyMac':'旧版 Macintosh RGB (Gamma 1.8)', 'ai3v.srgb':'Internet 标准 RGB (sRGB)', 'ai3v.monitor':'显示器 RGB', 'ai3v.protan':'色盲 - 红色盲类型', 'ai3v.deutan':'色盲 - 绿色盲类型',
    'ai3v.i.perceptual':'可感知', 'ai3v.i.relative':'相对比色', 'ai3v.i.saturation':'饱和度', 'ai3v.i.absolute':'绝对比色'},
  en:{'ai3v.sepTitle':'Separations Preview', 'ai3v.sepOn':'Overprint Preview (separations)', 'ai3v.cyan':'Cyan', 'ai3v.magenta':'Magenta', 'ai3v.yellow':'Yellow', 'ai3v.black':'Black',
    'ai3v.proofSetup':'Proof Setup', 'ai3v.target':'Device to Simulate', 'ai3v.intent':'Rendering Intent', 'ai3v.proofColors':'Proof Colors', 'ai3v.simPaper':'Simulate Paper Color', 'ai3v.overprint':'Overprint Preview',
    'ai3v.workingCmyk':'Working CMYK', 'ai3v.legacyMac':'Legacy Macintosh RGB (Gamma 1.8)', 'ai3v.srgb':'Internet Standard RGB (sRGB)', 'ai3v.monitor':'Monitor RGB', 'ai3v.protan':'Color blindness – Protanopia-type', 'ai3v.deutan':'Color blindness – Deuteranopia-type',
    'ai3v.i.perceptual':'Perceptual', 'ai3v.i.relative':'Relative Colorimetric', 'ai3v.i.saturation':'Saturation', 'ai3v.i.absolute':'Absolute Colorimetric'}
});
})();

/* 视图 ▸ 隐藏切片／锁定切片／显示打印拼贴，与切片、其余画板的画面叠画（照 VectorCraft 原码）
     engine/src/cmd/slices.rs:111-121, 579-589  view.slices.hide／lock（session 状态；菜单 menus.rs:1158, 1210：隐藏切片↔显示切片、锁定切片打勾）
     ui-egui/src/canvas.rs:306-314, 966-1011    切片叠画（隐藏切片时不画；线色 prefs slice_line_color #ff3f3f、选中 2 点、自动切片 55% 虚线、编号牌 show_slice_numbers 预设开）
     engine/src/cmd/printtiling.rs 1-109、pdf/src/print/tiling.rs 32-80、layout.rs 165-260、settings.rs:223-255
         view.printTiling（每份文件自己的开关）：画出打印设置的页面——我们没有打印设置，用原码预设算：Letter 612×792、不缩放、
         自动旋转（画板横的就横放）、置中、边距 0 ⇒ 每个画板一页，纸张置中在画板上；canvas.rs:1013-1042 画法（灰 96、纸边 0.75 点实线、可印区虚线、左上角页码）
     ui-egui/src/canvas.rs 画板外框：第 0 个画板＝画布本身；其余画板（转换为画板做出来的）画黑框＋左上名字 */
(function(){
'use strict';
if (!window.AiView || !window.AiR3 || window.__aiR3_slicesView) return; window.__aiR3_slicesView = true;
const R3 = window.AiR3, F = AiView.flags;
if (F.slicesHidden === undefined) F.slicesHidden = false;
if (F.slicesLocked === undefined) F.slicesLocked = false;
if (F.printTiling === undefined) F.printTiling = false;
CMD.reg('ai.view.slices.hide', {i18n:'', params:'{hidden?: bool} 视图 ▸ 隐藏切片／显示切片（切换或设定；session 状态）→ {ok, hidden}'}, p => {
  F.slicesHidden = typeof p.hidden === 'boolean' ? p.hidden : !F.slicesHidden; return {ok:true, hidden:F.slicesHidden};
});
CMD.reg('ai.view.slices.lock', {i18n:'', params:'{locked?: bool} 视图 ▸ 锁定切片（切换或设定）：锁住的切片不能用 ai.object.slice.select 选、不能移动 → {ok, locked}'}, p => {
  F.slicesLocked = typeof p.locked === 'boolean' ? p.locked : !F.slicesLocked; return {ok:true, locked:F.slicesLocked};
});
/* 锁住的切片：切片选择工具那一路（object.slice.select／move）不能动 */
['ai.object.slice.select', 'ai.object.slice.move'].forEach(id => {
  const c = CMD.map[id]; if (!c) return;
  const run = c.run;
  c.run = function(p){ if (F.slicesLocked && (id === 'ai.object.slice.move' || (p && Array.isArray(p.slices) && p.slices.length))) return {ok:false, error:id + ': slices are locked (View ▸ Lock Slices)'}; return run.apply(this, arguments); };
});
/* 打印拼贴的页面（预设打印设置） */
function tilingPages(){
  const PW = 612, PH = 792, out = [];
  R3.artboards().forEach((a, i) => {
    const r = a.rect, w = r.x1 - r.x0, h = r.y1 - r.y0; if (!(w > 0 && h > 0)) return;
    const land = (w > h) !== (PW > PH);                                            // auto_rotate
    const pw = land ? PH : PW, ph = land ? PW : PH;
    const x0 = r.x0 - (pw - w) / 2, y0 = r.y0 - (ph - h) / 2;                       // Placement::Center、margin 0、不缩放
    out.push({artboard:i, number:out.length + 1, printed:true, page:[x0, y0, x0 + pw, y0 + ph], imageable:[x0, y0, x0 + pw, y0 + ph]});
  });
  return out;
}
R3.tilingPages = tilingPages;
CMD.reg('ai.view.printTiling', {i18n:'', params:'{on?: bool} 视图 ▸ 显示／隐藏打印拼贴：画面画出打印页面（打印设置用原码预设：Letter、不缩放、自动旋转、置中、边距 0）→ {ok, on, pages}'}, p => {
  F.printTiling = typeof p.on === 'boolean' ? p.on : !F.printTiling; return {ok:true, on:F.printTiling, pages:(R3.tilingPages || tilingPages)()};
});
/* ── 叠画 ── */
const LINE = '#ff3f3f';
R3.overlays.push(function(ctx, s){                                // 其余画板
  const all = R3.artboards(); if (all.length < 2 || !F.artboards) return;
  ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.font = '10px sans-serif'; ctx.textBaseline = 'bottom';
  for (const a of all.slice(1)){ const r = a.rect; ctx.strokeRect(Math.round(r.x0 * s) + .5, Math.round(r.y0 * s) + .5, Math.round((r.x1 - r.x0) * s), Math.round((r.y1 - r.y0) * s)); ctx.fillText(`${a.index + 1} - ${a.name}`, r.x0 * s, r.y0 * s - 2); }
  ctx.restore();
});
R3.overlays.push(function(ctx, s){                                // 打印拼贴
  if (!F.printTiling) return;
  ctx.save(); ctx.strokeStyle = 'rgb(96,96,96)'; ctx.fillStyle = 'rgb(96,96,96)'; ctx.font = '10px sans-serif'; ctx.textBaseline = 'top';
  for (const pg of (R3.tilingPages || tilingPages)()){
    const [a, b, c, d] = pg.page.map(v => v * s);
    ctx.lineWidth = 0.75; ctx.setLineDash([]); ctx.strokeRect(a, b, c - a, d - b);
    const [e, f, g, h] = pg.imageable.map(v => v * s);
    ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.strokeRect(e, f, g - e, h - f);
    ctx.fillText(String(pg.number), e + 3, f + 2);
  }
  ctx.restore();
});
R3.overlays.push(function(ctx, s){                                // 切片
  if (F.slicesHidden || !R3.sliceLayout) return;
  const L = R3.sliceLayout(); if (!L.length) return;
  const sel = R3.selectedSlices();
  ctx.save(); ctx.font = '9px sans-serif'; ctx.textBaseline = 'top';
  for (const a of L){
    const auto = a.source === 'auto', on = !!a.id && sel.includes(a.id);
    const x = a.rect.x0 * s, y = a.rect.y0 * s, w = (a.rect.x1 - a.rect.x0) * s, h = (a.rect.y1 - a.rect.y0) * s;
    ctx.globalAlpha = auto ? 0.55 : 1; ctx.strokeStyle = LINE; ctx.lineWidth = on ? 2 : 1; ctx.setLineDash(auto ? [3, 3] : []);
    ctx.strokeRect(x + .5, y + .5, w, h);
    const t = String(a.number).padStart(2, '0'), tw = ctx.measureText(t).width;
    ctx.setLineDash([]); ctx.fillStyle = LINE; ctx.fillRect(x + 1, y + 1, tw + 6, 11); ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.fillText(t, x + 4, y + 2);
  }
  ctx.restore();
});
})();


/* persp（视图 ▸ 透视网格）：照 vectorcraft 原码抄
     engine/src/cmd/perspgrid.rs:25-445        perspective.grid.get／define／preset、presets.list／save／delete／export／import、widget.options、grid.lock／lockStation／snap／rulers（视图状态、不进历史）
     engine/src/cmd/distortcmds.rs:718-742     perspective.grid.set／show
     ui-egui/src/menus.rs:1093-1104、1163-1164、1237-1239  定义网格…／将网格存储为预设…、对齐网格与锁定站点打勾、显示↔隐藏网格／标尺、锁定↔解锁网格换名
     ui-egui/src/dialogs/perspective_grid.rs:1-338  定义透视网格对话框（预设下拉、类型、单位（换单位长度跟着换算）、缩放 1:1…1:100／自定、网格线间隔、视角、视距、水平高度、第三个消失点、三色、不透明度）；
                                                  存储预设…／将网格存储为预设…＝同一个对话框的 save 模式（名称），确定跑 perspective.presets.save
     tools/src/distort/perspective.rs:766-815  叠画：三个平面的格线（平面色＋不透明度）、现用平面外框 2 点、地平线虚线、标尺（view.rs:79-103）、平面切换小部件（widget.rs）、平面小部件菱形（655-668）
     engine/src/cmd/perspgrid.rs:449-466       按平面切换小部件选现用平面
   预设存在 localStorage（＝原码 prefs.perspective_presets）；小部件选项同（prefs.perspective_widget）。 */
(function(){
'use strict';
if (window.__aiR3_perspV) return; window.__aiR3_perspV = true;
const R3 = window.AiR3, P = window.AiPersp;
if (!R3 || !P) return;
const clone = o => JSON.parse(JSON.stringify(o));
const fin = v => typeof v === 'number' && isFinite(v);
const err = (c, m) => ({ok:false, error:c + ': ' + m});
const reg = (id, meta, fn) => CMD.reg(id, Object.assign({i18n:''}, meta), p => fn(p || {}));
const redraw = () => { if (window.UI && UI.draw) UI.draw(); };
const T = k => (window.Lang ? Lang.t(k) : k);

/* ═══════════ 偏好（预设、小部件选项）：localStorage ═══════════ */
const LS_P = 'dlAiPerspectivePresets', LS_W = 'dlAiPerspectiveWidget';
const ls = {get(k, d){ try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e){ return d; } }, set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e){} }};
const saved = () => { const a = ls.get(LS_P, []); return Array.isArray(a) ? a : []; };
const setSaved = a => ls.set(LS_P, a);
const widgetOpts = () => Object.assign({show:true, position:'topLeft'}, ls.get(LS_W, {}));
/* perspgrid.rs:155-210 预设：内建（套到第一个画板）＋使用者存的 */
const presetAb = () => P.ab0();
function presets(){ const ab = presetAb(); return P.BUILTINS.map(b => P.definition(P.builtin(b[0], ab))).concat(saved().map(clone)); }
const savedIndex = n => saved().findIndex(q => String(q.name).toLowerCase() === String(n).trim().toLowerCase());
function presetDef(name){ const g = P.builtin(name, presetAb()); if (g) return P.definition(g); const i = savedIndex(name); return i >= 0 ? clone(saved()[i]) : null; }
function presetGrid(name, ab){
  const b = P.builtin(name, ab); if (b) return b;
  const d = presetDef(name); if (!d) return null;
  const r = P.withDefinition(P.normal(d.kind, ab), d); return r.g || null;
}
const taken = (n, except) => P.isBuiltin(n) || (i => i >= 0 && i !== except)(savedIndex(n));
function newPresetName(){ for (let i = 1; ; i++){ const n = `Perspective Preset ${i}`; if (!taken(n, -1)) return n; } }
function presetNamed(def, cands){ for (const n of cands){ if (!n) continue; const p = presetDef(n); if (p && P.defSame(p, def)) return p.name; } return ''; }
function uniqueName(base){ if (!taken(base, -1)) return base; for (let i = 2; ; i++){ const n = `${base} ${i}`; if (!taken(n, -1)) return n; } }

/* ═══════════ 命令 ═══════════ */
/* perspgrid.rs:213-226 grid.get */
function gridInfo(g){
  const st = P.station(g), attached = {};
  P.attachedRoots().forEach(r => { attached[r.t.kind === 'shape' ? r.t.s.id : r.t.L.id] = r.plane; });
  const grid = clone(g); delete grid.attached;
  return {ok:true, grid, define:P.definition(g), station:{x:st.x, y:g.horizon, distance:st.distance}, defined:P.defined(), attached};
}
reg('ai.perspective.grid.get', {undoable:false, params:'{} 读透视网格 → {ok, grid:模型（同 ai.perspective.grid.set 的栏位）, define:定义网格栏位（同 ai.perspective.grid.define）, station:{x, y, distance}（观者：地平线上的视觉中心、到画面的距离，点）, defined:文件还在用缺省网格时 false, attached:{物件 id: 平面}}'}, () => gridInfo(P.current()));
/* perspgrid.rs:228-242 grid.define（没变就不推历史） */
R3.regEdit('ai.perspective.grid.define', {params:'{name?: 预设名（"" = 自定）, kind?: 1|2|3, units?: 单位名（points、pixels、inches、centimeters、millimeters、picas、meters、yards、feet…）, scale?: [画板, 真实世界], gridline?: 网格线间隔, angle?: 视角（0–90°）, distance?: 视距, horizonHeight?: 地平线离地面高度, thirdVp?: [x 向右, y 向上]（离视觉中心；三点透视）, leftColor?, rightColor?, groundColor?: "#rrggbb", opacity?: 0–100} 长度是 units 下、按 scale 的真实世界长度；缺的栏位照现在的网格（见 ai.perspective.grid.get 的 define）。只改有变的：新类型／视角／视距绕站点移动消失点。一步历史 → {ok, define}'}, (p, touch) => {
  const C = 'ai.perspective.grid.define';
  const old = P.current();
  const dm = P.defMerged(P.definition(old), p); if (dm.err) return err(C, dm.err);
  const r = P.withDefinition(old, dm.d); if (r.err) return err(C, r.err);
  const g = r.g;
  g.name = presetNamed(P.definition(g), [dm.d.name, old.name]);
  if (!P.sameGrid(g, old)){ touch(); P.store(g); redraw(); }
  return {ok:true, define:P.definition(g)};
});
/* distortcmds.rs:718-736 grid.set */
reg('ai.perspective.grid.set', {undoable:true, params:'{kind?: 1|2|3, origin?: [x,y], horizon?, vpLeft?, vpRight?, vpVertical?: [x,y], distance?, cell?, extent?, height?, visible?, plane?, leftOffset?, rightOffset?, groundOffset?: 点（平面沿法线移动）, reproject?: bool} 合进文件的网格。透视中的物件照原样留着；reproject 时跟着网格走（各自保持在平面上的位置）→ {ok, grid}'}, p => {
  const C = 'ai.perspective.grid.set';
  const old = P.current(); const m = P.merged(old, p); if (m.err) return err(C, m.err);
  const g = m.g;
  if (p.reproject){
    for (const r of P.attachedRoots()){
      const ho = P.homographyAt(old, r.plane, r.depth), hi = ho && P.Hm.inverse(ho), hn = P.homographyAt(g, r.plane, r.depth);
      if (!hi || !hn) return err(C, 'an object in perspective would leave the edited grid');
      const x = AiPerspObj.warp(r.t, P.Hm.then(hn, hi)); if (x) return err(C, x);
    }
  }
  P.store(g); redraw();
  const o = clone(g); delete o.attached; return {ok:true, grid:o};
});
/* perspgrid.rs:246-263 grid.preset：重设成套到第一个画板的预设（显示；附加的物件留着、视图选项照旧） */
reg('ai.perspective.grid.preset', {undoable:true, params:'{kind: 1|2|3（该类型的正常视图）| name: 预设名（见 ai.perspective.presets.list）} 视图 ▸ 透视网格 ▸ 一点／两点／三点透视：网格重设成套到第一个画板的预设并显示（附加的物件留着）→ {ok, grid}'}, p => {
  const C = 'ai.perspective.grid.preset';
  let name;
  if (typeof p.name === 'string') name = p.name;
  else if ([1, 2, 3].includes(p.kind)) name = P.normal(p.kind, P.LETTER).name;
  else return err(C, 'kind must be 1, 2 or 3, or give a preset `name` (see ai.perspective.presets.list)');
  const old = P.current();
  const g0 = presetGrid(name, P.ab0()); if (!g0) return err(C, `no perspective grid preset named \`${name}\``);
  const g = Object.assign(g0, {locked:old.locked, lockStation:old.lockStation, snap:old.snap, rulers:old.rulers});
  P.store(g); redraw();
  const o = clone(g); delete o.attached; return {ok:true, grid:o};
});
/* distortcmds.rs:705-716 silent ＋ 738-742 grid.show、perspgrid.rs:393-417 视图选项 */
function silent(f){ const g = P.current(); f(g); P.store(g); redraw(); return g; }
reg('ai.perspective.grid.show', {undoable:false, params:'{visible?: bool}（不给＝切换）视图 ▸ 透视网格 ▸ 显示网格／隐藏网格（Ctrl+Shift+I）。视图状态、不进历史 → {ok, visible}'}, p => {
  const g = silent(g => { g.visible = typeof p.visible === 'boolean' ? p.visible : !g.visible; }); return {ok:true, visible:g.visible};
});
const viewOpt = (id, field, label, desc) => reg(id, {undoable:false, params:`{on?: bool}（不给＝切换）视图 ▸ 透视网格 ▸ ${label}：${desc}。视图状态、不进历史 → {ok, on}`}, p => {
  const g = silent(g => { g[field] = typeof p.on === 'boolean' ? p.on : !g[field]; }); return {ok:true, on:g[field]};
});
viewOpt('ai.perspective.grid.lock', 'locked', '锁定网格', '网格的控制点不能拖（平面切换小部件照样能用）');
viewOpt('ai.perspective.grid.lockStation', 'lockStation', '锁定站点', '拖一个消失点时另一个绕站点转（视角变、观者不动）');
viewOpt('ai.perspective.grid.snap', 'snap', '对齐网格', '在透视中画或移动的图稿在四分之一格内落到格线（缺省开）');
viewOpt('ai.perspective.grid.rulers', 'rulers', '显示标尺', '沿平面相交的竖线画一条标尺，按网格的单位与缩放');
/* perspgrid.rs:265-276 presets.list */
reg('ai.perspective.presets.list', {undoable:false, params:'{} → {ok, presets:[{builtIn, name, kind, …定义网格栏位}]}：先内建视图（套到第一个画板、受保护），再存的预设'}, () =>
  ({ok:true, presets:presets().map(d => Object.assign(d, {builtIn:P.isBuiltin(d.name)}))}));
/* perspgrid.rs:278-311 presets.save */
reg('ai.perspective.presets.save', {undoable:false, params:'{name?:（缺省＝新的「Perspective Preset N」）, newName?: 改名, preset?: 从哪个预设起（缺省＝存过的 name，否则文件的网格）, …定义网格栏位（盖在上面）} 新建或修改一个存的预设（将网格存储为预设：只给 name）；内建的受保护 → {ok, name, created, definition}'}, p => {
  const C = 'ai.perspective.presets.save';
  let name;
  if (typeof p.name === 'string'){ name = p.name.trim(); if (!name) return err(C, '`name` is empty'); } else name = newPresetName();
  if (P.isBuiltin(name)) return err(C, `\`${name}\` is a built-in preset and can't change: save it under another name`);
  const list = saved(), at = savedIndex(name), old = at >= 0 ? list[at] : null;
  let base;
  if (typeof p.preset === 'string'){ base = presetDef(p.preset); if (!base) return err(C, `no perspective grid preset named \`${p.preset}\` (see ai.perspective.presets.list)`); }
  else base = old ? clone(old) : P.definition(P.current());
  const dm = P.defMerged(base, p); if (dm.err) return err(C, dm.err);
  const def = dm.d;
  if (typeof p.newName === 'string'){
    const nn = p.newName.trim(); if (!nn) return err(C, '`newName` is empty');
    if (taken(nn, at)) return err(C, `a preset named \`${nn}\` exists`);
    def.name = nn;
  } else def.name = old ? old.name : name;
  if (at >= 0) list[at] = def; else list.push(def);
  setSaved(list);
  return {ok:true, name:def.name, created:at < 0, definition:def};
});
/* perspgrid.rs:313-321 presets.delete */
reg('ai.perspective.presets.delete', {undoable:false, params:'{name} 删掉一个存的预设（内建的留着）→ {ok, deleted}'}, p => {
  const C = 'ai.perspective.presets.delete';
  if (typeof p.name !== 'string') return err(C, 'missing `name`');
  if (P.isBuiltin(p.name)) return err(C, `\`${p.name}\` is a built-in preset and stays`);
  const list = saved(), i = savedIndex(p.name); if (i < 0) return err(C, `no saved preset named \`${p.name}\``);
  const d = list.splice(i, 1)[0]; setSaved(list); return {ok:true, deleted:d.name};
});
/* perspgrid.rs:323-391 presets.export／import（.vcperspective 文字；浏览器版只走 data） */
reg('ai.perspective.presets.export', {undoable:false, params:'{names?: [预设名，内建的也可以]（缺省＝全部存的预设）} → {ok, data: .vcperspective 档的文字（JSON）, count}'}, p => {
  const C = 'ai.perspective.presets.export';
  let list;
  if (Array.isArray(p.names)){ list = []; for (const n of p.names){ const d = presetDef(String(n)); if (!d) return err(C, `no perspective grid preset named \`${n}\``); list.push(d); } }
  else list = saved();
  if (!list.length) return err(C, 'no saved presets to export (name built-in ones in `names`)');
  return {ok:true, data:JSON.stringify({format:'vcperspective', presets:list}, null, 2), count:list.length};
});
reg('ai.perspective.presets.import', {undoable:false, params:'{data: .vcperspective 档的文字, replace?: false（同名的存的预设换掉；否则名字被占就加编号）} 把档里的预设加进存的预设 → {ok, imported:[名字]}'}, p => {
  const C = 'ai.perspective.presets.import';
  if (typeof p.data !== 'string') return err(C, 'give `data`');
  let file; try { file = JSON.parse(p.data); } catch (e){ return err(C, 'not a perspective grid presets file: ' + e.message); }
  if (!file || file.format !== 'vcperspective') return err(C, `not a perspective grid presets file (format \`${file && file.format}\`)`);
  const arr = Array.isArray(file.presets) ? file.presets : [];
  if (arr.length > 1000) return err(C, 'more than 1000 presets');
  const base = P.definition(P.normal(2, P.LETTER)), defs = [];
  for (const v of arr){ const m = P.defMerged(base, v); if (m.err) return err(C, `\`${(v && v.name) || '?'}\`: ${m.err}`); defs.push(m.d); }
  const imported = [], replace = !!p.replace;
  for (const d of defs){
    const nm = String(d.name).trim().replace(/^\[+/, '').replace(/\]+$/, '').trim();
    const b = nm || 'Perspective Preset';
    const list = saved(), i = replace ? savedIndex(b) : -1;
    if (i >= 0){ d.name = list[i].name; list[i] = d; } else { d.name = uniqueName(b); list.push(d); }
    imported.push(d.name); setSaved(list);
  }
  return {ok:true, imported};
});
/* perspgrid.rs:432-444 widget.options */
reg('ai.perspective.widget.options', {undoable:false, params:'{show?: bool, position?: topLeft|topRight|bottomLeft|bottomRight} 平面切换小部件：显示与否、放在哪个角（存进偏好；不给参数＝读）→ {ok, show, position}'}, p => {
  const C = 'ai.perspective.widget.options', o = widgetOpts();
  if (p.show !== undefined){ if (typeof p.show !== 'boolean') return err(C, 'show must be true or false'); o.show = p.show; }
  if (p.position !== undefined){
    const c = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].find(x => x.toLowerCase() === String(p.position).replace(/\s+/g, '').toLowerCase());
    if (!c) return err(C, 'position must be topLeft, topRight, bottomLeft or bottomRight'); o.position = c;
  }
  ls.set(LS_W, o); redraw(); return Object.assign({ok:true}, o);
});

/* ═══════════ 对话框（dialogs/perspective_grid.rs） ═══════════ */
const SCALES = [['1:1', [1, 1]], ['1:2', [1, 2]], ['1:4', [1, 4]], ['1:8', [1, 8]], ['1:12', [1, 12]], ['1:24', [1, 24]], ['1:48', [1, 48]], ['1:96', [1, 96]], ['1:100', [1, 100]]];
const DUNITS = P.UNITS.filter(u => u.key !== 'feetInches');
const LENGTHS = ['gridline', 'distance', 'horizonHeight', 'vp3x', 'vp3y'];
const r4 = v => +(+v).toFixed(4);
/* mode：''＝定义网格；'save'＝将网格存储为预设（from:'define'＝从定义网格的「存储预设…」来，存完回去） */
function openGridDialog(def, mode, from){
  const isSave = mode === 'save';
  const sc = def.scale, named = SCALES.find(s => s[1][0] === sc[0] && s[1][1] === sc[1]);
  const list = presets();
  const cur = list.find(p => p.name === def.name && P.defSame(p, def));
  const fields = [];
  if (isSave) fields.push({key:'name', label:'ai3persp.name', type:'text', value:def.name});
  else fields.push({key:'preset', label:'ai3persp.preset', type:'select', value:cur ? cur.name : '', options:[['', 'ai3persp.custom']].concat(list.map(p => [p.name, p.name]))});
  fields.push({type:'head', label:'ai3persp.settings'},
    {key:'kind', label:'ai3persp.type', type:'select', value:String(def.kind), options:[['1', 'ai3persp.k1'], ['2', 'ai3persp.k2'], ['3', 'ai3persp.k3']]},
    {key:'units', label:'ai3persp.units', type:'select', value:P.unitOf(def.units).key, options:DUNITS.map(u => [u.key, 'ai3persp.u.' + u.key])},
    {key:'scale', label:'ai3persp.scale', type:'select', value:named ? named[0] : 'custom', options:SCALES.map(s => [s[0], s[0]]).concat([['custom', 'ai3persp.scaleCustom']])},
    {key:'scaleA', label:'ai3persp.scaleA', type:'number', value:sc[0], enabled:!named},
    {key:'scaleR', label:'ai3persp.scaleR', type:'number', value:sc[1], enabled:!named},
    {key:'gridline', label:'ai3persp.gridline', type:'number', value:r4(def.gridline)},
    {key:'angle', label:'ai3persp.angle', type:'number', value:r4(def.angle), enabled:def.kind !== 1},
    {key:'distance', label:'ai3persp.distance', type:'number', value:r4(def.distance)},
    {key:'horizonHeight', label:'ai3persp.horizon', type:'number', value:r4(def.horizonHeight)},
    {key:'vp3x', label:'ai3persp.vp3x', type:'number', value:r4(def.thirdVp[0]), enabled:def.kind === 3},
    {key:'vp3y', label:'ai3persp.vp3y', type:'number', value:r4(def.thirdVp[1]), enabled:def.kind === 3},
    {type:'head', label:'ai3persp.colors'},
    {key:'leftColor', label:'ai3persp.left', type:'color', value:def.leftColor},
    {key:'rightColor', label:'ai3persp.right', type:'color', value:def.rightColor},
    {key:'groundColor', label:'ai3persp.ground', type:'color', value:def.groundColor},
    {key:'opacity', label:'ai3persp.opacity', type:'number', value:def.opacity});
  const toParams = v => {
    const scale = v.scale === 'custom' ? [v.scaleA, v.scaleR] : (SCALES.find(s => s[0] === v.scale) || SCALES[0])[1].slice();
    const o = {kind:+v.kind, units:v.units, scale, gridline:v.gridline, angle:v.angle, distance:v.distance, horizonHeight:v.horizonHeight, thirdVp:[v.vp3x, v.vp3y],
      leftColor:v.leftColor, rightColor:v.rightColor, groundColor:v.groundColor, opacity:Math.round(Math.max(0, Math.min(100, v.opacity)))};
    if (isSave) o.name = v.name; else o.name = v.preset || '';
    return o;
  };
  const bg = R3.form('perspectiveGrid', isSave ? 'ai3persp.save' : 'ai3persp.define', fields, v => {
    exactOf(v);
    const params = toParams(v);
    if (isSave){
      const r = CMD.run('ai.perspective.presets.save', params);
      if (r && r.ok === false) return r;
      if (from === 'define'){ const back = Object.assign(clone(def), params, {name:r.name}); delete back.preset; setTimeout(() => openGridDialog(back, ''), 0); }
      return r;
    }
    return CMD.run('ai.perspective.grid.define', params);
  });
  bg.dataset.kind = 'perspectiveGrid';
  const box = bg.querySelector('.box'), el = k => box.querySelector(`[name="${k}"]`);
  /* 栏位显示四位小数，确切值记在 data-exact：显示值没被改就用确切值（原码栏位存的是确切值，没改的栏位不会动到网格） */
  const EXACT = LENGTHS.concat(['angle', 'opacity', 'scaleA', 'scaleR']);
  const setNum = (k, v) => { const e = el(k); e.value = r4(v); e.dataset.exact = String(v); };
  const exactOf = v => { EXACT.forEach(k => { const e = el(k); if (e && e.dataset.exact !== undefined && r4(+e.dataset.exact) === v[k]) v[k] = +e.dataset.exact; }); return v; };
  [['scaleA', sc[0]], ['scaleR', sc[1]], ['gridline', def.gridline], ['angle', def.angle], ['distance', def.distance], ['horizonHeight', def.horizonHeight],
    ['vp3x', def.thirdVp[0]], ['vp3y', def.thirdVp[1]], ['opacity', def.opacity]].forEach(([k, v]) => setNum(k, v));
  const setDis = () => { const k = +el('kind').value; el('angle').disabled = k === 1; el('vp3x').disabled = el('vp3y').disabled = k !== 3; const c = el('scale').value === 'custom'; el('scaleA').disabled = el('scaleR').disabled = !c; };
  /* 换单位：长度跟着换算（perspective_grid.rs:252-267） */
  let shown = P.unitOf(def.units);
  el('units').addEventListener('change', () => {
    const u = P.unitOf(el('units').value), f = shown.points / u.points; shown = u;
    LENGTHS.forEach(k => { const e = el(k), v = parseFloat(e.value); if (!isFinite(v)) return; const x = (e.dataset.exact !== undefined && r4(+e.dataset.exact) === v) ? +e.dataset.exact : v; setNum(k, x * f); });
  });
  el('kind').addEventListener('change', setDis);
  el('scale').addEventListener('change', () => { const s = SCALES.find(x => x[0] === el('scale').value); if (s){ setNum('scaleA', s[1][0]); setNum('scaleR', s[1][1]); } setDis(); });
  if (!isSave){
    /* 预设下拉：选一个就载入它的栏位；手改栏位就变回 [自定] */
    const fill = d => {
      el('kind').value = String(d.kind); el('units').value = P.unitOf(d.units).key; shown = P.unitOf(d.units);
      const nm = SCALES.find(s => s[1][0] === d.scale[0] && s[1][1] === d.scale[1]); el('scale').value = nm ? nm[0] : 'custom';
      setNum('scaleA', d.scale[0]); setNum('scaleR', d.scale[1]);
      setNum('gridline', d.gridline); setNum('angle', d.angle); setNum('distance', d.distance); setNum('horizonHeight', d.horizonHeight);
      setNum('vp3x', d.thirdVp[0]); setNum('vp3y', d.thirdVp[1]); setNum('opacity', d.opacity);
      el('leftColor').value = d.leftColor; el('rightColor').value = d.rightColor; el('groundColor').value = d.groundColor;
      setDis();
    };
    el('preset').addEventListener('change', () => { const d = list.find(p => p.name === el('preset').value); if (d) fill(d); });
    box.querySelectorAll('input,select').forEach(e => { if (e.name !== 'preset') e.addEventListener('input', () => { el('preset').value = ''; }); });
    /* 存储预设…：同一个对话框切到 save 模式，存完回到定义网格（选中刚存的预设） */
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = T('ai3persp.savePreset'); btn.dataset.act = 'savePreset';
    btn.style.cssText = 'margin:2px 0 8px 0';
    const pr = el('preset'); pr.parentNode.insertBefore(btn, pr.nextSibling);
    btn.addEventListener('click', () => {
      const v = {};
      ['kind', 'units', 'scale', 'scaleA', 'scaleR', 'gridline', 'angle', 'distance', 'horizonHeight', 'vp3x', 'vp3y', 'leftColor', 'rightColor', 'groundColor', 'opacity'].forEach(k => {
        const e = el(k); v[k] = (e.type === 'number') ? parseFloat(e.value) : e.value; });
      exactOf(v);
      const d = Object.assign(toParams(Object.assign(v, {preset:''})), {name:newPresetName()});
      AIObj.Dlg.close(); setTimeout(() => openGridDialog(d, 'save', 'define'), 0);
    });
  }
  setDis();
  return bg;
}
reg('ai.ui.perspectiveGridDialog', {undoable:false, params:'{} 视图 ▸ 透视网格 ▸ 定义网格…：开「定义透视网格」对话框（照网格预填；栏位＝ai.perspective.grid.define 的栏位；可从预设载入、存储预设…）；确定＝跑 ai.perspective.grid.define → {ok, dialog}'}, () => {
  openGridDialog(P.definition(P.current()), ''); return {ok:true, dialog:'perspectiveGrid'};
});
reg('ai.ui.savePerspectivePreset', {undoable:false, params:'{} 视图 ▸ 透视网格 ▸ 将网格存储为预设…：开对话框（网格的栏位＋新预设名）；确定＝跑 ai.perspective.presets.save → {ok, dialog}'}, () => {
  const d = P.definition(P.current()); d.name = newPresetName(); openGridDialog(d, 'save'); return {ok:true, dialog:'perspectiveGrid'};
});

/* ═══════════ 叠画（perspective.rs:766-815 grid_overlays；view.rs:79-103 标尺；widget.rs） ═══════════ */
const rgba = c => `rgba(${c[0]},${c[1]},${c[2]},${(c.length > 3 ? c[3] : 255) / 255})`;
function drawGrid(ctx, s){
  // 网格藏着但透视工具在手上时照样画（perspective.rs:766-815 grid_overlays_in 的 shown(tool_id)）
  const g = P.current(); if (!g.visible && !(window.ToolState && ['perspgrid', 'perspselect'].includes(ToolState.cur))) return;
  const tol = 1 / Math.max(s, 1e-9), X = q => q[0] * s, Y = q => q[1] * s;
  ctx.save(); ctx.setLineDash([]);
  for (const pl of P.PLANES){
    ctx.strokeStyle = rgba(P.lineColor(g, pl)); ctx.lineWidth = 1; ctx.beginPath();
    for (const [a, b] of P.lines(g, pl)){ ctx.moveTo(X(a), Y(a)); ctx.lineTo(X(b), Y(b)); }
    ctx.stroke();
    if (pl === g.plane){                                       // 现用平面：平面色 2 点外框
      const h = P.homography(g, pl), d = P.domain(g, pl);
      const cs = h ? [[d.x0, d.y0], [d.x1, d.y0], [d.x1, d.y1], [d.x0, d.y1]].map(q => P.Hm.apply(h, q)).filter(Boolean) : [];
      if (cs.length === 4){ ctx.strokeStyle = rgba(P.planeColor(g, pl)); ctx.lineWidth = 2; ctx.beginPath(); cs.forEach((q, i) => i ? ctx.lineTo(X(q), Y(q)) : ctx.moveTo(X(q), Y(q))); ctx.closePath(); ctx.stroke(); }
    }
  }
  const xs = [g.vpLeft, g.vpRight, g.origin[0]], x0 = Math.min(...xs) - 50 * tol, x1 = Math.max(...xs) + 50 * tol;   // 地平线（灰虚线）
  ctx.strokeStyle = 'rgb(96,96,96)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x0 * s, g.horizon * s); ctx.lineTo(x1 * s, g.horizon * s); ctx.stroke(); ctx.setLineDash([]);
  if (g.rulers) drawRulers(ctx, s, g, tol);
  const wo = widgetOpts();
  if (wo.show){                                                 // 平面切换小部件
    const W = P.widgetAt(g, P.ab0(), tol, wo.position);
    for (const [pl, q] of W.faces){
      const c = P.PLANE_COLOR[pl];
      ctx.fillStyle = rgba([c[0], c[1], c[2], pl === g.plane ? 230 : 70]); ctx.strokeStyle = 'rgb(64,64,64)'; ctx.lineWidth = 1;
      ctx.beginPath(); q.forEach((v, i) => i ? ctx.lineTo(X(v), Y(v)) : ctx.moveTo(X(v), Y(v))); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    const [c, r] = W.dot;
    ctx.strokeStyle = g.plane === 'none' ? 'rgb(32,32,32)' : 'rgb(153,153,153)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(c), Y(c), r * s, 0, Math.PI * 2); ctx.stroke();
  }
  const r = 5 * tol;                                            // 平面小部件（菱形，perspective.rs:655-668）
  for (const [pl, p] of P.planeWidgets(g)){
    const c = P.PLANE_COLOR[pl], q = [[p[0], p[1] - r], [p[0] + r, p[1]], [p[0], p[1] + r], [p[0] - r, p[1]]];
    ctx.fillStyle = rgba([c[0], c[1], c[2], 220]); ctx.strokeStyle = 'rgb(32,32,32)'; ctx.lineWidth = 1;
    ctx.beginPath(); q.forEach((v, i) => i ? ctx.lineTo(X(v), Y(v)) : ctx.moveTo(X(v), Y(v))); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
function drawRulers(ctx, s, g, tol){
  const h = P.homography(g, 'left'); if (!h) return;
  const u = P.unitOf(g.units), ratio = u.points * g.scale[0] / g.scale[1];
  const o = P.Hm.apply(h, [0, 0]), top = P.Hm.apply(h, [0, g.height]); if (!o || !top) return;
  ctx.strokeStyle = ctx.fillStyle = 'rgb(64,64,64)'; ctx.lineWidth = 1; ctx.font = '11px sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.beginPath(); ctx.moveTo(o[0] * s, o[1] * s); ctx.lineTo(top[0] * s, top[1] * s); ctx.stroke();
  const cellPx = g.cell / Math.max(tol, 1e-9), every = Math.min(Math.max(Math.ceil(36 / Math.max(cellPx, 1e-9)), 1), 1e6), tick = 6 * tol;
  const count = Math.min(Math.floor(g.height / g.cell), 2000);
  for (let i = 0; i <= count; i++){
    const v = i * g.cell, p = P.Hm.apply(h, [0, v]); if (!p) continue;
    const long = i % every === 0;
    ctx.beginPath(); ctx.moveTo(p[0] * s, p[1] * s); ctx.lineTo((p[0] - (long ? 2 * tick : tick)) * s, p[1] * s); ctx.stroke();
    if (long) ctx.fillText(`${P.unitNumber(u, (v / ratio) * u.points)} ${u.suffix}`, (p[0] - 2 * tick) * s + 8, p[1] * s - 14);
  }
}
R3.overlays.push(function(ctx, s){
  /* 编辑文本：选取离开那个文字（或换了现用层）＝退出隔离模式 ⇒ 再投影回去 */
  const e = P.PS.editing;
  if (e && !(window.AiSel && AiSel.text.includes(e.id)) && Doc.activeId !== e.id && !(window.TypeTool && TypeTool.ed && TypeTool.ed.layer === e.id)) setTimeout(() => P.finishEditText(), 0);
  drawGrid(ctx, s);
});

/* ═══════════ 平面切换小部件：在画布上点（perspgrid.rs:449-467） ═══════════ */
function bindWidget(){
  const cv = document.getElementById('view'); if (!cv || cv.__r3persp) return;
  cv.__r3persp = true;
  let swallow = false;
  cv.addEventListener('pointerdown', e => {
    const g = P.current(), wo = widgetOpts(); if (!g.visible || !wo.show || !window.UI) return;
    const b = cv.getBoundingClientRect(), z = UI.zoom || 1, p = [(e.clientX - b.left) / z, (e.clientY - b.top) / z];
    const hit = P.widgetHit(g, P.ab0(), 1 / z, wo.position, p); if (!hit) return;
    e.stopImmediatePropagation(); e.preventDefault(); swallow = true;
    CMD.run('ai.perspective.plane.set', {plane:hit});
  }, true);
  ['pointermove', 'pointerup'].forEach(t => cv.addEventListener(t, e => { if (swallow){ e.stopImmediatePropagation(); if (t === 'pointerup') swallow = false; } }, true));
  /* 网格显示时数字键 1 左、2 水平、3 右、4 无（perspgrid.rs:471-480） */
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || !/^[1-4]$/.test(e.key)) return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const A = Doc.active && Doc.active();
    if (!P.current().visible || (window.TypeTool && TypeTool.ed) || !A || A.kind !== 'vector') return;
    CMD.run('ai.perspective.plane.set', {plane:['left', 'ground', 'right', 'none'][+e.key - 1]});
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(bindWidget, 0)); else setTimeout(bindWidget, 0);

/* 给 grid.set reproject 用的物件映射（对象段的 warp_checked） */
const AiPerspObj = {warp(t, h){ return P.warpChecked ? P.warpChecked(t, h) : 'unavailable'; }};
P.presets = presets; P.presetDef = presetDef; P.newPresetName = newPresetName; P.widgetOpts = widgetOpts; P.openGridDialog = openGridDialog;
})();
