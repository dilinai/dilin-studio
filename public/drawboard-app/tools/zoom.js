/* 缩放（Z）—— 逐段翻译自 ArtCraft PhotoCraft 原始码（Rust → JS），不是照 PS 印象写：
   ① photocraft/crates/ui-egui/src/zoom_tool.rs（224 行）
        :15-19   MIN_ZOOM 0.01 / MAX_ZOOM 64 / DOUBLING 100（水平拖 100 点＝放大一倍或缩小一半）
        :37-43   scrub_zoom：zoom0 × 2^(dx/100)，指数夹 ±40，非有限 ⇒ 1；结果夹 [MIN,MAX]
        :45-51   anchor_view：设 zoom，并让文件点 doc 落在画面点 screen
        :55-79   drag：按下记 {anchor 按下点, doc 其下文件点, zoom0, rect_to}；
                 「细微缩放」开（预设）⇒ 拖曳中连续缩放、以按下点为锚；关 ⇒ 拖出矩形，放开才缩
        :83-93   zoom_to_rect：⌥ 或矩形任一边 < 4 点 ⇒ 在按下点踏一级（⌥ 踏出）；
                 否则 k＝min(画面宽/矩形宽, 画面高/矩形高)，zoom×k，矩形中心移到画面正中
        :96-102  draw：矩形模式拖曳中画行军蚁（四角取整再 +0.5）
   ② photocraft/crates/ui-egui/src/canvas.rs
        :313-336   ViewXform（to_screen／to_doc）
        :338-344   fit_view：zoom＝min((区宽−40)/w, (区高−40)/h) 夹 [0.01,1]，中心＝文件正中
        :346-351   zoom_step：PS 的级距表（⌘+ / ⌘−）
        :1440-1445 缩放方向：暂时缩放键说了算，否则看 ⌥
        :1470-1473 缩放工具的拖曳先交给 zoom_tool::drag，吃掉后底下只剩「点一下」
        :1541-1544 点一下：zoom_step(±1) 绕点按处（zoom_about）
        :1661-1667 游标：⌥（或暂时缩小键）⇒ ZoomOut，否则 ZoomIn
        :1695-1701 zoom_about：放大前点按处下的文件点，放大后仍在点按处
   ③ photocraft/crates/ui-egui/src/hold_keys.rs（129 行）＋ engine/src/prefs.rs:1154-1158
        ⌘Space（非 Mac＝Ctrl+Space）按住＝暂时放大（拖曳＝细微缩放）；⌘⌥Space＝暂时缩小；
        较具体的组合优先；文字栏有键盘时不算；按下当下生效的暂时工具锁到放开为止（for_frame 的 latch）
   ④ photocraft/crates/ui-egui/src/panels.rs:770-789 选项栏：「细微缩放」勾选、提示字、「适合屏幕」「100%」两颗钮
   ⑤ photocraft/crates/ui-egui/src/control.rs:162-176 agent 的 ui.set {zoom, center, fit}
   egui 的点按／拖曳判定（egui InputOptions 预设）：离按下点 > 6 点、或按住 > 0.8 秒 ⇒ 是拖曳，不是点按。

   我们的视角模型：UI.zoom（ui.js）＋ HandView.off（hand.js，画布 CSS translate）；
   画面点＝client 座标；文件点↔画面点一律用画布的 getBoundingClientRect() 量，跟 ui.js 的 toDoc() 同一套。
   视角不是文件内容 ⇒ 不进历史（他们的测试 :187 也断言 history.past_len()==0）。 */

const ZOOM_MIN = 0.01, ZOOM_MAX = 64;          // zoom_tool.rs:16-17
const ZOOM_DOUBLING = 100;                       // zoom_tool.rs:19
const ZOOM_CLICK_DIST = 6, ZOOM_CLICK_MS = 800;  // egui max_click_dist／max_click_duration
// canvas.rs:348-349 PS 的缩放级距
const ZOOM_STEPS = [0.01, 0.02, 0.03, 0.05, 0.0667, 0.1, 0.125, 0.1667, 0.25, 0.333, 0.5, 0.6667, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0, 12.0, 16.0, 32.0];

const zoomClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* canvas.rs:347-351 zoom_step */
function zoomStep(z, dir){
  if (dir > 0){ const s = ZOOM_STEPS.find(s => s > z * 1.001); return s === undefined ? 32.0 : s; }
  const s = [...ZOOM_STEPS].reverse().find(s => s < z * 0.999); return s === undefined ? 0.01 : s;
}

/* zoom_tool.rs:38-43 scrub_zoom */
function scrubZoom(zoom0, dx){
  // ±40 倍增早已超出缩放范围，只是让次方保持有限
  const e = Number.isFinite(dx) ? zoomClamp(dx / ZOOM_DOUBLING, -40, 40) : 0;
  const z = zoom0 * Math.pow(2, e);
  return Number.isFinite(z) ? zoomClamp(z, ZOOM_MIN, ZOOM_MAX) : 1;
}

/* ── 视角换算（他们的 ViewXform）＋ 几个改视角的动作（给滑鼠与命令共用） ── */
const ZoomView = {
  canvas(){ return document.getElementById('view'); },
  wrap(){ return document.getElementById('canvasWrap'); },
  /* xf.rect：画布区（#canvasWrap）在画面上的框 */
  viewRect(){ return this.wrap().getBoundingClientRect(); },
  viewCenter(){ const r = this.viewRect(); return [r.left + r.width/2, r.top + r.height/2]; },
  /* canvas.rs:328-332 to_doc（画面点 → 文件点） */
  toDoc(p){
    const b = this.canvas().getBoundingClientRect(), z = UI.zoom;
    return [(p[0] - b.left) / z, (p[1] - b.top) / z];
  },
  /* canvas.rs:324-327 to_screen（文件点 → 画面点） */
  toScreen(d){
    const b = this.canvas().getBoundingClientRect(), z = UI.zoom;
    return [b.left + d[0] * z, b.top + d[1] * z];
  },
  /* zoom_tool.rs:46-51 anchor_view：设 zoom，并让文件点 doc 落在画面点 screen。
     UI.setZoom 自己还会再夹一次范围；夹完用「真的」zoom 量文件点现在在哪，再平移补齐 ⇒ 锚点照样钉住 */
  anchorView(screen, doc, zoom){
    UI.setZoom(zoomClamp(zoom, ZOOM_MIN, ZOOM_MAX));
    const s = this.toScreen(doc);
    HandView.panBy(screen[0] - s[0], screen[1] - s[1]);
  },
  /* canvas.rs:1695-1701 zoom_about：点按处下的文件点放大后仍在点按处 */
  zoomAbout(p, nz){ this.anchorView(p, this.toDoc(p), nz); },
  /* canvas.rs:1541-1544 点一下：踏一级（out ⇒ 踏出） */
  clickAt(p, out){ this.zoomAbout(p, zoomStep(UI.zoom, out ? -1 : 1)); },
  /* zoom_tool.rs:83-93 zoom_to_rect（r 为画面座标 {x0,y0,x1,y1}，anchor 为按下点） */
  zoomToRect(r, anchor, out){
    const w = Math.abs(r.x1 - r.x0), h = Math.abs(r.y1 - r.y0);
    if (out || w < 4 || h < 4){
      const doc = this.toDoc(anchor);
      this.anchorView(anchor, doc, zoomClamp(zoomStep(UI.zoom, out ? -1 : 1), ZOOM_MIN, ZOOM_MAX));
      return;
    }
    const vr = this.viewRect();
    const k = Math.min(vr.width / w, vr.height / h);
    const zoom = zoomClamp(UI.zoom * k, ZOOM_MIN, ZOOM_MAX);
    const c = this.toDoc([(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2]);
    this.anchorView(this.viewCenter(), c, zoom);
  },
  /* canvas.rs:338-344 fit_view（选项栏「适合屏幕」） */
  fit(){
    const w = this.wrap();
    const zoom = zoomClamp(Math.min((w.clientWidth - 40) / Doc.width, (w.clientHeight - 40) / Doc.height), 0.01, 1.0);
    UI.setZoom(zoom);
    HandView.reset();                                   // center = [w/2, h/2]
  },
  /* 视窗正中对着的文件点（他们的 view.center） */
  center(){ return this.toDoc(this.viewCenter()); },
  info(){ const c = this.center(); return {zoom:UI.zoom, center:[c[0], c[1]]}; }
};
window.ZoomView = ZoomView;
window.zoomStep = zoomStep;
window.scrubZoom = scrubZoom;

/* ── 行军蚁矩形（zoom_tool.rs:96-102 + tool_feedback.rs:109-149 ants）：
   白实线打底、黑虚线 4／4、相位 = 时间×10 mod 8 滚动。
   画在 #canvasWrap 上的一层 SVG（画面座标），矩形可以超出画布、换成暂时缩放时也看得到。 */
const ZoomAnts = {
  el: null, timer: null, rect: null,
  ensure(){
    if (this.el && this.el.isConnected) return this.el;
    const NS = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(NS, 'svg');
    s.id = 'zoomAnts';
    s.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5;overflow:visible;display:none';
    const w = document.createElementNS(NS, 'polygon'); w.setAttribute('fill', 'none'); w.setAttribute('stroke', '#fff'); w.setAttribute('stroke-width', '1');
    const b = document.createElementNS(NS, 'polygon'); b.setAttribute('fill', 'none'); b.setAttribute('stroke', '#000'); b.setAttribute('stroke-width', '1');
    b.setAttribute('stroke-dasharray', '4 4');
    s.appendChild(w); s.appendChild(b);
    ZoomView.wrap().appendChild(s);
    this.el = s; return s;
  },
  show(a, b){
    const s = this.ensure(), wr = ZoomView.viewRect();
    // zoom_tool.rs:99-100 Rect::from_two_pos，四角 round() 再 +0.5
    const x0 = Math.round(Math.min(a[0], b[0])) + 0.5, y0 = Math.round(Math.min(a[1], b[1])) + 0.5;
    const x1 = Math.round(Math.max(a[0], b[0])) + 0.5, y1 = Math.round(Math.max(a[1], b[1])) + 0.5;
    this.rect = {x0, y0, x1, y1};
    const pts = [[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y]) => `${x - wr.left},${y - wr.top}`).join(' ');
    for (const p of s.children) p.setAttribute('points', pts);
    s.style.display = '';
    if (!this.timer){
      const tick = () => {                                 // tool_feedback.rs:145-149 ants_phase（每 100ms 重画）
        const phase = ((performance.now() / 1000) * 10) % 8;
        if (this.el) this.el.children[1].setAttribute('stroke-dashoffset', String(phase));
      };
      tick(); this.timer = setInterval(tick, 100);
    }
  },
  hide(){
    if (this.el) this.el.style.display = 'none';
    this.rect = null;
    if (this.timer){ clearInterval(this.timer); this.timer = null; }
  }
};
window.ZoomAnts = ZoomAnts;

