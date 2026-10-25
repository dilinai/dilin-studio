/* 注释工具 note（PS「備註工具／注释工具」，跟吸管同一格 I）—— 逐段翻译自 ArtCraft photocraft 原码：
   ① ui-egui/src/analysis_ui.rs
        :290-309   Down：由上往下找按到的注释图示（rposition＝最后放的在最上面；图示是 16×20 屏幕像素、左上角＝注释位置）
                     按到 ⇒ 选它（注释面板显示它）、打开注释面板、记下抓取偏移准备拖；
                     没按到 ⇒ notes.add {x:取整, y:取整, author:选项栏作者, color:选项栏颜色} ⇒ 选新的那个、打开注释面板
        :310-317   Up：在拖 ⇒ to＝取整(放开点 − 偏移)；离原位置 ≥ 1 才 notes.set {index, x, y}（一步历史「Move Note」）
        :378-399   叠画：注释色的 16×20 圆角方块＋折角＋三条字线；选中的白框 2px
        :481-495   选项栏：作者（文字框）、颜色、「全部清除」（notes.delete {all:true}；没有注释灰掉）、开关注释面板钮
        :951-967   测试：作者 QA 点 (30,40) 加一个、面板打开且选中 0 → 从 (32,42) 拖到 (62,52) ⇒ 位置 (60,50)
   ② engine/src/notes_cmds.rs:55-141 notes.add／set／delete（每次一步历史；改位置时弹出框跟着平移；内容改了才更新修改日期）
      doc/src/analysis.rs:91-121 Note（预设颜色淡黄 (1,1,0.51)＝#ffff82）
   资料、命令本体、注释面板与画布上的图示：menus/impl/ps-window.js 已照上面翻好（Doc.notes、ps.notes.*、面板 notes、叠画）。
   本档只做工具手势与选项栏，改文件一律叫 ps.notes.*；作者／颜色跟注释面板「注释工具」那两格共用（PsWindow.notes）。
   本档登记 note.* 给 agent：note.click／note.gesture 跟人点／拖一下走同一支 press/release。 */
