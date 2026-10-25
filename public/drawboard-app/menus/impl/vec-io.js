/* 堤麟画板 · 矢量档读入：SVG、PDF、Illustrator .ai（存了「PDF 相容」的那份内容）⇒ 分层的中立模型（ps-file openVectorAsDoc 接成画板图层）
   window.VecIO = { svg(text) → Promise<model>, pdf(bytes, {page?, noPrivate?}) → Promise<model>, isPdf(bytes), zstd(u8) → Uint8Array, Bad }
   model = {width, height, pages, notes:[带不过来的项…], layers:[节点…]（下→上）, aiPrivate?（图层树照 Illustrator 私有资料重建的）}
   节点：{kind:'group', name, hidden, opacity, blend, children:[节点…]}
         {kind:'vector', name, hidden, opacity, blend, shapes:[形状…]}   形状照引擎：
             bezier {type, closed, anchors:[{x, y, in:[x,y]|null, out:[x,y]|null}], fill, stroke, strokeWidth, opacity?}
             compound {type, rule, fill, stroke, strokeWidth, children:[bezier…]}；group {type, children, clip?}（剪切组：第一个形状剪住其余）
             fill／stroke：CSS 色字串、'none'，或渐变 {type:'linear'|'radial', stops, x1, y1, x2, y2, r?, aspect?}
         {kind:'text', name, hidden, opacity, blend, data:{text, x, y, size, font?|psFont?, embeddedFont?, bold?, color, align, xform?, box?:[x, y, w, h]（段落文字的框）}}
         {kind:'raster', name, hidden, opacity, blend, canvas（文件大小·已画好）}
   PDF：每个 PDF 图层（OCG，照内容里的 BDC /OC 嵌套）⇒ 一个图层或图层组；路径 ⇒ 矢量（填色、描边、剪切路径成剪切组、
        「剪切路径＋sh」与渐变图样 ⇒ 渐变填色）；文字（BT…ET，靠 ToUnicode／编码表解出字）⇒ 文字层；图（XObject／行内图）⇒ 像素层；Form 照矩阵展开。
   SVG：最外层的 <g>、Inkscape 图层、data-name／data-kind 的组 ⇒ 图层；图层底下 Illustrator 的子图层（只有 id）与 display:none 的组 ⇒ 图层组（藏起来的照藏）；
        路径与基本形 ⇒ 矢量；<text> ⇒ 文字层（Illustrator 区域文字前的空框 <rect> ⇒ 段落文字框）；<image> ⇒ 像素层；
        滤镜、遮罩、图样填色、外部物件这些画板接不起来的 ⇒ 交给浏览器照画面画成像素层（看起来一样、只是不能改）。
   .ai（Illustrator 存的、带私有资料）：图层树（子图层、藏起来的层、物件名、区域文字框）照私有资料重建，画面仍用 PDF 外观那份（见 aiRebuild）；
        pdf(bytes, {noPrivate:true}) 只读 PDF 外观。
   读不了的：加密（有密码）的 PDF、没存 PDF 相容的 .ai（纯 PostScript）⇒ 丢 Bad；JPEG2000 等图码、网格渐变等 ⇒ 列 notes。 */
