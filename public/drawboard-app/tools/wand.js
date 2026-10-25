/* 魔术棒（W；AI 版面是 Y）——照 ArtCraft 的 Rust 原码逐段翻译
   一颗工具两套行为，按当前图层种类分岔（for:'common'）：
   ■ 像素层／文字层／没有图层 ⇒ PhotoCraft 魔棒：按颜色容差选像素，结果写进 Doc.sel（marquee.js 的 mask 格式）
       photocraft/crates/ui-egui/src/canvas.rs 2058-2063     按下＝叫一次 select.magicWand（x,y floor、容差、连续、消锯齿、取样所有图层、模式）
       photocraft/crates/ui-egui/src/canvas.rs 2255-2257     selection_mode → tool_feedback::selection_mode（⇧⌥ 交集、⇧ 加、⌥ 减，否则选项栏）
       photocraft/crates/ui-egui/src/tool_feedback.rs 35-106 选取类工具游标旁的 ＋／−／× 标记
       photocraft/crates/ui-egui/src/panels.rs 607-622      选项栏：四个模式钮、容差 0..255、消除锯齿、连续、取样所有图层、（选择主体、选择并遮住）
       photocraft/crates/ui-egui/src/panels.rs 2332-2348    模式钮（selection_mode 是所有选取工具共用的一个栏位）
       photocraft/crates/ui-egui/src/state.rs 309-312,416-419  预设：容差 32、连续 开、消锯齿 开、取样所有图层 关（跟油漆桶共用同一组 tool_options）
       photocraft/crates/engine/src/selection_cmds.rs 58-83,327-334  sample_rgba8（当前层的表面；没有表面或勾了所有图层＝合成图）、magic_wand、参数说明
       photocraft/crates/algo/src/selection.rs 153-203      magic_wand（f32 参考版：四通道含 alpha 各自差 ≤ 容差、4 连通）
       photocraft/crates/algo/src/selection.rs 245-361      wand_region（正式版：扫描线填充／全图比对，消锯齿＝边缘 3×3 平均，外扩一圈）
       photocraft/crates/algo/src/selection.rs 363-404      combine_region（只动区域外框：取代／加／减／交集；全空＝取消选择）
   ■ 矢量层 ⇒ VectorCraft 魔棒：点一个物件，选中「填色／描边色／描边粗细／不透明度／混合模式」相似的所有物件
       vectorcraft/crates/tools/src/xform/wand.rs 18-46     MagicWandTool：只看 Down；没点到物件且没按 ⇧⌥＝select.none；⌥ 减、⇧ 加、否则 set
       vectorcraft/crates/engine/src/cmd/wand.rs 12-164     WandSettings（各属性开关＋容差、预设）、magicWand.set（夹范围）、similar_paint（RGB 欧氏距离；非纯色要完全相等）、matches、paintable、select.magicWand
       vectorcraft/crates/ui-egui/src/panels/magic_wand.rs  魔棒面板：五行（勾选＋容差）、重设
       vectorcraft/crates/doc/src/hit.rs 60-180             hit_test：由上往下；描边（画出来的宽度＋容差）→ 轮廓容差内 → 有填色才看填色内
       vectorcraft/crates/tools/src/lib.rs 260-278          hit_options.tol ＝ cx.tol(3)＝3 屏幕像素
   🔴 改文件的事全走 CMD：wand.select（像素）、wand.selectSimilar／wand.deselect（矢量）、wand.click（agent 送一下点击＝跟滑鼠同一条路）、
      wand.options（像素选项）、wand.vecOptions（矢量魔棒面板＝magicWand.set／options）。 */
