/* 裁剪工具（C）——照 ArtCraft／PhotoCraft 的 Rust 原码逐段翻译
   对照源（photocraft/crates/…）：
     ui-egui/src/crop_ui.rs   1-253    PS「经典模式」裁剪：框外拖＝画新框（⇧ 正方、⌥ 从中心、拖着按 Space＝整个框跟着走）；
                                       框内拖＝移动框；边／角（8 个把手）拖＝改大小（⇧ 保持比例、⌥ 绕中心、选项栏比例一直生效）；
                                       hit／drawn／resized／pointer／update／cursor；框太小（<1 px）放开就还原
     ui-egui/src/crop_ui.rs   255-478  测试情境（本档的 tests/自测-crop.py 逐条对照）
     ui-egui/src/canvas.rs    1760-1811 crop_overlay：框外压暗（黑 α130）、白框、三分线（白 α90）、四角 L 形把手、四边中段短把手
     ui-egui/src/canvas.rs    1594     游标：边角双箭头、框内移动、框外十字
     ui-egui/src/canvas.rs    1474-1555 拖要超过点击距离才算；没拖＝点一下（Down＋Up 同一点）
     ui-egui/src/canvas.rs    2268-2279 commit_crop：框四舍五入成整数 → image.crop（带「删除裁剪像素」）→ 视图重新 fit
     ui-egui/src/shortcuts.rs 273-289  有待定的框：Enter 确认、Esc 取消
     ui-egui/src/panels.rs    672-708, 798-806  选项栏：比例下拉（chrome_ui CROP_RATIOS）、宽高比两格＋对调、清除、三分法、删除裁剪像素、✓／⊘；提示字
     ui-egui/src/chrome_ui.rs 162-200  marquee_end（固定比例／⇧ 正方）、CROP_RATIOS、crop_ratio（original＝文件宽高）
     ui-egui/src/snap_ui.rs   134-250 ＋ engine/src/snap.rs 102-245  吸附：画框／拉把手＝点吸附；框内拖＝整个框的边与中线吸附；拖的途中按 Ctrl 暂停
     ui-egui/src/hold_keys.rs、canvas.rs 1423-1432  裁剪手势进行中 Space 归它（重新定位），不变暂时抓手
     ui-egui/src/state.rs     374-379, 456-457, 640-642  选项预设：比例空白（不限）、删除裁剪像素＝开；待定框 crop_rect
     engine/src/image_cmds.rs 148-173, 248-268  image.crop／crop_doc／translate_doc：裁文件＝改宽高＋所有图层平移 −(x,y)；
                                       明给矩形可以超出画布（外扩）；没给就用选区外框（夹在画布内）；选区清掉
   🔴 改文件的事全走 CMD：crop.apply（undoable，＝image.crop）。其余 crop.frame／crop.commit／crop.cancel／crop.options／crop.pointer
      只动待定框与选项（跟他们 UiState::crop_rect 一样不进历史），commit 再叫 crop.apply。 */
