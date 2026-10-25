/* 堤麟画板 · 拾色器（前景色／背景色）——照 photocraft ui-egui/src/color_picker_ui.rs 全档翻（PS 的 Adobe 拾色器）：
   256×256 色域＋一条分量滑杆（H／S／B／R／G／B 单选决定哪个分量在滑杆上）、新的／当前色块（点「当前」还原）、只有 Web 颜色、
   HSB／RGB／Lab／CMYK／# 栏位；确定＝设前景色或背景色（原码 tools.setColors；我们走 eyedropper.setColors）。
   原码没有、照 PS 2020 补：对话框开着时游标移到图像上变吸管，点一下（可拖）取合成后的颜色当「新的」（PS 的拾色器就能这样从图里取色）。
   CMYK：跟文件模式 CMYK 共用 ps-image.js 的工作用 CMYK（PS 预设「U.S. Web Coated (SWOP) v2」的近似），见下面 rgbToCmyk。
   首选项 一般 ▸ 拾色器＝「系统」时照旧开浏览器自带的选色框（PS 的 Windows 拾色器）。
   命令：ui.colorPicker {target:"foreground|background", color?} 开对话框；ui.colorPicker.set {color|h,s,b|r,g,b|L,a,b|c,m,y,k|mode|webOnly|sample:[x,y]}；
         ui.colorPicker.ok／cancel；ui.colorPicker.state。 */
