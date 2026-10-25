/* 堤麟画板 · Illustrator ▸ 窗口 ▸ 画笔库／图形样式库／色板库（用户定义）／符号库
   原码对照：
     vectorcraft ui-egui/src/menus.rs:45-48、2083-2086   画笔库、符号库三项（内置库／用户定义／其它库…）原码都是 todo ⇒ 原码无·照 AI 2020 行为做
     vectorcraft doc/src/style_libs.rs:146-446            图形样式库六个内建库（阴影和发光／轮廓和线条／手绘／渐变表面／形状效果／混合和透明度）逐款翻；
                                                          .vcstyles＝{format, version, name, styles}（我们自己的 JSON 换成 dilin-graphic-styles，见下）
     vectorcraft ui-egui/src/panels/graphic_styles.rs:775-799  用户定义／其它库…／存储图形样式…（原码读写使用者资料夹；网页版改 localStorage＋下载档）
   我们的做法（照 AI 2020）：
     ■ 每种库一个浮动库面板（aiLibBrush／aiLibStyle／aiLibSymbol 向量专用；aiLibSwatch 两种都行）：上面下拉选库、中间缩图格、底下 ◀ ▶／加入全部／存储／其它库／删除库。
     ■ 点库里一项＝加进文件的画笔／图形样式／符号／色板面板；有选取时画笔与图形样式顺便套上（AI：点库画笔＝加进画笔面板并套到所选路径）；符号双击＝置入实例到画面中央。
     ■ 内置库照 AI 2020 的库名（画笔库 14 个、符号库 8 个；图形样式库照原码 6 个），每个库 6～13 款，都是真的能画的画笔／形状。
     ■ 用户定义＝localStorage（dlAiLib.<种类>.v1：[{name, items}]）；存储＝把文件面板里的项目存成一个用户库（存储图形样式…另外经 file.exportData 出档）。
     ■ 其它库…＝开本机档：我们自己的 JSON {format:'dilin-brushes'|'dilin-graphic-styles'|'dilin-symbols'|'dilin-swatches', version:1, name, items:[…]}；
       色板另外读 Adobe .ase（ASEF：RGB／CMYK／LAB／Gray、颜色组）与 .gpl；窗口 ▸ 色板库 ▸ 其它库… 也包一层让它认 .ase。
   🔴 图形样式的渐变要贴合每个物件的外框（原码 GradientPaint 拟合 unit box）：库里的渐变带 _fit（角度或单位框里的圆心半径），
      本档把 ai.graphicStyle.apply 包一层：套完对每个物件按外框重算一次渐变向量（不改 ai-window.js 本体）。
   近似（我们的外观堆叠没有「单层效果／单层混合模式」）：轮廓和线条的偏移／内缩轮廓线改用描边对齐＋白色间隔、手绘的粗糙化／涂抹改挂在物件上、
      混合和透明度里单层的正片叠底／叠加／滤色／柔光改用该层不透明度近似（逐款写在库定义旁）。
   命令：ai.window.brushLibrary／.user／.other、ai.window.graphicStyleLibrary.open／.user／.other、ai.ui.saveGraphicStyleLibrary、
         ai.window.swatchLibrary.user、ai.window.symbolLibrary／.user／.other、ai.library.list／add／saveUser／deleteUser／export／importText。 */
(function(){
'use strict';
if (window.AiLibraries) return;
if (!window.DlPanels || !window.AiWindow || !window.CMD){ console.warn('[ai-libraries] 需要 menus/impl/panels.js 与 ai-window.js 先载'); return; }
const P = window.DlPanels, el = P.el.bind(P), T = P.t;
const L3 = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, en:c});
const clone = v => JSON.parse(JSON.stringify(v));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const err = (c, m) => ({ok:false, error:`${c}: ${m}`});
const hex2 = v => ('0' + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2);
const rgbHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);
const sub = id => CMD.map[id] ? (p => CMD.map[id].run(p || {})) : (() => ({ok:false, error:`no command ${id}`}));   // 命令里叫命令：直接跑 run（不另占一步历史）
const AL = window.AiLibraries = {state:{brush:{open:null}, graphicStyle:{open:null}, symbol:{open:null}, swatch:{open:null}}};