(function(){
'use strict';
if (window.VecIO) return;
class Bad extends Error {}
const L3 = (hant, hans, en) => { const c = window.Lang && Lang.cur; return c === 'en' ? en : c === 'zh-Hans' ? hans : c ? hant : en; };

/* ── 共用：仿射 [a,b,c,d,e,f]（x' = a·x + c·y + e）；cat(m, n)＝先 m 后 n ── */
const I = [1, 0, 0, 1, 0, 0];
const cat = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const scaleOf = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
const r4 = v => Math.round(v * 1e4) / 1e4;
const c01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const hex = rgb => '#' + rgb.slice(0, 3).map(v => Math.round(c01(+v || 0) * 255).toString(16).padStart(2, '0')).join('');
const cssRGBA = (rgb, a) => (a === undefined || a >= 0.999 ? hex(rgb) : `rgba(${rgb.slice(0, 3).map(v => Math.round(c01(v) * 255)).join(',')},${r4(c01(a))})`);
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
const BLEND_OF = {Normal:'normal', Compatible:'normal', Multiply:'multiply', Screen:'screen', Overlay:'overlay', Darken:'darken', Lighten:'lighten', ColorDodge:'colorDodge',
  ColorBurn:'colorBurn', HardLight:'hardLight', SoftLight:'softLight', Difference:'difference', Exclusion:'exclusion', Hue:'hue', Saturation:'saturation', Color:'color', Luminosity:'luminosity'};

/* 路径：子路径＝{closed, anchors:[{x,y,in,out}]}（把手 null＝跟锚点重合） */
class PathB {
  constructor(){ this.subs = []; this.cur = null; this.pt = null; this.start = null; }
  move(x, y){ this.cur = {closed:false, anchors:[{x, y, in:null, out:null}]}; this.subs.push(this.cur); this.pt = [x, y]; this.start = [x, y]; }
  _ensure(x, y){ if (!this.cur){ const p = this.pt || [x, y]; this.move(p[0], p[1]); } }
  line(x, y){ if (!this.cur && !this.pt){ this.move(x, y); return; } this._ensure(x, y); this.cur.anchors.push({x, y, in:null, out:null}); this.pt = [x, y]; }
  curve(x1, y1, x2, y2, x, y){
    this._ensure(x1, y1); const a = this.cur.anchors, last = a[a.length - 1];
    if (!(Math.abs(x1 - last.x) < 1e-9 && Math.abs(y1 - last.y) < 1e-9)) last.out = [x1, y1];
    a.push({x, y, in:(Math.abs(x2 - x) < 1e-9 && Math.abs(y2 - y) < 1e-9) ? null : [x2, y2], out:null}); this.pt = [x, y];
  }
  close(){
    if (!this.cur) return; const a = this.cur.anchors;
    if (a.length > 1){ const f = a[0], l = a[a.length - 1]; if (Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6){ f.in = l.in; a.pop(); } }
    this.cur.closed = true; this.cur = null; if (this.start) this.pt = this.start.slice();
  }
  rect(x, y, w, h){ this.move(x, y); this.line(x + w, y); this.line(x + w, y + h); this.line(x, y + h); this.close(); }
}
const mapSubs = (subs, m) => subs.map(s => ({closed:s.closed, anchors:s.anchors.map(a => {
  const p = ap(m, a.x, a.y); return {x:p[0], y:p[1], in:a.in ? ap(m, a.in[0], a.in[1]) : null, out:a.out ? ap(m, a.out[0], a.out[1]) : null}; })}));
const goodSubs = subs => subs.filter(s => s.anchors.length >= 2);
function bboxOf(subs){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = p => { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; };
  for (const s of subs) for (const a of s.anchors){ add([a.x, a.y]); if (a.in) add(a.in); if (a.out) add(a.out); }
  return x0 <= x1 ? {x:x0, y:y0, w:x1 - x0, h:y1 - y0} : null;
}
const rp = p => (p ? [r4(p[0]), r4(p[1])] : null);
function bezierOf(s, fill, stroke, sw){
  return {type:'bezier', closed:!!s.closed, anchors:s.anchors.map(a => ({x:r4(a.x), y:r4(a.y), in:rp(a.in), out:rp(a.out)})), fill, stroke, strokeWidth:sw};
}
function mkShape(subs, fill, stroke, sw, rule){
  const ok = goodSubs(subs); if (!ok.length) return null;
  if (ok.length === 1) return bezierOf(ok[0], fill, stroke, sw);
  return {type:'compound', rule:rule === 'evenodd' ? 'evenodd' : 'nonzero', fill, stroke, strokeWidth:sw, children:ok.map(s => bezierOf(s, 'none', 'none', 0))};
}
/* 渐变色标：取样后把能用直线补出来的点去掉（线性渐变剩两个） */
function simplifyStops(st){
  if (st.length <= 2) return st;
  const out = [st[0]]; let i = 0;
  while (i < st.length - 1){
    let j = i + 1;
    while (j + 1 < st.length){
      const a = st[i], b = st[j + 1]; let ok = true;
      for (let k = i + 1; k <= j && ok; k++){ const t = (st[k].offset - a.offset) / ((b.offset - a.offset) || 1);
        for (let q = 0; q < 4; q++){ const v = a.c[q] + (b.c[q] - a.c[q]) * t; if (Math.abs(v - st[k].c[q]) > 2 / 255) { ok = false; break; } } }
      if (!ok) break; j++;
    }
    out.push(st[j]); i = j;
  }
  return out;
}
const stopsOut = st => simplifyStops(st).map(s => ({offset:r4(s.offset), color:hex(s.c), opacity:r4(s.c[3]), midpoint:0.5}));

/* ── 输出：容器树（组）＋叶子（矢量／文字／像素）·同一容器里连续的形状收进同一个矢量层、连续的图画进同一个像素层 ── */
class Out {
  constructor(W, H){ this.W = W; this.H = H; this.root = {kind:'group', children:[], top:true}; this.stack = [this.root]; this.notes = new Set(); }
  get cur(){ return this.stack[this.stack.length - 1]; }
  open(node){ node.children = node.children || []; this.cur.children.push(node); this.stack.push(node); return node; }
  reopen(node){ this.stack.push(node); }
  close(){ if (this.stack.length > 1) this.stack.pop(); }
  last(){ const c = this.cur.children; return c[c.length - 1]; }
  vec(fresh, name){ let v = this.last(); if (fresh || !v || v.kind !== 'vector' || v.sealed){ v = {kind:'vector', shapes:[], meta:[]}; if (name) v.name = name; this.cur.children.push(v); } return v; }
  shape(s, clip, meta, fresh, name){
    if (!s) return; const v = this.vec(fresh, name);
    if (clip){
      const tail = v.shapes[v.shapes.length - 1];
      if (tail && tail._clip === clip) tail.children.push(s);
      else { const g = {type:'group', clip:true, children:[clip.shape(), s]}; Object.defineProperty(g, '_clip', {value:clip}); v.shapes.push(g); }
    } else v.shapes.push(s);
    v.meta.push(meta || {});
  }
  seal(){ const v = this.last(); if (v) v.sealed = true; }
  text(d, meta, name){ this.cur.children.push({kind:'text', data:d, meta:[meta || {}], name}); }
  raster(fresh, name){
    let r = this.last();
    if (fresh || !r || r.kind !== 'raster' || r.sealed){ const c = mkCanvas(this.W, this.H); r = {kind:'raster', canvas:c, ctx:c.getContext('2d'), meta:[]}; if (name) r.name = name; this.cur.children.push(r); }
    return r;
  }
}
const sameNum = (a, b) => Math.abs(a - b) < 1e-4;
/* 容器树 ⇒ model.layers：只有一个叶子的图层就把名字给那个叶子（不多包一层组）；叶子里每笔一样的不透明度／混合模式提到层上 */
function finish(out, W, H, extra){
  const leafNorm = n => {
    const m = n.meta || []; delete n.meta; delete n.sealed; delete n.ctx;
    const blends = [...new Set(m.map(x => x.blend || 'normal'))];
    if (blends.length === 1 && blends[0] !== 'normal') n.blend = blends[0];
    else if (blends.length > 1) out.notes.add('several blend modes in one layer: kept the first');
    if (blends.length > 1 && blends[0] !== 'normal') n.blend = blends[0];
    if (n.kind === 'vector'){
      const ops = n.shapes.map(s => (s.opacity === undefined ? 1 : s.opacity));
      if (ops.length && ops.every(o => sameNum(o, ops[0])) && ops[0] < 0.999){ n.opacity = (n.opacity === undefined ? 1 : n.opacity) * ops[0]; n.shapes.forEach(s => { delete s.opacity; }); }
    } else if (n.kind === 'text'){ const a = m[0] && m[0].alpha; if (a !== undefined && a < 0.999) n.opacity = (n.opacity === undefined ? 1 : n.opacity) * a; }
    return n;
  };
  const norm = n => {
    if (n.kind !== 'group') return leafNorm(n);
    const kids = n.children.map(norm).filter(Boolean);
    delete n.top_;
    if (!n.top){
      if (!kids.length) return {kind:'vector', shapes:[], name:n.name, hidden:!!n.hidden, opacity:n.opacity, blend:n.blend};   // 空图层照留
      if (kids.length === 1 && kids[0].kind !== 'group' && !kids[0].fromLayer && !n.keepGroup){   // 只有一个叶子（而且那叶子本身不是一个图层）⇒ 不多包一层组
        const k = kids[0]; k.fromLayer = true;
        k.name = n.name || k.name; k.hidden = !!(n.hidden || k.hidden);
        if (n.opacity !== undefined) k.opacity = (k.opacity === undefined ? 1 : k.opacity) * n.opacity;
        if (n.blend && n.blend !== 'normal' && n.blend !== 'passThrough') k.blend = n.blend;
        return k;
      }
    }
    n.children = kids; return n;
  };
  const top = norm(out.root);
  const strip = n => { delete n.top; delete n.ocg; delete n.ocgId; delete n.keepGroup; delete n.fromLayer; if (n.children && n.kind === 'group') n.children.forEach(strip); return n; };
  return Object.assign({width:W, height:H, notes:[...out.notes], layers:top.children.map(strip)}, extra || {});
}

/* ── 文字：一串「字串＋起点＋终点（文件坐标）」⇒ 文字层（同一行接起来、下一行换行、样式变了或离太远就另起一层；多行时照起点／中点／终点哪个对得最齐判断对齐） ── */
function layoutRuns(runs, out, mkData, box){
  let g = null;
  const flush = () => {
    if (!g) return; const lines = g.lines.filter(l => l.text.length);
    if (!lines.length || !lines.map(l => l.text).join('').trim()){ g = null; return; }
    let align = 'left', at = lines[0].s, B = null;
    if (box){
      /* 段落文字（框 box＝文件坐标、文字没旋转）：各行起点照「贴框左／按宽对框中／按宽贴框右」三种假设算残差，挑最一致的；锚点落在框的左／中／右。框只给第一层 */
      B = box; box = null;
      const bl = B[0] - g.O[0], bc = bl + B[2] / 2, br = bl + B[2], tol = g.size * 0.05;
      const fit = f => { const r = lines.map(l => l.s - f(l)), m = r.reduce((s, v) => s + v, 0) / r.length; return Math.max(...r) - Math.min(...r) + 0.5 * Math.abs(m); };
      const sl = fit(() => bl), sc = fit(l => bc - (l.e - l.s) / 2), sr = fit(l => br - (l.e - l.s));
      if (sc + tol < sl && sc <= sr){ align = 'center'; at = bc; } else if (sr + tol < sl && sr < sc){ align = 'right'; at = br; } else at = bl;
    } else if (lines.length > 1){
      const spread = f => { const v = lines.map(f); return Math.max(...v) - Math.min(...v); };
      const sl = spread(l => l.s), sc = spread(l => (l.s + l.e) / 2), sr = spread(l => l.e), tol = g.size * 0.05;
      if (sl > tol || sc > tol || sr > tol){ if (sc + tol < sl && sc <= sr) { align = 'center'; at = (lines[0].s + lines[0].e) / 2; } else if (sr + tol < sl && sr < sc){ align = 'right'; at = lines[0].e; } }
    } else if (g.anchor === 'center'){ align = 'center'; at = (lines[0].s + lines[0].e) / 2; } else if (g.anchor === 'right'){ align = 'right'; at = lines[0].e; }
    const O = [g.O[0] + g.u[0] * at + g.n[0] * lines[0].v, g.O[1] + g.u[1] * at + g.n[1] * lines[0].v];
    const text = lines.map(l => l.text.replace(/\s+$/, '')).join('\n');
    const d = mkData(g.run0, {text, x:r4(O[0]), y:r4(O[1]), size:r4(g.size), align});
    if (B) d.box = B.map(r4);
    const X = g.X;
    if (X && !(sameNum(X[0], 1) && sameNum(X[1], 0) && sameNum(X[2], 0) && sameNum(X[3], 1)))
      d.xform = [r4(X[0]), r4(X[1]), r4(X[2]), r4(X[3]), r4(O[0] - X[0] * O[0] - X[2] * O[1]), r4(O[1] - X[1] * O[0] - X[3] * O[1])];
    out.text(d, {alpha:g.run0.alpha, blend:g.run0.blend});
    g = null;
  };
  const frame = r => { const u = r.X ? [r.X[0], r.X[1]] : [1, 0], L = Math.hypot(u[0], u[1]) || 1, uu = [u[0] / L, u[1] / L]; return {u:uu, n:[-uu[1], uu[0]]}; };
  const start = r => { const f = frame(r); g = {O:r.o, u:f.u, n:f.n, X:r.X, size:r.size, key:r.key, run0:r, anchor:r.anchor, lines:[{v:0, s:0, e:0, text:''}]}; };
  const rel = r => { const d = (p, q) => (p[0] - g.O[0]) * q[0] + (p[1] - g.O[1]) * q[1]; return {du:d(r.o, g.u), dv:d(r.o, g.n), de:d(r.e, g.u)}; };
  for (const r of runs){
    if (!r.str) continue;
    if (!g || g.key !== r.key || Math.abs(r.size - g.size) > g.size * 0.05){ flush(); start(r); }
    let pos = rel(r), L = g.lines[g.lines.length - 1];
    if (L.text.length){
      if (Math.abs(pos.dv - L.v) < g.size * 0.45){
        const gap = pos.du - L.e;
        if (gap > g.size * 4){ flush(); start(r); pos = rel(r); L = g.lines[0]; }
        else if (gap > g.size * 0.25 && !/\s$/.test(L.text) && !/^\s/.test(r.str)) L.text += ' ';
      } else {
        const step = pos.dv - L.v;
        if (step > g.size * 0.45 && step < g.size * 2.2 && Math.abs(pos.du) < g.size * 40){ L = {v:pos.dv, s:pos.du, e:pos.du, text:''}; g.lines.push(L); }
        else { flush(); start(r); pos = rel(r); L = g.lines[0]; }
      }
    }
    if (!L.text.length){ L.v = pos.dv; L.s = pos.du; L.e = pos.du; }
    L.text += r.str; L.e = Math.max(L.e, pos.de);
  }
  flush();
}

/* ═══════════════════════════════ PDF ═══════════════════════════════ */
class Name { constructor(v){ this.v = v; } }
class Ref { constructor(n, g){ this.n = n; this.g = g; } }
class Stream { constructor(dict, raw){ this.dict = dict; this.raw = raw; } }
const nm = v => (v instanceof Name ? v.v : null);
const isWS = c => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDel = c => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
const latin = (b, s, e) => { let t = ''; for (let i = s; i < e; i++) t += String.fromCharCode(b[i]); return t; };
const NUMRE = /^[+-]?(\d+\.?\d*|\.\d+)$/;
class Lexer {
  constructor(b, p){ this.b = b; this.p = p || 0; }
  ws(){ const b = this.b, n = b.length; for (;;){ while (this.p < n && isWS(b[this.p])) this.p++; if (this.p < n && b[this.p] === 37){ while (this.p < n && b[this.p] !== 10 && b[this.p] !== 13) this.p++; } else return; } }
  tok(){
    for (;;){
      this.ws(); const b = this.b; if (this.p >= b.length) return null;
      const c = b[this.p];
      if (c === 91){ this.p++; return '['; } if (c === 93){ this.p++; return ']'; }
      if (c === 123){ this.p++; return '{'; } if (c === 125){ this.p++; return '}'; }
      if (c === 60){ if (b[this.p + 1] === 60){ this.p += 2; return '<<'; } return {s:this.hexStr()}; }
      if (c === 62){ if (b[this.p + 1] === 62){ this.p += 2; return '>>'; } this.p++; continue; }
      if (c === 40) return {s:this.litStr()};
      if (c === 41){ this.p++; continue; }
      if (c === 47){ this.p++; return new Name(this.name()); }
      const s = this.p; while (this.p < b.length && !isWS(b[this.p]) && !isDel(b[this.p])) this.p++;
      if (this.p === s){ this.p++; continue; }
      const t = latin(b, s, this.p);
      if (NUMRE.test(t)) return +t;
      if (/^[+\-.\d]+$/.test(t)){ const v = parseFloat(t.replace(/^[+-]*-/, '-').replace(/^\++/, '')); return isFinite(v) ? v : 0; }
      return {kw:t};
    }
  }
  name(){
    const b = this.b, out = [];
    while (this.p < b.length && !isWS(b[this.p]) && !isDel(b[this.p])){
      if (b[this.p] === 35 && this.p + 2 < b.length){ const h = parseInt(latin(b, this.p + 1, this.p + 3), 16); if (!isNaN(h)){ out.push(h); this.p += 3; continue; } }
      out.push(b[this.p++]);
    }
    try { return new TextDecoder('utf-8', {fatal:true}).decode(new Uint8Array(out)); } catch (_){ return String.fromCharCode(...out); }
  }
  litStr(){
    const b = this.b, out = []; let depth = 1; this.p++;
    while (this.p < b.length){
      let c = b[this.p++];
      if (c === 40) depth++;
      else if (c === 41){ if (--depth === 0) break; }
      else if (c === 92){
        c = b[this.p++];
        if (c === 110) c = 10; else if (c === 114) c = 13; else if (c === 116) c = 9; else if (c === 98) c = 8; else if (c === 102) c = 12;
        else if (c === 13){ if (b[this.p] === 10) this.p++; continue; } else if (c === 10) continue;
        else if (c >= 48 && c <= 55){ let v = c - 48; for (let k = 0; k < 2 && b[this.p] >= 48 && b[this.p] <= 55; k++) v = v * 8 + b[this.p++] - 48; c = v & 255; }
      }
      out.push(c);
    }
    return new Uint8Array(out);
  }
  hexStr(){
    const b = this.b, out = []; let hi = -1; this.p++;
    while (this.p < b.length && b[this.p] !== 62){
      const c = b[this.p++], v = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
      if (v < 0) continue; if (hi < 0) hi = v; else { out.push(hi * 16 + v); hi = -1; }
    }
    this.p++; if (hi >= 0) out.push(hi * 16);
    return new Uint8Array(out);
  }
}
function parseObj(L, t, refs){
  if (t === '['){ const a = []; for (;;){ const x = L.tok(); if (x === null || x === ']') return a; a.push(parseObj(L, x, refs)); } }
  if (t === '<<'){ const d = {}; for (;;){ const k = L.tok(); if (k === null || k === '>>') return d; if (!(k instanceof Name)) continue; const v = L.tok(); if (v === '>>' || v === null){ d[k.v] = null; return d; } d[k.v] = parseObj(L, v, refs); } }
  if (typeof t === 'number'){
    if (refs && Number.isInteger(t) && t >= 0){ const save = L.p, t2 = L.tok(); if (typeof t2 === 'number' && Number.isInteger(t2)){ const t3 = L.tok(); if (t3 && t3.kw === 'R') return new Ref(t, t2); } L.p = save; }
    return t;
  }
  if (t && t.s) return t.s;
  if (t && t.kw !== undefined){ if (t.kw === 'true') return true; if (t.kw === 'false') return false; if (t.kw === 'null') return null; return t; }
  return t;
}
/* 文字字串（PDF text string）：FEFF＝UTF-16BE、EFBBBF＝UTF-8、其余当 PDFDocEncoding（≈latin1） */
function textStr(u8){
  if (!(u8 instanceof Uint8Array)) return u8 instanceof Name ? u8.v : u8 == null ? '' : String(u8);
  if (u8[0] === 0xfe && u8[1] === 0xff){ let s = ''; for (let i = 2; i + 1 < u8.length; i += 2) s += String.fromCharCode((u8[i] << 8) | u8[i + 1]); return s; }
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return new TextDecoder().decode(u8.subarray(3));
  try { return new TextDecoder('utf-8', {fatal:true}).decode(u8); } catch (_){ return String.fromCharCode(...u8); }
}

/* 解压：deflate（坏尾巴就留住已经解出来的）、LZW、ASCII85／Hex、RunLength、PNG／TIFF 预测 */
async function inflate(u8){
  for (const fmt of ['deflate', 'deflate-raw']){
    const parts = []; let got = 0;
    try {
      const rd = new Blob([u8]).stream().pipeThrough(new DecompressionStream(fmt)).getReader();
      for (;;){ const {done, value} = await rd.read(); if (done) break; parts.push(value); got += value.length; }
    } catch (_){ if (!got) continue; }
    const out = new Uint8Array(got); let k = 0; for (const p of parts){ out.set(p, k); k += p.length; } return out;
  }
  return new Uint8Array(0);
}
function predict(d, p){
  const P = (p && p.Predictor) || 1; if (P < 2) return d;
  const colors = (p && p.Colors) || 1, bpc = (p && p.BitsPerComponent) || 8, cols = (p && p.Columns) || 1;
  const bpp = Math.max(1, Math.ceil(colors * bpc / 8)), row = Math.ceil(colors * bpc * cols / 8);
  if (P === 2){ if (bpc !== 8) return d; const o = new Uint8Array(d); for (let r = 0; r + row <= o.length; r += row) for (let i = bpp; i < row; i++) o[r + i] = (o[r + i] + o[r + i - bpp]) & 255; return o; }
  const rows = Math.floor(d.length / (row + 1)), o = new Uint8Array(rows * row); let prev = new Uint8Array(row);
  for (let r = 0; r < rows; r++){
    const f = d[r * (row + 1)], src = d.subarray(r * (row + 1) + 1, (r + 1) * (row + 1)), cur = o.subarray(r * row, (r + 1) * row);
    for (let i = 0; i < row; i++){
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0; let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4){ const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  return o;
}
function lzw(d, early){
  const out = []; let dict = [], bits = 9, buf = 0, nb = 0, prev = null;
  const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict.push([i]); dict.push(null, null); bits = 9; };
  reset();
  for (let i = 0; i < d.length; i++){
    buf = (buf << 8) | d[i]; nb += 8;
    while (nb >= bits){
      const code = (buf >> (nb - bits)) & ((1 << bits) - 1); nb -= bits;
      if (code === 256){ reset(); prev = null; continue; } if (code === 257) return new Uint8Array(out);
      let e = dict[code];
      if (!e){ if (!prev) return new Uint8Array(out); e = prev.concat([prev[0]]); }
      for (const x of e) out.push(x);
      if (prev) dict.push(prev.concat([e[0]]));
      prev = e;
      const n = dict.length + early; if (n >= (1 << bits) && bits < 12) bits++;
    }
  }
  return new Uint8Array(out);
}
function a85(d){
  const out = []; let n = 0, k = 0;
  for (let i = 0; i < d.length; i++){
    const c = d[i]; if (c === 126) break; if (isWS(c)) continue;
    if (c === 122 && k === 0){ out.push(0, 0, 0, 0); continue; }
    if (c < 33 || c > 117) continue;
    n = n * 85 + (c - 33); k++;
    if (k === 5){ out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255); n = 0; k = 0; }
  }
  if (k > 1){ for (let j = k; j < 5; j++) n = n * 85 + 84; const t = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; for (let j = 0; j < k - 1; j++) out.push(t[j]); }
  return new Uint8Array(out);
}
function ahx(d){ const L = new Lexer(new Uint8Array([60, ...d, 62]), 0); return L.hexStr(); }
function rld(d){ const out = []; for (let i = 0; i < d.length;){ const n = d[i++]; if (n === 128) break; if (n < 128){ for (let j = 0; j <= n && i < d.length; j++) out.push(d[i++]); } else { const v = d[i++]; for (let j = 0; j < 257 - n; j++) out.push(v); } } return new Uint8Array(out); }

/* ── 读档：交叉引用表／交叉引用流（含 Prev、混合档）、对象流；表坏了就整档扫「N G obj」 ── */
class PdfDoc {
  constructor(b){ this.b = b; this.xref = new Map(); this.cache = new Map(); this.objStm = new Map(); this.trailer = null; this.scanned = false; }
  async load(){
    const head = latin(this.b, 0, Math.min(this.b.length, 1024));
    if (head.indexOf('%PDF') < 0){
      if (/^%!PS-Adobe/.test(head)) throw new Bad('This .ai/.eps file was saved without PDF compatibility (PostScript only). In Illustrator, re-save it with "Create PDF Compatible File" on.');
      throw new Bad('not a PDF or PDF-compatible .ai file');
    }
    try { await this.readXref(); } catch (_){ this.xref.clear(); this.trailer = null; }
    let root = null; try { root = this.trailer && await this.get(this.trailer.Root); } catch (_){ root = null; }
    if (!root || !root.Pages){ await this.scan(); root = this.trailer && await this.get(this.trailer.Root); }
    if (!root) throw new Bad('PDF structure could not be read');
    if (this.trailer.Encrypt) throw new Bad('This PDF is encrypted (password-protected) and cannot be imported.');
    this.rootObj = root;
  }
  async r(v){ let k = 0; while (v instanceof Ref && k++ < 32) v = await this.get(v); return v; }
  async readXref(){
    const n = this.b.length, tail = latin(this.b, Math.max(0, n - 4096), n), i = tail.lastIndexOf('startxref'); if (i < 0) throw 0;
    let off = parseInt(tail.slice(i + 9).trim(), 10); const seen = new Set();
    while (Number.isFinite(off) && off > 0 && off < n && !seen.has(off)){
      seen.add(off);
      const L = new Lexer(this.b, off), t = L.tok(); let tr;
      if (t && t.kw === 'xref'){ tr = this.xrefTable(L); if (typeof tr.XRefStm === 'number'){ const o = await this.parseAt(tr.XRefStm); if (o instanceof Stream) await this.xrefStream(o); } }
      else { const o = await this.parseAt(off); if (!(o instanceof Stream)) throw 0; tr = o.dict; await this.xrefStream(o); }
      if (!this.trailer) this.trailer = tr;
      off = tr.Prev;
    }
    if (!this.trailer) throw 0;
  }
  xrefTable(L){
    for (;;){
      const t = L.tok();
      if (t && t.kw === 'trailer') return parseObj(L, L.tok(), true);
      if (typeof t !== 'number') throw 0;
      const cnt = L.tok();
      for (let k = 0; k < cnt; k++){ const o = L.tok(); L.tok(); const f = L.tok(), num = t + k; if (!this.xref.has(num)) this.xref.set(num, f && f.kw === 'n' && o > 0 ? {o} : null); }
    }
  }
  async xrefStream(st){
    const d = st.dict, data = await this.decode(st), W = d.W || [1, 2, 1], idx = d.Index || [0, d.Size || 0], w = W.reduce((a, b) => a + b, 0);
    let p = 0;
    const field = (k, dflt) => { if (!W[k]) return dflt; let v = 0; for (let i = 0; i < W[k]; i++) v = v * 256 + data[p++]; return v; };
    for (let s = 0; s + 1 < idx.length; s += 2) for (let k = 0; k < idx[s + 1] && p + w <= data.length; k++){
      const type = field(0, 1), f2 = field(1, 0), f3 = field(2, 0), num = idx[s] + k;
      if (this.xref.has(num)) continue;
      this.xref.set(num, type === 1 ? {o:f2} : type === 2 ? {s:f2, i:f3} : null);
    }
  }
  async parseAt(off){
    const L = new Lexer(this.b, off), n = L.tok(), g = L.tok(), kw = L.tok();
    if (typeof n !== 'number' || typeof g !== 'number' || !kw || kw.kw !== 'obj') throw new Bad('bad object at ' + off);
    const v = parseObj(L, L.tok(), true), save = L.p, t = L.tok();
    if (!(t && t.kw === 'stream')){ L.p = save; return v; }
    const b = this.b; let s = L.p; if (b[s] === 13) s++; if (b[s] === 10) s++;
    let len = v.Length; if (len instanceof Ref){ try { len = await this.get(len); } catch (_){ len = -1; } }
    let e = typeof len === 'number' && len >= 0 ? s + len : -1;
    const ok = e > 0 && e <= b.length && /^\s*endstream/.test(latin(b, e, Math.min(b.length, e + 16)));
    if (!ok){ const str = latin(b, s, Math.min(b.length, s + 64 * 1024 * 1024)), j = str.indexOf('endstream'); e = j < 0 ? b.length : s + j; while (e > s && (b[e - 1] === 10 || b[e - 1] === 13)) e--; }
    return new Stream(v, b.subarray(s, e));
  }
  async get(ref){
    if (!(ref instanceof Ref)) return ref;
    if (this.cache.has(ref.n)) return this.cache.get(ref.n);
    this.cache.set(ref.n, null);   // 环的保护
    let e = this.xref.get(ref.n), v = null;
    try { v = e ? (e.o !== undefined ? await this.parseAt(e.o) : await this.fromObjStm(e.s, e.i, ref.n)) : null; }
    catch (_){ if (!this.scanned){ await this.scan(); e = this.xref.get(ref.n); try { v = e ? (e.o !== undefined ? await this.parseAt(e.o) : await this.fromObjStm(e.s, e.i, ref.n)) : null; } catch (__){ v = null; } } }
    this.cache.set(ref.n, v); return v;
  }
  async objStmOf(sn){
    if (this.objStm.has(sn)) return this.objStm.get(sn);
    const st = await this.get(new Ref(sn, 0)); let r = null;
    if (st instanceof Stream){
      const data = await this.decode(st), N = st.dict.N || 0, first = st.dict.First || 0, L = new Lexer(data, 0), map = new Map(), order = [];
      for (let k = 0; k < N; k++){ const num = L.tok(), off = L.tok(); if (typeof num !== 'number') break; map.set(num, first + off); order.push(num); }
      r = {data, map, order};
    }
    this.objStm.set(sn, r); return r;
  }
  async fromObjStm(sn, i, num){
    const S = await this.objStmOf(sn); if (!S) return null;
    const off = S.map.get(num); if (off === undefined) return null;
    const L = new Lexer(S.data, off); return parseObj(L, L.tok(), true);
  }
  async scan(){
    this.scanned = true;
    const s = new TextDecoder('latin1').decode(this.b), re = /(\d+)\s+(\d+)\s+obj\b/g; let m;
    const found = new Map(); while ((m = re.exec(s))) found.set(+m[1], {o:m.index});
    for (const [k, v] of found) this.xref.set(k, v);
    this.cache.clear();
    // 对象流里的对象
    const stm = /\/Type\s*\/ObjStm/g; let q;
    while ((q = stm.exec(s))){
      let best = null; for (const [k, v] of found) if (v.o < q.index && (!best || v.o > best.o)) best = {k, o:v.o};
      if (!best) continue; const S = await this.objStmOf(best.k); if (!S) continue;
      for (const num of S.order) if (!found.has(num)) this.xref.set(num, {s:best.k, i:0});
    }
    if (!this.trailer || !this.trailer.Root){
      const t = s.lastIndexOf('trailer'); let tr = null;
      if (t >= 0){ try { const L = new Lexer(this.b, t + 7); tr = parseObj(L, L.tok(), true); } catch (_){ tr = null; } }
      if (!tr || !tr.Root){
        for (const k of this.xref.keys()){ const o = await this.get(new Ref(k, 0)); if (o && !(o instanceof Stream) && nm(o.Type) === 'Catalog'){ tr = Object.assign(tr || {}, {Root:new Ref(k, 0)}); break; } }
      }
      this.trailer = Object.assign({}, this.trailer || {}, tr || {});
    }
  }
  /* 一般滤镜解完；碰到图像专用的（DCT、JPX、CCITT、JBIG2）image:true 时停下交回 {data, filter} */
  async decode(st, image){
    let data = st.raw; const d = st.dict;
    let F = await this.r(d.Filter !== undefined ? d.Filter : d.F), P = await this.r(d.DecodeParms !== undefined ? d.DecodeParms : d.DP);
    F = F == null ? [] : Array.isArray(F) ? F : [F]; P = Array.isArray(P) ? P : [P];
    for (let i = 0; i < F.length; i++){
      const f = nm(await this.r(F[i])), p = (await this.r(P[i])) || {};
      if (f === 'FlateDecode' || f === 'Fl') data = predict(await inflate(data), p);
      else if (f === 'LZWDecode' || f === 'LZW') data = predict(lzw(data, p.EarlyChange === undefined ? 1 : p.EarlyChange), p);
      else if (f === 'ASCII85Decode' || f === 'A85') data = a85(data);
      else if (f === 'ASCIIHexDecode' || f === 'AHx') data = ahx(data);
      else if (f === 'RunLengthDecode' || f === 'RL') data = rld(data);
      else if (image) return {data, filter:f, parms:p};
      else throw new Bad('unsupported filter ' + f);
    }
    return image ? {data, filter:null} : data;
  }
  async pages(){
    const out = [], seen = new Set();
    const walk = async (node, inh) => {
      node = await this.r(node); if (!node || seen.has(node)) return; seen.add(node);
      const h = Object.assign({}, inh); for (const k of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) if (node[k] !== undefined) h[k] = node[k];
      const kids = await this.r(node.Kids);
      if (Array.isArray(kids) && (nm(node.Type) !== 'Page')){ for (const k of kids) await walk(k, h); }
      else out.push(Object.assign({}, node, h));
    };
    await walk(this.rootObj.Pages, {});
    return out;
  }
}

/* 函数（取样、指数、拼接、PostScript 算式）⇒ JS 函数（输入阵列 → 输出阵列） */
const PS_OPS = {
  abs:s => s.push(Math.abs(s.pop())), add:s => s.push(s.pop() + s.pop()), sub:s => { const b = s.pop(); s.push(s.pop() - b); }, mul:s => s.push(s.pop() * s.pop()),
  div:s => { const b = s.pop(); s.push(b ? s.pop() / b : 0); }, idiv:s => { const b = s.pop(); s.push(b ? Math.trunc(s.pop() / b) : 0); }, mod:s => { const b = s.pop(); s.push(b ? s.pop() % b : 0); },
  neg:s => s.push(-s.pop()), ceiling:s => s.push(Math.ceil(s.pop())), floor:s => s.push(Math.floor(s.pop())), round:s => s.push(Math.round(s.pop())), truncate:s => s.push(Math.trunc(s.pop())),
  cvi:s => s.push(Math.trunc(s.pop())), cvr:s => {}, sqrt:s => s.push(Math.sqrt(Math.max(0, s.pop()))), sin:s => s.push(Math.sin(s.pop() * Math.PI / 180)), cos:s => s.push(Math.cos(s.pop() * Math.PI / 180)),
  atan:s => { const b = s.pop(), a = s.pop(); let v = Math.atan2(a, b) * 180 / Math.PI; if (v < 0) v += 360; s.push(v); }, exp:s => { const b = s.pop(); s.push(Math.pow(s.pop(), b)); },
  ln:s => s.push(Math.log(s.pop())), log:s => s.push(Math.log10(s.pop())),
  eq:s => s.push(s.pop() === s.pop()), ne:s => s.push(s.pop() !== s.pop()), gt:s => { const b = s.pop(); s.push(s.pop() > b); }, ge:s => { const b = s.pop(); s.push(s.pop() >= b); },
  lt:s => { const b = s.pop(); s.push(s.pop() < b); }, le:s => { const b = s.pop(); s.push(s.pop() <= b); },
  and:s => { const b = s.pop(), a = s.pop(); s.push(typeof a === 'boolean' ? a && b : a & b); }, or:s => { const b = s.pop(), a = s.pop(); s.push(typeof a === 'boolean' ? a || b : a | b); },
  xor:s => { const b = s.pop(), a = s.pop(); s.push(typeof a === 'boolean' ? a !== b : a ^ b); }, not:s => { const a = s.pop(); s.push(typeof a === 'boolean' ? !a : ~a); },
  bitshift:s => { const b = s.pop(), a = s.pop(); s.push(b >= 0 ? a << b : a >> -b); }, true:s => s.push(true), false:s => s.push(false),
  dup:s => s.push(s[s.length - 1]), exch:s => { const b = s.pop(), a = s.pop(); s.push(b, a); }, pop:s => s.pop(),
  copy:s => { const n = s.pop(); s.push(...s.slice(s.length - n)); }, index:s => { const n = s.pop(); s.push(s[s.length - 1 - n]); },
  roll:s => { const j = s.pop(), n = s.pop(); if (n <= 0) return; const a = s.splice(s.length - n, n), k = ((j % n) + n) % n; s.push(...a.slice(n - k), ...a.slice(0, n - k)); },
};
function psProgram(data){
  const L = new Lexer(data, 0);
  const block = () => { const out = []; for (;;){ const t = L.tok(); if (t === null || t === '}') return out; if (t === '{') out.push(block()); else out.push(typeof t === 'number' ? t : t.kw); } };
  const first = L.tok(); return first === '{' ? block() : [];
}
function psRun(prog, s){
  for (let i = 0; i < prog.length; i++){
    const x = prog[i];
    if (typeof x === 'number') s.push(x);
    else if (Array.isArray(x)){
      const y = prog[i + 1];
      if (y === 'if'){ if (s.pop()) psRun(x, s); i++; }
      else if (Array.isArray(y) && prog[i + 2] === 'ifelse'){ psRun(s.pop() ? x : y, s); i += 2; }
    } else if (PS_OPS[x]) PS_OPS[x](s);
  }
}

/* ── 内容流解读 ── */
const GRAY = {n:1, rgb:a => [a[0], a[0], a[0]], init:[0]};
const RGB = {n:3, rgb:a => [a[0], a[1], a[2]], init:[0, 0, 0]};
const CMYK = {n:4, rgb:a => [(1 - a[0]) * (1 - a[3]), (1 - a[1]) * (1 - a[3]), (1 - a[2]) * (1 - a[3])], init:[0, 0, 0, 1]};
const PATTERN = {n:0, pattern:true, rgb:() => [0.5, 0.5, 0.5], init:[]};
const DEVICE = {DeviceGray:GRAY, G:GRAY, CalGray:GRAY, DeviceRGB:RGB, RGB:RGB, CalRGB:RGB, DeviceCMYK:CMYK, CMYK:CMYK, Pattern:PATTERN};
function labCS(range){
  const rg = range || [-100, 100, -100, 100];
  const f = t => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) * (6 / 29) * (t - 4 / 29));
  const g = v => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  return {n:3, lab:true, init:[0, 0, 0], rgb:a => {
    const L = a[0] * (a.norm ? 100 : 1), A = a.norm ? rg[0] + a[1] * (rg[1] - rg[0]) : a[1], B = a.norm ? rg[2] + a[2] * (rg[3] - rg[2]) : a[2];
    const fy = (L + 16) / 116, X = 0.9642 * f(fy + A / 500), Y = f(fy), Z = 0.8249 * f(fy - B / 200);
    return [g(3.1338 * X - 1.6168 * Y - 0.4906 * Z), g(-0.9787 * X + 1.9161 * Y + 0.0334 * Z), g(0.0719 * X - 0.2290 * Y + 1.4052 * Z)];
  }};
}
const AGL = {space:' ', exclam:'!', quotedbl:'"', numbersign:'#', dollar:'$', percent:'%', ampersand:'&', quotesingle:"'", quoteright:'’', quoteleft:'‘', parenleft:'(', parenright:')',
  asterisk:'*', plus:'+', comma:',', hyphen:'-', minus:'−', period:'.', slash:'/', colon:':', semicolon:';', less:'<', equal:'=', greater:'>', question:'?', at:'@', bracketleft:'[',
  backslash:'\\', bracketright:']', asciicircum:'^', underscore:'_', grave:'`', braceleft:'{', bar:'|', braceright:'}', asciitilde:'~', bullet:'•', endash:'–', emdash:'—',
  quotedblleft:'“', quotedblright:'”', ellipsis:'…', copyright:'©', registered:'®', trademark:'™', degree:'°', fi:'ﬁ', fl:'ﬂ', nbspace:' ', zero:'0', one:'1', two:'2', three:'3',
  four:'4', five:'5', six:'6', seven:'7', eight:'8', nine:'9', dieresis:'¨', acute:'´', Euro:'€', sterling:'£', yen:'¥', section:'§', paragraph:'¶', multiply:'×', divide:'÷'};
const glyphUni = n => { if (!n) return null; if (AGL[n]) return AGL[n]; if (/^[A-Za-z]$/.test(n)) return n;
  let m = /^uni([0-9A-Fa-f]{4,})/.exec(n); if (m){ let s = ''; for (let i = 0; i + 4 <= m[1].length; i += 4) s += String.fromCharCode(parseInt(m[1].slice(i, i + 4), 16)); return s; }
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(n); if (m) return String.fromCodePoint(parseInt(m[1], 16)); return null; };
function parseCMap(u8){
  const s = latin(u8, 0, u8.length), cs = [], map = new Map(), ranges = [];
  const hexes = t => (t.match(/<[0-9A-Fa-f\s]*>/g) || []).map(h => h.replace(/[<>\s]/g, ''));
  const uni = h => { let o = ''; for (let i = 0; i + 4 <= h.length; i += 4) o += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); if (h.length === 2) o = String.fromCharCode(parseInt(h, 16)); return o; };
  for (const m of s.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)){ const h = hexes(m[1]); for (let i = 0; i + 1 < h.length; i += 2) cs.push({n:h[i].length / 2, lo:parseInt(h[i], 16), hi:parseInt(h[i + 1], 16)}); }
  for (const m of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)){ const h = hexes(m[1]); for (let i = 0; i + 1 < h.length; i += 2) map.set(h[i].length / 2 + ':' + parseInt(h[i], 16), uni(h[i + 1])); }
  for (const m of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)){
    const body = m[1], re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g; let x;
    while ((x = re.exec(body))){
      const lo = parseInt(x[1], 16), hi = parseInt(x[2], 16), n = x[1].length / 2;
      if (x[3][0] === '['){ hexes(x[3]).forEach((h, k) => { if (lo + k <= hi) map.set(n + ':' + (lo + k), uni(h)); }); }
      else ranges.push({n, lo, hi, dst:x[3].replace(/[<>\s]/g, '')});
    }
  }
  const look = (n, code) => {
    const v = map.get(n + ':' + code); if (v !== undefined) return v;
    for (const r of ranges) if (r.n === n && code >= r.lo && code <= r.hi){
      const base = r.dst, last = parseInt(base.slice(-4), 16) + (code - r.lo);
      return uni(base.slice(0, -4) + last.toString(16).padStart(4, '0'));
    }
    return undefined;
  };
  return {cs, look};
}
const WIN = (() => { const d = new TextDecoder('windows-1252'); const t = []; for (let i = 0; i < 256; i++) t.push(d.decode(new Uint8Array([i]))); return t; })();
const MAC = (() => { let d; try { d = new TextDecoder('macintosh'); } catch (_){ return WIN; } const t = []; for (let i = 0; i < 256; i++) t.push(d.decode(new Uint8Array([i]))); return t; })();
const LEGACY = [[/GB|EUC-CN|GBK/i, 'gbk'], [/B5|ETen|HKscs|CNS/i, 'big5'], [/RKSJ|90ms|Shift/i, 'shift_jis'], [/KSC|UHC|EUC-K/i, 'euc-kr']];

