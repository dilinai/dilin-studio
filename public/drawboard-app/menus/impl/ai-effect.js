/* 堤麟画板 · Illustrator ▸ 效果（Effect）菜单实作 —— 照 ArtCraft VectorCraft 原码逐条翻成 JS
   原码（vectorcraft/crates/）：
     effects/src/lib.rs            效果目录 effect_catalog（id／菜单／参数说明／对话框预设）、is_raster／is_geometry、apply_geometry／apply_one（几何效果按堆叠顺序求值，
                                   第一个效果用物件外框、之后每个用上一步结果的外框）
     effects/src/distort.rs        扭曲和变换：自由扭曲（双线性）、收缩和膨胀、粗糙化、变换（含副本）、扭拧、扭转、波纹效果
     effects/src/stylize.rs        转换为形状（矩形／圆角矩形／椭圆）、圆角、涂抹（简化版：一条斜线来回涂、描边轮廓化）
     effects/src/warp.rs ＋ doc/src/live.rs:278-442   变形 15 式（warp_point 在 [-1,1]² 正规座标上的映射）与 map_nonlinear（切小段、映射控制点）
     effects/src/util.rs           num／flag 参数解析、splitmix64 杂讯（seed 决定，同 seed 同结果）、catmull_rom、normal_at
     effects/src/raster.rs ＋ render/src/fx.rs:171-581   点阵效果：投影／外发光画在物件底下（剪影模糊 σ＝blur/2、染色、乘不透明度、混合模式）、
                                   羽化（裁在轮廓里再模糊）／高斯模糊（内容本身）、内发光（边缘＝外面那一圈往里渗／中心＝形状本身，裁在轮廓里）
     effects/src/group.rs ＋ pathops/src/pathfinder.rs  效果 ▸ 路径查找器：编组的「活」路径查找器十种运算（形状模式下子编组当一个形状）
     effects/src/marks.rs ＋ doc/src/marks.rs  裁剪标记：活的，跟着物件外框走（罗马式／日式）
     engine/src/cmd/effectcmd.rs   effect.apply／list／remove／setParams／duplicate／move／expandAppearance
     engine/src/cmd/rasterfx.rs    document.rasterEffectsSettings（栏位、范围检查、finish_pixels 色彩模型与背景）
     ui-egui/src/menus.rs:793-934、2510-2576  效果菜单（有参数＝开对话框、没参数＝直接套）、effect.last／applyLast（last_effect 只由对话框按确定记下）
     ui-egui/src/dialogs/effect.rs、raster_effects.rs  效果对话框（预览、已套用过同一效果先问「编辑／新增」）、文档栅格效果设置对话框
   资料模型：矢量形状上加 s.effects = [{id, params, visible}]（＝原码 appearance.effects），存在 L.data 里，所以历史快照、工程档都自动带着；
     渲染时才求值（非破坏性）：本档把 ObjRender.handles／draw／toSVG 包一层（engine.js drawShape 与 Project.toSVG 本来就先问 ObjRender），
     有效果的形状 ⇒ 先算几何效果、再画点阵效果。几何结果按「形状 JSON」快取。
   路径运算（偏移／轮廓化描边／路径查找器）用 ai-object.js 的 AIObj.arrangement／strokePieces／flatten（拉平成折线的平面排列，是替代实作）。
   Photoshop 效果（艺术效果／画笔描边／素描／纹理…）VectorCraft 原码没有；这里的做法是栅格化副本再套 PS 滤镜的 ps.filter.*：
     选中的形状（连同它们的活效果）画成一张新像素层放在矢量层正上方、跑对应的 ps.filter.* 命令、原形状藏起来（对象 ▸ 显示全部 可叫回）。
     ps.filter.* 由 menus/impl/ps-filter.js 登记；本档等页面载完才按那边登记了哪几条去登记 ai.effect.ps.*，没登记的菜单项保持灰。
   命令一律 ai.<原码 id>：ai.effect.apply／list／remove／setParams／duplicate／move／expandAppearance／dialog／last／applyLast、ai.document.rasterEffectsSettings；
     另外每个效果一条 ai.effect.<效果 id>（＝effect.apply {effect}）与 ai.effect.<效果 id>.dialog（开对话框，菜单项接这条）。 */
(function(){
'use strict';
if (window.AiFx) return;

/* ═════════════ 小工具 ═════════════ */
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fin = v => typeof v === 'number' && isFinite(v);
/* util.rs:7 num：数字、数字字串（"10 pt"）、布尔；非有限 ⇒ 预设 */
function num(p, k, d){
  const v = p ? p[k] : undefined; let n = NaN;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string'){ const m = v.trim().match(/^[0-9.+\-eE]+/); n = m ? parseFloat(m[0]) : NaN; }
  else if (typeof v === 'boolean') n = v ? 1 : 0;
  return isFinite(n) ? n : d;
}
/* util.rs:21 flag */
function flag(p, k, d){ const v = p ? p[k] : undefined; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v !== 0; return d; }
const text = (p, k, d) => (p && typeof p[k] === 'string') ? p[k] : d;
const sub = (a, b) => [a[0]-b[0], a[1]-b[1]], add = (a, b) => [a[0]+b[0], a[1]+b[1]], mul = (a, k) => [a[0]*k, a[1]*k];
const lerp = (a, b, t) => [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t];
const dist = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1]);
const dot = (a, b) => a[0]*b[0] + a[1]*b[1];
const painted = p => !!p && p !== 'none' && p !== '';
const hasStroke = s => painted(s.stroke) && (s.strokeWidth || 0) > 0;
const T = k => (window.Lang ? Lang.t(k) : k);
const AO = () => { if (!window.AIObj) throw new Error('ai.effect: menus/impl/ai-object.js（AIObj）没载入'); return window.AIObj; };
const KAPPA = 0.5522847498307936;

/* util.rs:47 noise：splitmix64 雜湊，(seed, a, b, c) → [-1, 1]；u64 环绕乘法用 BigInt 照算，结果跟原码一模一样 */
const M64 = (1n << 64n) - 1n, K1 = 0x9E3779B97F4A7C15n, K2 = 0xBF58476D1CE4E5B9n, K3 = 0x94D049BB133111EBn;
function noise(seed, a, b, c){
  let x = ((BigInt(seed) * K1) & M64) ^ ((BigInt(a) * K2) & M64) ^ ((BigInt(b) * K3) & M64) ^ BigInt(c);
  x = (x + K1) & M64;
  x = ((x ^ (x >> 30n)) * K2) & M64;
  x = ((x ^ (x >> 27n)) * K3) & M64;
  x ^= x >> 31n;
  return Number(x >> 11n) / 9007199254740992 * 2 - 1;
}
const seedOf = p => { const v = Math.floor(Math.abs(num(p, 'seed', 0))); return Math.min(v, Number.MAX_SAFE_INTEGER); };   // util.rs:57（f64 as u64）

/* 仿射 [a,b,c,d,e,f]（kurbo Affine：x' = a·x + c·y + e） */
const Af = {
  mul(m, n){ return [m[0]*n[0] + m[2]*n[1], m[1]*n[0] + m[3]*n[1], m[0]*n[2] + m[2]*n[3], m[1]*n[2] + m[3]*n[3], m[0]*n[4] + m[2]*n[5] + m[4], m[1]*n[4] + m[3]*n[5] + m[5]]; },
  tr(x, y){ return [1, 0, 0, 1, x, y]; },
  sc(x, y){ return [x, 0, 0, y, 0, 0]; },
  rot(t){ const c = Math.cos(t), s = Math.sin(t); return [c, s, -s, c, 0, 0]; },
  ap(m, p){ return [m[0]*p[0] + m[2]*p[1] + m[4], m[1]*p[0] + m[3]*p[1] + m[5]]; },
  inv(m){ const d = m[0]*m[3] - m[1]*m[2], a = m[3]/d, b = -m[1]/d, c = -m[2]/d, e = m[0]/d; return [a, b, c, e, -(a*m[4] + c*m[5]), -(b*m[4] + e*m[5])]; }
};

/* ═════════════ 路径资料（原码 PathData＝多条 SubPath）：G = [{anchors:[{x,y,in,out}], closed}]，把手绝对座标、null＝没有把手 ═════════════ */
const P = a => [a.x, a.y];
const hIn = a => a.in || [a.x, a.y], hOut = a => a.out || [a.x, a.y];
const hnd = (p, q) => (q && Math.hypot(q[0]-p[0], q[1]-p[1]) > 1e-9) ? [q[0], q[1]] : null;     // 原码「把手等于 p」＝我们 null
const anc = (p, hi, ho) => ({x:p[0], y:p[1], in:hnd(p, hi), out:hnd(p, ho)});                // Anchor::with_handles
const segN = sp => { const n = sp.anchors.length; return n < 2 ? 0 : (sp.closed ? n : n - 1); };
function seg(sp, i){ const A = sp.anchors, a = A[i], b = A[(i + 1) % A.length]; return {p0:P(a), c1:hOut(a), c2:hIn(b), p3:P(b)}; }
function segIsLine(sp, i){ const A = sp.anchors, a = A[i], b = A[(i + 1) % A.length]; return !a.out && !b.in; }
/* util.rs:67 seg_cubic：直线段的把手放在 1/3、2/3，非线性映射才弯得动它 */
function segCubic(sp, i){ const c = seg(sp, i); return segIsLine(sp, i) ? {p0:c.p0, c1:lerp(c.p0, c.p3, 1/3), c2:lerp(c.p0, c.p3, 2/3), p3:c.p3} : c; }
function evalC(c, t){ const m = 1 - t, a = m*m*m, b = 3*m*m*t, d = 3*m*t*t, e = t*t*t; return [a*c.p0[0] + b*c.c1[0] + d*c.c2[0] + e*c.p3[0], a*c.p0[1] + b*c.c1[1] + d*c.c2[1] + e*c.p3[1]]; }
function splitC(c, t){
  const p01 = lerp(c.p0, c.c1, t), p12 = lerp(c.c1, c.c2, t), p23 = lerp(c.c2, c.p3, t), a = lerp(p01, p12, t), b = lerp(p12, p23, t), m = lerp(a, b, t);
  return [{p0:c.p0, c1:p01, c2:a, p3:m}, {p0:m, c1:b, c2:p23, p3:c.p3}];
}
/* kurbo subsegment(t0..t1) */
function subseg(c, t0, t1){ let x = t1 < 1 ? splitC(c, t1)[0] : c; if (t0 > 0) x = splitC(x, t1 > 0 ? t0 / t1 : 0)[1]; return x; }
const polyLen = c => dist(c.p0, c.c1) + dist(c.c1, c.c2) + dist(c.c2, c.p3);                    // live.rs:382 poly_len
function arclen(c){ let l = 0, q = c.p0; for (let i = 1; i <= 48; i++){ const r = evalC(c, i / 48); l += dist(q, r); q = r; } return l; }
function extrema1(p0, p1, p2, p3){
  const a = -p0 + 3*p1 - 3*p2 + p3, b = 2*(p0 - 2*p1 + p2), c = p1 - p0, out = [];
  if (Math.abs(a) < 1e-12){ if (Math.abs(b) > 1e-12){ const t = -c / b; if (t > 0 && t < 1) out.push(t); } return out; }
  const D = b*b - 4*a*c; if (D < 0) return out;
  const q = Math.sqrt(D); [(-b + q) / (2*a), (-b - q) / (2*a)].forEach(t => { if (t > 0 && t < 1) out.push(t); });
  return out;
}
/* PathData::bounds（紧外框） → {x0,y0,x1,y1}|null */
function boundsG(G){
  let r = null; const addp = p => { if (!fin(p[0]) || !fin(p[1])) return; r = r ? {x0:Math.min(r.x0, p[0]), y0:Math.min(r.y0, p[1]), x1:Math.max(r.x1, p[0]), y1:Math.max(r.y1, p[1])} : {x0:p[0], y0:p[1], x1:p[0], y1:p[1]}; };
  for (const sp of G || []){
    sp.anchors.forEach(a => addp(P(a)));
    for (let i = 0; i < segN(sp); i++){ const c = seg(sp, i); for (const k of [0, 1]) extrema1(c.p0[k], c.c1[k], c.c2[k], c.p3[k]).forEach(t => addp(evalC(c, t))); }
  }
  return r;
}
const bw = b => b.x1 - b.x0, bh = b => b.y1 - b.y0, bc = b => [(b.x0 + b.x1)/2, (b.y0 + b.y1)/2];
const diag = b => Math.max(Math.hypot(bw(b), bh(b)), 1e-6);                                      // distort.rs:8
const meanSize = b => (Math.abs(bw(b)) + Math.abs(bh(b))) / 2;                                    // util.rs:62
const unionB = (a, b) => !a ? b : !b ? a : {x0:Math.min(a.x0, b.x0), y0:Math.min(a.y0, b.y0), x1:Math.max(a.x1, b.x1), y1:Math.max(a.y1, b.y1)};
/* SubPath::polyline：每点一个直角点 */
const poly = (pts, closed) => ({anchors:pts.map(q => ({x:q[0], y:q[1], in:null, out:null})), closed:!!closed});
/* util.rs:76 catmull_rom */
function catmull(pts, closed, tension){
  const n = pts.length; if (n < 3) return poly(pts, closed);
  return {closed:!!closed, anchors:pts.map((p, i) => {
    const prev = i === 0 ? (closed ? pts[n - 1] : pts[0]) : pts[i - 1];
    const next = i === n - 1 ? (closed ? pts[0] : pts[n - 1]) : pts[i + 1];
    const t = mul(sub(next, prev), tension / 6);
    return anc(p, sub(p, t), add(p, t));
  })};
}
/* util.rs:93 normal_at：行进方向的左法向（y 朝下） */
function normalAt(c, t){
  const e = 1e-4, a = evalC(c, Math.max(t - e, 0)), b = evalC(c, Math.min(t + e, 1));
  let d = sub(b, a); if (Math.hypot(d[0], d[1]) < 1e-12) d = sub(c.p3, c.p0);
  const l = Math.hypot(d[0], d[1]); return l < 1e-12 ? [0, 0] : [d[1] / l, -d[0] / l];
}
/* live.rs:401 map_nonlinear：每段切成不长于 max_piece 的小段（每段最多 64），映射控制点 */
function mapNonlinear(G, maxPiece, f){
  maxPiece = Math.max(maxPiece, 1e-3);
  const out = [];
  for (const sp of G){
    const n = sp.anchors.length; if (!n) continue;
    const segs = segN(sp), res = []; let pending = null;
    for (let i = 0; i < n; i++){
      const a = sp.anchors[i];
      const hi = pending || f(hIn(a)); pending = null;
      res.push({p:f(P(a)), hi, ho:f(hOut(a))});
      if (i < segs){
        const c = segCubic(sp, i), k = clamp(Math.ceil(polyLen(c) / maxPiece) || 1, 1, 64);
        for (let j = 0; j < k; j++){
          const s = subseg(c, j / k, (j + 1) / k);
          res[res.length - 1].ho = f(s.c1);
          if (j + 1 < k) res.push({p:f(s.p3), hi:f(s.c2), ho:f(s.p3)});
          else pending = f(s.c2);
        }
      }
    }
    if (pending && sp.closed && res.length) res[0].hi = pending;
    out.push({anchors:res.map(r => anc(r.p, r.hi, r.ho)), closed:!!sp.closed});
  }
  return out;
}
function transformG(G, m){ return G.map(sp => ({closed:!!sp.closed, anchors:sp.anchors.map(a => anc(Af.ap(m, P(a)), Af.ap(m, hIn(a)), Af.ap(m, hOut(a))))})); }
const okG = G => Array.isArray(G) && G.every(sp => sp.anchors.every(a => fin(a.x) && fin(a.y)));