(function(){
'use strict';
if (window.ColorPicker) return;
const L3 = (h, s, e) => ({'zh-Hant':h, 'zh-Hans':s, en:e});
const T = o => (o && typeof o === 'object') ? (o[Lang.cur] || o['zh-Hans'] || o.en) : String(o);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ── color_picker_ui.rs:17-98 ── */
function hsvToRgb(h, s, v){
  h = (((h % 360) + 360) % 360) / 60;
  const c = v * s, x = c * (1 - Math.abs(h % 2 - 1));
  const k = Math.floor(h), [r, g, b] = k === 0 ? [c, x, 0] : k === 1 ? [x, c, 0] : k === 2 ? [0, c, x] : k === 3 ? [0, x, c] : k === 4 ? [x, 0, c] : [c, 0, x];
  const m = v - c; return [r + m, g + m, b + m];
}
function rgbToHsv(c){
  const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), d = mx - mn;
  const h = d <= 0 ? 0 : mx === c[0] ? 60 * ((((c[1] - c[2]) / d) % 6 + 6) % 6) : mx === c[1] ? 60 * ((c[2] - c[0]) / d + 2) : 60 * ((c[0] - c[1]) / d + 4);
  return [h, mx <= 0 ? 0 : d / mx, mx];
}
const hex = c => '#' + c.map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
const parseHex = s => { const h = String(s || '').trim().replace(/^#/, ''); if (!/^[0-9a-f]{6}$/i.test(h)) return null; return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); };
function fieldColor(mode, z, x, y){
  switch (mode){
    case 's': return hsvToRgb(x * 360, z, 1 - y);
    case 'v': return hsvToRgb(x * 360, 1 - y, z);
    case 'r': return [z, 1 - y, x];
    case 'g': return [1 - y, z, x];
    case 'b': return [x, 1 - y, z];
    default:  return hsvToRgb(z * 360, x, 1 - y);
  }
}
function locate(mode, hsv, rgb){
  const h = hsv[0] / 360;
  switch (mode){
    case 's': return [h, 1 - hsv[2], hsv[1]];
    case 'v': return [h, 1 - hsv[1], hsv[2]];
    case 'r': return [rgb[2], 1 - rgb[1], rgb[0]];
    case 'g': return [rgb[2], 1 - rgb[0], rgb[1]];
    case 'b': return [rgb[0], 1 - rgb[1], rgb[2]];
    default:  return [hsv[1], 1 - hsv[2], h];
  }
}
function sliderColor(mode, z, hsv, rgb){
  switch (mode){
    case 's': return hsvToRgb(hsv[0], z, hsv[2]);
    case 'v': return hsvToRgb(hsv[0], hsv[1], z);
    case 'r': return [z, rgb[1], rgb[2]];
    case 'g': return [rgb[0], z, rgb[2]];
    case 'b': return [rgb[0], rgb[1], z];
    default:  return hsvToRgb(z * 360, 1, 1);
  }
}
/* color/src/convert.rs:148-207（Lab D50，Bradford）＋ 161-174 naive CMYK */
const toLin = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const toEnc = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
const D50 = [0.96422, 1, 0.82521];
function srgbToLab(rgb){
  const l = rgb.map(toLin), m = [[0.436074, 0.385064, 0.143080], [0.222504, 0.716878, 0.060618], [0.013932, 0.097104, 0.714173]];
  const xyz = m.map((r, i) => (r[0] * l[0] + r[1] * l[1] + r[2] * l[2]) / D50[i]);
  const f = t => t > Math.pow(6 / 29, 3) ? Math.cbrt(t) : t / (3 * Math.pow(6 / 29, 2)) + 4 / 29;
  const [fx, fy, fz] = xyz.map(f);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function labToSrgb(lab){
  const fy = (lab[0] + 16) / 116, fx = fy + lab[1] / 500, fz = fy - lab[2] / 200;
  const finv = t => t > 6 / 29 ? t * t * t : 3 * Math.pow(6 / 29, 2) * (t - 4 / 29);
  const xyz = [finv(fx) * D50[0], finv(fy) * D50[1], finv(fz) * D50[2]];
  const m = [[3.133856, -1.616867, -0.490615], [-0.978768, 1.916142, 0.033454], [0.071945, -0.228991, 1.405243]];
  return m.map(r => toEnc(clamp(r[0] * xyz[0] + r[1] * xyz[1] + r[2] * xyz[2], 0, 1)));
}
/* CMYK：跟文件模式 CMYK 同一套（menus/impl/ps-image.js 的工作用 CMYK＝「U.S. Web Coated (SWOP) v2」近似：SWOP 特征查表、总墨量 300%、PS 那套黑版生成；
   相对比色＋黑场补偿＝PS 颜色设置预设）；那支没载才退回原码的 rgb_to_cmyk_naive（全 GCR） */
const cms = () => window.PsImageMode && PsImageMode.cms && PsImageMode.cms.rgbToCmyk ? PsImageMode.cms : null;
function rgbToCmyk(rgb){
  const C = cms(); if (C) return C.rgbToCmyk(...rgb.map(v => Math.round(clamp(v, 0, 1) * 255)), 'relative', true);
  const k = 1 - Math.max(rgb[0], rgb[1], rgb[2]); if (k >= 1 - 1e-6) return [0, 0, 0, 1]; const d = 1 - k; return [(1 - rgb[0] - k) / d, (1 - rgb[1] - k) / d, (1 - rgb[2] - k) / d, k];
}
function cmykToRgb(c){ const C = cms(); if (C) return C.cmykToRgb(c.map(v => clamp(v, 0, 1))); const k = 1 - c[3]; return [(1 - c[0]) * k, (1 - c[1]) * k, (1 - c[2]) * k]; }

const MODES = [['h', 'H:'], ['s', 'S:'], ['v', 'B:'], ['r', 'R:'], ['g', 'G:'], ['b', 'B:']];
const curHex = target => { const e = document.getElementById(target === 'background' ? 'strokeColor' : 'fillColor'); return e ? e.value.toLowerCase() : (target === 'background' ? '#ffffff' : '#000000'); };

/* 对话框状态（原码放在 dialog fields：color、__orig、__hsv、__mode、__webOnly） */
let S = null;
/* 133-158 current／set_rgb：hsv 跟 color 对得上就沿用（灰色时色相不丢） */
function current(){
  const rgb = parseHex(S.color) || [0, 0, 0];
  const hsv = (S.hsv && hex(hsvToRgb(S.hsv[0], S.hsv[1], S.hsv[2])) === hex(rgb)) ? S.hsv : rgbToHsv(rgb);
  return [rgb, hsv];
}
function setRgb(rgb, hsv){
  S.cmyk = null;                                                // 改了别的分量 ⇒ CMYK 照新颜色重算
  const web = S.webOnly, c = web ? rgb.map(v => Math.round(v * 5) / 5) : rgb;
  S.color = hex(c);
  S.hsv = (hsv && !web) ? hsv : rgbToHsv(c);
  draw();
  if (S.onChange){ try { S.onChange(S.color); } catch (e){ console.error(e); } }   // 改填充层颜色（PS：拾色器开着时画面即时跟着变）
}

/* ── 画出来 ── */
function css(){
  if (document.getElementById('dl-cp-css')) return;
  const st = document.createElement('style'); st.id = 'dl-cp-css';
  st.textContent = `
.dl-cp{position:fixed;box-sizing:border-box;z-index:10050;background:#2b2f36;color:#e6e8eb;border:1px solid #444a55;border-radius:6px;padding:10px 14px 12px;font:12px sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);user-select:none}
.dl-cp h3{margin:0 0 8px;font-size:13px;font-weight:600;cursor:move}
.dl-cp .row{display:flex;gap:10px;align-items:flex-start}
.dl-cp canvas{display:block;border:1px solid #555c68}
.dl-cp .strip{position:relative}
.dl-cp .strip .arr{position:absolute;left:-7px;width:34px;height:0;border-top:1px solid #e6e8eb;pointer-events:none}
.dl-cp .sw{width:64px;border:1px solid #555c68}
.dl-cp .sw div{height:36px}
.dl-cp .lb{color:#9aa3b0;font-size:11px}
.dl-cp .grid{display:grid;grid-template-columns:16px 20px 54px 14px;gap:3px 4px;align-items:center}
.dl-cp input[type=number],.dl-cp input[type=text]{width:50px;background:#1d2026;color:#e6e8eb;border:1px solid #444a55;border-radius:3px;padding:1px 3px;font:12px monospace}
.dl-cp .btns{display:flex;flex-direction:column;gap:6px;min-width:84px}
.dl-cp button{background:#3a404a;color:#e6e8eb;border:1px solid #555c68;border-radius:3px;padding:3px 10px;cursor:pointer}
.dl-cp button.pri{background:#2f7fd8;border-color:#2f7fd8}
.dl-cp .hint{color:#9aa3b0;font-size:11px;margin-top:6px;max-width:520px}
.dl-cp .lib{gap:10px}
.dl-cp .lib .list{width:300px;height:256px;overflow:auto;border:1px solid #555c68;background:#1d2026;outline:none}
.dl-cp .lib .it{display:flex;align-items:center;gap:8px;padding:2px 6px;cursor:pointer;white-space:nowrap}
.dl-cp .lib .it.on{background:#2f4f8a}
.dl-cp .lib .it i{display:inline-block;width:28px;height:14px;border:1px solid #555c68}
.dl-cp .lib select{background:#1d2026;color:#e6e8eb;border:1px solid #444a55;border-radius:3px;padding:2px 4px;max-width:300px}
.dl-cp .swname{position:absolute;inset:0;background:rgba(20,22,26,.85);align-items:center;justify-content:center}
.dl-cp .swname .pane{background:#2b2f36;border:1px solid #555c68;border-radius:5px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.dl-cp .swname input{width:200px}`;
  document.head.appendChild(st);
}
const FIELD = 256, STRIP = 20;
function build(){
  css();
  const box = document.createElement('div'); box.className = 'dl-cp'; box.dataset.dlg = 'colorPicker'; box.dataset.target = S.target;
  const title = S.target === 'background' ? L3('檢色器 (背景色)', '拾色器（背景色）', 'Color Picker (Background Color)') : S.target === 'foreground' ? L3('檢色器 (前景色)', '拾色器（前景色）', 'Color Picker (Foreground Color)') : (S.label || L3('檢色器', '拾色器', 'Color Picker'));
  box.innerHTML = `<h3>${T(title)}</h3><div class="row">
    <canvas class="field" width="${FIELD}" height="${FIELD}" data-cp="field"></canvas>
    <div class="strip"><canvas width="${STRIP}" height="${FIELD}" data-cp="strip"></canvas><div class="arr"></div></div>
    <div><div class="lb">${T(L3('新的', '新的', 'new'))}</div><div class="sw"><div data-cp="new"></div><div data-cp="cur" title="${T(L3('按一下還原為目前顏色', '单击以恢复为当前颜色', 'Click to restore the current colour'))}" style="cursor:pointer"></div></div>
      <div class="lb">${T(L3('目前', '当前', 'current'))}</div>
      <label style="display:flex;gap:4px;align-items:center;margin-top:10px"><input type="checkbox" data-cp="web">${T(L3('只有網頁顏色', '只有 Web 颜色', 'Only Web Colors'))}</label></div>
    <div class="grid" data-cp="grid"></div>
    <div class="btns"><button class="pri" data-cp="ok">${T(L3('確定', '确定', 'OK'))}</button><button data-cp="cancel">${T(L3('取消', '取消', 'Cancel'))}</button>
      <button data-cp="addSw">${T(L3('增加至色票', '添加到色板', 'Add to Swatches'))}</button><button data-cp="libs">${T(L3('色彩庫', '颜色库', 'Color Libraries'))}</button></div>
  </div>
  <div class="lib" data-cp="lib" style="display:none"></div>
  <div class="swname" data-cp="swname" style="display:none"></div><div class="hint">${T(L3('游標移到影像上＝滴管：按一下取樣顏色', '光标移到图像上＝吸管：单击取样颜色', 'Move over the image to sample a colour with the eyedropper'))}</div>`;
  const grid = box.querySelector('[data-cp=grid]');
  const num = (k, min, max) => { const i = document.createElement('input'); i.type = 'number'; i.min = min; i.max = max; i.step = 1; i.dataset.k = k; return i; };
  const add = (a, b, c, d) => [a, b, c, d].forEach(x => grid.appendChild(typeof x === 'string' ? Object.assign(document.createElement('span'), {textContent:x, className:'lb'}) : x));
  MODES.forEach(([k, lab], i) => {
    const r = document.createElement('input'); r.type = 'radio'; r.name = 'dl-cp-mode'; r.value = k; r.dataset.mode = k;
    r.onchange = () => { if (r.checked){ S.mode = k; draw(); } };
    add(r, lab, num(['h', 's', 'v', 'r', 'g', 'bb'][i], 0, i === 0 ? 360 : i < 3 ? 100 : 255), i === 0 ? '°' : i < 3 ? '%' : '');
  });
  [['L', 0, 100], ['a', -128, 127], ['b', -128, 127]].forEach(([k, a, b]) => add('', k + ':', num('lab' + k, a, b), ''));
  ['C', 'M', 'Y', 'K'].forEach(k => add('', k + ':', num('cmyk' + k, 0, 100), '%'));
  const hx = document.createElement('input'); hx.type = 'text'; hx.dataset.k = 'hex'; hx.maxLength = 7; add('', '#', hx, '');
  // 栏位改了（fields 250-328）
  grid.addEventListener('change', e => {
    const k = e.target.dataset.k; if (!k || !S) return;
    const v = parseFloat(e.target.value), [rgb, hsv] = current();
    if (k === 'hex'){ const c = parseHex(e.target.value); if (c) setRgb(c, null); else draw(); return; }
    if (!isFinite(v)){ draw(); return; }
    if (k === 'h' || k === 's' || k === 'v'){ const h = hsv.slice(), i = 'hsv'.indexOf(k); h[i] = i === 0 ? clamp(v, 0, 360) : clamp(v, 0, 100) / 100; setRgb(hsvToRgb(h[0], h[1], h[2]), h); }
    else if (k === 'r' || k === 'g' || k === 'bb'){ const c = rgb.slice(); c[{r:0, g:1, bb:2}[k]] = clamp(v, 0, 255) / 255; setRgb(c, null); }
    else if (k.startsWith('lab')){ const l = srgbToLab(rgb); l['Lab'.indexOf(k[3])] = v; setRgb(labToSrgb(l).map(x => clamp(x, 0, 1)), null); }
    else if (k.startsWith('cmyk')){   // PS：打 CMYK 就记住打的那组（连打四格不会被 RGB 来回换算带偏）
      const c = S.cmyk ? S.cmyk.slice() : rgbToCmyk(rgb); c['CMYK'.indexOf(k[4])] = clamp(v, 0, 100) / 100;
      setRgb(cmykToRgb(c).map(x => clamp(x, 0, 1)), null); S.cmyk = c; draw(); }
  });
  const field = box.querySelector('[data-cp=field]'), strip = box.querySelector('[data-cp=strip]');
  const dragOn = (el, fn) => el.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation(); try { el.setPointerCapture(e.pointerId); } catch (_){}
    const go = ev => { const b = el.getBoundingClientRect(); fn(clamp((ev.clientX - b.left) / b.width, 0, 1), clamp((ev.clientY - b.top) / b.height, 0, 1)); };
    go(e);
    const mv = ev => go(ev), up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
  // 色域（body 189-201）
  dragOn(field, (x, y) => {
    const [rgb, hsv] = current(), fz = locate(S.mode, hsv, rgb)[2], c = fieldColor(S.mode, fz, x, y);
    const h = S.mode === 'h' ? [fz * 360, x, 1 - y] : S.mode === 's' ? [x * 360, fz, 1 - y] : S.mode === 'v' ? [x * 360, 1 - y, fz] : null;
    setRgb(c, h);
  });
  // 分量滑杆（203-220）：色相上 360° 下 0°
  dragOn(strip, (x, y) => {
    const [rgb, hsv] = current(), z = 1 - y;
    const h = S.mode === 'h' ? [z * 360, hsv[1], hsv[2]] : S.mode === 's' ? [hsv[0], z, hsv[2]] : S.mode === 'v' ? [hsv[0], hsv[1], z] : null;
    setRgb(h ? hsvToRgb(h[0], h[1], h[2]) : sliderColor(S.mode, z, hsv, rgb), h);
  });
  box.querySelector('[data-cp=cur]').onclick = () => { const o = parseHex(S.orig); if (o) setRgb(o, null); };
  box.querySelector('[data-cp=web]').onchange = e => { S.webOnly = e.target.checked; setRgb(current()[0], null); };
  box.querySelector('[data-cp=ok]').onclick = () => CMD.run('ui.colorPicker.ok', {});
  box.querySelector('[data-cp=cancel]').onclick = () => CMD.run('ui.colorPicker.cancel', {});
  box.querySelector('[data-cp=addSw]').onclick = () => askSwatchName();
  box.querySelector('[data-cp=libs]').onclick = () => CMD.run('ui.colorPicker.library', {});
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); if (e.target.dataset && e.target.dataset.k) e.target.dispatchEvent(new Event('change', {bubbles:true})); CMD.run('ui.colorPicker.ok', {}); }
    else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); CMD.run('ui.colorPicker.cancel', {}); }
  });
  // 标题列拖动
  const h3 = box.querySelector('h3');
  h3.addEventListener('pointerdown', e => {
    const b = box.getBoundingClientRect(), dx = e.clientX - b.left, dy = e.clientY - b.top; h3.setPointerCapture(e.pointerId);
    const mv = ev => { box.style.left = (ev.clientX - dx) + 'px'; box.style.top = (ev.clientY - dy) + 'px'; };
    const up = () => { h3.removeEventListener('pointermove', mv); h3.removeEventListener('pointerup', up); };
    h3.addEventListener('pointermove', mv); h3.addEventListener('pointerup', up);
  });
  document.body.appendChild(box);
  // 放在画布右上（不挡住图像中间：PS 的拾色器也是浮动的、可以点图像取色）
  const host = (window.UI && (UI.wrap || UI.canvas)) ? (UI.wrap || UI.canvas).getBoundingClientRect() : {right:innerWidth, top:40};
  const bw = box.offsetWidth, bh = box.offsetHeight;
  box.style.left = Math.max(4, Math.min(innerWidth - bw - 4, host.right - bw - 12)) + 'px'; box.style.top = Math.max(4, host.top + 12) + 'px';
  // 图像本身在画面里看得到时，尽量摆在图像旁边（右、左、下、上有位子就放），别盖住要吸色的图
  if (window.UI && UI.canvas && UI.wrap){
    const c = UI.canvas.getBoundingClientRect(), w = UI.wrap.getBoundingClientRect();
    const vis = {l:Math.max(c.left, w.left), t:Math.max(c.top, w.top), r:Math.min(c.right, w.right), b:Math.min(c.bottom, w.bottom)};
    const cx = v => Math.max(4, Math.min(innerWidth - bw - 4, v)), cy = v => Math.max(4, Math.min(innerHeight - bh - 4, v));
    const spots = [[parseFloat(box.style.left), parseFloat(box.style.top)], [vis.r + 8, vis.t], [vis.l - bw - 8, vis.t], [vis.l, vis.b + 8], [vis.l, vis.t - bh - 8], [w.right - bw - 4, w.bottom - bh - 4], [w.left + 4, w.bottom - bh - 4]]
      .map(q => [cx(q[0]), cy(q[1])]);
    const over = q => Math.max(0, Math.min(q[0] + bw, vis.r) - Math.max(q[0], vis.l)) * Math.max(0, Math.min(q[1] + bh, vis.b) - Math.max(q[1], vis.t));
    if (vis.r > vis.l && vis.b > vis.t){ const s = spots.reduce((a, q) => over(q) < over(a) ? q : a); box.style.left = s[0] + 'px'; box.style.top = s[1] + 'px'; }
  }
  S.box = box;
  draw();
}
function draw(){
  if (!S || !S.box) return;
  const box = S.box, [rgb, hsv] = current(), [fx, fy, fz] = locate(S.mode, hsv, rgb);
  const f = box.querySelector('[data-cp=field]'), fc = f.getContext('2d'), img = fc.createImageData(FIELD, FIELD);
  for (let y = 0; y < FIELD; y++) for (let x = 0; x < FIELD; x++){
    const c = fieldColor(S.mode, fz, x / (FIELD - 1), y / (FIELD - 1)), i = (y * FIELD + x) * 4;
    img.data[i] = c[0] * 255; img.data[i + 1] = c[1] * 255; img.data[i + 2] = c[2] * 255; img.data[i + 3] = 255;
  }
  fc.putImageData(img, 0, 0);
  fc.lineWidth = 1.5; fc.strokeStyle = (hsv[2] > 0.6 && hsv[1] < 0.4) ? '#000' : '#fff';
  fc.beginPath(); fc.arc(fx * FIELD, fy * FIELD, 5, 0, Math.PI * 2); fc.stroke();
  const s = box.querySelector('[data-cp=strip]'), sc = s.getContext('2d');
  for (let y = 0; y < FIELD; y++){ const c = sliderColor(S.mode, 1 - y / (FIELD - 1), hsv, rgb); sc.fillStyle = hex(c); sc.fillRect(0, y, STRIP, 1); }
  box.querySelector('.strip .arr').style.top = ((1 - fz) * FIELD) + 'px';
  box.querySelector('[data-cp=new]').style.background = S.color;
  box.querySelector('[data-cp=cur]').style.background = S.orig;
  box.querySelector('[data-cp=web]').checked = !!S.webOnly;
  box.querySelectorAll('input[name=dl-cp-mode]').forEach(r => { r.checked = r.value === S.mode; });
  const lab = srgbToLab(rgb), cmyk = S.cmyk || rgbToCmyk(rgb);
  const vals = {h:hsv[0], s:hsv[1] * 100, v:hsv[2] * 100, r:rgb[0] * 255, g:rgb[1] * 255, bb:rgb[2] * 255, labL:lab[0], laba:lab[1], labb:lab[2],
                cmykC:cmyk[0] * 100, cmykM:cmyk[1] * 100, cmykY:cmyk[2] * 100, cmykK:cmyk[3] * 100};
  box.querySelectorAll('[data-cp=grid] input[data-k]').forEach(i => {
    if (document.activeElement === i) return;
    i.value = i.dataset.k === 'hex' ? S.color.slice(1) : Math.round(vals[i.dataset.k]);
  });
}

