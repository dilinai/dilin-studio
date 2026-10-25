/* 选框（M）——照 ArtCraft／PhotoCraft 的 Rust 原码逐段翻译
   对照源（photocraft/crates/…）：
     ui-egui/src/canvas.rs  33-120      Drag（按下时的修饰键／放开过没有）、marquee_mods、marquee_corners、marquee_px、marquee_readout、W/H 读数
     ui-egui/src/canvas.rs  1474-1555   拖曳要超过 egui 的点击距离才算拖；没拖＝点一下（Down＋Up 同一点）
     ui-egui/src/canvas.rs  1864-1901   拖曳预览：行军蚁矩形／椭圆
     ui-egui/src/canvas.rs  1942-1964   tool_move：Space 按着＝整个选框跟着走（shift_to）；否则点距 >0.25 才记
     ui-egui/src/canvas.rs  2110-2194   放开：选框宽或高 <2 ⇒ 取消选择；否则 select.rect（模式、椭圆、消除锯齿、羽化）
     ui-egui/src/canvas.rs  2255        selection_mode → tool_feedback::selection_mode
     ui-egui/src/chrome_ui.rs 162-180   marquee_end：样式（正常／固定比例／固定大小）与 Shift 正方形
     ui-egui/src/tool_feedback.rs       游标旁的 ＋／−／× 模式标记、行军蚁、椭圆折线
     ui-egui/src/hold_keys.rs  6,96-104 拖着选框时 Space＝重新定位（不变抓手）
     ui-egui/src/snap_ui.rs ＋ engine/src/snap.rs   选框角点吸附（文件边／中线、图层边／中线、选区边）；拖的途中按 Ctrl 暂停
     ui-egui/src/panels.rs  536-586, 753-761   选项栏：四个模式钮、羽化、消除锯齿（矩形时灰掉）、样式＋宽高＋对调；提示字
     ui-egui/src/state.rs   359-365, 416-452, 632   选项预设
     ui-egui/src/shortcuts.rs 290-306   M 键：当前就是选框 ⇒ 矩形／椭圆轮换；从别的工具按 M ⇒ 第一颗（矩形）
     ui-egui/src/outline.rs             选区边界（覆盖度 >0.5）合并成长线段，画成行军蚁
     engine/src/commands.rs 299-386, 1070   select.deselect／select.rect（裁到画布、椭圆 4×4 超取样、模式合成、全空＝取消选择）
     algo/src/selection.rs  76-151      coverage8 量化、combine（羽化那条路用）
     algo/src/selection_blur.rs 620-656 feather：σ＝半径/2 的高斯、核截在 3σ、画布外当 0
   🔴 改文件的事全走 CMD：marquee.select／marquee.deselect（进历史）；marquee.pointer 让 agent 送同一串滑鼠事件；marquee.options 改选项。
   我们只有一颗「选框」按钮，原码是「矩形选框」「椭圆选框」两颗 ⇒ 用选项 shape: rect|ellipse 代替（M 键照样轮换）。 */