/* ═════════════ 效果目录（lib.rs:161 effect_catalog；预设＝Illustrator 对话框预设；params 说明照原码）═════════════ */
const WARP_DOC = '{bend: % (-100..100, 50), horizontal: % distortion (0), vertical: % distortion (0), orientation: "horizontal"|"vertical"}';
const CAT = {};
const g = (id, label, menu, params, defaults, raster) => { CAT[id] = {id, label, menu, params, defaults, raster:!!raster}; };
g('convertToShape.rectangle', 'Rectangle…', 'Convert to Shape', '{relative: bool (true), extraW: pt (18), extraH: pt (18), width: pt (absolute, 100), height: pt (absolute, 100)}', {relative:true, extraW:18, extraH:18, width:100, height:100});
g('convertToShape.roundedRectangle', 'Rounded Rectangle…', 'Convert to Shape', '{relative: bool (true), extraW: pt (18), extraH: pt (18), width, height (absolute), radius: pt (9)}', {relative:true, extraW:18, extraH:18, width:100, height:100, radius:9});
g('convertToShape.ellipse', 'Ellipse…', 'Convert to Shape', '{relative: bool (true), extraW: pt (18), extraH: pt (18), width, height (absolute)}', {relative:true, extraW:18, extraH:18, width:100, height:100});
g('distort.freeDistort', 'Free Distort…', 'Distort & Transform', '{corners: [[x,y]×4] new positions of the bounding-box corners TL, TR, BR, BL in unit box coordinates (identity [[0,0],[1,0],[1,1],[0,1]])}', {corners:[[0, 0], [1, 0], [1, 1], [0, 1]]});
g('distort.puckerBloat', 'Pucker & Bloat…', 'Distort & Transform', '{amount: % (-200 pucker … 200 bloat, default 0)}', {amount:0});
g('distort.roughen', 'Roughen…', 'Distort & Transform', '{size: 0..100 (5), relative: bool (true: % of size; false: pt), detail: per inch 0..100 (10), points: "smooth"|"corner", seed: int (0)}', {size:5, relative:true, detail:10, points:'smooth', seed:0});
g('distort.transform', 'Transform…', 'Distort & Transform', '{scaleH: % (100), scaleV: % (100), moveH: pt (0), moveV: pt (0), rotate: deg (0), copies: int (0), reflectX: bool, reflectY: bool}', {scaleH:100, scaleV:100, moveH:0, moveV:0, rotate:0, copies:0, reflectX:false, reflectY:false});
g('distort.tweak', 'Tweak…', 'Distort & Transform', '{h: amount (10), v: amount (10), relative: bool (true: % of size), anchors: bool (true), in: bool (true), out: bool (true), seed: int (0)}', {h:10, v:10, relative:true, anchors:true, in:true, out:true, seed:0});
g('distort.twist', 'Twist…', 'Distort & Transform', '{angle: deg (-3600..3600, 10)}', {angle:10});
g('distort.zigZag', 'Zig Zag…', 'Distort & Transform', '{size: (10), relative: bool (false: pt; true: % of size), ridges: per segment 0..100 (4), points: "smooth"|"corner"}', {size:10, relative:false, ridges:4, points:'smooth'});
g('path.offsetPath', 'Offset Path…', 'Path', '{offset: pt (10; negative insets), joins: "miter"|"round"|"bevel", miterLimit: (4)}', {offset:10, joins:'miter', miterLimit:4});
g('path.outlineStroke', 'Outline Stroke', 'Path', "{width?: pt (defaults to the stroke's weight)} the outline of the object's stroke (round joins and caps, as the canvas draws strokes)", {});
g('stylize.roundCorners', 'Round Corners…', 'Stylize', '{radius: pt (10)}', {radius:10});
g('stylize.scribble', 'Scribble…', 'Stylize', '{angle: deg (30), overlap: pt (0), strokeWidth: pt (3), curviness: % (5), spacing: pt (5), variation: pt (0.5), seed: int (0)} (simplified: a single hatching scribble outlined to a filled shape)', {angle:30, overlap:0, strokeWidth:3, curviness:5, spacing:5, variation:0.5, seed:0});
g('stylize.dropShadow', 'Drop Shadow…', 'Stylize', '{mode: blend mode ("multiply"), opacity: % (75), x: pt (7), y: pt (7), blur: pt (5), color: "#rrggbb" ("#000000")}', {mode:'multiply', opacity:75, x:7, y:7, blur:5, color:'#000000'}, true);
g('stylize.innerGlow', 'Inner Glow…', 'Stylize', '{mode: blend mode ("screen"), opacity: % (75), blur: pt (5), color: "#rrggbb" ("#ffffff"), source: "edge"|"center"}', {mode:'screen', opacity:75, blur:5, color:'#ffffff', source:'edge'}, true);
g('stylize.outerGlow', 'Outer Glow…', 'Stylize', '{mode: blend mode ("screen"), opacity: % (75), blur: pt (5), color: "#rrggbb" ("#ffff00")}', {mode:'screen', opacity:75, blur:5, color:'#ffff00'}, true);
g('stylize.feather', 'Feather…', 'Stylize', '{radius: pt (5)}', {radius:5}, true);
g('blur.gaussian', 'Gaussian Blur…', 'Blur', '{radius: pt (5)}', {radius:5}, true);
const WARP_STYLES = ['arc', 'arcLower', 'arcUpper', 'arch', 'bulge', 'shellLower', 'shellUpper', 'flag', 'wave', 'fish', 'rise', 'fisheye', 'inflate', 'squeeze', 'twist'];
const WARP_LABEL = {arc:'Arc…', arcLower:'Arc Lower…', arcUpper:'Arc Upper…', arch:'Arch…', bulge:'Bulge…', shellLower:'Shell Lower…', shellUpper:'Shell Upper…', flag:'Flag…', wave:'Wave…', fish:'Fish…', rise:'Rise…', fisheye:'Fisheye…', inflate:'Inflate…', squeeze:'Squeeze…', twist:'Twist…'};
WARP_STYLES.forEach(k => g('warp.' + k, WARP_LABEL[k], 'Warp', WARP_DOC, {bend:50, horizontal:0, vertical:0, orientation:'horizontal'}));
/* group.rs:21 PATHFINDER_EFFECTS（十种，Illustrator 菜单顺序） */
const PATHFINDER = [['pathfinder.add', 'Add', 'unite'], ['pathfinder.intersect', 'Intersect', 'intersect'], ['pathfinder.exclude', 'Exclude', 'exclude'],
  ['pathfinder.subtract', 'Subtract', 'minusFront'], ['pathfinder.minusBack', 'Minus Back', 'minusBack'], ['pathfinder.divide', 'Divide', 'divide'],
  ['pathfinder.trim', 'Trim', 'trim'], ['pathfinder.merge', 'Merge', 'merge'], ['pathfinder.crop', 'Crop', 'crop'], ['pathfinder.outline', 'Outline', 'outline']];
PATHFINDER.forEach(([id, label]) => g(id, label, 'Pathfinder', '{} (groups: live Pathfinder over the members)', {}));
g('cropMarks', 'Crop Marks', '', '{style?: "roman"|"japanese" (default roman)} trim marks around the object\'s bounds, following it', {});
const PF_OP = Object.fromEntries(PATHFINDER.map(r => [r[0], r[2]]));

const isRaster = id => ['stylize.dropShadow', 'stylize.innerGlow', 'stylize.outerGlow', 'stylize.feather', 'blur.gaussian'].includes(id);   // lib.rs:429
const isPathfinder = id => typeof id === 'string' && id.startsWith('pathfinder.');
const isGeometry = id => !!CAT[id] && !isRaster(id) && !isPathfinder(id) && id !== 'cropMarks';                                          // lib.rs:436
/* lib.rs:388 merged_params：预设上盖给的参数（不认识的键也留着） */
function merged(id, params){ return Object.assign(clone((CAT[id] && CAT[id].defaults) || {}), (params && typeof params === 'object') ? clone(params) : {}); }
const visFx = s => (Array.isArray(s.effects) ? s.effects.filter(e => e && e.visible !== false && CAT[e.id]) : []);

/* ═════════════ 几何效果（distort.rs／stylize.rs／warp.rs）═════════════ */
/* 自由扭曲：外框双线性映到四个新角 */
function freeDistort(G, b, p){
  const c = [[0, 0], [1, 0], [1, 1], [0, 1]];
  if (Array.isArray(p.corners)) p.corners.slice(0, 4).forEach((v, i) => { if (Array.isArray(v) && fin(+v[0]) && fin(+v[1])) c[i] = [+v[0], +v[1]]; });
  const w = Math.max(bw(b), 1e-9), h = Math.max(bh(b), 1e-9);
  const C = c.map(q => [b.x0 + q[0]*w, b.y0 + q[1]*h]);
  return mapNonlinear(G, diag(b) / 16, q => { const u = (q[0] - b.x0) / w, v = (q[1] - b.y0) / h; return lerp(lerp(C[0], C[1], u), lerp(C[3], C[2], u), v); });
}
/* 收缩和膨胀：锚点往中心（膨胀）／远离（收缩），把手反方向 */
function puckerBloat(G, b, amount){
  const a = clamp(amount, -200, 200) / 100;
  if (a === 0) return clone(G);
  const c = bc(b);
  return G.map(sp => {
    const n = sp.anchors.length, R = sp.anchors.map(x => ({p:P(x), hi:hIn(x), ho:hOut(x)}));
    for (let i = 0; i < segN(sp); i++){ const cub = segCubic(sp, i), j = (i + 1) % n; R[i].ho = cub.c1; R[j].hi = cub.c2; }
    return {closed:!!sp.closed, anchors:R.map(r => anc(lerp(r.p, c, a*0.5), lerp(r.hi, c, -a*0.5), lerp(r.ho, c, -a*0.5)))};
  });
}
/* 粗糙化：按每英寸 detail 个点重新取样、每点抖动 size */
function roughen(G, b, p){
  const size = clamp(num(p, 'size', 5), 0, 1e4);
  const amp = flag(p, 'relative', true) ? size / 100 * meanSize(b) : size;
  const detail = clamp(num(p, 'detail', 10), 0, 100), spacing = detail > 0 ? 72 / detail : Infinity;
  const smooth = text(p, 'points', 'smooth').toLowerCase() !== 'corner', seed = seedOf(p);
  return G.map((sp, si) => {
    let pts = [];
    for (let i = 0; i < segN(sp); i++){
      const c = seg(sp, i), len = arclen(c);
      const k = isFinite(spacing) ? clamp(Math.ceil(len / spacing) || 1, 1, 2000) : 1;
      for (let j = 0; j < k; j++) pts.push(evalC(c, j / k));
    }
    if (!sp.closed && sp.anchors.length) pts.push(P(sp.anchors[sp.anchors.length - 1]));
    if (!pts.length) pts = sp.anchors.map(P);
    pts = pts.map((q, k) => [q[0] + amp * noise(seed, si, k, 1), q[1] + amp * noise(seed, si, k, 2)]);
    return smooth ? catmull(pts, sp.closed, 1.0) : poly(pts, sp.closed);
  });
}
/* 变换：以中心缩放、镜像、旋转、移动；副本＝一再套同一个变换叠上去 */
function transformFx(G, b, p){
  const sx = num(p, 'scaleH', 100) / 100, sy = num(p, 'scaleV', 100) / 100;
  const rx = flag(p, 'reflectX', false) ? -1 : 1, ry = flag(p, 'reflectY', false) ? -1 : 1;
  const c = bc(b);
  const m = Af.mul(Af.tr(num(p, 'moveH', 0) + c[0], num(p, 'moveV', 0) + c[1]), Af.mul(Af.rot(-num(p, 'rotate', 0) * Math.PI / 180), Af.mul(Af.sc(sx*rx, sy*ry), Af.tr(-c[0], -c[1]))));
  const copies = Math.floor(clamp(num(p, 'copies', 0), 0, 1000));
  if (!copies) return transformG(G, m);
  let out = clone(G), cur = G;
  for (let i = 0; i < copies; i++){ cur = transformG(cur, m); out = out.concat(clone(cur)); }
  return out;
}
/* 扭拧：锚点与／或把手随机位移 */
function tweak(G, b, p){
  const rel = flag(p, 'relative', true), h = num(p, 'h', 10), v = num(p, 'v', 10);
  const ah = rel ? h / 100 * Math.abs(bw(b)) : h, av = rel ? v / 100 * Math.abs(bh(b)) : v;
  const fa = flag(p, 'anchors', true), fi = flag(p, 'in', true), fo = flag(p, 'out', true), seed = seedOf(p);
  return G.map((sp, si) => ({closed:!!sp.closed, anchors:sp.anchors.map((a, ai) => {
    const key = (BigInt(si) << 32n) | BigInt(ai);
    const d = c => [ah * noise(seed, key, c, 1), av * noise(seed, key, c, 2)];
    let pp = P(a), hi = hIn(a), ho = hOut(a);
    if (fa){ const dp = d(0); pp = add(pp, dp); hi = add(hi, dp); ho = add(ho, dp); }
    if (fi) hi = add(hi, d(1));
    if (fo) ho = add(ho, d(2));
    return anc(pp, hi, ho);
  })}));
}
/* 扭转：中心转最多、到外框外接圆淡到 0 */
function twist(G, b, angle){
  const ang = clamp(angle, -3600, 3600) * Math.PI / 180;
  if (ang === 0) return clone(G);
  const c = bc(b), r = diag(b) / 2;
  const f = q => { const d = sub(q, c), t = Math.max(1 - Math.hypot(d[0], d[1]) / r, 0), a = -ang * t, s = Math.sin(a), co = Math.cos(a); return [c[0] + d[0]*co - d[1]*s, c[1] + d[0]*s + d[1]*co]; };
  return mapNonlinear(G, Math.min(r / 8, r / (1 + Math.abs(ang) * 2)), f);
}
/* 波纹效果：每段多 ridges 个点，沿法向左右交替推出去 */
function zigZag(G, b, p){
  const size = clamp(num(p, 'size', 10), -1e4, 1e4);
  const amp = flag(p, 'relative', false) ? size / 100 * meanSize(b) : size;
  const ridges = Math.floor(clamp(num(p, 'ridges', 4), 0, 100));
  const smooth = text(p, 'points', 'smooth').toLowerCase() !== 'corner';
  return G.map(sp => {
    const segs = segN(sp), pts = []; let k = 0;
    for (let i = 0; i < segs; i++){
      const c = seg(sp, i);
      for (let j = 0; j <= ridges; j++){
        const t = j / (ridges + 1);
        let nrm;
        if (j === 0){
          const prev = i > 0 ? seg(sp, i - 1) : (sp.closed ? seg(sp, segs - 1) : null), n1 = normalAt(c, 0);
          if (prev){ const s = add(n1, normalAt(prev, 1)), l = Math.hypot(s[0], s[1]); nrm = l > 1e-9 ? mul(s, 1 / l) : n1; } else nrm = n1;
        } else nrm = normalAt(c, t);
        pts.push(add(evalC(c, t), mul(nrm, amp * (k % 2 === 0 ? 1 : -1)))); k++;
      }
    }
    if (!sp.closed){
      if (segs > 0){ const c = seg(sp, segs - 1); pts.push(add(c.p3, mul(normalAt(c, 1), amp * (k % 2 === 0 ? 1 : -1)))); }
      else sp.anchors.forEach(a => pts.push(P(a)));
    }
    return smooth ? catmull(pts, sp.closed, 1.0) : poly(pts, sp.closed);
  });
}
/* 偏移路径（lib.rs:524 → pathops offset_path；拉平后用 ai-object 的平面排列）：闭合的＝填色区 ∪／− 宽 2|d| 的环；开放的＝平头描边区 */
function offsetPath(G, p, ctx){
  const off = clamp(num(p, 'offset', 10), -1e5, 1e5);
  if (Math.abs(off) < 1e-9) return clone(G);
  const O = AO(), join = ({round:'round', bevel:'bevel'})[text(p, 'joins', 'miter').toLowerCase()] || 'miter', miter = clamp(num(p, 'miterLimit', 4), 1, 500), d = Math.abs(off);
  const closed = G.filter(sp => sp.closed && sp.anchors.length > 1), open = G.filter(sp => !sp.closed && sp.anchors.length > 1);
  const fill = closed.map(sp => O.flatten(sp, 0.05)), ring = [], ob = [];
  closed.forEach(sp => ring.push(...O.strokePieces(O.flatten(sp, 0.05), true, 2*d, join, 'butt', miter)));
  open.forEach(sp => ob.push(...O.strokePieces(O.flatten(sp, 0.05), false, 2*d, join, 'butt', miter)));
  const sets = [{polys:fill, rule:ctx.rule === 'evenodd' ? 'evenodd' : 'nonzero'}, {polys:ring, rule:'nonzero'}, {polys:ob, rule:'nonzero'}];
  return O.arrangement(sets, off >= 0 ? (m => m[0] || m[1] || m[2]) : (m => m[0] && !m[1])).map(L => poly(L, true));
}
/* 轮廓化描边（lib.rs:531）：描边宽＝params.width，否则物件描边宽，没描边就当 1pt；圆角接合、圆头（我们画布的描边就是这样画） */
function outlineStroke(G, p, ctx){
  const w = fin(p.width) ? p.width : (ctx.strokeWidth || 1);
  if (!(w > 0)) return clone(G);
  const O = AO(), pieces = [];
  G.forEach(sp => { if (sp.anchors.length > 1) pieces.push(...O.strokePieces(O.flatten(sp, 0.05), !!sp.closed, w, 'round', 'round', 4)); });
  return pieces.length ? O.arrangement([{polys:pieces, rule:'nonzero'}], m => m[0]).map(L => poly(L, true)) : [];
}
/* 转换为形状：外框（相对＝加额外宽高；绝对＝以中心定宽高）上的矩形／圆角矩形／椭圆（shapes.rs 的锚点排法＝VecSel._liveToBezier） */
function convertToShape(id, b, p){
  let r;
  if (flag(p, 'relative', true)){
    const ew = num(p, 'extraW', 18), eh = num(p, 'extraH', 18), c = bc(b);
    r = {x0:Math.min(b.x0 - ew/2, c[0]), y0:Math.min(b.y0 - eh/2, c[1]), x1:Math.max(b.x1 + ew/2, c[0]), y1:Math.max(b.y1 + eh/2, c[1])};
  } else {
    const w = Math.abs(num(p, 'width', 100)), h = Math.abs(num(p, 'height', 100)), c = bc(b);
    r = {x0:c[0] - w/2, y0:c[1] - h/2, x1:c[0] + w/2, y1:c[1] + h/2};
  }
  const s = id === 'convertToShape.ellipse' ? {type:'ellipse', x:r.x0, y:r.y0, w:bw(r), h:bh(r)}
          : {type:'rect', x:r.x0, y:r.y0, w:bw(r), h:bh(r), radius:id === 'convertToShape.roundedRectangle' ? num(p, 'radius', 9) : 0};
  const v = VecSel._liveToBezier(s);
  return v ? [{anchors:v.anchors.map(a => ({x:a.x, y:a.y, in:a.in, out:a.out})), closed:true}] : [];
}
/* 直线上多出来的点（路径查找器排列在交点切开的边、重复点）拿掉：不拿的话两边的段变短，圆角被「半段长」夹小（AI 圆角看的是真正的转角） */
function dropCollinear(sp){
  if (!sp.closed) return sp;
  let A = sp.anchors.slice(), changed = true;
  while (changed && A.length > 3){
    changed = false;
    for (let i = 0; i < A.length && A.length > 3; i++){
      const a = A[i], p = A[(i + A.length - 1) % A.length], q = A[(i + 1) % A.length];
      if (a.in || a.out || p.out || q.in) continue;
      const u = sub(P(a), P(p)), v = sub(P(q), P(a)), lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
      if (lu > 1e-9 && lv > 1e-9 && (Math.abs(u[0]*v[1] - u[1]*v[0]) > 1e-6 * lu * lv || dot(u, v) < 0)) continue;
      A.splice(i, 1); i--; changed = true;
    }
  }
  return {anchors:A, closed:true};
}
/* 圆角：没把手的尖角点换成两个点、中间一段近似圆弧（凸角、凹角一样圆：凹角＝往外补一块圆角，两个形状接缝处就这样融成一片） */
function roundCorners(G, radius){
  if (!(radius > 0)) return clone(G);
  return G.map(dropCollinear).map(sp => {
    const n = sp.anchors.length;
    if (n < 3 && (n !== 2 || sp.closed)) return clone(sp);
    const out = [];
    for (let i = 0; i < n; i++){
      const a = sp.anchors[i], interior = sp.closed || (i > 0 && i + 1 < n);
      if (!interior || a.in || a.out){ out.push(clone(a)); continue; }
      const prev = sp.anchors[(i + n - 1) % n], next = sp.anchors[(i + 1) % n];
      const tp = prev.out ? prev.out : P(prev), tn = next.in ? next.in : P(next);
      const vp = sub(tp, P(a)), vn = sub(tn, P(a)), lp = Math.hypot(vp[0], vp[1]), ln = Math.hypot(vn[0], vn[1]);
      if (lp < 1e-9 || ln < 1e-9){ out.push(clone(a)); continue; }
      const up = mul(vp, 1 / lp), un = mul(vn, 1 / ln);
      if (dot(up, un) < -0.9999){ out.push(clone(a)); continue; }
      // 切点离角 radius（夹在两边各一半以内；AI 的圆角也是这样量：三角形 11 mm 圆角仍是圆角三角形、不会变圆）；
      // 两边夹角 φ ⇒ 切在两个切点的圆弧半径 R＝d·tan(φ/2)，把手 4/3·tan(α/4)·R（α＝转过的角＝π−φ；直角＝KAPPA·d）⇒ 真的圆弧
      const phi = Math.acos(clamp(dot(up, un), -1, 1));
      const d = Math.min(radius, dist(P(prev), P(a)) / 2, dist(P(next), P(a)) / 2);
      const k = 4 / 3 * Math.tan((Math.PI - phi) / 4) * d * Math.tan(phi / 2);
      const pa = add(P(a), mul(up, d)), pb = add(P(a), mul(un, d));
      out.push(anc(pa, pa, sub(pa, mul(up, k))));
      out.push(anc(pb, sub(pb, mul(un, k)), pb));
    }
    return {anchors:out, closed:!!sp.closed};
  });
}
/* 涂抹（stylize.rs:99，原码自己也是简化版）：转到 angle 的局部座标、一行一行扫线来回涂，再描成 strokeWidth 宽的轮廓（圆接合圆头）。
   轮廓片不做联集（全部同向，非零填色画出来就是联集；排列上千个圆接合太慢） */
