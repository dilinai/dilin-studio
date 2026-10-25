/* ───────────────────────────────────────────────────────────────
   堤麟画板 · 引擎
   设计三条铁律（定）：
   ① 导出时向量层按导出尺寸「重算」，不是把小图放大 —— 见 renderLayer(scale)
   ② 遮罩与混合对像素层／向量层一视同仁 —— 任何层先渲成 RGBA 再叠，见 composite
   ③ 向量层按视角缓存，内容真改了才失效 —— 见 layer._cache / invalidate
   另：界面只是命令集的一个精选入口；命令一条不少，全部走 CMD。
   ─────────────────────────────────────────────────────────────── */

// 照 PS 2020 图层混合模式（27 种，顺序同 PS 选单；color/src/blend.rs 151-342 的公式，menus/impl/ps-edit.js 有同一份翻译）
const BLENDS = ['normal','dissolve','darken','multiply','colorBurn','linearBurn','darkerColor','lighten','screen','colorDodge','linearDodge','lighterColor',
  'overlay','softLight','hardLight','vividLight','linearLight','pinLight','hardMix','difference','exclusion','subtract','divide','hue','saturation','color','luminosity'];
// 浏览器 canvas 原生、而且公式跟 PS 一样的才走原生（快）；其余（柔光：W3C 公式跟 PS 不同；线性减淡：lighter 连 alpha 都相加；亮光、线性光、点光、实色混合、
// 线性加深、减去、划分、深色、浅色、溶解：canvas 没有）由 blendDraw 逐像素自算
const BLEND_CSS = {normal:'source-over',multiply:'multiply',screen:'screen',overlay:'overlay',
  darken:'darken',lighten:'lighten',difference:'difference',hue:'hue',
  saturation:'saturation',color:'color',luminosity:'luminosity',
  colorBurn:'color-burn',colorDodge:'color-dodge',hardLight:'hard-light',exclusion:'exclusion'};
const PsBlend = {
  ch(m, cb, cs){
    const c01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
    const burn = (b, t) => b >= 1 ? 1 : t <= 0 ? 0 : 1 - Math.min((1 - b) / t, 1);
    const dodge = (b, t) => b <= 0 ? 0 : t >= 1 ? 1 : Math.min(b / (1 - t), 1);
    switch (m){
      case 'linearBurn': return Math.max(cb + cs - 1, 0);
      case 'linearDodge': return Math.min(cb + cs, 1);
      case 'softLight': return cs <= 0.5 ? 2 * cb * cs + cb * cb * (1 - 2 * cs) : 2 * cb * (1 - cs) + Math.sqrt(Math.max(cb, 0)) * (2 * cs - 1);   // PS 公式（不是 W3C 那个）
      case 'vividLight': return cs <= 0.5 ? burn(cb, 2 * cs) : dodge(cb, 2 * (cs - 0.5));
      case 'linearLight': return c01(cb + 2 * cs - 1);
      case 'pinLight': return cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * cs - 1);
      case 'hardMix': return cb + cs >= 1 - 1e-6 ? 1 : 0;
      case 'subtract': return Math.max(cb - cs, 0);
      case 'divide': return cs <= 0 ? (cb <= 0 ? 0 : 1) : Math.min(cb / cs, 1);
      default: return cs;
    }
  },
  native(mode){ return !mode || mode === 'normal' || !!BLEND_CSS[mode]; },
  /* 把 img 以 mode、不透明度 alpha 画到 ctx 的 (dx,dy)；原生的走 canvas，其余读底、逐像素（W3C 合成式：Co = αs(1-αb)Cs + αsαb·B(Cb,Cs) + (1-αs)αbCb） */
  draw(ctx, img, dx, dy, mode, alpha){
    alpha = alpha === undefined ? 1 : alpha;
    const t = ctx.getTransform ? ctx.getTransform() : null, ident = !t || (t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1);
    if (this.native(mode) || !ident){
      ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = BLEND_CSS[mode] || 'source-over'; ctx.drawImage(img, dx, dy); ctx.restore(); return;
    }
    const ox = Math.round(dx + (t ? t.e : 0)), oy = Math.round(dy + (t ? t.f : 0)), W = ctx.canvas.width, H = ctx.canvas.height;
    const x0 = Math.max(0, ox), y0 = Math.max(0, oy), x1 = Math.min(W, ox + img.width), y1 = Math.min(H, oy + img.height);
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0, h = y1 - y0;
    const tc = document.createElement('canvas'); tc.width = w; tc.height = h;
    const tx = tc.getContext('2d'); tx.drawImage(img, ox - x0, oy - y0);
    const S = tx.getImageData(0, 0, w, h).data;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    const B = ctx.getImageData(x0, y0, w, h), D = B.data;
    const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
    for (let i = 0; i < D.length; i += 4){
      let as = S[i + 3] / 255 * alpha; if (as <= 0) continue;
      if (mode === 'dissolve'){                                    // 溶解：照 alpha 当机率，每格要嘛全上要嘛不上（固定乱数表，同位置同结果）
        const k = (((x0 + (i >> 2) % w) * 73856093) ^ ((y0 + ((i >> 2) / w | 0)) * 19349663)) >>> 0, r = ((k * 2654435761) >>> 0) / 4294967296;
        if (r >= as){ continue; } as = 1;
        D[i] = S[i]; D[i + 1] = S[i + 1]; D[i + 2] = S[i + 2]; D[i + 3] = 255; continue;
      }
      const ab = D[i + 3] / 255, cb = [D[i] / 255, D[i + 1] / 255, D[i + 2] / 255], cs = [S[i] / 255, S[i + 1] / 255, S[i + 2] / 255];
      let bl;
      if (mode === 'darkerColor') bl = lum(...cs) < lum(...cb) ? cs : cb;
      else if (mode === 'lighterColor') bl = lum(...cs) > lum(...cb) ? cs : cb;
      else bl = [this.ch(mode, cb[0], cs[0]), this.ch(mode, cb[1], cs[1]), this.ch(mode, cb[2], cs[2])];
      const ao = as + ab * (1 - as);
      for (let c = 0; c < 3; c++){
        const co = as * (1 - ab) * cs[c] + as * ab * bl[c] + (1 - as) * ab * cb[c];
        D[i + c] = Math.round(co / ao * 255);
      }
      D[i + 3] = Math.round(ao * 255);
    }
    ctx.putImageData(B, x0, y0);
    ctx.restore();
  }
};
const blendDraw = (ctx, img, dx, dy, mode, alpha) => PsBlend.draw(ctx, img, dx, dy, mode, alpha);
window.PsBlend = PsBlend; window.blendDraw = blendDraw;

let _uid = 0;
const uid = (p) => `${p}${++_uid}`;

/* ───────── 像素内容票号（给网站宿主的增量存档用） ─────────
   任何对 canvas 的 2D 写入、或设 width/height（会清空画布）都给那张 canvas 换一个新票号 c.__dlPx（全域递增、永不重复）。
   ⇒ 票号没变＝像素一定没变（不管是工具、命令、菜单还是谁直接动画布），序列化就能放心沿用上次的编码。
   快照／还原／蒙版复制是「整张原样拷」，拷完把来源的票号抄过去（PX.copy），undo 回去也认得出是同一份像素。
   🔴 正确性优先：只会多换票号（多编），不会漏换。 */
let PX_SEQ = 0;
const PX = {
  tok(c){ return c ? c.__dlPx : undefined; },
  bump(c){ if (c) c.__dlPx = ++PX_SEQ; },
  /* dst 是刚从 src 整张拷来的（同尺寸、0,0、新开的 context）⇒ 内容相同，票号照抄 */
  copy(dst, src){ if (dst && src) dst.__dlPx = src.__dlPx; }
};
(function patchCanvasWrites(){
  if (typeof CanvasRenderingContext2D === 'undefined' || CanvasRenderingContext2D.prototype.__dlPxPatched) return;
  const P = CanvasRenderingContext2D.prototype;
  P.__dlPxPatched = true;
  ['clearRect','fillRect','strokeRect','fill','stroke','fillText','strokeText','drawImage','putImageData','reset'].forEach(m => {
    const f = P[m]; if (typeof f !== 'function') return;
    P[m] = function(){ const r = f.apply(this, arguments); const c = this.canvas; if (c) c.__dlPx = ++PX_SEQ; return r; };
  });
  if (typeof HTMLCanvasElement !== 'undefined'){
    ['width','height'].forEach(k => {
      const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, k);
      if (!d || !d.set || !d.configurable) return;
      Object.defineProperty(HTMLCanvasElement.prototype, k, {
        configurable:true, enumerable:d.enumerable, get:d.get,
        set(v){ d.set.call(this, v); this.__dlPx = ++PX_SEQ; }   // 设尺寸（就算同值）会清空画布
      });
    });
  }
})();

/* ───────── 文档模型 ───────── */
const Doc = {
  width: 1200, height: 675, bg: null,
  layers: [],            // 由下到上
  activeId: null,
  sel: null,             // 选区 {x,y,w,h} 或 null（第一版只做矩形选区）
  serial: 0,             // 文件序号：每开一份新文件 +1（undo 不变）。Shift+点连线用它判「是不是同一份文件」

  reset(w, h, fillBG, blankLayer = true){
    if (window.Smart && Smart.session && !Smart._opening) Smart.dropSession();   // 编辑智能对象内容中开新档：内容编辑作废
    this.serial++;
    if (window.AiView) AiView.docRestore(null);   // AI 参考线／存的视图随文件清空
    this.width = w; this.height = h; this.layers = []; this.sel = null; _uid = 0;
    if (window.VecSel) VecSel.clear();     // 矢量节点选取随文件清掉（tools/_vecsel.js）
    if (fillBG){
      const L = Layer.raster(Lang.t('layer.bg'));
      const c = L.data.ctx;
      c.fillStyle = fillBG; c.fillRect(0,0,w,h);
      this.layers.push(L); this.activeId = L.id;
    } else if (blankLayer){
      const L = Layer.raster(Lang.t('layer.untitled')+' 1');
      this.layers.push(L); this.activeId = L.id;
    } else this.activeId = null;   // agent 开空档直接往里放东西，不留空白「图层 1」
    History.clear();
  },
  active(){ return this.layers.find(l => l.id === this.activeId) || null; },
  index(id){ return this.layers.findIndex(l => l.id === id); },
  byId(id){ return this.layers.find(l => l.id === id) || null; },
  add(L, at){
    if (at === undefined) at = this.layers.length;
    // 有图层组时：新层跟「插入点正下方那层」同一个父（photocraft doc.insert_above：插在当前层之上＝当前层的兄弟）
    if (L.parent === undefined && Groups.any()){ const B = this.layers[at - 1]; L.parent = B ? (B.parent || null) : null; }
    this.layers.splice(at, 0, L); this.activeId = L.id; return L;
  },
  remove(id){
    const i = this.index(id); if (i < 0) return false;
    const L = this.layers[i];
    if (L.kind === 'group'){                               // 删组＝连子孙一起删（photocraft doc.remove 拿走整个节点）
      const ids = new Set([L.id, ...Groups.descendants(L).map(D => D.id)]);
      let first = i;
      for (let k = this.layers.length - 1; k >= 0; k--) if (ids.has(this.layers[k].id)){ first = Math.min(first, k); this.layers.splice(k, 1); }
      this.activeId = this.layers.length ? this.layers[Math.max(0, Math.min(first, this.layers.length - 1))].id : null;
      return true;
    }
    this.layers.splice(i,1);
    this.activeId = this.layers.length ? this.layers[Math.min(i, this.layers.length-1)].id : null;
    return true;
  }
};

/* ───────── 图层组（照 photocraft doc/src/lib.rs:167 Group／795 insert_above／811 shift；compose/src/lib.rs:1013-1110 合成） ─────────
   资料：组＝kind:'group'，data={expanded, artboard:null|{rect:[x,y,w,h], background:'white'|'black'|'transparent'|'#rrggbb', preset}}。
   子层仍放在 Doc.layers（扁平、由下到上），子层带 L.parent＝组 id（顶层＝null 或没有这个栏位）。
   树＝parent 指标＋兄弟之间在阵列里的先后；normalize() 把阵列排成「组的子孙紧接在组的下面」（DFS 顺序），
   所以 Doc.byId／index、现有命令、历史快照、工程档都照旧能用（工程档每层多一个 parent 栏位）。 */
const Groups = {
  any(){ for (const L of Doc.layers) if (L.kind === 'group') return true; return false; },
  /* 一次建好整棵树：kids.get(父 id|null) ＝ 那个父的直接子层（由下到上）；父不是组／不存在 ⇒ 当顶层 */
  tree(layers){
    const Ls = layers || Doc.layers, byId = new Map(), kids = new Map([[null, []]]);
    for (const L of Ls) byId.set(L.id, L);
    for (const L of Ls){
      let p = L.parent || null; const G = p ? byId.get(p) : null;
      if (!G || G.kind !== 'group' || G === L) p = null;
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(L);
    }
    return {byId, kids, of(id){ return this.kids.get(id || null) || []; }};
  },
  parentOf(L){ const p = L && L.parent; if (!p) return null; const G = Doc.byId(p); return G && G.kind === 'group' && G !== L ? G : null; },
  children(G, T){ return (T || this.tree()).of(G ? G.id : null); },
  topLevel(T){ return (T || this.tree()).of(null); },
  /* 全部子孙（DFS、由下到上，不含自己） */
  descendants(G, T){
    T = T || this.tree(); const out = [], seen = new Set();
    const go = id => { for (const C of T.of(id)){ if (seen.has(C.id)) continue; seen.add(C.id); if (C.kind === 'group') go(C.id); out.push(C); } };
    if (G) go(G.id);
    return out;
  },
  ancestors(L){ const out = []; let G = this.parentOf(L), n = 0; while (G && n++ < 1000){ out.push(G); G = this.parentOf(G); } return out; },
  depth(L){ return this.ancestors(L).length; },
  /* X 在不在 A 的子树里（A 的子孙；不含 A 自己） */
  isUnder(X, A, byId){
    const get = id => byId ? byId.get(id) : Doc.byId(id);
    let p = X && X.parent, n = 0;
    while (p && n++ < 1000){ if (p === A.id) return true; const G = get(p); p = G && G.parent; }
    return false;
  },
  /* 画板（photocraft artboard_cmds.rs：画板＝顶层组＋data.artboard）：L 所在的画板（自己或顶层祖先） */
  artboardOf(L){ const top = [L, ...this.ancestors(L)].pop(); return top && top.kind === 'group' && top.data && top.data.artboard ? top : null; },
  /* 按树重排 Doc.layers（T 的 kids 阵列可先改顺序再叫这支）：组的子孙紧接在组下面 */
  rebuild(T){
    const out = [], seen = new Set();
    const emit = list => { for (const L of list){ if (seen.has(L.id)) continue; seen.add(L.id); if (L.kind === 'group') emit(T.of(L.id)); out.push(L); } };
    emit(T.of(null));
    const Ls = Doc.layers;
    if (out.length !== Ls.length) Ls.forEach(L => { if (!seen.has(L.id)){ L.parent = null; out.push(L); } });   // 保险：漏掉的（不该有）放最上面
    if (out.every((L, i) => L === Ls[i])) return false;
    Ls.splice(0, Ls.length, ...out);
    return true;
  },
  /* 一个层（与它的子孙）平移：像素／矢量／文字／智能对象都是改 x/y（各自渲染时加上）；组本身不带位移，往下传给子孙 */
  shiftLayer(L, dx, dy){
    if (L.kind === 'group') return;
    L.x += dx; L.y += dy; Layer.invalidate(L);
  },
  /* 每条命令跑完叫一次（CMD.run 最外层）：①父指标没定的新层（菜单档直接 splice 进来的）＝跟正下方那层同一个父；
     ②父不是组／不存在／成环 ⇒ 顶层；③组被移动（move.translate 改到组的 x/y）⇒ 位移搬进子孙（photocraft shift_layer 递归子层）；④排成 DFS。
     文件里没有组、也没有层带 parent ⇒ 什么都不做（旧文件行为不变）。回传有没有改 */
  normalize(){
    const Ls = Doc.layers;
    let need = false; for (const L of Ls) if (L.kind === 'group' || L.parent){ need = true; break; }
    if (!need) return false;
    const byId = new Map(Ls.map(L => [L.id, L]));
    let changed = false;
    for (let i = 0; i < Ls.length; i++){
      const L = Ls[i]; if (L.parent !== undefined) continue;
      let p = null;
      for (let j = i - 1; j >= 0; j--){ const B = Ls[j]; if (L.kind === 'group' && this.isUnder(B, L, byId)) continue; p = B.parent || null; break; }
      L.parent = p; changed = true;
    }
    for (const L of Ls){
      if (!L.parent){ if (L.parent !== null){ L.parent = null; changed = true; } continue; }
      const G = byId.get(L.parent);
      if (!G || G.kind !== 'group' || G === L || this.isUnder(G, L, byId)){ L.parent = null; changed = true; }
    }
    const T = this.tree();
    for (const G of Ls){
      if (G.kind !== 'group' || (!G.x && !G.y)) continue;
      const dx = G.x, dy = G.y; G.x = 0; G.y = 0;
      this.descendants(G, T).forEach(D => this.shiftLayer(D, dx, dy));
      if (G.data && G.data.artboard && Array.isArray(G.data.artboard.rect)){ const r = G.data.artboard.rect; r[0] += dx; r[1] += dy; }
      // 图框（tools/frame.js）：框的 rect 与蒙版跟着走；组里套的图框（画板里的图框）也一起搬（shiftLayer 跳过组）
      [G].concat(this.descendants(G, T)).forEach(F => {
        if (F.kind !== 'group' || !F.data || !F.data.frame || !Array.isArray(F.data.frame.rect)) return;
        F.data.frame.rect[0] += dx; F.data.frame.rect[1] += dy;
        if (window.FrameKit && FrameKit.buildMask) FrameKit.buildMask(F);
      });
      Layer.invalidate(G); changed = true;
    }
    if (this.rebuild(T)) changed = true;
    return changed;
  }
};

/* ───────── 图层 ─────────
   三种 kind 地位平等：raster / vector / text
   共用：visible opacity blend mask x y
   raster.data = {canvas, ctx}            （RGBA 画布；只开内容那块、L.x/L.y 定位——见下面 LayerBox）
   vector.data = {shapes:[…]}             （与分辨率无关，导出时按 scale 重画）
   text.data   = {x,y,text,size,font,color,align}   （也是分辨率无关）
*/
const Layer = {
  _base(kind, name){
    return { id: uid('L'), kind, name, visible: true, opacity: 1, blend: 'normal',
             mask: null, x: 0, y: 0, _cache: null, _cacheScale: 0, data: null };
  },
  raster(name, w, h){
    const L = this._base('raster', name || (Lang.t('layer.untitled')));
    const c = document.createElement('canvas');
    c.width = w || Doc.width; c.height = h || Doc.height;
    L.data = { canvas: c, ctx: c.getContext('2d', {willReadFrequently:true}) };
    return L;
  },
  vector(name){
    const L = this._base('vector', name || (Lang.t('layer.untitled')));
    L.data = { shapes: [] };
    return L;
  },
  text(name, o){
    const L = this._base('text', name || (o && o.text) || Lang.t('layer.text'));
    L.data = Object.assign({ x:40, y:80, text:'Text', size:64, font:'sans-serif',
                             color:'#ffffff', align:'left', weight:'normal' }, o||{});
    return L;
  },
  /* 图层组（photocraft doc/src/lib.rs:495 Layer::group：混合模式预设「穿透」）。子层不放在这里——子层仍在 Doc.layers 里、带 L.parent＝组 id（见 Groups） */
  group(name, o){
    const L = this._base('group', name || Lang.t('layer.group'));
    L.blend = 'passThrough';
    L.data = Object.assign({expanded:true, artboard:null}, o || {});
    return L;
  },
  /* 智能对象（photocraft doc/src/lib.rs:335 SmartObject；渲染见 Smart） */
  smart(name, data){
    const L = this._base('smart', name || Lang.t('layer.smart'));
    L.data = Object.assign({source:null, transform:[1, 0, 0, 1, 0, 0], ops:[], filters:[], filtersEnabled:true, stackMode:null}, data || {});
    return L;
  },
  invalidate(L){ L._cache = null; L._cacheScale = 0; }
};

/* ───────── 像素层按内容大小 ─────────
   原本每张像素层都开「整张文件大」的画布：5120×3460 的合辑放 20 张小图就吃约 1.4GB、开档第一次重画约 11 秒。
   现在：像素层画布只开有内容的那块，用 L.x/L.y 定位（铁律④本来就要求写入前减 L.x/L.y，渲染／合成／存档也早就按画布自己的大小与位移走）。
   ① 置图（layer.addImageFromURL、拖入／贴上、云盘引用载入）只开放置矩形那么大；
   ② 载档遇到大部分透明的旧层，裁到不透明内容的外框（位移记进 L.x/L.y，画面一模一样）；
   ③ 统一入口 LayerBox.ensureCovers(L, 文件矩形)：要写到画布外就先把画布（连同跟着图层走的蒙版）长大；
      会往层上「加」像素的命令（GROW_CMDS）与滑鼠工具（GROW_TOOLS）动手前先长到盖住整份文件（＝旧版的样子，旧码一行不用改也不会截笔画），
      做完（命令跑完／放开滑鼠）再裁回「长大前那块∪内容外框」（settle：只在原画布里画就跟原本一样大、位移不跳）；什么都没写就原样换回长大前那张画布（票号不变＝素材引用、存档沿用都不受影响）。
   ④ 存档本来就存画布那块＋x/y ⇒ 只存内容那块；读旧格式照旧（画布照 PNG 真尺寸开）。
   只裁「单纯像素层」（plain：没有蒙版／滤镜蒙版／向量蒙版、不是调整／填充／视频／3D 层）——那几种的画布与整份文件对齐，原样不动。 */