class Interp {
  constructor(doc, out, base, W, H, hidden){
    this.doc = doc; this.out = out; this.base = base; this.W = W; this.H = H; this.hidden = hidden;
    this.fonts = new Map(); this.css = new Map(); this.fns = new Map(); this.imgs = new Map();
    this.g = {ctm:I, patBase:base, fillCS:GRAY, fill:[0], strokeCS:GRAY, stroke:[0], fillPat:null, strokePat:null, ca:1, CA:1, grp:1, bm:'normal', lw:1, clip:null,
      font:null, fs:12, tc:0, tw:0, tz:100, tl:0, rise:0, tr:0};
    this.stack = []; this.path = new PathB(); this.clipRule = null; this.marks = []; this.runs = null; this.tm = I; this.tlm = I;
    this.counts = {};
  }
  note(k){ this.out.notes.add(k); }
  D(){ return cat(this.g.ctm, this.base); }
  async r(v){ return this.doc.r(v); }
  async res(res, cat_, name){ const d = res && await this.r(res[cat_]); return d ? await this.r(d[name]) : null; }
  async run(data, res, depth){
    if (depth > 24) return;
    const L = new Lexer(data, 0), ops = [];
    for (;;){
      const t = L.tok(); if (t === null) break;
      if (t && t.kw !== undefined && t.kw !== 'true' && t.kw !== 'false' && t.kw !== 'null'){
        try { await this.op(t.kw, ops, res, L, depth); } catch (e){ if (e instanceof Bad) throw e; this.note('some drawing commands could not be read'); console.warn('vec-io op', t.kw, e); }
        ops.length = 0; continue;
      }
      ops.push(parseObj(L, t, false));
    }
  }
  /* ── 颜色空间 ── */
  async colorSpace(v, res){
    v = await this.r(v);
    if (v instanceof Name){
      if (DEVICE[v.v]) return DEVICE[v.v];
      const x = await this.res(res, 'ColorSpace', v.v); return x ? this.colorSpace(x, null) : RGB;
    }
    if (Array.isArray(v) && v.length){
      if (this.css.has(v)) return this.css.get(v);
      const k = nm(await this.r(v[0])); let cs = RGB;
      if (k === 'ICCBased'){ const st = await this.r(v[1]), N = st && await this.r(st.dict.N); cs = N === 1 ? GRAY : N === 4 ? CMYK : RGB; }
      else if (DEVICE[k] && k !== 'Pattern') cs = DEVICE[k];
      else if (k === 'Lab'){ const d = await this.r(v[1]); cs = labCS(d && await this.r(d.Range)); }
      else if (k === 'Indexed' || k === 'I'){
        const b = await this.colorSpace(v[1], res), hiv = await this.r(v[2]); let lk = await this.r(v[3]);
        if (lk instanceof Stream) lk = await this.doc.decode(lk); if (!(lk instanceof Uint8Array)) lk = new Uint8Array(0);
        cs = {n:1, indexed:true, hival:hiv, init:[0], rgb:a => { const i = Math.max(0, Math.min(hiv, Math.round(a[0]))) * b.n, c = []; for (let j = 0; j < b.n; j++) c.push((lk[i + j] || 0) / 255); if (b.lab) c.norm = true; return b.rgb(c); }};
      }
      else if (k === 'Separation' || k === 'DeviceN' || k === 'NChannel'){
        const names = k === 'Separation' ? [v[1]] : (await this.r(v[1])) || [], alt = await this.colorSpace(v[2], res), fn = await this.fn(v[3]);
        const n = names.length || 1;
        cs = {n, init:new Array(n).fill(1), rgb:a => { const o = fn(a.slice(0, n)); return alt.rgb(o); }};
      }
      else if (k === 'Pattern') cs = PATTERN;
      this.css.set(v, cs); return cs;
    }
    return RGB;
  }
  async fn(v){
    v = await this.r(v); if (v == null) return a => a;
    if (this.fns.has(v)) return this.fns.get(v);
    let f;
    if (Array.isArray(v)){ const fs = []; for (const x of v) fs.push(await this.fn(x)); f = a => fs.map(q => q(a)[0]); }
    else {
      const d = v instanceof Stream ? v.dict : v, T = await this.r(d.FunctionType), dom = (await this.r(d.Domain)) || [0, 1], range = await this.r(d.Range);
      const cin = a => a.map((x, i) => Math.min(Math.max(+x || 0, dom[2 * i] !== undefined ? dom[2 * i] : 0), dom[2 * i + 1] !== undefined ? dom[2 * i + 1] : 1));
      const cout = o => (range ? o.map((x, i) => Math.min(Math.max(x, range[2 * i]), range[2 * i + 1])) : o);
      if (T === 2){ const C0 = (await this.r(d.C0)) || [0], C1 = (await this.r(d.C1)) || [1], N = (await this.r(d.N)) || 1;
        f = a => { const x = cin(a)[0], k = Math.pow(x, N); return cout(C0.map((c, i) => c + k * (C1[i] - c))); }; }
      else if (T === 3){
        const fs = []; for (const x of (await this.r(d.Functions)) || []) fs.push(await this.fn(x));
        const B = (await this.r(d.Bounds)) || [], E = (await this.r(d.Encode)) || fs.flatMap(() => [0, 1]);
        f = a => { const x = cin(a)[0]; let i = 0; while (i < B.length && x >= B[i]) i++; i = Math.min(i, fs.length - 1);
          const lo = i === 0 ? dom[0] : B[i - 1], hi = i === B.length ? dom[1] : B[i], t = hi > lo ? (x - lo) / (hi - lo) : 0;
          return cout(fs[i]([E[2 * i] + t * (E[2 * i + 1] - E[2 * i])])); };
        f.bounds = B.map(b => (b - dom[0]) / ((dom[1] - dom[0]) || 1));
      }
      else if (T === 0 && v instanceof Stream){
        const data = await this.doc.decode(v), size = (await this.r(d.Size)) || [2], bps = (await this.r(d.BitsPerSample)) || 8;
        const enc = (await this.r(d.Encode)) || [0, size[0] - 1], dec = (await this.r(d.Decode)) || range || [0, 1], no = (range || dec).length / 2, max = Math.pow(2, bps) - 1;
        const sample = (i, j) => { const bit = (i * no + j) * bps; if (bps === 8) return data[bit / 8] / max; if (bps === 16) return ((data[bit / 8] << 8) | data[bit / 8 + 1]) / max;
          let v2 = 0; for (let k = 0; k < bps; k++){ const p = bit + k; v2 = (v2 << 1) | ((data[p >> 3] >> (7 - (p & 7))) & 1); } return v2 / max; };
        f = a => { const x = cin(a)[0], e = Math.min(Math.max(enc[0] + (x - dom[0]) / ((dom[1] - dom[0]) || 1) * (enc[1] - enc[0]), 0), size[0] - 1);
          const i0 = Math.floor(e), i1 = Math.min(i0 + 1, size[0] - 1), t = e - i0, o = [];
          for (let j = 0; j < no; j++){ const s = sample(i0, j) + (sample(i1, j) - sample(i0, j)) * t; o.push(dec[2 * j] + s * (dec[2 * j + 1] - dec[2 * j])); } return cout(o); };
      }
      else if (T === 4 && v instanceof Stream){
        const prog = psProgram(await this.doc.decode(v));
        f = a => { const s = cin(a).slice(); try { psRun(prog, s); } catch (_){ } return cout(s.slice(-(range ? range.length / 2 : s.length)).map(Number)); };
      }
      else f = a => a;
    }
    this.fns.set(v, f); return f;
  }
  /* 渐变（轴向 2、径向 3）⇒ 引擎渐变；M＝渐变空间 → 文件 */
  async gradient(sh, M, res, alpha){
    sh = await this.r(sh); if (!sh) return null; const d = sh instanceof Stream ? sh.dict : sh, T = await this.r(d.ShadingType);
    const cs = await this.colorSpace(d.ColorSpace, res);
    if (T >= 4 && T <= 7){ const m = await this.mesh(sh, d, T, cs, M, alpha); if (!m) this.note('some mesh / free-form gradients could not be read and became grey'); else this.note('mesh / free-form gradients were turned into linear gradients'); return m; }
    if (T !== 2 && T !== 3){ this.note('function-based gradients were replaced by a flat color'); return null; }
    const f = await this.fn(d.Function), dom = (await this.r(d.Domain)) || [0, 1], C = (await this.r(d.Coords)) || [];
    const ts = new Set(); for (let k = 0; k <= 32; k++) ts.add(k / 32); (f.bounds || []).forEach(b => ts.add(c01(b)));
    let st = [...ts].sort((a, b) => a - b).map(t => ({offset:t, c:cs.rgb(f([dom[0] + t * (dom[1] - dom[0])])).map(c01).concat([alpha === undefined ? 1 : alpha])}));
    if (T === 2){
      const p0 = ap(M, C[0], C[1]), p1 = ap(M, C[2], C[3]);
      return {type:'linear', stops:stopsOut(st), x1:r4(p0[0]), y1:r4(p0[1]), x2:r4(p1[0]), y2:r4(p1[1])};
    }
    let [x0, y0, r0, x1, y1, r1] = C;
    if (r1 < r0){ [x0, y0, r0, x1, y1, r1] = [x1, y1, r1, x0, y0, r0]; st = st.map(s => ({offset:1 - s.offset, c:s.c})).reverse(); }
    if (r1 > 0 && r0 > 0) st = st.map(s => ({offset:(r0 + s.offset * (r1 - r0)) / r1, c:s.c}));
    if (st.length && st[0].offset > 0) st.unshift({offset:0, c:st[0].c});
    const c = ap(M, x1, y1), ex = ap(M, x1 + r1, y1), ey = ap(M, x1, y1 + r1), r = Math.hypot(ex[0] - c[0], ex[1] - c[1]), ry = Math.hypot(ey[0] - c[0], ey[1] - c[1]);
    return {type:'radial', stops:stopsOut(st), x1:r4(c[0]), y1:r4(c[1]), x2:r4(ex[0]), y2:r4(ex[1]), r:r4(r), aspect:r ? r4(ry / r) : 1};
  }
  /* 网格／自由渐变（4–7）：读出各顶点的位置与颜色，沿颜色变化最大的方向拟合成一条线性渐变（分 6 段取平均当色标）；变化太小 ⇒ 平均色 */
  async mesh(sh, d, T, cs, M, alpha){
    if (!(sh instanceof Stream)) return null;
    const R = v => this.r(v), data = await this.doc.decode(sh);
    const bc = await R(d.BitsPerCoordinate), bk = await R(d.BitsPerComponent), bf = (await R(d.BitsPerFlag)) || 8, Dc = (await R(d.Decode)) || [];
    if (!(bc > 0 && bk > 0) || Dc.length < 6) return null;
    const fn = d.Function !== undefined ? await this.fn(d.Function) : null, nc = fn ? 1 : cs.n;
    let p = 0, cur = 0, left = 0, eof = false;
    const read = k => { let v = 0; while (k > 0){ if (!left){ if (p >= data.length){ eof = true; return v; } cur = data[p++]; left = 8; } const t = Math.min(k, left); v = v * Math.pow(2, t) + ((cur >> (left - t)) & ((1 << t) - 1)); left -= t; k -= t; } return v; };
    const align = () => { left = 0; };
    const dec = (raw, bits, lo, hi) => lo + raw * (hi - lo) / (Math.pow(2, bits) - 1);
    const coord = () => { const x = dec(read(bc), bc, Dc[0], Dc[1]), y = dec(read(bc), bc, Dc[2], Dc[3]); return ap(M, x, y); };
    const colr = () => { const c = []; for (let i = 0; i < nc; i++) c.push(dec(read(bk), bk, Dc[4 + 2 * i], Dc[5 + 2 * i])); return (fn ? cs.rgb(fn(c)) : cs.rgb(c)).map(c01); };
    const pts = []; let guard = 0;
    if (T === 4 || T === 5){ while (p < data.length && guard++ < 400000){ if (T === 4) read(bf); const q = coord(), c = colr(); if (eof) break; pts.push([q, c]); if (T === 4) align(); } }
    else while (p < data.length && guard++ < 100000){
      const f = read(bf), np = (T === 6 ? 12 : 16) - (f ? 4 : 0), ncol = f ? 2 : 4, P = [], C = [];
      for (let i = 0; i < np; i++) P.push(coord()); for (let i = 0; i < ncol; i++) C.push(colr()); if (eof) break;
      const idx = f ? [2, 5] : [0, 3, 6, 9]; C.forEach((c, i) => pts.push([P[idx[i]], c])); align();
    }
    if (!pts.length) return null;
    const n = pts.length, lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    let mx = 0, my = 0; for (const [q] of pts){ mx += q[0]; my += q[1]; } mx /= n; my /= n;
    let sxx = 0, sxy = 0, syy = 0, sxl = 0, syl = 0, ml = 0; for (const [, c] of pts) ml += lum(c); ml /= n;
    for (const [q, c] of pts){ const x = q[0] - mx, y = q[1] - my, l = lum(c) - ml; sxx += x * x; sxy += x * y; syy += y * y; sxl += x * l; syl += y * l; }
    const det = sxx * syy - sxy * sxy, avg = [0, 1, 2].map(k => pts.reduce((s, [, c]) => s + c[k], 0) / n), a = alpha === undefined ? 1 : alpha;
    let v = det > 1e-9 ? [(syy * sxl - sxy * syl) / det, (sxx * syl - sxy * sxl) / det] : [0, 0]; const g = Math.hypot(v[0], v[1]);
    const flat = () => { const q = ap(M, 0, 0); return {type:'linear', stops:[{offset:0, color:hex(avg), opacity:r4(a), midpoint:0.5}, {offset:1, color:hex(avg), opacity:r4(a), midpoint:0.5}], x1:r4(q[0]), y1:r4(q[1]), x2:r4(q[0] + 1), y2:r4(q[1])}; };
    if (!(g > 0)) return flat();
    v = [v[0] / g, v[1] / g];
    const ts = pts.map(([q]) => (q[0] - mx) * v[0] + (q[1] - my) * v[1]), t0 = Math.min(...ts), t1 = Math.max(...ts);
    if (!(t1 - t0 > 1e-6) || g * (t1 - t0) < 4 / 255) return flat();
    const B = 6, sum = Array.from({length:B}, () => [0, 0, 0, 0]);
    pts.forEach(([, c], i) => { const b = Math.min(B - 1, Math.floor((ts[i] - t0) / (t1 - t0) * B)); sum[b][0] += c[0]; sum[b][1] += c[1]; sum[b][2] += c[2]; sum[b][3]++; });
    const st = sum.map((s2, b) => s2[3] ? {offset:(b + 0.5) / B, c:[s2[0] / s2[3], s2[1] / s2[3], s2[2] / s2[3], a]} : null).filter(Boolean);
    if (st.length === 1) return flat();
    st[0].offset = 0; st[st.length - 1].offset = 1;
    return {type:'linear', stops:stopsOut(st), x1:r4(mx + v[0] * t0), y1:r4(my + v[1] * t0), x2:r4(mx + v[0] * t1), y2:r4(my + v[1] * t1)};
  }
  paintOf(cs, col, pat, alpha){
    if (pat) return null;   // 渐变由外面处理
    return {css:hex(cs.rgb(col.length ? col : cs.init).map(c01)), a:alpha};
  }
  async patternFill(pat, res, alpha){
    pat = await this.r(pat); if (!pat) return null; const d = pat instanceof Stream ? pat.dict : pat;
    if ((await this.r(d.PatternType)) === 2){ const m = (await this.r(d.Matrix)) || I; return this.gradient(d.Shading, cat(m, this.g.patBase), res, alpha); }
    this.note('tiling pattern fills were replaced by grey'); return null;
  }
  clipChain(){ const a = []; for (let c = this.g.clip; c; c = c.parent) a.unshift(c); return a; }
  trivialClip(subs){
    const b = bboxOf(subs); if (!b) return true;
    const rect = subs.length === 1 && subs[0].anchors.length <= 5 && subs[0].anchors.every(a => !a.in && !a.out);
    return rect && b.x <= 0.5 && b.y <= 0.5 && b.x + b.w >= this.W - 0.5 && b.y + b.h >= this.H - 0.5;
  }
  mkClip(subs, rule, parent){ const c = {subs, rule, parent}; c.shape = () => mkShape(subs, 'none', 'none', 0, rule); return c; }
  async paint(fill, stroke, eo, res){
    const subs = this.path.subs, G = this.g;
    if ((fill || stroke) && goodSubs(subs).length){
      const fa = G.ca * G.grp, sa = G.CA * G.grp;
      let F = 'none', S = 'none', sw = 0, opacity = 1;
      if (fill){ if (G.fillPat){ const gr = await this.patternFill(G.fillPat, res, 1); F = gr || '#808080'; } else F = hex(G.fillCS.rgb(G.fill.length ? G.fill : G.fillCS.init).map(c01)); }
      if (stroke){ S = G.strokePat ? '#808080' : hex(G.strokeCS.rgb(G.stroke.length ? G.stroke : G.strokeCS.init).map(c01)); sw = Math.max(0.25, r4((G.lw || 0) * scaleOf(this.D())) || 1); if (G.strokePat) this.note('pattern strokes were replaced by grey'); }
      if (!fill || !stroke || sameNum(fa, sa)) opacity = fill ? fa : sa;
      else { if (typeof F === 'string' && F !== 'none') F = cssRGBA(hexRGB(F), fa); if (S !== 'none') S = cssRGBA(hexRGB(S), sa); }
      const sh = mkShape(subs, F, S, sw, eo ? 'evenodd' : 'nonzero');
      if (sh){ if (opacity < 0.999) sh.opacity = r4(opacity); this.out.shape(sh, this.innerClip(), {blend:G.bm}); }
    }
    if (this.clipRule){ if (!this.trivialClip(subs) && goodSubs(subs).length) G.clip = this.mkClip(subs.map(s => ({closed:true, anchors:s.anchors})), this.clipRule, G.clip); }
    this.path = new PathB(); this.clipRule = null;
  }
  innerClip(){ return this.g.clip; }
  async shade(name, res){
    const sh = await this.res(res, 'Shading', name); if (!sh) return;
    const G = this.g, gr = await this.gradient(sh, this.D(), res, 1), clip = G.clip;
    let subs, rule = 'nonzero', outer = null;
    if (clip){ subs = clip.subs; rule = clip.rule; outer = clip.parent; }
    else { const p = new PathB(); p.rect(0, 0, this.W, this.H); subs = p.subs; }
    const s = mkShape(subs, gr || '#808080', 'none', 0, rule); if (!s) return;
    const a = G.ca * G.grp; if (a < 0.999) s.opacity = r4(a);
    this.out.shape(s, outer, {blend:G.bm});
  }
  /* ── 图 ── */
  async imageCanvas(st, res, inlineDict){
    const d = inlineDict || st.dict, R = v => this.r(v);
    const W = await R(d.Width !== undefined ? d.Width : d.W), H = await R(d.Height !== undefined ? d.Height : d.H);
    if (!(W > 0 && H > 0) || W * H > 64e6) return null;
    const mask = !!(await R(d.ImageMask !== undefined ? d.ImageMask : d.IM));
    const bpc = mask ? 1 : ((await R(d.BitsPerComponent !== undefined ? d.BitsPerComponent : d.BPC)) || 8);
    const dec = await this.doc.decode(inlineDict ? new Stream(d, st.raw) : st, true);
    const c = mkCanvas(W, H), x = c.getContext('2d');
    if (dec.filter === 'DCTDecode' || dec.filter === 'DCT'){
      try { const bm = await createImageBitmap(new Blob([dec.data], {type:'image/jpeg'})); x.drawImage(bm, 0, 0, W, H); } catch (_){ this.note('a JPEG image could not be decoded'); return null; }
    } else if (dec.filter){ this.note(`images in ${dec.filter} format were skipped`); return null; }
    else {
      const data = dec.data, img = x.createImageData(W, H), px = img.data;
      if (mask){
        const D = await R(d.Decode !== undefined ? d.Decode : d.D), inv = Array.isArray(D) && D[0] === 1, rgb = this.g.fillCS.rgb(this.g.fill.length ? this.g.fill : this.g.fillCS.init).map(c01);
        const row = Math.ceil(W / 8);
        for (let y = 0; y < H; y++) for (let i = 0; i < W; i++){ const bit = (data[y * row + (i >> 3)] >> (7 - (i & 7))) & 1, on = inv ? bit === 1 : bit === 0, k = (y * W + i) * 4;
          px[k] = rgb[0] * 255; px[k + 1] = rgb[1] * 255; px[k + 2] = rgb[2] * 255; px[k + 3] = on ? 255 : 0; }
      } else {
        let csv = d.ColorSpace !== undefined ? d.ColorSpace : d.CS;
        if (inlineDict && csv instanceof Name && ({I:1, G:1, RGB:1, CMYK:1}[csv.v] === undefined) && !DEVICE[csv.v]) csv = (await this.res(res, 'ColorSpace', csv.v)) || csv;
        const cs = await this.colorSpace(csv, res), n = cs.n || 1, max = Math.pow(2, bpc) - 1, row = Math.ceil(W * n * bpc / 8);
        const D = await R(d.Decode !== undefined ? d.Decode : d.D);
        const fast = bpc === 8 && !D && (cs === RGB || cs === GRAY);
        for (let y = 0; y < H; y++){
          for (let i = 0; i < W; i++){
            const k = (y * W + i) * 4;
            if (fast){ const o = y * row + i * n; if (n === 3){ px[k] = data[o]; px[k + 1] = data[o + 1]; px[k + 2] = data[o + 2]; } else px[k] = px[k + 1] = px[k + 2] = data[o]; px[k + 3] = 255; continue; }
            const comp = [];
            for (let j = 0; j < n; j++){
              let v;
              if (bpc === 8) v = data[y * row + i * n + j]; else if (bpc === 16){ const o = y * row + (i * n + j) * 2; v = (data[o] << 8) | data[o + 1]; v = v / 65535 * 255; }
              else { const bit = (i * n + j) * bpc; v = 0; for (let q = 0; q < bpc; q++){ const p = bit + q; v = (v << 1) | ((data[y * row + (p >> 3)] >> (7 - (p & 7))) & 1); } }
              if (cs.indexed) comp.push(bpc === 16 ? v : v);
              else { let u = (bpc === 16 ? v / 255 : v / max); if (Array.isArray(D)) u = D[2 * j] + u * (D[2 * j + 1] - D[2 * j]); comp.push(u); }
            }
            if (cs.lab) comp.norm = true;
            const rgb = cs.rgb(comp); px[k] = c01(rgb[0]) * 255; px[k + 1] = c01(rgb[1]) * 255; px[k + 2] = c01(rgb[2]) * 255; px[k + 3] = 255;
          }
        }
        x.putImageData(img, 0, 0);
      }
      if (mask) x.putImageData(img, 0, 0);
    }
    const sm = await R(d.SMask);
    if (sm instanceof Stream){
      try {
        const md = sm.dict, mw = await R(md.Width), mh = await R(md.Height), mb = (await R(md.BitsPerComponent)) || 8, mdec = await this.doc.decode(sm, true);
        let ma = null;
        if (mdec.filter === 'DCTDecode' || mdec.filter === 'DCT'){ const bm = await createImageBitmap(new Blob([mdec.data], {type:'image/jpeg'})); const t = mkCanvas(mw, mh), tx = t.getContext('2d'); tx.drawImage(bm, 0, 0); const g2 = tx.getImageData(0, 0, mw, mh).data; ma = new Uint8Array(mw * mh); for (let i = 0; i < ma.length; i++) ma[i] = g2[i * 4]; }
        else if (!mdec.filter){ ma = new Uint8Array(mw * mh); const row = Math.ceil(mw * mb / 8), mx = Math.pow(2, mb) - 1;
          for (let y = 0; y < mh; y++) for (let i = 0; i < mw; i++){ let v; if (mb === 8) v = mdec.data[y * row + i]; else if (mb === 16) v = mdec.data[y * row + i * 2]; else { const p = i * mb; v = 0; for (let q = 0; q < mb; q++){ const bb = p + q; v = (v << 1) | ((mdec.data[y * row + (bb >> 3)] >> (7 - (bb & 7))) & 1); } v = v / mx * 255; } ma[y * mw + i] = v; } }
        if (ma){ const im = x.getImageData(0, 0, W, H), p2 = im.data;
          for (let y = 0; y < H; y++) for (let i = 0; i < W; i++){ const sx = Math.min(mw - 1, Math.floor(i * mw / W)), sy = Math.min(mh - 1, Math.floor(y * mh / H)); p2[(y * W + i) * 4 + 3] = p2[(y * W + i) * 4 + 3] * ma[sy * mw + sx] / 255; }
          x.putImageData(im, 0, 0); }
      } catch (e){ console.warn('vec-io smask', e); }
    }
    return c;
  }
  async drawImage(can){
    if (!can) return;
    const r = this.out.raster(), ctx = r.ctx, T = cat([1 / can.width, 0, 0, -1 / can.height, 0, 1], this.D());
    ctx.save(); this.clipCanvas(ctx);
    ctx.globalAlpha = c01(this.g.ca * this.g.grp); ctx.setTransform(T[0], T[1], T[2], T[3], T[4], T[5]); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(can, 0, 0); ctx.restore();
    r.meta.push({blend:this.g.bm});
  }
  clipCanvas(ctx){
    for (const c of this.clipChain()){
      ctx.beginPath();
      for (const s of c.subs){ const a = s.anchors; if (!a.length) continue; ctx.moveTo(a[0].x, a[0].y);
        const seg = (p, q) => { if (p.out || q.in){ const o = p.out || [p.x, p.y], i = q.in || [q.x, q.y]; ctx.bezierCurveTo(o[0], o[1], i[0], i[1], q.x, q.y); } else ctx.lineTo(q.x, q.y); };
        for (let k = 1; k < a.length; k++) seg(a[k - 1], a[k]); if (s.closed){ seg(a[a.length - 1], a[0]); ctx.closePath(); } }
      ctx.clip(c.rule === 'evenodd' ? 'evenodd' : 'nonzero');
    }
  }
  /* ── 字型 ── */
  async font(res, name){
    const ref = res && (await this.r(res.Font)) && (await this.r(res.Font))[name], key = ref instanceof Ref ? 'r' + ref.n : ref;
    if (this.fonts.has(key)) return this.fonts.get(key);
    const d = await this.r(ref); let F = null;
    if (d){
      const sub = nm(d.Subtype), R = v => this.r(v);
      let ps = (nm(d.BaseFont) || 'Helvetica').replace(/^[A-Z]{6}\+/, '');
      let toU = null; const tu = await R(d.ToUnicode); if (tu instanceof Stream){ try { toU = parseCMap(await this.doc.decode(tu)); } catch (_){ toU = null; } }
      let fdesc = await R(d.FontDescriptor);
      if (sub === 'Type0'){
        const encv = await R(d.Encoding), enc = nm(encv) || '', desc = await R(((await R(d.DescendantFonts)) || [])[0]) || {};
        fdesc = await R(desc.FontDescriptor) || fdesc;
        const DW = (await R(desc.DW)) || 1000, Wa = (await R(desc.W)) || [], widths = new Map();
        for (let i = 0; i < Wa.length;){ const a = await R(Wa[i]), b = await R(Wa[i + 1]);
          if (Array.isArray(b)){ for (let k = 0; k < b.length; k++) widths.set(a + k, await R(b[k])); i += 2; } else { const w = await R(Wa[i + 2]); for (let k = a; k <= b && k - a < 70000; k++) widths.set(k, w); i += 3; } }
        let encCS = null; if (encv instanceof Stream){ try { encCS = parseCMap(await this.doc.decode(encv)); } catch (_){ } }
        const utf16 = /UTF16|UCS2/i.test(enc), identity = /Identity/i.test(enc), legacy = !utf16 && !identity && LEGACY.find(l => l[0].test(enc));
        const space = (toU && toU.cs.length ? toU.cs : encCS && encCS.cs.length ? encCS.cs : null);
        F = {ps, wscale:0.001, two:true, decode:u8 => {
          if (legacy && !toU){ let s = ''; try { s = new TextDecoder(legacy[1]).decode(u8); } catch (_){ s = ''; } return [...s].map(ch => ({u:ch, w:DW, sp:ch === ' '})); }
          const out = [];
          for (let i = 0; i < u8.length;){
            let n = 2;
            if (space){ n = 0; for (let L = 1; L <= 4 && !n; L++){ if (i + L > u8.length) break; let c = 0; for (let k = 0; k < L; k++) c = c * 256 + u8[i + k]; if (space.some(r => r.n === L && c >= r.lo && c <= r.hi)) n = L; } if (!n) n = 2; }
            n = Math.min(n, u8.length - i); let code = 0; for (let k = 0; k < n; k++) code = code * 256 + u8[i + k]; i += n;
            let u = toU ? toU.look(n, code) : undefined;
            if (u === undefined && utf16) u = String.fromCharCode(code);
            if (u === undefined) u = identity ? '�' : String.fromCharCode(code);
            const cid = identity ? code : (utf16 && code >= 0x20 && code <= 0x7e ? code - 31 : -1);
            out.push({u, w:widths.has(cid) ? widths.get(cid) : DW, sp:n === 1 && code === 32});
          }
          // UTF-16 代理对
          for (let k = 0; k + 1 < out.length; k++){ const a = out[k].u.charCodeAt(0), b = out[k + 1].u.charCodeAt(0); if (a >= 0xd800 && a < 0xdc00 && b >= 0xdc00 && b < 0xe000){ out[k].u += out[k + 1].u; out[k].w += out[k + 1].w; out.splice(k + 1, 1); } }
          return out;
        }};
        if (identity && !toU) this.note('some text has no Unicode map: unreadable characters became �');
      } else {
        const fc = (await R(d.FirstChar)) || 0, Wd = (await R(d.Widths)) || [], ws = []; for (const w of Wd) ws.push(await R(w));
        const missing = fdesc ? ((await R(fdesc.MissingWidth)) || 0) : 0;
        let table = WIN; const encv = await R(d.Encoding), diffs = new Map();
        const bn = e => { const n = nm(e); if (n === 'MacRomanEncoding') table = MAC; else if (n === 'WinAnsiEncoding' || n === 'StandardEncoding' || n === 'PDFDocEncoding') table = WIN; };
        if (encv instanceof Name) bn(encv);
        else if (encv && typeof encv === 'object'){ bn(await R(encv.BaseEncoding)); const df = (await R(encv.Differences)) || []; let c = 0; for (const x of df){ const v = await R(x); if (typeof v === 'number') c = v; else if (v instanceof Name){ diffs.set(c++, v.v); } } }
        const fm = sub === 'Type3' ? ((await R(d.FontMatrix)) || [0.001]) : null;
        F = {ps:sub === 'Type3' ? 'Helvetica' : ps, wscale:fm ? Math.abs(fm[0]) || 0.001 : 0.001, two:false, decode:u8 => [...u8].map(c => {
          let u = toU ? toU.look(1, c) : undefined;
          if (u === undefined && diffs.has(c)) u = glyphUni(diffs.get(c));
          if (u === undefined || u === null) u = table[c];
          const w = c - fc >= 0 && c - fc < ws.length ? ws[c - fc] : missing || 500;
          return {u, w, sp:c === 32};
        })};
      }
      const fw = fdesc ? await R(fdesc.FontWeight) : 0, flags = fdesc ? (await R(fdesc.Flags)) || 0 : 0;
      F.bold = /Bold|Black|Heavy|Semibold|Demi/i.test(ps) || fw >= 600 || !!(flags & (1 << 18));
      F.italic = /Italic|Oblique/i.test(ps) || !!(flags & 64);
    }
    this.fonts.set(key, F); return F;
  }
  show(u8){
    const G = this.g, F = G.font; if (!F || !this.runs) return;
    const mode = G.tr; const invisible = mode === 3 || mode === 7;
    const gl = F.decode(u8); if (!gl.length) return;
    const D = this.D(), start = cat(cat([1, 0, 0, 1, 0, G.rise], this.tm), D);
    let str = '';
    for (const g of gl){
      str += g.u;
      const tx = ((g.w || 0) * F.wscale * G.fs + G.tc + (g.sp ? G.tw : 0)) * G.tz / 100;
      this.tm = cat([1, 0, 0, 1, tx, 0], this.tm);
    }
    if (invisible) return;
    const end = cat(cat([1, 0, 0, 1, 0, G.rise], this.tm), D);
    // 字的「上」：文字空间 (0,1) ⇒ 文件里的长度＝字号缩放；X＝把引擎「平着画的字」转成这里的样子（引擎 y 朝下）
    const M = [start[0] * G.tz / 100, start[1] * G.tz / 100, start[2], start[3], start[4], start[5]];
    const up = Math.hypot(M[2], M[3]) * G.fs, size = up || G.fs;
    const X = [M[0] * G.fs / size, M[1] * G.fs / size, -M[2] * G.fs / size, -M[3] * G.fs / size];
    const paintStroke = mode === 1 || mode === 5;
    const cs = paintStroke ? G.strokeCS : G.fillCS, col = paintStroke ? G.stroke : G.fill;
    const color = hex(cs.rgb(col.length ? col : cs.init).map(c01));
    this.runs.push({str, o:[start[4], start[5]], e:[end[4], end[5]], size, X, color, alpha:(paintStroke ? G.CA : G.ca) * G.grp, blend:G.bm, ps:F.ps, bold:F.bold, italic:F.italic,
      key:F.ps + '|' + color + '|' + (F.bold ? 1 : 0)});
  }
  flushText(){
    const runs = this.runs || []; this.runs = null; if (!runs.length) return;
    layoutRuns(runs, this.out, (r, o) => Object.assign(o, {psFont:r.ps, bold:r.bold, italic:r.italic, color:r.color}));
  }
  /* ── 指令 ── */
  async op(k, a, res, L, depth){
    const G = this.g, n = i => +a[i] || 0, P = (x, y) => ap(this.D(), x, y);
    switch (k){
      case 'q': this.stack.push(G); this.g = Object.assign({}, G); return;
      case 'Q': if (this.stack.length) this.g = this.stack.pop(); return;
      case 'cm': this.g.ctm = cat([n(0), n(1), n(2), n(3), n(4), n(5)], G.ctm); return;
      case 'w': G.lw = n(0); return;
      case 'J': case 'j': case 'M': case 'd': case 'ri': case 'i': return;
      case 'gs': {
        const e = await this.res(res, 'ExtGState', nm(a[0])); if (!e) return;
        if (e.LW !== undefined) G.lw = await this.r(e.LW);
        if (e.ca !== undefined) G.ca = +(await this.r(e.ca)); if (e.CA !== undefined) G.CA = +(await this.r(e.CA));
        if (e.BM !== undefined){ let b = await this.r(e.BM); if (Array.isArray(b)) b = await this.r(b[0]); G.bm = BLEND_OF[nm(b)] || 'normal'; }
        const sm = await this.r(e.SMask); if (sm && !(sm instanceof Name && sm.v === 'None')) this.note('soft masks (opacity masks) were ignored');
        if (e.Font !== undefined){ const f = await this.r(e.Font); if (Array.isArray(f)){ this.note('fonts set through graphic states were ignored'); } }
        return;
      }
      case 'm': { const p = P(n(0), n(1)); this.path.move(p[0], p[1]); return; }
      case 'l': { const p = P(n(0), n(1)); this.path.line(p[0], p[1]); return; }
      case 'c': { const p1 = P(n(0), n(1)), p2 = P(n(2), n(3)), p3 = P(n(4), n(5)); this.path.curve(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]); return; }
      case 'v': { const c0 = this.path.pt || [0, 0], p2 = P(n(0), n(1)), p3 = P(n(2), n(3)); this.path.curve(c0[0], c0[1], p2[0], p2[1], p3[0], p3[1]); return; }
      case 'y': { const p1 = P(n(0), n(1)), p3 = P(n(2), n(3)); this.path.curve(p1[0], p1[1], p3[0], p3[1], p3[0], p3[1]); return; }
      case 'h': this.path.close(); return;
      case 're': { const x = n(0), y = n(1), w = n(2), h = n(3), q = [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
        this.path.move(q[0][0], q[0][1]); for (let i = 1; i < 4; i++) this.path.line(q[i][0], q[i][1]); this.path.close(); return; }
      case 'W': this.clipRule = 'nonzero'; return;
      case 'W*': this.clipRule = 'evenodd'; return;
      case 'n': return this.paint(false, false, false, res);
      case 'f': case 'F': return this.paint(true, false, false, res);
      case 'f*': return this.paint(true, false, true, res);
      case 'S': return this.paint(false, true, false, res);
      case 's': this.path.close(); return this.paint(false, true, false, res);
      case 'B': return this.paint(true, true, false, res);
      case 'B*': return this.paint(true, true, true, res);
      case 'b': this.path.close(); return this.paint(true, true, false, res);
      case 'b*': this.path.close(); return this.paint(true, true, true, res);
      case 'CS': G.strokeCS = await this.colorSpace(a[0], res); G.stroke = G.strokeCS.init.slice(); G.strokePat = null; return;
      case 'cs': G.fillCS = await this.colorSpace(a[0], res); G.fill = G.fillCS.init.slice(); G.fillPat = null; return;
      case 'SC': case 'SCN': if (G.strokeCS.pattern){ G.strokePat = await this.res(res, 'Pattern', nm(a[a.length - 1])); } else G.stroke = a.filter(x => typeof x === 'number'); return;
      case 'sc': case 'scn': if (G.fillCS.pattern){ G.fillPat = await this.res(res, 'Pattern', nm(a[a.length - 1])); } else G.fill = a.filter(x => typeof x === 'number'); return;
      case 'G': G.strokeCS = GRAY; G.stroke = [n(0)]; G.strokePat = null; return;
      case 'g': G.fillCS = GRAY; G.fill = [n(0)]; G.fillPat = null; return;
      case 'RG': G.strokeCS = RGB; G.stroke = [n(0), n(1), n(2)]; G.strokePat = null; return;
      case 'rg': G.fillCS = RGB; G.fill = [n(0), n(1), n(2)]; G.fillPat = null; return;
      case 'K': G.strokeCS = CMYK; G.stroke = [n(0), n(1), n(2), n(3)]; G.strokePat = null; return;
      case 'k': G.fillCS = CMYK; G.fill = [n(0), n(1), n(2), n(3)]; G.fillPat = null; return;
      case 'sh': return this.shade(nm(a[0]), res);
      case 'Do': {
        const xo = await this.res(res, 'XObject', nm(a[0])); if (!(xo instanceof Stream)) return;
        const st = nm(await this.r(xo.dict.Subtype));
        if (st === 'Image') return this.drawImage(await this.imageCanvas(xo, res));
        if (st === 'Form') return this.form(xo, res, depth);
        return;
      }
      case 'BI': return this.inlineImage(L, res);
      case 'BT': this.tm = I; this.tlm = I; this.runs = []; return;
      case 'ET': this.flushText(); return;
      case 'Tf': G.font = await this.font(res, nm(a[0])); G.fs = n(1); return;
      case 'Tc': G.tc = n(0); return;
      case 'Tw': G.tw = n(0); return;
      case 'Tz': G.tz = n(0); return;
      case 'TL': G.tl = n(0); return;
      case 'Ts': G.rise = n(0); return;
      case 'Tr': G.tr = n(0); return;
      case 'Td': this.tlm = cat([1, 0, 0, 1, n(0), n(1)], this.tlm); this.tm = this.tlm; return;
      case 'TD': G.tl = -n(1); this.tlm = cat([1, 0, 0, 1, n(0), n(1)], this.tlm); this.tm = this.tlm; return;
      case 'Tm': this.tlm = this.tm = [n(0), n(1), n(2), n(3), n(4), n(5)]; return;
      case 'T*': this.tlm = cat([1, 0, 0, 1, 0, -G.tl], this.tlm); this.tm = this.tlm; return;
      case 'Tj': if (a[0] instanceof Uint8Array) this.show(a[0]); return;
      case "'": this.tlm = cat([1, 0, 0, 1, 0, -G.tl], this.tlm); this.tm = this.tlm; if (a[0] instanceof Uint8Array) this.show(a[0]); return;
      case '"': G.tw = n(0); G.tc = n(1); this.tlm = cat([1, 0, 0, 1, 0, -G.tl], this.tlm); this.tm = this.tlm; if (a[2] instanceof Uint8Array) this.show(a[2]); return;
      case 'TJ': for (const x of (Array.isArray(a[0]) ? a[0] : [])){ if (x instanceof Uint8Array) this.show(x); else if (typeof x === 'number') this.tm = cat([1, 0, 0, 1, -x / 1000 * G.fs * G.tz / 100, 0], this.tm); } return;
      case 'BDC': case 'BMC': {
        let pushed = false;
        if (k === 'BDC' && nm(a[0]) === 'OC'){
          let p = a[1] instanceof Name ? await this.res(res, 'Properties', a[1].v) : a[1], pref = null;
          if (a[1] instanceof Name){ const pd = res && await this.r(res.Properties); pref = pd && pd[a[1].v]; }
          p = await this.r(p);
          if (p && nm(p.Type) === 'OCMD'){ let o = p.OCGs; o = Array.isArray(o) ? o[0] : o; pref = o; p = await this.r(o); }
          if (p && p.Name !== undefined){
            const name = textStr(await this.r(p.Name)) || 'Layer', id = pref instanceof Ref ? pref.n : null;
            const sib = this.out.last();
            if (sib && sib.kind === 'group' && sib.ocg && id !== null && sib.ocgId === id) this.out.reopen(sib);
            else this.out.open({kind:'group', name, hidden:id !== null && this.hidden.has(id), ocg:true, ocgId:id});
            pushed = true;
          }
        }
        this.marks.push(pushed); return;
      }
      case 'EMC': if (this.marks.pop()) this.out.close(); return;
      case 'MP': case 'DP': case 'BX': case 'EX': case 'd0': case 'd1': return;
      default: return;
    }
  }
  async form(xo, res, depth){
    const d = xo.dict, m = (await this.r(d.Matrix)) || I, save = this.g, stackDepth = this.stack.length;
    const g = Object.assign({}, save); g.ctm = cat(m, save.ctm); g.patBase = cat(g.ctm, this.base);
    if (await this.r(d.Group)){ g.grp = save.grp * save.ca; g.ca = 1; g.CA = 1; }
    this.g = g;
    const fres = (await this.r(d.Resources)) || res, marks = this.marks.length;
    try { await this.run(await this.doc.decode(xo), fres, depth + 1); } catch (e){ if (e instanceof Bad) throw e; this.note('some drawing commands could not be read'); }
    while (this.marks.length > marks){ if (this.marks.pop()) this.out.close(); }
    this.stack.length = stackDepth; this.g = save;
  }
  async inlineImage(L, res){
    const d = {};
    for (;;){ const k = L.tok(); if (k === null) return; if (k.kw === 'ID') break; if (k instanceof Name){ const v = L.tok(); d[k.v] = parseObj(L, v, false); } }
    const b = L.b; let s = L.p; if (isWS(b[s])) s++;
    const W = d.Width || d.W, H = d.Height || d.H, bpc = (d.ImageMask || d.IM) ? 1 : (d.BitsPerComponent || d.BPC || 8), F = d.Filter || d.F;
    let e = -1;
    if (!F || (Array.isArray(F) && !F.length)){
      const csn = nm(d.ColorSpace || d.CS), n = csn === 'RGB' || csn === 'DeviceRGB' ? 3 : csn === 'CMYK' || csn === 'DeviceCMYK' ? 4 : 1;
      e = s + Math.ceil(W * n * bpc / 8) * H;
    }
    if (e < 0 || e > b.length){ for (let i = s; i + 2 < b.length; i++) if (b[i] === 69 && b[i + 1] === 73 && isWS(b[i - 1]) && (i + 2 >= b.length || isWS(b[i + 2]) || isDel(b[i + 2]))){ e = i - 1; break; } }
    if (e < 0) e = b.length;
    const raw = b.subarray(s, e);
    L.p = e; for (;;){ const t = L.tok(); if (t === null || t.kw === 'EI') break; }
    const csv = d.ColorSpace !== undefined ? d.ColorSpace : d.CS;
    if (csv instanceof Name && ({I:'Indexed', G:'DeviceGray', RGB:'DeviceRGB', CMYK:'DeviceCMYK'})[csv.v]) d.ColorSpace = new Name(({I:'Indexed', G:'DeviceGray', RGB:'DeviceRGB', CMYK:'DeviceCMYK'})[csv.v]);
    const fx = f => { const m = {AHx:'ASCIIHexDecode', A85:'ASCII85Decode', LZW:'LZWDecode', Fl:'FlateDecode', RL:'RunLengthDecode', DCT:'DCTDecode', CCF:'CCITTFaxDecode'}; return f instanceof Name ? new Name(m[f.v] || f.v) : f; };
    if (F) d.Filter = Array.isArray(F) ? F.map(fx) : fx(F);
    await this.drawImage(await this.imageCanvas({raw}, res, d));
  }
}
const hexRGB = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return [0, 0, 0]; const v = parseInt(m[1], 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };

/* ═══════════════════ Illustrator 私有资料（页面 /PieceInfo /Illustrator /Private） ═══════════════════
   Illustrator 自己读的那份：AIPrivateData1…N（存成 PDF 的叫 AIPDFPrivateData1…N）接起来，开头标记说压缩方式——
   「%AI24_ZStandard_Data」后接 Zstandard 帧、「%AI12_CompressedData」后接 zlib，其余是未压缩的文字。
   解开后是 Illustrator 文字型档格式（%!PS-Adobe 开头）：图层 Lb…LB（可嵌套＝子图层·Lb 第一个数＝看得见）、Ln 层名、
   编组 u/U、复合路径 *u/*U、路径 m/L/c/v/y＋f/F/s/S/b/B/n/N、色 g/k/x/Xa/Xx（描边大写）、w、XR、Xy、渐变 Bb…Bg/Bm…BB；
   物件名在物件后面的 %_/ArtDictionary（/XMLUID : (名) ; (AI10_ArtUID) ,）；字典是后缀式（值 键 ,  ／  类型 : … ;）。
   新版文字（/AI11Text 字典＋XW）只记故事编号与区域文字的框（/ConfiningPath），内容在 %AI11_BeginTextDocument 里
   （ASCII85、数字键的 << >> 字典：/1 /1 是故事阵列，故事 /0 /0 是字串、/0 /5 是段落，段落属性 /0 是对齐）。
   读入：PDF 外观照旧读成物件清单，私有资料读成图层树，两边照画的顺序与外框配对——
   看得见的物件一律用 PDF 外观那份（画面跟原来一样）、只换上图层树位置与名字；PDF 里没有的（藏起来的层与物件）才用私有资料解出来的路径；
   配不上的 PDF 物件按前后已配上的物件放回同一层。私有资料解析不了或配对太少 ⇒ 整份退回只读 PDF 外观。 */