(function(){

/* ── 常数（出处写在旁边） ── */
const CLICK_DIST = 6;          // egui 预设 max_click_dist：按下后移动没超过 6 点＝点一下，不算拖
const CLICK_TIME = 800;        // egui 预设 max_click_duration 0.8 s：按太久也算拖
const SNAP_PX = 8;             // snap_ui.rs:18  吸附距离＝8 个萤幕像素
const DASH = 4;                // tool_feedback.rs:109  行军蚁虚线长（萤幕点）

/* ═══════════ 选区遮罩（原码的 doc.selection 是 GRAY8 覆盖度图；我们的 Doc.sel 原本只有矩形） ═══════════
   相容做法：Doc.sel 仍是 {x,y,w,h}（＝content_bounds，整数），别的工具照旧拿它当外框用；
   形状不是满格矩形时，另挂不可列举的 mask = {w,h,data:Uint8Array(0..255)}（文件尺寸），并加 shape:'mask' 让 agent 看得出来。 */
const coverage8 = v => Math.floor(Math.min(1, Math.max(0, v)) * 255 + 0.5);   // selection.rs:78（NaN → 0）

const SelMask = window.SelMask = {
  /* 目前选区在文件像素 (X,Y) 的覆盖度 0..1（原码的 sample_channel(x,y,0)） */
  coverage(X, Y, sel){
    const s = sel === undefined ? Doc.sel : sel;
    if (!s) return 0;
    const m = s.mask;
    if (m && m.w === Doc.width && m.h === Doc.height){
      if (X < 0 || Y < 0 || X >= m.w || Y >= m.h) return 0;
      return m.data[Y * m.w + X] / 255;
    }
    // 纯矩形（engine 的 select.rect／select.all 造的，可能是小数）：像素格与矩形的重叠比例
    const x0 = Math.min(s.x, s.x + s.w), x1 = Math.max(s.x, s.x + s.w), y0 = Math.min(s.y, s.y + s.h), y1 = Math.max(s.y, s.y + s.h);
    const ox = Math.max(0, Math.min(X + 1, x1) - Math.max(X, x0)), oy = Math.max(0, Math.min(Y + 1, y1) - Math.max(Y, y0));
    return ox * oy;
  },
  /* 目前选区 → 整张文件大小的 8 位覆盖度（mask_from_surface(old, area)）；没选区回 null */
  bytes(sel){
    const s = sel === undefined ? Doc.sel : sel; if (!s) return null;
    const W = Doc.width, H = Doc.height;
    if (s.mask && s.mask.w === W && s.mask.h === H) return s.mask.data;
    const out = new Uint8Array(W * H);
    const x0 = Math.max(0, Math.floor(Math.min(s.x, s.x + s.w))), x1 = Math.min(W, Math.ceil(Math.max(s.x, s.x + s.w)));
    const y0 = Math.max(0, Math.floor(Math.min(s.y, s.y + s.h))), y1 = Math.min(H, Math.ceil(Math.max(s.y, s.y + s.h)));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out[y * W + x] = coverage8(this.coverage(x, y, s));
    return out;
  },
  /* 8 位覆盖度 → Doc.sel；全空回 null（commands.rs:381「什么都没选到＝取消选择」） */
  fromBytes(data){
    const W = Doc.width, H = Doc.height;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++){
      const row = y * W;
      for (let x = 0; x < W; x++) if (data[row + x]){
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y;
      }
    }
    if (x1 < 0) return null;
    const sel = {x:x0, y:y0, w:x1 + 1 - x0, h:y1 + 1 - y0};
    // 外框里每格都是 255 ⇒ 就是一个整数矩形，不挂遮罩（跟原本的 Doc.sel 一模一样，别的工具零改动）
    let full = true;
    for (let y = y0; y <= y1 && full; y++) for (let x = x0; x <= x1; x++) if (data[y * W + x] !== 255){ full = false; break; }
    if (!full){
      sel.shape = 'mask';
      Object.defineProperty(sel, 'mask', {value:{w:W, h:H, data}, enumerable:false});
    }
    return sel;
  },
  /* 给共用层用：选区覆盖度画成「图层坐标」的一张遮罩画布（白色、alpha＝覆盖度），可拿去 destination-in */
  maskCanvas(L){
    const s = Doc.sel; if (!s) return null;
    const cw = L ? L.data.canvas.width : Doc.width, ch = L ? L.data.canvas.height : Doc.height;
    const ox = L ? L.x : 0, oy = L ? L.y : 0;
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const x = c.getContext('2d'), img = x.createImageData(cw, ch), d = img.data;
    for (let y = 0; y < ch; y++) for (let X = 0; X < cw; X++){
      const i = (y * cw + X) * 4, v = coverage8(this.coverage(X + ox, y + oy, s));
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = v;
    }
    x.putImageData(img, 0, 0); return c;
  },
  /* outline.rs outline_scaled(step=1)：覆盖度 >0.5 的边界，合并成水平／垂直长线段（文件坐标） */
  _outline: {sel:null, segs:null},
  outline(sel){
    if (this._outline.sel === sel) return this._outline.segs;
    const segs = [];
    const m = sel && sel.mask;
    if (m){
      const W = m.w, b = [sel.x, sel.y, sel.x + sel.w, sel.y + sel.h];
      const inside = (x, y) => x >= b[0] && x < b[2] && y >= b[1] && y < b[3] && m.data[y * W + x] / 255 > 0.5;
      for (let y = b[1]; y <= b[3]; y++){                 // 水平边：第 y-1 列与第 y 列之间
        let run = null;
        for (let x = b[0]; x <= b[2]; x++){
          const edge = x < b[2] && inside(x, y) !== inside(x, y - 1);
          if (edge && run === null) run = x;
          else if (!edge && run !== null){ segs.push([[run, y], [x, y]]); run = null; }
        }
      }
      for (let x = b[0]; x <= b[2]; x++){                 // 垂直边
        let run = null;
        for (let y = b[1]; y <= b[3]; y++){
          const edge = y < b[3] && inside(x, y) !== inside(x - 1, y);
          if (edge && run === null) run = y;
          else if (!edge && run !== null){ segs.push([[x, run], [x, y]]); run = null; }
        }
      }
    }
    this._outline = {sel, segs};
    return segs;
  }
};

/* algo/selection_blur.rs:620-656 feather：可分离高斯，σ＝radius/2，<0.1 不动；核截在 ⌈3σ⌉；画布外当 0。
   （原码正式版只在选区外框附近算，结果相同；这里也只算外框外扩 r 那一块） */
function feather(m, w, h, radius){
  const sigma = Math.max(0, radius) / 2;
  if (sigma < 0.1) return m.slice();
  const r = Math.ceil(sigma * 3);
  let k = []; for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = k.reduce((a, b) => a + b, 0); k = k.map(v => v / sum);
  // 有值的外框
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]){ if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; by1 = y; }
  const out = new Float32Array(m.length);
  if (bx1 < 0) return out;
  const X0 = Math.max(0, bx0 - r), X1 = Math.min(w - 1, bx1 + r), Y0 = Math.max(0, by0 - r), Y1 = Math.min(h - 1, by1 + r);
  const tmp = new Float32Array(m.length);
  for (let y = by0; y <= by1; y++) for (let x = X0; x <= X1; x++){
    let a = 0;
    for (let i = 0; i < k.length; i++){ const xx = x + i - r; if (xx >= 0 && xx < w) a += m[y * w + xx] * k[i]; }
    tmp[y * w + x] = a;
  }
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++){
    let a = 0;
    for (let i = 0; i < k.length; i++){ const yy = y + i - r; if (yy >= 0 && yy < h) a += tmp[yy * w + x] * k[i]; }
    out[y * w + x] = a;
  }
  return out;
}

/* ═══════════ 命令（engine/src/commands.rs 原样翻译） ═══════════ */
const MODES = ['replace', 'add', 'subtract', 'intersect'];
const int = (p, k) => {                                  // commands.rs:120 int()：整数，或小数四舍五入
  const v = p[k]; if (v === undefined || v === null || v === '') return null;
  const n = Number(v); if (!isFinite(n)) return null;
  return Math.sign(n) * Math.round(Math.abs(n));
};

