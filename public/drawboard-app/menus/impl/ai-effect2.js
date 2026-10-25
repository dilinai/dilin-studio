/* 堤麟画板 · Illustrator ▸ 效果 其余项——原码（VectorCraft）这几项都没有：SVG 滤镜是 todo、外框物件／栅格化效果／实色混合／透明混合／陷印原码根本没有，
   一律照 AI 2020 的行为做成浏览器里能用的版本：
     · SVG 滤镜：AI 内建 19 款（菜单表上那 19 个 AI_*）写成 <filter> 定义；画面用本档自带的 SVG 滤镜解释器（JS 逐像素，照 SVG 1.1 滤镜规范：
       linearRGB 色彩空间、预乘 alpha、feTurbulence 照规范附的参考程序）在 canvas 上算出同样效果；导出 SVG 原样带 <filter>。
       解释器不认识的原语（feImage／feConvolveMatrix／feTile…）退回浏览器自己的 SVG 滤镜（canvas ctx.filter='url(#…)'）。
       「导入 SVG 滤镜…」读 .svg 档里的 <filter>，存进文件（Doc.aiSvgFilters，进历史、存工程档）；「应用 SVG 滤镜…」对话框照 AI：清单＋编辑 XML＋新建／删除＋预览。
     · 外框物件：登记成 AiFx 的几何效果（path.outlineObject：活形状在外观里先变成路径；视觉不变，扩展外观＝烘成路径）。
     · 实色混合／透明混合／陷印：照 AI 的路径查找器效果，对编组求值成真的矢量面（AIObj.arrangement 平面排列）：
       实色混合＝重叠处每个色版取最深（CMYK 取最高值＝RGB 取最低）；透明混合＝上层油墨按「混合比率」叠印在下层上（下层 × 淡化到比率的上层）；
       陷印＝相邻两色交界处加一条「较浅色往较深色扩」的细带（粗细、高宽比、色调减低、反向陷印；带子颜色＝浅色淡化后叠印在深色上）。
     · 栅格化（效果版）：活的、可还原（跟 物件 ▸ 栅格化／layer.rasterize 的破坏性转像素不同）：照 object.rasterize（VectorCraft engine/src/cmd/menucmds.rs:362）
       的参数（ppi／颜色模型／背景／消除锯齿／剪切蒙版／周围添加），预设取 文档栅格效果设置；画面与导出都按 ppi 真的变成像素。
   资料：跟 AiFx 一样存在形状的 s.effects 里（{id, params, visible}），id ∈ svgFilter、rasterize、pathfinder.hardMix、pathfinder.softMix、pathfinder.trap、path.outlineObject，
     所以历史快照、工程档、ai.effect.remove／setParams／move／duplicate 都直接适用。渲染：再包一层 ObjRender（在 AiFx 外面）：
     先算矢量类（混合／陷印）→ 交给里面（AiFx 的几何／点阵效果照旧）→ 再按堆叠顺序套本档的点阵类（SVG 滤镜／栅格化）。
   命令：ai.effect.svgFilter.apply／.dialog／import／import.dialog／define／remove／list、ai.effect.svgFilter.<AI_…>（菜单项）、ai.effect.path.outlineObject、
     ai.effect.pathfinder.hardMix／softMix／trap（＋.dialog）、ai.effect.rasterize（＋.dialog）。 */
