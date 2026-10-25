/* 星形（S）——逐段照 ArtCraft／VectorCraft 原码翻译：
     vectorcraft/crates/tools/src/shape.rs          ShapeTool（star 那几支分岔）
     vectorcraft/crates/geom/src/shapes.rs          star()：顶点几何（我们 engine.js 的 drawShape 已是同一套公式）
     vectorcraft/crates/engine/src/cmd/create.rs    shape.star 命令：参数名、预设值、夹限
     vectorcraft/crates/ui-egui/src/dialogs/tools.rs、dialogs/shapes.rs、dialogs/form.rs   点一下开的尺寸对话框
     vectorcraft/crates/tools/src/settings.rs       「角数」是要记住的工具选项
     vectorcraft/crates/tools/src/lib.rs            tol()／size_label()／Overlay::Measure
   行为：
     按下＝定中心；拖＝外半径＝拖的距离，第一个尖角指向游标；Shift＝尖角朝正上（rotation 0）；
     Alt 对星形无作用（原码只有矩形／椭圆／线段看 Alt）；
     拖时 ↑／↓＝角数 ±1（3…1000，并记进工具选项）；拖时 Esc＝整个取消；
     拖不到 2 个萤幕像素就放开＝当成「点一下」⇒ 开尺寸对话框（半径 1＝50、半径 2＝25、角数＝5），按确定才画。
   改文件只走 CMD：star.drag（拖）／star.create（对话框与 agent）／star.setOption（选项）。 */