function scribble(G, b, p, ctx){
  const angle = num(p, 'angle', 30) * Math.PI / 180, overlap = num(p, 'overlap', 0), width = clamp(num(p, 'strokeWidth', 3), 0.01, 1000);
  const curvy = clamp(num(p, 'curviness', 5), 0, 100) / 100, spacing = Math.max(num(p, 'spacing', 5), 0.1), variation = clamp(num(p, 'variation', 0.5), 0, 100), seed = seedOf(p);
  const c = bc(b), toLocal = Af.mul(Af.tr(c[0], c[1]), Af.mul(Af.rot(angle), Af.tr(-c[0], -c[1]))), fromLocal = Af.inv(toLocal);
  const O = AO();
  const polys = G.filter(sp => sp.anchors.length).map(sp => { const L = O.flatten(sp, 0.25); if (sp.closed && L.length) L.push(L[0]); return L.map(q => Af.ap(fromLocal, q)); });
  let y0 = Infinity, y1 = -Infinity; polys.forEach(L => L.forEach(q => { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }));
  if (!isFinite(y0) || y1 - y0 < 1e-9) return [];
  const step = Math.max(spacing, (y1 - y0) / 2000), pts = [];
  let y = y0 + step / 2, row = 0;
  while (y < y1){
    const xs = [];
    for (const L of polys) for (let i = 0; i + 1 < L.length; i++){ const a = L[i], q = L[i + 1]; if ((a[1] <= y && q[1] > y) || (q[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) / (q[1] - a[1]) * (q[0] - a[0])); }
    xs.sort((u, v) => u - v);
    let spans = []; for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i] - overlap, xs[i + 1] + overlap]);
    if (row % 2 === 1) spans.reverse();
    for (const [a, bx] of spans){
      const j = k => variation * noise(seed, row, k, 3);
      const l = [a + j(0), y + j(1)], r = [bx + j(2), y + j(3)];
      if (row % 2 === 0) pts.push(l, r); else pts.push(r, l);
    }
    row++; y += step;
  }
  if (pts.length < 2) return [];
  const line = transformG([curvy > 0 ? catmull(pts, false, curvy * 2) : poly(pts, false)], toLocal)[0];
  const pieces = O.strokePieces(O.flatten(line, 0.1), false, width, 'round', 'round', 4);
  // 物件有描边时才做联集（描边要描整条涂抹的外缘；300×200 约半秒，结果有快取）；只有填色时各片同向、非零填色画出来就是联集
  return (ctx && ctx.strokeWidth ? O.arrangement([{polys:pieces, rule:'nonzero'}], m => m[0]) : pieces).map(L => poly(L, true));
}
/* live.rs:322 warp_point：正规座标 (x, y) ∈ [-1,1]²（y 朝下）上的变形 */
function warpPoint(style, b, dh, dv, x, y){
  const t = (y + 1) / 2, par = 1 - x*x, PI = Math.PI;
  let x2, y2;
  switch (style){
    case 'arc':
      if (Math.abs(b) < 1e-6){ x2 = x; y2 = y; break; }
      { const sweep = Math.abs(b) * PI, r0 = 2 / sweep, yy = b > 0 ? y : -y, a = x / r0, r = r0 - yy, nx = r * Math.sin(a), ny = r0 - r * Math.cos(a); x2 = nx; y2 = b > 0 ? ny : -ny; }
      break;
    case 'arcLower': x2 = x; y2 = y + b * par * t; break;
    case 'arcUpper': x2 = x; y2 = y - b * par * (1 - t); break;
    case 'arch': x2 = x; y2 = y - b * par; break;
    case 'bulge': x2 = x; y2 = y + b * par * y; break;
    case 'shellLower': x2 = x * (1 - 0.5 * b * (1 - t)); y2 = y + b * par * t; break;
    case 'shellUpper': x2 = x * (1 - 0.5 * b * t); y2 = y - b * par * (1 - t); break;
    case 'flag': x2 = x; y2 = y + 0.5 * b * Math.sin(PI * x); break;
    case 'wave': x2 = x + 0.1 * b * Math.sin(PI * y); y2 = y + 0.3 * b * Math.sin(2 * PI * x) * (0.5 + 0.5 * t); break;
    case 'fish': x2 = x; y2 = y * (1 + 0.5 * b * Math.sin(0.75 * PI * (x + 1))); break;
    case 'rise': x2 = x; y2 = y - b * Math.pow((x + 1) / 2, 2) * 2 + b; break;
    case 'fisheye': { const r2 = x*x + y*y, s = r2 < 1 ? 1 + 0.5 * b * (1 - r2) : 1; x2 = x * s; y2 = y * s; break; }
    case 'inflate': x2 = x * (1 + 0.5 * b * (1 - y*y)); y2 = y * (1 + 0.5 * b * par); break;
    case 'squeeze': x2 = x * (1 - 0.5 * b * (1 - y*y)); y2 = y * (1 + 0.3 * b * par); break;
    default: { const r = Math.sqrt(x*x + y*y), a = -b * PI * 0.5 * Math.max(1 - r / Math.SQRT2, 0), s = Math.sin(a), c = Math.cos(a); x2 = x*c - y*s; y2 = x*s + y*c; }   // twist
  }
  if (dh !== 0) y2 *= Math.max(1 + dh * x2 * 0.5, 0);
  if (dv !== 0) x2 *= Math.max(1 + dv * y2 * 0.5, 0);
  return [x2, y2];
}
function warp(G, b, style, p){
  const bend = clamp(num(p, 'bend', 50), -100, 100) / 100, dh = clamp(num(p, 'horizontal', 0), -100, 100) / 100, dv = clamp(num(p, 'vertical', 0), -100, 100) / 100;
  const vertical = text(p, 'orientation', 'horizontal').toLowerCase() === 'vertical';
  const c = bc(b), hw = Math.max(bw(b) / 2, 1e-9), hh = Math.max(bh(b) / 2, 1e-9);
  const f = q => {
    const x = (q[0] - c[0]) / hw, y = (q[1] - c[1]) / hh;
    let r; if (vertical){ const w = warpPoint(style, bend, dh, dv, y, x); r = [w[1], w[0]]; } else r = warpPoint(style, bend, dh, dv, x, y);
    return [c[0] + r[0] * hw, c[1] + r[1] * hh];
  };
  return mapNonlinear(G, Math.hypot(bw(b), bh(b)) / 24, f);
}
/* lib.rs:511 apply_one */
function applyOne(id, p, G, b, ctx){
  switch (id){
    case 'distort.freeDistort': return freeDistort(G, b, p);
    case 'distort.puckerBloat': return puckerBloat(G, b, num(p, 'amount', 0));
    case 'distort.roughen': return roughen(G, b, p);
    case 'distort.transform': return transformFx(G, b, p);
    case 'distort.tweak': return tweak(G, b, p);
    case 'distort.twist': return twist(G, b, num(p, 'angle', 10));
    case 'distort.zigZag': return zigZag(G, b, p);
    case 'path.offsetPath': return offsetPath(G, p, ctx);
    case 'path.outlineStroke': return outlineStroke(G, p, ctx);
    case 'convertToShape.rectangle': case 'convertToShape.roundedRectangle': case 'convertToShape.ellipse': return convertToShape(id, b, p);
    case 'stylize.roundCorners': return roundCorners(G, num(p, 'radius', 10));
    case 'stylize.scribble': return scribble(G, b, p, ctx);
  }
  if (id.startsWith('warp.') && WARP_STYLES.includes(id.slice(5))) return warp(G, b, id.slice(5), p);
  return clone(G);
}
/* lib.rs:488 apply_geometry_with：可见的几何效果按顺序；第一个用给的外框，之后每个用上一步结果的外框 */
function applyGeometry(effects, G, bounds, ctx){
  let cur = G, b = bounds, first = true;
  for (const e of effects){
    if (e.visible === false || !isGeometry(e.id)) continue;
    if (!first) b = boundsG(cur) || b;
    first = false;
    if (!cur.length || !b) break;
    const r = applyOne(e.id, merged(e.id, e.params), cur, b, ctx);
    cur = okG(r) ? r : cur;
  }
  return cur;
}

/* ═════════════ 形状 ⇄ 路径资料 ═════════════ */
const LEAF = ['rect', 'ellipse', 'star', 'polygon', 'path', 'line', 'bezier'];
const GEOM_KEYS = ['x', 'y', 'w', 'h', 'radius', 'cx', 'cy', 'rx', 'ry', 'r1', 'r2', 'points', 'rotation', 'anchors', 'closed', 'children', 'rule'];
function viewOf(s){ const v = window.VecSel ? VecSel.asBezier(s) : null; return v && v.anchors ? {anchors:clone(v.anchors).map(a => ({x:a.x, y:a.y, in:a.in || null, out:a.out || null})), closed:!!v.closed} : null; }
/* reshape.rs:234 leaf_geometry：路径／复合路径的几何与填色规则；其它 null */
function geomOf(s){
  if (!s) return null;
  if (LEAF.includes(s.type)){ const v = viewOf(s); return v && v.anchors.length ? {G:[v], rule:'nonzero'} : null; }
  if (s.type === 'compound' && Array.isArray(s.children)){ const G = s.children.map(viewOf).filter(v => v && v.anchors.length); return G.length ? {G, rule:s.rule === 'evenodd' ? 'evenodd' : 'nonzero'} : null; }
  return null;
}
/* reshape.rs:245 set_geometry：多条子路径＝复合路径，一条＝路径（活形状参数丢掉＝path_mut 的 live = None） */
function setGeometry(s, G, rule, idf){
  GEOM_KEYS.forEach(k => { delete s[k]; });
  if (G.length > 1){
    s.type = 'compound'; s.rule = rule || 'nonzero';
    s.children = G.map((sp, i) => ({id:idf(i), type:'bezier', anchors:sp.anchors, closed:!!sp.closed, fill:'none', stroke:'none', strokeWidth:0}));
  } else { s.type = 'bezier'; s.anchors = G.length ? G[0].anchors : []; s.closed = G.length ? !!G[0].closed : false; }
  return s;
}
function forEachLeaf(s, f){ if (s.type === 'group' && Array.isArray(s.children)) s.children.forEach(c => forEachLeaf(c, f)); else if (LEAF.includes(s.type) || s.type === 'compound') f(s); }
const treeBounds = s => { let r = null; forEachLeaf(s, l => { const gm = geomOf(l); if (gm) r = unionB(r, boundsG(gm.G)); }); return r; };
/* reshape.rs:200 reshape_leaves：编组上的几何效果把所有成员当一整块（每个效果用整块的外框） */
function reshapeLeaves(gr, fx, idf){
  for (const e of fx){
    const b = treeBounds(gr); if (!b) break;
    const p = merged(e.id, e.params);
    forEachLeaf(gr, leaf => {
      const gm = geomOf(leaf); if (!gm) return;
      const r = applyOne(e.id, p, gm.G, b, {strokeWidth:hasStroke(leaf) ? leaf.strokeWidth : null, rule:gm.rule});
      if (okG(r)) setGeometry(leaf, r, gm.rule, i => idf(leaf.id + '_' + i));
    });
  }
}

