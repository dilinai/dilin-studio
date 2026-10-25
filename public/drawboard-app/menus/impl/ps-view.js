/* 堤麟画板 · 顶菜单实作 · Photoshop ▸ 检视（命令名 ps.<原码 id>）
   照 ArtCraft PhotoCraft 原码逐段翻译：
     ui-egui/src/view_cmds.rs 16-130      ViewOptions（extras、Show 十三项与预设、SnapTo 五项、flip、像素长宽比、图案／像素画预览）
     ui-egui/src/view_cmds.rs 150-166     pixel_aspect_ratio（八个预设与 custom:<比例>:<名>）
     ui-egui/src/view_cmds.rs 457-568     run()：show.* 打开任一项会顺便打开「显示额外内容」、show.all、snapTo.all/none、screenMode、像素长宽比、200%／打印尺寸（72/dpi）
     ui-egui/src/view_cmds.rs 570-590     view.fitLayersOnScreen（所选图层内容外框；(区−40)/尺寸，夹 0.01..64）
     ui-egui/src/menus.rs 78-85, 182-186  校样预设：workingCmyk→working-cmyk、internetStandardRgb/monitorRgb→srgb，并打开校样颜色
     ui-egui/src/menus.rs 353-364, 544-550 rulers／show.grid／show.guides／snap／lockGuides 五个开关（Extras 预设 rulers=false grid=false guides=true snap=true lock=false：state.rs:513-525）
     ui-egui/src/workspace_ui.rs 143-161, 244-276, 378-416  自定像素长宽比（名＋比例 0.1..10，可选／删）、显示额外选项对话框
     ui-egui/src/canvas.rs 1220-1356, 1562-1567  水平翻转（只翻画面）、像素格点（缩放≥12 白 40/255）、图层边缘（#2d8ceb 外框）、格点要 extras、参考线要 shows(canvasGuides)
     ui-egui/src/rulers.rs 1-248          标尺（16 点，标号 1-2-5 级距≥60 屏幕点、十分刻度中间那根长 6、游标细线）、格点（每英寸一主线／4 细分，细线 0.45 透明）、参考线 #4affff、
                                          从标尺拉参考线（上标尺＝水平线）、移动工具拖参考线（4 屏幕点内；拖出画布＝删）
     ui-egui/src/snap_ui.rs 1-304         靠齐：8 屏幕点；点类工具（选框、裁剪、钢笔、形状、直线、文字）吸点；移动工具吸图层外框（边与中线）；Ctrl 拖曳中暂时关；智能参考线洋红 #ff00ff
     engine/src/snap.rs 1-256             SnapTargets：文件边与中线、参考线、格点（细分步距）、图层边与中线、选区边；参考线同距离时优先
     engine/src/edit_cmds.rs 370-400, 436-443  view.newGuide／moveGuide／deleteGuide／clearGuides（orientation＋index＋position）
     engine/src/file_cmds.rs 883-990      view.newGuideLayout（栏、栏宽、栏间距、行、行间距、边距、栏置中、清除现有；不重复 0.01）、newGuidesFromShape（形状外框三条×两向）、clearCanvasGuides
     engine/src/slice_cmds.rs 498         view.lockSlices（开关）
     engine/src/color_cmds.rs 28-65, 764-808, 972-992  校样设置（预设 working-cmyk、相对比色、黑场补偿开、不模拟纸色）、校样颜色、色域警告（ΔE76 门槛 4、灰 #808080）
     engine/src/proof_sim.rs 1-322        色版预视（工作中的青／洋红／黄／黑／CMY 版：分色后只印那几版、用黑墨显示）、旧版 Mac RGB（gamma 1.8）、色盲（Viénot 1999）
     cms/src/synth.rs 1-449               Photocraft 自己合成的铜版纸 CMYK：Yule–Nielsen 修正 Neugebauer（n=2）、16 叠印、网点扩大、GCR 黑版、300% 总墨量、LM 解 CMY；感知意图的色域压缩（GBD）
     cms/src/gamut.rs 9-77                色域检查：直接到 Lab vs 经校样描述档绕一圈，ΔE76 > 门槛＝色域外
   我们这边的对应：
     ■ 参考线跟 AI 共用同一份（Doc.aiGuides，一份文件一套参考线）：新增／移动／删除走 ai-view 已有的 ai.guide.add／move／remove，锁定走 ai.view.guides.lock。
     ■ 只在「PS 模式」（Menubar.app==='ps'＝当前层是像素层或文字层）才画标尺、格点、参考线、像素格点、图层边缘、校样；矢量层（AI 菜单）归 ai-view。
     ■ 画面：包住 UI.viewComposite（ai-view 已挂好的那支）；画完再叠 PS 的东西。选区边缘关＝画那一下把 Doc.sel 藏起来。
     ■ 水平翻转：#view 加 CSS scaleX(-1)（接在 HandView 的 translate 后），滑鼠点进 Pointer 前把 x 换回来（x → 宽−x）。 */
(function(){
if (window.PsView && window.PsView.__loaded) return;

const clone = v => JSON.parse(JSON.stringify(v));
const err = (cmd, m) => ({ok:false, error:`${cmd}: ${m}`});
const fnum = v => typeof v === 'number' && isFinite(v);

/* ═══════════ 状态（view_cmds.rs Show／SnapTo／ViewOptions 预设；state.rs Extras 预设） ═══════════ */
const SHOW_KEYS = ['layerEdges', 'selectionEdges', 'targetPath', 'pixelGrid', 'smartGuides', 'brushPreview', 'slices', 'notes', 'mesh', 'editPins', 'count', 'canvasGuides', 'artboardGuides'];
const SHOW_DEFAULT = {layerEdges:false, selectionEdges:true, targetPath:true, pixelGrid:true, smartGuides:true, brushPreview:true, slices:true, notes:true, mesh:false, editPins:true, count:true, canvasGuides:true, artboardGuides:true};
const SNAP_KEYS = ['guides', 'grid', 'layers', 'slices', 'documentBounds'];
const SCREEN_MODES = ['standard', 'fullScreenWithMenuBar', 'fullScreen'];
const SCREEN_TB = {standard:'standard', fullScreenWithMenuBar:'fullmenu', fullScreen:'full'};
const PIXEL_ASPECTS = ['square', 'd1DvNtsc', 'd1DvPal', 'd1DvNtscWidescreen', 'hdv1080', 'd1DvPalWidescreen', 'dvcproHd1080', 'anamorphic2To1'];
const PAR = {d1DvNtsc:0.91, d1DvPal:1.09, d1DvNtscWidescreen:1.21, hdv1080:1.33, d1DvPalWidescreen:1.46, dvcproHd1080:1.5, anamorphic2To1:2.0};

const PsView = window.PsView = {
  __loaded: true,
  extras: true,                                         // 显示额外内容（⌘H）
  e: {rulers:false, grid:false, guides:true, snap:true}, // menus.rs:353 的五个开关（锁定参考线跟 AI 共用 AiView.flags.guidesLocked）
  show: Object.assign({}, SHOW_DEFAULT),
  snapTo: {guides:true, grid:true, layers:true, slices:true, documentBounds:true},
  flip: false, pixelAspect:'square', pixelAspectCorrection:false, patternPreview:false, pixelArtPreview:false, lockSlices:false,
  customPars: [],
  grid: {every:1, unit:'inches', subdivisions:4, color:'#8c8c8c', guide:'#4affff', smart:'#ff00ff'},   // prefs.rs:563-578
  proof: {enabled:false, gamutWarning:false, threshold:4, setup:{name:'working-cmyk', intent:'relative', bpc:true, simulatePaper:false, kind:'profile'}},
  guideDrag: null,                                      // {vertical, index(全域序号)|null, pos}
  snapLines: [],                                        // 这次拖曳吸到的线（画智能参考线）
  active(){ return window.Menubar ? Menubar.app === 'ps' : ((Doc.active() || {}).kind !== 'vector'); },
  shows(flag){ return this.extras && !!flag; },
  locked(){ return !!(window.AiView && AiView.flags.guidesLocked); },
  guides(){ return window.AiView ? AiView.guides() : (Array.isArray(Doc.aiGuides) ? Doc.aiGuides : (Doc.aiGuides = [])); },
  flipped(){ return this.flip && this.active(); },
  dpi(){ return Math.max(1, +Doc.dpi || 72); },
  majorPx(){ const u = this.grid.unit, n = Math.max(1e-3, this.grid.every), d = this.dpi();   // Unit::to_px
    return Math.max(1e-3, u === 'inches' ? n * d : u === 'cm' ? n * d / 2.54 : u === 'mm' ? n * d / 25.4 : u === 'points' ? n * d / 72 : u === 'picas' ? n * d / 6 : n); },
  gridStep(){ return this.majorPx() / Math.max(1, this.grid.subdivisions); },
  pixelAspectRatio(id){ const m = /^custom:([^:]+):/.exec(id || this.pixelAspect); if (m && isFinite(+m[1])) return +m[1]; return PAR[id || this.pixelAspect] || 1; }
};
/* 视图 ▸ 对齐 跟工具自带的吸附（tools/move.js、marquee.js、crop.js 认 MoveTool.opt.snap）是同一个全域开关（原码 app.ui.extras.snap）：
   PsView.e.snap 直接读写 MoveTool.opt.snap，移动工具没载入才用自己的值 */
let _snapOwn = true;
Object.defineProperty(PsView.e, 'snap', {enumerable:true,
  get(){ return window.MoveTool && MoveTool.opt ? MoveTool.opt.snap !== false : _snapOwn; },
  set(v){ _snapOwn = !!v; if (window.MoveTool && MoveTool.opt) MoveTool.opt.snap = !!v; }});
/* 智能参考线同理（原码 show.smart_guides 一个开关；工具那边认 MoveTool.opt.smartGuides）：显示额外内容关时也不画 */
const syncSmart = () => { if (window.MoveTool && MoveTool.opt) MoveTool.opt.smartGuides = PsView.shows(PsView.show.smartGuides); };

/* ═══════════ 色彩：sRGB ↔ Lab(D50)、合成 CMYK（cms/src/synth.rs 逐段翻） ═══════════
   整段包成 ProofCore()：自给自足（不碰 window／Doc），主执行绪叫一份、背景 Worker 也用同一份原始码跑（查表 4913 点要几秒，不卡画面） */
function ProofCore(){
const D50 = [0.9642, 1.0, 0.8249];
const S2X = [[0.4360747, 0.3850649, 0.1430804], [0.2225045, 0.7168786, 0.0606169], [0.0139322, 0.0971045, 0.7141733]];
const X2S = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.0334540], [0.0719453, -0.2289914, 1.4052427]];
const mul3 = (m, v) => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
const dec = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);                          // proof_sim.rs:118 srgb_decode
const enc = v => { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };
const EPS = 216 / 24389, KAP = 24389 / 27;
const fLab = t => t > EPS ? Math.cbrt(t) : (KAP * t + 16) / 116;
const xyzToLab = (x, w) => { const fx = fLab(x[0] / w[0]), fy = fLab(x[1] / w[1]), fz = fLab(x[2] / w[2]); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; };
const labToXyz = (l, w) => { const fy = (l[0] + 16) / 116, fx = fy + l[1] / 500, fz = fy - l[2] / 200;
  const inv = t => { const t3 = t * t * t; return t3 > EPS ? t3 : (116 * t - 16) / KAP; }; return [w[0] * inv(fx), w[1] * inv(fy), w[2] * inv(fz)]; };
const rgbToXyz = rgb => mul3(S2X, rgb.map(dec));
const xyzToRgb = x => mul3(X2S, x).map(enc);

