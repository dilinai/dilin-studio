/* 堤麟画板 · AI 介面操作模式（AiUI）
   让 AI 像人一样操作画板介面：点工具钮或上方标签、拉开下拉选单、点选单项，也能缩放平移画面、截网页画面；
   走介面操作，人看得懂 AI 在做什么、随时能接手，也兼有示范教学的效果。
   背后另记滑鼠怎么点、键盘怎么按，人手与 agent 的操作分开记录 ⇒ 人操作一遍，AI 就能照纪录重做。
   截图可指定只看哪一块、放大几倍、叠座标格，细节才看得清。

   做法：AI 不直接改文件，而是在页面上放一颗看得见的 AI 游标，移过去、闪一下，再对那个元素发出跟滑鼠一样的事件
   （pointer／mouse／click／wheel／key）。界面自己照常反应：选单弹出、工具切换、对话框打开……全都跟人点的一样走同一条路。
   人手的事件 isTrusted＝true、AI 发的是 false ⇒ 两本纪录天然分得开；挡人手的罩（humanlock.js）只挡 isTrusted，AI 照点。

   命令（drawboard_run 就叫得到）：
     ui.inspect      列出画面上看得到、点得到的东西（ref、名字、种类、位置）＋视角资讯
     ui.click / ui.dblclick / ui.rightclick / ui.hover   target 见下
     ui.drag         {from, to | path:[…], steps}   画布上用 doc:[x,y]＝图上座标（不怕缩放平移）
     ui.wheel        {at, dy, dx, ctrl}             ctrl:true＝缩放
     ui.key          {key, ctrl, shift, alt, meta}  例：{key:'b'} 换画笔、{key:'z',ctrl:true} 还原
     ui.type         {target?, text, enter?}        往输入框打字
     ui.log          {who:'human'|'agent'|'all', last=50}   两本操作纪录（人／AI 分开）
     ui.log.clear    {who}
     ui.replay       {who='human', last?, ops?, speed=1}   照纪录（或给的 ops）用 AI 游标一步一步重做
     ui.cursor       {show, speed}
     preview.set     {mode:'doc'|'ui'|'region', rect:[x,y,w,h], scale, grid, sticky}
                     决定下一次 drawboard_preview 回什么：整份文件（原样）／整个网页介面截图／文件某一块放大（像素一格一格＋座标格）
   target：{ref:'e12'}（ui.inspect 给的）｜{text:'濾鏡'}（看得到的字）｜{selector:'css'}｜{at:[x,y]}（网页座标）｜{doc:[x,y]}（图上座标）｜纪录里的 loc 物件 */