/* select.rect（commands.rs:319-386） */
function selectRect(p){
  const get = (k, alt) => { const v = int(p, k); return v === null && alt ? int(p, alt) : v; };
  const x = get('x'), y = get('y'), w = get('width', 'w'), h = get('height', 'h');
  if (x === null || y === null || w === null || h === null) return {ok:false, error:'select.rect: missing `x`/`y`/`width`/`height`'};
  const r = {x0:x, y0:y, x1:x + Math.max(0, w), y1:y + Math.max(0, h)};               // Rect::from_xywh
  const mode = typeof p.mode === 'string' ? p.mode : 'replace';
  const ellipse = p.ellipse === true;
  const aa = p.antiAlias !== undefined ? p.antiAlias !== false : true;                  // 预设 true
  const fe = Math.min(1000, Math.max(0, Number(p.feather) || 0));                       // clamp(0,1000)
  const W = Doc.width, H = Doc.height;
  // 拖出画布外的选框停在画布边（PS）；椭圆保留拖出来的形状、只在边上被切掉
  const cut = {x0:Math.max(r.x0, 0), y0:Math.max(r.y0, 0), x1:Math.min(r.x1, W), y1:Math.min(r.y1, H)};
  const shape = new Uint8Array(W * H);
  if (ellipse){
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, rx = (r.x1 - r.x0) / 2, ry = (r.y1 - r.y0) / 2;
    const inside = (X, Y) => { const dx = (X - cx) / rx, dy = (Y - cy) / ry; return dx * dx + dy * dy <= 1; };
    for (let Y = cut.y0; Y < cut.y1; Y++) for (let X = cut.x0; X < cut.x1; X++){
      const corners = [[X, Y], [X + 1, Y], [X, Y + 1], [X + 1, Y + 1]].filter(([a, b]) => inside(a, b)).length;
      let cov;
      if (!aa) cov = inside(X + 0.5, Y + 0.5) ? 1 : 0;
      else if (corners === 4) cov = 1;
      else {
        let n = 0;                                                                     // 4×4 超取样
        for (let i = 0; i < 16; i++) if (inside(X + ((i % 4) + 0.5) / 4, Y + (Math.floor(i / 4) + 0.5) / 4)) n++;
        cov = n / 16;
      }
      if (cov > 0) shape[Y * W + X] = coverage8(cov);                                  // write_pixel 到 GRAY8
    }
  } else {
    for (let Y = cut.y0; Y < cut.y1; Y++) shape.fill(255, Y * W + Math.max(cut.x0, 0), Y * W + Math.max(cut.x1, cut.x0));
  }
  const old = SelMask.bytes();
  let out;
  if (fe > 0){
    // 羽化那条路：algo selection::feather → selection::combine（selection.rs:128-151）
    const m = new Float32Array(W * H); for (let i = 0; i < m.length; i++) m[i] = shape[i] / 255;
    const f = feather(m, W, H, fe);
    const q = v => coverage8(v) / 255, at = i => old ? old[i] / 255 : 0;
    out = new Uint8Array(W * H);
    const md = MODES.includes(mode) ? mode : 'replace';
    for (let i = 0; i < out.length; i++){
      const v = f[i];
      out[i] = md === 'replace' ? coverage8(v)
             : md === 'add' ? coverage8(Math.max(at(i), q(v)))
             : md === 'subtract' ? coverage8(Math.max(at(i) - q(v), 0))
             : coverage8(Math.min(at(i), q(v)));
    }
  } else if (old && (mode === 'add' || mode === 'subtract' || mode === 'intersect')){
    // commands.rs:374-379 + 1070 combine：读出成 0..1，逐格 f(a,b)，再写回 GRAY8
    out = new Uint8Array(W * H);
    for (let i = 0; i < out.length; i++){
      const a = old[i] / 255, b = shape[i] / 255;
      out[i] = coverage8(mode === 'add' ? Math.max(a, b) : mode === 'subtract' ? a * (1 - b) : Math.min(a, b));
    }
  } else out = shape;                                                                  // replace，或原本没选区
  Doc.sel = SelMask.fromBytes(out);
  return {ok:true, selection:Doc.sel};
}

CMD.reg('marquee.select', {i18n:'tool.marquee', undoable:true,
  params:'{x, y, width, height（也收 w/h）文件坐标整数, mode="replace|add|subtract|intersect"="replace", ellipse=false, antiAlias=true, feather=0..1000 px} 同 PhotoCraft select.rect：超出画布的部分切掉；椭圆 4×4 超取样消除锯齿；羽化＝σ=半径/2 高斯；合成后全空＝取消选择 → {ok, selection:{x,y,w,h, shape?:"mask"} | null}'},
  selectRect);
CMD.reg('marquee.deselect', {i18n:'', undoable:true, params:'{} 取消选择（同 select.deselect；滑鼠在选框工具下点一下就是这条）'},
  () => { Doc.sel = null; return {ok:true}; });
CMD.reg('marquee.coverage', {i18n:'', params:'{x, y} 文件像素 → 选区在那一格的覆盖度 0..1（没选区回 0）'},
  p => ({coverage: SelMask.coverage(Math.floor(Number(p.x) || 0), Math.floor(Number(p.y) || 0))}));