function zstd(src){
  const rd32 = p => (src[p] | (src[p + 1] << 8) | (src[p + 2] << 16) | (src[p + 3] << 24)) >>> 0;
  let out = new Uint8Array(Math.max(1024, src.length * 4)), on = 0;
  const grow = n => { if (on + n <= out.length) return; let L = out.length * 2; while (L < on + n) L *= 2; const o = new Uint8Array(L); o.set(out.subarray(0, on)); out = o; };
  const hb = v => 31 - Math.clz32(v);
  // 倒读位流（位元组 [s, e)·末位元组最高的 1 是起点标记·读过头补 0、left 变负）
  const back = (s, e) => {
    if (e <= s || !src[e - 1]) throw new Error('zstd: bad bitstream');
    let pos = (e - s - 1) * 8 + hb(src[e - 1]);
    const peek = (p, n) => {
      if (p < 0){ if (p + n <= 0) return 0; return peek(0, p + n) << -p; }
      const i = s + (p >> 3), sh = p & 7;
      const v = ((i < e ? src[i] : 0) | ((i + 1 < e ? src[i + 1] : 0) << 8) | ((i + 2 < e ? src[i + 2] : 0) << 16) | ((i + 3 < e ? src[i + 3] : 0) << 24)) >>> 0;
      return (v >>> sh) & ((1 << n) - 1);
    };
    return {
      read(n){ if (!n) return 0; if (n > 24){ const lo = this.read(n - 16); return this.read(16) * (1 << (n - 16)) + lo; } pos -= n; return peek(pos, n); },
      get left(){ return pos; },
    };
  };
  // FSE 分布（正读）⇒ {AL, probs, bytes}
  const fseDesc = (p, maxSym, maxAL) => {
    let bit = 0;
    const fw = n => { let v = 0; for (let k = 0; k < n; k++, bit++) v |= ((src[p + (bit >> 3)] >> (bit & 7)) & 1) << k; return v; };
    const AL = fw(4) + 5; if (AL > maxAL) throw new Error('zstd: accuracy log');
    let remaining = 1 << AL, sym = 0; const probs = [];
    while (remaining > 0 && sym <= maxSym){
      const bits = hb(remaining + 1) + 1, lowMask = (1 << (bits - 1)) - 1, thr = (1 << bits) - 1 - (remaining + 1);
      let val = fw(bits);
      if ((val & lowMask) < thr){ bit--; val &= lowMask; } else if (val > lowMask) val -= thr;
      const pr = val - 1; remaining -= pr < 0 ? -pr : pr; probs[sym++] = pr;
      if (pr === 0){ let rep = fw(2); for (;;){ for (let k = 0; k < rep; k++) probs[sym++] = 0; if (rep === 3) rep = fw(2); else break; } }
    }
    if (remaining !== 0 || sym > maxSym + 1) throw new Error('zstd: bad distribution');
    return {AL, probs, bytes:(bit + 7) >> 3};
  };
  const fseTable = (probs, AL) => {
    const size = 1 << AL, sym = new Uint8Array(size), nb = new Uint8Array(size), base = new Uint16Array(size), next = [];
    let high = size;
    probs.forEach((pr, s) => { if (pr === -1){ sym[--high] = s; next[s] = 1; } });
    const step = (size >> 1) + (size >> 3) + 3, mask = size - 1; let pos = 0;
    probs.forEach((pr, s) => { if (pr > 0){ next[s] = pr; for (let k = 0; k < pr; k++){ sym[pos] = s; do pos = (pos + step) & mask; while (pos >= high); } } });
    if (pos !== 0) throw new Error('zstd: bad table');
    for (let i = 0; i < size; i++){ const s = sym[i], ns = next[s]++; nb[i] = AL - hb(ns); base[i] = (ns << nb[i]) - size; }
    return {AL, sym, nb, base};
  };
  const rleTable = s => ({AL:0, sym:Uint8Array.of(s), nb:Uint8Array.of(0), base:Uint16Array.of(0)});
  const LL_DEF = [4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1, -1, -1, -1, -1];
  const ML_DEF = [1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1];
  const OF_DEF = [1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1];
  const LL_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
  const LL_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const ML_BASE = [], ML_BITS = [];
  for (let i = 0; i < 32; i++){ ML_BASE.push(i + 3); ML_BITS.push(0); }
  [[35, 1], [37, 1], [39, 1], [41, 1], [43, 2], [47, 2], [51, 3], [59, 3], [67, 4], [83, 4], [99, 5], [131, 7], [259, 8], [515, 9], [1027, 10], [2051, 11], [4099, 12], [8195, 13], [16387, 14], [32771, 15], [65539, 16]]
    .forEach(([b, n]) => { ML_BASE.push(b); ML_BITS.push(n); });
  const PRE = {ll:fseTable(LL_DEF, 6), ml:fseTable(ML_DEF, 6), of:fseTable(OF_DEF, 5)};
  // 霍夫曼：权重（FSE 压的或 4 位一个）⇒ 查表（码长最长的排最前）
  const hufTable = p => {
    const h = src[p], w = []; let used;
    if (h < 128){
      const d = fseDesc(p + 1, 255, 6), T = fseTable(d.probs, d.AL), br = back(p + 1 + d.bytes, p + 1 + h);
      let s1 = br.read(T.AL), s2 = br.read(T.AL);
      for (;;){
        if (w.length > 255) throw new Error('zstd: huffman weights');
        w.push(T.sym[s1]); s1 = T.base[s1] + br.read(T.nb[s1]);
        if (br.left < 0){ w.push(T.sym[s2]); break; }
        w.push(T.sym[s2]); s2 = T.base[s2] + br.read(T.nb[s2]);
        if (br.left < 0){ w.push(T.sym[s1]); break; }
      }
      used = 1 + h;
    } else {
      const n = h - 127; for (let i = 0; i < n; i++) w.push(i & 1 ? src[p + 1 + (i >> 1)] & 15 : src[p + 1 + (i >> 1)] >> 4);
      used = 1 + ((n + 1) >> 1);
    }
    let tot = 0; for (const x of w) if (x) tot += 1 << (x - 1);
    if (!tot) throw new Error('zstd: huffman weights');
    const maxBits = hb(tot) + 1, rest = (1 << maxBits) - tot;
    if (rest & (rest - 1) || maxBits > 11) throw new Error('zstd: huffman weights');
    w.push(hb(rest) + 1);
    const bits = w.map(x => (x ? maxBits + 1 - x : 0)), cnt = new Array(maxBits + 2).fill(0);
    bits.forEach(b => { if (b) cnt[b]++; });
    const size = 1 << maxBits, sym = new Uint8Array(size), nb = new Uint8Array(size), idx = new Array(maxBits + 2).fill(0);
    for (let i = maxBits; i >= 1; i--){ idx[i - 1] = idx[i] + cnt[i] * (1 << (maxBits - i)); nb.fill(i, idx[i], idx[i - 1]); }
    bits.forEach((b, s) => { if (b){ const len = 1 << (maxBits - b); sym.fill(s, idx[b], idx[b] + len); idx[b] += len; } });
    return {T:{maxBits, sym, nb}, used};
  };
  const hufStream = (T, s, e, dst, d0, n) => {
    const br = back(s, e), mask = (1 << T.maxBits) - 1; let st = br.read(T.maxBits);
    for (let k = 0; k < n; k++){ dst[d0 + k] = T.sym[st]; const b = T.nb[st]; st = ((st << b) + br.read(b)) & mask; }
  };
  let p = 0;
  while (p + 4 <= src.length){
    const magic = rd32(p);
    if ((magic & 0xfffffff0) === 0x184d2a50){ p += 8 + rd32(p + 4); continue; }   // 可跳过帧
    if (magic !== 0xfd2fb528) throw new Error('zstd: bad magic');
    p += 4;
    const fhd = src[p++], fcsFlag = fhd >> 6, single = (fhd >> 5) & 1, cks = (fhd >> 2) & 1, did = fhd & 3;
    if (!single) p++;
    if (did){ const n = [0, 1, 2, 4][did]; let v = 0; for (let k = 0; k < n; k++) v |= src[p + k] << (8 * k); p += n; if (v) throw new Error('zstd: dictionary not supported'); }
    p += [single ? 1 : 0, 2, 4, 8][fcsFlag];
    const rep = [1, 4, 8]; let huf = null, tLL = null, tOF = null, tML = null;
    for (let last = 0; !last;){
      if (p + 3 > src.length) throw new Error('zstd: truncated');
      const bh = src[p] | (src[p + 1] << 8) | (src[p + 2] << 16); p += 3;
      last = bh & 1; const type = (bh >> 1) & 3, size = bh >> 3;
      if (type === 0){ grow(size); out.set(src.subarray(p, p + size), on); on += size; p += size; continue; }
      if (type === 1){ grow(size); out.fill(src[p], on, on + size); on += size; p += 1; continue; }
      if (type !== 2 || p + size > src.length) throw new Error('zstd: bad block');
      const end = p + size; let q = p;
      // 字面量
      const b0 = src[q], lt = b0 & 3, sf = (b0 >> 2) & 3; let lit, litN;
      if (lt < 2){
        let n; if (!(sf & 1)){ n = b0 >> 3; q += 1; } else if (sf === 1){ n = (b0 >> 4) + (src[q + 1] << 4); q += 2; } else { n = (b0 >> 4) + (src[q + 1] << 4) + (src[q + 2] << 12); q += 3; }
        if (lt === 0){ lit = src.subarray(q, q + n); q += n; } else { lit = new Uint8Array(n).fill(src[q]); q += 1; }
        litN = n;
      } else {
        const hl = sf < 2 ? 3 : sf === 2 ? 4 : 5, fb = sf < 2 ? 10 : sf === 2 ? 14 : 18;
        let v = 0; for (let k = 0; k < hl; k++) v += src[q + k] * 2 ** (8 * k);
        const regen = Math.floor(v / 16) % (1 << fb), comp = Math.floor(v / 2 ** (4 + fb)) % (1 << fb), streams = sf === 0 ? 1 : 4;
        q += hl; const ce = q + comp;
        if (lt === 2){ const H = hufTable(q); huf = H.T; q += H.used; } else if (!huf) throw new Error('zstd: no huffman table');
        lit = new Uint8Array(regen); litN = regen;
        if (streams === 1) hufStream(huf, q, ce, lit, 0, regen);
        else {
          const s1 = src[q] | (src[q + 1] << 8), s2 = src[q + 2] | (src[q + 3] << 8), s3 = src[q + 4] | (src[q + 5] << 8), seg = Math.ceil(regen / 4);
          let a = q + 6; const ends = [a + s1, a + s1 + s2, a + s1 + s2 + s3, ce];
          for (let k = 0; k < 4; k++){ hufStream(huf, a, ends[k], lit, k * seg, k < 3 ? seg : regen - 3 * seg); a = ends[k]; }
        }
        q = ce;
      }
      // 序列（字面长、匹配长、距离；最近三个距离可重用）
      let ns = src[q++];
      if (ns >= 128){ if (ns < 255) ns = ((ns - 128) << 8) + src[q++]; else { ns = src[q] + (src[q + 1] << 8) + 0x7f00; q += 2; } }
      let lp = 0;
      if (ns){
        const modes = src[q++];
        const pick = (mode, pre, maxSym, maxAL, prev) => {
          if (mode === 0) return pre;
          if (mode === 1) return rleTable(src[q++]);
          if (mode === 2){ const d = fseDesc(q, maxSym, maxAL); q += d.bytes; return fseTable(d.probs, d.AL); }
          if (!prev) throw new Error('zstd: no table to repeat'); return prev;
        };
        tLL = pick(modes >> 6, PRE.ll, 35, 9, tLL); tOF = pick((modes >> 4) & 3, PRE.of, 31, 8, tOF); tML = pick((modes >> 2) & 3, PRE.ml, 52, 9, tML);
        const br = back(q, end);
        let sL = br.read(tLL.AL), sO = br.read(tOF.AL), sM = br.read(tML.AL);
        for (let i = 0; i < ns; i++){
          const oc = tOF.sym[sO], mc = tML.sym[sM], lc = tLL.sym[sL];
          if (oc > 31 || mc > 52 || lc > 35) throw new Error('zstd: bad code');
          const ov = 2 ** oc + br.read(oc), ml = ML_BASE[mc] + br.read(ML_BITS[mc]), ll = LL_BASE[lc] + br.read(LL_BITS[lc]);
          if (i < ns - 1){ sL = tLL.base[sL] + br.read(tLL.nb[sL]); sM = tML.base[sM] + br.read(tML.nb[sM]); sO = tOF.base[sO] + br.read(tOF.nb[sO]); }
          let off;
          if (ov > 3){ off = ov - 3; rep[2] = rep[1]; rep[1] = rep[0]; rep[0] = off; }
          else {
            const ix = ov - 1 + (ll === 0 ? 1 : 0);
            if (ix === 0) off = rep[0];
            else { off = ix < 3 ? rep[ix] : rep[0] - 1; if (ix > 1) rep[2] = rep[1]; rep[1] = rep[0]; rep[0] = off; }
          }
          if (lp + ll > litN) throw new Error('zstd: literals overrun');
          grow(ll + ml); out.set(lit.subarray(lp, lp + ll), on); on += ll; lp += ll;
          if (!off || off > on) throw new Error('zstd: bad offset');
          let from = on - off;
          if (off >= ml){ out.copyWithin(on, from, from + ml); on += ml; } else for (let k = 0; k < ml; k++) out[on++] = out[from++];
        }
      }
      const rest = litN - lp; grow(rest); out.set(lit.subarray(lp, litN), on); on += rest;
      p = end;
    }
    if (cks) p += 4;
  }
  return out.slice(0, on);
}

/* 私有资料 ⇒ 文字（latin1 一位元组一字·字串到用时再照 UTF-8 解）；没有／认不得 ⇒ null */
async function aiPrivText(D, pinfo){
  const ill = await D.r(pinfo.Illustrator), priv = ill && typeof ill === 'object' ? await D.r(ill.Private) : null;
  if (!priv || typeof priv !== 'object') return null;
  const n = +(await D.r(priv.NumBlock)) || 0, parts = [];
  for (let i = 1; i <= Math.max(n, 1); i++){
    const st = await D.r(priv['AIPrivateData' + i] !== undefined ? priv['AIPrivateData' + i] : priv['AIPDFPrivateData' + i]);
    if (!(st instanceof Stream)) break;
    parts.push(await D.decode(st));
  }
  if (!parts.length) return null;
  let all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)), q = 0; for (const p of parts){ all.set(p, q); q += p.length; }
  const head = latin(all, 0, Math.min(all.length, 64)), m = /^%AI(\d+)_(ZStandard_Data|CompressedData)/.exec(head);
  if (m) all = m[2] === 'ZStandard_Data' ? zstd(all.subarray(m[0].length)) : await inflate(all.subarray(m[0].length));
  // 一位元组一字（TextDecoder 的 latin1 其实是 windows-1252，0x80–0x9F 会变字，不能用）
  let s = ''; for (let k = 0; k < all.length; k += 8192) s += String.fromCharCode.apply(null, all.subarray(k, k + 8192));
  return /^%!PS-Adobe/.test(s) ? s : null;
}
const aiStr = s => { const b = Uint8Array.from(s, c => c.charCodeAt(0) & 255); try { return new TextDecoder('utf-8', {fatal:true}).decode(b); } catch (_){ return s; } };

/* 新版文字的故事（%AI11_BeginTextDocument 里 /AI11TextDocument 那段）⇒ [{text, align}]（照 StoryIndex） */
function aiStories(txt){
  const a = txt.indexOf('%AI11_BeginTextDocument'), b = txt.indexOf('%AI11_EndTextDocument', a);
  if (a < 0 || b < 0) return [];
  const seg = txt.slice(a, b), k = seg.indexOf('/AI11TextDocument'); if (k < 0) return [];
  const body = seg.slice(seg.indexOf('\n', k) + 1).split(/\r?\n|\r/).filter(l => l[0] === '%').map(l => l.slice(1)).join('');
  const e = body.indexOf('~>'), u8 = a85(Uint8Array.from(e < 0 ? body : body.slice(0, e + 2), c => c.charCodeAt(0) & 255));
  const L = new Lexer(u8, 0), root = {};
  for (;;){ const key = L.tok(); if (!(key instanceof Name)) break; root[key.v] = parseObj(L, L.tok(), false); }
  const g = (o, ...ks) => { for (const x of ks){ if (o == null) return undefined; o = o[x]; } return o; };
  const JUST = ['left', 'right', 'center', 'left', 'right', 'center', 'left'];
  return (g(root, '1', '1') || []).map(st => {
    const t = g(st, '0', '0'), j = g(st, '0', '5', '0', 0, '0', '0', '5', '0');
    return {text:t instanceof Uint8Array ? textStr(t).replace(/\r/g, '\n').replace(/\n$/, '') : null, align:typeof j === 'number' ? JUST[j] || 'left' : null};
  });
}

/* 图层区（%%EndSetup 到 %%PageTrailer）⇒ 图层树。节点：
   {t:'layer', name, visible, kids}｜{t:'group', name, kids}｜{t:'path', name, hidden, subs, fill, stroke, sw, rule, opacity, blend, bad?}
   {t:'text', name, hidden, story, boxSubs?（区域文字的框·画板坐标）}｜{t:'other', name, hidden}（点阵、外挂物件、剪切组、旧版文字…照 PDF 外观） */
