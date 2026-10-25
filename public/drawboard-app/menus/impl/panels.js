/* 堤麟画板 · 浮动面板共用外壳（window.DlPanels）—— 视窗菜单（PS／AI）开关面板用；别的菜单也可以拿来用。
   原码对照：
     photocraft ui-egui/src/view_cmds.rs 457-475   Window ▸ <面板>：面板开着又点一次＝关；关着＝开并切到那一页（「选一次显示、再选一次隐藏」照 PS）
     photocraft ui-egui/src/menus.rs 394-417        window.toggle.*（图层／历史／属性／颜色／导航器／工具／选项／画笔设置）同一条切换
     photocraft ui-egui/src/workspace_ui.rs 298-309 浮动小窗：标题列＋关闭钮（analysis_ui::panel_window／title_row）
     vectorcraft ui-egui/src/menus.rs              window.panel {panel}：开关同一个面板
   我们的做法：
     ■ 面板＝固定定位的 .dlp 小窗：标题列（拖动）＋ × 关闭＋内容；右下角可拉大小；按一下浮到最上面。菜单项打勾＝面板开着＝看得到。
     ■ 位置、大小、开着哪些都记在 localStorage（像 PS 下次打开还在原处）。
     ■ 「停靠」类面板（右侧图层／颜色、左侧工具栏、上方选项栏）不是浮动窗：def.dock = {shown, show(on)}，开关＝显示／隐藏原本那一块。
     ■ 文件一改（UI.refresh）就重刷开着的面板；def.live 的（导航器、信息）每画一次画面也刷（合并到下一帧，一帧最多一次）。
   🔴 
     ■ 画板页内：整个视窗都能拖（不限画布区；只留标题列至少 60px 在画面里，免得拖丢）。
     ■ 网站里画板跑在 iframe：外层同源（读得到 parent.document）⇒ 面板 DOM 放进外层 document 的一个 fixed 图层（#dlPanelsHost-*），
       样式也注进外层；事件处理照旧叫 iframe 里的程式。⇒ 面板可以拖到 iframe 外、盖在角色对话框上面。
       跨源或宿主说不要（__dlSiteHooks.panelHost = 'self'）⇒ 退回 iframe 里面。
   🔴 
     ■ 每个面板分「像素专用」（only:'raster'）、「向量专用」（only:'vector'）、两种都行（不标）；分类表在本档最下面 KIND 表，开发笔记有全表与理由。
     ■ 当前图层种类对不上 ⇒ 开着的面板整块灰掉、不能点（inert）、上方一行说明；菜单项灰掉不让勾、后面标「像素专用／向量专用」（menubar.js 认 item.only）。
     ■ 只有真的像素层（kind:'raster'）算像素、真的矢量层（kind:'vector'）算向量；文字层／图层组／智能对象两种专用都灰。
   用法：
     DlPanels.define('history', {title:{'zh-Hant','zh-Hans',en}, w:240, h:280, build(body, api){…}, refresh(body, api, why){…}, live:false, only?:'raster'|'vector'})
     DlPanels.open(id) / close(id) / toggle(id, on?) / isOpen(id) / front(id) / refresh(id?) / list / state
     DlPanels.dialog({title, fields:[{k, label, type:'text'|'number'|'check'|'select'|'color'|'note', value, options:[[值, 名]…], min, max, step}], ok(v){…; return false＝不关}, okLabel})
     DlPanels.t(三语物件)＝照现在语言取字；DlPanels.el(tag, attrs, kids)＝建元素小工具。
     面板程式里别直接用 document.activeElement／document.body：用 DlPanels.activeEl(node)、DlPanels.typing(body)、DlPanels.popup(pop, anchor)（面板可能在外层 document）。
     不是用 define 建的浮窗（例：ps-type 的字符／段落面板）：DlPanels.mount(box, ['那支档的 style id'])＝放进同一个宿主图层。
   agent：panel.list／panel.toggle {id, on?}／panel.state／panel.host（命令层，跟人点视窗菜单同一条路）。 */