(function(){

/* ═══════════ 像素：wand_region（selection.rs:248-361）原样翻译 ═══════════
   img＝area（＝整张文件）的 straight RGBA8 位元组，w×h；seed＝文件像素坐标（area.x0=y0=0）。
   回 {bbox:{x0,y0,x1,y1}（文件坐标、含消锯齿外扩那一圈）, mask:Uint8Array(bw×bh)}；种子在 area 外回 null。 */
function wandRegion(img, w, h, seed, tolerance, contiguous, antiAlias){
  if (!(seed[0] >= 0 && seed[1] >= 0 && seed[0] < w && seed[1] < h)) return null;    // area.contains(seed)
  const si = (seed[1] * w + seed[0]) * 4;
  const t0 = img[si], t1 = img[si + 1], t2 = img[si + 2], t3 = img[si + 3];
  const tol = Math.max(0, Math.floor(tolerance + 1e-3));                               // (tolerance + 1e-3).floor().max(0)
  const similar = k => {                                                                // 四通道（含 alpha）各自差 ≤ tol
    const j = k * 4;
    return Math.abs(img[j] - t0) <= tol && Math.abs(img[j + 1] - t1) <= tol &&
           Math.abs(img[j + 2] - t2) <= tol && Math.abs(img[j + 3] - t3) <= tol;
  };
  const marks = new Uint8Array(w * h);
  let bx0 = Infinity, by0 = Infinity, bx1 = 0, by1 = 0;
  if (contiguous){
    // 扫描线填充：填满一段，再扫上下两列找新种子
    const stack = [seed[0], seed[1]];
    while (stack.length){
      const y = stack.pop(), x = stack.pop(), row = y * w;
      if (marks[row + x] !== 0) continue;
      let l = x, r = x;
      while (l > 0 && marks[row + l - 1] === 0 && similar(row + l - 1)) l--;
      while (r + 1 < w && marks[row + r + 1] === 0 && similar(row + r + 1)) r++;
      marks.fill(255, row + l, row + r + 1);
      bx0 = Math.min(bx0, l); bx1 = Math.max(bx1, r); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
      for (const ny of [y - 1, y + 1]){
        if (ny < 0 || ny >= h) continue;                                                // y.wrapping_sub(1) ≥ h 也一样跳过
        const nrow = ny * w; let inRun = false;
        for (let nx = l; nx <= r; nx++){
          const ok = marks[nrow + nx] === 0 && similar(nrow + nx);
          if (ok && !inRun) stack.push(nx, ny);
          inRun = ok;
        }
      }
    }
  } else {
    // 不连续：每一列找相近的像素，记下这列的首尾
    for (let y = 0; y < h; y++){
      let a = -1, b = -1;
      for (let x = 0; x < w; x++) if (similar(y * w + x)){ marks[y * w + x] = 255; if (a < 0) a = x; b = x; }
      if (a >= 0){ bx0 = Math.min(bx0, a); bx1 = Math.max(bx1, b); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
    }
  }
  if (bx0 === Infinity) return null;
  // 消锯齿多留一圈，夹在 area 里
  const pad = antiAlias ? 1 : 0;
  const x0 = Math.max(0, bx0 - pad), y0 = Math.max(0, by0 - pad), x1 = Math.min(w, bx1 + 1 + pad), y1 = Math.min(h, by1 + 1 + pad);
  const bw = x1 - x0, mask = new Uint8Array(bw * (y1 - y0));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++){
    const v = marks[y * w + x]; let o = v;
    if (antiAlias){
      // 跟 antialias() 同一条规则：边缘像素跟 3×3 邻居取平均；area 外的邻居当成自己
      let sum = 0, edge = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
        const nx = x + dx, ny = y + dy;
        const n = (nx < 0 || ny < 0 || nx >= w || ny >= h) ? v : marks[ny * w + nx];
        if (n !== v) edge = true; sum += n;
      }
      if (edge){ const avg = sum / (9 * 255); o = Math.round((v > 127 ? 0.5 + 0.5 * avg : 0.5 * avg) * 255); }
    }
    mask[(y - y0) * bw + (x - x0)] = o;
  }
  return {bbox:{x0, y0, x1, y1}, mask};
}

/* combine_region（selection.rs:365-404）：只动区域外框，框外的新遮罩当 0。回整张文件的 8 位覆盖度，或 null（什么都没选到） */
function combineRegion(oldBytes, region, mode){
  const W = Doc.width, H = Doc.height;
  const b = region ? region.bbox : null, bw = b ? b.x1 - b.x0 : 0;
  const empty = !b || bw <= 0 || b.y1 <= b.y0;
  const anyNonZero = a => { for (let i = 0; i < a.length; i++) if (a[i]) return true; return false; };
  // from_bytes：只有外框那块，全 0 ⇒ None
  const fromBytes = f => {
    if (empty) return null;
    const out = new Uint8Array(W * H); let any = false;
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++){
      const v = f((y - b.y0) * bw + (x - b.x0), y * W + x); out[y * W + x] = v; if (v) any = true;
    }
    return any ? out : null;
  };
  if (mode === 'replace' || (mode === 'add' && !oldBytes)) return fromBytes(i => region.mask[i]);
  if (!oldBytes) return null;                                                          // (Subtract | Intersect, None) ⇒ None
  if (mode === 'intersect') return fromBytes((i, j) => Math.min(oldBytes[j], region.mask[i]));
  // Add／Subtract：旧选区整张留着，只改外框那块
  const out = new Uint8Array(oldBytes);
  if (!empty) for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++){
    const i = (y - b.y0) * bw + (x - b.x0), j = y * W + x;
    out[j] = mode === 'add' ? Math.max(oldBytes[j], region.mask[i]) : Math.max(0, oldBytes[j] - region.mask[i]);   // saturating_sub
  }
  return anyNonZero(out) ? out : null;                                                 // nonempty(s)
}

