/* 堤麟画板 · 顶部菜单栏（照抄 Photoshop 2020／Illustrator 2020 的整排菜单）
   资料在 menus/<app>-<menu>.js，各自 MenuTrees.add('ps'|'ai', '<key>', {n:{三语}, items:[…]}) 登记（树从 ArtCraft 原码的菜单目录抽出，一项不删）。
   像素层／文字层 ⇒ Photoshop 的菜单；矢量层 ⇒ Illustrator 的（跟工具栏同一条规矩）。
   一项：{n:{'zh-Hant','zh-Hans',en}, id, key:'Ctrl+N', impl:'our.cmd'|{cmd,params}|null, sub:[…], check:true, radio:'group'}；{sep:true} 分隔线。
   impl 对到我们的命令就能点；null ⇒ 灰掉、懸停小牌标「未做」（点了不动）。
   给测试与 agent：Menubar.state、Menubar.open(key)、Menubar.close、Menubar.find(itemId)、Menubar.click(itemId)。 */

const MenuTrees = {
  ps: {}, ai: {},
  order: { ps: ['file', 'edit', 'image', 'layer', 'type', 'select', 'filter', '3d', 'view', 'plugins', 'window', 'help'],
           ai: ['file', 'edit', 'object', 'type', 'select', 'effect', 'view', 'window', 'help'] },
  add(app, key, tree){ (this[app] = this[app] || {})[key] = tree; },
  list(app){ return this.order[app].filter(k => this[app][k]).map(k => ({key:k, tree:this[app][k]})); },
  /* 走遍一棵树（含子菜单），cb(item, path) */
  walk(app, cb){
    const go = (items, path) => items.forEach(it => { cb(it, path); if (it.sub) go(it.sub, path.concat(it)); });
    this.list(app).forEach(({key, tree}) => go(tree.items, [key]));
  }
};
window.MenuTrees = MenuTrees;