const LayerBox = {
  pending: new Map(),          // 这次操作长大过的层 → 长大前的样子 {canvas, ctx, x, y, gx, gy, tok, masks}
  _boxCache: new Map(),        // 像素票号 → 外框（票号没变＝像素没变＝外框不变；undo 换新画布但票号照抄，照样命中）
  growable(L){ return !!(L && L.kind === 'raster' && L.data && L.data.canvas && !L.adjust && !L.fillLayer && !L.video && !L.d3 && !L._sigSkip); },
  plain(L){ return this.growable(L) && !L.mask && !L.maskOff && !L.filterMask && !L.vmask && L.maskLinked !== false && !L.maskAnchor; },
  /* 画布 c 里 alpha>0 的外框 [x0,y0,x1,y1]（画布坐标；全透明＝null）。按条带读：上下左右各自从外往内扫到第一个有像素的地方就停
     ⇒ 整张不透明的层只读四条边，大片透明的层最多读一遍 */
  alphaBox(c){
    const w = c.width, h = c.height; if (!w || !h) return null;
    const tok = PX.tok(c), key = tok === undefined ? null : tok + '@' + w + 'x' + h;
    if (key && this._boxCache.has(key)){ const b = this._boxCache.get(key); return b ? b.slice() : null; }
    const put = b => { if (!key) return; this._boxCache.set(key, b); if (this._boxCache.size > 1024) this._boxCache.delete(this._boxCache.keys().next().value); };
    const x = c.getContext('2d', {willReadFrequently:true});
    const rows = (y0, n) => new Uint32Array(x.getImageData(0, y0, w, n).data.buffer);
    const S = 32;
    let top = -1, bot = -1;
    for (let y = 0; y < h && top < 0; y += S){ const n = Math.min(S, h - y), d = rows(y, n); for (let i = 0; i < d.length; i++) if (d[i] >>> 24){ top = y + ((i / w) | 0); break; } }
    if (top < 0){ put(null); return null; }
    for (let y = h; y > top && bot < 0; y -= S){ const y0 = Math.max(top, y - S), d = rows(y0, y - y0); for (let i = d.length - 1; i >= 0; i--) if (d[i] >>> 24){ bot = y0 + ((i / w) | 0); break; } }
    const hh = bot - top + 1, cols = (x0, n) => new Uint32Array(x.getImageData(x0, top, n, hh).data.buffer);
    let lft = -1, rgt = -1;
    for (let x0 = 0; x0 < w && lft < 0; x0 += S){ const n = Math.min(S, w - x0), d = cols(x0, n); let m = n; for (let i = 0; i < d.length; i++) if (d[i] >>> 24){ const k = i % n; if (k < m) m = k; } if (m < n) lft = x0 + m; }
    for (let x1 = w; x1 > lft && rgt < 0; x1 -= S){ const x0 = Math.max(lft, x1 - S), n = x1 - x0, d = cols(x0, n); let m = -1; for (let i = 0; i < d.length; i++) if (d[i] >>> 24){ const k = i % n; if (k > m) m = k; } if (m >= 0) rgt = x0 + m; }
    const box = [lft, top, rgt + 1, bot + 1];
    put(box);
    return box.slice();
  },
  _mk(w, h){ const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return {canvas:c, ctx:c.getContext('2d', {willReadFrequently:true})}; },
  _maskWhite(M){ return typeof M.defaultColor === 'number' ? M.defaultColor >= 128 : !!(window.PsMaskFill && PsMaskFill.white && PsMaskFill.white(M)); },
  /* 🔴 统一入口：让像素层 L 的画布盖住文件矩形 r=[x0,y0,x1,y1]（只长不缩；已有像素原位不动、位移整数格对齐）。
     跟着图层走的像素蒙版（蒙版画布＝图层画布那么大）一起长，新长出来的地方照蒙版预设色补（显示全部＝白）。回长大前的样子（没长＝null） */
  ensureCovers(L, r){
    if (!this.growable(L) || !r) return null;
    const c = L.data.canvas, w = c.width, h = c.height;
    const l = Math.max(0, Math.ceil(L.x - r[0])), t = Math.max(0, Math.ceil(L.y - r[1]));
    const rr = Math.max(0, Math.ceil(r[2] - (L.x + w))), b = Math.max(0, Math.ceil(r[3] - (L.y + h)));
    if (!l && !t && !rr && !b) return null;
    const rec = {canvas:c, ctx:L.data.ctx, x:L.x, y:L.y, tok:undefined, masks:[]};
    const n = this._mk(w + l + rr, h + t + b);
    n.ctx.drawImage(c, l, t);
    ['mask', 'maskOff'].forEach(k => {
      const M = L[k];
      if (!M || M.kind !== 'raster' || !M.data || !M.data.canvas || L.maskLinked === false) return;
      const mc = M.data.canvas; if (mc.width !== w || mc.height !== h) return;   // 不是贴在图层画布上的蒙版：不动
      const m = this._mk(n.canvas.width, n.canvas.height);
      if (this._maskWhite(M)){ m.ctx.fillStyle = '#ffffff'; m.ctx.fillRect(0, 0, m.canvas.width, m.canvas.height); m.ctx.clearRect(l, t, w, h); }
      m.ctx.drawImage(mc, l, t);
      rec.masks.push({M, data:M.data, grown:m.canvas, tok:PX.tok(m.canvas)});
      M.data = m; Layer.invalidate(M);
    });
    L.data.canvas = n.canvas; L.data.ctx = n.ctx;
    L.x -= l; L.y -= t;
    rec.gx = L.x; rec.gy = L.y; rec.tok = PX.tok(n.canvas); rec.grown = n.canvas;
    Layer.invalidate(L); L._scaled = null;
    return rec;
  },
  docRect(){ return [0, 0, Doc.width, Doc.height]; },
  /* 动手前：长到盖住整份文件（＝旧版每层都是整张文件大的样子），记进 pending 等 settle 收 */
  grow(L, r){
    if (L && (L._maskSwap || Doc.maskEdit === L.id)) return;   // 正在画蒙版（ps-layer MaskSwap 把 L.data 换成蒙版灰阶）：不长——层外本来就没像素可露，长了蒙版会跟图层画布错位
    if (this.pending.has(L)) { this.ensureCovers(L, r || this.docRect()); return; }
    const rec = this.ensureCovers(L, r || this.docRect());
    if (rec) this.pending.set(L, rec);
  },
  /* 裁到内容外框（只裁单纯像素层）；全透明＝留 1×1。keep＝至少留住的文件矩形（长大前那块画布：只在原画布里画的，画布与位移就跟原本一样，
     不会因为画了一笔就缩、位移也不跳——agent／工具记着的图层坐标照旧对）。回有没有裁 */
  trim(L, keep){
    if (!this.plain(L)) return false;
    const c = L.data.canvas;
    let box = this.alphaBox(c);
    if (keep){
      const k = [Math.max(0, Math.round(keep[0] - L.x)), Math.max(0, Math.round(keep[1] - L.y)), Math.min(c.width, Math.round(keep[2] - L.x)), Math.min(c.height, Math.round(keep[3] - L.y))];
      if (k[2] > k[0] && k[3] > k[1]) box = box ? [Math.min(box[0], k[0]), Math.min(box[1], k[1]), Math.max(box[2], k[2]), Math.max(box[3], k[3])] : k;
    }
    if (box && box[0] === 0 && box[1] === 0 && box[2] === c.width && box[3] === c.height) return false;
    if (!box && c.width === 1 && c.height === 1) return false;
    const bw = box ? box[2] - box[0] : 1, bh = box ? box[3] - box[1] : 1;
    const n = this._mk(bw, bh);
    if (box) n.ctx.drawImage(c, -box[0], -box[1]);
    L.data.canvas = n.canvas; L.data.ctx = n.ctx;
    if (box){ L.x += box[0]; L.y += box[1]; }
    Layer.invalidate(L); L._scaled = null;
    return true;
  },
  /* 长大前那块画布（文件坐标；中间被移动过就跟着搬） */
  _keepRect(L, rec){ const dx = L.x - rec.gx, dy = L.y - rec.gy; return [rec.x + dx, rec.y + dy, rec.x + dx + rec.canvas.width, rec.y + dy + rec.canvas.height]; },
  /* 操作收尾（最外层命令跑完、放开滑鼠）：长大过的层——什么都没写就换回原来那张画布（票号不变），写过就裁到内容外框。
     按着滑鼠时不收（工具正握着长大后的画布画预览）。也收 undo／redo 带回来的「长大中被拍进历史」的层（_needTrim） */
  settle(){
    if (typeof Pointer !== 'undefined' && Pointer.down) return;
    if (this.pending.size){
      const list = [...this.pending]; this.pending.clear();
      for (const [L, rec] of list){
        if (!Doc.layers.includes(L) || L.kind !== 'raster' || !L.data) continue;
        if (L.data.canvas === rec.grown && PX.tok(rec.grown) === rec.tok &&
            rec.masks.every(m => (m.M === L.mask || m.M === L.maskOff) && m.M.data && m.M.data.canvas === m.grown && PX.tok(m.grown) === m.tok)){
          L.data.canvas = rec.canvas; L.data.ctx = rec.ctx;
          L.x = rec.x + (L.x - rec.gx); L.y = rec.y + (L.y - rec.gy);       // 中间被移动过：位移照搬
          rec.masks.forEach(m => { m.M.data = m.data; Layer.invalidate(m.M); });
          Layer.invalidate(L); L._scaled = null;
        } else this.trim(L, this._keepRect(L, rec));
      }
    }
    for (const L of Doc.layers) if (L._needTrim){ const k = Array.isArray(L._needTrim) ? L._needTrim : null; delete L._needTrim; this.trim(L, k); }
  },
  /* 会往层上加像素的滑鼠工具（按下就长、放开就收）。只改既有像素的（橡皮擦、加深减淡海绵、锐化、红眼、颜色替换）不必长：画布外本来就没东西 */
  GROW_TOOLS: new Set(['brush', 'pencil', 'mixer', 'clone', 'patternstamp', 'historybrush', 'arthistory', 'bucket', 'gradient', 'smudge', 'blur',
                       'spotheal', 'heal', 'patch', 'contentmove', 'drop3d']),
  /* 会往层上加像素的命令（目标＝p.layerId 缺省当前层）。滤镜／调整／变形（ps-filter Surf、ps-edit writeLayer、ps-image remap）本来就照层自己的范围算、写到外面会自己长 */
  GROW_CMDS: new Set(['paint.stroke', 'paint.fillRect', 'paint.bucket', 'paint.clone', 'brush.stroke', 'bucket.fill', 'clone.stamp', 'gradient.paint',
                      'pencil.stroke', 'spotheal.stroke', 'heal.stroke', 'historybrush.paint', 'blur.stroke', 'smudge.stroke', 'mixer.stroke',
                      'patch.apply', 'patch.usePattern', 'contentmove.apply', 'patternstamp.paint', 'arthistory.paint', 'drop3d.fill',
                      'ps.image.applyImage', 'move.transform']),   // move.transform：像素层就地变形、画布大小不变（tools/move.js）⇒ 先长成整张文件大＝旧版，放大不被截
  /* 工程档的一项是不是单纯像素层（载档时决定要不要裁；调整／填充／视频等栏位在 o.ps2、内嵌档在 o.x2，3D 在 o.d3） */
  plainJSON(o){
    if (!o || o.kind !== 'raster' || o.mask || o.filterMask || o.d3 || o.src) return false;
    const bad = x => x && typeof x === 'object' && ['adjust', 'fillLayer', 'video', 'vmask', 'maskLinked', 'maskAnchor', 'd3', 'mask', 'maskOff', 'filterMask'].some(k => x[k] != null);
    return !bad(o.ps2) && !bad(o.x2) && !bad(o);
  },
  /* 一张解好的图（载档的 PNG）不透明内容的外框：画进一张共用的暂存画布再量（量完 releaseScratch 放掉，免得每层各开一张整张文件大的画布） */
  _scratch: null,
  imageBox(im, w, h){
    let s = this._scratch;
    if (!s){ s = this._scratch = document.createElement('canvas'); s.width = w; s.height = h; }
    else if (s.width < w || s.height < h){ s.width = Math.max(s.width, w); s.height = Math.max(s.height, h); }
    const x = s.getContext('2d', {willReadFrequently:true});
    x.clearRect(0, 0, w, h); x.drawImage(im, 0, 0);
    const keep = {width:s.width, height:s.height};
    // alphaBox 量整张画布：暂存画布可能比这张图大 ⇒ 用一个只看左上 w×h 的代理
    return this.alphaBox({width:w, height:h, getContext:() => x, __proxy:keep});
  },
  /* 存档用的那块（④）：单纯像素层只存不透明内容的外框＋位移（画布本身不动——存档期间改文件会让签名变、宿主又以为有改动）。
     按来源画布票号快取裁好的那张 ⇒ 没改过的层，裁好的画布与它的票号都不变，增量存档照样沿用上次的编码 */
  _views: new Map(),           // 来源像素票号 → {v, gen}（undo 回来的画布票号照抄 ⇒ 沿用同一张裁好的、编码也沿用）
  saveView(L){
    const c = L.data.canvas;
    if (!this.plain(L)) return {canvas:c, dx:0, dy:0};
    const tok = PX.tok(c), key = tok === undefined ? null : tok + '@' + c.width + 'x' + c.height, hit = key && this._views.get(key);
    if (hit){ hit.gen = Project._gen; return hit.v; }
    const box = this.alphaBox(c);
    let v;
    if ((box && box[0] === 0 && box[1] === 0 && box[2] === c.width && box[3] === c.height) || (!box && c.width === 1 && c.height === 1)) v = {canvas:c, dx:0, dy:0};
    else {
      const n = this._mk(box ? box[2] - box[0] : 1, box ? box[3] - box[1] : 1);
      if (box) n.ctx.drawImage(c, -box[0], -box[1]);
      v = {canvas:n.canvas, dx:box ? box[0] : 0, dy:box ? box[1] : 0};
    }
    // ⛔ 整张就是内容（v.canvas＝这层正在用的画布本身）不快取：画布之后会被画、undo 又换回别张——快取指着活画布 ⇒ undo 后存档存成画过的那张（网站 drawboard-tabs 题抓到）
    if (key && v.canvas !== c) this._views.set(key, {v, gen:Project._gen});
    return v;
  },
  pruneViews(gen){ for (const [k, e] of this._views) if (e.gen < gen - 1) this._views.delete(k); },
  releaseScratch(){ if (this._scratch){ this._scratch.width = 0; this._scratch.height = 0; this._scratch = null; } },
  cmdTarget(id, p){
    if (!this.GROW_CMDS.has(id)) return null;
    const L = p && (p.layerId || p.layer) ? Doc.byId(p.layerId || p.layer) : Doc.active();
    return L && L.kind === 'raster' ? L : null;
  }
};
window.LayerBox = LayerBox;