(function(){
if (window.DlPanels) return;

const LS = 'dlPanels.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch(e){ return {}; } };
const save = s => { try { localStorage.setItem(LS, JSON.stringify(s)); } catch(e){} };
const T3 = o => !o ? '' : typeof o === 'string' ? o : (o[(window.Lang && Lang.cur) || 'zh-Hans'] || o.en || o['zh-Hans'] || '');
const LT = (k, fb) => { const v = window.Lang ? Lang.t(k) : k; return v && v !== k ? v : fb; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const UID = Math.random().toString(36).slice(2, 8);
const SELF = {mode:'self', doc:document, win:window};

const P = window.DlPanels = {
  defs: {}, els: {}, z: 900, _mem: load(), _pending: null, kinds: {}, _mounted: [], lastRefusal: null,

  t: T3,
  /* 建元素：el('button', {class:'x', onclick:…, text:'…', title:'…', style:'…', dataset:{…}}, [子…]) */
  el(tag, a, kids){
    const e = document.createElement(tag);
    for (const k in (a || {})){
      const v = a[k];
      if (v === undefined || v === null) continue;
      if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k in e && typeof v !== 'string') e[k] = v;
      else e.setAttribute(k, v);
    }
    (kids || []).forEach(c => { if (c !== null && c !== undefined) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  },

  define(id, def){
    this.defs[id] = Object.assign({id}, def);
    // 上次开着的浮动面板：界面起来后重开（UI 还没起来就等 init 那一下）
    if (!def.dock && this._mem.open && this._mem.open.includes(id) && window.UI && UI.canvas) this.open(id, {restore:true});
    return this.defs[id];
  },
  has(id){ return !!this.defs[id]; },
  isOpen(id){
    const d = this.defs[id]; if (!d) return false;
    if (d.dock) { try { return !!d.dock.shown(); } catch(e){ return false; } }
    return !!this.els[id];
  },

  /* ═══ 图层种类闸（像素专用／向量专用） ═══ */
  kindOf(){ try { const L = window.Doc && Doc.active && Doc.active(); return L ? L.kind : 'raster'; } catch(e){ return 'raster'; } },
  only(id){ const d = this.defs[id]; return (d && d.only) || this.kinds[id] || null; },
  /* 这个面板在当前图层能不能用（不分类的永远能用） */
  usable(id){ const o = this.only(id); return !o || o === this.kindOf(); },
  onlyLabel(o){ return o === 'raster' ? LT('ui.onlyRaster', '像素专用') : o === 'vector' ? LT('ui.onlyVector', '向量专用') : ''; },
  _applyKind(id){
    const box = this.els[id]; if (!box) return;
    const o = this.only(id), ok = !o || o === this.kindOf(), b = box.querySelector('.dlp-b');
    box.classList.toggle('dlp-off', !ok); box.dataset.only = o || '';
    if (b){ b.inert = !ok; if (ok) b.removeAttribute('inert'); else b.setAttribute('inert', ''); }
    const tag = box.querySelector('.dlp-only'); if (tag) tag.textContent = this.onlyLabel(o);
    let m = box.querySelector('.dlp-offmsg');
    if (!ok){ if (!m){ m = this.el('div', {class:'dlp-offmsg'}); box.insertBefore(m, b); } m.textContent = LT(o === 'raster' ? 'ui.panelOffRaster' : 'ui.panelOffVector', this.onlyLabel(o)); }
    else if (m) m.remove();
    // inert／pointer-events:none 会让点击「穿过去」打到底下的画布（例：移动工具自动选层）⇒ 盖一层透明挡板吃掉点击
    let blk = box.querySelector('.dlp-block');
    if (!ok){ if (!blk){ blk = this.el('div', {class:'dlp-block'}); ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'wheel'].forEach(t => blk.addEventListener(t, e => { e.stopPropagation(); if (t !== 'pointerdown') e.preventDefault(); }, {passive:false})); box.appendChild(blk); }
      blk.title = m ? m.textContent : ''; const hh = box.querySelector('.dlp-h'); blk.style.top = ((hh ? hh.offsetHeight : 24) + (m ? m.offsetHeight : 0)) + 'px'; }
    else if (blk) blk.remove();
    box.classList.toggle('locked', !!(document.body && document.body.classList.contains('dlp-locked')));
  },

  open(id, opt){
    opt = opt || {};
    const d = this.defs[id]; if (!d) return false;
    if (d.dock){ d.dock.show(true); this._remember(); this._afterLayout(); return true; }
    if (this.els[id]){ this.front(id); return true; }
    // 种类对不上：人点菜单／agent 叫命令都不开（「灰掉不让勾」）；重开上次的（restore）或 force 才开（开出来是灰的）
    if (!opt.restore && !opt.force && !this.usable(id)){ this.lastRefusal = {id, only:this.only(id), kind:this.kindOf()}; return false; }
    const h = this.syncHost();
    const mem = (this._mem[this._posKey(h)] || {})[id];
    const k = Object.keys(this.els).length;
    const rp = document.getElementById('rightpanel');
    const rpw = rp && rp.offsetParent ? rp.getBoundingClientRect().width : 0;
    const w = mem && mem.w || d.w || 240, hh = mem && mem.h || d.h || null;
    let x, y;
    if (mem){ x = mem.x; y = mem.y; }
    else { const f = this._frameOff(h); x = window.innerWidth - rpw - w - 14 - k * 22 + f.x; y = 86 + k * 22 + f.y; }   // 预设位置用画板页的座标算，再换到宿主
    const box = this.el('div', {class:'dlp', dataset:{panel:id}});
    const head = this.el('div', {class:'dlp-h'}, [
      this.el('span', {class:'dlp-t', text:T3(d.title)}),
      this.el('span', {class:'dlp-only'}),
      this.el('span', {class:'dlp-m', text:'≡', title:T3({'zh-Hant':'面板選單', 'zh-Hans':'面板菜单', en:'Panel menu'}), onclick:e => { e.stopPropagation(); this._menu(id, e.currentTarget); }}),
      this.el('span', {class:'dlp-x', text:'×', title:T3({'zh-Hant':'關閉', 'zh-Hans':'关闭', en:'Close'}), onclick:e => { e.stopPropagation(); this.close(id); }})
    ]);
    const body = this.el('div', {class:'dlp-b'});
    box.appendChild(head); box.appendChild(body);
    box.style.width = w + 'px'; if (hh) box.style.height = hh + 'px';
    this._layer(h).appendChild(box);
    this.els[id] = box;
    this._place(box, x, y);
    this._drag(id, head);
    box.addEventListener('pointerdown', () => this.front(id), true);
    this._observe(box);
    this.front(id);
    this._applyKind(id);
    try { if (d.build) d.build(body, this.api(id)); } catch(e){ console.error('[DlPanels] build', id, e); }
    try { if (d.refresh) d.refresh(body, this.api(id), 'open'); } catch(e){ console.error('[DlPanels] refresh', id, e); }
    if (!opt.restore) this._remember();
    return true;
  },
  close(id){
    const d = this.defs[id]; if (!d) return false;
    if (d.dock){ d.dock.show(false); this._remember(); this._afterLayout(); return true; }
    const box = this.els[id]; if (!box) return true;
    this._remember();                                   // 关之前记一次位置
    if (box._ro) box._ro.disconnect();
    box.remove(); delete this.els[id];
    try { if (d.onClose) d.onClose(); } catch(e){ console.error(e); }
    this._remember();
    return true;
  },
  /* on 缺省＝切换（原码 view_cmds.rs:464-469：开着就关，否则开） */
  toggle(id, on){
    if (!this.defs[id]) return null;
    const want = typeof on === 'boolean' ? on : !this.isOpen(id);
    want ? this.open(id) : this.close(id);
    return this.isOpen(id);
  },
  front(id){ const b = this.els[id]; if (b){ b.style.zIndex = ++this.z; } },
  api(id){
    const self = this;
    return {id, get body(){ return self.els[id] && self.els[id].querySelector('.dlp-b'); }, refresh(){ self.refresh(id); }, close(){ self.close(id); }, el:self.el.bind(self), t:T3};
  },
  /* 重刷：id 缺省＝全部开着的 */
  refresh(id, why){
    const ids = id ? [id] : Object.keys(this.els);
    ids.forEach(k => {
      const d = this.defs[k], box = this.els[k]; if (!d || !box) return;
      const t = box.querySelector('.dlp-t'); if (t) t.textContent = T3(d.title);
      this._applyKind(k);
      try { if (d.refresh) d.refresh(box.querySelector('.dlp-b'), this.api(k), why || 'refresh'); } catch(e){ console.error('[DlPanels] refresh', k, e); }
    });
  },
  /* 合并到下一帧：live＝每画一次画面都刷的那几个 */
  schedule(why){
    const live = why === 'draw';
    const hover = live && !!(window.UI && UI._hoverDraw);
    if (this._pending){ if (!live) this._pending.all = true; if (!hover) this._pending.hover = false; return; }
    this._pending = {all:!live, hover};
    requestAnimationFrame(() => {
      const p = this._pending; this._pending = null;
      if (p.all) this.syncHost();
      Object.keys(this.els).forEach(k => { const d = this.defs[k]; if (p.all || (d && d.live && (!p.hover || k === 'info'))) this.refresh(k, p.all ? 'doc' : 'draw'); });
    });
  },
  list(){ return Object.keys(this.defs).map(id => ({id, title:T3(this.defs[id].title), open:this.isOpen(id), dock:!!this.defs[id].dock, only:this.only(id), usable:this.usable(id)})); },
  state(){
    const out = {};
    Object.keys(this.defs).forEach(id => {
      const b = this.els[id];
      out[id] = {open:this.isOpen(id), only:this.only(id), usable:this.usable(id)};
      if (b){ const r = b.getBoundingClientRect(); out[id].rect = {x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height)}; out[id].off = b.classList.contains('dlp-off'); out[id].host = b.ownerDocument === document ? 'self' : 'parent'; }
    });
    return out;
  },
  /* 全关（工作区重设用）：keep＝留着的 id */
  closeAll(keep){ Object.keys(this.els).forEach(id => { if (!(keep || []).includes(id)) this.close(id); }); },

  /* ═══ 宿主：面板 DOM 放在哪一份 document ═══
     __dlSiteHooks.panelHost（宿主设在 iframe 的 window 上）：
       缺省／'auto'／'parent' ⇒ 外层同源就放外层 document（盖得到角色对话框），否则放 iframe 里
       'self'／false            ⇒ 一律放 iframe 里
       元素（外层 document 里的一个容器）或 函式({frame, doc}) → 元素 ⇒ 放进那个容器（宿主自己管层级）
     DilinCanvas.panels.setHost(值) 等同改 panelHost 并立刻搬家。 */
  hostPref(){ const h = window.__dlSiteHooks; if (h && h.panelHost !== undefined && h.panelHost !== null) return h.panelHost; return this._pref === undefined ? 'auto' : this._pref; },
  _resolveHost(){
    const pref = this.hostPref();
    if (pref === 'self' || pref === false) return SELF;
    let fe = null, pd = null;
    try { fe = window.frameElement; pd = fe && window.parent && window.parent.document; if (!pd || !pd.body) return SELF; } catch(e){ return SELF; }   // 跨源：读 parent.document 会丢错
    let c = null;
    if (typeof pref === 'function'){ try { c = pref({frame:fe, doc:pd}); } catch(e){ c = null; } if (!c) return SELF; }
    else if (pref && typeof pref === 'object' && pref.nodeType === 1) c = pref;
    if (c){ try { if (c.ownerDocument !== pd || !c.isConnected) return SELF; } catch(e){ return SELF; } return {mode:'parent', doc:pd, win:pd.defaultView, frame:fe, container:c}; }
    return {mode:'parent', doc:pd, win:pd.defaultView, frame:fe};
  },
  host(){ return this._host || SELF; },
  hostMode(){ return this.host().mode; },
  _posKey(h){ return (h || this.host()).mode === 'parent' ? 'posParent' : 'pos'; },
  /* iframe 左上角在宿主视窗里的位置（宿主＝自己时是 0,0） */
  _frameOff(h){
    h = h || this.host();
    if (h.mode !== 'parent' || !h.frame) return {x:0, y:0};
    try { const r = h.frame.getBoundingClientRect(); return {x:r.left + (h.frame.clientLeft || 0), y:r.top + (h.frame.clientTop || 0)}; } catch(e){ return {x:0, y:0}; }
  },
  /* 确认宿主没变；变了就把开着的面板整批搬过去（座标换算成新宿主的，画面上位置不变） */
  syncHost(){
    const nh = this._resolveHost(), oh = this._host || SELF;
    const same = nh.mode === oh.mode && nh.doc === oh.doc && nh.container === oh.container && (nh.mode === 'self' || nh.container || (this._parentLayer && this._parentLayer.isConnected));
    if (same && this._host){ return this._host; }
    this._host = nh;
    const boxes = Object.keys(this.els).map(id => this.els[id]).concat(this._mounted.filter(b => b.isConnected));
    if (!boxes.length && nh.mode === 'self'){ this._dropParentLayer(); return nh; }
    const fo = this._frameOff(oh), fn = this._frameOff(nh), layer = this._layer(nh);
    this._closePops();
    boxes.forEach(b => {
      const r = b.getBoundingClientRect();
      layer.appendChild(b);
      b.style.left = Math.round(r.left + fo.x - fn.x) + 'px'; b.style.top = Math.round(r.top + fo.y - fn.y) + 'px'; b.style.right = 'auto'; b.style.transform = 'none';
      if (b._ro){ b._ro.disconnect(); b._ro = null; } if (b.classList.contains('dlp')) this._observe(b);
    });
    if (nh.mode !== 'parent' || nh.container) this._dropParentLayer();
    this._remember();
    return nh;
  },
  /* 宿主图层：自己＝document.body；外层＝外层 body 里一个盖满视窗、不挡滑鼠的 fixed 层（面板自己 pointer-events:auto） */
  _layer(h){
    h = h || this.host();
    if (h.mode !== 'parent') return document.body;
    ensureStyle(h.doc);
    if (h.container) return h.container;
    let L = this._parentLayer;
    if (L && L.isConnected && L.ownerDocument === h.doc) return L;
    L = h.doc.createElement('div');
    L.id = 'dlPanelsHost-' + UID; L.className = 'dlp-host'; L.setAttribute('data-dl-panels', '1');
    L.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000';
    h.doc.body.appendChild(L);
    this._parentLayer = L;
    // 键盘：焦点在外层的面板上（不是在输入框里）时，快捷键转回画板（Ctrl+Z、Space…照常）
    L.addEventListener('keydown', e => fwdKey(e)); L.addEventListener('keyup', e => fwdKey(e));
    try { h.win.addEventListener('resize', this._onHostResize); } catch(e){}
    return L;
  },
  _dropParentLayer(){
    const L = this._parentLayer; this._parentLayer = null;
    if (L){ try { L.ownerDocument.defaultView.removeEventListener('resize', this._onHostResize); } catch(e){} L.remove(); }
  },
  /* 不是 define 建的浮窗也放进宿主图层：box 先按画板页座标放好（left/top 或 right），这里换成宿主座标 */
  mount(box, styleIds){
    const h = this.syncHost();
    if (!this._mounted.includes(box)) this._mounted.push(box);
    if (h.mode !== 'parent'){ if (box.parentNode !== document.body) document.body.appendChild(box); return box; }
    (styleIds || []).forEach(sid => copyStyle(h.doc, sid));
    const fresh = box.ownerDocument === document;
    if (fresh){
      if (!box.isConnected) document.body.appendChild(box);
      const r = box.getBoundingClientRect(), f = this._frameOff(h);
      this._layer(h).appendChild(box);
      box.style.left = Math.round(r.left + f.x) + 'px'; box.style.top = Math.round(r.top + f.y) + 'px'; box.style.right = 'auto'; box.style.transform = 'none';
    } else if (box.parentNode !== this._layer(h)) this._layer(h).appendChild(box);
    return box;
  },
  /* 宿主现在的 document（面板／浮窗所在） */
  hostDoc(){ return this.host().doc; },
  /* 焦点在哪（面板在外层时 document.activeElement 只会是 iframe 的 body） */
  activeEl(node){ const d = node && node.ownerDocument ? node.ownerDocument : this.hostDoc(); try { return d.activeElement; } catch(e){ return null; } },
  /* 正在面板 body 里打字／拉选单 ⇒ 重刷会把输入框砍掉，各面板 refresh 开头用这个判断要不要先跳过 */
  typing(body, opt){
    const a = this.activeEl(body); if (!a || !body || !body.contains(a)) return false;
    if (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') return true;
    if (a.tagName !== 'INPUT') return false;
    const skip = (opt && opt.skip) || ['checkbox', 'radio', 'button'];
    return !skip.includes(a.type);
  },
  /* 小弹出选单：放进锚点所在 document（面板在哪就弹在哪），点外面就关；opt.above＝往上弹、opt.alignRight＝右缘对齐锚点 */
  popup(pop, anchor, opt){
    opt = opt || {};
    const d = anchor && anchor.ownerDocument ? anchor.ownerDocument : this.hostDoc(), w = d.defaultView;
    this._closePops();
    pop.classList.add('dlp-pop');
    (d === document ? document.body : this._layer(this.host())).appendChild(pop);
    const r = anchor.getBoundingClientRect();
    let x = opt.alignRight ? r.right - pop.offsetWidth : r.left, y = opt.above ? r.top - pop.offsetHeight - 2 : r.bottom + 2;
    x = clamp(x, 2, Math.max(2, w.innerWidth - pop.offsetWidth - 2)); y = clamp(y, 2, Math.max(2, w.innerHeight - Math.min(pop.offsetHeight, w.innerHeight - 4) - 2));
    pop.style.left = Math.round(x) + 'px'; pop.style.top = Math.round(y) + 'px';
    const off = ev => { if (!pop.contains(ev.target)){ pop.remove(); d.removeEventListener('pointerdown', off, true); } };
    setTimeout(() => d.addEventListener('pointerdown', off, true), 0);
    return pop;
  },
  _closePops(){ [document, this._parentLayer && this._parentLayer.ownerDocument].forEach(d => { if (d) d.querySelectorAll('.dlp-pop').forEach(x => x.remove()); }); },

  /* ── 内部 ── */
  _observe(box){
    const W = box.ownerDocument.defaultView;
    const RO = (W && W.ResizeObserver) || window.ResizeObserver;
    if (RO){ const ro = new RO(() => this._remember()); ro.observe(box); box._ro = ro; }
  },
  /* 放位置：整个视窗都能去（不限画布区）；只留标题列至少 60px 在画面里、上缘不出顶 */
  _place(box, x, y){
    const W = box.ownerDocument.defaultView || window, w = box.offsetWidth || 200;
    x = clamp(x, Math.min(0, 60 - w), Math.max(0, W.innerWidth - 60)); y = clamp(y, 0, Math.max(0, W.innerHeight - 24));
    box.style.left = Math.round(x) + 'px'; box.style.top = Math.round(y) + 'px';
  },
  _drag(id, head){
    head.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('.dlp-x,.dlp-m')) return;
      e.preventDefault();
      const box = this.els[id], r = box.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      const mv = ev => this._place(box, ev.clientX - dx, ev.clientY - dy);
      const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); this._remember(); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
    });
  },
  _menu(id, anchor){
    const d = this.defs[id]; if (!d) return;
    const items = (d.menu ? d.menu() : []).concat([{sep:true}, {label:{'zh-Hant':'關閉', 'zh-Hans':'关闭', en:'Close'}, run:() => this.close(id)}]);
    const pop = this.el('div', {class:'dlp-pop'});
    items.forEach(it => {
      if (it.sep){ if (pop.lastChild) pop.appendChild(this.el('div', {class:'dlp-sep'})); return; }
      pop.appendChild(this.el('div', {class:'dlp-pi' + (it.disabled ? ' off' : ''), text:(it.checked ? '✓ ' : '') + T3(it.label),
        onclick:e => { e.stopPropagation(); pop.remove(); if (!it.disabled) try { it.run(); } catch(err){ console.error(err); } }}));
    });
    this.popup(pop, anchor, {alignRight:true});
  },
  _remember(){
    const m = this._mem, key = this._posKey(); m[key] = m[key] || {};
    Object.keys(this.els).forEach(id => { const r = this.els[id].getBoundingClientRect(); m[key][id] = {x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height)}; });
    m.open = Object.keys(this.els);
    m.dock = {}; Object.keys(this.defs).forEach(id => { if (this.defs[id].dock) m.dock[id] = this.isOpen(id); });
    save(m);
  },
  /* 停靠块显示／隐藏后画布区大小变了 ⇒ 重画 */
  _afterLayout(){ requestAnimationFrame(() => { if (window.UI && UI.canvas) UI.draw(); }); },

  /* ── 通用表单对话框（各面板／菜单项的「…」对话框用；放在画板页里，模态） ── */
  dialog(o){
    document.querySelectorAll('.dlp-dlg-back').forEach(x => x.remove());
    const back = this.el('div', {class:'dlp-dlg-back'});
    const box = this.el('div', {class:'dlp-dlg', dataset:{dlg:o.id || ''}});
    box.appendChild(this.el('div', {class:'t', text:T3(o.title)}));
    const F = {};
    (o.fields || []).forEach(f => {
      if (f.type === 'note'){ box.appendChild(this.el('div', {class:'note', text:T3(f.label)})); return; }
      const row = this.el('label', {class:f.type === 'check' ? 'ck' : ''});
      let inp;
      if (f.type === 'select'){
        inp = this.el('select');
        (f.options || []).forEach(op => { const [v, n] = Array.isArray(op) ? op : [op, op]; inp.appendChild(this.el('option', {value:v, text:T3(n)})); });
        inp.value = f.value;
      } else if (f.type === 'check'){ inp = this.el('input', {type:'checkbox'}); inp.checked = !!f.value; }
      else { inp = this.el('input', {type:f.type === 'number' ? 'number' : f.type === 'color' ? 'color' : 'text'}); if (f.min !== undefined) inp.min = f.min; if (f.max !== undefined) inp.max = f.max; if (f.step !== undefined) inp.step = f.step; inp.value = f.value === undefined ? '' : f.value; }
      inp.dataset.k = f.k;
      if (f.type === 'check'){ row.appendChild(inp); row.appendChild(this.el('span', {text:T3(f.label)})); }
      else { row.appendChild(this.el('span', {text:T3(f.label)})); row.appendChild(inp); }
      box.appendChild(row); F[f.k] = {inp, f};
    });
    const msg = this.el('div', {class:'msg'}); box.appendChild(msg);
    const close = () => { back.remove(); if (o.onClose) o.onClose(); };
    const values = () => { const v = {}; for (const k in F){ const {inp, f} = F[k]; v[k] = f.type === 'check' ? inp.checked : f.type === 'number' ? (inp.value === '' ? null : +inp.value) : inp.value; } return v; };
    const done = () => {
      let r; try { r = o.ok(values()); } catch(e){ r = {ok:false, error:e.message}; }
      if (r === false || (r && r.ok === false)){ msg.textContent = (r && r.error) || ''; return; }
      close();
    };
    const bar = this.el('div', {class:'bar'}, [
      this.el('button', {text:T3({'zh-Hant':'取消', 'zh-Hans':'取消', en:'Cancel'}), dataset:{act:'cancel'}, onclick:close}),
      this.el('button', {class:'pri', text:T3(o.okLabel || {'zh-Hant':'確定', 'zh-Hans':'确定', en:'OK'}), dataset:{act:'ok'}, onclick:done})
    ]);
    box.appendChild(bar);
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA'){ e.preventDefault(); e.stopPropagation(); done(); }
      else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); }
    });
    back.addEventListener('pointerdown', e => e.stopPropagation());
    back.appendChild(box); document.body.appendChild(back);
    const first = box.querySelector('input,select'); if (first){ first.focus(); if (first.select) first.select(); }
    return {back, box, values, close, done, fields:F};
  }
};
P._onHostResize = () => Object.values(P.els).forEach(b => { const r = b.getBoundingClientRect(); P._place(b, r.left, r.top); });

