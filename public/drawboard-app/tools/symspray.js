/* 堤麟画板 · 符号喷枪工具（AI 版面 ai.symbol-spray）＋ 符号工具组共用的 SymKit —— 照 ArtCraft VectorCraft 原码逐段翻译
   工具本体：vectorcraft/crates/tools/src/symbolism.rs:1-185（SymbolismTool：八颗符号工具同一个结构，差在 id）
   选项持久：tools/src/settings.rs:17-24（八颗共用一份「symbolism」store：diameter、intensity、density）
   清单：    tools/src/catalog.rs:106-113
   命令正文：engine/src/cmd/brushsym.rs:802-1021（symbol.spray／symbol.adjust、jitter、is_symbol_set、instance_center）
             engine/src/cmd/brushsym.rs:481-540（natural_size、place_xf、instances_of、current_symbol、resolve_symbol）
   着色：    brush/src/colorize.rs:77-120（tint_node、stain、instance_art：实例的填色＝把符号图稿里每个纯色往它混 amount）
   我们这边的资料结构：接 menus/impl/ai-window.js 的符号面板——
     符号定义 Doc.aiSymbols[i] = {name, shapes（定义那层的图层坐标）, x, y（定义那层的位移）}；目前的符号＝AiWindow.curSymbol；
     实例＝一个形状（或包着多个形状的 type:'group'）带 symbol:<名字>，几何是实打实的（没有 xf 矩阵）；
     符号组（Symbol Set）＝ {type:'group', name:'Symbol Set', children:[实例…]}（原码 is_symbol_set：非剪切编组、名字 "Symbol Set"）。
   原码的实例有 xf 矩阵、中心＝xf·原点；我们没有 xf ⇒ 实例中心＝几何外框中心，缩放／旋转直接套到几何上（rotate.js 的 rotTransformShape，编组往下递归）。
   原码实例的填色外观（stain）在画的时候才混色；我们没有那层渲染 ⇒ 实例记 symStain:{color, amount}，叶子形状记原色 symBase:{fill, stroke}，
   直接把 fill／stroke 改成混好的颜色（拿掉染色就还原），engine 不用改。
   这一支挂 window.SymKit 给同组的 symshift／symscrunch／symsize／symspin／symstain／symscreen／symstyle 读（它们只各叫一次 SymKit.makeTool）。 */

(function(){
const FEEDBACK = '#4f9dff';                                      // draw2.rs:23 FEEDBACK [0x4f,0x9d,0xff]
const HALF = 10;                                                 // brushsym.rs:24：自然大小缺省 2·HALF
const clone = v => JSON.parse(JSON.stringify(v));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v)) ? +v : d;
const err = (c, m) => ({ok:false, error:`${c}: ${m}`});

/* ───────── 八颗工具（symbolism.rs:20-21、59-70、83-91）───────── */
const KINDS = {
  symspray:  {rid:'symbolSprayer',   tool:null,      label:'Symbol Sprayer'},
  symshift:  {rid:'symbolShifter',   tool:'shift',   label:'Symbol Shifter'},
  symscrunch:{rid:'symbolScruncher', tool:'scrunch', label:'Symbol Scruncher'},
  symsize:   {rid:'symbolSizer',     tool:'size',    label:'Symbol Sizer'},
  symspin:   {rid:'symbolSpinner',   tool:'spin',    label:'Symbol Spinner'},
  symstain:  {rid:'symbolStainer',   tool:'stain',   label:'Symbol Stainer'},
  symscreen: {rid:'symbolScreener',  tool:'screen',  label:'Symbol Screener'},
  symstyle:  {rid:'symbolStyler',    tool:'style',   label:'Symbol Styler'}
};
const ADJUST_TOOLS = ['shift', 'scrunch', 'size', 'spin', 'stain', 'screen', 'style'];

/* ───────── 仿射（kurbo Affine [a,b,c,d,e,f]）───────── */
const Af = {
  mul(m, n){ return [m[0]*n[0] + m[2]*n[1], m[1]*n[0] + m[3]*n[1], m[0]*n[2] + m[2]*n[3], m[1]*n[2] + m[3]*n[3], m[0]*n[4] + m[2]*n[5] + m[4], m[1]*n[4] + m[3]*n[5] + m[5]]; },
  translate(x, y){ return [1, 0, 0, 1, x, y]; },
  scale(k){ return [k, 0, 0, k, 0, 0]; },
  rotate(th){ const c = Math.cos(th), s = Math.sin(th); return [c, s, -s, c, 0, 0]; },
  about(o, a){ return this.mul(this.translate(o[0], o[1]), this.mul(a, this.translate(-o[0], -o[1]))); },
  toLayer(L, m){ return this.mul(this.translate(-L.x, -L.y), this.mul(m, this.translate(L.x, L.y))); }    // 文件坐标矩阵 → 图层坐标矩阵
};