function aiLayerTree(txt){
  const a = txt.indexOf('%%EndSetup'); let b = txt.indexOf('%%PageTrailer', a); if (b < 0) b = txt.indexOf('%%Trailer', a);
  if (a < 0 || b < 0) throw new Error('no layers');
  const src = txt.slice(a, b);
  // 渐变定义：(名) 类型 色标数 Bd … 色标「色… 色式 不透明 ? 中点 位置 %_BS」… BD
  const grads = new Map();
  const gre = /%AI5_BeginGradient: \(([^)]*)\)[\s\S]*?\n\(([^)]*)\) (\d) (\d+) Bd([\s\S]*?)\nBD/g; let gm;
  while ((gm = gre.exec(txt))){
    const stops = [];
    for (const line of gm[5].split(/\r?\n|\r/)){
      const mm = /^([-\d.\s]+?)\s+%_BS\s*$/.exec(line); if (!mm) continue;
      const v = mm[1].trim().split(/\s+/).map(Number), n = v.length; if (n < 6) continue;
      const style = v[n - 5], col = v.slice(0, n - 5);
      const rgb = style === 0 ? [col[0], col[0], col[0]] : style === 1 ? CMYK.rgb(col) : col.length >= 7 ? col.slice(4, 7) : col.length >= 4 ? CMYK.rgb(col) : null;
      if (!rgb) continue;
      stops.push({offset:c01(v[n - 1] / 100), color:hex(rgb), opacity:r4(c01(v[n - 4])), midpoint:r4(c01(v[n - 2] / 100) || 0.5)});
    }
    stops.sort((x, y) => x.offset - y.offset);
    if (stops.length) grads.set(aiStr(gm[2]), {radial:gm[3] === '1', stops});
  }
  // 记号：数、字串、名字、运算子；%_ 开头的行照内容读，%AI 标记照标记，其余注解略过
  const toks = []; let i = 0; const n = src.length;
  while (i < n){
    const c = src.charCodeAt(i);
    if (c === 10 || c === 13 || c === 32 || c === 9){ i++; continue; }
    if (c === 37){   // %
      if (src[i + 1] === '_'){ i += 2; continue; }
      let e = i; while (e < n && src[e] !== '\n' && src[e] !== '\r') e++;
      const line = src.slice(i, e); i = e;
      const mk = /^%AI\d+_(Begin|End)(\w+)/.exec(line); if (mk) toks.push({mk:mk[1], what:mk[2]});
      continue;
    }
    if (c === 40){   // (字串)
      let depth = 1, s = ''; i++;
      while (i < n){ let ch = src[i++];
        if (ch === '\\'){ const d = src[i++];
          if (d >= '0' && d <= '7'){ let v = +d; for (let k = 0; k < 2 && src[i] >= '0' && src[i] <= '7'; k++) v = v * 8 + +src[i++]; ch = String.fromCharCode(v & 255); }
          else ch = d === 'n' ? '\n' : d === 'r' ? '\r' : d === 't' ? '\t' : d === '\r' || d === '\n' ? '' : d; s += ch; continue; }
        if (ch === '(') depth++; else if (ch === ')' && --depth === 0) break; s += ch; }
      toks.push({s}); continue;
    }
    if (c === 60 && src[i + 1] !== '<'){ const e = src.indexOf('>', i); i = e < 0 ? n : e + 1; toks.push({s:''}); continue; }   // <十六进位>
    if (c === 91 || c === 93){ i++; continue; }   // [ ]（虚线阵列等·不用）
    let e = i; while (e < n && !/[\s()<[\]%]/.test(src[e])) e++;
    if (e === i){ i++; continue; }
    const w = src.slice(i, e); i = e;
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(w)) toks.push(+w);
    else if (/^d\d+$/.test(w)){ toks.push({op:'d'}, +w.slice(1)); }   // 「[]0 d0 XR」：虚线 d 后面紧接下一个数
    else if (w[0] === '/') toks.push({nm:w.slice(1)});
    else toks.push({op:w});
  }
  const root = {t:'layer', name:'', visible:true, kids:[]}, stack = [root];
  const cur = () => stack[stack.length - 1];
  const st = {fill:'#000000', stroke:'none', sw:1, rule:'nonzero', opacity:1, blend:'normal', hidden:false, fillBad:false, strokeBad:false};
  let ops = [], path = null, comp = null, grad = null, lastObj = null, pendText = null, opq = null;
  const dicts = [];   // 后缀式字典堆叠：{type, ops:[], kv:{}, art?:PathB}
  const BL = ['normal', 'multiply', 'screen', 'overlay', 'softLight', 'hardLight', 'colorDodge', 'colorBurn', 'darken', 'lighten', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
  const nums = () => ops.filter(x => typeof x === 'number');
  const colorOf = (op, v) => {
    if (op === 'g' || op === 'G') return hex([v[v.length - 1], v[v.length - 1], v[v.length - 1]]);
    if (op === 'k' || op === 'K') return v.length >= 4 ? hex(CMYK.rgb(v.slice(-4))) : null;
    if (op === 'Xa' || op === 'XA') return v.length >= 3 ? hex(v.slice(-3)) : null;
    if (op === 'x' || op === 'X'){   // c m y k (名) tint type
      if (v.length < 6) return null; const t = c01(v[v.length - 2]); return hex(CMYK.rgb(v.slice(0, 4).map(x => x * (1 - t))));
    }
    if (op === 'Xx' || op === 'XX'){   // 色… (名) tint type（type 0＝CMYK 四个数、1＝RGB 三个数）
      const type = v[v.length - 1], t = c01(v[v.length - 2]), col = v.slice(0, v.length - 2);
      if (type === 1 && col.length >= 3) return hex(col.slice(-3).map(x => 1 - (1 - x) * (1 - t)));
      if (col.length >= 4) return hex(CMYK.rgb(col.slice(0, 4).map(x => x * (1 - t))));
      return null;
    }
    return null;
  };
  const gradFill = () => {
    if (!grad || !grad.def) return null;
    const G = grad, m = cat(G.m || I, G.bm || I), o = ap(m, G.xo, G.yo), e = ap(m, G.xo + Math.cos(G.ang * Math.PI / 180) * G.len, G.yo + Math.sin(G.ang * Math.PI / 180) * G.len);
    return {art:true, radial:G.def.radial, o, e, m, stops:G.def.stops};
  };
  const finishPath = (op) => {
    const close = op === 'f' || op === 's' || op === 'b' || op === 'N';
    if (path && close) path.close();
    const doFill = /^[fFbB]$/.test(op), doStroke = /^[sSbB]$/.test(op);
    const g = doFill ? (grad ? gradFill() : null) : null;
    const piece = {subs:path ? path.subs : [], fill:doFill ? (g || st.fill) : 'none', stroke:doStroke ? st.stroke : 'none', sw:st.sw, rule:st.rule,
      bad:(doFill && (grad ? !g : st.fillBad)) || (doStroke && st.strokeBad), opacity:st.opacity, blend:st.blend, hidden:st.hidden};
    path = null;
    if (comp){ comp.subs.push(...piece.subs); Object.assign(comp, {fill:piece.fill, stroke:piece.stroke, sw:piece.sw, rule:piece.rule, opacity:piece.opacity, blend:piece.blend, hidden:piece.hidden}); comp.bad = comp.bad || piece.bad; return; }
    const o = Object.assign({t:'path', name:''}, piece); cur().kids.push(o); lastObj = o;
  };
  const other = () => { const o = {t:'other', name:'', hidden:st.hidden}; cur().kids.push(o); lastObj = o; };
  for (let k = 0; k < toks.length; k++){
    const t = toks[k];
    // 认不得的整块（%AI…_Begin…／End… 包住的点阵、外挂物件等，剪切组 q…Q、旧版文字 To…TO）⇒ 一个 other 叶子
    if (t.mk){
      if (t.what === 'Layer') continue;
      if (opq){ if (opq.mk === t.what){ if (t.mk === 'Begin') opq.d++; else if (!--opq.d){ opq = null; other(); } } continue; }
      if (t.mk === 'Begin'){ opq = {mk:t.what, d:1}; ops = []; path = null; }
      continue;
    }
    if (opq){
      if (opq.open && t.op === opq.open) opq.d++;
      else if (opq.open && t.op === opq.close && !--opq.d){ opq = null; other(); }
      continue;
    }
    if (dicts.length){
      const D = dicts[dicts.length - 1];
      if (t.op === ':' ){ dicts.push({type:(D.ops.pop() || {}).nm, ops:[], kv:{}}); continue; }
      if (t.op === ';'){ const done = dicts.pop(); if (dicts.length) dicts[dicts.length - 1].ops.push(done); else onDict(done); continue; }
      if (t.op === ','){ const key = D.ops.pop(); let v = D.ops.pop(); while (v && v.nm !== undefined && D.ops.length) v = D.ops.pop();
        if (key) D.kv[key.nm !== undefined ? key.nm : key.s] = v; continue; }
      if (t.op === 'X='){ D.art = new PathB(); continue; }
      if (t.op === 'X+'){ continue; }
      if (t.op && D.art){
        const v = D.ops.filter(x => typeof x === 'number'); D.ops = D.ops.filter(x => typeof x !== 'number');
        if (t.op === 'm') D.art.move(v[0], v[1]); else if (t.op === 'l' || t.op === 'L') D.art.line(v[0], v[1]);
        else if (t.op === 'c' || t.op === 'C') D.art.curve(v[0], v[1], v[2], v[3], v[4], v[5]);
        continue;
      }
      if (t.op) continue;
      D.ops.push(t); continue;
    }
    if (t.op === ':'){ dicts.push({type:(ops.pop() || {}).nm, ops:[], kv:{}}); ops = []; continue; }
    if (t.op === undefined){ ops.push(t); continue; }
    const v = nums(), op = t.op;
    switch (op){
      case 'Lb': { const L = {t:'layer', name:'', visible:v[0] !== 0, kids:[]}; cur().kids.push(L); stack.push(L); lastObj = L; break; }
      case 'Ln': { const s = ops.find(x => x.s !== undefined); if (s && cur().t === 'layer') cur().name = aiStr(s.s); break; }
      case 'LB': if (cur().t !== 'layer' || stack.length < 2) throw new Error('layer nesting'); stack.pop(); lastObj = null; break;
      case 'u': { const g = {t:'group', name:'', kids:[]}; cur().kids.push(g); stack.push(g); break; }
      case 'U': if (cur().t !== 'group') throw new Error('group nesting'); lastObj = stack.pop(); break;
      case '*u': comp = {t:'path', name:'', subs:[], bad:false}; break;
      case '*U': if (comp){ cur().kids.push(comp); lastObj = comp; comp = null; } break;
      case 'q': case 'To': opq = {open:op, close:op === 'q' ? 'Q' : 'TO', d:1}; path = null; break;
      case 'm': path = path || new PathB(); path.move(v[0], v[1]); break;
      case 'l': case 'L': if (path) path.line(v[0], v[1]); break;
      case 'c': case 'C': if (path) path.curve(v[0], v[1], v[2], v[3], v[4], v[5]); break;
      case 'v': case 'V': if (path){ const pt = path.pt || [v[0], v[1]]; path.curve(pt[0], pt[1], v[0], v[1], v[2], v[3]); } break;
      case 'y': case 'Y': if (path) path.curve(v[0], v[1], v[2], v[3], v[2], v[3]); break;
      case 'h': case 'H': if (path) path.close(); break;
      case 'f': case 'F': case 's': case 'S': case 'b': case 'B': case 'n': case 'N': finishPath(op); break;
      case 'g': case 'k': case 'x': case 'Xa': case 'Xx': { const c = colorOf(op, v); st.fill = c || st.fill; st.fillBad = !c; break; }
      case 'G': case 'K': case 'X': case 'XA': case 'XX': { const c = colorOf(op, v); st.stroke = c || st.stroke; st.strokeBad = !c; break; }
      case 'p': st.fillBad = true; break;
      case 'P': st.strokeBad = true; break;
      case 'w': st.sw = v[0]; break;
      case 'XR': st.rule = v[0] === 1 ? 'evenodd' : 'nonzero'; break;
      case 'Xy': st.blend = BL[v[0]] || 'normal'; st.opacity = c01(v[1] === undefined ? 1 : v[1]); break;
      case 'Xw': st.hidden = v[0] === 1; break;
      case 'Bb': grad = {xo:0, yo:0, ang:0, len:1}; break;
      case 'Bg': if (grad){   // flag (名) x0 y0 角度 长度 a b c d tx ty …
        const si = ops.findIndex(x => x && x.s !== undefined), w = si < 0 ? [] : ops.slice(si + 1).filter(x => typeof x === 'number');
        grad.def = si < 0 ? null : grads.get(aiStr(ops[si].s));
        if (w.length >= 10){ [grad.xo, grad.yo, grad.ang, grad.len] = w; grad.m = w.slice(4, 10); } else grad.def = null; } break;
      case 'Bm': if (grad && v.length >= 6) grad.bm = v.slice(-6); break;
      case 'BB': grad = null; break;
      case 'XW': {   // 新版文字物件（前面的 /AI11Text 字典给故事编号与框）
        const P = pendText || {}, o = {t:'text', name:P.name || '', hidden:st.hidden, story:P.story, boxSubs:P.boxSubs};
        cur().kids.push(o); lastObj = o; pendText = null; break;
      }
      default: break;
    }
    ops = [];
  }
  function onDict(d){
    if (d.type === 'AI11Text'){
      const cp = d.kv.ConfiningPath, P = {story:typeof d.kv.StoryIndex === 'number' ? d.kv.StoryIndex : null};
      if (cp && cp.art){ const s = goodSubs(cp.art.subs); if (s.length === 1){ const A = s[0].anchors, f = A[0], l = A[A.length - 1];
        if (A.length > 2 && Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6 && !l.in && !f.out) A.pop(); P.boxSubs = s; } }
      pendText = P; return;
    }
    if (d.type === 'ArtDictionary'){
      const u = d.kv.AI10_ArtUID, nm_ = u && u.ops && u.ops.find(x => x && x.s !== undefined);
      if (!nm_) return;
      const name = aiStr(nm_.s);
      if (pendText) pendText.name = name; else if (lastObj && lastObj.t !== 'layer') lastObj.name = name;
    }
  }
  if (stack.length !== 1 || dicts.length || opq) throw new Error('unbalanced private data');
  return root.kids;
}

/* 配对与重建：out＝PDF 外观读完的容器树；回传 model 或 null（退回只读 PDF 外观） */
function aiRebuild(txt, out, base, W, H, extra){
  const layers = aiLayerTree(txt), stories = aiStories(txt);
  if (!layers.length) return null;
  // PDF 外观 ⇒ 物件清单（形状一个一个、文字层、像素层）·记下最外层 PDF 图层名与藏否
  const items = [];
  const shapeBox = s => {
    if (!s) return null;
    if (s.type === 'bezier') return bboxOf([s]);
    const kids = (s.children || []).filter(Boolean); if (!kids.length) return null;
    if (s.type === 'group' && s.clip) return shapeBox(kids[0]);
    let B = null; for (const c of kids){ const b = shapeBox(c); if (!b) continue; if (!B) B = Object.assign({}, b); else { const x1 = Math.max(B.x + B.w, b.x + b.w), y1 = Math.max(B.y + B.h, b.y + b.h); B.x = Math.min(B.x, b.x); B.y = Math.min(B.y, b.y); B.w = x1 - B.x; B.h = y1 - B.y; } }
    return B;
  };
  const collect = (node, top, hid) => {
    for (const c of node.children){
      if (c.kind === 'group') collect(c, top === undefined ? c.name : top, hid || !!c.hidden);
      else if (c.kind === 'vector') c.shapes.forEach((s, i) => items.push({kind:'shape', shape:s, meta:(c.meta || [])[i] || {}, box:shapeBox(s), top, hid}));
      else items.push({kind:c.kind, node:c, top, hid, text:c.kind === 'text' ? String(c.data.text || '') : null});
    }
  };
  collect(out.root, undefined, false);
  // 图层树 ⇒ 叶子清单（画的顺序）
  const leaves = [];
  const walk = (list, top, hid) => list.forEach(o => {
    if (o.t === 'layer' || o.t === 'group'){ walk(o.kids, top === undefined ? o.name : top, hid || (o.t === 'layer' && !o.visible)); return; }
    o.top = top; o.eh = hid || !!o.hidden; o.pdf = []; o.pre = []; o.post = []; leaves.push(o);
  });
  walk(layers, undefined, false);
  const sq = s => String(s || '').replace(/\s+/g, '');
  const tryMatch = M => {
    items.forEach(it => { it.used = false; });
    leaves.forEach(o => { o.pdf = []; o.pre = []; o.post = []; o.cbox = null;
      if (o.t === 'path' && o.subs.length){ o.csubs = mapSubs(goodSubs(o.subs), M); o.cbox = bboxOf(o.csubs); }
      if (o.t === 'text' && o.boxSubs){ const b = bboxOf(mapSubs(o.boxSubs, M)), s = o.boxSubs[0].anchors;
        const rect = s.length === 4 && s.every(a => !a.in && !a.out) && s.every((a, i) => { const q = s[(i + 1) % 4]; return Math.abs(a.x - q.x) < 1e-3 || Math.abs(a.y - q.y) < 1e-3; });
        o.cbox = rect ? b : null; } });
    const near = (a, b) => a && b && [['x', 'x'], ['y', 'y'], ['w', 'w'], ['h', 'h']].every(([p]) => Math.abs(a[p] - b[p]) <= Math.max(0.75, 0.01 * Math.max(b.w, b.h)));
    let j = 0;
    for (let li = 0; li < leaves.length; li++){
      const o = leaves[li];
      if (o.t === 'path' && o.cbox){
        for (let m = j; m < items.length; m++){
          const it = items[m]; if (it.kind !== 'shape' || it.hid !== o.eh || !near(it.box, o.cbox)) continue;
          o.pdf.push(m); it.used = true; j = m + 1;
          // 同一个物件画成好几笔（填色、描边分开）：外框一样、又不是下一个物件的就并进来
          const nx = leaves[li + 1];
          while (j < items.length && items[j].kind === 'shape' && near(items[j].box, o.cbox) && !(nx && nx.cbox && near(items[j].box, nx.cbox))){ o.pdf.push(j); items[j].used = true; j++; }
          break;
        }
      } else if (o.t === 'text'){
        const S = o.story !== null && o.story !== undefined && stories[o.story] ? sq(stories[o.story].text) : null;
        for (let m = j; m < items.length; m++){
          const it = items[m]; if (it.kind !== 'text' || it.hid !== o.eh) continue;
          if (S !== null && !S.includes(sq(it.text))) continue;
          o.pdf.push(m); it.used = true; j = m + 1;
          let acc = sq(it.text);
          while (S !== null && j < items.length && items[j].kind === 'text' && acc.length < S.length && S.startsWith(acc + sq(items[j].text))){ acc += sq(items[j].text); o.pdf.push(j); items[j].used = true; j++; }
          break;
        }
      }
    }
    const want = leaves.filter(o => !o.eh && (o.t === 'text' || (o.t === 'path' && o.cbox))).length, got = leaves.filter(o => o.pdf.length).length;
    return {got, want};
  };
  let M = base, r = tryMatch(M);
  if (r.want && r.got * 2 < r.want){
    // 画板原点跟 PDF 页面对不上：拿大小一样的形状算位移、取最多的那个再配一次
    const votes = new Map();
    leaves.forEach(o => { if (o.t !== 'path' || o.eh || !o.cbox) return;
      items.forEach(it => { if (it.kind !== 'shape' || !it.box || Math.abs(it.box.w - o.cbox.w) > 0.75 || Math.abs(it.box.h - o.cbox.h) > 0.75) return;
        const key = Math.round((it.box.x - o.cbox.x) * 2) / 2 + ',' + Math.round((it.box.y - o.cbox.y) * 2) / 2; votes.set(key, (votes.get(key) || 0) + 1); }); });
    const best = [...votes].sort((x, y) => y[1] - x[1])[0];
    if (best){ const [dx, dy] = best[0].split(',').map(Number); M = cat(base, [1, 0, 0, 1, dx, dy]); r = tryMatch(M); }
  }
  if (!r.got || r.got * 2 < r.want) return null;
  // 配不上的 PDF 物件：落在前后已配上的物件之间；这段里有没配上的私有资料物件（认不得的、外框对不上的）就交给它——
  // 同一个最外层图层的优先、只往后挑；都没有 ⇒ 并进前一个（或后一个）已配上的物件旁边
  const matched = leaves.filter(o => o.pdf.length), at = new Map(leaves.map((o, i) => [o, i]));
  let cpos = 0;
  items.forEach((it, m) => {
    if (it.used) return;
    let k = 0; while (k < matched.length && matched[k].pdf[0] < m) k++;
    const prev = matched[k - 1], next = matched[k];
    const lo = Math.max(cpos, prev ? at.get(prev) + 1 : 0), hi = next ? at.get(next) : leaves.length;
    const fits = o => o.eh === it.hid && !matched.includes(o) && (o.t === 'other' || (o.t === 'text' ? it.kind === 'text' : it.kind === 'shape'));
    const cand = leaves.slice(lo, hi).filter(fits), same = cand.filter(o => o.top === it.top);
    const c = same[0] || (cand.length === 1 ? cand[0] : null);
    if (c){ c.pdf.push(m); cpos = at.get(c); }
    else if (prev && (it.top === prev.top || !next || it.top !== next.top)) prev.post.push(m);
    else next.pre.push(m);
  });
  // 重建容器树
  let skipped = 0;
  const pathShape = o => {
    if (o.bad || !o.csubs || !o.csubs.length) return null;
    const paint = f => {
      if (!f || !f.art) return f;
      const c = ap(M, f.o[0], f.o[1]), e = ap(M, f.e[0], f.e[1]);
      if (f.radial){
        const r0 = Math.hypot(e[0] - c[0], e[1] - c[1]), cx = Math.hypot(f.m[0], f.m[1]), cy = Math.hypot(f.m[2], f.m[3]);
        return {type:'radial', stops:f.stops, x1:r4(c[0]), y1:r4(c[1]), x2:r4(c[0] + r0), y2:r4(c[1]), r:r4(r0), aspect:r4(cx ? cy / cx : 1)};
      }
      return {type:'linear', stops:f.stops, x1:r4(c[0]), y1:r4(c[1]), x2:r4(e[0]), y2:r4(e[1])};
    };
    const s = mkShape(o.csubs, paint(o.fill), o.stroke, o.stroke === 'none' ? 0 : r4(o.sw * scaleOf(M)), o.rule);
    if (s && o.opacity < 0.999) s.opacity = r4(o.opacity);
    return s;
  };
  const build = (list, into, hidAnc) => {
    let vec = null;   // 目前可以接着放形状的无名矢量层
    const push = n => { into.push(n); vec = null; };
    // PDF 外观的物件放进来；藏起来的 PDF 图层里的照藏（PDF 的图层组不留，藏否记在叶子上·所在图层已经藏了就不再记）
    const hid = it => it.hid && !hidAnc;
    const putItems = (idx, name) => {
      const its = idx.map(m => items[m]);
      if (name && its.length && its.every(it => it.kind === 'shape' && it.hid === its[0].hid)){
        push(Object.assign({kind:'vector', name, shapes:its.map(it => it.shape), meta:its.map(it => it.meta)}, hid(its[0]) ? {hidden:true} : {})); return; }
      for (const it of its){
        if (it.kind === 'shape'){
          if (!vec || !!vec.hidden !== hid(it)){ vec = Object.assign({kind:'vector', shapes:[], meta:[]}, hid(it) ? {hidden:true} : {}); into.push(vec); }
          vec.shapes.push(it.shape); vec.meta.push(it.meta);
        } else { if (name && its.length === 1) it.node.name = name; if (hid(it)) it.node.hidden = true; push(it.node); }
      }
    };
    for (const o of list){
      if (o.t === 'layer' || o.t === 'group'){
        const g = {kind:'group', name:o.name || undefined, hidden:o.t === 'layer' && !o.visible, keepGroup:true, children:[]};
        build(o.kids, g.children, hidAnc || g.hidden); push(g); continue;
      }
      putItems(o.pre);
      if (o.pdf.length){
        if (o.t === 'text'){
          const nodes = o.pdf.map(m => items[m].node), d = nodes[0].data, st = o.story !== null && o.story !== undefined ? stories[o.story] : null;
          if (hid(items[o.pdf[0]])) nodes.forEach(x => { x.hidden = true; });
          if (o.cbox){   // 区域文字：一个文字层、带框与对齐
            if (nodes.length > 1) d.text = nodes.map(x => x.data.text).join('\n');
            d.box = [r4(o.cbox.x), r4(o.cbox.y), r4(o.cbox.w), r4(o.cbox.h)];
            if (st && st.align) d.align = st.align;
            if (o.name) nodes[0].name = o.name; push(nodes[0]);
          } else nodes.forEach(x => { if (o.name) x.name = o.name; push(x); });
        } else putItems(o.pdf, o.name);
      } else if (o.eh){
        const s = o.t === 'path' ? pathShape(o) : null;
        if (s) push({kind:'vector', name:o.name || undefined, hidden:!!o.hidden, shapes:[s], meta:[{blend:o.blend}]});
        else skipped++;
      }
      putItems(o.post);
    }
  };
  const kids = []; build(layers, kids, false);
  if (skipped) out.notes.add(L3('部分隱藏物件只存在 Illustrator 私有資料中、無法還原，已略過', '部分隐藏物件只存在 Illustrator 私有资料中、无法还原，已略过', 'some hidden objects exist only in Illustrator\'s private data and could not be rebuilt; they were skipped'));
  return finish({root:{kind:'group', children:kids, top:true}, notes:out.notes}, W, H, Object.assign({aiPrivate:true}, extra));
}