/* 外层面板上按的键（不是在输入框里）⇒ 照样送进画板（ui.js 的快捷键挂在画板的 document 上） */
function fwdKey(e){
  const t = e.target, tag = t && t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
  const ev = new KeyboardEvent(e.type, {key:e.key, code:e.code, keyCode:e.keyCode, ctrlKey:e.ctrlKey, metaKey:e.metaKey, shiftKey:e.shiftKey, altKey:e.altKey, repeat:e.repeat, bubbles:true, cancelable:true});
  const tgt = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
  if (!tgt.dispatchEvent(ev)) e.preventDefault();
}

/* ── 样式（自己注入；不碰 style.css）；面板放外层时外层也注一份 ── */
const CSS = `
.dlp{position:fixed;z-index:900;min-width:170px;min-height:60px;max-height:calc(100vh - 40px);display:flex;flex-direction:column;background:var(--bg2,#262626);color:var(--fg,#d6d6d6);
  border:1px solid var(--line,#3a3a3a);border-radius:4px;box-shadow:0 8px 24px #000a;font:12px sans-serif;resize:both;overflow:hidden;pointer-events:auto;box-sizing:border-box;text-align:left;line-height:normal;letter-spacing:normal}
.dlp *{box-sizing:border-box}
.dlp.locked{resize:none}.dlp.locked .dlp-h{cursor:default}
.dlp-h{flex:0 0 auto;display:flex;align-items:center;gap:6px;height:24px;padding:0 6px 0 9px;background:var(--bg3,#2f2f2f);border-bottom:1px solid var(--line,#3a3a3a);cursor:move;user-select:none;touch-action:none}
.dlp-t{flex:1;font-weight:600;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dlp-only{font-size:9.5px;border:1px solid currentColor;border-radius:3px;padding:0 3px;opacity:.7;white-space:nowrap}.dlp-only:empty{display:none}
.dlp[data-only=raster] .dlp-only{color:#8fb8e8}.dlp[data-only=vector] .dlp-only{color:#7fd39a}
.dlp-x,.dlp-m{cursor:pointer;color:var(--fg2,#9a9a9a);font-size:14px;line-height:1;padding:0 2px}.dlp-x:hover,.dlp-m:hover{color:#fff}
.dlp-b{flex:1;overflow:auto;padding:6px 8px}
.dlp-offmsg{flex:0 0 auto;padding:4px 8px;font-size:11px;color:#e0b040;background:#2a2516;border-bottom:1px solid var(--line,#3a3a3a)}
.dlp.dlp-off .dlp-b{opacity:.35;filter:grayscale(1);pointer-events:none;user-select:none}
.dlp.dlp-off .dlp-t{opacity:.6}
.dlp-block{position:absolute;left:0;right:0;bottom:0;top:24px;background:transparent;cursor:not-allowed;pointer-events:auto;z-index:1}
.dlp-b .row{display:flex;align-items:center;gap:6px;margin:3px 0}
.dlp-b .row>span:first-child{min-width:54px;color:var(--fg2,#9a9a9a)}
.dlp-b input[type=number],.dlp-b input[type=text],.dlp-b select,.dlp-b textarea{background:var(--bg3,#2f2f2f);color:var(--fg,#d6d6d6);border:1px solid var(--line,#3a3a3a);border-radius:3px;padding:2px 4px;font-size:12px;min-width:0}
.dlp-b input[type=number]{width:58px}
.dlp-b input[type=range]{flex:1;min-width:60px}
.dlp-b button{background:var(--bg3,#2f2f2f);color:var(--fg,#d6d6d6);border:1px solid var(--line,#3a3a3a);border-radius:3px;padding:2px 6px;font-size:12px;cursor:pointer;margin:0;line-height:1.3}
.dlp-b button:hover:not(:disabled){background:var(--accent,#2f7fd8);color:#fff}
.dlp-b button:disabled{opacity:.4;cursor:default}
.dlp-b button.on{background:var(--accent,#2f7fd8);color:#fff}
.dlp-b .list{border:1px solid var(--line,#3a3a3a);border-radius:3px;background:var(--bg,#1e1e1e)}
.dlp-b .li{display:flex;align-items:center;gap:6px;padding:3px 6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dlp-b .li:hover{background:var(--bg3,#2f2f2f)} .dlp-b .li.on{background:var(--accent,#2f7fd8);color:#fff} .dlp-b .li.fut{color:#777}
.dlp-b .hic{width:18px;flex:0 0 18px;display:inline-flex;justify-content:center;opacity:.85} .dlp-b .hic svg{width:16px;height:16px} .dlp-b .hic-doc::before{content:'';width:10px;height:13px;border:1px solid currentColor;border-radius:1px} .dlp-b .hic-cmd::before{content:'';width:8px;height:8px;border:1px solid currentColor;opacity:.6}
.dlp-b .bar{display:flex;gap:4px;justify-content:flex-end;margin-top:6px;flex-wrap:wrap}
.dlp-b .grid{display:flex;flex-wrap:wrap;gap:3px}
.dlp-b .sw{width:16px;height:16px;border:1px solid #0006;cursor:pointer;box-sizing:border-box}
.dlp-b .sw:hover{outline:1px solid #fff}
.dlp-b .hint{color:var(--fg2,#9a9a9a);font-size:11px;margin:4px 0}
.dlp-b .sec{color:var(--fg2,#9a9a9a);font-size:11px;margin:8px 0 3px;border-top:1px solid var(--line,#3a3a3a);padding-top:5px}
.dlp-b .kv{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-variant-numeric:tabular-nums}
.dlp-b .kv b{color:var(--fg2,#9a9a9a);font-weight:normal}
.dlp-pop{position:fixed;z-index:2000;background:var(--bg3,#2f2f2f);border:1px solid var(--line,#3a3a3a);box-shadow:0 6px 18px #000a;padding:3px 0;font:12px sans-serif;color:var(--fg,#d6d6d6);min-width:150px;pointer-events:auto;max-height:70vh;overflow:auto}
.dlp-host .dlp-pop{z-index:2147483001}
.dlp-pi{padding:4px 14px;cursor:pointer;white-space:nowrap}.dlp-pi:hover{background:var(--accent,#2f7fd8);color:#fff}.dlp-pi.off{color:#777;cursor:default}.dlp-pi.off:hover{background:none;color:#777}
.dlp-sep{height:1px;background:var(--line,#3a3a3a);margin:3px 6px}
.dlp-dlg-back{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}
.dlp-dlg{background:#2b2f36;color:#e6e8ec;border:1px solid #444a55;border-radius:6px;padding:14px 16px;min-width:300px;max-width:520px;font:13px sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4)}
.dlp-dlg .t{font-weight:600;margin-bottom:10px}
.dlp-dlg label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0}
.dlp-dlg label.ck{justify-content:flex-start}
.dlp-dlg input[type=text],.dlp-dlg input[type=number],.dlp-dlg select{width:180px;background:#1d2026;color:#e6e8ec;border:1px solid #444a55;border-radius:3px;padding:3px 6px}
.dlp-dlg .note{color:#9aa3b0;font-size:12px;margin:4px 0 8px;line-height:1.5}
.dlp-dlg .msg{color:#ff8a7a;font-size:12px;min-height:14px}
.dlp-dlg .bar{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
.dlp-dlg button{background:#3a404b;color:#e6e8ec;border:1px solid #4a515e;border-radius:3px;padding:4px 14px;cursor:pointer}
.dlp-dlg button.pri{background:var(--accent,#2f7fd8);border-color:var(--accent,#2f7fd8);color:#fff}`;
function ensureStyle(doc){
  if (doc.getElementById('dlPanelsStyle')) return;
  const st = doc.createElement('style'); st.id = 'dlPanelsStyle'; st.textContent = CSS; (doc.head || doc.documentElement).appendChild(st);
}
/* 画板页里某支档注进 head 的 <style id> ⇒ 抄一份到外层（外层没有才抄） */
function copyStyle(doc, id){
  if (doc === document || doc.getElementById(id)) return;
  const src = document.getElementById(id); if (!src) return;
  const st = doc.createElement('style'); st.id = id; st.textContent = src.textContent; (doc.head || doc.documentElement).appendChild(st);
}
ensureStyle(document);

