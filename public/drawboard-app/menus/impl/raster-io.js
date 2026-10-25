/* 堤麟画板 · 别家绘图软件的分层档：读 Krita（.kra）、OpenRaster（.ora）、GIMP（.xcf）、Procreate（.procreate）；写 OpenRaster（.ora）
   window.RasterIO = {
     sniff(bytes, name) → 'kra' | 'ora' | 'xcf' | 'procreate' | null
     async decode(bytes, name) → model = {format, width, height, layers:[节点…（下→上）], notes:[带不过来的项…]}
        节点：{kind:'group', name, hidden, opacity 0..1, blend, children:[节点…（下→上）]}
              {kind:'raster', name, hidden, opacity, blend, clipped?, x, y, w, h, rgba（w×h·非预乘 RGBA）, mask?:{alpha（文件 W×H）, enabled}}
     async encodeOra({width, height, layers（同上的树·下→上）, merged:RGBA（W×H）}) → Uint8Array
     Bad：读不了（坏档、加密、不是这几种）
   }
   blend 照画板（normal、multiply、screen…，组可为 passThrough）；读不懂的混合模式当 normal（列 notes）。
   KRA：maindoc.xml 的图层树＋每层 64×64 方块（LZF·按通道分开存）；颜色空间 RGBA（8／16 位、16／32 位浮点）与灰阶；透明度蒙版 ⇒ 图层蒙版；
        矢量层、滤镜层、填充层、复制层、档案层画板接不起来 ⇒ 略过（notes）。
   ORA：stack.xml（巢状 stack＝组）＋每层 PNG。
   XCF：GIMP 2.x／3.x（版本 0～22）：RGB／灰阶／索引色、8／16／32 位整数与 16／32／64 位浮点（线性的转 sRGB）、
        不压缩／RLE／zlib 方块、图层组（项目路径）、图层蒙版、偏移；文字层照像素。
   Procreate：Document.archive（二进位 plist·NSKeyedArchiver）＋每层方块（LZO .chunk 或 LZ4 .lz4·预乘 RGBA）；图层组、蒙版、剪贴、背景色；
        画布旋转／翻转照档里的方向摆正。 */
(function(){
'use strict';
if (window.RasterIO) return;
class Bad extends Error {}

const td = new TextDecoder();
const utf8 = u8 => td.decode(u8);
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ── ZIP 读：中央目录 ⇒ {名字: {method, size, csize, off}}（含 zip64） ── */
function zipEntries(u8){
  const d = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (d.getUint32(i, true) === 0x06054b50){ e = i; break; }
  if (e < 0) throw new Bad('not a ZIP-based file (no central directory)');
  let n = d.getUint16(e + 10, true), cdOff = d.getUint32(e + 16, true);
  if ((n === 0xffff || cdOff === 0xffffffff) && e >= 20 && d.getUint32(e - 20, true) === 0x07064b50){
    const z = Number(d.getBigUint64(e - 12, true));
    if (d.getUint32(z, true) === 0x06064b50){ n = Number(d.getBigUint64(z + 32, true)); cdOff = Number(d.getBigUint64(z + 48, true)); }
  }
  const out = {};
  let p = cdOff;
  for (let k = 0; k < n && p + 46 <= u8.length && d.getUint32(p, true) === 0x02014b50; k++){
    const flags = d.getUint16(p + 8, true), method = d.getUint16(p + 10, true);
    let csize = d.getUint32(p + 20, true), size = d.getUint32(p + 24, true);
    const nl = d.getUint16(p + 28, true), xl = d.getUint16(p + 30, true), cl = d.getUint16(p + 32, true);
    let off = d.getUint32(p + 42, true);
    const name = utf8(u8.subarray(p + 46, p + 46 + nl));
    for (let x = p + 46 + nl, xe = x + xl; x + 4 <= xe;){                     // zip64 额外栏位
      const id = d.getUint16(x, true), sz = d.getUint16(x + 2, true); let q = x + 4;
      if (id === 1){ if (size === 0xffffffff){ size = Number(d.getBigUint64(q, true)); q += 8; } if (csize === 0xffffffff){ csize = Number(d.getBigUint64(q, true)); q += 8; } if (off === 0xffffffff){ off = Number(d.getBigUint64(q, true)); } }
      x += 4 + sz;
    }
    if (flags & 1) throw new Bad('this file is encrypted (password protected) and cannot be opened');
    out[name] = {method, size, csize, off};
    p += 46 + nl + xl + cl;
  }
  return out;
}
async function inflateRaw(u8, fmt){
  if (typeof DecompressionStream === 'undefined') throw new Bad('this browser cannot read compressed data');
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream(fmt || 'deflate-raw'))).arrayBuffer());
}
class Zip {
  constructor(u8){ this.u8 = u8; this.d = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.entries = zipEntries(u8); }
  names(){ return Object.keys(this.entries); }
  has(n){ return !!this.entries[n]; }
  async bytes(n){
    const en = this.entries[n]; if (!en) return null;
    const p = en.off; if (this.d.getUint32(p, true) !== 0x04034b50) throw new Bad('damaged ZIP entry: ' + n);
    const s = p + 30 + this.d.getUint16(p + 26, true) + this.d.getUint16(p + 28, true), raw = this.u8.subarray(s, s + en.csize);
    if (en.method === 0) return raw;
    if (en.method === 8) return await inflateRaw(raw);
    throw new Bad('unsupported ZIP compression method ' + en.method + ' in ' + n);
  }
  async text(n){ const b = await this.bytes(n); return b ? utf8(b) : null; }
}

