/* 计数工具 count（PS「計算工具／计数工具」，跟吸管同一格 I）—— 逐段翻译自 ArtCraft photocraft 原码：
   ① ui-egui/src/analysis_ui.rs
        :200-202   tolerance＝7 屏幕像素／缩放
        :270-282   Down：找最近的可见标记（:323-334 nearest_marker，所有可见组、容差内最近的）
                     有命中＋Alt ⇒ count.remove {group,index}；有命中 ⇒ 记下要拖它（组、序号、按下点）；
                     没命中且没按 Alt ⇒ count.add {x,y}（不取整，原样的文件坐标）；没命中＋Alt ⇒ 什么也不做
        :283-289   Up：在拖标记、且放开点离按下点 > 0.5 ⇒ count.move {group,index,to:[放开点]}（拖曳中不预览，放开才搬）
        :367-377   叠画：可见组的每个标记＝组色实心圆（半径 1＋标记大小）＋右上方编号（字级＝标签大小）
        :438-480   选项栏：「计数：n」（全部组加总）、计数组下拉（count.setGroup {group, active:true}）、眼睛（显示／隐藏该组）、
                   组颜色、删除组（count.deleteGroup）、新建组（count.newGroup）、「清除」（count.clear，有标记才叫）、
                   标记大小 1–10、标签大小 8–72（count.setGroup {markerSize, labelSize}）
        :930-948   测试：点两下加两个 → 拖第一个到 (30,25) → Alt 点第二个删掉
      ui-egui/src/workspace_ui.rs:512-525（「修改键」面板锁住 Alt 时点标记也是删除——我们没有那个面板，不抄）
   ② engine/src/analysis_cmds.rs:668-847 count.add／remove／move／clear／newGroup／deleteGroup／setGroup（每次改一步历史「Count」…）
      doc/src/analysis.rs:41-58 CountGroup {name, color, markerSize 1, labelSize 8, visible, points}
   资料与命令本体：menus/impl/ps-image.js 已照 analysis_cmds.rs 翻好 Doc.measurement.countGroups 与 ps.count.*（含历史），
   标记的叠画也是那边画（一直显示）；本档只做工具手势与选项栏，改文件一律叫 ps.count.*。
   本档登记 count.* 工具层命令给 agent：count.click／count.gesture 跟人点／拖一下走同一支 press/release。 */