/* ═════════════ 效果 ▸ 路径查找器（group.rs:97 pathfinder_children ＋ pathfinder.rs:87）═════════════ */
const topmost = m => m.lastIndexOf(true);
function visLeaves(s, out){ if (!s || s.visible === false) return out; if (s.type === 'group') (s.children || []).forEach(c => visLeaves(c, out)); else if ((LEAF.includes(s.type) && !s.clipping) || s.type === 'compound') out.push(s); return out; }
function fillPolys(s){ const gm = geomOf(s); return gm ? {polys:gm.G.map(sp => AO().flatten(sp, 0.05)).filter(L => L.length >= 2), rule:gm.rule} : {polys:[], rule:'nonzero'}; }
const polyArea = Pp => { let a = 0; for (let i = 0; i < Pp.length; i++){ const p = Pp[i], q = Pp[(i + 1) % Pp.length]; a += p[0]*q[1] - q[0]*p[1]; } return a / 2; };
function inPoly(q, Pp){ let c = false; for (let i = 0, j = Pp.length - 1; i < Pp.length; j = i++){ const a = Pp[i], b = Pp[j]; if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
/* 一组边界环分成一块一块（外环＋它里面的洞；Contours::grouped） */
function faces(loops){
  if (loops.length <= 1) return loops.length ? [loops] : [];
  const A = loops.map(polyArea); let big = 0; A.forEach((a, i) => { if (Math.abs(a) > Math.abs(A[big])) big = i; });
  const sg = Math.sign(A[big]), outers = [], holes = [];
  loops.forEach((L, i) => (Math.sign(A[i]) === sg ? outers : holes).push(i));
  const F = outers.map(i => [loops[i]]);
  for (const h of holes){
    const q = loops[h][0]; let best = -1, ba = Infinity;
    outers.forEach((o, k) => { if (Math.abs(A[o]) < ba && inPoly(q, loops[o])) { best = k; ba = Math.abs(A[o]); } });
    if (best >= 0) F[best].push(loops[h]); else F.push([loops[h]]);
  }
  return F;
}
/* Pathfinder Outline（pathfinder.rs:268 outline_edges）：每个形状的边界在交点处切开成开放路径，重叠的留最前面那个的 */
function outlineEdges(shapes){
  const E = [];
  shapes.forEach((S, si) => S.polys.forEach((Pp, pi) => { for (let i = 0; i < Pp.length; i++) E.push({a:Pp[i], b:Pp[(i + 1) % Pp.length], si, pi, i, ts:[]}); }));
  const cross = (u, v) => u[0]*v[1] - u[1]*v[0];
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++){
    const e = E[i], f = E[j];
    if (e.si === f.si && e.pi === f.pi && (Math.abs(e.i - f.i) <= 1 || Math.abs(e.i - f.i) === shapes[e.si].polys[e.pi].length - 1)) continue;   // 同一环的相邻边共端点，不算交点
    if (Math.max(e.a[0], e.b[0]) < Math.min(f.a[0], f.b[0]) - 1e-9 || Math.max(f.a[0], f.b[0]) < Math.min(e.a[0], e.b[0]) - 1e-9) continue;
    if (Math.max(e.a[1], e.b[1]) < Math.min(f.a[1], f.b[1]) - 1e-9 || Math.max(f.a[1], f.b[1]) < Math.min(e.a[1], e.b[1]) - 1e-9) continue;
    const r = sub(e.b, e.a), s = sub(f.b, f.a), den = cross(r, s); if (Math.abs(den) < 1e-12) continue;
    const qp = sub(f.a, e.a), t = cross(qp, s) / den, u = cross(qp, r) / den;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
    e.ts.push(clamp(t, 0, 1)); f.ts.push(clamp(u, 0, 1));
  }
  const chains = [];
  let k = 0;
  shapes.forEach((S, si) => S.polys.forEach(Pp => {
    const n = Pp.length, pieces = [];
    for (let i = 0; i < n; i++, k++){
      const e = E[k], ts = e.ts.slice().sort((x, y) => x - y);
      const startJ = ts.length && ts[0] < 1e-9;
      const cuts = [0].concat(ts.filter(t => t > 1e-9 && t < 1 - 1e-9), [1]).filter((t, idx, arr) => idx === 0 || t - arr[idx - 1] > 1e-9);
      for (let w = 0; w + 1 < cuts.length; w++) pieces.push({a:lerp(e.a, e.b, cuts[w]), b:lerp(e.a, e.b, cuts[w + 1]), brk:w === 0 ? startJ : true});
    }
    const first = pieces.findIndex(x => x.brk);
    if (first < 0){ chains.push({pts:pieces.map(x => x.a).concat([pieces.length ? pieces[0].a : null]).filter(Boolean), key:si}); return; }
    const rot = pieces.slice(first).concat(pieces.slice(0, first));
    let cur = [];
    for (const x of rot){ if (x.brk && cur.length){ chains.push({pts:cur.map(y => y.a).concat([cur[cur.length - 1].b]), key:si}); cur = []; } cur.push(x); }
    if (cur.length) chains.push({pts:cur.map(y => y.a).concat([cur[cur.length - 1].b]), key:si});
  }));
  const mid = pts => { let tot = 0; for (let i = 1; i < pts.length; i++) tot += dist(pts[i - 1], pts[i]); let acc = 0; for (let i = 1; i < pts.length; i++){ const l = dist(pts[i - 1], pts[i]); if (acc + l >= tot / 2 && l > 0) return lerp(pts[i - 1], pts[i], (tot / 2 - acc) / l); acc += l; } return pts[0]; };
  const near = (p, q) => dist(p, q) <= 1e-3, out = [];
  for (const c of chains){
    if (c.pts.length < 2) continue;
    const a = c.pts[0], b = c.pts[c.pts.length - 1], m = mid(c.pts);
    const hit = out.find(o => { const a2 = o.pts[0], b2 = o.pts[o.pts.length - 1]; return near(m, mid(o.pts)) && ((near(a, a2) && near(b, b2)) || (near(a, b2) && near(b, a2))); });
    if (hit) hit.key = c.key; else out.push(c);
  }
  return out.map(c => ({loops:[c.pts], key:c.key, open:true}));
}
/* pathfinder.rs:87 pathfinder：shapes = [{polys, rule}]（后→前）→ [{loops, key（来源索引）, open?}] */
function pathfinder(op, shapes){
  const n = shapes.length; if (!n) return [];
  const O = AO(), sets = shapes.map(s => ({polys:s.polys, rule:s.rule}));
  const arr = pred => O.arrangement(sets, pred);
  const one = (loops, key) => loops.length ? [{loops, key}] : [];
  switch (op){
    case 'unite': return one(arr(m => m.some(Boolean)), n - 1);
    case 'minusFront': return one(arr(m => m[0] && !m.slice(1).some(Boolean)), 0);
    case 'minusBack': return one(arr(m => m[n - 1] && !m.slice(0, n - 1).some(Boolean)), n - 1);
    case 'intersect': return one(arr(m => m.every(Boolean)), n - 1);
    case 'exclude': return one(arr(m => m.filter(Boolean).length % 2 === 1), n - 1);
    case 'divide': {
      // 先跑一遍只记下「出现过的覆盖组合」（每条边两侧的组合），再每个组合各取一次边界、分成一块块
      const masks = new Map(); arr(m => { if (m.some(Boolean)) masks.set(m.map(Number).join(''), m.slice()); return false; });
      const out = [];
      for (const [key, K] of masks){ const loops = arr(m => m.map(Number).join('') === key); faces(loops).forEach(F => out.push({loops:F, key:topmost(K)})); }
      return out;
    }
    case 'trim': { const out = []; for (let i = 0; i < n; i++) out.push(...one(arr(m => topmost(m) === i), i)); return out; }
    case 'merge': { const out = []; for (let i = 0; i < n; i++) faces(arr(m => topmost(m) === i)).forEach(F => out.push({loops:F, key:i})); return out; }   // 原码 key＝来源索引（每个来源各算各的），所以跟修边一样、只是分块
    case 'crop': { if (n < 2) return []; const out = []; for (let i = 0; i < n - 1; i++) out.push(...one(arr(m => m[n - 1] && topmost(m.slice(0, n - 1)) === i), i)); return out; }
    case 'outline': return outlineEdges(shapes);
  }
  return [];
}
/* group.rs:82 styled：结果路径照来源的外观；外框模式＝描边 1pt、颜色取填色（没填色取描边色） */
function styled(src, loops, outline, open, id){
  const base = {id, fill:clone(src.fill === undefined ? 'none' : src.fill), stroke:clone(src.stroke === undefined ? 'none' : src.stroke), strokeWidth:src.strokeWidth || 0};
  if (outline){ base.stroke = painted(src.fill) ? clone(src.fill) : clone(src.stroke); base.strokeWidth = 1; base.fill = 'none'; }
  // 其余外观跟着来源走（多层填色／描边、接合、端点、斜接、虚线、对齐描边）：编组里给某个成员加的白描边，合并＋圆角之后照样描在那一块上
  else ['apStack', 'join', 'cap', 'miterLimit', 'dash', 'strokeAlign'].forEach(k => { if (src[k] !== undefined) base[k] = clone(src[k]); });
  const G = loops.map(L => poly(L, !open));
  const s = Object.assign({type:'bezier'}, base);
  return setGeometry(s, G, 'nonzero', i => id + '_' + i);
}
const SHAPE_MODES = ['unite', 'minusFront', 'intersect', 'exclude', 'minusBack'];
function pathfinderChildren(children, pf, idf){
  let stack = children;
  for (const e of pf){
    const op = PF_OP[e.id]; if (!op) continue;
    const shapeMode = SHAPE_MODES.includes(op), shapes = [], sources = [];
    for (const c of stack){
      const lv = visLeaves(c, []);
      if (shapeMode && lv.length > 1){
        const parts = lv.map(fillPolys), polys = AO().arrangement(parts, m => m.some(Boolean));   // unite_all
        shapes.push({polys, rule:'nonzero'}); sources.push(lv[lv.length - 1]);
      } else lv.forEach(l => { const fp = fillPolys(l); if (fp.polys.length){ shapes.push(fp); sources.push(l); } });
    }
    if (!shapes.length) return [];
    stack = pathfinder(op, shapes).filter(r => r.loops.length).map((r, i) => styled(sources[r.key], r.loops, op === 'outline', !!r.open, idf('pf' + i)));
  }
  return stack;
}

/* ═════════════ 裁剪标记（marks.rs:21 crop_marks_art ＋ doc/src/marks.rs:74 TrimMarks::lines）═════════════ */
function trimLines(r, o){
  const l = o.length, out = [], corners = [[r.x0, r.y0, -1, -1], [r.x1, r.y0, 1, -1], [r.x1, r.y1, 1, 1], [r.x0, r.y1, -1, 1]];
  if (o.style === 'japanese'){
    const b = o.bleed;
    for (const [x, y, sx, sy] of corners) out.push([[x + sx*b, y], [x + sx*(b + l), y]], [[x, y + sy*b], [x, y + sy*(b + l)]], [[x, y + sy*b], [x + sx*(b + l), y + sy*b]], [[x + sx*b, y], [x + sx*b, y + sy*(b + l)]]);
    const c = bc(r);
    for (const [q, dx, dy] of [[[c[0], r.y0], 0, -1], [[r.x1, c[1]], 1, 0], [[c[0], r.y1], 0, 1], [[r.x0, c[1]], -1, 0]]){
      const at = d => [q[0] + dx*d, q[1] + dy*d], m = at(b + l/2);
      out.push([at(b), at(b + l)], [[m[0] - dy*l/2, m[1] - dx*l/2], [m[0] + dy*l/2, m[1] + dx*l/2]]);
    }
  } else for (const [x, y, sx, sy] of corners) out.push([[x + sx*o.offset, y], [x + sx*(o.offset + l), y]], [[x, y + sy*o.offset], [x, y + sy*(o.offset + l)]]);
  return out;
}
/* 有裁剪标记的物件画成：编组 [物件本身（拿掉裁剪标记效果）, 标记线]，标记围着物件的可见外框（含描边） */
function cropArt(s, idf){
  const fx = s.effects.filter(e => e && e.visible !== false && e.id === 'cropMarks'), last = fx[fx.length - 1];
  const obj = clone(s); obj.effects = s.effects.filter(e => !(e && e.id === 'cropMarks')); if (!obj.effects.length) delete obj.effects;
  const inner = artOf(obj, idf), r0 = window.AIObj ? AIObj.shapeBounds(inner, q => q, true) : treeBounds(inner);
  const style = text(last.params, 'style', 'roman').toLowerCase() === 'japanese' ? 'japanese' : 'roman';
  const marks = r0 ? trimLines(r0, {style, offset:9, length:18, bleed:3 * 72 / 25.4}).map(([a, b], i) => ({id:idf('m' + i), type:'line', points:[a, b], closed:false, fill:'none', stroke:'#000000', strokeWidth:0.3})) : [];
  const gr = {id:s.id, type:'group', children:[obj, {id:idf('marks'), type:'group', name:'Crop Marks', children:marks}]};
  if (s.name) gr.name = s.name;
  return gr;
}

/* ═════════════ 求值：一个有效果的形状 → 不带（几何／路径查找器）效果的「成品」形状 ═════════════
   group.rs:239 evaluate_container：编组先跑路径查找器、再把几何效果套在全部成员上；路径／复合路径直接套几何效果。点阵效果另外画（见 rasterPaint） */
function artOf(s, idf){
  if (visFx(s).some(e => e.id === 'cropMarks')) return cropArt(s, idf);
  const fx = visFx(s), geo = fx.filter(e => isGeometry(e.id)), pf = fx.filter(e => isPathfinder(e.id));
  const base = clone(s); delete base.effects;
  if (s.type === 'group'){
    if (pf.length && !s.clip) base.children = pathfinderChildren(base.children || [], pf, idf);
    if (geo.length) reshapeLeaves(base, geo, idf);
    return base;
  }
  const gm = geomOf(s);
  if (!gm || !geo.length) return base;
  const G = applyGeometry(geo, gm.G, boundsG(gm.G), {strokeWidth:hasStroke(s) ? s.strokeWidth : null, rule:gm.rule});
  return setGeometry(base, G, gm.rule, i => idf(s.id + '_' + i));
}
/* 快取：形状 JSON 没变就用上次算好的成品（拖曳、缩放视角都不重算） */
const artCache = new Map();
function cachedArt(s){
  const key = JSON.stringify(s), hit = artCache.get(s.id);
  if (hit && hit.key === key) return hit.art;
  const art = artOf(s, k => s.id + '_fx_' + k);      // 渲染用的临时 id（不占 uid 流水号）
  if (artCache.size > 800) artCache.clear();
  artCache.set(s.id, {key, art});
  return art;
}
/* raster.rs:85 raster_effects：可见的点阵效果，按堆叠顺序 */
function rasterList(s){
  if (visFx(s).some(e => e.id === 'cropMarks')) return [];                 // fx.rs:388 有裁剪标记时由里面的物件自己画
  return visFx(s).filter(e => isRaster(e.id)).map(e => {
    const p = merged(e.id, e.params), blur = clamp(num(p, 'blur', 5), 0, 1000), op = clamp(num(p, 'opacity', 75) / 100, 0, 1);
    const color = d => (typeof p.color === 'string' && /^#?[0-9a-f]{3,8}$/i.test(p.color)) ? (p.color[0] === '#' ? p.color : '#' + p.color)
                     : (Array.isArray(p.color) && p.color.length >= 3) ? `rgb(${p.color.slice(0, 3).map(v => Math.round(clamp(+v || 0, 0, 1) * 255)).join(',')})` : d;
    switch (e.id){
      case 'stylize.dropShadow': return {kind:'shadow', mode:text(p, 'mode', 'multiply'), opacity:op, dx:clamp(num(p, 'x', 7), -1e4, 1e4), dy:clamp(num(p, 'y', 7), -1e4, 1e4), blur, color:color('#000000')};
      case 'stylize.outerGlow': return {kind:'shadow', mode:text(p, 'mode', 'screen'), opacity:op, dx:0, dy:0, blur, color:color('#ffff00')};
      case 'stylize.innerGlow': return {kind:'inner', mode:text(p, 'mode', 'screen'), opacity:op, blur, color:color('#ffffff'), center:text(p, 'source', 'edge').toLowerCase() === 'center'};
      case 'stylize.feather': return {kind:'feather', radius:clamp(num(p, 'radius', 5), 0, 1000)};
      default: return {kind:'blur', radius:clamp(num(p, 'radius', 5), 0, 1000)};
    }
  });
}

/* ═════════════ 画：点阵效果（render/src/fx.rs:475 raster_fx）═════════════ */
const BLEND_NAMES = {normal:'source-over', multiply:'multiply', screen:'screen', overlay:'overlay', darken:'darken', lighten:'lighten', colordodge:'color-dodge', colorburn:'color-burn',
  hardlight:'hard-light', softlight:'soft-light', difference:'difference', exclusion:'exclusion', hue:'hue', saturation:'saturation', color:'color', luminosity:'luminosity'};
const blendCss = m => BLEND_NAMES[String(m || '').toLowerCase().replace(/[^a-z]/g, '')] || 'source-over';   // raster.rs:62 blend_mode（不认识＝一般）
function path2D(G, S){
  const p = new Path2D();
  for (const sp of G){
    const A = sp.anchors; if (!A.length) continue;
    p.moveTo(A[0].x*S, A[0].y*S);
    const sg = (a, b) => { if (!a.out && !b.in) p.lineTo(b.x*S, b.y*S); else { const c1 = hOut(a), c2 = hIn(b); p.bezierCurveTo(c1[0]*S, c1[1]*S, c2[0]*S, c2[1]*S, b.x*S, b.y*S); } };
    for (let i = 1; i < A.length; i++) sg(A[i - 1], A[i]);
    if (sp.closed && A.length >= 2){ sg(A[A.length - 1], A[0]); p.closePath(); }
  }
  return p;
}
/* 成品的轮廓（羽化、内发光裁在里面）：路径＝自己；编组＝全部成员（非零） */
function outlineOf(art, S){
  const gm = geomOf(art);
  if (gm) return {path:path2D(gm.G, S), rule:gm.rule};
  if (art.type === 'group'){ const G = []; forEachLeaf(art, l => { const m = geomOf(l); if (m) G.push(...m.G); }); return G.length ? {path:path2D(G, S), rule:'nonzero'} : null; }
  return null;
}
function rasterPaint(ctx, S, rfx, outline, paint){
  const W = ctx.canvas.width, H = ctx.canvas.height, Tm = ctx.getTransform();
  const k = Math.sqrt(Math.abs(Tm.a*Tm.d - Tm.b*Tm.c)) || 1;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.setTransform(Tm); return [c, x]; };
  const [cc, cx] = mk(); paint(cx);                                             // 内容（物件本身）
  const px = d => d * S * k;                                                    // 文件单位 → 装置像素
  const vec = (dx, dy) => [Tm.a*dx*S + Tm.c*dy*S, Tm.b*dx*S + Tm.d*dy*S];
  const blur = (src, sigma) => { const [c, x] = mk(); x.setTransform(1, 0, 0, 1, 0, 0); if (sigma > 0.05) x.filter = `blur(${sigma}px)`; x.drawImage(src, 0, 0); return c; };
  const tint = (src, color) => { const [c, x] = mk(); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(src, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, W, H); return c; };
  const clipTo = (src) => { if (!outline) return src; const [c, x] = mk(); x.clip(outline.path, outline.rule); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(src, 0, 0); return c; };
  const blit = (src, o) => {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= (o && o.alpha !== undefined) ? o.alpha : 1;
    ctx.globalCompositeOperation = (o && o.mode) ? blendCss(o.mode) : 'source-over';
    if (o && o.blur > 0.05) ctx.filter = `blur(${o.blur}px)`;
    ctx.drawImage(src, o && o.off ? o.off[0] : 0, o && o.off ? o.off[1] : 0);
    ctx.restore();
  };
  // ① 底下：投影、外发光（剪影染色、模糊 σ＝blur/2、乘不透明度、混合模式；位移移的是内容）
  for (const f of rfx) if (f.kind === 'shadow') blit(tint(cc, f.color), {alpha:f.opacity, mode:f.mode, blur:px(f.blur / 2), off:vec(f.dx, f.dy)});
  // ② 内容：羽化（先模糊再裁回轮廓）／高斯模糊；图层由外往里推，所以由最后一个效果往前套
  let img = cc;
  for (const f of rfx.slice().reverse()){
    if (f.kind === 'feather' && f.radius > 0){ img = blur(img, px(f.radius / 2)); img = clipTo(img); }
    else if (f.kind === 'blur' && f.radius > 0) img = blur(img, px(f.radius / 2));
  }
  blit(img);
  // ③ 上面：内发光，裁在轮廓里（边缘＝外面那一圈的剪影往里渗；中心＝形状本身）
  if (!outline) return;
  for (const f of rfx){
    if (f.kind !== 'inner') continue;
    const [gc, gx] = mk(); gx.fillStyle = '#000';
    if (f.center) gx.fill(outline.path, outline.rule);
    else { gx.save(); gx.setTransform(1, 0, 0, 1, 0, 0); gx.fillRect(0, 0, W, H); gx.restore(); gx.globalCompositeOperation = 'destination-out'; gx.fill(outline.path, outline.rule); }
    blit(clipTo(blur(tint(gc, f.color), px(f.blur / 2))), {alpha:f.opacity, mode:f.mode});
  }
}
function drawFx(ctx, s, S){
  let art;
  try { art = cachedArt(s); } catch (e){ console.error('ai.effect', e); const b = clone(s); delete b.effects; return window.drawShape(ctx, b, S); }   // 算坏了就画原形状
  const rfx = rasterList(s);
  if (!rfx.length) return window.drawShape(ctx, art, S);
  rasterPaint(ctx, S, rfx, outlineOf(art, S), c => window.drawShape(c, art, S));
}
const hasFx = s => !!s && s.visible !== false && visFx(s).length > 0;

/* SVG 导出：几何效果画成路径；投影／外发光／高斯模糊用 SVG 滤镜（羽化、内发光 SVG 版不画——原码 svg/export.rs 也是另外处理） */
function svgFx(s, orig){
  const art = cachedArt(s), body = orig(art), rfx = rasterList(s);
  if (!rfx.length) return body;
  let out = body;
  rfx.forEach((f, i) => {
    const id = `${s.id}_fx${i}`;
    if (f.kind === 'shadow') out = `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${f.dx}" dy="${f.dy}" stdDeviation="${f.blur / 2}" flood-color="${f.color}" flood-opacity="${f.opacity}"/></filter><g filter="url(#${id})">${out}</g>`;
    else if (f.kind === 'blur') out = `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${f.radius / 2}"/></filter><g filter="url(#${id})">${out}</g>`;
  });
  return out;
}

/* 接到渲染：包 ObjRender（engine drawShape／toSVG 都先问它）；ai-object.js 没载入就退回包 drawShape */
function installHook(){
  const R = window.ObjRender;
  if (R && !R.__aiFx){
    R.__aiFx = true;
    const h0 = R.handles, d0 = R.draw, s0 = R.toSVG;
    R.handles = function(s){ return hasFx(s) || h0.call(this, s); };
    R.draw = function(ctx, s, S){ if (hasFx(s)) return drawFx(ctx, s, S, (c, x, k) => d0.call(R, c, x, k)); return d0.call(this, ctx, s, S); };
    R.toSVG = function(s){ if (hasFx(s)) return svgFx(s, x => s0.call(R, x)); return s0.call(this, s); };
  } else if (!R && typeof drawShape === 'function' && !drawShape.__aiFx){
    const orig = drawShape;
    const w = function(ctx, s, S){ if (hasFx(s)) return drawFx(ctx, s, S, orig); return orig(ctx, s, S); };
    w.__aiFx = true; w.toString = () => String(orig);
    window.drawShape = w;
  }
}
installHook();

/* ═════════════ 文档栅格效果设置（rasterfx.rs）——存在 Doc.aiRasterFx，进历史与工程档 ═════════════ */
const RFX_DEFAULT = () => ({resolution:72, colorModel:'rgb', background:'transparent', antiAlias:true, clippingMask:false, addAround:0, preserveSpotColors:true});
const rfxSettings = () => Object.assign(RFX_DEFAULT(), Doc.aiRasterFx || {});
const has = (f, re) => re.test(String(f));
if (!History.__aiFxHook && !has(History.snap, /aiRasterFx/)){
  History.__aiFxHook = true;
  const snap = History.snap;
  History.snap = function(){ const s = snap.apply(this, arguments); s.aiRasterFx = Doc.aiRasterFx ? clone(Doc.aiRasterFx) : null; return s; };
  ['restore', 'restoreInPlace'].forEach(k => { const o = History[k]; History[k] = function(s){ const r = o.apply(this, arguments); if (s && 'aiRasterFx' in s) Doc.aiRasterFx = s.aiRasterFx ? clone(s.aiRasterFx) : undefined; return r; }; });
}
if (!Doc.__aiFxHook){
  Doc.__aiFxHook = true;
  const reset = Doc.reset;
  Doc.reset = function(){ Doc.aiRasterFx = undefined; artCache.clear(); return reset.apply(this, arguments); };
}
if (!Project.__aiFxHook && !has(Project.serialize, /aiRasterFx/)){
  Project.__aiFxHook = true;
  const ser = Project.serialize, load = Project.load;
  Project.serialize = function(){ const o = ser.apply(this, arguments); if (Doc.aiRasterFx) o.aiRasterFx = clone(Doc.aiRasterFx); return o; };
  Project.load = async function(json){ const r = await load.apply(this, arguments); Doc.aiRasterFx = (json && json.aiRasterFx) ? clone(json.aiRasterFx) : undefined; return r; };
}
/* rastersettings.rs:70 finish_pixels（我们的 ImageData 是直通色、不是预乘：灰度＝直通色的 Rec.709 明度；点阵＝明度 ≥ 一半；白底＝叠在白上） */
function finishPixels(ctx, W, H, st){
  const white = st.background === 'white', model = st.colorModel;
  if ((model === 'rgb' || model === 'document') && !white) return;
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4){
    const a = d[i + 3];
    if (model !== 'rgb' && model !== 'document' && a !== 0){
      let y = 0.2126*d[i] + 0.7152*d[i + 1] + 0.0722*d[i + 2];
      y = model === 'bitmap' ? (y >= 127.5 ? 255 : 0) : Math.round(y);
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    if (white && !(st.clippingMask && a === 0)){ const al = a / 255; for (let c = 0; c < 3; c++) d[i + c] = Math.round(d[i + c] * al + 255 * (1 - al)); d[i + 3] = 255; }
  }
  ctx.putImageData(img, 0, 0);
}

/* ═════════════ 命令 ═════════════ */
const reg = (id, meta, fn) => CMD.reg(id, Object.assign({i18n:''}, meta), p => fn(p || {}));
const done = (L, extra) => { Layer.invalidate(L); return Object.assign({ok:true}, extra || {}); };
/* effectcmd.rs appearance_targets：选中的物件（锁住／藏起来的不算）；ids 指定就用 ids */
function targets(p, C){
  const L = p.layerId ? Doc.byId(p.layerId) : ((window.VecSel && VecSel.layer()) || Doc.active());
  if (!L || L.kind !== 'vector') return {err:{ok:false, error:C + ': select objects on a vector layer'}};
  const want = Array.isArray(p.ids) ? p.ids : ((window.VecSel && VecSel.layerId === L.id) ? VecSel.shapes : []);
  const R = L.data.shapes.filter(s => want.includes(s.id) && !s.locked && s.visible !== false);
  if (!R.length) return {err:{ok:false, error:C + ': select objects'}};
  return {L, R};
}
const AiFx = {last:null};
const PARAM_KEYS = new Set(); Object.values(CAT).forEach(c => Object.keys(c.defaults).forEach(k => PARAM_KEYS.add(k))); PARAM_KEYS.add('width'); PARAM_KEYS.add('style');
/* 平铺的参数也收（agent 方便）：{radius:8} 跟 {params:{radius:8}} 一样 */
function paramsFrom(p){ const o = {}; for (const k of Object.keys(p)) if (PARAM_KEYS.has(k) && !['ids', 'layerId', 'effect'].includes(k)) o[k] = p[k]; return Object.assign(o, (p.params && typeof p.params === 'object') ? p.params : {}); }

function apply(p){
  const C = 'ai.effect.apply';
  const id = p.effect || p.id;
  if (!id) return {ok:false, error:C + ': missing `effect` id'};
  if (!CAT[id]) return {ok:false, error:C + ': unknown effect `' + id + '`'};
  if (p.params != null && typeof p.params !== 'object') return {ok:false, error:C + ': `params` must be an object'};
  const t = targets(p, C); if (t.err) return t.err;
  const params = clone(p.params || {});
  if (id === 'cropMarks' && !params.style) params.style = 'roman';            // effectcmd.rs:128 套用时从偏好取（我们没这偏好＝罗马式）
  const e = {id, params:merged(id, params), visible:true};
  t.R.forEach(s => { (s.effects = Array.isArray(s.effects) ? s.effects : []).push(clone(e)); });
  return done(t.L, {ids:t.R.map(s => s.id), index:t.R[0].effects.length - 1});
}
reg('ai.effect.apply', {undoable:true, params:'{effect: id（见 ai.effect.list，例 "stylize.dropShadow"、"distort.roughen"、"warp.arc"、"pathfinder.add"、"cropMarks"）, params?: {…}（缺的键取对话框预设）, ids?: [形状 id…]（缺省＝目前选取）, layerId?} 照 effect.apply：在每个选中物件的效果堆叠最后加一个「活」效果（非破坏性，随时 ai.effect.setParams／remove 改掉）→ {ok, ids, index}'}, apply);
reg('ai.effect.list', {params:'{} 照 effect.list → {catalog:[{id, label, menu, params, defaults, raster}], applied:[{id, effects}]}（applied＝目前选取的效果堆叠）'}, p => {
  const catalog = Object.values(CAT).map(c => clone(c)), t = targets(p, 'ai.effect.list');
  return {ok:true, catalog, applied:t.err ? [] : t.R.map(s => ({id:s.id, effects:clone(s.effects || [])}))};
});
function editFx(p, C, none, f){
  const t = targets(p, C); if (t.err) return t.err;
  const ids = []; t.R.forEach(s => { if (Array.isArray(s.effects) && f(s.effects, s)) ids.push(s.id); });
  if (!ids.length) return {ok:false, error:none};
  t.R.forEach(s => { if (Array.isArray(s.effects) && !s.effects.length) delete s.effects; });
  return done(t.L, {ids});
}
const idx = (p, k) => (Number.isInteger(p[k]) && p[k] >= 0) ? p[k] : null;
reg('ai.effect.remove', {undoable:true, params:'{index: int（效果堆叠里的位置）, ids?, layerId?} 照 effect.remove → {ok, ids}'}, p => {
  const i = idx(p, 'index'); if (i === null) return {ok:false, error:'ai.effect.remove: `index` must be a non-negative integer'};
  return editFx(p, 'ai.effect.remove', 'ai.effect.remove: no effect at index ' + i, fx => i < fx.length && !!fx.splice(i, 1).length);
});
reg('ai.effect.setParams', {undoable:true, params:'{index: int, params?: {…}（并进现有参数）, visible?: bool, ids?, layerId?} 照 effect.setParams（效果选项）→ {ok, ids}'}, p => {
  const i = idx(p, 'index'); if (i === null) return {ok:false, error:'ai.effect.setParams: `index` must be a non-negative integer'};
  if (p.params != null && typeof p.params !== 'object') return {ok:false, error:'ai.effect.setParams: `params` must be an object'};
  return editFx(p, 'ai.effect.setParams', 'ai.effect.setParams: no effect at index ' + i, fx => {
    const e = fx[i]; if (!e) return false;
    if (p.params) e.params = Object.assign((e.params && typeof e.params === 'object') ? e.params : merged(e.id, null), clone(p.params));
    if (typeof p.visible === 'boolean') e.visible = p.visible;
    return true;
  });
});
reg('ai.effect.duplicate', {undoable:true, params:'{index: int, ids?, layerId?} 照 effect.duplicate：在它后面插一份拷贝 → {ok, ids}'}, p => {
  const i = idx(p, 'index'); if (i === null) return {ok:false, error:'ai.effect.duplicate: `index` must be a non-negative integer'};
  return editFx(p, 'ai.effect.duplicate', 'ai.effect.duplicate: no effect at index ' + i, fx => { if (!fx[i]) return false; fx.splice(i + 1, 0, clone(fx[i])); return true; });
});
reg('ai.effect.move', {undoable:true, params:'{from: int, to: int（搬完后在第几个）, copy?: bool（拷贝不搬，＝按 Alt 拖）, ids?, layerId?} 照 effect.move（只有物件本身一个效果堆叠：我们的外观没有多重填色／描边）→ {ok, ids}'}, p => {
  const a = idx(p, 'from'), b = idx(p, 'to'); if (a === null || b === null) return {ok:false, error:'ai.effect.move: `from` and `to` must be non-negative integers'};
  return editFx(p, 'ai.effect.move', 'ai.effect.move: no effect at index ' + a, fx => { if (a >= fx.length) return false; const e = p.copy ? clone(fx[a]) : fx.splice(a, 1)[0]; fx.splice(Math.min(b, fx.length), 0, e); return true; });
});
/* 每个效果一条（＝effect.apply {effect}），菜单上没对话框的项（路径查找器、轮廓化描边、裁剪标记）接这条 */
Object.keys(CAT).forEach(id => {
  reg('ai.effect.' + id, {undoable:true, params:`{params?: ${CAT[id].params}（也可以平铺写）, ids?, layerId?} ＝ ai.effect.apply {effect:"${id}"}（${CAT[id].label}）`},
    p => apply(Object.assign({}, p, {effect:id, params:paramsFrom(p)})));
});

/* ── 扩展外观（effectcmd.rs:324 expand_node；对象菜单那一项的原码 id 就是 effect.expandAppearance）── */
function tidyG(G){
  const O = window.AIObj;
  return G.map(sp => (O && sp.closed && sp.anchors.length > 12 && sp.anchors.every(a => !a.in && !a.out)) ? (O.tidyLoop(sp.anchors.map(P)) || sp) : sp)
          .map(sp => ({anchors:sp.anchors.map(a => ({x:a.x, y:a.y, in:a.in || null, out:a.out || null})), closed:!!sp.closed}));
}
/* 描边变成自己的物件（outline 成填色），填色留一份：编组 [填色, 描边轮廓]（effectcmd 的 expand_leaf：每个填色、描边各成一个物件） */
function splitStroke(m){
  if (!hasStroke(m) || !geomOf(m)) return m;
  const O = AO(), gm = geomOf(m), pieces = [];
  gm.G.forEach(sp => { if (sp.anchors.length > 1) pieces.push(...O.strokePieces(O.flatten(sp, 0.02), !!sp.closed, m.strokeWidth, 'round', 'round', 4)); });
  const loops = pieces.length ? O.arrangement([{polys:pieces, rule:'nonzero'}], q => q[0]) : [];
  const parts = [];
  if (painted(m.fill)){ const f = clone(m); f.id = uid('S'); f.stroke = 'none'; f.strokeWidth = 0; delete f.name; parts.push(f); }
  if (loops.length){ const o = setGeometry({id:uid('S'), fill:clone(m.stroke), stroke:'none', strokeWidth:0}, tidyG(loops.map(L => poly(L, true))), 'nonzero', () => uid('S')); parts.push(o); }
  if (!parts.length) return m;
  return parts.length === 1 ? Object.assign(parts[0], {id:m.id}) : {id:m.id, type:'group', children:parts};
}
function expandShape(s){
  const all = Array.isArray(s.effects) ? s.effects : [];
  const vis = all.filter(e => e && e.visible !== false && CAT[e.id]);
  const keepRaster = vis.filter(e => isRaster(e.id));
  if (!all.length) { if (s.type === 'group') { let ch = false; s.children = (s.children || []).map(c => { const r = expandShape(c); if (r !== c) ch = true; return r; }); return ch ? s : s; } return s; }
  if (all.length === keepRaster.length) return s;                                // 只有点阵效果：原码做成内嵌图，我们矢量层放不了图 ⇒ 保持活的
  const idf = k => uid('S');
  let m;
  if (vis.some(e => e.id === 'cropMarks')){
    const g0 = cropArt(Object.assign(clone(s), {effects:vis}), idf);
    g0.children[0] = expandShape(Object.assign(g0.children[0], {id:uid('S')}));
    return g0;
  }
  m = artOf(Object.assign(clone(s), {effects:vis.filter(e => !isRaster(e.id))}), idf);
  m.id = s.id;
  if (m.type === 'group') m.children = (m.children || []).map(c => expandShape(c));
  else {
    const gm = geomOf(m); if (gm) setGeometry(m, tidyG(gm.G), gm.rule, () => uid('S'));
    if (vis.length) m = splitStroke(m);
  }
  if (keepRaster.length) m.effects = clone(keepRaster);
  return m;
}
reg('ai.effect.expandAppearance', {undoable:true, params:'{ids?, layerId?} 照 effect.expandAppearance（对象 ▸ 扩展外观）：几何效果、路径查找器效果烘成真的路径（活形状变路径），描边轮廓化成自己的物件、跟填色编组；裁剪标记变成「物件＋标记线」编组；藏起来的效果丢掉。' +
  '点阵效果（投影／发光／羽化／模糊）原码是做成内嵌图，我们的矢量层放不了图 ⇒ 留着当活效果。→ {ok, ids}'}, p => {
  const t = targets(p, 'ai.effect.expandAppearance'); if (t.err) return t.err;
  const S = t.L.data.shapes, out = [];
  for (const s of t.R){
    const i = S.indexOf(s), before = JSON.stringify(s);
    const r = expandShape(clone(s));
    if (JSON.stringify(r) !== before){ S[i] = r; out.push(r.id); }
  }
  if (!out.length) return {ok:false, error:'Expand Appearance: the selection has a basic appearance'};
  if (window.VecSel) VecSel.setShapes(t.L.id, out);
  return done(t.L, {ids:out});
});

/* ── 文档栅格效果设置（rasterfx.rs:97 settings）：没给参数＝只回目前设定；有改才进历史 ── */
function rfxCommand(p){
  const C = 'ai.document.rasterEffectsSettings', st = rfxSettings();
  const bad = m => ({ok:false, error:C + ': ' + m});
  const flagv = (k, v) => { if (typeof v !== 'boolean') throw bad(k + ' must be true or false'); return v; };
  try {
    for (const [k, v] of Object.entries(p)){
      if (v === null || v === undefined) continue;
      if (k === 'resolution'){
        let ppi;
        if (typeof v === 'string'){ const l = v.toLowerCase(); ppi = ({screen:72, medium:150, high:300})[l]; if (ppi === undefined){ ppi = parseFloat(l.replace(/ppi$/, '').trim()); if (!isFinite(ppi)) throw bad('unknown resolution `' + v + '`'); } }
        else if (typeof v === 'number') ppi = v; else throw bad('resolution must be a number or screen|medium|high');
        if (!(ppi >= 1 && ppi <= 2400)) throw bad('resolution must be between 1 and 2400 ppi');
        st.resolution = ppi;
      } else if (k === 'colorModel'){
        const l = String(v).toLowerCase();
        if (l === 'rgb' || l === 'document') st.colorModel = 'rgb'; else if (l === 'grayscale' || l === 'gray') st.colorModel = 'grayscale'; else if (l === 'bitmap') st.colorModel = 'bitmap';
        else throw bad('colorModel must be rgb (the document\'s mode), grayscale or bitmap');
      } else if (k === 'background'){ const l = String(v).toLowerCase(); if (l !== 'white' && l !== 'transparent') throw bad('background must be white or transparent'); st.background = l; }
      else if (k === 'antiAlias' || k === 'clippingMask' || k === 'preserveSpotColors') st[k] = flagv(k, v);
      else if (k === 'addAround'){ if (!(typeof v === 'number' && v >= 0 && v <= 1000)) throw bad('addAround must be 0–1000 pt'); st.addAround = v; }
      else throw bad('unknown setting `' + k + '`');
    }
  } catch (e){ if (e && e.ok === false) return e; throw e; }
  const cur = rfxSettings(), changed = JSON.stringify(cur) !== JSON.stringify(st);
  if (changed){ History.push(); Doc.aiRasterFx = st; }
  return Object.assign({ok:true, changed}, clone(st));
}
CMD.reg('ai.document.rasterEffectsSettings', {i18n:'', undoable:false, params:'{resolution?: ppi 1–2400 | "screen"(72)|"medium"(150)|"high"(300), colorModel?: "rgb"|"grayscale"|"bitmap", background?: "transparent"|"white", antiAlias?: bool, clippingMask?: bool（白底只垫在图稿底下）, addAround?: pt 0–1000, preserveSpotColors?: bool（存着）} 照 document.rasterEffectsSettings（文档栅格效果设置）：存在文件里；' +
  'Photoshop 效果把形状栅格化时照这里的颜色模型／背景收尾；没给参数＝只回目前设定；有改才算一步历史 → {ok, changed, …设定}'}, p => rfxCommand(p || {}));

/* ═════════════ 对话框（ui-egui dialogs/effect.rs：预览勾着就即时套、确定＝一步历史、取消＝退回）═════════════ */
const STYLE = `
#aiFxDialog{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;font:13px sans-serif}
#aiFxDialog .box{background:#2b2f36;color:#e6e8eb;padding:14px 18px;border-radius:6px;min-width:280px;max-width:460px;max-height:90vh;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.5)}
#aiFxDialog .hd{font-weight:bold;margin-bottom:10px}
#aiFxDialog .sh{color:#8a93a0;font-size:12px;margin:8px 0 4px}
#aiFxDialog .msg{color:#aab0ba;margin:4px 0 6px}
#aiFxDialog .grid{display:grid;grid-template-columns:auto 130px;gap:7px 10px;align-items:center}
#aiFxDialog .grid span{color:#aab0ba}
#aiFxDialog input[type=number],#aiFxDialog input[type=text],#aiFxDialog select{width:100%;box-sizing:border-box;background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:3px 6px}
#aiFxDialog input[type=color]{width:100%;height:24px;box-sizing:border-box;background:#1e2126;border:1px solid #444a54;border-radius:3px;padding:0}
#aiFxDialog label.ck{display:flex;gap:6px;align-items:center;margin-top:6px}
#aiFxDialog .row{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
#aiFxDialog .err{color:#ff8a80;font-size:12px;margin-top:6px}`;
function ensureStyle(){ if (!document.getElementById('aiFxStyle')){ const s = document.createElement('style'); s.id = 'aiFxStyle'; s.textContent = STYLE; document.head.appendChild(s); } }
const Dlg = {
  _cancel:null,
  isOpen(){ return !!document.getElementById('aiFxDialog'); },
  close(){ const d = document.getElementById('aiFxDialog'); if (d) d.remove(); this._cancel = null; },
  /* o = {kind, title（已翻好的字）, msg?, fields:[{key, label, type:'number'|'check'|'select'|'color'|'head', value, options:[[值, 字串键]]}], preview?:bool,
          okLabel?, altLabel?, onOk(v), onAlt?(v), onChange?(v, key), onCancel?()} */
  open(o){
    this.close(); ensureStyle();
    const bg = document.createElement('div'); bg.id = 'aiFxDialog'; bg.dataset.kind = o.kind;
    const box = document.createElement('div'); box.className = 'box'; bg.appendChild(box);
    const hd = document.createElement('div'); hd.className = 'hd'; hd.textContent = o.title; box.appendChild(hd);
    if (o.msg){ const m = document.createElement('div'); m.className = 'msg'; m.textContent = o.msg; box.appendChild(m); }
    let grid = null;
    const ensureGrid = () => { if (!grid){ grid = document.createElement('div'); grid.className = 'grid'; box.appendChild(grid); } return grid; };
    const fields = (o.fields || []).slice();
    if (o.preview) fields.push({key:'preview', label:'aifx.preview', type:'check', value:true});
    for (const f of fields){
      if (f.type === 'head'){ grid = null; const h = document.createElement('div'); h.className = 'sh'; h.textContent = T(f.label); box.appendChild(h); continue; }
      if (f.type === 'check'){
        grid = null;
        const l = document.createElement('label'); l.className = 'ck';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.name = f.key; cb.checked = !!f.value;
        const sp = document.createElement('span'); sp.textContent = T(f.label);
        l.appendChild(cb); l.appendChild(sp); box.appendChild(l); continue;
      }
      const G = ensureGrid(), lab = document.createElement('span'); lab.textContent = T(f.label);
      let inp;
      if (f.type === 'select'){ inp = document.createElement('select'); for (const [v, lk] of f.options){ const op = document.createElement('option'); op.value = String(v); op.textContent = T(lk); inp.appendChild(op); } inp.value = String(f.value); }
      else if (f.type === 'color'){ inp = document.createElement('input'); inp.type = 'color'; inp.value = /^#[0-9a-f]{6}$/i.test(f.value) ? f.value : '#000000'; }
      else if (f.type === 'len'){ inp = document.createElement('input'); inp.type = 'text'; inp.value = fmtLen(+f.value || 0, f.unit); inp.dataset.unit = f.unit; inp.style.width = '100%'; }
      else { inp = document.createElement('input'); inp.type = 'number'; inp.step = 'any'; inp.value = f.value; }
      inp.name = f.key; G.appendChild(lab); G.appendChild(inp);
    }
    const err = document.createElement('div'); err.className = 'err'; box.appendChild(err);
    const row = document.createElement('div'); row.className = 'row';
    const btn = (lk, act) => { const b = document.createElement('button'); b.textContent = T(lk); b.dataset.act = act; row.appendChild(b); return b; };
    const bNo = btn('aifx.cancel', 'cancel'), bAlt = o.altLabel ? btn(o.altLabel, 'alt') : null, bOk = btn(o.okLabel || 'aifx.ok', 'ok');
    box.appendChild(row); document.body.appendChild(bg);
    const read = () => {
      const v = {};
      for (const f of fields){
        if (f.type === 'head') continue;
        const el = box.querySelector(`[name="${f.key}"]`); if (!el) continue;
        if (f.type === 'check') v[f.key] = !!el.checked;
        else if (f.type === 'select'){ const raw = el.value, opt = f.options.find(x => String(x[0]) === raw); v[f.key] = opt ? opt[0] : raw; }
        else if (f.type === 'color') v[f.key] = el.value;
        else if (f.type === 'len') v[f.key] = parseLen(el.value, f.unit, f.value);
        else v[f.key] = num({x:el.value}, 'x', f.value);
      }
      return v;
    };
    const finish = r => { if (r && r.ok === false){ err.textContent = r.error || ''; return; } this._cancel = null; this.close(); if (window.UI) UI.draw(); };
    const ok = () => { let r; try { r = o.onOk(read()); } catch (e){ console.error(e); r = {ok:false, error:String(e && e.message || e)}; } finish(r); };
    const alt = () => { let r; try { r = o.onAlt(read()); } catch (e){ console.error(e); r = {ok:false, error:String(e && e.message || e)}; } finish(r); };
    const no = () => { const c = this._cancel; this._cancel = null; this.close(); if (c) c(); if (window.UI) UI.draw(); };
    this._cancel = o.onCancel || null;
    bOk.onclick = ok; bNo.onclick = no; if (bAlt) bAlt.onclick = alt;
    box.addEventListener('input', e => { if (o.onChange && e.target && e.target.name){ try { o.onChange(read(), e.target.name); } catch (er){ console.error(er); } } });
    box.addEventListener('change', e => { if (o.onChange && e.target && e.target.name && (e.target.tagName === 'SELECT' || e.target.type === 'checkbox')){ try { o.onChange(read(), e.target.name); } catch (er){ console.error(er); } } });
    bg.addEventListener('pointerdown', e => { if (e.target === bg) no(); });
    bg.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter'){ e.preventDefault(); ok(); } else if (e.key === 'Escape'){ e.preventDefault(); no(); } });
    const first = box.querySelector('input[type=number],select,input');
    if (first){ first.focus(); if (first.select) first.select(); }
    if (o.preview && o.onChange) o.onChange(read(), 'preview');
    return bg;
  }
};
/* 文档单位（文件 ▸ 文档设置 ▸ 单位＝Doc.aiSetup.units）：对话框里的长度栏照它显示、可打「11 mm」「30 pt」（AI：毫米文档的圆角栏＝「10 mm」）。
   参数本身一律存 pt（＝文件坐标的 px），命令照旧收数字；文档单位是像素（预设）就照旧是数字栏 */
const UNIT_PT = {mm:72 / 25.4, cm:720 / 25.4, in:72, pc:12, pt:1, px:1};
const UNIT_OF = {Millimeters:'mm', Centimeters:'cm', Inches:'in', Picas:'pc', Points:'pt', Pixels:'px'};
function docUnit(){ return (window.Doc && Doc.aiSetup && UNIT_OF[Doc.aiSetup.units]) || 'px'; }
function parseLen(str, unit, d){
  const m = String(str == null ? '' : str).trim().match(/^([+\-]?(?:\d+\.?\d*|\.\d+)(?:e[+\-]?\d+)?)\s*([a-z]*)/i); if (!m) return d;
  const u = (m[2] || unit).toLowerCase(), k = UNIT_PT[u === 'inch' || u === 'inches' ? 'in' : u];
  return k ? parseFloat(m[1]) * k : parseFloat(m[1]) * (UNIT_PT[unit] || 1);
}
const fmtLen = (v, unit) => `${+(v / UNIT_PT[unit]).toFixed(unit === 'in' ? 3 : 2)} ${unit}`;
const LEN_KEYS = new Set(['radius', 'offset', 'extraW', 'extraH', 'width', 'height', 'moveH', 'moveV', 'x', 'y', 'blur']);
/* 栏位：照预设值的型别；几个列举键给下拉 */
const BLEND_OPTS = ['normal', 'darken', 'multiply', 'colorBurn', 'lighten', 'screen', 'colorDodge', 'overlay', 'softLight', 'hardLight', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'].map(m => [m, 'aifx.blend.' + m]);
const ENUMS = {points:[['smooth', 'aifx.smooth'], ['corner', 'aifx.corner']], joins:[['miter', 'aifx.miter'], ['round', 'aifx.round'], ['bevel', 'aifx.bevel']], mode:BLEND_OPTS,
  source:[['center', 'aifx.center'], ['edge', 'aifx.edge']], orientation:[['horizontal', 'aifx.horizontal'], ['vertical', 'aifx.vertical']]};
function fieldsFor(id, vals){
  const out = [];
  for (const [k, d] of Object.entries(CAT[id].defaults)){
    const v = vals[k] !== undefined ? vals[k] : d, label = 'aifx.p.' + (id.startsWith('warp.') && (k === 'horizontal' || k === 'vertical') ? 'dist' + k : k);
    if (k === 'corners'){ (Array.isArray(v) ? v : d).forEach((q, i) => { out.push({key:`c${i}x`, label:`aifx.p.c${i}x`, type:'number', value:+q[0]}, {key:`c${i}y`, label:`aifx.p.c${i}y`, type:'number', value:+q[1]}); }); continue; }
    if (ENUMS[k]) out.push({key:k, label, type:'select', value:(ENUMS[k].find(o => o[0].toLowerCase() === String(v).toLowerCase().replace(/[^a-z]/g, '') || o[0] === v) || ENUMS[k][0])[0], options:ENUMS[k]});
    else if (k === 'color') out.push({key:k, label, type:'color', value:String(v)});
    else if (typeof d === 'boolean') out.push({key:k, label, type:'check', value:!!v});
    else if (LEN_KEYS.has(k) && docUnit() !== 'px') out.push({key:k, label, type:'len', unit:docUnit(), value:num(vals, k, d)});
    else out.push({key:k, label, type:'number', value:num(vals, k, d)});
  }
  return out;
}
function valsToParams(id, v){
  const o = {};
  for (const k of Object.keys(CAT[id].defaults)){
    if (k === 'corners'){ o.corners = [0, 1, 2, 3].map(i => [v[`c${i}x`], v[`c${i}y`]]); continue; }
    if (v[k] !== undefined) o[k] = v[k];
  }
  return o;
}
/* 菜单项名字（标题用；去掉「…」） */
function menuName(itemId, fallback){
  let hit = null;
  if (window.MenuTrees) MenuTrees.walk('ai', it => { if (!hit && it.id === itemId) hit = it; });
  const n = hit && hit.n ? (hit.n[Lang.cur] || hit.n.en) : fallback;
  return String(n || '').replace(/…$/, '');
}
const fxTitle = id => menuName(id === 'blur.gaussian' ? 'effect.ps.blur.gaussian' : 'effect.' + id, CAT[id] ? CAT[id].label : id);
/* dialogs/effect.rs:44 open：index＝就地编辑那个效果；没 index 而第一个选中物件已套过同一效果 ⇒ 先问「编辑／新增」 */
function openEffectDialog(id, o){
  o = o || {};
  const t = targets(o, 'ai.effect.dialog'); if (t.err) return t.err;
  if (!CAT[id]) return {ok:false, error:'ai.effect.dialog: unknown effect `' + id + '`'};
  const first = t.R[0], applied = Array.isArray(first.effects) ? first.effects : [];
  let index = Number.isInteger(o.index) ? o.index : null;
  if (index !== null && (!applied[index] || applied[index].id !== id)) return {ok:false, error:`ai.effect.dialog: effect ${index} is not \`${id}\``};
  if (index === null && !o.fresh){
    const k = applied.map(e => e && e.id).lastIndexOf(id);
    if (k >= 0){
      Dlg.open({kind:'effectExists', title:T('aifx.exists').replace('{name}', fxTitle(id)), msg:T('aifx.existsMsg'), fields:[], okLabel:'aifx.edit', altLabel:'aifx.addNew',
        onOk:() => { setTimeout(() => openEffectDialog(id, Object.assign({}, o, {index:k})), 0); return {ok:true}; },
        onAlt:() => { setTimeout(() => openEffectDialog(id, Object.assign({}, o, {fresh:true})), 0); return {ok:true}; }});
      return {ok:true, dialog:'effectExists', pending:'effectExists'};
    }
  }
  const vals = index !== null ? merged(id, applied[index].params) : merged(id, o.params || null);
  const snap = t.R.map(s => (Array.isArray(s.effects) ? clone(s.effects) : null));
  const restore = () => { t.R.forEach((s, i) => { if (snap[i]) s.effects = clone(snap[i]); else delete s.effects; }); Layer.invalidate(t.L); };
  const preview = v => {
    restore();
    if (v.preview === false) { if (window.UI) UI.draw(); return; }
    const params = merged(id, valsToParams(id, v));
    t.R.forEach(s => {
      if (index !== null){ if (s.effects && s.effects[index] && s.effects[index].id === id) s.effects[index].params = params; }
      else (s.effects = s.effects || []).push({id, params, visible:true});
    });
    Layer.invalidate(t.L); if (window.UI) UI.draw();
  };
  Dlg.open({kind:'effect', title:fxTitle(id), fields:fieldsFor(id, vals), preview:true, onChange:preview, onCancel:restore,
    onOk:v => {
      restore();
      const params = valsToParams(id, v), ids = t.R.map(s => s.id);
      if (index !== null) return CMD.run('ai.effect.setParams', {index, params, ids, layerId:t.L.id});
      const r = CMD.run('ai.effect.apply', {effect:id, params, ids, layerId:t.L.id});
      if (r && r.ok !== false) AiFx.last = {effect:id, params:merged(id, params)};      // effect.rs:326 只有新套的效果算「上一个效果」，编辑不算
      return r;
    }});
  return {ok:true, dialog:'effect'};
}
reg('ai.effect.dialog', {params:'{effect: id, index?: int（就地编辑那个已套用的效果，栏位预填；确定＝ai.effect.setParams）, params?: {…}（预填）} 照 effect.dialog：开效果对话框（勾预览即时看结果）；没给 index 而选中物件已套过同一效果 ⇒ 先问「编辑／新增」→ {ok, dialog}'}, p => openEffectDialog(p.effect || p.id, p));
Object.keys(CAT).forEach(id => {
  if (!Object.keys(CAT[id].defaults).length) return;                           // menus.rs:2544 没参数的直接套、不开对话框
  reg('ai.effect.' + id + '.dialog', {params:`{} 开「${CAT[id].label}」对话框（确定＝ai.effect.apply {effect:"${id}"}）→ {ok, dialog}`}, p => openEffectDialog(id, p));
});
/* menus.rs:932 applyLast／:793 last */
reg('ai.effect.applyLast', {undoable:true, params:'{ids?, layerId?} 照 effect.applyLast（应用上一个效果，Ctrl+Shift+E）：用上次在对话框按确定的效果与参数再套一次 → {ok, ids}'}, p => {
  const L0 = AiFx.last; if (!L0) return {ok:false, error:'no effect applied yet'};
  if (L0.ps) return runPs(PS_BY_CMD[L0.ps], Object.assign({}, p, {params:clone(L0.params)}));
  return apply(Object.assign({}, p, {effect:L0.effect, params:clone(L0.params)}));
});
reg('ai.effect.last', {params:'{} 照 effect.last（上一个效果…，Ctrl+Alt+Shift+E）：开上次那个效果的对话框，栏位预填上次的参数 → {ok, dialog}'}, p => {
  const L0 = AiFx.last; if (!L0) return {ok:false, error:'no effect applied yet'};
  if (L0.ps) return openPsDialog(PS_BY_CMD[L0.ps], Object.assign({}, p, {params:L0.params}));
  return openEffectDialog(L0.effect, Object.assign({}, p, {params:L0.params, fresh:true}));
});
/* 文档栅格效果设置对话框（dialogs/raster_effects.rs）：分辨率预设＋其它 */
reg('ai.document.rasterEffectsSettings.dialog', {params:'{} 开「文档栅格效果设置」对话框（确定＝ai.document.rasterEffectsSettings）→ {ok, dialog}'}, () => {
  const st = rfxSettings(), preset = [72, 150, 300].includes(st.resolution) ? String(st.resolution) : 'other';
  Dlg.open({kind:'rasterEffectsSettings', title:T('aifx.rfx.title'), fields:[
    {key:'res', label:'aifx.rfx.resolution', type:'select', value:preset, options:[['72', 'aifx.rfx.screen'], ['150', 'aifx.rfx.medium'], ['300', 'aifx.rfx.high'], ['other', 'aifx.rfx.other']]},
    {key:'ppi', label:'aifx.rfx.ppi', type:'number', value:st.resolution},
    {key:'colorModel', label:'aifx.rfx.colorModel', type:'select', value:st.colorModel, options:[['rgb', 'aifx.rfx.rgb'], ['grayscale', 'aifx.rfx.grayscale'], ['bitmap', 'aifx.rfx.bitmap']]},
    {key:'background', label:'aifx.rfx.background', type:'select', value:st.background, options:[['white', 'aifx.rfx.white'], ['transparent', 'aifx.rfx.transparent']]},
    {label:'aifx.rfx.options', type:'head'},
    {key:'antiAlias', label:'aifx.rfx.antiAlias', type:'check', value:st.antiAlias}, {key:'clippingMask', label:'aifx.rfx.clippingMask', type:'check', value:st.clippingMask},
    {key:'addAround', label:'aifx.rfx.addAround', type:'number', value:st.addAround}, {key:'preserveSpotColors', label:'aifx.rfx.spot', type:'check', value:st.preserveSpotColors}],
    msg:T('aifx.rfx.caption'),
    onOk:v => CMD.run('ai.document.rasterEffectsSettings', {resolution:v.res === 'other' ? v.ppi : +v.res, colorModel:v.colorModel, background:v.background, antiAlias:v.antiAlias, clippingMask:v.clippingMask, addAround:v.addAround, preserveSpotColors:v.preserveSpotColors})});
  return {ok:true, dialog:'rasterEffectsSettings'};
});

/* ═════════════ Photoshop 效果：栅格化副本 ＋ PS 滤镜的 ps.filter.*（VectorCraft 原码没有这一段；滤镜参数照 PhotoCraft algo/src/artistic.rs 与命令目录）═════════════ */
const GAL = {   // 滤镜库 key → PhotoCraft 参数记法（artistic.rs:38-92）
  coloredPencil:'{"pencilWidth":1..24=4,"strokePressure":0..15=8,"paperBrightness":0..50=25}', cutout:'{"numberOfLevels":2..8=4,"edgeSimplicity":0..10=4,"edgeFidelity":1..3=2}',
  dryBrush:'{"brushSize":0..10=2,"brushDetail":0..10=8,"texture":1..3=1}', filmGrain:'{"grain":0..20=4,"highlightArea":0..20=0,"intensity":0..10=10}',
  fresco:'{"brushSize":0..10=2,"brushDetail":0..10=8,"texture":1..3=1}', neonGlow:'{"glowSize":-24..24=5,"glowBrightness":0..50=15,"glowColor":json}',
  paintDaubs:'{"brushSize":1..50=8,"sharpness":0..40=7,"brushType":"simple|lightRough|darkRough|wideSharp|wideBlurry|sparkle"}', paletteKnife:'{"strokeSize":1..50=25,"strokeDetail":1..3=3,"softness":0..10=0}',
  plasticWrap:'{"highlightStrength":0..20=15,"detail":1..15=9,"smoothness":1..15=7}', posterEdges:'{"edgeThickness":0..10=2,"edgeIntensity":0..10=1,"posterization":0..6=2}',
  roughPastels:'{"strokeLength":0..40=6,"strokeDetail":1..20=4,"texture":"canvas|brick|burlap|sandstone","scaling":50..200=100,"relief":0..50=20,"light":"bottom|bottomLeft|left|topLeft|top|topRight|right|bottomRight","invert":bool}',
  smudgeStick:'{"strokeLength":0..10=2,"highlightArea":0..20=0,"intensity":0..10=10}', sponge:'{"brushSize":0..10=2,"definition":0..25=12,"smoothness":1..15=5}',
  underpainting:'{"brushSize":0..40=6,"textureCoverage":0..40=16,"texture":"canvas|brick|burlap|sandstone","scaling":50..200=100,"relief":0..50=4,"light":"top|topRight|right|bottomRight|bottom|bottomLeft|left|topLeft","invert":bool}',
  watercolor:'{"brushDetail":1..14=9,"shadowIntensity":0..10=1,"texture":1..3=1}',
  accentedEdges:'{"edgeWidth":1..14=2,"edgeBrightness":0..50=38,"smoothness":1..15=5}', angledStrokes:'{"directionBalance":0..100=50,"strokeLength":3..50=15,"sharpness":0..10=3}',
  crosshatch:'{"strokeLength":3..50=9,"sharpness":0..20=6,"strength":1..3=1}', darkStrokes:'{"balance":0..10=5,"blackIntensity":0..10=6,"whiteIntensity":0..10=2}',
  inkOutlines:'{"strokeLength":1..50=4,"darkIntensity":0..50=20,"lightIntensity":0..50=10}', spatter:'{"sprayRadius":0..25=10,"smoothness":1..15=5}',
  sprayedStrokes:'{"strokeLength":0..20=12,"sprayRadius":0..25=7,"strokeDirection":"rightDiagonal|horizontal|leftDiagonal|vertical"}', sumiE:'{"strokeWidth":3..15=10,"strokePressure":0..15=2,"contrast":0..40=16}',
  diffuseGlow:'{"graininess":0..10=6,"glowAmount":0..20=10,"clearAmount":0..20=15,"background":json}',
  glass:'{"distortion":0..20=5,"smoothness":1..15=3,"texture":"frosted|blocks|canvas|tinyLens","scaling":50..200=100,"invert":bool}', oceanRipple:'{"rippleSize":1..15=9,"rippleMagnitude":0..20=9}',
  basRelief:'{"detail":1..15=13,"smoothness":1..15=3,"light":"bottom|bottomLeft|left|topLeft|top|topRight|right|bottomRight","foreground":json,"background":json}',
  chalkCharcoal:'{"charcoalArea":0..20=6,"chalkArea":0..20=6,"strokePressure":0..5=1,"foreground":json,"background":json}',
  charcoal:'{"charcoalThickness":1..7=1,"detail":0..5=5,"lightDarkBalance":0..100=50,"foreground":json,"background":json}', chrome:'{"detail":0..10=4,"smoothness":0..10=7}',
  conteCrayon:'{"foregroundLevel":1..15=11,"backgroundLevel":1..15=7,"texture":"canvas|brick|burlap|sandstone","scaling":50..200=100,"relief":0..50=4,"light":"top|topRight|right|bottomRight|bottom|bottomLeft|left|topLeft","invert":bool,"foreground":json,"background":json}',
  graphicPen:'{"strokeLength":1..15=15,"lightDarkBalance":0..100=50,"strokeDirection":"rightDiagonal|horizontal|leftDiagonal|vertical","foreground":json,"background":json}',
  halftonePattern:'{"size":1..12=1,"contrast":0..50=5,"patternType":"dot|circle|line","foreground":json,"background":json}',
  notePaper:'{"imageBalance":0..50=25,"graininess":0..20=10,"relief":0..25=11,"foreground":json,"background":json}', photocopy:'{"detail":1..24=7,"darkness":1..50=8,"foreground":json,"background":json}',
  plaster:'{"imageBalance":0..50=20,"smoothness":1..15=2,"light":"top|topRight|right|bottomRight|bottom|bottomLeft|left|topLeft","foreground":json,"background":json}',
  reticulation:'{"density":0..50=12,"foregroundLevel":0..50=40,"backgroundLevel":0..50=5,"foreground":json,"background":json}', stamp:'{"lightDarkBalance":0..50=25,"smoothness":1..50=5,"foreground":json,"background":json}',
  tornEdges:'{"imageBalance":0..50=25,"smoothness":1..15=11,"contrast":1..25=17,"foreground":json,"background":json}', waterPaper:'{"fiberLength":3..50=15,"brightness":0..100=60,"contrast":0..100=80}',
  glowingEdges:'{"edgeWidth":1..14=2,"edgeBrightness":0..20=6,"smoothness":1..15=5}',
  craquelure:'{"crackSpacing":2..100=15,"crackDepth":0..10=6,"crackBrightness":0..10=9}',
  grain:'{"intensity":0..100=40,"contrast":0..100=50,"grainType":"regular|soft|sprinkles|clumped|contrasty|enlarged|stippled|horizontal|vertical|speckle","foreground":json,"background":json}',
  mosaicTiles:'{"tileSize":2..100=12,"groutWidth":1..15=3,"lightenGrout":0..10=9}', patchwork:'{"squareSize":0..10=4,"relief":0..25=8}',
  stainedGlass:'{"cellSize":2..50=10,"borderThickness":1..20=4,"lightIntensity":0..10=3,"foreground":json}',
  texturizer:'{"texture":"canvas|brick|burlap|sandstone","scaling":50..200=100,"relief":0..50=4,"light":"top|topRight|right|bottomRight|bottom|bottomLeft|left|topLeft","invert":bool}'
};
/* 菜单项 → [我们的命令（ai.effect.ps.…）, 滤镜库 key 或 ps 滤镜原码 id, 参数记法] */
const PS_FX = [];
const psg = (cat, keys) => keys.forEach(k => { const [mid, key] = Array.isArray(k) ? k : [k, k]; PS_FX.push({menu:`effect.ps.${cat}.${mid}`, cmd:`ai.effect.ps.${cat}.${mid}`, gallery:key, doc:GAL[key]}); });
const psf = (cat, mid, filter, doc) => PS_FX.push({menu:`effect.ps.${cat}.${mid}`, cmd:`ai.effect.ps.${cat}.${mid}`, filter, doc});
psg('artistic', ['coloredPencil', 'cutout', 'dryBrush', 'filmGrain', 'fresco', 'neonGlow', 'paintDaubs', 'paletteKnife', 'plasticWrap', 'posterEdges', 'roughPastels', 'smudgeStick', 'sponge', 'underpainting', 'watercolor']);
psf('blur', 'radial', 'blur.radialBlur', '{"amount":1..100=10,"method":"spin|zoom","centerX":0..1=0.5,"centerY":0..1=0.5}');
psf('blur', 'smart', 'blur.smartBlur', '{"radius":0.1..100=3,"threshold":0.1..100=25,"quality":"high|medium|low","mode":"normal|edgeOnly|overlayEdge"}');
psg('brushStrokes', ['accentedEdges', 'angledStrokes', 'crosshatch', 'darkStrokes', 'inkOutlines', 'spatter', 'sprayedStrokes', ['sumie', 'sumiE']]);
psg('distort', ['diffuseGlow', 'glass', 'oceanRipple']);
psf('pixelate', 'colorHalftone', 'pixelate.colorHalftone', '{"maxRadius":4..127=8,"channel1":-360..360=108,"channel2":-360..360=162,"channel3":-360..360=90,"channel4":-360..360=45}');
psf('pixelate', 'crystallize', 'pixelate.crystallize', '{"cellSize":3..300=10,"seed":u32=0}');
psf('pixelate', 'mezzotint', 'pixelate.mezzotint', '{"type":"fineDots|mediumDots|grainyDots|coarseDots|shortLines|mediumLines|longLines|shortStrokes|mediumStrokes|longStrokes","seed":u32=0}');
psf('pixelate', 'pointillize', 'pixelate.pointillize', '{"cellSize":3..300=5,"seed":u32=0,"background":json}');
psg('sketch', ['basRelief', 'chalkCharcoal', 'charcoal', 'chrome', 'conteCrayon', 'graphicPen', 'halftonePattern', 'notePaper', 'photocopy', 'plaster', 'reticulation', 'stamp', 'tornEdges', 'waterPaper']);
psg('stylize', ['glowingEdges']);
psg('texture', ['craquelure', 'grain', 'mosaicTiles', 'patchwork', 'stainedGlass', 'texturizer']);
psf('video', 'deInterlace', 'video.deInterlace', '{"eliminate":"oddFields|evenFields","createBy":"interpolation|duplication"}');
psf('video', 'ntscColors', 'video.ntscColors', '{}');
PS_FX.push({menu:'effect.ps.gallery', cmd:'ai.effect.ps.gallery', galleryAny:true, doc:''});
const PS_BY_CMD = Object.fromEntries(PS_FX.map(e => [e.cmd, e]));
/* PhotoCraft 参数记法 → 栏位：a..b=d 数字、"x|y" 下拉（第一个是预设）、bool 勾选、u32=d 数字、json（颜色）不列（滤镜用它自己的前景／背景色） */
function parseDoc(doc){
  const out = [], re = /"(\w+)":(?:(-?[\d.]+)\.\.(-?[\d.]+)=(-?[\d.]+)|"([^"]*)"|(bool)|(json)|u32=(\d+))/g; let m;
  while ((m = re.exec(doc || ''))){
    if (m[2] !== undefined) out.push({key:m[1], type:'number', value:+m[4], min:+m[2], max:+m[3]});
    else if (m[5] !== undefined){ const ch = m[5].split('|'); out.push({key:m[1], type:'select', value:ch[0], options:ch.map(c => [c, 'aifx.ch.' + c])}); }
    else if (m[6]) out.push({key:m[1], type:'check', value:false});
    else if (m[8] !== undefined) out.push({key:m[1], type:'number', value:+m[8], min:0, max:4294967295});
  }
  return out;
}
/* ps-filter.js 登记的命令：滤镜库优先 ps.filter.gallery.<key>，否则 ps.filter.filterGallery {effects:[…]}；其它 ps.filter.<原码 id 去掉 filter.> */
function psTarget(e, params, galleryKey){
  const key = galleryKey || e.gallery;
  if (key){
    if (CMD.map['ps.filter.gallery.' + key]) return {cmd:'ps.filter.gallery.' + key, params};
    if (CMD.map['ps.filter.filterGallery']) return {cmd:'ps.filter.filterGallery', params:{effects:[{filter:key, params, visible:true}]}};
    return null;
  }
  if (e.galleryAny) return (CMD.map['ps.filter.filterGallery'] || Object.keys(CMD.map).some(k => k.startsWith('ps.filter.gallery.'))) ? {cmd:null} : null;
  return CMD.map['ps.filter.' + e.filter] ? {cmd:'ps.filter.' + e.filter, params} : null;
}
function cleanParams(fields, params){
  const o = {};
  for (const f of fields){ let v = params && params[f.key] !== undefined ? params[f.key] : f.value; if (f.type === 'number') v = clamp(num({v}, 'v', f.value), f.min, f.max); else if (f.type === 'check') v = !!v; else if (f.type === 'select' && !f.options.some(x => x[0] === v)) v = f.value; o[f.key] = v; }
  return o;
}
/* 栅格化副本 → 新像素层（矢量层正上方）→ 跑 ps.filter → 原形状藏起来 */
function runPs(e, p){
  if (!e) return {ok:false, error:'unknown Photoshop effect'};
  const C = e.cmd;
  const t = targets(p, C); if (t.err) return t.err;
  let key = e.gallery, fields = parseDoc(e.doc);
  if (e.galleryAny){ key = p.filter || (p.params && p.params.filter); if (!key || !GAL[key]) return {ok:false, error:C + ': `filter` must be a Filter Gallery key (' + Object.keys(GAL).join(', ') + ')'}; fields = parseDoc(GAL[key]); }
  const params = cleanParams(fields, Object.assign({}, p.params || {}, ...fields.map(f => (p[f.key] !== undefined && f.key !== 'filter') ? {[f.key]:p[f.key]} : {})));
  const tg = psTarget(e, params, key); if (!tg || !tg.cmd) return {ok:false, error:C + ': the Photoshop filter command is not loaded (menus/impl/ps-filter.js)'};
  const L = t.L, st = rfxSettings();
  const N = Layer.raster(menuName(e.menu, C) + ' (' + (L.name || '') + ')');
  const c = N.data.ctx; c.save(); c.translate(L.x, L.y); c.imageSmoothingEnabled = st.antiAlias !== false;
  t.R.forEach(s => window.drawShape(c, s, 1)); c.restore();
  finishPixels(c, N.data.canvas.width, N.data.canvas.height, st);
  Doc.add(N, Doc.index(L.id) + 1);
  const sel = Doc.sel; Doc.sel = null;
  const finish = r => {
    Doc.sel = sel;
    if (r && r.ok === false) return r;
    t.R.forEach(s => { s.visible = false; });
    if (window.VecSel) VecSel.clear();
    Doc.activeId = L.id;                                                        // 留在矢量层（AI 菜单不跳走）；结果是正上方那张像素层
    Layer.invalidate(L);
    return {ok:true, id:N.id, layerId:N.id, hidden:t.R.map(s => s.id), filter:tg.cmd};
  };
  // ps.filter.* 自己会 History.push 一步（ps-filter.js runCommand）；我们这条命令已推过一步 ⇒ 跑完把它多推的那步丢掉，整个效果只算一步
  const n0 = History.past.length;
  let r;
  try { r = CMD.map[tg.cmd].run(Object.assign({layer:N.id}, tg.params || {})); } catch (err){ Doc.sel = sel; throw err; }
  if (History.past.length > n0) History.past.length = n0;
  if (r && typeof r.then === 'function'){
    return r.then(x => { if (History.past.length > n0) History.past.length = n0; const y = finish(x); if (y && y.ok === false){ History.restoreInPlace(History.past.pop()); if (window.UI) UI.refresh(); } else if (window.UI) UI.refresh(); return y; },
                  err => { Doc.sel = sel; History.restoreInPlace(History.past.pop()); if (window.UI) UI.refresh(); throw err; });
  }
  return finish(r);
}
function openPsDialog(e, o){
  o = o || {};
  const t = targets(o, e.cmd + '.dialog'); if (t.err) return t.err;
  let key = e.gallery;
  if (e.galleryAny) key = (o.params && o.params.filter) || o.filter || Object.keys(GAL).find(k => psTarget({gallery:k}, {}, k)) || 'coloredPencil';
  const fields = parseDoc(key ? GAL[key] : e.doc), vals = Object.assign({}, o.params || {});
  const fl = fields.map(f => Object.assign({}, f, {label:'aifx.ps.' + f.key, value:vals[f.key] !== undefined ? vals[f.key] : f.value}));
  if (e.galleryAny) fl.unshift({key:'filter', label:'aifx.ps.filter', type:'select', value:key, options:Object.keys(GAL).filter(k => psTarget({gallery:k}, {}, k)).map(k => [k, 'aifx.gal.' + k])});
  const title = menuName(e.menu, e.cmd);
  if (!fl.length){ const r = CMD.run(e.cmd, {ids:t.R.map(s => s.id), layerId:t.L.id}); if (r && r.ok !== false) AiFx.last = {ps:e.cmd, params:{}}; return r; }   // 没参数（NTSC 颜色）：直接套
  Dlg.open({kind:'psEffect', title, fields:fl,
    onChange:(v, k) => { if (e.galleryAny && k === 'filter' && v.filter !== key) setTimeout(() => openPsDialog(e, Object.assign({}, o, {params:{filter:v.filter}})), 0); },
    onOk:v => { const params = Object.assign({}, v); const r = CMD.run(e.cmd, {params, ids:t.R.map(s => s.id), layerId:t.L.id}); if (r && r.ok !== false) AiFx.last = {ps:e.cmd, params}; return r; }});
  return {ok:true, dialog:'psEffect'};
}
/* 只登记 ps-filter.js 已经有的（菜单因此只在对得上时才亮）；页面载完再对一次 */
function syncPs(){
  let n = 0;
  for (const e of PS_FX){
    if (CMD.map[e.cmd] || !psTarget(e, {})) continue;
    const doc = e.galleryAny ? '{filter: 滤镜库 key（' + Object.keys(GAL).join('|') + '）, …该滤镜参数}' : e.doc;
    CMD.reg(e.cmd, {i18n:'', undoable:true, params:`{params?: ${doc}（也可平铺）, ids?, layerId?} Photoshop 效果（VectorCraft 原码没有）：选中形状连同效果栅格化成正上方一张新像素层（照文档栅格效果设置收尾），再跑 PS 滤镜单的 ps.filter 命令；原形状藏起来 → {ok, id（新像素层）, hidden, filter}`}, p => runPs(e, p || {}));
    if (e.doc !== '{}') CMD.reg(e.cmd + '.dialog', {i18n:'', params:'{} 开这个 Photoshop 效果的对话框（栏位照 PhotoCraft 滤镜参数）→ {ok, dialog}'}, p => openPsDialog(e, p || {}));
    n++;
  }
  // 菜单档里这些项的 impl 写的是我们的命令；ps.filter 还没有的那几项执行期先改回 null（灰掉、标「未做」，不留点了没反应的钮），有了再接回
  if (window.MenuTrees && MenuTrees.ai && MenuTrees.ai.effect){
    const byId = new Map(PS_FX.map(e => [e.menu, e]));
    MenuTrees.walk('ai', it => {
      const e = byId.get(it.id); if (!e) return;
      if (it._psImpl === undefined) it._psImpl = it.impl || null;
      const c = it._psImpl && (typeof it._psImpl === 'string' ? it._psImpl : it._psImpl.cmd);
      it.impl = (c && CMD.map[c]) ? it._psImpl : null;
    });
  }
  return n;
}
syncPs();
if (document.readyState !== 'complete') window.addEventListener('load', () => { syncPs(); });

/* 效果菜单的快捷键（Ctrl+Shift+E 应用上一个效果、Ctrl+Alt+Shift+E 上一个效果…）：矢量层（AI 菜单）时才接，照 ai-view.js 的写法 */
const comboOf = e => [(e.ctrlKey || e.metaKey) ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : (e.key && e.key.length === 1 ? e.key.toUpperCase() : e.key))].filter(Boolean).join('+');
const normKey = k => { const p = k.split('+'), key = p.pop(); return ['Ctrl', 'Alt', 'Shift'].filter(m => p.includes(m)).concat([key.length === 1 ? key.toUpperCase() : key]).join('+'); };
window.addEventListener('keydown', e => {
  if (!window.Menubar || Menubar.app !== 'ai' || !MenuTrees.ai || !MenuTrees.ai.effect || Dlg.isOpen()) return;
  if (/input|select|textarea/i.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable)) return;
  const c = comboOf(e); let hit = null;
  const go = items => items.forEach(it => { if (hit || it.sep) return; if (it.key && normKey(it.key) === c && Menubar.enabled(it)) hit = it; if (it.sub) go(it.sub); });
  go(MenuTrees.ai.effect.items);
  if (!hit) return;
  e.preventDefault(); e.stopImmediatePropagation();
  Menubar.run(hit);
}, true);

