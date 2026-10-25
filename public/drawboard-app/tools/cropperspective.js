/* 透视裁剪（PS：C，与裁剪同一格）—— 原码没有·照 PS 2020 写
   ArtCraft PhotoCraft 没有透视裁剪工具（ui-egui/src/crop_ui.rs 只有矩形裁剪；perspective_ui.rs 是「透视变形」滤镜，不是这颗）。
   照 Photoshop 2020 的行为：
     · 在画布上拖一个矩形＝裁剪框的四个角；或一下一下点四个角（点满第 4 个就成框，Esc 放弃）
     · 框成形后：拖角点＝那一角自由移动（四边形，可以不平行）；拖边中点＝整条边平移；框内拖＝整个框移动
     · 框外变暗、框内画透视网格（选项栏「显示网格」）；四边形不是凸的（角点拖过头）⇒ 框变红、不能套用（PS 也拒绝）
     · Enter／选项栏 ✓＝套用：把四边形里的内容「拉直」成一个矩形——每个输出像素用透视（单应性）对应回原图，双线性取样；
       文件改成输出的宽×高、所有图层一起变（PS 透视裁剪作用于整份文件）；Esc／⊘＝取消
     · 选项栏：W（宽）、⇄（宽高对调）、H（高）、分辨率（像素/英寸）、「前面的图像」（填入目前文件的宽高与分辨率）、「清除」、「显示网格」
       W／H 留空＝自动：宽＝上下两边较长的那条、高＝左右两边较长的那条（像素）；只填一格＝另一格按自动比例算
   我们这边的差别：矢量／文字／智能对象层会先点阵化（PS 套用时也会把它们点阵化或报不能）；图层组的画板框、矢量蒙版不跟着变形。
   改文件只走 cropperspective.apply（undoable）；框的状态（待定、不进历史）走 cropperspective.quad／pointer。 */