const isPdf = u8 => { const s = latin(u8, 0, Math.min(u8.length, 1024)); return s.indexOf('%PDF') >= 0 || /^%!PS-Adobe/.test(s); };
async function pdf(bytes, o){
  o = o || {};
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), D = new PdfDoc(u8);
  await D.load();
  const pages = await D.pages(); if (!pages.length) throw new Bad('this PDF has no pages');
  const pi = Math.min(Math.max(0, o.page | 0), pages.length - 1), P = pages[pi];
  const mb = (await D.r(P.MediaBox)) || [0, 0, 612, 792], cb = (await D.r(P.CropBox)) || mb;
  const nums_ = async a => { const out = []; for (const x of a) out.push(+(await D.r(x)) || 0); return out; };
  let [x0, y0, x1, y1] = await nums_(cb); const M2 = await nums_(mb);
  if (x0 > x1) [x0, x1] = [x1, x0]; if (y0 > y1) [y0, y1] = [y1, y0];
  x0 = Math.max(x0, Math.min(M2[0], M2[2])); y0 = Math.max(y0, Math.min(M2[1], M2[3])); x1 = Math.min(x1, Math.max(M2[0], M2[2])); y1 = Math.min(y1, Math.max(M2[1], M2[3]));
  const rot = ((((await D.r(P.Rotate)) | 0) % 360) + 360) % 360;
  let w = x1 - x0, h = y1 - y0; if (!(w > 0 && h > 0)) throw new Bad('this PDF page has no size');
  let base = rot === 90 ? [0, 1, 1, 0, -y0, -x0] : rot === 180 ? [-1, 0, 0, 1, x1, -y0] : rot === 270 ? [0, -1, -1, 0, y1, x1] : [1, 0, 0, -1, -x0, y1];
  if (rot === 90 || rot === 270) [w, h] = [h, w];
  const notes = [];
  const k = Math.min(1, 16000 / Math.max(w, h)); if (k < 1){ base = cat(base, [k, 0, 0, k, 0, 0]); notes.push('the page was larger than 16000 px and was scaled down'); }
  const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
  // 图层显示状态：/D 的 OFF（或 BaseState OFF 时不在 ON 里的）＝藏起来
  const hidden = new Set(), ocp = await D.r(D.rootObj.OCProperties);
  if (ocp){
    const dd = (await D.r(ocp.D)) || {}, all = ((await D.r(ocp.OCGs)) || []).filter(x => x instanceof Ref).map(x => x.n);
    const offs = ((await D.r(dd.OFF)) || []).filter(x => x instanceof Ref).map(x => x.n), ons = ((await D.r(dd.ON)) || []).filter(x => x instanceof Ref).map(x => x.n);
    if (nm(await D.r(dd.BaseState)) === 'OFF') all.forEach(i => { if (!ons.includes(i)) hidden.add(i); });
    offs.forEach(i => hidden.add(i));
  }
  const out = new Out(W, H), it = new Interp(D, out, base, W, H, hidden);
  notes.forEach(x => out.notes.add(x));
  let cont = await D.r(P.Contents); cont = Array.isArray(cont) ? cont : cont ? [cont] : [];
  const parts = []; for (const c of cont){ const s = await D.r(c); if (s instanceof Stream){ try { parts.push(await D.decode(s)); } catch (e){ if (e instanceof Bad) throw e; } } }
  const len = parts.reduce((s, p) => s + p.length + 1, 0), data = new Uint8Array(len); let q = 0; for (const p of parts){ data.set(p, q); q += p.length; data[q++] = 10; }
  await it.run(data, await D.r(P.Resources), 0);
  if (it.runs) it.flushText();
  if (pages.length > 1) out.notes.add(`this file has ${pages.length} pages / artboards: page ${pi + 1} was opened`);
  // Illustrator 的子图层（含隐藏的）、物件名、区域文字框只写在页面 /PieceInfo /Illustrator 的私有资料里，PDF 相容内容里只有顶层图层 ⇒
  // 解得开就照私有资料重建图层树（aiRebuild），解不开或配不上就照旧只用 PDF 外观、提一句已略过；
  // 本程式写的 .ai（/Info /Producer 是 ps-file.js 写的那个）组照样写成嵌套的 PDF 图层，私有资料里没有多出来的，不用读
  const pinfo = (await D.r(P.PieceInfo)) || (await D.r(D.rootObj.PieceInfo));
  const info = D.trailer && (await D.r(D.trailer.Info)), own = !!info && typeof info === 'object' && textStr(await D.r(info.Producer)) === 'Dilin Studio · drawboard';
  if (pinfo && typeof pinfo === 'object' && pinfo.Illustrator !== undefined && !own){
    if (!rot && !o.noPrivate){
      let m = null;
      try { const txt = await aiPrivText(D, pinfo); m = txt ? aiRebuild(txt, out, base, W, H, {pages:pages.length}) : null; } catch (_){ m = null; }
      if (m) return m;
    }
    out.notes.add(L3('子圖層與隱藏子圖層只存在 Illustrator 私有資料中，已略過', '子图层与隐藏子图层只存在 Illustrator 私有资料中，已略过', 'sublayers and hidden sublayers exist only in Illustrator\'s private data and were skipped'));
  }
  return finish(out, W, H, {pages:pages.length});
}