/* ═══════════ 选框几何（canvas.rs / chrome_ui.rs 原样翻译） ═══════════ */
/* chrome_ui.rs:164 marquee_end */
function marqueeEnd(style, w, h, shift, start, end){
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
  if (style === 'fixedSize') return [start[0] + sx * Math.max(w, 1), start[1] + sy * Math.max(h, 1)];
  if (style === 'fixedRatio' && w > 0 && h > 0){
    const k = Math.max(Math.abs(dx) / w, Math.abs(dy) / h);     // 拖得较多的那一边说了算，另一边按比例
    return [start[0] + sx * k * w, start[1] + sy * k * h];
  }
  if (shift){ const m = Math.max(Math.abs(dx), Math.abs(dy)); return [start[0] + sx * m, start[1] + sy * m]; }
  return end;
}
/* canvas.rs:86 marquee_mods：⇧（正方／正圆）⌥（从中心）——按下时就按着的那颗是拿来选模式的，放开再按才算 */
function marqueeMods(d){
  const fresh = (now, atPress, released) => now && (!atPress || released);
  return [fresh(d.live.shift, d.press.shift, d.released.shift), fresh(d.live.alt, d.press.alt, d.released.alt)];
}
/* canvas.rs:94 marquee_corners */
function marqueeCorners(o, d, end){
  const [shift, alt] = marqueeMods(d);
  const e = marqueeEnd(o.style, o.width, o.height, shift, d.start, end);
  if (!alt) return [d.start, e];
  const dx = e[0] - d.start[0], dy = e[1] - d.start[1];
  const [hx, hy] = o.style === 'fixedSize' ? [dx / 2, dy / 2] : [dx, dy];   // 固定大小以按下点为中心；否则拖的是半径
  return [[d.start[0] - hx, d.start[1] - hy], [d.start[0] + hx, d.start[1] + hy]];
}
/* canvas.rs:107 marquee_px */
const marqueePx = (a, b) => [Math.floor(Math.min(a[0], b[0])), Math.floor(Math.min(a[1], b[1])), Math.ceil(Math.max(a[0], b[0])), Math.ceil(Math.max(a[1], b[1]))];
/* canvas.rs:112 marquee_readout */
const marqueeReadout = r => [`${r[2] - r[0]} px`, `${r[3] - r[1]} px`];
/* tool_feedback.rs:41 selection_mode（选框那一支）：⇧⌥ 交集、⇧ 增加、⌥ 减去，否则看选项栏 */
function selectionMode(bar, m){
  if (m.shift && m.alt) return 'intersect';
  if (m.shift) return 'add';
  if (m.alt) return 'subtract';
  return MODES[Math.min(3, bar | 0)];
}

/* ═══════════ 吸附（engine/src/snap.rs 的 from_document／nearest／snap_point，选框只用「点」这一种） ═══════════ */
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
  const xs = [r[1], r[3]], ys = [r[0], r[2]];
  t.x.push({pos:r[0], kind:edge, span:xs}, {pos:r[2], kind:edge, span:xs}, {pos:(r[0] + r[2]) / 2, kind:center, span:xs});
  t.y.push({pos:r[1], kind:edge, span:ys}, {pos:r[3], kind:edge, span:ys}, {pos:(r[1] + r[3]) / 2, kind:center, span:ys});
}
/* snap.rs:102 SnapTargets::from_document（参考线／格点本画板还没有 ⇒ 那两族是空的） */
function buildTargets(){
  const t = {x:[], y:[]};
  addRect(t, [0, 0, Doc.width, Doc.height], 'documentEdge', 'documentCenter');
  for (const L of Doc.layers){ if (!L.visible) continue; const r = layerRect(L); if (r) addRect(t, r, 'layerEdge', 'layerCenter'); }
  const s = Doc.sel;
  if (s && s.w > 0 && s.h > 0){
    const r = [s.x, s.y, s.x + s.w, s.y + s.h];
    t.x.push({pos:r[0], kind:'selection'}, {pos:r[2], kind:'selection'});
    t.y.push({pos:r[1], kind:'selection'}, {pos:r[3], kind:'selection'});
  }
  return t;
}
/* snap.rs:171 nearest（同距离时参考线优先）＋ :197 snap_point（两轴各自吸） */
function nearest(list, v, tol){
  let best = null;
  for (const a of list){
    const d = Math.abs(a.pos - v); if (d > tol) continue;
    if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && a.kind === 'guide' && best.t.kind !== 'guide')) best = {d, t:a};
  }
  return best ? best.t : null;
}
function snapPoint(t, p, tol){
  const out = p.slice();
  const a = nearest(t.x, p[0], tol); if (a) out[0] = a.pos;
  const b = nearest(t.y, p[1], tol); if (b) out[1] = b.pos;
  return out;
}
/* View › Snap 开关跟移动工具共用（原码是 app.ui.extras.snap 一个全域开关）；移动工具没载入就当开着（PS 出厂） */
const snapOn = () => !(window.MoveTool && MoveTool.opt && MoveTool.opt.snap === false);