/* ───────── 形状（向量层的内容）─────────
   每个 shape 与分辨率无关，画的时候乘 scale。
   type: rect | ellipse | star | polygon | path | line
*/
/* 文字层的行距：data.leading（基线到基线，文件像素）有给就用，缺省＝字号×1.25 */
function textLineH(d){ const v = +d.leading; return v > 0 ? v : d.size * 1.25; }
function drawShape(ctx, s, scale){
  if (window.ObjRender && ObjRender.handles(s)){ ObjRender.draw(ctx, s, scale); return; }   // 隐藏／编组／剪切组／复合路径（menus/impl/ai-object.js 照 vectorcraft object.rs）
  if (s.type === 'mesh'){ if (window.MeshRender) MeshRender.draw(ctx, s, scale); return; }   // 渐变网格（tools/mesh.js 照 vectorcraft render/live.rs 着色）
  ctx.save();
  const S = scale;
  ctx.beginPath();
  if (s.type === 'rect'){
    const r = (s.radius||0)*S;
    const x=s.x*S, y=s.y*S, w=s.w*S, h=s.h*S;
    if (r > 0 && ctx.roundRect) ctx.roundRect(x,y,w,h,r); else ctx.rect(x,y,w,h);
  } else if (s.type === 'ellipse'){
    ctx.ellipse((s.x+s.w/2)*S,(s.y+s.h/2)*S, Math.abs(s.w/2)*S, Math.abs(s.h/2)*S, 0,0,Math.PI*2);
  } else if (s.type === 'star' || s.type === 'polygon'){
    const n = s.points || (s.type==='star'?5:6);
    const r1 = s.r1*S, r2 = (s.type==='star' ? s.r2*S : r1);
    const rot = (s.rotation||0)*Math.PI/180 - Math.PI/2;
    const steps = s.type==='star' ? n*2 : n;
    for (let i=0;i<steps;i++){
      const r = (s.type==='star' && i%2) ? r2 : r1;
      const a = rot + i*Math.PI*2/steps;
      const px = s.cx*S + Math.cos(a)*r, py = s.cy*S + Math.sin(a)*r;
      i ? ctx.lineTo(px,py) : ctx.moveTo(px,py);
    }
    ctx.closePath();
  } else if (s.type === 'path' || s.type === 'line'){
    const p = s.points || [];
    p.forEach((pt,i)=>{ const x=pt[0]*S, y=pt[1]*S; i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
    if (s.closed) ctx.closePath();
  } else if (s.type === 'bezier'){
    bezierPath(ctx, s, S);
  }
  // fill／stroke 是物件＝渐变（tools/gradient.js 的 GradientFill，照 vectorcraft color/gradient.rs）
  const paintStyle = (p, which) => (p && typeof p === 'object') ? (window.GradientFill ? GradientFill.toCanvas(ctx, s, S, which) : 'rgba(0,0,0,0)') : p;
  if (s.fill && s.fill !== 'none'){ ctx.fillStyle = paintStyle(s.fill, 'fill'); ctx.fill(); }
  if (s.stroke && s.stroke !== 'none' && (s.strokeWidth||0) > 0){
    ctx.strokeStyle = paintStyle(s.stroke, 'stroke'); ctx.lineWidth = s.strokeWidth*S;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  }
  ctx.restore();
}

/* 钢笔路径（贝兹）：anchors = [{x, y, in:[x,y]|null, out:[x,y]|null}, …]
   in/out 是绝对坐标的把手；两端都没把手的一段就是直线。
   同一支函数给渲染与预览共用，免得画出来和导出不一样。 */
function bezierPath(ctx, s, S){
  const A = s.anchors || []; if (!A.length) return;
  ctx.moveTo(A[0].x*S, A[0].y*S);
  const seg = (p, q) => {
    if (!p.out && !q.in){ ctx.lineTo(q.x*S, q.y*S); return; }
    const c1 = p.out || [p.x, p.y], c2 = q.in || [q.x, q.y];
    ctx.bezierCurveTo(c1[0]*S, c1[1]*S, c2[0]*S, c2[1]*S, q.x*S, q.y*S);
  };
  for (let i = 1; i < A.length; i++) seg(A[i-1], A[i]);
  if (s.closed && A.length >= 2){ seg(A[A.length-1], A[0]); ctx.closePath(); }   // 2 点闭合也有回起点那一段（path.rs:140-159，带把手是透镜形）
}
/* 同一条路径的 SVG 写法（导出用） */
function bezierD(s){
  const A = s.anchors || []; if (!A.length) return '';
  const f = v => +v.toFixed(2);
  let d = `M ${f(A[0].x)} ${f(A[0].y)}`;
  const seg = (p, q) => {
    if (!p.out && !q.in) return ` L ${f(q.x)} ${f(q.y)}`;
    const c1 = p.out || [p.x, p.y], c2 = q.in || [q.x, q.y];
    return ` C ${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(q.x)} ${f(q.y)}`;
  };
  for (let i = 1; i < A.length; i++) d += seg(A[i-1], A[i]);
  if (s.closed && A.length >= 2) d += seg(A[A.length-1], A[0]) + ' Z';
  return d;
}

/* 把一层渲成一块 RGBA（铁律②：不管哪种层，到这一步都变成同一种东西） */
function renderLayer(L, scale){
  const W = Math.max(1, Math.round(Doc.width*scale)), H = Math.max(1, Math.round(Doc.height*scale));

  if (L.kind === 'group'){                               // 组：子层在一张透明画布上合成（隔离；compose lib.rs render_content 的 Group 分支）
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    compositeList(c.getContext('2d'), Groups.children(L), scale);
    return c;
  }
  if (L.kind === 'smart') return Smart.renderAt(L, scale);   // 智能对象：来源→变换→变形→智能滤镜（见 Smart）

  if (L.kind === 'raster'){
    const cv = L.data.canvas;
    if (scale === 1) return cv;                          // 原尺寸直接用
    // 按着拖时（ui.js splitLayer）不是正在变的那层＝这一笔里不会变 ⇒ 缩好的那张沿用到放开（每张大图缩一次约 30ms）
    const live = window.UI && UI._splitLive, gen = window.UI && UI._dragGen;
    if (live && L !== live && L._dragScaled && L._dragScaled.gen === gen && L._dragScaled.scale === scale) return L._dragScaled.c;
    // 缩好的那张按「倍率＋像素票号＋画布尺寸」缓存——
    // 票号没变＝像素一定没变（PX：任何 2D 写入／设尺寸都换票号）⇒ 没改过的层每次重画直接沿用（原本每次重画每层都从整张大画布重缩一次·
    // 20 层 5120×3460 的图一画 4 秒多）。拿不到票号（没写过的空画布）就照旧每次缩。
    const tok = PX.tok(cv), key = tok === undefined ? null : scale + '|' + tok + '|' + cv.width + 'x' + cv.height;
    if (key && L._scaled && L._scaled.key === key) return L._scaled.c;
    // 裁剪「不删除裁剪像素」之后像素层画布可能比文件大：按画布自己的大小缩，位移由 composite 的 L.x*scale 负责
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(cv.width*scale)); c.height = Math.max(1, Math.round(cv.height*scale));
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(cv, 0,0, c.width, c.height);             // 像素层只能插值（本来就有极限）
    L._dragScaled = live && L !== live ? {gen, scale, c} : null;
    L._scaled = key ? {key, c} : null;
    return c;
  }

  // 修饰文字工具改过字的文字层：逐字照各字变形画（tools/touchtype.js）
  if (L.kind === 'text' && window.TouchType && TouchType.touched(L)) return TouchType.renderTouch(L, scale);
  // 向量 / 文字：按 scale 重画（铁律①）——缓存命中就复用（铁律③）
  if (L._cache && L._cacheScale === scale) return L._cache;
  const c = document.createElement('canvas'); c.width=W; c.height=H;
  const x = c.getContext('2d');
  x.translate(L.x*scale, L.y*scale);
  if (L.kind === 'vector'){
    L.data.shapes.forEach(s => drawShape(x, s, scale));
  } else if (L.kind === 'text'){
    const d = L.data;
    x.fillStyle = d.color;
    x.font = `${d.weight||'normal'} ${d.size*scale}px ${d.font}`;
    x.textAlign = d.align; x.textBaseline = 'alphabetic';
    // 段落文字在框内自动折行由文字工具提供（TypeTool.wrapLines）；没载入就只按换行切
    const lines = (window.TypeTool && TypeTool.wrapLines) ? TypeTool.wrapLines(d) : String(d.text).split('\n');
    lines.forEach((line,i)=>{
      x.fillText(line, d.x*scale, (d.y + i*textLineH(d))*scale);
    });
  }
  L._cache = c; L._cacheScale = scale;
  return c;
}

/* 合成整份文件（铁律②：统一的合成模型，遮罩对两种层一视同仁） */
function composite(scale, target){
  const W = Math.max(1, Math.round(Doc.width*scale)), H = Math.max(1, Math.round(Doc.height*scale));
  const out = target || document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  ctx.clearRect(0,0,W,H);
  const live = window.UI && target && target === UI.canvas ? UI._splitLive : null;
  if (live){                                   // 按着拖、只有 live 这层在变（ui.js splitLayer）：底下各层这一笔只合成一次
    const list = Doc.layers, i = list.indexOf(live), below = list.slice(0, i);
    const sig = UI._dragGen + '|' + scale + '|' + live.id + '|' + below.map(l => [l.id, l.visible, l.opacity, l.blend, l.fillOpacity, !!l._proxyHide, l.blendIf ? JSON.stringify(l.blendIf) : ''].join(':')).join(',');
    let b = UI._belowCache;
    if (!b || b.sig !== sig || b.c.width !== W || b.c.height !== H){
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      compositeList(c.getContext('2d'), below, scale);
      b = UI._belowCache = {sig, c};
    }
    ctx.drawImage(b.c, 0, 0);
    compositeList(ctx, list.slice(i), scale);
    return out;
  }
  compositeList(ctx, Groups.any() ? Groups.topLevel() : Doc.layers, scale);   // 没有组＝跟以前一样整排画；有组＝从顶层往下递归
  return out;
}
/* 引擎自己的合成（菜单档会包 window.composite 加东西，例如双色调油墨；智能对象渲染内嵌文件要用没包过的这支） */
const compositeBase = composite;
/* 一串兄弟层由下到上叠进 ctx（组会递归进来） */
function compositeList(ctx, list, scale){
  for (const L of list) compositeOne(ctx, L, scale);
}
function compositeOne(ctx, L, scale){
  if (!L.visible || L.opacity <= 0 || L._proxyHide) return;
  if (L._maskSwap && window.PsLayer && PsLayer.MaskSwap) L = PsLayer.MaskSwap.view(L);   // 正在画蒙版：照真的像素、蒙版用即时灰阶（menus/impl/ps-layer.js）
  if (L.blendIf && !BlendIf.busy.has(L) && BlendIf.enabled(L)) return BlendIf.draw(ctx, L, scale);   // 混合颜色带：慢路径（只有设了的层走）
  if (L.kind === 'group' && Groups.draw(ctx, L, scale)) return;   // 画板／穿透组：自己画完
  const W = ctx.canvas.width, H = ctx.canvas.height;
  let src = renderLayer(L, scale);

  if (L.mask){                                  // 遮罩：任何 kind 都走同一条路
    // 像素层的蒙版贴在该层自己的画布上（同移动工具／链接蒙版）——画布可能比文件大（非破坏裁切留着框外像素·L.x 为负），
    // ⇒ 按画布原尺寸叠、⛔ 拉成文件大小（旧版先把 8 宽缩进文件 4 宽、再按 L.x=-4 移出文件 ⇒ 裁后全透明）
    const raster = L.kind === 'raster';
    const m = document.createElement('canvas'); m.width = raster ? src.width : W; m.height = raster ? src.height : H;
    const mx = m.getContext('2d');
    if (raster) mx.drawImage(src, 0,0); else mx.drawImage(src, 0,0, W,H);
    mx.globalCompositeOperation = 'destination-in';
    if (raster) mx.drawImage(renderLayer(L.mask, scale), 0,0); else mx.drawImage(renderLayer(L.mask, scale), 0,0, W,H);
    src = m;
  }
  if (window.PsLayerStyle && PsLayerStyle.has(L)){ PsLayerStyle.draw(ctx, L, src, scale); return; }   // 图层样式（投影／描边…，menus/impl/ps-layer.js 照 compose/effects.rs）
  // 组的「穿透」走到这里（有蒙版／样式／被拖动中）＝当正常隔离画；混合模式照 PS 公式（blendDraw）
  const off = (L.kind === 'raster' || L.kind === 'group') && (L.x || L.y);
  blendDraw(ctx, src, off ? L.x*scale : 0, off ? L.y*scale : 0, L.blend, L.opacity * (L.fillOpacity === undefined ? 1 : L.fillOpacity));
}
/* ───────── 混合颜色带（PS 图层样式 ▸ 混合选项 ▸ Blend If；照 photocraft doc/src/blend_if.rs、compose/src/lib.rs:930-1012） ─────────
   L.blendIf = {ranges:[[本图层, 下一图层], …]}（＝BlendIf {ranges: Vec<[BlendRange; 2]>}）；ranges[0]＝灰色，之后按文件模式的颜色通道（RGB＝1 红 2 绿 3 蓝）。
   BlendRange＝{black:[低, 高], white:[低, 高]}（0..255；Alt 拖拆开的两半）；FULL＝{black:[0,0], white:[255,255]}；没存的项当 FULL；全是 FULL＝没有（删掉栏位）。
   权重（BlendRange::weight）：ramp(lo,hi,x)＝hi<=lo ? (x>=lo?1:0) : clamp((x-lo)/(hi-lo))；k＝ramp(black0,black1,v)·ramp(255-white1,255-white0,255-v)。
   一格的 k（blend_if_weight）：本图层＝本层自己的颜色（本层该格透明＝不看；调整层没有自己的内容＝看结果）、下一图层＝底下的颜色（底下透明＝不看）；
     RGB：灰＝0.299R+0.587G+0.114B，乘 ranges[0]，再乘 ranges[1..3] 各看 R/G/B；单通道模式（灰度／双色调）：ranges[0]、ranges[1] 都看那一个通道。各项相乘。
   只在 RGB／灰度／双色调文件生效（blend_if_active；其余模式照原码只保存不套用）。
   做法（apply_blend_if）：先记底、照原路径把这层合上去（任何混合模式／样式／剪贴组／组都照旧），再逐格在预乘空间按 k 从底插值到结果——
     各混合模式对来源 alpha 都是线性的 ⇒ ＝「本层 alpha×k 再照原混合模式合」；k=1 的格子原样不动。 */
const BlendIf = {
  busy: new Set(),
  FULL: {black:[0, 0], white:[255, 255]},
  CMD: 'layer.layerStyle.blendingOptions',
  cp(r){ return {black:r.black.slice(), white:r.white.slice()}; },
  isFull(r){ return !r || (r.black[0] === 0 && r.black[1] === 0 && r.white[0] === 255 && r.white[1] === 255); },
  isDefault(bi){ return !bi || !Array.isArray(bi.ranges) || bi.ranges.every(p => p.every(r => this.isFull(r))); },
  get(bi, i){ const p = bi && Array.isArray(bi.ranges) ? bi.ranges[i] : null; return p ? [this.cp(p[0]), this.cp(p[1])] : [this.cp(this.FULL), this.cp(this.FULL)]; },
  /* BlendIf::set：不够长补 FULL、尾端全 FULL 的项剪掉；回新物件（不改原物件——历史快照共用旧的） */
  set(bi, i, pair){
    const ranges = bi && Array.isArray(bi.ranges) ? bi.ranges.map(p => [this.cp(p[0]), this.cp(p[1])]) : [];
    while (ranges.length <= i) ranges.push([this.cp(this.FULL), this.cp(this.FULL)]);
    ranges[i] = [this.cp(pair[0]), this.cp(pair[1])];
    while (ranges.length && ranges[ranges.length - 1].every(r => this.isFull(r))) ranges.pop();
    return {ranges};
  },
  toBytes(r){ return [r.black[0], r.black[1], r.white[0], r.white[1]]; },
  fromBytes(b){ return {black:[b[0], b[1]], white:[b[2], b[3]]}; },
  weight(r, v){
    const ramp = (lo, hi, x) => hi <= lo ? (x >= lo ? 1 : 0) : Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
    return ramp(r.black[0], r.black[1], v) * ramp(255 - r.white[1], 255 - r.white[0], 255 - v);
  },
  mode(){ return Doc.mode || 'rgb'; },
  /* ColorMode::color_channels */
  colorChannels(mode){ return ['bitmap', 'grayscale', 'duotone'].includes(mode) ? 1 : mode === 'cmyk' ? 4 : 3; },
  channelNames(mode){ return mode === 'rgb' || mode === 'indexed' ? ['red', 'green', 'blue'] : mode === 'cmyk' ? ['cyan', 'magenta', 'yellow', 'black'] : mode === 'lab' ? ['lightness', 'a', 'b'] : []; },
  /* blend_if_channel：数字＝索引（<= 通道数）；名字 gray/grey＝0（单通道文件＝1）、其余按模式的通道名 */
  channelIndex(v, mode){
    const n = this.colorChannels(mode);
    if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= n ? v : null;
    const name = (typeof v === 'string' ? v : 'gray').toLowerCase();
    if (name === 'gray' || name === 'grey') return n === 1 ? 1 : 0;
    const i = this.channelNames(mode).indexOf(name);
    return i < 0 ? null : i + 1;
  },
  /* blend_range：[黑, 白]（没拆）或 [黑低, 黑高, 白低, 白高]，0..255、递增 */
  range(v){
    if (!Array.isArray(v)) return null;
    const n = v.map(x => typeof x === 'number' && x >= 0 && x <= 255 ? Math.round(x) : NaN);
    if (n.some(x => Number.isNaN(x))) return null;
    const q = n.length === 2 ? [n[0], n[0], n[1], n[1]] : n.length === 4 ? n : null;
    if (!q) return null;
    for (let i = 1; i < 4; i++) if (q[i - 1] > q[i]) return null;
    return this.fromBytes(q);
  },
  /* blend_if_entries：null＝重设；物件或物件阵列 {channel, thisLayer?, underlying?}；回 null 或 [[索引, 本图层|null, 下一图层|null]]；不合法 throw */
  entries(v, mode){
    if (v === null) return null;
    const items = Array.isArray(v) ? v : (typeof v === 'object' ? [v] : null);
    if (!items) throw new Error(this.CMD + ': blendIf: expected an object, a list of objects or null');
    return items.map(it => {
      if (!it || typeof it !== 'object' || Array.isArray(it)) throw new Error(this.CMD + ': blendIf: expected an object, a list of objects or null');
      const ch = it.channel === undefined ? null : it.channel;
      const i = this.channelIndex(ch, mode);
      if (i === null) throw new Error(`${this.CMD}: blendIf: unknown channel ${JSON.stringify(ch)} for a ${mode} document`);
      const rng = key => {
        if (it[key] === undefined) return null;
        const r = this.range(it[key]);
        if (!r) throw new Error(`${this.CMD}: blendIf.${key}: expected [black, white] or [blackLow, blackHigh, whiteLow, whiteHigh], 0..255, in increasing order (got ${JSON.stringify(it[key])})`);
        return r;
      };
      return [i, rng('thisLayer'), rng('underlying')];
    });
  },
  /* 套到层上（只给一边就留另一边）；null＝回缺省 */
  applyEntries(L, ents){
    if (ents === null){ delete L.blendIf; return; }
    let bi = L.blendIf || {ranges:[]};
    for (const [i, t, u] of ents){ const cur = this.get(bi, i); bi = this.set(bi, i, [t || cur[0], u || cur[1]]); }
    if (this.isDefault(bi)) delete L.blendIf; else L.blendIf = bi;
  },
  /* inspect.rs：[{channel:索引, thisLayer:[4], underlying:[4]}]（只列有设的项）；没有＝null */
  inspect(bi){
    if (this.isDefault(bi)) return null;
    return bi.ranges.map((p, i) => [p, i]).filter(([p]) => !p.every(r => this.isFull(r)))
      .map(([p, i]) => ({channel:i, thisLayer:this.toBytes(p[0]), underlying:this.toBytes(p[1])}));
  },
  /* blend_if_active */
  enabled(L){ return !!(L && L.blendIf) && ['rgb', 'grayscale', 'duotone'].includes(this.mode()) && !this.isDefault(L.blendIf); },
  /* 有设到的项 → [[索引, 边(0 本图层／1 下一图层), BlendRange]]，FULL 的项不算（weight 恒 1） */
  plan(bi){
    const out = [];
    (bi.ranges || []).forEach((p, i) => p.forEach((r, side) => { if (!this.isFull(r)) out.push([i, side, r]); }));
    return out;
  },
  /* blend_if_weight：t／u＝本层／底下那格的 [r,g,b]（0..255，null＝不看） */
  weightOf(plan, one, d, i, side){
    let k = 1;
    const r = d[i], g = d[i + 1], b = d[i + 2], gray = Math.round((0.299 * r + 0.587 * g + 0.114 * b) * 1e4) / 1e4;   // 去浮点尾差（128 灰算出 127.…）
    for (const [ci, s, R] of plan){
      if (s !== side) continue;
      const v = one ? r : ci === 0 ? gray : d[i + ci - 1];
      if (one && ci > 1) continue;
      k *= this.weight(R, v);
      if (k <= 0) return 0;
    }
    return k;
  },
  /* 本层自己的像素（文件空间 W×H、已过像素蒙版、没混合；compose render_content） */
  content(L, scale, W, H){
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', {willReadFrequently:true});
    const src = renderLayer(L, scale), R = L.kind === 'raster';
    const at = (R || L.kind === 'group') && (L.x || L.y) ? [L.x * scale, L.y * scale] : [0, 0];
    if (L.mask){
      const m = document.createElement('canvas'); m.width = R ? src.width : W; m.height = R ? src.height : H;
      const mx = m.getContext('2d');
      if (R){ mx.drawImage(src, 0, 0); mx.globalCompositeOperation = 'destination-in'; mx.drawImage(renderLayer(L.mask, scale), 0, 0); }
      else { mx.drawImage(src, 0, 0, W, H); mx.globalCompositeOperation = 'destination-in'; mx.drawImage(renderLayer(L.mask, scale), 0, 0, W, H); }
      x.drawImage(m, at[0], at[1]);
    } else x.drawImage(src, at[0], at[1]);
    return x.getImageData(0, 0, W, H).data;
  },
  /* apply_blend_if：before＝底（没这层）、img＝合上这层之后（ImageData，就地改）；ownFn()＝本层像素（懒取）。回有没有改到 */
  apply(L, before, img, ownFn){
    const a = img.data, plan = this.plan(L.blendIf), one = this.colorChannels(this.mode()) === 1;
    const useThis = plan.some(p => p[1] === 0), useUnder = plan.some(p => p[1] === 1);
    let own = undefined, touched = false;
    for (let i = 0; i < a.length; i += 4){
      if (a[i] === before[i] && a[i + 1] === before[i + 1] && a[i + 2] === before[i + 2] && a[i + 3] === before[i + 3]) continue;   // 这层没动到的格：插值也不变
      let k = 1;
      if (useThis){
        if (own === undefined) own = L.adjust ? null : ownFn();      // 调整层没有自己的内容：看结果
        if (!own) k *= this.weightOf(plan, one, a, i, 0);
        else if (own[i + 3] > 0) k *= this.weightOf(plan, one, own, i, 0);
      }
      if (k > 0 && useUnder && before[i + 3] > 0) k *= this.weightOf(plan, one, before, i, 1);
      if (k >= 1) continue;
      touched = true;
      const ab = before[i + 3] / 255, ap = a[i + 3] / 255, al = ab + (ap - ab) * k;
      if (al <= 0){ a[i] = a[i + 1] = a[i + 2] = a[i + 3] = 0; continue; }
      for (let c = 0; c < 3; c++) a[i + c] = (before[i + c] * ab + (a[i + c] * ap - before[i + c] * ab) * k) / al;
      a[i + 3] = al * 255;
    }
    return touched;
  },
  /* composite_layer：记底 → 照原路径合 → 套混合颜色带 */
  draw(ctx, L, scale){
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const before = ctx.getImageData(0, 0, W, H).data;
    this.busy.add(L);
    try { compositeOne(ctx, L, scale); } finally { this.busy.delete(L); }
    const img = ctx.getImageData(0, 0, W, H);
    if (this.apply(L, before, img, () => this.content(L, scale, W, H))) ctx.putImageData(img, 0, 0);
  }
};
window.BlendIf = BlendIf;
/* 组的合成（compose/src/lib.rs:1013 composite_layer_any、1027 composite_artboard、1049 composite_layer_plain 的穿透分支）：
   画板 ⇒ 板子范围内先铺背景、再画组，板外不动；
   穿透（填充 100%、没有图层样式、没被拖动）⇒ 子层直接画进底下（调整层能调到组外面的层）；不透明度 < 100% 或有蒙版 ⇒ 画完再按 不透明度×蒙版 跟原底混；
   其余（正常等混合模式）⇒ 回 false，由 compositeOne 当一张隔离的图（renderLayer 的组分支）照常叠。 */
Object.assign(Groups, {
  passThrough(G){
    return G.blend === 'passThrough' && (G.fillOpacity === undefined || G.fillOpacity >= 1) && !G.x && !G.y &&
           !(window.PsLayerStyle && PsLayerStyle.has(G));
  },
  draw(ctx, G, scale){
    const A = G.data && G.data.artboard;
    if (A && Array.isArray(A.rect)){
      const W = ctx.canvas.width, H = ctx.canvas.height;
      const x0 = Math.max(0, Math.round(A.rect[0] * scale)), y0 = Math.max(0, Math.round(A.rect[1] * scale));
      const x1 = Math.min(W, Math.round((A.rect[0] + A.rect[2]) * scale)), y1 = Math.min(H, Math.round((A.rect[1] + A.rect[3]) * scale));
      if (x1 <= x0 || y1 <= y0) return true;
      const sub = document.createElement('canvas'); sub.width = W; sub.height = H;
      const sx = sub.getContext('2d');
      sx.drawImage(ctx.canvas, 0, 0);                                 // 板内先拷底下（画板跟穿透组一样叠在底下的层上）
      const bg = this.artboardColor(A.background);
      if (bg){ sx.save(); sx.fillStyle = bg; sx.fillRect(x0, y0, x1 - x0, y1 - y0); sx.restore(); }
      if (!this.drawPlain(sx, G, scale)){                             // 不是穿透：当一张隔离的图叠上去（蒙版／样式照常）
        const keep = G.data.artboard; G.data.artboard = null;
        try { compositeOne(sx, G, scale); } finally { G.data.artboard = keep; }
      }
      ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
      ctx.drawImage(sub, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      return true;
    }
    return this.drawPlain(ctx, G, scale);
  },
  /* 穿透组：子层直接画进 ctx；要混（不透明度／蒙版）就先记底、画完按 k＝不透明度×蒙版 逐格混（预乘） */
  drawPlain(ctx, G, scale){
    if (!this.passThrough(G)) return false;
    const kids = this.children(G);
    const needMix = G.opacity < 1 || !!G.mask;
    if (!needMix){ compositeList(ctx, kids, scale); return true; }
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const before = ctx.getImageData(0, 0, W, H);
    compositeList(ctx, kids, scale);
    const after = ctx.getImageData(0, 0, W, H), a = before.data, b = after.data;
    let mv = null;
    if (G.mask){ const m = document.createElement('canvas'); m.width = W; m.height = H; const mx = m.getContext('2d'); mx.drawImage(renderLayer(G.mask, scale), 0, 0, W, H); mv = mx.getImageData(0, 0, W, H).data; }
    for (let i = 0; i < b.length; i += 4){
      const k = G.opacity * (mv ? mv[i + 3] / 255 : 1);
      if (k >= 1) continue;
      const wa = a[i + 3] / 255 * (1 - k), wb = b[i + 3] / 255 * k, al = wa + wb;
      if (al <= 0){ b[i] = b[i + 1] = b[i + 2] = b[i + 3] = 0; continue; }
      for (let c = 0; c < 3; c++) b[i + c] = (a[i + c] * wa + b[i + c] * wb) / al;
      b[i + 3] = al * 255;
    }
    ctx.putImageData(after, 0, 0);
    return true;
  },
  /* ArtboardBackground（doc/src/comps.rs:112）：white／black／transparent／自订色 */
  artboardColor(bg){
    if (bg === undefined || bg === null || bg === 'white') return '#ffffff';
    if (bg === 'black') return '#000000';
    if (bg === 'transparent') return null;
    return typeof bg === 'string' ? bg : '#ffffff';
  },
  /* 一串层（可含组）压成一张文件大小的画布（合并／拼合／转换为智能对象用） */
  flatten(list, scale, under){
    scale = scale || 1;
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(Doc.width * scale)); c.height = Math.max(1, Math.round(Doc.height * scale));
    const x = c.getContext('2d');
    if (under){ x.fillStyle = under; x.fillRect(0, 0, c.width, c.height); }
    compositeList(x, list, scale);
    return c;
  }
});

/* ───────── 智能对象（照 photocraft engine/src/smart_cmds.rs 全档） ─────────
   L.kind='smart'，L.data＝{source:{id, name, type}（嵌入档／链接档在 SmartStore 里）, transform:[a,b,c,d,e,f]（来源像素 → 图层坐标；渲染时再加 L.x/L.y）,
     ops:[{type:'warp', params, at:[x,y]} | {type:'affine', m:[6], at:[x,y]} | {type:'persp', rect:[x0,y0,x1,y1], quad:[[x,y]×4], at:[x,y]}]
       （变形／自由变换／扭曲透视，文件坐标、记下当时的 L.x/L.y，层被移动就跟着平移；最后一步是 persp／warp 时变换框、变形模式、拆分变形改的就是它，见 Smart.tail）,
     filters:[{command, params, blend, opacity, visible}]（智能滤镜，由下到上）, filtersEnabled, stackMode:null|'mean'|…}
   L.filterMask＝滤镜蒙版（跟图层蒙版同一种 raster 物件，多 enabled、x/y＝建立时的图层位移）。
   渲染管线（smart_cmds.rs:9-14）：来源 ──合成（或堆栈统计）──► 来源图 ──transform＋位移──► placed ──ops──► ──每个看得见的滤镜，按混合／不透明度叠──► 滤镜蒙版混回 ──► 外观（快取）
   SmartStore：id → {id, name, type:'layers'|'image', w, h, layers?（内嵌文件的图层物件）, image?（画布）, src?:{file_id}（嵌入的图在云盘的那份）, linked?:{url}|{file_id}（链接档）}。
   🔴 内容不可变：换内容（编辑内容、替换内容、重新链接…）＝放一份新的、换 id ⇒ 历史与签名只要记 id，存档按 id 沿用上次的编码（增量）。 */
const SmartStore = {
  map: new Map(), seq: 0,
  newId(){ return 'SO' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + (++this.seq); },
  put(e){ if (!e.id) e.id = this.newId(); e._ver = e._ver || 1; this.map.set(e.id, e); return e; },
  get(id){ return id ? this.map.get(id) || null : null; }
};
const AFF_I = [1, 0, 0, 1, 0, 0];
const affMul = (A, B) => [A[0]*B[0] + A[2]*B[1], A[1]*B[0] + A[3]*B[1], A[0]*B[2] + A[2]*B[3], A[1]*B[2] + A[3]*B[3], A[0]*B[4] + A[2]*B[5] + A[4], A[1]*B[4] + A[3]*B[5] + A[5]];
const Smart = {
  _cache: new Map(), _busy: new Set(), _last: new Map(), _tmp: 0,
  /* 智能滤镜／变形转给哪条命令跑（distort_cmds.rs:180 PUPPET_SMART／PERSPECTIVE_SMART 记成智能滤镜） */
  RUNNERS: {'layer.smartObjects.puppetWarp':'ps.edit.puppetWarp.apply', 'edit.puppetWarp':'ps.edit.puppetWarp.apply',
            'layer.smartObjects.perspectiveWarp':'ps.edit.perspectiveWarp.apply', 'edit.perspectiveWarp':'ps.edit.perspectiveWarp.apply'},
  mk(w, h){ const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; },
  is(L){ return !!(L && L.kind === 'smart'); },
  sourceOf(L){ return SmartStore.get(L && L.data && L.data.source && L.data.source.id); },
  available(e){ return !!e && (e.type === 'image' ? !!e.image : e.type === 'layers' ? Array.isArray(e.layers) : false); },
  /* 内嵌文件暂时当成目前文件（尺寸、图层）跑 fn——合成、堆栈都靠这个；同步跑完就换回来 */
  withSubDoc(e, fn){
    const keep = {w:Doc.width, h:Doc.height, layers:Doc.layers, active:Doc.activeId, sel:Doc.sel};
    Doc.width = e.w; Doc.height = e.h; Doc.layers = e.layers; Doc.sel = null; Doc.activeId = null;
    try { return fn(); }
    finally { Doc.width = keep.w; Doc.height = keep.h; Doc.layers = keep.layers; Doc.activeId = keep.active; Doc.sel = keep.sel; }
  },
  /* 来源图（smart_cmds.rs:159 source_image：解出来合成一张，按内容快取） */
  sourceCanvas(e){
    if (!this.available(e)) return null;
    if (e.type === 'image') return e.image;
    if (!e._comp) e._comp = this.withSubDoc(e, () => compositeBase(1));
    return e._comp;
  },
  /* 堆栈模式（smart_cmds.rs:173 stack_image＋algo/src/stack.rs）：来源的顶层（只有一个组就用组里的层）一层一层单独渲（混合＝正常、不剪贴），逐格逐色版算统计量 */
  STACK: ['entropy', 'kurtosis', 'maximum', 'mean', 'median', 'minimum', 'range', 'skewness', 'standardDeviation', 'summation', 'variance'],
  stackCanvas(e, mode){
    if (!this.available(e)) return null;
    e._stack = e._stack || {};
    if (e._stack[mode]) return e._stack[mode];
    let frames;
    if (e.type === 'image'){ const c = e.image; frames = [c.getContext('2d').getImageData(0, 0, c.width, c.height).data]; }
    else frames = this.withSubDoc(e, () => {
      const T = Groups.tree(); let list = T.of(null);
      if (list.length === 1 && list[0].kind === 'group') list = T.of(list[0].id);
      return list.filter(l => l.visible).map(l => {
        const kb = l.blend, kc = l.clipped; l.blend = 'normal'; l.clipped = false;
        try { const c = Groups.flatten([l], 1); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; }
        finally { l.blend = kb; if (kc === undefined) delete l.clipped; else l.clipped = kc; }
      });
    });
    const c = this.mk(e.w, e.h), x = c.getContext('2d'), img = x.createImageData(c.width, c.height), o = img.data, N = c.width * c.height;
    const sm = [[], [], []];
    for (let i = 0; i < N; i++){
      const j = i * 4; sm[0].length = sm[1].length = sm[2].length = 0; let a = 0;
      for (const f of frames){ if (f[j + 3] > 0){ sm[0].push(f[j] / 255); sm[1].push(f[j + 1] / 255); sm[2].push(f[j + 2] / 255); a = Math.max(a, f[j + 3]); } }
      if (a <= 0) continue;
      for (let ch = 0; ch < 3; ch++) o[j + ch] = Math.round(Math.max(0, Math.min(1, this.stat(sm[ch], mode))) * 255);
      o[j + 3] = a;
    }
    x.putImageData(img, 0, 0);
    return (e._stack[mode] = c);
  },
  /* algo/src/stack.rs:27 stat（母体动差；偏度 −2..2 → 0..1、峰度 0..10 → 0..1、熵＝8 位值的夏农熵 ÷ log2(N)） */
  stat(v, s){
    const n = v.length; if (!n) return 0;
    const mean = v.reduce((a, b) => a + b, 0) / n;
    const m = k => v.reduce((a, x) => a + Math.pow(x - mean, k), 0) / n;
    switch (s){
      case 'mean': return mean;
      case 'summation': return v.reduce((a, b) => a + b, 0);
      case 'minimum': return Math.min(...v);
      case 'maximum': return Math.max(...v);
      case 'range': return Math.max(...v) - Math.min(...v);
      case 'median': { const w = v.slice().sort((a, b) => a - b), k = w.length; return k % 2 ? w[k >> 1] : (w[k / 2 - 1] + w[k / 2]) / 2; }
      case 'variance': return m(2);
      case 'standardDeviation': return Math.sqrt(m(2));
      case 'skewness': { const sd = Math.sqrt(m(2)); return sd < 1e-6 ? 0.5 : Math.max(0, Math.min(1, m(3) / Math.pow(sd, 3) / 4 + 0.5)); }
      case 'kurtosis': { const va = m(2); return va < 1e-12 ? 0 : Math.max(0, Math.min(1, m(4) / (va * va) / 10)); }
      case 'entropy': {
        if (n < 2) return 0;
        const cnt = new Map(); v.forEach(x => { const q = Math.round(Math.max(0, Math.min(1, x)) * 255); cnt.set(q, (cnt.get(q) || 0) + 1); });
        let h = 0; cnt.forEach(c => { const p = c / n; h -= p * Math.log2(p); });
        return h / Math.log2(n);
      }
    }
    return mean;
  },
  /* 来源 → 文件坐标（transform＋L.x/L.y；整数平移是原样贴） */
  placed(L, e){
    const c = this.mk(Doc.width, Doc.height), x = c.getContext('2d');
    const S = e ? (L.data.stackMode ? this.stackCanvas(e, L.data.stackMode) : this.sourceCanvas(e)) : null;
    if (S){
      const t = L.data.transform || AFF_I;
      x.save(); x.setTransform(t[0], t[1], t[2], t[3], t[4] + L.x, t[5] + L.y); x.imageSmoothingQuality = 'high'; x.drawImage(S, 0, 0); x.restore();
    }
    return c;
  },
  /* 一张文件大小的画布当成临时像素层放进文件，跑别的模组的引擎（滤镜、变形）；跑完拿掉、选区／当前层／历史原样还原 */
  runOnTemp(canvas, fn){
    const W = canvas.width, H = canvas.height, c = this.mk(W, H), cx = c.getContext('2d', {willReadFrequently:true});
    cx.drawImage(canvas, 0, 0);
    const T = {id:'__smartTmp' + (++this._tmp), kind:'raster', name:'smart', visible:true, opacity:1, blend:'normal', mask:null, x:0, y:0, _cache:null, _cacheScale:0, data:{canvas:c, ctx:cx}};
    const keep = {sel:Doc.sel, active:Doc.activeId, past:History.past.slice(), future:History.future.slice()};
    Doc.sel = null; Doc.layers.push(T); Doc.activeId = T.id;
    try { fn(T); } catch (err){ console.warn('[智能对象] 滤镜／变形跑不动：', err); }
    finally {
      const i = Doc.layers.indexOf(T); if (i >= 0) Doc.layers.splice(i, 1);
      Doc.sel = keep.sel; Doc.activeId = keep.active;
      History.past.length = 0; History.past.push(...keep.past); History.future.length = 0; History.future.push(...keep.future);
    }
    const out = this.mk(W, H); out.getContext('2d').drawImage(T.data.canvas, T.x || 0, T.y || 0);
    return out;
  },
  canRun(f){
    const via = this.RUNNERS[f.command];
    if (via) return !!CMD.map[via];
    try { return !!(window.PsFilter && (PsFilter.SURF_OPS[f.command] || PsFilter.paramsFor(f.command, f.params || {}))); } catch (e){ return false; }
  },
  applyFilter(canvas, f){
    const cmd = f.command, p = JSON.parse(JSON.stringify(f.params || {}));
    return this.runOnTemp(canvas, T => {
      const via = this.RUNNERS[cmd];
      if (via){ const C = CMD.map[via]; if (C) C.run(Object.assign(p, {layerId:T.id})); return; }
      if (window.PsFilter && (PsFilter.SURF_OPS[cmd] || PsFilter.paramsFor(cmd, p))) PsFilter.run(cmd, Object.assign(p, {layer:T.id}));
      // 认不得的滤镜：像素不动（smart_cmds.rs:280）
    });
  },
  /* smart_cmds.rs:218 blend_surfaces：滤镜结果按混合模式／不透明度叠在前一步上 */
  blendOver(base, top, mode, op){
    const c = this.mk(base.width, base.height), x = c.getContext('2d');
    x.drawImage(base, 0, 0);
    blendDraw(x, top, 0, 0, mode, Math.max(0, Math.min(1, op === undefined ? 1 : op)));
    return c;
  },
  /* smart_cmds.rs:238 mask_mix：滤镜蒙版白＝滤过的、黑＝没滤的（预乘混） */
  maskMix(base, filt, fm, L){
    const W = base.width, H = base.height;
    const m = this.mk(W, H), mx = m.getContext('2d');
    mx.drawImage(fm.data.canvas, (L.x - (fm.x || 0)), (L.y - (fm.y || 0)));
    const k = mx.getImageData(0, 0, W, H).data, b = base.getContext('2d').getImageData(0, 0, W, H).data;
    const out = this.mk(W, H), ox = out.getContext('2d'), fi = filt.getContext('2d').getImageData(0, 0, W, H), f = fi.data;
    for (let i = 0; i < f.length; i += 4){
      const t = k[i + 3] / 255; if (t >= 1) continue;
      const ba = b[i + 3] / 255, fa = f[i + 3] / 255, oa = ba + (fa - ba) * t;
      for (let ch = 0; ch < 3; ch++){ const pm = b[i + ch] * ba + (f[i + ch] * fa - b[i + ch] * ba) * t; f[i + ch] = oa > 0 ? pm / oa : 0; }
      f[i + 3] = oa * 255;
    }
    ox.putImageData(fi, 0, 0);
    return out;
  },
  /* 变形参数平移（层被移动过：记的时候在 at，现在在 L.x/L.y） */
  shiftWarp(p, dx, dy){
    const q = JSON.parse(JSON.stringify(p || {}));
    if (!dx && !dy) return q;
    const mv = a => [a[0] + dx, a[1] + dy];
    if (Array.isArray(q.rect) && q.rect.length === 4) q.rect = [q.rect[0] + dx, q.rect[1] + dy, q.rect[2] + dx, q.rect[3] + dy];
    if (q.warp && Array.isArray(q.warp.bounds)) q.warp.bounds = [q.warp.bounds[0] + dx, q.warp.bounds[1] + dy, q.warp.bounds[2] + dx, q.warp.bounds[3] + dy];
    if (q.warp && q.warp.mesh && Array.isArray(q.warp.mesh.points)) q.warp.mesh.points = q.warp.mesh.points.map(mv);
    if (q.mesh && Array.isArray(q.mesh.points)) q.mesh.points = q.mesh.points.map(mv);
    if (Array.isArray(q.pins)) q.pins = q.pins.map(pin => Object.assign({}, pin, {src:mv(pin.src), dst:mv(pin.dst)}));
    if (Array.isArray(q.planes)) q.planes = q.planes.map(pl => Object.assign({}, pl, {src:pl.src.map(mv), dst:pl.dst.map(mv)}));
    return q;
  },
  applyOp(canvas, op, L){
    const at = op.at || [0, 0], dx = L.x - at[0], dy = L.y - at[1];
    if (op.type === 'affine'){
      const M = op.m, m = [M[0], M[1], M[2], M[3], M[4] + dx - (M[0] * dx + M[2] * dy), M[5] + dy - (M[1] * dx + M[3] * dy)];
      const c = this.mk(canvas.width, canvas.height), x = c.getContext('2d');
      x.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]); x.imageSmoothingQuality = 'high'; x.drawImage(canvas, 0, 0);
      return c;
    }
    if (op.type === 'warp'){
      const C = CMD.map['ps.edit.transform.warp.apply']; if (!C) return canvas;
      const p = this.shiftWarp(op.params, dx, dy);
      return this.runOnTemp(canvas, T => C.run(Object.assign(p, {layerId:T.id})));
    }
    if (op.type === 'persp'){                                       // 扭曲／透视：rect 四角 → quad 的射影（跑 ps-edit 的 edit.transform 重采样）
      const C = CMD.map['ps.edit.transform']; if (!C) return canvas;
      const r = op.rect, quad = op.quad.map(a => [a[0] + dx, a[1] + dy]);
      return this.runOnTemp(canvas, T => C.run({layerId:T.id, rect:[r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy], quad, _quiet:true}));
    }
    return canvas;
  },
  /* 最后一步若是扭曲／透视（persp）或变形（warp）＝「智能对象目前的变换框／变形」：自由变换框、变形模式、拆分变形都改这一步（不再叠一步）。
     回 {op, index, type, rect（现在的文件坐标）, quad?, params?} 或 null */
  tail(L){
    const ops = (L && L.data && L.data.ops) || [], op = ops[ops.length - 1];
    if (!op || (op.type !== 'persp' && op.type !== 'warp')) return null;
    const at = op.at || [0, 0], dx = L.x - at[0], dy = L.y - at[1], t = {op, index:ops.length - 1, type:op.type};
    if (op.type === 'persp'){ t.rect = [op.rect[0] + dx, op.rect[1] + dy, op.rect[2] + dx, op.rect[3] + dy]; t.quad = op.quad.map(a => [a[0] + dx, a[1] + dy]); }
    else { t.params = this.shiftWarp(op.params, dx, dy); t.rect = Array.isArray(t.params.rect) ? t.params.rect.slice() : (t.params.warp && t.params.warp.bounds ? t.params.warp.bounds.slice() : null); }
    return t;
  },
  /* 来源＋变换＋前 n 步（不含智能滤镜）——变换框／变形模式改尾端那步时，预览用「那步之前」的样子 */
  base(L, n){
    const e = this.sourceOf(L);
    let c = this.placed(L, this.available(e) ? e : null);
    const ops = (L.data && L.data.ops) || [];
    for (let i = 0; i < Math.min(n, ops.length); i++) c = this.applyOp(c, ops[i], L);
    return c;
  },
  /* 智能对象的自由变换／扭曲／透视（PS：变换存在智能对象上，换内容后照样套；photocraft transform_cmds.rs:194 只收仿射、扭曲透视原码报「not supported yet」，这里照 PS 补）
     q＝{rect:[x0,y0,x1,y1] 文件坐标, quad?:[[x,y]×4]（左上起顺时针）| matrix?:[a,b,c,d,e,f], tail?:true（变换框是从尾端那步透视开的 ⇒ 改那一步）}
     仿射：没有别的步骤＝并进 transform（下次从来源一次重采样）；有步骤＝记一步 affine。四角不是平行四边形＝记一步 persp。 */
  transform(L, q){
    const d = L.data; d.ops = d.ops || [];
    const rect = Array.isArray(q.rect) && q.rect.length === 4 ? q.rect.map(Number) : null;
    const quad = Array.isArray(q.quad) && q.quad.length === 4 ? q.quad.map(a => [+a[0], +a[1]]) : null;
    if (q.quad && (!quad || quad.some(a => !isFinite(a[0]) || !isFinite(a[1])))) return {ok:false, error:'quad must be [[x,y]×4]'};
    const persp = () => {
      if (!rect || !(rect[2] > rect[0] && rect[3] > rect[1])) return {ok:false, error:'need rect for quad'};
      const same = quad.every((a, i) => { const c = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]][i]; return Math.abs(a[0] - c[0]) < 1e-6 && Math.abs(a[1] - c[1]) < 1e-6; });
      if (!same) d.ops.push({type:'persp', rect:rect.slice(), quad:quad.map(a => a.slice()), at:[L.x, L.y]});
      Layer.invalidate(L);
      return {ok:true, persp:!same, quad};
    };
    if (q.tail && quad){ const t = this.tail(L); if (t && t.type === 'persp'){ d.ops.pop(); return persp(); } }
    let M = q.matrix;
    if (!M){
      if (!rect || !quad) return {ok:false, error:'need quad (with rect) or matrix'};
      const w = rect[2] - rect[0], h = rect[3] - rect[1]; if (!(w > 0 && h > 0)) return {ok:false, error:'the layer is empty'};
      const [q0, q1, q2, q3] = quad;
      if (Math.abs(q1[0] + q3[0] - q0[0] - q2[0]) > 0.5 || Math.abs(q1[1] + q3[1] - q0[1] - q2[1]) > 0.5) return persp();
      const a = (q1[0] - q0[0]) / w, b = (q1[1] - q0[1]) / w, c = (q3[0] - q0[0]) / h, dd = (q3[1] - q0[1]) / h;
      M = [a, b, c, dd, q0[0] - a * rect[0] - c * rect[1], q0[1] - b * rect[0] - dd * rect[1]];
    }
    if (!Array.isArray(M) || M.length !== 6 || M.some(v => !isFinite(v))) return {ok:false, error:'bad matrix'};
    if (!d.ops.length){ d.transform = affMul(M, affMul([1, 0, 0, 1, L.x, L.y], d.transform || AFF_I)); L.x = 0; L.y = 0; }
    else d.ops.push({type:'affine', m:M.slice(), at:[L.x, L.y]});
    Layer.invalidate(L);
    return {ok:true, matrix:M};
  },
  key(L){
    const e = this.sourceOf(L), fm = L.filterMask;
    return JSON.stringify([L.data, L.x, L.y, Doc.width, Doc.height, e ? e._ver : 0]) + '|' + (fm ? PX.tok(fm.data.canvas) + (fm.enabled === false ? 'off' : 'on') + (fm.x || 0) + ',' + (fm.y || 0) : '-') +
           '|' + (window.PsFilter ? 'f' : '') + (CMD.map['ps.edit.transform.warp.apply'] ? 'w' : '') + (CMD.map['ps.edit.transform'] ? 't' : '');
  },
  /* 外观（文件大小、比例 1）——smart_cmds.rs:292 render＋272 apply_smart_filters；按内容快取（undo 回来也命中） */
  render(L){
    const key = this.key(L);
    const hit = this._cache.get(key);
    if (hit){ this._cache.delete(key); this._cache.set(key, hit); this._last.set(L.id, hit); return hit; }
    if (this._busy.has(L.id)) return this._last.get(L.id) || this.mk(Doc.width, Doc.height);   // 滤镜里又要合成整份文件（置换图）：先用上一张
    this._busy.add(L.id);
    try {
      const d = L.data || {}, e = this.sourceOf(L);
      const fl = d.filtersEnabled !== false ? (d.filters || []).filter(f => f && f.visible !== false) : [];
      const fallback = L._fallback && (!this.available(e) || fl.some(f => !this.canRun(f)) || (d.ops || []).some(o => (o.type === 'warp' && !CMD.map['ps.edit.transform.warp.apply']) || (o.type === 'persp' && !CMD.map['ps.edit.transform'])));
      let out;
      if (fallback){ out = this.mk(Doc.width, Doc.height); out.getContext('2d').drawImage(L._fallback, 0, 0); }   // 来源载不到／滤镜引擎没载：用存档里的外观（photocraft 也是留 cache）
      else {
        let placed = this.placed(L, this.available(e) ? e : null);
        for (const op of d.ops || []) placed = this.applyOp(placed, op, L);
        out = placed;
        if (fl.length){
          let cur = placed;
          for (const f of fl){
            const o = this.applyFilter(cur, f);
            cur = ((f.blend || 'normal') === 'normal' && (f.opacity === undefined || f.opacity >= 1)) ? o : this.blendOver(cur, o, f.blend, f.opacity);
          }
          out = (L.filterMask && L.filterMask.enabled !== false) ? this.maskMix(placed, cur, L.filterMask, L) : cur;
        }
      }
      this._cache.set(key, out);
      while (this._cache.size > 12) this._cache.delete(this._cache.keys().next().value);   // 文件大小的画布，最多留 12 张（大图很吃记忆体）
      this._last.set(L.id, out);
      return out;
    } finally { this._busy.delete(L.id); }
  },
  renderAt(L, scale){
    const base = this.render(L);
    if (scale === 1) return base;
    if (L._cache && L._cacheScale === scale && L._cacheBase === base) return L._cache;
    const c = this.mk(Math.round(Doc.width * scale), Math.round(Doc.height * scale)), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high'; x.drawImage(base, 0, 0, c.width, c.height);
    L._cache = c; L._cacheScale = scale; L._cacheBase = base;
    return c;
  },
  /* 一层（与它的子孙）复制成内嵌文件的图层物件（smart_cmds.rs:456 layer_to_smart：这层可见、100%、不剪贴、不锁；穿透组留穿透、其余混合模式改正常） */
  cloneLayers(list){ return list.map(L => History._layerFrom(History._layerSnap(L))); },
  /* layer_to_smart：把一层（组＝连子孙）做成内嵌文件，裁到渲染出来的范围 → {entry, rect:[x,y,w,h]}；空的回 null */
  fromLayer(L){
    const block = L.kind === 'group' ? [...Groups.descendants(L), L] : [L];
    const inner = this.cloneLayers(block), top = inner[inner.length - 1];
    top.visible = true; top.opacity = 1; delete top.clipped; top.locks = null; top.parent = null; delete top.isBackground;
    if (!(top.kind === 'group' && top.blend === 'passThrough')) top.blend = 'normal';
    const e = {type:'layers', name:L.name + '.dlcanvas', w:Doc.width, h:Doc.height, layers:inner};
    const full = this.withSubDoc(e, () => compositeBase(1));
    const d = full.getContext('2d').getImageData(0, 0, full.width, full.height).data, W = full.width;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let i = 3, k = 0; i < d.length; i += 4, k++) if (d[i]){ const x = k % W, y = (k / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    inner.forEach(C => { if (C.kind !== 'group'){ C.x -= x0; C.y -= y0; Layer.invalidate(C); } });   // shift_layer：整棵往左上搬到 (0,0)
    e.w = w; e.h = h;
    const comp = this.mk(w, h); comp.getContext('2d').drawImage(full, -x0, -y0);
    e._comp = comp;                                                 // 先放进快取（smart_cmds.rs:503 cache_put：现成的合成）
    return {entry:SmartStore.put(e), rect:[x0, y0, w, h]};
  },
  /* 一张图（画布）做成内嵌来源 */
  fromImage(canvas, name, extra){
    return SmartStore.put(Object.assign({type:'image', name:name || 'image.png', w:canvas.width, h:canvas.height, image:canvas}, extra || {}));
  },
  /* 智能对象里引用到的全部来源 id（内嵌文件里还有智能对象就往下找） */
  collect(layers, out){
    out = out || new Set();
    for (const L of layers || []){
      if (L.kind !== 'smart') continue;
      const id = L.data && L.data.source && L.data.source.id; if (!id || out.has(id)) continue;
      out.add(id);
      const e = SmartStore.get(id); if (e && e.type === 'layers') this.collect(e.layers, out);
    }
    return out;
  },
  /* 存档时要不要把外观也存（链接档／载不到的来源／有滤镜或变形——这些重开时可能算不回来） */
  needsCache(L){
    const d = L.data || {}, e = this.sourceOf(L);
    if (!e || e.linked || !this.available(e)) return true;
    if (d.filtersEnabled !== false && (d.filters || []).some(f => f && f.visible !== false)) return true;
    return (d.ops || []).some(o => o.type === 'warp' || o.type === 'persp');
  },
  /* 链接档／云盘档 → 网址（{url} 直接用；{file_id} 问宿主 resolveRef，跟素材引用同一条） */
  async resolve(ref){
    if (!ref) return {url:null, error:'没有来源'};
    if (ref.url) return {url:String(ref.url)};
    if (ref.file_id){
      const H = window.__dlSiteHooks;
      if (!H || typeof H.resolveRef !== 'function') return {url:null, error:`智能对象引用云盘素材 file_id=${ref.file_id}，但宿主没提供 window.__dlSiteHooks.resolveRef`};
      try { let u = await H.resolveRef({file_id:String(ref.file_id)}); if (u && typeof u === 'object') u = u.url; return u ? {url:u} : {url:null, error:`resolveRef 没给 file_id=${ref.file_id} 的网址`}; }
      catch (e){ return {url:null, error:String(e && e.message || e)}; }
    }
    return {url:null, error:'来源格式不对（要 {url} 或 {file_id}）'};
  },
  loadImage(url){
    return new Promise((res, rej) => { const im = new Image(); if (!/^(data|blob):/i.test(url)) im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error('图片载入失败：' + String(url).slice(0, 80))); im.src = url; });
  },
  async imageEntry(url, name, extra){
    const im = await this.loadImage(url);
    const c = this.mk(im.naturalWidth || im.width, im.naturalHeight || im.height); c.getContext('2d').drawImage(im, 0, 0);
    return this.fromImage(c, name, extra);
  },

  /* ── 编辑内容（smart_cmds.rs:592 edit_contents 开成新文件；609 commit_child 存回母文件、母文件一步历史）──
     我们一次只有一份文件 ⇒ 暂时把文件换成内嵌档（图层 id 重编，免得跟母文件撞），画面上方一条「正在编辑智能对象内容［完成］［取消］」；
     完成＝内嵌档换成新的一份（新 id）写回那个智能对象；取消＝丢掉。编辑期间网站宿主不收改动事件、存档存的是母文件（进编辑前那一份）。 */
  session: null, _opening: false,
  beginSession(L){
    if (this.session) return {ok:false, error:'already editing smart object contents'};
    const e = this.sourceOf(L);
    if (!this.available(e)) return {ok:false, error:"the smart object's contents are unavailable"};
    let parentJSON = null;
    try { parentJSON = Project.serialize({reuse:true}); } catch (err){ console.error(err); }
    const s = {layerId:L.id, entryId:e.id, parent:History.snap(), past:History.past.slice(), future:History.future.slice(), serial:Doc.serial, parentJSON,
               name:e.name, layerName:L.name, toolKind:Doc.active() ? Doc.active().kind : 'raster'};
    let layers;
    if (e.type === 'layers') layers = this.cloneLayers(e.layers);
    else { const R = Layer.raster(e.name.replace(/\.[^.]*$/, ''), e.w, e.h); R.data.ctx.drawImage(e.image, 0, 0); layers = [R]; }
    // 不叫 Doc.reset（菜单档包在它外面的「开新档」副作用——文件名改成未标题、已存基准清掉…——都不该发生）：只换尺寸、图层，清选取与历史（母文件的历史另外收着）
    Doc.serial++; Doc.width = e.w; Doc.height = e.h; Doc.layers = []; Doc.sel = null; Doc.activeId = null;
    if (window.VecSel) VecSel.clear();
    History.clear();
    const remap = new Map(); layers.forEach(C => { const n = uid('L'); remap.set(C.id, n); C.id = n; });
    layers.forEach(C => { if (C.parent && remap.has(C.parent)) C.parent = remap.get(C.parent); });
    Doc.layers.push(...layers); Doc.activeId = layers.length ? layers[layers.length - 1].id : null;
    this.session = s;
    SiteHooks._suspend++;
    this.banner();
    if (window.UI){ UI.fit(); UI.refresh(); }
    return {ok:true, editing:L.id, document:{width:Doc.width, height:Doc.height, layers:Doc.layers.length}};
  },
  endSession(commit){
    const s = this.session; if (!s) return {ok:false, error:"this document isn't smart object contents"};
    let entry = null;
    if (commit){
      const stem = String(s.name).replace(/\.[^.]*$/, '');
      entry = SmartStore.put({type:'layers', name:stem + '.dlcanvas', w:Doc.width, h:Doc.height, layers:this.cloneLayers(Doc.layers.filter(X => !X._sigSkip))});
    }
    this.session = null;
    this._opening = true;
    try { History.restore(s.parent); } finally { this._opening = false; }
    Doc.serial = s.serial;
    History.past.length = 0; History.past.push(...s.past); History.future.length = 0; History.future.push(...s.future);
    SiteHooks._suspend = Math.max(0, SiteHooks._suspend - 1);
    this.banner();
    const L = Doc.byId(s.layerId);
    if (commit && L && L.kind === 'smart'){
      History.push();
      L.data.source = {id:entry.id, name:entry.name, type:entry.type};
      if (s.shift && L.data.transform){                              // 内容画布在编辑时用「画布大小」加大、内容挪了 ⇒ 变换的平移往回补（外面原来的部分不动、比例不变）
        const t = L.data.transform, [sx, sy] = s.shift;
        L.data.transform = [t[0], t[1], t[2], t[3], t[4] - (t[0] * sx + t[2] * sy), t[5] - (t[1] * sx + t[3] * sy)];
      }
      Layer.invalidate(L);
    }
    if (window.UI){ UI.fit(); UI.refresh(); }
    SiteHooks.check(commit ? 'layer.smartObjects.saveContents' : 'layer.smartObjects.closeContents');
    return {ok:true, updated:!!(commit && L), layer:s.layerId, source:entry ? entry.id : null};
  },
  /* 文件被换掉（开新档、载工程档）时编辑中的内容直接作废 */
  dropSession(){ if (!this.session) return; this.session = null; SiteHooks._suspend = Math.max(0, SiteHooks._suspend - 1); this.banner(); },
  banner(){
    if (typeof document === 'undefined' || !document.body) return;
    let b = document.getElementById('smartEditBar');
    if (!this.session){ if (b) b.remove(); return; }
    if (!b){
      b = document.createElement('div'); b.id = 'smartEditBar';
      b.style.cssText = 'position:fixed;left:50%;top:34px;transform:translateX(-50%);z-index:10000;background:#2f4f7a;color:#fff;padding:5px 10px;border-radius:4px;font:12px sans-serif;display:flex;gap:8px;align-items:center;box-shadow:0 2px 10px rgba(0,0,0,.4)';
      document.body.appendChild(b);
    }
    b.innerHTML = '';
    const t = document.createElement('span'); t.textContent = Lang.t('smart.editing').replace('{name}', this.session.layerName); b.appendChild(t);
    const btn = (k, save) => { const x = document.createElement('button'); x.type = 'button'; x.dataset.act = save ? 'save' : 'cancel'; x.textContent = Lang.t(k);
      x.style.cssText = 'font:12px sans-serif;padding:2px 10px;cursor:pointer';
      x.onclick = () => { const id = save ? 'ps.layer.smartObjects.saveContents' : 'ps.layer.smartObjects.closeContents'; if (CMD.map[id]) CMD.run(id, {}); else this.endSession(save); };
      b.appendChild(x); };
    btn('smart.done', true); btn('smart.cancel', false);
  }
};
window.Smart = Smart; window.SmartStore = SmartStore; window.Groups = Groups; window.compositeList = compositeList;