/* ═══════════════════════════════ SVG ═══════════════════════════════ */
const UNITS = {px:1, pt:96 / 72, pc:16, mm:96 / 25.4, cm:96 / 2.54, in:96, em:16, ex:8, '':1};
const len = (s, ref, dflt) => {
  if (s === null || s === undefined || s === '') return dflt;
  const m = String(s).trim().match(/^([-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?)\s*(%|[a-z]*)$/i); if (!m) return dflt;
  const v = +m[1], u = m[2].toLowerCase(); if (u === '%') return ref === undefined ? dflt : v * ref / 100; return v * (UNITS[u] || 1);
};
const numList = s => (String(s || '').match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) || []).map(Number);
function parseTransform(s){
  let m = I; const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g; let x;
  while ((x = re.exec(s || ''))){
    const a = numList(x[2]); let t = I;
    if (x[1] === 'matrix' && a.length >= 6) t = a.slice(0, 6);
    else if (x[1] === 'translate') t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (x[1] === 'scale') t = [a[0] === undefined ? 1 : a[0], 0, 0, a[1] === undefined ? (a[0] === undefined ? 1 : a[0]) : a[1], 0, 0];
    else if (x[1] === 'rotate'){ const r = (a[0] || 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r); t = [c, sn, -sn, c, 0, 0]; if (a.length >= 3) t = cat(cat([1, 0, 0, 1, -a[1], -a[2]], t), [1, 0, 0, 1, a[1], a[2]]); }
    else if (x[1] === 'skewX') t = [1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0];
    else if (x[1] === 'skewY') t = [1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
    m = cat(t, m);
  }
  return m;
}
function arcTo(P, x1, y1, rx, ry, phi, large, sweep, x2, y2){
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)){ P.line(x2, y2); return; }
  rx = Math.abs(rx); ry = Math.abs(ry); const f = phi * Math.PI / 180, cf = Math.cos(f), sf = Math.sin(f);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, xp = cf * dx + sf * dy, yp = -sf * dx + cf * dy;
  let lam = xp * xp / (rx * rx) + yp * yp / (ry * ry); if (lam > 1){ const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp, den = rx * rx * yp * yp + ry * ry * xp * xp;
  let co = Math.sqrt(Math.max(0, num / den)); if (large === sweep) co = -co;
  const cxp = co * rx * yp / ry, cyp = -co * ry * xp / rx, cx = cf * cxp - sf * cyp + (x1 + x2) / 2, cy = sf * cxp + cf * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  let t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry), dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2))), d = dt / segs, k = 4 / 3 * Math.tan(d / 4);
  const pt = t => { const x = rx * Math.cos(t), y = ry * Math.sin(t); return [cf * x - sf * y + cx, sf * x + cf * y + cy]; };
  const dv = t => { const x = -rx * Math.sin(t), y = ry * Math.cos(t); return [cf * x - sf * y, sf * x + cf * y]; };
  for (let i = 0; i < segs; i++){
    const a = t1 + i * d, b = a + d, p0 = pt(a), p3 = i === segs - 1 ? [x2, y2] : pt(b), d0 = dv(a), d1 = dv(b);
    P.curve(p0[0] + k * d0[0], p0[1] + k * d0[1], p3[0] - k * d1[0], p3[1] - k * d1[1], p3[0], p3[1]);
  }
}
function pathSubs(d){
  const P = new PathB(), s = String(d || ''), n = s.length; let i = 0;
  const skip = () => { while (i < n && (s[i] === ' ' || s[i] === ',' || s[i] === '\n' || s[i] === '\r' || s[i] === '\t' || s[i] === '\f')) i++; };
  const NR = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/y;
  const num = () => { skip(); NR.lastIndex = i; const m = NR.exec(s); if (!m) return null; i = NR.lastIndex; return +m[0]; };
  const flag = () => { skip(); const c = s[i]; if (c === '0' || c === '1'){ i++; return c === '1'; } return null; };
  let cmd = null, cx = 0, cy = 0, sx = 0, sy = 0, qx = null, qy = null, kx = null, ky = null;
  for (;;){
    skip(); if (i >= n) break;
    const ch = s[i];
    if (/[a-zA-Z]/.test(ch)){ cmd = ch; i++; if (ch === 'z' || ch === 'Z'){ P.close(); cx = sx; cy = sy; kx = qx = null; continue; } }
    else if (cmd === null || cmd === 'z' || cmd === 'Z') break;
    const rel = cmd >= 'a', C = cmd.toUpperCase(), bx = rel ? cx : 0, by = rel ? cy : 0;
    if (C === 'M'){ const x = num(), y = num(); if (y === null) break; cx = bx + x; cy = by + y; P.move(cx, cy); sx = cx; sy = cy; cmd = rel ? 'l' : 'L'; kx = qx = null; }
    else if (C === 'L'){ const x = num(), y = num(); if (y === null) break; cx = bx + x; cy = by + y; P.line(cx, cy); kx = qx = null; }
    else if (C === 'H'){ const x = num(); if (x === null) break; cx = bx + x; P.line(cx, cy); kx = qx = null; }
    else if (C === 'V'){ const y = num(); if (y === null) break; cy = (rel ? cy : 0) + y; P.line(cx, cy); kx = qx = null; }
    else if (C === 'C'){ const a = [num(), num(), num(), num(), num(), num()]; if (a[5] === null) break; P.curve(bx + a[0], by + a[1], bx + a[2], by + a[3], bx + a[4], by + a[5]); kx = bx + a[2]; ky = by + a[3]; cx = bx + a[4]; cy = by + a[5]; qx = null; }
    else if (C === 'S'){ const a = [num(), num(), num(), num()]; if (a[3] === null) break; const x1 = kx === null ? cx : 2 * cx - kx, y1 = kx === null ? cy : 2 * cy - ky;
      P.curve(x1, y1, bx + a[0], by + a[1], bx + a[2], by + a[3]); kx = bx + a[0]; ky = by + a[1]; cx = bx + a[2]; cy = by + a[3]; qx = null; }
    else if (C === 'Q' || C === 'T'){
      let x, y, q1, q2;
      if (C === 'Q'){ const a = [num(), num(), num(), num()]; if (a[3] === null) break; q1 = bx + a[0]; q2 = by + a[1]; x = bx + a[2]; y = by + a[3]; }
      else { const a = [num(), num()]; if (a[1] === null) break; q1 = qx === null ? cx : 2 * cx - qx; q2 = qx === null ? cy : 2 * cy - qy; x = bx + a[0]; y = by + a[1]; }
      P.curve(cx + 2 / 3 * (q1 - cx), cy + 2 / 3 * (q2 - cy), x + 2 / 3 * (q1 - x), y + 2 / 3 * (q2 - y), x, y); qx = q1; qy = q2; cx = x; cy = y; kx = null;
    }
    else if (C === 'A'){ const rx = num(), ry = num(), ph = num(), la = flag(), sw = flag(), x = num(), y = num(); if (y === null || la === null || sw === null) break;
      if (!P.cur) P._ensure(cx, cy); arcTo(P, cx, cy, rx, ry, ph, la, sw, bx + x, by + y); cx = bx + x; cy = by + y; kx = qx = null; }
    else break;
  }
  return P.subs;
}
function ellipseSubs(cx, cy, rx, ry){
  const k = 0.5522847498, P = new PathB();
  P.move(cx + rx, cy); P.curve(cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry); P.curve(cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy);
  P.curve(cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry); P.curve(cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy); P.close(); return P.subs;
}
function rectSubs(x, y, w, h, rx, ry){
  const P = new PathB();
  if (!(rx > 0 || ry > 0)){ P.rect(x, y, w, h); return P.subs; }
  rx = Math.min(rx > 0 ? rx : ry, w / 2); ry = Math.min(ry > 0 ? ry : rx, h / 2); const k = 0.5522847498;
  P.move(x + rx, y); P.line(x + w - rx, y); P.curve(x + w - rx + k * rx, y, x + w, y + ry - k * ry, x + w, y + ry); P.line(x + w, y + h - ry);
  P.curve(x + w, y + h - ry + k * ry, x + w - rx + k * rx, y + h, x + w - rx, y + h); P.line(x + rx, y + h); P.curve(x + rx - k * rx, y + h, x, y + h - ry + k * ry, x, y + h - ry);
  P.line(x, y + ry); P.curve(x, y + ry - k * ry, x + rx - k * rx, y, x + rx, y); P.close(); return P.subs;
}
const INH = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'visibility', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'letter-spacing', 'color'];
const NOINH = ['opacity', 'display', 'clip-path', 'mask', 'filter', 'mix-blend-mode', 'stop-color', 'stop-opacity', 'marker-start', 'marker-mid', 'marker-end'];
const PROPS = INH.concat(NOINH);
const SKIP = new Set(['defs', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'symbol', 'marker', 'style', 'title', 'desc', 'metadata', 'filter', 'script', 'namedview', 'font', 'font-face', 'cursor', 'view']);
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
function parseDecl(s){ const o = {}; String(s || '').split(';').forEach(p => { const i = p.indexOf(':'); if (i > 0){ const k = p.slice(0, i).trim().toLowerCase(); let v = p.slice(i + 1).trim().replace(/\s*!important$/i, ''); if (k) o[k] = v; } }); return o; }
function parseCSS(text){
  const rules = []; let order = 0; text = String(text || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!\[CDATA\[|\]\]>/g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(text))){
    if (/^\s*@/.test(m[1])) continue;
    const decl = parseDecl(m[2]);
    for (const raw of m[1].split(',')){
      const sel = raw.trim(); if (!sel || /[>+~:[\]]/.test(sel)) continue;
      const parts = sel.split(/\s+/).map(p => { const t = /^([a-zA-Z*][\w-]*)?((?:[.#][\w-]+)*)$/.exec(p); if (!t) return null; const ids = [], cls = []; (t[2].match(/[.#][\w-]+/g) || []).forEach(x => (x[0] === '#' ? ids : cls).push(x.slice(1))); return {tag:t[1] && t[1] !== '*' ? t[1] : null, ids, cls}; });
      if (parts.some(p => !p)) continue;
      const spec = parts.reduce((s, p) => s + p.ids.length * 100 + p.cls.length * 10 + (p.tag ? 1 : 0), 0);
      rules.push({parts, decl, spec, order:order++});
    }
  }
  return rules;
}
const matchPart = (el, p) => (!p.tag || el.localName === p.tag) && p.ids.every(i => el.getAttribute('id') === i) && p.cls.every(c => (' ' + (el.getAttribute('class') || '') + ' ').replace(/\s+/g, ' ').indexOf(' ' + c + ' ') >= 0);
function matchRule(el, r){
  const ps = r.parts; if (!matchPart(el, ps[ps.length - 1])) return false;
  let k = ps.length - 2, a = el.parentElement; while (k >= 0 && a){ if (matchPart(a, ps[k])) k--; a = a.parentElement; } return k < 0;
}
async function svg(text){
  const doc = new DOMParser().parseFromString(String(text || ''), 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Bad('not a valid SVG file');
  const root = doc.documentElement; if (!root || root.localName !== 'svg') throw new Bad('not a valid SVG file');
  const vb = numList(root.getAttribute('viewBox')); const hasVB = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
  let W = len(root.getAttribute('width'), hasVB ? vb[2] : 300, hasVB ? vb[2] : 300), H = len(root.getAttribute('height'), hasVB ? vb[3] : 150, hasVB ? vb[3] : 150);
  if (/%/.test(root.getAttribute('width') || '')) W = hasVB ? vb[2] : 300; if (/%/.test(root.getAttribute('height') || '')) H = hasVB ? vb[3] : 150;
  const notes = [];
  const k = Math.min(1, 16000 / Math.max(W, H)); W = Math.max(1, Math.round(W * k)); H = Math.max(1, Math.round(H * k));
  if (k < 1) notes.push('the drawing was larger than 16000 px and was scaled down');
  const viewport = (vbx, w, h, par) => {
    if (!vbx) return I; const p = String(par || 'xMidYMid meet').trim().split(/\s+/);
    if (p[0] === 'none') return [w / vbx[2], 0, 0, h / vbx[3], -vbx[0] * w / vbx[2], -vbx[1] * h / vbx[3]];
    const sx = w / vbx[2], sy = h / vbx[3], s = p[1] === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy), al = p[0] || 'xMidYMid';
    const fx = /xMid/.test(al) ? 0.5 : /xMax/.test(al) ? 1 : 0, fy = /YMid/.test(al) ? 0.5 : /YMax/.test(al) ? 1 : 0;
    return [s, 0, 0, s, (w - vbx[2] * s) * fx - vbx[0] * s, (h - vbx[3] * s) * fy - vbx[1] * s];
  };
  const M0 = viewport(hasVB ? vb : null, W, H, root.getAttribute('preserveAspectRatio'));
  const rules = []; for (const st of doc.getElementsByTagName('style')) rules.push(...parseCSS(st.textContent));
  rules.sort((a, b) => a.spec - b.spec || a.order - b.order);
  const out = new Out(W, H); notes.forEach(x => out.notes.add(x));
  const aiDoc = /Adobe Illustrator/.test(String(text).slice(0, 2048));   // Illustrator 汇出：子图层／具名组只写 id
  /* 内嵌 SVG 字型（<font>，Illustrator 可把整套字形写进档）：不画（SKIP），只在文字要量宽时照 horiz-adv-x／units-per-em 取字宽；用到才建表 */
  const fontEls = doc.getElementsByTagName('font'); let embFonts = null;
  if (fontEls.length) out.notes.add(L3('內嵌的 SVG 字型沒有匯入（文字改用本機字型）', '内嵌的 SVG 字体没有导入（文字改用本机字体）', 'embedded SVG fonts were not imported (text uses installed fonts)'));
  const famKey = f => String(f || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
  const embOf = fam => {
    if (!fontEls.length) return null;
    if (!embFonts){
      embFonts = new Map();
      for (const f of fontEls){
        const ff = f.getElementsByTagName('font-face')[0], nm2 = ff && famKey(ff.getAttribute('font-family')); if (!nm2 || embFonts.has(nm2)) continue;
        const upm = +ff.getAttribute('units-per-em') || 1000, dflt = +f.getAttribute('horiz-adv-x') || upm, adv = new Map();
        for (const gl of f.getElementsByTagName('glyph')){ const u = gl.getAttribute('unicode'); if (u && u.length <= 2 && [...u].length === 1 && !adv.has(u)) adv.set(u, +(gl.getAttribute('horiz-adv-x') || dflt)); }
        const mg = f.getElementsByTagName('missing-glyph')[0];
        embFonts.set(nm2, {upm, adv, miss:mg ? +(mg.getAttribute('horiz-adv-x') || dflt) : dflt});
      }
    }
    return embFonts.get(famKey(fam)) || null;
  };
  const cx = mkCanvas(1, 1).getContext('2d');
  const color = (v, st) => { if (!v || v === 'none' || v === 'transparent') return null; if (v === 'currentColor') v = st.color || '#000';
    cx.fillStyle = '#000'; cx.fillStyle = v; const s = cx.fillStyle; if (s[0] === '#') return {rgb:hexRGB(s), a:1}; const m = s.match(/[\d.]+/g) || [0, 0, 0, 1]; return {rgb:[m[0] / 255, m[1] / 255, m[2] / 255], a:m[3] === undefined ? 1 : +m[3]}; };
  const styleOf = (el, parent) => {
    const st = {}; if (parent) for (const k2 of INH) if (parent[k2] !== undefined) st[k2] = parent[k2];
    const set = (k2, v) => { v = String(v).trim(); if (v === 'inherit'){ if (parent && parent[k2] !== undefined) st[k2] = parent[k2]; else delete st[k2]; } else st[k2] = v; };
    for (const k2 of PROPS){ const v = el.getAttribute(k2); if (v !== null && v !== '') set(k2, v); }
    for (const r of rules) if (matchRule(el, r)) for (const k2 in r.decl) if (PROPS.includes(k2)) set(k2, r.decl[k2]);
    const inl = parseDecl(el.getAttribute('style')); for (const k2 in inl) if (PROPS.includes(k2)) set(k2, inl[k2]);
    return st;
  };
  const byId = id => (id ? doc.getElementById(id) || doc.querySelector(`[id="${CSS.escape(id)}"]`) : null);
  const urlId = v => { const m = /url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(v || ''); return m ? m[1] : null; };
  const hrefOf = el => el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || el.getAttribute('xlink:href');
  const gattr = (g, name) => { let e = g, k2 = 0; while (e && k2++ < 16){ const v = e.getAttribute(name); if (v !== null) return v; const h = hrefOf(e); e = h && h[0] === '#' ? byId(h.slice(1)) : null; } return null; };
  const gstops = g => { let e = g, k2 = 0; while (e && k2++ < 16){ const s = [...e.children].filter(c => c.localName === 'stop'); if (s.length) return s; const h = hrefOf(e); e = h && h[0] === '#' ? byId(h.slice(1)) : null; } return []; };
  const gradOf = (id, bbox, M, opac) => {
    const g = byId(id); if (!g || (g.localName !== 'linearGradient' && g.localName !== 'radialGradient')) return undefined;
    const obb = (gattr(g, 'gradientUnits') || 'objectBoundingBox') !== 'userSpaceOnUse';
    if (obb && (!bbox || !(bbox.w > 0) || !(bbox.h > 0))) return null;
    const B = obb ? [bbox.w, 0, 0, bbox.h, bbox.x, bbox.y] : I, T = cat(cat(parseTransform(gattr(g, 'gradientTransform')), B), M);
    const L = (v, d, ref) => { if (v === null) return d; if (/%$/.test(v.trim())) return parseFloat(v) / 100 * (obb ? 1 : ref); return obb ? +parseFloat(v) : len(v, ref, d); };
    let last = 0; const stops = gstops(g).map(s => { const ss = styleOf(s, null), c = color(ss['stop-color'] || 'black', ss) || {rgb:[0, 0, 0], a:0};
      let off = s.getAttribute('offset') || '0'; off = /%$/.test(off.trim()) ? parseFloat(off) / 100 : +parseFloat(off) || 0; off = Math.max(last, c01(off)); last = off;
      const a = c.a * (ss['stop-opacity'] !== undefined ? +ss['stop-opacity'] : 1) * opac; return {offset:off, c:c.rgb.concat([a])}; });
    if (!stops.length) return null;
    if (g.localName === 'linearGradient'){
      const p0 = ap(T, L(gattr(g, 'x1'), 0, W), L(gattr(g, 'y1'), 0, H)), p1 = ap(T, L(gattr(g, 'x2'), obb ? 1 : W, W), L(gattr(g, 'y2'), 0, H));
      return {type:'linear', stops:stopsOut(stops), x1:r4(p0[0]), y1:r4(p0[1]), x2:r4(p1[0]), y2:r4(p1[1])};
    }
    const gcx = L(gattr(g, 'cx'), obb ? 0.5 : W / 2, W), gcy = L(gattr(g, 'cy'), obb ? 0.5 : H / 2, H), gr = L(gattr(g, 'r'), obb ? 0.5 : Math.hypot(W, H) / 2 / Math.SQRT2, Math.hypot(W, H) / Math.SQRT2);
    const c = ap(T, gcx, gcy), ex = ap(T, gcx + gr, gcy), ey = ap(T, gcx, gcy + gr), r = Math.hypot(ex[0] - c[0], ex[1] - c[1]), ry = Math.hypot(ey[0] - c[0], ey[1] - c[1]);
    return {type:'radial', stops:stopsOut(stops), x1:r4(c[0]), y1:r4(c[1]), x2:r4(ex[0]), y2:r4(ex[1]), r:r4(r), aspect:r ? r4(ry / r) : 1};
  };
  /* 画板接不起来的东西：交给浏览器只画这一个元素（其余都藏起来）⇒ 像素层 */
  const GRAPHIC = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image', 'use', 'a', 'switch', 'foreignObject', 'svg']);
  const rasterOf = async (el, ctxOut) => {
    const undo = []; const setStyle = (e, s) => { undo.push([e, e.getAttribute('style')]); e.setAttribute('style', (e.getAttribute('style') || '') + ';' + s); };
    let nd = el; while (nd && nd !== root){ for (const sib of nd.parentNode.children) if (sib !== nd && GRAPHIC.has(sib.localName)) setStyle(sib, 'display:none'); setStyle(nd, 'display:inline'); nd = nd.parentNode; }
    const rw = root.getAttribute('width'), rh = root.getAttribute('height'); root.setAttribute('width', W); root.setAttribute('height', H);
    let xml; try { xml = new XMLSerializer().serializeToString(root); } finally { for (const [e, s] of undo.reverse()){ if (s === null) e.removeAttribute('style'); else e.setAttribute('style', s); } if (rw === null) root.removeAttribute('width'); else root.setAttribute('width', rw); if (rh === null) root.removeAttribute('height'); else root.setAttribute('height', rh); }
    const url = URL.createObjectURL(new Blob([xml], {type:'image/svg+xml'}));
    try { const img = new Image(); await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; }); ctxOut.drawImage(img, 0, 0, W, H); return true; }
    catch (_){ out.notes.add('a part of the drawing could not be rendered'); return false; } finally { URL.revokeObjectURL(url); }
  };
  const needsRaster = (el, st) => (st.filter && st.filter !== 'none') || (st.mask && st.mask !== 'none') || el.localName === 'foreignObject'
    || ['fill', 'stroke'].some(p => { const id = urlId(st[p]); const t = id && byId(id); return t && t.localName === 'pattern'; })
    || ['marker-start', 'marker-mid', 'marker-end'].some(p => st[p] && st[p] !== 'none');
  const clipOf = (el, st, M) => {   // 简单的剪切路径 ⇒ 剪切组的第一个形状；接不起来回 false
    const id = urlId(st['clip-path']); if (!id) return null; const cp = byId(id); if (!cp || cp.localName !== 'clipPath') return null;
    if ((cp.getAttribute('clipPathUnits') || 'userSpaceOnUse') !== 'userSpaceOnUse') return false;
    const CM = cat(parseTransform(cp.getAttribute('transform')), M); const all = []; let rule = 'nonzero';
    for (const c of cp.children){ if (c.localName === 'use'){ const t = byId((hrefOf(c) || '').slice(1)); if (!t || !SHAPES.has(t.localName)) return false;
        all.push(...mapSubs(subsOf(t), cat(cat(parseTransform(t.getAttribute('transform')), [1, 0, 0, 1, len(c.getAttribute('x'), W, 0), len(c.getAttribute('y'), H, 0)]), cat(parseTransform(c.getAttribute('transform')), CM)))); continue; }
      if (!SHAPES.has(c.localName)) { if (c.localName === 'title' || c.localName === 'desc') continue; return false; }
      const cs = styleOf(c, styleOf(cp, null)); if (cs['clip-rule'] === 'evenodd') rule = 'evenodd';
      all.push(...mapSubs(subsOf(c), cat(parseTransform(c.getAttribute('transform')), CM))); }
    if (!goodSubs(all).length) return false;
    const c = {subs:all, rule}; c.shape = () => mkShape(all.map(s => ({closed:true, anchors:s.anchors})), 'none', 'none', 0, rule); return c;
  };
  const subsOf = el => {
    const A = n2 => len(el.getAttribute(n2), n2 === 'x' || n2 === 'width' || n2 === 'cx' || n2 === 'rx' || n2 === 'x1' || n2 === 'x2' ? W : H, 0);
    switch (el.localName){
      case 'path': return pathSubs(el.getAttribute('d'));
      case 'rect': { const w = A('width'), h = A('height'); if (!(w > 0 && h > 0)) return []; return rectSubs(A('x'), A('y'), w, h, len(el.getAttribute('rx'), W, 0), len(el.getAttribute('ry'), H, 0)); }
      case 'circle': { const r = len(el.getAttribute('r'), Math.hypot(W, H) / Math.SQRT2, 0); return r > 0 ? ellipseSubs(A('cx'), A('cy'), r, r) : []; }
      case 'ellipse': { const rx = A('rx'), ry = A('ry'); return rx > 0 && ry > 0 ? ellipseSubs(A('cx'), A('cy'), rx, ry) : []; }
      case 'line': { const P = new PathB(); P.move(A('x1'), A('y1')); P.line(A('x2'), A('y2')); return P.subs; }
      case 'polyline': case 'polygon': { const v = numList(el.getAttribute('points')), P = new PathB(); for (let i = 0; i + 1 < v.length; i += 2){ if (!i) P.move(v[0], v[1]); else P.line(v[i], v[i + 1]); } if (el.localName === 'polygon') P.close(); return P.subs; }
    }
    return [];
  };
  const shapeOf = (el, st, M, op) => {
    const local = subsOf(el); if (!goodSubs(local).length) return null;
    const bbox = bboxOf(local), s = scaleOf(M) || 1, subs = mapSubs(local, M);
    const paint = (prop, opProp) => {
      const v = st[prop] === undefined ? (prop === 'fill' ? 'black' : 'none') : st[prop];
      const id = urlId(v), po = st[opProp] === undefined ? 1 : c01(+st[opProp]);
      if (id){ const g = gradOf(id, bbox, M, po); if (g !== undefined) return g || 'none'; const fb = /\)\s*(.+)$/.exec(v); return fb ? paint2(fb[1], po) : 'none'; }
      return paint2(v, po);
    };
    const paint2 = (v, po) => { const c = color(v, st); if (!c) return 'none'; return cssRGBA(c.rgb, c.a * po); };
    const F = paint('fill', 'fill-opacity'), S = paint('stroke', 'stroke-opacity'), sw = S !== 'none' ? r4(len(st['stroke-width'], 100, 1) * s) : 0;
    if (F === 'none' && S === 'none') return null;
    const sh = mkShape(subs, F, S, sw, st['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero'); if (!sh) return null;
    const o = op * (st.opacity === undefined ? 1 : c01(+st.opacity)); if (o < 0.999) sh.opacity = r4(o);
    return sh;
  };
  const nameOf = el => {
    const dn = el.getAttribute('data-name') || el.getAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'label') || el.getAttribute('inkscape:label') || el.getAttributeNS('http://www.serif.com/', 'id');
    if (dn) return dn;
    let id = el.getAttribute('id'); if (!id || /^(L|S|svg_?|path|g|rect|ab_)\d+$/i.test(id)) return null;
    if (aiDoc) id = id.replace(/(.)_\d+_$/, '$1');   // Illustrator 同名时加的 _1_、_2_ 去掉
    return id.replace(/_x([0-9A-Fa-f]{2,4})_|_/g, (m, h) => (h ? String.fromCharCode(parseInt(h, 16)) : ' ')).trim() || null;   // Illustrator：空白写成 _、真的 _ 写成 _x5F_
  };
  const isLayerG = (el, depth) => el.localName === 'g' && (depth === 0 || el.getAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'groupmode') === 'layer' || el.getAttribute('inkscape:groupmode') === 'layer'
    || /^(group|artboard)$/.test(el.getAttribute('data-kind') || '') || el.hasAttribute('data-name'));
  // 图层底下的子图层：Illustrator 的子图层／具名组（只有 id）、藏起来的组（display:none——不当图层就会被子孙的 display:inline 画出来）⇒ 照组留下
  const isSubLayerG = (el, cs, depth) => el.localName === 'g' && depth > 0 && (cs.display === 'none' || (aiDoc && !!nameOf(el)));
  // Illustrator 区域文字：<text> 前紧邻一个没填色没描边的 <rect>＝文字框（没旋转时才认）⇒ [x, y, w, h] 文件坐标
  const boxOf = (el, st, M, TM) => {
    const r = el.previousElementSibling; if (!r || r.localName !== 'rect' || !(TM[0] > 0 && TM[3] > 0 && sameNum(TM[1], 0) && sameNum(TM[2], 0))) return null;
    const rs = styleOf(r, st); if (rs.fill !== 'none' || (rs.stroke && rs.stroke !== 'none') || rs.display === 'none') return null;
    const RM = cat(parseTransform(r.getAttribute('transform')), M); if (!sameNum(RM[1], 0) || !sameNum(RM[2], 0)) return null;
    const x = len(r.getAttribute('x'), W, 0), y = len(r.getAttribute('y'), H, 0), w = len(r.getAttribute('width'), W, 0), h = len(r.getAttribute('height'), H, 0); if (!(w > 0 && h > 0)) return null;
    const p = ap(RM, x, y), q = ap(RM, x + w, y + h);
    return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])];
  };
  const onlyShapes = el => { for (const c of el.children){ const t = c.localName; if (SKIP.has(t)) continue; if (SHAPES.has(t)) { const st = styleOf(c, null); if (needsRaster(c, st) || st['clip-path']) return false; continue; } if (t === 'g' || t === 'a'){ if (!onlyShapes(c)) return false; continue; } return false; } return true; };
  const blendOf = v => { if (!v || v === 'normal') return undefined; return v.replace(/-([a-z])/g, (m, c) => c.toUpperCase()); };
  const textOf = (el, st, M, op) => {
    const runs = []; const lsp = len(st['letter-spacing'], 16, 0) || 0;
    let px = len((el.getAttribute('x') || '').split(/[\s,]+/)[0], W, 0), py = len((el.getAttribute('y') || '').split(/[\s,]+/)[0], H, 0), first = true;
    const pre = el.getAttribute('xml:space') === 'preserve' || el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'space') === 'preserve';
    const walkT = (node, s2) => {
      for (const c of node.childNodes){
        if (c.nodeType === 3){
          let t = c.nodeValue; if (!pre){ t = t.replace(/[\r\n\t]/g, pre ? ' ' : '').replace(/ +/g, ' '); if (first) t = t.replace(/^ /, ''); }
          if (!t) continue;
          const size = len(s2['font-size'], 16, 16), fam = s2['font-family'] || 'sans-serif', wt = s2['font-weight'] || 'normal';
          const ef = embOf(fam); let w = lsp * t.length;
          if (ef) for (const ch of t) w += (ef.adv.has(ch) ? ef.adv.get(ch) : ef.miss) * size / ef.upm;   // 内嵌字型的字宽（跟 Illustrator 排的一样）
          else { cx.font = `${s2['font-style'] === 'italic' ? 'italic ' : ''}${wt} ${size}px ${fam}`; w += cx.measureText(t).width; }
          const anchor = s2['text-anchor'] === 'middle' ? 0.5 : s2['text-anchor'] === 'end' ? 1 : 0, sx = px - w * anchor;
          const o = ap(M, sx, py), e = ap(M, sx + w, py), sc = scaleOf(M) || 1;
          const fc = color(s2.fill === undefined ? 'black' : s2.fill, s2) || {rgb:[0, 0, 0], a:0}, fo = s2['fill-opacity'] === undefined ? 1 : c01(+s2['fill-opacity']);
          runs.push({str:t, o, e, size:size * sc, X:[M[0] / sc, M[1] / sc, M[2] / sc, M[3] / sc], color:hex(fc.rgb), alpha:fc.a * fo * op * (st.opacity === undefined ? 1 : c01(+st.opacity)),
            anchor:anchor === 0.5 ? 'center' : anchor === 1 ? 'right' : 'left', font:fam, embedded:!!ef, weight:wt, italic:s2['font-style'] === 'italic', key:fam + '|' + wt + '|' + hex(fc.rgb)});
          px = sx + w; first = false;
        } else if (c.nodeType === 1 && (c.localName === 'tspan' || c.localName === 'a')){
          const s3 = styleOf(c, s2), xs = (c.getAttribute('x') || '').trim(), ys = (c.getAttribute('y') || '').trim();
          if (xs) px = len(xs.split(/[\s,]+/)[0], W, px); if (ys) py = len(ys.split(/[\s,]+/)[0], H, py);
          px += len((c.getAttribute('dx') || '').split(/[\s,]+/)[0], W, 0) || 0; py += len((c.getAttribute('dy') || '').split(/[\s,]+/)[0], H, 0) || 0;
          if (/[\s,]/.test(xs)) out.notes.add('per-letter positions in SVG text were merged');
          walkT(c, s3);
        } else if (c.nodeType === 1 && c.localName === 'textPath') out.notes.add('text on a path was imported as straight text');
      }
    };
    px += len((el.getAttribute('dx') || '').split(/[\s,]+/)[0], W, 0) || 0; py += len((el.getAttribute('dy') || '').split(/[\s,]+/)[0], H, 0) || 0;
    walkT(el, st);
    return runs;
  };
  const imageOf = async (el, st, M, op, fresh, name) => {
    const href = hrefOf(el); if (!href){ return; }
    const x = len(el.getAttribute('x'), W, 0), y = len(el.getAttribute('y'), H, 0); let w = len(el.getAttribute('width'), W, 0), h = len(el.getAttribute('height'), H, 0);
    const img = new Image();
    try { await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = href; }); } catch (_){ out.notes.add(/^data:/.test(href) ? 'an embedded image could not be decoded' : 'linked (not embedded) images were skipped'); return; }
    const iw = img.naturalWidth || img.width || 1, ih = img.naturalHeight || img.height || 1; if (!w) w = iw; if (!h) h = ih;
    const V = viewport([0, 0, iw, ih], w, h, el.getAttribute('preserveAspectRatio')), T = cat(cat(V, [1, 0, 0, 1, x, y]), M);
    const r = out.raster(fresh, name), ctx = r.ctx; ctx.save(); ctx.globalAlpha = c01(op * (st.opacity === undefined ? 1 : +st.opacity));
    ctx.setTransform(T[0], T[1], T[2], T[3], T[4], T[5]); ctx.drawImage(img, 0, 0, iw, ih); ctx.restore(); r.meta.push({blend:blendOf(st['mix-blend-mode'])});
  };
  // 一组只有形状 ⇒ 一个编组形状（不拆）
  const groupShape = (el, st, M, op) => {
    const kids = [];
    for (const c of el.children){ const t = c.localName; if (SKIP.has(t)) continue; const cs = styleOf(c, st); if (cs.display === 'none') continue;
      const CM = cat(parseTransform(c.getAttribute('transform')), M), co = op * (t === 'g' || t === 'a' ? (cs.opacity === undefined ? 1 : c01(+cs.opacity)) : 1);
      if (t === 'g' || t === 'a'){ const g = groupShape(c, cs, CM, co); if (g) kids.push(g); }
      else if (cs.visibility !== 'hidden' && cs.visibility !== 'collapse'){ const s = shapeOf(c, cs, CM, op); if (s) kids.push(s); } }
    return kids.length ? (kids.length === 1 ? kids[0] : {type:'group', children:kids}) : null;
  };
  let guard = 0;
  const walk = async (el, st, M, op, depth, layerLevel) => {
    if (guard++ > 200000) return;
    for (const c of el.children){
      const t = c.localName; if (SKIP.has(t)) continue;
      const cs = styleOf(c, st); const CM = cat(parseTransform(c.getAttribute('transform')), M);
      const name = nameOf(c), fresh = layerLevel && !!name;
      const hiddenLayer = cs.display === 'none';
      if (hiddenLayer && !(layerLevel && t === 'g')) continue;
      const subLayer = t === 'g' && layerLevel && !isLayerG(c, depth) && isSubLayerG(c, cs, depth);
      if (t === 'g' && layerLevel && (subLayer || isLayerG(c, depth))){
        const node = out.open({kind:'group', name:name || undefined, hidden:hiddenLayer || cs.visibility === 'hidden', opacity:cs.opacity !== undefined && +cs.opacity < 0.999 ? c01(+cs.opacity) : undefined, blend:blendOf(cs['mix-blend-mode']) || 'passThrough'});
        if (subLayer || c.getAttribute('data-kind') === 'artboard' || c.getAttribute('data-kind') === 'group') node.keepGroup = true;
        if (needsRaster(c, cs) || (cs['clip-path'] && clipOf(c, cs, CM) === false)) await rasterOf(c, out.raster(true).ctx);
        else {
          const clip = cs['clip-path'] ? clipOf(c, cs, CM) : null;
          if (clip && onlyShapes(c)){ const g = groupShape(c, Object.assign({}, cs, {opacity:undefined}), CM, 1); if (g) out.shape(g, clip, {}); }
          else { if (clip) out.notes.add('a clipping path on a layer with text or images was ignored'); await walk(c, Object.assign({}, cs, {opacity:undefined}), CM, 1, depth + 1, true); }
        }
        out.close(); continue;
      }
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse'){ if (t !== 'g' && t !== 'a' && t !== 'svg') continue; }
      if (needsRaster(c, cs)){ await rasterOf(c, out.raster(fresh, name || undefined).ctx); continue; }
      let clip = cs['clip-path'] ? clipOf(c, cs, CM) : null;
      if (clip === false){ await rasterOf(c, out.raster(fresh, name || undefined).ctx); continue; }
      const eop = op * (t === 'g' || t === 'a' || t === 'use' || t === 'svg' || t === 'switch' ? (cs.opacity === undefined ? 1 : c01(+cs.opacity)) : 1);
      if (SHAPES.has(t)){ out.shape(shapeOf(c, cs, CM, op), clip, {blend:blendOf(cs['mix-blend-mode'])}, fresh, name || undefined); continue; }
      if (t === 'g' || t === 'a'){
        if (onlyShapes(c)){ const g = groupShape(c, Object.assign({}, cs, {opacity:undefined}), CM, eop); if (g) out.shape(g, clip, {blend:blendOf(cs['mix-blend-mode'])}, fresh, name || undefined); }
        else { if (clip) out.notes.add('a clipping path on a group with text or images was ignored'); await walk(c, Object.assign({}, cs, {opacity:undefined}), CM, eop, depth + 1, false); }
        continue;
      }
      if (t === 'switch'){ const f = [...c.children].find(x => !SKIP.has(x.localName)); if (f){ const wrap = {children:[f]}; await walk(wrap, cs, CM, eop, depth + 1, layerLevel); } continue; }
      if (t === 'svg'){
        const vb2 = numList(c.getAttribute('viewBox')), w = len(c.getAttribute('width'), W, W), h = len(c.getAttribute('height'), H, H);
        const VM = cat(cat(viewport(vb2.length === 4 ? vb2 : null, w, h, c.getAttribute('preserveAspectRatio')), [1, 0, 0, 1, len(c.getAttribute('x'), W, 0), len(c.getAttribute('y'), H, 0)]), M);
        await walk(c, cs, VM, eop, depth + 1, false); continue;
      }
      if (t === 'use'){
        const tgt = byId((hrefOf(c) || '').replace(/^#/, '')); if (!tgt || depth > 40) continue;
        const UM = cat([1, 0, 0, 1, len(c.getAttribute('x'), W, 0), len(c.getAttribute('y'), H, 0)], CM);
        if (tgt.localName === 'symbol'){ const vb2 = numList(tgt.getAttribute('viewBox')), w = len(c.getAttribute('width'), W, vb2[2] || W), h = len(c.getAttribute('height'), H, vb2[3] || H);
          await walk(tgt, styleOf(tgt, cs), cat(viewport(vb2.length === 4 ? vb2 : null, w, h, tgt.getAttribute('preserveAspectRatio')), UM), eop, depth + 1, false); }
        else await walk({children:[tgt]}, cs, UM, eop, depth + 1, false);
        continue;
      }
      if (t === 'text'){
        const runs = textOf(c, cs, CM, op);
        const keep = out.cur.children.length;
        layoutRuns(runs, out, (r, o) => Object.assign(o, {font:r.font, bold:/bold|^[6-9]00$/i.test(r.weight), italic:r.italic, color:r.color}, r.embedded ? {embeddedFont:true} : {}), boxOf(c, st, M, CM));
        if (fresh && name && out.cur.children.length === keep + 1) out.cur.children[keep].name = name;
        continue;
      }
      if (t === 'image'){ await imageOf(c, cs, CM, op, fresh, name || undefined); continue; }
      if (GRAPHIC.has(t)) await rasterOf(c, out.raster(fresh, name || undefined).ctx);
    }
  };
  const rs = styleOf(root, null);
  await walk(root, Object.assign({}, rs, {opacity:undefined}), cat(parseTransform(root.getAttribute('transform')), M0), rs.opacity !== undefined ? c01(+rs.opacity) : 1, 0, true);
  return finish(out, W, H);
}

window.VecIO = {svg, pdf, isPdf, zstd, Bad};
})();