/* ── ZIP 写（不压缩：图层是 PNG，本来就压过；第一个档 mimetype 不压缩＝ORA 规定） ── */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u8 => { let c = ~0; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
function zipStore(files){
  const te = new TextEncoder(), parts = [], cd = []; let off = 0;
  for (const f of files){
    const name = te.encode(f.name), data = f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    cd.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cdLen = cd.reduce((s, p) => s + p.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdLen, true); e.setUint32(16, off, true);
  const all = [...parts, ...cd, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let k = 0;
  for (const p of all){ out.set(p, k); k += p.length; }
  return out;
}

/* ── 图像小工具 ── */
async function pngRGBA(u8){
  const bmp = await createImageBitmap(new Blob([u8], {type:'image/png'}), {premultiplyAlpha:'none', colorSpaceConversion:'none'});
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d', {willReadFrequently:true}); x.drawImage(bmp, 0, 0); bmp.close && bmp.close();
  return {w:c.width, h:c.height, rgba:new Uint8ClampedArray(x.getImageData(0, 0, c.width, c.height).data.buffer)};
}
async function rgbaPNG(rgba, w, h){
  const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h);
  if (w * h) c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), 0, 0);
  const b = await new Promise(r => c.toBlob(r, 'image/png'));
  return new Uint8Array(await b.arrayBuffer());
}
const unpremul = p => { for (let i = 0; i < p.length; i += 4){ const a = p[i + 3]; if (a && a < 255){ const k = 255 / a; p[i] = Math.min(255, Math.round(p[i] * k)); p[i + 1] = Math.min(255, Math.round(p[i + 1] * k)); p[i + 2] = Math.min(255, Math.round(p[i + 2] * k)); } } return p; };
/* 线性 → sRGB（0..1 ⇒ 0..255） */
const lin2s = v => { v = clamp01(v); return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255); };
const half = h => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023; return e === 0 ? s * Math.pow(2, -14) * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + f / 1024); };
/* 全幅 alpha（W×H）照 bbox 剪：图层没内容的回 null */
function cropRGBA(rgba, W, H){
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++){ const r = y * W; for (let x = 0; x < W; x++) if (rgba[(r + x) * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(rgba.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4);
  return {x:x0, y:y0, w, h, rgba:out};
}

/* ── 混合模式对照 ── */
const BLEND_NAMES = {normal:'normal', dissolve:'dissolve', multiply:'multiply', screen:'screen', overlay:'overlay', darken:'darken', lighten:'lighten',
  'color-dodge':'colorDodge', 'color-burn':'colorBurn', 'hard-light':'hardLight', 'soft-light':'softLight', difference:'difference', exclusion:'exclusion',
  hue:'hue', saturation:'saturation', color:'color', luminosity:'luminosity', 'linear-burn':'linearBurn', 'linear-dodge':'linearDodge', 'vivid-light':'vividLight',
  'linear-light':'linearLight', 'pin-light':'pinLight', 'hard-mix':'hardMix', subtract:'subtract', divide:'divide', 'darker-color':'darkerColor', 'lighter-color':'lighterColor'};
/* Krita compositeop ⇒ 画板 */
const KRA_BLEND = {normal:'normal', dissolve:'dissolve', multiply:'multiply', screen:'screen', overlay:'overlay', darken:'darken', lighten:'lighten',
  dodge:'colorDodge', burn:'colorBurn', hard_light:'hardLight', soft_light:'softLight', soft_light_svg:'softLight', soft_light_pegtop_delphi:'softLight', diff:'difference', exclusion:'exclusion',
  hue:'hue', saturation:'saturation', color:'color', luminize:'luminosity', linear_burn:'linearBurn', add:'linearDodge', linear_dodge:'linearDodge', vivid_light:'vividLight',
  linear_light:'linearLight', 'linear light':'linearLight', pin_light:'pinLight', hard_mix:'hardMix', hard_mix_photoshop:'hardMix', subtract:'subtract', divide:'divide',
  darker_color:'darkerColor', 'darker color':'darkerColor', lighter_color:'lighterColor', 'lighter color':'lighterColor', hue_hsl:'hue', saturation_hsl:'saturation', color_hsl:'color', lightness:'luminosity',
  hue_hsy:'hue', saturation_hsy:'saturation', color_hsy:'color', luminosity_sai:'linearDodge'};
/* ORA composite-op（svg:… 是规范；krita:… 是 Krita 自己加的） */
function oraBlend(op, notes){
  if (!op) return 'normal';
  const m = /^(svg|krita|pegtop|gimp):(.+)$/.exec(op), k = m ? m[2] : op;
  if (k === 'src-over') return 'normal';
  if (k === 'plus') return 'linearDodge';
  if (BLEND_NAMES[k]) return BLEND_NAMES[k];
  const kk = k.replace(/-/g, '_'); if (KRA_BLEND[kk]) return KRA_BLEND[kk];
  notes.add('blend mode "' + op + '" is not available: shown as Normal'); return 'normal';
}
/* GIMP 图层模式（gimp-layer-mode.h；23 起是 2.10 的新模式，0～22 是旧的） */
const XCF_BLEND = {0:'normal', 1:'dissolve', 3:'multiply', 4:'screen', 5:'overlay', 6:'difference', 7:'linearDodge', 8:'subtract', 9:'darken', 10:'lighten',
  11:'hue', 12:'saturation', 13:'color', 14:'luminosity', 15:'divide', 16:'colorDodge', 17:'colorBurn', 18:'hardLight', 19:'softLight',
  23:'overlay', 24:'hue', 25:'saturation', 26:'color', 27:'luminosity', 28:'normal', 30:'multiply', 31:'screen', 32:'difference', 33:'linearDodge', 34:'subtract',
  35:'darken', 36:'lighten', 37:'hue', 38:'saturation', 39:'color', 40:'luminosity', 41:'divide', 42:'colorDodge', 43:'colorBurn', 44:'hardLight', 45:'softLight',
  48:'vividLight', 49:'pinLight', 50:'linearLight', 51:'hardMix', 52:'exclusion', 53:'linearBurn', 54:'darkerColor', 55:'lighterColor', 56:'luminosity', 61:'passThrough'};
/* Procreate blend／extendedBlend */
const PRO_BLEND = {0:'normal', 1:'multiply', 2:'screen', 3:'linearDodge', 4:'lighten', 5:'exclusion', 6:'difference', 7:'subtract', 8:'linearBurn', 9:'colorDodge',
  10:'colorBurn', 11:'overlay', 12:'hardLight', 13:'color', 14:'luminosity', 15:'hue', 16:'saturation', 17:'softLight', 19:'darken', 20:'hardMix', 21:'vividLight',
  22:'linearLight', 23:'pinLight', 24:'lighterColor', 25:'darkerColor', 26:'divide'};
/* 画板 ⇒ ORA composite-op（写） */
const ORA_OP = {normal:'svg:src-over', multiply:'svg:multiply', screen:'svg:screen', overlay:'svg:overlay', darken:'svg:darken', lighten:'svg:lighten',
  colorDodge:'svg:color-dodge', colorBurn:'svg:color-burn', hardLight:'svg:hard-light', softLight:'svg:soft-light', difference:'svg:difference',
  color:'svg:color', luminosity:'svg:luminosity', hue:'svg:hue', saturation:'svg:saturation', linearDodge:'svg:plus', exclusion:'svg:exclusion'};

/* ── 嗅探 ── */
function sniff(u8, name){
  const n = String(name || '').toLowerCase();
  if (u8.length >= 9 && utf8(u8.subarray(0, 9)) === 'gimp xcf ') return 'xcf';
  if (u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b){
    if (u8.length >= 54 && utf8(u8.subarray(30, 38)) === 'mimetype'){
      const mt = utf8(u8.subarray(38, 38 + 40));
      if (mt.startsWith('application/x-krita')) return 'kra';
      if (mt.startsWith('image/openraster')) return 'ora';
    }
    if (/\.kra$/.test(n)) return 'kra';
    if (/\.ora$/.test(n)) return 'ora';
    if (/\.procreate$/.test(n)) return 'procreate';
    return null;
  }
  if (/\.(kra|ora|procreate|xcf)$/.test(n)) return n.split('.').pop();
  return null;
}

/* ═══════════ OpenRaster ═══════════ */
const xmlDoc = s => { const d = new DOMParser().parseFromString(s, 'application/xml'); if (d.getElementsByTagName('parsererror').length) throw new Bad('the layer list (XML) in this file is damaged'); return d; };
const kids = (el, tag) => Array.from(el.children).filter(c => !tag || c.tagName === tag);
async function decodeOra(u8){
  const z = new Zip(u8), sx = await z.text('stack.xml');
  if (!sx) throw new Bad('not an OpenRaster file (no stack.xml)');
  const doc = xmlDoc(sx), img = doc.documentElement, W = +img.getAttribute('w') | 0, H = +img.getAttribute('h') | 0, notes = new Set();
  if (!(W > 0 && H > 0)) throw new Bad('OpenRaster image size missing');
  const num = (el, a, d) => { const v = parseFloat(el.getAttribute(a)); return Number.isFinite(v) ? v : d; };
  const walk = async st => {
    const out = [];
    for (const el of kids(st)){                                                // 上→下
      const base = {name:el.getAttribute('name') || '', hidden:el.getAttribute('visibility') === 'hidden', opacity:clamp01(num(el, 'opacity', 1))};
      if (el.tagName === 'stack'){
        const iso = el.getAttribute('isolation'), op = el.getAttribute('composite-op');
        const blend = op && op !== 'svg:src-over' ? oraBlend(op, notes) : (iso === 'isolate' || base.opacity < 1 ? 'normal' : 'passThrough');
        out.push(Object.assign(base, {kind:'group', blend, children:await walk(el)}));
      } else if (el.tagName === 'layer'){
        const src = el.getAttribute('src'), b = src && await z.bytes(src);
        if (!b){ if (src) notes.add('layer "' + base.name + '" has no picture: skipped'); continue; }
        if (!/\.png$/i.test(src)) notes.add('layer "' + base.name + '" is not a PNG');
        let p; try { p = await pngRGBA(b); } catch (e){ notes.add('layer "' + base.name + '" picture unreadable: skipped'); continue; }
        out.push(Object.assign(base, {kind:'raster', blend:oraBlend(el.getAttribute('composite-op'), notes), x:Math.round(num(el, 'x', 0)), y:Math.round(num(el, 'y', 0)), w:p.w, h:p.h, rgba:p.rgba}));
      } else if (el.tagName === 'text' || el.tagName === 'filter') notes.add('<' + el.tagName + '> elements are not supported: skipped');
    }
    return out.reverse();                                                      // ⇒ 下→上
  };
  const top = kids(img, 'stack')[0];
  return {format:'ora', width:W, height:H, layers:top ? await walk(top) : [], notes:[...notes]};
}

/* ORA 写：树（下→上）⇒ stack.xml（上→下）＋data/*.png＋mergedimage.png＋Thumbnails/thumbnail.png */
async function encodeOra(o){
  const W = o.width | 0, H = o.height | 0, files = [{name:'mimetype', data:new TextEncoder().encode('image/openraster')}], notes = new Set();
  let k = 0;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const attrs = n => `name="${esc(n.name || '')}" visibility="${n.hidden ? 'hidden' : 'visible'}" opacity="${+clamp01(n.opacity === undefined ? 1 : n.opacity).toFixed(4)}"`;
  const op = b => { if (!b || b === 'passThrough') return 'svg:src-over'; if (ORA_OP[b]) return ORA_OP[b]; notes.add('blend mode ' + b + ' saved as Normal'); return 'svg:src-over'; };
  const walk = async (list, ind) => {
    let x = '';
    for (const n of [...list].reverse()){
      if (n.kind === 'group'){
        x += `${ind}<stack ${attrs(n)} composite-op="${op(n.blend)}" isolation="${n.blend === 'passThrough' ? 'auto' : 'isolate'}">\n${await walk(n.children || [], ind + ' ')}${ind}</stack>\n`;
        continue;
      }
      const src = `data/layer${k++}.png`;
      files.push({name:src, data:await rgbaPNG(n.rgba, n.w, n.h)});
      x += `${ind}<layer ${attrs(n)} composite-op="${op(n.blend)}" src="${src}" x="${n.x | 0}" y="${n.y | 0}"/>\n`;
    }
    return x;
  };
  const body = await walk(o.layers || [], '  ');
  files.push({name:'stack.xml', data:new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.5" w="${W}" h="${H}" xres="${o.dpi || 72}" yres="${o.dpi || 72}">\n <stack>\n${body} </stack>\n</image>\n`)});
  files.push({name:'mergedimage.png', data:await rgbaPNG(o.merged, W, H)});
  { const s = Math.min(1, 256 / Math.max(W, H)), tw = Math.max(1, Math.round(W * s)), th = Math.max(1, Math.round(H * s));
    const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(o.merged.buffer, o.merged.byteOffset, W * H * 4), W, H), 0, 0);
    const t = document.createElement('canvas'); t.width = tw; t.height = th; t.getContext('2d').drawImage(c, 0, 0, tw, th);
    files.push({name:'Thumbnails/thumbnail.png', data:new Uint8Array(await (await new Promise(r => t.toBlob(r, 'image/png'))).arrayBuffer())}); }
  return {bytes:zipStore(files), notes:[...notes]};
}

/* ═══════════ Krita ═══════════ */
/* LZF（Krita 方块）：ctrl<32 ⇒ ctrl+1 个原字；否则往回拷 */
function lzf(src, outLen){
  const out = new Uint8Array(outLen); let ip = 0, op = 0;
  while (ip < src.length && op < outLen){
    const c = src[ip++];
    if (c < 32){ for (let n = c + 1; n > 0 && op < outLen; n--) out[op++] = src[ip++]; }
    else {
      let len = c >> 5; if (len === 7) len += src[ip++];
      let ref = op - ((c & 0x1f) << 8) - src[ip++] - 1;
      if (ref < 0) throw new Bad('damaged Krita tile data');
      for (let n = len + 2; n > 0 && op < outLen; n--) out[op++] = out[ref++];
    }
  }
  return out;
}
/* Krita 颜色空间 ⇒ {ch 通道数, bytes 每通道位元组, kind:'u8'|'u16'|'f16'|'f32', gray} */
function kraSpace(cs){
  const s = String(cs || 'RGBA');
  const gray = /^GRAYA/.test(s), ch = gray ? 2 : 4;
  if (/F32$/.test(s)) return {ch, bytes:4, kind:'f32', gray};
  if (/F16$/.test(s)) return {ch, bytes:2, kind:'f16', gray};
  if (/16$/.test(s)) return {ch, bytes:2, kind:'u16', gray};
  if (/^(RGBA|GRAYA)$/.test(s)) return {ch, bytes:1, kind:'u8', gray};
  return null;
}
/* 一层的方块档 ⇒ 全幅 RGBA（W×H·非预乘）；ox／oy＝层偏移 */
function kraTiles(u8, sp, linear, W, H, ox, oy, defPix, maskOnly){
  const text = (a, b) => utf8(u8.subarray(a, b));
  let p = 0; const line = () => { const e = u8.indexOf(10, p); const s = text(p, e < 0 ? u8.length : e); p = e < 0 ? u8.length : e + 1; return s; };
  const head = {}; for (let i = 0; i < 6; i++){ const s = line(), m = /^(\w+) (\S+)/.exec(s); if (!m) break; head[m[1]] = m[2]; if (m[1] === 'DATA') break; }
  const tw = +head.TILEWIDTH || 64, th = +head.TILEHEIGHT || 64, ps = +head.PIXELSIZE || sp.ch * sp.bytes, nTiles = +head.DATA || 0;
  const out = maskOnly ? new Uint8Array(W * H) : new Uint8ClampedArray(W * H * 4);
  const conv = mkConv(sp, linear);
  const px = new Array(4);
  const put = (data, X0, Y0, planar) => {
    const n = tw * th;
    for (let ty = 0; ty < th; ty++){
      const Y = Y0 + ty; if (Y < 0 || Y >= H) continue;
      for (let tx = 0; tx < tw; tx++){
        const X = X0 + tx; if (X < 0 || X >= W) continue;
        const i = ty * tw + tx;
        conv(data, i, n, planar, px);
        if (maskOnly) out[Y * W + X] = px[0];
        else { const o = (Y * W + X) * 4; out[o] = px[0]; out[o + 1] = px[1]; out[o + 2] = px[2]; out[o + 3] = px[3]; }
      }
    }
  };
  if (defPix && defPix.length >= ps && defPix.some(v => v)){                  // 预设像素不透明 ⇒ 先铺满
    const t = new Uint8Array(tw * th * ps); for (let i = 0; i < tw * th; i++) t.set(defPix.subarray(0, ps), i * ps);
    for (let Y = 0; Y < H; Y += th) for (let X = 0; X < W; X += tw) put(t, X, Y, false);
  }
  for (let k = 0; k < nTiles && p < u8.length; k++){
    const m = /^(-?\d+),(-?\d+),(\w+),(\d+)/.exec(line()); if (!m) break;
    const x = +m[1], y = +m[2], size = +m[4], blk = u8.subarray(p, p + size); p += size;
    const want = tw * th * ps;
    let data;
    if (blk[0] === 1) data = lzf(blk.subarray(1), want);
    else data = blk.subarray(1, 1 + want);
    put(data, x + ox, y + oy, true);
  }
  return out;
}
/* 像素换算：planar＝按位元组分开存（Krita 方块）；返回 px=[r,g,b,a]（遮罩只看 px[0]） */
function mkConv(sp, linear){
  const B = sp.bytes, C = sp.ch, ps = B * C;
  const rd = (data, i, n, planar, c) => {                                    // 第 c 个通道的数值（0..1 或 0..255）
    const at = b => (planar ? data[(c * B + b) * n + i] : data[i * ps + c * B + b]);
    if (B === 1) return at(0);
    if (sp.kind === 'u16') return (at(0) | (at(1) << 8)) / 257;                 // little-endian
    if (sp.kind === 'f16') return half(at(0) | (at(1) << 8));
    const buf = new DataView(new ArrayBuffer(4)); for (let b = 0; b < 4; b++) buf.setUint8(b, at(b)); return buf.getFloat32(0, true);
  };
  const f = sp.kind === 'f16' || sp.kind === 'f32';
  const col = v => (f ? (linear ? lin2s(v) : Math.round(clamp01(v) * 255)) : Math.round(v));
  const alp = v => (f ? Math.round(clamp01(v) * 255) : Math.round(v));
  if (sp.gray) return (data, i, n, planar, px) => { const g = col(rd(data, i, n, planar, 0)); px[0] = px[1] = px[2] = g; px[3] = alp(rd(data, i, n, planar, 1)); };
  if (C === 1) return (data, i, n, planar, px) => { px[0] = alp(rd(data, i, n, planar, 0)); };
  // Krita RGBA 8／16 位整数存 BGRA；浮点存 RGBA
  const order = f ? [0, 1, 2] : [2, 1, 0];
  return (data, i, n, planar, px) => { px[0] = col(rd(data, i, n, planar, order[0])); px[1] = col(rd(data, i, n, planar, order[1])); px[2] = col(rd(data, i, n, planar, order[2])); px[3] = alp(rd(data, i, n, planar, 3)); };
}
async function decodeKra(u8){
  const z = new Zip(u8), xml = await z.text('maindoc.xml');
  if (!xml) throw new Bad('not a Krita file (no maindoc.xml)');
  const doc = xmlDoc(xml), image = doc.getElementsByTagName('IMAGE')[0];
  if (!image) throw new Bad('Krita file has no image');
  const W = +image.getAttribute('width') | 0, H = +image.getAttribute('height') | 0, dname = image.getAttribute('name') || '', notes = new Set();
  const lin = el => /g10|linear/i.test(el.getAttribute('profile') || image.getAttribute('profile') || '');
  const dir = n => {                                                          // 方块档的资料夹（照文件名；找不到就用唯一的那个 layers 资料夹）
    const want = dname + '/layers/' + n; if (z.has(want)) return want;
    const hit = z.names().find(x => x.endsWith('/layers/' + n)); return hit || null;
  };
  const SKIP = {shapelayer:'vector layer', adjustmentlayer:'filter layer', generatorlayer:'fill layer', clonelayer:'clone layer', filelayer:'file layer'};
  const paint = async (el, csAttr) => {
    const fn = el.getAttribute('filename'), path = fn && dir(fn);
    if (!path) return null;
    const sp = kraSpace(csAttr || el.getAttribute('colorspacename')); if (!sp){ notes.add('color space ' + el.getAttribute('colorspacename') + ' is not supported: layer "' + el.getAttribute('name') + '" skipped'); return null; }
    const def = await z.bytes(path + '.defaultpixel');
    return kraTiles(await z.bytes(path), sp, lin(el), W, H, +el.getAttribute('x') | 0, +el.getAttribute('y') | 0, def, false);
  };
  const walk = async layersEl => {
    const out = [];
    for (const el of kids(layersEl, 'layer')){                                 // 上→下
      const type = el.getAttribute('nodetype'), name = el.getAttribute('name') || '';
      const base = {name, hidden:el.getAttribute('visible') === '0', opacity:clamp01((+el.getAttribute('opacity') || 0) / 255)};
      const op = el.getAttribute('compositeop') || 'normal';
      let blend = KRA_BLEND[op]; if (!blend){ notes.add('blend mode "' + op + '" is not available: shown as Normal'); blend = 'normal'; }
      if (type === 'grouplayer'){
        const sub = kids(el, 'layers')[0];
        out.push(Object.assign(base, {kind:'group', blend:el.getAttribute('passthrough') === '1' ? 'passThrough' : blend, children:sub ? await walk(sub) : []}));
        continue;
      }
      if (type !== 'paintlayer'){ notes.add((SKIP[type] || type) + ' "' + name + '" is not supported: skipped'); continue; }
      const rgba = await paint(el); if (!rgba) continue;
      const n = Object.assign(base, {kind:'raster', blend, x:0, y:0, w:W, h:H, rgba});
      const masks = kids(el, 'masks')[0];
      if (masks) for (const m of kids(masks, 'mask')){
        const mt = m.getAttribute('nodetype');
        if (mt === 'transparencymask' && !n.mask){
          const fn = m.getAttribute('filename'), path = fn && dir(fn);
          if (path) n.mask = {alpha:kraTiles(await z.bytes(path), {ch:1, bytes:1, kind:'u8'}, false, W, H, +m.getAttribute('x') | 0, +m.getAttribute('y') | 0, await z.bytes(path + '.defaultpixel'), true), enabled:m.getAttribute('visible') !== '0'};
        } else notes.add((mt === 'filtermask' ? 'filter mask' : mt === 'selectionmask' ? 'selection mask' : mt || 'mask') + ' on "' + name + '" is not supported: skipped');
      }
      if (el.getAttribute('channellockflags') === '0001') n.lockAlpha = true;
      out.push(n);
    }
    return out.reverse();
  };
  const top = kids(image, 'layers')[0];
  const layers = top ? await walk(top) : [];
  return {format:'kra', width:W, height:H, layers:cropTree(layers, W, H), notes:[...notes]};
}
/* 全幅的像素层剪到有内容的那块（组照样往下） */
function cropTree(list, W, H){
  return list.map(n => {
    if (n.kind === 'group'){ n.children = cropTree(n.children, W, H); return n; }
    return Object.assign(n, cropRGBA(n.rgba, W, H) || {x:0, y:0, w:0, h:0, rgba:new Uint8ClampedArray(0)});
  });
}

/* ═══════════ GIMP XCF ═══════════ */
async function decodeXcf(u8){
  const d = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), notes = new Set();
  if (utf8(u8.subarray(0, 9)) !== 'gimp xcf ') throw new Bad('not a GIMP (.xcf) file');
  const vs = utf8(u8.subarray(9, 13)), ver = vs === 'file' ? 0 : /^v\d{3}$/.test(vs) ? +vs.slice(1) : NaN;
  if (!Number.isFinite(ver)) throw new Bad('unknown XCF version');
  let o = 14;
  const u32 = () => { const v = d.getUint32(o); o += 4; return v; }, i32 = () => { const v = d.getInt32(o); o += 4; return v; };
  const ptr = () => (ver >= 11 ? (o += 8, Number(d.getBigUint64(o - 8))) : u32());
  const str = () => { const n = u32(); const s = n ? utf8(u8.subarray(o, o + n - 1)) : ''; o += n; return s; };
  const W = u32(), H = u32(), base = u32();
  let prec = 150;
  if (ver >= 4){ const p = u32(); prec = ver === 4 ? [150, 250, 300, 500, 600][p] || 150 : ver <= 6 ? ({100:100, 150:150, 200:200, 250:250, 300:300, 350:350, 400:500, 450:550, 500:600, 550:650})[p] || p : p; }
  const linear = Math.round(prec / 50) % 2 === 0;                              // 100、200…＝线性；150、250…＝非线性
  const comp = {100:['u8', 1], 150:['u8', 1], 200:['u16', 2], 250:['u16', 2], 300:['u32', 4], 350:['u32', 4], 500:['f16', 2], 550:['f16', 2], 600:['f32', 4], 650:['f32', 4], 700:['f64', 8], 750:['f64', 8]}[prec];
  if (!comp) throw new Bad('XCF precision ' + prec + ' is not supported');
  if (base > 2) throw new Bad('XCF image type ' + base + ' is not supported');
  let compression = 0, cmap = null;
  const props = () => { const ps = []; for (;;){ const t = u32(), n = u32(); if (t === 0){ o += n; break; } ps.push({t, n, at:o}); o += n; } return ps; };
  for (const p of props()){
    if (p.t === 17) compression = u8[p.at];
    else if (p.t === 1){ const k = d.getUint32(p.at); cmap = u8.slice(p.at + 4, p.at + 4 + k * 3); }
  }
  const lptrs = []; for (;;){ const q = ptr(); if (!q) break; lptrs.push(q); }
  const [ck, cb] = comp;
  const rdComp = (b, i) => {                                                  // 一个分量 ⇒ 0..1（整数）或浮点；big-endian
    if (ck === 'u8') return b[i] / 255;
    if (ck === 'u16') return ((b[i] << 8) | b[i + 1]) / 65535;
    if (ck === 'u32') return ((b[i] << 24 >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]) / 4294967295;
    if (ck === 'f16') return half((b[i] << 8) | b[i + 1]);
    const v = new DataView(b.buffer, b.byteOffset + i, cb); return ck === 'f32' ? v.getFloat32(0) : v.getFloat64(0);
  };
  const col = v => (linear ? lin2s(v) : Math.round(clamp01(v) * 255)), alp = v => Math.round(clamp01(v) * 255);
  /* 层级（hierarchy）⇒ 解好的 W'×H' 资料：chan＝每像素分量数 */
  const tile = async (at, end, tw, th, bpp) => {
    const n = tw * th * bpp;
    if (compression === 0) return u8.subarray(at, at + n);
    if (compression === 2) return (await inflateRaw(u8.subarray(at, end), 'deflate')).subarray(0, n);
    if (compression !== 1) throw new Bad('XCF compression ' + compression + ' is not supported');
    const out = new Uint8Array(n); let p = at;                                 // RLE：每个位元组位置一段
    for (let c = 0; c < bpp; c++){
      let i = 0; const cnt = tw * th;
      while (i < cnt){
        let v = u8[p++];
        if (v >= 128){ let len = 256 - v; if (v === 128){ len = (u8[p] << 8) | u8[p + 1]; p += 2; } for (let k = 0; k < len && i < cnt; k++) out[(i++) * bpp + c] = u8[p++]; }
        else { let len = v + 1; if (v === 127){ len = (u8[p] << 8) | u8[p + 1]; p += 2; } const b = u8[p++]; for (let k = 0; k < len && i < cnt; k++) out[(i++) * bpp + c] = b; }
      }
    }
    return out;
  };
  const hierarchy = async hp => {
    o = hp; const hw = u32(), hh = u32(), bpp = u32(); const lp = ptr();
    o = lp; const lw = u32(), lh = u32(); const tps = []; for (;;){ const q = ptr(); if (!q) break; tps.push(q); }
    const out = new Uint8Array(lw * lh * bpp), cols = Math.ceil(lw / 64), rows = Math.ceil(lh / 64);
    for (let k = 0; k < tps.length && k < cols * rows; k++){
      const tx = (k % cols) * 64, ty = Math.floor(k / cols) * 64, tw = Math.min(64, lw - tx), th = Math.min(64, lh - ty);
      const end = k + 1 < tps.length ? tps[k + 1] : Math.min(u8.length, tps[k] + tw * th * bpp * 2 + 1024);
      const t = await tile(tps[k], end, tw, th, bpp);
      for (let y = 0; y < th; y++) out.set(t.subarray(y * tw * bpp, (y + 1) * tw * bpp), ((ty + y) * lw + tx) * bpp);
    }
    return {w:hw, h:hh, bpp, data:out};
  };
  const nodes = [], byPath = new Map();
  for (const lp of lptrs){
    o = lp;
    const lw = u32(), lh = u32(), type = u32(), name = str();
    let opacity = 1, visible = true, mode = 28, ox = 0, oy = 0, group = false, path = null, applyMask = true, fop = null, textLayer = false, clip = false;
    for (const p of props()){
      if (p.t === 6) opacity = d.getUint32(p.at) / 255;
      else if (p.t === 33) fop = d.getFloat32(p.at);
      else if (p.t === 7) mode = d.getUint32(p.at);
      else if (p.t === 8) visible = d.getUint32(p.at) !== 0;
      else if (p.t === 15){ ox = d.getInt32(p.at); oy = d.getInt32(p.at + 4); }
      else if (p.t === 29) group = true;
      else if (p.t === 30){ path = []; for (let q = 0; q < p.n / 4; q++) path.push(d.getUint32(p.at + q * 4)); }
      else if (p.t === 11) applyMask = d.getUint32(p.at) !== 0;
      else if (p.t === 26) textLayer = true;
      else if (p.t === 44) clip = d.getUint32(p.at) !== 0;                     // PROP_CLIP（GIMP 3·剪贴到下一层）
    }
    if (fop !== null) opacity = clamp01(fop);
    const hp = ptr(), mp = ptr();
    let blend = XCF_BLEND[mode];
    if (blend === undefined){ notes.add('GIMP layer mode ' + mode + ' is not available: shown as Normal'); blend = 'normal'; }
    if (group && mode === 61) blend = 'passThrough';
    else if (group && blend === 'normal') blend = 'normal';
    if (!group && blend === 'passThrough') blend = 'normal';
    if (textLayer) notes.add('text layers open as pixels');
    const node = {name, hidden:!visible, opacity, blend};
    if (group){ Object.assign(node, {kind:'group', children:[]}); }
    else {
      const h = await hierarchy(hp), rgba = new Uint8ClampedArray(lw * lh * 4), bpp = h.bpp;
      const nch = bpp / cb, hasA = type === 1 || type === 3 || type === 5;
      for (let i = 0, s = 0; i < lw * lh; i++, s += bpp){
        const q = i * 4;
        if (type === 4 || type === 5){ const ix = h.data[s] * 3; rgba[q] = cmap ? cmap[ix] : 0; rgba[q + 1] = cmap ? cmap[ix + 1] : 0; rgba[q + 2] = cmap ? cmap[ix + 2] : 0; rgba[q + 3] = hasA ? h.data[s + 1] : 255; continue; }
        if (type === 2 || type === 3){ const g = col(rdComp(h.data, s)); rgba[q] = rgba[q + 1] = rgba[q + 2] = g; rgba[q + 3] = hasA && nch > 1 ? alp(rdComp(h.data, s + cb)) : 255; continue; }
        rgba[q] = col(rdComp(h.data, s)); rgba[q + 1] = col(rdComp(h.data, s + cb)); rgba[q + 2] = col(rdComp(h.data, s + 2 * cb)); rgba[q + 3] = hasA && nch > 3 ? alp(rdComp(h.data, s + 3 * cb)) : 255;
      }
      Object.assign(node, {kind:'raster', x:ox, y:oy, w:lw, h:lh, rgba});
      if (clip) node.clipped = true;
      if (mp){                                                                 // 图层蒙版（灰阶通道·跟层同大小同偏移）
        o = mp; const mw = u32(), mh = u32(); str(); let mvis = true; for (const p of props()) if (p.t === 8) mvis = d.getUint32(p.at) !== 0; void mvis;
        const mh_ = await hierarchy(ptr()), alpha = new Uint8Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
          const lx = x - ox, ly = y - oy;
          alpha[y * W + x] = lx >= 0 && ly >= 0 && lx < mw && ly < mh ? alp(rdComp(mh_.data, (ly * mw + lx) * mh_.bpp)) : 0;
        }
        node.mask = {alpha, enabled:applyMask};
      }
    }
    nodes.push({node, path});
  }
  // 组：项目路径（父层路径＋自己在父层里的位置）；没路径＝最上层；XCF 层序上→下
  const root = []; let topIdx = 0;
  for (const it of nodes) if (!it.path) it.path = [topIdx++];                // 最上层的项目档里不写路径：照顺序补
  for (const {node, path} of nodes){
    const key = path ? path.join('/') : null;
    if (key) byPath.set(key, node);
    const parent = path && path.length > 1 ? byPath.get(path.slice(0, -1).join('/')) : null;
    (parent && parent.children ? parent.children : root).push(node);
  }
  const flip = list => { list.reverse(); for (const n of list) if (n.children) flip(n.children); return list; };
  return {format:'xcf', width:W, height:H, layers:flip(root), notes:[...notes]};
}