const Star = {
  // ── 工具选项（shape.rs:18-22 ShapeTool.points / star_ratio；预设 5 与 0.5，shape.rs:43-45） ──
  points: 5,
  starRatio: 0.5,
  // ── 一次拖曳的状态（shape.rs:14-17 start / last / mods / began） ──
  start: null, last: null, mods: {shift:false, alt:false}, began: false,
  preview: null,           // 当前预览＝原码 Action::Preview 的那条命令参数
  _optInput: null,

  /* settings.rs:35 (&["star"], None, &["points"])：角数随偏好存起来，换工具／重开都还在 */
  load(){
    try { const v = localStorage.getItem('dilin.star.points'); if (v !== null) this.setOption('points', +v); } catch(e){}
  },
  save(){ try { localStorage.setItem('dilin.star.points', String(this.points)); } catch(e){} },

  /* shape.rs:211-218 set_option：points → as_u64().unwrap_or(5).clamp(3,1000)；starRatio → as_f64().unwrap_or(0.5).clamp(0.01,1) */
  setOption(key, v){
    if (key === 'points'){
      const n = (typeof v === 'number' && Number.isInteger(v) && v >= 0) ? v : 5;
      this.points = Math.min(1000, Math.max(3, n));
      this.save(); this.syncOpt();
    } else if (key === 'starRatio'){
      const f = (typeof v === 'number' && isFinite(v)) ? v : 0.5;
      this.starRatio = Math.min(1, Math.max(0.01, f));
    }
  },
  options(){ return {points:this.points, starRatio:this.starRatio}; },   // shape.rs:208-210
  syncOpt(){ if (this._optInput && document.activeElement !== this._optInput) this._optInput.value = this.points; },

  /* shape.rs:62-76 command()：polygon|star 分岔
       v = p - start；r = |v| 至少 0.01；rot = Shift ? 0 : (atan2(v)° + 90) % 360
       ⇒ shape.star {cx, cy, radius1:r, radius2:r*star_ratio, points, rotation:rot}
     （Rust 的 % 与 JS 的 % 一样是截断取余，负角保持负号，照搬） */
  command(start, p, m, over){
    const o = over || {};
    const vx = p[0] - start[0], vy = p[1] - start[1];
    const r = Math.max(Math.hypot(vx, vy), 0.01);
    const rot = m.shift ? 0 : (Math.atan2(vy, vx) * 180 / Math.PI + 90) % 360;
    const ratio = (o.starRatio !== undefined) ? o.starRatio : this.starRatio;
    const pts   = (o.points    !== undefined) ? o.points    : this.points;
    return {cx:start[0], cy:start[1], radius1:r, radius2:r*ratio, points:pts, rotation:rot};
  },

  /* create.rs:189-196 star()：
       cx, cy, radius1 必填（f64_req）；radius1 取绝对值；radius2 缺省＝radius1/2，取绝对值；
       points as_u64().unwrap_or(5).clamp(2,1000)；rotation 缺省 0；
       用当前的填色／描边／描边宽（add_art 的 s.paint）落成一个新物件。
     我们这边几何交给 engine 的 shape.star（drawShape 与 shapes.rs:73-84 同公式），这里只做参数翻译。 */
  create(p){
    const num = k => (typeof p[k] === 'number' && isFinite(p[k])) ? p[k] : undefined;
    const cx = num('cx'), cy = num('cy'), r1v = num('radius1');
    if (cx === undefined || cy === undefined || r1v === undefined)
      return {ok:false, error:'star: cx, cy, radius1 are required numbers'};
    const r1 = Math.abs(r1v);
    const r2 = Math.abs(num('radius2') !== undefined ? num('radius2') : r1 / 2);
    const pv = p.points;
    const n = Math.min(1000, Math.max(2, (typeof pv === 'number' && Number.isInteger(pv) && pv >= 0) ? pv : 5));
    const rot = num('rotation') !== undefined ? num('rotation') : 0;
    const args = {cx, cy, r1, r2, points:n, rotation:rot,
                  fill:        p.fill        !== undefined ? p.fill        : UI.fill(),
                  stroke:      p.stroke      !== undefined ? p.stroke      : UI.stroke(),
                  strokeWidth: p.strokeWidth !== undefined ? p.strokeWidth : UI.strokeW()};
    if (p.layerId) args.layerId = p.layerId;
    // 内径＝外径（工具列「多边形工具」＝星形 starRatio 1）⇒ 正 n 边形（AI 多边形工具：边数＝角数，↑↓ 增减边；不是 2n 个点的星形）
    const poly = Math.abs(r2 - r1) <= 1e-9 * Math.max(1, r1) && CMD.map['shape.polygon'];
    if (poly){ delete args.r2; args.points = Math.max(3, n); }
    const res = CMD.map[poly ? 'shape.polygon' : 'shape.star'].run(args);       // 直接叫，历史已由外层 star.* 推过一次
    // create.rs add_look ⇒ sel.set([id])：新画的形状被选取（AI 一样；画完可直接换色）——同 ellipse.js
    if (res && res.id && res.layerId && window.VecSel && Doc.byId(res.layerId) && Doc.byId(res.layerId).kind === 'vector') VecSel.setShapes(res.layerId, [res.id]);
    return res;
  },

  /* ── 滑鼠：shape.rs:113-153 pointer() ── */
  down(e, pt){
    // Down：start = snap_draw(pos)（我们没有智慧参考线／格点吸附，原样用）；last = pos；began = false
    this.start = [pt[0], pt[1]]; this.last = [pt[0], pt[1]]; this.began = false; this.preview = null;
  },
  move(e, pt){
    if (!this.start) return false;
    this.last = [pt[0], pt[1]];
    this.mods = {shift:!!e.shiftKey, alt:!!e.altKey};
    if (!this.began){
      // 还没离开按下点 2 个萤幕像素（cx.tol(2.0) = 2/zoom）就不算开始画
      if (Math.hypot(pt[0]-this.start[0], pt[1]-this.start[1]) < 2 / UI.zoom) return false;
      this.began = true;                           // Action::Begin("Star")
    }
    this.preview = this.command(this.start, this.last, this.mods);   // Action::Preview
    return true;
  },
  up(){
    const s = this.start; if (!s) return;          // Esc 取消过就什么都不做
    this.start = null;
    if (this.began){
      this.began = false; this.preview = null;
      // Action::Commit：留下最后一次预览＝用最后的滑鼠点与修饰键再算一次，走命令落地（一步可退）
      CMD.run('star.drag', {x0:s[0], y0:s[1], x1:this.last[0], y1:this.last[1], shift:this.mods.shift});
    } else {
      this.preview = null;
      this.openDialog(s[0], s[1]);                 // Action::Dialog("star", {x, y})
    }
  },
  /* shape.rs:154-193 key()：只在 began 时有反应 */
  key(e){
    if (!this.start || !this.began) return false;
    const k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowDown'){
      e.preventDefault();
      this.setOption('points', k === 'ArrowUp' ? Math.min(this.points + 1, 1000) : Math.max(this.points - 1, 3));
      this.preview = this.command(this.start, this.last, this.mods);
      return true;
    }
    if (k === 'Escape'){
      this.start = null; this.began = false; this.preview = null;   // Action::Cancel
      return true;
    }
    return false;
  },
  cancel(){ this.start = null; this.began = false; this.preview = null; },

  /* ── 点一下开的尺寸对话框：dialogs/tools.rs:17 预设值、dialogs/shapes.rs:28-31 确定时的命令、form.rs:124-139 栏位 ── */
  openDialog(x, y){
    this.closeDialog();
    const T = k => Lang.t(k);
    const bg = document.createElement('div');
    bg.id = 'starDialog';
    bg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999';
    const box = document.createElement('div');
    box.style.cssText = 'background:#2b2f36;color:#e6e8eb;padding:14px 18px;border-radius:6px;min-width:230px;font:13px sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)';
    const h = document.createElement('div');
    h.textContent = T('tool.star'); h.style.cssText = 'font-weight:bold;margin-bottom:10px';
    box.appendChild(h);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:auto 110px;gap:8px 10px;align-items:center';
    const F = {};
    // x、y 不显示（form.rs:129）；radius1／radius2 是长度栏，points 是一般数字栏
    [['radius1','ui.starR1',50], ['radius2','ui.starR2',25], ['points','opt.points',5]].forEach(([k, lab, v]) => {
      const l = document.createElement('span'); l.textContent = T(lab); l.style.color = '#aab0ba';
      const inp = document.createElement('input'); inp.type = 'number'; inp.value = v; inp.name = k;
      inp.style.cssText = 'width:100%;box-sizing:border-box;background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:3px 6px';
      grid.appendChild(l); grid.appendChild(inp); F[k] = inp;
    });
    box.appendChild(grid);
    const row = document.createElement('div'); row.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px';
    const bOk = document.createElement('button'); bOk.textContent = T('ui.starOk'); bOk.dataset.act = 'ok';
    const bNo = document.createElement('button'); bNo.textContent = T('ui.starCancel'); bNo.dataset.act = 'cancel';
    row.appendChild(bNo); row.appendChild(bOk); box.appendChild(row);
    bg.appendChild(box); document.body.appendChild(bg);

    // d.f64(key, 预设)：读不出数字就用预设
    const f64 = (k, d) => { const v = parseFloat(F[k].value); return isFinite(v) ? v : d; };
    const ok = () => {
      const pts = Math.max(0, Math.trunc(f64('points', 5)));     // `as u64`：负数饱和成 0，再由命令夹到 2
      this.closeDialog();
      CMD.run('star.create', {cx:x, cy:y, radius1:f64('radius1', 50), radius2:f64('radius2', 25), points:pts});
    };
    const no = () => { this.closeDialog(); UI.draw(); };
    bOk.onclick = ok; bNo.onclick = no;
    bg.addEventListener('pointerdown', e => { if (e.target === bg) no(); });
    bg.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter'){ e.preventDefault(); ok(); }
      else if (e.key === 'Escape'){ e.preventDefault(); no(); }
    });
    F.radius1.focus(); F.radius1.select();
  },
  closeDialog(){ const d = document.getElementById('starDialog'); if (d) d.remove(); },
  dialogOpen(){ return !!document.getElementById('starDialog'); }
};
window.Star = Star;
Star.load();

