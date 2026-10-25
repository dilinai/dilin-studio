/* PSD 读写（Photoshop 2020 的 .psd，8 位 RGB；照 Adobe Photoshop File Formats Specification；原码 photocraft crates/psd 的同一套结构）
   window.PsdIO = {
     encode({width, height, dpi, merged:RGBA, items:[…], psb?}) → Uint8Array（psb:true ⇒ 大型文件 .psb：版本 2、长度栏 8 位元组、RLE 列长 4 位元组）
        items（下→上，组照 PSD：先一个「组结束」记录、再子层、最后组本身）：
        {kind:'layer', name, rgba(全幅 W×H RGBA), opacity 0..1, fillOpacity?, blend, hidden, clipped, mask?:{alpha:Uint8Array W×H, enabled, defaultColor}}
        {kind:'groupEnd'} ／ {kind:'group', name, opacity, blend, hidden, open, mask?}
     async decode(bytes) → {width, height, depth, mode, merged:RGBA|null, records:[…]}
        records（下→上）：{name, rect:[top,left,bottom,right], opacity, fillOpacity, blend, clipped, hidden, section:0 一般／1、2 组（开／合）／3 组结束,
       liveText?（文字层）, shape?（形状图层）, fx?（图层样式·effectFromParams 参数）——见「活图层读回」,
                          rgba:RGBA（rect 大小）| null, mask:{rect, alpha（rect 大小）, defaultColor, enabled} | null, text:bool}
   }
   读：不压缩、PackBits（RLE）、ZIP、ZIP＋预测；8／16／32 位（取高位／转 8 位）；RGB、灰度、CMYK、双色调、索引色（调色盘在色彩模式资料）、点阵（1 位）。
   写：每层 PackBits；图层蒙版（-2 通道）、剪贴、混合模式、组（lsct）、不透明度／填充不透明度（iOpa）、Unicode 名（luni）；
       层上给了 text／fx／shape ⇒ 另写活文字（TySh）、图层样式（lfx2）、形状图层（SoCo／vstk／vmsk）（见下面「活图层」）。 */