/* ───────── jitter（brushsym.rs:813-823）：FNV 式杂凑，u64 照搬用 BigInt ───────── */
const M64 = (1n << 64n) - 1n;
const rround = x => x < 0 ? -Math.round(-x) : Math.round(x);     // f64::round：.5 远离 0
function rotl64(x, k){ k = BigInt(k % 64); return k === 0n ? x : ((x << k) | (x >> (64n - k))) & M64; }
function jitter(i, q){
  let h = 0xcbf29ce484222325n ^ BigInt(i);
  for (const v of [rround(q[0] * 16), rround(q[1] * 16)]){
    h ^= BigInt.asUintN(64, BigInt(v));                           // as i64 as u64
    h = (h * 0x100000001b3n) & M64;                               // wrapping_mul
    h ^= h >> 29n;
  }
  const f = k => Number(rotl64(h, k * 21) & 0xffffn) / 65535 * 2 - 1;
  return [f(0), f(1), f(2)];
}
/* f64::signum：+0 ⇒ 1、-0 ⇒ -1 */
const signum = x => (x > 0 || Object.is(x, 0)) ? 1 : (x < 0 || Object.is(x, -0)) ? -1 : NaN;

/* ───────── 形状帮手 ───────── */
const isCont = s => s && (s.type === 'group' || s.type === 'compound') && Array.isArray(s.children);
function reid(s){ s.id = uid('S'); if (isCont(s)) s.children.forEach(reid); return s; }
/* Node::geometric_bounds（文件坐标）；ai-object.js 的 AIObj.shapeBounds 在就用它，不在就用 rotate.js 的外框 */
function boundsIn(s, f){
  if (window.AIObj && AIObj.shapeBounds) return AIObj.shapeBounds(s, f, false);
  if (isCont(s)) return s.children.reduce((r, c) => { const b = boundsIn(c, f); return !b ? r : !r ? b : {x0:Math.min(r.x0, b.x0), y0:Math.min(r.y0, b.y0), x1:Math.max(r.x1, b.x1), y1:Math.max(r.y1, b.y1)}; }, null);
  return typeof rotGeoBounds === 'function' ? rotGeoBounds(rotShapeGeo(s, f)) : null;
}
const docBounds = (L, s) => boundsIn(s, p => [p[0] + L.x, p[1] + L.y]);
const center = b => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
/* instance_center（brushsym.rs:909-914）：原码 xf·原点；我们＝几何外框中心（文件坐标） */
function instCenter(L, s){ const b = docBounds(L, s); return b ? center(b) : null; }
/* Node::transform(a, false)（node.rs:589）：编组／复合往下套，叶子交给 rotate.js 的 rotTransformShape；描边、圆角不跟着缩（Scaling false） */
function xformNode(L, s, ml){
  if (isCont(s)){ for (const c of s.children) if (!xformNode(L, c, ml)) return false; return true; }
  if (s.type === 'text'){ const p = [ml[0]*s.x + ml[2]*s.y + ml[4], ml[1]*s.x + ml[3]*s.y + ml[5]]; s.x = p[0]; s.y = p[1]; return true; }   // 文字只搬位置
  return rotTransformShape(L, s, ml, {strokes:false, corners:false});
}
/* 走遍所有看得见、没锁的矢量层（含编组成员）→ [{L, s, parent(所在阵列)}]；is_editable */
function editable(L){ return L && L.kind === 'vector' && L.visible !== false && !(window.Locks && Locks.blocks && Locks.blocks(L, 'pixels')); }
function walkAll(fn){
  for (const L of Doc.layers){
    if (!editable(L)) continue;
    const go = (arr) => { for (const s of arr.slice()){ fn(L, s, arr); if (isCont(s)) go(s.children); } };
    go(L.data.shapes);
  }
}
const isSet = s => s && s.type === 'group' && !s.clip && s.name === 'Symbol Set';      // is_symbol_set（brushsym.rs:825-827）