(function(){

/* ── 常数（出处写在旁边） ── */
const HANDLE_PX = 8;           // crop_ui.rs:20  离边几个萤幕点内还抓得到边
const MIN_FRAME = 1;           // crop_ui.rs:22  手势留下的框最小 1 文件像素
const SNAP_PX = 8;             // snap_ui.rs:18  吸附距离＝8 个萤幕像素
const CLICK_DIST = 6;          // egui max_click_dist：按下后移动没超过 6 点＝点一下
const CLICK_TIME = 800;        // egui max_click_duration 0.8 s

/* Rust 的 f64::round 是「.5 远离零」（JS Math.round 是「.5 往上」） */
const rround = v => Math.sign(v) * Math.round(Math.abs(v));
const fin = v => typeof v === 'number' && isFinite(v);

/* ═══════════ 几何（crop_ui.rs 原样翻译；框一律 [x0,y0,x1,y1] 文件坐标） ═══════════ */

/* crop_ui.rs:53 hit：tol 文件像素的抓取范围；框很小时框内那一侧缩成 1/4 宽，免得整个框都是边、移动不了 */
function hit(r, p, tol){
  const axis = (lo, hi, v, otherIn) => {
    const t = Math.max(Math.min(tol, (hi - lo) / 4), 0);
    // 框外用完整的 tol，框内用缩过的 t
    const near = (e, outward) => (v - e) * outward <= tol && (e - v) * outward <= t;
    if (!otherIn) return 0;
    const a = near(lo, -1), b = near(hi, 1);
    if (a && b) return Math.abs(v - lo) <= Math.abs(v - hi) ? -1 : 1;
    if (a) return -1;
    if (b) return 1;
    return 0;
  };
  const inX = p[0] >= r[0] - tol && p[0] <= r[2] + tol;
  const inY = p[1] >= r[1] - tol && p[1] <= r[3] + tol;
  const hx = axis(r[0], r[2], p[0], inY), hy = axis(r[1], r[3], p[1], inX);
  if (hx !== 0 || hy !== 0) return {kind:'handle', hx, hy};
  if (p[0] > r[0] && p[0] < r[2] && p[1] > r[1] && p[1] < r[3]) return {kind:'inside'};
  return {kind:'outside'};
}
/* crop_ui.rs:85 normalized */
const normalized = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
/* crop_ui.rs:89 size_ok */
const sizeOk = r => r[2] - r[0] >= MIN_FRAME && r[3] - r[1] >= MIN_FRAME;

/* chrome_ui.rs:164 marquee_end（裁剪只用到「固定比例」与「⇧ 正方」两支） */
function marqueeEnd(style, w, h, shift, start, end){
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
  if (style === 'fixedSize') return [start[0] + sx * Math.max(w, 1), start[1] + sy * Math.max(h, 1)];
  if (style === 'fixedRatio' && w > 0 && h > 0){
    const k = Math.max(Math.abs(dx) / w, Math.abs(dy) / h);       // 拖得较多的那一边说了算
    return [start[0] + sx * k * w, start[1] + sy * k * h];
  }
  if (shift){ const m = Math.max(Math.abs(dx), Math.abs(dy)); return [start[0] + sx * m, start[1] + sy * m]; }
  return end;
}

/* chrome_ui.rs:183 CROP_RATIOS（key, 标签字串 key） */
const CROP_RATIOS = [['', 'ui.cropRatio'], ['original', 'ui.cropOriginal'], ['1:1', 'ui.crop11'], ['4:5', 'ui.crop45'],
                     ['5:7', 'ui.crop57'], ['2:3', 'ui.crop23'], ['16:9', 'ui.crop169']];
/* chrome_ui.rs:194 crop_ratio：比例 key → [宽, 高]（original＝文件宽高）；空白／看不懂 → null */
function cropRatio(key, dw, dh){
  if (key === 'original') return [dw, dh];
  const i = String(key || '').indexOf(':'); if (i < 0) return null;
  const a = String(key).slice(0, i).trim(), b = String(key).slice(i + 1).trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(a) || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(b)) return null;   // Rust parse::<f64>
  return [Number(a), Number(b)];
}
/* crop_ui.rs:94 preset_ratio：选项栏比例 → 宽/高；不是有限正数就当没有 */
function presetRatio(){
  const r = cropRatio(CS.opt.ratio, Doc.width, Doc.height); if (!r) return null;
  const k = r[0] / r[1];
  return isFinite(k) && k > 0 ? k : null;
}
/* crop_ui.rs:100 drawn：从 anchor 拉到 cur 的新框——有比例按比例，否则 ⇧ 正方；⌥ 以 anchor 为中心 */
function drawn(anchor, cur, ratio, m){
  const e = ratio !== null ? marqueeEnd('fixedRatio', ratio, 1, false, anchor, cur)
                           : marqueeEnd('', 0, 0, !!m.shift, anchor, cur);
  return m.alt ? normalized([2 * anchor[0] - e[0], 2 * anchor[1] - e[1]], e) : normalized(anchor, e);
}
/* crop_ui.rs:110 resized：把手 (hx,hy) 拖了 d；alt＝绕中心；ratio（宽/高）＝保持比例 */
function resized(r, hx, hy, d, ratio, alt){
  // 每一轴：固定点、从固定点量的带号长度、是否以中心为准（是的话长度是半长）
  const axis = (lo, hi, h, dd) => {
    const c = (lo + hi) / 2;
    if (h === 1) return alt ? [c, hi + dd - c, true] : [lo, hi + dd - lo, false];
    if (h === -1) return alt ? [c, lo + dd - c, true] : [hi, lo + dd - hi, false];
    return [c, (hi - lo) / 2, true];
  };
  let [fx, ex, cx] = axis(r[0], r[2], hx, d[0]);
  let [fy, ey, cy] = axis(r[1], r[3], hy, d[1]);
  if (ratio !== null && isFinite(ratio) && ratio > 0){
    const full = (e, c) => Math.abs(e) * (c ? 2 : 1);
    let w = full(ex, cx), h = full(ey, cy);
    if (hx !== 0 && hy !== 0){ const s = Math.max(w / ratio, h); w = s * ratio; h = s; }   // 角：相对较大的那边说了算
    else if (hx !== 0) h = w / ratio;
    else if (hy !== 0) w = h * ratio;
    const back = (e, len, c) => (e < 0 ? -1 : 1) * (c ? len / 2 : len);
    ex = back(ex, w, cx); ey = back(ey, h, cy);
  }
  const span = (f, e, c) => c ? [f - e, f + e] : [f, f + e];
  const [ax, bx] = span(fx, ex, cx), [ay, by] = span(fy, ey, cy);
  return normalized([ax, ay], [bx, by]);
}

/* ═══════════ 吸附（snap_ui.rs begin/apply ＋ snap.rs from_document/nearest/snap_point/snap_rect） ═══════════ */
function alphaBounds(cv, ox, oy){
  const w = cv.width, h = cv.height; if (!w || !h) return null;
  const d = cv.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++){ const row = y * w * 4; for (let x = 0; x < w; x++) if (d[row + x * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; } }
  return x1 < 0 ? null : [x0 + ox, y0 + oy, x1 + 1 + ox, y1 + 1 + oy];
}
/* snap.rs layer_rect：像素层画布是图层坐标（加 L.x/L.y，铁律④）；矢量／文字层 renderLayer 出来已是文件坐标 */
const layerRect = L => L.kind === 'raster' ? alphaBounds(L.data.canvas, L.x, L.y) : alphaBounds(renderLayer(L, 1), 0, 0);
function addRect(t, r, edge, center){
  t.x.push({pos:r[0], kind:edge}, {pos:r[2], kind:edge}, {pos:(r[0] + r[2]) / 2, kind:center});
  t.y.push({pos:r[1], kind:edge}, {pos:r[3], kind:edge}, {pos:(r[1] + r[3]) / 2, kind:center});
}
/* snap.rs:102 from_document（参考线／格点本画板还没有 ⇒ 那两族空）；smart＝只留文件与图层（智慧参考线） */
function buildTargets(smart){
  const t = {x:[], y:[]};
  addRect(t, [0, 0, Doc.width, Doc.height], 'documentEdge', 'documentCenter');
  for (const L of Doc.layers){ if (!L.visible) continue; const r = layerRect(L); if (r) addRect(t, r, 'layerEdge', 'layerCenter'); }
  const s = Doc.sel;
  if (!smart && s && s.w > 0 && s.h > 0){
    t.x.push({pos:s.x, kind:'selection'}, {pos:s.x + s.w, kind:'selection'});
    t.y.push({pos:s.y, kind:'selection'}, {pos:s.y + s.h, kind:'selection'});
  }
  return t;
}
/* snap.rs:171 nearest（同距离参考线优先） */
function nearest(list, v, tol){
  let best = null;
  for (const a of list){
    const d = Math.abs(a.pos - v); if (d > tol) continue;
    if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && a.kind === 'guide' && best.t.kind !== 'guide')) best = {d, t:a};
  }
  return best ? best.t : null;
}
/* snap.rs:197 snap_point：两轴各自吸到最近的目标 */
function snapPoint(t, p, tol){
  const out = p.slice();
  const a = nearest(t.x, p[0], tol); if (a) out[0] = a.pos;
  const b = nearest(t.y, p[1], tol); if (b) out[1] = b.pos;
  return out;
}
/* snap.rs:214 snap_rect：移动中的框，每轴取「边／中线」里离目标最近的那个来修正 → 位移 */
function snapRect(t, r, tol){
  const delta = [0, 0];
  [[0, t.x], [1, t.y]].forEach(([axis, list]) => {
    const a = r[axis], b = r[axis + 2];
    let best = null;
    for (const v of [a, (a + b) / 2, b]){
      const n = nearest(list, v, tol);
      if (n){ const d = n.pos - v; if (!best || Math.abs(d) < best.ad) best = {ad:Math.abs(d), d}; }
    }
    if (best) delta[axis] = best.d;
  });
  return delta;
}
const isEmptyT = t => !t.x.length && !t.y.length;
/* View › Snap、智慧参考线两个开关跟移动工具共用（他们是 app.ui.extras.snap／show.smart_guides 全域开关）；移动工具没载入当开着（PS 出厂） */
const snapOn = () => !(window.MoveTool && MoveTool.opt && MoveTool.opt.snap === false);
const smartOn = () => !(window.MoveTool && MoveTool.opt && MoveTool.opt.smartGuides === false);

