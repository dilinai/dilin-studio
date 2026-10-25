/* 抓手（H）：拖动画布视角，不改文件内容，视角不进历史。
   逐段翻译自 ArtCraft PhotoCraft（Rust → JS）：
   - ui-egui/src/canvas.rs  313-336  ViewXform：to_screen＝rect.center + (doc − center)·zoom；视角＝「视窗正中对着的文件点 center」＋ zoom
   - ui-egui/src/canvas.rs  338-344  fit_view：置中＝center=[w/2,h/2]
   - ui-egui/src/canvas.rs 1397-1416  导览：滚轮（无 ⌘/Ctrl）平移 view.center −= scroll / zoom；⌘滚轮／捏合缩放归缩放那边
   - ui-egui/src/canvas.rs 1423-1439  暂时工具：按住 Space＝抓手；中键按着＝抓手；否则用当前工具
   - ui-egui/src/canvas.rs 1456-1459  抓手拖曳：view.center −= drag_delta / zoom（不夹边界；egui 的 dragged() 不分左右键）
   - ui-egui/src/canvas.rs 1466-1469  （暂时）抓手的手势永远不交给底下那颗工具
   - ui-egui/src/canvas.rs 1545-1546  抓手点一下什么都不做
   - ui-egui/src/canvas.rs 1654-1660  游标：拖着＝Grabbing，否则＝Grab
   - ui-egui/src/hold_keys.rs 60-125  Space 是「按住才有效」的暂时抓手；⌘Space／⌘⌥Space 归缩放（held_tool：较具体者优先，多按 ⌥/⇧ 仍算 Space）；
                                     文字栏有键盘时不算（75-77）；拖着选框／形状时 Space 让给它们「重新定位」（102-104、118-119）；
                                     暂时工具一旦在按下期间生效就锁到放开为止（for_frame 的 latch，113-125）
   - ui-egui/src/dialogs.rs  28-38   pan_delta：Space 拖、中键拖、抓手拖都是同一个平移
   - ui-egui/src/panels.rs     790   选项栏提示「Drag to pan · hold Space with any tool」
   - ui-egui/src/control.rs  162-176 agent：ui.set {center:[x,y]} 直接设视角中心（不夹）、{fit:true} 回正中
   我们的视角：#canvasWrap 用 flex 把画布置中；视角中心偏离文件正中的量 off（文件坐标）用 CSS translate(百分比) 挂在画布上，
   百分比以画布自身宽高为基准 ⇒ 缩放后自动等于 off*zoom 像素，视窗正中对着的文件点在缩放前后不变（同他们 center 模型）。
   UI 的 toDoc() 用 getBoundingClientRect()，已含 transform，所以各工具的落点不受平移影响。
   他们的画布 response 盖满整个文件区（含图外的灰底），所以抓手从图外灰底起拖也算；我们这里也收 #canvasWrap 上起的拖。 */

/* ── 视角状态（他们的 View.center；放在这里给缩放工具／界面共用：window.HandView） ── */
const HandView = {
  off: [0, 0],          // 文件正中 − 视角中心（文件坐标）；[0,0] ＝ 置中（fit_view 的 center=[w/2,h/2]）
  W: 0, H: 0,           // 上次套用时的文件尺寸；文件尺寸变了（开新档）就回正中
  el(){ return document.getElementById('view'); },
  wrap(){ return document.getElementById('canvasWrap'); },
  center(){ return [Doc.width/2 - this.off[0], Doc.height/2 - this.off[1]]; },
  /* control.rs:167-171  ui.set {center}：直接设，不夹边界 */
  setCenter(x, y){
    this.off = [Doc.width/2 - x, Doc.height/2 - y];
    this.apply();
  },
  /* canvas.rs:1458-1459  view.center[0] -= d.x / view.zoom; view.center[1] -= d.y / view.zoom
     （他们还有「水平翻转视图」时 x 反号；我们没有翻转视图，省略）
     off ＝ 文件正中 − center ⇒ center −= d/zoom 等于 off += d/zoom */
  panBy(dx, dy){
    const z = UI.zoom || 1;
    this.off[0] += dx / z;
    this.off[1] += dy / z;
    this.apply();
  },
  /* canvas.rs:342  fit_view 的置中（只置中，不动缩放） */
  reset(){ this.off = [0, 0]; this.apply(); },
  apply(){
    const c = this.el(); if (!c) return;
    this.W = Doc.width; this.H = Doc.height;
    const [ox, oy] = this.off;
    c.style.transform = (ox || oy) ? `translate(${ox/Doc.width*100}%, ${oy/Doc.height*100}%)` : '';
  },
  /* 文件尺寸变了（file.new／开工程）⇒ 视角回正中（他们开新档是新 View、fit_pending） */
  watch(){
    const c = this.el(); if (!c || this._ro) return;
    this.W = Doc.width; this.H = Doc.height;
    this._ro = new ResizeObserver(() => {
      if (Doc.width !== this.W || Doc.height !== this.H) this.reset();
    });
    this._ro.observe(c);
  },
  info(){ const c = this.center(); return {center:[c[0], c[1]], zoom:UI.zoom}; }
};
window.HandView = HandView;
window.addEventListener('load', () => HandView.watch());