(function(){
if (window.PerspCrop) return;

const STRINGS = {
  'zh-Hant':{'tool.cropperspective':'透視裁切', 'opt.pcW':'W：', 'opt.pcH':'H：', 'opt.pcRes':'解析度：', 'ui.pcFront':'前面的影像', 'ui.pcClear':'清除', 'opt.pcGrid':'顯示格點',
             'ui.pcSwap':'交換高度和寬度', 'ui.pcCommit':'確認目前的裁切操作  (Enter)', 'ui.pcCancel':'取消目前的裁切操作  (Esc)', 'ui.pcPpi':'像素/英寸',
             'ui.pcHint':'拖曳出框或點四個角 · 拖角點／邊／框內調整 · Enter 套用 · Esc 取消'},
  'zh-Hans':{'tool.cropperspective':'透视裁剪', 'opt.pcW':'W：', 'opt.pcH':'H：', 'opt.pcRes':'分辨率：', 'ui.pcFront':'前面的图像', 'ui.pcClear':'清除', 'opt.pcGrid':'显示网格',
             'ui.pcSwap':'高度和宽度互换', 'ui.pcCommit':'提交当前裁剪操作  (Enter)', 'ui.pcCancel':'取消当前裁剪操作  (Esc)', 'ui.pcPpi':'像素/英寸',
             'ui.pcHint':'拖出框或点四个角 · 拖角点／边／框内调整 · Enter 提交 · Esc 取消'},
  'en':{'tool.cropperspective':'Perspective Crop', 'opt.pcW':'W:', 'opt.pcH':'H:', 'opt.pcRes':'Resolution:', 'ui.pcFront':'Front Image', 'ui.pcClear':'Clear', 'opt.pcGrid':'Show Grid',
        'ui.pcSwap':'Swaps height and width', 'ui.pcCommit':'Commit current crop operation  (Enter)', 'ui.pcCancel':'Cancel current crop operation  (Esc)', 'ui.pcPpi':'Pixels/Inch',
        'ui.pcHint':'Drag a box or click four corners · drag corners/edges/inside to adjust · Enter commits · Esc cancels'}
};
if (typeof Lang !== 'undefined') Lang.add(STRINGS);

const HANDLE = 8;          // 角点／边中点的命中半径（画面像素）
const CLICK = 3;           // 放开时离按下点不到 3 画面像素＝点一下
const zoom = () => Math.max((window.UI && UI.zoom) || 1, 0.01);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cpQ = q => q.map(p => [p[0], p[1]]);

/* 单位方形 → 四边形 的透视（单应性）矩阵（Heckbert 1989）：q＝[左上, 右上, 右下, 左下] */
function squareToQuad(q){
  const [x0, y0] = q[0], [x1, y1] = q[1], [x2, y2] = q[2], [x3, y3] = q[3];
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(sx) > 1e-12 || Math.abs(sy) > 1e-12){
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null;
    g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den;
  }
  return {a:x1 - x0 + g * x1, b:x3 - x0 + h * x3, c:x0, d:y1 - y0 + g * y1, e:y3 - y0 + h * y3, f:y0, g, h};
}
const mapH = (M, u, v) => { const w = M.g * u + M.h * v + 1; return [(M.a * u + M.b * v + M.c) / w, (M.d * u + M.e * v + M.f) / w]; };
/* 有号面积（y 向下：正＝画面上顺时针） */
const area = q => { let s = 0; for (let i = 0; i < q.length; i++){ const a = q[i], b = q[(i + 1) % q.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
/* 凸四边形（四个角的转向同号、且不退化）才能套用 */
function convex(q){
  if (!q || q.length !== 4) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++){
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-6) return false;
    const s = Math.sign(cr); if (!sign) sign = s; else if (s !== sign) return false;
  }
  return Math.abs(area(q)) > 1;
}
/* 四个点排成「左上起、画面上顺时针」 */
function orderQuad(q){
  let r = cpQ(q);
  if (area(r) < 0) r = [r[0], r[3], r[2], r[1]];
  let k = 0; for (let i = 1; i < 4; i++) if (r[i][0] + r[i][1] < r[k][0] + r[k][1]) k = i;
  return r.slice(k).concat(r.slice(0, k));
}
function inside(q, p){
  let c = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++){
    const a = q[i], b = q[j];
    if (((a[1] > p[1]) !== (b[1] > p[1])) && (p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0])) c = !c;
  }
  return c;
}
/* 自动输出大小：宽＝上下两边较长者、高＝左右两边较长者 */
function autoSize(q){ return [Math.max(1, Math.round(Math.max(dist(q[0], q[1]), dist(q[3], q[2])))), Math.max(1, Math.round(Math.max(dist(q[0], q[3]), dist(q[1], q[2]))))]; }
function outSize(q, w, h){
  const [aw, ah] = autoSize(q);
  const W = w > 0 ? Math.round(w) : 0, H = h > 0 ? Math.round(h) : 0;
  if (W && H) return [W, H];
  if (W) return [W, Math.max(1, Math.round(W * ah / aw))];
  if (H) return [Math.max(1, Math.round(H * aw / ah)), H];
  return [aw, ah];
}

/* 一张画布（原点在文件坐标 ox,oy）照透视拉成 W×H：输出像素中心 → 单位方形 → 四边形 → 来源像素，预乘 alpha 双线性 */
function warpCanvas(src, ox, oy, M, W, H){
  const sw = src.width, sh = src.height;
  const sd = src.getContext('2d', {willReadFrequently:true}).getImageData(0, 0, sw, sh).data;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', {willReadFrequently:true}), out = ctx.createImageData(W, H), od = out.data;
  for (let y = 0; y < H; y++){
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x++){
      const u = (x + 0.5) / W, P = mapH(M, u, v);
      const fx = P[0] - ox - 0.5, fy = P[1] - oy - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < 2; j++){
        const yy = y0 + j; if (yy < 0 || yy >= sh) continue;
        const wy = j ? ty : 1 - ty; if (!wy) continue;
        for (let i = 0; i < 2; i++){
          const xx = x0 + i; if (xx < 0 || xx >= sw) continue;
          const wgt = (i ? tx : 1 - tx) * wy; if (!wgt) continue;
          const k = (yy * sw + xx) * 4, al = sd[k + 3] * wgt;
          r += sd[k] * al; g += sd[k + 1] * al; b += sd[k + 2] * al; a += al;
        }
      }
      const o = (y * W + x) * 4;
      if (a > 0){ od[o] = Math.round(r / a); od[o + 1] = Math.round(g / a); od[o + 2] = Math.round(b / a); od[o + 3] = Math.round(a); }
    }
  }
  ctx.putImageData(out, 0, 0);
  return {canvas:c, ctx};
}