/* sample_rgba8（selection_cmds.rs:59-70）：当前层是像素层且没勾所有图层 ⇒ 那一层自己的像素（铁律④：按 L.x/L.y 对到文件坐标，层外＝透明）；
   否则（勾了所有图层、当前是文字／矢量层、没有图层）⇒ 合成图 */
function sampleRGBA8(L, allLayers){
  const W = Doc.width, H = Doc.height;
  if (!allLayers && L && L.kind === 'raster')
    return L.data.ctx.getImageData(-Math.round(L.x || 0), -Math.round(L.y || 0), W, H).data;
  return composite(1).getContext('2d').getImageData(0, 0, W, H).data;
}

const MODES = ['replace', 'add', 'subtract', 'intersect'];
/* SelectionMode::parse：不认得的 ⇒ replace */
const parseMode = m => MODES.includes(m) ? m : 'replace';
/* selection_cmds.rs:20-25 f()／b()：要数字／布林，型别不对就用预设 */
const num = (p, k, d) => (typeof p[k] === 'number' && isFinite(p[k])) ? p[k] : d;
const bool = (p, k, d) => typeof p[k] === 'boolean' ? p[k] : d;

/* select.magicWand（selection_cmds.rs:72-83） */
function magicWand(p){
  const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  if (p.layerId && !L) return {ok:false, error:'wand.select: no such layer'};
  const x = Math.floor(num(p, 'x', 0)), y = Math.floor(num(p, 'y', 0));
  const img = sampleRGBA8(L, bool(p, 'sampleAllLayers', false));
  const region = wandRegion(img, Doc.width, Doc.height, [x, y], num(p, 'tolerance', 32), bool(p, 'contiguous', true), bool(p, 'antiAlias', true));
  const out = combineRegion(SelMask.bytes(), region, parseMode(p.mode));
  Doc.sel = out ? SelMask.fromBytes(out) : null;
  return {ok:true, selected:!!Doc.sel, selection:Doc.sel};
}

/* ═══════════ 矢量：engine/src/cmd/wand.rs 原样翻译 ═══════════ */
/* WandSettings::default（Illustrator 出厂）：只比填色、容差 32 */
const VEC_DEFAULT = {fillColor:true, fillTolerance:32, strokeColor:false, strokeTolerance:32,
                     strokeWeight:false, weightTolerance:5, opacity:false, opacityTolerance:5, blendingMode:false};
/* 颜色字串 → [r,g,b] 0..1；不是纯色（none、渐变物件……）回 null（Paint::color() 的 None） */
const _cc = document.createElement('canvas').getContext('2d');
function solid(paint){
  if (typeof paint !== 'string' || !paint || paint === 'none' || paint === 'transparent') return null;
  _cc.fillStyle = '#010203'; _cc.fillStyle = paint;
  const v = _cc.fillStyle;
  if (v === '#010203' && paint.toLowerCase().replace(/\s/g, '') !== '#010203') return null;   // 解析不了
  let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v);
  if (m) return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
  m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (m){ const c = m[1].split(',').map(Number); return [c[0] / 255, c[1] / 255, c[2] / 255]; }
  return null;
}
/* similar_paint（wand.rs:103-113）：两边都是纯色 ⇒ RGB 欧氏距离（0..255）≤ tol；否则要完全相等 */
function similarPaint(a, b, tol){
  const x = solid(a), y = solid(b);
  if (x && y){
    const d = Math.sqrt([0, 1, 2].reduce((s, i) => s + Math.pow((x[i] - y[i]) * 255, 2), 0));
    return d <= tol + 1e-6;
  }
  return JSON.stringify(a === undefined ? 'none' : a) === JSON.stringify(b === undefined ? 'none' : b);
}
/* fill_of／stroke_of（wand.rs:89-101）：我们的 shape 栏位 fill／stroke／strokeWidth（没写＝none／0） */
const fillOf = s => s.fill === undefined ? 'none' : s.fill;
const strokeOf = s => [s.stroke === undefined ? 'none' : s.stroke, +s.strokeWidth || 0];
/* WandSettings::matches（wand.rs:117-125）；物件的不透明度／混合模式：shape 上有 opacity／blend 就用，没有＝1／normal */
function matches(w, ref, n){
  const [rs, rw] = strokeOf(ref), [ns, nw] = strokeOf(n);
  const op = s => (typeof s.opacity === 'number') ? s.opacity : 1, bl = s => s.blend || 'normal';
  return (!w.fillColor || similarPaint(fillOf(ref), fillOf(n), w.fillTolerance))
      && (!w.strokeColor || similarPaint(rs, ns, w.strokeTolerance))
      && (!w.strokeWeight || Math.abs(rw - nw) <= w.weightTolerance + 1e-9)
      && (!w.opacity || Math.abs(op(ref) - op(n)) * 100 <= w.opacityTolerance + 1e-6)
      && (!w.blendingMode || bl(ref) === bl(n));
}
/* paintable（wand.rs:129-147）：看得见、没锁的叶子物件（我们一个矢量层里的 shape 全是叶子） */
const paintable = L => L.data.shapes.filter(s => s.visible !== false && !s.locked);