/* ── 暂时抓手：Space 按住、中键按着（hold_keys.rs、canvas.rs:1432-1439） ── */
// hold_keys.rs:102-104 repositions()：这些工具拖到一半时 Space 归它们「重新定位」，不变抓手
//（他们：RectMarquee／EllipseMarquee／Lasso／ObjectSelection ＋ vector_ui.rs:24 is_shape_tool 的形状工具；我们有的是这四颗）
const HAND_REPOSITION_TOOLS = new Set(['marquee', 'rect', 'ellipse', 'star', 'crop', 'lasso', 'objectselect']);   // 裁剪拖框途中 Space＝整个框跟着走（crop_ui.rs:203），抓手不接管
// hold_keys.rs:75-77 文字栏有键盘时不算暂时工具
const handTextFocused = el => !!el && (el.isContentEditable || /^textarea$/i.test(el.tagName) ||
  (/^input$/i.test(el.tagName) && /^(text|search|email|url|password|tel|number|)$/i.test(el.type || '')));
// 指针是否落在文件区（画布或图外灰底）——他们的 canvas response 盖满整块文件区
const handInArea = t => { const w = HandView.wrap(); return !!w && !!t && (t === w || w.contains(t)) && !(t.closest && t.closest('.dl-sb')); };   // 捲軸（tools/scrollbars.js）不算

const HandTemp = {
  space: false,         // Space 按着（且不是在文字栏里打字）
  drag: null,           // 正在拖的平移手势（暂时抓手，或抓手工具从灰底起拖）：{id, x, y, el}；按下当下锁定，放开为止＝for_frame 的 latch
  takeover: null,       // 别的工具拖到一半按了 Space ⇒ 抓手接手到放开：{x, y}
  lastX: 0, lastY: 0,   // 最近一次指针位置（接手时当作起点）
  savedCursor: null,
  /* hold_keys.rs:60-94 held_tool：Space 加 ⌘/Ctrl 是缩放（较具体的绑定优先），只有不带 ⌘/Ctrl 才是抓手；多按 ⌥／⇧ 仍是抓手 */
  isHand(e){ return this.space && !e.ctrlKey && !e.metaKey; },
  setCursor(c){ const v = HandView.el(); if (v) v.style.cursor = c; const w = HandView.wrap(); if (w) w.style.cursor = (c === 'grab' || c === 'grabbing') ? c : ''; },
  showGrab(){
    const v = HandView.el(); if (!v) return;
    if (this.savedCursor === null && ToolState.cur !== 'hand') this.savedCursor = v.style.cursor;
    this.setCursor('grab');
  },
  restoreCursor(){
    if (this.drag || this.takeover) return;           // 还在拖：放开时再还
    const v = HandView.el(); if (!v) return;
    if (ToolState.cur === 'hand' || this.space){ this.setCursor('grab'); if (ToolState.cur === 'hand') this.savedCursor = null; return; }
    const back = this.savedCursor !== null ? this.savedCursor : ((Tools.current().cursor) || 'crosshair');
    this.savedCursor = null;
    this.setCursor(back);
  }
};

window.addEventListener('keydown', e => {
  if (e.code !== 'Space' && e.key !== ' ') return;
  if (handTextFocused(e.target)) return;              // 在文字栏里：空白键就是打字
  e.preventDefault();                                  // 别让焦点上的按钮被空白键按下
  if (e.repeat || HandTemp.space) return;
  HandTemp.space = true;
  if (e.ctrlKey || e.metaKey) return;                  // ⌘Space／⌘⌥Space 是缩放的
  const cur = ToolState.cur;
  if (Pointer.down){
    // hold_keys.rs:113-125 for_frame：拖着选框／形状 ⇒ drawing ⇒ 不给暂时工具（让它们重新定位）；
    // 其它工具拖到一半 ⇒ held_tool 立刻是抓手 ⇒ canvas.rs:1456 起由抓手平移、1466-1469 不再交给底下的工具，锁到放开
    if (cur === 'hand' || HAND_REPOSITION_TOOLS.has(cur)) return;
    HandTemp.takeover = {x:HandTemp.lastX, y:HandTemp.lastY};
    HandTemp.showGrab(); HandTemp.setCursor('grabbing');
    return;
  }
  if (cur !== 'hand') HandTemp.showGrab();
}, true);