/* ═══════════ 工具本体 ═══════════ */
const MQ = window.MarqueeTool = {
  // state.rs:416-452、632 的预设：羽化 0、消除锯齿开、样式正常 1:1、模式「新选区」；shape 是我们把两颗工具并成一颗多出来的
  opt: {shape:'rect', mode:0, feather:0, antiAlias:true, style:'normal', width:1, height:1},
  drag: null,          // canvas.rs Drag：{start, points, press, live, released, reposition, t0, client0, moved}
  snap: null,          // snap_ui.rs ActiveSnap（只有 point 这一种）：{targets, disabled}
  held: {shift:false, alt:false},   // 现在按着的修饰键（游标旁的模式标记用）
  hover: null,         // 指针最后的文件坐标
  space: false,        // Space 按着（拖着时＝重新定位）
  _badgeShown: false,

  zoom(){ return Math.max(UI.zoom || 1, 0.01); },
  last(){ const d = this.drag; return d.points.length ? d.points[d.points.length - 1] : d.start; },
  corners(end){ return marqueeCorners(this.opt, this.drag, end || this.last()); },
  /* 拖曳中游标旁的 W/H 读数（canvas.rs:1871-1874） */
  readout(){ return this.drag && this.drag.moved ? marqueeReadout(marqueePx(...this.corners())) : null; },
  /* 游标旁标记的模式（canvas.rs:1672-1678：拖着时用按下那一刻的修饰键——手势定了模式就不变） */
  badge(){ return selectionMode(this.opt.mode, this.drag ? this.drag.press : this.held); },

  /* ── snap_ui.rs begin / apply / filter_event ── */
  snapBegin(){ this.snap = {targets: snapOn() ? buildTargets() : {x:[], y:[]}, disabled:false}; },
  snapApply(p, ctrl){
    const s = this.snap; if (!s) return p;
    if (ctrl !== undefined) s.disabled = !!ctrl;           // 拖的「途中」按着 Ctrl 才暂停；按下那一刻的 Ctrl 不算
    return s.disabled ? p : snapPoint(s.targets, p, SNAP_PX / this.zoom());
  },

  /* Drag::track：记下这次事件的修饰键，以及按下时就按着的那几颗是否放开过 */
  track(m){
    const d = this.drag; if (!d) return;
    d.live = {shift:!!m.shift, alt:!!m.alt};
    d.released.shift = d.released.shift || !m.shift;
    d.released.alt = d.released.alt || !m.alt;
  },
  /* Drag::shift_to：重新定位——起点和每一点都平移，让最后一点落在 to（大小不变） */
  shiftTo(to){
    const d = this.drag, last = this.last();
    const dx = to[0] - last[0], dy = to[1] - last[1];
    if (!isFinite(dx) || !isFinite(dy)) return;
    d.start = [d.start[0] + dx, d.start[1] + dy];
    d.points = d.points.map(p => [p[0] + dx, p[1] + dy]);
    if (!d.points.length) d.points.push(to.slice());
  },

  /* ── 手势三段：滑鼠与 marquee.pointer 共用同一份 ── */
  gestureDown(pt, m){
    this.snapBegin();
    const p = this.snapApply(pt);                          // Down 也吸（点手势）；按下时的 Ctrl 不暂停
    const press = {shift:!!m.shift, alt:!!m.alt};
    this.drag = {start:p, points:[p], press, live:Object.assign({}, press), released:{shift:false, alt:false},
                 reposition:!!m.space, moved:!!m.moved, t0:performance.now(), client0:m.client || null};
  },
  gestureMove(pt, m){
    const d = this.drag; if (!d) return;
    if (m.space !== undefined) d.reposition = !!m.space;
    const p = this.snapApply(pt, m.ctrl);
    this.track(m);
    if (d.reposition) this.shiftTo(p);                     // canvas.rs:1951-1953
    else {
      const last = this.last();
      if (Math.abs(last[0] - p[0]) + Math.abs(last[1] - p[1]) > 0.25) d.points.push(p);   // canvas.rs:1959
    }
  },
  gestureUp(pt, m){
    const d = this.drag; if (!d) return null;
    // 没真的拖（egui 判成点一下）：Down＋Up 同一点 ⇒ 宽高 0 ⇒ 取消选择（canvas.rs:1536-1553 → 2186-2190）
    if (!d.moved){ this.drag = null; this.snap = null; return this.finish(Object.assign({}, d, {start:pt, points:[pt]}), pt); }
    if (m.space !== undefined) d.reposition = !!m.space;
    const p = this.snapApply(pt, m.ctrl);
    this.snap = null;
    this.track(m);
    if (d.reposition) this.shiftTo(p);                     // canvas.rs:2122-2124
    const last = this.last();
    if (last[0] !== p[0] || last[1] !== p[1]) d.points.push(p);
    this.drag = null;
    return this.finish(d, d.points[d.points.length - 1]);
  },
  /* canvas.rs:2183-2195 finish_gesture 的选框那段 */
  finish(d, end){
    const [a, b] = marqueeCorners(this.opt, d, end);
    const [x0, y0, x1, y1] = marqueePx(a, b);
    if (x1 - x0 < 2 || y1 - y0 < 2){
      if (Doc.sel) CMD.run('marquee.deselect');            // is_enabled("select.deselect")＝有选区才做（不白占一步历史）
      return null;
    }
    const mode = selectionMode(this.opt.mode, d.press);    // 模式看「按下那一刻」的修饰键
    return CMD.run('marquee.select', {x:x0, y:y0, width:x1 - x0, height:y1 - y0, mode,
      ellipse:this.opt.shape === 'ellipse', antiAlias:this.opt.antiAlias, feather:this.opt.feather});
  },

  /* ── 画：tool_feedback.rs 的行军蚁／椭圆折线／模式标记，canvas.rs 的读数 ── */
  ants(ctx, pts, closed, dpr){
    if (pts.length < 2) return;
    ctx.save(); ctx.lineWidth = 1;
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); if (closed) ctx.closePath();
    ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.setLineDash([DASH * dpr, DASH * dpr]); ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.restore();
  },
  ellipsePoints(r){                                        // tool_feedback.rs:158 ellipse_points
    const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, a = (r[2] - r[0]) / 2, b = (r[3] - r[1]) / 2;
    const n = Math.floor(Math.min(256, Math.max(16, (Math.abs(a) + Math.abs(b)) * 0.5)));
    const out = []; for (let i = 0; i < n; i++){ const t = i / n * Math.PI * 2; out.push([cx + a * Math.cos(t), cy + b * Math.sin(t)]); }
    return out;
  },
  drawBadge(ctx, p, mode, dpr){                            // tool_feedback.rs:84-106（游标右下 (30,11) 点，白字黑晕）
    if (mode === 'replace') return;
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
  drawReadout(ctx, p, values, dpr){                        // canvas.rs:116-145 draw_readout：游标右下 (16,18)，两列 W:/H:，数值靠右
    const labels = ['W:', 'H:'];
    ctx.save();
    ctx.font = `${11.5 * dpr}px sans-serif`; ctx.textBaseline = 'top';
    const lw = Math.max(...labels.map(t => ctx.measureText(t).width)), vw = Math.max(...values.map(t => ctx.measureText(t).width));
    const padX = 7 * dpr, padY = 4 * dpr, row = 14 * dpr;
    const bw = padX * 2 + lw + 12 * dpr + vw, bh = padY * 2 + row * 2;
    let x = p[0] + 16 * dpr, y = p[1] + 18 * dpr;
    const cw = ctx.canvas.width, ch = ctx.canvas.height;   // constrain(true)：留在画面里
    if (x + bw > cw) x = Math.max(0, cw - bw); if (y + bh > ch) y = Math.max(0, ch - bh);
    ctx.fillStyle = 'rgba(32,34,38,0.94)'; ctx.strokeStyle = '#4a4f57'; ctx.lineWidth = 1;
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, 3 * dpr); else ctx.rect(x, y, bw, bh); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 2; i++){
      ctx.fillStyle = '#9aa0a8'; ctx.textAlign = 'left'; ctx.fillText(labels[i], x + padX, y + padY + i * row);
      ctx.fillStyle = '#e8eaed'; ctx.textAlign = 'right'; ctx.fillText(values[i], x + bw - padX, y + padY + i * row);
    }
    ctx.restore();
  },
  draw(ctx, s){
    const dpr = s / this.zoom();
    const sc = p => [Math.round(p[0] * s) + 0.5, Math.round(p[1] * s) + 0.5];
    // 现有选区不是满格矩形 ⇒ 画真正的边界（outline.rs；满格矩形 ui.js 已经画了）
    const sel = Doc.sel;
    if (sel && sel.mask){
      ctx.save(); ctx.lineWidth = 1;
      const segs = SelMask.outline(sel);
      ctx.beginPath(); segs.forEach(([a, b]) => { const A = sc(a), B = sc(b); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); });
      ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([DASH * dpr, DASH * dpr]); ctx.strokeStyle = '#000'; ctx.stroke();
      ctx.restore();
    }
    const d = this.drag;
    if (d && d.moved){
      const [a, b] = this.corners();
      const A = sc(a), B = sc(b);
      const r = [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[0], B[0]), Math.max(A[1], B[1])];
      const pts = this.opt.shape === 'ellipse' ? this.ellipsePoints(r) : [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
      this.ants(ctx, pts, true, dpr);
      const last = this.last();
      this.drawReadout(ctx, [last[0] * s, last[1] * s], this.readout(), dpr);
    }
    if (this.hover) this.drawBadge(ctx, [this.hover[0] * s, this.hover[1] * s], this.badge(), dpr);
  },
  redrawHover(){
    if (ToolState.cur !== 'marquee' || !window.UI) return;
    const show = this.badge() !== 'replace';
    if (show || this._badgeShown || this.drag) UI.draw();
    this._badgeShown = show;
  }
};