const YN = 2.0;
function CmykModel(tvi){                                 // synth.rs:82-113 CmykModel::coated
  const lab = (l, a, b) => labToXyz([l, a, b], D50);
  const w = lab(95.0, 0.0, -2.0);
  const base = [w, lab(55, -37, -50), lab(48, 74, -3), lab(24, 22, -46), lab(89, -5, 93), lab(50, -65, 27), lab(47, 68, 48), lab(23, 0, 0)];
  const k = lab(16, 0, 0), floor = 0.006, prim = [];
  for (let m = 0; m < 16; m++){
    const p = base[m & 7];
    prim[m] = (m & 8) === 0 ? p : [0, 1, 2].map(i => { const s = floor * w[i]; return s + (p[i] - s) * (k[i] - s) / (w[i] - s); });
  }
  this.primN = prim.map(p => p.map(v => Math.pow(Math.max(0, v), 1 / YN)));
  this.paper = w; this.tvi = tvi;
}
/* synth.rs:116-135 xyz()：Demichel 权重 × 16 叠印，Yule–Nielsen n=2（开方相加再平方）。写成纯标量（分色要跑上百万次） */
CmykModel.prototype.xyz = function(c){
  const P = this.primN, t = this.tvi;
  const dot = (v, k) => { v = v < 0 ? 0 : v > 1 ? 1 : v; v = v + 4 * t[k] * v * (1 - v); return v < 0 ? 0 : v > 1 ? 1 : v; };
  const a0 = dot(c[0], 0), a1 = dot(c[1], 1), a2 = dot(c[2], 2), a3 = dot(c[3], 3);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let m = 0; m < 16; m++){
    const wt = ((m & 1) ? a0 : 1 - a0) * ((m & 2) ? a1 : 1 - a1) * ((m & 4) ? a2 : 1 - a2) * ((m & 8) ? a3 : 1 - a3);
    if (wt === 0) continue;
    const p = P[m]; s0 += wt * p[0]; s1 += wt * p[1]; s2 += wt * p[2];
  }
  return [s0 * s0, s1 * s1, s2 * s2];                    // ^YN（YN＝2）
};
CmykModel.prototype.lab = function(c){                  // synth.rs:138-142 相对比色（纸白＝L* 100）
  const x = this.xyz(c), w = this.paper;
  const fx = fLab(x[0] / w[0]), fy = fLab(x[1] / w[1]), fz = fLab(x[2] / w[2]);   // ＝xyz_to_lab(x·D50/paper, D50)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const PARAMS = {tac:3.0, gcrStart:0.2, kMax:0.95, gcrGamma:1.1, tvi:[0.14, 0.14, 0.14, 0.17]};   // synth.rs:53-66
function inv3(a){
  const [[a0, a1, a2], [b0, b1, b2], [c0, c1, c2]] = a;
  const d = a0 * (b1 * c2 - b2 * c1) - a1 * (b0 * c2 - b2 * c0) + a2 * (b0 * c1 - b1 * c0);
  if (!isFinite(d) || Math.abs(d) < 1e-300) return null;
  return [[(b1 * c2 - b2 * c1) / d, (a2 * c1 - a1 * c2) / d, (a1 * b2 - a2 * b1) / d],
          [(b2 * c0 - b0 * c2) / d, (a0 * c2 - a2 * c0) / d, (a2 * b0 - a0 * b2) / d],
          [(b0 * c1 - b1 * c0) / d, (a1 * c0 - a0 * c1) / d, (a0 * b1 - a1 * b0) / d]];
}
function solveCmy(model, target, k, limit, seeds){       // synth.rs:147-236（投影 Levenberg–Marquardt）
  const project = x => {
    x = x.slice();
    for (let it = 0; it < 4; it++){
      for (let i = 0; i < 3; i++) x[i] = Math.min(1, Math.max(0, x[i]));
      const s = x[0] + x[1] + x[2]; if (s <= limit + 1e-12) break;
      const active = Math.max(1, x.filter(v => v > 0).length), d = (s - limit) / active;
      for (let i = 0; i < 3; i++) if (x[i] > 0) x[i] -= d;
    }
    return x;
  };
  const errf = x => { const l = model.lab([x[0], x[1], x[2], k]); return [l[0] - target[0], l[1] - target[1], l[2] - target[2]]; };
  const n2 = e => e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
  let best = [[0, 0, 0], Infinity];
  for (const seed of seeds){
    let x = project(seed), e = errf(x), f = n2(e), lambda = 1e-3;
    for (let iter = 0; iter < 60; iter++){
      const h = 1e-5, j = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let c = 0; c < 3; c++){ const xp = x.slice(); xp[c] += h; const ep = errf(xp); for (let r = 0; r < 3; r++) j[r][c] = (ep[r] - e[r]) / h; }
      const a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0];
      for (let r = 0; r < 3; r++){ for (let c = 0; c < 3; c++) a[r][c] = j[0][r] * j[0][c] + j[1][r] * j[1][c] + j[2][r] * j[2][c]; g[r] = -(j[0][r] * e[0] + j[1][r] * e[1] + j[2][r] * e[2]); }
      let improved = false;
      for (let t = 0; t < 8; t++){
        const al = a.map(r => r.slice()); for (let d = 0; d < 3; d++) al[d][d] += lambda * (1 + a[d][d]);
        const inv = inv3(al); if (!inv){ lambda *= 10; continue; }
        const step = mul3(inv, g), xn = project([x[0] + step[0], x[1] + step[1], x[2] + step[2]]), en = errf(xn), fn = n2(en);
        if (fn < f){
          const moved = Math.max(Math.abs(xn[0] - x[0]), Math.abs(xn[1] - x[1]), Math.abs(xn[2] - x[2]));
          // 跟原码差一点：ΔE² 每步进步不到 1e-7 就当收敛（色域外的颜色原码会一直磨到 60 步；结果差 < 0.001 ΔE，省下大半时间）
          const gain = f - fn;
          x = xn; e = en; f = fn; lambda = Math.max(lambda * 0.3, 1e-9); improved = moved > 1e-9 && gain > 1e-7; break;
        }
        lambda *= 10;
      }
      if (!improved || f < 1e-10) break;
    }
    if (f < best[1]) best = [x, f];
    if (best[1] < 1e-6) break;
  }
  return [best[0], Math.sqrt(best[1])];
}
const SEEDS = [[0.3, 0.3, 0.3], [0.05, 0.05, 0.05], [0.8, 0.8, 0.8], [0.9, 0.2, 0.2], [0.2, 0.9, 0.9]];
function separate(model, target, warm, fast){            // synth.rs:241-251 GCR 黑版＋CMY
  // fast：查表格点一个挨一个、邻点的解当起点时只用它（原码每点都再试五个固定起点；见 Proof.FAST 的说明）
  const seeds = warm && fast ? [[warm[0], warm[1], warm[2]]] : (warm ? [[warm[0], warm[1], warm[2]]] : []).concat(SEEDS);
  const [cmy0] = solveCmy(model, target, 0, 3.0, seeds);
  const g = Math.min(cmy0[0], cmy0[1], cmy0[2]);
  const k = g <= PARAMS.gcrStart ? 0 : PARAMS.kMax * Math.pow((g - PARAMS.gcrStart) / (1 - PARAMS.gcrStart), PARAMS.gcrGamma);
  const seeds2 = [[Math.max(0, cmy0[0] - k), Math.max(0, cmy0[1] - k), Math.max(0, cmy0[2] - k)], cmy0].concat(warm && fast ? [] : seeds);
  const [cmy, de] = solveCmy(model, target, k, Math.max(0, PARAMS.tac - k), seeds2);
  return [[cmy[0], cmy[1], cmy[2], k], de];
}
function Gbd(model){                                     // synth.rs:262-318 色域边界（感知／饱和意图用）
  const lb = 41, hb = 72, n = 21, cmax = new Float64Array(lb * hb), TAU = Math.PI * 2;
  let blackL = 100;
  for (let ci = 0; ci < n; ci++) for (let mi = 0; mi < n; mi++) for (let yi = 0; yi < n; yi++) for (let ki = 0; ki < 11; ki++){
    const v = [ci / (n - 1), mi / (n - 1), yi / (n - 1), ki / 10];
    if (v[0] + v[1] + v[2] + v[3] > PARAMS.tac + 1e-9) continue;
    const lab = model.lab(v); blackL = Math.min(blackL, lab[0]);
    const c = Math.hypot(lab[1], lab[2]), h = ((Math.atan2(lab[2], lab[1]) % TAU) + TAU) % TAU;
    const li = Math.min(lb - 1, Math.max(0, Math.round(lab[0] / 100 * (lb - 1)))), hi = Math.round(h / TAU * hb) % hb;
    cmax[li * hb + hi] = Math.max(cmax[li * hb + hi], c);
  }
  const get = (v, l, h) => v[Math.min(lb - 1, Math.max(0, l)) * hb + (((h % hb) + hb) % hb)];
  const filled = new Float64Array(lb * hb), smooth = new Float64Array(lb * hb);
  for (let l = 0; l < lb; l++) for (let h = 0; h < hb; h++){ let m = 0; for (let dl = -1; dl <= 1; dl++) for (let dh = -1; dh <= 1; dh++) m = Math.max(m, get(cmax, l + dl, h + dh)); filled[l * hb + h] = m; }
  for (let l = 0; l < lb; l++) for (let h = 0; h < hb; h++){ let s = 0; for (let dl = -1; dl <= 1; dl++) for (let dh = -1; dh <= 1; dh++) s += get(filled, l + dl, h + dh); smooth[l * hb + h] = s / 9; }
  this.maxChroma = (l, h) => {
    const lp = Math.min(1, Math.max(0, l / 100)) * (lb - 1), hp = (((h % TAU) + TAU) % TAU) / TAU * hb;
    const l0 = Math.floor(lp), h0 = Math.floor(hp), fl = lp - l0, fh = hp - h0, l1 = Math.min(l0 + 1, lb - 1), h0m = h0 % hb, h1m = (h0 + 1) % hb;
    const v = (a, b) => smooth[a * hb + b];
    const A = v(l0, h0m) + (v(l0, h1m) - v(l0, h0m)) * fh, B = v(l1, h0m) + (v(l1, h1m) - v(l1, h0m)) * fh;
    return A + (B - A) * fl;
  };
  this.compress = lab => {                               // synth.rs:334-345
    const l = blackL + Math.min(100, Math.max(0, lab[0])) * (100 - blackL) / 100, c = Math.hypot(lab[1], lab[2]);
    if (c < 1e-9) return [l, 0, 0];
    const h = Math.atan2(lab[2], lab[1]), cm = Math.max(1e-3, this.maxChroma(l, h)), knee = 0.8 * cm;
    const c2 = c <= knee ? c : knee + (cm - knee) * Math.tanh((c - knee) / (cm - knee));
    return [l, c2 * Math.cos(h), c2 * Math.sin(h)];
  };
}
/* 校样计算核心：给 PS 画面与 AI 的分色预视面板共用 */
const Core = {
  model: null, gbd: null, _bp: null, _luts: {},
  m(){ return this.model || (this.model = new CmykModel(PARAMS.tvi)); },
  g(){ return this.gbd || (this.gbd = new Gbd(this.m())); },
  /* 合成 CMYK 的黑场（相对 Lab 0 分色后印出来的 XYZ）＝黑场补偿用 */
  blackXyz(){ if (this._bp) return this._bp; const [c] = separate(this.m(), [0, 0, 0]); return (this._bp = labToXyz(this.m().lab(c), D50)); },
  bpcIn(x){ const b = this.blackXyz(); return x.map((v, i) => b[i] + v * (D50[i] - b[i]) / D50[i]); },
  bpcOut(x){ const b = this.blackXyz(); return x.map((v, i) => (v - b[i]) * D50[i] / (D50[i] - b[i])); },
  isCmyk(name){ return ['working-cmyk', 'coated-cmyk', 'cmyk', 'coatedcmyk', 'defaultcmyk', 'photocraftcoatedcmyk'].includes(String(name || '').toLowerCase()); },
  isRgbIdentity(name){ return ['srgb', 'internet-standard-rgb', 'monitor-rgb'].includes(String(name || '').toLowerCase()); },
  /* sRGB 0..1 → CMYK 0..1（照校样设置的意图／黑场补偿） */
  toCmyk(rgb, setup, warm, fast){
    const x = rgbToXyz(rgb), intent = setup.intent || 'relative';
    let lab;
    if (intent === 'perceptual' || intent === 'saturation') lab = this.g().compress(xyzToLab(x, D50));
    else if (intent === 'absolute') lab = xyzToLab(x.map((v, i) => v * D50[i] / this.m().paper[i]), D50);
    else lab = xyzToLab(setup.bpc !== false ? this.bpcIn(x) : x, D50);
    return separate(this.m(), lab, warm, fast);
  },
  /* true＝查表时邻点暖启动只用邻点的解（快 4 倍，但色域外的点会掉进别的局部解、量过差到 134/255）⇒ 关着，照原码每点都试全部起点 */
  FAST: false,
  /* CMYK 印出来、在 sRGB 屏幕上的样子（模拟纸色＝绝对比色、不补黑场） */
  showCmyk(c, setup){
    if (setup && setup.simulatePaper) return xyzToRgb(this.m().xyz(c));
    const x = labToXyz(this.m().lab(c), D50);
    return xyzToRgb(!setup || setup.bpc !== false ? this.bpcOut(x) : x);
  },
  /* 显示查表：kind＝profile|plate0..3|cmy|legacyMac|protanopia|deuteranopia（proof_sim.rs:148-225） */
  lut(setup, N){
    N = N || 17;
    const kind = setup.kind || 'profile', key = [kind, setup.name, setup.intent, setup.bpc, setup.simulatePaper, N].join('|');
    if (this._luts[key]) return this._luts[key];
    const L = new Float32Array(N * N * N * 3), sc = N - 1;
    let warm = null, k = 0;
    const plate = /^workingC?(yan|agenta|ellow|lack)?Plate$/.test(kind);
    const pIdx = {workingCyanPlate:0, workingMagentaPlate:1, workingYellowPlate:2, workingBlackPlate:3}[kind];
    for (let r = 0; r < N; r++) for (let g = 0; g < N; g++){ warm = null; for (let b = 0; b < N; b++){
      const v = [r / sc, g / sc, b / sc]; let o;
      if (kind === 'legacyMacintoshRgb') o = v.map(x => enc(Math.pow(Math.max(0, x), 1.8)));
      else if (kind === 'colorBlindnessProtanopia' || kind === 'colorBlindnessDeuteranopia') o = dichromat(v.map(dec), kind === 'colorBlindnessProtanopia').map(enc);
      else if (kind === 'profile' && this.isRgbIdentity(setup.name)) o = v;
      else {
        const [c] = this.toCmyk(v, setup, warm, this.FAST); warm = c;
        if (kind.startsWith('plates:')){ const m = kind.slice(7); o = this.showCmyk([m.includes('C') ? c[0] : 0, m.includes('M') ? c[1] : 0, m.includes('Y') ? c[2] : 0, m.includes('K') ? c[3] : 0], {bpc:true}); }   // AI 分色预览：只印勾着的版
        else if (pIdx !== undefined) o = this.showCmyk([0, 0, 0, c[pIdx]], {bpc:true});            // 只印那一版、用黑墨显示
        else if (kind === 'workingCmyPlate') o = this.showCmyk([c[0], c[1], c[2], 0], {bpc:true});
        else o = this.showCmyk(c, setup);
      }
      L[k++] = o[0]; L[k++] = o[1]; L[k++] = o[2];
    } }
    void plate;
    return (this._luts[key] = L);
  },
  /* 色域查表：每个格点的 ΔE76（相对比色、不补黑场；gamut.rs:26-47） */
  gamutLut(name, N){
    N = N || 17;
    const key = 'gamut|' + name + '|' + N; if (this._luts[key]) return this._luts[key];
    const L = new Float32Array(N * N * N), sc = N - 1; let k = 0;
    const identity = !this.isCmyk(name);
    for (let r = 0; r < N; r++) for (let g = 0; g < N; g++){ let warm = null; for (let b = 0; b < N; b++){
      if (identity){ L[k++] = 0; continue; }
      const [c, de] = this.toCmyk([r / sc, g / sc, b / sc], {intent:'relative', bpc:false}, warm, this.FAST); warm = c; L[k++] = de;
    } }
    return (this._luts[key] = L);
  },
  /* 三线性内插查表 */
  sample(L, N, rgb, ch){
    const M = N - 1, f = rgb.map(v => Math.min(M, Math.max(0, v * M))), i0 = f.map(v => Math.min(M - 1, Math.floor(v))), d = f.map((v, i) => v - i0[i]);
    const at = (a, b, c) => ch === 1 ? L[(a * N + b) * N + c] : null;
    if (ch === 1){
      let out = 0;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++)
        out += at(i0[0] + a, i0[1] + b, i0[2] + c) * (a ? d[0] : 1 - d[0]) * (b ? d[1] : 1 - d[1]) * (c ? d[2] : 1 - d[2]);
      return out;
    }
    const out = [0, 0, 0];
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++){
      const w = (a ? d[0] : 1 - d[0]) * (b ? d[1] : 1 - d[1]) * (c ? d[2] : 1 - d[2]), j = (((i0[0] + a) * N + i0[1] + b) * N + i0[2] + c) * 3;
      out[0] += L[j] * w; out[1] += L[j + 1] * w; out[2] += L[j + 2] * w;
    }
    return out;
  },
  sepToCmyk(rgb){ return this.toCmyk(rgb, {intent:'relative', bpc:true})[0]; }
};
/* proof_sim.rs:127-145 Viénot、Brettel & Mollon（1999） */
const RGB_LMS = [[17.8824, 43.5161, 4.11935], [3.45565, 27.1554, 3.86714], [0.0299566, 0.184309, 1.46709]];
const LMS_RGB = [[0.08094445, -0.13050441, 0.11672107], [-0.010248533, 0.054019327, -0.11361471], [-0.000365297, -0.0041216147, 0.6935114]];
function dichromat(lin, protan){
  const v = lin.map(c => 0.992052 * c + 0.003974);
  const [l, m, s] = mul3(RGB_LMS, v);
  const lms = protan ? [2.02344 * m - 2.52581 * s, m, s] : [l, 0.494207 * l + 1.24827 * s, s];
  return mul3(LMS_RGB, lms).map(c => Math.min(1, Math.max(0, c)));
}
Core.rgbToLab = rgb => xyzToLab(rgbToXyz(rgb), D50);
return Core;
}