const WD = window.WandTool = {
  vec: Object.assign({}, VEC_DEFAULT),           // session.menu.wand：跨工具切换保留
  mode: 0,                                       // 选项栏模式（MarqueeTool 在就跟它共用——他们是 app.ui.selection_mode 一个栏位）
  held: {shift:false, alt:false},
  hover: null,
  _optKind: null,
  _badgeShown: false,

  /* 选项栏的模式：所有选取工具共用一个（panels.rs:2343-2344） */
  barMode(){ return (window.MarqueeTool && MarqueeTool.opt) ? (MarqueeTool.opt.mode | 0) : this.mode; },
  /* tool_feedback.rs:41-73 selection_mode 的 `_` 那一支 */
  selectionMode(m){
    if (m.shift && m.alt) return 'intersect';
    if (m.shift) return 'add';
    if (m.alt) return 'subtract';
    return MODES[Math.min(3, this.barMode())];
  },
  kind(){ return (Doc.active() || {}).kind; },
  vecLayer(){ const L = Doc.active(); return (L && L.kind === 'vector') ? L : null; },

  /* ── 矢量命中：hit.rs hit_test，限当前矢量层（我们的节点选取 VecSel 一次只管一层） ── */
  _hx: null,
  shapePath(s){                                                     // 借 engine 的 drawShape 拿几何（画出来的跟点到的是同一个形状）
    const P = new Path2D();
    const shim = {save(){}, restore(){}, beginPath(){}, fill(){}, stroke(){},
      moveTo:(...a) => P.moveTo(...a), lineTo:(...a) => P.lineTo(...a), closePath:() => P.closePath(),
      rect:(...a) => P.rect(...a), roundRect:(...a) => P.roundRect(...a), ellipse:(...a) => P.ellipse(...a),
      bezierCurveTo:(...a) => P.bezierCurveTo(...a)};
    drawShape(shim, Object.assign({}, s, {fill:'none', stroke:'none'}), 1);
    return P;
  },
  hitTest(L, pt, tol){
    if (!L || !L.visible || L.kind !== 'vector') return null;      // hit.rs:63 不看隐藏的层
    const hx = this._hx || (this._hx = document.createElement('canvas').getContext('2d'));
    hx.setTransform(1, 0, 0, 1, 0, 0); hx.lineJoin = 'round'; hx.lineCap = 'round';
    const x = pt[0] - L.x, y = pt[1] - L.y;                         // 铁律④：形状存图层坐标
    const S = L.data.shapes;
    for (let j = S.length - 1; j >= 0; j--){                        // hit_children：由上往下
      const s = S[j];
      if (s.visible === false || s.locked) continue;
      const P = this.shapePath(s);
      const stroked = s.stroke && s.stroke !== 'none' && (s.strokeWidth || 0) > 0;
      if (stroked){ hx.lineWidth = s.strokeWidth + 2 * tol; if (hx.isPointInStroke(P, x, y)) return s; }   // HitKind::Stroke
      hx.lineWidth = 2 * tol; if (hx.isPointInStroke(P, x, y)) return s;                                    // HitKind::Outline
      if (s.fill && s.fill !== 'none' && hx.isPointInPath(P, x, y, 'nonzero')) return s;                    // HitKind::Fill
    }
    return null;
  },

  /* ── 一下点击（滑鼠与 wand.click 共用）── m = {shift, alt} 是按下那一刻的修饰键 ── */
  click(pt, m){
    const L = Doc.active();
    if (L && L.kind === 'vector'){
      // xform/wand.rs:26-41
      const s = this.hitTest(L, pt, VecSel.tol(3));
      if (!s) return (m.shift || m.alt) ? {ok:true, hit:false} : Object.assign(CMD.run('wand.deselect', {}), {hit:false});
      const mode = m.alt ? 'subtract' : m.shift ? 'add' : 'set';
      return Object.assign(CMD.run('wand.selectSimilar', {id:s.id, mode, layerId:L.id}), {hit:true, shapeId:s.id});
    }
    // canvas.rs:2058-2062
    return CMD.run('wand.select', {x:Math.floor(pt[0]), y:Math.floor(pt[1]), tolerance:ToolState.tolerance, contiguous:ToolState.contiguous,
      antiAlias:ToolState.antiAlias, sampleAllLayers:ToolState.sampleAllLayers, mode:this.selectionMode(m)});
  },

  /* ── 叠画 ── */
  drawBadge(ctx, p, mode, dpr){                                     // tool_feedback.rs:84-106：游标右下 (30,11)，白字黑晕
    if (mode === 'replace' || mode === 'set') return;
    const c = [p[0] + 30 * dpr, p[1] + 11 * dpr], h = 3.5 * dpr;
    let segs;
    if (mode === 'add') segs = [[[c[0] - h, c[1]], [c[0] + h, c[1]]], [[c[0], c[1] - h], [c[0], c[1] + h]]];
    else if (mode === 'subtract') segs = [[[c[0] - h, c[1]], [c[0] + h, c[1]]]];
    else { const k = h * 0.8; segs = [[[c[0] - k, c[1] - k], [c[0] + k, c[1] + k]], [[c[0] - k, c[1] + k], [c[0] + k, c[1] - k]]]; }
    ctx.save();
    for (const [w, col] of [[3, 'rgba(0,0,0,0.78)'], [1.2, '#fff']]){
      ctx.lineWidth = w * dpr; ctx.strokeStyle = col; ctx.beginPath();
      segs.forEach(([a, b]) => { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }); ctx.stroke();
    }
    ctx.restore();
  },
  /* 像素层：游标旁的标记看「现在按着的」修饰键＋选项栏（tool_feedback.rs:76-81）；
     矢量层：AI 的魔棒游标没有标记（xform/wand.rs:43 只有十字），这里照 Shift／Alt 也标 ＋／−（我们加的，好看出会加选还是减选） */
  badge(){
    if (this.kind() === 'vector') return this.held.alt ? 'subtract' : this.held.shift ? 'add' : 'set';
    return this.selectionMode(this.held);
  },
  draw(ctx, s){
    const dpr = s / Math.max(UI.zoom || 1, 0.01);
    if (this.kind() !== this._optKind && ToolState.cur === 'wand') UI.buildOptions('wand');   // 换了图层种类 ⇒ 选项栏换成那一边的
    if (this.kind() === 'vector'){ VecSel.drawOverlay(ctx, s); }
    else {
      // 选区不是满格矩形 ⇒ 画真正的边界（outline.rs；满格矩形 ui.js 已经画了）
      const sel = Doc.sel;
      if (sel && sel.mask && window.SelMask){
        const sc = p => [Math.round(p[0] * s) + 0.5, Math.round(p[1] * s) + 0.5];
        ctx.save(); ctx.lineWidth = 1; ctx.beginPath();
        SelMask.outline(sel).forEach(([a, b]) => { const A = sc(a), B = sc(b); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); });
        ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.strokeStyle = '#000'; ctx.stroke();
        ctx.restore();
      }
    }
    if (this.hover) this.drawBadge(ctx, [this.hover[0] * s, this.hover[1] * s], this.badge(), dpr);
  },
  redrawHover(){
    if (ToolState.cur !== 'wand' || !window.UI) return;
    const show = !['replace', 'set'].includes(this.badge());
    if (show || this._badgeShown) UI.draw();
    this._badgeShown = show;
  }
};