/* ───────── 符号（接 ai-window.js 的符号面板）───────── */
function symbols(){
  if (CMD.map['ai.symbol.list']) CMD.map['ai.symbol.list'].run({});     // 让 ai-window 的 store() 先对上目前的文件
  return Array.isArray(Doc.aiSymbols) ? Doc.aiSymbols : [];
}
/* resolve_symbol（brushsym.rs:584-592）：给了名字要存在；没给＝目前的符号，再没有＝第一个 */
function resolveSymbol(name, cmd){
  const S = symbols();
  if (name !== undefined && name !== null && name !== ''){ const s = S.find(x => x.name === name); return s ? {s} : {err:err(cmd, `no symbol named \`${name}\``)}; }
  const cur = window.AiWindow && AiWindow.curSymbol ? S.find(x => x.name === AiWindow.curSymbol) : null;
  const s = cur || S[0];
  return s ? {s} : {err:err(cmd, 'the document has no symbols')};
}
/* natural_size（brushsym.rs:481-487）：符号图稿的外框大小；量不到＝20×20 */
function naturalSize(S){
  const f = p => [p[0] + (S.x || 0), p[1] + (S.y || 0)];
  const b = (S.shapes || []).reduce((r, s) => { const k = boundsIn(s, f); return !k ? r : !r ? k : {x0:Math.min(r.x0, k.x0), y0:Math.min(r.y0, k.y0), x1:Math.max(r.x1, k.x1), y1:Math.max(r.y1, k.y1)}; }, null);
  return b ? [Math.max(1, b.x1 - b.x0), Math.max(1, b.y1 - b.y0)] : [2 * HALF, 2 * HALF];
}
/* 一个实例：place_xf(c, size) · scale(k)（brushsym.rs:500-502、886）＝原大小的符号图稿、中心放在 c（文件坐标）、再绕 c 缩 k 倍；放进 L 的图层坐标 */
function makeInstance(S, L, c, k){
  const shapes = clone(S.shapes || []).map(s => { delete s.symbol; return reid(s); });
  const n = shapes.length === 1 ? shapes[0] : {id:uid('S'), type:'group', children:shapes};
  n.symbol = S.name;
  shiftShape(n, (S.x || 0) - L.x, (S.y || 0) - L.y);
  const b = docBounds(L, n);
  if (b){ const cc = center(b); shiftShape(n, c[0] - cc[0], c[1] - cc[1]); }
  if (Math.abs(k - 1) > 1e-12) xformNode(L, n, Af.toLayer(L, Af.about(c, Af.scale(k))));
  return n;
}