/* ───────── 历史（第一版：整份快照，够用、以后换成差分） ───────── */
/* 图层菜单（PS 图层菜单实作）加在图层上的栏位：蒙版／停用的蒙版／样式／填充不透明度／锁定／链接组／是否背景层——快照与工程档都要带 */
const LAYER_EXTRA = ['mask','maskOff','style','fillOpacity','locks','linkGroup','isBackground','filterMask','blendIf'];
/* 这几个栏位是蒙版物件（带画布）：快照要整张拷、不能共用 */
const MASK_KEYS = ['mask','maskOff','filterMask'];
/* 素材引用（给网站宿主·见 SiteHooks）：src＝{file_id}；_srcPx＝记 src 时画布的像素票号（票号变了＝像素被改过、src 作废）；
   _place＝置入时画在画布上的矩形 [x,y,w,h]；_placePx＝置入当下的票号（宿主晚一点才回 file_id 时，用它确认像素还没被改） */
const SRC_PROPS = ['src','_srcPx','_place','_placePx'];
function cloneMaskLayer(m){ const c=document.createElement('canvas'); c.width=m.data.canvas.width; c.height=m.data.canvas.height; c.getContext('2d').drawImage(m.data.canvas,0,0); PX.copy(c, m.data.canvas); return Object.assign({}, m, {data:{canvas:c, ctx:c.getContext('2d',{willReadFrequently:true})}, _cache:null, _cacheScale:0}); }
const History = {
  past: [], future: [], limit: 50,   // PS 偏好设定 ▸ 历史记录状态 缺省 50
  _extraProps: true,   // 已带 LAYER_EXTRA（menus/impl/ps-layer.js 的垫片看到这个就不再包一层）
  /* 一层的快照（画布整张拷、其余深拷）；parent＝所在的组（null＝顶层，没有这栏＝旧文件没设过） */
  _layerSnap(L){
    const o = {id:L.id,kind:L.kind,name:L.name,visible:L.visible,opacity:L.opacity,
               blend:L.blend,x:L.x,y:L.y};
    if (L.parent !== undefined) o.parent = L.parent;
    LAYER_EXTRA.forEach(k => { const v = L[k]; if (v != null) o[k] = MASK_KEYS.includes(k) ? cloneMaskLayer(v) : (typeof v==='object' ? JSON.parse(JSON.stringify(v)) : v); });
    if (L.kind === 'raster'){
      const c = document.createElement('canvas');
      c.width=L.data.canvas.width; c.height=L.data.canvas.height;
      c.getContext('2d').drawImage(L.data.canvas,0,0);
      PX.copy(c, L.data.canvas);       // 整张原样拷 ⇒ 票号照抄（undo 后增量序列化还认得）
      o.data = {canvas:c};
      if (LayerBox.pending.has(L)) o._needTrim = LayerBox._keepRect(L, LayerBox.pending.get(L)); else if (L._needTrim) o._needTrim = L._needTrim;   // 滑鼠按下时为了画到外面暂时长成整张文件大 ⇒ undo／redo 回来那张也要再裁回内容外框（LayerBox.settle）
    } else o.data = JSON.parse(JSON.stringify(L.data));
    SRC_PROPS.forEach(k => { if (L[k] !== undefined) o[k] = (L[k] && typeof L[k] === 'object') ? JSON.parse(JSON.stringify(L[k])) : L[k]; });   // 素材引用（src.file_id）随历史走
    if (L._fallback) o._fallback = L._fallback;                      // 智能对象存档里带的外观（来源载不到时用；画布不会被改，存参照）
    return o;
  },
  /* 从快照做出一个新的图层物件（画布另拷一份，不跟快照共用） */
  _layerFrom(o){
    const L = Object.assign(Layer._base(o.kind,o.name), o);
    MASK_KEYS.forEach(k => { if (o[k]) L[k] = cloneMaskLayer(o[k]); });   // 快照里的蒙版画布别跟图层共用
    if (o.kind === 'raster'){
      const c = document.createElement('canvas');
      c.width=o.data.canvas.width; c.height=o.data.canvas.height;
      c.getContext('2d').drawImage(o.data.canvas,0,0);
      PX.copy(c, o.data.canvas);
      L.data = {canvas:c, ctx:c.getContext('2d',{willReadFrequently:true})};
    } else { L.data = JSON.parse(JSON.stringify(o.data)); }
    SRC_PROPS.forEach(k => { if (o[k] !== undefined) L[k] = (o[k] && typeof o[k] === 'object') ? JSON.parse(JSON.stringify(o[k])) : o[k]; });
    L._cache=null; L._cacheScale=0;
    return L;
  },
  snap(){
    return {
      width:Doc.width, height:Doc.height, activeId:Doc.activeId,
      sel: Doc.sel,          // 选区一律整个换掉、不原地改 ⇒ 存参照就够（选区进历史）
      vsel: window.VecSel ? VecSel.snapshot() : null,   // 矢量节点选取也进历史（vectorcraft Selection 随 undo 走）
      aiDoc: window.AiView ? AiView.docSnap() : null,   // AI 标尺参考线／存的视图（menus/impl/ai-view.js）
      globalLight: Doc.globalLight ? {...Doc.globalLight} : null,
      dpi: Doc.dpi,          // 图像大小改了分辨率也要能退（图像菜单）
      layers: Doc.layers.filter(L => !L._sigSkip).map(L => this._layerSnap(L))   // _sigSkip＝暂时的代理层（智能对象操控变形用），不进历史
    };
  },
  restore(s){
    Doc.width=s.width; Doc.height=s.height; Doc.activeId=s.activeId;
    Doc.sel = s.sel || null;
    if (window.AiView) AiView.docRestore(s.aiDoc);
    if (window.VecSel) VecSel.restore(s.vsel || null);
    Doc.globalLight = s.globalLight || undefined; Doc.dpi = s.dpi;
    Doc.layers = s.layers.map(o => this._layerFrom(o));
  },
  /* 原地还原（命令失败回滚用）：图层物件不换新、只把内容写回去——工具与测试手上握着的图层参照仍然有效；形状物件会换（必要的） */
  restoreInPlace(s){
    Doc.width=s.width; Doc.height=s.height; Doc.activeId=s.activeId;
    Doc.sel = s.sel || null;
    if (window.AiView) AiView.docRestore(s.aiDoc);
    if (window.VecSel) VecSel.restore(s.vsel || null);
    const old = new Map(Doc.layers.map(L => [L.id, L]));
    Doc.layers = s.layers.map(o => {
      let L = old.get(o.id);
      if (!L) L = Object.assign(Layer._base(o.kind, o.name), {id:o.id});
      Object.assign(L, {kind:o.kind, name:o.name, visible:o.visible, opacity:o.opacity, blend:o.blend, x:o.x, y:o.y});
      if (o.parent !== undefined) L.parent = o.parent; else delete L.parent;
      LAYER_EXTRA.forEach(k => { if (o[k] !== undefined) L[k] = MASK_KEYS.includes(k) ? cloneMaskLayer(o[k]) : o[k]; else if (k === 'mask') L.mask = null; else delete L[k]; });
      if (o.kind === 'raster'){
        if (!L.data || !L.data.canvas){ const c = document.createElement('canvas'); L.data = {canvas:c, ctx:c.getContext('2d',{willReadFrequently:true})}; }
        L.data.canvas.width = o.data.canvas.width; L.data.canvas.height = o.data.canvas.height;   // 改尺寸顺便清空
        L.data.ctx.drawImage(o.data.canvas, 0, 0);
        PX.copy(L.data.canvas, o.data.canvas);
        if (o._needTrim) L._needTrim = o._needTrim; else delete L._needTrim;
      } else if (L.data && o.kind === 'vector' && L.data.shapes && o.data && o.data.shapes){
        L.data.shapes = JSON.parse(JSON.stringify(o.data.shapes));
      } else { L.data = JSON.parse(JSON.stringify(o.data)); }
      SRC_PROPS.forEach(k => { if (o[k] !== undefined) L[k] = (o[k] && typeof o[k] === 'object') ? JSON.parse(JSON.stringify(o[k])) : o[k]; else delete L[k]; });
      if (o._fallback) L._fallback = o._fallback; else delete L._fallback;
      L._cache=null; L._cacheScale=0;
      return L;
    });
    Doc.globalLight = s.globalLight || undefined; Doc.dpi = s.dpi;
  },
  // 直接叫 History 的地方（菜单对话框等不走 CMD 的）也要让宿主知道：延后一拍比对签名（SiteHooks.later）
  push(){ this.past.push(this.snap()); if (this.past.length>this.limit) this.past.shift(); this.future.length=0; SiteHooks.later('history.push'); },
  undo(){ if(!this.past.length) return false; this.future.push(this.snap()); this.restore(this.past.pop()); SiteHooks.later('edit.undo'); return true; },
  redo(){ if(!this.future.length) return false; this.past.push(this.snap()); this.restore(this.future.pop()); SiteHooks.later('edit.redo'); return true; },
  clear(){ this.past.length=0; this.future.length=0; }
};

/* ───────── 命令注册表 ─────────
   🔴 界面上的每一颗按钮都只是在叫这里的一条命令；
      agent 拿得到的是这整张表，一条不少。 */
