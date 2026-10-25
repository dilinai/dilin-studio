/* 切片选择工具（C，PS 版面 ps.slice-select）——照 ArtCraft／PhotoCraft 的 Rust 原码逐段翻译
   对照源（photocraft/crates/…）：
     ui-egui/src/slice_ui.rs  68-77    Down：点到的切片＝选中（自动切片也能选）；点到用户切片（没锁）＝开始拖移
     ui-egui/src/slice_ui.rs  93-101   Up：位移四舍五入成整数，有动才 slice.set rect，之后重新找它的编号当选中
     ui-egui/src/slice_ui.rs  145-161  选中＝2px 橘框、用户切片画 8 个把手（叠画在 tools/slice.js 的 SliceKit.drawAll）
     ui-egui/src/slice_ui.rs  189-192  拖移预览：橘框跟着走
     ui-egui/src/slice_ui.rs  197-241  selected_id（Promote＝自动切片先升级）、open_options（切片选项：类型 image/noImage、名称、URL、目标、
                                       替代文字、信息文字、单元格文字、背景）、open_divide（划分切片：横 2、竖 1）
     ui-egui/src/slice_ui.rs  257-279  选项栏：提升、划分…、删除（只有存的切片能删）、隐藏自动切片、切片选项…；锁定切片时全灰、提示一句
     engine/src/slice_cmds.rs          命令全在 tools/slice.js（slice.set／promote／divide／delete／select／options）
   原码没有、照 PS 2020 补的：拖选中用户切片的 8 个把手＝改大小；双击切片＝切片选项…；Delete／Backspace＝删除选中的切片。 */