/* ── 一次缩放手势（zoom_tool.rs:21-31 ZoomDrag ＋ :55-79 drag ＋ canvas.rs:1536-1544 click） ── */
const ZoomGesture = {
  scrubby: true,          // state.rs:463 zoom_scrubby 预设开
  g: null,                // {anchor, doc, zoom0, rectTo, t0, dragging, forcedOut}

  /* b.started：记下按下点与其下的文件点。forcedOut：暂时缩放键锁定的方向（null ⇒ 看 ⌥） */
  down(p, forcedOut){
    this.g = {anchor:[p[0], p[1]], doc:ZoomView.toDoc(p), zoom0:UI.zoom,
              rectTo:this.scrubby ? null : [p[0], p[1]], t0:performance.now(), dragging:false,
              forcedOut:(forcedOut === undefined ? null : forcedOut)};
  },
  /* 离按下点 > 6 点、或按住 > 0.8 秒 ⇒ egui 认定为拖曳（之后就不会再算点按） */
  _isDrag(p){
    const g = this.g;
    return g.dragging || Math.hypot(p[0] - g.anchor[0], p[1] - g.anchor[1]) > ZOOM_CLICK_DIST || (performance.now() - g.t0) > ZOOM_CLICK_MS;
  },
  /* b.dragged：矩形模式只更新角点（不缩）；细微缩放 ⇒ zoom0×2^(dx/100)，锚在按下点 */
  move(p){
    const g = this.g; if (!g) return;
    if (!this._isDrag(p)) return;
    g.dragging = true;
    if (g.rectTo){ g.rectTo = [p[0], p[1]]; ZoomAnts.show(g.anchor, g.rectTo); }
    else ZoomView.anchorView(g.anchor, g.doc, scrubZoom(g.zoom0, p[0] - g.anchor[0]));
  },
  /* b.stopped（拖曳放开）或 clicked（点一下） */
  up(p, alt){
    const g = this.g; if (!g) return;
    if (this._isDrag(p)){
      this.move(p);                                       // stopped 那一帧也先套最后的位置（:65-71）
      this.g = null; ZoomAnts.hide();
      // :74-76 矩形模式：放开时的 ⌥ 决定踏出（只看 ⌥，不看暂时缩放键）
      if (g.rectTo) ZoomView.zoomToRect({x0:g.anchor[0], y0:g.anchor[1], x1:g.rectTo[0], y1:g.rectTo[1]}, g.anchor, alt);
      // 细微缩放放开：保持当下缩放（:186 测试）
      return;
    }
    this.g = null; ZoomAnts.hide();
    // canvas.rs:1541-1544：点一下踏一级；方向＝暂时缩放键，否则 ⌥（放开那一刻的修饰键）
    const out = (g.forcedOut !== null) ? g.forcedOut : !!alt;
    ZoomView.clickAt(p, out);
  },
  cancel(){ this.g = null; ZoomAnts.hide(); }
};
window.ZoomGesture = ZoomGesture;