/* ───────── 染色（colorize.rs:77-120 tint_node／stain）───────── */
const isHex = c => typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
const hexRgb = h => { h = h.trim().slice(1); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const rgbHex = a => '#' + a.map(v => ('0' + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2)).join('');
/* Color::lerp（color/lib.rs:235）：RGB 分量线性内插 */
function lerpHex(a, b, t){ const x = hexRgb(a), y = hexRgb(b); return rgbHex(x.map((v, i) => v + (y[i] - v) * t)); }
function leavesOf(s){ return isCont(s) && s.type === 'group' ? s.children.flatMap(leavesOf) : [s]; }
/* 套上／拿掉实例的染色：叶子形状的纯色 fill／stroke 往 color 混 amount（原色存在 symBase，拿掉就还原） */
function applyStain(n){
  const st = n.symStain;
  for (const leaf of leavesOf(n)){
    if (st){
      if (!leaf.symBase) leaf.symBase = {fill:leaf.fill === undefined ? null : leaf.fill, stroke:leaf.stroke === undefined ? null : leaf.stroke};
      ['fill', 'stroke'].forEach(k => { const b = leaf.symBase[k]; if (isHex(b) && isHex(st.color)) leaf[k] = lerpHex(b, st.color, clamp(st.amount, 0, 1)); else if (b !== null) leaf[k] = b; });
    } else if (leaf.symBase){
      ['fill', 'stroke'].forEach(k => { const b = leaf.symBase[k]; if (b === null) delete leaf[k]; else leaf[k] = b; });
      delete leaf.symBase;
    }
  }
}

/* ───────── symbol.spray（brushsym.rs:829-907）───────── */
function pointsParam(p, cmd){
  const a = p.points;
  if (!Array.isArray(a)) return {err:err(cmd, 'missing points [[x,y]…]')};
  const v = a.filter(q => Array.isArray(q) && q.length >= 2).map(q => [+q[0], +q[1]]);
  if (!v.length || v.some(q => !isFinite(q[0]) || !isFinite(q[1]))) return {err:err(cmd, 'points must be finite [x,y] pairs')};
  return {v};
}
function selectedObjects(){
  const L = window.VecSel ? VecSel.layer() : null;
  if (!L || L.kind !== 'vector') return {L:null, R:[]};
  return {L, R:L.data.shapes.filter(s => VecSel.shapes.includes(s.id))};
}
function spray(p){
  const C = 'symspray.spray';
  const pp = pointsParam(p, C); if (pp.err) return pp.err;
  const pts = pp.v;
  const rs = resolveSymbol(p.name, C); if (rs.err) return rs.err;
  const S = rs.s, name = S.name;
  const radius = clamp(num(p.radius, 40), 1, 2000), density = clamp(num(p.density, 5), 1, 10), scale = clamp(num(p.scale, 1), 0.01, 100), alt = !!p.alt;
  const size = naturalSize(S);
  // 选中的正好一个、且是符号组 ⇒ 往它里面加（brushsym.rs:839）
  const so = selectedObjects();
  const set = (so.R.length === 1 && isSet(so.R[0])) ? {L:so.L, g:so.R[0]} : null;
  if (alt){
    // 刷子底下这个符号的实例拿掉（符号组里的、或到处的）（brushsym.rs:841-866）
    const doomed = [];
    const hit = (L, s) => { if (s.symbol !== name) return false; const b = docBounds(L, s); if (!b) return false; const c = center(b); return pts.some(q => Math.hypot(q[0] - c[0], q[1] - c[1]) <= radius); };
    if (set){ if (editable(set.L)) set.g.children.forEach(s => { if (hit(set.L, s)) doomed.push({arr:set.g.children, s, L:set.L}); }); }
    else walkAll((L, s, arr) => { if (hit(L, s)) doomed.push({arr, s, L}); });
    const touched = new Set();
    for (const d of doomed){ const i = d.arr.indexOf(d.s); if (i >= 0){ d.arr.splice(i, 1); touched.add(d.L); } }
    touched.forEach(L => Layer.invalidate(L));
    if (window.VecSel) VecSel.prune && VecSel.prune();
    return {ok:true, count:doomed.length};
  }
  let L = set ? set.L : null;
  if (!L){ const A = Doc.active(); L = (A && A.kind === 'vector') ? A : (so.L || null); }
  if (!L) return err(C, 'select a vector layer');
  if (!editable(L)) return err(C, 'the layer is hidden or locked');
  // 沿着笔画保持至少这么远（越密越近）（brushsym.rs:868-878）
  const minGap = Math.max(size[0], size[1]) * scale * Math.max(1.15 - density * 0.1, 0.1);
  const placed = [];
  pts.forEach((q, i) => {
    const [jx, jy] = jitter(i, q);
    const c = [q[0] + jx * radius * 0.5, q[1] + jy * radius * 0.5];
    const l = placed[placed.length - 1];
    if (l && Math.hypot(l[0] - c[0], l[1] - c[1]) < minGap && i > 0) return;
    placed.push(c);
  });
  const nodes = placed.map((c, i) => { const js = jitter(i + 7, c)[2]; return makeInstance(S, L, c, scale * (1 + js * 0.1)); });
  let g;
  if (set){ g = set.g; nodes.forEach(n => g.children.push(n)); }
  else { g = {id:uid('S'), type:'group', name:'Symbol Set', children:nodes}; L.data.shapes.push(g); }
  VecSel.setShapes(L.id, [g.id]);
  Layer.invalidate(L);
  return {ok:true, id:g.id, layerId:L.id, count:placed.length};
}

/* ───────── symbol.adjust（brushsym.rs:916-1021）───────── */
function graphicStylePaint(name){
  const r = CMD.map['ai.graphicStyle.list'] ? CMD.map['ai.graphicStyle.list'].run({}) : null, G = (r && r.styles) || [];
  const g = (name !== undefined && name !== null && name !== '') ? G.find(x => x.name === name) : (G[1] || G[0]);   // 没给＝第一个非默认的样式
  if (!g) return undefined;                                                                                       // 原码 None ⇒ 退回 solid(color)
  return (g.look && g.look.fill !== undefined) ? g.look.fill : 'none';                                            // fill_paint：没有填色＝Paint::None
}
function adjust(p){
  const C = 'symspray.adjust';
  const tool = p.tool;
  if (typeof tool !== 'string') return err(C, 'missing `tool`');
  if (!ADJUST_TOOLS.includes(tool)) return err(C, `unknown tool \`${tool}\``);
  const pp = pointsParam(p, C); if (pp.err) return pp.err;
  const pts = pp.v;
  const radius = clamp(num(p.radius, 40), 1, 2000), intensity = clamp(num(p.intensity, 5), 1, 10) / 10, alt = !!p.alt;
  // 颜色：给了用给的，否则目前的填色，再不然黑（brushsym.rs:927-930）
  let color = isHex(p.color) ? p.color : null;
  if (!color){ const f = (window.UI && UI.fill) ? UI.fill() : null; color = isHex(f) ? f : '#000000'; }
  const stylePaint = tool === 'style' ? graphicStylePaint(p.style) : undefined;
  // 候选：没选东西＝所有实例；有选＝选中物件（往下走）里的实例；只留能改的（brushsym.rs:935-953）
  const cand = [];
  const so = selectedObjects();
  if (!so.R.length){ walkAll((L, s) => { if (s.symbol) cand.push({L, s}); }); }
  else if (editable(so.L)){
    const go = s => { if (s.symbol && !cand.some(c => c.s === s)) cand.push({L:so.L, s}); if (isCont(s)) s.children.forEach(go); };
    so.R.forEach(go);
  }
  const touched = new Set(), dirty = new Set();
  pts.forEach((q, j) => {
    const delta = j > 0 ? [q[0] - pts[j - 1][0], q[1] - pts[j - 1][1]] : [0, 0];
    for (const {L, s} of cand){
      const c = instCenter(L, s); if (!c) continue;
      const dist = Math.hypot(c[0] - q[0], c[1] - q[1]);
      if (dist > radius) continue;
      const w = intensity * Math.max(1 - dist / radius, 0);
      if (w <= 0) continue;
      touched.add(s); dirty.add(L);
      const about = m => Af.about(c, m);
      switch (tool){
        case 'shift': { const k = Math.min(w, 1); shiftShape(s, delta[0] * k, delta[1] * k); break; }
        case 'scrunch': { const k = 0.15 * w * (alt ? -1 : 1); shiftShape(s, (q[0] - c[0]) * k, (q[1] - c[1]) * k); break; }
        case 'size': { const k = 1 + 0.08 * w; xformNode(L, s, Af.toLayer(L, about(Af.scale(alt ? 1 / k : k)))); break; }
        case 'spin': {
          // 往拖的方向转；点一下转一点点（brushsym.rs:990-994）
          const a = Math.hypot(delta[0], delta[1]) > 1e-9 ? signum((c[0] - q[0]) * delta[1] - (c[1] - q[1]) * delta[0]) * 0.1 * w : 0.05 * w;
          xformNode(L, s, Af.toLayer(L, about(Af.rotate(alt ? -a : a)))); break;
        }
        case 'stain': case 'style': {
          const paint = tool === 'style' ? (stylePaint !== undefined ? stylePaint : color) : color;
          if (tool === 'style' && alt){ delete s.symStain; applyStain(s); break; }                  // Alt 样式器＝清掉外观
          const cur = (s.symStain && String(s.symStain.color).toLowerCase() === String(paint).toLowerCase()) ? s.symStain.amount : 0;
          const step = tool === 'style' ? 1 : 0.15 * w;
          const o = alt ? Math.max(cur - step, 0) : Math.min(cur + step, 1);
          if (o > 0) s.symStain = {color:paint, amount:o}; else delete s.symStain;
          applyStain(s); break;
        }
        default: {   // screen（滤色器）：不透明度，Alt 反向；最低 0.05
          const step = 0.1 * w, op = s.opacity === undefined ? 1 : +s.opacity;
          s.opacity = alt ? Math.min(op + step, 1) : Math.max(op - step, 0.05);
          if (s.opacity >= 1) delete s.opacity;
        }
      }
    }
  });
  dirty.forEach(L => Layer.invalidate(L));
  return {ok:true, count:touched.size};
}

/* ───────── 选项（symbolism.rs:172-184；settings.rs：diameter／intensity／density 八颗共用、存进偏好）───────── */
const Opts = {diameter:80, intensity:5, density:5};
const PerTool = {};                                                  // id → {symbol, style}
try { const o = JSON.parse(localStorage.getItem('dlSymbolism') || 'null'); if (o){ ['diameter', 'intensity', 'density'].forEach(k => { if (typeof o[k] === 'number' && isFinite(o[k])) Opts[k] = o[k]; }); } } catch(e){}
const saveOpts = () => { try { localStorage.setItem('dlSymbolism', JSON.stringify(Opts)); } catch(e){} };
const per = id => PerTool[id] || (PerTool[id] = {symbol:null, style:null});
function setOption(id, key, v){
  if (key === 'diameter') Opts.diameter = clamp(num(v, Opts.diameter), 2, 2000);
  else if (key === 'intensity') Opts.intensity = clamp(num(v, Opts.intensity), 1, 10);
  else if (key === 'density') Opts.density = clamp(num(v, Opts.density), 1, 10);
  else if (key === 'symbol') per(id).symbol = typeof v === 'string' && v ? v : null;
  else if (key === 'style') per(id).style = typeof v === 'string' && v ? v : null;
  else return;
  saveOpts();
}
function options(id){ return {diameter:Opts.diameter, intensity:Opts.intensity, density:Opts.density, symbol:per(id).symbol, style:per(id).style}; }

/* ───────── 手势（symbolism.rs:105-168）：按下 Begin＋Preview、拖时 Preview（整条笔画重套在快照上）、放开 Commit（一步历史）───────── */
const G = {
  id:null, points:[], active:false, hover:null, alt:false, base:null,
  /* command（symbolism.rs:73-102） */
  command(id){
    const k = KINDS[id], radius = Opts.diameter / 2, pts = this.points.map(q => q.slice());
    if (!k.tool){
      const v = {points:pts, radius, density:Opts.density, alt:this.alt};
      if (per(id).symbol) v.name = per(id).symbol;
      return ['symspray.spray', v];
    }
    const v = {tool:k.tool, points:pts, radius, intensity:Opts.intensity, alt:this.alt};
    if (k.tool === 'stain'){ const f = (window.UI && UI.fill) ? UI.fill() : null; if (isHex(f)) v.color = f; }
    if (per(id).style) v.style = per(id).style;
    return ['symspray.adjust', v];
  },
  snap(){ return {layers:Doc.layers.filter(L => L.kind === 'vector').map(L => ({L, shapes:clone(L.data.shapes)})), vsel:VecSel.snapshot()}; },
  reset(){ const b = this.base; if (!b) return; b.layers.forEach(x => { x.L.data.shapes = clone(x.shapes); Layer.invalidate(x.L); }); VecSel.restore(b.vsel); },
  preview(id){
    this.reset();
    const [c, v] = this.command(id);
    try { const r = CMD.map[c].run(v); this.lastErr = r && r.ok === false ? r.error : null; } catch(e){ console.error(e); }
    UI.draw();
  },
  down(id, e, pt){
    this.id = id; this.points = [pt.slice()]; this.active = true; this.alt = !!e.altKey;
    this.base = this.snap();                                        // Action::Begin(label)
    this.preview(id);                                               // Action::Preview
  },
  move(id, e, pt){
    this.hover = pt.slice();
    if (!this.active || this.id !== id) return;
    // 喷枪：取样间隔＝笔刷的 15%（至少 3 屏幕像素）；其余每 3 屏幕像素（symbolism.rs:124-128）
    const step = KINDS[id].tool ? VecSel.tol(3) : Math.max(Opts.diameter * 0.15, VecSel.tol(3));
    const l = this.points[this.points.length - 1];
    if (l && Math.hypot(l[0] - pt[0], l[1] - pt[1]) < step) return;
    this.points.push(pt.slice());
    this.preview(id);
  },
  commit(){
    if (!this.active) return null;
    const [c, v] = this.command(this.id);
    this.reset(); this.base = null; this.active = false; this.points = [];
    let r = null; try { r = CMD.run(c, v); } catch(e){ console.error(e); }
    UI.draw(); return r;
  },
  cancel(){ if (!this.active) return; this.reset(); this.base = null; this.active = false; this.points = []; UI.draw(); },
  /* key（symbolism.rs:141-155）：[ ] 直径 ±10（2..2000）；Shift+[ ] 强度 ±1（1..10）；拖时 Esc 取消 */
  key(id, e){
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.code === 'BracketLeft' || e.code === 'BracketRight' || e.key === '[' || e.key === ']' || e.key === '{' || e.key === '}'){
      const up = e.code === 'BracketRight' || e.key === ']' || e.key === '}';
      if (e.shiftKey) setOption(id, 'intensity', Opts.intensity + (up ? 1 : -1));
      else setOption(id, 'diameter', Opts.diameter + (up ? 10 : -10));
      e.preventDefault(); SymKit.syncOptions(); UI.draw(); return true;
    }
    if (e.key === 'Escape' && this.active){ e.preventDefault(); this.cancel(); return true; }
    return false;
  }
};