/* ── 命令（agent 与滑鼠同一条路） ── */
CMD.reg('star.create', {i18n:'', undoable:true,
  params:'{cx, cy, radius1, radius2?=radius1/2, points=5 (2..1000), rotation=0 (度，0＝第一个尖角朝上), fill?, stroke?, strokeWidth?, layerId?} 文件坐标。'
       + '照 VectorCraft shape.star；radius 取绝对值；缺 fill/stroke/strokeWidth 用当前颜色。＝点一下星形工具后对话框按确定 → {id, layerId}'},
  p => Star.create(p || {}));
CMD.reg('star.drag', {i18n:'', undoable:true,
  params:'{x0, y0 按下点＝中心, x1, y1 放开点, shift=false (尖角朝正上), points?=工具选项, starRatio?=工具选项 (内径/外径), fill?, stroke?, strokeWidth?, layerId?} 文件坐标。'
       + '＝用星形工具从 (x0,y0) 拖到 (x1,y1)：外径＝拖的距离，第一个尖角指向 (x1,y1)；Alt 对星形无作用 → {id, layerId}'},
  p => {
    p = p || {};
    if (![p.x0, p.y0, p.x1, p.y1].every(v => typeof v === 'number' && isFinite(v))) return {ok:false, error:'star.drag: x0,y0,x1,y1 are required numbers'};
    const over = {};
    if (p.points !== undefined){ const n = (Number.isInteger(p.points) && p.points >= 0) ? p.points : 5; over.points = Math.min(1000, Math.max(3, n)); }
    if (p.starRatio !== undefined){ const f = isFinite(p.starRatio) ? +p.starRatio : 0.5; over.starRatio = Math.min(1, Math.max(0.01, f)); }
    const c = Star.command([p.x0, p.y0], [p.x1, p.y1], {shift:!!p.shift}, over);
    ['fill','stroke','strokeWidth','layerId'].forEach(k => { if (p[k] !== undefined) c[k] = p[k]; });
    return Star.create(c);
  });