/* 主执行绪的校样：算好的查表放快取（也存 localStorage，下次开不用再算）；没算好就丢给 Worker、算完重画 */
const LUTN = 17;
const Proof = window.PsProof = Object.assign(ProofCore(), {
  _ready: {}, _jobs: {}, _worker: null, _seq: 0, _cb: {},
  CHEAP: ['legacyMacintoshRgb', 'colorBlindnessProtanopia', 'colorBlindnessDeuteranopia'],
  keyOf(setup){ return ['v1', setup.kind || 'profile', setup.name, setup.intent, setup.bpc !== false, !!setup.simulatePaper, LUTN].join('|'); },
  cheap(setup){ return this.CHEAP.includes(setup.kind) || ((setup.kind || 'profile') === 'profile' && this.isRgbIdentity(setup.name)); },
  worker(){
    if (this._worker !== null) return this._worker;
    try {
      const src = `const Core=(${ProofCore.toString()})();onmessage=e=>{const d=e.data;const L=d.op==='gamut'?Core.gamutLut(d.name,d.N):Core.lut(d.setup,d.N);postMessage({id:d.id,L:L.slice()});};`;
      this._worker = new Worker(URL.createObjectURL(new Blob([src], {type:'text/javascript'})));
      this._worker.onmessage = e => { const f = this._cb[e.data.id]; delete this._cb[e.data.id]; if (f) f(e.data.L); };
      this._worker.onerror = e => { console.error('[PsProof] worker', e); };
    } catch(e){ this._worker = false; }
    return this._worker;
  },
  _store(key, L){ this._ready[key] = L; try { const b = new Uint8Array(L.buffer); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); localStorage.setItem('psProof|' + key, btoa(s)); } catch(e){} },
  _load(key){ try { const s = localStorage.getItem('psProof|' + key); if (!s) return null; const bin = atob(s), b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return new Float32Array(b.buffer); } catch(e){ return null; } },
  /* 拿查表：有就回、没有就开工（回 null；算完叫 done） */
  _get(key, job){
    if (this._ready[key]) return this._ready[key];
    const c = this._load(key); if (c){ this._ready[key] = c; return c; }
    if (!this._jobs[key]){
      const w = this.worker();
      if (!w){ const L = job.op === 'gamut' ? this.gamutLut(job.name, LUTN) : this.lut(job.setup, LUTN); this._store(key, L); return L; }
      const id = ++this._seq;
      this._jobs[key] = new Promise(res => { this._cb[id] = L => { this._store(key, L); delete this._jobs[key]; res(L); if (window.UI && UI.canvas) UI.draw(); }; });
      w.postMessage(Object.assign({id, N:LUTN}, job));
    }
    return null;
  },
  displayLut(setup){ return this.cheap(setup) ? this.lut(setup, LUTN) : this._get(this.keyOf(setup), {op:'lut', setup:{kind:setup.kind, name:setup.name, intent:setup.intent, bpc:setup.bpc, simulatePaper:setup.simulatePaper}}); },
  gamutTable(name){ return this.isCmyk(name) ? this._get('gamut|v1|' + name + '|' + LUTN, {op:'gamut', name}) : new Float32Array(LUTN * LUTN * LUTN); },
  pending(){ return Object.keys(this._jobs).length; },
  whenReady(){ return Promise.all(Object.values(this._jobs)); },
  /* 把校样／色域警告套在一张画布上（setup 为 null＝不改颜色；gamut 为 null＝不标色域外）；查表还在算 ⇒ 那部分先不套、回 -1 */
  apply(canvas, setup, gamut){
    const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    if (!W || !H) return 0;
    const N = LUTN, L = setup ? this.displayLut(setup) : null, G = gamut ? this.gamutTable(gamut.name) : null;
    if ((setup && !L) || (gamut && !G)){ if (!L && !G) return -1; }
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const memo = new Map(); let outCount = 0;
    for (let i = 0; i < d.length; i += 4){
      if (d[i + 3] === 0) continue;
      const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      let v = memo.get(key);
      if (!v){
        const rgb = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
        const o = L ? this.sample(L, N, rgb, 3).map(x => Math.round(Math.min(1, Math.max(0, x)) * 255)) : [d[i], d[i + 1], d[i + 2]];
        const out = G ? this.sample(G, N, rgb, 1) > gamut.threshold : false;
        v = out ? [128, 128, 128, 1] : [o[0], o[1], o[2], 0];      // prefs.rs:481 色域警告颜色 #808080、不透明度 100
        memo.set(key, v);
      }
      if (v[3]) outCount++;
      d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2];
    }
    ctx.putImageData(img, 0, 0);
    return outCount;
  }
});
/* 工作用 CMYK＝PS 预设「U.S. Web Coated (SWOP) v2」近似（menus/impl/cmyk-swop.js ＋ ps-image.js）：
   校样颜色、色域警告、各版预览、AI 分色预览都改走同一套——跟拾色器、文件 ▸ 模式 ▸ CMYK 是同一组 CMYK 数字（查 cmyk-swop.js 的预算表、即时，不用 Worker）。
   CMYK 一律用相对比色／可感知＋黑场补偿那张表分色；校样设置的「黑场补偿关」「模拟纸色」只改显示（同 ICC：绝对比色也是用相对比色的分色表再换纸白）。
   cmyk-swop.js 没载才退回原码合成铜版纸（上面的 ProofCore／Worker）。 */
const swopOn = () => !!(window.SwopCmyk && SwopCmyk.rgbTable && window.PsImageMode && PsImageMode.cms && PsImageMode.cms.swop && PsImageMode.cms.swop());
const PLATE_IDX = {workingCyanPlate:0, workingMagentaPlate:1, workingYellowPlate:2, workingBlackPlate:3};
const swopKind = (setup) => { const k = setup.kind || 'profile'; return k.startsWith('plates:') || PLATE_IDX[k] !== undefined || k === 'workingCmyPlate' || (k === 'profile' && Proof.isCmyk(setup.name)); };
Object.assign(Proof, {
  cmykName(){ return swopOn() ? 'U.S. Web Coated (SWOP) v2' : 'Dilin Coated CMYK (synthetic, 300% TAC, medium GCR)'; },
  swopCmyk(rgb, setup){
    const it = setup && (setup.intent === 'perceptual' || setup.intent === 'saturation') ? 'perceptual' : 'relative', q = v => Math.round(Math.min(1, Math.max(0, v)) * 255);
    return PsImageMode.cms.rgbToCmyk(q(rgb[0]), q(rgb[1]), q(rgb[2]), it, true);
  },
  swopLut(setup){
    const kind = setup.kind || 'profile', key = ['swop', kind, setup.intent, setup.bpc !== false, !!setup.simulatePaper, LUTN].join('|');
    if (this._ready[key]) return this._ready[key];
    const C = PsImageMode.cms, N = LUTN, sc = N - 1, L = new Float32Array(N * N * N * 3), pIdx = PLATE_IDX[kind];
    let k = 0;
    for (let r = 0; r < N; r++) for (let g = 0; g < N; g++) for (let b = 0; b < N; b++){
      const c = this.swopCmyk([r / sc, g / sc, b / sc], setup); let o;
      if (kind.startsWith('plates:')){ const m = kind.slice(7); o = C.show([m.includes('C') ? c[0] : 0, m.includes('M') ? c[1] : 0, m.includes('Y') ? c[2] : 0, m.includes('K') ? c[3] : 0], {bpc:true}); }
      else if (pIdx !== undefined) o = C.show([0, 0, 0, c[pIdx]], {bpc:true});
      else if (kind === 'workingCmyPlate') o = C.show([c[0], c[1], c[2], 0], {bpc:true});
      else o = C.show(c, {bpc:setup.bpc !== false, simulatePaper:!!setup.simulatePaper});
      L[k++] = o[0]; L[k++] = o[1]; L[k++] = o[2];
    }
    return (this._ready[key] = L);
  },
  swopGamut(){
    const key = 'swop|gamut|' + LUTN; if (this._ready[key]) return this._ready[key];
    const N = LUTN, sc = N - 1, L = new Float32Array(N * N * N); let k = 0;
    for (let r = 0; r < N; r++) for (let g = 0; g < N; g++) for (let b = 0; b < N; b++) L[k++] = SwopCmyk.gamutDE(Math.round(r / sc * 255), Math.round(g / sc * 255), Math.round(b / sc * 255));
    return (this._ready[key] = L);
  }
});
{
  const dl = Proof.displayLut, gt = Proof.gamutTable, sep = Proof.sepToCmyk;
  Proof.displayLut = function(setup){ return swopOn() && swopKind(setup) ? this.swopLut(setup) : dl.call(this, setup); };
  Proof.gamutTable = function(name){ return swopOn() && this.isCmyk(name) ? this.swopGamut() : gt.call(this, name); };
  Proof.sepToCmyk = function(rgb){ return swopOn() ? this.swopCmyk(rgb, {intent:'relative'}) : sep.call(this, rgb); };
}