/* 套用（改文件的唯一一条路） */
function applyPersp(p){
  const q0 = Array.isArray(p.quad) && p.quad.length === 4 ? p.quad.map(pt => [Number(pt[0]), Number(pt[1])]) : null;
  if (!q0 || !q0.every(pt => isFinite(pt[0]) && isFinite(pt[1]))) return {ok:false, error:'quad required: [[x,y]×4] 文件坐标'};
  const q = orderQuad(q0);
  if (!convex(q)) return {ok:false, error:'invalid quad: corners must form a convex quadrilateral'};
  const M = squareToQuad(q); if (!M) return {ok:false, error:'degenerate quad'};
  const [W, H] = outSize(q, Number(p.width) || 0, Number(p.height) || 0);
  if (W * H > 12000 * 12000) return {ok:false, error:'output too large'};
  // 锁像素／全锁的层：PS 不给改
  for (const L of Doc.layers){ const k = window.Locks && L.kind !== 'group' ? Locks.blocks(L, 'pixels') : null; if (k) return Locks.fail(L, k, 'cropperspective.apply'); }
  // 矢量／文字／智能对象先点阵化（直接叫命令本体：不另推历史）
  const rast = [];
  for (const id of Doc.layers.map(L => L.id)){
    const L = Doc.byId(id);
    if (L && (L.kind === 'vector' || L.kind === 'text' || L.kind === 'smart')){ CMD.map['layer.rasterize'].run({id}); rast.push(id); }
  }
  for (const L of Doc.layers){
    if (L.kind === 'raster'){
      L.data = warpCanvas(L.data.canvas, L.x || 0, L.y || 0, M, W, H);
      const Mk = L.mask;
      if (Mk && Mk.kind === 'raster' && Mk.data && Mk.data.canvas){
        Mk.data = warpCanvas(Mk.data.canvas, (L.x || 0) + (Mk.x || 0), (L.y || 0) + (Mk.y || 0), M, W, H); Mk.x = 0; Mk.y = 0; Layer.invalidate(Mk);
      }
      L.x = 0; L.y = 0;
      Layer.invalidate(L);
    }
  }
  Doc.width = W; Doc.height = H; Doc.sel = null;
  const res = Number(p.resolution); if (res > 0) Doc.dpi = res;
  return {ok:true, width:W, height:H, quad:q, rasterized:rast};
}