/* ── 添加到色板（PS：先问「色板名称」）── */
function askSwatchName(){
  if (!S || !S.box) return;
  const ov = S.box.querySelector('[data-cp=swname]');
  ov.innerHTML = `<div class="pane"><b>${T(L3('色票名稱', '色板名称', 'Color Swatch Name'))}</b>
    <label>${T(L3('名稱：', '名称：', 'Name:'))} <input type="text" data-cp="swn"></label>
    <div style="display:flex;gap:6px;justify-content:flex-end"><button class="pri" data-cp="swok">${T(L3('確定', '确定', 'OK'))}</button><button data-cp="swcancel">${T(L3('取消', '取消', 'Cancel'))}</button></div></div>`;
  ov.style.display = 'flex';
  const inp = ov.querySelector('[data-cp=swn]'), list = CMD.map['ps.swatches.list'] ? (CMD.run('ps.swatches.list', {}).swatches || []) : [];
  const base = T(L3('色票', '色板', 'Swatch')); let n = 1; while (list.some(x => x.name === base + ' ' + n)) n++;
  inp.value = base + ' ' + n; inp.focus(); inp.select();
  const done = ok => { ov.style.display = 'none'; ov.innerHTML = ''; if (ok) CMD.run('ui.colorPicker.addToSwatches', {name:inp.value}); };
  ov.querySelector('[data-cp=swok]').onclick = () => done(true);
  ov.querySelector('[data-cp=swcancel]').onclick = () => done(false);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); done(true); } else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); done(false); } });
}
/* ── 颜色库（PS：拾色器「颜色库」＝换成色票本的清单：色库下拉、清单、直接打编号跳过去；「拾色器」回去）── */
const labDist = (a, b) => { const x = srgbToLab(a), y = srgbToLab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
function showLibrary(on){
  if (!S || !S.box) return;
  S.view = on ? 'library' : 'picker';
  S.box.querySelector('.row').style.display = on ? 'none' : 'flex';
  S.box.querySelector('.hint').style.display = on ? 'none' : '';
  const lib = S.box.querySelector('[data-cp=lib]'); lib.style.display = on ? 'flex' : 'none';
  if (on) buildLibrary(); else draw();
}
function buildLibrary(){
  const lib = S.box.querySelector('[data-cp=lib]'), C = window.ColorLibs; if (!C) return;
  if (!S.book) S.book = C.names()[0];
  const L = C.list(S.book);
  if (S.libIndex === undefined || S.libIndex < 0 || S.libIndex >= L.length){
    const cur = parseHex(S.color) || [0, 0, 0]; let best = 0, bd = Infinity;
    L.forEach((e, i) => { const d = labDist(cur, parseHex(e.color)); if (d < bd){ bd = d; best = i; } });
    S.libIndex = best;
  }
  lib.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px">
      <label>${T(L3('色票本：', '色库：', 'Book:'))} <select data-cp="book">${C.names().map(n => `<option${n === S.book ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <div class="list" tabindex="0" data-cp="list"></div>
      <label>${T(L3('尋找編號：', '查找编号：', 'Find code:'))} <input type="text" data-cp="find" style="width:120px"></label>
      <div><button data-cp="loadAcb" title="${T(L3('讀入 Photoshop 的色彩庫檔（.acb；PS 安裝資料夾 Presets/Color Books）', '读入 Photoshop 的颜色库档（.acb；PS 安装夹 Presets/Color Books）', 'Load a Photoshop color book (.acb, from Presets/Color Books)'))}">${T(L3('載入色彩庫…', '载入颜色库…', 'Load Book…'))}</button><input type="file" accept=".acb" data-cp="acbFile" style="display:none"></div>
      <div class="lb">${T(L3('近似色值（非官方授權資料），印刷請以實體色票為準', '近似色值（非官方授权数据），印刷请以实体色卡为准', 'Approximate values (not licensed data); check a physical guide for print'))}</div></div>
    <div style="display:flex;flex-direction:column;gap:8px"><div class="lb">${T(L3('新的', '新的', 'new'))}</div><div class="sw"><div data-cp="new2"></div><div data-cp="cur2"></div></div><div class="lb">${T(L3('目前', '当前', 'current'))}</div></div>
    <div class="btns"><button class="pri" data-cp="ok2">${T(L3('確定', '确定', 'OK'))}</button><button data-cp="cancel2">${T(L3('取消', '取消', 'Cancel'))}</button><button data-cp="picker">${T(L3('檢色器', '拾色器', 'Picker'))}</button></div>`;
  const list = lib.querySelector('[data-cp=list]');
  L.forEach((e, i) => { const r = document.createElement('div'); r.className = 'it' + (i === S.libIndex ? ' on' : ''); r.dataset.code = e.code; r.dataset.i = i;
    r.innerHTML = `<i style="background:${e.color}"></i><span>${e.name}</span>`; r.onclick = () => CMD.run('ui.colorPicker.library', {index:i}); list.appendChild(r); });
  lib.querySelector('[data-cp=book]').onchange = e => CMD.run('ui.colorPicker.library', {book:e.target.value});
  lib.querySelector('[data-cp=find]').addEventListener('input', e => { if (e.target.value.trim()) CMD.run('ui.colorPicker.library', {code:e.target.value}); });
  // PS：清单有焦点时直接打数字＝跳到那个编号（连打的字一秒内接起来）
  list.addEventListener('keydown', e => {
    if (e.key.length === 1 && /[0-9a-z ]/i.test(e.key)){ const now = Date.now(); S.typed = (now - (S.typedAt || 0) < 1000 ? S.typed || '' : '') + e.key; S.typedAt = now; CMD.run('ui.colorPicker.library', {code:S.typed}); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ CMD.run('ui.colorPicker.library', {index:S.libIndex + (e.key === 'ArrowDown' ? 1 : -1)}); e.preventDefault(); e.stopPropagation(); }
  });
  const fi = lib.querySelector('[data-cp=acbFile]');
  lib.querySelector('[data-cp=loadAcb]').onclick = () => fi.click();
  fi.onchange = () => { const f = fi.files && fi.files[0]; if (!f) return; const u = URL.createObjectURL(f);
    Promise.resolve(CMD.run('ui.colorPicker.loadBook', {url:u})).then(r => { URL.revokeObjectURL(u); if (r && r.ok === false && window.Locks && Locks.notify) Locks.notify(r.error); }); };
  lib.querySelector('[data-cp=ok2]').onclick = () => CMD.run('ui.colorPicker.ok', {});
  lib.querySelector('[data-cp=cancel2]').onclick = () => CMD.run('ui.colorPicker.cancel', {});
  lib.querySelector('[data-cp=picker]').onclick = () => CMD.run('ui.colorPicker.picker', {});
  syncLibrary();
  list.focus();
}
function syncLibrary(){
  const lib = S.box.querySelector('[data-cp=lib]'); if (!lib) return;
  lib.querySelectorAll('.it').forEach(r => r.classList.toggle('on', +r.dataset.i === S.libIndex));
  const on = lib.querySelector('.it.on'); if (on && on.scrollIntoView) on.scrollIntoView({block:'nearest'});
  const n = lib.querySelector('[data-cp=new2]'), c = lib.querySelector('[data-cp=cur2]');
  if (n) n.style.background = S.color; if (c) c.style.background = S.orig;
}

/* ── PS 2020：拾色器开着时，图像上＝吸管（点、拖都取样；不交给目前的工具） ── */
function onCanvas(e){
  if (!S || !window.UI || !UI.canvas || e.target !== UI.canvas) return;
  if (e.type === 'pointermove' && !S.sampling){ UI.canvas.style.cursor = 'crosshair'; return; }
  if (e.button !== undefined && e.button !== 0 && e.type === 'pointerdown') return;
  e.stopImmediatePropagation(); e.preventDefault();
  if (e.type === 'pointerdown'){ S.sampling = true; try { UI.canvas.setPointerCapture(e.pointerId); } catch (_){} }
  if (e.type === 'pointerup' || e.type === 'pointercancel'){ S.sampling = false; if (e.type === 'pointercancel') return; }
  const p = window.CtxMenu && CtxMenu.docAt ? CtxMenu.docAt(e.clientX, e.clientY) : (() => { const b = UI.canvas.getBoundingClientRect(); return [(e.clientX - b.left) / UI.zoom, (e.clientY - b.top) / UI.zoom]; })();
  CMD.run('ui.colorPicker.set', {sample:p});
}
const EV = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'dblclick'];
function attach(){ EV.forEach(t => window.addEventListener(t, t === 'click' || t === 'dblclick' ? swallow : onCanvas, true)); }
function detach(){ EV.forEach(t => window.removeEventListener(t, t === 'click' || t === 'dblclick' ? swallow : onCanvas, true)); }
function swallow(e){ if (S && window.UI && e.target === UI.canvas){ e.stopImmediatePropagation(); e.preventDefault(); } }

function open(target, color, extra){
  if (S) close();
  const c = parseHex(color || (target === 'foreground' || target === 'background' ? curHex(target) : '#000000')) || [0, 0, 0];
  S = Object.assign({target, color:hex(c), orig:hex(c), hsv:rgbToHsv(c), mode:'h', webOnly:false, sampling:false}, extra || {});
  build(); attach();
  return {ok:true, open:true, target, color:S.color};
}
function close(){ detach(); if (S && S.box) S.box.remove(); const done = S && S.onClose; S = null; if (done){ try { done(); } catch (e){ console.error(e); } } if (window.UI && UI.canvas){ const t = window.Tools && Tools.get && Tools.get(ToolState.cur); UI.canvas.style.cursor = (t && t.cursor) || 'crosshair'; } }
const state = () => S ? {target:S.target, color:S.color, cmyk:S.cmyk ? S.cmyk.map(v => Math.round(v * 100)) : undefined, orig:S.orig, mode:S.mode, webOnly:S.webOnly, hsv:S.hsv.slice(), view:S.view || 'picker',
  book:S.view === 'library' ? S.book : undefined, entry:S.view === 'library' && window.ColorLibs ? ColorLibs.list(S.book)[S.libIndex] : undefined} : null;

/* 给别的对话框用：ColorPicker.open(任意 target, 起始色, {label, onChange(c) 即时预览, onOk(c) 按确定, onClose() 关掉（确定／取消都会叫、先于 onOk）}) */
CMD.reg('ui.colorPicker', {i18n:'', params:'{target:"foreground|background"="foreground", color?:"#rrggbb"（起始＝目前那个颜色）} 开拾色器（PS／photocraft color_picker_ui：色域＋分量滑杆、HSB/RGB/Lab/CMYK/#；开着时点图像＝吸管取色）；确定 ui.colorPicker.ok → {open, target, color}'},
  p => open(p.target === 'background' ? 'background' : 'foreground', p.color));
CMD.reg('ui.colorPicker.set', {i18n:'', params:'{color?:"#rrggbb" | h?,s?,b?（度、%、%）| r?,g?,b?（0..255，给了 r 或 g 才当 RGB）| L?,a?,b?（lab:true）| c?,m?,y?,k?（%）| sample?:[x,y] 文件坐标（吸管：取合成后那点）| mode?:"h|s|v|r|g|b" | webOnly?:bool} 拾色器开着时改「新的」颜色 → state'}, p => {
  if (!S) return {ok:false, error:'the Color Picker is not open'};
  if (typeof p.mode === 'string' && MODES.some(m => m[0] === p.mode)) S.mode = p.mode;
  if (typeof p.webOnly === 'boolean'){ S.webOnly = p.webOnly; setRgb(current()[0], null); }
  if (Array.isArray(p.sample)){
    const px = window.Eyedropper && Eyedropper.pixel ? Eyedropper.pixel(+p.sample[0], +p.sample[1]) : null;
    if (!px || !(px[3] > 0)) return Object.assign({ok:false, error:'nothing to sample there (transparent or outside)'}, state());
    setRgb([px[0] / 255, px[1] / 255, px[2] / 255], null);
  } else if (p.color !== undefined){ const c = parseHex(p.color); if (!c) return {ok:false, error:'color must be #rrggbb'}; setRgb(c, null); }
  else if (p.c !== undefined || p.m !== undefined || p.y !== undefined || p.k !== undefined){ const k = S.cmyk ? S.cmyk.slice() : rgbToCmyk(current()[0]); ['c', 'm', 'y', 'k'].forEach((n, i) => { if (isFinite(p[n])) k[i] = clamp(+p[n], 0, 100) / 100; }); setRgb(cmykToRgb(k), null); S.cmyk = k; draw(); }
  else if (p.lab || p.L !== undefined){ const l = srgbToLab(current()[0]); if (isFinite(p.L)) l[0] = +p.L; if (isFinite(p.a)) l[1] = +p.a; if (isFinite(p.b)) l[2] = +p.b; setRgb(labToSrgb(l), null); }
  else if (p.r !== undefined || p.g !== undefined){ const c = current()[0].slice(); if (isFinite(p.r)) c[0] = clamp(+p.r, 0, 255) / 255; if (isFinite(p.g)) c[1] = clamp(+p.g, 0, 255) / 255; if (isFinite(p.b)) c[2] = clamp(+p.b, 0, 255) / 255; setRgb(c, null); }
  else if (p.h !== undefined || p.s !== undefined || p.b !== undefined){ const h = current()[1].slice(); if (isFinite(p.h)) h[0] = clamp(+p.h, 0, 360); if (isFinite(p.s)) h[1] = clamp(+p.s, 0, 100) / 100; if (isFinite(p.b)) h[2] = clamp(+p.b, 0, 100) / 100; setRgb(hsvToRgb(h[0], h[1], h[2]), h); }
  return Object.assign({ok:true}, state());
});
/* 331 confirm：设前景色／背景色（换色不进历史，同 PS／photocraft） */
CMD.reg('ui.colorPicker.ok', {i18n:'', params:'{} 拾色器按确定：设前景色（或背景色）→ {target, color}'}, () => {
  if (!S) return {ok:false, error:'the Color Picker is not open'};
  const {target, color, command, params, onOk} = S; close();
  if (command) return CMD.run(command, Object.assign({}, params || {}, {color}));
  if (onOk){ try { onOk(color); } catch (e){ console.error(e); } return {ok:true, target, color}; }   // 对话框里的色块（图层样式等）：确定＝把色填回那一格，不改前景色
  CMD.run('eyedropper.setColors', {[target]:color});
  if (window.Toolbar && Toolbar.refreshColors) Toolbar.refreshColors();
  return {ok:true, target, color};
});
CMD.reg('ui.colorPicker.addToSwatches', {i18n:'', params:'{name?:str（缺省「色板 N」）} 拾色器「添加到色板」：把「新的」颜色加进色板面板（ps.swatches.add）→ {ok, index, name, color}'}, p => {
  if (!S) return {ok:false, error:'the Color Picker is not open'};
  if (!CMD.map['ps.swatches.add']) return {ok:false, error:'the Swatches panel (ps-window.js) is not loaded'};
  return CMD.run('ps.swatches.add', {color:S.color, name:p && p.name});
});
CMD.reg('ui.colorPicker.library', {i18n:'', params:'{book?:"PANTONE+ Solid Coated"（色库名）, code?:"286"｜"PANTONE 286 C"（打编号跳过去）, index?:清单第几个} 拾色器「颜色库」：换成色票本清单（没给编号＝选最接近目前颜色的那色），选到的就是「新的」颜色；ui.colorPicker.picker 回拾色器 → state（含 entry:{code,name,color}）'}, p => {
  if (!S) return {ok:false, error:'the Color Picker is not open'};
  if (!window.ColorLibs) return {ok:false, error:'tools/colorlibs.js is not loaded'};
  p = p || {};
  if (p.book !== undefined){ if (!ColorLibs.books[p.book]) return {ok:false, error:'unknown book; one of: ' + ColorLibs.names().join(', ')}; if (p.book !== S.book){ S.book = p.book; S.libIndex = undefined; } }
  if (S.view !== 'library'){ showLibrary(true); }
  else if (p.book !== undefined) buildLibrary();
  const L = ColorLibs.list(S.book);
  let i = null;
  if (p.code !== undefined){ i = ColorLibs.find(S.book, p.code); if (i < 0) return Object.assign({ok:false, error:`no "${p.code}" in ${S.book}`}, state()); }
  else if (p.index !== undefined){ i = clamp(Math.round(+p.index) || 0, 0, L.length - 1); }
  if (i !== null) S.libIndex = i;
  const e = L[S.libIndex]; if (e){ const c = parseHex(e.color); S.color = hex(c); S.hsv = rgbToHsv(c); }
  syncLibrary();
  return Object.assign({ok:true}, state());
});
CMD.reg('ui.colorPicker.loadBook', {i18n:'', params:'{url} 颜色库 ▸ 载入颜色库：读一本 Adobe Color Book（.acb；PS 安装夹 Presets/Color Books，TOYO／FOCOLTONE／ANPA…都是这种档）加进书单并切过去 → {book, count}'}, async p => {
  if (!window.ColorLibs) return {ok:false, error:'tools/colorlibs.js is not loaded'};
  if (!p || !p.url) return {ok:false, error:'pass `url` of an .acb file'};
  let name;
  try { const buf = await (await fetch(p.url)).arrayBuffer(); name = ColorLibs.addAcb(buf); }
  catch (e){ return {ok:false, error:String(e && e.message || e)}; }
  if (S){ S.libIndex = undefined; const r = CMD.run('ui.colorPicker.library', {book:name}); if (r && r.ok === false) return r; }
  return {ok:true, book:name, count:ColorLibs.list(name).length};
});
CMD.reg('ui.colorPicker.picker', {i18n:'', params:'{} 颜色库 ▸「拾色器」：回到拾色器（颜色留着）'}, () => { if (!S) return {ok:false, error:'the Color Picker is not open'}; showLibrary(false); return Object.assign({ok:true}, state()); });
CMD.reg('ui.colorPicker.cancel', {i18n:'', params:'{} 拾色器按取消：颜色不变'}, () => { if (!S) return {ok:false, error:'the Color Picker is not open'}; close(); return {ok:true}; });
CMD.reg('ui.colorPicker.state', {i18n:'', params:'{} 拾色器目前的状态（没开＝null）'}, () => ({ok:true, state:state()}));

/* 工具箱的前景／背景色块（panels.rs:265-270：点色块＝开拾色器）：PS 版面、首选项「拾色器」不是「系统」才换成我们的；AI 版面照旧 */
const useOurs = () => !(window.Toolbar && Toolbar.layout && Toolbar.layout.id === 'ai') &&
  !(window.PsEdit && PsEdit.prefs && PsEdit.prefs.get && PsEdit.prefs.get('general.colorPicker') === 'system');
function hook(box){
  if (!box || box._dlcp) return; box._dlcp = true;
  const fg = box.querySelector('.fg'), bg = box.querySelector('.bg');
  const wrap = (el, target, sw) => { if (!el) return; const old = el.onclick; el.onclick = e => {
    if (!useOurs()) return old && old.call(el, e);
    Toolbar.activeSwatch = sw; if (sw === 'fill') Toolbar.fillNone = false; Toolbar.refreshColors();
    CMD.run('ui.colorPicker', {target});
  }; };
  wrap(fg, 'foreground', 'fill'); wrap(bg, 'background', 'stroke');
}
if (window.Toolbar && Toolbar.colorsWidget && !Toolbar._dlcp){
  const cw = Toolbar.colorsWidget;
  Toolbar.colorsWidget = function(){ const b = cw.apply(this, arguments); hook(b); return b; };
  Toolbar._dlcp = true;
  document.querySelectorAll('.tbcolors').forEach(hook);
}

window.ColorPicker = {open, close, state, hsvToRgb, rgbToHsv, srgbToLab, labToSrgb, rgbToCmyk, cmykToRgb, fieldColor, locate};
})();