/* ═══════════ 工具状态 ═══════════ */
const CS = window.CropTool = {
  // state.rs:456-457 预设：比例空白（不限）、删除裁剪像素＝开
  opt: {ratio:'', deleteCroppedPixels:true},
  frame: null,        // UiState::crop_rect：待定的裁剪框 [x0,y0,x1,y1]（文件坐标）或 null
  serial: -1,         // 框是在哪一份文件上拉的（开新档就作废）
  drag: null,         // CropState::drag：{type:'draw', anchor, cur, last, prev} | {type:'move', start, rect} | {type:'resize', hx, hy, start, rect}
  space: false,       // CropState::space：Space 按着
  snap: null,         // snap_ui ActiveSnap：{gesture:'point'|'move', start, rect?, targets, smart, disabled}
  mods: {shift:false, alt:false, ctrl:false},   // 手势最后一次的修饰键（键盘改修饰键时重算用）
  lastPt: null,       // 手势最后一次（吸附前）的指针点
  press: null,        // 滑鼠按下：{client, t0, moved, pt}（点击距离判定）

  zoom(){ return Math.max((window.UI && UI.zoom) || 1, 0.01); },
  /* crop_ui.rs:157 tolerance＝8 萤幕点换成文件像素 */
  tolerance(){ return HANDLE_PX / this.zoom(); },
  /* 开了新档／开工程 ⇒ 旧框作废 */
  validate(){ if (this.frame && this.serial !== Doc.serial){ this.frame = null; this.drag = null; } },
  setFrame(r){ this.frame = r ? r.slice() : null; this.serial = Doc.serial; },

  /* ── snap_ui.rs:135 begin ＋ :211 filter_event：工具看到事件前先吸附 ── */
  snapBegin(p){
    const tol = SNAP_PX / this.zoom();
    let gesture = 'point', rect = null;
    // 框内按下＝移动整个框：吸的是框的边与中线（像移动工具的图层外框）；否则是「点」
    if (this.frame && hit(this.frame, p, tol).kind === 'inside'){ gesture = 'move'; rect = this.frame.slice(); }
    const targets = snapOn() ? buildTargets(false) : {x:[], y:[]};
    const smart = (gesture === 'move' && smartOn()) ? buildTargets(true) : {x:[], y:[]};
    this.snap = {gesture, start:p.slice(), rect, targets, smart, disabled:false};
  },
  snapApply(p){
    const s = this.snap; if (!s || s.disabled) return p;
    const tol = SNAP_PX / this.zoom();
    if (s.gesture === 'point') return snapPoint(s.targets, p, tol);
    const d = [p[0] - s.start[0], p[1] - s.start[1]];
    const moved = [s.rect[0] + d[0], s.rect[1] + d[1], s.rect[2] + d[0], s.rect[3] + d[1]];
    const adj = snapRect(isEmptyT(s.targets) ? s.smart : s.targets, moved, tol);
    return [p[0] + adj[0], p[1] + adj[1]];
  },

  /* ── crop_ui.rs:162 pointer：Down／Move／Up（滑鼠与 crop.pointer 共用） ── */
  down(pt, m){
    if (!fin(pt[0]) || !fin(pt[1])) return;
    this.validate();
    this.snapBegin(pt);
    // Down：「点」手势照样吸；移动手势吸的是位移，按下这一刻是 0
    const p = this.snap.gesture === 'point' ? this.snapApply(pt) : pt.slice();
    this.mods = {shift:!!m.shift, alt:!!m.alt, ctrl:!!m.ctrl}; this.lastPt = pt.slice();
    const frame = this.frame && this.frame.every(fin) ? this.frame : null;
    const h = frame ? hit(frame, p, this.tolerance()) : null;
    if (h && h.kind === 'handle') this.drag = {type:'resize', hx:h.hx, hy:h.hy, start:p, rect:frame.slice()};
    else if (h && h.kind === 'inside') this.drag = {type:'move', start:p, rect:frame.slice()};
    else this.drag = {type:'draw', anchor:p, cur:p.slice(), last:p.slice(), prev:this.frame ? this.frame.slice() : null};
  },
  move(pt, m){
    if (!this.drag || !fin(pt[0]) || !fin(pt[1])) return;
    if (this.snap) this.snap.disabled = !!m.ctrl;              // 拖的「途中」按着 Ctrl 才暂停吸附
    this.mods = {shift:!!m.shift, alt:!!m.alt, ctrl:!!m.ctrl}; this.lastPt = pt.slice();
    this.update(this.snapApply(pt), this.mods);
  },
  up(pt, m){
    if (!this.drag) return;
    if (fin(pt[0]) && fin(pt[1])) this.move(pt, m);
    this.snap = null;
    const d = this.drag; this.drag = null;
    const ok = !!this.frame && sizeOk(this.frame);
    if (!ok){
      if (d.type === 'draw') this.setFrame(d.prev);            // 画出来太小（点一下）⇒ 还原成原来那个框（或没有）
      else this.setFrame(d.rect);                              // 移动／改大小弄到没面积 ⇒ 还原成这一手开始时的框
    }
  },
  /* crop_ui.rs:198 update：框跟着指针 */
  update(p, m){
    const d = this.drag; if (!d) return;
    const ratio = presetRatio();
    let rect;
    if (d.type === 'draw'){
      if (this.space){
        // Space：正在画的框整个跟着指针走，大小不变
        const dx = p[0] - d.last[0], dy = p[1] - d.last[1];
        d.anchor = [d.anchor[0] + dx, d.anchor[1] + dy];
        d.cur = [d.cur[0] + dx, d.cur[1] + dy];
      } else d.cur = p.slice();
      d.last = p.slice();
      if (d.anchor[0] === d.cur[0] && d.anchor[1] === d.cur[1]) return;
      rect = drawn(d.anchor, d.cur, ratio, m);
    } else if (d.type === 'move'){
      const dx = p[0] - d.start[0], dy = p[1] - d.start[1];
      rect = [d.rect[0] + dx, d.rect[1] + dy, d.rect[2] + dx, d.rect[3] + dy];
    } else {
      // 选项栏比例优先；没有就看 ⇧＝保持这个框现在的比例
      const w = d.rect[2] - d.rect[0], h = d.rect[3] - d.rect[1];
      const keep = (w > 0 && h > 0) ? w / h : null;
      const k = ratio !== null ? ratio : (m.shift ? keep : null);
      rect = resized(d.rect, d.hx, d.hy, [p[0] - d.start[0], p[1] - d.start[1]], k, !!m.alt);
    }
    this.setFrame(rect);
  },
  /* 键盘改了修饰键（指针没动）：他们每一格都用最新修饰键重算，我们这里补叫一次 */
  remod(m){
    if (!this.drag || !this.lastPt) return;
    this.move(this.lastPt, Object.assign({}, this.mods, m));
  },

  /* crop_ui.rs:235 cursor */
  cursorAt(p){
    let h;
    const d = this.drag;
    if (d) h = d.type === 'move' ? {kind:'inside'} : d.type === 'resize' ? {kind:'handle', hx:d.hx, hy:d.hy} : {kind:'outside'};
    else if (this.frame) h = hit(this.frame, p, this.tolerance());
    else return null;                                           // 还没框：工具预设的十字
    if (h.kind === 'handle'){
      if (h.hx !== 0 && h.hy !== 0) return h.hx === h.hy ? 'nwse-resize' : 'nesw-resize';
      return h.hy === 0 ? 'ew-resize' : 'ns-resize';
    }
    return h.kind === 'inside' ? 'move' : 'crosshair';
  },
  setCursor(p){
    if (!window.UI || !UI.canvas || (window.HandTemp && (HandTemp.space || HandTemp.drag))) return;
    UI.canvas.style.cursor = this.cursorAt(p) || 'crosshair';
  },

  /* canvas.rs:1761 crop_overlay：框外压暗、白框、三分线、角把手与边把手 */
  draw(ctx, s){
    this.validate();
    const c = this.frame; if (!c || !c.every(fin)) return;
    const dpr = s / this.zoom();
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const r = {l:c[0] * s, t:c[1] * s, r:c[2] * s, b:c[3] * s};
    const w = r.r - r.l, h = r.b - r.t;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,' + (130 / 255) + ')';
    const band = (x0, y0, x1, y1) => {
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
      if (x1 > x0 && y1 > y0) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    band(0, 0, W, r.t);                // 上
    band(0, r.b, W, H);                // 下
    band(0, r.t, r.l, r.b);            // 左
    band(r.r, r.t, W, r.b);            // 右
    ctx.lineWidth = dpr; ctx.strokeStyle = '#fff';
    ctx.strokeRect(r.l, r.t, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,' + (90 / 255) + ')';
    ctx.beginPath();
    for (let i = 1; i < 3; i++){
      const fx = r.l + w * i / 3, fy = r.t + h * i / 3;
      ctx.moveTo(fx, r.t); ctx.lineTo(fx, r.b);
      ctx.moveTo(r.l, fy); ctx.lineTo(r.r, fy);
    }
    ctx.stroke();
    ctx.lineWidth = 3 * dpr; ctx.strokeStyle = '#fff'; ctx.lineCap = 'butt';
    const l = Math.min(14 * dpr, w / 3, h / 3);
    ctx.beginPath();
    for (const [x, y, dx, dy] of [[r.l, r.t, 1, 1], [r.r, r.t, -1, 1], [r.l, r.b, 1, -1], [r.r, r.b, -1, -1]]){
      ctx.moveTo(x, y); ctx.lineTo(x + l * dx, y);
      ctx.moveTo(x, y); ctx.lineTo(x, y + l * dy);
    }
    // 边把手：每边中段一小截
    const lx = Math.min(l, w / 4) / 2, ly = Math.min(l, h / 4) / 2;
    const cx = (r.l + r.r) / 2, cy = (r.t + r.b) / 2;
    ctx.moveTo(cx - lx, r.t); ctx.lineTo(cx + lx, r.t);
    ctx.moveTo(cx - lx, r.b); ctx.lineTo(cx + lx, r.b);
    ctx.moveTo(r.l, cy - ly); ctx.lineTo(r.l, cy + ly);
    ctx.moveTo(r.r, cy - ly); ctx.lineTo(r.r, cy + ly);
    ctx.stroke();
    ctx.restore();
  }
};