(function(){
const CountTool = window.CountTool = {
  drag: null,              // {g, i, from:[x,y]}（analysis_ui.rs Drag::Count）
  bar: null
};
const zoom = () => Math.max((window.UI && UI.zoom) || 1, 0.01);
const tolerance = () => 7 / zoom();
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const meas = () => Doc.measurement || {};
const groups = () => meas().countGroups || [];
const activeIdx = () => Math.min(meas().activeCountGroup || 0, Math.max(groups().length - 1, 0));
const total = () => groups().reduce((a, g) => a + g.points.length, 0);
const has = id => !!CMD.map[id];
const run = (id, p) => has(id) ? CMD.run(id, p) : {ok:false, error:id + ' missing (menus/impl/ps-image.js not loaded)'};
const hex = c => '#' + c.slice(0, 3).map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');

/* :323-334 nearest_marker：只看可见组；容差内最近的 */
function nearest(at, tol){
  let best = null;
  groups().forEach((g, gi) => { if (!g.visible) return; g.points.forEach((q, pi) => { const d = dist(q, at); if (d <= tol && (!best || d < best[0])) best = [d, gi, pi]; }); });
  return best ? [best[1], best[2]] : null;
}
/* :270-282 */
function press(p, mods){
  const hit = nearest(p, tolerance());
  if (hit && mods.alt){ const r = run('ps.count.remove', {group:hit[0], index:hit[1]}); return {action:'remove', group:hit[0], index:hit[1], result:r}; }
  if (hit){ CountTool.drag = {g:hit[0], i:hit[1], from:[p[0], p[1]]}; return {action:'grab', group:hit[0], index:hit[1]}; }
  if (!mods.alt){ const r = run('ps.count.add', {x:p[0], y:p[1]}); return {action:'add', result:r}; }
  return {action:'none'};
}
/* :283-289 */
function release(p){
  const d = CountTool.drag; CountTool.drag = null;
  if (d && dist(d.from, p) > 0.5){ const r = run('ps.count.move', {group:d.g, index:d.i, to:[p[0], p[1]]}); return {action:'move', group:d.g, index:d.i, result:r}; }
  return null;
}

/* ───────── 命令（agent 与滑鼠同一条路）───────── */
const pt2 = v => Array.isArray(v) && v.length >= 2 && isFinite(v[0]) && isFinite(v[1]) ? [+v[0], +v[1]] : null;
function withZoom(z, f){ const z0 = window.UI ? UI.zoom : 1; if (isFinite(z) && z > 0 && window.UI) UI.zoom = +z; try { return f(); } finally { if (window.UI) UI.zoom = z0; } }
CMD.reg('count.click', {i18n:'', params:'{x, y, alt?:bool, zoom?:缩放=目前} 文件坐标；跟人用计数工具点一下一样：点在可见标记 7 屏幕像素内＋Alt＝删掉它；点空处＝在目前那组加一个（没有组会先建「计数组 1」）；空处＋Alt＝不动作 → {ok, action, …}'}, p => {
  if (!isFinite(p.x) || !isFinite(p.y)) return {ok:false, error:'count.click: pass `x` and `y`'};
  return withZoom(p.zoom, () => { const at = [+p.x, +p.y], a = press(at, {alt:!!p.alt}); const m = release(at); return Object.assign({ok:true}, m || a); });
});
CMD.reg('count.gesture', {i18n:'', params:'{from:[x,y], to:[x,y], alt?:bool, zoom?} 跟人按住拖一下一样：按在标记上＝拖到 to 放开（离按下点 > 0.5 才搬，一步历史）；按在空处＝在 from 加一个 → {ok, action, …}'}, p => {
  const a = pt2(p.from), b = pt2(p.to) || a; if (!a) return {ok:false, error:'count.gesture: pass `from`: [x, y]'};
  return withZoom(p.zoom, () => { const r = press(a, {alt:!!p.alt}); const m = release(b); return Object.assign({ok:true}, m || r); });
});
CMD.reg('count.info', {i18n:'', params:'{} 选项栏读数：总数、目前那组、各组 → 同 ps.image.analysis.countTool'}, () => run('ps.image.analysis.countTool', {}));

/* ───────── 工具 ───────── */
function el(tag, props, kids){ const e = document.createElement(tag); Object.assign(e, props || {}); (kids || []).forEach(k => e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k)); return e; }
function rebuild(){ if (window.UI && ToolState.cur === 'count') UI.buildOptions('count'); }
function refreshBar(){
  const b = CountTool.bar; if (!b || !b.total || !b.total.isConnected) return;
  const sig = JSON.stringify([groups().map(g => [g.name, g.visible, g.color, g.markerSize, g.labelSize]), activeIdx()]);
  if (sig !== b.sig){ rebuild(); return; }                       // 组变了（undo、菜单面板改的）⇒ 整排重做
  b.total.textContent = Lang.t('ui.countTotal').replace('{n}', total());
  if (b.clear) b.clear.disabled = !total();
}
Tools.reg({
  id:'count', icon:'①', group:'misc', order:24, for:'raster', opts:[],
  hint:'ui.countHint',
  strings:{
    'zh-Hant':{ 'tool.count':'計算工具', 'ui.countTotal':'計數：{n}', 'ui.countVisible':'切換計數組可見度', 'ui.countDelGroup':'刪除計數組', 'ui.countNewGroup':'建立新的計數組',
                'ui.countClear':'清除', 'opt.countMarker':'標記大小', 'opt.countLabel':'標籤大小', 'ui.countColor':'計數組顏色',
                'ui.countHint':'按一下加計數標記 · 拖標記可移動 · Alt＋按一下標記刪除' },
    'zh-Hans':{ 'tool.count':'计数工具', 'ui.countTotal':'计数：{n}', 'ui.countVisible':'切换计数组可见性', 'ui.countDelGroup':'删除计数组', 'ui.countNewGroup':'创建新的计数组',
                'ui.countClear':'清除', 'opt.countMarker':'标记大小', 'opt.countLabel':'标签大小', 'ui.countColor':'计数组颜色',
                'ui.countHint':'单击加计数标记 · 拖标记可移动 · Alt＋单击标记删除' },
    'en':     { 'tool.count':'Count Tool', 'ui.countTotal':'Count: {n}', 'ui.countVisible':'Toggle count group visibility', 'ui.countDelGroup':'Delete count group', 'ui.countNewGroup':'Create a new count group',
                'ui.countClear':'Clear', 'opt.countMarker':'Marker Size', 'opt.countLabel':'Label Size', 'ui.countColor':'Count group color',
                'ui.countHint':'Click to add a count marker · drag a marker to move it · Alt-click a marker to remove it' }
  },
  /* :438-480 选项栏 */
  buildOptions(box){
    const gs = groups(), gi = activeIdx(), g = gs[gi];
    const b = CountTool.bar = {sig:JSON.stringify([gs.map(x => [x.name, x.visible, x.color, x.markerSize, x.labelSize]), gi])};
    b.total = el('span', {textContent:Lang.t('ui.countTotal').replace('{n}', total())}); b.total.dataset.count = 'total'; box.appendChild(b.total);
    const after = () => { rebuild(); if (window.UI) UI.draw(); };
    if (gs.length){
      const sel = el('select'); sel.dataset.count = 'group';
      gs.forEach((x, i) => { const o = el('option', {value:i, textContent:x.name}); if (i === gi) o.selected = true; sel.appendChild(o); });
      sel.onchange = () => { run('ps.count.setGroup', {group:+sel.value, active:true}); after(); };
      box.appendChild(sel);
      const eye = el('button', {textContent:g.visible ? '👁' : '◌', title:Lang.t('ui.countVisible')}); eye.dataset.count = 'visible';
      eye.onclick = () => { run('ps.count.setGroup', {group:gi, visible:!g.visible}); after(); };
      const col = el('input', {type:'color', value:hex(g.color), title:Lang.t('ui.countColor')}); col.dataset.count = 'color';
      col.onchange = () => { run('ps.count.setGroup', {group:gi, color:col.value}); after(); };
      const del = el('button', {textContent:'🗑', title:Lang.t('ui.countDelGroup')}); del.dataset.count = 'deleteGroup';
      del.onclick = () => { run('ps.count.deleteGroup', {group:gi}); after(); };
      box.appendChild(eye); box.appendChild(col); box.appendChild(del);
    }
    const nw = el('button', {textContent:'＋', title:Lang.t('ui.countNewGroup')}); nw.dataset.count = 'newGroup';
    nw.onclick = () => { run('ps.count.newGroup', {}); after(); }; box.appendChild(nw);
    b.clear = el('button', {textContent:Lang.t('ui.countClear')}); b.clear.dataset.count = 'clear'; b.clear.disabled = !total();
    b.clear.onclick = () => { if (total() > 0) run('ps.count.clear', {}); after(); }; box.appendChild(b.clear);
    if (g){
      const num = (key, v, lo, hi, k) => {
        const l = el('label'), t = el('span', {textContent:Lang.t('opt.' + key)}), n = el('input', {type:'number', min:lo, max:hi, step:1, value:v}); n.style.width = '46px'; n.dataset.count = k;
        n.onchange = () => { const x = Math.round(+n.value); if (!isFinite(x)) return; run('ps.count.setGroup', {[k]:Math.max(lo, Math.min(hi, x))}); after(); };
        l.appendChild(t); l.appendChild(n); box.appendChild(l);
      };
      num('countMarker', g.markerSize, 1, 10, 'markerSize');
      num('countLabel', g.labelSize, 8, 72, 'labelSize');
    }
  },
  onDown(e, pt){ press(pt, {alt:e.altKey}); refreshBar(); UI.draw(); },
  onUp(e, pt){ release(pt); refreshBar(); UI.draw(); },
  onDeactivate(){ CountTool.drag = null; },
  drawOverlay(){ refreshBar(); }               // 标记本身由 ps-image.js 的全局叠画画（一直显示），这里只顺手刷新选项栏
});
/* 菜单的计数／标尺面板开着时，ps-image.js 的画布捕获监听看到手上是计数工具就让开 ⇒ 按下照常交给这颗工具 */
})();