/* ═══════════ 命令 ═══════════ */
CMD.reg('wand.select', {i18n:'tool.wand', undoable:true,
  params:'{x, y 文件坐标(px，会 floor), tolerance=32 (0..255，RGBA 四通道各自差≤容差), contiguous=true (只选跟落点 4 连通的), antiAlias=true (边缘 3×3 柔化一圈), ' +
         'sampleAllLayers=false (true＝看合成图；当前层不是像素层时本来就看合成图), mode="replace|add|subtract|intersect"="replace", layerId?（预设当前层）} ' +
         '同 PhotoCraft select.magicWand：只在选到的那块外框里跟旧选区合成；落点在画布外＝什么都没选到；结果全空＝取消选择 → {ok, selected, selection:{x,y,w,h, shape?:"mask"}|null}'},
  magicWand);

CMD.reg('wand.selectSimilar', {i18n:'', undoable:true,
  params:'{id 参考形状 id, mode="set|add|subtract"="set", layerId?（预设当前层）} 同 VectorCraft select.magicWand：' +
         '按 wand.vecOptions 的设定（填色／描边色 RGB 欧氏距离 0..255、描边粗细 px、不透明度 %、混合模式），选中这层所有看得见、没锁、跟参考形状相似的形状；' +
         'add＝原选取后面接上新的、subtract＝原选取扣掉相似的 → {ok, count, ids}'},
  p => {
    const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
    if (!L || L.kind !== 'vector') return {ok:false, error:'wand.selectSimilar: not a vector layer'};
    if (p.id === undefined || p.id === null) return {ok:false, error:'wand.selectSimilar: missing id'};
    const ref = L.data.shapes.find(s => s.id === p.id);
    if (!ref) return {ok:false, error:'wand.selectSimilar: no such shape ' + p.id};
    const w = WD.vec;
    const hits = paintable(L).filter(n => matches(w, ref, n)).map(n => n.id);
    const cur = VecSel.layerId === L.id ? VecSel.shapes.slice() : [];
    const mode = p.mode === undefined ? 'set' : p.mode;
    let ids;
    if (mode === 'add') ids = cur.concat(hits.filter(h => !cur.includes(h)));
    else if (mode === 'subtract') ids = cur.filter(i => !hits.includes(i));
    else if (mode === 'set') ids = hits;
    else return {ok:false, error:`wand.selectSimilar: unknown mode \`${mode}\` (set, add, subtract)`};
    VecSel.setShapes(L.id, ids);                                   // sel.set(ids)：整条选中、部分锚点清掉
    return {ok:true, count:ids.length, ids:ids.slice()};
  });