/* ═══════════ 命令 ═══════════ */
/* commands.rs int()：整数，或小数四舍五入（远离零） */
const int = (p, k) => {
  const v = p[k]; if (v === undefined || v === null || v === '') return null;
  const n = Number(v); return isFinite(n) ? rround(n) : null;
};

/* image_cmds.rs:149 translate_doc ＋ :166 crop_doc，套到我们的图层模型上：
   · 像素层：删除裁剪像素 ⇒ 新开一张「新文件大小」的画布，把旧画布贴在 (L.x−x, L.y−y)，L.x/L.y 归零（＝crop_surface 再平移）；
             不删 ⇒ 只平移 L.x/L.y −= (x,y)，画布外的像素留着；画布不够盖住新文件范围就补大（他们的 Surface 是无边界的）
   · 矢量／文字层：L.x/L.y −= (x,y)（与移动工具同一套位移，所有形状一起走）
   · 遮罩：像素层的像素遮罩贴在该层自己的画布上（composite 同）⇒ 跟着该层画布一起搬、重贴成该层新画布大小；其余层的像素遮罩照「删除」那样重贴进新文件大小；矢量／文字遮罩平移 */
function newCanvas(w, h){
  const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h);
  return {canvas:c, ctx:c.getContext('2d', {willReadFrequently:true})};
}
function cropLayer(L, x, y, W, H, del){
  const ox = L.x || 0, oy = L.y || 0;      // 像素层的像素蒙版跟着该层画布走（贴在该层原点）
  if (L.kind === 'raster'){
    if (del){
      const n = newCanvas(W, H);
      n.ctx.drawImage(L.data.canvas, L.x - x, L.y - y);
      L.data = n; L.x = 0; L.y = 0;
    } else {
      L.x -= x; L.y -= y;
      const cw = L.data.canvas.width, ch = L.data.canvas.height;
      const nx0 = Math.min(L.x, 0), ny0 = Math.min(L.y, 0), nx1 = Math.max(L.x + cw, W), ny1 = Math.max(L.y + ch, H);
      if (nx0 !== L.x || ny0 !== L.y || nx1 - nx0 !== cw || ny1 - ny0 !== ch){
        const n = newCanvas(nx1 - nx0, ny1 - ny0);
        n.ctx.drawImage(L.data.canvas, L.x - nx0, L.y - ny0);
        L.data = n; L.x = nx0; L.y = ny0;
      }
    }
  } else { L.x -= x; L.y -= y; }
  Layer.invalidate(L);
  const M = L.mask || L.maskOff;   // 停用中的蒙版也跟着搬（再开时贴回对的位置）
  if (M){
    if (M.kind === 'raster' && L.kind === 'raster' && L.maskLinked === false && Array.isArray(L.maskAnchor)){
      // 取消链接的蒙版贴在 maskAnchor（文件座标）⇒ 锚点跟着裁切平移·蒙版画布不动
      L.maskAnchor = [L.maskAnchor[0] + (M.x || 0) - x, L.maskAnchor[1] + (M.y || 0) - y]; M.x = 0; M.y = 0;
    } else if (M.kind === 'raster'){
      // PS：裁切往外扩＝新长出来的地方照蒙版预设色填（显示全部＝白、隐藏全部＝黑）；预设色＝M.defaultColor，旧档没存才看四边（menus/impl/ps-image.js PsMaskFill.white）
      const white = !!(window.PsMaskFill && (PsMaskFill.white ? PsMaskFill.white(M) : PsMaskFill.edgeWhite(M.data.canvas)));
      const c = L.kind === 'raster' ? L.data.canvas : null, n = c ? newCanvas(c.width, c.height) : newCanvas(W, H);
      const dx = c ? ox + (M.x || 0) - x - L.x : (M.x || 0) - x, dy = c ? oy + (M.y || 0) - y - L.y : (M.y || 0) - y;
      if (white){ n.ctx.fillStyle = '#ffffff'; n.ctx.fillRect(0, 0, n.canvas.width, n.canvas.height); n.ctx.clearRect(dx, dy, M.data.canvas.width, M.data.canvas.height); }
      n.ctx.drawImage(M.data.canvas, dx, dy);
      M.data = n; M.x = 0; M.y = 0;
    } else { M.x = (M.x || 0) - x; M.y = (M.y || 0) - y; }
    Layer.invalidate(M);
  }
}