(function(){
'use strict';

const SK = () => window.SliceKit;
const mods = e => ({shift:!!e.shiftKey, alt:!!e.altKey});

/* 把手命中（照 PS 补）：选中的用户切片，8 个把手 5 个萤幕点内 → {hx, hy}（-1 左／上、0 中、1 右／下） */
function handleAt(pt){
  const K = SK(); if (!K || K.locked()) return null;
  const sel = K.resolve().find(r => r.number === K.ui.selected);
  if (!sel || sel.origin !== 'user' || sel.id === null) return null;
  const z = (window.UI && UI.zoom) || 1, tol = 5 / z, r = sel.rect;
  const xs = [[r.x0, -1], [(r.x0 + r.x1) / 2, 0], [r.x1, 1]], ys = [[r.y0, -1], [(r.y0 + r.y1) / 2, 0], [r.y1, 1]];
  for (const [y, hy] of ys) for (const [x, hx] of xs){
    if (!hx && !hy) continue;
    if (Math.abs(pt[0] - x) <= tol && Math.abs(pt[1] - y) <= tol) return {hx, hy, id:sel.id, rect:r};
  }
  return null;
}
/* 拖曳结果框：移动＝整框平移（slice_ui.rs:94 round）；改大小＝拖的那几条边跟着走 */
function dragResult(d){
  const K = SK(), dx = K.rround(d.cur[0] - d.start[0]), dy = K.rround(d.cur[1] - d.start[1]), r = d.rect;
  if (d.kind === 'move') return K.R(r.x0 + dx, r.y0 + dy, r.x1 + dx, r.y1 + dy);
  let x0 = r.x0, y0 = r.y0, x1 = r.x1, y1 = r.y1;
  if (d.hx === -1) x0 += dx; if (d.hx === 1) x1 += dx;
  if (d.hy === -1) y0 += dy; if (d.hy === 1) y1 += dy;
  return K.R(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1));
}

/* slice_ui.rs:198 selected_id：选中切片的 id；promote＝自动切片先升级（slice.promote {number}） */
function selectedId(promote){
  const K = SK(), n = K.ui.selected; if (n === null || n === undefined) return null;
  const r = K.resolve().find(x => x.number === n); if (!r) return null;
  if (r.id !== null) return r.id;
  if (!promote) return null;
  const v = CMD.run('slice.promote', {number:n});
  return v && v.ok !== false ? v.slice : null;
}
/* slice_ui.rs:210 open_options：切片选项对话框（确定＝slice.set {number,…}；自动切片在 slice.set 里先升级、同一步） */
function openOptions(){
  const K = SK(), n = K.ui.selected; if (n === null || n === undefined) return false;
  const r = K.resolve().find(x => x.number === n); if (!r) return false;
  const v = K.resolvedJson(r), T = (a, b, c) => [a, b, c];
  return !!K.dialog('sliceOptions', T('切片選項', '切片选项', 'Slice Options'), [
    {key:'kind', label:T('切片類型', '切片类型', 'Slice Type'), type:'select', value:v.kind === 'noImage' ? 'noImage' : 'image', options:[['image', T('影像', '图像', 'Image')], ['noImage', T('無影像', '无图像', 'No Image')]]},
    {key:'name', label:T('名稱', '名称', 'Name'), type:'text', value:v.name},
    {key:'url', label:T('URL', 'URL', 'URL'), type:'text', value:v.url},
    {key:'target', label:T('目標', '目标', 'Target'), type:'text', value:v.target},
    {key:'alt', label:T('Alt 標籤', 'Alt 标记', 'Alt Tag'), type:'text', value:v.alt},
    {key:'message', label:T('訊息文字', '信息文本', 'Message Text'), type:'text', value:v.message},
    {key:'cellText', label:T('儲存格中的文字', '显示在单元格中的文本', 'Text Displayed in Cell'), type:'text', value:v.cellText},
    {key:'background', label:T('背景 (none／#rrggbb)', '背景（none／#rrggbb）', 'Background (none / #rrggbb)'), type:'text', value:v.background || 'none'}
  ], q => { const res = CMD.run('slice.set', Object.assign({number:n}, q)); if (window.UI) UI.draw(); return res; });
}
/* slice_ui.rs:230 open_divide：划分切片（横 2、竖 1） */
function openDivide(){
  const K = SK(), n = K.ui.selected; if (n === null || n === undefined) return false;
  const T = (a, b, c) => [a, b, c];
  return !!K.dialog('divideSlice', T('分割切片', '划分切片', 'Divide Slice'), [
    {key:'horizontal', label:T('水平分割為（往下幾塊）', '水平划分为（往下几块）', 'Divide Horizontally Into'), value:2, min:1, max:1000},
    {key:'vertical', label:T('垂直分割為（往右幾塊）', '垂直划分为（往右几块）', 'Divide Vertically Into'), value:1, min:1, max:1000}
  ], q => { const res = CMD.run('slice.divide', {number:n, horizontal:q.horizontal, vertical:q.vertical}); if (window.UI) UI.draw(); return res; });
}

const STRINGS = {
  'zh-Hant':{'tool.sliceselect':'切片選取', 'ui.slicePromote':'提升', 'ui.sliceDivide':'分割…', 'ui.sliceDelete':'刪除', 'ui.sliceHideAuto':'隱藏自動切片',
    'ui.sliceOptions':'切片選項…', 'ui.sliceSelHint':'點一下選取切片 · 拖曳使用者切片＝移動 · 拖把手＝改大小 · 雙擊＝切片選項 · Delete 刪除'},
  'zh-Hans':{'tool.sliceselect':'切片选择', 'ui.slicePromote':'提升', 'ui.sliceDivide':'划分…', 'ui.sliceDelete':'删除', 'ui.sliceHideAuto':'隐藏自动切片',
    'ui.sliceOptions':'切片选项…', 'ui.sliceSelHint':'点一下选中切片 · 拖用户切片＝移动 · 拖把手＝改大小 · 双击＝切片选项 · Delete 删除'},
  'en':{'tool.sliceselect':'Slice Select', 'ui.slicePromote':'Promote', 'ui.sliceDivide':'Divide…', 'ui.sliceDelete':'Delete', 'ui.sliceHideAuto':'Hide Auto Slices',
    'ui.sliceOptions':'Slice Options…', 'ui.sliceSelHint':'Click selects a slice · drag a user slice to move · drag a handle to resize · double-click = Slice Options · Delete removes'}
};
if (typeof Lang !== 'undefined') Lang.add(STRINGS);
const rebuild = () => { if (window.UI && ToolState.cur === 'sliceselect') UI.buildOptions('sliceselect'); if (window.UI) UI.draw(); };

Tools.reg({
  id:'sliceselect', icon:'⬚', group:'raster', order:301, for:'raster', cursor:'default', opts:[], strings:STRINGS,
  onDown(e, pt){
    const K = SK(); if (!K) return;
    K.dragResult = dragResult;
    if (e.button !== undefined && e.button !== 0) return;
    const h = handleAt(pt);
    if (h){ K.ui.drag = {kind:'resize', id:h.id, hx:h.hx, hy:h.hy, start:pt.slice(), cur:pt.slice(), rect:h.rect}; return; }
    // slice_ui.rs:69-75
    const hit = K.sliceAt(pt[0], pt[1]);
    K.ui.selected = hit ? hit.number : null;
    K.ui.drag = (hit && hit.id !== null && !K.locked() && hit.origin === 'user') ? {kind:'move', id:hit.id, start:pt.slice(), cur:pt.slice(), rect:hit.rect} : null;
    rebuild();
  },
  onMove(e, pt, P){
    const K = SK(); if (!K) return;
    const d = K.ui.drag;
    if (!d || !P.down){ if (window.UI) UI.canvas.style.cursor = handleAt(pt) ? 'nwse-resize' : 'default'; return; }
    d.cur = pt.slice(); UI.draw();
  },
  /* slice_ui.rs:93-101 */
  onUp(e, pt){
    const K = SK(); if (!K) return;
    const d = K.ui.drag; K.ui.drag = null;
    if (!d){ UI.draw(); return; }
    d.cur = pt.slice();
    const r = dragResult(d), r0 = d.rect;
    const changed = r.x0 !== r0.x0 || r.y0 !== r0.y0 || r.x1 !== r0.x1 || r.y1 !== r0.y1;
    if (changed && K.rw(r) >= 1 && K.rh(r) >= 1){
      const v = CMD.run('slice.set', {slice:d.id, rect:K.toXYWH(r)});
      if (v && v.ok !== false) K.ui.selected = K.numberOf(d.id);
    }
    rebuild();
  },
  onDblClick(e, pt){
    const K = SK(); if (!K) return;
    const hit = K.sliceAt(pt[0], pt[1]); if (!hit) return;
    K.ui.selected = hit.number;
    if (!K.locked()) openOptions();
  },
  onKey(e){
    const K = SK(); if (!K) return false;
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey){
      const id = selectedId(false); if (id === null || K.locked()) return false;
      e.preventDefault();
      const r = CMD.run('slice.delete', {slice:id}); if (r && r.ok !== false) K.ui.selected = null;
      rebuild(); return true;
    }
    return false;
  },
  onDeactivate(){ const K = SK(); if (K) K.ui.drag = null; },
  drawOverlay(ctx, s){ const K = SK(); if (K){ K.dragResult = dragResult; K.drawDrag(ctx, s); } },
  /* slice_ui.rs:257-282 选项栏 */
  buildOptions(box, add, mk){
    const K = SK(); if (!K) return;
    const locked = K.locked(), sel = K.ui.selected !== null && K.ui.selected !== undefined;
    const stored = sel && K.resolve().some(r => r.number === K.ui.selected && r.id !== null);
    const btn = (key, opt, enabled, fn) => {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.opt = opt; b.textContent = Lang.t(key);
      b.disabled = !enabled; b.style.cssText = 'margin:0 2px'; b.onclick = fn; box.appendChild(b); return b;
    };
    const sep = () => { const v = document.createElement('span'); v.style.cssText = 'display:inline-block;width:1px;height:18px;background:#555;margin:0 6px;vertical-align:middle'; box.appendChild(v); };
    btn('ui.slicePromote', 'promote', sel && !locked, () => { const id = selectedId(true); if (id !== null) CMD.run('slice.promote', {slice:id}); rebuild(); });
    btn('ui.sliceDivide', 'divide', sel && !locked, () => openDivide());
    btn('ui.sliceDelete', 'delete', stored && !locked, () => { const id = selectedId(false); if (id !== null){ const r = CMD.run('slice.delete', {slice:id}); if (r && r.ok !== false) K.ui.selected = null; } rebuild(); });
    sep();
    const cb = mk('checkbox', {checked:K.ui.hideAuto}); cb.dataset.opt = 'hideAuto';
    cb.onchange = () => { CMD.run('slice.options', {hideAuto:cb.checked}); };
    add('sliceHideAuto', cb);
    sep();
    btn('ui.sliceOptions', 'options', sel && !locked, () => openOptions());
    if (locked){ const n = document.createElement('span'); n.style.cssText = 'color:#9aa3ad;font-size:11px;margin-left:8px'; n.textContent = Lang.t('ui.sliceLocked'); box.appendChild(n); }
    const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t('ui.sliceSelHint'); box.appendChild(h);
  }
});
/* 选项栏的 add() 用 'opt.<key>' 当标签 */
if (typeof Lang !== 'undefined') Lang.add({'zh-Hant':{'opt.sliceHideAuto':'隱藏自動切片'}, 'zh-Hans':{'opt.sliceHideAuto':'隐藏自动切片'}, 'en':{'opt.sliceHideAuto':'Hide Auto Slices'}});

})();