/* ── 游标（canvas.rs:1661-1667）：缩小方向 ⇒ zoom-out，否则 zoom-in ── */
const ZoomCursor = {
  set(out){ const v = ZoomView.canvas(); if (v) v.style.cursor = out ? 'zoom-out' : 'zoom-in'; },
  /* 依目前按着的键刷新：暂时缩放键优先，否则缩放工具看 ⌥ */
  refresh(e){
    const t = ZoomTemp.held(e);
    if (t) return this.set(t === 'out');
    if (ToolState.cur === 'zoom' && !(window.HandTemp && (HandTemp.drag || HandTemp.space))) this.set(!!e.altKey);
  }
};

/* ── 暂时缩放：Ctrl/⌘+Space 放大、Ctrl/⌘+Alt+Space 缩小（hold_keys.rs、prefs.rs:1156-1157） ── */
const zoomTextFocused = el => !!el && (el.isContentEditable || /^textarea$/i.test(el.tagName) ||
  (/^input$/i.test(el.tagName) && /^(text|search|email|url|password|tel|number|)$/i.test(el.type || '')));
const ZoomTemp = {
  space: false,           // Space 按着（不在文字栏里）
  pid: null,              // 暂时缩放正在进行的那支指针（按下当下锁定到放开＝latch）
  shown: false,           // 游标现在是不是暂时缩放的样子
  /* hold_keys.rs:74-94 held_tool：⌘⌥Space（较具体）先于 ⌘Space；只按 Space 是抓手（归 hand.js） */
  held(e){
    if (!this.space || !(e.ctrlKey || e.metaKey)) return null;
    return e.altKey ? 'out' : 'in';
  },
  sync(e){
    const t = this.held(e);
    if (t){ ZoomCursor.set(t === 'out'); this.shown = true; }
    else if (this.shown && this.pid === null){
      this.shown = false;
      const v = ZoomView.canvas(); if (!v) return;
      if (this.space && window.HandTemp) v.style.cursor = 'grab';          // 放掉 Ctrl 只剩 Space ⇒ 抓手
      else if (ToolState.cur === 'zoom') ZoomCursor.set(!!e.altKey);
      else v.style.cursor = (Tools.current().cursor) || 'crosshair';
    } else if (ToolState.cur === 'zoom' && this.pid === null && !Pointer.down) ZoomCursor.refresh(e);
  }
};
window.ZoomTemp = ZoomTemp;