CMD.reg('wand.deselect', {i18n:'', undoable:true, params:'{} 取消矢量物件选取（同 VectorCraft select.none；矢量层上点空白就是这条）'},
  () => { VecSel.clear(); return {ok:true}; });

/* magicWand.set（wand.rs:68-87）＋ magicWand.options：送 {} 就是查询 */
CMD.reg('wand.vecOptions', {i18n:'',
  params:'{fillColor?:bool, fillTolerance?:0..255, strokeColor?:bool, strokeTolerance?:0..255, strokeWeight?:bool, weightTolerance?:0..1000 px, ' +
         'opacity?:bool, opacityTolerance?:0..100 %, blendingMode?:bool, reset?:bool（先回 Illustrator 出厂：只比填色、容差 32）} 矢量魔棒面板（跨工具保留）；型别不对整条拒收 → 目前全部设定'},
  p => {
    const nw = p.reset === true ? Object.assign({}, VEC_DEFAULT) : Object.assign({}, WD.vec);
    for (const k of Object.keys(p)){
      if (!(k in VEC_DEFAULT)) continue;                           // 不认得的键略过（他们 contains_key 才收）
      const want = typeof VEC_DEFAULT[k];
      if (typeof p[k] !== want || (want === 'number' && !isFinite(p[k]))) return {ok:false, error:`wand.vecOptions: \`${k}\` must be a ${want}`};
      nw[k] = p[k];
    }
    const clamp = (v, hi) => Math.min(hi, Math.max(0, v));
    nw.fillTolerance = clamp(nw.fillTolerance, 255); nw.strokeTolerance = clamp(nw.strokeTolerance, 255);
    nw.weightTolerance = clamp(nw.weightTolerance, 1000); nw.opacityTolerance = clamp(nw.opacityTolerance, 100);
    WD.vec = nw;
    if (window.UI && ToolState.cur === 'wand') UI.buildOptions('wand');
    return Object.assign({ok:true}, WD.vec);
  });

/* 像素选项（他们是 app.ui.tool_options，跟油漆桶共用 tolerance／contiguous／antiAlias／sampleAllLayers；模式跟选框共用） */
if (ToolState.antiAlias === undefined) ToolState.antiAlias = true;
if (ToolState.contiguous === undefined) ToolState.contiguous = true;
if (ToolState.sampleAllLayers === undefined) ToolState.sampleAllLayers = false;
CMD.reg('wand.options', {i18n:'',
  params:'{mode?=0..3 或 "replace|add|subtract|intersect"（新选区／添加／减去／交叉；所有选取工具共用）, tolerance?=0..255, antiAlias?:bool, contiguous?:bool, sampleAllLayers?:bool} 像素魔棒选项栏 → 目前全部选项'},
  p => {
    if (p.mode !== undefined){
      const i = typeof p.mode === 'string' ? MODES.indexOf(p.mode) : (p.mode | 0);
      if (i >= 0 && i <= 3){
        WD.mode = i;
        if (window.MarqueeTool && CMD.map['marquee.options']) CMD.map['marquee.options'].run({mode:i});
      }
    }
    if (typeof p.tolerance === 'number' && isFinite(p.tolerance)) ToolState.tolerance = Math.min(255, Math.max(0, p.tolerance));
    ['antiAlias', 'contiguous', 'sampleAllLayers'].forEach(k => { if (typeof p[k] === 'boolean') ToolState[k] = p[k]; });
    if (window.UI && ToolState.cur === 'wand') UI.buildOptions('wand');
    return {ok:true, mode:MODES[WD.barMode()], tolerance:ToolState.tolerance, antiAlias:ToolState.antiAlias,
            contiguous:ToolState.contiguous, sampleAllLayers:ToolState.sampleAllLayers};
  });

