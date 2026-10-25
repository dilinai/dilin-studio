/* 堤麟画板 · 菜单实作 · Photoshop ▸ 文字（命令名一律 ps.<原码 id>）
   照 ArtCraft photocraft 原码逐段翻：
   - engine/src/type_extra_cmds.rs   消除锯齿／方向／转换段落⇄点文字／建立工作路径／转换为形状／弯曲文字／OpenType 开关／
                                     Lorem Ipsum／更新所有文字图层／缺失字体／默认文字样式（整支照抄）
   - text/src/render.rs              rasterize_warped：AntiAlias::None ⇒ 覆盖度 ≥0.5 才算（:194，其余五种消除锯齿画法相同）；
                                     outlines＋WarpSink：字形轮廓先在文字空间弯曲、长线段先切细再映射
   - text/src/warp.rs ＋ geom/src/warp.rs   StyleWarp 十五种样式的映射公式（逐行翻成 makeWarp）
   - text/src/layout.rs              直排：行空间转 90°（第一栏中线在锚点、往左换栏）、汉字假名直立居中、拉丁字转 90°、vertical_class
   - ui-egui/src/view_cmds.rs        type.panels.character/paragraph、fontPreviewSize、languageOptions（只记状态，原码也只记）
   - ui-egui/src/type_panels_ui.rs   字形面板（Show 分类、最近使用、双击插入）、字符样式／段落样式面板
   - text/src/glyphs.rs              字形面板的 CATEGORIES 与 in_category
   - engine/src/type_styles_cmds.rs  字符样式／段落样式（new/duplicate/delete/rename/set/apply/redefine/clearOverride/list）
   - engine/src/type_spell_cmds.rs   type.insertText（字形面板插字）
   文字层 L.data 新栏位（都在 data 里 ⇒ 历史快照与工程档自动带）：
     antialias:'none|sharp|crisp|strong|smooth|windowsLcd|windows'（缺＝smooth）、orientation:'horizontal|vertical'、
     features:{liga,calt,dlig,swsh,onum,salt,titl,ornm,ordn,frac}（liga 缺＝开）、warp:{style,bend,horizontalDistortion,verticalDistortion,horizontal}、
     charStyle／paraStyle（套用的样式 id）
   Doc 新栏位：workPath {layerId, subpaths:[{closed, anchors}]}（文件坐标）、typeStyles {character:[…], paragraph:[…], basic:{…}, nextC, nextP}
   🔴 渲染：这几个栏位要共用层配合（engine.js renderLayer）——先在本档包一层 renderLayer（同 ai-object.js 的过渡包法），
      等共用层的钩子并进 engine.js 后自动不再包。 */
(function(){
'use strict';
if (window.PsType) return;                 // 防重复载入（测试 add_script_tag＋index.html 都挂时）

const L3 = (hant, hans, en) => Lang.cur === 'en' ? en : Lang.cur === 'zh-Hans' ? hans : hant;
const fail = msg => ({ok:false, error:msg});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isNum = v => typeof v === 'number' && isFinite(v);
const chars = s => Array.from(String(s == null ? '' : s));
const NO_TEXT = 'the active layer is not a type layer';
const reg = (id, meta, fn) => CMD.reg('ps.' + id, Object.assign({i18n:''}, meta), fn);
const TT = () => window.TypeTool;
const LINE_H = 1.25;                       // engine.js renderLayer 的行距（tools/text.js LINE_H）
const lineH = d => +d.leading > 0 ? +d.leading : d.size * LINE_H;   // 图层有 data.leading 就用它（engine.js textLineH）

/* 目标文字层：p.layer／p.layerId／p.id ＞ 当前层（type_extra_cmds.rs with_text → layer_param） */
function textOf(p){
  const id = p && (p.layer || p.layerId || p.id);
  const L = id ? Doc.byId(id) : Doc.active();
  return L && L.kind === 'text' ? L : null;
}
const textLayers = () => Doc.layers.filter(L => L.kind === 'text');
const fontOf = (d, k) => `${d.weight || 'normal'} ${d.size * (k || 1)}px ${d.font}`;   // 跟 renderLayer 同一个字型串
const _mc = document.createElement('canvas').getContext('2d');
function metrics(d){
  _mc.font = fontOf(d); const m = _mc.measureText('Mg');
  return [m.fontBoundingBoxAscent || d.size * 0.8, m.fontBoundingBoxDescent || d.size * 0.2];
}
/* tools/text.js dAscent：小写 d 的高度（段落文字第一条基线＝框顶＋它） */
function dAscent(d){ _mc.font = fontOf(d); const h = _mc.measureText('d').actualBoundingBoxAscent; return h > 0 ? h : metrics(d)[0] * 0.75; }
/* tools/text.js placeInBox 的同一套：段落文字锚点跟着对齐落在框的左／中／右，第一条基线＝框顶＋d 高 */
function placeInBox(d){
  const b = d.box; if (!b) return;
  d.x = b.x + (d.align === 'center' ? b.w / 2 : d.align === 'right' ? b.w : 0);
  d.y = b.y + dAscent(d);
}
function touch(L){ Layer.invalidate(L); }

/* ═══════════ 状态（view_cmds.rs ViewOptions：font_preview_size／language_features／middle_eastern_composer；面板开关） ═══════════ */
const PREF_KEY = 'dlc.psType.prefs';
const FONT_PREVIEW = ['small', 'medium', 'large', 'extraLarge', 'huge'];        // view_cmds.rs:134
const FONT_PREVIEW_PX = {small:10, medium:13, large:16, extraLarge:20, huge:26}; // 我们的取值（原码只记名字，PS 的字体选单预览字号）
const LANGUAGE = ['defaultFeatures', 'eastAsianFeatures', 'middleEasternFeatures']; // view_cmds.rs:135
const state = Object.assign({fontPreviewSize:'medium', languageFeatures:'defaultFeatures', middleEasternComposer:false,
  glyphFamily:'', glyphCategory:'Entire Font', glyphSize:32, glyphRecent:[], glyphSelected:null}, (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch(e){ return {}; } })());
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify({fontPreviewSize:state.fontPreviewSize, languageFeatures:state.languageFeatures,
  middleEasternComposer:state.middleEasternComposer, glyphCategory:state.glyphCategory, glyphSize:state.glyphSize, glyphRecent:state.glyphRecent})); } catch(e){} };