/* ═══════════ 几何：图层外框（snap.rs layer_rect＝自由变换会框到的内容外框） ═══════════ */
const _cb = new WeakMap();
function rasterBounds(L){
  const c = L.data.canvas, key = c.width + 'x' + c.height + ':' + (History.past.length) + ':' + (History.future.length) + ':' + (L._cacheScale || 0);
  const hit = _cb.get(L); if (hit && hit.key === key && performance.now() - hit.t < 400) return hit.b;
  let b = null;
  try {
    const d = L.data.ctx.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++){ const row = y * c.width * 4; for (let x = 0; x < c.width; x++) if (d[row + x * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; } }
    if (x1 >= 0) b = {x0:x0 + L.x, y0:y0 + L.y, x1:x1 + 1 + L.x, y1:y1 + 1 + L.y};
  } catch(e){}
  _cb.set(L, {key, b, t:performance.now()});
  return b;
}
function layerRect(L){
  if (!L) return null;
  if (L.kind === 'raster') return rasterBounds(L);
  if (L.kind === 'text') return window.AiSel ? AiSel.textBounds(L) : null;
  if (L.kind === 'vector'){
    let b = null;
    for (const s of L.data.shapes){
      if (s.visible === false || s.guide) continue;
      let r = null;
      try { r = window.AIObj && AIObj.shapeBounds ? AIObj.shapeBounds(s, p => [p[0] + L.x, p[1] + L.y], false) : (window.AiSel && AiSel.shapeBounds ? AiSel.shapeBounds(L, s) : null); } catch(e){ r = null; }
      if (!r) continue;
      b = b ? {x0:Math.min(b.x0, r.x0), y0:Math.min(b.y0, r.y0), x1:Math.max(b.x1, r.x1), y1:Math.max(b.y1, r.y1)} : r;
    }
    return b;
  }
  return null;
}
PsView.layerRect = layerRect;

/* ═══════════ 靠齐（engine/src/snap.rs 全段） ═══════════ */
const Snap = PsView.Snap = {
  targets(opts, exclude){
    const W = Doc.width, H = Doc.height, t = {x:[], y:[], grid:null, extent:[0, 0, W, H]};
    const addRect = (r, edge, center) => {
      const xs = [r[1], r[3]], ys = [r[0], r[2]];
      t.x.push({pos:r[0], kind:edge, span:xs}, {pos:r[2], kind:edge, span:xs}, {pos:(r[0] + r[2]) / 2, kind:center, span:xs});
      t.y.push({pos:r[1], kind:edge, span:ys}, {pos:r[3], kind:edge, span:ys}, {pos:(r[1] + r[3]) / 2, kind:center, span:ys});
    };
    if (opts.document) addRect([0, 0, W, H], 'documentEdge', 'documentCenter');
    if (opts.guides) PsView.guides().forEach(g => (g.vertical ? t.x : t.y).push({pos:g.pos, kind:'guide', span:[0, g.vertical ? H : W]}));
    if (opts.grid && opts.gridStep > 0) t.grid = opts.gridStep;
    if (opts.layers) for (const L of Doc.layers){
      if (!L.visible || (exclude || []).includes(L.id)) continue;
      const r = layerRect(L); if (r) addRect([r.x0, r.y0, r.x1, r.y1], 'layerEdge', 'layerCenter');
    }
    if (opts.selection && Doc.sel && Doc.sel.w > 0 && Doc.sel.h > 0){
      const s = Doc.sel, r = [s.x, s.y, s.x + s.w, s.y + s.h];
      t.x.push({pos:r[0], kind:'selection', span:[r[1], r[3]]}, {pos:r[2], kind:'selection', span:[r[1], r[3]]});
      t.y.push({pos:r[1], kind:'selection', span:[r[0], r[2]]}, {pos:r[3], kind:'selection', span:[r[0], r[2]]});
    }
    return t;
  },
  isSmart(k){ return k === 'layerEdge' || k === 'layerCenter' || k === 'documentCenter'; },
  filtered(t, keep){ return {x:t.x.filter(a => keep(a.kind)), y:t.y.filter(a => keep(a.kind)), grid:keep('grid') ? t.grid : null, extent:t.extent}; },
  empty(t){ return !t.x.length && !t.y.length && !t.grid; },
  nearest(t, vertical, v, tol){                          // snap.rs:171-194（参考线同距离优先）
    let best = null;
    const consider = a => { const d = Math.abs(a.pos - v); if (d > tol) return;
      if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && a.kind === 'guide' && best.a.kind !== 'guide')) best = {d, a}; };
    (vertical ? t.x : t.y).forEach(consider);
    if (t.grid){ const g = Math.round(v / t.grid) * t.grid; consider({pos:g, kind:'grid', span:vertical ? [t.extent[1], t.extent[3]] : [t.extent[0], t.extent[2]]}); }
    return best && best.a;
  },
  line(vertical, a, p, q){ return {vertical, pos:a.pos, from:Math.min(a.span[0], p, q), to:Math.max(a.span[1], p, q), kind:a.kind}; },
  point(t, p, tol){                                      // snap.rs:197-209
    const out = p.slice(), lines = [];
    const a = this.nearest(t, true, p[0], tol); if (a){ out[0] = a.pos; lines.push(this.line(true, a, p[1], p[1])); }
    const b = this.nearest(t, false, p[1], tol); if (b){ out[1] = b.pos; lines.push(this.line(false, b, out[0], out[0])); }
    return [out, lines];
  },
  rect(t, r, tol){                                       // snap.rs:214-245
    const delta = [0, 0], lines = [];
    [[0, true], [1, false]].forEach(([axis, vertical]) => {
      const a = r[axis], b = r[axis + 2], anchors = [a, (a + b) / 2, b];
      let best = null;
      anchors.forEach(v => { const n = this.nearest(t, vertical, v, tol); if (n){ const d = n.pos - v; if (!best || Math.abs(d) < best.ad) best = {ad:Math.abs(d), d}; } });
      if (!best) return;
      delta[axis] = best.d;
      const other = vertical ? [r[1], r[3]] : [r[0], r[2]];
      anchors.forEach(v => {
        const moved = v + best.d, list = vertical ? t.x : t.y;
        let hit = list.filter(x => Math.abs(x.pos - moved) < 1e-6).sort((p, q) => (p.kind !== 'guide') - (q.kind !== 'guide'))[0];
        if (!hit && t.grid && Math.abs(Math.round(moved / t.grid) * t.grid - moved) < 1e-6) hit = {pos:moved, kind:'grid', span:other};
        if (hit) lines.push(this.line(vertical, hit, other[0], other[1]));
      });
    });
    return [delta, lines];
  }
};
const POINT_TOOLS = ['marquee', 'crop', 'pen', 'rect', 'ellipse', 'star', 'line', 'text'];   // snap_ui.rs:83-98 is_point_tool（我们有的那几颗）
function snapOptions(){                                  // snap_ui.rs:45-54
  const s = PsView.snapTo;
  return {guides:s.guides && PsView.e.guides, grid:s.grid && PsView.e.grid, layers:s.layers, document:s.documentBounds, selection:true, gridStep:PsView.gridStep()};
}
const tolerance = () => 8 / Math.max(0.01, UI.zoom);    // SNAP_PX 8
let active = null;                                       // 这次拖曳的吸附状态 {gesture, start, targets, smart, rect}
function snapBegin(p){
  active = null; PsView.snapLines = [];
  if (!PsView.active()) return;
  const tool = ToolState.cur;
  let gesture = null, exclude = [], rect = null;
  if (tool === 'move' && window.MoveTool && MoveTool.xf) return;   // 自由变换框（Ctrl+T）：把手／参考点／整框的吸附归 tools/move.js 自己（参考点吸参考线交叉点），这里不再拿图层外框吸一次
  if (tool === 'move'){
    const L = Doc.active(); const r = layerRect(L);
    if (r){ gesture = 'move'; exclude = [L.id]; rect = [r.x0, r.y0, r.x1, r.y1]; }
  } else if (POINT_TOOLS.includes(tool)) gesture = 'point';
  if (!gesture) return;
  const targets = PsView.e.snap ? Snap.targets(snapOptions(), exclude) : {x:[], y:[], grid:null, extent:[0, 0, Doc.width, Doc.height]};
  // 智能参考线跟移动工具选项栏同一个开关（MoveTool.opt.smartGuides，见上 syncSmart）：那边关了这里也不吸，
  // 否则「对齐吸附」关掉后 targets 空、退回吸智能参考线，照样吸到别层边缘
  const smartOn = PsView.shows(PsView.show.smartGuides) && !(window.MoveTool && MoveTool.opt && MoveTool.opt.smartGuides === false);
  const smart = gesture === 'move' && smartOn
    ?Snap.filtered(Snap.targets({guides:false, grid:false, layers:true, document:true, selection:false, gridStep:0}, exclude), k => Snap.isSmart(k)) : null;
  active = {gesture, start:p.slice(), targets, smart, rect, disabled:false};
}
function snapApply(p){
  if (!active || active.disabled){ PsView.snapLines = []; return p; }
  const tol = tolerance();
  if (active.gesture === 'point'){ const [o, lines] = Snap.point(active.targets, p, tol); PsView.snapLines = lines; return o; }
  const d = [p[0] - active.start[0], p[1] - active.start[1]], r = active.rect;
  const moved = [r[0] + d[0], r[1] + d[1], r[2] + d[0], r[3] + d[1]];
  const set = Snap.empty(active.targets) ? (active.smart || active.targets) : active.targets;
  const [adj, lines] = Snap.rect(set, moved, tol);
  PsView.snapLines = lines;
  return [p[0] + adj[0], p[1] + adj[1]];
}
/* 给 Pointer 用：flip 换坐标、再吸附（snap_ui.rs:211-250 filter_event；Ctrl 拖曳中暂时关） */
PsView.filterPt = function(kind, e, pt){
  if (!pt || !this.active()) return pt;
  if (this.flipped()) pt = [Doc.width - pt[0], pt[1]];
  if (kind === 'down'){ snapBegin(pt); return active && active.gesture === 'point' ? snapApply(pt) : pt; }
  if (!active) return pt;
  active.disabled = !!(e && e.ctrlKey && !e.metaKey);
  const q = snapApply(pt);
  if (kind === 'up'){ active = null; setTimeout(() => { PsView.snapLines = []; if (window.UI) UI.draw(); }, 0); }
  return q;
};
/* 拖参考线出标尺时的吸附（snap_ui.rs:253-266：参考线不吸参考线） */
function snapGuide(vertical, pos){
  if (!PsView.e.snap) return pos;
  const t = Snap.filtered(Snap.targets(snapOptions(), []), k => k !== 'guide');
  const n = Snap.nearest(t, vertical, pos, tolerance());
  return n ? n.pos : pos;
}