/* ═════════════ 三语字串（照 AI 2020 繁／简中介面的对话框用语）═════════════ */
const L3 = (key, hant, hans, en) => { STR['zh-Hant'][key] = hant; STR['zh-Hans'][key] = hans; STR.en[key] = en; };
const STR = {'zh-Hant':{}, 'zh-Hans':{}, en:{}};
[['aifx.ok', '確定', '确定', 'OK'], ['aifx.cancel', '取消', '取消', 'Cancel'], ['aifx.preview', '預視', '预览', 'Preview'],
 ['aifx.edit', '編輯', '编辑', 'Edit'], ['aifx.addNew', '新增', '新建', 'Add New'],
 ['aifx.exists', '已套用「{name}」', '已应用「{name}」', '{name} is already applied'], ['aifx.existsMsg', '要編輯已套用的效果，還是再套用一個新的？', '要编辑已应用的效果，还是再应用一个新的？', 'Edit the applied effect, or add another one?'],
 ['aifx.smooth', '平滑', '平滑', 'Smooth'], ['aifx.corner', '尖角', '尖锐', 'Corner'], ['aifx.miter', '尖角', '斜接', 'Miter'], ['aifx.round', '圓角', '圆角', 'Round'], ['aifx.bevel', '斜角', '斜角', 'Bevel'],
 ['aifx.center', '中央', '中心', 'Center'], ['aifx.edge', '邊緣', '边缘', 'Edge'], ['aifx.horizontal', '水平', '水平', 'Horizontal'], ['aifx.vertical', '垂直', '垂直', 'Vertical'],
 ['aifx.p.relative', '相對', '相对', 'Relative'], ['aifx.p.extraW', '額外寬度', '额外宽度', 'Extra Width'], ['aifx.p.extraH', '額外高度', '额外高度', 'Extra Height'],
 ['aifx.p.width', '寬度', '宽度', 'Width'], ['aifx.p.height', '高度', '高度', 'Height'], ['aifx.p.radius', '半徑', '半径', 'Radius'],
 ['aifx.p.c0x', '左上 X', '左上 X', 'Top Left X'], ['aifx.p.c0y', '左上 Y', '左上 Y', 'Top Left Y'], ['aifx.p.c1x', '右上 X', '右上 X', 'Top Right X'], ['aifx.p.c1y', '右上 Y', '右上 Y', 'Top Right Y'],
 ['aifx.p.c2x', '右下 X', '右下 X', 'Bottom Right X'], ['aifx.p.c2y', '右下 Y', '右下 Y', 'Bottom Right Y'], ['aifx.p.c3x', '左下 X', '左下 X', 'Bottom Left X'], ['aifx.p.c3y', '左下 Y', '左下 Y', 'Bottom Left Y'],
 ['aifx.p.amount', '縮攏 ↔ 膨脹 (%)', '收缩 ↔ 膨胀 (%)', 'Pucker ↔ Bloat (%)'], ['aifx.p.size', '尺寸', '大小', 'Size'], ['aifx.p.detail', '細節 (/英寸)', '细节 (/英寸)', 'Detail (/in)'],
 ['aifx.p.points', '點', '点', 'Points'], ['aifx.p.seed', '隨機種子', '随机种子', 'Seed'],
 ['aifx.p.scaleH', '縮放 水平 (%)', '缩放 水平 (%)', 'Scale Horizontal (%)'], ['aifx.p.scaleV', '縮放 垂直 (%)', '缩放 垂直 (%)', 'Scale Vertical (%)'],
 ['aifx.p.moveH', '移動 水平', '移动 水平', 'Move Horizontal'], ['aifx.p.moveV', '移動 垂直', '移动 垂直', 'Move Vertical'], ['aifx.p.rotate', '旋轉 角度', '旋转 角度', 'Rotate Angle'],
 ['aifx.p.copies', '拷貝', '副本', 'Copies'], ['aifx.p.reflectX', '鏡射 X', '对称 X', 'Reflect X'], ['aifx.p.reflectY', '鏡射 Y', '对称 Y', 'Reflect Y'],
 ['aifx.p.h', '水平', '水平', 'Horizontal'], ['aifx.p.v', '垂直', '垂直', 'Vertical'], ['aifx.p.anchors', '錨點', '锚点', 'Anchor Points'],
 ['aifx.p.in', '「進入」控制點', '"导入"控制点', '"In" Control Points'], ['aifx.p.out', '「離開」控制點', '"导出"控制点', '"Out" Control Points'],
 ['aifx.p.angle', '角度', '角度', 'Angle'], ['aifx.p.ridges', '每段的隆起數', '每段的隆起数', 'Ridges per segment'],
 ['aifx.p.offset', '位移', '位移', 'Offset'], ['aifx.p.joins', '轉角', '连接', 'Joins'], ['aifx.p.miterLimit', '尖角限度', '斜接限制', 'Miter limit'],
 ['aifx.p.overlap', '路徑重疊', '路径重叠', 'Path Overlap'], ['aifx.p.strokeWidth', '筆畫寬度', '描边宽度', 'Stroke Width'], ['aifx.p.curviness', '曲度 (%)', '弯曲度 (%)', 'Curviness (%)'],
 ['aifx.p.spacing', '間距', '间距', 'Spacing'], ['aifx.p.variation', '變化', '变化', 'Variation'],
 ['aifx.p.mode', '模式', '模式', 'Mode'], ['aifx.p.opacity', '不透明度 (%)', '不透明度 (%)', 'Opacity (%)'], ['aifx.p.x', 'X 位移', 'X 位移', 'X Offset'], ['aifx.p.y', 'Y 位移', 'Y 位移', 'Y Offset'],
 ['aifx.p.blur', '模糊', '模糊', 'Blur'], ['aifx.p.color', '顏色', '颜色', 'Color'], ['aifx.p.source', '光源', '源', 'Source'],
 ['aifx.p.orientation', '方向', '方向', 'Orientation'], ['aifx.p.bend', '彎曲 (%)', '弯曲 (%)', 'Bend (%)'],
 ['aifx.p.disthorizontal', '扭曲 水平 (%)', '扭曲 水平 (%)', 'Distortion Horizontal (%)'], ['aifx.p.distvertical', '扭曲 垂直 (%)', '扭曲 垂直 (%)', 'Distortion Vertical (%)'],
 ['aifx.rfx.title', '文件點陣效果設定', '文档栅格效果设置', 'Document Raster Effects Settings'], ['aifx.rfx.resolution', '解析度', '分辨率', 'Resolution'],
 ['aifx.rfx.screen', '螢幕 (72 ppi)', '屏幕 (72 ppi)', 'Screen (72 ppi)'], ['aifx.rfx.medium', '中 (150 ppi)', '中 (150 ppi)', 'Medium (150 ppi)'], ['aifx.rfx.high', '高 (300 ppi)', '高 (300 ppi)', 'High (300 ppi)'],
 ['aifx.rfx.other', '其他', '其它', 'Other'], ['aifx.rfx.ppi', '其他 (ppi)', '其它 (ppi)', 'Other (ppi)'], ['aifx.rfx.colorModel', '色彩模式', '颜色模型', 'Color Model'],
 ['aifx.rfx.rgb', 'RGB', 'RGB', 'RGB'], ['aifx.rfx.grayscale', '灰階', '灰度', 'Grayscale'], ['aifx.rfx.bitmap', '點陣圖', '位图', 'Bitmap'],
 ['aifx.rfx.background', '背景', '背景', 'Background'], ['aifx.rfx.white', '白色', '白色', 'White'], ['aifx.rfx.transparent', '透明', '透明', 'Transparent'],
 ['aifx.rfx.options', '選項', '选项', 'Options'], ['aifx.rfx.antiAlias', '消除鋸齒', '消除锯齿', 'Anti-alias'], ['aifx.rfx.clippingMask', '建立剪裁遮色片', '创建剪切蒙版', 'Create Clipping Mask'],
 ['aifx.rfx.addAround', '物件周圍增加', '在对象周围添加', 'Add Around Object'], ['aifx.rfx.spot', '保留特別色', '保留专色', 'Preserve Spot Colors'],
 ['aifx.rfx.caption', '更改這些設定會改變點陣效果在轉存、平面化或展開時的外觀。', '更改这些设置会改变栅格效果在导出、拼合或扩展时的外观。', 'Changing these settings changes how raster effects look when exported, flattened or expanded.'],
 ['aifx.ps.filter', '濾鏡', '滤镜', 'Filter']
].forEach(r => L3(...r));
[['normal', '一般', '正常', 'Normal'], ['darken', '變暗', '变暗', 'Darken'], ['multiply', '色彩增值', '正片叠底', 'Multiply'], ['colorBurn', '加深顏色', '颜色加深', 'Color Burn'],
 ['lighten', '變亮', '变亮', 'Lighten'], ['screen', '濾色', '滤色', 'Screen'], ['colorDodge', '加亮顏色', '颜色减淡', 'Color Dodge'], ['overlay', '覆蓋', '叠加', 'Overlay'],
 ['softLight', '柔光', '柔光', 'Soft Light'], ['hardLight', '實光', '强光', 'Hard Light'], ['difference', '差異化', '差值', 'Difference'], ['exclusion', '排除', '排除', 'Exclusion'],
 ['hue', '色相', '色相', 'Hue'], ['saturation', '飽和度', '饱和度', 'Saturation'], ['color', '顏色', '混色', 'Color'], ['luminosity', '明度', '明度', 'Luminosity']].forEach(([k, a, b, c]) => L3('aifx.blend.' + k, a, b, c));