/* ═══════════ 弯曲（geom/src/warp.rs StyleWarp 逐行翻） ═══════════ */
const WARP_STYLES = ['arc', 'arcLower', 'arcUpper', 'arch', 'bulge', 'shellLower', 'shellUpper', 'flag', 'wave', 'fish', 'rise', 'fisheye', 'inflate', 'squeeze', 'twist'];   // text/warp.rs:13 STYLES（PS 菜单顺序）
/* text/warp.rs:32 psd_style：短 id（不分大小写）或 PSD 名（warpArc）→ 短 id；none／warpNone → 'none'；不认得 → null */
function warpStyleId(s){
  const l = String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
  if (l === 'none' || l === 'warpnone') return 'none';
  return WARP_STYLES.find(x => x.toLowerCase() === l || ('warp' + x).toLowerCase() === l) || null;
}
const PI = Math.PI, HALF_PI = Math.PI / 2;
/* warp.rs:252 arc：盒子中线变成一段张 b×180° 的圆弧，两端的弧长＝盒子半长 */
function arc(u, v, b, aspect){
  if (Math.abs(b) < 1e-6) return [u, v];
  const half = aspect, tm = b * HALF_PI, r = half / tm, th = u * tm, rr = r - v;
  return [rr * Math.sin(th) / half, r - rr * Math.cos(th)];
}
const lerp2 = (a, b, t) => { t = clamp(t, 0, 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
/* warp.rs:165 StyleWarp::new ＋ :188 apply ＋ :206 bend。回 null＝不弯（none、全 0、空盒） */
function makeWarp(w, bounds){
  if (!w || !bounds) return null;
  const style = warpStyleId(w.style); if (!style || style === 'none') return null;
  const [x0, y0, x1, y1] = bounds, hw = (x1 - x0) / 2, hh = (y1 - y0) / 2;
  if (!(hw > 0 && hh > 0)) return null;
  const pct = v => isNum(+v) && v !== null && v !== '' ? clamp(+v / 100, -1, 1) : 0;
  const b = pct(w.bend), hd = pct(w.horizontalDistortion), vd = pct(w.verticalDistortion);
  if (b === 0 && hd === 0 && vd === 0) return null;
  const vertical = w.horizontal === false, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  function bend(u, v, aspect){
    const bell = Math.max(1 - u * u, 0);
    switch (style){
      case 'arc': return arc(u, v, b, aspect);
      case 'arcLower': return lerp2([u, v], arc(u, v, b, aspect), (v + 1) / 2);
      case 'arcUpper': return lerp2([u, v], arc(u, v, b, aspect), (1 - v) / 2);
      case 'arch': return [u, v - b * bell];                                   // 每一直栏同一条抛物线往上抬
      case 'bulge': return [u, v * (1 + b * bell)];
      case 'shellLower': return [u, v + b * bell * (v + 1) / 2];
      case 'shellUpper': return [u, v - b * bell * (1 - v) / 2];
      case 'flag': return [u, v - b * 0.5 * Math.sin(PI * u)];
      case 'wave': return [u, v - b * 0.5 * Math.sin(PI * u + v * HALF_PI)];
      case 'fish': return [u, v * (1 + b * 0.6 * (1 - u) * Math.sqrt(bell)) - b * 0.35 * bell];
      case 'rise': return [u, v - b * 0.5 * Math.sin(HALF_PI * u)];
      case 'fisheye': { const r2 = Math.min(u * u + v * v, 1), k = 1 + b * (1 - r2); return [u * k, v * k]; }
      case 'inflate': { const bu = Math.max(1 - v * v, 0), bv = bell; return [u * (1 + b * 0.5 * bu), v * (1 + b * 0.5 * bv)]; }
      case 'squeeze': return [u * (1 + b * 0.5 * Math.max(1 - v * v, 0)), v * (1 - b * 0.5 * bell)];
      case 'twist': {
        const r = Math.sqrt(u * u + v * v); if (r >= 1) return [u, v];
        const a = b * HALF_PI * (1 - r) * (1 - r), s = Math.sin(a), c = Math.cos(a);   // 在等向坐标里转，宽盒也是圆的
        const x = u * aspect, y = v;
        return [(x * c - y * s) / aspect, x * s + y * c];
      }
    }
    return [u, v];
  }
  return {
    style, maxSeg: Math.max(Math.min(hw, hh) / 16, 0.5),
    apply(x, y){
      const dx = x - cx, dy = y - cy;
      const [u, v, hu, hv] = vertical ? [dy / hh, dx / hw, hh, hw] : [dx / hw, dy / hh, hw, hh];
      let [u2, v2] = bend(u, v, hu / hv);
      if (hd !== 0) v2 *= Math.max(1 + hd * u2, 0.05);                       // 透视般的收窄
      if (vd !== 0) u2 *= Math.max(1 + vd * v2, 0.05);
      const [ox, oy] = vertical ? [v2 * hw, u2 * hh] : [u2 * hw, v2 * hh];
      return [cx + ox, cy + oy];
    }
  };
}

/* ═══════════ OpenType（type_extra_cmds.rs:342 feature_on；CharStyle 默认 ligatures=true） ═══════════ */
const OT = {standardLigatures:'liga', contextualAlternates:'calt', discretionaryLigatures:'dlig', swash:'swsh', oldstyle:'onum',
  stylisticAlternates:'salt', titlingAlternates:'titl', ornaments:'ornm', ordinals:'ordn', fractions:'frac'};
const featureOn = (d, tag) => { const f = (d && d.features) || {}; return tag === 'liga' ? f.liga !== false : !!f[tag]; };
/* 关掉标准连字：canvas 2D 没有 font-feature-settings ⇒ 字与字之间插零宽不连字（U+200C），浏览器就不会把 fi／fl 连起来 */
const shapeText = (d, s) => featureOn(d, 'liga') ? s : chars(s).join('‌');

/* ═══════════ 版面（横排跟 engine.js renderLayer／tools/text.js 一模一样；直排照 layout.rs） ═══════════ */
/* layout.rs:49 vertical_class：AlternateOrRotate（括号、长音、破折）＝字型有直排替代字就直立，否则转 90°。
   canvas 用不到 vert 替代字 ⇒ 这一类一律转 90°（原码的退路）。 */
function vClass(c){
  const u = c.codePointAt(0);
  const alt = (u >= 0x2014 && u <= 0x2016) || u === 0x2025 || u === 0x2026 || u === 0x2329 || u === 0x232A || (u >= 0x3008 && u <= 0x3011) ||
    (u >= 0x3014 && u <= 0x301F) || u === 0x3030 || u === 0x30A0 || u === 0x30FC || (u >= 0xFE59 && u <= 0xFE5E) || u === 0xFF08 || u === 0xFF09 ||
    u === 0xFF0D || (u >= 0xFF1A && u <= 0xFF1E) || u === 0xFF3B || u === 0xFF3D || u === 0xFF3F || (u >= 0xFF5B && u <= 0xFF60) || u === 0xFFE3;
  if (alt) return 'rotate';
  if (u >= 0xFF61 && u <= 0xFFDC) return 'rotate';                         // 半形片假名／韩文跟其他半形字一样转
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u.test(c) ||
    (u >= 0x3000 && u <= 0x303F) || (u >= 0xFF01 && u <= 0xFF60) || (u >= 0xFFE0 && u <= 0xFFE6) || (u >= 0x3200 && u <= 0x33FF);
  const up = cjk || [0xA7, 0xA9, 0xAE, 0xB1, 0xD7, 0xF7].includes(u) || (u >= 0xBC && u <= 0xBE) || (u >= 0x2E80 && u <= 0x2EFF) ||
    (u >= 0xFE10 && u <= 0xFE1F) || (u >= 0xFE30 && u <= 0xFE4F) || (u >= 0x1F000 && u <= 0x1FAFF);
  return up ? 'upright' : 'rotate';
}
/* 直排时「、。，．」用不到直排替代字：往右上挪到字身的右上角（我们的近似，直排替代字的位置） */
const V_PUNCT = new Set(Array.from('、。，．､｡'));

/* 横排：每行 {start,end,soft,text,baseline,x0,x1}（图层坐标）——用 tools/text.js 的版面（跟 renderLayer 画的同一套） */
function hLines(L){
  const d = L.data;
  if (TT() && TT().layout){
    const lay = TT().layout(L), cs = chars(d.text);
    return lay.lines.map(l => {
      let e = l.end; while (e > l.start && /\s/.test(cs[e - 1]) && cs[e - 1] !== ' ') e--;
      while (e > l.start && cs[e - 1] === ' ') e--;
      return {start:l.start, end:l.end, soft:l.soft, text:cs.slice(l.start, e).join(''), baseline:l.baseline - L.y, x0:l.x0 - L.x, x1:l.x1 - L.x, asc:l.ascent, desc:l.descent};
    });
  }
  const [asc, desc] = metrics(d); _mc.font = fontOf(d);
  let at = 0;
  return String(d.text).split('\n').map((t, i) => {
    const w = _mc.measureText(t).width, x0 = d.x - (d.align === 'center' ? w / 2 : d.align === 'right' ? w : 0);
    const r = {start:at, end:at + chars(t).length, soft:false, text:t, baseline:d.y + i * lineH(d), x0, x1:x0 + w, asc, desc}; at = r.end + 1; return r;
  });
}
/* 直排（layout.rs 第 9-15 行的规则）：一行＝一栏由上往下、下一栏往左；栏宽＝字号（col_half＝size/2）、栏距＝size×1.25（我们的行距）。
   点文字：第一栏中线在锚点 x、沿栏从锚点 y 起（对齐：靠左＝从锚点往下、置中＝以锚点为中、靠右＝收在锚点）；
   段落文字：第一栏右缘贴框右缘（layout.rs:489）、沿栏从框顶起、超出框左缘的栏不排（:497 overflow）。 */
function vLayout(L){
  const d = L.data, size = d.size, half = size / 2, lh = lineH(d), cs = chars(d.text);
  let R;
  if (d.box && TT() && TT().wrapRanges) R = TT().wrapRanges(Object.assign({}, d, {box:{x:0, y:0, w:Math.max(1, d.box.h), h:1e9}}));   // 栏长＝框高；沿栏的字宽＝横排字宽
  else { R = []; let s = 0; for (let i = 0; i <= cs.length; i++) if (i === cs.length || cs[i] === '\n'){ R.push({start:s, end:i, soft:false}); s = i + 1; } }
  _mc.font = fontOf(d);
  const [asc, desc] = metrics(d), centre = (asc - desc) * 0.5;         // layout.rs:699 转 90° 的字基线离栏中线 (ascent−descent)/2
  const cols = [];
  for (let k = 0; k < R.length; k++){
    const r = R[k];
    const cx = d.box ? d.box.x + d.box.w - half - k * lh : d.x - k * lh;
    if (d.box && k > 0 && cx - half < d.box.x - 0.5) break;
    let e = r.end; while (e > r.start && /\s/.test(cs[e - 1])) e--;
    const runs = []; let u = 0;
    for (let i = r.start; i < e; i++){
      const c = cs[i], cls = vClass(c);
      if (cls === 'upright'){ const adv = _mc.measureText(c).width; runs.push({text:c, rot:false, u, adv, punct:V_PUNCT.has(c)}); u += adv; }
      else {
        const last = runs[runs.length - 1];
        if (last && last.rot){ last.text += c; const adv = _mc.measureText(shapeText(d, last.text)).width; u += adv - last.adv; last.adv = adv; }
        else { const adv = _mc.measureText(shapeText(d, c)).width; runs.push({text:c, rot:true, u, adv}); u += adv; }
      }
    }
    const len = u, base = d.box ? d.box.y : d.y, avail = d.box ? d.box.h : 0;
    const u0 = d.align === 'center' ? (d.box ? base + (avail - len) / 2 : base - len / 2) : d.align === 'right' ? (d.box ? base + avail - len : base - len) : base;
    runs.forEach(rn => { rn.u += u0; });
    cols.push({start:r.start, end:r.end, soft:r.soft, cx, u0, u1:u0 + len, runs});
  }
  return {cols, size, half, centre, asc, desc};
}
/* 逻辑外框（layout.rs bounds：各行 [x0, baseline−ascent, x1, baseline+descent] 的联集；直排转回文字空间）——弯曲以它为盒子 */
function logicalBounds(L){
  const d = L.data;
  if (!chars(d.text).length) return null;
  if (d.orientation === 'vertical'){
    const v = vLayout(L); if (!v.cols.length) return null;
    return [Math.min(...v.cols.map(c => c.cx)) - v.half, Math.min(...v.cols.map(c => c.u0)), Math.max(...v.cols.map(c => c.cx)) + v.half, Math.max(...v.cols.map(c => c.u1))];
  }
  const ls = hLines(L); if (!ls.length) return null;
  return [Math.min(...ls.map(l => l.x0)), ls[0].baseline - ls[0].asc, Math.max(...ls.map(l => l.x1)), ls[ls.length - 1].baseline + ls[ls.length - 1].desc];
}

/* 不弯曲地把字画进 ctx（ctx 已经平移好：图层坐标 × k 就是画布座标） */
function drawPlain(ctx, L, k){
  const d = L.data;
  ctx.fillStyle = d.color; ctx.font = fontOf(d, k);
  if (d.orientation === 'vertical'){
    const v = vLayout(L);
    ctx.textAlign = 'left';
    for (const col of v.cols) for (const rn of col.runs){
      if (rn.rot){
        // GlyphOrient::Rotated：顺时针 90°，字的「上」朝右，基线在栏中线左边 centre（render.rs:124）
        ctx.save(); ctx.textBaseline = 'alphabetic';
        ctx.translate((col.cx - v.centre) * k, rn.u * k); ctx.rotate(HALF_PI);
        ctx.fillText(shapeText(d, rn.text), 0, 0); ctx.restore();
      } else {
        // GlyphOrient::Upright：字身居中于栏（g.x = −baseline − advance/2），表意字框底＝这一格的底
        ctx.textBaseline = 'ideographic';
        let x = col.cx - rn.adv / 2, y = rn.u + rn.adv;
        if (rn.punct){ x += rn.adv * 0.55; y -= rn.adv * 0.55; }
        ctx.fillText(rn.text, x * k, y * k);
      }
    }
    ctx.textBaseline = 'alphabetic';
    return;
  }
  ctx.textAlign = d.align || 'left'; ctx.textBaseline = 'alphabetic';
  const lines = (TT() && TT().wrapLines) ? TT().wrapLines(d) : String(d.text).split('\n');
  lines.forEach((line, i) => ctx.fillText(shapeText(d, line), d.x * k, (d.y + i * lineH(d)) * k));
}

/* ═══════════ 轮廓（render.rs outlines：字形轮廓→路径）══════════
   浏览器拿不到字型档的字形轮廓（不引 opentype.js：画板零依赖）⇒ canvas 近似：把字以 ss 倍画到离屏、
   以覆盖度 0.5 为界跑 marching squares（边上线性内插，次像素准）、Douglas–Peucker 收点。
   外圈与字腔（o 的洞）的绕向天然相反（填充永远在前进方向右手边）⇒ 非零绕数＝原码「同向相加、反向相减」（type_extra_cmds.rs:269）。 */
function traceAlpha(a, w, h, th){
  const W2 = w + 2, val = (i, j) => (i < 0 || j < 0 || i >= w || j >= h) ? 0 : a[j * w + i];
  const kH = (i, j) => ((j + 1) * W2 + (i + 1)) * 2, kV = (i, j) => ((j + 1) * W2 + (i + 1)) * 2 + 1;
  const pts = new Map(), next = new Map();
  const ptH = (i, j) => { const k = kH(i, j); if (!pts.has(k)){ const v0 = val(i, j), v1 = val(i + 1, j); pts.set(k, [i + (th - v0) / (v1 - v0), j]); } return k; };
  const ptV = (i, j) => { const k = kV(i, j); if (!pts.has(k)){ const v0 = val(i, j), v1 = val(i, j + 1); pts.set(k, [i, j + (th - v0) / (v1 - v0)]); } return k; };
  for (let j = -1; j < h; j++) for (let i = -1; i < w; i++){
    const tl = val(i, j) >= th, tr = val(i + 1, j) >= th, br = val(i + 1, j + 1) >= th, bl = val(i, j + 1) >= th;
    const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (code === 0 || code === 15) continue;
    const T = () => ptH(i, j), B = () => ptH(i, j + 1), Lf = () => ptV(i, j), Rt = () => ptV(i + 1, j);
    const seg = (f, t) => next.set(f(), t());
    switch (code){                            // 填充在前进方向右手边（y 朝下）
      case 1: seg(Lf, B); break;   case 2: seg(B, Rt); break;   case 3: seg(Lf, Rt); break;   case 4: seg(Rt, T); break;
      case 6: seg(B, T); break;    case 7: seg(Lf, T); break;   case 8: seg(T, Lf); break;    case 9: seg(T, B); break;
      case 11: seg(T, Rt); break;  case 12: seg(Rt, Lf); break; case 13: seg(Rt, B); break;   case 14: seg(B, Lf); break;
      case 5: case 10: {            // 鞍点：看格心
        const c = (val(i, j) + val(i + 1, j) + val(i + 1, j + 1) + val(i, j + 1)) / 4 >= th;
        if (code === 5){ if (c){ seg(Lf, T); seg(Rt, B); } else { seg(Lf, B); seg(Rt, T); } }
        else { if (c){ seg(T, Rt); seg(B, Lf); } else { seg(T, Lf); seg(B, Rt); } }
      }
    }
  }
  const loops = [];
  while (next.size){
    const k0 = next.keys().next().value; const loop = []; let k = k0;
    do { loop.push(pts.get(k)); const n = next.get(k); next.delete(k); k = n; } while (k !== undefined && k !== k0 && next.has(k));
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
const area = P => { let s = 0; for (let i = 0; i < P.length; i++){ const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
/* 闭合多边形的 Douglas–Peucker（非递回） */
function simplifyClosed(P, tol){
  const n = P.length; if (n < 8) return P;
  let far = 0, fd = -1; for (let i = 1; i < n; i++){ const d = (P[i][0] - P[0][0]) ** 2 + (P[i][1] - P[0][1]) ** 2; if (d > fd){ fd = d; far = i; } }
  const keep = new Uint8Array(n); keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, n]], t2 = tol * tol;
  const at = i => P[i % n];
  while (stack.length){
    const [a, b] = stack.pop(); if (b - a < 2) continue;
    const A = at(a), B = at(b), dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy;
    let mi = -1, md = -1;
    for (let i = a + 1; i < b; i++){
      const p = P[i]; let d;
      if (L2 < 1e-12) d = (p[0] - A[0]) ** 2 + (p[1] - A[1]) ** 2;
      else { const c = (dx * (p[1] - A[1]) - dy * (p[0] - A[0])); d = c * c / L2; }
      if (d > md){ md = d; mi = i; }
    }
    if (md > t2){ keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(P[i]);
  return out;
}
/* 字的轮廓多边形（图层坐标；有弯曲就照 WarpSink：长线段先切细再映射）。opt.ss＝超采样倍数、opt.tol＝收点容差（文件 px）、opt.k＝渲染倍率 */
function outlinePolys(L, opt){
  opt = opt || {};
  const d = L.data, b = logicalBounds(L); if (!b) return [];
  const k0 = (opt.k || 1) * (opt.ss || 3), pad = d.size * 0.6;
  const bw = b[2] - b[0] + 2 * pad, bh = b[3] - b[1] + 2 * pad;
  const k = Math.min(k0, Math.sqrt(8e6 / Math.max(1, bw * bh)));    // 离屏上限 800 万点
  const ox = b[0] - pad, oy = b[1] - pad, w = Math.max(1, Math.ceil(bw * k)), h = Math.max(1, Math.ceil(bh * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', {willReadFrequently:true});
  x.setTransform(1, 0, 0, 1, -ox * k, -oy * k);
  drawPlain(x, Object.assign({}, L, {data:Object.assign({}, d, {color:'#000000'})}), k);
  const img = x.getImageData(0, 0, w, h).data, a = new Uint8Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = img[i * 4 + 3];
  const tol = (opt.tol || 0.12) * k;
  let polys = traceAlpha(a, w, h, 127.5).map(P => simplifyClosed(P, tol)).filter(P => P.length >= 3 && Math.abs(area(P)) > 0.5)
    .map(P => P.map(p => [ox + (p[0] + 0.5) / k, oy + (p[1] + 0.5) / k]));   // 取样点在像素中心
  const wp = opt.noWarp ? null : makeWarp(d.warp, b);
  if (wp){
    polys = polys.map(P => {
      const out = [];
      for (let i = 0; i < P.length; i++){
        const p0 = P[i], p1 = P[(i + 1) % P.length], len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const n = clamp(Math.ceil(len / wp.maxSeg), 1, 256);
        for (let s = 0; s < n; s++){ const t = s / n; out.push(wp.apply(p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t)); }
      }
      return out;
    });
  }
  return polys;
}
/* 多边形 → 贝兹锚点（文件坐标）：转角小于 40° 的点给 Catmull-Rom 切线把手（平滑点），其余直角点（钢笔路径的锚点格式） */
function toAnchors(P, dx, dy){
  const n = P.length;
  return P.map((p, i) => {
    const a = P[(i - 1 + n) % n], c = P[(i + 1) % n];
    const v1 = [p[0] - a[0], p[1] - a[1]], v2 = [c[0] - p[0], c[1] - p[1]], l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    const x = p[0] + dx, y = p[1] + dy;
    if (l1 < 1e-9 || l2 < 1e-9) return {x, y, in:null, out:null};
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
    if (cos < Math.cos(40 * PI / 180)) return {x, y, in:null, out:null};
    const t = [c[0] - a[0], c[1] - a[1]], lt = Math.hypot(...t) || 1, tx = t[0] / lt, ty = t[1] / lt;
    const r = v => +v.toFixed(3);
    return {x:r(x), y:r(y), in:[r(x - tx * l1 / 3), r(y - ty * l1 / 3)], out:[r(x + tx * l2 / 3), r(y + ty * l2 / 3)], smooth:true};
  });
}
/* type_extra_cmds.rs:272 text_path：整层文字的轮廓路径（文件坐标） */
function textPath(L){
  const polys = outlinePolys(L, {ss:4, tol:0.18});
  return polys.map(P => ({closed:true, anchors:toAnchors(P, L.x, L.y)}));
}

/* ═══════════ 渲染（engine.js renderLayer 的文字那支：直排／弯曲／消除锯齿「无」／关连字） ═══════════ */
const PsTypeRender = {
  handles(L){
    if (!L || L.kind !== 'text' || !L.data) return false;
    const d = L.data;
    return d.orientation === 'vertical' || d.antialias === 'none' || !featureOn(d, 'liga') || !!(d.warp && warpStyleId(d.warp.style) && warpStyleId(d.warp.style) !== 'none');
  },
  /* 同 renderLayer：回一张文件大小 × scale 的画布，已含 L.x/L.y 位移；按视角缓存（铁律③） */
  render(L, scale){
    if (L._cache && L._cacheScale === scale) return L._cache;
    const W = Math.max(1, Math.round(Doc.width * scale)), H = Math.max(1, Math.round(Doc.height * scale));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', {willReadFrequently:true});
    this.drawInto(x, L, scale);
    if (L.data.antialias === 'none') threshold(x, W, H);
    L._cache = c; L._cacheScale = scale;
    return c;
  },
  drawInto(x, L, scale){
    const d = L.data, b = logicalBounds(L);
    x.save(); x.translate(L.x * scale, L.y * scale);
    if (b && makeWarp(d.warp, b)){
      // 弯曲：轮廓在文字空间弯（render.rs WarpSink），再填（非零绕数）
      const polys = outlinePolys(L, {k:scale, ss:Math.max(1, 3 / scale), tol:0.08});   // 取样密度至少每文件 px 3 点、每输出 px 1 点
      x.beginPath();
      for (const P of polys){ P.forEach((p, i) => i ? x.lineTo(p[0] * scale, p[1] * scale) : x.moveTo(p[0] * scale, p[1] * scale)); x.closePath(); }
      x.fillStyle = d.color; x.fill('nonzero');
    } else drawPlain(x, L, scale);
    x.restore();
  },
  /* 给 SVG 导出：整层轮廓当一个复合路径（图层坐标） */
  compound(L){
    const subs = outlinePolys(L, {ss:4, tol:0.18}).map(P => toAnchors(P, 0, 0));
    return {id:uid('S'), type:'compound', rule:'nonzero', fill:L.data.color, stroke:'none', strokeWidth:0,
      children:subs.map(a => ({id:uid('S'), type:'bezier', anchors:a, closed:true, fill:'none', stroke:'none', strokeWidth:0}))};
  },
  vLayout, logicalBounds, makeWarp, outlinePolys
};
/* render.rs:194 AntiAlias::None：覆盖度 ≥ 0.5 ⇒ 全涂，否则不涂 */
function threshold(x, W, H){
  const im = x.getImageData(0, 0, W, H), p = im.data;
  for (let i = 3; i < p.length; i += 4){ if (p[i]){ p[i] = p[i] >= 128 ? 255 : 0; } }
  x.putImageData(im, 0, 0);
}
window.PsTypeRender = PsTypeRender;

/* ═══════════ 过渡包法（共用层接上钩子之后自动停用） ═══════════ */
if (typeof renderLayer === 'function' && !renderLayer.__psType && !/PsTypeRender/.test(String(renderLayer))){
  const orig = renderLayer;
  const w = function(L, scale){ if (L && L.kind === 'text' && PsTypeRender.handles(L) && !(window.TouchType && TouchType.touched(L))) return PsTypeRender.render(L, scale); return orig(L, scale); };
  w.__psType = true; w.toString = () => String(orig);
  window.renderLayer = w;
}
/* 仿粗体／消除锯齿「浑厚」：画好的文字再往八个方向各偏 r 叠一次（render.rs:70-73：faux_bold ⇒ 八个偏移、r＝字号×FAUX_BOLD_RADIUS 0.018）。
   「浑厚」原码跟平滑画法相同（render.rs 只有 none 不同）；PS 的浑厚看起来比平滑粗一点 ⇒ 照 PS 补：
   同一套八方向偏移、r＝max(0.3 输出 px, 字号×0.008)。
   🔴 要包在所有文字画法（PsTypeRender、AiType 字距、修饰文字…）的外面 ⇒ 等全部脚本载完（load）才包，且 toString 透传让其它包装的「包过没」判断照旧 */
const FAUX_BOLD_RADIUS = 0.018, STRONG_RADIUS = 0.008, STRONG_MIN_PX = 0.3;
const BOLD_OFFS = [[-1, 0], [1, 0], [0, -1], [0, 1], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7]];
function emboldenPx(d, scale){
  let r = 0;
  if (d.fauxBold) r += d.size * FAUX_BOLD_RADIUS * scale;
  if (d.antialias === 'strong') r += Math.max(STRONG_MIN_PX, d.size * STRONG_RADIUS * scale);
  return r;
}
/* 原码把八个偏移的轮廓当同一条路径填（非零绕数）＝覆盖度取联集；canvas 叠八次 source-over 会让边缘半透明越叠越实（1−(1−a)^8，字看起来糊胖）
   ⇒ 自己算：每个像素取「中心＋八个偏移」处覆盖度（双线性）的最大值＝联集的覆盖度，颜色取覆盖最大那一处。只扫有墨的外框 */
function emboldenCanvas(c, r, snap){
  const W = c.width, H = c.height, out = document.createElement('canvas'); out.width = W; out.height = H;
  const sx = c.getContext('2d', {willReadFrequently:true}), all = sx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  let fb = -1, fa = 0;                                             // 退路颜色：最实的那一格
  for (let y = 0; y < H; y++){ const row = y * W * 4; for (let x = 0; x < W; x++){ const a = all[row + x * 4 + 3]; if (a){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; if (a > fa){ fa = a; fb = row + x * 4; } } } }
  if (x1 < 0) return out;
  const pad = Math.ceil(r) + 1;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, im = new ImageData(bw, bh), o = im.data;
  const A = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : all[(y * W + x) * 4 + 3];
  const samp = (fx, fy) => {                                       // 双线性 alpha
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    return (A(ix, iy) * (1 - tx) + A(ix + 1, iy) * tx) * (1 - ty) + (A(ix, iy + 1) * (1 - tx) + A(ix + 1, iy + 1) * tx) * ty;
  };
  const offs = [[0, 0]].concat(BOLD_OFFS.map(([a, b]) => snap ? [Math.round(a * r), Math.round(b * r)] : [a * r, b * r]));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++){
    let best = 0, bx = x, by = y;
    for (const [ox, oy] of offs){ const a = samp(x - ox, y - oy); if (a > best){ best = a; bx = Math.round(x - ox); by = Math.round(y - oy); } }
    if (best <= 0) continue;
    const j = ((y - y0) * bw + (x - x0)) * 4;
    let k = (Math.min(H - 1, Math.max(0, by)) * W + Math.min(W - 1, Math.max(0, bx))) * 4;
    if (!all[k + 3]) k = all[(y * W + x) * 4 + 3] ? (y * W + x) * 4 : fb;   // 取样点刚好落在没墨的格子：用自己的颜色，再不行用最实那格的
    o[j] = all[k]; o[j + 1] = all[k + 1]; o[j + 2] = all[k + 2]; o[j + 3] = snap ? (best >= 128 ? 255 : 0) : Math.round(best);
  }
  out.getContext('2d').putImageData(im, x0, y0);
  return out;
}
/* 仿斜体（render.rs:115 FAUX_ITALIC_DEG＝12：字形 x 加 tan12°×(基线上方的高度)）：逐行以自己的基线为轴往右倾。
   一像素高一条水平带往右挪 tan12°×(基线 − y)（次像素位移交给 drawImage 内插） */
const FAUX_ITALIC_DEG = 12;
function italicCanvas(c, L, scale){
  const d = L.data, W = c.width, H = c.height, k = Math.tan(FAUX_ITALIC_DEG * Math.PI / 180);
  const lines = (TT() && TT().wrapLines) ? TT().wrapLines(d) : String(d.text).split('\n');
  const lh = lineH(d), base = lines.map((_, i) => (L.y + d.y + i * lh) * scale);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const x = out.getContext('2d');
  for (let y = 0; y < H; y++){
    // 这一条属于哪一行：基线在它下面最近的那行（行高范围内），超过最后一行就用最后一行
    let b = base[base.length - 1];
    for (const bb of base){ if (y <= bb + d.size * 0.3 * scale){ b = bb; break; } }
    x.drawImage(c, 0, y, W, 1, k * (b - (y + 0.5)), y, W, 1);
  }
  return out;
}
function installEmbolden(){
  const o = window.renderLayer;
  if (typeof o !== 'function' || o.__psBold) return;
  const w = function(L, scale){
    const c = o.apply(this, arguments);
    if (!L || L.kind !== 'text' || !L.data || !c) return c;
    const r = emboldenPx(L.data, scale), it = !!L.data.fauxItalic && L.data.orientation !== 'vertical';
    if (!(r > 0.05) && !it) return c;
    if (L._boldSrc === c && L._boldScale === scale && L._boldR === r && L._boldIt === it && L._boldOut) return L._boldOut;
    let out = r > 0.05 ? emboldenCanvas(c, r, L.data.antialias === 'none') : c;
    if (it) out = italicCanvas(out, L, scale);
    L._boldSrc = c; L._boldScale = scale; L._boldR = r; L._boldIt = it; L._boldOut = out;
    return out;
  };
  ['__psType', '__aiType', '__aiMiscOptical', '__r3wrap'].forEach(k => { if (o[k]) w[k] = o[k]; });
  w.__psBold = true; w.toString = () => String(o);
  window.renderLayer = w;
}
if (document.readyState === 'complete') installEmbolden(); else window.addEventListener('load', () => { installEmbolden(); if (window.UI && UI.canvas) UI.draw(); });
window.PsTypeEmbolden = {px:emboldenPx, install:installEmbolden};

/* SVG 导出：直排／弯曲的文字层 <text> 表达不了 ⇒ 暂时换成一个复合路径的矢量层再交给原本的 toSVG */
if (window.Project && !Project.__psType && !/PsTypeRender/.test(String(Project.toSVG))){
  const toSVG0 = Project.toSVG;
  Project.toSVG = function(){
    const keep = Doc.layers;
    if (!window.ObjRender) return toSVG0.apply(this, arguments);
    try {
      Doc.layers = keep.map(L => (L.kind === 'text' && !(window.TouchType && TouchType.touched(L)) && (L.data.orientation === 'vertical' || (L.data.warp && PsTypeRender.handles(L)))) ?
        {id:L.id, kind:'vector', name:L.name, visible:L.visible, opacity:L.opacity, blend:L.blend, x:L.x, y:L.y, data:{shapes:[PsTypeRender.compound(L)]}} : L);
      return toSVG0.apply(this, arguments);
    } finally { Doc.layers = keep; }
  };
  /* 工程档：文件层级的样式表 */
  const ser0 = Project.serialize, load0 = Project.load;
  Project.serialize = function(){ const o = ser0.apply(this, arguments); if (Doc.typeStyles) o.typeStyles = Doc.typeStyles; return o; };
  Project.load = async function(json){ const r = await load0.apply(this, arguments); Doc.typeStyles = json && json.typeStyles ? JSON.parse(JSON.stringify(json.typeStyles)) : undefined; Doc.workPath = undefined; return r; };
  Project.__psType = true;
}
/* 历史垫片：Doc.workPath／Doc.typeStyles 进快照（同 ps-layer.js 的串接包法） */
if (!History._psTypeShim && !History._typeExtra){
  const snap0 = History.snap, restore0 = History.restore, rip0 = History.restoreInPlace;
  const put = s => { if (!s || !('psType' in s)) return; Doc.workPath = s.psType.workPath ? JSON.parse(JSON.stringify(s.psType.workPath)) : undefined; Doc.typeStyles = s.psType.typeStyles ? JSON.parse(JSON.stringify(s.psType.typeStyles)) : undefined; };
  History.snap = function(){ const s = snap0.apply(this, arguments); s.psType = {workPath:Doc.workPath ? JSON.parse(JSON.stringify(Doc.workPath)) : null, typeStyles:Doc.typeStyles ? JSON.parse(JSON.stringify(Doc.typeStyles)) : null}; return s; };
  History.restore = function(s){ const r = restore0.apply(this, arguments); put(s); return r; };
  History.restoreInPlace = function(s){ const r = rip0.apply(this, arguments); put(s); return r; };
  History._psTypeShim = true;
}
/* 换文件清掉工作路径与样式表 */
if (!Doc.__psType){
  const reset0 = Doc.reset;
  Doc.reset = function(){ Doc.workPath = undefined; Doc.typeStyles = undefined; return reset0.apply(this, arguments); };
  Doc.__psType = true;
}

/* ═══════════ 命令：消除锯齿／方向（type_extra_cmds.rs:118 set_aa、:126 set_orientation） ═══════════ */
const AA = ['none', 'sharp', 'crisp', 'strong', 'smooth', 'windowsLcd', 'windows'];
const aaOf = d => AA.includes(d && d.antialias) ? d.antialias : 'smooth';
AA.forEach(k => reg('type.antiAlias.' + k, {undoable:true,
  params:`{layer?} 照 type.antiAlias.${k}：文字层的消除锯齿设为「${k}」${k === 'none' ? '（覆盖度 ≥0.5 才涂，边缘无半透明）' : k === 'strong' ? '（照 PS：笔画比平滑略粗，八方向偏 max(0.3px, 字号×0.008) 叠画）' : '（原码 render.rs 只有 none 画法不同，其余与 smooth 同）'} → {antialias}`}, p => {
  const L = textOf(p); if (!L) return fail(NO_TEXT);
  L.data.antialias = k; touch(L); return {antialias:k};
}));
['horizontal', 'vertical'].forEach(o => reg('type.orientation.' + o, {undoable:true,
  params:`{layer?} 照 type.orientation.${o}：文字${o === 'vertical' ? '直排（一栏由上往下、往左换栏；汉字假名直立、拉丁字转 90°）' : '横排'} → {orientation}`}, p => {
  const L = textOf(p); if (!L) return fail(NO_TEXT);
  L.data.orientation = o; touch(L); return {orientation:o};
}));

/* ═══════════ OpenType（:363 toggle_opentype） ═══════════ */
Object.entries(OT).forEach(([k, tag]) => reg('type.openType.' + k, {undoable:true,
  params:`{layer?, on?:bool（缺＝切换）, range?:[startChar,endChar]（我们的文字层只有一种样式 ⇒ 套在整层）} 照 type.openType.${k}：OpenType「${tag}」开关 → {feature, on}`}, p => {
  const L = textOf(p); if (!L) return fail(NO_TEXT);
  const on = typeof p.on === 'boolean' ? p.on : !featureOn(L.data, tag);
  L.data.features = Object.assign({}, L.data.features, {[tag]:on}); touch(L);
  return {feature:tag, on};
}));

/* ═══════════ 建立工作路径／转换为形状（:286 create_work_path、:299 convert_to_shape） ═══════════ */
reg('type.createWorkPath', {undoable:true, params:'{layer?} 照 type.createWorkPath：文字的字形轮廓成为文件的工作路径 Doc.workPath（文件坐标；字腔与外圈反向 ⇒ 非零绕数）→ {subpaths}'}, p => {
  const L = textOf(p); if (!L) return fail(NO_TEXT);
  const subpaths = textPath(L);
  Doc.workPath = {layerId:L.id, subpaths};
  PsType.workPathShown = true;
  return {subpaths:subpaths.length};
});
reg('type.convertToShape', {undoable:true, params:'{layer?} 照 type.convertToShape：文字层换成矢量层（同一个 id、名字、可见、不透明度、混合、蒙版、样式），内容＝一个复合路径（非零绕数），填色＝文字颜色 → {layer, subpaths}'}, p => {
  const L = textOf(p); if (!L) return fail(NO_TEXT);
  const subs = outlinePolys(L, {ss:4, tol:0.18}).map(P => toAnchors(P, 0, 0));   // 图层坐标（矢量层沿用 L.x/L.y）
  const N = Layer.vector(L.name);
  Object.assign(N, {id:L.id, visible:L.visible, opacity:L.opacity, blend:L.blend, x:L.x, y:L.y});
  ['mask', 'maskOff', 'style', 'fillOpacity', 'locks', 'linkGroup'].forEach(k => { if (L[k] !== undefined && L[k] !== null) N[k] = L[k]; });
  const color = L.data.color;
  if (window.ObjRender) N.data.shapes = [{id:uid('S'), type:'compound', rule:'nonzero', fill:color, stroke:'none', strokeWidth:0,
    children:subs.map(a => ({id:uid('S'), type:'bezier', anchors:a, closed:true, fill:'none', stroke:'none', strokeWidth:0}))}];
  else N.data.shapes = subs.map(a => ({id:uid('S'), type:'bezier', anchors:a, closed:true, fill:color, stroke:'none', strokeWidth:0}));
  Doc.layers[Doc.index(L.id)] = N; Doc.activeId = N.id;
  if (window.VecSel) VecSel.clear();
  return {layer:N.id, subpaths:subs.length};
});

/* ═══════════ 点文字 ⇄ 段落文字（:136 to_paragraph、:180 to_point） ═══════════ */
reg('type.convertToParagraphText', {undoable:true, params:'{layer?} 照 type.convertToParagraphText：点文字换成刚好包住它的段落文字框（多留一点不让它重新折行；第一条基线留在原处）→ {box:[x,y,w,h] 文件坐标}'}, p => {
  const L = textOf(p); if (!L) return fail(NO_TEXT);
  const d = L.data; if (d.box) return fail('the type layer is already paragraph text');
  const size = d.size, slackLen = Math.max(size * 0.5, 4);
  let box;
  if (d.orientation === 'vertical'){
    const b = logicalBounds(L) || [d.x - size / 2, d.y, d.x + size / 2, d.y + size];
    const height = Math.max(b[3] - b[1], 1) + slackLen, width = Math.max(b[2] - b[0], 1) + size * 0.5;
    const y = d.align === 'center' ? -height / 2 : d.align === 'right' ? -height : 0;
    box = {x:d.x + size / 2 - width, y:d.y + y, w:width, h:height};         // 框右缘＝第一栏右缘，栏不动
  } else {
    const ls = hLines(L), b = logicalBounds(L) || [d.x, d.y - size, d.x + size, d.y];
    const width = Math.max(b[2] - b[0], 1) + slackLen, height = Math.max(b[3] - b[1], 1) + size * 0.5;
    const x = d.align === 'center' ? -width / 2 : d.align === 'right' ? -width : 0;
    box = {x:d.x + x, y:(ls.length ? ls[0].baseline : d.y) - dAscent(d), w:width, h:height};   // 第一条基线＝框顶＋d 高 ⇒ 留在原基线
  }
  d.box = box;
  if (d.orientation !== 'vertical') placeInBox(d);
  touch(L);
  return {box:[box.x + L.x, box.y + L.y, box.w, box.h]};
});
reg('type.convertToPointText', {undoable:true, params:'{layer?} 照 type.convertToPointText：段落文字换成点文字；每个自动折行处插入硬换行（同 PS），锚点＝第一行的对齐点与基线 → {inserted}'}, p => {
  const L = textOf(p); if (!L) return fail(NO_TEXT);
  const d = L.data; if (!d.box) return fail('the type layer is already point text');
  let breaks = [], ax, ay;
  if (d.orientation === 'vertical'){
    const v = vLayout(L);
    for (let i = 0; i + 1 < v.cols.length; i++) if (v.cols[i].soft) breaks.push(v.cols[i + 1].start);
    ax = v.cols.length ? v.cols[0].cx : d.box.x + d.box.w - d.size / 2;
    ay = d.box.y + (d.align === 'center' ? d.box.h / 2 : d.align === 'right' ? d.box.h : 0);
  } else {
    const ls = hLines(L);
    for (let i = 0; i + 1 < ls.length; i++) if (ls[i].soft) breaks.push(ls[i + 1].start);
    ax = d.box.x + (d.align === 'center' ? d.box.w / 2 : d.align === 'right' ? d.box.w : 0);
    ay = ls.length ? ls[0].baseline : d.y;
  }
  breaks = [...new Set(breaks)].sort((a, b) => a - b);
  const cs = chars(d.text);
  for (let i = breaks.length - 1; i >= 0; i--) cs.splice(breaks[i], 0, '\n');
  d.text = cs.join(''); delete d.box; d.x = ax; d.y = ay;
  touch(L);
  return {inserted:breaks.length};
});

/* ═══════════ 弯曲文字（:318 warp_text；对话框 view_cmds.rs:830） ═══════════ */
const WARP_PARAMS = '{layer?, style:"none|arc|arcLower|arcUpper|arch|bulge|shellLower|shellUpper|flag|wave|fish|rise|fisheye|inflate|squeeze|twist"="arc", bend:-100..100=50, horizontalDistortion:-100..100=0, verticalDistortion:-100..100=0, orientation:"horizontal|vertical"="horizontal"}';
function warpFromParams(p){
  const style = warpStyleId(p.style === undefined ? 'arc' : p.style);
  if (!style) return {err:fail(`unknown warp style "${p.style}"`)};
  const f = (k, dflt) => clamp(isNum(+p[k]) && p[k] !== null && p[k] !== '' ? +p[k] : dflt, -100, 100);
  if (style === 'none') return {warp:null};
  return {warp:{style, bend:f('bend', 50), horizontalDistortion:f('horizontalDistortion', 0), verticalDistortion:f('verticalDistortion', 0), horizontal:p.orientation !== 'vertical'}};
}
reg('type.warpText', {undoable:true, params:WARP_PARAMS + ' 照 type.warpText：字形轮廓按 PS 十五种样式弯曲（存在文字层 data.warp，仍可编辑文字）→ {warp}'}, p => {
  const L = textOf(p); if (!L) return fail(NO_TEXT);
  const r = warpFromParams(p); if (r.err) return r.err;
  if (r.warp) L.data.warp = r.warp; else delete L.data.warp;
  touch(L); return {warp:r.warp};
});
reg('type.warpText.dialog', {params:'{layer?} 开「文字变形」对话框（栏位照 view_cmds.rs:830：样式／水平垂直／弯曲／水平扭曲／垂直扭曲；已弯曲的层带出现值），确定＝ps.type.warpText'}, p => {
  const L = textOf(p); if (!L) return fail(NO_TEXT);
  Dlg.warp(L); return {ok:true, dialog:true};
});

/* ═══════════ 字体预览大小／语言选项（view_cmds.rs:520-531：只记状态） ═══════════ */
FONT_PREVIEW.forEach(k => reg('type.fontPreviewSize.' + k, {params:`{} 照 type.fontPreviewSize.${k}：字体选单（字符面板）的预览字号设为「${k}」（${FONT_PREVIEW_PX[k]}px）`}, () => {
  state.fontPreviewSize = k; savePrefs(); Panels.refresh(true); return {fontPreviewSize:k};
}));
LANGUAGE.forEach(k => reg('type.languageOptions.' + k, {params:`{} 照 type.languageOptions.${k}：语言功能单选（原码只记状态，不影响排版）`}, () => {
  state.languageFeatures = k; savePrefs(); return {languageFeatures:k};
}));
reg('type.languageOptions.middleEasternAndSouthAsianComposer', {params:'{on?:bool（缺＝切换）} 照原码：中东和南亚书写器勾选（只记状态）'}, p => {
  state.middleEasternComposer = typeof p.on === 'boolean' ? p.on : !state.middleEasternComposer; savePrefs();
  return {on:state.middleEasternComposer};
});

/* ═══════════ 更新／缺失字体（:396 update_all、:417 missing_fonts、:434 replace_fonts、:476 resolve_missing） ═══════════ */
const GENERIC = /^(sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|emoji|math)$/i;
const _avail = new Map();
function fontAvailable(f){
  f = String(f || '').trim().replace(/^["']|["']$/g, '');
  if (!f || GENERIC.test(f)) return true;
  if (_avail.has(f)) return _avail.get(f);
  const probe = 'mmmmmmmmmmlli一二三ABC';
  const ok = ['monospace', 'serif', 'sans-serif'].some(base => {
    _mc.font = `72px ${base}`; const w0 = _mc.measureText(probe).width;
    _mc.font = `72px "${f}", ${base}`; return _mc.measureText(probe).width !== w0;
  });
  _avail.set(f, ok); return ok;
}
function missingFonts(){
  const out = [];
  textLayers().forEach(L => { const f = String(L.data.font || '').trim(); if (f && !fontAvailable(f) && !out.includes(f)) out.push(f); });
  return out;
}
const DEFAULT_FAMILY = 'sans-serif';                      // 原码 photocraft_text::fonts::DEFAULT_FAMILY（内附字型）；我们的预设字型
function replaceFonts(map, all){
  const missing = missingFonts();
  if (!missing.length) return {missing:[], replaced:0};
  const pick = f => missing.includes(f) ? (map && typeof map[f] === 'string' && map[f] ? map[f] : (all ? DEFAULT_FAMILY : null)) : null;
  const hit = textLayers().filter(L => pick(String(L.data.font || '').trim()));
  if (!hit.length) return {missing, replaced:0};
  History.push();
  hit.forEach(L => { const d = L.data; d.font = pick(String(d.font).trim()); if (d.box) placeInBox(d); touch(L); });
  return {missing, replaced:hit.length};
}
reg('type.updateAllTextLayers', {params:'{} 照 type.updateAllTextLayers：所有文字层重新排版重画（一步历史）→ {updated}'}, () => {
  const ls = textLayers(); if (!ls.length) return fail('the document has no type layers');
  History.push();
  ls.forEach(L => { if (L.data.box) placeInBox(L.data); touch(L); });
  return {updated:ls.length};
});
reg('type.replaceAllMissingFonts', {params:'{} 照 type.replaceAllMissingFonts：这台机器上没有的字体一律换成默认字体（sans-serif）→ {missing, replaced}'}, () => {
  if (!textLayers().length) return fail('the document has no type layers');
  return replaceFonts({}, true);
});
reg('type.resolveMissingFonts', {params:'{map?:{"缺的字体":"换成的字体"}} 照 type.resolveMissingFonts：给 map ⇒ 照表替换（没列到的不动）；不给 ⇒ 只列出缺的字体 → {missing, replaced?}'}, p => {
  if (!textLayers().length) return fail('the document has no type layers');
  if (p.map && typeof p.map === 'object') return replaceFonts(p.map, false);
  return {missing:missingFonts()};
});
reg('type.resolveMissingFonts.dialog', {params:'{} 开「解析缺失字体」对话框：每个缺的字体选一个替换字体，确定＝ps.type.resolveMissingFonts {map}'}, () => {
  if (!textLayers().length) return fail('the document has no type layers');
  Dlg.fonts(); return {ok:true, dialog:true};
});

/* ═══════════ Lorem Ipsum（:379 paste_lorem；编辑中贴在插入点 view_cmds.rs:775） ═══════════ */
const LOREM_IPSUM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';
reg('type.pasteLoremIpsum', {params:'{layer?, at?:char（缺＝编辑中的插入点，否则文末）, new?:bool=false（另建段落文字层）, size?:px} 照 type.pasteLoremIpsum：当前是文字层就插进去；否则建一个占画布 80% 的段落文字层 → {caret}|{layer}'}, p => {
  const L = p.new === true ? null : textOf(p);
  if (L){
    const ed = TT() && TT().ed && TT().ed.layer === L.id ? TT().ed : null;
    const n = chars(L.data.text).length;
    const at = isNum(+p.at) && p.at !== null && p.at !== undefined ? clamp(+p.at, 0, n) : (ed ? Math.min(ed.caret, n) : n);
    const r = CMD.run('text.edit', {layerId:L.id, replace:{start:at, end:at, text:LOREM_IPSUM}, coalesce:p.coalesce || (ed ? ed.session : undefined)});
    if (r && r.ok === false) return r;
    const caret = at + chars(LOREM_IPSUM).length;
    if (ed && TT().ed){ TT().ed.caret = caret; TT().ed.anchor = caret; }
    return {caret};
  }
  const w = Doc.width, h = Doc.height, dpi = Doc.dpi || 72;
  const pt = isNum(+p.size) && +p.size > 0 ? +p.size * 72 / dpi : clamp(h / 20 * 72 / dpi, 6, 72);   // 原码字号单位是 pt
  const r = CMD.run('text.create', {box:[w * 0.1, h * 0.1, w * 0.8, h * 0.8], text:LOREM_IPSUM, size:pt * dpi / 72, name:'Lorem ipsum'});
  return r && r.id ? {layer:r.id} : r;
});

/* ═══════════ 默认文字样式（:483 save_defaults、:492 load_defaults） ═══════════ */
const charVals = d => ({font:d.font, weight:String(d.weight || 'normal'), size:d.size, color:d.color, features:Object.assign({}, d.features)});
const paraVals = d => ({align:d.align || 'left'});
reg('type.saveDefaultTypeStyles', {params:'{} 照 type.saveDefaultTypeStyles：记下当前文字层的字符＋段落样式；之后新建的文字从它开始（文字工具的字体／样式／字号／对齐跟着换）→ {font, size}'}, p => {
  const L = textOf(p); if (!L) return fail(NO_TEXT);
  PsType.typeDefaults = {char:charVals(L.data), para:paraVals(L.data)};
  const t = TT();
  if (t && t.opt){ t.opt.font = L.data.font; t.opt.style = t.weightToStyle ? t.weightToStyle(L.data.weight) : 'Regular'; t.opt.align = L.data.align || 'left'; }
  if (window.ToolState) ToolState.fontSize = L.data.size;
  return {font:L.data.font, size:L.data.size};
});
reg('type.loadDefaultTypeStyles', {undoable:true, params:'{layer?} 照 type.loadDefaultTypeStyles：把存下的默认样式套到文字层（整段）→ {font, size}'}, p => {
  const D = PsType.typeDefaults; if (!D) return fail('no default type styles have been saved');
  const L = textOf(p); if (!L) return fail(NO_TEXT);
  setVals(L, Object.assign({}, D.char, D.para));
  return {font:D.char.font, size:D.char.size};
});
/* 把一组样式值写进文字层（段落文字重排框内锚点） */
function setVals(L, v){
  const d = L.data;
  ['font', 'weight', 'size', 'color', 'align'].forEach(k => { if (v[k] !== undefined) d[k] = k === 'size' ? +v[k] : String(v[k]); });
  if (v.features) d.features = Object.assign({}, v.features);
  if (d.box) placeInBox(d);
  touch(L);
}

/* ═══════════ 字符样式／段落样式（type_styles_cmds.rs；我们的文字层只有一段样式 ⇒ 套在整层，range 收下不分段） ═══════════ */
const CHAR_KEYS = ['font', 'weight', 'size', 'color', 'features'], PARA_KEYS = ['align'];
const BASE = () => ({font:DEFAULT_FAMILY, weight:'normal', size:12, color:'#000000', features:{}, align:'left'});   // CharStyle／ParagraphStyle::default（12pt、黑、靠左）
const styles = () => Doc.typeStyles || (Doc.typeStyles = {character:[], paragraph:[], basic:{charAttrs:{}, paraAttrs:{}}, nextC:1, nextP:1});
const NO_CHAR = 'None', BASIC_PARA = 'Basic Paragraph';
const cDef = id => styles().character.find(s => s.id === id) || null;
const pDef = id => id === 0 ? Object.assign({id:0, name:BASIC_PARA}, styles().basic) : (styles().paragraph.find(s => s.id === id) || null);
const normFeat = f => { const o = {}; Object.entries(f || {}).forEach(([k, v]) => { if (k === 'liga' ? v === false : !!v) o[k] = !!v; }); return o; };
const eqv = (k, a, b) => k === 'features' ? JSON.stringify(normFeat(a)) === JSON.stringify(normFeat(b)) : String(a) === String(b);
/* resolve_char／resolve_para：默认 ＜ 基本段落 ＜ 段落样式（字符＋段落属性）＜ 字符样式 */
function resolve(cid, pid){
  const r = BASE(), basic = styles().basic, P = pid ? pDef(pid) : null, C = cid ? cDef(cid) : null;
  const add = a => Object.entries(a || {}).forEach(([k, v]) => { r[k] = k === 'features' ? Object.assign({}, r.features, v) : v; });
  add(basic.charAttrs); add(basic.paraAttrs);
  if (P && pid){ add(P.charAttrs); add(P.paraAttrs); }
  if (C) add(C.attrs);
  return r;
}
const vals = d => Object.assign(charVals(d), paraVals(d));
const refsOf = d => ({c:d.charStyle || 0, p:d.paraStyle || 0});
function overrides(d){ const o = resolve(refsOf(d).c, refsOf(d).p), v = vals(d), out = {}; [...CHAR_KEYS, ...PARA_KEYS].forEach(k => { if (!eqv(k, v[k], o[k])) out[k] = v[k]; }); return out; }
/* restyle：按新样式重算，保留对旧样式的局部覆盖（op.clearChar／clearPara 时丢掉） */
function restyle(L, oldStyles, ref, op){
  const d = L.data, cur = Doc.typeStyles; Doc.typeStyles = oldStyles;
  const ov = overrides(d); Doc.typeStyles = cur;
  const r = {c:ref && ref.c !== undefined ? ref.c : refsOf(d).c, p:ref && ref.p !== undefined ? ref.p : refsOf(d).p};
  if (r.c && !cDef(r.c)) r.c = 0; if (r.p && !pDef(r.p)) r.p = 0;
  const nv = resolve(r.c, r.p);
  Object.entries(ov).forEach(([k, v]) => {
    if (op && op.clearChar && CHAR_KEYS.includes(k)) return;
    if (op && op.clearPara && PARA_KEYS.includes(k)) return;
    nv[k] = v;
  });
  const before = JSON.stringify([vals(d), refsOf(d)]);
  setVals(L, nv);
  if (r.c) d.charStyle = r.c; else delete d.charStyle;
  if (r.p) d.paraStyle = r.p; else delete d.paraStyle;
  return before !== JSON.stringify([vals(d), refsOf(d)]);
}
/* commit：换上新样式表、所有文字层重算（目标层套 op）——一步历史由 CMD 推 */
function commitStyles(newSt, targets, ref, op){
  const old = JSON.parse(JSON.stringify(styles()));
  Doc.typeStyles = newSt;
  let n = 0;
  textLayers().forEach(L => { const t = targets.includes(L.id); if (restyle(L, old, t ? ref : null, t ? op : null)) n++; });
  return n;
}
function targetIds(p){
  let ids;
  if (p.layer || p.layerId) ids = [p.layer || p.layerId];
  else if (Array.isArray(p.layers)) ids = p.layers;
  else if (Array.isArray(Doc.selectedIds) && Doc.selectedIds.includes(Doc.activeId)) ids = Doc.selectedIds;
  else ids = Doc.activeId ? [Doc.activeId] : [];
  return ids.filter(id => { const L = Doc.byId(id); return L && L.kind === 'text'; });
}
/* parse_attrs：面板键（font／fontStyle／weight／size／color／align／features）或原码栏位名（font_family／size_pt） */
function parseAttrs(cmd, a){
  const c = {}, pa = {};
  if (a == null) return {c, pa};
  if (typeof a !== 'object') return {err:fail(cmd + ': `attrs` must be an object')};
  const bad = [];
  Object.entries(a).forEach(([k, v]) => {
    if (k === 'font' || k === 'font_family' || k === 'fontFamily') c.font = String(v);
    else if (k === 'fontStyle' || k === 'font_style') c.weight = TT() && TT().styleToWeight ? TT().styleToWeight(v) : 'normal';
    else if (k === 'weight') c.weight = String(v);
    else if (k === 'size' || k === 'size_pt'){ if (!isNum(+v) || +v <= 0) bad.push(k); else c.size = +v; }
    else if (k === 'color') c.color = String(v);
    else if (k === 'features'){ if (typeof v !== 'object') bad.push(k); else c.features = Object.assign({}, v); }
    else if (k === 'align'){ const s = String(v).toLowerCase(); if (!['left', 'center', 'right'].includes(s)) bad.push(k); else pa.align = s; }
    else bad.push(k);
  });
  if (bad.length) return {err:fail(`${cmd}: unknown style attributes: ${bad.join(', ')}`)};
  return {c, pa};
}
const diff = (v, base, keys) => { const o = {}; keys.forEach(k => { if (v[k] !== undefined && !eqv(k, v[k], base[k])) o[k] = k === 'features' ? Object.assign({}, v[k]) : v[k]; }); return o; };
function uniqueName(list, base){
  for (let i = 1; ; i++){ const n = `${base} ${i}`; if (!list.some(s => s.name === n)) return n; }
}
function current(p){
  const ids = targetIds(p); if (!ids.length) return null;
  const cs = [], ps = []; let co = false, po = false;
  ids.forEach(id => { const d = Doc.byId(id).data, ov = overrides(d); cs.push(d.charStyle || 0); ps.push(d.paraStyle || 0);
    co = co || CHAR_KEYS.some(k => k in ov); po = po || PARA_KEYS.some(k => k in ov); });
  const one = v => v.every(x => x === v[0]) ? v[0] : null;
  return {character:one(cs), characterOverride:co, paragraph:one(ps), paragraphOverride:po};
}
['character', 'paragraph'].forEach(kind => {
  const par = kind === 'paragraph', pre = par ? 'type.paragraphStyle.' : 'type.characterStyle.', noun = par ? 'Paragraph' : 'Character';
  const TGT = 'layer?|layers?:[id]（缺＝选中的文字层）';
  const json = s => par ? {id:s.id, name:s.name, paragraphAttrs:s.paraAttrs, characterAttrs:s.charAttrs, resolved:resolve(0, s.id)}
                        : {id:s.id, name:s.name, attrs:s.attrs, resolved:resolve(s.id, 0)};
  const list = p => ({styles:par ? [json(pDef(0)), ...styles().paragraph.map(json)] : [{id:0, name:NO_CHAR, attrs:{}}, ...styles().character.map(json)], current:current(p)});
  const lookup = (cmd, st, p, allowDefault) => {
    const id = p.id === undefined || p.id === null ? null : +p.id;
    if (id === null || !isNum(id)) return {err:fail(cmd + ': missing `id`')};
    const ok = par ? !!st.paragraph.find(s => s.id === id) : !!st.character.find(s => s.id === id);
    if (!(ok || (allowDefault && id === 0))) return {err:fail(`${cmd}: no style with id ${id}`)};
    if (id === 0 && !allowDefault) return {err:fail(cmd + (par ? ': Basic Paragraph can\'t be changed this way' : ': "None" is not a style'))};
    return {id};
  };
  reg(pre + 'list', {params:`{${TGT}} 照 ${pre}list → {styles:[{id,name,属性,resolved}], current:{character,characterOverride,paragraph,paragraphOverride}}`}, p => list(p));
  reg(pre + 'new', {undoable:true, params:`{name?, attrs?:{font,fontStyle|weight,size,color,features${par ? ',align' : ''}}, fromSelection=true（从目标文字的格式起）, apply=false, ${TGT}} 照 ${pre}new → {id, name}`}, p => {
    const cmd = 'ps.' + pre + 'new', a = parseAttrs(cmd, p.attrs); if (a.err) return a.err;
    let ca = a.c, pa = a.pa;
    const ids = targetIds(p), L = ids.length ? Doc.byId(ids[0]) : null;
    if (p.fromSelection !== false && L){
      const v = vals(L.data), r = refsOf(L.data);
      if (par){ ca = Object.assign(diff(v, resolve(0, 0), CHAR_KEYS), ca); pa = Object.assign(diff(v, resolve(0, 0), PARA_KEYS), pa); }
      else ca = Object.assign(diff(v, resolve(0, r.p), CHAR_KEYS), ca);
    }
    const st = JSON.parse(JSON.stringify(styles()));
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : uniqueName(par ? st.paragraph : st.character, noun + ' Style');
    let id;
    if (par){ id = st.nextP++; st.paragraph.push({id, name, paraAttrs:pa, charAttrs:ca}); }
    else { if (Object.keys(pa).length) return fail(cmd + ': character styles have no paragraph attributes'); id = st.nextC++; st.character.push({id, name, attrs:ca}); }
    commitStyles(st, p.apply ? ids : [], p.apply ? (par ? {p:id} : {c:id}) : null, null);
    return {id, name};
  });
  reg(pre + 'duplicate', {undoable:true, params:`{id} 照 ${pre}duplicate：复制一个样式（插在原样式后面，名字加「 copy」）→ {id, name}`}, p => {
    const st = JSON.parse(JSON.stringify(styles())), l = lookup('ps.' + pre + 'duplicate', st, p, par); if (l.err) return l.err;
    let nid, name;
    if (par){ const src = l.id === 0 ? Object.assign({name:BASIC_PARA}, st.basic) : st.paragraph.find(s => s.id === l.id); name = src.name + ' copy'; nid = st.nextP++;
      const pos = st.paragraph.findIndex(s => s.id === l.id); st.paragraph.splice(pos + 1, 0, {id:nid, name, paraAttrs:Object.assign({}, src.paraAttrs), charAttrs:Object.assign({}, src.charAttrs)}); }
    else { const src = st.character.find(s => s.id === l.id); name = src.name + ' copy'; nid = st.nextC++;
      const pos = st.character.findIndex(s => s.id === l.id); st.character.splice(pos + 1, 0, {id:nid, name, attrs:Object.assign({}, src.attrs)}); }
    commitStyles(st, [], null, null);
    return {id:nid, name};
  });
  reg(pre + 'delete', {undoable:true, params:`{id} 照 ${pre}delete：删样式；用到它的文字保留现在的样子（属性变成局部覆盖）→ {deleted, layers}`}, p => {
    const st = styles(), l = lookup('ps.' + pre + 'delete', st, p, false); if (l.err) return l.err;
    if (par) st.paragraph = st.paragraph.filter(s => s.id !== l.id); else st.character = st.character.filter(s => s.id !== l.id);
    let n = 0;
    textLayers().forEach(L => { const k = par ? 'paraStyle' : 'charStyle'; if (L.data[k] === l.id){ delete L.data[k]; n++; touch(L); } });
    return {deleted:l.id, layers:n};
  });
  reg(pre + 'rename', {undoable:true, params:`{id, name} 照 ${pre}rename → {id, name}`}, p => {
    const st = styles(), l = lookup('ps.' + pre + 'rename', st, p, false); if (l.err) return l.err;
    const name = typeof p.name === 'string' ? p.name.trim() : ''; if (!name) return fail('ps.' + pre + 'rename: missing `name`');
    (par ? st.paragraph : st.character).find(s => s.id === l.id).name = name;
    return {id:l.id, name};
  });
  reg(pre + 'set', {undoable:true, params:`{id${par ? '（0＝基本段落）' : ''}, name?, attrs:{…}, replace=false（没给的属性清掉）, clear?:[栏位]} 照 ${pre}set（样式选项）：改样式定义，用到它的文字跟着变、局部覆盖保留 → {styles, layers, id}`}, p => {
    const cmd = 'ps.' + pre + 'set', st = JSON.parse(JSON.stringify(styles())), l = lookup(cmd, st, p, par); if (l.err) return l.err;
    const a = parseAttrs(cmd, p.attrs); if (a.err) return a.err;
    const clear = Array.isArray(p.clear) ? p.clear.map(String) : [];
    const merge = (dst, src) => { if (p.replace) Object.keys(dst).forEach(k => delete dst[k]); Object.assign(dst, src); clear.forEach(k => delete dst[k]); };
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null;
    if (par){
      const s = l.id === 0 ? st.basic : st.paragraph.find(x => x.id === l.id);
      merge(s.charAttrs, a.c); merge(s.paraAttrs, a.pa);
      if (name && l.id !== 0) s.name = name;
    } else {
      if (Object.keys(a.pa).length) return fail(cmd + ': character styles have no paragraph attributes');
      const s = st.character.find(x => x.id === l.id); merge(s.attrs, a.c); if (name) s.name = name;
    }
    const n = commitStyles(st, [], null, null);
    return Object.assign(list({}), {layers:n, id:l.id});
  });
  reg(pre + 'apply', {undoable:true, params:`{id:u32|0|null（0／null＝${par ? '基本段落' : '无'}）, clearOverrides=false（Alt 点）, ${TGT}} 照 ${pre}apply → {id, layers, current}`}, p => {
    const cmd = 'ps.' + pre + 'apply', st = styles();
    let id = 0;
    if (p.id !== undefined && p.id !== null){ const l = lookup(cmd, st, p, true); if (l.err) return l.err; id = l.id; }
    const ids = targetIds(p); if (!ids.length) return fail('no type layer to apply the style to');
    const op = par ? {clearPara:!!p.clearOverrides, clearChar:!!p.clearOverrides} : {clearChar:!!p.clearOverrides};
    const n = commitStyles(JSON.parse(JSON.stringify(st)), ids, par ? {p:id} : {c:id}, op);
    return {id, layers:n, current:current(p)};
  });
  reg(pre + 'clearOverride', {undoable:true, params:`{${TGT}} 照 ${pre}clearOverride：清掉局部覆盖、回到样式定义 → {layers, current}`}, p => {
    const ids = targetIds(p); if (!ids.length) return fail('no type layer to apply the style to');
    const n = commitStyles(JSON.parse(JSON.stringify(styles())), ids, null, par ? {clearPara:true, clearChar:true} : {clearChar:true});
    return {layers:n, current:current(p)};
  });
  reg(pre + 'redefine', {undoable:true, params:`{id?（缺＝目标文字用的样式）, ${TGT}} 照 ${pre}redefine：样式改成目标文字现在的格式（局部覆盖并进样式）→ {id, layers, current}`}, p => {
    const cmd = 'ps.' + pre + 'redefine', ids = targetIds(p); if (!ids.length) return fail(cmd + ': select type to redefine the style from');
    const L = Doc.byId(ids[0]), d = L.data, st = JSON.parse(JSON.stringify(styles()));
    let id;
    if (p.id !== undefined && p.id !== null){ const l = lookup(cmd, st, p, par); if (l.err) return l.err; id = l.id; }
    else if (par) id = d.paraStyle || 0;
    else { id = d.charStyle || 0; if (!id) return fail(cmd + ': the selected text has no character style'); }
    const ov = overrides(Object.assign({}, d, par ? {paraStyle:id || undefined} : {charStyle:id}));
    if (par){
      const s = id === 0 ? st.basic : st.paragraph.find(x => x.id === id);
      const charKeys = d.charStyle && cDef(d.charStyle) ? Object.keys(cDef(d.charStyle).attrs) : [];
      CHAR_KEYS.forEach(k => { if (k in ov && !charKeys.includes(k)) s.charAttrs[k] = ov[k]; });
      PARA_KEYS.forEach(k => { if (k in ov) s.paraAttrs[k] = ov[k]; });
    } else { const s = st.character.find(x => x.id === id); CHAR_KEYS.forEach(k => { if (k in ov) s.attrs[k] = ov[k]; }); }
    const n = commitStyles(st, [L.id], par ? {p:id} : {c:id}, null);
    return {id, layers:n, current:current(p)};
  });
});

/* ═══════════ 插字（type_spell_cmds.rs:195 insert_text；字形面板双击用 type_panels_ui.rs:578 insert_glyph） ═══════════ */
reg('type.insertText', {params:'{layer?, text, at?:char（缺＝文末）, range?:[startChar,endChar]（换掉）} 照 type.insertText（插入字形）→ {layer, caret}'}, p => {
  const L = textOf(p); if (!L) return fail(NO_TEXT);
  const s = typeof p.text === 'string' ? p.text : ''; if (!s) return fail('ps.type.insertText: missing `text`');
  const n = chars(L.data.text).length;
  let a = n, b = n;
  if (Array.isArray(p.range) && p.range.length === 2){ const x = +p.range[0] || 0, y = p.range[1] == null ? x : +p.range[1]; a = Math.min(x, y, n); b = Math.min(Math.max(x, y), n); }
  else if (isNum(+p.at) && p.at !== null && p.at !== undefined) a = b = clamp(+p.at, 0, n);
  const r = CMD.run('text.edit', {layerId:L.id, replace:{start:a, end:b, text:s}, coalesce:p.coalesce});
  if (r && r.ok === false) return r;
  return {layer:L.id, caret:a + chars(s).length};
});

/* ═══════════ 面板（view_cmds.rs:458 run：type.panels.character／paragraph 一律打开；type_panels_ui.rs:79 menu：字形／样式面板切换） ═══════════ */
const PANEL_KEYS = ['character', 'paragraph', 'glyphs', 'characterStyles', 'paragraphStyles'];
PANEL_KEYS.forEach(k => reg('type.panels.' + k, {params:`{show?:bool（缺＝${k === 'character' || k === 'paragraph' ? '打开' : '切换'}）} 照 type.panels.${k}：${k === 'character' || k === 'paragraph' ? '字符／段落面板（同一组两个分页）' : k === 'glyphs' ? '字形面板' : '字符样式／段落样式面板（同一组两个分页）'} → {visible}`}, p => {
  const want = typeof p.show === 'boolean' ? p.show : null;
  let vis;
  if (k === 'character' || k === 'paragraph'){
    vis = want === null ? true : want;                     // 菜单再点一次不收起（view_cmds.rs:464 type.panels.* 例外）
    Panels.group('char', vis, k === 'paragraph' ? 1 : 0);
  } else if (k === 'glyphs'){
    vis = want === null ? !Panels.isOpen('glyphs') : want; Panels.group('glyphs', vis, 0);
  } else {
    const tab = k === 'paragraphStyles' ? 1 : 0, showing = Panels.isOpen('styles') && Panels.tab.styles === tab;
    vis = want === null ? !showing : want;
    if (vis) Panels.group('styles', true, tab); else if (Panels.tab.styles === tab) Panels.group('styles', false, tab);
  }
  return {visible:vis};
}));

/* ── 字形面板的分类（text/glyphs.rs CATEGORIES／in_category） ── */
const CATEGORIES = ['Entire Font', 'Basic Latin', 'Latin 1', 'Latin Extended-A', 'Latin Extended-B', 'Greek', 'Cyrillic', 'Punctuation', 'Numbers', 'Currency', 'Symbols', 'Math Symbols', 'Arrows', 'Ornaments'];
const CAT_NAMES = {'Entire Font':['完整字體', '整个字体'], 'Basic Latin':['基本拉丁文', '基本拉丁语'], 'Latin 1':['拉丁文 1', '拉丁语 1'], 'Latin Extended-A':['拉丁文延伸-A', '拉丁语扩展-A'],
  'Latin Extended-B':['拉丁文延伸-B', '拉丁语扩展-B'], 'Greek':['希臘文', '希腊语'], 'Cyrillic':['斯拉夫文', '西里尔语'], 'Punctuation':['標點符號', '标点符号'], 'Numbers':['數字', '数字'],
  'Currency':['貨幣', '货币'], 'Symbols':['符號', '符号'], 'Math Symbols':['數學符號', '数学符号'], 'Arrows':['箭頭', '箭头'], 'Ornaments':['裝飾', '装饰']};
function inCategory(c, cat){
  const u = c.codePointAt(0), r = (a, b) => u >= a && u <= b;
  switch (cat){
    case 'Basic Latin': return r(0x20, 0x7E);
    case 'Latin 1': return r(0xA0, 0xFF);
    case 'Latin Extended-A': return r(0x100, 0x17F);
    case 'Latin Extended-B': return r(0x180, 0x24F);
    case 'Greek': return r(0x370, 0x3FF) || r(0x1F00, 0x1FFF);
    case 'Cyrillic': return r(0x400, 0x52F);
    case 'Punctuation': return (/[!-/:-@[-`{-~]/.test(c) && !'$+<=>^`|~'.includes(c)) || [0xA1, 0xA7, 0xAB, 0xB6, 0xB7, 0xBB, 0xBF].includes(u) || r(0x2010, 0x2027) || r(0x2030, 0x205E) || r(0x2E00, 0x2E7F) || r(0x3000, 0x303F);
    case 'Numbers': return /\p{N}/u.test(c) || r(0x2150, 0x218F);
    case 'Currency': return '$¢£¤¥'.includes(c) || r(0x20A0, 0x20CF);
    case 'Symbols': return '©®°¦¨¯´¸™℠№℮^`|~'.includes(c) || r(0x2100, 0x214F) || r(0x2300, 0x23FF) || r(0x2500, 0x25FF);
    case 'Math Symbols': return '+<=>±×÷¬µ¹²³¼½¾'.includes(c) || r(0x2070, 0x209F) || r(0x2200, 0x22FF) || r(0x27C0, 0x27EF) || r(0x2980, 0x2AFF);
    case 'Arrows': return r(0x2190, 0x21FF) || r(0x27F0, 0x27FF) || r(0x2900, 0x297F) || r(0x2B00, 0x2BFF);
    case 'Ornaments': return r(0x2600, 0x27BF) || r(0x1F300, 0x1FAFF) || r(0xE000, 0xF8FF);
  }
  return true;
}
/* 浏览器读不到字型的 cmap ⇒「完整字体」＝各分类码段的联集（私用区与大半表情不列） */
let _glyphPool = null;
function glyphPool(){
  if (_glyphPool) return _glyphPool;
  const R = [[0x20, 0x7E], [0xA0, 0x24F], [0x370, 0x3FF], [0x400, 0x52F], [0x2010, 0x205E], [0x2070, 0x209F], [0x20A0, 0x20CF], [0x2100, 0x218F], [0x2190, 0x21FF],
    [0x2200, 0x22FF], [0x2300, 0x23FF], [0x2500, 0x25FF], [0x2600, 0x27BF], [0x27C0, 0x27FF], [0x2900, 0x297F], [0x2980, 0x2AFF], [0x2B00, 0x2BFF], [0x2E00, 0x2E7F], [0x3000, 0x303F], [0x1F300, 0x1F64F]];
  const out = [];
  R.forEach(([a, b]) => { for (let u = a; u <= b; u++){ const c = String.fromCodePoint(u); if (/[\p{Cc}\p{Cn}\p{Cs}]/u.test(c) || (/\s/.test(c) && c !== ' ') || (u >= 0xFE00 && u <= 0xFE0F)) continue; out.push(c); } });
  return (_glyphPool = out);
}

/* ═══════════ 浮动面板与对话框（DOM 与样式都在本档） ═══════════ */
const CSS = `
.pstype-panel{position:fixed;z-index:9000;width:268px;background:#2b2f36;color:#e6e8eb;border:1px solid #444a54;border-radius:6px;box-shadow:0 10px 30px rgba(0,0,0,.45);font:12px sans-serif;user-select:none}
.pstype-panel .hd{display:flex;align-items:center;gap:2px;padding:0 4px 0 0;background:#323741;border-bottom:1px solid #444a54;border-radius:6px 6px 0 0;cursor:move}
.pstype-panel .tab{padding:6px 10px;color:#9aa1ac;cursor:pointer}
.pstype-panel .tab.on{color:#fff;border-bottom:2px solid #2f7fd8}
.pstype-panel .hd .sp{flex:1}
.pstype-panel .x{cursor:pointer;color:#9aa1ac;padding:2px 6px}
.pstype-panel .bd{padding:8px 10px;max-height:60vh;overflow:auto}
.pstype-panel .row{display:flex;align-items:center;gap:6px;margin:5px 0}
.pstype-panel .row>.lb{min-width:56px;color:#aab0ba}
.pstype-panel input[type=number],.pstype-panel input[type=text],.pstype-panel select{background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:2px 4px;font:12px sans-serif}
.pstype-panel input[type=number]{width:64px}
.pstype-panel input[type=color]{width:34px;height:20px;padding:0;border:1px solid #444a54;background:none}
.pstype-panel button{background:#3a404a;color:#e6e8eb;border:1px solid #555c68;border-radius:3px;padding:2px 7px;cursor:pointer;font:12px sans-serif;min-width:24px}
.pstype-panel button.on{background:#2f7fd8;border-color:#2f7fd8;color:#fff}
.pstype-panel .note{color:#7a8290;font-size:11px;margin:6px 0 2px}
.pstype-panel .fontpick{flex:1;text-align:left;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.pstype-fontlist{position:fixed;z-index:9600;background:#2b2f36;border:1px solid #555c68;border-radius:4px;max-height:320px;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,.5);min-width:240px}
.pstype-fontlist .fi{display:flex;align-items:baseline;gap:10px;padding:3px 10px;cursor:pointer;color:#e6e8eb;font:12px sans-serif}
.pstype-fontlist .fi:hover,.pstype-fontlist .fi.on{background:#2f7fd8;color:#fff}
.pstype-fontlist .fi .nm{min-width:110px}
.pstype-panel .gl{display:grid;gap:0;border-left:1px solid #444a54;border-top:1px solid #444a54;max-height:260px;overflow:auto}
.pstype-panel .gl .gc{display:flex;align-items:center;justify-content:center;border-right:1px solid #444a54;border-bottom:1px solid #444a54;cursor:pointer;overflow:hidden}
.pstype-panel .gl .gc:hover{background:#3a404a}
.pstype-panel .gl .gc.on{background:#2f7fd8;color:#fff}
.pstype-panel .recent{display:flex;gap:2px;min-height:26px;background:#1e2126;border-radius:2px;padding:1px}
.pstype-panel .recent .gc{width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer}
.pstype-panel .sl{border:1px solid #444a54;border-radius:3px;max-height:200px;overflow:auto;background:#1e2126}
.pstype-panel .sl .si{padding:4px 8px;cursor:pointer}
.pstype-panel .sl .si:hover{background:#3a404a}
.pstype-panel .sl .si.on{background:#2f7fd8;color:#fff}
.pstype-dlg{position:fixed;z-index:9999;top:90px;left:50%;transform:translateX(-50%);min-width:320px;background:#2b2f36;color:#e6e8eb;border:1px solid #555c68;border-radius:6px;box-shadow:0 12px 40px rgba(0,0,0,.55);font:12px sans-serif}
.pstype-dlg .hd{padding:8px 12px;font-weight:bold;background:#323741;border-bottom:1px solid #444a54;border-radius:6px 6px 0 0}
.pstype-dlg .bd{padding:10px 12px}
.pstype-dlg .row{display:flex;align-items:center;gap:6px;margin:6px 0}
.pstype-dlg .row>.lb{min-width:96px;color:#aab0ba;text-align:right}
.pstype-dlg input[type=number],.pstype-dlg select{background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:2px 4px;font:12px sans-serif}
.pstype-dlg input[type=number]{width:60px}
.pstype-dlg input[type=range]{flex:1;min-width:120px}
.pstype-dlg .ft{display:flex;gap:8px;justify-content:flex-end;padding:8px 12px;border-top:1px solid #444a54}
.pstype-dlg button{background:#3a404a;color:#e6e8eb;border:1px solid #555c68;border-radius:3px;padding:3px 14px;cursor:pointer;font:12px sans-serif}
.pstype-dlg button.pri{background:#2f7fd8;border-color:#2f7fd8;color:#fff}
`;
function injectCSS(){ if (document.getElementById('pstypeCSS')) return; const s = document.createElement('style'); s.id = 'pstypeCSS'; s.textContent = CSS; document.head.appendChild(s); }
const el = (tag, attrs, html) => { const e = document.createElement(tag); Object.entries(attrs || {}).forEach(([k, v]) => { if (k === 'style') e.style.cssText = v; else if (k in e && k !== 'list') e[k] = v; else e.setAttribute(k, v); }); if (html !== undefined) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[<>&"]/g, c => ({'<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;'}[c]));
function draggable(box, handle){
  handle.addEventListener('mousedown', e => {
    if (e.target.closest('.x,.tab,button,input,select')) return;
    const r = box.getBoundingClientRect(), sx = e.clientX, sy = e.clientY; e.preventDefault();
    const D = box.ownerDocument, W = D.defaultView;   // 面板可能被 DlPanels.mount 放进外层网页（可拖到角色对话框上）
    const mv = ev => { box.style.left = Math.max(Math.min(0, 60 - r.width), Math.min(W.innerWidth - 60, r.left + ev.clientX - sx)) + 'px'; box.style.top = Math.max(0, Math.min(W.innerHeight - 24, r.top + ev.clientY - sy)) + 'px'; box.style.right = 'auto'; box.style.transform = 'none'; };
    const up = () => { D.removeEventListener('mousemove', mv); D.removeEventListener('mouseup', up); };
    D.addEventListener('mousemove', mv); D.addEventListener('mouseup', up);
  });
}
/* 面板操作的目标：编辑中的文字（带 coalesce），否则当前文字层（type_panels_ui.rs:124 target） */
function panelTarget(){ const t = TT(); if (t && t.ed) return {layerId:t.ed.layer, coalesce:t.ed.session}; const L = textOf({}); return L ? {layerId:L.id} : null; }
const peek = (id, p) => CMD.map[id] ? CMD.map[id].run(p || {}) : null;   // 只读的查询不经 CMD.run（免得面板重画里又触发 UI.refresh）
const fontsInfo = () => peek('text.fonts') || {families:['sans-serif', 'serif', 'monospace'], styles:['Regular', 'Bold']};
const run = (id, p) => { let r; try { r = CMD.run(id, p || {}); } catch(e){ console.error(e); r = fail(String(e)); } if (window.UI && UI.draw) UI.draw(); Panels.refresh(); return r; };

const Panels = {
  open:{}, tab:{char:0, glyphs:0, styles:0}, _sig:{}, _boxes:{},
  isOpen(g){ return !!this.open[g]; },
  group(g, vis, tab){
    injectCSS();
    if (tab !== undefined) this.tab[g] = tab;
    this.open[g] = !!vis;
    let box = this._boxes[g];
    if (!vis){ if (box) box.style.display = 'none'; return; }
    if (!box){
      const pos = {char:'right:280px;top:80px', glyphs:'right:560px;top:80px', styles:'right:280px;top:430px'}[g];
      box = el('div', {className:'pstype-panel', id:'pstype-' + g, style:pos});
      box.innerHTML = '<div class="hd"></div><div class="bd"></div>';
      document.body.appendChild(box); this._boxes[g] = box;
      if (window.DlPanels && DlPanels.mount){ box.style.pointerEvents = 'auto'; DlPanels.mount(box, ['pstypeCSS']); }   // 跟视窗面板同一个宿主图层（可能在外层网页）
      draggable(box, box.querySelector('.hd'));
    }
    box.style.display = '';
    this.render(g);
  },
  tabs(g){
    if (g === 'char') return [L3('字元', '字符', 'Character'), L3('段落', '段落', 'Paragraph')];
    if (g === 'glyphs') return [L3('字符', '字形', 'Glyphs')];
    return [L3('字元樣式', '字符样式', 'Character Styles'), L3('段落樣式', '段落样式', 'Paragraph Styles')];
  },
  sig(g){
    const L = Doc.active();
    return JSON.stringify([g, this.tab[g], Lang.cur, Doc.activeId, L && L.kind === 'text' ? L.data : null, state.fontPreviewSize, g === 'styles' ? Doc.typeStyles : 0,
      g === 'glyphs' ? [state.glyphFamily, state.glyphCategory, state.glyphSize, state.glyphRecent, state.glyphSelected] : 0]);
  },
  refresh(force){
    Object.keys(this.open).forEach(g => {
      if (!this.open[g]) return;
      const box = this._boxes[g]; if (!box) return;
      const ae = box.ownerDocument.activeElement;
      if (!force && box.contains(ae) && /INPUT|SELECT/.test(ae.tagName)) return;   // 正在打字就别重画
      if (force || this._sig[g] !== this.sig(g)) this.render(g);
    });
  },
  render(g){
    const box = this._boxes[g]; if (!box) return;
    this._sig[g] = this.sig(g);
    const hd = box.querySelector('.hd'), bd = box.querySelector('.bd');
    hd.innerHTML = this.tabs(g).map((t, i) => `<span class="tab${i === this.tab[g] ? ' on' : ''}" data-tab="${i}">${esc(t)}</span>`).join('') + '<span class="sp"></span><span class="x" title="close">✕</span>';
    hd.querySelectorAll('.tab').forEach(t => t.onclick = () => { this.tab[g] = +t.dataset.tab; this.render(g); });
    hd.querySelector('.x').onclick = () => this.group(g, false);
    bd.innerHTML = '';
    if (g === 'char') (this.tab.char ? this.paragraph : this.character).call(this, bd);
    else if (g === 'glyphs') this.glyphs(bd);
    else this.styles(bd, this.tab.styles === 1);
  },
  row(bd, label){ const r = el('div', {className:'row'}); if (label !== null) r.appendChild(el('span', {className:'lb'}, esc(label))); bd.appendChild(r); return r; },
  noText(bd){ bd.appendChild(el('div', {className:'note'}, esc(L3('選取文字圖層或點進文字後再調整', '选择文字图层或点进文字后再调整', 'Select a type layer or click into text to edit')))); },

  /* 字符面板（type_tool.rs:983 character_panel 的我们有的栏位）：字体（预览按字体预览大小）、样式、字号、颜色、消除锯齿、方向、OpenType 开关 */
  character(bd){
    const tg = panelTarget(), L = tg ? Doc.byId(tg.layerId) : null, d = L ? L.data : null;
    const fonts = fontsInfo();
    const cur = d ? d.font : (TT() ? TT().opt.font : 'sans-serif');
    let r = this.row(bd, L3('字體', '字体', 'Font'));
    const fb = el('button', {className:'fontpick', type:'button'}); fb.dataset.k = 'font'; fb.textContent = cur; fb.style.fontFamily = cur;
    fb.onclick = () => this.fontList(fb, fonts.families, cur, f => { if (tg) run('text.setStyle', Object.assign({font:f}, tg)); else if (TT()) TT().opt.font = f; this.refresh(true); });
    r.appendChild(fb);
    r = this.row(bd, L3('樣式', '样式', 'Style'));
    const st = el('select'); st.dataset.k = 'fontStyle';
    const curSt = d && TT() ? TT().weightToStyle(d.weight) : (TT() ? TT().opt.style : 'Regular');
    st.innerHTML = fonts.styles.map(s => `<option value="${esc(s)}"${s === curSt ? ' selected' : ''}>${esc(Lang.t('ui.fs.' + s) === 'ui.fs.' + s ? s : Lang.t('ui.fs.' + s))}</option>`).join('');
    st.onchange = () => { if (tg) run('text.setStyle', Object.assign({fontStyle:st.value}, tg)); };
    r.appendChild(st);
    r = this.row(bd, L3('大小', '大小', 'Size'));
    const sz = el('input', {type:'number', min:1, max:1296, value:d ? Math.round(d.size * 100) / 100 : (window.ToolState ? ToolState.fontSize : 64)}); sz.dataset.k = 'size';
    sz.onchange = () => { const v = +sz.value; if (v > 0 && tg) run('text.setStyle', Object.assign({size:v}, tg)); };
    r.appendChild(sz); r.appendChild(el('span', {style:'color:#7a8290'}, 'px'));
    const col = el('input', {type:'color', value:d && /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#000000'}); col.dataset.k = 'color';
    col.onchange = () => { if (tg) run('text.setStyle', Object.assign({color:col.value}, tg)); };
    r.appendChild(el('span', {className:'lb', style:'min-width:0;margin-left:8px'}, esc(L3('顏色', '颜色', 'Color')))); r.appendChild(col);
    if (!d){ this.noText(bd); return; }
    r = this.row(bd, L3('消除鋸齒', '消除锯齿', 'Anti-alias'));
    const aa = el('select'); aa.dataset.k = 'antialias';
    const AAN = {none:L3('無', '无', 'None'), sharp:L3('銳利', '锐利', 'Sharp'), crisp:L3('鮮明', '犀利', 'Crisp'), strong:L3('強烈', '浑厚', 'Strong'), smooth:L3('平滑', '平滑', 'Smooth'), windowsLcd:'Windows LCD', windows:'Windows'};
    aa.innerHTML = AA.map(k => `<option value="${k}"${k === aaOf(d) ? ' selected' : ''}>${esc(AAN[k])}</option>`).join('');
    aa.onchange = () => run('ps.type.antiAlias.' + aa.value, {layer:L.id});
    r.appendChild(aa);
    // type_tool.rs:1048 字距（VA，1/1000 em）、:1089 仿粗体（T 钮）
    r = this.row(bd, L3('字距', '字距', 'Tracking'));
    const tr = el('input', {type:'number', min:-1000, max:10000, step:10, value:+d.tracking || 0}); tr.dataset.k = 'tracking';
    tr.onchange = () => { const v = +tr.value; if (isFinite(v)) run('text.setStyle', Object.assign({tracking:v}, tg)); };
    r.appendChild(tr); r.appendChild(el('span', {style:'color:#7a8290'}, '/1000 em'));
    r = this.row(bd, L3('仿粗體／仿斜體', '仿粗体／仿斜体', 'Faux Bold / Italic'));
    const fb2 = el('button', {type:'button', className:d.fauxBold ? 'on' : '', title:L3('仿粗體', '仿粗体', 'Faux Bold')}, '<b>T</b>'); fb2.dataset.k = 'fauxBold';
    fb2.onclick = () => run('text.setStyle', Object.assign({fauxBold:!d.fauxBold}, tg));
    r.appendChild(fb2);
    const fi = el('button', {type:'button', className:d.fauxItalic ? 'on' : '', title:L3('仿斜體', '仿斜体', 'Faux Italic')}, '<i>T</i>'); fi.dataset.k = 'fauxItalic';
    fi.onclick = () => run('text.setStyle', Object.assign({fauxItalic:!d.fauxItalic}, tg));
    r.appendChild(fi);
    r = this.row(bd, L3('方向', '方向', 'Orientation'));
    [['horizontal', L3('水平', '横排', 'Horizontal')], ['vertical', L3('垂直', '竖排', 'Vertical')]].forEach(([o, t]) => {
      const b = el('button', {type:'button', className:(d.orientation === 'vertical') === (o === 'vertical') ? 'on' : ''}, esc(t)); b.dataset.k = 'orientation-' + o;
      b.onclick = () => run('ps.type.orientation.' + o, {layer:L.id}); r.appendChild(b);
    });
    bd.appendChild(el('div', {className:'note'}, 'OpenType'));
    r = this.row(bd, null); r.style.flexWrap = 'wrap';
    const OTG = {standardLigatures:'fi', contextualAlternates:'ct', discretionaryLigatures:'st', swash:'𝒜', oldstyle:'0ld', stylisticAlternates:'aa', titlingAlternates:'T', ornaments:'❦', ordinals:'1ˢᵗ', fractions:'½'};
    Object.entries(OT).forEach(([k, tag]) => {
      const b = el('button', {type:'button', className:featureOn(d, tag) ? 'on' : '', title:k}, esc(OTG[k])); b.dataset.k = 'ot-' + tag;
      b.onclick = () => run('ps.type.openType.' + k, {layer:L.id}); r.appendChild(b);
    });
  },
  /* 字体选单：每项＝字体名＋用该字体写的样例，样例字号＝「字体预览大小」 */
  fontList(anchor, fams, cur, pick){
    const D = anchor.ownerDocument, W = D.defaultView;
    D.querySelectorAll('.pstype-fontlist').forEach(x => x.remove());
    const px = FONT_PREVIEW_PX[state.fontPreviewSize] || 13;
    const box = el('div', {className:'pstype-fontlist'});
    box.innerHTML = fams.map(f => `<div class="fi${f === cur ? ' on' : ''}" data-font="${esc(f)}"><span class="nm">${esc(f)}</span><span class="pv" style="font-family:${esc(f)};font-size:${px}px">${esc(L3('字體樣本', '字体样例', 'Sample'))} Abg</span></div>`).join('');
    const pan = anchor.closest('.pstype-panel'); box.style.pointerEvents = 'auto';
    (D === document || !pan ? D.body : pan.parentNode).appendChild(box);
    const r = anchor.getBoundingClientRect(); box.style.left = r.left + 'px'; box.style.top = (r.bottom + 2) + 'px';
    const br = box.getBoundingClientRect(); if (br.bottom > W.innerHeight - 4) box.style.top = Math.max(4, r.top - br.height - 2) + 'px';
    box.querySelectorAll('.fi').forEach(it => it.onclick = e => { e.stopPropagation(); box.remove(); pick(it.dataset.font); });
    setTimeout(() => D.addEventListener('mousedown', function off(e){ if (!box.contains(e.target)){ box.remove(); D.removeEventListener('mousedown', off, true); } }, true), 0);
  },
  /* 段落面板：对齐（我们的段落属性只有对齐） */
  paragraph(bd){
    const tg = panelTarget(), d = tg ? Doc.byId(tg.layerId).data : null;
    const r = this.row(bd, L3('對齊', '对齐', 'Align'));
    [['left', L3('靠左', '左对齐', 'Left')], ['center', L3('置中', '居中', 'Center')], ['right', L3('靠右', '右对齐', 'Right')]].forEach(([a, t]) => {
      const b = el('button', {type:'button', className:d && (d.align || 'left') === a ? 'on' : '', title:t}, esc(t)); b.dataset.k = 'align-' + a;
      b.onclick = () => { if (tg) run('text.setStyle', Object.assign({align:a}, tg)); else if (TT()) TT().opt.align = a; };
      r.appendChild(b);
    });
    if (!d) this.noText(bd);
  },
  /* 字形面板（type_panels_ui.rs:597） */
  glyphs(bd){
    const L = textOf({}), fam = state.glyphFamily || (L ? L.data.font : (TT() ? TT().opt.font : 'sans-serif'));
    const fonts = fontsInfo().families;
    let r = this.row(bd, L3('字體', '字体', 'Font'));
    const fs = el('select'); fs.dataset.k = 'glyphFamily';
    fs.innerHTML = `<option value="">${esc(L3('跟隨選取的文字', '跟随所选文字', 'Follow selection'))} (${esc(fam)})</option>` + fonts.map(f => `<option${f === state.glyphFamily ? ' selected' : ''}>${esc(f)}</option>`).join('');
    fs.onchange = () => { state.glyphFamily = fs.value; this.render('glyphs'); };
    r.appendChild(fs);
    r = this.row(bd, L3('顯示', '显示', 'Show'));
    const cs = el('select'); cs.dataset.k = 'glyphCategory';
    cs.innerHTML = CATEGORIES.map(c => `<option value="${c}"${c === state.glyphCategory ? ' selected' : ''}>${esc(Lang.cur === 'en' ? c : CAT_NAMES[c][Lang.cur === 'zh-Hans' ? 1 : 0])}</option>`).join('');
    cs.onchange = () => { state.glyphCategory = cs.value; savePrefs(); this.render('glyphs'); };
    r.appendChild(cs);
    bd.appendChild(el('div', {className:'note'}, esc(L3('最近使用過的字符', '最近使用的字形', 'Recently Used'))));
    const rec = el('div', {className:'recent'});
    state.glyphRecent.forEach(g => { const c = el('div', {className:'gc', style:`font-family:${esc(fam)};font-size:16px`, title:'U+' + g.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}, esc(g)); c.dataset.g = g;
      c.onclick = () => this.insertGlyph(g); rec.appendChild(c); });
    bd.appendChild(rec);
    const list = glyphPool().filter(c => inCategory(c, state.glyphCategory));
    const size = clamp(+state.glyphSize || 32, 24, 64), cols = Math.max(1, Math.floor(236 / size));
    const grid = el('div', {className:'gl', style:`grid-template-columns:repeat(${cols},${size}px);margin-top:6px`});
    const frag = document.createDocumentFragment();
    list.forEach(c => {
      const g = el('div', {className:'gc' + (c === state.glyphSelected ? ' on' : ''), style:`height:${size}px;font-family:${esc(fam)};font-size:${Math.round(size * 0.6)}px`, title:'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}, esc(c));
      g.dataset.g = c;
      g.onclick = () => { state.glyphSelected = c; grid.querySelectorAll('.gc.on').forEach(x => x.classList.remove('on')); g.classList.add('on'); foot.firstChild.textContent = `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} · ${list.length} ${L3('個字符', '个字形', 'glyphs')}`; };
      g.ondblclick = () => this.insertGlyph(c);
      frag.appendChild(g);
    });
    grid.appendChild(frag); bd.appendChild(grid);
    const foot = this.row(bd, null);
    foot.appendChild(el('span', {style:'flex:1;color:#7a8290;font-size:11px'}, esc(`${list.length} ${L3('個字符', '个字形', 'glyphs')}`)));
    const sl = el('input', {type:'range', min:24, max:64, value:size, style:'width:90px'}); sl.dataset.k = 'glyphSize';
    sl.onchange = () => { state.glyphSize = +sl.value; savePrefs(); this.render('glyphs'); };
    foot.appendChild(sl);
  },
  /* type_panels_ui.rs:578 insert_glyph：编辑中＝换掉选取；否则插在当前文字层文末；记进最近使用（12 个） */
  insertGlyph(g){
    const t = TT(); let r;
    if (t && t.ed){
      const a = Math.min(t.ed.caret, t.ed.anchor), b = Math.max(t.ed.caret, t.ed.anchor);
      r = run('ps.type.insertText', {layer:t.ed.layer, text:g, range:[a, b], coalesce:t.ed.session});
      if (r && r.caret !== undefined && t.ed){ t.ed.caret = t.ed.anchor = r.caret; }
    } else r = run('ps.type.insertText', {text:g});
    if (!r || r.ok === false){ if (window.UI && UI.status) UI.status(L3('選取文字圖層或點進文字才能插入字符', '选择文字图层或点进文字才能插入字形', 'Select a type layer or click into text to insert glyphs')); return false; }
    state.glyphRecent = [g, ...state.glyphRecent.filter(x => x !== g)].slice(0, 12); state.glyphSelected = g; savePrefs();
    this.refresh(true);
    return true;
  },
  /* 字符样式／段落样式面板（type_panels_ui.rs:213 styles_panel）：点一下＝套用、Alt 点＝套用并清掉覆盖；底下：清除覆盖／重新定义／新建／删除 */
  styles(bd, par){
    const pre = par ? 'ps.type.paragraphStyle.' : 'ps.type.characterStyle.';
    const ls = peek(pre + 'list', {}), cur = ls.current;
    const curId = cur ? (par ? cur.paragraph : cur.character) : null, over = cur ? (par ? cur.paragraphOverride : cur.characterOverride) : false;
    const nm = s => s.id === 0 ? (par ? L3('基本段落', '基本段落', 'Basic Paragraph') : L3('無', '无', 'None')) : s.name;
    const box = el('div', {className:'sl'});
    ls.styles.forEach(s => {
      const it = el('div', {className:'si' + (s.id === curId ? ' on' : '')}, esc(nm(s)) + (s.id === curId && over ? ' +' : ''));
      it.dataset.id = s.id;
      it.onclick = e => run(pre + 'apply', {id:s.id, clearOverrides:e.altKey});
      if (s.id !== 0) it.ondblclick = () => {
        const inp = el('input', {type:'text', value:s.name, style:'width:90%'}); it.innerHTML = ''; it.appendChild(inp); inp.focus(); inp.select();
        const done = ok => { if (ok && inp.value.trim() && inp.value.trim() !== s.name) run(pre + 'rename', {id:s.id, name:inp.value.trim()}); else this.render('styles'); };
        inp.onkeydown = e => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); e.stopPropagation(); };
        inp.onblur = () => done(true);
      };
      box.appendChild(it);
    });
    bd.appendChild(box);
    const r = this.row(bd, null); r.style.justifyContent = 'flex-end';
    const btn = (k, t, f) => { const b = el('button', {type:'button', title:t}, esc(k)); b.dataset.k = t; b.onclick = f; r.appendChild(b); };
    btn('¶×', L3('清除優先', '清除覆盖', 'Clear Override'), () => run(pre + 'clearOverride', {}));
    btn('✓', L3('重新定義樣式', '通过合并覆盖重新定义', 'Redefine Style'), () => run(pre + 'redefine', curId ? {id:curId} : {}));
    btn('+', L3('建立新樣式', '创建新样式', 'Create New Style'), () => run(pre + 'new', {}));
    btn('🗑', L3('刪除樣式', '删除样式', 'Delete Style'), () => { if (curId) run(pre + 'delete', {id:curId}); });
  }
};

/* ── 对话框 ── */
const WARP_NAMES = {none:['無', '无', 'None'], arc:['弧形', '扇形', 'Arc'], arcLower:['下弧形', '下弧', 'Arc Lower'], arcUpper:['上弧形', '上弧', 'Arc Upper'], arch:['拱形', '拱形', 'Arch'],
  bulge:['凸出', '凸起', 'Bulge'], shellLower:['下弧殼形', '贝壳', 'Shell Lower'], shellUpper:['上弧殼形', '花冠', 'Shell Upper'], flag:['旗形', '旗帜', 'Flag'], wave:['波形', '波浪', 'Wave'],
  fish:['魚形', '鱼形', 'Fish'], rise:['上昇', '增加', 'Rise'], fisheye:['魚眼', '鱼眼', 'Fisheye'], inflate:['膨脹', '膨胀', 'Inflate'], squeeze:['擠壓', '挤压', 'Squeeze'], twist:['扭轉', '扭转', 'Twist']};
const wname = k => { const n = WARP_NAMES[k]; return Lang.cur === 'en' ? n[2] : Lang.cur === 'zh-Hans' ? n[1] : n[0]; };
const Dlg = {
  cur:null,
  close(){ if (this.cur){ const c = this.cur; this.cur = null; c.el.remove(); if (c.onClose) c.onClose(); } },
  open(id, title, onOk, onClose){
    this.close(); injectCSS();
    const box = el('div', {className:'pstype-dlg', id});
    box.innerHTML = `<div class="hd">${esc(title)}</div><div class="bd"></div><div class="ft"><button type="button" data-act="cancel">${esc(L3('取消', '取消', 'Cancel'))}</button><button type="button" class="pri" data-act="ok">${esc(L3('確定', '确定', 'OK'))}</button></div>`;
    document.body.appendChild(box);
    this.cur = {el:box, onClose};
    box.querySelector('[data-act=cancel]').onclick = () => this.close();
    box.querySelector('[data-act=ok]').onclick = () => { const c = this.cur; if (c) c.onClose = null; this.close(); onOk(); };
    box.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.stopPropagation(); this.close(); } else if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); box.querySelector('[data-act=ok]').click(); } });
    return box.querySelector('.bd');
  },
  /* 文字变形（view_cmds.rs:830：style／orientation／bend／horizontalDistortion／verticalDistortion）；调值即时预览，取消还原 */
  warp(L){
    const d = L.data, w0 = d.warp ? JSON.parse(JSON.stringify(d.warp)) : null;
    const v = w0 ? {style:w0.style, orientation:w0.horizontal === false ? 'vertical' : 'horizontal', bend:w0.bend, horizontalDistortion:w0.horizontalDistortion, verticalDistortion:w0.verticalDistortion}
                 : {style:'arc', orientation:'horizontal', bend:50, horizontalDistortion:0, verticalDistortion:0};
    const restore = () => { if (w0) d.warp = w0; else delete d.warp; touch(L); if (window.UI) UI.draw(); };
    const bd = this.open('pstypeWarpDlg', L3('彎曲文字', '变形文字', 'Warp Text'), () => { restore(); run('ps.type.warpText', Object.assign({layer:L.id}, this.params())); }, restore);
    this.params = () => Object.assign({}, v);
    const preview = () => { const r = warpFromParams(v); if (r.warp) d.warp = r.warp; else delete d.warp; touch(L); if (window.UI) UI.draw(); sync(); };
    let r = el('div', {className:'row'}); r.innerHTML = `<span class="lb">${esc(L3('樣式', '样式', 'Style'))}</span>`;
    const sel = el('select'); sel.dataset.k = 'style';
    sel.innerHTML = ['none', ...WARP_STYLES].map(k => `<option value="${k}"${k === v.style ? ' selected' : ''}>${esc(wname(k))}</option>`).join('');
    sel.onchange = () => { v.style = sel.value; preview(); };
    r.appendChild(sel); bd.appendChild(r);
    r = el('div', {className:'row'}); r.innerHTML = '<span class="lb"></span>';
    const radios = ['horizontal', 'vertical'].map(o => { const lab = el('label', {}, ` ${esc(o === 'horizontal' ? L3('水平', '水平', 'Horizontal') : L3('垂直', '垂直', 'Vertical'))} `);
      const rb = el('input', {type:'radio', name:'pstypeWarpO', value:o}); rb.checked = v.orientation === o; rb.dataset.k = 'orientation-' + o;
      rb.onchange = () => { if (rb.checked){ v.orientation = o; preview(); } }; lab.prepend(rb); r.appendChild(lab); return rb; });
    bd.appendChild(r);
    const sliders = [['bend', L3('彎曲', '弯曲', 'Bend')], ['horizontalDistortion', L3('水平扭曲', '水平扭曲', 'Horizontal Distortion')], ['verticalDistortion', L3('垂直扭曲', '垂直扭曲', 'Vertical Distortion')]].map(([k, t]) => {
      const row = el('div', {className:'row'}); row.innerHTML = `<span class="lb">${esc(t)}</span>`;
      const rg = el('input', {type:'range', min:-100, max:100, step:1, value:v[k]}), nb = el('input', {type:'number', min:-100, max:100, step:1, value:v[k]});
      rg.dataset.k = k; nb.dataset.k = k;
      rg.oninput = () => { v[k] = +rg.value; nb.value = rg.value; preview(); };
      nb.onchange = () => { v[k] = clamp(+nb.value || 0, -100, 100); rg.value = v[k]; preview(); };
      row.appendChild(rg); row.appendChild(nb); row.appendChild(el('span', {}, '%')); bd.appendChild(row);
      return [rg, nb];
    });
    const sync = () => { const off = v.style === 'none'; radios.forEach(x => x.disabled = off); sliders.forEach(([a, b]) => { a.disabled = b.disabled = off; }); };
    sync(); preview();
  },
  /* 解析缺失字体：每个缺的字体 → 下拉选替换字体（预设＝默认字体） */
  fonts(){
    const missing = missingFonts(), fams = fontsInfo().families;
    const map = {};
    const bd = this.open('pstypeFontsDlg', L3('解決遺失字體', '解析缺失字体', 'Resolve Missing Fonts'), () => run('ps.type.resolveMissingFonts', {map}));
    if (!missing.length){ bd.appendChild(el('div', {}, esc(L3('沒有遺失的字體。', '没有缺失的字体。', 'No fonts are missing.')))); return; }
    missing.forEach(f => {
      map[f] = DEFAULT_FAMILY;
      const r = el('div', {className:'row'}); r.innerHTML = `<span class="lb" style="min-width:140px">${esc(f)} →</span>`;
      const s = el('select'); s.dataset.k = f; s.innerHTML = fams.map(x => `<option${x === DEFAULT_FAMILY ? ' selected' : ''}>${esc(x)}</option>`).join('');
      s.onchange = () => { map[f] = s.value; }; r.appendChild(s); bd.appendChild(r);
    });
  }
};

/* ═══════════ 工作路径叠画（PS 的工作路径在画布上画成细线；离开来源层就不画） ═══════════ */
function drawWorkPath(ctx, s){
  const wp = Doc.workPath; if (!wp || !PsType.workPathShown || Doc.activeId !== wp.layerId) return;
  ctx.save(); ctx.beginPath();
  for (const sp of wp.subpaths){
    const A = sp.anchors; if (!A.length) continue;
    ctx.moveTo(A[0].x * s, A[0].y * s);
    const seg = (p, q) => { if (!p.out && !q.in) ctx.lineTo(q.x * s, q.y * s); else { const c1 = p.out || [p.x, p.y], c2 = q.in || [q.x, q.y]; ctx.bezierCurveTo(c1[0] * s, c1[1] * s, c2[0] * s, c2[1] * s, q.x * s, q.y * s); } };
    for (let i = 1; i < A.length; i++) seg(A[i - 1], A[i]);
    if (sp.closed){ seg(A[A.length - 1], A[0]); ctx.closePath(); }
  }
  ctx.strokeStyle = '#2f7fd8'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
}
const overlay = (ctx, s) => { drawWorkPath(ctx, s); Panels.refresh(); };
function hookUI(){ if (window.UI && Array.isArray(UI.overlays) && !UI.overlays.includes(overlay)) UI.overlays.push(overlay); }
hookUI(); document.addEventListener('DOMContentLoaded', hookUI); window.addEventListener('load', hookUI); setTimeout(hookUI, 0);

/* ═══════════ 菜单勾选（view_cmds.rs:339 checked、:380 type_checked） ═══════════ */
function checked(id){
  if (id.startsWith('type.fontPreviewSize.')) return state.fontPreviewSize === id.slice(21);
  if (id === 'type.languageOptions.middleEasternAndSouthAsianComposer') return !!state.middleEasternComposer;
  if (id.startsWith('type.languageOptions.')) return state.languageFeatures === id.slice(21);
  const L = textOf({}); if (!L) return false;
  if (id.startsWith('type.antiAlias.')) return aaOf(L.data) === id.slice(15);
  if (id.startsWith('type.orientation.')) return (L.data.orientation === 'vertical') === (id.slice(17) === 'vertical');
  if (id.startsWith('type.openType.')) return featureOn(L.data, OT[id.slice(14)]);
  return false;
}

window.PsType = {state, checked, Panels, Dlg, typeDefaults:null, workPathShown:false, LOREM_IPSUM, missingFonts, fontAvailable, inCategory, glyphPool, makeWarp, warpStyleId, featureOn,
  get dlg(){ return Dlg; }};
})();