/* ═══════════ 画面叠画（canvas.rs、rulers.rs draw_grid／draw_guides） ═══════════ */
function styledLine(ctx, a, b){ ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
PsView.drawGrid = function(ctx, s){
  const major = this.majorPx(), minor = major / Math.max(1, this.grid.subdivisions);
  const z = UI.zoom, W = Doc.width, H = Doc.height;
  ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = this.grid.color;
  [[minor, 0.45], [major, 1.0]].forEach(([step, alpha]) => {
    if (step * z < 6 || (alpha < 1 && this.grid.subdivisions <= 1)) return;
    ctx.globalAlpha = alpha;
    for (let x = step; x < W; x += step){ const p = Math.round(x * s) + .5; styledLine(ctx, [p, 0], [p, H * s]); }
    for (let y = step; y < H; y += step){ const p = Math.round(y * s) + .5; styledLine(ctx, [0, p], [W * s, p]); }
  });
  ctx.restore();
};
PsView.drawGuides = function(ctx, s){
  const W = ctx.canvas.width, H = ctx.canvas.height, d = this.guideDrag;
  ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = this.grid.guide;
  const line = (vertical, pos) => { const p = Math.round(pos * s) + .5; vertical ? styledLine(ctx, [p, 0], [p, H]) : styledLine(ctx, [0, p], [W, p]); };
  if (this.e.guides) this.guides().forEach((g, i) => { if (d && d.index === i) return; line(g.vertical, g.pos); });
  if (d) line(d.vertical, d.pos);
  ctx.restore();
};
PsView.drawOverlays = function(ctx, s){
  const z = UI.zoom;
  if (this.shows(this.show.pixelGrid) && z >= 12){        // canvas.rs:1334-1347
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,' + (40 / 255) + ')'; ctx.lineWidth = 1;
    // 只画视窗看得到的那一段（6400% 时整张几千条线，画面外的白画）
    let x0 = 0, x1 = Doc.width, y0 = 0, y1 = Doc.height;
    if (UI.wrap && UI.canvas){ const wr = UI.wrap.getBoundingClientRect(), cr = UI.canvas.getBoundingClientRect();
      x0 = Math.max(0, Math.floor((wr.left - cr.left) / z)); x1 = Math.min(Doc.width, Math.ceil((wr.right - cr.left) / z));
      y0 = Math.max(0, Math.floor((wr.top - cr.top) / z)); y1 = Math.min(Doc.height, Math.ceil((wr.bottom - cr.top) / z));
      if (/scaleX\(-1\)/.test(UI.canvas.style.transform || '')){ x0 = 0; x1 = Doc.width; }
      if (rotAngle()){   // 转过：视窗四角反算回文件点取范围
        const q = [[wr.left, wr.top], [wr.right, wr.top], [wr.left, wr.bottom], [wr.right, wr.bottom]].map(p => RotView.toDoc(p[0], p[1]));
        x0 = Math.max(0, Math.floor(Math.min(...q.map(p => p[0])))); x1 = Math.min(Doc.width, Math.ceil(Math.max(...q.map(p => p[0]))));
        y0 = Math.max(0, Math.floor(Math.min(...q.map(p => p[1])))); y1 = Math.min(Doc.height, Math.ceil(Math.max(...q.map(p => p[1])))); } }
    for (let x = x0; x <= x1; x++){ const p = Math.round(x * s) + .5; styledLine(ctx, [p, y0 * s], [p, y1 * s]); }
    for (let y = y0; y <= y1; y++){ const p = Math.round(y * s) + .5; styledLine(ctx, [x0 * s, p], [x1 * s, p]); }
    ctx.restore();
  }
  if (this.shows(this.show.layerEdges)){                  // canvas.rs:1349-1356
    const b = layerRect(Doc.active());
    if (b){ ctx.save(); ctx.strokeStyle = '#2d8ceb'; ctx.lineWidth = 1; ctx.strokeRect(Math.round(b.x0 * s) - .5, Math.round(b.y0 * s) - .5, Math.round((b.x1 - b.x0) * s) + 1, Math.round((b.y1 - b.y0) * s) + 1); ctx.restore(); }
  }
  if (this.e.grid && this.extras) this.drawGrid(ctx, s);  // canvas.rs:1562-1564
  if (this.shows(this.show.canvasGuides)) this.drawGuides(ctx, s);
  else if (this.guideDrag) this.drawGuides(ctx, s);
  if (this.snapLines.length && this.shows(this.show.smartGuides)){   // snap_ui.rs:273-295 只画智能参考线那几种
    ctx.save(); ctx.strokeStyle = this.grid.smart; ctx.lineWidth = 1;
    this.snapLines.forEach(l => { if (!Snap.isSmart(l.kind)) return;
      if (l.vertical) styledLine(ctx, [Math.round(l.pos * s) + .5, l.from * s], [Math.round(l.pos * s) + .5, l.to * s]);
      else styledLine(ctx, [l.from * s, Math.round(l.pos * s) + .5], [l.to * s, Math.round(l.pos * s) + .5]); });
    ctx.restore();
  }
};
/* 画 #view 那一次的后处理：校样／色域警告，再叠画 */
PsView.post = function(target, s){
  const P = this.proof;
  if (P.enabled || P.gamutWarning){
    try { Proof.apply(target, P.enabled ? P.setup : null, P.gamutWarning ? {name:P.setup.name, threshold:P.threshold} : null); }
    catch(e){ console.error('[PsView] proof', e); }
  }
  // 放大模式（ui.js：倍率 > 1:1，#view 只是 1:1 文件像素）⇒ 网格／参考线／像素网格改画在叠画层（hook 里挂的 UI.overlays），照真倍率画才细
  if (!(target === UI.canvas && UI.magnified && UI.magnified())) this.drawOverlays(target.getContext('2d'), s);
};

/* ═══════════ 标尺（rulers.rs:165-248） ═══════════ */
const RULER = 16;
function niceStep(min, whole){                           // rulers.rs:38-48
  let step = whole ? 1 : 0.001;
  for (;;){ for (const m of [1, 2, 2.5, 5]) if ((m !== 2.5 || !whole) && step * m >= min) return step * m; step *= 10; }
}
function viewRect(){ return document.getElementById('view').getBoundingClientRect(); }
/* 画面点 → 文件点（翻转时 x 镜像） */
/* 旋转视图（tools/rotateview.js）转过时：#view 的外接框不等于画布 ⇒ 用 RotView 的反转（含翻转）；参考线画在画布上、跟着画布一起转，标尺不转 */
const rotAngle = () => (window.RotView && RotView.angle) || 0;
function toDoc(cx, cy){ if (rotAngle()) return RotView.toDoc(cx, cy);
  const b = viewRect(); let x = (cx - b.left) / UI.zoom; if (PsView.flipped()) x = Doc.width - x; return [x, (cy - b.top) / UI.zoom]; }
function toScreenX(x){ const b = viewRect(); return b.left + (PsView.flipped() ? Doc.width - x : x) * UI.zoom; }
function toScreenY(y){ const b = viewRect(); return b.top + y * UI.zoom; }
PsView.rulersShown = function(){ return this.active() && this.e.rulers && !(window.Toolbar && Toolbar.screen === 'presentation'); };
PsView.ensureRulers = function(){
  const wrap = document.getElementById('canvasWrap'); if (!wrap) return null;
  let top = document.getElementById('psRulerTop');
  if (!top){
    top = document.createElement('canvas'); top.id = 'psRulerTop'; top.className = 'psruler';
    const left = document.createElement('canvas'); left.id = 'psRulerLeft'; left.className = 'psruler';
    const corner = document.createElement('div'); corner.id = 'psRulerCorner'; corner.className = 'psruler';
    wrap.appendChild(top); wrap.appendChild(left); wrap.appendChild(corner);
    [[top, false], [left, true]].forEach(([el, vertical]) => el.addEventListener('pointerdown', e => rulerDown(e, vertical)));
  }
  return {wrap, top, left:document.getElementById('psRulerLeft')};
};
PsView.drawRulers = function(){
  const R = this.rulersShown() ? this.ensureRulers() : null;
  document.body.classList.toggle('ps-rulers', !!R);
  if (!R) return;
  const wr = R.wrap.getBoundingClientRect(), z = UI.zoom, dpr = Math.min(window.devicePixelRatio || 1, 2);
  const hover = (window.Pointer && Pointer.hover) || null;
  const step = niceStep(60 / Math.max(1e-6, z), true);
  const paint = (cv, vertical) => {
    const w = vertical ? RULER : Math.max(1, wr.width - RULER), h = vertical ? Math.max(1, wr.height - RULER) : RULER;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#262626'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#3a3a3a'; c.lineWidth = 1; c.beginPath();
    if (vertical){ c.moveTo(w - .5, 0); c.lineTo(w - .5, h); } else { c.moveTo(0, h - .5); c.lineTo(w, h - .5); } c.stroke();
    c.strokeStyle = '#7a7a7a'; c.fillStyle = '#9a9a9a'; c.font = '9px sans-serif'; c.textBaseline = 'top';
    const org = vertical ? wr.top + RULER : wr.left + RULER, len = vertical ? h : w;
    let sAt = u => (vertical ? toScreenY(u) : toScreenX(u)) - org;
    let d0 = vertical ? toDoc(0, org)[1] : toDoc(org, 0)[0], d1 = vertical ? toDoc(0, org + len)[1] : toDoc(org + len, 0)[0];
    if (rotAngle()){
      // 转过：标尺本身不转；沿「过画布正中」那条画面横线／直线量文件 x／y（线性）。接近 ±90° 时这个轴几乎不变 ⇒ 不画刻度
      const C = RotView.center();
      d0 = vertical ? toDoc(C[0], org)[1] : toDoc(org, C[1])[0]; d1 = vertical ? toDoc(C[0], org + len)[1] : toDoc(org + len, C[1])[0];
      const span = d1 - d0;
      if (Math.abs(span) * Math.max(1e-6, z) < len * 0.05){ d0 = d1 = NaN; }
      else sAt = u => (u - d0) / span * len;
    }
    const lo = Math.min(d0, d1), hi = Math.max(d0, d1);
    for (let v = Math.floor(lo / step) * step; v <= hi; v += step){
      const p = Math.round(sAt(v)) + .5;
      c.beginPath(); if (vertical){ c.moveTo(w - RULER, p); c.lineTo(w, p); } else { c.moveTo(p, h - RULER); c.lineTo(p, h); } c.stroke();
      const t = String(Math.round(v));
      if (vertical) Array.from(t).forEach((ch, i) => c.fillText(ch, 3, p + 2 + i * 8.5)); else c.fillText(t, p + 2, 1);
      for (let k = 1; k < 10; k++){
        const m = Math.round(sAt(v + step * k / 10)) + .5, l = k === 5 ? 6 : 3;
        c.beginPath(); if (vertical){ c.moveTo(w - l, m); c.lineTo(w, m); } else { c.moveTo(m, h - l); c.lineTo(m, h); } c.stroke();
      }
    }
    if (hover){
      const p = Math.round(sAt(vertical ? hover[1] : hover[0])) + .5;
      c.strokeStyle = '#d6d6d6'; c.beginPath(); if (vertical){ c.moveTo(0, p); c.lineTo(w, p); } else { c.moveTo(p, 0); c.lineTo(p, h); } c.stroke();
    }
  };
  paint(R.top, false); paint(R.left, true);
  this._rulerKey = rulerKey();
};
function rulerKey(){ const v = document.getElementById('view'), w = document.getElementById('canvasWrap'); if (!v || !w) return ''; const b = v.getBoundingClientRect(), r = w.getBoundingClientRect(); return [b.left, b.top, b.width, r.width, r.height, UI.zoom, PsView.flipped(), rotAngle()].join(','); }
(function watch(){
  requestAnimationFrame(watch);
  if (!PsView.e.rulers || !window.UI || !document.getElementById('psRulerTop')) return;
  if (rulerKey() !== PsView._rulerKey && PsView.rulersShown()) PsView.drawRulers();
})();
const overRuler = (cx, cy) => { if (!PsView.rulersShown()) return false; const r = document.getElementById('canvasWrap').getBoundingClientRect(); return cx < r.left + RULER || cy < r.top + RULER; };
/* 从标尺拉一条新参考线：上标尺＝水平线（pos＝y）、左标尺＝垂直线；放在画布范围内才算（rulers.rs:146-161、231-246） */
function rulerDown(e, vertical){
  if (e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  PsView.guideDrag = {vertical, index:null, pos:null};
  const mv = ev => { const d = toDoc(ev.clientX, ev.clientY); PsView.guideDrag.pos = snapGuide(vertical, vertical ? d[0] : d[1]); UI.draw(); };
  const up = () => {
    window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true);
    const g = PsView.guideDrag; PsView.guideDrag = null;
    finishDrag(g);
  };
  window.addEventListener('pointermove', mv, true); window.addEventListener('pointerup', up, true);
}
function finishDrag(d){
  if (!d || d.pos === null){ UI.draw(); return; }
  const extent = d.vertical ? Doc.width : Doc.height, inside = d.pos >= 0 && d.pos <= extent, pos = Math.round(d.pos * 1000) / 1000;
  const orientation = d.vertical ? 'vertical' : 'horizontal';
  if (d.index === null && inside){ CMD.run('ps.view.newGuide', {orientation, position:pos}); PsView.e.guides = true; UI.draw(); }
  else if (d.index !== null && inside) CMD.run('ps.view.moveGuide', {orientation, index:orientIndex(d.index), position:pos});
  else if (d.index !== null) CMD.run('ps.view.deleteGuide', {orientation, index:orientIndex(d.index)});
  else UI.draw();
}
/* 全域序号 ↔ 原码的 (orientation, index) */
function orientIndex(gi){ const G = PsView.guides(), v = G[gi].vertical; let n = 0; for (let i = 0; i < gi; i++) if (G[i].vertical === v) n++; return n; }
function globalIndex(vertical, idx){ const G = PsView.guides(); let n = -1; for (let i = 0; i < G.length; i++) if (G[i].vertical === vertical && ++n === idx) return i; return -1; }
/* 移动工具拖参考线（rulers.rs:126-143 guide_at：4 屏幕点内；锁住或隐藏时不行） */
function guideAt(cx, cy){
  if (!PsView.e.guides || PsView.locked()) return -1;
  const d = toDoc(cx, cy), tol = 4 / Math.max(0.01, UI.zoom);
  if (rotAngle()){ if (d[0] < -tol || d[0] > Doc.width + tol || d[1] < -tol || d[1] > Doc.height + tol) return -1; }   // 转过：外接框会多算四个角 ⇒ 用文件点判断
  else { const b = viewRect(); if (cx < b.left - 2 || cx > b.right + 2 || cy < b.top - 2 || cy > b.bottom + 2) return -1; }
  const G = PsView.guides();
  for (let i = 0; i < G.length; i++) if (G[i].vertical && Math.abs(G[i].pos - d[0]) <= tol) return i;
  for (let i = 0; i < G.length; i++) if (!G[i].vertical && Math.abs(G[i].pos - d[1]) <= tol) return i;
  return -1;
}
function guideGrab(e){
  if (e.button !== 0 || !PsView.active() || ToolState.cur !== 'move' || e.target.id !== 'view') return;
  if (window.MoveTool && MoveTool.xf) return;            // 自由变换中（PS）：参考线抓不起来，按在参考线上＝照常拖参考点／旋转／移动框
  const i = guideAt(e.clientX, e.clientY); if (i < 0) return;
  e.preventDefault(); e.stopPropagation();
  const g = PsView.guides()[i];
  PsView.guideDrag = {vertical:g.vertical, index:i, pos:g.pos};
  const mv = ev => { const d = toDoc(ev.clientX, ev.clientY); PsView.guideDrag.pos = snapGuide(g.vertical, g.vertical ? d[0] : d[1]); UI.draw(); };
  const up = () => { window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true); const dd = PsView.guideDrag; PsView.guideDrag = null; finishDrag(dd); };
  window.addEventListener('pointermove', mv, true); window.addEventListener('pointerup', up, true);
}

