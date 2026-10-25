/* 颜色取样器工具 colorsampler（PS「顏色取樣器工具／颜色取样器工具」，跟吸管同一格 I）
   🔴 原码没有·照 PS 2020 写（ArtCraft photocraft 的 enum Tool 没有 ColorSampler，grep color_sampler／colorSampler 于 ui-egui、engine 都是零）。
   照 Photoshop 2020 的行为：
     · 在画布上按一下 ⇒ 放一个取样点（#1、#2…，编号＝放的先后；删掉中间的，后面的往前补号），最多 10 个；满了再点 ⇒ 提示「所有颜色取样器都已使用」、不放。
       按下就放、按着可以拖着走、放开定位（PS 也是按下即出现、跟着游标）。
     · 按在既有取样点上（约 6 屏幕像素内）拖曳 ⇒ 搬动它；拖出文件范围放开 ⇒ 删掉它（PS：「把取样器拖出文件视窗即可删除」）。
     · Alt＋按一下取样点 ⇒ 删掉它（PS 游标变剪刀）。
     · 取样点落在像素格上（存整数像素座标），读的是合成后的画面（PS 资讯面板读的是整张图的合成色），
       取样大小照选项栏：取样点、3×3、5×5、11×11、31×31、51×51、101×101 平均（PS 2020 的七档；平均＝跟吸管同一支 alpha 加权平均）。
     · 读数在「资讯」面板（每个取样点一格 #n，可各自换读数模式：实际颜色／RGB／网页颜色／HSB／CMYK／Lab／灰度／不透明度）。
       资讯面板（menus/impl/ps-window.js 的 .icsamp 那格，读 colorsampler.list）每个取样点一格；选项栏尾巴也有一份。
     · 选项栏：取样大小、「全部清除」。
     · 取样点在颜色取样器工具作用中、或资讯面板开着时才画在画面上（PS：选了取样器工具或资讯面板开着时显示）。
     · PS 的取样点不进历史记录（放／搬／删都不占一步 Ctrl+Z）、跟着文件存（PSD 里有）——我们存在 Doc.colorSamplers，不进历史；
       新文件／开档清空（包 Doc.reset）；工程档存读包 Project.serialize／load（栏位 colorSamplers）。
   坐标：取样点是文件坐标，图层被移动过不影响（读的是合成画面）。 */