const Menubar = {
  app: 'ps', kind: 'raster', openKey: null, _hoverTimer: null,

  build(kind){
    this.kind = kind || 'raster';
    this.app = this.kind === 'vector' ? 'ai' : 'ps';
    const bar = document.getElementById('menubar');
    bar.querySelectorAll('.mb').forEach(x => x.remove());
    const anchor = bar.querySelector('.spacer');
    MenuTrees.list(this.app).forEach(({key, tree}) => {
      const m = document.createElement('div');
      m.className = 'mb'; m.dataset.menu = key;
      m.innerHTML = `<span class="mbt">${this.name(tree)}</span>`;
      m.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault(); this.openKey === key ? this.close() : this.open(key); });
      m.addEventListener('mouseenter', () => { if (this.openKey && this.openKey !== key) this.open(key); });
      bar.insertBefore(m, anchor);
    });
    this.close();
  },
  name(x){ return (x.n && (x.n[Lang.cur] || x.n.en)) || x.id || ''; },
  enabled(it){ return !!it.impl && (typeof it.impl === 'string' ? !!CMD.map[it.impl] : !!CMD.map[it.impl.cmd]); },
  /* 图层种类闸：
     item.only = 'raster'|'vector'（面板分类表在 menus/impl/panels.js 的 KIND）。当前图层不是那种 ⇒ 灰掉、点了不动；有 only 的项后面一律标「像素专用／向量专用」，两种都行的不标。 */
  activeKind(){ try { const L = Doc.active(); return L ? L.kind : 'raster'; } catch(e){ return 'raster'; } },
  kindOK(it){ return !it.only || it.only === this.activeKind(); },
  usable(it){ return this.enabled(it) && this.kindOK(it); },
  onlyLabel(o){ return o === 'raster' ? Lang.t('ui.onlyRaster') : o === 'vector' ? Lang.t('ui.onlyVector') : ''; },

  /* 打开某个顶菜单（画它的下拉） */
  open(key){
    this.close();
    const tree = MenuTrees[this.app][key]; if (!tree) return;
    const m = document.querySelector(`#menubar .mb[data-menu="${key}"]`); if (!m) return;
    m.classList.add('open');
    const dd = this.panel(tree.items, 1);
    const r = m.getBoundingClientRect();
    dd.style.left = r.left + 'px'; dd.style.top = r.bottom + 'px';
    document.body.appendChild(dd);
    this.fit(dd);
    this.openKey = key;
    setTimeout(() => document.addEventListener('mousedown', this._outside, true), 0);
  },
  close(){
    document.querySelectorAll('.mbdd').forEach(x => x.remove());
    document.querySelectorAll('#menubar .mb.open').forEach(x => x.classList.remove('open'));
    this.openKey = null;
    document.removeEventListener('mousedown', this._outside, true);
  },
  _outside(e){ if (!(e.target.closest && (e.target.closest('.mbdd') || e.target.closest('#menubar .mb')))) Menubar.close(); },
  fit(dd){
    const r = dd.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 4){ dd.style.maxHeight = (window.innerHeight - r.top - 6) + 'px'; dd.style.overflowY = 'auto'; }
    if (r.right > window.innerWidth - 4) dd.style.left = Math.max(2, window.innerWidth - 4 - r.width) + 'px';
  },

  /* 一层下拉面板 */
  panel(items, level){
    const dd = document.createElement('div'); dd.className = 'mbdd'; dd.dataset.level = level;
    items.forEach(it => {
      if (it.sep){ const s = document.createElement('div'); s.className = 'mbsep'; dd.appendChild(s); return; }
      const row = document.createElement('div');
      const impl = this.enabled(it), kindOff = !it.sub && !!it.only && !this.kindOK(it);
      const on = (impl && !kindOff) || !!it.sub;
      row.className = 'mbi' + (on ? '' : ' off') + (kindOff ? ' kindoff' : '') + (it.sub ? ' has-sub' : '') + (it.header ? ' hdr' : '');
      if (it.only){ row.dataset.only = it.only; }
      row.dataset.item = it.id || (it.n && it.n.en) || '';   // 子菜单项原码常没 id ⇒ 用英文名当识别
      if (it.impl) row.dataset.impl = typeof it.impl === 'string' ? it.impl : it.impl.cmd;   // 测试照我们的命令找到那一项
      const mark = it.check ? (this.checked(it) ? '✓' : '') : it.radio ? (this.checked(it) ? '●' : '') : '';
      row.innerHTML = `<span class="mk">${mark}</span><span class="nm">${this.name(it)}</span>` +
        (it.only ? `<span class="only">${this.onlyLabel(it.only)}</span>` : '') +
        (it.sub ? '<span class="arr">▸</span>' : `<span class="kb">${it.key || ''}</span>`) +
        (impl || it.sub || it.header ? '' : `<span class="todo">${Lang.t('ui.tbTodo')}</span>`);
      if (kindOff) row.title = Lang.t(it.only === 'raster' ? 'ui.panelOffRaster' : 'ui.panelOffVector');
      if (it.sub){
        row.addEventListener('mouseenter', () => this.openSub(row, it, level));
      } else {
        row.addEventListener('mouseenter', () => this.closeSubsBelow(level));
        row.addEventListener('click', e => { e.stopPropagation(); if (on) this.run(it); });
      }
      dd.appendChild(row);
    });
    return dd;
  },
  openSub(row, it, level){
    this.closeSubsBelow(level);
    row.classList.add('open');
    const sub = this.panel(it.sub, level + 1);
    const r = row.getBoundingClientRect();
    sub.style.left = (r.right - 2) + 'px'; sub.style.top = (r.top - 4) + 'px';
    document.body.appendChild(sub);
    const sr = sub.getBoundingClientRect();
    if (sr.right > window.innerWidth - 4) sub.style.left = Math.max(2, r.left - sr.width + 2) + 'px';
    if (sr.bottom > window.innerHeight - 4) sub.style.top = Math.max(2, window.innerHeight - 4 - sr.height) + 'px';
  },
  closeSubsBelow(level){
    document.querySelectorAll('.mbdd').forEach(d => { if (+d.dataset.level > level) d.remove(); });
    document.querySelectorAll(`.mbdd[data-level="${level}"] .mbi.open`).forEach(x => x.classList.remove('open'));
  },
  checked(it){
    if (it.impl && typeof it.impl === 'object' && it.impl.checked) { try { return !!it.impl.checked(); } catch(e){ return false; } }
    if (it.id === 'view.screenMode.standard' || it.id === 'view.screenMode.normal') return window.Toolbar && Toolbar.screen === 'standard';
    return false;
  },
  run(it){
    this.close();
    const impl = it.impl; if (!impl) return;
    try {
      if (typeof impl === 'string') CMD.run(impl);
      else CMD.run(impl.cmd, impl.params);
    } catch(err){ console.error(err); }
    if (window.UI && UI.draw) UI.draw();
  },

  /* ── 给测试与 agent ── */
  find(itemId){
    let hit = null;
    MenuTrees.walk(this.app, (it, path) => { if (!hit && it.id === itemId) hit = {item:it, path}; });
    return hit;
  },
  click(itemId){ const f = this.find(itemId); if (!f) return false; if (!this.usable(f.item)) return false; this.run(f.item); return true; },
  /* 按我们的命令 id 找到第一个对到它的项：{item, path:[顶菜单 key, …父项]} */
  findImpl(cmd){
    let hit = null;
    MenuTrees.walk(this.app, (it, path) => { if (!hit && it.impl && (typeof it.impl === 'string' ? it.impl : it.impl.cmd) === cmd) hit = {item:it, path}; });
    return hit;
  },
  /* 测试用：对到某命令的项在菜单里的路径 [顶菜单 key, 父项识别…]（识别＝data-item） */
  pathTo(cmd){ const f = this.findImpl(cmd); return f ? [f.path[0], ...f.path.slice(1).map(p => p.id || (p.n && p.n.en) || '')] : null; },
  state(){
    const count = {};
    MenuTrees.list(this.app).forEach(({key, tree}) => {
      let n = 0, live = 0; const go = items => items.forEach(it => { if (it.sep || it.header) return; n++; if (this.enabled(it)) live++; if (it.sub) go(it.sub); }); go(tree.items);
      count[key] = {items:n, live};
    });
    return {app:this.app, kind:this.kind, open:this.openKey, menus:MenuTrees.order[this.app].filter(k => MenuTrees[this.app][k]), count};
  }
};
window.Menubar = Menubar;

