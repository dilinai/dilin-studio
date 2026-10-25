/* 堤麟画板 · 共用剪贴簿（DlClipboard）—— PS 编辑单与 AI 编辑单的剪下／拷贝／贴上共用这一份
   🔴 像素那一种的格式「沿用」现有 PS 编辑单的剪贴板（menus/impl/ps-edit.js:253-283 的 Clip）：
        {px:Uint8ClampedArray（straight RGBA 0..255）, bounds:[x0,y0,x1,y1]（文件坐标）}
      ——ps-edit 的 lift／pasteImpl 原样能吃，PS 那边把 `Clip` 换成 DlClipboard.pixels() ／ setPixels() 即可。
   三种内容（照 vectorcraft engine/src/cmd/clipboard.rs:62-111 Clipboard）：
     pixels  像素：{px, bounds}（＋ from:'ps'|'ai'）
     shapes  矢量：{shapes:[形状深拷贝，已换成「文件坐标」], texts:[文字层快照], bounds:{x0,y0,x1,y1}, sourceLayer:{id,name}, sourceArtboard:[0,0,W,H], docSerial}
             （Clipboard.copy：物件＋来源图层名（贴上记住图层用）＋来源画板＋来源文件）
     layer   整层：{layer:图层快照（矢量／文字层＝JSON；像素层＝px＋bounds）}（PS 拷贝文字层、或 agent 指定整层用）
   另外顺手写进系统剪贴簿（navigator.clipboard.write：image/png ＋ text/plain〔矢量＝SVG 码（原码 clipboard.rs 的 SVG flavour）、文字＝内文〕），
   贴上时内部是空的、系统剪贴簿有图 ⇒ 由各编辑单把系统的图贴成新像素层（readSystem 帮忙读）。
   给测试与 agent：DlClipboard.get()／kind()／info()／clear()／asPixels()／asSVG()。注释简体中文。 */