/* agent 送一下点击：跟人拿滑鼠点同一条路（像素层带上选项栏现在的选项；矢量层先命中再选相似） */
CMD.reg('wand.click', {i18n:'',
  params:'{x, y 文件坐标, shift?, alt?} 用魔术棒在这点按一下：像素／文字层＝wand.select（选项取目前选项栏；Shift 添加、Alt 减去、Shift+Alt 交叉）；' +
         '矢量层＝命中最上面的形状（容差 3 屏幕像素）后 wand.selectSimilar（Shift 加、Alt 减），点空白且没按 Shift／Alt＝wand.deselect → 那条命令的结果＋{hit?, shapeId?}'},
  p => WD.click([Number(p.x) || 0, Number(p.y) || 0], {shift:!!p.shift, alt:!!p.alt}));

/* ═══════════ 三语 ═══════════ */
/* 键名一律带 wand 前缀，免得盖掉选框／油漆桶登记的同名字串 */
const STRINGS = {
  'zh-Hant':{'tool.wand':'魔術棒', 'opt.wandTolerance':'容許度', 'opt.wandAA':'消除鋸齒', 'opt.wandContig':'連續的', 'opt.wandAll':'取樣全部圖層',
    'ui.wandNew':'新增選取範圍', 'ui.wandAdd':'增加至選取範圍  (Shift)', 'ui.wandSub':'從選取範圍中減去  (Alt)', 'ui.wandInt':'與選取範圍相交  (Shift+Alt)',
    'opt.wandFill':'填色', 'opt.wandStroke':'筆畫顏色', 'opt.wandWeight':'筆畫寬度', 'opt.wandOpacity':'不透明度', 'opt.wandBlend':'漸變模式',
    'ui.wandTol':'容許度', 'ui.wandReset':'重設',
    'ui.wandHint':'按一下選取相近顏色 · Shift 增加 · Alt 減去 · Shift+Alt 相交',
    'ui.wandVecHint':'按一下物件，選取屬性相似的物件 · Shift 增加 · Alt 減去 · 按空白處取消選取'},
  'zh-Hans':{'tool.wand':'魔棒', 'opt.wandTolerance':'容差', 'opt.wandAA':'消除锯齿', 'opt.wandContig':'连续', 'opt.wandAll':'对所有图层取样',
    'ui.wandNew':'新选区', 'ui.wandAdd':'添加到选区  (Shift)', 'ui.wandSub':'从选区减去  (Alt)', 'ui.wandInt':'与选区交叉  (Shift+Alt)',
    'opt.wandFill':'填充颜色', 'opt.wandStroke':'描边颜色', 'opt.wandWeight':'描边粗细', 'opt.wandOpacity':'不透明度', 'opt.wandBlend':'混合模式',
    'ui.wandTol':'容差', 'ui.wandReset':'重置',
    'ui.wandHint':'单击选择相近的颜色 · Shift 添加 · Alt 减去 · Shift+Alt 交叉',
    'ui.wandVecHint':'单击对象，选中属性相似的对象 · Shift 添加 · Alt 减去 · 单击空白取消选择'},
  'en':{'tool.wand':'Magic Wand', 'opt.wandTolerance':'Tolerance', 'opt.wandAA':'Anti-alias', 'opt.wandContig':'Contiguous', 'opt.wandAll':'Sample All Layers',
    'ui.wandNew':'New selection', 'ui.wandAdd':'Add to selection  (Shift)', 'ui.wandSub':'Subtract from selection  (Alt)', 'ui.wandInt':'Intersect with selection  (Shift+Alt)',
    'opt.wandFill':'Fill Color', 'opt.wandStroke':'Stroke Color', 'opt.wandWeight':'Stroke Weight', 'opt.wandOpacity':'Opacity', 'opt.wandBlend':'Blending Mode',
    'ui.wandTol':'Tolerance', 'ui.wandReset':'Reset',
    'ui.wandHint':'Click to select similar colours  ·  Shift add  ·  Alt subtract  ·  Shift+Alt intersect',
    'ui.wandVecHint':'Click an object to select objects with similar attributes  ·  Shift add  ·  Alt subtract  ·  click empty space to deselect'}
};