/* image_cmds.rs:249 crop（image.crop） */
function applyCrop(p){
  const del = typeof p.deleteCroppedPixels === 'boolean' ? p.deleteCroppedPixels : true;
  const x = int(p, 'x'), y = int(p, 'y');
  const w = int(p, 'width') !== null ? int(p, 'width') : int(p, 'w');
  const h = int(p, 'height') !== null ? int(p, 'height') : int(p, 'h');
  let r = null;
  // 明给的矩形（裁剪工具）可以超出画布；用选区就夹在画布里
  if (x !== null && y !== null && w !== null && h !== null && w > 0 && h > 0) r = [x, y, x + w, y + h];
  else if (Doc.sel){
    const s = Doc.sel;   // content_bounds：有覆盖的整格 → floor/ceil，再与画布取交集
    const b = [Math.max(0, Math.floor(Math.min(s.x, s.x + s.w))), Math.max(0, Math.floor(Math.min(s.y, s.y + s.h))),
               Math.min(Doc.width, Math.ceil(Math.max(s.x, s.x + s.w))), Math.min(Doc.height, Math.ceil(Math.max(s.y, s.y + s.h)))];
    if (b[2] > b[0] && b[3] > b[1]) r = b;
  }
  if (!r) return {ok:false, error:'nothing to crop: pass x/y/width/height or make a selection'};
  const W = r[2] - r[0], H = r[3] - r[1];
  for (const L of Doc.layers) cropLayer(L, r[0], r[1], W, H, del);
  Doc.width = W; Doc.height = H;
  Doc.sel = null;                                               // doc.selection = None
  return {x:r[0], y:r[1], width:W, height:H};
}
CMD.reg('crop.apply', {i18n:'tool.crop', undoable:true,
  params:'{x, y, width, height 文件坐标整数（也收 w/h；小数四舍五入）, deleteCroppedPixels=true} 同 PhotoCraft image.crop：文件改成 width×height，所有图层平移 −(x,y)；矩形可超出画布（外扩、新区域透明）；不给矩形就裁到选区外框（夹在画布内）；deleteCroppedPixels=false 时像素层框外的像素留在层里（L.x/L.y 变负、画布比文件大）；选区清掉 → {x,y,width,height}'},
  applyCrop);