(function(){
const MAX = 10, SIZES = [1, 3, 5, 11, 31, 51, 101];
const MODES = ['actual', 'rgb', 'web', 'hsb', 'cmyk', 'lab', 'gray', 'opacity'];
const CS = window.ColorSampler = {
  sampleSize: 1,
  drag: null,            // {i, from:[x,y], moved:bool, created:bool}
  bar: null,
  _cache: null           // {key, canvas}：合成画面快取（文件没变就沿用）
};
const zoom = () => Math.max((window.UI && UI.zoom) || 1, 0.01);
const list = () => Array.isArray(Doc.colorSamplers) ? Doc.colorSamplers : [];
const setList = L => { Doc.colorSamplers = L.length ? L : undefined; };
const clampPx = p => [Math.max(0, Math.min(Doc.width - 1, Math.floor(p[0]))), Math.max(0, Math.min(Doc.height - 1, Math.floor(p[1])))];
const inside = p => p[0] >= 0 && p[1] >= 0 && p[0] < Doc.width && p[1] < Doc.height;
/* 新文件／开档清空（PS 取样器跟着文件走） */
if (window.Doc && Doc.reset && !Doc.__csReset){ const r0 = Doc.reset; Doc.reset = function(){ this.colorSamplers = undefined; return r0.apply(this, arguments); }; Doc.__csReset = true; }
/* 工程档存读：包 Project.serialize／load（同 ps-file.js、ai-effect.js 的做法；不改 engine.js）——存 colorSamplers:[{x,y,mode}]，读回 Doc.colorSamplers */
const PJ = typeof Project !== 'undefined' ? Project : window.Project;
if (PJ && PJ.serialize && PJ.load && !PJ.__csHook){
  PJ.__csHook = true;
  const ser0 = PJ.serialize, load0 = PJ.load;
  PJ.serialize = function(){ const o = ser0.apply(this, arguments); const L = Array.isArray(Doc.colorSamplers) ? Doc.colorSamplers : []; if (o && L.length) o.colorSamplers = L.map(s => ({x:s.x, y:s.y, mode:s.mode || 'actual'})); return o; };
  PJ.load = async function(json){
    const r = await load0.apply(this, arguments);
    const L = json && Array.isArray(json.colorSamplers) ? json.colorSamplers.filter(s => s && isFinite(s.x) && isFinite(s.y)).slice(0, MAX)
      .map(s => ({x:Math.max(0, Math.min(Doc.width - 1, Math.floor(s.x))), y:Math.max(0, Math.min(Doc.height - 1, Math.floor(s.y))), mode:MODES.includes(s.mode) ? s.mode : 'actual'})) : [];
    Doc.colorSamplers = L.length ? L : undefined; CS._cache = null;
    return r;
  };
}

/* ── 读数 ── */
function comp(fresh){
  const H = window.History || {past:[], future:[]};
  const key = [window.DilinCanvas && DilinCanvas.rev ? DilinCanvas.rev() : 0, H.past.length, H.future.length, Doc.width, Doc.height, Doc.layers.length].join('|');
  if (fresh || !CS._cache || CS._cache.key !== key) CS._cache = {key, canvas:composite(1)};
  return CS._cache.canvas;
}
/* 跟吸管 eyedropper.js samplePixels 同一支：以那格为中心 size×size、夹在图内、alpha 加权平均（直通 RGBA） */
function sample(img, x, y, size){
  if (window.Eyedropper && Eyedropper.samplePixels) return Eyedropper.samplePixels(img, x, y, size);
  const w = img.width, h = img.height, cx = Math.floor(x), cy = Math.floor(y);
  if (!(cx >= 0 && cx < w && cy >= 0 && cy < h)) return null;
  const r = Math.floor(Math.max(1, size | 0) / 2), x0 = Math.max(cx - r, 0), x1 = Math.min(cx + r, w - 1), y0 = Math.max(cy - r, 0), y1 = Math.min(cy + r, h - 1);
  const d = img.getContext('2d').getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
  let s0 = 0, s1 = 0, s2 = 0, al = 0, n = 0;
  for (let i = 0; i < d.length; i += 4){ const a = d[i + 3]; s0 += d[i] * a; s1 += d[i + 1] * a; s2 += d[i + 2] * a; al += a; n++; }
  if (al === 0) return [0, 0, 0, 0];
  const c = v => Math.floor((v + Math.floor(al / 2)) / al);
  return [c(s0), c(s1), c(s2), Math.floor((al + Math.floor(n / 2)) / n)];
}
const s2l = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
/* sRGB → Lab（D50，跟 ps-image.js srgbToLab 同一组 Bradford 适应后矩阵） */
function toLab(r, g, b){
  const lin = [s2l(r), s2l(g), s2l(b)], m = [[0.436074, 0.385064, 0.143080], [0.222504, 0.716878, 0.060618], [0.013932, 0.097104, 0.714173]], D50 = [0.9642, 1, 0.8249];
  const xyz = [0, 1, 2].map(i => (m[i][0] * lin[0] + m[i][1] * lin[1] + m[i][2] * lin[2]) / D50[i]);
  const e = Math.pow(6 / 29, 3), k = 3 * Math.pow(6 / 29, 2), f = t => t > e ? Math.cbrt(t) : t / k + 4 / 29;
  const fx = f(xyz[0]), fy = f(xyz[1]), fz = f(xyz[2]);
  return [Math.round(116 * fy - 16), Math.round(500 * (fx - fy)), Math.round(200 * (fy - fz))];
}
function toHsb(r, g, b){
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0; if (d){ if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [Math.round(h), Math.round(mx ? d / mx * 100 : 0), Math.round(mx / 255 * 100)];
}
function toCmyk(r, g, b){
  const R = r / 255, G = g / 255, B = b / 255, K = 1 - Math.max(R, G, B);
  if (K >= 1) return [0, 0, 0, 100];
  return [(1 - R - K) / (1 - K), (1 - G - K) / (1 - K), (1 - B - K) / (1 - K), K].map(v => Math.round(v * 100));
}
/* 一个取样点照它的读数模式出读数 */
function readOne(sp, img, size){
  const c = sample(img, sp.x, sp.y, size) || [0, 0, 0, 0], [r, g, b, a] = c, mode = sp.mode || 'actual';
  const out = {rgba:c, mode};
  switch (mode === 'actual' ? 'rgb' : mode){
    case 'rgb':     out.values = {R:r, G:g, B:b}; break;
    case 'web':     out.values = {'#':[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}; break;
    case 'hsb':     { const h = toHsb(r, g, b); out.values = {H:h[0] + '°', S:h[1] + '%', B:h[2] + '%'}; break; }
    case 'cmyk':    { const k = toCmyk(r, g, b); out.values = {C:k[0] + '%', M:k[1] + '%', Y:k[2] + '%', K:k[3] + '%'}; break; }
    case 'lab':     { const l = toLab(r, g, b); out.values = {L:l[0], a:l[1], b:l[2]}; break; }
    case 'gray':    out.values = {K:Math.round((1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255) * 100) + '%'}; break;
    case 'opacity': out.values = {Op:Math.round(a / 255 * 100) + '%'}; break;
  }
  return out;
}
function readAll(fresh, preview){
  const L = preview ? shown() : list(); if (!L.length) return [];          // 没有取样点就不必合成
  const img = comp(fresh);
  return L.map((sp, i) => Object.assign({index:i, number:i + 1, x:sp.x, y:sp.y}, readOne(sp, img, CS.sampleSize)));
}

/* ── 改资料（不进历史，照 PS） ── */
function hit(p){
  const tol = 6 / zoom(), L = list(); let best = -1, bd = Infinity;
  L.forEach((sp, i) => { const d = Math.hypot(sp.x + 0.5 - p[0], sp.y + 0.5 - p[1]); if (d <= tol && d < bd){ bd = d; best = i; } });
  return best;
}
let toastEl = null;
function toast(msg){
  const host = document.getElementById('canvasWrap') || document.body; if (!host) return;
  if (!toastEl){ toastEl = document.createElement('div'); toastEl.dataset.cs = 'toast'; toastEl.style.cssText = 'position:absolute;left:50%;top:12px;transform:translateX(-50%);background:#222c;color:#fff;padding:6px 12px;border-radius:6px;font-size:12px;z-index:50;pointer-events:none'; }
  toastEl.textContent = msg; host.appendChild(toastEl); clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.remove(), 1800);
}
/* 按下（滑鼠与 colorsampler.gesture 同一支） */
function press(p, mods){
  const i = hit(p);
  if (mods.alt){ if (i >= 0){ CMD.run('colorsampler.remove', {index:i}); return {action:'remove', index:i}; } return {action:'none'}; }
  if (i >= 0){ CS.drag = {i, from:[p[0], p[1]], moved:false, created:false}; return {action:'grab', index:i}; }
  if (!inside(p)) return {action:'none'};
  const r = CMD.run('colorsampler.add', {x:p[0], y:p[1]});
  if (r && r.ok === false){ toast(Lang.t('ui.csFull')); return {action:'full', result:r}; }
  CS.drag = {i:r.index, from:[p[0], p[1]], moved:false, created:true};
  return {action:'add', index:r.index};
}
function drag(p){
  const d = CS.drag; if (!d) return;
  if (!list()[d.i]) return;
  if (!d.moved && Math.hypot(p[0] - d.from[0], p[1] - d.from[1]) < 1) return;
  d.moved = true;
  // 拖曳中只是预览（叠画与读数照 d.pos），放开才走 colorsampler.move／remove 改文件资料
  if (inside(p)){ d.pos = clampPx(p); d.out = false; }
  else d.out = true;                                                    // 拖到文件外：记号停在最后的位置，放开时删
}
/* 拖曳中的预览位置套上去（只给叠画与读数用，不写回资料） */
function shown(){
  const d = CS.drag, L = list();
  if (!d || !d.pos || !L[d.i]) return L;
  return L.map((sp, i) => i === d.i ? Object.assign({}, sp, {x:d.pos[0], y:d.pos[1]}) : sp);
}
function release(p){
  const d = CS.drag; CS.drag = null; if (!d) return null;
  if (d.moved && !inside(p)){ CMD.run('colorsampler.remove', {index:d.i}); return {action:'removeByDrag', index:d.i}; }
  if (d.moved){ const q = clampPx(p); CMD.run('colorsampler.move', {index:d.i, x:q[0], y:q[1]}); return {action:d.created ? 'add' : 'move', index:d.i, x:q[0], y:q[1]}; }
  return {action:d.created ? 'add' : 'select', index:d.i};
}

/* ───────── 命令（agent 与滑鼠同一条路；都不进历史，照 PS） ───────── */
const idx = (p, cmd) => { const n = list().length; if (!Number.isInteger(p.index)) return {error:`${cmd}: pass \`index\` (0-based)`}; if (p.index < 0 || p.index >= n) return {error:`${cmd}: no sampler ${p.index} (there are ${n})`}; return {i:p.index}; };
CMD.reg('colorsampler.add', {i18n:'', params:'{x, y, mode?:"actual|rgb|web|hsb|cmyk|lab|gray|opacity"="actual"} 文件坐标；放一个取样点（落在那格像素；最多 10 个，满了回 ok:false）→ {ok, index, number, readout}'}, p => {
  if (!isFinite(p.x) || !isFinite(p.y)) return {ok:false, error:'colorsampler.add: pass `x` and `y`'};
  if (!inside([+p.x, +p.y])) return {ok:false, error:'colorsampler.add: the point is outside the document'};
  if (list().length >= MAX) return {ok:false, error:'All color samplers are in use (max 10)'};
  const q = clampPx([+p.x, +p.y]), sp = {x:q[0], y:q[1], mode:MODES.includes(p.mode) ? p.mode : 'actual'};
  const L = list().concat([sp]); setList(L);
  if (window.UI) UI.draw();
  const i = L.length - 1; return {ok:true, index:i, number:i + 1, readout:readAll(true)[i]};
});
CMD.reg('colorsampler.move', {i18n:'', params:'{index, x, y} 把第 index 个（0 起算）取样点搬到 (x,y)（落在那格像素；在文件外＝不搬、回 ok:false）→ {ok, index, x, y}'}, p => {
  const r = idx(p, 'colorsampler.move'); if (r.error) return {ok:false, error:r.error};
  if (!isFinite(p.x) || !isFinite(p.y) || !inside([+p.x, +p.y])) return {ok:false, error:'colorsampler.move: pass `x`/`y` inside the document'};
  const q = clampPx([+p.x, +p.y]), L = list().slice(); L[r.i] = Object.assign({}, L[r.i], {x:q[0], y:q[1]}); setList(L);
  if (window.UI) UI.draw();
  return {ok:true, index:r.i, x:q[0], y:q[1]};
});
CMD.reg('colorsampler.remove', {i18n:'', params:'{index} 删掉第 index 个（0 起算；后面的往前补号）→ {ok, remaining}'}, p => {
  const r = idx(p, 'colorsampler.remove'); if (r.error) return {ok:false, error:r.error};
  const L = list().slice(); L.splice(r.i, 1); setList(L);
  if (window.UI) UI.draw();
  return {ok:true, remaining:L.length};
});
CMD.reg('colorsampler.clear', {i18n:'', params:'{} 选项栏「全部清除」：删掉所有取样点 → {ok, deleted}'}, () => {
  const n = list().length; setList([]); if (window.UI) UI.draw(); return {ok:true, deleted:n};
});
CMD.reg('colorsampler.setMode', {i18n:'', params:'{index, mode:"actual|rgb|web|hsb|cmyk|lab|gray|opacity"} 资讯面板里那格的读数模式（PS 点 #n 旁的吸管选单）→ {ok, index, mode}'}, p => {
  const r = idx(p, 'colorsampler.setMode'); if (r.error) return {ok:false, error:r.error};
  if (!MODES.includes(p.mode)) return {ok:false, error:`colorsampler.setMode: mode must be ${MODES.join('|')}`};
  const L = list().slice(); L[r.i] = Object.assign({}, L[r.i], {mode:p.mode}); setList(L);
  return {ok:true, index:r.i, mode:p.mode};
});
CMD.reg('colorsampler.setOptions', {i18n:'', params:'{sampleSize?:1|3|5|11|31|51|101} 选项栏取样大小（取样点／n×n 平均；所有取样点的读数一起换）；{} 读回 → {ok, sampleSize}'}, p => {
  if (p.sampleSize !== undefined){ const n = +p.sampleSize; if (!SIZES.includes(n)) return {ok:false, error:'sampleSize must be one of ' + SIZES.join('|')}; CS.sampleSize = n; }
  if (window.UI && ToolState.cur === 'colorsampler'){ UI.buildOptions('colorsampler'); UI.draw(); }
  return {ok:true, sampleSize:CS.sampleSize};
});
CMD.reg('colorsampler.list', {i18n:'', params:'{fresh?:bool=true} 所有取样点与读数（缺省重新合成后读；fresh:false＝文件没变就用快取的合成画面，资讯面板跟着游标刷新用）→ {ok, sampleSize, samplers:[{index, number, x, y, mode, rgba:[r,g,b,a], values}]}'}, p =>
  ({ok:true, sampleSize:CS.sampleSize, samplers:readAll(!(p && p.fresh === false))}));
const pt2 = v => Array.isArray(v) && v.length >= 2 && isFinite(v[0]) && isFinite(v[1]) ? [+v[0], +v[1]] : null;
CMD.reg('colorsampler.gesture', {i18n:'', params:'{from:[x,y], to?:[x,y], alt?:bool, zoom?} 跟人用取样器工具按下、拖到 to 放开一样：按在取样点（6 屏幕像素内）上＝搬它（拖出文件＝删）；Alt＋按在取样点＝删；按在空处＝放一个新的（拖着走到 to）→ {ok, action, index}'}, p => {
  const a = pt2(p.from), b = pt2(p.to) || a; if (!a) return {ok:false, error:'colorsampler.gesture: pass `from`: [x, y]'};
  const z0 = window.UI ? UI.zoom : 1; if (isFinite(p.zoom) && p.zoom > 0 && window.UI) UI.zoom = +p.zoom;
  try { const mods = {alt:!!p.alt}, r = press(a, mods); if (r.action === 'remove' || r.action === 'none' || r.action === 'full') return Object.assign({ok:r.action !== 'full'}, r); drag(b); return Object.assign({ok:true}, release(b) || r); }
  finally { if (window.UI) UI.zoom = z0; }
});

/* ───────── 叠画：取样点（工具作用中或资讯面板开着）＋选项栏读数刷新 ───────── */
function visible(){ return ToolState.cur === 'colorsampler' || !!(window.DlPanels && DlPanels.isOpen && DlPanels.isOpen('info')); }
function drawSamplers(ctx, s){
  if (ToolState.cur === 'colorsampler') refreshBar();
  const L = shown(); if (!L.length || !visible()) return;
  const d = Math.min(window.devicePixelRatio || 1, 2);
  ctx.save(); ctx.setLineDash([]); ctx.font = `bold ${10 * d}px sans-serif`; ctx.textBaseline = 'top';
  L.forEach((sp, i) => {
    const x = (sp.x + 0.5) * s, y = (sp.y + 0.5) * s, r = 4 * d;
    // PS 的取样器记号：小圆圈＋穿过的十字，右下角编号（黑底白描，任何底色都看得见）
    for (const [w, c] of [[3 * d, 'rgba(0,0,0,0.7)'], [d, '#fff']]){
      ctx.lineWidth = w; ctx.strokeStyle = c;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 8 * d, y); ctx.lineTo(x - 2 * d, y); ctx.moveTo(x + 2 * d, y); ctx.lineTo(x + 8 * d, y);
      ctx.moveTo(x, y - 8 * d); ctx.lineTo(x, y - 2 * d); ctx.moveTo(x, y + 2 * d); ctx.lineTo(x, y + 8 * d); ctx.stroke();
    }
    const t = String(i + 1); ctx.lineWidth = 3 * d; ctx.strokeStyle = '#000'; ctx.strokeText(t, x + 5 * d, y + 4 * d); ctx.fillStyle = '#fff'; ctx.fillText(t, x + 5 * d, y + 4 * d);
  });
  ctx.restore();
}
function hookOverlay(){ if (window.UI && Array.isArray(UI.overlays) && !UI.__csOverlay){ UI.overlays.push(drawSamplers); UI.__csOverlay = true; } }
hookOverlay(); window.addEventListener('load', hookOverlay);

function fmtVals(v){ return Object.entries(v || {}).map(([k, x]) => `${k}:${x}`).join(' '); }
function refreshBar(){
  const b = CS.bar; if (!b || !b.read || !b.read.isConnected) return;
  let txt = '';
  try { txt = readAll(false, true).map(r => `#${r.number} ${fmtVals(r.values)}`).join('   '); } catch (e){ txt = ''; }
  if (b.read.textContent !== txt) b.read.textContent = txt;
  if (b.clear) b.clear.disabled = !list().length;
}

/* ───────── 工具 ───────── */
Tools.reg({
  id:'colorsampler', icon:'⊕', group:'misc', order:21, for:'raster', opts:[],
  hint:'ui.csHint',
  strings:{
    'zh-Hant':{ 'tool.colorsampler':'顏色取樣器工具', 'opt.csSize':'樣本尺寸：', 'opt.csSize.1':'點狀樣本', 'opt.csSize.3':'3×3 平均', 'opt.csSize.5':'5×5 平均', 'opt.csSize.11':'11×11 平均',
                'opt.csSize.31':'31×31 平均', 'opt.csSize.51':'51×51 平均', 'opt.csSize.101':'101×101 平均', 'ui.csClear':'全部清除', 'ui.csFull':'所有顏色取樣器都已使用（最多 10 個）',
                'ui.csHint':'按一下放取樣點（最多 10 個）· 拖曳可移動、拖出文件刪除 · Alt＋按一下刪除' },
    'zh-Hans':{ 'tool.colorsampler':'颜色取样器工具', 'opt.csSize':'取样大小：', 'opt.csSize.1':'取样点', 'opt.csSize.3':'3×3 平均', 'opt.csSize.5':'5×5 平均', 'opt.csSize.11':'11×11 平均',
                'opt.csSize.31':'31×31 平均', 'opt.csSize.51':'51×51 平均', 'opt.csSize.101':'101×101 平均', 'ui.csClear':'全部清除', 'ui.csFull':'所有颜色取样器都已使用（最多 10 个）',
                'ui.csHint':'单击放取样点（最多 10 个）· 拖动可移动、拖出文档删除 · Alt＋单击删除' },
    'en':     { 'tool.colorsampler':'Color Sampler Tool', 'opt.csSize':'Sample Size:', 'opt.csSize.1':'Point Sample', 'opt.csSize.3':'3 by 3 Average', 'opt.csSize.5':'5 by 5 Average', 'opt.csSize.11':'11 by 11 Average',
                'opt.csSize.31':'31 by 31 Average', 'opt.csSize.51':'51 by 51 Average', 'opt.csSize.101':'101 by 101 Average', 'ui.csClear':'Clear All', 'ui.csFull':'All color samplers are in use (max 10)',
                'ui.csHint':'Click to place a sampler (up to 10) · drag to move, drag off the document to delete · Alt-click to delete' }
  },
  buildOptions(box, add){
    const b = CS.bar = {};
    const sel = document.createElement('select'); sel.dataset.cs = 'sampleSize';
    SIZES.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = Lang.t('opt.csSize.' + n); if (n === CS.sampleSize) o.selected = true; sel.appendChild(o); });
    sel.onchange = () => CMD.run('colorsampler.setOptions', {sampleSize:+sel.value});
    add('csSize', sel);
    b.clear = document.createElement('button'); b.clear.textContent = Lang.t('ui.csClear'); b.clear.dataset.cs = 'clear';
    b.clear.onclick = () => CMD.run('colorsampler.clear', {});
    box.appendChild(b.clear);
    b.read = document.createElement('span'); b.read.dataset.cs = 'readout'; b.read.style.cssText = 'font-family:monospace;font-size:11px;color:#c8ced8;white-space:nowrap';
    box.appendChild(b.read);
    refreshBar();
  },
  onDown(e, pt){ press(pt, {alt:e.altKey}); UI.draw(); },
  onMove(e, pt, P){ if (!P.down || !CS.drag) return; drag(pt); UI.draw(); },
  onUp(e, pt){ release(pt); UI.draw(); },
  onDeactivate(){ CS.drag = null; }
});
})();