window.addEventListener('keyup', e => {
  if (e.code !== 'Space' && e.key !== ' ') return;
  if (!HandTemp.space) return;
  if (!handTextFocused(e.target)) e.preventDefault();
  HandTemp.space = false;                              // 已在拖的暂时抓手照样拖到放开（latch）
  HandTemp.restoreCursor();
}, true);

window.addEventListener('blur', () => { HandTemp.space = false; HandTemp.restoreCursor(); });

/* 按下（capture，先于 ui.js 画布上的监听）：
   · 中键（任何工具）                         canvas.rs:1437 None if middle => Tool::Hand
   · Space＋左键（非抓手工具；Ctrl/⌘ 不算）      canvas.rs:1433-1436 temporary
   · 抓手工具在图外灰底起拖                    canvas.rs:1456（response 盖满文件区）
   ⇒ 平移手势，事件不交给底下的工具（canvas.rs:1466-1469） */
window.addEventListener('pointerdown', e => {
  HandTemp.lastX = e.clientX; HandTemp.lastY = e.clientY;
  const v = HandView.el();
  if (!v || !handInArea(e.target)) return;
  const onCanvas = e.target === v;
  const mid = e.button === 1;
  const temp = e.button === 0 && ToolState.cur !== 'hand' && HandTemp.isHand(e);
  const handOff = !onCanvas && ToolState.cur === 'hand' && (e.button === 0 || e.button === 2);
  if (!mid && !temp && !handOff) return;
  if (Pointer.down || HandTemp.drag) return;           // 已有别的手势在进行
  e.stopPropagation(); e.preventDefault();
  const el = onCanvas ? v : HandView.wrap();
  try { el.setPointerCapture(e.pointerId); } catch(_){}
  HandTemp.drag = {id:e.pointerId, x:e.clientX, y:e.clientY, el};
  HandTemp.showGrab(); HandTemp.setCursor('grabbing');
}, true);

window.addEventListener('pointermove', e => {
  const d = HandTemp.drag;
  if (d && e.pointerId === d.id){
    e.stopPropagation();
    HandView.panBy(e.clientX - d.x, e.clientY - d.y);
    d.x = e.clientX; d.y = e.clientY;
    return;
  }
  const t = HandTemp.takeover;
  if (t && Pointer.down){
    // 接手期间：移动只拿来平移，不给底下的工具（它停在按 Space 那一点）
    e.stopPropagation();
    HandView.panBy(e.clientX - t.x, e.clientY - t.y);
    t.x = e.clientX; t.y = e.clientY;
    return;
  }
  HandTemp.lastX = e.clientX; HandTemp.lastY = e.clientY;
}, true);

const handEndTemp = e => {
  const d = HandTemp.drag;
  if (d && e.pointerId === d.id){
    e.stopPropagation();
    try { d.el.releasePointerCapture(e.pointerId); } catch(_){}
    HandTemp.drag = null;
    HandTemp.restoreCursor();
    return;
  }
  if (HandTemp.takeover && Pointer.down){
    // 他们这里：放开时 Space 已松 ⇒ 底下工具收到 Up；Space 还按着 ⇒ 收不到（drag 悬着）。
    // 我们一律让它在最后看到的那一点收笔，免得 Pointer.down 卡住、笔画悬着（这点跟原码不同）
    e.stopPropagation();
    HandTemp.takeover = null;
    Pointer.onUp(e, Pointer.hover || Pointer.start);
    HandTemp.restoreCursor();
  }
};
window.addEventListener('pointerup', handEndTemp, true);
window.addEventListener('pointercancel', handEndTemp, true);
// 中键在文件区：别触发浏览器的自动卷动／贴上
['mousedown', 'auxclick'].forEach(t => window.addEventListener(t, e => {
  if (e.button === 1 && handInArea(e.target)) e.preventDefault();
}, true));
// 抓手工具右键拖也平移（egui dragged() 不分键）⇒ 别跳浏览器右键选单
window.addEventListener('contextmenu', e => {
  if (handInArea(e.target) && (ToolState.cur === 'hand' || HandTemp.drag)) e.preventDefault();
}, true);