/* ═══════════ 工具本体 ═══════════ */
const isMod = e => e.key === 'Shift' || e.key === 'Alt';
Tools.reg({
  id:'wand', icon:'🪄', key:'W', group:'select', order:25, for:'common', opts:[],
  cursor:'crosshair', strings:STRINGS,

  onDown(e, pt, P){
    P.down = false;                                                  // 只看按下（他们 Down 就做完、不拖）
    if (e.button !== undefined && e.button !== 0) return;            // 工具只跟左键
    WD.hover = pt; WD.held = {shift:!!e.shiftKey, alt:!!e.altKey};
    WD.click(pt, {shift:!!e.shiftKey, alt:!!e.altKey});
    UI.draw();
  },
  onMove(e, pt){ WD.hover = pt; WD.held = {shift:!!e.shiftKey, alt:!!e.altKey}; WD.redrawHover(); },
  onKey(e){
    if (isMod(e)){
      if (e.key === 'Alt') e.preventDefault();                       // 别让浏览器把焦点交给选单列
      WD.held = {shift:e.shiftKey, alt:e.altKey}; WD.redrawHover();
    }
    return false;
  },
  onKeyUp(e){ if (isMod(e)){ WD.held = {shift:e.shiftKey, alt:e.altKey}; WD.redrawHover(); } },
  onDeactivate(){ WD.hover = null; WD._badgeShown = false; },
  drawOverlay(ctx, s){ WD.draw(ctx, s); },

  buildOptions(box, add, mk){
    const kind = WD.kind(); WD._optKind = kind;
    const btn = (txt, tipKey, on, fn, data) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = txt; b.title = Lang.t(tipKey);
      b.style.cssText = `margin:0 1px;min-width:24px;cursor:pointer;${on ? 'background:#2f7fd8;color:#fff;' : ''}`;
      Object.assign(b.dataset, data || {}); b.onclick = fn; box.appendChild(b); return b;
    };
    const sep = () => { const v = document.createElement('span'); v.style.cssText = 'display:inline-block;width:1px;height:18px;background:#555;margin:0 6px;vertical-align:middle'; box.appendChild(v); };
    const hint = k => { const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t(k); box.appendChild(h); };
    if (kind === 'vector'){
      // panels/magic_wand.rs：五行「勾选＋容差」，没勾的容差灰掉；末尾重设
      const o = WD.vec, set = p => { CMD.run('wand.vecOptions', p); };
      [['wandFill', 'fillColor', 'fillTolerance', 255], ['wandStroke', 'strokeColor', 'strokeTolerance', 255],
       ['wandWeight', 'strokeWeight', 'weightTolerance', 1000], ['wandOpacity', 'opacity', 'opacityTolerance', 100], ['wandBlend', 'blendingMode', null]]
        .forEach(([lab, flag, tolKey, max]) => {
          const c = mk('checkbox', {checked:!!o[flag]}); c.dataset.opt = flag;
          c.onchange = () => set({[flag]:c.checked}); add(lab, c);
          if (tolKey){
            const n = mk('number', {min:0, max, step:1, value:o[tolKey]}); n.style.width = '56px'; n.dataset.opt = tolKey; n.disabled = !o[flag];
            n.title = Lang.t('ui.wandTol');
            n.onchange = () => { const v = +n.value; if (n.value !== '' && isFinite(v)) set({[tolKey]:Math.min(max, Math.max(0, v))}); };
            box.appendChild(n);
          }
          sep();
        });
      btn('↺', 'ui.wandReset', false, () => set({reset:true}), {opt:'reset'});
      hint('ui.wandVecHint');
      return;
    }
    // panels.rs:607-615：四个模式钮｜容差、消除锯齿、连续、取样所有图层
    const set = p => { CMD.run('wand.options', p); UI.draw(); };
    const bar = WD.barMode();
    [['□', 'ui.wandNew'], ['＋', 'ui.wandAdd'], ['−', 'ui.wandSub'], ['⧉', 'ui.wandInt']].forEach(([t, k], i) =>
      btn(t, k, bar === i, () => set({mode:i}), {mode:MODES[i]}));
    sep();
    const tl = mk('number', {min:0, max:255, value:ToolState.tolerance}); tl.style.width = '58px'; tl.dataset.opt = 'tolerance';
    tl.oninput = () => { const v = +tl.value; if (tl.value !== '' && isFinite(v)) ToolState.tolerance = Math.min(255, Math.max(0, v)); };
    add('wandTolerance', tl);
    [['antiAlias', 'wandAA'], ['contiguous', 'wandContig'], ['sampleAllLayers', 'wandAll']].forEach(([k, lab]) => {
      const c = mk('checkbox', {checked:!!ToolState[k]}); c.dataset.opt = k;
      c.onchange = () => { ToolState[k] = c.checked; }; add(lab, c);
    });
    hint('ui.wandHint');
  }
});

})();