/* ── 选项（marquee.options：界面的每个控件都只是叫这条） ── */
CMD.reg('marquee.options', {i18n:'',
  params:'{shape?="rect"|"ellipse", mode?=0..3 或 "replace|add|subtract|intersect"（选项栏的新选区／增加／减去／交集）, feather?=0..1000 px, antiAlias?=bool（只对椭圆有效）, style?="normal"|"fixedRatio"|"fixedSize"（换样式会把宽高重设成 64×64 或 1×1）, width?, height?（固定比例 0.001..999；固定大小 1..300000 px）, swap?=true 对调宽高} → 目前全部选项'},
  p => {
    const o = MQ.opt;
    if (p.shape === 'rect' || p.shape === 'ellipse') o.shape = p.shape;
    if (p.mode !== undefined){ const i = typeof p.mode === 'string' ? MODES.indexOf(p.mode) : (p.mode | 0); if (i >= 0 && i <= 3) o.mode = i; }
    if (p.feather !== undefined && isFinite(+p.feather)) o.feather = Math.min(1000, Math.max(0, +p.feather));
    if (typeof p.antiAlias === 'boolean') o.antiAlias = p.antiAlias;
    if (['normal', 'fixedRatio', 'fixedSize'].includes(p.style) && p.style !== o.style){
      o.style = p.style;                                                     // panels.rs:568-570
      [o.width, o.height] = o.style === 'fixedSize' ? [64, 64] : [1, 1];
    }
    const [lo, hi] = o.style === 'fixedSize' ? [1, 300000] : [0.001, 999];   // panels.rs:572
    if (p.width !== undefined && isFinite(+p.width)) o.width = Math.min(hi, Math.max(lo, +p.width));
    if (p.height !== undefined && isFinite(+p.height)) o.height = Math.min(hi, Math.max(lo, +p.height));
    if (p.swap) [o.width, o.height] = [o.height, o.width];                    // panels.rs:576-578
    if (window.UI && ToolState.cur === 'marquee') UI.buildOptions('marquee');
    return Object.assign({}, o);
  });

/* ── agent 送滑鼠事件（同 PhotoCraft 的 ui.pointer／hold_keys 测试 agents_reposition_a_marquee_with_space）──
   跟人拿滑鼠走的是同一个 gestureDown/Move/Up，所以修饰键、Space 重新定位、吸附、样式全部一样 */