/* ── 接上界面：文件一改就刷面板；画一次画面刷 live 面板；上次开着的面板重开 ── */
function hook(){
  if (!window.UI || UI.__dlPanelsHook) return;
  UI.__dlPanelsHook = true;
  const r = UI.refresh;
  UI.refresh = function(){ const out = r.apply(this, arguments); P.schedule('doc'); return out; };
  // 只是滑鼠悬停（ui.js _hoverDraw）＝文件没变 ⇒ 只刷要跟游标走的信息面板，导航器／直方图不重算（免得卡顿）
  if (Array.isArray(UI.overlays)) UI.overlays.push(() => { if (UI._hoverDraw){ if (P.els.info) P.schedule('draw'); } else P.schedule('draw'); });
  // 停靠块（图层、颜色、工具栏、选项栏）照上次的显示状态；浮动面板照上次开着的重开
  const m = P._mem;
  setTimeout(() => {
    Object.keys(P.defs).forEach(id => {
      const d = P.defs[id];
      if (d.dock && m.dock && typeof m.dock[id] === 'boolean' && m.dock[id] !== P.isOpen(id)) d.dock.show(m.dock[id]);
      else if (!d.dock && m.open && m.open.includes(id) && !P.els[id]) P.open(id, {restore:true});
    });
  }, 0);
  // 锁定工作区（ps-window 在 body 上挂 dlp-locked）⇒ 面板跟着（面板可能在外层，吃不到画板页的 body 选择器）
  if (window.MutationObserver) new MutationObserver(() => Object.keys(P.els).forEach(id => P._applyKind(id))).observe(document.body, {attributes:true, attributeFilter:['class']});
}
if (window.UI && UI.canvas) hook();
else window.addEventListener('DOMContentLoaded', () => setTimeout(hook, 0));
window.addEventListener('resize', P._onHostResize);
/* 外层宿主：iframe 被藏起来（网站切到别页）⇒ 面板一起藏；iframe 卸掉 ⇒ 把外层图层收掉；宿主钩子后来才设 ⇒ 下一轮搬家 */
setInterval(() => {
  if (!Object.keys(P.els).length && !P._mounted.some(b => b.isConnected)) { if (P._parentLayer && P.host().mode === 'parent'){ /* 没有面板也留着图层，等下次开 */ } return; }
  P.syncHost();
  const h = P.host(), L = P._parentLayer;
  if (h.mode === 'parent' && h.frame && L){
    let vis = true;
    try { vis = h.frame.isConnected && h.frame.getClientRects().length > 0 && h.win.getComputedStyle(h.frame).visibility !== 'hidden'; } catch(e){}
    L.style.display = vis && !P._hostHidden ? '' : 'none';
  }
}, 500);
window.addEventListener('pagehide', () => P._dropParentLayer());
window.addEventListener('unload', () => P._dropParentLayer());