/* ═════════════ 小几何（画笔图稿＝{polys:[[x,y]…], color, box?}；x 沿路径、y 横向，1pt 粗细为准） ═════════════ */
const ell = (cx, cy, rx, ry, n) => Array.from({length:n || 24}, (_, i) => { const a = i / (n || 24) * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const starPts = (cx, cy, r1, r2, n, a0) => Array.from({length:n * 2}, (_, i) => { const a = (a0 === undefined ? -Math.PI / 2 : a0) + i * Math.PI / n, r = i % 2 ? r2 : r1; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
const ngon = (cx, cy, r, n, a0) => Array.from({length:n}, (_, i) => { const a = (a0 === undefined ? -Math.PI / 2 : a0) + i * Math.PI * 2 / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
const rot = (pts, a, cx, cy) => { const c = Math.cos(a), s = Math.sin(a); return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]); };
const heart = (cx, cy, r) => Array.from({length:32}, (_, i) => { const t = i / 32 * Math.PI * 2; return [cx + r * 16 * Math.pow(Math.sin(t), 3) / 17, cy - r * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17]; });
let _sd = 1; const rnd = () => { _sd = (_sd * 16807) % 2147483647; return (_sd - 1) / 2147483646; };
const seed = s => { _sd = s % 2147483646 || 1; };
const gk = k => rgbHex((1 - k) * 255, (1 - k) * 255, (1 - k) * 255);   // K 值灰
/* 一条沿 x 的带子：粗细 h(t)（t＝0..1），rough＝边缘抖动 */
function band(len, half, seedN, opt){
  opt = opt || {}; seed(seedN || 1);
  const n = opt.n || 40, top = [], bot = [], ex = opt.exp === undefined ? 0.5 : opt.exp, rough = opt.rough || 0;
  const prof = opt.prof || (t => Math.pow(Math.max(0, Math.sin(Math.PI * t)), ex));
  for (let i = 0; i <= n; i++){ const t = i / n, h = half * prof(t); top.push([t * len, -(h * (1 + rough * (rnd() * 2 - 1))) + (opt.dy || 0)]); bot.push([t * len, h * (1 + rough * (rnd() * 2 - 1)) + (opt.dy || 0)]); }
  return top.concat(bot.reverse());
}
const art = (polys, color, extra) => Object.assign({polys:Array.isArray(polys[0][0]) ? polys : [polys], color:color || '#000000'}, extra || {});
/* 白色细缝（炭笔、粉笔的纸纹） */
const streaks = (len, half, n, seedN) => { seed(seedN); return Array.from({length:n}, () => { const x0 = rnd() * len * 0.8, w = len * (0.08 + rnd() * 0.18), y = (rnd() * 2 - 1) * half * 0.6; return art(ell(x0 + w / 2, y, w / 2, half * 0.08 + 0.05, 14), '#ffffff'); }); };

/* ═════════════ 画笔库（AI 2020：窗口 ▸ 画笔库 ▸ …） ═════════════ */
function arrowArt(head, tail, w){
  w = w || 1; const out = [], hs = head === 'none' ? 100 : 82, ts = tail === 'feather' ? 14 : tail === 'none' ? 0 : 6;
  out.push(art(rect(ts, -w, hs + 1, w)));
  const H = {
    triangle:() => [[82, -5], [100, 0], [82, 5]], barbed:() => [[78, -6], [100, 0], [78, 6], [84, 0]], slim:() => [[86, -3], [100, 0], [86, 3]],
    open:() => [[82, -6], [100, 0], [82, 6], [80.5, 4.4], [96, 0], [80.5, -4.4]], round:() => ell(92, 0, 6, 6, 24), square:() => rect(86, -5, 98, 5), diamond:() => [[82, 0], [91, -5], [100, 0], [91, 5]]};
  if (H[head]) out.push(art(H[head]()));
  if (tail === 'feather') out.push(art([[0, -5], [6, -5], [14, -1], [8, -1]]), art([[0, 5], [6, 5], [14, 1], [8, 1]]));
  else if (tail === 'dot') out.push(art(ell(4, 0, 4, 4, 20)));
  else if (tail === 'bar') out.push(art(rect(0, -5, 3, 5)));
  else if (tail === 'triangle') out.push(art([[18, -5], [0, 0], [18, 5]]));
  return out;
}
const tile = (polys, color, box) => art(polys, color, box ? {box} : null);
const BRUSH_LIBS = [
  ['arrows-standard', L3('箭頭_標準', '箭头_标准', 'Arrows_Standard'), () => [
    ['Arrow 1.01', 'triangle', 'none'], ['Arrow 1.02', 'barbed', 'none'], ['Arrow 1.03', 'slim', 'none'], ['Arrow 2.01', 'triangle', 'feather'], ['Arrow 2.02', 'open', 'feather'],
    ['Arrow 3.01', 'round', 'dot'], ['Arrow 3.02', 'square', 'bar'], ['Arrow 4.01', 'diamond', 'dot'], ['Arrow 5.01', 'triangle', 'triangle']]
    .map(([name, h, t]) => ({name, type:'art', art:arrowArt(h, t, name.startsWith('Arrow 1.03') ? 0.6 : 1), guides:[t === 'none' ? 0 : t === 'feather' ? 0.14 : 0.08, h === 'round' ? 0.86 : 0.82], colorization:'tints'}))],
  ['arrows-special', L3('箭頭_特殊', '箭头_特殊', 'Arrows_Special'), () => [
    {name:'Arrow Scatter', type:'scatter', art:[art([[-4, -1], [1, -1], [1, -3], [5, 0], [1, 3], [1, 1], [-4, 1]])], size:[80, 120], spacing:[140, 180], scatter:[-40, 40], rotation:[0, 0], relative:true, colorization:'tints'},
    {name:'Chevron Trail', type:'pattern', art:[tile([[0, -3], [3, -3], [6, 0], [3, 3], [0, 3], [3, 0]], '#000000', [0, 9])], fit:'stretch', colorization:'tints'},
    {name:'Double-Headed Arrow', type:'art', art:arrowArt('triangle', 'triangle', 1), guides:[0.18, 0.82], colorization:'tints'},
    {name:'Hand-Drawn Arrow', type:'art', art:[art(band(86, 1.2, 11, {exp:0.15, rough:0.35})), art([[78, -7], [100, 0], [77, 6], [80, 0.5]])], guides:[0, 0.76], colorization:'tints'},
    {name:'Dashed Arrow', type:'art', art:[...[0, 18, 36, 54].map(x => art(rect(x, -0.9, x + 11, 0.9))), art([[72, -5], [100, 0], [72, 5]])], guides:[0, 0.72], colorization:'tints'},
    {name:'Arrow Dots', type:'pattern', art:[tile(ell(2, 0, 1.6, 1.6, 16), '#000000', [0, 6])], fit:'addSpace', spacing:20, colorization:'tints'}]],
  ['artistic-calligraphic', L3('藝術效果_書法', '艺术效果_书法', 'Artistic_Calligraphic'), () =>
    [[1, 'Flat'], [3, 'Flat'], [5, 'Flat'], [10, 'Flat'], [15, 'Flat'], [20, 'Flat'], [3, 'Oval'], [5, 'Oval'], [10, 'Oval'], [15, 'Oval'], [20, 'Oval'], [1, 'Round'], [3, 'Round'], [6, 'Round']]
      .map(([sz, k]) => ({name:`${sz} pt. ${k}`, type:'calligraphic', size:sz, angle:k === 'Round' ? 0 : k === 'Flat' ? 45 : 30, roundness:k === 'Round' ? 100 : k === 'Flat' ? 12 : 50}))],
  ['artistic-chalk', L3('藝術效果_粉筆炭筆鉛筆', '艺术效果_粉笔炭笔铅笔', 'Artistic_ChalkCharcoalPencil'), () => [
    {name:'Charcoal - Feather', type:'art', art:[art(band(100, 3, 3, {exp:0.45, rough:0.25}), gk(0.85)), ...streaks(100, 3, 4, 31)], colorization:'tints'},
    {name:'Charcoal - Thick', type:'art', art:[art(band(100, 5, 5, {exp:0.3, rough:0.2}), gk(0.9)), ...streaks(100, 5, 6, 51)], colorization:'tints'},
    {name:'Charcoal - Rough', type:'art', art:[art(band(100, 3.5, 7, {exp:0.35, rough:0.5}), gk(0.85)), ...streaks(100, 3.5, 5, 71)], colorization:'tints'},
    {name:'Chalk', type:'art', art:[art(band(100, 2.5, 9, {exp:0.2, rough:0.35}), gk(0.75)), ...streaks(100, 2.5, 7, 91)], colorization:'tints'},
    {name:'Chalk - Scribble', type:'art', art:[0, 1, 2].map(i => art(band(100, 1, 13 + i, {exp:0.3, rough:0.4, dy:(i - 1) * 1.6}), gk(0.7))), colorization:'tints'},
    {name:'Pencil', type:'art', art:[art(band(100, 0.8, 17, {exp:0.25, rough:0.12}), gk(0.9))], colorization:'tints'},
    {name:'Pencil - Thin', type:'art', art:[art(band(100, 0.45, 19, {exp:0.25, rough:0.12}), gk(0.9))], colorization:'tints'},
    {name:'Crayon', type:'art', art:[art(band(100, 2, 23, {exp:0.15, rough:0.3}), gk(0.8)), ...streaks(100, 2, 10, 231)], colorization:'tints'}]],
  ['artistic-ink', L3('藝術效果_油墨', '艺术效果_油墨', 'Artistic_Ink'), () => [
    {name:'Dry Ink 1', type:'art', art:[art(band(100, 2.2, 29, {exp:0.25, rough:0.3})), ...streaks(100, 2.2, 5, 291)], colorization:'tints'},
    {name:'Dry Ink 2', type:'art', art:[0, 34, 70].map((x, i) => art(band(28, 1.8, 30 + i, {exp:0.4, rough:0.3}).map(([a, b]) => [a + x, b]))), colorization:'tints'},
    {name:'Fude', type:'art', art:[art(band(100, 3, 37, {prof:t => t < 0.1 ? 0.6 + 4 * t : Math.pow(1 - t, 0.6) * 1.15, rough:0.05}))], colorization:'tints'},
    {name:'Tapered Ink', type:'art', art:[art(band(100, 2.5, 41, {exp:1}))], colorization:'tints'},
    {name:'Ink Drop', type:'art', art:[art(band(88, 1.6, 43, {prof:t => 0.3 + 0.7 * t})), art(ell(93, 0, 5, 4.2, 24))], guides:[0, 0.85], colorization:'tints'},
    {name:'Ink Splatter', type:'scatter', art:[art(ell(0, 0, 2.2, 1.8, 18)), art(ell(3.2, -1.6, 0.7, 0.7, 10)), art(ell(-2.8, 1.9, 0.5, 0.5, 10))], size:[50, 150], spacing:[80, 200], scatter:[-120, 120], rotation:[-180, 180], colorization:'tints'}]],
  ['artistic-paintbrush', L3('藝術效果_畫筆', '艺术效果_画笔', 'Artistic_Paintbrush'), () => [
    {name:'Brush Strokes 1', type:'art', art:[-2, 0, 2].map((dy, i) => art(band(100 - i * 6, 1.4, 47 + i, {exp:0.2, rough:0.25, dy}))), colorization:'tints'},
    {name:'Brush Strokes 2', type:'art', art:[-3, -1, 1, 3].map((dy, i) => art(band(100, 1, 53 + i, {exp:0.15, rough:0.35, dy}), gk(0.7 + 0.08 * i))), colorization:'tints'},
    {name:'Dry Brush 1', type:'art', art:[art(band(100, 3, 59, {exp:0.2, rough:0.15})), ...streaks(100, 3, 9, 591)], colorization:'tints'},
    {name:'Dry Brush 2', type:'art', art:[art(band(100, 4, 61, {exp:0.12, rough:0.3})), ...streaks(100, 4, 14, 611)], colorization:'tints'},
    {name:'Paint Brush 1', type:'art', art:[art(band(100, 2.6, 67, {prof:t => Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.6)), 0.3) * (t > 0.85 ? (1 - t) / 0.15 : 1), rough:0.12}))], colorization:'tints'},
    {name:'Paint Brush 2', type:'art', art:[art(band(100, 3.5, 71, {exp:0.25, rough:0.2}), gk(0.85)), art(band(90, 1.2, 73, {exp:0.3, dy:-1}), gk(0.6))], colorization:'tints'}]],
  ['artistic-watercolor', L3('藝術效果_水彩', '艺术效果_水彩', 'Artistic_Watercolor'), () => [
    {name:'Watercolor Wash', type:'art', art:[art(band(100, 5, 79, {exp:0.3, rough:0.15}), gk(0.25)), art(band(96, 3.5, 83, {exp:0.35, rough:0.2}), gk(0.4)), art(band(90, 1.6, 89, {exp:0.4, rough:0.25}), gk(0.6))], colorization:'tints'},
    {name:'Watercolor Stroke 1', type:'art', art:[art(band(100, 3, 97, {exp:0.4, rough:0.18}), gk(0.45)), art(band(100, 3, 98, {exp:0.4, rough:0.06}).map(([x, y]) => [x, y * 1.05]), gk(0.15))], colorization:'tints'},
    {name:'Watercolor Stroke 2', type:'art', art:[art(band(100, 2.2, 101, {exp:0.6, rough:0.3}), gk(0.55)), art(band(70, 1.2, 103, {exp:0.6, dy:0.6}), gk(0.8))], colorization:'tints'},
    {name:'Watercolor Bleed', type:'art', art:[art(band(100, 6, 107, {exp:0.2, rough:0.3}), gk(0.18)), art(band(100, 2.8, 109, {exp:0.3, rough:0.2}), gk(0.5))], colorization:'tints'},
    {name:'Watercolor Dry Edge', type:'art', art:[art(band(100, 3.2, 113, {exp:0.25, rough:0.1}), gk(0.3)), art(band(100, 3.2, 113, {exp:0.25, rough:0.1}).map(([x, y]) => [x, y * 1.08]).slice(0, 41), gk(0.7))], colorization:'tints'},
    {name:'Watercolor Spatter', type:'scatter', art:[art(ell(0, 0, 3, 2.6, 20), gk(0.35)), art(ell(0.6, -0.4, 1.8, 1.5, 16), gk(0.6))], size:[40, 160], spacing:[70, 160], scatter:[-150, 150], rotation:[-180, 180], colorization:'tints'}]],
  ['borders-dashed', L3('邊框_虛線', '边框_虚线', 'Borders_Dashed'), () => [
    {name:'Dashed Circle 1.1', art:[tile(ell(2, 0, 1.8, 1.8, 18), '#000000', [0, 7])]}, {name:'Dashed Square 1.1', art:[tile(rect(0.4, -1.6, 3.6, 1.6), '#000000', [0, 7])]},
    {name:'Dash 1.1', art:[tile(rect(0, -0.8, 8, 0.8), '#000000', [0, 12])]}, {name:'Dash Dot 1.1', art:[tile(rect(0, -0.8, 8, 0.8)), tile(ell(12, 0, 1, 1, 12), '#000000', [0, 16])]},
    {name:'Double Dash 1.1', art:[tile(rect(0, -2.4, 7, -1)), tile(rect(0, 1, 7, 2.4), '#000000', [0, 10])]}, {name:'Diamond Dash 1.1', art:[tile([[0, 0], [3, -2], [6, 0], [3, 2]], '#000000', [0, 9])]},
    {name:'Long Short 1.1', art:[tile(rect(0, -0.8, 10, 0.8)), tile(rect(13, -0.8, 16, 0.8), '#000000', [0, 19])]}]
    .map(b => Object.assign({type:'pattern', fit:'stretch', colorization:'tints'}, b))],
  ['borders-geometric', L3('邊框_幾何圖形', '边框_几何图形', 'Borders_Geometric'), () => [
    {name:'Geometric 1', art:[tile([[0, 2], [3, -2], [6, 2]]), tile([[6, -2], [9, 2], [12, -2]], '#000000', [0, 12])]},
    {name:'Geometric 2', art:[tile([[0, 1.2], [3, -2.2], [6, 1.2], [6, 2.6], [3, -0.8], [0, 2.6]], '#000000', [0, 6])]},
    {name:'Geometric 3', art:[tile([[0, -3], [2, -3], [5, 0], [2, 3], [0, 3], [3, 0]], '#000000', [0, 6])]},
    {name:'Geometric 4', art:[tile(rot(rect(0.5, -2, 4.5, 2), Math.PI / 4, 2.5, 0), '#000000', [0, 7])]},
    {name:'Geometric 5', art:[tile([ngon(3, 0, 3, 6, 0), ngon(3, 0, 1.8, 6, 0).reverse()], '#000000', [0, 6])]},
    {name:'Geometric 6', art:[tile([ell(3, 0, 3, 3, 24), ell(3, 0, 2, 2, 24).reverse()], '#000000', [0, 5.4])]},
    {name:'Geometric 7', art:[tile(rect(0, -2.5, 2.5, 0)), tile(rect(2.5, 0, 5, 2.5), '#000000', [0, 5])]}]
    .map(b => Object.assign({type:'pattern', fit:'stretch', colorization:'tints'}, b))],
  ['borders-lines', L3('邊框_線條', '边框_线条', 'Borders_Lines'), () => [
    {name:'Double Lines', art:[tile(rect(0, -2.2, 10, -1)), tile(rect(0, 1, 10, 2.2), '#000000', [0, 10])]},
    {name:'Triple Lines', art:[tile(rect(0, -3, 10, -2.2)), tile(rect(0, -0.4, 10, 0.4)), tile(rect(0, 2.2, 10, 3), '#000000', [0, 10])]},
    {name:'Thick Thin', art:[tile(rect(0, -2.6, 10, -0.6)), tile(rect(0, 1, 10, 1.6), '#000000', [0, 10])]},
    {name:'Rope', art:[tile([[0, -2.5], [2, -2.5], [4.5, 2.5], [2.5, 2.5]]), tile([[2.6, -2.5], [3.4, -2.5], [5.9, 2.5], [5.1, 2.5]], gk(0.5), [0, 3])]},
    {name:'Railroad', art:[tile(rect(0, -2.6, 8, -1.9)), tile(rect(0, 1.9, 8, 2.6)), tile(rect(3, -3.4, 5, 3.4), '#000000', [0, 8])]},
    {name:'Dotted Line', art:[tile(ell(1.2, 0, 1, 1, 14), '#000000', [0, 4])]}]
    .map(b => Object.assign({type:'pattern', fit:'stretch', colorization:'tints'}, b))],
  ['borders-decorative', L3('邊框_裝飾', '边框_装饰', 'Borders_Decorative'), () => [
    {name:'Scallop', art:[tile([[0, 1.5]].concat(Array.from({length:13}, (_, i) => { const a = Math.PI - i * Math.PI / 12; return [3 + Math.cos(a) * 3, 1.5 - Math.sin(a) * 3]; })), '#000000', [0, 6])]},
    {name:'Wave', art:[tile(Array.from({length:21}, (_, i) => [i * 0.6, Math.sin(i / 20 * Math.PI * 2) * 2 - 0.7]).concat(Array.from({length:21}, (_, i) => [(20 - i) * 0.6, Math.sin((20 - i) / 20 * Math.PI * 2) * 2 + 0.7])), '#000000', [0, 12])]},
    {name:'Hearts', art:[tile(heart(3, 0, 2.6), '#000000', [0, 7])], colorization:'tints'},
    {name:'Stars', art:[tile(starPts(3, 0, 3, 1.2, 5), '#000000', [0, 7])]},
    {name:'Laurel', art:[tile(rot(ell(3, -1.6, 2.6, 1, 16), -0.5, 3, -1.6), '#3f7d3a'), tile(rot(ell(3, 1.6, 2.6, 1, 16), 0.5, 3, 1.6), '#3f7d3a'), tile(rect(0, -0.3, 6, 0.3), '#2d5a29', [0, 6])], colorization:'none'},
    {name:'Greek Key', art:[tile([[0, 3], [0, -3], [6, -3], [6, 1], [2, 1], [2, -1], [4, -1], [4, -2], [1, -2], [1, 2], [7, 2], [7, 3]], '#000000', [0, 7])]}]
    .map(b => Object.assign({type:'pattern', fit:'stretch', colorization:'tints'}, b))],
  ['bristle', L3('毛刷筆刷資料庫', '毛刷画笔库', 'Bristle Brush Library'), () => [
    ['Mop', 'round', 10, 70, 60, 60], ['Fan', 'flatFan', 12, 40, 30, 50], ['Round Point', 'round', 3, 40, 40, 75], ['Round Blunt', 'round', 5, 60, 50, 80], ['Round Curve', 'round', 6, 50, 55, 70],
    ['Flat Point', 'flatFan', 4, 45, 35, 75], ['Flat Blunt', 'flatFan', 6, 65, 45, 80], ['Flat Curve', 'flatFan', 7, 55, 40, 70], ['Cat Tongue', 'round', 8, 60, 50, 65], ['Angle', 'flatFan', 5, 50, 35, 70]]
    .map(([name, shape, size, density, thickness, opacity]) => ({name, type:'bristle', shape, size, density, thickness, opacity}))],
  ['decorative-scatter', L3('裝飾_散佈', '装饰_散布', 'Decorative_Scatter'), () => [
    {name:'Stars', art:[art(starPts(0, 0, 3, 1.2, 5))], size:[60, 140], spacing:[90, 160], scatter:[-80, 80], rotation:[-30, 30], colorization:'tints'},
    {name:'Hearts', art:[art(heart(0, 0, 2.6), '#e5383b')], size:[60, 130], spacing:[100, 160], scatter:[-60, 60], rotation:[-20, 20], colorization:'none'},
    {name:'Dots - Random', art:[art(ell(0, 0, 1.4, 1.4, 16))], size:[40, 180], spacing:[60, 160], scatter:[-150, 150], rotation:[0, 0], colorization:'tints'},
    {name:'Confetti', art:[art(rect(-1.6, -0.8, 1.6, 0.8), '#f72585'), art(rect(1.2, 1.2, 2.4, 2.4), '#4cc9f0'), art(ell(-2, 2, 0.8, 0.8, 10), '#ffd60a')], size:[60, 140], spacing:[90, 180], scatter:[-140, 140], rotation:[-180, 180], colorization:'none'},
    {name:'Snowflakes', art:[0, 1, 2].map(i => art(rot(rect(-3, -0.3, 3, 0.3), i * Math.PI / 3, 0, 0))), size:[60, 130], spacing:[100, 180], scatter:[-100, 100], rotation:[-30, 30], colorization:'tints'},
    {name:'Bubbles', art:[art([ell(0, 0, 2.6, 2.6, 24), ell(0, 0, 2.1, 2.1, 24).reverse()]), art(ell(-0.9, -0.9, 0.5, 0.5, 10))], size:[50, 160], spacing:[80, 160], scatter:[-120, 120], rotation:[0, 0], colorization:'tints'},
    {name:'Flowers', art:[...[0, 1, 2, 3, 4].map(i => art(rot(ell(0, -1.8, 1, 1.6, 16), i * Math.PI * 2 / 5, 0, 0), '#f4a6c0')), art(ell(0, 0, 0.9, 0.9, 12), '#ffd60a')], size:[70, 130], spacing:[110, 170], scatter:[-70, 70], rotation:[-180, 180], colorization:'none'},
    {name:'Sparkles', art:[art(starPts(0, 0, 3, 0.6, 4))], size:[40, 150], spacing:[80, 170], scatter:[-120, 120], rotation:[-15, 15], colorization:'tints'}]
    .map(b => Object.assign({type:'scatter'}, b))],
  ['decorative-text-dividers', L3('裝飾_文字分隔線', '装饰_文本分隔线', 'Decorative_Text Dividers'), () => [
    {name:'Divider 1', art:[art(band(100, 0.6, 1, {exp:0.15})), art([[44, 0], [50, -3], [56, 0], [50, 3]])]},
    {name:'Divider 2', art:[art(rect(4, -0.4, 96, 0.4)), art(ell(2, 0, 2, 2, 16)), art(ell(98, 0, 2, 2, 16))], guides:[0.05, 0.95]},
    {name:'Divider 3', art:[art(band(46, 0.8, 1, {exp:1}).map(([x, y]) => [x, y])), art(band(46, 0.8, 1, {exp:1}).map(([x, y]) => [x + 54, y])), art([ell(50, 0, 2.6, 2.6, 20), ell(50, 0, 1.4, 1.4, 20).reverse()])]},
    {name:'Divider 4', art:[art(rect(0, -1.6, 100, -0.9)), art(rect(0, 0.9, 100, 1.6))]},
    {name:'Divider 5', art:[art(rect(8, -0.45, 92, 0.45)), art([ell(4, 0, 4, 4, 24), ell(4, 0, 3, 3, 24).reverse()]), art([ell(96, 0, 4, 4, 24), ell(96, 0, 3, 3, 24).reverse()]), art(starPts(50, 0, 3, 1.3, 4))], guides:[0.09, 0.91]},
    {name:'Divider 6', art:Array.from({length:11}, (_, i) => art(ell(i * 10, 0, 1 + (i === 5 ? 1 : 0), 1 + (i === 5 ? 1 : 0), 14)))}]
    .map(b => Object.assign({type:'art', colorization:'tints'}, b))]];

/* ═════════════ 图形样式库（vectorcraft doc/src/style_libs.rs:214-446 逐款翻） ═════════════ */
const FX = (id, params) => ({id, params, visible:true});
const LG = (angle, stops) => ({_fit:{t:'l', a:angle}, stops});
const RG = (x, y, r, stops) => ({_fit:{t:'r', at:[x, y, r]}, stops});
const AF = (paint, extra) => Object.assign({kind:'fill', paint}, extra || {}), AS = (paint, width, extra) => Object.assign({kind:'stroke', paint, width}, extra || {});
const PF = extra => Object.assign({kind:'fill', primary:true}, extra || {}), PS = extra => Object.assign({kind:'stroke', primary:true}, extra || {});
/* 渐变贴合外框（GradientPaint 拟合 unit box：线性＝过中心、角度 a（90＝朝上）、长度＝外框在该方向的投影；径向＝单位框里的圆心与半径） */
function fitGrad(g, b){
  const st = g.stops.map(s => ({offset:s[0], color:s[1], opacity:s[2] === undefined ? 1 : s[2]})), w = Math.max(1e-6, b.x1 - b.x0), h = Math.max(1e-6, b.y1 - b.y0);
  if (g._fit.t === 'l'){ const a = g._fit.a * Math.PI / 180, d = [Math.cos(a), -Math.sin(a)], c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], half = (Math.abs(d[0]) * w + Math.abs(d[1]) * h) / 2;
    return {type:'linear', stops:st, x1:c[0] - d[0] * half, y1:c[1] - d[1] * half, x2:c[0] + d[0] * half, y2:c[1] + d[1] * half, _fit:g._fit}; }
  const [x, y, r] = g._fit.at, sx = b.x0 + x * w, sy = b.y0 + y * h, o = {type:'radial', stops:st, x1:sx, y1:sy, x2:sx + r * w, y2:sy, r:r * w, _fit:g._fit};
  if (Math.abs(h / w - 1) > 1e-9) o.aspect = h / w; return o;
}
const reFit = (g, b) => fitGrad({_fit:g._fit, stops:(g.stops || []).map(s => [s.offset, s.color, s.opacity])}, b);
const THUMB = {x0:6, y0:6, x1:34, y1:34};
/* look 里的 _fit 规格 → 实际渐变（先贴合缩图方块 6,6,28×28；套到物件时再按物件外框重算） */
function bakeLook(look){
  const fix = v => v && typeof v === 'object' && v._fit && Array.isArray(v.stops) && Array.isArray(v.stops[0]) ? fitGrad(v, THUMB) : v;
  look.fill = fix(look.fill); look.stroke = fix(look.stroke); if (Array.isArray(look.apStack)) look.apStack.forEach(it => { if (it.paint) it.paint = fix(it.paint); });
  return look;
}
const SH = (opacity, x, y, blur, color) => FX('stylize.dropShadow', {mode:'multiply', opacity, x, y, blur, color});
const RND = {cap:'round', join:'round'};
const basic = (f, s, w) => Object.assign({fill:f, stroke:s, strokeWidth:w}, RND);
const STYLE_LIBS = [
  ['shadows-glows', L3('陰影與光暈', '阴影和发光', 'Shadows and Glows'), () => [
    ['Soft Shadow', {fill:'#f4f1ea', stroke:'none', strokeWidth:0, effects:[SH(45, 4, 4, 6, '#1d1b2a')]}],
    ['Hard Shadow', {fill:'#ffd166', stroke:'#1d1b2a', strokeWidth:2, effects:[FX('stylize.dropShadow', {mode:'normal', opacity:100, x:5, y:5, blur:0, color:'#1d1b2a'})]}],
    ['Lifted Card', {fill:'#ffffff', stroke:'#d9d9e3', strokeWidth:0.5, effects:[SH(30, 0, 8, 12, '#2b2d42')]}],
    ['Halo', {fill:'#2b2d42', stroke:'none', strokeWidth:0, effects:[FX('stylize.outerGlow', {mode:'normal', opacity:90, blur:8, color:'#8ecae6'})]}],
    ['Neon Tube', Object.assign({fill:'none', stroke:'#ff4fd8', strokeWidth:4, apStack:[PF(), PS(), AS('#ffe8fb', 1.5)], effects:[FX('stylize.outerGlow', {mode:'normal', opacity:85, blur:7, color:'#ff4fd8'})]}, RND)],
    ['Inner Light', {fill:'#3a86ff', stroke:'none', strokeWidth:0, effects:[FX('stylize.innerGlow', {mode:'screen', opacity:70, blur:9, color:'#ffffff', source:'center'})]}],
    ['Ember', {fill:'#e85d04', stroke:'none', strokeWidth:0, effects:[FX('stylize.innerGlow', {mode:'screen', opacity:80, blur:6, color:'#ffba08', source:'edge'}), FX('stylize.outerGlow', {mode:'normal', opacity:70, blur:5, color:'#dc2f02'})]}],
    ['Feathered', {fill:'#8338ec', stroke:'none', strokeWidth:0, effects:[FX('stylize.feather', {radius:6})]}],
    ['Haze', {fill:'#06d6a0', stroke:'none', strokeWidth:0, apStack:[PF({opacity:0.8}), PS()], effects:[FX('blur.gaussian', {radius:3})]}]]],
  ['outlines-rules', L3('外框與線條', '轮廓和线条', 'Outlines and Rules'), () => [
    ['Double Rule', {fill:'#ffffff', stroke:'#14213d', strokeWidth:6, apStack:[PF(), PS(), AS('#ffffff', 3)]}],
    ['Triple Rule', {fill:'#fefae0', stroke:'#283618', strokeWidth:10, apStack:[PF(), PS(), AS('#fefae0', 6), AS('#283618', 2)]}],
    ['Dashed Border', Object.assign({fill:'#e9f5f2', stroke:'#264653', strokeWidth:2, dash:[6, 4]}, RND)],
    ['Dotted Border', Object.assign({fill:'#fff4e6', stroke:'#e76f51', strokeWidth:3, dash:[0, 6]}, RND)],
    // 原码：描边带「偏移路径 +4」；我们单层没效果 ⇒ 对齐外侧：深色 5.5 底、白 4 盖（白缝＝偏移的间隔）
    ['Offset Keyline', {fill:'#e9c46a', stroke:'#264653', strokeWidth:5.5, strokeAlign:'outside', apStack:[PS(), AS('#ffffff', 4), PF()]}],
    // 原码：描边带「偏移路径 −4」⇒ 对齐内侧：白 5.5、上面盖底色 4
    ['Inset Keyline', {fill:'#2a9d8f', stroke:'#ffffff', strokeWidth:5.5, strokeAlign:'inside', apStack:[PF(), PS(), AS('#2a9d8f', 4)]}],
    ['Outside Stroke', {fill:'#f4a261', stroke:'#264653', strokeWidth:4, strokeAlign:'outside'}],
    ['Tapered Ink', Object.assign({fill:'none', stroke:'#1b1b1b', strokeWidth:5, profile:[[0, 0, 0], [0.5, 1, 1], [1, 0, 0]]}, RND)],
    ['Pointer', Object.assign({fill:'none', stroke:'#e76f51', strokeWidth:2, endArrow:'Triangle'}, RND)],
    // 原码：描边层 opacity .6、正片叠底 ⇒ 挂到物件
    ['Highlighter', Object.assign({fill:'none', stroke:'#ffd60a', strokeWidth:10, opacity:0.6, blend:'multiply'}, RND)]]],
  ['hand-drawn', L3('手繪', '手绘', 'Hand-Drawn'), () => {
    const rough = s => FX('distort.roughen', {size:1.5, relative:true, detail:8, points:'smooth', seed:s}), scr = a => FX('stylize.scribble', {angle:a, strokeWidth:1.5, spacing:4, curviness:5, variation:0.5});
    return [
      ['Sketchy Line', Object.assign({fill:'#fefae0', stroke:'#1d3557', strokeWidth:1.25, apStack:[PF(), PS(), AS('#1d3557', 0.75)], effects:[rough(1)]}, RND)],   // 原码：两条描边各自粗糙化 ⇒ 挂物件
      ['Scribble Fill', {fill:'#e63946', stroke:'none', strokeWidth:0, effects:[scr(30)]}],   // 原码：涂抹在填色层＋粗糙描边 ⇒ 物件涂抹
      ['Crosshatch', {fill:'#457b9d', stroke:'none', strokeWidth:0, opacity:0.8, effects:[scr(45)]}],   // 原码：±45° 两层填色各自涂抹 ⇒ 物件一层 45°
      ['Wobble', Object.assign(basic('#a8dadc', '#1d3557', 2), {effects:[FX('distort.tweak', {h:3, v:3, relative:true, seed:5})]})],
      ['Zig Zag Edge', {fill:'#f1faee', stroke:'#e63946', strokeWidth:1.5, effects:[FX('distort.zigZag', {size:3, relative:false, ridges:6, points:'corner'})]}],
      ['Wavy Edge', Object.assign(basic('#bde0fe', '#3a5a9b', 1.5), {effects:[FX('distort.zigZag', {size:3, relative:false, ridges:5, points:'smooth'})]})],
      ['Puffy', Object.assign(basic('#ffc8dd', '#c9184a', 1.5), {effects:[FX('distort.puckerBloat', {amount:25})]})],
      ['Starburst', {fill:'#ffbe0b', stroke:'#fb5607', strokeWidth:1, effects:[FX('distort.puckerBloat', {amount:-40})]}]]; }],
  ['gradient-finishes', L3('漸層表面', '渐变表面', 'Gradient Finishes'), () => [
    ['Glossy', {fill:LG(-90, [[0, '#7ab8ff'], [1, '#1d4ed8']]), stroke:'#1e3a8a', strokeWidth:1, apStack:[PF(), AF(LG(-90, [[0, '#ffffff', 0.7], [0.5, '#ffffff', 0]])), PS()]}],
    ['Brushed Metal', {fill:LG(0, [[0, '#bfbfbf'], [0.3, '#f5f5f5'], [0.55, '#a6a6a6'], [0.8, '#e6e6e6'], [1, '#8c8c8c']]), stroke:'#595959', strokeWidth:1}],
    ['Spotlight', {fill:RG(0.35, 0.3, 0.9, [[0, '#ffffff'], [0.35, '#ffbe0b'], [1, '#fb5607']]), stroke:'none', strokeWidth:0}],
    ['Sunset Band', {fill:LG(-90, [[0, '#ffbe0b'], [0.35, '#fb5607'], [0.7, '#ff006e'], [1, '#8338ec']]), stroke:'none', strokeWidth:0}],
    ['Sea Glass', {fill:LG(-45, [[0, '#caf0f8'], [0.5, '#48cae4'], [1, '#0077b6']]), stroke:'#03045e', strokeWidth:1, apStack:[PF({opacity:0.85}), PS()]}],
    ['Pearl', {fill:RG(0.4, 0.35, 0.8, [[0, '#ffffff'], [0.5, '#e8e1f0'], [1, '#b8b0c8']]), stroke:'#8a7fa0', strokeWidth:0.75}],
    ['Chrome Rim', {fill:'#22223b', stroke:LG(-90, [[0, '#f8f9fa'], [0.5, '#6c757d'], [1, '#dee2e6']]), strokeWidth:4}],
    ['Glow Orb', {fill:RG(0.5, 0.5, 0.5, [[0, '#ffffff'], [0.4, '#80ffdb'], [1, '#5390d9']]), stroke:'none', strokeWidth:0, effects:[FX('stylize.outerGlow', {mode:'normal', opacity:60, blur:6, color:'#80ffdb'})]}]]],
  ['shape-effects', L3('形狀效果', '形状效果', 'Shape Effects'), () => [
    ['Rounded', Object.assign(basic('#90be6d', '#43aa8b', 2), {effects:[FX('stylize.roundCorners', {radius:10})]})],
    ['Pill Badge', {fill:'#f94144', stroke:'none', strokeWidth:0, effects:[FX('convertToShape.roundedRectangle', {relative:true, extraW:12, extraH:6, radius:40})]}],
    ['Round Badge', {fill:'#577590', stroke:'#ffffff', strokeWidth:2, effects:[FX('convertToShape.ellipse', {relative:true, extraW:10, extraH:10})]}],
    ['Arc', Object.assign(basic('#f8961e', '#f3722c', 1.5), {effects:[FX('warp.arc', {bend:30})]})],
    ['Flag Wave', Object.assign(basic('#277da1', '#1d4e89', 1.5), {effects:[FX('warp.flag', {bend:25})]})],
    ['Bulge', Object.assign(basic('#f9c74f', '#f8961e', 1.5), {effects:[FX('warp.bulge', {bend:30})]})],
    ['Twisted', Object.assign(basic('#4d908e', '#264653', 1.5), {effects:[FX('distort.twist', {angle:30})]})],
    ['Echo', {fill:'#43aa8b', stroke:'#264653', strokeWidth:1, apStack:[PF({opacity:0.55}), PS()], effects:[FX('distort.transform', {copies:3, moveH:4, moveV:4})]}],
    ['Spiral Copies', {fill:'#f94144', stroke:'#9d0208', strokeWidth:0.75, apStack:[PF({opacity:0.35}), PS()], effects:[FX('distort.transform', {copies:5, rotate:12, scaleH:90, scaleV:90})]}]]],
  ['blends-transparency', L3('混合與透明度', '混合和透明度', 'Blends and Transparency'), () => [
    ['Multiply Tint', {fill:'#ffbe0b', stroke:'none', strokeWidth:0, blend:'multiply'}],
    ['Darken Veil', {fill:'#4cc9f0', stroke:'none', strokeWidth:0, opacity:0.85, blend:'darken'}],
    ['Ghosted', {fill:'#7209b7', stroke:'#3a0ca3', strokeWidth:1, opacity:0.4}],
    ['Invert', {fill:'#ffffff', stroke:'none', strokeWidth:0, blend:'difference'}],
    // 原码：第二层填色 opacity .6 正片叠底；单层没混合模式 ⇒ 只留不透明度
    ['Two Tone', {fill:'#4361ee', stroke:'none', strokeWidth:0, apStack:[PF(), AF('#f72585', {opacity:0.6})]}],
    ['Overlay Glaze', {fill:'#f72585', stroke:'none', strokeWidth:0, apStack:[PF(), AF(LG(-90, [[0, '#ffffff'], [1, '#000000']]), {opacity:0.35})]}],          // 叠加 ⇒ 35%
    ['Screen Light', {fill:'#3a0ca3', stroke:'none', strokeWidth:0, apStack:[PF(), AF(RG(0.5, 0.4, 0.6, [[0, '#4cc9f0', 1], [1, '#4cc9f0', 0]]))]}],          // 滤色 ⇒ 亮色往外淡出
    ['Soft Light Wash', {fill:'#0096c7', stroke:'none', strokeWidth:0, apStack:[PF(), AF(LG(0, [[0, '#ffffff'], [1, '#03045e']]), {opacity:0.3})]}],          // 柔光 ⇒ 30%
    ['Knockout Group', {fill:'#4895ef', stroke:'#3f37c9', strokeWidth:1, opacity:0.7, knockout:true}]]]];

