/* 堤麟画板 · Illustrator ▸ 编辑（Edit）菜单实作 —— 照 ArtCraft VectorCraft 原码逐段翻成 JS
   原码（vectorcraft/crates/）：
     engine/src/cmd/edit.rs 154-327        剪切／拷贝／粘贴×5（selected_roots、copy、cut、clear、paste_clip：Offset／Front／Back／InPlace／AllArtboards）
     engine/src/cmd/clipboard.rs 62-160    内部剪贴簿 Clipboard（物件＋来源图层＋来源画板＋来源文件；SVG 给系统剪贴簿）
     engine/src/cmd/typemenu.rs 475-606    查找和替换 find_all／all_texts／find_replace／find_next、粘贴时不包含格式 strip_formatting／paste_plain
     ui-egui/src/lib.rs 414-445            粘贴（含不带格式）贴到视图中心；剪切／拷贝后写进系统剪贴簿
     ui-egui/src/menus.rs 2203-2213「…」又带参数的菜单项开参数对话框（查找和替换…、叠印黑色…）
     engine/src/cmd/colorcmds.rs 全档       编辑颜色：反相／转 CMYK／灰度／RGB、饱和度、调整色彩平衡、前后／水平／垂直混合（Recolor 颜色走访）
     engine/src/cmd/recolor.rs 全档         重新着色图稿：recolor.colors／reduce／apply／randomize
     color/src/recolor.rs 1-420            ColorKey、Neutral／Preserve、Method、tint_of／is_tint／shaded、RowMap、cluster（Lab k-means）、Palette、Rng
     color/src/lib.rs 58-307               Color：to_rgb／to_cmyk／to_hsb／from_hsb／invert_keep_model／in_model／tinted／keep_model
     color/src/cms/lab.rs 1-171            sRGB ↔ Lab（D50）、ΔE2000
     color/src/harmony.rs 1-231            协调规则 Harmony（重新着色的「编辑」页）、move_on_wheel
     color/src/libraries.rs 57-273         色板库（限定为库）：Web Safe 216、灰色与中性色、大地色、肤色、粉彩、亮色（OKLCH 产生）
     doc/src/blend.rs 35-43                lerp_color
     engine/src/cmd/overprint.rs 213-241、doc/src/overprint.rs 17-88   叠印黑色
     ui-egui/src/dialogs/recolor.rs、color_balance.rs、saturate.rs     三个对话框的栏位、预设、即时预览、确定＝一步历史
     engine/src/cmd/prefscmds.rs、lib.rs 500-640、ui-egui/src/prefs_dialog.rs    首选项（PREF_SPECS 表、预设值、prefs.get/set/reset/list、对话框）
     ui-egui/src/shortcut_editor.rs 1-460  键盘快捷键（覆写、冲突、预设、汇出入、对话框）
   原码没有（menus.rs:1532 todo）：拼写三项——照 Illustrator 行为做（字典＝系统 american-english 词表压缩内嵌，见档尾）。
   我们的资料模型对照：
     物件＝当前矢量层 L.data.shapes（图层坐标）；选取＝VecSel（一层）＋ AiSel.text（文字物件＝文字层 id，menus/impl/ai-select.js）。
     颜色＝CSS 字串（#rrggbb）；原码的颜色带「色彩模式」（RGB／CMYK／灰度／Lab）——我们在颜色旁边记一个标签：
       形状 s.fillModel／s.strokeModel、渐变色标 stop.model、网格点 q.model、文字层 data.colorModel ＝ {m:'cmyk'|'gray'|'lab', v:[分量], hex}
       （hex 跟现在的颜色对不上＝颜色被别的工具改过 ⇒ 当 RGB）。显示一律走 to_rgb（CMYK 用无描述档公式 (1−c)(1−k)）。
     叠印：s.overprintFill／s.overprintStroke、文字层 data.overprintFill（只存旗标；画板没有叠印预览）。
   命令一律 ai.<原码 id>（剪贴簿：ai.edit.cut／copy／paste…；编辑颜色：ai.edit.colors.*；重新着色：ai.recolor.*；对话框：ai.ui.*）。
   会改文件的命令都是「一步历史」：自己 History.push、没改到（count／changed 为 0、或失败）就把那步退掉（原码 edit_counted 同理）。 */
(function(){
'use strict';
if (window.AiEdit) return;
const AE = window.AiEdit = {raw:{}};

/* ═════════════ 小工具 ═════════════ */
const clone = o => JSON.parse(JSON.stringify(o));
const fin = v => typeof v === 'number' && isFinite(v);
const num = (v, d) => { if (v === undefined || v === null || v === '') return d; const n = +(typeof v === 'string' ? parseFloat(v) : v); return isFinite(n) ? n : d; };
const bool = (v, d) => v === undefined || v === null ? d : !!v;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const T = k => (window.Lang ? Lang.t(k) : k);
const fail = (C, m) => ({ok:false, error:`${C}: ${m}`});
const LS = {
  get(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
};
const redraw = () => { if (window.UI){ if (UI.refresh) UI.refresh(); if (UI.draw) UI.draw(); } };
const layerOpen = L => !!L && L.visible !== false && !L.locked && !(L.locks && L.locks.all);
const docF = L => (p => [p[0] + L.x, p[1] + L.y]);
const sShift = (s, dx, dy) => (window.shiftShape || shiftShape)(s, dx, dy);   // ai-object.js 可能包过一层（编组／复合路径）

/* 命令登记：会改文件的走「一步历史」——先推快照，失败或 {noop:true} 就退掉（还原 future，免得空步把重做清掉） */
function reg(id, meta, fn, step){
  AE.raw[id] = fn;
  CMD.reg(id, Object.assign({i18n:''}, meta, {undoable:false}, step ? {history:'one step'} : {}), p => {
    p = p || {};
    if (!step) return fn(p);
    const fut = History.future.slice();
    History.push();
    const back = () => { History.restoreInPlace(History.past.pop()); History.future = fut; };
    let r;
    try { r = fn(p); } catch (e){ back(); throw e; }
    if (r && typeof r.then === 'function'){ back(); return r; }  // 非同步（读系统剪贴簿）：那条路自己管历史，先把这步空的退掉
    if (!r || r.ok === false || r.noop){ back(); if (r) delete r.noop; }
    return r === undefined ? {ok:true} : r;
  });
}

/* ═════════════ 颜色（color/src/lib.rs、cms/lab.rs 照翻）═════════════
   Color ＝ {m:'rgb', v:[r,g,b]} | {m:'cmyk', v:[c,m,y,k]} | {m:'gray', v:[k]} | {m:'lab', v:[l,a,b]}（分量 0..1，Lab 照原样） */
const _cc = document.createElement('canvas').getContext('2d');
/* CSS 颜色字串 → [r,g,b,a]（0..1）；认不得／none 回 null */
function cssRGBA(str){
  if (typeof str !== 'string') return null;
  const s = str.trim(); if (!s || /^(none|transparent)$/i.test(s)) return null;
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  let v = s;
  if (!m){ _cc.fillStyle = '#010203'; _cc.fillStyle = s; v = _cc.fillStyle; if (v === '#010203' && s.toLowerCase() !== '#010203') return null; m = /^#([0-9a-f]{6})$/i.exec(v); }
  if (m){
    let h = m[1]; if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const b = i => parseInt(h.slice(i, i + 2), 16) / 255;
    return [b(0), b(2), b(4), h.length === 8 ? b(6) : 1];
  }
  const r = /rgba?\(([^)]+)\)/i.exec(v); if (!r) return null;
  const p = r[1].split(',').map(x => parseFloat(x));
  return [p[0] / 255, p[1] / 255, p[2] / 255, p.length > 3 ? p[3] : 1];
}
const q8 = v => Math.round(clamp(v, 0, 1) * 255);
const hex3 = rgb => '#' + rgb.slice(0, 3).map(v => q8(v).toString(16).padStart(2, '0')).join('');
/* cms/lab.rs：sRGB（D50 Bradford）↔ XYZ ↔ Lab */
const D50 = [0.96422, 1.0, 0.82521], EPS = 216 / 24389, KAP = 24389 / 27;
const S2X = [[0.4360747, 0.3850649, 0.1430804], [0.2225045, 0.7168786, 0.0606169], [0.0139322, 0.0971045, 0.7141733]];
const X2S = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const mul3 = (M, v) => [0, 1, 2].map(i => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]);
const s2l = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const l2s = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
function srgbToLab(rgb){
  const x = mul3(S2X, rgb.map(s2l)), f = t => t > EPS ? Math.cbrt(t) : (KAP * t + 16) / 116;
  const fx = f(x[0] / D50[0]), fy = f(x[1] / D50[1]), fz = f(x[2] / D50[2]);
  return {l:116 * fy - 16, a:500 * (fx - fy), b:200 * (fy - fz)};
}
function labToSrgb(lab){
  const fy = (lab.l + 16) / 116, fx = fy + lab.a / 500, fz = fy - lab.b / 200;
  const inv = f => { const f3 = f * f * f; return f3 > EPS ? f3 : (116 * f - 16) / KAP; };
  const y = lab.l > KAP * EPS ? fy * fy * fy : lab.l / KAP;
  return mul3(X2S, [inv(fx) * D50[0], y * D50[1], inv(fz) * D50[2]]).map(v => { const e = l2s(clamp(v, 0, 1)); return e > 0.99999 ? 1 : e < 1e-6 ? 0 : e; });
}
/* lab.rs:124 ΔE2000 */
function deltaE2000(x, y){
  const c1 = Math.hypot(x.a, x.b), c2 = Math.hypot(y.a, y.b), cm = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(Math.pow(cm, 7) / (Math.pow(cm, 7) + Math.pow(25, 7))));
  const a1p = x.a * (1 + g), a2p = y.a * (1 + g), c1p = Math.hypot(a1p, x.b), c2p = Math.hypot(a2p, y.b);
  const deg = r => r * 180 / Math.PI, rad = d => d * Math.PI / 180, mod = v => ((v % 360) + 360) % 360;
  const hp = (b, a) => (b === 0 && a === 0) ? 0 : mod(deg(Math.atan2(b, a)));
  const h1p = hp(x.b, a1p), h2p = hp(y.b, a2p), dlp = y.l - x.l, dcp = c2p - c1p;
  const dhp = c1p * c2p === 0 ? 0 : Math.abs(h2p - h1p) <= 180 ? h2p - h1p : h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p + 360;
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dhp) / 2);
  const lpm = (x.l + y.l) / 2, cpm = (c1p + c2p) / 2;
  const hpm = c1p * c2p === 0 ? h1p + h2p : Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2 : h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const t = 1 - 0.17 * Math.cos(rad(hpm - 30)) + 0.24 * Math.cos(rad(2 * hpm)) + 0.32 * Math.cos(rad(3 * hpm + 6)) - 0.20 * Math.cos(rad(4 * hpm - 63));
  const dth = 30 * Math.exp(-Math.pow((hpm - 275) / 25, 2)), rc = 2 * Math.sqrt(Math.pow(cpm, 7) / (Math.pow(cpm, 7) + Math.pow(25, 7)));
  const sl = 1 + 0.015 * Math.pow(lpm - 50, 2) / Math.sqrt(20 + Math.pow(lpm - 50, 2)), sc = 1 + 0.045 * cpm, sh = 1 + 0.015 * cpm * t;
  const rt = -Math.sin(rad(2 * dth)) * rc;
  const v = Math.pow(dlp / sl, 2) + Math.pow(dcp / sc, 2) + Math.pow(dH / sh, 2) + rt * (dcp / sc) * (dH / sh);
  return Math.sqrt(Math.max(v, 0));
}
const Col = {
  rgb:(r, g, b) => ({m:'rgb', v:[r, g, b]}), cmyk:(c, m, y, k) => ({m:'cmyk', v:[c, m, y, k]}), gray:k => ({m:'gray', v:[k]}), lab:(l, a, b) => ({m:'lab', v:[l, a, b]}),
  BLACK:{m:'rgb', v:[0, 0, 0]},
  /* lib.rs:81 to_rgb（CMYK 走无描述档公式，lib.rs:96） */
  toRgb(c){
    const v = c.v;
    if (c.m === 'cmyk') return [(1 - v[0]) * (1 - v[3]), (1 - v[1]) * (1 - v[3]), (1 - v[2]) * (1 - v[3])];
    if (c.m === 'gray') return [1 - v[0], 1 - v[0], 1 - v[0]];
    if (c.m === 'lab') return labToSrgb({l:v[0], a:v[1], b:v[2]});
    return v.slice(0, 3);
  },
  /* lib.rs:121 to_cmyk */
  toCmyk(c){
    if (c.m === 'cmyk') return c.v.slice();
    const [r, g, b] = this.toRgb(c), k = 1 - Math.max(r, g, b);
    if (k >= 1) return [0, 0, 0, 1];
    return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
  },
  toLab(c){ if (c.m === 'lab') return {l:c.v[0], a:c.v[1], b:c.v[2]}; return srgbToLab(this.toRgb(c)); },
  /* lib.rs:135 to_hsb：色相 0..360、饱和度与亮度 0..1 */
  toHsb(c){
    const [r, g, b] = this.toRgb(c), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const h = d <= 0 ? 0 : max === r ? 60 * ((((g - b) / d) % 6) + 6) % 360 : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    return [h, max <= 0 ? 0 : d / max, max];
  },
  /* lib.rs:152 from_hsb */
  fromHsb(h, s, v){
    h = (((h % 360) + 360) % 360) / 60;
    const c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c, i = Math.floor(h);
    const [r, g, b] = i === 0 ? [c, x, 0] : i === 1 ? [x, c, 0] : i === 2 ? [0, c, x] : i === 3 ? [0, x, c] : i === 4 ? [x, 0, c] : [c, 0, x];
    return Col.rgb(r + m, g + m, b + m);
  },
  /* lib.rs:252 in_model（Edit Colors 用的无描述档公式） */
  inModel(c, m){
    if (c.m === m) return c;
    if (m === 'rgb') return Col.rgb(...this.toRgb(c));
    if (m === 'cmyk') return Col.cmyk(...this.toCmyk(c));
    if (m === 'gray'){ const [r, g, b] = this.toRgb(c); return Col.gray(clamp(1 - (0.299 * r + 0.587 * g + 0.114 * b), 0, 1)); }
    const L = this.toLab(c); return Col.lab(L.l, L.a, L.b);
  },
  keep(orig, nw){ return this.inModel(nw, orig.m); },          // lib.rs:305 keep_model
  /* lib.rs:202 invert_keep_model */
  invert(c){
    const inv = () => { const [r, g, b] = this.toRgb(c); return Col.rgb(1 - r, 1 - g, 1 - b); };
    if (c.m === 'rgb') return inv();
    if (c.m === 'cmyk') return Col.cmyk(...this.toCmyk(inv()));
    if (c.m === 'gray') return Col.gray(1 - c.v[0]);
    return this.inModel(inv(), 'lab');
  },
  /* blend.rs:35 lerp_color：同模式（CMYK／灰度／Lab）逐分量，否则显示 RGB */
  lerp(a, b, t){
    const l = (x, y) => x + (y - x) * t;
    if (a.m === b.m && a.m !== 'rgb') return {m:a.m, v:a.v.map((x, i) => l(x, b.v[i]))};
    const p = this.toRgb(a), q = this.toRgb(b);
    return Col.rgb(l(p[0], q[0]), l(p[1], q[1]), l(p[2], q[2]));
  },
  /* lib.rs:278 tinted */
  tinted(c, t){
    t = clamp(t, 0, 1); if (t === 1) return c;
    const v = c.v;
    if (c.m === 'cmyk') return Col.cmyk(v[0] * t, v[1] * t, v[2] * t, v[3] * t);
    if (c.m === 'gray') return Col.gray(v[0] * t);
    if (c.m === 'lab') return Col.lab(100 - (100 - v[0]) * t, v[1] * t, v[2] * t);
    const w = x => x + (1 - x) * (1 - t); return Col.rgb(w(v[0]), w(v[1]), w(v[2]));
  },
  hex(c){ return hex3(this.toRgb(c)); },
  eq(a, b){ return !!a && !!b && a.m === b.m && a.v.length === b.v.length && a.v.every((x, i) => Math.abs(x - b.v[i]) < 1e-6); },
  /* engine cmd/mod.rs:305 color_value：hex／颜色键／[r,g,b]／{c,m,y,k}／{gray}／{l,a,b}／{m,v} */
  value(v){
    if (typeof v === 'string'){
      const k = Key.parse(v); if (k) return k;
      const c = cssRGBA(v); return c ? Col.rgb(c[0], c[1], c[2]) : null;
    }
    if (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(x => fin(+x))) return Col.rgb(+v[0], +v[1], +v[2]);
    if (v && typeof v === 'object'){
      const f = x => { x = +x; return x > 1 ? x / 100 : x; };
      if (['c', 'm', 'y', 'k'].every(k => v[k] !== undefined)) return Col.cmyk(f(v.c), f(v.m), f(v.y), f(v.k));
      if (v.gray !== undefined) return Col.gray(f(v.gray));
      if (['l', 'a', 'b'].every(k => v[k] !== undefined)) return Col.lab(+v.l, +v.a, +v.b);
      if (typeof v.m === 'string' && Array.isArray(v.v)) return {m:v.m, v:v.v.map(Number)};
    }
    return null;
  }
};
/* color/src/recolor.rs:14-83 ColorKey：模式＋精确分量（RGB 到 1/100 级、墨水到 1/100 %、Lab 到 1/100），写成「rgb 255 0 0」「cmyk 0 100 100 0」「gray 40」「lab 55 60 -40」 */
const Key = {
  ints(c){
    const rgb = x => Math.round(clamp(x, 0, 1) * 25500), ink = x => Math.round(clamp(x, 0, 1) * 10000), lab = x => Math.round(x * 100);
    if (c.m === 'cmyk') return [1, c.v.map(ink)];
    if (c.m === 'gray') return [2, [ink(c.v[0]), 0, 0, 0]];
    if (c.m === 'lab') return [3, [lab(clamp(c.v[0], 0, 100)), lab(c.v[1]), lab(c.v[2]), 0]];
    return [0, c.v.map(rgb).concat([0])];
  },
  str(c){
    const [m, v] = this.ints(c);
    const n = q => (((q < 0 ? '-' : '') + Math.floor(Math.abs(q) / 100) + '.' + String(Math.abs(q) % 100).padStart(2, '0')).replace(/0+$/, '').replace(/\.$/, ''));
    const s = v.map(n);
    return m === 1 ? `cmyk ${s[0]} ${s[1]} ${s[2]} ${s[3]}` : m === 2 ? `gray ${s[0]}` : m === 3 ? `lab ${s[0]} ${s[1]} ${s[2]}` : `rgb ${s[0]} ${s[1]} ${s[2]}`;
  },
  /* 键 → Color（量化后的）；认不得回 null */
  parse(s){
    if (typeof s !== 'string') return null;
    const t = s.trim().split(/\s+/); const m = (t.shift() || '').toLowerCase();
    const n = t.map(Number); if (!n.length || n.some(x => !isFinite(x))) return null;
    let c = null;
    if (m === 'rgb' && n.length === 3) c = Col.rgb(n[0] / 255, n[1] / 255, n[2] / 255);
    else if (m === 'cmyk' && n.length === 4) c = Col.cmyk(n[0] / 100, n[1] / 100, n[2] / 100, n[3] / 100);
    else if (m === 'gray' && n.length === 1) c = Col.gray(n[0] / 100);
    else if (m === 'lab' && n.length === 3) c = Col.lab(n[0], n[1], n[2]);
    if (!c) return null;
    return this.color(this.str(c));
  },
  /* 键字串 → 它代表的颜色（ColorKey::color） */
  color(k){
    const t = k.split(' '), m = t[0], n = t.slice(1).map(Number);
    if (m === 'cmyk') return Col.cmyk(n[0] / 100, n[1] / 100, n[2] / 100, n[3] / 100);
    if (m === 'gray') return Col.gray(n[0] / 100);
    if (m === 'lab') return Col.lab(n[0], n[1], n[2]);
    return Col.rgb(n[0] / 255, n[1] / 255, n[2] / 255);
  },
  cmp(a, b){ const [ma, va] = this.ints(a), [mb, vb] = this.ints(b); if (ma !== mb) return ma - mb; for (let i = 0; i < 4; i++) if (va[i] !== vb[i]) return va[i] - vb[i]; return 0; }
};
AE.Col = Col; AE.Key = Key; AE.cssRGBA = cssRGBA; AE.deltaE2000 = deltaE2000;

/* ═════════════ 颜色格（原码 doc/src/recolor.rs 的 ColorVisitor：填色、描边、渐变色标、网格点、文字）═════════════ */
/* 一个颜色字串＋它的模式标签 → Color（a＝透明度）；标签的 hex 跟现在颜色对不上 ⇒ 被别的工具改过 ⇒ 当 RGB */
function readColor(str, tag){
  const rgba = cssRGBA(str); if (!rgba) return null;
  let c = Col.rgb(rgba[0], rgba[1], rgba[2]);
  if (tag && tag.m && Array.isArray(tag.v) && tag.hex === hex3(rgba)) c = {m:tag.m, v:tag.v.slice()};
  c.a = rgba[3];
  return c;
}
function writeColor(c, a){
  const rgb = Col.toRgb(c), h = hex3(rgb);
  const str = (a !== undefined && a < 1) ? `rgba(${q8(rgb[0])}, ${q8(rgb[1])}, ${q8(rgb[2])}, ${+a.toFixed(4)})` : h;
  return {str, tag:c.m === 'rgb' ? null : {m:c.m, v:c.v.map(x => +x.toFixed(6)), hex:h}};
}
/* 走一个形状的颜色格：cb({obj, key, tagKey, unit, part})；unit＝计数单位（一个 paint、一个网格各算一次） */
function eachSlot(s, reach, cb){
  if (!s) return;
  if (s.type === 'group'){ (s.children || []).forEach(c => eachSlot(c, reach, cb)); return; }
  if (s.type === 'mesh'){
    if (reach.fill && s.mesh && Array.isArray(s.mesh.points)){ const u = {s, part:'mesh'}; s.mesh.points.forEach(q => cb({obj:q, key:'color', tagKey:'model', unit:u, part:'mesh'})); }
    return;
  }
  for (const which of ['fill', 'stroke']){
    if (!reach[which]) continue;
    const p = s[which];
    if (p && typeof p === 'object' && Array.isArray(p.stops)){
      const u = {s, part:which};
      p.stops.forEach(st => { if (Array.isArray(st)) cb({obj:st, key:1, tagKey:null, unit:u, part:which}); else if (st && typeof st === 'object') cb({obj:st, key:'color', tagKey:'model', unit:u, part:which}); });
    } else if (typeof p === 'string' && cssRGBA(p)) cb({obj:s, key:which, tagKey:which + 'Model', unit:{s, part:which}, part:which});
  }
}
function textSlot(L, cb, reach){ if (!reach || reach.fill) cb({obj:L.data, key:'color', tagKey:'colorModel', unit:{L, part:'text'}, part:'fill'}); }
/* 把 f 套到一串颜色格；回改到的单位数（Recolor::run 的 changed） */
function mapSlots(slots, f){
  const changed = new Set();
  for (const sl of slots){
    const c = readColor(sl.obj[sl.key], sl.tagKey ? sl.obj[sl.tagKey] : null); if (!c) continue;
    const n = f(c); if (!n) continue;
    const w = writeColor(n, c.a), old = writeColor(c, c.a);
    if (w.str === old.str && JSON.stringify(w.tag) === JSON.stringify(old.tag)) continue;
    sl.obj[sl.key] = w.str;
    if (sl.tagKey){ if (w.tag) sl.obj[sl.tagKey] = w.tag; else delete sl.obj[sl.tagKey]; }
    changed.add(sl.unit);
  }
  return changed.size;
}
AE.readColor = readColor;

/* ═════════════ 目标（edit.rs:155 selected_roots：选中的物件，按绘制顺序；文字物件＝AiSel.text）═════════════ */
function vLayer(p){
  if (p && p.layerId){ const L = Doc.byId(p.layerId); return (L && L.kind === 'vector') ? L : null; }
  const V = VecSel.layer(); if (V && V.kind === 'vector' && VecSel.shapes.length) return V;
  const A = Doc.active(); return (A && A.kind === 'vector') ? A : null;
}
function targets(p){
  VecSel.prune();
  const L = vLayer(p);
  const ids = Array.isArray(p.ids) ? p.ids : null;
  let shapes = [];
  if (L){
    const want = ids || (VecSel.layerId === L.id ? VecSel.shapes : []);
    shapes = L.data.shapes.filter(s => want.includes(s.id) && !s.locked && s.visible !== false);
  }
  const tids = ids || ((window.AiSel && AiSel.text) || []);
  const texts = Doc.layers.filter(T => T.kind === 'text' && tids.includes(T.id) && layerOpen(T));
  return {L, shapes, texts, empty:!shapes.length && !texts.length};
}
/* 外框（文件坐标）：形状走 ai-object 的 shapeBounds（visual＝含描边），文字走 ai-select 的 textBounds */
function shapeBox(L, s, visual){
  if (window.AIObj && AIObj.shapeBounds) return AIObj.shapeBounds(s, L ? docF(L) : (p => p), visual);
  if (window.AiSel && AiSel.shapeBounds) return AiSel.shapeBounds(L || {x:0, y:0}, s);
  return null;
}
function textBox(Tl){ return (window.AiSel && AiSel.textBounds) ? AiSel.textBounds(Tl) : {x0:Tl.data.x + Tl.x, y0:Tl.data.y + Tl.y - Tl.data.size, x1:Tl.data.x + Tl.x + Tl.data.size * String(Tl.data.text).length * 0.6, y1:Tl.data.y + Tl.y}; }
const union = (a, b) => !a ? b : !b ? a : {x0:Math.min(a.x0, b.x0), y0:Math.min(a.y0, b.y0), x1:Math.max(a.x1, b.x1), y1:Math.max(a.y1, b.y1)};
/* 选取后叫的：文字物件选取换掉、形状选取换掉 */
function setSelection(L, ids, textIds){
  if (L && ids && ids.length) VecSel.setShapes(L.id, ids); else VecSel.clear();
  if (window.AiSel) AiSel.text = (textIds || []).slice();
}

/* ═════════════ 剪贴簿：剪切／拷贝／粘贴×6（edit.rs:182-327；共用剪贴簿 menus/impl/clipboard.js 的 DlClipboard）═════════════ */
const CLIP = () => window.DlClipboard;
/* ui-egui lib.rs:425「粘贴贴到视图中心」：画布可见区域的中心（文件坐标） */
function viewCenter(){
  try {
    const w = UI.wrap.getBoundingClientRect(), c = UI.canvas.getBoundingClientRect();
    if (c.width > 0 && w.width > 0){
      const vx0 = Math.max(w.left, c.left), vx1 = Math.min(w.right, c.right), vy0 = Math.max(w.top, c.top), vy1 = Math.min(w.bottom, c.bottom);
      const cx = (vx1 > vx0 ? (vx0 + vx1) / 2 : w.left + w.width / 2), cy = (vy1 > vy0 ? (vy0 + vy1) / 2 : w.top + w.height / 2);
      return [(cx - c.left) / UI.zoom, (cy - c.top) / UI.zoom];
    }
  } catch(e){}
  return [Doc.width / 2, Doc.height / 2];
}
AE.viewCenter = viewCenter;

/* edit.rs:182 copy：选中的物件（文件坐标深拷贝）＋文字物件＋来源图层／画板／文件 */
function copyImpl(p, C){
  if (!CLIP()) return fail(C, 'menus/impl/clipboard.js is not loaded');
  const t = targets(p); if (t.empty) return fail(C, 'nothing selected');
  const shapes = t.shapes.map(s => sShift(clone(s), t.L.x, t.L.y));
  const texts = t.texts.map(L => CLIP()._layerSnap(L));
  let b = null;
  shapes.forEach(s => { b = union(b, shapeBox(null, s, true)); });
  t.texts.forEach(L => { b = union(b, textBox(L)); });
  CLIP().setShapes({shapes, texts, bounds:b, sourceLayer:t.L ? {id:t.L.id, name:t.L.name} : null, sourceArtboard:[0, 0, Doc.width, Doc.height], docSerial:Doc.serial, from:'ai'});
  return {ok:true, copied:shapes.length + texts.length};
}
/* edit.rs:193 clear：直接选到锚点 ⇒ 删锚点（direct.clear 已照 edit.clear 做）；否则删整个物件；文字物件＝删那个文字层 */
function clearImpl(t, p){
  if (t.shapes.length || (window.VecSel && Object.keys(VecSel.anchors).length)){
    if (p && Array.isArray(p.ids)){ const ids = t.shapes.map(s => s.id); t.L.data.shapes = t.L.data.shapes.filter(s => !ids.includes(s.id)); Layer.invalidate(t.L); VecSel.prune(); }   // 给了 ids：删那几个（不看锚点选取）
    else if (CMD.map['direct.clear']) CMD.map['direct.clear'].run({});
    else if (t.L){ const ids = t.shapes.map(s => s.id); t.L.data.shapes = t.L.data.shapes.filter(s => !ids.includes(s.id)); Layer.invalidate(t.L); VecSel.clear(); }
  }
  const keep = Doc.activeId;
  t.texts.forEach(L => Doc.remove(L.id));
  if (Doc.byId(keep)) Doc.activeId = keep;
  if (window.AiSel) AiSel.text = [];
}
reg('ai.edit.copy', {params:'{ids?:[形状 id 或文字层 id]} 拷贝（Ctrl+C）：选中的物件（缺省＝VecSel 那层选中的、没锁没藏的）与文字物件（AiSel.text）进共用剪贴簿 DlClipboard（文件坐标，连来源图层／画板／文件），顺手写系统剪贴簿（PNG＋SVG 码） → {copied}'},
  p => copyImpl(p, 'ai.edit.copy'));
reg('ai.edit.cut', {params:'{} 剪切（Ctrl+X）：拷贝再清除（edit.rs:188：直接选到锚点就只删那些锚点，原码同）；一步历史 → {copied}'}, p => {
  const C = 'ai.edit.cut', t = targets(p);
  const r = copyImpl(p, C); if (r.ok === false) return r;
  clearImpl(t, p);
  return r;
}, true);
reg('ai.edit.clear', {params:'{ids?} 清除（Delete）：照 edit.rs:193（direct.clear）＋删选中的文字物件；一步历史'}, p => {
  const t = targets(p); if (t.empty && !(window.VecSel && Object.keys(VecSel.anchors).length)) return fail('ai.edit.clear', 'nothing selected');
  clearImpl(t, p); return {ok:true};
}, true);

/* 贴进来的形状换新 id（d.reid，整棵子树） */
function reid(s){ const c = clone(s); const go = n => { n.id = uid('S'); if (Array.isArray(n.children)) n.children.forEach(go); }; go(c); return c; }
/* typemenu.rs:578 strip_formatting：文字回预设字元样式（CharStyle::default：Regular 12、黑）、段落回预设 */
function stripText(snap){
  const d = snap.data;
  Object.assign(d, {font:'sans-serif', weight:'normal', size:12, color:'#000000', align:'left'});
  ['colorModel', 'overprintFill', 'overprintStroke', 'fontStyle'].forEach(k => delete d[k]);
  delete snap.style; delete snap.fillOpacity;
  return snap;
}
/* 贴进哪一层（insertion_parent）：VecSel 那层／当前矢量层；都不是就在当前层上面开一个矢量层 */
function pasteLayer(){
  let L = vLayer({});
  if (!L){ L = Layer.vector(T('layer.vector') + ' ' + (Doc.layers.length + 1)); const i = Doc.activeId ? Doc.index(Doc.activeId) + 1 : undefined; Doc.add(L, i); }
  return L;
}
const MODES = {offset:'Paste', front:'Paste in Front', back:'Paste in Back', inPlace:'Paste in Place', allArtboards:'Paste on All Artboards'};
/* edit.rs:245 paste_clip */
function pasteClip(p, mode, C, plain){
  const clip = CLIP() && CLIP().get();
  if (!clip) return fail(C, 'the clipboard is empty');
  if (clip.kind === 'pixels' || (clip.kind === 'layer' && clip.layer.kind === 'raster')) return pastePixels(p, mode, C);
  // 整层（PS 那边拷的矢量／文字层）当成物件
  let shapes = clip.shapes || [], texts = clip.texts || [], bounds = clip.bounds;
  if (clip.kind === 'layer'){
    if (clip.layer.kind === 'vector'){ shapes = clip.layer.data.shapes.map(s => sShift(clone(s), clip.layer.x, clip.layer.y)); texts = []; }
    else { shapes = []; texts = [clip.layer]; }
    bounds = null; shapes.forEach(s => { bounds = union(bounds, shapeBox(null, s, true)); });
    texts.forEach(Tl => { bounds = union(bounds, textBox(Object.assign({x:Tl.x || 0, y:Tl.y || 0}, Tl))); });
  }
  if (!shapes.length && !texts.length) return fail(C, 'the clipboard is empty');
  // 放法（edit.rs:262-272）：Paste＝给了 center 就把剪贴簿外框中心搬过去，否则位移 dx/dy（缺省＝首选项「粘贴位移」）；
  // 我们的 CMD 同时是 app 入口（lib.rs:426）：center／dx／dy 都没给 ⇒ 贴到视图中心
  let dx = 0, dy = 0;
  if (mode === 'offset'){
    let c = Array.isArray(p.center) && p.center.length >= 2 ? [+p.center[0], +p.center[1]] : null;
    if (!c && p.dx === undefined && p.dy === undefined) c = viewCenter();
    if (c && bounds){ dx = c[0] - (bounds.x0 + bounds.x1) / 2; dy = c[1] - (bounds.y0 + bounds.y1) / 2; }
    else if (!c){ const off = Prefs.get('pasteOffset'); dx = num(p.dx, off); dy = num(p.dy, off); }
  } else if (mode === 'allArtboards'){
    const src = clip.sourceArtboard || [0, 0];                       // 只有一个画板（整张文件）⇒ 位移＝0（原码按每个画板各贴一份）
    dx = 0 - src[0]; dy = 0 - src[1];
  }
  const L = pasteLayer();
  if (!layerOpen(L)) return fail(C, 'the layer is locked or hidden');
  // 前／后：贴在最上面／最下面那个选中物件的上／下；没选取＝这层的最上面／最下面（edit.rs:254-261、290-300）
  const order = (VecSel.layerId === L.id ? L.data.shapes.filter(s => VecSel.shapes.includes(s.id)) : []).map(s => L.data.shapes.indexOf(s));
  let at = null;
  if (mode === 'front') at = order.length ? Math.max(...order) + 1 : L.data.shapes.length;
  else if (mode === 'back') at = order.length ? Math.min(...order) : 0;
  const ids = [];
  shapes.forEach((s0, k) => {
    const s = reid(s0);
    sShift(s, dx - L.x, dy - L.y);                                     // 文件坐标 → 这层的图层坐标
    if (at === null) L.data.shapes.push(s); else L.data.shapes.splice(at + k, 0, s);
    ids.push(s.id);
  });
  Layer.invalidate(L);
  // 文字物件（我们的文字是层）：贴在目标层上面（贴在后面＝下面）
  const textIds = [], keep = L.id;
  texts.forEach((t0, k) => {
    const snap = clone(Object.assign({}, t0, {px:undefined}));
    if (plain) stripText(snap);
    const N = Layer.text(snap.name, snap.data);
    ['visible', 'opacity', 'blend', 'style', 'fillOpacity'].forEach(key => { if (snap[key] !== undefined) N[key] = snap[key]; });
    N.x = (snap.x || 0) + dx; N.y = (snap.y || 0) + dy;
    const i = Doc.index(keep);                                         // 每贴一个都重算：贴在后面＝插在目标层正下方（目标层被推上去，次序照旧）
    Doc.add(N, mode === 'back' ? i : i + 1 + k);
    textIds.push(N.id);
  });
  Doc.activeId = keep;
  setSelection(L, ids, textIds);
  return {ok:true, ids, texts:textIds, layerId:L.id, offset:[dx, dy], added:[], merged:[], renamed:[]};
}
/* 剪贴簿是像素（PS 拷的、或系统的图）：贴成新像素层（AI 贴位图＝嵌入图像；我们的像素是层） */
function pastePixels(p, mode, C){
  const pix = CLIP().asPixels(); if (!pix) return fail(C, 'the clipboard is empty');
  const b = pix.bounds, w = b[2] - b[0], h = b[3] - b[1];
  let dx = 0, dy = 0;
  if (mode === 'offset'){
    let c = Array.isArray(p.center) ? [+p.center[0], +p.center[1]] : null;
    if (!c && p.dx === undefined && p.dy === undefined) c = viewCenter();
    if (c){ dx = Math.round(c[0] - (b[0] + b[2]) / 2); dy = Math.round(c[1] - (b[1] + b[3]) / 2); }
    else { const off = Prefs.get('pasteOffset'); dx = Math.round(num(p.dx, off)); dy = Math.round(num(p.dy, off)); }
  }
  const N = Layer.raster(T('layer.untitled') + ' ' + (Doc.layers.length + 1), w, h);
  N.data.ctx.putImageData(new ImageData(new Uint8ClampedArray(pix.px), w, h), 0, 0);
  N.x = b[0] + dx; N.y = b[1] + dy;
  const A = Doc.activeId ? Doc.index(Doc.activeId) : Doc.layers.length - 1;
  Doc.add(N, mode === 'back' ? Math.max(0, A) : A + 1);
  setSelection(null, [], []);
  return {ok:true, layer:N.id, offset:[dx, dy]};
}
/* 系统剪贴簿（内部是空的、或系统那边比较新）：图 ⇒ 新像素层；文字 ⇒ 新的点文字（Illustrator 贴纯文字＝点文字） */
function pasteSystem(sys, mode, C){
  if (sys && sys.image){
    const opt = mode === 'offset' ? {center:viewCenter()} : {};
    return CLIP().pasteImage(sys.image, opt).then(r => { redraw(); return Object.assign({ok:true, source:'system'}, r); });
  }
  if (sys && sys.text && sys.text.trim()){
    const c = viewCenter();
    const fut = History.future.slice(); History.push();
    try {
      const L = Layer.text(sys.text.split('\n')[0].slice(0, 40), {x:c[0], y:c[1], text:sys.text, size:12, color:'#000000', font:'sans-serif', align:'left', weight:'normal'});
      const keep = Doc.activeId, i = keep ? Doc.index(keep) : Doc.layers.length - 1;
      Doc.add(L, i + 1); if (keep && Doc.byId(keep) && Doc.byId(keep).kind === 'vector') Doc.activeId = keep;
      setSelection(null, [], [L.id]);
      redraw();
      return Promise.resolve({ok:true, source:'system', texts:[L.id]});
    } catch(e){ History.restoreInPlace(History.past.pop()); History.future = fut; throw e; }
  }
  return Promise.resolve(fail(C, 'the clipboard is empty'));
}
function regPaste(id, mode, label, plain){
  reg(id, {params:`{${mode === 'offset' ? 'center?:[x,y] 文件坐标（把剪贴簿外框中心搬过去）, dx?, dy?（只给位移＝从原位挪这么多；三个都不给＝贴到视图中心）, ' : ''}system?:bool（true＝直接读系统剪贴簿）} ${label}；一步历史。` +
    `内部剪贴簿是空的 ⇒ 读系统剪贴簿（图贴成新像素层、文字贴成新的点文字；非同步，回 Promise）→ {ids, texts, layerId, offset}`}, p => {
    const C = id;
    const internal = CLIP() && !CLIP().isEmpty() && !p.system;
    if (!internal){
      if (!CLIP()) return fail(C, 'menus/impl/clipboard.js is not loaded');
      return CLIP().readSystem().then(sys => pasteSystem(sys, mode, C));
    }
    const plainNow = plain || (Prefs.get('pasteTextFormatting') === 'plain');       // 首选项「粘贴文字时：仅保留纯文本」
    return pasteClip(p, mode, C, plainNow);
  }, true);
}
regPaste('ai.edit.paste', 'offset', '粘贴（Ctrl+V）：贴到视图中心（edit.rs:263、lib.rs:426），贴进当前矢量层最上面并选中贴进来的');
regPaste('ai.edit.pasteInFront', 'front', '贴在前面（Ctrl+F）：原位、贴在最上面那个选中物件的正上方；没选取＝这层最上面');
regPaste('ai.edit.pasteInBack', 'back', '贴在后面（Ctrl+B）：原位、贴在最下面那个选中物件的正下方；没选取＝这层最下面');
regPaste('ai.edit.pasteInPlace', 'inPlace', '就地粘贴（Ctrl+Shift+V）：贴回拷贝时的位置');
regPaste('ai.edit.pasteOnAllArtboards', 'allArtboards', '在所有画板上粘贴（Ctrl+Alt+Shift+V）：每个画板各一份、对画板的位移不变（我们只有一个画板＝整张文件 ⇒ 等同就地粘贴）');
regPaste('ai.edit.pasteWithoutFormatting', 'offset', '粘贴时不包含格式（Ctrl+Alt+V）：同粘贴，但文字回预设字元样式（typemenu.rs:592 paste_plain）', true);
AE.PASTE = ['ai.edit.paste', 'ai.edit.pasteInFront', 'ai.edit.pasteInBack', 'ai.edit.pasteInPlace', 'ai.edit.pasteOnAllArtboards', 'ai.edit.pasteWithoutFormatting'];

/* ═════════════ 查找和替换／查找下一个（typemenu.rs:475-574）═════════════ */
const isWordCh = ch => /[\p{L}\p{N}_]/u.test(ch);
/* typemenu.rs:482 find_all：回 [起, 讫)（UTF-16 索引）；不分大小写时逐字比 to_lowercase；全字＝前后都不是字母数字 */
function findAll(hay, needle, mc, ww){
  const nc = Array.from(needle); if (!nc.length) return [];
  const hc = []; let off = 0; for (const ch of hay){ hc.push([off, ch]); off += ch.length; }
  const eq = (a, b) => mc ? a === b : (a === b || a.toLowerCase() === b.toLowerCase());
  const out = []; let i = 0;
  while (i + nc.length <= hc.length){
    let hit = true; for (let k = 0; k < nc.length; k++) if (!eq(hc[i + k][1], nc[k])){ hit = false; break; }
    if (hit){
      const before = i > 0 ? hc[i - 1][1] : null, after = hc[i + nc.length] ? hc[i + nc.length][1] : null;
      if (!ww || (!(before && isWordCh(before)) && !(after && isWordCh(after)))){
        out.push([hc[i][0], hc[i + nc.length] ? hc[i + nc.length][0] : hay.length]); i += nc.length; continue;
      }
    }
    i++;
  }
  return out;
}
AE.findAll = findAll;
/* typemenu.rs:508 all_texts：看得见、没锁的层里的文字物件（由下到上） */
const allTexts = () => Doc.layers.filter(L => L.kind === 'text' && layerOpen(L));
let lastFind = {find:'', replace:'', matchCase:false, wholeWord:false};
function replaceIn(L, find, rep, mc, ww){
  const hits = findAll(L.data.text, find, mc, ww); if (!hits.length) return 0;
  let out = '', last = 0;
  for (const [a, b] of hits){ out += L.data.text.slice(last, a) + rep; last = b; }
  L.data.text = out + L.data.text.slice(last);
  Layer.invalidate(L);
  return hits.length;
}
reg('ai.edit.findReplace', {params:'{find, replace?="", matchCase?=false, wholeWord?=false, ids?:[文字层 id]} 查找和替换…：每个看得见、没锁的文字物件（或 ids）里的 find 全换成 replace；一步历史（没找到不留步）→ {count}'}, p => {
  const C = 'ai.edit.findReplace';
  const find = typeof p.find === 'string' ? p.find : ''; if (!find) return fail(C, 'missing `find`');
  const rep = typeof p.replace === 'string' ? p.replace : '', mc = bool(p.matchCase, false), ww = bool(p.wholeWord, false);
  lastFind = {find, replace:rep, matchCase:mc, wholeWord:ww};
  const list = Array.isArray(p.ids) ? Doc.layers.filter(L => L.kind === 'text' && p.ids.includes(L.id)) : allTexts();
  let count = 0;
  for (const L of list) count += replaceIn(L, find, rep, mc, ww);
  return count ? {ok:true, count} : {ok:true, count:0, noop:true};
}, true);
reg('ai.edit.findNext', {params:'{find?（空＝上一次「查找和替换」找的字）, matchCase?, wholeWord?} 查找下一个：选中（AiSel.text）选取之后下一个含 find 的文字物件（绕回开头）；不进历史 → {id|null}'}, p => {
  const C = 'ai.edit.findNext';
  const find = (typeof p.find === 'string' && p.find) ? p.find : lastFind.find;
  if (!find) return fail(C, 'missing `find`');
  const mc = bool(p.matchCase, lastFind.matchCase), ww = bool(p.wholeWord, lastFind.wholeWord);
  lastFind = Object.assign({}, lastFind, {find, matchCase:mc, wholeWord:ww});
  const all = allTexts(), n = all.length;
  const curId = window.AiSel && AiSel.text && AiSel.text[0];
  const cur = all.findIndex(L => L.id === curId);
  const start = cur >= 0 ? cur + 1 : 0;
  for (let k = 0; k < n; k++){
    const L = all[(start + k) % n];
    if (findAll(L.data.text, find, mc, ww).length){ setSelection(null, [], [L.id]); redraw(); return {ok:true, id:L.id}; }
  }
  return {ok:true, id:null};
});
AE.lastFind = () => Object.assign({}, lastFind);

/* ═════════════ 拼写（原码 menus.rs:1532 三项都是 todo ⇒ 照 Illustrator 行为做）═════════════
   字典＝系统词表 /usr/share/dict/american-english（去掉 's 所有格、可由字尾规则推出的字），前缀压缩内嵌在档尾 AiEdit.spellRaw；
   查字＝基本字典 ∪ 自定词典（localStorage）∪ 本次「全部忽略」；字尾规则 known() 跟产生字典时用的同一套。
   跟 Illustrator 一样的选项：找重复的字、句首没大写；略过全大写、罗马数字、含数字的字。只查拉丁字母的字（中日韩文不查）。 */
const SUF = ['s', 'es', 'ed', 'd', 'ing', 'ly', 'er', 'ers', 'est', 'ness', 'ment', 'ments'];
const Spell = AE.spell = {
  base:null,
  custom:new Set((LS.get('dlcanvas.ai.spellDict', []) || []).map(w => String(w).toLowerCase())),
  ignored:new Set(),
  auto:!!LS.get('dlcanvas.ai.autoSpell', false),
  opts:Object.assign({repeated:true, uncapitalized:true, allCaps:true, roman:true, numbers:true}, LS.get('dlcanvas.ai.spellOpts', {})),
  save(){ LS.set('dlcanvas.ai.spellDict', Array.from(this.custom).sort()); LS.set('dlcanvas.ai.autoSpell', this.auto); LS.set('dlcanvas.ai.spellOpts', this.opts); },
  load(){
    if (this.base) return this.base;
    const raw = AE.spellRaw || '', set = new Set(), re = /[0-S][^0-S]*/g; let m, prev = '';
    while ((m = re.exec(raw))){ const t = m[0], w = prev.slice(0, t.charCodeAt(0) - 48) + t.slice(1); set.add(w); prev = w; }
    return (this.base = set);
  },
  known(w, d){
    d = d || 0; const B = this.load();
    if (B.has(w) || this.custom.has(w)) return true;
    if (d > 4) return false;
    for (const s of SUF){
      if (w.endsWith(s) && w.length - s.length >= 2){
        const b = w.slice(0, -s.length);
        if (this.known(b, d + 1)) return true;
        if (['ing', 'ed', 'er', 'est', 'ers'].includes(s) && this.known(b + 'e', d + 1)) return true;
        if (['ed', 'er', 'est', 'ing'].includes(s) && b.length > 2 && b[b.length - 1] === b[b.length - 2] && this.known(b.slice(0, -1), d + 1)) return true;
      }
      if (['es', 'ed', 'er', 'est'].includes(s) && w.endsWith('i' + s) && this.known(w.slice(0, -s.length - 1) + 'y', d + 1)) return true;
    }
    if (w.endsWith('ies') && this.known(w.slice(0, -3) + 'y', d + 1)) return true;
    if (w.endsWith('ily') && this.known(w.slice(0, -3) + 'y', d + 1)) return true;
    return false;
  },
  norm(w){ return w.replace(/’/g, "'").toLowerCase().replace(/'s$/, '').replace(/^'+|'+$/g, ''); },
  /* 这个字要不要查、查了算不算错（true＝没问题） */
  ok(word){
    const o = this.opts;
    if (!/^[\p{Script=Latin}'’]+$/u.test(word.replace(/\d/g, ''))) return true;   // 非拉丁文字不查
    if (/\d/.test(word)) return o.numbers ? true : false;
    if (word.length < 2) return true;
    if (o.allCaps && word === word.toUpperCase() && /\p{Lu}/u.test(word)) return true;
    if (o.roman && /^(?=[ivxlcdm]+$)m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i.test(word)) return true;
    const n = this.norm(word); if (!n) return true;
    if (this.ignored.has(n)) return true;
    return this.known(n);
  },
  /* 一段文字里的字：[{start, end, word}] */
  words(text){
    const out = [], re = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu; let m;
    while ((m = re.exec(text))){ let w = m[0]; while (/['’]$/.test(w)) w = w.slice(0, -1); out.push({start:m.index, end:m.index + w.length, word:w}); }
    return out;
  },
  /* 一层文字的问题：unknown（不认得）／repeated（重复的字）／uncapitalized（句首没大写） */
  problemsIn(L, withSuggest){
    const text = L.data.text, ws = this.words(text), out = [];
    ws.forEach((w, i) => {
      const prev = ws[i - 1];
      if (this.opts.repeated && prev && prev.word.toLowerCase() === w.word.toLowerCase() && /^\s+$/.test(text.slice(prev.end, w.start)) && /\p{L}/u.test(w.word)){
        out.push({layerId:L.id, start:prev.end, end:w.end, word:text.slice(prev.end, w.end), kind:'repeated', suggestions:['']}); return;
      }
      if (!this.ok(w.word)){ out.push({layerId:L.id, start:w.start, end:w.end, word:w.word, kind:'unknown', suggestions:withSuggest ? this.suggest(w.word) : []}); return; }
      if (this.opts.uncapitalized && /^\p{Ll}/u.test(w.word) && /^[\p{Script=Latin}]/u.test(w.word)){
        const before = text.slice(0, w.start);
        if (!before.trim() || /[.!?]["'”’)]*\s+$/.test(before)) out.push({layerId:L.id, start:w.start, end:w.end, word:w.word, kind:'uncapitalized', suggestions:[w.word[0].toUpperCase() + w.word.slice(1)]});
      }
    });
    return out;
  },
  problems(withSuggest, layerIds){
    const list = allTexts().filter(L => !layerIds || layerIds.includes(L.id));
    return [].concat(...list.map(L => this.problemsIn(L, withSuggest)));
  },
  /* 建议：编辑距离 1（换位、替换、删、插）里认得的；没有再试距离 2（字不长才试）；照原字的大小写 */
  suggest(word){
    const w = this.norm(word), A = 'abcdefghijklmnopqrstuvwxyz';
    const e1 = s => {
      const out = [];
      for (let i = 0; i < s.length - 1; i++) out.push(s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2));
      for (let i = 0; i < s.length; i++) for (const c of A) if (c !== s[i]) out.push(s.slice(0, i) + c + s.slice(i + 1));
      for (let i = 0; i < s.length; i++) out.push(s.slice(0, i) + s.slice(i + 1));
      for (let i = 0; i <= s.length; i++) for (const c of A) out.push(s.slice(0, i) + c + s.slice(i));
      return out;
    };
    const seen = new Set(), hits = [];
    const take = c => { if (c.length > 1 && !seen.has(c)){ seen.add(c); if (this.known(c)) hits.push(c); } };
    const one = e1(w); one.forEach(take);
    if (!hits.length && w.length <= 10) for (const c of one) { for (const c2 of e1(c)) take(c2); if (hits.length >= 12) break; }
    const fix = s => word === word.toUpperCase() && word.length > 1 ? s.toUpperCase() : /^\p{Lu}/u.test(word) ? s[0].toUpperCase() + s.slice(1) : s;
    hits.sort((a, b) => (a[0] === w[0] ? 0 : 1) - (b[0] === w[0] ? 0 : 1) || Math.abs(a.length - w.length) - Math.abs(b.length - w.length));
    return hits.slice(0, 10).map(fix);
  }
};
reg('ai.edit.spelling.auto', {params:'{on?:bool（缺省＝切换）} 拼写 ▸ 自动拼写检查：开着时画布上文字物件里不认得的字底下画红色波浪线（记在 localStorage）→ {on}'}, p => {
  Spell.auto = p.on === undefined ? !Spell.auto : !!p.on; Spell.save(); redraw(); return {ok:true, on:Spell.auto};
});
reg('ai.edit.spelling.list', {params:'{layerIds?, suggestions?=true} 列出文字物件里的拼写问题（照目前的拼写选项）→ {problems:[{layerId, start, end（UTF-16 索引）, word, kind:"unknown"|"repeated"|"uncapitalized", suggestions}]}'},
  p => ({ok:true, problems:Spell.problems(p.suggestions !== false, Array.isArray(p.layerIds) ? p.layerIds : null)}));
reg('ai.edit.spelling.setOptions', {params:'{repeated?, uncapitalized?, allCaps?, roman?, numbers?} 拼写检查选项（找：重复的字／句首没大写；略过：全大写／罗马数字／含数字）→ {options}'}, p => {
  ['repeated', 'uncapitalized', 'allCaps', 'roman', 'numbers'].forEach(k => { if (p[k] !== undefined) Spell.opts[k] = !!p[k]; });
  Spell.save(); return {ok:true, options:Object.assign({}, Spell.opts)};
});
reg('ai.edit.spelling.change', {params:'{layerId, start, end, to} 把那一段换成 to ｜ {word, to, all:true} 每个文字物件里这个字（全字、分大小写）都换掉；一步历史 → {count}'}, p => {
  const C = 'ai.edit.spelling.change', to = typeof p.to === 'string' ? p.to : null;
  if (to === null) return fail(C, 'missing `to`');
  if (p.all){
    if (!p.word) return fail(C, 'missing `word`');
    let count = 0; for (const L of allTexts()) count += replaceIn(L, String(p.word), to, true, true);
    return count ? {ok:true, count} : {ok:true, count:0, noop:true};
  }
  const L = Doc.byId(p.layerId); if (!L || L.kind !== 'text') return fail(C, 'not a text layer');
  const a = clamp(Math.floor(num(p.start, 0)), 0, L.data.text.length), b = clamp(Math.floor(num(p.end, a)), a, L.data.text.length);
  L.data.text = L.data.text.slice(0, a) + to + L.data.text.slice(b); Layer.invalidate(L);
  return {ok:true, count:1};
}, true);
reg('ai.edit.spelling.ignore', {params:'{word} 全部忽略：这次开着的期间不再把这个字当错（不进字典）→ {ok}'}, p => { if (p.word) Spell.ignored.add(Spell.norm(String(p.word))); redraw(); return {ok:true}; });
reg('ai.edit.spelling.addWord', {params:'{word} 加进自定词典（localStorage「dlcanvas.ai.spellDict」）→ {words}'}, p => {
  const w = Spell.norm(String(p.word || '')); if (!w) return fail('ai.edit.spelling.addWord', 'missing `word`');
  Spell.custom.add(w); Spell.save(); redraw(); return {ok:true, words:Array.from(Spell.custom).sort()};
});
reg('ai.edit.spelling.removeWord', {params:'{word} 从自定词典删掉 → {words}'}, p => {
  const w = Spell.norm(String(p.word || '')); if (!Spell.custom.delete(w)) return fail('ai.edit.spelling.removeWord', 'not in the dictionary');
  Spell.save(); redraw(); return {ok:true, words:Array.from(Spell.custom).sort()};
});
reg('ai.edit.spelling.dictionary', {params:'{words?:[…]（给了＝整份换掉）} 自定词典的字 → {words}'}, p => {
  if (Array.isArray(p.words)){ Spell.custom = new Set(p.words.map(w => Spell.norm(String(w))).filter(Boolean)); Spell.save(); redraw(); }
  return {ok:true, words:Array.from(Spell.custom).sort()};
});
reg('ai.edit.spelling.check', {params:'{} 拼写 ▸ 拼写检查…（Ctrl+I）：开对话框（准备开始→逐个不认得的字：忽略／全部忽略／更改／全部更改／添加／完成）→ {ok, dialog}'}, () => { openSpellDialog(); return {ok:true, dialog:'spellCheck'}; });
reg('ai.edit.spelling.editDictionary', {params:'{} 拼写 ▸ 编辑自定词典…：开对话框（字清单＋添加／删除／更改）→ {ok, dialog}'}, () => { openDictDialog(); return {ok:true, dialog:'spellDictionary'}; });

/* 自动拼写检查的波浪线（画布叠画：文字层每行的字界 x 用同一个字型量） */
const _mc = document.createElement('canvas').getContext('2d');
function wordSpan(L, info, a, b){
  const d = L.data; _mc.font = `${d.weight || 'normal'} ${d.size}px ${d.font}`;
  const out = [];
  for (const ln of info.lines){
    const s = Math.max(a, ln.start), e = Math.min(b, ln.end); if (e <= s) continue;
    const x0 = ln.x0 + _mc.measureText(d.text.slice(ln.start, s)).width, x1 = ln.x0 + _mc.measureText(d.text.slice(ln.start, e)).width;
    out.push([x0, x1, ln.baseline + Math.max(2, d.size * 0.12)]);
  }
  return out;
}
function drawSquiggles(ctx, s){
  if (!Spell.auto || !CMD.map['text.info']) return;
  ctx.save(); ctx.strokeStyle = '#e8312f'; ctx.lineWidth = 1;
  for (const L of Doc.layers){
    if (L.kind !== 'text' || !L.visible) continue;
    if (window.TypeTool && TypeTool.ed && TypeTool.ed.layer === L.id) continue;          // 正在打字那层不画（跟 AI 一样打完才标）
    const probs = Spell.problemsIn(L, false).filter(q => q.kind !== 'uncapitalized'); if (!probs.length) continue;
    let info; try { info = CMD.map['text.info'].run({layerId:L.id}); } catch(e){ continue; }
    if (!info || !info.lines) continue;
    for (const q of probs) for (const [x0, x1, y] of wordSpan(L, info, q.start, q.end)){
      ctx.beginPath(); const Y = Math.round(y * s) + 0.5;
      for (let x = x0 * s, k = 0; x <= x1 * s; x += 2, k++) (k ? ctx.lineTo(x, Y + (k % 2 ? 1.5 : -1.5)) : ctx.moveTo(x, Y));
      ctx.stroke();
    }
  }
  ctx.restore();
}
function hookOverlay(){ if (window.UI && UI.overlays && !UI.overlays.includes(drawSquiggles)) UI.overlays.push(drawSquiggles); }
hookOverlay(); if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => setTimeout(hookOverlay, 0));
AE.drawSquiggles = drawSquiggles;

/* ═════════════ 编辑颜色（colorcmds.rs）═════════════ */
/* Scope::of（colorcmds.rs:166）：fill／stroke 缺省都开；includeImages／includePatterns 收下（我们矢量层没有嵌入图与图案填色） */
const scopeOf = p => ({fill:bool(p.fill, true), stroke:bool(p.stroke, true)});
/* 目标里所有颜色格（Recolor::run 的走访；文字物件＝它的字色，算填色） */
function slotsOf(t, reach){
  const out = [];
  t.shapes.forEach(s => eachSlot(s, reach, sl => out.push(sl)));
  t.texts.forEach(L => textSlot(L, sl => out.push(sl), reach));
  return out;
}
function touch(t){ if (t.L) Layer.invalidate(t.L); t.texts.forEach(L => Layer.invalidate(L)); }
/* colorcmds.rs:325 recolor／run_pass：一步历史 → {changed} */
function recolorPass(p, C, f){
  const t = targets(p); if (t.empty) return fail(C, 'nothing selected');
  const n = mapSlots(slotsOf(t, scopeOf(p)), f);
  touch(t);
  return {ok:true, changed:n};
}
const SCOPE_P = 'fill?=true, stroke?=true, includeImages?, includePatterns?（我们的矢量层没有嵌入图／图案，收下不用）, ids?';
reg('ai.edit.colors.invert', {params:`{${SCOPE_P}} 编辑颜色 ▸ 反相颜色：每个颜色换成它的 RGB 反相（保留色彩模式），填色、描边、渐变色标、网格点、文字；一步历史 → {changed}`},
  p => recolorPass(p, 'ai.edit.colors.invert', c => Col.invert(c)), true);
reg('ai.edit.colors.toCMYK', {params:`{${SCOPE_P}} 编辑颜色 ▸ 转换为 CMYK（无描述档公式 k=1−max(r,g,b)；颜色记成 CMYK 模式，看起来不变）→ {changed}`},
  p => recolorPass(p, 'ai.edit.colors.toCMYK', c => Col.inModel(c, 'cmyk')), true);
reg('ai.edit.colors.toGrayscale', {params:`{${SCOPE_P}} 编辑颜色 ▸ 转换为灰度（墨量＝1−(0.299r+0.587g+0.114b)）→ {changed}`},
  p => recolorPass(p, 'ai.edit.colors.toGrayscale', c => Col.inModel(c, 'gray')), true);
reg('ai.edit.colors.toRGB', {params:`{${SCOPE_P}} 编辑颜色 ▸ 转换为 RGB（显示的 RGB）→ {changed}`},
  p => recolorPass(p, 'ai.edit.colors.toRGB', c => Col.rgb(...Col.toRgb(c))), true);
/* colorcmds.rs:339 saturate */
reg('ai.edit.colors.saturate', {params:`{intensity:-100..100（%）, ${SCOPE_P}} 编辑颜色 ▸ 调整饱和度：饱和度 ×(1+intensity/100)（灰色不动、保留色彩模式）→ {changed}`}, p => {
  const i = clamp(num(p.intensity, 0), -100, 100) / 100;
  return recolorPass(p, 'ai.edit.colors.saturate', c => { const [h, s, v] = Col.toHsb(c); if (s <= 0) return c; return Col.keep(c, Col.fromHsb(h, clamp(s * (1 + i), 0, 1), v)); });
}, true);
/* colorcmds.rs:350 adjust_balance */
reg('ai.edit.colors.adjustBalance', {params:`{mode?:"rgb"|"cmyk"|"gray"|"global"（缺省＝看给了哪些通道）, r?,g?,b? | c?,m?,y?,k? | gray? | tint?：-100..100（每个通道加几 %）, convert?=false（true＝结果留在调整的模式；false＝各颜色保留自己的模式）, ${SCOPE_P}} 编辑颜色 ▸ 调整色彩平衡（global＝调全局色板的色调；我们没有全局色板 ⇒ 不动）→ {changed}`}, p => {
  const C = 'ai.edit.colors.adjustBalance';
  const given = ks => ks.some(k => p[k] !== undefined);
  let mode = typeof p.mode === 'string' ? p.mode.toLowerCase() : given(['c', 'm', 'y', 'k']) ? 'cmyk' : given(['gray']) ? 'gray' : given(['r', 'g', 'b']) ? 'rgb' : given(['tint']) ? 'global' : null;
  if (!mode) return fail(C, 'give a mode or r/g/b, c/m/y/k, gray or tint adjustments');
  const g = k => clamp(num(p[k], 0), -100, 100) / 100, cl = v => clamp(v, 0, 1);
  let adjust;
  if (mode === 'rgb'){ const dr = g('r'), dg = g('g'), db = g('b'); adjust = c => { const [r, gg, b] = Col.toRgb(c); return Col.rgb(cl(r + dr), cl(gg + dg), cl(b + db)); }; }
  else if (mode === 'cmyk'){ const d = ['c', 'm', 'y', 'k'].map(g); adjust = c => Col.cmyk(...Col.toCmyk(c).map((v, i) => cl(v + d[i]))); }
  else if (mode === 'gray'){ const dg = g('gray'); adjust = c => Col.gray(cl(Col.inModel(c, 'gray').v[0] + dg)); }
  else if (mode === 'global'){ const t = targets(p); if (t.empty) return fail(C, 'nothing selected'); return {ok:true, changed:0}; }   // 连到全局色板的颜色才动；我们没有色板
  else return fail(C, `unknown mode \`${mode}\` (rgb|cmyk|gray|global)`);
  const convert = bool(p.convert, false);
  return recolorPass(p, C, c => { const o = adjust(c); return convert ? o : Col.keep(c, o); });
}, true);

/* colorcmds.rs:413-498 混合：至少三个有填色的物件（实色填色、网格〔保留明暗〕、文字），中间的填色按头尾内插 */
function filledLeaves(t){
  const out = [], idx = L => Doc.index(L.id);
  const fillColor = s => {
    if (s.type === 'mesh' && s.mesh && s.mesh.points && s.mesh.points.length){
      const sum = [0, 0, 0]; let k = 0;
      s.mesh.points.forEach(q => { const c = readColor(q.color, q.model); if (c){ const v = Col.toRgb(c); sum[0] += v[0]; sum[1] += v[1]; sum[2] += v[2]; k++; } });
      return k ? Col.rgb(sum[0] / k, sum[1] / k, sum[2] / k) : null;
    }
    return typeof s.fill === 'string' ? readColor(s.fill, s.fillModel) : null;     // 渐变填色不算（fill_paint().color() 是 None）
  };
  let seq = 0;
  const visit = s => { if (s.type === 'group'){ (s.children || []).forEach(visit); return; } const c = fillColor(s); if (c) out.push({s, c, order:[idx(t.L), seq++], box:() => shapeBox(t.L, s, false)}); };
  t.shapes.forEach(visit);
  t.texts.forEach(L => { const c = readColor(L.data.color, L.data.colorModel); if (c) out.push({L, c, order:[idx(L), 0], box:() => textBox(L)}); });
  out.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1]);       // 绘制顺序（下到上）
  return out;
}
function blendColors(p, how, C){
  const t = targets(p); if (t.empty) return fail(C, 'nothing selected');
  const items = filledLeaves(t);
  if (items.length < 3) return fail(C, 'Blend colors: select at least three objects with filled colours');
  const ctr = it => { const b = it.box(); return b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : [0, 0]; };
  if (how === 'stack') items.reverse();                                          // 前到后：最前面的先
  else if (how === 'h') items.sort((a, b) => ctr(a)[0] - ctr(b)[0]);
  else items.sort((a, b) => ctr(a)[1] - ctr(b)[1]);
  const first = items[0].c, last = items[items.length - 1].c;
  const model = first.m === last.m ? first.m : 'rgb';                            // 模式不同 ⇒ 文件的色彩模式（我们是 RGB）
  const n = items.length; let changed = 0;
  for (let i = 1; i < n - 1; i++){
    const c = Col.inModel(Col.lerp(first, last, i / (n - 1)), model), it = items[i];
    if (it.L){ changed += mapSlots([{obj:it.L.data, key:'color', tagKey:'colorModel', unit:it.L}], () => c); Layer.invalidate(it.L); continue; }
    if (it.s.type === 'mesh'){
      const cr = Col.toRgb(c), mr = Col.toRgb(it.c);                              // 网格：平均色搬到内插色、明暗留着
      const sl = []; eachSlot(it.s, {fill:true}, x => sl.push(x));
      changed += mapSlots(sl, q => { const v = Col.toRgb(q); return Col.keep(q, Col.rgb(clamp(v[0] + cr[0] - mr[0], 0, 1), clamp(v[1] + cr[1] - mr[1], 0, 1), clamp(v[2] + cr[2] - mr[2], 0, 1))); });
    } else changed += mapSlots([{obj:it.s, key:'fill', tagKey:'fillModel', unit:it.s}], () => c);
  }
  touch(t);
  return {ok:true, changed};
}
reg('ai.edit.colors.blendFrontToBack', {params:'{ids?} 编辑颜色 ▸ 前后混合：≥3 个有填色的物件（实色、网格、文字），中间的填色按最前与最后那个内插；一步历史 → {changed}'}, p => blendColors(p, 'stack', 'ai.edit.colors.blendFrontToBack'), true);
reg('ai.edit.colors.blendHorizontally', {params:'{ids?} 编辑颜色 ▸ 水平混合：按外框中心由左到右，中间的填色按最左与最右内插 → {changed}'}, p => blendColors(p, 'h', 'ai.edit.colors.blendHorizontally'), true);
reg('ai.edit.colors.blendVertically', {params:'{ids?} 编辑颜色 ▸ 垂直混合：按外框中心由上到下，中间的填色按最上与最下内插 → {changed}'}, p => blendColors(p, 'v', 'ai.edit.colors.blendVertically'), true);

/* overprint.rs:213 overprint_black ＋ doc/src/overprint.rs:17 is_black_ink：K ≥ 百分比、没有 C/M/Y（含 CMY 的黑要 includeCmyBlacks）；RGB／Lab 不算黑 */
function isBlackInk(c, minK, rich){
  const E = 0.005;
  if (c.m === 'cmyk') return c.v[3] >= minK - E && (rich || (c.v[0] <= E && c.v[1] <= E && c.v[2] <= E));
  if (c.m === 'gray') return c.v[0] >= minK - E;
  return false;
}
reg('ai.edit.colors.overprintBlack', {params:'{remove?=false, percentage?=100, fill?=true, stroke?=true, includeCmyBlacks?=false, includeSpotBlacks?=false（我们没有专色）, ids?} 编辑颜色 ▸ 叠印黑色…：选中物件（编组往下）的黑色填色／描边设成叠印（remove＝取消）；黑＝CMYK 或灰度模式且 K≥百分比（先「转换为 CMYK」）；渐变每个色标都黑才算；只存旗标 s.overprintFill／overprintStroke（画板没有叠印预览）→ {changed:物件数}'}, p => {
  const C = 'ai.edit.colors.overprintBlack';
  const t = targets(p); if (t.empty) return fail(C, 'nothing selected');
  const on = !bool(p.remove, false), minK = clamp(num(p.percentage, 100) / 100, 0, 1), rich = bool(p.includeCmyBlacks, false), doF = bool(p.fill, true), doS = bool(p.stroke, true);
  const black = (v, tag) => {
    if (v && typeof v === 'object' && Array.isArray(v.stops)) return v.stops.length > 0 && v.stops.every(st => { const c = Array.isArray(st) ? readColor(st[1]) : readColor(st.color, st.model); return c && isBlackInk(c, minK, rich); });
    const c = typeof v === 'string' ? readColor(v, tag) : null; return !!c && isBlackInk(c, minK, rich);
  };
  let changed = 0;
  const apply = (obj, fillKey, fillTag, strokeKey, strokeTag, flagF, flagS) => {
    let ch = false;
    const set = k => { if (!!obj[k] !== on){ if (on) obj[k] = true; else delete obj[k]; ch = true; } };
    if (doF && fillKey && black(obj[fillKey], obj[fillTag])) set(flagF);
    if (doS && strokeKey && black(obj[strokeKey], obj[strokeTag])) set(flagS);
    return ch;
  };
  const tree = s => { let n = apply(s, 'fill', 'fillModel', 'stroke', 'strokeModel', 'overprintFill', 'overprintStroke') ? 1 : 0; (s.type === 'group' || s.type === 'compound') && (s.children || []).forEach(c => { n += tree(c); }); return n; };
  t.shapes.forEach(s => { changed += tree(s); });
  t.texts.forEach(L => { if (apply(L.data, 'color', 'colorModel', null, null, 'overprintFill', 'overprintStroke')) changed++; });
  return changed ? {ok:true, changed} : {ok:true, changed:0, noop:true};
}, true);

/* ═════════════ 重新着色图稿（engine/src/cmd/recolor.rs ＋ color/src/recolor.rs）═════════════ */
/* recolor.rs:85 Neutral／121 Preserve */
function neutral(c){
  const E = 0.005, v = c.v;
  if (c.m === 'gray') return v[0] <= E ? 'white' : v[0] >= 1 - E ? 'black' : 'gray';
  if (c.m === 'cmyk'){ if (Math.max(...v) <= E) return 'white'; if (v[3] >= 1 - E) return 'black'; return Math.max(v[0], v[1], v[2]) <= E ? 'gray' : null; }
  if (c.m === 'lab'){ if (v[0] >= 99.5 && Math.max(Math.abs(v[1]), Math.abs(v[2])) <= 0.5) return 'white'; if (v[0] <= 0.5) return 'black'; return Math.max(Math.abs(v[1]), Math.abs(v[2])) <= 0.5 ? 'gray' : null; }
  const lo = Math.min(...v), hi = Math.max(...v);
  return lo >= 1 - E ? 'white' : hi <= E ? 'black' : (hi - lo <= E ? 'gray' : null);
}
const keeps = (pr, c) => { const n = neutral(c); return n === 'white' ? pr.white : n === 'black' ? pr.black : n === 'gray' ? pr.grays : false; };
/* recolor.rs:150 Method */
const METHODS = ['exact', 'preserveTints', 'scaleTints', 'tintsShades', 'hueShift'];
const METHOD_LABEL = {exact:'Exact', preserveTints:'Preserve Tints', scaleTints:'Scale Tints', tintsShades:'Tints and Shades', hueShift:'Hue Shift'};
function methodParse(s){ const k = x => String(x).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase(); return METHODS.find(m => k(m) === k(s) || k(METHOD_LABEL[m]) === k(s)) || null; }
const chroma = l => Math.hypot(l.a, l.b);
const meanL = cs => cs.reduce((a, c) => a + Col.toLab(c).l, 0) / Math.max(cs.length, 1);
/* recolor.rs:199 key_color：色相偏移＝最饱和；色调和暗色＝最接近平均亮度；其余＝最暗 */
function keyColor(method, row){
  if (!row.length) return null;
  const score = method === 'hueShift' ? (l => -chroma(l) * 1000 + l.l) : method === 'tintsShades' ? (m => (l => Math.abs(l.l - m)))(meanL(row)) : (l => l.l * 1000 - chroma(l));
  let best = row[0], bs = score(Col.toLab(row[0]));
  for (const c of row.slice(1)){ const s = score(Col.toLab(c)); if (s < bs){ bs = s; best = c; } }
  return best;
}
/* recolor.rs:219 ink／234 tint_of／241 is_tint／248 shaded */
function ink(c, m){
  const x = Col.inModel(c, m), v = x.v;
  if (x.m === 'cmyk') return v.slice(); if (x.m === 'gray') return [v[0], 0, 0, 0];
  if (x.m === 'lab') return [(100 - v[0]) / 100, v[1] / 100, v[2] / 100, 0];
  return [1 - v[0], 1 - v[1], 1 - v[2], 0];
}
const dot4 = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
function tintOf(c, base){ const a = ink(c, c.m), b = ink(base, c.m), bb = dot4(b, b); return bb <= 1e-9 ? 1 : clamp(dot4(a, b) / bb, 0, 1); }
function isTint(c, base){ const t = tintOf(c, base), a = ink(c, c.m), b = ink(base, c.m); return a.every((x, i) => Math.abs(x - b[i] * t) <= 0.01); }
function shaded(c, f){
  f = clamp(f, 0, 1); const v = c.v;
  if (c.m === 'cmyk') return Col.cmyk(v[0], v[1], v[2], v[3] + (1 - v[3]) * f);
  if (c.m === 'gray') return Col.gray(v[0] + (1 - v[0]) * f);
  if (c.m === 'lab') return Col.lab(v[0] * (1 - f), v[1] * (1 - f), v[2] * (1 - f));
  return Col.rgb(v[0] * (1 - f), v[1] * (1 - f), v[2] * (1 - f));
}
/* recolor.rs:259 RowMap */
function rowMap(method, row, to){
  const key = keyColor(method, row) || to, mL = method === 'tintsShades' ? meanL(row) : 0, turn = Col.toHsb(to)[0] - Col.toHsb(key)[0];
  return {key, map(c){
    const t = Col.keep(c, to);
    switch (method){
      case 'preserveTints': return isTint(c, key) ? Col.tinted(t, tintOf(c, key)) : t;
      case 'scaleTints': return Col.tinted(t, tintOf(c, key));
      case 'tintsShades': { const d = Col.toLab(c).l - mL; return d >= 0 ? Col.tinted(t, 1 - d / Math.max(100 - mL, 1e-3)) : shaded(t, -d / Math.max(mL, 1e-3)); }
      case 'hueShift': { if (Col.eq(c, key)) return t; const [h, s, v] = Col.toHsb(c); return s <= 0 ? c : Col.keep(c, Col.fromHsb(h + turn, s, v)); }
      default: return t;
    }
  }};
}
/* recolor.rs:311 cluster：Lab（亮度算一半）加权 k-means，种子＝最重的、再每次挑离所有种子最远的 */
function cluster(colors, weights, n){
  const pts = colors.map(c => { const l = Col.toLab(c); return [l.l * 0.5, l.a, l.b]; });
  const w = i => Math.max(weights[i] === undefined ? 1 : weights[i], 1e-6);
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  n = Math.max(1, n); if (!pts.length) return [];
  let first = 0; for (let i = 0; i < pts.length; i++) if (w(i) > w(first)) first = i;
  const centres = [pts[first].slice()]; const near = pts.map(p => d2(p, pts[first]));
  while (centres.length < n){
    let bi = 0, far = 0; near.forEach((d, i) => { if (d > far){ far = d; bi = i; } });
    if (far <= 1e-6) break;
    centres.push(pts[bi].slice()); pts.forEach((p, j) => { near[j] = Math.min(near[j], d2(p, pts[bi])); });
  }
  const nearest = p => { let k = 0; for (let i = 1; i < centres.length; i++) if (d2(p, centres[i]) < d2(p, centres[k])) k = i; return k; };
  let of = pts.map(nearest);
  for (let it = 0; it < 50; it++){
    const sum = centres.map(() => [[0, 0, 0], 0]);
    pts.forEach((p, i) => { const s = sum[of[i]]; for (let k = 0; k < 3; k++) s[0][k] += p[k] * w(i); s[1] += w(i); });
    centres.forEach((c, i) => { if (sum[i][1] > 0) for (let k = 0; k < 3; k++) c[k] = sum[i][0][k] / sum[i][1]; });
    const next = pts.map(nearest);
    if (next.every((x, i) => x === of[i])) break;
    of = next;
  }
  const rows = centres.map(() => []); of.forEach((c, i) => rows[c].push(i));
  return rows.filter(r => r.length).sort((a, b) => a[0] - b[0]);
}
/* recolor.rs:388 Rng（xorshift64*，用 BigInt 求同一串数） */
class Rng {
  constructor(seed){ const M = (1n << 64n) - 1n; this.M = M; this.s = ((BigInt(Math.max(0, Math.floor(seed || 0))) * 0x9E3779B97F4A7C15n) & M) | 1n; }
  next(){ const M = this.M; let x = this.s; x ^= x >> 12n; x ^= (x << 25n) & M; x ^= x >> 27n; this.s = x; return (x * 0x2545F4914F6CDD1Dn) & M; }
  range(lo, hi){ return lo + (hi - lo) * (Number(this.next() >> 40n) / (1 << 24)); }
  shuffle(v){ for (let i = v.length - 1; i > 0; i--){ const j = Number(this.next() % BigInt(i + 1)); [v[i], v[j]] = [v[j], v[i]]; } }
  sb(c){ const [h, s] = Col.toHsb(c); const s2 = this.range(0.25, 1), v2 = this.range(0.3, 1); return Col.keep(c, Col.fromHsb(h, s <= 0 ? 0 : s2, v2)); }
}
/* recolor.rs:67 used_colors：选取用到的颜色（填色、描边、渐变色标、文字、网格点），用得多的在前（同样多照键） */
function usedColors(t){
  const idx = new Map(), used = [];
  slotsOf(t, {fill:true, stroke:true}).forEach(sl => {
    const c = readColor(sl.obj[sl.key], sl.tagKey ? sl.obj[sl.tagKey] : null); if (!c) return;
    delete c.a; const k = Key.str(c);
    if (!idx.has(k)){ idx.set(k, used.length); used.push({color:Key.color(k), key:k, count:0}); }
    used[idx.get(k)].count++;
  });
  used.sort((a, b) => b.count - a.count || Key.cmp(a.color, b.color));
  return used;
}
/* swatchlib.rs:286 limit_param：限定为库（内建色板库，或 "document"＝文件色板：我们没有） */
function limitPalette(p, C){
  const k = typeof p.limitTo === 'string' ? p.limitTo.trim() : '';
  if (!k) return null;
  const lib = Libraries.find(k);
  if (!lib) throw new Error(`${C}: no swatch library \`${k}\` (${Libraries.list().map(l => l.id).join('|')})`);
  const labs = lib.colors.map(c => [c, Col.toLab(c)]);
  return {nearest(c){ const l = Col.toLab(c); let best = labs[0], bd = Infinity; for (const x of labs){ const d = deltaE2000(x[1], l); if (d < bd){ bd = d; best = x; } } return best ? best[0] : c; }};
}
reg('ai.recolor.colors', {params:'{ids?} 重新着色图稿：选取用到的颜色（填色、描边、渐变色标、文字、网格点），用得多的在前 → {colors:[{key:"rgb 255 0 0"|"cmyk 0 100 100 0"|"gray 40", hex, count}]}'}, p => {
  const t = targets(p); if (t.empty) return fail('ai.recolor.colors', 'nothing selected');
  return {ok:true, colors:usedColors(t).map(u => ({key:u.key, hex:Col.hex(u.color), count:u.count}))};
});
reg('ai.recolor.reduce', {params:'{colors?:n（行数；缺省＝每色一行）, method?（同 apply，缺省 scaleTints＝决定每行的代表色）, preserve?:{white?=true, black?=true, grays?=false}（不放进行里）, limitTo?（新颜色吸到色板库最近色）, ids?} 把选取的颜色分成相近的行（Lab k-means、按用量加权）→ {map:[{from:[键…（代表色在前）], to:键}], preserved:[键], method}'}, p => {
  const C = 'ai.recolor.reduce', method = p.method === undefined ? 'scaleTints' : methodParse(p.method);
  if (!method) return fail(C, `unknown method \`${p.method}\` (${METHODS.join('|')})`);
  const pal = limitPalette(p, C);
  const pr = Object.assign({white:true, black:true, grays:false}, p.preserve || {});
  const t = targets(p); if (t.empty) return fail(C, 'nothing selected');
  const all = usedColors(t), kept = all.filter(u => keeps(pr, u.color)), used = all.filter(u => !keeps(pr, u.color));
  const units = used.map(u => [u]);                                             // 我们没有全局色板 ⇒ 每色一个单位
  let rows = units;
  const n = fin(+p.colors) && +p.colors > 0 ? Math.floor(+p.colors) : null;
  if (n !== null && n < units.length){
    const keys = units.map(g => keyColor(method, g.map(u => u.color)) || Col.BLACK), ws = units.map(g => g.reduce((s, u) => s + u.count, 0));
    rows = cluster(keys, ws, n).map(ix => [].concat(...ix.map(i => units[i])));
  }
  const map = rows.map(row => {
    const from = row.map(u => u.color), key = keyColor(method, from) || Col.BLACK;
    const i = from.findIndex(c => Col.eq(c, key)); if (i > 0){ const [k] = from.splice(i, 1); from.unshift(k); }
    const to = pal ? pal.nearest(key) : key;
    return {from:from.map(c => Key.str(c)), to:Key.str(to)};
  });
  return {ok:true, map, preserved:kept.map(u => u.key), method};
});
/* recolor.rs:230 parse_rows */
function parseRows(p, C){
  const cur = v => { if (typeof v === 'string'){ const k = Key.parse(v); if (k) return {key:Key.str(k), color:k}; const c = cssRGBA(v); if (c){ const h = hex3(c); return {hex:h, color:Col.rgb(c[0], c[1], c[2])}; } } const c = Col.value(v); if (c) return {key:Key.str(c), color:Key.color(Key.str(c))}; throw new Error(`${C}: bad current colour ${JSON.stringify(v)}`); };
  const nw = v => { if (v === undefined || v === null) return null; const c = Col.value(v); if (!c) throw new Error(`${C}: bad new colour ${JSON.stringify(v)}`); return c; };
  if (Array.isArray(p.map)) return p.map.map(r => {
    if (!r || r.from === undefined) throw new Error(`${C}: each row needs \`from\``);
    return {from:(Array.isArray(r.from) ? r.from : [r.from]).map(cur), to:nw(r.to), exclude:!!r.exclude};
  });
  if (p.map && typeof p.map === 'object') return Object.entries(p.map).map(([k, v]) => ({from:[cur(k)], to:nw(v), exclude:false}));
  throw new Error(`${C}: missing \`map\` (rows [{from, to}] or {current: new})`);
}
/* recolor.rs:256 ColorMap */
function colorMap(rows, method){
  const maps = [], keys = new Map(), hexes = new Map();
  rows.filter(r => r.from.length && r.to && !r.exclude).forEach(r => {
    const i = maps.length; maps.push(rowMap(method, r.from.map(m => m.color), r.to));
    r.from.forEach(m => { if (m.key){ if (!keys.has(m.key)) keys.set(m.key, i); } else if (!hexes.has(m.hex)) hexes.set(m.hex, i); });
  });
  return c => { let i = keys.get(Key.str(c)); if (i === undefined && hexes.size) i = hexes.get(Col.hex(c)); return i === undefined ? c : maps[i].map(c); };
}
reg('ai.recolor.apply', {params:`{map: 行 [{from:[颜色键（ai.recolor.colors）或 "#rrggbb"（看起来是这个 hex 的都算）], to:颜色（hex／键／{c,m,y,k}）|null, exclude?:false}] 或 {"键或#hex": 新颜色, …}, method?:"exact"（缺省）|"preserveTints"|"scaleTints"|"tintsShades"|"hueShift", limitTo?:色板库 id（${'web-safe-216 等，见 AiEdit.libraries()'}）, ids?} 重新着色图稿：选取里的颜色照对照表换（新颜色保留被换的那个颜色的色彩模式）；一步历史 → {changed}`}, p => {
  const C = 'ai.recolor.apply';
  const method = p.method === undefined ? 'exact' : methodParse(p.method);
  if (!method) return fail(C, `unknown method \`${p.method}\` (${METHODS.join('|')})`);
  const pal = limitPalette(p, C);
  const rows = parseRows(p, C);
  if (pal) rows.forEach(r => { if (r.to) r.to = pal.nearest(r.to); });
  const t = targets(p); if (t.empty) return fail(C, 'select artwork to recolour');
  const f = colorMap(rows, method);
  const n = mapSlots(slotsOf(t, {fill:true, stroke:true}), c => { const x = {m:c.m, v:c.v}; return f(x); });
  touch(t);
  return {ok:true, changed:n};
}, true);
reg('ai.recolor.randomize', {params:'{map:行（同 apply）, order?=true（在没排除的行之间打乱新颜色）, saturationBrightness?=false（随机饱和度与亮度、保留色相）, seed?=0} → {map:行（新颜色换成键）}'}, p => {
  const C = 'ai.recolor.randomize', rows = parseRows(p, C), rng = new Rng(num(p.seed, 0));
  let news = rows.filter(r => r.to && !r.exclude).map(r => r.to);
  if (bool(p.order, true)) rng.shuffle(news);
  if (bool(p.saturationBrightness, false)) news = news.map(c => rng.sb(c));
  let k = 0;
  const map = rows.map(r => {
    const to = (r.to && !r.exclude) ? news[k++] : r.to;
    const o = {from:r.from.map(m => m.key || m.hex), to:to ? Key.str(to) : null}; if (r.exclude) o.exclude = true; return o;
  });
  return {ok:true, map};
});

/* color/src/harmony.rs：协调规则（重新着色的「编辑」页） */
const sv = (turn, sat, bright) => ({turn, sat, bright}), tt = turn => sv(turn, 1, 1), soft = turn => sv(turn, 0.5, 1), deep = turn => sv(turn, 1, 0.6), hc = turn => ({turn, sat:1, bright:'contrast'});
const HARMONY = [
  ['Complementary', [tt(0), tt(180)]], ['Complementary 2', [tt(0), soft(0), tt(180), soft(180)]], ['Split Complementary', [tt(0), tt(150), tt(210)]],
  ['Left Complement', [tt(0), tt(-30), tt(150)]], ['Right Complement', [tt(0), tt(30), tt(210)]], ['Analogous', [tt(0), tt(30), tt(-30)]],
  ['Analogous 2', [tt(0), tt(30), tt(60), tt(-30), tt(-60)]], ['Monochromatic', [tt(0), sv(0, 0.5, 1), sv(0, 1, 0.6), sv(0, 0.25, 1), sv(0, 1, 0.35)]],
  ['Shades', [tt(0), sv(0, 1, 0.8), sv(0, 1, 0.6), sv(0, 1, 0.4), sv(0, 1, 0.2)]], ['Triad', [tt(0), tt(120), tt(240)]],
  ['Triad 2', [tt(0), tt(120), soft(120), tt(240), soft(240)]], ['Triad 3', [tt(0), tt(120), deep(120), tt(240), deep(240)]],
  ['Tetrad', [tt(0), tt(60), tt(180), tt(240)]], ['Tetrad 2', [tt(0), tt(90), tt(180), tt(270)]], ['Tetrad 3', [tt(0), tt(30), tt(180), tt(210)]],
  ['Compound', [tt(0), tt(40), tt(160), tt(200)]], ['Compound 2', [tt(0), tt(-40), tt(160), tt(200)]], ['High Contrast', [tt(0), hc(180)]],
  ['High Contrast 2', [tt(0), hc(0), tt(180), hc(180)]], ['High Contrast 3', [tt(0), hc(120), hc(240)]], ['Pentagram', [tt(0), tt(72), tt(144), tt(216), tt(288)]],
];
const harmonyId = label => label.split(' ').map((w, i) => i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1)).join('');
function harmonyApply(label, base){
  const [h, s, v] = Col.toHsb(base), tones = (HARMONY.find(x => x[0] === label) || HARMONY[0])[1];
  return [base].concat(tones.slice(1).map(t => Col.keep(base, Col.fromHsb(h + t.turn, clamp(s * t.sat, 0, 1), clamp(t.bright === 'contrast' ? (v >= 0.5 ? v * 0.3 : 0.7 + 0.3 * v) : v * t.bright, 0, 1)))));
}
/* harmony.rs:216 move_on_wheel */
function moveOnWheel(colors, i, hsb, linked){
  const old = colors[i]; if (!old) return colors;
  const [h0, s0, v0] = Col.toHsb(old), dh = hsb[0] - h0, ratio = s0 > 0.01 ? hsb[1] / s0 : 1, dv = hsb[2] - v0;
  return colors.map((c, j) => {
    if (j === i) return Col.keep(c, Col.fromHsb(hsb[0], hsb[1], hsb[2]));
    if (!linked) return c;
    const [h, s, v] = Col.toHsb(c); return Col.keep(c, Col.fromHsb(h + dh, clamp(s * ratio, 0, 1), clamp(v + dv, 0, 1)));
  });
}
AE.harmony = {labels:HARMONY.map(x => x[0]), apply:harmonyApply, moveOnWheel, id:harmonyId};

/* color/src/libraries.rs:57-273 内建色板库（实色的六个；渐变库与 Perceptual／Harmony Sets 没抄） */
function oklabToSrgb(l, a, b){
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b, m_ = l - 0.1055613458 * a - 0.0638541728 * b, s_ = l - 0.0894841775 * a - 1.2914855480 * b;
  const l3 = l_ ** 3, m3 = m_ ** 3, s3 = s_ ** 3;
  return [4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3, -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3, -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3]
    .map(v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
}
function oklch(l, c, h){
  const r = h * Math.PI / 180, at = cc => oklabToSrgb(l, cc * Math.cos(r), cc * Math.sin(r)), fits = v => v.every(x => x >= -1e-4 && x <= 1.0001);
  let rgb = at(c);
  if (!fits(rgb)){ let lo = 0, hi = c; for (let i = 0; i < 24; i++){ const mid = (lo + hi) / 2; if (fits(at(mid))) lo = mid; else hi = mid; } rgb = at(lo); }
  return Col.rgb(...rgb.map(v => q8(v) / 255));
}
const ramp = (n, l0, l1, cf, hf) => Array.from({length:n}, (_, i) => { const t = i / Math.max(n - 1, 1); return oklch(l0 + (l1 - l0) * t, cf(t), hf(t)); });
const HUES = [25, 55, 75, 100, 125, 145, 180, 205, 235, 265, 295, 330];
const hueRow = (l, c) => HUES.map(h => oklch(l, c, h));
const Libraries = AE.Libraries = {
  defs:[
    ['web-safe-216', 'Web Safe 216', () => { const o = []; for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) o.push(Col.rgb(r * 0x33 / 255, g * 0x33 / 255, b * 0x33 / 255)); return o; }],
    ['grays-neutrals', 'Grays and Neutrals', () => [].concat(Array.from({length:21}, (_, i) => Col.gray(i / 20)), ramp(9, 0.95, 0.25, () => 0.012, () => 70), ramp(9, 0.95, 0.25, () => 0.015, () => 250),
      [[0.96, 0.02, 95], [0.92, 0.02, 70], [0.86, 0.035, 80], [0.72, 0.02, 75], [0.66, 0.015, 95], [0.56, 0.03, 50], [0.48, 0.025, 250], [0.30, 0.01, 260]].map(x => oklch(...x)))],
    ['earth-tones', 'Earth Tones', () => [].concat(...[[0.10, 40], [0.13, 35], [0.11, 80], [0.06, 60], [0.05, 85], [0.08, 115], [0.07, 130]].map(([c, h]) => ramp(6, 0.86, 0.34, t => c * (0.6 + 0.4 * (1 - (2 * t - 1) ** 2)), () => h)))],
    ['skin-tone-ramps', 'Skin Tone Ramps', () => [].concat(...[[0.075, 35], [0.07, 55], [0.08, 70], [0.06, 85]].map(([c, h]) => ramp(8, 0.93, 0.32, t => c * (0.45 + 0.75 * t - 0.35 * t * t), t => h - 8 * t)))],
    ['pastels', 'Pastels', () => [].concat(hueRow(0.91, 0.055), hueRow(0.84, 0.085))],
    ['brights', 'Brights', () => [].concat(hueRow(0.72, 0.4), hueRow(0.52, 0.4))],
  ],
  _cache:{},
  list(){ return this.defs.map(d => ({id:d[0], name:d[1]})); },
  find(k){
    const key = String(k).toLowerCase();
    const d = this.defs.find(x => x[0] === key || x[1].toLowerCase() === key); if (!d) return null;
    return this._cache[d[0]] || (this._cache[d[0]] = {id:d[0], name:d[1], colors:d[2]()});
  }
};
AE.libraries = () => Libraries.list();

/* ═════════════ 首选项（engine/src/cmd/prefscmds.rs PREF_SPECS ＋ lib.rs:500 Prefs::default）═════════════
   全部照表登记、存 localStorage「dlcanvas.ai.prefs」；画板里真的用到的：pasteOffset（粘贴位移）、pasteTextFormatting（粘贴文字只留纯文本）。
   长度一律当文件像素（原码是 pt）。 */
const UNITS = [['points', 'Points'], ['picas', 'Picas'], ['inches', 'Inches'], ['millimeters', 'Millimeters'], ['centimeters', 'Centimeters'], ['pixels', 'Pixels'], ['feetInches', 'Feet & Inches'], ['meters', 'Meters'], ['yards', 'Yards'], ['feet', 'Feet']];
const LINE = [['lines', 'Lines'], ['dots', 'Dots']];
const PCATS = ['General', 'Selection & Anchor Display', 'Type', 'Units', 'Guides & Grid', 'Smart Guides', 'Slices', 'Hyphenation', 'Performance & Storage', 'User Interface', 'Performance', 'File Handling', 'Clipboard Handling', 'Appearance of Black', 'Devices'];
const b_ = 'bool', n_ = (a, b, u) => ['num', a, b, u || ''], l_ = (a, b) => ['len', a, b], i_ = (a, b) => ['int', a, b], c_ = o => ['choice', o];
const SA = 'Selection & Anchor Display', AD = 'Anchor Points, Handle, and Bounding Box Display';
const PSPEC = [
  ['keyboardIncrement', 'General', '', 'Keyboard Increment', l_(0.001, 1296), 1], ['constrainAngle', 'General', '', 'Constrain Angle', n_(-360, 360, '°'), 0],
  ['cornerRadius', 'General', '', 'Corner Radius', l_(0, 1296), 12], ['pasteOffset', 'General', '', 'Paste Offset', l_(0, 1296), 10],
  ['disableAutoAddDelete', 'General', 'Options', 'Disable Auto Add/Delete', b_, false], ['usePreciseCursors', 'General', 'Options', 'Use Precise Cursors', b_, false],
  ['showToolTips', 'General', 'Options', 'Show Tool Tips', b_, true], ['antiAliasedArtwork', 'General', 'Options', 'Anti-aliased Artwork', b_, true],
  ['selectSameTintPercent', 'General', 'Options', 'Select Same Tint %', b_, false], ['showHomeScreen', 'General', 'Options', 'Show The Home Screen When No Documents Are Open', b_, true],
  ['usePreviewBounds', 'General', 'Options', 'Use Preview Bounds', b_, false], ['displayPrintSize', 'General', 'Options', 'Display Print Size at 100% Zoom', b_, false],
  ['doubleClickToIsolate', 'General', 'Options', 'Double Click To Isolate', b_, true], ['transformPatternTiles', 'General', 'Options', 'Transform Pattern Tiles', b_, false],
  ['scaleCorners', 'General', 'Options', 'Scale Corners', b_, false], ['scaleStrokes', 'General', 'Options', 'Scale Strokes & Effects', b_, false],
  ['zoomWithMouseWheel', 'General', 'Options', 'Zoom with Mouse Wheel', b_, false], ['japaneseCropMarks', 'General', 'Options', 'Use Japanese Crop Marks', b_, false],
  ['newArtBasic', 'General', 'Appearance Panel', 'New Art Has Basic Appearance', b_, true], ['constrainProportions', 'General', 'Transform Panel', 'Constrain Width and Height Proportions', b_, false],
  ['selectionTolerance', SA, 'Selection', 'Tolerance', n_(1, 8, 'px'), 3], ['objectSelectionByPathOnly', SA, 'Selection', 'Object Selection by Path Only', b_, false],
  ['snapToPointTolerance', SA, 'Selection', 'Snap to Point', n_(1, 8, 'px'), 2], ['ctrlClickSelectsBehind', SA, 'Selection', 'Command Click to Select Objects Behind', b_, true],
  ['zoomToSelection', SA, 'Selection', 'Zoom to Selection', b_, true], ['moveLockedWithArtboard', SA, 'Selection', 'Move Locked and Hidden Artwork with Artboard', b_, false],
  ['anchorSize', SA, AD, 'Size', i_(1, 7), 3], ['handleStyle', SA, AD, 'Handles', c_([['solid', 'Solid'], ['hollow', 'Hollow'], ['large', 'Large']]), 'solid'],
  ['highlightAnchorsOnHover', SA, AD, 'Highlight anchors on mouse over', b_, true], ['showHandlesMultipleAnchors', SA, AD, 'Show handles when multiple anchors are selected', b_, true],
  ['hideCornerWidgetAbove', SA, AD, 'Hide Corner Widget for angles greater than', n_(0, 180, '°'), 177],
  ['penRubberBand', SA, 'Enable Rubber Band for', 'Pen Tool', b_, true], ['curvatureRubberBand', SA, 'Enable Rubber Band for', 'Curvature Tool', b_, true],
  ['typeSizeIncrement', 'Type', '', 'Size/Leading', l_(0.001, 1296), 2], ['trackingIncrement', 'Type', '', 'Tracking', n_(1, 1000, '/1000 em'), 20],
  ['baselineShiftIncrement', 'Type', '', 'Baseline Shift', l_(0.001, 1296), 2], ['showEastAsianOptions', 'Type', 'Language Options', 'Show East Asian Options', b_, false],
  ['showIndicOptions', 'Type', 'Language Options', 'Show Indic Options', b_, false], ['typeSelectionByPathOnly', 'Type', 'Options', 'Type Object Selection by Path Only', b_, false],
  ['fontNamesInEnglish', 'Type', 'Options', 'Show Font Names in English', b_, true], ['autoSizeAreaType', 'Type', 'Options', 'Auto Size New Area Type', b_, false],
  ['fontPreview', 'Type', 'Options', 'Enable in-menu font previews', b_, true], ['fontPreviewSize', 'Type', 'Options', 'Font Preview Size', c_([['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]), 'medium'],
  ['recentFontsCount', 'Type', 'Options', 'Number of Recent Fonts', i_(1, 15), 10], ['missingGlyphProtection', 'Type', 'Options', 'Enable Missing Glyph Protection', b_, true],
  ['highlightAlternateGlyphs', 'Type', 'Options', 'Highlight Alternate Glyphs', b_, true], ['placeholderText', 'Type', 'Options', 'Fill New Type Objects With Placeholder Text', b_, true],
  ['overrideCharColor', 'Type', 'Graphic Styles', 'Override Character Color', b_, true],
  ['unitsGeneral', 'Units', '', 'General', c_(UNITS), 'points'], ['unitsStroke', 'Units', '', 'Stroke', c_(UNITS), 'points'], ['unitsType', 'Units', '', 'Type', c_(UNITS), 'points'],
  ['unitsAsianType', 'Units', '', 'East Asian Type', c_(UNITS), 'points'], ['numbersWithoutUnitsArePoints', 'Units', '', 'Numbers Without Units Are Points', b_, true],
  ['identifyObjectsBy', 'Units', '', 'Identify Objects By', c_([['objectName', 'Object Name'], ['xmlId', 'XML ID']]), 'objectName'],
  ['guideColor', 'Guides & Grid', 'Guides', 'Color', 'color', '#4affff'], ['guideStyle', 'Guides & Grid', 'Guides', 'Style', c_(LINE), 'lines'],
  ['gridColor', 'Guides & Grid', 'Grid', 'Color', 'color', '#c8c8c8'], ['gridStyle', 'Guides & Grid', 'Grid', 'Style', c_(LINE), 'lines'],
  ['gridlineEvery', 'Guides & Grid', 'Grid', 'Gridline every', l_(1, 16383), 72], ['gridSubdivisions', 'Guides & Grid', 'Grid', 'Subdivisions', i_(1, 1000), 8],
  ['gridsInBack', 'Guides & Grid', 'Grid', 'Grids In Back', b_, true], ['showPixelGrid', 'Guides & Grid', 'Grid', 'Show Pixel Grid (Above 600% Zoom)', b_, true],
  ['patternTileEdgeColor', 'Guides & Grid', 'Pattern Editing', 'Tile Edge Color', 'color', '#4f80ff'],
  ['smartGuideColor', 'Smart Guides', 'Display Options', 'Color', 'color', '#ff4af0'], ['alignmentGuides', 'Smart Guides', 'Display Options', 'Alignment Guides', b_, true],
  ['objectHighlighting', 'Smart Guides', 'Display Options', 'Object Highlighting', b_, true], ['transformToolsGuides', 'Smart Guides', 'Display Options', 'Transform Tools', b_, true],
  ['constructionGuides', 'Smart Guides', 'Display Options', 'Construction Guides', b_, true],
  ['constructionAngles', 'Smart Guides', 'Display Options', 'Angles', c_(['90° & 45° Angles', '30° Angles', '45° Angles', '60° Angles', '90° Angles', '90° & 45° & 30° Angles'].map(x => [x, x])), '90° & 45° Angles'],
  ['anchorPathLabels', 'Smart Guides', 'Display Options', 'Anchor/Path Labels', b_, true], ['measurementLabels', 'Smart Guides', 'Display Options', 'Measurement Labels', b_, true],
  ['spacingGuides', 'Smart Guides', 'Display Options', 'Spacing Guides', b_, true], ['snappingTolerance', 'Smart Guides', '', 'Snapping Tolerance', n_(0, 40, 'pt'), 4],
  ['showSliceNumbers', 'Slices', '', 'Show Slice Numbers', b_, true], ['sliceLineColor', 'Slices', '', 'Line Color', 'color', '#ff3f3f'],
  ['hyphenationLanguage', 'Hyphenation', '', 'Default Language', c_(['English: USA', 'English: UK', 'French', 'German', 'Spanish', 'Italian', 'Dutch', 'Portuguese'].map(x => [x, x])), 'English: USA'],
  ['hyphenationExceptions', 'Hyphenation', '', 'Exceptions (comma separated)', 'text', ''],
  ['pluginsFolder', 'Performance & Storage', 'Plug-ins', 'Additional Plug-ins Folder', 'text', ''], ['scratchPrimary', 'Performance & Storage', 'Scratch Disks', 'Primary', 'text', 'Startup'],
  ['scratchSecondary', 'Performance & Storage', 'Scratch Disks', 'Secondary', 'text', 'None'],
  ['uiBrightness', 'User Interface', '', 'Brightness', c_([['dark', 'Dark'], ['mediumDark', 'Medium Dark'], ['mediumLight', 'Medium Light'], ['light', 'Light']]), 'mediumDark'],
  ['canvasColor', 'User Interface', '', 'Canvas Color', c_([['matchUi', 'Match User Interface Brightness'], ['white', 'White']]), 'matchUi'],
  ['autoCollapseIconPanels', 'User Interface', '', 'Auto-Collapse Iconic Panels', b_, false], ['openDocumentsAsTabs', 'User Interface', '', 'Open Documents As Tabs', b_, true],
  ['largeTabs', 'User Interface', '', 'Large Tabs', b_, false], ['uiScaling', 'User Interface', 'UI Scaling', 'Scale', n_(0.75, 2, '×'), 1],
  ['scaleCursorWithUi', 'User Interface', 'UI Scaling', 'Scale Cursor Proportional to UI', b_, false],
  ['gpuPerformance', 'Performance', 'GPU Performance', 'GPU Performance', b_, true], ['animatedZoom', 'Performance', 'GPU Performance', 'Animated Zoom', b_, true],
  ['historyStates', 'Performance', '', 'History States', i_(5, 1000), 500], ['realTimeDrawing', 'Performance', '', 'Real-time Drawing and Editing', b_, true],
  ['renderThreads', 'Performance', '', 'Render Threads (-1 = Automatic)', i_(-1, 64), -1],
  ['backgroundSave', 'File Handling', '', 'Enable Background Save', b_, true], ['backgroundExport', 'File Handling', '', 'Enable Background Export', b_, true],
  ['autosaveRecovery', 'File Handling', 'Data Recovery', 'Automatically Save Recovery Data', b_, true], ['autosaveInterval', 'File Handling', 'Data Recovery', 'Every (minutes)', i_(1, 60), 2],
  ['recoveryFolder', 'File Handling', 'Data Recovery', 'Folder', 'text', ''], ['recoveryOffForComplex', 'File Handling', 'Data Recovery', 'Turn off Data Recovery for complex documents', b_, false],
  ['recentFilesCount', 'File Handling', 'Files', 'Number of Recent Files to Display', i_(0, 30), 20], ['lowResProxyEps', 'File Handling', 'Files', 'Use Low Resolution Proxy for Linked EPS', b_, false],
  ['antiAliasedBitmaps', 'File Handling', 'Files', 'Display Bitmaps as Anti-aliased Images in Pixel Preview', b_, false],
  ['updateLinks', 'File Handling', 'Files', 'Update Links', c_([['automatically', 'Automatically'], ['manually', 'Manually'], ['askWhenModified', 'Ask When Modified']]), 'askWhenModified'],
  ['templatesFolder', 'File Handling', 'Files', 'Templates Folder', 'text', ''], ['appendConverted', 'File Handling', 'Files', 'Mark Older Files as [Converted] When Opened', b_, true],
  ['useCompression', 'File Handling', 'Files', 'Use Compression', b_, false],
  ['copyAsSvg', 'Clipboard Handling', 'On Copy', 'Include SVG Code', b_, true], ['copyAsPdf', 'Clipboard Handling', 'On Copy', 'PDF', b_, false],
  ['copyAicb', 'Clipboard Handling', 'On Copy', 'Legacy vector clipboard (no transparency)', b_, false],
  ['aicbMode', 'Clipboard Handling', 'On Copy', 'Legacy vector clipboard', c_([['preservePaths', 'Preserve Paths'], ['preserveAppearance', 'Preserve Appearance and Overprints']]), 'preserveAppearance'],
  ['pasteTextFormatting', 'Clipboard Handling', 'On Paste', 'When pasting text', c_([['keep', 'Keep Formatting'], ['plain', 'Keep Plain Text']]), 'keep'],
  ['blackOnScreen', 'Appearance of Black', '', 'On Screen', c_([['accurate', 'Display All Blacks Accurately'], ['rich', 'Display All Blacks as Rich Black']]), 'accurate'],
  ['blackOutput', 'Appearance of Black', '', 'Printing / Exporting', c_([['accurate', 'Output All Blacks Accurately'], ['rich', 'Output All Blacks as Rich Black']]), 'accurate'],
  ['touchWorkspace', 'Devices', '', 'Enable Touch Workspace', b_, true], ['touchGestures', 'Devices', '', 'Enable Touch Gestures', b_, true],
];
const pspec = k => PSPEC.find(s => s[0] === k);
const PDEF = {}; PSPEC.forEach(s => { PDEF[s[0]] = s[5]; });
/* prefscmds.rs:360 validate */
function prefValidate(k, v){
  const sp = pspec(k); if (!sp) throw new Error(`unknown preference \`${k}\``);
  const kind = sp[4], n = () => typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v.trim()) : NaN);
  if (kind === 'bool'){ if (typeof v === 'boolean') return v; if (v === 'true' || v === 'false') return v === 'true'; throw new Error(`\`${k}\` must be true or false`); }
  if (kind === 'color'){ const h = String(v || '').replace(/^#/, ''); if (/^[0-9a-f]{6}$/i.test(h)) return '#' + h.toLowerCase(); throw new Error(`\`${k}\` must be a #rrggbb colour`); }
  if (kind === 'text'){ if (typeof v === 'string') return v; throw new Error(`\`${k}\` must be a string`); }
  if (kind[0] === 'choice'){ const s = String(v); const o = kind[1].find(x => x[0].toLowerCase() === s.toLowerCase() || x[1].toLowerCase() === s.toLowerCase()); if (o) return o[0]; throw new Error(`\`${k}\` must be one of ${kind[1].map(x => x[0]).join(', ')}`); }
  const x = n();
  if (!isFinite(x)) throw new Error(`\`${k}\` must be a number`);
  if (kind[0] === 'int'){ if (Math.floor(x) !== x || x < kind[1] || x > kind[2]) throw new Error(`\`${k}\` must be a whole number between ${kind[1]} and ${kind[2]} (got ${x})`); return x; }
  if (x < kind[1] || x > kind[2]) throw new Error(`\`${k}\` must be between ${kind[1]} and ${kind[2]} (got ${x})`);
  return x;
}
const Prefs = AE.prefs = {
  values:Object.assign({}, PDEF, LS.get('dlcanvas.ai.prefs', {})),
  get(k){ return this.values[k] === undefined ? PDEF[k] : this.values[k]; },
  set(values){ const next = Object.assign({}, this.values); for (const [k, v] of Object.entries(values)) next[k] = prefValidate(k, v); this.values = next; LS.set('dlcanvas.ai.prefs', next); },
  reset(cat){ PSPEC.forEach(s => { if (!cat || s[1].toLowerCase() === String(cat).toLowerCase()) this.values[s[0]] = s[5]; }); LS.set('dlcanvas.ai.prefs', this.values); },
  list(){ return PSPEC.map(s => { const o = {key:s[0], category:s[1], section:s[2], label:s[3], value:this.get(s[0])}; const k = s[4];
    if (k === 'bool' || k === 'color' || k === 'text') o.kind = k; else if (k[0] === 'choice'){ o.kind = 'choice'; o.options = k[1].map(x => x[0]); } else { o.kind = k[0] === 'int' ? 'integer' : 'number'; o.min = k[1]; o.max = k[2]; if (k[0] === 'num') o.unit = k[3]; } return o; }); },
  specs:PSPEC, categories:PCATS
};
reg('ai.prefs.get', {params:'{key?} → 一项首选项的值，或 {prefs:{…全部…}}'}, p => {
  if (p.key !== undefined){ if (!pspec(p.key)) return fail('ai.prefs.get', `unknown preference \`${p.key}\``); return {ok:true, key:p.key, value:Prefs.get(p.key)}; }
  return {ok:true, prefs:Object.assign({}, Prefs.values)};
});
reg('ai.prefs.set', {params:'{key, value} 或 {values:{key:value,…}} 设首选项（照 ai.prefs.list 的范围验；有一项不对就全部不改）→ {key:新值…}'}, p => {
  const values = Object.assign({}, p.values || {}); if (p.key !== undefined){ if (p.value === undefined) return fail('ai.prefs.set', 'missing `value`'); values[p.key] = p.value; }
  if (!Object.keys(values).length) return fail('ai.prefs.set', 'give {key, value} or {values}');
  try { Prefs.set(values); } catch(e){ return fail('ai.prefs.set', e.message); }
  const out = {ok:true}; Object.keys(values).forEach(k => { out[k] = Prefs.get(k); }); return out;
});
reg('ai.prefs.reset', {params:'{category?} 一个分类（或全部）回预设 → {prefs}'}, p => {
  if (p.category && !PCATS.some(c => c.toLowerCase() === String(p.category).toLowerCase())) return fail('ai.prefs.reset', `unknown category \`${p.category}\``);
  Prefs.reset(p.category); return {ok:true, prefs:Object.assign({}, Prefs.values)};
});
reg('ai.prefs.list', {params:'{} → [{key, category, section, label, kind, value, min?, max?, unit?, options?}] 每一项首选项'}, () => ({ok:true, prefs:Prefs.list()}));
reg('ai.edit.preferences', {params:'{category?} 编辑 ▸ 首选项…：开对话框（左边分类、右边栏位；确定＝ai.prefs.set）→ {ok, dialog}'}, p => { openPrefsDialog(p.category); return {ok:true, dialog:'preferences'}; });

/* ═════════════ 键盘快捷键（ui-egui/src/shortcut_editor.rs）═════════════
   覆写存 localStorage「dlcanvas.ai.shortcuts」{set, overrides:{菜单项 id: "Ctrl+…"|""（拿掉）}}，套用＝改 MenuTrees.ai 里那一项的 key：
   菜单上显示的、以及照 MenuTrees 分派的键（本档的编辑菜单、ai-select、ai-view）都跟着变。工具的快捷键归工具栏管（这里没接）。 */
const SC_PRESETS = ['VectorCraft Defaults', 'Classic Defaults'], SC_CUSTOM = 'Custom';
const KEYNAME = c => /^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5) : ({BracketLeft:'[', BracketRight:']', Semicolon:';', Quote:"'", Equal:'=', Minus:'-', Comma:',', Period:'.', Slash:'/', Backslash:'\\', Backquote:'`'})[c] || null;
/* 正规写法：Ctrl+Alt+Shift+键（单字母大写） */
function normChord(s){
  if (typeof s !== 'string' || !s.trim()) return null;
  const parts = s.replace(/Cmd|Command|Meta/gi, 'Ctrl').split('+').map(x => x.trim()).filter(Boolean); let key = parts.pop(); if (!key) return null;
  const mods = parts.map(m => m.toLowerCase());
  if (mods.some(m => !['ctrl', 'alt', 'shift', 'option'].includes(m))) return null;
  if (key.length === 1) key = key.toUpperCase();
  else if (!/^(F\d{1,2}|Delete|Backspace|Enter|Tab|Escape|Space|Home|End|PageUp|PageDown|Insert|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Up|Down|Left|Right|Comma|Period)$/i.test(key)) return null;
  else key = key[0].toUpperCase() + key.slice(1);
  return [mods.includes('ctrl') ? 'Ctrl' : '', (mods.includes('alt') || mods.includes('option')) ? 'Alt' : '', mods.includes('shift') ? 'Shift' : '', key].filter(Boolean).join('+');
}
function chordOf(e){
  const k = KEYNAME(e.code) || (e.key && e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (!k || ['Control', 'Shift', 'Alt', 'Meta', 'Escape'].includes(k)) return null;
  return normChord([(e.ctrlKey || e.metaKey) ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', k].filter(Boolean).join('+'));
}
const Short = AE.shortcuts = {
  state:Object.assign({set:SC_PRESETS[0], overrides:{}}, LS.get('dlcanvas.ai.shortcuts', {})),
  /* 编辑器列的项目：AI 菜单树里每个有 id 的项（shortcut_editor.rs:236 entries） */
  entries(){
    const out = [], seen = new Set();
    if (!window.MenuTrees) return out;
    MenuTrees.walk('ai', (it, path) => {
      if (!it.id || it.sep || it.sub || seen.has(it.id)) return; seen.add(it.id);
      if (it._defKey === undefined) it._defKey = it.key || '';
      const top = MenuTrees.ai[path[0]], names = [top ? Menubar.name(top) : path[0]].concat(path.slice(1).map(x => Menubar.name(x)));
      out.push({key:it.id, label:Menubar.name(it), group:names.join(' › '), item:it});
    });
    return out;
  },
  entry(id){ return this.entries().find(e => e.key === id) || null; },
  defaultOf(id){ const e = this.entry(id); return e ? (normChord(e.item._defKey) || null) : null; },
  effectiveIn(ov, id){ if (ov[id] !== undefined) return ov[id] === '' ? null : ov[id]; return this.defaultOf(id); },
  conflictsWith(ov, chord, except){ const n = normChord(chord); if (!n) return []; return this.entries().filter(e => e.key !== except && this.effectiveIn(ov, e.key) === n).map(e => e.key); },
  allConflicts(ov){ const by = {}; this.entries().forEach(e => { const c = this.effectiveIn(ov, e.key); if (c) (by[c] = by[c] || []).push(e.key); }); return Object.entries(by).filter(([, v]) => v.length > 1).map(([shortcut, ids]) => ({shortcut, ids})); },
  setOrClear(ov, id, v){ const d = this.defaultOf(id) || ''; const val = v ? (normChord(v) || v) : ''; if (val === d) delete ov[id]; else ov[id] = val; },
  /* shortcut_editor.rs:297 assign：冲突的 force 才拿掉别人的，否则报错 */
  assign(ov, id, chord, force){
    if (!this.entry(id)) throw new Error(`unknown command \`${id}\``);
    if (chord === null || chord === undefined || chord === ''){ this.setOrClear(ov, id, ''); return []; }
    const c = normChord(chord); if (!c) throw new Error(`can't parse shortcut \`${chord}\``);
    const clash = this.conflictsWith(ov, c, id);
    if (clash.length && !force) throw new Error(`${c} is already used by ${clash.map(k => (this.entry(k) || {}).label || k).join(', ')}`);
    clash.forEach(k => this.setOrClear(ov, k, ''));
    this.setOrClear(ov, id, c);
    return clash;
  },
  apply(){ const ov = this.state.overrides || {}; this.entries().forEach(e => { const v = this.effectiveIn(ov, e.key); e.item.key = v || undefined; if (!v) delete e.item.key; }); },
  save(){ LS.set('dlcanvas.ai.shortcuts', this.state); this.apply(); }
};
reg('ai.shortcuts.list', {params:'{query?} → [{id, label, group, shortcut, default, overridden}] AI 菜单每一项的快捷键'}, p => {
  const q = String(p.query || '').toLowerCase(), ov = Short.state.overrides;
  return {ok:true, entries:Short.entries().filter(e => !q || e.label.toLowerCase().includes(q) || e.key.toLowerCase().includes(q)).map(e => ({id:e.key, label:e.label, group:e.group, shortcut:Short.effectiveIn(ov, e.key), default:Short.defaultOf(e.key), overridden:ov[e.key] !== undefined}))};
});
reg('ai.shortcuts.set', {params:'{id, shortcut:"Ctrl+Alt+K"|""（拿掉）|null（回预设）, force?:false（true＝从冲突的项拿掉）} 改一项的快捷键（马上生效、记住）→ {id, shortcut, removedFrom}'}, p => {
  const ov = Object.assign({}, Short.state.overrides); let removed = [];
  try { if (p.shortcut === null) delete ov[p.id]; else removed = Short.assign(ov, p.id, p.shortcut, !!p.force); } catch(e){ return fail('ai.shortcuts.set', e.message); }
  Short.state = {set:SC_CUSTOM, overrides:ov}; Short.save();
  return {ok:true, id:p.id, shortcut:Short.effectiveIn(ov, p.id), removedFrom:removed};
});
reg('ai.shortcuts.conflicts', {params:'{} → [{shortcut, ids}] 同一个键给了两项以上的'}, () => ({ok:true, conflicts:Short.allConflicts(Short.state.overrides)}));
reg('ai.shortcuts.reset', {params:'{} 全部回预设'}, () => { Short.state = {set:SC_PRESETS[0], overrides:{}}; Short.save(); return {ok:true}; });
reg('ai.shortcuts.preset', {params:`{name:${SC_PRESETS.map(x => '"' + x + '"').join('|')}} 套用预设组（两组都是预设键，原码同）`}, p => {
  const n = String(p.name || '').replace('Illustrator Defaults', 'Classic Defaults');
  if (!SC_PRESETS.includes(n)) return fail('ai.shortcuts.preset', `unknown preset (one of ${SC_PRESETS.join(', ')})`);
  Short.state = {set:n, overrides:{}}; Short.save(); return {ok:true};
});
reg('ai.shortcuts.export', {params:'{download?=true} → {format:"dilin-shortcuts", version:1, set, overrides}（顺手下载成 JSON 档）'}, p => {
  const v = {format:'dilin-shortcuts', version:1, set:Short.state.set, overrides:Object.assign({}, Short.state.overrides)};
  if (p.download !== false && typeof download === 'function') download(new Blob([JSON.stringify(v, null, 2)], {type:'application/json'}), 'Dilin Canvas Shortcuts.json');
  return Object.assign({ok:true}, v);
});
reg('ai.shortcuts.import', {params:'{data:{overrides:{…}, set?}} 读进一组快捷键（shortcut_editor.rs:351 import_json）'}, p => {
  const d = p.data, o = d && d.overrides;
  if (!o || typeof o !== 'object') return fail('ai.shortcuts.import', 'not a VectorCraft shortcut set (missing `overrides`)');
  const out = {};
  for (const [k, v] of Object.entries(o)){ if (typeof v !== 'string') return fail('ai.shortcuts.import', `shortcut for \`${k}\` must be a string`); if (v && !normChord(v)) return fail('ai.shortcuts.import', `can't parse shortcut \`${v}\` for \`${k}\``); out[k] = v ? normChord(v) : ''; }
  Short.state = {set:String(d.set || SC_CUSTOM).replace('Illustrator Defaults', 'Classic Defaults'), overrides:out}; Short.save(); return {ok:true, overrides:Object.keys(out).length};
});
reg('ai.edit.keyboardShortcuts', {params:'{} 编辑 ▸ 键盘快捷键…：开对话框（搜寻、点一项再按键录、清除、回预设、冲突提示、预设组、汇出／汇入；确定才生效）→ {ok, dialog}'}, () => { openShortcutsDialog(); return {ok:true, dialog:'shortcuts'}; });

/* ═════════════ 对话框框架（样式写在本档注入；背板带 .aidlg-back ⇒ ai-select／ai-view 的快捷键会让开）═════════════
   spec：{kind, title, state, render(body, st, ui), buttons:[{id, label, primary?, run(st)}], preview?(st) → [cmd, params]|null, width?}
   有 preview 的：开框时拍一张快照，每次改栏位＝退回快照再跑那条命令（不进历史）；确定＝退回快照再 CMD.run（一步历史）；取消＝退回快照。
   给测试与 agent：AiEdit.dlg.state()／set(k, v)／press(id)／kind()／close()。 */
const CSS = `
.aie-back{position:fixed;inset:0;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center;z-index:9999;font:13px sans-serif}
.aie-box{background:#2b2f36;color:#e6e8eb;padding:14px 18px;border-radius:6px;min-width:300px;max-width:92vw;max-height:90vh;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.5)}
.aie-box .hd{font-weight:bold;margin-bottom:10px;display:flex;align-items:center;gap:10px}
.aie-box .hd .sp{flex:1}
.aie-box .sh{color:#8a93a0;font-size:12px;margin:10px 0 4px}
.aie-box .row{display:flex;align-items:center;gap:8px;margin:5px 0}
.aie-box .row > span.l{color:#aab0ba;min-width:96px}
.aie-box input[type=text],.aie-box input[type=number],.aie-box select,.aie-box textarea{background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:3px 6px;box-sizing:border-box}
.aie-box input[type=number]{width:72px}.aie-box input[type=text]{width:200px}
.aie-box input[type=range]{width:180px}
.aie-box input[type=color]{width:34px;height:22px;padding:0;border:1px solid #444a54;background:none}
.aie-box label.ck{display:inline-flex;gap:5px;align-items:center;margin-right:12px}
.aie-box label.ck.off{opacity:.45}
.aie-box button{background:#3a404a;color:#e6e8eb;border:1px solid #555c68;border-radius:3px;padding:3px 10px;cursor:pointer}
.aie-box button.pri{background:#2f7fd8;border-color:#2f7fd8;color:#fff}
.aie-box button:disabled{opacity:.4;cursor:default}
.aie-box button.on{background:#2f7fd8}
.aie-box .ft{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.aie-box .err{color:#ff8a80;font-size:12px;margin-top:6px;min-height:0}
.aie-box .msg{color:#9fd39a;font-size:12px;margin-top:6px}
.aie-box .list{border:1px solid #444a54;background:#1e2126;border-radius:3px;max-height:260px;overflow:auto}
.aie-box .list .it{padding:3px 8px;cursor:pointer;display:flex;gap:8px;align-items:center}
.aie-box .list .it.sel{background:#2f5f98}
.aie-box .chip{display:inline-block;height:18px;border:1px solid #666;vertical-align:middle;cursor:pointer}
.aie-box .rrow{display:flex;align-items:center;gap:6px;padding:2px 4px}
.aie-box .rrow.sel{background:#2f5f98}
.aie-box .rrow .cur{display:flex;width:230px;gap:1px}
.aie-box .rrow .arr{width:40px;text-align:center;cursor:pointer;color:#cfd3da}
.aie-box .rrow.ex .arr{color:#6a717c}
.aie-box .rrow.ex .new{opacity:.35}
.aie-box .tabs button{border-radius:3px 3px 0 0;margin-right:2px}
.aie-box .side{display:flex;gap:14px}
.aie-box .cats{min-width:190px}
.aie-box .ctx{background:#1e2126;border:1px solid #444a54;padding:4px 8px;border-radius:3px;min-height:20px;max-width:420px;white-space:pre-wrap}
.aie-box .ctx b{color:#ff8a80}
.aie-box table.sc{border-collapse:collapse;width:100%}.aie-box table.sc td{padding:2px 6px;border-bottom:1px solid #353a43}
.aie-box table.sc tr.sel td{background:#2f5f98}.aie-box table.sc tr.ov td.k{color:#ffd27a}`;
function ensureStyle(){ if (!document.getElementById('aieStyle')){ const s = document.createElement('style'); s.id = 'aieStyle'; s.textContent = CSS; document.head.appendChild(s); } }
const h = (tag, attrs, kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})){
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'style') e.style.cssText = v;
    else if (v === true) e.setAttribute(k, ''); else if (v !== false && v !== undefined && v !== null) e.setAttribute(k, v);
  }
  (kids || []).forEach(c => { if (c !== null && c !== undefined) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return e;
};
const Dlg = AE.dlg = {
  cur:null,
  kind(){ return this.cur ? this.cur.spec.kind : null; },
  state(){ return this.cur ? this.cur.st : null; },
  open(spec){
    this.close(); ensureStyle();
    const back = h('div', {class:'aie-back aidlg-back', id:'aiEditDlg', 'data-kind':spec.kind});
    const box = h('div', {class:'aie-box', style:spec.width ? `min-width:${spec.width}px` : ''});
    back.appendChild(box); document.body.appendChild(back);
    const cur = this.cur = {spec, st:spec.state, back, box, snap:spec.preview ? History.snap() : null};
    back.addEventListener('pointerdown', e => { if (e.target === back) this.cancel(); });
    /* 键盘：焦点在框里、或点了框里不能聚焦的地方（焦点落回 body）都算——挂 window 捕获，接了就停传（工具与快捷键都不会收到） */
    cur.onKey = e => {
      if (this.cur !== cur) return;
      const t = e.target;
      if (!(back.contains(t) || t === document.body || t === document.documentElement)) return;
      e.stopPropagation();
      if (cur.capture && cur.capture(e)) return;
      if (e.key === 'Escape'){ e.preventDefault(); this.cancel(); }
      else if (e.key === 'Enter' && !/textarea|select/i.test(e.target.tagName) && !(e.target.type === 'button' || e.target.tagName === 'BUTTON')){ const b = spec.buttons.find(x => x.primary); if (b){ e.preventDefault(); if (e.target.blur) e.target.blur(); this.press(b.id); } }
    };
    window.addEventListener('keydown', cur.onKey, true);
    this.render(); this.preview();
    const f = box.querySelector('input[type=text],input[type=number],select'); if (f){ f.focus(); if (f.select) f.select(); }
    return back;
  },
  render(){
    const c = this.cur; if (!c) return;
    const {spec, st, box} = c;
    const keep = document.activeElement && box.contains(document.activeElement) ? document.activeElement.getAttribute('data-k') : null;
    box.innerHTML = '';
    box.appendChild(h('div', {class:'hd'}, [h('span', {text:typeof spec.title === 'function' ? spec.title(st) : T(spec.title)}), h('span', {class:'sp'}), ...(spec.head ? [spec.head(st, this.ui())] : [])]));
    const body = h('div', {class:'bd'}); box.appendChild(body);
    spec.render(body, st, this.ui());
    box.appendChild(h('div', {class:'err', 'data-role':'err', text:c.err || ''}));
    if (c.msg) box.appendChild(h('div', {class:'msg', 'data-role':'msg', text:c.msg}));
    const ft = h('div', {class:'ft'});
    spec.buttons.forEach(b => ft.appendChild(h('button', {class:b.primary ? 'pri' : '', 'data-act':b.id, text:T(b.label), disabled:b.disabled ? !!b.disabled(st) : false, onclick:() => this.press(b.id)})));
    box.appendChild(ft);
    if (keep){ const e = box.querySelector(`[data-k="${keep}"]`); if (e){ e.focus(); } }
  },
  /* 改了栏位：structural＝要重画框（选单、勾选、按钮）；文字／滑杆只更新状态 */
  changed(structural){ const c = this.cur; if (!c) return; c.err = ''; if (c.spec.onChange) c.spec.onChange(c.st); if (structural) this.render(); this.preview(); },
  preview(){
    const c = this.cur; if (!c || !c.snap || !c.spec.preview) return;
    History.restoreInPlace(c.snap);
    const pv = c.spec.preview(c.st);
    if (pv && c.st.preview !== false){ try { const r = AE.raw[pv[0]](pv[1]); c.err = (r && r.ok === false) ? r.error : ''; } catch(e){ c.err = String(e.message || e); } }
    redraw();
  },
  press(id){
    const c = this.cur; if (!c) return null;
    const b = c.spec.buttons.find(x => x.id === id) || (c.spec.extra || {})[id]; if (!b) return null;
    if (b.disabled && b.disabled(c.st)) return null;
    let r; try { r = b.run(c.st); } catch(e){ r = {ok:false, error:String(e.message || e)}; }
    if (r && r.ok === false){ if (this.cur === c){ c.err = r.error || ''; this.render(); } return r; }
    if (r && r.keep){ if (this.cur === c){ c.msg = r.msg || ''; this.render(); } return r; }
    if (this.cur === c) this.close();
    redraw();
    return r;
  },
  /* 确定：有预览的先退回快照，再走 CMD.run（一步历史） */
  commit(cmd, params){
    const c = this.cur; if (c && c.snap) History.restoreInPlace(c.snap);
    let r; try { r = CMD.run(cmd, params); } catch(e){ r = {ok:false, error:String(e.message || e)}; }
    if (r && r.ok === false && c && c.snap){ this.preview(); }
    else if (c) c.snap = null;                                      // 已经提交：关框时别再退回
    return r;
  },
  cancel(){ const c = this.cur; if (!c) return; if (c.snap) History.restoreInPlace(c.snap); c.snap = null; this.close(); redraw(); },
  close(){ const c = this.cur; if (c){ if (c.snap) History.restoreInPlace(c.snap); window.removeEventListener('keydown', c.onKey, true); c.back.remove(); this.cur = null; } },
  set(k, v){ const c = this.cur; if (!c) return false; c.st[k] = v; this.changed(true); return true; },
  /* 小工具 */
  ui(){
    const D = this, st = () => D.cur.st;
    return {
      row(label, ...els){ return h('div', {class:'row'}, [label !== null ? h('span', {class:'l', text:T(label)}) : null, ...els]); },
      head(label){ return h('div', {class:'sh', text:T(label)}); },
      num(k, o){ o = o || {}; return h('input', {type:'number', 'data-k':k, value:st()[k], min:o.min, max:o.max, step:o.step || 'any',
        onchange:e => { let v = parseFloat(e.target.value); if (!isFinite(v)) v = o.def !== undefined ? o.def : 0; if (o.min !== undefined) v = Math.max(o.min, v); if (o.max !== undefined) v = Math.min(o.max, v); st()[k] = v; D.changed(!!o.structural); }}); },
      text(k, o){ o = o || {}; return h('input', {type:'text', 'data-k':k, value:st()[k] == null ? '' : st()[k], style:o.width ? `width:${o.width}px` : '',
        oninput:e => { st()[k] = e.target.value; if (o.live) D.changed(false); }, onchange:e => { st()[k] = e.target.value; D.changed(!!o.structural); }}); },
      check(k, label, o){ o = o || {}; const dis = !!o.disabled; return h('label', {class:'ck' + (dis ? ' off' : '')}, [h('input', {type:'checkbox', 'data-k':k, checked:!!st()[k], disabled:dis, onchange:e => { st()[k] = e.target.checked; D.changed(true); }}), h('span', {text:T(label)})]); },
      select(k, opts, o){ o = o || {}; const s = h('select', {'data-k':k, onchange:e => { st()[k] = o.number ? +e.target.value : e.target.value; D.changed(true); }});
        opts.forEach(([v, l]) => s.appendChild(h('option', {value:v, text:o.raw ? l : T(l)}))); s.value = st()[k] == null ? '' : String(st()[k]); return s; },
      slider(k, min, max, o){ o = o || {};
        const n = h('input', {type:'number', 'data-k':k, value:st()[k], min, max, step:o.step || 1});
        const r = h('input', {type:'range', 'data-k':k + '.range', value:st()[k], min, max, step:o.step || 1});
        r.addEventListener('input', () => { st()[k] = +r.value; n.value = r.value; D.changed(false); });
        n.addEventListener('change', () => { let v = clamp(parseFloat(n.value) || 0, min, max); st()[k] = v; n.value = v; r.value = v; D.changed(false); });
        return h('span', {}, [r, n, o.unit ? h('span', {text:' ' + o.unit}) : null]); },
      button(label, fn, o){ o = o || {}; return h('button', {'data-act':o.id, class:o.on ? 'on' : '', title:o.title ? T(o.title) : '', text:T(label), disabled:!!o.disabled, onclick:() => { fn(); }}); }
    };
  }
};

/* ── 查找和替换…（menus.rs:1530 是参数对话框；这里照 Illustrator 的「尋找及取代」做：尋找／取代／取代並尋找／全部取代／完成）── */
function openFindDialog(p){
  const lf = AE.lastFind();
  Dlg.open({kind:'findReplace', title:'aie.findReplace', state:{find:p && p.find !== undefined && p.find !== '' ? p.find : lf.find, replace:p && p.replace !== undefined ? p.replace : lf.replace, matchCase:p && p.matchCase !== undefined ? !!p.matchCase : lf.matchCase, wholeWord:p && p.wholeWord !== undefined ? !!p.wholeWord : lf.wholeWord},
    render(body, st, ui){
      body.appendChild(ui.row('aie.find', ui.text('find', {width:240})));
      body.appendChild(ui.row('aie.replaceWith', ui.text('replace', {width:240})));
      body.appendChild(h('div', {class:'row'}, [ui.check('matchCase', 'aie.matchCase'), ui.check('wholeWord', 'aie.wholeWord')]));
    },
    buttons:[
      {id:'find', label:'aie.findBtn', primary:true, run(st){ const r = CMD.run('ai.edit.findNext', {find:st.find, matchCase:st.matchCase, wholeWord:st.wholeWord}); if (r.ok === false) return r; return {keep:true, msg:r.id ? T('aie.foundIn').replace('{name}', Doc.byId(r.id).name) : T('aie.notFound')}; }},
      {id:'replace', label:'aie.replaceBtn', disabled:() => !(window.AiSel && AiSel.text && AiSel.text.length), run(st){
        const id = AiSel.text[0]; const r = CMD.run('ai.edit.findReplace', {find:st.find, replace:st.replace, matchCase:st.matchCase, wholeWord:st.wholeWord, ids:[id]});
        return r.ok === false ? r : {keep:true, msg:T('aie.replaced').replace('{n}', r.count)}; }},
      {id:'replaceFind', label:'aie.replaceFind', disabled:() => !(window.AiSel && AiSel.text && AiSel.text.length), run(st){
        const id = AiSel.text[0]; const r = CMD.run('ai.edit.findReplace', {find:st.find, replace:st.replace, matchCase:st.matchCase, wholeWord:st.wholeWord, ids:[id]}); if (r.ok === false) return r;
        const n = CMD.run('ai.edit.findNext', {find:st.find, matchCase:st.matchCase, wholeWord:st.wholeWord});
        return {keep:true, msg:T('aie.replaced').replace('{n}', r.count) + (n.id ? '' : ' · ' + T('aie.notFound'))}; }},
      {id:'replaceAll', label:'aie.replaceAll', run(st){ const r = CMD.run('ai.edit.findReplace', {find:st.find, replace:st.replace, matchCase:st.matchCase, wholeWord:st.wholeWord}); return r.ok === false ? r : {keep:true, msg:T('aie.replaced').replace('{n}', r.count)}; }},
      {id:'done', label:'aie.done', run:() => ({ok:true})}
    ]});
}
reg('ai.edit.findReplace.dialog', {params:'{find?, replace?, matchCase?, wholeWord?} 编辑 ▸ 查找和替换…：开对话框（查找＝ai.edit.findNext；替换＝只换当前找到的那个文字物件；全部替换＝ai.edit.findReplace）→ {ok, dialog}'}, p => { openFindDialog(p); return {ok:true, dialog:'findReplace'}; });

/* ── 拼写检查…（Illustrator：准备开始 → 开始；不认得的字＋建议；忽略／全部忽略／更改／全部更改／添加／完成；选项）── */
function openSpellDialog(){
  const st = {started:false, cur:null, to:'', skip:[], done:false, showOpts:false, sug:-1};
  const next = () => {
    const probs = Spell.problems(true).filter(q => !st.skip.some(s => s.layerId === q.layerId && s.start === q.start && s.word === q.word));
    const order = id => Doc.index(id);
    const after = q => !st.pos || order(q.layerId) > order(st.pos.layerId) || (q.layerId === st.pos.layerId && q.start >= st.pos.start);
    const q = probs.find(after) || null;
    st.cur = q; st.done = !q; st.to = q ? (q.suggestions[0] !== undefined ? q.suggestions[0] : q.word) : ''; st.sug = q && q.suggestions.length ? 0 : -1;
    if (q){ st.pos = {layerId:q.layerId, start:q.start}; setSelection(null, [], [q.layerId]); }
    Dlg.render(); redraw();
  };
  Dlg.open({kind:'spellCheck', title:'aie.spellCheck', state:st, width:460,
    render(body, s, ui){
      if (!s.started){ body.appendChild(h('div', {class:'row', text:T('aie.readyToStart')})); }
      else if (s.done){ body.appendChild(h('div', {class:'row', 'data-role':'complete', text:T('aie.spellDone')})); }
      else {
        const q = s.cur, L = Doc.byId(q.layerId), txt = L ? L.data.text : '';
        body.appendChild(ui.head(q.kind === 'repeated' ? 'aie.repeatedWord' : q.kind === 'uncapitalized' ? 'aie.uncapitalized' : 'aie.unknownWord'));
        const a = Math.max(0, q.start - 40), b = Math.min(txt.length, q.end + 40);
        const ctx = h('div', {class:'ctx', 'data-role':'word'}); ctx.appendChild(document.createTextNode((a > 0 ? '…' : '') + txt.slice(a, q.start))); ctx.appendChild(h('b', {text:txt.slice(q.start, q.end)})); ctx.appendChild(document.createTextNode(txt.slice(q.end, b) + (b < txt.length ? '…' : '')));
        body.appendChild(ctx);
        body.appendChild(ui.head('aie.suggestions'));
        const list = h('div', {class:'list', 'data-role':'suggestions', style:'max-height:140px'});
        (q.suggestions.length ? q.suggestions : []).forEach((w, i) => list.appendChild(h('div', {class:'it' + (i === s.sug ? ' sel' : ''), text:w === '' ? T('aie.deleteWord') : w, onclick:() => { s.sug = i; s.to = w; Dlg.render(); }})));
        if (!q.suggestions.length) list.appendChild(h('div', {class:'it', style:'color:#8a93a0', text:T('aie.noSuggestions')}));
        body.appendChild(list);
        body.appendChild(ui.row('aie.changeTo', ui.text('to', {width:220})));
        body.appendChild(h('div', {class:'row'}, [
          ui.button('aie.ignore', () => Dlg.press('ignore'), {id:'ignore'}), ui.button('aie.ignoreAll', () => Dlg.press('ignoreAll'), {id:'ignoreAll'}),
          ui.button('aie.change', () => Dlg.press('change'), {id:'change'}), ui.button('aie.changeAll', () => Dlg.press('changeAll'), {id:'changeAll'}),
          ui.button('aie.add', () => Dlg.press('add'), {id:'add', disabled:q.kind !== 'unknown'})]));
      }
      body.appendChild(h('div', {class:'row'}, [ui.button(s.showOpts ? 'aie.optionsHide' : 'aie.options', () => { s.showOpts = !s.showOpts; Dlg.render(); }, {id:'opts'})]));
      if (s.showOpts){
        const o = Spell.opts, ck = (k, l) => h('label', {class:'ck'}, [h('input', {type:'checkbox', 'data-k':'opt.' + k, checked:!!o[k], onchange:e => { CMD.run('ai.edit.spelling.setOptions', {[k]:e.target.checked}); if (s.started) next(); }}), h('span', {text:T(l)})]);
        body.appendChild(ui.head('aie.optFind')); body.appendChild(h('div', {class:'row'}, [ck('repeated', 'aie.optRepeated'), ck('uncapitalized', 'aie.optUncap')]));
        body.appendChild(ui.head('aie.optIgnore')); body.appendChild(h('div', {class:'row'}, [ck('allCaps', 'aie.optAllCaps'), ck('roman', 'aie.optRoman'), ck('numbers', 'aie.optNumbers')]));
      }
    },
    buttons:[
      {id:'start', label:'aie.start', primary:true, disabled:s => s.started && !s.done, run(s){ s.started = true; s.skip = []; s.pos = null; next(); return {keep:true}; }},
      {id:'done', label:'aie.done', run:() => ({ok:true})}
    ],
    extra:{
      ignore:{run(s){ if (!s.cur) return {keep:true}; s.skip.push({layerId:s.cur.layerId, start:s.cur.start, word:s.cur.word}); next(); return {keep:true}; }},
      ignoreAll:{run(s){ if (!s.cur) return {keep:true}; CMD.run('ai.edit.spelling.ignore', {word:s.cur.word}); next(); return {keep:true}; }},
      change:{run(s){ if (!s.cur) return {keep:true}; const r = CMD.run('ai.edit.spelling.change', {layerId:s.cur.layerId, start:s.cur.start, end:s.cur.end, to:s.to}); if (r.ok === false) return r; s.pos = {layerId:s.cur.layerId, start:s.cur.start + s.to.length}; next(); return {keep:true}; }},
      changeAll:{run(s){ if (!s.cur) return {keep:true}; const r = CMD.run('ai.edit.spelling.change', {word:s.cur.word, to:s.to, all:true}); if (r.ok === false) return r; next(); return {keep:true}; }},
      add:{run(s){ if (!s.cur) return {keep:true}; CMD.run('ai.edit.spelling.addWord', {word:s.cur.word}); next(); return {keep:true}; }}
    }});
}
/* ── 编辑自定词典…（Illustrator：字清单＋「字词」栏＋添加／删除／更改／完成）── */
function openDictDialog(){
  const st = {word:'', sel:null};
  Dlg.open({kind:'spellDictionary', title:'aie.editDict', state:st,
    render(body, s, ui){
      const list = h('div', {class:'list', 'data-role':'words', style:'min-width:260px;min-height:160px'});
      Array.from(Spell.custom).sort().forEach(w => list.appendChild(h('div', {class:'it' + (w === s.sel ? ' sel' : ''), 'data-word':w, text:w, onclick:() => { s.sel = w; s.word = w; Dlg.render(); }})));
      body.appendChild(list);
      body.appendChild(ui.row('aie.word', ui.text('word', {width:200})));
      body.appendChild(h('div', {class:'row'}, [
        ui.button('aie.add', () => Dlg.press('add'), {id:'add'}), ui.button('aie.delete', () => Dlg.press('delete'), {id:'delete', disabled:!s.sel}),
        ui.button('aie.change', () => Dlg.press('change'), {id:'change', disabled:!s.sel})]));
    },
    buttons:[{id:'done', label:'aie.done', primary:true, run:() => ({ok:true})}],
    extra:{
      add:{run(s){ const r = CMD.run('ai.edit.spelling.addWord', {word:s.word}); if (r.ok === false) return r; s.sel = Spell.norm(s.word); return {keep:true}; }},
      delete:{run(s){ if (!s.sel) return {keep:true}; const r = CMD.run('ai.edit.spelling.removeWord', {word:s.sel}); s.sel = null; s.word = ''; return r.ok === false ? r : {keep:true}; }},
      change:{run(s){ if (!s.sel || !s.word.trim()) return {keep:true}; CMD.run('ai.edit.spelling.removeWord', {word:s.sel}); const r = CMD.run('ai.edit.spelling.addWord', {word:s.word}); s.sel = Spell.norm(s.word); return r.ok === false ? r : {keep:true}; }}
    }});
}

/* ── 调整饱和度…（dialogs/saturate.rs：强度 −100..100 %，即时预览，确定＝一步历史）── */
function needSel(C){ const t = targets({}); return t.empty ? fail(C, 'nothing selected') : null; }
reg('ai.ui.saturateDialog', {params:'{} 编辑颜色 ▸ 调整饱和度…：开对话框（强度 −100..100 %、即时预览；确定＝ai.edit.colors.saturate）→ {ok, dialog}'}, () => {
  const e = needSel('ai.ui.saturateDialog'); if (e) return e;
  Dlg.open({kind:'saturate', title:'aie.saturate', state:{intensity:0, preview:true},
    render(body, st, ui){ body.appendChild(ui.row('aie.intensity', ui.slider('intensity', -100, 100, {unit:'%'}))); body.appendChild(h('div', {class:'row'}, [ui.check('preview', 'aie.preview')])); },
    preview:st => ['ai.edit.colors.saturate', {intensity:st.intensity}],
    buttons:[{id:'cancel', label:'aie.cancel', run:() => { Dlg.cancel(); return {ok:true}; }}, {id:'ok', label:'aie.ok', primary:true, run:st => Dlg.commit('ai.edit.colors.saturate', {intensity:st.intensity})}]});
  return {ok:true, dialog:'saturate'};
});
/* ── 调整色彩平衡…（dialogs/color_balance.rs：模式（灰度／RGB／CMYK／全局）、各通道 −100..100 %、转换、填色／描边，即时预览）── */
const BAL_MODES = [['gray', 'aie.mGray', [['gray', 'aie.black']]], ['rgb', 'RGB', [['r', 'aie.red'], ['g', 'aie.green'], ['b', 'aie.blue']]],
  ['cmyk', 'CMYK', [['c', 'aie.cyan'], ['m', 'aie.magenta'], ['y', 'aie.yellow'], ['k', 'aie.black']]], ['global', 'aie.mGlobal', [['tint', 'aie.tint']]]];
const balParams = st => { const m = BAL_MODES.find(x => x[0] === st.mode) || BAL_MODES[1], p = {mode:m[0], convert:st.convert, fill:st.fill, stroke:st.stroke}; m[2].forEach(([k]) => { p[k] = st[k]; }); return p; };
reg('ai.ui.colorBalanceDialog', {params:'{} 编辑颜色 ▸ 调整色彩平衡…：开对话框（确定＝ai.edit.colors.adjustBalance，一步历史）→ {ok, dialog}'}, () => {
  const e = needSel('ai.ui.colorBalanceDialog'); if (e) return e;
  Dlg.open({kind:'colorBalance', title:'aie.adjustColors', width:360,
    state:{mode:'rgb', r:0, g:0, b:0, c:0, m:0, y:0, k:0, gray:0, tint:0, convert:false, fill:true, stroke:true, preview:true},
    render(body, st, ui){
      const m = BAL_MODES.find(x => x[0] === st.mode) || BAL_MODES[1];
      body.appendChild(h('div', {class:'row'}, [h('span', {class:'l', text:T('aie.colorMode')}), ui.select('mode', BAL_MODES.map(x => [x[0], x[1]])), ui.check('convert', 'aie.convert', {disabled:st.mode === 'global'})]));
      if (st.mode === 'global') body.appendChild(h('div', {class:'row', style:'color:#8a93a0', text:T('aie.globalNote')}));
      m[2].forEach(([k, l]) => body.appendChild(ui.row(l, ui.slider(k, -100, 100, {unit:'%'}))));
      body.appendChild(h('div', {class:'row'}, [h('span', {class:'l', text:T('aie.adjustOptions')}), ui.check('fill', 'aie.fill'), ui.check('stroke', 'aie.stroke')]));
      body.appendChild(h('div', {class:'row'}, [ui.check('preview', 'aie.preview')]));
    },
    preview:st => ['ai.edit.colors.adjustBalance', balParams(st)],
    buttons:[{id:'cancel', label:'aie.cancel', run:() => { Dlg.cancel(); return {ok:true}; }}, {id:'ok', label:'aie.ok', primary:true, run:st => Dlg.commit('ai.edit.colors.adjustBalance', balParams(st))}]});
  return {ok:true, dialog:'colorBalance'};
});
/* ── 叠印黑色…（menus.rs:1555 参数对话框：添加／移除黑色、百分比、填色／描边、包括 CMY 的黑、包括专色黑）── */
reg('ai.edit.colors.overprintBlack.dialog', {params:'{} 编辑颜色 ▸ 叠印黑色…：开对话框（确定＝ai.edit.colors.overprintBlack）→ {ok, dialog}'}, () => {
  const e = needSel('ai.edit.colors.overprintBlack.dialog'); if (e) return e;
  Dlg.open({kind:'overprintBlack', title:'aie.overprintBlack', state:{remove:'add', percentage:100, fill:true, stroke:true, includeCmyBlacks:false, includeSpotBlacks:false},
    render(body, st, ui){
      body.appendChild(h('div', {class:'row'}, [ui.select('remove', [['add', 'aie.addBlack'], ['remove', 'aie.removeBlack']]), ui.num('percentage', {min:0, max:100, def:100}), h('span', {text:'%'})]));
      body.appendChild(ui.head('aie.applyTo')); body.appendChild(h('div', {class:'row'}, [ui.check('fill', 'aie.fill'), ui.check('stroke', 'aie.stroke')]));
      body.appendChild(ui.head('aie.options')); body.appendChild(h('div', {class:'row'}, [ui.check('includeCmyBlacks', 'aie.inclCmy'), ui.check('includeSpotBlacks', 'aie.inclSpot')]));
    },
    buttons:[{id:'cancel', label:'aie.cancel', run:() => ({ok:true})}, {id:'ok', label:'aie.ok', primary:true, run:st => {
      const r = CMD.run('ai.edit.colors.overprintBlack', {remove:st.remove === 'remove', percentage:st.percentage, fill:st.fill, stroke:st.stroke, includeCmyBlacks:st.includeCmyBlacks, includeSpotBlacks:st.includeSpotBlacks});
      return r.ok === false ? r : r; }}]});
  return {ok:true, dialog:'overprintBlack'};
});

/* ── 重新着色图稿…（dialogs/recolor.rs）── */
const PRESETS = ['Custom', '1 Color Job', '2 Color Job', '3 Color Job', 'Color Library'];
function recolorOpen(p){
  const C = 'ai.ui.recolorDialog';
  const t = targets({}); if (t.empty) return fail(C, 'select artwork (or a colour group) to recolor');
  const assign = Array.isArray(p.colors) ? p.colors.map(Col.value).filter(Boolean).map(c => Key.str(c)) : [];
  const count = fin(+p.colors) && !Array.isArray(p.colors) ? Math.max(1, Math.floor(+p.colors)) : (assign.length ? assign.length : null);
  const limit = p.library === '' ? Libraries.defs[0][0] : (typeof p.library === 'string' ? ((Libraries.find(p.library) || {}).id || '') : '');
  const st = {tab:'assign', rows:[], colors:count, method:'scaleTints', preserveWhite:true, preserveBlack:true, preserveGrays:false, limitTo:limit, rule:'complementary', linked:true, sel:[], seed:0, preview:true, assign, _reduced:null, base:null};
  Dlg.open({kind:'recolor', title:'aie.recolor', state:st, width:560,
    head(s, ui){ return h('span', {}, [h('span', {style:'color:#8a93a0;margin-right:6px', text:T('aie.preset')}), (() => { const sel = h('select', {'data-k':'preset', onchange:e => { setPreset(s, +e.target.value); Dlg.changed(true); }}); PRESETS.forEach((l, i) => sel.appendChild(h('option', {value:i, text:T('aie.pr' + i)}))); sel.value = String(presetOf(s)); return sel; })()]); },
    onChange:s => sync(s),
    render(body, s, ui){
      sync(s);
      body.appendChild(h('div', {class:'tabs row'}, [ui.button('aie.assign', () => { s.tab = 'assign'; Dlg.render(); }, {id:'tabAssign', on:s.tab !== 'edit'}), ui.button('aie.editTab', () => { s.tab = 'edit'; Dlg.render(); }, {id:'tabEdit', on:s.tab === 'edit'})]));
      if (s.tab === 'edit') editTab(body, s, ui); else assignTab(body, s, ui);
      body.appendChild(h('div', {class:'row'}, [ui.check('preview', 'aie.preview')]));
    },
    preview:s => { sync(s); return ['ai.recolor.apply', applyParams(s)]; },
    buttons:[{id:'cancel', label:'aie.cancel', run:() => { Dlg.cancel(); return {ok:true}; }}, {id:'ok', label:'aie.ok', primary:true, run:s => { sync(s); return Dlg.commit('ai.recolor.apply', applyParams(s)); }}]});
  return {ok:true, dialog:'recolor'};
}
function reduceParams(s){ return {colors:s.colors, preserve:{white:s.preserveWhite, black:s.preserveBlack, grays:s.preserveGrays}, limitTo:s.limitTo}; }
/* recolor.rs:128 sync：颜色数／保留／限定库改了就重新分行（在退回快照后的文件上量，免得量到预览的颜色） */
function sync(s){
  const sig = JSON.stringify(reduceParams(s));
  if (s._reduced === sig) return;
  const c = Dlg.cur; if (c && c.snap) History.restoreInPlace(c.snap);
  const r = AE.raw['ai.recolor.reduce'](Object.assign(reduceParams(s), {method:s.method}));
  if (r && r.ok !== false){
    s.rows = r.map.map((row, i) => Object.assign({}, row, s.assign[i] ? {to:s.assign[i]} : {}));
    snapRows(s); s.sel = [];
  }
  s._reduced = sig;
}
function snapRows(s){ if (!s.limitTo) return; const pal = limitPalette({limitTo:s.limitTo}, 'recolor'); s.rows.forEach(r => { const c = Col.value(r.to); if (c) r.to = Key.str(pal.nearest(c)); }); }
function applyParams(s){ return {map:s.rows, method:s.method, limitTo:s.limitTo}; }
function presetOf(s){ if (s.colors >= 1 && s.colors <= 3 && s.method === 'scaleTints') return s.colors; if (s.limitTo) return 4; return 0; }
function setPreset(s, i){ if (i >= 1 && i <= 3){ s.colors = i; s.method = 'scaleTints'; } else if (i === 4 && !s.limitTo) s.limitTo = Libraries.defs[0][0]; }
function chip(c, w, onclick, title){ return h('span', {class:'chip', title:title || '', style:`width:${w}px;background:${Col.hex(c)}`, onclick}); }
function assignTab(body, s, ui){
  const total = s.rows.reduce((n, r) => n + r.from.length, 0);
  body.appendChild(h('div', {class:'row'}, [h('span', {class:'l', text:T('aie.colors')}),
    ui.select('colors', [['', 'aie.auto']].concat(Array.from({length:Math.max(total, s.colors || 0)}, (_, i) => [String(i + 1), String(i + 1)])), {raw:false}),
    h('span', {style:'margin-left:14px;color:#aab0ba', text:T('aie.preserve')}), ui.check('preserveWhite', 'aie.white'), ui.check('preserveBlack', 'aie.black'), ui.check('preserveGrays', 'aie.grays')]));
  const sel = body.querySelector('select[data-k="colors"]'); sel.value = s.colors ? String(s.colors) : '';
  sel.onchange = e => { s.colors = e.target.value ? +e.target.value : null; Dlg.changed(true); };
  body.appendChild(h('div', {class:'row', style:'color:#8a93a0'}, [h('span', {style:'width:236px', text:T('aie.currentColors').replace('{n}', total)}), h('span', {style:'width:40px'}), h('span', {text:T('aie.new')})]));
  const list = h('div', {class:'list', 'data-role':'rows', style:'max-height:240px;min-height:120px'});
  if (!s.rows.length) list.appendChild(h('div', {class:'it', style:'color:#8a93a0', text:T('aie.noColors')}));
  s.rows.forEach((row, i) => {
    const from = row.from.map(Key.color), to = Col.value(row.to) || Col.BLACK, w = Math.max(3, Math.floor(228 / Math.max(from.length, 1)) - 1);
    const pick = e => { const add = e.shiftKey || e.ctrlKey || e.metaKey; const at = s.sel.indexOf(i); if (add){ if (at >= 0) s.sel.splice(at, 1); else s.sel.push(i); } else s.sel = [i]; Dlg.render(); };
    const inp = h('input', {type:'color', value:Col.hex(to), 'data-row':i, onchange:e => { const c = Col.value(e.target.value); row.to = Key.str(Col.keep(to, c)); snapRows(s); Dlg.changed(true); }});
    const hx = h('input', {type:'text', value:Col.hex(to).slice(1), 'data-hex':i, style:'width:66px', onchange:e => { const c = cssRGBA('#' + e.target.value.replace(/^#/, '')); if (c){ row.to = Key.str(Col.keep(to, Col.rgb(c[0], c[1], c[2]))); snapRows(s); } Dlg.changed(true); }});
    list.appendChild(h('div', {class:'rrow' + (s.sel.includes(i) ? ' sel' : '') + (row.exclude ? ' ex' : ''), 'data-row':i}, [
      h('span', {class:'cur', onclick:pick}, from.map((c, j) => chip(c, w, null, row.from[j]))),
      h('span', {class:'arr', 'data-act':'exclude', title:T(row.exclude ? 'aie.includeRow' : 'aie.excludeRow'), text:row.exclude ? '- - -' : '──▶', onclick:() => { row.exclude = !row.exclude; Dlg.changed(true); }}),
      h('span', {class:'new'}, [chip(to, 40, pick, row.to)]), inp, hx]));
  });
  body.appendChild(list);
  const canMerge = s.sel.length > 1, canSplit = s.sel.some(i => s.rows[i] && s.rows[i].from.length > 1);
  body.appendChild(h('div', {class:'row'}, [
    ui.button('aie.merge', () => { merge(s); Dlg.changed(true); }, {id:'merge', disabled:!canMerge, title:'aie.mergeTip'}),
    ui.button('aie.separate', () => { separate(s); Dlg.changed(true); }, {id:'separate', disabled:!canSplit, title:'aie.separateTip'}),
    ui.button('aie.randOrder', () => randomize(s, false), {id:'randOrder', disabled:s.rows.length < 2}),
    ui.button('aie.randSB', () => randomize(s, true), {id:'randSB'}),
    ui.button('aie.reset', () => { s._reduced = null; Dlg.changed(true); }, {id:'reset'})]));
  body.appendChild(ui.row('aie.method', ui.select('method', METHODS.map(m => [m, 'aie.m.' + m]))));
  body.appendChild(ui.row('aie.limitTo', ui.select('limitTo', [['', 'aie.none']].concat(Libraries.list().map(l => [l.id, 'aie.lib.' + l.id])))));
}
function merge(s){ const sel = s.sel.filter(i => i < s.rows.length).sort((a, b) => a - b); if (sel.length < 2) return; const [first, ...rest] = sel; let moved = []; rest.reverse().forEach(i => { moved = s.rows.splice(i, 1)[0].from.concat(moved); }); s.rows[first].from = s.rows[first].from.concat(moved); s.sel = [first]; }
function separate(s){ const out = []; s.rows.forEach((r, i) => { if (s.sel.includes(i) && r.from.length > 1) r.from.forEach(k => out.push({from:[k], to:k})); else out.push(r); }); s.rows = out; s.sel = []; }
function randomize(s, sb){ s.seed++; const r = AE.raw['ai.recolor.randomize']({map:s.rows, order:!sb, saturationBrightness:sb, seed:s.seed}); if (r.ok !== false) s.rows = r.map; snapRows(s); Dlg.changed(true); }
const activeRows = s => s.rows.map((r, i) => i).filter(i => !s.rows[i].exclude && Col.value(s.rows[i].to));
function editTab(body, s, ui){
  const act = activeRows(s); if (s.base === null || !act.includes(s.base)) s.base = act[0] === undefined ? null : act[0];
  body.appendChild(h('div', {class:'row'}, [h('span', {class:'l', text:T('aie.harmony')}), ui.select('rule', HARMONY.map(x => [harmonyId(x[0]), 'aie.h.' + harmonyId(x[0])])),
    ui.button(s.linked ? 'aie.linked' : 'aie.unlinked', () => { s.linked = !s.linked; Dlg.render(); }, {id:'link', on:s.linked})]));
  const sel = body.querySelector('select[data-k="rule"]');
  sel.onchange = e => { s.rule = e.target.value; if (s.base !== null){ const label = (HARMONY.find(x => harmonyId(x[0]) === s.rule) || HARMONY[0])[0], cs = harmonyApply(label, Col.value(s.rows[s.base].to)); [s.base].concat(act.filter(i => i !== s.base)).forEach((i, n) => { const old = Col.value(s.rows[i].to); s.rows[i].to = Key.str(Col.keep(old, cs[n % cs.length])); }); snapRows(s); } Dlg.changed(true); };
  body.appendChild(h('div', {class:'row', 'data-role':'newColors'}, act.map(i => { const c = chip(Col.value(s.rows[i].to), 28, () => { s.base = i; Dlg.render(); }, s.rows[i].to); if (i === s.base) c.style.outline = '2px solid #2f7fd8'; return c; })));
  if (s.base !== null){
    const [hh, ss, vv] = Col.toHsb(Col.value(s.rows[s.base].to));
    s._h = Math.round(hh); s._s = Math.round(ss * 100); s._v = Math.round(vv * 100);
    const mv = () => { const cs = act.map(i => Col.value(s.rows[i].to)), k = act.indexOf(s.base), nw = moveOnWheel(cs, k, [s._h, s._s / 100, s._v / 100], s.linked); act.forEach((i, n) => { if (!Col.eq(nw[n], cs[n])) s.rows[i].to = Key.str(nw[n]); }); snapRows(s); Dlg.preview(); };
    const sl = (k, max, label) => { const r = h('input', {type:'range', min:0, max, step:1, value:s[k], 'data-k':k}); r.addEventListener('input', () => { s[k] = +r.value; mv(); }); r.addEventListener('change', () => Dlg.render()); return ui.row(label, r); };
    body.appendChild(sl('_h', 359, 'aie.hue')); body.appendChild(sl('_s', 100, 'aie.sat')); body.appendChild(sl('_v', 100, 'aie.bright'));
  }
}
reg('ai.ui.recolorDialog', {params:'{colors?:n（n 色作业）|[颜色…]（要指定的新颜色）, library?:色板库 id（""＝第一个库）} 编辑颜色 ▸ 重新着色图稿…：开对话框（指定页：颜色数／保留白黑灰／各行目前→新颜色（点箭头排除、色块与 hex 改新颜色）／合并／分离／随机顺序／随机饱和度亮度／重置／方法／限定为库；编辑页：协调规则、连动、色相饱和度亮度；即时预览；确定＝ai.recolor.apply 一步历史）→ {ok, dialog}'},
  p => recolorOpen(p));

/* ── 首选项…（prefs_dialog.rs：左边分类、右边栏位、重设首选项／确定／取消）── */
function openPrefsDialog(category){
  const cat = PCATS.find(c => category && c.toLowerCase() === String(category).toLowerCase()) || PCATS[0];
  const st = Object.assign({__category:cat}, Prefs.values);
  Dlg.open({kind:'preferences', title:'aie.prefs', state:st, width:720,
    render(body, s, ui){
      const side = h('div', {class:'side'});
      const cats = h('div', {class:'list cats', 'data-role':'cats', style:'max-height:420px'});
      PCATS.forEach(c => cats.appendChild(h('div', {class:'it' + (c === s.__category ? ' sel' : ''), 'data-cat':c, text:T('aie.pc.' + c), onclick:() => { s.__category = c; Dlg.render(); }})));
      const right = h('div', {style:'min-width:420px;max-height:420px;overflow:auto'});
      let sec = null;
      PSPEC.filter(sp => sp[1] === s.__category).forEach(sp => {
        const [k, , section, label, kind] = sp;
        if (section !== sec){ sec = section; if (section) right.appendChild(ui.head(PT(section))); }
        if (kind === 'bool'){ const l = ui.check(k, ''); l.querySelector('span').textContent = PT(label); right.appendChild(h('div', {class:'row'}, [l])); return; }
        let el;
        if (kind === 'color'){ el = h('input', {type:'color', 'data-k':k, value:s[k], onchange:e => { s[k] = e.target.value; }}); }
        else if (kind === 'text') el = ui.text(k, {width:220});
        else if (kind[0] === 'choice'){ el = ui.select(k, kind[1].map(([v, l]) => [v, PT(l)]), {raw:true}); }
        else el = h('span', {}, [ui.num(k, {min:kind[1], max:kind[2], step:kind[0] === 'int' ? 1 : 'any', def:sp[5]}), h('span', {text:' ' + (kind[0] === 'len' ? 'px' : (kind[3] || ''))})]);
        const r = h('div', {class:'row'}, [h('span', {class:'l', style:'min-width:200px', text:PT(label)}), el]); right.appendChild(r);
      });
      side.appendChild(cats); side.appendChild(right); body.appendChild(side);
    },
    buttons:[
      {id:'reset', label:'aie.resetPrefs', run:s => { const d = {}; PSPEC.forEach(sp => { d[sp[0]] = sp[5]; }); Object.assign(s, d); return {keep:true}; }},
      {id:'cancel', label:'aie.cancel', run:() => ({ok:true})},
      {id:'ok', label:'aie.ok', primary:true, run:s => { const v = {}; PSPEC.forEach(sp => { v[sp[0]] = s[sp[0]]; }); return CMD.run('ai.prefs.set', {values:v}); }}
    ]});
}
const PT = label => { const k = 'aie.p.' + label; const t = T(k); return t === k ? label : t; };

/* ── 键盘快捷键…（shortcut_editor.rs：搜寻、点一项再按键、清除、回预设、冲突、预设组、汇出入；确定才写进去）── */
function openShortcutsDialog(){
  const st = {query:'', set:Short.state.set, overrides:Object.assign({}, Short.state.overrides), selected:'', recording:false, message:'', conflict:''};
  Dlg.open({kind:'shortcuts', title:'aie.shortcuts', state:st, width:640,
    render(body, s, ui){
      body.appendChild(h('div', {class:'row'}, [h('span', {class:'l', text:T('aie.scSet')}),
        (() => { const sel = h('select', {'data-k':'set', onchange:e => { const n = e.target.value; if (SC_PRESETS.includes(n)){ s.set = n; s.overrides = {}; } Dlg.render(); }}); SC_PRESETS.concat([SC_CUSTOM]).forEach(n => sel.appendChild(h('option', {value:n, text:T('aie.sc.' + n)}))); sel.value = s.set; return sel; })(),
        ui.button('aie.export', () => { s.message = ''; const v = {format:'dilin-shortcuts', version:1, set:s.set, overrides:s.overrides}; if (typeof download === 'function') download(new Blob([JSON.stringify(v, null, 2)], {type:'application/json'}), 'Dilin Canvas Shortcuts.json'); }, {id:'export'}),
        ui.button('aie.import', () => { const f = h('input', {type:'file', accept:'.json,application/json'}); f.onchange = () => { const x = f.files[0]; if (!x) return; x.text().then(t => { try { const d = JSON.parse(t); if (!d.overrides) throw new Error('missing overrides'); s.overrides = {}; Object.entries(d.overrides).forEach(([k, v]) => { s.overrides[k] = v ? (normChord(v) || '') : ''; }); s.set = SC_CUSTOM; } catch(e){ Dlg.cur.err = String(e.message || e); } Dlg.render(); }); }; f.click(); }, {id:'import'})]));
      body.appendChild(ui.row('aie.search', ui.text('query', {width:260, live:true, structural:false})));
      const q = s.query.toLowerCase();
      const tbl = h('table', {class:'sc', 'data-role':'entries'});
      Short.entries().filter(e => !q || e.label.toLowerCase().includes(q) || e.key.toLowerCase().includes(q) || e.group.toLowerCase().includes(q)).forEach(e => {
        const cur = Short.effectiveIn(s.overrides, e.key);
        tbl.appendChild(h('tr', {class:(e.key === s.selected ? 'sel' : '') + (s.overrides[e.key] !== undefined ? ' ov' : ''), 'data-id':e.key, onclick:() => { s.selected = e.key; s.recording = true; s.message = T('aie.pressKeys'); s.conflict = ''; Dlg.render(); }},
          [h('td', {text:e.group, style:'color:#8a93a0'}), h('td', {text:e.label}), h('td', {class:'k', text:s.recording && e.key === s.selected ? '…' : (cur || '')})]));
      });
      body.appendChild(h('div', {style:'max-height:300px;overflow:auto;border:1px solid #444a54'}, [tbl]));
      body.appendChild(h('div', {class:'row'}, [
        ui.button('aie.clear', () => { if (!s.selected) return; Short.assign(s.overrides, s.selected, '', false); s.set = SC_CUSTOM; s.recording = false; Dlg.render(); }, {id:'clear', disabled:!s.selected}),
        ui.button('aie.scDefault', () => { if (!s.selected) return; delete s.overrides[s.selected]; s.recording = false; Dlg.render(); }, {id:'default', disabled:!s.selected}),
        s.conflict ? ui.button('aie.scForce', () => { try { Short.assign(s.overrides, s.selected, s.conflict, true); s.set = SC_CUSTOM; s.message = ''; s.conflict = ''; s.recording = false; } catch(e){ s.message = e.message; } Dlg.render(); }, {id:'force'}) : null,
        h('span', {style:'color:#ffd27a', 'data-role':'scmsg', text:s.message || ''})]));
      const n = Short.allConflicts(s.overrides).length;
      if (n) body.appendChild(h('div', {class:'row', style:'color:#ff8a80', text:T('aie.scConflicts').replace('{n}', n)}));
    },
    buttons:[{id:'cancel', label:'aie.cancel', run:() => ({ok:true})}, {id:'ok', label:'aie.ok', primary:true, run:s => { Short.state = {set:s.set, overrides:Object.assign({}, s.overrides)}; Short.save(); return {ok:true}; }}]});
  /* 录键：选了一项又在录 ⇒ 下一个按键组合就是它的新键（冲突先提示，按「仍要指定」才抢过来） */
  Dlg.cur.capture = e => {
    const s = Dlg.cur.st; if (!s.recording || !s.selected || /input|select/i.test(e.target.tagName)) return false;
    if (e.key === 'Escape'){ s.recording = false; s.message = ''; Dlg.render(); return true; }
    const c = chordOf(e); if (!c) return true;
    e.preventDefault();
    try { Short.assign(s.overrides, s.selected, c, false); s.set = SC_CUSTOM; s.message = ''; s.conflict = ''; s.recording = false; }
    catch(err){ s.message = err.message; s.conflict = c; }
    Dlg.render(); return true;
  };
}
AE.normChord = normChord;

/* ═════════════ 快捷键分派（只接「编辑」菜单这一组；AI 模式＝当前层是矢量层）═════════════
   照菜单树上写的 key（键盘快捷键改过的也跟着变）。不接：还原／重做（ui.js 已接，且有「工具先吃 Ctrl+Z」的规矩）、清除 Delete（ui.js／工具在接）。
   粘贴系列：内部剪贴簿是空的（或我们写过系统剪贴簿、要比对系统那边有没有更新）⇒ 不 preventDefault，让浏览器发 paste 事件（带系统剪贴簿内容、不用权限），
   80ms 内没等到 paste 事件就照内部剪贴簿贴。挂在 window 捕获阶段，接了就停传。 */
const typing = t => !!t && (t.isContentEditable || /^(input|select|textarea)$/i.test(t.tagName));
const NO_KEY = ['edit.undo', 'edit.redo', 'edit.clear'];
const PASTE_MODE = {'ai.edit.paste':'offset', 'ai.edit.pasteInFront':'front', 'ai.edit.pasteInBack':'back', 'ai.edit.pasteInPlace':'inPlace', 'ai.edit.pasteOnAllArtboards':'allArtboards', 'ai.edit.pasteWithoutFormatting':'offset'};
function editItemFor(e){
  if (!window.Menubar || Menubar.app !== 'ai' || !window.MenuTrees || !MenuTrees.ai || !MenuTrees.ai.edit) return null;
  if (typing(e.target) || document.querySelector('.aidlg-back,.aivdlg-back') || Dlg.cur) return null;
  const c = chordOf(e); if (!c) return null;
  let hit = null;
  const go = items => items.forEach(it => { if (hit || it.sep) return; if (it.sub) go(it.sub); else if (it.key && !NO_KEY.includes(it.id) && normChord(it.key) === c && Menubar.enabled(it)) hit = it; });
  go(MenuTrees.ai.edit.items);
  return hit;
}
let pending = null;
window.addEventListener('keydown', e => {
  const it = editItemFor(e); if (!it) return;
  const cmd = typeof it.impl === 'string' ? it.impl : it.impl.cmd;
  e.stopImmediatePropagation();
  if (PASTE_MODE[cmd] && CLIP() && (CLIP().isEmpty() || CLIP().publishOk)){
    const my = pending = {it, cmd};
    setTimeout(() => { if (pending === my){ pending = null; Menubar.run(it); } }, 80);
    return;
  }
  e.preventDefault();
  Menubar.run(it);
}, true);
document.addEventListener('paste', e => {
  if (!pending) return;
  const my = pending; pending = null;
  e.preventDefault();
  const sys = CLIP().fromEvent(e);
  if ((sys.image || (sys.text && sys.text.trim())) && CLIP().systemIsNewer(sys)){
    pasteSystem(sys, PASTE_MODE[my.cmd], my.cmd).then(r => { if (r && r.ok === false) console.warn(r.error); redraw(); }, err => console.error(err));
    return;
  }
  Menubar.run(my.it);
}, true);
AE.pendingPaste = () => !!pending;

/* ═════════════ 三语字串（照 AI 2020 繁／简中介面用语）═════════════ */
const STR = {'zh-Hant':{}, 'zh-Hans':{}, en:{}};
const put = (k, hant, hans, en) => { STR['zh-Hant'][k] = hant; STR['zh-Hans'][k] = hans; if (en !== undefined) STR.en[k] = en; };
[
  ['findReplace', '尋找及取代', '查找和替换', 'Find and Replace'], ['find', '尋找：', '查找：', 'Find:'], ['replaceWith', '取代為：', '替换为：', 'Replace With:'],
  ['matchCase', '大小寫須相符', '区分大小写', 'Match Case'], ['wholeWord', '全字拼寫須相符', '全字匹配', 'Whole Word'], ['findBtn', '尋找', '查找', 'Find'],
  ['foundIn', '找到：{name}', '找到：{name}', 'Found in: {name}'], ['notFound', '找不到', '没找到', 'Not found'], ['replaceBtn', '取代', '替换', 'Replace'],
  ['replaced', '已取代 {n} 處', '已替换 {n} 处', '{n} replaced'], ['replaceFind', '取代並尋找', '替换和查找', 'Replace & Find'], ['replaceAll', '全部取代', '全部替换', 'Replace All'], ['done', '完成', '完成', 'Done'],
  ['spellCheck', '拼字檢查', '拼写检查', 'Check Spelling'], ['readyToStart', '準備開始', '准备开始', 'Ready to Start'], ['spellDone', '拼字檢查完成。', '拼写检查完成。', 'Spell check complete.'],
  ['repeatedWord', '重複的字：', '重复的单词：', 'Repeated Word:'], ['uncapitalized', '句首未大寫：', '句首未大写：', 'Uncapitalized Start of Sentence:'], ['unknownWord', '未知的字：', '未知单词：', 'Unknown Word:'],
  ['suggestions', '建議：', '建议单词：', 'Suggestions:'], ['deleteWord', '（刪除）', '（删除）', '(Delete)'], ['noSuggestions', '（沒有建議）', '（无建议）', '(No suggestions)'],
  ['changeTo', '更改為：', '更改为：', 'Change To:'], ['ignore', '忽略', '忽略', 'Ignore'], ['ignoreAll', '全部忽略', '全部忽略', 'Ignore All'], ['change', '更改', '更改', 'Change'],
  ['changeAll', '全部更改', '全部更改', 'Change All'], ['add', '增加', '添加', 'Add'], ['options', '選項 ▸', '选项 ▸', 'Options ▸'], ['optionsHide', '選項 ▾', '选项 ▾', 'Options ▾'],
  ['optFind', '尋找：', '查找：', 'Find:'], ['optRepeated', '重複的字', '重复的单词', 'Repeated Words'], ['optUncap', '句首未大寫', '句首字母未大写', 'Uncapitalized Start of Sentence'],
  ['optIgnore', '忽略：', '忽略：', 'Ignore:'], ['optAllCaps', '全部大寫的字', '全部大写的单词', 'Words That Are All Uppercase'], ['optRoman', '羅馬數字', '罗马数字', 'Roman Numerals'], ['optNumbers', '含有數字的字', '包含数字的单词', 'Words with Numbers'],
  ['start', '開始', '开始', 'Start'], ['editDict', '編輯自訂字典', '编辑自定词典', 'Edit Custom Dictionary'], ['word', '字詞：', '单词：', 'Word:'], ['delete', '刪除', '删除', 'Delete'],
  ['saturate', '飽和度', '调整饱和度', 'Saturate'], ['intensity', '強度：', '强度：', 'Intensity:'], ['preview', '預視', '预览', 'Preview'], ['cancel', '取消', '取消', 'Cancel'], ['ok', '確定', '确定', 'OK'],
  ['mGray', '灰階', '灰度', 'Grayscale'], ['mGlobal', '整體', '全局', 'Global'], ['black', '黑色', '黑色', 'Black'], ['red', '紅色', '红色', 'Red'], ['green', '綠色', '绿色', 'Green'], ['blue', '藍色', '蓝色', 'Blue'],
  ['cyan', '青色', '青色', 'Cyan'], ['magenta', '洋紅色', '洋红色', 'Magenta'], ['yellow', '黃色', '黄色', 'Yellow'], ['tint', '色調', '色调', 'Tint'],
  ['adjustColors', '調整色彩', '调整颜色', 'Adjust Colors'], ['colorMode', '色彩模式：', '颜色模式：', 'Color Mode:'], ['convert', '轉換', '转换', 'Convert'],
  ['globalNote', '調整整體及特別色的色調；其他顏色不變（畫板沒有整體色票）。', '调整全局色与专色的色调；其他颜色不变（画板没有全局色板）。', 'Shifts the tints of global and spot colors; other colors stay (this canvas has no global swatches).'],
  ['adjustOptions', '調整選項：', '调整选项：', 'Adjust Options:'], ['fill', '填色', '填色', 'Fill'], ['stroke', '筆畫', '描边', 'Stroke'],
  ['overprintBlack', '套印黑色', '叠印黑色', 'Overprint Black'], ['addBlack', '增加黑色', '添加黑色', 'Add Black'], ['removeBlack', '移除黑色', '移去黑色', 'Remove Black'],
  ['applyTo', '套用至：', '应用于：', 'Apply To:'], ['inclCmy', '包含 CMY 的黑色', '包括带 CMY 的黑色', 'Include Blacks with CMY'], ['inclSpot', '包含特別色黑色', '包括专色黑色', 'Include Spot Blacks'],
  ['recolor', '重新上色圖稿', '重新着色图稿', 'Recolor Artwork'], ['preset', '預設集：', '预设：', 'Preset:'],
  ['pr0', '自訂', '自定', 'Custom'], ['pr1', '1 色作業', '1 色作业', '1 Color Job'], ['pr2', '2 色作業', '2 色作业', '2 Color Job'], ['pr3', '3 色作業', '3 色作业', '3 Color Job'], ['pr4', '色彩庫', '颜色库', 'Color Library'],
  ['assign', '指定', '指定', 'Assign'], ['editTab', '編輯', '编辑', 'Edit'], ['colors', '顏色：', '颜色：', 'Colors:'], ['auto', '自動', '自动', 'Auto'], ['preserve', '保留：', '保留：', 'Preserve:'],
  ['white', '白色', '白色', 'White'], ['grays', '灰色', '灰色', 'Grays'], ['currentColors', '目前顏色 ({n})', '当前颜色 ({n})', 'Current Colors ({n})'], ['new', '新增', '新建', 'New'],
  ['noColors', '沒有可重新上色的顏色（保留的顏色不列出）。', '没有可重新着色的颜色（保留的颜色不列出）。', 'No colors to recolor (preserved colors are left out).'],
  ['includeRow', '重新上色這一列', '重新着色这一行', 'Recolor this row'], ['excludeRow', '保留這一列的顏色（排除）', '保留这一行的颜色（排除）', "Keep this row's colors (exclude)"],
  ['merge', '合併', '合并', 'Merge'], ['mergeTip', '將顏色合併至一列', '将颜色合并到一行中', 'Merge colors into one row'], ['separate', '分開', '分离', 'Separate'], ['separateTip', '將顏色分開成不同列', '将颜色分离到不同的行中', 'Separate colors into rows'],
  ['randOrder', '隨機變更顏色順序', '随机更改颜色顺序', 'Randomly change color order'], ['randSB', '隨機變更飽和度和亮度', '随机更改饱和度和亮度', 'Randomly change saturation and brightness'],
  ['reset', '重設', '重置', 'Reset'], ['method', '上色方法：', '着色方法：', 'Method:'], ['limitTo', '將顏色限制在：', '将颜色限定为库：', 'Limit to Library:'], ['none', '無', '无', 'None'],
  ['harmony', '色彩調和規則：', '协调规则：', 'Harmony Rules:'], ['linked', '已連結', '已链接', 'Linked'], ['unlinked', '未連結', '未链接', 'Unlinked'],
  ['hue', '色相', '色相', 'Hue'], ['sat', '飽和度', '饱和度', 'Saturation'], ['bright', '亮度', '亮度', 'Brightness'],
  ['prefs', '偏好設定', '首选项', 'Preferences'], ['resetPrefs', '重設偏好設定', '重置首选项', 'Reset Preferences'],
  ['shortcuts', '鍵盤快速鍵', '键盘快捷键', 'Keyboard Shortcuts'], ['scSet', '組合：', '组：', 'Set:'], ['export', '轉存…', '导出…', 'Export…'], ['import', '讀入…', '导入…', 'Import…'],
  ['search', '搜尋：', '搜索：', 'Search:'], ['pressKeys', '按下新的快速鍵（Esc 取消）', '按下新的快捷键（Esc 取消）', 'Press the new shortcut (Esc cancels)'],
  ['clear', '清除', '清除', 'Clear'], ['scDefault', '回復預設值', '还原默认值', 'Revert to Default'], ['scForce', '仍要指定', '仍要指定', 'Assign Anyway'],
  ['scConflicts', '有 {n} 組快速鍵衝突', '有 {n} 组快捷键冲突', '{n} shortcut conflicts'],
  ['sc.VectorCraft Defaults', '堤麟畫板預設值', '堤麟画板默认值', 'Dilin Canvas Defaults'], ['sc.Classic Defaults', '傳統預設值', '经典默认值', 'Classic Defaults'], ['sc.Custom', '自訂', '自定', 'Custom'],
  ['m.exact', '精確', '精确', 'Exact'], ['m.preserveTints', '保留色調', '保留色调', 'Preserve Tints'], ['m.scaleTints', '縮放色調', '缩放色调', 'Scale Tints'], ['m.tintsShades', '色調和暗色', '色调和暗色', 'Tints and Shades'], ['m.hueShift', '色相偏移', '色相偏移', 'Hue Shift'],
  ['lib.web-safe-216', '網頁安全色 216', 'Web 安全色 216', 'Web Safe 216'], ['lib.grays-neutrals', '灰色與中性色', '灰色和中性色', 'Grays and Neutrals'], ['lib.earth-tones', '大地色調', '大地色调', 'Earth Tones'],
  ['lib.skin-tone-ramps', '膚色色階', '肤色色阶', 'Skin Tone Ramps'], ['lib.pastels', '粉彩', '粉彩', 'Pastels'], ['lib.brights', '亮色', '亮色', 'Brights'],
].forEach(([k, a, b, c]) => put('aie.' + k, a, b, c));
const HZ = {complementary:['補色', '互补色'], complementary2:['補色 2', '互补色 2'], splitComplementary:['分割補色', '拆分互补色'], leftComplement:['左補色', '左补色'], rightComplement:['右補色', '右补色'],
  analogous:['類比', '类似色'], analogous2:['類比 2', '类似色 2'], monochromatic:['單色', '单色'], shades:['暗色', '暗色'], triad:['三色組', '三色组合'], triad2:['三色組 2', '三色组合 2'], triad3:['三色組 3', '三色组合 3'],
  tetrad:['四色組', '四色组合'], tetrad2:['四色組 2', '四色组合 2'], tetrad3:['四色組 3', '四色组合 3'], compound:['混合', '复合色'], compound2:['混合 2', '复合色 2'],
  highContrast:['高對比', '高对比色'], highContrast2:['高對比 2', '高对比色 2'], highContrast3:['高對比 3', '高对比色 3'], pentagram:['五角形', '五角形']};
HARMONY.forEach(([l]) => { const id = harmonyId(l); put('aie.h.' + id, HZ[id][0], HZ[id][1], l); });
const PC = {'General':['一般', '常规'], 'Selection & Anchor Display':['選取和錨點顯示', '选择和锚点显示'], 'Type':['文字', '文字'], 'Units':['單位', '单位'], 'Guides & Grid':['參考線及格點', '参考线和网格'],
  'Smart Guides':['智慧型參考線', '智能参考线'], 'Slices':['切片', '切片'], 'Hyphenation':['斷字', '连字'], 'Performance & Storage':['增效模組及暫存磁碟', '增效工具和暂存盘'], 'User Interface':['使用者介面', '用户界面'],
  'Performance':['效能', '性能'], 'File Handling':['檔案處理', '文件处理'], 'Clipboard Handling':['剪貼簿處理', '剪贴板处理'], 'Appearance of Black':['黑色外觀', '黑色外观'], 'Devices':['裝置', '设备']};
PCATS.forEach(c => put('aie.pc.' + c, PC[c][0], PC[c][1], c));
const PL = {
  'Keyboard Increment':['鍵盤增量', '键盘增量'], 'Constrain Angle':['強制角度', '约束角度'], 'Corner Radius':['圓角半徑', '圆角半径'], 'Paste Offset':['貼上位移', '粘贴位移'], 'Options':['選項', '选项'],
  'Disable Auto Add/Delete':['停用自動增加/刪除', '停用自动添加/删除'], 'Use Precise Cursors':['使用精確游標', '使用精确光标'], 'Show Tool Tips':['顯示工具提示', '显示工具提示'], 'Anti-aliased Artwork':['消除鋸齒圖稿', '消除锯齿图稿'],
  'Select Same Tint %':['選取相同色調百分比', '选择相同色调百分比'], 'Show The Home Screen When No Documents Are Open':['未開啟任何文件時顯示首頁畫面', '没有打开的文档时显示主页屏幕'], 'Use Preview Bounds':['使用預視範圍', '使用预览边界'],
  'Display Print Size at 100% Zoom':['以 100% 縮放顯示列印尺寸', '以 100% 缩放显示打印尺寸'], 'Double Click To Isolate':['連按兩下以隔離', '双击以隔离'], 'Transform Pattern Tiles':['變形圖樣拼貼', '变换图案拼贴'],
  'Scale Corners':['縮放邊角', '缩放圆角'], 'Scale Strokes & Effects':['縮放筆畫和效果', '缩放描边和效果'], 'Zoom with Mouse Wheel':['使用滑鼠滾輪縮放', '用鼠标滚轮缩放'], 'Use Japanese Crop Marks':['使用日式裁切標記', '使用日式裁剪标记'],
  'Appearance Panel':['外觀面板', '外观面板'], 'New Art Has Basic Appearance':['新增圖稿具有基本外觀', '新建图稿具有基本外观'], 'Transform Panel':['變形面板', '变换面板'], 'Constrain Width and Height Proportions':['強制寬度和高度比例', '约束宽度和高度比例'],
  'Selection':['選取', '选择'], 'Tolerance':['容許度', '容差'], 'Object Selection by Path Only':['只依路徑選取物件', '仅按路径选择对象'], 'Snap to Point':['靠齊控制點', '对齐点'],
  'Command Click to Select Objects Behind':['按 Ctrl 鍵選取後方物件', '按住 Ctrl 单击选择下方对象'], 'Zoom to Selection':['縮放至選取範圍', '缩放至选区'], 'Move Locked and Hidden Artwork with Artboard':['將鎖定及隱藏的圖稿隨工作區域移動', '移动锁定和隐藏的带画板的图稿'],
  'Anchor Points, Handle, and Bounding Box Display':['錨點、控制把手和邊框顯示', '锚点、手柄和定界框显示'], 'Size':['大小', '大小'], 'Handles':['控制把手', '手柄'], 'Solid':['實心', '实心'], 'Hollow':['空心', '空心'], 'Large':['大', '大'],
  'Highlight anchors on mouse over':['滑鼠移入時強調顯示錨點', '鼠标移过时突出显示锚点'], 'Show handles when multiple anchors are selected':['選取多個錨點時顯示控制把手', '选择多个锚点时显示手柄'],
  'Hide Corner Widget for angles greater than':['角度大於下列值時隱藏邊角 Widget', '以下角度时隐藏边角构件'], 'Enable Rubber Band for':['啟用橡皮筋：', '为以下对象启用橡皮筋：'], 'Pen Tool':['鋼筆工具', '钢笔工具'], 'Curvature Tool':['曲線工具', '曲率工具'],
  'Size/Leading':['大小/行距', '大小/行距'], 'Tracking':['字距調整', '字距调整'], 'Baseline Shift':['基線微調', '基线偏移'], 'Language Options':['語言選項', '语言选项'], 'Show East Asian Options':['顯示東亞選項', '显示东亚选项'],
  'Show Indic Options':['顯示印度文選項', '显示印度语选项'], 'Type Object Selection by Path Only':['只依路徑選取文字物件', '仅按路径选择文字对象'], 'Show Font Names in English':['以英文顯示字體名稱', '以英文显示字体名称'],
  'Auto Size New Area Type':['自動調整新區域文字大小', '自动调整新区域文字大小'], 'Enable in-menu font previews':['啟用選單內字體預視', '启用菜单内字体预览'], 'Font Preview Size':['字體預視大小', '字体预览大小'], 'Small':['小', '小'], 'Medium':['中', '中'],
  'Number of Recent Fonts':['最近使用的字體數目', '最近使用的字体数目'], 'Enable Missing Glyph Protection':['啟用缺少字符保護', '启用缺失字形保护'], 'Highlight Alternate Glyphs':['強調顯示替代字符', '突出显示替代字形'],
  'Fill New Type Objects With Placeholder Text':['以預留位置文字填滿新文字物件', '用占位符文本填充新文字对象'], 'Graphic Styles':['繪圖樣式', '图形样式'], 'Override Character Color':['覆寫字元顏色', '覆盖字符颜色'],
  'General':['一般', '常规'], 'Stroke':['筆畫', '描边'], 'Type':['文字', '文字'], 'East Asian Type':['東亞文字', '东亚文字'], 'Numbers Without Units Are Points':['不含單位的數字視為點', '无单位数字为点'],
  'Identify Objects By':['識別物件依據', '对象识别依据'], 'Object Name':['物件名稱', '对象名称'], 'Points':['點', '点'], 'Picas':['派卡', '派卡'], 'Inches':['英寸', '英寸'], 'Millimeters':['公釐', '毫米'], 'Centimeters':['公分', '厘米'],
  'Pixels':['像素', '像素'], 'Feet & Inches':['英尺和英寸', '英尺和英寸'], 'Meters':['公尺', '米'], 'Yards':['碼', '码'], 'Feet':['英尺', '英尺'],
  'Guides':['參考線', '参考线'], 'Color':['顏色', '颜色'], 'Style':['樣式', '样式'], 'Lines':['線條', '直线'], 'Dots':['點', '点'], 'Grid':['格點', '网格'], 'Gridline every':['格線間隔', '网格线间隔'], 'Subdivisions':['細格數', '次分隔线'],
  'Grids In Back':['格點在後', '网格置后'], 'Show Pixel Grid (Above 600% Zoom)':['顯示像素格點 (縮放 600% 以上)', '显示像素网格（放大 600% 以上）'], 'Pattern Editing':['圖樣編輯', '图案编辑'], 'Tile Edge Color':['拼貼邊緣顏色', '拼贴边缘颜色'],
  'Display Options':['顯示選項', '显示选项'], 'Alignment Guides':['對齊參考線', '对齐参考线'], 'Object Highlighting':['物件強調顯示', '对象突出显示'], 'Transform Tools':['變形工具', '变换工具'], 'Construction Guides':['建構參考線', '结构参考线'],
  'Angles':['角度', '角度'], 'Anchor/Path Labels':['錨點/路徑標籤', '锚点/路径标签'], 'Measurement Labels':['度量標籤', '度量标签'], 'Spacing Guides':['間距參考線', '间距参考线'], 'Snapping Tolerance':['靠齊容許度', '对齐容差'],
  'Show Slice Numbers':['顯示切片編號', '显示切片编号'], 'Line Color':['線條顏色', '线条颜色'], 'Default Language':['預設語言', '默认语言'], 'Exceptions (comma separated)':['例外 (以逗號分隔)', '例外（逗号分隔）'],
  'Plug-ins':['增效模組', '增效工具'], 'Additional Plug-ins Folder':['其他增效模組資料夾', '其他增效工具文件夹'], 'Scratch Disks':['暫存磁碟', '暂存盘'], 'Primary':['主要', '主要'], 'Secondary':['次要', '次要'],
  'Brightness':['亮度', '亮度'], 'Dark':['深色', '深色'], 'Medium Dark':['中等深色', '中等深色'], 'Medium Light':['中等淺色', '中等浅色'], 'Light':['淺色', '浅色'], 'Canvas Color':['畫布顏色', '画布颜色'],
  'Match User Interface Brightness':['符合使用者介面亮度', '与用户界面亮度匹配'], 'White':['白色', '白色'], 'Auto-Collapse Iconic Panels':['自動收合圖示面板', '自动折叠图标面板'], 'Open Documents As Tabs':['以標籤方式開啟文件', '以选项卡方式打开文档'],
  'Large Tabs':['大型標籤', '大选项卡'], 'UI Scaling':['使用者介面縮放', '用户界面缩放'], 'Scale':['縮放', '缩放'], 'Scale Cursor Proportional to UI':['依使用者介面比例縮放游標', '按用户界面比例缩放光标'],
  'GPU Performance':['GPU 效能', 'GPU 性能'], 'Animated Zoom':['動畫縮放', '动画缩放'], 'History States':['步驟記錄狀態', '历史记录状态'], 'Real-time Drawing and Editing':['即時繪圖和編輯', '实时绘图和编辑'],
  'Render Threads (-1 = Automatic)':['演算執行緒 (-1 = 自動)', '渲染线程（-1 = 自动）'], 'Enable Background Save':['啟用背景儲存', '启用后台存储'], 'Enable Background Export':['啟用背景轉存', '启用后台导出'],
  'Data Recovery':['資料復原', '数据恢复'], 'Automatically Save Recovery Data':['自動儲存復原資料', '自动存储恢复数据'], 'Every (minutes)':['間隔 (分鐘)', '间隔（分钟）'], 'Folder':['資料夾', '文件夹'],
  'Turn off Data Recovery for complex documents':['對複雜文件關閉資料復原', '对于复杂文档关闭数据恢复'], 'Files':['檔案', '文件'], 'Number of Recent Files to Display':['要顯示的最近使用檔案數目', '要显示的最近使用的文件数'],
  'Use Low Resolution Proxy for Linked EPS':['連結的 EPS 使用低解析度替代影像', '对链接的 EPS 使用低分辨率代理'], 'Display Bitmaps as Anti-aliased Images in Pixel Preview':['在像素預視中以消除鋸齒影像顯示點陣圖', '在像素预览中将位图显示为消除了锯齿的图像'],
  'Update Links':['更新連結', '更新链接'], 'Automatically':['自動', '自动'], 'Manually':['手動', '手动'], 'Ask When Modified':['修改時詢問', '修改时提问'], 'Templates Folder':['範本資料夾', '模板文件夹'],
  'Mark Older Files as [Converted] When Opened':['開啟舊版檔案時標示為 [已轉換]', '打开旧版文件时附加 [转换]'], 'Use Compression':['使用壓縮', '使用压缩'], 'On Copy':['拷貝時', '复制时'], 'Include SVG Code':['包含 SVG 程式碼', '包含 SVG 代码'],
  'Legacy vector clipboard (no transparency)':['舊版向量剪貼簿 (無透明度)', '旧版矢量剪贴板（无透明度）'], 'Legacy vector clipboard':['舊版向量剪貼簿', '旧版矢量剪贴板'], 'Preserve Paths':['保留路徑', '保留路径'],
  'Preserve Appearance and Overprints':['保留外觀和疊印', '保留外观和叠印'], 'On Paste':['貼上時', '粘贴时'], 'When pasting text':['貼上文字時', '粘贴文本时'], 'Keep Formatting':['保留格式', '保留格式'], 'Keep Plain Text':['僅保留純文字', '仅保留纯文本'],
  'On Screen':['螢幕上', '屏幕显示'], 'Display All Blacks Accurately':['精確顯示所有黑色', '精确显示所有黑色'], 'Display All Blacks as Rich Black':['以複色黑顯示所有黑色', '将所有黑色显示为复色黑'],
  'Printing / Exporting':['列印 / 轉存', '打印/导出'], 'Output All Blacks Accurately':['精確輸出所有黑色', '精确输出所有黑色'], 'Output All Blacks as Rich Black':['以複色黑輸出所有黑色', '将所有黑色输出为复色黑'],
  'Enable Touch Workspace':['啟用觸控工作區', '启用触控工作区'], 'Enable Touch Gestures':['啟用觸控手勢', '启用触控手势']};
Object.entries(PL).forEach(([en, [a, b]]) => put('aie.p.' + en, a, b));
if (window.Lang) Lang.add(STR);

/* 快捷键覆写：载入时套一次（菜单树都已登记） */
try { Short.apply(); } catch(e){ console.error(e); }
AE.version = '1';
})();

/* 拼写的基本字典（35778 字干，前缀压缩：每个字＝一个前缀码〔'0'+与前一个字相同的字数〕＋其余字母；字尾 s/es/ed/ing/ly/er/est/ness/ment… 由 AiEdit.spell.known 的规则推出）。
   来源：/usr/share/dict/american-english（去掉 's 所有格、只留小写拉丁字母与撇号）。改字典＝重跑产生脚本，别手改这一行。 */
if (window.AiEdit && !AiEdit.spellRaw) AiEdit.spellRaw = `0a1a2a2chen2liyah2rdvark3on1b2aci4k4us3ft3lone3ndon3se4h3te4toir2bas5id3ess4y3ot5t3r4ev6iate9ion3y3é2c2dicate7ion3omen5inal3uct6ee6ion6or4l2e3am3l4ard4son3rdeen4nathy4rant6tion3t4tor3yance2hor5rence8t2ide4jan3gail3lene4ity2ject3uration5e2lative4ze3e3oom3ution2m2negate7ion4r3ormal8ity2oard3de3lish5tion9ist3minable9y7te8ion3riginal8e4t5ion8ist6ve3und4t3ve5board2racadabra4de4ham4m4sion6ve3east3idge6ment3oad4gate7ion3upt2salom3cess4issa8e4ond3ence5t6ee8ism3inth7e3olute7ion8sm5ve4rb6ency8t5ption3tain4emious5ntion4inence8t4ract8ion5use3urd6ity2uja3ndance7t3se4ive3t3zz2ysmal4s5inia9n1c2acia3demia7c8al8ian6y4ia3nthi6us3pulco2cede4lerate9ion9or4nt6uate9ion7re4pt6ability8le9y7nce4ss6ibility8le9y7on6ory3ident8al3laim5mation4imate8ion9zation:e3olade4mmodate:ion5paniment9st8y6lice8sh4rd6ance6ion4st4unt7ability9le8ncy9t5terments6rements3ra4edit8ation5tion4ual5e3t3ulturation4mulate9ion:ve9or4racy6te5sed6t4sation8ve7ory5e5tom2e3rbic6ty3taminophen5te4ic4one4ylene3vedo2haean3e4be4rnar4son3ievable6e4lles3oo3romatic3y2id4ic5fy5ty4ulous2knowledge:ment2lu2me2ne2olyte3ncagua4ite3rn3sta3ustic8al2quaint8ance4iesce9nce:t5rable6e5sition9ve5t6tal2re4age3id4monious7y3obat7ic4nym4polis4ss5tic3ux3ylic2t3aeon3h3inium4on6able4vate7ion5e5ism7t6ty3on4r3ress3ual6ity7zation8e5rial6y5te6or2uff3ity3men3puncture:ist3te1d2a3ge4io3m4ant3n4a3pt5ability7le6tion5ive5or3r2dams3end6a6um4rley3ict6ion7ve4e4son4tion8al6ve3le3ress7able7ee3uce2ela5ide4e4ine3n4auer4oid7al3pt3quacy6te2hara3ere6nce7t4sion6ve2iabatic3das3eu5x3pose3rondack3ós2j3acent3ectival8e3oin4urn3udge5icate9ion9or4nct4ration5e4st6able6or4tant2kins2ler2man3en3in5ister8rate;ion<ve;or4rable8y6l7ty6tion5e4ssibility8le7on4t5tance4xture3onish6tion7ory2o3be3lescence9t4f5o4ph3nis3pt5ion6ve3rable7y5tion4e4n2renal7in9e3ian6a5tic4enne4ft3oit2ulate6ion4t5erant8te9ion7er8ss7ous7y5hood3mbrate8ion2v3ance5tage9ous3ent6ist7tious6ure9some8ous4rb6ial5sarial8y6e6ity5t6ise3ice4l4sability7le5e5or7y3ocacy6te3t2ware2z3e1egean3is2lfric2neas4id2olus3n2rate5ion5or3ial6ist4e3obatics5ic4dynamic;ally4flot4nautical:s4sol5pace3y2schylus4ulapius3op3thete7ic9ally1f2aik3r2c2fability5le6y4ir3ect6ation6ion9ate3idavit4liate8ion4nity4rm6ation9ve4x3lict7ion4uence7t3ord6able5est8ation3ray4ont2ghan6i7stan2icionado3eld3re2lame3oat3utter2oot3rementioned5said5thought3ul2raid3esh3ica6n4kaans6ner3o4centrism2t3erbirth6urner5care5effect5glow5life7ves5math5noon5shave7ock5taste6hought5ward6ord1g2ain5st3memnon3pe3r3ssi6z3te4ha3ve2e3ism3less3ncy4da4t2gie3lomerate:ion4utinate:ion3randize5vate8ion4egate8ion5ssion8ve7or4ieve2hast2ile4ity3sm3tate6ion6or2laia3eam3itter3ow2nes4w3i3ostic8ism2o3g3nize4y2ra4rian3ee5able8y3ibusiness4cola5ultural<ist:e4ppa6ina3onomist7y4und2uadilla3e3ilar4naldo4rre3stin1h2a3b2ead3m2mad5abad5inejad3ed2oy2riman1i2da3e2ken2l3een4ron2m3ee3less2n't3u2r3borne4rush3craft3drop3edale3fare4ield4oil3head3iness3less4ift5ne3mail5n4en3plane4ort3ship4ick4pace4trip3tight3waves5y4orthy3y2sha3le1jar3x1k2bar2hmatova2ihito3mbo3n3ta3va2kad2ron1l2a3bama7n6ian5ster3crity3ddin3mo5gordo3n4a3r4ic4m5ist3ska6n2b3a4core4nia7n5y4tross3ee4it4rio5t6a6o3igensian4no4on4reo3um5en5in4querque2catraz3estis3hemist6y3ibiades4ndor3mena3oa4hol7ic8sm4tt4ve3uin3yone2dan3ebaran4n4r5amin5man6en5woman8en3o3rin2e3c3ichem3jandra8o3mbert3ppo3rt3ut5ian3x4ander7ra8ia4ei4is2falfa3onso5zo4rd3red6a6o5sco2ga4e3ebra7ic9ally4nib4r5ia7n3ieba5rs3ol4nquian8n4rithm9ic2hambra3ena2i3as3bi3ce4ia3en5able6te7ion3ghieri5t4n3ke3mentary4ony3ne3oth3sa4ha4on4sa4tair3t3ve2kaid4li6ne7ity5oid2l3ah5abad4n4y3egation5e5heny5iance5orical7y5ra6o4luia4n5de5town4rgen8ic6ic7st6y4viate8ion4y5way3iance4e4gator4son4teration:ve3ocate7ion4t4ver4w5able6nce4y3spice4tate3ude4re4sion6ve4via7l6um3yson2ma4ch4nac4ty3ighty3ohad4nd4ravid4st3s2nilam4tak2oe3ft3ha3ne4g5side4zo3of3ud2paca3ert3ha5bet8ic:al9ze5numeric5rd4ecca5ratz4onse7o3ine3o3s2ready3ight2sace4tian3o4p3ton2t3a4ba4i5c5r4mira4r3erable6tion5cation5nate8ion9ve8or3hea4o5ugh3imeter4plano4tude3man3o4gether4ids4n4ona3ruism7t8ic:ally2udra3m4inum4na6e5i5us2va4rado5ez5o3in2ways2yce3son4sa2zheimer1m2a3deus4o3lgam7ate9ion4ia3nda4uenses8is3ranth4illo4u4yllis3ss3terasu5ur7ish9m4i4ory3ze4on2bassador:ial:ship3er5gris3iance4dextrous4ence6t4guity6ous4tion7us4valence9t3le3rosia3ulance6tory4sh2eba5e4ic3er3lia5orate9ion3n4able4dable4hotep4ity3rasian4ica7n8a8ism9zation:e5nd7ian3slan3thyst2gen2haric3erst2iability5le6y3cability6le7y3d4ships5t3e3ga4o3no3r3sh4s3ty2man3eter3o4nia3unition2nesia7c5ty3iocenteses;is2oco3eba6e5ic3k3ng5st3ral6ity4ous4phous4tization7e3s3unt4r2p3aro3erage5e5sand3hetamine4ibian7ous5theater:re3le4ification6y5tude3oule3ul5e4tate7ion5ee2ritsar2sterdam2t3rak2uck3let3ndsen3r3se2way2y1n2a3baptist4el3chronism:tic4in4onda4reon3emia6c4robic4sthesia8tic:st:ze3gram3heim3l4ects4gesia8c4og6ous6ue6y4yses6is6t5tic8al:ally5ze3nias3pest3rchic8ally7sm8t9ic6y3sazi4tasia3thema4ole6ia8n5mic8al7st6y3xagoras2cestor6ral7ess7y3hor6age6ite6man7en6people8rson6woman9en5vy3ient4llary2dalusia9n4man4nte3ean4rsen6on3iron3orra3re5a5i5tti5w4ianampoinimerina4ogen6ynous5id5mache6eda5pov3y2ecdota8l7e3mia5c4ometer5ne3sthesia9ologist=y7tic9st9ze3urism5ysm3w2gara3el5a5ia6c7a8lly7o6na7e6que6ta5o6u4r4vin3ie4na4oplasty5sperm3kor3le5ton5worm4ia5can8ism6ize4o5phile3ola6n4ra3ry3st5rom3uilla5sh4lar7ity4s2i3akchak3bal3mal5te6ion6or4e4ism6t7ic4osity4us3on3se3ta2kara3h3le5t2n3a4bel7le4ls4m4polis5urna3e4al4tte4x5ation3ie4hilate9ion9or4ston4versary3marie3otate7ion4unce4y5ance3ual4ity4l5ar2ode4yne3int3malous6y3n4ymity6ous3pheles3rak4exia7c3ther3uilh2selm6o3han3i3wer6able2t3acid4eus4gonism9t:ic<ally8ze4nanarivo4rctic9a5es3e4ater4bellum4cedent5hamber4date5iluvian4lope4nna7e4rior5oom3hem5r4ill4ologist9ze8y5ny4racite6x5opocene;tric8id8logical<st;y8morphic>sm3i4abortion5ircraft4biotic5ody4c5hrist5ipate9ion9ory5ked6ing5limactic9x6ockwise5yclone4depressant5ote4etam4fa5reeze4gen5one5ua4hero5istamine4knock4lles4matter5ony4och4particle6s7ti8o6thetic8y5ersonnel8pirant5honal5odes4quarian8y7te6e6ity4septic:ally5lavery5ocial4theses8is7tical5oxin5rust4viral7us4war3ler3ofagasta4ine7tte4n5e5ia6nus6o6us5y6m3wan4erp2ubis3s2vil2xiety4ous2y3body3how3more3one3place3thing4ime3way4here2zac3us1ol2rta5e1p2ace4he3lachicola3rt5heid3thetic9ally5y4osaurus2e3nnines3ritif4ture3x2hasia6c3elia6on3id3orism7tic3rodisiac7te2i3a4ry3ces3ece2lenty3omb2o3calypse8tic4rypha9l3gee3litical4linaire5o6nian4ogetic:ally6ia7st7ze6y3plectic6xy3stasy6te5le5olic5rophe3thecary6oses8is2p3al5achia:n5l5oosa4ratus5el6nt5ition3eal5r6ance5se4llant7te8ion4nd6age6ectomy6ices8itis7x4rtain4tite6zer7ing3laud6se4e5jack5sauce6eed5ton4iance5cability8le7nt7tion8or5qué3oint7ee7ive4mattox4rtion4site7ion8ve3raisal7e4eciable:y8te9ion:ve5hend8sion:ve5ntice:ship4ise5ze4oach8able5bation5priate:ion5val6e5x6imate:ion3urtenance2r3icot4l3on4pos2se2t3itude2uleius1qua4culture4e4fresh4marine4naut4plane4ria6um7s4tic4vit3educt4ous3iculture4fer4la5ine4nas5o4taine1r2a3b4esque4ia6n5c4le4y3celi4hnid3fat3guaya3l3maic4co3paho3rat3ucanian3wak6an2biter5rariness8y7te8ion8or6on3or5eal6ta7um5vitae3utus2c3ade5ia7n4ne3h4aeological;st:y5ic7ally6sm5ngel4bishop:ric4deacon5iocese5uke4ean5nemy5ological:st9y5ry5typal8e8ical4ibald5e5medes5pelago5tect9ural;e5ve6ist4way3ked4ing3tic4urus2den5t3or3uino4ous2e3a3cibo3n't4a3quipa2gentina8e8ian3o4n5aut5ne4sy4t3uable7y4e4ment8ation;ve4s3yle2ia4dne4nism3d4ity3el4s3ght3osto3se5n4tarchus5ides5ocracy9t:ic<ally6phanes6telian7le3thmetic:al3us3z4ona7n6ian2juna2k3ansan7s3hangelsk3wright2lene3ine5gton2m3ada5illo4geddon5nac4ment4nd6o5i4ture3band3chair3enia7n3ful3hole3inius4stice3let3onk4r5y4ur3pit3rest3sful4trong3y2neb3hem3o4ld3ulfo2oma5therapy6ic3n3se3und4sal5e2peggio2raign4nge5t4y3ears3henius3ival5e3ogance7t6te4n4w5head5root4yo2senal5ic3on5ist2t3axerxes3efact4mis4rial6osclerosis5y3ful3hritic8s5opod4ur6ian3ichoke5le5ulate9ion4e4fact5ice7ial:ity4llery4san5t6e6ic8ally6ry3less3sy3uro3work3y2uba2yan1s2ama3p2bestos2cella4nd6ancy8t6ency8t5sion5t4rtain9able4tic7ism3ii3ot3ribable6e5ption2eptic3xual2gard2h3amed4nti3can4roft3e4n4ville3ikaga3kenazim4habad3lee5y3molean3ore3ram3tray3urbanipal3y2ia4go4n4tic3de3mov3nine6ity2k3ance3ew2l3ant3eep2mara2ocial3ka2p3aragus5tame3ca3ect4ll4n4rger5ity5sion3halt4yxia8te9ion3ic4diske4rant6te7ion5e5in2quith2sad4il6able7nt4m5ese4ssin8ate:ion4ult4y3emblage7e7y8man9en8woman;en4nt4rt6ion7ve4ssor4t4verate3hole3iduous4gn6able7tion4milate9ion4si5t6ance8t4ze3n3oc5iate8ion9ve4nance4rt3t3uage4me5ption4rance5e3yria7n2taire4na4rte3er5isk5n5oid3hma6tic3igmatic9sm4r3on5ish4r5ia4und3rakhan5l5y4ide5ngency9t4ologer8ical8y5naut9ics6omer8ic:al8y5physicist;s5turf3urias4te2unción4der2wan2ylum3mmetric:al8y4ptotic:ally3nchronous1t2acama3hualpa3lanta3ri3scadero3türk3vism6tic2e3lier2habasca9n3eism6t7ic4na5ian5s4rosclerosis3lete6ic8ally2kins6on2lanta6es6ic7s4s2m3an3osphere9ic;ally2oll3m4ic5zer3nal6ity4e3p2p2reus3ia4um3ocious6ty4phy5os2tach6é5k4in6able4r3empt4nd6ance8t5tion7ve5uate8ion4station3ic5a4la4re4tude7inize3lee3orney3ract7ion8ve4ibutable8e8ion9ve5tion3ucks4ne3y2v2witter3ood2ypical1u2brey3urn2ckland3tion7eer2dacious6ty3en3i4bility5le6y4ence4o5n5phile5visual4t5ion5or7ia8um7y3ra4ey3ubon2g3ean3ht3mentation3sburg3ur5y4st6a7n6ine6us2k2nt2ra4e4l4ngzeb3elia6o6us4ola6e5mycin3icle4ga3ora2schwitz3pice6ious3sie3ten5re6ity6litz4in4ralasia7ia9n7oid8pithecus5ia7n5onesian2thentic9ally:te;ion9ity4or6itarian=ism9tive8y7zation8e6ship3ism5tic3o4biographical<y4cracy7t8ic:ally4graph4immune4mata7e7ic9ally8on7on5obile6tive4nomous7y4pilot5sy4worker3umn6al2xiliary1v2a3il5ability7le3lanche4on3rice6ious3st3tar2dp2e3nge4tine4ue3rage4nus4roes4se5ion4t4y3sta2g2ian4ry4tion5or5rices7x3cenna3d4ity3gnon3la3onics4r3s2ocado5tion3gadro3id5able8y6nce4rdupois3n4dale3w4al2uncular1w2acs3it3ke5n3rd4e3sh3y2e3igh3some4tricken6uck2ful2hile2kward2l2ning2oke5n3l2ry1x2e2ial3om5atic9ally3s2le2on2um1y2ala3tollah2e2mara2rshire2urveda2yubid1z2alea3na4ia3zel2erbaijan:i2imuth2ores3v2t3ec5an3lan2ure0b1a2a3l3th5ist2bar3bage4itt4le3e4l3oon3ur4shka3y4hood4ish4lon7ian4sat5it2call4rdi3calaureate4hanal9ia;n5us3h4elor3illi6us3k4ache4bit7e7ten5oard6ne5reaking4date5rop4field6re4gammon5round4hand5oe4lash5ess5og4pack5edal4rest4side5lapper7sh6id8den8e5pace6in5tabbing7ge7irs6op7ry6retch7oke4track4up5s4ward6sh6ter5oods4yard3on3teria8l7ological<st;y7um4ria2de4n3ge3inage3lands3minton4outh2edeker3z2ffin4le2g3atelle3el3gage4iness4y3hdad3pipe3uio2h3a'i5ullah4ma5ian3ia3rain2idu3kal3l4ey4iff5wick4out3rd3t3ze2ke4lite4rsfield5y3u4nin2lalaika4nce6hine4ton3boa3cony3d4erdash4win3e4aric4en4ful3four3i4nese3k4an4hash4y3l4ad6eer5rd5st4erina5t4istic4oon7ist5t4park5layer5oint4room4sy4yhoo3m4iness4y3oney3sa5m3thazar4ic5more3uchistan4ster6rade3zac2mako3bi4oo6zle2n3ach4l5ity4na3croft3dage5na6na4it6ry6ti4oleer6ier4stand4ung4wagon5idth4y3e4ful3g4alore4kok4ladesh:i5e4or4ui3i4sh5ter3jarmasin4o5ist4ul3k4book4note4roll5upt8cy3neker4ister4s3quet3shee3tam6weight4er4ing4u3yan2obab3tou2ptism7al6t7e8ry7ry5ze2r3abbas4ck3b4acoa5dian6os5ra6ella6ian7c7sm7ty6ossa7us6y4ecue5ll5que5rry6shop4ie5turate4our4ra4uda3celona8eta4lay3deen3e4back4faced5oot4handed5eaded4nts3f3gain4e3ista4tone4um3k4ley3ley4ow3maid5n3n4abas6y5cle5rd5ul4ett5y4storm4um4yard3oda4meter7ric4n5ess6t5ial4que3quisimeto3r4ack6uda5ge5nquilla4el5n5ra5tt7e4icade5e5o5ster4on5om5w4y5more3t4ender4h5oldi7omew4lett4on4ók3uch3yshnikov2sal5t3e4ball5oard4l5ess5ine4man5en3h4ful4o3ic5ally4e4l5ica4n4s3k4et6ball3que3ra3s4eterre4i5net5st4o5on7ist3t4ard7ize4e4ille5on2t3aan3ch3e3h4e4house4mat4os4robe6om4sheba4tub3ik4sta3man3on3sman5en3talion4en5ry4le6field6ground6ship4y3u2uble3d4elaire4ouin3er3haus3m3xite2varia7n2wdiness4y3l2xter2y3berry3esian4ux3lor3onet5ne4u3reuth3watch2zaar3illion3ooka1b2b2c2q1c1e2ach5comber5head4on3d4le4y3gle3k3m3n4bag3r4able4dmore5sley4ish4naise4skin3sley4t5liness3t4en4ific8ation6y5tude4lemania6s4nik4rice6x6z3u4fort4jolais4marchais5ont4regard4teous5ician6fication7ul7y5y4voir4x3ver2bop2calm4me4use3htel3k4et6t4ley4on4y3ome3querel2dazzle3bug3clothes3e4ck4vil3fellow3lam3ouin3pan3raggle4idden4ock5ll5om3side4ore4pread4tead3time2e3be3ch5nut3f4aroni4burger4steak4y3hive3keeper7ing3line4zebub3n3p3rbohm3swax3t4hoven4le4on3ves2fall6en3ell3it3og4re6hand4ul3riend3uddle2g3an4t3et3gar3in3one5ia4t5ten3rudge3uile4n2half5ves4n4ve5ior8al3ead4ld4moth4st3ind3old6en4ove3ring2iderbecke3ge3jing3rut2kesy2la4bor4rus4ted4u4y3ch3eaguer4m3fast4ry3gian5um4rade3ie5f5vable6e4nda4ttle4ze3l4a5donna5my5trix4boy4e5ek4hop4icose8ity5gerence;y:t5ngham6i4ow4wether4y5ache5button5ful3mont5pan3oit4ng4ved4w3shazzar3t4ane4way3ushi3ying2moan3use2n3acerraf4res3ch5ley5mark3dix3eath4dict8ine9on4faction8or8ress5ice8nce9t7ial9ry6t4lux4t5ton4volence9t3gal6i4hazi3ighted5n4n4ta5o3jamin3nett4ie4y3son3t4ham4ley4on3umb3z4edrine5ne2owulf2queath5st2rate3ber3eave4ft4nice4t5ta3g4en5rac4man4son3ia4beri4ng3keley4shire3le4in5oz5tz3m4uda3n4adette6ine5nke5rd7o5ys4bach4e4hardt4ice5e5ni4oulli4stein3ra4y3serk3t4a4elsmann4h5a4ie5llon4ram6nd3wick3yl5lium3zelius2seech4t3ide4ege3mirch3om4t4ught3peak4oke7n3s4el5mer4ie3t4ial7ity6ry5r4ow6al4rid7den7e5ode4seller2t3a4ke6n3cha3elgeuse3h4any4e5sda4ink4lehem4ought4une3ide3oken4ok3ray6al4oth7al3sy3te4ie4or4y5e3ween4ixt2ulah2vel4rage5ley6y3y2wail4re3ilder4tch2yer3ond1ff1hopal2utan4to1i2alystok3nca4nual3s3thlon2b3le4ical5ographer;ic=al;y6phile3ulous2c3ameral3entennial4p3ker3uspid3ycle6ist2dden4le4y3e4n4t3irectional2ennial3rce2ff3ocal3urcate8ion2g3amist5ous5y3foot3gie4les3hearted4orn4t3mouth3ot5ry3query3wig2ke3ini3o2lateral3bao4o3e3ge3ingual4ous3k3l4board4et4fold4iards5e5on7aire7th4ow6y4y2mbo3ini3onthly2n3ary3dery3ge4hamton4o3nacle3ocular4mial2ochemical8st:ry3degradable4iversity3feedback3gen4rapher8ical8y3ko3logical7st6y3medical3nic3physicist9s4sy3rhythm3sphere3technology2partisan7te3ed5al3lane3olar2racial3ch3d4bath5rained4cage4house4ie4seed6ye4watcher3etta3kenstock3mingham3o3th5day5mark5place5rate6ight5stone2scay6ne4uit3ect6ion6or4xual8ity3hkek4op6ric3marck6k4uth3on3que5ick3sau3tro2t3ch5y4oin3e3map3net3ten5rn6sweet4orrent3umen5inous2valve3ouac7ked8ing2weekly2zarre3et1jerknes2ork1k1lab4bermouth3ck5ball6eard7rry6ird6oard6urn5currant5en5foot5guard5head5ish5jack5list5mail5out5sburg6hirt6mith6tone5thorn6op5well3dder4e3h3ine4r3ke3me5less5worthy4mo3nca5h6ard6e5mange4d5ishment4k5enship6t4tyre3re4ney3spheme8ous8y4t5off4é3t4ant4z3vatsky3ze4on2dg2each4k4ry4t3d3ed4p3mish3nch4d4heim4t3ss4t3tch3vins3w2igh5t3mp3nd5fold5side4g4k4tz6e3p3ss5ful4ter3the4z3vet3zzard2oat5ware3b3c4h4k5ade6ge5buster5chain5head6ouse3emfontein3g3nd5e6l5ie3od5bath5curdling5hound5less5mobile5shed7ot6tain7ream6ucker5thirstiness;y5y4m5field5ingdale8ton5sburg9y4per3ssom3t4ch6y3use3w4gun4n4out4sy4torch4up4zy2t2u3bber3cher3dgeon3e4beard6ll6rry5ird5ottle4fish4grass4jacket6y4nose4print4stocking4tooth3ff3ish3nder7buss4t3r4b4ry4t3sh4ter7y2vd2ythe1m2w1o2's'n4un2a3r4dinghouse5room5walk3st5ful3t4man5en4swain2b3bi5e5n5tt4le4y3cat3olink3sled3tail3white2ccaccio2de4ga3hidharma5sattva3ice3kin3y4building4guard4work2eing3otia7n3thius2g3a4rt3ey5man6en3gle4y3ie3on4sity4tá3us3y2hemia7n3r2il4erplate3nk3se4terous2jangles2la3d4face3e4ro4yn3ivar5ia7n3l4ywood3ogna4ney3shevik8sm9t5oi4ter3t4on4zmann2mb4ard7ier5st7ic5y4shell2nanza4parte4venture3bon3d4age4sman6en3e4head4less4y3fire3g4o3hoeffer3iface4ta5o3kers3n4et5ville4ie4y3o3sai3us3y2o3b4y3dle3gie3k4case4end4ie5sh4keeper8ing4let4maker7ing6rk5obile4seller5helf8ves6op5tore4worm3le5an3m4erang3n4docks6ggle4e3r4ish3st3t4black4ee4h4ie4leg6ss4strap4y3ze4y2p2rax3deaux5llo5n5r6land7ine4on3e4as4dom3g4ia4lum3is3k3laug3n4e5o3obudur4din4n4ugh3row3sch6t3u2s'n3ch3e3h3nia3om3porus3s4iness4y3ton6ian3un3well2t3anical6st5y3ch3h4ersome3net3ox3swana3ticelli4le6neck4om6less3ulism2udoir3ffant3gh5t3illabaisse6on3lder4evard5z3nce5y4d5ary5en5less4teous5iful5y3quet3rbaki5on4geois9ie4nemouth3strophedon3t4ique4onnière2vary3ine2w3ditch4lerize3el5l4n4ry3ie3l4der4egged3man4en3sprit4tring2x3car3en3wood2y3cott3friend3hood3ish3le3senberry2zo2ötes1p2m1r2a3ce5let4ken6t5ish4t3dbury4dock4enton4ford4ley4shaw5treet4y3g4g5art3he4ma6gupta6n7ism6putra5in5s3id4lle4n5child:ren5less5storm5teaser5wash5y4se3ke5man6en3mble4pton3n4ch4deis6n7burg5i6e6sh5o6n5t5y4t3que3sh4ilia4siere5y3t4islava4tain5y3vado4e5ry4o4ura3wl4n5iness5y3y3zen4ier5l6ian4os4zaville2each4d5basket5fruit5th5winner4k5able6ge5down5fast5neck5points5spear5through5up5water4st6bone6plate6stroke6work4th6able6e6less6taking6y3cht4kenridge3ech4d4ze5iness5y3men5rton3nda6n4nan5er4t5on3t4hren4on4t3viary5ty3w4ery4ster3xit3zhnev2ian5a5na4r3be5ry3ce4k5bat5layer8ing3dal6veil4e5groom5smaid4ge6head6port6t7own7t8e6work5man4le3e4f5case3g4ade6oon5nd7age6tine4gs4ham5t6en6on4id5tte3lliance9y8t5o3m4ful7l4stone3ndled4e4k5ley5manship5smanship4y3quet7te3sbane4k5et4tle6y5ol3t4ain5nnia8c9a4ches4ish4ney4on4t5any5en5le5ney2no2oach4d5band5cast6loth5en5loom5side6word5way3bdingnag;ian3cade4coli4hure4k3gan4ue3il3kaw4e5n6hearted5rage3mide5ne3nchi7al7tis6o6us5o4son4te5osaur:i:us4x4ze3och4d4k5e5lyn4m5stick3s3th5el6rhood7liness3ught4haha3w4beat8en4n5e5ian6e6sh5out5shirt6tone6ville4se2r2ubeck3ce4kner3eghel3in4se3mmel3nch4ei5lleschi5t6te4hilde4o4swick4t3sh5wood4k4que4sels3t4al6ity7ze4e4ish4us2yan5t3ce3nner3on2zezinski1s1tu2w1ubble5y3er2ccaneer3hanan5rest4enwald4wald3k4board4et6ful5ye4ingham4le6y4ner4ram4saw5hot5kin4teeth5ooth4wheat4yball3olic2d3apest3dha5ism7t4y3ge5rigar5t6ary4ie3weiser2ff4alo4et4oon7ery4y3ord2g3aboo4tti3bear3gy3le3zilla2ick3ld5up4t5in2jumbura2khara6in2lawayo3b4ous3finch3ganin5r6i7a8n4e4y3imia6c3k4head4iness4y3l4dog6ze4et6in6proof4fight6nch5rog4headed5orn4ion5sh4ock4pen4ring4shit4winkle4y3rush3tmann3wark2m3ble6bee3p4kin4po4tious4y2n3ch5e4ombe3desbank6tag4le3g4alow4hole4le3in4on3k4house4um3ny3sen3t3yan2oy4ancy6t2r3bank4erry4le3ch3den6some4ock3eau6cracy9t:ic<ally6x3g4eon5ss4her4lar7ize7y5e4oyne4undian7y3ial3ka4e4s3l4ap4esque4iness6gton3ma4ese3n4ett4ish4oose5us6t4side4t3p3r4is5to4o5ughs5w3sa5r4itis4t3t4on3undi3y2s3boy4y3ch3h4el4ido5ness4man5en4nell4whack4y3iness8like8man9en8woman;en3t4le3y4body4work2t3ane3ch5ery3ler3t4e5rcup6fat7ingers7ly6milk6nut6scotch6y4ock5n6hole4ress2xom3tehude2y3out2zz4ard4kill4word2ñuel1y2blos2e3law4orussia2gone2law3ine2ob2pass5t3lay3roduct2rd3on5ic2stander2te2way3ord2zantine7um0c1a2b3al4na4ret3bage4ie4y3ernet3in5et7maker3le5cast5gram3oodle5se4t3ral4era4ini2cao3he5t3kle3ophonous8y3ti4us2daver7ous3die5sh4y3ence5za4t3ge3illac4z3mium3re3ucei6us2edmon3rphilly3sar6ean6ian4ura7e2feteria3feinated7e3tan3é2ge4y3iness3ney3y2hokia4ot2iaphas3n3rn4o3sson3tlin2jole6ry3un2ke2l3abash4is4mine6tous7y3cify5ne5te5um4ulable7te8ion8or6i6us5tta3der6on4ron4well3eb4donia4ndar4xico3f4skin3gary3houn3i4ban5er5rate8ion8or4co4f5ornia:n4gula4per5h6ate4sthenic3k3l4able5ghan5han5o5s4ie5grapher:y5ope5per5sthenics7o4ous5w4us3m3oocan4ric6e6fic3umniate6y3vary4e5rt4in6ism8t9ic3yces4pso4x2m3acho4raderie5illo3ber4ia5um4odia8n4rian6c6dge3corder3e4l5lia5opardalis6t4mbert4o4ra6man7en6woman9en5on6on3illa6e4sole3oens4mile4uflage3p4aign5nella6ile8i4bell4fire4ground4hor4inas4os4site4us4y3ry3shaft3us2n3't3aan4da5ian4l5etto4pé4rd5y4sta4veral3berra3can4el6ation6lation5r6ous4un3dace4elabra9um4ice5d6acy7te6e4le6light6stick4or4y3e3ine4ster3ker6ous3nabis4ery5s4ibal8ism:tic9ze5ness4on6ade6ball5t4y3oe5ist4n5ical6zation7e4pus5y3t4abrigian5loup9e5nkerous5ta4een5rbury4icle5lever4o5n6ese5r4rell4u3ute3vas6back3yon2p3ability5lanca6e6y4cious6tance7or7y4rison3e4k4lla4t5ian5own3h3illary4strano4tal7ism9t:ic8zation9e5ol7ine5ulate9ion3let3on5e4te3puccino3ra4i5ce6ious6orn3size4tan4ule3t4ain7cy4ion6us5vate8ion6e6ity4or4ure3uchin4let2r3a4calla6s5ul4fe4mel4pace4t4vaggio6n4way3bide5ne4ohydrate5loy5n6ate8ion6dale6iferous5rundum5y4s4uncle5retor3cass4inogen:ic7ma9ta3dboard4enas4iac5ff5gan5n6al5o6gram6logist9y6pulmonary6vascular4ozo4sharp3e4en4free5ul4giver4less4t5aker4worn4y3fare3go3ib5bean5ou4cature9ist4llon4na4ssa3jack3l4a4ene4in4o4sbad5on4ton4yle3mela6la6o5n4ichael5ne3nage5l5p5tion4egie5lian5y4ival6ore8ous4ot3ol5e5ina7e7gian7ian5yn4m4tid4usal6e7l3p4al5thian4el5nter7ry5t6bag4i4ort4us3r4anza4el4iage8way5e5llo5on4oll5t5usel4y5all5out3sick4on3t4el5rsville5sian4hage7inian4ier5lage8inous4ographer:y5n5on7ist4ridge4wheel5right3uso3ve3y4atid2sablanca4ls4ndra5ova3cade3e4in4load4work4y3h4back4ew4ier4mere3ino4o3k4et3par4er4ian3sandra5tt5va4erole5tte4ia5e5no5opeia5us4ock3t4aneda7t5way4e4igate8ion8or5llo4le6reagh4off5r4rate7ion5ies5o3ual6ty4ist7ry2t3aclysm9ic5omb4falque4lan5epsy7tic5ina5og7ue6nia5pa5ysis7t6tic6ze4maran4pult4ract5rh4strophe:ic<ally4tonic4wba3bird4oat3call4h5all5phrase5up5word5y3echise8m7ze4gorical8zation9e7y4rpillar5waul3fish3gut3harses7is6tic5y4edral5r6ine5ter4leen4ode5lic8ism9ty4ryn4y3iline4on3kin3nap4ip3o3skill4up3t4ail4iness4le6man7en4y3ullus3v3walk2ucasian6oid6us4hy4us3dal3ght3ldron4iflower4k3sal6ity5tion7ve4e5less5way4tic7ally3terize4ion7ary6us2valcade5ier5ry7man8en3e4at4man5en4ndish4rn6ous3iar6e4l4ty3ort4ur2w2xton2yenne3man3uga1b1c1d1ease5fire5less3usescu2bu4ano2celia3il5e5ia5y2dar3e3illa3ric2iling2lebes5rant7te8ion8ory6ity4rity5y4sta6e6ial3gene3ia4bacy6te4na3l4ar4i5ni5st4o5phane4ular6ite6oid7se3sius3t4ic2ment4tery2notaph4zoic3ser4or6ious6ship4ure5s3t4aur7us4enarian8y6nial5rfold6piece4igrade8m9me5liter5me7ter5pede4ral7ization9e5ifugal9e6petal6st4urion6y2o2phalic4eid5us2ramic3berus3eal4bella8um5ra7l6um4monial8ous7y4nkov4s3f3ise3tain7ty4ifiable7cate:ion6y5tude3ulean3vantes4ical6es5x2sar5ean5ian3ium3sation4ion4na4pool2tacean3us2ylon2zanne1f2c1h2'in2ablis3d4wick3fe4f5inch3gall4rin3in5saw4r5lift5man8ship6en5person5woman8en4se4tanya5in3ldean4et4ice4k5board5y4lenge3mber7lain7maid7sburg5ray4eleon4my4ois6x5mile4p5agne6ign5ion8ship5lain5ollion3n4ce6l7lery8or:sville6ry5y4delier5igarh5ler5on5ra7gupta7sekhar4el5y4g5chun5e6able6ling6over5sha4nel4t5ey5icleer6lly5y4ukah3os4tic7ally3p4arral4el5ron8e4lain8cy5et5in4man4paquiddick4t4ultepec3r4acter9istic>ally:zation;e5de4bray6oil4coal4donnay4ge6able4iot7eer5sma8tic5table9y6y4latan5emagne6ne6s7ton6y5ie5otte9sville9town4m5aine5in4olais5n4t5ism5res7use4woman7en4y5bdis3se4ity4m4sis4te6n5ise6ty4uble3t4eaubriand7s4tahoochee6nooga5el6rbox7ley7ton5iness5y3ucer4ffeur4ncey4tauqua4vinism9t:ic3vez3yefsky2e3ap5en5skate4t3chen5nya4k5book5erboard5list5mate5out5point5room5up3ddar3ek5bone5iness5y4p4rful5iness6os5leader7ss5y4se6burger6cake7loth5y4tah5os4ver3f3khov3lsea4yabinsk3m4ical5se6t7ry4otherapy3n4ey4gdu4ille4nai3ops3ri5e5sh4nenko5obyl6myrdin4okee5ot4ry4ub6ic7m4vil4yl3sapeake4hire4s5board5man6en4terfield7ton5nut3valier4iot4rolet6n4y3w4y3yenne2i3anti4roscuro3ba4cha3c4ago7an5na6ery6o4hi4k5adee6saw5en7pox5pea5weed4le6ts4o5ry3dden4e3ef5tain3ffon3gger4non3huahua3lblain4d5bearing6irth5care5hood5ish5less6ike5proof5ren4e5an4i4l5i5y3maera4borazo4e5ra6ical4ney4p5anzee4u3n4a5town4chilla4ese4k4o5ok4strap4tz6y3p4ewyan4munk4pendale6wa3quita3rico4opodist8y6ractic:or4p4rup3sel4holm4inau3t4chat4in4lings7s4tagong5erlings3valrous7y5s4e2loe4ride6nate9ion7e5ofluorocarbon7orm6phyll2ock4olate4taw3ice4r3ke3ler6a6ic5sterol3mp4sky3ngqing3ose6y5y3p4in4piness5y4ra4stick3ral6e4d4e5ograph;ic;y4ister4tle4us3se5n3u3w4der2retien3is5t6a6church6en8dom8sen6i7an9ity7e7na8e6mas6oper8her6y3omatic5e5ium5osome4nic7ally7le5ological9y6meter3ysalides8s6nthemum5ler5ostom5tal2ubbiness5y3ck5hole5le3g3kchi3m4ash4miness5y4p3ng5king4k5iness5y3rch6goer6ill6man7en6yard4l5ish4n4riguera3te4ney4zpa7h3vash2yron2âteau7x5laine1i2a3batta2cada6e4trice7x3ero2gar5et7te5illo2lantro3ia4um2mabue2nch5ona4innati4ture3der6ella4y3ema6scope6tic7ographer=y4rama3nabar5mon2pher3ro2rca5dian4e4le6t4uit7ous7ry5lar8ity9ze7te8ion8ory5mcise9ion6ference7lex6locution6navigate=ion6scribe:ption7pect;ion7tance:tial6vent:ion5s3rhosis4us2sco3gender3tern2tadel4tion3e3ibank4group4zen7ry7ship3ric4oen5n6ella5us4us3y2vet3ic4es4l5ian6ty6zation7e3vies1l2ack3d3iborne4m5ant4r5e5ol5voyance:t3m4bake5er4miness5y4or6ous4p5down3n4cy4destine4g5or4k4nish3p4board4eyron4ton5rap3ra4e5nce6don5t4ice5fication6y5net8ist8tist5on5ssa5ty4k5e5sville3sh4p4s5ic7al7ism9t6fiable8cation7y6ness5less5mate5room5y3tter3ude6tte5ia6ne6o6us4s5e6witz5ius5trophobia=c3vichord6le3w3y4ey4ier6st4ton2ean5liness5se5up4r5ance6sil5inghouse4t4vage5e3f4t3m4atis4enceau7y6s6t7ine4ons4son3nch3o4patra3restory4gy6man7en6woman9en4ic6al4k3veland5r3w2iburn3ché4k5able5bait3ent6èle3ff5hanger5ord4ton3i3mactic5te6ic5x4b4e3nch4e4gy4ic6al6ian4k4t5on3o3p4board4t3que5ish3t4oral6is3ve3x2oak5room3bber3che4k5wise6ork3d4hopper3g3ister3jure3mp3ne3p3rets4ox3se5fisted5mouthed5out5t4ure3t4h5e6sline7pin5ier5o4ure3ud5burst5iness5less5y4seau4t3ve5n5rleaf9ves4is3wn5ish3y2ub4feet5oot4house3ck3e4less3mp4siness5y3ng4k5y3ster3tch4ter2vi4i2xi4i4v4x3vi5i2yde5sdale3temnestra1m1nn1o2ach5man6en3gulant7te8ion3l4esce8nce4ition3rse6n3st5al5line3t3uthor3x2b3ain4lt3b4le6stone3ol3ra3web2caine3ci4us4yges5x3habamba4in5se4lea7e4ran3k4ade5mamie5too4erel5yed4fight4iness4le6shell4ney4pit4roach4scomb5ucker6re4tail4y3oa5nut4nut4on3teau2da3dle3e4ine4pendency:t4x3fish3ger3ices5il4fication5y3y2education;al3fficient3qual3rce5ion6ve3val3xist7ence2ffee6cake6house6pot5r5y4in2g3ency5t3itate7ion3nac5te4ition7ve5zance8t4omen6ina3wheel2habit7ation4n3en4re6nce7t4sion6ve3ort2if4fure3l3mbatore3n4age4cide8nce9t:al4treau3tal4us2ke2l3a4nder3bert4y3e4en4man4ridge4slaw4tte3fax3gate3ic5ky4n4seum4tis3laborate:ion;ve:or5ge5pse7ible5r6bone5te7ral6ion4eague5ct7able7ible8on8ve9ism;t:ze7or5en5ge6ian8te4ide5e6ry5n5sion4ocate8ion5id5quia9l:ism8um7y4ude5sion7ve3o4gne4mbia8n6o4n5el5ial8ism:t6st6zation7e5nade5oscopy5y4r5ado6tion7ura5blind5fast6ul5less4ssal6eum6i6us3t4ish4rane3umbia7ne6us5n6ist2m3a4nche4tose3b4at6ant6ive4ination6e4o4ustibility9le8on3e4back4dian6c6enne5own5y4liness4stible4t4uppance3fort7able:y4y3ic5al4ntern4ty3m4a5nd7ant7eer7o4emorate:ion;ve5nce6d7able:y8tion6surable:te6tary8te9or5rce7ial:ism;zation<e4ingle5serate:ion6sar9iat9y7ion5t6tal7ee4ode6ious7ty6ore5n6place6wealth5tion4unal6e6icable9nt9te:ion;ve:or7on7que7sm8t9ic7ty5tation9ve6e3o4ros3pact7ion7or5nion9able9ship9way6y5q5rability8le9y7tive6e6ison6tment;alize5ss7ion:ate5tibility8le9y6riot4el5ndia8um6sate9ion9ory5te7nce9y8t6ition9ve8or4ilation6e4lacence:y9t6in8ant8t7sance:t5ected6ment:ary6te7ion6x7ion8ty5iance8t6cate9ion7ity6ment:ary5y4o5nent5rt5se6ite8ion8or6t6ure5te5und4rehend9sibility<le;on;ve6ss8ion8or5ise5omise4ton5roller4ulsion8ve7ory5nction5serve5tation;al6e7rization:e3rade7ship3te2n3akry4n3catenate:ion5ve6ity4eal5de5it6vable:y7e5ntrate:ion8ic:ally5pción6t7ion7ual:ization<e5rn6t7i8na7master7o5ssion:aire5tta4h4ierge5liate9ion9or;y5se4lave5ude6sion8ve4oct7ion5mitant5rd7ance9t7e5urse4rete4ubine5r6rence:y9t5ssion3demn7ation9ory5nsation7e5scend9sion4illac5ment5tion9al4o5le7nce5m6inium5ne5r6cet4uce6ive6t7ion8ve9ity7or5it3e4stoga3fab4ection:ery5deracy9te:ion5r6ence5ss7ion:al7or5tti4idant9e6e7nce8t9ial<ity5gurable9tion8e5ne5rm7ation9ory5scate9ion4lagration5ict5uence8t4orm7ance8tion7ist8ty5und4ront8ation=al5ère4ucian9ism7us5se6ion5te3g4a4eal5nial9ity7tal5stion8ve4lomerate;ion4o5lese4ratulate;ion;ory5egate9ion<al>ist6ss8ional8man9en8woman;en6ve5uence8t6ity6ous3ic5al4fer7ous3j4ectural9e4oin7t4ugal7te8ion5nction9ve:itis8ure5re6or3k3ley3n4ect7icut8on8ve9ity7or5llsville5mara5ry4ie5vance6e4oisseur5lly5rs5tation9ve6e4ubial3quer7or6st5istador3rad5il4oe3sanguinity4cience8tious6ous5ript9ion4ecrate9ion6utive5nsual8s6t5quence9t:ial5rvation<ist:sm:ve9or;y7e4ider8able;y9te:ion5gn5st7ency9t4olation6e6idate:ion5mmé5nance8t5rt7ia8um4picuous6racy8tor;ial7e4table7ulary6nce8y7t8ine:ople5ellation6rnation5ipate9ion6tuency:t8te9ion<al>ity5rain9t6ict9ion:ve9or6uct9ion:ve9or7e4uelo5l6ar7te6t7ancy9t8tion:ve5mable6e7rism6mate9ion6ption9ve3t4act7able5gion8us5in5minant9te:ion4emplate:ion;ve7oraneous:ry7t8ible;y8uous5nd6t7ion9us5stant5xt7ual4iguity7ous5nence8t9al6gency9t6ua8l8nce8tion7e7ity7ous7um4ort7ion:ist5ur4raband6ception;ve7t8ile9on8or8ual6dict:ion:ory8stinction6il6lto6ption7untal6riness8wise7y6st6vene9tion5eras6temps5ibute9ion9or;y6te7ion6vance7e5ol7lable6versial:y9t4umacious6ely5se6ion3undrum4rbation3valesce:nce;t4ection5ne6ience9t6t7ion:al<ity5rge8nce9t6sant8tion<al>ist7e7ion6t7ible7or5x6ity5y6ance6or4ict7ion5nce5vial9ity4ocation5ke5luted8ion5y4ulse7ion8ve3way2o3k4book4e5ry4ie4out4y3l4ant4ey4idge5e3n3p4erate8ion9ve6stown3rdinate9ion9or4s3t4ie2p3acabana3e4ck4land4nhagen4rnican8us3ilot4ous3land4ey3perfield6head6tone6y4ice4ola3ra3se3ter4ic3ula6e6te7ion3y4cat4left4right4writer2quette7ish2ra4l3d4elia4ial7ity5lleras5te4less4oba5n5va4uroy3e4spondent4y3fu3iander4na5e5ne5th7ian4olanus6is3k4screw3leone3m4ack4orant3n4ball5read4cob4ea6l5ille5lia7us6l5rstone5t4flakes6ower4ice5sh4meal4row4stalk7rch4ucopia4wall8is4y3olla7ry4na6do6e6ry6tion6virus5er6t4t3p4ora7l7te8ion6eal4se4ulence8t5s6cle3ral4ect7able7ion:al8ve7or5ggio5late8ion9ve5spond:ence<t4idor5ne4oborate:ion;ve5de5sion7ve4ugate8ion5pt7ible8on3sage5ir4et4ica7n3tes5x5z4ical6es5sone4land4ège3uscate3vallis4ette4us3y2sby3ign6atory4ne3metic8ally6ologist:y4ic6ally4ogony5logical9st8y5naut5politan5s6db3play4onsor3sack3t4ar4co4ello4liness4ner4ume3y2t3e4rie3illion3onou4paxi3swold3tage4on6mouth6seed6tail6wood3yledon2uch3gar4h3ld5've5n't4omb4ter3ncil7lor7man8en7or7woman:en4sel7lor7or4t5able8y5down5enance6ract:ion8ttack7balance7claim9ockwise8ulture7espionage8xample7feit7intelligence7mand7offer7pane9rt8oint8roductive7revolutionAary7sank8ign9nk8unk7tenor7weight6ss5less5rified6y7man8en7side7woman:en5y3p4e5rin4le6t4on3rage7ous4bet4ier4se4t5eous6san7y5house5ier5liness5ney5room5ship5yard3sin4teau2ve4n5ant5try4rage6ll5let5t4t5ous4y3id4ngton2w3ard6ice6liness3bird4oy3girl3hand4ide3l4ey4ick3orker3per4oke5x4uncher3slip2x3comb3swain2y3ote2zen3iness3umel3y1pa2i2o2r2u1r2ab4be5iness5y3ck5down5erjack5le5pot5up3dle3ft5iness5sman9ship7en5y3g4gy3ig3m4p3nach4berry4e4ia6l5um4k5case5iness5shaft5y4mer4ny3p4e4py3sh4s3te3vat4e5n3w4fish5ord4l5space3y4fish4ola5n3ze4iness4y2eak5y4m5ery5iness5y4se4te5ion8ism6ve7ity5or5ure3cy3dence6tial6za4ibility6le7y5t6able9y6or4o4ulity6ous3e4k4l4p5iness5y3ighton3mate6ion6oria9um8y3ole4n4sote3pe4t3scendi8o7t4s5ida4tfallen3taceous5n4e4in6ous3vasse4ice3w4man5en2ib4bage3chton4k5et3me5a6n4inal6ologist:y4p4son3nge4kle6y4oline3ollo3pple7ware3sco4es4is4p5y4scross4tina3teria7on4ic6al6ism7ze5que4ter2oak4t5ia7n3ce4het4i4k5ery6tt4odile4us3esus3fts3issant3mwell8ian3ne4in4kite4us4y3ok4n3p3quet7te3sby4ier4s5bar6eam6ones7w6red8ed5check5fire5over5piece5road5town5walk7ys6ise6ord3tch6et8y3uch4p5y3w4bar4dfund4ley4n3zier3ûton2t2ucial5ble5fix8ion6orm6y3d4dy4e4ity6és3el5ty4t3ft5y3ikshank4se3ller3mb5le5y4my4pet5le3nch6y3sade4h4oe4t5acean5y3tch3x3z2y3baby3ogenics3pt5ic7ally5ocurrency6gram9pher;y6zoic3stal7ize7line9zation:e8ographic>y2èche1s2onka2t1t2esiphon2hulhu1u2b3a4n3byhole3e3ic5al5le4sm5t4t2chulain3kold5o3umber2ddle5y3gel2e2ff2isinart6e2lbertson3inary3l4en6der3minate8ion3otte3pability6le4rit3t4ivate8ion8or4ural6e3vert2m3berland6some3in3merbund3quat3ulative5i5us2nard3eiform3nilingus5ng7ham3t2p3board3cake3ful3id5ity3ola3sful2r3able4cao5y4te5ive5or3b3dle3e3few3ie4o5sity5us4tiba3l4ew4icue5ness4ycue3mudgeon3rant4ency6t4icula8um4y5comb3se4ive4or6y4t3t4ail6n4is4sey5y3vaceous6ious5ture4e4y2shion4y3p4id3s3tard4er4odial8n6y5m6ary6ization8e2t3back3e4sy3icle3lass4ery5t3off4ut3throat4lefish3up2vier2zco1vs1yanide2bele4rbully5netic5punk5sex6pace2clades5men4e4ic6al5st4one6ic5ps5tron2gnet4us2linder6rical2mbal4eline2nic5al5ism3osure3thia2press4ian5ot4us2rano3il5lic3us2st4ic2tology4plasm1zar4ina2ech5ia5oslovakia>n3rny0d1'arezzo2estaing1a2b3ble2cca3ha5u4shund3ron3tyl6ic2da4ism3dy3o2edalus3mon2ffodil4y3t2gger3uerre8otype3wood2hlia3omey2imler3ntiness5y3quiri3ry5maid7n6en3s4y2kar3ota6n2lai3e4y3i4an3las4iance4y3matian3ton2m3age4scus5k3e3ian4en4on3n4able7y5tion4dest3ocles4n3p4en3sel4on2n3a3bury3ce3delion5r4le4ruff4y3e4law3ger6field6ous4le3ial4el6le4sh3k3nie4y3one3te4on3ube5ian3ville2phne3per4le2rby3cy3danelles3e4devil4n3fur3in4o4us3jeeling3k4en4room3la4ene4ing3n4ell3rel6l5n4in4ow4yl3t4board4h4moor6uth3von3win6ian7sm3yl2sh4board4iki3tardly2t3a4base4mation4type3e4line3ive3um2ub3gherty5ter3mier3nt5less3phin2vao3e4nport3id5son4s4t3y2wdle3es3n3son2y3bed4reak3dream8t3light3time4on2ze3zle1b1c1d2t1e2acon6ess4tivate3d4beat5olt4en4head4line5ock4pan4wood3f4en3l4ership4t3n4a4dre4n5a5e3r4th3th5bed6low5less6ike5trap3ves2b3acle4r5k6ation4se4table5e4uch7ery3bie4y3enture3ian4litate9ion7y4t3onair4ra6h4uillet3ra4ief5s3t4or3ug4nk4ssy4t2c3ade6nce7t4f5feinate4l5ogue4mp4nt4pitate9ion4thlon5ur4y3ca5n3ease4dent4it6ful5ve4lerate9ion4mber4ncy5t6ralization;e4ption7ve3ibel4de5uous4mal6te7ion4pher8able4sion6ve3k4hand4le3laim5mation8ory5ration9ve6e5ssify4ension4ination6e5vity3ode4lonization9e4mmission5pose8ition6ress:ion4ngestant5struction5taminate<ion4r5ate7ion8ve7or5ous5um4y3rease5e5mented9s5pit8ude5scendi:o4iminalization<e4y5ption2dekind3icate7ion3uce5ible5t6ible7on7ve2e3jay3m3na3p4en4fake3re4skin3scalate2face4mation7ory5e4ult3eat6ism8t4cate7ion5t6ion7ve6or4nd6ant5estration5se7less6ible7ve4r5ence7tial3iance6t4ciency8t6t4le4nable5e5ite7ion8ve3late6ion4ect7ion7or3oe4gger4liant7te8ion4rest8ation5m6ation6ity3raud5y6al4ost3t3unct4se3y2gas3eneracy8te9ion:ve7es3radation6e4ee2humanization9e5idify3ydrate8ion2ice3dre3fication4y3gn3mos3rdre3sm3ty2ject6ion4sus2kalb2l3acroix6uz4ney5o4ware8an4y3bert3ectable7tion4gate7ion4on4te6rious5ion4verage3gado3hi3i4a4berate9ion6s4cacy6te8ssen5ious4ght7ful4lah4minator6t4neate8ion5quency9t5t4quescent4ria6ous6um4us4ver7ance7y3l4a3mar6va4er4onico3ores5is3phi6c6nia8um7us3ta4ona3ude4ge4sion6ve4xe3ve2m3agnetization:e5og7ic7ry7ue9ry7y4nd4rcate8ion4vend3ean6or4nted6ia4rit5ol4sne4ter5rius3igod4john4litarization;e4se4tasse3o4bilization9e4cracy7t8ic:ally9zation:e6itus4grapher9ic;ally9y4lish6tion4n5iac8al6c5strable;y9te:ion;ve:or4ralization9e4sthenes4te5ion4unt3psey3ur5e2n3a4ture3drite3eb5ola3g3iability5l4grate8ion4m4s5e4zen3mark3nis4y3ominate9ion<al9or4tation5e4uement5nce3se4ity3t4al4ifrice5n6e5st7ry4on4ure3ude4nciation3ver3y2odorant6ize3n2part6mental<ize6ure3end6ability8le9y7nce8t6ence9y8t3ict6ion4latory3lane4ete6ion4orable9y6e5y3oliticize4pulate9ion4rt6ation4se5it7ion7or9y4t3p3rave6ity4ecate8ion8ory6iate9ion5dation5ss7ant7ion8ve4ivation6e4ogram3t4h3utation5e5ize5y2rail4nge3by3egulate9ion4k4lict8ion3ick4de4sion6ve5ory4vable6tion8ve5e3matitis6ologist:y4is3ogate7ion7ory3rick5da5nger5ère3vish2salinate9ion3cant5rtes4end7ant7ent6t4ribable7e6ption9ve8or5y3demona3ecrate8ion4gregate:ion4nsitization:e4rt6ion5ve3iccate8ion4derata9um4gn6ate8ion4rability7le8y5e6e5ous4st3k4top3mond3olate7ion3pair5tch4erado7te8ion4icable9y5se5te4oil5ndency9t5t6ic7sm3sert3tabilize4ination6e6y5tute8ion4roy5uct8ible9on9ve3ultory2tach6able4il5n6ee3ect6able6ion7ve6or4ntes6ion4r5gent5iorate:ion5minable9nt9te:ion8e8ism:tic5rence8t4st6able7tion3hrone3onate7ion7or4ur4x5ification7y3ract7ion7or4iment9al5tus4oit2uce3terium6onomy2valuation6e4nagari4state8ion3elop7mental3i4ance6t5te6ion4ce4l5ish5ry5try4n4ous4se3oid4lution5ve4n5ian4te6e5ion8al4ur5t2w3ar4yne3berry3drop3ey3itt3lap3y2xedrine3ter6ity6ous4rose6us1haka3rma3ulagiri2oti2s1i2abetes6ic4olic8al3critic9al3dem3ghilev4nose7is7tic:ian4onal4ram7matic3l4ect7al7ic4og6ue4yses6is5zes3meter6rical4ond3na4e4n5a5e3per4hanous5ragm3rist4rhea6oea4y3spora4tolic3tom4ribe3z2bble2caprio3e4y3hotomy3ier5st3k4ens5rson5y4ie5nson4son4y3ta5phone5te6ion6or8ial8ship4ion7ary4um2dactic3dle3erot3n't3o3rikson2e3fenbaker3go3hard3m3reses6is3sel3t4ary4etic4ician5tian4rich2ff4erence8t9ial;te<ion4icult9y5dence8t4raction4use6ion2g3estible7on7ve3it5al7is5ization7e3nify5tary6y3raph4ess7ion8ve2jkstra3on2ke2lapidated9ion4te5ion5ory3bert3emma4ttante9i:sm3igence7t3l4ard4inger4on4y5dally3ute5ion2m3aggio3e4nsion9al9less3inish5uendo6tion8ve3ple3wit2n3a4h3e4tte3g4hy4iness4o4y3k4y3o4saur3t2ocesan6e4letian3de3genes3n4ne4ysian6us3phantine3r4ama3xide5n2p3htheria6ong3loma7cy7t8a8ic:ally3ole3somania:c4tick2rac3e4ct6ion9al7ve6or8ate8ial8ship8y3ge3ichlet4gible3k3t4ball4iness4y2sability5le5use4dvantage<ous4ffect9ion4gree8able;y4llow4mbiguate;ion4ppear9ance6oint6robation8val9e4rm6ament5range7y4ssemble6ociate5ter6rous4vow7al3band5r4elief8ve4urse3c4ard4ern7ible4harge4iple7inarian;y9e4laim5ose7ure4o5lor8ation5mbobulate6fit9ure7ort6mode6pose9ure5ncert6nect:ion6solate6tent7inuance;tion:e:ity:ous5rd7ant5theque5unt8enance6rage7se7teous9sy5ver8y4redit9able6et6pancy6te7ion:ary5iminant:te;ion;ory4ursive5s6sant7ion3dain7ful3ease4mbark9ation6ody7wel4nchant6umber5franchise5gage5tangle4stablish3favor4igure4ranchise3gorge4race8ful5untle4uise5st3h4armonious9y4cloth4earten5vel4onest9y6or8able;y4pan4rag4towel4washer6ter3illusion4ncentive6lination9e5fect9ant6ormation5genuous5herit5tegrate;ion7r3joint3k4ette3like4ocate8ion5dge5yal8ty3mal5ntle5y4ember4iss7al7ive4ount3ney6land3obedience:t6y5lige4rder8liness5ganization:e5ient9ation4wn3parage7te6ity5ssionate5tch4el5nsable8ry8tion7e5rsal7e7ion4irit4lace6y7able5ease8ure4ort5sable7l6e6ition6sess:ion4roof6portion=ate6ve8n4utable7nt7tion:us6e3qualification9y5iet6sition3raeli4egard5pair6utable;y8e5spect:ful4obe4upt7ion8ve3satisfaction9y4ect7ion5mble6inate:ion5nsion6t5rtation6vice4idence8t5milar:ity6ulate:ion5pate8ion4ociate9ion5lute8ion6ve5nance8t4uade6sion3taff5nce6t5ste8ful4emper5nd6sion6tion4il6l7ate9ion7ery5nct8ion9ve6guish;able4ort7ion4ract8ion6it6ught5ess8ful5ibute9ion:ve9or6ct5ust8ful4urb7ance3unite7y4se2tch3her3to4y2uretic4nal2va4n3e4rge7nce8t5se6ification8y7on9ary7ty5t3ide6nd4nation5e5ity4sibility7le6on8al6ve5or3orce6ée4t3ulge3vy2wali2x3ie5crat5land3on2zziness4y1j2akarta3ngo2ibouti3nn5i1mca2itri2z1na2epropetrovsk2ieper4ster1o2a3ble2bbin3erman3ro2c3ent3ile5ity3k4et4yard3tor6al7te6ow4rinaire8l7e3udrama4ment8ary9tion2dder3ge4son4y3o4ma3son2e3sn't2ff2g3catcher3fight5sh3gerel4ie4one4y3house3ie3ma5ta6ic8ally7sm8t3trot3wood2ha2ily2lby3drums3e4ful3l4ar4house4ie4op4y3men3ores5ous3phin3t4ish2main3e4sday5tic8ally9te:ion8ity3icile4nance7t6te7ion5eer5go6uez5ic7a8n7k6on6que5o4tian2n3't3a4hue4ld6son4te6llo5ion3e4tsk3gle3izetti3key3n4a4e5ll4ie4y3or4van3ut2odad4le3hickey3ley4ittle3m4sday3nesbury3r4bell4knob4man6t5en4step6op4way2pe4y3pler3y2ra3cas3een3ian4c4s4tos3k4y3m4ancy6t4ice5tory4ouse3othea6y3sal4et5y3thy4mund3y2sage3e3sier3toevsky2t3age3com3e3h4an3son3ty2uala4y3ble6day6t5oon5y4t5ful5less3che3g4h5nut5ty5y4las3r4o3se2ve4tail2w3ager3diness4y3el3n4beat4cast4fall4grade4hearted5ill4load8able4play5our4right4scale5ize5tage7irs7te6ream5wing4time5own5rodden5urn4ward5ind4y3ry3se2xology2yen3le2z3e4n1p2i2t1r2ab3chma7e7i4o5nian4ula3ft5ee5iness5sman9ship7en5y3g4net4on6fly5on3in5age5pipe3ke3m4a5mine5tic8ally7st7zation8e4buie3nk4o3pe5ry3stic7ally3vidian3w4back5ridge4l4n4string3y2ead5ful5locks5nought4m5land6ess6ike5y4riness5y3dge3gs3iser3nch3sden4s5age5iness5maker8ing5y3w3yfus2ibble4let3ft5wood3ll3nk5able3p3stan3ve5l5n5way3zzle6y2oid3ll5ery5y3medary3ne3ol4p5y3p4box4let4out4sy3ss3ught4th3ve3wn4se5iness5y2ub3dge6ry3g4gist4store3id3m4stick3nk5ard5en3pal2y3ad3den3wall1schubba2t1tp1ual4ism5ty3ne2b3ai3cek3he3iety4ous3lin3rovnik3uque2cal4t3hamp4ess4y3k4bill4ling3t4ile6ity4less2d3e3geon3ley2e3l4ist4list3t2ff4y2g3out2h2i3sburg2ke4dom2lcet4imer3l4ard4y3ness3uth3y2mas3b4bell4found4ledore4o4waiter3found3my3p4ling4ster4y2n3ant3bar3can4e3e4din3g4aree4eon3k4irk3lap3n4e4o2o3dena7l6um2pe3lex4icate8ion8or6ity3ont2rability5le6y4cell4n5t6e4tion3ban3ess4x3ham3ing3kheim3oc5her2se3hanbe3k4y3t4bin5uster4in6ess4less4man5en4pan4y2tch5man6en3eous3iable4ful3y2valier3et1vd2ina2orák2r1warf5ish7m4ves3yne2eeb3ll4t2i3ght3ndle1yadic2e3stuff2ke2lan2namic7al6sm6te5o6db4stic6y2sentery3function;al3lexia7c3on3pepsia6tic1z2erzhinsky2ungaria1ébutante2colleté2railleur2tente1ürer2sseldorf0e1'er1a2ch2ger3le5t2kins2r3ache3bud3drum3ful3hart3l4dom4e5ne4ine7ss4obe3mark4uff3n4estine4hardt3p4hone4lug3shot4plitting3th5en7ware5iness5ling5quake5shaking5ward6ork8m5y3wax4ig2se4l3iness3t4bound4ern7most4man4ward5ood3y4going2t3able3en4ry3on2ve4sdrop1bay2b2en4eezer3rt2ola3nics4y2ro2ullience8t1c2centric9ally9ity3lesiastes:ic<al2g2helon3o2lectic8ally8ism3ipse5tic2mascript2o3logical7st6y3nometric6ic8al7st7ze6y3system3tourism2ru2stasy5tic8ally2uador7an7ian3menical2zema1d2am4ame2da3ie4ngton3y2elweiss3ma3n2gar5do3e4ways5ise3iness3y2ibility4le3ct3fication6e4y3nburgh3son3t4able4h4ion4or6ial9ize6ship2mond5ton3und2na2sel2t2uardo3cable5te6ion9al6or2ward6ian6o3in5a1ec2g2l2o2rie4ness3y2yore1fface3ect6ive6ual8te4minacy8te4rvesce:nce;t4te3icacious7y5iency8t4e4gy3luent3ort6less3rontery3ulgence8t4sion6ve2l2rain3en1galitarian;ism2g3beater3head3nog3o3plant3shell2is2lantine2o3centric3ism5t6ic3tism6t7ic9al2regious4ss4t2ypt5ian5ology1h2renberg3lich1ichmann2der5down2ffel2genvalue3ht5een8th5h5ieth5y2leen2nstein2re2senhower5stein3ner2ther1jaculate8ion2ect5ion1ke2g1laborate8ion3ine3m3nor3pse3stic7ity7search5oplast3te4ion2ba3e4rt3ow5room3rus2der5berry5care5sburg4st3on2eanor4zar3ct5ion8eer6ve5or7al8te5ra6ic8al8ian9ty7fication8y6ocardiogram@ph8ute:ion7de8ynamics7encephalogramCph7lysis9te:ic7magnet=ic>sm7n8ic:a;lly7plate7static3gance6t4iac4y3ment7al8ry3na3phant8ine3vate6ion6or4en6th2f3in4sh2gar2i3as3cit3de3gibility6le3jah3minate8ion3nor3ot3sa5beth4e5o4ha4ion3te4ism6t3xir3za5beth9an9town2k3hart2l3a3en4smere3ie4ngton4ot6t4pse6is5tic8al4s5on2m3a3ira3o2nath3ora2ocution9ist3him3ise3ngate7ion3pe3quence7t3y2roy2sa3e4where3ie4nore2tanin3on2ucidate8ion3de3l3sive2va3es3ia4n4ra4s5h2way3ood2yria3sian5um4ée1m2aciate7ion4s3il3nate6ion4cipate9ion9or4uel3sculate9ion2balm4nkment4rgo5k6ation5rass4ssy4ttled3ed4llish4r4zzle3itter3lazon4em6atic3odiment5y4lden5ism4ss3race4oider9y6l4yo6logist9y6nic2cee2end5ation3rald4ge6nce8y7t4itus4son4y3tic2igrant6te7ion3l4e4ia5o4y3nem5nce6t3r4ate3ssary5ion3t2ma4nuel3ett3y2o3ji3llient4ument3ry3te4icon5on7al9ism5ve2panel4thetic6ize6y3eror3hases6is7ze5tic8ally4ysema3ire5ical7ism3lacement4oy6able6e7e3oria6um4wer3ress3tiness4y2t2u3late6ion6or4sification7y6on3sic1nable3ct3mel4or2camp4psulate:ion4rta4se3ephalitis3hant7ress4ilada3ircle3lave4ose6ure3ode4mpass4re4unter5rage3roach4ust7ation4ypt7ion3umber6rance3yclical6opaedia<c8edia;c2d3anger3ear5vor4mic3ive3less3ocrine4rse4w3ue4rable6nce5e3ways4ise3ymion2ema5ta4y3rgetic9ally5ize5y4vate7ion2feeble3old4rce7able3ranchise2g3age3els4nder3ine3land4ish7man8en7woman:en3orge3rave4oss3ulf2hance2id3f3gma6tic9ally3wetok2join4y5able2kidu2large3ighten4st6ee4ven2mesh3ity2noble3ui2och3rmity5ous3s3ugh2quire6y2rage4pture3ich5o4que3ol5l4n2sconce3emble3hrine5oud3ign3lave3nare3ue4re2tail4ngle3ente4r5prise5tain3hral7l5one4use6iasm9t:ic<ally3ice4re6ty4tle5y3omb5ological:st9y4urage3rails5nce6t5p4eat7y5nch5preneur<ial4opy4ust4y5way4ée3wine2umerable7te8ion3nciate8ion3re2velop7e3iable7y4ous4ronment;al=ism?t7s4sage5ion3oy3y2zyme1ocene2n1pa3ulet7te2cot2hemeral4sian5us3raim2ic4enter4tetus4ure7an6us3demic7ology5rmal7is3glottides9s4ram7matic3lepsy6tic4og6ue3methius3phany3scopacy8l9ian8te4ode6ic4temology5le5olary3taph4het4ome6ize2och5al3xy2silon3om4n3tein1quability5le6y4l5ity6zation7e4nimity4te5ion5or7ial3estrian8enne3idistant4lateral5ibrium4ne5octial6x4p5age5oise4table8y5y4valence9t5ocal8te9ion3uleus1r2a3dicate8ion3se4mus4ure3to5sthenes2e3bus3ct5ile6on5or3whon2g3o4nomic2hard2ic4a4h4k5a5son4son5son3danus3e3k4a3n3s3trea2lang3enmeyer2ma3ine2na3est6ine6o3ie3st2ode3genous3s4ion5ve3tic6a7lly6ism2r3and5t4ta5ic7ally5um3ol4neous4r2satz3e3twhile2udite6ion3pt5ion2vin2win2ythrocyte1s2au2calate7ion7or4pade5e6e5ism7t4role5pment3hatology4er6ichia5w3ort3row3utcheon2kimo2l2meralda2ophagi7us3teric8ally2p3adrille3ecial4ranto7za3inoza4onage3lanade3n3ousal6e3resso3y2q3uire2say5ist3en5ce5e5tial4quibo4x3ie2t3ablish4te3eban4em4la5la6e4rházy3her5te6ic3imable6te7ion7or3onia7n3rada5nge4ogen3uary1t2a2c3h2ernal5ity2han3el5red4r5eal5net3ic5al4opia8n3nic6ally6ity4ological9st8y3os2iology3quette2na2on2ruria4scan2ta2ymological9st8y1u2calypti8us3harist9ic3lid6ean2gene5ia6cs6e6o2la3er3ogistic6ze5y2menides2nice3uch2phemism8tic;ally4ony5ria7c4rates2rasia7n3eka3ipides3o4dollar4pa5e6an3ydice2stachian4is2tectic4rpe3hanasia1va3cuate7ion5ee3de3luate7ion3n4escent4gelical8na9e8sm9t:ic8ze4sville3porate8ion3sion5ve2e3lyn3n4handed4ki4t5ful5ide5ual8ity7te3rett7e4glade5reen4lasting4more4ready4t4y5body5day5one5place5thing5where2ian3ct5ion3dence6t3l4doer3nce3scerate9ion3ta2ocation7ve3ke3lution9ary4ve1we1x2acerbate9ion4t5itude3ggerate9ion3lt5ation3m4ination6e4ple3sperate9ion2calibur4vate7ion7or3edrin4ed4l5lence9y8t4pt6ion9able:l4rpt4ss6ive3hange8able4equer3ise5ion4tability7le6tion5e3l4aim5mation8ory4ude5sion7ve8ity3ommunicate<ion4riate8ion3rement5scence5ta6e6ion6ory4uciating3ulpate4rsion4sable5e2ec4rable6te4utable6e6ion7ve6or6rices8x3geses6is3mplar8y6ification8y5t6ion3rcise5ycle4t5ion2halation5e4ust7ible8on8ve3ibit7ion:ism<t7or4larate9ion3ort6ation3umation5e2igency6t4uous3le3st5ence7t8ial;ism=t3t2ocet3dus3nerate8ion3planet3rbitance9t4cise7m7t6ze3tic6ally2pand6able5se6ion9ist7ve4tiate5riate9ion3ect6ancy8t7tion6orant9te:ion4dience9y8t6te7ion:ary9us7or4l4nd6able6iture5se6ive4rience6ment:al;tion5t6ise3iate6ion4ration5e5y3lain5nation8ory4etive4icable7te8ion6it4ode5it7ation:ve5ration8ory6e5sion7ve3o4nent8ial:tion4rt6ation4se5ition7ory5tulate:ion5ure4und3ress7ible8on:ism<t:less8ve7way4opriate:ion3ulsion4nge4rgate8ion2quisite2tant3emporaneous8e8ize4nd6able6ible5sion9al7ve5t5uate8ion4rior5minate:ion:or5nal3inct7ion5guish:able4rpate8ion3ol5l4rt6ion9ate9ist3ra5ct7ion7or6urricular5dite8ion5marital5neous5ordinary5polate:ion5sensory5terrestrial5vagance:t:za6ert4eme6ism8t7ty4icate8ion5nsic9ally4oversion8t4ude5sion2uberance8t3de3lt5ant6tion2xon1yck2e3ball4row3ful3glass3lash4et4id5ner3piece3sight4ore4train3teeth4ooth3witness2re2senck1zekiel2ra0f1a2a2bergé3ian3le3ric6ate8ion3ulous2cade3e4book4less5ift4palm4t5ious3ial4le5itate9ion7y3simile3t4ion7al9ism5tious4or6ial7zation8e6y5tum4ual3ulty2ddish3e2ecal4es3roe2fnir2g3got3in3ot2hd3renheit2il4ure3n4t5hearted3r4banks4field4ground4hope4ings4way4y5land3sal6abad3th5ful5less2jardo2ke3ir2lasha3con6ry3kland3l4acious6y4en4ibility6le7y4off5pian5ut5w3se5hood5tto4ifiable7cation6y5ty4taff3ter3well2me3ilial7r8ity9zation:e5y4ne4sh3ous2n3atic7al7ism3boy3ciful5ness4y3dom3fare3g3nie4y3tasize6tic9ally6y3zine2q2r3aday5ize4way3ce4ical3e4well3go3ina6ceous3ley3m4hand5ouse4ington4land4yard3ragut5khan4ell4ow3si5ghted3t4her6st5ing2scinate8ion5sm6t3hion7able:y7ista3sbinder3t4en4idious2t3ah4l5ism7t8ic6ty3e4ful3head5r6hood6land7ess4om6able6less3igue4ma5id3ten4y3uous2ucet3lkner8ian4t5finding5iness5less5y3n4a5e4tleroy3st5ian6no5us2vor5able8y5ite7ism2wkes3n2x2y3e4tteville2ze1bi1cc1da2ic2r1e2alty3r4ful4less4some3sibility6le7y4t3t4her7bedding7weight7y4ure7less2b3rile4uary2cal3es3kless3und6ity2deral7ism9t6te7ion5ico4x3ora2e3ble5y3dback6g3l3t2ign3nt3sty2ldspar3ecia3ice5ia6tous7y4ne4pe4x3l4atio4ini4ow6ship3on5ious5y3t2m3ale3inine7ity6sm7t3ora6l3ur2n3ce3ian3nel3tanyl2r3al3ber3dinand3gus6on3linghetti3mat4entation4i3n4andez7o3ocious6ty3rari6o4ell5t4ic5s4ous4ule4y5boat3tile6ity7zation8e3vency6t4id4or2st4al4ival6e6ity4oon2ta4l3ch3ed3ich4d4ng4sh6ism8t9ic3lock3ter4le3us2ud4al6ism8tic2ver5ish2w2y3nman2z3zes1ha1iancé6e3sco3t2b3erboard5glas3onacci3roid5us3ula6e2ca3he4te3kle3tion7al9ize5tious2ddle6sticks5y3el5ity3get6y3o3uciary2e3f3ld5work3nd5ish3rce4iness4y3sta2fe3teen7th4h4ieth4y2g3aro3ht3ueroa4rative5e6head5ine2ji4an2lament8ous3bert3ch3e4t3ial4buster4gree4pino3l4et4ip4more4y3m4maker4strip4y3ofax3ter6able4h5iness5y4rable6te7ion2n3agle4l5e5ist6ty6ze4nce6ial7er3ch3e4ry4sse3ger6board6nail6print6tip3icky4s5h4te3k3land4ey3n4bogadottir4egan4ish4y2ona3rd2r3e4arm4ball6se5omb5rand6eak5ug4cracker4fight5ly5ox4house4man5en4place6ug5ower5roof4side5tone7rm4trap4wall6ter5ood6rk3m4ament4ware3st5born5hand3th2scal4her3h4bowl4erman7en6y4hook4net4tail4wife6ves4y3k3sion4ure3t4ful4icuffs2t3ch5burg3ful3zgerald4patrick4roy2ve2x3able4te5ion6ve3ity3ture2zeau3z4le4y1jord1l2a3b4bergast5iness5y3ccid4k3g4ella8te9ion7um4on4pole4rant4ship5taff6one3il4r3k4e4iness4y3mage4being6s5oyance9t5é4e5nco5thrower4ingo4mability7le3n4agan4ders4ge4k4nel7et9te3p4jack3re3sh5back6ulb5gun5iness5light5y4k3t4bed5oat4car4feet5ish5oot4iron4t5en6ry5op4ulence8t4ware3ubert4nt3vor6ful6less3w4less3x4en3y2ea3ck3dged6ling5ling3e4ce5y4t3ischer3ming5sh3sh5y3tcher3w3x4ibility6le7y5time4time2ibbertigibbet3ck3ght6iness6less6y3mflam4siness5y3nch4t5lock5stones5y3p4pancy7t5y3rt5ation9us3t2o3at5ation3ck3e3g3od5gate5light7t4r5board4zie5y3p4house4piness5y3ra5e5l4ence6tine5s4id6a7n5n6e5st4sheim4y3ss5ie3tation4illa4sam3unce5der4r5ish5y4t3w4chart4erbed6iness6pot6y4n3yd2u3b3ctuate8ion3e4ncy5t3ff5iness5y3id5ity3ke5y4y3me4mox3ng4k5ey5ie5y3oresce9nce:t5idate9ion7e6ne6te5ocarbon6scope3rry3sh4ter3te4ist4ter7y3x2y3by3catcher3leaf6ves3nn3over3paper3sheet4peck4watter3trap3weight4heel1m2ri1nma1o'c's'le6le2al3m4y2b2cal3h3i3us5ses2dder2e3tal4us2fl2g3bound3ey3giness4y3horn3y2ible3l3st2kker2ld4away3ey3gers3iage4o3k4lore4sy3licle4ow6up4y3som2malhaut3ent6ation2nd4a5nt4le4u5e3t2o3bar3dstuff3l4ery4hardiness8y4ish4proof4scap3sball3t4age4ball5ridge4fall4hill5old4lights5ocker6ose4man5en4note4path5rint4rest4sie5ore5tep6ool4wear5ork2p3pish2r3a4ge4y3bad6e4ear7ance5s4id6den4ore6ne3ce5ful5ps4ible7y3e4arm4bear5ode4cast8le5lose8ure4father5eet5inger5oot5ront4gather5o6ne5round4hand5ead4ign4knowledge4leg5ock4man6st5en5ost4name5oon5sic4ordain4play4runner4sail6w5ee7able7n5hadow6orten5ight5kin5tall7tion6ry5wear6ore8n4taste5ell5hought5old4ver7more4warn5ent5oman7en6rd3feit7ure3gather5ve4e5ry5t6ful6table4ivable6e7n4o5ne5t6ten3k4lift3lorn3m4al6dehyde6ism7ty7zation8e5t6ion7ve4ica5dable9y4less4osa7n4ula7e7ic7te8ion3nicate8ion3sake7n4ook6th4ter4wear5ore7n4ythia3t4aleza4e4h5coming5right5with4ieth5fication6y5ssimo5tude4night4ran5ess4uitous5nate6e4y3um3ward4ent2sse4il6ization8e3ter2tomat2ucault3ght3l3nd5ation5ling5ry4t5ain8head3r4fold4ier4neyron4score5ome5quare4teen8th5h2wl2x3glove3hole5und3trot3y2yer1po1r2acas4k4tal5ion8al7us5ure3g4ile6ity4mentary9tion4onard4rance7t3il5ty3me5work3n4c5e6sca5hise9e5ine6s7ca9n8o5k5o6is8e4glais4k5el6nstein5fort6urt5ie6ncense5lin4ny4tic7ally4z3ppes5é3ser3t4ernal7ity8zation9e4ricide3ud5ulence9t4ght3y3zier4zle2eak5ish5y3ckle3da4die5y4eric8k9sburg8ton4ric7k3e4base5ee5ie5ooter4dman6en5om4hand5old4lance5oad4man6son9ry5en4standing6yle4thinker9ing5own4ware6y5heel5ill4ze3ida4ght3mont3nch6man7en6woman9en4etic8ally4zy3on3quency7t3sco4h5en6t5man6en5water4nel5o3t4ful4work3ud5ian3y4a2i3able4r3cassee4tion3day4ge3eda6n5man8n4nd6less7iness6ship4ze3gate4ga4ht6en6ful4id6aire6ity3ll5y3nge3ppery3sbee4co4ian4k5iness5y3to4ter4z3volity6ous3zz5le5y2o3bisher3ck3g4man5en3issart3lic6ked7ing6some3m4m3nd5e4t5age6l5enac5ier8sman:en6spiece5runner3st5belt6it8e8ten5iness5y3th5y3wn4sy4zy3ze5n2uctify5ose3gal6ity3it5cake5ful5ion5less5y3mp5y3strate8ion2y3e1sf2lic1t2c2p1uchs5ia3k2d3dle3ge2el3ntes2gger3itive3ue2ji4tsu4wara2kuoka4yama2lani3bright3cra5um3fil6l3l4back4y3minate8ion3ness3some3ton2m3ble3e3igate7ion7or2n3afuti3ction8al:ity9ry3damental;ism=t4y3eral5eal3gal4i5cidal8e4ous4us3icular3k4y3nel4iness4y2r3below4ish3ious3l4ong5ugh3nace4ish5ture3or3row4y3ther7ance7more9st6st4ive4wängler3y3ze2se4lage3hun3ible4llade4on3s4budget4iness4y3tian4y2tile5ity3on3ure5istic6ty3z2ze3hou3z4ball5uster4iness4y1wd2iw1yi1ête0g1a2b3ardine3ble4y3erdine3le3on4rone3riel7a7le2crux2dabout3fly3get6ry3sden2ea3l4ic2ff4e2g3arin3e3gle2ia3ety3l3man3n4esville4ful4said6y5borough3t2l3a4ctic4had4pagos4tea5ia7ns4xy3braith3e4n5a3ibi4lean6e6o3l4agher5nt7ry4bladder4egos5on5ry5y4ic5um5vant4o5n5p5way6s4stone4up3ois4re4sh3sworthy3vani7c7ze6ometer4eston2may3bia5t4le4ol3e4cock4keeper4smanship4te4y3in5e3ma3ow3ut3y2nder4hi6an3esha3g4land5ia6ng6on4plank4rene7ous4ster4tok4way3net3tlet4ry3ymede2p3e2rage3b4age7man5nzo4le4o3cia3den6ia4ner3eth3field4unkel3gantua9n4le4oyle3ibaldi4sh3land4ic6ky3ment3ner5t4ish7ee3ote5te3ret6t4ick5son4ote6te4ulity6ous4y3ter4h3vey3y3za2scony3eous3h3ket3light3ohol4lene5ine3p3ses4y3tonia4ric6tis5ointestinal6nomic;al9y3works2te4crasher4post4way3her3ling3orade3sby3un2uche5o3diness4y3ge4uin3l3nt5let3ss5ian3tama4ier3ze4y2ve4l3in3otte2wain3k4iness4y2y3ety3le2za3e4bo4lle4tte3iantep4llion3pacho1b1d2ansk1e2ar4box4shift4wheel2cko2e3gaw3k4y3se3z2ffen2henna3rig2iger3sha2l3atin7e7ous3bvieh3id3t2m3ini3stone2n3a4ro3darme4er3e4alogical9st8y4ra6l7issimo8ty8zation9e6te7ion8ve7or5ic7ally5osity6us4sis4t5ic7ally7ist4va5ieve3ghis3ial6ity4e4i4tal7ia5ive4us3oa4cide4me3re3t4eel4ian5le6ity4le6folk6man7en6woman9en4oo4rification7y5y3uflect9ion4ine4s2o3cache4entric3de5sic3engineering3ffrey3grapher8ic:al8y3logic8al7st6y3meter6ric9al7y3physical9s4olitical:s3rge6town7te5ia7n6na3stationary3thermal2r3ald6ine4nium4rd6o3ber4il3e3iatric4tol3m4an6e6ic7um6y4icidal8e5nal7te8ion3onimo5tologist:y3ry5mander3shwin3trude3und2stapo5te6ion4iculate:ion4ure3undheit2t3away3hsemane3ty5sburg3up2wgaw3ürztraminer2yser1hana5ian4ian3stliness6y3ts3zvanid2ent3rkin3tto2ibelline2ost5liness5write9ten7ote3ul5ish2q2z1i2acometti3nnini4t5ess3uque2bber6ish5t4on4s3e3let3raltar3son2ddiness4y3e4on2elgud3nah2f3t2g3abit5yte4hertz4ntic4pixel3gle5y3o4lo2l3a3bert7o3christ3da3ead3gamesh3l4espie5tte4iam6n5gan5on3more3roy3t2mcrack3let3me4ick7ry7y3py2n3a3ger6bread6snap4ham4ivitis4ko4rich3kgo3ny3o3sberg5urg4eng4u2orgione3tto3vanni2psy2raffe4udoux3d4le3l4friend4hood4ish3t4h2selle3h3mo3t2thub2uliani3seppe2ve4away4n2za3mo3zard1lacial5er3d4den4e4iator9ial5ola7i7us4stone4ys3mor6ize6ous5ur7ize7ous3nce4d5ular3re3ser4gow4s5ful5ware5y4tonbury4wegian3ucoma3xo3ze4ier2eam4n4son3e4ful3n4da6le4livet4n5a2ib3de3mmer4pse3nt3ssandi8o4ten3tch4ter7y4z5y2oaming4t3b4al6ization4e5trotter4ular6e3ckenspiel3om5iness5y3p3ria5fication6y5ous4y3ss5ary5iness5y3ttides6s3ucester3ve3w4worm2ucose3e4y3ier5st3m3t4en4inous4ton7ous7y2ycerin8e6ol4ogen3ph1m2at2o2t1narl5y3sh3t3w4n2eiss2ome4ish3stic7ism2p2u3pg1o2a3l4ie4keeper4post4tender3t4ee4herd4skin2b3ble6degook7ygook3i3let4in2dchild8ren3dam6n5rd5ughter4ess3father4orsaken3hood3iva3less4ike5ness3mother3ot3parent3send4on3thaab3unov3zilla2ebbels3ring3thals5e2fer3f2g3gle3ol2iania3ter4re2lan3conda3d4a4berg5rick4en6rod4finch6sh4ie5locks4man4sboro5mith4water5yn3f3gi4otha3iath3ly2mez3orrah3pers3ulka2nad3dola6ier4wanaland3e3g3k3na3orrhea7oea3zales7z6o4o2o3ber3dall4by6e4ie4man4night4rich4will6n4y5ear3ey3f4y3gle3ier5st3k3lagong3n3p3se5berry2p3her2rbachev3dian5mer4on3e4n4y3gas4e5ous4onzola3illa4ness3ky3p3se3y2sh3ling3pel3samer4ip6y2t3cha3h4am4ic3ta4en2uda3ge3lash4d3nod3rd4mand5et3t4y2v3ern6able7nce6ess6mental6or8ship3t2wn2ya1p2a2u1r2ab4le3cchus4e5ful5land6ess4ie6la5ous4kle3d4ation4e4ient4ual6te7ion4y3ffias6ti7o4t5on3ham6e3il4n5y3m4mar7ian6tical5y4ophone4pians3nada5ry4d5ad5child:ren5dad7ughter5ee6ur5father5iloquence<t6ose5ma6other5pa7rent5son6tand4ge4ite4nie5y4ola4t4ular8ity7te8ion6e3pe5fruit5vine4h5ic7al6te5ologist9y4nel4ple3sp4s5hopper5land5y3te5ful4ification6y5s5tude4uitous7y3ve5l5n5stone5yard4itate8ion;al6y4y3y4beard4ish4slake3ze2ease6paint5iness5y4t3be3cian3ece4d5iness5y4k4ley4n5back5e6ry5grocer5horn7use5ish5land5peace5sboro6leeves6pan6ward5ville5wich4r4t3g4arious4g4orian7o6y3mlin3nada6e6ier7nes4del4oble3p3sham3ta4chen4el4zky3w3y4hound4ish2ibble3d4dle7cake4iron4lock3ef4g4vance5e5ous3ffin6th3ll5e3m4ace4e4m4y3n4ch4dstone4go3p4e4pe3s4t5le3t4ty3zzled6y2oan3cer6y3g4giness5y3in3k3mmet4yko3om4ve5y3pe4ius3sbeak4s4z3tesque4ius4to3uch6iness6y4nd6breaking6hog6less6swell6work4p5ie4se4t3ve5l3w4l4n5up4th2ub4biness5y4stake3dge3e4l4some3ff3mble4man4piness5y3ndy4ge5y4t3s3yeres4ère2yphon2ünewald1s1te1uacamole3dalajara6canal6quivir6upe4eloupe3llatiri3m3ngzhou4o4tanamo3rani6tee7or7y4d5house5ian8ship5rail6oom5sman7en4nieri3temala9n3va3yama5quil2bernatorial2cci2elph3rilla4nsey4ra5ero5illa3ss5able5timate5work4t3vara2ff4aw2ggenheim2i3ana3dance4e5book5line4o3ld4e5ful5less4lermo5otine4t5iness5less5y3nea6n5vere4ness3se3tar6ist3yang3zot2jarat7i3ranwala2lag3ch3f4port3l4ah4et5y4ibility6le5ver4y3p2m3bel4o3drop3my3ption2n3boat3fight5re3k3man4en3nery4y5sack3point5wder3runner7ing3shot4linger4mith3ther3wale2ofeng2ppy3ta2rgle3kha3ney3u2s3h4y3set3t4atory5v6o6us4o4y2t3enberg3hrie3ierrez3less3sy3tersnipe4ural2y3ana5ese2zman3zle1walior2en4doline7yn2yn1ybe2m3nasia7um6t7ic4osperm2necological:st9y2p3sum4y2rate5ion3o4scope1ödel2teborg0h1'm1a2as2bakkuk3er5dasher;y3it5ability7le6t7ion5ual7te8ion6é2cienda3k4ish4le4ney4saw4tivist2dar3dock3n't3oop3rian2emoglobin5philia5rrhage8oids2fiz3nium3t2g3ar3erstown3gai5rd4le3iographa3ue2h3n2ifa3ku3l4stone7rm3phong3r4ball5readth6ush4cut4do5resser9ing4iness4less5ine4net4piece6n4sbreadth5plitting6ring5tyle8ist4y3ti5an2ke3ka3luyt2l3berd3cyon3dane3e4akala4y3f4back4hearted4pence7ny4time4way3ibut4fax4tosis3l4eluiah7jah5y4iburton5e4mark4ow6e'en7en4statt4ucinate:ion:ory8ogen<ic4way3o4gen4n3sey3t3ve3yard2m3an3burg3hung3ilcar5l5ton8ian4tic3let4in3marskjold4erhead6stein5tt4ock5nd4urabi3per4shire4ton3ster5ring6ung4un2n3cock3dbag6ll5ill5ook4car7t5raft5uff4el4ful4gun4held4icap6raft5ness5work4kerchief;ves4le6bar4made6id8en4out4pick4rail4set5ful5hake5ome5pring5tand4work5riting8ten4y5man6en3ey3ford3g4ar4dog4man5en4nail4out5ver4ul4zhou3k4ie4y3na5h4ibal3oi4ver7ian3sel5n4om5n3ukkah2phazard3less3pen6stance4iness4y3sburg2rangue4re4ss3bin6ger4or3d4back6ll4cover4en4headed7rted4in6ess4line4ship4tack5op4ware5ired5ood4y3e4brained4lip4m3greaves3k4en3lan4em5quin5y4ingen4ot5w3m4ful4less4on6ic8a9lly7ous7zation8e6y3ness3old3p4ist4oon4sichord4y3rell4idan5et7t5ngton5s6burg6on8burg4ods5w4y3sh3t4e4ford4line4man3vard4est5y2sbro3h4eesh4ish4tag3idim3n't3p3sle4ock3te5n4iness4y2t3ch5back5ery6t5way3e4ful3field3h4away3red3sheput3teras4ie6sburg2ughtiness6y3l3nch4t3ptmann3sa4dorff3teur2vana4rti3e4l4n5't4rsack3oc4line2w3aii6an3k4ins5sh3thorn8e2y3cock3den4n3loft3mow3nes3seed4tack3wire4ood5rth2zard6ous3e4l5nut3iness3leton4itt3mat3y1base2o1dd2mi2tv1e2'd3ll2ad4ache4band5oard4dress4first4gear4hunter4land5ess5ight6ne5ock6ng4master5istress4phone4quarter4rest5oom4set5tone6rong4waiter6ters6y5ind5ord4y3l4th6care6ful6iness6y3p3r4ken4say5e5t4t5ache5beat6reak7oken6urn5en5felt5h5iness5land6ess5rending5sick6trings5throb5warming5y3t4h5en7ish4stroke3ve5n6ward4iness5side4y5set5weight2be4rt3raic4ew4ides2cate3k4le3tare4ic6ally4or3uba2dge5hog5row3onism7t8ic2edful4less3haw3l3p2fner3t4y2gel5ian4mony3ira2idegger5lberg4i3fer5tz3ght6en3mlich3ne5ken4lein4ous4rich4z3r4ess4loom3senberg4man4t2ld3en5a5e3ga3ical5es5on6pter4opolis5s5trope4port4um4x3l4ebore5nic7sm8tic7zation8e5spont4hole4ion5sh4man4o3m4et4holtz4sman6en3ot3p4ful4less5ine4mate5eet3sinki3vetius2m3atologist9y3et3ingway4sphere9ic;al3line4ock3oglobin4philia:c4rrhage7oid3p4en3stitch2n3ce5forth8ward4h5man6en3derson4ricks6x3ley3na4essy3peck3ri5etta4y3sley4on2p3atic6tis3burn3haestus3plewhite3tagon2r3a4clitus4ld6ic6ry3b4aceous5ge5l6ist5rt4ert4icide5vore8ous3culaneum6ean7s3dsman6en3e4about5fter4by4ditary7y4ford4in4of4ro4sy4tic7al5o6fore4upon4with3iberto4tage3man5phrodite<ic<us4es5tic8ally4inia5t6age6e4osillo3nandez4ia6e3o4dotus4ic6ally5n6e5sm4ku4n3pes3rera4ick5ngbone3schel4elf5y4hel6y3tz5sprung3zegovina4l2shvan3iod4tancy7t6te7ion3peria6us3se4ian3ter4on2terodox9y6geneity:ous6sexual<ity3tie2uristic2w3itt3lett3n2x3adecimal4gon7al4meter2y3day3erdahl3wood2zbollah3ekiah1f1g2t1hs1i2aleah3tus3watha2bachi3ernate8ion6ia3iscus2ccough4up3k4ey4man4ok5ry2dden3e4away4bound4ous6t2e3rarchical8y4oglyphic5nymus2falutin2ggins3h4ball5orn6y5row4chair4falutin;g4jack4land5ight4tail5stown4way7man8en2jack2ke2lario7us6ty5y3bert3da4ebrand3figer3l4ary4billy4el4ock4side4top4y3t4on2m3alaya3mler3self2nayana3d4emith5nburg4i4most4quarter4rance4sight4u5ism5stan9i3es5ville3g4e3t4erland4on2p3parchus4ie4o5crates9ic5potami:us4y2ram3e4ling3obumi4hito4shima3sute2spanic7ola3tamine4ogram5rian7c8al6y4rionic2t3achi3ch5cock5hike3her6to3ler3tite2v3e4mind1mo3ng2s1o2agie4y3rd4frost4iness4se4y3x2b3art3bes4it4le4s4y5horse5ist3goblin3nail4ob3o2c3k4ey4ney4shop2dge5podge4kin2e3down2ff4a4man3stadter2g3an4rth3gish3shead3warts5sh2henlohe5staufen5zollern3hot3okam2ist2key3ier5st3kaido3um4sai2lbein3comb3d4en4out5ver4up3e3iday4ness4stic3land4er6ith5y4ie5s4ow6ay4y5hock5wood3man4es3ocaust5ene4gram7ph9ic9y3st5ein3t2mage3burg3e4body6y4coming4grown4land5ess5iness4made6ker4opathic9y5wner4page4ric5oom4sick5pun5tead6retch4town4ward5ork5recker4y3icidal7e4e4ness5y3ogeneity8ous7ization9e5raph4nym4phobia9c7ne4sexual:ity3y2n3cho3da4uran7s3e4cker4sty4y5bee5comb5dew5moon5suckle5well3g3iara4ed3k3olulu4r5able8y6ria8um7y5ific3shu2och3d4ie4lum4oo4wink3ey3f3k4ah4e5y4up4worm4y3ligan8ism3p4la3rah5y3sier3t4ch3ver5s2p3e4ful4less4well3i3kins3scotch2race5io4tio3de3izon7tal3mel4onal6e4uz3n4blower4e5t4less4pipe4y3ology4scope4witz3rendous4ible7y5d5fic6y4or3se5back5fly5hair6ide5man8ship6en5play6ower5radish5shoe5tail5whip6oman8en5y4y3thy4icultural;e;ist4on3us2sanna3e4a3iery3pice5table9y7l8ity9zation:e3t4age4el6ry5ss4ile6ity4ler2t3bed3cake3el5ier3head4ouse3key3link3point3shot3tentot2udini3ma4ous4us3nd3r4glass3se5boat7und6reak7oke:n5clean6oat5fly5hold6usband5keeper9ing5maid6other5plant5top5wares8ming6ife7ves6ork4man4ton3yhnhnm2v3e4l4rboard5craft3haness2w3ard3dah4y3e4ll4ver3itzer3l3soever2yle1p1q1r2h2othgar1s2bc2t1t2ml2tp1uang2b3bard4le4ub4y3cap3ert3ris2ck4leberry4ster2d3dle3son2e3rta3y2ff4man4y2g3e3gins3h3o3uenot2h2i3tzilopotchli2la3k3l4abaloo2m3an5e5ism7t8ic6tarian<ism7y6zation7e5kind5oid3berto4le5y4oldt4ug3dinger4rum3e4ri5us3id5ify6ty5or4liate8ion6ty3mingbird4ock4us3ongous4r5ist5less5ous3p4back4hrey3ungous4s3vee2n3ch5back3dred7fold7th7weight3g4arian6y4over4ry3k3spell3t4ington4ley4ress4sman6en5ville2rd4le3l4ey3on3rah5y4icane4y3st3t4ful4le2s3band7ry3h3k4iness4y3sar4ein5rl4ite4y3tings4le4on2t3ch5inson3ton3u3zpa6h2xley2ygens1wy1yacinth3des3ena2brid6ize2de4rabad3ra5e5ngea6t5te5ulic9ally4ocarbon5electric=ity5foil5gen8ate5logy6ysis5meter5phobia6lane6onic5sphere5therapy2ena2giene6ic8ally7st3rometer2ing2men3n4al2pe4ractive:ity5bola9e8e8ic5critical5ion5link5market5sensitive=ity6pace5tension7xt5ventilate=ion3hen6ate8ion3noses6is5tic8ally7sm8t7ze3o4allergenic4chondria<c5risy7te8ical4dermic4glycemia;c4tenuse5halami:us6ermia7ses8is9ze7tical2sterectomy7sis6ia7c8al2undai1z1éloise0i1'd2ll2m2ve1a2ccoca2go2mb4ic2n2petus1badan2eria6n3x2ices3d3s3za2lis2m2o2sen2uprofen1cahn3rus2bm2c2e3berg4ound5x4reaker3cap3land7ic2icle3ness2ky2on4oclast:ic2u2y1d2a3ho5an2e3a4l5ism7t8ic:ally6zation7e3mpotent3ntical6fiable8cation7y6ty3ogram7ph4logical8st7y2iocy4m5atic9ally4syncrasy:tic4t5ic7ally2le2ol4ater6rous7y4ize2yl4l5ic1e2ee2yasu1f2fy1gloo2nacio4tius3eous3ite5ion3oble6y4minious7y4ramus6nce7t5e2or2uana4ssu1i2i1jssel6meer1ke3a2hnaton2on1l2a2ene2iad2k2l3egal7ity5ibility7le8y6timacy:te3iberal4cit4nois4teracy8te3ogical3uminate9i:on7e4s5ion6ve5ory5trate9ion:ve9or7ious2yushin1mage5ry4inable9y7ry7tion9ve6e3m2balance3ecile7ic8ty4d3ibe3roglio3ue2elda2f2ho4tep2itate6ion7ve6or2maculate4nence7t4terial5ure7ity3easurable;y4diacy7te4morial4nse6ity4rse6ion7ve3igrant7te8ion4nence7t3obile7ity8zation9e4derate6st8y4late7ion4ral7ity5tal8ity9ze4vable8y5eable3une5ity6zation7e5ology4re4tability7le8y2nsho2o3dium3gene2p3act4ir4la5e5pable4nel4rt6ial9ity4ssable6e6ioned7ve8ity4tience8t3each4ccability8le9y5unious4dance5e5iment:a4l4nd5etrability:le;y5itence9t4rative5ceptible<y5fect9ion5ial8ism:t;ic6l6ous6shable5manence:t6eable6issible5sonal9te:ion:or5tinence:t6urbability;le<y5vious4tigo5uosity7us6s3iety4nge4ous4sh3lacability8le9y5nt7ation5usibility9le:y4ement9able:tion4icate8ion6it4ode5re5sion3olite7ic4nderable4rt6ance8t7tion6unate8e8ity4se5ition5sibility8le9y5ter6or6ure4tence7t4und4verish3racticable<y:l;ity4ecation6ise8ion5gnability9le:y8te9ion5sario6s7ion:able:ism<t=ic8ve4imatur5nt5son4obability8le9y5mptu5per6riety5vable6e6idence:t7sation8e4udence8t3udence7t4gn4lse6ion7ve4nity4re5ity4tation5e2us1n2a3bility3ccessibility:le5uracy8te4tion6ve7ity3dequacy8te4missible4vertence:t5isable3lienable3morata3ne4imate5ty3pplicable5ropriate4t3rticulate3smuch3ttention9ve3udible8y4gural8te9ion4spicious2board4rn4und4x3red5ed3uilt2c3a4lculable;y4ndescence;t5tation4pability7le6citate9y4rcerate:ion5nate8ion4utious3endiary5se5tive4ption4ssant5tuous3h4oate5n3idence7t8al4nerate9ion9or4pient4se5ion6ve5or4te4vility3lemency8t4ination6e4ose6ure4ude5sion7ve3ognito4herence9t4mbustible5e5mensurate6unicado5parable;y7tibility:le;y6etence:t6lete6rehensible?y4nceivable<y6lusive5gruity8ous5sequential6iderable;te7stency;t6olable6picuous6tancy9t5testable<y6inence:t6rovertible?y5venience;t4rporate:ion8eal5rect6igibility:le;y6uptibility;le3rease5dibility8le9y6ulity8ous5ment9al4iminate:ion:ory4ust7ation3ubate7ion7or5i5us4lcate8ion5pate4mbency8t4r5able8y5ious5sion2debted4cency7t5ipherable6sion8ve5orous4ed4fatigable<y5ensible;y5inable:y7ite4lible8y6cacy8te4mnification8y7ty4nt6ation6ure4pendence:t4scribable<y5tructible=y4terminable;cy;te4x3ia5n6a7n7polis4cate7ion8ve7or5es5t6able4fference:t4gence7ous7t6stible9on5nant7tion6ity5o4o4ra5ect8ion4scernible6reet8tion7iminate5pensable<y6osed8ition6utable;y5soluble5tinct8guishable4vidual:ism<t=ic;ty;ze6sibility9le:y3ochina8ese5trinate;ion4lence7t4mitable:y4nesia9n4or4re5se3ra3ubitable:y4ce5t6ance6ee6ion7ve4e4lge7nce8t4s5trial:ism<t;zation<e8ous7y3y2ebriate8ion3dible4ucable3ffable8y5ective8ual5iciency:t3lastic4egance8t4igibility8le4uctable:y3pt5itude3quality5itable7y3rt5ia7l3scapable:y4sential4timable:y3vitability8le9y3xact4cusable:y4haustible<y4orable9y4pedient6nsive6rience7t5licable;y5ressible4tinguishable5ricable;y3z2fallibility8le9y4mous5y4ncy5t6icide7le6ry8man9en4rction4tuate8ion3easible4ct6ion8us4licitous9y4r5ence7tial5ior8ity5nal6o5tile8ity4st6ation3idel7ity4eld4ghting4ltrate9ion9or4nite8simal7ive7ude7y4rm6ary6ity4x3lame6mable8tion9ory5table6e6ion9ary4ect7ion:al5xibility8le9y4ict7ion4orescence5w4uence7tial7za5x3o4mercial4rm6al8ity7nt7tion;al9ve4tainment3raction5red5structure4equency9t4inge3uriate4se5ion2g3e4nious5uity6ous4stion3lewood4orious3ot3rain5m5te6iate7tude4edient5s4id4own3énue2habit7able8nt4lant6tion7or5e3ere6nt5it7ance7or3ibit7ion3ospitable3uman7e7ity2imical5table9y3quitous7y3tial7ization9e6te7ion8ve7or5o2ject6ion6or3udicious4nction4re5ious5y4stice2k3blot3iness3ling3well3y2laid4nd4y3et3ine2mate3ost2n3ards4te3ermost3keeper3ocence7t5uous4vate7ion8ve7or3uendo4merable2oculate8ion3ffensive3nu3perable7tive4portune3rdinate4ganic2patient3ut2quest4ietude5re6y5sition9ve8or2road2sane5ity4tiable9y3cribe6ption5utable:y3eam4ct6icide7vore:ous5ure7ity4minate9ion4nsate6ibility8le9y7tive:ity5tience9t4parability9le:y4rt6ion4t3hore3ide5ious4ght7ful5ne6ia7ficance<t4ncere8ity5uate8ion4pid4st6ence8t3ofar4le6nce7t5ubility7le5vable6ency8t4mnia8c4uciance9t3pect7ion7or4iration;al6e3tability5gram5l6l7ation5matic5nce6t7aneous4ead5p4igate8ion8or5l6l5nct8ive5tute8ion;al=ize4ruct8ion;al9ve8or6ment:al<ist=ty;tion3ubordinate<ion5stantial4fferable;y6iciency;t4lar7ity6te7ion7or5in5t4perable5portable4rance5e5gence9y8t5mountable5rection<ist2t3act4gli7o4ke4ngible9y3eger5ral7te8ion8or6ity5ument4l5lect9ual<ism=ze6igence:t;sia8ibility:le;y5sat4mperance9te4nd5se6ification8y7ty7ve5t6ion9al4ract8ion9ve5bred8ed5cede7pt9ion9or7ssion9or6hange;able>y6ollegiate7m7nnect<ion8tinental7urse5denominational7partmental8endence=t6ict9ion7sciplinary5face7ith6ere9nce8on5galactic5im6or5j6ect9ion5lace7rd6eave7ukin6ink6ock8utory7per6ude5marriage9y6ediary:te7zzi9o6inable;y8gle7ssion7ttent5n6al8ize7tional=e=ism>ze6e7cine7e7ship7t6ist6ship5office5personal6lanetary8y6ol8ate:ion7se8ition6ret9ation<ve9ive5racial6elate:ion=ship6ogate:ion;ve:or<y6upt9ion5scholastic6ect9ion6perse6tate7ellar7ice5twine5urban5val6ene8tion6iew9ee5weave6ove9n4state6inal8e3imacy6te7ion5idate9ion3o4lerable:y8nce9t4nation5e4xicant8te9ion3ractability9le5mural5net6sigence;t8tive5venous4ench5pid4icacy7te5gue5nsic9ally4o5duce8tion9ory5spection;ve5version8t4ude5sion7ve6t3uit6ion7ve2uit3ktitut3ndate7ion3re2vade4lid7ate9ion7ity5uable4r5iable9y7nt4sion6ve3ective4igh6le4nt6ion7ve6or8y4rse6ion5t6ebrate4st6igate:ion;ve:or7ture6or4terate3idious4gorate9ion4ncibility8le9y4olability8le7te4sibility7le8y4tation:al5e3ocation4ice4ke4luntary5ve3ulnerability:le;y2ward1o2ctl2dine4ze2n3esco3ian4c4zation5e3osphere2ta2u2wa4n1p2a2ecac2higenia3one2o1q2aluit2bal2uitos1r2a3n4ian3q4i3scibility7le3te2c2e3land3ne2idescence9t4ium3s4h5man6en5woman8en2k3some3utsk2ma2on4clad4ic6al4monger4ware5ork4y3quoian7s2radiate8ion4tional:ity4waddy3econcilable6verable4deemable4futable4gular9ity4levance:y9t5igious4mediable;y4parable:y5laceable5ressible6oachable4sistible;y5olute9ion5pective6onsibility;le<y4trievable<y4verence9t7sible;y5ocable:y3igate7ion4tability7le8y6nt6te7ion3uption2tish2vin5g2win1s2aac3bel6a6la7e3iah2cariot2fahan2herwood3im3mael3tar2iah3dro3nglass3s2lam5abad5ic6sm7t4nd3e4t2m3ael4il2n't2o3bar3late6ion9ism;t4de3metric4orphic3sceles3tope6ic4ropic2p3ell2rael6i7te2sac5har3uance4e2tanbul3hmi5us2uzu1t2'd3ll2aipu3lian5c6ize4y3sca2ch4iness4y2em4ization6e3rate6ion7ve6or2haca6n2inerant7ry2o2self2unes1ud1v2a3n4hoe2f2ory2y1x1yar1zaak3nagi5mi2hevsk2mir2od2vestia0j1ab3ot2ck4al5ss4boot4daw4et4hammer4ie4knife7ves4lyn4pot4rabbit4son7ian7ville4y3lyn3ob5ean5i6n6te5son3quard5eline7yn6s3uzzi2de2g3gies3iellon3uar2hangir2il4break4or3me3n4ism3pur2karta3e2lapeño3opy4usie2m3aal4ica7n4l4r3b4oree3e4l4stown3i4e2n3a4cek3e4ll6e4sville4t5te3gle3ice4e4ne4s5sary4tor7ial3jaweed3na4ie3sen6ist3uary4s2pan5ese3e3ura2r3dinière3gon3lsberg3rett4od3vis2smine3on3per2taka2undice4t5iness5y2va4nese4script3elin3ier2w3bone4reaker2xartes2y3apura4wardene3cee3ne3son3walk2zz4y1ealous7y3n4ette4ie5ne4ne6tte5ie6ne2d3i2ep3r3ves3z2ff4erey6son9ian6y4rey5y2had3oshaphat4vah2june2kyll2ll4o4y5bean5fish2nifer3kins3na4er4ie5fer5ngs4y3sen2opardize7y2phthah2rald3emiad7h5y3i4cho3k4in4water4y3maine3oboam4ld4me3ri4od5ld4y3sey3usalem2ss4amine4e4ica5e3t3uit4s2t3sam3tison4y3way2w3el5l5ry3ish3ry2zebel1fk1ib3e2dda2ffy2g3gle3saw6n2had5ist2lin3l4ian3t2m3enez3mie4y2nan3gle4oism7t8ic3n4ah4i4y3ricksha5kisha3x2tney3terbug6s6y2ujitsu2varo3e1o2an4n5a5e3quin2b3less2casta3elyn3k4ey4strap3ose5ity3ular7ity4nd6ity2dhpurs3i4e3y2e3l3y2g3gle3jakarta2hann6a6esburg3n4athan7on4ie4nie5y4son5ton7wn2in4t3st2ke2lene3iet3liness5ty4y3son3t2n3ah4s4than6on3esboro3i3quil3son2plin2rdan6ian3ge2se4f5a5ina4ph6ine6son6us3h4ua3iah4e3tle3ue2t2ule3nce3rnal7ese7ism9t:ic5ey7man8en3st2ve3ial6ity5n2wl2y3ce5an3ful3less3ner3ous3ridden6e4ode3stick1p2eg1r1uan4a4ita3rez2bal3ilant6tion5ee2daeo4h4ic5sm4s3d3e4a3ge5mental5ship4ment8al3icature5ial7ry6ous4th3o3son3y2g3gernaut4le3ular2ice4iness4y2jitsu3ube4tsu2kebox2l3ep3ia5n6a6ne4e5nne5t6te4o4us3liard3y2mble4o3p4iness4suit4y2n3co4tion5ure3e4au3g4frau4ian4le3ior4per3k4et4ie4y5ard3o3ta2piter2rassic3idical4sdiction<al5prudence5t3or3ua3y2st4ice5fiable:y7cation6y5n6e6ian2t3e3land2venal5ile2xtapose8ition1v0k1aaba2bob4om3ul2fka5esque3tan2goshima2hlua3ului4na2ifeng3lua3ser3tlin2lahari4mazoo4shnikov3b3e4idoscope;ic4vala3goorlie3i3myk2ma3chatka3ehameha3ikaze3pala4uchea2nchenjunga3dahar4insky3e4ohe3garoo3kakee3nada3o3pur3s4an5s3t4ian2ohsiung3lin2pok4si3ut2ra4chi4ganda4korum5ul4mazov4oke4t5e3eem4n5ina3i4n5a3l4a4off3ma3o4l3roo3yn2sai3ey3hmir3parov2te4lyn3harine4erine6yn4iawar5e4leen4rine5yn4y3ie4na3mai5ndu3owice3rina3y4did2uai3fman3nas4da2wabata4saki2y3ak3e3la2zakh6stan4n5tzakis3oo1c1eaton4s2bab3ob2ck2el3n4an3p4sake3watin2g2illor3sha3th2ller5y4i5e4ogg4y3p3sey3vin2merovo3p4is2n3dall4ra5ick3more3nan4edy5l5th5wick4ith4y3osha3t4on4uckian7y3ya5n5tta4on2ogh3kuk2pler3t2ratin3chief7ves3ensky3i3mit3n4el3osene5ine4uac3r4i4y2strel2tch5up3o4genic3tering4le6drum2ven3in3lar3orkian2wpie2y3binding4oard3hole3nes6ian4ote3punch3stone5roke3word1fc1g2b1habarovsk3chaturian3ki3lid3n3rkov4toum3yyam3zar2mer2oikhoi4san3meini3rana2rushchev2ufu3lna2warizmi2yber2z1ia2bbutz7im3itz3osh2ck4apoo4back4off4stand4y2d3die4o4y3nap4ey2el4basa7y3rkegaard3th3v2gali2kuyu2lauea3imanjaro3l4deer4een4joy3n3o4byte4cycle4gram4hertz4meter4ton4watt3roy3t2m3berley7y3ono2n3da4ergarten7ärtner4hearted4le5iness4red3ematic4tic3folk3g4dom4fisher4pin4ship5port5ton7wn3k4y3ney3sey4hasa5ip4man5en4woman7en2osk3wa2p3ling2rby3chhoff5ner3ghistan6z3ibati4nyaga3k4land4patrick3ov3sten2sangani3hinev3lev3met3s4immee2t3akyushu3chen7ette7ware3e3h3sch6y3ten6ish4y2wanis3i1kk1lan4sman3us2ee4nex3in3ptomania;c2imt3ne4gon2ondike2udge3ge3tz5y1m2art1nack5wurst3pp4sack3ve5ry4ish2ead3e4cap4l3ll4t3sset3w2gwarreye2ickerbocker7s5knack3evel3fe3ght6hood3t4wear3ves2ob4by3ck5out5wurst3ll3pf3ssos3t4hole4ty3w4able4ledge9able<y6s4n3x4ville2uckle7head3dsen3th1o2ala3n2be2ch4ab2dachrome4k4ly3iak2estler2hinoor3l4rabi2izumi2jak2komo2lyma2mmunizma2ng4o3rad2ok4aburra4ie5ness4y3ntz2peck4k3pel2ran3ea5n3nberg3y3zybski2sciusko3her3suth3ygin2tlin2ufax2wloon3tow1p1r2aft3katoa4ow3mer3snodar6yarsk2ebs3mlin7ologist3sge2ingle3s4hna7murti4ta5en5i6e6n7a7e5opher5y2oc3ger3ne5cker4or3potkin2uger6rand3pp2ypton3stal2óna4ur1s2hatriya1ublai3rick2dos3zu2hn2ibyshev2lthumm2mquat2nming2omintang2rd4ish6tan3ile3osawa3t4is2sch2tuzov2wait6i2znets7k1w2akiutl3n4gju4zaa1y2le2oto2rgyzstan2ushu1öln0l1'amour2oreal3uverture1a2b3an3el3ia5l4um3or5atory5ious3rador3urnum3yrinth9ine2ce4rate7ion4y3hesis4rymal7ose3k4adaisical4ey4luster3onic7ally3quer3rimal4osse3tate6ion4ic4ose3una6e3y2ddie3e4n3le3oga4nna3y4bird5ug4finger4like4ship2fayette3itte2g3gard3niappe3oon4s3range7ian2hore2id3n3r3ty3us2jos2ke4isha4land4wood3isha3ota3shmi2llygag2m3a4r5ck4sery4ze3b4ast7e4da4ent5rt4kin4orghini4rusco4skin3e4brain4ntable9y7tion3inate7ion3ont3p4black4oon4post4rey4shade2na4i3cashire6ter4e5lot5t3d4fall5ill4holder4lady5ine5ocked6rd5ubber4mark6ss4on5wner4ry4sat5cape5lid8den8e5teiner4ward3e3g4erhans4land5ey4muir4uage5id6sh5or7ous3k4a4iness4y3ny3olin3sing3tern3yard3zhou2o3coon3tian2p3el3idary3lace5nd3p3se3top3wing2ra4mie3board3cenous6y4h3d4ner3edo3ge5sse4o3iat3k4spur3ousse3ry3s4en4on3va5e5l3ynges6itis5x2sagna6e3caux4ivious3e3h3sa4en4ie5tude4o3t2t3asha3ch3e4comer4ncy5t4ral6n4x3h4e3in5a5o5x4sha4tude7inal3onya4ya3rine4obe3te4ice7work3via6n2ud4able7y5num5tory3e3gh5able8y5ingstock5ter3nch4der5ress6omat6y7man8en3ra5sia4eate5l5n6ce6t4i5e2va4l4tory3ender4rn6e3ish3oisier4nne2w3anda3breaker3ful3giver3less3maker3n3rence7ium3son4uit3ton3yer2x3ative3ity2y3amon4way3ette3la3man4en3off4ut4ver3people5rson3ton3woman6en2zaro5us3e3iness3y4bones1b2j1cd1e2a3ch3dbelly4en5rship3f4less6t4y3gue3h3k4age4ey4y3n4der4n5a5e3p4frog4t3r4jet4n5t4y3se5hold4h4t5wise3ther7neck7y3ve5n6worth2banese5on3esgue3lanc2cher6ous6y3ithin3tern4ure2da3erberg3ge2e3ch3ds3k3ry3sburg3uwenhoek3ward5y2ft4ie5sm6t4most4over4wards4y2g3acy4l5ese5ism7tic6ty6zation7e4te6e5ion5o3end6ary6re4rdemain3gin4y3horn3ibility5le6y4on6naire4slate8ion9ve8or8ure4t5imacy8te7ize3less3man4en3o3ree4oom3ume5inous3work2hman2i3bniz3cester3den3f3gh3la3pzig3sure3tmotif2la4nd3ia2maitre3ma4e3on5ade5y3uel4r5ia2n3a4rd3gth6en6ways7ise6y3iency6t4n5grad5ism7t3non4y3o4ir4ra5e3t4en4il2o3la3minster3n4a5rd7o4cavallo4el4id6as5ne4or3pard4old7o3tard2per3idus3ke3rechaun4osy5us3t3us2rner3oy2sa3bian7ism3ion3ley4ie3otho3see5n5ps4ie4on5r3t4rade2t3a3down3ha5l5rgic9ally7y4e3icia4tia3terbomb8x6head6man4uce3up2ukemia4ocyte2vant3ee4l5headed5lers4r5age4sque3i4athan4ne4tate7ion5icus5t5y3y2w3insky4s5ton5ville2xer3ica6l5ographer;y6n4ngton3us1g2bt1hasa2otse1i2ability4le3ise5on3r2b3ation3by3el5lous5ous4race6l7ism8ty8zation9e6te7ion7or5ia7n5tarian6ine6y3idinous5o3ra5rian6y4eoffice5tti8st7o5ville4ium3ya5n2ce4nce5se7e5tiate7ous3hee5n4tenstein3it3k3orice2dia2e3berman4fraumilch3chtenstein3f3ge3n3u4tenancy9t2fe4blood5oat4forms4guard4less5ike6ne5ong4saver7ing5pan5tyle4time4work3t4off2gament4ture3ht5en5headed8rted6ouse5ning5weight3nite2i2kable3e4able4lihood4n4wise2la4c3ia5n6a4th4uokalani3le4ian5e5put8ian4y3ongwe3t2ma3b4augh4less4o4urger3e4ade4light4rick4stone3it5ation5less3n3o4ges4usin8e3p4et4id6ity4opo3y2n3a4ge3chpin4oln3da4bergh4en4say5ey4y3e4age5l5ment5r4backer4feed4man5en4n4sman6en4up3ger6ie4o4ual5ist8ic3iment3k4age4up3naeus4et3oleum4type3seed3t4el4on3us4x3wood2on4el5ss4hearted4ize2p3id4zzaner3osuction3pi4mann3read3scomb4tick3ton2quefaction6y5ur4id6ate8ion8or6ity7ze5fy4or2ra3e2sa3bon3le3p3sajous4om6e3t4en5rine4less4on3zt2t3any3chi3e4racy6l6ry6te7i7ure3he4ium4ograph:ic:y5sphere4uania9n3igant6te7ion5ious3mus3terbug4le4on5ral3urgical6y2vability5le3e4able4lihood6ness5ong4n4rmore5pool6udlian5wurst5y4stock4ware3ia4d4ngston:e3onia3y2x2z3a4rd3zie4y1jubljana1lama3no2ewellyn2oyd1n1o2ad4able4star6one3f3m4y3n4word3th5e5some3ves2b3achevsky3by5ist3e3otomy3ster2cal5e5ity6zation7e4te5ion4vore3hinvar3i3k4able4e5an5t4heed4jaw4out4smith5tep4up4wood3o4motion8ve4weed3us5t4tion2de4star6one3ge3i3z2ewe4i4s2ft4iness4y2g3an5berry4rithm9ic3book3e3gerhead3ic5al5ian4n4stic8al3jam3o4ff4n4type4ut3rolling2hengrin2in4cloth3re3s3ter2ki2la3cat3ita3l4ard4ipop4obrigida4ygag5pop2mbard7i7y3e3poc2n3don3e4liness4some3g4boat4evity4fellow4hair6nd5orn4ish5tude8inal4mont4shoreman:en5treet4time4view3nie2ofah3k4alike4out4up3m3n4ey6ier8s4ie4y3p4hole4y3se5n3t2p3e4z3sided2quacious7ty2ra4in6e3d4ship3e4lei4n5a5e5tz5z6o4tta3gnette3i4e3n4a3raine4e4ie4y2se3t2t3h4ario3ion3t4ery4ie4o3us2u3dmouth4speaker3ella3ie4s5a5e5iana9n8ian5ville3nge3rdes3se4iness4y3t4ish3ver4re2vable3e4able4bird4craft4lace5ess5iness5orn4making4sick2w3brow3down3e4ll4nbrau4rcase5y3ish3land4iness2x2yal5ist5ty4ng3d3ola2zenge1p2n1r1s1t1u2anda4n3u2bavitcher3ber4ock3e3ricant7te8ion8or3umbashi2cas3e3ia5n6o4d5ity4en4fer4le5le4nda4o4te4us3k4iness4less4now4y3rative4e5tia7us3y2ddite3hiana3icrous3wig2ella2fthansa4waffe2g3gage3osi3ubrious2igi3s4a2ke4warm2la3l4aby4y3u2mbago5r4er6jack6man7en6yard3inary5escence:t5osity6us4ère3mox3p4iness5sh4y2na4cy4r4tic3ch5box5eon8ette5room5time3g4e2pe4rcalia3in5e3us2rch3e3ia4d3k2saka3cious3h3itania3t4ful4iness4re5ous4y2te3her6an8ism2vs2xembourg3uriance8t7te6ous5y2z3on1vi3i2ov1xi3i3v3x2vi4i1yceum3hee3ra3urgus2dia2e3ll2le3y2man3e3ph5atic5oma8ta2nch5burg5pin3da4on3ette3n4e5tte3x2on2ra3e3ic5al5ist2senko3istrata3ol2x0m1a2'am2alox2bel3le2c3abre4dam4o4roni6on5thur4ulay4w3beth4ride3cabeus3donald3e4don7ia9n4rate7ion3h4ete4iavelli;an5nable7tion6e7ry6ist5smo4o3ias4ntosh3k4enzie5rel4inac7w6tosh3leish3millan3on3ramé4o5biotic5cosm5logy5n5scopic3umba3y2dagascan9r4m5e3cap3den4ox3e4ira4leine5ine5yn4moiselle4ra3ge3house3ison3man4en3onna3ras6a7h6sa4id5gal3urai3woman6en2e3lstrom3stri6o3terlinck2fia4oso2gazine3dalena8e3ellan8ic4nta3gie4ot3hreb3i4c5al5ian4not4sterial6rate3ma3nanimity8ous5te4esia7um5t6ic8ally7sm7zation8e6o7sphere4ification8ence:t6y5togorsk6ude4olia4um3og4o3pie3ritte3saysay3yar2habharata4raja8h6nee7i6shtra5ishi4tma4vira4yana7ist3di3fouz3ican3jong3ler3ogany2i3den6form6hair7ead7ood4servant3gret3l4bomb6x4lol4man5en3m4an4onides3n4e4frame4land5ine4mast4sail5pring5tay6ream4tain8ability:le5enance3sie3treya3ze2j3estic8ally6y3or5ca5ette5ity3uro2karios3e4shift4up2labar5o4cca5hi4djusted9ment5roit5y4gasy4ise4mud4prop8ism4ria7l5key4wi4y5alam6n5sia8n3colm5ntent3dive6ian4onado3e4diction4factor4volence9t3feasance4ormation7ed4unction3i4an4bu4ce5ious4gn6ancy8t6ity4nda5ger5owski3l4ard6mé4eability7le5t4omars5ry5w3nourished4utrition3odorous4ne4ry3plaquet4ractice3raux3t4a4ese4hus7ian4reat3ware2ma3bo3eluke4t3ie3ma5l6ian5ry4ogram8phy5n5th3ore2n3acle4ge6ability8le6rial5ua4ma4sseh4tee4us3chester5u6ria9n4ini3dalay5rin5te6ory4ela6brot5ville4ible5ngo4olin4rake5ell5ill4y3e4t4uver8ability:le3fred4ul3ga5nese4e4le4o4rove4y3handle5ttan4ole5od4unt3i4a5c6al4c5hean5ure7ist4fest8ation8o5old4kin4la5la4pulate9ion:ve9or4toba6ulin3kato4ind3ley4iness3n4a4equin5rism4heim4ikin5sh3or5ial3power3qué3sard4e5rvant4field4ion4laughter4on3teca5gna5l6piece5s4illa5s6sa4le6piece4ra3ual4el6a4facture4mit4re4script3x3y3ège2o3ism5t3ri2p3le3plethorpe3uto2r3a4bou4ca6ibo4t5ha6i6on4ud3ble3c4eau5l6ino6la6o4h5ioness4i5a6no5e4o5ni4us4y3duk3e3garet6ine7ta8o4e5ry4ie5n6al8ia4o4ret7he4uerite3i4a5chi5db5n6a6ne6o4bel4cela4e5tta4gold4huana4juana4lyn4mba4n5a6de6te5e4o5n6ette4sa5ol5sa4tain6l5ime5za4us3joram6ie6y3k4ab4down4et6ability8le6place4ham4ov4sman8ship6en4up3la4boro8ugh4ene5y4in4on5we3malade5ra4oset5t3ne3onite4on3ple3quee6sas7s6try7te6z5is7e6ta3rakesh4iage8able5ott4ow4y3sala4eillaise8es4h5a6l7l5mallow5y4upial3t4a4el5n4ha4ial6n5n6a6et7z6i7que4y5r6dom3va4el6l7ously6ous4in3x4ism6t3y4ann7e4ellen4land5ou4sville3zipan2sada4i4ryk3c4agni5ra4ot4uline8ity3efield4rati5u3h4had4up3k3ochism8t9ic4n5ic6te5ry3que6rade3sachusetts6re5ge5soit4enet5ur6se5y4ive3t4ectomy5rcard6ful6mind6piece6stroke6work6y4head4icate8ion5ff4odon5id4urbate9ion2t3ador3ch5book7x5less5maker8ing5stick3e4rial8ism:t;ic=ally9zation:e5nal6ity3h4ematical:ian:s5w6son4ias5s3ilda4ns5ée4sse3lab3riarch9al9y5ces6ide6ulate:ion5monial8y5x4on3t4e5l5rhorn4hew5ias4ie4ock4ress3uration5e5ity3zo5h5t6h3ériel2ud4e4lin3gham3i3l4din3nder3passant3ra4een4iac5ce6io5ne5tania6ius4o5is4yan3ser4olea7um3ve2ven4rick3in4s2w3kish2x3illa7e7ry4m5a6l5ilian6zation7e5um4ne3well2y3a4n3be3day3fair4lower5y3hem3nard3o4nnaise4r5al7ty3pole3ra3tag2zama4rin4tlan3da3e3ola4urka3urka3zini1b2a3bane2ini1c2adam3llen2bride2cain4ll4rthy8ism6ney6y3lain4ellan4ure3onnell4rmick4y3ray3ullough2daniel3onald5nell4well2enroe2fadden4rland2gee3overn4wan3uffey4ire2henry2i3ntosh5yre2kay3ee4nzie3inley5ney3night2laughlin3ean4od3uhan2mahon3illan2namara4ughton3eil2pherson2queen2veigh1d1e2ad4e4ow6lark3gan4er3l4time4y3n4der4ingful7less4t5ime4while4y3sles5y4urable9y6e7less3t4ball4loaf7ves4y2cca3hanic8al7sm8tic7zation8e2dal5ist5lion4n3dle6some3ea4llin3ford3ia5eval5l5n5te6ion6or4c5aid6l6re6te7ion5i6nal7e4eval4na4ocre7ity4tate7ion8ve5erranean4um3ley3ulla7e4sa2ek3t4inghouse2g3abyte4church5ycle4hertz4lith5omania;c6polis4n4phone5ixel4ton3han3o2h2ier3ghen3ji3r2jia2kong2l3ancholia:c9y5esia9n5ge5ie6n5oma8ta3ba4ourne3chior6zedek3endez3inda4sa6nde5sa3lifluous4on5w3odic7ally6ous5rama9tic<ally5y4n3pomene3t4down4on3va4ille5n2mber6ship4rane7ous3cached3e4nto3ling3o4ir4rabilia7le8y6nda8um5ial8ize6zation7e5y3phis2n3ace4ge6rie4nder3cius4ken3dacious7ty4el6eev6ian6ssohn5z4icant4ocino5za3elaus5ik3folk3haden3ial4fee4ngitis3kalinan5r4ent3nen4onite3ominee4pausal8e4rah4tti3sa4ervants5s4trual8te9ion4wear3tal6ity4hol7ated9um4ion4or3u4hin3zies2ow2phistopheles2rak3cado5ntile5tor4ed5nary5r6ize4handise9ze7t8man9en4ia5ful5less4k4urial7c6ochrome6y4y3e4dith4tricious3ganser4e3idian4ngue5o4t5ocracy6rious3le4in4ot3maid5n4en3ovingian3riam5ck5ll5mack6ent5ness5tt4y5maker8ing3thiolate4on3vin2sa4bi3cal6ine3dames4emoiselles3h3mer6ism7ze3olithic4potamia4zoic3quite3sage4enger5rschmidt4iaen6h6nic5eurs5ness4y3tizo2t3a4bolic8sm8ze4carpal8i8us4l5lic8a6urgical:st9y4morphic:sm9ose;is5ucil4phor8ical6ysical:s4stases8is9ze4tarsal3e4or6ic7te6oid7logical;st:y3hadon8e5ne6ol4inks4od6ical7sm8t6ological:y5ught4uselah3iculous3ric6al7tion4o5nome5polis9tan3ternich4le6some2use2w3l2xicali6n5o2yer5beer2zzanine1fg2r2ume1g2m1hz1i2a3mi3ow3placidus3sma6ta2ca4h4wber3e3h4ael4eal5l6angelo6e6in6le6ob6son4igan8der3k4ey4ie4y3mac3ra4oaggression5be6iologist;y5chip6ode7mputer7sm5economics5fiche7lm6loppies5loan5meter5n6esia:n5organism5phone6lastics6rocessor5scope9ic;ally9y6econd6oft6urgery5wave2dair4s3day4le6brow6man7en6ton8wn6weight4y3ge5t3land3most3night3point3riff3shipman8en4t5ream4ummer3term4own3way4eek5st7ern4ife7ry5nter5ved7s6ing3year2en2ff2g3ht5iness5y3raine5nt5te6ion6ory3uel2ke3hail3oyan2l3agros4n3ch3dew4red3e4age4post4stone3f4ord3ieu6x4tancy7t6rism9t:ic8zation9e7y6te5ia7man8en3k4en4iness4maid6n5en4shake5op4weed4y3l4age5rd5y4ennia9l8um5pede5t4icent5e5gram5kan5liter5meter5ner8y5on7aire7th5pede5second4race4stone3ne3o4sevic3quetoast3tiades4on6ic5wn3waukee2me4ograph4tic3i4c5ked6ing5ry3osa2n3amoto4ret4tory3ce5meat3danao4bogglingly4ful4less4oro4y3e4field4ral7ogist9y5va4strone5weeper3g4le4us3i4ature8ist9zation:e4bike5us7ses4cam5omputer4floppies4m5a6l7ism9t5ization7e5um4on4scule5eries5kirt5ter8ial6rant8tion7y4van3k3n4eapolis5lli5sota9n4ie4ow3oan4lta4r5ity4s4t5aur3sk5y4ter5rel3t4aka4y3uend5t4it4s5cule4te6man7en5ia7e3x2ocene2ps2r3a4beau4ch5le5ulous4ge4nda3e3fak3iam3o3ror3th5ful5less3zam2sadventure4lignment5liance4nthrope:ic;st:y4pplication7y6rehend;sion7opriate=ion3begotten5have8ior3c4alculate;ion6l5rriage7y5st4egenation5llaneous9y4hance5ief7vous4ommunication5nceive8ption6duct6struction:e5unt4reant4ue3deal7t5ed5meanor4iagnose:is5d5rect9ion4o5ne3er5able8y5liness5y3feasance6ture4ire5t4ortune3giving4overn4uide3handle5p4mash3identify4nform9ation5terpret<ation3judge7ment3kito3laid5y4ead5d3manage5tch3nomer3ogynist:ic7y3place6y4rint5onounce7unciation3quotation7e3read5present<ation4ule3s4al4hapen4ile7ry5on7ary5ssauga7ippi;an5ve4oula6ri8an4pell7t6nd7t4tate5ep4y3t4ake7n5ssini4ime5ness4letoe4ook4ranslated5eat6ss5ial5ust8ful4y5pe3understand:ood4se2t3ch5el7l3e3ford3hra5idates3igate7ion3osis3subishi3t4en5rrand4y3zi2x3tec4ure2zar3zen6mast1kay1l1m1n2emonic5syne1o2an3t2b3il5e5ity6zation7e3ster3utu2ccasin3ha3k4ery4ingbird2dal3e4l4m4rate7ion7or5n6ism8t9ic7ty7zation8e4sto6y3icum4fiable6cation5y4gliani4sh3ular6te7ion7or5e5o5us2e3t2gadishu3ul2hacs4ir4med5mad6ed8an:ism4wk3ican3o4rovicic2iety3ra4e3ses5yev4t5en5ure7ize2jave2lar4sses3d4avia4iness4ova4y3e4cular7e4hill4skin5tation3iere4na3l4ie5fication6y4usc6k4y5coddle3nar3och4kai4tov3t4en3uccas3ybdenum2m3basa3entary6ous6um3ma4y2n3a4co4rch7ic9al8sm9t7y4stery6ic8ism4ural3dale5y4rian3era4ssen4t5arism7y5ize4y5bag5maker8ing3geese5r4odb5l6ia8n7sm6oid5ose4rel3ica5ker4ed5s4ker4que4tor3k4ey6shine3mouth3o4chromatic9e5le5otyledon4gamous7y5ram7ph4lingual6th8ic5og7ue4mania9c4ngahela5ucleosis4phonic5olist:ic8zation9e7y4rail4syllabic:le4theism9t:ic5one7ic9ally7ous7y4xide3roe5via3santo4ieur5gnor9i4oon4ter5rance6osity7us3t4age6ue5igne5na7n4calm4e5negrin9o5rey6rey5squieu6sori5verdi6ideo5zuma4golfier6mery4h4icello4oya4pelier4rachet5eal4serrat4y3ument8al2o3c4h3diness4y3g3n4beam4ey4light6t4scape5hine6ot5tone6ruck3r4e4ish4land3se3t2p3e3pet2raine4l5e5ist8ic6ty6ze4n4ss4toria8um4via7n4y3bid6ity3dant4red3e4no4over3gan6town4ue3iarty4bund4n4son4ta3ley3mon6ism3n3o4ccan6o4n5i6c4se3pheme6us5ine5ological9y5y3ris6on6town4ow3se5l3t4al6ity5r6board4gage8e7or4ice6ian5fication6y5mer5se4on4uary2saic3cow3eley5le4y3lem5y3que5ito3sy3t3ul2te4l3h4ball4erboard6fucker:ing6hood6land7ess7iness3if4le5ity4on6less4vate7ion:al7or5e3ley4ier6st3ocross4r5bike6oat5cade7r6ycle9ist5ist6ze5man6en6outh5ola5way4wn3rin3t4le4o2und4t5ain8eer8ous8side8top5batten5ebank5ie3rn5ful3se5trap5y4iness4se5orgsky4tache4y3th5e5ful5piece5wash7tering4on2vable3e4able3ie2w3gli3n2zambican7que4rt3illa3zarella1p2eg2g2h1r2i1s2g2t1t2v1u2awiya2barak2ch3ilage3k4rake4y3ous3us2ddiness4le4y3guard3slide6nger8ing2eller3nster3sli3zzin2ff4in4le3ti2g3abe3giness4le4y2hammad8an:ism2ir2jib2kluk2latto3berry3ch3der3e4teer3ish3l4ah4en5t4igan7tawny5kan5ns5on3roney3tan4i5colored6s6ultural=ism5dimensional5faceted7rious5lateral6ingual5media6illionaire5national5player7e8x9or7icand:tion<ve9ity7y6rocessing6urpose5racial5task6ude8inous5variate6erse6itamin2m3bai4le3ford3mery4ification6y4y3ps2nch5ies5kin4ie3dane3g3ich5ipal9ity4ficence9t4tion3oz3ro2ppet2ral5ist4saki4t3chison3der6ess6ous4och3freesboro3iel4llo4ne3k4iness4y3mansk4ur3phy3ray4ieta4ow4umbidgee2scat6el4le4ovite6y4ular8ity7ture3e4um3h4arraf4iness4room4y3ial4c5al7e5ian8ship5ologist9y3k4egon5llunge5t6eer6ry4iness4melon4ogee4rat4y3lim5n3s4el4olini5rgsky4y3t4ache5ng5rd4iness4n't4y2tability5le4nt4te5ion3e3ilate7ion4neer5ous5y3suhito3t4on3ual6ity2umuu2zak3zle1vp1y2anmar2cenae7an2lar3es2na4h2opia5c2ra3dal3iad3na3on3rh3tle2self3ore3pace3ql3t4erious6y4ic6al6ism5fication6y5que2th4ic6al4ological9st8y1étier1êlée1ünchhausen0n1a2acp2b3isco3ob4kov2cho3re2der3ia4ne4r2fta2g3asaki3oya3pur3ware3y2huatl4m2iad3l4brush3paul3r4obi3smith3ve5ty6é2ked2m3ath3e4less4sake3ibia7n3pa2n3ak3chang4y3ette3jing3king3nie4y3obot4ok4second4technology3sen3tes4ucket2omi2p3a4lm3e3htali5ha7lene3ier3kin3les3oleon8ic3py3ster2rc4issi8sm9t:ic7us4osis5tic3k3mada3nia3ragansett5te6ion7ve6or4ow3whal3y2sa4l5ize3car4ent3daq3h4ua4ville3sau4er3tiness4urtium4y2t3al5ia6e4sha3chez3e3han6iel3ion6al8ism:t;ic9ty9zation:e6wide4ve5ity3l3o3ty3ural7ism9t:ic8zation9e5e2ugahyde4ht6iness6y3ru3sea6m6te5ous3tical5li6us2vaho4jo4l4rre6o3e4l3igability7le6te7ion:al7or3ratilova3y2y3sayer2zarene6th3ca3i4ism4sm1b2a2c1c2aa2o1d2jamena1e2'er2al3nderthal3politan3r4by4sighted3t4h2braska8n3uchadnezzar4la6e6r5ous2cessary6itate8y3k4erchief:ves4lace5ine4tie3romancer9y5philia5sis3tar6ine2edful4iness4le6point6work4n't4y2farious3ertiti2g3ate5ion6ve7ity3ev3lect7ful4ig6ee7nce8t6ible9y3otiable7te8ion8or3ro5id2hemiah3ru2igh5bor8hood8liness3l3ther2lda3l4ie4y3sen4on2matode3butal3eses5is2o3classic:al:ism4olonialism5n6servative3dymium3gene3lithic4ogism3n4atal6e3philia5yte4rene2pal5ese5i3hew4ritis3otism3tune6ium2rd4y3eid3f3o3uda3ve5less4ous4y2scafe3selrode3t4le4or6ius2t3book3flix3her6lander:s6most3iquette3scape3tie4le6some3work3zahualcoyotl2ural6gia8c4itis4ological9st8y5n5ses6is6urgery5tic8ally6ransmitter3ter4ral7ity8zation9e5ino5on2v3a4da6n3ermore5theless3is3sky2w3ark3bie4orn4urgh3castle4omer3el3fangled4oundland3line4ywed3man3port3sagents4boy4cast4flash4group4letter4man5en4paper9man:en9woman<en5rint4reel4stand4week5orthy4y3t4on6ian2xis3t3us1fl1galiema2uyen1h2l1i2acin3gara3mey2b3ble3elung2caea4ragua9n3colo3e4ne4ty3he4iren4olas6e6s7on3k4el6odeon4laus5e4nack6me4olas3obar4demus4la5e4sia4tine2ebuhr3ce3lsen3tzsche3ves2fty2gel4r5ia7n3ga5rd7liness5z4er4le3h4t5cap6lothes7ub5fall5gown5hawk5ie6ngale5life5mare8ish5shade7irt6tick5time5y2hilism7t8ic2jinsky2ke3ita3kei4i3olai6yev4n2l3e2mbi4le5y4us4y3itz3rod2na3compoop3e4pin4teen8th5ieth5y4veh3ja3ny3tendo4h2obe2p3ple4on4y2renberg3vana2san3ei3san2t3a3e3pick3rate4ogen8ous6lycerin=e3wit2vea2x3on1j1krumah1m1o2ah2bel5ist3ility3le5man6en5woman8en4y3ody2cturnal7e2dal3dy3e3oz3ular5e2e3l4le3mi2ggin2h2ise5less5maker4iness4ome4y2kia2la4n2mad5ic3e4nclature3inal6te7ion8ve5ee2n3a4brasive5sorbent4genarian4lcoholic5igned3believer4reakable3ce4halance9t4om6batant6mercial7ittal6petitive7liance5nductor6formist;ty6tagious5operation3dairy4eductible5nominational5script4rinker3e4mpty4ntity4ssential5uch4theless4vent4xempt5istence:t3fat6al4iction4lammable3governmental3hazardous4uman3industrial5terference8vention3judgmental3linear5ving3malignant4ember3negotiable3objective3pareil6tisan5yment4hysical4lus7ses4oisonous5litical6luting4rescription5oductive6fessional7it6liferation3refillable6undable5newable5presentational5sident6trictive5turnable4igid3scheduled4easonal5ctarian5nse7ical5xist4kid4moker7ing4tandard5ick5op4upport3taxable4echnical4oxic4ransferable5ivial3union4ser3verbal4iolence9t4oting3white3zero2odle3k3n4day4time3se3tka2pe2r3a3bert7o3dic3een3folk3iega3m4a5l6cy6ity7zation8e5n6dy5tive3plant3ris3se5man6en3th5ampton5bound5east9ern9ward6rly7n8most5rop6up5ward6est9erly;n9ward4on3way4egian4ich2se4bleed4dive5ove4gay4y3feratu3h3iness3talgia8c9ally4radamus5il5um3y2t3able6y4rize5y4tion3ch3e4book4pad6per4worthy3hing3ice6able9y6board4fication5y4on6al3oriety6ous3tingham3withstanding4ork2uakchott3gat4ht3mea3n3rish3s2v3a4e4rtis3el5ette5ist5la6e5ty4mber3gorod3ice4tiate3ocain8e4kuznetsk4sibirsk2w3adays4y3here3ise2xious3zema2yce3es2zzle1p2r1sa2fw1t2h1u2ance2b3ia5n4le2clear5i6c5us2de3ge3ism5t4ty2gget2isance2ke3ualofa2ll4ification6y5ty2mb4erless4skull3eracy6l6te7ion7or5ic7al5ology6us3ismatic9st3skull2n3avut3cio3ez3ki3nery2ptial2remberg4yev3se5maid5ry7man8en3ture2t3cracker3hatch3meat5g3rasweet4ia5ent5ment5tion9al9ist8us7ve3shell3tiness4y2zzle1v2idia1w2t1y2asa2bble2c2erere2lon2mph5omania;c2quil1z1ée0o1'brien2casey3lock3onnell6or2donnell2er2hara3iggins2keeffe2neil6l2rourke2toole1af3ish2hu2k3en3land4ey3um2r3lock3sman5en2s3is2t3en3h3meal2xaca1b2adiah3ma5care2duracy6te2edience7t3isance7t3lisk3rlin4on3se4ity3y2fuscate8ion2it4uary2j3ect6ion9able<y7ve8ity6or2late5ion3igate7ion7ory5e4que4terate9ion4vion7us3ong4quy2noxious2oe3ist2scene6ity4ure6ity3equious6y4rvable9y7nce8t7tion;al8ory6e4ss6ion7ve3idian3olescence:t6te3tacle4etric9al9ian4inacy7te4reperous5uct8ion;ist9ve2tain6able3rude5sive3use2verse3iate4ous1cala3ml3rina2cam4sion8al3ident8al3lude5sion7ve3ult4pancy7t6tion:al5y4r5rence2ean5going5ia6c5ographer;ic;y5us3lot2her3oa3re2t3agon7al4l4ne4ve5ia6o3et5te3ober4genarian4pi5us2ular4ist1d2dball3ity2e3ll3ssa3ts2in3ous3s3um2om4eter3r4iferous4less4ous2ysseus6y1e2dipal5us2rsted1f2elia2f3al3beat3enbach5d5se6ive4rtory3hand7edly3ice6holder6max5ial8dom7te6ous3line4oad3set4hoot6re4ide4pring4tage2t3en5times1gbomosho2den2ilvy2le4thorpe2re1h2io4an2m2o2sa1il3cloth3field3iness3skin3y2nk3tment2se1j2ibwa1k2ay2eechobee3fenokee2hotsk2inawa2la4homa8n2ra2toberfest1la3f3juwon3v2d3en5burg3field3ie3smobile3uvai2eaginous4nder3n4ek3o4margarine2factory2ga2igarch8ic8y4ocene3n3ve5tti4ia5er2lie2mec3sted2sen3on2ympia7n6c5us1maha3n3r3yyad2budsman7en2durman2ega3let6te3n2inous3ssion3t2nibus7ses4potence9t5resence:t4science9t4vore7ous2sk1n2assis2ce3ology4ming2e3al3ga4in3ida3rous3self3time2going2ion5skin2line3ooker2o3matopoeia;c3ndaga2rush2sager3et3hore3laught2tario3o2us2ward2yx1odles2ps2rt2ze1p2acity3l4escence9t3que2ec3l3n4handed4office4work3ra5ble5nd5te6ic7on9al7ve6or4etta2helia3iuchus3thalmic8ologist<y2iate3ne4ion7ated3oid3um2ossum2penheimer3onent4rtune8ism:t;ic9ty4se5ite7ion3ress7ion8ve7or4obrious8um2rah2t3ic5al5ian4ma6l5ism7t8ic:ally6zation7e5um4on6al3ometrist8y2ulence6t3s1r2a3cle4ular3l3n4ge6ade5utan9g4jestad3te4ion4or6ical7o6y2b3ison4t5al2c3hard4estra9l9te:ion4id2dain3eal4r5liness3inal6nce6riness7y6tion3nance3ovician3ure2e3gano4on6ian3m3o3stes2gan5die6y5elle5ic7ally6sm7t6zation<al7e4sm6ic3iastic3y2ient6al7te8ion3fice3gami4in6al8ity7te8ion8or3n4oco3ole4n3ya3zaba2kney2lando3eans3on2molu2nament8al9tion4te3ery3ithologist:y2otund2phan6age4eus4ic2r2tega3hodontia:c:st7x8y5gonal:ity6raphic:y5paedic:st6edic9st3iz2val3ille2well6ian1s2age3ka2bert3orn6e2car3eola3illate8ion8or6oscope2good2ha4wa3kosh2ier3ris2lo2man3osis4tic2prey2sification5y2tensible9y5tation:us4opath9y6orosis3racism7ze4ich4ogoth3wald2valdo2wald1t2hello4r5wise6orldly2iose3s2oh2tawa3o4man1uagadougou2ch2ght2ija2nce2r3selves2st2t3age3back5lance4id4ound4reak4uilding5rst3cast4lass4ome4rop5y3dated4id5stance4o5ne5or3ermost3field5t4lank4ox3go4rew5ow7n7th3house3laid5ndish5st5w5y4et4ine5ve4ook4ying3maneuver6oeuvre4oded3number3patient4erform4lacement6y4ost5uring4ut3rage7ous5n6k4each4ider5gger6ht4un4é3sell5t4hine5one4ide5ze4kirt4mart4old5urce4poken5read4tanding6tion6y5retch6ip8t3take3vote3ward4ear5igh4it4ore6n1va3l3rian4y3tion2en3r4abundance;t5chieve6t7ive5ge5ll5mbitious5nxious5te5we4balance5ear5ite5lown5oard6ok6re7ne5urden4came6st6utious5harge5lock5oat6me7pensate=ion6nfident6ok5rowd4did5o6ne6se5raft7w8n6ess7w6ive5ue4eager6t7en5mphasize5nthusiastic5stimate5xpose9ure6tend4flow5ull4generous5rew6ow8n8th4hand7g6ul5ead7r7t5ung4indulge;nce4joy4kill4laid7n6nd6p6y5ie5oad6ng6ok6rd4much4night4paid6ss6y5lay5opulate;ion6wer5rice7nt6oduce:tion7tective4qualified4ran6te5each8t9ion5idden7e6pe5ode5ule6n4sampling6w5eas6e7n6ll6nsitive6xed5hadow7re6oe7ot7t5ight6mplification;y6ze5leep7pt5old5pecialize7nd8t6ill6read5tate7y6ep6ock6uffed5upply4t5ake8n6x5hink6ought6rew7ow9n5ime5one6ok5ure7n4use4view4weening6ight5helm5ork5rite8ten6ought4zealous2id4uct3parous2oid2ulate6ion4e3m1w2e3n4sboro2l3et3ish2n3ership1x2bow2en2ford2idation4e4ize2nard2onian2us2yacetylene3contin3gen6ate8ion3mora6on1yster1z2ark2one2ymandias2zie0p1a2ar2blo4um3st2c3e4maker4setter3heco4yderm3ific7ally8tion6sm7t5y4no3k4age5rd4et3t2ddle4ock4y3erewski3illa3lock3re2ean2gan5ini6sm3e4ant7ry3inate7ion3lia3oda2hlavi2id3ge3l4ful4sful3n4e4ful4killer4less4staking4t5brush5work3r4wise3sley2jamas2kistan8i2l3ace4table6l5e5ial4u4ver4zzi6o3e4face4mbang4ocene5gene5lithic5ntologist;y5zoic4rmo4stine8ian6rina4tte4y3ikir4mony5psest4ndrome9ic4sade3l4adio7um4bearer4et4iate7ion8ve5d4or3m4dale4erston5tto4ist7ry4olive4y5ra3omar5ino3pable7y5te6ion4itate8ion3sy3triness5y2m3ela3irs3pas4er4hlet8eer2n3acea5he4ma6nian4sonic3cake4hromatic4reas7tic3da4emic6onium5r4ora3e4gyric4l5ist3g4aea3handle3ic5ked6ing6y4er3khurst3munjom3nier3oply4rama7ic3sy3t4agruel5loon4heism8t9ic6on6r4ie4omime4ry4suit4y5hose3za2p3a4cy4l4w4ya3erback6oy5girl5hanger5weight6ork5y3illa7e3oose3rika3yri5us2r3able5ola7ic4celsus5hute8ist5lete4de5igm8atic6se5ox7ical4ffin4gliding5on5raph5uay8an4keet4legal5lax6el8ism8ogram5yses7is6tic6ze4maribo5ecia8um6dic9al6ter5ilitary5ount7r4noia7d6rmal5á4pet5hernalia6rase5legia9c5rofessional5sychology4sailing5ite7ic5ol4trooper9s3boil3c4el4h5eesi3don6able3e4nt6age7l6heses9is:ze8tic;al7ood4to3fait3iah4s5h6ioner5ian4ty3k4a4ersburg4inson4man4our4way3lance5y4ey4iament:arian<y4or3mesan3nassus4ell3ochial9ism4dy4le6e4xysm3quet7ry3r4akeet4icide5sh4ot4y3se5c4i5fal5monious8y4ley4nip4on6age3t4ake7n4erre4henogenesis8n5ia4ial7ity5cipant9te:ion:or<y8ial8le6le6ular:ity;zation<e9te5san8ship5tion5zan4ner7ship4ook4ridge4urition4way4y3venu2sadena3cagoula5l4hal4o3ha3quale3sable7y5ge7way4book4el5nger5rby6sby4ion7ate7less5ve6ity4key4over4port4word4é3t4a4e5board5l5rn7ak5ur7ization9e4iche5e5me4or6al7te4rami5y4urage6e4y2t3agonia9n3ch5iness5work5y3e4l5la7e4nt4rnal8ism:tic6ity5son3h4etic8ally4ogen8ic5logical9st8y5s4way3ience6t4na6e5e4o3na3ois3riarch9al9y5ca6e6ia8n7de6k5monial8y5ot7ic9ally8sm4ol6man7en6woman9en5n6age6ize6ymic3sy3tern6son4i4on4y2ucity3l4a4ette4i5ne3nch6y3per6ism7ze3se2varotti3e3ilion3lov6a6ian2w3l3n4broker4ee4shop3paw2y3able3check3day3ee3load3master3ne3off3pal3roll3wall5re1b2x1c2b2mcia2t1d2f2q1e2a3body3ce5able8y5ful5keeping5maker5time4h4ock3fowl3hen3k3l4e3nut3r4l5ie4son4y3sant7ry4e3t2bble5y2can3cadillo5ry3hora3k4inpah3os3s3tin4oral3uliar8ity4niary2dagog7ic9al7ue7y4l4nt6ic8ally6ry3dle3erast8y4stal6rian:ize3iatric9ian8st4cure4gree4ment3lar3ometer3ro2e3k4aboo3l3p4hole3rage4less3ve4ish3wee2g3asus3gy2i3ping2jorative2kinese5g6ese3oe2lagic3e4e3ican3lagra4et4ucid3oponnese3t3ves4ic5s2mbroke2n3a4l5ize5ty4nce3ce4hant4il3dant4ent5recki4ulous6um3elope4trable7te8ion9ve3guin3icillin4le4nsula9r4s4tence7t8ial:ry3knife6ves3light5te3manship3n4ant4ey4iless5ngton4on4sylvania<n4y5weight4zoil3ologist7y3sacola4ion5ve3t4agon8al5meter5teuch6hlon5x4ecost9al4house4ium3ultimate4rious5y2on4age4y3ple3ria2p3in3percorn6mint6oni6y4y3si5n3tic3ys2quot2r3ambulate:or3cale4eivable7e5nt7age7ile5ptible:y8on8ve7ual4h5ance5eron4ival4olate8ion8or4ussion:ist4y3dition3egrination4lman4mptory4nnial4z3fect7ible8on:ism<t4idious6y4orate8ion6ce6m7ance4ume7ry5nctory3haps3icardia9um5lean7s4gee4helia8on4l5ous4meter4od6ic8al8ity6ontal4patetic5heral8y6rases9is4scope5h6able4tonea8um7itis4wig6nkle3jure6y3k4iness6s4y3l3m4afrost5lloy5nence8t4eability7le6te4ian5ssible:y8on8ve5t4utation6e3nicious4od3on4ration4t4xide3pendicular5trate9ion9or6ual8te9ion7ity4lex7ity3quisite3ry3secute8ion8or5id5phone6olis5us5verance8e4hing4ia6n5flage5mmon5st7ence9t4nickety4on6a7ble7e7ge7l8ity9ze6ification8y6nel4pective5icacious:ty7uity8ous6ration7e4uade6sion8ve3t4ain4h4inacious9ty6ence8t4urb7ation3u4sal5e4vian3vade5sive4erse7ion8ty6t2seta3hawar3ky3o3simal6ism8t9ic;ally3t4icide5lence8t4le2t3al5uma4rd3e4rsen6on3iole4te5ion3ra5rch4el4ifaction6y4ochemical5l6atum6eum3ticoat5fog5ness4y3ulance7t4nia2ugeot2w3ee3ter2yote1fc2izer1g2p1h2aedra4thon3ge3langes6x4li6c5us3nerozoic4tasm8agoria7y5om3raoh4isee4maceutical7ist7ologist;y8peia9oeia7y4yngeal8s6x3se2easant3kda3lps3nobarbital5mena9l8on5type3romone2ial3dias3l4adelphia5nder6thropic=ally<st;y5telic9st8y4by4harmonic4ip6pe7ians8c8ne5stine4lip7a4odendra:on5logical9st8y5sopher9ic;al:ze9y4ter3pps3sh2lebitis4gm6atic:ally3oem4x2obia5c4os3ebe4nicia6x3ne5me6ic5tic8ally8ian5y4ic6ally5ness4ograph5logical9st8y4y3oey3sphate6or8escence=t8ic8us3to5copy5electric5genic6raph:ic<ally:y5journalism>t5n5sensitive6tat6ynthesis5typesetter=ing2p2rasal5e6ology3eaking4nology3ygia2yla4lis4um3sic6al6ian7st6ked7ing5ognomy6logical:st9y6therapist<y5que1i2af3get3nissimi9o6t4o5forte5la3zza5e2ca4nte4resque4sso4yune3cadilly5lilli4olo3k4aback5x6e4erel5t6t4ford4le4pocket4up4wick4y3nic6ked8r7ing3t4ograph5rial4ure7sque2ddle3gin2e3bald3ce5meal5work3dmont3rce4re5ot3ty2ffle2g3eon6hole3gish4y5back3headed3let3mentation4y3pen3skin4ty3tail2ke2laf5f4ster4te4u4w3chard4omayo3e4up3fer3grim7age3l4age5r4box4ion4ory5w6case4sbury3ot5house2mento3iento3p4ernel4le2n3afore4tubo3ball3cer4h4us6hion3dar3e4apple3feather3g3head4ole3ion3k4erton5ye4ie5sh4y3nacle5te3occhio5het6le3point4rick3stripe3t4o3up3wheel2oneer3us2p3e4line3it3pin3squeak2quancy6t4e2racy4eus4ndello5ha4te5ical3ouette2sa3catorial4es3istratus3saro3tachio4il6late4ol5n2t3a3cairn4h5blende5fork5man6en3eous3fall3h4y3iable7y4ful4less3on3t4ance4man4sburgh5field3uitary3y2us2vot5al2xel3ie3y2zarro4zz3za5zz4eria4icati8o1kg2wy1l2acard5te6ion4e5bo5holder5nta8e8l4id6ity4ket3giarism9t8ze4ue3ice4d4n5clothes<man=en5t6iff7ve4t3n4ar4ck4e5t6aria9um8y4gent4k5ton4t5agenet6in6tion3que3sma4ter7board5ic7ine8ty6que3taea4e5au7x5ful5let5n4form4h4inum5tude8inous4o5nic7sm8t5on4te4ypi6us3udit4sibility7le8y4tus3y4able5ct4back5ill5oy4ful4goer5round4house4list4mate4off4pen4room4station4tex5hing4wright3za2ea4sant8ry5e5urable:y7e4t3beian4iscite3ctra6um3dge3iades4stocene3nary4ipotentiary5tude4teous5iful5y3thora3urisy3xiglas4us2iability5le4ncy5t3ers3ght3nth4y3ocene2o3nk3p3t3ugh6share3ver3w4man5en4share3y2uck5iness5y3g4in3m4age4b4e4met4p3nder4ge4k3perfect3ral6ism8tic7ty7ze3s4h5y4ses3tarch4o5cracy8t9ic5nium2y3mouth3wood1m1neumatic9ally5onia1o2ach2cahontas4tello3k4et6book6ful6knife9ves4mark3ono2dcast3gorica3horetz3ia5trist7y4um3unk2e3m3sy3t4ess4ic6al4ry2go3rom2i3gnancy7t3ncaré4settia4t5illism:t5less5y3ret4ot3se4on6ous4son3tier2ke4y3y3émon2l3and5ski4r5is6ty6zation7e5oid3e4cat4mic7al4star3ice6man7en6woman9en5y6holder4o5myelitis4sh4tburo5e6sse5ic7al7ian8ze7o5y3k4a3l4ard4en4inate8ion5wog4ock4ster4utant6e6ion5x4yanna5wog3o4naise5ium3tava4ergeist4roon3yamory4ester5thylene4gamist7ous7y5lot5on7al5raph4hedra8on5ymnia4math5er7ic8zation5orphic4nesia9n5omial4p5hemus6onic8y4styrene5yllabic:le4technic5heism9t:ic7ne4unsaturated2made3egranate4rania9n3mel3ona3p4adour4eii5y4om5n5sity5us2nce4ho3d4erous3e3iard3tchartrain4iac6nak5ff6ical9te4oon3y4tail2och3dle3h3l4e3na3p3r4house2p3corn3e4ye3gun3injay3lar4in3ocatepetl4ver3pa4ins4y5cock3sicle3ulace6r7ity8zation9e6te7ion5ism7t5ous2rcelain4h4ine4upine3e3firio3k3n4o5grapher:ic:y3osity4us3phyry4oise3ridge5ma5nger3sche3t4ability6le5ge5l4cullis4end6t7ous5rhouse6ville4folio4hole4ia5co5on4land5iness4manteau;x4rait8ist8ure6y7al4smouth4ugal6uese2se4idon4ur3h3it5ion8al6ve7ism5ron3s4e5ssion8ve7or4ibility6le7y4um3t4age5l4box4card5ode4date5oc7toral4erior7ty4graduate6esql4haste5umous4lude4man6rk6ster5en5istress5odern6rtem4natal4operative4paid6rtum5one4script4ulate5re4war3y2t3able4sh5sium4to3belly4oiler3emkin4ncy5t6ate6ial9ity3ful3holder6e5ok3ion3luck3omac3pie4ourri3sdam4herd5ot3tage5watomie4ery4s5town4y2uch3ghkeepsie3ltice5ry3nce4d3r3ssin3t2verty2w3der6y3ell4rboat5ful5house5less5pc6oint3hatan3wow2x2znan1p1r2acticability9le:y8l9ity7e6se6tioner3da4o3etorian3gmatic9ally8sm9t4ue3ia4rie4se6worthiness;y3krit3line3m3nce4k5ster3tchett4e4fall4t5le3vda3wn3xiteles3y2each6y4kness4mble4rrange3cambrian5rious5ution:ary4ede7nce8t5pt7or4inct5osity6us5pice7tant9te:ion8ous5se6ion4lude6sion4ocious7ty5gnition5nceive8ption6dition4ursor3date6or8y4ecease7ssor5fined5stination9e5termination;e4icament7te8ion9ve6t7ability9le:y7ion8ve7or5lection5spose9ition4ominance:t9te3eminence9t5pt7ion8ve4n4xist3fab6ricate;ion5ce5tory4ect7ure5r6able9y6ence8tial4igure5x3gnancy7t3heat5nsile4istoric9y3judge7ment6ice8ial3late4iminary4ude3marital5ture4editate:ion5nstrual4ier7e5nger5se6s5um4onition8ory4yslid3natal4sa4tice4up3occupation8y4rdain3p4ackage5id5ration8ory6e5y4onderance;t:te5sition;al6sess6terous4pie5y3quel3record5gister9ration5quisite4ogative3sage4byterian<ism4chool5ience8t5ott5ribe7ption:ve4ence6t7able8tion7iment5rvation:ve7e5t4hrank6ink6unk9en4ide7ncy8t9ial4ley4sman6en5ure7ization9e4tige7ious5o6n4umable9y6e6ption9ve8uous5ppose9ition3teen5nce6d6se7ion6tious5rit8e6natural5xt4oria4tify6ness5y4zel3vail5lence8t5ricate:ion:or4ent7able8tive7ible8on8ve4iew5ous4ue3war3y2iam3bilof3ce5less6ine5y4k5le4y3de3estess6hood6ley3g4gish3m4acy5eval5l5ry5te4e5val4itive4ogeniture5rdial4p4rose3nce6ton5ipal9ity7e7le4t5able5out3or5ess5itize7y5y3scilla4m5atic4on4siness5y4tine3thee3us3vacy5te6ion7zation8e4et4ilege4y3ze5fight2o3active3babilistic9ty6le7y5te6ion9ary4e4ity4lem7atic;al4oscides8s3cedural8e5ed5ss7ion:al7or4laim6mation5ivity4rastinate<ion<or5eate8ion9ve5ustean9s4ter5or4urator6e4yon3digal8ity6ious6y4uce6t7ion8ve9ity3f4anation6e6ity4ess7ion:al<ism7or9ial9ship4iciency9t5le5t6ability8le9y6eer4ligacy8te4orma5und4undity5se6ion3genitor6y5sterone4noses7is7tic:ate<ion<or4ram7mable8e5ess8ion9ve3hibit8ion;ist9ve8ory3ject7ile8on:ist7or3kofiev3letarian:t4iferate:ion6ic8ally5x6ity4og6ue5ng7ation3m4enade5thean8us4inence8t5scuity8ous6e6sory4o5ntory5te6ion9al4pt4ulgate9ion3n4e4g5horn4oun7ce9able4to4unciation3of5read3p4aganda9ist:ze7te8ion5ne4el6lant7ent5nsity5rty4hecy6sy6t7ess7ic9ally5ylactic8xis4inquity5tiate9ion9ory7ous4onent5rtion:al<ity;te5sal6e6ition;al5und4rietary8or:ship8ress8y4ulsion8ve3rate3saic7ally4cenia8um5ribe7ption4e5cute8ion8or5lyte8ize5rpine4ody4pect8ive8or8us6r7ity7ous4tate5heses8is7tic5itute9ion5rate8ion4y3tagonist7ras4ean5ct7ion8ve7or9ate5in5rozoic5st7ant:ism8tion7or5us4ocol5n5plasm:ic5type5zoa8n7on4ract8ion8or5ude6sion4uberance:t4égé3ud5hon4st3vable7y4e5n6ance6cals7e6der6çal5rb7ial4ide7nce8t9ial5nce7ial:ism5sion9al6o4o5cation9ve5ke5st3w4ess4l3ximity4y3zac2ude5nce6t7ial5ry4ish3itt3ne3rience7t3ssia7n3t2y3or2écis1s2alm5ist4ter2eudo6nym2haw2oriasis2st2t2ych5e6delic5iatric:st9y6c7al5o6analysis<t;ze6babble6genic6kinesis6logical:st9y6path:ic6sis7omatic6therapist<y7ic1t2a3h3rmigan2erodactyl2olemaic6y3maine1u2b3erty4scence8t3ic3lic6an7tion6ist7ty7ze5sh7able2ccini3k4ett4ish2dding4le3gy2ebla5o3rile6ity4to2ff4ball4in6ess4y2g3et3h3ilism7t8ic3nacious7ty2ke2laski3chritude3itzer3l4back4et5y4man4out5ver3monary3p4it4y3sar5te6ion4e3verization8e2ma3ice3mel3p4ernickel4kin2n3ch5line5y4tilious5ual8ity7te8ion6re3dit3gency6t3ic4sh6able4tive3jab6i3k3ster3t3y2p3a4e4l3il3pet6eer6ry4y2rana3blind3cell4hasable7e3due3e4bred4e3gative6orial8y4e3ification5y4m4na4sm5t4tan7ical8sm5y3l4oin3ple5ish4ort5se7ful7less3r3se4uance7t5e5it3ulence7t4s3vey6or4iew2san3ey3h4cart4iness4kin4over4tu4up4y3illanimity:ous3sy5cat5foot3tule2t3ative3in3nam3refaction6y5scence9t4id3sch3t4y2zo3zle1vc1wn1x1ygmalion4y2le3on2m2nchon2ongyang3rrhea3tr2ramid7al3e4nees4x3ite3omania9c4technic3rhic2thagoras8ean4ias4on3orch2x1étain1ôrto0q1a2ddafi2ntas2tar1ingdao2qihar1om1t1ua3alude3ck5ery3drangle8ular7t6phonic6tic7ure5ennial5iceps6lateral7le6phonic7legia;c5uped7le9t8icate3ff3gmire3haug4og3il4nt3ke3lcomm4ification6y5tative6y4m3ndary4ta5ify6tative7y5um3oar3rantine4k4rel7some5y4t5erback7deck7final7master6t7te5o5z3sar4h4i5modo3ternary4rain3ver6y3y4le2easiness5y3bec3chua3en5sland4r3ll3nch4tin3rulous4y3s4adilla4t5ion8able;y8naire3tzalcoatl3ue3zon2ibble3che4k5en5ie5lime5sand6ilver3d3escence8t4t5ude6s3ll4t3nce5y4e4ine4n4tessence:tial6t5ilian5on5uple9t3p3re4inal4k5y3sling3t4e4o3ver3xote6ic7sm3z4zes5ical2mran2oit3ndam4set3rum3ta5ble5tion4e4h4idian5ent2r'an3an2ébecois1werty0r1a2bat3bi5nate6ical5t4le3elais8ian3id4es4n2ccoon3e4course4horse4me4track4way3hael4el6le4maninoff3ial4ne6ss4sm5t3k4et6eer3onteur4on3quet7ball3y2dar3cliff8e3ial5nce6t5te6ion6or4cal7ism4i4o5active:ity5gram5isotope5logist8y5telephone6herapist;y4sh4um5s3on2e2f3ael3fia5sh4le3t2g3a4muffin3e3gedy3lan3narök3out3tag4ime3weed2id3l4lery4road4way3ment3n4bow4coat4drop4fall5orest4maker4storm4water4y3se4in2ja4h2ke3ish2leigh3ly3ph2m3a4da6n4krishna4nujan4yana3ble4o4unctious3ification5y4rez5o3on5a4s3p4age5nt5rt3rod3say4ey4hackle2n3ch4id6ity4or6ous3dal6l4ell4i4olph5m6ize4y3g4e4iness4oon4y3k4in6e4le3sack4om3t2oul2p3acious6ty3e3hael3id5ity4er4ne4st3port4rochement3scallion3t4ure6ous3unzel2quel2re4fy3ity2salgethi5hague3cal3h3mussen3p4berry4utin4y3ta5ban5farian;ism4er2t3chet3e3her4skeller3ification5y4o5n6al8e8ism:t;ic9ty9zation:e3liff3tan4le6snake6trap4rap4y2ucous3l3nchiness6y2vage3e4l4n5ous3ine4oli4sh2w3alpindi3boned3hide2y3ban4urn3leigh3mond4undo3on2ze3or3z1b2i1ca1d2a1e2ach5able4t5ion8ary6vate9ion7e5or3d4ability6le4ership4iness4just4mit4out4y3ffirm3gan6omics4ent3l4ign5sm6t7ic9ally5ty5zable7tion6e4locate9ion4m4tor5y3m3nimate3p4pear8ance5ly5oint6rtion5raisal9e3r4m5ament5ost4range4ward3son6able9y4semble6rt6ss5ign5urance7e3waken2ba4te3ecca4kah4l5lion8us3ind4rth3orn4und3roadcast3uff4ild6t4ke4s4t5tal2calcitrance;t5l4nt6ation4p5itulate;ion5ture4st3d3ede4ipt5vable6e7rship4nt4ptacle6ion9ist7ve8ity6or4ss6ion9al7ve3harge8able4eck5rché3idivism9t4fe4pe5ient5rocal9te:ion8ity4tal6tion8ve5e3kless4on3laim5mation5ssify4ine4use6ive3ognition7zable;y9nce8e4il4llect9ion4mbination8e5mence8d9ation5pense6ilation8e4ncilable8e8iation5dite8ion5figuration:e5naissance6ect6oiter5quer5sider:ation6titute7ruct;ion5vene4py4rd4unt5p5rse4ver7able7y3reant6te7ion:al4iminate:ion4udescence5it3ta5l5ngle7ular4ifiable7cation6y5linear5tude4or6y4um3umbent4perate9ion:ve4r5rence8t5sion7ve3yclable6e2dbreast3cap4oat3den4ish3ecorate4dicate4em6able4fine7ition4mption4ploy4sign4velop3ford3grave3head3id4rect8ion4s5cover:y5tribute;ion;or8ct3mond3neck3o4lence7t4ne4uble6t7able5nd3raft5w6n4ess5w3shift4kin3uce5tion4ndancy8t3wood2ebok3ducate8ion4y3f3k3l4ect7ion3merge4phasize3nact4force4list4ter5ry3se4tablish3valuate4e3xamine2f3ashion3ectory4ree6nce7da8um7t8ial5ral3ile5l6able4nance5e6ry5ish4t3lect7ion8ve7or5x6ive3ocus7ses4rest8ation5m6at8ion8ory6ulate3ract7ion7ory5in4esh4igerant9te:ion:or3uel4ge6e5io4lgence8t4nd6able4rbish5nish4sal5e4tation5e2gain4l5e5ia4rd6less4tta3ency5erate9ion:ve5t4xp3gae4ie3icide4me6n7t8al9tion4na6e6ld4on6al8ism4ster6rant8r8tion7y3or3ress7ion8ve5t6ful6table:y4oup3ular7ity8ze6te7ion7or9y5us4rgitate:ion2hab5ilitate;ion4sh3earsal7e5t3i4re3nquist2ich5stag3d3gn3lly3mburse4pose3n4aldo4carnate:ion4deer4force4hardt5old4itialize4sert5tall7te4terpret;ation4vent6st3s4sue3terate8ion2ject6ion3oice5n6der3uvenate9ion2kindle2label4id4pse4te5ion8al8ship6ve7istic8ty4x5ant6tion4y3earn5sable6e4gate7ion4nt6less4vance8y7t3iability6le7y5nce6t4c4ef5ve4gion7us4nquish4sh4ve3oad4catable7e7ion3uctance8t2m3ade4in6der4ke4nd4rk6able9y5que5riage6y4tch3brandt3ediable7l5y4mber6rance3ind5gton5isce9nce:t4ss6ion4t5tance3nant3odel4nstrance9te4rse7ful7less5tgage4te4unt4vable6l5e3unerate9ion:ve4s2na4issance4l4me4scence8t4ult3d4ezvous4ition3e4e4gade5e5otiate4w5able6l3net3o4ir4unce4vate7ion7or4wn3t4al3umber4nciation2occupy6r3pen3rder4g5anization9e2p3ackage4id5nt5r6able6man7en4ration5tee4st4triate9ion4y5able3eal5t6able9y4l5lant6ent4nt6ance8t4rcussion5toire7ry4tition9us8ve3hrase3lace7able5y4enish5te6ion4ica7te8ion8or3ort6age4se6ful5itory5sess9ion3rehend8sible<y5sent9ation>al<ve6s7ion8ve4ieve5mand5nt5sal6e4oach8ful5bate5cess5duce8ible8tion:ve5gram5of5ve3tile6ian3ublic8an:ism7sh4diate8ion4gnance8t4lse6ion7ve4table8y6tion5e2quest4iem5re5site8ion5tal6e2ran3ead3oute3un2sale3chedule4ind5ssion4ue3earch4ll4mblance7e4nd5t6ful4rvation6e6ist6oir4t5tle3huffle3ide6nce8y7t8ial5ual6e4gn6ation4lience9y8t4n5ous4st6ance8t6or3old5ute7ion5ve4nance7t6te7or4rt4und5rce8ful3p4ect7ability9le:y7ful7ive5ll6t4iration8or:y6e5te4lendence:t4ond7ent6se7ibility9le:y8ve3t4art5te5urant:eur8teur4ful4itution5ve4less4ock5ration9ve6e4rain8t5ict8ion9ve5oom5ucture4udy3ubmit4lt6ant4me5ption4pply4rface5gence8t5rect9ion4scitate:ion:or2tail5n4ke6n4liate8ion8ory4rd6ant7tion3ch3ell4ntion7ve3hink4ought3icence7t4na6e6l5ue4re6e3old4ok5l4rt4uch3race6t7able7ion5in4ead6t5nch4ial5bution9ve5evable8l7e4oactive5d6den5fit5grade7ess:ion;ve5rocket5spect:ion;ve4y3urn6able6ee3weet3ype2uben3nification6y5on5te3pholster3sable4e3ters4her2v3a4luation6e4mp3eal4ille4l5ation5ry4nge7ful5ue4rberate:ion5e6nce7d7t8ial5ie5sal6e6ible7on5t5y3iew4le4se5ion6t4talization9e4val7ist5e5ification7y3lon3ocable6tion4kable5e4lt5ution:ary:ist;ze5ve3ue4lsion2ward3ind6able4re3ord5k4und3rite6ten4ote2x2yes3kjavik3na5ldo4olds1fc2d1h2apsodic8ze7y2ea3e3ingau3nish3ostat3toric8al8ian3um5atic8sm5y2iannon3ne5land5stone4o5ceri8os3zome2o3da4e5sia4ium4odendron3mbi5oid5us3nda4e2ubarb2yme3thm6ic8al1i2b3ald6ry3bentrop4on3oflavin2cardo3e3h4ard7son4elieu4ie4mond4ter5hofen3k4enbacker5ts6y5y4ie4over4sha7w4y3o4chet4tta2ddance4en4le3e3ge5pole3icule7ous2efenstahl3l3mann3sling2fe3f4le4raff3le5man6en3t2g3a4marole3el3gs3ht5eous5ful5ist5most3id5ity3marole3oberto4letto4r5ous2le4y3ke3l2m3baud3e2nd3g4leader6t5ing4master4o4side4tone4worm3k3se2o3t4ous2p3e4n3ley3off4ste3ple3saw2se4n3ible3k4iness4y3orgimento3qué2ta4lin3e3ual6ism8tic3z4y2val5ry4s3en4r5a5bed5front5side4t3iera3ulet2yadh2zal1m1n2a1oach3d4bed5lock4house4kill4runner4show5ide5ter4way5ork7thy3m3n4oke3r3st2b3bery4ie5n4y3e4rson5t6a6o6son4son5pierre3in5son4tussin3les3ocall4t5ic3son3t3ust3yn2cco3ha5mbeau4e5lle5ster3k4efeller5t6ry4ford4iness4ne4well4y3oco2d3denberry3e4nt4o4rick3ger3in3ney3olfo3rick5go6uez5quez2e3buck3g3ntgen2fl2gelio4r4t3ue5ry4ish2il3ster2jas2ku2laids4nd6o3e4x3l4and4back4erblade6skating4ick5ns3odex3vaag2m3aine4n5ce5esque5ia7n5o6v5sh5tic8ally8ism:t9ze5y3e4o4ro3mel3ney3p3ulus2n3ald3da3nie4y3stadt2od3f4top3k4ery4ie3m4ful4iness4mate4y3ney3sevelt4t3t4less2pe2quefort2rschach3y2sa4les5ie6nd8a5yn4nna6e4rio5y3coe3e4ann5te5u4bud6sh4crans4lla4marie7y4nberg5do5zweig4tta6e4wood3icrucian4e4n5ess3lyn3s4etti4ini3tand4er4ov4ra5opovich5um3well3y2t3arian5y4te5ion8al3c3e3h4ko4schild3isserie3ogravure4r3ten5rdam4weiler3und6a6ity2uault3ge4h5age5en5house5neck5shod3lette3mania3nd5about5elay5house5ish5up5worm3rke3se4seau4tabout3t4e4ine6ize3é2ve2w3boat3diness4y5ism3e4l4na3land4ing2xanne3ie3y2y3al5ist5ty3ce2zelle1pm2s1r1s2v3p1te2fm1u2b3aiyat3berize6maid6neck6y4ish7y4le3down3e4lla4n3icon5und4k4n5stein3le3ric3y2chbah3ksack4us2dder4iness4y3e3iment8ary3olf5ph3y4ard2e3ful2ff4ian4le3us2g3by3rat2hr2in4ation4ous3z2keyser2le2m3ania3ba4le3inant6te7ion3mage4y3or3p4elstiltskin4le4us3sfeld2n3about4round4way3down3e3g3ic3nel4y5mede3off3t3way3yon2pee4rt3ture2ral2se3h4die4more3k4in3s4el6l5t4ia6n4o3t4belt4ic6ally6ity5ness4le4proof4y2t3abaga4n3gers3h4erford4ie4less3ledge1v1wanda6n1x1yan2dberg3er2e2ukyu0s1aab3r4inen3tchi2bbath6ical3er3ik4n5a5e3le3otage5eur3re4ina2c3ajawea3charin9e4o3erdotal3hem5t4s3k4cloth4ful3rament9al9o4ed4ifice8ial5lege8ious5stan7y4osanct2d3at3dam4en4le6bag4ucee3e3ie4sm5t6ic8ally3r2fari4vid3e4guard4keeping4ty4way3flower4ron2g3a4cious6ty4n3e4brush3inaw4ttarius3o3uaro2hara3el3ib2id3gon3l4board7t4cloth4fish4or3nt5hood5liness3ph3th2kai3e3ha5lin5rov3i3s2l3aam4ble4cious4d5in5o4mander5i4ry4s4zar3e4able4m4rno4sclerk5force5girl5man8ship6en5people7rson5woman8en3ience6t4nas5e5ger5ity4sbury5h4va6ry6te7ion3k3lie4ow4ust3mon6ella:e3ome4n4on3sa3t4cellar4ine4on4peter7re4shaker4water4y3ubrious4tary6tion5e3vador8an8ian5ge7able5tion6ore4e4o3ween3yut2m3antha4r5a5itan5kand3ba3e3izdat3mie4y3oa5n4set4var4yed3pan4le4son3son6ite4ung3uel6son4rai2n3a4toria8um3chez5o4ta5ification7y6monious6on6ty5uary6m3dal6wood4bag6nk6r5last5ox5urg4castle4hog4iness6ista4lot4man5en4oval4paper5iper4ra4stone7rm4wich4y3e3ford6ized3g4froid4uinary7e3hedrin3itaria8um7y6tion5ize5y3k4a5ra3serif4krit3ta5na5yana4eria4iago4os2p3ience6t3ling3phire5o4oro4y3rophyte3sucker2ra4cen4gossa4h4jevo4n4pe4sota4tov4wak3casm6tic9ally4oma7ta5phagi9us3dine6ia4onic8ally3ee3gasso4ent4on3i3noff3ong4yan3s4aparilla3to5rial4re2se3h4a5y3katchewan6oon3quatch3s4afras5nian4oon4y2t3an5ic7ally6sm7t4y3chel3e4en4llite3iate4ety4n5wood5y4re5ical6st6ze4sfaction9ory6y3rap3urate7ion5day5n6alia6ine3yr2uce5pan4iness4y3di3erkraut3l3na4ders5ra4ter3sage4sure3ted5rne4é2vage6ry4nna7h5t3e3ior5ur3onarola4r5y4y5ard3vy2w3dust3horse3mill3n3yer2x3on5y4phone8ist2y1b1c2ab4bard5y4ies4rous3d3ffold3g3la5r5wag4d4e5ne4lion5op5ywag4p5el4y3m4p5i3n4dal7ize7monger7ous5inavia;n4sion4t5iness5y3pegoat4ula7e3r4ab5mouch4borough4ce5ity4e5crow4f4ify4latti5et4ves4y3t4hing4ological4terbrain3venge2enario4e5ry4ic6ally4t3pter2heat4dar5ule4herazade4lling4ma6tic9ally5e4nectady4rzi6o3iaparelli4ck4ller4ndler4sm6atic5t4zoid6phrenia<c3lemiel5p6p5singer4iemann5tz4ock7y3maltz8y6z7y4idt4ooze4uck3nabel5pps5uzer4eider3oenberg4lar7ship6stic:ally4ol6book8y6child;ren6days6girl6house6marm8ster8te7istress6room6teacher6work6yard5ner4penhauer3rieffer4od5eder4ödinger3tick3ubert4ltz5z4mann5peter4ss4yler6kill3wa5rtz6zenegger7kopf4eitzer5ppes4inger6n2iatic7a3ence5tific:ally7st6ology3mitar3ntilla9te:ion3on3pio3ssor2lerosis6tic2off5law3ld4iosis4lop3nce4e3op4t3pe3rch4e5board5card5less4n5ful4pio7n6us4sese3t4ch6man7en4ia4land4sman6en5woman8en4t5ie6sh5sdale5y3undrel4r5ge4t5master3w4l2rabble4ggly4m5ble4nton4p5book5e5py4tch7iness7y4wl5ny3eam4ech7y5n6play6shot6writer4w5ball5driver5y3iabin4bble5e5ner4mmage5p5shaw4p5t6ural8e6writer3od4fula4g4ll4oge4ta5um4unge3ub5by4ff6y4ggs4mptious4nch7ie7y4ple5ulous4tinize7y2uba3d3ff5le3ll5ery6y5ion4pt6or6ural8e3m4bag4my3pper3rf5y4rilous5y4vy3ttle7butt3zzy2ylla3the5ia7n1d1e2a3bed4ird4oard5rg3coast3farer6ing4ood3going4ram3l4ant4skin3m4an6ship4en4less4stress4y3n3plane4ort3r4ch6light3scape4hell5ore4ick5de4on6able7l3t4tle3ward5y4eed4orthy2baceous4stian3ring2c3ede4ssion9ist3lude5sion7ve3onal5d6ary6hand3recy5t6arial:t8y6e6ion7ve3t4arian9ism4ion7al9ism4or3ular7ism8zation9e4re5ity3y2dan4te5ion6ve3entary4r3ge3iment8ary9tion4tion7us3na3uce5tion7ve4lous2e3beck3diness4less5ing4y3ger3k3m4liness3n3p4age3rsucker3saw3the2ga3fault3ment7ation3ovia3re5gate8ion;ist3ue4ndo2iko3ne4feld3smic7ally5ograph;ic6logist9y3ze4ure2jong2lassie3dom3ect6ion7ve8ity6man7en6or6ric4na5ium4ucid6us3f4ie5sh4less4same3im3juk3kirk3l4off5ut3ma3tzer3vage4edge5s3znick2mantic8ally4phore4rang3blance3en4ster3i4annual5utomatic4circle8ular5olon6nductor7scious4final9ist4monthly4nal6r7ian7y5ole4otics4permeable5recious6ivate6ofessional4ramis5etired4skilled4te5ic5one5railer6opical4weekly3tex2n3ate5or7ial3dai3eca4gal7ese3ghor3ile5ity4or6ity3na5cherib4ett3sation9al;ism=t4e5less4ibility6le7y5tive8ity7zation8e4or6y4ual7ity5ous5rround3t4ence6tious4ience7t5ment9al;ism=t<ty<ze5nel4ry2oul2p3al4rable6te7ion8sm9t7or3hardi3ia3oy3sis3t4a4ember5t6te4ic6emia4uagenarian7int5m3ulcher7ral2quel5nce6tial5ster7ration4in5tur4oia5ya2ra4glio4pe5h6ic7m3b4ia6n3e4na6de5dipitous:y5e5geti5ity3f4dom3ge5ant5i4io3ial6ization8e4es4ous3mon6ize3ous3pens6t7ine3ra5no5ted4ied3um3vant4e4ice7able7man8en7woman:en5ette5le6ity5tude4o5mechanism2same3sion2t3back3h3on3table4ee4le3up2urat3ss2vastopol3en5teen9th6h6ieth6y4r5al6nce5e5ity5n5us3ille2w3age4rd3erage3n2x3agenarian3iness4sm5t3less3pot3tans6t4et6te4ing4on3ual6ity3y2ychelles3fert3mour1f1gt1h2abbiness5y3ck5le7ton3d4e4iness4ow6box6y4y3ffer4t3g4giness5y3h3ikh3ka4e5down5n5speare;an5up4iness4y3le4l5ot6w4t3m4an4ble4e5faced6ul5less4my4poo4rock3n't4a4dy4e4ghai4k5ara4na5on4tung5y6town3pe5less6iness4iro3rable4d4e5able5cropper5holder5point5ware4i5'a5a6h5f4k5skin4lene4on4p5e6n5shooter4ron3sta3t4terproof3ula4n5a3ve5n4ian4uot3w4l4n5a5ee3ykh2charansky2e3'd4ll3a4f4r4th6e4ve3ba5ng4eli4oygan3en5a4p5dog5fold5ish5skin4t5rock3ffield3ik5dom5h6dom4la3kel3lby4don4f4ia4l5ac7ked8ing5ey5fish5y4ter5on4ve3nandoah6igan4yang3ol3pard4herd8ess4pard3ratan6on4bert6t4d4ee4i5dan5ff4lock4man4pa4ri6e5y4wood4yl3tland3vardnadze5t2i'ite3bboleth3eld3ft5iness5less5y3itake3jiazhuang3koku3ll5alah5elagh5ong4oh3m4mery5y3n4bone4dig4e4gle4iness4ny4to6ism4y3p4board5uilder9ing4load4mate4shape4wreck6ight4yard3raz4e4k4ley4r4t5sleeve5tail5waist3t4ty3va4er6y2lemiel4p5p3ock6y2oal3ck5ley5proof3d4den5iness5y3e4horn4lace4maker4shine5tring3gun3ne3o4k4n4t5out3p4aholic4keeper4lift4talk4worn3re5line4n4t5age5bread5cake6hange6oming6ut5en5fall5hand6orn5ish5list5sighted6top5wave3shone4takovitch3t4gun3uld6've6n't4t3ve5l6ful3w4biz5oat4case4down4ery4girl4iness4man7ship5en4n4off4piece5lace4room4stopper4y2rank4pnel3ed4k4veport4w5ish3iek4ft4ke4ll6y4mp4ne5k6able7ge4ve6l6n3opshire4ud4ve3ub5bery6y4g4nk6en2tick4k2uck3dder3ffle7board3la3n4t3sh3t4down4eye4out4terbug5le7cock2y3lock7ian3ster1i2am4ese3n2belius4ria7n3ilant3ling3yl2c3ilian5y3k4bed4en4le2ddhartha3e4arm4bar5oard5urns4car4kick4light6ne5ong4real4saddle5how5plitting5tep6roke5wipe4track4walk7l6ys5ise3le3ney2ege4fried3mens3rpinski4ra3sta3ve2ft2gh4t5less5read5seeing8r3ismund3ma4und3n4al6ize5tory6ure4board4et4ificance:t9tion6y4post3urd2hanouk2kh4ism3kim6ese3orsky2lage4s3ence5t3houette3ica6te5eous5ious5on7e6sis3k4en4worm4y3l4iness4y3o3t3urian3va5n4er6fish6smith6ware6y4ia2m3enon3ian4lar7ity5e3mental4ons3on5e3patico4er4le6ton6x5icity6fication7y6stic5y4son7ville3ulate7ion7or5cast5taneous2n3ai4tra3ce5re6ity4lair3dbad4hi3e4cure4w5y3ful3g4apore4e4h4le6ton4song4ular8ity3halese3ister3k4able4hole4iang3uous4s5itis5oidal2oux2p3hon2r3e4n3ius3loin3occo3up2sal3sy3ter6hood4ine3yphean6us2t3ar3com3e3u4ate6ion2va4n2x3pence3teen7th4h4ieth4y2zable3e4able3zle1jaelland2w1kate5board2edaddle3et3in3letal6on3ptic7al7ism3tch6y3w2i3ff3lful4l5et5ful3m4p5iness5y3n4flint4head4less4niness5y4tight3p4py3rmish4t3t4tish3vvy2opje2ulduggery4k4l5cap5duggery3nk2y3cap3dive4ove3e3jack3lab5rk4ight5ne3pe3rocket3scraper3ward4riter7ing1lab3ck5en5ware3g3in3ke3lom3m3nder7ous4g5y4t5wise3p4dash4happy4stick3sh5dot3t4e4her4tern3ughter9house3v4e5ry4ic5sh4onic3w3y2eaze5iness5y3d4ge6hammer3ek4p5iness5less5walk6ear5y6head4t5y4ve6less3igh3nder7ize3pt3uth3w2ice4k3d4e5ll5show3ght3m4e4y3ng5shot4k5y3p4cover4knot4page5eriness7y4shod3t4her7y3ver2oan5e3b3cum3e3g4an3op3p4e4piness5y3sh3t4h5ful3uch6y4gh3vak6ia8n4en6ia8n6liness3w4down4poke2r2udge3e3g4gard5ish3ice3m4ber7ous5rous4dog4lord4p3ng4k3r4p5ee3sh5y3t4tish2y1m2ack3ll5ish5pox3rmy4t5en5phone5watch3sh3ttering2ear3ll5y4t3tana2idge6n6on5in3le5y3rch4k4noff3t4e4h5ereens5son8ian5y4ten2ock3g4gy3ke5house5less5stack5y4iness4y3lder4ensk4lett3och4th6ie6y3te4her3ulder2udge5y3g4gle3rf3t4ty2örgåsbord1n2ack3ffle4u3g3il3ke5bite4y3p4dragon4pish5le5y4shot3re4f4k5y4l3tch3zzy2ead4k5y3er4ze3ll2icker3de3ff5le4ter3gger3p4e4pet5y3t4ch3vel2ob4bery5ish5y3oker4p5y4t5iness5y4ze3re4kel4t3t4ty3ut3w4ball5elt5lower5oard6und4drift6op4fall5lake4man5en5obile4plow4shed6oe5torm5uit4y2ub3ck3ff5box5le3g4gle2yder1o2ak3p4box4iness4stone5uds4y3r3ve2b3riety5quet2castee3cer3iability6le7y5l6ism8t9ic7te7zation8e4etal6y4oeconomic5logical9st8y5path3k4et3orro3rates6ic2da3den4y3ium3om5ite5y2fa3ia3t4ball4en4hearted4ie4ware5ood4y2gginess4y2ho2il3rée2journ2l3ace4r5ia6um3dier3e4cism4mn6ity7ze4noid3i4cit7ation7or8us7ude4darity5ification7y6ty4loquize8y4taire6ry5ude3o4ist4mon4n3stice3ubility5le4tion3vable4e5ncy6t3zhenitsyn2mali6a7n3ber4re6ro3e4body4day4how4one4place4rsault4thing5ime4way5hat6ere3me3nambulism;t4olence8t3oza2n3ar4ta3dheim4ra3g4bird4hai5ua4ster4writer3ia4c3ja3net4y3ority5ous3tag3y4a2on3t4h5e5sayer4y2p3hia5e5sm6t7icate;ion7ry4oclean8s5more8ic3orific3py3rano3with2rbet4onne3cerer7ss6y3did3e4head3ghum3ority3rel4ow6ful4y3t4a4ie2sa2t3o3tish2u'wester3briquet3fflé3gh5t3l4ful4less4mate3nd5less5proof5track3p4hanouvong4y4çon3r4ce6forge4dough4puss3sa4e3th5ampton5bound5east9erly;n9ward6rly7n8most6y5paw5ward6est9ern9ward3venir2vereign9ty3iet2w3eto3n2x2y3a3bean3inka3uz1pa3atz3ce5craft5flight5man6en5ship6uit5walk5y4ial5ous4kle4y3de5ful5work3ghetti3hn3in3ke3m3n4dex4gle4iard5el5sh4k3r4e5ribs4k5le4row4se5ity4ta6cus6n7burg3sm5odic9ally4tic3t4e4ial4ula3wn3y2eak5easy4r5head5mint3c4ial7ist8zation9e7ty5e5fiable7c8ally9tion6y5men5ous4k5le4tacle7ular6tor5er5ra7l6oscope;ic;y6um4ulate8ion9ve8or3d3ech6less4d5boat5ometer5ster5up5way5y4r3ll5bind6ound5check4t4unker3nce6rian4d5thrift4gler8ian4ser7ian4t3rm5atozoa:on5icide4ry3w2here5ical5oid8al3incter5ges5x2ica4e4iness4y3der6y3el5berg3ffy3got3ke4y3ll5age6ne5way4t3n4ach5l4dle6y4e5less5t4naker4off5za4ster8hood4x4y3raea5l4e5a4it6less6ual9ism;t<ic:ty7ous4o5graph3t4ball4e5ful4fire4sbergen4tle5oon4z2lash6down6y4t4y3een4ndid6or5etic3ice4ne5t4t3odge4tch7y3urge4tter2ock3il5age5sport5t3kane4e5n5sman7en6people8rson6woman9en3liation3nge5y4sor7ship4taneity8ous3of4k5y4l4n5bill5erism5ful5sful4r3radic8ally4e4ran4t5ive5scast6man9like9ship7en6wear7oman9en5y3t4less5ight4tiness5y3use4t2rain4ng4t4wl4y3ead6sheet4e3ig5htliness8y4ng6board6dale6field6iness6steen6time6y5kle5t4te5z3ocket4ut3uce4ng3y2ud3me4one6i3n4k5y3r4ious4n4t3tnik4ter4um2y3glass3ware1q2l3ite2uab5ble4d5ron4lid5l5or4nder5to4re4sh6y4t4w5k3eak6y5l5mish4egee5ze4lch3ibb4d4ggle7y4nt4re5m6y5rel5t4sh6y1r2inagar3racha3vijaya2o1s2a2t1t2ab4ility7zation8e4le3ccati7o4ey4i5e4k4y3dia5um3el3ff5ord3g4e5coach5hand4flation4nant6te7ion3id4n5less4r5case5master5way6ell3ke5out3lactite5gmite4e5mate4in6grad6ist4k4l5ion5one4wart3men4ford4ina4mer4p5ede3n4ce5h6ion4dard8ization:e5by5ish5off8ish6ut5point5still4ford4islavsky4k4ley4ton4za3ph5ylococci<us4le3r4board5ucks4ch6y4dom4e4fish4gazer4k5ey4less6t5ight6ng6t4r5y4t5le5up4vation5e3sh3t4e5hood7use5less6iness5n5room5side6man9like9ship7en5wide4ic6ally5on7ary7ery5stic9al9ian4uary5e6sque6tte5re5s5te6ory3ubach4nch5ton3ve3y2dio2ead5fast5icam6ness5y4k5house4l5th7y4m5boat5roll5ship5y3ed4l5e5y4p5le7chase7jack4r5age3fan6ie3in5beck5em5metz5way3lla6r3m3nch5il4dhal4gel4ographer:ic:y4t5orian3p4brother4child9ren4dad6ughter4father4han7ie5en7son4ladder4mom6ther4parent5e5ingstone4sister5on3reo6phonic6scope6type9ical4ile6ity7zation8e4ling4n5a5e5o5um4oid3thoscope4son3uben7ville3ve5dore5n6son4ie3w4ard7ess7ship6t2ick5iness5leback7r5pin5up5y3eglitz3ff5en4le3gma6ta7ize3le5tto4l5birth6orn4t5on3mson4ulant7te8ion6i6us3ne4giness5ray5y4k4t3pend4ple4ulate8ion3r4ling4rup3tch2oat3chastic4k5ade5broker5hausen6older8m5iness5pile5room5ton5y6ard3dginess5y3ic5al5ism3ke3l4e5n4ichnaya5d6ity4ypin3mach7ache4p3ne5henge5wall7re6ork5y4y3od4ge4l4p3p4cock4gap4light4over4pable6ge6rd4watch3rage4e5front5house5keeper5room5y4k4m5iness5y4y5book5teller3ut3ve5pipe3w4away4e2rabo4ddle5ivarius4fe4ggle7y4ight8away8edge9n8forward8jacket5n5t6en6jacket4nd5ge6le8hold6ulate:ion4p5less4sbourg4ta6gem5egic9ally8st7y5ification7y5osphere5um4uss4vinsky4w5berry4y3eak6y5m6line4et6car6light6walker7ise4isand4ngth8en5uous4p5tococcal;i;us7mycin4ss6ful4tch7y4w5n3iated4cken6land5t6ure4dden5e6nt4fe4ke6out4ndberg5g6ency8t6y4p5e5ling5t6ease4ve6n3obe4de4ke4ll4mboli4ng6box6hold5tium4p5he4ve3uck5tural:ist8e4del4ggle4m5pet4ng4t3ychnine2u3art3b4ble6y5orn5y3cco4k3debaker5nt7ship4io6us4y3ff5iness5y3ltification7y3mble4p5y3n4g4k4t3pefaction6y5ndous4id6ity4or3rdiness5y4geon3tter5gart3yvesant2y3e3gian3le4i5sh6t7ic9ally5ze4us3mie4ying3ptic3rofoam5n3x1uarez3ve4ity2b3aru4tomic3basement3class4ommittee6pact5nscious6tinent7ract;or4ulture5taneous3divide7sion4ue3group3head4uman3j4ect7ion8ve9ity4oin4ugate8ion5nctive3lease5t4imate8ion6e6inal7ty3marine4erge8nce6se7ible8on4ission8ve5t3normal3orbital5dinate:ion5n6ation3plot4oena4rime5ogram3routine3scribe7pt9ion4ection5quent5rvience:t5t4ide7nce6iary7zation8e6y5st7ence4oil5nic4pace4tance7dard7tial:te;ion9ve6tion5itute9ion5rata8e8um6ucture4ume4ystem3teen5rfuge6ranean4itle4le6ty5y4otal4ract8ion6hend5opical3urb6an8ite6ia3version8ve6t3way2cceed5ss7ful7ion8ve7or4inct4or5tash4ulence8t5mb3h4like3k4le3re5ts4ose3tion2dan5ese3den3etenland3oku3ra3s4y2e3de3t4onius3z2ffer6ance4ice6iency9t5x4ocate8ion5lk4ragan7e8tte7ist4use6ion3i4sm2gar5cane6oat5less5y3gest7ible8on8ve2harto2i3cidal6e3t4ability6le7y4case4e4or2karno3iyaki3kot6h2lawesi3eiman3fate4ide4ur6ic6ous3k4iness4y3la4en4ivan4y3phur7ous3tan6a7te4ry2m3ac5h4tra3eria7n3marize6y5tion4erhouse6time6y4it6ry4on3ner3o3p4tuous3ter2n3bathe4eam5lt4lock4onnet4urn7t3dae5nese5s5y4er4ial4own4ry3fish4lower3g4lasses3k4en4ist3lamp4ess4ight5t3ni4y5vale3rise4oof3screen4et4hine4pot4troke3tan3up2p3erabundance<t6nnuate5b6owl5charge6ilious6omputer7nductivity<or5ego5ficial;ity6luity8ous6und5glue5highway6uman5impose6ntend;ence>y=t6or8ity5lative5man7rket6en6odel5natural6ova9e6umerary5power5script6ede6ize6onic6preader6tar7ition;us7ructure5tanker5user5vene6ise8ion8or:y3ine3plant5e6mental;ry5iant6cant8te9ion5y4ort7able7ive5se6ition8ory4ress8ion4urate8ion3ranational4emacist8y6e2rabaya4t3cease4harge3e4fire5ooted4ty3f4ace4board4eit3ge5on5ry4ical3inam7e3liness4y3mise4ount8able3name3pass4lice5us4rise3real7ism9t:ic5nder5ptitious5y4ogate5und3tax3veillance5y6or4ival6e6or3ya2san5a5na6e3ceptibility9le3e3hi3ie3pect5nd6se8ful7ion4icion8us3quehanna3sex3tain7able4enance2therland3ton3ure2v3a2wanee2zanne3ette3hou3uki3y1valbard2elte3n4gali2n1w2ab3ddle3g3hili3in3llow7tail3m4i4merdam4p5y3n4ee4k5y4sea5on3p3rd4m4thy3sh5buckler:ing4tika3t4ch4h5e3y4backed3zi5land2ear5word4t5pants5shirt7op5y3de5n6borg4ish3eney4p5stake4t5bread7iar8er5en5heart5ie6sh5meat3ll5head4ter3pt3rve2ift3g3ll3m4suit3nburne4dle4e4ish3pe3rl5y3sh4s5air3tch6able6back7lade7oard4zerland3vel3zzle2ollen3on4p3p3rd5fish5play5sman7en4e4n2um3ng1ybarite7ic3il2camore3ophant9ic2dney2kes2llabi7c8ation7fication8y6le6us4ogism8tic3ph3van4ester4ia5e2mbioses7is6tic4ol6ic8ally7sm7zation8e3metric9al7y3pathetic;ally7ize7y4honic7y4osia7um4tom7atic2nagog7ue4pse3c4h5ronization:e8ous4opate8ion3dicate8ion4rome3ergism8tic6y3ge3od4nym7ous4pses6is3tactic9al5x4heses7is8ze6tic9ally2philis7tic4on2racuse3ia5c5n4nge3up5y2sadmin3op3tem6atic:ally9ze6ic4olic1zechuan2ilard2ymborska1èvres1éance0t1'ang1a2b3asco4tha3by3ernacle3itha3le5au7x5cloth5land5spoon:ful:sful5t5ware4oid3oo3riz3u4lar6te7ion7or2chometer3it5urn8ity6s3k4iness4le4y3o4ma3t4ful4ic6al6ian5le4less2dpole3zhik7istan2egu3jon2ffeta4y3t2g3alog3ore3us2hiti6an3oe2ichung3l4coat4gate4less5ight4or4pipe4spin4wind3ne4t3pei4ing3wan6ese3yuan2jikistan2ke4aways4n4off5ut5ver3lamakan2lbot3c3e4nt3iban4esin4sman3k4ative3l4ahassee4chief4ey6rand4inn4ow4y5ho3mud6ic3on2m3able4le4ra5ind3bourine3e4able4ka4ra5lane3i4ka4l3many4i5e4uz4y3p4a5x4on3ra3worth2n3ager3cred3dem3ey3g4anyika4elo5nt7ial5rine4ibility6le7y4le4o4shan4y3ia4sha3k4ard4ful3nery4häuser4in3sy3talize6us5mount4rum3ya3zania8n2o3ism5t2p3e4stry4worm3ioca4r3room6t2r3a4ntino6ula9e4wa4zed3ball4ell3diness4y3e3get3iff4m3kenton4ington3mac6ked7ing3nish3o4t3p4aulin4on3ragon4y3t4an5r6y4uffe3zan2ser3ha4kent3k4master3man6ia8n3s4el3te5ful5less4iness4y2t3ar3e3tle6tale4oo6ist4y3um2ught3nt3pe3rus3t4ological8y2vares3ern2wdriness5y3ney4y2x3able4tion3i4cab4dermist8y3onomic7y3payer3ying2ylor1b2a2ilisi2sp1c2haikovsky1d1ea3bag3ch5able4up3k4ettle3l4ight3m4mate4ster4work3pot3r4drop4ful4gas7ses4jerker4oom4y3sdale4e5l4poon8ful8sful3t4ime3zel4le2ch4nical9ity7ian7olor6que5o6cracy9t6logical:st9y3tonics3umseh2d3dy3ious4um2e3m3n4age4sy4y3pee3ter4h5e4otal2flon2gucigalpa2heran3ran2l3ecast5ommunication9te6nference4gram7ph9ic9y4kinesis4machus6nn6rketing5eter7ry4pathic:ally8y5hone8ic8y7to5rompter4scope8ic4thon5ype8writer4vangelist5ise7ion4x3l4tale3net3ugu2mblor3ecula4rity3p4e5ra7mental7nce7te8ure5stuous4i4lar6te5e4o5ral7ry6ize4t5ation5ress4ura2n3ability5le4cious6ty4ncy5t3dency6tious5rfeet7oot6hearted6ize6loin4initis4on6itis4ril3ement4t3fold3nessee4is4yson3ochtitlan4n4r3pin3se4ile5on4or6flow3t4acle5tive4h3uous4re2otihuacan2pee3id2quila2rabit5yte3centenary3ence4sa5hkova3i3kel3m4agant4inable7l7te8ion8or6i6ological:y6us5te3n3psichore3r4a5ce5in5n6ce5pin5ria7um4ell5nce5strial4i5ble7y5e5fic8ally6y5torial8y4or6ism8t7ze4y3se3tiary2sla3s4a4ie3t4able5ment9ary5te4icle5fy5monial8y5ness5s4osterone4y2t3anus3her4ys3ons3rahedra9on2utonic2vet2x3aco4n4rkana4s3t4book4ile4ual5ral6e1h2ackeray3d4deus3i4land3lami6us4es4ia4lium3mes3n4h4k5ful5less5sgiving4t3r4p3t4ch3w2e3a4ter5re6ical3bes3e3ft3iler4r4sm5t6ic3lma3m4atic8ally4e4istocles4selves3n4ce6forth9ward3ocracy7tic6itus4dora7e7ic6sius4logian8cal7y4rem6tic9al9ian5ist6ze5y4sophy3rapeutic;ally6ist6y5vada4e5about6fter5by5fore6rom5in5of6n5sa6e5to5upon5with4mal5ionic5odynamic6meter6nuclear6plastic7ylae6s7tat:ic4on3sauri7us4e5us4is4pian6s4salonian9íki7y3ta3y4'd5ll5re5ve2iamin7e3ck5en6t5set3ef4u4ve6ry5ish3gh5bone3mble7ful5u3n4e4gamajig4k3rd4st6y4teen8th5ieth5y3s4tle7down3ther2o3mas4ism6tic4pson4son3ng3r4aces6ic5x5zine4eau4ium4n5ton5y4ough8bred8fare8going4pe3se3th3u4gh6t7ful7less4sand8th2race5ian4ldom5l6dom4sh3ead6bare5t6en4e5fold5score6ome4nody4sh6old4w3ice4ft6iness6y4ll4ve6n3oat6iness6y4b4e4mboses8is4ne5g4ttle4ugh7out7put7way4ve4w5away5back5n3u4m4sh5t4way2ucydides3d3g3le3mb5nail5screw5tack4p3nder7bird8olt7clap9oud7head7ous7shower8torm9ruck4k3r4ber4man5ond4sday3s3tmose2wack4rt2y3me4i4us3roid3self1i2a3njin3ra2ber5ius4t5an3ia5e2c3k4et6master4le5ish3onderoga2dal3bit3dlywinks3e4water3iness3y2e3breaker3nanmen4tsin2ff4any2ger3ht5en5fisted5rope5wad3ress4is2juana2ke2lde3e3l4able5ge4ich4man3sit3t2m3ber6land7ine4re4uktu3e4keeper4less5ine4piece4scale5tamp4table4worn4x4zone3id5ity3my3on4r5ous4thy3pani7st3ur5id2n3a3cture3der6box3e3foil3g4e4le3ker6bell6toy4le3ny3sel6town4mith3t4innabulation4oretto3y2p3i3pecanoe5rary4le3ster4y3toe5p2rade4na3e4less4sias5ome3o2sha4ri3sue2t3an5ia6c6um3bit3he3ian4caca4llate8ion3le3mice4ouse3o3tle3ular4s5ville2zzy1ko1l2aloc2c2ingit1m1n2t1o2ad4stool4y3st5master5y2bacco7nist4go3oggan3y2cantins3queville3sin2day3dle4y2e3fl3hold3nail2ffee4y3u2g3a4e3ether3gle3o2il4et6ry6te4some2jo2kay3e4n5ism3ugawa3yo2ld3edo4rable8y6nce7t6te7ion3kien3l4booth4gate3stoy3tec3yatti2m3ahawk4s4to3b4augh4oy4stone3cat3e3foolery3lin3mie4y3orrow3pkins3sk2n3al5ity3e4less3g4a5n4ue3i4a4c4ght3nage4e3sil6lectomy7itis4orial4ure3to3y4a2o3k3l4bar5ox4kit3t4h5ache5brush5less5paste6ick5some5y2p3az3coat3eka3ic5al3knot3less3mast4ost3ographer9ic;al9y4logical7y3ple3sail4ide4oil4y2que2r3ah3ch5light3e4ador3mentor3n4ado3onto3pedo4id6ity4or3que6mada3rance4ens6t7ial5s4icelli5d3si5on4o3t4e4illa4oise8shell5la4uga5ous5re3us3valds3y2sca5nini3hiba3s4up3t2t3al5itarian<ism7y3e4m5ic3o2ucan4h5down5stone5y5é3gh5en3louse3pee3r4ism6t7ic4maline4nament5ey5iquet3sle3t2w3ard3el3head3n4house4send5folk5hip5man6en5people3path2xemia3ic5ity5ologist9y4n2y3nbee3oda4ta1race5able5ry5y4hea7e6otomy4i5e4k4t5able5ion5or4y3de5mark5sman7en4ition9al;ist4uce3falgar4fic7ked9r8ing3gedian6y4ic6ally6omedy3il5blazer5ways4n5ee4pse4t5or7ous3jan4ectory3m4mel4p5le5oline3n4ce4quil8ity9ze8lity:ze4sact8ion6tlantic5caucasia6eiver7nd9ence;t<al>ism@t6ontinental6ribe8pt:ion5ducer5ept5fer8able9l8ence6iguration:e7nite7x8t6orm9ation6use8ion5gress:ion:or5ience9y8t6stor6t7ion:al8ve7ory5late8ion8or6iterate<ion6ucence:t5migrate;ion7ssible:on7t8table:l6utation8e5national5oceanic6m5parency:t6hobia:c6iration8e6lant:ation6onder7rt9able:tion7se8ition5sexual6hip5ubstantiation5vaal6erse7stism:te5ylvania3p4door4eze6oid9al4pable5ist4shooting3sh5can5y3uma6ta7ic8ze3vail4el6og8ue5rse5sty4is4olta3wl3y2eacherous8y5le4d5le5mill4s5on7able7ous5ure7y4t5able5ise5y3ble5inka3e4less4top3foil3k4kie3llis3mble4endous4olo5r4ulous3nch6ant4d5y4t5on3pidation3spass4s4tle3velyan4ino4or3y2iad4ge4l4ngle6ular9tion8um4ssic4thlon3bal6ism4e5sman7en4ulation5nal6e5tary6e3ce5ps5ratops4ia4k5ery5iness5le5ster5y4olor4ycle3dent3ennial4ste3fecta4le4ocals3g4lyceride4onometric;y3ke3lateral4l5ion8th4ogy3m4aran4ester4urti3na4idad5ty4ket3o3p4artite4e4itaka4le6t5icate4od5li5s4pe4tych3sect4ha4tan3te4on3umph7al8nt5virate3vet4ia6l7ity8ze2obriand3chee3d4den3glodyte3ika4lus3jan3ll5ey5op7e5y3mbone7ist4p3n4dheim3op5ship3pe4hy4ic6al7na5sm4osphere3t4h4sky3ubadour5le7maker7shoot:t8ome4gh4nce4pe4ser5seau9x4t3wel3y2uancy5t3ce4k5ee5le6oad4ulence8t3deau4ge4y3e3ffaut5le3ism3jillo3ly3man4bull4p5ery6t3ncate7ion5heon4dle4k3ss4t5ee7ship5ful5worthiness:y5y3th5ful5iness2y3out3st1s2ar4ina2imshian3ngtao3olkovsky3tsihar2ongkhapa2p2unami2wana1tys1uamotu3reg2b3a3by3e4less4rcle6ular8osis9us5ous3man3ular2ck3son3uman2dor2es4day2ft2g3boat2ition2lane3ip3l4e3sa4idas2mble6down6weed4rel5il3id3my3or3s3ult6uous2n3a3dra3e4ful4less3gsten4us6ka3ic4s5ia7n3nel5y4y2pi3perware3ungato2rban4id5ne4ojet5prop5t4ulence8t3d4ucken3een3f3genev4id6ity3in5g3k4estan5y4ish4menistan3lock3meric4oil3n4about5round4coat4ip4key4off5ut5ver4pike4stile4table3pentine4in5tude3quoise3ret3tle6dove6neck3ves2scaloosa5n6y5rora4on3h3k4egee3saud4le4ock2t3ankhamen3elage3or5ial3si3u2valu2x3edo1v2a1wa3ddle3in3ng2eak3e4dledee8um5y4t4zers3lfth4ve3ntieth5y3rk4p2ice3ddle3g4gy3la4ight4l3n4e4ge4k5ies5le3rl3st3t4ch3zzlers2o3fer4old3some1x1y2cho3oon2ke2lenol4r2mpana6um2ndale6l2pe4cast4face4script5et4write8ten6ote3hoid5on4us3ical4fy4st3o4grapher9ic;al9y2rannical7ze6osaur;us7us6y5t3e4e3o4ne2son1zar4ina0u1aw1bangi2iquitous7y2s2untu1cayali2cello2la1dall2der1fa2o1ganda6n2h2liness3y1h2f1ighur1jungpandang1k2elele2raine6ian2ulele1lcer5ate7ion5ous2na4e2ster2terior3imata7e7um3ra5conservative5marine5sonic:ally7und6uede5violet2ulate2yanovsk3sses1m2bel4r3ilical7i7us3rage4ella4iel2iak2laut2p3ire3teen7th1n2abashed5ted4le4ridged3ccented6ptability:le;y8ed5ompanied6untable<y5ustomed4knowledged4quainted3dorned4ulterated4vised3ffected4raid3ided3lterable:y7ed3mbiguous3nimity6ous4nounced4swerable8ed4ticipated3ppealing6tizing5reciated;ive6oachable3rmed3shamed4ked4sailable5igned6sted5uming3ttached6inable5ended5ractive6ibuted3uthenticated6orized3vailable7ing4oidable:y3ware2balanced4r3earable9y5table6en4coming4known9st4lief7vable;y8er4nd5t3iased6sed4dden4nd3lock4ushing3olt4rn4som4und3randed4eakable4idled4oken3uckle4rden4tton2called4nny4ring4sed4talogued3easing4nsored4remonious5tain9ty3hallenged5nged7ing5racteristic@ally6itable;y6ted4ecked4ristian3ivil7ized3laimed5sp6sified4e5an6r4othe4uttered3oil4llected4mfortable<y5mitted6on6unicative5plaining7eted7icated8mentary6rehending8ssed7omising4ncern5ditional5firmed5nected5querable5scionable=y9us6idered6titutional5taminated6ested6rollable=y:ed8versial5ventional6inced9ing4oked5perative5rdinated4rk5related6oborated4untable7ed5ple5th4ver3ritical3tion4uous3ultivated6ured4t2damaged4ted4unted3eceive5idable7ed6pherable5lared4feated6nded5inable7ed4livered4manding5ocratic6nstrative4niable9y4pendable4r5achieve7t6ge6rm5belly6id6rush5carriage6harge6lass:man;en7othes:ing6oat7ver6urrent7t5developed6og7ne5employed6stimate6xpose5fed7ed6low6oot6unded5garment6o7ne6rad9uate7ound8wth5hand5lain7y6ie7ne8g6ying5mine6ost5neath6ourished5paid7nts7ss7y6in6lay6rivileged5rate5score6ea7cretary7ll6hirt7oot8rts8t6ide7gn7ze6kirt6old6taffed8nd:able=y8te7ood7udy5take9n6one7ok7w5used5value5water6ear7ight7nt6ood7rld6rite9ten7ote4served8ing5irability9le4tectable8ed6rmined7red4veloped3id4es4gnified4luted4minished4sciplined6losed6overed6riminating5guised5puted5tinguished6urbed4vided3o4cumented4ne4ubted3ress3ue4lant6te7ion5y3ying2earned5th4se5iness5y4ten3conomic:al3dited4ucated3mbarrassed4otional4ployable8ed8ment3nding5urable4forceable4lightened4thusiastic4viable3qual5ivocal3rring3sco3thical3ven6tful3xampled4ceptionable<l5iting4pected5lained6ored5urgated2failing5r5thful4miliar:ity4shionable5ten4thomable4vorable:y3easible4eling4igned4tter3illed4nished4t3lagging5ppable5ttering4inching3old4reseeable9n5gettable<y6ivable8ing5med5tunate4unded3requented4iend8liness4ock3ulfilled4nny4rl5nished2gainliness7y4va3entlemanly3odly4vernable3racious5mmatical5teful4udging3uarded4ent4late2hand4ppiness6y4rmed3ealthful8y5rd4eded4lpful4sitating3indered5ge4tch3oly4ok4rse3urried5t2icameral4ef4ode5rn4ycle3dentifiable:ed4irectional3fication4orm7ity4y3lateral4ever3maginable9tive4paired5eachable5lementable;ed5ortant5ressed9ive3nformative8ed4habitable9ed5ibited4itialized8ted4jured4spired8ing5tall9able5ured4telligent:ible=y6nded7tional6rested:ing7preted7rupted4vited7ing3on5ization7e5town3que3royal3sex4on3t4arian9ism6y5s4e4y3versal9ity7e7ity3x2just6ifiable9ed2kempt3ind3nowable6ing6n2labeled4ce4tch4wful3eaded5rn5sh5vened4ss4ttered3icensed4ke6lihood4mited4sted3oad4ck4ose4ved3ucky2made4ke4n5ageable5nerly4rked5ried4sk4tched3emorable4ntionable4rciful3indful4ssed5takable;y4tigated3odified4ral4ved2named4tural3ecessary4eded4rve3oticeable8d3umbered2objectionable4servant8ed5tructed4tainable5rusive3ccupied3ffensive5icial3pened4posed3rganized4iginal4thodox2pack4id5nted4latable4ralleled5donable4triotic4ved3erturbed3ick4n3lanned4easant4ug5mbed3olluted4pular9ity3recedented5dictability;le5judiced5meditated5pared5tentious5ventable4incipled6table5vileged4oductive5fessional6itable5mising6pted5nounceable5tected5ved7n6oked3ublished4nished2qualified4enchable5stionable=y:ed:ing4ote2ravel3eachable5d6able6y5l6istic;ally7zed5sonable;y8ing4cognizable:ed6nstructed6rded4fined4generate5istered5ulated4hearsed4lated5eased6nting5iability8le6eved4markable5itting4peatable6ntant5resentative4quited4served5olved5ponsive5t6rained7icted4warding3ipe4valed7led3oll4mantic3uffled4liness5y2saddle4fe4id4lted4nctioned5itary4tisfactory8ied8ying5urated4vory4y3cathed4heduled5ooled4ientific4ramble5ew5upulous3eal5sonable;y8ed5t4eing5mliness7y5n4lfish4nt6imental4t5tle3hakable6eable5ven4eathe3ightliness8y5ned3killed7ful3miling3nap5rl3ociable4ld5icited5ved4phisticated4und3paring4eakable:y5cific9ed4oiled7t5ken5rtsmanlike3table5ted4eadiness7y4op6pable4ressed5uctured6ng4uck5died3ubscribe6tantial<ted5tle4ccessful4itable9y6ed4ng4pervised5portable9ed4re5passed6rising4spected9ing3weetened5rving3ympathetic2tainted4med4ngle4pped4ught3enable4sted3hinkable7ing3idiness5y4e4l4meliness7y4ring4tled3o4ld4uchable7ed4ward3rained4eated4ied4oubled4ue5stworthy5th7ful3utored3wist3ying2ukalhai3sable4ed4ual3tterable:y2varnished5ying3eil4rified3oiced2wanted4riness5ranted5y4shed4vering3ed4lcome5l3holesome3ieldiness7y4lling4nd4se4tting3onted4rkable5ldly5thiness7y4und3rap4itten2yielding2zip1p2anishads2beat3raid4inging2c3huck3oming4untry2date3ike3raft2end2front2grade2heaval4ld3ill3old5ster9y2i2john2keep2land3ift3oad2market2on2percase6lassman;en6ut5most3ity2raise3ight4sing3oar6ious4ot2scale3et3hot3ide3tage5irs5nding5rt5te4ream3urge3wing2take3ight3on4wn3urn2ward1r2al3nia5um4us2ban5e5ity6zation7e2chin2du2ea3thra7e3y2ge4ncy5t2iah3c3el3nal6yses8is5ry5te6ion4e3s2l2n2ologist6y2quhart2sa3ula5ine2uguay7an3mqi1s2a3bility4le3f3ge2b2da2e3ability5le3ful3less3net3rname2her5ette2mc2n2o2sr2tinov2ual3rer4ious4p5ation4y1t2ah2c2e3nsil3ri5ne4us2ica3litarian;ism6y5zation6e2most2opia6n2recht3illo2terance5most1v2ula5e5r1zbek5istan2i0v1a2cancy5t4te5ion4ville3cinate8ion6e3illate8ion3ua4ity4ous4um2der3uz2gabond4ry3ina6e6l3rancy6t3ue2in4glorious8y2l3ance4rie3dez4osta3e4dictorian:y4nce6ia5ti7n8e8o5zuela4ria7n6e4t3halla3iant4d5ate7ion5ity4se4um3kyrie3lejo5tta5y3ois4r5ous3paraiso3uable5tion4e5less3ve4oline3éry2moose3p4ire2n3adium3ce4ouver3dal6ism7ze4erbilt4yke3e4ssa3g4uard3illa4sh4ty3quish3tage3uatu3zetti2pe3id5ity3or5ization7e5ous5ware2r3anasi3ese3gas3iability6le7y5nce6t5te6ion4colored6se4egate5ty4ous3let3mint3nish3sity3y2scular3e4ctomy4line3quez3sal6age5r3t2t3ican2uban3deville3ghan5n3lt3nt2x2zquez1ba1cr1d2t1eal2blen2ctor2da4nta2ep3r2ga4n3emite4table6rian:ism6te7ion8ve3gie2hemence7t3icle5ular2il3n2la3cro3d4t3ez3lum3ma3ocity4ur3veeta5t6een6y3ásquez4zquez2nal5ity3d4etta4or3eer4rable6te7ion5eal4tian4zuela9n3geance5ful3ial4ce4son3n3om5ous4us3t4ilate8ion8or4olin4ral5icle7ular6loquism<t4ure7some6ous3ue4s5ian2ra4cious6ty5ruz4nda7h3b4al6ize5tim4ena4iage4ose6ity3dant4e4i5ct5gris4un5re3ge4il3ifiable6cation5y4similitude4table8y5y4zon3laine3meer4icelli5lion6lion5n6ous4ont5uth3n4a5cular5l4e4on3ona5ese5ica3sailles5tile8ity4e4ification6y5on4us3tebra8e8l8te5x4ical6es5ginous6o3ve3y2salius3icle3pasian4er4ucci3sel3t4a4ibule5ge6ial4ry3uvius2t3ch3eran5inarian9y3o2x3ation7us1hf2s1i2a3bility4le3com3duct3gra3l3nd2be3rancy6t5phone5te6ion6o7r3urnum2c3ar5age5ious3e4nte4roy3hy5ssoise3inity4ous4ssitude3ki5e4sburg4y3tim6ization8e4or6ia8n7ous6ville6y4rola4ual3uña2dal3eo5cassette5disc5tape6ex2e3nna5ese4tiane3tcong4minh4nam7ese3w4finder4point2gil5ance7t8e8ism3nette3or5ous2i3i2jayanagar6wada2king2la3e3ification5y3la5ge5in7ous7y5rreal4ein4on3ma3nius3yui2m2naigrette3ce5nt3demiatrix4icate8ion8or6tive3e4gar7y4land4yard3son3tage4ner3yl2ol4a5ble5te6ion6or4ence6t5t4in6ist5st4oncello2p2rago4l3eo3gie5l5n6al6ia8n7ty4o4ule3ile5ity3ology3tual5e5osi8ty7o6us3ulence7t4s2sa4ge4khapatnam4lia4yans3cera7l4id4osity5unt8ess6s4us3e3hnu3ibility5le6y4goth4on6ary4t5ation5or3or3ta4ula3ual6ization8e2tal5ity6ze4min3iate6ion4culture4m3o3reous4iol7ic3uperate9ion:ve4s2va4ce5ious6ty4ldi3ekananda3ian4d4enne4fy4parous4section2xen5ish2z3ier3or1j1lad4imir5vostok3minck3sic2f1ocabulary4l5ic6st6zation7e4tion8al6ve3iferate9ion7ous2dka2gue4ish2ice5less5mail3d3le3p2l3atile7ity3canic6o4ker3demort3e3ga4ograd3ition3kswagen3ley6ball3stead3t4a5ge5ic6re4meter3ubility5le6y4me5inous4ntary6eer4ptuary7ous3vo2mit2nda3negut2odoo6ism2racious6ty3onezh3ster3tex4ices2tary3e3ive2uch5safe2w3el2yage3eur6ism8tic1p1s1t2ol1uitton2lcan6ization8e3gar6ism7ty7zation8e5te3nerability8le9y3ture3va5e2vuzela1ying0w1a2bash3bit2c3k4iness4o4y3o2ddle3e3i2fer3fle3t2g3e3gish4le3ner6ian3on2hhabi2if3kiki3l3nscot3st5band5coat5line3t4e4ress3ve2ke4ful4n3sman2ld4emar5n6sian4heim4o5rf3e4sa3green3k4man4out4way3l4aby5ce4board4enstein5t5ye4flower4is4oon5p5w4paper3mart3nut3pole4urgisnacht3rus3sh3t4on4z2mpum2n3amaker3da4erlust3e3g4le3k4el3na5be7e3t4on2piti2r3ble3den4robe6om3e4house4z3fare3head4ol5rse3iness3like4ock5rd3m4hearted4onger4th3n3p4ath3rant7y4en4ior3saw4hip3t4hog4ime4y3wick3y2satch3h4able4basin5oard6wl4cloth4erwoman9en4ington:ian4out4room4stand4tub3n't3p4ish3sail4ermann3tage4e5basket5ful5land5paper5water4rel2tch5band5dog5ful5maker7n6en5tower5word3er5bed6oard6ury5color7urse6raft7ess5fall6ord7wl6ront5gate5line6ogged7o5mark6elon5power6roof5shed6ide6pout5tight6own5way6orks5y3kins3s4on6ville3t4age4eau4le3usi2ugh3sau2ve4form4length6t3iness3y2x3en3iness3wing4ork3y2y3farer6ing3laid5y3ne5sboro3side3ward1c1e2'd3ll3re3ve2ak4en4fish4ling3l4th6iness6y3n3pon6less6ry3r4able4iness5some4y3sel3ther7cock7ize7man8en7proof3ve2b3b3cam5st3ern3inar4sode3master4istress3site4ter2ddell3ge4ie4wood3lock3nesday2e3dy3k4day4end4night3nie3p4y3vil2ft2hrmacht2i3erstrass3gh5t6iness6less7ifter:ing6y3ll3nberg3r4do4ton3ss5muller3zmann2lch4ome3d4on3fare3kin3l4and4ington4spring3sh5man6en3t4erweight2n3atchee3ch3dell4i4y3t2pt2re4n't4wolf7ves2sak3ley6an3sex4on3t4bound4erly6n7ize7most4inghouse4minster4on4phalia4ward2t3back3land3ware2yden2zen1hack5y3le5bone3m4my3rf4ton4ves3t4chamacallit4ever4not4soever2eal4t5en5ies5stone3edle4l5barrow7se5chair5wright4ze5y3lk4p3n4ce4ever3re5abouts6s6t5by5fore5in5of6n5soever5upon5ver5withal3t4her4stone3w3y2ich5ever3ff3g3le4st3m4per4sey5ical9ity5y3ne4ny4y3p4cord4lash4persnapper6t5le5oorwill3r4l5igig5pool5wind4r3sk5ey5y4per4t5le3t4aker4e5cap5field7sh5hall6ead6orse5ley5n5wall7sh4field4her4ish4ley4man4ney4sunday4tier5le3z4z2o3'd4ll4re4ve3a3dunit6nit3ever3le5hearted5sale6ome4ly3m4ever4soever3op5ee4sh3pper5ing3re5house4l3se4oever2y1i2cca3hita3k4erwork5t2de4n4screen5pread3geon5t3ow5hood3th2eld3mar3ner3sel5nthal2fe3i2g3eon3gins4le5y3ht3ner3wag5m2i2ki4leaks4pedia2lberforce6t4ur6n3cox3d4a4cat4e5beest4fire5lower5owl4life3e4y3ford4red7o4ul3helm7ina3iness3kerson5s4ins7on3l4a5mette5rd4emstad4ful4iam7sburg8on8port5e5s4ow6y4power4y3ma4er4ington3son6ian3t4on2mbledon3p4le4y3sey2n3ce4h5ell6ster3dbag5reak5urn4ex4fall4hoek4iness4jammer4lass4mill4ow6pane6sill4pipe4screen5hield5ock6r5torm5urf5wept4up4ward4y3e4glass4ry4sap3fred6y3g4less4nut4span6read4tip3ifred3k4le3nebago4ie5peg4ow3o3some4ton3ter6green6ize6time6y4hrop4ry2pe2re4less4tap3iness3y2sconsin9ite3dom3e4acre4crack3h4bone4ful3p4y3t4aria4eria4ful2t3ch5craft5ery3h4al4draw8al8n6ew4held5old4in4out4stand6ood3less3t4genstein4icism5ness4y3watersrand2ve2z3ard6ry3ened3zes1k1m1obble5y3egon2dehouse2e3begone3ful2k3e4n2lf4e4f4gang4hound4ish4ram3longong4stonecraft3sey3verine5s2man5hood5ish6ze5kind5like7ness3b4at4le3en5folk2n3't3der6bra6ful6land4rous3g3ky3t2o3dard4bine4carving5huck5ock5raft5ut4en4hull4iness4land4man5en4pecker5ile4row4shed5man6en5tock5y4ward5ind5ork7m4y3f3l4en4f4gathering4ie5te4liness4ongong4worth3ster3ten3ziness4y2rcester9shire3d4iness4play5ress4sworth4y3e3k4able5day5holic5round4bench5ook4day4fare5low5orce4horse6use4ingman8en4load4man7like7ship5en4out4place4sheet6op5tation4week3ld5liness5wide3m4hole4wood4y3n3risome4y5wart3se5n4hip7ful4t3th5iness5less5while5y2t3an2uld5've5n't3nd2ve4n3oka2w2zniak3zeck1rack3ith3ngell5le3p4around4t3th5ful2eak4th6e3ck5age3n4ch3st5le3tch2iggle6y4ht4ley3ng4kle6y3st5band5watch3t4able4e4he4ten2oclaw3ng5doer7ing5ful5headed3te4h3ught2ung2y1t2o1u2han2rlitzer2ss1v1wi3i2w1y2att2cherley3liffe2eth2lie2nn2o3ming7ite2siwyg0x1amarin2nadu3thippe2vier1ci3i3v3x2vi4i1e2macs2nakis3ia3on4phobia9c7n2rographic9y4x3xes1hosa1i2'an2aoping2i3i2menes2ngu2ongnu2v2x1l1mas2l1ochipilli2r1ref1s1term1uzhou1v2i3i4i1x2i3i4i3v3x2v3i4i5i2x3i4i5i4v4x3v4i5i6i1ylem3ophone8ist0y1'all1acc3ht5sman7en3k2hoo3tzee3weh2k3ima3ut5sk2le3ow3ta3u2m3agata4ha3oussoukro2ng4on4tze3k4ee2obang3unde2p2qui2rd4age5rm4stick3mulke3n3oslavl2taro3es2uco2w3l3n1b1d1e2a3ger3h3r4book4ling4n3st5y3ts2katerinburg2ll4ow6ish6knife6stone3p3tsin2men5i2n3isei2oman4en2p2revan3kes2senia3hiva7h6ot8h3t4erday6year2t3i2vtushenko2w1ggdrasil1iddish2eld2p3pee1mca2ha2ir2mv1o2ck2da3el2ga3hourt4urt3i4n3urt2ke4l3napatawpha3o4hama2landa3k2n3der3g3kers2re3k4ie4shire4town3uba2semite3sarian2u3'd4ll4re4ve3ng5ish5ster7own3r4self7ves3th5ful4ube2wl1pres2silanti1r1ttrium1uan2catan3ca3k4y2go4slav8ia:n2k3on2le4tide2m3a3my2nnan2p3pie4y2ri1ves3tte2onne1wca2ha0z1achariah6y4ery2greb2ire4ian2mbezi4ia6n4oni3enhof3ora2ne3iness3uck3y3zibar2p3ata3orozhye4tec3pa2ra1eal4and4ot5us2bedee3ra3u2chariah2d3ekiah3ong2ffirelli2ke2lig3ma2n3ger3ith3o2phaniah4yr6hills6us3pelin2ro4th2st4ful2ta2us1hengzhou2ivago2ukov1ibo2egfeld4ler2ggy3zag2lch3lion2mbabwe8an3merman2nc4ked5ing3fandel3g3nia2on4ism6t2p3loc3py2rcon6ium2t3her1n1odiac6al2e2la3lverein3oft2mba4i5e2nal3e3ked2o3logical7st6y3m2rch3n3oaster7rian;ism3ro2sma1r1sigmondy1ubenelgenubi6schamali2cchini2kor2lu2ni1wieback3ngli2orykin1ygote2rtec2uganov1ürich0ångström0éclair4t1lan1migré1pée1tude`;
