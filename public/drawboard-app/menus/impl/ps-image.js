/* 堤麟画板 · Photoshop ▸ 图像（Image）菜单的实作
   命令一律登记成 ps.<原码命令 id>（agent 走命令＝人点菜单＋对话框按确定）。对照源（photocraft/crates/…）：
     engine/src/image_cmds.rs      1-356   图像大小／画布大小／裁剪／裁切／复制（image_size、canvas_size、translate_doc、crop_doc、trim、duplicate）
     engine/src/canvas_geom.rs     1-287   图像旋转 180／90 顺逆／翻转画布（Turn::pixel_map／affine、turn_canvas、transform_geometry）
     engine/src/mode_cmds.rs       45-124  任意角度（rotated_size、rotate_arbitrary：背景层旋转后垫背景色、画布长大）
     engine/src/commands.rs        170-200, 706-735, 837-934  destructive_adjust、去色、调整命令一张表生成（params 说明照抄）
     engine/src/adjust_params.rs   1-563   每种调整的参数读法（夹范围、缺的键沿用预设、型别错＝报错）、to_params
     engine/src/adjust_cmds.rs     1-395   阴影/高光、替换颜色、匹配颜色、HDR 色调、可选颜色、颜色查找参数
     engine/src/pixels.rs          8-32    adjust_surface：直通 RGBA 算完按选区覆盖度混回
     engine/src/edit_cmds.rs       217-322 自动色调／对比度／颜色（histograms、clip_points 0.1%、median、Levels）
     engine/src/extra_cmds.rs      64-185, 593-602  map_pixels、色调均化、显示全部
     engine/src/channel_cmds.rs    289-476, 1339-1434 应用图像／计算（source、Blending、ref_planes、gray_plane）
     compose/src/adjust.rs         1-634   每种调整的像素公式（亮度对比度新旧版、曲线自然三次样条 LUT、色阶 levels_q、色相饱和度范围表、黑白、渐变映射…）
     doc/src/adjust.rs             1-262   HueRange（weight、canonical_bounds、neutral）、LevelsChannel 预设
     algo/src/tone.rs              1-364   shadows_highlights、clip_stretch、replace_color、lab_stats、match_color、hdr_toning
     algo/src/resample.rs          1-185   图像大小重采样（邻近／两次线性／两次立方 Keys a=-0.5／Lanczos3／保留细节＝Lanczos＋USM）
     algo/src/fxutil.rs            112-192 gauss_blur_n（三次盒状模糊逼近高斯）；algo/src/blur.rs 9-17 gaussian_kernel；algo/src/sharpen.rs 9-33 unsharp
     algo/src/selection.rs         434-445 color_range；algo/src/other2.rs 42-87 rgb_to_hsl／hsl_to_rgb（替换颜色用的那套）
     color/src/convert.rs          150-212 sRGB↔线性、sRGB↔Lab(D50)、rgb_to_gray；color/src/blend.rs 151-240 blend_channel
     cms/src/lutfile.rs            86-268  .cube 解析、八个内建 LUT（程式生成 33³）
     ui-egui/src/sizing.rs         1-370   图像大小／画布大小对话框（单位换算、约束比例、重新采样下拉、九宫格定位、扩展色）
     ui-egui/src/adjust_dialog.rs  1-70 ＋ adjust_editors.rs 1-1313  调整对话框（预览＝同一条命令跑在图层上；确定才进历史；取消不动文件）
     ui-egui/src/filter_dialog.rs  42-200  其余对话框照命令参数表生成（裁切、任意角度、阴影/高光、替换／匹配颜色、HDR…）
   我们的资料模型差异（照做的方式写在各函数旁）：像素层 L.data.canvas 有位移 L.x/L.y（铁律④）；矢量层形状存图层坐标；文字层没有变形矩阵；
   只有 RGB 8 位一种模式；没有通道面板、智能对象、参考线；选区是 Doc.sel（＋ SelMask 覆盖度）。
   🔴 改文件全走 CMD；对话框预览只临时改图层像素、不进历史，按确定才跑命令（一步历史），取消还原。 */
(function(){
'use strict';
if (window.PsImage) return;              // 防双载：menus/ps-image.js 自己载一次、index.html 之后也挂上时只跑第一次

/* ═══════════ 小工具 ═══════════ */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rem = (x, m) => ((x % m) + m) % m;                       // Rust rem_euclid
const isNum = v => typeof v === 'number' && isFinite(v);
const rround = v => Math.sign(v) * Math.round(Math.abs(v));    // Rust f64::round（.5 远离零）
class PsBad extends Error {}
const bad = (cmd, msg) => { throw new PsBad(cmd + ': ' + msg); };
const T = k => Lang.t(k);
function newCanvas(w, h){
  const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
  return {canvas:c, ctx:c.getContext('2d', {willReadFrequently:true})};
}
const hex2 = v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
const hexOf = c => '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);           // adjust_params.rs:368 hex
const rgbOfHex = (h, d) => { const s = String(h || '').replace(/^#+/, ''); return /^[0-9a-fA-F]{6}/.test(s) ? [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16) / 255) : d; };
/* 前景／背景色＝我们右面板的填色／描边色块（toolbar 说明：前景／背景色块＝填色／描边） */
const fgColor = () => rgbOfHex((document.getElementById('fillColor') || {}).value, [0, 0, 0]);
const bgColor = () => rgbOfHex((document.getElementById('strokeColor') || {}).value, [1, 1, 1]);

/* ═══════════ 颜色换算（color/src/convert.rs） ═══════════ */
const srgbToLinear = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const linearToSrgb = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
const rgbToGray = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;      // convert.rs:210 Rec.601
const D50 = [0.96422, 1.0, 0.82521];
function srgbToLab(r, g, b){                                            // convert.rs:197
  const lin = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const m = [[0.436074, 0.385064, 0.143080], [0.222504, 0.716878, 0.060618], [0.013932, 0.097104, 0.714173]];
  const xyz = [0, 1, 2].map(i => (m[i][0] * lin[0] + m[i][1] * lin[1] + m[i][2] * lin[2]) / D50[i]);
  const e = Math.pow(6 / 29, 3), k = 3 * Math.pow(6 / 29, 2);
  const f = t => t > e ? Math.cbrt(t) : t / k + 4 / 29;
  const fx = f(xyz[0]), fy = f(xyz[1]), fz = f(xyz[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function labToSrgb(l, a, b){                                            // convert.rs:179
  const fy = (l + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const finv = t => t > 6 / 29 ? t * t * t : 3 * Math.pow(6 / 29, 2) * (t - 4 / 29);
  const xyz = [finv(fx) * D50[0], finv(fy) * D50[1], finv(fz) * D50[2]];
  const m = [[3.133856, -1.616867, -0.490615], [-0.978768, 1.916142, 0.033454], [0.071945, -0.228991, 1.405243]];
  return [0, 1, 2].map(i => linearToSrgb(clamp(m[i][0] * xyz[0] + m[i][1] * xyz[1] + m[i][2] * xyz[2], 0, 1)));
}
/* compose/src/adjust.rs:596-634 的 HSL（色相 0..1） */
function hslOf(r, g, b){
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (Math.abs(max - min) < 1e-7) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? rem((g - b) / d, 6) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslRgb(h, s, l){
  if (s <= 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = rem(t, 1); return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
/* algo/src/other2.rs:42-87 的 HSL（替换颜色用这套；跟上面那套饱和度算法不同，照抄不合并） */
function hsl2Of(r, g, b){
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  const s = d <= 0 ? 0 : d / Math.max(1 - Math.abs(2 * l - 1), 1e-7);
  let h = 0;
  if (d > 0) h = (mx === r ? rem((g - b) / d, 6) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
  return [h, clamp(s, 0, 1), l];
}
function hsl2Rgb(h, s, l){
  const chroma = (1 - Math.abs(2 * l - 1)) * s, m = l - chroma / 2;
  const hp = rem(h, 1) * 6, x = chroma * (1 - Math.abs(rem(hp, 2) - 1));
  const k = Math.floor(hp);
  const [r, g, b] = k === 0 ? [chroma, x, 0] : k === 1 ? [x, chroma, 0] : k === 2 ? [0, chroma, x] : k === 3 ? [0, x, chroma] : k === 4 ? [x, 0, chroma] : [chroma, 0, x];
  return [r + m, g + m, b + m];
}

/* ═══════════ 调整参数（adjust_params.rs） ═══════════ */
const HUE_RANGES = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'];
const BW_DEFAULTS = [40, 60, 40, 60, 20, 80];
const SC_RANGES = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'];
const PHOTO_FILTERS = [   // adjust_params.rs:26-47（id, 英文名, 颜色）
  ['warming85', 'Warming Filter (85)', [236, 138, 0]], ['warmingLBA', 'Warming Filter (LBA)', [250, 150, 0]], ['warming81', 'Warming Filter (81)', [235, 177, 19]],
  ['cooling80', 'Cooling Filter (80)', [0, 109, 255]], ['coolingLBB', 'Cooling Filter (LBB)', [0, 93, 255]], ['cooling82', 'Cooling Filter (82)', [0, 181, 255]],
  ['red', 'Red', [234, 26, 26]], ['orange', 'Orange', [243, 132, 23]], ['yellow', 'Yellow', [249, 227, 28]], ['green', 'Green', [25, 201, 25]],
  ['cyan', 'Cyan', [29, 203, 234]], ['blue', 'Blue', [29, 53, 234]], ['violet', 'Violet', [155, 29, 234]], ['magenta', 'Magenta', [227, 24, 227]],
  ['sepia', 'Sepia', [172, 122, 51]], ['deepRed', 'Deep Red', [255, 0, 0]], ['deepBlue', 'Deep Blue', [0, 34, 205]], ['deepEmerald', 'Deep Emerald', [0, 140, 0]],
  ['deepYellow', 'Deep Yellow', [255, 213, 0]], ['underwater', 'Underwater', [0, 194, 177]]];
const LOOKS = [['warm', 'Warm Filter'], ['cool', 'Cool Filter'], ['tealOrange', 'Teal & Orange'], ['bleachBypass', 'Bleach Bypass'],
  ['fadedFilm', 'Faded Film'], ['dayForNight', 'Day for Night'], ['monoContrast', 'Mono High Contrast'], ['crossProcess', 'Cross Process']];   // lutfile.rs:219

function colorOf(cmd, key, v){                                     // adjust_params.rs:349 color_of
  const err = () => bad(cmd, '`' + key + '` must be "#rrggbb" or [r, g, b] in 0..1');
  if (typeof v === 'string'){
    const h = v.replace(/^#+/, '');
    if ((h.length === 6 || h.length === 8) && /^[0-9a-fA-F]{6}/.test(h)) return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    return err();
  }
  if (Array.isArray(v) && v.length >= 3) return [0, 1, 2].map(i => isNum(v[i]) ? clamp(v[i], 0, 1) : err());
  return err();
}
/* adjust_params.rs:295 Reader：缺的键＝预设（夹范围）、有给但型别错＝报错、数字夹到范围 */
function reader(cmd, p){
  return {
    p,
    get(k){ const v = p ? p[k] : undefined; return v === null ? undefined : v; },
    num(k, d, lo, hi){ const v = this.get(k); if (v === undefined) return clamp(d, lo, hi); if (!isNum(v)) bad(cmd, '`' + k + '` must be a number'); return clamp(v, lo, hi); },
    bool(k, d){ const v = this.get(k); if (v === undefined) return d; if (typeof v !== 'boolean') bad(cmd, '`' + k + '` must be true or false'); return v; },
    nums(k, n){ const v = this.get(k); if (v === undefined) return null; if (!Array.isArray(v) || v.length !== n) bad(cmd, '`' + k + '` must be an array of ' + n + ' numbers');
      return v.map(x => isNum(x) ? clamp(x, -1e6, 1e6) : bad(cmd, '`' + k + '` must be a number')); },
    color(k, d){ const v = this.get(k); return v === undefined ? d : colorOf(cmd, k, v); },
    obj(k){ const v = this.get(k); if (v === undefined) return null; if (typeof v !== 'object' || Array.isArray(v)) bad(cmd, '`' + k + '` must be an object'); return reader(cmd, v); }
  };
}
/* doc/src/adjust.rs:66-116 HueRange */
const neutralRange = i => { const c = 60 * i; return {hue:0, saturation:0, lightness:0, bounds:[c - 45, c - 15, c + 15, c + 45]}; };
function canonicalBounds(b){
  if (b.some(v => !isFinite(v))) return [-45, -15, 15, 45];
  const out = [b[0], b[0], b[0], b[0]];
  for (let k = 1; k < 4; k++) out[k] = Math.min(out[k - 1] + rem(b[k] - out[k - 1], 360), out[0] + 359);
  const centre = (out[1] + out[2]) / 2, shift = rem(centre + 30, 360) - 30 - centre;
  return out.map(v => v + shift);
}
const rangeNeutral = r => r.hue === 0 && r.saturation === 0 && r.lightness === 0;
function rangeWeight(r, deg){
  const [a, b0, c0, d0] = r.bounds;
  const rel = x => isFinite(x) ? rem(x - a, 360) : 0;
  const b = rel(b0), c = Math.max(rel(c0), b), d = Math.max(rel(d0), c), h = rel(deg);
  if (h <= b) return b <= 0 ? 1 : h / b;
  if (h <= c) return 1;
  if (h <= d) return d <= c ? 1 : (d - h) / (d - c);
  return 0;
}
const LV0 = () => ({inBlack:0, inWhite:1, gamma:1, outBlack:0, outWhite:1});
const IDC = () => [{i:0, o:0}, {i:1, o:1}];
const MAX_CURVE_POINTS = 19;
/* PS 2020 曲线内建预设（Presets/Curves/*.acv，下拉顺序照 PS）。
   ⚠ 我们手上没有 Adobe 的 .acv 原档：负片（反相）是精确的；其余点值照 PS 预设画出来的曲线形状取的近似值（误差几个色阶），不是逐点抄档 */
const CURVE_PRESETS = [
  ['default', ['預設值', '默认值', 'Default'], {}],
  ['colorNegative', ['彩色負片 (RGB)', '彩色负片 (RGB)', 'Color Negative (RGB)'], {red:[[50, 255], [228, 0]], green:[[28, 255], [150, 0]], blue:[[18, 255], [96, 0]]}],   // 近似：反相＋扣掉橘色片基
  ['crossProcess', ['正片負沖 (RGB)', '反冲 (RGB)', 'Cross Process (RGB)'], {red:[[0, 0], [88, 47], [170, 188], [255, 255]], green:[[0, 0], [65, 57], [184, 208], [255, 255]], blue:[[0, 29], [255, 226]]}],
  ['darker', ['較暗 (RGB)', '较暗 (RGB)', 'Darker (RGB)'], {points:[[0, 0], [140, 110], [255, 255]]}],
  ['increaseContrast', ['增加對比 (RGB)', '增加对比度 (RGB)', 'Increase Contrast (RGB)'], {points:[[0, 0], [64, 50], [192, 206], [255, 255]]}],
  ['lighter', ['較亮 (RGB)', '较亮 (RGB)', 'Lighter (RGB)'], {points:[[0, 0], [110, 140], [255, 255]]}],
  ['linearContrast', ['線性對比 (RGB)', '线性对比度 (RGB)', 'Linear Contrast (RGB)'], {points:[[0, 0], [42, 24], [213, 231], [255, 255]]}],
  ['mediumContrast', ['中對比 (RGB)', '中对比度 (RGB)', 'Medium Contrast (RGB)'], {points:[[0, 0], [64, 57], [192, 199], [255, 255]]}],
  ['negative', ['負片 (RGB)', '负片 (RGB)', 'Negative (RGB)'], {points:[[0, 255], [255, 0]]}],
  ['strongContrast', ['強對比 (RGB)', '强对比度 (RGB)', 'Strong Contrast (RGB)'], {points:[[0, 0], [64, 40], [192, 216], [255, 255]]}]];
function parseCurve(cmd, key, v){                                  // adjust_params.rs:476 parse_curve
  const err = () => bad(cmd, '`' + key + '` must be an array of 2..=' + MAX_CURVE_POINTS + ' [input, output] pairs in 0..255, or {"pencil":[256 outputs 0..255]}');
  /* PS 铅笔模式（用铅笔绘制曲线）：任意曲线＝256 格输出表；{"pencil":[…256]} 或直接 256 个数字。内部存 {pencil:[0..1 ×256]} */
  const pen = v && !Array.isArray(v) && typeof v === 'object' ? v.pencil : (Array.isArray(v) && v.length === 256 && v.every(isNum) ? v : undefined);
  if (pen !== undefined){
    if (!Array.isArray(pen) || pen.length !== 256 || !pen.every(isNum)) bad(cmd, '`' + key + '.pencil` must be an array of 256 numbers in 0..255');
    return {pencil:pen.map(x => clamp(x, 0, 255) / 255)};
  }
  if (!Array.isArray(v) || v.length < 2 || v.length > 64) err();
  let pts = v.map(q => { if (!Array.isArray(q) || q.length !== 2 || !isNum(q[0]) || !isNum(q[1])) err(); return {i:clamp(q[0], 0, 255) / 255, o:clamp(q[1], 0, 255) / 255}; });
  pts.sort((a, b) => a.i - b.i);
  const out = [];
  for (const q of pts) if (!out.length || Math.abs(q.i - out[out.length - 1].i) >= 0.5 / 255) out.push(q);   // dedup_by：跟前一个太近就丢掉后来的
  if (out.length < 2 || out.length > MAX_CURVE_POINTS) err();
  return out;
}
function gradientStops(cmd, v){                                    // adjust_params.rs:535
  const err = () => bad(cmd, '`stops` must be an array of 2..=64 [location 0..1, colour] pairs');
  if (!Array.isArray(v) || v.length < 2 || v.length > 64) err();
  const out = v.map(s => {
    let t, c;
    if (Array.isArray(s) && s.length === 2){ t = s[0]; c = s[1]; }
    else if (s && typeof s === 'object' && !Array.isArray(s)){ t = s.location; c = s.color; }
    else err();
    if (!isNum(t) || c === undefined || c === null) err();
    return [clamp(t, 0, 1), colorOf(cmd, 'stops', c)];
  });
  return out.map((s, i) => [s, i]).sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1]).map(x => x[0]);
}
/* 我们只有 RGB 文件：色阶／曲线的 CMYK／Lab 色版键（cyan…/a/b/lightness）原码会换色调空间，这里不支援 */
function rgbOnly(cmd, r){
  for (const k of ['cyan', 'magenta', 'yellow', 'black', 'a', 'b', 'lightness'])
    if (r.get(k) !== undefined) bad(cmd, '`' + k + '`: this document is RGB (channel keys: red, green, blue, gray)');
}
/* adjust_params.rs:75 from_params：读 p 盖在 base（或预设）上 */
function fromParams(kind, p, base){
  const cmd = 'adjustment `' + kind + '`';
  if (p !== null && p !== undefined && (typeof p !== 'object' || Array.isArray(p))) bad(cmd, 'params must be an object');
  p = p || {};
  const r = reader(cmd, p), B = base && base.kind === kind ? base : null;
  const cp = x => JSON.parse(JSON.stringify(x));
  switch (kind){
    case 'invert': return {kind};
    case 'brightnessContrast': {
      const legacy = r.bool('legacy', B ? B.legacy : false), lo = legacy ? -100 : -50;
      return {kind, brightness:r.num('brightness', B ? B.brightness : 0, -150, 150), contrast:r.num('contrast', B ? B.contrast : 0, lo, 100), legacy};
    }
    case 'threshold': return {kind, level:Math.round(r.num('level', B ? B.level * 255 : 128, 1, 255)) / 255};
    case 'posterize': return {kind, levels:Math.round(r.num('levels', B ? B.levels : 4, 2, 255))};
    case 'exposure': return {kind, exposure:r.num('exposure', B ? B.exposure : 0, -20, 20), offset:r.num('offset', B ? B.offset : 0, -0.5, 0.5), gamma:r.num('gamma', B ? B.gamma : 1, 0.01, 9.99)};
    case 'vibrance': return {kind, vibrance:r.num('vibrance', B ? B.vibrance : 0, -100, 100), saturation:r.num('saturation', B ? B.saturation : 0, -100, 100)};
    case 'hueSaturation': {                                        // adjust_params.rs:386
      const ranges = B ? cp(B.ranges) : [0, 1, 2, 3, 4, 5].map(neutralRange);
      const colorize = r.bool('colorize', B ? B.colorize : false), h0 = B ? B.hue : 0;
      const hue = colorize ? r.num('hue', rem(h0, 360), 0, 360) : r.num('hue', h0, -180, 180);
      const saturation = r.num('saturation', B ? B.saturation : 0, colorize ? 0 : -100, 100), lightness = r.num('lightness', B ? B.lightness : 0, -100, 100);
      HUE_RANGES.forEach((key, i) => {
        const o = r.obj(key); if (!o) return;
        const g = ranges[i];
        g.hue = o.num('hue', g.hue, -180, 180); g.saturation = o.num('saturation', g.saturation, -100, 100); g.lightness = o.num('lightness', g.lightness, -100, 100);
        const b = o.nums('range', 4); if (b) g.bounds = canonicalBounds(b);
      });
      return {kind, hue, saturation, lightness, colorize, ranges};
    }
    case 'levels': {                                               // adjust_params.rs:423（RGB 空间）
      rgbOnly(cmd, r);
      let master = B ? cp(B.master) : LV0(); const chans = B ? cp(B.per) : [LV0(), LV0(), LV0()];
      const read = (o, c) => {
        const inBlack = o.num('inBlack', c.inBlack * 255, 0, 253);
        const inWhite = Math.max(o.num('inWhite', c.inWhite * 255, 2, 255), inBlack + 2);
        return {inBlack:inBlack / 255, inWhite:inWhite / 255, gamma:o.num('gamma', c.gamma, 0.01, 9.99),
                outBlack:o.num('outBlack', c.outBlack * 255, 0, 255) / 255, outWhite:o.num('outWhite', c.outWhite * 255, 0, 255) / 255};
      };
      master = read(r, master);
      const g = r.obj('gray'); if (g) master = read(g, master);
      ['red', 'green', 'blue'].forEach((k, i) => { const o = r.obj(k); if (o) chans[i] = read(o, chans[i]); });
      return {kind, master, per:chans};
    }
    case 'curves': {                                               // adjust_params.rs:497
      rgbOnly(cmd, r);
      let master = B ? cp(B.master) : IDC(); let chans = B ? cp(B.per) : [IDC(), IDC(), IDC()];
      if (p.preset !== undefined && p.preset !== null){             // PS 内建预设（CurveKit.PRESETS）当底，其余键再盖上去
        const pr = typeof p.preset === 'string' && CURVE_PRESETS.find(x => x[0] === p.preset);
        if (!pr) bad(cmd, '`preset` must be one of ' + CURVE_PRESETS.map(x => x[0]).join(', '));
        const q = pr[2]; master = parseCurve(cmd, 'points', q.points || [[0, 0], [255, 255]]);
        chans = ['red', 'green', 'blue'].map(k => parseCurve(cmd, k, q[k] || [[0, 0], [255, 255]]));
      }
      const comp = r.get('points') !== undefined ? r.get('points') : r.get('gray');
      if (comp !== undefined) master = parseCurve(cmd, 'points', comp);
      ['red', 'green', 'blue'].forEach((k, i) => { const v = r.get(k); if (v !== undefined) chans[i] = parseCurve(cmd, k, v); });
      return {kind, master, per:chans};
    }
    case 'colorBalance': {
      const tones = B ? [B.shadows.slice(), B.midtones.slice(), B.highlights.slice()] : [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      ['shadows', 'midtones', 'highlights'].forEach((k, i) => { const v = r.nums(k, 3); if (v) tones[i] = v.map(x => clamp(x, -100, 100)); });
      return {kind, shadows:tones[0], midtones:tones[1], highlights:tones[2], preserve:r.bool('preserveLuminosity', B ? B.preserve : true)};
    }
    case 'blackWhite': {
      const w = B ? B.weights.slice() : BW_DEFAULTS.slice();
      HUE_RANGES.forEach((k, i) => { w[i] = r.num(k, w[i], -200, 300); });
      const color = r.color('tintColor', (B && B.tint) || [0.882, 0.827, 0.702]);     // PS 预设色调＝浅褐
      return {kind, weights:w, tint:r.bool('tint', !!(B && B.tint)) ? color : null};
    }
    case 'photoFilter': {
      let preset = null;
      if (p.filter !== undefined && p.filter !== null){
        if (typeof p.filter !== 'string') bad(cmd, '`filter` must be a preset id');
        const f = PHOTO_FILTERS.find(x => x[0] === p.filter); if (!f) bad(cmd, 'unknown filter `' + p.filter + '`');
        preset = f[2].map(v => v / 255);
      }
      const color = r.color('color', preset || (B ? B.color : [236 / 255, 138 / 255, 0]));
      return {kind, color, density:r.num('density', (B ? B.density : 0.25) * 100, 0, 100) / 100, preserve:r.bool('preserveLuminosity', B ? B.preserve : true)};
    }
    case 'channelMixer': {
      const matrix = B ? cp(B.matrix) : [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]], mono0 = B ? B.mono : false;
      const mono = r.bool('monochrome', mono0);
      if (mono && !mono0 && !('gray' in p)) matrix[0] = [0.4, 0.4, 0.2, 0];            // 打开单色从 PS 的灰色配方起
      const row = v => [0, 1, 2, 3].map(i => clamp(v[i] !== undefined ? v[i] : 0, -200, 200) / 100);
      ['red', 'green', 'blue'].forEach((k, i) => { const v = r.nums(k, 4); if (v) matrix[i] = row(v); });
      const g = r.nums('gray', 4); if (g) matrix[0] = row(g);
      return {kind, matrix, mono};
    }
    case 'gradientMap': {
      const stops = (p.stops === undefined || p.stops === null) ? (B ? cp(B.stops) : [[0, [0, 0, 0]], [1, [1, 1, 1]]]) : gradientStops(cmd, p.stops);
      return {kind, stops, reverse:r.bool('reverse', B ? B.reverse : false), dither:r.bool('dither', B ? B.dither : false)};
    }
    case 'selectiveColor': {                                       // adjust_cmds.rs:37
      let relative = B ? B.relative : true; const adj = B ? cp(B.adj) : SC_RANGES.map(() => [0, 0, 0, 0]);
      if (typeof p.method === 'string') relative = p.method !== 'absolute';
      if (typeof p.relative === 'boolean') relative = p.relative;
      SC_RANGES.forEach((k, i) => { if (Array.isArray(p[k])) p[k].slice(0, 4).forEach((v, j) => { adj[i][j] = clamp(isNum(v) ? v : 0, -100, 100); }); });
      const ri = typeof p.colors === 'string' ? SC_RANGES.indexOf(p.colors) : -1;
      if (ri >= 0) ['cyan', 'magenta', 'yellow', 'black'].forEach((k, j) => { if (isNum(p[k])) adj[ri][j] = clamp(p[k], -100, 100); });
      return {kind, relative, adj};
    }
    case 'colorLookup': {                                          // adjust_cmds.rs:70 lookup_from_params
      let name = B ? B.name : '', lut = B ? B.lut : null, size = B ? B.size : 0, tetra = B ? B.tetra : false, dither = B ? B.dither : false;
      let loaded = null;
      if (typeof p.lut === 'string'){
        if (p.lut === 'none' || p.lut === ''){ name = ''; lut = null; size = 0; }
        else { const f = builtinLut(p.lut); if (!f) bad('colorLookup', 'unknown look `' + p.lut + '` (built-ins: ' + LOOKS.map(x => x[0]).join(', ') + ')'); loaded = f; }
      }
      if (typeof p.data === 'string'){
        const fn = typeof p.fileName === 'string' ? p.fileName : 'lut.cube';
        loaded = parseLutText(fn, p.data); loaded.title = fn.split(/[\\/]/).pop();
      }
      if (typeof p.file === 'string' && p.file) bad('colorLookup', "can't read " + p.file + ' in the browser (pass the file text as `data` + `fileName`)');
      if (loaded){ name = loaded.title; size = loaded.size; lut = loaded.data; }
      if (typeof p.interpolation === 'string') tetra = p.interpolation === 'tetrahedral';
      if (typeof p.tetrahedral === 'boolean') tetra = p.tetrahedral;
      if (typeof p.dither === 'boolean') dither = p.dither;
      return {kind, name, lut, size, tetra, dither};
    }
    default: bad('adjustment', 'unknown adjustment kind `' + kind + '`');
  }
}
/* adjust_params.rs:213 to_params（给对话框当预设值、也回传给 agent 看） */
function toParams(a){
  const q = v => Math.round(v * 255 * 100) / 100, lv = c => ({inBlack:q(c.inBlack), gamma:Math.round(c.gamma * 1000) / 1000, inWhite:q(c.inWhite), outBlack:q(c.outBlack), outWhite:q(c.outWhite)});
  const ca = c => c && c.pencil ? {pencil:c.pencil.map(x => Math.round(x * 25500) / 100)}
    : (c && c.length >= 2 ? c : IDC()).map(x => [Math.round(x.i * 25500) / 100, Math.round(x.o * 25500) / 100]);
  switch (a.kind){
    case 'invert': return {};
    case 'brightnessContrast': return {brightness:a.brightness, contrast:a.contrast, legacy:a.legacy};
    case 'threshold': return {level:Math.round(a.level * 255)};
    case 'posterize': return {levels:a.levels};
    case 'exposure': return {exposure:a.exposure, offset:a.offset, gamma:a.gamma};
    case 'vibrance': return {vibrance:a.vibrance, saturation:a.saturation};
    case 'hueSaturation': { const v = {hue:a.hue, saturation:a.saturation, lightness:a.lightness, colorize:a.colorize};
      HUE_RANGES.forEach((k, i) => { const r = a.ranges[i]; v[k] = {hue:r.hue, saturation:r.saturation, lightness:r.lightness, range:r.bounds.slice()}; }); return v; }
    case 'levels': { const v = lv(a.master); ['red', 'green', 'blue'].forEach((k, i) => { v[k] = lv(a.per[i]); }); return v; }
    case 'curves': { const v = {points:ca(a.master)}; ['red', 'green', 'blue'].forEach((k, i) => { v[k] = ca(a.per[i]); }); return v; }
    case 'colorBalance': return {shadows:a.shadows.slice(), midtones:a.midtones.slice(), highlights:a.highlights.slice(), preserveLuminosity:a.preserve};
    case 'blackWhite': { const v = {tint:!!a.tint, tintColor:hexOf(a.tint || [0.882, 0.827, 0.702])}; HUE_RANGES.forEach((k, i) => { v[k] = a.weights[i]; }); return v; }
    case 'photoFilter': return {color:hexOf(a.color), density:Math.round(a.density * 1000) / 10, preserveLuminosity:a.preserve};
    case 'channelMixer': { const row = r => r.map(x => Math.round(x * 1000) / 10); const v = {red:row(a.matrix[0]), green:row(a.matrix[1]), blue:row(a.matrix[2]), monochrome:a.mono}; if (a.mono) v.gray = row(a.matrix[0]); return v; }
    case 'gradientMap': return {stops:a.stops.map(([t, c]) => [t, hexOf(c)]), reverse:a.reverse, dither:a.dither};
    case 'selectiveColor': { const v = {method:a.relative ? 'relative' : 'absolute'}; SC_RANGES.forEach((k, i) => { v[k] = a.adj[i].slice(); }); return v; }
    case 'colorLookup': return {interpolation:a.tetra ? 'tetrahedral' : 'trilinear', dither:a.dither};
  }
  return {};
}

/* ═══════════ 颜色查找表（cms/src/lutfile.rs） ═══════════ */
const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
function lutFromFn(title, size, f){                                // lutfile.rs:44 from_fn（红最快）
  const m = Math.max(size, 2) - 1, data = new Float32Array(size * size * size * 3); let k = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++){
    const o = f([r / m, g / m, b / m]); data[k++] = clamp(o[0], 0, 1); data[k++] = clamp(o[1], 0, 1); data[k++] = clamp(o[2], 0, 1);
  }
  return {title, size, data};
}
const _lutCache = {};
function builtinLut(id){                                           // lutfile.rs:231 builtin
  const e = LOOKS.find(x => x[0] === id); if (!e) return null;
  if (_lutCache[id]) return _lutCache[id];
  const luma = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const F = {
    warm: c => [c[0] * 0.92 + 0.08, c[1] * 0.97 + 0.02, c[2] * 0.85],
    cool: c => [c[0] * 0.86, c[1] * 0.97 + 0.01, c[2] * 0.9 + 0.1],
    tealOrange: c => { const l = luma(c), t = smooth(l), teal = [0, 0.5, 0.55], orange = [1, 0.62, 0.3];
      return [0, 1, 2].map(k => { const tint = teal[k] * (1 - t) + orange[k] * t; return c[k] * 0.75 + Math.min(tint * l * 1.1, 1) * 0.25 + (smooth(c[k]) - c[k]) * 0.3; }); },
    bleachBypass: c => { const l = luma(c), s = smooth(l); return [0, 1, 2].map(k => (c[k] * 0.45 + l * 0.55) * 0.5 + s * 0.5); },
    fadedFilm: c => { const l = luma(c), tint = [1, 0.96, 0.88]; return [0, 1, 2].map(k => (0.08 + (c[k] * 0.8 + l * 0.2) * 0.84) * tint[k] + 0.02); },
    dayForNight: c => { const l = luma(c); return [l * 0.35, l * 0.45 + c[1] * 0.05, l * 0.65 + c[2] * 0.15]; },
    monoContrast: c => { const v = smooth(smooth(luma(c))); return [v, v, v]; },
    crossProcess: c => [smooth(c[0]) * 1.05, c[1] * 1.1 - 0.03, c[2] * 0.7 + 0.15]
  };
  return (_lutCache[id] = lutFromFn(e[1], 33, F[id]));
}
/* lutfile.rs:86 parse_cube（只认 .cube；.3dl／.look 没抄） */
function parseLutText(fileName, text){
  const low = String(fileName).toLowerCase();
  if (low.endsWith('.3dl') || low.endsWith('.look')) bad('colorLookup', 'only .cube files are supported here');
  let title = '', size3 = 0, size1 = 0; const rows = [];
  for (const raw of String(text).split(/\r?\n/)){
    const line = raw.split('#')[0].trim(); if (!line) continue;
    const it = line.split(/\s+/), key = it[0];
    if (key === 'TITLE') title = line.slice(5).trim().replace(/^"+|"+$/g, '');
    else if (key === 'LUT_3D_SIZE'){ size3 = parseInt(it[1], 10); if (!(size3 > 0)) bad('colorLookup', 'bad LUT_3D_SIZE'); }
    else if (key === 'LUT_1D_SIZE'){ size1 = parseInt(it[1], 10); if (!(size1 > 0)) bad('colorLookup', 'bad LUT_1D_SIZE'); }
    else if (/^[0-9+\-.]/.test(key)){
      const v = it.map(Number).filter(x => !isNaN(x)); if (isNaN(Number(key)) || v.length !== 3) bad('colorLookup', 'bad data line `' + line + '`');
      rows.push(...v);
    }
  }
  const check = l => { if (l.size < 2 || l.size > 256) bad('colorLookup', 'unsupported LUT size ' + l.size);
    if (l.data.length !== l.size ** 3 * 3) bad('colorLookup', 'expected ' + l.size ** 3 + ' entries, found ' + l.data.length / 3);
    if (Array.prototype.some.call(l.data, v => !isFinite(v))) bad('colorLookup', 'non-finite LUT value'); return l; };
  if (size3 > 0) return check({title, size:size3, data:Float32Array.from(rows)});
  if (size1 >= 2 && rows.length === size1 * 3){
    const curve = (ch, v) => { const x = clamp(v, 0, 1) * (size1 - 1), i = Math.min(Math.floor(x), size1 - 2), f = x - i; return rows[i * 3 + ch] * (1 - f) + rows[(i + 1) * 3 + ch] * f; };
    const l = lutFromFn(title, 33, c => [curve(0, c[0]), curve(1, c[1]), curve(2, c[2])]); l.title = title; return check(l);
  }
  bad('colorLookup', 'no LUT_3D_SIZE in .cube file');
}
function lut3d(lut, n, c, tetra){                                  // compose/adjust.rs:342 lut3d_sample
  const m = n - 1, pos = c.map(v => clamp(v, 0, 1) * m), i0 = pos.map(p => Math.min(Math.floor(p), n - 2)), f = [0, 1, 2].map(k => pos[k] - i0[k]);
  const at = (dr, dg, db) => { const idx = (((i0[2] + db) * n + i0[1] + dg) * n + i0[0] + dr) * 3; return [lut[idx], lut[idx + 1], lut[idx + 2]]; };
  const mix = w => [0, 1, 2].map(k => w.reduce((s, [a, v]) => s + a * v[k], 0));
  const [fr, fg, fb] = f;
  if (tetra){
    const c000 = at(0, 0, 0), c111 = at(1, 1, 1);
    if (fr > fg){
      if (fg > fb) return mix([[1 - fr, c000], [fr - fg, at(1, 0, 0)], [fg - fb, at(1, 1, 0)], [fb, c111]]);
      if (fr > fb) return mix([[1 - fr, c000], [fr - fb, at(1, 0, 0)], [fb - fg, at(1, 0, 1)], [fg, c111]]);
      return mix([[1 - fb, c000], [fb - fr, at(0, 0, 1)], [fr - fg, at(1, 0, 1)], [fg, c111]]);
    }
    if (fb > fg) return mix([[1 - fb, c000], [fb - fg, at(0, 0, 1)], [fg - fr, at(0, 1, 1)], [fr, c111]]);
    if (fb > fr) return mix([[1 - fg, c000], [fg - fb, at(0, 1, 0)], [fb - fr, at(0, 1, 1)], [fr, c111]]);
    return mix([[1 - fg, c000], [fg - fr, at(0, 1, 0)], [fr - fb, at(1, 1, 0)], [fb, c111]]);
  }
  const lerp = (a, b, t) => [0, 1, 2].map(k => a[k] + (b[k] - a[k]) * t);
  const c00 = lerp(at(0, 0, 0), at(1, 0, 0), fr), c10 = lerp(at(0, 1, 0), at(1, 1, 0), fr), c01 = lerp(at(0, 0, 1), at(1, 0, 1), fr), c11 = lerp(at(0, 1, 1), at(1, 1, 1), fr);
  return lerp(lerp(c00, c10, fg), lerp(c01, c11, fg), fb);
}

/* ═══════════ 调整的像素公式（compose/src/adjust.rs apply_depth） ═══════════ */
const LUT_SIZE = 4096;
function lutAt(t, v){ const x = clamp(v, 0, 1) * (t.length - 1), i = Math.floor(x), j = Math.min(i + 1, t.length - 1), f = x - i; return t[i] * (1 - f) + t[j] * f; }
function levelsQ(c, v){                                            // adjust.rs:492 levels_q（quantum None：Image › Adjustments 走 apply_with）
  const range = Math.max(c.inWhite - c.inBlack, 1e-6), u = clamp((v - c.inBlack) / range, 0, 1), g = Math.max(c.gamma, 0.01);
  let t;
  if (g > 1){
    const power = Math.pow(u, 1 / g), line = 0.93 * Math.pow(2, g) * u;
    t = (power <= 1e-6 || line <= 1e-6) ? Math.min(power, line) : Math.pow(Math.pow(power, -10) + Math.pow(line, -10), -1 / 10);
  } else t = Math.pow(u, 1 / g);
  return c.outBlack + t * (c.outWhite - c.outBlack);
}
function curveLut(points){                                         // adjust.rs:526 curve_lut（自然三次样条，端点外持平）
  if (points && points.pencil){                                    // 铅笔曲线：256 格之间线性插值
    const t = points.pencil, out = new Float32Array(LUT_SIZE);
    for (let k = 0; k < LUT_SIZE; k++){ const x = k / (LUT_SIZE - 1) * 255, i = Math.floor(x), j = Math.min(i + 1, 255), f = x - i; out[k] = clamp(t[i] * (1 - f) + t[j] * f, 0, 1); }
    return out;
  }
  let pts = points.map(p => [p.i, p.o]).sort((a, b) => a[0] - b[0]);
  const ded = []; for (const q of pts) if (!ded.length || Math.abs(q[0] - ded[ded.length - 1][0]) >= 1e-6) ded.push(q);
  pts = ded;
  const out = new Float32Array(LUT_SIZE);
  if (pts.length < 2){ for (let k = 0; k < LUT_SIZE; k++) out[k] = k / (LUT_SIZE - 1); return out; }
  const n = pts.length, m2 = new Float64Array(n);
  if (n > 2){
    const x = pts.map(p => p[0]), y = pts.map(p => p[1]), c = new Float64Array(n), d = new Float64Array(n);
    for (let i = 1; i < n - 1; i++){
      const h0 = x[i] - x[i - 1], h1 = x[i + 1] - x[i], a = h0 / 6, b = (h0 + h1) / 3, cc = h1 / 6;
      const r = (y[i + 1] - y[i]) / h1 - (y[i] - y[i - 1]) / h0, den = b - a * c[i - 1];
      c[i] = cc / den; d[i] = (r - a * d[i - 1]) / den;
    }
    for (let i = n - 2; i >= 1; i--) m2[i] = d[i] - c[i] * m2[i + 1];
  }
  let seg = 0;
  for (let k = 0; k < LUT_SIZE; k++){
    const xv = Math.fround(k / (LUT_SIZE - 1));
    if (xv <= pts[0][0]){ out[k] = clamp(pts[0][1], 0, 1); continue; }
    if (xv >= pts[n - 1][0]){ out[k] = clamp(pts[n - 1][1], 0, 1); continue; }
    while (seg < n - 2 && xv > pts[seg + 1][0]) seg++;
    const i = seg, x0 = pts[i][0], y0 = pts[i][1], x1 = pts[i + 1][0], y1 = pts[i + 1][1], h = x1 - x0;
    const A = (x1 - xv) / h, Bb = (xv - x0) / h;
    out[k] = clamp(A * y0 + Bb * y1 + ((A * A * A - A) * m2[i] + (Bb * Bb * Bb - Bb) * m2[i + 1]) * h * h / 6, 0, 1);
  }
  return out;
}
function toneLuts(a){                                              // adjust.rs:228 tone_luts_q（每个色版先过自己的、再过主曲线／主色阶）
  const x = k => k / (LUT_SIZE - 1);
  if (a.kind === 'levels') return a.per.map(c => { const t = new Float32Array(LUT_SIZE); for (let k = 0; k < LUT_SIZE; k++) t[k] = levelsQ(c, levelsQ(a.master, x(k))); return t; });
  const m = curveLut(a.master);
  return a.per.map(c => { const cl = curveLut(c), t = new Float32Array(LUT_SIZE); for (let k = 0; k < LUT_SIZE; k++) t[k] = lutAt(m, cl[k]); return t; });
}
function modernBrightness(v, b){                                   // adjust.rs:450
  if (b === 0) return v;
  const s = Math.pow(1.375, b / 50), p = b >= 0 ? Math.max(4.5 - 0.013 * b, 2) : 5 - 0.072 * b;
  v = clamp(v, 0, 1); return clamp(s * v + (1 - s) * Math.pow(v, p), 0, 1);
}
function modernContrast(v, c){                                     // adjust.rs:464
  if (c === 0) return v;
  const k = c / 128, end = 1 - k, mid = 1 + k;
  const half = t => end * 0.5 * (t * t * t - 2 * t * t + t) + (-2 * t * t * t + 3 * t * t) * 0.5 + mid * 0.5 * (t * t * t - t * t);
  v = clamp(v, 0, 1); return v <= 0.5 ? half(v / 0.5) : 1 - half((1 - v) / 0.5);
}
function posterize(v, levels){                                     // adjust.rs:476
  const n = clamp(levels, 2, 255), x = Math.round(clamp(v, 0, 1) * 255), bin = Math.min(Math.floor(x * n / 256), n - 1);
  return Math.floor(bin * 255 / (n - 1)) / 255;
}
function bayer4(x, y){ const M = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; return (M[((y & 3) * 4 + (x & 3))] + 0.5) / 16 - 0.5; }
function gradientAt(stops, t){                                     // adjust.rs:577
  if (!stops.length) return [t, t, t];
  if (stops.length === 1) return stops[0][1];
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 0; i + 1 < stops.length; i++){
    const a = stops[i], b = stops[i + 1];
    if (t <= b[0]){ const k = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0; return [0, 1, 2].map(c => a[1][c] + (b[1][c] - a[1][c]) * k); }
  }
  return stops[stops.length - 1][1];
}
function blackWhiteGray(r, g, b, w){                                // adjust.rs:313
  const max = Math.max(r, g, b), min = Math.min(r, g, b), mid = r + g + b - max - min;
  const primary = (r >= g && r >= b) ? 0 : (g >= b ? 2 : 4);
  const secondary = (b <= r && b <= g) ? 1 : (r <= g ? 3 : 5);
  return clamp(min + (mid - min) * w[secondary] / 100 + (max - mid) * w[primary] / 100, 0, 1);
}
function selectiveColor(c, relative, adj){                         // adjust.rs:382-420
  const max = Math.max(c[0], c[1], c[2]), min = Math.min(c[0], c[1], c[2]), mid = c[0] + c[1] + c[2] - max - min;
  const top = i => c[i] >= max ? max - mid : 0, bottom = i => c[i] <= min ? mid - min : 0;
  const w = [top(0), bottom(2), top(1), bottom(0), top(2), bottom(1), Math.max((min - 0.5) * 2, 0),
             clamp(1 - Math.abs(max - 0.5) - Math.abs(min - 0.5), 0, 1), Math.max((0.5 - max) * 2, 0)];
  const delta = [0, 0, 0];
  for (let r = 0; r < 9; r++){
    if (w[r] <= 0) continue;
    const a = adj[r].map(v => v / 100);
    for (let i = 0; i < 3; i++){ const ink = 1 - c[i], d = relative ? (a[i] + a[3]) * ink : a[i] + a[3]; delta[i] += d * w[r]; }
  }
  return [0, 1, 2].map(i => clamp(c[i] - delta[i], 0, 1));
}
function hueRangeTables(ranges){                                   // adjust.rs:277
  const t = [new Float32Array(LUT_SIZE), new Float32Array(LUT_SIZE), new Float32Array(LUT_SIZE)], act = ranges.filter(r => !rangeNeutral(r));
  for (let k = 0; k < LUT_SIZE; k++){
    const deg = k / (LUT_SIZE - 1) * 360; let a = 0, b = 0, c = 0;
    for (const r of act){ const w = rangeWeight(r, deg); a += w * r.hue; b += w * r.saturation / 100; c += w * r.lightness / 100; }
    t[0][k] = a; t[1][k] = b; t[2][k] = c;
  }
  return t;
}
function hueSat(c, hue, s, l, colorize){                           // adjust.rs:291
  let [hh, ss, ll] = hslOf(c[0], c[1], c[2]);
  if (colorize){ hh = rem(hue, 360) / 360; ss = Math.max(Math.abs(s), 0.25); }
  else { hh = rem(hh + hue / 360, 1); ss = clamp(ss * (1 + s), 0, 1); }
  let o = hslRgb(hh, ss, ll);
  if (l > 0) o = o.map(v => v + (1 - v) * l); else if (l < 0) o = o.map(v => v * (1 + l));
  return o;
}
/* 把调整套到一块直通 RGBA（px：Float32Array 0..1，w 宽，(x0,y0)＝左上角的文件坐标——给仿色用） */
function applyAdjustment(a, px, w, x0, y0){
  const n = px.length / 4;
  const map = f => { for (let i = 0; i < n; i++){ const j = i * 4; if (px[j + 3] <= 0) continue; const o = f(px[j], px[j + 1], px[j + 2]); px[j] = o[0]; px[j + 1] = o[1]; px[j + 2] = o[2]; } };
  switch (a.kind){
    case 'invert': return map((r, g, b) => [1 - r, 1 - g, 1 - b]);
    case 'threshold': { const t = Math.round(a.level * 255); return map((r, g, b) => { const v = Math.round(rgbToGray(r, g, b) * 255) >= t ? 1 : 0; return [v, v, v]; }); }
    case 'posterize': return map((r, g, b) => [posterize(r, a.levels), posterize(g, a.levels), posterize(b, a.levels)]);
    case 'brightnessContrast': {
      if (a.legacy){
        const bb = a.brightness / 255, c = clamp(a.contrast, -100, 99), k = c >= 0 ? 1 / (1 - c / 100) : 1 + c / 100;
        return map((r, g, b) => [r, g, b].map(v => clamp((v - 0.5) * k + 0.5 + bb, 0, 1)));
      }
      return map((r, g, b) => [r, g, b].map(v => clamp(modernContrast(modernBrightness(v, a.brightness), a.contrast), 0, 1)));
    }
    case 'exposure': {                                             // 线性光（RGB 文件用纯 2.2 次方，adjust.rs:36 for_exposure）
      const m = Math.pow(2, a.exposure), g = Math.max(a.gamma, 0.01), dec = v => Math.pow(Math.max(v, 0), 2.2), enc = v => Math.pow(Math.max(v, 0), 1 / 2.2);
      return map((r, gg, b) => [r, gg, b].map(v => clamp(enc(Math.pow(Math.max(dec(v) * m + a.offset, 0), 1 / g)), 0, 1)));
    }
    case 'levels': case 'curves': { const L = toneLuts(a); return map((r, g, b) => [lutAt(L[0], r), lutAt(L[1], g), lutAt(L[2], b)]); }
    case 'hueSaturation': {
      const tab = (!a.colorize && a.ranges.some(r => !rangeNeutral(r))) ? hueRangeTables(a.ranges) : null;
      return map((r, g, b) => {
        let dh = 0, ds = 0, dl = 0;
        if (tab){ const h0 = hslOf(r, g, b)[0], chroma = Math.min((Math.max(r, g, b) - Math.min(r, g, b)) * 4, 1);
          dh = lutAt(tab[0], h0) * chroma; ds = lutAt(tab[1], h0) * chroma; dl = lutAt(tab[2], h0) * chroma; }
        return hueSat([r, g, b], a.hue + dh, clamp(a.saturation / 100 + ds, -1, 1), clamp(a.lightness / 100 + dl, -1, 1), a.colorize);
      });
    }
    case 'vibrance': { const v = a.vibrance / 100, s = a.saturation / 100;
      return map((r, g, b) => { const [h, sat, l] = hslOf(r, g, b), boost = v * (1 - sat); return hslRgb(h, clamp(sat * (1 + s) + boost * Math.max(sat, 0.1), 0, 1), l); }); }
    case 'channelMixer': { const M = a.matrix, mix = (row, r, g, b) => clamp(row[0] * r + row[1] * g + row[2] * b + row[3], 0, 1);
      return map((r, g, b) => a.mono ? [mix(M[0], r, g, b), mix(M[0], r, g, b), mix(M[0], r, g, b)] : [mix(M[0], r, g, b), mix(M[1], r, g, b), mix(M[2], r, g, b)]); }
    case 'photoFilter': return map((r, g, b) => {
      const c = [r, g, b], f = c.map((v, i) => v * (1 - a.density) + v * a.color[i] * a.density);
      if (!a.preserve) return f;
      const l0 = rgbToGray(r, g, b), l1 = Math.max(rgbToGray(f[0], f[1], f[2]), 1e-6);
      return f.map(v => clamp(v * l0 / l1, 0, 1));
    });
    case 'blackWhite': return map((r, g, b) => { const gg = blackWhiteGray(r, g, b, a.weights);
      return a.tint ? a.tint.map(t => clamp(gg * t * 2, 0, 1) * 0.5 + gg * 0.5) : [gg, gg, gg]; });
    case 'gradientMap': {
      for (let i = 0; i < n; i++){
        const j = i * 4; if (px[j + 3] <= 0) continue;
        let t = rgbToGray(px[j], px[j + 1], px[j + 2]); if (a.reverse) t = 1 - t;
        let o = gradientAt(a.stops, t);
        if (a.dither){ const d = bayer4(x0 + i % w, y0 + Math.floor(i / w)) / 255; o = o.map(v => clamp(v + d, 0, 1)); }
        px[j] = o[0]; px[j + 1] = o[1]; px[j + 2] = o[2];
      }
      return;
    }
    case 'colorBalance': return map((r, g, b) => {
      const c = [r, g, b], l = rgbToGray(r, g, b), ws = clamp(1 - l * 2, 0, 1), wh = clamp(l * 2 - 1, 0, 1), wm = 1 - ws - wh;
      const out = c.map((v, i) => clamp(v + (a.shadows[i] * ws + a.midtones[i] * wm + a.highlights[i] * wh) / 100 * 0.5, 0, 1));
      if (!a.preserve) return out;
      const l1 = Math.max(rgbToGray(out[0], out[1], out[2]), 1e-6); return out.map(v => clamp(v * l / l1, 0, 1));
    });
    case 'selectiveColor': return map((r, g, b) => selectiveColor([r, g, b], a.relative, a.adj));
    case 'colorLookup': {
      if (!a.lut || a.size < 2 || a.lut.length < a.size ** 3 * 3) return;    // 没表＝原样（adjust.rs:214）
      for (let i = 0; i < n; i++){
        const j = i * 4; if (px[j + 3] <= 0) continue;
        let o = lut3d(a.lut, a.size, [px[j], px[j + 1], px[j + 2]], a.tetra);
        if (a.dither){ const d = bayer4(x0 + i % w, y0 + Math.floor(i / w)) / 255; o = o.map(v => clamp(v + d, 0, 1)); }
        px[j] = o[0]; px[j + 1] = o[1]; px[j + 2] = o[2];
      }
      return;
    }
  }
}

/* ═══════════ 图层像素读写＋选区覆盖度（pixels.rs adjust_surface 的混回方式） ═══════════ */
function rectBytes(s, W, H){                                       // 没载 SelMask 时的退路：矩形覆盖度
  const out = new Uint8Array(W * H);
  const x0 = Math.min(s.x, s.x + s.w), x1 = Math.max(s.x, s.x + s.w), y0 = Math.min(s.y, s.y + s.h), y1 = Math.max(s.y, s.y + s.h);
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++){
    const ox = Math.max(0, Math.min(x + 1, x1) - Math.max(x, x0)), oy = Math.max(0, Math.min(y + 1, y1) - Math.max(y, y0));
    out[y * W + x] = Math.floor(Math.min(1, ox * oy) * 255 + 0.5);
  }
  return out;
}
const selBytes = () => !Doc.sel ? null : (window.SelMask ? SelMask.bytes() : rectBytes(Doc.sel, Doc.width, Doc.height));
/* 选区在「这块图层画布」每格的覆盖度（文件坐标＝图层坐标＋L.x/L.y，铁律④）；没选区回 null */
function coverFor(L, bytes){
  const b = bytes === undefined ? selBytes() : bytes; if (!b) return null;
  const c = L.data.canvas, w = c.width, h = c.height, W = Doc.width, H = Doc.height, ox = Math.round(L.x || 0), oy = Math.round(L.y || 0);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++){ const Y = y + oy; if (Y < 0 || Y >= H) continue;
    for (let x = 0; x < w; x++){ const X = x + ox; if (X >= 0 && X < W) out[y * w + x] = b[Y * W + X] / 255; } }
  return out;
}
/* 读一层像素成直通 RGBA 浮点、交给 fn 改、再按选区覆盖度混回（pixels.rs:11-32） */
function editLayerPixels(L, fn){
  const c = L.data.canvas, w = c.width, h = c.height; if (!w || !h) return;
  const img = L.data.ctx.getImageData(0, 0, w, h), d = img.data, N = w * h;
  const px = new Float32Array(N * 4); for (let i = 0; i < N * 4; i++) px[i] = d[i] / 255;
  const orig = px.slice();
  fn(px, w, h, Math.round(L.x || 0), Math.round(L.y || 0));
  const cov = coverFor(L);
  for (let i = 0; i < N; i++){
    const k = cov ? cov[i] : 1; if (k <= 0) continue;
    const j = i * 4;
    for (let c2 = 0; c2 < 4; c2++){ const o = orig[j + c2]; d[j + c2] = Math.round(clamp(o + (px[j + c2] - o) * k, 0, 1) * 255); }
  }
  L.data.ctx.putImageData(img, 0, 0);
}
function targetLayer(p, cmd){
  const L = (p && p.layerId) ? Doc.byId(p.layerId) : Doc.active();
  if (!L) bad(cmd, 'no active layer');
  if (L.kind !== 'raster') bad(cmd, 'active layer is a ' + L.kind + ' layer, not a pixel layer');
  return L;
}

/* ═══════════ 模糊（fxutil.rs gauss_blur_n：三次盒状逼近高斯；blur.rs gaussian_kernel） ═══════════ */
function gaussBoxRadii(sigma){                                     // fxutil.rs:165（Kovesi 2010）
  const n = 3, wIdeal = Math.sqrt(12 * sigma * sigma / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl -= 1; wl = Math.max(wl, 1);
  const wu = wl + 2, m = clamp(Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)), 0, n);
  return [0, 1, 2].map(i => i < m ? (wl - 1) / 2 : (wu - 1) / 2);
}
function gaussBlur1(buf, w, h, sigma){                             // 单通道
  if (sigma < 0.3) return;
  const rr = gaussBoxRadii(sigma), sc = new Float64Array(Math.max(w, h));
  const pass = (len, count, get, set) => r => {
    if (r === 0) return; const norm = 1 / (2 * r + 1);
    for (let q = 0; q < count; q++){
      for (let i = 0; i < len; i++) sc[i] = get(q, i);
      const at = i => sc[i < 0 ? 0 : i >= len ? len - 1 : i];
      let acc = 0; for (let i = -r; i <= r; i++) acc += at(i);
      for (let i = 0; i < len; i++){ set(q, i, acc * norm); acc += at(i + r + 1) - at(i - r); }
    }
  };
  rr.forEach(pass(w, h, (y, x) => buf[y * w + x], (y, x, v) => { buf[y * w + x] = v; }));
  rr.forEach(pass(h, w, (x, y) => buf[y * w + x], (x, y, v) => { buf[y * w + x] = v; }));
}
function gaussianKernel(sigma){
  if (sigma < 0.05) return [1];
  const r = Math.ceil(sigma * 3), k = []; for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const s = k.reduce((a, b) => a + b, 0); return k.map(v => v / s);
}
/* sharpen.rs:26 unsharp（预乘卷积、画布外当透明；只改颜色、alpha 不动） */
function unsharp(px, w, h, amount, radius){
  const k = gaussianKernel(radius), r = (k.length - 1) / 2, kk = amount / 100, N = w * h;
  const pm = new Float32Array(N * 4); for (let i = 0; i < N; i++){ const a = px[i * 4 + 3]; pm[i * 4] = px[i * 4] * a; pm[i * 4 + 1] = px[i * 4 + 1] * a; pm[i * 4 + 2] = px[i * 4 + 2] * a; pm[i * 4 + 3] = a; }
  const tmp = new Float32Array(N * 4), bl = new Float32Array(N * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++){ let s = 0; for (let t = -r; t <= r; t++){ const xx = x + t; if (xx >= 0 && xx < w) s += pm[(y * w + xx) * 4 + c] * k[t + r]; } tmp[(y * w + x) * 4 + c] = s; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++){ let s = 0; for (let t = -r; t <= r; t++){ const yy = y + t; if (yy >= 0 && yy < h) s += tmp[(yy * w + x) * 4 + c] * k[t + r]; } bl[(y * w + x) * 4 + c] = s; }
  for (let i = 0; i < N; i++){
    const j = i * 4, a = px[j + 3]; if (a <= 0) continue;
    const ba = bl[j + 3];
    for (let c = 0; c < 3; c++){ const b = ba > 1e-7 ? bl[j + c] / ba : 0, o = px[j + c]; px[j + c] = o + kk * (o - b); }
  }
}

/* ═══════════ algo/src/tone.rs ═══════════ */
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
function blurredLuma(px, w, h, radius){ const N = w * h, l = new Float32Array(N); for (let i = 0; i < N; i++) l[i] = luma(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); gaussBlur1(l, w, h, Math.max(radius, 0) / 2); return l; }
const SH_DEFAULT = {shadowAmount:35, shadowTone:50, shadowRadius:30, highlightAmount:0, highlightTone:50, highlightRadius:30, color:20, midtone:0, blackClip:0.01, whiteClip:0.01};
function shadowsHighlightsParams(p){                               // adjust_cmds.rs:228
  const d = SH_DEFAULT, n = (k, lo, hi) => clamp(isNum(p[k]) ? p[k] : d[k], lo, hi);
  return {shadowAmount:n('shadowAmount', 0, 100), shadowTone:n('shadowTone', 0, 100), shadowRadius:n('shadowRadius', 0, 2500), highlightAmount:n('highlightAmount', 0, 100),
          highlightTone:n('highlightTone', 0, 100), highlightRadius:n('highlightRadius', 0, 2500), color:n('color', -100, 100), midtone:n('midtone', -100, 100),
          blackClip:n('blackClip', 0, 50), whiteClip:n('whiteClip', 0, 50)};
}
function shadowsHighlights(px, w, h, p){                           // tone.rs:71
  const N = w * h; if (!N) return;
  const ls = blurredLuma(px, w, h, p.shadowRadius), lh = Math.abs(p.highlightRadius - p.shadowRadius) < 1e-3 ? ls : blurredLuma(px, w, h, p.highlightRadius);
  const sa = p.shadowAmount / 100, ha = p.highlightAmount / 100, st = Math.max(p.shadowTone / 100, 0.01), ht = Math.max(p.highlightTone / 100, 0.01), color = p.color / 100, mid = p.midtone / 100;
  for (let i = 0; i < N; i++){
    const j = i * 4; if (px[j + 3] <= 0) continue;
    let out = [px[j], px[j + 1], px[j + 2]];
    const ms = 1 - smoothstep(0, st, ls[i]), mh = smoothstep(1 - ht, 1, lh[i]);
    if (sa > 0 && ms > 0){ const g = 1 / (1 + 2 * sa * ms); out = out.map(v => Math.pow(Math.max(v, 0), g)); }
    if (ha > 0 && mh > 0){ const g = 1 / (1 + 2 * ha * mh); out = out.map(v => 1 - Math.pow(1 - Math.min(v, 1), g)); }
    if (mid !== 0){ const k = 1 + mid * clamp(1 - ms - mh, 0, 1); out = out.map(v => (v - 0.5) * k + 0.5); }
    const changed = Math.min(ms * sa + mh * ha, 1);
    if (color !== 0 && changed > 0){ const l1 = luma(out[0], out[1], out[2]), s = 1 + color * changed; out = out.map(v => l1 + (v - l1) * s); }
    px[j] = clamp(out[0], 0, 1); px[j + 1] = clamp(out[1], 0, 1); px[j + 2] = clamp(out[2], 0, 1);
  }
  clipStretch(px, p.blackClip, p.whiteClip);
}
function clipStretch(px, black, white){                            // tone.rs:120
  if (black <= 0 && white <= 0) return;
  const hist = new Uint32Array(1024); let n = 0; const N = px.length / 4;
  for (let i = 0; i < N; i++){ const j = i * 4; if (px[j + 3] <= 0) continue; hist[Math.round(clamp(luma(px[j], px[j + 1], px[j + 2]), 0, 1) * 1023)]++; n++; }
  if (!n) return;
  const find = (pct, rev) => { const target = Math.floor(clamp(pct, 0, 50) / 100 * n); let acc = 0;
    for (let k = 0; k < 1024; k++){ const i = rev ? 1023 - k : k; acc += hist[i]; if (acc > target) return i / 1023; } return rev ? 0 : 1; };
  const lo = find(black, false), hi = find(white, true); if (hi - lo < 1e-3) return;
  for (let i = 0; i < N; i++){ const j = i * 4; if (px[j + 3] <= 0) continue; for (let c = 0; c < 3; c++) px[j + c] = clamp((px[j + c] - lo) / (hi - lo), 0, 1); }
}
function replaceColor(px, color, fuzz, hue, sat, light){            // tone.rs:160 ＋ selection.rs:434 color_range
  const f = Math.max(fuzz, 0) + 1, N = px.length / 4, mask = new Float32Array(N);
  for (let i = 0; i < N; i++){
    const j = i * 4; if (px[j + 3] <= 0) continue;
    const d = Math.max(Math.abs(px[j] - color[0]), Math.abs(px[j + 1] - color[1]), Math.abs(px[j + 2] - color[2])) * 255;
    const k = clamp(1 - d / f, 0, 1); mask[i] = k; if (k <= 0) continue;
    const c = [px[j], px[j + 1], px[j + 2]], [hh, ss, ll] = hsl2Of(c[0], c[1], c[2]);
    const s = sat >= 0 ? ss + (1 - ss) * sat / 100 : ss * (1 + sat / 100), l = light >= 0 ? ll + (1 - ll) * light / 100 : ll * (1 + light / 100);
    const o = hsl2Rgb(rem(hh + hue / 360, 1), clamp(s, 0, 1), clamp(l, 0, 1));
    for (let q = 0; q < 3; q++) px[j + q] = clamp(c[q] + (o[q] - c[q]) * k, 0, 1);
  }
  return mask;
}
function labStats(px, mask){                                       // tone.rs:186
  const sum = [0, 0, 0], sq = [0, 0, 0]; let ws = 0; const N = px.length / 4;
  for (let i = 0; i < N; i++){
    const w = px[i * 4 + 3] * (mask ? (mask[i] || 0) : 1); if (w <= 0) continue;
    const lab = srgbToLab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    for (let k = 0; k < 3; k++){ sum[k] += w * lab[k]; sq[k] += w * lab[k] * lab[k]; }
    ws += w;
  }
  if (ws <= 0) return null;
  const mean = sum.map(s => s / ws);
  return {mean, std:[0, 1, 2].map(k => Math.sqrt(Math.max(sq[k] / ws - Math.pow(sum[k] / ws, 2), 0)))};
}
function matchColor(px, target, source, o){                        // tone.rs:232
  const src = source || target, lum = o.luminance / 100, inten = o.intensity / 100, fade = clamp(o.fade / 100, 0, 1);
  const scale = k => target.std[k] > 1e-4 ? src.std[k] / target.std[k] : 1;
  const dst = src.mean.slice(); if (o.neutralize){ dst[1] = 0; dst[2] = 0; }
  const s0 = scale(0), s1 = scale(1), s2 = scale(2), N = px.length / 4;
  for (let i = 0; i < N; i++){
    const j = i * 4; if (px[j + 3] <= 0) continue;
    const c = [px[j], px[j + 1], px[j + 2]], lab = srgbToLab(c[0], c[1], c[2]);
    const l = ((lab[0] - target.mean[0]) * s0 + dst[0]) * lum, a = ((lab[1] - target.mean[1]) * s1 + dst[1]) * inten, b = ((lab[2] - target.mean[2]) * s2 + dst[2]) * inten;
    const out = labToSrgb(clamp(l, 0, 100), a, b);
    for (let q = 0; q < 3; q++) px[j + q] = clamp(out[q] + (c[q] - out[q]) * fade, 0, 1);
  }
}
const HDR_DEFAULT = {radius:30, strength:0.5, gamma:1, exposure:0, detail:30, shadow:0, highlight:0, vibrance:0, saturation:20};
function hdrToning(px, w, h, p){                                   // tone.rs:317
  const N = w * h; if (!N) return;
  const EPS = 1e-4, logl = new Float32Array(N);
  for (let i = 0; i < N; i++) logl[i] = Math.log(Math.max(luma(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]), 0) + EPS);
  const base = logl.slice(); gaussBlur1(base, w, h, Math.max(p.radius, 1) / 2);
  let n = 0, s = 0; for (let i = 0; i < N; i++) if (px[i * 4 + 3] > 0){ n++; s += base[i]; }
  const mean = s / Math.max(n, 1), compress = 1 / (1 + Math.max(p.strength, 0)), detail = 1 + p.detail / 100, exposure = Math.pow(2, p.exposure), gamma = clamp(p.gamma, 0.1, 4);
  const curve = (p.curve || []).slice().sort((a, b) => a[0] - b[0]);
  const curveEval = x => {
    if (curve.length < 2) return x; if (x <= curve[0][0]) return curve[0][1];
    for (let i = 0; i + 1 < curve.length; i++){ const a = curve[i], b = curve[i + 1]; if (x <= b[0]) return a[1] + (b[1] - a[1]) * (x - a[0]) / Math.max(b[0] - a[0], 1e-6); }
    return curve[curve.length - 1][1];
  };
  for (let i = 0; i < N; i++){
    const j = i * 4; if (px[j + 3] <= 0) continue;
    const c = [px[j], px[j + 1], px[j + 2]], l0 = Math.max(luma(c[0], c[1], c[2]), 0) + EPS;
    const nl = mean + (base[i] - mean) * compress + (logl[i] - base[i]) * detail;
    let l1 = Math.pow(Math.max(Math.exp(nl) * exposure, 0), gamma);
    l1 += p.shadow / 100 * Math.pow(1 - l1, 3) * 0.5 - p.highlight / 100 * Math.pow(l1, 3) * 0.5;
    l1 = curveEval(clamp(l1, 0, 1));
    let out = c.map(v => v * l1 / l0);
    const ll = luma(out[0], out[1], out[2]), mx = Math.max(...out), mn = Math.min(...out), satNow = mx > 0 ? (mx - mn) / mx : 0;
    const sf = 1 + p.saturation / 100 + p.vibrance / 100 * (1 - satNow);
    out = out.map(v => ll + (v - ll) * Math.max(sf, 0));
    px[j] = clamp(out[0], 0, 1); px[j + 1] = clamp(out[1], 0, 1); px[j + 2] = clamp(out[2], 0, 1);
  }
}

/* ═══════════ 自动色调／对比度／颜色（edit_cmds.rs:217-322） ═══════════ */
function selBounds(){                                               // 选区 content_bounds（有覆盖的整格，floor／ceil）∩ 画布
  const s = Doc.sel; if (!s) return [0, 0, Doc.width, Doc.height];
  const b = [Math.max(0, Math.floor(Math.min(s.x, s.x + s.w))), Math.max(0, Math.floor(Math.min(s.y, s.y + s.h))),
             Math.min(Doc.width, Math.ceil(Math.max(s.x, s.x + s.w))), Math.min(Doc.height, Math.ceil(Math.max(s.y, s.y + s.h)))];
  return b;
}
function layerHistograms(L, area){                                  // edit_cmds.rs:218 histograms（8 位、透明格不算；超过 4M 格抽样）
  const h = [new Float64Array(256), new Float64Array(256), new Float64Array(256)];
  const c = L.data.canvas, ox = Math.round(L.x || 0), oy = Math.round(L.y || 0);
  const x0 = Math.max(area[0] - ox, 0), y0 = Math.max(area[1] - oy, 0), x1 = Math.min(area[2] - ox, c.width), y1 = Math.min(area[3] - oy, c.height);
  if (x1 <= x0 || y1 <= y0) return h;
  const step = Math.max(1, Math.floor((area[2] - area[0]) * (area[3] - area[1]) / 4000000)), st = Math.max(1, Math.floor(Math.sqrt(step)));
  const d = L.data.ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data, w = x1 - x0;
  for (let y = 0; y < y1 - y0; y += st) for (let x = 0; x < w; x += st){ const j = (y * w + x) * 4; if (!d[j + 3]) continue; h[0][d[j]]++; h[1][d[j + 1]]++; h[2][d[j + 2]]++; }
  return h;
}
function clipPoints(h, clip){                                      // edit_cmds.rs:237
  const total = h.reduce((a, b) => a + b, 0); if (!total) return [0, 1];
  const lim = Math.floor(total * clip);
  let acc = 0, lo = 0; while (lo < 254 && acc + h[lo] <= lim){ acc += h[lo]; lo++; }
  acc = 0; let hi = 255; while (hi > lo + 1 && acc + h[hi] <= lim){ acc += h[hi]; hi--; }
  return [lo / 255, hi / 255];
}
function median(h){ const total = h.reduce((a, b) => a + b, 0); let acc = 0; for (let i = 0; i < 256; i++){ acc += h[i]; if (acc * 2 >= total) return i / 255; } return 0.5; }
function autoLevels(L, kind){
  const h = layerHistograms(L, selBounds()), clip = 0.001, per = [LV0(), LV0(), LV0()];
  if (kind === 'contrast'){
    const all = new Float64Array(256); for (const c of h) for (let i = 0; i < 256; i++) all[i] += c[i];
    const [lo, hi] = clipPoints(all, clip); per.forEach(p => { p.inBlack = lo; p.inWhite = hi; });
  } else {
    per.forEach((p, c) => { [p.inBlack, p.inWhite] = clipPoints(h[c], clip); });
    if (kind === 'color'){                                           // 中间调中和：每个色版的中位数移到三者平均
      const meds = [0, 1, 2].map(c => median(h[c])), target = (meds[0] + meds[1] + meds[2]) / 3;
      per.forEach((p, c) => {
        const t = clamp((meds[c] - p.inBlack) / Math.max(p.inWhite - p.inBlack, 1e-3), 0.02, 0.98);
        const want = clamp((target - p.inBlack) / Math.max(p.inWhite - p.inBlack, 1e-3), 0.02, 0.98);
        p.gamma = clamp(Math.log(t) / Math.log(want), 0.1, 9.99);
      });
    }
  }
  return {kind:'levels', master:LV0(), per};
}

/* ═══════════ 仿射与几何（canvas_geom.rs；矩阵 [a,b,c,d,e,f]：x' = a·x + c·y + e，y' = b·x + d·y + f，同 rotate.js） ═══════════ */
const Aff = {
  apply(m, p){ return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]; },
  det(m){ return m[0] * m[3] - m[1] * m[2]; },
  lin(m){ return [m[0], m[1], m[2], m[3], 0, 0]; }
};
function mappedBox(m, r){
  const c = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].map(p => Aff.apply(m, p));
  return [Math.min(...c.map(p => p[0])), Math.min(...c.map(p => p[1])), Math.max(...c.map(p => p[0])), Math.max(...c.map(p => p[1]))];
}
/* canvas_geom.rs:213-234 Turn：像素对应（整格）与连续座标的仿射 */
const TURNS = {
  flipCanvasHorizontal:(w, h) => [-1, 0, 0, 1, w, 0],
  flipCanvasVertical:(w, h) => [1, 0, 0, -1, 0, h],
  '180':(w, h) => [-1, 0, 0, -1, w, h],
  '90cw':(w, h) => [0, 1, -1, 0, h, 0],
  '90ccw':(w, h) => [0, -1, 1, 0, 0, w]
};
const BG_NAMES = (() => { const s = new Set(['背景', 'Background']); try { Object.values(I18N).forEach(d => { if (d && d['layer.bg']) s.add(d['layer.bg']); }); } catch (_){} return s; })();
/* 他们的「背景」层＝最底下、名叫 Background、锁透明；我们没有锁 ⇒ 最底下一层像素层、名字是三语的「背景」 */
const isBackground = (L, i) => i === 0 && L.kind === 'raster' && BG_NAMES.has(L.name);

/* 一张像素画布（图层或遮罩）整个过仿射 m（文件坐标）。mode：nearest（整格对应，90°／翻转用，像素一格不差）| bilinear | bicubic */
function remapCanvasObj(o, m, mode){
  const c = o.data.canvas, ox = o.x || 0, oy = o.y || 0;
  const b = mappedBox(m, [ox, oy, ox + c.width, oy + c.height]);
  const nx0 = Math.floor(b[0] + 1e-6), ny0 = Math.floor(b[1] + 1e-6), nx1 = Math.ceil(b[2] - 1e-6), ny1 = Math.ceil(b[3] - 1e-6);
  const n = newCanvas(nx1 - nx0, ny1 - ny0), x = n.ctx;
  x.setTransform(m[0], m[1], m[2], m[3], m[0] * ox + m[2] * oy + m[4] - nx0, m[1] * ox + m[3] * oy + m[5] - ny0);
  if (mode === 'nearest') x.imageSmoothingEnabled = false;
  else { x.imageSmoothingEnabled = true; x.imageSmoothingQuality = mode === 'bilinear' ? 'low' : 'high'; }
  x.drawImage(c, 0, 0);
  x.setTransform(1, 0, 0, 1, 0, 0);
  o.data = n; o.x = nx0; o.y = ny0;
}
/* 像素层画布至少要盖住整份文件（我们的画布有边界，他们的 Surface 没有；文件变大后要能在新区域画）
   单纯像素层不再撑成整张文件（engine.js LayerBox：要画到画布外的工具／命令动手前会自己长大）——只剩蒙版／调整／填充层这些跟文件对齐的走这里 */
function ensureCover(L){
  const c = L.data.canvas, W = Doc.width, H = Doc.height;
  const x0 = Math.min(L.x, 0), y0 = Math.min(L.y, 0), x1 = Math.max(L.x + c.width, W), y1 = Math.max(L.y + c.height, H);
  if (x0 === L.x && y0 === L.y && x1 - x0 === c.width && y1 - y0 === c.height) return;
  const n = newCanvas(x1 - x0, y1 - y0); n.ctx.drawImage(c, L.x - x0, L.y - y0);
  L.data = n; L.x = x0; L.y = y0;
}
/* 非像素层的像素遮罩：composite() 贴在文件 (0,0)、拉成文件大小 ⇒ 正规化成「文件大小、在原点」（像素层的见 maskToLayerFrame） */
function normalizeMask(M, white){
  if (!M || M.kind !== 'raster') return;
  const n = newCanvas(Doc.width, Doc.height); pasteMask(n, M.data.canvas, M.x || 0, M.y || 0, white);
  M.data = n; M.x = 0; M.y = 0; Layer.invalidate(M);
}
/* 文字层没有变形矩阵 ⇒ 要旋转／翻转／不等比缩放时先就地点阵化（同 id，换成像素层；跟 layer.rasterize 同一种画法） */
function rasterizeInPlace(L){
  if (L.kind === 'raster') return;
  const n = newCanvas(Doc.width, Doc.height); n.ctx.drawImage(renderLayer(L, 1), 0, 0);
  L.kind = 'raster'; L.data = n; L.x = 0; L.y = 0; Layer.invalidate(L);
}
/* 矢量形状过线性 m（图层坐标；平移部分已挪到 L.x/L.y）——照 rotate.js rotTransformShape 的分法：能留活形状就留，不行才转成路径 */
function transformShape(L, s, m, opts){
  const E = 1e-9, ap = p => Aff.apply(m, p), k = Math.sqrt(Math.abs(Aff.det(m)));
  if (typeof window.rotTransformedAngle === 'function' && s.bboxAngle){ const a = rotTransformedAngle(+s.bboxAngle || 0, m); if (a) s.bboxAngle = a; else delete s.bboxAngle; }
  if (opts && opts.scaleStrokes && typeof s.strokeWidth === 'number' && Math.abs(k - 1) > 1e-9) s.strokeWidth *= k;
  if (window.GradientFill){ GradientFill.transform(s.fill, m); GradientFill.transform(s.stroke, m); }
  const axisMap = (Math.abs(m[1]) < E && Math.abs(m[2]) < E) || (Math.abs(m[0]) < E && Math.abs(m[3]) < E);
  const kx = Math.hypot(m[0], m[1]), ky = Math.hypot(m[2], m[3]);
  const rectOk = s.type !== 'rect' || !((s.radius || 0) > 0) || Math.abs(kx - ky) < 1e-9;
  const det = Aff.det(m);
  const simRot = Math.abs(m[0] - m[3]) < E && Math.abs(m[1] + m[2]) < E && det > 0;
  const simRef = Math.abs(m[0] + m[3]) < E && Math.abs(m[1] - m[2]) < E && det < 0;
  if ((s.type === 'rect' || s.type === 'ellipse') && axisMap && rectOk){
    const p0 = ap([s.x, s.y]), p1 = ap([s.x + s.w, s.y + s.h]);
    if (s.type === 'rect' && (s.radius || 0) > 0) s.radius *= kx;
    s.x = Math.min(p0[0], p1[0]); s.y = Math.min(p0[1], p1[1]); s.w = Math.abs(p1[0] - p0[0]); s.h = Math.abs(p1[1] - p0[1]);
  } else if ((s.type === 'star' || s.type === 'polygon') && (simRot || simRef)){
    const c = ap([s.cx, s.cy]); s.cx = c[0]; s.cy = c[1];
    if (typeof s.r1 === 'number') s.r1 *= kx; if (typeof s.r2 === 'number') s.r2 *= kx;
    // 顶点角 φ → 旋转：φ+θ；镜像（矩阵＝k·[cosθ′ sinθ′; sinθ′ −cosθ′]）：θ′−φ ⇒ 新 rotation＝θ′−rotation+180（drawShape 的 rotation 从朝上起算）
    const th = Math.atan2(m[1], m[0]) * 180 / Math.PI;
    let r = simRot ? (s.rotation || 0) + th : th - (s.rotation || 0) + 180;
    r = rem(r, 360); if (Math.abs(r - 360) < 1e-9 || Math.abs(r) < 1e-9) r = 0;
    s.rotation = r;
  } else if (s.type === 'path' || s.type === 'line'){
    s.points = (s.points || []).map(ap);
  } else if (s.type === 'mesh' && s.mesh){
    // 网格点存图层坐标、把手是相对位移（只吃线性部分；m 本来就没有平移）
    s.mesh.points.forEach(q => { const p = ap([q.x, q.y]); q.x = p[0]; q.y = p[1]; if (Array.isArray(q.handles)) q.handles = q.handles.map(h => h ? ap(h) : h); });
  } else {
    if (s.type !== 'bezier' && !(window.VecSel && VecSel.ensureBezier(L, s))) return false;
    s.anchors = (s.anchors || []).map(a => { const p = ap([a.x, a.y]); return Object.assign({}, a, {x:p[0], y:p[1], in:a.in ? ap(a.in) : null, out:a.out ? ap(a.out) : null}); });
  }
  return true;
}
/* 矢量层过仿射 m（文件坐标）：文件点＝形状(图层坐标)＋L ⇒ 形状吃线性部分、L 吃整个仿射 */
function transformVectorLayer(L, m, opts){
  const lin = Aff.lin(m);
  L.data.shapes.forEach(s => transformShape(L, s, lin, opts));
  const p = Aff.apply(m, [L.x || 0, L.y || 0]); L.x = p[0]; L.y = p[1];
  Layer.invalidate(L);
}
/* 文字层等比缩放（图像大小）：锚点、字级、段落框一起缩 */
function scaleTextLayer(L, sx, sy){
  const d = L.data, k = (sx + sy) / 2;
  L.x *= sx; L.y *= sy; d.x *= sx; d.y *= sy; d.size *= k;
  if (d.box){ d.box.x *= sx; d.box.y *= sy; d.box.w *= sx; d.box.h *= sy; }
  Layer.invalidate(L);
}

/* 选区随几何走：先拍文件大小的覆盖度，事后过同一个仿射画进新文件大小（canvas_geom.rs remap／image_cmds.rs resize_surface Bilinear／translate） */
function selSnapshot(){ return Doc.sel ? {W:Doc.width, H:Doc.height, bytes:selBytes()} : null; }
function selApply(snap, m, smoothSel){
  if (!snap){ Doc.sel = null; return; }
  const src = newCanvas(snap.W, snap.H), img = src.ctx.createImageData(snap.W, snap.H);
  for (let i = 0; i < snap.bytes.length; i++){ img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = snap.bytes[i]; }
  src.ctx.putImageData(img, 0, 0);
  const W = Doc.width, H = Doc.height, dst = newCanvas(W, H);
  dst.ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  dst.ctx.imageSmoothingEnabled = !!smoothSel; if (smoothSel) dst.ctx.imageSmoothingQuality = 'low';
  dst.ctx.drawImage(src.canvas, 0, 0);
  const d = dst.ctx.getImageData(0, 0, W, H).data, out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = d[i * 4 + 3];
  if (window.SelMask) Doc.sel = SelMask.fromBytes(out);
  else { let x0 = W, y0 = H, x1 = -1, y1 = -1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (out[y * W + x]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
    Doc.sel = x1 < 0 ? null : {x:x0, y:y0, w:x1 + 1 - x0, h:y1 + 1 - y0}; }
}
/* 一次「整份文件的几何」：layerFn 动各层 → 改文件尺寸 → 像素层补盖住、遮罩正规化 → 选区跟着同一个仿射 */
/* 像素层的像素蒙版贴在该层自己的画布上（engine composite／移动工具／链接蒙版同一套）。
   几何运算前先换成文件座标（M.x/M.y＝蒙版左上在文件里的位置）让 layerFn 照文件座标搬；运算后再贴回「该层画布大小、在该层原点」。 */
const layerFrameMask = L => L.kind === 'raster' && L.mask && L.mask.kind === 'raster';
/* 取消链接的蒙版贴在 maskAnchor（文件座标·ps-layer2 pixelMaskCanvas）⇒ 几何运算照它换算、运算后 maskAnchor 跟着搬（蒙版画布保原尺寸） */
const maskUnlinked = L => L.maskLinked === false && Array.isArray(L.maskAnchor);
const maskOrigin = L => maskUnlinked(L) ? L.maskAnchor : [L.x || 0, L.y || 0];
/* PS：图层蒙版有「预设色」（显示全部＝白、隐藏全部＝黑），画布长大／裁切往外扩时新长出来的地方照它填。
   我们没存预设色 ⇒ 看原蒙版四边：多半不透明（白）＝补白，否则留透明（＝黑，藏起来） */
function maskEdgeWhite(c){
  const w = c.width, h = c.height; if (!w || !h) return false;
  const x = c.getContext('2d'); let s = 0, n = 0;
  [[0, 0, w, 1], [0, h - 1, w, 1], [0, 0, 1, h], [w - 1, 0, 1, h]].forEach(r => { const d = x.getImageData(r[0], r[1], r[2], r[3]).data; for (let i = 3; i < d.length; i += 4){ s += d[i]; n++; } });
  return n > 0 && s / n > 127;
}
function pasteMask(n, src, dx, dy, white){
  if (white){ n.ctx.fillStyle = '#ffffff'; n.ctx.fillRect(0, 0, n.canvas.width, n.canvas.height); n.ctx.clearRect(dx, dy, src.width, src.height); }
  n.ctx.drawImage(src, dx, dy);
}
/* 蒙版预设色：有存 M.defaultColor（0／255，显示全部／隐藏选区＝255、隐藏全部／显示选区＝0）就照它；旧档没存才退回看四边 */
function maskDefaultWhite(M){
  if (!M) return false;
  if (typeof M.defaultColor === 'number') return M.defaultColor >= 128;
  return !!(M.data && M.data.canvas && maskEdgeWhite(M.data.canvas));
}
/* 预设白的蒙版：几何运算前后各翻一次 alpha（变成「跟预设色差多少」），运算中新长出来／转出来的透明处翻回来就是白（任意角度旋转的四角也对） */
function invertMaskAlpha(M){
  const c = M.data.canvas, w = c.width, h = c.height; if (!w || !h) return;
  const x = c.getContext('2d'), img = x.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4){ d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = 255 - d[i + 3]; }
  x.putImageData(img, 0, 0); Layer.invalidate(M);
}
window.PsMaskFill = {edgeWhite:maskEdgeWhite, white:maskDefaultWhite, invert:invertMaskAlpha};   // tools/crop.js 裁切往外扩、ps-layer2 画布大小共用
function maskToLayerFrame(L, white){
  const M = L.mask;
  if (maskUnlinked(L)){ L.maskAnchor = [M.x || 0, M.y || 0]; M.x = 0; M.y = 0; Layer.invalidate(M); return; }
  const c = L.data.canvas, n = newCanvas(c.width, c.height);
  pasteMask(n, M.data.canvas, (M.x || 0) - L.x, (M.y || 0) - L.y, white);
  M.data = n; M.x = 0; M.y = 0; Layer.invalidate(M);
}
function geomOp(newW, newH, m, smoothSel, layerFn){
  const snap = selSnapshot();
  // 停用中的蒙版（maskOff）也要跟着这次几何运算搬——先暂放回 L.mask 走同一条路、做完再收回停用（旧版不动它·再开蒙版就错位）
  const off = Doc.layers.filter(L => !L.mask && L.maskOff);
  off.forEach(L => { L.mask = L.maskOff; delete L.maskOff; });
  Doc.layers.forEach(L => { if (layerFrameMask(L)){ const o = maskOrigin(L); L.mask.x = (L.mask.x || 0) + o[0]; L.mask.y = (L.mask.y || 0) + o[1]; } });
  // 蒙版预设色（新长出来的地方照填）：预设白的先翻 alpha，整趟当「预设黑」做，做完翻回来
  const white = new Set(); Doc.layers.forEach(L => { const M = L.mask; if (M && M.kind === 'raster' && M.data && M.data.canvas && maskDefaultWhite(M)){ white.add(L); if (typeof M.defaultColor !== 'number') M.defaultColor = 255; invertMaskAlpha(M); } });
  layerFn();
  Doc.width = Math.max(1, Math.round(newW)); Doc.height = Math.max(1, Math.round(newH));
  Doc.layers.forEach(L => { if (L.kind === 'raster' && !(window.LayerBox && LayerBox.plain(L))) ensureCover(L); if (layerFrameMask(L)) maskToLayerFrame(L, false); else if (L.mask) normalizeMask(L.mask, false); if (L.mask && white.has(L) && L.mask.data) invertMaskAlpha(L.mask); });
  off.forEach(L => { if (L.mask){ L.maskOff = L.mask; L.mask = null; } });
  selApply(snap, m, smoothSel);
}
const fitView = () => { try { if (CMD.map['view.fit']) CMD.map['view.fit'].run({}); else if (window.UI && UI.fit) UI.fit(); } catch (_){} };

/* image_cmds.rs:149 translate_doc */
function translateLayers(dx, dy){
  Doc.layers.forEach(L => {
    L.x = (L.x || 0) + dx; L.y = (L.y || 0) + dy; if (L.kind !== 'raster') Layer.invalidate(L);
    if (L.mask){ L.mask.x = (L.mask.x || 0) + dx; L.mask.y = (L.mask.y || 0) + dy; if (L.mask.kind !== 'raster') Layer.invalidate(L.mask); }
  });
}
/* image_cmds.rs:166 crop_doc：删除裁剪像素 ⇒ 像素层只留框内（新画布＝框大小）；遮罩不删只平移（for_each_surface(masks=false)） */
function cropDoc(r, del){
  const [x0, y0, x1, y1] = r, W = x1 - x0, H = y1 - y0;
  geomOp(W, H, [1, 0, 0, 1, -x0, -y0], false, () => {
    Doc.layers.forEach(L => {
      if (L.kind === 'raster' && del){ const n = newCanvas(W, H); n.ctx.drawImage(L.data.canvas, L.x - x0, L.y - y0); L.data = n; L.x = 0; L.y = 0; }
      else { L.x = (L.x || 0) - x0; L.y = (L.y || 0) - y0; if (L.kind !== 'raster') Layer.invalidate(L); }
      if (L.mask){ L.mask.x = (L.mask.x || 0) - x0; L.mask.y = (L.mask.y || 0) - y0; if (L.mask.kind !== 'raster') Layer.invalidate(L.mask); }
    });
  });
}
function alphaBounds(cv, ox, oy){
  const w = cv.width, h = cv.height; if (!w || !h) return null;
  const d = cv.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++){ const row = y * w * 4; for (let x = 0; x < w; x++) if (d[row + x * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; } }
  return x1 < 0 ? null : [x0 + ox, y0 + oy, x1 + 1 + ox, y1 + 1 + oy];
}

/* ═══════════ 重采样（algo/src/resample.rs） ═══════════ */
const RESAMPLE = {
  nearest:{support:0.5, w:x => Math.abs(x) <= 0.5 ? 1 : 0},
  bilinear:{support:1, w:x => Math.max(1 - Math.abs(x), 0)},
  bicubic:{support:2, w:x => { x = Math.abs(x); const a = -0.5; return x < 1 ? (a + 2) * x * x * x - (a + 3) * x * x + 1 : x < 2 ? a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a : 0; }},   // Keys a=−0.5（Catmull-Rom）
  lanczos:{support:3, w:x => { x = Math.abs(x); if (x < 1e-9) return 1; if (x < 3){ const px = Math.PI * x; return 3 * Math.sin(px) * Math.sin(px / 3) / (px * px); } return 0; }}
};
function parseResample(s){ if (s === 'none') return null; if (s === 'nearest' || s === 'nearestNeighbor') return 'nearest'; if (s === 'bilinear') return 'bilinear'; if (s === 'lanczos') return 'lanczos'; if (s === 'preserveDetails') return 'preserveDetails'; return 'bicubic'; }
function taps(d0, d1, scale, filter){                               // resample.rs:75
  const F = RESAMPLE[filter === 'preserveDetails' ? 'lanczos' : filter], stretch = scale < 1 ? 1 / scale : 1, support = F.support * stretch, out = [];
  for (let o = d0; o < d1; o++){
    const u = (o + 0.5) / scale - 0.5;
    if (filter === 'nearest' && scale >= 1){ out.push({start:Math.floor(u + 0.5), w:[1]}); continue; }
    const lo = Math.ceil(u - support), hi = Math.floor(u + support), w = [];
    for (let i = lo; i <= hi; i++) w.push(F.w((i - u) / stretch));
    const s = w.reduce((a, b) => a + b, 0); if (Math.abs(s) > 1e-12) for (let i = 0; i < w.length; i++) w[i] /= s;
    out.push({start:lo, w});
  }
  return out;
}
/* resample.rs:108 resize_surface：一张画布（位移 ox,oy）绕文件原点缩 (sx,sy)，预乘做两道可分离卷积 → {data, x, y} */
function resizeCanvasObj(o, sx, sy, filter){
  const c = o.data.canvas, cw = c.width, ch = c.height, ox = o.x || 0, oy = o.y || 0;
  const dx0 = Math.floor(ox * sx), dy0 = Math.floor(oy * sy), dx1 = Math.ceil((ox + cw) * sx), dy1 = Math.ceil((oy + ch) * sy);
  const dw = dx1 - dx0, dh = dy1 - dy0; if (dw <= 0 || dh <= 0) return;
  const src = c.getContext('2d').getImageData(0, 0, cw, ch).data, N = cw * ch, pm = new Float32Array(N * 4);
  for (let i = 0; i < N; i++){ const a = src[i * 4 + 3] / 255; pm[i * 4] = src[i * 4] / 255 * a; pm[i * 4 + 1] = src[i * 4 + 1] / 255 * a; pm[i * 4 + 2] = src[i * 4 + 2] / 255 * a; pm[i * 4 + 3] = a; }
  const hx = taps(dx0, dx1, sx, filter), vy = taps(dy0, dy1, sy, filter);
  const tmp = new Float32Array(ch * dw * 4);
  for (let r = 0; r < ch; r++) for (let x = 0; x < dw; x++){
    const t = hx[x]; let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
    for (let k = 0; k < t.w.length; k++){ const si = t.start + k - ox; if (si < 0 || si >= cw) continue; const j = (r * cw + si) * 4, wt = t.w[k]; a0 += pm[j] * wt; a1 += pm[j + 1] * wt; a2 += pm[j + 2] * wt; a3 += pm[j + 3] * wt; }
    const q = (r * dw + x) * 4; tmp[q] = a0; tmp[q + 1] = a1; tmp[q + 2] = a2; tmp[q + 3] = a3;
  }
  const res = new Float32Array(dw * dh * 4);
  for (let y = 0; y < dh; y++){
    const t = vy[y];
    for (let k = 0; k < t.w.length; k++){
      const rr = t.start + k - oy; if (rr < 0 || rr >= ch) continue; const wt = t.w[k], rowS = rr * dw * 4, rowD = y * dw * 4;
      for (let q = 0; q < dw * 4; q++) res[rowD + q] += tmp[rowS + q] * wt;
    }
  }
  for (let i = 0; i < dw * dh; i++){                                // alpha 夹 0..1、反预乘
    const j = i * 4, a = clamp(res[j + 3], 0, 1); res[j + 3] = a;
    for (let q = 0; q < 3; q++) res[j + q] = a > 1e-7 ? res[j + q] / a : 0;
  }
  if (filter === 'preserveDetails' && (sx > 1 || sy > 1)) unsharp(res, dw, dh, 30, 0.6 * Math.max(sx, sy));   // resample.rs:178 保留细节＝Lanczos＋轻度 USM
  const n = newCanvas(dw, dh), img = n.ctx.createImageData(dw, dh);
  for (let i = 0; i < dw * dh * 4; i++) img.data[i] = Math.round(clamp(res[i], 0, 1) * 255);
  n.ctx.putImageData(img, 0, 0);
  o.data = n; o.x = dx0; o.y = dy0;
}

/* ═══════════ 应用图像／计算（channel_cmds.rs） ═══════════ */
const SEP_MODES = ['normal', 'darken', 'multiply', 'colorBurn', 'linearBurn', 'lighten', 'screen', 'colorDodge', 'linearDodge', 'overlay', 'softLight',
  'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix', 'difference', 'exclusion', 'subtract', 'divide'];
const MODE_LABEL = {linearDodge:'Linear Dodge (Add)', colorBurn:'Color Burn', linearBurn:'Linear Burn', colorDodge:'Color Dodge', softLight:'Soft Light', hardLight:'Hard Light',
  vividLight:'Vivid Light', linearLight:'Linear Light', pinLight:'Pin Light', hardMix:'Hard Mix'};
const normName = s => String(s).toLowerCase().replace(/[ _\-()]/g, '');
function colorBurn(b, s){ return b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min((1 - b) / s, 1); }
function colorDodge(b, s){ return b <= 0 ? 0 : s >= 1 ? 1 : Math.min(b / (1 - s), 1); }
function hardLight(b, s){ if (s <= 0.5) return b * 2 * s; const t = 2 * s - 1; return b + t - b * t; }
function blendChannel(m, cb, cs){                                  // color/src/blend.rs:153
  switch (m){
    case 'darken': return Math.min(cb, cs); case 'multiply': return cb * cs; case 'colorBurn': return colorBurn(cb, cs);
    case 'linearBurn': return Math.max(cb + cs - 1, 0); case 'lighten': return Math.max(cb, cs); case 'screen': return cb + cs - cb * cs;
    case 'colorDodge': return colorDodge(cb, cs); case 'linearDodge': return Math.min(cb + cs, 1); case 'overlay': return hardLight(cs, cb);
    case 'softLight': return cs <= 0.5 ? 2 * cb * cs + cb * cb * (1 - 2 * cs) : 2 * cb * (1 - cs) + Math.sqrt(Math.max(cb, 0)) * (2 * cs - 1);
    case 'hardLight': return hardLight(cb, cs);
    case 'vividLight': return cs <= 0.5 ? colorBurn(cb, 2 * cs) : colorDodge(cb, 2 * (cs - 0.5));
    case 'linearLight': return clamp(cb + 2 * cs - 1, 0, 1);
    case 'pinLight': return cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * cs - 1);
    case 'hardMix': return cb + cs >= 1 - 1e-6 ? 1 : 0;
    case 'difference': return Math.abs(cb - cs); case 'exclusion': return cb + cs - 2 * cb * cs; case 'subtract': return Math.max(cb - cs, 0);
    case 'divide': return cs <= 0 ? (cb <= 0 ? 0 : 1) : Math.min(cb / cs, 1);
    default: return cs;
  }
}
function parseBlending(cmd, p){                                     // channel_cmds.rs:426 Blending::parse
  const name = typeof p.blending === 'string' ? p.blending : 'multiply';
  const scale = clamp(isNum(p.scale) ? p.scale : 1, 1, 2), offset = clamp(isNum(p.offset) ? p.offset : 0, -255, 255) / 255;
  const low = name.toLowerCase();
  if (low === 'add') return (b, t) => clamp((b + t) / scale + offset, 0, 1);
  if (low === 'subtract') return (b, t) => clamp((b - t) / scale + offset, 0, 1);
  const want = normName(name), m = SEP_MODES.find(k => normName(k) === want || normName(MODE_LABEL[k] || k) === want);
  if (!m) bad(cmd, 'unsupported blending `' + name + '`');
  return (b, t) => clamp(blendChannel(m, b, t), 0, 1);
}
/* channel_cmds.rs:453 source_spec：p[key] 或扁平的 <prefix>Document／Layer／Channel／Invert */
function sourceSpec(p, key, prefix){
  if (p[key] !== undefined) return p[key];
  const m = {}; let any = false;
  [['document', 'Document'], ['layer', 'Layer'], ['channel', 'Channel'], ['invert', 'Invert']].forEach(([k, f]) => {
    const v = p[prefix + f]; if (v === undefined || v === null) return;
    if (typeof v === 'string' && (v === '' || (k === 'layer' && v === 'merged'))) return;
    m[k] = v; any = true;
  });
  return any ? m : undefined;
}
/* 一层（或合并的）在整份文件范围的直通 RGBA（native_pixels） */
function docPixels(layerId){
  const W = Doc.width, H = Doc.height, n = newCanvas(W, H);
  if (layerId === undefined || layerId === null || layerId === 'merged') composite(1, n.canvas);
  else {
    const L = Doc.byId(layerId); if (!L) return null;
    if (L.kind === 'raster') n.ctx.drawImage(L.data.canvas, L.x || 0, L.y || 0); else n.ctx.drawImage(renderLayer(L, 1), 0, 0);
  }
  return n.ctx.getImageData(0, 0, W, H).data;
}
/* channel_cmds.rs:389 source（＋ ref_planes／gray_plane）：回一组平面（0..1，文件大小）；gray＝合成成一个亮度平面 */
function sourcePlanes(spec, cmd, gray){
  spec = spec || {};
  if (spec.document !== undefined && spec.document !== null && spec.document !== 0) bad(cmd, 'only this document (0) can be a source');
  const N = Doc.width * Doc.height, ch = spec.channel === undefined ? 'composite' : spec.channel, layer = spec.layer;
  let planes;
  const low = typeof ch === 'string' ? ch.toLowerCase() : ch;
  if (low === 'composite' || low === 'merged' || low === 'rgb' || low === 'red' || low === 'green' || low === 'blue'){
    const d = docPixels(layer); if (!d) bad(cmd, 'no layer ' + layer);
    const P = [0, 1, 2].map(c => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = d[i * 4 + c] / 255; return a; });
    planes = low === 'red' ? [P[0]] : low === 'green' ? [P[1]] : low === 'blue' ? [P[2]] : P;
  } else if (low === 'transparency'){
    const id = (layer !== undefined && layer !== 'merged') ? layer : Doc.activeId, d = docPixels(id); if (!d) bad(cmd, 'transparency needs a layer');
    const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = d[i * 4 + 3] / 255; planes = [a];
  } else if (low === 'selection'){
    const b = selBytes(), a = new Float32Array(N); if (b) for (let i = 0; i < N; i++) a[i] = b[i] / 255; planes = [a];
  } else bad(cmd, 'unknown `channel` (composite|red|green|blue|transparency|selection; we have no alpha channels)');
  if (gray && planes.length === 3){ const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = rgbToGray(planes[0][i], planes[1][i], planes[2][i]); planes = [a]; }
  if (spec.invert === true) planes.forEach(pl => { for (let i = 0; i < N; i++) pl[i] = 1 - pl[i]; });
  return planes;
}
function maskPlane(p, cmd){
  const m = sourceSpec(p, 'mask', 'mask');
  if (m === undefined || m === null || m === false) return null;
  if (m.channel === undefined || m.channel === 'none') return null;
  return sourcePlanes(m, cmd, true)[0];
}

/* ═══════════ 命令登记 ═══════════ */
/* 可以开对话框的命令：{dialog:true} ⇒ 开对话框（不动文件、不进历史）；其余参数＝直接做（自己记一步历史、可 Ctrl+Z）。
   这类命令登记成 undoable:false 再自己 History.push——不然开对话框也会白记一步（CMD.run 在跑之前就 push）。 */
function wrap(fn){
  return p => { try { return fn(p || {}); } catch (e){ if (e instanceof PsBad) return {ok:false, error:e.message}; throw e; } };
}
function withHistory(fn){
  return p => {
    History.push();
    let r;
    try { r = fn(p); }
    catch (e){ History.restoreInPlace(History.past.pop()); if (e instanceof PsBad) return {ok:false, error:e.message}; throw e; }
    if (r && r.ok === false) History.restoreInPlace(History.past.pop());
    return r;
  };
}
const DIALOGS = {};                                                 // 原码 id → 开对话框的函数（第二段登记）
function reg(id, params, fn, opt){
  opt = opt || {};
  const cid = 'ps.' + id;
  if (opt.dialog){
    const run = opt.undoable === false ? wrap(fn) : withHistory(fn);   // 复制…不动本文件 ⇒ 不记历史
    CMD.reg(cid, {i18n:'', history:true, params:params + '｜{dialog:true}＝开对话框（同点菜单）；直接给参数＝照做、记一步历史（Ctrl+Z 可退）', undoable:false},
      p => { p = p || {}; if (p.dialog){ const q = Object.assign({}, p); delete q.dialog; return openDialog(id, q); } return run(p); });
  } else CMD.reg(cid, {i18n:'', params, undoable:opt.undoable !== false}, wrap(fn));
}
function openDialog(id, init){
  const f = DIALOGS[id]; if (!f) return {ok:false, error:'no dialog for ' + id};
  f(init || {}); return {ok:true, dialog:'opened'};
}

/* ── 调整（commands.rs:837-934 一张表生成 ＋ destructive_adjust） ── */
const ADJ = [
  ['brightnessContrast', '{"brightness":-150..150=0,"contrast":-50..100=0,"legacy":bool=false}'],
  ['levels', '{"inBlack":0..253=0,"gamma":0.01..9.99=1,"inWhite":2..255=255,"outBlack":0..255=0,"outWhite":0..255=255,"red":json,"green":json,"blue":json} (top level = composite; per channel {"inBlack","gamma","inWhite","outBlack","outWhite"} under red/green/blue or gray)'],
  ['curves', '{"points":json,"red":json,"green":json,"blue":json} (curves as [[in,out],…] in 0..255, 2..19 points: points = composite; red/green/blue per channel; gray = composite; pencil mode (PS 用铅笔绘制曲线): a channel may instead be {"pencil":[256 outputs 0..255]}; "preset":"default|colorNegative|crossProcess|darker|increaseContrast|lighter|linearContrast|mediumContrast|negative|strongContrast" = PS built-in preset as base)'],
  ['exposure', '{"exposure":-20..20=0,"offset":-0.5..0.5=0,"gamma":0.01..9.99=1}'],
  ['vibrance', '{"vibrance":-100..100=0,"saturation":-100..100=0}'],
  ['hueSaturation', '{"hue":-180..180=0,"saturation":-100..100=0,"lightness":-100..100=0,"colorize":bool=false,"reds":json,"yellows":json,"greens":json,"cyans":json,"blues":json,"magentas":json} (per range {"hue","saturation","lightness","range":[4 hue degrees]}; colorize: hue 0..360, saturation 0..100)'],
  ['colorBalance', '{"shadows":json,"midtones":json,"highlights":json,"preserveLuminosity":bool=true} (each tone [cyan-red, magenta-green, yellow-blue] in -100..100)'],
  ['blackWhite', '{"reds":-200..300=40,"yellows":-200..300=60,"greens":-200..300=40,"cyans":-200..300=60,"blues":-200..300=20,"magentas":-200..300=80,"tint":bool=false,"tintColor":"#rrggbb"}'],
  ['photoFilter', '{"filter":"warming85|warmingLBA|warming81|cooling80|coolingLBB|cooling82|red|orange|yellow|green|cyan|blue|violet|magenta|sepia|deepRed|deepBlue|deepEmerald|deepYellow|underwater","color":"#rrggbb","density":0..100=25,"preserveLuminosity":bool=true}'],
  ['channelMixer', '{"red":json,"green":json,"blue":json,"gray":json,"monochrome":bool=false} (per output channel [red %, green %, blue %, constant %] in -200..200; gray = the monochrome mix)'],
  ['invert', '{}'],
  ['posterize', '{"levels":2..255=4}'],
  ['threshold', '{"level":1..255=128}'],
  ['gradientMap', '{"stops":json,"reverse":bool=false,"dither":bool=false} (stops [[location 0..1, "#rrggbb"], …], 2..64)'],
  ['selectiveColor', '{"method":"relative|absolute"="relative","colors":"reds|yellows|greens|cyans|blues|magentas|whites|neutrals|blacks"="reds","cyan":-100..100=0,"magenta":-100..100=0,"yellow":-100..100=0,"black":-100..100=0,"reds":json} (per-range [c,m,y,k] arrays: reds yellows greens cyans blues magentas whites neutrals blacks)'],
  ['colorLookup', '{"lut":"none|warm|cool|tealOrange|bleachBypass|fadedFilm|dayForNight|monoContrast|crossProcess"="none","interpolation":"trilinear|tetrahedral"="trilinear","dither":bool=false,"data":text,"fileName":text} (data: the .cube file text)']
];
const LAYER_NOTE = '；作用在目前像素层（或 layerId），有选区＝按覆盖度只改选区内';
/* 所有「改目前像素层像素」的东西都经这里：命令与对话框预览共用（预览＝同一个函数跑在图层上） */
const PIXEL_OPS = {};
ADJ.forEach(([kind]) => { PIXEL_OPS['image.adjustments.' + kind] = (L, p) => { const a = fromParams(kind, p, null); editLayerPixels(L, (px, w, h, x0, y0) => applyAdjustment(a, px, w, x0, y0)); return {ok:true, params:toParams(a)}; }; });
PIXEL_OPS['image.adjustments.desaturate'] = L => { const a = fromParams('hueSaturation', {saturation:-100}, null); editLayerPixels(L, (px, w) => applyAdjustment(a, px, w, 0, 0)); return {ok:true}; };
PIXEL_OPS['image.adjustments.shadowsHighlights'] = (L, p) => { const sh = shadowsHighlightsParams(p); editLayerPixels(L, (px, w, h) => shadowsHighlights(px, w, h, sh)); return {ok:true}; };
PIXEL_OPS['image.adjustments.replaceColor'] = (L, p) => {          // adjust_cmds.rs:244
  const c = p.color !== undefined && p.color !== null ? colorOf('image.adjustments.replaceColor', 'color', p.color) : fgColor();
  const n = (k, d, lo, hi) => clamp(isNum(p[k]) ? p[k] : d, lo, hi);
  const f = n('fuzziness', 40, 0, 200), h = n('hue', 0, -180, 180), s = n('saturation', 0, -100, 100), l = n('lightness', 0, -100, 100);
  editLayerPixels(L, px => replaceColor(px, c, f, h, s, l)); return {ok:true};
};
PIXEL_OPS['image.adjustments.matchColor'] = (L, p) => {             // adjust_cmds.rs:270
  const cmd = 'image.adjustments.matchColor', n = (k, d, lo, hi) => clamp(isNum(p[k]) ? p[k] : d, lo, hi);
  const o = {luminance:n('luminance', 100, 1, 200), intensity:n('intensity', 100, 1, 200), fade:n('fade', 0, 0, 100), neutralize:p.neutralize === true};
  let source = null;
  if (isNum(p.source) && p.source >= 0){
    if (p.source !== 0) bad(cmd, 'no document ' + p.source + ' (only this document, 0, is open)');
    const lid = p.sourceLayer === undefined || p.sourceLayer === null || p.sourceLayer === 'merged' ? null : p.sourceLayer;
    const d = docPixels(lid); if (!d) bad(cmd, 'no layer ' + p.sourceLayer);
    const N = Doc.width * Doc.height, px = new Float32Array(N * 4); for (let i = 0; i < N * 4; i++) px[i] = d[i] / 255;
    let mask = null; if (p.useSelectionInSource === true && Doc.sel){ const b = selBytes(); mask = new Float32Array(N); for (let i = 0; i < N; i++) mask[i] = b[i] / 255; }
    source = labStats(px, mask); if (!source) bad(cmd, 'the source has no opaque pixels');
  }
  const useT = p.useSelectionInTarget === true, cov = useT ? coverFor(L) : null;
  editLayerPixels(L, px => { const t = labStats(px, cov); if (t) matchColor(px, t, source, o); });
  return {ok:true};
};
PIXEL_OPS['image.adjustments.equalize'] = L => {                    // extra_cmds.rs:156 ＋ map_pixels：直方图只算选区覆盖到的不透明格
  editLayerPixels(L, (px, w, h, x0, y0) => {
    // map_pixels 的 area＝选区外框∩画布（没选区＝画布）：画布外藏着的像素不算也不改
    const cov = coverFor(L), hist = new Float64Array(256), N = w * h, K = new Float32Array(N);
    for (let i = 0; i < N; i++){ const X = x0 + i % w, Y = y0 + Math.floor(i / w); K[i] = (X >= 0 && X < Doc.width && Y >= 0 && Y < Doc.height) ? (cov ? cov[i] : 1) : 0; }
    for (let i = 0; i < N; i++) if (K[i] > 0 && px[i * 4 + 3] > 0) for (let c = 0; c < 3; c++) hist[Math.round(clamp(px[i * 4 + c], 0, 1) * 255)]++;
    const total = hist.reduce((a, b) => a + b, 0); if (!total) return;
    const first = hist.find(v => v > 0) || 0, lut = new Float32Array(256); let acc = 0;
    for (let i = 0; i < 256; i++){ acc += hist[i]; lut[i] = total > first ? clamp((acc - first) / (total - first), 0, 1) : i / 255; }
    for (let i = 0; i < N; i++) if (K[i] > 0) for (let c = 0; c < 3; c++) px[i * 4 + c] = lut[Math.round(clamp(px[i * 4 + c], 0, 1) * 255)];
  });
  return {ok:true};
};
['autoTone', 'autoContrast', 'autoColor'].forEach(k => {
  PIXEL_OPS['image.' + k] = L => { const a = autoLevels(L, k === 'autoTone' ? 'tone' : k === 'autoContrast' ? 'contrast' : 'color');
    editLayerPixels(L, (px, w) => applyAdjustment(a, px, w, 0, 0)); return {ok:true, levels:toParams(a)}; };
});
PIXEL_OPS['image.applyImage'] = (L, p) => {                         // channel_cmds.rs:1339
  const cmd = 'image.applyImage', blend = parseBlending(cmd, p), opacity = clamp(isNum(p.opacity) ? p.opacity : 100, 0, 100) / 100, preserve = p.preserveTransparency === true;
  const src = sourcePlanes(sourceSpec(p, 'source', 'source') || {}, cmd, false), mask = maskPlane(p, cmd), sb = selBytes();
  const W = Doc.width, H = Doc.height, c = L.data.canvas, ox = Math.round(L.x || 0), oy = Math.round(L.y || 0);
  const x0 = Math.max(0, -ox), y0 = Math.max(0, -oy), x1 = Math.min(c.width, W - ox), y1 = Math.min(c.height, H - oy); if (x1 <= x0 || y1 <= y0) return {ok:true};
  const img = L.data.ctx.getImageData(x0, y0, x1 - x0, y1 - y0), d = img.data, w = x1 - x0;
  for (let y = 0; y < y1 - y0; y++) for (let x = 0; x < w; x++){
    const X = x + x0 + ox, Y = y + y0 + oy, i = Y * W + X, j = (y * w + x) * 4;
    let wt = opacity * (mask ? mask[i] : 1) * (sb ? sb[i] / 255 : 1);
    if (preserve) wt *= d[j + 3] / 255;
    if (wt <= 0) continue;
    for (let q = 0; q < 3; q++){ const b = d[j + q] / 255, t = (src[q] || src[0])[i]; d[j + q] = Math.round(clamp(b + (blend(b, t) - b) * wt, 0, 1) * 255); }
    if (!preserve) d[j + 3] = Math.max(d[j + 3], Math.round(wt * 255));   // 透明格被画到就变不透明（他们 apply_image 也这样）
  }
  L.data.ctx.putImageData(img, x0, y0);
  return {ok:true};
};
function runPixelOp(id, p){
  const L = targetLayer(p, id);
  const r = PIXEL_OPS[id](L, p || {});
  Layer.invalidate(L);
  return r;
}
ADJ.forEach(([kind, params]) => {
  const id = 'image.adjustments.' + kind, dlg = kind !== 'invert';
  reg(id, params + LAYER_NOTE, p => runPixelOp(id, p), {dialog:dlg});
});
reg('image.adjustments.desaturate', '{} 去色＝色相/饱和度 饱和度 −100（commands.rs:722）' + LAYER_NOTE, p => runPixelOp('image.adjustments.desaturate', p));
reg('image.adjustments.equalize', '{} 色调均化：R、G、B 三色版合一条累积直方图（只算选区内的不透明格）' + LAYER_NOTE, p => runPixelOp('image.adjustments.equalize', p));
reg('image.adjustments.shadowsHighlights', '{"shadowAmount":0..100=35,"shadowTone":0..100=50,"shadowRadius":0..2500=30,"highlightAmount":0..100=0,"highlightTone":0..100=50,"highlightRadius":0..2500=30,"color":-100..100=20,"midtone":-100..100=0,"blackClip":0..50=0.01,"whiteClip":0..50=0.01}' + LAYER_NOTE,
  p => runPixelOp('image.adjustments.shadowsHighlights', p), {dialog:true});
reg('image.adjustments.replaceColor', '{"color":"#rrggbb"=前景色,"fuzziness":0..200=40,"hue":-180..180=0,"saturation":-100..100=0,"lightness":-100..100=0}' + LAYER_NOTE,
  p => runPixelOp('image.adjustments.replaceColor', p), {dialog:true});
reg('image.adjustments.matchColor', '{"source":0|-1(无)=-1,"sourceLayer":layerId|"merged"="merged","luminance":1..200=100,"intensity":1..200=100,"fade":0..100=0,"neutralize":bool=false,"useSelectionInSource":bool=false,"useSelectionInTarget":bool=false} (source 只有本文件 0；不给＝只用自身统计：中和／明亮度／颜色强度仍作用)' + LAYER_NOTE,
  p => runPixelOp('image.adjustments.matchColor', p), {dialog:true});
reg('image.adjustments.hdrToning', '{"radius":1..500=30,"strength":0.1..4=0.5,"gamma":0.1..2=1,"exposure":-5..5=0,"detail":-100..300=30,"shadow":-100..100=0,"highlight":-100..100=0,"vibrance":-100..100=0,"saturation":-100..100=20,"curve":[[in,out],…] 0..255} 会把整份文件拼合成一层「背景」（同 PS）',
  p => { const h = hdrParams(p); flattenWith((px, w, hh) => hdrToning(px, w, hh, h)); return {ok:true}; }, {dialog:true});
reg('image.adjustments.colorLookup.list', '{} 内建的颜色查找（id、label）', () => LOOKS.map(([id, label]) => ({id, label})), {undoable:false});
['autoTone', 'autoContrast', 'autoColor'].forEach(k => reg('image.' + k, '{} 0.1% 剪裁的自动色阶（edit_cmds.rs:269）' + (k === 'autoContrast' ? '：三色版同一组黑白点（不偏色）' : k === 'autoColor' ? '：各色版各自黑白点＋中间调中和' : '：各色版各自黑白点') + LAYER_NOTE,
  p => runPixelOp('image.' + k, p)));
reg('image.applyImage', '{"source":{"layer":id|"merged"="merged","channel":"composite|red|green|blue|transparency|selection"="composite","invert":bool=false},"blending":"normal|multiply|screen|overlay|softLight|hardLight|colorDodge|colorBurn|darken|lighten|difference|exclusion|linearBurn|linearDodge|vividLight|linearLight|pinLight|hardMix|divide|add|subtract"="multiply","opacity":0..100=100,"scale":1..2=1,"offset":-255..255=0,"preserveTransparency":bool=false,"mask":{"layer","channel","invert"}?,"sourceLayer|sourceChannel|sourceInvert|maskLayer|maskChannel|maskInvert":扁平写法?} 来源只能是本文件（没有别的文件、没有 Alpha 通道）' + LAYER_NOTE,
  p => runPixelOp('image.applyImage', p), {dialog:true});
reg('image.calculations', '{"source1":{"layer","channel","invert"},"source2":{…},"blending":"multiply|…"="multiply","opacity":0..100=100,"scale":1..2=1,"offset":-255..255=0,"mask":{…}?,"result":"selection|newDocument"="selection","name":str?} 源 1 混到源 2 上（灰阶平面）；我们没有通道面板，结果只能是选区或新文件（新视窗）',
  p => calculations(p), {dialog:true});

function hdrParams(p){
  const n = (k, lo, hi) => clamp(isNum(p[k]) ? p[k] : HDR_DEFAULT[k], lo, hi);
  const curve = Array.isArray(p.curve) ? p.curve.filter(v => Array.isArray(v) && isNum(v[0]) && isNum(v[1])).map(v => [v[0] / 255, v[1] / 255]) : [];
  return {radius:n('radius', 1, 500), strength:n('strength', 0.1, 4), gamma:n('gamma', 0.1, 2), exposure:n('exposure', -5, 5), detail:n('detail', -100, 300), shadow:n('shadow', -100, 100),
          highlight:n('highlight', -100, 100), vibrance:n('vibrance', -100, 100), saturation:n('saturation', -100, 100), curve};
}
/* adjust_cmds.rs:321 HDR 色调：拼合（垫白）→ 算 → 文件只剩一层「背景」、选区清掉 */
function flattenedPixels(){
  const W = Doc.width, H = Doc.height, n = newCanvas(W, H);
  n.ctx.fillStyle = '#ffffff'; n.ctx.fillRect(0, 0, W, H); n.ctx.drawImage(composite(1), 0, 0);
  const d = n.ctx.getImageData(0, 0, W, H).data, px = new Float32Array(W * H * 4); for (let i = 0; i < d.length; i++) px[i] = d[i] / 255;
  return px;
}
function pixelsToCanvas(px, W, H){
  const n = newCanvas(W, H), img = n.ctx.createImageData(W, H);
  for (let i = 0; i < px.length; i++) img.data[i] = Math.round(clamp(px[i], 0, 1) * 255);
  n.ctx.putImageData(img, 0, 0); return n;
}
function flattenWith(fn){
  const W = Doc.width, H = Doc.height, px = flattenedPixels(); fn(px, W, H);
  const L = Layer.raster(Lang.t('layer.bg')); L.data = pixelsToCanvas(px, W, H);
  Doc.layers = [L]; Doc.activeId = L.id; Doc.sel = null;
  if (window.VecSel) VecSel.clear();
  return L;
}
function calculations(p){                                           // channel_cmds.rs:1397
  const cmd = 'image.calculations', blend = parseBlending(cmd, p), opacity = clamp(isNum(p.opacity) ? p.opacity : 100, 0, 100) / 100;
  const s1 = sourcePlanes(sourceSpec(p, 'source1', 'source1') || {}, cmd, true)[0], s2 = sourcePlanes(sourceSpec(p, 'source2', 'source2') || {}, cmd, true)[0], mask = maskPlane(p, cmd);
  const N = Doc.width * Doc.height, out = new Float32Array(N);
  for (let i = 0; i < N; i++){ const b = s2[i], t = s1[i]; out[i] = b + (blend(b, t) - b) * opacity * (mask ? mask[i] : 1); }
  const result = typeof p.result === 'string' ? p.result : 'selection';
  if (result === 'selection'){
    const bytes = new Uint8Array(N); for (let i = 0; i < N; i++) bytes[i] = Math.floor(clamp(out[i], 0, 1) * 255 + 0.5);
    if (window.SelMask) Doc.sel = SelMask.fromBytes(bytes); else bad(cmd, 'selection masks need tools/marquee.js');
    return {selected:!!Doc.sel};
  }
  if (result === 'newDocument'){
    const W = Doc.width, H = Doc.height, px = new Float32Array(N * 4);
    for (let i = 0; i < N; i++){ px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = out[i]; px[i * 4 + 3] = 1; }
    const url = pixelsToCanvas(px, W, H).canvas.toDataURL('image/png');
    return openInNewWindow(grayProject(W, H, url), typeof p.name === 'string' ? p.name : 'Untitled');
  }
  if (result === 'newChannel') bad(cmd, 'we have no Channels panel (use result "selection" or "newDocument")');
  bad(cmd, 'unknown result `' + result + '` (selection|newDocument)');
}
function grayProject(W, H, url){ return {format:'dilin-canvas', version:1, createdBy:'堤麟画板', width:W, height:H,
  layers:[{id:'L1', kind:'raster', name:Lang.t('layer.bg'), visible:true, opacity:1, blend:'normal', x:0, y:0, image:url}]}; }

/* ── 图像旋转（commands.rs:707-721 → canvas_geom.rs turn_canvas） ── */
function turnCanvas(key){
  const W = Doc.width, H = Doc.height, m = TURNS[key](W, H), swap = key === '90cw' || key === '90ccw';
  Doc.layers.forEach(L => { if (L.kind === 'text') rasterizeInPlace(L); });       // 文字层没有变形矩阵：先点阵化再整格搬
  geomOp(swap ? H : W, swap ? W : H, m, false, () => {
    Doc.layers.forEach(L => {
      if (L.kind === 'raster') remapCanvasObj(L, m, 'nearest');
      else transformVectorLayer(L, m, {});
      if (L.mask && L.mask.kind === 'raster') remapCanvasObj(L.mask, m, 'nearest');
      else if (L.mask) transformVectorLayer(L.mask, m, {});
    });
  });
  if (swap) fitView();
  return {width:Doc.width, height:Doc.height};
}
[['flipCanvasHorizontal', '水平翻转画布'], ['flipCanvasVertical', '垂直翻转画布'], ['180', '旋转 180°'], ['90cw', '顺时针 90°'], ['90ccw', '逆时针 90°']].forEach(([k, zh]) =>
  reg('image.imageRotation.' + k, '{} ' + zh + '：整份文件（所有图层、遮罩、选区）像素整格搬、矢量形状过同一个仿射；文字层会先点阵化（我们的文字层没有变形矩阵） → {width,height}', () => turnCanvas(k)));

/* ── 任意角度（mode_cmds.rs:47-124） ── */
function rotatedSize(w, h, deg){
  const r = deg * Math.PI / 180, s = Math.sin(r), c = Math.cos(r);
  return [Math.max(Math.ceil(w * Math.abs(c) + h * Math.abs(s) - 1e-6), 1), Math.max(Math.ceil(w * Math.abs(s) + h * Math.abs(c) - 1e-6), 1)];
}
function rotateArbitrary(p){
  const cmd = 'image.rotation.arbitrary', angle = isNum(p.angle) ? p.angle : (p.angle === undefined ? 0 : NaN);
  if (!isFinite(angle) || Math.abs(angle) > 3600) bad(cmd, 'angle out of range');
  const dir = p.direction === undefined ? 'cw' : p.direction;
  if (dir !== 'cw' && dir !== 'ccw') bad(cmd, 'direction `' + dir + '` (cw|ccw)');
  const deg = dir === 'cw' ? angle : -angle;
  if (Math.abs(rem(deg, 360)) < 1e-9) return {width:Doc.width, height:Doc.height};
  const interp = p.interpolation === 'nearest' ? 'nearest' : p.interpolation === 'bilinear' ? 'bilinear' : 'bicubic';
  const W = Doc.width, H = Doc.height, [nw, nh] = rotatedSize(W, H, deg), r = deg * Math.PI / 180, sn = Math.sin(r), cs = Math.cos(r);
  const cx = W / 2, cy = H / 2, nx = nw / 2, ny = nh / 2;
  const a = [cs, sn, -sn, cs, nx - (cs * cx - sn * cy), ny - (sn * cx + cs * cy)];      // 画面顺时针（y 朝下）绕中心
  const bg = bgColor();
  Doc.layers.forEach(L => { if (L.kind === 'text') rasterizeInPlace(L); });
  geomOp(nw, nh, a, true, () => {
    Doc.layers.forEach((L, i) => {
      if (isBackground(L, i)){
        // 背景层仍是背景：转好的像素垫在背景色上（mode_cmds.rs:86-99）
        remapCanvasObj(L, a, interp);
        const base = newCanvas(nw, nh);
        base.ctx.fillStyle = hexOf(bg); base.ctx.fillRect(0, 0, nw, nh); base.ctx.drawImage(L.data.canvas, L.x, L.y);
        L.data = base; L.x = 0; L.y = 0;
      } else if (L.kind === 'raster') remapCanvasObj(L, a, interp);
      else transformVectorLayer(L, a, {});
      if (L.mask && L.mask.kind === 'raster') remapCanvasObj(L.mask, a, interp);
      else if (L.mask) transformVectorLayer(L.mask, a, {});
    });
  });
  fitView();
  return {width:Doc.width, height:Doc.height};
}
reg('image.rotation.arbitrary', '{"angle":-359.99..359.99=0,"direction":"cw|ccw"="cw","interpolation":"bicubic|bilinear|nearest"="bicubic"} 画布长大到装得下；背景层空出来的角填背景色，其余层透明；矢量形状照转（矩形／椭圆转成路径），文字层先点阵化 → {width,height}',
  rotateArbitrary, {dialog:true});

/* ── 图像大小（image_cmds.rs:104 image_size） ── */
function imageSize(p){
  const ow = Doc.width, oh = Doc.height, filter = parseResample(typeof p.resample === 'string' ? p.resample : 'bicubic');
  const pw = isNum(p.width) ? p.width : null, ph = isNum(p.height) ? p.height : null;
  let nw, nh;
  if (pw !== null && ph !== null){ nw = pw; nh = ph; }
  else if (pw !== null){ nw = pw; nh = pw * oh / Math.max(ow, 1); }
  else if (ph !== null){ nw = ph * ow / Math.max(oh, 1); nh = ph; }
  else { nw = ow; nh = oh; }
  nw = clamp(rround(nw), 1, 300000); nh = clamp(rround(nh), 1, 300000);
  if (isNum(p.resolution)) Doc.dpi = clamp(p.resolution, 1, 10000);
  if (!filter) return {width:ow, height:oh, resolution:Doc.dpi || 72};
  const sx = nw / Math.max(ow, 1), sy = nh / Math.max(oh, 1);
  if (Math.abs(sx - 1) < 1e-12 && Math.abs(sy - 1) < 1e-12) return {width:nw, height:nh, resolution:Doc.dpi || 72};
  const m = [sx, 0, 0, sy, 0, 0], uniform = Math.abs(sx - sy) <= 0.02 * Math.max(sx, sy);
  Doc.layers.forEach(L => { if (L.kind === 'text' && !uniform) rasterizeInPlace(L); });    // 文字层不等比缩放没法留活的
  geomOp(nw, nh, m, true, () => {
    Doc.layers.forEach(L => {
      if (L.kind === 'raster') resizeCanvasObj(L, sx, sy, filter);
      else if (L.kind === 'vector') transformVectorLayer(L, m, {scaleStrokes:true});
      else scaleTextLayer(L, sx, sy);
      if (L.mask && L.mask.kind === 'raster') resizeCanvasObj(L.mask, sx, sy, 'bilinear');   // 遮罩一律两次线性（image_cmds.rs:129）
      else if (L.mask && L.mask.kind === 'vector') transformVectorLayer(L.mask, m, {scaleStrokes:true});
      Layer.invalidate(L);
    });
  });
  fitView();
  return {width:nw, height:nh, resolution:Doc.dpi || 72};
}
reg('image.imageSize', '{"width":px,"height":px,"resolution":ppi,"resample":"bicubic|bilinear|nearest|lanczos|preserveDetails|none"="bicubic"} 只给一边＝等比；resample:"none"＝只改分辨率不动像素；所有图层／遮罩／选区重采样，矢量层按比例重算（描边一起缩），文字层等比时缩字级、不等比先点阵化 → {width,height,resolution}',
  imageSize, {dialog:true});

/* ── 画布大小（image_cmds.rs:175-246） ── */
function anchorFactors(a){
  const x = (a.includes('Left') || a === 'left') ? 0 : (a.includes('Right') || a === 'right') ? 1 : 0.5;
  const y = a.startsWith('top') ? 0 : a.startsWith('bottom') ? 1 : 0.5;
  return [x, y];
}
function extensionColor(v){                                         // image_cmds.rs:193
  const s = typeof v === 'string' ? v : 'background';
  if (s === 'foreground') return fgColor().concat(1);
  if (s === 'white') return [1, 1, 1, 1];
  if (s === 'black') return [0, 0, 0, 1];
  if (s === 'transparent') return [0, 0, 0, 0];
  if (s.startsWith('#')){ const h = s.replace(/^#+/, ''); const c = i => { const x = parseInt(h.slice(i, i + 2), 16); return isNaN(x) ? 0 : x / 255; }; return [c(0), c(2), c(4), 1]; }
  return bgColor().concat(1);
}
function canvasSize(p){
  const ow = Doc.width, oh = Doc.height, relative = p.relative === true;
  const w = isNum(p.width) ? p.width : (relative ? 0 : ow), h = isNum(p.height) ? p.height : (relative ? 0 : oh);
  const nw = clamp(rround(relative ? ow + w : w), 1, 300000), nh = clamp(rround(relative ? oh + h : h), 1, 300000);
  const [ax, ay] = anchorFactors(typeof p.anchor === 'string' ? p.anchor : 'center');
  const dx = rround((nw - ow) * ax), dy = rround((nh - oh) * ay), ext = extensionColor(p.extensionColor);
  geomOp(nw, nh, [1, 0, 0, 1, dx, dy], false, () => translateLayers(dx, dy));
  // 背景层用扩展色补新长出来的地方（原本的像素留着）
  const bg = Doc.layers[0];
  if (ext[3] > 0 && bg && isBackground(bg, 0)){
    if (window.LayerBox) LayerBox.ensureCovers(bg, [0, 0, nw, nh]);   // geomOp 不再把单纯像素层撑成整张文件 ⇒ 背景层要补扩展色就先长到盖住新画布
    const c = bg.data.canvas, ctx = bg.data.ctx, ab = alphaBounds(c, bg.x, bg.y);
    const keep = ab ? [Math.max(ab[0], dx), Math.max(ab[1], dy), Math.min(ab[2], dx + ow), Math.min(ab[3], dy + oh)] : null;
    const saved = keep && keep[2] > keep[0] && keep[3] > keep[1] ? ctx.getImageData(keep[0] - bg.x, keep[1] - bg.y, keep[2] - keep[0], keep[3] - keep[1]) : null;
    ctx.clearRect(-bg.x, -bg.y, nw, nh);
    ctx.fillStyle = 'rgba(' + Math.round(ext[0] * 255) + ',' + Math.round(ext[1] * 255) + ',' + Math.round(ext[2] * 255) + ',' + ext[3] + ')';
    ctx.fillRect(-bg.x, -bg.y, nw, nh);
    if (saved) ctx.putImageData(saved, keep[0] - bg.x, keep[1] - bg.y);
  }
  fitView();
  return {width:nw, height:nh, offset:[dx, dy]};
}
reg('image.canvasSize', '{"width":px,"height":px,"relative":bool=false,"anchor":"topLeft|top|topRight|left|center|right|bottomLeft|bottom|bottomRight"="center","extensionColor":"background|foreground|white|black|transparent|#rrggbb"="background"} 只改画布、内容不缩；最底下的「背景」层新长出来的地方填扩展色（背景色＝右面板描边色块），其余层透明 → {width,height,offset}',
  canvasSize, {dialog:true});

/* ── 裁剪／裁切／显示全部（image_cmds.rs:249-308、extra_cmds.rs:593） ── */
const intOf = (p, k) => { const v = p[k]; if (v === undefined || v === null || v === '') return null; const n = Number(v); return isFinite(n) ? rround(n) : null; };
function cropCmd(p){
  const del = typeof p.deleteCroppedPixels === 'boolean' ? p.deleteCroppedPixels : true;
  const x = intOf(p, 'x'), y = intOf(p, 'y'), w = intOf(p, 'width'), h = intOf(p, 'height');
  let r = null;
  if (x !== null && y !== null && w !== null && h !== null && w > 0 && h > 0) r = [x, y, x + w, y + h];      // 明给的可超出画布
  else if (Doc.sel){ const b = selBounds(); if (b[2] > b[0] && b[3] > b[1]) r = b; }                     // 选区外框夹在画布内
  if (!r) bad('image.crop', 'nothing to crop: pass x/y/width/height or make a selection');
  cropDoc(r, del);
  Doc.sel = null;
  fitView();
  return {x:r[0], y:r[1], width:r[2] - r[0], height:r[3] - r[1]};
}
reg('image.crop', '{"x":px,"y":px,"width":px,"height":px,"deleteCroppedPixels":bool=true} 不给矩形＝裁到选区外框；矩形可超出画布（外扩透明）；选区清掉 → {x,y,width,height}', cropCmd);
function trimCmd(p){
  const W = Doc.width, H = Doc.height, d = composite(1).getContext('2d').getImageData(0, 0, W, H).data;
  const based = typeof p.basedOn === 'string' ? p.basedOn : 'transparent';
  const ref = based === 'topLeft' ? 0 : based === 'bottomRight' ? (W * H - 1) * 4 : -1;
  const E = 0.5 / 255;
  const differs = j => {
    if (ref < 0) return d[j + 3] > 0;
    const qa = d[j + 3] / 255, ra = d[ref + 3] / 255;
    for (let c = 0; c < 3; c++) if (Math.abs(d[j + c] / 255 * qa - d[ref + c] / 255 * ra) > E) return true;
    return Math.abs(qa - ra) > E;
  };
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (differs((y * W + x) * 4)){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  if (x1 < 0) bad('image.trim', 'nothing to trim to');
  const side = k => p[k] === undefined ? true : !!p[k];
  const r = [side('left') ? x0 : 0, side('top') ? y0 : 0, side('right') ? x1 + 1 : W, side('bottom') ? y1 + 1 : H];
  cropDoc(r, true);
  fitView();
  return {x:r[0], y:r[1], width:r[2] - r[0], height:r[3] - r[1]};
}
reg('image.trim', '{"basedOn":"transparent|topLeft|bottomRight"="transparent","top":bool=true,"bottom":bool=true,"left":bool=true,"right":bool=true} 按拼合后的画面找边（透明像素／左上角颜色／右下角颜色）→ 裁掉 → {x,y,width,height}', trimCmd, {dialog:true});
function revealAll(){
  let all = [0, 0, Doc.width, Doc.height];
  Doc.layers.forEach(L => { if (L.kind !== 'raster') return; const b = alphaBounds(L.data.canvas, L.x || 0, L.y || 0); if (b) all = [Math.min(all[0], b[0]), Math.min(all[1], b[1]), Math.max(all[2], b[2]), Math.max(all[3], b[3])]; });
  if (all[0] === 0 && all[1] === 0 && all[2] === Doc.width && all[3] === Doc.height) return {changed:false};
  cropCmd({x:all[0], y:all[1], width:all[2] - all[0], height:all[3] - all[1], deleteCroppedPixels:false});
  return {changed:true};
}
reg('image.revealAll', '{} 画布长大到装得下所有像素层的内容（画布外被藏住的像素）→ {changed}', revealAll);

/* ── 复制…（image_cmds.rs:338 duplicate）：我们一页只有一份文件 ⇒ 开新视窗放复本 ── */
const DUP = {};
function openInNewWindow(json, name){
  const key = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  DUP[key] = {json, name};
  const w = window.open(location.pathname + '#psdup=' + key, '_blank');
  if (!w){ delete DUP[key]; return {ok:false, error:'the browser blocked the new window'}; }
  return {ok:true, name, window:key};
}
function duplicate(p){
  const json = Project.serialize();
  const name = typeof p.name === 'string' && p.name ? p.name : (document.title.replace(/\s*—.*$/, '') || 'Untitled') + Lang.t('psimg.copySuffix');
  if (p.mergedOnly === true) Object.assign(json, grayProject(Doc.width, Doc.height, composite(1).toDataURL('image/png')), {width:Doc.width, height:Doc.height});
  return openInNewWindow(json, name);
}
reg('image.duplicate', '{"name":str,"mergedOnly":bool=false} 把整份文件复制到新视窗（mergedOnly＝只要拼合后的一层）；不动本文件 → {ok,name}', duplicate, {dialog:true, undoable:false});
/* 新视窗这一头：网址带 #psdup=… 就向开它的视窗领那份复本载进来 */
window.addEventListener('load', () => {
  const m = /#psdup=([\w]+)/.exec(location.hash); if (!m) return;
  let pay = null; try { pay = window.opener && window.opener.PsImage && window.opener.PsImage._dup[m[1]]; } catch (_){}
  if (!pay) return;
  try { delete window.opener.PsImage._dup[m[1]]; } catch (_){}
  setTimeout(() => {
    Project.load(JSON.parse(JSON.stringify(pay.json))).then(() => { document.title = pay.name + ' — ' + Lang.t('ui.brand'); try { history.replaceState(null, '', location.pathname); } catch (_){} });
  }, 0);
});

/* ═══════════ 三语字串（对话框；繁照 PS 繁中版、简照 PS 简中版） ═══════════ */
const S = (hant, hans, en) => ({'zh-Hant':hant, 'zh-Hans':hans, en});
const STR_ROWS = {
  ok:S('確定', '确定', 'OK'), cancel:S('取消', '取消', 'Cancel'), preview:S('預視', '预览', 'Preview'), auto:S('自動', '自动', 'Auto'),
  copySuffix:S(' 拷貝', ' 拷贝', ' copy'), error:S('無法完成：', '无法完成：', 'Could not complete: '),
  // 图像大小／画布大小（sizing.rs）
  imageSizeInfo:S('影像尺寸：', '图像大小：', 'Image Size:'), was:S('原為', '原为', 'was'), dimensions:S('尺寸：', '尺寸：', 'Dimensions:'),
  width:S('寬度：', '宽度：', 'Width:'), height:S('高度：', '高度：', 'Height:'), resolution:S('解析度：', '分辨率：', 'Resolution:'),
  ppi:S('像素/英寸', '像素/英寸', 'Pixels/Inch'), resample:S('重新取樣', '重新采样', 'Resample'), constrain:S('強制等比例', '约束比例', 'Constrain proportions'),
  rsPreserve:S('保留細節 (放大)', '保留细节（扩大）', 'Preserve Details'), rsBicubic:S('環迴增值法 (平滑漸層)', '两次立方（平滑渐变）', 'Bicubic (smooth gradients)'),
  rsLanczos:S('Lanczos (銳利)', 'Lanczos（锐利）', 'Lanczos (sharp)'), rsBilinear:S('縱橫增值法', '两次线性', 'Bilinear'), rsNearest:S('最接近像素 (硬邊)', '邻近（硬边缘）', 'Nearest Neighbor (hard edges)'),
  uPx:S('像素', '像素', 'Pixels'), uPercent:S('百分比', '百分比', 'Percent'), uIn:S('英寸', '英寸', 'Inches'), uCm:S('公分', '厘米', 'Centimeters'),
  uMm:S('公釐', '毫米', 'Millimeters'), uPt:S('點', '点', 'Points'), uPica:S('Pica', '派卡', 'Picas'),
  currentSize:S('目前尺寸', '当前大小', 'Current Size'), size:S('尺寸：', '大小：', 'Size:'), newSize:S('新尺寸', '新建大小', 'New Size'),
  relative:S('相對', '相对', 'Relative'), anchor:S('錨點：', '定位：', 'Anchor:'), extColor:S('版面擴充顏色：', '画布扩展颜色：', 'Canvas extension color:'),
  foreground:S('前景', '前景', 'Foreground'), background:S('背景', '背景', 'Background'), white:S('白色', '白色', 'White'), black:S('黑色', '黑色', 'Black'),
  transparent:S('透明', '透明', 'Transparent'),
  // 任意角度／裁切／复制
  rotateCanvas:S('旋轉版面', '旋转画布', 'Rotate Canvas'), angle:S('角度：', '角度：', 'Angle:'), cw:S('°順時針', '度顺时针', '°CW'), ccw:S('°逆時針', '度逆时针', '°CCW'),
  interpolation:S('內插補點：', '插值：', 'Interpolation:'), iNearest:S('最接近像素', '邻近', 'Nearest Neighbor'), iBilinear:S('縱橫增值法', '两次线性', 'Bilinear'), iBicubic:S('環迴增值法', '两次立方', 'Bicubic'),
  basedOn:S('根據', '基于', 'Based On'), transparentPx:S('透明像素', '透明像素', 'Transparent Pixels'), topLeftPx:S('左上角像素顏色', '左上角像素颜色', 'Top Left Pixel Color'),
  bottomRightPx:S('右下角像素顏色', '右下角像素颜色', 'Bottom Right Pixel Color'), trimAway:S('修剪掉', '裁切', 'Trim Away'),
  top:S('上', '顶', 'Top'), bottom:S('下', '底', 'Bottom'), left:S('左', '左', 'Left'), right:S('右', '右', 'Right'),
  dupTitle:S('複製影像', '复制图像', 'Duplicate Image'), dupAs:S('為：', '为：', 'As:'), dupMerged:S('僅複製合併圖層', '仅复制合并的图层', 'Duplicate Merged Layers Only'),
  // 调整（adjust_editors.rs）
  brightness:S('亮度', '亮度', 'Brightness'), contrast:S('對比', '对比度', 'Contrast'), useLegacy:S('使用舊版', '使用旧版', 'Use Legacy'),
  channel:S('色版：', '通道：', 'Channel:'), chRGB:S('RGB', 'RGB', 'RGB'), gray:S('灰色', '灰色', 'Gray'), chRed:S('紅', '红', 'Red'), chGreen:S('綠', '绿', 'Green'), chBlue:S('藍', '蓝', 'Blue'),
  inputLevels:S('輸入色階：', '输入色阶：', 'Input Levels:'), outputLevels:S('輸出色階：', '输出色阶：', 'Output Levels:'),
  input:S('輸入：', '输入：', 'Input:'), output:S('輸出：', '输出：', 'Output:'), curveHint:S('按一下加點 · 拖出圖外、Ctrl+按一下或 Delete 刪點', '单击添加点 · 拖出图外、Ctrl+单击或 Delete 删除点', 'Click to add a point · drag off or Ctrl-click or Delete to remove'),
  exposure:S('曝光度', '曝光度', 'Exposure'), offset:S('偏移量', '位移', 'Offset'), gammaCorr:S('Gamma 校正', '灰度系数校正', 'Gamma Correction'),
  vibrance:S('細節飽和度', '自然饱和度', 'Vibrance'), saturation:S('飽和度', '饱和度', 'Saturation'),
  master:S('主檔案', '全图', 'Master'), reds:S('紅色', '红色', 'Reds'), yellows:S('黃色', '黄色', 'Yellows'), greens:S('綠色', '绿色', 'Greens'),
  cyans:S('青色', '青色', 'Cyans'), blues:S('藍色', '蓝色', 'Blues'), magentas:S('洋紅', '洋红', 'Magentas'),
  whites:S('白色', '白色', 'Whites'), neutrals:S('中間色', '中性色', 'Neutrals'), blacks:S('黑色', '黑色', 'Blacks'),
  hue:S('色相', '色相', 'Hue'), lightness:S('明亮', '明度', 'Lightness'), colorize:S('上色', '着色', 'Colorize'), range:S('範圍（°）', '范围（°）', 'Range (°)'),
  tone:S('色調：', '色调：', 'Tone:'), shadows:S('陰影', '阴影', 'Shadows'), midtones:S('中間調', '中间调', 'Midtones'), highlights:S('亮部', '高光', 'Highlights'),
  cyanRed:S('青  ·  紅', '青色  ·  红色', 'Cyan  ·  Red'), magentaGreen:S('洋紅  ·  綠', '洋红  ·  绿色', 'Magenta  ·  Green'), yellowBlue:S('黃  ·  藍', '黄色  ·  蓝色', 'Yellow  ·  Blue'),
  preserveLum:S('保留明度', '保持明度', 'Preserve Luminosity'), tint:S('色調', '色调', 'Tint'), defaults:S('預設', '默认值', 'Default'),
  filter:S('濾鏡：', '滤镜：', 'Filter:'), color:S('顏色：', '颜色：', 'Color:'), density:S('密度', '浓度', 'Density'), custom:S('自訂', '自定', 'Custom'),
  outChannel:S('輸出色版：', '输出通道：', 'Output Channel:'), constant:S('常數', '常数', 'Constant'), total:S('總計：', '总计：', 'Total:'), monochrome:S('單色', '单色', 'Monochrome'),
  levels:S('色階', '色阶', 'Levels'), thresholdLevel:S('臨界值層級', '阈值色阶', 'Threshold Level'),
  preset:S('預設集：', '预设：', 'Preset:'), gmBW:S('黑、白', '黑、白', 'Black, White'), gmFgBg:S('前景到背景', '前景色到背景色', 'Foreground to Background'),
  gmViolet:S('紫、橙', '紫、橙', 'Violet, Orange'), gmBRY:S('藍、紅、黃', '蓝、红、黄', 'Blue, Red, Yellow'), gmCopper:S('紅銅', '铜色', 'Copper'),
  addStop:S('新增色標', '添加色标', 'Add Stop'), removeStop:S('刪除色標', '删除色标', 'Remove stop'), reverse:S('反向', '反向', 'Reverse'), dither:S('混色', '仿色', 'Dither'),
  colors:S('顏色：', '颜色：', 'Colors:'), cyan:S('青色', '青色', 'Cyan'), magenta:S('洋紅', '洋红', 'Magenta'), yellow:S('黃色', '黄色', 'Yellow'), blackInk:S('黑色', '黑色', 'Black'),
  method:S('方法：', '方法：', 'Method:'), relativeM:S('相對', '相对', 'Relative'), absoluteM:S('絕對', '绝对', 'Absolute'),
  lutFile:S('3DLUT 檔案', '3DLUT 文件', '3DLUT File'), none:S('無', '无', 'None'), loadCube:S('載入 .cube…', '载入 .cube…', 'Load .cube…'),
  trilinear:S('三線性', '三线性', 'Trilinear'), tetrahedral:S('四面體', '四面体', 'Tetrahedral'),
  amount:S('總量', '数量', 'Amount'), toneW:S('色調', '色调', 'Tone'), radius:S('強度', '半径', 'Radius'), adjustments:S('調整', '调整', 'Adjustments'),
  colorCorr:S('顏色', '颜色', 'Color'), midtone:S('中間調', '中间调', 'Midtone'), blackClip:S('剪裁黑色 (%)', '修剪黑色（%）', 'Black Clip (%)'), whiteClip:S('剪裁白色 (%)', '修剪白色（%）', 'White Clip (%)'),
  fuzziness:S('朦朧', '颜色容差', 'Fuzziness'), replacement:S('取代', '替换', 'Replacement'),
  luminance:S('明度', '明亮度', 'Luminance'), intensity:S('顏色強度', '颜色强度', 'Color Intensity'), fade:S('淡化', '渐隐', 'Fade'), neutralize:S('中和', '中和', 'Neutralize'),
  source:S('來源：', '源：', 'Source:'), thisDoc:S('此文件', '本文件', 'This document'), layer:S('圖層：', '图层：', 'Layer:'), merged:S('合併', '合并的', 'Merged'),
  useSelSrc:S('使用來源中的選取範圍計算顏色', '使用源选区计算颜色', 'Use Selection in Source to Calculate Colors'), useSelTgt:S('使用目標中的選取範圍計算調整', '使用目标选区计算调整', 'Use Selection in Target to Calculate Adjustment'),
  strength:S('強度', '强度', 'Strength'), gamma:S('Gamma', '灰度系数', 'Gamma'), detail:S('細部', '细节', 'Detail'), shadow:S('陰影', '阴影', 'Shadow'), highlight:S('亮部', '高光', 'Highlight'),
  edgeGlow:S('邊緣光量', '边缘光', 'Edge Glow'), toneDetail:S('色調和細部', '色调和细节', 'Tone and Detail'), advanced:S('進階', '高级', 'Advanced'),
  chComposite:S('RGB', 'RGB', 'RGB'), chTransparency:S('透明度', '透明', 'Transparency'), chSelection:S('選取範圍', '选区', 'Selection'),
  invert:S('負片效果', '反相', 'Invert'), blending:S('混合：', '混合：', 'Blending:'), opacity:S('不透明：', '不透明度：', 'Opacity:'), scale:S('縮放：', '缩放：', 'Scale:'),
  offsetV:S('偏移：', '补偿值：', 'Offset:'), preserveTr:S('保留透明區域', '保留透明区域', 'Preserve Transparency'), target:S('目標：', '目标：', 'Target:'),
  source1:S('來源 1', '源 1', 'Source 1'), source2:S('來源 2', '源 2', 'Source 2'), result:S('結果：', '结果：', 'Result:'), newDocument:S('新增文件', '新建文档', 'New Document'),
  add:S('增加', '相加', 'Add'), subtract:S('減去', '减去', 'Subtract')
};
const MODE_NAMES = {normal:S('正常', '正常', 'Normal'), darken:S('變暗', '变暗', 'Darken'), multiply:S('色彩增值', '正片叠底', 'Multiply'), colorBurn:S('加深顏色', '颜色加深', 'Color Burn'),
  linearBurn:S('線性加深', '线性加深', 'Linear Burn'), lighten:S('變亮', '变亮', 'Lighten'), screen:S('濾色', '滤色', 'Screen'), colorDodge:S('加亮顏色', '颜色减淡', 'Color Dodge'),
  linearDodge:S('線性加亮 (增加)', '线性减淡（添加）', 'Linear Dodge (Add)'), overlay:S('覆蓋', '叠加', 'Overlay'), softLight:S('柔光', '柔光', 'Soft Light'), hardLight:S('實光', '强光', 'Hard Light'),
  vividLight:S('強烈光源', '亮光', 'Vivid Light'), linearLight:S('線性光源', '线性光', 'Linear Light'), pinLight:S('小光源', '点光', 'Pin Light'), hardMix:S('實色疊印混合', '实色混合', 'Hard Mix'),
  difference:S('差異化', '差值', 'Difference'), exclusion:S('排除', '排除', 'Exclusion'), divide:S('分割', '划分', 'Divide')};
const PF_NAMES = {warming85:S('加溫濾鏡 (85)', '加温滤镜 (85)', 'Warming Filter (85)'), warmingLBA:S('加溫濾鏡 (LBA)', '加温滤镜 (LBA)', 'Warming Filter (LBA)'), warming81:S('加溫濾鏡 (81)', '加温滤镜 (81)', 'Warming Filter (81)'),
  cooling80:S('冷卻濾鏡 (80)', '冷却滤镜 (80)', 'Cooling Filter (80)'), coolingLBB:S('冷卻濾鏡 (LBB)', '冷却滤镜 (LBB)', 'Cooling Filter (LBB)'), cooling82:S('冷卻濾鏡 (82)', '冷却滤镜 (82)', 'Cooling Filter (82)'),
  red:S('紅', '红', 'Red'), orange:S('橙', '橙', 'Orange'), yellow:S('黃', '黄', 'Yellow'), green:S('綠', '绿', 'Green'), cyan:S('青', '青', 'Cyan'), blue:S('藍', '蓝', 'Blue'),
  violet:S('紫', '紫', 'Violet'), magenta:S('洋紅', '洋红', 'Magenta'), sepia:S('褐', '深褐', 'Sepia'), deepRed:S('深紅', '深红', 'Deep Red'), deepBlue:S('深藍', '深蓝', 'Deep Blue'),
  deepEmerald:S('深祖母綠', '深祖母绿', 'Deep Emerald'), deepYellow:S('深黃', '深黄', 'Deep Yellow'), underwater:S('水底', '水下', 'Underwater')};
const LOOK_NAMES = {warm:S('暖色濾鏡', '暖色滤镜', 'Warm Filter'), cool:S('冷色濾鏡', '冷色滤镜', 'Cool Filter'), tealOrange:S('青橙', '青橙', 'Teal & Orange'), bleachBypass:S('漂白略過', '漂白旁路', 'Bleach Bypass'),
  fadedFilm:S('褪色底片', '褪色胶片', 'Faded Film'), dayForNight:S('日景夜拍', '日拍夜景', 'Day for Night'), monoContrast:S('高對比單色', '高对比单色', 'Mono High Contrast'), crossProcess:S('交叉沖印', '交叉冲印', 'Cross Process')};
(function addStrings(){
  const out = {'zh-Hant':{}, 'zh-Hans':{}, en:{}};
  const put = (pre, tab) => Object.entries(tab).forEach(([k, v]) => { for (const l of Object.keys(out)) out[l][pre + k] = v[l]; });
  put('psimg.', STR_ROWS); put('psimg.mode.', MODE_NAMES); put('psimg.pf.', PF_NAMES); put('psimg.look.', LOOK_NAMES);
  if (typeof Lang !== 'undefined') Lang.add(out);
})();
const t = k => Lang.t('psimg.' + k);
/* 菜单上的名字（对话框标题用跟菜单同一个字） */
function menuName(id){
  let n = null;
  try { MenuTrees.walk('ps', it => { if (!n && it.id === id && it.n) n = it.n[Lang.cur] || it.n.en; }); } catch (_){}
  return (n || id).replace(/…$/, '');
}

/* ═══════════ 对话框外框（样式注入在这里，不改 style.css） ═══════════ */
const CSS = `
.psimg-bg{position:fixed;inset:0;z-index:9998;background:transparent}
.psimg-dlg{position:fixed;z-index:9999;top:70px;right:280px;min-width:300px;max-width:440px;max-height:calc(100vh - 90px);overflow:auto;background:#2b2f36;color:#e6e8eb;
  border:1px solid #444a54;border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,.5);font:12px sans-serif}
.psimg-dlg .hd{padding:8px 12px;font-weight:bold;cursor:move;background:#323741;border-bottom:1px solid #444a54;user-select:none}
.psimg-dlg .bd{padding:10px 12px}
.psimg-dlg .ft{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid #444a54}
.psimg-dlg .ft .sp{flex:1}
.psimg-dlg button{background:#3a404a;color:#e6e8eb;border:1px solid #555c68;border-radius:3px;padding:3px 12px;cursor:pointer;font:12px sans-serif}
.psimg-dlg button.pri{background:#2f7fd8;border-color:#2f7fd8;color:#fff}
.psimg-dlg .row{display:flex;align-items:center;gap:6px;margin:4px 0}
.psimg-dlg .row>.lb{min-width:96px;color:#aab0ba;text-align:right}
.psimg-dlg .row>.lb.w{min-width:0;text-align:left}
.psimg-dlg input[type=number],.psimg-dlg input[type=text],.psimg-dlg select{background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:2px 4px;font:12px sans-serif}
.psimg-dlg input[type=number]{width:64px}
.psimg-dlg input[type=range]{flex:1;min-width:110px}
.psimg-dlg input[type=color]{width:34px;height:20px;padding:0;border:1px solid #444a54;background:none}
.psimg-dlg .sec{margin:8px 0 2px;color:#e6e8eb;font-weight:bold}
.psimg-dlg .note{color:#7a8290;font-size:11px;margin:4px 0}
.psimg-dlg canvas{display:block;background:#1e2126;border:1px solid #444a54}
.psimg-dlg .anc{display:grid;grid-template-columns:repeat(3,22px);gap:2px}
.psimg-dlg .anc button{width:22px;height:22px;padding:0}
.psimg-dlg .anc button.on{background:#e6e8eb;color:#000}
.psimg-dlg .err{color:#ff8a7a;margin-top:6px}
`;
function injectCSS(){ if (document.getElementById('psImgCss')) return; const s = document.createElement('style'); s.id = 'psImgCss'; s.textContent = CSS; document.head.appendChild(s); }
function el(tag, props, kids){
  const e = document.createElement(tag);
  if (props) Object.entries(props).forEach(([k, v]) => { if (k === 'style') e.style.cssText = v; else if (k === 'data') Object.assign(e.dataset, v); else if (k in e) e[k] = v; else e.setAttribute(k, v); });
  (kids || []).forEach(c => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
}
const fmtNum = (v, step) => { const d = step && step < 1 ? Math.min(4, Math.ceil(-Math.log10(step))) : 0; return String(+Number(v).toFixed(d)); };

const Dlg = {
  cur:null,
  isOpen(){ return !!this.cur; },
  open(o){
    this.cancel();
    injectCSS();
    const bg = el('div', {className:'psimg-bg', id:'psImgDlgBg'});
    const box = el('div', {className:'psimg-dlg', id:'psImgDlg', data:{cmd:'ps.' + o.id}});
    const hd = el('div', {className:'hd'}, [o.title || menuName(o.id)]);
    const bd = el('div', {className:'bd'});
    const ft = el('div', {className:'ft'});
    const cur = this.cur = {o, v:o.v, state:o.state || {}, box, bg, bd, prev:null, previewOn:true, raf:0};
    if (o.preview){
      const cb = el('input', {type:'checkbox', checked:true, data:{k:'__preview'}});
      cb.onchange = () => { cur.previewOn = cb.checked; this.schedule(); };
      ft.appendChild(el('label', {}, [cb, ' ' + t('preview')]));
    }
    ft.appendChild(el('span', {className:'sp'}));
    ft.appendChild(el('button', {type:'button', data:{act:'cancel'}, onclick:() => this.cancel()}, [t('cancel')]));
    ft.appendChild(el('button', {type:'button', className:'pri', data:{act:'ok'}, onclick:() => this.ok()}, [t('ok')]));
    box.appendChild(hd); box.appendChild(bd); box.appendChild(ft);
    box.addEventListener('keydown', e => {
      if (e.key === 'Escape'){ e.preventDefault(); this.cancel(); }
      else if (e.key === 'Enter' && !/textarea/i.test(e.target.tagName) && !(e.target.tagName === 'BUTTON')){ e.preventDefault(); if (e.target.blur) e.target.blur(); this.ok(); }
      e.stopPropagation();                                          // 对话框里打字不给 ui.js 的快捷键
    });
    // 拖标题移动对话框（预览时把它挪开看画面）
    hd.addEventListener('pointerdown', e => {
      const r = box.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      const mv = ev => { box.style.left = (r.left + ev.clientX - sx) + 'px'; box.style.top = (r.top + ev.clientY - sy) + 'px'; box.style.right = 'auto'; };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    document.body.appendChild(bg); document.body.appendChild(box);
    this.render();
    if (o.preview) this.beginPreview();
    const first = bd.querySelector('input,select'); if (first && first.focus) first.focus();
    return box;
  },
  render(){
    const c = this.cur; if (!c) return;
    const sy = c.bd.scrollTop; c.bd.innerHTML = '';
    c.o.build(makeUI(c.bd, this), c.v, c.state);
    c.bd.scrollTop = sy;
  },
  changed(rebuild){ if (rebuild) this.render(); this.schedule(); },
  schedule(){
    const c = this.cur; if (!c || !c.o.preview) return;
    if (c.raf) cancelAnimationFrame(c.raf);
    c.raf = requestAnimationFrame(() => { c.raf = 0; this.runPreview(); });
  },
  params(){ const c = this.cur; return c.o.params ? c.o.params(c.v, c.state) : JSON.parse(JSON.stringify(c.v)); },
  /* 预览：照 adjust_dialog.rs「同一条命令跑在目标上」——跑同一个像素函数在图层上，不进历史；关掉对话框就还原 */
  beginPreview(){
    const c = this.cur, kind = c.o.preview;
    if (kind === 'layer'){
      const L = Doc.active(); if (!L || L.kind !== 'raster') return;
      const snap = newCanvas(L.data.canvas.width, L.data.canvas.height); snap.ctx.drawImage(L.data.canvas, 0, 0);
      c.prev = {kind, L, snap};
    } else if (kind === 'flatten') c.prev = {kind, layers:Doc.layers.slice(), activeId:Doc.activeId, sel:Doc.sel};
    this.runPreview();
  },
  restorePreview(){
    const p = this.cur && this.cur.prev; if (!p) return;
    if (p.kind === 'layer'){ const x = p.L.data.ctx; x.clearRect(0, 0, p.L.data.canvas.width, p.L.data.canvas.height); x.drawImage(p.snap.canvas, 0, 0); Layer.invalidate(p.L); }
    else { Doc.layers = p.layers.slice(); Doc.activeId = p.activeId; Doc.sel = p.sel; }
  },
  runPreview(){
    const c = this.cur; if (!c || !c.prev) return;
    this.restorePreview();
    c.err = null;
    if (c.previewOn){
      try {
        const prm = this.params();
        if (c.prev.kind === 'layer'){ PIXEL_OPS[c.o.id](c.prev.L, prm); Layer.invalidate(c.prev.L); }
        else { const h = hdrParams(prm), W = Doc.width, H = Doc.height, px = flattenedPixels(); hdrToning(px, W, H, h);
          const tmp = Layer.raster(Lang.t('layer.bg')); tmp.data = pixelsToCanvas(px, W, H); Doc.layers = [tmp]; Doc.activeId = tmp.id; }
      } catch (e){ c.err = e.message; }
    }
    if (window.UI) UI.draw();
  },
  close(){
    const c = this.cur; if (!c) return;
    if (c.raf) cancelAnimationFrame(c.raf);
    c.box.remove(); c.bg.remove(); this.cur = null;
  },
  ok(){
    const c = this.cur; if (!c) return null;
    let prm; try { prm = this.params(); } catch (e){ prm = null; }
    this.restorePreview(); this.close();
    if (!prm) return null;
    let r;
    try { r = CMD.run('ps.' + c.o.id, prm); } catch (e){ console.error(e); r = {ok:false, error:String(e && e.message || e)}; }
    if (r && r.ok === false) toast(t('error') + (r.error || ''));
    if (window.UI) UI.refresh();
    return r;
  },
  cancel(){
    if (!this.cur) return;
    this.restorePreview(); this.close();
    if (window.UI) UI.refresh();
  }
};
function toast(msg){
  const d = el('div', {style:'position:fixed;left:50%;top:60px;transform:translateX(-50%);z-index:10000;background:#5a2a2a;color:#fff;padding:6px 14px;border-radius:4px;font:12px sans-serif', data:{psimgToast:'1'}}, [msg]);
  document.body.appendChild(d); setTimeout(() => d.remove(), 3500);
}
/* 对话框外的键（画布、菜单）在对话框开着时一律不给：Esc＝取消、Enter＝确定 */
window.addEventListener('keydown', e => {
  const c = Dlg.cur; if (!c || c.box.contains(e.target)) return;
  if (e.key === 'Escape') Dlg.cancel(); else if (e.key === 'Enter') Dlg.ok();
  e.preventDefault(); e.stopPropagation();
}, true);

/* 控件小工具：每个控件都带 data-k（测试与 agent 照这个找），改了就叫 Dlg.changed */
function makeUI(root, D){
  const add = n => { root.appendChild(n); return n; };
  const row = (label, nodes, wide) => add(el('div', {className:'row'}, [el('span', {className:'lb' + (wide ? ' w' : '')}, [label || ''])].concat(nodes)));
  const num = (k, val, min, max, step, on) => {
    const n = el('input', {type:'number', min, max, step:step || 1, value:fmtNum(val, step), data:{k}});
    n.addEventListener('input', () => { const x = Number(n.value); if (n.value !== '' && isFinite(x)) on(clamp(x, min, max)); });
    n.addEventListener('change', () => { const x = Number(n.value); if (isFinite(x)) { const v = clamp(x, min, max); n.value = fmtNum(v, step); on(v); } });
    return n;
  };
  const ui = {
    root, add, row,
    sec(text){ return add(el('div', {className:'sec'}, [text])); },
    note(text){ return add(el('div', {className:'note'}, [text])); },
    /* 滑杆＋数字框（adjust_editors.rs sliders／slider_row） */
    slider({k, label, min, max, step, get, set, unit, rebuild}){
      const st = step || 1, r = el('input', {type:'range', min, max, step:st, value:get(), data:{k}});
      const n = num(k, get(), min, max, st, v => { set(v); r.value = v; D.changed(rebuild); });
      r.addEventListener('input', () => { const v = Number(r.value); set(v); n.value = fmtNum(v, st); D.changed(rebuild); });
      return row(label, unit ? [r, n, el('span', {}, [unit])] : [r, n]);
    },
    sl(v, k, label, min, max, step, unit){ return this.slider({k, label, min, max, step, unit, get:() => v[k], set:x => { v[k] = x; }}); },
    number({k, label, min, max, step, get, set, rebuild, after}){ return row(label, [num(k, get(), min, max, step, x => { set(x); D.changed(rebuild); })].concat(after || [])); },
    check({k, label, get, set, rebuild, disabled}){
      const c = el('input', {type:'checkbox', checked:!!get(), disabled:!!disabled, data:{k}});
      c.onchange = () => { set(c.checked); D.changed(rebuild); };
      return row('', [el('label', {}, [c, ' ' + label])]);
    },
    select({k, label, options, get, set, rebuild, disabled}){
      const s = el('select', {disabled:!!disabled, data:{k}});
      options.forEach(([val, text]) => s.appendChild(el('option', {value:String(val), selected:String(get()) === String(val)}, [text])));
      s.onchange = () => { const o = options.find(x => String(x[0]) === s.value); set(o ? o[0] : s.value); D.changed(rebuild); };
      return row(label, [s]);
    },
    radio({k, label, options, get, set, rebuild}){
      const nodes = options.map(([val, text]) => { const r = el('input', {type:'radio', name:'psimg_' + k, value:String(val), checked:String(get()) === String(val), data:{k}});
        r.onchange = () => { if (r.checked){ set(val); D.changed(rebuild); } }; return el('label', {style:'margin-right:8px'}, [r, ' ' + text]); });
      return row(label, nodes);
    },
    color({k, label, get, set, disabled}){
      const c = el('input', {type:'color', value:get(), disabled:!!disabled, data:{k}});
      c.addEventListener('input', () => { set(c.value); D.changed(); });
      return row(label, [c]);
    },
    text({k, label, get, set}){ const x = el('input', {type:'text', value:get(), style:'width:200px', data:{k}}); x.addEventListener('input', () => { set(x.value); D.changed(); }); return row(label, [x]); },
    button(text, fn, k){ const b = el('button', {type:'button', data:{k:k || ''}}, [text]); b.onclick = () => { fn(); }; return b; },
    canvas(w, h, k){ const c = el('canvas', {width:w, height:h, data:{k}}); c.style.width = w + 'px'; c.style.height = h + 'px'; return c; }
  };
  return ui;
}

/* ── 直方图（tone::histograms 的 8 位版：目前图层不透明的格；复合＝亮度） ── */
function layerHist(){
  const L = Doc.active(), H = [0, 1, 2, 3].map(() => new Uint32Array(256));
  if (!L || L.kind !== 'raster') return H;
  const d = L.data.ctx.getImageData(0, 0, L.data.canvas.width, L.data.canvas.height).data;
  for (let j = 0; j < d.length; j += 4){ if (!d[j + 3]) continue; H[1][d[j]]++; H[2][d[j + 1]]++; H[3][d[j + 2]]++; H[0][Math.round(rgbToGray(d[j], d[j + 1], d[j + 2]))]++; }
  return H;
}
function drawHist(cv, h, color, marks){
  const x = cv.getContext('2d'), W = cv.width, Hh = cv.height; x.clearRect(0, 0, W, Hh);
  let mx = 0; for (let i = 0; i < 256; i++) mx = Math.max(mx, h[i]);
  x.fillStyle = color || '#8a909a';
  if (mx > 0) for (let i = 0; i < 256; i++){ const v = h[i] / mx * (Hh - 2); x.fillRect(i * W / 256, Hh - v, Math.ceil(W / 256), v); }
  (marks || []).forEach(([v, c]) => { x.strokeStyle = c; x.beginPath(); x.moveTo(v / 255 * W + 0.5, 0); x.lineTo(v / 255 * W + 0.5, Hh); x.stroke(); });
}
/* adjust_editors.rs:640 auto_levels：两头各剪 0.1% */
function autoLevelsHist(h){
  const total = h.reduce((a, b) => a + b, 0), clip = Math.floor(total / 1000);
  let acc = 0, lo = 0; while (lo < 253 && acc + h[lo] <= clip){ acc += h[lo]; lo++; }
  acc = 0; let hi = 255; while (hi > lo + 2 && acc + h[hi] <= clip){ acc += h[hi]; hi--; }
  return [lo, hi];
}
const gammaPos = (b, w, g) => b + (w - b) * Math.pow(0.5, g);          // adjust_editors.rs:630
const gammaFromPos = (b, w, x) => clamp(Math.log(clamp((x - b) / Math.max(w - b, 1), 0.01, 0.99)) / Math.log(0.5), 0.01, 9.99);

/* ═══════════ 各对话框（栏位、预设、范围照 adjust_editors.rs／sizing.rs／参数表） ═══════════ */
function adjInit(kind, init){ return toParams(fromParams(kind, init && Object.keys(init).length ? init : {}, null)); }
function adjDialog(kind, build, extra){
  DIALOGS['image.adjustments.' + kind] = init => Dlg.open(Object.assign({id:'image.adjustments.' + kind, v:adjInit(kind, init), preview:'layer', build}, extra || {}));
}
const TONE_CH = () => [['', t('chRGB')], ['red', t('chRed')], ['green', t('chGreen')], ['blue', t('chBlue')]];

adjDialog('brightnessContrast', (ui, v) => {
  ui.sl(v, 'brightness', t('brightness'), -150, 150, 1);
  ui.slider({k:'contrast', label:t('contrast'), min:v.legacy ? -100 : -50, max:100, step:1, get:() => v.contrast, set:x => { v.contrast = x; }});
  ui.check({k:'legacy', label:t('useLegacy'), get:() => v.legacy, set:x => { v.legacy = x; if (!x) v.contrast = Math.max(v.contrast, -50); }, rebuild:true});
});
adjDialog('levels', (ui, v, st) => {
  st.ch = st.ch || 0; st.hist = st.hist || layerHist();
  const chans = TONE_CH(), key = chans[st.ch][0], o = () => key ? v[key] : v;
  const auto = ui.button(t('auto'), () => { const [lo, hi] = autoLevelsHist(st.hist[st.ch]); Object.assign(o(), {inBlack:lo, inWhite:hi, gamma:1}); Dlg.changed(true); }, 'auto');
  const sel = ui.select({k:'channel', label:t('channel'), options:chans.map(([k2, n], i) => [i, n]), get:() => st.ch, set:x => { st.ch = +x; }, rebuild:true});
  sel.appendChild(auto);
  ui.row(t('inputLevels'), [], true);
  const W = 256, hc = ui.canvas(W, 100, 'levelsHist'); ui.add(hc);
  drawHist(hc, st.hist[st.ch], ['#aab0ba', '#e05050', '#50c060', '#5080e0'][st.ch]);
  /* 输入：黑／灰／白三个三角把手（拖最近的那个） */
  const sIn = ui.canvas(W, 14, 'levelsIn'); ui.add(sIn);
  const sOut = ui.canvas(W, 14, 'levelsOut');
  const tri = (x, cv, px, fill) => { x.fillStyle = fill; x.strokeStyle = '#aab0ba'; x.beginPath(); x.moveTo(px, 1); x.lineTo(px + 5.5, 12); x.lineTo(px - 5.5, 12); x.closePath(); x.fill(); x.stroke(); };
  const drawStrips = () => {
    const a = o(), x = sIn.getContext('2d'); x.clearRect(0, 0, W, 14);
    tri(x, sIn, a.inBlack / 255 * W, '#000'); tri(x, sIn, gammaPos(a.inBlack, a.inWhite, a.gamma) / 255 * W, '#808080'); tri(x, sIn, a.inWhite / 255 * W, '#fff');
    const y = sOut.getContext('2d'); y.clearRect(0, 0, W, 14); tri(y, sOut, a.outBlack / 255 * W, '#000'); tri(y, sOut, a.outWhite / 255 * W, '#fff');
  };
  const fields = {};
  const sync = () => { const a = o(); ['inBlack', 'gamma', 'inWhite', 'outBlack', 'outWhite'].forEach(k => { if (fields[k] && document.activeElement !== fields[k]) fields[k].value = fmtNum(a[k], k === 'gamma' ? 0.01 : 1); }); drawStrips(); };
  const dragStrip = (cv, pick, move) => cv.addEventListener('pointerdown', e => {
    const r = cv.getBoundingClientRect(), val = ev => clamp((ev.clientX - r.left) / r.width * 255, 0, 255), which = pick(val(e));
    cv.setPointerCapture(e.pointerId);
    const mv = ev => { move(which, val(ev)); sync(); Dlg.changed(); };
    const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); };
    cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); mv(e);
  });
  const nearest = (xs, x) => xs.reduce((b, v, i) => Math.abs(v - x) < Math.abs(xs[b] - x) ? i : b, 0);
  dragStrip(sIn, x => { const a = o(); return nearest([a.inBlack, gammaPos(a.inBlack, a.inWhite, a.gamma), a.inWhite], x); }, (k, x) => {
    const a = o(); if (k === 0) a.inBlack = Math.round(Math.min(x, a.inWhite - 2)); else if (k === 2) a.inWhite = Math.round(Math.max(x, a.inBlack + 2)); else a.gamma = Math.round(gammaFromPos(a.inBlack, a.inWhite, x) * 100) / 100; });
  dragStrip(sOut, x => { const a = o(); return nearest([a.outBlack, a.outWhite], x); }, (k, x) => { const a = o(); a[k ? 'outWhite' : 'outBlack'] = Math.round(x); });
  const nf = (k, min, max, step) => { const n = el('input', {type:'number', min, max, step, value:fmtNum(o()[k], step), data:{k}});
    n.addEventListener('change', () => { const a = o(), x = Number(n.value); if (!isFinite(x)) return;
      if (k === 'inBlack') a.inBlack = Math.round(Math.min(clamp(x, 0, 253), a.inWhite - 2)); else if (k === 'inWhite') a.inWhite = Math.round(Math.max(clamp(x, 2, 255), a.inBlack + 2));
      else if (k === 'gamma') a.gamma = Math.round(clamp(x, 0.01, 9.99) * 100) / 100; else a[k] = Math.round(clamp(x, 0, 255));
      sync(); Dlg.changed(); });
    fields[k] = n; return n; };
  ui.add(el('div', {className:'row', style:'justify-content:space-between;width:258px'}, [nf('inBlack', 0, 253, 1), nf('gamma', 0.01, 9.99, 0.01), nf('inWhite', 2, 255, 1)]));
  ui.row(t('outputLevels'), [], true);
  const bar = ui.canvas(W, 8, 'levelsOutBar'); ui.add(bar);
  const bx = bar.getContext('2d'), gr = bx.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, '#000'); gr.addColorStop(1, ['#fff', '#f33', '#3c3', '#36f'][st.ch]); bx.fillStyle = gr; bx.fillRect(0, 0, W, 8);
  ui.add(sOut);
  ui.add(el('div', {className:'row', style:'justify-content:space-between;width:258px'}, [nf('outBlack', 0, 255, 1), nf('outWhite', 0, 255, 1)]));
  drawStrips();
});
/* ═══════════ 曲线（PS 2020 图像 ▸ 调整 ▸ 曲线；属性面板 ps-window.js curvesProps 也用这一份 CurveKit） ═══════════
   预设下拉（内建＋存储／载入 .acv）、编辑点／铅笔两种模式＋平滑、在图像上单击并拖动（手指）、黑／灰／白场吸管、Ctrl＋点画布加点、曲线显示选项。
   曲线参数：每个通道 [[in,out],…] 或 {pencil:[256]}（铅笔）。PS 的整组曲线同一时间只有一种模式 ⇒ 切模式时四条一起换。 */
const L3s = (a, b, c) => Lang.cur === 'zh-Hant' ? a : Lang.cur === 'en' ? c : b;
const CK_LS = {presets:'dilin.ps.curvePresets', opts:'dilin.ps.curveDisplay'};
const ckGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v === null ? d : v; } catch (_){ return d; } };
const ckPut = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_){} };
const CK_OPTS0 = {amount:'light', grid:'simple', overlay:true, hist:true, baseline:true, cross:true};   // PS 曲线显示选项预设：光、简单网格、四项全勾
const CurveKit = {
  CH:['points', 'red', 'green', 'blue'],
  COL:['#e6e8eb', '#e05050', '#50c060', '#5080e0'],
  HI:['#fff', '#f33', '#3c3', '#36f'],
  PRESETS:CURVE_PRESETS,
  isPen:c => !!(c && !Array.isArray(c) && Array.isArray(c.pencil)),
  ident:() => [[0, 0], [255, 255]],
  /* 一条曲线 → 256 格输出（0..255） */
  lut256(c){
    const out = new Float64Array(256);
    if (CurveKit.isPen(c)){ for (let i = 0; i < 256; i++) out[i] = clamp(+c.pencil[i] || 0, 0, 255); return out; }
    if (!Array.isArray(c) || c.length < 2){ for (let i = 0; i < 256; i++) out[i] = i; return out; }
    const L = curveLut(c.map(q => ({i:q[0] / 255, o:q[1] / 255})));
    for (let i = 0; i < 256; i++) out[i] = L[Math.round(i / 255 * (LUT_SIZE - 1))] * 255;
    return out;
  },
  isIdentity(c){ const l = CurveKit.lut256(c); for (let i = 0; i < 256; i++) if (Math.abs(l[i] - i) > 0.5) return false; return true; },
  toPen(c){ return CurveKit.isPen(c) ? {pencil:c.pencil.map(Number)} : {pencil:Array.from(CurveKit.lut256(c), x => Math.round(x))}; },
  /* 铅笔 → 点（PS 从铅笔切回「编辑点」会把手画的线换成一串点；原码没有这段 ⇒ 贪心：从两端点起，每次在样条误差最大处补一点，直到误差 ≤2 色阶或满 16 点） */
  toPoints(c){
    if (!CurveKit.isPen(c)) return Array.isArray(c) && c.length >= 2 ? c : CurveKit.ident();
    const y = c.pencil.map(v => clamp(Math.round(v), 0, 255)), pts = [[0, y[0]], [255, y[255]]];
    for (let n = 0; n < 14; n++){
      const l = CurveKit.lut256(pts); let bi = -1, be = 2;
      for (let i = 1; i < 255; i++){ const e = Math.abs(l[i] - y[i]); if (e > be && pts.every(q => Math.abs(q[0] - i) >= 4)){ be = e; bi = i; } }
      if (bi < 0) break;
      pts.splice(pts.findIndex(q => q[0] > bi), 0, [bi, y[bi]]);
    }
    return pts;
  },
  /* 「平滑」钮：每按一次做两遍 5 格方框模糊（PS 每按一次更平一点；PS 确切核心不公开，这是近似） */
  smooth(c){
    const y = CurveKit.toPen(c).pencil;
    for (let pass = 0; pass < 2; pass++){ const z = y.slice(); for (let i = 0; i < 256; i++){ let s = 0; for (let d = -2; d <= 2; d++) s += z[clamp(i + d, 0, 255)]; y[i] = s / 5; } }
    return {pencil:y.map(v => Math.round(clamp(v, 0, 255) * 100) / 100)};
  },
  mode(v){ return CurveKit.CH.some(k => CurveKit.isPen(v[k])) ? 'pencil' : 'points'; },
  setMode(v, m){ CurveKit.CH.forEach(k => { v[k] = m === 'pencil' ? CurveKit.toPen(v[k]) : CurveKit.toPoints(v[k]).map(q => q.slice()); }); },
  full(q){ const o = {}; CurveKit.CH.forEach(k => { o[k] = JSON.parse(JSON.stringify((q && q[k]) || CurveKit.ident())); }); return o; },
  sig(v){ return CurveKit.CH.map(k => Array.from(CurveKit.lut256(v[k]), Math.round).join(',')).join('|'); },
  /* ── 预设：内建（CURVE_PRESETS）＋用户存的（localStorage）；下拉值 'id' / 'user:名字' / 'custom' ── */
  userPresets(){ const a = ckGet(CK_LS.presets, []); return Array.isArray(a) ? a.filter(x => x && typeof x.name === 'string' && x.params) : []; },
  saveUser(name, v){ const a = CurveKit.userPresets().filter(x => x.name !== name); a.push({name, params:CurveKit.full(v)}); ckPut(CK_LS.presets, a); return 'user:' + name; },
  removeUser(name){ ckPut(CK_LS.presets, CurveKit.userPresets().filter(x => x.name !== name)); },
  presetParams(id){
    if (/^user:/.test(id)){ const u = CurveKit.userPresets().find(x => 'user:' + x.name === id); return u ? CurveKit.full(toParams(fromParams('curves', u.params, null))) : null; }
    return CURVE_PRESETS.some(x => x[0] === id) ? CurveKit.full(toParams(fromParams('curves', {preset:id}, null))) : null;
  },
  presetOf(v){
    const s = CurveKit.sig(v);
    for (const p of CURVE_PRESETS) if (CurveKit.sig(CurveKit.presetParams(p[0])) === s) return p[0];
    for (const u of CurveKit.userPresets()) { const q = CurveKit.presetParams('user:' + u.name); if (q && CurveKit.sig(q) === s) return 'user:' + u.name; }
    return 'custom';
  },
  presetOptions(){ return CURVE_PRESETS.map(p => [p[0], L3s.apply(null, p[1])]).concat(CurveKit.userPresets().map(u => ['user:' + u.name, u.name]), [['custom', L3s('自訂', '自定', 'Custom')]]); },
  /* PS 曲线预设档 .acv：int16 版本(1/4)、int16 曲线数；每条 int16 点数＋点数×(int16 输出, int16 输入)，大端；顺序 复合、红、绿、蓝 */
  acvWrite(v){
    const cs = CurveKit.CH.map(k => CurveKit.toPoints(v[k])), n = 4 + cs.reduce((a, c) => a + 2 + c.length * 4, 0), b = new DataView(new ArrayBuffer(n)); let o = 0;
    const w = x => { b.setInt16(o, x); o += 2; };
    w(1); w(cs.length); cs.forEach(c => { w(c.length); c.forEach(q => { w(Math.round(q[1])); w(Math.round(q[0])); }); });
    return new Uint8Array(b.buffer);
  },
  acvRead(buf){
    const b = new DataView(buf); let o = 0; const r = () => { if (o + 2 > b.byteLength) throw new Error('truncated .acv'); const x = b.getInt16(o); o += 2; return x; };
    const ver = r(), n = r(); if ((ver !== 1 && ver !== 4) || n < 1 || n > 32) throw new Error('not a Curves preset (.acv)');
    const out = {};
    for (let i = 0; i < n; i++){
      const m = r(); if (m < 2 || m > 19) throw new Error('bad curve in .acv');
      const pts = []; for (let j = 0; j < m; j++){ const oo = r(), ii = r(); pts.push([clamp(ii, 0, 255), clamp(oo, 0, 255)]); }
      if (i < 4) out[CurveKit.CH[i]] = pts;
    }
    return CurveKit.full(toParams(fromParams('curves', out, null)));
  },
  download(name, bytes){ try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], {type:'application/octet-stream'})); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0); } catch (_){} },
  /* 读进来的预设档（.acv 或 JSON 参数）→ 参数 */
  parseFile(name, buf){
    if (/\.json$/i.test(name)) return CurveKit.full(toParams(fromParams('curves', JSON.parse(new TextDecoder().decode(buf)), null)));
    return CurveKit.acvRead(buf);
  },
  /* ── 曲线显示选项（PS 记在偏好里 ⇒ localStorage，对话框与属性面板共用） ── */
  opts(){ return Object.assign({}, CK_OPTS0, ckGet(CK_LS.opts, {})); },
  setOpts(p){ const o = Object.assign(CurveKit.opts(), p); ckPut(CK_LS.opts, o); return o; },
  /* 颜料/油墨 %：PS 把图转 180°（横轴 0%＝白在左、纵轴 0% 在下），数字显示成油墨百分比 */
  scr(q, P, G, pig){ const f = v => pig ? 255 - v : v; return [P + f(q[0]) / 255 * G, P + G - f(q[1]) / 255 * G]; },
  val(x, y, P, G, pig){ const a = clamp((x - P) / G * 255, 0, 255), b = clamp((P + G - y) / G * 255, 0, 255); return pig ? [255 - a, 255 - b] : [a, b]; },
  shown(v, pig){ return pig ? Math.round((255 - v) / 255 * 100) : Math.round(v); },
  unshown(v, pig){ return pig ? clamp(255 - v / 100 * 255, 0, 255) : clamp(v, 0, 255); },
  /* 画曲线图：直方图、网格（简单 4×4／详细 10×10）、基线、通道叠加、曲线、点、交叉线、图像取样位置的小圈 */
  draw(x, o){
    const {P, G, v, key} = o, op = CurveKit.opts(), pig = op.amount === 'pigment', S = q => CurveKit.scr(q, P, G, pig), ci = Math.max(0, CurveKit.CH.indexOf(key));
    x.clearRect(0, 0, x.canvas.width, x.canvas.height);
    if (op.hist && o.hist){
      let mx = 0; for (let i = 0; i < 256; i++) mx = Math.max(mx, o.hist[i]);
      if (mx){ x.fillStyle = 'rgba(138,144,154,.45)'; for (let i = 0; i < 256; i++){ const hv = o.hist[i] / mx * G; x.fillRect(P + (pig ? 255 - i : i) * G / 256, P + G - hv, Math.ceil(G / 256), hv); } }
    }
    const n = op.grid === 'detailed' ? 10 : 4; x.strokeStyle = '#3a404a'; x.lineWidth = 1;
    for (let i = 1; i < n; i++){ const s = Math.round(P + i * G / n) + 0.5; x.beginPath(); x.moveTo(s, P); x.lineTo(s, P + G); x.moveTo(P, s); x.lineTo(P + G, s); x.stroke(); }   // 对齐像素：线是实的
    if (op.baseline){ x.strokeStyle = '#555c68'; x.beginPath(); x.moveTo(P, P + G); x.lineTo(P + G, P); x.stroke(); }
    const line = (c, col, wd) => { const l = CurveKit.lut256(c); x.strokeStyle = col; x.lineWidth = wd; x.beginPath();
      for (let i = 0; i < 256; i++){ const s = S([i, l[i]]); i ? x.lineTo(s[0], s[1]) : x.moveTo(s[0], s[1]); } x.stroke(); };
    if (key === 'points' && op.overlay) ['red', 'green', 'blue'].forEach((k, i) => { if (!CurveKit.isIdentity(v[k])) line(v[k], CurveKit.COL[i + 1], 1); });
    line(v[key], CurveKit.COL[ci], 1.5);
    const sel = o.sel === undefined ? null : o.sel;
    if (!CurveKit.isPen(v[key])) v[key].forEach((q, i) => { const s = S(q); x.fillStyle = i === sel ? '#e6e8eb' : '#1e2126'; x.strokeStyle = '#e6e8eb'; x.lineWidth = 1; x.fillRect(s[0] - 3.5, s[1] - 3.5, 7, 7); x.strokeRect(s[0] - 3.5, s[1] - 3.5, 7, 7); });
    if (o.cross && op.cross){ const s = S(o.cross); x.strokeStyle = 'rgba(230,232,235,.6)'; x.lineWidth = 1; x.beginPath(); x.moveTo(P, s[1]); x.lineTo(P + G, s[1]); x.moveTo(s[0], P); x.lineTo(s[0], P + G); x.stroke(); }
    if (o.hover !== null && o.hover !== undefined){ const l = CurveKit.lut256(v[key]), s = S([o.hover, l[Math.round(o.hover)]]); x.strokeStyle = '#fff'; x.lineWidth = 1; x.beginPath(); x.arc(s[0], s[1], 4.5, 0, Math.PI * 2); x.stroke(); }
  },
  /* 在曲线上加一点（已有输入差 <2 的点：set＝改它的输出，否则只选它）；满 16 点回 null */
  addPoint(a, q, set){
    q = [clamp(Math.round(q[0]), 0, 255), clamp(Math.round(q[1]), 0, 255)];
    const at = a.findIndex(p => Math.abs(p[0] - q[0]) < 2); if (at >= 0){ if (set) a[at] = [a[at][0], q[1]]; return at; }
    if (a.length >= 16) return null;
    let i = a.findIndex(p => p[0] > q[0]); if (i < 0) i = a.length; a.splice(i, 0, q); return i;
  },
  /* 取样色在某条曲线输入轴上的值：单通道＝该通道原值；复合＝各通道先过自己的曲线，再取亮度（Rec.601，跟直方图同一套） */
  inputOf(v, key, rgb){
    if (key !== 'points') return clamp(Math.round(rgb[CurveKit.CH.indexOf(key) - 1]), 0, 255);
    const c = ['red', 'green', 'blue'].map((k, i) => CurveKit.lut256(v[k])[clamp(Math.round(rgb[i]), 0, 255)]);
    return clamp(Math.round(rgbToGray(c[0], c[1], c[2])), 0, 255);
  },
  /* 黑／灰／白场吸管（PS：取样色的 R、G、B 各自在红／绿／蓝曲线上映到目标；目标＝「自动颜色校正选项」预设 黑 0、白 255、中间调中性灰）：
     黑场＝各通道曲线起点改成 (该通道值, 0)；白场＝终点改成 (该通道值, 255)；
     灰场＝各通道在 (该通道值, 取样亮度) 加点 ⇒ 取样色变中性灰、亮度大致不变（PS 灰场吸管只去色偏、不把亮度拉到 128） */
  eyedrop(v, which, rgb){
    if (CurveKit.mode(v) === 'pencil') CurveKit.setMode(v, 'points');
    const Y = rgbToGray(rgb[0], rgb[1], rgb[2]);
    ['red', 'green', 'blue'].forEach((k, i) => {
      const a = v[k] = CurveKit.toPoints(v[k]).map(q => q.slice()), s = clamp(Math.round(rgb[i]), 0, 255), n = a.length;
      if (which === 'black') a[0] = [clamp(s, 0, Math.max(0, a[1][0] - 2)), 0];
      else if (which === 'white') a[n - 1] = [clamp(s, Math.min(255, a[n - 2][0] + 2), 255), 255];
      else if (s > a[0][0] + 1 && s < a[n - 1][0] - 1) CurveKit.addPoint(a, [s, Y], true);
    });
  },
  /* ── 取样画布 ── */
  docPt(e){
    const c = window.UI && UI.canvas; if (!c) return null; const r = c.getBoundingClientRect(); if (!r.width || !r.height) return null;
    const p = [(e.clientX - r.left) / r.width * Doc.width, (e.clientY - r.top) / r.height * Doc.height];
    return p[0] >= 0 && p[1] >= 0 && p[0] < Doc.width && p[1] < Doc.height ? p : null;
  },
  /* 调整层：取它下面所有层合起来的颜色（调整前的值） */
  belowSource(L){
    const i = Math.max(0, Doc.layers.indexOf(L)); let cv = null;
    try { if (window.PsLayer && PsLayer.flattenLayers) cv = PsLayer.flattenLayers(Doc.layers.slice(0, i)); } catch (e){ console.warn(e); }
    if (!cv) cv = composite(1);
    return {cv, ox:0, oy:0, white:true};
  },
  read(src, pt){
    if (!src || !src.cv) return null;
    const x = Math.floor(pt[0] - src.ox), y = Math.floor(pt[1] - src.oy); if (x < 0 || y < 0 || x >= src.cv.width || y >= src.cv.height) return null;
    const d = src.cv.getContext('2d').getImageData(x, y, 1, 1).data; if (!d[3] && !src.white) return null;
    const a = d[3] / 255; return src.white ? [0, 1, 2].map(k => d[k] * a + 255 * (1 - a)) : [d[0], d[1], d[2]];
  }
};
/* 对话框开着时画布在透明底 bg 下面：bg 接滑鼠 ⇒ 吸管／手指／Ctrl＋点加点（Ctrl+Shift＝红绿蓝三条各加一点，PS） */
function curveDlgHook(c){
  if (!c || !c.bg || c.bg.__curveHook) return; c.bg.__curveHook = true;
  const src = () => c.__curveSrc || (c.__curveSrc = c.prev && c.prev.kind === 'layer' && c.prev.snap ? {cv:c.prev.snap.canvas, ox:Math.round(c.prev.L.x || 0), oy:Math.round(c.prev.L.y || 0)} : CurveKit.belowSource(Doc.active()));
  const keyOf = () => CurveKit.CH[c.state.ch || 0];
  const sample = e => { const pt = CurveKit.docPt(e); return pt ? CurveKit.read(src(), pt) : null; };
  c.bg.addEventListener('pointermove', e => {
    if (Dlg.cur !== c || c.state.drag) return; const rgb = sample(e), h = rgb && !CurveKit.isPen(c.v[keyOf()]) ? CurveKit.inputOf(c.v, keyOf(), rgb) : null;
    if (h !== c.state.hover){ c.state.hover = h; if (c.state.redraw) c.state.redraw(); }
  });
  c.bg.addEventListener('pointerdown', e => {
    if (Dlg.cur !== c || e.button !== 0) return;
    const st = c.state, v = c.v, tool = st.tool, ctrl = e.ctrlKey || e.metaKey;
    if (!tool && !ctrl) return;
    const rgb = sample(e); if (!rgb) return;
    e.preventDefault(); e.stopPropagation();
    if (tool === 'black' || tool === 'gray' || tool === 'white'){ CurveKit.eyedrop(v, tool, rgb); st.sel = null; Dlg.changed(true); return; }
    if (CurveKit.mode(v) === 'pencil') CurveKit.setMode(v, 'points');
    if (ctrl){
      if (e.shiftKey) ['red', 'green', 'blue'].forEach((k, i) => { const s = clamp(Math.round(rgb[i]), 0, 255); CurveKit.addPoint(v[k], [s, CurveKit.lut256(v[k])[s]], false); });
      else { const k = keyOf(), a = CurveKit.inputOf(v, k, rgb); st.sel = CurveKit.addPoint(v[k], [a, CurveKit.lut256(v[k])[a]], false); }
      Dlg.changed(true); return;
    }
    /* 手指（在图像上单击并拖动可修改曲线）：按下＝在取样值加点，上下拖＝改它的输出（1 屏幕像素＝1 色阶） */
    const k = keyOf(), a = CurveKit.inputOf(v, k, rgb), i = CurveKit.addPoint(v[k], [a, CurveKit.lut256(v[k])[a]], false); if (i === null) return;
    st.sel = i; st.drag = true; st.hover = null;
    const y0 = e.clientY, o0 = v[k][i][1], pig = CurveKit.opts().amount === 'pigment';
    try { c.bg.setPointerCapture(e.pointerId); } catch (_){}
    const mv = ev => { const pts = v[k]; if (!pts[i]) return; pts[i] = [pts[i][0], clamp(Math.round(o0 + (y0 - ev.clientY) * (pig ? -1 : 1)), 0, 255)]; if (st.redraw) st.redraw(); Dlg.changed(); };
    const up = () => { st.drag = false; c.bg.removeEventListener('pointermove', mv); c.bg.removeEventListener('pointerup', up); c.bg.removeEventListener('pointercancel', up); Dlg.changed(true); };
    c.bg.addEventListener('pointermove', mv); c.bg.addEventListener('pointerup', up); c.bg.addEventListener('pointercancel', up);
    Dlg.changed(true);
  });
}
const CK_TIP = {
  tat:['在影像上按一下並拖移可修改曲線', '在图像上单击并拖动可修改曲线', 'Click and drag in image to modify the curve'],
  points:['編輯點以修改曲線', '编辑点以修改曲线', 'Edit points to modify the curve'],
  pencil:['以繪圖方式修改曲線', '通过绘制来修改曲线', 'Draw to modify the curve'],
  smooth:['平滑曲線值', '平滑曲线值', 'Smooth the curve values'],
  black:['在影像中取樣以設定黑點', '在图像中取样以设置黑场', 'Sample in image to set black point'],
  gray:['在影像中取樣以設定灰點', '在图像中取样以设置灰场', 'Sample in image to set gray point'],
  white:['在影像中取樣以設定白點', '在图像中取样以设置白场', 'Sample in image to set white point']};
adjDialog('curves', (ui, v, st) => {
  st.ch = st.ch || 0; st.hist = st.hist || layerHist();
  const D = Dlg.cur; curveDlgHook(D);
  if (D && D.bg) D.bg.style.cursor = st.tool === 'tat' ? 'ns-resize' : st.tool ? 'crosshair' : '';
  const chans = TONE_CH(), key = CurveKit.CH[st.ch], op = CurveKit.opts(), pig = op.amount === 'pigment', pen = () => CurveKit.isPen(v[key]);
  /* 预设＋存储／载入／删除（PS：预设下拉＋右边齿轮选单的「存储预设…／载入预设…／删除当前预设」） */
  const pid = CurveKit.presetOf(v);
  const prow = ui.select({k:'curvePreset', label:L3s('預設集：', '预设：', 'Preset:'), options:CurveKit.presetOptions(), get:() => pid,
    set:x => { const q = x !== 'custom' && CurveKit.presetParams(x); if (q){ CurveKit.CH.forEach(k => { v[k] = q[k]; }); st.sel = null; } }, rebuild:true});
  const file = el('input', {type:'file', accept:'.acv,.json', style:'display:none', data:{k:'curveLoadFile'}});
  file.onchange = () => { const f = file.files && file.files[0]; if (!f) return;
    f.arrayBuffer().then(buf => { const q = CurveKit.parseFile(f.name, buf); CurveKit.CH.forEach(k => { v[k] = q[k]; }); CurveKit.saveUser(f.name.replace(/\.[^.]*$/, ''), q); st.sel = null; Dlg.changed(true); })
      .catch(e => toast(t('error') + (e && e.message || e))); };
  prow.appendChild(ui.button(L3s('儲存…', '存储…', 'Save…'), () => {
    const name = window.prompt(L3s('預設集名稱', '预设名称', 'Preset name'), L3s('曲線 1', '曲线 1', 'Curves 1')); if (!name) return;
    CurveKit.saveUser(name, v); CurveKit.download(name + '.acv', CurveKit.acvWrite(v)); Dlg.changed(true); }, 'curveSavePreset'));
  prow.appendChild(ui.button(L3s('載入…', '载入…', 'Load…'), () => file.click(), 'curveLoadPreset'));
  if (/^user:/.test(pid)) prow.appendChild(ui.button(L3s('刪除', '删除', 'Delete'), () => { CurveKit.removeUser(pid.slice(5)); Dlg.changed(true); }, 'curveDeletePreset'));
  prow.appendChild(file);
  ui.select({k:'channel', label:t('channel'), options:chans.map(([k2, n], i) => [i, n]), get:() => st.ch, set:x => { st.ch = +x; st.sel = null; st.hover = null; }, rebuild:true});
  /* 工具：手指、编辑点、铅笔、平滑；黑／灰／白场吸管（再按一次＝放下） */
  const tb = (k, txt, tip, on, fn, dis) => { const b = ui.button(txt, fn, k); b.title = L3s.apply(null, tip); if (on) b.className = 'pri'; if (dis) b.disabled = true; b.style.padding = '3px 7px'; return b; };
  const pick = w => () => { st.tool = st.tool === w ? null : w; Dlg.changed(true); };
  const setMode = m => () => { if (CurveKit.mode(v) !== m){ CurveKit.setMode(v, m); st.sel = null; } if (m === 'pencil' && st.tool === 'tat') st.tool = null; Dlg.changed(true); };
  ui.add(el('div', {className:'row', style:'gap:3px'}, [
    tb('curveTAT', '☝', CK_TIP.tat, st.tool === 'tat', pick('tat')),
    tb('curveModePoints', '∿', CK_TIP.points, !pen(), setMode('points')), tb('curveModePencil', '✎', CK_TIP.pencil, pen(), setMode('pencil')),
    tb('curveSmooth', L3s('平滑', '平滑', 'Smooth'), CK_TIP.smooth, false, () => { CurveKit.CH.forEach(k => { v[k] = CurveKit.smooth(v[k]); }); Dlg.changed(true); }, !pen()),
    el('span', {style:'flex:1'}),
    tb('curveEyeBlack', '◣', CK_TIP.black, st.tool === 'black', pick('black')), tb('curveEyeGray', '◪', CK_TIP.gray, st.tool === 'gray', pick('gray')), tb('curveEyeWhite', '◸', CK_TIP.white, st.tool === 'white', pick('white'))]));
  const G = 256, P = 6, cv = ui.canvas(G + 2 * P, G + 2 * P, 'curveGraph'); cv.tabIndex = 0; if (pen()) cv.style.cursor = 'crosshair';
  /* PS 曲线框：左边直的输出渐变条＋黑／白场三角（拖＝改两端点的输出）；下面横的输入渐变条＋黑／白场三角（拖＝改两端点的输入） */
  const sOut = ui.canvas(16, G + 2 * P, 'curveOutSliders'), sIn = ui.canvas(G + 2 * P, 16, 'curveInSliders');
  sOut.style.cursor = 'ns-resize'; sIn.style.cursor = 'ew-resize'; sOut.style.touchAction = sIn.style.touchAction = cv.style.touchAction = 'none';
  ui.add(el('div', {style:'display:flex;gap:2px;align-items:flex-start'}, [sOut, cv]));
  ui.add(el('div', {style:'padding-left:18px'}, [sIn]));
  const pts = () => v[key];
  const toScr = q => CurveKit.scr(q, P, G, pig), toVal = (x, y) => CurveKit.val(x, y, P, G, pig);
  const fi = el('input', {type:'number', min:0, max:pig ? 100 : 255, step:1, data:{k:'curveIn'}}), fo = el('input', {type:'number', min:0, max:pig ? 100 : 255, step:1, data:{k:'curveOut'}});
  const ends = () => { const c = v[key]; if (CurveKit.isPen(c)) return [[0, c.pencil[0]], [255, c.pencil[255]]]; return [c[0], c[c.length - 1]]; };
  const draw = () => {
    const q = !pen() && st.sel !== null && st.sel !== undefined ? pts()[st.sel] : null;
    CurveKit.draw(cv.getContext('2d'), {P, G, v, key, hist:st.hist[st.ch], sel:pen() ? null : st.sel, cross:st.drag && q ? q : null, hover:st.hover});
    fi.disabled = fo.disabled = !q; if (q){ if (document.activeElement !== fi) fi.value = CurveKit.shown(q[0], pig); if (document.activeElement !== fo) fo.value = CurveKit.shown(q[1], pig); }
    const [b0, w0] = ends(), hiCol = CurveKit.HI[st.ch];
    const y = sIn.getContext('2d'); y.clearRect(0, 0, sIn.width, sIn.height);
    let gr = y.createLinearGradient(P, 0, P + G, 0); gr.addColorStop(pig ? 1 : 0, '#000'); gr.addColorStop(pig ? 0 : 1, hiCol); y.fillStyle = gr; y.fillRect(P, 0, G, 4);
    const triU = (px, fill) => { y.beginPath(); y.moveTo(px, 5); y.lineTo(px - 5, 15); y.lineTo(px + 5, 15); y.closePath(); y.fillStyle = fill; y.fill(); y.strokeStyle = '#9aa3b0'; y.lineWidth = 1; y.stroke(); };
    triU(toScr(b0)[0], '#000'); triU(toScr(w0)[0], '#fff');
    const z = sOut.getContext('2d'); z.clearRect(0, 0, sOut.width, sOut.height);
    gr = z.createLinearGradient(0, P + G, 0, P); gr.addColorStop(pig ? 1 : 0, '#000'); gr.addColorStop(pig ? 0 : 1, hiCol); z.fillStyle = gr; z.fillRect(12, P, 4, G);
    const triR = (py, fill) => { z.beginPath(); z.moveTo(11, py); z.lineTo(1, py - 5); z.lineTo(1, py + 5); z.closePath(); z.fillStyle = fill; z.fill(); z.strokeStyle = '#9aa3b0'; z.lineWidth = 1; z.stroke(); };
    triR(toScr(b0)[1], '#000'); triR(toScr(w0)[1], '#fff');
  };
  st.redraw = draw;
  /* 黑／白场滑块：抓最近的那个端点（0＝黑场、末＝白场），只动输入或只动输出（铅笔模式没有端点可拖） */
  const dragEnd = (c, axis) => c.addEventListener('pointerdown', e => {
    e.preventDefault(); if (pen()) return;
    const r = c.getBoundingClientRect(), at = ev => axis ? toVal(0, (ev.clientY - r.top) * c.height / r.height)[1] : toVal((ev.clientX - r.left) * c.width / r.width, 0)[0];
    const a = pts(), x0 = at(e), last = a.length - 1, i = Math.abs(a[0][axis] - x0) <= Math.abs(a[last][axis] - x0) ? 0 : last;
    st.sel = i; try { c.setPointerCapture(e.pointerId); } catch (_){}
    const mv = ev => { const q = pts()[i], x = at(ev); moveTo(i, axis ? [q[0], x] : [x, q[1]]); draw(); Dlg.changed(); };
    const up = () => { c.removeEventListener('pointermove', mv); c.removeEventListener('pointerup', up); };
    c.addEventListener('pointermove', mv); c.addEventListener('pointerup', up); mv(e);
  });
  dragEnd(sIn, 0); dragEnd(sOut, 1);
  /* adjust_editors.rs:305 curve_edit：insert／can_delete／delete／move_to */
  const insert = q => CurveKit.addPoint(pts(), q, false);
  const canDel = i => pts().length > 2 && i > 0 && i + 1 < pts().length;
  const moveTo = (i, q) => { const a = pts(), lo = i > 0 ? a[i - 1][0] + 1 : 0, hi = i + 1 < a.length ? a[i + 1][0] - 1 : 255; a[i] = [clamp(Math.round(q[0]), lo, Math.max(hi, lo)), clamp(Math.round(q[1]), 0, 255)]; };
  cv.addEventListener('pointerdown', e => {
    cv.focus(); const r = cv.getBoundingClientRect(), pos = [e.clientX - r.left, e.clientY - r.top];
    if (pen()){
      /* 铅笔：拖＝手画（相邻两格之间补直线）；Shift＋点＝从上一笔的终点拉直线（PS） */
      const arr = v[key].pencil; let last = null;
      const put = (p, shift) => {
        const q = toVal(p[0], p[1]), xi = Math.round(q[0]), yo = Math.round(q[1]), from = shift && st.penLast ? st.penLast : (last || [xi, yo]);
        const a0 = from[0], b0 = from[1], n = Math.abs(xi - a0);
        for (let j = 0; j <= n; j++){ const xx = a0 + Math.sign(xi - a0) * j; arr[xx] = n ? Math.round(b0 + (yo - b0) * j / n) : yo; }
        last = st.penLast = [xi, yo];
      };
      put(pos, e.shiftKey); try { cv.setPointerCapture(e.pointerId); } catch (_){}
      const mv = ev => { put([ev.clientX - r.left, ev.clientY - r.top]); draw(); Dlg.changed(); };
      const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); };
      cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
      draw(); Dlg.changed(); return;
    }
    let hit = null, bd = 9; pts().forEach((q, i) => { const s = toScr(q), d = Math.hypot(s[0] - pos[0], s[1] - pos[1]); if (d <= bd){ bd = d; hit = i; } });
    if (hit !== null && (e.ctrlKey || e.metaKey)){ if (canDel(hit)) pts().splice(hit, 1); st.sel = null; draw(); Dlg.changed(); return; }
    const inside = pos[0] >= P && pos[0] <= P + G && pos[1] >= P && pos[1] <= P + G;
    if (hit === null && !inside) return;
    let off = [0, 0];
    if (hit !== null){ st.sel = hit; const g = toVal(pos[0], pos[1]); off = [pts()[hit][0] - g[0], pts()[hit][1] - g[1]]; }
    else st.sel = insert(toVal(pos[0], pos[1]));
    if (st.sel === null){ draw(); return; }
    let idx = st.sel, removed = false;
    st.drag = true; cv.setPointerCapture(e.pointerId);
    const mv = ev => {
      const p = [ev.clientX - r.left, ev.clientY - r.top], outside = p[0] < P - 12 || p[0] > P + G + 12 || p[1] < P - 12 || p[1] > P + G + 12, g = toVal(p[0], p[1]), tg = [g[0] + off[0], g[1] + off[1]];
      if (idx !== null && outside && canDel(idx)){ pts().splice(idx, 1); idx = null; removed = true; st.sel = null; }
      else if (idx !== null) moveTo(idx, tg);
      else if (removed && !outside){ idx = st.sel = insert(tg); }
      draw(); Dlg.changed();
    };
    const up = () => { st.drag = false; cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); draw(); };
    cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
    draw(); Dlg.changed();
  });
  cv.addEventListener('keydown', e => {
    const i = st.sel; if (pen() || i === null || i === undefined) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && canDel(i)){ pts().splice(i, 1); st.sel = null; e.preventDefault(); draw(); Dlg.changed(); return; }
    const s = (e.shiftKey ? 10 : 1) * (pig ? -1 : 1), d = {ArrowLeft:[-s, 0], ArrowRight:[s, 0], ArrowUp:[0, s], ArrowDown:[0, -s]}[e.key];
    if (d){ e.preventDefault(); const q = pts()[i]; moveTo(i, [q[0] + d[0], q[1] + d[1]]); draw(); Dlg.changed(); }
  });
  const onField = () => { const i = st.sel; if (pen() || i === null || i === undefined) return; const a = Number(fi.value), b = Number(fo.value); if (isFinite(a) && isFinite(b)){ moveTo(i, [CurveKit.unshown(a, pig), CurveKit.unshown(b, pig)]); draw(); Dlg.changed(); } };
  fi.addEventListener('change', onField); fo.addEventListener('change', onField);
  ui.row(t('input'), [fi, el('span', {className:'lb'}, [t('output')]), fo].concat(pig ? [el('span', {}, ['%'])] : []));
  ui.note(pen() ? L3s('拖曳＝手繪曲線 · Shift＋按一下＝畫直線 · 「平滑」讓線變順', '拖动＝手绘曲线 · Shift＋单击＝画直线 · 「平滑」让线变顺', 'Drag to draw · Shift-click for a straight line · Smooth to soften')
    : t('curveHint') + L3s(' · 影像上 Ctrl＋按一下＝加點', ' · 图像上 Ctrl＋单击＝加点', ' · Ctrl-click the image to add a point'));
  /* 曲线显示选项（PS 对话框下方 ⊕ 展开那块） */
  ui.add(el('div', {className:'row'}, [ui.button((st.showOpts ? '⊖ ' : '⊕ ') + L3s('曲線顯示選項', '曲线显示选项', 'Curve Display Options'), () => { st.showOpts = !st.showOpts; Dlg.changed(true); }, 'curveDispToggle')]));
  if (st.showOpts){
    ui.radio({k:'curveAmount', label:L3s('顯示數量：', '显示数量：', 'Show Amount of:'), options:[['light', L3s('光 (0-255)', '光 (0-255)', 'Light (0-255)')], ['pigment', L3s('顏料/油墨 %', '颜料/油墨 %', 'Pigment/Ink %')]],
      get:() => op.amount, set:x => { CurveKit.setOpts({amount:x}); }, rebuild:true});
    const gb = (k, g, txt) => { const b = ui.button(txt, () => { CurveKit.setOpts({grid:g}); Dlg.changed(true); }, k); if (op.grid === g) b.className = 'pri'; b.title = txt; return b; };
    ui.row(L3s('格點：', '网格：', 'Grid:'), [gb('curveGridSimple', 'simple', L3s('簡單格點 ⊞', '简单网格 ⊞', 'Simple grid ⊞')), gb('curveGridDetailed', 'detailed', L3s('詳細格點 ▦', '详细网格 ▦', 'Detailed grid ▦'))]);
    [['overlay', 'curveShowOverlay', L3s('色版覆蓋', '通道叠加', 'Channel Overlays')], ['hist', 'curveShowHist', L3s('色階分佈圖', '直方图', 'Histogram')],
      ['baseline', 'curveShowBaseline', L3s('基準線', '基线', 'Baseline')], ['cross', 'curveShowCross', L3s('交集線', '交叉线', 'Intersection Line')]]
      .forEach(([o, k, lab]) => ui.check({k, label:lab, get:() => op[o], set:x => { CurveKit.setOpts({[o]:x}); }, rebuild:true}));
  }
  draw();
});
function drawHistInto(x, ox, oy, w, h, hist){
  let mx = 0; for (let i = 0; i < 256; i++) mx = Math.max(mx, hist[i]); if (!mx) return;
  x.fillStyle = 'rgba(138,144,154,.45)'; for (let i = 0; i < 256; i++){ const v = hist[i] / mx * h; x.fillRect(ox + i * w / 256, oy + h - v, Math.ceil(w / 256), v); }
}
adjDialog('exposure', (ui, v) => { ui.sl(v, 'exposure', t('exposure'), -20, 20, 0.01); ui.sl(v, 'offset', t('offset'), -0.5, 0.5, 0.0001); ui.sl(v, 'gamma', t('gammaCorr'), 0.01, 9.99, 0.01); });
adjDialog('vibrance', (ui, v) => { ui.sl(v, 'vibrance', t('vibrance'), -100, 100, 1, '%'); ui.sl(v, 'saturation', t('saturation'), -100, 100, 1, '%'); });
adjDialog('hueSaturation', (ui, v, st) => {
  st.range = v.colorize ? 0 : (st.range || 0);
  ui.select({k:'range', label:'', options:[[0, t('master')]].concat(HUE_RANGES.map((k, i) => [i + 1, t(k)])), get:() => st.range, set:x => { st.range = +x; }, rebuild:true, disabled:v.colorize});
  if (st.range === 0){
    const lo = v.colorize ? 0 : -180, hi = v.colorize ? 360 : 180;
    ui.slider({k:'hue', label:t('hue'), min:lo, max:hi, step:1, unit:'°', get:() => v.hue, set:x => { v.hue = x; }});
    ui.slider({k:'saturation', label:t('saturation'), min:v.colorize ? 0 : -100, max:100, step:1, unit:'%', get:() => v.saturation, set:x => { v.saturation = x; }});
    ui.sl(v, 'lightness', t('lightness'), -100, 100, 1, '%');
  } else {
    const key = HUE_RANGES[st.range - 1], o = v[key];
    ui.slider({k:key + '.hue', label:t('hue'), min:-180, max:180, step:1, unit:'°', get:() => o.hue, set:x => { o.hue = x; }});
    ui.slider({k:key + '.saturation', label:t('saturation'), min:-100, max:100, step:1, unit:'%', get:() => o.saturation, set:x => { o.saturation = x; }});
    ui.slider({k:key + '.lightness', label:t('lightness'), min:-100, max:100, step:1, unit:'%', get:() => o.lightness, set:x => { o.lightness = x; }});
    const nums = o.range.map((b, i) => { const n = el('input', {type:'number', step:1, value:Math.round(b), data:{k:key + '.range' + i}});
      n.addEventListener('change', () => { const x = Number(n.value); if (isFinite(x)){ o.range[i] = x; Dlg.changed(); } }); return n; });
    ui.row(t('range'), nums);
  }
  ui.check({k:'colorize', label:t('colorize'), get:() => v.colorize, rebuild:true, set:c => {
    v.colorize = c; const h = v.hue; v.hue = c ? rem(h, 360) : (h > 180 ? h - 360 : h);
    if (c) v.saturation = Math.max(v.saturation, 25); }});
  /* 色谱：上＝原来的色相，下＝调整后（adjust_editors.rs:840 adjusted_spectrum） */
  const cv = ui.canvas(256, 26, 'spectrum'); ui.add(cv);
  const x = cv.getContext('2d');
  for (let i = 0; i < 256; i++){ const c = hslRgb(i / 255, 1, 0.5); x.fillStyle = hexOf(c); x.fillRect(i, 0, 1, 10); }
  try {
    const a = fromParams('hueSaturation', v, null), px = new Float32Array(256 * 4);
    for (let i = 0; i < 256; i++){ const c = hslRgb(i / 255, 1, 0.5); px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 1; }
    applyAdjustment(a, px, 256, 0, 0);
    for (let i = 0; i < 256; i++){ x.fillStyle = hexOf([px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]); x.fillRect(i, 16, 1, 10); }
  } catch (_){}
}, {params:v => JSON.parse(JSON.stringify(v))});
adjDialog('colorBalance', (ui, v, st) => {
  st.tone = st.tone === undefined ? 1 : st.tone;
  const key = ['shadows', 'midtones', 'highlights'][st.tone];
  ui.radio({k:'tone', label:t('tone'), options:[[0, t('shadows')], [1, t('midtones')], [2, t('highlights')]], get:() => st.tone, set:x => { st.tone = +x; }, rebuild:true});
  [['cyanRed'], ['magentaGreen'], ['yellowBlue']].forEach(([lab], i) => ui.slider({k:key + '.' + i, label:t(lab), min:-100, max:100, step:1, get:() => v[key][i], set:x => { v[key][i] = x; }}));
  ui.check({k:'preserveLuminosity', label:t('preserveLum'), get:() => v.preserveLuminosity, set:x => { v.preserveLuminosity = x; }});
});
adjDialog('blackWhite', (ui, v) => {
  HUE_RANGES.forEach(k => ui.sl(v, k, t(k), -200, 300, 1, '%'));
  ui.check({k:'tint', label:t('tint'), get:() => v.tint, set:x => { v.tint = x; }, rebuild:true});
  const r = ui.color({k:'tintColor', label:'', get:() => v.tintColor, set:x => { v.tintColor = x; }, disabled:!v.tint});
  r.appendChild(ui.button(t('defaults'), () => { HUE_RANGES.forEach((k, i) => { v[k] = BW_DEFAULTS[i]; }); Dlg.changed(true); }, 'defaults'));
});
adjDialog('photoFilter', (ui, v, st) => {
  const preset = PHOTO_FILTERS.find(f => hexOf(f[2].map(x => x / 255)) === String(v.color).toLowerCase());
  if (st.useColor === undefined) st.useColor = !preset;
  ui.radio({k:'pfMode', label:'', options:[['filter', t('filter')], ['color', t('color')]], get:() => st.useColor ? 'color' : 'filter', set:x => { st.useColor = x === 'color'; }, rebuild:true});
  const opts = PHOTO_FILTERS.map(f => [f[0], Lang.t('psimg.pf.' + f[0])]); if (!preset) opts.unshift(['custom', t('custom')]);
  ui.select({k:'filter', label:t('filter'), options:opts, get:() => preset ? preset[0] : 'custom', disabled:st.useColor, rebuild:true,
    set:x => { const f = PHOTO_FILTERS.find(q => q[0] === x); if (f) v.color = hexOf(f[2].map(c => c / 255)); }});
  ui.color({k:'color', label:t('color'), get:() => v.color, set:x => { v.color = x; }, disabled:!st.useColor});
  ui.sl(v, 'density', t('density'), 0, 100, 1, '%');
  ui.check({k:'preserveLuminosity', label:t('preserveLum'), get:() => v.preserveLuminosity, set:x => { v.preserveLuminosity = x; }});
});
adjDialog('channelMixer', (ui, v, st) => {
  st.out = v.monochrome ? 0 : (st.out || 0);
  const outs = v.monochrome ? [[0, t('gray')]] : [[0, t('chRed')], [1, t('chGreen')], [2, t('chBlue')]];
  ui.select({k:'outChannel', label:t('outChannel'), options:outs, get:() => st.out, set:x => { st.out = +x; }, rebuild:true});
  const key = v.monochrome ? 'gray' : ['red', 'green', 'blue'][st.out];
  if (!Array.isArray(v[key])) v[key] = v.monochrome ? [40, 40, 20, 0] : [0, 1, 2].map(i => i === st.out ? 100 : 0).concat(0);
  const row = v[key], tot = el('span', {data:{k:'total'}});
  const upd = () => { const s = row[0] + row[1] + row[2]; tot.textContent = (s >= 0 ? '+' : '') + Math.round(s) + '%'; tot.style.color = s > 100 ? '#ffb070' : '#e6e8eb'; };
  [['chRed'], ['chGreen'], ['chBlue']].forEach(([lab], i) => ui.slider({k:key + '.' + i, label:t(lab), min:-200, max:200, step:1, unit:'%', get:() => row[i], set:x => { row[i] = x; upd(); }}));
  ui.row(t('total'), [tot]); upd();
  ui.slider({k:key + '.3', label:t('constant'), min:-200, max:200, step:1, unit:'%', get:() => row[3], set:x => { row[3] = x; }});
  ui.check({k:'monochrome', label:t('monochrome'), get:() => v.monochrome, rebuild:true, set:m => { v.monochrome = m; if (m) v.gray = [40, 40, 20, 0]; else delete v.gray; }});
});
adjDialog('posterize', (ui, v) => ui.sl(v, 'levels', t('levels'), 2, 255, 1));
adjDialog('threshold', (ui, v, st) => {
  st.hist = st.hist || layerHist();
  const cv = ui.canvas(256, 90, 'thresholdHist'); ui.add(cv);
  const draw = () => drawHist(cv, st.hist[0], '#8a909a', [[v.level, '#2f7fd8']]);
  ui.slider({k:'level', label:t('thresholdLevel'), min:1, max:255, step:1, get:() => v.level, set:x => { v.level = x; draw(); }});
  draw();
});
const GM_PRESETS = () => [['gmBW', [[0, '#000000'], [1, '#ffffff']]], ['gmFgBg', [[0, hexOf(fgColor())], [1, hexOf(bgColor())]]],
  ['gmViolet', [[0, hexOf([0.161, 0.039, 0.349])], [1, hexOf([1, 0.486, 0])]]], ['gmBRY', [[0, hexOf([0.039, 0, 0.698])], [0.5, '#ff0000'], [1, hexOf([1, 0.988, 0])]]],
  ['gmCopper', [[0, hexOf([0.592, 0.275, 0.102])], [0.4, hexOf([0.984, 0.847, 0.773])], [0.7, hexOf([0.424, 0.180, 0.086])], [1, hexOf([0.937, 0.859, 0.804])]]]];
adjDialog('gradientMap', (ui, v) => {
  const P = GM_PRESETS();
  ui.select({k:'preset', label:t('preset'), options:[['', t('custom')]].concat(P.map(([k]) => [k, t(k)])), get:() => '', rebuild:true,
    set:x => { const f = P.find(q => q[0] === x); if (f) v.stops = JSON.parse(JSON.stringify(f[1])); }});
  const cv = ui.canvas(256, 20, 'gradientBar'); ui.add(cv);
  const sorted = () => v.stops.map(s => [s[0], rgbOfHex(s[1], [0, 0, 0])]).sort((a, b) => a[0] - b[0]);
  const draw = () => { const x = cv.getContext('2d'), st2 = sorted(); for (let i = 0; i < 256; i++){ const tt = i / 255; x.fillStyle = hexOf(gradientAt(st2, v.reverse ? 1 - tt : tt)); x.fillRect(i, 0, 1, 20); } };
  v.stops.forEach((s, i) => {
    const c = el('input', {type:'color', value:s[1], data:{k:'stop' + i + '.color'}}); c.addEventListener('input', () => { s[1] = c.value; draw(); Dlg.changed(); });
    const n = el('input', {type:'number', min:0, max:100, step:0.1, value:fmtNum(s[0] * 100, 0.1), data:{k:'stop' + i + '.loc'}});
    n.addEventListener('change', () => { const x = Number(n.value); if (isFinite(x)){ s[0] = Math.round(clamp(x / 100, 0, 1) * 1000) / 1000; draw(); Dlg.changed(); } });
    const rm = ui.button('✕', () => { if (v.stops.length > 2){ v.stops.splice(i, 1); Dlg.changed(true); } }, 'stop' + i + '.remove'); rm.title = t('removeStop');
    ui.row('', [c, n, el('span', {}, ['%']), rm]);
  });
  const addB = ui.button(t('addStop'), () => {
    if (v.stops.length >= 64) return;
    const st2 = sorted(); let at = 0.5, best = -1;
    for (let i = 0; i + 1 < st2.length; i++){ const g = st2[i + 1][0] - st2[i][0]; if (g > best){ best = g; at = (st2[i][0] + st2[i + 1][0]) / 2; } }
    v.stops.push([Math.round(at * 1000) / 1000, hexOf(gradientAt(st2, at))]); Dlg.changed(true);
  }, 'addStop');
  ui.row('', [addB]);
  ui.check({k:'reverse', label:t('reverse'), get:() => v.reverse, set:x => { v.reverse = x; draw(); }});
  ui.check({k:'dither', label:t('dither'), get:() => v.dither, set:x => { v.dither = x; }});
  draw();
});
adjDialog('selectiveColor', (ui, v, st) => {
  st.colors = st.colors || 'reds';
  ui.select({k:'colors', label:t('colors'), options:SC_RANGES.map(k => [k, t(k)]), get:() => st.colors, set:x => { st.colors = x; }, rebuild:true});
  ['cyan', 'magenta', 'yellow', 'blackInk'].forEach((lab, j) => ui.slider({k:st.colors + '.' + j, label:t(lab), min:-100, max:100, step:1, unit:'%', get:() => v[st.colors][j], set:x => { v[st.colors][j] = x; }}));
  ui.radio({k:'method', label:t('method'), options:[['relative', t('relativeM')], ['absolute', t('absoluteM')]], get:() => v.method, set:x => { v.method = x; }});
});
DIALOGS['image.adjustments.colorLookup'] = init => Dlg.open({id:'image.adjustments.colorLookup', preview:'layer',
  v:Object.assign({lut:'none', interpolation:'trilinear', dither:false}, init || {}),
  params:v => { const p = {interpolation:v.interpolation, dither:v.dither}; if (v.data) Object.assign(p, {data:v.data, fileName:v.fileName}); else p.lut = v.lut; return p; },
  build(ui, v){
    ui.select({k:'lut', label:t('lutFile'), options:[['none', t('none')]].concat(LOOKS.map(([id]) => [id, Lang.t('psimg.look.' + id)])).concat(v.data ? [['__file', v.fileName]] : []),
      get:() => v.data ? '__file' : v.lut, set:x => { if (x !== '__file'){ v.lut = x; delete v.data; delete v.fileName; } }, rebuild:true});
    const f = el('input', {type:'file', accept:'.cube', style:'display:none', data:{k:'cubeFile'}});
    f.onchange = () => { const file = f.files[0]; if (!file) return; file.text().then(txt => { v.data = txt; v.fileName = file.name; Dlg.changed(true); }); };
    ui.row('', [ui.button(t('loadCube'), () => f.click(), 'loadCube'), f]);
    ui.select({k:'interpolation', label:t('interpolation'), options:[['trilinear', t('trilinear')], ['tetrahedral', t('tetrahedral')]], get:() => v.interpolation, set:x => { v.interpolation = x; }});
    ui.check({k:'dither', label:t('dither'), get:() => v.dither, set:x => { v.dither = x; }});
  }});
DIALOGS['image.adjustments.shadowsHighlights'] = init => Dlg.open({id:'image.adjustments.shadowsHighlights', preview:'layer', v:Object.assign({}, SH_DEFAULT, init || {}),
  build(ui, v){
    ui.sec(t('shadows')); ui.sl(v, 'shadowAmount', t('amount'), 0, 100, 1, '%'); ui.sl(v, 'shadowTone', t('toneW'), 0, 100, 1, '%'); ui.sl(v, 'shadowRadius', t('radius'), 0, 2500, 1, 'px');
    ui.sec(t('highlights')); ui.sl(v, 'highlightAmount', t('amount'), 0, 100, 1, '%'); ui.sl(v, 'highlightTone', t('toneW'), 0, 100, 1, '%'); ui.sl(v, 'highlightRadius', t('radius'), 0, 2500, 1, 'px');
    ui.sec(t('adjustments')); ui.sl(v, 'color', t('colorCorr'), -100, 100, 1); ui.sl(v, 'midtone', t('midtone'), -100, 100, 1);
    ui.sl(v, 'blackClip', t('blackClip'), 0, 50, 0.01); ui.sl(v, 'whiteClip', t('whiteClip'), 0, 50, 0.01);
  }});
DIALOGS['image.adjustments.replaceColor'] = init => Dlg.open({id:'image.adjustments.replaceColor', preview:'layer',
  v:Object.assign({color:hexOf(fgColor()), fuzziness:40, hue:0, saturation:0, lightness:0}, init || {}),
  build(ui, v){
    ui.color({k:'color', label:t('color'), get:() => v.color, set:x => { v.color = x; }});
    ui.sl(v, 'fuzziness', t('fuzziness'), 0, 200, 1);
    ui.sec(t('replacement'));
    ui.sl(v, 'hue', t('hue'), -180, 180, 1, '°'); ui.sl(v, 'saturation', t('saturation'), -100, 100, 1); ui.sl(v, 'lightness', t('lightness'), -100, 100, 1);
  }});
const layerOptions = () => [['merged', t('merged')]].concat([...Doc.layers].reverse().map(L => [L.id, L.name]));
DIALOGS['image.adjustments.matchColor'] = init => Dlg.open({id:'image.adjustments.matchColor', preview:'layer',
  v:Object.assign({luminance:100, intensity:100, fade:0, neutralize:false, source:-1, sourceLayer:'merged', useSelectionInSource:false, useSelectionInTarget:false}, init || {}),
  build(ui, v){
    ui.sec(t('target').replace(/[：:]$/, '') + '：' + ((Doc.active() || {}).name || ''));
    ui.check({k:'useSelectionInTarget', label:t('useSelTgt'), get:() => v.useSelectionInTarget, set:x => { v.useSelectionInTarget = x; }, disabled:!Doc.sel});
    ui.sl(v, 'luminance', t('luminance'), 1, 200, 1); ui.sl(v, 'intensity', t('intensity'), 1, 200, 1); ui.sl(v, 'fade', t('fade'), 0, 100, 1);
    ui.check({k:'neutralize', label:t('neutralize'), get:() => v.neutralize, set:x => { v.neutralize = x; }});
    ui.select({k:'source', label:t('source'), options:[[-1, t('none')], [0, t('thisDoc')]], get:() => v.source, set:x => { v.source = +x; }, rebuild:true});
    ui.select({k:'sourceLayer', label:t('layer'), options:layerOptions(), get:() => v.sourceLayer, set:x => { v.sourceLayer = x; }, disabled:v.source !== 0});
    ui.check({k:'useSelectionInSource', label:t('useSelSrc'), get:() => v.useSelectionInSource, set:x => { v.useSelectionInSource = x; }, disabled:!Doc.sel || v.source !== 0});
  }});
DIALOGS['image.adjustments.hdrToning'] = init => Dlg.open({id:'image.adjustments.hdrToning', preview:'flatten', v:Object.assign({}, HDR_DEFAULT, init || {}),
  build(ui, v){
    ui.sec(t('edgeGlow')); ui.sl(v, 'radius', t('radius'), 1, 500, 1, 'px'); ui.sl(v, 'strength', t('strength'), 0.1, 4, 0.01);
    ui.sec(t('toneDetail')); ui.sl(v, 'gamma', t('gamma'), 0.1, 2, 0.01); ui.sl(v, 'exposure', t('exposure'), -5, 5, 0.01); ui.sl(v, 'detail', t('detail'), -100, 300, 1, '%');
    ui.sec(t('advanced')); ui.sl(v, 'shadow', t('shadow'), -100, 100, 1, '%'); ui.sl(v, 'highlight', t('highlight'), -100, 100, 1, '%');
    ui.sl(v, 'vibrance', t('vibrance'), -100, 100, 1, '%'); ui.sl(v, 'saturation', t('saturation'), -100, 100, 1, '%');
  }});
const CH_OPTS = () => [['composite', t('chComposite')], ['red', t('chRed')], ['green', t('chGreen')], ['blue', t('chBlue')], ['transparency', t('chTransparency')], ['selection', t('chSelection')]];
const BLEND_OPTS = () => SEP_MODES.filter(m => m !== 'subtract').map(m => [m, Lang.t('psimg.mode.' + m)]).concat([['add', t('add')], ['subtract', t('subtract')]]);
DIALOGS['image.applyImage'] = init => Dlg.open({id:'image.applyImage', preview:'layer',
  v:Object.assign({sourceLayer:'merged', sourceChannel:'composite', sourceInvert:false, blending:'multiply', opacity:100, scale:1, offset:0, preserveTransparency:false}, init || {}),
  build(ui, v){
    ui.sec(t('source').replace(/[：:]$/, ''));
    ui.select({k:'sourceLayer', label:t('layer'), options:layerOptions(), get:() => v.sourceLayer, set:x => { v.sourceLayer = x; }});
    ui.select({k:'sourceChannel', label:t('channel'), options:CH_OPTS(), get:() => v.sourceChannel, set:x => { v.sourceChannel = x; }});
    ui.check({k:'sourceInvert', label:t('invert'), get:() => v.sourceInvert, set:x => { v.sourceInvert = x; }});
    ui.sec(t('target').replace(/[：:]$/, '') + '：' + ((Doc.active() || {}).name || ''));
    ui.select({k:'blending', label:t('blending'), options:BLEND_OPTS(), get:() => v.blending, set:x => { v.blending = x; }, rebuild:true});
    ui.sl(v, 'opacity', t('opacity'), 0, 100, 1, '%');
    if (v.blending === 'add' || v.blending === 'subtract'){ ui.number({k:'scale', label:t('scale'), min:1, max:2, step:0.001, get:() => v.scale, set:x => { v.scale = x; }}); ui.number({k:'offset', label:t('offsetV'), min:-255, max:255, step:1, get:() => v.offset, set:x => { v.offset = x; }}); }
    ui.check({k:'preserveTransparency', label:t('preserveTr'), get:() => v.preserveTransparency, set:x => { v.preserveTransparency = x; }});
  }});
DIALOGS['image.calculations'] = init => Dlg.open({id:'image.calculations',
  v:Object.assign({source1Layer:'merged', source1Channel:'composite', source1Invert:false, source2Layer:'merged', source2Channel:'composite', source2Invert:false, blending:'multiply', opacity:100, scale:1, offset:0, result:'selection'}, init || {}),
  build(ui, v){
    ['source1', 'source2'].forEach(s => {
      ui.sec(t(s));
      ui.select({k:s + 'Layer', label:t('layer'), options:layerOptions(), get:() => v[s + 'Layer'], set:x => { v[s + 'Layer'] = x; }});
      ui.select({k:s + 'Channel', label:t('channel'), options:[['composite', t('gray')]].concat(CH_OPTS().slice(1)), get:() => v[s + 'Channel'], set:x => { v[s + 'Channel'] = x; }});
      ui.check({k:s + 'Invert', label:t('invert'), get:() => v[s + 'Invert'], set:x => { v[s + 'Invert'] = x; }});
    });
    ui.select({k:'blending', label:t('blending'), options:BLEND_OPTS(), get:() => v.blending, set:x => { v.blending = x; }, rebuild:true});
    ui.sl(v, 'opacity', t('opacity'), 0, 100, 1, '%');
    if (v.blending === 'add' || v.blending === 'subtract'){ ui.number({k:'scale', label:t('scale'), min:1, max:2, step:0.001, get:() => v.scale, set:x => { v.scale = x; }}); ui.number({k:'offset', label:t('offsetV'), min:-255, max:255, step:1, get:() => v.offset, set:x => { v.offset = x; }}); }
    ui.select({k:'result', label:t('result'), options:[['selection', t('chSelection')], ['newDocument', t('newDocument')]], get:() => v.result, set:x => { v.result = x; }});
  }});

/* ── 图像大小／画布大小（sizing.rs）：栏位存像素，单位只是显示 ── */
const UNITS = [['px', 'uPx'], ['percent', 'uPercent'], ['in', 'uIn'], ['cm', 'uCm'], ['mm', 'uMm'], ['pt', 'uPt'], ['pica', 'uPica']];
const toUnit = (px, u, orig, res) => u === 'percent' ? px / Math.max(orig, 1) * 100 : u === 'in' ? px / Math.max(res, 1) : u === 'cm' ? px / Math.max(res, 1) * 2.54
  : u === 'mm' ? px / Math.max(res, 1) * 25.4 : u === 'pt' ? px / Math.max(res, 1) * 72 : u === 'pica' ? px / Math.max(res, 1) * 6 : px;
const fromUnit = (v, u, orig, res) => u === 'percent' ? v * orig / 100 : u === 'in' ? v * res : u === 'cm' ? v / 2.54 * res : u === 'mm' ? v / 25.4 * res : u === 'pt' ? v / 72 * res : u === 'pica' ? v / 6 * res : v;
const humanBytes = b => b >= 1073741824 ? (b / 1073741824).toFixed(2) + 'G' : b >= 1048576 ? (b / 1048576).toFixed(1) + 'M' : Math.max(b / 1024, 1).toFixed(0) + 'K';
function dimRow(ui, v, st, key, origKey, label){
  const res = v.resolution || st.origRes, orig = st[origKey], unit = st.unit;
  const n = el('input', {type:'number', step:unit === 'px' ? 1 : 0.01, value:fmtNum(toUnit(v[key], unit, orig, res), unit === 'px' ? 1 : 0.01), disabled:!!st.locked, data:{k:key}});
  n.addEventListener('change', () => {
    const x = Number(n.value); if (!isFinite(x)) return;
    const px = fromUnit(x, unit, orig, res); v[key] = unit === 'px' ? Math.round(px) : px;
    if (st.constrain && st.linked){ const other = key === 'width' ? 'height' : 'width', oo = key === 'width' ? st.origH : st.origW;
      v[other] = Math.max(1, Math.round(v[key] * oo / Math.max(orig, 1))); }
    Dlg.changed(true);
  });
  const us = el('select', {data:{k:'unit'}}); UNITS.forEach(([u, lk]) => us.appendChild(el('option', {value:u, selected:u === unit}, [t(lk)])));
  us.onchange = () => { st.unit = us.value; Dlg.changed(true); };
  return ui.row(label, [n, us]);
}
DIALOGS['image.imageSize'] = init => {
  const st = {origW:Doc.width, origH:Doc.height, origRes:Doc.dpi || 72, unit:'px', constrain:true, linked:true};
  Dlg.open({id:'image.imageSize', state:st, v:Object.assign({width:Doc.width, height:Doc.height, resolution:Doc.dpi || 72, resample:'bicubic'}, init || {}),
    params:v => { const p = {resolution:v.resolution, resample:v.resample}; if (v.resample !== 'none'){ p.width = Math.round(v.width); p.height = Math.round(v.height); } return p; },
    build(ui, v){
      const rs = v.resample !== 'none';
      st.locked = !rs;
      ui.row(t('imageSizeInfo'), [el('span', {}, [humanBytes(Math.round(v.width) * Math.round(v.height) * 4) + ' (' + t('was') + ' ' + humanBytes(st.origW * st.origH * 4) + ')'])]);
      ui.row(t('dimensions'), [el('span', {data:{k:'dims'}}, [Math.round(v.width) + ' px × ' + Math.round(v.height) + ' px'])]);
      dimRow(ui, v, st, 'width', 'origW', t('width'));
      dimRow(ui, v, st, 'height', 'origH', t('height'));
      ui.check({k:'constrain', label:'🔗 ' + t('constrain'), get:() => st.constrain, set:x => { st.constrain = x; }});
      ui.number({k:'resolution', label:t('resolution'), min:1, max:30000, step:1, get:() => v.resolution, rebuild:true, after:[el('span', {}, [t('ppi')])],
        set:x => { v.resolution = Math.max(1, x); if (!rs){ v.width = st.origW; v.height = st.origH; } }});
      ui.check({k:'resampleOn', label:t('resample'), get:() => rs, rebuild:true, set:on => { v.resample = on ? 'bicubic' : 'none'; if (!on){ v.width = st.origW; v.height = st.origH; } }});
      if (rs) ui.select({k:'resample', label:'', get:() => v.resample, set:x => { v.resample = x; },
        options:[['preserveDetails', t('rsPreserve')], ['bicubic', t('rsBicubic')], ['lanczos', t('rsLanczos')], ['bilinear', t('rsBilinear')], ['nearest', t('rsNearest')]]});
    }});
};
const ANCHORS = ['topLeft', 'top', 'topRight', 'left', 'center', 'right', 'bottomLeft', 'bottom', 'bottomRight'];
DIALOGS['image.canvasSize'] = init => {
  const st = {origW:Doc.width, origH:Doc.height, origRes:Doc.dpi || 72, unit:'px'};
  Dlg.open({id:'image.canvasSize', state:st, v:Object.assign({width:Doc.width, height:Doc.height, relative:false, anchor:'center', extensionColor:'background'}, init || {}),
    params:v => ({width:v.width, height:v.height, relative:v.relative, anchor:v.anchor, extensionColor:v.extensionColor}),
    build(ui, v){
      ui.sec(t('currentSize'));
      ui.row(t('size'), [el('span', {}, [humanBytes(st.origW * st.origH * 4)])]);
      ui.row(t('width'), [el('span', {}, [st.origW + ' px'])]); ui.row(t('height'), [el('span', {}, [st.origH + ' px'])]);
      const nw = v.relative ? st.origW + v.width : v.width, nh = v.relative ? st.origH + v.height : v.height;
      ui.sec(t('newSize') + '  ' + humanBytes(Math.max(nw, 0) * Math.max(nh, 0) * 4));
      dimRow(ui, v, st, 'width', 'origW', t('width'));
      dimRow(ui, v, st, 'height', 'origH', t('height'));
      ui.check({k:'relative', label:t('relative'), get:() => v.relative, rebuild:true,
        set:rel => { v.width = rel ? v.width - st.origW : v.width + st.origW; v.height = rel ? v.height - st.origH : v.height + st.origH; v.relative = rel; }});
      /* 九宫格定位（sizing.rs:318 anchor_grid；选中格画实心方块，相邻格画朝外的箭头） */
      const g = el('div', {className:'anc'}), ci = ANCHORS.indexOf(v.anchor), ax = ci % 3, ay = Math.floor(ci / 3);
      const dw = nw - st.origW, dh = nh - st.origH;
      ANCHORS.forEach((a, i) => {
        const x = i % 3, y = Math.floor(i / 3), dx = x - ax, dy = y - ay;
        let mark = '';
        if (i === ci) mark = '■';
        else if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1){ const sx = dw < 0 ? -dx : dx, sy = dh < 0 ? -dy : dy; mark = {'-1,-1':'↖', '0,-1':'↑', '1,-1':'↗', '-1,0':'←', '1,0':'→', '-1,1':'↙', '0,1':'↓', '1,1':'↘'}[sx + ',' + sy] || ''; }
        const b = el('button', {type:'button', className:i === ci ? 'on' : '', data:{k:'anchor', v:a}}, [mark]);
        b.onclick = () => { v.anchor = a; Dlg.changed(true); };
        g.appendChild(b);
      });
      ui.row(t('anchor'), [g]);
      ui.select({k:'extensionColor', label:t('extColor'), get:() => v.extensionColor, set:x => { v.extensionColor = x; },
        options:[['foreground', t('foreground')], ['background', t('background')], ['white', t('white')], ['black', t('black')], ['transparent', t('transparent')]]});
    }});
};
DIALOGS['image.rotation.arbitrary'] = init => Dlg.open({id:'image.rotation.arbitrary', title:t('rotateCanvas'), v:Object.assign({angle:0, direction:'cw', interpolation:'bicubic'}, init || {}),
  build(ui, v){
    ui.number({k:'angle', label:t('angle'), min:-359.99, max:359.99, step:0.01, get:() => v.angle, set:x => { v.angle = x; }});
    ui.radio({k:'direction', label:'', options:[['cw', t('cw')], ['ccw', t('ccw')]], get:() => v.direction, set:x => { v.direction = x; }});
    ui.select({k:'interpolation', label:t('interpolation'), options:[['bicubic', t('iBicubic')], ['bilinear', t('iBilinear')], ['nearest', t('iNearest')]], get:() => v.interpolation, set:x => { v.interpolation = x; }});
  }});
DIALOGS['image.trim'] = init => Dlg.open({id:'image.trim', v:Object.assign({basedOn:'transparent', top:true, bottom:true, left:true, right:true}, init || {}),
  build(ui, v){
    ui.sec(t('basedOn'));
    ui.radio({k:'basedOn', label:'', options:[['transparent', t('transparentPx')]], get:() => v.basedOn, set:x => { v.basedOn = x; }});
    ui.radio({k:'basedOn', label:'', options:[['topLeft', t('topLeftPx')]], get:() => v.basedOn, set:x => { v.basedOn = x; }});
    ui.radio({k:'basedOn', label:'', options:[['bottomRight', t('bottomRightPx')]], get:() => v.basedOn, set:x => { v.basedOn = x; }});
    ui.sec(t('trimAway'));
    ['top', 'bottom', 'left', 'right'].forEach(k => ui.check({k, label:t(k), get:() => v[k], set:x => { v[k] = x; }}));
  }});
DIALOGS['image.duplicate'] = init => Dlg.open({id:'image.duplicate', title:t('dupTitle'),
  v:Object.assign({name:(document.title.replace(/\s*—.*$/, '') || 'Untitled') + t('copySuffix'), mergedOnly:false}, init || {}),
  build(ui, v){
    ui.text({k:'name', label:t('dupAs'), get:() => v.name, set:x => { v.name = x; }});
    ui.check({k:'mergedOnly', label:t('dupMerged'), get:() => v.mergedOnly, set:x => { v.mergedOnly = x; }, disabled:Doc.layers.length < 2});
  }});

/* ═══════════ 快捷键（照菜单树上本菜单的 key；只在 PS 菜单〔像素／文字层〕时生效） ═══════════ */
const comboOf = e => { const p = []; if (e.ctrlKey || e.metaKey) p.push('Ctrl'); if (e.altKey) p.push('Alt'); if (e.shiftKey) p.push('Shift');
  const k = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key; p.push(k); return p.join('+'); };
const normCombo = s => { const parts = String(s).split('+'), key = parts.pop(); return ['Ctrl', 'Alt', 'Shift'].filter(m => parts.includes(m)).concat(key.toUpperCase()).join('+'); };
window.addEventListener('keydown', e => {
  if (Dlg.cur || e.defaultPrevented) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const tg = e.target; if (tg && (tg.isContentEditable || /^(input|select|textarea)$/i.test(tg.tagName))) return;
  if (!window.Menubar || Menubar.app !== 'ps' || !window.MenuTrees || !MenuTrees.ps.image) return;
  const want = normCombo(comboOf(e));
  let hit = null;
  MenuTrees.walk('ps', it => { if (!hit && it.key && it.impl && it.id && it.id.startsWith('image.') && normCombo(it.key) === want) hit = it; });
  if (!hit || !Menubar.enabled(hit)) return;
  e.preventDefault(); e.stopPropagation();
  Menubar.run(hit);
}, true);

/* ═══════════ 给测试与 agent ═══════════ */
window.PsImage = {
  version:'1',
  fromParams, toParams, applyAdjustment, curveLut, CurveKit, levelsQ, srgbToLab, labToSrgb, builtinLut, parseLutText, rotatedSize,
  PIXEL_OPS, DIALOGS, openDialog,
  dlg:{
    get cur(){ return Dlg.cur; },
    isOpen:() => Dlg.isOpen(),
    values:() => Dlg.cur ? JSON.parse(JSON.stringify(Dlg.cur.v)) : null,
    params:() => Dlg.cur ? Dlg.params() : null,
    set(k, val){ if (!Dlg.cur) return false; Dlg.cur.v[k] = val; Dlg.changed(true); return true; },
    ok:() => Dlg.ok(), cancel:() => Dlg.cancel(), preview:() => Dlg.runPreview()
  },
  _dup:DUP
};
})();

/* ═══════════════════════════════════════════════════════════════════════════════
   图像 ▸ 模式（位图／灰度／双色调／索引颜色／RGB／CMYK／Lab／多通道、8/16/32 位/通道、颜色表）、
   变量 ▸ 定义／数据组、应用数据组、陷印、分析（设置测量比例／选择数据点／记录测量／标尺工具／计数工具／置入比例标记）
   对照源（photocraft/crates/…，逐段翻成 JS）：
     engine/src/image_cmds.rs 310-335, 392-426   convert_mode／convert_depth（同深度不动、不留历史）与参数表
     engine/src/color_cmds.rs 26-173, 391-673    工作空间（sRGB／sGray／合成 CMYK／Lab D50）、相对比色＋黑场补偿预设、convert_document（像素＋填色／文字／形状／样式颜色）、
                                                 convert_mode（多通道转出、同模式不动、profile 要对得上模式）
     cms/src/transform.rs 98-213, 550-665        link_stages、connection（BPC：XYZ 线性把源黑点对到目的黑点、白点不动）、black_point、fix_white（白进白出）
     cms/src/builtin.rs 1-124                    sGray＝sRGB 曲线（灰 v 看起来＝RGB(v,v,v)）、合成 CMYK、Lab D50 恒等
     cms/src/synth.rs 1-449                      合成「铜版纸 CMYK」：Yule–Nielsen 修正 Neugebauer（n=2）、ISO 12647-2 Lab 目标、网点扩大、
                                                 GCR 黑版＋有界 LM 解 CMY（总墨量 300%）、21³ BToA 表（相对比色＝裁切；可感知／饱和度＝先压进色域）
     cms/src/clut.rs 64-153                      四面体插值；cms/src/math.rs 8-108 Lab↔XYZ（D50 0.9642/1/0.8249、ε=216/24389、κ=24389/27）
     color/src/convert.rs 148-212                sRGB 曲线、srgb_to_lab／lab_to_srgb（Lab 文件显示用）、rgb_to_gray（Rec.601：位图／from_rgba 用）
     raster/src/lib.rs 569-584                   from_rgba：灰＝rgb_to_gray、Lab 8 位编码 L/100、(a+128)/255
     engine/src/mode_cmds.rs 126-484             single_layer、索引颜色、颜色表（预设表、改表＝按旧表索引换色）、位图、双色调（默认油墨、显示＝在合成上加渐变映射）
     doc/src/mode.rs 1-115                       ColorTable.nearest／rgb、DuotoneInk.density、Duotone.render、display_adjustment（33 个色标）、curve_eval
     algo/src/quantize.rs 1-561                  调色板（精确／系统 Mac／Windows／Web／平均／可感知／可选择／随样性：中位切割＋k-means）、强制颜色、
                                                 抖动（Floyd–Steinberg 扩散／Bayer 图案／杂色）、位图（50% 阈值／图案仿色／扩散仿色／半调网屏）
     engine/src/multichannel_cmds.rs 1-217 ＋ compose/src/multichannel.rs 1-44   多通道：油墨通道、印在白纸上的显示、转回（通道数对得上＝照通道解读，否则照印出来的样子）
     engine/src/variables_cmds.rs 1-432          变量定义／数据组／应用数据组（可见性、文本替换、像素替换 fit|fill|asIs|conform＋九宫对齐＋剪切）
     engine/src/trap_cmds.rs 1-56 ＋ algo/src/trap.rs 1-63   陷印：只有 CMYK 能做；四色版各自做最大值膨胀，只吃进本来就有墨的地方（纸白不动）
     engine/src/analysis_cmds.rs 1-1196 ＋ doc/src/analysis.rs 1-89   测量比例、数据点、记录测量（选区：8 连通特征＋marching squares 周长＋灰度统计）、
                                                 标尺（角度、量角器、拉直图层）、计数（计数组、加／删／移／清）、测量记录（列出／删除／CSV）、比例标记
   🔴 我们的资料模型：画布永远是 RGBA 8 位 ⇒ 每个模式的像素先照原码转到该模式（含该模式在 8／16 位时的量化）再照原码的显示路径转回 sRGB 存进画布，
      存着的就是「这个模式显示出来的样子」；转回 RGB＝不动像素（原码 CMYK／Lab／灰→sRGB 也就是显示那一条）。
      双色调照原码：像素留灰阶，显示与导出时在合成上叠油墨（包 window.composite，见 compositeHook）；多通道照原码：没有图层，油墨通道印在白纸上当底。
      Doc 新栏位：mode／depth／colorTable／duotone／multichannel／variables／measurement —— 这里包 History.snap/restore/restoreInPlace、Doc.reset、
      Project.serialize/load，让它们进历史、进工程档、开新档清空。 */
(function(){
'use strict';
if (window.PsImageMode) return;                 // 防双载

/* ═══════════ 小工具 ═══════════ */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : (v || 0);
const isNum = v => typeof v === 'number' && isFinite(v);
const num = (p, k, d) => (p && isNum(p[k])) ? p[k] : d;
const str = (p, k, d) => (p && typeof p[k] === 'string') ? p[k] : d;
const fr = Math.fround;
class Bad extends Error {}
const bad = (cmd, msg) => { throw new Bad(cmd + ': ' + msg); };
const T = k => Lang.t('psmode.' + k);
function newCanvas(w, h){ const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return {canvas:c, ctx:c.getContext('2d', {willReadFrequently:true})}; }
const redraw = () => { if (window.UI){ if (UI.refresh) UI.refresh(); else if (UI.draw) UI.draw(); } };
const to8 = v => Math.round(clamp01(v) * 255);                         // quantize.rs:61 to8
const hex2 = v => to8(v).toString(16).padStart(2, '0');
const hexOf = c => '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
const hex8 = c => '#' + c.map(v => (v & 255).toString(16).padStart(2, '0')).join('');
/* mode_cmds.rs:214 parse_color：「#rrggbb」或 [r,g,b]（0..255） */
function parseColor8(v){
  if (typeof v === 'string'){ const s = v.replace(/^#/, ''); if (!/^[0-9a-fA-F]{6}/.test(s)) return null; return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16)); }
  if (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(isNum)) return v.slice(0, 3).map(x => clamp(Math.round(x), 0, 255));
  return null;
}
const docMode = () => Doc.mode || 'rgb';
const docDepth = () => Doc.depth || 8;
const bgName = () => Lang.t('layer.bg');

/* 一步历史（原码 s.edit）：先 push，失败就原地退回并丢掉这一步 */
function edit(fn){
  History.push();
  let r;
  try { r = fn(); }
  catch (e){ History.restoreInPlace(History.past.pop()); throw e; }
  if (r && r.ok === false) History.restoreInPlace(History.past.pop());
  return r;
}
function wrap(fn){ return p => { try { return fn(p || {}); } catch (e){ if (e instanceof Bad) return {ok:false, error:e.message}; throw e; } }; }

/* ═══════════ Doc 新栏位进历史／工程档／新文件清空 ═══════════ */
const FIELDS = ['mode', 'depth', 'colorTable', 'duotone', 'multichannel', 'variables', 'measurement'];
/* 多通道的油墨资料（Uint8Array）一律整个换掉、不原地改 ⇒ 快照存参照就够 */
const cloneField = (k, v) => v == null ? null : k === 'multichannel' ? {inks:v.inks.map(i => Object.assign({}, i, {color:i.color.slice()}))} : (typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
function grabFields(){ const o = {}; FIELDS.forEach(k => { o[k] = cloneField(k, Doc[k]); }); return o; }
function putFields(o){ FIELDS.forEach(k => { const v = o ? o[k] : null; if (v == null) delete Doc[k]; else Doc[k] = cloneField(k, v); }); }
if (!History._psModeShim){
  const s0 = History.snap, r0 = History.restore, i0 = History.restoreInPlace;
  History.snap = function(){ const s = s0.apply(this, arguments); s.psMode = grabFields(); return s; };
  History.restore = function(s){ const r = r0.apply(this, arguments); if (s && s.psMode) putFields(s.psMode); return r; };
  History.restoreInPlace = function(s){ const r = i0.apply(this, arguments); if (s && s.psMode) putFields(s.psMode); return r; };
  History._psModeShim = true;
}
if (!Doc._psModeReset){
  const r0 = Doc.reset;
  Doc.reset = function(){ FIELDS.forEach(k => delete Doc[k]); return r0.apply(this, arguments); };
  Doc._psModeReset = true;
}
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const PJ = typeof Project !== 'undefined' ? Project : (window.DilinCanvas && DilinCanvas.project);   // engine.js 的 const Project 不在 window 上
if (PJ && !PJ._psMode){
  const ser = PJ.serialize, load = PJ.load;
  PJ.serialize = function(){
    const o = ser.apply(this, arguments), f = grabFields();
    if (f.multichannel) f.multichannel = {inks:f.multichannel.inks.map(i => ({name:i.name, color:i.color, data:b64(i.data)}))};
    if (FIELDS.some(k => f[k] != null)) o.psMode = f;
    return o;
  };
  PJ.load = async function(json){
    const r = await load.apply(this, arguments);
    const f = json && json.psMode;
    if (f){
      if (f.multichannel) f.multichannel = {inks:f.multichannel.inks.map(i => ({name:i.name, color:i.color, data:unb64(i.data)}))};
      putFields(f); redraw();
    }
    return r;
  };
  PJ._psMode = true;
}

/* ═══════════ 颜色（color/src/convert.rs ＋ cms） ═══════════ */
const s2l = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const l2s = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
const LIN8 = Float64Array.from({length:256}, (_, i) => s2l(i / 255));
const rgbToGray = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;      // convert.rs:210（Rec.601）
/* sRGB → XYZ（D50 相对，PCS）与反向：convert.rs:197／187 的 Bradford 矩阵 */
const M_FWD = [[0.436074, 0.385064, 0.143080], [0.222504, 0.716878, 0.060618], [0.013932, 0.097104, 0.714173]];
const M_INV = [[3.133856, -1.616867, -0.490615], [-0.978768, 1.916142, 0.033454], [0.071945, -0.228991, 1.405243]];
const mul3 = (m, v) => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
/* sRGB → sGray（工作灰＝sRGB 曲线）：PCS 只取 Y，再过 sGray 的反曲线；两边黑点都是 0 ⇒ 没有 BPC 位移 */
const sgrayOf8 = (r, g, b) => l2s(clamp01(0.222504 * LIN8[r] + 0.716878 * LIN8[g] + 0.060618 * LIN8[b]));
/* convert.rs:197 srgb_to_lab／:179 lab_to_srgb（D50 0./1/0.82521） */
const D50c = [0.96422, 1.0, 0.82521];
function srgbToLab(r, g, b){
  const lin = [s2l(r), s2l(g), s2l(b)], x = mul3(M_FWD, lin).map((v, i) => v / D50c[i]);
  const e = Math.pow(6 / 29, 3), k = 3 * Math.pow(6 / 29, 2), f = t => t > e ? Math.cbrt(t) : t / k + 4 / 29;
  const fx = f(x[0]), fy = f(x[1]), fz = f(x[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function labToSrgb(L, a, b){
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const fi = t => t > 6 / 29 ? t * t * t : 3 * Math.pow(6 / 29, 2) * (t - 4 / 29);
  const xyz = [fi(fx) * D50c[0], fi(fy) * D50c[1], fi(fz) * D50c[2]];
  return mul3(M_INV, xyz).map(v => l2s(clamp01(v)));
}
/* cms/src/math.rs：Lab↔XYZ（PCS D50＝0.9642/1/0.8249） */
const W50 = [0.9642, 1.0, 0.8249], EPS = 216 / 24389, KAP = 24389 / 27;
const labF = t => t > EPS ? Math.cbrt(t) : (KAP * t + 16) / 116;
const labFi = f => { const f3 = f * f * f; return f3 > EPS ? f3 : (116 * f - 16) / KAP; };
const xyzToLab = (x, w) => { const fx = labF(x[0] / w[0]), fy = labF(x[1] / w[1]), fz = labF(x[2] / w[2]); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; };
const labToXyz = (l, w) => { const fy = (l[0] + 16) / 116, fx = fy + l[1] / 500, fz = fy - l[2] / 200; return [labFi(fx) * w[0], labFi(fy) * w[1], labFi(fz) * w[2]]; };
function invert3(m){
  const d = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  if (!isFinite(d) || Math.abs(d) < 1e-12) return null;
  const i = 1 / d;
  return [[(m[1][1] * m[2][2] - m[1][2] * m[2][1]) * i, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * i, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * i],
          [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) * i, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * i, (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * i],
          [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) * i, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * i, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * i]];
}

/* ── synth.rs：合成铜版纸 CMYK ── */
const CMYK_P = {tac:3.0, gcrStart:0.2, kMax:0.95, gcrGamma:1.1, tvi:[0.14, 0.14, 0.14, 0.17], gridB2A:21};
const YN = 2.0;
function CmykModel(tvi){
  const lab = (l, a, b) => labToXyz([l, a, b], W50);
  const w = lab(95, 0, -2);
  const base = [w, lab(55, -37, -50), lab(48, 74, -3), lab(24, 22, -46), lab(89, -5, 93), lab(50, -65, 27), lab(47, 68, 48), lab(23, 0, 0)];
  const k = lab(16, 0, 0), floor = 0.006, prim = [];
  for (let m = 0; m < 16; m++){
    const p = base[m & 7];
    prim.push(m & 8 ? [0, 1, 2].map(i => { const s = floor * w[i]; return s + (p[i] - s) * (k[i] - s) / (w[i] - s); }) : p);
  }
  this.primN = prim.map(p => p.map(v => Math.pow(Math.max(v, 0), 1 / YN)));
  this.paper = w; this.tvi = tvi;
}
/* 绝对 XYZ：每色网点扩大（抛物线）→ Demichel 权重 → Yule–Nielsen 和（out 是长度 3 的阵列；不配置新物件，分色要叫上百万次） */
CmykModel.prototype.xyzInto = function(c0, c1, c2, c3, out){
  const t = this.tvi, P = this.primN;
  const g = (v, tv) => { v = v < 0 ? 0 : v > 1 ? 1 : v; v = v + 4 * tv * v * (1 - v); return v < 0 ? 0 : v > 1 ? 1 : v; };
  const a0 = g(c0, t[0]), a1 = g(c1, t[1]), a2 = g(c2, t[2]), a3 = g(c3, t[3]);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let m = 0; m < 16; m++){
    const w = ((m & 1) ? a0 : 1 - a0) * ((m & 2) ? a1 : 1 - a1) * ((m & 4) ? a2 : 1 - a2) * ((m & 8) ? a3 : 1 - a3);
    if (w === 0) continue;
    const p = P[m]; s0 += w * p[0]; s1 += w * p[1]; s2 += w * p[2];
  }
  out[0] = s0 * s0; out[1] = s1 * s1; out[2] = s2 * s2;                 // YN = 2
  return out;
};
CmykModel.prototype.xyz = function(c){ return this.xyzInto(c[0], c[1], c[2], c[3], [0, 0, 0]); };
/* ICC 相对 Lab（纸白＝L* 100） */
CmykModel.prototype.labInto = function(c0, c1, c2, c3, out){
  this.xyzInto(c0, c1, c2, c3, out);
  const fx = labF(out[0] / this.paper[0]), fy = labF(out[1] / this.paper[1]), fz = labF(out[2] / this.paper[2]);   // x·W50/paper ÷ W50
  out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz);
  return out;
};
CmykModel.prototype.lab = function(c){ return this.labInto(c[0], c[1], c[2], c[3], [0, 0, 0]); };
/* PS 2020 的预设工作用 CMYK「U.S. Web Coated (SWOP) v2」的近似：
   印刷特征＝SWOP 实测查表（menus/impl/cmyk-swop.js：CGATS TR003 SWOP Coated，相对比色 Lab）；分色照下面 SWOP_P（总墨量 300%、黑版上限、GCR 曲线照 PS 显示的数字调）。
   没载到查表档才退回原码的合成铜版纸模型（synth.rs）。 */
function SwopModel(){ this.paper = labToXyz(window.SwopCmyk.paperLab, W50); this.tvi = null; }
SwopModel.prototype.labInto = function(c0, c1, c2, c3, out){ return window.SwopCmyk.labInto(c0, c1, c2, c3, out); };
SwopModel.prototype.lab = function(c){ return this.labInto(c[0], c[1], c[2], c[3], [0, 0, 0]); };
SwopModel.prototype.xyzInto = function(c0, c1, c2, c3, out){       // 绝对 XYZ：相对 Lab → XYZ（W50 白）× 纸白
  this.labInto(c0, c1, c2, c3, out);
  const x = labToXyz(out, W50);
  out[0] = x[0] * this.paper[0] / W50[0]; out[1] = x[1] * this.paper[1] / W50[1]; out[2] = x[2] * this.paper[2] / W50[2];
  return out;
};
SwopModel.prototype.xyz = function(c){ return this.xyzInto(c[0], c[1], c[2], c[3], [0, 0, 0]); };
const SWOP_P = {tac:3.0, gcrStart:0.44, kMax:0.90, gcrGamma:1.0, gridB2A:33};
const useSwop = () => !!window.SwopCmyk;
/* solve_cmy：给 K，最小化 ΔE76，C+M+Y ≤ limit（投影 Levenberg–Marquardt、数值雅可比；逐步照 synth.rs:147-236） */
function solveCmy(model, target, k, limit, seeds){
  const X = [0, 0, 0], E = [0, 0, 0], tmp = [0, 0, 0], L3 = [0, 0, 0];
  const project = (x0, x1, x2, out) => {
    out[0] = x0; out[1] = x1; out[2] = x2;
    for (let it = 0; it < 4; it++){
      for (let i = 0; i < 3; i++) out[i] = out[i] < 0 ? 0 : out[i] > 1 ? 1 : out[i];
      const s = out[0] + out[1] + out[2];
      if (s <= limit + 1e-12) break;
      const active = Math.max(1, (out[0] > 0) + (out[1] > 0) + (out[2] > 0)), d = (s - limit) / active;
      for (let i = 0; i < 3; i++) if (out[i] > 0) out[i] -= d;
    }
    return out;
  };
  const err = (x, out) => { model.labInto(x[0], x[1], x[2], k, L3); out[0] = L3[0] - target[0]; out[1] = L3[1] - target[1]; out[2] = L3[2] - target[2]; return out[0] * out[0] + out[1] * out[1] + out[2] * out[2]; };
  const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], al = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0], xp = [0, 0, 0], ep = [0, 0, 0], xn = [0, 0, 0], en = [0, 0, 0];
  let bx0 = 0, bx1 = 0, bx2 = 0, bestF = Infinity;
  for (const seed of seeds){
    project(seed[0], seed[1], seed[2], X);
    let f = err(X, E), lambda = 1e-3;
    for (let it = 0; it < 60; it++){
      const h = 1e-5;
      for (let c = 0; c < 3; c++){ xp[0] = X[0]; xp[1] = X[1]; xp[2] = X[2]; xp[c] += h; err(xp, ep); for (let r = 0; r < 3; r++) J[r][c] = (ep[r] - E[r]) / h; }
      for (let r = 0; r < 3; r++){
        for (let c = 0; c < 3; c++) A[r][c] = J[0][r] * J[0][c] + J[1][r] * J[1][c] + J[2][r] * J[2][c];
        g[r] = -(J[0][r] * E[0] + J[1][r] * E[1] + J[2][r] * E[2]);
      }
      let improved = false;
      for (let t = 0; t < 8; t++){
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) al[r][c] = A[r][c];
        for (let d = 0; d < 3; d++) al[d][d] += lambda * (1 + A[d][d]);
        const inv = invert3(al); if (!inv){ lambda *= 10; continue; }
        const st = mul3(inv, g);
        project(X[0] + st[0], X[1] + st[1], X[2] + st[2], xn);
        const fn = err(xn, en);
        if (fn < f){
          const moved = Math.max(Math.abs(xn[0] - X[0]), Math.abs(xn[1] - X[1]), Math.abs(xn[2] - X[2]), 0);
          X[0] = xn[0]; X[1] = xn[1]; X[2] = xn[2]; E[0] = en[0]; E[1] = en[1]; E[2] = en[2]; f = fn;
          lambda = Math.max(lambda * 0.3, 1e-9); improved = moved > 1e-9; break;
        }
        lambda *= 10;
      }
      if (!improved || f < 1e-10) break;
    }
    if (f < bestF){ bx0 = X[0]; bx1 = X[1]; bx2 = X[2]; bestF = f; }
    if (bestF < 1e-6) break;
  }
  void tmp;
  return [[bx0, bx1, bx2], Math.sqrt(bestF)];
}
const SEEDS = [[0.3, 0.3, 0.3], [0.05, 0.05, 0.05], [0.8, 0.8, 0.8], [0.9, 0.2, 0.2], [0.2, 0.9, 0.9]];
/* separate：先不带黑解出 CMY → 灰成分起黑（GCR）→ 带黑再解 CMY（墨量上限扣掉黑） */
function separate(model, p, target, warm){
  const seeds = (warm ? [[warm[0], warm[1], warm[2]]] : []).concat(SEEDS);
  const cmy0 = solveCmy(model, target, 0, 3, seeds)[0];
  const g = Math.min(cmy0[0], cmy0[1], cmy0[2]);
  const k = g <= p.gcrStart ? 0 : p.kMax * Math.pow((g - p.gcrStart) / (1 - p.gcrStart), p.gcrGamma);
  const seeds2 = [[Math.max(cmy0[0] - k, 0), Math.max(cmy0[1] - k, 0), Math.max(cmy0[2] - k, 0)], cmy0].concat(seeds);
  const r = solveCmy(model, target, k, Math.max(p.tac - k, 0), seeds2);
  return [[r[0][0], r[0][1], r[0][2], k], r[1]];
}
/* Gbd：每个（L*, 色相）格的最大彩度（可感知意图压色域用） */
function Gbd(model, p){
  const lb = 41, hb = 72, cmax = new Float64Array(lb * hb), n = 21, TAU = Math.PI * 2;
  let blackL = 100;
  for (let ci = 0; ci < n; ci++) for (let mi = 0; mi < n; mi++) for (let yi = 0; yi < n; yi++) for (let ki = 0; ki < 11; ki++){
    const v = [ci / (n - 1), mi / (n - 1), yi / (n - 1), ki / 10];
    if (v[0] + v[1] + v[2] + v[3] > p.tac + 1e-9) continue;
    const lab = model.lab(v); blackL = Math.min(blackL, lab[0]);
    const c = Math.hypot(lab[1], lab[2]), h = ((Math.atan2(lab[2], lab[1]) % TAU) + TAU) % TAU;
    const li = clamp(Math.round(lab[0] / 100 * (lb - 1)), 0, lb - 1), hi = Math.round(h / TAU * hb) % hb;
    cmax[li * hb + hi] = Math.max(cmax[li * hb + hi], c);
  }
  const get = (v, l, h) => v[clamp(l, 0, lb - 1) * hb + (((h % hb) + hb) % hb)];
  const filled = new Float64Array(lb * hb), smooth = new Float64Array(lb * hb);
  for (let l = 0; l < lb; l++) for (let h = 0; h < hb; h++){ let m = 0; for (let dl = -1; dl <= 1; dl++) for (let dh = -1; dh <= 1; dh++) m = Math.max(m, get(cmax, l + dl, h + dh)); filled[l * hb + h] = m; }
  for (let l = 0; l < lb; l++) for (let h = 0; h < hb; h++){ let s = 0; for (let dl = -1; dl <= 1; dl++) for (let dh = -1; dh <= 1; dh++) s += get(filled, l + dl, h + dh); smooth[l * hb + h] = s / 9; }
  this.lb = lb; this.hb = hb; this.cmax = smooth; this.blackL = blackL;
}
Gbd.prototype.maxChroma = function(l, h){
  const TAU = Math.PI * 2, lp = clamp(l / 100, 0, 1) * (this.lb - 1), hp = ((((h % TAU) + TAU) % TAU) / TAU) * this.hb;
  const l0 = Math.floor(lp), h0 = Math.floor(hp), fl = lp - l0, fh = hp - h0, l1 = Math.min(l0 + 1, this.lb - 1), h0m = h0 % this.hb, h1m = (h0 + 1) % this.hb;
  const v = (a, b) => this.cmax[a * this.hb + b];
  const A = v(l0, h0m) + (v(l0, h1m) - v(l0, h0m)) * fh, B = v(l1, h0m) + (v(l1, h1m) - v(l1, h0m)) * fh;
  return A + (B - A) * fl;
};
Gbd.prototype.compress = function(lab){
  const l = this.blackL + clamp(lab[0], 0, 100) * (100 - this.blackL) / 100, c = Math.hypot(lab[1], lab[2]);
  if (c < 1e-9) return [l, 0, 0];
  const h = Math.atan2(lab[2], lab[1]), cm = Math.max(this.maxChroma(l, h), 1e-3), knee = 0.8 * cm;
  const c2 = c <= knee ? c : knee + (cm - knee) * Math.tanh((c - knee) / (cm - knee));
  return [l, c2 * Math.cos(h), c2 * Math.sin(h)];
};
const decodeV2 = v => [v[0] * 100 * 65535 / 65280, v[1] * 65535 / 256 - 128, v[2] * 65535 / 256 - 128];
const encodeV2 = l => [clamp01(l[0] / (100 * 65535 / 65280)), clamp01((l[1] + 128) * 256 / 65535), clamp01((l[2] + 128) * 256 / 65535)];
/* b2a_table：21³ 个 Lab 格点各解一次分色（沿 b 用上一格当热启动）。
   每一列 (L, a) 的热启动链彼此独立 ⇒ 用到哪一列才算哪一列（结果与整张先算好一模一样，只是不必一次算完 441 列） */
function b2aTable(model, p, gbd){
  const n = p.gridB2A;
  return {n, data:new Float32Array(n * n * n * 4), done:new Uint8Array(n * n), model, p, gbd};
}
function b2aRow(t, row){
  if (t.done[row]) return;
  const n = t.n, li = Math.floor(row / n), ai = row % n;
  let warm = null;
  for (let bi = 0; bi < n; bi++){
    const lab = decodeV2([li / (n - 1), ai / (n - 1), bi / (n - 1)]);
    const cmyk = separate(t.model, t.p, t.gbd ? t.gbd.compress(lab) : lab, warm)[0];
    warm = cmyk;
    for (let k = 0; k < 4; k++) t.data[(row * n + bi) * 4 + k] = fr(cmyk[k]);
  }
  t.done[row] = 1;
}
/* clut.rs:118 tetra：三维四面体插值（第一维最慢） */
function tetra(t, inp){
  const n = t.n, d = t.data, s = [n * n * 4, n * 4, 4], base = [0, 0, 0], r = [0, 0, 0];
  for (let k = 0; k < 3; k++){ const pp = clamp01(inp[k]) * (n - 1), i = Math.min(Math.floor(pp), n - 2); base[k] = i * s[k]; r[k] = pp - i; }
  if (t.done){ const i0 = base[0] / s[0], j0 = base[1] / s[1]; b2aRow(t, i0 * n + j0); b2aRow(t, i0 * n + j0 + 1); b2aRow(t, (i0 + 1) * n + j0); b2aRow(t, (i0 + 1) * n + j0 + 1); }   // 用到的四列先算好
  const b = base[0] + base[1] + base[2], [rx, ry, rz] = r, [sx, sy, sz] = s;
  let p1, p2, p3, w1, w2, w3;
  if (rx >= ry){
    if (ry >= rz){ p1 = b + sx; p2 = b + sx + sy; p3 = b + sx + sy + sz; w1 = rx; w2 = ry; w3 = rz; }
    else if (rx >= rz){ p1 = b + sx; p2 = b + sx + sz; p3 = b + sx + sy + sz; w1 = rx; w2 = rz; w3 = ry; }
    else { p1 = b + sz; p2 = b + sx + sz; p3 = b + sx + sy + sz; w1 = rz; w2 = rx; w3 = ry; }
  } else if (rx >= rz){ p1 = b + sy; p2 = b + sx + sy; p3 = b + sx + sy + sz; w1 = ry; w2 = rx; w3 = rz; }
  else if (ry >= rz){ p1 = b + sy; p2 = b + sy + sz; p3 = b + sx + sy + sz; w1 = ry; w2 = rz; w3 = rx; }
  else { p1 = b + sz; p2 = b + sy + sz; p3 = b + sx + sy + sz; w1 = rz; w2 = ry; w3 = rx; }
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++){ const v0 = d[b + k], v1 = d[p1 + k], v2 = d[p2 + k], v3 = d[p3 + k]; out[k] = clamp01(v0 + (v1 - v0) * w1 + (v2 - v1) * w2 + (v3 - v2) * w3); }
  return out;
}
const PERCEPTUAL_BLACK_Y = 0.0034731;                                 // transform.rs:47（ICC v4 可感知参考黑）
const CMS = {
  _model:null, _b2a1:null, _b2a0:null, _bd:null,
  model(){ return this._model || (this._model = useSwop() ? new SwopModel() : new CmykModel(CMYK_P.tvi)); },
  params(){ return useSwop() ? SWOP_P : CMYK_P; },
  name(){ return useSwop() ? 'U.S. Web Coated (SWOP) v2' : 'Dilin Coated CMYK'; },
  table(intent){
    if (intent === 'perceptual' || intent === 'saturation') return this._b2a0 || (this._b2a0 = b2aTable(this.model(), this.params(), new Gbd(this.model(), this.params())));
    return this._b2a1 || (this._b2a1 = b2aTable(this.model(), this.params(), null));
  },
  /* transform.rs:622 black_point：减色 LUT 档＝Lab 0 过 BToA1 再过 AToB 的 Y（夹 0..0.5）；可感知／饱和度用 v4 参考黑 */
  blackY(intent){
    if (intent === 'perceptual' || intent === 'saturation') return PERCEPTUAL_BLACK_Y;
    if (this._bd !== null) return this._bd;
    const c = tetra(this.table('relative'), encodeV2([0, 0, 0])), L = this.model().lab(c)[0];
    return (this._bd = clamp(labToXyz([L, 0, 0], W50)[1], 0, 0.5));
  },
  /* sRGB(8 位) → CMYK：XYZ（D50）→ BPC（源黑 0 对到 CMYK 黑）／绝对比色（媒体白缩放）→ Lab → BToA 表；白进白出（fix_white） */
  rgbToCmyk(r, g, b, intent, bpc){
    intent = intent || 'relative';
    if (r === 255 && g === 255 && b === 255 && intent !== 'absolute') return [0, 0, 0, 0];
    // SWOP 近似：相对比色／可感知（＋BPC，PS 预设）有预先算好的 17³ sRGB→CMYK 表（cmyk-swop.js rgbTable；就是下面这条路逐格解出来的）⇒ 查表＋三线性，
    // 拾色器、文件模式、校样／分色预览都走这一条（同一组数字）。没有表（产表时 SwopCmyk.noTables）才现解：
    // 相对比色先照 ICC 相对比色表把颜色压进 SWOP 色域（mapLab），再用 PS 那套 GCR／总墨量分色
    if (useSwop() && bpc !== false && intent !== 'absolute'){
      const S = window.SwopCmyk, it = intent === 'relative' ? 'relative' : 'perceptual';
      if (!S.noTables && S.rgbTable && S.rgbTable(it)) return S.sampleRgb(it, r, g, b);
      if (it === 'relative' && S.mapLab) return tetra(this.table('relative'), encodeV2(S.mapLab(r, g, b)));
    }
    let x = mul3(M_FWD, [LIN8[r], LIN8[g], LIN8[b]]);
    if (intent === 'absolute'){ const pw = this.model().paper; x = x.map((v, i) => v * W50[i] / pw[i]); }
    else if (bpc !== false){ const bd = this.blackY(intent); x = x.map((v, i) => (1 - bd) * v + bd * W50[i]); }
    return tetra(this.table(intent === 'absolute' ? 'relative' : intent), encodeV2(xyzToLab(x, W50)));
  },
  /* 校样／分色预览的显示（视图 ▸ 校样颜色、AI 分色预览）：bpc＝相对比色＋黑场补偿（同 cmykToRgb）；bpc:false＝相对比色不补黑；simulatePaper＝绝对比色（纸白、纸黑） */
  show(c, o){
    o = o || {};
    if (o.simulatePaper){ const x = this.model().xyz(c); return mul3(M_INV, x).map(v => l2s(clamp01(v))); }
    if (o.bpc === false){ const x = labToXyz(this.model().lab(c), W50); return mul3(M_INV, x).map(v => l2s(clamp01(v))); }
    return this.cmykToRgb(c);
  },
  /* CMYK → sRGB（显示／合成那一条：相对比色＋BPC，color/convert.rs:94-124） */
  cmykToRgb(c){
    if (!c[0] && !c[1] && !c[2] && !c[3]) return [1, 1, 1];
    const bd = this.blackY('relative'), x = labToXyz(this.model().lab(c), W50).map((v, i) => (v - bd * W50[i]) / (1 - bd));
    return mul3(M_INV, x).map(v => l2s(clamp01(v)));
  }
};
const qStep = () => docDepth() === 8 ? 255 : docDepth() === 16 ? 65535 : 0;   // 该深度的量化（32 位＝不量化）
const quant = (v, q) => q ? Math.round(clamp01(v) * q) / q : v;
/* 8 位 Lab 编码（raster from_rgba）：L/100、(a+128)/255 */
const labEnc = l => [l[0] / 100, (l[1] + 128) / 255, (l[2] + 128) / 255];
const labDec = e => [e[0] * 100, e[1] * 255 - 128, e[2] * 255 - 128];

/* 一个像素（sRGB 8 位）转到目标模式、再照显示路径回 sRGB（回 0xRRGGBB） */
function pixelFn(mode, opt){
  const q = qStep(), pack = c => (to8(c[0]) << 16) | (to8(c[1]) << 8) | to8(c[2]);
  if (mode === 'grayscale') return (r, g, b) => { const v = to8(quant(sgrayOf8(r, g, b), q)); return (v << 16) | (v << 8) | v; };
  if (mode === 'cmyk') return (r, g, b) => pack(CMS.cmykToRgb(CMS.rgbToCmyk(r, g, b, opt.intent, opt.bpc).map(v => quant(v, q))));
  if (mode === 'lab') return (r, g, b) => { const e = labEnc(srgbToLab(r / 255, g / 255, b / 255)).map(v => quant(clamp01(v), q)); const d = labDec(e); return pack(labToSrgb(d[0], d[1], d[2])); };
  return null;
}
/* 每个像素层（每种颜色只算一次）＋ 填色／文字／形状／样式颜色（convert_layer_colors）；蒙版不动（for_each_surface masks=false） */
function mapDocColors(fn){
  const cache = new Map(), conv = key => { let v = cache.get(key); if (v === undefined){ v = fn(key >> 16 & 255, key >> 8 & 255, key & 255); cache.set(key, v); } return v; };
  for (const L of Doc.layers){
    if (L.kind === 'raster'){
      const c = L.data.canvas, ctx = L.data.ctx, im = ctx.getImageData(0, 0, c.width, c.height), d = im.data;
      for (let i = 0; i < d.length; i += 4){ if (!d[i + 3]) continue; const v = conv((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); d[i] = v >> 16 & 255; d[i + 1] = v >> 8 & 255; d[i + 2] = v & 255; }
      ctx.putImageData(im, 0, 0);
    } else {
      walkHex(L.data, h => hex8(unpack(conv(packHex(h)))));
    }
    if (L.style) walkHex(L.style, h => hex8(unpack(conv(packHex(h)))));
    Layer.invalidate(L);
  }
}
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const packHex = h => parseInt(h.slice(1), 16);
const unpack = v => [v >> 16 & 255, v >> 8 & 255, v & 255];
function walkHex(o, f){
  if (!o || typeof o !== 'object') return;
  for (const k of Object.keys(o)){ const v = o[k]; if (typeof v === 'string' && HEX_RE.test(v)) o[k] = f(v); else if (v && typeof v === 'object') walkHex(v, f); }
}

/* ═══════════ 合成挂点：双色调显示＝合成上叠渐变映射；多通道＝油墨通道印在白纸上当底 ═══════════ */
/* mode.rs:93 curve_eval：分段线性 */
function curveEval(pts, x){
  if (!pts.length) return x;
  if (pts.length === 1) return pts[0][1];
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i + 1 < pts.length; i++){ const a = pts[i], b = pts[i + 1]; if (x <= b[0]){ const span = Math.max(b[0] - a[0], 1e-6); return a[1] + (b[1] - a[1]) * (x - a[0]) / span; } }
  return pts[pts.length - 1][1];
}
const inkDensity = (ink, gd) => clamp01(curveEval(ink.curve, clamp01(gd)));   // DuotoneInk::density
/* Duotone::render：灰 → 印出来的颜色（每支油墨在白纸上滤光相乘） */
function duoRender(d, gray){
  const density = 1 - clamp01(gray), out = [1, 1, 1];
  for (const ink of d.inks){ const k = curveEval(ink.curve, density); for (let c = 0; c < 3; c++) out[c] *= 1 - k * (1 - ink.color[c]); }
  return out;
}
/* display_adjustment：33 个色标的渐变映射 ⇒ 256 格查表（按亮度取位置、色标间线性） */
function duoLut(d){
  const stops = []; for (let i = 0; i <= 32; i++) stops.push(duoRender(d, i / 32));
  const lut = new Uint8Array(256 * 3);
  for (let v = 0; v < 256; v++){
    const t = v / 255 * 32, i = Math.min(Math.floor(t), 31), f = t - i;
    for (let c = 0; c < 3; c++) lut[v * 3 + c] = to8(stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f);
  }
  return lut;
}
const MC_CACHE = new WeakMap();
/* compose/multichannel.rs inks：p ← (1 − s·v)·p·(1 − v + v·c) + s·v·c（油墨 solidity 0 ＝相乘叠印） */
function inkCanvas(mc){
  let c = MC_CACHE.get(mc); if (c) return c;
  const W = Doc.width, H = Doc.height, n = W * H, buf = new Float32Array(n * 3).fill(1);
  for (const ink of mc.inks){
    const d = ink.data, col = ink.color;
    for (let i = 0; i < n && i < d.length; i++){ const v = d[i] / 255; if (v <= 0) continue; for (let j = 0; j < 3; j++) buf[i * 3 + j] *= (1 - v + v * col[j]); }
  }
  c = newCanvas(W, H); const im = c.ctx.createImageData(W, H);
  for (let i = 0; i < n; i++){ im.data[i * 4] = to8(buf[i * 3]); im.data[i * 4 + 1] = to8(buf[i * 3 + 1]); im.data[i * 4 + 2] = to8(buf[i * 3 + 2]); im.data[i * 4 + 3] = 255; }
  c.ctx.putImageData(im, 0, 0); MC_CACHE.set(mc, c);
  return c;
}
const baseComposite = window.composite;
function hookedComposite(scale, target){
  const out = baseComposite(scale, target);
  try {
    if (Doc.mode === 'multichannel' && Doc.multichannel){
      const x = out.getContext('2d'); x.save(); x.globalCompositeOperation = 'destination-over';
      x.drawImage(inkCanvas(Doc.multichannel).canvas, 0, 0, out.width, out.height); x.restore();
    } else if (Doc.mode === 'duotone' && Doc.duotone && Doc.duotone.inks && Doc.duotone.inks.length){
      const x = out.getContext('2d'), im = x.getImageData(0, 0, out.width, out.height), d = im.data, lut = duoLut(Doc.duotone);
      for (let i = 0; i < d.length; i += 4){ if (!d[i + 3]) continue; const v = Math.round(rgbToGray(d[i], d[i + 1], d[i + 2])); d[i] = lut[v * 3]; d[i + 1] = lut[v * 3 + 1]; d[i + 2] = lut[v * 3 + 2]; }
      x.putImageData(im, 0, 0);
    }
  } catch (e){ console.error(e); }
  return out;
}
if (typeof baseComposite === 'function' && !baseComposite._psMode){ hookedComposite._psMode = true; window.composite = hookedComposite; }

/* 拼合（mode_cmds.rs:129 composite）：照原码不含双色调的显示层；opaque＝叠在白上 → Float32 直通 RGBA 0..1 */
function flatten(opaque){
  const c = baseComposite(1), W = c.width, H = c.height, d = c.getContext('2d').getImageData(0, 0, W, H).data, px = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H; i++){
    const a = d[i * 4 + 3] / 255;
    for (let k = 0; k < 3; k++){ const v = d[i * 4 + k] / 255; px[i * 4 + k] = opaque ? v * a + (1 - a) : v; }
    px[i * 4 + 3] = opaque ? 1 : a;
  }
  return {px, W, H};
}
/* single_layer：整份换成一层 8 位（背景或「索引」） */
function singleLayer(mode, px, name, background){
  const L = Layer.raster(name), W = Doc.width, H = Doc.height, im = L.data.ctx.createImageData(W, H);
  for (let i = 0; i < W * H * 4; i++) im.data[i] = to8(px[i]);
  L.data.ctx.putImageData(im, 0, 0);
  if (background) L.isBackground = true;
  Doc.layers = [L]; Doc.activeId = L.id;
  Doc.mode = mode; Doc.depth = 8;
  delete Doc.colorTable; delete Doc.duotone; delete Doc.multichannel;
  return L;
}

/* ═══════════ quantize.rs：调色板、抖动、位图 ═══════════ */
function webPalette(){ const v = []; for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) v.push([r * 51, g * 51, b * 51]); return v; }
function macPalette(){
  const v = webPalette(), steps = []; for (let k = 1; k <= 15; k++) if ((k * 17) % 51) steps.push(k * 17);
  const rev = steps.slice().reverse();
  rev.forEach(s => v.push([s, 0, 0])); rev.forEach(s => v.push([0, s, 0])); rev.forEach(s => v.push([0, 0, s])); rev.forEach(s => v.push([s, s, s]));
  return v.slice(0, 256);
}
function windowsPalette(){
  const v = [[0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0], [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192], [192, 220, 192], [166, 202, 240],
             [255, 251, 240], [160, 160, 164], [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255]];
  const has = c => v.some(e => e[0] === c[0] && e[1] === c[1] && e[2] === c[2]);
  webPalette().forEach(c => { if (!has(c)) v.push(c); });
  let g = 8;
  while (v.length < 256){ if (!has([g, g, g])) v.push([g, g, g]); g = (g + 12) & 255; }
  return v;
}
function uniformPalette(n){
  const k = Math.max(2, Math.floor(Math.cbrt(n))), lv = i => Math.round(i / (k - 1) * 255), v = [];
  for (let r = 0; r < k; r++) for (let g = 0; g < k; g++) for (let b = 0; b < k; b++) v.push([lv(r), lv(g), lv(b)]);
  return v;
}
const FORCED = {none:[], blackWhite:[[0, 0, 0], [255, 255, 255]], primaries:[[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 255, 255], [255, 0, 255], [255, 255, 0]], web:null};
const forcedColors = f => f === 'web' ? webPalette() : (FORCED[f] || []).map(c => c.slice());
/* histogram：不透明像素（a ≥ ½）的 8 位颜色与次数，按 (r,g,b) 排 */
function histogram(px){
  const m = new Map();
  for (let i = 0; i < px.length; i += 4){ if (px[i + 3] < 0.5) continue; const k = (to8(px[i]) << 16) | (to8(px[i + 1]) << 8) | to8(px[i + 2]); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => [[k >> 16 & 255, k >> 8 & 255, k & 255], n]);
}
/* median_cut：每次挑「最长轴范围 × √权重」最大的盒子从加权中位切开（swap_remove 的次序照抄） */
function medianCut(pts, n){
  if (!pts.length || !n) return [];
  const boxes = [pts.slice()];
  while (boxes.length < n){
    let bi = -1, axis = 0, score = -1;
    boxes.forEach((b, i) => {
      if (b.length <= 1) return;
      let best = [0, -1];
      for (let a = 0; a < 3; a++){ let lo = Infinity, hi = -Infinity; for (const p of b){ lo = Math.min(lo, p[0][a]); hi = Math.max(hi, p[0][a]); } if (hi - lo > best[1]) best = [a, hi - lo]; }
      let w = 0; for (const p of b) w += p[1];
      const sc = best[1] * Math.sqrt(w);
      if (sc > score){ bi = i; axis = best[0]; score = sc; }
    });
    if (bi < 0 || score <= 0) break;
    const last = boxes.pop(); let b; if (bi < boxes.length){ b = boxes[bi]; boxes[bi] = last; } else b = last;   // Vec::swap_remove
    b.sort((p, q) => p[0][axis] - q[0][axis]);
    let total = 0; for (const p of b) total += p[1];
    let acc = 0, cut = 1;
    for (let i = 0; i < b.length; i++){ acc += b[i][1]; if (acc * 2 >= total){ cut = clamp(i + 1, 1, b.length - 1); break; } }
    const rest = b.splice(cut);
    boxes.push(b); boxes.push(rest);
  }
  return boxes.map(b => { let w = 0; for (const p of b) w += p[1]; return [0, 1, 2].map(a => { let s = 0; for (const p of b) s += p[0][a] * p[1]; return s / w; }); });
}
function nearestF(cs, p){ let best = Infinity, bi = 0; cs.forEach((c, i) => { const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (d < best){ best = d; bi = i; } }); return bi; }
function kmeansQ(pts, centers, iters){
  if (!centers.length) return;
  for (let it = 0; it < iters; it++){
    const sum = centers.map(() => [0, 0, 0]), cnt = centers.map(() => 0);
    for (const [p, w] of pts){ const i = nearestF(centers, p); for (let a = 0; a < 3; a++) sum[i][a] += p[a] * w; cnt[i] += w; }
    centers.forEach((c, i) => { if (cnt[i] > 0) centers[i] = sum[i].map(v => v / cnt[i]); });
  }
}
const PALETTES = ['exact', 'systemMac', 'systemWindows', 'web', 'uniform', 'perceptual', 'selective', 'adaptive'];
const paletteKind = s => ({exact:'exact', system:'systemMac', systemMac:'systemMac', systemMacOs:'systemMac', systemWindows:'systemWindows', web:'web', uniform:'uniform',
  perceptual:'perceptual', localPerceptual:'perceptual', selective:'selective', localSelective:'selective', adaptive:'adaptive', localAdaptive:'adaptive'})[s] || null;
/* build_palette：强制颜色先放、算出来的接在后面（去重、≤256）；计算型的截到要求的色数 */
function buildPalette(px, kind, colors, forced, cmd){
  colors = clamp(colors, 2, 256);
  const pal = forcedColors(forced), room = Math.max(0, colors - pal.length), hist = histogram(px);
  let computed;
  if (kind === 'exact'){ if (hist.length > 256) bad(cmd, `the image has ${hist.length} colours; Exact needs 256 or fewer`); computed = hist.map(h => h[0]); }
  else if (kind === 'systemMac') computed = macPalette();
  else if (kind === 'systemWindows') computed = windowsPalette();
  else if (kind === 'web') computed = webPalette();
  else if (kind === 'uniform') computed = uniformPalette(Math.max(room, 8));
  else if (kind === 'adaptive'){
    if (hist.length <= room) computed = hist.map(h => h[0]);
    else { const pts = hist.map(([c, n]) => [c.slice(), n]); const cs = medianCut(pts, room); kmeansQ(pts, cs, 2); computed = cs.map(c => c.map(v => clamp(Math.round(v), 0, 255))); }
  } else {
    if (hist.length <= room) computed = hist.map(h => h[0]);
    else {
      const pts = hist.map(([c, n]) => [srgbToLab(c[0] / 255, c[1] / 255, c[2] / 255), n]);
      const cs = medianCut(pts, room); kmeansQ(pts, cs, 4);
      computed = cs.map(c => labToSrgb(c[0], c[1], c[2]).map(to8));
      if (kind === 'selective') computed = computed.map(c => { const s = c.map(x => Math.round(x / 51) * 51); return c.every((a, i) => Math.abs(a - s[i]) <= 10) ? s : c; });
    }
  }
  for (const c of computed){ if (pal.length >= 256) break; if (!pal.some(e => e[0] === c[0] && e[1] === c[1] && e[2] === c[2])) pal.push(c); }
  if (['adaptive', 'perceptual', 'selective', 'uniform'].includes(kind)) pal.length = Math.min(pal.length, Math.max(colors, forcedColors(forced).length));
  if (!pal.length) pal.push([0, 0, 0]);
  return pal;
}
function nearestPal(pal, c){ let best = Infinity, bi = 0; for (let i = 0; i < pal.length; i++){ const e = pal[i], d = (c[0] * 255 - e[0]) ** 2 + (c[1] * 255 - e[1]) ** 2 + (c[2] * 255 - e[2]) ** 2; if (d < best){ best = d; bi = i; } } return bi; }
const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
const bayer8 = (x, y) => (BAYER[(y % 8) * 8 + x % 8] + 0.5) / 64 - 0.5;
function hash01(x, y, seed){
  let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(seed, 0xcb1ab31f)) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  return (h & 0xffff) / 65535;
}
/* quantize：每个像素换成调色板的项（in place）；扩散＝Floyd–Steinberg（误差乘 amount），图案＝Bayer 8×8，杂色＝固定杂凑 */
function quantizePx(px, w, pal, dither, amount, transparent){
  const n = px.length / 4, h = Math.floor(n / w), idx = new Uint8Array(n);
  const spread = Math.min(1 / Math.max(Math.cbrt(pal.length), 1), 0.5) * clamp01(amount);
  const err = dither === 'diffusion' ? new Float64Array(2 * (w + 2) * 3) : null, W2 = w + 2;
  for (let y = 0; y < h; y++){
    if (err){ for (let i = 0; i < W2 * 3; i++){ err[i] = err[W2 * 3 + i]; err[W2 * 3 + i] = 0; } }
    for (let x = 0; x < w; x++){
      const i = y * w + x, o = i * 4, a = px[o + 3];
      if (a < 0.5){
        if (transparent !== null){ idx[i] = transparent; px[o] = px[o + 1] = px[o + 2] = px[o + 3] = 0; continue; }
        if (a <= 0) continue;
      }
      let c = [px[o], px[o + 1], px[o + 2]];
      if (dither === 'diffusion') c = c.map((v, k) => v + err[(x + 1) * 3 + k]);
      else if (dither === 'pattern'){ const t = bayer8(x, y) * spread; c = c.map(v => v + t); }
      else if (dither === 'noise'){ const t = (hash01(x, y, 7) - 0.5) * spread; c = c.map(v => v + t); }
      c = c.map(clamp01);
      const k = nearestPal(pal, c); idx[i] = k;
      const e = pal[k].map(v => v / 255);
      if (err){
        const am = clamp01(amount);
        for (let q = 0; q < 3; q++){
          const d = (c[q] - e[q]) * am;
          err[(x + 2) * 3 + q] += d * 7 / 16; err[W2 * 3 + x * 3 + q] += d * 3 / 16; err[W2 * 3 + (x + 1) * 3 + q] += d * 5 / 16; err[W2 * 3 + (x + 2) * 3 + q] += d / 16;
        }
      }
      px[o] = e[0]; px[o + 1] = e[1]; px[o + 2] = e[2]; px[o + 3] = transparent !== null ? 1 : a;
    }
  }
  return idx;
}
/* spot：半调网点形状函数（格内 u,v ∈ -1..1） */
function spot(shape, u, v){
  const s = shape === 'ellipse' ? 1 - (u * u + 0.6 * v * v) / 1.6 : shape === 'line' ? 1 - Math.abs(v) : shape === 'square' ? 1 - Math.max(Math.abs(u), Math.abs(v))
    : shape === 'diamond' ? 1 - (Math.abs(u) + Math.abs(v)) / 2 : shape === 'cross' ? 1 - Math.min(Math.abs(u), Math.abs(v)) : 1 - (u * u + v * v) / 2;
  return clamp01(s);
}
/* to_bitmap：灰 0..1 → 0／1 */
function toBitmap(gray, w, m){
  const h = Math.floor(gray.length / w);
  if (m.method === 'threshold') for (let i = 0; i < gray.length; i++) gray[i] = gray[i] >= 0.5 ? 1 : 0;
  else if (m.method === 'pattern') for (let i = 0; i < gray.length; i++) gray[i] = gray[i] > bayer8(i % w, Math.floor(i / w)) + 0.5 ? 1 : 0;
  else if (m.method === 'diffusion'){
    const buf = Float64Array.from(gray);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const i = y * w + x, old = buf[i], nw = old >= 0.5 ? 1 : 0, e = old - nw;
      gray[i] = nw;
      if (x + 1 < w) buf[i + 1] += e * 7 / 16;
      if (y + 1 < h){ if (x > 0) buf[i + w - 1] += e * 3 / 16; buf[i + w] += e * 5 / 16; if (x + 1 < w) buf[i + w + 1] += e / 16; }
    }
  } else {
    const cell = Math.max(m.cell, 2), s = Math.sin(m.angle * Math.PI / 180), c = Math.cos(m.angle * Math.PI / 180);
    const table = []; for (let k = 0; k < 32 * 32; k++) table.push(spot(m.shape, ((k % 32) + 0.5) / 16 - 1, (Math.floor(k / 32) + 0.5) / 16 - 1));
    table.sort((a, b) => a - b);
    const cdf = x => { let lo = 0, hi = table.length; while (lo < hi){ const mid = (lo + hi) >> 1; if (table[mid] < x) lo = mid + 1; else hi = mid; } return lo / table.length; };
    const rem1 = v => v - Math.floor(v);
    for (let i = 0; i < gray.length; i++){
      const x = (i % w) + 0.5, y = Math.floor(i / w) + 0.5, rx = x * c + y * s, ry = -x * s + y * c;
      const u = rem1(rx / cell) * 2 - 1, vv = rem1(ry / cell) * 2 - 1;
      gray[i] = cdf(spot(m.shape, u, vv)) >= gray[i] ? 0 : 1;
    }
  }
}

/* ═══════════ 模式命令 ═══════════ */
const MODE_OF = {rgb:'rgb', grayscale:'grayscale', cmyk:'cmyk', lab:'lab'};
const PROFILES = {rgb:['srgb', 'srgbiec6196621'], grayscale:['sgray', 'graysrgb'], cmyk:['cmyk', 'coatedcmyk', 'defaultcmyk', 'photocraftcoatedcmyk'], lab:['lab', 'labd50', 'cielab']};
const PROFILE_DESC = {rgb:'sRGB IEC61966-2.1', grayscale:'sGray (sRGB tone curve, Dilin)', cmyk:'Dilin Coated CMYK (synthetic, 300% TAC, medium GCR)', lab:'Lab D50 identity (Dilin)'};
const INTENTS = {perceptual:'perceptual', relative:'relative', relativeColorimetric:'relative', saturation:'saturation', absolute:'absolute', absoluteColorimetric:'absolute'};
/* color_cmds.rs:648 convert_mode（＋ image_cmds.rs:311） */
function convertMode(mode, p){
  const cmd = 'image.mode.' + mode, cur = docMode();
  if (cur === 'multichannel' && mode !== 'multichannel') return convertFromMultichannel(mode);
  if (cur === mode && p.profile === undefined) return {ok:true, changed:false, mode};
  if (p.profile !== undefined){
    const id = String(p.profile).toLowerCase().replace(/[^a-z0-9]/g, '');
    const ok = id === 'working' || id === 'default' || PROFILES[mode].includes(id) || (mode === 'grayscale' && /^(gray|graygamma22|gamma22)$/.test(id));
    if (!ok) bad(cmd, `unknown profile \`${p.profile}\` (built-ins here: working|${PROFILES[mode][0]}; ICC files are not supported in the browser)`);
  }
  let intent = 'relative';
  if (p.intent !== undefined){ intent = INTENTS[p.intent]; if (!intent) bad(cmd, `unknown intent \`${p.intent}\` (perceptual|relative|saturation|absolute)`); }
  const bpc = typeof p.bpc === 'boolean' ? p.bpc : true;
  const fn = pixelFn(mode, {intent, bpc});
  return edit(() => {
    if (fn) mapDocColors(fn);
    Doc.mode = mode; delete Doc.colorTable; delete Doc.duotone;
    return {ok:true, mode, profile:PROFILE_DESC[mode], intent, bpc};
  });
}
/* image_cmds.rs:316 convert_depth：同深度什么都不做（也不留历史）；画布本身永远 8 位 ⇒ 只记 Doc.depth（之后的模式转换按它量化、分析的灰度值按它的范围） */
function convertDepth(d){
  if (docDepth() === d) return {ok:true, changed:false, depth:d};
  return edit(() => { Doc.depth = d; return {ok:true, depth:d}; });
}
/* mode_cmds.rs:182 indexed_color */
function indexedColor(p){
  const cmd = 'image.mode.indexedColor';
  if (!['rgb', 'grayscale', 'indexed', 'duotone', 'cmyk', 'lab'].includes(docMode())) bad(cmd, `Indexed Color needs an RGB or Grayscale image (the document is ${docMode()})`);
  const kind = paletteKind(str(p, 'palette', 'selective')); if (!kind) bad(cmd, 'palette: exact|systemMac|systemWindows|web|uniform|perceptual|selective|adaptive');
  const forced = str(p, 'forced', 'blackWhite'), forcedId = forced === 'blackAndWhite' ? 'blackWhite' : forced;
  if (!['none', 'blackWhite', 'primaries', 'web'].includes(forcedId)) bad(cmd, 'forced: none|blackWhite|primaries|web');
  const dither = str(p, 'dither', 'diffusion'); if (!['none', 'diffusion', 'pattern', 'noise'].includes(dither)) bad(cmd, 'dither: none|diffusion|pattern|noise');
  const colors = Math.floor(clamp(num(p, 'colors', 256), 2, 256)), amount = clamp(num(p, 'amount', 75), 0, 100) / 100;
  const transparency = typeof p.transparency === 'boolean' ? p.transparency : true;
  return edit(() => {
    const {px, W} = flatten(!transparency);
    let hasClear = false; if (transparency) for (let i = 3; i < px.length; i += 4) if (px[i] < 0.5){ hasClear = true; break; }
    const pal = buildPalette(px, kind, hasClear ? Math.max(colors - 1, 2) : colors, forcedId, cmd);
    let transparent = null;
    if (hasClear && pal.length < 256){ pal.push([255, 255, 255]); transparent = pal.length - 1; }
    quantizePx(px, W, pal, dither, amount, transparent);
    singleLayer('indexed', px, transparent !== null ? T('indexLayer') : bgName(), transparent === null);
    Doc.colorTable = {colors:pal, transparent};
    return {ok:true, colors:pal.length, transparentIndex:transparent};
  });
}
/* mode_cmds.rs:230 preset_table */
function presetTable(name){
  const ramp = f => { const v = []; for (let i = 0; i < 256; i++) v.push(f(i / 255).map(x => Math.round(clamp01(x) * 255))); return v; };
  if (name === 'grayscale') return ramp(t => [t, t, t]);
  if (name === 'blackBody') return ramp(t => [Math.min(t * 3, 1), clamp01(t * 3 - 1), clamp01(t * 3 - 2)]);
  if (name === 'spectrum') return ramp(t => { const h = t * 300 / 60, x = 1 - Math.abs(h % 2 - 1); switch (Math.trunc(h)){ case 0: return [1, x, 0]; case 1: return [x, 1, 0]; case 2: return [0, 1, x]; case 3: return [0, x, 1]; default: return [x, 0, 1]; } });
  if (name === 'systemMac' || name === 'system') return macPalette();
  if (name === 'systemWindows') return windowsPalette();
  if (name === 'web') return webPalette();
  return null;
}
/* ColorTable.nearest（f32 平方距离、平手取小的） */
function tableNearest(t, c){ let best = Infinity, bi = 0; t.colors.forEach((e, i) => { const d = (c[0] - e[0] / 255) ** 2 + (c[1] - e[1] / 255) ** 2 + (c[2] - e[2] / 255) ** 2; if (d < best){ best = d; bi = i; } }); return bi; }
const tableRgb = (t, i) => t.colors[i] ? t.colors[i].map(v => v / 255) : [0, 0, 0];
/* mode_cmds.rs:256 color_table：换表＝每个像素留着它在旧表的索引、颜色跟着新表；没有改动＝回报目前的表 */
function colorTable(p){
  const cmd = 'image.mode.colorTable';
  if (docMode() !== 'indexed') bad(cmd, `Color Table needs an Indexed Color image (the document is ${docMode()})`);
  const cur = Doc.colorTable; if (!cur) return {ok:false, error:'the document has no color table'};
  const table = JSON.parse(JSON.stringify(cur));
  const tn = str(p, 'table', 'custom');
  if (tn !== 'custom'){ const t = presetTable(tn); if (!t) bad(cmd, `unknown table \`${tn}\``); table.colors = t; }
  if (Array.isArray(p.colors)){
    const c = p.colors.map(parseColor8); if (c.some(x => !x)) bad(cmd, 'colors: ["#rrggbb" | [r, g, b], …]');
    if (!c.length || c.length > 256) bad(cmd, 'a color table has 1 to 256 entries');
    table.colors = c;
  }
  if (p.entries && typeof p.entries === 'object'){
    for (const [k, v] of Object.entries(p.entries)){
      const i = Number(k); if (!Number.isInteger(i) || i < 0) bad(cmd, `entry index \`${k}\``);
      const c = parseColor8(v); if (!c) bad(cmd, `entry ${i}: bad colour`);
      if (i >= table.colors.length) bad(cmd, `entry ${i} is past the table (${table.colors.length} entries)`);
      table.colors[i] = c;
    }
  }
  if ('transparent' in p){
    if (p.transparent === null) table.transparent = null;
    else if (Number.isInteger(p.transparent) && p.transparent >= 0 && p.transparent < table.colors.length) table.transparent = p.transparent;
  }
  const report = t => ({ok:true, colors:t.colors.map(hex8), transparent:t.transparent === undefined ? null : t.transparent});
  if (JSON.stringify(table) === JSON.stringify(cur)) return report(cur);
  return edit(() => {
    for (const L of Doc.layers){
      if (L.kind !== 'raster') continue;
      const c = L.data.canvas, im = L.data.ctx.getImageData(0, 0, c.width, c.height), d = im.data, memo = new Map();
      for (let j = 0; j < d.length; j += 4){
        if (!d[j + 3]) continue;
        const key = (d[j] << 16) | (d[j + 1] << 8) | d[j + 2];
        let r = memo.get(key);
        if (!r){
          const cc = [d[j] / 255, d[j + 1] / 255, d[j + 2] / 255], i = tableNearest(cur, cc);
          const nc = i < table.colors.length ? tableRgb(table, i) : tableRgb(table, tableNearest(table, cc));
          r = [nc.map(to8), table.transparent === i]; memo.set(key, r);
        }
        d[j] = r[0][0]; d[j + 1] = r[0][1]; d[j + 2] = r[0][2]; if (r[1]) d[j + 3] = 0;
      }
      L.data.ctx.putImageData(im, 0, 0); Layer.invalidate(L);
    }
    Doc.colorTable = table;
    return report(table);
  });
}
/* mode_cmds.rs:325 bitmap：拼合（叠白）→ Rec.601 灰 → 二值 → 单一背景层 */
function bitmap(p){
  const cmd = 'image.mode.bitmap', dpi = Math.max(Doc.dpi || 72, 1), method = str(p, 'method', 'diffusion');
  let m;
  if (method === 'threshold' || method === 'threshold50') m = {method:'threshold'};
  else if (method === 'pattern' || method === 'diffusion') m = {method};
  else if (method === 'halftone'){
    const freq = clamp(num(p, 'frequency', 53), 1, 999), shape = str(p, 'shape', 'round');
    m = {method:'halftone', cell:Math.max(dpi / freq, 2), angle:num(p, 'angle', 45), shape:['ellipse', 'line', 'square', 'diamond', 'cross'].includes(shape) ? shape : 'round'};
  } else bad(cmd, `method \`${method}\` (threshold|pattern|diffusion|halftone)`);
  if (docMode() !== 'grayscale') bad(cmd, `Bitmap needs a Grayscale image (Image › Mode › Grayscale first) (the document is ${docMode()})`);
  return edit(() => {
    const {px, W, H} = flatten(true), gray = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) gray[i] = rgbToGray(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    toBitmap(gray, W, m);
    const out = new Float32Array(W * H * 4); for (let i = 0; i < W * H; i++){ out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = gray[i]; out[i * 4 + 3] = 1; }
    singleLayer('bitmap', out, bgName(), true);
    return {ok:true};
  });
}
/* mode_cmds.rs:355 default_inks：黑、暖棕、金、石板蓝 */
const DEFAULT_INKS = [['Black', [0, 0, 0]], ['Warm Brown', [0.62, 0.38, 0.18]], ['Gold', [0.86, 0.68, 0.18]], ['Slate Blue', [0.27, 0.38, 0.58]]];
const defaultInks = n => DEFAULT_INKS.slice(0, n).map(([name, c]) => ({name, color:c.slice(), curve:[[0, 0], [1, 1]]}));
const DUO_TYPES = {monotone:1, duotone:2, tritone:3, quadtone:4};
function duotone(p){
  const cmd = 'image.mode.duotone', type = str(p, 'type', 'duotone'), n = DUO_TYPES[type];
  if (!n) bad(cmd, `type \`${type}\` (monotone|duotone|tritone|quadtone)`);
  let inks;
  if (p.inks !== undefined){
    if (!Array.isArray(p.inks)) bad(cmd, 'inks: [{"name","color":"#rrggbb","curve":[[in,out],…] (0..100)}, …]');
    const defs = defaultInks(Math.min(Math.max(n, p.inks.length), 4));
    inks = p.inks.slice(0, 4).map((ink, i) => {
      const d = defs[i] || {name:'Ink ' + (i + 1), color:[0, 0, 0], curve:[[0, 0], [1, 1]]};
      if (ink && typeof ink.name === 'string') d.name = ink.name;
      const c = ink && parseColor8(ink.color); if (c) d.color = c.map(v => v / 255);
      if (ink && Array.isArray(ink.curve)){
        const cv = ink.curve.filter(q => Array.isArray(q) && isNum(q[0]) && isNum(q[1])).map(q => [q[0] / 100, q[1] / 100]).sort((a, b) => a[0] - b[0]);
        if (cv.length >= 2) d.curve = cv;
      }
      return d;
    });
  } else inks = defaultInks(n);
  if (inks.length < n) inks = inks.concat(defaultInks(n).slice(inks.length));
  inks = inks.slice(0, n);
  if (!['grayscale', 'duotone'].includes(docMode())) bad(cmd, `Duotone needs a Grayscale image (Image › Mode › Grayscale first) (the document is ${docMode()})`);
  return edit(() => {
    Doc.mode = 'duotone'; Doc.duotone = {type, inks}; delete Doc.colorTable;
    return {ok:true, inks:inks.map(i => i.name)};
  });
}
/* ── multichannel_cmds.rs ── */
const INK_C = {Cyan:[0, 0.682, 0.937], Magenta:[0.925, 0, 0.549], Yellow:[1, 0.949, 0], Black:[0.137, 0.122, 0.125]};
/* flattened_planes：叠白拼合后该模式的原生色版（0..1） */
function flattenedPlanes(){
  const {px, W, H} = flatten(true), n = W * H, m = docMode(), q = qStep();
  const mk = k => Array.from({length:k}, () => new Float32Array(n));
  let planes;
  if (m === 'rgb'){ planes = mk(3); for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) planes[c][i] = px[i * 4 + c]; }
  else if (m === 'cmyk'){ planes = mk(4); const memo = new Map(); for (let i = 0; i < n; i++){ const r = to8(px[i * 4]), g = to8(px[i * 4 + 1]), b = to8(px[i * 4 + 2]), k = (r << 16) | (g << 8) | b; let v = memo.get(k); if (!v){ v = CMS.rgbToCmyk(r, g, b).map(x => quant(x, q)); memo.set(k, v); } for (let c = 0; c < 4; c++) planes[c][i] = v[c]; } }
  else if (m === 'lab'){ planes = mk(3); for (let i = 0; i < n; i++){ const e = labEnc(srgbToLab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])); for (let c = 0; c < 3; c++) planes[c][i] = quant(clamp01(e[c]), q); } }
  else { planes = mk(1); for (let i = 0; i < n; i++) planes[0][i] = rgbToGray(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); }
  return planes;
}
const toU8 = (pl, f) => { const u = new Uint8Array(pl.length); for (let i = 0; i < pl.length; i++) u[i] = to8(f(pl[i])); return u; };
function toMultichannel(){
  const cmd = 'image.mode.multichannel', m = docMode();
  if (!['rgb', 'cmyk', 'lab', 'grayscale', 'duotone'].includes(m)) bad(cmd, `Multichannel needs an RGB, CMYK, Lab, Grayscale or Duotone image (the document is ${m})`);
  return edit(() => {
    const planes = flattenedPlanes(), inv = v => 1 - v;
    let inks;
    if (m === 'rgb') inks = ['Cyan', 'Magenta', 'Yellow'].map((nm, i) => ({name:nm, color:INK_C[nm].slice(), data:toU8(planes[i], inv)}));
    else if (m === 'cmyk') inks = ['Cyan', 'Magenta', 'Yellow', 'Black'].map((nm, i) => ({name:nm, color:INK_C[nm].slice(), data:toU8(planes[i], v => v)}));
    else if (m === 'lab') inks = planes.map((pl, k) => ({name:'Alpha ' + (k + 1), color:[0, 0, 0], data:toU8(pl, inv)}));
    else if (m === 'duotone' && Doc.duotone && Doc.duotone.inks.length) inks = Doc.duotone.inks.map(ink => ({name:ink.name, color:ink.color.slice(), data:toU8(planes[0], g => inkDensity(ink, 1 - g))}));
    else inks = [{name:'Black', color:[0, 0, 0], data:toU8(planes[0], inv)}];
    Doc.multichannel = {inks}; Doc.layers = []; Doc.activeId = null;
    Doc.mode = 'multichannel'; delete Doc.colorTable; delete Doc.duotone;
    return {ok:true, mode:'multichannel', channels:inks.map(i => i.name)};
  });
}
/* convert_from：通道数对得上就照通道解读（3→RGB／Lab、4→CMYK、1→灰），否则照印出来的样子转 */
function convertFromMultichannel(mode){
  if (!['rgb', 'cmyk', 'lab', 'grayscale'].includes(mode)) bad('image.mode.' + mode, `a Multichannel document can't be converted to ${mode}`);
  return edit(() => {
    const inks = (Doc.multichannel && Doc.multichannel.inks) || [], W = Doc.width, H = Doc.height, n = W * H;
    const re = ((mode === 'rgb' || mode === 'lab') && inks.length === 3) || (mode === 'cmyk' && inks.length === 4) || (mode === 'grayscale' && inks.length === 1);
    const look = re ? null : inkCanvas(Doc.multichannel || {inks:[]}).ctx.getImageData(0, 0, W, H).data;
    const out = new Float32Array(n * 4), q = qStep(), memo = new Map();
    const at = (k, i) => (inks[k] && inks[k].data[i] !== undefined ? inks[k].data[i] : 0) / 255;
    for (let i = 0; i < n; i++){
      let rgb;
      if (re){
        if (mode === 'rgb') rgb = [1 - at(0, i), 1 - at(1, i), 1 - at(2, i)];
        else if (mode === 'grayscale'){ const v = 1 - at(0, i); rgb = [v, v, v]; }
        else if (mode === 'lab'){ const d = labDec([1 - at(0, i), 1 - at(1, i), 1 - at(2, i)]); rgb = labToSrgb(d[0], d[1], d[2]); }
        else rgb = CMS.cmykToRgb([at(0, i), at(1, i), at(2, i), at(3, i)]);
      } else {
        const r = look[i * 4], g = look[i * 4 + 1], b = look[i * 4 + 2], key = (r << 16) | (g << 8) | b;
        rgb = memo.get(key);
        if (!rgb){
          if (mode === 'rgb') rgb = [r / 255, g / 255, b / 255];
          else if (mode === 'grayscale'){ const v = quant(rgbToGray(r / 255, g / 255, b / 255), q); rgb = [v, v, v]; }
          else if (mode === 'lab'){ const d = labDec(labEnc(srgbToLab(r / 255, g / 255, b / 255)).map(v => quant(clamp01(v), q))); rgb = labToSrgb(d[0], d[1], d[2]); }
          else rgb = CMS.cmykToRgb(CMS.rgbToCmyk(r, g, b).map(v => quant(v, q)));
          memo.set(key, rgb);
        }
      }
      out[i * 4] = rgb[0]; out[i * 4 + 1] = rgb[1]; out[i * 4 + 2] = rgb[2]; out[i * 4 + 3] = 1;
    }
    const depth = docDepth();
    singleLayer(mode, out, bgName(), true); Doc.depth = depth;
    return {ok:true, mode, from:'multichannel', converted:re ? 'channels' : 'appearance'};
  });
}

/* ═══════════ 陷印（trap_cmds.rs ＋ algo/trap.rs） ═══════════ */
function dilate(src, w, h, r){
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ let m = 0; for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) m = Math.max(m, src[y * w + xx]); tmp[y * w + x] = m; }
  for (let y = 0; y < h; y++){ const lo = Math.max(0, y - r), hi = Math.min(h - 1, y + r); for (let x = 0; x < w; x++){ let m = 0; for (let yy = lo; yy <= hi; yy++) m = Math.max(m, tmp[yy * w + x]); out[y * w + x] = m; } }
  return out;
}
function trap(p){
  const cmd = 'image.trap', width = Math.max(0, Math.round(num(p, 'width', 1)));
  if (docMode() !== 'cmyk') bad(cmd, 'Trap needs a CMYK document (Image › Mode › CMYK Color)');
  const L = Doc.active(); if (!L) bad(cmd, 'no active layer');
  if (L.kind !== 'raster') bad(cmd, `Trap needs a pixel layer (active layer is a ${L.kind})`);
  return edit(() => {
    const W = Doc.width, H = Doc.height, ox = -Math.round(L.x || 0), oy = -Math.round(L.y || 0);   // 文件范围换成图层坐标（铁律④）
    if (!width) return {ok:true, trapped:true, width};
    const im = L.data.ctx.getImageData(ox, oy, W, H), d = im.data, n = W * H, q = qStep(), memo = new Map();
    const inks = [0, 1, 2, 3].map(() => new Float32Array(n));
    for (let i = 0; i < n; i++){
      if (!d[i * 4 + 3]) continue;                                    // 透明＝没有墨（纸）
      const key = (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
      let c = memo.get(key); if (!c){ c = CMS.rgbToCmyk(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]).map(v => quant(v, q)); memo.set(key, c); }
      for (let k = 0; k < 4; k++) inks[k][i] = c[k];
    }
    const dil = inks.map(pl => dilate(pl, W, H, width));
    let changed = 0;
    for (let i = 0; i < n; i++){
      if (!(inks[0][i] > 1e-4 || inks[1][i] > 1e-4 || inks[2][i] > 1e-4 || inks[3][i] > 1e-4)) continue;   // 纸白不动
      const nc = [0, 1, 2, 3].map(k => Math.max(inks[k][i], dil[k][i]));
      if (nc.every((v, k) => v === inks[k][i])) continue;
      const rgb = CMS.cmykToRgb(nc); d[i * 4] = to8(rgb[0]); d[i * 4 + 1] = to8(rgb[1]); d[i * 4 + 2] = to8(rgb[2]); changed++;
    }
    L.data.ctx.putImageData(im, ox, oy); Layer.invalidate(L);
    return {ok:true, trapped:true, width, pixels:changed};
  });
}

/* ═══════════ 变量与数据组（variables_cmds.rs） ═══════════ */
const vars = () => Doc.variables || {defs:[], dataSets:[], active:null};
const ALIGNS = ['topLeft', 'topCenter', 'topRight', 'centerLeft', 'center', 'centerRight', 'bottomLeft', 'bottomCenter', 'bottomRight'];
/* parse_kind：visibility | textReplacement(text) | pixelReplacement(pixel) ＋ method／align／clip */
function parseKind(d){
  const t = d && d.type;
  if (t === 'visibility') return {type:'visibility'};
  if (t === 'textReplacement' || t === 'text') return {type:'textReplacement'};
  if (t === 'pixelReplacement' || t === 'pixel'){
    const method = ['fill', 'asIs', 'conform'].includes(d.method) ? d.method : 'fit';
    const align = ALIGNS.includes(d.align) ? d.align : 'center';
    return {type:'pixelReplacement', method, align, clip:typeof d.clip === 'boolean' ? d.clip : false};
  }
  return null;
}
function varsList(){
  const v = vars();
  return {ok:true, defs:v.defs.map(d => Object.assign({name:d.name, layer:d.layer}, d.kind)),
          dataSets:v.dataSets.map(s => ({name:s.name, values:s.values.map(x => ({variable:x.variable, kind:x.kind, value:x.value}))})), active:v.active === undefined ? null : v.active};
}
/* set_vars：改变量设定不算一步编辑（不进历史；之后的快照会带着） */
const setVars = f => { const v = JSON.parse(JSON.stringify(vars())); f(v); Doc.variables = v; };
function varsDefine(p){
  const cmd = 'image.variables.define';
  if (!Array.isArray(p.defs)) bad(cmd, 'need `defs`');
  const defs = [];
  for (const d of p.defs){
    if (!d || typeof d.name !== 'string') bad(cmd, 'a def needs `name`');
    if (d.layer === undefined || d.layer === null) bad(cmd, 'a def needs `layer`');
    if (!Doc.byId(String(d.layer))) return {ok:false, error:`no such layer: ${d.layer}`};
    const kind = parseKind(d); if (!kind) bad(cmd, 'a def needs a valid `type`');
    if (defs.some(e => e.name === d.name)) bad(cmd, `duplicate variable \`${d.name}\``);
    defs.push({name:d.name, layer:String(d.layer), kind});
  }
  setVars(v => { v.defs = defs; });
  return varsList();
}
function parseValue(x){
  if (!x || typeof x.variable !== 'string') return null;
  if (x.kind === 'visibility' && typeof x.value === 'boolean') return {variable:x.variable, kind:'visibility', value:x.value};
  if ((x.kind === 'text' || x.kind === 'pixels') && typeof x.value === 'string') return {variable:x.variable, kind:x.kind, value:x.value};
  return 'bad';
}
function varsDataSets(p){
  const cmd = 'image.variables.dataSets';
  if (!Array.isArray(p.dataSets)) bad(cmd, 'need `dataSets`');
  const sets = p.dataSets.map(r => {
    if (!r || typeof r.name !== 'string') bad(cmd, 'a data set needs `name`');
    const values = (Array.isArray(r.values) ? r.values : []).map(x => {
      if (!x || typeof x.variable !== 'string') bad(cmd, 'a value needs `variable`');
      const v = parseValue(x); if (v === 'bad' || !v) bad(cmd, 'a value needs `kind` and `value`');
      return v;
    });
    return {name:r.name, values};
  });
  setVars(v => { v.dataSets = p.append === true ? v.dataSets.concat(sets) : sets; });
  return varsList();
}
function resolveSet(p, cmd){
  const v = vars();
  if (typeof p.name === 'string'){ const i = v.dataSets.findIndex(s => s.name === p.name); if (i < 0) bad(cmd, `no data set \`${p.name}\``); return [v.dataSets[i], i]; }
  if (Number.isInteger(p.index)){ if (!v.dataSets[p.index]) bad(cmd, `no data set at index ${p.index}`); return [v.dataSets[p.index], p.index]; }
  bad(cmd, 'need `name` or `index`');
}
/* 像素层内容外框（文件坐标）；全透明回 null */
function layerBounds(L){
  const c = L.data.canvas, d = L.data.ctx.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  return x1 < 0 ? null : [x0 + L.x, y0 + L.y, x1 + 1 + L.x, y1 + 1 + L.y];
}
/* replace_pixels：目标框＝该层内容外框（没内容＝整张），按 fit／fill／conform／asIs 缩放、九宫对齐、可剪切到框 */
function replacePixels(L, img, kind){
  const t = layerBounds(L) || [0, 0, Doc.width, Doc.height], tw = t[2] - t[0], th = t[3] - t[1];
  const iw = Math.max(img.naturalWidth || img.width, 1), ih = Math.max(img.naturalHeight || img.height, 1);
  let sx = 1, sy = 1;
  if (kind.method === 'fit'){ sx = sy = Math.min(tw / iw, th / ih); }
  else if (kind.method === 'fill'){ sx = sy = Math.max(tw / iw, th / ih); }
  else if (kind.method === 'conform'){ sx = tw / iw; sy = th / ih; }
  const sw = iw * sx, sh = ih * sy, a = kind.align;
  const fx = /Left$|^topLeft$/.test(a) ? 0 : /Right$/.test(a) ? 1 : 0.5, fy = /^top/.test(a) ? 0 : /^bottom/.test(a) ? 1 : 0.5;
  const dx = Math.round(t[0] + (tw - sw) * fx), dy = Math.round(t[1] + (th - sh) * fy);
  // 像素层画布只有内容那块（engine.js LayerBox）⇒ 换上的图（填满／原大）超出原内容外框的部分要先把画布长大，不然被截（旧版整张文件大的画布＝截在文件边）
  if (window.LayerBox && !kind.clip) LayerBox.ensureCovers(L, [Math.max(0, dx), Math.max(0, dy), Math.min(Doc.width, dx + sw), Math.min(Doc.height, dy + sh)]);
  const ctx = L.data.ctx; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, L.data.canvas.width, L.data.canvas.height);
  if (kind.clip){ ctx.beginPath(); ctx.rect(t[0] - L.x, t[1] - L.y, tw, th); ctx.clip(); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, dx - L.x, dy - L.y, sw, sh);                       // 铁律④：文件坐标减 L.x/L.y
  ctx.restore(); Layer.invalidate(L);
}
function applyToDoc(set, imgs){
  const v = vars();
  for (const dv of set.values){
    const def = v.defs.find(d => d.name === dv.variable); if (!def) continue;
    const L = Doc.byId(def.layer); if (!L) continue;
    if (def.kind.type === 'visibility' && dv.kind === 'visibility') L.visible = dv.value;
    else if (def.kind.type === 'textReplacement' && dv.kind === 'text'){ if (L.kind === 'text'){ L.data.text = dv.value; Layer.invalidate(L); } }
    else if (def.kind.type === 'pixelReplacement' && dv.kind === 'pixels'){ if (L.kind === 'raster' && imgs[dv.value]) replacePixels(L, imgs[dv.value], def.kind); }
  }
}
const loadImg = url => new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error('load failed: ' + url)); im.src = url; });
/* apply_data_set：一步历史；像素替换要先把图载进来（浏览器里「路径」＝网址或 data URL） */
function applyDataSet(p){
  const cmd = 'image.applyDataSet', [set, idx] = resolveSet(p, cmd), v = vars();
  const urls = [...new Set(set.values.filter(dv => dv.kind === 'pixels' && v.defs.some(d => d.name === dv.variable && d.kind.type === 'pixelReplacement')).map(dv => dv.value))];
  const finish = imgs => {
    const r = edit(() => { applyToDoc(set, imgs); return {ok:true, applied:set.name, index:idx}; });
    setVars(x => { x.active = idx; });
    redraw();
    return r;
  };
  if (!urls.length) return finish({});
  return Promise.all(urls.map(u => loadImg(u).then(im => [u, im]))).then(list => finish(Object.fromEntries(list)), e => ({ok:false, error:`${cmd}: ${e.message}`}));
}

/* ═══════════ 分析（analysis_cmds.rs） ═══════════ */
const COLUMNS = [['label', 'Label'], ['dateTime', 'Date and Time'], ['document', 'Document'], ['source', 'Source'], ['scale', 'Scale'], ['scaleUnits', 'Scale Units'],
  ['scaleFactor', 'Scale Factor'], ['count', 'Count'], ['area', 'Area'], ['perimeter', 'Perimeter'], ['circularity', 'Circularity'], ['height', 'Height'], ['width', 'Width'],
  ['grayMin', 'Gray Value (Minimum)'], ['grayMax', 'Gray Value (Maximum)'], ['grayMean', 'Gray Value (Mean)'], ['grayMedian', 'Gray Value (Median)'],
  ['integratedDensity', 'Integrated Density'], ['histogram', 'Histogram'], ['length', 'Length'], ['angle', 'Angle']];
const COMMON = ['label', 'dateTime', 'document', 'source', 'scale', 'scaleUnits', 'scaleFactor'];
const AVAIL_EXTRA = {selection:['count', 'area', 'perimeter', 'circularity', 'height', 'width', 'grayMin', 'grayMax', 'grayMean', 'grayMedian', 'integratedDensity', 'histogram'], ruler:['length', 'angle'], count:['count']};
const available = src => COMMON.concat(AVAIL_EXTRA[src] || AVAIL_EXTRA.count);
/* 会话层级（跟 PS 一样不跟文件走）：测量记录、数据点选择 */
const AN = {log:[], nextRow:0, nextMeasurement:0, dataPoints:{selection:available('selection'), ruler:available('ruler'), count:available('count')}};
const round4 = v => Math.round(v * 10000) / 10000;
const trimNum = v => Number.isInteger(v) ? String(v) : String(v);
const meas = () => Doc.measurement || {};
const scaleOf = () => Object.assign({pixelLength:1, logicalLength:1, units:'pixels'}, meas().scale || {});
const factor = sc => sc.pixelLength > 0 ? sc.logicalLength / sc.pixelLength : 1;
const describe = sc => `${trimNum(sc.pixelLength)} pixels = ${sc.logicalLength.toFixed(4)} ${sc.units}`;
const isDefaultScale = sc => sc.pixelLength === 1 && sc.logicalLength === 1 && sc.units === 'pixels';
const scaleJson = sc => ({ok:true, pixelLength:sc.pixelLength, logicalLength:sc.logicalLength, units:sc.units, factor:factor(sc), text:describe(sc), default:isDefaultScale(sc)});
const setMeas = f => { const m = JSON.parse(JSON.stringify(meas())); f(m); Doc.measurement = m; };
function setMeasurementScale(p){
  const cmd = 'image.analysis.setMeasurementScale', cur = scaleOf();
  const keys = Object.keys(p).filter(k => k !== 'dialog');
  const preset = str(p, 'preset', keys.length ? 'custom' : 'query');
  let next;
  if (preset === 'query') return scaleJson(cur);
  if (preset === 'default') next = {pixelLength:1, logicalLength:1, units:'pixels'};
  else if (preset === 'custom'){
    const pl = num(p, 'pixelLength', cur.pixelLength), ll = num(p, 'logicalLength', cur.logicalLength);
    const units = typeof p.units === 'string' ? p.units : typeof p.logicalUnits === 'string' ? p.logicalUnits : cur.units;
    if (!(pl > 0 && ll > 0)) bad(cmd, 'pixelLength and logicalLength must be positive');
    if (!units.trim()) bad(cmd, 'units must not be empty');
    next = {pixelLength:pl, logicalLength:ll, units};
  } else bad(cmd, `unknown preset \`${preset}\` (default|custom)`);
  if (JSON.stringify(next) !== JSON.stringify(cur)) edit(() => { setMeas(m => { m.scale = next; }); });
  return scaleJson(next);
}
function selectDataPoints(p){
  const cmd = 'image.analysis.selectDataPoints';
  const next = p.reset === true ? {selection:available('selection'), ruler:available('ruler'), count:available('count')} : JSON.parse(JSON.stringify(AN.dataPoints));
  for (const src of ['selection', 'ruler', 'count']){
    const v = p[src]; if (v === undefined) continue;
    const avail = available(src);
    if (Array.isArray(v)){
      const keys = v.map(k => { if (typeof k !== 'string') bad(cmd, `\`${src}\` entries must be strings`); if (!avail.includes(k)) bad(cmd, `\`${k}\` is not a ${src} data point (${avail.join('|')})`); return k; });
      next[src] = keys;
    } else if (v && typeof v === 'object'){
      for (const [k, on] of Object.entries(v)){
        if (!avail.includes(k)) bad(cmd, `\`${k}\` is not a ${src} data point (${avail.join('|')})`);
        if (typeof on !== 'boolean') bad(cmd, `\`${src}.${k}\` must be a bool`);
        next[src] = next[src].filter(x => x !== k); if (on) next[src].push(k);
      }
    } else bad(cmd, `\`${src}\` must be a list of keys or an object of bools`);
    const order = k => COLUMNS.findIndex(c => c[0] === k);
    next[src].sort((a, b) => order(a) - order(b));
  }
  AN.dataPoints = next;
  return {ok:true, dataPoints:next, available:{selection:available('selection'), ruler:available('ruler'), count:available('count')}, columns:COLUMNS.map(c => ({key:c[0], name:c[1]}))};
}
/* measure_features：8 连通（union-find）→ 依首像素扫描次序编号；周长＝像素中心格上的 marching squares（直边 1、斜 √2/2×2）；灰度统计 */
function measureFeatures(mask, gray, w, h, ox, oy, range){
  const label = new Int32Array(w * h).fill(-1), parent = [];
  const root = i => { while (parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y * w + x; if (!mask[i]) continue;
    const nb = [x > 0 ? label[i - 1] : -1, y > 0 ? label[i - w] : -1, y > 0 && x > 0 ? label[i - w - 1] : -1, y > 0 && x + 1 < w ? label[i - w + 1] : -1];
    let best = -1;
    for (const n of nb) if (n >= 0){ const r = root(n); best = best < 0 ? r : Math.min(best, r); }
    if (best < 0){ best = parent.length; parent.push(best); }
    else for (const n of nb) if (n >= 0){ const r = root(n); if (r !== best){ const a = Math.min(r, best), b = Math.max(r, best); parent[b] = a; best = a; } }
    label[i] = best;
  }
  const index = new Int32Array(parent.length).fill(-1); let n = 0;
  for (let i = 0; i < label.length; i++){ if (label[i] < 0) continue; const r = root(label[i]); if (index[r] < 0) index[r] = n++; label[i] = index[r]; }
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? -1 : label[y * w + x], HD = Math.SQRT1_2, per = new Float64Array(n);
  for (let y = -1; y < h; y++) for (let x = -1; x < w; x++){
    const c = [at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)], inside = c.filter(v => v >= 0).length;
    const len = (inside === 1 || inside === 3) ? HD : inside === 2 ? ((c[0] >= 0) === (c[2] >= 0) ? 2 * HD : 1) : 0;
    if (len > 0){ const f = c.find(v => v >= 0); per[f] += len; }
  }
  const feats = Array.from({length:n}, () => ({area:0, perimeter:0, bounds:null, grayMin:Infinity, grayMax:-Infinity, grayMean:0, grayMedian:0, histogram:new Array(256).fill(0)}));
  const sums = new Float64Array(n), values = Array.from({length:n}, () => []);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const l = label[y * w + x]; if (l < 0) continue;
    const f = feats[l], px = x + ox, py = y + oy; f.area++;
    f.bounds = f.bounds ? [Math.min(f.bounds[0], px), Math.min(f.bounds[1], py), Math.max(f.bounds[2], px + 1), Math.max(f.bounds[3], py + 1)] : [px, py, px + 1, py + 1];
    const g = gray[y * w + x]; f.grayMin = Math.min(f.grayMin, g); f.grayMax = Math.max(f.grayMax, g); sums[l] += g;
    f.histogram[Math.round(clamp01(g) * 255)]++; values[l].push(Math.round(clamp01(g) * 65535));
  }
  feats.forEach((f, i) => { f.perimeter = per[i]; f.grayMean = sums[i] / Math.max(f.area, 1) * range; f.grayMin *= range; f.grayMax *= range; f.grayMedian = median(values[i]) * range; });
  return feats;
}
/* median：select_nth(mid)；偶数个＝跟左半最大的平均 */
function median(v){
  if (!v.length) return 0;
  const s = v.slice().sort((a, b) => a - b), mid = v.length >> 1;
  return (v.length % 2 === 0 ? (s[mid] + s[mid - 1]) / 2 : s[mid]) / 65535;
}
const circularity = f => f.perimeter > 0 ? Math.min(4 * Math.PI * f.area / (f.perimeter * f.perimeter), 1) : 0;
const grayRange = () => docDepth() === 8 ? 255 : docDepth() === 16 ? 32768 : 1;
function selectionRows(){
  const W = Doc.width, H = Doc.height, bytes = (Doc.sel && window.SelMask) ? SelMask.bytes() : null;
  let r = [0, 0, W, H];
  if (bytes){ let x0 = W, y0 = H, x1 = -1, y1 = -1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (bytes[y * W + x]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; } r = x1 < 0 ? [0, 0, 0, 0] : [x0, y0, x1 + 1, y1 + 1]; }
  const w = r[2] - r[0], h = r[3] - r[1];
  if (w <= 0 || h <= 0) throw new Bad('the selection is empty');
  const d = baseComposite(1).getContext('2d').getImageData(r[0], r[1], w, h).data, mask = new Uint8Array(w * h), gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y * w + x; mask[i] = bytes ? (bytes[(y + r[1]) * W + x + r[0]] >= 128 ? 1 : 0) : 1;     // 覆盖度 ≥ 50%
    gray[i] = (0.30 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]) / 255;
  }
  const range = grayRange(), feats = measureFeatures(mask, gray, w, h, r[0], r[1], range);
  if (!feats.length) throw new Bad('the selection is empty');
  const all = []; for (let i = 0; i < mask.length; i++) if (mask[i]) all.push(Math.round(clamp01(gray[i]) * 65535));
  const area = feats.reduce((a, f) => a + f.area, 0), hist = new Array(256).fill(0);
  let b = null; feats.forEach(f => { f.histogram.forEach((v, k) => { hist[k] += v; }); b = b ? [Math.min(b[0], f.bounds[0]), Math.min(b[1], f.bounds[1]), Math.max(b[2], f.bounds[2]), Math.max(b[3], f.bounds[3])] : f.bounds.slice(); });
  const sum = {area, perimeter:feats.reduce((a, f) => a + f.perimeter, 0), bounds:b, grayMin:Math.min(...feats.map(f => f.grayMin)), grayMax:Math.max(...feats.map(f => f.grayMax)),
    grayMean:feats.reduce((a, f) => a + f.grayMean * f.area, 0) / Math.max(area, 1), grayMedian:median(all) * range, histogram:hist};
  return [sum, feats];
}
/* ruler_info：X/Y（起点）、W/H、角度 A（y 朝上逆时针 −180…180；量角器＝两臂夹角）、L1／L2、换算后的长度 */
function rulerInfo(r, sc){
  const dx = r.end[0] - r.start[0], dy = r.end[1] - r.start[1], l1 = Math.hypot(dx, dy), f = factor(sc);
  if (!r.protractor) return {x:r.start[0], y:r.start[1], w:dx, h:dy, angle:round4(Math.atan2(-dy, dx) * 180 / Math.PI), l1:round4(l1), l2:null, length:round4(l1 * f), units:sc.units, protractor:false};
  const ex = r.protractor[0] - r.start[0], ey = r.protractor[1] - r.start[1];
  let a = Math.abs((Math.atan2(-dy, dx) - Math.atan2(-ey, ex)) * 180 / Math.PI); if (a > 180) a = 360 - a;
  return {x:r.start[0], y:r.start[1], w:dx, h:dy, angle:round4(a), l1:round4(l1), l2:round4(Math.hypot(ex, ey)), length:round4(l1 * f), units:sc.units, protractor:true};
}
const pt = v => (Array.isArray(v) && v.length >= 2 && isNum(v[0]) && isNum(v[1])) ? [v[0], v[1]] : null;
/* ruler_tool：标尺线是文件资料但不算编辑（set_quiet，不进历史） */
function rulerTool(p){
  const cmd = 'image.analysis.rulerTool';
  if (p.pick === true){ if (!window.UI || !UI.pick) bad(cmd, 'no toolbar (UI.pick)'); UI.pick('ruler'); return {ok:true, tool:window.ToolState ? ToolState.cur : 'ruler'}; }   // 菜单 图像▸分析▸标尺工具＝换成标尺工具
  if (p.clear === true){ setMeas(m => { m.ruler = null; }); return {ok:true, ruler:null}; }
  const s = pt(p.start), e = pt(p.end);
  let r = meas().ruler ? JSON.parse(JSON.stringify(meas().ruler)) : null;
  if (s && e){
    let prot = null;
    if (p.protractor !== undefined && p.protractor !== null){ prot = pt(p.protractor); if (!prot) bad(cmd, '`protractor` must be [x, y] or null'); }
    r = {start:s, end:e, protractor:prot};
  } else if (!s && !e && p.start === undefined && p.end === undefined){
    if (r && p.protractor !== undefined){ if (p.protractor === null) r.protractor = null; else { const q = pt(p.protractor); if (!q) bad(cmd, '`protractor` must be [x, y] or null'); r.protractor = q; } }
  } else bad(cmd, 'pass both `start` and `end`');
  if (JSON.stringify(r) !== JSON.stringify(meas().ruler || null)) setMeas(m => { m.ruler = r; });
  return r ? {ok:true, ruler:r, info:rulerInfo(r, scaleOf())} : {ok:true, ruler:null};
}
/* inscribed：转 a 弧度的 w×h 矩形里最大的轴向矩形 */
function inscribed(w, h, a){
  const sa = Math.abs(Math.sin(a)), ca = Math.abs(Math.cos(a)), longW = w >= h, lg = longW ? w : h, sh = longW ? h : w;
  if (sh <= 2 * sa * ca * lg || Math.abs(sa - ca) < 1e-10){ const x = 0.5 * sh; return longW ? [x / sa, x / ca] : [x / ca, x / sa]; }
  const c2 = ca * ca - sa * sa; return [(w * ca - h * sa) / c2, (h * ca - w * sa) / c2];
}
/* straighten：转到最近的轴；背景层（或没有当前层）＝转整张画布再裁到图里，否则只转当前层（绕画布中心）；标尺清掉；一步历史 */
function straighten(p){
  const r = meas().ruler; if (!r) return {ok:false, error:'no ruler line'};
  const a = Math.atan2(-(r.end[1] - r.start[1]), r.end[0] - r.start[0]) * 180 / Math.PI, q = a / 90, rot = a - 90 * Math.sign(q) * Math.round(Math.abs(q));   // Rust round：.5 远离零
  if (Math.abs(rot) < 1e-9) return {ok:true, angle:0};
  const L = Doc.active(), isBg = L && window.PsLayer && PsLayer.isBackground ? PsLayer.isBackground(L) : !!(L && L.isBackground);
  const crop = typeof p.crop === 'boolean' ? p.crop : (isBg || !L);
  const w0 = Doc.width, h0 = Doc.height, n0 = History.past.length;
  const r1 = edit(() => {
    if (crop){
      const a1 = CMD.map['ps.image.rotation.arbitrary'].run({angle:rot, direction:'cw'});
      if (a1 && a1.ok === false) return a1;
      const [cw0, ch0] = inscribed(w0, h0, rot * Math.PI / 180), nw = Doc.width, nh = Doc.height;
      const cw = clamp(Math.floor(cw0), 1, nw), ch = clamp(Math.floor(ch0), 1, nh);
      const a2 = CMD.map['ps.image.crop'].run({x:Math.round((nw - cw) / 2), y:Math.round((nh - ch) / 2), width:cw, height:ch});
      if (a2 && a2.ok === false) return a2;
    } else {
      const cx = w0 / 2, cy = h0 / 2, sn = Math.sin(rot * Math.PI / 180), cs = Math.cos(rot * Math.PI / 180);
      const a3 = CMD.map['move.transform'].run({matrix:[cs, sn, -sn, cs, cx - (cs * cx - sn * cy), cy - (sn * cx + cs * cy)]});
      if (a3 && a3.ok === false) return a3;
    }
    setMeas(m => { m.ruler = null; });
    return {ok:true, angle:round4(rot), cropped:crop, width:Doc.width, height:Doc.height};
  });
  History.past.length = Math.min(History.past.length, n0 + 1);           // 里面叫的命令自己记的步骤并成一步（compound）
  return r1;
}
/* ── 计数 ── */
const GROUP_COLORS = [[1, 0, 0], [0, 0.6, 1], [0, 0.8, 0], [1, 0.6, 0], [0.8, 0, 0.8], [1, 1, 0]];
const groups = () => meas().countGroups || [];
const activeGroup = () => meas().activeCountGroup || 0;
function colorParam(v){
  if (typeof v === 'string'){ const c = parseColor8(v); return c ? c.map(x => x / 255) : null; }
  if (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(isNum)){ const big = v.slice(0, 3).some(x => x > 1); return v.slice(0, 3).map(x => clamp01(big ? x / 255 : x)); }
  return null;
}
const newGroup = (name, color) => { const n = groups().length, c = GROUP_COLORS[n % GROUP_COLORS.length]; return {name:name || `Count Group ${n + 1}`, color:color || c.slice(), markerSize:1, labelSize:8, visible:true, points:[]}; };
const countTotal = () => groups().reduce((a, g) => a + g.points.length, 0);
const countJson = () => ({ok:true, total:countTotal(), activeGroup:activeGroup(),
  groups:groups().map(g => ({name:g.name, color:g.color, markerSize:g.markerSize, labelSize:g.labelSize, visible:g.visible, count:g.points.length, points:g.points}))});
const groupIndex = p => { const i = Number.isInteger(p.group) ? p.group : activeGroup(); return i < groups().length ? i : null; };
function countAdd(p){
  const at = (isNum(p.x) && isNum(p.y)) ? [p.x, p.y] : pt(p.point);
  if (!at) bad('count.add', 'pass `x` and `y`');
  let n;
  edit(() => setMeas(m => {
    m.countGroups = m.countGroups || [];
    if (!m.countGroups.length){ m.countGroups.push({name:'Count Group 1', color:[1, 0, 0], markerSize:1, labelSize:8, visible:true, points:[]}); m.activeCountGroup = 0; }
    const i = Math.min(Number.isInteger(p.group) ? p.group : (m.activeCountGroup || 0), m.countGroups.length - 1);
    m.countGroups[i].points.push(at); n = m.countGroups[i].points.length;
  }));
  return Object.assign(countJson(), {number:n});
}
function locate(p, cmd){
  const g = groups();
  if (Number.isInteger(p.index)){
    const gi = groupIndex(p); if (gi === null) bad(cmd, 'no such count group');
    if (p.index >= 0 && p.index < g[gi].points.length) return [gi, p.index];
    bad(cmd, `no marker ${p.index}`);
  }
  if (!(isNum(p.x) && isNum(p.y))) bad(cmd, 'pass `index` or `x`/`y`');
  const radius = num(p, 'radius', 6), only = Number.isInteger(p.group) ? p.group : null;
  let best = null;
  g.forEach((grp, gi) => { if ((only !== null && only !== gi) || !grp.visible) return; grp.points.forEach((q, pi) => { const d = Math.hypot(q[0] - p.x, q[1] - p.y); if (d <= radius && (!best || d < best[0])) best = [d, gi, pi]; }); });
  if (!best) throw new Bad('no count marker there');
  return [best[1], best[2]];
}
function countRemove(p){ const [g, i] = locate(p, 'count.remove'); edit(() => setMeas(m => { m.countGroups[g].points.splice(i, 1); })); return countJson(); }
function countMove(p){ const to = pt(p.to); if (!to) bad('count.move', 'pass `to`: [x, y]'); const [g, i] = locate(p, 'count.move'); edit(() => setMeas(m => { m.countGroups[g].points[i] = to; })); return countJson(); }
function countClear(p){
  const all = p.group === 'all', g = all ? null : groupIndex(p);
  if (!all && g === null) bad('count.clear', 'no such count group');
  edit(() => setMeas(m => { (m.countGroups || []).forEach((grp, i) => { if (all || i === g) grp.points = []; }); }));
  return countJson();
}
function countNewGroup(p){
  const name = typeof p.name === 'string' ? p.name : null, color = p.color !== undefined ? colorParam(p.color) : null;
  edit(() => setMeas(m => { const g = newGroup(name, color); m.countGroups = (m.countGroups || []).concat([g]); m.activeCountGroup = m.countGroups.length - 1; }));
  return countJson();
}
function countDeleteGroup(p){
  const g = groupIndex(p); if (g === null) bad('count.deleteGroup', 'no such count group');
  edit(() => setMeas(m => { m.countGroups.splice(g, 1); m.activeCountGroup = Math.min(m.activeCountGroup || 0, Math.max(m.countGroups.length - 1, 0)); }));
  return countJson();
}
function countSetGroup(p){
  const g = groupIndex(p); if (g === null) bad('count.setGroup', 'no such count group');
  const grp = JSON.parse(JSON.stringify(groups()[g]));
  if (typeof p.name === 'string') grp.name = p.name;
  if (p.color !== undefined){ const c = colorParam(p.color); if (c) grp.color = c; }
  if (Number.isInteger(p.markerSize)) grp.markerSize = clamp(p.markerSize, 1, 10);
  if (Number.isInteger(p.labelSize)) grp.labelSize = clamp(p.labelSize, 8, 72);
  if (typeof p.visible === 'boolean') grp.visible = p.visible;
  const keys = Object.keys(p), activate = p.active === true || (keys.length === 1 && keys[0] === 'group');
  const changed = JSON.stringify(grp) !== JSON.stringify(groups()[g]);
  if (changed || (activate && activeGroup() !== g)) edit(() => setMeas(m => { m.countGroups[g] = grp; if (activate) m.activeCountGroup = g; }));
  return countJson();
}
/* ── 记录测量 ── */
const docName = () => (document.title || 'Untitled').replace(/\s*—.*$/, '') || 'Untitled';
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
function baseRow(src, label, now){
  const sc = scaleOf();
  return {label, dateTime:now, document:docName(), source:src === 'selection' ? 'Selection' : src === 'ruler' ? 'Ruler Tool' : 'Count Tool', scale:describe(sc), scaleUnits:sc.units, scaleFactor:factor(sc)};
}
function featureValues(m, f, count, k){
  Object.assign(m, {count, area:round4(f.area * k * k), perimeter:round4(f.perimeter * k), circularity:round4(circularity(f)),
    height:round4((f.bounds[3] - f.bounds[1]) * k), width:round4((f.bounds[2] - f.bounds[0]) * k), grayMin:round4(f.grayMin), grayMax:round4(f.grayMax),
    grayMean:round4(f.grayMean), grayMedian:round4(f.grayMedian), integratedDensity:round4(f.area * f.grayMean), histogram:f.histogram});
}
function recordMeasurements(p){
  const cmd = 'image.analysis.recordMeasurements';
  let src = str(p, 'source', 'auto');
  if (src === 'auto') src = Doc.sel ? 'selection' : meas().ruler ? 'ruler' : countTotal() > 0 ? 'count' : 'selection';
  else if (!['selection', 'ruler', 'count'].includes(src)) bad(cmd, `unknown source \`${src}\` (auto|selection|ruler|count)`);
  AN.nextMeasurement++;
  const label = `Measurement ${AN.nextMeasurement}`, now = typeof p.dateTime === 'string' ? p.dateTime : nowIso(), k = factor(scaleOf()), rows = [];
  if (src === 'selection'){
    const [sum, feats] = selectionRows();
    const m = baseRow(src, label, now); featureValues(m, sum, feats.length, k); rows.push(m);
    if (feats.length > 1) feats.forEach((f, i) => { const r = baseRow(src, `Feature ${i + 1}`, now); featureValues(r, f, 1, k); rows.push(r); });
  } else if (src === 'ruler'){
    const r = meas().ruler; if (!r) throw new Bad('no ruler line to measure');
    const info = rulerInfo(r, scaleOf()), m = baseRow(src, label, now); m.length = info.length; m.angle = info.angle; rows.push(m);
  } else { const m = baseRow(src, label, now); m.count = countTotal(); rows.push(m); }
  const keep = AN.dataPoints[src], out = [];
  for (const m of rows){
    const values = {}; COLUMNS.forEach(([c]) => { if (keep.includes(c) && m[c] !== undefined) values[c] = m[c]; });
    AN.nextRow++; const row = {id:AN.nextRow, values}; AN.log.push(row); out.push(row);
  }
  if (p.showLog) setTimeout(() => openLogPanel(), 0);
  return {ok:true, source:src, rows:JSON.parse(JSON.stringify(out))};
}
const logColumns = rows => COLUMNS.map(c => c[0]).filter(k => rows.some(r => k in r.values));
function csvField(v){
  const s = typeof v === 'string' ? v : Array.isArray(v) ? v.map(x => String(x)).join(' ') : v == null ? '' : String(v);
  return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function logCsv(rows){
  const cols = logColumns(rows);
  let out = cols.map(k => (COLUMNS.find(c => c[0] === k) || [k, k])[1]).join(',') + '\n';
  rows.forEach(r => { out += cols.map(k => k in r.values ? csvField(r.values[k]) : '').join(',') + '\n'; });
  return out;
}
const idsParam = p => Array.isArray(p.rows) ? p.rows.filter(Number.isInteger) : null;
/* ── 比例标记 ── */
function niceLength(){
  const target = Doc.width / 5 * factor(scaleOf()), e = Math.pow(10, Math.floor(Math.log10(target)));
  return [5, 2, 1].map(m => m * e).find(v => v <= target) || e;
}
function placeScaleMarker(p){
  const cmd = 'image.analysis.placeScaleMarker', sc = scaleOf(), length = isNum(p.length) ? p.length : niceLength();
  if (!(length > 0)) bad(cmd, 'length must be positive');
  const px = length / factor(sc), w = Doc.width, h = Doc.height;
  if (px < 1 || px > w) bad(cmd, `a ${length} ${sc.units} bar is ${px.toFixed(1)} px; it must fit the ${w} px wide image`);
  const fontSize = clamp(num(p, 'fontSize', 12), 1, 1000), font = typeof p.font === 'string' && p.font ? p.font : null;
  const showText = typeof p.displayText === 'boolean' ? p.displayText : true, pos = str(p, 'textPosition', 'bottom');
  if (pos !== 'top' && pos !== 'bottom') bad(cmd, `textPosition \`${pos}\` (top|bottom)`);
  const colName = str(p, 'color', 'black'); if (colName !== 'black' && colName !== 'white') bad(cmd, `color \`${colName}\` (black|white)`);
  const hex = colName === 'black' ? '#000000' : '#ffffff', top = pos === 'top';
  const margin = Math.max(Math.round(Math.min(w, h) * 0.03), 2), barH = clamp(Math.round(fontSize / 4), 2, h / 4), textH = showText ? fontSize * 1.25 : 0;
  const barY = top ? h - margin - barH : h - margin - barH - textH;
  const bar = [Math.trunc(margin), Math.round(barY), Math.round(margin + px), Math.round(barY + barH)];
  const label = `${trimNum(length)} ${sc.units}`;
  return edit(() => {
    const B = Layer.raster('Scale Bar'); B.data.ctx.fillStyle = hex; B.data.ctx.fillRect(bar[0], bar[1], bar[2] - bar[0], bar[3] - bar[1]);
    Doc.add(B);
    let tid = null;
    if (showText){
      const baseline = top ? bar[1] - fontSize * 0.3 : bar[3] + fontSize, o = {x:bar[0], y:baseline, text:label, size:fontSize, color:hex};
      if (font) o.font = font;
      const L = Layer.text(label, o); Doc.add(L); tid = L.id;
    }
    return {ok:true, group:null, bar:B.id, text:tid, barRect:bar, pixels:px, label};
  });
}

/* ═══════════ 命令登记（ps.<原码 id>；带对话框的项：{dialog:true}＝开对话框，其余参数＝直接做） ═══════════ */
const DLG = {};
const DIALOG_IDS = new Set(['image.mode.indexedColor', 'image.mode.colorTable', 'image.mode.bitmap', 'image.mode.duotone', 'image.variables.define', 'image.variables.dataSets', 'image.applyDataSet', 'image.trap',
  'image.analysis.setMeasurementScale', 'image.analysis.selectDataPoints', 'image.analysis.rulerTool', 'image.analysis.countTool', 'image.analysis.placeScaleMarker']);
function reg(id, params, fn, opt){
  opt = opt || {};
  const run = wrap(fn);
  CMD.reg('ps.' + id, {i18n:'', undoable:false, params:params + (DIALOG_IDS.has(id) ? '｜{dialog:true}＝开对话框（同点菜单）' : '') + (opt.noHistory ? '' : '；改了文件才记一步历史（Ctrl+Z 可退）')},
    p => { p = p || {}; if (p.dialog && DLG[id]){ const q = Object.assign({}, p); delete q.dialog; DLG[id](q); return {ok:true, dialog:'opened'}; } return run(p); });
}
const PROFILE_PARAMS = '{"profile":"working|<该模式内建 id>"=working,"intent":"perceptual|relative|saturation|absolute"="relative","bpc":bool=true}';
reg('image.mode.rgb', PROFILE_PARAMS + ' RGB 颜色：从 CMYK／Lab／灰度等转回 sRGB（像素就是该模式显示的样子 ⇒ 不变）；从多通道＝3 个通道照 RGB 解读 → {ok, mode, profile, intent, bpc}', p => convertMode('rgb', p));
reg('image.mode.grayscale', PROFILE_PARAMS + ' 灰度：经 CMS 转到 sGray（PCS 只取 Y，再过 sRGB 曲线）；填色／文字／形状颜色一起转 → {ok, mode, …}', p => convertMode('grayscale', p));
reg('image.mode.cmyk', PROFILE_PARAMS + ' CMYK 颜色：经 CMS 转到合成铜版纸 CMYK（Neugebauer 模型＋GCR、总墨量 300%；相对比色＋黑场补偿），存的是 CMYK 再显示回 sRGB 的样子（出色域的颜色被压进来） → {ok, mode, …}', p => convertMode('cmyk', p));
reg('image.mode.lab', PROFILE_PARAMS + ' Lab 颜色：转到 CIE Lab D50（按深度量化 8 位＝L/100、(a+128)/255）→ 显示回 sRGB → {ok, mode, …}', p => convertMode('lab', p));
reg('image.mode.multichannel', '{} 多通道（拼合）：RGB → 青／洋红／黄（亮度当墨：1−值）、CMYK → 青／洋红／黄／黑、Lab → Alpha 1–3、灰度 → 黑、双色调 → 各油墨；没有图层，油墨通道印在白纸上显示 → {ok, mode, channels}', () => toMultichannel());
reg('image.mode.indexedColor', '{"palette":"selective|perceptual|adaptive|exact|systemMac|systemWindows|web|uniform"="selective","colors":2..256=256,"forced":"blackWhite|none|primaries|web"="blackWhite","transparency":bool=true,"dither":"diffusion|none|pattern|noise"="diffusion","amount":0..100=75} 索引颜色（拼合成一层；有透明就多一格透明色、层名「索引」）→ {ok, colors, transparentIndex}', indexedColor);
reg('image.mode.colorTable', '{"table":"custom|blackBody|grayscale|spectrum|systemMac|systemWindows|web"="custom","colors":["#rrggbb"…],"entries":{"索引":"#rrggbb"},"transparent":索引|null} 颜色表：像素留着旧表的索引、颜色跟新表；不给改动＝回目前的表 → {ok, colors, transparent}', colorTable);
reg('image.mode.bitmap', '{"method":"diffusion|threshold|pattern|halftone"="diffusion","frequency":1..999=53（线/英寸）,"angle":-180..180=45,"shape":"round|ellipse|line|square|diamond|cross"="round"} 位图（要先灰度；拼合成一层黑白）→ {ok}', bitmap);
reg('image.mode.duotone', '{"type":"duotone|monotone|tritone|quadtone"="duotone","inks":[{"name","color":"#rrggbb","curve":[[入,出],…] 0..100}…]} 双色调（要先灰度）：像素留灰，显示／导出时照油墨印出来 → {ok, inks}', duotone);
reg('image.mode.bits8', '{} 8 位/通道（画布本来就是 8 位；从 16／32 位回来不动像素）→ {ok, depth}', () => convertDepth(8));
reg('image.mode.bits16', '{} 16 位/通道：记在 Doc.depth（画布仍是 8 位 RGBA；之后转模式按 16 位量化、分析灰度值范围 0–32768）→ {ok, depth}', () => convertDepth(16));
reg('image.mode.bits32', '{} 32 位/通道：记在 Doc.depth（画布仍是 8 位；转模式不再量化、分析灰度值范围 0–1）→ {ok, depth}', () => convertDepth(32));
reg('image.variables.define', '{defs:[{name, layer:图层 id, type:"visibility|textReplacement|pixelReplacement", method?:"fit|fill|asIs|conform", align?:"topLeft…bottomRight|center", clip?:bool}]} 定义变量（整份换掉；不算编辑、不进历史）→ {ok, defs, dataSets, active}', varsDefine);
reg('image.variables.dataSets', '{dataSets:[{name, values:[{variable, kind:"visibility|text|pixels", value}]}], append?:bool} 数据组（pixels 的 value＝图片网址或 data URL）→ {ok, defs, dataSets, active}', varsDataSets);
reg('image.applyDataSet', '{name|index} 应用数据组：图层可见性／文字／像素替换（一步历史；有像素替换会回 Promise）→ {ok, applied, index}', applyDataSet);
reg('variables.list', '{} 列出变量与数据组 → {ok, defs, dataSets, active}', () => varsList(), {noHistory:true});
reg('image.trap', '{"width":px>=0=1} 陷印（要 CMYK）：当前像素层每个色版做最大值膨胀，只吃进本来有墨的像素（色块交界多一条叠色带、纸白不动）→ {ok, trapped, width, pixels}', trap);
reg('image.analysis.setMeasurementScale', '{"preset":"default|custom"="custom","pixelLength":px,"logicalLength":数,"units":"mm"…}（不给参数＝读目前的比例）→ {ok, pixelLength, logicalLength, units, factor, text, default}', setMeasurementScale);
reg('image.analysis.selectDataPoints', '{"selection":[键]|{键:bool},"ruler":…,"count":…,"reset":bool}（会话层级、不进历史；键见 columns）→ {ok, dataPoints, available, columns}', selectDataPoints, {noHistory:true});
reg('image.analysis.recordMeasurements', '{"source":"auto|selection|ruler|count"="auto","dateTime"?, "showLog"?:bool} 记录测量：选区＝摘要一列＋每个特征一列（面积、周长、圆度、宽高、灰度最小／最大／平均／中位、积分密度、直方图）；标尺＝长度、角度；计数＝个数 → {ok, source, rows}', recordMeasurements, {noHistory:true});
reg('image.analysis.rulerTool', '{"start":[x,y],"end":[x,y],"protractor":[x,y]|null,"clear":bool}（不给＝读目前的标尺；不进历史；{dialog:true}＝开标尺面板；{pick:true}＝换成标尺工具＝菜单那一项）→ {ok, ruler, info:{x,y,w,h,angle,l1,l2,length,units}}', rulerTool, {noHistory:true});
reg('image.analysis.countTool', '{} 读计数组与标记（改用 ps.count.*；{dialog:true}＝开计数面板，在画布上点一下加一个；{pick:true}＝换成计数工具＝菜单那一项）→ {ok, total, activeGroup, groups}', p => {
  if (p && p.pick === true){ if (!window.UI || !UI.pick) return {ok:false, error:'image.analysis.countTool: no toolbar (UI.pick)'}; UI.pick('count'); return Object.assign(countJson(), {tool:window.ToolState ? ToolState.cur : 'count'}); }
  return countJson(); }, {noHistory:true});
reg('image.analysis.placeScaleMarker', '{"length":逻辑单位=约宽度的 1/5 取 1/2/5×10ⁿ,"font"?,"fontSize":pt=12,"displayText":bool=true,"textPosition":"top|bottom"="bottom","color":"black|white"="black"} 置入比例标记：左下角一条比例尺（像素层「Scale Bar」）＋文字层 → {ok, bar, text, barRect, pixels, label}', placeScaleMarker);
reg('image.analysis.straightenLayer', '{"crop":bool=(当前层是背景)} 拉直图层：按标尺线转到最近的水平／垂直；crop＝转整张画布再裁到图内，否则只转当前层；标尺清掉（一步历史）→ {ok, angle, cropped, width, height}', straighten);
reg('image.analysis.info', '{} 分析资讯：比例、标尺读数、计数组、测量记录列数 → {ok, scale, ruler, count, logRows}',
  () => { const r = meas().ruler; return {ok:true, scale:scaleJson(scaleOf()), ruler:r ? {start:r.start, end:r.end, protractor:r.protractor, info:rulerInfo(r, scaleOf())} : null, count:countJson(), logRows:AN.log.length}; }, {noHistory:true});
reg('count.add', '{"x":px,"y":px,"group"?:索引} 加一个计数标记（没有计数组会先建一组）→ {ok, total, groups, number}', countAdd);
reg('count.remove', '{"index":n,"group"?} | {"x":px,"y":px,"radius":px=6} 删掉一个计数标记', countRemove);
reg('count.move', '{"index":n,"group"?,"to":[x,y]} | {"x","y","to":[x,y]} 移动计数标记', countMove);
reg('count.clear', '{"group":索引|"all"=目前那组} 清除计数', countClear);
reg('count.newGroup', '{"name"?,"color"?:"#rrggbb"|[r,g,b]} 新建计数组（变成目前那组）', countNewGroup);
reg('count.deleteGroup', '{"group"=目前那组} 删除计数组', countDeleteGroup);
reg('count.setGroup', '{"group"=目前,"name"?,"color"?,"markerSize":1..10?,"labelSize":8..72?,"visible":bool?,"active":bool?} 计数组选项', countSetGroup);
reg('measurementLog.list', '{} 测量记录 → {ok, rows, columns}', () => ({ok:true, rows:JSON.parse(JSON.stringify(AN.log)), columns:logColumns(AN.log)}), {noHistory:true});
reg('measurementLog.delete', '{"rows":[id…]}|{"all":true} 删除测量记录 → {ok, deleted, remaining}', p => {
  const before = AN.log.length, ids = idsParam(p);
  if (!AN.log.length) return {ok:false, error:'the Measurement Log is empty'};
  if (ids) AN.log = AN.log.filter(r => !ids.includes(r.id)); else if (p.all === true) AN.log = []; else bad('measurementLog.delete', 'pass `rows`: [ids] or `all`: true');
  return {ok:true, deleted:before - AN.log.length, remaining:AN.log.length};
}, {noHistory:true});
reg('measurementLog.export', '{"rows"?:[id…],"download"?:bool,"name"?} 导出测量记录：回 CSV 文字（PS 栏名）；download＝另存 .csv 档 → {ok, csv, rows}', p => {
  const ids = idsParam(p), rows = ids ? AN.log.filter(r => ids.includes(r.id)) : AN.log, csv = logCsv(rows);
  if (p.download === true && typeof download === 'function') download(new Blob([csv], {type:'text/csv'}), (p.name || 'measurements') + '.csv');
  return {ok:true, csv, rows:rows.length};
}, {noHistory:true});

/* ═══════════ 三语字串 ═══════════ */
const S = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, en:c});
const STR = {
  ok:S('確定', '确定', 'OK'), cancel:S('取消', '取消', 'Cancel'), close:S('關閉', '关闭', 'Close'), error:S('無法完成：', '无法完成：', 'Could not complete: '),
  indexLayer:S('索引', '索引', 'Index'),
  idxTitle:S('索引色', '索引颜色', 'Indexed Color'), palette:S('色盤', '调板', 'Palette'), colors:S('顏色', '颜色', 'Colors'), forced:S('強制', '强制', 'Forced'),
  transparency:S('透明度', '透明度', 'Transparency'), options:S('選項', '选项', 'Options'), dither:S('混色', '仿色', 'Dither'), amount:S('總量', '数量', 'Amount'),
  'pal.exact':S('正確', '实际', 'Exact'), 'pal.systemMac':S('系統 (Mac OS)', '系统 (Mac OS)', 'System (Mac OS)'), 'pal.systemWindows':S('系統 (Windows)', '系统 (Windows)', 'System (Windows)'),
  'pal.web':S('網頁', 'Web', 'Web'), 'pal.uniform':S('均勻', '平均', 'Uniform'), 'pal.perceptual':S('局部 (感應式)', '局部 (可感知)', 'Local (Perceptual)'),
  'pal.selective':S('局部 (選擇式)', '局部 (可选择)', 'Local (Selective)'), 'pal.adaptive':S('局部 (最適化)', '局部 (随样性)', 'Local (Adaptive)'),
  'f.none':S('無', '无', 'None'), 'f.blackWhite':S('黑白', '黑白', 'Black and White'), 'f.primaries':S('原色', '三原色', 'Primaries'), 'f.web':S('網頁', 'Web', 'Web'),
  'd.none':S('無', '无', 'None'), 'd.diffusion':S('擴散', '扩散', 'Diffusion'), 'd.pattern':S('圖樣', '图案', 'Pattern'), 'd.noise':S('雜訊', '杂色', 'Noise'),
  bmTitle:S('點陣圖', '位图', 'Bitmap'), method:S('方法', '方法', 'Method'), use:S('使用', '使用', 'Use'),
  'bm.threshold':S('50% 臨界值', '50% 阈值', '50% Threshold'), 'bm.pattern':S('圖樣混色', '图案仿色', 'Pattern Dither'), 'bm.diffusion':S('擴散式混色', '扩散仿色', 'Diffusion Dither'), 'bm.halftone':S('半色調網屏', '半调网屏', 'Halftone Screen'),
  frequency:S('網線數', '频率', 'Frequency'), lpi:S('線/英吋', '线/英寸', 'Lines/Inch'), angle:S('角度', '角度', 'Angle'), shape:S('形狀', '形状', 'Shape'),
  'sh.round':S('圓形', '圆形', 'Round'), 'sh.ellipse':S('橢圓形', '椭圆', 'Ellipse'), 'sh.line':S('線條', '直线', 'Line'), 'sh.square':S('正方形', '方形', 'Square'), 'sh.diamond':S('菱形', '菱形', 'Diamond'), 'sh.cross':S('十字形', '十字', 'Cross'),
  duoTitle:S('雙色調選項', '双色调选项', 'Duotone Options'), type:S('類型', '类型', 'Type'), ink:S('油墨', '油墨', 'Ink'), curve:S('曲線（入:出，0–100）', '曲线（入:出，0–100）', 'Curve (in:out, 0–100)'),
  'dt.monotone':S('單色調', '单色调', 'Monotone'), 'dt.duotone':S('雙色調', '双色调', 'Duotone'), 'dt.tritone':S('三色調', '三色调', 'Tritone'), 'dt.quadtone':S('四色調', '四色调', 'Quadtone'),
  ctTitle:S('色彩表', '颜色表', 'Color Table'), table:S('表格', '颜色表', 'Table'), transparentIdx:S('透明色', '透明色', 'Transparent'),
  'ct.custom':S('自訂', '自定', 'Custom'), 'ct.blackBody':S('黑體', '黑体', 'Black Body'), 'ct.grayscale':S('灰階', '灰度', 'Grayscale'), 'ct.spectrum':S('光譜', '色谱', 'Spectrum'),
  'ct.systemMac':S('系統 (Mac OS)', '系统 (Mac OS)', 'System (Mac OS)'), 'ct.systemWindows':S('系統 (Windows)', '系统 (Windows)', 'System (Windows)'), 'ct.web':S('網頁', 'Web', 'Web'),
  noneOpt:S('無', '无', 'None'), clickSwatch:S('點一格改顏色', '点一格改颜色', 'Click a swatch to edit it'),
  defTitle:S('變數', '变量', 'Variables'), layer:S('圖層', '图层', 'Layer'), name:S('名稱', '名称', 'Name'), varType:S('變數類型', '变量类型', 'Variable Type'),
  'vt.visibility':S('可見度', '可见性', 'Visibility'), 'vt.textReplacement':S('文字取代', '文本替换', 'Text Replacement'), 'vt.pixelReplacement':S('像素取代', '像素替换', 'Pixel Replacement'),
  'pm.fit':S('符合', '适合', 'Fit'), 'pm.fill':S('填滿', '填充', 'Fill'), 'pm.asIs':S('原狀', '保持原样', 'As Is'), 'pm.conform':S('一致', '限制', 'Conform'),
  align:S('對齊', '对齐', 'Alignment'), clip:S('剪裁成框', '剪切到边界框', 'Clip to Bounding Box'), addVar:S('＋ 新增變數', '＋ 新建变量', '+ New Variable'), del:S('刪除', '删除', 'Delete'),
  dsTitle:S('資料組', '数据组', 'Data Sets'), addSet:S('＋ 新增資料組', '＋ 新建数据组', '+ New Data Set'), noVars:S('還沒有定義變數（影像 ▸ 變數 ▸ 定義…）', '还没有定义变量（图像 ▸ 变量 ▸ 定义…）', 'No variables defined yet (Image ▸ Variables ▸ Define…)'),
  pixelsUrl:S('圖片網址', '图片网址', 'Image URL'), applyTitle:S('套用資料組', '应用数据组', 'Apply Data Set'), dataSet:S('資料組', '数据组', 'Data Set'), noSets:S('還沒有資料組', '还没有数据组', 'No data sets yet'),
  trapTitle:S('補漏白', '陷印', 'Trap'), width:S('寬度', '宽度', 'Width'), 'u.pixels':S('像素', '像素', 'pixels'), 'u.points':S('點', '点', 'points'), 'u.mm':S('公釐', '毫米', 'mm'),
  scaleTitle:S('測量比例', '测量比例', 'Measurement Scale'), presets:S('預設集', '预设', 'Presets'), 'ps.default':S('預設', '默认', 'Default'), 'ps.custom':S('自訂', '自定', 'Custom'),
  pixelLength:S('像素長度', '像素长度', 'Pixel Length'), logicalLength:S('邏輯長度', '逻辑长度', 'Logical Length'), logicalUnits:S('邏輯單位', '逻辑单位', 'Logical Units'),
  dpTitle:S('選取資料點', '选择数据点', 'Select Data Points'), 'src.selection':S('選取範圍', '选区', 'Selection'), 'src.ruler':S('尺標工具', '标尺工具', 'Ruler Tool'), 'src.count':S('計數工具', '计数工具', 'Count Tool'), dataPoint:S('資料點', '数据点', 'Data Point'),
  rulerTitle:S('尺標工具', '标尺工具', 'Ruler Tool'), rulerHint:S('在畫布上拖曳拉出測量線；按住 Alt 從起點拖出第二條＝量角器', '在画布上拖曳拉出测量线；按住 Alt 从起点拖出第二条＝量角器', 'Drag on the canvas to measure; Alt-drag from the start point for a protractor'),
  start:S('起點', '起点', 'Start'), end:S('終點', '终点', 'End'), protractor:S('量角器', '量角器', 'Protractor'), apply:S('套用', '应用', 'Apply'), clear:S('清除', '清除', 'Clear'),
  straighten:S('拉直圖層', '拉直图层', 'Straighten Layer'), record:S('記錄測量', '记录测量', 'Record Measurements'),
  countTitle:S('計數工具', '计数工具', 'Count Tool'), countHint:S('在畫布上按一下加一個計數；Alt＋按一下移除', '在画布上点一下加一个计数；Alt＋点一下移除', 'Click the canvas to add a count; Alt-click to remove'),
  group:S('計數群組', '计数组', 'Count Group'), newGroup:S('新增群組', '新建组', 'New Group'), delGroup:S('刪除群組', '删除组', 'Delete Group'), visible:S('顯示', '显示', 'Visible'),
  color:S('顏色', '颜色', 'Color'), markerSize:S('標記大小', '标记大小', 'Marker Size'), labelSize:S('標籤大小', '标签大小', 'Label Size'), total:S('總計', '总计', 'Total'), add:S('加入', '添加', 'Add'),
  logTitle:S('測量記錄', '测量记录', 'Measurement Log'), exportCsv:S('轉存…', '导出…', 'Export…'), delAll:S('全部刪除', '全部删除', 'Delete All'), empty:S('（沒有記錄）', '（没有记录）', '(empty)'),
  markerTitle:S('測量比例標記', '测量比例标记', 'Measurement Scale Marker'), length:S('長度', '长度', 'Length'), font:S('字體', '字体', 'Font'), fontSize:S('大小', '大小', 'Size'),
  displayText:S('顯示文字', '显示文本', 'Display Text'), textPos:S('文字位置', '文本位置', 'Text Position'), top:S('上', '顶', 'Top'), bottom:S('下', '底', 'Bottom'),
  black:S('黑', '黑色', 'Black'), white:S('白', '白色', 'White')
};
(function addStrings(){
  const out = {'zh-Hant':{}, 'zh-Hans':{}, en:{}};
  Object.entries(STR).forEach(([k, v]) => { for (const l of Object.keys(out)) out[l]['psmode.' + k] = v[l]; });
  if (typeof Lang !== 'undefined' && Lang.add) Lang.add(out);
})();
function menuName(id){ let n = null; try { MenuTrees.walk('ps', it => { if (!n && it.id === id && it.n) n = it.n[Lang.cur] || it.n.en; }); } catch (_){} return (n || id).replace(/…$/, ''); }

/* ═══════════ 对话框外框（照 ps-image.js 的 psimg-dlg 样子；样式注入在这里） ═══════════ */
const CSS = `
.psm-bg{position:fixed;inset:0;z-index:9998;background:transparent}
.psimg-dlg.psm{position:fixed;z-index:9999;top:70px;right:280px;min-width:300px;max-width:520px;max-height:calc(100vh - 90px);overflow:auto;background:#2b2f36;color:#e6e8eb;
  border:1px solid #444a54;border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,.5);font:12px sans-serif}
.psimg-dlg.psm.panel{top:90px;right:auto;left:70px}
.psm .hd{padding:8px 12px;font-weight:bold;cursor:move;background:#323741;border-bottom:1px solid #444a54;user-select:none}
.psm .bd{padding:10px 12px}
.psm .ft{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid #444a54}
.psm .ft .sp{flex:1}
.psm button{background:#3a404a;color:#e6e8eb;border:1px solid #555c68;border-radius:3px;padding:3px 10px;cursor:pointer;font:12px sans-serif}
.psm button.pri{background:#2f7fd8;border-color:#2f7fd8;color:#fff}
.psm .row{display:flex;align-items:center;gap:6px;margin:4px 0;flex-wrap:wrap}
.psm .row>.lb{min-width:90px;color:#aab0ba;text-align:right}
.psm input[type=number],.psm input[type=text],.psm select{background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:2px 4px;font:12px sans-serif}
.psm input[type=number]{width:64px}
.psm input[type=color]{width:34px;height:20px;padding:0;border:1px solid #444a54;background:none}
.psm .sec{margin:8px 0 2px;font-weight:bold}
.psm .note{color:#7a8290;font-size:11px;margin:4px 0}
.psm .err{color:#ff8a7a;margin-top:6px}
.psm .grid{display:grid;grid-template-columns:repeat(16,15px);gap:1px;margin:6px 0}
.psm .grid i{display:block;width:15px;height:15px;cursor:pointer;box-sizing:border-box;border:1px solid rgba(0,0,0,.4)}
.psm .grid i.tr{outline:2px solid #fff;outline-offset:-2px}
.psm table{border-collapse:collapse;margin:4px 0}
.psm td,.psm th{border:1px solid #444a54;padding:2px 5px;text-align:left;font-weight:normal;white-space:nowrap}
.psm .ro{font-family:monospace;color:#cfd3d9}
`;
function injectCSS(){ if (document.getElementById('psModeCss')) return; const s = document.createElement('style'); s.id = 'psModeCss'; s.textContent = CSS; document.head.appendChild(s); }
function el(tag, props, kids){
  const e = document.createElement(tag);
  if (props) Object.entries(props).forEach(([k, v]) => { if (k === 'style') e.style.cssText = v; else if (k === 'data') Object.assign(e.dataset, v); else if (k in e) e[k] = v; else e.setAttribute(k, v); });
  (kids || []).forEach(c => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
}
function toast(msg){
  const d = el('div', {style:'position:fixed;left:50%;top:60px;transform:translateX(-50%);z-index:10000;background:#5a2a2a;color:#fff;padding:6px 14px;border-radius:4px;font:12px sans-serif', data:{psmodeToast:'1'}}, [msg]);
  document.body.appendChild(d); setTimeout(() => d.remove(), 3500);
}
const D2 = {
  cur:null,
  open(o){
    this.close(); injectCSS();
    const modal = !o.panel, bg = modal ? el('div', {className:'psm-bg', id:'psModeDlgBg'}) : null;
    const box = el('div', {className:'psimg-dlg psm' + (modal ? '' : ' panel'), id:'psModeDlg', data:{cmd:'ps.' + o.id}});
    const hd = el('div', {className:'hd'}, [o.title || menuName(o.id)]), bd = el('div', {className:'bd'}), ft = el('div', {className:'ft'});
    const cur = this.cur = {o, v:o.v || {}, state:o.state || {}, box, bg, bd, err:null};
    ft.appendChild(el('span', {className:'sp'}));
    if (modal){
      ft.appendChild(el('button', {type:'button', data:{act:'cancel'}, onclick:() => this.cancel()}, [T('cancel')]));
      ft.appendChild(el('button', {type:'button', className:'pri', data:{act:'ok'}, onclick:() => this.ok()}, [T('ok')]));
    } else ft.appendChild(el('button', {type:'button', data:{act:'close'}, onclick:() => this.cancel()}, [T('close')]));
    box.appendChild(hd); box.appendChild(bd); box.appendChild(ft);
    box.addEventListener('keydown', e => {
      if (e.key === 'Escape'){ e.preventDefault(); this.cancel(); }
      else if (modal && e.key === 'Enter' && !/textarea|button/i.test(e.target.tagName)){ e.preventDefault(); if (e.target.blur) e.target.blur(); this.ok(); }
      e.stopPropagation();
    });
    hd.addEventListener('pointerdown', e => {
      const r = box.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      const mv = ev => { box.style.left = (r.left + ev.clientX - sx) + 'px'; box.style.top = (r.top + ev.clientY - sy) + 'px'; box.style.right = 'auto'; };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    if (bg) document.body.appendChild(bg);
    document.body.appendChild(box);
    this.render();
    const first = bd.querySelector('input,select'); if (first && first.focus && modal) first.focus();
    return box;
  },
  render(){
    const c = this.cur; if (!c) return;
    const sy = c.bd.scrollTop; c.bd.innerHTML = '';
    c.o.build(makeUI(c.bd), c.v, c.state);
    if (c.err) c.bd.appendChild(el('div', {className:'err'}, [c.err]));
    c.bd.scrollTop = sy;
  },
  params(){ const c = this.cur; return c.o.params ? c.o.params(c.v, c.state) : JSON.parse(JSON.stringify(c.v)); },
  ok(){
    const c = this.cur; if (!c) return null;
    let prm; try { prm = this.params(); } catch (e){ c.err = e.message; this.render(); return null; }
    this.close();
    let r;
    try { r = CMD.run(c.o.cmd || ('ps.' + c.o.id), prm); } catch (e){ console.error(e); r = {ok:false, error:String(e && e.message || e)}; }
    const done = x => { if (x && x.ok === false) toast(T('error') + (x.error || '')); redraw(); return x; };
    return (r && typeof r.then === 'function') ? r.then(done) : done(r);
  },
  cancel(){ if (!this.cur) return; this.close(); redraw(); },
  close(){ const c = this.cur; if (!c) return; if (c.o.onClose) try { c.o.onClose(); } catch (_){} c.box.remove(); if (c.bg) c.bg.remove(); this.cur = null; }
};
/* 对话框（非面板）开着时，外面的键一律不给：Esc＝取消、Enter＝确定 */
window.addEventListener('keydown', e => {
  const c = D2.cur; if (!c || c.o.panel || c.box.contains(e.target)) return;
  if (e.key === 'Escape') D2.cancel(); else if (e.key === 'Enter') D2.ok(); else return;
  e.preventDefault(); e.stopPropagation();
}, true);
function makeUI(root){
  const add = n => { root.appendChild(n); return n; };
  const row = (label, nodes) => add(el('div', {className:'row'}, [el('span', {className:'lb'}, [label || ''])].concat(nodes)));
  const numIn = (k, val, min, max, step, on) => {
    const n = el('input', {type:'number', min, max, step:step || 1, value:String(val), data:{k}});
    const f = () => { const x = Number(n.value); if (n.value !== '' && isFinite(x)) on(clamp(x, min, max)); };
    n.addEventListener('input', f); n.addEventListener('change', () => { f(); });
    return n;
  };
  return {
    root, add, row,
    sec(t){ return add(el('div', {className:'sec'}, [t])); },
    note(t){ return add(el('div', {className:'note'}, [t])); },
    num(k, label, get, set, min, max, step, after){ return row(label, [numIn(k, get(), min, max, step, set)].concat(after || [])); },
    numEl: numIn,
    select(k, label, options, get, set, rebuild){
      const s = el('select', {data:{k}});
      options.forEach(([v, t]) => s.appendChild(el('option', {value:String(v), selected:String(get()) === String(v)}, [t])));
      s.onchange = () => { const o = options.find(x => String(x[0]) === s.value); set(o ? o[0] : s.value); if (rebuild) D2.render(); };
      return label === null ? s : row(label, [s]);
    },
    check(k, label, get, set, rebuild){ const c = el('input', {type:'checkbox', checked:!!get(), data:{k}}); c.onchange = () => { set(c.checked); if (rebuild) D2.render(); }; return row('', [el('label', {}, [c, ' ' + label])]); },
    checkEl(k, get, set){ const c = el('input', {type:'checkbox', checked:!!get(), data:{k}}); c.onchange = () => set(c.checked); return c; },
    text(k, label, get, set, width){ const x = el('input', {type:'text', value:get(), style:'width:' + (width || 180) + 'px', data:{k}}); x.addEventListener('input', () => set(x.value)); return label === null ? x : row(label, [x]); },
    color(k, label, get, set){ const c = el('input', {type:'color', value:get(), data:{k}}); c.addEventListener('input', () => set(c.value)); return label === null ? c : row(label, [c]); },
    radio(k, label, options, get, set, rebuild){
      return row(label, options.map(([v, t]) => { const r = el('input', {type:'radio', name:'psm_' + k, value:String(v), checked:String(get()) === String(v), data:{k}});
        r.onchange = () => { if (r.checked){ set(v); if (rebuild) D2.render(); } }; return el('label', {style:'margin-right:8px'}, [r, ' ' + t]); }));
    },
    button(t, fn, k){ const b = el('button', {type:'button', data:{k:k || ''}}, [t]); b.onclick = () => fn(); return b; }
  };
}
const opts = (keys, pre) => keys.map(k => [k, T(pre + k)]);

/* ── 各对话框（栏位照 PS 的对话框；参数名照原码命令） ── */
DLG['image.mode.indexedColor'] = init => D2.open({id:'image.mode.indexedColor', title:T('idxTitle'),
  v:Object.assign({palette:'selective', colors:256, forced:'blackWhite', transparency:true, dither:'diffusion', amount:75}, init),
  build(ui, v){
    ui.select('palette', T('palette'), opts(PALETTES, 'pal.'), () => v.palette, x => { v.palette = x; });
    ui.num('colors', T('colors'), () => v.colors, x => { v.colors = x; }, 2, 256, 1);
    ui.select('forced', T('forced'), opts(['none', 'blackWhite', 'primaries', 'web'], 'f.'), () => v.forced, x => { v.forced = x; });
    ui.check('transparency', T('transparency'), () => v.transparency, x => { v.transparency = x; });
    ui.sec(T('options'));
    ui.select('dither', T('dither'), opts(['none', 'diffusion', 'pattern', 'noise'], 'd.'), () => v.dither, x => { v.dither = x; });
    ui.num('amount', T('amount'), () => v.amount, x => { v.amount = x; }, 0, 100, 1, ['%']);
  }});
DLG['image.mode.bitmap'] = init => D2.open({id:'image.mode.bitmap', title:T('bmTitle'),
  v:Object.assign({method:'diffusion', frequency:53, angle:45, shape:'round'}, init),
  build(ui, v){
    ui.sec(T('method'));
    ui.select('method', T('use'), opts(['threshold', 'pattern', 'diffusion', 'halftone'], 'bm.'), () => v.method, x => { v.method = x; }, true);
    if (v.method === 'halftone'){
      ui.num('frequency', T('frequency'), () => v.frequency, x => { v.frequency = x; }, 1, 999, 0.1, [T('lpi')]);
      ui.num('angle', T('angle'), () => v.angle, x => { v.angle = x; }, -180, 180, 1, ['°']);
      ui.select('shape', T('shape'), opts(['round', 'ellipse', 'line', 'square', 'diamond', 'cross'], 'sh.'), () => v.shape, x => { v.shape = x; });
    }
  },
  params:v => v.method === 'halftone' ? {method:'halftone', frequency:v.frequency, angle:v.angle, shape:v.shape} : {method:v.method}});
DLG['image.mode.duotone'] = init => {
  const d = Doc.duotone, inks = (d && d.inks.length ? d.inks : defaultInks(4)).map(i => ({name:i.name, color:hexOf(i.color), curve:i.curve.map(q => Math.round(q[0] * 100) + ':' + Math.round(q[1] * 100)).join(', ')}));
  while (inks.length < 4){ const di = defaultInks(4)[inks.length]; inks.push({name:di.name, color:hexOf(di.color), curve:'0:0, 100:100'}); }
  D2.open({id:'image.mode.duotone', title:T('duoTitle'), v:Object.assign({type:(d && d.type) || 'duotone', inks}, init),
    build(ui, v){
      ui.select('type', T('type'), opts(['monotone', 'duotone', 'tritone', 'quadtone'], 'dt.'), () => v.type, x => { v.type = x; }, true);
      for (let i = 0; i < DUO_TYPES[v.type]; i++){
        const ink = v.inks[i];
        ui.row(T('ink') + ' ' + (i + 1), [ui.color('ink' + i + '.color', null, () => ink.color, x => { ink.color = x; }), ui.text('ink' + i + '.name', null, () => ink.name, x => { ink.name = x; }, 120)]);
        ui.row(T('curve'), [ui.text('ink' + i + '.curve', null, () => ink.curve, x => { ink.curve = x; }, 160)]);
      }
    },
    params:v => ({type:v.type, inks:v.inks.slice(0, DUO_TYPES[v.type]).map(i => ({name:i.name, color:i.color,
      curve:String(i.curve).split(/[,;]/).map(s => s.split(':').map(Number)).filter(q => q.length === 2 && q.every(isFinite))}))})});
};
DLG['image.mode.colorTable'] = init => {
  const t = Doc.colorTable;
  if (docMode() !== 'indexed' || !t){ toast(T('error') + 'Color Table needs an Indexed Color image'); return; }
  D2.open({id:'image.mode.colorTable', title:T('ctTitle'), v:Object.assign({table:'custom', entries:{}, transparent:t.transparent === undefined ? null : t.transparent}, init),
    state:{base:t.colors.map(c => c.slice())},
    build(ui, v, st){
      ui.select('table', T('table'), opts(['custom', 'blackBody', 'grayscale', 'spectrum', 'systemMac', 'systemWindows', 'web'], 'ct.'), () => v.table, x => { v.table = x; v.entries = {}; }, true);
      const shown = (v.table === 'custom' ? st.base : presetTable(v.table)).map(c => c.slice());
      Object.entries(v.entries).forEach(([i, h]) => { const c = parseColor8(h); if (c && shown[i]) shown[i] = c; });
      const grid = ui.add(el('div', {className:'grid', data:{k:'swatches'}}));
      const picker = el('input', {type:'color', style:'position:absolute;opacity:0;width:0;height:0', data:{k:'swatchColor'}});
      shown.forEach((c, i) => { const s = el('i', {title:i + ' ' + hex8(c), data:{i:String(i)}}); s.style.background = hex8(c); if (v.transparent === i) s.classList.add('tr');
        s.onclick = () => { picker.value = hex8(c); picker.dataset.i = String(i); picker.click(); }; grid.appendChild(s); });
      picker.addEventListener('input', () => { v.entries[picker.dataset.i] = picker.value; D2.render(); });
      ui.add(picker);
      ui.note(T('clickSwatch'));
      ui.select('transparent', T('transparentIdx'), [['', T('noneOpt')]].concat(shown.map((c, i) => [String(i), i + ' ' + hex8(c)])), () => v.transparent === null ? '' : String(v.transparent),
        x => { v.transparent = x === '' ? null : Number(x); }, true);
    },
    params:v => { const p = {table:v.table, transparent:v.transparent}; if (Object.keys(v.entries).length) p.entries = v.entries; return p; }});
};
const layerOpts = () => Doc.layers.slice().reverse().map(L => [L.id, L.name]);
DLG['image.variables.define'] = init => {
  const cur = vars().defs.map(d => Object.assign({name:d.name, layer:d.layer}, d.kind));
  D2.open({id:'image.variables.define', title:T('defTitle'), v:Object.assign({defs:cur}, init),
    build(ui, v){
      v.defs.forEach((d, i) => {
        const nodes = [ui.select('def' + i + '.layer', null, layerOpts(), () => d.layer, x => { d.layer = x; }),
          ui.select('def' + i + '.type', null, opts(['visibility', 'textReplacement', 'pixelReplacement'], 'vt.'), () => d.type, x => { d.type = x; }, true),
          ui.text('def' + i + '.name', null, () => d.name, x => { d.name = x; }, 110),
          ui.button(T('del'), () => { v.defs.splice(i, 1); D2.render(); }, 'def' + i + '.del')];
        ui.row(T('name') + ' ' + (i + 1), nodes);
        if (d.type === 'pixelReplacement'){
          ui.row('', [ui.select('def' + i + '.method', null, opts(['fit', 'fill', 'asIs', 'conform'], 'pm.'), () => d.method || 'fit', x => { d.method = x; }),
            ui.select('def' + i + '.align', null, ALIGNS.map(a => [a, a]), () => d.align || 'center', x => { d.align = x; }),
            el('label', {}, [ui.checkEl('def' + i + '.clip', () => d.clip, x => { d.clip = x; }), ' ' + T('clip')])]);
        }
      });
      ui.add(ui.button(T('addVar'), () => {
        const L = Doc.active() || Doc.layers[Doc.layers.length - 1]; if (!L) return;
        let n = 1; while (v.defs.some(d => d.name === 'Variable' + n)) n++;
        v.defs.push({name:'Variable' + n, layer:L.id, type:L.kind === 'text' ? 'textReplacement' : L.kind === 'raster' ? 'pixelReplacement' : 'visibility', method:'fit', align:'center', clip:false}); D2.render();
      }, 'addVar'));
    },
    params:v => ({defs:v.defs.map(d => { const o = {name:d.name, layer:d.layer, type:d.type}; if (d.type === 'pixelReplacement'){ o.method = d.method || 'fit'; o.align = d.align || 'center'; o.clip = !!d.clip; } return o; })})});
};
DLG['image.variables.dataSets'] = init => {
  const V = vars(), sets = JSON.parse(JSON.stringify(V.dataSets));
  D2.open({id:'image.variables.dataSets', title:T('dsTitle'), v:Object.assign({dataSets:sets}, init),
    build(ui, v){
      if (!V.defs.length){ ui.note(T('noVars')); return; }
      v.dataSets.forEach((s, i) => {
        ui.row(T('dataSet') + ' ' + (i + 1), [ui.text('set' + i + '.name', null, () => s.name, x => { s.name = x; }, 140), ui.button(T('del'), () => { v.dataSets.splice(i, 1); D2.render(); }, 'set' + i + '.del')]);
        V.defs.forEach(d => {
          let val = s.values.find(x => x.variable === d.name);
          const kind = d.kind.type === 'visibility' ? 'visibility' : d.kind.type === 'textReplacement' ? 'text' : 'pixels';
          const ensure = () => { if (!val){ val = {variable:d.name, kind, value:kind === 'visibility' ? true : ''}; s.values.push(val); } return val; };
          const k = 'set' + i + '.' + d.name;
          if (kind === 'visibility') ui.row(d.name, [ui.checkEl(k, () => val ? val.value : true, x => { ensure().value = x; })]);
          else ui.row(d.name, [ui.text(k, null, () => val ? val.value : '', x => { ensure().value = x; }, 200)]);
        });
      });
      ui.add(ui.button(T('addSet'), () => { let n = 1; while (v.dataSets.some(s => s.name === 'Data Set ' + n)) n++;
        v.dataSets.push({name:'Data Set ' + n, values:V.defs.map(d => ({variable:d.name, kind:d.kind.type === 'visibility' ? 'visibility' : d.kind.type === 'textReplacement' ? 'text' : 'pixels',
          value:d.kind.type === 'visibility' ? !!(Doc.byId(d.layer) || {}).visible : d.kind.type === 'textReplacement' ? ((Doc.byId(d.layer) || {}).data || {}).text || '' : ''}))}); D2.render(); }, 'addSet'));
    },
    params:v => ({dataSets:v.dataSets.map(s => ({name:s.name, values:s.values.filter(x => x.kind === 'visibility' || x.value !== '')}))})});
};
DLG['image.applyDataSet'] = init => {
  const V = vars();
  D2.open({id:'image.applyDataSet', title:T('applyTitle'), v:Object.assign({name:V.dataSets.length ? V.dataSets[V.active || 0] ? V.dataSets[V.active || 0].name : V.dataSets[0].name : ''}, init),
    build(ui, v){ if (!V.dataSets.length){ ui.note(T('noSets')); return; } ui.select('name', T('dataSet'), V.dataSets.map(s => [s.name, s.name]), () => v.name, x => { v.name = x; }); },
    params:v => ({name:v.name})});
};
DLG['image.trap'] = init => D2.open({id:'image.trap', title:T('trapTitle'), v:Object.assign({width:1, unit:'pixels'}, init),
  build(ui, v){ ui.row(T('width'), [ui.numEl('width', v.width, 0, 1000, 1, x => { v.width = x; }), ui.select('unit', null, opts(['pixels', 'points', 'mm'], 'u.'), () => v.unit, x => { v.unit = x; })]); },
  params:v => { const dpi = Doc.dpi || 72; return {width:v.unit === 'points' ? v.width * dpi / 72 : v.unit === 'mm' ? v.width * dpi / 25.4 : v.width}; }});
DLG['image.analysis.setMeasurementScale'] = init => { const sc = scaleOf();
  D2.open({id:'image.analysis.setMeasurementScale', title:T('scaleTitle'), v:Object.assign({preset:isDefaultScale(sc) ? 'default' : 'custom', pixelLength:sc.pixelLength, logicalLength:sc.logicalLength, units:sc.units}, init),
    build(ui, v){
      ui.select('preset', T('presets'), opts(['default', 'custom'], 'ps.'), () => v.preset, x => { v.preset = x; if (x === 'default') Object.assign(v, {pixelLength:1, logicalLength:1, units:'pixels'}); }, true);
      ui.num('pixelLength', T('pixelLength'), () => v.pixelLength, x => { v.pixelLength = x; v.preset = 'custom'; }, 0.0001, 1e9, 0.0001);
      ui.num('logicalLength', T('logicalLength'), () => v.logicalLength, x => { v.logicalLength = x; v.preset = 'custom'; }, 0.0001, 1e9, 0.0001);
      ui.text('units', T('logicalUnits'), () => v.units, x => { v.units = x; v.preset = 'custom'; }, 100);
    },
    params:v => v.preset === 'default' ? {preset:'default'} : {preset:'custom', pixelLength:v.pixelLength, logicalLength:v.logicalLength, units:v.units}}); };
DLG['image.analysis.selectDataPoints'] = init => D2.open({id:'image.analysis.selectDataPoints', title:T('dpTitle'), v:JSON.parse(JSON.stringify(Object.assign({}, AN.dataPoints, init))),
  build(ui, v){
    const tb = el('table', {}, [el('tr', {}, [el('th', {}, [T('dataPoint')])].concat(['selection', 'ruler', 'count'].map(s => el('th', {}, [T('src.' + s)]))))]);
    COLUMNS.forEach(([k, name]) => {
      const tr = el('tr', {}, [el('td', {}, [name])]);
      ['selection', 'ruler', 'count'].forEach(s => {
        const td = el('td');
        if (available(s).includes(k)) td.appendChild(ui.checkEl(s + '.' + k, () => v[s].includes(k), x => { v[s] = v[s].filter(y => y !== k); if (x) v[s].push(k); }));
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    ui.add(tb);
  },
  params:v => ({selection:v.selection, ruler:v.ruler, count:v.count})});
DLG['image.analysis.placeScaleMarker'] = init => D2.open({id:'image.analysis.placeScaleMarker', title:T('markerTitle'),
  v:Object.assign({length:+niceLength().toPrecision(6), font:'', fontSize:12, displayText:true, textPosition:'bottom', color:'black'}, init),
  build(ui, v){
    ui.num('length', T('length'), () => v.length, x => { v.length = x; }, 0.0001, 1e9, 0.0001, [scaleOf().units]);
    ui.text('font', T('font'), () => v.font, x => { v.font = x; }, 140);
    ui.num('fontSize', T('fontSize'), () => v.fontSize, x => { v.fontSize = x; }, 1, 1000, 1, ['pt']);
    ui.check('displayText', T('displayText'), () => v.displayText, x => { v.displayText = x; });
    ui.radio('textPosition', T('textPos'), [['top', T('top')], ['bottom', T('bottom')]], () => v.textPosition, x => { v.textPosition = x; });
    ui.radio('color', T('color'), [['black', T('black')], ['white', T('white')]], () => v.color, x => { v.color = x; });
  },
  params:v => { const p = {length:v.length, fontSize:v.fontSize, displayText:v.displayText, textPosition:v.textPosition, color:v.color}; if (v.font) p.font = v.font; return p; }});

/* ── 面板（非强制）：标尺／计数／测量记录；开着时在画布上拖／点 ── */
const fmt = v => v === null || v === undefined ? '—' : (Math.round(v * 100) / 100).toString();
DLG['image.analysis.rulerTool'] = () => D2.open({id:'image.analysis.rulerTool', title:T('rulerTitle'), panel:true, canvasTool:'ruler', v:{},
  build(ui){
    const r = meas().ruler, info = r ? rulerInfo(r, scaleOf()) : null;
    ui.add(el('div', {className:'ro', data:{k:'readout'}}, [info ? `X: ${fmt(info.x)}  Y: ${fmt(info.y)}  W: ${fmt(info.w)}  H: ${fmt(info.h)}  A: ${fmt(info.angle)}°  L1: ${fmt(info.l1)}  L2: ${fmt(info.l2)}  (${fmt(info.length)} ${info.units})` : '—']));
    const f = {sx:r ? r.start[0] : 0, sy:r ? r.start[1] : 0, ex:r ? r.end[0] : 0, ey:r ? r.end[1] : 0};
    ui.row(T('start'), [ui.numEl('sx', f.sx, -1e6, 1e6, 0.1, x => { f.sx = x; }), ui.numEl('sy', f.sy, -1e6, 1e6, 0.1, x => { f.sy = x; })]);
    ui.row(T('end'), [ui.numEl('ex', f.ex, -1e6, 1e6, 0.1, x => { f.ex = x; }), ui.numEl('ey', f.ey, -1e6, 1e6, 0.1, x => { f.ey = x; }),
      ui.button(T('apply'), () => { CMD.run('ps.image.analysis.rulerTool', {start:[f.sx, f.sy], end:[f.ex, f.ey], protractor:r ? r.protractor : null}); D2.render(); redraw(); }, 'applyRuler')]);
    ui.add(el('div', {className:'row'}, [ui.button(T('straighten'), () => { const x = CMD.run('ps.image.analysis.straightenLayer', {}); if (x && x.ok === false) toast(T('error') + x.error); D2.render(); redraw(); }, 'straighten'),
      ui.button(T('clear'), () => { CMD.run('ps.image.analysis.rulerTool', {clear:true}); D2.render(); redraw(); }, 'clearRuler'),
      ui.button(T('record'), () => { const x = CMD.run('ps.image.analysis.recordMeasurements', {source:'ruler', showLog:true}); if (x && x.ok === false) toast(T('error') + x.error); }, 'recordRuler')]));
    ui.note(T('rulerHint'));
  }});
DLG['image.analysis.countTool'] = () => D2.open({id:'image.analysis.countTool', title:T('countTitle'), panel:true, canvasTool:'count', v:{},
  build(ui){
    const gs = groups(), gi = activeGroup(), g = gs[gi];
    ui.row(T('group'), [gs.length ? ui.select('group', null, gs.map((x, i) => [i, `${x.name} (${x.points.length})`]), () => gi, x => { CMD.run('ps.count.setGroup', {group:x, active:true}); D2.render(); redraw(); }) : el('span', {}, ['—']),
      ui.button(T('newGroup'), () => { CMD.run('ps.count.newGroup', {}); D2.render(); redraw(); }, 'newGroup'),
      ui.button(T('delGroup'), () => { if (gs.length){ CMD.run('ps.count.deleteGroup', {}); D2.render(); redraw(); } }, 'deleteGroup')]);
    if (g){
      ui.row(T('color'), [ui.color('groupColor', null, () => hexOf(g.color), x => { CMD.run('ps.count.setGroup', {color:x}); redraw(); }),
        el('label', {}, [ui.checkEl('groupVisible', () => g.visible, x => { CMD.run('ps.count.setGroup', {visible:x}); redraw(); }), ' ' + T('visible')])]);
      ui.row(T('markerSize'), [ui.numEl('markerSize', g.markerSize, 1, 10, 1, x => { CMD.run('ps.count.setGroup', {markerSize:Math.round(x)}); redraw(); }),
        el('span', {}, [T('labelSize')]), ui.numEl('labelSize', g.labelSize, 8, 72, 1, x => { CMD.run('ps.count.setGroup', {labelSize:Math.round(x)}); redraw(); })]);
    }
    const f = {x:0, y:0};
    ui.row(T('add'), [ui.numEl('cx', 0, -1e6, 1e6, 1, x => { f.x = x; }), ui.numEl('cy', 0, -1e6, 1e6, 1, x => { f.y = x; }), ui.button(T('add'), () => { CMD.run('ps.count.add', {x:f.x, y:f.y}); D2.render(); redraw(); }, 'addCount')]);
    ui.add(el('div', {className:'row'}, [el('span', {className:'ro', data:{k:'total'}}, [T('total') + ': ' + countTotal()]),
      ui.button(T('clear'), () => { if (gs.length){ CMD.run('ps.count.clear', {}); D2.render(); redraw(); } }, 'clearCount'),
      ui.button(T('record'), () => { const x = CMD.run('ps.image.analysis.recordMeasurements', {source:'count', showLog:true}); if (x && x.ok === false) toast(T('error') + x.error); }, 'recordCount')]));
    ui.note(T('countHint'));
  }});
function openLogPanel(){
  D2.open({id:'measurementLog', title:T('logTitle'), panel:true, v:{},
    build(ui){
      const cols = logColumns(AN.log);
      if (!AN.log.length) ui.note(T('empty'));
      else {
        const tb = el('table', {data:{k:'log'}}, [el('tr', {}, cols.filter(k => k !== 'histogram').map(k => el('th', {}, [(COLUMNS.find(c => c[0] === k) || [k, k])[1]])))]);
        AN.log.forEach(r => tb.appendChild(el('tr', {}, cols.filter(k => k !== 'histogram').map(k => el('td', {}, [k in r.values ? String(r.values[k]) : ''])))));
        ui.add(tb);
      }
      ui.add(el('div', {className:'row'}, [ui.button(T('exportCsv'), () => CMD.run('ps.measurementLog.export', {download:true}), 'exportLog'),
        ui.button(T('delAll'), () => { if (AN.log.length){ CMD.run('ps.measurementLog.delete', {all:true}); D2.render(); } }, 'deleteLog')]));
    }});
}
DLG['measurementLog'] = openLogPanel;

/* 画布上的标尺／计数：面板开着时接管画布的指标（capture，工具收不到）；
   手上就是标尺／计数工具时让开，交给工具自己的手势（tools/ruler.js、tools/count.js），免得两边各做一次 */
function docPt(e){
  const c = window.UI && UI.canvas; if (!c) return null;
  const r = c.getBoundingClientRect(); if (!r.width || !r.height) return null;
  return [(e.clientX - r.left) / r.width * Doc.width, (e.clientY - r.top) / r.height * Doc.height];
}
const round1 = v => Math.round(v * 10) / 10;
window.addEventListener('pointerdown', e => {
  if (window.ToolState && (ToolState.cur === 'ruler' || ToolState.cur === 'count')) return;
  const c = D2.cur; if (!c || !c.o.canvasTool || e.button !== 0) return;
  const wrapEl = document.getElementById('canvasWrap') || (window.UI && UI.canvas && UI.canvas.parentElement);
  if (!wrapEl || !wrapEl.contains(e.target) || c.box.contains(e.target)) return;
  const p0 = docPt(e); if (!p0) return;
  e.preventDefault(); e.stopPropagation();
  if (c.o.canvasTool === 'count'){
    const r = e.altKey ? CMD.run('ps.count.remove', {x:p0[0], y:p0[1], radius:6 / ((window.UI && UI.zoom) || 1)}) : CMD.run('ps.count.add', {x:Math.round(p0[0]), y:Math.round(p0[1])});
    if (r && r.ok === false && !e.altKey) toast(T('error') + r.error);
    D2.render(); redraw(); return;
  }
  const old = meas().ruler, prot = e.altKey && old;
  const start = prot ? old.start : [round1(p0[0]), round1(p0[1])];
  const set = q => { const pq = [round1(q[0]), round1(q[1])]; CMD.run('ps.image.analysis.rulerTool', prot ? {start:old.start, end:old.end, protractor:pq} : {start, end:pq}); D2.render(); redraw(); };
  const mv = ev => { const q = docPt(ev); if (q) set(q); };
  const up = ev => { window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true); mv(ev); };
  window.addEventListener('pointermove', mv, true); window.addEventListener('pointerup', up, true);
}, true);
/* 叠画（UI.overlays）：计数标记（组色圆点＋编号）一直显示；标尺线在标尺面板开着时显示 */
function drawOverlay(ctx, s){
  const m = Doc.measurement; if (!m) return;
  if (m.ruler && D2.cur && D2.cur.o.canvasTool === 'ruler'){
    const r = m.ruler, line = (a, b) => { ctx.beginPath(); ctx.moveTo(a[0] * s, a[1] * s); ctx.lineTo(b[0] * s, b[1] * s); ctx.stroke(); };
    ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = '#000'; ctx.setLineDash([]); line(r.start, r.end); if (r.protractor) line(r.start, r.protractor);
    ctx.strokeStyle = '#fff'; ctx.setLineDash([4, 4]); line(r.start, r.end); if (r.protractor) line(r.start, r.protractor);
    ctx.setLineDash([]); [r.start, r.end].concat(r.protractor ? [r.protractor] : []).forEach(q => { ctx.strokeStyle = '#000'; ctx.strokeRect(q[0] * s - 3, q[1] * s - 3, 6, 6); });
    ctx.restore();
  }
  (m.countGroups || []).forEach(g => {
    if (!g.visible) return;
    ctx.save(); ctx.fillStyle = hexOf(g.color); ctx.font = `${g.labelSize + 2}px sans-serif`; ctx.textBaseline = 'bottom';
    g.points.forEach((q, i) => { const x = q[0] * s, y = q[1] * s, rr = 1.5 + g.markerSize; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); ctx.fillText(String(i + 1), x + rr + 1, y - 1); });
    ctx.restore();
  });
}
function hookOverlay(){ if (window.UI && Array.isArray(UI.overlays) && !UI.__psModeOverlay){ UI.overlays.push(drawOverlay); UI.__psModeOverlay = true; } }
hookOverlay(); window.addEventListener('load', hookOverlay);

/* ═══════════ 给测试与 agent ═══════════ */
window.PsImageMode = {
  version:'1',
  mode:docMode, depth:docDepth,
  cms:{name:() => CMS.name(), params:() => Object.assign({}, CMS.params()), show:(c, o) => CMS.show(c, o), swop:() => useSwop(), rgbToCmyk:(r, g, b, intent, bpc) => CMS.rgbToCmyk(r, g, b, intent, bpc), cmykToRgb:c => CMS.cmykToRgb(c), blackY:i => CMS.blackY(i || 'relative'),
       modelLab:c => CMS.model().lab(c), sgray:sgrayOf8, srgbToLab, labToSrgb},
  quantize:{buildPalette:(px, kind, n, forced) => buildPalette(px, kind, n, forced, 'buildPalette'), quantize:quantizePx, toBitmap, presetTable, macPalette, windowsPalette, webPalette},
  duotone:{render:duoRender, lut:duoLut, defaultInks},
  analysis:{measureFeatures, rulerInfo, inscribed, log:() => AN.log, dataPoints:() => AN.dataPoints},
  DIALOGS:DLG,
  dlg:{
    get cur(){ return D2.cur; }, isOpen:() => !!D2.cur,
    values:() => D2.cur ? JSON.parse(JSON.stringify(D2.cur.v)) : null, params:() => D2.cur ? D2.params() : null,
    set(k, val){ if (!D2.cur) return false; D2.cur.v[k] = val; D2.render(); return true; },
    ok:() => D2.ok(), cancel:() => D2.cancel(), render:() => D2.render()
  }
};
})();