(function(){
'use strict';
if (window.PsdIO) return;

/* ── 混合模式 ⇄ PSD 键 ── */
const BLEND_KEYS = {normal:'norm', dissolve:'diss', darken:'dark', multiply:'mul ', colorBurn:'idiv', linearBurn:'lbrn', darkerColor:'dkCl',
  lighten:'lite', screen:'scrn', colorDodge:'div ', linearDodge:'lddg', lighterColor:'lgCl', overlay:'over', softLight:'sLit', hardLight:'hLit',
  vividLight:'vLit', linearLight:'lLit', pinLight:'pLit', hardMix:'hMix', difference:'diff', exclusion:'smud', subtract:'fsub', divide:'fdiv',
  hue:'hue ', saturation:'sat ', color:'colr', luminosity:'lum ', passThrough:'pass'};
const BLEND_OF = {}; Object.keys(BLEND_KEYS).forEach(k => { BLEND_OF[BLEND_KEYS[k]] = k; });

/* ── 写 ── */
class Wr {
  constructor(){ this.parts = []; this.len = 0; this.buf = new Uint8Array(1 << 16); this.n = 0; }
  _need(k){ if (this.n + k > this.buf.length){ this.flush(); if (k > this.buf.length) this.buf = new Uint8Array(k); } }
  flush(){ if (this.n){ this.parts.push(this.buf.slice(0, this.n)); this.len += this.n; this.n = 0; } }
  u8(v){ this._need(1); this.buf[this.n++] = v & 255; return this; }
  u16(v){ this._need(2); this.buf[this.n++] = (v >> 8) & 255; this.buf[this.n++] = v & 255; return this; }
  i16(v){ return this.u16(v & 0xffff); }
  u32(v){ this._need(4); this.buf[this.n++] = (v >>> 24) & 255; this.buf[this.n++] = (v >>> 16) & 255; this.buf[this.n++] = (v >>> 8) & 255; this.buf[this.n++] = v & 255; return this; }
  u64(v){ return this.u32(Math.floor(v / 4294967296)).u32(v >>> 0); }
  i32(v){ return this.u32(v >>> 0); }
  latin(s){ for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); return this; }
  raw(a){ this.flush(); if (a.length){ this.parts.push(a); this.len += a.length; } return this; }
  size(){ return this.len + this.n; }
  bytes(){ this.flush(); const out = new Uint8Array(this.len); let o = 0; for (const p of this.parts){ out.set(p, o); o += p.length; } return out; }
}
/* PackBits 一列 */
function packRow(src, off, n, out){
  let i = 0;
  while (i < n){
    let j = i + 1;
    while (j < n && j - i < 128 && src[off + j] === src[off + i]) j++;
    if (j - i >= 3){ out.push(257 - (j - i), src[off + i]); i = j; continue; }
    let k = i;                                                             // 字面段：碰到 3 个以上重复才停
    while (k < n && k - i < 128 && !(k + 2 < n && src[off + k] === src[off + k + 1] && src[off + k] === src[off + k + 2])) k++;
    if (k === i) k = Math.min(i + 1, n);
    out.push(k - i - 1); for (let q = i; q < k; q++) out.push(src[off + q]);
    i = k;
  }
}
/* 一个平面（w×h）→ RLE：[u16 压缩=1][每列长度 u16…][资料]；withHeader=false 给合成图（压缩码整个档只写一次） */
function rlePlane(plane, w, h, withHeader, big){
  const rows = [], counts = new Array(h), cb = big ? 4 : 2;                    // big＝PSB：每列长度 4 位元组
  for (let y = 0; y < h; y++){ const o = []; packRow(plane, y * w, w, o); counts[y] = o.length; rows.push(o); }
  let total = (withHeader ? 2 : 0) + h * cb; for (const r of rows) total += r.length;
  const out = new Uint8Array(total); let p = 0;
  if (withHeader){ out[p++] = 0; out[p++] = 1; }
  for (let y = 0; y < h; y++){ if (big){ out[p++] = counts[y] >>> 24; out[p++] = (counts[y] >> 16) & 255; } out[p++] = (counts[y] >> 8) & 255; out[p++] = counts[y] & 255; }
  for (const r of rows){ for (let i = 0; i < r.length; i++) out[p++] = r[i]; }
  return {data:out, counts};
}
function bboxOf(rgba, W, H){
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++){ const r = y * W; for (let x = 0; x < W; x++) if (rgba[(r + x) * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  return x1 < 0 ? null : [y0, x0, y1 + 1, x1 + 1];
}
function bboxNot(a, W, H, bg){
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++){ const r = y * W; for (let x = 0; x < W; x++) if (a[r + x] !== bg){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  return x1 < 0 ? null : [y0, x0, y1 + 1, x1 + 1];
}
const pad4 = n => (4 - n % 4) % 4;
function pascal(s, mult){
  const a = unescape(encodeURIComponent(String(s || ''))).slice(0, 255);
  const n = 1 + a.length, t = n + ((mult - n % mult) % mult), out = new Uint8Array(t);
  out[0] = a.length; for (let i = 0; i < a.length; i++) out[i + 1] = a.charCodeAt(i);
  return out;
}
function addInfo(w, key, body){ w.latin('8BIM').latin(key).u32(body.length + pad4(body.length)).raw(body); for (let i = 0; i < pad4(body.length); i++) w.u8(0); }

/* ── 活图层（Photoshop 打开还能改）：描述子、文字（TySh＋EngineData）、图层样式（lfx2）、形状图层（SoCo／vstk／vmsk）──
   层上多给的栏位（psdEncodeDoc 照引擎图层算好；没给＝跟以前一样只有像素）：
     text:{text, font（PostScript 名）, size, color:[r,g,b]（0..255）, just:0 左／1 右／2 中, x, y（点文字＝基线起点、段落文字＝框左上，文件坐标）, leading（行距·0＝自动）, leadingType（0 底到底／1 上到上）,
           autoLeading?（自动行距的比例：给了就写自动行距，leading 只当算好的值）, box?:{w, h}（段落文字的框）, fauxBold, fauxItalic, tracking,
           transform?:[a,b,c,d,tx,ty]（旋转／斜切等：TySh 的仿射，tx／ty＝变形后的 x／y；没给＝[1,0,0,1,x,y]）,
           bounds?:[l,t,r,b]（排版框）, boundingBox?:[l,t,r,b]（字墨框）：相对 TySh 原点、未经仿射；没给就不写这两栏}
     fx:[{kind:'dropShadow'|'innerShadow'|'outerGlow'|'innerGlow'|'stroke'|'colorOverlay', enabled, blend, color:[r,g,b], opacity 0..100, angle, distance, spread, choke, size, range, source, position}]
     shape:{fill:[r,g,b]|null, stroke:{color:[r,g,b], width, align?:'inside'|'center'|'outside', cap?:'butt'|'round'|'square', join?:'miter'|'round'|'bevel', dash?:[像素…]}|null, evenOdd, paths:[{closed, knots:[{pre:[x,y], a:[x,y], post:[x,y]}]}]}（文件坐标）
   像素照样写（文字、形状层的像素是没加样式的本体）：旧软件、缩图照画面显示，Photoshop 改了才重排。
   文件级的 Txt2（文字引擎的全局资料：排好的字形、各文字层的模型，TySh 的 TextIndex 指向这里）不写；
   缺这份时 Photoshop 开档会提示更新文字层（按 EngineData 重排）。
   EngineData 的结构与禁则字串参照 ag-psd（MIT·https://github.com/Agamnentzar/ag-psd）。 */
const f64w = (w, v) => { const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, +v || 0); for (let i = 0; i < 8; i++) w.u8(d.getUint8(i)); return w; };
function dKey(w, k){ if (k.length === 4) w.u32(0).latin(k); else w.u32(k.length).latin(k); }
function dUni(w, s){ s = String(s); w.u32(s.length + 1); for (let i = 0; i < s.length; i++) w.u16(s.charCodeAt(i)); w.u16(0); }
const D = {
  text:v => ({t:'TEXT', v}), long:v => ({t:'long', v}), doub:v => ({t:'doub', v}), bool:v => ({t:'bool', v}),
  unit:(u, v) => ({t:'UntF', u, v}), en:(type, v) => ({t:'enum', type, v}), obj:(cls, items) => ({t:'Objc', cls, items}),
  list:v => ({t:'VlLs', v}), raw:v => ({t:'tdta', v}),
};
function dItems(w, cls, items){ dUni(w, ''); dKey(w, cls); const ks = Object.keys(items); w.u32(ks.length); for (const k of ks){ dKey(w, k); dVal(w, items[k]); } }
function dVal(w, x){
  w.latin(x.t);
  if (x.t === 'TEXT') dUni(w, x.v);
  else if (x.t === 'long') w.i32(x.v | 0);
  else if (x.t === 'doub') f64w(w, x.v);
  else if (x.t === 'bool') w.u8(x.v ? 1 : 0);
  else if (x.t === 'UntF'){ w.latin(x.u); f64w(w, x.v); }
  else if (x.t === 'enum'){ dKey(w, x.type); dKey(w, x.v); }
  else if (x.t === 'Objc') dItems(w, x.cls, x.items);
  else if (x.t === 'VlLs'){ w.u32(x.v.length); for (const e of x.v) dVal(w, e); }
  else if (x.t === 'tdta'){ w.u32(x.v.length).raw(x.v); }
}
const dDesc = (cls, items) => { const w = new Wr(); w.u32(16); dItems(w, cls, items); return w.bytes(); };
const rgbObj = c => D.obj('RGBC', {'Rd  ':D.doub(c[0]), 'Grn ':D.doub(c[1]), 'Bl  ':D.doub(c[2])});

/* EngineData（文字引擎的 PDF 式字典）：字串一律 UTF-16BE 加 BOM，( ) \ 转义 */
const KINSOKU = [
  ['PhotoshopKinsokuHard', '、。，．・：；？！ー―’”）〕］｝〉》」』】ヽヾゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ゛゜?!)]},.:;℃℉¢％‰', '‘“（〔［｛〈《「『【([{￥＄£＠§〒＃', '―‥', '、。.,'],
  ['PhotoshopKinsokuSoft', '、。，．・：；？！’”）〕］｝〉》」』】ヽヾゝゞ々', '‘“（〔［｛〈《「『【', '―‥', '、。.,'],
];
function engineData(t){
  const parts = [], A = s => parts.push(s);
  const S = s => { let o = '(þÿ'; s = String(s); for (let i = 0; i < s.length; i++){ const c = s.charCodeAt(i); for (const b of [c >> 8, c & 255]) o += (b === 0x28 || b === 0x29 || b === 0x5c ? '\\' : '') + String.fromCharCode(b); } return o + ')'; };
  const N = v => { v = +v || 0; return Number.isInteger(v) ? v + '.0' : String(+v.toFixed(4)); };
  const col = c => `<< /Type 1 /Values [ 1.0 ${N(c[0] / 255)} ${N(c[1] / 255)} ${N(c[2] / 255)} ] >>`;
  const txt = String(t.text).replace(/\r?\n/g, '\r') + '\r', n = txt.length;
  // 每段（到 \r 为止，含 \r 本身）一个 ParagraphRun，段长加起来＝字数
  const paras = txt.split('\r').slice(0, -1).map(p => p.length + 1);
  const para = (j, lt, al) => `<< /Justification ${j} /FirstLineIndent 0.0 /StartIndent 0.0 /EndIndent 0.0 /SpaceBefore 0.0 /SpaceAfter 0.0 /AutoHyphenate true /HyphenatedWordSize 6 /PreHyphen 2 /PostHyphen 2 /ConsecutiveHyphens 8 /Zone 36.0 /WordSpacing [ .8 1.0 1.33 ] /LetterSpacing [ 0.0 0.0 0.0 ] /GlyphSpacing [ 1.0 1.0 1.0 ] /AutoLeading ${N(+al > 0 ? al : 1.2)} /LeadingType ${lt === 1 ? 1 : 0} /Hanging false /Burasagari false /KinsokuOrder 0 /EveryLineComposer false >>`;
  // 自动行距（没给 leading，或给了 autoLeading 比例）：AutoLeading true，Leading 只是算好的值；给了 leading 没给比例 ⇒ 固定行距
  const style = (size, fill, extra) => `<< /Font 1 /FontSize ${N(size)} /FauxBold ${!!extra.fauxBold} /FauxItalic ${!!extra.fauxItalic} /AutoLeading ${extra.leading && !(+extra.autoLeading > 0) ? 'false' : 'true'} /Leading ${N(extra.leading || 0)} /HorizontalScale 1.0 /VerticalScale 1.0 /Tracking ${Math.round(extra.tracking || 0)} /AutoKerning true /Kerning 0 /BaselineShift 0.0 /FontCaps 0 /FontBaseline 0 /Underline false /Strikethrough false /Ligatures true /DLigatures false /BaselineDirection 2 /Tsume 0.0 /StyleRunAlignment 2 /Language 0 /NoBreak false /FillColor ${col(fill)} /StrokeColor ${col([0, 0, 0])} /FillFlag true /StrokeFlag false /FillFirst true /YUnderline 1 /OutlineWidth 1.0 /CharacterDirection 0 /HindiNumbers false /Kashida 1 /DiacriticPos 2 >>`;
  const res = () => {
    A('<< /KinsokuSet [ '); for (const k of KINSOKU) A(`<< /Name ${S(k[0])} /NoStart ${S(k[1])} /NoEnd ${S(k[2])} /Keep ${S(k[3])} /Hanging ${S(k[4])} >> `); A(']\n');
    A('/MojiKumiSet [ '); for (let i = 1; i <= 4; i++) A(`<< /InternalName ${S('Photoshop6MojiKumiSet' + i)} >> `); A(']\n');
    A(`/TheNormalStyleSheet 0 /TheNormalParagraphSheet 0\n/ParagraphSheetSet [ << /Name ${S('Normal RGB')} /DefaultStyleSheet 0 /Properties ${para(0)} >> ]\n`);
    A(`/StyleSheetSet [ << /Name ${S('Normal RGB')} /StyleSheetData ${style(12, [0, 0, 0], {})} >> ]\n`);
    A(`/FontSet [ << /Name ${S('AdobeInvisFont')} /Script 0 /FontType 0 /Synthetic 0 >> << /Name ${S(t.font)} /Script 0 /FontType 0 /Synthetic 0 >> ]\n`);
    A('/SuperscriptSize .583 /SuperscriptPosition .333 /SubscriptSize .583 /SubscriptPosition .333 /SmallCapSize .7 >>\n');
  };
  A(`\n\n<<\n/EngineDict\n<<\n/Editor << /Text ${S(txt)} >>\n`);
  A(`/ParagraphRun << /DefaultRunData << /ParagraphSheet << /DefaultStyleSheet 0 /Properties << >> >> /Adjustments << /Axis [ 1.0 0.0 1.0 ] /XY [ 0.0 0.0 ] >> >> /RunArray [ ${paras.map(() => `<< /ParagraphSheet << /DefaultStyleSheet 0 /Properties ${para(t.just | 0, t.leadingType, t.autoLeading)} >> /Adjustments << /Axis [ 1.0 0.0 1.0 ] /XY [ 0.0 0.0 ] >> >>`).join(' ')} ] /RunLengthArray [ ${paras.join(' ')} ] /IsJoinable 1 >>\n`);
  A(`/StyleRun << /DefaultRunData << /StyleSheet << /StyleSheetData << >> >> >> /RunArray [ << /StyleSheet << /StyleSheetData ${style(t.size, t.color, t)} >> >> ] /RunLengthArray [ ${n} ] /IsJoinable 2 >>\n`);
  A(`/GridInfo << /GridIsOn false /ShowGrid false /GridSize 18.0 /GridLeading 22.0 /GridColor ${col([0, 0, 255])} /GridLeadingFillColor ${col([0, 0, 255])} /AlignLineHeightToGridFlags false >>\n`);
  A('/AntiAlias 4\n/UseFractionalGlyphWidths true\n');
  // 点文字 ShapeType 0（PointBase）；段落文字 ShapeType 1，BoxBounds 是框的左上右下（相对 TySh 仿射的原点＝框左上）
  const box = t.box && t.box.w > 0 && t.box.h > 0 ? t.box : null, sh = box ? 1 : 0;
  const cookie = box ? `/BoxBounds [ 0.0 0.0 ${N(box.w)} ${N(box.h)} ]` : '/PointBase [ 0.0 0.0 ]';
  A(`/Rendered << /Version 1 /Shapes << /WritingDirection 0 /Children [ << /ShapeType ${sh} /Procession 0 /Lines << /WritingDirection 0 /Children [ ] >> /Cookie << /Photoshop << /ShapeType ${sh} ${cookie} /Base << /ShapeType ${sh} /TransformPoint0 [ 1.0 0.0 ] /TransformPoint1 [ 0.0 1.0 ] /TransformPoint2 [ 0.0 0.0 ] >> >> >> >> ] >> >>\n>>\n`);
  A('/ResourceDict\n'); res();
  A('/DocumentResources\n'); res();
  A('>>');
  const s = parts.join(''), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;   // 全是 0..255（字串已拆成位元组）
  return u;
}
const ltrb = (cls, b) => D.obj(cls, {Left:D.unit('#Pnt', b[0]), 'Top ':D.unit('#Pnt', b[1]), Rght:D.unit('#Pnt', b[2]), Btom:D.unit('#Pnt', b[3])});
const okBox = b => Array.isArray(b) && b.length === 4 && b.every(v => isFinite(v)) && b[2] > b[0] && b[3] > b[1];
/* index＝TextIndex（文件里文字层由上往下 0、1、2…） */
function tyShBlock(t, index){
  const w = new Wr().u16(1);
  const T = Array.isArray(t.transform) && t.transform.length === 6 && t.transform.every(v => isFinite(v)) ? t.transform : [1, 0, 0, 1, t.x, t.y];
  for (const v of T) f64w(w, v);
  w.u16(50).u32(16);
  dItems(w, 'TxLr', {
    'Txt ':D.text(String(t.text).replace(/\r?\n/g, '\r')),
    textGridding:D.en('textGridding', 'None'), Ornt:D.en('Ornt', 'Hrzn'), AntA:D.en('Annt', 'AnSm'),
    ...(okBox(t.bounds) ? {bounds:ltrb('bounds', t.bounds)} : {}), ...(okBox(t.boundingBox) ? {boundingBox:ltrb('boundingBox', t.boundingBox)} : {}),
    TextIndex:D.long(index | 0), EngineData:D.raw(engineData(t)),
  });
  w.u16(1).u32(16);
  dItems(w, 'warp', {warpStyle:D.en('warpStyle', 'warpNone'), warpValue:D.doub(0), warpPerspective:D.doub(0), warpPerspectiveOther:D.doub(0), warpRotate:D.en('Ornt', 'Hrzn')});
  w.u32(0).u32(0).u32(0).u32(0);
  return w.bytes();
}
/* 图层样式（描述子里的混合模式是 BlnM 列举，跟层记录的四字键不同） */
const FX_BLEND = {normal:'Nrml', dissolve:'Dslv', darken:'Drkn', multiply:'Mltp', colorBurn:'CBrn', linearBurn:'linearBurn', darkerColor:'darkerColor',
  lighten:'Lghn', screen:'Scrn', colorDodge:'CDdg', linearDodge:'linearDodge', lighterColor:'lighterColor', overlay:'Ovrl', softLight:'SftL', hardLight:'HrdL',
  vividLight:'vividLight', linearLight:'linearLight', pinLight:'pinLight', hardMix:'hardMix', difference:'Dfrn', exclusion:'Xclu', subtract:'blendSubtraction',
  divide:'blendDivide', hue:'H   ', saturation:'Strt', color:'Clr ', luminosity:'Lmns'};
const FX_KEY = {dropShadow:'DrSh', innerShadow:'IrSh', outerGlow:'OrGl', innerGlow:'IrGl', stroke:'FrFX', colorOverlay:'SoFi'};
const linearCurve = () => D.obj('ShpC', {'Nm  ':D.text('Linear'), 'Crv ':D.list([D.obj('CrPt', {Hrzn:D.doub(0), Vrtc:D.doub(0)}), D.obj('CrPt', {Hrzn:D.doub(255), Vrtc:D.doub(255)})])});
function lfx2Block(fx){
  const items = {'Scl ':D.unit('#Prc', 100), masterFXSwitch:D.bool(true)};
  for (const e of fx){
    const base = {enab:D.bool(e.enabled !== false), 'Md  ':D.en('BlnM', FX_BLEND[e.blend] || 'Nrml'), 'Clr ':rgbObj(e.color || [0, 0, 0]), Opct:D.unit('#Prc', e.opacity === undefined ? 100 : +e.opacity)};
    let d;
    if (e.kind === 'dropShadow' || e.kind === 'innerShadow') d = Object.assign(base, {uglg:D.bool(false), lagl:D.unit('#Ang', +e.angle || 0), Dstn:D.unit('#Pxl', +e.distance || 0),
      Ckmt:D.unit('#Pxl', +(e.kind === 'dropShadow' ? e.spread : e.choke) || 0), blur:D.unit('#Pxl', +e.size || 0), Nose:D.unit('#Prc', 0), AntA:D.bool(false), TrnS:linearCurve()},
      e.kind === 'dropShadow' ? {layerConceals:D.bool(e.knocksOut !== false)} : {});
    else if (e.kind === 'outerGlow' || e.kind === 'innerGlow') d = Object.assign(base, {GlwT:D.en('BETE', e.technique === 'precise' ? 'PrBL' : 'SfBL'), Ckmt:D.unit('#Pxl', +(e.kind === 'outerGlow' ? e.spread : e.choke) || 0),
      blur:D.unit('#Pxl', +e.size || 0), Nose:D.unit('#Prc', 0), ShdN:D.unit('#Prc', 0), AntA:D.bool(false), TrnS:linearCurve(), Inpr:D.unit('#Prc', e.range === undefined ? 50 : +e.range)},
      e.kind === 'innerGlow' ? {glwS:D.en('IGSr', e.source === 'center' ? 'SrcC' : 'SrcE')} : {});
    else if (e.kind === 'stroke') d = {enab:base.enab, Styl:D.en('FStl', e.position === 'inside' ? 'InsF' : e.position === 'center' ? 'CtrF' : 'OutF'), PntT:D.en('FrFl', 'SClr'),
      'Md  ':base['Md  '], Opct:base.Opct, 'Sz  ':D.unit('#Pxl', +e.size || 0), 'Clr ':base['Clr ']};
    else if (e.kind === 'colorOverlay') d = base;
    else continue;
    items[FX_KEY[e.kind]] = D.obj(FX_KEY[e.kind], d);
  }
  const w = new Wr().u32(0); w.raw(dDesc('null', items)); return w.bytes();
}
/* 形状图层：SoCo 填色＋vstk 描边＋vmsk 路径（8.24 定点，相对文件宽高） */
function soCoBlock(c){ return dDesc('null', {'Clr ':rgbObj(c)}); }
/* 描边的对齐、端点、转角：没给 ⇒ 居中、圆端点、圆转角；虚线：像素 ⇒ 以描边宽为单位（读回 readVstk 再乘回） */
const VSTK_ALIGN_KEY = {inside:'strokeStyleAlignInside', center:'strokeStyleAlignCenter', outside:'strokeStyleAlignOutside'};
const VSTK_CAP_KEY = {butt:'strokeStyleButtCap', round:'strokeStyleRoundCap', square:'strokeStyleSquareCap', projecting:'strokeStyleSquareCap'};
const VSTK_JOIN_KEY = {miter:'strokeStyleMiterJoin', round:'strokeStyleRoundJoin', bevel:'strokeStyleBevelJoin'};
function vstkBlock(s){
  const k = s.stroke || {}, width = s.stroke ? +s.stroke.width || 1 : 1;
  const dash = Array.isArray(k.dash) && k.dash.some(v => +v > 0) ? k.dash.map(v => D.unit('#Nne', Math.max(0, +v || 0) / width)) : [];
  return dDesc('strokeStyle', {
    strokeStyleVersion:D.long(2), strokeEnabled:D.bool(!!s.stroke), fillEnabled:D.bool(!!s.fill),
    strokeStyleLineWidth:D.unit('#Pxl', width), strokeStyleLineDashOffset:D.unit('#Pnt', 0), strokeStyleMiterLimit:D.doub(100),
    strokeStyleLineCapType:D.en('strokeStyleLineCapType', VSTK_CAP_KEY[k.cap] || 'strokeStyleRoundCap'), strokeStyleLineJoinType:D.en('strokeStyleLineJoinType', VSTK_JOIN_KEY[k.join] || 'strokeStyleRoundJoin'),
    strokeStyleLineAlignment:D.en('strokeStyleLineAlignment', VSTK_ALIGN_KEY[k.align] || 'strokeStyleAlignCenter'), strokeStyleScaleLock:D.bool(false), strokeStyleStrokeAdjust:D.bool(false),
    strokeStyleLineDashSet:D.list(dash), strokeStyleBlendMode:D.en('BlnM', 'Nrml'), strokeStyleOpacity:D.unit('#Prc', 100),
    strokeStyleContent:D.obj('solidColorLayer', {'Clr ':rgbObj(s.stroke ? s.stroke.color : [0, 0, 0])}), strokeStyleResolution:D.doub(72),
  });
}
function vmskBlock(s, W, H){
  const w = new Wr().u32(3).u32(0);
  const fx = v => w.i32(Math.round(v * 16777216));
  const pt = (p) => { fx(p[1] / H); fx(p[0] / W); };
  w.u16(6); for (let i = 0; i < 24; i++) w.u8(0);
  w.u16(8).u16(0); for (let i = 0; i < 22; i++) w.u8(0);
  for (const p of s.paths){
    w.u16(p.closed ? 0 : 3).u16(p.knots.length).u16(1).u16(s.evenOdd ? 1 : 2); for (let i = 0; i < 18; i++) w.u8(0);
    for (const k of p.knots){ w.u16(p.closed ? 2 : 5); pt(k.pre); pt(k.a); pt(k.post); }
  }
  return w.bytes();
}

function encode(o){
  const W = o.width | 0, H = o.height | 0, N = W * H, items = o.items || [], big = !!o.psb;
  const out = new Wr(), len8 = (w, v) => (big ? w.u64(v) : w.u32(v));
  out.latin('8BPS').u16(big ? 2 : 1).u32(0).u16(0).u16(4).u32(H).u32(W).u16(8).u16(3);
  out.u32(0);                                                                  // 色彩模式资料
  const res = new Wr(), dpi = Math.max(1, +o.dpi || 72);
  res.latin('8BIM').u16(0x03ED).u16(0).u32(16).u32(Math.round(dpi * 65536)).u16(1).u16(1).u32(Math.round(dpi * 65536)).u16(1).u16(1);
  const rb = res.bytes(); out.u32(rb.length).raw(rb);
  // 图层与蒙版
  const recs = new Wr(), chans = [];
  let textLeft = items.filter(it => it.kind !== 'groupEnd' && it.kind !== 'group' && it.text).length;   // TextIndex 由最上层的文字层数起
  for (const it of items){
    const isEnd = it.kind === 'groupEnd', isGroup = it.kind === 'group';
    let rect = [0, 0, 0, 0], planes = [];
    if (!isEnd && !isGroup && it.rgba){
      const bb = bboxOf(it.rgba, W, H);
      if (bb){
        rect = bb; const bw = bb[3] - bb[1], bh = bb[2] - bb[0];
        for (const ch of [3, 0, 1, 2]){ const p = new Uint8Array(bw * bh); for (let y = 0; y < bh; y++){ const s = ((bb[0] + y) * W + bb[1]) * 4 + ch, d = y * bw; for (let x = 0; x < bw; x++) p[d + x] = it.rgba[s + x * 4]; } planes.push(p); }
      }
    }
    const bw = rect[3] - rect[1], bh = rect[2] - rect[0];
    const chList = [];
    [-1, 0, 1, 2].forEach((id, k) => { const r = planes.length ? rlePlane(planes[k], bw, bh, true, big) : {data:new Uint8Array([0, 0])}; chList.push([id, r.data]); });
    // 蒙版
    let mrect = null, mdef = 255, menabled = true;
    if (it.mask && it.mask.alpha){
      mdef = it.mask.defaultColor === 0 ? 0 : 255; menabled = it.mask.enabled !== false;
      mrect = bboxNot(it.mask.alpha, W, H, mdef) || [0, 0, 0, 0];
      const mw = mrect[3] - mrect[1], mh = mrect[2] - mrect[0], p = new Uint8Array(Math.max(0, mw * mh));
      for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) p[y * mw + x] = it.mask.alpha[(mrect[0] + y) * W + mrect[1] + x];
      chList.push([-2, mw * mh ? rlePlane(p, mw, mh, true, big).data : new Uint8Array([0, 0])]);
    }
    recs.i32(rect[0]).i32(rect[1]).i32(rect[2]).i32(rect[3]).u16(chList.length);
    for (const [id, d] of chList){ recs.i16(id); len8(recs, d.length); }
    const blend = isEnd ? 'norm' : (BLEND_KEYS[it.blend] || 'norm');
    let flags = 0x08; if (it.hidden) flags |= 0x02; if (isEnd || isGroup || it.shape) flags |= 0x10;   // 形状图层：像素由路径重画（Photoshop 才当形状图层）
    recs.latin('8BIM').latin(blend).u8(Math.round(Math.max(0, Math.min(1, isEnd ? 1 : (it.opacity === undefined ? 1 : it.opacity))) * 255)).u8(it.clipped ? 1 : 0).u8(flags).u8(0);
    const ex = new Wr();
    if (mrect){ ex.u32(20).i32(mrect[0]).i32(mrect[1]).i32(mrect[2]).i32(mrect[3]).u8(mdef).u8(menabled ? 0 : 0x02).u16(0); }
    else ex.u32(0);
    const bi = it.blendIf && Array.isArray(it.blendIf.ranges) && it.blendIf.ranges.length ? it.blendIf.ranges : null;   // 混合颜色带：灰＋各色版，[本图层, 下一图层]×[黑低, 黑高, 白低, 白高]
    if (bi){ ex.u32(32); for (let c = 0; c < 4; c++){ const pr = bi[c] || [null, null]; for (const r of pr){ const q = r || {black:[0, 0], white:[255, 255]}; ex.u8(q.black[0]).u8(q.black[1]).u8(q.white[0]).u8(q.white[1]); } } }
    else ex.u32(0);
    const nm = isEnd ? '</Layer group>' : String(it.name || 'Layer');
    ex.raw(pascal(nm, 4));
    { const u = new Wr().u32(nm.length); for (let i = 0; i < nm.length; i++) u.u16(nm.charCodeAt(i)); addInfo(ex, 'luni', u.bytes()); }
    if (isEnd) addInfo(ex, 'lsct', new Wr().u32(3).bytes());
    if (isGroup) addInfo(ex, 'lsct', new Wr().u32(it.open === false ? 2 : 1).latin('8BIM').latin(BLEND_KEYS[it.blend] || 'pass').bytes());
    if (!isEnd && it.fillOpacity !== undefined && it.fillOpacity !== null && it.fillOpacity < 1) addInfo(ex, 'iOpa', new Uint8Array([Math.round(Math.max(0, Math.min(1, it.fillOpacity)) * 255), 0, 0, 0]));
    if (!isEnd && it.fx && it.fx.length) addInfo(ex, 'lfx2', lfx2Block(it.fx));
    if (!isEnd && !isGroup && it.text) addInfo(ex, 'TySh', tyShBlock(it.text, --textLeft));
    if (!isEnd && !isGroup && it.shape){
      addInfo(ex, 'SoCo', soCoBlock(it.shape.fill || (it.shape.stroke ? it.shape.stroke.color : [0, 0, 0])));
      if (it.shape.stroke || !it.shape.fill) addInfo(ex, 'vstk', vstkBlock(it.shape));
      addInfo(ex, 'vmsk', vmskBlock(it.shape, W, H));
    }
    const eb = ex.bytes(); recs.u32(eb.length).raw(eb);
    chans.push(chList);
  }
  let layerInfo = new Uint8Array(0);
  if (items.length){
    const li = new Wr(); li.i16(-items.length);                               // 负数＝合成图的第一个 alpha 是透明度
    li.raw(recs.bytes());
    for (const cl of chans) for (const [, d] of cl) li.raw(d);
    layerInfo = li.bytes(); if (layerInfo.length % 2){ const t = new Uint8Array(layerInfo.length + 1); t.set(layerInfo); layerInfo = t; }
  }
  const lm = new Wr(); len8(lm, layerInfo.length); lm.raw(layerInfo).u32(0);
  const lmb = lm.bytes(); len8(out, lmb.length); out.raw(lmb);
  // 合成图：RLE，R G B A
  out.u16(1);
  const m = o.merged, planesM = [0, 1, 2, 3].map(ch => { const p = new Uint8Array(N); for (let i = 0; i < N; i++) p[i] = m[i * 4 + ch]; return p; });
  const encs = planesM.map(p => rlePlane(p, W, H, false, big));
  for (const e of encs) for (let y = 0; y < H; y++) (big ? out.u32(e.counts[y]) : out.u16(e.counts[y]));
  for (const e of encs) out.raw(e.data.subarray(H * (big ? 4 : 2)));
  return out.bytes();
}

/* ── 读 ── */
class Bad extends Error {}
async function inflate(u8){
  if (typeof DecompressionStream === 'undefined') throw new Bad('this browser cannot read ZIP-compressed PSD data');
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
/* 一个通道的资料 → 8 位平面（w×h）；返回读完后的位置 */
async function readChannel(u8, d, o, end, w, h, depth, ver, compOverride){
  const bps = depth === 1 ? 0 : depth / 8, rowB = depth === 1 ? Math.ceil(w / 8) : w * bps, out = new Uint8Array(w * h);
  let comp, p = o;
  if (compOverride === undefined){ comp = d.getUint16(p); p += 2; } else comp = compOverride;
  let raw;
  if (comp === 0){ raw = u8.subarray(p, p + rowB * h); p += rowB * h; }
  else if (comp === 1){
    const counts = []; for (let y = 0; y < h; y++){ counts.push(ver === 2 ? d.getUint32(p) : d.getUint16(p)); p += ver === 2 ? 4 : 2; }
    raw = new Uint8Array(rowB * h);
    for (let y = 0; y < h; y++){
      const e = p + counts[y]; let k = y * rowB; const lim = k + rowB;
      while (p < e && k < lim){ const n = (u8[p++] << 24) >> 24;
        if (n >= 0){ for (let j = 0; j <= n && k < lim; j++) raw[k++] = u8[p++]; }
        else if (n !== -128){ const b = u8[p++]; for (let j = 0; j < 1 - n && k < lim; j++) raw[k++] = b; } }
      p = e;
    }
  } else if (comp === 2 || comp === 3){
    raw = await inflate(u8.subarray(p, end)); p = end;
    if (comp === 3){                                                     // 预测：每列差分
      if (bps === 1) for (let y = 0; y < h; y++){ const r = y * rowB; for (let x = 1; x < w; x++) raw[r + x] = (raw[r + x] + raw[r + x - 1]) & 255; }
      else if (bps === 2) for (let y = 0; y < h; y++){ const r = y * rowB; let prev = (raw[r] << 8) | raw[r + 1]; for (let x = 1; x < w; x++){ const v = (prev + ((raw[r + x * 2] << 8) | raw[r + x * 2 + 1])) & 0xffff; raw[r + x * 2] = v >> 8; raw[r + x * 2 + 1] = v & 255; prev = v; } }
      else if (bps === 4) for (let y = 0; y < h; y++){                    // 32 位：位元组分面＋差分
        const r = y * rowB; for (let x = 1; x < rowB; x++) raw[r + x] = (raw[r + x] + raw[r + x - 1]) & 255;
        const t = raw.slice(r, r + rowB); for (let x = 0; x < w; x++) for (let b = 0; b < 4; b++) raw[r + x * 4 + b] = t[b * w + x];
      }
    }
  } else throw new Bad('unknown PSD compression ' + comp);
  if (depth === 8) out.set(raw.subarray(0, w * h));
  else if (depth === 16) for (let i = 0; i < w * h; i++) out[i] = raw[i * 2];
  else if (depth === 32){ const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength); for (let i = 0; i < w * h; i++){ const f = dv.getFloat32(i * 4); out[i] = Math.round(255 * Math.pow(Math.max(0, Math.min(1, f)), 1 / 2.2)); } }
  else if (depth === 1) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = (raw[y * rowB + (x >> 3)] >> (7 - (x & 7))) & 1 ? 0 : 255;   // 点阵：1＝黑
  return {plane:out, end:p};
}
/* 平面们 → RGBA（照色彩模式） */
function toRGBA(get, n, mode, palette){
  const out = new Uint8ClampedArray(n * 4), has = id => !!get(id);
  const a = get(-1), A = i => a ? a[i] : 255;
  for (let i = 0; i < n; i++){
    let r, g, b;
    if (mode === 3){ r = get(0)[i]; g = has(1) ? get(1)[i] : r; b = has(2) ? get(2)[i] : r; }
    else if (mode === 4){ const k = (has(3) ? get(3)[i] : 255) / 255; r = get(0)[i] * k; g = get(1)[i] * k; b = get(2)[i] * k; }   // PSD 的 CMYK 存反值
    else if (mode === 2 && palette){ const v = get(0)[i]; r = palette[v]; g = palette[256 + v]; b = palette[512 + v]; }
    else if (mode === 9){ const L = get(0)[i] / 255 * 100, aa = (has(1) ? get(1)[i] : 128) - 128, bb = (has(2) ? get(2)[i] : 128) - 128;   // Lab → sRGB
      const fy = (L + 16) / 116, fx = fy + aa / 500, fz = fy - bb / 200, f = t => t > 6 / 29 ? t * t * t : 3 * (6 / 29) ** 2 * (t - 4 / 29);
      const X = 0.9505 * f(fx), Y = f(fy), Z = 1.089 * f(fz), lin = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z];
      [r, g, b] = lin.map(c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055)); }
    else { r = g = b = get(0)[i]; }
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = A(i);
  }
  return out;
}
/* ── 活图层读回（decode 用）：Photoshop 存的文字（TySh＋EngineData）、图层样式（lfx2）、形状图层（SoCo／vscg／vstk／vmsk）──
   读到的放在记录上（rec.liveText／rec.fx／rec.shape），由 ps-file psdLayers 决定接成文字层、矢量层、引擎图层样式；
   读不懂（坏档、少见的描述子类型、变形文字、混排样式…）就不给，那层照旧用像素。 */
