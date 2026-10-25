/* 物件的不透明度与混合模式——照 Illustrator 2020 透明度面板的行为：
   · s.opacity（0..1）与 s.blend（normal|multiply|screen|overlay|darken|lighten|colorDodge|colorBurn|hardLight|softLight|difference|exclusion|hue|saturation|color|luminosity）
     作用在「整个物件」上：填色与描边先合成成一张、再整张按不透明度／混合模式叠到底下（AI：物件不透明度＝隔离的整体，不是填色描边各自半透明；
     编组的不透明度＝整组先合成再降，组里重叠的地方不会变深）。
   · 画面：先把去掉 opacity／blend 的副本画进一张离屏画布（同样的变换矩阵），再 globalAlpha × opacity、globalCompositeOperation＝混合模式 drawImage 回去。
   · SVG：<g opacity="…" style="mix-blend-mode:…">…</g> 包住原本的输出（AI 导出 SVG 也是这样写）。
   🔴 正式做法是改 engine.js 的 drawShape 与 Project.toSVG；engine 没改之前本档先用包法接上：
     ① 包 ObjRender.handles／draw／toSVG（engine drawShape 与 toSVG 都先问它）；
     ② 包最外层的 window.drawShape（menus/impl/ai-window.js 的包装用 globalAlpha 逐个降、编组会叠深——本档在它外面先隔离、再把去掉透明度的副本交给它）。
   engine 接上后（drawShape 原文里出现 __objOpacity 字样）本档自动不再包。 */