/* ═══════════ Procreate ═══════════ */
/* 二进位 plist（bplist00）⇒ JS 值（UID ⇒ {uid}） */
function bplist(u8){
  const d = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (utf8(u8.subarray(0, 8)) !== 'bplist00') throw new Bad('Procreate document data is damaged (not a binary plist)');
  const t = u8.length - 32, os = u8[t + 6], rs = u8[t + 7];
  const num = Number(d.getBigUint64(t + 8)), top = Number(d.getBigUint64(t + 16)), tab = Number(d.getBigUint64(t + 24));
  const uint = (p, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + u8[p + i]; return v; };
  const offs = []; for (let i = 0; i < num; i++) offs.push(uint(tab + i * os, os));
  const cache = new Map();
  const obj = i => {
    if (cache.has(i)) return cache.get(i);
    let p = offs[i]; const m = u8[p++], hi = m >> 4; let lo = m & 15;
    const cnt = () => { if (lo !== 15) return lo; const mm = u8[p++], n = 1 << (mm & 15); const v = uint(p, n); p += n; return v; };
    let v;
    if (hi === 0) v = lo === 8 ? false : lo === 9 ? true : null;
    else if (hi === 1){ const n = 1 << lo; v = n === 8 ? Number(d.getBigInt64(p)) : uint(p, n); }
    else if (hi === 2) v = lo === 2 ? d.getFloat32(p) : d.getFloat64(p);
    else if (hi === 3) v = d.getFloat64(p);
    else if (hi === 4){ const n = cnt(); v = u8.subarray(p, p + n); }
    else if (hi === 5){ const n = cnt(); v = String.fromCharCode(...u8.subarray(p, p + n)); }
    else if (hi === 6){ const n = cnt(); let s = ''; for (let k = 0; k < n; k++) s += String.fromCharCode(d.getUint16(p + k * 2)); v = s; }
    else if (hi === 8) v = {uid:uint(p, lo + 1)};
    else if (hi === 10 || hi === 12){ const n = cnt(); v = []; cache.set(i, v); for (let k = 0; k < n; k++) v.push(obj(uint(p + k * rs, rs))); return v; }
    else if (hi === 13){ const n = cnt(); v = {}; cache.set(i, v); for (let k = 0; k < n; k++) v[obj(uint(p + k * rs, rs))] = obj(uint(p + (n + k) * rs, rs)); return v; }
    else v = null;
    cache.set(i, v); return v;
  };
  return obj(top);
}
/* NSKeyedArchiver：物件表＋$top ⇒ get(物件, 键) 自动顺 UID */
function nsArchive(pl){
  const objs = pl && pl.$objects; if (!Array.isArray(objs)) throw new Bad('Procreate document data is damaged (not an archive)');
  const deref = v => (v && typeof v === 'object' && typeof v.uid === 'number' ? objs[v.uid] : v);
  const val = v => { v = deref(v); if (v === '$null') return null; if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array)){ if ('NS.string' in v) return deref(v['NS.string']); if ('NS.data' in v) return deref(v['NS.data']); if ('NS.objects' in v) return deref(v['NS.objects']).map(deref); } return v; };
  const cls = o => { const c = o && deref(o.$class); return c ? c.$classname : null; };
  const root = deref(pl.$top && pl.$top.root);
  return {root, get:(o, k) => val(o && o[k]), cls};
}
/* LZO1X 解压：照 lzokay 的解法（https://github.com/jackoalan/lzokay·MIT·Copyright (c) 2018 Jack Andersen；licenses/lzokay-LICENSE-MIT.txt）。
   每条指令先看高位：M2（0x40 起）、M3（0x20 起）、M4（0x10 起·偏移 0 ＝结尾）、其余看上一条留下的状态（0＝一段原字、1～3＝两字节短拷、4＝三字节拷）；
   拷完再照指令低两位接 0～3 个原字。 */
