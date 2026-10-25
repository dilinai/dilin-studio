/* 堤麟画板 · 左侧工具栏（照抄 PS / AI 的样子：一格一颗钮、小箭头弹出选单、长按／右键打开、同键轮换、底下前景背景色）
   版面在 toolbar-layout.js，图示在 icons.js；这里只管「画出来、点了怎么办、按键怎么切」。
   🔴 工具本体一颗一支档照旧（tools/*.js 的 Tools.reg）；这里把版面上的项对到那些 id。没做的工具照样摆钮、标「未做」、点了不动。

   给测试与 agent 的入口：
     UI.pick(toolId)          把某颗已做的工具翻到它那一格的表面并选中（＝人在小箭头选单里点它）
     Toolbar.choose(itemId)   选版面上任一项（含没做的：没做就只翻到表面不换工具）
     Toolbar.openFlyout(groupKey) / closeFlyout() / openDrawer() / closeDrawer()
     Toolbar.state()          {layout, cols, surfaced:{groupKey:itemId}, screen, fly, drawer}
   DOM：#toolbar .tb[data-slot][data-item][data-tool]（data-tool＝表面那项对到的工具 id，没对到就没有这个属性）
        .tbfly .tbfi[data-item]（弹出选单）  #tbdrawer .tbdi[data-item]（所有工具抽屉） */