/* ───────── 命令（agent 走这几条做得到跟滑鼠一样的事）───────── */
CMD.reg('symspray.spray', {i18n:'', undoable:true,
  params:'{points:[[x,y]…] 文件坐标（＝喷枪拖过的取样点）, name?:符号名（缺省＝符号面板目前的符号，再没有＝第一个）, radius?:40（笔刷半径）, density?:1..10=5（越大越密）, scale?:1, alt?:bool（Alt＝把刷子底下这个符号的实例拿掉）} ' +
         '照 symbol.spray：沿着点喷符号实例（每点抖动 ±半径一半、间隔≥符号大小×(1.15−密度×0.1)、大小 ±10%），选中的正好是一个符号组就加进去，否则新建一个「Symbol Set」编组放进目前的矢量层并选中它 → {ok, id, layerId, count}；alt ⇒ {ok, count}'}, p => spray(p || {}));
CMD.reg('symspray.adjust', {i18n:'', undoable:true,
  params:'{tool:"shift|scrunch|size|spin|stain|screen|style", points:[[x,y]…] 文件坐标, radius?:40, intensity?:1..10=5, alt?:bool, color?:"#rrggbb"（着色器；缺省＝目前的填色）, style?:图形样式名（样式器；缺省＝第一个非默认样式）} ' +
         '照 symbol.adjust：调整点附近的符号实例（有选取＝选中物件里的实例，否则全部）；权重＝强度/10×(1−距离/半径)。' +
         'shift 跟着拖动搬；scrunch 往点聚拢（alt 推开）；size 放大 1+0.08w（alt 缩小）；spin 往拖的方向转 0.1w 弧度（点一下 0.05w；alt 反转）；' +
         'stain 往颜色混 0.15w（alt 退色）；screen 不透明度 −0.1w（最低 5%；alt 加回）；style 套样式的填色（alt 清掉）→ {ok, count}'}, p => adjust(p || {}));