/* ═══════════ 命令 ═══════════ */
const run = (id, p) => CMD.map[id] ? CMD.map[id].run(p || {}) : null;
const flagOf = (p, cur) => typeof p.on === 'boolean' ? p.on : !cur;          // view_cmds.rs:453 flag_param
const reg = (id, params, fn, undoable) => CMD.reg('ps.' + id, {i18n:'', params, undoable:!!undoable}, fn);
const afterView = () => { syncSmart(); applyFlip(); if (window.UI && UI.canvas) UI.draw(); };

/* ── 校样（menus.rs:78-85、182-186；proof_sim.rs:245-263；color_cmds.rs:764-808） ── */
const INTENTS = ['perceptual', 'relative', 'saturation', 'absolute'];
reg('view.proofSetup', '{profile:"working-cmyk"|"coated-cmyk"|"srgb"="working-cmyk", intent:"perceptual|relative|saturation|absolute"="relative", bpc=true, simulatePaper=false, dialog?:true（开「校样设置」对话框＝菜单「自定…」）} 视图 ▸ 校样设置 ▸ 自定：设定校样描述档（我们只有原码自己合成的铜版纸 CMYK 与 sRGB）→ {ok, profile, intent, bpc, simulatePaper, proofColors}', p => {
  if (p.dialog){ Dlg.proofSetup(); return {ok:true, dialog:'proofSetup'}; }
  const C = 'view.proofSetup', name = typeof p.profile === 'string' ? p.profile : 'working-cmyk';
  if (!Proof.isCmyk(name) && !Proof.isRgbIdentity(name)) return err(C, `unsupported profile \`${name}\` (working-cmyk|coated-cmyk|srgb)`);
  const intent = p.intent === undefined ? 'relative' : p.intent;
  if (!INTENTS.includes(intent)) return err(C, `intent must be one of ${INTENTS.join('|')}`);
  PsView.proof.setup = {name, intent, bpc:p.bpc !== false, simulatePaper:p.simulatePaper === true, kind:'profile'};
  return {ok:true, profile:name, intent, bpc:PsView.proof.setup.bpc, simulatePaper:PsView.proof.setup.simulatePaper, proofColors:PsView.proof.enabled};
});
const PROOF_PRESETS = {workingCmyk:'working-cmyk', internetStandardRgb:'srgb', monitorRgb:'srgb'};
const PROOF_KINDS = ['workingCyanPlate', 'workingMagentaPlate', 'workingYellowPlate', 'workingBlackPlate', 'workingCmyPlate', 'legacyMacintoshRgb', 'colorBlindnessProtanopia', 'colorBlindnessDeuteranopia'];
Object.keys(PROOF_PRESETS).forEach(k => reg('view.proofSetup.' + k, '{} 视图 ▸ 校样设置 ▸ 这个预设：设校样描述档并打开校样颜色 → {ok, profile, proofColors:true}', () => {
  run('ps.view.proofSetup', {profile:PROOF_PRESETS[k]}); PsView.proof.setup.preset = k; PsView.proof.enabled = true;
  return {ok:true, profile:PROOF_PRESETS[k], proofColors:true};
}));
PROOF_KINDS.forEach(k => reg('view.proofSetup.' + k, '{} 视图 ▸ 校样设置 ▸ 这个模拟（色版用工作中的 CMYK）并打开校样颜色 → {ok, proof, proofColors:true}', () => {
  const plates = /Plate$/.test(k), S = PsView.proof.setup;
  PsView.proof.setup = Object.assign({}, S, plates ? {name:'working-cmyk'} : {}, {kind:k, preset:k});
  PsView.proof.enabled = true;
  return {ok:true, proof:k, profile:PsView.proof.setup.name, proofColors:true};
}));
const proofChecked = k => () => PsView.proof.enabled && (PsView.proof.setup.preset === k);
reg('view.proofColors', '{on?: bool（缺省＝切换）} 视图 ▸ 校样颜色（Ctrl+Y）：画面照校样设置模拟 → {ok, on, profile}', p => {
  PsView.proof.enabled = flagOf(p, PsView.proof.enabled); return {ok:true, on:PsView.proof.enabled, profile:PsView.proof.setup.name};
});
reg('view.gamutWarning', '{on?: bool, threshold?: ΔE=4, profile?:"working-cmyk"} 视图 ▸ 色域警告（Ctrl+Shift+Y）：校样描述档印不出来的颜色画成灰 → {ok, on, threshold, outOfGamut, fraction}', p => {
  const P = PsView.proof; P.gamutWarning = flagOf(p, P.gamutWarning);
  if (fnum(p.threshold)) P.threshold = Math.max(0, p.threshold);
  const name = typeof p.profile === 'string' ? p.profile : P.setup.name;
  if (!Proof.isCmyk(name) && !Proof.isRgbIdentity(name)) return err('view.gamutWarning', `unsupported profile \`${name}\``);
  const count = () => {
    const c = composite(1), cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0);
    const n = Proof.apply(cv, null, {name, threshold:P.threshold});
    return {ok:true, on:P.gamutWarning, profile:name, threshold:P.threshold, outOfGamut:n, fraction:n / Math.max(1, Doc.width * Doc.height)};
  };
  if (Proof.gamutTable(name)) return count();
  return Proof.whenReady().then(count);                 // 色域表第一次要在背景算几秒 ⇒ 回 Promise（agent 用 await）
});
reg('view.proofWait', '{} 等校样／色域表在背景算完（第一次开某个校样要几秒；之后存在浏览器里）→ Promise {ok, pending:0}', () => Proof.whenReady().then(() => ({ok:true, pending:Proof.pending()})));

/* ── 像素长宽比（view_cmds.rs:516-519；workspace_ui.rs:246-276） ── */
PIXEL_ASPECTS.forEach(k => reg('view.pixelAspectRatio.' + k, '{} 视图 ▸ 像素长宽比 ▸ 这一项（原码只记状态、画面不变形）→ {ok, pixelAspectRatio}', () => { PsView.pixelAspect = k; return {ok:true, pixelAspectRatio:PsView.pixelAspectRatio(k)}; }));
reg('view.pixelAspectRatio.custom', '{name, ratio:0.1..10}＝新增（同名就改）并选用 | {select:name} | {delete:name} | {dialog:true}（开「存储像素长宽比」对话框）→ {ok, pixelAspectRatio, name}', p => {
  const C = 'view.pixelAspectRatio.custom', L = PsView.customPars;
  if (p.dialog){ Dlg.customPar(); return {ok:true, dialog:'customPar'}; }
  if (typeof p.delete === 'string'){
    const i = L.findIndex(c => c.name === p.delete); if (i < 0) return err(C, `no custom pixel aspect ratio "${p.delete}"`);
    L.splice(i, 1); if (PsView.pixelAspect.endsWith(':' + p.delete)) PsView.pixelAspect = 'square';
    return {ok:true, deleted:p.delete};
  }
  let c;
  if (typeof p.select === 'string'){ c = L.find(x => x.name === p.select); if (!c) return err(C, `no custom pixel aspect ratio "${p.select}"`); }
  else {
    const name = typeof p.name === 'string' ? p.name.trim() : ''; if (!name) return err(C, 'pass `name`');
    if (!fnum(+p.ratio) || p.ratio === null || p.ratio === '') return err(C, 'pass `ratio`');
    const ratio = +p.ratio; if (!(ratio >= 0.1 && ratio <= 10)) return err(C, 'the ratio must be between 0.100 and 10.000');
    c = {name, ratio}; const j = L.findIndex(x => x.name === name); if (j >= 0) L[j] = c; else L.push(c);
  }
  PsView.pixelAspect = `custom:${c.ratio}:${c.name}`;
  return {ok:true, pixelAspectRatio:c.ratio, name:c.name};
});
reg('view.pixelAspectRatioCorrection', '{on?} 视图 ▸ 像素长宽比校正（原码只记状态）→ {ok, on}', p => ({ok:true, on:(PsView.pixelAspectCorrection = flagOf(p, PsView.pixelAspectCorrection))}));

/* ── 缩放（view_cmds.rs:556-590） ── */
function setView(zoom, center){
  const w = document.getElementById('canvasWrap').getBoundingClientRect(), k = PsView.rulersShown() ? RULER : 0;
  const sc = [w.left + k + (w.width - k) / 2, w.top + k + (w.height - k) / 2];
  if (window.ZoomView) ZoomView.anchorView(sc, center || ZoomView.toDoc(sc), zoom); else UI.setZoom(zoom);
  return {ok:true, zoom:UI.zoom};
}
reg('view.printSize', '{} 视图 ▸ 打印尺寸：缩放＝72/分辨率（PS 预设屏幕 72 ppi）、中心不动 → {ok, zoom}', () => setView(Math.min(64, Math.max(0.01, 72 / PsView.dpi()))));
reg('view.fitLayersOnScreen', '{layerIds?:[…]（缺省＝当前图层）} 视图 ▸ 按屏幕大小缩放图层：所选图层内容外框放满画布区（(区−40)/尺寸）、置中 → {ok, zoom, bounds}', p => {
  const ids = Array.isArray(p.layerIds) && p.layerIds.length ? p.layerIds : [Doc.activeId];
  let b = null;
  ids.forEach(id => { const L = Doc.byId(id); if (!L || L.kind !== 'raster') return; const r = rasterBounds(L); if (r) b = b ? {x0:Math.min(b.x0, r.x0), y0:Math.min(b.y0, r.y0), x1:Math.max(b.x1, r.x1), y1:Math.max(b.y1, r.y1)} : r; });
  if (!b) ids.forEach(id => { const r = layerRect(Doc.byId(id)); if (r) b = b ? {x0:Math.min(b.x0, r.x0), y0:Math.min(b.y0, r.y0), x1:Math.max(b.x1, r.x1), y1:Math.max(b.y1, r.y1)} : r; });
  if (!b) b = {x0:0, y0:0, x1:Doc.width, y1:Doc.height};    // 都空＝整份文件
  const w = document.getElementById('canvasWrap').getBoundingClientRect(), k = PsView.rulersShown() ? RULER : 0;
  let aw = w.width - k, ah = w.height - k; if (aw <= 50){ aw = 1200; ah = 800; }
  const z = Math.min(64, Math.max(0.01, Math.min((aw - 40) / Math.max(1, b.x1 - b.x0), (ah - 40) / Math.max(1, b.y1 - b.y0))));
  const r = setView(z, [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]);
  return {ok:true, zoom:r.zoom, bounds:[b.x0, b.y0, b.x1, b.y1]};
});

/* ── 水平翻转、屏幕模式 ── */
function applyFlip(){
  const v = document.getElementById('view'); if (!v || !window.HandView) return;
  HandView.apply();
}
reg('view.flipHorizontal', '{on?} 视图 ▸ 水平翻转：只翻画面（文件不变；滑鼠落点照翻回来）→ {ok, on}', p => { PsView.flip = flagOf(p, PsView.flip); afterView(); return {ok:true, on:PsView.flip}; });
SCREEN_MODES.forEach(m => reg('view.screenMode.' + m, '{} 视图 ▸ 屏幕模式 ▸ 这一项 → {ok, screenMode}', () => { if (window.Toolbar) Toolbar.screenMode(SCREEN_TB[m]); return {ok:true, screenMode:m}; }));
reg('view.screenMode.cycle', '{} 轮换屏幕模式（F）→ {ok, screenMode}', () => {
  const cur = window.Toolbar ? Object.keys(SCREEN_TB).find(k => SCREEN_TB[k] === Toolbar.screen) || 'standard' : 'standard';
  const next = SCREEN_MODES[(SCREEN_MODES.indexOf(cur) + 1) % 3]; if (window.Toolbar) Toolbar.screenMode(SCREEN_TB[next]); return {ok:true, screenMode:next};
});