CMD.reg('marquee.pointer', {i18n:'',
  params:'{events:[{kind:"down"|"move"|"up", x, y 文件坐标, shift?, alt?, ctrl?（拖的途中按着＝不吸附）, space?（拖的途中按着＝整个选框跟着走）}…], snap?=true} 一串指针事件跑一次选框手势；down 时的 shift/alt 决定增加／减去／交集，拖的途中新按下的 shift＝正方／正圆、alt＝从中心；down 后没有 move 就 up＝点一下＝取消选择 → {selection}'},
  p => {
    const evs = Array.isArray(p.events) ? p.events : [];
    const MT = window.MoveTool, saved = MT && MT.opt ? MT.opt.snap : undefined;
    if (p.snap === false && saved !== undefined) MT.opt.snap = false;
    try {
      for (const e of evs){
        const pt = [Number(e.x) || 0, Number(e.y) || 0];
        const m = {shift:!!e.shift, alt:!!e.alt, ctrl:!!e.ctrl, space:!!e.space};
        if (e.kind === 'down') MQ.gestureDown(pt, m);
        else if (e.kind === 'move' && MQ.drag){ MQ.drag.moved = true; MQ.gestureMove(pt, m); }
        else if (e.kind === 'up' && MQ.drag) MQ.gestureUp(pt, m);
      }
    } finally { if (saved !== undefined) MT.opt.snap = saved; }
    if (window.UI) UI.draw();
    return {ok:true, selection:Doc.sel};
  });

/* ── 键盘：修饰键、Space（重新定位）、M（轮换矩形／椭圆） ── */
const typing = el => !!el && (el.isContentEditable || /^(input|select|textarea)$/i.test(el.tagName));
window.addEventListener('keydown', e => {
  if (typing(e.target)) return;
  if (e.key === 'Shift' || e.key === 'Alt'){
    MQ.held = {shift:e.shiftKey, alt:e.altKey};
    if (ToolState.cur !== 'marquee') return;
    if (e.key === 'Alt') e.preventDefault();                 // 别让浏览器把焦点交给选单列
    if (MQ.drag && MQ.drag.moved){ MQ.track({shift:e.shiftKey, alt:e.altKey}); UI.draw(); }  // 没移动也照样跟着改（canvas.rs:1513-1520）
    else MQ.redrawHover();
    return;
  }
  if (e.code === 'Space' || e.key === ' '){
    MQ.space = true;
    if (MQ.drag && ToolState.cur === 'marquee') MQ.drag.reposition = true;   // hold_keys.rs：拖着时 Space＝重新定位
    return;
  }
  // shortcuts.rs:294-305：从别的工具按 M ⇒ 这一组的第一颗（矩形）
  if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey && ToolState.cur !== 'marquee') MQ.opt.shape = 'rect';
}, true);
window.addEventListener('keyup', e => {
  if (e.key === 'Shift' || e.key === 'Alt'){
    MQ.held = {shift:e.shiftKey, alt:e.altKey};
    if (ToolState.cur !== 'marquee') return;
    if (MQ.drag && MQ.drag.moved){ MQ.track({shift:e.shiftKey, alt:e.altKey}); UI.draw(); }
    else MQ.redrawHover();
    return;
  }
  if (e.code === 'Space' || e.key === ' '){
    MQ.space = false;
    if (MQ.drag) MQ.drag.reposition = false;               // 放开 Space ⇒ 回到拉大小
  }
}, true);
window.addEventListener('blur', () => { MQ.held = {shift:false, alt:false}; MQ.space = false; });

/* ── 三语 ── */
const STRINGS = {
  'zh-Hant':{'opt.marqueeShape':'形狀', 'ui.marqueeRect':'矩形選取', 'ui.marqueeEllipse':'橢圓選取',
    'ui.selNew':'新增選取範圍', 'ui.selAdd':'增加至選取範圍  (Shift)', 'ui.selSub':'從選取範圍中減去  (Alt)', 'ui.selInt':'與選取範圍相交  (Shift+Alt)',
    'opt.feather':'羽化', 'opt.antiAlias':'消除鋸齒', 'opt.marqueeStyle':'樣式', 'ui.styleNormal':'正常', 'ui.styleRatio':'固定比例', 'ui.styleSize':'固定尺寸',
    'opt.width':'寬度', 'opt.height':'高度', 'ui.swapWH':'對調高度和寬度',
    'ui.marqueeHint':'拖曳以選取 · Shift 增加 · Alt 減去 · Shift+Alt 相交 · 按一下取消選取 · 拖曳中 Shift 正方／正圓、Alt 從中心、Space 移動選框、Ctrl 暫停吸附 · M 切換矩形／橢圓'},
  'zh-Hans':{'opt.marqueeShape':'形状', 'ui.marqueeRect':'矩形选框', 'ui.marqueeEllipse':'椭圆选框',
    'ui.selNew':'新选区', 'ui.selAdd':'添加到选区  (Shift)', 'ui.selSub':'从选区减去  (Alt)', 'ui.selInt':'与选区交叉  (Shift+Alt)',
    'opt.feather':'羽化', 'opt.antiAlias':'消除锯齿', 'opt.marqueeStyle':'样式', 'ui.styleNormal':'正常', 'ui.styleRatio':'固定比例', 'ui.styleSize':'固定大小',
    'opt.width':'宽度', 'opt.height':'高度', 'ui.swapWH':'高度和宽度互换',
    'ui.marqueeHint':'拖动以选择 · Shift 添加 · Alt 减去 · Shift+Alt 交叉 · 单击取消选择 · 拖动中 Shift 正方／正圆、Alt 从中心、Space 移动选框、Ctrl 暂停吸附 · M 切换矩形／椭圆'},
  'en':{'opt.marqueeShape':'Shape', 'ui.marqueeRect':'Rectangular Marquee', 'ui.marqueeEllipse':'Elliptical Marquee',
    'ui.selNew':'New selection', 'ui.selAdd':'Add to selection  (Shift)', 'ui.selSub':'Subtract from selection  (Alt)', 'ui.selInt':'Intersect with selection  (Shift+Alt)',
    'opt.feather':'Feather', 'opt.antiAlias':'Anti-alias', 'opt.marqueeStyle':'Style', 'ui.styleNormal':'Normal', 'ui.styleRatio':'Fixed Ratio', 'ui.styleSize':'Fixed Size',
    'opt.width':'Width', 'opt.height':'Height', 'ui.swapWH':'Swaps height and width',
    'ui.marqueeHint':'Drag to select  ·  Shift add  ·  Alt subtract  ·  Shift+Alt intersect  ·  click to deselect  ·  while dragging: Shift square/circle, Alt from centre, Space moves it, Ctrl no snapping  ·  M switches rectangle/ellipse'}
};
if (typeof Lang !== 'undefined') Lang.add(STRINGS);