/* canvas.rs:2269 commit_crop：框四舍五入 → image.crop（带选项「删除裁剪像素」）→ 视图重新 fit */
function commit(){
  CS.validate();
  const r = CS.frame; if (!r) return {ok:false, error:'no crop frame'};
  CS.frame = null; CS.drag = null;
  const x = rround(r[0]), y = rround(r[1]);
  const w = Math.max(1, rround(r[2] - r[0])), h = Math.max(1, rround(r[3] - r[1]));
  let res;
  try { res = CMD.run('crop.apply', {x, y, width:w, height:h, deleteCroppedPixels:CS.opt.deleteCroppedPixels}); }
  catch (err){ return {ok:false, error:String(err && err.message || err)}; }
  if (res && res.ok !== false && CMD.map['view.fit']) CMD.run('view.fit');   // views[i].fit_pending = true
  return res;
}
CMD.reg('crop.commit', {i18n:'', params:'{} 确认待定的裁剪框（＝选项栏 ✓／Enter）：框四舍五入成整数后跑 crop.apply（用选项的 deleteCroppedPixels），再让视图重新 fit；没框回 ok:false → crop.apply 的结果'},
  () => commit());
CMD.reg('crop.cancel', {i18n:'', params:'{} 取消待定的裁剪框（＝选项栏 ⊘／Esc），不改文件'},
  () => { CS.frame = null; CS.drag = null; CS.snap = null; if (window.UI) UI.draw(); return {ok:true}; });
CMD.reg('crop.frame', {i18n:'',
  params:'{x0,y0,x1,y1} 或 {x,y,width,height} 文件坐标（可小数、可超出画布）设待定的裁剪框；{clear:true} 清掉；什么都不给＝只读 → {frame:[x0,y0,x1,y1]|null}（同 PhotoCraft UiState::crop_rect，不进历史）'},
  p => {
    CS.validate();
    if (p.clear) CS.setFrame(null);
    else if ([p.x0, p.y0, p.x1, p.y1].every(v => v !== undefined)){
      const v = [p.x0, p.y0, p.x1, p.y1].map(Number);
      if (!v.every(isFinite)) return {ok:false, error:'non-finite frame'};
      CS.setFrame(normalized([v[0], v[1]], [v[2], v[3]]));
    } else if ([p.x, p.y].every(v => v !== undefined)){
      const x = Number(p.x), y = Number(p.y), w = Number(p.width !== undefined ? p.width : p.w), h = Number(p.height !== undefined ? p.height : p.h);
      if (![x, y, w, h].every(isFinite)) return {ok:false, error:'non-finite frame'};
      CS.setFrame(normalized([x, y], [x + w, y + h]));
    }
    if (window.UI) UI.draw();
    return {frame: CS.frame ? CS.frame.slice() : null};
  });

/* panels.rs:672-692 选项栏的每个控件都只是叫这条 */
const fmtNum = v => String(+Number(v).toFixed(6));                 // widgets::fmt_num：去掉多余的 0
CMD.reg('crop.options', {i18n:'',
  params:'{ratio?=""（不限）|"original"（文件原比例）|"1:1"|"4:5"|"5:7"|"2:3"|"16:9"|任意"w:h", ratioWidth?, ratioHeight?（两格都 >0 才成为 "w:h"）, swap?=true 对调宽高, clear?=true 清掉比例, deleteCroppedPixels?=bool} → 目前选项'},
  p => {
    const o = CS.opt;
    if (typeof p.ratio === 'string') o.ratio = p.ratio;
    if (p.clear) o.ratio = '';
    if (p.ratioWidth !== undefined || p.ratioHeight !== undefined || p.swap){
      // panels.rs:677-686：先拿目前比例的两个数（original 拿不到数 ⇒ 0），改了其中一格或对调，两格都 >0 才写回 "w:h"
      const cur = cropRatio(o.ratio, 0, 0) || [0, 0];
      let rw = p.ratioWidth !== undefined ? Number(p.ratioWidth) : cur[0];
      let rh = p.ratioHeight !== undefined ? Number(p.ratioHeight) : cur[1];
      rw = Math.min(99999, Math.max(0, isFinite(rw) ? rw : 0)); rh = Math.min(99999, Math.max(0, isFinite(rh) ? rh : 0));
      if (p.swap) [rw, rh] = [rh, rw];
      if (rw > 0 && rh > 0) o.ratio = fmtNum(rw) + ':' + fmtNum(rh);
    }
    if (typeof p.deleteCroppedPixels === 'boolean') o.deleteCroppedPixels = p.deleteCroppedPixels;
    if (window.UI && ToolState.cur === 'crop') UI.buildOptions('crop');
    return Object.assign({}, o);
  });