window.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.key === ' '){
    if (zoomTextFocused(e.target)) return;
    ZoomTemp.space = true;
  }
  if (e.code === 'Space' || e.key === ' ' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta') ZoomTemp.sync(e);
}, true);
window.addEventListener('keyup', e => {
  if (e.code === 'Space' || e.key === ' ') ZoomTemp.space = false;
  if (e.code === 'Space' || e.key === ' ' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta') ZoomTemp.sync(e);
}, true);
window.addEventListener('blur', () => { ZoomTemp.space = false; ZoomTemp.sync({}); });

// 按下：左键＋暂时缩放键 ⇒ 缩放手势，事件不交给底下那颗工具（canvas.rs:1432-1439、1470-1473）
window.addEventListener('pointerdown', e => {
  const v = ZoomView.canvas();
  if (!v || e.target !== v || e.button !== 0) return;
  const t = ZoomTemp.held(e); if (!t) return;
  if (Pointer.down || ZoomTemp.pid !== null || (window.HandTemp && HandTemp.drag)) return;   // 已有别的手势
  e.stopPropagation(); e.preventDefault();
  try { v.setPointerCapture(e.pointerId); } catch(_){}
  ZoomTemp.pid = e.pointerId;
  ZoomGesture.down([e.clientX, e.clientY], t === 'out');                 // 方向锁到放开（for_frame latch）
}, true);
window.addEventListener('pointermove', e => {
  if (ZoomTemp.pid === null || e.pointerId !== ZoomTemp.pid) return;
  e.stopPropagation();
  ZoomGesture.move([e.clientX, e.clientY]);
}, true);
const zoomTempEnd = e => {
  if (ZoomTemp.pid === null || e.pointerId !== ZoomTemp.pid) return;
  e.stopPropagation();
  ZoomTemp.pid = null;
  if (e.type === 'pointercancel') ZoomGesture.cancel();
  else ZoomGesture.up([e.clientX, e.clientY], e.altKey);
  ZoomTemp.sync(e);
};
window.addEventListener('pointerup', zoomTempEnd, true);
window.addEventListener('pointercancel', zoomTempEnd, true);

/* ── 命令：agent 走这几条＝人拿滑鼠做的事（视角不是文件内容 ⇒ undoable:false，不进历史） ── */
const zoomDocPt = p => {
  const c = ZoomView.center();
  return [p.x !== undefined ? Number(p.x) : c[0], p.y !== undefined ? Number(p.y) : c[1]];
};
CMD.reg('zoom.click', {i18n:'tool.zoom',
  params:'{x?, y?, out=false} 文件坐标（省略＝视窗正中）：同缩放工具点一下——按 PS 级距（1%…3200%）踏一级放大，out:true＝Alt+点踏一级缩小；该文件点在画面上的位置不变 → {zoom, center:[x,y]}'},
  p => { ZoomView.clickAt(ZoomView.toScreen(zoomDocPt(p)), !!p.out); return ZoomView.info(); });
CMD.reg('zoom.scrub', {i18n:'',
  params:'{x?, y?, dx} 同「细微缩放」拖曳：在文件点 (x,y) 按下、水平拖 dx 画面像素（右正左负）放开；zoom＝原 zoom×2^(dx/100)，该文件点钉在原位 → {zoom, center:[x,y]}'},
  p => {
    const doc = zoomDocPt(p), s = ZoomView.toScreen(doc);
    ZoomView.anchorView(s, doc, scrubZoom(UI.zoom, Number(p.dx)));
    return ZoomView.info();
  });
CMD.reg('zoom.rect', {i18n:'',
  params:'{x, y, w, h, out=false} 文件坐标矩形：同关掉「细微缩放」后拖框——缩到矩形塞满画布区、矩形中心移到正中；矩形在画面上任一边 <4 像素或 out:true ⇒ 改在 (x,y) 踏一级（out 踏出）→ {zoom, center:[x,y]}'},
  p => {
    const a = ZoomView.toScreen([Number(p.x) || 0, Number(p.y) || 0]);
    const b = ZoomView.toScreen([(Number(p.x) || 0) + (Number(p.w) || 0), (Number(p.y) || 0) + (Number(p.h) || 0)]);
    ZoomView.zoomToRect({x0:a[0], y0:a[1], x1:b[0], y1:b[1]}, a, !!p.out);
    return ZoomView.info();
  });
CMD.reg('zoom.set', {i18n:'',
  params:'{zoom?, center?:[x,y]} 同 ArtCraft ui.set：直接设缩放倍率（1＝100%）与视窗正中对着的文件点；都不给只回报现况 → {zoom, center:[x,y]}'},
  p => {
    if (p.zoom !== undefined && Number.isFinite(Number(p.zoom))){
      const c = ZoomView.center();                        // 只改倍率时中心不动（他们只改 view.zoom）
      UI.setZoom(zoomClamp(Number(p.zoom), ZOOM_MIN, ZOOM_MAX));
      ZoomView.anchorView(ZoomView.viewCenter(), c, UI.zoom);
    }
    if (Array.isArray(p.center) && p.center.length === 2)
      ZoomView.anchorView(ZoomView.viewCenter(), [Number(p.center[0]) || 0, Number(p.center[1]) || 0], UI.zoom);
    return ZoomView.info();
  });
CMD.reg('zoom.fit', {i18n:'',
  params:'{} 选项栏「适合屏幕」：zoom＝min((区宽−40)/文件宽, (区高−40)/文件高) 夹在 1%…100%，文件置中 → {zoom, center:[x,y]}'},
  () => { ZoomView.fit(); return ZoomView.info(); });
CMD.reg('zoom.actual', {i18n:'',
  params:'{} 选项栏「100%」：缩放设为 1，视窗正中对着的文件点不变 → {zoom, center:[x,y]}'},
  () => CMD.map['zoom.set'].run({zoom:1}));
CMD.reg('zoom.setOptions', {i18n:'',
  params:'{scrubby?:bool} 缩放工具选项：scrubby＝细微缩放（预设开；关掉后拖曳改为拉框缩放）→ {scrubby}'},
  p => {
    if (p.scrubby !== undefined) ZoomGesture.scrubby = !!p.scrubby;
    const cb = document.getElementById('zoomScrubby'); if (cb) cb.checked = ZoomGesture.scrubby;
    return {scrubby:ZoomGesture.scrubby};
  });

/* ── 缩放工具本身 ── */
Tools.reg({
  id:'zoom', icon:'🔍', key:'Z', group:'misc', order:40, for:'common', opts:[], cursor:'zoom-in',
  strings:{
    'zh-Hant':{'opt.zoomScrubby':'細微縮放', 'ui.zoomHint':'點按放大 · Alt＋點按縮小 · 向右／左拖曳放大／縮小', 'ui.zoomFit':'適合螢幕'},
    'zh-Hans':{'opt.zoomScrubby':'细微缩放', 'ui.zoomHint':'点按放大 · Alt＋点按缩小 · 向右／左拖动放大／缩小', 'ui.zoomFit':'适合屏幕'},
    'en':{'opt.zoomScrubby':'Scrubby Zoom', 'ui.zoomHint':'Click to zoom in · Alt-click to zoom out · drag right/left to zoom in/out', 'ui.zoomFit':'Fit Screen'}
  },
  /* panels.rs:770-789：勾选「细微缩放」、提示字、「适合屏幕」「100%」 */
  buildOptions(box, add, mk){
    const cb = mk('checkbox', {checked:ZoomGesture.scrubby});
    cb.id = 'zoomScrubby';
    cb.onchange = () => CMD.run('zoom.setOptions', {scrubby:cb.checked});
    add('zoomScrubby', cb);
    const h = document.createElement('span');
    h.style.cssText = 'color:#7a8290'; h.textContent = Lang.t('ui.zoomHint');
    box.appendChild(h);
    const btn = (id, label, cmd) => {
      const b = document.createElement('button'); b.id = id; b.textContent = label;
      b.onclick = () => CMD.run(cmd);
      box.appendChild(b);
    };
    btn('zoomFitBtn', Lang.t('ui.zoomFit'), 'zoom.fit');
    btn('zoomActualBtn', '100%', 'zoom.actual');
  },
  onDown(e, pt, P){
    // canvas.rs:1460／paint_mouse.rs:77-82：缩放工具只认左键（右键既不拖也不算点按）
    if (e.button !== 0){ ZoomGesture.cancel(); return; }
    ZoomGesture.down([e.clientX, e.clientY], null);
  },
  onMove(e, pt, P){
    if (P.down && ZoomGesture.g){ ZoomGesture.move([e.clientX, e.clientY]); return; }
    if (ZoomTemp.pid === null) ZoomCursor.refresh(e);       // 悬停：⌥ 换成缩小游标
  },
  onUp(e){
    if (!ZoomGesture.g) return;
    ZoomGesture.up([e.clientX, e.clientY], e.altKey);
  },
  onDeactivate(){ ZoomGesture.cancel(); }
});