/* ── 显示额外内容、显示 ▸ …（view_cmds.rs:476-493） ── */
reg('view.extras', '{on?} 视图 ▸ 显示额外内容（Ctrl+H）：总开关（参考线、格点、选区边缘、图层边缘、像素格点…）→ {ok, on}', p => { PsView.extras = flagOf(p, PsView.extras); afterView(); return {ok:true, on:PsView.extras}; });
SHOW_KEYS.forEach(k => reg('view.show.' + k, `{on?} 视图 ▸ 显示 ▸ ${k}（打开任一项会顺便打开「显示额外内容」，同 PS）→ {ok, on}`, p => {
  const v = flagOf(p, PsView.show[k]); PsView.show[k] = v; if (v) PsView.extras = true; afterView(); return {ok:true, on:v};
}));
reg('view.show.all', '{} 视图 ▸ 显示 ▸ 全部：Show 全开（含图层边缘与网格）、显示额外内容、格点、参考线 → {ok}', () => {
  PsView.show = Object.assign({}, SHOW_DEFAULT, {layerEdges:true, mesh:true}); PsView.extras = true; PsView.e.grid = true; PsView.e.guides = true; afterView(); return {ok:true};
});
reg('view.show.showExtrasOptions', '{layerEdges?, selectionEdges?, …（十三项 bool）, dialog?:true} 视图 ▸ 显示 ▸ 显示额外选项…：一次设多项 → {ok, show}', p => {
  if (p.dialog){ Dlg.extrasOptions(); return {ok:true, dialog:'extrasOptions'}; }
  const C = 'view.show.showExtrasOptions', next = Object.assign({}, PsView.show);
  for (const k in p){ if (!SHOW_KEYS.includes(k) || typeof p[k] !== 'boolean') return err(C, `unknown Show item \`${k}\` (${SHOW_KEYS.join('|')})`); next[k] = p[k]; }
  PsView.show = next; afterView(); return {ok:true, show:Object.assign({}, next)};
});
/* menus.rs:353-364 五个开关 */
reg('view.show.grid', '{on?} 视图 ▸ 显示 ▸ 网格（Ctrl+\'）：每英寸一主线、4 细分（照首选项）→ {ok, on}', p => { PsView.e.grid = flagOf(p, PsView.e.grid); afterView(); return {ok:true, on:PsView.e.grid}; });
reg('view.show.guides', '{on?} 视图 ▸ 显示 ▸ 参考线（Ctrl+;）→ {ok, on}', p => { PsView.e.guides = flagOf(p, PsView.e.guides); afterView(); return {ok:true, on:PsView.e.guides}; });
reg('view.rulers', '{on?} 视图 ▸ 标尺（Ctrl+R）：画布区上、左 16 点标尺（像素）；从标尺拉出参考线 → {ok, on}', p => { PsView.e.rulers = flagOf(p, PsView.e.rulers); afterView(); return {ok:true, on:PsView.e.rulers}; });
reg('view.snap', '{on?} 视图 ▸ 对齐（Ctrl+Shift+;）：选框、裁剪、钢笔、形状、直线、文字的落点与移动工具的图层外框，8 屏幕点内吸到「对齐到」的目标（拖曳中按 Ctrl 暂时不吸）→ {ok, on}', p => { PsView.e.snap = flagOf(p, PsView.e.snap); return {ok:true, on:PsView.e.snap}; });
SNAP_KEYS.forEach(k => reg('view.snapTo.' + k, `{on?} 视图 ▸ 对齐到 ▸ ${k} → {ok, on}`, p => ({ok:true, on:(PsView.snapTo[k] = flagOf(p, PsView.snapTo[k]))})));
['all', 'none'].forEach(k => reg('view.snapTo.' + k, `{} 视图 ▸ 对齐到 ▸ ${k === 'all' ? '全部' : '无'} → {ok, on}`, () => { SNAP_KEYS.forEach(s => PsView.snapTo[s] = k === 'all'); return {ok:true, on:k === 'all'}; }));

/* ── 参考线（edit_cmds.rs:370-443、file_cmds.rs:883-990；跟 AI 共用 Doc.aiGuides） ── */
reg('view.lockGuides', '{on?} 视图 ▸ 锁定参考线（Ctrl+Alt+;；跟 AI 视图共用一个锁）→ {ok, on}', p => { const r = run('ai.view.guides.lock', {locked:flagOf(p, PsView.locked())}); return {ok:true, on:r ? r.locked : PsView.locked()}; });
const orient = p => p.orientation === 'vertical';
reg('view.newGuide', '{orientation:"horizontal|vertical"="horizontal", position: 像素, dialog?:true（开「新建参考线」对话框）} 视图 ▸ 新建参考线… → {ok, index}', p => {
  if (p.dialog){ Dlg.newGuide(); return {ok:true, dialog:'newGuide'}; }
  const pos = Number(p.position); if (p.position === undefined || p.position === null || !isFinite(pos)) return err('view.newGuide', 'missing `position`');
  return run('ai.guide.add', {vertical:orient(p), pos});
}, true);
reg('view.moveGuide', '{orientation, index（该方向的第几条）, position} 移动一条参考线（锁住时不行）', p => {
  const gi = globalIndex(orient(p), +p.index); if (gi < 0) return err('view.moveGuide', 'no such guide');
  const pos = Number(p.position); if (!isFinite(pos)) return err('view.moveGuide', 'missing `position`');
  return run('ai.guide.move', {index:gi, pos});
}, true);
reg('view.deleteGuide', '{orientation, index} 删掉一条参考线（锁住时不行）', p => {
  const gi = globalIndex(orient(p), +p.index); if (gi < 0) return err('view.deleteGuide', 'no such guide');
  return run('ai.guide.remove', {index:gi});
}, true);
reg('view.clearGuides', '{} 视图 ▸ 清除参考线：所有标尺参考线 → {ok, cleared}', () => {
  const n = PsView.guides().length; if (!n) return {ok:true, cleared:0};
  History.push(); Doc.aiGuides = []; return {ok:true, cleared:n};
});
reg('view.clearCanvasGuides', '{} 视图 ▸ 清除画布参考线：不在画板里的参考线（我们没有画板 ⇒ 全部）→ {ok, cleared}', () => {
  const n = PsView.guides().length; if (!n) return {ok:true, cleared:0};
  History.push(); Doc.aiGuides = []; return {ok:true, cleared:n};
});
function pushUnique(list, vertical, x){ if (!list.some(g => g.vertical === vertical && Math.abs(g.pos - x) < 0.01)) list.push({vertical, pos:Math.fround(x)}); }
function layoutLines(start, end, count, width, gutter, center, out){   // file_cmds.rs:894-908
  const avail = Math.max(0, end - start); if (!count) return;
  const n = count, w = width !== null && width !== undefined ? width : Math.max(0, (avail - (n - 1) * gutter) / n);
  const total = n * w + (n - 1) * gutter, x0 = center && width !== null && width !== undefined ? start + (avail - total) / 2 : start;
  for (let i = 0; i < count; i++){ const a = x0 + i * (w + gutter); out.push(a, a + w); }
}
reg('view.newGuideLayout', '{columns=0, width?:栏宽, gutter=0, rows=0, height?:行高, rowGutter?（缺省＝gutter）, margin: 数 | [上,左,下,右], centerColumns=false, clearExisting=false, dialog?:true} 视图 ▸ 新建参考线版面…（每栏左右两边各一条；不重复 0.01）→ {ok, vertical, horizontal}', p => {
  if (p.dialog){ Dlg.guideLayout(); return {ok:true, dialog:'newGuideLayout'}; }
  const C = 'view.newGuideLayout', cw = Doc.width, ch = Doc.height;
  const m = Array.isArray(p.margin) && p.margin.length === 4 ? p.margin.map(v => +v || 0) : fnum(+p.margin) && p.margin !== null && p.margin !== '' ? Array(4).fill(+p.margin) : [0, 0, 0, 0];
  const [top, left, bottom, right] = m, v = [], h = [];
  const num = k => (p[k] === null || p[k] === undefined || p[k] === '' || !isFinite(+p[k])) ? null : +p[k];
  if (m.some(x => x !== 0)){ v.push(left, cw - right); h.push(top, ch - bottom); }
  const cols = Math.max(0, Math.floor(num('columns') || 0)), rows = Math.max(0, Math.floor(num('rows') || 0)), center = p.centerColumns === true;
  layoutLines(left, cw - right, cols, num('width'), num('gutter') || 0, center, v);
  layoutLines(top, ch - bottom, rows, num('height'), num('rowGutter') !== null ? num('rowGutter') : (num('gutter') || 0), center, h);
  const uv = [], uh = []; v.forEach(x => { if (!uv.some(y => Math.abs(y - x) < 0.01)) uv.push(x); }); h.forEach(x => { if (!uh.some(y => Math.abs(y - x) < 0.01)) uh.push(x); });
  if (!uv.length && !uh.length) return err(C, 'give "columns", "rows" or a "margin"');
  History.push();
  if (p.clearExisting === true) Doc.aiGuides = [];
  const G = PsView.guides(); uv.forEach(x => pushUnique(G, true, x)); uh.forEach(y => pushUnique(G, false, y));
  return {ok:true, vertical:uv.length, horizontal:uh.length};
});
reg('view.newGuidesFromShape', '{layerId?（缺省＝当前图层，要是矢量层＝PS 的形状图层）} 视图 ▸ 通过形状新建参考线：形状外框的左、中、右与上、中、下 → {ok, bounds}', p => {
  const C = 'view.newGuidesFromShape', L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  if (!L || L.kind !== 'vector') return err(C, 'the layer is not a shape layer');
  const b = layerRect(L); if (!b) return err(C, 'the shape has no path');
  History.push();
  const G = PsView.guides();
  [b.x0, (b.x0 + b.x1) / 2, b.x1].forEach(x => pushUnique(G, true, x)); [b.y0, (b.y0 + b.y1) / 2, b.y1].forEach(y => pushUnique(G, false, y));
  return {ok:true, bounds:[b.x0, b.y0, b.x1, b.y1]};
});
reg('view.listGuides', '{} → {ok, vertical:[…], horizontal:[…], locked, visible}', () => {
  const G = PsView.guides(); return {ok:true, vertical:G.filter(g => g.vertical).map(g => g.pos), horizontal:G.filter(g => !g.vertical).map(g => g.pos), locked:PsView.locked(), visible:PsView.e.guides};
});

/* ── 切片、图案预览、像素画预览（原码只记状态） ── */
reg('view.lockSlices', '{on?} 视图 ▸ 锁定切片（原码 slice_cmds.rs:498 只记一个旗标）→ {ok, locked}', p => ({ok:true, locked:(PsView.lockSlices = flagOf(p, PsView.lockSlices))}));
reg('view.patternPreview', '{on?} 视图 ▸ 图案预览（原码只记状态）→ {ok, on}', p => ({ok:true, on:(PsView.patternPreview = flagOf(p, PsView.patternPreview))}));
reg('view.pixelArtPreview', '{on?} 视图 ▸ 像素画预览（原码只记状态）→ {ok, on}', p => ({ok:true, on:(PsView.pixelArtPreview = flagOf(p, PsView.pixelArtPreview))}));

reg('view.state', '{} PS 视图的全部状态 → {ok, extras, extrasFlags, show, snapTo, flip, pixelAspect, proof, guides}', () => ({ok:true, extras:PsView.extras, extrasFlags:Object.assign({lockGuides:PsView.locked()}, PsView.e),
  show:Object.assign({}, PsView.show), snapTo:Object.assign({}, PsView.snapTo), flip:PsView.flip, pixelAspect:PsView.pixelAspect, pixelAspectRatio:PsView.pixelAspectRatio(),
  pixelAspectCorrection:PsView.pixelAspectCorrection, patternPreview:PsView.patternPreview, pixelArtPreview:PsView.pixelArtPreview, lockSlices:PsView.lockSlices,
  customPars:clone(PsView.customPars), proof:clone(PsView.proof), guides:clone(PsView.guides())}));