/* ── 待定的框与手势 ── */
const PC = window.PerspCrop = {
  quad: null,               // [[x,y]×4] 文件坐标，左上起顺时针（拖角点过头时可能不凸＝红框）
  pts: [],                  // 点四个角途中已点的点
  hover: null,
  drag: null,               // {kind:'new'|'corner'|'edge'|'move', i, start, q0, moved}
  opt: {width:'', height:'', resolution:'', showGrid:true},
  serial: null,
  validate(){ if (this.serial !== Doc.serial){ this.serial = Doc.serial; this.quad = null; this.pts = []; this.drag = null; } },
  valid(){ return convex(this.quad); },
  setQuad(q){ this.quad = q ? cpQ(q) : null; this.pts = []; this.serial = Doc.serial; },
  hit(pt){
    const q = this.quad; if (!q) return null;
    const tol = HANDLE / zoom();
    for (let i = 0; i < 4; i++) if (dist(q[i], pt) <= tol) return {kind:'corner', i};
    for (let i = 0; i < 4; i++){ const a = q[i], b = q[(i + 1) % 4]; if (dist([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], pt) <= tol) return {kind:'edge', i}; }
    if (inside(q, pt)) return {kind:'move'};
    return null;
  },
  down(pt){
    this.validate();
    if (this.quad){
      const h = this.hit(pt);
      this.drag = h ? Object.assign(h, {start:pt.slice(), q0:cpQ(this.quad), moved:false}) : null;
      return;
    }
    this.drag = {kind:this.pts.length ? 'point' : 'new', start:pt.slice(), moved:false};
  },
  move(pt){
    this.hover = pt.slice();
    const g = this.drag; if (!g) return;
    if (!g.moved && dist(pt, g.start) * zoom() < CLICK) return;
    g.moved = true;
    const dx = pt[0] - g.start[0], dy = pt[1] - g.start[1];
    if (g.kind === 'corner'){ const q = cpQ(g.q0); q[g.i] = [g.q0[g.i][0] + dx, g.q0[g.i][1] + dy]; this.quad = q; }
    else if (g.kind === 'edge'){ const q = cpQ(g.q0), j = (g.i + 1) % 4; q[g.i] = [q[g.i][0] + dx, q[g.i][1] + dy]; q[j] = [q[j][0] + dx, q[j][1] + dy]; this.quad = q; }
    else if (g.kind === 'move') this.quad = g.q0.map(p => [p[0] + dx, p[1] + dy]);
  },
  up(pt){
    const g = this.drag;
    if (!g) return;
    this.move(pt); this.drag = null;
    if (g.kind === 'new'){
      if (g.moved){
        const x0 = Math.min(g.start[0], pt[0]), y0 = Math.min(g.start[1], pt[1]), x1 = Math.max(g.start[0], pt[0]), y1 = Math.max(g.start[1], pt[1]);
        if (x1 - x0 >= 1 && y1 - y0 >= 1) this.setQuad([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      } else this.pts = [pt.slice()];          // 点一下＝开始一个一个点角
    } else if (g.kind === 'point'){
      this.pts.push(pt.slice());
      if (this.pts.length >= 4){ const q = orderQuad(this.pts); this.setQuad(q); }
    } else if (this.quad && (g.kind === 'corner' || g.kind === 'edge' || g.kind === 'move')){
      if (this.valid()) this.quad = orderQuad(this.quad);    // 合法就重排（角点拖到对面也照样是左上起）
    }
  },
  cancel(){ this.quad = null; this.pts = []; this.drag = null; },
  commit(){
    this.validate();
    if (!this.quad) return {ok:false, error:'no perspective crop box'};
    if (!this.valid()) return {ok:false, error:'invalid quad: corners must form a convex quadrilateral'};
    const o = this.opt;
    const r = CMD.run('cropperspective.apply', {quad:this.quad, width:+o.width || 0, height:+o.height || 0, resolution:+o.resolution || 0});
    if (r && r.ok !== false){ this.cancel(); if (CMD.map['view.fit']) CMD.run('view.fit'); }
    return r;
  },
  /* 叠画：框外变暗、四边、透视网格、角点与边中点把手；点角途中画折线 */
  draw(ctx, s){
    this.validate();
    ctx.save();
    if (this.quad){
      const q = this.quad, ok = this.valid();
      const path = () => { ctx.beginPath(); ctx.moveTo(q[0][0] * s, q[0][1] * s); for (let i = 1; i < 4; i++) ctx.lineTo(q[i][0] * s, q[i][1] * s); ctx.closePath(); };
      ctx.beginPath(); ctx.rect(0, 0, Doc.width * s, Doc.height * s);
      ctx.moveTo(q[0][0] * s, q[0][1] * s); for (let i = 1; i < 4; i++) ctx.lineTo(q[i][0] * s, q[i][1] * s); ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fill('evenodd');
      if (ok && this.opt.showGrid){
        const M = squareToQuad(q);
        if (M){
          const n = Math.max(2, Math.min(16, Math.round(Math.max(...autoSize(q)) * s / 60)));
          ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.beginPath();
          for (let i = 1; i < n; i++){
            const t = i / n;
            let a = mapH(M, t, 0), b = mapH(M, t, 1); ctx.moveTo(a[0] * s, a[1] * s); ctx.lineTo(b[0] * s, b[1] * s);
            a = mapH(M, 0, t); b = mapH(M, 1, t); ctx.moveTo(a[0] * s, a[1] * s); ctx.lineTo(b[0] * s, b[1] * s);
          }
          ctx.stroke();
        }
      }
      path(); ctx.lineWidth = 1.5; ctx.strokeStyle = ok ? '#ffffff' : '#ff2a2a'; ctx.stroke();
      ctx.setLineDash([4, 4]); ctx.strokeStyle = ok ? '#000' : '#600'; ctx.lineWidth = 1; path(); ctx.stroke(); ctx.setLineDash([]);
      const box = (x, y) => { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.fillRect(x * s - 4, y * s - 4, 8, 8); ctx.strokeRect(x * s - 4 + .5, y * s - 4 + .5, 7, 7); };
      for (let i = 0; i < 4; i++){ const a = q[i], b = q[(i + 1) % 4]; box(a[0], a[1]); box((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
    } else if (this.pts.length){
      const pts = this.pts.concat(this.hover ? [this.hover] : []);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p[0] * s, p[1] * s) : ctx.moveTo(p[0] * s, p[1] * s)); ctx.stroke();
      ctx.setLineDash([4, 4]); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      this.pts.forEach(p => { ctx.fillStyle = '#fff'; ctx.fillRect(p[0] * s - 4, p[1] * s - 4, 8, 8); ctx.strokeStyle = '#000'; ctx.strokeRect(p[0] * s - 3.5, p[1] * s - 3.5, 7, 7); });
    } else if (this.drag && this.drag.kind === 'new' && this.drag.moved && this.hover){
      const a = this.drag.start, b = this.hover;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(Math.min(a[0], b[0]) * s + .5, Math.min(a[1], b[1]) * s + .5, Math.abs(b[0] - a[0]) * s, Math.abs(b[1] - a[1]) * s);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = '#000'; ctx.strokeRect(Math.min(a[0], b[0]) * s + .5, Math.min(a[1], b[1]) * s + .5, Math.abs(b[0] - a[0]) * s, Math.abs(b[1] - a[1]) * s);
    }
    ctx.restore();
  },
  cursor(pt){
    const h = this.hit(pt), c = UI.canvas; if (!c) return;
    c.style.cursor = !h ? 'crosshair' : h.kind === 'move' ? 'move' : h.kind === 'edge' ? 'pointer' : 'grab';
  },
  // 给测试与 agent：工具的数学
  squareToQuad, mapH, convex, orderQuad, autoSize, outSize
};

/* ═══════════ 命令 ═══════════ */
CMD.reg('cropperspective.apply', {i18n:'tool.cropperspective', undoable:true,
  params:'{quad:[[x,y]×4] 文件坐标（四个角，任意顺序；会排成左上起顺时针；必须是凸四边形）, width?, height? 输出像素（0／省略＝自动：宽＝上下边较长者、高＝左右边较长者；只给一个＝另一个按比例）, resolution? 像素/英寸} '
        + '透视裁剪：把四边形里的内容用透视（单应性）对应＋双线性取样拉成 width×height 的矩形；文件改成这个大小、所有像素层一起变（矢量／文字／智能对象先点阵化），图层位移归零、选区清掉 → {ok, width, height, quad, rasterized:[层 id]}'},
  applyPersp);
CMD.reg('cropperspective.quad', {i18n:'',
  params:'{quad?:[[x,y]×4] 文件坐标（任意顺序，凸的会排成左上起顺时针）| clear?:true} 设／清待定的透视裁剪框（同人拖出框或点四个角）；都不给＝只读；不进历史 → {quad|null, valid}'},
  p => {
    PC.validate();
    if (p.clear) PC.cancel();
    else if (Array.isArray(p.quad) && p.quad.length === 4){
      const q = p.quad.map(pt => [Number(pt[0]), Number(pt[1])]);
      if (!q.every(pt => isFinite(pt[0]) && isFinite(pt[1]))) return {ok:false, error:'non-finite quad'};
      PC.setQuad(convex(orderQuad(q)) ? orderQuad(q) : q);
    }
    if (window.UI) UI.draw();
    return {quad:PC.quad ? cpQ(PC.quad) : null, valid:PC.valid()};
  });
CMD.reg('cropperspective.commit', {i18n:'', params:'{} 套用待定的框（＝Enter／选项栏 ✓）：用选项栏的 W／H／分辨率跑 cropperspective.apply，成功后视图 fit；没框或框不凸回 ok:false'},
  () => PC.commit());
CMD.reg('cropperspective.cancel', {i18n:'', params:'{} 取消待定的框（＝Esc／选项栏 ⊘），不改文件'},
  () => { PC.cancel(); if (window.UI) UI.draw(); return {ok:true}; });
CMD.reg('cropperspective.options', {i18n:'',
  params:'{width?, height?（像素；""／0＝自动）, resolution?（像素/英寸；""＝不改文件分辨率）, showGrid?:bool, frontImage?:true（填入目前文件的宽高与分辨率）, clear?:true（三格清空）, swap?:true（宽高对调）} → 目前选项'},
  p => {
    const o = PC.opt, s = v => (v === '' || v === null || v === 0 || v === '0') ? '' : (isFinite(Number(v)) && Number(v) > 0 ? String(Number(v)) : null);
    if (p.clear){ o.width = ''; o.height = ''; o.resolution = ''; }
    if (p.frontImage){ o.width = String(Doc.width); o.height = String(Doc.height); o.resolution = String(Doc.dpi || 72); }
    ['width', 'height', 'resolution'].forEach(k => { if (p[k] !== undefined){ const v = s(p[k]); if (v !== null) o[k] = v; } });
    if (p.swap) [o.width, o.height] = [o.height, o.width];
    if (typeof p.showGrid === 'boolean') o.showGrid = p.showGrid;
    if (window.UI && ToolState.cur === 'cropperspective'){ UI.buildOptions('cropperspective'); UI.draw(); }
    return Object.assign({}, o);
  });
CMD.reg('cropperspective.pointer', {i18n:'',
  params:'{events:[{kind:"down"|"move"|"up", x, y 文件坐标}…]} 跟人拿滑鼠一样：没框时拖＝拉出矩形框、点一下＝点角（点满 4 个成框）；有框时拖角点／边中点／框内＝调整 → {quad|null, points, valid}'},
  p => {
    for (const e of (Array.isArray(p.events) ? p.events : [])){
      const pt = [Number(e.x), Number(e.y)]; if (!isFinite(pt[0]) || !isFinite(pt[1])) continue;
      if (e.kind === 'down') PC.down(pt); else if (e.kind === 'move') PC.move(pt); else if (e.kind === 'up') PC.up(pt);
    }
    if (window.UI) UI.draw();
    return {quad:PC.quad ? cpQ(PC.quad) : null, points:PC.pts.map(q => q.slice()), valid:PC.valid()};
  });

/* ═══════════ 工具 ═══════════ */
Tools.reg({
  id:'cropperspective', icon:'⌗', group:'select', order:41, for:'raster', opts:[], cursor:'crosshair',
  strings:STRINGS,
  onDown(e, pt){ if (e.button !== undefined && e.button !== 0) return; PC.down(pt); UI.draw(); },
  onMove(e, pt, P){ PC.hover = pt.slice(); if (P.down) PC.move(pt); else PC.cursor(pt); UI.draw(); },
  onUp(e, pt){ PC.up(pt); PC.cursor(pt); UI.draw(); },
  onKey(e){
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    PC.validate();
    if (!PC.quad && !PC.pts.length) return false;
    if (e.key === 'Enter'){ e.preventDefault(); if (PC.quad) CMD.run('cropperspective.commit'); return true; }
    if (e.key === 'Escape'){ e.preventDefault(); CMD.run('cropperspective.cancel'); return true; }
    return false;
  },
  onDeactivate(){ PC.drag = null; PC.pts = []; },
  drawOverlay(ctx, s){ PC.draw(ctx, s); },
  /* PS 2020 选项栏：W ⇄ H 分辨率 [像素/英寸]｜前面的图像｜清除｜显示网格｜⊘ ✓ */
  buildOptions(box, add, mk){
    const o = PC.opt, set = q => CMD.run('cropperspective.options', q);
    const fld = (key, label, v) => { const n = mk('text', {value:v}); n.style.width = '58px'; n.dataset.opt = key; n.onchange = () => set({[key]:n.value.trim() === '' ? '' : n.value.trim()}); add(label, n); return n; };
    const btn = (txt, tip, fn, opt) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.title = tip; b.dataset.opt = opt; b.style.cssText = 'margin:0 3px;cursor:pointer'; b.onclick = fn; box.appendChild(b); return b; };
    fld('width', 'pcW', o.width);
    btn('⇄', Lang.t('ui.pcSwap'), () => set({swap:true}), 'swap');
    fld('height', 'pcH', o.height);
    fld('resolution', 'pcRes', o.resolution);
    const u = document.createElement('span'); u.textContent = Lang.t('ui.pcPpi'); u.style.cssText = 'color:#9aa;margin-right:6px'; box.appendChild(u);
    btn(Lang.t('ui.pcFront'), Lang.t('ui.pcFront'), () => set({frontImage:true}), 'front');
    btn(Lang.t('ui.pcClear'), Lang.t('ui.pcClear'), () => set({clear:true}), 'clear');
    const g = mk('checkbox', {checked:o.showGrid}); g.dataset.opt = 'showGrid'; g.onchange = () => set({showGrid:g.checked}); add('pcGrid', g);
    btn('⊘', Lang.t('ui.pcCancel'), () => CMD.run('cropperspective.cancel'), 'cancel');
    btn('✓', Lang.t('ui.pcCommit'), () => CMD.run('cropperspective.commit'), 'commit');
    const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t('ui.pcHint'); box.appendChild(h);
  }
});
})();