(function(){
'use strict';
if (window.AiFx2) return;
if (!window.AiFx){ console.error('ai-effect2: 要先载 menus/impl/ai-effect.js（AiFx）'); return; }
const FX = window.AiFx;

/* ═════════════ 小工具 ═════════════ */
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const T = k => (window.Lang ? Lang.t(k) : k);
const numOf = (v, d) => { const n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : d; };
const MINE = ['svgFilter', 'rasterize', 'pathfinder.hardMix', 'pathfinder.softMix', 'pathfinder.trap'];
const RASTER = ['svgFilter', 'rasterize'];
const VECTOR = ['pathfinder.hardMix', 'pathfinder.softMix', 'pathfinder.trap'];
const myFx = s => (s && Array.isArray(s.effects)) ? s.effects.filter(e => e && e.visible !== false && MINE.includes(e.id)) : [];
const hasMine = s => !!s && s.visible !== false && myFx(s).length > 0;
const stripMine = s => { const b = clone(s); if (Array.isArray(b.effects)){ b.effects = b.effects.filter(e => !(e && MINE.includes(e.id))); if (!b.effects.length) delete b.effects; } return b; };

/* 颜色字串 → [r,g,b]（0..255）；渐变／无 ⇒ null */
const _cc = document.createElement('canvas').getContext('2d');
function rgbOf(c){
  if (typeof c !== 'string' || !c || c === 'none') return null;
  _cc.fillStyle = '#000'; _cc.fillStyle = c; const v = _cc.fillStyle;
  if (v[0] === '#') return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
  const m = v.match(/[\d.]+/g); return m ? [+m[0], +m[1], +m[2]] : null;
}
const hex = c => '#' + c.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
const lum = c => 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];

/* ═════════════ 预设参数（agent 与对话框共用）═════════════ */
const rfx = () => (FX.rfxSettings ? FX.rfxSettings() : {resolution:72, colorModel:'rgb', background:'transparent', antiAlias:true, clippingMask:false, addAround:0});
const DEF = {
  'pathfinder.hardMix': () => ({}),
  'pathfinder.softMix': () => ({rate:50}),
  // AI 2020「路径查找器选项」陷印设置：粗细 0.25pt、高度／宽度 100%、色调减低 40%、使用印刷色陷印、反向陷印
  'pathfinder.trap': () => ({thickness:0.25, heightWidth:100, tintReduction:40, processColor:false, reverse:false}),
  // object.rasterize 的参数（menucmds.rs:98），预设取文档栅格效果设置（menus.rs:2303）
  rasterize: () => { const r = rfx(); return {ppi:r.resolution, colorModel:r.colorModel === 'document' ? 'rgb' : r.colorModel, background:r.background, antiAlias:r.antiAlias !== false, clippingMask:!!r.clippingMask, addAround:r.addAround || 0}; },
  svgFilter: () => ({name:'AI_GaussianBlur_4'})
};
const DOCS = {
  'pathfinder.hardMix': '{} 实色混合（编组）：重叠处每个色版取最深（CMYK 取最高值＝RGB 每通道取最低），分成一块块面',
  'pathfinder.softMix': '{rate: 混合比率 % 0..100 (50)} 透明混合（编组）：上层油墨淡化到比率、叠印在下层上（下层 × 淡化后的上层），分成一块块面',
  'pathfinder.trap': '{thickness: pt 0.01..5000 (0.25), heightWidth: % 25..400 (100，水平／垂直粗细比), tintReduction: % 0..100 (40), processColor: bool (false，存着；我们只有 RGB), reverse: bool (false，反向陷印＝深色往浅色扩)} 陷印（编组）：相邻异色交界加一条较浅色往较深色扩的细带（带子＝浅色淡化后叠印在深色上）',
  rasterize: '{ppi?: 1..2400（预设＝文档栅格效果设置）, colorModel?: "rgb"|"grayscale"|"bitmap", background?: "transparent"|"white"|"black"|"#rrggbb", antiAlias?: bool, clippingMask?: bool（背景只垫在物件轮廓里）, addAround?: pt 0..1000} 栅格化（效果版，活的）：外观按 ppi 变成像素；跟 物件 ▸ 栅格化（破坏性转像素层）不同',
  svgFilter: '{name: 内建 AI_*（ai.effect.svgFilter.list）或已导入的滤镜名, xml?: "<filter …>…</filter>"（自订；给了就用它）} 套 SVG 滤镜（活效果；导出 SVG 带 <filter>）'
};
function cleanParams(id, p){
  const d = DEF[id](), o = Object.assign(d, (p && typeof p === 'object') ? clone(p) : {});
  if (id === 'pathfinder.softMix') o.rate = clamp(numOf(o.rate, 50), 0, 100);
  if (id === 'pathfinder.trap'){
    o.thickness = clamp(numOf(o.thickness, 0.25), 0.01, 5000); o.heightWidth = clamp(numOf(o.heightWidth, 100), 25, 400);
    o.tintReduction = clamp(numOf(o.tintReduction, 40), 0, 100); o.processColor = !!o.processColor; o.reverse = !!o.reverse;
  }
  if (id === 'rasterize'){
    const ppiMap = {screen:72, medium:150, high:300};
    o.ppi = typeof o.ppi === 'string' && ppiMap[o.ppi.toLowerCase()] ? ppiMap[o.ppi.toLowerCase()] : numOf(o.ppi, 72);
    if (!(o.ppi >= 1 && o.ppi <= 2400)) throw new Error('ppi must be between 1 and 2400');
    o.colorModel = String(o.colorModel || 'rgb').toLowerCase(); if (o.colorModel === 'gray') o.colorModel = 'grayscale'; if (o.colorModel === 'document') o.colorModel = 'rgb';
    if (!['rgb', 'grayscale', 'bitmap'].includes(o.colorModel)) throw new Error('colorModel must be rgb, grayscale or bitmap');
    o.background = String(o.background || 'transparent').toLowerCase();
    if (!['transparent', 'white', 'black'].includes(o.background) && !/^#[0-9a-f]{6}$/.test(o.background)) throw new Error('background must be transparent, white, black or #rrggbb');
    if (typeof o.antiAlias === 'string') o.antiAlias = o.antiAlias !== 'none'; else o.antiAlias = o.antiAlias !== false;
    o.clippingMask = !!o.clippingMask;
    o.addAround = numOf(o.addAround !== undefined ? o.addAround : o.padding, 0); delete o.padding;
    if (!(o.addAround >= 0 && o.addAround <= 1000)) throw new Error('addAround must be 0–1000 pt');
  }
  return o;
}

/* ═════════════ AI 2020 内建 SVG 滤镜（菜单表上 19 款；AI_Shadow_1 照 Adobe 社群贴出的 AI 导出原文，其余照名称语意写）═════════════ */
const OBB = (x, w) => `filterUnits="objectBoundingBox" x="${x}" y="${x}" width="${w}" height="${w}"`;
const BUILTIN = {
  // Alpha：边缘的不透明度渐隐（物件 alpha 先模糊再剪回原形状），数字＝模糊程度
  AI_Alpha_1: `<filter id="AI_Alpha_1" ${OBB('-10%', '120%')}><feGaussianBlur in="SourceAlpha" stdDeviation="1" result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/></filter>`,
  AI_Alpha_4: `<filter id="AI_Alpha_4" ${OBB('-10%', '120%')}><feGaussianBlur in="SourceAlpha" stdDeviation="4" result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/></filter>`,
  // 斜角＋投影（SVG 规范经典的打光范例：模糊的 alpha 当高度图、镜面光、往右下投影）
  AI_BevelShadow_1: `<filter id="AI_BevelShadow_1" ${OBB('-25%', '150%')}><feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur"/><feOffset in="blur" dx="4" dy="4" result="offsetBlurredAlpha"/>` +
    `<feSpecularLighting in="blur" surfaceScale="5" specularConstant="1" specularExponent="10" lighting-color="#FFFFFF" result="specularOut"><fePointLight x="-5000" y="-10000" z="20000"/></feSpecularLighting>` +
    `<feComposite in="specularOut" in2="SourceAlpha" operator="in" result="specularOut"/><feComposite in="SourceGraphic" in2="specularOut" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="litPaint"/>` +
    `<feMerge><feMergeNode in="offsetBlurredAlpha"/><feMergeNode in="litPaint"/></feMerge></filter>`,
  // 凉风：低频杂讯把边缘吹散
  AI_CoolBreeze: `<filter id="AI_CoolBreeze" ${OBB('-10%', '120%')}><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="1" seed="1" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="10" xChannelSelector="R" yChannelSelector="G"/></filter>`,
  AI_Dilate_3: `<filter id="AI_Dilate_3" ${OBB('-50%', '200%')}><feMorphology operator="dilate" radius="3"/></filter>`,
  AI_Dilate_6: `<filter id="AI_Dilate_6" ${OBB('-50%', '200%')}><feMorphology operator="dilate" radius="6"/></filter>`,
  AI_Erode_3: `<filter id="AI_Erode_3" ${OBB('-10%', '120%')}><feMorphology operator="erode" radius="3"/></filter>`,
  AI_Erode_6: `<filter id="AI_Erode_6" ${OBB('-10%', '120%')}><feMorphology operator="erode" radius="6"/></filter>`,
  AI_GaussianBlur_4: `<filter id="AI_GaussianBlur_4" ${OBB('-50%', '200%')}><feGaussianBlur stdDeviation="4"/></filter>`,
  AI_GaussianBlur_7: `<filter id="AI_GaussianBlur_7" ${OBB('-50%', '200%')}><feGaussianBlur stdDeviation="7"/></filter>`,
  // 网绘：乱流杂讯取门槛当网状遮罩
  AI_Netpainting_1: `<filter id="AI_Netpainting_1" ${OBB('-10%', '120%')}><feTurbulence type="turbulence" baseFrequency="0.1" numOctaves="1" seed="3" result="t"/>` +
    `<feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  4 0 0 0 -0.6" result="n"/><feComposite in="SourceGraphic" in2="n" operator="in"/></filter>`,
  // 像素游戏：色调分离（1＝每通道 4 阶、2＝每通道 2 阶）
  AI_PixelPlay_1: `<filter id="AI_PixelPlay_1" ${OBB('-10%', '120%')} color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="discrete" tableValues="0 0.33 0.67 1"/><feFuncG type="discrete" tableValues="0 0.33 0.67 1"/><feFuncB type="discrete" tableValues="0 0.33 0.67 1"/></feComponentTransfer></filter>`,
  AI_PixelPlay_2: `<filter id="AI_PixelPlay_2" ${OBB('-10%', '120%')} color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="discrete" tableValues="0 1"/><feFuncG type="discrete" tableValues="0 1"/><feFuncB type="discrete" tableValues="0 1"/></feComponentTransfer></filter>`,
  // 投影（AI 导出原文）
  AI_Shadow_1: `<filter id="AI_Shadow_1" filterUnits="objectBoundingBox"><feGaussianBlur in="SourceAlpha" result="blur" stdDeviation="2"/><feOffset dx="4" dy="4" in="blur" result="offsetBlurredAlpha"/><feMerge><feMergeNode in="offsetBlurredAlpha"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
  AI_Shadow_2: `<filter id="AI_Shadow_2" ${OBB('-20%', '150%')}><feGaussianBlur in="SourceAlpha" result="blur" stdDeviation="3"/><feOffset dx="7" dy="7" in="blur" result="o"/>` +
    `<feComponentTransfer in="o" result="s"><feFuncA type="linear" slope="0.6"/></feComponentTransfer><feMerge><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
  // 杂讯（电视雪花）：高频灰阶杂讯叠在物件上
  AI_Static: `<filter id="AI_Static" ${OBB('-10%', '120%')}><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="1" seed="5" result="n"/><feColorMatrix in="n" type="saturate" values="0" result="g"/>` +
    `<feComposite in="g" in2="SourceGraphic" operator="arithmetic" k1="0" k2="0.45" k3="0.8" k4="-0.15" result="m"/><feComposite in="m" in2="SourceAlpha" operator="in"/></filter>`,
  // 乱流：乱流杂讯位移，数字＝倍频层数
  AI_Turbulence_3: `<filter id="AI_Turbulence_3" ${OBB('-10%', '120%')}><feTurbulence type="turbulence" baseFrequency="0.03" numOctaves="3" seed="0" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="8" xChannelSelector="R" yChannelSelector="G"/></filter>`,
  AI_Turbulence_5: `<filter id="AI_Turbulence_5" ${OBB('-10%', '120%')}><feTurbulence type="turbulence" baseFrequency="0.03" numOctaves="5" seed="0" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="14" xChannelSelector="R" yChannelSelector="G"/></filter>`,
  // 木纹：横向拉长的杂讯调成木色、正片叠底在物件上
  AI_Woodgrain: `<filter id="AI_Woodgrain" ${OBB('-10%', '120%')}><feTurbulence type="fractalNoise" baseFrequency="0.01 0.2" numOctaves="3" seed="2" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="0.9 0 0 0 0.2  0.6 0 0 0 0.1  0.3 0 0 0 0.02  0 0 0 0 1" result="w"/><feBlend in="w" in2="SourceGraphic" mode="multiply" result="b"/><feComposite in="b" in2="SourceAlpha" operator="in"/></filter>`
};
const BUILTIN_NAMES = Object.keys(BUILTIN);

/* 文件里导入的滤镜（名 → XML）：进历史、存工程档、算进内容签名 */
const lib = () => Doc.aiSvgFilters || {};
function filterXml(params){
  if (params && typeof params.xml === 'string' && /<filter[\s>]/.test(params.xml)) return params.xml;
  const n = params && params.name;
  return (n && (lib()[n] || BUILTIN[n])) || null;
}
if (!History.__aiFx2Hook){
  History.__aiFx2Hook = true;
  const snap = History.snap;
  History.snap = function(){ const s = snap.apply(this, arguments); s.aiSvgFilters = Doc.aiSvgFilters ? clone(Doc.aiSvgFilters) : null; return s; };
  ['restore', 'restoreInPlace'].forEach(k => { const o = History[k]; History[k] = function(s){ const r = o.apply(this, arguments); if (s && 'aiSvgFilters' in s) Doc.aiSvgFilters = s.aiSvgFilters ? clone(s.aiSvgFilters) : undefined; return r; }; });
}
if (!Doc.__aiFx2Hook){
  Doc.__aiFx2Hook = true;
  const reset = Doc.reset;
  Doc.reset = function(){ Doc.aiSvgFilters = undefined; artCache.clear(); return reset.apply(this, arguments); };
}
if (!Project.__aiFx2Hook){
  Project.__aiFx2Hook = true;
  const ser = Project.serialize, load = Project.load;
  Project.serialize = function(){ const o = ser.apply(this, arguments); if (Doc.aiSvgFilters && Object.keys(Doc.aiSvgFilters).length) o.aiSvgFilters = clone(Doc.aiSvgFilters); return o; };
  Project.load = async function(json){ const r = await load.apply(this, arguments); Doc.aiSvgFilters = (json && json.aiSvgFilters) ? clone(json.aiSvgFilters) : undefined; return r; };
}
if (window.SiteHooks && Array.isArray(SiteHooks.extraSigs) && !SiteHooks.__aiFx2Sig){ SiteHooks.__aiFx2Sig = true; SiteHooks.extraSigs.push(() => 'svgf:' + JSON.stringify(Doc.aiSvgFilters || null)); }

/* ═════════════ SVG 滤镜解释器（SVG 1.1 §15；画面上用它，跟导出 SVG 的 <filter> 同一份定义）═════════════
   缓冲：Float32Array W*H*4、预乘 alpha、0..1，带色彩空间标记 sp ∈ 'srgb'|'linear'。
   映射：使用者坐标 u → 像素 (u - ox) * k（各向同性）；filterUnits／primitiveUnits 照规范；外框 bbox 用使用者坐标。 */
const LUT_N = 4096, S2L = new Float32Array(LUT_N + 1), L2S = new Float32Array(LUT_N + 1);
for (let i = 0; i <= LUT_N; i++){ const v = i / LUT_N; S2L[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); L2S[i] = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
const lut = (t, v) => t[Math.round(clamp(v, 0, 1) * LUT_N)];
function convert(buf, to){
  if (buf.sp === to) return buf;
  const d = buf.d, o = new Float32Array(d.length), t = to === 'linear' ? S2L : L2S;
  for (let i = 0; i < d.length; i += 4){
    const a = d[i + 3]; o[i + 3] = a; if (a <= 0) continue;
    o[i] = lut(t, d[i] / a) * a; o[i + 1] = lut(t, d[i + 1] / a) * a; o[i + 2] = lut(t, d[i + 2] / a) * a;
  }
  return {d:o, sp:to};
}
const NS = 'http://www.w3.org/2000/svg';
function parseFilter(xml){
  const doc = new DOMParser().parseFromString(`<svg xmlns="${NS}">${xml}</svg>`, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('SVG filter: XML parse error');
  const f = doc.getElementsByTagNameNS(NS, 'filter')[0];
  if (!f) throw new Error('SVG filter: no <filter> element');
  return f;
}
const parsedCache = new Map();
function parsed(xml){ let f = parsedCache.get(xml); if (!f){ f = parseFilter(xml); if (parsedCache.size > 200) parsedCache.clear(); parsedCache.set(xml, f); } return f; }
const SUPPORTED = new Set(['feGaussianBlur', 'feOffset', 'feFlood', 'feMerge', 'feComposite', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feMorphology',
  'feTurbulence', 'feDisplacementMap', 'feSpecularLighting', 'feDiffuseLighting', 'feDropShadow']);
const prims = f => Array.from(f.children).filter(e => /^fe/.test(e.localName));
const canInterpret = f => prims(f).every(e => SUPPORTED.has(e.localName));
/* 长度：数字或百分比（相对 ref） */
function len(v, d, ref){ if (v == null || v === '') return d; const s = String(v).trim(); if (s.endsWith('%')) return parseFloat(s) / 100 * (ref === undefined ? 1 : ref); const n = parseFloat(s); return isFinite(n) ? n : d; }
const nums = v => String(v || '').trim().split(/[\s,]+/).filter(Boolean).map(Number).filter(isFinite);
/* 滤镜区域（使用者坐标） */
function filterRegion(f, bb){
  const obb = (f.getAttribute('filterUnits') || 'objectBoundingBox') === 'objectBoundingBox';
  if (obb){
    const fx = len(f.getAttribute('x'), -0.1), fy = len(f.getAttribute('y'), -0.1), fw = len(f.getAttribute('width'), 1.2), fh = len(f.getAttribute('height'), 1.2);
    return {x0:bb.x0 + fx * (bb.x1 - bb.x0), y0:bb.y0 + fy * (bb.y1 - bb.y0), x1:bb.x0 + (fx + fw) * (bb.x1 - bb.x0), y1:bb.y0 + (fy + fh) * (bb.y1 - bb.y0)};
  }
  const w = bb.x1 - bb.x0, h = bb.y1 - bb.y0;
  const x = len(f.getAttribute('x'), bb.x0 - 0.1 * w), y = len(f.getAttribute('y'), bb.y0 - 0.1 * h);
  return {x0:x, y0:y, x1:x + len(f.getAttribute('width'), 1.2 * w), y1:y + len(f.getAttribute('height'), 1.2 * h)};
}

/* ── 各原语 ── */
function boxBlur1(src, dst, W, H, r, horiz, off){   // 一次方框模糊（宽 2r+1 或偶数宽时 off 偏一格）
  const n = horiz ? W : H, m = horiz ? H : W, size = 2 * r + 1 - (off !== undefined ? 1 : 0), lo = off !== undefined ? r - off : r;
  const acc = new Float64Array(4);
  for (let j = 0; j < m; j++){
    acc.fill(0);
    const idx = i => horiz ? (j * W + i) * 4 : (i * W + j) * 4;
    for (let i = -lo; i < size - lo; i++) if (i >= 0 && i < n){ const q = idx(i); acc[0] += src[q]; acc[1] += src[q + 1]; acc[2] += src[q + 2]; acc[3] += src[q + 3]; }
    for (let i = 0; i < n; i++){
      const q = idx(i); dst[q] = acc[0] / size; dst[q + 1] = acc[1] / size; dst[q + 2] = acc[2] / size; dst[q + 3] = acc[3] / size;
      const a = i - lo, b = i - lo + size;
      if (a >= 0 && a < n){ const p = idx(a); acc[0] -= src[p]; acc[1] -= src[p + 1]; acc[2] -= src[p + 2]; acc[3] -= src[p + 3]; }
      if (b >= 0 && b < n){ const p = idx(b); acc[0] += src[p]; acc[1] += src[p + 1]; acc[2] += src[p + 2]; acc[3] += src[p + 3]; }
    }
  }
}
function gaussKernel1(src, W, H, s, horiz){
  const r = Math.ceil(s * 3), k = []; let sum = 0;
  for (let i = -r; i <= r; i++){ const v = Math.exp(-i * i / (2 * s * s)); k.push(v); sum += v; }
  const out = new Float32Array(src.length), n = horiz ? W : H, m = horiz ? H : W;
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++){
    let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
    for (let t = -r; t <= r; t++){ const ii = i + t; if (ii < 0 || ii >= n) continue; const q = horiz ? (j * W + ii) * 4 : (ii * W + j) * 4, w = k[t + r]; a0 += src[q]*w; a1 += src[q+1]*w; a2 += src[q+2]*w; a3 += src[q+3]*w; }
    const q = horiz ? (j * W + i) * 4 : (i * W + j) * 4; out[q] = a0/sum; out[q+1] = a1/sum; out[q+2] = a2/sum; out[q+3] = a3/sum;
  }
  return out;
}
/* 规范 §15.17：σ ≥ 2 用三次方框模糊近似（d 奇数：三次都以像素为中心；d 偶数：前两次各偏半格、第三次宽 d+1 置中）；小于 2 用真高斯 */
function gaussian(src, W, H, sx, sy){
  let d = src;
  const pass = (s, horiz) => {
    if (!(s > 0)) return;
    if (s < 2){ d = gaussKernel1(d, W, H, s, horiz); return; }
    const D = Math.floor(s * 3 * Math.sqrt(2 * Math.PI) / 4 + 0.5);
    const a = new Float32Array(d.length), b = new Float32Array(d.length);
    if (D % 2 === 1){ const r = (D - 1) / 2; boxBlur1(d, a, W, H, r, horiz); boxBlur1(a, b, W, H, r, horiz); boxBlur1(b, a, W, H, r, horiz); d = a; }
    else { const r = D / 2; boxBlur1(d, a, W, H, r, horiz, 1); boxBlur1(a, b, W, H, r, horiz, 0); boxBlur1(b, a, W, H, r, horiz); d = a; }
  };
  pass(sx, true); pass(sy, false);
  return d === src ? new Float32Array(src) : d;
}
function offset(src, W, H, dx, dy){
  const o = new Float32Array(src.length), ix = Math.round(dx), iy = Math.round(dy);
  for (let y = 0; y < H; y++){ const sy = y - iy; if (sy < 0 || sy >= H) continue; for (let x = 0; x < W; x++){ const sx = x - ix; if (sx < 0 || sx >= W) continue; const p = (y * W + x) * 4, q = (sy * W + sx) * 4; o[p] = src[q]; o[p+1] = src[q+1]; o[p+2] = src[q+2]; o[p+3] = src[q+3]; } }
  return o;
}
function morph(src, W, H, rx, ry, dilate){
  const pick = dilate ? Math.max : Math.min;
  const run = (s, r, horiz) => {
    if (r <= 0) return s;
    const o = new Float32Array(s.length), n = horiz ? W : H, m = horiz ? H : W;
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++){
      const q = horiz ? (j * W + i) * 4 : (i * W + j) * 4;
      for (let c = 0; c < 4; c++){
        let v = dilate ? 0 : 1;
        for (let t = -r; t <= r; t++){ const ii = i + t; const val = (ii < 0 || ii >= n) ? 0 : s[(horiz ? (j * W + ii) : (ii * W + j)) * 4 + c]; v = pick(v, val); }
        o[q + c] = v;
      }
    }
    return o;
  };
  return run(run(src, rx, true), ry, false);
}
function unpre(d, i){ const a = d[i + 3]; return a > 0 ? [d[i] / a, d[i+1] / a, d[i+2] / a, a] : [0, 0, 0, 0]; }
function colorMatrix(src, el){
  const type = el.getAttribute('type') || 'matrix', vals = nums(el.getAttribute('values'));
  let M;
  if (type === 'saturate'){ const s = vals.length ? vals[0] : 1; M = [0.213+0.787*s, 0.715-0.715*s, 0.072-0.072*s, 0, 0, 0.213-0.213*s, 0.715+0.285*s, 0.072-0.072*s, 0, 0, 0.213-0.213*s, 0.715-0.715*s, 0.072+0.928*s, 0, 0, 0, 0, 0, 1, 0]; }
  else if (type === 'hueRotate'){ const a = (vals.length ? vals[0] : 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    M = [0.213+c*0.787-s*0.213, 0.715-c*0.715-s*0.715, 0.072-c*0.072+s*0.928, 0, 0, 0.213-c*0.213+s*0.143, 0.715+c*0.285+s*0.140, 0.072-c*0.072-s*0.283, 0, 0, 0.213-c*0.213-s*0.787, 0.715-c*0.715+s*0.715, 0.072+c*0.928+s*0.072, 0, 0, 0, 0, 0, 1, 0]; }
  else if (type === 'luminanceToAlpha') M = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2125, 0.7154, 0.0721, 0, 0];
  else M = vals.length === 20 ? vals : [1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0];
  const o = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 4){
    const [r, g, b, a] = unpre(src, i);
    const na = clamp(M[15]*r + M[16]*g + M[17]*b + M[18]*a + M[19], 0, 1);
    o[i] = clamp(M[0]*r + M[1]*g + M[2]*b + M[3]*a + M[4], 0, 1) * na; o[i+1] = clamp(M[5]*r + M[6]*g + M[7]*b + M[8]*a + M[9], 0, 1) * na;
    o[i+2] = clamp(M[10]*r + M[11]*g + M[12]*b + M[13]*a + M[14], 0, 1) * na; o[i+3] = na;
  }
  return o;
}
function transferFn(el){
  if (!el) return null;
  const type = el.getAttribute('type') || 'identity', tv = nums(el.getAttribute('tableValues'));
  const slope = len(el.getAttribute('slope'), 1), icpt = len(el.getAttribute('intercept'), 0), amp = len(el.getAttribute('amplitude'), 1), ex = len(el.getAttribute('exponent'), 1), off = len(el.getAttribute('offset'), 0);
  switch (type){
    case 'table': if (!tv.length) return null; return C => { const n = tv.length - 1; if (n === 0) return tv[0]; const k = Math.min(Math.floor(C * n), n - 1); return tv[k] + (C * n - k) * (tv[k + 1] - tv[k]); };
    case 'discrete': if (!tv.length) return null; return C => tv[Math.min(Math.floor(C * tv.length), tv.length - 1)];
    case 'linear': return C => slope * C + icpt;
    case 'gamma': return C => amp * Math.pow(C, ex) + off;
  }
  return null;
}
function componentTransfer(src, el){
  const get = n => transferFn(Array.from(el.children).find(c => c.localName === n));
  const F = [get('feFuncR'), get('feFuncG'), get('feFuncB'), get('feFuncA')];
  const o = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 4){
    const u = unpre(src, i), v = u.map((c, k) => F[k] ? clamp(F[k](c), 0, 1) : c);
    o[i] = v[0] * v[3]; o[i+1] = v[1] * v[3]; o[i+2] = v[2] * v[3]; o[i+3] = v[3];
  }
  return o;
}
function composite(A, B, el){
  const op = el.getAttribute('operator') || 'over', o = new Float32Array(A.length);
  const k1 = len(el.getAttribute('k1'), 0), k2 = len(el.getAttribute('k2'), 0), k3 = len(el.getAttribute('k3'), 0), k4 = len(el.getAttribute('k4'), 0);
  for (let i = 0; i < A.length; i += 4){
    const aa = A[i + 3], ab = B[i + 3];
    let fa, fb;
    switch (op){
      case 'in': fa = ab; fb = 0; break; case 'out': fa = 1 - ab; fb = 0; break; case 'atop': fa = ab; fb = 1 - aa; break;
      case 'xor': fa = 1 - ab; fb = 1 - aa; break;
      case 'arithmetic': {
        const na = clamp(k1*aa*ab + k2*aa + k3*ab + k4, 0, 1); o[i+3] = na;
        for (let c = 0; c < 3; c++) o[i + c] = clamp(k1*A[i+c]*B[i+c] + k2*A[i+c] + k3*B[i+c] + k4, 0, na);
        continue;
      }
      default: fa = 1; fb = 1 - aa;
    }
    for (let c = 0; c < 4; c++) o[i + c] = A[i + c] * fa + B[i + c] * fb;
  }
  return o;
}
const BLENDF = {
  normal:(b, s) => s, multiply:(b, s) => b * s, screen:(b, s) => b + s - b * s, darken:(b, s) => Math.min(b, s), lighten:(b, s) => Math.max(b, s),
  overlay:(b, s) => b <= 0.5 ? 2 * s * b : 1 - 2 * (1 - s) * (1 - b), 'hard-light':(b, s) => s <= 0.5 ? 2 * s * b : 1 - 2 * (1 - s) * (1 - b),
  'color-dodge':(b, s) => b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)), 'color-burn':(b, s) => b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s),
  'soft-light':(b, s) => { if (s <= 0.5) return b - (1 - 2*s) * b * (1 - b); const D = b <= 0.25 ? ((16*b - 12) * b + 4) * b : Math.sqrt(b); return b + (2*s - 1) * (D - b); },
  difference:(b, s) => Math.abs(b - s), exclusion:(b, s) => b + s - 2 * b * s
};
function blend(S, B, el){   // in＝上层（来源），in2＝底下
  const f = BLENDF[el.getAttribute('mode') || 'normal'] || BLENDF.normal, o = new Float32Array(S.length);
  for (let i = 0; i < S.length; i += 4){
    const as = S[i + 3], ab = B[i + 3];
    o[i + 3] = as + ab - as * ab;
    for (let c = 0; c < 3; c++){ const cs = S[i + c], cb = B[i + c]; const mix = (as > 0 && ab > 0) ? f(cb / ab, cs / as) : 0; o[i + c] = cs * (1 - ab) + cb * (1 - as) + as * ab * mix; }
  }
  return o;
}
/* feTurbulence：SVG 1.1 §15.25 附的参考程序逐行翻 */
function turbInit(seed){
  const RAND_m = 2147483647, RAND_a = 16807, RAND_q = 127773, RAND_r = 2836, B = 256;
  let s = seed; if (s <= 0) s = -(s % (RAND_m - 1)) + 1; if (s > RAND_m - 1) s = RAND_m - 1;
  const rnd = () => { let r = RAND_a * (s % RAND_q) - RAND_r * Math.floor(s / RAND_q); if (r <= 0) r += RAND_m; s = r; return r; };
  const lat = new Int32Array(B + B + 2), grad = [0, 1, 2, 3].map(() => new Float64Array((B + B + 2) * 2));
  let i, j, k;
  for (k = 0; k < 4; k++) for (i = 0; i < B; i++){
    lat[i] = i;
    for (j = 0; j < 2; j++) grad[k][i * 2 + j] = ((rnd() % (B + B)) - B) / B;
    const g0 = grad[k][i * 2], g1 = grad[k][i * 2 + 1], n = Math.sqrt(g0 * g0 + g1 * g1);
    grad[k][i * 2] = g0 / n; grad[k][i * 2 + 1] = g1 / n;
  }
  i = B;
  while (--i){ k = lat[i]; j = rnd() % B; lat[i] = lat[j]; lat[j] = k; }
  for (i = 0; i < B + 2; i++){ lat[B + i] = lat[i]; for (k = 0; k < 4; k++) for (j = 0; j < 2; j++) grad[k][(B + i) * 2 + j] = grad[k][i * 2 + j]; }
  return {lat, grad};
}
function noise2(T0, ch, vx, vy, st){
  const BM = 255, PN = 4096;
  let t = vx + PN; let bx0 = (Math.trunc(t)) & BM, bx1 = (bx0 + 1) & BM; const rx0 = t - Math.trunc(t), rx1 = rx0 - 1;
  t = vy + PN; let by0 = (Math.trunc(t)) & BM, by1 = (by0 + 1) & BM; const ry0 = t - Math.trunc(t), ry1 = ry0 - 1;
  if (st){
    if (bx0 >= st.wrapX) bx0 -= st.width; if (bx1 >= st.wrapX) bx1 -= st.width;
    if (by0 >= st.wrapY) by0 -= st.height; if (by1 >= st.wrapY) by1 -= st.height;
  }
  bx0 &= BM; bx1 &= BM; by0 &= BM; by1 &= BM;
  const L = T0.lat, G = T0.grad[ch];
  const i = L[bx0], j = L[bx1], b00 = L[i + by0], b10 = L[j + by0], b01 = L[i + by1], b11 = L[j + by1];
  const sx = rx0 * rx0 * (3 - 2 * rx0), sy = ry0 * ry0 * (3 - 2 * ry0);
  let u = rx0 * G[b00 * 2] + ry0 * G[b00 * 2 + 1], v = rx1 * G[b10 * 2] + ry0 * G[b10 * 2 + 1];
  const a = u + sx * (v - u);
  u = rx0 * G[b01 * 2] + ry1 * G[b01 * 2 + 1]; v = rx1 * G[b11 * 2] + ry1 * G[b11 * 2 + 1];
  const b = u + sx * (v - u);
  return a + sy * (b - a);
}
const turbCache = new Map();
function turbulence(el, W, H, map, reg, bb){
  const bf = nums(el.getAttribute('baseFrequency')); let fx = bf.length ? bf[0] : 0, fy = bf.length > 1 ? bf[1] : fx;
  const oct = Math.max(0, Math.round(len(el.getAttribute('numOctaves'), 1))), seed = Math.round(len(el.getAttribute('seed'), 0));
  const fractal = el.getAttribute('type') === 'fractalNoise', stitch = el.getAttribute('stitchTiles') === 'stitch';
  let T0 = turbCache.get(seed); if (!T0){ T0 = turbInit(seed); turbCache.set(seed, T0); }
  const o = new Float32Array(W * H * 4);
  // 接缝（stitchTiles）：频率调到区域整数倍（规范参考程序）
  let st0 = null;
  if (stitch){
    const tw = reg.x1 - reg.x0, th = reg.y1 - reg.y0;
    if (fx){ const lo = Math.floor(tw * fx) / tw, hi = Math.ceil(tw * fx) / tw; fx = (fx / lo < hi / fx) ? lo : hi; }
    if (fy){ const lo = Math.floor(th * fy) / th, hi = Math.ceil(th * fy) / th; fy = (fy / lo < hi / fy) ? lo : hi; }
    st0 = {width:Math.round(tw * fx), height:Math.round(th * fy)}; st0.wrapX = Math.round(reg.x0 * fx) + 4096 + st0.width; st0.wrapY = Math.round(reg.y0 * fy) + 4096 + st0.height;
  }
  const [px0, py0, px1, py1] = map.pxRect(reg);
  for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++){
    // 取样点：实测 Chrome（Skia）在像素 x 取 x+1（不是规范参考程序的 x）；照它，画面才跟浏览器画导出的 SVG 一模一样
    const ux = map.ox + (x + 1) / map.k, uy = map.oy + (y + 1) / map.k, q = (y * W + x) * 4;
    const v = [0, 0, 0, 0];
    for (let ch = 0; ch < 4; ch++){
      let sum = 0, vx = ux * fx, vy = uy * fy, ratio = 1, st = st0 ? Object.assign({}, st0) : null;
      for (let n = 0; n < oct; n++){
        const nz = noise2(T0, ch, vx, vy, st);
        sum += (fractal ? nz : Math.abs(nz)) / ratio;
        vx *= 2; vy *= 2; ratio *= 2;
        if (st){ st.width *= 2; st.wrapX = 2 * st.wrapX - 4096; st.height *= 2; st.wrapY = 2 * st.wrapY - 4096; }
      }
      v[ch] = clamp(fractal ? (sum * 255 + 255) / 2 / 255 : sum, 0, 1);
    }
    o[q] = v[0] * v[3]; o[q + 1] = v[1] * v[3]; o[q + 2] = v[2] * v[3]; o[q + 3] = v[3];
  }
  return o;
}
function displacement(A, Bm, W, H, el, k){
  const sc = len(el.getAttribute('scale'), 0) * k, ch = {R:0, G:1, B:2, A:3};
  const xs = ch[el.getAttribute('xChannelSelector') || 'A'], ys = ch[el.getAttribute('yChannelSelector') || 'A'];
  const o = new Float32Array(A.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const q = (y * W + x) * 4, m = unpre(Bm, q);
    const sx = Math.floor(x + sc * (m[xs] - 0.5) + 0.5), sy = Math.floor(y + sc * (m[ys] - 0.5) + 0.5);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
    const p = (sy * W + sx) * 4; o[q] = A[p]; o[q+1] = A[p+1]; o[q+2] = A[p+2]; o[q+3] = A[p+3];
  }
  return o;
}
function lighting(A, W, H, el, map, sp, specular){
  const ss = len(el.getAttribute('surfaceScale'), 1), kc = len(el.getAttribute(specular ? 'specularConstant' : 'diffuseConstant'), 1), ex = len(el.getAttribute('specularExponent'), 1);
  const lc = rgbOf(el.getAttribute('lighting-color') || (el.style && el.style.lightingColor) || '#ffffff') || [255, 255, 255];
  const col = lc.map(v => sp === 'linear' ? lut(S2L, v / 255) : v / 255);
  const light = Array.from(el.children).find(c => /^fe(Distant|Point|Spot)Light$/.test(c.localName));
  const o = new Float32Array(A.length), I = (x, y) => A[(clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)) * 4 + 3];
  const k = map.k, dev = (u, o0) => (u - o0) * k;
  const L0 = light ? light.localName : 'feDistantLight';
  const az = len(light && light.getAttribute('azimuth'), 0) * Math.PI / 180, el0 = len(light && light.getAttribute('elevation'), 0) * Math.PI / 180;
  const lx = dev(len(light && light.getAttribute('x'), 0), map.ox), ly = dev(len(light && light.getAttribute('y'), 0), map.oy), lz = len(light && light.getAttribute('z'), 0) * k;
  const px = dev(len(light && light.getAttribute('pointsAtX'), 0), map.ox), py = dev(len(light && light.getAttribute('pointsAtY'), 0), map.oy), pz = len(light && light.getAttribute('pointsAtZ'), 0) * k;
  const spe = len(light && light.getAttribute('specularExponent'), 1), cone = light && light.getAttribute('limitingConeAngle');
  const cosCone = cone != null ? Math.cos(Math.abs(parseFloat(cone)) * Math.PI / 180) : -2;
  let S = [px - lx, py - ly, pz - lz]; { const n = Math.hypot(...S) || 1; S = S.map(v => v / n); }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    // 法线：Sobel（规范内部像素公式；边界夹在边上），除以 k 让放大缩小时斜率不变
    const nx = -ss / 4 * ((I(x+1, y-1) + 2*I(x+1, y) + I(x+1, y+1)) - (I(x-1, y-1) + 2*I(x-1, y) + I(x-1, y+1))) / k;
    const ny = -ss / 4 * ((I(x-1, y+1) + 2*I(x, y+1) + I(x+1, y+1)) - (I(x-1, y-1) + 2*I(x, y-1) + I(x+1, y-1))) / k;
    let N = [nx, ny, 1]; { const n = Math.hypot(...N); N = N.map(v => v / n); }
    const Z = ss * I(x, y) * k;
    let Lv, C = col;
    if (L0 === 'feDistantLight') Lv = [Math.cos(az) * Math.cos(el0), Math.sin(az) * Math.cos(el0), Math.sin(el0)];
    else {
      Lv = [lx - x, ly - y, lz - Z]; const n = Math.hypot(...Lv) || 1; Lv = Lv.map(v => v / n);
      if (L0 === 'feSpotLight'){ const d = -(Lv[0]*S[0] + Lv[1]*S[1] + Lv[2]*S[2]); C = d < cosCone || d <= 0 ? [0, 0, 0] : col.map(c => c * Math.pow(d, spe)); }
    }
    const q = (y * W + x) * 4;
    if (specular){
      let H3 = [Lv[0], Lv[1], Lv[2] + 1]; const n = Math.hypot(...H3) || 1; H3 = H3.map(v => v / n);
      const f = kc * Math.pow(Math.max(0, N[0]*H3[0] + N[1]*H3[1] + N[2]*H3[2]), ex);
      const r = clamp(f * C[0], 0, 1), g = clamp(f * C[1], 0, 1), b = clamp(f * C[2], 0, 1), a = Math.max(r, g, b);
      o[q] = r; o[q+1] = g; o[q+2] = b; o[q+3] = a;   // 规范：镜面光结果当预乘处理（a ≥ 各色）
    } else {
      const f = kc * Math.max(0, N[0]*Lv[0] + N[1]*Lv[1] + N[2]*Lv[2]);
      o[q] = clamp(f * C[0], 0, 1); o[q+1] = clamp(f * C[1], 0, 1); o[q+2] = clamp(f * C[2], 0, 1); o[q+3] = 1;
    }
  }
  return o;
}
function flood(W, H, el, map, reg, sp){
  const c = rgbOf(el.getAttribute('flood-color') || 'black') || [0, 0, 0], a = clamp(len(el.getAttribute('flood-opacity'), 1), 0, 1);
  const v = c.map(x => sp === 'linear' ? lut(S2L, x / 255) : x / 255), o = new Float32Array(W * H * 4);
  const [x0, y0, x1, y1] = map.pxRect(reg);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++){ const q = (y * W + x) * 4; o[q] = v[0] * a; o[q+1] = v[1] * a; o[q+2] = v[2] * a; o[q+3] = a; }
  return o;
}
/* 跑一个滤镜：src＝SourceGraphic（预乘 sRGB），回同格式；只留滤镜区域里的 */
function runFilter(f, src, W, H, map, bb){
  const reg = filterRegion(f, bb);
  const pobb = (f.getAttribute('primitiveUnits') || 'userSpaceOnUse') === 'objectBoundingBox';
  const bw = bb.x1 - bb.x0, bh = bb.y1 - bb.y0;
  const LX = v => (pobb ? v * bw : v) * map.k, LY = v => (pobb ? v * bh : v) * map.k;   // 使用者长度 → 像素
  const fcs = f.getAttribute('color-interpolation-filters') || 'linearRGB';
  const R = {}, srcB = {d:src, sp:'srgb'};
  const alphaOnly = () => { const d = new Float32Array(src.length); for (let i = 3; i < d.length; i += 4) d[i] = src[i]; return {d, sp:'srgb'}; };
  let last = srcB, sa = null;
  const input = name => {
    if (!name) return last;
    if (name === 'SourceGraphic') return srcB;
    if (name === 'SourceAlpha') return sa || (sa = alphaOnly());
    if (R[name]) return R[name];
    if (['BackgroundImage', 'BackgroundAlpha', 'FillPaint', 'StrokePaint'].includes(name)) return {d:new Float32Array(src.length), sp:'srgb'};
    return last;
  };
  for (const el of prims(f)){
    const tag = el.localName, csAttr = el.getAttribute('color-interpolation-filters');
    const sp = ((csAttr && csAttr !== 'auto' && csAttr !== 'inherit') ? csAttr : fcs) === 'sRGB' ? 'srgb' : 'linear';
    const inA = () => convert(input(el.getAttribute('in')), sp), inB = () => convert(input(el.getAttribute('in2')), sp);
    let d;
    switch (tag){
      case 'feGaussianBlur': { const s = nums(el.getAttribute('stdDeviation')); d = gaussian(inA().d, W, H, LX(s.length ? s[0] : 0), LY(s.length > 1 ? s[1] : (s.length ? s[0] : 0))); break; }
      case 'feOffset': d = offset(inA().d, W, H, LX(len(el.getAttribute('dx'), 0)), LY(len(el.getAttribute('dy'), 0))); break;
      case 'feFlood': d = flood(W, H, el, map, reg, sp); break;
      case 'feMerge': {
        d = new Float32Array(src.length);
        for (const n of Array.from(el.children).filter(c => c.localName === 'feMergeNode')){
          const s = convert(input(n.getAttribute('in')), sp).d;
          for (let i = 0; i < d.length; i += 4){ const a = s[i + 3]; d[i] = s[i] + d[i] * (1 - a); d[i+1] = s[i+1] + d[i+1] * (1 - a); d[i+2] = s[i+2] + d[i+2] * (1 - a); d[i+3] = a + d[i+3] * (1 - a); }
        }
        break;
      }
      case 'feComposite': d = composite(inA().d, inB().d, el); break;
      case 'feBlend': d = blend(inA().d, inB().d, el); break;
      case 'feColorMatrix': d = colorMatrix(inA().d, el); break;
      case 'feComponentTransfer': d = componentTransfer(inA().d, el); break;
      case 'feMorphology': { const r = nums(el.getAttribute('radius')); const rx = Math.round(LX(r.length ? r[0] : 0)), ry = Math.round(LY(r.length > 1 ? r[1] : (r.length ? r[0] : 0))); d = (rx < 0 || ry < 0) ? new Float32Array(src.length) : morph(inA().d, W, H, rx, ry, el.getAttribute('operator') === 'dilate'); break; }
      case 'feTurbulence': d = turbulence(el, W, H, map, reg, bb); break;
      case 'feDisplacementMap': { const A = convert(input(el.getAttribute('in')), sp).d, Bm = convert(input(el.getAttribute('in2')), sp).d; d = displacement(A, Bm, W, H, el, pobb ? map.k * Math.max(bw, bh) : map.k); break; }
      case 'feSpecularLighting': d = lighting(inA().d, W, H, el, map, sp, true); break;
      case 'feDiffuseLighting': d = lighting(inA().d, W, H, el, map, sp, false); break;
      case 'feDropShadow': {
        const s = nums(el.getAttribute('stdDeviation')), a = inA().d, al = new Float32Array(a.length); for (let i = 3; i < a.length; i += 4) al[i] = a[i];
        const sh = offset(gaussian(al, W, H, LX(s.length ? s[0] : 2), LY(s.length > 1 ? s[1] : (s.length ? s[0] : 2))), W, H, LX(len(el.getAttribute('dx'), 2)), LY(len(el.getAttribute('dy'), 2)));
        const fl = flood(W, H, el, map, {x0:-1e9, y0:-1e9, x1:1e9, y1:1e9}, sp);
        const tinted = composite(fl, sh, {getAttribute:k => k === 'operator' ? 'in' : null});
        d = new Float32Array(a.length); for (let i = 0; i < d.length; i += 4){ const aa = a[i + 3]; for (let c = 0; c < 4; c++) d[i + c] = a[i + c] + tinted[i + c] * (1 - aa); }
        break;
      }
      default: d = new Float32Array(src.length);
    }
    last = {d, sp};
    const rn = el.getAttribute('result'); if (rn) R[rn] = last;
  }
  const out = convert(last, 'srgb').d;
  // 滤镜区域外一律透明
  const [x0, y0, x1, y1] = map.pxRect(reg);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < x0 || x >= x1 || y < y0 || y >= y1){ const q = (y * W + x) * 4; out[q] = out[q+1] = out[q+2] = out[q+3] = 0; }
  return out;
}
/* 浏览器退路：解释器不认识的原语 ⇒ 把滤镜换成像素单位的一份放进隐藏 <svg>，用 ctx.filter='url(#…)' */
let _fbSvg = null, _fbN = 0;
function browserFilter(f, canvas, map, bb){
  if (!_fbSvg){ _fbSvg = document.createElementNS(NS, 'svg'); _fbSvg.setAttribute('width', '0'); _fbSvg.setAttribute('height', '0'); _fbSvg.style.cssText = 'position:absolute;left:-9999px;top:0'; document.body.appendChild(_fbSvg); }
  const g = f.cloneNode(true), id = 'aifx2fb' + (++_fbN), reg = filterRegion(f, bb);
  g.setAttribute('id', id); g.setAttribute('filterUnits', 'userSpaceOnUse');
  const [x0, y0, x1, y1] = map.pxRect(reg); g.setAttribute('x', x0); g.setAttribute('y', y0); g.setAttribute('width', x1 - x0); g.setAttribute('height', y1 - y0);
  const k = map.k;
  g.querySelectorAll('*').forEach(e => {
    ['stdDeviation', 'dx', 'dy', 'radius', 'scale'].forEach(a => { if (e.hasAttribute(a)) e.setAttribute(a, nums(e.getAttribute(a)).map(v => v * k).join(' ')); });
    if (e.hasAttribute('baseFrequency')) e.setAttribute('baseFrequency', nums(e.getAttribute('baseFrequency')).map(v => v / k).join(' '));
    ['x', 'y'].forEach(a => { if (/Light$/.test(e.localName) && e.hasAttribute(a)) e.setAttribute(a, (parseFloat(e.getAttribute(a)) - (a === 'x' ? map.ox : map.oy)) * k); });
    if (/Light$/.test(e.localName) && e.hasAttribute('z')) e.setAttribute('z', parseFloat(e.getAttribute('z')) * k);
  });
  _fbSvg.appendChild(g);
  const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = canvas.height;
  const x = c2.getContext('2d'); x.filter = `url(#${id})`; x.drawImage(canvas, 0, 0); x.filter = 'none';
  g.remove();
  return c2;
}