/* ═════════════ 符号库（AI 2020：窗口 ▸ 符号库 ▸ …；每个符号＝几个矢量形状，局部坐标约 0..64） ═════════════ */
let _sid = 0; const sid = () => 'LS' + (++_sid).toString(36);
const NP = {stroke:'none', strokeWidth:0};
const R_ = (x, y, w, h, fill, o) => Object.assign({id:sid(), type:'rect', x, y, w, h, radius:0, fill}, NP, o || {});
const E_ = (cx, cy, rx, ry, fill, o) => Object.assign({id:sid(), type:'ellipse', x:cx - rx, y:cy - ry, w:rx * 2, h:ry * 2, fill}, NP, o || {});
const G_ = (pts, fill, o) => Object.assign({id:sid(), type:'path', points:pts.map(p => [+p[0].toFixed(3), +p[1].toFixed(3)]), closed:true, fill}, NP, o || {});
const L_ = (pts, stroke, w, o) => Object.assign({id:sid(), type:'path', points:pts, closed:false, fill:'none', stroke, strokeWidth:w}, o || {});
const S_ = (cx, cy, r1, r2, n, fill, o) => Object.assign({id:sid(), type:'star', cx, cy, r1, r2, points:n, rotation:0, fill}, NP, o || {});
const C_ = (polys, fill, o) => Object.assign({id:sid(), type:'compound', rule:'evenodd', fill, children:polys.map(pts => ({id:sid(), type:'path', points:pts.map(p => [+p[0].toFixed(3), +p[1].toFixed(3)]), closed:true, fill:'none', stroke:'none', strokeWidth:0}))}, NP, o || {});
const arc = (cx, cy, r, a0, a1, n) => Array.from({length:(n || 24) + 1}, (_, i) => { const a = a0 + (a1 - a0) * i / (n || 24); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
/* 从角度 a 走到 b、经过 via 那一侧的圆弧 */
function arcVia(cx, cy, r, a, b, via, n){
  const TAU = Math.PI * 2, m = v => ((v % TAU) + TAU) % TAU; let d = m(b - a);
  if (m(via - a) > d) d -= TAU; return arc(cx, cy, r, a, a + d, n);
}
/* 月牙：大圆 (cx,cy,r) 减去小圆 (ox,oy,r2)；两圆交点之间，大圆走远离小圆那侧、小圆走大圆里面那侧 */
function crescent(cx, cy, r, ox, oy, r2){
  const dx = ox - cx, dy = oy - cy, d = Math.hypot(dx, dy), a = (r * r - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r * r - a * a));
  const mx = cx + dx * a / d, my = cy + dy * a / d, P1 = [mx - dy * h / d, my + dx * h / d], P2 = [mx + dy * h / d, my - dx * h / d], away = Math.atan2(-dy, -dx);
  const ang = (c, p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  return arcVia(cx, cy, r, ang([cx, cy], P1), ang([cx, cy], P2), away, 32).concat(arcVia(ox, oy, r2, ang([ox, oy], P2), ang([ox, oy], P1), away, 24).slice(1, -1));
}
const arrowR = (fill) => G_([[4, 26], [38, 26], [38, 14], [60, 32], [38, 50], [38, 38], [4, 38]], fill);
const mirX = pts => pts.map(([x, y]) => [64 - x, y]), swapXY = pts => pts.map(([x, y]) => [y, x]);
const SYMBOL_LIBS = [
  ['arrows', L3('箭頭', '箭头', 'Arrows'), () => {
    const a = arrowR('#1d3557').points;
    return [['Arrow Right', [G_(a, '#1d3557')]], ['Arrow Left', [G_(mirX(a), '#1d3557')]], ['Arrow Down', [G_(swapXY(a), '#1d3557')]], ['Arrow Up', [G_(swapXY(mirX(a)), '#1d3557')]],
      ['Double Arrow', [G_([[4, 32], [20, 16], [20, 26], [44, 26], [44, 16], [60, 32], [44, 48], [44, 38], [20, 38], [20, 48]], '#e63946')]],
      ['Circle Arrow', [E_(32, 32, 28, 28, '#457b9d'), G_([[16, 28], [34, 28], [34, 19], [48, 32], [34, 45], [34, 36], [16, 36]], '#ffffff')]],
      ['Chevron Right', [G_([[18, 8], [30, 8], [52, 32], [30, 56], [18, 56], [40, 32]], '#2a9d8f')]],
      ['Curved Arrow', [L_(arc(32, 40, 22, Math.PI, Math.PI * 1.85, 20), '#f4a261', 7, {cap:'butt'}), G_(rot([[44, 10], [62, 20], [46, 30]], 0.25, 52, 20), '#f4a261')]],
      ['Refresh', [C_([arc(32, 32, 26, -1.2, 4.4, 30).concat(arc(32, 32, 18, 4.4, -1.2, 30))], '#264653'), G_([[38, 2], [52, 10], [40, 20]], '#264653')]]]; }],
  ['web-icons', L3('網頁圖示', '网页图标', 'Web Icons'), () => {
    const c = '#2b2d42';
    return [['Home', [G_([[32, 6], [60, 30], [52, 30], [52, 58], [38, 58], [38, 42], [26, 42], [26, 58], [12, 58], [12, 30], [4, 30]], c)]],
      ['Search', [C_([ell(26, 26, 20, 20, 32), ell(26, 26, 13, 13, 32)], c), G_(rot(rect(40, 36, 64, 46), Math.PI / 4, 44, 44), c)]],
      ['Mail', [R_(4, 14, 56, 38, c, {radius:3}), L_([[8, 18], [32, 38], [56, 18]], '#ffffff', 3)]],
      ['User', [E_(32, 20, 12, 12, c), G_(arc(32, 60, 24, Math.PI, Math.PI * 2, 20), c)]],
      ['Heart', [G_(heart(32, 30, 26), '#e63946')]],
      ['Star', [S_(32, 33, 28, 12, 5, '#ffb703')]],
      ['Cart', [L_([[2, 10], [12, 10], [18, 42], [52, 42], [58, 18], [14, 18]], c, 4), E_(22, 52, 5, 5, c), E_(48, 52, 5, 5, c)]],
      ['Lock', [R_(10, 28, 44, 32, c, {radius:4}), L_(arc(32, 28, 13, Math.PI, Math.PI * 2, 16), c, 6), E_(32, 42, 4, 4, '#ffffff')]],
      ['Bell', [G_([[32, 6]].concat(arc(32, 26, 16, Math.PI * 1.5, Math.PI * 2, 8).slice(1), [[50, 46], [56, 50], [8, 50], [14, 46]], arc(32, 26, 16, Math.PI, Math.PI * 1.5, 8)), c), E_(32, 55, 5, 4, c)]],
      ['Gear', [C_([starPts(32, 32, 30, 24, 8, 0).map((p, i, A) => p), ell(32, 32, 10, 10, 24)], '#6c757d')]]]; }],
  ['nature', L3('自然', '自然', 'Nature'), () => [
    ['Sun', [S_(32, 32, 30, 20, 12, '#ffb703'), E_(32, 32, 16, 16, '#fb8500')]],
    ['Cloud', [E_(22, 38, 14, 12, '#a8dadc'), E_(36, 30, 16, 16, '#a8dadc'), E_(48, 40, 12, 10, '#a8dadc'), R_(14, 38, 40, 12, '#a8dadc')]],
    ['Raindrop', [G_([[32, 4]].concat(arc(32, 40, 18, -0.35, Math.PI + 0.35, 24)), '#4895ef')]],
    ['Leaf', [G_(rot(ell(32, 32, 28, 12, 32), -Math.PI / 4, 32, 32), '#52b788'), L_([[14, 50], [50, 14]], '#2d6a4f', 2)]],
    ['Tree', [R_(28, 44, 8, 16, '#7f5539'), G_([[32, 4], [52, 28], [42, 28], [56, 46], [8, 46], [22, 28], [12, 28]], '#2d6a4f')]],
    ['Flower', [...[0, 1, 2, 3, 4, 5].map(i => G_(rot(ell(32, 16, 8, 12, 20), i * Math.PI / 3, 32, 32), '#f28482')), E_(32, 32, 8, 8, '#ffd60a')]],
    ['Mountain', [G_([[2, 56], [24, 16], [36, 34], [44, 24], [62, 56]], '#6c757d'), G_([[24, 16], [31, 27], [27, 25], [24, 29], [20, 24]], '#ffffff')]],
    ['Moon', [G_(crescent(32, 32, 26, 44, 24, 21), '#ffd166')]],
    ['Snowflake', [0, 1, 2].map(i => L_(rot([[32, 4], [32, 60]], i * Math.PI / 3, 32, 32), '#90e0ef', 4)).concat([0, 1, 2, 3, 4, 5].map(i => L_(rot([[26, 12], [32, 18], [38, 12]], i * Math.PI / 3, 32, 32), '#90e0ef', 3)))]]],
  ['celebration', L3('慶祝', '庆祝', 'Celebration'), () => [
    ['Balloon', [E_(32, 24, 18, 22, '#e63946'), G_([[28, 46], [36, 46], [32, 50]], '#e63946'), L_([[32, 50], [28, 56], [34, 62]], '#6c757d', 1.5)]],
    ['Gift', [R_(8, 24, 48, 34, '#f72585'), R_(4, 16, 56, 10, '#b5179e'), R_(28, 16, 8, 42, '#ffd60a'), E_(24, 12, 8, 5, '#ffd60a'), E_(40, 12, 8, 5, '#ffd60a')]],
    ['Party Hat', [G_([[32, 4], [52, 58], [12, 58]], '#4361ee'), G_([[22, 34], [42, 34], [45, 42], [19, 42]], '#ffd60a'), E_(32, 4, 4, 4, '#f72585')]],
    ['Confetti Burst', [...Array.from({length:12}, (_, i) => G_(rot(rect(31, 4, 33, 14), i * Math.PI / 6, 32, 32), ['#f72585', '#4cc9f0', '#ffd60a'][i % 3])), E_(32, 32, 6, 6, '#7209b7')]],
    ['Seal', [S_(32, 32, 30, 26, 18, '#e9c46a'), E_(32, 32, 20, 20, '#f4a261')]],
    ['Ribbon Bow', [G_([[32, 32], [8, 18], [8, 46]], '#e63946'), G_([[32, 32], [56, 18], [56, 46]], '#e63946'), E_(32, 32, 6, 6, '#9d0208')]],
    ['Firework', [...Array.from({length:16}, (_, i) => L_(rot([[32, 14], [32, 4]], i * Math.PI / 8, 32, 32), ['#ffd60a', '#f72585'][i % 2], 2.5)), E_(32, 32, 4, 4, '#ffd60a')]]]],
  ['charts', L3('圖表', '图表', 'Charts'), () => {
    const wedge = (a0, a1, c) => G_([[32, 32]].concat(arc(32, 32, 28, a0, a1, 20)), c);
    return [['Bar Chart', [R_(6, 34, 10, 24, '#4361ee'), R_(20, 20, 10, 38, '#4cc9f0'), R_(34, 28, 10, 30, '#4361ee'), R_(48, 10, 10, 48, '#4cc9f0'), R_(2, 58, 60, 2, '#2b2d42')]],
      ['Line Chart', [L_([[4, 50], [18, 34], [30, 40], [44, 18], [60, 24]], '#e63946', 3), R_(2, 58, 60, 2, '#2b2d42'), R_(2, 4, 2, 56, '#2b2d42')]],
      ['Pie Chart', [wedge(-Math.PI / 2, 0.4, '#f94144'), wedge(0.4, 2.3, '#f9c74f'), wedge(2.3, Math.PI * 1.5, '#43aa8b')]],
      ['Donut Chart', [C_([arc(32, 32, 28, -Math.PI / 2, 1.2, 20).concat(arc(32, 32, 16, 1.2, -Math.PI / 2, 20))], '#4361ee'), C_([arc(32, 32, 28, 1.2, Math.PI * 1.5, 20).concat(arc(32, 32, 16, Math.PI * 1.5, 1.2, 20))], '#f72585')]],
      ['Area Chart', [G_([[4, 58], [4, 40], [18, 28], [32, 36], [46, 16], [60, 26], [60, 58]], '#90e0ef'), L_([[4, 40], [18, 28], [32, 36], [46, 16], [60, 26]], '#0077b6', 2)]],
      ['Stacked Column', [[8, '#264653', 30, 28], [26, '#264653', 18, 40], [44, '#264653', 24, 34]].flatMap(([x, c, h1, h2]) => [R_(x, 58 - h1, 12, h1, c), R_(x, 58 - h1 - h2 * 0.5, 12, h2 * 0.5, '#e9c46a')])]]; }],
  ['logo-elements', L3('標誌元素', '徽标元素', 'Logo Elements'), () => [
    ['Circle Badge', [C_([ell(32, 32, 30, 30, 40), ell(32, 32, 24, 24, 40)], '#1d3557'), E_(32, 32, 20, 20, '#e63946')]],
    ['Shield', [G_([[32, 2], [58, 10], [56, 34], [32, 62], [8, 34], [6, 10]], '#264653'), G_([[32, 8], [52, 14], [50, 33], [32, 54], [14, 33], [12, 14]], '#2a9d8f')]],
    ['Banner Ribbon', [G_([[0, 24], [12, 24], [12, 44], [0, 44], [5, 34]], '#9d0208'), G_([[64, 24], [52, 24], [52, 44], [64, 44], [59, 34]], '#9d0208'), R_(8, 20, 48, 20, '#e63946')]],
    ['Starburst Seal', [S_(32, 32, 30, 24, 24, '#ffb703'), C_([ell(32, 32, 20, 20, 36), ell(32, 32, 17, 17, 36)], '#fb8500')]],
    ['Hexagon Badge', [G_(ngon(32, 32, 30, 6), '#3a0ca3'), G_(ngon(32, 32, 22, 6), '#7209b7')]],
    ['Diamond Emblem', [G_([[32, 2], [62, 32], [32, 62], [2, 32]], '#2b2d42'), G_([[32, 12], [52, 32], [32, 52], [12, 32]], '#ffd166')]],
    ['Laurel', [...Array.from({length:7}, (_, i) => G_(rot(ell(16, 32, 4, 8, 16), -0.3, 16, 32).map(([x, y]) => [x, y]), '#2d6a4f')).map((s, i) => { s.points = rot(s.points, (i - 3) * 0.32, 32, 32); return s; }),
      ...Array.from({length:7}, (_, i) => G_(rot(ell(48, 32, 4, 8, 16), 0.3, 48, 32), '#2d6a4f')).map((s, i) => { s.points = rot(s.points, (3 - i) * 0.32, 32, 32); return s; })]]]],
  ['maps', L3('地圖', '地图', 'Maps'), () => [
    ['Map Pin', [C_([[[32, 62]].concat(arc(32, 24, 20, Math.PI * 0.8, Math.PI * 2.2, 30)), ell(32, 24, 8, 8, 24)], '#e63946')]],
    ['Compass', [C_([ell(32, 32, 30, 30, 40), ell(32, 32, 26, 26, 40)], '#264653'), G_([[32, 8], [38, 32], [32, 56], [26, 32]], '#e63946'), G_([[8, 32], [32, 26], [56, 32], [32, 38]], '#6c757d')]],
    ['Airport', [G_([[32, 2], [36, 8], [36, 24], [62, 38], [62, 44], [36, 36], [36, 52], [44, 58], [44, 62], [32, 58], [20, 62], [20, 58], [28, 52], [28, 36], [2, 44], [2, 38], [28, 24], [28, 8]], '#1d3557')]],
    ['Hospital', [R_(4, 4, 56, 56, '#e63946', {radius:6}), G_([[26, 12], [38, 12], [38, 26], [52, 26], [52, 38], [38, 38], [38, 52], [26, 52], [26, 38], [12, 38], [12, 26], [26, 26]], '#ffffff')]],
    ['Information', [E_(32, 32, 30, 30, '#0077b6'), E_(32, 18, 5, 5, '#ffffff'), R_(27, 27, 10, 24, '#ffffff', {radius:2})]],
    ['Flag Marker', [R_(10, 4, 4, 58, '#2b2d42'), G_([[14, 6], [56, 6], [46, 18], [56, 30], [14, 30]], '#2a9d8f')]],
    ['Road Sign', [G_([[32, 2], [62, 32], [32, 62], [2, 32]], '#ffb703'), C_([[[32, 6], [58, 32], [32, 58], [6, 32]], [[32, 9], [55, 32], [32, 55], [9, 32]]], '#2b2d42'), R_(29, 18, 6, 18, '#2b2d42'), E_(32, 44, 3.5, 3.5, '#2b2d42')]]]],
  ['web-buttons', L3('網頁按鈕和列', 'Web 按钮和条形', 'Web Buttons and Bars'), () => [
    ['Pill Button', [R_(2, 20, 60, 24, '#4361ee', {radius:12}), R_(6, 22, 52, 9, '#ffffff', {radius:5, opacity:0.3})]],
    ['Round Button', [E_(32, 32, 26, 26, '#2a9d8f'), E_(32, 26, 18, 12, '#ffffff', {opacity:0.25})]],
    ['Square Button', [R_(8, 8, 48, 48, '#f72585', {radius:8}), R_(8, 46, 48, 10, '#b5179e', {radius:0})]],
    ['Tab Bar', [R_(2, 22, 60, 20, '#e9ecef'), R_(2, 22, 20, 20, '#4361ee'), R_(23, 22, 1, 20, '#adb5bd'), R_(43, 22, 1, 20, '#adb5bd')]],
    ['Progress Bar', [R_(2, 26, 60, 12, '#dee2e6', {radius:6}), R_(2, 26, 38, 12, '#06d6a0', {radius:6})]],
    ['Toggle Switch', [R_(6, 18, 52, 28, '#06d6a0', {radius:14}), E_(44, 32, 11, 11, '#ffffff')]],
    ['Slider', [R_(4, 30, 56, 4, '#adb5bd', {radius:2}), R_(4, 30, 24, 4, '#4361ee', {radius:2}), E_(28, 32, 8, 8, '#ffffff', {stroke:'#4361ee', strokeWidth:2})]]]]];

/* ═════════════ 资料：每种库的内建、用户定义（localStorage）、其它库（这回开过的档） ═════════════ */
const KINDS = {
  brush:{panel:'aiLibBrush', fmt:'dilin-brushes', title:L3('筆刷資料庫', '画笔库', 'Brush Library'), only:'vector', builtin:BRUSH_LIBS, docPanel:'aiBrushes'},
  graphicStyle:{panel:'aiLibStyle', fmt:'dilin-graphic-styles', title:L3('繪圖樣式資料庫', '图形样式库', 'Graphic Style Library'), only:'vector', builtin:STYLE_LIBS, docPanel:'aiGraphicStyles'},
  symbol:{panel:'aiLibSymbol', fmt:'dilin-symbols', title:L3('符號資料庫', '符号库', 'Symbol Library'), only:'vector', builtin:SYMBOL_LIBS, docPanel:'aiSymbols'},
  swatch:{panel:'aiLibSwatch', fmt:'dilin-swatches', title:L3('色票資料庫', '色板库', 'Swatch Library'), only:null, builtin:[], docPanel:'aiSwatches'}};
const LSKEY = k => `dlAiLib.${k}.v1`;
const userLibs = k => { try { const v = JSON.parse(localStorage.getItem(LSKEY(k)) || '[]'); return Array.isArray(v) ? v.filter(x => x && x.name && Array.isArray(x.items)) : []; } catch(e){ return []; } };
const saveUserLibs = (k, list) => { try { localStorage.setItem(LSKEY(k), JSON.stringify(list)); return true; } catch(e){ return false; } };
const fileLibs = {brush:[], graphicStyle:[], symbol:[], swatch:[]};
const _cache = {};
/* 内建库 → {id, name(三语), items}；items：画笔＝画笔定义、样式＝{name, look}、符号＝{name, shapes}、色板＝[名, 值] */
function builtinLib(k, id){
  const d = KINDS[k].builtin.find(x => x[0] === id); if (!d) return null;
  const key = k + ':' + id; if (_cache[key]) return _cache[key];
  let items = d[2]();
  if (k === 'graphicStyle') items = items.map(([name, look]) => ({name, look:bakeLook(look)}));
  if (k === 'symbol') items = items.map(([name, shapes]) => ({name, shapes}));
  return (_cache[key] = {id, name:d[1], items, builtin:true});
}
/* 库 id：内建 id｜"user:<名>"｜"file:<名>" */
function getLib(k, id){
  if (!KINDS[k] || !id) return null;
  if (id.startsWith('user:')){ const u = userLibs(k).find(x => x.name === id.slice(5)); return u ? {id, name:u.name, items:u.items, groups:u.groups || [], user:true} : null; }
  if (id.startsWith('file:')){ const f = fileLibs[k].find(x => x.name === id.slice(5)); return f ? {id, name:f.name, items:f.items, groups:f.groups || [], file:true} : null; }
  return builtinLib(k, id);
}
const libIds = k => KINDS[k].builtin.map(x => x[0]).concat(userLibs(k).map(u => 'user:' + u.name), fileLibs[k].map(f => 'file:' + f.name));
const itemName = (k, it) => k === 'swatch' ? it[0] : it.name;
const libItems = (k, L) => k === 'swatch' ? L.items.concat((L.groups || []).flatMap(g => g[1])) : L.items;

/* ═════════════ 文件那一边（画笔面板／图形样式／符号／色板） ═════════════ */
const docBrushes = () => { sub('ai.brush.list')(); return AiWindow.brushes.list; };
const docStyles = () => { sub('ai.graphicStyle.list')(); return Doc.aiGraphicStyles; };
const docSymbols = () => { sub('ai.symbol.list')(); return Doc.aiSymbols; };
const docSwatches = () => { sub('ai.swatch.list')(); return AiWindow.swatches; };
function docItems(k){
  if (k === 'brush') return clone(docBrushes());
  if (k === 'graphicStyle') return clone(docStyles());
  if (k === 'symbol') return clone(docSymbols()).map(s => ({name:s.name, shapes:s.shapes, x:s.x, y:s.y}));
  const S = docSwatches(); return clone(S.list.filter(s => s[1] !== 'none'));
}
const selCount = () => { const t = AiWindow.sel ? AiWindow.sel() : {R:[]}; return t.R.length; };
/* 加进文件：回 {added:是不是新加的, name} */
function addOne(k, it){
  if (k === 'brush'){ const L = docBrushes(); if (L.some(b => b.name === it.name)) return {added:false, name:it.name}; L.push(clone(it)); return {added:true, name:it.name}; }
  if (k === 'graphicStyle'){ const G = docStyles(); if (G.some(g => g.name === it.name)) return {added:false, name:it.name}; G.push({name:it.name, look:clone(it.look)}); return {added:true, name:it.name}; }
  if (k === 'symbol'){ const S = docSymbols(); if (S.some(s => s.name === it.name)) return {added:false, name:it.name}; S.push({name:it.name, shapes:clone(it.shapes), x:it.x || 0, y:it.y || 0}); return {added:true, name:it.name}; }
  const S = docSwatches(), all = S.list.concat(S.groups.flatMap(g => g[1])); if (all.some(s => s[0] === it[0])) return {added:false, name:it[0]}; S.list.push(clone(it)); return {added:true, name:it[0]};
}
/* 符号置入到画面中央（AI：从符号面板拖出／置入符号实例＝放在视图中央） */
function placeCentered(name){
  const r = sub('ai.symbol.place')({name}); if (!r || r.ok === false) return r;
  const L = Doc.active(), n = L.data.shapes.find(s => s.id === r.ids[0]);
  try { const b = AIObj.shapeBounds(n, p => [p[0] + L.x, p[1] + L.y], false); if (b) window.shiftShape(n, Doc.width / 2 - (b.x0 + b.x1) / 2, Doc.height / 2 - (b.y0 + b.y1) / 2); } catch(e){}
  Layer.invalidate(L); return r;
}
const refreshDoc = k => { try { P.refresh(KINDS[k].docPanel); } catch(e){} };

/* ═════════════ 图形样式：套用后渐变按物件外框重算（包 ai.graphicStyle.apply） ═════════════ */
const leaves = s => s.type === 'group' && Array.isArray(s.children) ? s.children.flatMap(leaves) : [s];
function refitShape(s){
  const isF = v => v && typeof v === 'object' && v._fit && Array.isArray(v.stops);
  if (!isF(s.fill) && !isF(s.stroke) && !(Array.isArray(s.apStack) && s.apStack.some(it => isF(it.paint)))) return false;
  let b = null; try { b = AIObj.shapeBounds(Object.assign({}, s, {effects:undefined}), p => p, false); } catch(e){}
  if (!b) return false;
  if (isF(s.fill)) s.fill = reFit(s.fill, b); if (isF(s.stroke)) s.stroke = reFit(s.stroke, b);
  if (Array.isArray(s.apStack)) s.apStack.forEach(it => { if (isF(it.paint)) it.paint = reFit(it.paint, b); });
  return true;
}
(function wrapApply(){
  const c = CMD.map['ai.graphicStyle.apply']; if (!c || c.__libFit) return;
  const run0 = c.run; c.__libFit = true;
  c.run = function(p){
    const r = run0.apply(this, arguments);
    if (r && r.ok !== false){ const t = AiWindow.sel(p || {}); let hit = false; t.R.flatMap(leaves).forEach(s => { if (s.graphicStyle === (p || {}).name && refitShape(s)) hit = true; }); if (hit) Layer.invalidate(t.L); }
    return r;
  };
})();
/* 旧的「窗口 ▸ 图形样式库」命令只认阴影和发光：别的库 id 交给本档 */
(function wrapOldStyleLib(){
  const c = CMD.map['ai.window.graphicStyleLibrary']; if (!c || c.__lib) return;
  const run0 = c.run; c.__lib = true;
  c.run = function(p){ const id = p && p.library; if (id && id !== 'shadows-glows' && getLib('graphicStyle', id)) return CMD.map['ai.window.graphicStyleLibrary.open'].run(p); return run0.apply(this, arguments); };
  c.params = String(c.params || '').replace('{library:"shadows-glows"|null}', `{library:"${STYLE_LIBS.map(x => x[0]).join('|')}"|null}`);
})();

/* ═════════════ Adobe .ase 色板（ASEF 1.0：区块 0xC001 组开始、0xC002 组结束、0x0001 颜色；名称 UTF-16BE；RGB／CMYK／LAB／Gray 浮点大端） ═════════════ */
function labToHex(L, a, b){
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200, f = t => t > 0.206893 ? t * t * t : (t - 16 / 116) / 7.787;
  let X = 0.96422 * f(fx), Y = f(fy), Z = 0.82521 * f(fz);   // D50
  const x = 0.9555766 * X - 0.0230393 * Y + 0.0631636 * Z, y = -0.0282895 * X + 1.0099416 * Y + 0.0210077 * Z, z = 0.0122982 * X - 0.0204830 * Y + 1.3299098 * Z;   // Bradford → D65
  const lin = [3.2404542 * x - 1.5371385 * y - 0.4985314 * z, -0.9692660 * x + 1.8760108 * y + 0.0415560 * z, 0.0556434 * x - 0.2040259 * y + 1.0572252 * z];
  return rgbHex(...lin.map(v => 255 * clamp(v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055, 0, 1)));
}
function parseASE(buf){
  const dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer);
  if (dv.byteLength < 12 || String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'ASEF') throw new Error('not an .ase file (no ASEF header)');
  const n = dv.getUint32(8); let o = 12; const swatches = [], groups = []; let grp = null;
  const str = () => { const len = dv.getUint16(o); o += 2; let s = ''; for (let i = 0; i < len; i++){ const c = dv.getUint16(o); o += 2; if (c) s += String.fromCharCode(c); } return s; };
  for (let i = 0; i < n && o + 6 <= dv.byteLength; i++){
    const type = dv.getUint16(o), len = dv.getUint32(o + 2); o += 6; const end = o + len;
    if (type === 0xC001){ grp = [str() || 'Group', []]; groups.push(grp); }
    else if (type === 0xC002) grp = null;
    else if (type === 0x0001){
      const name = str(), model = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)).trim().toUpperCase(); o += 4;
      const f = k => dv.getFloat32(o + 4 * k); let hex;
      if (model === 'RGB') hex = rgbHex(f(0) * 255, f(1) * 255, f(2) * 255);
      else if (model === 'CMYK') hex = rgbHex(255 * (1 - f(0)) * (1 - f(3)), 255 * (1 - f(1)) * (1 - f(3)), 255 * (1 - f(2)) * (1 - f(3)));
      else if (model === 'LAB') hex = labToHex(f(0) * 100, f(1), f(2));
      else if (model === 'GRAY') hex = rgbHex(f(0) * 255, f(0) * 255, f(0) * 255);
      if (hex) (grp ? grp[1] : swatches).push([name || hex.toUpperCase(), hex]);
    }
    o = end;
  }
  if (!swatches.length && !groups.some(g => g[1].length)) throw new Error('the .ase file has no colours');
  return {swatches, groups:groups.filter(g => g[1].length)};
}
const b64ToBuf = s => { const bin = atob(String(s).replace(/^data:[^,]*,/, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
const bufToB64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
/* 读一份库档（文字或 .ase 二进位）→ {name, items, groups?} */
function parseLibrary(k, name, text, buf){
  if (k === 'swatch' && buf){ const a = parseASE(buf); return {name, items:a.swatches, groups:a.groups}; }
  let j = null; try { j = JSON.parse(String(text).replace(/^﻿/, '')); } catch(e){}
  if (j && typeof j === 'object'){
    if (j.format && j.format !== KINDS[k].fmt && !(k === 'swatch' && j.format === 'dilin-swatches')) throw new Error(`not a ${KINDS[k].fmt} file (format \`${j.format}\`)`);
    const nm = String(j.name || '').trim() || name;
    if (k === 'swatch'){ const raw = Array.isArray(j.items) ? j.items : Array.isArray(j.swatches) ? j.swatches : null; if (!raw) throw new Error('no swatches');
      return {name:nm, items:raw.map(s => Array.isArray(s) ? s : [s.name, s.paint || s.color]).filter(s => s[0] && s[1]), groups:Array.isArray(j.groups) ? j.groups : []}; }
    if (!Array.isArray(j.items)) throw new Error('no items');
    const items = j.items.filter(it => it && it.name && (k !== 'brush' || it.type) && (k !== 'graphicStyle' || it.look) && (k !== 'symbol' || Array.isArray(it.shapes)));
    if (!items.length) throw new Error('the library is empty'); return {name:nm, items};
  }
  if (k === 'swatch'){ const sw = []; String(text).split(/\r?\n/).forEach(l => { const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/.exec(l); if (m) sw.push([m[4].trim() || rgbHex(+m[1], +m[2], +m[3]), rgbHex(+m[1], +m[2], +m[3])]); }); if (sw.length) return {name, items:sw, groups:[]}; }
  throw new Error(`not a ${KINDS[k].fmt} library`);
}
const libFileText = (k, name, items, groups) => JSON.stringify(Object.assign({format:KINDS[k].fmt, version:1, name, items}, groups && groups.length ? {groups} : {}), null, 1);

/* ═════════════ 命令 ═════════════ */
const reg = (id, params, fn, undoable) => CMD.reg(id, {i18n:'', params, undoable:!!undoable}, fn);
const KIND_ARG = '"brush"|"graphicStyle"|"symbol"|"swatch"';
const kindOf = p => { const k = p && p.kind; return KINDS[k] ? k : null; };
function openPanel(k, id){
  const L = getLib(k, id); if (!L) return err(`library.open`, `unknown ${k} library \`${id}\``);
  AL.state[k].open = L.id; const pid = KINDS[k].panel;
  if (P.isOpen(pid)) P.refresh(pid, 'lib'); else if (!P.open(pid)){ const f = P.lastRefusal; return err(`window.${k}Library`, `the ${k} library panel is ${(f && f.only) || KINDS[k].only} only; the active layer is ${P.kindOf()}`); }
  return {ok:true, open:true, library:L.id, name:T(L.name), count:libItems(k, L).length};
}
const closePanel = k => { P.close(KINDS[k].panel); return {ok:true, open:false}; };
reg('ai.library.open', `{kind:${KIND_ARG}, library: id（见 ai.library.list）| null（关）} 开某种库面板到这个库（库面板上方下拉、◀ ▶ 走这条）→ {ok, open, library, name, count}`, p => {
  const k = kindOf(p); if (!k) return err('ai.library.open', 'bad kind'); return p.library === null ? closePanel(k) : openPanel(k, p.library);
});
reg('ai.library.list', `{kind:${KIND_ARG}, library?:id} 列资料库：不给 library＝这种的全部库（内建、user:<名>、file:<名>）；给＝那个库的项目 → {ok, libraries:[{id, name, count, user?, file?}]} 或 {ok, library, items:[名…]}`, p => {
  const k = kindOf(p); if (!k) return err('ai.library.list', 'kind must be brush|graphicStyle|symbol|swatch');
  if (p.library){ const L = getLib(k, p.library); if (!L) return err('ai.library.list', 'unknown library'); return {ok:true, library:L.id, name:T(L.name), items:libItems(k, L).map(it => itemName(k, it))}; }
  return {ok:true, libraries:libIds(k).map(id => { const L = getLib(k, id); return {id, name:T(L.name), count:libItems(k, L).length, user:!!L.user, file:!!L.file}; })};
});
reg('ai.library.add', `{kind:${KIND_ARG}, library, names?:[项目名…]（缺省＝整个库）, apply?:bool（画笔／图形样式／色板：顺便套到选取；缺省＝只点一个且有选取时套）, place?:bool（符号：置入一个实例到画面中央）} 库面板点项目：加进文件的画笔／图形样式／符号／色板面板 → {ok, added, names}`, p => {
  const k = kindOf(p); if (!k) return err('ai.library.add', 'kind must be brush|graphicStyle|symbol|swatch');
  const L = getLib(k, p.library); if (!L) return err('ai.library.add', `unknown library \`${p.library}\``);
  const all = libItems(k, L), pick = Array.isArray(p.names) ? all.filter(it => p.names.includes(itemName(k, it))) : all;
  if (!pick.length) return err('ai.library.add', 'no such items');
  const res = pick.map(it => addOne(k, it)), names = res.map(r => r.name), first = names[0];
  const apply = p.apply === undefined ? (pick.length === 1 && (k === 'swatch' || selCount() > 0)) : !!p.apply;   // 色板：点一个＝没选也设成目前颜色（同色板面板）
  let out = {ok:true, added:res.filter(r => r.added).length, names};
  if (k === 'brush'){ if (apply && selCount()) Object.assign(out, {applied:sub('ai.brush.apply')({name:first}).ok !== false}); else if (pick.length === 1) sub('ai.brush.setCurrent')({name:first}); }
  if (k === 'graphicStyle' && apply && selCount()){ AiWindow.gsSel = [first]; const r = sub('ai.graphicStyle.apply')({name:first, add:!!p.add}); out.applied = r.ok !== false; }
  if (k === 'symbol'){ AiWindow.curSymbol = first; if (p.place){ const r = placeCentered(first); if (r && r.ok === false) return r; out.ids = r.ids; } }
  if (k === 'swatch' && apply){ const r = sub('ai.swatch.apply')({name:first}); out.applied = !!r && r.ok !== false; }
  refreshDoc(k); return out;
}, true);
reg('ai.library.saveUser', `{kind:${KIND_ARG}, name, names?:[项目名…]（缺省＝文件面板里全部）, file?:bool（顺便经 file.exportData 存成库档）} 存储成用户定义库（这台机器的 localStorage；同名覆盖）→ {ok, library, count}`, p => {
  const k = kindOf(p); if (!k) return err('ai.library.saveUser', 'kind must be brush|graphicStyle|symbol|swatch');
  const name = String(p.name || '').trim(); if (!name) return err('ai.library.saveUser', 'name is empty');
  let items = docItems(k); if (Array.isArray(p.names)) items = items.filter(it => p.names.includes(itemName(k, it)));
  const groups = k === 'swatch' && !Array.isArray(p.names) ? clone(docSwatches().groups) : [];
  if (!items.length && !groups.length) return err('ai.library.saveUser', 'nothing to save');
  const list = userLibs(k).filter(u => u.name !== name); list.push(Object.assign({name, items}, groups.length ? {groups} : {}));
  if (!saveUserLibs(k, list)) return err('ai.library.saveUser', 'localStorage is full or blocked');
  if (p.file) CMD.run('file.exportData', {name:`${name}.${KINDS[k].fmt.replace('dilin-', '')}.json`, data:libFileText(k, name, items, groups), mime:'application/json'});
  if (P.isOpen(KINDS[k].panel)) P.refresh(KINDS[k].panel, 'lib');
  return {ok:true, library:'user:' + name, count:items.length + groups.reduce((a, g) => a + g[1].length, 0)};
});
reg('ai.library.deleteUser', `{kind:${KIND_ARG}, name} 删除一个用户定义库 → {ok}`, p => {
  const k = kindOf(p); if (!k) return err('ai.library.deleteUser', 'bad kind'); const list = userLibs(k), i = list.findIndex(u => u.name === p.name);
  if (i < 0) return err('ai.library.deleteUser', 'no such user library'); list.splice(i, 1); saveUserLibs(k, list);
  if (AL.state[k].open === 'user:' + p.name) AL.state[k].open = null; if (P.isOpen(KINDS[k].panel)) P.refresh(KINDS[k].panel, 'lib'); return {ok:true};
});
reg('ai.library.export', `{kind:${KIND_ARG}, library?:id（缺省＝文件面板里的项目）, name?, names?} 把一个库（或文件的项目）存成库档（我们的 JSON；经 file.exportData）→ {ok, name, bytes}`, p => {
  const k = kindOf(p); if (!k) return err('ai.library.export', 'bad kind');
  let items, groups = [], name = String(p.name || '').trim();
  if (p.library){ const L = getLib(k, p.library); if (!L) return err('ai.library.export', 'unknown library'); items = clone(L.items); groups = clone(L.groups || []); name = name || T(L.name); }
  else { items = docItems(k); if (k === 'swatch') groups = clone(docSwatches().groups); name = name || 'Untitled'; }
  if (Array.isArray(p.names)){ items = items.filter(it => p.names.includes(itemName(k, it))); groups = []; }
  const txt = libFileText(k, name, items, groups), fn = `${name}.${KINDS[k].fmt.replace('dilin-', '')}.json`;
  const r = CMD.run('file.exportData', {name:fn, data:txt, mime:'application/json'}); return {ok:true, name:fn, bytes:(r && r.bytes) || txt.length};
});
reg('ai.library.importText', `{kind:${KIND_ARG}, text?: 库档内容, ase?: .ase 的 base64, name?, toUser?:bool（存进用户定义）} 读一份库档当「其它库」打开（不开档案挑选器；人点「其它库…」走档案挑选器再叫这条）→ {ok, library, name, count}`, p => {
  const k = kindOf(p); if (!k) return err('ai.library.importText', 'bad kind');
  let lib; try { lib = parseLibrary(k, String(p.name || 'Library'), p.text, p.ase ? b64ToBuf(p.ase) : null); } catch(e){ return err('ai.library.importText', e.message); }
  let id;
  if (p.toUser){ const list = userLibs(k).filter(u => u.name !== lib.name); list.push(lib); if (!saveUserLibs(k, list)) return err('ai.library.importText', 'localStorage is full'); id = 'user:' + lib.name; }
  else { const i = fileLibs[k].findIndex(f => f.name === lib.name); if (i >= 0) fileLibs[k].splice(i, 1); fileLibs[k].push(lib); id = 'file:' + lib.name; }
  const r = openPanel(k, id); if (r.ok === false) return Object.assign(r, {library:id});
  return {ok:true, library:id, name:lib.name, count:libItems(k, getLib(k, id)).length};
});
/* 档案挑选器（人点「其它库…」；agent 用 ai.library.importText） */
function pickFile(k, accept, toUser){
  const inp = el('input', {type:'file', accept, style:'display:none', dataset:{libPick:k}});
  inp.onchange = () => { const f = inp.files[0]; inp.remove(); if (!f) return; const nm = f.name.replace(/(\.[a-z]+)+$/i, '');
    if (/\.ase$/i.test(f.name)) f.arrayBuffer().then(b => CMD.run('ai.library.importText', {kind:k, ase:bufToB64(b), name:nm, toUser}));
    else f.text().then(t => CMD.run('ai.library.importText', {kind:k, text:t, name:nm, toUser})); };
  document.body.appendChild(inp); inp.click(); return {ok:true, dialog:'filePicker'};
}
const ACCEPT = {brush:'.json,application/json', graphicStyle:'.json,application/json', symbol:'.json,application/json', swatch:'.ase,.json,.gpl,.vcswatches,text/plain'};
const openCmd = (k, cmd, ids) => reg(cmd, `{library?: id（${ids}）| null（关）} 窗口 ▸ ${k === 'brush' ? '画笔库 ▸ 内置库' : '符号库 ▸ 内置库'}：开${k === 'brush' ? '画笔' : '符号'}库面板（面板上方下拉换库；缺省＝上次开的或第一个）→ {ok, open, library, name, count}`, p => {
  if (p.library === null) return closePanel(k);
  const id = p.library || (AL.state[k].open && getLib(k, AL.state[k].open) && !AL.state[k].open.startsWith('user:') ? AL.state[k].open : KINDS[k].builtin[0][0]);
  return openPanel(k, id);
});
const userCmd = (k, cmd, label) => reg(cmd, `{name?: 用户库名（缺省＝第一个）} 窗口 ▸ ${label} ▸ 用户定义：开用户定义库（存在这台机器）；还没有就开空面板，底下「存储」把文件里的项目存成一个 → {ok, open, library?, libraries:[名…]}`, p => {
  const U = userLibs(k); if (p.name && !U.some(u => u.name === p.name)) return err(cmd, `no user library \`${p.name}\``);
  const nm = p.name || (AL.state[k].open && AL.state[k].open.startsWith('user:') && U.some(u => 'user:' + u.name === AL.state[k].open) ? AL.state[k].open.slice(5) : U[0] && U[0].name);
  if (nm){ const r = openPanel(k, 'user:' + nm); return r.ok === false ? r : Object.assign(r, {libraries:U.map(u => u.name)}); }
  AL.state[k].open = 'user:'; const pid = KINDS[k].panel; if (P.isOpen(pid)) P.refresh(pid, 'lib'); else if (!P.open(pid)) return err(cmd, `the panel is ${KINDS[k].only} only`);
  return {ok:true, open:true, library:null, libraries:[]};
});
const otherCmd = (k, cmd, label) => reg(cmd, `{text?: 库档内容（${k === 'swatch' ? '我们的 JSON／.gpl' : '我们的 JSON {format:"' + KINDS[k].fmt + '", name, items}'}）${k === 'swatch' ? ', ase?: .ase 的 base64' : ''}, name?}（都不给＝开档案挑选器）窗口 ▸ ${label} ▸ 其它库…：开本机档当库打开 → {ok, library, name, count}`, p => {
  if (typeof p.text === 'string' || typeof p.ase === 'string') return CMD.map['ai.library.importText'].run({kind:k, text:p.text, ase:p.ase, name:p.name});
  return pickFile(k, ACCEPT[k]);
});
openCmd('brush', 'ai.window.brushLibrary', BRUSH_LIBS.map(x => x[0]).join('|'));
userCmd('brush', 'ai.window.brushLibrary.user', '画笔库');
otherCmd('brush', 'ai.window.brushLibrary.other', '画笔库');
openCmd('symbol', 'ai.window.symbolLibrary', SYMBOL_LIBS.map(x => x[0]).join('|'));
userCmd('symbol', 'ai.window.symbolLibrary.user', '符号库');
otherCmd('symbol', 'ai.window.symbolLibrary.other', '符号库');
reg('ai.window.graphicStyleLibrary.open', `{library: "${STYLE_LIBS.map(x => x[0]).join('|')}"|user:<名>|file:<名> | null（关）} 窗口 ▸ 图形样式库 ▸ 这个库（style_libs.rs:146-153）：开图形样式库面板（点一个＝加进图形样式并套到选取，Alt＝加上去）→ {ok, open, library, name, count}`, p => {
  if (p.library === null) return closePanel('graphicStyle'); return openPanel('graphicStyle', p.library || STYLE_LIBS[0][0]);
});
userCmd('graphicStyle', 'ai.window.graphicStyleLibrary.user', '图形样式库');
otherCmd('graphicStyle', 'ai.window.graphicStyleLibrary.other', '图形样式库');
userCmd('swatch', 'ai.window.swatchLibrary.user', '色板库');
reg('ai.ui.saveGraphicStyleLibrary', '{name?, names?:[样式名…]（缺省＝全部）, file?:bool=true（同时经 file.exportData 存成 .graphic-styles.json）, dialog?:true（开「存储图形样式」对话框）} 窗口 ▸ 图形样式库 ▸ 存储图形样式…（graphic_styles.rs:790 ui.saveGraphicStyleLibrary）：文件的图形样式存成用户定义库 → {ok, library, count}', p => {
  if (p.dialog){ P.dialog({id:'aiSaveGsLib', title:L3('儲存繪圖樣式', '存储图形样式', 'Save Graphic Styles'), fields:[{k:'name', type:'text', label:L3('名稱：', '名称：', 'Name:'), value:'Graphic Styles ' + (userLibs('graphicStyle').length + 1)},
    {k:'file', type:'check', label:L3('同時存成資料庫檔', '同时存成库档', 'Also save a library file'), value:true},
    {type:'note', label:L3('存好會出現在「使用者定義」裡。', '存好会出现在「用户定义」里。', 'Saved libraries appear under User Defined.')}],
    ok:v => CMD.run('ai.ui.saveGraphicStyleLibrary', {name:v.name, file:v.file})}); return {ok:true, dialog:'saveGraphicStyles'}; }
  return CMD.map['ai.library.saveUser'].run({kind:'graphicStyle', name:p.name || 'Graphic Styles', names:p.names, file:p.file !== false});
});
/* 「窗口 ▸ 色板库 ▸ 其它库…」（ai-window.js）只认 .vcswatches／.gpl：包一层，档案挑选器多认 .ase，agent 可直接给 ase（base64） */
(function wrapSwatchOther(){
  const c = CMD.map['ai.window.swatchLibrary.other']; if (!c || c.__ase) return;
  const run0 = c.run; c.__ase = true;
  c.run = function(p){
    p = p || {};
    if (typeof p.ase === 'string'){ let a; try { a = parseASE(b64ToBuf(p.ase)); } catch(e){ return err('swatchLibrary.other', e.message); }
      const sw = a.swatches.concat(a.groups.flatMap(g => g[1])); return run0.call(this, {name:p.name || 'Library', text:JSON.stringify({format:'dilin-swatches', name:p.name || 'Library', swatches:sw.map(s => ({name:s[0], paint:s[1]}))})}); }
    if (typeof p.text === 'string') return run0.apply(this, arguments);
    const inp = el('input', {type:'file', accept:'.ase,.vcswatches,.gpl,.json,text/plain', style:'display:none'});
    inp.onchange = () => { const f = inp.files[0]; inp.remove(); if (!f) return; const nm = f.name.replace(/\.[^.]+$/, '');
      if (/\.ase$/i.test(f.name)) f.arrayBuffer().then(b => CMD.run('ai.window.swatchLibrary.other', {ase:bufToB64(b), name:nm})); else f.text().then(t => CMD.run('ai.window.swatchLibrary.other', {text:t, name:nm})); };
    document.body.appendChild(inp); inp.click(); return {ok:true, dialog:'filePicker'};
  };
  c.params = '{text?, name?, ase?: Adobe .ase 的 base64}（都不给＝开档案挑选器，认 .ase／.vcswatches／.gpl）窗口 ▸ 色板库 ▸ 其它库…：读进来当色板库打开 → {ok, name, count}';
})();

/* ═════════════ 缩图（画成 dataURL 快取） ═════════════ */
const _thumb = {};
function canvasOf(w, h){ const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function brushThumb(b, w, h){
  const c = canvasOf(w * 2, h * 2), x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  const L = docBrushes(), tmp = Object.assign(clone(b), {name:'\u0000libpreview\u0000' + b.name}); L.push(tmp);
  const s = {id:'lpv' + b.name, type:'bezier', closed:false, fill:'none', stroke:'#000000', strokeWidth:1, brush:tmp.name, anchors:[{x:h * 0.5, y:h * 0.5, in:null, out:[h * 0.5 + (w - h) * 0.35, h * 0.1]}, {x:w - h * 0.5, y:h * 0.5, in:[h * 0.5 + (w - h) * 0.65, h * 0.9], out:null}]};
  try { window.drawShape(x, s, 2); } catch(e){} finally { const i = L.indexOf(tmp); if (i >= 0) L.splice(i, 1); }
  return c.toDataURL();
}
function shapesThumb(shapes, size){
  const c = canvasOf(size * 2, size * 2), x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  const B = shapes.map(s => { try { return AIObj.shapeBounds(s, p => p, true); } catch(e){ return null; } }).filter(Boolean).reduce((r, q) => !r ? q : {x0:Math.min(r.x0, q.x0), y0:Math.min(r.y0, q.y0), x1:Math.max(r.x1, q.x1), y1:Math.max(r.y1, q.y1)}, null);
  if (!B) return c.toDataURL();
  const k = (size * 2 - 8) / Math.max(1, B.x1 - B.x0, B.y1 - B.y0); x.translate(c.width / 2 - (B.x0 + B.x1) / 2 * k, c.height / 2 - (B.y0 + B.y1) / 2 * k);
  try { shapes.forEach(s => window.drawShape(x, s, k)); } catch(e){} return c.toDataURL();
}
const styleThumb = look => shapesThumb([Object.assign({id:'lgs', type:'rect', x:6, y:6, w:28, h:28, radius:0}, clone(look))], 40);
function thumbURL(k, libId, it){
  const key = k + '|' + libId + '|' + itemName(k, it); if (_thumb[key]) return _thumb[key];
  let u = ''; try { u = k === 'brush' ? brushThumb(it, 64, 26) : k === 'graphicStyle' ? styleThumb(it.look) : k === 'symbol' ? shapesThumb(it.shapes, 36) : ''; } catch(e){ console.warn('[ai-libraries] thumb', e); }
  return (_thumb[key] = u);
}
const swatchCSS = v => typeof v === 'string' ? (v === 'none' ? '#fff' : v) : v && Array.isArray(v.stops) ? `${v.kind === 'radial' ? 'radial' : 'linear'}-gradient(${v.kind === 'radial' ? 'circle' : '90deg'}, ${v.stops.map(s => `${s[1]} ${Math.round(s[0] * 100)}%`).join(', ')})` : '#fff';

/* ═════════════ 库面板（照 AI 2020 库面板：标题＝库名、缩图格、底下 ◀ ▶ 与选单） ═════════════ */
function libLabel(k, id){ const L = getLib(k, id); if (!L) return id; return (L.user ? '👤 ' : L.file ? '📄 ' : '') + T(L.name); }
function definePanel(k){
  const K = KINDS[k];
  P.define(K.panel, {title:K.title, w:k === 'brush' ? 300 : 270, h:340, only:K.only || undefined,
    refresh(b, api, why){
      if (why === 'draw' || (why !== 'open' && why !== 'lib' && P.typing(b))) return;
      b.innerHTML = ''; const id = AL.state[k].open, L = id ? getLib(k, id) : null, ids = libIds(k);
      const box = P.els[K.panel]; if (box) box.querySelector('.dlp-t').textContent = L ? T(L.name) : T(K.title);
      const selEl = el('select', {style:'width:100%;margin-bottom:4px', dataset:{act:'pickLib'}, onchange:() => { const v = selEl.value; selEl.blur(); if (v === 'user:') { AL.state[k].open = 'user:'; P.refresh(K.panel, 'lib'); } else CMD.run('ai.library.open', {kind:k, library:v}); }});
      if (!L) selEl.appendChild(el('option', {value:'user:', text:T(L3('（使用者定義）', '（用户定义）', '(User Defined)'))}));
      ids.forEach(x => selEl.appendChild(el('option', {value:x, text:libLabel(k, x)}))); selEl.value = L ? L.id : 'user:'; b.appendChild(selEl);
      if (!L){ b.appendChild(el('div', {class:'hint', style:'padding:6px', text:T(L3('還沒有使用者定義的資料庫。按下方「儲存」把文件裡的項目存成一個，或「其他資料庫…」讀入檔案。', '还没有用户定义的库。按下方「存储」把文件里的项目存成一个，或「其它库…」读入档案。', 'No user-defined libraries yet. Click Save to store the document\'s items as one, or Other Library… to load a file.'))})); }
      else {
        const sections = k === 'swatch' ? [[null, L.items]].concat((L.groups || []).map(g => ['📁 ' + g[0], g[1]])) : [[null, L.items]];
        sections.forEach(([head, items]) => {
          if (head) b.appendChild(el('div', {class:'sec', text:head}));
          const g = el('div', {class:'grid', style:'display:flex;flex-wrap:wrap;gap:3px;padding:2px'});
          items.forEach(it => { const nm = itemName(k, it);
            const click = e => { CMD.run('ai.library.add', {kind:k, library:L.id, names:[nm], add:e.altKey}); };
            const dbl = () => { if (k === 'symbol') CMD.run('ai.library.add', {kind:k, library:L.id, names:[nm], place:true}); };
            let t;
            if (k === 'swatch') t = el('div', {class:'sw', title:nm, dataset:{name:nm}, onclick:click, style:`width:18px;height:18px;cursor:pointer;border:1px solid #555;background:${swatchCSS(it[1])}`});
            else { t = el('div', {title:nm, dataset:{name:nm}, onclick:click, ondblclick:dbl, style:'cursor:pointer;outline:1px solid #444;background:#fff'});
              t.appendChild(el('img', {src:thumbURL(k, L.id, it), draggable:false, style:`display:block;pointer-events:none;width:${k === 'brush' ? 64 : 40}px;height:${k === 'brush' ? 26 : 40}px`})); }
            g.appendChild(t); });
          b.appendChild(g); });
      }
      const i = ids.indexOf(L ? L.id : ''), go = d => { if (!ids.length) return; CMD.run('ai.library.open', {kind:k, library:ids[((i < 0 ? 0 : i) + d + ids.length) % ids.length]}); };
      const B = (txt, tip, fn, opt) => el('button', Object.assign({text:txt, title:tip ? T(tip) : null, onclick:fn}, opt || {}));
      b.appendChild(el('div', {class:'bar'}, [
        B('◀', L3('上一個資料庫', '上一个库', 'Previous Library'), () => go(-1), {dataset:{act:'prev'}}), B('▶', L3('下一個資料庫', '下一个库', 'Next Library'), () => go(1), {dataset:{act:'next'}}),
        B(T(L3('全部加入', '全部加入', 'Add All')), null, () => L && CMD.run('ai.library.add', {kind:k, library:L.id, apply:false}), {disabled:!L, dataset:{act:'addAll'}}),
        B('💾', L3('儲存成使用者定義資料庫…', '存储为用户定义库…', 'Save as User Library…'), () => saveDialog(k), {dataset:{act:'save'}}),
        B('📂', L3('其他資料庫…', '其它库…', 'Other Library…'), () => pickFile(k, ACCEPT[k]), {dataset:{act:'other'}}),
        B('🗑', L3('刪除這個使用者定義資料庫', '删除这个用户定义库', 'Delete this User Library'), () => L && L.user && CMD.run('ai.library.deleteUser', {kind:k, name:L.name}), {disabled:!(L && L.user), dataset:{act:'deleteLib'}})]));
    },
    menu(){ const id = AL.state[k].open, L = id && getLib(k, id);
      return [{label:L3('全部加入', '全部加入', 'Add All'), disabled:!L, run:() => CMD.run('ai.library.add', {kind:k, library:L.id, apply:false})},
        {label:L3('儲存成使用者定義資料庫…', '存储为用户定义库…', 'Save as User Library…'), run:() => saveDialog(k)},
        {label:L3('匯入到使用者定義…', '导入到用户定义…', 'Import into User Defined…'), run:() => pickFile(k, ACCEPT[k], true)},
        {label:L3('轉存這個資料庫…', '导出这个库…', 'Export This Library…'), disabled:!L, run:() => CMD.run('ai.library.export', {kind:k, library:L.id})},
        {label:L3('刪除使用者定義資料庫', '删除用户定义库', 'Delete User Library'), disabled:!(L && L.user), run:() => CMD.run('ai.library.deleteUser', {kind:k, name:L.name})}]; }});
}
function saveDialog(k){
  const def = {brush:'Brushes', graphicStyle:'Graphic Styles', symbol:'Symbols', swatch:'Swatches'}[k] + ' ' + (userLibs(k).length + 1);
  P.dialog({id:'aiLibSave', title:L3('儲存成使用者定義資料庫', '存储为用户定义库', 'Save as User Library'), fields:[{k:'name', type:'text', label:L3('名稱：', '名称：', 'Name:'), value:def},
    {k:'file', type:'check', label:L3('同時存成資料庫檔', '同时存成库档', 'Also save a library file'), value:false}],
    ok:v => { const r = CMD.run('ai.library.saveUser', {kind:k, name:v.name, file:v.file}); if (r.ok !== false) openPanel(k, r.library); return r; }});
}
Object.keys(KINDS).forEach(definePanel);
if (P.kinds){ P.kinds.aiLibBrush = 'vector'; P.kinds.aiLibStyle = 'vector'; P.kinds.aiLibSymbol = 'vector'; }
AL.kinds = KINDS; AL.get = getLib; AL.ids = libIds; AL.parseASE = parseASE; AL.fitGrad = fitGrad;
})();