(function(){
const NoteTool = window.NoteTool = {
  drag: null,              // {i, off:[dx,dy]}（analysis_ui.rs Drag::Note）
  author: '', color: '#ffff82',   // ps-window.js 没载入时的后备（载入了就用 PsWindow.notes 那份）
  bar: null
};
const NOTE_W = 16, NOTE_H = 20;
const zoom = () => Math.max((window.UI && UI.zoom) || 1, 0.01);
const notes = () => Array.isArray(Doc.notes) ? Doc.notes : [];
const st = () => (window.PsWindow && PsWindow.notes) || NoteTool;     // 作者／颜色放哪
const has = id => !!CMD.map[id];
const run = (id, p) => has(id) ? CMD.run(id, p) : {ok:false, error:id + ' missing (menus/impl/ps-window.js not loaded)'};
const openPanel = () => { if (has('panel.toggle') && !(window.DlPanels && DlPanels.isOpen && DlPanels.isOpen('notes'))) CMD.run('panel.toggle', {id:'notes', on:true}); };
const panelOpen = () => !!(window.DlPanels && DlPanels.isOpen && DlPanels.isOpen('notes'));
const normColor = v => {
  if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (Array.isArray(v) && v.length >= 3){ const big = v.slice(0, 3).some(x => x > 1); return '#' + v.slice(0, 3).map(x => Math.round(Math.max(0, Math.min(255, big ? x : x * 255))).toString(16).padStart(2, '0')).join(''); }
  return null;
};

/* :292-293 由上往下找图示（16×20 屏幕像素） */
function hitNote(p){
  const z = zoom(), L = notes();
  for (let i = L.length - 1; i >= 0; i--){ const [x, y] = L[i].position; if (p[0] >= x && p[0] <= x + NOTE_W / z && p[1] >= y && p[1] <= y + NOTE_H / z) return i; }
  return -1;
}
/* :290-309 */
function press(p){
  const i = hitNote(p);
  if (i >= 0){
    if (has('ps.notes.select')) CMD.run('ps.notes.select', {index:i});
    openPanel();
    const q = notes()[i].position;
    NoteTool.drag = {i, off:[p[0] - q[0], p[1] - q[1]]};
    return {action:'select', index:i};
  }
  const s = st(), r = run('ps.notes.add', {x:Math.round(p[0]), y:Math.round(p[1]), author:s.author || '', color:s.color || '#ffff82'});
  if (r && r.ok !== false){ openPanel(); if (has('ps.notes.select')) CMD.run('ps.notes.select', {index:r.index}); }
  return {action:'add', index:r ? r.index : null, result:r};
}
/* :310-317 */
function release(p){
  const d = NoteTool.drag; NoteTool.drag = null; if (!d) return null;
  const n = notes()[d.i]; if (!n) return null;
  const to = [Math.round(p[0] - d.off[0]), Math.round(p[1] - d.off[1])];
  if (Math.hypot(n.position[0] - to[0], n.position[1] - to[1]) >= 1){ const r = run('ps.notes.set', {index:d.i, x:to[0], y:to[1]}); return {action:'move', index:d.i, to, result:r}; }
  return null;
}

/* ───────── 命令（agent 与滑鼠同一条路）───────── */
const pt2 = v => Array.isArray(v) && v.length >= 2 && isFinite(v[0]) && isFinite(v[1]) ? [+v[0], +v[1]] : null;
function withZoom(z, f){ const z0 = window.UI ? UI.zoom : 1; if (isFinite(z) && z > 0 && window.UI) UI.zoom = +z; try { return f(); } finally { if (window.UI) UI.zoom = z0; } }
CMD.reg('note.click', {i18n:'', params:'{x, y, zoom?:缩放=目前} 文件坐标；跟人用注释工具点一下一样：点在注释图示（16×20 屏幕像素）上＝选它并开注释面板；点空处＝在取整后的那点新建注释（作者／颜色用选项栏的），选它、开面板 → {ok, action, index}'}, p => {
  if (!isFinite(p.x) || !isFinite(p.y)) return {ok:false, error:'note.click: pass `x` and `y`'};
  return withZoom(p.zoom, () => { const at = [+p.x, +p.y], a = press(at); const m = release(at); return Object.assign({ok:true}, m || a); });
});
CMD.reg('note.gesture', {i18n:'', params:'{from:[x,y], to:[x,y], zoom?} 跟人按住拖一下一样：按在注释图示上＝拖着走，放开时搬到 取整(to − 抓取偏移)（动了 ≥1 才算，一步历史）；按在空处＝在 from 新建 → {ok, action, index, to?}'}, p => {
  const a = pt2(p.from), b = pt2(p.to) || a; if (!a) return {ok:false, error:'note.gesture: pass `from`: [x, y]'};
  return withZoom(p.zoom, () => { const r = press(a); const m = release(b); return Object.assign({ok:true}, m || r); });
});
CMD.reg('note.setOptions', {i18n:'', params:'{author?:str, color?:"#rrggbb"|[r,g,b]} 选项栏：新注释的作者与颜色（不进历史；跟注释面板「注释工具」那两格同一份）；{} 读回 → {ok, author, color}'}, p => {
  const s = st();
  if (typeof p.author === 'string') s.author = p.author;
  const c = normColor(p.color); if (c) s.color = c;
  if (window.UI && ToolState.cur === 'note') UI.buildOptions('note');
  if (window.DlPanels && DlPanels.refresh && panelOpen()) DlPanels.refresh('notes');
  return {ok:true, author:s.author || '', color:s.color || '#ffff82'};
});
CMD.reg('note.clearAll', {i18n:'', params:'{} 选项栏「全部清除」：删掉所有注释（一步历史）→ {ok, deleted}'}, () => {
  if (!notes().length) return {ok:false, error:'the document has no notes'};
  return run('ps.notes.delete', {all:true});
});
CMD.reg('note.togglePanel', {i18n:'', params:'{on?:bool} 选项栏的注释面板开关 → {ok, open}'}, p =>
  has('panel.toggle') ? CMD.run('panel.toggle', {id:'notes', on:typeof p.on === 'boolean' ? p.on : undefined}) : {ok:false, error:'panel.toggle missing'});

/* ───────── 工具 ───────── */
function refreshBar(){
  const b = NoteTool.bar; if (!b || !b.clear || !b.clear.isConnected) return;
  b.clear.disabled = !notes().length;
  if (b.panel) b.panel.classList.toggle('on', panelOpen());
}
Tools.reg({
  id:'note', icon:'🗒', group:'misc', order:23, for:'raster', opts:[],
  hint:'ui.noteHint', cursor:'crosshair',
  strings:{
    'zh-Hant':{ 'tool.note':'備註工具', 'opt.noteAuthor':'作者：', 'opt.noteColor':'顏色：', 'ui.noteClearAll':'全部清除', 'ui.notePanel':'顯示或隱藏備忘稿面板',
                'ui.noteHint':'按一下新增備忘稿 · 拖曳圖示可移動 · 在備忘稿面板寫內容' },
    'zh-Hans':{ 'tool.note':'注释工具', 'opt.noteAuthor':'作者：', 'opt.noteColor':'颜色：', 'ui.noteClearAll':'全部清除', 'ui.notePanel':'显示或隐藏注释面板',
                'ui.noteHint':'单击新建注释 · 拖图示可移动 · 在注释面板写内容' },
    'en':     { 'tool.note':'Note Tool', 'opt.noteAuthor':'Author:', 'opt.noteColor':'Color:', 'ui.noteClearAll':'Clear All', 'ui.notePanel':'Show or hide the Notes panel',
                'ui.noteHint':'Click to add a note · drag an icon to move it · type the text in the Notes panel' }
  },
  /* :481-495 */
  buildOptions(box, add){
    const s = st(), b = NoteTool.bar = {};
    const au = document.createElement('input'); au.type = 'text'; au.value = s.author || ''; au.style.width = '120px'; au.dataset.note = 'author';
    au.onchange = () => CMD.run('note.setOptions', {author:au.value});
    add('noteAuthor', au);
    const co = document.createElement('input'); co.type = 'color'; co.value = s.color || '#ffff82'; co.dataset.note = 'color';
    co.onchange = () => CMD.run('note.setOptions', {color:co.value});
    add('noteColor', co);
    b.clear = document.createElement('button'); b.clear.textContent = Lang.t('ui.noteClearAll'); b.clear.dataset.note = 'clearAll';
    b.clear.onclick = () => { CMD.run('note.clearAll', {}); refreshBar(); if (window.UI) UI.draw(); };
    box.appendChild(b.clear);
    b.panel = document.createElement('button'); b.panel.textContent = '🗨'; b.panel.title = Lang.t('ui.notePanel'); b.panel.dataset.note = 'panel';
    b.panel.onclick = () => { CMD.run('note.togglePanel', {}); refreshBar(); };
    box.appendChild(b.panel);
    refreshBar();
  },
  onDown(e, pt){ press(pt); refreshBar(); UI.draw(); },
  onUp(e, pt){ release(pt); refreshBar(); UI.draw(); },
  onDeactivate(){ NoteTool.drag = null; },
  drawOverlay(ctx, s){
    refreshBar();
    // 图示本身由 ps-window.js 的全局叠画画；拖着的时候在放开会落的位置画一个虚框（原码拖曳中不预览，我们加的提示）
    const d = NoteTool.drag, h = window.Pointer && Pointer.hover; if (!d || !h || !Pointer.down) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), x = Math.round(h[0] - d.off[0]) * s, y = Math.round(h[1] - d.off[1]) * s;
    ctx.save(); ctx.setLineDash([3 * dpr, 3 * dpr]); ctx.lineWidth = dpr; ctx.strokeStyle = '#000'; ctx.strokeRect(x, y, NOTE_W * dpr, NOTE_H * dpr);
    ctx.strokeStyle = '#fff'; ctx.lineDashOffset = 3 * dpr; ctx.strokeRect(x, y, NOTE_W * dpr, NOTE_H * dpr); ctx.restore();
  }
});
/* 注释面板开着（或 📌 放置模式）时，ps-window.js 的画布捕获监听看到手上是注释工具就让开（顺手关掉 📌）⇒ 按下照常交给这颗工具 */
})();