/* Photoshop 效果的参数名（PS 2020 滤镜库繁／简中介面） */
[['pencilWidth', '鉛筆寬度', '铅笔宽度', 'Pencil Width'], ['strokePressure', '筆觸壓力', '描边压力', 'Stroke Pressure'], ['paperBrightness', '紙張亮度', '纸张亮度', 'Paper Brightness'],
 ['numberOfLevels', '色階數', '色阶数', 'Number of Levels'], ['edgeSimplicity', '邊緣簡化度', '边缘简化度', 'Edge Simplicity'], ['edgeFidelity', '邊緣精確度', '边缘逼真度', 'Edge Fidelity'],
 ['brushSize', '筆刷尺寸', '画笔大小', 'Brush Size'], ['brushDetail', '筆刷細節', '画笔细节', 'Brush Detail'], ['texture', '紋理', '纹理', 'Texture'], ['grain', '粒子', '颗粒', 'Grain'],
 ['highlightArea', '亮部區域', '高光区域', 'Highlight Area'], ['intensity', '強度', '强度', 'Intensity'], ['glowSize', '光暈尺寸', '发光大小', 'Glow Size'], ['glowBrightness', '光暈亮度', '发光亮度', 'Glow Brightness'],
 ['sharpness', '銳利度', '锐化程度', 'Sharpness'], ['brushType', '筆刷類型', '画笔类型', 'Brush Type'], ['strokeSize', '筆觸尺寸', '描边大小', 'Stroke Size'], ['strokeDetail', '筆觸細節', '描边细节', 'Stroke Detail'],
 ['softness', '柔和度', '软化度', 'Softness'], ['highlightStrength', '亮部強度', '高光强度', 'Highlight Strength'], ['detail', '細節', '细节', 'Detail'], ['smoothness', '平滑度', '平滑度', 'Smoothness'],
 ['edgeThickness', '邊緣粗細', '边缘厚度', 'Edge Thickness'], ['edgeIntensity', '邊緣強度', '边缘强度', 'Edge Intensity'], ['posterization', '色調分離', '海报化', 'Posterization'],
 ['strokeLength', '筆觸長度', '描边长度', 'Stroke Length'], ['scaling', '縮放', '缩放', 'Scaling'], ['relief', '浮雕', '凸现', 'Relief'], ['light', '光源', '光照', 'Light'], ['invert', '負片效果', '反相', 'Invert'],
 ['definition', '清晰度', '清晰度', 'Definition'], ['textureCoverage', '紋理覆蓋範圍', '纹理覆盖', 'Texture Coverage'], ['shadowIntensity', '陰影強度', '阴影强度', 'Shadow Intensity'],
 ['edgeWidth', '邊緣寬度', '边缘宽度', 'Edge Width'], ['edgeBrightness', '邊緣亮度', '边缘亮度', 'Edge Brightness'], ['directionBalance', '方向平衡', '方向平衡', 'Direction Balance'],
 ['strength', '強度', '强度', 'Strength'], ['balance', '平衡', '平衡', 'Balance'], ['blackIntensity', '黑色強度', '黑色强度', 'Black Intensity'], ['whiteIntensity', '白色強度', '白色强度', 'White Intensity'],
 ['darkIntensity', '暗部強度', '深色强度', 'Dark Intensity'], ['lightIntensity', '亮部強度', '光照强度', 'Light Intensity'], ['sprayRadius', '噴灑強度', '喷色半径', 'Spray Radius'],
 ['strokeDirection', '筆觸方向', '描边方向', 'Stroke Direction'], ['strokeWidth', '筆觸寬度', '描边宽度', 'Stroke Width'], ['contrast', '對比', '对比度', 'Contrast'],
 ['graininess', '粒子', '粒度', 'Graininess'], ['glowAmount', '光暈量', '发光量', 'Glow Amount'], ['clearAmount', '清除量', '清除数量', 'Clear Amount'], ['distortion', '扭曲', '扭曲度', 'Distortion'],
 ['rippleSize', '波紋尺寸', '波纹大小', 'Ripple Size'], ['rippleMagnitude', '波紋強度', '波纹幅度', 'Ripple Magnitude'], ['charcoalArea', '炭筆區域', '炭笔区', 'Charcoal Area'], ['chalkArea', '粉筆區域', '粉笔区', 'Chalk Area'],
 ['charcoalThickness', '炭筆粗細', '炭笔粗细', 'Charcoal Thickness'], ['lightDarkBalance', '明暗平衡', '明/暗平衡', 'Light/Dark Balance'], ['foregroundLevel', '前景色階', '前景色阶', 'Foreground Level'],
 ['backgroundLevel', '背景色階', '背景色阶', 'Background Level'], ['size', '尺寸', '大小', 'Size'], ['patternType', '圖樣類型', '图案类型', 'Pattern Type'], ['imageBalance', '影像平衡', '图像平衡', 'Image Balance'],
 ['darkness', '暗度', '暗度', 'Darkness'], ['density', '密度', '浓度', 'Density'], ['fiberLength', '纖維長度', '纤维长度', 'Fiber Length'], ['brightness', '亮度', '亮度', 'Brightness'],
 ['crackSpacing', '裂縫間距', '裂缝间距', 'Crack Spacing'], ['crackDepth', '裂縫深度', '裂缝深度', 'Crack Depth'], ['crackBrightness', '裂縫亮度', '裂缝亮度', 'Crack Brightness'],
 ['grainType', '粒子類型', '颗粒类型', 'Grain Type'], ['tileSize', '拼貼尺寸', '拼贴大小', 'Tile Size'], ['groutWidth', '間隙寬度', '缝隙宽度', 'Grout Width'], ['lightenGrout', '間隙加亮', '加亮缝隙', 'Lighten Grout'],
 ['squareSize', '方塊尺寸', '平方大小', 'Square Size'], ['cellSize', '儲存格尺寸', '单元格大小', 'Cell Size'], ['borderThickness', '邊框粗細', '边框粗细', 'Border Thickness'],
 ['amount', '總量', '数量', 'Amount'], ['method', '模糊方式', '模糊方法', 'Blur Method'], ['centerX', '中心 X', '中心 X', 'Center X'], ['centerY', '中心 Y', '中心 Y', 'Center Y'],
 ['radius', '強度', '半径', 'Radius'], ['threshold', '臨界值', '阈值', 'Threshold'], ['quality', '品質', '品质', 'Quality'], ['mode', '模式', '模式', 'Mode'],
 ['maxRadius', '最大強度', '最大半径', 'Max. Radius'], ['channel1', '色版 1', '通道 1', 'Channel 1'], ['channel2', '色版 2', '通道 2', 'Channel 2'], ['channel3', '色版 3', '通道 3', 'Channel 3'], ['channel4', '色版 4', '通道 4', 'Channel 4'],
 ['seed', '隨機種子', '随机种子', 'Seed'], ['type', '類型', '类型', 'Type'], ['eliminate', '刪除', '消除', 'Eliminate'], ['createBy', '建立新圖場以', '创建新场方式', 'Create New Fields by']
].forEach(([k, a, b, c]) => L3('aifx.ps.' + k, a, b, c));
[['canvas', '畫布', '画布', 'Canvas'], ['brick', '磚塊', '砖形', 'Brick'], ['burlap', '粗麻布', '粗麻布', 'Burlap'], ['sandstone', '砂岩', '砂岩', 'Sandstone'],
 ['frosted', '結霜', '磨砂', 'Frosted'], ['blocks', '塊狀', '块状', 'Blocks'], ['tinyLens', '小透鏡', '小镜头', 'Tiny Lens'],
 ['bottom', '下', '下', 'Bottom'], ['bottomLeft', '左下', '左下', 'Bottom Left'], ['left', '左', '左', 'Left'], ['topLeft', '左上', '左上', 'Top Left'], ['top', '上', '上', 'Top'],
 ['topRight', '右上', '右上', 'Top Right'], ['right', '右', '右', 'Right'], ['bottomRight', '右下', '右下', 'Bottom Right'],
 ['simple', '簡單', '简单', 'Simple'], ['lightRough', '淡色粗糙', '未处理光照', 'Light Rough'], ['darkRough', '深色粗糙', '未处理深色', 'Dark Rough'], ['wideSharp', '寬銳利', '宽锐化', 'Wide Sharp'],
 ['wideBlurry', '寬模糊', '宽模糊', 'Wide Blurry'], ['sparkle', '閃爍', '火花', 'Sparkle'],
 ['rightDiagonal', '右斜', '右对角线', 'Right Diagonal'], ['horizontal', '水平', '水平', 'Horizontal'], ['leftDiagonal', '左斜', '左对角线', 'Left Diagonal'], ['vertical', '垂直', '垂直', 'Vertical'],
 ['dot', '點', '网点', 'Dot'], ['circle', '圓形', '圆形', 'Circle'], ['line', '線條', '直线', 'Line'],
 ['regular', '一般', '常规', 'Regular'], ['soft', '柔和', '软化', 'Soft'], ['sprinkles', '灑點', '喷洒', 'Sprinkles'], ['clumped', '結塊', '结块', 'Clumped'], ['contrasty', '高對比', '强反差', 'Contrasty'],
 ['enlarged', '放大', '扩大', 'Enlarged'], ['stippled', '點刻', '点刻', 'Stippled'], ['speckle', '斑點', '斑点', 'Speckle'],
 ['spin', '迴轉', '旋转', 'Spin'], ['zoom', '縮放', '缩放', 'Zoom'], ['high', '高', '高', 'High'], ['medium', '中', '中', 'Medium'], ['low', '低', '低', 'Low'],
 ['normal', '一般', '正常', 'Normal'], ['edgeOnly', '僅限邊緣', '仅限边缘', 'Edge Only'], ['overlayEdge', '覆蓋邊緣', '叠加边缘', 'Overlay Edge'],
 ['fineDots', '精細點', '精细点', 'Fine Dots'], ['mediumDots', '中等點', '中等点', 'Medium Dots'], ['grainyDots', '粒狀點', '粒状点', 'Grainy Dots'], ['coarseDots', '粗網點', '粗网点', 'Coarse Dots'],
 ['shortLines', '短線', '短直线', 'Short Lines'], ['mediumLines', '中長直線', '中长直线', 'Medium Lines'], ['longLines', '長線', '长直线', 'Long Lines'],
 ['shortStrokes', '短筆觸', '短描边', 'Short Strokes'], ['mediumStrokes', '中長筆觸', '中长描边', 'Medium Strokes'], ['longStrokes', '長筆觸', '长描边', 'Long Strokes'],
 ['oddFields', '奇數圖場', '奇数行', 'Odd Fields'], ['evenFields', '偶數圖場', '偶数行', 'Even Fields'], ['interpolation', '內插補點', '插值', 'Interpolation'], ['duplication', '複製', '复制', 'Duplication']
].forEach(([k, a, b, c]) => L3('aifx.ch.' + k, a, b, c));
/* 滤镜库清单的名字：取我们效果菜单里的正名 */
Object.keys(GAL).forEach(k => {
  const e = PS_FX.find(x => x.gallery === k), it = e && (window.MenuTrees ? (() => { let h = null; MenuTrees.walk('ai', i => { if (!h && i.id === e.menu) h = i; }); return h; })() : null);
  const n = it ? it.n : {'zh-Hant':k, 'zh-Hans':k, en:k};
  L3('aifx.gal.' + k, String(n['zh-Hant']).replace(/…$/, ''), String(n['zh-Hans']).replace(/…$/, ''), String(n.en).replace(/…$/, ''));
});
if (window.Lang) Lang.add(STR);

Object.assign(AiFx, {CAT, PS_FX, Dlg, syncPs, merged, fxTitle, docUnit, artOf, cachedArt, rasterList, applyGeometry, applyOne, geomOf, boundsG, noise, warpPoint, pathfinder, targets, rfxSettings, hasFx, installHook});
window.AiFx = AiFx;
if (window.UI && UI.draw) UI.draw();
})();