(function(){
'use strict';
if (window.ObjOpacity) return;

/* AI 混合模式名 → canvas globalCompositeOperation／CSS mix-blend-mode（两边同一套名字） */
const BLEND = {normal:'source-over', darken:'darken', multiply:'multiply', colorBurn:'color-burn', lighten:'lighten', screen:'screen', colorDodge:'color-dodge',
  overlay:'overlay', softLight:'soft-light', hardLight:'hard-light', difference:'difference', exclusion:'exclusion', hue:'hue', saturation:'saturation', color:'color', luminosity:'luminosity'};
const cssBlend = b => (BLEND[b] || '').replace('source-over', 'normal');
const clamp01 = v => Math.min(1, Math.max(0, +v));

/* 这个物件要不要隔离着画：有不透明度 < 1 或非正常混合模式（不透明蒙版由 ai-window.js 的 drawMasked 自己处理不透明度，别抢） */
function needs(s){
  if (!s || s.visible === false) return false;
  if (s.opMask && !s.opMask.disabled && Array.isArray(s.opMask.art)) return false;
  const op = s.opacity !== undefined && s.opacity !== null && isFinite(+s.opacity) && +s.opacity < 1;
  const bl = !!s.blend && s.blend !== 'normal' && !!BLEND[s.blend];
  return op || bl;
}
const strip = s => { const c = Object.assign({}, s); delete c.opacity; delete c.blend; return c; };

/* 隔离着画：去掉透明度的副本画进离屏（同变换）→ 按不透明度／混合模式叠回 ctx（ctx 的剪切区照样有效） */
function drawIsolated(ctx, s, S, inner){
  const cv = ctx.canvas;
  if (!cv || !ctx.getTransform || !cv.width || !cv.height){       // 没有画布可借（极少数假 ctx）：退回逐个降
    ctx.save(); ctx.globalAlpha *= clamp01(s.opacity === undefined ? 1 : s.opacity);
    if (BLEND[s.blend]) ctx.globalCompositeOperation = BLEND[s.blend];
    try { inner(ctx, strip(s), S); } finally { ctx.restore(); }
    return;
  }
  const off = document.createElement('canvas'); off.width = cv.width; off.height = cv.height;
  const ox = off.getContext('2d'); ox.setTransform(ctx.getTransform());
  inner(ox, strip(s), S);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= clamp01(s.opacity === undefined ? 1 : s.opacity);
  ctx.globalCompositeOperation = BLEND[s.blend] || 'source-over';
  ctx.drawImage(off, 0, 0);
  ctx.restore();
}

/* 一个一般形状的 SVG（跟 engine Project.toSVG 里那段同一写法；ObjRender 不管的形状才走这里） */
function plainSVG(s){
  let defs = '';
  const svgPaint = (v, k) => (v && typeof v === 'object') ? (window.GradientFill ? (defs += GradientFill.toSVG(v, s.id + '_' + k), `url(#${s.id}_${k})`) : 'none') : (v || 'none');
  const pa = `fill="${svgPaint(s.fill, 'f')}" stroke="${svgPaint(s.stroke, 's')}" stroke-width="${s.strokeWidth || 0}"`;
  let body = '';
  if (s.type === 'rect') body = `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.radius || 0}" ${pa}/>`;
  else if (s.type === 'ellipse') body = `<ellipse cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${Math.abs(s.w / 2)}" ry="${Math.abs(s.h / 2)}" ${pa}/>`;
  else if (s.type === 'bezier') body = `<path d="${bezierD(s)}" ${pa}/>`;
  else if (s.type === 'mesh') body = window.MeshRender ? MeshRender.toSVG(s) : '';
  else {
    const pts = svgPoints(s), open = (s.type === 'path' || s.type === 'line') && !s.closed;
    if (pts) body = `<${open ? 'polyline' : 'polygon'} points="${pts}" ${pa}/>`;
  }
  return (defs ? `<defs>${defs}</defs>` : '') + body;
}
function wrapSVG(s, inner){
  const op = s.opacity !== undefined && +s.opacity < 1 ? ` opacity="${+clamp01(s.opacity).toFixed(4)}"` : '';
  const bl = s.blend && s.blend !== 'normal' && BLEND[s.blend] ? ` style="mix-blend-mode:${cssBlend(s.blend)}"` : '';
  return `<g data-obj-opacity="1"${op}${bl}>${inner}</g>`;
}

const engineHasIt = () => typeof drawShape === 'function' && /__objOpacity/.test(String(drawShape));

/* ① 包 ObjRender（engine drawShape／toSVG 都先问它） */
function hookObjRender(){
  const R = window.ObjRender;
  if (!R || R.__objOpacity || engineHasIt()) return;
  R.__objOpacity = true;
  const h0 = R.handles, d0 = R.draw, s0 = R.toSVG;
  R.handles = function(s){ return needs(s) || h0.call(this, s); };
  R.draw = function(ctx, s, S){
    if (needs(s)) return drawIsolated(ctx, s, S, (c, x, k) => window.drawShape(c, x, k));
    return d0.call(this, ctx, s, S);
  };
  R.toSVG = function(s){
    if (needs(s)){ const c = strip(s); return wrapSVG(s, h0.call(R, c) ? R.toSVG(c) : plainSVG(c)); }
    return s0.call(this, s);
  };
}
/* ② 包最外层的 drawShape（在 ai-window.js 的 globalAlpha 包装外面先隔离） */
function hookDraw(){
  if (typeof window.drawShape !== 'function' || window.drawShape.__objOpacity || engineHasIt()) return;
  const orig = window.drawShape;
  const w = function(ctx, s, scale){
    if (needs(s)) return drawIsolated(ctx, s, scale, (c, x, k) => orig.call(this, c, x, k));
    return orig.call(this, ctx, s, scale);
  };
  w.__objOpacity = true;
  w.toString = () => String(orig);      // 别的测试拿 drawShape 原文去改（同 ai-object.js 的写法）
  window.drawShape = w;
}
function install(){ hookObjRender(); hookDraw(); }
install();
/* 本档若比 ai-object／ai-window 先载（例如 index.html 放错位置），载完再补包一次 */
if (document.readyState !== 'complete') window.addEventListener('load', install);

window.ObjOpacity = {BLEND, needs, drawIsolated, plainSVG, wrapSVG, install};
})();