(function(){
const AID = 4242;                                   // AI 游标的 pointerId（不跟真滑鼠撞）
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isVis = (el, loose) => {
  if (!el || !el.getBoundingClientRect || !el.isConnected) return false;
  const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
  if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return false;
  const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
  if (loose) return true;   // 被别的东西盖着也算（例：上一层子选单还开着；游标移过去它就会收起）
  const cx = clamp(r.left + r.width / 2, 0, innerWidth - 1), cy = clamp(r.top + r.height / 2, 0, innerHeight - 1);
  const top = document.elementFromPoint(cx, cy);
  return !top || top === el || el.contains(top) || top.contains(el) || !!(top.closest && top.closest('.dl-ai-cursor, .dl-overlay'));
};
const txt = s => (s || '').replace(/\s+/g, ' ').trim();

/* setPointerCapture 对合成的 pointerId 会丢错 ⇒ AI 发的那几下吞掉（拖动时我们自己一直对同一个元素发 move／up） */
const spc = Element.prototype.setPointerCapture, rpc = Element.prototype.releasePointerCapture;
Element.prototype.setPointerCapture = function(id){ if (id === AID) return; return spc.call(this, id); };
Element.prototype.releasePointerCapture = function(id){ if (id === AID) return; return rpc.call(this, id); };

const AiUI = window.AiUI = {
  speed: 1, show: true, pos: [innerWidth / 2, innerHeight / 2], refs: new Map(), seq: 0,
  logs: {human: [], agent: []}, LIMIT: 500, busy: 0,

  /* ── AI 游标 ── */
  cursor(){
    let c = this._cur; if (c && c.isConnected) return c;
    c = this._cur = document.createElement('div'); c.className = 'dl-ai-cursor';
    c.innerHTML = '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2l17 11.5h-8.2L6.4 23z" fill="#8b5cf6" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><span>AI</span>';
    document.body.appendChild(c); this.place(); return c;
  },
  place(){ const c = this.cursor(); c.style.transform = `translate(${this.pos[0]}px, ${this.pos[1]}px)`; c.style.display = this.show ? '' : 'none'; },
  /* 像人一样走选单：从顶菜单列出发先往下、从有子选单的那一列出发先往右——斜着走会滑过隔壁的顶菜单／别的列，把开着的选单换掉 */
  async moveTo(x, y){
    const [x0, y0] = this.pos, at = document.elementFromPoint(x0, y0);
    const mb = document.getElementById('menubar'), mbB = mb && mb.getBoundingClientRect().bottom;
    if (at && at.closest){
      if (at.closest('#menubar') && y > mbB && Math.abs(x - x0) > 4) await this.moveLine(x0, mbB + 6);
      else if (at.closest('.mbi.has-sub.open') && Math.abs(y - y0) > 4){ const r = at.closest('.mbi').getBoundingClientRect(); if (x > r.right) await this.moveLine(r.right + 8, y0); }
    }
    return this.moveLine(x, y);
  },
  async moveLine(x, y){
    const c = this.cursor(); c.classList.add('on'); clearTimeout(this._hide);
    const [x0, y0] = this.pos, d = Math.hypot(x - x0, y - y0);
    const ms = this.show ? clamp(d / 1.6, 120, 650) / this.speed : 0;
    if (ms > 4){
      const t0 = performance.now();
      await new Promise(done => { const step = () => {
        const k = Math.min(1, (performance.now() - t0) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        this.pos = [x0 + (x - x0) * e, y0 + (y - y0) * e]; this.place();
        const el = document.elementFromPoint(this.pos[0], this.pos[1]); if (el) this.fireMove(el, this.pos[0], this.pos[1], 0);
        k < 1 ? requestAnimationFrame(step) : done(); }; requestAnimationFrame(step); });
    }
    this.pos = [x, y]; this.place();
  },
  ripple(x, y, color){
    if (!this.show) return; const r = document.createElement('div'); r.className = 'dl-ai-ripple';
    r.style.left = x + 'px'; r.style.top = y + 'px'; if (color) r.style.borderColor = color;
    document.body.appendChild(r); setTimeout(() => r.remove(), 500);
  },
  idle(){ clearTimeout(this._hide); this._hide = setTimeout(() => this._cur && this._cur.classList.remove('on'), 4000); },

  /* ── 事件 ── */
  opts(x, y, o){ return Object.assign({bubbles:true, cancelable:true, composed:true, clientX:x, clientY:y, screenX:x, screenY:y, view:window,
    pointerId:AID, pointerType:'mouse', isPrimary:true, button:0, buttons:0}, o); },
  fire(el, type, x, y, o){
    const P = type.startsWith('pointer') ? PointerEvent : type === 'wheel' ? WheelEvent : MouseEvent;
    return el.dispatchEvent(new P(type, this.opts(x, y, o)));
  },
  fireMove(el, x, y, buttons){
    if (el !== this._over){
      const old = this._over; this._over = el;
      if (old && old.isConnected){ this.fire(old, 'pointerout', x, y, {buttons}); this.fire(old, 'mouseout', x, y, {buttons}); }
      this.fire(el, 'pointerover', x, y, {buttons}); this.fire(el, 'mouseover', x, y, {buttons});
      // mouseenter 不冒泡：沿祖先链补发（选单的子选单靠它展开）
      const chain = []; for (let a = el; a && a !== document; a = a.parentNode) if (!old || !a.contains || !a.contains(old)) chain.push(a);
      chain.reverse().forEach(a => { a.dispatchEvent(new PointerEvent('pointerenter', this.opts(x, y, {bubbles:false, buttons})));
        a.dispatchEvent(new MouseEvent('mouseenter', this.opts(x, y, {bubbles:false, buttons}))); });
    }
    this.fire(el, 'pointermove', x, y, {buttons}); this.fire(el, 'mousemove', x, y, {buttons});
  },

  /* ── 找目标 ── */
  // 旋转视图（rotateview.js）转过时 getBoundingClientRect 是外接框 ⇒ 改用 RotView 的转换（含翻转）
  docToPage(p){ if (window.RotView && RotView.angle) return RotView.toScreen(p);
    const c = UI.canvas.getBoundingClientRect(); const flip = /scaleX\(-1\)/.test(UI.canvas.style.transform || '');
    return [flip ? c.right - p[0] * UI.zoom : c.left + p[0] * UI.zoom, c.top + p[1] * UI.zoom]; },
  pageToDoc(x, y){ if (window.RotView && RotView.angle){ const d = RotView.toDoc(x, y); return [+d[0].toFixed(1), +d[1].toFixed(1)]; }
    const c = UI.canvas.getBoundingClientRect(); const flip = /scaleX\(-1\)/.test(UI.canvas.style.transform || '');
    return [+((flip ? c.right - x : x - c.left) / UI.zoom).toFixed(1), +((y - c.top) / UI.zoom).toFixed(1)]; },
  label(el){
    if (!el) return '';
    const d = el.dataset || {};
    let s = el.getAttribute && (el.getAttribute('aria-label') || d.tip || el.title);
    if (!s && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)){   // 输入框：label 元素 → 同一列旁边写的字（「半径」） → placeholder
      s = (el.labels && el.labels[0] && txt(el.labels[0].textContent)) || '';
      for (let a = el.parentElement, i = 0; !s && a && i < 3; a = a.parentElement, i++)
        s = txt([...a.childNodes].filter(n => n.nodeType === 3 || (n.nodeType === 1 && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(n.tagName) && !n.querySelector('input,select,textarea,button'))).map(n => n.textContent).join(' '));
      if (!s) s = el.placeholder || el.name || el.type;
      if (el.tagName !== 'SELECT') return s.slice(0, 60);
    }
    if (!s) s = txt(el.innerText || el.textContent);
    s = txt(s);
    if (el.classList && el.classList.contains('mbi')) s = s.replace(/\s*▸$/, '').replace(/\s+((Ctrl|Shift|Alt|Meta|⌘|⌥|⇧)[+＋].*|F\d+)$/, '');   // 选单项只留名字（快捷键另给）
    return s.slice(0, 60);
  },
  role(el){
    if (el.id === 'view') return 'canvas';
    if (el.closest('#menubar') && el.classList.contains('mb')) return 'menu';
    if (el.classList.contains('mbi')) return el.classList.contains('has-sub') ? 'submenu' : 'menuitem';
    if (el.closest('#toolbar') && el.classList.contains('tb')) return 'tool';
    if (el.classList.contains('lrow')) return 'layer';
    if (/tab/.test(el.className)) return 'tab';
    return ({INPUT:(el.type || 'input'), SELECT:'select', TEXTAREA:'textarea', BUTTON:'button', A:'link', LABEL:'label'})[el.tagName] || 'button';
  },
  SEL: 'button, input, select, textarea, a[href], [role=button], #menubar .mb, .mbi, #toolbar .tb, .tbfly [data-item], .lrow, [data-tab], [data-tip], .tbcols, label, #view',
  collect(){
    const out = [], seen = new Set();
    const push = el => { if (seen.has(el) || !isVis(el)) return; if (el.classList && el.classList.contains('mbsep')) return; seen.add(el); out.push(el); };
    document.querySelectorAll(this.SEL).forEach(push);
    // 其他看起来能点的（游标是手指）
    document.querySelectorAll('body *').forEach(el => { if (seen.has(el) || el.closest('.dl-ai-cursor')) return;
      if (getComputedStyle(el).cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer')) push(el); });
    return out;
  },
  refOf(el){ for (const [k, v] of this.refs) if (v === el) return k; const k = 'e' + (++this.seq); this.refs.set(k, el); return k; },
  inspect(p){
    p = p || {}; this.refs.clear(); this.seq = 0;
    const f = p.filter ? String(p.filter).toLowerCase() : '';
    const items = this.collect().map(el => {
      const r = el.getBoundingClientRect(), o = {ref:this.refOf(el), role:this.role(el), label:this.label(el), rect:[Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]};
      const st = [];
      if (el.classList.contains('on') || el.classList.contains('active') || el.getAttribute('aria-selected') === 'true') st.push('on');
      if (el.classList.contains('open')) st.push('open');
      if (el.classList.contains('off') || el.disabled) st.push('disabled');
      if (el.type === 'checkbox' || el.type === 'radio') st.push(el.checked ? 'checked' : 'unchecked');
      if (st.length) o.state = st.join(',');
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'checkbox') o.value = String(el.value).slice(0, 60);
      const d = el.dataset || {}; ['tool', 'item', 'menu', 'tab'].forEach(k => { if (d[k]) o[k] = d[k]; });
      if (el.classList.contains('mbi')){ const m = /((Ctrl|Shift|Alt|Meta|⌘|⌥|⇧)[+＋].*|F\d+)$/.exec(txt(el.innerText)); if (m) o.shortcut = m[1]; }
      return o;
    }).filter(o => !f || (o.label + ' ' + o.role + ' ' + (o.tool || '') + ' ' + (o.item || '') + ' ' + (o.menu || '')).toLowerCase().includes(f));
    const lim = p.limit || 300;
    const c = UI.canvas.getBoundingClientRect();
    return {count:items.length, items:items.slice(0, lim), truncated:items.length > lim,
      viewport:[innerWidth, innerHeight], cursor:this.pos.map(Math.round),
      view:{zoom:+UI.zoom.toFixed(4), canvasRect:[Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)], docSize:[Doc.width, Doc.height], tool:ToolState.cur, activeLayer:Doc.activeId,
        rotation:window.RotView ? RotView.angle : 0},   // 转过时 canvasRect 是外接框；画布上的位置一律用 {doc:[x,y]}
      openMenu:window.Menubar ? Menubar.openKey || null : null,
      hint:'用 ref 点（ui.click {target:{ref}}）；画布上点或拖用 {doc:[x,y]} 图上座标'};
  },
  resolve(t){
    if (!t) throw new Error('missing target');
    if (Array.isArray(t)) t = {at:t};
    if (t.doc){ const [x, y] = this.docToPage(t.doc); return {el:document.elementFromPoint(x, y) || UI.canvas, x, y}; }
    if (t.at){ const [x, y] = t.at; return {el:document.elementFromPoint(x, y) || document.body, x, y}; }
    let el = null;
    if (t.ref){ el = this.refs.get(t.ref); if (!el || !el.isConnected) throw new Error(`ref ${t.ref} is stale — call ui.inspect again`); }
    else if (t.selector){ const c = [...document.querySelectorAll(t.selector)]; el = c.find(e => isVis(e)) || c.find(e => isVis(e, true)) || null; }
    else el = this.findLoc(t);
    if (!el) throw new Error('target not found on screen: ' + JSON.stringify(t) + ' — call ui.inspect to see what is visible (a submenu may need ui.hover on its parent first)');
    const r = el.getBoundingClientRect();
    if (t.offset) return {el, x:r.left + t.offset[0], y:r.top + t.offset[1]};
    return {el, x:r.left + r.width / 2, y:r.top + r.height / 2};
  },
  /* 纪录里的 loc／{text}：先认资料属性（工具 id、选单 key、选单项 id、分页），再认看得到的字 */
  findLoc(t){
    const sel = [];
    if (t.id) sel.push('#' + CSS.escape(t.id));
    const d = t.data || {}; const keys = Object.keys(d);
    if (keys.length) sel.push(keys.map(k => `[data-${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}="${CSS.escape(String(d[k]))}"]`).join(''));
    for (const s of sel){ let c = [...document.querySelectorAll(s)].filter(e => isVis(e)); if (!c.length) c = [...document.querySelectorAll(s)].filter(e => isVis(e, true)); if (c.length === 1) return c[0];
      if (c.length > 1 && t.label){ const m = c.find(e => this.label(e) === t.label); if (m) return m; } if (c.length) return c[0]; }
    const want = txt(t.text || t.label || ''); if (!want) return null;
    // 开着的选单／对话框优先（人眼看的是最上面那层），其次才是工具栏、面板
    const rk = e => (e.closest('.mbdd') ? 2 : 0) + (t.role && this.role(e) === t.role ? 1 : 0);   // 开着的选单优先、同种类优先（「半径」的滑杆与数字框同名）
    const all = this.collect().sort((a, b) => rk(b) - rk(a)), lw = want.toLowerCase();
    return all.find(e => this.label(e) === want) || all.find(e => this.label(e).toLowerCase() === lw)
      || all.find(e => this.label(e).toLowerCase().startsWith(lw)) || all.find(e => this.label(e).toLowerCase().includes(lw)) || null;
  },
  loc(el){
    const pick = el.closest('[data-item],[data-tool],[data-menu],[data-tab],[id]:not(body):not(html),.mbi,.lrow,button,input,select,textarea,label,[data-tip],a') || el;
    const o = {label:this.label(pick)};
    if (pick.id && pick.id !== 'canvasWrap') o.id = pick.id;
    const d = {}; ['tool', 'item', 'menu', 'tab', 'slot'].forEach(k => { if (pick.dataset && pick.dataset[k]) d[k] = pick.dataset[k]; });
    if (Object.keys(d).length) o.data = d;
    o.role = this.role(pick);
    return o;
  },
  onCanvas(el){ return !!(el && el.closest && el.closest('#canvasWrap') && !el.closest('.dl-sb')); },

  /* ── 动作（AI 做的都记进 agent 那本） ── */
  rec(op){ op.t = Date.now(); this.logs.agent.push(op); if (this.logs.agent.length > this.LIMIT) this.logs.agent.shift(); },
  async click(p, kind){
    kind = kind || 'click';
    const {el, x, y} = this.resolve(p.target || p);
    this.busy++;
    try {
      await this.moveTo(x, y); this.fireMove(el, x, y, 0);
      const button = kind === 'rightclick' ? 2 : 0, buttons = button === 2 ? 2 : 1, n = kind === 'dblclick' ? 2 : 1;
      for (let i = 1; i <= n; i++){
        this.ripple(x, y, button === 2 ? '#f59e0b' : null);
        this.fire(el, 'pointerdown', x, y, {button, buttons, detail:i}); this.fire(el, 'mousedown', x, y, {button, buttons, detail:i});
        if (el.focus && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)) el.focus();
        await sleep(40 / this.speed);
        this.fire(el, 'pointerup', x, y, {button, detail:i}); this.fire(el, 'mouseup', x, y, {button, detail:i});
        if (button === 0) this.fire(el, 'click', x, y, {detail:i}); else this.fire(el, 'contextmenu', x, y, {button:2});
        if (i < n) await sleep(60 / this.speed);
      }
      if (n === 2) this.fire(el, 'dblclick', x, y, {detail:2});
      // 原生控件：点核取方块／单选会自己切（click 已发）；点下拉选单只会聚焦，要选值用 ui.type {value}
      const op = {op:kind, loc:this.onCanvas(el) ? {doc:this.pageToDoc(x, y)} : this.loc(el)};
      this.rec(op); await sleep(80 / this.speed);
      return {ok:true, clicked:op.loc, at:[Math.round(x), Math.round(y)]};
    } finally { this.busy--; this.idle(); }
  },
  async hover(p){
    const {el, x, y} = this.resolve(p.target || p); this.busy++;
    try { await this.moveTo(x, y); this.fireMove(el, x, y, 0); await sleep(120 / this.speed);
      const op = {op:'hover', loc:this.onCanvas(el) ? {doc:this.pageToDoc(x, y)} : this.loc(el)}; this.rec(op); return {ok:true, hovered:op.loc}; }
    finally { this.busy--; this.idle(); }
  },
  async drag(p){
    let pts = p.path ? p.path.map(q => this.resolve(q)) : [this.resolve(p.from), this.resolve(p.to)];
    const s = pts[0], el = s.el, steps = clamp(p.steps || 12, 2, 200), button = p.button || 0, buttons = button === 2 ? 2 : button === 1 ? 4 : 1;
    this.busy++;
    try {
      await this.moveTo(s.x, s.y); this.fireMove(el, s.x, s.y, 0); this.ripple(s.x, s.y);
      if (p.shift || p.alt || p.ctrl) this.keyEvt('keydown', p.shift ? 'Shift' : p.alt ? 'Alt' : 'Control', p);
      const mod = {shiftKey:!!p.shift, altKey:!!p.alt, ctrlKey:!!p.ctrl};
      this.fire(el, 'pointerdown', s.x, s.y, Object.assign({button, buttons}, mod)); this.fire(el, 'mousedown', s.x, s.y, Object.assign({button, buttons}, mod));
      const per = clamp(Math.round(steps / (pts.length - 1)), 1, 200), dt = (p.duration || 400) / Math.max(1, per * (pts.length - 1)) / this.speed;
      let last = s;
      for (let k = 1; k < pts.length; k++){
        const a = pts[k - 1], b = pts[k];
        for (let i = 1; i <= per; i++){
          const x = a.x + (b.x - a.x) * i / per, y = a.y + (b.y - a.y) * i / per;
          this.pos = [x, y]; this.place();
          this.fire(el, 'pointermove', x, y, Object.assign({buttons}, mod)); this.fire(el, 'mousemove', x, y, Object.assign({buttons}, mod));
          // 拖到别的元素上（拖放图层、选单滑过）也让底下那个知道
          const under = document.elementFromPoint(x, y); if (under && under !== el && !el.contains(under)){ this.fire(under, 'pointermove', x, y, {buttons}); this.fire(under, 'mousemove', x, y, {buttons}); }
          last = {x, y}; if (dt >= 1) await sleep(dt);
        }
      }
      this.fire(el, 'pointerup', last.x, last.y, Object.assign({button}, mod)); this.fire(el, 'mouseup', last.x, last.y, Object.assign({button}, mod));
      if (p.shift || p.alt || p.ctrl) this.keyEvt('keyup', p.shift ? 'Shift' : p.alt ? 'Alt' : 'Control', p);
      const canvas = this.onCanvas(el);
      const op = {op:'drag', from:canvas ? {doc:this.pageToDoc(s.x, s.y)} : this.loc(el),
        path:pts.slice(1).map(q => canvas ? {doc:this.pageToDoc(q.x, q.y)} : {at:[Math.round(q.x), Math.round(q.y)]})};
      if (button) op.button = button; ['shift', 'alt', 'ctrl'].forEach(k => { if (p[k]) op[k] = true; });
      this.rec(op); await sleep(80 / this.speed);
      return {ok:true, dragged:op};
    } finally { this.busy--; this.idle(); }
  },
  async wheel(p){
    const {el, x, y} = this.resolve(p.at ? {at:p.at} : p.doc ? {doc:p.doc} : p.target || {doc:[Doc.width / 2, Doc.height / 2]});
    this.busy++;
    try {
      await this.moveTo(x, y);
      const n = Math.max(1, Math.round(Math.abs(p.dy || p.dx || 100) / 100)), sy = Math.sign(p.dy || 0) * 100, sx = Math.sign(p.dx || 0) * 100;
      for (let i = 0; i < n; i++){ this.fire(el, 'wheel', x, y, {deltaY:sy, deltaX:sx, deltaMode:0, ctrlKey:!!p.ctrl, shiftKey:!!p.shift}); await sleep(50 / this.speed); }
      if (p.ctrl && UI._zoomTimer){ await sleep(160); }
      const op = {op:'wheel', loc:this.onCanvas(el) ? {doc:this.pageToDoc(x, y)} : this.loc(el), dy:(p.dy || 0), dx:(p.dx || 0)}; if (p.ctrl) op.ctrl = true;
      this.rec(op); return {ok:true, zoom:+UI.zoom.toFixed(4), center:HandView.center().map(v => +v.toFixed(1))};
    } finally { this.busy--; this.idle(); }
  },
  keyEvt(type, key, p){
    const tgt = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
    const code = key.length === 1 ? (/[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : /\d/.test(key) ? 'Digit' + key : '') : key;
    tgt.dispatchEvent(new KeyboardEvent(type, {key, code, bubbles:true, cancelable:true, ctrlKey:!!p.ctrl, shiftKey:!!p.shift, altKey:!!p.alt, metaKey:!!p.meta}));
  },
  async key(p){
    const key = String(p.key || ''); if (!key) throw new Error('ui.key: missing key');
    this.showKey(key, p); this.keyEvt('keydown', key, p); await sleep(40 / this.speed); this.keyEvt('keyup', key, p);
    const op = {op:'key', key}; ['ctrl', 'shift', 'alt', 'meta'].forEach(k => { if (p[k]) op[k] = true; }); this.rec(op);
    await sleep(60 / this.speed); return {ok:true, key:op};
  },
  showKey(key, p){
    if (!this.show) return; const b = document.createElement('div'); b.className = 'dl-ai-key';
    b.textContent = [p.ctrl && 'Ctrl', p.alt && 'Alt', p.shift && 'Shift', p.meta && 'Meta', key.length === 1 ? key.toUpperCase() : key].filter(Boolean).join(' + ');
    b.style.left = this.pos[0] + 18 + 'px'; b.style.top = this.pos[1] + 26 + 'px'; document.body.appendChild(b); setTimeout(() => b.remove(), 900);
  },
  async type(p){
    let el = document.activeElement;
    if (p.target){ const r = this.resolve(p.target); await this.click({target:{at:[r.x, r.y]}}); this.logs.agent.pop(); el = r.el; }
    if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.isContentEditable) throw new Error('ui.type: no input box focused — give target');
    const v = p.value !== undefined ? String(p.value) : String(p.text || '');
    if (el.isContentEditable){ el.focus(); document.execCommand('insertText', false, v); }
    else {
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, el.tagName === 'SELECT' || p.replace !== false ? v : el.value + v);
      el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true}));
    }
    if (p.enter) await this.key({key:'Enter'}), this.logs.agent.pop();
    const op = {op:'type', loc:this.loc(el), value:v}; if (p.enter) op.enter = true; this.rec(op);
    return {ok:true, typed:op};
  },

  /* ── 重播：纪录里的一步 ⇒ 对应动作 ── */
  async play(op){
    const t = o => o && (o.doc || o.at ? o : Object.assign({}, o));
    switch (op.op){
      case 'click': case 'dblclick': case 'rightclick': return this.click({target:t(op.loc)}, op.op);
      case 'hover': return this.hover({target:t(op.loc)});
      case 'drag': return this.drag({path:[t(op.from)].concat(op.path), button:op.button, shift:op.shift, alt:op.alt, ctrl:op.ctrl, duration:op.duration});
      case 'wheel': return this.wheel(Object.assign({target:t(op.loc)}, {dy:op.dy, dx:op.dx, ctrl:op.ctrl}, op.loc && op.loc.doc ? {doc:op.loc.doc} : {}));
      case 'key': return this.key(op);
      case 'type': return this.type({target:op.loc, value:op.value, enter:op.enter});
      default: throw new Error('unknown op ' + op.op);
    }
  },
  async replay(p){
    p = p || {}; const src = p.ops || (this.logs[p.who || 'human'] || []).slice(p.last ? -p.last : 0);
    const ops = src.map(o => JSON.parse(JSON.stringify(o))); const sp = this.speed; if (p.speed) this.speed = p.speed;
    const done = [];
    try {
      for (let i = 0; i < ops.length; i++){
        try { const r = await this.play(ops[i]); done.push({step:i, op:ops[i].op, ok:true}); if (r && r.ok === false) throw new Error(r.error || 'failed'); }
        catch (err){ return {ok:false, done:done.length, total:ops.length, failedAt:i, op:ops[i], error:String(err.message || err)}; }
        await sleep((p.gap || 150) / this.speed);
      }
      return {ok:true, done:done.length, total:ops.length};
    } finally { this.speed = sp; }
  },

  /* ── 人手纪录（只收 isTrusted 的；合成手势：点／双击／右键／拖／滚轮／按键／打字／滑过有子选单的项） ── */
  hpush(op){ op.t = Date.now(); const L = this.logs.human; L.push(op); if (L.length > this.LIMIT) L.shift(); },
  hookHuman(){
    const H = this, opt = {capture:true, passive:true};
    let g = null, wheelOp = null, wheelAt = 0;
    const mods = (e, o) => { if (e.shiftKey) o.shift = true; if (e.altKey) o.alt = true; if (e.ctrlKey || e.metaKey) o.ctrl = true; return o; };
    addEventListener('pointerdown', e => { if (!e.isTrusted || e.target.closest('.dl-ai-cursor')) return;
      g = {el:e.target, x:e.clientX, y:e.clientY, button:e.button, canvas:H.onCanvas(e.target), path:[], last:0, e}; }, opt);
    addEventListener('pointermove', e => { if (!e.isTrusted) return;
      if (!g){ const row = e.target.closest && e.target.closest('.mbi.has-sub'); if (row && row !== H._hrow){ H._hrow = row; H.hpush({op:'hover', loc:H.loc(row)}); } else if (!row) H._hrow = null; return; }
      if (e.timeStamp - g.last < 16) return; g.last = e.timeStamp;
      g.path.push(g.canvas ? {doc:H.pageToDoc(e.clientX, e.clientY)} : {at:[Math.round(e.clientX), Math.round(e.clientY)]}); }, opt);
    addEventListener('pointerup', e => { if (!e.isTrusted || !g) return;
      const moved = Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4, loc = g.canvas ? {doc:H.pageToDoc(g.x, g.y)} : H.loc(g.el);
      if (moved){ const end = g.canvas ? {doc:H.pageToDoc(e.clientX, e.clientY)} : {at:[Math.round(e.clientX), Math.round(e.clientY)]};
        const path = g.path.filter((q, i) => i % Math.max(1, Math.ceil(g.path.length / 60)) === 0).concat([end]);
        const op = {op:'drag', from:loc, path, duration:Math.round(e.timeStamp - g.e.timeStamp)}; if (g.button) op.button = g.button; H.hpush(mods(g.e, op)); }
      else {
        const L = H.logs.human, prev = L[L.length - 1], kind = g.button === 2 ? 'rightclick' : 'click';
        if (kind === 'click' && prev && prev.op === 'click' && Date.now() - prev.t < 400 && JSON.stringify(prev.loc) === JSON.stringify(loc)){ prev.op = 'dblclick'; prev.t = Date.now(); }
        else H.hpush(mods(g.e, {op:kind, loc}));
      }
      g = null; }, opt);
    addEventListener('wheel', e => { if (!e.isTrusted) return;
      const canvas = H.onCanvas(e.target), loc = canvas ? {doc:H.pageToDoc(e.clientX, e.clientY)} : H.loc(e.target), ctrl = e.ctrlKey || e.metaKey;
      if (wheelOp && e.timeStamp - wheelAt < 350 && wheelOp.ctrl === (ctrl || undefined)){ wheelOp.dy += Math.sign(e.deltaY) * 100; wheelOp.dx += Math.sign(e.deltaX) * 100; }
      else { wheelOp = {op:'wheel', loc, dy:Math.sign(e.deltaY) * 100, dx:Math.sign(e.deltaX) * 100}; if (ctrl) wheelOp.ctrl = true; H.hpush(wheelOp); }
      wheelAt = e.timeStamp; }, opt);
    addEventListener('keydown', e => { if (!e.isTrusted || /^(Shift|Control|Alt|Meta)$/.test(e.key)) return;
      const t = e.target, typing = t && (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable);
      if (typing && !(e.ctrlKey || e.metaKey || e.altKey) && e.key !== 'Enter' && e.key !== 'Escape') return;   // 字由 change 收
      H.hpush(mods(e, {op:'key', key:e.key})); }, opt);
    addEventListener('change', e => { if (!e.isTrusted) return; const t = e.target;
      if (!t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.type === 'checkbox' || t.type === 'radio') return;
      H.hpush({op:'type', loc:H.loc(t), value:String(t.value)}); }, opt);
  },

  /* ── 截图 ── */
  /* 整个网页介面画成一张图：各元素的底色／框线、画布（含叠画层）、SVG 图示、文字、AI 游标。不是浏览器真截屏，但看得到的东西都在原位 */
  async screenshot(maxSize){
    const W = innerWidth, H = innerHeight, k = Math.min(1, (maxSize || 1600) / Math.max(W, H)) * Math.min(devicePixelRatio || 1, 2);
    const cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(H * k);
    const g = cv.getContext('2d'); g.scale(k, k);
    g.fillStyle = getComputedStyle(document.body).backgroundColor || '#1e1e1e'; g.fillRect(0, 0, W, H);
    const clipOf = el => { let r = [0, 0, W, H];
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement){ const cs = getComputedStyle(a);
        if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible'){ const b = a.getBoundingClientRect();
          r = [Math.max(r[0], b.left), Math.max(r[1], b.top), Math.min(r[2], b.right), Math.min(r[3], b.bottom)]; } }
      return r; };
    const alpha = c => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return 0; const v = m[1].split(/[ ,\/]+/).filter(Boolean); return v.length > 3 ? +v[3] : 1; };
    const svgJobs = [];
    const walk = el => {
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return;
      if (el.classList && el.classList.contains('dl-ai-cursor')) return;
      const r = el.getBoundingClientRect(), cl = clipOf(el);
      const inView = r.width > 0 && r.height > 0 && r.right > cl[0] && r.bottom > cl[1] && r.left < cl[2] && r.top < cl[3];
      if (inView){
        g.save(); g.beginPath(); g.rect(cl[0], cl[1], cl[2] - cl[0], cl[3] - cl[1]); g.clip();
        g.globalAlpha = +cs.opacity || 1;
        if (alpha(cs.backgroundColor) > 0){ g.fillStyle = cs.backgroundColor; g.fillRect(r.left, r.top, r.width, r.height); }
        const bw = parseFloat(cs.borderTopWidth) || 0;
        if (bw > 0 && alpha(cs.borderTopColor) > 0){ g.strokeStyle = cs.borderTopColor; g.lineWidth = bw; g.strokeRect(r.left + bw / 2, r.top + bw / 2, r.width - bw, r.height - bw); }
        else { [['Bottom', 0, r.height, r.width, 0], ['Right', r.width, 0, 0, r.height], ['Left', 0, 0, 0, r.height]].forEach(([s, x, y, w, h]) => {
          const w2 = parseFloat(cs['border' + s + 'Width']) || 0; if (w2 > 0 && alpha(cs['border' + s + 'Color']) > 0){ g.fillStyle = cs['border' + s + 'Color'];
            g.fillRect(r.left + x - (w ? 0 : w2 * (x ? 1 : 0)), r.top + y - (h ? 0 : w2 * (y ? 1 : 0)), w || w2, h || w2); } }); }
        if (el.id === 'view'){ for (let yy = 0; yy < r.height; yy += 8) for (let xx = 0; xx < r.width; xx += 8){ g.fillStyle = ((xx + yy) / 8) % 2 ? '#2a2a2a' : '#232323'; g.fillRect(r.left + xx, r.top + yy, Math.min(8, r.width - xx), Math.min(8, r.height - yy)); } }   // 透明处棋盘格（CSS 背景画不出来）
        if (el.tagName === 'CANVAS'){ try { g.imageSmoothingEnabled = cs.imageRendering !== 'pixelated'; g.drawImage(el, r.left, r.top, r.width, r.height); } catch(e){} }
        else if (el.tagName === 'IMG' && el.complete){ try { g.drawImage(el, r.left, r.top, r.width, r.height); } catch(e){} }
        else if (el.tagName === 'svg' || el.tagName === 'SVG'){ svgJobs.push({el, r, cl, color:cs.color, op:g.globalAlpha}); }
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'range' && el.type !== 'color'){
          const v = el.tagName === 'SELECT' ? ((el.options[el.selectedIndex] || {}).text || '') : el.value || el.placeholder || '';
          g.fillStyle = el.value ? cs.color : '#888'; g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; g.textBaseline = 'middle';
          g.fillText(v, r.left + (parseFloat(cs.paddingLeft) || 3), r.top + r.height / 2, Math.max(4, r.width - 6)); }
        if (el.type === 'checkbox' || el.type === 'radio'){ g.strokeStyle = '#aaa'; g.lineWidth = 1; g.strokeRect(r.left + .5, r.top + .5, r.width - 1, r.height - 1);
          if (el.checked){ g.fillStyle = '#2f7fd8'; g.fillRect(r.left + 3, r.top + 3, r.width - 6, r.height - 6); } }
        if (el.type === 'color'){ g.fillStyle = el.value; g.fillRect(r.left + 2, r.top + 2, r.width - 4, r.height - 4); }
        // 文字（直接子文字节点）
        for (const n of el.childNodes){
          if (n.nodeType !== 3 || !n.textContent.trim()) continue;
          const rg = document.createRange(); rg.selectNodeContents(n); const rects = rg.getClientRects();
          g.fillStyle = cs.color; g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; g.textBaseline = 'alphabetic';
          if (rects.length <= 1){ const b = rects[0]; if (b) g.fillText(txt(n.textContent), b.left, b.bottom - (b.height - parseFloat(cs.fontSize)) / 2 - parseFloat(cs.fontSize) * .18); }
          else { const words = n.textContent.split(/(\s+)/); let off = 0;
            for (const w of words){ if (w.trim()){ const wr = document.createRange(); wr.setStart(n, off); wr.setEnd(n, off + w.length); const b = wr.getBoundingClientRect();
              g.fillText(w, b.left, b.bottom - (b.height - parseFloat(cs.fontSize)) / 2 - parseFloat(cs.fontSize) * .18); } off += w.length; } }
        }
        g.restore();
      }
      if (el.tagName === 'CANVAS' || el.tagName === 'svg' || el.tagName === 'SVG') return;
      for (const c of el.children) walk(c);
    };
    walk(document.body);
    await Promise.all(svgJobs.map(j => new Promise(done => {
      const c = j.el.cloneNode(true); c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); c.setAttribute('width', j.r.width); c.setAttribute('height', j.r.height);
      if (!c.getAttribute('viewBox') && j.el.viewBox && j.el.viewBox.baseVal && j.el.viewBox.baseVal.width) { const v = j.el.viewBox.baseVal; c.setAttribute('viewBox', `${v.x} ${v.y} ${v.width} ${v.height}`); }
      c.style.color = j.color;
      const s = new XMLSerializer().serializeToString(c).replace(/currentColor/g, j.color);
      const img = new Image(); img.onload = () => { g.save(); g.beginPath(); g.rect(j.cl[0], j.cl[1], j.cl[2] - j.cl[0], j.cl[3] - j.cl[1]); g.clip(); g.globalAlpha = j.op; g.drawImage(img, j.r.left, j.r.top, j.r.width, j.r.height); g.restore(); done(); };
      img.onerror = () => done(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
    })));
    // AI 游标
    if (this._cur && this._cur.isConnected){ const [x, y] = this.pos; g.fillStyle = '#8b5cf6'; g.strokeStyle = '#fff'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(x + 2, y + 2); g.lineTo(x + 19, y + 13.5); g.lineTo(x + 10.8, y + 13.5); g.lineTo(x + 6.4, y + 23); g.closePath(); g.fill(); g.stroke(); }
    return {dataURL:cv.toDataURL('image/png'), width:cv.width, height:cv.height, mode:'ui', viewport:[W, H], scale:+k.toFixed(4),
      note:'网页介面截图（座标＝网页座标×scale）；要知道每颗钮的 ref 用 ui.inspect'};
  },
  /* 文件某一块放大：像素一格一格（最近邻）、可叠像素格与图上座标刻度 */
  region(p, maxSize){
    const r = (p.rect || [0, 0, Doc.width, Doc.height]).map(Math.round);
    const x0 = clamp(r[0], 0, Doc.width - 1), y0 = clamp(r[1], 0, Doc.height - 1), w = clamp(r[2], 1, Doc.width - x0), h = clamp(r[3], 1, Doc.height - y0);
    const lim = maxSize || 1600, s = Math.max(1, Math.min(p.scale || Math.floor(lim / Math.max(w, h)) || 1, 64, Math.floor(lim / Math.max(w, h)) || 1));
    const src = composite(1), gut = p.grid === false ? 0 : 28;
    const cv = document.createElement('canvas'); cv.width = w * s + gut; cv.height = h * s + gut;
    const g = cv.getContext('2d'); g.fillStyle = '#202020'; g.fillRect(0, 0, cv.width, cv.height);
    // 透明处棋盘格
    for (let yy = 0; yy < h * s; yy += 8) for (let xx = 0; xx < w * s; xx += 8){ g.fillStyle = ((xx + yy) / 8) % 2 ? '#bbb' : '#eee'; g.fillRect(gut + xx, gut + yy, 8, 8); }
    g.imageSmoothingEnabled = false; g.drawImage(src, x0, y0, w, h, gut, gut, w * s, h * s);
    if (gut){
      if (s >= 6){ g.beginPath(); for (let i = 0; i <= w; i++){ g.moveTo(gut + i * s + .5, gut); g.lineTo(gut + i * s + .5, gut + h * s); }
        for (let j = 0; j <= h; j++){ g.moveTo(gut, gut + j * s + .5); g.lineTo(gut + w * s, gut + j * s + .5); } g.strokeStyle = 'rgba(128,128,128,.45)'; g.lineWidth = 1; g.stroke(); }
      const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find(v => v * s >= 44) || 1000;
      g.fillStyle = '#ddd'; g.font = '10px monospace'; g.strokeStyle = '#ff4d4d'; g.lineWidth = 1;
      for (let x = Math.ceil(x0 / step) * step; x <= x0 + w; x += step){ const X = gut + (x - x0) * s; g.fillText(String(x), X + 2, 11); g.beginPath(); g.moveTo(X + .5, 14); g.lineTo(X + .5, gut); g.stroke(); }
      for (let y = Math.ceil(y0 / step) * step; y <= y0 + h; y += step){ const Y = gut + (y - y0) * s; g.save(); g.translate(11, Y + 2); g.rotate(Math.PI / 2); g.fillText(String(y), 0, 0); g.restore();
        g.beginPath(); g.moveTo(14, Y + .5); g.lineTo(gut, Y + .5); g.stroke(); }
    }
    return {dataURL:cv.toDataURL('image/png'), width:cv.width, height:cv.height, mode:'region', rect:[x0, y0, w, h], scale:s, gutter:gut,
      note:`图上座标 = (${x0} + (像素x − ${gut}) / ${s}, ${y0} + (像素y − ${gut}) / ${s})；上、左边是图上座标刻度`};
  }
};