/* ── 面板分类（像素专用／向量专用／两种都行不标）；全表与理由见开发笔记 ──
   照原码：PS 里直接动像素或像素工具设定的面板＝像素专用；AI 里动选中路径物件外观／几何的面板＝向量专用；文件层级、颜色、文字、历史、导航类＝两种都行。 */
const KIND = {
  // PhotoCraft
  adjustments:'raster', brushSettings:'raster', channels:'raster', cloneSource:'raster', patterns:'raster', toolPresets:'raster',
  // VectorCraft
  aiAlign:'vector', aiAppearance:'vector', aiAssetExport:'vector', aiAttributes:'vector', aiBrushes:'vector', aiCss:'vector', aiGradient:'vector',
  aiGraphicStyles:'vector', aiStyleLib:'vector', aiMagicWand:'vector', aiPathfinder:'vector', aiPatternOptions:'vector', aiStroke:'vector',
  aiSymbols:'vector', aiTransform:'vector', aiTransparency:'vector'
};
Object.assign(P.kinds, KIND);
/* 视窗菜单项 ⇒ 面板 id（菜单树的 params.panel 是原码的面板键） */
const MENU_PANEL = {
  ps:{brushes:'brushSettings'},
  ai:{align:'aiAlign', appearance:'aiAppearance', assetExport:'aiAssetExport', attributes:'aiAttributes', brushes:'aiBrushes', cssProperties:'aiCss', gradient:'aiGradient',
      graphicStyles:'aiGraphicStyles', magicWand:'aiMagicWand', pathfinder:'aiPathfinder', patternOptions:'aiPatternOptions', stroke:'aiStroke', symbols:'aiSymbols',
      transform:'aiTransform', transparency:'aiTransparency'}
};
P.menuPanelId = (app, key) => (MENU_PANEL[app] && MENU_PANEL[app][key]) || key;
/* 菜单树打标：item.only（menubar.js 照它灰掉＋标字） */
function tagMenus(){
  if (!window.MenuTrees) return;
  ['ps', 'ai'].forEach(app => {
    const t = MenuTrees[app] && MenuTrees[app].window; if (!t) return;
    const go = items => items.forEach(it => {
      if (it.sub) go(it.sub);
      const im = it.impl; if (!im || typeof im !== 'object') return;
      let id = null;
      if (im.params && im.params.panel) id = P.menuPanelId(app, im.params.panel);
      else if (im.cmd === 'ai.window.graphicStyleLibrary') id = 'aiStyleLib';
      if (id && P.kinds[id]) it.only = P.kinds[id];
    });
    go(t.items);
  });
}
tagMenus();
P.tagMenus = tagMenus;