(function(){
'use strict';
if (window.DlClipboard) return;

const clone = o => JSON.parse(JSON.stringify(o));
const fin = v => typeof v === 'number' && isFinite(v);

/* 一个图层的 JSON 快照（矢量／文字层；像素层另存 px） */
function layerSnap(L){
  const o = {kind:L.kind, name:L.name, visible:L.visible, opacity:L.opacity, blend:L.blend, x:L.x || 0, y:L.y || 0};
  ['style', 'fillOpacity', 'locks'].forEach(k => { if (L[k] !== undefined && L[k] !== null) o[k] = clone(L[k]); });
  if (L.kind === 'raster'){
    const c = L.data.canvas, d = c.getContext('2d', {willReadFrequently:true}).getImageData(0, 0, c.width, c.height).data;
    o.px = new Uint8ClampedArray(d); o.bounds = [o.x, o.y, o.x + c.width, o.y + c.height];
  } else o.data = clone(L.data);
  return o;
}

const C = window.DlClipboard = {
  _c: null,            // 目前的内容（见档头）
  serial: 0,           // 每放一次 +1（各编辑单可以拿来判「系统剪贴簿是不是比我新」）
  published: null,     // 最近一次写进系统剪贴簿的 text/plain（贴上时对照：系统那边变了＝别的程式拷了新东西）
  publishOk: false,

  /* ── 放 ── */
  _set(c){ c.serial = ++this.serial; c.time = Date.now(); this._c = c; this.publish(); return c; },
  /* 像素：px＝straight RGBA；bounds＝[x0,y0,x1,y1] 文件坐标（＝ps-edit 的 Clip） */
  setPixels(px, bounds, meta){
    if (!px || !Array.isArray(bounds) || bounds.length < 4) throw new Error('DlClipboard.setPixels(px, [x0,y0,x1,y1])');
    return this._set(Object.assign({kind:'pixels', px:new Uint8ClampedArray(px), bounds:bounds.slice(0, 4)}, meta || {}));
  },
  /* 矢量物件：o = {shapes, texts?, bounds?, sourceLayer?, sourceArtboard?, docSerial?}；shapes 要已是文件坐标 */
  setShapes(o){
    return this._set(Object.assign({kind:'shapes', shapes:[], texts:[]}, clone(Object.assign({}, o, {px:undefined}))));
  },
  /* 整层 */
  setLayer(L){ return this._set({kind:'layer', layer:layerSnap(L), docSerial:Doc.serial}); },
  clear(){ this._c = null; this.serial++; return true; },

  /* ── 取 ── */
  get(){ return this._c; },
  kind(){ return this._c ? this._c.kind : null; },
  isEmpty(){ return !this._c; },
  info(){
    const c = this._c; if (!c) return {kind:null};
    if (c.kind === 'pixels') return {kind:'pixels', bounds:c.bounds.slice(), w:c.bounds[2] - c.bounds[0], h:c.bounds[3] - c.bounds[1], serial:c.serial};
    if (c.kind === 'shapes') return {kind:'shapes', shapes:c.shapes.length, texts:(c.texts || []).length, bounds:c.bounds || null, serial:c.serial};
    return {kind:'layer', layerKind:c.layer.kind, name:c.layer.name, serial:c.serial};
  },
  /* 像素那一种（ps-edit 原本的 Clip）；矢量／文字／整层也给：渲成像素（PS 贴矢量＝贴成像素） */
  pixels(){ return this.asPixels(); },
  asPixels(){
    const c = this._c; if (!c) return null;
    if (c.kind === 'pixels') return {px:c.px, bounds:c.bounds.slice()};
    if (c.kind === 'layer' && c.layer.kind === 'raster') return {px:c.layer.px, bounds:c.layer.bounds.slice()};
    // 矢量／文字：画进一张文件大小的画布（renderLayer 的同一条路），再裁到有内容的范围
    const cv = this.renderCanvas(1); if (!cv) return null;
    const W = cv.width, H = cv.height, d = cv.getContext('2d', {willReadFrequently:true}).getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
    if (x1 < 0) return null;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) px.set(d.subarray(((y + y0) * W + x0) * 4, ((y + y0) * W + x0 + w) * 4), y * w * 4);
    return {px, bounds:[x0 + c.ox, y0 + c.oy, x0 + c.ox + w, y0 + c.oy + h]};
  },
  /* 矢量／文字内容画成一张画布（原点在 c.ox/c.oy 文件坐标；涵盖内容外框） */
  renderCanvas(scale){
    const c = this._c; if (!c || c.kind === 'pixels') return null;
    const S = scale || 1;
    let b = c.bounds;
    const shapes = c.kind === 'shapes' ? c.shapes : (c.layer.kind === 'vector' ? c.layer.data.shapes.map(s => { const t = clone(s); if (window.shiftShape) shiftShape(t, c.layer.x, c.layer.y); return t; }) : []);
    const texts = c.kind === 'shapes' ? (c.texts || []) : (c.layer.kind === 'text' ? [c.layer] : []);
    if (!b){ b = {x0:0, y0:0, x1:Doc.width, y1:Doc.height}; }
    const pad = 4, ox = Math.floor(b.x0) - pad, oy = Math.floor(b.y0) - pad;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil((b.x1 - ox + pad) * S)); cv.height = Math.max(1, Math.ceil((b.y1 - oy + pad) * S));
    const x = cv.getContext('2d', {willReadFrequently:true});
    x.save(); x.translate(-ox * S, -oy * S);
    shapes.forEach(s => { try { window.drawShape(x, s, S); } catch(e){ console.error(e); } });
    x.restore();
    for (const T of texts){
      // 文字层借引擎的 renderLayer 画（它按文件大小出图，所以位移回 ox/oy）
      const L = {id:'clip', kind:'text', name:T.name, visible:true, opacity:1, blend:'normal', mask:null, x:T.x || 0, y:T.y || 0, _cache:null, _cacheScale:0, data:clone(T.data)};
      const r = renderLayer(L, S);
      x.drawImage(r, -ox * S, -oy * S);
    }
    c.ox = ox; c.oy = oy;
    return cv;
  },
  /* 矢量内容的 SVG 码（clipboard.rs export_svg：给别的程式贴；我们只出形状与文字） */
  asSVG(){
    const c = this._c; if (!c || c.kind === 'pixels') return null;
    const shapes = c.kind === 'shapes' ? c.shapes : (c.layer.kind === 'vector' ? c.layer.data.shapes : []);
    const texts = c.kind === 'shapes' ? (c.texts || []) : (c.layer.kind === 'text' ? [c.layer] : []);
    const b = c.bounds || {x0:0, y0:0, x1:Doc.width, y1:Doc.height};
    const esc = s => String(s).replace(/[<>&"]/g, ch => ({'<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;'}[ch]));
    let body = '';
    for (const s of shapes){
      if (window.ObjRender && ObjRender.toSVG && (s.type === 'group' || s.type === 'compound' || s.type === 'bezier' || s.type === 'rect' || s.type === 'ellipse' || s.type === 'star' || s.type === 'polygon' || s.type === 'path' || s.type === 'line')){
        try { body += ObjRender.toSVG(s); continue; } catch(e){}
      }
    }
    for (const T of texts){ const d = T.data; body += `<text x="${d.x + (T.x || 0)}" y="${d.y + (T.y || 0)}" font-size="${d.size}" font-family="${esc(d.font)}" fill="${esc(d.color)}">${esc(d.text)}</text>`; }
    const w = Math.max(1, b.x1 - b.x0), h = Math.max(1, b.y1 - b.y0);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${+w.toFixed(2)}" height="${+h.toFixed(2)}" viewBox="${+b.x0.toFixed(2)} ${+b.y0.toFixed(2)} ${+w.toFixed(2)} ${+h.toFixed(2)}">${body}</svg>`;
  },
  /* 纯文字（文字层的内文；给系统剪贴簿 text/plain） */
  asText(){
    const c = this._c; if (!c) return '';
    const texts = c.kind === 'shapes' ? (c.texts || []) : (c.kind === 'layer' && c.layer.kind === 'text' ? [c.layer] : []);
    if (texts.length && c.kind === 'shapes' && !c.shapes.length) return texts.map(t => t.data.text).join('\n');
    if (c.kind === 'layer' && c.layer.kind === 'text') return c.layer.data.text;
    return this.asSVG() || '';
  },

  /* ── 系统剪贴簿 ── */
  /* 写：image/png（＋text/plain）。要使用者手势／权限；失败不吵（无头浏览器、http 非安全来源都会失败） */
  publish(){
    this.publishOk = false; this.published = null;
    const c = this._c; if (!c || !navigator.clipboard || !window.ClipboardItem || !navigator.clipboard.write) return Promise.resolve(false);
    let png;
    try {
      const p = this.asPixels(); if (!p) return Promise.resolve(false);
      const w = p.bounds[2] - p.bounds[0], h = p.bounds[3] - p.bounds[1];
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(p.px), w, h), 0, 0);
      png = new Promise(res => cv.toBlob(b => res(b), 'image/png'));
    } catch(e){ return Promise.resolve(false); }
    const text = c.kind === 'pixels' ? '' : this.asText();
    const item = {'image/png': png};
    if (text) item['text/plain'] = new Blob([text], {type:'text/plain'});
    const serial = c.serial;
    try {
      return navigator.clipboard.write([new ClipboardItem(item)]).then(() => {
        if (this._c && this._c.serial === serial){ this.publishOk = true; this.published = text || ('png#' + serial); }
        return true;
      }, () => false);
    } catch(e){ return Promise.resolve(false); }
  },
  /* 读（非同步）：{image:Blob|null, text:string} ——给菜单／agent 那条路；键盘那条路用 paste 事件的 clipboardData（不用权限） */
  async readSystem(){
    const out = {image:null, text:''};
    if (!navigator.clipboard) return out;
    try {
      if (navigator.clipboard.read){
        const items = await navigator.clipboard.read();
        for (const it of items){
          const img = it.types.find(t => t.startsWith('image/'));
          if (img && !out.image) out.image = await it.getType(img);
          if (it.types.includes('text/plain') && !out.text) out.text = await (await it.getType('text/plain')).text();
        }
        return out;
      }
    } catch(e){}
    try { if (navigator.clipboard.readText) out.text = await navigator.clipboard.readText(); } catch(e){}
    return out;
  },
  /* paste 事件的 clipboardData → {image:File|null, text}（同步） */
  fromEvent(e){
    const out = {image:null, text:''}, cd = e && e.clipboardData; if (!cd) return out;
    for (const f of Array.from(cd.files || [])) if (!out.image && /^image\//.test(f.type)) out.image = f;
    if (!out.image) for (const it of Array.from(cd.items || [])) if (it.kind === 'file' && /^image\//.test(it.type)){ out.image = it.getAsFile(); break; }
    try { out.text = cd.getData('text/plain') || ''; } catch(e){}
    return out;
  },
  /* 系统剪贴簿的内容是不是「比我们的新」：我们写进去过（publishOk）而且系统那边的文字不是我们写的那份 */
  systemIsNewer(sys){
    if (!this._c) return !!(sys && (sys.image || sys.text));
    if (!this.publishOk || !sys) return false;
    if (sys.text) return sys.text !== this.published && !(this.published || '').startsWith('png#');
    return false;
  },
  /* 一张系统的图 → 新像素层（插在当前层上面）：走 layer.addImageFromURL（fit:false＝原大、置中；有 center 就放那里） */
  pasteImage(blob, opt){
    const url = URL.createObjectURL(blob);
    const p = {url, name:(opt && opt.name) || (window.Lang ? Lang.t('layer.untitled') : 'Pasted'), fit:false};
    const done = r => { setTimeout(() => URL.revokeObjectURL(url), 1000); return r; };
    if (opt && Array.isArray(opt.center)){
      return new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => { p.x = Math.round(opt.center[0] - im.width / 2); p.y = Math.round(opt.center[1] - im.height / 2); Promise.resolve(CMD.run('layer.addImageFromURL', p)).then(r => res(done(r)), rej); };
        im.onerror = () => rej(new Error('bad image'));
        im.src = url;
      });
    }
    return Promise.resolve(CMD.run('layer.addImageFromURL', p)).then(done);
  },
  _layerSnap: layerSnap
};
})();