CMD.reg('symspray.options', {i18n:'',
  params:'{tool?:"symspray|symshift|symscrunch|symsize|symspin|symstain|symscreen|symstyle"（缺省＝目前的工具／symspray）, diameter?:2..2000, intensity?:1..10, density?:1..10, symbol?:名字|null（喷枪用）, style?:名字|null（样式器用）} ' +
         '符号工具选项（直径、强度、密度八颗共用、存进偏好）；不给参数＝只读 → {diameter, intensity, density, symbol, style}'}, p => {
  p = p || {};
  const id = KINDS[p.tool] ? p.tool : (KINDS[ToolState.cur] ? ToolState.cur : 'symspray');
  ['diameter', 'intensity', 'density', 'symbol', 'style'].forEach(k => { if (k in p) setOption(id, k, p[k]); });
  SymKit.syncOptions(); if (window.UI) UI.draw();
  return options(id);
});

/* ───────── 三语 ───────── */
const STR = {
  'zh-Hant':{'tool.symspray':'符號噴灑器工具', 'tool.symshift':'符號偏移器工具', 'tool.symscrunch':'符號壓縮器工具', 'tool.symsize':'符號縮放器工具', 'tool.symspin':'符號旋轉器工具',
    'tool.symstain':'符號著色器工具', 'tool.symscreen':'符號濾網工具', 'tool.symstyle':'符號樣式器工具',
    'opt.symDiameter':'直徑', 'opt.symIntensity':'強度', 'opt.symDensity':'符號組密度', 'opt.symSymbol':'符號', 'opt.symStyle':'樣式', 'ui.symCurrent':'（目前的）', 'ui.symFirstStyle':'（第一個樣式）',
    'ui.symHintSpray':'拖＝噴灑符號實例（選中符號組就加進去）· Alt 拖＝刪掉刷子下的實例 · [ ] 直徑 · Shift+[ ] 強度 · Esc 取消',
    'ui.symHintAdjust':'拖＝調整刷子下的符號實例（有選取只動選中的）· Alt＝反向 · [ ] 直徑 · Shift+[ ] 強度 · Esc 取消',
    'ui.symNoSymbol':'文件裡還沒有符號：先選物件、在符號面板按 ＋'},
  'zh-Hans':{'tool.symspray':'符号喷枪工具', 'tool.symshift':'符号移位器工具', 'tool.symscrunch':'符号紧缩器工具', 'tool.symsize':'符号缩放器工具', 'tool.symspin':'符号旋转器工具',
    'tool.symstain':'符号着色器工具', 'tool.symscreen':'符号滤色器工具', 'tool.symstyle':'符号样式器工具',
    'opt.symDiameter':'直径', 'opt.symIntensity':'强度', 'opt.symDensity':'符号组密度', 'opt.symSymbol':'符号', 'opt.symStyle':'样式', 'ui.symCurrent':'（目前的）', 'ui.symFirstStyle':'（第一个样式）',
    'ui.symHintSpray':'拖＝喷符号实例（选中符号组就加进去）· Alt 拖＝删掉刷子下的实例 · [ ] 直径 · Shift+[ ] 强度 · Esc 取消',
    'ui.symHintAdjust':'拖＝调整刷子下的符号实例（有选取只动选中的）· Alt＝反向 · [ ] 直径 · Shift+[ ] 强度 · Esc 取消',
    'ui.symNoSymbol':'文件里还没有符号：先选对象、在符号面板按 ＋'},
  'en':{'tool.symspray':'Symbol Sprayer Tool', 'tool.symshift':'Symbol Shifter Tool', 'tool.symscrunch':'Symbol Scruncher Tool', 'tool.symsize':'Symbol Sizer Tool', 'tool.symspin':'Symbol Spinner Tool',
    'tool.symstain':'Symbol Stainer Tool', 'tool.symscreen':'Symbol Screener Tool', 'tool.symstyle':'Symbol Styler Tool',
    'opt.symDiameter':'Diameter', 'opt.symIntensity':'Intensity', 'opt.symDensity':'Symbol Set Density', 'opt.symSymbol':'Symbol', 'opt.symStyle':'Style', 'ui.symCurrent':'(current)', 'ui.symFirstStyle':'(first style)',
    'ui.symHintSpray':'Drag to spray symbol instances (into the selected symbol set) · Alt-drag deletes instances under the brush · [ ] diameter · Shift+[ ] intensity · Esc cancels',
    'ui.symHintAdjust':'Drag to adjust the symbol instances under the brush (only the selected ones when there is a selection) · Alt reverses · [ ] diameter · Shift+[ ] intensity · Esc cancels',
    'ui.symNoSymbol':'The document has no symbols yet: select art and click New Symbol in the Symbols panel'}
};