function lzo1x(src, outLen){
  const out = new Uint8Array(outLen); let ip = 0, op = 0, state = 0;
  const bad = () => new Bad('damaged Procreate tile data');
  const lits = n => { if (ip + n > src.length || op + n > outLen) throw bad(); for (; n > 0; n--) out[op++] = src[ip++]; };
  const zeros = () => { let n = 0; while (src[ip] === 0){ n += 255; ip++; } return n + src[ip++]; }; // 长度用 0 字节延长
  if (src[0] >= 22){ const n = src[ip++] - 17; lits(n); state = 4; }
  else if (src[0] >= 18){ const n = src[ip++] - 17; lits(n); state = n; }
  for (;;){
    if (ip >= src.length) throw bad();
    const inst = src[ip++]; let len, from, next;
    if (inst & 0xc0){ from = op - ((src[ip++] << 3) + ((inst >> 2) & 7) + 1); len = (inst >> 5) + 1; next = inst & 3; }
    else if (inst & 0x20){
      len = (inst & 0x1f) + 2; if (len === 2) len += zeros() + 31;
      const le = src[ip] | (src[ip + 1] << 8); ip += 2; from = op - ((le >> 2) + 1); next = le & 3;
    } else if (inst & 0x10){
      len = (inst & 7) + 2; if (len === 2) len += zeros() + 7;
      const le = src[ip] | (src[ip + 1] << 8); ip += 2; from = op - (((inst & 8) << 11) + (le >> 2)); next = le & 3;
      if (from === op) return out;                                           // 结尾记号
      from -= 16384;
    } else if (state === 0){ let n = inst + 3; if (n === 3) n += zeros() + 15; lits(n); state = 4; continue; }
    else if (state !== 4){ next = inst & 3; from = op - ((inst >> 2) + (src[ip++] << 2) + 1); len = 2; }
    else { next = inst & 3; from = op - ((inst >> 2) + (src[ip++] << 2) + 2049); len = 3; }
    if (from < 0 || op + len > outLen) throw bad();
    for (; len > 0; len--) out[op++] = out[from++];
    state = next; lits(next);
  }
}
/* LZ4 区块（Apple 的 bv41／bv4-／bv4$ 包装·区块可往回参照之前的输出） */
function lz4bv(src, outLen){
  const out = new Uint8Array(outLen), d = new DataView(src.buffer, src.byteOffset, src.byteLength); let ip = 0, op = 0;
  while (ip + 4 <= src.length){
    const mg = utf8(src.subarray(ip, ip + 4)); ip += 4;
    if (mg === 'bv4$') break;
    const dl = d.getUint32(ip, true), el = d.getUint32(ip + 4, true); ip += 8;
    if (mg === 'bv4-'){ out.set(src.subarray(ip, ip + Math.min(el, outLen - op)), op); op += el; ip += el; continue; }
    if (mg !== 'bv41') throw new Bad('damaged Procreate tile data (LZ4)');
    const end = ip + el, stop = op + dl;
    while (ip < end && op < stop){
      const tok = src[ip++]; let ln = tok >> 4;
      if (ln === 15){ let b; do { b = src[ip++]; ln += b; } while (b === 255); }
      for (; ln > 0; ln--) out[op++] = src[ip++];
      if (ip >= end) break;
      const off = src[ip] | (src[ip + 1] << 8); ip += 2;
      let ml = tok & 15; if (ml === 15){ let b; do { b = src[ip++]; ml += b; } while (b === 255); } ml += 4;
      let r = op - off; for (; ml > 0; ml--) out[op++] = out[r++];
    }
    ip = end;
  }
  return out;
}
async function decodeProcreate(u8){
  const z = new Zip(u8), ab = await z.bytes('Document.archive');
  if (!ab) throw new Bad('not a Procreate file (no Document.archive)');
  const A = nsArchive(bplist(ab)), R = A.root, notes = new Set();
  const size = /\{\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\}/.exec(String(A.get(R, 'size') || ''));
  if (!size) throw new Bad('Procreate canvas size missing');
  const CW = Math.round(+size[1]), CH = Math.round(+size[2]), T = +A.get(R, 'tileSize') || 256;
  const cols = Math.ceil(CW / T), rows = Math.ceil(CH / T);
  const names = z.names();
  /* 一层的方块（<UUID>/<列>~<行>.chunk）⇒ CW×CH（上→下） */
  const pixels = async (uuid, gray) => {
    const out = gray ? new Uint8Array(CW * CH).fill(255) : new Uint8ClampedArray(CW * CH * 4), ch = gray ? 1 : 4;   // 蒙版没存的方块＝全露
    const pre = uuid + '/';
    for (const n of names){
      if (!n.startsWith(pre)) continue;
      const m = /^(\d+)~(\d+)\.(chunk|lz4)$/.exec(n.slice(pre.length)); if (!m) continue;
      const c = +m[1], r = +m[2]; if (c >= cols || r >= rows) continue;
      const tw = c === cols - 1 ? CW - c * T : T, th = r === rows - 1 ? CH - r * T : T, len = tw * th * ch;
      const raw = await z.bytes(n), data = m[3] === 'lz4' ? lz4bv(raw, len) : lzo1x(raw, len);
      // Procreate 照 OpenGL 存：行号从画布底部往上数、方块里也是下→上 ⇒ 这里直接翻正
      for (let y = 0; y < th; y++) out.set(data.subarray(y * tw * ch, (y + 1) * tw * ch), ((CH - 1 - (r * T + y)) * CW + c * T) * ch);
    }
    return gray ? out : unpremul(out);
  };
  const layer = async o => {
    const uuid = A.get(o, 'UUID'), name = A.get(o, 'name') || '';
    const eb = A.get(o, 'extendedBlend'), bv = eb !== null && eb !== undefined ? eb : A.get(o, 'blend');
    let blend = PRO_BLEND[bv]; if (blend === undefined){ notes.add('Procreate blend mode ' + bv + ' is not available: shown as Normal'); blend = 'normal'; }
    const n = {kind:'raster', name, hidden:!!A.get(o, 'hidden'), opacity:clamp01(+A.get(o, 'opacity')), blend, x:0, y:0, w:CW, h:CH, rgba:await pixels(uuid, false)};
    if (A.get(o, 'clipped')) n.clipped = true;
    const mk = A.get(o, 'mask');
    if (mk && typeof mk === 'object') n.mask = {alpha:await pixels(A.get(mk, 'UUID'), true), enabled:!A.get(mk, 'hidden')};
    if (A.get(o, 'type') === 1 || A.get(o, 'text')) notes.add('text layers open as pixels');
    return n;
  };
  const walk = async list => {
    const out = [];
    for (const o of list || []){                                               // 上→下
      const c = A.cls(o);
      if (c === 'SilicaGroup') out.push({kind:'group', name:A.get(o, 'name') || '', hidden:!!A.get(o, 'isHidden'), opacity:1, blend:'passThrough', children:await walk(A.get(o, 'children'))});
      else if (c === 'SilicaLayer') out.push(await layer(o));
    }
    return out.reverse();
  };
  let layers = await walk(A.get(R, 'unwrappedLayers') || A.get(R, 'layers'));
  // 背景色（Procreate 的背景不是图层·这里补一层在最下面）
  const bg = A.get(R, 'backgroundColor');
  if (bg instanceof Uint8Array && bg.length >= 16){
    const dv = new DataView(bg.buffer, bg.byteOffset, 16), c = [0, 1, 2, 3].map(k => dv.getFloat32(k * 4, true));
    const rgba = new Uint8ClampedArray(CW * CH * 4), px = [Math.round(clamp01(c[0]) * 255), Math.round(clamp01(c[1]) * 255), Math.round(clamp01(c[2]) * 255), Math.round(clamp01(c[3]) * 255)];
    for (let i = 0; i < CW * CH; i++) rgba.set(px, i * 4);
    layers.unshift({kind:'raster', name:'Background', hidden:!!A.get(R, 'backgroundHidden'), opacity:1, blend:'normal', x:0, y:0, w:CW, h:CH, rgba, background:true});
  }
  // 方向：orientation 1 不转、2 转 180、3 顺时针 270、4 顺时针 90；再照翻转
  const ori = +A.get(R, 'orientation') || 1, fh = !!A.get(R, 'flippedHorizontally'), fv = !!A.get(R, 'flippedVertically');
  const rot = {1:0, 2:180, 3:270, 4:90}[ori] || 0, W = rot % 180 ? CH : CW, H = rot % 180 ? CW : CH;
  const tf = (src, ch) => {
    if (!rot && !fh && !fv) return src;
    const out = new src.constructor(W * H * ch);
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++){
      let X = x, Y = y;
      if (rot === 90){ X = CH - 1 - y; Y = x; } else if (rot === 180){ X = CW - 1 - x; Y = CH - 1 - y; } else if (rot === 270){ X = y; Y = CW - 1 - x; }
      if (fh) X = W - 1 - X; if (fv) Y = H - 1 - Y;
      const s = (y * CW + x) * ch, dd = (Y * W + X) * ch; for (let k = 0; k < ch; k++) out[dd + k] = src[s + k];
    }
    return out;
  };
  const fix = list => list.map(n => {
    if (n.kind === 'group'){ n.children = fix(n.children); return n; }
    const rgba = tf(n.rgba, 4), mask = n.mask ? Object.assign(n.mask, {alpha:tf(n.mask.alpha, 1)}) : null;
    if (n.background) return Object.assign(n, {rgba, w:W, h:H});
    return Object.assign(n, cropRGBA(rgba, W, H) || {x:0, y:0, w:0, h:0, rgba:new Uint8ClampedArray(0)}, mask ? {mask} : {});
  });
  layers = fix(layers);
  // Procreate 自存的合成图（composite 那层·不含背景色）：给比对用
  const comp = A.get(R, 'composite'), cu = comp && typeof comp === 'object' ? A.get(comp, 'UUID') : null;
  const merged = cu ? tf(await pixels(cu, false), 4) : null;
  return {format:'procreate', width:W, height:H, layers, notes:[...notes], merged};
}

async function decode(bytes, name){
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), f = sniff(u8, name);
  if (f === 'xcf') return await decodeXcf(u8);
  if (f === 'kra') return await decodeKra(u8);
  if (f === 'ora') return await decodeOra(u8);
  if (f === 'procreate') return await decodeProcreate(u8);
  if (/\.xcf\.(gz|bz2|xz)$/i.test(name || '')) throw new Bad('compressed GIMP files (.xcf.gz etc.) are not supported: save as plain .xcf');
  throw new Bad('not a Krita, OpenRaster, GIMP or Procreate file');
}

window.RasterIO = {sniff, decode, encodeOra, Bad, _lzf:lzf, _lzo:lzo1x, _lz4:lz4bv, _bplist:bplist, _zipStore:zipStore, _zipEntries:zipEntries};
})();