/* 顶菜单的懸停小牌：没做的项停上去标「未做」（共用 toolbar 的 .tbtip 样式） */
document.addEventListener('mouseover', e => {
  const row = e.target.closest && e.target.closest('.mbi.off:not(.hdr)');
  const old = document.querySelector('.tbtip.mb'); if (old && (!row || old._for !== row)) old.remove();
  if (!row || (old && old._for === row)) return;
  const d = document.createElement('div'); d.className = 'tbtip mb'; d._for = row;
  d.innerHTML = `<b>${row.querySelector('.nm').textContent}</b>` + (row.classList.contains('kindoff') ? `<span class="todo">${row.title}</span>` : `<span class="todo">${Lang.t('ui.tbTodo')}</span>`);
  document.body.appendChild(d);
  const r = row.getBoundingClientRect(), tr = d.getBoundingClientRect();
  let x = r.right + 6; if (x + tr.width > window.innerWidth - 4) x = Math.max(4, r.left - tr.width - 6);
  d.style.left = x + 'px'; d.style.top = Math.max(4, Math.min(r.top, window.innerHeight - tr.height - 4)) + 'px';
});
document.addEventListener('mouseout', e => { const row = e.target.closest && e.target.closest('.mbi.off:not(.hdr)'); if (row){ const t = document.querySelector('.tbtip.mb'); if (t && t._for === row) t.remove(); } });