/* canvas.rs:1412-1415  滚轮平移：view.center −= scroll / zoom（egui 的 scroll＝内容移动方向＝−DOM delta）
   ⌘/Ctrl＋滚轮（含触控板捏合）是缩放，交给 ui.js；偏好「滚轮缩放」我们没有，省略 */
window.addEventListener('wheel', e => {
  if (!handInArea(e.target) || e.ctrlKey || e.metaKey) return;
  const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? (HandView.wrap().clientHeight || 600) : 1;
  let dx = e.deltaX * k, dy = e.deltaY * k;
  if (e.shiftKey && !dx){ dx = dy; dy = 0; }          // Shift＋滚轮＝横向卷动（滑鼠滚轮的惯例）
  /* 滑鼠滚轮一格浏览器给 100～120 像素以上（再乘系统倍率），一格跳一大段。
     一格（|delta|≥50，触控板是一串小值不受影响）改成固定 40 像素 */
  const notch = v => Math.abs(v) >= 50 ? Math.sign(v) * 40 : v;
  dx = notch(dx); dy = notch(dy);
  if (!dx && !dy) return;
  e.preventDefault();
  HandView.panBy(-dx, -dy);
}, {capture:true, passive:false});

/* ── 命令：agent 走这条跟人拿滑鼠拖一样（视角不是文件内容 ⇒ undoable:false，不进历史） ── */
CMD.reg('hand.pan', {i18n:'tool.hand',
  params:'{dx, dy} 画面像素，与滑鼠拖曳同义：往右下拖 dx,dy>0 ⇒ 画面跟手往右下（视角中心 −= d/zoom，不夹边界）；只动视角不改文件 → {center:[x,y] 视窗正中对着的文件坐标, zoom}'},
  p => { HandView.panBy(Number(p.dx) || 0, Number(p.dy) || 0); return HandView.info(); });
CMD.reg('hand.scroll', {i18n:'',
  params:'{dx?, dy?} 滚轮量（画面像素，同 DOM WheelEvent.deltaX/Y：dy>0＝往下卷 ⇒ 看文件更下面）；同 ArtCraft 滚轮平移 center += d/zoom → {center:[x,y], zoom}'},
  p => { HandView.panBy(-(Number(p.dx) || 0), -(Number(p.dy) || 0)); return HandView.info(); });
CMD.reg('hand.center', {i18n:'',
  params:'{center?:[x,y]} 或 {x?, y?} 文件坐标：给了就让视窗正中对到这一点（同 ArtCraft ui.set {center}，不夹边界），不给只回报现况 → {center:[x,y], zoom}'},
  p => {
    const c = HandView.center();
    if (Array.isArray(p.center) && p.center.length === 2){
      HandView.setCenter(Number(p.center[0]) || 0, Number(p.center[1]) || 0);   // control.rs:170 unwrap_or(0.0)
    } else if (p.x !== undefined || p.y !== undefined){
      HandView.setCenter(p.x !== undefined ? Number(p.x) : c[0], p.y !== undefined ? Number(p.y) : c[1]);
    }
    return HandView.info();
  });
CMD.reg('hand.reset', {i18n:'',
  params:'{} 视角回到文件正中（同 fit_view 的置中，缩放不动）→ {center:[x,y], zoom}'},
  () => { HandView.reset(); return HandView.info(); });

/* ── 抓手工具本身 ── */
Tools.reg({
  id:'hand', icon:'✋', key:'H', group:'misc', order:30, for:'common', opts:[], cursor:'grab',
  hint:'ui.handHint',
  strings:{
    'zh-Hant':{'ui.handHint':'拖曳以平移畫面 · 任何工具按住空白鍵也能拖'},
    'zh-Hans':{'ui.handHint':'拖动以平移画面 · 任何工具按住空格键也能拖'},
    'en':{'ui.handHint':'Drag to pan · hold Space with any tool'}
  },
  _last:null,
  // canvas.rs:1545-1546 点一下什么都不做；按下只记起点（左右键都收：egui dragged() 不分键）
  onDown(e){
    this._last = {x:e.clientX, y:e.clientY};
    HandTemp.setCursor('grabbing');                    // canvas.rs:1655-1656 拖着＝Grabbing
  },
  // canvas.rs:1456-1459 拖曳平移
  onMove(e, pt, P){
    if (!P.down || !this._last) return;
    HandView.panBy(e.clientX - this._last.x, e.clientY - this._last.y);
    this._last = {x:e.clientX, y:e.clientY};
  },
  onUp(){ this._last = null; HandTemp.setCursor('grab'); },   // canvas.rs:1657-1658 没拖＝Grab
  onDeactivate(){ this._last = null; const w = HandView.wrap(); if (w) w.style.cursor = ''; }
});