/* ═════════════ 混合／陷印：编组求值成矢量面 ═════════════ */
function leaves(s, out){
  if (!s || s.visible === false) return out;
  if (s.type === 'group'){ (s.children || []).forEach(c => leaves(c, out)); return out; }
  const gm = FX.geomOf(s); if (gm) out.push({s, gm});
  return out;
}
const polysOf = gm => ({polys:gm.G.map(sp => AIObj.flatten(sp, 0.05)).filter(P => P.length >= 3), rule:gm.rule});
const pArea = P => { let a = 0; for (let i = 0; i < P.length; i++){ const p = P[i], q = P[(i + 1) % P.length]; a += p[0]*q[1] - q[0]*p[1]; } return a / 2; };
function inP(q, P){ let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++){ const a = P[i], b = P[j]; if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function faces(loops){   // 边界环分成一块块（外环＋洞），同 ai-effect.js faces
  if (loops.length <= 1) return loops.length ? [loops] : [];
  const A = loops.map(pArea); let big = 0; A.forEach((a, i) => { if (Math.abs(a) > Math.abs(A[big])) big = i; });
  const sg = Math.sign(A[big]), outers = [], holes = [];
  loops.forEach((L, i) => (Math.sign(A[i]) === sg ? outers : holes).push(i));
  const F = outers.map(i => [loops[i]]);
  for (const h of holes){ const q = loops[h][0]; let best = -1, ba = Infinity; outers.forEach((o, k) => { if (Math.abs(A[o]) < ba && inP(q, loops[o])){ best = k; ba = Math.abs(A[o]); } }); if (best >= 0) F[best].push(loops[h]); else F.push([loops[h]]); }
  return F;
}
function faceShape(F, fill, id){
  const sp = L => ({anchors:L.map(p => ({x:p[0], y:p[1], in:null, out:null})), closed:true});
  if (F.length === 1) return Object.assign({id, type:'bezier', fill, stroke:'none', strokeWidth:0}, sp(F[0]));
  return {id, type:'compound', rule:'evenodd', fill, stroke:'none', strokeWidth:0, children:F.map((L, i) => Object.assign({id:id + '_' + i, type:'bezier', fill:'none', stroke:'none', strokeWidth:0}, sp(L)))};
}
/* 实色／透明混合：每种「覆盖组合」一块颜色（同 ai-effect.js 的 divide） */
function mixArt(s, mode, p){
  if (s.type !== 'group') return s;
  const L = leaves(s, []).map(x => ({s:x.s, c:rgbOf(x.s.fill), set:polysOf(x.gm)})).filter(x => x.c && x.set.polys.length);
  if (L.length < 2) return s;
  const sets = L.map(x => x.set), masks = new Map(), key = m => m.map(Number).join('');
  AIObj.arrangement(sets, m => { if (m.some(Boolean)) masks.set(key(m), m.slice()); return false; });
  const rate = clamp(numOf(p.rate, 50), 0, 100) / 100, out = [];
  let n = 0;
  for (const [k, M] of masks){
    const idx = M.map((v, i) => v ? i : -1).filter(i => i >= 0);
    let c = L[idx[0]].c.slice();
    for (const i of idx.slice(1)){
      const t = L[i].c;
      if (mode === 'hard') c = c.map((v, j) => Math.min(v, t[j]));                                   // 每个色版取最深
      else c = c.map((v, j) => v * (255 - rate * (255 - t[j])) / 255);                               // 上层油墨淡化到比率、叠印（相乘）
    }
    const loops = AIObj.arrangement(sets, m => key(m) === k);
    faces(loops).forEach(F => out.push(faceShape(F, hex(c), s.id + '_mx' + (n++))));
  }
  const g = {id:s.id, type:'group', children:out}; if (s.name) g.name = s.name;
  return g;
}
/* 陷印：每对重叠的异色物件，交界（前面物件的轮廓落在后面物件里的那段）加一条带子；浅色往深色扩（反向＝深往浅） */
function trapArt(s, p){
  if (s.type !== 'group') return s;
  const L = leaves(s, []).map(x => ({s:x.s, c:rgbOf(x.s.fill), gm:x.gm, set:polysOf(x.gm)})).filter(x => x.c && x.set.polys.length);
  if (L.length < 2) return s;
  const w = clamp(numOf(p.thickness, 0.25), 0.01, 5000), r = clamp(numOf(p.heightWidth, 100), 25, 400) / 100;
  const tint = 1 - clamp(numOf(p.tintReduction, 40), 0, 100) / 100, out = [];
  let n = 0;
  for (let j = 1; j < L.length; j++) for (let i = 0; i < j; i++){
    const back = L[i], front = L[j];
    if (hex(back.c) === hex(front.c)) continue;
    // 带子：前面物件轮廓的描边（宽 2×粗细）；高宽比＝在 y 压扁的空间里描、再拉回去（笔尖变椭圆）
    const band = [];
    front.gm.G.forEach(sp => {
      const P = AIObj.flatten(sp, 0.02).map(q => [q[0], q[1] / r]);
      if (P.length >= 2) AIObj.strokePieces(P, !!sp.closed, 2 * w, 'miter', 'butt', 4).forEach(pc => band.push(pc.map(q => [q[0], q[1] * r])));
    });
    if (!band.length) continue;
    const frontLighter = lum(front.c) >= lum(back.c), spreadFront = p.reverse ? !frontLighter : frontLighter;
    const lighter = frontLighter ? front.c : back.c, darker = frontLighter ? back.c : front.c;
    const sets = [{polys:band, rule:'nonzero'}, front.set, back.set];
    // 前面的颜色往外扩（落在后面物件里、前面物件外）；否则后面的颜色往里收（落在两者重叠里）
    const loops = AIObj.arrangement(sets, m => m[0] && m[2] && (spreadFront ? !m[1] : m[1]));
    if (!loops.length) continue;
    const src = p.reverse ? darker : lighter, under = p.reverse ? lighter : darker;
    const tinted = src.map(v => 255 - tint * (255 - v));                                            // 色调减低
    const col = tinted.map((v, k) => v * under[k] / 255);                                            // 陷印设叠印：叠在底色上（相乘）
    faces(loops).forEach(F => out.push(faceShape(F, hex(col), s.id + '_trap' + (n++))));
  }
  const base = clone(s); delete base.effects;
  if (out.length) base.children = (base.children || []).concat([{id:s.id + '_traps', type:'group', name:'Trap', children:out}]);
  return base;
}
function vectorArt(s){
  let art = stripMine(s);
  for (const e of myFx(s)){
    if (!VECTOR.includes(e.id)) continue;
    const keep = art.effects; delete art.effects;
    const p = Object.assign(DEF[e.id](), e.params || {});
    art = e.id === 'pathfinder.trap' ? trapArt(art, p) : mixArt(art, e.id === 'pathfinder.hardMix' ? 'hard' : 'soft', p);
    if (keep) art.effects = keep;
  }
  return art;
}
const artCache = new Map();
function cachedArt(s){
  const key = JSON.stringify(s), hit = artCache.get(s.id);
  if (hit && hit.key === key) return hit.art;
  const art = vectorArt(s);
  if (artCache.size > 500) artCache.clear();
  artCache.set(s.id, {key, art});
  return art;
}

/* ═════════════ 点阵类：在一张「滤镜空间」画布（使用者坐标 × k，不转）上按堆叠顺序套 ═════════════ */
function geomBounds(art){ return AIObj.shapeBounds(art, q => q, false); }
function visBounds(art){ return AIObj.shapeBounds(art, q => q, true); }
const unionB = (a, b) => !a ? b : !b ? a : {x0:Math.min(a.x0, b.x0), y0:Math.min(a.y0, b.y0), x1:Math.max(a.x1, b.x1), y1:Math.max(a.y1, b.y1)};
function rasterPlan(s, art){
  const fx = myFx(s).filter(e => RASTER.includes(e.id));
  const bb = geomBounds(art) || visBounds(art); if (!bb) return null;
  let region = visBounds(art) || bb;
  const steps = [];
  for (const e of fx){
    if (e.id === 'svgFilter'){
      const xml = filterXml(e.params); if (!xml) continue;
      let f; try { f = parsed(xml); } catch (err){ console.error(err); continue; }
      region = unionB(region, filterRegion(f, region));        // 滤镜外框＝前一步的结果外框（AI 点阵效果一样一层套一层）
      steps.push({kind:'svg', f});
    } else {
      const p = (() => { try { return cleanParams('rasterize', e.params); } catch (err){ return DEF.rasterize(); } })();
      const b = {x0:region.x0 - p.addAround, y0:region.y0 - p.addAround, x1:region.x1 + p.addAround, y1:region.y1 + p.addAround};
      region = b; steps.push({kind:'raster', p, b});
    }
  }
  return {steps, region, bb};
}
/* 画进一张画布：回 {canvas, x0, y0, k}（使用者坐标 (x0,y0) 是画布左上，k 像素/单位） */
function renderRaster(s, k){
  const art = cachedArt(s), plan = rasterPlan(s, art);
  if (!plan || !plan.steps.length) return null;
  const R = plan.region;
  let kk = k; const area = (R.x1 - R.x0) * (R.y1 - R.y0) * kk * kk;
  if (area > 6e6) kk = kk * Math.sqrt(6e6 / area);                                    // 太大就降解析度
  const x0 = Math.floor(R.x0 * kk) / kk, y0 = Math.floor(R.y0 * kk) / kk;
  const W = Math.max(1, Math.ceil((R.x1 - x0) * kk)), H = Math.max(1, Math.ceil((R.y1 - y0) * kk));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', {willReadFrequently:true});
  cx.setTransform(1, 0, 0, 1, -x0 * kk, -y0 * kk);
  window.drawShape(cx, art, kk);
  cx.setTransform(1, 0, 0, 1, 0, 0);
  const map = {k:kk, ox:x0, oy:y0, pxRect:r => [clamp(Math.floor((r.x0 - x0) * kk), 0, W), clamp(Math.floor((r.y0 - y0) * kk), 0, H), clamp(Math.ceil((r.x1 - x0) * kk), 0, W), clamp(Math.ceil((r.y1 - y0) * kk), 0, H)]};
  let curBB = plan.bb;
  for (const st of plan.steps){
    if (st.kind === 'svg'){
      if (canInterpret(st.f)){
        const img = cx.getImageData(0, 0, W, H), d = img.data, src = new Float32Array(d.length);
        for (let i = 0; i < d.length; i += 4){ const a = d[i + 3] / 255; src[i] = d[i] / 255 * a; src[i+1] = d[i+1] / 255 * a; src[i+2] = d[i+2] / 255 * a; src[i+3] = a; }
        const out = runFilter(st.f, src, W, H, map, curBB);
        for (let i = 0; i < d.length; i += 4){ const a = out[i + 3]; d[i + 3] = Math.round(a * 255); if (a > 0){ d[i] = Math.round(clamp(out[i] / a, 0, 1) * 255); d[i+1] = Math.round(clamp(out[i+1] / a, 0, 1) * 255); d[i+2] = Math.round(clamp(out[i+2] / a, 0, 1) * 255); } else d[i] = d[i+1] = d[i+2] = 0; }
        cx.putImageData(img, 0, 0);
      } else {
        const c2 = browserFilter(st.f, cv, map, curBB);
        cx.clearRect(0, 0, W, H); cx.drawImage(c2, 0, 0);
      }
      curBB = unionB(curBB, filterRegion(st.f, curBB));
    } else rasterStep(cx, cv, W, H, map, st, art);
  }
  return {canvas:cv, x0, y0, k:kk, W, H};
}
/* 栅格化效果：按 ppi 取样成低解析度、收尾（颜色模型／背景／剪切蒙版／锯齿），再用「最近邻」放回去（看得到像素） */
function rasterStep(cx, cv, W, H, map, st, art){
  const p = st.p, b = st.b, q = p.ppi / 72;
  const lw = Math.max(1, Math.ceil((b.x1 - b.x0) * q)), lh = Math.max(1, Math.ceil((b.y1 - b.y0) * q));
  const lo = document.createElement('canvas'); lo.width = lw; lo.height = lh;
  const lx = lo.getContext('2d', {willReadFrequently:true});
  lx.imageSmoothingEnabled = true; lx.imageSmoothingQuality = 'high';
  lx.drawImage(cv, (map.ox - b.x0) * q, (map.oy - b.y0) * q, W / map.k * q, H / map.k * q);
  const img = lx.getImageData(0, 0, lw, lh), d = img.data;
  for (let i = 0; i < d.length; i += 4){
    if (!p.antiAlias) d[i + 3] = d[i + 3] >= 128 ? 255 : 0;
    if (p.colorModel !== 'rgb' && d[i + 3]){ let y = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]; y = p.colorModel === 'bitmap' ? (y >= 127.5 ? 255 : 0) : Math.round(y); d[i] = d[i+1] = d[i+2] = y; }
  }
  lx.putImageData(img, 0, 0);
  if (p.background !== 'transparent'){
    lx.save(); lx.globalCompositeOperation = 'destination-over';
    if (p.clippingMask){ lx.setTransform(q, 0, 0, q, -b.x0 * q, -b.y0 * q); lx.beginPath(); outlinePath(lx, art); lx.clip('nonzero'); lx.setTransform(1, 0, 0, 1, 0, 0); }
    lx.fillStyle = p.background; lx.fillRect(0, 0, lw, lh); lx.restore();
  }
  cx.clearRect(0, 0, W, H);
  cx.imageSmoothingEnabled = false;
  cx.drawImage(lo, (b.x0 - map.ox) * map.k, (b.y0 - map.oy) * map.k, lw / q * map.k, lh / q * map.k);
  cx.imageSmoothingEnabled = true;
}
function outlinePath(ctx, art){
  leaves(art, []).forEach(({gm}) => gm.G.forEach(sp => {
    const A = sp.anchors; if (!A.length) return;
    ctx.moveTo(A[0].x, A[0].y);
    const seg = (a, b) => { if (!a.out && !b.in) ctx.lineTo(b.x, b.y); else { const c1 = a.out || [a.x, a.y], c2 = b.in || [b.x, b.y]; ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], b.x, b.y); } };
    for (let i = 1; i < A.length; i++) seg(A[i - 1], A[i]);
    if (sp.closed && A.length > 1){ seg(A[A.length - 1], A[0]); ctx.closePath(); }
  }));
}