/* agent 送一串指针事件（同 PhotoCraft ui.pointer）：跟人拿滑鼠走同一个 down/move/up，修饰键、Space、吸附、比例全部一样 */
CMD.reg('crop.pointer', {i18n:'',
  params:'{events:[{kind:"down"|"move"|"up", x, y 文件坐标, shift?（画框＝正方；拉把手＝保持比例）, alt?（从中心）, ctrl?（拖的途中＝不吸附）, space?（画框途中＝整个框跟着走）}…], snap?=true} 框外拖＝画新框、框内拖＝移动框、边角拖＝改大小；结果太小就还原 → {frame}'},
  p => {
    const evs = Array.isArray(p.events) ? p.events : [];
    const MT = window.MoveTool, saved = MT && MT.opt ? [MT.opt.snap, MT.opt.smartGuides] : null;
    if (p.snap === false && saved){ MT.opt.snap = false; MT.opt.smartGuides = false; }
    const sp = CS.space;
    try {
      for (const e of evs){
        const pt = [Number(e.x), Number(e.y)];
        const m = {shift:!!e.shift, alt:!!e.alt, ctrl:!!e.ctrl};
        CS.space = !!e.space;
        if (e.kind === 'down') CS.down(pt, m);
        else if (e.kind === 'move') CS.move(pt, m);
        else if (e.kind === 'up') CS.up(pt, m);
      }
    } finally {
      CS.space = sp;
      if (saved){ MT.opt.snap = saved[0]; MT.opt.smartGuides = saved[1]; }
    }
    if (window.UI) UI.draw();
    return {frame: CS.frame ? CS.frame.slice() : null};
  });