/* ═══════════ 对话框（照原码栏位） ═══════════ */
const T = o => (window.DlPanels ? DlPanels.t(o) : o.en);
const dialog = o => window.DlPanels ? DlPanels.dialog(o) : null;
const Dlg = PsView.dialogs = {
  /* edit_cmds.rs:436 view.newGuide {orientation, position}；PS 对话框：方向（水平／垂直）＋位置 */
  newGuide(){
    dialog({id:'psNewGuide', title:{'zh-Hant':'新增參考線', 'zh-Hans':'新建参考线', en:'New Guide'}, fields:[
      {k:'orientation', type:'select', label:{'zh-Hant':'方向', 'zh-Hans':'取向', en:'Orientation'}, value:'horizontal',
        options:[['horizontal', {'zh-Hant':'水平', 'zh-Hans':'水平', en:'Horizontal'}], ['vertical', {'zh-Hant':'垂直', 'zh-Hans':'垂直', en:'Vertical'}]]},
      {k:'position', type:'number', label:{'zh-Hant':'位置（像素）', 'zh-Hans':'位置（像素）', en:'Position (px)'}, value:0}],
      ok:v => CMD.run('ps.view.newGuide', {orientation:v.orientation, position:v.position})});
  },
  /* view_cmds.rs:827-829 预设：columns 8、gutter 20、rows 0、rowGutter 0、margin 0、centerColumns false、clearExisting false */
  guideLayout(){
    const L = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, en:c});
    dialog({id:'psGuideLayout', title:L('新增參考線配置', '新建参考线版面', 'New Guide Layout'), fields:[
      {k:'columns', type:'number', min:0, label:L('欄數', '栏数', 'Columns'), value:8},
      {k:'width', type:'number', min:0, label:L('欄寬（空白＝平均）', '栏宽（空白＝平均）', 'Width (blank = even)'), value:''},
      {k:'gutter', type:'number', min:0, label:L('欄間距', '装订线', 'Gutter'), value:20},
      {k:'rows', type:'number', min:0, label:L('列數', '行数', 'Rows'), value:0},
      {k:'height', type:'number', min:0, label:L('列高（空白＝平均）', '行高（空白＝平均）', 'Height (blank = even)'), value:''},
      {k:'rowGutter', type:'number', min:0, label:L('列間距', '行装订线', 'Row Gutter'), value:0},
      {k:'margin', type:'number', min:0, label:L('邊界', '边距', 'Margin'), value:0},
      {k:'centerColumns', type:'check', label:L('欄置中', '列居中', 'Center Columns'), value:false},
      {k:'clearExisting', type:'check', label:L('清除現有參考線', '清除现有参考线', 'Clear Existing Guides'), value:false}],
      ok:v => CMD.run('ps.view.newGuideLayout', v)});
  },
  /* filter_dialog「view.proofSetup」：描述档、意图、黑场补偿、模拟纸色 */
  proofSetup(){
    const L = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, en:c}), S = PsView.proof.setup;
    dialog({id:'psProofSetup', title:L('自訂校樣條件', '自定校样条件', 'Customize Proof Condition'), fields:[
      {k:'profile', type:'select', label:L('模擬裝置', '要模拟的设备', 'Device to Simulate'), value:Proof.isCmyk(S.name) ? 'working-cmyk' : 'srgb',
        options:[['working-cmyk', Proof.cmykName()], ['srgb', 'sRGB IEC61966-2.1']]},
      {k:'intent', type:'select', label:L('演算色彩比對方式', '渲染方法', 'Rendering Intent'), value:S.intent,
        options:[['perceptual', L('感應式', '可感知', 'Perceptual')], ['saturation', L('飽和度', '饱和度', 'Saturation')], ['relative', L('相對公制色度', '相对比色', 'Relative Colorimetric')], ['absolute', L('絕對公制色度', '绝对比色', 'Absolute Colorimetric')]]},
      {k:'bpc', type:'check', label:L('黑色版補償', '黑场补偿', 'Black Point Compensation'), value:S.bpc !== false},
      {k:'simulatePaper', type:'check', label:L('模擬紙張顏色', '模拟纸张颜色', 'Simulate Paper Color'), value:!!S.simulatePaper}],
      ok:v => { const r = CMD.run('ps.view.proofSetup', v); if (r.ok !== false){ PsView.proof.enabled = true; PsView.proof.setup.preset = 'custom'; UI.draw(); } return r; }});
  },
  /* workspace_ui.rs:378-381「Save Pixel Aspect Ratio」：名称＋因子 0.1..10 */
  customPar(){
    const L = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, en:c});
    dialog({id:'psCustomPar', title:L('儲存像素外觀比例', '存储像素长宽比', 'Save Pixel Aspect Ratio'), fields:[
      {k:'name', type:'text', label:L('名稱：', '名称：', 'Name:'), value:''},
      {k:'ratio', type:'number', min:0.1, max:10, step:0.01, label:L('係數：', '因子：', 'Factor:'), value:1}],
      ok:v => CMD.run('ps.view.pixelAspectRatio.custom', {name:v.name, ratio:v.ratio})});
  },
  /* workspace_ui.rs:398-415 显示额外选项：十三个勾 */
  extrasOptions(){
    const N = {layerEdges:['圖層邊緣', '图层边缘', 'Layer Edges'], selectionEdges:['選取範圍邊緣', '选区边缘', 'Selection Edges'], targetPath:['目標路徑', '目标路径', 'Target Path'],
      notes:['備忘稿', '注释', 'Notes'], pixelGrid:['像素格點', '像素网格', 'Pixel Grid'], slices:['切片', '切片', 'Slices'], count:['計數', '计数', 'Count'],
      smartGuides:['智慧型參考線', '智能参考线', 'Smart Guides'], brushPreview:['筆刷預視', '画笔预览', 'Brush Preview'], mesh:['網紋', '网格', 'Mesh'],
      editPins:['編輯圖釘', '编辑图钉', 'Edit Pins'], canvasGuides:['版面參考線', '画布参考线', 'Canvas Guides'], artboardGuides:['工作區域參考線', '画板参考线', 'Artboard Guides']};
    dialog({id:'psExtras', title:{'zh-Hant':'顯示額外內容選項', 'zh-Hans':'显示额外选项', en:'Show Extras Options'},
      fields:Object.keys(N).map(k => ({k, type:'check', label:{'zh-Hant':N[k][0], 'zh-Hans':N[k][1], en:N[k][2]}, value:PsView.show[k]})),
      ok:v => CMD.run('ps.view.show.showExtrasOptions', v)});
  }
};

/* ═══════════ 本菜单的快捷键（PS 模式；照菜单树上的 key） ═══════════ */
const CODE = c => /^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5)
  : ({BracketLeft:'[', BracketRight:']', Semicolon:';', Quote:"'", Equal:'=', Minus:'-', Comma:',', Period:'.', Slash:'/', Backslash:'\\'})[c] || null;
const comboOf = e => [(e.ctrlKey || e.metaKey) ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', CODE(e.code) || (e.key && e.key.length === 1 ? e.key.toUpperCase() : e.key)].filter(Boolean).join('+');
const normKey = k => { const p = k.split('+'), key = p.pop(); return ['Ctrl', 'Alt', 'Shift'].filter(m => p.includes(m)).concat([key.length === 1 ? key.toUpperCase() : key]).join('+'); };
const SKIP_KEYS = ['Ctrl+=', 'Ctrl+-', 'Ctrl+1'];        // 放大／缩小／实际像素归缩放工具那边已有的键
window.addEventListener('keydown', e => {
  if (!window.Menubar || Menubar.app !== 'ps' || !MenuTrees.ps || !MenuTrees.ps.view) return;
  if (/input|select|textarea/i.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable)) return;
  if (document.querySelector('.dlp-dlg-back,.aivdlg-back')) return;
  const c = comboOf(e); let hit = null;
  const go = items => items.forEach(it => { if (hit || it.sep) return; if (it.key && !SKIP_KEYS.includes(it.key) && normKey(it.key) === c && Menubar.enabled(it)) hit = it; if (it.sub) go(it.sub); });
  go(MenuTrees.ps.view.items);
  if (!hit) return;
  e.preventDefault(); e.stopImmediatePropagation();
  Menubar.run(hit);
}, true);

/* ═══════════ 样式 ═══════════ */
if (!document.getElementById('psViewStyle')){
  const st = document.createElement('style'); st.id = 'psViewStyle';
  st.textContent = `.psruler{position:absolute;z-index:6;display:none;background:#262626}
body.ps-rulers .psruler{display:block}
#psRulerTop{left:${RULER}px;top:0;height:${RULER}px;cursor:ns-resize}
#psRulerLeft{left:0;top:${RULER}px;width:${RULER}px;cursor:ew-resize}
#psRulerCorner{left:0;top:0;width:${RULER}px;height:${RULER}px;border-right:1px solid #3a3a3a;border-bottom:1px solid #3a3a3a;box-sizing:border-box}`;
  document.head.appendChild(st);
}

/* ═══════════ 接上共用层（执行期包一层；不改 ui.js／engine.js） ═══════════ */
function hook(){
  if (!window.UI || UI.__psViewHook) return;
  UI.__psViewHook = true;
  // ① 画面合成：接在 ai-view 挂好的 UI.viewComposite 后面
  const prev = UI.viewComposite;
  UI.viewComposite = function(s, target){
    const out = prev ? prev.apply(this, arguments) : composite(s, target);
    if (PsView.active()) PsView.post(target, s);
    return out;
  };
  if (Array.isArray(UI.overlays)) UI.overlays.unshift((ctx, s) => { if (PsView.active() && UI.magnified && UI.magnified()) PsView.drawOverlays(ctx, s); });
  // ② 选区边缘关（或显示额外内容关）＝画面不画行军蚁；画完更新标尺
  const draw = UI.draw;
  UI.draw = function(){
    const hide = PsView.active() && !PsView.shows(PsView.show.selectionEdges) && Doc.sel;
    const sel = Doc.sel;
    if (hide) Doc.sel = null;
    try { return draw.apply(this, arguments); }
    finally { if (hide) Doc.sel = sel; PsView.drawRulers(); }
  };
  // ③ 水平翻转：HandView 每次设 transform 时接上 scaleX(-1)
  if (window.HandView && !HandView.__psFlip){
    HandView.__psFlip = true;
    const ap = HandView.apply;
    HandView.apply = function(){ const r = ap.apply(this, arguments); const v = this.el(); if (v && PsView.flipped()) v.style.transform = (v.style.transform || '') + ' scaleX(-1)'; return r; };
  }
  if (window.ZoomView && !ZoomView.__psFlip){
    ZoomView.__psFlip = true;
    const td = ZoomView.toDoc, ts = ZoomView.toScreen;
    ZoomView.toDoc = function(p){ const d = td.call(this, p); return PsView.flipped() ? [Doc.width - d[0], d[1]] : d; };
    ZoomView.toScreen = function(d){ return ts.call(this, PsView.flipped() ? [Doc.width - d[0], d[1]] : d); };
  }
  const wrap = document.getElementById('canvasWrap');
  if (wrap){
    wrap.addEventListener('pointerdown', guideGrab, true);
    wrap.addEventListener('pointermove', () => { if (PsView.rulersShown()) PsView.drawRulers(); });
  }
  // 换层（PS↔AI）时翻转要跟着换
  const rf = UI.refresh;
  UI.refresh = function(){ const r = rf.apply(this, arguments); const want = PsView.flipped(); if (want !== !!PsView._flipShown){ PsView._flipShown = want; applyFlip(); } return r; };
}
// ④ 滑鼠点：翻转换坐标、靠齐（Pointer 在 ui.js 之前就有）
if (window.Pointer && !Pointer.__psViewHook){
  Pointer.__psViewHook = true;
  [['onDown', 'down'], ['onMove', 'move'], ['onUp', 'up'], ['onDblClick', 'dbl']].forEach(([k, kind]) => {
    const o = Pointer[k];
    Pointer[k] = function(e, pt){
      if (kind === 'move' && !this.down && !(active)) return o.call(this, e, PsView.active() && PsView.flipped() && pt ? [Doc.width - pt[0], pt[1]] : pt);
      return o.call(this, e, kind === 'dbl' ? (PsView.flipped() && pt ? [Doc.width - pt[0], pt[1]] : pt) : PsView.filterPt(kind, e, pt));
    };
  });
}
if (window.UI && UI.canvas) hook(); else window.addEventListener('DOMContentLoaded', hook);
if (window.UI && UI.canvas){ applyFlip(); UI.draw(); }

/* ═══════════ 全屏时锁定快捷键（Keyboard Lock API；照 PS 让 Ctrl+T／N／W 归画板）═══════════
   浏览器分页模式下 Ctrl+T／N／W 被浏览器拿走、网页拦不到（只能走菜单）；进入真正的全屏（requestFullscreen：检视 ▸ 屏幕模式 ▸ 全屏，或按 F11）后
   navigator.keyboard.lock 才能把这几颗键交给网页 ⇒ 菜单快捷键兜底照常接到（编辑 ▸ 自由变换＝Ctrl+T…）。开关记在 localStorage（预设开）。
   F11：浏览器自己的全屏拿不到 keyboard.lock ⇒ 改成网页全屏（同一个画面） */
const KB_KEYS = ['KeyT', 'KeyN', 'KeyW'], KB_PREF = 'dlc.kbLockFullscreen';
const KbLock = window.KbLock = {
  locked:false,
  enabled(){ try { return localStorage.getItem(KB_PREF) !== '0'; } catch (e){ return true; } },
  supported(){ return !!(navigator.keyboard && navigator.keyboard.lock); },
  async apply(){
    const want = this.enabled() && !!document.fullscreenElement && this.supported();
    try {
      if (want && !this.locked){ await navigator.keyboard.lock(KB_KEYS); this.locked = true; }
      else if (!want && this.locked){ navigator.keyboard.unlock(); this.locked = false; }
    } catch (e){ this.locked = false; }
    return this.locked;
  }
};
document.addEventListener('fullscreenchange', () => { KbLock.apply(); });
window.addEventListener('keydown', e => {
  if (e.key !== 'F11' || e.ctrlKey || e.altKey || e.metaKey) return;
  e.preventDefault();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
}, true);
reg('view.lockShortcutsInFullScreen', '{on?:bool（不给＝切换）} 全屏时锁定快捷键：全屏（检视 ▸ 屏幕模式 ▸ 全屏／F11）时用 Keyboard Lock API 把 Ctrl+T／N／W 交给画板；非全屏照旧走菜单 → {on, locked, supported}', p => {
  const on = typeof (p || {}).on === 'boolean' ? p.on : !KbLock.enabled();
  try { localStorage.setItem(KB_PREF, on ? '1' : '0'); } catch (e){}
  KbLock.apply();
  return {ok:true, on, locked:KbLock.locked, supported:KbLock.supported()};
});
})();