const CMD = {
  map: {},
  reg(id, meta, fn){ this.map[id] = Object.assign({id, run:fn}, meta); },
  list(filter){
    return Object.values(this.map)
      .filter(c => !filter || c.id.includes(filter) || (c.label||'').includes(filter) || (c.params||'').includes(filter))
      .map(c => ({id:c.id, label:c.label, i18n:c.i18n, params:c.params||'', undoable:!!c.undoable, group:c.id.split('.')[0]}));
  },
  _depth: 0,             // 命令里再叫命令的层数：图层锁只在最外层（人／agent 直接叫的那条）把关
  /* 最外层那条命令跑完（回 Promise 的等它落定）才比对内容签名：真的改了才 rev++ 发 dl:change（SiteHooks）。
     失败回滚、只动选区、没改到东西的 ⇒ 签名不变 ⇒ 不发。 */
  run(id, params){
    if (this._depth !== 0) return this._run(id, params);
    let r;
    // 命令动手前长大过的像素层（LayerBox.grow）在这里收回内容外框——要在比对签名（SiteHooks.after）之前，存档／改动事件看到的才是收好的样子
    const done = () => { try { LayerBox.settle(); } catch (e){ console.error(e); } SiteHooks.after(id); };
    try { r = this._run(id, params); }
    catch (err){ done(); throw err; }
    if (r && typeof r.then === 'function') r.then(done, done);
    else done();
    return r;
  },
  /* 改道：某些命令碰到特定种类的层要换一条路走（例：滤镜碰到智能对象＝记成智能滤镜，photocraft filters.rs:219 add_smart_filter）。
     redirects 里每支 f(id, p) 回 {run, undoable} 就改跑它（照样把关、进历史、报改动），回 null／undefined＝照旧 */
  redirects: [],
  _run(id, params){
    let c = this.map[id];
    if (!c) throw new Error('unknown command: ' + id);
    const p = params || {};
    const top = this._depth === 0;
    for (const f of this.redirects){ let alt = null; try { alt = f(id, p); } catch (e){ console.error(e); } if (alt){ c = Object.assign({id}, alt); break; } }
    // 🔴 图层锁定：照锁拒改（见下面 Locks）——挡在这里，界面与 agent 同一道门；被挡不进历史、画面上提示一句
    if (top){ const g = Locks.guard(id, p); if (g){ if (window.UI) UI.refresh(); return g; } }
    const keepAlpha = top ? Locks.alphaBefore(id, p) : null;   // 锁透明像素：先记下这层的 alpha
    // 照 PS，只切图层可见性（layer.set 只带 visible）不进历史、不占一步 Ctrl+Z
    const rec = c.undoable && !(id === 'layer.set' && 'visible' in p && Object.keys(p).every(k => k === 'id' || k === 'visible'));
    if (rec) History.push();
    // 会往层上加像素的命令，先让目标像素层盖住整份文件（快照在长大之前拍＝历史里存的还是小的那张）；锁透明像素的不必长（画布外本来就不能画）
    if (top && !keepAlpha){ const G = LayerBox.cmdTarget(id, p); if (G && !Locks.alpha(G)) LayerBox.grow(G); }
    let r;
    this._depth++;
    try { r = c.run(p); }
    // 命令失败：不留一步空的 Ctrl+Z，并把文件退回命令前的快照——不然「先把活形状转成路径、后面才报错」会留下半截改动退不回去
    catch (err){ this._depth--; if (rec) History.restoreInPlace(History.past.pop()); throw err; }
    this._depth--;
    if (rec && r && r.ok === false) History.restoreInPlace(History.past.pop());
    else if (keepAlpha && !(r && r.ok === false)) Locks.alphaAfter(keepAlpha);
    if (top) Groups.normalize();                 // 有图层组：父指标补齐、组的位移搬进子孙、阵列排回 DFS（没有组＝什么都不做）
    if(window.UI&&c.refresh!=='none'){ if(c.refresh==='view'&&UI.drawView) UI.drawView(); else UI.refresh(); }
    return r === undefined ? {ok:true} : r;
  }
};

/* ───────── 图层锁定（PS 图层面板「锁定：」那排；资料在 L.locks = {transparency, pixels, position, artboard, all}） ─────────
   照 photocraft 原码怎么挡：
   - 锁像素／全锁 ⇒ 不能改像素：commands.rs:66 paint_surface、edit_menu_cmds.rs:123 writable_surface、eraser_cmds.rs:72 pixels_locked、
     lens_cmds.rs:271、vp_cmds.rs:142（错误字串「Could not complete your request because the layer "…" is locked」）
   - 锁位置／全锁 ⇒ 不能移、不能变形：layer_multi_cmds.rs:226 move_layers、transform_cmds.rs:170 transform_layer（背景层先浮成普通层 :165）、warp_cmds.rs:119
   - 全锁 ⇒ 连加向量蒙版都不行：vector_cmds.rs:932
   - 锁透明像素 ⇒ 只改有像素的地方、alpha 不变：retouch.rs:143 over_native(lock_transparency)、render.rs:629（alpha 0 的格子跳过）；
     擦除改成刷背景色 brush_cmds.rs:207 erase_locked、eraser_cmds.rs:116（魔术橡皮擦同）；背景橡皮擦直接报错 eraser_cmds.rs:151
   原码没挡的（照 PS 补）：全部锁定时不透明度／混合模式／图层样式／图层蒙版也不能改（PS 会把那几个控件灰掉）；可见性、改名、上下排序照常。
   🔴 背景层：照现有 isBackground 规矩，只有 L.locks 里真有锁才挡（新文件的「背景」层没带锁，移动工具照样拖得动——自测-滑鼠.py 靠这个）。 */
const Locks = {
  KEYS: ['transparency', 'pixels', 'position', 'artboard', 'all'],
  of(L){ return Object.assign({transparency:false, pixels:false, position:false, artboard:false, all:false}, (L && L.locks) || {}); },
  /* 图层列右边的小锁：全部锁定＝实心；其余任一锁＝空心（PS） */
  state(L){ const k = (L && L.locks) || {}; return k.all ? 'all' : (k.transparency || k.pixels || k.position) ? 'partial' : null; },
  /* 这层挡不挡 what：'pixels'（锁像素或全锁）／'position'（锁位置或全锁）／'all'（只有全锁）；回挡住的那把锁，没挡回 null */
  blocks(L, what){
    const k = L && L.locks; if (!k) return null;
    const ws = Array.isArray(what) ? what : [what];
    if (k.all) return 'all';
    for (const w of ws){ if (w === 'pixels' && k.pixels) return 'pixels'; if (w === 'position' && k.position) return 'position'; }
    return null;
  },
  /* 锁透明像素（全锁另外整个挡掉） */
  alpha(L){ return !!(L && L.kind === 'raster' && L.locks && L.locks.transparency && !L.locks.all); },
  isBg(L){ return !!(window.PsLayer && PsLayer.isBackground ? PsLayer.isBackground(L) : (L && L.isBackground)); },
  NAME_HANS: {transparency:'锁定透明像素', pixels:'锁定图像像素', position:'锁定位置', all:'锁定全部'},
  message(L, key){ return Lang.t('lock.denied').replace('{name}', L.name).replace('{lock}', Lang.t('lock.' + key)); },
  /* 命令被挡的回传（agent 看 error／locked／layerId 就知道哪层哪把锁） */
  fail(L, key, cmd){
    return {ok:false, locked:key, layerId:L.id, command:cmd,
            error:`图层「${L.name}」已锁定（${this.NAME_HANS[key] || key}）——无法完成请求${cmd ? '：' + cmd : ''}。先 layer.unlock {id:"${L.id}"} 或 layer.lock 关掉那把锁`};
  },
  /* 画面上提示一句（PS 弹「无法完成请求，因为图层已锁定」）；同一句 1.5 秒内不重复叠 */
  notify(msg){
    if (typeof document === 'undefined' || !document.body) return;
    let d = document.getElementById('lockToast');
    if (!d){
      d = document.createElement('div'); d.id = 'lockToast'; d.setAttribute('role', 'alert');
      d.style.cssText = 'position:fixed;left:50%;top:60px;transform:translateX(-50%);z-index:10001;background:#5a2a2a;color:#fff;padding:7px 16px;border-radius:4px;font:12px sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4);pointer-events:none';
      document.body.appendChild(d);
    }
    d.textContent = msg; d.style.display = 'block';
    this.notified = (this.notified || 0) + 1;            // 给自测数：被挡了几次
    clearTimeout(this._t); this._t = setTimeout(() => { d.style.display = 'none'; }, 3200);
  },
  /* 工具用：这层被锁就提示、回 true（工具这次按下就不动手） */
  deny(L, what, opt){
    if (!L) return false;
    if (opt && opt.bgFloat && this.isBg(L) && !(L.locks && L.locks.all)) return false;   // 背景层变形会先浮成普通层（transform_cmds.rs:165）
    const k = this.blocks(L, what); if (!k) return false;
    this.notify(this.message(L, k)); return true;
  },

  /* ── 命令把关表：[命令 id（字串／正则）, 挡什么（'pixels'|'position'|'all'|陣列|函式(p)）, 找目标层, 选项] ──
     选项：alpha＝锁透明像素时事后把 alpha 还原（擦掉的改成背景色）；alphaErr＝锁透明像素直接报错；bgFloat＝背景层放行（命令自己会浮成普通层）；skip(p)＝这次不挡 */
  _rules: null,
  rules(){
    if (this._rules) return this._rules;
    const byId = id => (id ? Doc.byId(id) : null);
    const act = () => Doc.active();
    const lid = p => p.layerId ? byId(p.layerId) : act();                               // 绝大多数命令：layerId 缺省＝当前层
    const pid = p => Array.isArray(p.ids) && p.ids.length ? p.ids.map(byId) : [byId(p.id || p.layer || p.layerId) || (p.id || p.layer || p.layerId ? null : act())];   // 图层菜单：id 缺省＝当前层
    const vec = p => { const L = p.layerId ? byId(p.layerId) : ((window.VecSel && VecSel.layer && VecSel.layer()) || act()); return L && L.kind === 'vector' ? L : null; };   // 矢量节点／物件：选取所在的层
    const newShape = p => { if (p.layerId) return byId(p.layerId); const L = act(); return L && L.kind === 'vector' ? L : null; };   // 画形状：当前是矢量层才画进它，不然新建一层（不挡）
    const ids = p => Array.isArray(p.ids) && p.ids.length ? p.ids.map(byId) : [act()];
    const text = p => { const L = p.layerId ? byId(p.layerId) : (window.TypeTool && TypeTool.ed && TypeTool.ed.layer ? byId(TypeTool.ed.layer) : act()); return L && L.kind === 'text' ? L : null; };
    const PX = 'pixels', POS = 'position', ALL = 'all';
    this._rules = [
      // 像素：画、擦、填、清、滤镜／调整（锁透明像素的事后还原 alpha）
      [['edit.delete', 'paint.stroke', 'paint.fillRect', 'paint.bucket', 'paint.clone', 'brush.stroke', 'eraser.stroke', 'eraser.magic',
        'bucket.fill', 'clone.stamp', 'gradient.paint', 'pencil.stroke', 'spotheal.stroke', 'heal.stroke', 'historybrush.paint', 'blur.stroke', 'sharpen.stroke', 'smudge.stroke', 'dodge.stroke', 'burn.stroke', 'sponge.stroke', 'mixer.stroke', 'colorreplace.stroke', 'patch.apply', 'patch.usePattern', 'contentmove.apply', 'redeye.fix', 'patternstamp.paint', 'arthistory.paint', 'drop3d.fill', 'ps.edit.cut', 'ps.edit.clear', 'ps.edit.fill', 'ps.edit.stroke', 'ps.edit.contentAwareFill', 'ps.edit.fade'], PX, lid, {alpha:true}],
      [['eraser.background'], PX, lid, {alphaErr:true}],
      [['ps.edit.contentAwareScale', 'ps.image.applyImage', 'ps.layer.new.layerViaCut'], PX, lid],
      [/^ps\.image\.adjustments\.(?!colorLookup\.list$)/, PX, lid],
      [/^ps\.image\.auto(Tone|Contrast|Color)$/, PX, lid],
      [['layer.rasterize'], PX, pid],                                                       // rasterize_prompt.rs:80
      [/^ps\.layer\.matting\./, PX, pid],
      [['ps.layer.layerMask.apply', 'ps.layer.layerMask.fromTransparency'], PX, pid],
      [/^ps\.layer\.layerMask\./, ALL, pid],
      [/^ps\.layer\.layerStyle\.(?!copyLayerStyle$|globalLight$|hideAllEffects$|showAllEffects$)/, ALL, pid],
      // 文字层内容
      [['text.edit', 'text.setStyle', 'text.select'], PX, text],
      [['freeformpen.draw', 'curvaturepen.set'], PX, newShape], // 自由钢笔／弯度钢笔画进当前矢量层
      // AI 版面：画进当前矢量层的
      [['blobbrush.paint', 'shaper.stroke', 'aipencil.draw', 'shapebuilder.merge', 'shapebuilder.splitStroke', 'livepaint.click'], PX, newShape],
      [/^(ai\.graph\.create|graph(column|stackcolumn|bar|stackbar|line|area|scatter|pie|radar)\.drag)$/, PX, newShape],
      // AI 版面：改矢量层内容的
      [['knife.cut', 'patheraser.erase', 'smooth.region', 'join.scrub', 'reshape.apply',
        'width.setPoint', 'width.copyPoint', 'width.removePoints', 'width.setProfile',
        'warp.apply', 'twirl.apply', 'pucker.apply', 'bloat.apply', 'scallop.apply', 'crystallize.apply', 'wrinkle.apply',
        'ai.livePaint.make', 'ai.livePaint.merge', 'ai.livePaint.release', 'ai.livePaint.expand', 'ai.livePaint.fill', 'ai.livePaint.strokeEdge'], PX, vec],
      [['reflect.transform', 'reflect.apply', 'reflect.drag', 'shear.transform', 'shear.apply', 'shear.drag',
        'freetransform.transform', 'freetransform.distort', 'freetransform.drag', 'groupselect.move', 'puppetwarp.warp'], POS, vec],
 // 矢量形状编辑（锚点、把手、路径运算、编组、排列、网格、渐变填色）＝矢量层的「像素」
      [['vsel.toBezier', 'shape.setAnchor', 'direct.moveAnchors', 'direct.setHandle', 'direct.deleteAnchors', 'direct.clear',
        'addanchor.insert', 'addanchor.remove', 'delanchor.remove', 'delanchor.insert', 'delanchor.deleteAnchors',
        'anchorpoint.convert', 'anchorpoint.setHandle', 'anchorpoint.removeHandle', 'anchorpoint.reshapeSegment', 'anchorpoint.convertAnchors',
        'scissors.cut', 'scissors.cutAt', 'pen.reverse', 'pen.appendAnchor', 'pen.close', 'pen.setAnchors',
        'mesh.create', 'mesh.setPointColor', 'mesh.movePoint', 'mesh.addLine', 'mesh.deletePoint', 'mesh.expand',
        'gradient.setGeom', 'gradient.edit', 'gradient.stopEdit',
        'ai.path.join', 'ai.path.average', 'ai.path.reverse'], PX, vec],
      [/^ai\.object\.(arrange\.(bringToFront|bringForward|sendBackward|sendToBack)|group|ungroup|lock|hide|lock\.above|hide\.above|compoundPath\.(make|release)|clippingMask\.(make|release)|path\.(simplify|addAnchorPoints|outlineStroke|offsetPath|divideObjectsBelow|splitIntoGrid|cleanUp)|expandShape|shape\.convertToShape|expand|makePixelPerfect|createTrimMarks)$/, PX, vec],
      [['ai.object.arrange.sendToCurrentLayer'], PX, p => [vec(p), act()]],
      [['direct.nudge'], [PX, POS], vec],
      // 新形状画进当前矢量层
      [/^shape\.(rect|ellipse|star|polygon|path|bezier)$/, PX, newShape],
      [['rect.drag', 'rect.dialog', 'ellipse.drag', 'ellipse.create', 'star.create', 'star.drag', 'line.create', 'line.drag', 'line.dialog'], PX, newShape],
      // 位置：移动、对齐、变形（缩放旋转翻转斜切扭曲透视）
      [['move.translate'], POS, lid, {skip:p => !!p.duplicate}],                            // ⌥ 拖／⌥ 方向键：移的是复制出来的新层
      [['move.align', 'move.distribute'], POS, ids],
      [['move.transform', 'layer.scale', 'layer.rotate', 'layer.flip', 'ps.edit.freeTransform'], POS, lid, {bgFloat:true}],
      [/^ps\.edit\.transform(\.|$)/, POS, lid, {bgFloat:true}],
      [['direct.moveObjects', 'scale.transform', 'scale.apply', 'rotate.transform', 'rotate.apply', 'rotate.drag', 'rotate.again'], POS, vec],
      [/^ai\.object\.(transform|move|rotate|scale|reflect|shear|transformAgain|transformEach|align)$/, POS, vec],
      // layer.set：x/y＝位置；不透明度／混合模式＝全锁才挡（照 PS）；名字、可见性照常
      [['layer.set'], p => (p.x !== undefined || p.y !== undefined) ? POS : (p.opacity !== undefined || p.blend !== undefined) ? ALL : null, lid],
    ];
    return this._rules;
  },
  rule(id){
    this._ruleCache = this._ruleCache || {};
    if (id in this._ruleCache) return this._ruleCache[id];
    const r = this.rules().find(([m]) => Array.isArray(m) ? m.includes(id) : m.test(id)) || null;
    return (this._ruleCache[id] = r);
  },
  targets(rule, p){ const t = rule[2](p); return (Array.isArray(t) ? t : [t]).filter(Boolean); },
  /* CMD.run 最外层叫：被挡回 {ok:false…}（并提示），放行回 null */
  guard(id, p){
    const rule = this.rule(id); if (!rule) return null;
    const opt = rule[3] || {};
    if (opt.skip && opt.skip(p)) return null;
    const what = typeof rule[1] === 'function' ? rule[1](p) : rule[1];
    if (!what) return null;
    let Ls; try { Ls = this.targets(rule, p); } catch (e){ return null; }
    for (const L of Ls){
      if (opt.bgFloat && this.isBg(L) && !(L.locks && L.locks.all)) continue;
      const k = this.blocks(L, what);
      if (k){ this.notify(this.message(L, k)); return this.fail(L, k, id); }
      if (opt.alphaErr && this.alpha(L) && !this.isBg(L)){                               // eraser_cmds.rs:151
        this.notify(this.message(L, 'transparency'));
        return Object.assign(this.fail(L, 'transparency', id), {error:`无法使用背景橡皮擦：图层「${L.name}」锁定了透明像素`});
      }
    }
    return null;
  },
  /* 锁透明像素：命令跑之前记下 alpha，跑完把 alpha 还原（retouch.rs over_native 的 lock_transparency）；
     本来透明的格子整格还原；被擦淡的格子改成按擦掉的比例刷背景色（brush_cmds.rs:207 erase_locked） */
  alphaBefore(id, p){
    const rule = this.rule(id); if (!rule || !(rule[3] || {}).alpha) return null;
    let Ls; try { Ls = this.targets(rule, p); } catch (e){ return null; }
    const L = Ls[0];
    // 背景层（PS／原码 brush_cmds.rs erase 碰到 Background）：没有透明可言 ⇒ 一般橡皮擦／画笔擦除模式改成刷背景色，同锁透明像素
    const bgErase = L && this.isBg(L) && (id === 'eraser.stroke' || ((id === 'brush.stroke' || id === 'pencil.stroke') && p && p.erase));
    if (!this.alpha(L) && !bgErase) return null;
    const c = L.data.canvas;
    return {L, w:c.width, h:c.height, pre:L.data.ctx.getImageData(0, 0, c.width, c.height)};
  },
  alphaAfter(k){
    const L = k.L, c = L.data && L.data.canvas;
    if (!c || c.width !== k.w || c.height !== k.h) return;
    const cur = L.data.ctx.getImageData(0, 0, k.w, k.h), d = cur.data, s = k.pre.data;
    const bgEl = typeof document !== 'undefined' && document.getElementById('strokeColor');   // PS 版面：背景色＝第二个色块
    const bg = hexToRGB((bgEl && bgEl.value) || '#ffffff');
    let changed = false;
    for (let i = 0; i < d.length; i += 4){
      const pa = s[i + 3], ca = d[i + 3];
      if (pa === 0){ if (ca || d[i] !== s[i] || d[i + 1] !== s[i + 1] || d[i + 2] !== s[i + 2]){ d[i] = s[i]; d[i + 1] = s[i + 1]; d[i + 2] = s[i + 2]; d[i + 3] = 0; changed = true; } continue; }
      if (ca === pa) continue;
      if (ca < pa){                                           // 擦掉了 k＝1−ca/pa ⇒ 照 over 公式刷背景色、alpha 不变
        const kk = 1 - ca / pa, A = pa / 255, oa = kk + A * (1 - kk);
        const src = ca > 0 ? [d[i], d[i + 1], d[i + 2]] : [s[i], s[i + 1], s[i + 2]];
        for (let j = 0; j < 3; j++) d[i + j] = Math.round((bg[j] * kk + src[j] * A * (1 - kk)) / oa);
      }
      d[i + 3] = pa; changed = true;
    }
    if (changed) L.data.ctx.putImageData(cur, 0, 0);
  }
};

/* ── file.* ── */
CMD.reg('file.new', {i18n:'cmd.file.new', params:'{width=1200, height=675, background="#ffffff"|null（透明）, blankLayer=true（透明底时建一层空白「图层 1」，同 PS；false＝一层都不建）}'}, p => {
  Doc.reset(p.width||1200, p.height||675, p.background === null ? null : (p.background||'#ffffff'), p.blankLayer !== false);
  if (window.UI) UI.fit();
  if (window.HandView) HandView.reset();  // 同尺寸新档也要把视角回正中
  return {width:Doc.width, height:Doc.height};
});
CMD.reg('file.open', {i18n:'cmd.file.open', params:'{} 开档案挑选器（AI 请改用 layer.addImageFromURL）'}, () => {
  document.getElementById('fileInput').click();
});
CMD.reg('file.openProject', {i18n:'cmd.file.openProject', params:'{}'}, () => {
  document.getElementById('projInput').click();
});
CMD.reg('file.saveProject', {i18n:'cmd.file.saveProject', params:'{name?}'}, p => {
  const json = Project.serialize();
  download(new Blob([JSON.stringify(json)], {type:'application/json'}), (p.name||'untitled') + '.dlcanvas');
  return {bytes: JSON.stringify(json).length};
});
CMD.reg('file.exportPNG',   {i18n:'cmd.file.exportPNG',   params:'{scale=1, name?}'}, p => exportPNG(p.scale||1, p.name));
CMD.reg('file.exportPNG2x', {i18n:'cmd.file.exportPNG2x', params:'{}'}, () => exportPNG(2));
CMD.reg('file.exportSVG',   {i18n:'cmd.file.exportSVG',   params:'{name?}'}, p => {
  const svg = Project.toSVG();
  download(new Blob([svg],{type:'image/svg+xml'}), (p.name||'untitled')+'.svg');
  return {bytes: svg.length};
});

/* ── edit.* ── */
CMD.reg('edit.undo', {i18n:'cmd.edit.undo', params:'{}'}, () => ({ok:History.undo()}));
CMD.reg('edit.redo', {i18n:'cmd.edit.redo', params:'{}'}, () => ({ok:History.redo()}));
CMD.reg('edit.delete', {i18n:'cmd.edit.delete', params:'{} 清空当前层（有选区则只清选区内）', undoable:true}, () => {
  const L = Doc.active(); if (!L) return {ok:false};
  if (L.kind === 'raster'){
    const s = Doc.sel;
    if (s && s.mask && window.SelMask){            // 非矩形选区（套索／魔棒／椭圆）：按遮罩覆盖度清（不只清外框矩形）
      const m = SelMask.maskCanvas(L), ctx = L.data.ctx;
      ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(m, 0, 0); ctx.restore();
    }
    else if (s) L.data.ctx.clearRect(s.x - L.x, s.y - L.y, s.w, s.h);   // 同样要换算到图层坐标
    else L.data.ctx.clearRect(0,0,L.data.canvas.width,L.data.canvas.height);
  } else if (L.kind === 'vector'){ L.data.shapes = []; Layer.invalidate(L); }
  return {ok:true};
});
CMD.reg('edit.duplicate', {i18n:'cmd.edit.duplicate', params:'{id?}', undoable:true}, p => CMD.map['layer.duplicate'].run(p));