const Toolbar = {
  layout:null, kind:'raster', cols:2, groups:[], cur:{}, screen:'standard', fillNone:false, strokeNone:false, activeSwatch:'fill',
  fly:null, flyKey:null, drawer:null, _press:null, _suppressClick:false,

  /* ── 建 ── */
  build(kind){
    this.kind = kind || 'raster';
    this.layout = TOOLBAR_LAYOUTS.forKind(this.kind);
    this.cols = +(localStorage.getItem('dlcanvas.tb.cols') || this.layout.cols || 2) === 1 ? 1 : 2;
    try { this.cur = JSON.parse(localStorage.getItem('dlcanvas.tb.' + this.layout.id + '.cur') || '{}') || {}; } catch(e){ this.cur = {}; }
    this.groups = this.layout.slots.map((s, i) => ({key:'s' + i, kind:'slot', items:s.items, gap:this.layout.gapAfter.includes(i)}));
    for (const w of this.layout.widgets){
      if (w === 'screen') this.groups.push({key:'screen', kind:'menu', items:this.layout.screen});
      else if (w === 'drawmode') this.groups.push({key:'drawmode', kind:'menu', items:this.layout.drawmode});
      else if (w === 'paintmode') this.groups.push({key:'paintmode', kind:'row', items:this.layout.paintmode});
      else if (w === 'quickmask') this.groups.push({key:'quickmask', kind:'slot', items:[this.layout.quickmask]});
      else if (w === 'more') this.groups.push({key:'more', kind:'slot', items:[this.layout.more]});
    }
    this.closeFlyout(); this.closeDrawer(); this.hideTip();
    const tb = document.getElementById('toolbar');
    tb.innerHTML = '';
    tb.dataset.layout = this.layout.id;
    tb.classList.toggle('cols1', this.cols === 1); tb.classList.toggle('cols2', this.cols === 2);

    const head = document.createElement('div'); head.className = 'tbhead';
    const tag = document.createElement('span'); tag.className = 'tbkind ' + this.kind;
    tag.textContent = Lang.t('layer.' + this.kind); tag.dataset.tip = Lang.t('ui.toolbarFollows');
    const colsBtn = document.createElement('span'); colsBtn.className = 'tbcols'; colsBtn.textContent = this.cols === 2 ? '«' : '»';
    colsBtn.dataset.tip = Lang.t('ui.tbCols');
    this.initTips(tb);
    colsBtn.onclick = () => { localStorage.setItem('dlcanvas.tb.cols', this.cols === 2 ? '1' : '2'); this.build(this.kind); this.sync(ToolState.cur); };
    head.appendChild(colsBtn); head.appendChild(tag); tb.appendChild(head);

    const grid = document.createElement('div'); grid.className = 'tbgrid'; tb.appendChild(grid);
    this.groups.filter(g => /^s\d+$/.test(g.key)).forEach(g => {          // 只放版面上的格子（'screen' 开头也是 s，别撈进来）
      grid.appendChild(this.button(g));
      if (g.gap){ const gap = document.createElement('div'); gap.className = 'tbgap'; grid.appendChild(gap); }
    });
    const wd = document.createElement('div'); wd.className = 'tbwidgets'; tb.appendChild(wd);
    for (const w of this.layout.widgets){
      if (w === 'colors') wd.appendChild(this.colorsWidget());
      else if (w === 'paintmode') wd.appendChild(this.paintRow());
      else { const g = this.groups.find(x => x.key === w); if (g) wd.appendChild(this.button(g)); }
    }
    this.refreshColors();
    this.sync(ToolState.cur);
  },

  /* 一格的钮 */
  button(g){
    const item = this.surfaced(g);
    const b = document.createElement('div');
    b.className = 'tb' + (g.kind === 'menu' ? ' tbmenu' : '') + (this.enabled(item) ? '' : ' todo');
    b.dataset.slot = g.key; b.dataset.item = item.id;
    if (item.impl && Tools.get(item.impl)) b.dataset.tool = item.impl; else delete b.dataset.tool;
    b.innerHTML = Icons.svg(item.icon) + (g.items.length > 1 ? '<i class="fly"></i>' : '');
    this.setTip(b, item);
    if (g.kind === 'menu'){ b.onclick = e => { e.stopPropagation(); this.flyKey === g.key ? this.closeFlyout() : this.openFlyout(g.key); }; return b; }
    b.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const r = b.getBoundingClientRect();
      if (g.items.length > 1 && e.clientX > r.right - 10 && e.clientY > r.bottom - 10){ this._suppressClick = true; this.openFlyout(g.key); return; }   // 点右下角小箭头
      this._suppressClick = false;
      this._press = setTimeout(() => { this._press = null; this._suppressClick = true; if (g.items.length > 1) this.openFlyout(g.key); }, 350);   // 长按
    });
    b.addEventListener('mouseup', () => { if (this._press){ clearTimeout(this._press); this._press = null; } });
    b.addEventListener('mouseleave', () => { if (this._press){ clearTimeout(this._press); this._press = null; } });
    b.addEventListener('contextmenu', e => { e.preventDefault(); if (g.items.length > 1) this.openFlyout(g.key); });
    b.addEventListener('click', e => {
      e.stopPropagation();
      if (this._suppressClick){ this._suppressClick = false; return; }
      this.closeFlyout();
      this.choose(this.surfaced(g).id, {user:true});
    });
    return b;
  },
  surfaced(g){ const i = this.cur[g.key] | 0; return g.items[i] || g.items[0]; },
  enabled(item){ if (!item || !item.impl) return false; if (Tools.get(item.impl)) return true; if (/^cmd:/.test(item.impl)) return !!CMD.map[item.impl.slice(4)]; return /^(drawer|screen:|paint:|draw:)/.test(item.impl); },
  name(item){ return item.n[Lang.cur] || item.n.en; },
  tip(item){ return this.name(item) + (item.key ? '  (' + item.key + ')' : '') + (this.enabled(item) ? '' : '  · ' + Lang.t('ui.tbTodo')); },
  /* 钮上挂提示资料（不用浏览器自带的 title：它慢半秒、样式也改不了）；滑鼠停上去由 initTips 画成 PS 式小牌「某某工具 (V)」 */
  setTip(el, item){
    el.removeAttribute('title');
    el.dataset.tip = this.name(item);
    if (item.key) el.dataset.tipKey = item.key; else delete el.dataset.tipKey;
    if (!this.enabled(item)) el.dataset.tipTodo = '1'; else delete el.dataset.tipTodo;
  },
  /* ── 懸停提示（滑鼠移上去显示工具名与快捷键）── 只挂一次在 #toolbar 上，钮重画也不丢 */
  _tipEl:null, _tipTimer:null, _tipFor:null,
  initTips(tb){
    if (tb._tipsOn) return; tb._tipsOn = true;
    const find = t => t && t.closest ? t.closest('#toolbar [data-tip]') : null;
    tb.addEventListener('mouseover', e => {
      const el = find(e.target); if (!el || el === this._tipFor) return;
      this.hideTip(); this._tipFor = el;
      this._tipTimer = setTimeout(() => { this._tipTimer = null; this.showTip(el); }, 280);
    });
    tb.addEventListener('mouseout', e => { const el = find(e.target); if (el && el === this._tipFor && !el.contains(e.relatedTarget)) this.hideTip(); });
    tb.addEventListener('mousedown', () => this.hideTip(), true);
    tb.addEventListener('wheel', () => this.hideTip(), {passive:true});
  },
  showTip(el){
    if (!document.body.contains(el)) return;
    const d = document.createElement('div'); d.className = 'tbtip';
    d.innerHTML = `<b>${el.dataset.tip}</b>` + (el.dataset.tipKey ? `<span class="k">(${el.dataset.tipKey})</span>` : '') + (el.dataset.tipTodo ? `<span class="todo">${Lang.t('ui.tbTodo')}</span>` : '');
    document.body.appendChild(d);
    const r = el.getBoundingClientRect(), tr = d.getBoundingClientRect();
    let x = r.right + 8, y = r.top + (r.height - tr.height) / 2;
    if (x + tr.width > window.innerWidth - 4) x = Math.max(4, r.left - tr.width - 8);
    y = Math.max(4, Math.min(y, window.innerHeight - tr.height - 4));
    d.style.left = x + 'px'; d.style.top = y + 'px';
    this._tipEl = d;
  },
  hideTip(){
    if (this._tipTimer){ clearTimeout(this._tipTimer); this._tipTimer = null; }
    if (this._tipEl){ this._tipEl.remove(); this._tipEl = null; }
    this._tipFor = null;
  },
  groupOf(itemId){ for (const g of this.groups){ const i = g.items.findIndex(x => x.id === itemId); if (i >= 0) return {g, i}; } return null; },
  findImpl(impl){
    // 先看表面已经是它的；再找 id 尾巴跟工具同名的（ai.star 而不是 ai.polygon）；最后任一项
    for (const g of this.groups){ const it = this.surfaced(g); if (it.impl === impl) return {g, i:g.items.indexOf(it)}; }
    for (const g of this.groups){ const i = g.items.findIndex(x => x.impl === impl && x.id.split('.')[1] === impl); if (i >= 0) return {g, i}; }
    for (const g of this.groups){ const i = g.items.findIndex(x => x.impl === impl); if (i >= 0) return {g, i}; }
    return null;
  },
  surface(g, i){
    this.cur[g.key] = i;
    localStorage.setItem('dlcanvas.tb.' + this.layout.id + '.cur', JSON.stringify(this.cur));
    const old = document.querySelector(`#toolbar .tb[data-slot="${g.key}"]`);
    if (old) old.replaceWith(this.button(g));
  },

  /* ── 选 ── */
  /* 选版面上的一项：翻到表面；对到工具就换工具（user:true 时顺手套它的选项，例如 PS 椭圆选框＝选框+ellipse） */
  choose(itemId, o){
    o = o || {};
    const f = this.groupOf(itemId); if (!f) return false;
    const item = f.g.items[f.i];
    if (f.g.kind !== 'row') this.surface(f.g, f.i);
    if (!item.impl) { this.sync(ToolState.cur); return false; }
    if (item.impl === 'drawer'){ this.openDrawer(); return true; }
    if (item.impl.startsWith('cmd:')){ if (!CMD.map[item.impl.slice(4)]) return false; CMD.run(item.impl.slice(4)); if (window.UI) UI.draw(); this.sync(ToolState.cur); return true; }   // 钮＝跑一条命令（快速蒙版 ⇒ ps.select.editInQuickMaskMode）
    if (item.impl.startsWith('screen:')){ this.screenMode(item.impl.slice(7)); return true; }
    if (item.impl.startsWith('paint:')){ this.paint(item.impl.slice(6)); return true; }
    if (item.impl.startsWith('draw:')){ this.sync(ToolState.cur); return true; }
    if (!Tools.get(item.impl)){ this.sync(ToolState.cur); return false; }
    UI.setTool(item.impl);
    if (o.user && item.set && CMD.map[item.set.cmd]) CMD.run(item.set.cmd, item.set.params);
    return true;
  },
  /* 测试与 agent：按工具 id 选（＝人在选单里点那一项，但不套选项） */
  pick(impl){
    const f = this.findImpl(impl);
    if (!f){ UI.setTool(impl); return false; }
    this.surface(f.g, f.i);
    UI.setTool(impl);
    return true;
  },
  /* UI.setTool 之后叫：把亮的那颗对上；工具在某格里但没翻到表面就翻过去 */
  sync(toolId){
    let hit = false;
    for (const g of this.groups){ if (this.surfaced(g).impl === toolId){ hit = true; break; } }
    if (!hit){ const f = this.findImpl(toolId); if (f) this.surface(f.g, f.i); }
    document.querySelectorAll('#toolbar .tb').forEach(b => b.classList.toggle('on', b.dataset.tool === toolId));
  },

  /* ── 小箭头弹出选单 ── */
  openFlyout(key){
    this.closeFlyout(); this.closeDrawer(); this.hideTip();
    const g = this.groups.find(x => x.key === key); if (!g) return;
    const btn = document.querySelector(`#toolbar .tb[data-slot="${key}"]`); if (!btn) return;
    const fly = document.createElement('div'); fly.className = 'tbfly' + (g.kind === 'menu' ? ' mn' : '');
    const surf = this.surfaced(g);
    g.items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'tbfi' + (this.enabled(item) ? '' : ' todo');
      row.dataset.item = item.id;
      const on = g.kind === 'menu' ? this.menuOn(g, item) : item === surf;
      row.innerHTML = `<span class="mark">${on ? (g.kind === 'menu' ? '✓' : '■') : ''}</span>${g.kind === 'menu' ? '' : Icons.svg(item.icon, 18)}<span class="nm">${this.name(item)}</span><span class="kb">${item.key ? (g.kind === 'menu' ? item.key : '(' + item.key + ')') : ''}</span>${this.enabled(item) ? '' : '<span class="todo">' + Lang.t('ui.tbTodo') + '</span>'}`;
      row.onclick = e => { e.stopPropagation(); this.closeFlyout(); this.choose(item.id, {user:true}); };
      fly.appendChild(row);
      if (g.key === 'screen' && this.layout.id === 'ai' && i === 0){ const s = document.createElement('div'); s.className = 'sep'; fly.appendChild(s); }
    });
    const r = btn.getBoundingClientRect();
    fly.style.left = (r.right + 2) + 'px'; fly.style.top = Math.max(2, Math.min(r.top, window.innerHeight - 40)) + 'px';
    document.body.appendChild(fly);
    const fr = fly.getBoundingClientRect();
    if (fr.bottom > window.innerHeight - 4) fly.style.top = Math.max(2, window.innerHeight - 4 - fr.height) + 'px';
    this.fly = fly; this.flyKey = key;
    btn.classList.add('open');
    setTimeout(() => document.addEventListener('mousedown', this._outside, true), 0);
  },
  closeFlyout(){
    if (this.fly){ this.fly.remove(); this.fly = null; }
    document.querySelectorAll('#toolbar .tb.open').forEach(b => b.classList.remove('open'));
    this.flyKey = null;
    document.removeEventListener('mousedown', this._outside, true);
  },
  _outside(e){
    if (Toolbar.fly && !Toolbar.fly.contains(e.target)) Toolbar.closeFlyout();
    if (Toolbar.drawer && !Toolbar.drawer.contains(e.target) && !(e.target.closest && e.target.closest('#toolbar'))) Toolbar.closeDrawer();
  },
  menuOn(g, item){
    if (g.key === 'screen') return item.impl === 'screen:' + this.screen;
    if (g.key === 'drawmode') return item.impl === 'draw:normal';
    return false;
  },

  /* ── 「所有工具」抽屉（⋯ 编辑工具栏） ── */
  openDrawer(){
    this.closeFlyout(); this.closeDrawer(); this.hideTip();
    const d = document.createElement('div'); d.id = 'tbdrawer';
    const h = document.createElement('div'); h.className = 'dh';
    h.innerHTML = `<span>${Lang.t('ui.tbAllTools')}</span><span class="x" title="Esc">×</span>`;
    h.querySelector('.x').onclick = () => this.closeDrawer();
    d.appendChild(h);
    const body = document.createElement('div'); body.className = 'db'; d.appendChild(body);
    const secs = this.layout.drawer;
    secs.forEach(sec => {
      const st = document.createElement('div'); st.className = 'ds';
      const nm = sec.n.split('|'); st.textContent = (Lang.cur === 'zh-Hant' ? nm[0] : Lang.cur === 'zh-Hans' ? nm[1] : nm[2]) + '：';
      body.appendChild(st);
      const slots = sec.slots === 'all' ? this.layout.slots.map((_, i) => i) : sec.slots;
      slots.forEach(si => {
        const g = this.groups[si]; if (!g) return;
        const box = document.createElement('div'); box.className = 'dg';
        g.items.forEach(item => {
          const row = document.createElement('div');
          row.className = 'tbdi' + (this.enabled(item) ? '' : ' todo') + (item.impl && item.impl === ToolState.cur ? ' on' : '');
          row.dataset.item = item.id;
          row.innerHTML = `${Icons.svg(item.icon, 18)}<span class="nm">${this.name(item)}</span><span class="kb">${item.key}</span>${this.enabled(item) ? '' : '<span class="todo">' + Lang.t('ui.tbTodo') + '</span>'}`;
          row.onclick = e => { e.stopPropagation(); if (this.choose(item.id, {user:true})) this.closeDrawer(); };
          box.appendChild(row);
        });
        body.appendChild(box);
      });
    });
    const tb = document.getElementById('toolbar').getBoundingClientRect();
    d.style.left = (tb.right + 2) + 'px'; d.style.top = tb.top + 'px'; d.style.maxHeight = (window.innerHeight - tb.top - 8) + 'px';
    document.body.appendChild(d);
    this.drawer = d;
    setTimeout(() => document.addEventListener('mousedown', this._outside, true), 0);
  },
  closeDrawer(){ if (this.drawer){ this.drawer.remove(); this.drawer = null; } },

  /* ── 键 ── 从 ui.js 的 keydown 叫；回 true＝吃掉了 */
  onKey(e){
    if (e.key === 'Escape'){ if (this.fly || this.drawer){ this.closeFlyout(); this.closeDrawer(); return true; } return false; }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key; if (k.length !== 1) return false;
    const low = k.toLowerCase();
    if (this.layout.widgets.includes('colors')){
      if (low === 'x' && !e.shiftKey){ this.swapColors(); return true; }            // PS/AI：X 互换前景背景
      if (low === 'x' && e.shiftKey && this.layout.id === 'ai'){ this.swapFillStroke(); return true; }   // AI：Shift+X 互换填色和描边（连选中物件）
      if (low === 'd' && !e.shiftKey){ this.defaultColors(); return true; }         // D 回预设色
    }
    const match = item => {
      if (!item.key) return false;
      const m = /^(Shift\+)?(.)$/.exec(item.key); if (!m) return false;
      const want = m[2], shift = !!m[1];
      if (/^[a-z]$/i.test(want)) return want.toLowerCase() === low && shift === !!e.shiftKey;   // 字母才比 Shift
      return want === k || (shift && want === k);                                             // 符号键不比（'+' 本来就要 Shift）
    };
    const cands = [];
    for (const g of this.groups){ if (g.kind === 'row') continue; g.items.forEach(item => { if (match(item) && this.enabled(item)) cands.push(item); }); }
    if (cands.length){
      let idx = -1;
      for (let i = 0; i < cands.length; i++){
        const it = cands[i], f = this.groupOf(it.id);
        if (it.impl && Tools.get(it.impl) && it.impl === ToolState.cur && this.surfaced(f.g) === it) idx = i;
        else if (it.impl && it.impl.startsWith('screen:') && it.impl === 'screen:' + this.screen) idx = i;
      }
      // PS：手上的工具不在这组 ⇒ 先选回那格表面的工具（上回从飞出选的那颗），不是固定跳组里第一颗；已在这组才轮换
      const top = idx < 0 ? cands.findIndex(it => { const f = this.groupOf(it.id); return f && this.surfaced(f.g) === it; }) : -1;
      const next = top >= 0 ? cands[top] : cands[(idx + 1) % cands.length];
      this.choose(next.id, {user:true});
      return true;
    }
    // 版面上没这个键（或对到的还没做）⇒ 退回各工具自己登记的键（只认这种层看得到的那几颗；字母比 Shift、符号不比）
    const T = toolsFor(this.kind).find(t => !t.sep && t.key && t.key.toLowerCase() === low && (/^[a-z]$/i.test(t.key) ? (!!t.shift === !!e.shiftKey) : true));
    if (T){ this.pick(T.id); return true; }
    return false;
  },

  /* ── 屏幕模式（PS：标准／带菜单栏全屏／全屏；AI 多一个演示文稿） ── */
  screenMode(m){
    this.screen = m;
    const full = m !== 'standard';
    try {
      if (full && !document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
      if (!full && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    } catch(e){}
    document.body.classList.toggle('tb-full', m === 'full' || m === 'presentation');
    document.body.classList.toggle('tb-present', m === 'presentation');
    this.sync(ToolState.cur);
  },

  /* ── 前景／背景色（＝我们的填色／描边色；PS 叫前景背景，AI 叫填色描边） ── */
  colorsWidget(){
    const box = document.createElement('div'); box.className = 'tbcolors ' + this.layout.id;
    const fgName = this.layout.id === 'ai' ? Lang.t('panel.fill') : Lang.t('ui.tbFg'), bgName = this.layout.id === 'ai' ? Lang.t('panel.stroke') : Lang.t('ui.tbBg');
    const ai = this.layout.id === 'ai';
    box.innerHTML = `<span class="swap" data-tip="${Lang.t(ai ? 'ui.tbSwapAI' : 'ui.tbSwap')}" data-tip-key="${ai ? 'Shift+X' : 'X'}">${Icons.svg('swap', 12)}</span>` +
      `<span class="fg" data-tip="${fgName}"></span><span class="bg" data-tip="${bgName}"></span>` +
      `<span class="dflt" data-tip="${Lang.t('ui.tbDefault')}" data-tip-key="D">${Icons.svg('default-colors', 12)}</span>`;
    box.querySelector('.swap').onclick = () => ai ? this.swapFillStroke() : this.swapColors();
    box.querySelector('.dflt').onclick = () => this.defaultColors();
    box.querySelector('.fg').onclick = () => { this.activeSwatch = 'fill'; this.fillNone = false; document.getElementById('fillColor').click(); this.refreshColors(); };
    box.querySelector('.bg').onclick = () => { this.activeSwatch = 'stroke'; document.getElementById('strokeColor').click(); this.refreshColors(); };
    return box;
  },
  refreshColors(){
    const box = document.querySelector('#toolbar .tbcolors'); if (!box) return;
    const f = document.getElementById('fillColor').value, s = document.getElementById('strokeColor').value;
    const fg = box.querySelector('.fg'), bg = box.querySelector('.bg');
    fg.style.background = this.fillNone ? '#fff' : f; fg.classList.toggle('none', this.fillNone); fg.classList.toggle('act', this.activeSwatch === 'fill');
    const sw = UI.strokeW();
    bg.style.background = s; bg.style.setProperty('--sc', s); bg.classList.toggle('none', sw <= 0 && this.layout.id === 'ai'); bg.classList.toggle('act', this.activeSwatch === 'stroke');
  },
  swapColors(){
    const a = document.getElementById('fillColor'), b = document.getElementById('strokeColor');
    const t = a.value; a.value = b.value; b.value = t;
    a.dispatchEvent(new Event('input')); b.dispatchEvent(new Event('input'));
    this.refreshColors();
  },
  /* AI 2020「互换填色和描边」（Shift+X、色块旁的弯箭头）：工具栏的填色↔描边（含「无」），有选中物件就连物件一起换（ai.paint.swap） */
  swapFillStroke(){
    const a = document.getElementById('fillColor'), b = document.getElementById('strokeColor'), w = document.getElementById('strokeW');
    const fNone = this.fillNone, sNone = UI.strokeW() <= 0, fv = a.value, sv = b.value;
    if (!sNone) this._lastStrokeW = UI.strokeW();
    a.value = sv; b.value = fv; a.dispatchEvent(new Event('input')); b.dispatchEvent(new Event('input'));
    this.fillNone = sNone;
    w.value = fNone ? 0 : (this._lastStrokeW || 1); w.dispatchEvent(new Event('input'));
    this.refreshColors();
    if (window.VecSel && VecSel.shapes.length && CMD.map['ai.paint.swap'] && !['shapebuilder', 'livepaint'].includes(ToolState.cur)){ CMD.run('ai.paint.swap', {}); if (window.UI) UI.draw(); }
  },
  defaultColors(){
    const a = document.getElementById('fillColor'), b = document.getElementById('strokeColor');
    a.value = '#000000'; b.value = '#ffffff'; this.fillNone = false;
    a.dispatchEvent(new Event('input')); b.dispatchEvent(new Event('input'));
    this.refreshColors();
  },
  paintRow(){
    const row = document.createElement('div'); row.className = 'tbpaint';
    const g = this.groups.find(x => x.key === 'paintmode');
    g.items.forEach(item => {
      const b = document.createElement('span'); b.className = 'pm' + (this.enabled(item) ? '' : ' todo'); b.dataset.item = item.id;
      b.innerHTML = Icons.svg(item.icon, 14); this.setTip(b, item);
      b.onclick = () => this.choose(item.id, {user:true});
      row.appendChild(b);
    });
    return row;
  },
  paint(mode){
    if (mode === 'gradient'){ if (CMD.map['gradient.edit']) CMD.run('gradient.edit', {}); if (window.UI) UI.draw(); return; }   // AI 的「渐变」小钮：选中物件变成预设白→黑渐变（tools/gradient.js）
    if (mode === 'none'){
      if (this.activeSwatch === 'stroke'){ const w = document.getElementById('strokeW'); w.value = 0; w.dispatchEvent(new Event('input')); }
      else this.fillNone = true;
    } else if (mode === 'color'){
      if (this.activeSwatch === 'stroke'){ const w = document.getElementById('strokeW'); if (+w.value <= 0){ w.value = 2; w.dispatchEvent(new Event('input')); } }
      else this.fillNone = false;
    }
    this.refreshColors();
    // AI：有选中物件时「颜色／无」直接套到选中的物件（例：全选 → 描边点「无」＝删掉所有描边）；形状生成器／实时上色在手上时只换要上的颜色
    if (this.layout && this.layout.id === 'ai' && (mode === 'none' || mode === 'color') && CMD.map['ai.paint.set'] && window.VecSel && VecSel.shapes.length
        && !['shapebuilder', 'livepaint'].includes(ToolState.cur)){
      const stroke = this.activeSwatch === 'stroke';
      const v = mode === 'none' ? 'none' : document.getElementById(stroke ? 'strokeColor' : 'fillColor').value;
      CMD.run('ai.paint.set', stroke ? (mode === 'none' ? {stroke:'none'} : {stroke:v, strokeWidth:UI.strokeW()}) : {fill:v});
      if (window.UI) UI.draw();
    }
  },

  state(){
    const surfaced = {}; this.groups.forEach(g => surfaced[g.key] = this.surfaced(g).id);
    return {layout:this.layout.id, kind:this.kind, cols:this.cols, surfaced, screen:this.screen, fly:this.flyKey, drawer:!!this.drawer, fillNone:this.fillNone, activeSwatch:this.activeSwatch};
  }
};

if (typeof Lang !== 'undefined') Lang.add({
  'zh-Hant':{'ui.tbTodo':'未做', 'ui.tbAllTools':'所有工具', 'ui.tbCols':'單欄／雙欄', 'ui.tbSwap':'切換前景和背景色', 'ui.tbSwapAI':'互換填色和筆畫', 'ui.tbDefault':'預設前景和背景色', 'ui.tbFg':'設定前景色', 'ui.tbBg':'設定背景色'},
  'zh-Hans':{'ui.tbTodo':'未做', 'ui.tbAllTools':'所有工具', 'ui.tbCols':'单栏／双栏', 'ui.tbSwap':'切换前景和背景色', 'ui.tbSwapAI':'互换填色和描边', 'ui.tbDefault':'默认前景和背景色', 'ui.tbFg':'设置前景色', 'ui.tbBg':'设置背景色'},
  'en':{'ui.tbTodo':'Not yet', 'ui.tbAllTools':'All Tools', 'ui.tbCols':'Single / double column', 'ui.tbSwap':'Switch Foreground and Background Colors', 'ui.tbSwapAI':'Swap Fill and Stroke', 'ui.tbDefault':'Default Foreground and Background Colors', 'ui.tbFg':'Set foreground color', 'ui.tbBg':'Set background color'}
});
/* 右栏的填色／描边改了 ⇒ 工具栏底下的色块跟着变 */
['fillColor', 'strokeColor', 'strokeW'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => { if (id === 'fillColor') Toolbar.fillNone = false; Toolbar.refreshColors(); });
});
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && Toolbar.screen !== 'standard') Toolbar.screenMode('standard'); });
window.Toolbar = Toolbar;