function rDesc(u8, dv, start){
  let o = start;
  const u32 = () => { const v = dv.getUint32(o); o += 4; return v; };
  const i32 = () => { const v = dv.getInt32(o); o += 4; return v; };
  const f64 = () => { const v = dv.getFloat64(o); o += 8; return v; };
  const lat = n => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u8[o + i]); o += n; return s; };
  const key = () => { const n = u32(); return lat(n || 4); };
  const uni = () => { const n = u32(); let s = ''; for (let i = 0; i < n; i++){ s += String.fromCharCode(dv.getUint16(o)); o += 2; } return s.replace(/\u0000+$/, ''); };
  const obj = () => { uni(); const out = {_cls:key()}; const n = u32(); for (let i = 0; i < n; i++){ const k = key(); out[k] = val(); } return out; };
  const ref = () => { const n = u32(); for (let i = 0; i < n; i++){ const t = lat(4);
    if (t === 'prop'){ uni(); key(); key(); } else if (t === 'Clss'){ uni(); key(); } else if (t === 'Enmr'){ uni(); key(); key(); key(); }
    else if (t === 'rele'){ uni(); key(); u32(); } else if (t === 'Idnt' || t === 'indx') u32(); else if (t === 'name'){ uni(); key(); uni(); } else throw new Bad('descriptor reference ' + t); } return null; };
  const val = () => { const t = lat(4);
    switch (t){
      case 'Objc': case 'GlbO': return obj();
      case 'VlLs': { const n = u32(), a = []; for (let i = 0; i < n; i++) a.push(val()); return a; }
      case 'TEXT': return uni();
      case 'long': return i32();
      case 'comp': { const hi = i32(), lo = u32(); return hi * 4294967296 + lo; }
      case 'doub': return f64();
      case 'UntF': { const unit = lat(4); return {unit, value:f64()}; }
      case 'UnFl': { const unit = lat(4), n = u32(), values = []; for (let i = 0; i < n; i++) values.push(f64()); return {unit, value:values[0], values}; }
      case 'bool': return !!u8[o++];
      case 'enum': { const type = key(); return {type, value:key()}; }
      case 'type': case 'GlbC': uni(); return {cls:key()};
      case 'tdta': { const n = u32(), b = u8.subarray(o, o + n); o += n; return b; }
      case 'alis': { const n = u32(); o += n; return null; }
      case 'obj ': return ref();
      default: throw new Bad('descriptor type ' + t);
    }
  };
  const v = obj();
  return [v, o];
}
/* EngineData（PDF 式字典）⇒ 物件；字串 UTF-16BE（带 BOM）或 latin1 */
const ED_STOP = new Set([0x2f, 0x5b, 0x5d, 0x28, 0x29, 0x3c, 0x3e]);
function parseEngine(b){
  let i = 0; const n = b.length;
  const ws = () => { while (i < n && b[i] <= 32) i++; };
  const word = () => { let t = ''; while (i < n && b[i] > 32 && !ED_STOP.has(b[i])) t += String.fromCharCode(b[i++]); return t; };
  const val = (depth) => {
    if (depth > 64) throw new Bad('EngineData too deep');
    ws(); const c = b[i];
    if (c === 0x3c && b[i + 1] === 0x3c){ i += 2; const o = {};
      for (;;){ ws(); if (i >= n) return o; if (b[i] === 0x3e && b[i + 1] === 0x3e){ i += 2; return o; }
        if (b[i] !== 0x2f){ i++; continue; } i++; const k = word(); o[k] = val(depth + 1); } }
    if (c === 0x5b){ i++; const a = []; for (;;){ ws(); if (i >= n) return a; if (b[i] === 0x5d){ i++; return a; } a.push(val(depth + 1)); } }
    if (c === 0x28){ i++; const bs = [];
      while (i < n && b[i] !== 0x29){ if (b[i] === 0x5c) i++; bs.push(b[i++]); } i++;
      if (bs[0] === 0xfe && bs[1] === 0xff){ let s = ''; for (let k = 2; k + 1 < bs.length; k += 2) s += String.fromCharCode((bs[k] << 8) | bs[k + 1]); return s; }
      return String.fromCharCode(...bs); }
    if (c === 0x2f){ i++; return word(); }
    const t = word(); if (!t){ i++; return null; }
    if (t === 'true') return true; if (t === 'false') return false;
    const f = parseFloat(t); return isNaN(f) ? t : f;
  };
  return val(0);
}
const rgbOfDesc = c => {
  if (!c) return null;
  if (c._cls === 'RGBC') return [c['Rd  '] !== undefined ? c['Rd  '] : c['Rd '], c['Grn '], c['Bl  '] !== undefined ? c['Bl  '] : c['Bl ']].map(v => Math.round(Math.max(0, Math.min(255, +v || 0))));
  if (c._cls === 'Grsc'){ const g = Math.round(255 - (+c['Gry '] || 0) * 2.55); return [g, g, g]; }
  return null;
};
/* 文字层：字、PostScript 字名、字号、颜色、对齐、仿粗斜、字距、行距、点文字的基线锚点／段落文字的框；变形、混排 ⇒ 标出来让外面改用像素 */
function readTySh(u8, dv, s){
  if (dv.getUint16(s) !== 1) return null;
  const T = []; for (let k = 0; k < 6; k++) T.push(dv.getFloat64(s + 2 + k * 8));
  let o = s + 50; if (dv.getUint16(o) !== 50) return null; o += 6;
  const [D, end] = rDesc(u8, dv, o);
  let warp = false;
  try { if (dv.getUint16(end) === 1){ const [w] = rDesc(u8, dv, end + 6); warp = !!(w.warpStyle && w.warpStyle.value && w.warpStyle.value !== 'warpNone'); } } catch (_){ }
  const E = D.EngineData ? parseEngine(D.EngineData) : null, ed = E && E.EngineDict, rd = E && (E.ResourceDict || E.DocumentResources);
  if (!ed || !rd) return null;
  const text = String(D['Txt '] || '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const base = ((rd.StyleSheetSet || [])[0] || {}).StyleSheetData || {};
  const runs = ((ed.StyleRun || {}).RunArray || []).map(r => Object.assign({}, base, ((r.StyleSheet || {}).StyleSheetData) || {}));
  const lens = (ed.StyleRun || {}).RunLengthArray || [];
  const fonts = rd.FontSet || [];
  const sig = r => JSON.stringify([fonts[r.Font] && fonts[r.Font].Name, r.FontSize, r.FillColor && r.FillColor.Values, !!r.FauxBold, !!r.FauxItalic, r.Tracking || 0]);
  let pos = 0, first = null, mixed = false; const full = String(D['Txt '] || '');
  runs.forEach((r, k) => { const piece = full.slice(pos, pos + (lens[k] || 0)); pos += lens[k] || 0;
    if (!piece.trim()) return; if (first === null) first = r; else if (sig(r) !== sig(first)) mixed = true; });
  const st = first || runs[0] || base;
  const fv = st.FillColor && st.FillColor.Values || [1, 0, 0, 0];
  const pp = (((((ed.ParagraphRun || {}).RunArray || [])[0] || {}).ParagraphSheet || {}).Properties) || {};
  const shape = ((((ed.Rendered || {}).Shapes || {}).Children) || [])[0] || {};
  const bb = shape.Cookie && shape.Cookie.Photoshop && shape.Cookie.Photoshop.BoxBounds;
  return {text, font:(fonts[st.Font] && fonts[st.Font].Name) || 'ArialMT', size:+st.FontSize || 12,
    color:[fv[1], fv[2], fv[3]].map(v => Math.round(Math.max(0, Math.min(1, +v || 0)) * 255)),
    just:+pp.Justification || 0, fauxBold:!!st.FauxBold, fauxItalic:!!st.FauxItalic, tracking:+st.Tracking || 0,
    // 行距：StyleRun 的 Leading（自动行距时 PS 也存算好的值）优先，否则段落 AutoLeading×字号；LeadingType 1＝上到上
    leading:+st.Leading > 0 ? +st.Leading : (+pp.AutoLeading > 0 ? +pp.AutoLeading : 1.2) * (+st.FontSize || 12), leadingType:+pp.LeadingType === 1 ? 1 : 0, transform:T,
    // 自动行距（StyleRun 的 AutoLeading 没写成 false）⇒ 比例，写回时照写自动行距
    autoLeading:st.AutoLeading === false ? 0 : (+pp.AutoLeading > 0 ? +pp.AutoLeading : 1.2),
    box:shape.ShapeType === 1 && Array.isArray(bb) && bb.length === 4 ? bb.map(Number) : null, warp, mixed};
}
/* 图层样式 ⇒ [{kind, enabled, blend, color, opacity(%), angle, useGlobalLight, distance, spread(%), size, …}]（effectFromParams 的参数单位） */
const FX_BLEND_OF = {}; Object.keys(FX_BLEND).forEach(k => { FX_BLEND_OF[FX_BLEND[k]] = k; });
const FX_KIND_OF = {DrSh:'dropShadow', IrSh:'innerShadow', OrGl:'outerGlow', IrGl:'innerGlow', FrFX:'stroke', SoFi:'colorOverlay'};
const FX_MULTI = {dropShadowMulti:'DrSh', innerShadowMulti:'IrSh', frameFXMulti:'FrFX', solidFillMulti:'SoFi'};
function readLfx2(u8, dv, s, globalAngle){
  const [D] = rDesc(u8, dv, s + 8);
  const items = [], skipped = [], uv = x => (x && typeof x === 'object' ? +x.value : +x) || 0;
  const one = (code, e) => {
    if (!e || e.enab === false) return;
    const kind = FX_KIND_OF[code], hex = c => { const v = rgbOfDesc(c); return v ? '#' + v.map(x => x.toString(16).padStart(2, '0')).join('') : undefined; };
    const p = {kind, enabled:true, blend:FX_BLEND_OF[e['Md  '] ? e['Md  '].value : e['Md '] && e['Md '].value] || undefined, opacity:e.Opct !== undefined ? uv(e.Opct) : undefined, color:hex(e['Clr '])};
    if (kind === 'dropShadow' || kind === 'innerShadow'){
      p.useGlobalLight = !!e.uglg; p.angle = e.uglg && globalAngle !== undefined ? globalAngle : uv(e.lagl); p.distance = uv(e.Dstn); p.size = uv(e.blur);
      p[kind === 'dropShadow' ? 'spread' : 'choke'] = uv(e.Ckmt); if (kind === 'dropShadow') p.knocksOut = e.layerConceals !== false;
    } else if (kind === 'outerGlow' || kind === 'innerGlow'){
      if (!e['Clr ']) { skipped.push(kind + ' gradient'); return; }
      p.size = uv(e.blur); p[kind === 'outerGlow' ? 'spread' : 'choke'] = uv(e.Ckmt); p.range = e.Inpr !== undefined ? uv(e.Inpr) : 50;
      p.technique = e.GlwT && e.GlwT.value === 'PrBL' ? 'precise' : 'softer'; if (kind === 'innerGlow') p.source = e.glwS && e.glwS.value === 'SrcC' ? 'center' : 'edge';
    } else if (kind === 'stroke'){
      if (e.PntT && e.PntT.value !== 'SClr'){ skipped.push('stroke ' + e.PntT.value); return; }
      p.size = uv(e['Sz  '] !== undefined ? e['Sz  '] : e['Sz ']); const sv = e.Styl && e.Styl.value; p.position = sv === 'InsF' ? 'inside' : sv === 'CtrF' ? 'center' : 'outside';
    }
    items.push(p);
  };
  const multi = new Set();
  for (const k of Object.keys(FX_MULTI)) if (Array.isArray(D[k])){ multi.add(FX_MULTI[k]); D[k].forEach(e => one(FX_MULTI[k], e)); }
  for (const k of Object.keys(D)){
    if (k === '_cls' || k === 'Scl ' || k === 'masterFXSwitch' || FX_MULTI[k]) continue;
    if (FX_KIND_OF[k]){ if (!multi.has(k)) one(k, D[k]); }
    else if (D[k] && typeof D[k] === 'object' && /Multi$|^(ChFX|BvlE|GrFl|patternFill|ebbl|Ptrn)$/.test(k)
      && (Array.isArray(D[k]) ? D[k].some(e => e && e.enab !== false) : D[k].enab !== false)) skipped.push(k);   // *Multi＝数组：有一项开着才算
  }
  return {enabled:D.masterFXSwitch !== false, items, skipped};
}
/* 形状图层：填色（SoCo 或 vscg 里的 SoCo）、描边（vstk）、路径（vmsk／vsms·8.24 定点、相对文件宽高） */
function readSoCo(u8, dv, s){ const [D] = rDesc(u8, dv, s + 4); return rgbOfDesc(D['Clr ']); }
function readVscg(u8, dv, s){ const k = String.fromCharCode(u8[s], u8[s + 1], u8[s + 2], u8[s + 3]); if (k !== 'SoCo') return undefined; const [D] = rDesc(u8, dv, s + 8); return rgbOfDesc(D['Clr ']); }
const VSTK_ALIGN = {strokeStyleAlignInside:'inside', strokeStyleAlignCenter:'center', strokeStyleAlignOutside:'outside'};
const VSTK_CAP = {strokeStyleButtCap:'butt', strokeStyleRoundCap:'round', strokeStyleSquareCap:'square'};
const VSTK_JOIN = {strokeStyleMiterJoin:'miter', strokeStyleRoundJoin:'round', strokeStyleBevelJoin:'bevel'};
/* 描边：颜色、宽、对齐、端点、转角、虚线（PS 的虚线段长以描边宽为单位 ⇒ 换成像素）、不透明度（0..1） */
function readVstk(u8, dv, s){
  const [D] = rDesc(u8, dv, s + 4), c = D.strokeStyleContent, col = c && rgbOfDesc(c['Clr ']), ev = x => x && x.value;
  let stroke = null;
  if (D.strokeEnabled !== false && col){
    const width = +(D.strokeStyleLineWidth && D.strokeStyleLineWidth.value) || 1;
    stroke = {color:col, width};
    const al = VSTK_ALIGN[ev(D.strokeStyleLineAlignment)], cap = VSTK_CAP[ev(D.strokeStyleLineCapType)], join = VSTK_JOIN[ev(D.strokeStyleLineJoinType)];
    if (al) stroke.align = al; if (cap) stroke.cap = cap; if (join) stroke.join = join;
    const ds = Array.isArray(D.strokeStyleLineDashSet) ? D.strokeStyleLineDashSet.map(v => (v && typeof v === 'object' ? +v.value : +v) || 0) : [];
    if (ds.some(v => v > 0)) stroke.dash = (ds.length % 2 ? ds.concat(ds) : ds).map(v => v * width);
    const op = D.strokeStyleOpacity, ov = op && typeof op === 'object' ? +op.value : NaN;
    if (isFinite(ov)) stroke.opacity = Math.max(0, Math.min(100, ov)) / 100;
  }
  return {stroke, fillEnabled:D.fillEnabled !== false};
}
function readVmsk(dv, s, end, W, H){
  const flags = dv.getUint32(s + 4), paths = [];
  let cur = null, evenOdd = false;
  for (let o = s + 8; o + 26 <= end; o += 26){
    const sel = dv.getUint16(o);
    if (sel === 0 || sel === 3){ const op = dv.getInt16(o + 4); cur = {closed:sel === 0, op, knots:[]}; paths.push(cur); if (op === 0 || op === 2) evenOdd = true; if (op === 3) return null; }
    else if ((sel === 1 || sel === 2 || sel === 4 || sel === 5) && cur){
      const f = q => dv.getInt32(o + 2 + q * 4) / 16777216;
      cur.knots.push({pre:[f(1) * W, f(0) * H], a:[f(3) * W, f(2) * H], post:[f(5) * W, f(4) * H]});
    }
  }
  if (flags & 1) return null;                                          // 反相的路径：画板表达不了
  return {paths:paths.filter(p => p.knots.length >= 2), evenOdd};
}

async function decode(buf){
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), d = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let o = 0;
  const u16 = () => { const v = d.getUint16(o); o += 2; return v; }, u32 = () => { const v = d.getUint32(o); o += 4; return v; };
  const i16 = () => { const v = d.getInt16(o); o += 2; return v; }, i32 = () => { const v = d.getInt32(o); o += 4; return v; };
  const len8 = ver => ver === 2 ? u32() * 4294967296 + u32() : u32();
  if (u8.length < 26 || u32() !== 0x38425053) throw new Bad('not a Photoshop (.psd / .psb) file');
  const ver = u16(); if (ver !== 1 && ver !== 2) throw new Bad('unknown PSD version ' + ver);
  o += 6;
  const nch = u16(), H = u32(), W = u32(), depth = u16(), mode = u16();
  if (![1, 8, 16, 32].includes(depth)) throw new Bad('PSD bit depth ' + depth + ' is not supported');
  if (![0, 1, 2, 3, 4, 8, 9].includes(mode)) throw new Bad('PSD color mode ' + mode + ' (multichannel) is not supported');
  const cmLen = u32(); const palette = mode === 2 && cmLen >= 768 ? u8.slice(o, o + 768) : null; o += cmLen;
  const resLen = u32(); let transIdx = -1, gAngle, gAlt;
  { const end = o + resLen; let q = o;                                   // 图像资源：只看索引色的透明索引（0x0417）
    while (q + 12 <= end && d.getUint32(q) === 0x3842494d){ const id = d.getUint16(q + 4), nl = u8[q + 6], q2 = q + 6 + nl + 1 + ((nl + 1) % 2); const sz = d.getUint32(q2); if (id === 0x0417 && sz >= 2) transIdx = d.getUint16(q2 + 4); if (id === 0x040D && sz >= 4) gAngle = d.getInt32(q2 + 4); if (id === 0x0419 && sz >= 4) gAlt = d.getInt32(q2 + 4); q = q2 + 4 + sz + (sz % 2); }
    o = end; }
  const lmLen = len8(ver), lmEnd = o + lmLen, records = [];
  if (lmLen > 0){
    const liLen = len8(ver), liEnd = o + liLen;
    if (liLen > 0){
      let count = i16(); count = Math.abs(count);
      for (let k = 0; k < count; k++){
        const top = i32(), left = i32(), bottom = i32(), right = i32(), nc = u16(), chs = [];
        for (let c = 0; c < nc; c++){ const id = i16(); chs.push({id, len:len8(ver)}); }
        o += 4; const bk = String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]); o += 4;
        const opacity = u8[o++], clipping = u8[o++], flags = u8[o++]; o++;
        const exLen = u32(), exEnd = o + exLen;
        const rec = {name:'', rect:[top, left, bottom, right], opacity:opacity / 255, fillOpacity:1, blend:BLEND_OF[bk] || 'normal', clipped:clipping === 1, hidden:!!(flags & 2), section:0, chs, mask:null, text:false};
        const mLen = u32(), mEnd = o + mLen;
        if (mLen >= 20){
          const mt = i32(), ml = i32(), mb = i32(), mr = i32(), def = u8[o++], mf = u8[o++];
          rec.mask = {rect:[mt, ml, mb, mr], defaultColor:def, enabled:!(mf & 2), relative:!!(mf & 1)};
          if (mLen >= 36 && (mf & 0x10) === 0){ /* 有「真实蒙版」时，-2 仍是使用者蒙版（这里不读 -3） */ }
        }
        o = mEnd;
        const brLen = u32();
        if (brLen >= 8){ const ranges = []; for (let q = 0; q + 8 <= brLen && ranges.length < 4; q += 8){ const b = u8.subarray(o + q, o + q + 8); ranges.push([{black:[b[0], b[1]], white:[b[2], b[3]]}, {black:[b[4], b[5]], white:[b[6], b[7]]}]); }
          const full = r => r.black[0] === 0 && r.black[1] === 0 && r.white[0] === 255 && r.white[1] === 255;
          while (ranges.length && ranges[ranges.length - 1].every(full)) ranges.pop();
          if (ranges.length) rec.blendIf = {ranges}; }
        o += brLen;
        const nl = u8[o]; rec.name = (() => { try { return decodeURIComponent(escape(String.fromCharCode(...u8.subarray(o + 1, o + 1 + nl)))); } catch (_){ return String.fromCharCode(...u8.subarray(o + 1, o + 1 + nl)); } })();
        o += 1 + nl; o += (4 - (1 + nl) % 4) % 4;
        while (o + 12 <= exEnd){                                          // 附加图层资讯
          const sig = String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]); if (sig !== '8BIM' && sig !== '8B64') break;
          const key = String.fromCharCode(u8[o + 4], u8[o + 5], u8[o + 6], u8[o + 7]); o += 8;
          const big = ver === 2 && ['LMsk', 'Lr16', 'Lr32', 'Layr', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD'].includes(key);
          const L = big ? len8(ver) : u32(), s = o;
          if (key === 'luni'){ const n = d.getUint32(s); let t = ''; for (let i = 0; i < n; i++) t += String.fromCharCode(d.getUint16(s + 4 + i * 2)); if (t.length) rec.name = t.replace(/\u0000+$/, ''); }
          else if (key === 'lsct' || key === 'lsdk'){ rec.section = d.getUint32(s); if (L >= 12 && String.fromCharCode(u8[s + 4], u8[s + 5], u8[s + 6], u8[s + 7]) === '8BIM'){ const k2 = String.fromCharCode(u8[s + 8], u8[s + 9], u8[s + 10], u8[s + 11]); if (BLEND_OF[k2]) rec.blend = BLEND_OF[k2]; } }
          else if (key === 'iOpa') rec.fillOpacity = u8[s] / 255;
          else if (key === 'TySh'){ rec.text = true; try { rec.liveText = readTySh(u8, d, s); } catch (e){ rec.liveText = null; } }
          else if (key === 'tySh') rec.text = true;
          else if (key === 'lfx2'){ try { rec.fx = readLfx2(u8, d, s, gAngle); } catch (e){ rec.fx = null; } }
          else if (key === 'SoCo'){ try { rec._soco = readSoCo(u8, d, s); } catch (e){ rec._soco = null; } }
          else if (key === 'vscg'){ try { const v = readVscg(u8, d, s); if (rec._soco === undefined) rec._soco = v === undefined ? null : v; } catch (e){ rec._soco = null; } }
          else if (key === 'vstk'){ try { rec._vstk = readVstk(u8, d, s); } catch (e){ rec._vstk = null; } }
          else if (key === 'vmsk' || key === 'vsms'){ try { rec._vmsk = readVmsk(d, s, s + L, W, H); } catch (e){ rec._vmsk = null; } }
          o = s + L; if (ver === 1 && L % 2 && key !== 'luni') { /* 规范要偶数补齐；多数档已含在长度里 */ }
        }
        o = exEnd;
        // 形状图层＝有填色内容（SoCo／vscg）＋路径；只有路径没填色＝像素层的矢量蒙版，照旧用像素
        if (rec._soco !== undefined && rec._vmsk && rec._vmsk.paths.length){
          const st = rec._vstk || {stroke:null, fillEnabled:true};
          if (rec._soco || st.stroke) rec.shape = {fill:rec._soco, fillEnabled:st.fillEnabled, stroke:st.stroke, evenOdd:rec._vmsk.evenOdd, paths:rec._vmsk.paths};
        }
        delete rec._soco; delete rec._vstk; delete rec._vmsk;
        records.push(rec);
      }
      for (const rec of records){
        const [t, l, b, r] = rec.rect, w = Math.max(0, r - l), h = Math.max(0, b - t), planes = {};
        for (const c of rec.chs){
          const end = o + c.len;
          let cw = w, chh = h;
          if (c.id === -2 && rec.mask){ cw = Math.max(0, rec.mask.rect[3] - rec.mask.rect[1]); chh = Math.max(0, rec.mask.rect[2] - rec.mask.rect[0]); }
          if (c.id < -2 || c.len < 2 || cw * chh === 0){ o = end; continue; }
          const res = await readChannel(u8, d, o, end, cw, chh, depth, ver);
          planes[c.id] = res.plane; o = end;
        }
        if (w * h && planes[0]) rec.rgba = toRGBA(id => planes[id], w * h, mode, palette); else rec.rgba = null;
        // 蒙版矩形是空的＝整片都是预设色（PS 存「隐藏全部」就这样）：留着、alpha 空；有矩形却没资料才当坏蒙版丢掉
        const mEmpty = rec.mask && (rec.mask.rect[3] - rec.mask.rect[1]) * (rec.mask.rect[2] - rec.mask.rect[0]) <= 0;
        if (rec.mask && planes[-2]) rec.mask.alpha = planes[-2]; else if (mEmpty) rec.mask.alpha = new Uint8Array(0); else if (rec.mask) rec.mask = null;
        delete rec.chs;
      }
    }
    o = lmEnd;
  }
  // 合成图
  let merged = null;
  try {
    const comp = u16(), planes = [];
    let p = o;
    if (comp === 1){
      const rowCount = nch * H, counts = []; for (let i = 0; i < rowCount; i++){ counts.push(ver === 2 ? d.getUint32(p) : d.getUint16(p)); p += ver === 2 ? 4 : 2; }
      for (let c = 0; c < nch; c++){
        // 合成图的 RLE：先全部列长度、再资料 ⇒ 每通道拼一段「列长度＋资料」给 readChannel
        const cnt = counts.slice(c * H, (c + 1) * H), sz = cnt.reduce((a, b) => a + b, 0), hdr = new Uint8Array(H * (ver === 2 ? 4 : 2));
        const hv = new DataView(hdr.buffer); cnt.forEach((v, i) => ver === 2 ? hv.setUint32(i * 4, v) : hv.setUint16(i * 2, v));
        const seg = new Uint8Array(hdr.length + sz); seg.set(hdr); seg.set(u8.subarray(p, p + sz), hdr.length); p += sz;
        const r = await readChannel(seg, new DataView(seg.buffer), 0, seg.length, W, H, depth, ver, 1); planes.push(r.plane);
      }
    } else if (comp === 0){
      const bps = depth === 1 ? 0 : depth / 8, rowB = depth === 1 ? Math.ceil(W / 8) : W * bps;
      for (let c = 0; c < nch; c++){ const seg = u8.subarray(p, p + rowB * H); p += rowB * H; const r = await readChannel(seg, new DataView(seg.buffer, seg.byteOffset, seg.byteLength), 0, seg.length, W, H, depth, ver, 0); planes.push(r.plane); }
    } else if (comp === 2 || comp === 3){
      const all = await inflate(u8.subarray(p)); const bps = depth / 8, per = W * H * bps;
      for (let c = 0; c < nch; c++){ const seg = all.subarray(c * per, (c + 1) * per); const r = await readChannel(seg, new DataView(seg.buffer, seg.byteOffset, seg.byteLength), 0, seg.length, W, H, depth, ver, 0); planes.push(r.plane); }
    }
    if (planes.length){
      const color = mode === 4 ? 4 : (mode === 3 || mode === 9) ? 3 : 1;
      const get = id => id === -1 ? (planes.length > color ? planes[color] : null) : planes[id];
      merged = toRGBA(get, W * H, mode, palette);
      if (mode === 2 && transIdx >= 0){ const ix = planes[0]; for (let i = 0; i < W * H; i++) if (ix[i] === transIdx) merged[i * 4 + 3] = 0; }
      // 有图层的档：合成图的透明度在第一个 alpha（图层数为负）；没 alpha 的就是不透明
    }
  } catch (e){ if (e instanceof Bad) throw e; console.warn('[PSD] composite image unreadable', e); }
  return {width:W, height:H, depth, mode, merged, records, globalAngle:gAngle, globalAltitude:gAlt};
}

window.PsdIO = {encode, decode, BLEND_KEYS, BLEND_OF, Bad};
})();