/* ── layer.* ── */
CMD.reg('layer.newRaster', {i18n:'cmd.layer.newRaster', params:'{name?}', undoable:true}, p => {
  // PS：「图层 N」取下一个没用过的号（现有「图层 N」最大的 N＋1；不是看总层数）
  const base = Lang.t('layer.untitled'), re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' (\\d+)$');
  const nx = Doc.layers.reduce((m, l) => { const k = re.exec(l.name); return k ? Math.max(m, +k[1]) : m; }, 0) + 1;
  const L = Layer.raster(p.name || (base + ' ' + nx));
  Doc.add(L); return {id:L.id};
});
CMD.reg('layer.newVector', {i18n:'cmd.layer.newVector', params:'{name?}', undoable:true}, p => {
  const L = Layer.vector(p.name || (Lang.t('layer.vector')+' '+(Doc.layers.length+1)));
  Doc.add(L); return {id:L.id};
});
CMD.reg('layer.newText', {i18n:'cmd.layer.newText', params:'{text, x=40, y=80, size=64, color="#fff", font?, align?}', undoable:true}, p => {
  const L = Layer.text(p.text||'Text', p); Doc.add(L); return {id:L.id};
});
CMD.reg('layer.delete', {i18n:'cmd.layer.delete', params:'{id?}', undoable:true}, p => ({ok: Doc.remove(p.id || Doc.activeId)}));
CMD.reg('layer.duplicate', {i18n:'cmd.edit.duplicate', params:'{id?} 复制图层（组＝连子孙整组复制；智能对象＝共用同一份内容）', undoable:true}, p => {
  const L = Doc.byId(p.id || Doc.activeId); if (!L) return {ok:false};
  if (L.kind === 'group' || L.kind === 'smart') return dupTree(L);
  let N;
  if (L.kind === 'raster'){
    N = Layer.raster(L.name+' copy', L.data.canvas.width, L.data.canvas.height); N.data.ctx.drawImage(L.data.canvas,0,0);   // 照来源画布大小开（内容大小的层不再撑成整张文件；比文件大的层也不截）
  } else if (L.kind === 'vector'){
    N = Layer.vector(L.name+' copy'); N.data.shapes = JSON.parse(JSON.stringify(L.data.shapes));
  } else { N = Layer.text(L.name+' copy', JSON.parse(JSON.stringify(L.data))); }
  Object.assign(N, {visible:L.visible, opacity:L.opacity, blend:L.blend, x:L.x, y:L.y});
  ['style','fillOpacity','blendIf'].forEach(k => { if (L[k] !== undefined) N[k] = JSON.parse(JSON.stringify(L[k])); }); if (L.mask) N.mask = cloneMaskLayer(L.mask);   // PS 复制图层带蒙版与样式
  Doc.add(N, Doc.index(L.id)+1); return {id:N.id};
});
/* 组／智能对象的复制（photocraft Layer::duplicate 整个节点 clone，新 id）：快照再做回来＝画布、蒙版、各菜单档的栏位都跟着拷；组的子孙改挂到新组底下 */
function dupTree(L){
  const block = L.kind === 'group' ? [...Groups.descendants(L), L] : [L];
  const map = new Map();
  const copies = block.map(X => { const N = History._layerFrom(History._layerSnap(X)); N.id = uid('L'); map.set(X.id, N.id); return N; });
  copies.forEach(N => { if (N.parent && map.has(N.parent)) N.parent = map.get(N.parent); });
  const top = copies[copies.length - 1];
  top.name = L.name + ' copy'; top.parent = L.parent === undefined ? null : L.parent;
  if (top.locks) delete top.locks;
  const at = Doc.index(L.id) + 1;
  Doc.layers.splice(at, 0, ...copies); Doc.activeId = top.id;
  return {id:top.id};
}
CMD.reg('layer.set', {i18n:'', params:'{id?, name?, visible?, opacity? 0..1, blend?, x?, y?}', undoable:true}, p => {
  const L = Doc.byId(p.id || Doc.activeId); if (!L) return {ok:false};
  ['name','visible','blend'].forEach(k => { if (p[k] !== undefined) L[k] = p[k]; });
  if (p.opacity !== undefined) L.opacity = Math.max(0, Math.min(1, p.opacity));
  if (p.x !== undefined){ L.x = p.x; Layer.invalidate(L); }
  if (p.y !== undefined){ L.y = p.y; Layer.invalidate(L); }
  return {ok:true};
});
/* 图层锁定的好找别名（给 agent）：转 ps.layer.lockLayers（menus/impl/ps-layer.js，照 layer_multi_cmds.rs:557 lock_layers） */
const lockIds = p => Array.isArray(p.ids) && p.ids.length ? p.ids : (p.id || p.layerId) ? [p.id || p.layerId] : undefined;
const lockOut = (r, ids) => {
  if (r && r.ok === false) return r;
  const Ls = (ids || (window.PsLayer && PsLayer.idsOf ? PsLayer.idsOf({}) : [Doc.activeId])).map(id => Doc.byId(id)).filter(Boolean);
  return {ok:true, layers:Ls.length, locks:Ls.map(L => ({id:L.id, name:L.name, locks:Locks.of(L)}))};
};
CMD.reg('layer.lock', {i18n:'', undoable:true, params:'{id?|ids?:[…]（缺省＝当前层／多选的层）, transparency?, pixels?, position?, all?:bool（只改有给的；一个都不给＝切换「全部锁定」）} 锁定图层（PS 图层面板「锁定：」四颗钮：透明像素／图像像素／位置／全部）→ {ok, layers, locks:[{id,name,locks}]}；被锁的层改像素／移动的命令会回 {ok:false, locked, error}'}, p => {
  if (!CMD.map['ps.layer.lockLayers']) return {ok:false, error:'ps.layer.lockLayers not loaded'};
  const ids = lockIds(p), q = {};
  if (ids) q.ids = ids;
  ['transparency', 'pixels', 'position', 'artboard', 'all'].forEach(k => { if (p[k] !== undefined) q[k] = !!p[k]; });
  if ((p.id || p.layerId) && !Doc.byId(p.id || p.layerId)) return {ok:false, error:'no such layer: ' + (p.id || p.layerId)};
  return lockOut(CMD.map['ps.layer.lockLayers'].run(q), ids);
});
CMD.reg('layer.unlock', {i18n:'', undoable:true, params:'{id?|ids?:[…]（缺省＝当前层／多选的层）} 解除图层锁定：解开全部锁（透明像素／图像像素／位置／画板／全部）→ {ok, layers, locks}'}, p => {
  if (!CMD.map['ps.layer.lockLayers']) return {ok:false, error:'ps.layer.lockLayers not loaded'};
  const ids = lockIds(p);
  if ((p.id || p.layerId) && !Doc.byId(p.id || p.layerId)) return {ok:false, error:'no such layer: ' + (p.id || p.layerId)};
  const q = {transparency:false, pixels:false, position:false, artboard:false, all:false}; if (ids) q.ids = ids;
  return lockOut(CMD.map['ps.layer.lockLayers'].run(q), ids);
});
CMD.reg('layer.select', {i18n:'', params:'{id}'}, p => { Doc.activeId = p.id; return {ok:true}; });
CMD.reg('layer.bringForward', {i18n:'cmd.layer.bringForward', params:'{id?}', undoable:true}, p => move(p, +1));
CMD.reg('layer.sendBackward', {i18n:'cmd.layer.sendBackward', params:'{id?}', undoable:true}, p => move(p, -1));
function move(p, d){
  const id = p.id || Doc.activeId;
  if (Groups.any()){                                         // 有组：在兄弟之间移（photocraft doc.shift：到头了回 false）
    const L = Doc.byId(id); if (!L) return {ok:false};
    const T = Groups.tree(), sib = T.of(Groups.parentOf(L) ? L.parent : null);
    const i = sib.indexOf(L), j = i + d;
    if (i < 0 || j < 0 || j >= sib.length) return {ok:false};
    sib.splice(i, 1); sib.splice(j, 0, L); Groups.rebuild(T);
    return {ok:true};
  }
  const i = Doc.index(id), j = i+d;
  if (i<0 || j<0 || j>=Doc.layers.length) return {ok:false};
  const [L] = Doc.layers.splice(i,1); Doc.layers.splice(j,0,L); return {ok:true};
}
/* 拖进拖出组、换位置（photocraft commands.rs:660 layer.moveTo：组不能搬进自己或自己的子孙） */
CMD.reg('layer.moveTo', {i18n:'', undoable:true, params:'{id?（缺省＝当前层）, target:图层 id, position:"above|below|into"="above"} 把一层（组＝连子孙）搬到 target 的上面／下面（＝target 的兄弟）或搬进 target 组里（放在最上面）→ {ok, id, parent}'}, p => {
  const L = Doc.byId(p.id || p.layer || Doc.activeId); if (!L) return {ok:false, error:'no such layer'};
  const T0 = Doc.byId(p.target); if (!T0) return {ok:false, error:'missing `target`'};
  if (L === T0) return {ok:true, id:L.id, parent:L.parent || null};
  const pos = p.position || 'above';
  if (L.kind === 'group' && Groups.isUnder(T0, L)) return {ok:false, error:"can't move a group into itself"};
  if (pos === 'into' && T0.kind !== 'group') return {ok:false, error:'target is not a group'};
  const parent = pos === 'into' ? T0.id : (Groups.parentOf(T0) ? T0.parent : null);
  if (L.data && L.data.artboard && parent) return {ok:false, error:'artboards must be top-level'};   // 画板只能在顶层（artboard_cmds.rs has_plain_group）
  const T = Groups.tree();
  const from = T.of(Groups.parentOf(L) ? L.parent : null); from.splice(from.indexOf(L), 1);
  L.parent = parent;
  if (!T.kids.has(parent)) T.kids.set(parent, []);
  const sib = T.kids.get(parent);
  if (pos === 'into') sib.push(L);
  else { const k = sib.indexOf(T0); sib.splice(pos === 'below' ? k : k + 1, 0, L); }
  Groups.rebuild(T); Doc.activeId = L.id;
  return {ok:true, id:L.id, parent};
});
/* PS：图层面板按住 Alt 拖一层＝复制到放开的位置（一步历史「复制图层」） */
CMD.reg('layer.duplicateTo', {i18n:'', undoable:true, params:'{id?（缺省＝当前层）, target:图层 id, position:"above|below|into"="above"} 复制一层（组＝连子孙）放到 target 的上面／下面／组里（＝图层面板 Alt＋拖）→ {ok, id（拷贝）, parent}'}, p => {
  const L = Doc.byId(p.id || p.layer || Doc.activeId); if (!L) return {ok:false, error:'no such layer'};
  if (!Doc.byId(p.target)) return {ok:false, error:'missing `target`'};
  const d = CMD.map['layer.duplicate'].run({id:L.id}); if (!d || !d.id) return {ok:false, error:'duplicate failed'};
  if (p.target === L.id) return {ok:true, id:d.id, parent:Doc.byId(d.id).parent || null};
  const r = CMD.map['layer.moveTo'].run({id:d.id, target:p.target, position:p.position || 'above'});
  return r && r.ok === false ? r : {ok:true, id:d.id, parent:r.parent};
});
/* 展开／收合组（photocraft group_view_cmds.rs:47 layer.setExpanded：是文件资料、但不进历史） */
CMD.reg('layer.setExpanded', {i18n:'', params:'{id?（缺省＝当前层）, expanded?:bool（不给＝切换）, all?:bool（全部的组一起）} 展开／收合图层组（图层面板的小三角；不进历史）→ {expanded, groups}'}, p => {
  const all = !!p.all, groups = Doc.layers.filter(L => L.kind === 'group');
  const G = all && !p.id ? null : Doc.byId(p.id || p.layer || Doc.activeId);
  if (!all && (!G || G.kind !== 'group')) return {ok:false, error:'layer is not a group'};
  const cur = G ? G.data.expanded !== false : groups.some(g => g.data.expanded !== false);
  const want = typeof p.expanded === 'boolean' ? p.expanded : !cur;
  (all ? groups : [G]).forEach(g => { g.data.expanded = want; });
  return {ok:true, expanded:want, groups:all ? groups.length : 1};
});
CMD.reg('layer.rasterize', {i18n:'cmd.layer.rasterize', params:'{id?} 把向量／文字层算成像素层（不可逆）；智能对象＝内容换成目前的外观（id 与蒙版、样式都留着，photocraft extra_cmds.rs:494 rasterize_one）', undoable:true}, p => {
  const L = Doc.byId(p.id || Doc.activeId);
  if (L && L.kind === 'smart') return rasterizeSmart(L);
  if (L && L.kind === 'group') return {ok:false, error:'the layer has nothing to rasterize'};
  if (!L || L.kind === 'raster') return {ok:false};
  const N = Layer.raster(L.name);
  N.data.ctx.drawImage(renderLayer(L,1), 0,0);
  Object.assign(N, {visible:L.visible,opacity:L.opacity,blend:L.blend});
  if (L.parent !== undefined) N.parent = L.parent;           // 还在原来的组里
  Doc.layers[Doc.index(L.id)] = N; Doc.activeId = N.id; return {id:N.id};
});
/* 栅格化智能对象（extra_cmds.rs:457 content_pixels＋494 rasterize_one 的 smart 分支）：内容换成像素（只有内容：不含蒙版、样式、不透明度），id、名字、蒙版、样式、混合都留着 */
function rasterizeSmart(L){
  const src = Smart.render(L), c = document.createElement('canvas');
  c.width = Doc.width; c.height = Doc.height;
  const cx = c.getContext('2d', {willReadFrequently:true}); cx.drawImage(src, 0, 0);
  L.kind = 'raster'; L.data = {canvas:c, ctx:cx}; L.x = 0; L.y = 0;
  delete L.filterMask; delete L._fallback; Layer.invalidate(L);
  return {ok:true, id:L.id, layer:L.id};
}
CMD.reg('layer.addImageFromURL', {i18n:'', params:'{url, name?, fit=true（缩进画布）, width?/height?（文件 px，只给一边＝等比）| scale?（相对原图，1＝原大）, x?/y?（左上角；缺省＝置中）, src?:{file_id}（这张图是云盘哪份档：存档时只存引用不存像素，像素一改就作废）} 载入一张图成为新的像素层（插在当前层上面）→ {id, w, h 原图尺寸, placed:[x,y,w,h]}'}, p => {
  // 本机的图（blob: 网址＝剪贴簿贴上、置入嵌入对象、拖放…）先问网站宿主要不要接手（上传云盘）；ui.js 的入口自己问过了会带 localAsked
  if (!p.localAsked && /^blob:/i.test(String(p.url || '')) && SiteHooks.hasLocalHook()){
    return fetch(p.url).then(r => r.blob())
      .then(b => SiteHooks.askLocal(new File([b], p.name || 'image', {type:b.type || 'image/png'}), 'image'))
      .then(ans => {
        if (ans.handled) return {ok:true, handled:true, by:'host'};
        return placeImageFromURL(p).then(r => { SiteHooks.applyFileId(r.id, ans.fileId); return r; });
      });
  }
  return placeImageFromURL(p);
});
function placeImageFromURL(p){
  const serial = Doc.serial;   // 下载前记文件序号：等图的中间换了档（开别份／新建）⇒ 晚到的图⛔ 落进新那份
  return new Promise((res,rej)=>{
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (Doc.serial !== serial) return rej(new Error('document changed while loading: '+p.url));
      History.push();
      const num = v => typeof v === 'number' && isFinite(v);
      let k = p.fit === false ? 1 : Math.min(Doc.width/img.width, Doc.height/img.height, 1);
      if (num(p.scale) && p.scale > 0) k = p.scale;
      let w = img.width*k, h = img.height*k;
      if (num(p.width) && p.width > 0 && num(p.height) && p.height > 0){ w = p.width; h = p.height; }
      else if (num(p.width) && p.width > 0){ w = p.width; h = img.height * p.width / img.width; }
      else if (num(p.height) && p.height > 0){ h = p.height; w = img.width * p.height / img.height; }
      const x = num(p.x) ? p.x : (Doc.width-w)/2, y = num(p.y) ? p.y : (Doc.height-h)/2;
      // 画布只开放置矩形那么大，用 L.x/L.y 定位（每张都开整张文件大的画布的话，5120×3460 放 20 张小图就吃约 1.4GB）。
      // 位移取整数格、小数部分留在画布里（跟旧版画进整张画布的像素一格不差）；只画文件范围内那块（旧版画布外的本来就截掉）
      const X0 = Math.max(0, Math.floor(Math.min(x, x + w))), Y0 = Math.max(0, Math.floor(Math.min(y, y + h)));
      const X1 = Math.min(Doc.width, Math.ceil(Math.max(x, x + w))), Y1 = Math.min(Doc.height, Math.ceil(Math.max(y, y + h)));
      const L = X1 > X0 && Y1 > Y0 ? Layer.raster(p.name || 'image', X1 - X0, Y1 - Y0) : Layer.raster(p.name || 'image', 1, 1);
      if (X1 > X0 && Y1 > Y0){ L.x = X0; L.y = Y0; }
      L.data.ctx.imageSmoothingQuality = 'high';
      L.data.ctx.drawImage(img, x - L.x, y - L.y, w, h);
      L._place = [x - L.x, y - L.y, w, h]; L._placePx = PX.tok(L.data.canvas);          // 记下怎么置入的（画布坐标）：宿主之后回 file_id 时，像素没被改才能换成引用
      if (p.src && p.src.file_id){ L.src = {file_id:String(p.src.file_id)}; L._srcPx = L._placePx; }
      const at = Doc.activeId ? Doc.index(Doc.activeId) + 1 : undefined;
      Doc.add(L, at); if (window.UI) UI.refresh();
      res({id:L.id, w:img.width, h:img.height, placed:[x, y, w, h]});
    };
    img.onerror = () => rej(new Error('load failed: '+p.url));
    img.src = p.url;
  });
}

/* ── 画东西：向量 ── */
function activeVector(create){
  let L = Doc.active();
  if (!L || L.kind !== 'vector'){
    if (!create) return null;
    L = Layer.vector(Lang.t('layer.vector')+' '+(Doc.layers.length+1)); Doc.add(L);
  }
  return L;
}
CMD.reg('shape.rect', {i18n:'', params:'{x,y,w,h,radius?,fill?,stroke?,strokeWidth?,layerId?}', undoable:true},
  p => addShape(Object.assign({type:'rect'}, p)));
CMD.reg('shape.ellipse', {i18n:'', params:'{x,y,w,h,fill?,stroke?,strokeWidth?,layerId?}', undoable:true},
  p => addShape(Object.assign({type:'ellipse'}, p)));
CMD.reg('shape.star', {i18n:'', params:'{cx, cy 中心, r1/radius1 外径（二择一）, r2?/radius2? 内径（缺省＝外径的一半）, points=5 尖角数 2..1000, rotation=0 度（0＝第一个尖角朝正上）, fill?, stroke?, strokeWidth?, layerId?} 文件坐标（左上为原点、像素）→ {id, layerId}', undoable:true},
  p => regularShape('star', p));
CMD.reg('shape.polygon', {i18n:'', params:'{cx, cy 中心, r1/radius 外接圆半径（二择一）, points/sides=6 边数 3..1000, rotation=0 度（0＝一个角朝正上）, fill?, stroke?, strokeWidth?, layerId?} 文件坐标（左上为原点、像素）·正多边形；角自己定的多边形用 shape.path → {id, layerId}', undoable:true},
  p => regularShape('polygon', p));
/* 正多边形／星形：中心＋外径（＋内径）＋角数。参数名两种都收（多边形 r1/radius、points/sides；星形 r1/radius1、r2/radius2），
   中心或外径不是数、角数不合 ⇒ 回错（⛔ 照收：r1 缺了会存出一个画不出来的空形状，命令却回成功） */
function regularShape(type, p){
  p = p || {};
  const num = v => typeof v === 'number' && isFinite(v);
  const first = ks => { for (const k of ks) if (p[k] !== undefined) return p[k]; };
  const star = type === 'star', name = 'shape.' + type;
  if (!num(p.cx) || !num(p.cy)) return {ok:false, error:name + ': cx, cy (the center, document px) are required numbers'};
  const r1 = first(star ? ['r1', 'radius1', 'radius'] : ['r1', 'radius']);
  if (!num(r1) || r1 <= 0) return {ok:false, error:name + ': ' + (star ? 'r1 (or radius1)' : 'r1 (or radius)') + ' is the outer radius in document px and must be a number > 0'};
  const n = first(star ? ['points'] : ['points', 'sides']), min = star ? 2 : 3;
  if (n !== undefined && !(Number.isInteger(n) && n >= min && n <= 1000)) return {ok:false, error:name + ': ' + (star ? 'points (number of tips)' : 'points (or sides, number of sides)') + ' must be a whole number ' + min + '..1000'};
  const s = Object.assign({}, p, {type, r1, points: n === undefined ? (star ? 5 : 6) : n});
  ['radius', 'radius1', 'radius2', 'sides'].forEach(k => { delete s[k]; });
  if (star){
    const r2 = first(['r2', 'radius2']);
    if (r2 !== undefined && !(num(r2) && r2 >= 0)) return {ok:false, error:'shape.star: r2 (or radius2) is the inner radius in document px and must be a number ≥ 0'};
    s.r2 = r2 === undefined ? r1 / 2 : r2;
  } else delete s.r2;
  return addShape(s);
}
CMD.reg('shape.path', {i18n:'', params:'{points:[[x,y]…], closed?, fill?, stroke?, strokeWidth?}', undoable:true},
  p => addShape(Object.assign({type:'path'}, p)));
CMD.reg('shape.bezier', {i18n:'', params:'{anchors:[{x,y,in?:[x,y],out?:[x,y]}…] 把手为绝对坐标, closed?, fill?, stroke?, strokeWidth?, layerId?} 钢笔路径', undoable:true},
  p => {
    const A = (p.anchors||[]).map(a => ({x:+a.x, y:+a.y, in:a.in||null, out:a.out||null}));
    if (A.length < 2) return {ok:false, error:'need ≥2 anchors'};
    return addShape(Object.assign({}, p, {type:'bezier', anchors:A}));
  });
CMD.reg('shape.setAnchor', {i18n:'', params:'{shapeId, index, x?, y?, in?:[x,y]|null, out?:[x,y]|null, layerId?} 改钢笔路径的一个锚点', undoable:true}, p => {
  const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  if (!L || L.kind !== 'vector') return {ok:false};
  const s = L.data.shapes.find(x => x.id === p.shapeId);
  if (!s || s.type !== 'bezier' || !s.anchors[p.index]) return {ok:false, error:'no such anchor'};
  const a = s.anchors[p.index];
  ['x','y','in','out'].forEach(k => { if (p[k] !== undefined) a[k] = p[k]; });
  Layer.invalidate(L); return {ok:true};
});
function addShape(s){
  const L = s.layerId ? Doc.byId(s.layerId) : activeVector(true);
  if (!L || L.kind !== 'vector') return {ok:false, error:'not a vector layer'};
  const sh = Object.assign({fill: UI ? UI.fill() : '#e8573f', stroke:'none', strokeWidth:0}, s);
  delete sh.layerId;
  // 🔴 命令收到的是文件坐标；矢量层被移动过（L.x/L.y）时要换算成图层坐标，跟像素层那条铁律一样
  shiftShape(sh, -L.x, -L.y);
  sh.id = uid('S'); L.data.shapes.push(sh); Layer.invalidate(L);
  return {id:sh.id, layerId:L.id};
}
/* 把一个形状整体平移（各种 type 的几何栏位都要顾到） */
function shiftShape(s, dx, dy){
  if (!dx && !dy) return s;
  if ((s.type === 'group' || s.type === 'compound') && Array.isArray(s.children)){ s.children.forEach(c => shiftShape(c, dx, dy)); if (window.GradientFill){ GradientFill.shift(s.fill, dx, dy); GradientFill.shift(s.stroke, dx, dy); } return s; }   // 编组／复合路径：递归搬成员
  const mv = p => p ? [p[0]+dx, p[1]+dy] : p;
  if (s.type === 'rect' || s.type === 'ellipse'){ s.x += dx; s.y += dy; }
  else if (s.type === 'star' || s.type === 'polygon'){ s.cx += dx; s.cy += dy; }
  else if (s.type === 'path' || s.type === 'line'){ s.points = (s.points||[]).map(mv); }
  else if (s.type === 'bezier'){
    s.anchors = (s.anchors||[]).map(a => Object.assign({}, a, {x:a.x+dx, y:a.y+dy, in:mv(a.in), out:mv(a.out)}));   // 保留 kind（剪刀／直接选择会用到）
  }
  else if (s.type === 'mesh' && s.mesh){ s.mesh.points.forEach(q => { q.x += dx; q.y += dy; }); }   // 网格点存图层坐标，把手是相对位移不用动
  if (window.GradientFill){ GradientFill.shift(s.fill, dx, dy); GradientFill.shift(s.stroke, dx, dy); }   // 渐变向量跟着形状走
  return s;
}

/* ── 画东西：像素 ── */
/* 🔴 所有给进来的坐标一律是「文件坐标」；像素层自己可能被移动过（L.x/L.y），
      所以往它的画布里写之前必须换算成「那一层自己的坐标」＝ 文件坐标 − 图层位移。
      不做这步，图层一被移动工具拖过，笔尖就跟落点差一段。 */
const toLayer = (L, x, y) => [x - L.x, y - L.y];

CMD.reg('paint.stroke', {i18n:'', params:'{points:[[x,y]…] 文件坐标, color, size=20, hardness=1, erase=false, layerId?}', undoable:true}, p => {
  const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  if (!L || L.kind !== 'raster') return {ok:false, error:'not a pixel layer'};
  Paint.stroke(L, (p.points||[]).map(pt => toLayer(L, pt[0], pt[1])), p);
  return {ok:true, points:(p.points||[]).length};
});
CMD.reg('paint.fillRect', {i18n:'', params:'{x,y,w,h,color,layerId?} 文件坐标', undoable:true}, p => {
  const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  if (!L || L.kind !== 'raster') return {ok:false};
  const [x,y] = toLayer(L, p.x, p.y);
  L.data.ctx.fillStyle = p.color || '#000'; L.data.ctx.fillRect(x,y,p.w,p.h); return {ok:true};
});
CMD.reg('paint.bucket', {i18n:'', params:'{x,y,color,tolerance=32,layerId?} 文件坐标', undoable:true}, p => {
  const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  if (!L || L.kind !== 'raster') return {ok:false};
  const [x,y] = toLayer(L, p.x, p.y);
  Paint.bucket(L, x|0, y|0, p.color||'#000', p.tolerance===undefined?32:p.tolerance); return {ok:true};
});
CMD.reg('paint.clone', {i18n:'', params:'{points:[[x,y]…], source:[x,y] 取样点, size=40, hardness=1, aligned=true, layerId?} 仿制图章', undoable:true}, p => {
  const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  if (!L || L.kind !== 'raster') return {ok:false, error:'not a pixel layer'};
  if (!p.source) return {ok:false, error:'need source'};
  Paint.clone(L, (p.points||[]).map(pt => toLayer(L, pt[0], pt[1])),
                 toLayer(L, p.source[0], p.source[1]), p);
  return {ok:true, points:(p.points||[]).length};
});

/* ── select.* ── */
CMD.reg('select.rect', {i18n:'', params:'{x,y,w,h}', undoable:true}, p => { Doc.sel = {x:p.x,y:p.y,w:p.w,h:p.h}; return {ok:true}; });   // 选区进历史（photocraft select.rect 同）
CMD.reg('select.all',  {i18n:'', params:'{}'}, () => { Doc.sel = {x:0,y:0,w:Doc.width,h:Doc.height}; return {ok:true}; });
CMD.reg('select.none', {i18n:'', params:'{}', undoable:true}, () => { Doc.sel = null; return {ok:true}; });

/* ── view.* ── */
CMD.reg('view.fit',    {i18n:'cmd.view.fit',    params:'{}'}, () => { UI.fit(); if (window.HandView) HandView.reset(); return {zoom:UI.zoom}; });  // fit_view 同时置中（canvas.rs:342）
CMD.reg('view.actual', {i18n:'cmd.view.actual', params:'{}'}, () => { UI.setZoom(1); return {zoom:1}; });
// 菜单放大／缩小走 PS 级距表（canvas.rs:346-351 zoom_step）；缩放工具没载入时退回 ×1.25
CMD.reg('view.zoomIn', {i18n:'cmd.view.zoomIn', params:'{}'}, () => { UI.setZoom(window.zoomStep ? zoomStep(UI.zoom, 1) : UI.zoom*1.25); return {zoom:UI.zoom}; });
CMD.reg('view.zoomOut',{i18n:'cmd.view.zoomOut',params:'{}'}, () => { UI.setZoom(window.zoomStep ? zoomStep(UI.zoom, -1) : UI.zoom/1.25); return {zoom:UI.zoom}; });

/* ── doc.* ── 给 agent 看的 ── */
CMD.reg('doc.inspect', {i18n:'', params:'{} 整份文件的结构：画布尺寸、每层的 id/种类/名字/可见/不透明度/混合模式/内容摘要'}, () => ({
  width:Doc.width, height:Doc.height, activeId:Doc.activeId, selection:Doc.sel,
  layers: Doc.layers.map((L,i)=>({
    index:i, id:L.id, kind:L.kind, name:L.name, visible:L.visible,
    opacity:L.opacity, blend:L.blend, x:L.x, y:L.y, hasMask:!!L.mask,
    fx: L.style ? L.style.items.map(e => e.kind) : [], fillOpacity: L.fillOpacity ?? 1, locks: L.locks || null, linkGroup: L.linkGroup ?? null,
    ...(BlendIf.isDefault(L.blendIf) ? {} : {blendIf: BlendIf.inspect(L.blendIf)}),   // inspect.rs：混合颜色带（有设才列）
    parent: Groups.parentOf(L) ? L.parent : null, depth: Groups.depth(L),   // 图层组：在哪个组里、第几层（0＝顶层）
    content: L.kind==='vector' ? {shapes:L.data.shapes.length}
           : L.kind==='text'   ? {text:L.data.text, size:L.data.size}
           : L.kind==='group'  ? {children:Groups.children(L).map(C => C.id), expanded:L.data.expanded !== false, artboard:L.data.artboard ? JSON.parse(JSON.stringify(L.data.artboard)) : null}
           : L.kind==='smart'  ? smartInfo(L)
           : {w:L.data.canvas.width, h:L.data.canvas.height}
  })).reverse()   // 由上到下，跟图层面板一致
}));
/* 智能对象给 agent 看的摘要 */
function smartInfo(L){
  const d = L.data || {}, e = Smart.sourceOf(L);
  return {source:e ? {id:e.id, name:e.name, type:e.type, w:e.w, h:e.h, linked:e.linked ? JSON.parse(JSON.stringify(e.linked)) : null, loaded:Smart.available(e)} : null,
          transform:(d.transform || AFF_I).slice(), ops:(d.ops || []).map(o => o.type), stackMode:d.stackMode || null,
          filters:(d.filters || []).map((f, i) => ({index:i, command:f.command, visible:f.visible !== false, blend:f.blend || 'normal', opacity:f.opacity === undefined ? 1 : f.opacity})),
          filtersEnabled:d.filtersEnabled !== false, filterMask:L.filterMask ? {enabled:L.filterMask.enabled !== false} : null};
}
CMD.reg('doc.renderPreview', {i18n:'', params:'{maxSize=1200} 把整份文件压平成一张 PNG（dataURL）回传——给模型自己「看」结果'}, p => {
  const m = p.maxSize || 1200;
  const scale = Math.min(1, m/Math.max(Doc.width, Doc.height));
  return {dataURL: composite(scale).toDataURL('image/png'), width:Math.round(Doc.width*scale), height:Math.round(Doc.height*scale)};
});