/* ───────── 造一颗工具（八颗同一个 SymbolismTool）───────── */
const ORDER = {symspray:220, symshift:221, symscrunch:222, symsize:223, symspin:224, symstain:225, symscreen:226, symstyle:227};
const SymKit = window.SymKit = {
  KINDS, Opts, G, jitter, naturalSize, makeInstance, applyStain, spray, adjust, options, setOption, instCenter, isSet,
  _optEls:null,
  syncOptions(){ const o = this._optEls; if (!o) return; if (o.d) o.d.value = Opts.diameter; if (o.i) o.i.value = Opts.intensity; if (o.n) o.n.value = Opts.density; },
  makeTool(id){
    const k = KINDS[id];
    return Tools.reg({
      id, icon:'✲', group:'vector', order:ORDER[id], for:'vector', opts:[], cursor:'crosshair',
      hint:k.tool ? 'ui.symHintAdjust' : 'ui.symHintSpray',
      strings:STR,
      onDown(e, pt){ if (e.button !== undefined && e.button !== 0) return; G.hover = pt.slice(); G.down(id, e, pt); },
      onMove(e, pt){ G.move(id, e, pt); if (!G.active) UI.draw(); },
      onUp(e, pt){ if (G.active && G.id === id) G.commit(); else UI.draw(); },
      onKey(e){ return G.key(id, e); },
      onDeactivate(){ if (G.active) G.commit(); G.hover = null; SymKit._optEls = null; },      // symbolism.rs:156-163：拖到一半换工具＝提交
      /* 选项栏：直径、强度（八颗共用）；喷枪多密度、符号；样式器多样式 */
      buildOptions(box, add, mk){
        const o = SymKit._optEls = {};
        const d = o.d = mk('number', {min:2, max:2000, step:1, value:Opts.diameter}); d.style.width = '64px';
        d.onchange = () => CMD.run('symspray.options', {tool:id, diameter:+d.value}); add('symDiameter', d);
        const it = o.i = mk('number', {min:1, max:10, step:1, value:Opts.intensity}); it.style.width = '48px';
        it.onchange = () => CMD.run('symspray.options', {tool:id, intensity:+it.value}); add('symIntensity', it);
        if (!k.tool){
          const n = o.n = mk('number', {min:1, max:10, step:1, value:Opts.density}); n.style.width = '48px';
          n.onchange = () => CMD.run('symspray.options', {tool:id, density:+n.value}); add('symDensity', n);
          const sel = document.createElement('select'), S = symbols();
          const o0 = document.createElement('option'); o0.value = ''; o0.textContent = Lang.t('ui.symCurrent'); sel.appendChild(o0);
          S.forEach(s => { const op = document.createElement('option'); op.value = s.name; op.textContent = s.name; sel.appendChild(op); });
          sel.value = per(id).symbol && S.some(s => s.name === per(id).symbol) ? per(id).symbol : '';
          sel.onchange = () => CMD.run('symspray.options', {tool:id, symbol:sel.value || null}); add('symSymbol', sel);
          if (!S.length){ const h = document.createElement('span'); h.style.cssText = 'color:#e0a040'; h.textContent = Lang.t('ui.symNoSymbol'); box.appendChild(h); }
        }
        if (k.tool === 'style'){
          const sel = document.createElement('select'), r = CMD.map['ai.graphicStyle.list'] ? CMD.map['ai.graphicStyle.list'].run({}) : null, GS = (r && r.styles) || [];
          const o0 = document.createElement('option'); o0.value = ''; o0.textContent = Lang.t('ui.symFirstStyle'); sel.appendChild(o0);
          GS.forEach(g => { const op = document.createElement('option'); op.value = g.name; op.textContent = g.name; sel.appendChild(op); });
          sel.value = per(id).style && GS.some(g => g.name === per(id).style) ? per(id).style : '';
          sel.onchange = () => CMD.run('symspray.options', {tool:id, style:sel.value || null}); add('symStyle', sel);
        }
      },
      /* overlays（symbolism.rs:164-168）：游标处一个直径大小的圆（FEEDBACK 蓝、1px） */
      drawOverlay(ctx, s){
        if (window.VecSel) VecSel.drawOverlay(ctx, s);
        const p = G.hover; if (!p) return;
        const dpr = s / UI.zoom;
        ctx.save(); ctx.setLineDash([]); ctx.strokeStyle = FEEDBACK; ctx.lineWidth = 1 * dpr;
        ctx.beginPath(); ctx.arc(p[0] * s, p[1] * s, Opts.diameter / 2 * s, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
    });
  }
};
if (typeof Lang !== 'undefined') Lang.add(STR);
SymKit.makeTool('symspray');
})();