/* ── 命令（agent 与人同一条路） ── */
if (window.CMD){
  CMD.reg('panel.list', {i18n:'', params:'{} 列出所有可开关的面板 → {ok, panels:[{id, title, open, dock, only:"raster"|"vector"|null, usable}], kind:当前图层种类, host:"self"|"parent"}'}, () => ({ok:true, panels:P.list(), kind:P.kindOf(), host:P.hostMode()}));
  CMD.reg('panel.toggle', {i18n:'', params:'{id, on?: bool（缺省＝切换：开着就关、关着就开）} 开关一个面板（视窗菜单的面板项走这条）；像素专用／向量专用的面板在对不上的图层开不了 → {ok, id, open} 或 {ok:false, error, only}'}, p => {
    if (!P.has(p.id)) return {ok:false, error:`panel.toggle: no panel \`${p.id}\``};
    return {ok:true, id:p.id, open:P.toggle(p.id, p.on)};
  });
  CMD.reg('panel.state', {i18n:'', params:'{} 每个面板开着没有、能不能用（种类闸）、浮动面板的位置大小与放在哪份 document → {ok, panels:{id:{open, only, usable, rect?, off?, host?}}, kind, host}'}, () => ({ok:true, panels:P.state(), kind:P.kindOf(), host:P.hostMode()}));
  CMD.reg('panel.host', {i18n:'', params:'{mode?:"auto"|"parent"|"self"} 浮动面板放哪：auto／parent＝外层网页同源就放外层（可拖到 iframe 外、盖住对话框），self＝只在画板页里；不给＝只查 → {ok, mode:实际, pref}'}, p => {
    if (p.mode !== undefined){ if (!['auto', 'parent', 'self'].includes(p.mode)) return {ok:false, error:'panel.host: mode must be auto|parent|self'}; P._pref = p.mode; P.syncHost(); }
    return {ok:true, mode:P.syncHost().mode, pref:P.hostPref()};
  });
  /* 种类闸接到面板命令：开不了 ⇒ 回 ok:false 说清楚（人点菜单那条已经先灰掉） */
  const guard = id => {
    const c = CMD.map[id]; if (!c || c.__kindGuard) return;
    const run = c.run; c.__kindGuard = true;
    c.run = function(){ P.lastRefusal = null; const r = run.apply(this, arguments); const f = P.lastRefusal; P.lastRefusal = null;
      if (f && (!r || r.ok !== false)) return {ok:false, error:`${id}: panel \`${f.id}\` is ${f.only} only (${P.onlyLabel(f.only)}); the active layer is ${f.kind}`, only:f.only, kind:f.kind, panel:f.id};
      return r; };
  };
  P.guardCommands = () => Object.keys(CMD.map).forEach(id => { if (id === 'panel.toggle' || /^(ps|ai)\.window\.panel(\.|$)/.test(id)) guard(id); });
  P.guardCommands();
  window.addEventListener('DOMContentLoaded', () => { P.guardCommands(); tagMenus(); });
}
/* 宿主用：DilinCanvas.panels */
if (window.DilinCanvas){
  window.DilinCanvas.panels = {
    host:() => P.hostMode(),
    setHost(mode){ P._pref = mode; return P.syncHost().mode; },
    detach(){ P._pref = 'self'; P.syncHost(); P._dropParentLayer(); },
    /* 宿主自己决定藏／显（例：网站切到别的分页但 iframe 还在画面上）；外层图层与 iframe 里的面板一起 */
    setVisible(on){ P._hostHidden = !on; if (P._parentLayer) P._parentLayer.style.display = on ? '' : 'none'; Object.values(P.els).forEach(b => { if (b.ownerDocument === document) b.style.visibility = on ? '' : 'hidden'; }); return !!on; },
    /* 外层有 CSP（style-src 不给 'unsafe-inline'）时：宿主自己用带 nonce 的 <style id=…> 先放这几段（id 对上画板就不再注入） */
    css:() => { const o = {dlPanelsStyle:CSS}; const t = document.getElementById('pstypeCSS'); if (t) o.pstypeCSS = t.textContent; return o; },
    state:() => P.state()
  };
}
})();