/* ───────── 工程档 ─────────
   🔴 格式自己定、自己写成规范：一份人与 AI 都读得懂的 JSON。
      像素层存 PNG dataURL；向量／文字层存原始描述（永远还能改）。 */
const Project = {
  FORMAT: 'dilin-canvas', VERSION: 1,
  /* 增量序列化（给网站宿主自动存档）：像素票号 → dataURL 的缓存。票号对得上就沿用，对不上就重编（宁多编、不漏编）。
     opts.reuse=true 才沿用（file.saveProject 下载那条照旧全编）；每次都会把编好的放进缓存。
     lastSerializeStats＝这次 {encoded:[…], reused:[…], refs:[…]}（层 id；蒙版记 'mask:'+层 id；滤镜蒙版 'fmask:'+层 id；
       智能对象的内嵌档 'smart:'+来源 id、存档外观 'smartcache:'+层 id；菜单档补存的画布用它们自己的名字，例：视频影格 'frame:'+影格 id）；lastSerializeRev＝这份对应的 rev。 */
  _pxCache: new Map(), _gen: 0, lastSerializeStats: null, lastSerializeRev: 0, _cur: null,
  /* 菜单档登记：() => [画布…]——serializeAsync 先用 toBlob 编好的额外画布（例：视频影格，menus/impl/ps-layer2.js） */
  asyncCanvases: [],
  _encode(c, label, reuse, stats, gen){
    const t = PX.tok(c);
    if (reuse && t !== undefined){
      const hit = this._pxCache.get(t);
      if (hit){ hit.gen = gen; stats.reused.push(label); return hit.url; }
    }
    const url = c.toDataURL('image/png');
    stats.encoded.push(label);
    if (t !== undefined) this._pxCache.set(t, {url, gen});
    return url;
  },
  /* 菜单档在 serialize 外面补存的画布：跟这次 serialize 同一个沿用／统计（serialize 刚跑完就叫） */
  encodeExtra(c, label){
    const k = this._cur || {reuse:false, stats:{encoded:[], reused:[], refs:[]}, gen:this._gen};
    return this._encode(c, label, k.reuse, k.stats, k.gen);
  },
  /* 一层 → 工程档的一项（顶层与智能对象的内嵌文件共用）。nested＝内嵌文件里的层：各菜单档登记在 LAYER_EXTRA 的栏位一起放进 x2（顶层的由各菜单档自己在外面补） */
  _OUT_KEYS: ['mask','maskOff','style','fillOpacity','locks','linkGroup','isBackground','filterMask','blendIf'],
  _layerOut(L, reuse, stats, gen, nested){
    const M = L.mask || L.maskOff;
    const o = {id:L.id, kind:L.kind, name:L.name, visible:L.visible,
               opacity:L.opacity, blend:L.blend, x:L.x, y:L.y,
               mask: M ? Object.assign({enabled:!!L.mask, image:this._encode(M.data.canvas, 'mask:' + L.id, reuse, stats, gen)}, typeof M.defaultColor === 'number' ? {defaultColor:M.defaultColor} : {}) : null,   // defaultColor：蒙版预设色 0／255（PS，画布变大时补这个色）
               style: L.style || null, fillOpacity: L.fillOpacity, locks: L.locks || null, linkGroup: L.linkGroup, isBackground: L.isBackground};
    if (!BlendIf.isDefault(L.blendIf)) o.blendIf = JSON.parse(JSON.stringify(L.blendIf));   // manifest.rs:224 blend_if（缺省不写）
    if (L.parent !== undefined) o.parent = L.parent;                 // 图层组：在哪个组里（null＝顶层）
    if (L.kind === 'raster'){
      if (SiteHooks.srcValid(L)){
        // 素材引用：置入后像素没被改过 ⇒ 只存云盘档 id＋怎么放（画布宽高、置入矩形），不写 base64
        const c = L.data.canvas;
        o.image = null; o.src = {file_id:L.src.file_id}; o.w = c.width; o.h = c.height; o.place = L._place ? L._place.slice() : [0, 0, c.width, c.height];
        stats.refs.push(L.id);
      } else {
        const v = LayerBox.saveView(L);                 // 只存不透明内容那块＋位移（读回来画面一样；旧版画板也读得懂——画布照 PNG 真尺寸开）
        o.image = this._encode(v.canvas, L.id, reuse, stats, gen);
        if (v.dx || v.dy){ o.x = L.x + v.dx; o.y = L.y + v.dy; }
      }
    }
    else o.data = L.data;
    if (L.kind === 'smart'){
      const fm = L.filterMask;
      if (fm) o.filterMask = {enabled:fm.enabled !== false, x:fm.x || 0, y:fm.y || 0, image:this._encode(fm.data.canvas, 'fmask:' + L.id, reuse, stats, gen)};
      if (Smart.needsCache(L)) o.cache = this._encode(Smart.render(L), 'smartcache:' + L.id, reuse, stats, gen);   // 链接档／滤镜：外观也存（载不到来源、没载滤镜引擎时用；photocraft 的 SmartObject.cache）
    }
    if (nested){
      const x2 = {};
      LAYER_EXTRA.forEach(k => { if (!this._OUT_KEYS.includes(k) && L[k] != null) x2[k] = JSON.parse(JSON.stringify(L[k])); });
      if (Object.keys(x2).length) o.x2 = x2;
    }
    return o;
  },
  /* 智能对象的来源 → 工程档 smartSources 的一项。内容不可变 ⇒ 编过一次就沿用（e._json）；云盘图（src.file_id）与链接档只存引用 */
  _sourceOut(e, reuse, stats, gen){
    if (reuse && e._json){ stats.reused.push('smart:' + e.id); return e._json; }
    const o = {name:e.name, type:e.type, w:e.w, h:e.h};
    if (e.linked) o.linked = JSON.parse(JSON.stringify(e.linked));
    if (e.type === 'image'){
      if (e.src && e.src.file_id){ o.src = {file_id:String(e.src.file_id)}; stats.refs.push('smart:' + e.id); }
      else if (!e.linked && e.image) o.image = this._encode(e.image, 'smart:' + e.id, reuse, stats, gen);
    } else if (e.type === 'layers') o.layers = (e.layers || []).map(L => this._layerOut(L, reuse, stats, gen, true));
    stats.encoded.push('smart:' + e.id);
    e._json = o;
    return o;
  },
  serialize(opts){
    const reuse = !!(opts && opts.reuse);
    SiteHooks.check('serialize');                       // 有没报的改动先报掉，lastSerializeRev 才对得上
    if (Smart.session && Smart.session.parentJSON){     // 正在「编辑内容」（文件暂时换成智能对象的内嵌档）：存的仍是母文件（进编辑前那一份）
      this.lastSerializeStats = {encoded:[], reused:['session'], refs:[]}; this.lastSerializeRev = SiteHooks.rev;
      return JSON.parse(JSON.stringify(Smart.session.parentJSON));
    }
    const gen = ++this._gen, stats = {encoded:[], reused:[], refs:[]};
    this._cur = {reuse, stats, gen};
    const layers = Doc.layers.filter(L => !L._sigSkip);
    const out = {
      format:this.FORMAT, version:this.VERSION, createdBy:'堤麟画板',
      width:Doc.width, height:Doc.height, globalLight: Doc.globalLight || null,
      aiGuides: Doc.aiGuides || [], aiViews: Doc.aiViews || [],   // AI 标尺参考线、存的视图（视图菜单）
      layers: layers.map(L => this._layerOut(L, reuse, stats, gen, false))
    };
    const ids = Smart.collect(layers);                  // 智能对象的嵌入档（内嵌文件里又有智能对象＝一起存）
    if (ids.size){ out.smartSources = {}; ids.forEach(id => { const e = SmartStore.get(id); if (e) out.smartSources[id] = this._sourceOut(e, reuse, stats, gen); }); }
    for (const [k, v] of this._pxCache) if (v.gen < gen - 1) this._pxCache.delete(k);   // 只留这次与上次用到的（dataURL 很大）
    LayerBox.pruneViews(gen);                           // 存档用的裁切画布也只留这次与上次用到的
    this.lastSerializeStats = stats; this.lastSerializeRev = SiteHooks.rev;
    return out;
  },
  /* 非同步版：先用 canvas.toBlob 把要重编的画布一张张编好进缓存（每张之间让出主线程），最后跑一次同步 serialize({reuse:true}) 收尾
     ⇒ 回传格式与同步版一模一样（菜单档包在 serialize 外面加的栏位也都在）。编码期间又被改的层，票号对不上，收尾时会同步重编。
     要先编的：像素层、蒙版、滤镜蒙版、智能对象要存的外观、还没编过的智能对象内嵌档（里面的像素层／蒙版）、菜单档登记的（asyncCanvases，例：视频影格） */
  async serializeAsync(opts){
    if (Smart.session) return this.serialize(opts);
    const jobs = [];
    const addLayer = L => {
      if (L.kind === 'raster' && !SiteHooks.srcValid(L)) jobs.push(LayerBox.saveView(L).canvas);
      [L.mask || L.maskOff, L.filterMask].forEach(M => { if (M) jobs.push(M.data.canvas); });
      if (L.kind === 'smart' && Smart.needsCache(L)) jobs.push(Smart.render(L));
    };
    const layers = Doc.layers.filter(L => !L._sigSkip);
    layers.forEach(addLayer);
    Smart.collect(layers).forEach(id => {
      const e = SmartStore.get(id); if (!e || e._json) return;
      if (e.type === 'image' && e.image && !e.linked && !(e.src && e.src.file_id)) jobs.push(e.image);
      if (e.type === 'layers') (e.layers || []).forEach(addLayer);
    });
    this.asyncCanvases.forEach(f => { try { (f() || []).forEach(c => { if (c) jobs.push(c); }); } catch (e){ console.error(e); } });
    const asyncDone = [];
    for (const c of jobs){
      const t = PX.tok(c);
      if (t === undefined || this._pxCache.has(t)) continue;
      const blob = await new Promise(res => { try { c.toBlob(res, 'image/png'); } catch (e){ res(null); } });   // toBlob 在呼叫当下就取了像素
      if (blob){
        const url = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(blob); });
        if (url){ this._pxCache.set(t, {url, gen:this._gen}); asyncDone.push(t); }
      }
      await new Promise(r => setTimeout(r, 0));                   // 每层之间让出主线程
    }
    const out = this.serialize(Object.assign({}, opts || {}, {reuse:true}));
    if (this.lastSerializeStats) this.lastSerializeStats.asyncEncoded = asyncDone.length;
    return out;
  },
  lastLoadErrors: [],
  // 载好后先 decode（解码在背景执行绪）再交出去——原本 onload 就 drawImage，大图在主执行绪当场解（24 张 5120×3460 约 5 秒卡住页面）
  _img(url){ return new Promise(res => { if (!url) return res(null); const im = new Image(); if (!/^(data|blob):/i.test(url)) im.crossOrigin = 'anonymous'; im.onload = () => { const d = typeof im.decode === 'function' ? im.decode() : null; if (d) d.then(() => res(im), () => res(im)); else res(im); }; im.onerror = () => res(null); im.src = url; }); },
  /* 工程档的一项 → 图层物件（顶层与内嵌文件共用） */
  async _layerIn(o, errors, nested){
    let L;
    if (o.kind === 'raster' && !o.image && o.src && o.src.file_id){
      L = Layer.raster(o.name);
      await SiteHooks.loadRef(L, o, errors);              // 素材引用：问宿主 resolveRef 拿网址；拿不到留一张空层、报错不当掉
    } else if (o.kind === 'raster'){
      // 像素层画布照存档那张 PNG 的真尺寸开（非破坏性裁切后画布比文件大、x/y 带位移——照文件尺寸开会先把可见像素截掉）；解码失败才退回文件尺寸
      const im = await this._img(o.image);
      const w = im ? im.naturalWidth : 0, h = im ? im.naturalHeight : 0;
      // 单纯像素层（没蒙版、不是调整／填充／视频／3D 层）先量不透明内容的外框，只开那块画布、位移记进 L.x/L.y
      // ⇒ 旧档整张透明的大层载进来就是内容那么大；画面一模一样（整数格平移、像素原样拷）
      const box = im && w > 0 && h > 0 && LayerBox.plainJSON(o) ? LayerBox.imageBox(im, w, h) : undefined;
      if (box !== undefined && !(box && box[0] === 0 && box[1] === 0 && box[2] === w && box[3] === h)){
        const bw = box ? box[2] - box[0] : 1, bh = box ? box[3] - box[1] : 1;
        L = Layer.raster(o.name, bw, bh);
        if (box){ L.data.ctx.drawImage(im, -box[0], -box[1]); L._shift = [box[0], box[1]]; }
      } else {
        L = Layer.raster(o.name, w > 0 ? w : undefined, h > 0 ? h : undefined);
        if (im) L.data.ctx.drawImage(im,0,0);
      }
    } else if (o.kind === 'vector'){ L = Layer.vector(o.name); L.data = o.data; }
    else if (o.kind === 'group'){ L = Layer.group(o.name, o.data); }
    else if (o.kind === 'smart'){ L = Layer.smart(o.name, o.data); }
    else { L = Layer.text(o.name, o.data); }
    Object.assign(L, {id:o.id, visible:o.visible, opacity:o.opacity, blend:o.blend, x:o.x, y:o.y});
    if (L._shift){ L.x = (+L.x || 0) + L._shift[0]; L.y = (+L.y || 0) + L._shift[1]; delete L._shift; }   // 只开内容那块画布时多出来的位移
    if (o.parent !== undefined) L.parent = o.parent;
    ['style','fillOpacity','locks','linkGroup','isBackground'].forEach(k => { if (o[k] !== undefined && o[k] !== null) L[k] = o[k]; });
    if (o.blendIf && !BlendIf.isDefault(o.blendIf)) L.blendIf = o.blendIf;
    const maskOf = async (img, id) => {   // 蒙版：PNG 载进一张画布（照 PNG 真尺寸·存的时候多大读回多大·解码失败才用文件大小）
      const c = document.createElement('canvas'); c.width = Doc.width; c.height = Doc.height;
      const cx = c.getContext('2d',{willReadFrequently:true});
      const im = await this._img(img);
      if (im){ const w=im.naturalWidth, h=im.naturalHeight; if (w>0 && h>0 && (w!==c.width || h!==c.height)){ c.width=w; c.height=h; } cx.drawImage(im,0,0); }
      return {id, kind:'raster', name:'mask', visible:true, opacity:1, blend:'normal', mask:null, x:0, y:0, data:{canvas:c, ctx:cx}, _cache:null, _cacheScale:0};
    };
    if (o.mask && o.mask.image){
      const M = await maskOf(o.mask.image, 'M' + o.id);
      if (typeof o.mask.defaultColor === 'number') M.defaultColor = o.mask.defaultColor >= 128 ? 255 : 0;
      if (o.mask.enabled === false) L.maskOff = M; else L.mask = M;
    }
    if (o.filterMask && o.filterMask.image){
      const M = await maskOf(o.filterMask.image, 'F' + o.id);
      M.enabled = o.filterMask.enabled !== false; M.x = +o.filterMask.x || 0; M.y = +o.filterMask.y || 0;
      L.filterMask = M;
    }
    if (o.kind === 'smart' && o.cache){                    // 存档里的外观：来源载不到／滤镜引擎没载时用
      const im = await this._img(o.cache);
      if (im){ const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); L._fallback = c; }
    }
    if (o.x2) Object.assign(L, JSON.parse(JSON.stringify(o.x2)));
    return L;
  },
  /* smartSources 的一项 → SmartStore（id 照存档；同 id 已在＝同一份内容，不再解） */
  async _sourceIn(id, so, errors){
    if (!so || SmartStore.get(id)) return;
    const e = {id, name:so.name || 'contents', type:so.type, w:Math.max(1, +so.w || 1), h:Math.max(1, +so.h || 1)};
    if (so.linked) e.linked = JSON.parse(JSON.stringify(so.linked));
    if (so.src && so.src.file_id) e.src = {file_id:String(so.src.file_id)};
    if (so.type === 'image'){
      let url = so.image || null, err = null;
      if (!url){ const r = await Smart.resolve(e.src || e.linked); url = r.url; err = r.error; }
      const im = url ? await this._img(url) : null;
      if (im){ const c = document.createElement('canvas'); c.width = im.naturalWidth || e.w; c.height = im.naturalHeight || e.h; c.getContext('2d').drawImage(im, 0, 0); e.image = c; e.w = c.width; e.h = c.height; }
      else errors.push({layerId:null, name:e.name, file_id:e.src ? e.src.file_id : (e.linked && e.linked.file_id) || null, url:e.linked && e.linked.url || null, error:err || `智能对象的内容「${e.name}」载不进来（先用存档里的外观）`});
    } else if (so.type === 'layers'){
      const keep = {w:Doc.width, h:Doc.height}; Doc.width = e.w; Doc.height = e.h;       // 内嵌文件的像素层照它自己的尺寸开
      try { e.layers = []; for (const o of so.layers || []) e.layers.push(await this._layerIn(o, errors, true)); }
      finally { Doc.width = keep.w; Doc.height = keep.h; }
    }
    if (Smart.available(e)) e._json = so;                 // 跟存档一模一样 ⇒ 下次存档直接沿用
    SmartStore.put(e);
  },
  /* 载档后 id 计数器接到档内最大号之后：层（L）、矢量形状（S）、切片（SL）共用 _uid，载档只照存档写回 id、计数器却只跟着「这次新建了几个物件」走
     ⇒ 档里有缺号（删过层、栅格化换过 id）时，之后 newRaster／newText／栅格化发的新 id 会撞到档里原有的层；
     撞号的两层 Doc.byId／Doc.active 只认得前面那层，命令就会改到别层。扫整份 json 里每个 id（含智能对象内嵌档、形状、切片）取最大号。 */
  _bumpUid(json){
    let m = 0;
    const walk = (v, depth) => {
      if (!v || typeof v !== 'object' || depth > 200) return;
      if (Array.isArray(v)){ for (const x of v) walk(x, depth + 1); return; }
      for (const k in v){
        const x = v[k];
        if (k === 'id' && typeof x === 'string'){ const r = /^(?:L|S|SL)(\d+)$/.exec(x); if (r) m = Math.max(m, +r[1]); }
        else if (x && typeof x === 'object') walk(x, depth + 1);
      }
    };
    walk(json, 0);
    if (m > _uid) _uid = m;
    return m;
  },
  /* 旧档兼容：存档前就已撞号（上面那个毛病存下来的档）⇒ 第二个以后的同 id 层换一个新 id（组的子层照旧挂前面那个；蒙版 id 跟着换） */
  _dedupeIds(){
    const seen = new Set(); let n = 0;
    for (const L of Doc.layers){
      if (!seen.has(L.id)){ seen.add(L.id); continue; }
      const old = L.id; L.id = uid('L'); n++;
      [L.mask, L.maskOff].forEach(M => { if (M && typeof M.id === 'string' && M.id === 'M' + old) M.id = 'M' + L.id; });
      seen.add(L.id);
    }
    return n;
  },
  async load(json){
    if (!json || json.format !== this.FORMAT) throw new Error('不是堤麟画板的工程档');
    SiteHooks._loading++;                                // 载到一半不报改动（外层包装载完再一次报，见 ui.js）
    try {
    const errors = [];
    if (Smart.session) Smart.endSession(false);           // 正在编辑智能对象内容：放弃，回到母文件再载
    Doc.width = json.width; Doc.height = json.height; Doc.layers = []; History.clear(); Doc.serial++;
    if (window.AiView) AiView.docRestore({guides:json.aiGuides, views:json.aiViews});
    if (json.smartSources) for (const [id, so] of Object.entries(json.smartSources)) await this._sourceIn(id, so, errors);
    for (const o of json.layers) Doc.layers.push(await this._layerIn(o, errors, false));
    this._bumpUid(json);                                  // 新 id 从档内最大号之后接着发（⛔ 撞档里原有的 id）
    this._dedupeIds();                                    // 旧档里已经撞号的层：后面那层换新 id
    Groups.normalize();
    Doc.globalLight = json.globalLight || undefined;
    Doc.activeId = Doc.layers.length ? Doc.layers[Doc.layers.length-1].id : null;
    this.lastLoadErrors = errors;
    if (errors.length){
      console.error('[堤麟画板] 工程档里有素材引用载不进来（留了空层）：', errors);
      Locks.notify(Lang.t('site.refFail').replace('{n}', errors.length).replace('{names}', errors.map(e => e.name).join('、')));
    }
    if (window.UI){ UI.fit(); UI.refresh(); }
    if (window.HandView) HandView.reset();  // 开工程后视角回正中
    } finally { SiteHooks._loading--; LayerBox.releaseScratch(); }
  },
  toSVG(){
    const esc = s => String(s).replace(/[<>&"]/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
    const T = Groups.tree();
    const list = ls => ls.map(L => this._svgLayer(L, T, esc, list)).join('');
    const body = list(T.of(null));
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Doc.width}" height="${Doc.height}" viewBox="0 0 ${Doc.width} ${Doc.height}">\n${body}</svg>`;
  },
  /* 一层的 SVG：组＝<g>（子层在里面；画板＝裁到板子＋铺背景）；智能对象＝外观嵌成图 */
  _svgLayer(L, T, esc, list){
    if (!L.visible || L._sigSkip) return '';
    const op = L.opacity !== 1 ? ` opacity="${L.opacity}"` : '';
    if (L.kind === 'group'){
      const A = L.data && L.data.artboard, kids = list(T.of(L.id));
      const mb = L.blend && L.blend !== 'normal' && L.blend !== 'passThrough' ? ` style="mix-blend-mode:${L.blend.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}"` : '';
      if (A && Array.isArray(A.rect)){
        const [x, y, w, h] = A.rect, cid = 'ab_' + L.id, bg = Groups.artboardColor(A.background);
        return `<g id="${L.id}" data-kind="artboard" data-name="${esc(L.name)}"${op} clip-path="url(#${cid})">\n<defs><clipPath id="${cid}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs>\n` +
               (bg ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}"/>\n` : '') + kids + `</g>\n`;
      }
      return `<g id="${L.id}" data-kind="group" data-name="${esc(L.name)}"${op}${mb}>\n${kids}</g>\n`;
    }
    if (L.kind === 'smart') return `<image id="${L.id}" data-kind="smart" xlink:href="${Smart.render(L).toDataURL('image/png')}" x="0" y="0" width="${Doc.width}" height="${Doc.height}"${op}/>\n`;
    const fx = svgFilterOf(L);
    if (fx === 'bake') return `<image id="${L.id}" data-kind="${L.kind}" data-name="${esc(L.name)}" xlink:href="${svgBakedURL(L)}" x="0" y="0" width="${Doc.width}" height="${Doc.height}"${op}/>\n`;
    let body = '';
    if (L.kind === 'vector'){
      body += `<g id="${L.id}" data-name="${esc(L.name)}"${op} transform="translate(${L.x},${L.y})">\n`;
      for (const s of L.data.shapes){
        if (window.ObjRender && ObjRender.handles(s)){ body += '  ' + ObjRender.toSVG(s) + '\n'; continue; }
        let defs = '';   // 渐变填色／描边 ⇒ <defs> 里一个 linearGradient／radialGradient（GradientFill.toSVG）
        const svgPaint = (v, k) => (v && typeof v === 'object') ? (window.GradientFill ? (defs += GradientFill.toSVG(v, s.id + '_' + k), `url(#${s.id}_${k})`) : 'none') : (v || 'none');
        const pa = `fill="${svgPaint(s.fill,'f')}" stroke="${svgPaint(s.stroke,'s')}" stroke-width="${s.strokeWidth||0}"`;
        if (defs) body += `  <defs>${defs}</defs>\n`;
        if (s.type==='rect') body += `  <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.radius||0}" ${pa}/>\n`;
        else if (s.type==='ellipse') body += `  <ellipse cx="${s.x+s.w/2}" cy="${s.y+s.h/2}" rx="${Math.abs(s.w/2)}" ry="${Math.abs(s.h/2)}" ${pa}/>\n`;
        else if (s.type==='bezier') body += `  <path d="${bezierD(s)}" ${pa}/>\n`;
        else if (s.type==='mesh') body += (window.MeshRender ? MeshRender.toSVG(s) : '');
        else {
          const pts = svgPoints(s);
          const open = (s.type==='path' || s.type==='line') && !s.closed;   // 开放折线画布上是开的，SVG 也要开（polyline）
          if (pts) body += `  <${open ? 'polyline' : 'polygon'} points="${pts}" ${pa}/>\n`;
        }
      }
      body += `</g>\n`;
    } else if (L.kind === 'text' && window.TouchType && TouchType.touched(L)){
      body += TouchType.toSVG(L, op);
    } else if (L.kind === 'text'){
      const d = L.data;
      const XM = window.TextXform && TextXform.doc(L);   // 文字层的斜切／旋转（tools/move.js TextXform）
      const lines = (window.TypeTool && TypeTool.wrapLines) ? TypeTool.wrapLines(d) : String(d.text).split('\n'), al = String(d.align || 'left');
      const anchor = al === 'center' ? 'middle' : (al === 'right' || al === 'end') ? 'end' : 'start', X = d.x + L.x, Y = d.y + L.y;
      const wt = d.weight && !/^(normal|400)$/i.test(String(d.weight)) ? ` font-weight="${esc(d.weight)}"` : '';
      const inner = lines.length > 1 ? lines.map((t, i) => `<tspan x="${X}" y="${+(Y + i * textLineH(d)).toFixed(3)}">${esc(t)}</tspan>`).join('') : esc(lines[0] || '');
      body += `<text data-name="${esc(L.name)}" x="${X}" y="${Y}" font-size="${d.size}" font-family="${esc(svgFontFamily(d, lines.join(' ')))}"${wt} text-anchor="${anchor}" fill="${d.color}" xml:space="preserve"${XM ? ` transform="matrix(${XM.join(' ')})"` : ''}${op}>${inner}</text>\n`;
    } else if (L.data && L.data.canvas){
      body += `<image data-name="${esc(L.name)}" xlink:href="${L.data.canvas.toDataURL('image/png')}" x="${L.x}" y="${L.y}" width="${L.data.canvas.width}" height="${L.data.canvas.height}"${op}/>\n`;
    }
    if (fx && body) body = `<defs>${fx.def}</defs>\n<g data-name="${esc(L.name)}" filter="url(#${fx.id})">\n${body}</g>\n`;
    return body;
  }
};
/* SVG 给 Illustrator 2020 也读得对：
   像素用 xlink:href（AI 2020 不认 SVG2 的 href，当成找不到的外链）；文字照画布的对齐写 text-anchor、照 wrapLines 拆 tspan、
   字体写真的字体名再接通用名（只写 sans-serif AI 认不得、只能替换）；图层样式写成 <filter>（投影、内阴影、外发光、内发光、描边、颜色叠加，
   各一个），别的样式（缎面、渐变叠加、斜面…）或同种多个 ⇒ 那层连样式照画面嵌成一张图。 */