Tools.reg({
  id:'marquee', icon:'▭', key:'M', group:'select', order:20, for:'common', opts:[],
  strings:STRINGS,

  onDown(e, pt){
    if (e.button !== undefined && e.button !== 0){ MQ.drag = null; return; }    // 工具只跟左键（canvas.rs:1462）
    MQ.hover = pt; MQ.held = {shift:e.shiftKey, alt:e.altKey};
    MQ.gestureDown(pt, {shift:e.shiftKey, alt:e.altKey, space:MQ.space, client:[e.clientX, e.clientY]});
  },
  onMove(e, pt, P){
    MQ.hover = pt; MQ.held = {shift:e.shiftKey, alt:e.altKey};
    const d = MQ.drag;
    if (!P.down || !d){ MQ.redrawHover(); return; }
    // egui：移动超过点击距离（或按太久）才认定是拖；之前的移动不送给工具
    if (!d.moved){
      const c = d.client0, far = c ? Math.hypot(e.clientX - c[0], e.clientY - c[1]) > CLICK_DIST : true;
      if (!far && performance.now() - d.t0 <= CLICK_TIME) return;
      d.moved = true;
    }
    MQ.gestureMove(pt, {shift:e.shiftKey, alt:e.altKey, ctrl:e.ctrlKey && !e.metaKey, space:MQ.space});
    UI.draw();
  },
  onUp(e, pt){
    const d = MQ.drag;
    if (d && !d.moved && performance.now() - d.t0 > CLICK_TIME) d.moved = true;
    MQ.gestureUp(pt, {shift:e.shiftKey, alt:e.altKey, ctrl:e.ctrlKey && !e.metaKey, space:MQ.space});
    UI.draw();
  },
  onKey(e){
    // shortcuts.rs:294-305：已经是选框时按 M（Shift 不管）⇒ 矩形／椭圆轮换
    if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey){
      CMD.run('marquee.options', {shape: MQ.opt.shape === 'rect' ? 'ellipse' : 'rect'});
      UI.draw(); return true;
    }
    return false;
  },
  onDeactivate(){ MQ.drag = null; MQ.snap = null; MQ.hover = null; },
  drawOverlay(ctx, s){ MQ.draw(ctx, s); },

  /* panels.rs:536-586 选项栏 ＋ 753-761 提示 */
  buildOptions(box, add, mk){
    const o = MQ.opt;
    const set = p => { CMD.run('marquee.options', p); UI.draw(); };
    const btn = (txt, tipKey, on, fn, data) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = txt; b.title = Lang.t(tipKey);
      b.style.cssText = `margin:0 1px;min-width:24px;cursor:pointer;${on ? 'background:#2f7fd8;color:#fff;' : ''}`;
      Object.assign(b.dataset, data || {}); b.onclick = fn; box.appendChild(b); return b;
    };
    const sep = () => { const v = document.createElement('span'); v.style.cssText = 'display:inline-block;width:1px;height:18px;background:#555;margin:0 6px;vertical-align:middle'; box.appendChild(v); };
    // 形状（我们一颗按钮代原码两颗工具）
    btn('▭', 'ui.marqueeRect', o.shape === 'rect', () => set({shape:'rect'}), {shape:'rect'});
    btn('◯', 'ui.marqueeEllipse', o.shape === 'ellipse', () => set({shape:'ellipse'}), {shape:'ellipse'});
    sep();
    // 四个模式钮
    [['□', 'ui.selNew'], ['＋', 'ui.selAdd'], ['−', 'ui.selSub'], ['⧉', 'ui.selInt']].forEach(([t, k], i) =>
      btn(t, k, o.mode === i, () => set({mode:i}), {mode:MODES[i]}));
    sep();
    const fe = mk('number', {min:0, max:1000, step:1, value:o.feather}); fe.style.width = '56px'; fe.dataset.opt = 'feather';
    fe.onchange = () => set({feather:+fe.value}); add('feather', fe);
    const aa = mk('checkbox', {checked:o.antiAlias}); aa.dataset.opt = 'antiAlias';
    aa.disabled = o.shape !== 'ellipse';                     // PS 的矩形选框把消除锯齿灰掉（边永远是硬的）
    aa.onchange = () => set({antiAlias:aa.checked}); add('antiAlias', aa);
    sep();
    const st = document.createElement('select'); st.dataset.opt = 'style';
    st.innerHTML = [['normal', 'ui.styleNormal'], ['fixedRatio', 'ui.styleRatio'], ['fixedSize', 'ui.styleSize']]
      .map(([v, k]) => `<option value="${v}"${o.style === v ? ' selected' : ''}>${Lang.t(k)}</option>`).join('');
    st.onchange = () => set({style:st.value}); add('marqueeStyle', st);
    const fixed = o.style !== 'normal';
    const num = (key, v) => {
      const n = mk('number', {value:v, step:o.style === 'fixedSize' ? 1 : 0.001}); n.style.width = '64px'; n.dataset.opt = key; n.disabled = !fixed;
      n.onchange = () => set({[key]:+n.value}); return n;
    };
    add('width', num('width', o.width));
    const sw = btn('⇄', 'ui.swapWH', false, () => set({swap:true}), {opt:'swap'}); sw.disabled = !fixed;
    add('height', num('height', o.height));
    const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t('ui.marqueeHint'); box.appendChild(h);
  }
});

})();