/* ── 命令 ── */
const reg = (id, params, fn) => CMD.reg(id, {i18n:'', params, undoable:false}, fn);
const T = '{target:{ref}|{text}|{selector}|{at:[x,y]} 网页座标|{doc:[x,y]} 图上座标}';
reg('ui.inspect', '{filter?, limit=300} 列出画面上看得到、点得到的东西：ref／role（menu 顶选单、menuitem、submenu、tool 工具钮、layer 图层列、tab、button、input…）／label／rect（网页座标）／state；另回视角（倍率、画布位置、文件大小、当前工具）', p => AiUI.inspect(p));
reg('ui.click', T + ' AI 游标移过去点一下（跟滑鼠一样：顶选单会弹出、选单项会执行、工具会切换）。画布上点用 {doc:[x,y]}', p => AiUI.click(p, 'click'));
reg('ui.dblclick', T + ' 双击', p => AiUI.click(p, 'dblclick'));
reg('ui.rightclick', T + ' 右键', p => AiUI.click(p, 'rightclick'));
reg('ui.hover', T + ' 游标移过去停住（展开子选单、看提示）', p => AiUI.hover(p));
reg('ui.drag', '{from:target, to:target} 或 {path:[target…]}, steps=12, duration=400ms, button?, shift?, alt?, ctrl? 按住拖（画笔一笔、拉选框、拖锚点、拖滑杆）；画布上用 {doc:[x,y]}', p => AiUI.drag(p));
reg('ui.wheel', '{doc:[x,y]|at:[x,y]|target, dy=±100/格, dx?, ctrl?} 滚轮；ctrl:true＝绕该点缩放，否则平移画面', p => AiUI.wheel(p));
reg('ui.key', '{key, ctrl?, shift?, alt?, meta?} 按一个键（工具快捷键、Ctrl+Z、Enter、Escape…）', p => AiUI.key(p));
reg('ui.type', '{target?, text|value, enter?, replace=true} 往输入框／下拉选单填值（会发 input、change）', p => AiUI.type(p));
reg('ui.log', '{who:"human"|"agent"|"all"="all", last=50} 操作纪录：人手与 AI 分两本；每步 {op, loc|from+path, key, value, t}，画布上的位置是图上座标', p => {
  const n = (p && p.last) || 50, w = (p && p.who) || 'all', pick = k => AiUI.logs[k].slice(-n);
  return w === 'all' ? {human:pick('human'), agent:pick('agent')} : {[w]:pick(w)};
});
reg('ui.log.clear', '{who:"human"|"agent"|"all"="all"}', p => { const w = (p && p.who) || 'all'; (w === 'all' ? ['human', 'agent'] : [w]).forEach(k => AiUI.logs[k].length = 0); return {ok:true}; });
reg('ui.replay', '{who="human", last?, ops?:[…], speed=1, gap=150ms} 照纪录（或自己给的 ops，格式同 ui.log）用 AI 游标一步步重做；失败停在那步并回 failedAt', p => AiUI.replay(p));
reg('ui.cursor', '{show?, speed?} AI 游标显示与速度（speed 2＝两倍快；show:false＝不画游标、不等动画）', p => {
  if (p && p.show !== undefined) AiUI.show = !!p.show; if (p && p.speed) AiUI.speed = clamp(+p.speed, .25, 20); AiUI.place(); return {show:AiUI.show, speed:AiUI.speed};
});
reg('ui.screenshot', '{maxSize=1600} 整个网页介面截图（dataURL）；要用眼睛看请改用 preview.set {mode:"ui"} 再 drawboard_preview', p => AiUI.screenshot(p && p.maxSize));
reg('preview.set', '{mode:"doc"|"ui"|"region", rect:[x,y,w,h]（region 用·图上座标）, scale?（1..64·不给就放到最大）, grid=true, sticky=false} 决定下一次 drawboard_preview 回什么：doc＝整份文件（原样）；ui＝整个网页介面截图（看得到选单、对话框、AI 游标）；region＝文件某一块放大、像素一格一格、带座标刻度。sticky:false 只管下一次', p => {
  p = p || {}; const m = p.mode || 'doc'; if (!['doc', 'ui', 'region'].includes(m)) return {ok:false, error:'mode: doc|ui|region'};
  AiUI.previewMode = m === 'doc' ? null : Object.assign({}, p, {mode:m}); return {ok:true, mode:m, sticky:!!p.sticky};
});
// drawboard_preview 走 doc.renderPreview：有 preview.set 就换成介面截图／放大块
const base = CMD.map['doc.renderPreview'];
if (base){ const run0 = base.run; base.run = p => {
  const m = AiUI.previewMode; if (!m) return run0(p);
  if (!m.sticky) AiUI.previewMode = null;
  return m.mode === 'ui' ? AiUI.screenshot((p && p.maxSize) || 1600) : AiUI.region(m, (p && p.maxSize) || 1600);
}; }

AiUI.hookHuman();
})();