const SVG_FX = ['dropShadow', 'innerShadow', 'outerGlow', 'innerGlow', 'stroke', 'colorOverlay'];
function svgFontFamily(d, text){
  const raw = String(d.font || 'sans-serif'), first = raw.split(',')[0].trim().replace(/^["']|["']$/g, ''), low = first.toLowerCase();
  const cjk = /[　-鿿豈-﫿＀-￯]/.test(text);
  let real = null;
  if (/^(sans-serif|system-ui|ui-sans-serif|-apple-system)$/.test(low)) real = cjk ? (window.Lang && Lang.cur === 'zh-Hans' ? 'Microsoft YaHei' : 'Microsoft JhengHei') : 'Arial';
  else if (/^(serif|ui-serif)$/.test(low)) real = cjk ? (window.Lang && Lang.cur === 'zh-Hans' ? 'SimSun' : 'PMingLiU') : 'Times New Roman';
  else if (/^(monospace|ui-monospace)$/.test(low)) real = 'Courier New';
  if (!real) return raw.replace(/"/g, "'");
  const gen = /serif$/.test(low) && !/sans/.test(low) ? 'serif' : low === 'monospace' || low === 'ui-monospace' ? 'monospace' : 'sans-serif';
  return `'${real}', ${gen}`;
}
const svgFxColor = c => String(c || '#000').replace(/"/g, '');
/* 一层的图层样式 ⇒ {id, def}（<filter>）／'bake'（SVG 表达不了）／null（没样式） */
function svgFilterOf(L){
  if (!(window.PsLayerStyle && PsLayerStyle.has(L))) return null;
  const items = L.style.items.filter(e => e.enabled !== false), seen = new Set();
  for (const e of items){ if (!SVG_FX.includes(e.kind) || seen.has(e.kind)) return 'bake'; seen.add(e.kind); }
  if (!items.length) return null;
  const gl = Doc.globalLight && typeof Doc.globalLight.angle === 'number' ? Doc.globalLight.angle : 120;
  const by = k => items.find(e => e.kind === k), n = v => +(+v || 0).toFixed(3), id = 'fx_' + L.id;
  const fl = (e, r) => `<feFlood flood-color="${svgFxColor(e.color)}" flood-opacity="${n(e.opacity === undefined ? 1 : e.opacity)}" result="${r}c"/>`;
  const off = e => { const a = (e.useGlobalLight ? gl : (+e.angle || 0)) * Math.PI / 180, d = +e.distance || 0; return [n(-Math.cos(a) * d), n(Math.sin(a) * d)]; };
  let f = '', under = [], over = [];
  const ds = by('dropShadow'); if (ds){ const [dx, dy] = off(ds);
    f += `<feMorphology in="SourceAlpha" operator="dilate" radius="${n((+ds.size || 0) * (ds.spread || 0))}" result="dsm"/><feGaussianBlur in="dsm" stdDeviation="${n((+ds.size || 0) * (1 - (ds.spread || 0)) / 2)}" result="dsb"/><feOffset in="dsb" dx="${dx}" dy="${dy}" result="dso"/>${fl(ds, 'ds')}<feComposite in="dsc" in2="dso" operator="in" result="ds"/>`; under.push('ds'); }
  const og = by('outerGlow'); if (og){
    f += `<feMorphology in="SourceAlpha" operator="dilate" radius="${n((+og.size || 0) * (og.spread || 0))}" result="ogm"/><feGaussianBlur in="ogm" stdDeviation="${n((+og.size || 0) * (1 - (og.spread || 0)) / 2)}" result="ogb"/>${fl(og, 'og')}<feComposite in="ogc" in2="ogb" operator="in" result="og"/>`; under.push('og'); }
  const st = by('stroke'); if (st){ const z = +st.size || 0, pos = st.position || 'outside';
    if (pos === 'inside'){ f += `<feMorphology in="SourceAlpha" operator="erode" radius="${n(z)}" result="ste"/><feComposite in="SourceAlpha" in2="ste" operator="out" result="str"/>`; }
    else { f += `<feMorphology in="SourceAlpha" operator="dilate" radius="${n(pos === 'center' ? z / 2 : z)}" result="std"/>` + (pos === 'center' ? `<feMorphology in="SourceAlpha" operator="erode" radius="${n(z / 2)}" result="ste"/><feComposite in="std" in2="ste" operator="out" result="str"/>` : `<feComposite in="std" in2="SourceAlpha" operator="out" result="str"/>`); }
    f += `${fl(st, 'st')}<feComposite in="stc" in2="str" operator="in" result="st"/>`; (pos === 'outside' ? under : over).push('st'); }
  const co = by('colorOverlay'); if (co){ f += `${fl(co, 'co')}<feComposite in="coc" in2="SourceAlpha" operator="in" result="co"/>`; over.unshift('co'); }
  const ig = by('innerGlow'); if (ig){
    const src = ig.source === 'center' ? `<feMorphology in="SourceAlpha" operator="erode" radius="${n((+ig.size || 0) / 2)}" result="igm"/><feGaussianBlur in="igm" stdDeviation="${n((+ig.size || 0) / 2)}" result="igb"/>`
      : `<feComponentTransfer in="SourceAlpha" result="igi"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer><feGaussianBlur in="igi" stdDeviation="${n((+ig.size || 0) / 2)}" result="igb"/>`;
    f += `${src}${fl(ig, 'ig')}<feComposite in="igc" in2="igb" operator="in" result="igk"/><feComposite in="igk" in2="SourceAlpha" operator="in" result="ig"/>`; over.push('ig'); }
  const is = by('innerShadow'); if (is){ const [dx, dy] = off(is);
    f += `<feComponentTransfer in="SourceAlpha" result="isi"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer><feGaussianBlur in="isi" stdDeviation="${n((+is.size || 0) / 2)}" result="isb"/><feOffset in="isb" dx="${dx}" dy="${dy}" result="iso"/>${fl(is, 'is')}<feComposite in="isc" in2="iso" operator="in" result="isk"/><feComposite in="isk" in2="SourceAlpha" operator="in" result="is"/>`; over.push('is'); }
  const merge = [...under.reverse(), 'SourceGraphic', ...over].map(r => `<feMergeNode in="${r}"/>`).join('');
  return {id, def:`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${f}<feMerge>${merge}</feMerge></filter>`};
}
/* 这层连样式、蒙版照画面画成一张文件大小的图（不透明度另记在 <image> 上） */
function svgBakedURL(L){
  const c = document.createElement('canvas'); c.width = Doc.width; c.height = Doc.height;
  const keep = [L.visible, L.opacity, L.blend]; L.visible = true; L.opacity = 1; L.blend = 'normal';
  try { compositeOne(c.getContext('2d'), L, 1); } finally { L.visible = keep[0]; L.opacity = keep[1]; L.blend = keep[2]; }
  return c.toDataURL('image/png');
}
function svgPoints(s){
  if (s.type==='path' || s.type==='line') return (s.points||[]).map(p=>p.join(',')).join(' ');
  if (s.type==='star' || s.type==='polygon'){
    const n = s.points || (s.type==='star' ? 5 : 6), steps = s.type==='star'?n*2:n, rot=(s.rotation||0)*Math.PI/180 - Math.PI/2, out=[];   // 多边形缺省 6 边，与 drawShape 一致
    for (let i=0;i<steps;i++){
      const r = (s.type==='star' && i%2) ? s.r2 : s.r1;
      const a = rot + i*Math.PI*2/steps;
      out.push(`${(s.cx+Math.cos(a)*r).toFixed(2)},${(s.cy+Math.sin(a)*r).toFixed(2)}`);
    }
    return out.join(' ');
  }
  return null;
}

/* ───────── 像素绘制 ───────── */
const Paint = {
  /* 🔴 进到这里的 pts 已经是「图层坐标」（上面的命令换算过了）；
        选区 Doc.sel 是文件坐标，所以 clip 时也要减掉图层位移。 */
  stroke(L, pts, o){
    const ctx = L.data.ctx;
    ctx.save();
    if (Doc.sel){ ctx.beginPath(); ctx.rect(Doc.sel.x-L.x, Doc.sel.y-L.y, Doc.sel.w, Doc.sel.h); ctx.clip(); }
    ctx.globalCompositeOperation = o.erase ? 'destination-out' : 'source-over';
    ctx.lineWidth = o.size || 20; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = o.color || '#000';
    if ((o.hardness !== undefined ? o.hardness : 1) < 1) ctx.filter = `blur(${(1-o.hardness)*(o.size||20)/4}px)`;
    ctx.beginPath();
    pts.forEach((p,i)=> i ? ctx.lineTo(p[0],p[1]) : ctx.moveTo(p[0],p[1]));
    if (pts.length === 1) ctx.lineTo(pts[0][0]+0.01, pts[0][1]);
    ctx.stroke(); ctx.restore();
  },
  /* 仿制图章：把取样点那一带的像素，照「笔尖位置 − 取样点」这个固定位移复制过来。
     aligned=true（预设，同 PS）：位移在整笔之间保持不变。 */
  clone(L, pts, src, o){
    if (!pts.length) return;
    const ctx = L.data.ctx, size = o.size || 40;
    const snap = document.createElement('canvas');          // 先拍一张快照，免得边复制边读到刚写进去的
    snap.width = L.data.canvas.width; snap.height = L.data.canvas.height;
    snap.getContext('2d').drawImage(L.data.canvas, 0, 0);
    const dx = pts[0][0] - src[0], dy = pts[0][1] - src[1];  // 固定位移
    ctx.save();
    if (Doc.sel){ ctx.beginPath(); ctx.rect(Doc.sel.x-L.x, Doc.sel.y-L.y, Doc.sel.w, Doc.sel.h); ctx.clip(); }
    for (const [px,py] of pts){
      ctx.save();
      ctx.beginPath(); ctx.arc(px, py, size/2, 0, Math.PI*2); ctx.clip();
      if ((o.hardness !== undefined ? o.hardness : 1) < 1) ctx.filter = `blur(${(1-o.hardness)*size/5}px)`;
      ctx.drawImage(snap, dx, dy);                           // 整张按位移贴，靠 clip 只留笔尖那一圈
      ctx.restore();
    }
    ctx.restore();
  },
  bucket(L, x, y, color, tol){
    const ctx = L.data.ctx, W = L.data.canvas.width, H = L.data.canvas.height;
    if (x<0||y<0||x>=W||y>=H) return;
    const img = ctx.getImageData(0,0,W,H), d = img.data;
    const at = (px,py) => (py*W+px)*4;
    const s = at(x,y), t = [d[s],d[s+1],d[s+2],d[s+3]];
    const c = hexToRGB(color);
    if (Math.abs(t[0]-c[0])<2 && Math.abs(t[1]-c[1])<2 && Math.abs(t[2]-c[2])<2 && t[3]===255) return;
    const ok = i => Math.abs(d[i]-t[0])<=tol && Math.abs(d[i+1]-t[1])<=tol && Math.abs(d[i+2]-t[2])<=tol && Math.abs(d[i+3]-t[3])<=tol;
    const st = [[x,y]], seen = new Uint8Array(W*H);
    while (st.length){
      const [px,py] = st.pop();
      if (px<0||py<0||px>=W||py>=H) continue;
      const k = py*W+px; if (seen[k]) continue; seen[k]=1;
      const i = k*4; if (!ok(i)) continue;
      d[i]=c[0]; d[i+1]=c[1]; d[i+2]=c[2]; d[i+3]=255;
      st.push([px+1,py],[px-1,py],[px,py+1],[px,py-1]);
    }
    ctx.putImageData(img,0,0);
  }
};
function hexToRGB(h){
  h = String(h).replace('#','');
  if (h.length===3) h = h.split('').map(c=>c+c).join('');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

/* ───────── 导出 ───────── */
function exportPNG(scale, name){
  const c = composite(scale);                     // 铁律①：向量层按这个 scale 重画
  return new Promise(res => c.toBlob(b => {
    download(b, (name||'untitled') + (scale!==1?`@${scale}x`:'') + '.png');
    res({width:c.width, height:c.height, bytes:b.size});
  }, 'image/png'));
}
function download(blob, filename){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}

/* ───────── 给网站宿主的钩子 ─────────
   宿主（同源 iframe 外层）要的四件事都在这里，说明见 说明.md「给网站宿主的钩子」：
   ① 改动事件：内容签名 sig 变了才 rev++ 发 window 'dl:change' {rev, cmd}（选区、当前层、视角不算内容）
   ② 已存基准：markSaved(rev?)／isDirty
   ③ 本机素材：window.__dlSiteHooks.onLocalFile(file, {kind}) 先问宿主
   ④ 素材引用：像素层 L.src={file_id}，载入时 window.__dlSiteHooks.resolveRef({file_id}) 换网址 */
if (typeof Lang !== 'undefined' && Lang.add) Lang.add({
  'zh-Hant':{'site.refFail':'有 {n} 個圖層的素材載不進來（{names}），先留空白圖層；存檔時仍保留原素材引用。'},
  'zh-Hans':{'site.refFail':'有 {n} 个图层的素材载不进来（{names}），先留空白图层；存档时仍保留原素材引用。'},
  'en':{'site.refFail':'Could not load the source image of {n} layer(s) ({names}); left them empty. Saving keeps the original reference.'}
});
/* 图层组／智能对象的三语（照 PS 2020 繁／简中介面正名） */
if (typeof Lang !== 'undefined' && Lang.add) Lang.add({
  'zh-Hant':{'layer.group':'群組', 'layer.smart':'智慧型物件', 'layer.artboard':'工作區域', 'blend.passThrough':'穿透', 'smart.editing':'正在編輯智慧型物件「{name}」的內容', 'smart.done':'完成並更新', 'smart.cancel':'取消', 'smart.filters':'智慧型濾鏡'},
  'zh-Hans':{'layer.group':'组', 'layer.smart':'智能对象', 'layer.artboard':'画板', 'blend.passThrough':'穿透', 'smart.editing':'正在编辑智能对象「{name}」的内容', 'smart.done':'完成并更新', 'smart.cancel':'取消', 'smart.filters':'智能滤镜'},
  'en':{'layer.group':'Group', 'layer.smart':'Smart Object', 'layer.artboard':'Artboard', 'blend.passThrough':'Pass Through', 'smart.editing':'Editing the contents of smart object "{name}"', 'smart.done':'Done & Update', 'smart.cancel':'Cancel', 'smart.filters':'Smart Filters'}
});
const SiteHooks = {
  rev: 0, savedRev: 0,
  _sig: null, _savedSig: null, _sigs: new Map(),   // rev → 当时的签名（undo 回到已存那一步就不算脏）
  _subs: new Set(), _loading: 0, _suspend: 0, _pending: null, _timer: 0,   // _suspend：正在编辑智能对象内容（文件暂时换成内嵌档），不报改动

  /* ── 内容签名：凡是存进工程档的都要算进来；像素用票号（不读像素，便宜） ── */
  _J(v){ if (v === undefined) return ''; try { return JSON.stringify(v); } catch (e){ return '?'; } },
  _layerSig(L){
    const parts = [L.id, L.kind, L.name, L.visible, L.opacity, L.blend, L.x, L.y];
    for (const k of Object.keys(L)){                       // 其余栏位（样式、锁、菜单档加的栏位…）一律 JSON；底线开头的是快取／内部，跳过
      if (k[0] === '_' || k === 'data' || k === 'mask' || k === 'maskOff' || k === 'filterMask' || k === 'id' || k === 'kind' || k === 'name' ||
          k === 'visible' || k === 'opacity' || k === 'blend' || k === 'x' || k === 'y' || L[k] === undefined) continue;
      parts.push(k + '=' + this._J(L[k]));             // 图层组的 parent（在哪个组里）也在这里
    }
    const pxs = c => c ? PX.tok(c) + '@' + c.width + 'x' + c.height : '-';
    parts.push('m:' + (L.mask ? pxs(L.mask.data.canvas) : '-'), 'mo:' + (L.maskOff ? pxs(L.maskOff.data.canvas) : '-'));
    // 组：data＝{expanded, artboard}；智能对象：data＝来源 id（内容不可变）＋变换＋变形＋智能滤镜＋堆栈模式，滤镜蒙版另记票号
    if (L.filterMask) parts.push('fm:' + pxs(L.filterMask.data.canvas) + (L.filterMask.enabled === false ? 'off' : 'on') + (L.filterMask.x || 0) + ',' + (L.filterMask.y || 0));
    parts.push(L.kind === 'raster' ? 'px:' + pxs(L.data && L.data.canvas) : 'd:' + this._J(L.data));
    return parts.join('\u0002');
  },
  sig(){
    const parts = ['s' + Doc.serial, Doc.width, Doc.height];
    for (const k of Object.keys(Doc)){                     // 文件层级的栏位（globalLight、dpi、参考线、菜单档加的…）
      if (k[0] === '_' || k === 'layers' || k === 'activeId' || k === 'sel' || k === 'serial' || k === 'width' || k === 'height') continue;
      const v = Doc[k]; if (typeof v === 'function' || v === undefined) continue;   // undefined 跟没这个键一样（回滚会写 Doc.dpi = undefined）
      parts.push(k + '=' + this._J(v));
    }
    for (const L of Doc.layers) if (!L._sigSkip) parts.push(this._layerSig(L));   // 层的先后（含组的结构）就是这串的顺序；_sigSkip＝暂时的代理层
    for (const f of this.extraSigs){ try { parts.push(f()); } catch (e){ parts.push('?'); } }   // 存在 Doc 外面、但会存进工程档的（菜单档登记，例：视频影格）
    return parts.join('\u0001');
  },
  /* 菜单档登记：() => 字串——Doc 以外、但存档会带的内容（例：menus/impl/ps-layer2.js 的视频影格库 FRAMES） */
  extraSigs: [],

  /* ── 比对：变了才 rev++ 发事件 ── */
  _busy(){ return typeof Pointer !== 'undefined' && Pointer.down; },   // 笔画进行中：等放开（Pointer.onUp 那里再比）
  check(cmd){
    if (this._loading || this._suspend) return false;
    if (this._busy()){ this._pending = this._pending || cmd || 'pointer'; return false; }
    this._dropStaleSrc();
    const s = this.sig();
    if (s === this._sig) return false;
    this._commit(s, cmd);
    return true;
  },
  _commit(s, cmd){
    this._sig = s; this.rev++; this._pending = null;
    this._sigs.set(this.rev, s);
    if (this._sigs.size > 200) this._sigs.delete(this._sigs.keys().next().value);
    const detail = {rev:this.rev, cmd:cmd || null};
    for (const cb of [...this._subs]){ try { cb(detail); } catch (e){ console.error(e); } }
    try { window.dispatchEvent(new CustomEvent('dl:change', {detail})); } catch (e){ console.error(e); }
  },
  /* 强制记一次改动（Project.load 载完用：签名一定变，但就算没变也要报） */
  force(cmd){ this._dropStaleSrc(); this._commit(this.sig(), cmd); },
  after(cmd){ this.check(cmd); },
  /* 延后一拍再比（直接叫 History、键盘、滑杆等不走 CMD 的地方）；同一拍只比一次 */
  later(cmd){
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = 0; this.check(this._pending || cmd); }, 0);
  },
  flushPointer(){ const c = this._pending || ('tool.' + (typeof ToolState !== 'undefined' ? ToolState.cur : 'pointer')); this._pending = null; this.check(c); },

  markSaved(rev){
    if (rev === undefined || rev === null){ this.check('markSaved'); rev = this.rev; }
    rev = Math.max(0, Math.min(this.rev, Math.floor(+rev) || 0));
    this.savedRev = rev; this._savedSig = this._sigs.get(rev) || null;
    return rev;
  },
  isDirty(){
    this.check('isDirty');
    if (this.rev === this.savedRev) return false;
    return !(this._savedSig && this._savedSig === this._sig);   // undo 回到已存那一步＝不脏
  },
  onChange(cb){ if (typeof cb !== 'function') throw new Error('onChange(cb) 要一支函式'); this._subs.add(cb); return () => this._subs.delete(cb); },

  /* ── 素材引用 ── */
  srcValid(L){
    return !!(L && L.kind === 'raster' && L.src && L.src.file_id && L.data && L.data.canvas &&
              L._srcPx !== undefined && PX.tok(L.data.canvas) === L._srcPx);
  },
  _dropStaleSrc(){                                       // 像素一被改 ⇒ src 作废（undo 回去由快照把 src 带回来）
    for (const L of Doc.layers) if (L.src && !this.srcValid(L)){ delete L.src; delete L._srcPx; }
  },
  setLayerSource(layerId, ref){
    const L = Doc.byId(layerId);
    if (!L) return {ok:false, error:'no such layer: ' + layerId};
    if (L.kind !== 'raster') return {ok:false, error:'not a pixel layer'};
    if (ref === null){ delete L.src; delete L._srcPx; this.check('setLayerSource'); return {ok:true, cleared:true}; }
    if (!ref || !ref.file_id) return {ok:false, error:'need {file_id}'};
    const t = PX.tok(L.data.canvas);
    if (!L._place || L._placePx === undefined || t !== L._placePx)
      return {ok:false, error:'像素在置入后已被改过（或不是置入的图），不能换成引用；存档会照旧存像素'};
    L.src = {file_id:String(ref.file_id)}; L._srcPx = t;
    this.check('setLayerSource');
    return {ok:true, layerId:L.id, src:{file_id:L.src.file_id}};
  },
  /* fileId 可能是字串或 Promise（宿主背景上传完才知道）*/
  applyFileId(layerId, fileId){
    if (!layerId || !fileId) return;
    Promise.resolve(fileId).then(id => { if (id) this.setLayerSource(layerId, {file_id:id}); }).catch(e => console.warn('[堤麟画板] 宿主上传没回 file_id：', e));
  },
  /* Project.load 遇到 src：问宿主 resolveRef 拿网址，照存的画布宽高与置入矩形画回去 */
  async loadRef(L, o, errors){
    const c = L.data.canvas;
    const w = +o.w > 0 ? +o.w : Doc.width, h = +o.h > 0 ? +o.h : Doc.height;
    let place = Array.isArray(o.place) && o.place.length === 4 ? o.place.map(Number) : [0, 0, w, h];
    // 画布只开置入矩形那块（旧档 w/h 是整张文件大）；多出来的位移记在 L._shift，_layerIn 套完 x/y 再加上
    const X0 = Math.max(0, Math.floor(Math.min(place[0], place[0] + place[2]))), Y0 = Math.max(0, Math.floor(Math.min(place[1], place[1] + place[3])));
    const X1 = Math.min(w, Math.ceil(Math.max(place[0], place[0] + place[2]))), Y1 = Math.min(h, Math.ceil(Math.max(place[1], place[1] + place[3])));
    if (X1 > X0 && Y1 > Y0 && (X0 || Y0 || X1 !== w || Y1 !== h)){
      if (c.width !== X1 - X0) c.width = X1 - X0; if (c.height !== Y1 - Y0) c.height = Y1 - Y0;
      place = [place[0] - X0, place[1] - Y0, place[2], place[3]];
      L._shift = [X0, Y0];
    } else { if (c.width !== w) c.width = w; if (c.height !== h) c.height = h; }
    const fid = String(o.src.file_id);
    let err = null;
    const H = window.__dlSiteHooks;
    if (!H || typeof H.resolveRef !== 'function') err = `图层「${o.name}」引用云盘素材 file_id=${fid}，但宿主没提供 window.__dlSiteHooks.resolveRef，载不进来（留空层）`;
    else {
      try {
        let u = await H.resolveRef({file_id:fid});
        if (u && typeof u === 'object') u = u.url;
        if (!u) err = `resolveRef 没给 file_id=${fid} 的网址（图层「${o.name}」留空层）`;
        else {
          const im = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('图片载入失败：' + u)); i.src = u; });
          L.data.ctx.imageSmoothingQuality = 'high';
          L.data.ctx.drawImage(im, place[0], place[1], place[2], place[3]);
        }
      } catch (e){ err = `图层「${o.name}」的素材 file_id=${fid} 载入失败：${e && e.message || e}（留空层）`; }
    }
    // 载不进来也保留引用：再存档时引用还在，素材不会因为一次没载到就丢
    L.src = {file_id:fid}; L._place = place; L._placePx = L._srcPx = PX.tok(c);
    if (err) errors.push({layerId:o.id, name:o.name, file_id:fid, error:err});
  },

  /* ── 本机档进画板：先问宿主 ── */
  hasLocalHook(){ const H = window.__dlSiteHooks; return !!(H && typeof H.onLocalFile === 'function'); },
  /* 回 {handled, fileId?}。宿主出错：图片照旧放（不挡人用）；工程档当作宿主接手失败、不在本机直接开（免得绕过宿主覆盖云盘档） */
  async askLocal(file, kind){
    if (!this.hasLocalHook()) return {handled:false};
    try {
      const r = await window.__dlSiteHooks.onLocalFile(file, {kind});
      if (!r) return {handled:false};
      return {handled:!!r.handled, fileId:r.fileId || r.file_id || null};
    } catch (e){
      console.error('[堤麟画板] 宿主 onLocalFile 出错：', e);
      return kind === 'project' ? {handled:true, error:String(e && e.message || e)} : {handled:false};
    }
  }
};
window.SiteHooks = SiteHooks;

/* ───────── 给 agent 的门 ─────────
   界面上露的是精选；这里给的是全部。 */
window.Locks = Locks;
window.DilinCanvas = {
  version: '0.1',
  run: (id, params) => CMD.run(id, params),
  listCommands: f => CMD.list(f),
  inspect: () => CMD.run('doc.inspect'),
  renderPreview: p => CMD.run('doc.renderPreview', p||{}),
  humanLock: (on, o) => window.HumanLock ? HumanLock.set(on, o) : null,   // AI 正在画时挡人手（宿主遮罩用·humanlock.js）
  // 给网站宿主（自动存档／素材管理·说明.md「给网站宿主的钩子」）
  rev: () => SiteHooks.rev,
  onChange: cb => SiteHooks.onChange(cb),
  markSaved: rev => SiteHooks.markSaved(rev),
  isDirty: () => SiteHooks.isDirty(),
  savedRev: () => SiteHooks.savedRev,
  serialize: opts => Project.serialize(opts),
  serializeAsync: opts => Project.serializeAsync(opts),
  setLayerSource: (layerId, ref) => SiteHooks.setLayerSource(layerId, ref),
  doc: Doc, history: History, project: Project
};

/* 核心物件一定义就挂到 window（以前要等 ui.js 档尾才挂）：顶层 const 不会成为 window 的属性，
   菜单实作档载入时用 `window.Project && …`／`window.History && …` 判断要不要接钩子——单独测时它们在页面载完后才载、看得到；
   全挂进 index.html 后在 ui.js 之前载、看不到 ⇒ 钩子静悄悄没接上（例：ps-type 的工程档 typeStyles、SVG 变形文字） */
Object.assign(window, {Doc, Layer, History, CMD, Project});