CMD.reg('star.setOption', {i18n:'',
  params:'{points? 3..1000 整数（不合法回 5）, starRatio? 0.01..1 内径/外径（不合法回 0.5）} 星形工具选项；不给参数＝只读 → {points, starRatio}'},
  p => {
    p = p || {};
    if (p.points !== undefined) Star.setOption('points', p.points);
    if (p.starRatio !== undefined) Star.setOption('starRatio', p.starRatio);
    return Star.options();
  });

const STAR_STRINGS = {
  'zh-Hant':{
    'ui.starHint':'拖＝從中心畫（尖角朝游標）· Shift 尖角朝上 · 拖時 ↑↓ 增減角數、Esc 取消 · 點一下＝輸入精確尺寸',
    'ui.starR1':'半徑 1', 'ui.starR2':'半徑 2', 'ui.starOk':'確定', 'ui.starCancel':'取消', 'ui.starW':'寬', 'ui.starH':'高'
  },
  'zh-Hans':{
    'ui.starHint':'拖＝从中心画（尖角朝光标）· Shift 尖角朝上 · 拖时 ↑↓ 增减角数、Esc 取消 · 点一下＝输入精确尺寸',
    'ui.starR1':'半径 1', 'ui.starR2':'半径 2', 'ui.starOk':'确定', 'ui.starCancel':'取消', 'ui.starW':'宽', 'ui.starH':'高'
  },
  'en':{
    'ui.starHint':'Drag to draw from the center (tip follows the cursor) · Shift: tip up · while dragging ↑↓ change points, Esc cancels · Click for exact size',
    'ui.starR1':'Radius 1', 'ui.starR2':'Radius 2', 'ui.starOk':'OK', 'ui.starCancel':'Cancel', 'ui.starW':'W', 'ui.starH':'H'
  }
};
// _registry.js 用 window.Lang 判断，但 i18n.js 的 Lang 是 const、不挂 window ⇒ 登记时字串并不进字典；这里自己并一次
if (typeof Lang !== 'undefined') Lang.add(STAR_STRINGS);