/* ── 键盘：Space（画框途中＝重新定位）、Shift／Alt（没移动也重算框） ── */
const typing = el => !!el && (el.isContentEditable || /^(input|select|textarea)$/i.test(el.tagName));
// hold_keys.rs／canvas.rs:1427：裁剪手势进行中 Space 归裁剪（重新定位），不变暂时抓手（执行时把 crop 补进 hand.js 的名单）
const claimSpace = () => { try { if (typeof HAND_REPOSITION_TOOLS !== 'undefined') HAND_REPOSITION_TOOLS.add('crop'); } catch(_){} };
claimSpace(); window.addEventListener('load', claimSpace);
window.addEventListener('keydown', e => {
  if (typing(e.target)) return;
  if (e.code === 'Space' || e.key === ' '){ CS.space = true; return; }
  if ((e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control') && ToolState.cur === 'crop' && CS.drag){
    if (e.key === 'Alt') e.preventDefault();
    CS.remod({shift:e.shiftKey, alt:e.altKey, ctrl:e.ctrlKey && !e.metaKey}); UI.draw();
  }
}, true);
window.addEventListener('keyup', e => {
  if (e.code === 'Space' || e.key === ' '){ CS.space = false; return; }
  if ((e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control') && ToolState.cur === 'crop' && CS.drag){
    CS.remod({shift:e.shiftKey, alt:e.altKey, ctrl:e.ctrlKey && !e.metaKey}); UI.draw();
  }
}, true);
window.addEventListener('blur', () => { CS.space = false; });

/* ── 三语 ── */
const STRINGS = {
  'zh-Hant':{'tool.crop':'裁切', 'opt.cropRatio':'比例', 'ui.cropRatio':'比例', 'ui.cropOriginal':'原始比例', 'ui.crop11':'1 : 1（正方形）', 'ui.crop45':'4 : 5（8 : 10）',
    'ui.crop57':'5 : 7', 'ui.crop23':'2 : 3（4 : 6）', 'ui.crop169':'16 : 9', 'ui.cropCustom':'自訂', 'ui.cropSwap':'交換高度和寬度', 'ui.cropClear':'清除',
    'ui.cropThirds':'覆蓋：三分法', 'opt.cropDelete':'刪除裁切的像素', 'ui.cropCommit':'確認目前的裁切操作  (Enter)', 'ui.cropCancel':'取消目前的裁切操作  (Esc)',
    'ui.cropHint':'拖曳出裁切框 · 框內拖曳＝移動 · 拖邊角改大小（Shift 保持比例、Alt 從中心）· 畫框時按住 Space 移動 · Ctrl 暫停吸附 · Enter 確認 · Esc 取消'},
  'zh-Hans':{'tool.crop':'裁剪', 'opt.cropRatio':'比例', 'ui.cropRatio':'比例', 'ui.cropOriginal':'原始比例', 'ui.crop11':'1 : 1（方形）', 'ui.crop45':'4 : 5（8 : 10）',
    'ui.crop57':'5 : 7', 'ui.crop23':'2 : 3（4 : 6）', 'ui.crop169':'16 : 9', 'ui.cropCustom':'自定', 'ui.cropSwap':'高度和宽度互换', 'ui.cropClear':'清除',
    'ui.cropThirds':'叠加：三分法', 'opt.cropDelete':'删除裁剪像素', 'ui.cropCommit':'提交当前裁剪操作  (Enter)', 'ui.cropCancel':'取消当前裁剪操作  (Esc)',
    'ui.cropHint':'拖出裁剪框 · 框内拖动＝移动 · 拖边角改大小（Shift 保持比例、Alt 从中心）· 画框时按住 Space 移动 · Ctrl 暂停吸附 · Enter 提交 · Esc 取消'},
  'en':{'tool.crop':'Crop', 'opt.cropRatio':'Ratio', 'ui.cropRatio':'Ratio', 'ui.cropOriginal':'Original Ratio', 'ui.crop11':'1 : 1 (Square)', 'ui.crop45':'4 : 5 (8 : 10)',
    'ui.crop57':'5 : 7', 'ui.crop23':'2 : 3 (4 : 6)', 'ui.crop169':'16 : 9', 'ui.cropCustom':'Custom', 'ui.cropSwap':'Swaps height and width', 'ui.cropClear':'Clear',
    'ui.cropThirds':'Overlay: Rule of Thirds', 'opt.cropDelete':'Delete Cropped Pixels', 'ui.cropCommit':'Commit current crop operation  (Enter)', 'ui.cropCancel':'Cancel current crop operation  (Esc)',
    'ui.cropHint':'Drag a crop box · drag inside to move · edges resize (Shift ratio, Alt centre) · Space moves while drawing · Ctrl no snapping · Enter commits · Esc cancels'}
};
if (typeof Lang !== 'undefined') Lang.add(STRINGS);

Tools.reg({
  id:'crop', icon:'⌗', key:'C', group:'select', order:40, for:'common', opts:[], cursor:'crosshair',
  strings:STRINGS,

  onDown(e, pt){
    if (e.button !== undefined && e.button !== 0){ CS.press = null; return; }   // 工具只跟左键（canvas.rs:1462）
    claimSpace();
    CS.press = {client:[e.clientX, e.clientY], t0:performance.now(), moved:false, pt:pt.slice()};
    // egui：拖过点击距离才发 Down，而且发在「按下那一点」——Down 不改框，所以先发也一样
    CS.down(pt, {shift:e.shiftKey, alt:e.altKey, ctrl:false});
  },
  onMove(e, pt, P){
    const pr = CS.press;
    if (!P.down || !pr || !CS.drag){ CS.setCursor(pt); return; }
    if (!pr.moved){
      const far = Math.hypot(e.clientX - pr.client[0], e.clientY - pr.client[1]) > CLICK_DIST;
      if (!far && performance.now() - pr.t0 <= CLICK_TIME) return;
      pr.moved = true;
    }
    CS.move(pt, {shift:e.shiftKey, alt:e.altKey, ctrl:e.ctrlKey && !e.metaKey});
    CS.setCursor(pt);
    UI.draw();
  },
  onUp(e, pt){
    const pr = CS.press; CS.press = null;
    if (!CS.drag){ UI.draw(); return; }
    const m = {shift:e.shiftKey, alt:e.altKey, ctrl:e.ctrlKey && !e.metaKey};
    if (pr && !pr.moved && performance.now() - pr.t0 <= CLICK_TIME){
      // 点一下（canvas.rs:1536-1553）：Down＋Up 都在放开那一点
      CS.drag = null; CS.snap = null;
      CS.down(pt, m); CS.up(pt, m);
    } else CS.up(pt, m);
    CS.setCursor(pt);
    UI.draw();
  },
  /* shortcuts.rs:273-289：有待定的框（不带修饰键）Enter 确认、Esc 取消 */
  onKey(e){
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    CS.validate();
    if (!CS.frame && !CS.drag) return false;
    if (e.key === 'Enter'){ e.preventDefault(); CMD.run('crop.commit'); return true; }
    if (e.key === 'Escape'){ e.preventDefault(); CMD.run('crop.cancel'); return true; }
    return false;
  },
  onDeactivate(){ CS.drag = null; CS.snap = null; CS.press = null; },    // pointer()：换了工具 drag 清掉，待定框留着
  drawOverlay(ctx, s){ CS.draw(ctx, s); },

  /* panels.rs:672-708 选项栏 ＋ 798-806 提示 */
  buildOptions(box, add, mk){
    const o = CS.opt;
    const set = p => { CMD.run('crop.options', p); UI.draw(); };
    const btn = (txt, tipKey, fn, data) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = txt; b.title = Lang.t(tipKey);
      b.style.cssText = 'margin:0 2px;min-width:24px;cursor:pointer;';
      Object.assign(b.dataset, data || {}); b.onclick = fn; box.appendChild(b); return b;
    };
    const sep = () => { const v = document.createElement('span'); v.style.cssText = 'display:inline-block;width:1px;height:18px;background:#555;margin:0 6px;vertical-align:middle'; box.appendChild(v); };
    // 比例下拉（不是预设的 "w:h" 就多一项「自定」显示它）
    const sel = document.createElement('select'); sel.dataset.opt = 'ratio';
    const known = CROP_RATIOS.some(([k]) => k === o.ratio);
    sel.innerHTML = CROP_RATIOS.map(([k, lk]) => `<option value="${k}"${o.ratio === k ? ' selected' : ''}>${Lang.t(lk)}</option>`).join('')
      + (known ? '' : `<option value="${o.ratio}" selected>${Lang.t('ui.cropCustom')} ${o.ratio}</option>`);
    sel.onchange = () => set({ratio:sel.value}); add('cropRatio', sel);
    // 两格宽高比（显示预设的数；original 没有数 ⇒ 0）＋ 对调
    const cur = cropRatio(o.ratio, 0, 0) || [0, 0];
    const num = (key, v) => { const n = mk('number', {min:0, max:99999, step:'any', value:v}); n.style.width = '54px'; n.dataset.opt = key; n.onchange = () => set({[key]:+n.value}); box.appendChild(n); return n; };
    num('ratioWidth', cur[0]);
    btn('⇄', 'ui.cropSwap', () => set({swap:true}), {opt:'swap'});
    num('ratioHeight', cur[1]);
    sep();
    btn(Lang.t('ui.cropClear'), 'ui.cropClear', () => set({clear:true}), {opt:'clear'});
    const g = btn('▦', 'ui.cropThirds', () => {}, {opt:'thirds'});            // 他们这颗也是常亮、只表示叠加的是三分法
    g.style.background = '#2f7fd8'; g.style.color = '#fff';
    const del = mk('checkbox', {checked:o.deleteCroppedPixels}); del.dataset.opt = 'deleteCroppedPixels';
    del.onchange = () => set({deleteCroppedPixels:del.checked}); add('cropDelete', del);
    sep();
    btn('⊘', 'ui.cropCancel', () => CMD.run('crop.cancel'), {opt:'cancel'});
    btn('✓', 'ui.cropCommit', () => CMD.run('crop.commit'), {opt:'commit'});
    const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t('ui.cropHint'); box.appendChild(h);
  }
});

})();