/* ═════════════ 接到渲染（包在 AiFx 那层外面）═════════════ */
function drawMine(ctx, s, S){
  let art;
  try { art = cachedArt(s); } catch (e){ console.error('ai-effect2', e); return window.drawShape(ctx, stripMine(s), S); }
  if (!myFx(s).some(e => RASTER.includes(e.id))) return window.drawShape(ctx, art, S);
  const Tm = ctx.getTransform(), k = S * (Math.sqrt(Math.abs(Tm.a * Tm.d - Tm.b * Tm.c)) || 1);
  let r;
  try { r = renderRaster(s, k); } catch (e){ console.error('ai-effect2', e); r = null; }
  if (!r) return window.drawShape(ctx, art, S);
  ctx.save();
  ctx.scale(S, S); ctx.translate(r.x0, r.y0); ctx.scale(1 / r.k, 1 / r.k);
  ctx.drawImage(r.canvas, 0, 0);
  ctx.restore();
}
let _svgN = 0;
function svgMine(s, inner){
  const art = cachedArt(s), fx = myFx(s).filter(e => RASTER.includes(e.id));
  let body = inner(art);
  for (let i = 0; i < fx.length; i++){
    const e = fx[i];
    if (e.id === 'svgFilter'){
      const xml = filterXml(e.params); if (!xml) continue;
      let f; try { f = parseFilter(xml); } catch (err){ continue; }
      const id = `${s.id}_svgf${i}_${++_svgN}`; f.setAttribute('id', id);
      body = new XMLSerializer().serializeToString(f).replace(/ xmlns="[^"]*"/, '') + `<g filter="url(#${id})">${body}</g>`;
    } else {
      // 栅格化：到这一步为止的外观画成 ppi 的像素，嵌成 <image>（之后的 SVG 滤镜照样包在外面）
      const sub = clone(s); let seen = 0;
      sub.effects = (s.effects || []).filter(x => { if (!x || !MINE.includes(x.id) || x.visible === false) return true; if (!RASTER.includes(x.id)) return true; return seen++ <= i; });
      const p = cleanParams('rasterize', e.params), r = renderRaster(sub, p.ppi / 72);
      if (r) body = `<image x="${r.x0}" y="${r.y0}" width="${r.W / r.k}" height="${r.H / r.k}" preserveAspectRatio="none" style="image-rendering:pixelated" xlink:href="${r.canvas.toDataURL('image/png')}"/>`;
    }
  }
  return body;
}
function installHook(){
  const R = window.ObjRender;
  if (!R || R.__aiFx2) return;
  R.__aiFx2 = true;
  const h0 = R.handles, d0 = R.draw, s0 = R.toSVG;
  R.handles = function(s){ return hasMine(s) || h0.call(this, s); };
  R.draw = function(ctx, s, S){ if (hasMine(s)) return drawMine(ctx, s, S); return d0.call(this, ctx, s, S); };
  R.toSVG = function(s){ if (hasMine(s)) return svgMine(s, x => R.toSVG(x)); return s0.call(this, s); };
}
installHook();

/* ═════════════ 外框物件：AiFx 的几何效果（求值＝活形状变路径，视觉不变；扩展外观＝烘成路径）═════════════ */
FX.CAT['path.outlineObject'] = {id:'path.outlineObject', label:'Outline Object', menu:'Path', params:'{} 外框物件：外观里物件先当成它的轮廓路径（活形状参数丢掉），之后的效果作用在轮廓上；扩展外观＝烘成路径', defaults:{}, raster:false};

/* ═════════════ 命令 ═════════════ */
const reg = (id, meta, fn) => CMD.reg(id, Object.assign({i18n:''}, meta), p => fn(p || {}));
const done = (L, extra) => { Layer.invalidate(L); artCache.clear(); return Object.assign({ok:true}, extra || {}); };
const AiFx2 = {last:null};
function applyMine(id, p, C){
  const t = FX.targets(p, C); if (t.err) return t.err;
  let params;
  try { params = id === 'svgFilter' ? svgParams(p) : cleanParams(id, Object.assign({}, p.params || {}, flat(id, p))); } catch (e){ return {ok:false, error:C + ': ' + e.message}; }
  if (params && params.ok === false) return params;
  const e = {id, params, visible:true};
  t.R.forEach(s => { (s.effects = Array.isArray(s.effects) ? s.effects : []).push(clone(e)); });
  const out = {ids:t.R.map(s => s.id), index:t.R[0].effects.length - 1};
  if (VECTOR.includes(id) && t.R.some(s => s.type !== 'group')) out.warning = 'Pathfinder effects should be applied to groups (other objects are left as they are)';   // AI 一样的提醒
  return done(t.L, out);
}
const FLAT = {rasterize:['ppi', 'colorModel', 'background', 'antiAlias', 'clippingMask', 'addAround', 'padding'], 'pathfinder.softMix':['rate'],
  'pathfinder.trap':['thickness', 'heightWidth', 'tintReduction', 'processColor', 'reverse'], 'pathfinder.hardMix':[]};
function flat(id, p){ const o = {}; (FLAT[id] || []).forEach(k => { if (p[k] !== undefined) o[k] = p[k]; }); return o; }
function svgParams(p){
  const pp = Object.assign({}, p.params || {}); if (p.name !== undefined) pp.name = p.name; if (p.xml !== undefined) pp.xml = p.xml;
  if (typeof pp.xml === 'string' && pp.xml.trim()){
    try { const f = parseFilter(pp.xml); if (!pp.name) pp.name = f.getAttribute('id') || 'Custom'; } catch (e){ return {ok:false, error:'ai.effect.svgFilter.apply: ' + e.message}; }
    return {name:String(pp.name), xml:pp.xml};
  }
  if (!pp.name) return {ok:false, error:'ai.effect.svgFilter.apply: missing `name` (see ai.effect.svgFilter.list)'};
  if (!BUILTIN[pp.name] && !lib()[pp.name]) return {ok:false, error:'ai.effect.svgFilter.apply: unknown SVG filter `' + pp.name + '`'};
  return lib()[pp.name] ? {name:pp.name, xml:lib()[pp.name]} : {name:pp.name};   // 导入的滤镜把 XML 抄进效果（删掉库里的也还画得出来）
}
reg('ai.effect.svgFilter.apply', {undoable:true, params:'{name: 内建 AI_*（' + BUILTIN_NAMES.join('|') + '）或已导入的滤镜名, xml?: "<filter …>…</filter>"（自订；给了就用它，name 缺省取 filter 的 id）, ids?, layerId?} ' +
  '照 AI 效果 ▸ SVG 滤镜：在选中物件的外观最后加一个活的 SVG 滤镜（ai.effect.remove／setParams 可改）；画面用 JS 照 SVG 规范算、导出 SVG 带 <filter> → {ok, ids, index}'}, p => {
  const r = applyMine('svgFilter', p, 'ai.effect.svgFilter.apply'); if (r.ok !== false) AiFx2.last = {cmd:'ai.effect.svgFilter.apply', params:{name:p.name, xml:p.xml}}; return r;
});
BUILTIN_NAMES.forEach(n => reg('ai.effect.svgFilter.' + n, {undoable:true, params:`{ids?, layerId?} 套内建 SVG 滤镜 ${n}（＝ai.effect.svgFilter.apply {name:"${n}"}）→ {ok, ids, index}`}, p => {
  const r = applyMine('svgFilter', Object.assign({}, p, {name:n, xml:undefined}), 'ai.effect.svgFilter.' + n); if (r.ok !== false) AiFx2.last = {cmd:'ai.effect.svgFilter.apply', params:{name:n}}; return r;
}));
reg('ai.effect.svgFilter.list', {params:'{} → {builtin:[名…], imported:[名…], filters:{名: XML}}'}, () => {
  const filters = Object.assign({}, BUILTIN, lib());
  return {ok:true, builtin:BUILTIN_NAMES.slice(), imported:Object.keys(lib()), filters};
});
/* 读 SVG 文字里的 <filter>（照 AI「导入 SVG 滤镜」：文件里每个 filter 加进文件的滤镜清单；同名覆盖） */
function importFilters(text){
  const doc = new DOMParser().parseFromString(String(text || ''), 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('not a valid SVG file');
  const fs = Array.from(doc.getElementsByTagNameNS(NS, 'filter')).concat(Array.from(doc.getElementsByTagName('filter')).filter(f => f.namespaceURI !== NS));
  const out = {};
  fs.forEach((f, i) => {
    const name = f.getAttribute('id') || ('Filter_' + (i + 1));
    if (f.namespaceURI !== NS){ const g = parseFilter(new XMLSerializer().serializeToString(f).replace(/ xmlns="[^"]*"/, '')); out[name] = new XMLSerializer().serializeToString(g).replace(/ xmlns="[^"]*"/, ''); }
    else out[name] = new XMLSerializer().serializeToString(f).replace(/ xmlns="[^"]*"/, '');
  });
  return out;
}
reg('ai.effect.svgFilter.import', {undoable:false, params:'{svg: SVG 档内容（文字）} 照 AI 效果 ▸ SVG 滤镜 ▸ 导入 SVG 滤镜：档里每个 <filter> 加进本文件的滤镜清单（以 id 为名、同名覆盖；进历史、存工程档）→ {ok, names}'}, p => {
  let got; try { got = importFilters(p.svg || p.text || ''); } catch (e){ return {ok:false, error:'ai.effect.svgFilter.import: ' + e.message}; }
  const names = Object.keys(got);
  if (!names.length) return {ok:false, error:'ai.effect.svgFilter.import: the file has no <filter> elements'};
  History.push();
  Doc.aiSvgFilters = Object.assign({}, lib(), got);
  return {ok:true, names};
});
reg('ai.effect.svgFilter.define', {undoable:false, params:'{name, xml: "<filter …>"} 新建／改写一个文件里的 SVG 滤镜（＝对话框「新建 SVG 滤镜」）→ {ok, name}'}, p => {
  const name = String(p.name || '').trim(); if (!name) return {ok:false, error:'ai.effect.svgFilter.define: missing `name`'};
  if (BUILTIN[name]) return {ok:false, error:'ai.effect.svgFilter.define: `' + name + '` is a built-in filter'};
  let f; try { f = parseFilter(p.xml || ''); } catch (e){ return {ok:false, error:'ai.effect.svgFilter.define: ' + e.message}; }
  f.setAttribute('id', name);
  History.push();
  Doc.aiSvgFilters = Object.assign({}, lib(), {[name]:new XMLSerializer().serializeToString(f).replace(/ xmlns="[^"]*"/, '')});
  return {ok:true, name};
});
reg('ai.effect.svgFilter.remove', {undoable:false, params:'{name} 从文件的滤镜清单删掉一个导入的滤镜（内建的删不掉；已套用的效果自带 XML，照画）→ {ok}'}, p => {
  if (!lib()[p.name]) return {ok:false, error:'ai.effect.svgFilter.remove: `' + p.name + '` is not an imported filter'};
  History.push();
  const o = Object.assign({}, lib()); delete o[p.name]; Doc.aiSvgFilters = Object.keys(o).length ? o : undefined;
  return {ok:true};
});
reg('ai.effect.path.outlineObject', {undoable:true, params:'{ids?, layerId?} 照 AI 效果 ▸ 路径 ▸ 外框物件（原码无）：外观里物件先变成它的轮廓路径（＝ai.effect.apply {effect:"path.outlineObject"}）→ {ok, ids, index}'}, p => {
  const r = CMD.map['ai.effect.apply'].run(Object.assign({}, p, {effect:'path.outlineObject', params:{}}));
  if (r && r.ok !== false) AiFx2.last = {cmd:'ai.effect.path.outlineObject', params:{}};
  return r;
});
[['pathfinder.hardMix', 'Hard Mix'], ['pathfinder.softMix', 'Soft Mix'], ['pathfinder.trap', 'Trap'], ['rasterize', 'Rasterize']].forEach(([id, label]) => {
  reg('ai.effect.' + id, {undoable:true, params:`{params?: ${DOCS[id]}（也可平铺）, ids?, layerId?} 照 AI 效果 ▸ ${label}（原码无·照 AI 行为）→ {ok, ids, index, warning?}`}, p => {
    const r = applyMine(id, p, 'ai.effect.' + id); if (r.ok !== false) AiFx2.last = {cmd:'ai.effect.' + id, params:Object.assign({}, p.params || {}, flat(id, p))}; return r;
  });
});

/* ── 扩展外观：矢量类（混合／陷印）烘成真的面；点阵类（SVG 滤镜／栅格化）跟 AiFx 的点阵效果一样留成活的（我们的矢量层放不了图） ── */
(function wrapExpand(){
  const c = CMD.map['ai.effect.expandAppearance']; if (!c || c.__aiFx2) return;
  const orig = c.run; c.__aiFx2 = true;
  c.run = function(p){
    p = p || {};
    const t = FX.targets(p, 'ai.effect.expandAppearance'); if (t.err) return orig.call(this, p);
    const S = t.L.data.shapes, kept = new Map(); let baked = [];
    for (const s of t.R){
      if (!Array.isArray(s.effects) || !s.effects.some(e => e && MINE.includes(e.id))) continue;
      const i = S.indexOf(s);
      const vis = s.effects.filter(e => e && MINE.includes(e.id) && e.visible !== false);
      let n = s;
      if (vis.some(e => VECTOR.includes(e.id))){
        const only = clone(s); only.effects = s.effects.filter(e => !(e && MINE.includes(e.id) && !VECTOR.includes(e.id)));
        n = vectorArt(only);
        const fixIds = x => { x.id = uid('S'); (x.children || []).forEach(fixIds); };
        (n.children || []).forEach(fixIds); n.id = s.id;
        baked.push(s.id);
      } else n = clone(s);
      const ras = vis.filter(e => RASTER.includes(e.id));
      if (ras.length) kept.set(s.id, clone(ras));
      if (Array.isArray(n.effects)){ n.effects = n.effects.filter(e => !(e && MINE.includes(e.id))); if (!n.effects.length) delete n.effects; }
      S[i] = n;
    }
    const ids = (p.ids || (window.VecSel ? VecSel.shapes.slice() : [])).slice();
    let r = orig.call(this, Object.assign({}, p, {ids, layerId:t.L.id}));
    if (r && r.ok === false && (baked.length || kept.size)) r = {ok:true, ids:baked.length ? baked : Array.from(kept.keys())};
    for (const [id, fx] of kept){ const s = S.find(x => x.id === id); if (s) s.effects = (s.effects || []).concat(fx); }
    if (r && r.ok !== false){ artCache.clear(); Layer.invalidate(t.L); }
    return r;
  };
})();
/* 套用上一个效果：本档的效果也接得上 */
(function wrapLast(){
  const a = CMD.map['ai.effect.applyLast'], l = CMD.map['ai.effect.last'];
  if (a && !a.__aiFx2){ const o = a.run; a.__aiFx2 = true; a.run = function(p){ if (AiFx2.last && AiFx2.lastFresh) return CMD.map[AiFx2.last.cmd].run(Object.assign({}, p || {}, {params:clone(AiFx2.last.params)}, AiFx2.last.params || {})); return o.call(this, p); }; }
  if (l && !l.__aiFx2){ const o = l.run; l.__aiFx2 = true; l.run = function(p){ if (AiFx2.last && AiFx2.lastFresh){ const d = AiFx2.last.cmd + '.dialog'; if (CMD.map[d]) return CMD.map[d].run(Object.assign({}, p || {}, {params:clone(AiFx2.last.params)})); return CMD.map[AiFx2.last.cmd].run(Object.assign({}, p || {}, AiFx2.last.params || {})); } return o.call(this, p); }; }
})();
// 上一个效果是谁：AiFx 的对话框按确定会写 AiFx.last；本档按确定写 AiFx2.last。AiFx.last 一被写（含清掉）就换回 AiFx 的
function markLast(){ AiFx2.lastFresh = true; }
(function(){ let v = FX.last; try { Object.defineProperty(FX, 'last', {configurable:true, enumerable:true, get(){ return v; }, set(x){ v = x; AiFx2.lastFresh = false; }}); } catch (e){} })();
(function wrapList(){
  const c = CMD.map['ai.effect.list']; if (!c || c.__aiFx2) return;
  const o = c.run; c.__aiFx2 = true;
  c.run = function(p){ const r = o.call(this, p); if (r && Array.isArray(r.catalog)) MINE.forEach(id => r.catalog.push({id, label:id, menu:'', params:DOCS[id], defaults:DEF[id](), raster:RASTER.includes(id)})); return r; };
})();

/* ═════════════ 对话框 ═════════════ */
/* 预览：先把效果暂时加上（或就地改 index 那个），取消＝退回 */
function previewer(t, id, index){
  const snap = t.R.map(s => (Array.isArray(s.effects) ? clone(s.effects) : null));
  const restore = () => { t.R.forEach((s, i) => { if (snap[i]) s.effects = clone(snap[i]); else delete s.effects; }); artCache.clear(); Layer.invalidate(t.L); };
  const show = params => {
    restore();
    if (params){ t.R.forEach(s => { if (index !== null && s.effects && s.effects[index] && s.effects[index].id === id) s.effects[index].params = params; else if (index === null) (s.effects = s.effects || []).push({id, params, visible:true}); }); artCache.clear(); Layer.invalidate(t.L); }
    if (window.UI) UI.draw();
  };
  return {restore, show};
}
function idxOf(o){ return Number.isInteger(o.index) ? o.index : null; }
function okRun(t, id, cmd, params, index){
  if (index !== null) return CMD.run('ai.effect.setParams', {index, params, ids:t.R.map(s => s.id), layerId:t.L.id});
  const r = CMD.run(cmd, Object.assign({ids:t.R.map(s => s.id), layerId:t.L.id}, id === 'svgFilter' ? params : {params}));
  if (r && r.ok !== false){ AiFx2.last = {cmd, params:clone(params)}; markLast(); }
  return r;
}
/* 栅格化…（AI 2020：颜色模型、分辨率、背景、消除锯齿、剪切蒙版、周围添加；预设取文档栅格效果设置） */
reg('ai.effect.rasterize.dialog', {params:'{index?: 就地编辑那个已套的栅格化, params?: 预填} 开「栅格化」（效果）对话框 → {ok, dialog}'}, o => {
  const t = FX.targets(o, 'ai.effect.rasterize.dialog'); if (t.err) return t.err;
  const index = idxOf(o), cur = index !== null && t.R[0].effects && t.R[0].effects[index] ? t.R[0].effects[index].params : (o.params || {});
  let v0; try { v0 = cleanParams('rasterize', cur); } catch (e){ v0 = DEF.rasterize(); }
  const pv = previewer(t, 'rasterize', index);
  const toP = v => ({colorModel:v.colorModel, ppi:v.res === 'other' ? v.ppi : +v.res, background:v.background, antiAlias:v.antiAlias === 'art', clippingMask:v.clippingMask, addAround:v.addAround});
  const safe = v => { try { return cleanParams('rasterize', toP(v)); } catch (e){ return null; } };
  FX.Dlg.open({kind:'aiRasterize', title:T('aifx2.rasterize'), preview:true, fields:[
    {key:'colorModel', label:'aifx.rfx.colorModel', type:'select', value:v0.colorModel, options:[['rgb', 'aifx.rfx.rgb'], ['grayscale', 'aifx.rfx.grayscale'], ['bitmap', 'aifx.rfx.bitmap']]},
    {key:'res', label:'aifx.rfx.resolution', type:'select', value:[72, 150, 300].includes(v0.ppi) ? String(v0.ppi) : 'other', options:[['72', 'aifx.rfx.screen'], ['150', 'aifx.rfx.medium'], ['300', 'aifx.rfx.high'], ['other', 'aifx.rfx.other']]},
    {key:'ppi', label:'aifx.rfx.ppi', type:'number', value:v0.ppi},
    {key:'background', label:'aifx.rfx.background', type:'select', value:['white', 'transparent'].includes(v0.background) ? v0.background : 'white', options:[['white', 'aifx.rfx.white'], ['transparent', 'aifx.rfx.transparent']]},
    {label:'aifx.rfx.options', type:'head'},
    {key:'antiAlias', label:'aifx2.antiAlias', type:'select', value:v0.antiAlias ? 'art' : 'none', options:[['none', 'aifx2.aaNone'], ['art', 'aifx2.aaArt']]},
    {key:'clippingMask', label:'aifx.rfx.clippingMask', type:'check', value:v0.clippingMask},
    {key:'addAround', label:'aifx.rfx.addAround', type:'number', value:v0.addAround}],
    onChange:v => { if (v.preview === false) return pv.show(null); const p = safe(v); if (p) pv.show(p); }, onCancel:pv.restore,
    onOk:v => { pv.restore(); const p = safe(v); if (!p) return {ok:false, error:T('aifx2.badValue')}; return okRun(t, 'rasterize', 'ai.effect.rasterize', p, index); }});
  return {ok:true, dialog:'aiRasterize'};
});
/* 陷印…（AI 2020 路径查找器选项的陷印设置） */
reg('ai.effect.pathfinder.trap.dialog', {params:'{index?, params?} 开「陷印」对话框 → {ok, dialog}'}, o => {
  const t = FX.targets(o, 'ai.effect.pathfinder.trap.dialog'); if (t.err) return t.err;
  const index = idxOf(o), v0 = cleanParams('pathfinder.trap', index !== null && t.R[0].effects && t.R[0].effects[index] ? t.R[0].effects[index].params : o.params);
  const pv = previewer(t, 'pathfinder.trap', index);
  FX.Dlg.open({kind:'aiTrap', title:T('aifx2.trap'), preview:true, fields:[
    {label:'aifx2.settings', type:'head'},
    {key:'thickness', label:'aifx2.thickness', type:'number', value:v0.thickness}, {key:'heightWidth', label:'aifx2.heightWidth', type:'number', value:v0.heightWidth},
    {key:'tintReduction', label:'aifx2.tintReduction', type:'number', value:v0.tintReduction},
    {label:'aifx.rfx.options', type:'head'},
    {key:'processColor', label:'aifx2.processColor', type:'check', value:v0.processColor}, {key:'reverse', label:'aifx2.reverse', type:'check', value:v0.reverse}],
    onChange:v => { if (v.preview === false) return pv.show(null); const p = Object.assign({}, v); delete p.preview; pv.show(cleanParams('pathfinder.trap', p)); }, onCancel:pv.restore,
    onOk:v => { pv.restore(); const p = Object.assign({}, v); delete p.preview; return okRun(t, 'pathfinder.trap', 'ai.effect.pathfinder.trap', cleanParams('pathfinder.trap', p), index); }});
  return {ok:true, dialog:'aiTrap'};
});
reg('ai.effect.pathfinder.softMix.dialog', {params:'{index?, params?} 开「透明混合」的混合比率对话框（＝路径查找器选项的混合比率）→ {ok, dialog}'}, o => {
  const t = FX.targets(o, 'ai.effect.pathfinder.softMix.dialog'); if (t.err) return t.err;
  const index = idxOf(o), v0 = cleanParams('pathfinder.softMix', index !== null && t.R[0].effects && t.R[0].effects[index] ? t.R[0].effects[index].params : o.params);
  const pv = previewer(t, 'pathfinder.softMix', index);
  FX.Dlg.open({kind:'aiSoftMix', title:T('aifx2.softMix'), preview:true, fields:[{key:'rate', label:'aifx2.rate', type:'number', value:v0.rate}],
    onChange:v => { if (v.preview === false) return pv.show(null); pv.show(cleanParams('pathfinder.softMix', {rate:v.rate})); }, onCancel:pv.restore,
    onOk:v => { pv.restore(); return okRun(t, 'pathfinder.softMix', 'ai.effect.pathfinder.softMix', cleanParams('pathfinder.softMix', {rate:v.rate}), index); }});
  return {ok:true, dialog:'aiSoftMix'};
});

/* 应用 SVG 滤镜…（AI 2020：滤镜清单、编辑／新建／删除、预览）——要清单与 XML 文字框，自己画 */
const STYLE = `
#aiFx2Dialog{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;font:13px sans-serif}
#aiFx2Dialog .box{background:#2b2f36;color:#e6e8eb;padding:14px 18px;border-radius:6px;width:520px;max-width:94vw;max-height:92vh;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.5)}
#aiFx2Dialog .hd{font-weight:bold;margin-bottom:10px}
#aiFx2Dialog select[name=filter]{width:100%;box-sizing:border-box;background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px}
#aiFx2Dialog textarea{width:100%;box-sizing:border-box;height:130px;background:#1e2126;color:#cfd3d9;border:1px solid #444a54;border-radius:3px;font:11px monospace;margin-top:8px}
#aiFx2Dialog .tools{display:flex;gap:6px;margin-top:6px}
#aiFx2Dialog label.ck{display:flex;gap:6px;align-items:center;margin-top:8px}
#aiFx2Dialog .row{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
#aiFx2Dialog .msg{color:#aab0ba;margin:4px 0 8px}
#aiFx2Dialog .err{color:#ff8a80;font-size:12px;margin-top:6px;min-height:14px}`;
function ensureStyle(){ if (!document.getElementById('aiFx2Style')){ const s = document.createElement('style'); s.id = 'aiFx2Style'; s.textContent = STYLE; document.head.appendChild(s); } }
function h(tag, attrs, kids){ const e = document.createElement(tag); Object.entries(attrs || {}).forEach(([k, v]) => { if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }); (kids || []).forEach(c => e.appendChild(c)); return e; }
const Dlg2 = {
  close(){ const d = document.getElementById('aiFx2Dialog'); if (d) d.remove(); },
  isOpen(){ return !!document.getElementById('aiFx2Dialog'); },
  shell(kind, title){
    this.close(); ensureStyle();
    const bg = h('div', {id:'aiFx2Dialog', 'data-kind':kind}), box = h('div', {class:'box'});
    box.appendChild(h('div', {class:'hd', text:title})); bg.appendChild(box); document.body.appendChild(bg);
    bg.addEventListener('keydown', e => e.stopPropagation());
    return {bg, box};
  }
};
reg('ai.effect.svgFilter.apply.dialog', {params:'{name?: 预选的滤镜, index?: 就地编辑那个已套的 SVG 滤镜} 开「应用 SVG 滤镜」对话框（清单＋XML 编辑＋新建／删除＋预览；确定＝ai.effect.svgFilter.apply）→ {ok, dialog}'}, o => {
  const t = FX.targets(o, 'ai.effect.svgFilter.apply.dialog'); if (t.err) return t.err;
  const index = idxOf(o), curP = index !== null && t.R[0].effects && t.R[0].effects[index] ? t.R[0].effects[index].params : null;
  const pv = previewer(t, 'svgFilter', index);
  const {bg, box} = Dlg2.shell('svgFilterApply', T('aifx2.applySvg'));
  const sel = h('select', {name:'filter', size:'10'}), ta = h('textarea', {name:'xml', spellcheck:'false'}), err = h('div', {class:'err'});
  const fill = pick => {
    sel.innerHTML = '';
    BUILTIN_NAMES.concat(Object.keys(lib())).forEach(n => sel.appendChild(h('option', {value:n, text:n})));
    sel.value = pick && (BUILTIN[pick] || lib()[pick]) ? pick : (curP && curP.name) || o.name || BUILTIN_NAMES[0];
    ta.value = (curP && curP.xml && sel.value === curP.name) ? curP.xml : (filterXml({name:sel.value}) || '');
  };
  fill(o.name);
  const cb = h('input', {type:'checkbox', name:'preview'}); cb.checked = true;
  const current = () => { const n = sel.value, std = filterXml({name:n}); return ta.value.trim() && ta.value.trim() !== (std || '').trim() ? {name:n, xml:ta.value} : (lib()[n] ? {name:n, xml:lib()[n]} : {name:n}); };
  const preview = () => { err.textContent = ''; if (!cb.checked) return pv.show(null); try { const c = current(); if (c.xml) parseFilter(c.xml); pv.show(c); } catch (e){ err.textContent = e.message; pv.show(null); } };
  const bNew = h('button', {'data-act':'new', text:T('aifx2.newFilter'), onclick:() => {
    let n = 1; while (lib()['Filter_' + n] || BUILTIN['Filter_' + n]) n++;
    const r = CMD.run('ai.effect.svgFilter.define', {name:'Filter_' + n, xml:ta.value});
    if (r.ok === false){ err.textContent = r.error; return; } fill(r.name); preview(); }});
  const bDel = h('button', {'data-act':'delete', text:T('aifx2.deleteFilter'), onclick:() => {
    const r = CMD.run('ai.effect.svgFilter.remove', {name:sel.value}); if (r.ok === false){ err.textContent = T('aifx2.cantDelete'); return; } fill(); preview(); }});
  box.appendChild(h('div', {class:'msg', text:T('aifx2.applyMsg')}));
  box.appendChild(sel); box.appendChild(h('div', {class:'tools'}, [bNew, bDel])); box.appendChild(ta);
  box.appendChild(h('label', {class:'ck'}, [cb, h('span', {text:T('aifx.preview')})])); box.appendChild(err);
  const finish = () => { Dlg2.close(); if (window.UI) UI.draw(); };
  const no = () => { pv.restore(); finish(); };
  const ok = () => { pv.restore(); const c = current(); const r = okRun(t, 'svgFilter', 'ai.effect.svgFilter.apply', c, index); if (r && r.ok === false){ err.textContent = r.error; return; } finish(); };
  box.appendChild(h('div', {class:'row'}, [h('button', {'data-act':'cancel', text:T('aifx.cancel'), onclick:no}), h('button', {'data-act':'ok', text:T('aifx.ok'), onclick:ok})]));
  sel.addEventListener('change', () => { ta.value = filterXml({name:sel.value}) || ''; preview(); });
  ta.addEventListener('input', preview); cb.addEventListener('change', preview);
  bg.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.preventDefault(); no(); } else if (e.key === 'Enter' && e.target !== ta){ e.preventDefault(); ok(); } });
  bg.addEventListener('pointerdown', e => { if (e.target === bg) no(); });
  sel.focus(); preview();
  return {ok:true, dialog:'svgFilterApply'};
});
/* 导入 SVG 滤镜…：浏览器选档（照 AI 是开档对话框选 .svg） */
reg('ai.effect.svgFilter.import.dialog', {params:'{} 开「导入 SVG 滤镜」：选一个 .svg 档（浏览器档案挑选器），读进里面的 <filter>（＝ai.effect.svgFilter.import）→ {ok, dialog}'}, () => {
  const {box} = Dlg2.shell('svgFilterImport', T('aifx2.importSvg'));
  const inp = h('input', {type:'file', name:'file', accept:'.svg,image/svg+xml'}), err = h('div', {class:'err'});
  box.appendChild(h('div', {class:'msg', text:T('aifx2.importMsg')})); box.appendChild(inp); box.appendChild(err);
  box.appendChild(h('div', {class:'row'}, [h('button', {'data-act':'cancel', text:T('aifx.cancel'), onclick:() => Dlg2.close()})]));
  inp.addEventListener('change', async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    const text = await f.text(); const r = CMD.run('ai.effect.svgFilter.import', {svg:text});
    if (r.ok === false){ err.textContent = r.error; return; }
    Dlg2.close(); AiFx2.lastImport = r.names;
    if (window.UI && UI.toast) UI.toast(T('aifx2.imported').replace('{n}', r.names.length)); if (window.UI) UI.draw();
  });
  return {ok:true, dialog:'svgFilterImport'};
});

/* ═════════════ 菜单项接上（只改 D 单那几项的 impl；用 id 精确找，不动别项）═════════════ */
const IMPL = {'effect.svgFilter.apply':'ai.effect.svgFilter.apply.dialog', 'effect.svgFilter.import':'ai.effect.svgFilter.import.dialog',
  'effect.path.outlineObject':'ai.effect.path.outlineObject', 'effect.pathfinder.hardMix':'ai.effect.pathfinder.hardMix', 'effect.pathfinder.softMix':'ai.effect.pathfinder.softMix',
  'effect.pathfinder.trap':'ai.effect.pathfinder.trap.dialog', 'effect.rasterize':'ai.effect.rasterize.dialog'};
BUILTIN_NAMES.forEach(n => { IMPL['effect.svgFilter.' + n] = 'ai.effect.svgFilter.' + n; });
if (window.MenuTrees && MenuTrees.ai && MenuTrees.ai.effect) MenuTrees.walk('ai', it => { if (IMPL[it.id] && !it.impl) it.impl = IMPL[it.id]; });   // 菜单档还没改到时的保险（菜单档已写好 impl 就不动）

/* ═════════════ 三语 ═════════════ */
const STR = {'zh-Hant':{}, 'zh-Hans':{}, en:{}};
[['aifx2.rasterize', '點陣化', '栅格化', 'Rasterize'], ['aifx2.antiAlias', '消除鋸齒', '消除锯齿', 'Anti-aliasing'], ['aifx2.aaNone', '無', '无', 'None'],
 ['aifx2.aaArt', '最佳化線條圖 (超取樣)', '优化图稿 (超像素取样)', 'Art Optimized (Supersampling)'], ['aifx2.badValue', '數值超出範圍', '数值超出范围', 'A value is out of range'],
 ['aifx2.trap', '補漏白', '陷印', 'Trap'], ['aifx2.settings', '設定', '设置', 'Settings'], ['aifx2.thickness', '粗細 (pt)', '粗细 (pt)', 'Thickness (pt)'],
 ['aifx2.heightWidth', '高度/寬度 (%)', '高度/宽度 (%)', 'Height/Width (%)'], ['aifx2.tintReduction', '色調減少 (%)', '色调减淡 (%)', 'Tint Reduction (%)'],
 ['aifx2.processColor', '以印刷色補漏白', '使用印刷色进行陷印', 'Traps with Process Color'], ['aifx2.reverse', '反轉補漏白', '反向陷印', 'Reverse Traps'],
 ['aifx2.softMix', '透明混合', '透明混合', 'Soft Mix'], ['aifx2.rate', '混合比率 (%)', '混合比率 (%)', 'Mixing Rate (%)'],
 ['aifx2.applySvg', '套用 SVG 濾鏡', '应用 SVG 滤镜', 'Apply SVG Filter'], ['aifx2.applyMsg', '選一個濾鏡；下面可以直接編輯它的 XML（改過就以自訂濾鏡套用）。', '选一个滤镜；下面可以直接编辑它的 XML（改过就以自定滤镜应用）。', 'Choose a filter; you can edit its XML below (an edited filter is applied as a custom one).'],
 ['aifx2.newFilter', '新增 SVG 濾鏡', '新建 SVG 滤镜', 'New SVG Filter'], ['aifx2.deleteFilter', '刪除 SVG 濾鏡', '删除 SVG 滤镜', 'Delete SVG Filter'],
 ['aifx2.cantDelete', '內建濾鏡不能刪除', '内建滤镜不能删除', 'Built-in filters can\'t be deleted'],
 ['aifx2.importSvg', '讀入 SVG 濾鏡', '导入 SVG 滤镜', 'Import SVG Filter'], ['aifx2.importMsg', '選一個 SVG 檔，裡面的 <filter> 會加進這份文件的 SVG 濾鏡清單。', '选一个 SVG 档，里面的 <filter> 会加进这份文件的 SVG 滤镜清单。', 'Choose an SVG file; its <filter> elements are added to this document\'s SVG filters.'],
 ['aifx2.imported', '已讀入 {n} 個 SVG 濾鏡', '已导入 {n} 个 SVG 滤镜', '{n} SVG filter(s) imported']
].forEach(([k, a, b, c]) => { STR['zh-Hant'][k] = a; STR['zh-Hans'][k] = b; STR.en[k] = c; });
if (window.Lang) Lang.add(STR);

Object.assign(AiFx2, {BUILTIN, parseFilter, runFilter, filterRegion, canInterpret, renderRaster, mixArt, trapArt, vectorArt, cachedArt, cleanParams, Dlg2, browserFilter, installHook});
window.AiFx2 = AiFx2;
if (window.UI && UI.draw) UI.draw();
})();