Tools.reg({
  id:'star', icon:'★', key:'S', group:'vector', order:40, for:'vector', needs:'vector', opts:[],
  hint:'ui.starHint',
  strings: STAR_STRINGS,
  onDown(e, pt){ Star.down(e, pt); },
  onMove(e, pt, P){ if (!P.down) return; if (Star.move(e, pt)) UI.draw(); },
  onUp(){ Star.up(); UI.draw(); },
  onKey(e){ const r = Star.key(e); if (r) UI.draw(); return r; },
  onDeactivate(){ Star.cancel(); },
  /* 选项栏：角数（settings.rs 记住的那一项）；改值也是走 star.setOption */
  buildOptions(box, add, mk){
    const n = mk('number', {min:3, max:1000, step:1, value:Star.points});
    n.oninput = () => { const v = +n.value; if (Number.isInteger(v) && v >= 3) CMD.run('star.setOption', {points:v}); };
    n.onchange = () => { CMD.run('star.setOption', {points:+n.value}); n.value = Star.points; };
    Star._optInput = n;
    add('points', n);
  },
  /* 预览＝原码 Preview：把这条命令画出来（用真的填色描边）；外加 Overlay::Measure 量尺寸小框（lib.rs:269、shape.rs:194-204） */
  drawOverlay(ctx, s){
    const p = Star.preview;
    if (!p || !Star.began || !Star.start) return;
    const n = Math.min(1000, Math.max(2, p.points));
    const poly = Math.abs(Math.abs(p.radius2) - Math.abs(p.radius1)) <= 1e-9 * Math.max(1, Math.abs(p.radius1));   // 多边形：预览跟放开后一样是 n 边形
    drawShape(ctx, {type:poly ? 'polygon' : 'star', cx:p.cx, cy:p.cy, r1:Math.abs(p.radius1), r2:Math.abs(p.radius2), points:poly ? Math.max(3, n) : n, rotation:p.rotation,
                    fill:UI.fill(), stroke:UI.stroke(), strokeWidth:UI.strokeW()}, s);
    // 量尺寸：W＝|dx|、H＝|dy|（size_label → "W: 12.00 pt\nH: …"；我们单位是 px）；画在游标右下 14px（canvas.rs:1188-1194）
    const dpr = s / UI.zoom;
    const dx = Math.abs(Star.last[0] - Star.start[0]), dy = Math.abs(Star.last[1] - Star.start[1]);
    const lines = [`${Lang.t('ui.starW')}: ${dx.toFixed(2)} px`, `${Lang.t('ui.starH')}: ${dy.toFixed(2)} px`];
    ctx.save();
    ctx.font = `${11*dpr}px sans-serif`; ctx.textBaseline = 'top';
    const tw = Math.max(...lines.map(t => ctx.measureText(t).width));
    const x = Star.last[0]*s + 14*dpr, y = Star.last[1]*s + 14*dpr;
    const w = tw + 12*dpr, h = lines.length*13*dpr + 8*dpr;
    ctx.fillStyle = 'rgba(64,64,64,0.92)';
    if (ctx.roundRect){ ctx.beginPath(); ctx.roundRect(x, y, w, h, 3*dpr); ctx.fill(); } else ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#fff';
    lines.forEach((t, i) => ctx.fillText(t, x + 6*dpr, y + 4*dpr + i*13*dpr));
    ctx.restore();
  }
});
