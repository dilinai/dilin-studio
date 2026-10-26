/* 堤麟画板 · 顶菜单实作 · Photoshop ▸ 窗口（命令名 ps.<原码 id>）
   外壳用 menus/impl/panels.js（window.DlPanels）；这支档放 PS 的面板内容，其中历史记录、导航器、信息三个 AI 视窗菜单也共用。
   照 ArtCraft PhotoCraft 原码逐段翻译：
     ui-egui/src/view_cmds.rs 198-232, 457-475   面板项：开着且在那一页＝关，否则开并切过去；勾＝开着且在那一页
     ui-egui/src/view_cmds.rs 592-678            排列：tabs／并排／n 联版面（只记版面）、为文档新建窗口／在窗口中浮动（另开一个视窗看同一份文件）、匹配缩放／位置（套到所有视窗）
     ui-egui/src/menus.rs 64-98, 150-199, 872-893 面板别名、画笔＝画笔设置的「画笔」页、工作区预设与 apply_workspace（导航器／颜色／图层／历史／属性五个开关）
     ui-egui/src/workspace_ui.rs 100-242, 291-310 新建／删除／锁定工作区（存在首选项里）、修改键面板（Shift／Ctrl／Alt 黏住）
     ui-egui/src/panels.rs 1001-1229, 1773-1863, 2047-2177  信息、导航器、色板（40 色、左键前景右键背景）、颜色（S/B 场＋色相条）、历史记录（点一步＝跳过去；底下三钮原码不动作）、调整（16 钮）
     ui-egui/src/tone.rs 221-289                 直方图（RGB／红／绿／蓝；平均值、标准差、中间值、像素、高速缓存级别；250ms 一算）
     ui-egui/src/actions.rs 37-163               动作：录制（排除查询类命令）、停止、播放（遇错就停）、新建、删除
     ui-egui/src/channels_panel.rs 47-308        通道：复合／红绿蓝／蒙版／Alpha／快速蒙版，Ctrl 点＝载入选区，底下载入／存储
     ui-egui/src/vector_ui.rs 682-780            路径
     ui-egui/src/comps_ui.rs 28-180              图层复合（最后的文档状态、套用、可见性／位置／外观三个开关、上一个／下一个、更新、新建、删除）
     ui-egui/src/preset_panels.rs 243-1036       渐变、图案、样式（engine/src/presets/styles.rs 21 个内建样式照抄）、形状、工具预设（engine/src/presets/tools.rs 5 个）、仿制源（5 个来源槽）
     ui-egui/src/analysis_ui.rs 549-692          注释、测量记录；ui-egui/src/timeline_ui.rs 43-149 时间轴；ui-egui/src/brush_panel.rs 334-381 画笔设置
     ui-egui/src/doc_props_ui.rs 117-267、layer_props_ui.rs 97-180  属性（文件：画布、标尺与网格、参考线；图层：变换、对齐）
   各面板功能（逐面板照原码；自测 tests/自测-panels-ps.py）：
     颜色 panels.rs:1204 HSB 滑杆＋十六进位（ps.color.set）；信息 panels.rs:1010 标尺单位；
     属性 doc_props_ui.rs（链接宽高、纵横、模式／位深、单位、参考线）＋layer_props_ui.rs（变换 W/H/X/Y＝内容外框、对齐、快速操作）＋panels.rs:1953（调整层参数／可见／剪切／复位）＋文字字符、形状外观（ps.shape.setAppearance）；
     通道 channels_panel.rs（新建／复制／删除／改名 Alpha、右键选单、Ctrl+点载入；ps.channel.*）；路径 vector_ui.rs:682-780（填充／描边／载入选区／从选区生成工作路径／存储／矢量蒙版；ps.path.*）；
     图层复合 comps_ui.rs（选中≠套用、警告清除）；渐变／图案／样式／形状 preset_panels.rs:243-729（共用浏览器：组、缩图大小、右键改名删除移组、新建；ps.gradient.presets.*、ps.pattern.presets.*、ps.style.presets.*、ps.shape.presets.edit）；
     工具预设 preset_panels.rs:828（新建／改名／删除；ps.tool.presets.*）；仿制源 preset_panels.rs:920（翻转、叠加选项）；
     注释 analysis_ui.rs:640＋notes_cmds.rs（Doc.notes、📌 放注释；ps.notes.*）；测量记录 analysis_ui.rs:549（ps.measurementLog.select）；时间轴 timeline_ui.rs（播放；ps.timeline.playback）；
     画笔设置 brush_panel.rs＋brush_sections.rs（十三节、预览、画笔页预设；ps.brush.section、ps.brush.presets.*）。
   面板 id（DlPanels）：layers／tools／options（停靠块）、history navigator info histogram color swatches actions adjustments brushSettings properties channels paths
     layerComps gradients patterns styles shapes toolPresets cloneSource notes measurementLog timeline modifierKeys docWindow:<n>；
     字符／段落／字形／字符样式／段落样式交给 ps-type 已做的面板（window.PsType.Panels，ps.type.panels.*）。 */
(function(){
if (window.PsWindow && window.PsWindow.__loaded) return;
if (!window.DlPanels){ console.warn('[ps-window] 需要 menus/impl/panels.js'); return; }
const P = window.DlPanels, el = P.el.bind(P), T = P.t;
const L3 = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, en:c});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex2 = v => ('0' + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2);
const rgbHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);
const hexRgb = h => { h = String(h || '#000000').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0]; };
const peek = (id, p) => CMD.map[id] ? CMD.map[id].run(p || {}) : null;          // 只读查询（不进历史、不触发 refresh）
const has = id => !!CMD.map[id];
const runCmd = (id, p) => { try { const r = CMD.run(id, p || {}); if (r && r.ok === false) console.warn('[ps-window]', id, r.error); return r; } catch(e){ console.error(e); return {ok:false, error:String(e)}; } };
const btn = (label, title, onclick, opt) => el('button', Object.assign({text:label, title:title ? T(title) : null, onclick}, opt || {}));
const row = (label, ...kids) => el('div', {class:'row'}, [label !== null ? el('span', {text:T(label)}) : null, ...kids]);
const fg = () => document.getElementById('fillColor').value, bg = () => document.getElementById('strokeColor').value;
const PsWindow = window.PsWindow = {__loaded:true};
/* ── 面板功能共用小工具 ── */
const clone = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
const LSget = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v === null ? d : v; } catch(e){ return d; } };
const LSput = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch(e){ return false; } };
const fail = e => ({ok:false, error:e});
/* ui.js 在这支档之后才载 ⇒ 要包 UI 的地方等它起来 */
const onUI = fn => { if (window.UI && UI.canvas) fn(); else window.addEventListener('DOMContentLoaded', () => setTimeout(() => { if (window.UI) fn(); }, 0)); };
/* 面板 body 里正在打字（文字／数字框、下拉、多行）⇒ 先别整块重画；滑杆、勾选框不算（拖完就该跟着刷） */
const busy = b => P.typing(b, {skip:['checkbox', 'radio', 'button', 'range', 'color']});
/* 可收合的小节（props_layout.rs:67 section：分隔线＋▾ 标题；开合记在面板状态里） */
const SecOpen = {};
function section(b, id, title){
  const open = SecOpen[id] !== false;
  b.appendChild(el('div', {class:'sec', dataset:{sec:id}, style:'cursor:pointer;user-select:none', text:(open ? '▾ ' : '▸ ') + T(title),
    onclick:() => { SecOpen[id] = !open; P.refresh(); }}));
  return open;
}
/* 右键选单（面板在外层 document 时也弹在那边：P.popup） */
function ctxMenu(anchor, items){
  const pop = el('div', {class:'dlp-pop'});
  items.forEach(it => {
    if (!it) return;
    if (it.sep){ if (pop.lastChild) pop.appendChild(el('div', {class:'dlp-sep'})); return; }
    pop.appendChild(el('div', {class:'dlp-pi' + (it.disabled ? ' off' : ''), dataset:{act:it.act || ''}, text:(it.checked ? '✓ ' : '') + T(it.label),
      onclick:e => { e.stopPropagation(); pop.remove(); if (!it.disabled) try { it.run(); } catch(err){ console.error(err); } }}));
  });
  P.popup(pop, anchor);
  return pop;
}
/* 改名小对话框（preset_panels.rs:258 原码是面板里一行输入框；PS 是小对话框）→ 确定才叫 ok(name) */
function askName(title, value, ok){
  return P.dialog({id:'psWinName', title, fields:[{k:'name', type:'text', label:L3('名稱：', '名称：', 'Name:'), value:value || ''}],
    ok:v => { const n = String(v.name || '').trim(); if (!n) return {ok:false, error:T(L3('請輸入名稱', '请输入名称', 'Enter a name'))}; const r = ok(n); return r && r.ok === false ? r : true; }});
}

/* ═══════════ 历史：每一步记名字（照 History panel：第一行「打开」、往下是每一步的命令名、重做的灰掉） ═══════════
   engine 的 History 只存快照不存名 ⇒ 执行期包 CMD.run／History.push／undo／redo：快照上挂 _next（从这一步往下做了什么）／_by（这一步是怎么来的） */
const Hist = PsWindow.history = {
  cur: null, depth: 0,
  /* 每一个会进历史的命令各算一步（同 PS），步名照 PS 历史记录面板的叫法；
     没菜单名的底层命令（AI／网页送进来的 paint.stroke、clone.stamp…）原本只显示命令编号 ⇒ 这张表补 PS 名＋图示 */
  NAMES: {
    'paint.stroke':[L3('畫筆工具', '画笔工具', 'Brush Tool'), 'brush'], 'brush.stroke':[L3('畫筆工具', '画笔工具', 'Brush Tool'), 'brush'],
    'pencil.stroke':[L3('鉛筆工具', '铅笔工具', 'Pencil Tool'), 'pencil'], 'eraser.stroke':[L3('橡皮擦', '橡皮擦', 'Eraser'), 'eraser'],
    'clone.stamp':[L3('仿製印章', '仿制图章', 'Clone Stamp'), 'clone-stamp'], 'historybrush.paint':[L3('步驟記錄筆刷工具', '历史记录画笔工具', 'History Brush Tool'), 'history-brush'], 'bucket.fill':[L3('油漆桶', '油漆桶', 'Paint Bucket'), 'bucket'],
    'move.translate':[L3('移動', '移动', 'Move'), 'move'], 'marquee.select':[L3('矩形選取畫面', '矩形选框', 'Rectangular Marquee'), 'marquee-rect'],
    'lasso.select':[L3('套索', '套索', 'Lasso'), 'lasso'], 'select.none':[L3('取消選取', '取消选择', 'Deselect'), null],
    'ps.layer.new.layer':[L3('新增圖層', '新建图层', 'New Layer'), null], 'layer.newRaster':[L3('新增圖層', '新建图层', 'New Layer'), null],
    'layer.newVector':[L3('新增圖層', '新建图层', 'New Layer'), null], 'ps.layer.new.layerViaCopy':[L3('拷貝的圖層', '通过拷贝的图层', 'Layer Via Copy'), null],
    'layer.addImageFromURL':[L3('置入', '置入', 'Place'), null], 'shape.bezier':[L3('鋼筆', '钢笔', 'Pen'), 'pen'],
    'ps.edit.clear':[L3('清除', '清除', 'Clear'), null], 'paint.fillRect':[L3('填色', '填充', 'Fill'), null], 'ps.layer.mergeDown':[L3('向下合併', '向下合并', 'Merge Down'), null],
    'ps.history.snapshot.new':[L3('新增快照', '新建快照', 'New Snapshot'), null], 'ps.history.snapshot.restore':[L3('快照', '快照', 'Snapshot'), null],
    'ps.history.snapshot.delete':[L3('刪除快照', '删除快照', 'Delete Snapshot'), null], 'ps.history.snapshot.rename':[L3('快照名稱', '快照名称', 'Snapshot Name'), null],
  },
  labelOf(id, p){
    p = p || {};
    if (id === 'layer.set'){   // 一个命令改很多种属性：照改了哪一项叫（PS：图层可见性／图层不透明度／混合模式更改／图层属性）
      if ('visible' in p) return [L3('圖層可見度', '图层可见性', 'Layer Visibility'), null];
      if ('opacity' in p) return [L3('圖層不透明度', '图层不透明度', 'Layer Opacity'), null];
      if ('blend' in p) return [L3('混合模式變更', '混合模式更改', 'Blending Change'), null];
      if ('name' in p) return [L3('圖層屬性', '图层属性', 'Layer Properties'), null];
    }
    const m = this.NAMES[id]; if (m) return m;
    const tool = /^(tool|tools)\./.test(id) ? id.split('.')[1] : null;
    return [this.label(id), tool];
  },
  label(id){
    if (this.NAMES[id]) return T(this.NAMES[id][0]);
    if (window.Menubar){ const f = Menubar.findImpl(id); if (f) return Menubar.name(f.item); }
    const c = CMD.map[id]; if (c && c.i18n){ const t = Lang.t(c.i18n); if (t && t !== c.i18n) return t; }
    return id;
  },
  toolLabel(){ const k = 'tool.' + (window.ToolState ? ToolState.cur : ''); const t = Lang.t(k); return t && t !== k ? t : (window.ToolState ? ToolState.cur : '—'); },
  rows(){
    const H = History, out = [{label:T(L3('打開', '打开', 'Open')), at:0}];
    H.past.forEach((s, i) => out.push({label:s._next || '—', icon:s._nextIcon || null, at:i + 1}));
    const fut = H.future.slice().reverse();
    fut.forEach((s, i) => out.push({label:s._by || '—', icon:s._byIcon || null, at:H.past.length + 1 + i, redo:true}));
    return {rows:out, current:H.past.length};
  },
  /* panels.rs:1820-1840：点第 i 列 ⇒ 差几步就 undo／redo 几次（遇错停） */
  go(i){
    const cur = History.past.length; let d = i - cur, n = 0;
    while (d < 0 && History.undo()){ d++; n++; }
    while (d > 0 && History.redo()){ d--; n++; }
    if (window.UI) UI.refresh();
    return n;
  }
};
if (!CMD.__psWinHist){
  CMD.__psWinHist = true;
  const run = CMD.run;
  CMD.run = function(id, p){ const top = Hist.depth === 0; if (top){ Hist.cur = id; Hist.curP = p; } Hist.depth++; try { return run.apply(this, arguments); } finally { Hist.depth--; if (top){ Hist.cur = null; Hist.curP = null; } } };
  const now = () => { if (Hist.cur){ const [l, ic] = Hist.labelOf(Hist.cur, Hist.curP); return [(typeof l === 'string' ? l : T(l)).replace(/[….]+$/, ''), ic]; }
    return [Hist.toolLabel(), window.ToolState ? ToolState.cur : null]; };
  const push = History.push, undo = History.undo, redo = History.redo;
  History.push = function(){ const r = push.apply(this, arguments); const s = this.past[this.past.length - 1]; if (s && !s._next){ const [l, ic] = now(); s._next = l; s._nextIcon = ic; } return r; };
  History.undo = function(){ const t = this.past.length ? this.past[this.past.length - 1] : null, lbl = t && t._next, ic = t && t._nextIcon; const r = undo.apply(this, arguments); if (r && this.future.length){ const f = this.future[this.future.length - 1]; f._by = lbl; f._byIcon = ic; } return r; };
  History.redo = function(){ const t = this.future.length ? this.future[this.future.length - 1] : null, lbl = t && t._by, ic = t && t._byIcon; const r = redo.apply(this, arguments); if (r && this.past.length){ const q = this.past[this.past.length - 1]; q._next = lbl; q._nextIcon = ic; } return r; };
}
CMD.reg('ps.history.list', {i18n:'', params:'{} 历史记录面板的各列 → {ok, rows:[{label, at, redo?}], current}'}, () => Object.assign({ok:true}, Hist.rows()));
CMD.reg('ps.history.goto', {i18n:'', params:'{index: 第几列（0＝打开）} 跳到那一步（＝点历史记录面板那一列；差几步就还原／重做几次）→ {ok, steps, current}'}, p => {
  const n = Hist.go(clamp(+p.index || 0, 0, History.past.length + History.future.length));
  return {ok:true, steps:n, current:History.past.length};
});
/* ═══════════ 历史记录快照（PS 历史记录面板上方那串：📷 建立新快照、点快照＝文件回到那时、🗑 删除；存进工程档 historySnapshots）═══════════
   一张快照＝History.snap() 拍的整份文件（图层、选区、尺寸…）＋名字。快照清单本身也进历史（建／删／改名都能 Ctrl+Z）：
   History.snap／restore 多带一栏 hsnaps（清单的参照拷贝；快照拍好就不再改，共用没关系）。
   存档：每张快照的图层照工程档的写法（Project._layerOut，内嵌层的写法＝连 x2 栏）编一次就记住（快照不会变）；载档时照 _layerIn 读回来。
   换文件（file.new／开档 ⇒ Doc.serial 变）清单就清空（PS 的快照也只活在那份文件里）。 */
const Snaps = PsWindow.snapshots = {
  serial:null, items:[], sel:null,
  list(){ if (this.serial !== Doc.serial){ this.serial = Doc.serial; this.items = []; this.sel = null; } return this.items; },
  setList(a){ this.serial = Doc.serial; this.items = a; if (this.sel && !a.some(s => s.id === this.sel)) this.sel = null; },
  find(p){
    const L = this.list();
    if (p.id !== undefined) return L.find(s => s.id === p.id) || null;
    if (p.name !== undefined) return L.find(s => s.name === p.name) || null;
    if (Number.isInteger(p.index)) return L[p.index] || null;
    return this.sel ? L.find(s => s.id === this.sel) || null : null;
  },
  nextName(){ const used = new Set(this.list().map(s => s.name)); let n = this.list().length + 1; for (;;){ const nm = T(L3('快照 ', '快照 ', 'Snapshot ')) + n; if (!used.has(nm)) return nm; n++; } },
  /* 存档：一张快照 → {id, name, width, height, dpi, activeId, layers}（图层用工程档的写法；编好就记住） */
  encode(s){
    if (s._json) return s._json;
    const st = s.state, stats = {encoded:[], reused:[], refs:[]};
    const layers = st.layers.map(o => Project._layerOut(History._layerFrom(o), false, stats, Project._gen, true));
    s._json = {id:s.id, name:s.name, width:st.width, height:st.height, dpi:st.dpi, activeId:st.activeId, layers};
    return s._json;
  },
  async decode(o, errors){
    const keep = {w:Doc.width, h:Doc.height}; Doc.width = +o.width || Doc.width; Doc.height = +o.height || Doc.height;   // 蒙版画布照快照那时的文件尺寸开
    const layers = [];
    try { for (const q of (o.layers || [])) layers.push(History._layerSnap(await Project._layerIn(q, errors, true))); }
    finally { Doc.width = keep.w; Doc.height = keep.h; }
    return {id:String(o.id), name:String(o.name || ''), _json:o,
      state:{width:+o.width || Doc.width, height:+o.height || Doc.height, activeId:o.activeId || null, sel:null, vsel:null, aiDoc:null, globalLight:null, dpi:o.dpi, layers}};
  }
};
if (!History.__psSnaps){
  History.__psSnaps = true;
  const snap0 = History.snap, restore0 = History.restore, rip0 = History.restoreInPlace;
  History.snap = function(){ const s = snap0.apply(this, arguments); s.hsnaps = Snaps.list().slice(); return s; };
  History.restore = function(s){ const r = restore0.apply(this, arguments); if (s && s.hsnaps) Snaps.setList(s.hsnaps.slice()); return r; };
  History.restoreInPlace = function(s){ const r = rip0.apply(this, arguments); if (s && s.hsnaps) Snaps.setList(s.hsnaps.slice()); return r; };
  if (SiteHooks.extraSigs) SiteHooks.extraSigs.push(() => 'hsnap:' + Snaps.list().map(s => s.id + '=' + s.name).join('\u0003'));   // 快照存进工程档 ⇒ 建／删／改名都算改动（自动存档）
  const ser = Project.serialize, load = Project.load;
  Project.serialize = function(){ const o = ser.apply(this, arguments); const L = Snaps.list(); if (o && L.length && !(Smart.session && Smart.session.parentJSON)) o.historySnapshots = L.map(s => Snaps.encode(s)); return o; };
  Project.load = async function(json){
    const r = await load.apply(this, arguments);
    const list = [];
    if (json && Array.isArray(json.historySnapshots)){ const errors = []; for (const o of json.historySnapshots){ try { list.push(await Snaps.decode(o, errors)); } catch (e){ console.error('[history snapshot]', e); } } }
    Snaps.setList(list);
    return r;
  };
}
const snapRef = p => (p.id !== undefined || p.name !== undefined || p.index !== undefined) ? Snaps.find(p) : null;
CMD.reg('ps.history.snapshot.new', {i18n:'', undoable:true,
  params:'{name?（缺省「快照 N」）} 历史记录面板 📷「建立新快照」：把目前整份文件（图层、选区、尺寸）拍成一张快照，排在面板上方；快照存进工程档 → {ok, id, name, count}'}, p => {
  const st = History.snap(); delete st.hsnaps; delete st._next; delete st._nextIcon;
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : Snaps.nextName();
  if (Snaps.list().some(s => s.name === name)) return {ok:false, error:`ps.history.snapshot.new: a snapshot named "${name}" already exists`};
  const s = {id:'HS' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, state:st};
  Snaps.setList(Snaps.list().concat([s])); Snaps.sel = s.id;
  return {ok:true, id:s.id, name, count:Snaps.list().length};
});
CMD.reg('ps.history.snapshot.restore', {i18n:'', undoable:true,
  params:'{id?|name?|index?（缺省＝面板上选中的快照）} 点历史记录面板上的快照：文件整份回到拍快照那时（一步历史，Ctrl+Z 退回）→ {ok, id, name}'}, p => {
  const s = snapRef(p) || (Object.keys(p).length ? null : Snaps.find({}));
  if (!s) return {ok:false, error:'ps.history.snapshot.restore: no such snapshot (see ps.history.snapshot.list)'};
  const keep = Snaps.list().slice();
  History.restore(Object.assign({}, s.state, {hsnaps:keep}));        // 图层另做一份（_layerFrom 拷画布），快照本身不被改到；清单不动
  Snaps.sel = s.id;
  return {ok:true, id:s.id, name:s.name};
});
CMD.reg('ps.history.snapshot.delete', {i18n:'', undoable:true,
  params:'{id?|name?|index?（缺省＝面板上选中的快照）} 历史记录面板 🗑：删掉一张快照（文件不动；Ctrl+Z 拿回来）→ {ok, count}'}, p => {
  const s = snapRef(p) || (Object.keys(p).length ? null : Snaps.find({}));
  if (!s) return {ok:false, error:'ps.history.snapshot.delete: no such snapshot'};
  Snaps.setList(Snaps.list().filter(x => x !== s));
  return {ok:true, count:Snaps.list().length};
});
CMD.reg('ps.history.snapshot.rename', {i18n:'', undoable:true,
  params:'{id?|index?（缺省＝选中的）, name} 快照改名（PS：双击快照名）→ {ok, id, name}'}, p => {
  const s = snapRef({id:p.id, index:p.index}) || (p.id === undefined && p.index === undefined ? Snaps.find({}) : null);
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  if (!s) return {ok:false, error:'ps.history.snapshot.rename: no such snapshot'};
  if (!name) return {ok:false, error:'ps.history.snapshot.rename: `name` is required'};
  if (Snaps.list().some(x => x !== s && x.name === name)) return {ok:false, error:`ps.history.snapshot.rename: a snapshot named "${name}" already exists`};
  const n = Object.assign({}, s, {name}); delete n._json;              // 快照物件不就地改（历史里旧清单还指着旧的那张）
  Snaps.setList(Snaps.list().map(x => x === s ? n : x));
  return {ok:true, id:n.id, name};
});
CMD.reg('ps.history.snapshot.list', {i18n:'', params:'{} 历史记录面板上的快照 → {ok, snapshots:[{id, name, index, width, height, layers}], selected}'}, () =>
  ({ok:true, snapshots:Snaps.list().map((s, i) => ({id:s.id, name:s.name, index:i, width:s.state.width, height:s.state.height, layers:s.state.layers.length})), selected:Snaps.sel}));
P.define('history', {title:L3('步驟記錄', '历史记录', 'History'), w:250, h:300,
  build(b){ b.appendChild(el('div', {class:'hsnap'})); b.appendChild(el('div', {class:'list hlist'})); b.appendChild(el('div', {class:'bar hbar'})); },
  refresh(b){
    const snap = b.querySelector('.hsnap'); snap.innerHTML = '';
    const th = el('canvas', {width:28, height:28, style:'vertical-align:middle;margin-right:8px;background:#fff'});
    try { th.getContext('2d').drawImage(composite(Math.min(28 / Doc.width, 28 / Doc.height)), 0, 0); } catch(e){}
    snap.appendChild(el('div', {class:'li', style:'cursor:default'}, [th, el('span', {text:T(L3('未命名', '未标题', 'Untitled'))})]));
    Snaps.list().forEach((s, i) => snap.appendChild(el('div', {class:'li hsnapRow' + (Snaps.sel === s.id ? ' on' : ''), dataset:{snap:s.id, index:i}, title:T(L3('按一下：回到這張快照；按兩下：改名', '单击：回到这张快照；双击：改名', 'Click: revert to this snapshot; double-click: rename')),
      onclick:() => runCmd('ps.history.snapshot.restore', {id:s.id}),
      ondblclick:e => { e.stopPropagation(); const nm = window.prompt(T(L3('快照名稱', '快照名称', 'Snapshot Name')), s.name); if (nm !== null && nm.trim()) runCmd('ps.history.snapshot.rename', {id:s.id, name:nm}); }},
      [el('span', {class:'hic hic-snap', style:'display:inline-block;width:28px;text-align:center;margin-right:8px', text:'📷'}), el('span', {text:s.name})])));
    const box = b.querySelector('.hlist'); box.innerHTML = '';
    const {rows, current} = Hist.rows();
    const hbs = window.HistoryBrush && HistoryBrush.ui ? (HistoryBrush.ui.state === null || HistoryBrush.ui.state === undefined ? 0 : HistoryBrush.ui.state) : null;   // PS 历史面板左边那格：历史记录画笔的来源
    rows.forEach(r => { const ic = el('span', {class:'hic'});
      const mark = el('span', {class:'hsrc', style:'display:inline-block;width:16px;height:16px;line-height:16px;vertical-align:middle;cursor:pointer;font-size:11px', title:T(L3('設定步驟記錄筆刷的來源', '设置历史记录画笔的源', 'Sets the source for the history brush')),
        onclick:e => { e.stopPropagation(); if (!r.redo && window.HistoryBrush){ runCmd('historybrush.setOptions', {state:r.at}); P.refresh('history'); } }}); if (r.icon && window.Icons) ic.innerHTML = Icons.svg(r.icon, 16); else ic.classList.add(r.at === 0 ? 'hic-doc' : 'hic-cmd');   // 没工具图示＝CSS 画个小方框（不塞文字，列的文字只留步名）
      if (hbs !== null && r.at === hbs){ mark.dataset.on = '1'; if (window.Icons) mark.innerHTML = Icons.svg('history-brush', 12); else mark.style.background = 'currentColor'; } // 用图示不用文字：列的文字只留步名
 box.appendChild(el('div', {class:'li' + (r.at === current ? ' on' : '') + (r.redo ? ' fut' : ''), dataset:{at:r.at},
        onclick:() => runCmd('ps.history.goto', {index:r.at})}, [mark, ic, el('span', {text:r.label})])); });
    const on = box.querySelector('.on'); if (on) on.scrollIntoView({block:'nearest'});
    const bar = b.querySelector('.hbar'); bar.innerHTML = '';
    // panels.rs:1849-1851：原码三颗钮画了但不动作；📷 建立新快照、🗑 删除选中的快照接上（快照见上面 Snaps）；从当前状态新建文档仍灰着
    bar.appendChild(btn('⧉', L3('從目前狀態建立新文件', '从当前状态创建新文档', 'Create new document from current state'), null, {disabled:true}));
    bar.appendChild(btn('📷', L3('建立新快照', '创建新快照', 'Create new snapshot'), () => runCmd('ps.history.snapshot.new', {}), {dataset:{act:'snapNew'}}));
    bar.appendChild(btn('🗑', L3('刪除快照', '删除快照', 'Delete snapshot'), () => runCmd('ps.history.snapshot.delete', {}), {disabled:!Snaps.find({}), dataset:{act:'snapDelete'}}));
  }});

/* ═══════════ 导航器（panels.rs:1070-1124） ═══════════ */
function viewInfo(){
  const w = document.getElementById('canvasWrap').getBoundingClientRect(), z = UI.zoom;
  const c = window.ZoomView ? ZoomView.toDoc([w.left + w.width / 2, w.top + w.height / 2]) : [Doc.width / 2, Doc.height / 2];
  return {zoom:z, center:c, vw:w.width / z, vh:w.height / z};
}
function setCenter(x, y){ x = clamp(x, 0, Doc.width); y = clamp(y, 0, Doc.height); if (window.HandView) HandView.setCenter(x, y); UI.draw(); }
function setZoomKeep(z){ const v = viewInfo(); const w = document.getElementById('canvasWrap').getBoundingClientRect();
  if (window.ZoomView) ZoomView.anchorView([w.left + w.width / 2, w.top + w.height / 2], v.center, z); else UI.setZoom(z); }
CMD.reg('ps.navigator.set', {i18n:'', params:'{center?:[x,y] 文件坐标, zoom?: 倍率（1＝100%）, fit?:true} 导航器：拖缩图里的红框＝改视角中心；滑杆＝缩放（不进历史）→ {ok, zoom, center}'}, p => {
  if (p.fit) CMD.run('view.fit');
  if (typeof p.zoom === 'number') setZoomKeep(clamp(p.zoom, 0.01, 64));
  if (Array.isArray(p.center)) setCenter(+p.center[0], +p.center[1]);
  const v = viewInfo(); return {ok:true, zoom:v.zoom, center:v.center};
});
P.define('navigator', {title:L3('導覽器', '导航器', 'Navigator'), w:260, live:true,
  build(b){
    const cv = el('canvas', {class:'navcv', style:'width:100%;height:150px;display:block;background:#1e1e1e;cursor:crosshair'});
    b.appendChild(cv);
    const map = e => { const r = cv.getBoundingClientRect(), g = cv._geo; if (!g) return null; return [(e.clientX - r.left - g.ox) / g.k, (e.clientY - r.top - g.oy) / g.k]; };
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); const d = map(e); if (d) runCmd('ps.navigator.set', {center:d});
      const mv = ev => { const q = map(ev); if (q) setCenter(q[0], q[1]); }; const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); };
      cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); });
    const pills = el('div', {class:'row'}, [el('span', {text:T(L3('縮放', '缩放', 'Zoom'))}), el('span', {style:'flex:1'}),
      btn(T(L3('符合', '适合', 'Fit')), null, () => runCmd('ps.navigator.set', {fit:true}), {dataset:{z:'fit'}}),
      btn('100%', null, () => runCmd('ps.navigator.set', {zoom:1}), {dataset:{z:'1'}}), btn('200%', null, () => runCmd('ps.navigator.set', {zoom:2}), {dataset:{z:'2'}})]);
    b.appendChild(pills);
    const sl = el('input', {type:'range', min:-6.64, max:5, step:0.01, class:'navz'});
    sl.oninput = () => runCmd('ps.navigator.set', {zoom:Math.pow(2, +sl.value)});
    const pct = el('span', {class:'navpct', style:'min-width:48px;text-align:right'});
    b.appendChild(el('div', {class:'row'}, [sl, pct]));
  },
  refresh(b){
    const cv = b.querySelector('.navcv'), W = cv.clientWidth || 240, H = 150, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr)) cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const k = Math.min((W - 32) / Doc.width, (H - 32) / Doc.height), ox = (W - Doc.width * k) / 2, oy = (H - Doc.height * k) / 2;
    cv._geo = {k, ox, oy};
    // 棋盘格（格 6）＋缩图
    for (let y = 0; y < Doc.height * k; y += 6) for (let x = 0; x < Doc.width * k; x += 6){ ctx.fillStyle = ((x + y) / 6) % 2 ? '#cfcfcf' : '#fff'; ctx.fillRect(ox + x, oy + y, Math.min(6, Doc.width * k - x), Math.min(6, Doc.height * k - y)); }
    try { ctx.drawImage(composite(k * dpr), ox, oy, Doc.width * k, Doc.height * k); } catch(e){}
    const v = viewInfo();
    ctx.save(); ctx.beginPath(); ctx.rect(1, 1, W - 2, H - 2); ctx.clip();
    ctx.strokeStyle = 'rgb(255,84,84)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(ox + (v.center[0] - v.vw / 2) * k, oy + (v.center[1] - v.vh / 2) * k, v.vw * k, v.vh * k);
    ctx.restore();
    const sl = b.querySelector('.navz'); if (P.activeEl(sl) !== sl) sl.value = Math.log2(UI.zoom);
    b.querySelector('.navpct').textContent = Math.round(UI.zoom * 1000) / 10 + '%';
    b.querySelectorAll('[data-z]').forEach(x => x.classList.toggle('on', x.dataset.z !== 'fit' && Math.abs(+x.dataset.z - UI.zoom) < 1e-3));
  }});

/* ═══════════ 信息（panels.rs:1001-1068） ═══════════ */
let _infoPx = null;
P.define('info', {title:L3('資訊', '信息', 'Info'), w:240, live:true,
  build(b){ b.appendChild(el('div', {class:'kv ipx'})); b.appendChild(el('div', {class:'sec'})); b.appendChild(el('div', {class:'kv ipos'})); b.appendChild(el('div', {class:'sec'})); b.appendChild(el('div', {class:'kv icsamp'})); b.appendChild(el('div', {class:'hint idoc'})); },
  refresh(b){
    const h = window.Pointer && Pointer.hover, inside = h && h[0] >= 0 && h[1] >= 0 && h[0] < Doc.width && h[1] < Doc.height;
    let px = null;
    if (inside){ const x = Math.floor(h[0]), y = Math.floor(h[1]), key = x + ',' + y + ',' + History.past.length;
      if (!_infoPx || _infoPx.key !== key){ const r = peek('eyedropper.pixel', {x, y, sampleSize:1}); _infoPx = {key, rgba:r && r.rgba}; } px = _infoPx.rgba; }
    const f = v => v === null || v === undefined ? '—' : v;
    let cmyk = [null, null, null, null];
    if (px){ const r = px[0] / 255, g = px[1] / 255, bl = px[2] / 255, k = 1 - Math.max(r, g, bl), c = k >= 1 ? 0 : (1 - r - k) / (1 - k), m = k >= 1 ? 0 : (1 - g - k) / (1 - k), y = k >= 1 ? 0 : (1 - bl - k) / (1 - k);
      cmyk = [c, m, y, k].map(v => Math.round(v * 100) + '%'); }
    const kv = (box, pairs) => { box.innerHTML = ''; pairs.forEach(([k, v]) => { box.appendChild(el('b', {text:k})); box.appendChild(el('span', {text:String(v)})); }); };
    kv(b.querySelector('.ipx'), [['R:', f(px && px[0])], ['C:', f(cmyk[0])], ['G:', f(px && px[1])], ['M:', f(cmyk[1])], ['B:', f(px && px[2])], ['Y:', f(cmyk[2])], ['', ''], ['K:', f(cmyk[3])]]);
    const s = Doc.sel, U = window.PsEdit && PsEdit.units;
    // panels.rs:1010-1014：位置与大小照「首选项 ▸ 单位与标尺」的标尺单位（像素以外的单位走 ps-edit 的换算）
    const len = (px, axis) => { if (U && U.unit() !== 'pixels'){ try { return U.format(px, axis) + ' ' + U.suffix(); } catch(e){} } return Math.round(px) + ' px'; };
    kv(b.querySelector('.ipos'), [['X:', inside ? len(Math.floor(h[0]), 'x') : '—'], ['W:', s ? len(s.w, 'x') : '—'], ['Y:', inside ? len(Math.floor(h[1]), 'y') : '—'], ['H:', s ? len(s.h, 'y') : '—']]);
    // 颜色取样器（tools/colorsampler.js）：每个取样点一格 #n＋读数
    const csb = b.querySelector('.icsamp'), cs = has('colorsampler.list') ? peek('colorsampler.list', {fresh:false}) : null;
    if (csb){ csb.innerHTML = ''; ((cs && cs.samplers) || []).forEach(s => { csb.appendChild(el('b', {text:'#' + s.number})); csb.appendChild(el('span', {text:Object.entries(s.values).map(([k, v]) => k + ':' + v).join(' ')})); }); }
    b.querySelector('.idoc').textContent = `${T(L3('文件', '文档', 'Doc'))}: ${Doc.width} × ${Doc.height} px`;
  }});
if (!window.__psWinHover){ window.__psWinHover = true; document.addEventListener('pointermove', e => { if (e.target && e.target.id === 'view' && (P.isOpen('info') || P.isOpen('aiInfo'))) P.schedule('draw'); }); }

/* ═══════════ 直方图（tone.rs:221-289） ═══════════ */
const Histo = {t:0, data:null, key:null};
function histoCompute(){
  const s = Math.min(1, 512 / Math.max(Doc.width, Doc.height)), c = composite(s), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const h = {rgb:new Float64Array(256), red:new Float64Array(256), green:new Float64Array(256), blue:new Float64Array(256)};
  for (let i = 0; i < d.length; i += 4){ if (!d[i + 3]) continue; h.red[d[i]]++; h.green[d[i + 1]]++; h.blue[d[i + 2]]++; h.rgb[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++; }   // RGB 复合＝亮度
  return h;
}
function histoStats(a){
  let n = 0, sum = 0; for (let i = 0; i < 256; i++){ n += a[i]; sum += i * a[i]; }
  const mean = n ? sum / n : 0; let v = 0; for (let i = 0; i < 256; i++) v += a[i] * (i - mean) * (i - mean);
  let acc = 0, med = 0; for (let i = 0; i < 256; i++){ acc += a[i]; if (acc >= n / 2){ med = i; break; } }
  return {mean, std:n ? Math.sqrt(v / n) : 0, median:med};
}
CMD.reg('ps.histogram.get', {i18n:'', params:'{channel:"rgb|red|green|blue"="rgb"} 整份文件的直方图（RGB 复合＝亮度）→ {ok, bins:[256], mean, stdDev, median, pixels, cacheLevel}'}, p => {
  const h = histoCompute(), ch = ['rgb', 'red', 'green', 'blue'].includes(p.channel) ? p.channel : 'rgb', st = histoStats(h[ch]);
  return {ok:true, channel:ch, bins:Array.from(h[ch]), mean:st.mean, stdDev:st.std, median:st.median, pixels:Doc.width * Doc.height, cacheLevel:Math.ceil(Math.log2(Math.max(Math.max(Doc.width, Doc.height) / 384, 1))) + 1};
});
P.define('histogram', {title:L3('色階分佈圖', '直方图', 'Histogram'), w:260, live:true,
  build(b){
    const sel = el('select', {class:'hch', onchange:() => P.refresh('histogram')});
    [['rgb', 'RGB'], ['red', L3('紅', '红', 'Red')], ['green', L3('綠', '绿', 'Green')], ['blue', L3('藍', '蓝', 'Blue')]].forEach(([v, n]) => sel.appendChild(el('option', {value:v, text:T(n)})));
    b.appendChild(row(L3('色版：', '通道：', 'Channel:'), sel, el('span', {class:'hwarn', text:'⚠', style:'color:#e0b040;visibility:hidden'})));
    b.appendChild(el('canvas', {class:'hcv', style:'width:100%;height:100px;display:block;background:#1e1e1e'}));
    b.appendChild(el('div', {class:'kv hst'}));
  },
  refresh(b){
    const now = performance.now(), key = History.past.length + ':' + History.future.length + ':' + Doc.layers.length;
    const stale = key !== Histo.key;
    if (stale && now - Histo.t >= 250){ Histo.data = histoCompute(); Histo.t = now; Histo.key = key; }
    else if (stale) setTimeout(() => P.refresh('histogram'), 260);
    b.querySelector('.hwarn').style.visibility = key !== Histo.key ? 'visible' : 'hidden';
    if (!Histo.data){ Histo.data = histoCompute(); Histo.key = key; Histo.t = now; }
    const ch = b.querySelector('.hch').value, a = Histo.data[ch], cv = b.querySelector('.hcv'), W = cv.clientWidth || 240, H = 100;
    cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
    const sorted = Array.from(a).sort((x, y) => x - y), cap = Math.max(1, sorted[250] * 1.1);   // tone.rs:165-189 第 251 小的那格×1.1
    ctx.fillStyle = {rgb:'rgb(190,190,190)', red:'rgb(235,80,80)', green:'rgb(80,205,95)', blue:'rgb(90,140,255)'}[ch];
    for (let i = 0; i < 256; i++){ const hh = Math.min(1, a[i] / cap) * H; ctx.fillRect(i * W / 256, H - hh, Math.max(1, W / 256), hh); }
    const st = histoStats(a), box = b.querySelector('.hst'); box.innerHTML = '';
    [[L3('平均值：', '平均值：', 'Mean:'), st.mean.toFixed(2)], [L3('標準差：', '标准偏差：', 'Std Dev:'), st.std.toFixed(2)], [L3('中間值：', '中间值：', 'Median:'), st.median],
     [L3('像素：', '像素：', 'Pixels:'), Doc.width * Doc.height], [L3('快取階層：', '高速缓存级别：', 'Cache Level:'), Math.ceil(Math.log2(Math.max(Math.max(Doc.width, Doc.height) / 384, 1))) + 1]]
      .forEach(([k, v]) => { box.appendChild(el('b', {text:T(k)})); box.appendChild(el('span', {text:String(v)})); });
  }});

/* ═══════════ 颜色（panels.rs:2085-2177 color_field：S/B 场＋色相条，只改前景色） ═══════════ */
function rgb2hsb(r, g, b){ r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d){ h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; if (h < 0) h += 1; } return [h, mx ? d / mx : 0, mx]; }
function hsb2rgb(h, s, v){ const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6), p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i]; return [r * 255, g * 255, b * 255]; }
PsWindow.hsb = {rgb2hsb, hsb2rgb};
const ColorSt = {hue:0};
function setFg(h){ return runCmd('eyedropper.setColors', {foreground:h}); }
function setBg(h){ return runCmd('eyedropper.setColors', {background:h}); }
P.define('color', {title:L3('顏色', '颜色', 'Color'), w:270,
  build(b){
    const wrap = el('div', {style:'display:flex;gap:8px;align-items:flex-start'});
    const chips = el('div', {style:'position:relative;width:34px;height:34px;flex:0 0 34px'}, [
      el('div', {class:'cbg', style:'position:absolute;left:10px;top:10px;width:22px;height:22px;border:1px solid #000'}),
      el('div', {class:'cfg', style:'position:absolute;left:0;top:0;width:22px;height:22px;border:1px solid #000'})]);
    const field = el('canvas', {class:'cfield', style:'flex:1;height:120px;cursor:crosshair;min-width:60px'});
    const hue = el('canvas', {class:'chue', style:'width:14px;flex:0 0 14px;height:120px;cursor:ns-resize'});
    wrap.append(chips, field, hue); b.appendChild(wrap);
    b.appendChild(el('div', {class:'hint cread', style:'font-family:monospace'}));
    // panels.rs:1204-1229 color_picker（Studio 版颜色页）：色相／饱和度／亮度三条滑杆＋十六进位；我们两版合一放在场下面
    const hsbRow = (k, label, max, unit) => { const r = el('input', {type:'range', min:0, max, step:1, dataset:{hsb:k}}), n = el('input', {type:'number', min:0, max, step:1, dataset:{hsbn:k}, style:'width:52px'});
      const go = v => { const c = hexRgb(fg()), hsb = rgb2hsb(...c); if (k === 'h'){ ColorSt.hue = clamp(v / 360, 0, 0.9999); hsb[0] = ColorSt.hue; } else { if (hsb[1] < 0.01 || hsb[2] < 0.01) hsb[0] = ColorSt.hue; hsb[k === 's' ? 1 : 2] = clamp(v / 100, 0, 1); }
        runCmd('ps.color.set', {h:hsb[0] * 360, s:hsb[1] * 100, b:hsb[2] * 100}); };
      r.oninput = () => go(+r.value); n.onchange = () => go(+n.value);
      return row(label, r, n, el('span', {text:unit, style:'min-width:12px'})); };
    b.appendChild(hsbRow('h', L3('色相', '色相', 'Hue'), 360, '°')); b.appendChild(hsbRow('s', L3('飽和度', '饱和度', 'Saturation'), 100, '%')); b.appendChild(hsbRow('v', L3('亮度', '亮度', 'Brightness'), 100, '%'));
    const hex = el('input', {type:'text', class:'chex', style:'width:80px;font-family:monospace', onchange:() => runCmd('ps.color.set', {hex:hex.value})});
    b.appendChild(row('#', hex));
    const pickSB = e => { const r = field.getBoundingClientRect(), s = clamp((e.clientX - r.left) / r.width, 0, 1), v = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
      const c = hsb2rgb(ColorSt.hue, s, v); setFg(rgbHex(...c)); };
    const pickH = e => { const r = hue.getBoundingClientRect(); ColorSt.hue = clamp(1 - (e.clientY - r.top) / r.height, 0, 0.9999);
      const [, s, v] = rgb2hsb(...hexRgb(fg())); const c = hsb2rgb(ColorSt.hue, s, v); setFg(rgbHex(...c)); P.refresh('color'); };
    [[field, pickSB], [hue, pickH]].forEach(([n, f]) => n.addEventListener('pointerdown', e => { n.setPointerCapture(e.pointerId); f(e);
      const mv = ev => f(ev), up = () => { n.removeEventListener('pointermove', mv); n.removeEventListener('pointerup', up); }; n.addEventListener('pointermove', mv); n.addEventListener('pointerup', up); }));
  },
  refresh(b){
    const c = hexRgb(fg()), [h, s, v] = rgb2hsb(...c);
    if (s >= 0.01 && v >= 0.01) ColorSt.hue = h;                 // 灰色记住原本的色相
    b.querySelector('.cfg').style.background = fg(); b.querySelector('.cbg').style.background = bg();
    const f = b.querySelector('.cfield'), W = f.clientWidth || 160, H = 120; f.width = W; f.height = H;
    const x = f.getContext('2d'), base = hsb2rgb(ColorSt.hue, 1, 1);
    const g1 = x.createLinearGradient(0, 0, W, 0); g1.addColorStop(0, '#fff'); g1.addColorStop(1, rgbHex(...base)); x.fillStyle = g1; x.fillRect(0, 0, W, H);
    const g2 = x.createLinearGradient(0, 0, 0, H); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, '#000'); x.fillStyle = g2; x.fillRect(0, 0, W, H);
    x.beginPath(); x.arc(s * W, (1 - v) * H, 6.5, 0, 7); x.strokeStyle = 'rgba(0,0,0,.63)'; x.stroke(); x.beginPath(); x.arc(s * W, (1 - v) * H, 5, 0, 7); x.strokeStyle = '#fff'; x.stroke();
    const hu = b.querySelector('.chue'); hu.width = 14; hu.height = H; const y = hu.getContext('2d');
    for (let i = 0; i < 24; i++){ y.fillStyle = rgbHex(...hsb2rgb(1 - i / 24, 1, 1)); y.fillRect(0, i * H / 24, 14, H / 24 + 1); }
    const py = (1 - ColorSt.hue) * H; y.fillStyle = '#fff'; y.beginPath(); y.moveTo(0, py - 4); y.lineTo(5, py); y.lineTo(0, py + 4); y.fill();
    b.querySelector('.cread').textContent = `${fg().toUpperCase()}   R ${c[0]}  G ${c[1]}  B ${c[2]}`;
    const hv = {h:Math.round(ColorSt.hue * 360), s:Math.round(s * 100), v:Math.round(v * 100)}, act = P.activeEl(b);
    Object.keys(hv).forEach(k => { const r = b.querySelector(`[data-hsb="${k}"]`), n = b.querySelector(`[data-hsbn="${k}"]`); if (r && act !== r) r.value = hv[k]; if (n && act !== n) n.value = hv[k]; });
    const hx = b.querySelector('.chex'); if (hx && act !== hx) hx.value = fg().toUpperCase();
  }});
CMD.reg('ps.color.set', {i18n:'', params:'{hex?:"#rrggbb" | h?:0..360, s?:0..100, b?:0..100（HSB，缺的照目前前景色）, background?:bool} 颜色面板：设前景色（background＝背景色）；滑杆与十六进位框走这条 → {ok, color}'}, p => {
  let h;
  if (typeof p.hex === 'string'){ const m = p.hex.trim().replace(/^#?/, '#'); if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(m)) return fail('ps.color.set: `hex` must be #rrggbb'); h = rgbHex(...hexRgb(m)); }
  else {
    const cur = rgb2hsb(...hexRgb(p.background ? bg() : fg()));
    if (cur[1] < 0.01 || cur[2] < 0.01) cur[0] = ColorSt.hue;
    const hh = typeof p.h === 'number' ? clamp(p.h / 360, 0, 0.9999) : cur[0], ss = typeof p.s === 'number' ? clamp(p.s / 100, 0, 1) : cur[1], bb = typeof p.b === 'number' ? clamp(p.b / 100, 0, 1) : cur[2];
    if (typeof p.h === 'number') ColorSt.hue = hh;
    h = rgbHex(...hsb2rgb(hh, ss, bb));
  }
  (p.background ? setBg : setFg)(h); P.refresh('color'); return {ok:true, color:h};
});

/* ═══════════ 色板（panels.rs:1133-1202；40 色照抄；左键前景、右键背景） ═══════════ */
const PS_SWATCHES = [[0,0,0],[26,26,26],[51,51,51],[77,77,77],[102,102,102],[128,128,128],[153,153,153],[179,179,179],[204,204,204],[255,255,255],
  [236,128,128],[244,176,132],[250,224,128],[214,240,128],[150,232,150],[128,232,200],[128,220,240],[128,176,244],[168,144,244],[232,144,232],
  [230,40,40],[245,120,30],[250,210,30],[160,220,40],[40,200,80],[30,200,170],[30,170,230],[40,100,230],[120,70,220],[210,50,180],
  [120,20,20],[130,60,10],[130,110,10],[80,120,20],[20,100,40],[10,100,90],[10,80,120],[20,50,120],[60,30,110],[110,20,90]];
/* 自己加的色板（拾色器「添加到色板」、色板面板「新建色板」；PS 存在偏好里、重开还在 ⇒ localStorage）：接在内建 40 色后面，index 40 起 */
const USER_SW_KEY = 'dl.ps.swatches.user';
const userSw = () => { try { const a = JSON.parse(localStorage.getItem(USER_SW_KEY) || '[]'); return Array.isArray(a) ? a.filter(u => u && /^#[0-9a-f]{6}$/i.test(u.color)) : []; } catch (e){ return []; } };
const saveUserSw = a => { try { localStorage.setItem(USER_SW_KEY, JSON.stringify(a)); } catch (e){} };
const allSw = () => PS_SWATCHES.map(c => ({color:rgbHex(...c), name:rgbHex(...c)})).concat(userSw().map(u => ({color:u.color.toLowerCase(), name:u.name || u.color, user:true})));
CMD.reg('ps.swatches.apply', {i18n:'', params:'{index:0..（40 起是自己加的）, background?:bool} 色板：第 index 色设成前景色（background＝背景色）→ {ok, color}'}, p => {
  const s = allSw()[+p.index]; if (!s) return {ok:false, error:'no such swatch'};
  (p.background ? setBg : setFg)(s.color); return {ok:true, color:s.color, name:s.name};
});
CMD.reg('ps.swatches.add', {i18n:'', params:'{color?:"#rrggbb"（缺省＝前景色）, name?:str（缺省「色板 N」）} 新建色板（PS 色板面板「新建色板」／拾色器「添加到色板」；存在偏好里）→ {ok, index, name, color}'}, p => {
  const h = typeof p.color === 'string' ? p.color.trim().replace(/^#?/, '#').toLowerCase() : fg();
  if (!/^#[0-9a-f]{6}$/.test(h)) return fail('ps.swatches.add: `color` must be #rrggbb');
  const a = userSw(); let name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : '';
  if (!name){ const base = T(L3('色票', '色板', 'Swatch')); for (let n = 1; ; n++){ const t = base + ' ' + n; if (!a.some(u => u.name === t)){ name = t; break; } } }
  a.push({color:h, name}); saveUserSw(a); P.refresh('swatches');
  return {ok:true, index:PS_SWATCHES.length + a.length - 1, name, color:h};
});
CMD.reg('ps.swatches.delete', {i18n:'', params:'{index} 删除自己加的色板（PS：Alt＋按一下色板；内建 40 色不能删）→ {ok}'}, p => {
  const i = +p.index - PS_SWATCHES.length, a = userSw();
  if (!(i >= 0 && i < a.length)) return fail('ps.swatches.delete: only swatches you added (index ≥ 40) can be deleted');
  a.splice(i, 1); saveUserSw(a); P.refresh('swatches'); return {ok:true};
});
CMD.reg('ps.swatches.list', {i18n:'', params:'{} 色板清单 → {swatches:[{index, color, name, user?}]}'}, () => ({ok:true, swatches:allSw().map((s, i) => Object.assign({index:i}, s))}));
P.define('swatches', {title:L3('色票', '色板', 'Swatches'), w:250,
  refresh(b){
    b.innerHTML = '';
    const g = el('div', {class:'grid', style:'display:grid;grid-template-columns:repeat(10,1fr);gap:4px'});
    allSw().forEach((s, i) => g.appendChild(el('div', {class:'sw', style:`width:auto;aspect-ratio:1;height:auto;border-radius:4px;background:${s.color}`, title:s.name, dataset:{i, user:s.user ? '1' : ''},
      onclick:e => e.altKey && s.user ? runCmd('ps.swatches.delete', {index:i}) : runCmd('ps.swatches.apply', {index:i}),
      oncontextmenu:e => { e.preventDefault(); runCmd('ps.swatches.apply', {index:i, background:true}); }})));
    b.appendChild(g);
    b.appendChild(el('div', {class:'hint', text:T(L3('按一下設定前景色 · 按右鍵設定背景色 · Alt＋按一下刪除自己加的色票', '单击设置前景色 · 右键设置背景色 · Alt＋单击删除自己加的色板', 'Click sets foreground · right-click sets background · Alt-click deletes a swatch you added'))}));
  }});

/* ═══════════ 动作（actions.rs:37-163） ═══════════ */
const ACT_LS = 'dlActions.v1';
const SKIP_REC = /^(doc\.inspect|doc\.renderPreview|eyedropper\.pixel|edit\.undo|edit\.redo|text\.info|text\.fonts|panel\.|ps\.history\.|ps\.histogram\.|ps\.actions\.|ai\.actions\.|.*\.(list|get|state|info)$)/;
const Act = PsWindow.actions = {
  list: (() => { try { return JSON.parse(localStorage.getItem(ACT_LS) || '[]'); } catch(e){ return []; } })(),
  selected: null, recording: null, expanded: {},
  save(){ try { localStorage.setItem(ACT_LS, JSON.stringify(this.list)); } catch(e){} },
  record(id, p){ if (this.recording !== null && !SKIP_REC.test(id) && !this._playing) this.list[this.recording].steps.push([id, JSON.parse(JSON.stringify(p || {}))]); }
};
if (!CMD.__psWinAct){
  CMD.__psWinAct = true;
  const run = CMD.run;
  CMD.run = function(id, p){ if (Hist.depth === 0) Act.record(id, p); return run.apply(this, arguments); };
}
CMD.reg('ps.actions.list', {i18n:'', params:'{} → {ok, actions:[{name, steps:[[id, params]…]}], selected, recording}'}, () => ({ok:true, actions:JSON.parse(JSON.stringify(Act.list)), selected:Act.selected, recording:Act.recording}));
CMD.reg('ps.actions.record', {i18n:'', params:'{name?} 动作面板 ● 录制：新建「Action N」并开始录下之后跑的命令（查询类不录）→ {ok, index}'}, p => {
  if (Act.recording !== null) return {ok:false, error:'already recording'};
  Act.list.push({name:typeof p.name === 'string' && p.name ? p.name : `Action ${Act.list.length + 1}`, steps:[]});
  Act.recording = Act.selected = Act.list.length - 1; Act.expanded[Act.recording] = true; Act.save(); return {ok:true, index:Act.recording};
});
CMD.reg('ps.actions.stop', {i18n:'', params:'{} 动作面板 ■ 停止录制 → {ok, steps}'}, () => {
  if (Act.recording === null) return {ok:true, steps:0};
  const n = Act.list[Act.recording].steps.length; Act.recording = null; Act.save(); return {ok:true, steps:n};
});
CMD.reg('ps.actions.play', {i18n:'', params:'{index?（缺省＝选中的）} 动作面板 ▶ 播放：逐条重跑，遇到失败就停 → {ok, played, failed?}'}, p => {
  const i = p.index !== undefined ? +p.index : Act.selected, A = Act.list[i]; if (!A) return {ok:false, error:'no action selected'};
  Act._playing = true; let n = 0;
  try { for (const [id, prm] of A.steps){ let r; try { r = CMD.run(id, prm); } catch(e){ r = {ok:false, error:String(e)}; }
    if (r && r.ok === false) return {ok:false, played:n, failed:id, error:`Step ${n + 1} (${id}) failed: ${r.error || ''}`}; n++; } }
  finally { Act._playing = false; }
  return {ok:true, played:n};
});
CMD.reg('ps.actions.delete', {i18n:'', params:'{index?} 动作面板 🗑 删除选中的动作（录制中不行）→ {ok}'}, p => {
  if (Act.recording !== null) return {ok:false, error:'recording'};
  const i = p.index !== undefined ? +p.index : Act.selected; if (!Act.list[i]) return {ok:false, error:'no action selected'};
  Act.list.splice(i, 1); Act.selected = null; Act.save(); return {ok:true};
});
CMD.reg('ps.actions.select', {i18n:'', params:'{index}'}, p => { Act.selected = Act.list[+p.index] ? +p.index : null; return {ok:true}; });
P.define('actions', {title:L3('動作', '动作', 'Actions'), w:260, h:280,
  build(b){ b.appendChild(el('div', {class:'list alist', style:'min-height:120px'}));
    b.appendChild(el('div', {class:'bar', style:'justify-content:flex-start'}, [
      btn('■', L3('停止播放/記錄', '停止播放/记录', 'Stop'), () => runCmd('ps.actions.stop'), {dataset:{a:'stop'}}),
      btn('●', L3('開始記錄', '开始记录', 'Record'), () => runCmd('ps.actions.record'), {dataset:{a:'rec'}}),
      btn('▶', L3('播放選取範圍', '播放选定的动作', 'Play'), () => runCmd('ps.actions.play'), {dataset:{a:'play'}}),
      btn('＋', L3('建立新動作', '创建新动作', 'New'), () => runCmd('ps.actions.record'), {dataset:{a:'new'}}),
      btn('🗑', L3('刪除', '删除', 'Delete'), () => runCmd('ps.actions.delete'), {dataset:{a:'del'}})])); },
  refresh(b){
    const box = b.querySelector('.alist'); box.innerHTML = '';
    if (!Act.list.length) box.appendChild(el('div', {class:'hint', style:'padding:6px', text:T(L3('按 ● 錄下一連串編輯，再按 ▶ 在任何文件上重播。', '按 ● 录下一连串编辑，再按 ▶ 在任何文档上播放。', 'Record ● a sequence of edits, then play ▶ it on any document.'))}));
    Act.list.forEach((A, i) => {
      const r = el('div', {class:'li' + (Act.selected === i ? ' on' : ''), dataset:{i}}, [
        el('span', {text:Act.expanded[i] ? '▾' : '▸', onclick:e => { e.stopPropagation(); Act.expanded[i] = !Act.expanded[i]; P.refresh('actions'); }}),
        el('span', {text:'▶ ' + A.name, style:'flex:1'}),
        Act.recording === i ? el('span', {text:'●', style:'color:rgb(230,60,60)'}) : null,
        el('span', {class:'hint', text:`${A.steps.length} steps`})]);
      r.onclick = () => { runCmd('ps.actions.select', {index:i}); P.refresh('actions'); };
      r.ondblclick = () => runCmd('ps.actions.play', {index:i});
      box.appendChild(r);
      if (Act.expanded[i]) A.steps.forEach(([id]) => box.appendChild(el('div', {class:'li', style:'padding-left:30px;font-size:11px', text:Hist.label(id)})));
    });
    const rec = b.querySelector('[data-a=rec]'); rec.style.color = Act.recording !== null ? 'rgb(230,60,60)' : '';
  }});
if (!CMD.__psWinActRefresh){ CMD.__psWinActRefresh = true; const r = CMD.run; CMD.run = function(){ const o = r.apply(this, arguments); if (Act.recording !== null && P.isOpen('actions')) P.schedule('doc'); return o; }; }

/* ═══════════ 调整（panels.rs:2047-2083：16 钮 → layer.newAdjustmentLayer.<kind>，再切到属性） ═══════════ */
const ADJ = [['brightnessContrast', '☀', L3('亮度/對比', '亮度/对比度', 'Brightness/Contrast')], ['levels', '▤', L3('色階', '色阶', 'Levels')], ['curves', '∿', L3('曲線', '曲线', 'Curves')],
  ['exposure', '◐', L3('曝光度', '曝光度', 'Exposure')], ['vibrance', '✦', L3('自然飽和度', '自然饱和度', 'Vibrance')], ['hueSaturation', '💧', L3('色相/飽和度', '色相/饱和度', 'Hue/Saturation')],
  ['colorBalance', '⚖', L3('色彩平衡', '色彩平衡', 'Color Balance')], ['blackWhite', '◑', L3('黑白', '黑白', 'Black & White')], ['photoFilter', '◉', L3('相片濾鏡', '照片滤镜', 'Photo Filter')],
  ['channelMixer', '☰', L3('色版混合器', '通道混合器', 'Channel Mixer')], ['invert', '⊟', L3('負片效果', '反相', 'Invert')], ['posterize', '▦', L3('色調分離', '色调分离', 'Posterize')],
  ['threshold', '■', L3('臨界值', '阈值', 'Threshold')], ['gradientMap', '🎨', L3('漸層對應', '渐变映射', 'Gradient Map')], ['selectiveColor', '▣', L3('選取顏色', '可选颜色', 'Selective Color')],
  ['colorLookup', '▩', L3('顏色查詢', '颜色查找', 'Color Lookup')]];
CMD.reg('ps.adjustments.add', {i18n:'', params:'{kind:"brightnessContrast|levels|curves|exposure|vibrance|hueSaturation|colorBalance|blackWhite|photoFilter|channelMixer|invert|posterize|threshold|gradientMap|selectiveColor|colorLookup"} 调整面板：加调整图层（没有调整图层命令时退回 图像 ▸ 调整 的对话框）→ {ok, via}'}, p => {
  if (!ADJ.some(a => a[0] === p.kind)) return {ok:false, error:'unknown adjustment ' + p.kind};
  const a = 'ps.layer.newAdjustmentLayer.' + p.kind, b = 'ps.image.adjustments.' + p.kind;
  let r;
  if (has(a)) r = CMD.run(a, {});
  else if (has(b)) r = CMD.run(b, p.kind === 'invert' ? {} : {dialog:true});
  else return {ok:false, error:'no adjustment command'};
  if (!r || r.ok !== false) P.open('properties');
  return Object.assign({ok:true, via:has(a) ? a : b}, r || {});
});
P.define('adjustments', {title:L3('調整', '调整', 'Adjustments'), w:250,
  build(b){ b.appendChild(el('div', {class:'hint', text:T(L3('新增調整', '添加调整', 'Add an adjustment'))}));
    const g = el('div', {class:'grid'}); ADJ.forEach(([k, ic, n]) => {
      const bt = btn(ic, n, () => runCmd('ps.adjustments.add', {kind:k}), {dataset:{kind:k}, style:'width:30px;height:30px'});
      // 钮上画跟图层缩图同一套的调整图示（ui.js UI.adjIcon：深灰底白线条，照 PS 2020）；画不了才留文字符号
      if (window.UI && UI.adjIcon){ try { const cv = document.createElement('canvas'); cv.width = 24; cv.height = 20; cv.style.cssText = 'display:block;margin:auto;pointer-events:none'; UI.adjIcon(cv.getContext('2d'), k); bt.textContent = ''; bt.appendChild(cv); } catch (e){} }
      g.appendChild(bt); }); b.appendChild(g); }});

/* ═══════════ 属性（doc_props_ui.rs:117-267 文件；layer_props_ui.rs:97-180 图层；panels.rs:1953-1999 调整层；props_layout.rs:118-131 快速操作） ═══════════ */
const PropsSt = PsWindow.props = {docLink:false, layerLink:true};
/* 数字框：Enter＝送出并离开输入框（面板正在打字时不重画；送出后要马上跟着刷） */
const numIn = (v, k, o) => el('input', Object.assign({type:'number', value:v, dataset:{k}, onkeydown:e => { if (e.key === 'Enter') setTimeout(() => e.target.blur(), 0); }}, o || {}));
const MODES = [['bitmap', L3('點陣圖', '位图', 'Bitmap')], ['grayscale', L3('灰階', '灰度', 'Grayscale')], ['duotone', L3('雙色調', '双色调', 'Duotone')], ['indexedColor', L3('索引色', '索引颜色', 'Indexed Color')],
  ['rgb', L3('RGB 色彩', 'RGB 颜色', 'RGB Color')], ['cmyk', L3('CMYK 色彩', 'CMYK 颜色', 'CMYK Color')], ['lab', L3('Lab 色彩', 'Lab 颜色', 'Lab Color')], ['multichannel', L3('多重色版', '多通道', 'Multichannel')]];
const MODE_DIALOG = ['bitmap', 'duotone', 'indexedColor'];
const DEPTHS = [[8, L3('8 位元/色版', '8 位/通道', '8 Bits/Channel')], [16, L3('16 位元/色版', '16 位/通道', '16 Bits/Channel')], [32, L3('32 位元/色版', '32 位/通道', '32 Bits/Channel')]];
const UNITS = [['pixels', L3('像素', '像素', 'Pixels')], ['inches', L3('英吋', '英寸', 'Inches')], ['cm', L3('公分', '厘米', 'Centimeters')], ['mm', L3('公釐', '毫米', 'Millimeters')],
  ['points', L3('點', '点', 'Points')], ['picas', L3('Pica', '派卡', 'Picas')], ['percent', L3('百分比', '百分比', 'Percent')]];
const selectOf = (opts, val, onchange, k) => { const s = el('select', {dataset:{k}, onchange:() => onchange(s.value)}); opts.forEach(([v, n]) => s.appendChild(el('option', {value:v, text:T(n)}))); s.value = String(val); return s; };
const iconBtn = (txt, tip, on, fn, k) => btn(txt, tip, fn, {class:on ? 'on' : '', dataset:{k}, style:'min-width:26px'});
function docProps(b){
  const V = window.PsView;
  b.appendChild(el('div', {class:'row', style:'font-weight:600'}, [el('span', {text:'🗎', style:'min-width:0'}), el('span', {text:T(L3('文件', '文档', 'Document'))})]));
  if (section(b, 'canvas', L3('版面', '画布', 'Canvas'))){
    const w = numIn(Doc.width, 'w', {min:1, max:300000}), h = numIn(Doc.height, 'h', {min:1, max:300000});
    // doc_props_ui.rs:55 canvas_resize_params：链接时另一边按比例
    const apply = which => { let W = Math.max(1, Math.round(+w.value)), H = Math.max(1, Math.round(+h.value));
      if (PropsSt.docLink){ if (which === 'w') H = Math.max(1, Math.round(W * Doc.height / Doc.width)); else W = Math.max(1, Math.round(H * Doc.width / Doc.height)); }
      if (W !== Doc.width || H !== Doc.height) runCmd('ps.image.canvasSize', {width:W, height:H, anchor:'center'}); };
    w.onchange = () => apply('w'); h.onchange = () => apply('h');
    const dim = t => el('span', {text:t, style:'color:#777;border:1px solid #3a3a3a;border-radius:3px;padding:1px 6px'});
    b.appendChild(row(null, iconBtn(PropsSt.docLink ? '🔗' : '⛓', L3('連結寬度和高度', '链接宽度和高度', 'Link width and height'), PropsSt.docLink, () => { PropsSt.docLink = !PropsSt.docLink; P.refresh('properties'); }, 'docLink'),
      el('span', {text:'W'}), w, el('span', {text:'X'}), dim('0 px')));
    b.appendChild(row(null, el('span', {style:'width:26px'}), el('span', {text:'H'}), h, el('span', {text:'Y'}), dim('0 px')));
    const portrait = Doc.height > Doc.width, swap = () => runCmd('ps.image.canvasSize', {width:Doc.height, height:Doc.width, anchor:'center'});
    b.appendChild(row(null, iconBtn('▯', L3('直式', '纵向', 'Portrait'), portrait, () => { if (!portrait && Doc.width !== Doc.height) swap(); }, 'portrait'),
      iconBtn('▭', L3('橫式', '横向', 'Landscape'), !portrait, () => { if (portrait) swap(); }, 'landscape')));
    b.appendChild(el('div', {class:'hint', text:`${T(L3('解析度', '分辨率', 'Resolution'))}: ${Math.round(+Doc.dpi || 72)} ${T(L3('像素/英吋', '像素/英寸', 'pixels/inch'))}`}));
    const mode = Doc.colorMode || 'rgb';
    b.appendChild(row(L3('模式', '模式', 'Mode'), selectOf(MODES.filter(([k]) => has('ps.image.mode.' + k)), mode, v => runCmd('ps.image.mode.' + v, MODE_DIALOG.includes(v) ? {dialog:true} : {}), 'mode')));
    b.appendChild(row(null, selectOf(DEPTHS, Doc.depth || 8, v => runCmd('ps.image.mode.bits' + v), 'depth')));
    // 原码：填色只在没有背景层的文件能改，选单只有「背景色」一项（doc_props_ui.rs:200-209 没接命令）⇒ 照摆、灰掉
    b.appendChild(row(L3('填滿', '填充', 'Fill'), Object.assign(selectOf([['bg', L3('背景色', '背景色', 'Background Color')]], 'bg', () => {}, 'fill'), {disabled:true})));
  }
  if (V && section(b, 'rulers', L3('尺標與格點', '标尺和网格', 'Rulers & Grids'))){
    const unit = window.PsEdit && PsEdit.units ? PsEdit.units.unit() : 'pixels';
    b.appendChild(row(null, iconBtn('📏', L3('尺標', '标尺', 'Rulers'), V.e.rulers, () => runCmd('ps.view.rulers'), 'rulers'), iconBtn('#', L3('格點', '网格', 'Grid'), V.e.grid, () => runCmd('ps.view.show.grid'), 'grid'),
      iconBtn('⊞', L3('像素格點', '像素网格', 'Pixel Grid'), V.show.pixelGrid, () => runCmd('ps.view.show.pixelGrid'), 'pixelGrid'),
      has('ps.prefs.set') ? selectOf(UNITS, unit, v => { runCmd('ps.prefs.set', {path:'unitsAndRulers.rulers', value:v}); P.refresh(); }, 'units') : null));
  }
  if (V && section(b, 'guides', L3('參考線', '参考线', 'Guides'))){
    b.appendChild(row(null, iconBtn('👁', L3('顯示參考線', '显示参考线', 'Show Guides'), V.e.guides, () => runCmd('ps.view.show.guides'), 'guides'), iconBtn('🔒', L3('鎖定參考線', '锁定参考线', 'Lock Guides'), V.locked(), () => runCmd('ps.view.lockGuides'), 'lockGuides'),
      btn(T(L3('新增參考線…', '新建参考线…', 'New Guide…')), null, () => runCmd('ps.view.newGuide', {dialog:true})), btn(T(L3('清除', '清除', 'Clear')), null, () => runCmd('ps.view.clearGuides'))));
  }
}
/* 调整层参数（panels.rs:1953 adjustment_controls → adjust_editors::layer_editor）：最上层的数值／勾选／颜色直接改；曲线、各通道等巢状参数开「编辑…」对话框 */
const ADJ_KEY = {brightness:L3('亮度', '亮度', 'Brightness'), contrast:L3('對比', '对比度', 'Contrast'), legacy:L3('使用舊版', '使用旧版', 'Use Legacy'), inBlack:L3('輸入黑', '输入黑场', 'Input Black'),
  gamma:L3('Gamma', '灰度系数', 'Gamma'), inWhite:L3('輸入白', '输入白场', 'Input White'), outBlack:L3('輸出黑', '输出黑场', 'Output Black'), outWhite:L3('輸出白', '输出白场', 'Output White'),
  exposure:L3('曝光度', '曝光度', 'Exposure'), offset:L3('位移', '位移', 'Offset'), vibrance:L3('自然飽和度', '自然饱和度', 'Vibrance'), saturation:L3('飽和度', '饱和度', 'Saturation'),
  hue:L3('色相', '色相', 'Hue'), lightness:L3('明亮', '明度', 'Lightness'), colorize:L3('上色', '着色', 'Colorize'), preserveLuminosity:L3('保留明度', '保留明度', 'Preserve Luminosity'),
  tint:L3('色調', '色调', 'Tint'), tintColor:L3('色調顏色', '色调颜色', 'Tint Color'), reds:L3('紅色', '红色', 'Reds'), yellows:L3('黃色', '黄色', 'Yellows'), greens:L3('綠色', '绿色', 'Greens'),
  cyans:L3('青色', '青色', 'Cyans'), blues:L3('藍色', '蓝色', 'Blues'), magentas:L3('洋紅', '洋红', 'Magentas'), color:L3('顏色', '颜色', 'Color'), density:L3('密度', '浓度', 'Density'),
  monochrome:L3('單色', '单色', 'Monochrome'), levels:L3('色階', '色阶', 'Levels'), level:L3('臨界值', '阈值色阶', 'Threshold Level'), reverse:L3('反向', '反向', 'Reverse'), dither:L3('混色', '仿色', 'Dither'),
  method:L3('方法', '方法', 'Method')};
function adjRange(kind, key){
  const c = CMD.map['ps.image.adjustments.' + kind], m = c && String(c.params || '').match(new RegExp('"' + key + '":(-?[\\d.]+)\\.\\.(-?[\\d.]+)'));
  return m ? [+m[1], +m[2]] : null;
}
/* 曲线调整层的属性（PS 属性面板）：曲线图（下面所有层的直方图）＋点（拖＝移、点空处＝加、拖出框外＝删）、
   图下方的输入黑场 ▲／白场 △ 滑块（拖＝移动曲线两端点的输入值）。拖曳中只即时预览，放开才走 ps.layer.setAdjustment（一步历史）；通道等完整编辑仍在「编辑…」 */
const CurveHist = {key:null, h:null};
function curveHistBelow(L){
  const i = Doc.layers.indexOf(L), key = L.id + '|' + i + '|' + History.past.length + '|' + Doc.width + 'x' + Doc.height;
  if (CurveHist.key === key) return CurveHist.h;
  const h = new Float64Array(256);
  try {
    const k = Math.min(1, 256 / Math.max(Doc.width, Doc.height)), W = Math.max(1, Math.round(Doc.width * k)), H = Math.max(1, Math.round(Doc.height * k));
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', {willReadFrequently:true});
    if (window.PsLayer && PsLayer.flattenLayers) x.drawImage(PsLayer.flattenLayers(Doc.layers.slice(0, Math.max(0, i))), 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data;
    for (let j = 0; j < d.length; j += 4) if (d[j + 3]) h[Math.round(0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2])]++;
  } catch (e){ console.warn(e); }
  CurveHist.key = key; CurveHist.h = h; return h;
}
const CURVE_CH = [['points', L3('RGB', 'RGB', 'RGB'), '#e6e8eb'], ['red', L3('紅', '红', 'Red'), '#e05050'], ['green', L3('綠', '绿', 'Green'), '#50c060'], ['blue', L3('藍', '蓝', 'Blue'), '#5080e0']];
const CurveCh = {};                                                    // 图层 id → 正在编辑的通道（PS 属性面板曲线的通道下拉）
/* PS 2020 属性面板的曲线：预设下拉、通道、左边那排工具（手指＝在图像上单击并拖动修改曲线、编辑点、铅笔、平滑、黑／灰／白场吸管）；
   曲线显示选项在面板选单「曲线显示选项…」。曲线逻辑共用 ps-image.js 的 PsImage.CurveKit */
const CurveTool = {id:null, tool:null};                                // 手上拿的吸管／手指（只对这个曲线层有效）
const CK_TIPS = {tat:L3('在影像上按一下並拖移可修改曲線', '在图像上单击并拖动可修改曲线', 'Click and drag in image to modify the curve'),
  points:L3('編輯點以修改曲線', '编辑点以修改曲线', 'Edit points to modify the curve'), pencil:L3('以繪圖方式修改曲線', '通过绘制来修改曲线', 'Draw to modify the curve'),
  smooth:L3('平滑曲線值', '平滑曲线值', 'Smooth the curve values'), black:L3('在影像中取樣以設定黑點', '在图像中取样以设置黑场', 'Sample in image to set black point'),
  gray:L3('在影像中取樣以設定灰點', '在图像中取样以设置灰场', 'Sample in image to set gray point'), white:L3('在影像中取樣以設定白點', '在图像中取样以设置白场', 'Sample in image to set white point')};
function curvesProps(b, L){
  const K = window.PsImage && PsImage.CurveKit; if (!K) return;
  const G = 200, P0 = 7, orig = L.adjust, ch = CurveCh[L.id] || 'points', chCol = (CURVE_CH.find(c => c[0] === ch) || CURVE_CH[0])[2];
  const op = K.opts(), pig = op.amount === 'pigment';
  if (CurveTool.id !== L.id){ CurveTool.id = L.id; CurveTool.tool = null; }
  const base = () => K.full(orig.params || {}), v = base(), pen = () => K.isPen(v[ch]), pts = () => v[ch];
  /* 放开才走 ps.layer.setAdjustment（一步历史），只送改了的通道 */
  const commit = () => {
    L.adjust = orig;                                                   // 预览挂回原来的（历史快照记改之前），再走命令
    const o = base(), q = {id:L.id}; let diff = false;
    K.CH.forEach(k => { const a = K.isPen(v[k]) ? {pencil:v[k].pencil.map(x => Math.round(x * 100) / 100)} : v[k].map(p => [Math.round(p[0]), Math.round(p[1])]);
      if (JSON.stringify(a) !== JSON.stringify(o[k])){ q[k] = a; diff = true; } });
    if (diff) runCmd('ps.layer.setAdjustment', q); else if (window.UI) UI.draw();
    P.refresh('properties');
  };
  const pid = K.presetOf(v);
  b.appendChild(row(L3('預設集', '预设', 'Preset'), selectOf(K.presetOptions().map(([id, n]) => [id, n]), pid, x => {
    const q = x !== 'custom' && K.presetParams(x); if (!q) return; K.CH.forEach(k => { v[k] = q[k]; }); commit(); }, 'curvePreset')));
  b.appendChild(row(null, selectOf(CURVE_CH.map(c => [c[0], c[1]]), ch, x => { CurveCh[L.id] = x; P.refresh('properties'); }, 'curveChannel')));
  const tool = w => () => { CurveTool.tool = CurveTool.tool === w ? null : w; P.refresh('properties'); };
  const mode = m => () => { if (K.mode(v) !== m){ K.setMode(v, m); if (m === 'pencil' && CurveTool.tool === 'tat') CurveTool.tool = null; commit(); } };
  const sm = iconBtn(T(L3('平滑', '平滑', 'Smooth')), CK_TIPS.smooth, false, () => { K.CH.forEach(k => { v[k] = K.smooth(v[k]); }); commit(); }, 'curveSmooth'); sm.disabled = !pen();
  b.appendChild(row(null, iconBtn('☝', CK_TIPS.tat, CurveTool.tool === 'tat', tool('tat'), 'curveTAT'), iconBtn('∿', CK_TIPS.points, !pen(), mode('points'), 'curveModePoints'),
    iconBtn('✎', CK_TIPS.pencil, pen(), mode('pencil'), 'curveModePencil'), sm,
    iconBtn('◣', CK_TIPS.black, CurveTool.tool === 'black', tool('black'), 'curveEyeBlack'), iconBtn('◪', CK_TIPS.gray, CurveTool.tool === 'gray', tool('gray'), 'curveEyeGray'),
    iconBtn('◸', CK_TIPS.white, CurveTool.tool === 'white', tool('white'), 'curveEyeWhite')));
  const cv = el('canvas', {width:G + 2 * P0, height:G + 2 * P0, dataset:{k:'curveGraph'}, style:'display:block;border:1px solid #3a3a3a;background:#1d2026;cursor:crosshair;touch-action:none'});
  const sl = el('canvas', {width:G + 2 * P0, height:16, dataset:{k:'curveSliders'}, style:'display:block;cursor:ew-resize;touch-action:none'});
  const info = el('div', {class:'hint', dataset:{k:'curveIO'}});
  const hist = curveHistBelow(L);
  const toScr = q => K.scr(q, P0, G, pig), toVal = (x, y) => K.val(x, y, P0, G, pig);
  let sel = null, dragging = false;
  const ends = () => pen() ? [[0, v[ch].pencil[0]], [255, v[ch].pencil[255]]] : [pts()[0], pts()[pts().length - 1]];
  const draw = () => {
    const q = !pen() && sel !== null ? pts()[sel] : null;
    K.draw(cv.getContext('2d'), {P:P0, G, v, key:ch, hist, sel:pen() ? null : sel, cross:dragging && q ? q : null});
    const y = sl.getContext('2d'); y.clearRect(0, 0, sl.width, sl.height);
    const gr = y.createLinearGradient(P0, 0, P0 + G, 0), hi = ch === 'points' ? '#fff' : chCol; gr.addColorStop(pig ? 1 : 0, '#000'); gr.addColorStop(pig ? 0 : 1, hi); y.fillStyle = gr; y.fillRect(P0, 0, G, 4);
    const tri = (sx, fill) => { y.beginPath(); y.moveTo(sx, 5); y.lineTo(sx - 5, 15); y.lineTo(sx + 5, 15); y.closePath(); y.fillStyle = fill; y.fill(); y.strokeStyle = '#9aa3b0'; y.stroke(); };
    const [b0, w0] = ends(); tri(toScr(b0)[0], '#000'); tri(toScr(w0)[0], '#fff');
    const u = pig ? ' %' : '';
    info.textContent = q ? `${T(L3('輸入', '输入', 'Input'))}: ${K.shown(q[0], pig)}${u}  ${T(L3('輸出', '输出', 'Output'))}: ${K.shown(q[1], pig)}${u}` : pen() ? T(L3('拖曳＝手繪曲線 · Shift＋按一下＝直線', '拖动＝手绘曲线 · Shift＋单击＝直线', 'Drag to draw · Shift-click: straight line')) : `▲ ${K.shown(b0[0], pig)}  △ ${K.shown(w0[0], pig)}`;
  };
  const preview = () => { L.adjust = {kind:orig.kind, params:Object.assign({}, orig.params, clone(v))}; if (window.UI) UI.draw(); draw(); };
  const moveTo = (i, q) => { const a = pts(), lo = i > 0 ? a[i - 1][0] + 1 : 0, hi = i + 1 < a.length ? a[i + 1][0] - 1 : 255; a[i] = [clamp(Math.round(q[0]), lo, Math.max(lo, hi)), clamp(Math.round(q[1]), 0, 255)]; };
  const drag = (elm, down) => elm.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation(); try { elm.setPointerCapture(e.pointerId); } catch (_){}
    const r = elm.getBoundingClientRect(), sx = elm.width / r.width, sy = elm.height / r.height, at = ev => [(ev.clientX - r.left) * sx, (ev.clientY - r.top) * sy];
    const mv = down(at(e), e); if (!mv) return;
    const onMove = ev => { mv(at(ev)); preview(); };
    const up = () => { dragging = false; elm.removeEventListener('pointermove', onMove); elm.removeEventListener('pointerup', up); elm.removeEventListener('pointercancel', up); commit(); };
    elm.addEventListener('pointermove', onMove); elm.addEventListener('pointerup', up); elm.addEventListener('pointercancel', up);
    preview();
  });
  // 曲线图：编辑点模式＝点到点拖它、空处加一点再拖、中间的点拖出框外删掉；铅笔模式＝手画（Shift＋点＝从上一笔终点拉直线）
  drag(cv, (p, e) => {
    if (pen()){
      const arr = v[ch].pencil; let last = null;
      const put = (pp, shift) => { const q = toVal(pp[0], pp[1]), xi = Math.round(q[0]), yo = Math.round(q[1]), from = shift && CurveTool.penLast ? CurveTool.penLast : (last || [xi, yo]), n = Math.abs(xi - from[0]);
        for (let j = 0; j <= n; j++) arr[from[0] + Math.sign(xi - from[0]) * j] = n ? Math.round(from[1] + (yo - from[1]) * j / n) : yo;
        last = CurveTool.penLast = [xi, yo]; };
      put(p, e.shiftKey); return q => put(q);
    }
    let hit = null, bd = 9; pts().forEach((q, i) => { const s = toScr(q), d = Math.hypot(s[0] - p[0], s[1] - p[1]); if (d <= bd){ bd = d; hit = i; } });
    if (hit === null){
      if (pts().length >= 16) return null;
      const vv = toVal(p[0], p[1]); if (pts().some(q => Math.abs(q[0] - vv[0]) < 2)) return null;   // 太靠近已有的点：不加
      hit = K.addPoint(pts(), vv, false);
    }
    sel = hit; dragging = true;
    return q => {
      if (sel === null) return;
      const out = q[0] < -10 || q[0] > cv.width + 10 || q[1] < -10 || q[1] > cv.height + 10;
      if (out && sel > 0 && sel < pts().length - 1){ pts().splice(sel, 1); sel = null; return; }
      moveTo(sel, toVal(q[0], q[1]));
    };
  });
  // 输入黑场／白场滑块：移动两端点的输入（输出不动）；铅笔模式没有端点
  drag(sl, p => {
    if (pen()) return null;
    const a = pts(), db = Math.abs(toScr(a[0])[0] - p[0]), dw = Math.abs(toScr(a[a.length - 1])[0] - p[0]);
    const i = db <= dw ? 0 : a.length - 1; sel = i;
    const go = q => { const x = toVal(q[0], 0)[0]; moveTo(i, [x, pts()[i][1]]); };
    go(p); return go;
  });
  draw();
  b.appendChild(el('div', {class:'row', style:'flex-direction:column;align-items:flex-start;gap:0'}, [cv, sl, info]));
}
/* 属性面板曲线的吸管／手指：点画布取「这一层下面合起来」的颜色（调整前） */
if (!window.__psWinCurveTool){ window.__psWinCurveTool = true;
  window.addEventListener('pointerdown', e => {
    if (!CurveTool.tool || e.button !== 0 || !window.UI || !UI.canvas || !window.PsImage || !PsImage.CurveKit) return;
    const L = Doc.active(); if (!L || L.id !== CurveTool.id || !L.adjust || L.adjust.kind !== 'curves' || !P.isOpen('properties')) return;
    const wrap = document.getElementById('canvasWrap'); if (wrap ? !wrap.contains(e.target) : e.target !== UI.canvas) return;
    const K = PsImage.CurveKit, pt = K.docPt(e); if (!pt) return;
    const rgb = K.read(K.belowSource(L), pt); if (!rgb) return;
    e.preventDefault(); e.stopPropagation();
    const v = K.full(L.adjust.params || {}), ch = CurveCh[L.id] || 'points', all = () => Object.assign({id:L.id}, clone(v));
    if (CurveTool.tool !== 'tat'){ K.eyedrop(v, CurveTool.tool, rgb); runCmd('ps.layer.setAdjustment', all()); P.refresh('properties'); return; }
    if (K.mode(v) === 'pencil') K.setMode(v, 'points');
    const a = K.inputOf(v, ch, rgb), i = K.addPoint(v[ch], [a, K.lut256(v[ch])[a]], false); if (i === null) return;
    const orig = L.adjust, y0 = e.clientY, o0 = v[ch][i][1], pig = K.opts().amount === 'pigment';
    const pv = () => { L.adjust = {kind:orig.kind, params:Object.assign({}, orig.params, clone(v))}; UI.draw(); };
    const mv = ev => { ev.stopPropagation(); v[ch][i] = [v[ch][i][0], clamp(Math.round(o0 + (y0 - ev.clientY) * (pig ? -1 : 1)), 0, 255)]; pv(); };
    const up = ev => { ev.stopPropagation(); window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true); L.adjust = orig; runCmd('ps.layer.setAdjustment', all()); P.refresh('properties'); };
    window.addEventListener('pointermove', mv, true); window.addEventListener('pointerup', up, true); pv();
  }, true); }
/* 面板选单「曲线显示选项…」（PS 属性面板曲线的选单项） */
function curveDisplayDialog(){
  const K = window.PsImage && PsImage.CurveKit; if (!K) return;
  const o = K.opts();
  P.dialog({id:'curveDisplay', title:L3('曲線顯示選項', '曲线显示选项', 'Curves Display Options'), fields:[
    {k:'amount', type:'select', label:L3('顯示數量', '显示数量', 'Show Amount of'), options:[['light', L3('光 (0-255)', '光 (0-255)', 'Light (0-255)')], ['pigment', L3('顏料/油墨 %', '颜料/油墨 %', 'Pigment/Ink %')]], value:o.amount},
    {k:'grid', type:'select', label:L3('格點', '网格', 'Grid'), options:[['simple', L3('簡單 (4×4)', '简单 (4×4)', 'Simple (4×4)')], ['detailed', L3('詳細 (10×10)', '详细 (10×10)', 'Detailed (10×10)')]], value:o.grid},
    {k:'overlay', type:'check', label:L3('色版覆蓋', '通道叠加', 'Channel Overlays'), value:o.overlay}, {k:'hist', type:'check', label:L3('色階分佈圖', '直方图', 'Histogram'), value:o.hist},
    {k:'baseline', type:'check', label:L3('基準線', '基线', 'Baseline'), value:o.baseline}, {k:'cross', type:'check', label:L3('交集線', '交叉线', 'Intersection Line'), value:o.cross}],
    ok:v => { K.setOpts(v); P.refresh('properties'); return {ok:true}; }});
}
function adjProps(b, L){
  const k = L.adjust.kind, prm = L.adjust.params || {}, set = (key, v) => runCmd('ps.layer.setAdjustment', {id:L.id, [key]:v});
  if (k === 'curves') curvesProps(b, L);
  Object.keys(prm).forEach(key => {
    const v = prm[key], label = ADJ_KEY[key] || key;
    if (typeof v === 'number'){
      const rg = adjRange(k, key), n = numIn(v, key, {step:'any', style:'width:58px'});
      n.onchange = () => set(key, +n.value);
      if (rg){ const r = el('input', {type:'range', min:rg[0], max:rg[1], step:(rg[1] - rg[0]) <= 20 ? 0.01 : 1, value:v, dataset:{adj:key}}); r.oninput = () => { n.value = r.value; }; r.onchange = () => set(key, +r.value); b.appendChild(row(label, r, n)); }
      else b.appendChild(row(label, n));
    } else if (typeof v === 'boolean'){
      const c = el('input', {type:'checkbox', dataset:{k:key}, onchange:() => set(key, c.checked)}); c.checked = v;
      b.appendChild(el('label', {class:'row', style:'cursor:pointer'}, [c, el('span', {text:T(label), style:'min-width:0'})]));
    } else if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)){
      const c = el('input', {type:'color', value:v, dataset:{k:key}, onchange:() => set(key, c.value)}); b.appendChild(row(label, c));
    } else if (key === 'method'){
      b.appendChild(row(label, selectOf([['relative', L3('相對', '相对', 'Relative')], ['absolute', L3('絕對', '绝对', 'Absolute')]], v, x => set(key, x), key)));
    }
  });
  if (Object.keys(prm).some(key => typeof prm[key] === 'object') || !Object.keys(prm).length && k !== 'invert')
    b.appendChild(el('div', {class:'bar', style:'justify-content:flex-start'}, [btn(T(L3('編輯…', '编辑…', 'Edit…')), L3('開啟這個調整的完整對話框（曲線、各色版…）', '打开这个调整的完整对话框（曲线、各通道…）', 'Open the full dialog of this adjustment (curves, channels…)'),
      () => runCmd('ps.layer.layerContentOptions', {id:L.id, ui:true}), {dataset:{k:'editAdj'}})]));
  const vis = el('input', {type:'checkbox', dataset:{k:'adjVisible'}, onchange:() => runCmd('layer.set', {id:L.id, visible:vis.checked})}); vis.checked = L.visible !== false;
  const clip = el('input', {type:'checkbox', dataset:{k:'adjClip'}, onchange:() => runCmd(clip.checked ? 'ps.layer.createClippingMask' : 'ps.layer.releaseClippingMask', {id:L.id})}); clip.checked = !!L.clipped;
  b.appendChild(el('label', {class:'row', style:'cursor:pointer'}, [vis, el('span', {text:T(L3('調整可見', '调整可见', 'Adjustment visible')), style:'min-width:0'})]));
  b.appendChild(el('label', {class:'row', style:'cursor:pointer'}, [clip, el('span', {text:T(L3('剪裁至下方圖層', '剪切到下方图层', 'Clip to layer below')), style:'min-width:0'})]));
  b.appendChild(el('div', {class:'bar', style:'justify-content:stretch'}, [btn(T(L3('重設為預設值', '复位到默认值', 'Reset to defaults')), null, () => runCmd('ps.layer.setAdjustment', {id:L.id}), {dataset:{k:'adjReset'}, style:'flex:1'})]));
}
/* 快速操作（props_layout.rs:118-131）：图层种类 → [名, 命令]；只摆我们有的命令 */
function quickActions(L){
  const para = L.kind === 'text' && L.data && L.data.box;
  const Q = L.kind === 'text' ? [[L3('轉換為形狀', '转换为形状', 'Convert to Shape'), 'ps.type.convertToShape'], para ? [L3('轉換為點文字', '转换为点文本', 'Convert to Point Text'), 'ps.type.convertToPointText'] : [L3('轉換為段落文字', '转换为段落文本', 'Convert to Paragraph Text'), 'ps.type.convertToParagraphText'],
      [L3('建立彎曲文字', '创建文字变形', 'Create Warped Text'), 'ps.type.warpText.dialog'], [L3('點陣化文字', '栅格化文字', 'Rasterize Type'), 'layer.rasterize']]
    : L.kind === 'vector' ? [[L3('點陣化形狀', '栅格化形状', 'Rasterize Shape'), 'layer.rasterize'], [L3('轉換為智慧型物件', '转换为智能对象', 'Convert to Smart Object'), 'ps.layer.smartObjects.convertToSmartObject']]
    : L.kind === 'smart' ? [[L3('編輯內容', '编辑内容', 'Edit Contents'), 'ps.layer.smartObjects.editContents'], [L3('點陣化智慧型物件', '栅格化智能对象', 'Rasterize Smart Object'), 'ps.layer.rasterize.smartObject']]
    : L.kind === 'group' ? [[L3('解散圖層群組', '取消图层编组', 'Ungroup Layers'), 'ps.layer.ungroupLayers'], [L3('轉換為智慧型物件', '转换为智能对象', 'Convert to Smart Object'), 'ps.layer.smartObjects.convertToSmartObject']]
    : L.fillLayer ? [[L3('點陣化填色內容', '栅格化填充内容', 'Rasterize Fill Content'), 'ps.layer.rasterize.fillContent']]
    : [[L3('移除背景', '移除背景', 'Remove Background'), 'ps.layer.removeBackground'], [L3('選取主體', '选择主体', 'Select Subject'), 'ps.select.subject']];
  return Q.filter(q => has(q[1]));
}
function layerProps(b, L){
  const kindName = L.adjust ? (ADJ.find(a => a[0] === L.adjust.kind) || [0, 0, L3(L.adjust.kind, L.adjust.kind, L.adjust.kind)])[2] : null;
  b.appendChild(el('div', {class:'row', dataset:{k:'header'}}, [el('span', {text:L.adjust ? '⚙' : L.kind === 'text' ? 'T' : L.kind === 'vector' ? '◇' : L.kind === 'group' ? '📁' : '▣', style:'min-width:0'}),
    el('span', {text:L.name, style:'flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'}),
    el('span', {class:'hint', text:kindName ? T(kindName) + ' ' + T(L3('內容', '属性', 'Properties')) : Lang.t('layer.' + L.kind)})]));
  if (L.adjust){ adjProps(b, L); return; }
  const r = window.PsView && PsView.layerRect ? PsView.layerRect(L) : null;
  if (r && r.x1 > r.x0 && section(b, 'transform', L3('變形', '变换', 'Transform'))){
    const bw = r.x1 - r.x0, bh = r.y1 - r.y0;
    const w = numIn(Math.round(bw), 'w', {min:1}), h = numIn(Math.round(bh), 'h', {min:1}), x = numIn(Math.round(r.x0), 'x'), y = numIn(Math.round(r.y0), 'y');
    // layer_props_ui.rs:15 transform_params：从左上角缩放内容外框；链接＝等比
    const scale = which => { let nw = Math.max(1, +w.value), nh = Math.max(1, +h.value);
      if (PropsSt.layerLink){ if (which === 'w') nh = Math.max(1, nw * bh / bw); else nw = Math.max(1, nh * bw / bh); }
      if (Math.abs(nw - bw) < 0.5 && Math.abs(nh - bh) < 0.5) return;
      runCmd('ps.edit.transform', {layerId:L.id, rect:[r.x0, r.y0, r.x1, r.y1], quad:[[r.x0, r.y0], [r.x0 + nw, r.y0], [r.x0 + nw, r.y0 + nh], [r.x0, r.y0 + nh]]}); };
    w.onchange = () => scale('w'); h.onchange = () => scale('h');
    x.onchange = () => runCmd('layer.set', {id:L.id, x:(L.x || 0) + Math.round(+x.value - r.x0)}); y.onchange = () => runCmd('layer.set', {id:L.id, y:(L.y || 0) + Math.round(+y.value - r.y0)});
    b.appendChild(row('W', w, iconBtn(PropsSt.layerLink ? '🔗' : '⛓', L3('連結寬度和高度', '链接宽度和高度', 'Link width and height'), PropsSt.layerLink, () => { PropsSt.layerLink = !PropsSt.layerLink; P.refresh('properties'); }, 'layerLink'), el('span', {text:'H'}), h));
    b.appendChild(row('X', x, el('span', {style:'width:26px'}), el('span', {text:'Y'}), y));
  }
  const op = el('input', {type:'range', min:0, max:100, value:Math.round(L.opacity * 100), dataset:{k:'opacity'}}); op.onchange = () => runCmd('layer.set', {id:L.id, opacity:+op.value / 100});
  b.appendChild(row(L3('不透明度', '不透明度', 'Opacity'), op));
  if (has('ps.layer.layerStyle.blendingOptions')){ const fo = el('input', {type:'range', min:0, max:100, value:Math.round((L.fillOpacity === undefined ? 1 : L.fillOpacity) * 100), dataset:{k:'fill'}});
    fo.onchange = () => runCmd('ps.layer.layerStyle.blendingOptions', {id:L.id, fillOpacity:+fo.value}); b.appendChild(row(L3('填滿', '填充', 'Fill'), fo)); }
  if (section(b, 'align', L3('對齊與分佈', '对齐并分布', 'Align and Distribute'))){
    const ed = [['leftEdges', '⇤', L3('左邊緣', '左边', 'Left Edges')], ['horizontalCenters', '⇹', L3('水平居中', '水平居中', 'Horizontal Centers')], ['rightEdges', '⇥', L3('右邊緣', '右边', 'Right Edges')],
      ['topEdges', '⤒', L3('頂邊', '顶边', 'Top Edges')], ['verticalCenters', '⇳', L3('垂直居中', '垂直居中', 'Vertical Centers')], ['bottomEdges', '⤓', L3('底邊', '底边', 'Bottom Edges')]];
    b.appendChild(el('div', {class:'grid'}, ed.map(([k, ic, n]) => btn(ic, n, () => runCmd('move.align', {edge:k}), {dataset:{edge:k}}))));
  }
  if (L.kind === 'text') textProps(b, L);
  if (L.kind === 'vector') shapeProps(b, L);
  const Q = quickActions(L);
  if (Q.length && section(b, 'quick', L3('快速動作', '快速操作', 'Quick Actions')))
    b.appendChild(el('div', {class:'bar', style:'justify-content:stretch'}, Q.map(([n, id]) => btn(T(n), null, () => runCmd(id, id === 'layer.rasterize' ? {id:L.id} : id === 'ps.layer.removeBackground' ? {layerId:L.id, ui:true} : {}), {dataset:{qa:id}, style:'flex:1 1 45%'}))));
}
/* 文字层（type_tool.rs:976 type_properties 的「字元」节；完整的字元／段落面板在 视窗 ▸ 字符） */
function textProps(b, L){
  if (!section(b, 'character', L3('字元', '字符', 'Character'))) return;
  const d = L.data || {}, set = q => runCmd('text.setStyle', Object.assign({layerId:L.id}, q));
  const fams = (peek('text.fonts') || {}).families || ['sans-serif', 'serif', 'monospace'];
  const fam = el('select', {dataset:{k:'font'}, onchange:() => set({font:fam.value})}); (fams.includes(d.font) ? fams : [d.font].concat(fams)).forEach(f => fam.appendChild(el('option', {value:f, text:f}))); fam.value = d.font;
  b.appendChild(row(L3('字體', '字体', 'Font'), fam));
  const sz = numIn(d.size, 'size', {min:1, step:'any'}); sz.onchange = () => set({size:+sz.value});
  const col = el('input', {type:'color', value:/^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#000000', dataset:{k:'color'}, onchange:() => set({color:col.value})});
  b.appendChild(row(L3('大小', '大小', 'Size'), sz, el('span', {text:'px'}), col));
  const wt = selectOf([['normal', L3('一般', '常规', 'Regular')], ['bold', L3('粗體', '粗体', 'Bold')]], d.weight === 'bold' || +d.weight >= 600 ? 'bold' : 'normal', v => set({weight:v}), 'weight');
  b.appendChild(row(L3('樣式', '样式', 'Style'), wt, ...[['left', '⫷'], ['center', '≡'], ['right', '⫸']].map(([a, ic]) => iconBtn(ic, {left:L3('靠左', '左对齐', 'Left'), center:L3('置中', '居中', 'Center'), right:L3('靠右', '右对齐', 'Right')}[a], d.align === a, () => set({align:a}), 'align-' + a))));
  b.appendChild(el('div', {class:'bar', style:'justify-content:flex-start'}, [btn(T(L3('字元面板…', '字符面板…', 'Character panel…')), null, () => runCmd('ps.window.panel', {panel:'character', on:true}))]));
}
/* 形状（vector_ui.rs shape_properties 的外观：填色／描边／粗细）；我们的矢量层整层的形状一起改 */
CMD.reg('ps.shape.setAppearance', {i18n:'', undoable:true, params:'{id?:矢量层（缺省＝当前层）, shapes?:[形状 id]（缺省＝整层）, fill?:"#rrggbb"|"none", stroke?:"#rrggbb"|"none", strokeWidth?:px} 属性面板 ▸ 外观：改形状的填色／描边／描边粗细 → {ok, count}'}, p => {
  const L = p.id ? Doc.byId(p.id) : Doc.active(); if (!L || L.kind !== 'vector') return fail('ps.shape.setAppearance: not a vector layer');
  const ok = v => v === 'none' || /^#[0-9a-f]{6}$/i.test(v);
  if (p.fill !== undefined && !ok(p.fill)) return fail('fill must be #rrggbb or "none"'); if (p.stroke !== undefined && !ok(p.stroke)) return fail('stroke must be #rrggbb or "none"');
  let n = 0;
  const walk = list => list.forEach(s => { if (Array.isArray(p.shapes) && !p.shapes.includes(s.id)) return; if (Array.isArray(s.children) && (s.type === 'group')) { walk(s.children); return; }
    if (p.fill !== undefined) s.fill = p.fill; if (p.stroke !== undefined) s.stroke = p.stroke; if (typeof p.strokeWidth === 'number') s.strokeWidth = Math.max(0, p.strokeWidth); n++; });
  walk(L.data.shapes || []); Layer.invalidate(L);
  return {ok:true, count:n};
});
/* 属性面板 ▸ 实时形状（PS 2020 Live Shape Properties）：矩形的圆角半径（四角同值；夹在短边一半——PS 拖到底就是胶囊） */
CMD.reg('ps.shape.setCornerRadius', {i18n:'', undoable:true, params:'{id?:矢量层（缺省＝当前层）, shapes?:[形状 id]（缺省＝整层的矩形）, radius:px（≥0，夹在短边一半）} 属性面板 ▸ 圆角半径 → {ok, count}'}, p => {
  const L = p.id ? Doc.byId(p.id) : Doc.active(); if (!L || L.kind !== 'vector') return fail('ps.shape.setCornerRadius: not a vector layer');
  const r = +p.radius; if (!isFinite(r) || r < 0) return fail('radius must be a number ≥ 0');
  let n = 0;
  const walk = list => list.forEach(s => { if (Array.isArray(s.children) && s.type === 'group'){ walk(s.children); return; }
    if (s.type !== 'rect' || (Array.isArray(p.shapes) && !p.shapes.includes(s.id))) return;
    s.radius = Math.min(r, Math.min(Math.abs(s.w), Math.abs(s.h)) / 2); n++; });
  walk(L.data.shapes || []);
  if (!n) return fail('ps.shape.setCornerRadius: no rectangle on this layer');
  Layer.invalidate(L); return {ok:true, count:n};
});
function shapeProps(b, L){
  const rect = (L.data.shapes || []).find(x => x.type === 'rect');
  if (rect && section(b, 'liveShape', L3('即時形狀屬性', '实时形状属性', 'Live Shape Properties'))){
    const rr = numIn(+(rect.radius || 0).toFixed(2), 'cornerRadius', {min:0, step:'any', style:'width:64px'});
    rr.onchange = () => runCmd('ps.shape.setCornerRadius', {id:L.id, radius:+rr.value});
    b.appendChild(row(L3('圓角半徑', '圆角半径', 'Corner Radius'), rr, el('span', {text:'px'})));
  }
  if (!section(b, 'appearance', L3('外觀', '外观', 'Appearance'))) return;
  const s = (L.data.shapes || []).find(x => typeof x.fill === 'string' || typeof x.stroke === 'string') || {};
  const set = q => runCmd('ps.shape.setAppearance', Object.assign({id:L.id}, q));
  const fc = el('input', {type:'color', value:/^#[0-9a-f]{6}$/i.test(s.fill) ? s.fill : '#000000', dataset:{k:'shapeFill'}, onchange:() => set({fill:fc.value})});
  const sc = el('input', {type:'color', value:/^#[0-9a-f]{6}$/i.test(s.stroke) ? s.stroke : '#000000', dataset:{k:'shapeStroke'}, onchange:() => set({stroke:sc.value, strokeWidth:Math.max(1, s.strokeWidth || 0)})});
  const sw = numIn(s.strokeWidth || 0, 'shapeStrokeWidth', {min:0, step:'any', style:'width:52px'}); sw.onchange = () => set({strokeWidth:+sw.value});
  b.appendChild(row(L3('填色', '填色', 'Fill'), fc, btn('∅', L3('無填色', '无填色', 'No fill'), () => set({fill:'none'}), {class:s.fill === 'none' ? 'on' : '', dataset:{k:'fillNone'}})));
  b.appendChild(row(L3('筆畫', '描边', 'Stroke'), sc, sw, el('span', {text:'px'}), btn('∅', L3('無筆畫', '无描边', 'No stroke'), () => set({stroke:'none'}), {class:!s.stroke || s.stroke === 'none' ? 'on' : '', dataset:{k:'strokeNone'}})));
}

P.define('properties', {title:L3('內容', '属性', 'Properties'), w:270,
  menu(){ const L = Doc.active(); return L && L.adjust && L.adjust.kind === 'curves' ? [{label:L3('曲線顯示選項…', '曲线显示选项…', 'Curves Display Options…'), run:curveDisplayDialog}] : []; },
  refresh(b){
    if (busy(b)) return;
    b.innerHTML = '';
    const L = Doc.active();
    // doc_props_ui.rs shows_document：没选层、或选的是背景层 ⇒ 文件属性
    if (!L || L.isBackground || (window.PsLayer && PsLayer.isBackground && PsLayer.isBackground(L))){ docProps(b); return; }
    layerProps(b, L);
  }});

/* ═══════════ 通道（channels_panel.rs:47-308） ═══════════
   复合／红绿蓝／当前层蒙版（斜体）／Alpha 通道／快速蒙版（斜体）；Ctrl+按一下＝载入选区（Shift 加、Alt 减、Shift+Alt 交集）；双击 Alpha＝改名；
   右键：复制／删除／改名通道、新建通道；蒙版行：停用／启用、删除图层蒙版；快速蒙版行：退出快速蒙版。底下：载入／存储选区、新建、删除。
   Alpha 通道表在 menus/impl/ps-select.js（存储选区存进去的那张；PsSelect.channels() 只给名字）。要新建／删除／复制／改名就得拿到那张表本身 ⇒
   chanList()：暂时整张选取、直接叫 ps.select.saveSelection 的 run（不进历史），趁它往表里 push 时认出那张阵列，再把多出来的那格拿掉。
   ⚠️ 跟 ps-select 一样：通道表不在 History 快照里（撤销不会把通道拿掉）。 */
const ChRef = {serial:NaN, list:null};
function chanList(){
  if (window.PsSelect && PsSelect.channelList) return PsSelect.channelList();   // ps-select 有直接给表就用（下面的 push 侦测只是旧版退路）
  if (ChRef.list && ChRef.serial === Doc.serial) return ChRef.list;
  const c = CMD.map['ps.select.saveSelection']; if (!c) return null;
  const op = Array.prototype.push, sel = Doc.sel; let got = null;
  Array.prototype.push = function(x){ if (!got && arguments.length === 1 && x && typeof x.name === 'string' && x.data instanceof Uint8Array) got = this; return op.apply(this, arguments); };
  try { Doc.sel = {x:0, y:0, w:Doc.width, h:Doc.height}; c.run({}); } catch(e){ console.warn('[ps-window] chanList', e); }
  finally { Array.prototype.push = op; Doc.sel = sel; }
  if (got) got.pop();
  ChRef.list = got; ChRef.serial = Doc.serial;
  return got;
}
const COLOR_CH = {red:0, green:1, blue:2};
function chanIndex(v){
  const L = chanList() || [];
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v < L.length ? v : -1;
  if (typeof v === 'string' && /^\d+$/.test(v)) return chanIndex(+v);
  if (typeof v === 'string') return L.findIndex(c => c.name === v);
  return -1;
}
const nextChanName = base => { const L = chanList() || []; for (let n = 1; ; n++){ const s = `${base} ${n}`; if (!L.some(c => c.name === s)) return s; } };
/* 一张 0..255 灰阶（复合＝亮度；红绿蓝＝那个通道；Alpha＝本身） */
function chanBytes(ch){
  const i = chanIndex(ch); if (i >= 0) return Uint8Array.from(chanList()[i].data);
  const ci = COLOR_CH[ch]; if (ch !== 'composite' && ci === undefined) return null;
  const d = composite(1).getContext('2d').getImageData(0, 0, Doc.width, Doc.height).data, out = new Uint8Array(Doc.width * Doc.height);
  for (let k = 0; k < out.length; k++) out[k] = ci !== undefined ? d[k * 4 + ci] : Math.round(0.299 * d[k * 4] + 0.587 * d[k * 4 + 1] + 0.114 * d[k * 4 + 2]);
  return out;
}
const regCh = (id, params, fn) => CMD.reg('ps.channel.' + id, {i18n:'', params, undoable:false}, fn);
regCh('list', '{} 通道面板的各列 → {ok, rows:[{key, name, kind:"composite|color|mask|alpha|quickMask"}], target}', () => {
  const rows = [{key:'composite', name:'RGB', kind:'composite'}, {key:'red', name:'Red', kind:'color'}, {key:'green', name:'Green', kind:'color'}, {key:'blue', name:'Blue', kind:'color'}];
  const L = Doc.active(); if (L && L.mask) rows.push({key:'mask', name:`${L.name} Mask`, kind:'mask'});
  (chanList() || []).forEach((c, i) => rows.push({key:i, name:c.name, kind:'alpha'}));
  if (window.PsSelect && PsSelect.quickMaskOn && PsSelect.quickMaskOn()) rows.push({key:'quickMask', name:'Quick Mask', kind:'quickMask'});
  return {ok:true, rows, target:PsWindow.channelTarget || 'composite'};
});
regCh('new', '{name?（缺省 "Alpha N"）} 通道面板 ＋：新建一个全黑（＝全没选）的 Alpha 通道 → {ok, channel:序号, name}', p => {
  const L = chanList(); if (!L) return fail('ps.channel.new: no alpha channel store (ps-select.js not loaded)');
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : nextChanName('Alpha');
  L.push({name, data:new Uint8Array(Doc.width * Doc.height)}); PsWindow.channelTarget = L.length - 1; P.refresh('channels');
  return {ok:true, channel:L.length - 1, name};
});
regCh('duplicate', '{channel:序号|名字|"composite"|"red"|"green"|"blue", name?} 复制通道：做成一个新的 Alpha 通道（复合＝亮度）→ {ok, channel, name}', p => {
  const L = chanList(); if (!L) return fail('no alpha channel store');
  const src = p.channel === undefined ? (PsWindow.channelTarget === undefined ? 'composite' : PsWindow.channelTarget) : p.channel, data = chanBytes(src);
  if (!data) return fail(`ps.channel.duplicate: no channel \`${src}\``);
  const i = chanIndex(src), base = i >= 0 ? L[i].name + ' copy' : ({composite:'RGB', red:'Red', green:'Green', blue:'Blue'})[src] + ' copy';
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : (L.some(c => c.name === base) ? nextChanName(base) : base);
  L.push({name, data}); P.refresh('channels'); return {ok:true, channel:L.length - 1, name};
});
regCh('delete', '{channel?:序号|名字（缺省＝目前选中的）} 删除 Alpha 通道（选中的是图层蒙版＝删除图层蒙版；复合／颜色通道我们不能删）→ {ok, deleted}', p => {
  const ch = p.channel === undefined ? PsWindow.channelTarget : p.channel;
  if (ch === 'mask') return CMD.map['ps.layer.layerMask.delete'] ? CMD.run('ps.layer.layerMask.delete', {}) : fail('no layer mask command');
  const i = chanIndex(ch); if (i < 0) return fail('ps.channel.delete: only alpha channels can be deleted (select one first)');
  const [c] = chanList().splice(i, 1); PsWindow.channelTarget = 'composite'; P.refresh('channels'); return {ok:true, deleted:c.name};
});
regCh('rename', '{channel:序号|名字, name} 通道改名（只有 Alpha 通道）→ {ok, name}', p => {
  const i = chanIndex(p.channel); if (i < 0) return fail('ps.channel.rename: no such alpha channel');
  const n = String(p.name || '').trim(); if (!n) return fail('ps.channel.rename: missing `name`');
  chanList()[i].name = n; P.refresh('channels'); return {ok:true, name:n};
});
regCh('target', '{channel:"composite"|"red"|"green"|"blue"|"mask"|序号} 通道面板点一列＝选中那个通道（我们的画笔只画复合，选中只影响面板底下的载入／删除）→ {ok, target}', p => {
  const ch = p.channel; if (!(ch === 'composite' || ch in COLOR_CH || ch === 'mask' || ch === 'quickMask' || chanIndex(ch) >= 0)) return fail('ps.channel.target: no such channel');
  PsWindow.channelTarget = typeof ch === 'string' && /^\d+$/.test(ch) ? +ch : ch; P.refresh('channels'); return {ok:true, target:PsWindow.channelTarget};
});
const loadOp = e => e.shiftKey && e.altKey ? 'intersect' : e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'new';
function chanThumb(bytesOrNull, comp, c){
  const s = Math.min(30 / Doc.width, 24 / Doc.height), cw = Math.max(1, Math.round(Doc.width * s)), ch = Math.max(1, Math.round(Doc.height * s));
  const cv = el('canvas', {width:cw, height:ch, style:'width:30px;height:24px;background:#000;object-fit:contain'}), im = new ImageData(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++){
    const o = (y * cw + x) * 4;
    if (bytesOrNull){ const v = bytesOrNull[Math.min(Doc.height - 1, Math.floor(y / s)) * Doc.width + Math.min(Doc.width - 1, Math.floor(x / s))]; im.data[o] = im.data[o + 1] = im.data[o + 2] = v; }
    else { const d = comp.data, i = o; const v = c === null ? null : d[i + c]; im.data[o] = v === null ? d[i] : v; im.data[o + 1] = v === null ? d[i + 1] : v; im.data[o + 2] = v === null ? d[i + 2] : v; }
    im.data[o + 3] = 255;
  }
  cv.getContext('2d').putImageData(im, 0, 0); return cv;
}
P.define('channels', {title:L3('色版', '通道', 'Channels'), w:260,
  refresh(b){
    if (busy(b)) return;
    b.innerHTML = '';
    const list = el('div', {class:'list'}); b.appendChild(list);
    const s = Math.min(30 / Doc.width, 24 / Doc.height), comp = composite(s), cd = comp.getContext('2d').getImageData(0, 0, comp.width, comp.height);
    const tgt = PsWindow.channelTarget === undefined ? 'composite' : PsWindow.channelTarget, alphas = chanList() || [];
    const add = (key, name, cv, slot, kind) => {
      const on = key === tgt || (tgt === 'composite' && kind === 'color');
      const r = el('div', {class:'li' + (on ? ' on' : ''), dataset:{ch:key}, style:kind === 'mask' || kind === 'quickMask' ? 'font-style:italic' : '', title:T(L3('Ctrl+按一下＝載入為選取範圍', 'Ctrl+单击＝载入选区', 'Ctrl-click loads as selection'))},
        [el('span', {text:'◉', style:'opacity:.6'}), cv, el('span', {text:name, style:'flex:1'}), el('span', {class:'hint', text:slot ? 'Ctrl+' + slot : ''})]);
      r.onclick = e => {
        if (e.ctrlKey || e.metaKey) runCmd('ps.select.loadSelection', {channel:kind === 'quickMask' ? 'quickMask' : key, operation:loadOp(e)});
        else runCmd('ps.channel.target', {channel:kind === 'quickMask' ? 'composite' : key});
      };
      if (kind === 'alpha') r.ondblclick = () => askName(L3('通道選項', '通道选项', 'Channel Options'), name, n => CMD.run('ps.channel.rename', {channel:key, name:n}));
      r.oncontextmenu = e => { e.preventDefault(); ctxMenu(r, [
        kind !== 'mask' && kind !== 'quickMask' ? {label:L3('複製色版…', '复制通道…', 'Duplicate Channel'), act:'dup', run:() => runCmd('ps.channel.duplicate', {channel:key})} : null,
        kind === 'alpha' ? {label:L3('刪除色版', '删除通道', 'Delete Channel'), act:'del', run:() => runCmd('ps.channel.delete', {channel:key})} : null,
        kind === 'alpha' ? {label:L3('重新命名色版…', '重命名通道…', 'Rename Channel…'), act:'ren', run:() => askName(L3('通道選項', '通道选项', 'Channel Options'), name, n => CMD.run('ps.channel.rename', {channel:key, name:n}))} : null,
        kind === 'mask' ? {label:Doc.active() && Doc.active().maskEnabled === false ? L3('啟用圖層遮色片', '启用图层蒙版', 'Enable Layer Mask') : L3('停用圖層遮色片', '停用图层蒙版', 'Disable Layer Mask'), act:'maskOn', disabled:!has('ps.layer.layerMask.enabled'), run:() => runCmd('ps.layer.layerMask.enabled', {})} : null,
        kind === 'mask' ? {label:L3('刪除圖層遮色片', '删除图层蒙版', 'Delete Layer Mask'), act:'maskDel', disabled:!has('ps.layer.layerMask.delete'), run:() => runCmd('ps.layer.layerMask.delete', {})} : null,
        kind === 'quickMask' ? {label:L3('結束快速遮色片', '退出快速蒙版', 'Exit Quick Mask'), act:'qmOff', disabled:!has('ps.select.editInQuickMaskMode'), run:() => runCmd('ps.select.editInQuickMaskMode', {on:false})} : null,
        {sep:true}, {label:L3('新增色版…', '新建通道…', 'New Channel…'), act:'new', run:() => runCmd('ps.channel.new', {})}]); };
      list.appendChild(r);
    };
    add('composite', 'RGB', chanThumb(null, cd, null), 2, 'composite');
    [['red', L3('紅', '红', 'Red'), 0], ['green', L3('綠', '绿', 'Green'), 1], ['blue', L3('藍', '蓝', 'Blue'), 2]].forEach(([k, n, c]) => add(k, T(n), chanThumb(null, cd, c), 3 + c, 'color'));
    const L = Doc.active(); if (L && L.mask) add('mask', `${L.name} ${T(L3('遮色片', '蒙版', 'Mask'))}`, el('span', {style:'width:30px'}), 0, 'mask');
    alphas.forEach((c, i) => add(i, c.name, chanThumb(c.data), i + 6 <= 9 ? i + 6 : 0, 'alpha'));
    if (window.PsSelect && PsSelect.quickMaskOn && PsSelect.quickMaskOn()) add('quickMask', T(L3('快速遮色片', '快速蒙版', 'Quick Mask')), el('span', {style:'width:30px'}), 0, 'quickMask');
    b.appendChild(el('div', {class:'bar'}, [
      btn('◌', L3('載入色版為選取範圍', '将通道作为选区载入', 'Load channel as selection'), () => runCmd('ps.select.loadSelection', {channel:tgt}), {disabled:!has('ps.select.loadSelection'), dataset:{a:'load'}}),
      btn('◍', L3('儲存選取範圍為色版', '将选区存储为通道', 'Save selection as channel'), () => runCmd('ps.select.saveSelection', {}), {disabled:!has('ps.select.saveSelection') || !Doc.sel, dataset:{a:'save'}}),
      el('span', {style:'flex:1'}),
      btn('＋', L3('建立新色版', '创建新通道', 'Create new channel'), () => runCmd('ps.channel.new', {}), {dataset:{a:'new'}}),
      btn('🗑', L3('刪除目前色版', '删除当前通道', 'Delete current channel'), () => runCmd('ps.channel.delete', {}), {dataset:{a:'del'}, disabled:!(typeof tgt === 'number' || tgt === 'mask')})]));
  }});

/* ═══════════ 路径（vector_ui.rs:682-780） ═══════════
   列：工作路径（文字 ▸ 建立工作路径／从选区生成的 Doc.workPath，斜体）＋每个矢量层（我们的「存起来的路径」＝矢量层）。
   点一列＝选这条路径（不换当前层：填充／描边画进当前像素层、矢量蒙版加在当前层，照 PS）；双击工作路径＝存成路径；双击矢量层＝切到那层。
   底下七钮照原码 vector_ui.rs:751-759：用前景色填充、用画笔描边、载入为选区、从选区生成工作路径、添加矢量蒙版、新建路径、删除路径。 */
const PathSt = PsWindow.paths = {sel:null};
/* 给填充的「脚本 ▸ 沿路径置入」等别支用：目前的路径键、它的子路径、平坦化（函数在下面宣告，提升可用） */
PathSt.current = p => curPath(p || {});
PathSt.subpaths = k => pathSubpaths(k);
PathSt.flatten = sp => flatten(sp);
function pathSubpaths(key){
  if (key === 'work'){ const w = Doc.workPath; return w && Array.isArray(w.subpaths) ? clone(w.subpaths) : null; }
  const L = Doc.byId(key); if (!L || L.kind !== 'vector') return null;
  const out = [], dx = L.x || 0, dy = L.y || 0, mv = q => q ? [q[0] + dx, q[1] + dy] : null;
  const walk = list => (list || []).forEach(s => {
    if (s.visible === false) return;
    if (Array.isArray(s.children)){ walk(s.children); return; }
    const v = window.VecSel ? VecSel.asBezier(s) : (s.type === 'bezier' ? s : null); if (!v || !v.anchors || v.anchors.length < 2) return;
    out.push({closed:!!v.closed, anchors:v.anchors.map(a => ({x:a.x + dx, y:a.y + dy, in:mv(a.in), out:mv(a.out)}))});
  });
  walk(L.data.shapes);
  return out;
}
function pathRows(){
  const rows = [];
  if (Doc.workPath && Array.isArray(Doc.workPath.subpaths) && Doc.workPath.subpaths.length) rows.push({key:'work', name:T(L3('工作路徑', '工作路径', 'Work Path')), work:true});
  Doc.layers.filter(L => L.kind === 'vector').reverse().forEach(L => rows.push({key:L.id, name:L.name}));
  return rows;
}
const curPath = p => { const k = p && p.path !== undefined ? p.path : PathSt.sel; if (k === '') return undefined;   // ''＝点了面板空白、一条都没选（PS）
  return pathRows().some(r => r.key === k) ? k : (pathRows()[0] || {}).key; };
function tracePath(ctx, subs, s){
  s = s || 1; ctx.beginPath();
  subs.forEach(sp => { const A = sp.anchors; ctx.moveTo(A[0].x * s, A[0].y * s);
    const seg = (p, q) => { if (!p.out && !q.in) ctx.lineTo(q.x * s, q.y * s); else { const c1 = p.out || [p.x, p.y], c2 = q.in || [q.x, q.y]; ctx.bezierCurveTo(c1[0] * s, c1[1] * s, c2[0] * s, c2[1] * s, q.x * s, q.y * s); } };
    for (let i = 1; i < A.length; i++) seg(A[i - 1], A[i]);
    if (sp.closed){ seg(A[A.length - 1], A[0]); ctx.closePath(); } });
}
/* 一条路径的涵盖度画布（文件大小，白＝里面）；feather＝高斯模糊 */
function pathCoverage(subs, feather, aa){
  const c = document.createElement('canvas'); c.width = Doc.width; c.height = Doc.height; const x = c.getContext('2d');
  if (feather > 0) x.filter = `blur(${feather / 2}px)`;
  x.fillStyle = '#fff'; tracePath(x, subs); x.fill('nonzero');
  if (aa === false){ const im = x.getImageData(0, 0, c.width, c.height); for (let i = 3; i < im.data.length; i += 4) im.data[i] = im.data[i] >= 128 ? 255 : 0; x.putImageData(im, 0, 0); }
  return c;
}
/* 平坦化成折线（每段按长度取点；路径给画笔描边用，原码 flatten_path 0.1 容差） */
function flatten(sp){
  const A = sp.anchors, pts = [[A[0].x, A[0].y]];
  const seg = (p, q) => {
    if (!p.out && !q.in){ pts.push([q.x, q.y]); return; }
    const c1 = p.out || [p.x, p.y], c2 = q.in || [q.x, q.y], n = Math.max(4, Math.ceil(Math.hypot(c1[0] - p.x, c1[1] - p.y) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + Math.hypot(q.x - c2[0], q.y - c2[1])) / 2);
    for (let i = 1; i <= n; i++){ const t = i / n, u = 1 - t; pts.push([u * u * u * p.x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * q.x, u * u * u * p.y + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * q.y]); }
  };
  for (let i = 1; i < A.length; i++) seg(A[i - 1], A[i]);
  if (sp.closed) seg(A[A.length - 1], A[0]);
  return pts;
}
const pixelTarget = p => { const L = p.layer ? Doc.byId(p.layer) : Doc.active(); return L && L.kind === 'raster' && !L.adjust && !L.fillLayer ? L : null; };
const regPath = (id, params, fn, undo) => CMD.reg('ps.path.' + id, {i18n:'', params, undoable:!!undo}, fn);
regPath('list', '{} 路径面板的各列 → {ok, rows:[{key:"work"|矢量层 id, name, work?}], selected}', () => ({ok:true, rows:pathRows(), selected:curPath()}));
regPath('select', '{path:"work"|矢量层 id} 路径面板点一列＝选这条路径（不换当前层）→ {ok, selected}', p => { if (!pathRows().some(r => r.key === p.path)) return fail('ps.path.select: no such path'); PathSt.sel = p.path; P.refresh('paths'); if (window.UI) UI.draw(); return {ok:true, selected:p.path}; });
regPath('deselect', '{} 路径面板点空白处＝取消选中路径（PS：路径不再显示；之后钢笔路径模式画的是一条新的工作路径、换掉旧的）→ {ok}', () => {
  PathSt.sel = ''; if (window.VecSel && VecSel.layerId === '__work') VecSel.clear(); if (window.PathSel) PathSel.wsel = null;
  P.refresh('paths'); if (window.UI) UI.draw(); return {ok:true, selected:null};
});
regPath('fill', '{path?:"work"|矢量层 id（缺省＝选中的）, layer?:像素层 id（缺省＝当前层）, color?:"#rrggbb"=前景色, opacity?:0..100=100, feather?:px=0, antiAlias?:bool=true} 用前景色填充路径（vector_cmds.rs:783 path_fill）：画进像素层 → {ok}', p => {
  const k = curPath(p), subs = k !== undefined ? pathSubpaths(k) : null; if (!subs || !subs.length) return fail('ps.path.fill: no path (draw one with the Pen tool or make a work path)');
  const L = pixelTarget(p); if (!L) return fail('Fill Path needs a pixel layer (select one in the Layers panel)');
  const cov = pathCoverage(subs, Math.max(0, +p.feather || 0), p.antiAlias), col = document.createElement('canvas'); col.width = cov.width; col.height = cov.height;
  const cx = col.getContext('2d'); cx.drawImage(cov, 0, 0); cx.globalCompositeOperation = 'source-in'; cx.fillStyle = typeof p.color === 'string' ? p.color : fg(); cx.fillRect(0, 0, col.width, col.height);
  const ctx = L.data.ctx; ctx.save(); ctx.globalAlpha = clamp(p.opacity === undefined ? 100 : +p.opacity, 0, 100) / 100; ctx.drawImage(col, -(L.x || 0), -(L.y || 0)); ctx.restore();
  Layer.invalidate(L); return {ok:true, path:k, layer:L.id};
}, true);
/* PS 2020「描边路径」对话框的工具清单（18 项）；每项都走该工具自己的笔画命令、用该工具目前的选项栏设定：
   混合器画笔＝目前混合器选项与载入的储槽；仿制图章／修复画笔＝作用中取样点（没取样＝报错，同 PS）；图案图章＝选项栏图案；
   历史记录画笔／历史记录艺术画笔＝选项栏来源；背景橡皮擦＝橡皮擦工具的背景橡皮擦选项；模糊…海绵＝各自的 *.stroke＋各自选项栏（retouchOpts）。
   顺序出处：① Photoshop JavaScript 参考 ToolType 列举值（PENCIL 1、BRUSH 2、ERASER 3、BACKGROUNDERASER 4、CLONESTAMP 5、PATTERNSTAMP 6、HEALINGBRUSH 7、
   HISTORYBRUSH 8、ARTHISTORYBRUSH 9、SMUDGE 10、BLUR 11、SHARPEN 12、DODGE 13、BURN 14、SPONGE 15、COLORREPLACEMENTTOOL 16＝对话框原本的十六项与先后）；
   ② Adobe 社群错误回报「P: PS 26.3 Stroke Path Choices apply incorrect tool; applies tool above it」（2025-02）：选「混合器画笔」画出图案图章（＝上一项）、
   「修复画笔就在混合器画笔正下方」⇒ 混合器画笔排在图案图章与修复画笔之间。污点修复画笔（ToolType 没有，CS5 后才进清单）的位置没查到，推定接在修复画笔后。 */
const STROKE_TOOLS = [['pencil', L3('鉛筆', '铅笔', 'Pencil')], ['brush', L3('筆刷', '画笔', 'Brush')], ['eraser', L3('橡皮擦', '橡皮擦', 'Eraser')],
  ['bgEraser', L3('背景橡皮擦', '背景橡皮擦', 'Background Eraser')], ['clone', L3('仿製印章', '仿制图章', 'Clone Stamp')], ['patternstamp', L3('圖樣印章', '图案图章', 'Pattern Stamp')],
  ['mixer', L3('混合器筆刷', '混合器画笔', 'Mixer Brush')],
  ['heal', L3('修復筆刷', '修复画笔', 'Healing Brush')], ['spotheal', L3('污點修復筆刷', '污点修复画笔', 'Spot Healing Brush')],
  ['historybrush', L3('步驟記錄筆刷', '历史记录画笔', 'History Brush')], ['arthistory', L3('藝術步驟記錄筆刷', '历史记录艺术画笔', 'Art History Brush')],
  ['smudge', L3('指尖', '涂抹', 'Smudge')], ['blur', L3('模糊', '模糊', 'Blur')], ['sharpen', L3('銳利化', '锐化', 'Sharpen')], ['dodge', L3('加亮', '减淡', 'Dodge')],
  ['burn', L3('加深', '加深', 'Burn')], ['sponge', L3('海綿', '海绵', 'Sponge')], ['colorreplace', L3('顏色取代', '颜色替换', 'Color Replacement')]];
const RETOUCH_STROKE = ['smudge', 'blur', 'sharpen', 'dodge', 'burn', 'sponge'];
/* 修饰工具描边＝该工具选项栏现值（PS 描边路径用手上那颗工具的设定）：模糊／锐化／涂抹＝强度（＋取样所有图层、保护细节、手指绘画；tools/blur.js RetouchDab）；
   减淡／加深＝范围＋曝光度＋保护色调；海绵＝模式＋流量＋自然饱和度（tools/dodge.js Toning） */
const retouchOpts = tool => {
  if (['blur', 'sharpen', 'smudge'].includes(tool)){ if (!(window.RetouchDab && RetouchDab.strokeParams)) return {}; const o = RetouchDab.strokeParams(tool, []); delete o.points; return o; }
  const Tn = window.Toning; if (!Tn) return {};
  if (tool === 'dodge' || tool === 'burn') return {range:Tn.toneOpts.range, exposure:Tn.toneOpts.exposure, protectTones:Tn.toneOpts.protectTones};
  if (tool === 'sponge') return {mode:Tn.spongeOpts.mode, vibrance:Tn.spongeOpts.vibrance, flow:Tn.spongeOpts.flow};
  return {};
};
/* 走工具自己的 pathParams（＝滑鼠收笔那包参数）的几颗：工具 id → 命令 */
const TOOL_STROKE = { clone:'clone.stamp', heal:'heal.stroke', spotheal:'spotheal.stroke', patternstamp:'patternstamp.paint', historybrush:'historybrush.paint',
  arthistory:'arthistory.paint', colorreplace:'colorreplace.stroke', mixer:'mixer.stroke' };
regPath('stroke', '{path?, layer?:像素层 id, tool:"pencil|brush|eraser|bgEraser|clone|patternstamp|mixer|heal|spotheal|historybrush|arthistory|smudge|blur|sharpen|dodge|burn|sponge|colorreplace"="brush"（模糊…海绵用各自选项栏的强度／曝光度／范围／模式／流量）, simulatePressure?:bool=false（模拟压力：两头细）, size?:px, hardness?:0..1, opacity?:0..100, color?:"#rrggbb"=前景色} 描边路径（vector_cmds.rs:837 path_stroke：用该工具目前设定、平滑关掉；mixer＝目前混合器选项＋载入的储槽；clone／heal 要先有取样点）→ {ok, dabs}', p => {
  const k = curPath(p), subs = k !== undefined ? pathSubpaths(k) : null; if (!subs || !subs.length) return fail('ps.path.stroke: no path');
  const L = pixelTarget(p); if (!L) return fail('Stroke Path needs a pixel layer (select one in the Layers panel)');
  const tool = p.tool || 'brush'; if (!STROKE_TOOLS.some(t => t[0] === tool)) return fail(`ps.path.stroke: unknown tool \`${tool}\` (${STROKE_TOOLS.map(t => t[0]).join('|')})`);
  const id = tool === 'eraser' ? 'eraser.stroke' : tool === 'bgEraser' ? 'eraser.background' : tool === 'pencil' ? 'pencil.stroke' : TOOL_STROKE[tool] ? TOOL_STROKE[tool]
    : RETOUCH_STROKE.includes(tool) ? tool + '.stroke' : 'brush.stroke'; if (!CMD.map[id]) return fail('no ' + id + ' command');
  const TT = TOOL_STROKE[tool] ? (tool === 'mixer' ? window.MixerBrush : window.Tools && Tools.get && Tools.get(tool)) : null;
  if (TOOL_STROKE[tool] && !(TT && TT.pathParams)) return fail('ps.path.stroke: tool `' + tool + '` is not available');
  /* 模拟压力（PS 描边路径对话框）：沿路径长度两头压力小、中间满；没勾＝满压 */
  const press = pts => { if (p.simulatePressure !== true) return pts.map(q => [q[0], q[1], 1]); const acc = [0]; for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const len = acc[acc.length - 1] || 1; return pts.map((q, i) => [q[0], q[1], Math.max(0.05, Math.sin(Math.PI * acc[i] / len))]); };
  let dabs = 0;
  for (const sp of subs){
    const pts = press(flatten(sp));
    let q;
    if (tool === 'bgEraser'){
      const o = CMD.map['eraser.setOptions'] ? CMD.map['eraser.setOptions'].run({}) : {};
      q = {points:pts, layerId:L.id, smoothing:0, sampling:o.bgSampling, limits:o.bgLimits, tolerance:o.bgTolerance, protectForegroundColor:!!o.bgProtectFg};
      if (typeof o.bgSwatch === 'string') q.background = o.bgSwatch;
      if (typeof p.size === 'number') q.size = p.size; if (typeof p.hardness === 'number') q.hardness = p.hardness;
    }
    else if (TOOL_STROKE[tool] && tool !== 'mixer'){
      q = TT.pathParams(L, pts);
      if (!q) return fail(tool === 'clone' ? 'Could not use the clone stamp because the area to clone has not been defined (Alt-click to define a source point).'
                                           : 'Could not use the healing brush because the area to sample has not been defined (Alt-click to define a source point).');
      if (typeof p.size === 'number') q.size = p.size;
      if (typeof p.hardness === 'number') q.hardness = tool === 'colorreplace' ? p.hardness : clamp(p.hardness, 0, 1) * 100;
    }
    else if (tool === 'mixer'){ q = MixerBrush.pathParams(L, pts); if (typeof p.size === 'number') q.size = p.size; if (typeof p.hardness === 'number') q.hardness = p.hardness; }
    else if (RETOUCH_STROKE.includes(tool)){ q = Object.assign(retouchOpts(tool), {points:pts, layerId:L.id}); if (typeof p.size === 'number') q.size = p.size; if (typeof p.hardness === 'number') q.hardness = clamp(p.hardness, 0, 1) * 100; }
    else {
      q = {points:pts, layerId:L.id, smoothing:0};
      if (typeof p.size === 'number') q.size = p.size; if (typeof p.hardness === 'number') q.hardness = p.hardness; if (tool === 'pencil') q.hardness = 1;
      if (typeof p.opacity === 'number') q.opacity = clamp(p.opacity, 0, 100) / 100; if (tool !== 'eraser') q.color = typeof p.color === 'string' ? p.color : fg();
    }
    const r = CMD.map[id].run(q); if (r && r.ok === false) return r; dabs += (r && r.dabs) || 0;
  }
  return {ok:true, path:k, layer:L.id, dabs};
}, true);
/* PS 路径面板右键／钢笔右键「描边路径…」＝这个对话框：工具下拉（缺省＝手上的绘画工具，否则上回选的）＋模拟压力 → ps.path.stroke */
let lastStrokeTool = 'brush';
CMD.reg('ps.path.stroke.dialog', {i18n:'', params:'{path?} 开「描边路径」对话框（工具／模拟压力；确定＝跑 ps.path.stroke）'}, p => {
  const k = curPath(p || {}); if (k === undefined || !(pathSubpaths(k) || []).length) return fail('ps.path.stroke: no path');
  const cur = window.ToolState && ToolState.cur, tool = STROKE_TOOLS.some(t => t[0] === cur) ? cur : lastStrokeTool;
  P.dialog({id:'psStrokePath', title:L3('筆畫路徑', '描边路径', 'Stroke Path'),
    fields:[{k:'tool', type:'select', label:L3('工具：', '工具：', 'Tool:'), value:tool, options:STROKE_TOOLS},
            {k:'simulatePressure', type:'check', label:L3('模擬壓力', '模拟压力', 'Simulate Pressure'), value:false}],
    ok:v => { lastStrokeTool = v.tool; const r = runCmd('ps.path.stroke', {path:k, tool:v.tool, simulatePressure:!!v.simulatePressure}); if (window.UI) UI.refresh ? UI.refresh() : UI.draw(); return r && r.ok === false ? r : true; }});
  return {ok:true};
});
regPath('toSelection', '{path?, operation:"new|add|subtract|intersect"="new", feather?:px=0, antiAlias?:bool=true} 将路径作为选区载入 → {ok, selected}', p => {
  const k = curPath(p), subs = k !== undefined ? pathSubpaths(k) : null; if (!subs || !subs.length) return fail('ps.path.toSelection: no path');
  if (!window.SelMask || !SelMask.fromBytes) return fail('no selection engine');
  const op = p.operation || 'new'; if (!['new', 'replace', 'add', 'subtract', 'intersect'].includes(op)) return fail('ps.path.toSelection: unknown operation');
  const d = pathCoverage(subs, Math.max(0, +p.feather || 0), p.antiAlias).getContext('2d').getImageData(0, 0, Doc.width, Doc.height).data, n = Doc.width * Doc.height;
  const old = Doc.sel && SelMask.bytes ? SelMask.bytes() : null, out = new Uint8Array(n); let any = 0;
  for (let i = 0; i < n; i++){ const a = d[i * 4 + 3], o = old ? old[i] : 0;
    out[i] = op === 'add' ? Math.max(a, o) : op === 'subtract' ? Math.max(o - a, 0) : op === 'intersect' ? Math.min(a, o) : a; any |= out[i]; }
  Doc.sel = any ? SelMask.fromBytes(out) : null;
  return {ok:true, selected:!!any};
}, true);
regPath('fromSelection', '{tolerance:0.5..10 px=2} 从选区生成工作路径（select.toWorkPath／右键「建立工作路径…」）：选区边缘拟合成贝兹（外圈＋洞，洞反向），放进文件的工作路径（不新增图层）；照 PS 选区随即取消 → {ok, subpaths, holes}', p => {
  if (!Doc.sel) return fail('make a selection first');
  const tol = typeof p.tolerance === 'number' ? p.tolerance : 2;
  let subs;
  if (window.PsSelect && PsSelect.traceSelection) subs = PsSelect.traceSelection(tol);
  else {                                                         // 退路：转换为形状（洞挖不出来）
    const c = CMD.map['ps.select.convertToShape']; if (!c) return fail('no ps.select.convertToShape');
    const act = Doc.activeId, r = c.run({tolerance:tol}); if (!r || r.ok === false || !r.id) return r || fail('could not trace the selection');
    subs = pathSubpaths(r.id) || []; Doc.remove(r.id); if (Doc.byId(act)) Doc.activeId = act;
  }
  if (!subs || !subs.length) return fail('could not trace the selection');
  const holes = subs.filter(s => s.hole).length;
  Doc.workPath = {layerId:null, subpaths:subs.map(s => ({closed:s.closed, anchors:s.anchors}))}; PathSt.sel = 'work';
  Doc.sel = null;                                                // PS：选区变成路径后蚂蚁线就没了
  return {ok:true, subpaths:subs.length, holes};
}, true);
/* 右键「建立工作路径…」／路径面板菜单：PS 的小框只有「容差：2.0 像素」（0.5～10） */
let lastWpTol = 2;
CMD.reg('ps.path.fromSelection.dialog', {i18n:'', params:'{} 开「建立工作路径」对话框（容差 0.5～10 像素，记住上次的值）；确定＝跑 ps.path.fromSelection。没有选区＝不开'}, () => {
  if (!Doc.sel) return fail('make a selection first');
  const d = P.dialog({id:'psMakeWorkPath', title:L3('製作工作路徑', '建立工作路径', 'Make Work Path'),
    fields:[{k:'tolerance', type:'number', label:L3('容許度：', '容差：', 'Tolerance:'), value:lastWpTol.toFixed(1), min:0.5, max:10, step:0.1}],
    ok:v => {
      const t = Number(v.tolerance); if (!isFinite(t) || t < 0.5 || t > 10) return fail(T(L3('請輸入 0.5 到 10 之間的數值。', '请输入 0.5 到 10 之间的数值。', 'Enter a value between 0.5 and 10.')));
      const r = runCmd('ps.path.fromSelection', {tolerance:t}); if (r && r.ok === false) return r;
      lastWpTol = t; if (window.UI) UI.refresh ? UI.refresh() : UI.draw(); return true;
    }});
  if (d && d.fields.tolerance){ const s = document.createElement('span'); s.textContent = T(L3('像素', '像素', 'pixels')); d.fields.tolerance.inp.after(s); }
  return {ok:true, dialog:'ps.path.fromSelection'};
});
regPath('saveWorkPath', '{name?（缺省 "Path N"）} 存储工作路径（双击工作路径）：变成一个看不见的矢量层（填色／描边都无＝纯路径）→ {ok, id, name}', p => {
  const subs = pathSubpaths('work'); if (!subs || !subs.length) return fail('no work path');
  let n = 1; while (Doc.layers.some(L => L.name === `Path ${n}`)) n++;
  const L = Layer.vector(typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `Path ${n}`), act = Doc.activeId;
  subs.forEach(sp => L.data.shapes.push({id:'S' + Math.random().toString(36).slice(2, 9), type:'bezier', anchors:sp.anchors, closed:sp.closed, fill:'none', stroke:'none', strokeWidth:0}));
  Doc.add(L); if (Doc.byId(act)) Doc.activeId = act; Doc.workPath = undefined; PathSt.sel = L.id;
  return {ok:true, id:L.id, name:L.name};
}, true);
regPath('new', '{name?（缺省 "Path N"）} 创建新路径＝新建一个空的矢量层 → {ok, id, name}', p => {
  let n = 1; while (Doc.layers.some(L => L.name === `Path ${n}`)) n++;
  const L = Layer.vector(typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `Path ${n}`); Doc.add(L); PathSt.sel = L.id; return {ok:true, id:L.id, name:L.name};
}, true);
regPath('delete', '{path?} 删除路径（工作路径＝清掉；矢量层＝删层）→ {ok}', p => {
  const k = curPath(p); if (k === undefined) return fail('no path');
  if (k === 'work') Doc.workPath = undefined; else if (!Doc.remove(k)) return fail('could not delete');
  PathSt.sel = null; return {ok:true, deleted:k};
}, true);
regPath('vectorMask', '{path?, id?:要加蒙版的图层（缺省＝当前层）} 添加矢量蒙版：用这条路径做当前层的矢量蒙版 → {ok}', p => {
  const k = curPath(p); if (k === undefined) return fail('no path'); const c = CMD.map['ps.layer.vectorMask.currentPath']; if (!c) return fail('no vector mask command');
  const tgt = p.id || Doc.activeId;
  if (k === tgt) return fail('select the layer to mask in the Layers panel (not the path layer itself)');
  return k === 'work' ? c.run({id:tgt, path:pathSubpaths('work').map(sp => ({type:'bezier', anchors:sp.anchors, closed:sp.closed}))}) : c.run({id:tgt, from:k});
}, true);
P.define('paths', {title:L3('路徑', '路径', 'Paths'), w:260,
  refresh(b){
    b.innerHTML = '';
    const rows = pathRows(), sel = curPath();
    if (!rows.length) b.appendChild(el('div', {class:'hint', text:T(L3('用鋼筆工具（P）繪製，或從選取範圍建立工作路徑。', '用钢笔工具（P）绘制，或从选区建立工作路径。', 'Draw with the Pen tool (P) or make a work path from a selection.'))}));
    const list = el('div', {class:'list', style:'min-height:60px', onclick:e => { if (e.target === list && curPath() !== undefined) runCmd('ps.path.deselect', {}); }}); b.appendChild(list);   // 点列表空白处＝取消选中（PS）
    rows.forEach(r => {
      const th = el('canvas', {width:28, height:28, style:'background:#fff;border:1px solid #0006'}), subs = pathSubpaths(r.key) || [], s = Math.min(26 / Doc.width, 26 / Doc.height), x = th.getContext('2d');
      x.translate((28 - Doc.width * s) / 2, (28 - Doc.height * s) / 2); x.fillStyle = '#555'; tracePath(x, subs, s); x.fill();
      const li = el('div', {class:'li' + (r.key === sel ? ' on' : ''), dataset:{id:r.key}, style:r.work ? 'font-style:italic' : '', onclick:() => runCmd('ps.path.select', {path:r.key}),
        ondblclick:() => r.work ? runCmd('ps.path.saveWorkPath', {}) : runCmd('layer.select', {id:r.key})}, [th, el('span', {text:r.name})]);
      /* PS 路径面板右键一列：先选它，再出选单（存储路径／删除路径／建立选区／填充路径…／描边路径…） */
      li.oncontextmenu = e => { e.preventDefault(); runCmd('ps.path.select', {path:r.key}); const px = !!pixelTarget({});
        ctxMenu(li, [r.work ? {label:L3('儲存路徑…', '存储路径…', 'Save Path…'), act:'save', run:() => runCmd('ps.path.saveWorkPath', {})} : null,
          {label:L3('刪除路徑', '删除路径', 'Delete Path'), act:'del', run:() => runCmd('ps.path.delete', {path:r.key})}, {sep:true},
          {label:L3('製作選取範圍…', '建立选区…', 'Make Selection…'), act:'toSel', run:() => runCmd('ps.path.toSelection', {path:r.key})},
          {label:L3('填滿路徑…', '填充路径…', 'Fill Path…'), act:'fill', disabled:!px, run:() => runCmd('ps.path.fill', {path:r.key})},
          {label:L3('筆畫路徑…', '描边路径…', 'Stroke Path…'), act:'stroke', disabled:!px, run:() => runCmd('ps.path.stroke.dialog', {path:r.key})}]); };
      list.appendChild(li);
    });
    const has1 = sel !== undefined, pix = !!pixelTarget({});
    b.appendChild(el('div', {class:'bar'}, [
      btn('●', L3('以前景色填滿路徑', '用前景色填充路径', 'Fill path with foreground color'), () => runCmd('ps.path.fill', {}), {disabled:!has1 || !pix, dataset:{a:'fill'}}),
      btn('○', L3('以筆刷繪製路徑', '用画笔描边路径', 'Stroke path with brush'), () => runCmd('ps.path.stroke', {}), {disabled:!has1 || !pix, dataset:{a:'stroke'}}),
      btn('◌', L3('載入路徑為選取範圍', '将路径作为选区载入', 'Load path as a selection'), () => runCmd('ps.path.toSelection', {}), {disabled:!has1, dataset:{a:'toSel'}}),
      btn('◇', L3('從選取範圍建立工作路徑', '从选区生成工作路径', 'Make work path from selection'), () => runCmd('ps.path.fromSelection', {}), {disabled:!Doc.sel, dataset:{a:'fromSel'}}),
      btn('▣', L3('增加向量圖遮色片', '添加矢量蒙版', 'Add vector mask'), () => runCmd('ps.path.vectorMask', {}), {disabled:!has1 || !has('ps.layer.vectorMask.currentPath'), dataset:{a:'vmask'}}),
      btn('＋', L3('建立新路徑', '创建新路径', 'Create new path'), () => runCmd('ps.path.new', {}), {dataset:{a:'new'}}),
      btn('🗑', L3('刪除路徑', '删除路径', 'Delete path'), () => runCmd('ps.path.delete', {}), {disabled:!has1, dataset:{a:'del'}})]));
  }});
/* 选中的路径在画布上描一条细线（PS 路径面板选中＝显示路径） */
onUI(() => { if (!Array.isArray(UI.overlays) || UI.__psWinPathOv) return; UI.__psWinPathOv = true; UI.overlays.push((ctx, s) => {
  if (!P.isOpen('paths') || PathSt.sel === null) return; const subs = pathSubpaths(PathSt.sel); if (!subs || !subs.length) return;
  ctx.save(); tracePath(ctx, subs, s); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.stroke(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.restore(); }); });

/* ═══════════ 图层复合（comps_ui.rs:28-180；engine comps_cmds：可见性／位置／外观） ═══════════ */
const Comps = PsWindow.comps = {list:[], applied:null, selected:null, last:null, serial:-1,
  get(){ if (this.serial !== Doc.serial){ this.serial = Doc.serial; this.list = []; this.applied = null; this.selected = null; this.last = null; } return this.list; },
  capture(){ return Doc.layers.map(L => ({id:L.id, visible:L.visible, x:L.x, y:L.y, opacity:L.opacity, blend:L.blend, style:L.style ? JSON.parse(JSON.stringify(L.style)) : null})); },
  missing(c){ return c.state.filter(s => !Doc.byId(s.id)).length; },
  restore(st, o){ o = o || {visibility:true, position:true, appearance:true}; let missing = 0;
    st.forEach(s => { const L = Doc.byId(s.id); if (!L){ missing++; return; }
      if (o.visibility) L.visible = s.visible; if (o.position){ L.x = s.x; L.y = s.y; }
      if (o.appearance){ L.opacity = s.opacity; L.blend = s.blend; if (s.style) L.style = JSON.parse(JSON.stringify(s.style)); else delete L.style; } Layer.invalidate(L); });
    return missing; },
  /* comps_ui.rs:16 target：面板选的那个（还在）否则最后套用的 */
  target(){ const C = this.get(); return this.selected !== null && C[this.selected] ? this.selected : this.applied !== null && C[this.applied] ? this.applied : null; }};
const compOf = p => { const C = Comps.get(); const i = typeof p.comp === 'string' ? C.findIndex(c => c.name === p.comp) : p.comp === undefined ? Comps.target() : +p.comp; return i !== null && C[i] ? i : -1; };
const regC = (id, params, fn, undo) => CMD.reg('ps.layerComp.' + id, {i18n:'', params, undoable:!!undo}, fn);
regC('new', '{name?, visibility=true, position=true, appearance=true, comment?} 新建图层复合（记下每层的可见性／位置／外观）→ {ok, index}', p => {
  const C = Comps.get(); C.push({name:p.name || `Layer Comp ${C.length + 1}`, comment:p.comment || '', visibility:p.visibility !== false, position:p.position !== false, appearance:p.appearance !== false, state:Comps.capture()});
  Comps.applied = Comps.selected = C.length - 1; return {ok:true, index:Comps.applied};
});
regC('apply', '{comp: 序号|名字} 套用图层复合（第一次套用前先存「最后的文档状态」）→ {ok, missing}', p => {
  const i = compOf(p); if (i < 0) return {ok:false, error:'no such layer comp'};
  if (Comps.applied === null || !Comps.last) Comps.last = Comps.capture();
  const c = Comps.get()[i], m = Comps.restore(c.state, c); Comps.applied = i; c.warning = m > 0; return {ok:true, missing:m};
}, true);
regC('select', '{comp} 图层复合面板点一列＝选它（不套用；更新／删除作用在选中的）→ {ok, selected}', p => { const i = compOf(p); if (i < 0) return fail('no such layer comp'); Comps.selected = i; P.refresh('layerComps'); return {ok:true, selected:i}; });
regC('restoreLastDocumentState', '{} 回到套用图层复合之前的状态', () => { if (!Comps.last) return {ok:false, error:'no saved state'}; Comps.restore(Comps.last); Comps.applied = null; return {ok:true}; }, true);
regC('update', '{comp?} 用目前的图层状态更新这个复合（缺省＝选中的，没有就最后套用的）', p => { const i = compOf(p); if (i < 0) return {ok:false, error:'no such layer comp'}; Comps.get()[i].state = Comps.capture(); Comps.get()[i].warning = false; return {ok:true}; });
regC('updateWarnings', '{comp?, clear:true} 清除图层复合的警告三角（记录的层被删了）→ {ok}', p => { const C = Comps.get(), i = compOf(p); (i >= 0 ? [C[i]] : C).forEach(c => { c.warning = false; c.cleared = Comps.missing(c); }); return {ok:true}; });
regC('delete', '{comp?} 删除图层复合', p => { const i = compOf(p); if (i < 0) return {ok:false, error:'no such layer comp'}; Comps.get().splice(i, 1); Comps.applied = null; Comps.selected = null; return {ok:true}; });
regC('setOptions', '{comp, visibility?, position?, appearance?} 图层复合三个开关', p => { const i = compOf(p); if (i < 0) return {ok:false, error:'no such layer comp'}; const c = Comps.get()[i]; ['visibility', 'position', 'appearance'].forEach(k => { if (typeof p[k] === 'boolean') c[k] = p[k]; }); return {ok:true}; });
['previous', 'next'].forEach(k => regC(k, `{} 套用${k === 'next' ? '下' : '上'}一个图层复合`, () => {
  const C = Comps.get(); if (!C.length) return {ok:false, error:'no layer comps'};
  const cur = Comps.applied === null ? (k === 'next' ? -1 : C.length) : Comps.applied;
  const i = (cur + (k === 'next' ? 1 : -1) + C.length) % C.length; Comps.selected = i;
  return CMD.map['ps.layerComp.apply'].run({comp:i});
}, true));
regC('list', '{} → {ok, comps:[{name, visibility, position, appearance, warning, missing}], applied, selected}', () => ({ok:true, comps:Comps.get().map(c => ({name:c.name, comment:c.comment, visibility:c.visibility, position:c.position, appearance:c.appearance, warning:Comps.missing(c) > (c.cleared || 0), missing:Comps.missing(c)})), applied:Comps.applied, selected:Comps.target()}));
P.define('layerComps', {title:L3('圖層構圖', '图层复合', 'Layer Comps'), w:270,
  refresh(b){
    b.innerHTML = ''; const C = Comps.get(), tgt = Comps.target(), list = el('div', {class:'list'}); b.appendChild(list);
    list.appendChild(el('div', {class:'li' + (Comps.applied === null ? ' on' : ''), dataset:{i:'last'}, text:(Comps.applied === null ? '☑ ' : '☐ ') + T(L3('上次文件狀態', '最后的文档状态', 'Last Document State')), onclick:() => { if (Comps.applied !== null && Comps.last) runCmd('ps.layerComp.restoreLastDocumentState'); }}));
    if (!C.length) b.appendChild(el('div', {class:'hint', text:T(L3('用下方 ＋ 記下每個圖層的可見度、位置與樣式，之後就能在幾個版本間切換。', '用下方 ＋ 记下每个图层的可见性、位置和样式，之后就能在几个版本之间切换。', 'Capture the visibility, position and style of every layer with + below, then switch between versions.'))}));
    C.forEach((c, i) => {
      const t = (k, ic, tip) => el('span', {text:ic, title:`${T(tip)}: ${c[k] ? 'on' : 'off'}`, dataset:{opt:k}, style:'cursor:pointer;opacity:' + (c[k] ? 1 : .3), onclick:e => { e.stopPropagation(); runCmd('ps.layerComp.setOptions', {comp:i, [k]:!c[k]}); P.refresh('layerComps'); }});
      const miss = Comps.missing(c), warn = miss > (c.cleared || 0);
      list.appendChild(el('div', {class:'li' + (tgt === i ? ' on' : ''), dataset:{i}, title:c.comment || '', onclick:() => runCmd('ps.layerComp.select', {comp:i}), ondblclick:() => runCmd('ps.layerComp.apply', {comp:i})}, [
        el('span', {text:Comps.applied === i ? '☑' : '☐', dataset:{mark:i}, title:T(L3('套用此圖層構圖', '应用此图层复合', 'Apply this layer comp')), onclick:e => { e.stopPropagation(); runCmd('ps.layerComp.select', {comp:i}); runCmd('ps.layerComp.apply', {comp:i}); }}),
        warn ? el('span', {text:'⚠', dataset:{warn:i}, style:'color:#e0b040;cursor:pointer', title:T(L3(`這個構圖記錄的 ${miss} 個圖層已刪除。更新構圖，或清除警告。`, `这个复合记录的 ${miss} 个图层已删除。更新复合，或清除警告。`, `${miss} layer(s) recorded by this comp were deleted. Update the comp, or clear the warning.`)), onclick:e => { e.stopPropagation(); runCmd('ps.layerComp.updateWarnings', {comp:i, clear:true}); P.refresh('layerComps'); }}) : null,
        el('span', {text:c.name, style:'flex:1'}), t('visibility', '👁', L3('套用可見度', '应用可见性', 'Apply Visibility')), t('position', '✥', L3('套用位置', '应用位置', 'Apply Position')), t('appearance', '✦', L3('套用外觀（圖層樣式）', '应用外观（图层样式）', 'Apply Appearance (Layer Style)'))]));
    });
    b.appendChild(el('div', {class:'bar'}, [btn('«', L3('套用上一個選取的圖層構圖', '应用上一个所选图层复合', 'Apply previous selected layer comp'), () => runCmd('ps.layerComp.previous'), {disabled:!C.length, dataset:{a:'prev'}}),
      btn('»', L3('套用下一個選取的圖層構圖', '应用下一个所选图层复合', 'Apply next selected layer comp'), () => runCmd('ps.layerComp.next'), {disabled:!C.length, dataset:{a:'next'}}),
      el('span', {style:'flex:1'}), btn('⟳', L3('更新圖層構圖（可見度、位置與外觀）', '更新图层复合（可见性、位置和外观）', 'Update layer comp (visibility, position and appearance)'), () => { runCmd('ps.layerComp.update'); P.refresh('layerComps'); }, {disabled:tgt === null, dataset:{a:'update'}}),
      btn('＋', L3('建立新圖層構圖', '创建新的图层复合', 'Create new layer comp'), () => { runCmd('ps.layerComp.new'); P.refresh('layerComps'); }, {dataset:{a:'new'}}),
      btn('🗑', L3('刪除圖層構圖', '删除图层复合', 'Delete layer comp'), () => { runCmd('ps.layerComp.delete'); P.refresh('layerComps'); }, {disabled:tgt === null, dataset:{a:'del'}})]));
  }});

/* ═══════════ 预设面板共用浏览器（preset_panels.rs:243-465 browser／generic）：
   组（三角＋资料夹，第一组预设开着）、缩图格（大小滑杆拉到最小＝清单）、点一下＝选、双击＝套用、右键「重命名…／删除／移到 ▸ 组」、组右键「重命名组…／删除组」、
   底下：缩图大小｜新建组、新建、删除。状态（开合、大小、选中）存在 localStorage dlPsPresetUi.v1。 ═══════════ */
const PU = PsWindow.presetUi = Object.assign({sizes:{}, toggled:{}, selected:{}, shapeGroups:[]}, LSget('dlPsPresetUi.v1', {}));
const savePU = () => LSput('dlPsPresetUi.v1', {sizes:PU.sizes, toggled:PU.toggled, selected:PU.selected, shapeGroups:PU.shapeGroups});
const MIN_THUMB = 20;
function browser(b, o){
  const size = PU.sizes[o.panel] || 40, list = size <= MIN_THUMB + 0.5, sel = PU.selected[o.panel], names = o.groups.map(g => g.name);
  const wrap = el('div', {class:'pbrowse', dataset:{panel:o.panel}, style:'max-height:300px;overflow:auto'});
  o.groups.forEach((g, gi) => {
    const key = o.panel + '/' + g.name, open = (gi === 0) !== !!PU.toggled[key];
    const hd = el('div', {class:'li pgh', dataset:{group:g.name}, style:'font-size:11.5px', text:(open ? '▾ 📂 ' : '▸ 📁 ') + g.name,
      onclick:() => { if (PU.toggled[key]) delete PU.toggled[key]; else PU.toggled[key] = true; savePU(); P.refresh(o.panel); }});
    if (o.groupMenu) hd.oncontextmenu = e => { e.preventDefault(); ctxMenu(hd, o.groupMenu(g)); };
    wrap.appendChild(hd);
    if (!open) return;
    const box = el('div', {class:list ? 'list' : 'grid', style:list ? '' : 'padding:2px 0 4px 8px;gap:4px'});
    g.items.forEach(it => {
      const on = sel === it.key;
      const cell = list ? el('div', {class:'li pitem' + (on ? ' on' : ''), dataset:{key:it.key}, title:it.name}, [o.thumb(20, it), el('span', {text:it.name})])
        : el('div', {class:'pitem', dataset:{key:it.key}, title:it.name, style:`width:${size}px;height:${size}px;cursor:pointer;overflow:hidden;border:${on ? '2px solid var(--accent,#2f7fd8)' : '1px solid #0006'};box-sizing:border-box`}, [o.thumb(size, it)]);
      cell.onclick = e => o.select(it.key, e);
      if (o.activate) cell.ondblclick = e => o.activate(it.key, e);
      if (o.itemMenu) cell.oncontextmenu = e => { e.preventDefault(); o.select(it.key, e, true); ctxMenu(cell, o.itemMenu(it, g, names)); };
      box.appendChild(cell);
    });
    wrap.appendChild(box);
  });
  b.appendChild(wrap);
  const sl = el('input', {type:'range', min:MIN_THUMB, max:96, step:1, value:size, dataset:{k:'thumbSize'}, title:T(L3('縮圖大小（最小＝清單）', '缩览图大小（最小＝列表）', 'Thumbnail size (smallest: list)')), style:'flex:0 0 90px;min-width:60px',
    onchange:() => { PU.sizes[o.panel] = +sl.value; savePU(); P.refresh(o.panel); }});
  b.appendChild(el('div', {class:'bar', style:'align-items:center'}, [sl, el('span', {style:'flex:1'}),
    o.newGroup ? btn('📁', L3('建立新群組', '创建新组', 'Create new group'), o.newGroup, {dataset:{act:'newGroup'}}) : null,
    btn('＋', o.newTip, o.newItem, {dataset:{act:'new'}, disabled:!o.newItem}),
    btn('🗑', L3('刪除', '删除', 'Delete'), () => { const k = PU.selected[o.panel]; if (k !== undefined && o.del) o.del(k); }, {dataset:{act:'delete'}, disabled:!o.del || sel === undefined})]));
}
/* 预设项右键：重命名…／删除／移到 ▸（同 preset_panels.rs:375-391） */
const itemMenuOf = (cmdEdit, rnTitle) => (it, g, names) => [
  {label:L3('重新命名…', '重命名…', 'Rename…'), act:'rename', run:() => askName(rnTitle, it.name, n => CMD.run(cmdEdit, {action:'rename', preset:it.name, name:n}))},
  {label:L3('刪除', '删除', 'Delete'), act:'delete', run:() => runCmd(cmdEdit, {action:'delete', preset:it.name})},
  {sep:true}].concat(names.filter(n => n !== g.name).map(n => ({label:{'zh-Hant':'移到 ▸ ' + n, 'zh-Hans':'移到 ▸ ' + n, en:'Move to ▸ ' + n}, act:'move:' + n, run:() => runCmd(cmdEdit, {action:'move', preset:it.name, to:n})})));
const groupMenuOf = cmdEdit => g => [
  {label:L3('重新命名群組…', '重命名组…', 'Rename Group…'), act:'renameGroup', run:() => askName(L3('群組名稱', '组名称', 'Group Name'), g.name, n => CMD.run(cmdEdit, {action:'renameGroup', group:g.name, name:n}))},
  {label:L3('刪除群組', '删除组', 'Delete Group'), act:'deleteGroup', run:() => runCmd(cmdEdit, {action:'deleteGroup', group:g.name})}];
/* 组编辑（presets/mod.rs edit_groups 的 JS 版）：groups=[{name, items:[{name,…}]}] */
function editGroups(groups, p, cmd){
  const all = () => groups.flatMap(g => g.items), uniq = (base, used) => { if (!used.includes(base)) return base; for (let n = 2; ; n++){ const s = `${base} ${n}`; if (!used.includes(s)) return s; } };
  const find = name => { for (const g of groups){ const i = g.items.findIndex(x => x.name === name); if (i >= 0) return {g, i}; } return null; };
  const a = p.action;
  if (a === 'rename'){ const f = find(p.preset); if (!f) return fail(`${cmd}: no preset \`${p.preset}\``); const n = String(p.name || '').trim(); if (!n) return fail(`${cmd}: missing \`name\``);
    if (n !== p.preset && all().some(x => x.name === n)) return fail(`${cmd}: \`${n}\` already exists`); f.g.items[f.i].name = n; return {ok:true, name:n}; }
  if (a === 'delete'){ const L = Array.isArray(p.preset) ? p.preset : [p.preset]; let n = 0; L.forEach(nm => { const f = find(nm); if (f){ f.g.items.splice(f.i, 1); n++; } }); return n ? {ok:true, deleted:n} : fail(`${cmd}: no preset \`${p.preset}\``); }
  if (a === 'move'){ const f = find(p.preset); if (!f) return fail(`${cmd}: no preset \`${p.preset}\``); let g = groups.find(x => x.name === p.to); if (!g){ if (!p.to) return fail(`${cmd}: missing \`to\``); g = {name:String(p.to), items:[]}; groups.push(g); }
    const [it] = f.g.items.splice(f.i, 1); const at = Number.isInteger(p.index) ? clamp(p.index, 0, g.items.length) : g.items.length; g.items.splice(at, 0, it); return {ok:true, group:g.name}; }
  if (a === 'newGroup'){ const n = uniq(String(p.name || 'Group').trim() || 'Group', groups.map(g => g.name)); groups.push({name:n, items:[]}); return {ok:true, group:n}; }
  if (a === 'renameGroup'){ const g = groups.find(x => x.name === p.group); if (!g) return fail(`${cmd}: no group \`${p.group}\``); const n = String(p.name || '').trim(); if (!n) return fail(`${cmd}: missing \`name\``);
    if (n !== g.name && groups.some(x => x.name === n)) return fail(`${cmd}: group \`${n}\` already exists`); g.name = n; return {ok:true, group:n}; }
  if (a === 'deleteGroup'){ const i = groups.findIndex(x => x.name === p.group); if (i < 0) return fail(`${cmd}: no group \`${p.group}\``); groups.splice(i, 1); return {ok:true}; }
  return fail(`${cmd}: unknown action \`${a}\` (rename|delete|move|newGroup|renameGroup|deleteGroup)`);
}
const uniqName = (base, used) => { if (!used.includes(base)) return base; for (let n = 2; ; n++){ const s = `${base} ${n}`; if (!used.includes(s)) return s; } };

/* ═══════════ 渐变（preset_panels.rs:482-518）：点一下＝设成目前渐变（选中渐变填充层时顺便改它）；双击＝新建渐变填充图层（gradients.rs:404 apply） ═══════════ */
const gradResolve = st => (st || []).map(s => [s[0], s[1] === 'foreground' ? fg() : s[1] === 'background' ? bg() : s[1]]);
const gradCss = st => `linear-gradient(90deg,${gradResolve(st).map(s => s[1] + ' ' + Math.round(s[0] * 100) + '%').join(',')})`;
function gradFind(name){ const r = peek('gradient.presets.list'); if (!r) return null; for (const g of r.groups) for (const q of g.presets) if (q.name === name) return q; return null; }
/* 透明度色标 [[t, a]…] 内插到每个颜色色标 */
const opAt = (tr, t) => { if (!Array.isArray(tr) || !tr.length) return 1; const T2 = tr.map(x => Array.isArray(x) ? x : [x.t !== undefined ? x.t : x.pos, x.a !== undefined ? x.a : x.opacity]).sort((a, b) => a[0] - b[0]);
  if (t <= T2[0][0]) return T2[0][1]; for (let i = 1; i < T2.length; i++) if (t <= T2[i][0]){ const [t0, a0] = T2[i - 1], [t1, a1] = T2[i]; return a0 + (a1 - a0) * (t1 > t0 ? (t - t0) / (t1 - t0) : 0); } return T2[T2.length - 1][1]; };
const gradFillStops = q => gradResolve(q.stops).map(([t, c]) => [t, c, opAt(q.transparency || q.opacity, t)]);
CMD.reg('ps.gradient.presets.choose', {i18n:'', params:'{preset} 渐变面板点一下：设成目前渐变（渐变工具画它）；当前层是渐变填充图层＝顺便换成这个渐变（一步历史）→ {ok, layer?}'}, p => {
  const q = gradFind(p.preset); if (!q) return fail(`no gradient "${p.preset}"`);
  const r = runCmd('gradient.presets.select', {preset:p.preset}); if (r && r.ok === false) return r;
  PU.selected.gradients = p.preset; savePU();
  const L = Doc.active();
  if (L && L.fillLayer && L.fillLayer.type === 'gradient' && has('ps.layer.setFill')){ const r2 = CMD.run('ps.layer.setFill', {id:L.id, stops:gradFillStops(q)}); return Object.assign({ok:true, layer:L.id}, r2 && r2.ok === false ? {ok:false, error:r2.error} : {}); }
  return {ok:true};
});
CMD.reg('ps.gradient.presets.apply', {i18n:'', undoable:true, params:'{preset, angle?:度=90, style?:"linear|radial|angle|reflected|diamond"="linear", reverse?, scale?:10..150=100} 渐变面板双击（或拖到画布）：用这个渐变新建渐变填充图层 → {ok, layer}'}, p => {
  const q = gradFind(p.preset); if (!q) return fail(`no gradient "${p.preset}"`); const c = CMD.map['ps.layer.newFillLayer.gradient']; if (!c) return fail('no gradient fill layer command');
  const r = c.run({stops:gradFillStops(q), angle:typeof p.angle === 'number' ? p.angle : 90, style:p.style || 'linear', reverse:!!p.reverse, scale:typeof p.scale === 'number' ? p.scale : 100}); if (r && r.ok === false) return r;
  return {ok:true, layer:Doc.activeId, preset:q.name};
});
P.define('gradients', {title:L3('漸層', '渐变', 'Gradients'), w:270, h:340,
  refresh(b){
    b.innerHTML = ''; const r = peek('gradient.presets.list'); if (!r){ b.appendChild(el('div', {class:'hint', text:'—'})); return; }
    b.appendChild(el('div', {style:`height:18px;border:1px solid #000;margin-bottom:6px;background:${gradCss(r.current && r.current.stops)}`, class:'gcur', title:r.current ? r.current.name : ''}));
    browser(b, {panel:'gradients', groups:r.groups.map(g => ({name:g.name, items:g.presets.map(q => ({key:q.name, name:q.name, q}))})),
      thumb:(sz, it) => el('div', {style:`width:${sz}px;height:${sz === 20 ? 16 : sz}px;flex:0 0 auto;background:${gradCss(it.q.stops)}`}),
      select:k => runCmd('ps.gradient.presets.choose', {preset:k}), activate:k => runCmd('ps.gradient.presets.apply', {preset:k}),
      itemMenu:itemMenuOf('gradient.presets.edit', L3('漸層名稱', '渐变名称', 'Gradient Name')), groupMenu:groupMenuOf('gradient.presets.edit'),
      newGroup:() => { const x = runCmd('gradient.presets.edit', {action:'newGroup', name:'Group'}); if (x && x.group) askName(L3('群組名稱', '组名称', 'Group Name'), x.group, n => CMD.run('gradient.presets.edit', {action:'renameGroup', group:x.group, name:n})); },
      newItem:() => { const x = runCmd('gradient.presets.new', {name:'Custom'}); if (x && x.name){ PU.selected.gradients = x.name; savePU(); askName(L3('漸層名稱', '渐变名称', 'Gradient Name'), x.name, n => CMD.run('gradient.presets.edit', {action:'rename', preset:x.name, name:n})); } },
      newTip:L3('建立新漸層', '创建新渐变', 'Create new gradient'),
      del:k => { const x = runCmd('gradient.presets.edit', {action:'delete', preset:k}); if (x && x.ok !== false){ delete PU.selected.gradients; savePU(); } }});
  }});
/* gradient.presets.* 是工具状态命令（不经过 UI.refresh 的面板刷新）⇒ 跑完补刷渐变面板 */
if (!CMD.__psWinGradRefresh){ CMD.__psWinGradRefresh = true; const r0 = CMD.run; CMD.run = function(id){ const o = r0.apply(this, arguments); if (/^(gradient\.presets\.|ps\.edit\.(definePattern|presets\.|defineCustomShape)|ps\.channel\.|ps\.select\.saveSelection)/.test(id)) P.schedule('doc'); return o; }; }

/* ═══════════ 图案（preset_panels.rs:522-567）：点一下＝选（选中图案填充层时顺便换掉）；双击＝新建图案填充图层（patterns.rs apply）；
   改名／删除走 预设管理器 ps.edit.presets.presetManager（我们的图案库是平的，没有组 ⇒ 新建组／移到组不做） ═══════════ */
const PatTile = {};
function patTile(q){
  const k = q.id + ':' + q.width + 'x' + q.height; if (PatTile[k]) return PatTile[k];
  const lib = window.PsEdit && PsEdit.patterns ? PsEdit.patterns.load() : [], it = lib.find(x => x.id === q.id); if (!it || !it.px) return null;
  const c = document.createElement('canvas'); c.width = it.width; c.height = it.height;
  try { c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(it.px), it.width, it.height), 0, 0); } catch(e){ return null; }
  return (PatTile[k] = c);
}
function patThumb(sz, q){
  const c = el('canvas', {width:sz, height:sz, style:`width:${sz}px;height:${sz}px;flex:0 0 auto;background:#fff`}), t = patTile(q); if (!t) return c;
  const x = c.getContext('2d'), k = Math.min(1, sz / Math.max(t.width, t.height) * 2); x.scale(k, k); x.fillStyle = x.createPattern(t, 'repeat'); x.fillRect(0, 0, sz / k, sz / k); return c;
}
const patList = () => peek('ps.pattern.list') || [];
const patOf = v => patList().find(q => q.id === v || q.name === v);
CMD.reg('ps.pattern.presets.choose', {i18n:'', params:'{pattern:id|名字} 图案面板点一下：选这个图案（填充的「图案」、新建图案填充层预设用它）；当前层是图案填充图层＝顺便换成它（一步历史）→ {ok, pattern, layer?}'}, p => {
  const q = patOf(p.pattern); if (!q) return fail(`no pattern "${p.pattern}"`);
  PsWindow.pattern = q.id; PU.selected.patterns = q.id; savePU(); P.refresh('patterns');
  const L = Doc.active();
  if (L && L.fillLayer && L.fillLayer.type === 'pattern' && has('ps.layer.setFill')){ const r = CMD.run('ps.layer.setFill', {id:L.id, pattern:q.id}); if (r && r.ok === false) return r; return {ok:true, pattern:q.id, layer:L.id}; }
  return {ok:true, pattern:q.id};
});
CMD.reg('ps.pattern.presets.apply', {i18n:'', undoable:true, params:'{pattern?:id|名字（缺省＝选中的）, scale?:%=100} 图案面板双击：用这个图案新建图案填充图层 → {ok, layer}'}, p => {
  const q = patOf(p.pattern === undefined ? PsWindow.pattern : p.pattern); if (!q) return fail('no pattern selected');
  const c = CMD.map['ps.layer.newFillLayer.pattern']; if (!c) return fail('no pattern fill layer command');
  const r = c.run({pattern:q.id, scale:typeof p.scale === 'number' ? p.scale : 100}); if (r && r.ok === false) return r; PsWindow.pattern = q.id; return {ok:true, layer:Doc.activeId, pattern:q.id};
});
CMD.reg('ps.pattern.presets.edit', {i18n:'', params:'{action:"rename|delete", pattern:id|名字, name?} 图案面板右键：重命名／删除图案（走预设管理器）→ {ok}'}, p => {
  const L = patList(), i = L.findIndex(q => q.id === p.pattern || q.name === p.pattern); if (i < 0) return fail(`no pattern "${p.pattern}"`);
  if (!has('ps.edit.presets.presetManager')) return fail('no preset manager');
  const r = CMD.map['ps.edit.presets.presetManager'].run(p.action === 'rename' ? {action:'rename', kind:'patterns', index:i, newName:p.name} : p.action === 'delete' ? {action:'delete', kind:'patterns', index:i} : {action:'?'});
  if (r && r.ok !== false && p.action === 'delete' && PU.selected.patterns === L[i].id){ delete PU.selected.patterns; savePU(); }
  P.refresh('patterns'); return r;
});
P.define('patterns', {title:L3('圖樣', '图案', 'Patterns'), w:270,
  refresh(b){
    b.innerHTML = ''; const L = patList();
    browser(b, {panel:'patterns', groups:[{name:T(L3('圖樣', '图案', 'Patterns')), items:L.map(q => ({key:q.id, name:q.name, q}))}],
      thumb:(sz, it) => patThumb(sz, it.q), select:k => runCmd('ps.pattern.presets.choose', {pattern:k}), activate:k => runCmd('ps.pattern.presets.apply', {pattern:k}),
      itemMenu:it => [{label:L3('重新命名…', '重命名…', 'Rename…'), act:'rename', run:() => askName(L3('圖樣名稱', '图案名称', 'Pattern Name'), it.name, n => CMD.run('ps.pattern.presets.edit', {action:'rename', pattern:it.key, name:n}))},
        {label:L3('刪除', '删除', 'Delete'), act:'delete', run:() => runCmd('ps.pattern.presets.edit', {action:'delete', pattern:it.key})}],
      newItem:has('ps.edit.definePattern') ? () => runCmd('ps.edit.definePattern', {dialog:true}) : null, newTip:L3('從選取範圍建立新圖樣', '从选区创建新图案', 'Create new pattern from the selection'),
      del:k => runCmd('ps.pattern.presets.edit', {action:'delete', pattern:k})});
  }});

/* ═══════════ 样式（preset_panels.rs:632-676；engine/src/presets/styles.rs:60-144 照抄）：点一下＝套用到当前层（Shift＝加在原有效果后面）；
   ＋＝从当前层新建样式（style.presets.new）；右键改名／删除／移到组；组可新建／改名／删除。样式库存在 localStorage dlPsStyles.v1（内建的照抄进去，可改） ═══════════ */
const STYLES = [
  ['Basics', [['Default Style (None)', []], ['Drop Shadow', [['dropShadow', {distance:6, size:8, opacity:60}]]], ['Soft Shadow', [['dropShadow', {distance:2, size:16, opacity:45}]]],
    ['Black Stroke', [['stroke', {size:3, color:'#000000', position:'outside'}]]], ['White Stroke', [['stroke', {size:3, color:'#ffffff', position:'outside'}]]],
    ['Inner Shadow', [['innerShadow', {distance:4, size:6, opacity:55}]]], ['Outer Glow', [['outerGlow', {size:14, color:'#ffe9a8', opacity:80}]]], ['Emboss', [['bevelEmboss', {style:'emboss', size:4, depth:120}]]]]],
  ['Text Effects', [['Neon Blue', [['colorOverlay', {color:'#d8f4ff'}], ['innerGlow', {color:'#3fb6ff', size:6, opacity:90, blend:'normal'}], ['outerGlow', {color:'#1e90ff', size:22, opacity:90}]]],
    ['Neon Pink', [['colorOverlay', {color:'#ffe1f3'}], ['innerGlow', {color:'#ff4fb4', size:6, opacity:90, blend:'normal'}], ['outerGlow', {color:'#ff2d95', size:22, opacity:90}]]],
    ['Chrome', [['gradientOverlay', {from:'#3a3f47', to:'#f4f6f8', angle:90}], ['bevelEmboss', {style:'inner', size:6, depth:250, soften:1}], ['stroke', {size:1, color:'#2a2d33', position:'outside'}]]],
    ['Gold', [['gradientOverlay', {from:'#8a5a12', to:'#ffe08a', angle:90}], ['bevelEmboss', {style:'inner', size:5, depth:180}], ['dropShadow', {distance:3, size:5, opacity:50}]]],
    ['Comic Outline', [['colorOverlay', {color:'#ffd23f'}], ['stroke', {size:4, color:'#111111', position:'outside'}], ['dropShadow', {distance:6, size:0, opacity:100, angle:135}]]],
    ['Letterpress', [['colorOverlay', {color:'#5b6168'}], ['innerShadow', {distance:2, size:2, opacity:70}], ['dropShadow', {distance:1, size:0, color:'#ffffff', opacity:60, blend:'screen', angle:90}]]],
    ['Hollow', [['stroke', {size:2, color:'#222222', position:'inside'}]], 0]]],
  ['Buttons', [['Glass', [['gradientOverlay', {from:'#2b6cb0', to:'#90cdf4', angle:90}], ['innerGlow', {color:'#ffffff', size:6, opacity:45, blend:'screen'}], ['bevelEmboss', {style:'inner', size:8, depth:100, soften:4}], ['dropShadow', {distance:3, size:8, opacity:40}]]],
    ['Gel Green', [['gradientOverlay', {from:'#1f7a3a', to:'#7be495', angle:90}], ['innerShadow', {distance:2, size:5, opacity:35}], ['bevelEmboss', {style:'inner', size:10, depth:150, soften:6}]]],
    ['Pressed', [['colorOverlay', {color:'#d7dbe0'}], ['innerShadow', {distance:3, size:6, opacity:60}], ['stroke', {size:1, color:'#9aa1a9', position:'inside'}]]],
    ['Pill Red', [['gradientOverlay', {from:'#9b1c1c', to:'#f87171', angle:90}], ['bevelEmboss', {style:'pillow', size:6, depth:120}], ['dropShadow', {distance:2, size:4, opacity:45}]]],
    ['Flat Shadow', [['colorOverlay', {color:'#3b82f6'}], ['dropShadow', {distance:5, size:0, opacity:35, angle:90}]]],
    ['Satin Plum', [['colorOverlay', {color:'#7e3a8c'}], ['satin', {color:'#1b0420', opacity:55, size:18, distance:14}], ['bevelEmboss', {style:'inner', size:4, depth:80}]]]]]];
const ST_LS = 'dlPsStyles.v1';
const builtinStyles = () => STYLES.map(([g, items]) => ({name:g, items:items.map(s => Object.assign({name:s[0], effects:clone(s[1])}, s[2] !== undefined ? {fill:s[2]} : {}))}));
const StyleLib = PsWindow.styleLib = {groups:null,
  get(){ if (!this.groups){ const v = LSget(ST_LS, null); this.groups = Array.isArray(v) ? v : builtinStyles(); } return this.groups; },
  save(){ LSput(ST_LS, this.groups); },
  find(name){ for (const g of this.get()) for (const it of g.items) if (it.name === name) return it; return null; }};
CMD.reg('ps.style.presets.list', {i18n:'', params:'{} 样式库 → {ok, groups:[{name, presets:[名字]}]}'}, () => ({ok:true, groups:StyleLib.get().map(g => ({name:g.name, presets:g.items.map(x => x.name)}))}));
CMD.reg('ps.style.presets.apply', {i18n:'', undoable:true, params:'{preset: 样式名, add?:bool（Shift＝加在原有效果后面）, id?: 图层} 样式面板：套用样式（换掉图层效果；「Default Style (None)」＝清掉、填充回 100%）→ {ok, effects}'}, p => {
  const st = StyleLib.find(p.preset); if (!st) return {ok:false, error:`no style "${p.preset}"`};
  const L = p.id ? Doc.byId(p.id) : Doc.active(); if (!L) return {ok:false, error:'no active layer'};
  const R = (id, q) => { const c = CMD.map[id]; if (!c) throw new Error('missing ' + id); const r = c.run(q); if (r && r.ok === false) throw new Error(r.error || id); return r; };
  let n = 0;
  try {
    if (st.style){                                                     // 从图层存下来的（style.presets.new）：整组效果原样
      const items = clone(st.style.items || []);
      if (p.add && L.style && Array.isArray(L.style.items)) L.style.items = L.style.items.concat(items); else L.style = Object.assign(clone(st.style), {items});
      n = items.length;
    } else {
      if (!p.add) R('ps.layer.layerStyle.clear', {id:L.id});
      st.effects.forEach(([kind, q]) => R('ps.layer.layerStyle.' + kind, Object.assign({id:L.id, add:true}, q))); n = st.effects.length;
    }
    const fill = st.fill !== undefined ? st.fill : (!p.add && !n ? 1 : undefined);   // presets/styles.rs：Hollow 填充 0；Default 回 100%
    if (fill !== undefined && has('ps.layer.layerStyle.blendingOptions')) R('ps.layer.layerStyle.blendingOptions', {id:L.id, fillOpacity:fill * 100});
  } catch(e){ return {ok:false, error:e.message}; }
  Layer.invalidate(L); return {ok:true, effects:n};
});
CMD.reg('ps.style.presets.new', {i18n:'', params:'{name?="Style", group?（缺省＝最后一组）, id?:图层（缺省＝当前层）} 样式面板 ＋：从图层的效果与填充不透明度新建样式（presets/styles.rs new）→ {ok, name, group}'}, p => {
  const L = p.id ? Doc.byId(p.id) : Doc.active(); if (!L) return fail('no active layer');
  const G = StyleLib.get(); let g = p.group ? G.find(x => x.name === p.group) : G[G.length - 1];
  if (!g){ g = {name:String(p.group || 'Styles'), items:[]}; G.push(g); }
  const name = uniqName(String(p.name || 'Style').trim() || 'Style', G.flatMap(x => x.items.map(i => i.name)));
  g.items.push({name, style:clone(L.style || {enabled:true, items:[]}), fill:L.fillOpacity === undefined ? 1 : L.fillOpacity});
  StyleLib.save(); P.refresh('styles'); return {ok:true, name, group:g.name};
});
CMD.reg('ps.style.presets.edit', {i18n:'', params:'{action:"rename|delete|move|newGroup|renameGroup|deleteGroup", preset?, name?, to?, group?} 样式面板的组编辑 → {ok}'}, p => {
  const r = editGroups(StyleLib.get(), p, 'ps.style.presets.edit'); if (r.ok !== false){ StyleLib.save(); P.refresh('styles'); } return r;
});
CMD.reg('ps.style.presets.reset', {i18n:'', params:'{} 样式库回到内建 21 个 → {ok}'}, () => { StyleLib.groups = builtinStyles(); StyleLib.save(); P.refresh('styles'); return {ok:true}; });
/* 缩图：一块圆角方块套上该样式的主要颜色（颜色叠加／渐变叠加／描边／发光），近似原码 styles.rs thumbnail */
function styleThumb(sz, it){
  const c = el('canvas', {width:sz, height:sz, style:`width:${sz}px;height:${sz}px;flex:0 0 auto;background:#3a3f47`}), x = c.getContext('2d'), m = sz * 0.22, w = sz - 2 * m;
  const fx = it.effects ? it.effects.map(([k, q]) => Object.assign({kind:k}, q)) : ((it.style && it.style.items) || []).map(e => Object.assign({kind:e.kind || e.type}, e.params || e));
  const glow = fx.find(e => e.kind === 'outerGlow' || e.kind === 'dropShadow');
  if (glow){ x.shadowColor = glow.color || (glow.kind === 'dropShadow' ? 'rgba(0,0,0,.7)' : '#ffe9a8'); x.shadowBlur = Math.max(2, (glow.size || 6) * sz / 64); x.shadowOffsetY = glow.kind === 'dropShadow' ? Math.max(1, (glow.distance || 3) * sz / 64) : 0; }
  const go = fx.find(e => e.kind === 'gradientOverlay'), co = fx.find(e => e.kind === 'colorOverlay');
  let fill = '#c8ccd2'; if (go){ const g = x.createLinearGradient(0, m + w, 0, m); g.addColorStop(0, go.from || '#000'); g.addColorStop(1, go.to || '#fff'); fill = g; } else if (co) fill = co.color || fill;
  x.fillStyle = (it.fill === 0) ? 'rgba(0,0,0,0)' : fill; x.beginPath(); x.roundRect ? x.roundRect(m, m, w, w, sz * 0.08) : x.rect(m, m, w, w); x.fill(); x.shadowColor = 'transparent';
  const sk = fx.find(e => e.kind === 'stroke'); if (sk){ x.lineWidth = Math.max(1, (sk.size || 2) * sz / 48); x.strokeStyle = sk.color || '#000'; x.stroke(); }
  return c;
}
P.define('styles', {title:L3('樣式', '样式', 'Styles'), w:260,
  refresh(b){
    b.innerHTML = '';
    browser(b, {panel:'styles', groups:StyleLib.get().map(g => ({name:g.name, items:g.items.map(s => Object.assign({key:s.name}, s))})), thumb:styleThumb,
      select:(k, e, quiet) => { PU.selected.styles = k; savePU(); if (!quiet) runCmd('ps.style.presets.apply', {preset:k, add:!!(e && e.shiftKey)}); else P.refresh('styles'); },
      itemMenu:itemMenuOf('ps.style.presets.edit', L3('樣式名稱', '样式名称', 'Style Name')), groupMenu:groupMenuOf('ps.style.presets.edit'),
      newGroup:() => { const x = runCmd('ps.style.presets.edit', {action:'newGroup', name:'Group'}); if (x && x.group) askName(L3('群組名稱', '组名称', 'Group Name'), x.group, n => CMD.run('ps.style.presets.edit', {action:'renameGroup', group:x.group, name:n})); },
      newItem:() => { const x = runCmd('ps.style.presets.new', {name:'Style'}); if (x && x.name){ PU.selected.styles = x.name; savePU(); askName(L3('新增樣式', '新建样式', 'New Style'), x.name, n => CMD.run('ps.style.presets.edit', {action:'rename', preset:x.name, name:n})); } },
      newTip:L3('從選取的圖層建立新樣式', '从所选图层创建新样式', 'Create new style from the selected layer'),
      del:k => { const x = runCmd('ps.style.presets.edit', {action:'delete', preset:k}); if (x && x.ok !== false){ delete PU.selected.styles; savePU(); } }});
  }});

/* ═══════════ 形状（preset_panels.rs:680-729）：自定形状库（编辑 ▸ 定义自定形状存的 dlcanvas.ps.customShapes）；
   内建五组（tools/customshape.js）在前；点一下＝选它并换成自定形状工具（customshape.options＋UI.pick）；双击＝在画布正中放一个（customshape.place）；右键改名／删除／移到组 ═══════════ */
const CS = () => window.PsEdit && PsEdit.customShapes ? PsEdit.customShapes : null;
const NOGROUP = 'Custom Shapes';
function shapeGroups(){
  const cs = CS(), list = cs ? cs.list() : [], G = [];
  const get = n => { let g = G.find(x => x.name === n); if (!g){ g = {name:n, items:[]}; G.push(g); } return g; };
  list.forEach(s => get(s.group || NOGROUP).items.push(s));
  (PU.shapeGroups || []).forEach(n => get(n));
  return G;
}
CMD.reg('ps.shape.presets.edit', {i18n:'', params:'{action:"rename|delete|move|newGroup|renameGroup|deleteGroup", preset?, name?, to?, group?} 形状面板：改自定形状库（改名／删除／移到组／组）→ {ok}'}, p => {
  const cs = CS(); if (!cs) return fail('no custom shape library (ps-edit.js)');
  const G = shapeGroups(), r = editGroups(G, p, 'ps.shape.presets.edit'); if (r.ok === false) return r;
  cs.save(G.flatMap(g => g.items.map(s => { const o = Object.assign({}, s); if (g.name === NOGROUP) delete o.group; else o.group = g.name; return o; })));
  PU.shapeGroups = G.filter(g => !g.items.length && g.name !== NOGROUP).map(g => g.name); savePU();
  if (p.action === 'delete' && PU.selected.shapes === p.preset){ delete PU.selected.shapes; savePU(); }
  P.refresh('shapes'); return r;
});
function shapeThumb(sz, it){
  const c = el('canvas', {width:sz, height:sz, style:`width:${sz}px;height:${sz}px;flex:0 0 auto`}), x = c.getContext('2d');
  const all = (it.subpaths || []).flatMap(sp => sp.anchors || []); if (!all.length) return c;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; all.forEach(a => { x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); x1 = Math.max(x1, a.x); y1 = Math.max(y1, a.y); });
  const k = (sz - 4) / Math.max(x1 - x0, y1 - y0, 1e-6); x.translate(2 + ((sz - 4) - (x1 - x0) * k) / 2 - x0 * k, 2 + ((sz - 4) - (y1 - y0) * k) / 2 - y0 * k);
  x.fillStyle = '#d6d6d6'; tracePath(x, it.subpaths.filter(sp => sp.anchors && sp.anchors.length > 1), k); x.fill(it.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'); return c;
}
P.define('shapes', {title:L3('形狀', '形状', 'Shapes'), w:260,
  refresh(b){
    b.innerHTML = ''; const G = shapeGroups();
    // 内建五组（tools/customshape.js 的 CustomShapeKit）放在库前面；库那几组照旧（改名／移组只动库）
    const BG = window.CustomShapeKit ? CustomShapeKit.builtin().map(g => ({name:g.name, items:g.items})) : [];
    if (!CS() && !BG.length){ b.appendChild(el('div', {class:'hint', text:T(L3('未做：沒有自訂形狀庫', '未做：没有自定形状库', 'Not done: no custom shape library'))})); return; }
    if (!BG.length && !G.some(g => g.items.length)) b.appendChild(el('div', {class:'hint', text:T(L3('還沒有自訂形狀：選一個向量圖層，按 ＋（編輯 ▸ 定義自訂形狀）。', '还没有自定形状：选一个矢量层，按 ＋（编辑 ▸ 定义自定形状）。', 'No custom shapes yet: select a vector layer and press + (Edit ▸ Define Custom Shape).'))}));
    const pickShape = k => { if (has('customshape.options') && CMD.run('customshape.options', {shape:k}).ok !== false && window.UI && UI.pick) UI.pick('customshape'); };
    browser(b, {panel:'shapes', groups:BG.concat(G).map(g => ({name:g.name, items:g.items.map(s => Object.assign({key:s.name}, s))})), thumb:shapeThumb,
      select:(k, e, quiet) => { PU.selected.shapes = k; PsWindow.customShape = k; savePU(); if (!quiet) pickShape(k); P.refresh('shapes'); },   // 点一下＝选形状并换成自定形状工具（右键只选不换）
      activate:k => has('customshape.place') ? runCmd('customshape.place', {preset:k}) : runCmd('ps.shape.placeCustom', {name:k, fill:fg()}),
      itemMenu:itemMenuOf('ps.shape.presets.edit', L3('形狀名稱', '形状名称', 'Shape Name')), groupMenu:groupMenuOf('ps.shape.presets.edit'),
      newGroup:() => { const x = runCmd('ps.shape.presets.edit', {action:'newGroup', name:'Group'}); if (x && x.group) askName(L3('群組名稱', '组名称', 'Group Name'), x.group, n => CMD.run('ps.shape.presets.edit', {action:'renameGroup', group:x.group, name:n})); },
      newItem:has('ps.edit.defineCustomShape') ? () => runCmd('ps.edit.defineCustomShape', {dialog:true}) : null, newTip:L3('從目前路徑建立新形狀', '从当前路径创建新形状', 'Create new shape from the current path'),
      del:k => runCmd('ps.shape.presets.edit', {action:'delete', preset:k})});
  }});

/* ═══════════ 工具预设（preset_panels.rs:828-916；engine/src/presets/tools.rs:38-47 五个内建）：
   点一下＝换工具并套选项；＋＝把目前工具的选项存成预设（再取名）；右键／🗑 改名、删除；「仅限当前工具」。库存在 localStorage dlPsToolPresets.v1 ═══════════ */
const TP_LS = 'dlPsToolPresets.v1';
/* 各工具读／写选项的命令（传 {} 就回现值） */
const OPTCMD = {brush:'brush.set', eraser:'eraser.setOptions', clone:'clone.setOptions', gradient:'gradient.options', marquee:'marquee.options', lasso:'lasso.options', wand:'wand.options', crop:'crop.options', move:'move.options'};
const TP_BUILTIN = () => [{name:'Soft Round 100 px', tool:'brush', cmd:'brush.set', params:{size:100, hardness:0}}, {name:'Hard Round 12 px', tool:'brush', cmd:'brush.set', params:{size:12, hardness:1}},
  {name:'Soft Eraser 60 px', tool:'eraser', cmd:'eraser.setOptions', params:{size:60, hardness:0}}, {name:'Radial Gradient', tool:'gradient', cmd:'gradient.options', params:{style:'radial'}},
  {name:'Clone Soft 40 px', tool:'clone', cmd:'clone.setOptions', params:{size:40, hardness:20}}];
const TPLib = PsWindow.toolPresets = {list:null, get(){ if (!this.list){ const v = LSget(TP_LS, null); this.list = Array.isArray(v) ? v : TP_BUILTIN(); } return this.list; }, save(){ LSput(TP_LS, this.list); }};
const toolName = id => { const t = Lang.t('tool.' + id); return t && t !== 'tool.' + id ? t : id; };
CMD.reg('ps.tool.presets.list', {i18n:'', params:'{currentToolOnly?:bool} → {ok, presets:[{name, tool}]}'}, p => ({ok:true, presets:TPLib.get().filter(t => !p.currentToolOnly || !window.ToolState || t.tool === ToolState.cur).map(t => ({name:t.name, tool:t.tool}))}));
CMD.reg('ps.tool.presets.select', {i18n:'', params:'{preset: 名字} 工具预设：换工具并套选项 → {ok, tool}'}, p => {
  const t = TPLib.get().find(x => x.name === p.preset); if (!t) return {ok:false, error:'no such tool preset'};
  if (window.UI && UI.pick) UI.pick(t.tool); if (t.cmd && CMD.map[t.cmd]) CMD.run(t.cmd, clone(t.params || {}));
  PU.selected.toolPresets = t.name; savePU(); return {ok:true, tool:t.tool};
});
CMD.reg('ps.tool.presets.new', {i18n:'', params:'{name?（缺省＝工具名）, tool?（缺省＝目前工具）} 工具预设 ＋：把目前工具的选项存成预设（presets/tools.rs new）→ {ok, name, tool}'}, p => {
  const tool = p.tool || (window.ToolState ? ToolState.cur : 'brush'), cmd = OPTCMD[tool] && CMD.map[OPTCMD[tool]] ? OPTCMD[tool] : null;
  let params = {};
  if (cmd){ const r = CMD.map[cmd].run({}); params = clone(r || {}); ['ok', 'color', 'seed', 'erase', 'ignored'].forEach(k => delete params[k]); }
  const L = TPLib.get(), name = uniqName(String(p.name || toolName(tool)).trim() || tool, L.map(x => x.name));
  L.push({name, tool, cmd, params}); TPLib.save(); PU.selected.toolPresets = name; savePU(); P.refresh('toolPresets'); return {ok:true, name, tool};
});
CMD.reg('ps.tool.presets.edit', {i18n:'', params:'{action:"rename|delete", preset, name?} 工具预设改名／删除 → {ok}'}, p => {
  const G = [{name:'all', items:TPLib.get()}], r = editGroups(G, p, 'ps.tool.presets.edit'); if (r.ok !== false){ TPLib.list = G[0].items; TPLib.save(); if (p.action === 'delete' && PU.selected.toolPresets === p.preset){ delete PU.selected.toolPresets; savePU(); } P.refresh('toolPresets'); } return r;
});
P.define('toolPresets', {title:L3('工具預設集', '工具预设', 'Tool Presets'), w:260,
  refresh(b){
    b.innerHTML = ''; const only = !!PsWindow.curToolOnly, cur = window.ToolState ? ToolState.cur : '', sel = PU.selected.toolPresets;
    const L = TPLib.get().filter(t => !only || t.tool === cur), list = el('div', {class:'list', style:'max-height:240px;overflow:auto'}); b.appendChild(list);
    if (!L.length) list.appendChild(el('div', {class:'hint', style:'padding:4px', text:T(only ? L3('目前工具沒有預設集。', '当前工具没有预设。', 'No presets for the current tool.') : L3('沒有工具預設集。', '没有工具预设。', 'No tool presets.'))}));
    L.forEach(t => { const r = el('div', {class:'li' + (sel === t.name ? ' on' : ''), dataset:{name:t.name}, title:toolName(t.tool), onclick:() => runCmd('ps.tool.presets.select', {preset:t.name})},
      [el('span', {class:'hint', text:(toolName(t.tool) || '?').slice(0, 2), style:'min-width:22px;margin:0'}), el('span', {text:t.name})]);
      r.oncontextmenu = e => { e.preventDefault(); ctxMenu(r, [{label:L3('重新命名工具預設集…', '重命名工具预设…', 'Rename Tool Preset…'), act:'rename', run:() => askName(L3('工具預設集名稱', '工具预设名称', 'Tool Preset Name'), t.name, n => CMD.run('ps.tool.presets.edit', {action:'rename', preset:t.name, name:n}))},
        {label:L3('刪除工具預設集', '删除工具预设', 'Delete Tool Preset'), act:'delete', run:() => runCmd('ps.tool.presets.edit', {action:'delete', preset:t.name})}]); };
      list.appendChild(r); });
    const ck = el('input', {type:'checkbox', dataset:{k:'curOnly'}, onchange:() => { PsWindow.curToolOnly = ck.checked; P.refresh('toolPresets'); }}); ck.checked = only;
    b.appendChild(el('div', {class:'bar', style:'align-items:center'}, [el('label', {class:'row', style:'margin:0;flex:1'}, [ck, el('span', {text:T(L3('僅限目前工具', '仅限当前工具', 'Current Tool Only')), style:'min-width:0'})]),
      btn('＋', L3('建立新的工具預設集', '创建新的工具预设', 'Create new tool preset'), () => { const x = runCmd('ps.tool.presets.new', {}); if (x && x.name) askName(L3('新增工具預設集', '新建工具预设', 'New Tool Preset'), x.name, n => CMD.run('ps.tool.presets.edit', {action:'rename', preset:x.name, name:n})); }, {dataset:{act:'new'}}),
      btn('🗑', L3('刪除工具預設集', '删除工具预设', 'Delete tool preset'), () => { if (PU.selected.toolPresets) runCmd('ps.tool.presets.edit', {action:'delete', preset:PU.selected.toolPresets}); }, {dataset:{act:'delete'}, disabled:!sel})]));
  }});
onUI(() => { if (UI.__psWinTP) return; UI.__psWinTP = true; ['pick', 'setTool'].forEach(k => { const f = UI[k]; if (typeof f !== 'function') return; UI[k] = function(){ const r = f.apply(this, arguments); if (P.isOpen('toolPresets') && PsWindow.curToolOnly) P.schedule('doc'); return r; }; }); });

/* ═══════════ 仿制源（preset_panels.rs:920-1036；接 tools/clone.js 的 clone.source*） ═══════════ */
P.define('cloneSource', {title:L3('仿製來源', '仿制源', 'Clone Source'), w:290,
  refresh(b){
    if (busy(b)) return;
    b.innerHTML = ''; const r = peek('clone.sourceList') || {sources:[], overlay:{}}, slots = r.sources || [], cur = r.active || 0, s = slots[cur] || {}, ov = r.overlay || {};
    const g = el('div', {class:'grid', style:'gap:4px'}); b.appendChild(g);
    for (let i = 0; i < 5; i++){ const q = slots[i] || {}, set = !!q.source;
      g.appendChild(btn('⎘' + (set ? '•' : ''), set ? {'zh-Hant':`仿製來源 ${i + 1}：${Math.round(q.source[0])}, ${Math.round(q.source[1])}`, 'zh-Hans':`仿制源 ${i + 1}：${Math.round(q.source[0])}, ${Math.round(q.source[1])}`, en:`Clone source ${i + 1}: ${Math.round(q.source[0])}, ${Math.round(q.source[1])}`}
        : L3(`仿製來源 ${i + 1}（用仿製印章 Alt+按一下設定）`, `仿制源 ${i + 1}（用仿制图章 Alt+单击设置）`, `Clone source ${i + 1} (Alt-click with Clone Stamp to set)`), () => runCmd('clone.sourceSelect', {index:i}), {class:cur === i ? 'on' : '', dataset:{slot:i}, style:'min-width:34px;height:28px'})); }
    const ln = s.source ? (s.layer && Doc.byId(s.layer) ? `${T(L3('來源', '源', 'Source'))}: ${T(L3('未命名', '未标题', 'Untitled'))} : ${Doc.byId(s.layer).name}` : `${T(L3('來源', '源', 'Source'))}: ${T(L3('已設定', '已设置', 'set'))}`)
      : T(L3('來源：未設定（用仿製印章工具 Alt+按一下）', '源：未设置（用仿制图章工具 Alt+单击）', 'Source: not set (Alt-click with Clone Stamp)'));
    b.appendChild(el('div', {class:'hint', dataset:{k:'srcLine'}, text:ln}));
    const off = s.offset || [0, 0];
    const fld = (k, v, min, max, unit, fn) => { const n = numIn(Math.round(v * 10) / 10, k, {min, max, step:'any', style:'width:64px'}); n.onchange = () => fn(+n.value); return [n, el('span', {text:unit, style:'min-width:14px'})]; };
    const [ox, oxu] = fld('offsetX', off[0], -30000, 30000, 'px', v => { if (s.source) runCmd('clone.sourceSet', {offset:[v, off[1]]}); }), [oy, oyu] = fld('offsetY', off[1], -30000, 30000, 'px', v => { if (s.source) runCmd('clone.sourceSet', {offset:[off[0], v]}); });
    ox.disabled = oy.disabled = !s.source;
    const [w, wu] = fld('width', s.width || 100, -1000, 1000, '%', v => runCmd('clone.sourceSet', {width:v})), [h, hu] = fld('height', s.height || 100, -1000, 1000, '%', v => runCmd('clone.sourceSet', {height:v}));
    const [a, au] = fld('rotation', s.rotation || 0, -180, 180, '°', v => runCmd('clone.sourceSet', {rotation:v}));
    b.appendChild(row('X:', ox, oxu, el('span', {text:'W:'}), w, wu)); b.appendChild(row('Y:', oy, oyu, el('span', {text:'H:'}), h, hu));
    b.appendChild(row('A:', a, au, btn('⇋', L3('水平翻轉', '水平翻转', 'Flip Horizontal'), () => runCmd('clone.sourceSet', {flipH:!s.flipH}), {class:s.flipH ? 'on' : '', dataset:{k:'flipH'}}),
      btn('⇵', L3('垂直翻轉', '垂直翻转', 'Flip Vertical'), () => runCmd('clone.sourceSet', {flipV:!s.flipV}), {class:s.flipV ? 'on' : '', dataset:{k:'flipV'}}),
      btn('⟲', L3('重設變形', '复位变换', 'Reset Transform'), () => runCmd('clone.sourceResetTransform', {}), {dataset:{k:'reset'}})));
    const setOv = q => { runCmd('clone.sourceOverlay', q); P.refresh('cloneSource'); };
    const ck = (k, label) => { const c = el('input', {type:'checkbox', dataset:{k}, onchange:() => setOv({[k]:c.checked})}); c.checked = !!ov[k]; return el('label', {class:'row', style:'margin:0 8px 0 0;cursor:pointer'}, [c, el('span', {text:T(label), style:'min-width:0'})]); };
    b.appendChild(el('div', {class:'sec', text:T(L3('覆蓋選項', '叠加选项', 'Overlay Options'))}));
    b.appendChild(ck('show', L3('顯示覆蓋', '显示叠加', 'Show Overlay')));
    const op = numIn(ov.opacity === undefined ? 100 : ov.opacity, 'ovOpacity', {min:0, max:100, style:'width:52px'}); op.onchange = () => setOv({opacity:clamp(+op.value, 0, 100)});
    b.appendChild(row(L3('不透明度：', '不透明度：', 'Opacity:'), op, el('span', {text:'%'}), selectOf([['normal', L3('正常', '正常', 'Normal')], ['darken', L3('變暗', '变暗', 'Darken')], ['lighten', L3('變亮', '变亮', 'Lighten')], ['difference', L3('差異化', '差值', 'Difference')]], ov.blend || 'normal', v => setOv({blend:v}), 'ovBlend')));
    b.appendChild(el('div', {class:'row'}, [ck('clipped', L3('剪裁', '已剪切', 'Clipped')), ck('autoHide', L3('自動隱藏', '自动隐藏', 'Auto Hide')), ck('invert', L3('負片效果', '反相', 'Invert'))]));
  }});
if (!CMD.__psWinCloneRefresh){ CMD.__psWinCloneRefresh = true; const r0 = CMD.run; CMD.run = function(id){ const o = r0.apply(this, arguments); if (/^clone\.source/.test(id) && P.isOpen('cloneSource')) P.schedule('doc'); return o; }; }

/* ═══════════ 注释（analysis_ui.rs:640-692 notes_panel ＋ engine/src/notes_cmds.rs）：
   文件资料 Doc.notes=[{author, text, color, position:[x,y], open, modified}]，每次改动一步历史、存进工程档。
   面板：作者、可编辑的内文、上一个／下一个、「n of m」、删除。原码有注释工具（点画布加一个）——我们工具栏没有 ⇒ 面板多一颗「📌 新增注释」：按下后在画布点一下放一个；
   画布上画注释图示，面板开着时点图示＝选它。 ═══════════ */
const NoteSt = PsWindow.notes = {sel:0, author:'', color:'#ffff82', placing:false};
const notes = () => Array.isArray(Doc.notes) ? Doc.notes : [];
const pdfDate = () => 'D:' + new Date().toISOString().slice(0, 19).replace(/\D/g, '') + 'Z';
const noteJson = (n, i) => ({index:i, author:n.author, text:n.text, color:n.color, position:n.position.slice(), open:n.open, modified:n.modified});
if (!History._psWinNotes){
  History._psWinNotes = true;
  const s0 = History.snap, r0 = History.restore, ri0 = History.restoreInPlace;
  const put = s => { if (s && 'psNotes' in s) Doc.notes = s.psNotes ? clone(s.psNotes) : undefined; };
  History.snap = function(){ const s = s0.apply(this, arguments); s.psNotes = Doc.notes && Doc.notes.length ? clone(Doc.notes) : null; return s; };
  History.restore = function(s){ const r = r0.apply(this, arguments); put(s); return r; };
  History.restoreInPlace = function(s){ const r = ri0.apply(this, arguments); put(s); return r; };
  if (Doc.reset){ const reset0 = Doc.reset; Doc.reset = function(){ this.notes = undefined; return reset0.apply(this, arguments); }; }
  if (window.Project && Project.serialize){
    const ser0 = Project.serialize; Project.serialize = function(){ const j = ser0.apply(this, arguments); if (j && Doc.notes && Doc.notes.length) j.notes = clone(Doc.notes); return j; };
    const load0 = Project.load; Project.load = async function(json){ const r = await load0.apply(this, arguments); Doc.notes = json && Array.isArray(json.notes) ? clone(json.notes) : undefined; return r; };
  }
  if (window.SiteHooks && Array.isArray(SiteHooks.extraSigs)) SiteHooks.extraSigs.push(() => 'notes:' + JSON.stringify(Doc.notes || []));
}
const noteIdx = (p, cmd) => { const n = notes().length, i = p.index; if (!Number.isInteger(i)) return {error:`${cmd}: pass \`index\``}; if (i < 0 || i >= n) return {error:`${cmd}: no note ${i} (the document has ${n})`}; return {i}; };
const noteColor = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : Array.isArray(v) ? rgbHex(...v.map(x => x <= 1 ? x * 255 : x)) : null;
CMD.reg('ps.notes.add', {i18n:'', undoable:true, params:'{x:px, y:px, text?="", author?="", color?:"#rrggbb"=淡黄, open?=true} 新建注释（notes.add）→ {ok, index, note}'}, p => {
  if (!isFinite(p.x) || !isFinite(p.y) || p.x === null || p.y === null) return fail('ps.notes.add: pass `x` and `y`');
  const n = {author:typeof p.author === 'string' ? p.author : NoteSt.author, text:typeof p.text === 'string' ? p.text : '', color:noteColor(p.color) || NoteSt.color, position:[+p.x, +p.y], open:p.open !== false, modified:pdfDate()};
  Doc.notes = notes().concat([n]); NoteSt.sel = Doc.notes.length - 1; return {ok:true, index:NoteSt.sel, note:noteJson(n, NoteSt.sel)};
});
CMD.reg('ps.notes.set', {i18n:'', undoable:true, params:'{index, text?, author?, color?, x?, y?, open?} 改注释（notes.set；内容改了才更新修改日期）→ {ok, index, note, changed}'}, p => {
  const r = noteIdx(p, 'ps.notes.set'); if (r.error) return fail(r.error);
  const L = clone(notes()), n = L[r.i], before = JSON.stringify(n);
  if (typeof p.text === 'string') n.text = p.text; if (typeof p.author === 'string') n.author = p.author; const c = noteColor(p.color); if (c) n.color = c; if (typeof p.open === 'boolean') n.open = p.open;
  if (typeof p.x === 'number') n.position[0] = p.x; if (typeof p.y === 'number') n.position[1] = p.y;
  const changed = JSON.stringify(n) !== before; if (changed && (n.text !== JSON.parse(before).text || n.author !== JSON.parse(before).author)) n.modified = pdfDate();
  if (changed) Doc.notes = L; return {ok:true, index:r.i, note:noteJson(n, r.i), changed};
});
CMD.reg('ps.notes.delete', {i18n:'', undoable:true, params:'{index} | {all:true} 删除注释 → {ok, deleted, remaining}'}, p => {
  if (p.all === true){ const n = notes().length; Doc.notes = undefined; NoteSt.sel = 0; return {ok:true, deleted:n, remaining:0}; }
  const r = noteIdx(p, 'ps.notes.delete'); if (r.error) return fail(r.error);
  const L = notes().slice(); L.splice(r.i, 1); Doc.notes = L.length ? L : undefined; NoteSt.sel = Math.max(0, Math.min(r.i, L.length - 1)); return {ok:true, deleted:1, remaining:L.length};
});
CMD.reg('ps.notes.list', {i18n:'', params:'{} → {ok, notes:[{index, author, text, color, position, open, modified}], selected}'}, () => ({ok:true, notes:notes().map(noteJson), selected:notes().length ? Math.min(NoteSt.sel, notes().length - 1) : null}));
CMD.reg('ps.notes.select', {i18n:'', params:'{index} 注释面板显示第几个（上一个／下一个）→ {ok, selected}'}, p => { const r = noteIdx(p, 'ps.notes.select'); if (r.error) return fail(r.error); NoteSt.sel = r.i; P.refresh('notes'); if (window.UI) UI.draw(); return {ok:true, selected:r.i}; });
CMD.reg('ps.notes.place', {i18n:'', params:'{on?:bool, author?, color?} 注释工具：开着时在画布上点一下＝在那里新建注释（我们的工具栏没有注释工具，由注释面板的 📌 开关）→ {ok, placing}'}, p => {
  NoteSt.placing = typeof p.on === 'boolean' ? p.on : !NoteSt.placing; if (typeof p.author === 'string') NoteSt.author = p.author; const c = noteColor(p.color); if (c) NoteSt.color = c;
  P.refresh('notes'); return {ok:true, placing:NoteSt.placing};
});
const NOTE_W = 16, NOTE_H = 20;
function noteAt(pt, s){ const L = notes(); for (let i = L.length - 1; i >= 0; i--){ const [x, y] = L[i].position; if (pt[0] >= x && pt[0] <= x + NOTE_W / s && pt[1] >= y && pt[1] <= y + NOTE_H / s) return i; } return -1; }
function canvasDocPt(e){ const c = window.UI && UI.canvas; if (!c) return null; const r = c.getBoundingClientRect(); if (!r.width || !r.height) return null;
  const p = [(e.clientX - r.left) / r.width * Doc.width, (e.clientY - r.top) / r.height * Doc.height]; return p[0] >= 0 && p[1] >= 0 && p[0] <= Doc.width && p[1] <= Doc.height ? p : null; }
if (!window.__psWinNotesPtr){ window.__psWinNotesPtr = true;
  window.addEventListener('pointerdown', e => {
    if (window.ToolState && ToolState.cur === 'note'){ if (NoteSt.placing && window.UI && e.target === UI.canvas) NoteSt.placing = false; return; }   // 手上是注释工具 ⇒ 让 tools/note.js 自己接（拖得动）
    if (e.button !== 0 || !window.UI || !UI.canvas || !(NoteSt.placing || (P.isOpen('notes') && notes().length))) return;
    const wrap = document.getElementById('canvasWrap'); if (wrap && !wrap.contains(e.target)) return;
    const pt = canvasDocPt(e); if (!pt) return;
    const s = UI.canvas.getBoundingClientRect().width / Doc.width;
    if (NoteSt.placing){ e.preventDefault(); e.stopPropagation(); runCmd('ps.notes.add', {x:Math.round(pt[0]), y:Math.round(pt[1])}); NoteSt.placing = false; if (!P.isOpen('notes')) P.open('notes'); P.refresh('notes'); return; }
    const i = noteAt(pt, s); if (i >= 0){ e.preventDefault(); e.stopPropagation(); runCmd('ps.notes.select', {index:i}); }
  }, true); }
onUI(() => { if (!Array.isArray(UI.overlays) || UI.__psWinNoteOv) return; UI.__psWinNoteOv = true; UI.overlays.push((ctx, s) => {
  const L = notes(); if (!L.length) return; const d = Math.min(window.devicePixelRatio || 1, 2);
  L.forEach((n, i) => { const x = n.position[0] * s, y = n.position[1] * s, w = NOTE_W * d, h = NOTE_H * d;
    ctx.save(); ctx.fillStyle = n.color || '#ffff82'; ctx.strokeStyle = i === NoteSt.sel && P.isOpen('notes') ? '#2f7fd8' : '#000a'; ctx.lineWidth = i === NoteSt.sel && P.isOpen('notes') ? 2 * d : d;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w - 5 * d, y); ctx.lineTo(x + w, y + 5 * d); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#0006'; ctx.lineWidth = d; for (let k = 1; k <= 3; k++){ ctx.beginPath(); ctx.moveTo(x + 3 * d, y + (4 + k * 3.5) * d); ctx.lineTo(x + w - 3 * d, y + (4 + k * 3.5) * d); ctx.stroke(); }
    ctx.restore(); }); }); });
P.define('notes', {title:L3('備忘稿', '注释', 'Notes'), w:270,
  refresh(b){
    if (busy(b)) return;
    b.innerHTML = ''; const L = notes(), n = L.length; if (NoteSt.sel >= n) NoteSt.sel = Math.max(0, n - 1); const i = NoteSt.sel;
    if (!n) b.appendChild(el('div', {class:'hint', text:T(L3('用備忘稿工具按一下以新增備忘稿。', '用注释工具单击以添加注释。', 'Click with the Note tool to add a note.'))}));
    else {
      const note = L[i];
      b.appendChild(el('div', {class:'hint', dataset:{k:'author'}, text:note.author || T(L3('沒有作者', '没有作者', 'No author'))}));
      const ta = el('textarea', {rows:6, dataset:{k:'text'}, style:'width:100%;resize:vertical', onchange:() => runCmd('ps.notes.set', {index:i, text:ta.value})}); ta.value = note.text;
      b.appendChild(ta);
    }
    b.appendChild(el('div', {class:'bar', style:'align-items:center;justify-content:flex-start'}, [
      btn('«', L3('上一個備忘稿', '上一个注释', 'Previous note'), () => runCmd('ps.notes.select', {index:(i + n - 1) % n}), {disabled:n < 2, dataset:{a:'prev'}}),
      btn('»', L3('下一個備忘稿', '下一个注释', 'Next note'), () => runCmd('ps.notes.select', {index:(i + 1) % n}), {disabled:n < 2, dataset:{a:'next'}}),
      el('span', {class:'hint', dataset:{k:'count'}, text:n ? `${i + 1} / ${n}` : '0 / 0', style:'margin:0 6px'}), el('span', {style:'flex:1'}),
      btn('🗑', L3('刪除備忘稿', '删除注释', 'Delete note'), () => runCmd('ps.notes.delete', {index:i}), {disabled:!n, dataset:{a:'del'}})]));
    // 注释工具的选项（作者、颜色）＋放一个
    const au = el('input', {type:'text', value:NoteSt.author, dataset:{k:'newAuthor'}, placeholder:T(L3('作者', '作者', 'Author')), style:'width:90px', onchange:() => { NoteSt.author = au.value; }});
    const co = el('input', {type:'color', value:NoteSt.color, dataset:{k:'newColor'}, onchange:() => { NoteSt.color = co.value; }});
    b.appendChild(el('div', {class:'sec', text:T(L3('備忘稿工具', '注释工具', 'Note Tool'))}));
    b.appendChild(row(null, au, co, btn('📌 ' + T(L3('新增備忘稿', '新建注释', 'New Note')), L3('按下後在畫布上按一下放一個備忘稿', '按下后在画布上单击放一个注释', 'Then click on the canvas to place a note'), () => runCmd('ps.notes.place', {}), {class:NoteSt.placing ? 'on' : '', dataset:{a:'place'}})));
  }});

/* ═══════════ 测量记录（analysis_ui.rs:549-631）：记录测量、全选、取消全选、导出选中的（CSV）、删除选中的；表格每列点标签那格＝选／取消
   资料在 menus/impl/ps-image.js（ps.measurementLog.*、ps.image.analysis.recordMeasurements）。 ═══════════ */
const MLOG_COLS = {label:L3('標籤', '标签', 'Label'), dateTime:L3('日期與時間', '日期和时间', 'Date and Time'), document:L3('文件', '文档', 'Document'), source:L3('來源', '源', 'Source'), scale:L3('比例', '比例', 'Scale'),
  scaleUnits:L3('比例單位', '比例单位', 'Scale Units'), scaleFactor:L3('比例因數', '比例因子', 'Scale Factor'), count:L3('計數', '计数', 'Count'), area:L3('面積', '面积', 'Area'), perimeter:L3('周長', '周长', 'Perimeter'),
  circularity:L3('圓度', '圆度', 'Circularity'), height:L3('高度', '高度', 'Height'), width:L3('寬度', '宽度', 'Width'), grayMin:L3('灰階值（最小）', '灰度值（最小值）', 'Gray Value (Minimum)'),
  grayMax:L3('灰階值（最大）', '灰度值（最大值）', 'Gray Value (Maximum)'), grayMean:L3('灰階值（平均）', '灰度值（平均值）', 'Gray Value (Mean)'), grayMedian:L3('灰階值（中間值）', '灰度值（中间值）', 'Gray Value (Median)'),
  integratedDensity:L3('積分密度', '积分密度', 'Integrated Density'), length:L3('長度', '长度', 'Length'), angle:L3('角度', '角度', 'Angle')};
const MLog = PsWindow.measurementLog = {sel:[]};
CMD.reg('ps.measurementLog.select', {i18n:'', params:'{rows?:[id…], all?:bool, none?:bool, toggle?:id} 测量记录面板的选取（全选／取消全选／点一列）→ {ok, selected}'}, p => {
  const ids = ((peek('ps.measurementLog.list') || {}).rows || []).map(r => r.id);
  if (p.all) MLog.sel = ids.slice(); else if (p.none) MLog.sel = []; else if (Array.isArray(p.rows)) MLog.sel = p.rows.filter(x => ids.includes(x));
  else if (p.toggle !== undefined){ MLog.sel = MLog.sel.includes(p.toggle) ? MLog.sel.filter(x => x !== p.toggle) : MLog.sel.concat([p.toggle]); }
  MLog.sel = MLog.sel.filter(x => ids.includes(x)); P.refresh('measurementLog'); return {ok:true, selected:MLog.sel.slice()};
});
P.define('measurementLog', {title:L3('測量記錄', '测量记录', 'Measurement Log'), w:620, h:300,
  refresh(b){
    b.innerHTML = ''; const lg = peek('ps.measurementLog.list'), rows = (lg && lg.rows) || [], cols = ((lg && lg.columns) || []).filter(c => c !== 'histogram');
    MLog.sel = MLog.sel.filter(id => rows.some(r => r.id === id));
    const can = !!lg;
    b.appendChild(el('div', {class:'bar', style:'justify-content:flex-start;align-items:center;margin:0 0 6px'}, [
      btn(T(L3('記錄測量', '记录测量', 'Record Measurements')), null, () => runCmd('ps.image.analysis.recordMeasurements', {}), {disabled:!has('ps.image.analysis.recordMeasurements'), dataset:{a:'record'}}),
      btn(T(L3('全選', '全选', 'Select All')), null, () => runCmd('ps.measurementLog.select', {all:true}), {disabled:!rows.length, dataset:{a:'all'}}),
      btn(T(L3('全部取消選取', '取消全选', 'Deselect All')), null, () => runCmd('ps.measurementLog.select', {none:true}), {disabled:!MLog.sel.length, dataset:{a:'none'}}),
      el('span', {style:'flex:1'}),
      btn('⇩', L3('轉存選取的測量（CSV）', '导出所选测量（CSV）', 'Export selected measurements (CSV)'), () => runCmd('ps.measurementLog.export', Object.assign({download:true}, MLog.sel.length ? {rows:MLog.sel.slice()} : {})), {disabled:!can || !rows.length, dataset:{a:'export'}}),
      btn('🗑', L3('刪除選取的測量', '删除所选测量', 'Delete selected measurements'), () => { const r = runCmd('ps.measurementLog.delete', {rows:MLog.sel.slice()}); if (r && r.ok !== false) MLog.sel = []; P.refresh('measurementLog'); }, {disabled:!MLog.sel.length, dataset:{a:'del'}})]));
    if (!can){ b.appendChild(el('div', {class:'hint', text:T(L3('未做：沒有測量記錄命令（ps-image.js 未載入）', '未做：没有测量记录命令（ps-image.js 未载入）', 'Not done: no measurement log commands (ps-image.js not loaded)'))})); return; }
    if (!rows.length){ b.appendChild(el('div', {class:'hint', text:T(L3('用選取範圍、尺標或計數工具量好之後按「記錄測量」。', '用选区、标尺或计数工具量好之后按「记录测量」。', 'Measure with a selection, the Ruler or the Count tool, then press Record Measurements.'))})); return; }
    const tb = el('table', {class:'mlog', style:'border-collapse:collapse;font-size:11px;white-space:nowrap'});
    tb.appendChild(el('tr', {}, cols.map(c => el('th', {text:T(MLOG_COLS[c] || L3(c, c, c)), style:'text-align:left;padding:2px 8px;color:#9a9a9a;font-weight:600'}))));
    rows.forEach(r => { const on = MLog.sel.includes(r.id);
      tb.appendChild(el('tr', {dataset:{row:r.id}, style:on ? 'background:var(--accent,#2f7fd8);color:#fff' : ''}, cols.map((c, k) => { const v = r.values[c], s = v === undefined || v === null ? '' : Array.isArray(v) ? v.join(' ') : String(v);
        return el('td', k === 0 ? {text:s, style:'padding:2px 8px;cursor:pointer;text-decoration:underline dotted', onclick:() => runCmd('ps.measurementLog.select', {toggle:r.id})} : {text:s, style:'padding:2px 8px'}); }))); });
    b.appendChild(el('div', {style:'overflow:auto;max-height:220px'}, [tb]));
  }});
if (!CMD.__psWinMlogRefresh){ CMD.__psWinMlogRefresh = true; const r0 = CMD.run; CMD.run = function(id){ const o = r0.apply(this, arguments); if (/^ps\.(measurementLog\.|image\.analysis\.recordMeasurements)/.test(id) && P.isOpen('measurementLog')) P.schedule('doc'); return o; }; }

/* ═══════════ 时间轴（timeline_ui.rs:43-149）：建立视频时间轴（30 帧 @ 30 fps）／播放暂停、上一帧、下一帧、「帧 x / n」、秒数、fps、删除时间轴、播放头滑杆；
   命令在 menus/impl/ps-layer2.js（ps.timeline.*）；播放＝按 fps 一帧一帧往前（循环），面板关掉就停 ═══════════ */
const TL = PsWindow.timeline = {playing:false, timer:null};
function tlStop(){ TL.playing = false; if (TL.timer){ clearInterval(TL.timer); TL.timer = null; } }
CMD.reg('ps.timeline.playback', {i18n:'', params:'{on?:bool（缺省＝切换）} 时间轴面板 ▶／⏸：按 fps 自动往前播（到尾巴回第一帧）→ {ok, playing}'}, p => {
  const t = Doc.timeline; if (!t) return fail('no timeline (create one first)');
  const want = typeof p.on === 'boolean' ? p.on : !TL.playing; tlStop();
  if (want){ TL.playing = true; TL.timer = setInterval(() => { const t2 = Doc.timeline; if (!t2 || !TL.playing){ tlStop(); P.refresh('timeline'); return; }
    CMD.run('ps.timeline.setFrame', {frame:(t2.current + 1) % Math.max(1, t2.duration)}); }, 1000 / Math.max(1, t.fps || 30)); }
  P.refresh('timeline'); return {ok:true, playing:TL.playing};
});
P.define('timeline', {title:L3('時間軸', '时间轴', 'Timeline'), w:660,
  refresh(b){
    const t = Doc.timeline, sig = t ? [t.duration, t.fps, TL.playing, window.Lang && Lang.cur].join('|') : 'none';
    if (t && b.dataset.sig === sig){                    // 播放中每帧只改读数（整块重画会让按钮一直被换掉、点不到）
      const f = b.querySelector('[data-k="frame"]'), tm = b.querySelector('[data-k="time"]'), sc = b.querySelector('[data-k="playhead"]');
      if (f) f.textContent = `${T(L3('影格', '帧', 'Frame'))} ${t.current + 1} / ${t.duration}`; if (tm) tm.textContent = (t.current / (t.fps || 30)).toFixed(2) + 's';
      if (sc && P.activeEl(sc) !== sc) sc.value = t.current; return;
    }
    b.innerHTML = ''; b.dataset.sig = sig;
    if (!has('ps.timeline.create')){ b.appendChild(el('div', {class:'hint', text:T(L3('未做：沒有時間軸命令（ps-layer2.js 未載入）', '未做：没有时间轴命令（ps-layer2.js 未载入）', 'Not done: no timeline commands (ps-layer2.js not loaded)'))})); return; }
    if (!t){ if (TL.playing) tlStop();
      b.appendChild(el('div', {class:'bar', style:'justify-content:center'}, [btn(T(L3('建立視訊時間軸', '创建视频时间轴', 'Create Video Timeline')), null, () => runCmd('ps.timeline.create', {duration:30, fps:30}), {dataset:{a:'create'}, style:'padding:4px 18px'})]));
      b.appendChild(el('div', {class:'hint', style:'text-align:center', text:T(L3('30 影格 @ 30 fps', '30 帧 @ 30 fps', '30 frames @ 30 fps'))})); return; }
    b.appendChild(el('div', {class:'bar', style:'justify-content:flex-start;align-items:center'}, [
      btn(TL.playing ? '⏸' : '▶', TL.playing ? L3('暫停', '暂停', 'Pause') : L3('播放', '播放', 'Play'), () => runCmd('ps.timeline.playback', {}), {class:TL.playing ? 'on' : '', dataset:{a:'play'}}),
      btn('◀', L3('上一個影格', '上一帧', 'Previous frame'), () => runCmd('ps.timeline.previousFrame', {}), {dataset:{a:'prev'}}),
      el('span', {dataset:{k:'frame'}, style:'font-family:monospace', text:`${T(L3('影格', '帧', 'Frame'))} ${t.current + 1} / ${t.duration}`}),
      btn('▶|', L3('下一個影格', '下一帧', 'Next frame'), () => runCmd('ps.timeline.nextFrame', {}), {dataset:{a:'next'}}),
      el('span', {class:'hint', dataset:{k:'time'}, style:'margin:0 8px;font-family:monospace', text:(t.current / (t.fps || 30)).toFixed(2) + 's'}), el('span', {style:'flex:1'}),
      el('span', {class:'hint', style:'margin:0 6px', text:Math.round(t.fps) + ' fps'}),
      btn('🗑', L3('刪除時間軸', '删除时间轴', 'Delete Timeline'), () => { tlStop(); runCmd('ps.timeline.delete', {}); }, {dataset:{a:'del'}})]));
    if (t.duration > 1){ const sc = el('input', {type:'range', min:0, max:t.duration - 1, step:1, value:t.current, dataset:{k:'playhead'}, style:'width:100%', oninput:() => runCmd('ps.timeline.setFrame', {frame:+sc.value})}); b.appendChild(sc); }
  },
  onClose(){ tlStop(); }});
if (!CMD.__psWinTlRefresh){ CMD.__psWinTlRefresh = true; const r0 = CMD.run; CMD.run = function(id){ const o = r0.apply(this, arguments); if (/^ps\.timeline\./.test(id) && P.isOpen('timeline')) P.schedule('doc'); return o; }; }

/* ═══════════ 修改键（workspace_ui.rs:291-310：Shift／Ctrl／Alt 黏住，OR 进真的按键） ═══════════ */
const Sticky = PsWindow.sticky = {shift:false, ctrl:false, alt:false};
CMD.reg('ps.window.panel.modifierKeys', {i18n:'', params:'{show?:bool, shift?, command?, alt?:bool} 窗口 ▸ 修改键：面板开关＋三个黏住的键（触控／手写笔用：黏住的键会加进每一下画布滑鼠事件）→ {ok, visible, shift, command, alt}'}, p => {
  ['shift', 'alt'].forEach(k => { if (typeof p[k] === 'boolean') Sticky[k] = p[k]; }); if (typeof p.command === 'boolean') Sticky.ctrl = p.command;
  const vis = P.toggle('modifierKeys', typeof p.show === 'boolean' ? p.show : (p.shift === undefined && p.command === undefined && p.alt === undefined ? undefined : true));
  return {ok:true, visible:vis, shift:Sticky.shift, command:Sticky.ctrl, alt:Sticky.alt};
});
P.define('modifierKeys', {title:L3('輔助按鍵', '修改键', 'Modifier Keys'), w:170,
  refresh(b){ b.innerHTML = ''; const g = el('div', {class:'grid'});
    [['shift', 'Shift'], ['ctrl', 'Ctrl'], ['alt', 'Alt']].forEach(([k, n]) => g.appendChild(btn(n, null, () => { Sticky[k] = !Sticky[k]; P.refresh('modifierKeys'); }, {class:Sticky[k] ? 'on' : '', dataset:{k}, style:'min-width:40px;height:30px;font-size:14px'})));
    b.appendChild(g); },
  onClose(){ Sticky.shift = Sticky.ctrl = Sticky.alt = false; }});
if (window.Pointer && !Pointer.__psSticky){
  Pointer.__psSticky = true;
  ['onDown', 'onMove', 'onUp', 'onDblClick'].forEach(k => { const o = Pointer[k]; Pointer[k] = function(e, pt){
    if (e && (Sticky.shift || Sticky.ctrl || Sticky.alt) && P.isOpen('modifierKeys')){
      e = new Proxy(e, {get:(t, n) => n === 'shiftKey' ? t.shiftKey || Sticky.shift : n === 'ctrlKey' ? t.ctrlKey || Sticky.ctrl : n === 'altKey' ? t.altKey || Sticky.alt : (typeof t[n] === 'function' ? t[n].bind(t) : t[n])});
    }
    return o.call(this, e, pt); }; });
}

/* ═══════════ 画笔设置／画笔（brush_panel.rs:32-381、brush_sections.rs、brushes_tab.rs、paint/src/presets.rs）
   「画笔设置」页：左边十三节清单（有勾选框的节＝启用；点名字＝显示并启用那节）、右边那节的控件、底下笔触预览（用真的笔刷引擎画）、
   「用这些设定新建画笔」「笔刷回预设」。所有改动都走 brush.set（agent 同一条路）。
   笔尖形状一节上面是笔尖挑选格（圆笔尖＋取样笔尖：内建、定义画笔预设、读入 .abr 的；tools/brush.js BrushTips）；纹理、双重画笔两节接 tools/brush.js；
   保护纹理照摆、灰掉（引擎没有）；节旁的锁（换预设时保留该节）我们引擎没有 ⇒ 不摆。手上是混合器画笔时双重画笔灰掉（混合器引擎没接）。
   「画笔」页：内建预设（照 presets.rs 抄圆笔尖的那些）＋自己存的（localStorage dlPsBrushSettingsPresets.v1）＋取样笔尖（点一下＝换成那支笔尖）＋「读入画笔…」（.abr）；
   搜寻框、点一下＝套用（保留目前的平滑设定，照 brush_panel.rs:190 is_current 的说明）、右键改名／删除（自己存的）。 ═══════════ */
const BrushUI = {tab:0, section:0, filter:''};
const SECTIONS = [['tip', L3('筆尖形狀', '画笔笔尖形状', 'Brush Tip Shape'), null], ['shapeDynamics', L3('形狀動態', '形状动态', 'Shape Dynamics'), 'shapeDynamics.enabled'],
  ['scattering', L3('散佈', '散布', 'Scattering'), 'scattering.enabled'], ['texture', L3('紋理', '纹理', 'Texture'), 'texture.enabled'], ['dualBrush', L3('雙筆刷', '双重画笔', 'Dual Brush'), 'dualBrush.enabled'],
  ['colorDynamics', L3('顏色動態', '颜色动态', 'Color Dynamics'), 'colorDynamics.enabled'], ['transfer', L3('轉換', '传递', 'Transfer'), 'transfer.enabled'], ['pose', L3('筆刷姿勢', '画笔笔势', 'Brush Pose'), 'pose.enabled'],
  ['noise', L3('雜訊', '杂色', 'Noise'), 'noise'], ['wetEdges', L3('濕邊', '湿边', 'Wet Edges'), 'wetEdges'], ['buildUp', L3('建立', '建立', 'Build-up'), 'buildUp'], ['smoothing', L3('平滑化', '平滑', 'Smoothing'), null],
  ['protectTexture', L3('保護紋理', '保护纹理', 'Protect Texture'), false]];
const CONTROLS = [['off', L3('關', '关', 'Off')], ['fade', L3('漸淡', '渐隐', 'Fade')], ['penPressure', L3('筆的壓力', '钢笔压力', 'Pen Pressure')], ['penTilt', L3('筆的傾斜', '钢笔斜度', 'Pen Tilt')],
  ['stylusWheel', L3('光筆滾輪', '光笔轮', 'Stylus Wheel')], ['rotation', L3('旋轉', '旋转', 'Rotation')], ['initialDirection', L3('起始方向', '初始方向', 'Initial Direction')], ['direction', L3('方向', '方向', 'Direction')]];
const getPath = (o, path) => path.split('.').reduce((a, k) => a == null ? a : a[k], o);
const patchOf = (path, v) => { const ks = path.split('.'), out = {}; let c = out; ks.forEach((k, i) => { if (i === ks.length - 1) c[k] = v; else c = c[k] = {}; }); return out; };
/* PS：每颗绘画工具各记一份笔尖 ⇒ 画笔设置／画笔面板改的是「手上那颗」的：手上是混合器画笔＝mixer.brush.set／get（tools/mixer.js），其余＝brush.set／get */
const mixerHand = () => !!(window.ToolState && ToolState.cur === 'mixer' && CMD.map['mixer.brush.set']);
const BCMD = k => (mixerHand() ? 'mixer.brush.' : 'brush.') + k;
/* 节旗标：双重画笔只有画笔工具的引擎做了（混合器画笔没接）⇒ 手上是混合器时灰掉 */
const secFlag = i => SECTIONS[i][0] === 'dualBrush' && mixerHand() ? false : SECTIONS[i][2];
const bset = (path, v) => runCmd(BCMD('set'), patchOf(path, v));
CMD.reg('ps.brush.section', {i18n:'', params:'{section:"tip|shapeDynamics|scattering|texture|dualBrush|colorDynamics|transfer|pose|noise|wetEdges|buildUp|smoothing|protectTexture", enable?:bool} 画笔设置：显示那一节（点节名＝显示并启用，照 brush_panel.rs:257；enable:false＝只显示）→ {ok, section, enabled}'}, p => {
  const i = SECTIONS.findIndex(s => s[0] === p.section); if (i < 0) return fail('ps.brush.section: unknown section');
  BrushUI.section = i; const f = secFlag(i); let on = null;
  if (typeof f === 'string'){ if (p.enable !== false) bset(f, true); on = !!getPath(peek(BCMD('get')) || {}, f); }
  BrushUI.tab = 0; P.refresh('brushSettings'); return {ok:true, section:p.section, enabled:on};
});
function brushPreview(b, W, H){
  const cv = el('canvas', {class:'bprev', width:W, height:H, style:`width:100%;height:${H}px;background:#1e1e1e;border-radius:3px;display:block`});
  try {
    const BT = window.Tools && Tools.get && Tools.get('brush'), E = BT && BT._engine; if (!E || !BT.current) return cv;
    const br = mixerHand() && window.MixerBrush && MixerBrush.fullBrush ? MixerBrush.fullBrush() : BT.current(), x = cv.getContext('2d');
    br.color = hexRgb(fg()).map(v => v / 255).concat([1]); br.erase = false; br._seed = BigInt(7); br.size = Math.min(br.size, H * 0.8);
    const pts = []; for (let i = 0; i <= 60; i++){ const t = i / 60; pts.push([12 + t * (W - 24), H / 2 + Math.sin(t * Math.PI * 2) * H * 0.22, Math.sin(t * Math.PI) * 0.9 + 0.1]); }
    const parsed = E.parsePoints(pts); if (parsed.error) return cv;
    const ren = new E.StrokeRenderer(br, W, H, 1, 0, 0); ren.push(parsed.pts); ren.finish();
    if (ren.bounds) ren.composite(x, x.getImageData(0, 0, W, H), ren.bounds, ren.main, null);
  } catch(e){ console.warn("[ps-window] brush preview", e); }   /* 预览画不出来就留空（笔刷引擎换了内部结构） */
  return cv;
}
function brushSectionBody(b, g, i){
  const id = SECTIONS[i][0], add = n => b.appendChild(n);
  const pct = (label, path, max, min) => { max = max || 1; min = min || 0; const v = Math.round((getPath(g, path) || 0) * 100), r = el('input', {type:'range', min:min * 100, max:max * 100, step:1, value:v, dataset:{bk:path}}), n = el('span', {text:v + '%', style:'min-width:40px;text-align:right'});
    r.oninput = () => { n.textContent = r.value + '%'; }; r.onchange = () => bset(path, +r.value / 100); return row(label, r, n); };
  const num = (label, path, min, max, unit) => { const v = Math.round(getPath(g, path) || 0), r = el('input', {type:'range', min, max, step:1, value:v, dataset:{bk:path}}), n = el('span', {text:v + (unit || ''), style:'min-width:40px;text-align:right'});
    r.oninput = () => { n.textContent = r.value + (unit || ''); }; r.onchange = () => bset(path, +r.value); return row(label, r, n); };
  const chk = (label, path) => { const c = el('input', {type:'checkbox', dataset:{bk:path}, onchange:() => bset(path, c.checked)}); c.checked = !!getPath(g, path); return el('label', {class:'row', style:'cursor:pointer;margin:2px 10px 2px 0'}, [c, el('span', {text:T(label), style:'min-width:0'})]); };
  const control = (path, angle) => { const d = getPath(g, path) || {}, n = angle || ['initialDirection', 'direction'].includes(d.control) ? 8 : 6;
    const s = selectOf(CONTROLS.slice(0, n), d.control || 'off', v => bset(path + '.control', v), path + '.control');
    const fs = d.control === 'fade' ? numIn(d.fadeSteps || 25, path + '.fadeSteps', {min:1, max:9999, style:'width:56px', title:T(L3('漸淡步驟', '渐隐步长', 'Fade steps'))}) : null; if (fs) fs.onchange = () => bset(path + '.fadeSteps', clamp(Math.round(+fs.value), 1, 9999));
    return row(L3('控制：', '控制：', 'Control:'), s, fs); };
  const dyn = (label, path, max, minLabel, angle) => { add(pct(label, path + '.jitter', max)); add(control(path, angle)); if (minLabel) add(pct(minLabel, path + '.minimum', 1)); };
  const note = t => add(el('div', {class:'hint', text:T(t)}));
  if (id === 'tip'){
    // 笔尖挑选格（PS 画笔笔尖形状上面那格）：第一格＝圆笔尖，其余＝取样笔尖（内建、定义画笔预设、读入 .abr）；点一下＝换笔尖（大小回笔尖原大小）
    if (window.BrushTips && !mixerHand()){
      const grid = el('div', {dataset:{k:'tipGrid'}, style:'display:flex;flex-wrap:wrap;gap:3px;max-height:124px;overflow:auto;margin-bottom:6px;padding:3px;background:#1e1e1e;border-radius:3px'});
      const cell = (key, title, draw) => { const c = el('div', {dataset:{tip:key}, title, style:`width:38px;height:38px;flex:0 0 38px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:3px;border:1px solid ${(g.tip || '') === key ? '#2f7fd8' : 'transparent'};background:${(g.tip || '') === key ? '#2b3a4d' : 'transparent'}`,
        onclick:() => runCmd('brush.tips.select', {tip:key})}); c.appendChild(draw()); grid.appendChild(c); };
      cell('', T(L3('圓形筆尖', '圆形笔尖', 'Round tip')), () => el('span', {style:`display:inline-block;width:24px;height:24px;border-radius:50%;background:radial-gradient(circle, #ddd ${Math.round((g.hardness === undefined ? 1 : g.hardness) * 60)}%, transparent 72%)`}));
      BrushTips.list().forEach(t => cell(t.id, `${t.name} (${t.width}×${t.height})`, () => { const c = BrushTips.thumb(t, 32); c.style.cssText = 'width:32px;height:32px'; return c; }));
      add(grid);
      add(el('div', {class:'row', style:'gap:4px;margin-bottom:4px'}, [btn(T(L3('讀入筆刷…', '导入画笔…', 'Import Brushes…')), L3('讀入 Photoshop 筆刷檔（.abr）', '导入 Photoshop 画笔文件（.abr）', 'Import a Photoshop brush file (.abr)'), () => pickAbr(), {dataset:{act:'importAbr'}}),
        btn(T(L3('定義筆刷…', '定义画笔…', 'Define Brush…')), L3('用目前選取範圍（沒選取＝整個圖層）定義取樣筆尖', '用当前选区（没选区＝整个图层）定义取样笔尖', 'Define a sampled tip from the selection (or the whole layer)'), () => runCmd('ps.edit.defineBrushPreset', {dialog:true}), {dataset:{act:'defineTip'}})]));
    } else if (mixerHand()) note(L3('混合器筆刷只有圓形筆尖（取樣筆尖只接了筆刷工具）。', '混合器画笔只有圆形笔尖（取样笔尖只接了画笔工具）。', 'The Mixer Brush only has the round tip (sampled tips are wired to the Brush tool).'));
    const sz = Math.round(g.size || 1), r = el('input', {type:'range', min:0, max:Math.log(5000), step:0.01, value:Math.log(Math.max(1, sz)), dataset:{bk:'size'}}), n = numIn(sz, 'sizeNum', {min:1, max:5000, style:'width:64px'});
    r.oninput = () => { n.value = Math.round(Math.exp(+r.value)); }; r.onchange = () => runCmd(BCMD('set'), {size:Math.round(Math.exp(+r.value))}); n.onchange = () => runCmd(BCMD('set'), {size:clamp(Math.round(+n.value), 1, 5000)});
    add(row(L3('尺寸', '大小', 'Size'), r, n, el('span', {text:'px'})));
    add(el('div', {class:'row'}, [chk(L3('翻轉 X', '翻转 X', 'Flip X'), 'flipX'), chk(L3('翻轉 Y', '翻转 Y', 'Flip Y'), 'flipY')]));
    // 角度／圆度小图（brush_sections.rs:160 ellipse_widget）：拖箭头＝角度、拖点＝圆度
    const ew = el('canvas', {width:76, height:76, dataset:{k:'ellipse'}, style:'width:76px;height:76px;cursor:crosshair;flex:0 0 76px'});
    const drawE = (a, ro) => { const x = ew.getContext('2d'); x.clearRect(0, 0, 76, 76); x.save(); x.translate(38, 38); x.rotate(-a * Math.PI / 180); x.strokeStyle = '#ccc'; x.lineWidth = 1.5; x.beginPath(); x.ellipse(0, 0, 32, Math.max(1, 32 * ro), 0, 0, Math.PI * 2); x.stroke();
      x.beginPath(); x.moveTo(-34, 0); x.lineTo(34, 0); x.stroke(); x.fillStyle = '#ccc'; x.beginPath(); x.moveTo(36, 0); x.lineTo(30, -4); x.lineTo(30, 4); x.fill();
      x.fillStyle = '#2f7fd8'; [-1, 1].forEach(sg => { x.beginPath(); x.arc(0, sg * 32 * ro, 3.5, 0, 7); x.fill(); }); x.restore(); };
    drawE(g.angle || 0, g.roundness === undefined ? 1 : g.roundness);
    ew.addEventListener('pointerdown', e => {
      const rc = ew.getBoundingClientRect(), rel = ev => [ev.clientX - rc.left - 38, ev.clientY - rc.top - 38];
      const a0 = (g.angle || 0) * Math.PI / 180, [ux, uy] = rel(e), along = Math.abs(ux * Math.cos(a0) - uy * Math.sin(a0)), across = Math.abs(ux * Math.sin(a0) + uy * Math.cos(a0));
      const grab = across > along * 0.8 && Math.hypot(ux, uy) < 30 ? 'round' : 'angle'; let cur = {angle:g.angle || 0, roundness:g.roundness === undefined ? 1 : g.roundness};
      ew.setPointerCapture(e.pointerId);
      const mv = ev => { const [x, y] = rel(ev);
        if (grab === 'angle'){ if (Math.hypot(x, y) > 2) cur.angle = Math.round(Math.atan2(-y, x) * 180 / Math.PI); }
        else { const a = cur.angle * Math.PI / 180; cur.roundness = clamp(Math.abs(x * Math.sin(a) + y * Math.cos(a)) / 32, 0.01, 1); }
        drawE(cur.angle, cur.roundness); };
      const up = () => { ew.removeEventListener('pointermove', mv); ew.removeEventListener('pointerup', up); runCmd(BCMD('set'), {angle:cur.angle, roundness:Math.round(cur.roundness * 100) / 100}); };
      mv(e); ew.addEventListener('pointermove', mv); ew.addEventListener('pointerup', up);
    });
    const an = numIn(Math.round(g.angle || 0), 'angle', {min:-180, max:180, style:'width:58px'}), ro = numIn(Math.round((g.roundness === undefined ? 1 : g.roundness) * 100), 'roundness', {min:1, max:100, style:'width:58px'});
    an.onchange = () => runCmd(BCMD('set'), {angle:clamp(Math.round(+an.value), -180, 180)}); ro.onchange = () => runCmd(BCMD('set'), {roundness:clamp(Math.round(+ro.value), 1, 100) / 100});
    add(el('div', {class:'row', style:'align-items:center'}, [ew, el('div', {}, [row(L3('角度：', '角度：', 'Angle:'), an, el('span', {text:'°'})), row(L3('圓度：', '圆度：', 'Roundness:'), ro, el('span', {text:'%'}))])]));
    const hd = pct(L3('硬度', '硬度', 'Hardness'), 'hardness', 1); if (g.tip){ hd.style.opacity = .4; hd.querySelector('input').disabled = true; } add(hd);   // 取样笔尖没有硬度（PS 同样灰掉）
    add(chk(L3('間距', '间距', 'Spacing'), 'spacingEnabled'));
    const sp = pct(L3('間距', '间距', 'Spacing'), 'spacing', 10, 0.01); if (!g.spacingEnabled) sp.style.opacity = .4, sp.querySelector('input').disabled = true; add(sp);
  } else if (id === 'shapeDynamics'){
    add(pct(L3('尺寸快速變換', '大小抖动', 'Size Jitter'), 'shapeDynamics.size.jitter', 1)); add(control('shapeDynamics.size'));
    add(pct(L3('最小直徑', '最小直径', 'Minimum Diameter'), 'shapeDynamics.size.minimum', 1));
    const ts = pct(L3('傾斜縮放', '倾斜缩放比例', 'Tilt Scale'), 'shapeDynamics.tiltScale', 2); if (getPath(g, 'shapeDynamics.size.control') !== 'penTilt'){ ts.style.opacity = .4; ts.querySelector('input').disabled = true; } add(ts);
    dyn(L3('角度快速變換', '角度抖动', 'Angle Jitter'), 'shapeDynamics.angle', 1, null, true);
    dyn(L3('圓度快速變換', '圆度抖动', 'Roundness Jitter'), 'shapeDynamics.roundness', 1, L3('最小圓度', '最小圆度', 'Minimum Roundness'));
    add(el('div', {class:'row'}, [chk(L3('翻轉 X 快速變換', '翻转 X 抖动', 'Flip X Jitter'), 'shapeDynamics.flipXJitter'), chk(L3('翻轉 Y 快速變換', '翻转 Y 抖动', 'Flip Y Jitter'), 'shapeDynamics.flipYJitter')]));
    add(chk(L3('筆刷投影', '画笔投影', 'Brush Projection'), 'shapeDynamics.brushProjection'));
  } else if (id === 'scattering'){
    add(pct(L3('散佈', '散布', 'Scatter'), 'scattering.scatter.jitter', 10)); add(chk(L3('兩軸', '两轴', 'Both Axes'), 'scattering.bothAxes')); add(control('scattering.scatter'));
    add(num(L3('計數', '数量', 'Count'), 'scattering.count', 1, 16, '')); dyn(L3('計數快速變換', '数量抖动', 'Count Jitter'), 'scattering.countJitter', 1);
  } else if (id === 'colorDynamics'){
    add(chk(L3('套用每個筆尖', '应用每笔尖', 'Apply Per Tip'), 'colorDynamics.perTip'));
    dyn(L3('前景/背景快速變換', '前景/背景抖动', 'Foreground/Background Jitter'), 'colorDynamics.fgBg', 1);
    add(pct(L3('色相快速變換', '色相抖动', 'Hue Jitter'), 'colorDynamics.hueJitter', 1)); add(pct(L3('飽和度快速變換', '饱和度抖动', 'Saturation Jitter'), 'colorDynamics.saturationJitter', 1));
    add(pct(L3('亮度快速變換', '亮度抖动', 'Brightness Jitter'), 'colorDynamics.brightnessJitter', 1)); add(pct(L3('純度', '纯度', 'Purity'), 'colorDynamics.purity', 1, -1));
  } else if (id === 'transfer'){
    dyn(L3('不透明度快速變換', '不透明度抖动', 'Opacity Jitter'), 'transfer.opacity', 1, L3('最小', '最小', 'Minimum'));
    dyn(L3('流量快速變換', '流量抖动', 'Flow Jitter'), 'transfer.flow', 1, L3('最小', '最小', 'Minimum'));
    dyn(L3('濕度快速變換', '湿度抖动', 'Wetness Jitter'), 'transfer.wetness', 1, L3('最小', '最小', 'Minimum'));
    dyn(L3('混合快速變換', '混合抖动', 'Mix Jitter'), 'transfer.mix', 1, L3('最小', '最小', 'Minimum'));
    note(L3('（濕度／混合快速變換只對混合器筆刷有效）', '（湿度／混合抖动只对混合器画笔有效）', '(Wetness / Mix jitter only affect the Mixer Brush)'));
  } else if (id === 'pose'){
    const tilt = (label, path) => { const v = Math.round((getPath(g, path) || 0) / 90 * 100), r = el('input', {type:'range', min:-100, max:100, step:1, value:v, dataset:{bk:path}}), n = el('span', {text:v + '%', style:'min-width:40px;text-align:right'});
      r.oninput = () => { n.textContent = r.value + '%'; }; r.onchange = () => bset(path, +r.value / 100 * 90); return row(label, r, n); };
    add(tilt(L3('傾斜 X', '倾斜 X', 'Tilt X'), 'pose.tiltX')); add(tilt(L3('傾斜 Y', '倾斜 Y', 'Tilt Y'), 'pose.tiltY')); add(chk(L3('覆寫傾斜', '覆盖倾斜', 'Override Tilt'), 'pose.overrideTilt'));
    add(num(L3('旋轉', '旋转', 'Rotation'), 'pose.rotation', 0, 360, '°')); add(chk(L3('覆寫旋轉', '覆盖旋转', 'Override Rotation'), 'pose.overrideRotation'));
    add(pct(L3('壓力', '压力', 'Pressure'), 'pose.pressure', 1)); add(chk(L3('覆寫壓力', '覆盖压力', 'Override Pressure'), 'pose.overridePressure'));
  } else if (id === 'noise') note(L3('為筆尖柔邊加入額外的隨機性。沒有選項：在左邊清單打勾開啟。', '为画笔笔尖的柔边添加额外的随机性。没有选项：在左边清单打勾开启。', 'Adds extra randomness to the soft edges of the brush tip. No options: turn it on in the list.'));
  else if (id === 'wetEdges') note(L3('沿筆畫邊緣堆積顏料，像水彩。沒有選項：在左邊清單打勾開啟。', '沿笔画边缘堆积颜料，像水彩。没有选项：在左边清单打勾开启。', 'Builds up paint along the edges of the stroke for a watercolour look. No options: turn it on in the list.'));
  else if (id === 'buildUp'){ note(L3('噴槍：滑鼠停著不動也會持續上色。', '喷枪：鼠标停着不动也会持续上色。', 'Airbrush: keeps depositing paint while the pointer rests.')); add(num(L3('速率', '速率', 'Rate'), 'buildUpRate', 1, 200, '/s')); }
  else if (id === 'smoothing'){
    add(pct(L3('平滑化', '平滑', 'Smoothing'), 'smoothing.amount', 1)); add(chk(L3('拉繩模式', '拉绳模式', 'Pulled String Mode'), 'smoothing.pulledString'));
    add(chk(L3('筆畫追趕', '描边补齐', 'Stroke Catch-up'), 'smoothing.catchUp')); add(chk(L3('在筆畫結尾追趕', '描边结束时补齐', 'Catch-up on Stroke End'), 'smoothing.catchUpOnEnd')); add(chk(L3('調整縮放', '调整缩放', 'Adjust for Zoom'), 'smoothing.adjustForZoom'));
  } else if (id === 'dualBrush' && !mixerHand()){
    // PS 画笔设置 ▸ 双重画笔：模式、第二支笔尖（圆或取样）、大小、间距、散布（两轴）、数量、翻转（tools/brush.js dualBrushOf）
    const DM = [['multiply', L3('色彩增值', '正片叠底', 'Multiply')], ['darken', L3('變暗', '变暗', 'Darken')], ['overlay', L3('覆蓋', '叠加', 'Overlay')], ['colorDodge', L3('加亮顏色', '颜色减淡', 'Color Dodge')],
      ['colorBurn', L3('加深顏色', '颜色加深', 'Color Burn')], ['linearBurn', L3('線性加深', '线性加深', 'Linear Burn')], ['hardMix', L3('實色疊印混合', '实色混合', 'Hard Mix')], ['linearHeight', L3('線性高度', '线性高度', 'Linear Height')]];
    const db = g.dualBrush || {};
    add(row(L3('模式：', '模式：', 'Mode:'), selectOf(DM, db.mode || 'colorBurn', v => bset('dualBrush.mode', v), 'dualBrush.mode'), chk(L3('翻轉', '翻转', 'Flip'), 'dualBrush.flip')));
    const tips = [['', T(L3('圓形筆尖', '圆形笔尖', 'Round tip'))]].concat(window.BrushTips ? BrushTips.list().map(t => [t.id, t.name]) : []);
    add(row(L3('筆尖：', '笔尖：', 'Tip:'), selectOf(tips, db.tip || '', v => bset('dualBrush.tip', v), 'dualBrush.tip')));
    add(num(L3('尺寸', '大小', 'Size'), 'dualBrush.size', 1, 1000, 'px'));
    if (!db.tip) add(pct(L3('硬度', '硬度', 'Hardness'), 'dualBrush.hardness', 1));
    add(pct(L3('間距', '间距', 'Spacing'), 'dualBrush.spacing', 10, 0.01));
    add(pct(L3('散佈', '散布', 'Scatter'), 'dualBrush.scatter', 10)); add(chk(L3('兩軸', '两轴', 'Both Axes'), 'dualBrush.bothAxes'));
    add(num(L3('計數', '数量', 'Count'), 'dualBrush.count', 1, 16, ''));
  } else if (id === 'texture'){
    // PS 2020 画笔设置 ▸ 纹理（画笔工具 tools/brush.js 与混合器画笔共用 tools/mixer.js makeGrain）：图案、反相、缩放、亮度、对比度、为每个笔尖设置纹理、模式、深度
    const pats = (window.PsEdit && PsEdit.patterns ? PsEdit.patterns.load() : []).map(q => [q.id, q.name]);
    const tx = g.texture || {};
    add(row(L3('圖樣：', '图案：', 'Pattern:'), selectOf(pats.length ? pats : [['', '—']], tx.pattern || (pats[0] ? pats[0][0] : ''), v => bset('texture.pattern', v), 'texture.pattern'), chk(L3('負片', '反相', 'Invert'), 'texture.invert')));
    add(num(L3('縮放', '缩放', 'Scale'), 'texture.scale100', 1, 1000, '%'));
    const sc = b.querySelector('[data-bk="texture.scale100"]'); if (sc){ sc.value = Math.round((tx.scale || 1) * 100); sc.nextSibling && (sc.nextSibling.textContent = sc.value + '%'); sc.onchange = () => bset('texture.scale', +sc.value / 100); }
    add(num(L3('亮度', '亮度', 'Brightness'), 'texture.brightness', -150, 150, '')); add(num(L3('對比', '对比度', 'Contrast'), 'texture.contrast', -50, 100, ''));
    add(chk(L3('為每個筆尖設定紋理', '为每个笔尖设置纹理', 'Texture Each Tip'), 'texture.eachTip'));
    const MODES = [['multiply', L3('色彩增值', '正片叠底', 'Multiply')], ['subtract', L3('減去', '减去', 'Subtract')], ['darken', L3('變暗', '变暗', 'Darken')], ['overlay', L3('覆蓋', '叠加', 'Overlay')],
      ['colorDodge', L3('加亮顏色', '颜色减淡', 'Color Dodge')], ['colorBurn', L3('加深顏色', '颜色加深', 'Color Burn')], ['linearBurn', L3('線性加深', '线性加深', 'Linear Burn')], ['hardMix', L3('實色疊印混合', '实色混合', 'Hard Mix')],
      ['linearHeight', L3('線性高度', '线性高度', 'Linear Height')], ['height', L3('高度', '高度', 'Height')]];
    add(row(L3('模式：', '模式：', 'Mode:'), selectOf(MODES, tx.mode || 'multiply', v => bset('texture.mode', v), 'texture.mode')));
    add(pct(L3('深度', '深度', 'Depth'), 'texture.depth', 1));
  } else if (id === 'dualBrush') note(L3('未做：混合器筆刷的引擎沒有雙重筆刷（筆刷工具有）。', '未做：混合器画笔的引擎没有双重画笔（画笔工具有）。', 'Not done: the Mixer Brush engine has no Dual Brush (the Brush tool has).'));
  else note(L3('未做：我們的筆刷引擎（tools/brush.js）沒有保護紋理（原碼 brush_sections.rs:422-514 有）。', '未做：我们的笔刷引擎（tools/brush.js）没有保护纹理（原码 brush_sections.rs:422-514 有）。', 'Not done: our brush engine (tools/brush.js) has no Protect Texture (the original brush_sections.rs:422-514 has it).'));
}
/* ── 画笔预设（paint/src/presets.rs builtin：圆笔尖、不用纹理的那些照抄；取样笔尖／纹理的我们引擎画不出来，没抄） ── */
const PR = c => ({control:c}), PRM = m => ({control:'penPressure', minimum:m}), SD = d => ({enabled:true, size:d}), TR = (o, f) => ({enabled:true, opacity:o, flow:f});
const BRUSH_BASE = {pressureSize:false, spacing:0.25};
const BRUSH_PRESETS = [
  ['General', [['Hard Round', {size:30, hardness:1}], ['Soft Round', {size:45, hardness:0}], ['Hard Round Fine', {size:5, hardness:1, spacing:0.1}], ['Soft Round Large', {size:300, hardness:0, spacing:0.15}],
    ['Hard Round Pressure Size', {size:30, hardness:1, shapeDynamics:SD(PR('penPressure'))}], ['Soft Round Pressure Size', {size:45, hardness:0, shapeDynamics:SD(PR('penPressure'))}],
    ['Hard Round Pressure Opacity', {size:30, hardness:1, transfer:TR(PR('penPressure'), {})}], ['Soft Round Pressure Opacity', {size:45, hardness:0, transfer:TR(PR('penPressure'), {})}],
    ['Hard Round Pressure Opacity and Flow', {size:30, hardness:0.9, transfer:TR(PR('penPressure'), PRM(0.2))}],
    ['Airbrush Soft', {size:80, hardness:0, flow:0.1, spacing:0.1, buildUp:true, buildUpRate:25}],
    ['Airbrush Pressure Flow', {size:120, hardness:0, flow:0.15, spacing:0.1, buildUp:true, buildUpRate:30, transfer:TR({}, PR('penPressure'))}],
    ['Calligraphy Flat', {size:28, hardness:1, roundness:0.2, angle:45, spacing:0.05}]]],
  ['Dry Media', [['Hard Pencil', {size:3, hardness:1, aliased:true, spacing:0.1}], ['Soft Pencil', {size:6, hardness:0.6, spacing:0.08, shapeDynamics:SD(PRM(0.4)), transfer:TR(PRM(0.15), {})}],
    ['Wax Crayon', {size:22, hardness:0.85, roundness:0.7, spacing:0.08, shapeDynamics:{enabled:true, angle:PR('direction')}}]]],
  ['Wet Media', [['Watercolor Wet Edges', {size:60, hardness:0.3, wetEdges:true}],
    ['Watercolor Wash', {size:140, hardness:0, flow:0.35, spacing:0.12, wetEdges:true, shapeDynamics:SD(PRM(0.35)), transfer:TR({}, {jitter:0.2, control:'penPressure'})}],
    ['Ink Pen', {size:8, hardness:1, spacing:0.05, shapeDynamics:SD(PRM(0.15))}],
    ['Gouache Flat', {size:40, hardness:0.9, roundness:0.35, spacing:0.05, shapeDynamics:{enabled:true, angle:PR('direction')}, transfer:TR({}, {control:'fade', fadeSteps:600, minimum:0.35})}]]],
  ['Special Effects', [['Confetti', {size:24, hardness:1, roundness:0.5, spacing:1.2, shapeDynamics:{enabled:true, angle:{jitter:1}, size:{jitter:0.5}}, scattering:{enabled:true, scatter:{jitter:3}, bothAxes:true, count:3},
    colorDynamics:{enabled:true, perTip:true, hueJitter:1, saturationJitter:0.2, purity:0.5}}]]]];
const UB_LS = 'dlPsBrushSettingsPresets.v1';
const UserBrushes = PsWindow.userBrushes = {groups:null, get(){ if (!this.groups){ const v = LSget(UB_LS, null); this.groups = Array.isArray(v) ? v : []; } return this.groups; }, save(){ LSput(UB_LS, this.groups); }};
const brushGroups = () => BRUSH_PRESETS.map(([g, items]) => ({name:g, builtin:true, items:items.map(([n, b]) => ({name:n, brush:b, builtin:true}))})).concat(UserBrushes.get().map(g => ({name:g.name, items:g.items})));
const findBrush = name => { for (const g of brushGroups()) for (const it of g.items) if (it.name === name) return it; return null; };
CMD.reg('ps.brush.presets.list', {i18n:'', params:'{} 画笔面板的预设 → {ok, groups:[{name, builtin?, presets:[{name, size}]}], sampled:[名字]（取样笔尖：内建、定义画笔预设、读入 .abr 的；换笔尖用 brush.tips.select）, tips:[{id,name,size,source}]}'}, () => {
  const tips = window.BrushTips ? BrushTips.list() : [];
  return {ok:true, groups:brushGroups().map(g => ({name:g.name, builtin:!!g.builtin, presets:g.items.map(it => ({name:it.name, size:Math.round((it.brush && it.brush.size) || 0)}))})),
    sampled:tips.map(t => t.name), tips:tips.map(t => ({id:t.id, name:t.name, size:t.size, source:t.source}))};
});
/* 读入画笔（.abr）：挑档 → brush.tips.importAbr（base64） */
function pickAbr(){
  const inp = el('input', {type:'file', accept:'.abr', style:'display:none'});
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (!f) return;
    f.arrayBuffer().then(buf => { const r = CMD.run('brush.tips.importAbr', {bytes:new Uint8Array(buf), name:f.name});
      if (r && r.ok === false) alert(r.error);                 // 读不了的版本／坏档：照实说（parseAbr 的错误讯息）
      else if (r && r.warning) alert(r.warning);
      P.refresh('brushSettings'); }); inp.remove(); };
  document.body.appendChild(inp); inp.click();
}
CMD.reg('ps.brush.presets.select', {i18n:'', params:'{preset} 画笔面板点一个预设：笔刷换成它（保留目前的平滑设定）→ {ok, brush}'}, p => {
  const it = findBrush(p.preset); if (!it) return fail(`no brush preset "${p.preset}"`);
  const cur = peek(BCMD('get')) || {}, patch = Object.assign({}, it.builtin ? BRUSH_BASE : {}, clone(it.brush)); patch.smoothing = cur.smoothing; delete patch.color; delete patch.seed;
  const r = runCmd(BCMD('set'), {reset:true, brush:patch}); if (r && r.ok === false) return r;
  BrushUI.preset = it.name; P.refresh('brushSettings'); return {ok:true, preset:it.name, size:r && r.size};
});
CMD.reg('ps.brush.presets.save', {i18n:'', params:'{name?（缺省 "Brush N"）, group?="My Brushes", brush?（缺省＝目前笔刷）} 用这些设定新建画笔（brush.presets.save）→ {ok, name}'}, p => {
  const G = UserBrushes.get(), all = brushGroups().flatMap(g => g.items.map(i => i.name));
  let name = String(p.name || '').trim(); if (!name){ let n = 1; while (all.includes(`Brush ${n}`)) n++; name = `Brush ${n}`; } else name = uniqName(name, all);
  const b = clone(p.brush || peek(BCMD('get')) || {}); ['ok', 'color', 'seed', 'erase', 'ignored'].forEach(k => delete b[k]);
  const gn = String(p.group || 'My Brushes'); let g = G.find(x => x.name === gn); if (!g){ g = {name:gn, items:[]}; G.push(g); }
  g.items.push({name, brush:b}); UserBrushes.save(); BrushUI.preset = name; P.refresh('brushSettings'); return {ok:true, name, group:gn};
});
CMD.reg('ps.brush.presets.edit', {i18n:'', params:'{action:"rename|delete|move|newGroup|renameGroup|deleteGroup", preset?, name?, to?, group?} 画笔面板：改自己存的画笔预设（内建的不能改）→ {ok}'}, p => {
  if (p.preset && BRUSH_PRESETS.some(([, items]) => items.some(([n]) => n === p.preset))) return fail('built-in brush presets cannot be edited');
  const r = editGroups(UserBrushes.get(), p, 'ps.brush.presets.edit'); if (r.ok !== false){ UserBrushes.save(); P.refresh('brushSettings'); } return r;
});
function brushesTab(b){
  const flt = el('input', {type:'text', value:BrushUI.filter, placeholder:T(L3('搜尋筆刷', '搜索画笔', 'Search brushes')), dataset:{k:'filter'}, style:'width:100%;margin-bottom:4px', oninput:() => { BrushUI.filter = flt.value; drawList(); }});
  b.appendChild(flt);
  const box = el('div', {class:'list', style:'max-height:330px;overflow:auto'}); b.appendChild(box);
  function drawList(){
    box.innerHTML = ''; const q = BrushUI.filter.trim().toLowerCase();
    const groups = brushGroups().map(g => Object.assign({}, g, {items:g.items.filter(it => !q || it.name.toLowerCase().includes(q))})).filter(g => g.items.length || !q);
    const sampled = (window.BrushTips ? BrushTips.list() : []).filter(x => !q || x.name.toLowerCase().includes(q));
    groups.forEach(g => {
      const key = 'brushes/' + g.name, open = !PU.toggled[key];
      const hd = el('div', {class:'li pgh', dataset:{group:g.name}, style:'font-size:11.5px', text:(open ? '▾ 📂 ' : '▸ 📁 ') + g.name, onclick:() => { if (PU.toggled[key]) delete PU.toggled[key]; else PU.toggled[key] = true; savePU(); drawList(); }});
      if (!g.builtin) hd.oncontextmenu = e => { e.preventDefault(); ctxMenu(hd, groupMenuOf('ps.brush.presets.edit')(g)); };
      box.appendChild(hd); if (!open) return;
      g.items.forEach(it => { const sz = Math.round((it.brush && it.brush.size) || 0), h = (it.brush && it.brush.hardness);
        const dot = el('span', {style:`display:inline-block;width:16px;height:16px;border-radius:50%;flex:0 0 16px;background:radial-gradient(circle, #ddd ${Math.round((h === undefined ? 1 : h) * 60)}%, transparent 72%)`});
        const r = el('div', {class:'li' + (BrushUI.preset === it.name ? ' on' : ''), dataset:{preset:it.name}, style:'padding-left:16px', onclick:() => runCmd('ps.brush.presets.select', {preset:it.name})},
          [dot, el('span', {text:String(sz), class:'hint', style:'min-width:26px;margin:0;text-align:right'}), el('span', {text:it.name})]);
        if (!it.builtin) r.oncontextmenu = e => { e.preventDefault(); ctxMenu(r, itemMenuOf('ps.brush.presets.edit', L3('筆刷名稱', '画笔名称', 'Brush Name'))(it, g, UserBrushes.get().map(x => x.name))); };
        box.appendChild(r); });
    });
    if (sampled.length){
      const cur = (peek(BCMD('get')) || {}).tip || '';
      box.appendChild(el('div', {class:'li pgh', style:'font-size:11.5px', text:'▾ 📁 ' + T(L3('取樣筆尖', '取样笔尖', 'Sampled Tips'))}));
      sampled.forEach(x => {
        const th = BrushTips.thumb(x, 20); th.style.cssText = 'width:20px;height:20px;flex:0 0 20px;background:#1e1e1e;border-radius:2px';
        const r = el('div', {class:'li' + (cur === x.id ? ' on' : ''), dataset:{sampled:x.name, tip:x.id}, style:'padding-left:16px', title:`${x.name} (${x.width}×${x.height})`,
          onclick:() => { if (mixerHand()) return; runCmd('brush.tips.select', {tip:x.id}); BrushUI.preset = null; drawList(); }},
          [th, el('span', {text:String(x.size || ''), class:'hint', style:'min-width:26px;margin:0;text-align:right'}), el('span', {text:x.name})]);
        if (x.source !== 'builtin') r.oncontextmenu = e => { e.preventDefault(); ctxMenu(r, [
          {label:L3('重新命名…', '重命名…', 'Rename…'), act:'rename', run:() => askName(L3('筆刷名稱', '画笔名称', 'Brush Name'), x.name, n => { CMD.run('brush.tips.edit', {action:'rename', tip:x.id, name:n}); drawList(); })},
          {label:L3('刪除', '删除', 'Delete'), act:'delete', run:() => { runCmd('brush.tips.edit', {action:'delete', tip:x.id}); drawList(); }}]); };
        box.appendChild(r);
      });
    }
  }
  drawList();
  b.appendChild(el('div', {class:'bar'}, [btn('📁', L3('建立新群組', '创建新组', 'Create new group'), () => { const x = runCmd('ps.brush.presets.edit', {action:'newGroup', name:'Group'}); if (x && x.group) askName(L3('群組名稱', '组名称', 'Group Name'), x.group, n => CMD.run('ps.brush.presets.edit', {action:'renameGroup', group:x.group, name:n})); }, {dataset:{act:'newGroup'}}),
    btn('＋', L3('以這些設定建立新筆刷', '用这些设置创建新画笔', 'Create new brush from these settings'), () => { const x = runCmd('ps.brush.presets.save', {}); if (x && x.name) askName(L3('筆刷名稱', '画笔名称', 'Brush Name'), x.name, n => CMD.run('ps.brush.presets.edit', {action:'rename', preset:x.name, name:n})); }, {dataset:{act:'new'}}),
    btn('🗑', L3('刪除筆刷', '删除画笔', 'Delete brush'), () => { if (BrushUI.preset) runCmd('ps.brush.presets.edit', {action:'delete', preset:BrushUI.preset}); }, {dataset:{act:'delete'}, disabled:!BrushUI.preset || !!(findBrush(BrushUI.preset) || {}).builtin}),
    btn('⇪', L3('讀入筆刷…（Photoshop .abr）', '导入画笔…（Photoshop .abr）', 'Import Brushes… (Photoshop .abr)'), () => pickAbr(), {dataset:{act:'importAbr'}})]));
}
P.define('brushSettings', {title:L3('筆刷設定', '画笔设置', 'Brush Settings'), w:520,
  refresh(b){
    if (busy(b)) return;
    b.innerHTML = '';
    b.appendChild(el('div', {class:'grid', style:'margin-bottom:6px'}, [btn(T(L3('筆刷設定', '画笔设置', 'Brush Settings')), null, () => { BrushUI.tab = 0; P.refresh('brushSettings'); }, {class:BrushUI.tab === 0 ? 'on' : '', dataset:{tab:0}}),
      btn(T(L3('筆刷', '画笔', 'Brushes')), null, () => { BrushUI.tab = 1; P.refresh('brushSettings'); }, {class:BrushUI.tab === 1 ? 'on' : '', dataset:{tab:1}})]));
    if (BrushUI.tab === 1){ brushesTab(b); return; }
    const g = peek(BCMD('get')) || {}, i = BrushUI.section;
    const left = el('div', {class:'bsecs', style:'flex:0 0 150px;border-right:1px solid var(--line,#3a3a3a);padding-right:6px'});
    SECTIONS.forEach(([id, name], k) => {
      const flag = secFlag(k), unsupported = flag === false, on = typeof flag === 'string' ? !!getPath(g, flag) : null;
      const box = typeof flag === 'string' ? Object.assign(el('input', {type:'checkbox', dataset:{secbox:id}, onclick:e => { e.stopPropagation(); bset(flag, box.checked); }}), {checked:on})
        : unsupported ? Object.assign(el('input', {type:'checkbox', disabled:true}), {checked:false}) : el('span', {style:'width:13px;display:inline-block'});
      left.appendChild(el('div', {class:'li' + (k === i ? ' on' : ''), dataset:{sec:id}, style:(unsupported ? 'color:#777;' : '') + (k === 0 ? 'font-weight:600;margin-bottom:4px' : ''),
        title:unsupported ? T(L3('未做：筆刷引擎沒有這一節', '未做：画笔引擎没有这一节', 'Not done: the brush engine has no such section')) : '',
        onclick:() => runCmd('ps.brush.section', {section:id})}, [k === 0 ? null : box, el('span', {text:T(name)})]));
    });
    const right = el('div', {style:'flex:1;min-width:0;padding-left:8px;max-height:420px;overflow:auto'});
    right.appendChild(el('div', {style:'font-weight:600;margin-bottom:4px', text:T(SECTIONS[i][1])}));
    const body = el('div', {class:'bbody', dataset:{section:SECTIONS[i][0]}}); right.appendChild(body);
    brushSectionBody(body, g, i);
    if (typeof secFlag(i) === 'string' && !getPath(g, secFlag(i))) body.style.opacity = .45;          // 关掉的节控件照摆、变淡（原码 add_enabled_ui）
    b.appendChild(el('div', {style:'display:flex;gap:0'}, [left, right]));
    b.appendChild(el('div', {class:'sec', text:''}));
    const W = Math.max(200, (P.els.brushSettings ? P.els.brushSettings.clientWidth : 500) - 70);
    b.appendChild(el('div', {style:'display:flex;gap:6px;align-items:center'}, [el('div', {style:'flex:1;min-width:0'}, [brushPreview(b, W, 70)]), el('div', {style:'display:flex;flex-direction:column;gap:4px'}, [
      btn('＋', L3('以這些設定建立新筆刷', '用这些设置创建新画笔', 'Create new brush from these settings'), () => { const x = runCmd('ps.brush.presets.save', {}); if (x && x.name) askName(L3('筆刷名稱', '画笔名称', 'Brush Name'), x.name, n => CMD.run('ps.brush.presets.edit', {action:'rename', preset:x.name, name:n})); }, {dataset:{act:'newBrush'}}),
      btn('⟲', L3('筆刷回到預設值', '画笔复位到默认值', 'Reset the brush to the defaults'), () => { const sm = (peek(BCMD('get')) || {}).smoothing; runCmd(BCMD('set'), {reset:true, brush:{smoothing:sm}}); }, {dataset:{act:'resetBrush'}})])]));
  }});
/* brush.set 是工具状态命令（不经过 UI.refresh）⇒ 跑完补刷画笔设置面板 */
if (!CMD.__psWinBrushRefresh){ CMD.__psWinBrushRefresh = true; const r0 = CMD.run; CMD.run = function(id){ const o = r0.apply(this, arguments); if (/^(brush\.set|brush\.tips\.\w+|mixer\.brush\.set|mixer\.setOptions|eraser\.setOptions)$/.test(id) && P.isOpen('brushSettings')) P.schedule('doc'); return o; }; }

/* ═══════════ 停靠块：图层（右侧面板）、工具（左侧工具栏）、选项（选项栏） ═══════════ */
function dockShow(sel, on){ document.querySelectorAll(sel).forEach(n => { n.style.display = on ? '' : 'none'; }); }
P.define('layers', {title:L3('圖層', '图层', 'Layers'), dock:{
  shown:() => { const n = document.getElementById('layerList'); return !!n && n.style.display !== 'none'; },
  show:on => { const rp = document.getElementById('rightpanel'); if (!rp) return; const ph = rp.querySelectorAll('.ph');
    [ph[0], rp.querySelector('.layerops'), document.getElementById('layerList'), rp.querySelector('.layerbtns')].forEach(n => { if (n) n.style.display = on ? '' : 'none'; }); if (ph[1]) ph[1].style.marginTop = on ? '10px' : '0'; }}});
P.define('tools', {title:L3('工具', '工具', 'Tools'), dock:{shown:() => { const n = document.getElementById('toolbar'); return !!n && n.style.display !== 'none'; }, show:on => dockShow('#toolbar', on)}});
P.define('options', {title:L3('選項', '选项', 'Options'), dock:{shown:() => { const n = document.getElementById('optionbar'); return !!n && n.style.display !== 'none'; }, show:on => dockShow('#optionbar', on)}});

/* ═══════════ 文件视窗（view_cmds.rs:592-641 float_window：另开一个视窗看同一份文件，有自己的缩放与位置） ═══════════ */
const Wins = PsWindow.windows = {list:[], seq:0, arrange:'tabs'};
function openDocWindow(view, docId){
  const id = 'docWindow:' + (++Wins.seq), w = {id, zoom:view ? view.zoom : UI.zoom, center:view ? view.center.slice() : viewInfo().center, docId:docId || (window.Docs ? Docs.activeId() : null)};
  Wins.list.push(w);
  P.define(id, {title:L3('未命名 @ ', '未标题 @ ', 'Untitled @ '), w:360, h:280, live:true,
    build(b){ const cv = el('canvas', {style:'width:100%;height:100%;display:block;background:#1e1e1e;cursor:grab'}); b.style.padding = '0'; b.appendChild(cv);
      cv.addEventListener('wheel', e => { e.preventDefault(); w.zoom = clamp(w.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.01, 64); P.refresh(id); }, {passive:false});
      cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); const x0 = e.clientX, y0 = e.clientY, c0 = w.center.slice();
        const mv = ev => { w.center = [c0[0] - (ev.clientX - x0) / w.zoom, c0[1] - (ev.clientY - y0) / w.zoom]; P.refresh(id); };
        const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); }; cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); }); },
    refresh(b){
      // 多文件（menus/impl/docs.js）：这个视窗看的那份不在前面 ⇒ 画它收起时留的合成图
      const other = window.Docs && w.docId && Docs.view ? Docs.view(w.docId) : null;
      const info = window.Docs && w.docId ? (Docs.info().documents.find(x => x.id === w.docId) || null) : null;
      const box = P.els[id]; if (box){ const t = box.querySelector('.dlp-t'); t.textContent = (info ? info.name : T(L3('未命名', '未标题', 'Untitled'))) + ' @ ' + Math.round(w.zoom * 100) + '%'; }
      const cv = b.querySelector('canvas'), W = cv.clientWidth || 300, H = cv.clientHeight || 220; cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d'), z = w.zoom, ox = W / 2 - w.center[0] * z, oy = H / 2 - w.center[1] * z;
      const dw = other ? other.width : Doc.width, dh = other ? other.height : Doc.height;
      ctx.fillStyle = '#fff'; ctx.fillRect(ox, oy, dw * z, dh * z);
      try { ctx.drawImage(other ? other.canvas : composite(Math.min(z, 4)), ox, oy, dw * z, dh * z); } catch(e){}
    },
    onClose(){ Wins.list = Wins.list.filter(x => x !== w); delete P.defs[id]; }});
  P.open(id);
  return w;
}
const LAYOUTS = ['tileAllVertically', 'tileAllHorizontally', 'twoUpVertical', 'twoUpHorizontal', 'threeUpVertical', 'threeUpHorizontal', 'threeUpStacked', 'fourUp', 'sixUp', 'tile'];
const regW = (id, params, fn) => CMD.reg('ps.' + id, {i18n:'', params}, fn);
/* 多份文件时：每份各开一个浮动视窗、照版面排（一份文件时只记下版面，同原码） */
const ARR_GRID = {tileAllVertically:n => [n, 1], tileAllHorizontally:n => [1, n], twoUpVertical:() => [2, 1], twoUpHorizontal:() => [1, 2], threeUpVertical:() => [3, 1], threeUpHorizontal:() => [1, 3], threeUpStacked:() => [2, 2], fourUp:() => [2, 2], sixUp:() => [3, 2], tile:n => [Math.ceil(Math.sqrt(n)), Math.ceil(n / Math.ceil(Math.sqrt(n)))]};
function docIds(){ return window.Docs ? Docs.info().documents.map(d => d.id) : [null]; }
function windowsForAll(k){
  Wins.list.slice().forEach(w => P.close(w.id));
  const ids = docIds(), out = [];
  const [cols, rows] = k && ARR_GRID[k] ? ARR_GRID[k](ids.length) : [0, 0];
  const st = document.getElementById('stage'), r = st ? st.getBoundingClientRect() : {left:80, top:60, width:900, height:600};
  ids.forEach((id, i) => {
    const w = openDocWindow(null, id); out.push(w.id);
    const box = P.els[w.id]; if (!box) return;
    if (cols){ const c = i % cols, rr = Math.floor(i / cols) % Math.max(1, rows), W = r.width / cols, H = r.height / Math.max(1, rows);
      Object.assign(box.style, {left:(r.left + c * W) + 'px', top:(r.top + rr * H) + 'px', width:Math.max(180, W - 4) + 'px', height:Math.max(140, H - 4) + 'px', right:'auto'}); }
    else Object.assign(box.style, {left:(r.left + 30 + i * 28) + 'px', top:(r.top + 30 + i * 28) + 'px', right:'auto'});   // 层叠
    P.refresh(w.id);
  });
  return out;
}
LAYOUTS.forEach(k => regW('window.arrange.' + k, '{} 窗口 ▸ 排列 ▸ 这个版面：开着两份以上文件 ⇒ 每份一个浮动视窗照版面排；只有一份 ⇒ 记下版面 → {ok, arrange, windows?}', () => {
  Wins.arrange = k;
  if (docIds().length < 2) return {ok:true, arrange:k};
  return {ok:true, arrange:k, windows:windowsForAll(k)};
}));
regW('window.arrange.consolidateAllToTabs', '{} 将所有内容合并到选项卡中：关掉另开的文件视窗 → {ok, arrange:"tabs"}', () => { Wins.arrange = 'tabs'; Wins.list.slice().forEach(w => P.close(w.id)); return {ok:true, arrange:'tabs'}; });
['newWindowForDocument', 'floatInWindow'].forEach(k => regW('window.arrange.' + k, '{} 另开一个浮动视窗看这份文件（自己的缩放与位置；滚轮缩放、拖曳平移）→ {ok, window}', () => ({ok:true, window:openDocWindow().id})));
['floatAllInWindows', 'cascade'].forEach(k => regW('window.arrange.' + k, '{} 每份打开的文件各开一个浮动视窗（层叠排）→ {ok, windows}', () => ({ok:true, windows:windowsForAll(null)})));
['matchZoom', 'matchLocation', 'matchRotation', 'matchAll'].forEach(k => regW('window.arrange.' + k, '{} 把目前视图的缩放／位置套到所有另开的视窗（视图不会旋转 ⇒ 匹配旋转没有东西可对齐）→ {ok, zoom, center, rotation:0}', () => {
  if (!Wins.list.length) return {ok:false, error:'no other windows'};
  const v = viewInfo(), z = k === 'matchZoom' || k === 'matchAll', l = k === 'matchLocation' || k === 'matchAll';
  Wins.list.forEach(w => { if (z) w.zoom = v.zoom; if (l) w.center = v.center.slice(); P.refresh(w.id); });
  return {ok:true, zoom:v.zoom, center:v.center, rotation:0};
}));

/* ═══════════ 面板项命令（view_cmds.rs:457-475：开着就关、否则开） ═══════════ */
const TYPE_PANELS = {character:['char', 0], paragraph:['char', 1], glyphs:['glyphs', 0], characterStyles:['styles', 0], paragraphStyles:['styles', 1]};
const typeOpen = k => { const PT = window.PsType && PsType.Panels, t = TYPE_PANELS[k]; return !!PT && PT.isOpen(t[0]) && (PT.tab[t[0]] || 0) === t[1]; };
PsWindow.isOpen = id => TYPE_PANELS[id] ? typeOpen(id) : id === 'brushes' ? (P.isOpen('brushSettings') && BrushUI.tab === 1) : id === 'brushSettings' ? (P.isOpen('brushSettings') && BrushUI.tab === 0) : P.isOpen(id);
const PANELS = ['actions', 'adjustments', 'brushSettings', 'brushes', 'channels', 'character', 'characterStyles', 'cloneSource', 'color', 'glyphs', 'gradients', 'histogram', 'history', 'info', 'layerComps', 'layers',
  'measurementLog', 'modifierKeys', 'navigator', 'notes', 'paragraph', 'paragraphStyles', 'paths', 'patterns', 'properties', 'shapes', 'styles', 'swatches', 'timeline', 'toolPresets', 'options', 'tools'];
function togglePanel(panel, on){
  if (TYPE_PANELS[panel]){
    const id = 'ps.type.panels.' + panel; if (!has(id)) return {ok:false, error:'no type panels (ps-type)'};
    const want = typeof on === 'boolean' ? on : !typeOpen(panel);
    if (!want && typeOpen(panel)){ const t = TYPE_PANELS[panel]; PsType.Panels.group(t[0], false); }
    else if (want) CMD.map[id].run({show:true});
    return {ok:true, panel, visible:typeOpen(panel)};
  }
  if (panel === 'brushes' || panel === 'brushSettings'){            // menus.rs:150-158：画笔＝开画笔设置窗的「画笔」页（只开不关）；画笔设置照一般切换
    const tab = panel === 'brushes' ? 1 : 0, open = PsWindow.isOpen(panel);
    if (panel === 'brushes'){ BrushUI.tab = 1; P.open('brushSettings'); P.refresh('brushSettings'); }
    else { const want = typeof on === 'boolean' ? on : !open; BrushUI.tab = 0; want ? (P.open('brushSettings'), P.refresh('brushSettings')) : P.close('brushSettings'); }
    return {ok:true, panel, tab, visible:PsWindow.isOpen(panel)};
  }
  if (panel === 'modifierKeys') return CMD.map['ps.window.panel.modifierKeys'].run(typeof on === 'boolean' ? {show:on} : {});
  if (!P.has(panel)) return {ok:false, error:`unknown panel \`${panel}\``};
  return {ok:true, panel, visible:P.toggle(panel, on)};
}
CMD.reg('ps.window.panel', {i18n:'', params:`{panel:"${PANELS.join('|')}", on?:bool（缺省＝开着就关、关着就开）} 窗口 ▸ 面板项（浮动面板：可拖、可关、可拉大小）→ {ok, panel, visible}`}, p => togglePanel(p.panel, p.on));
PANELS.forEach(k => { if (k !== 'modifierKeys') CMD.reg('ps.window.panel.' + k, {i18n:'', params:'{on?} 窗口 ▸ ' + k + '（同 ps.window.panel {panel:"' + k + '"}）'}, p => togglePanel(k, p.on)); });

/* ═══════════ 工作区（menus.rs:87-98、872-893；workspace_ui.rs:100-242） ═══════════ */
const WS_LS = 'dlPsWorkspaces.v1';
const PRESETS = {essentials:'Essentials', photography:'Photography', painting:'Painting', pixelArt:'Pixel Art', graphicAndWeb:'Graphic and Web', motion:'Motion'};
const WS = PsWindow.workspace = {cur:'Essentials', locked:false, saved:(() => { try { return JSON.parse(localStorage.getItem(WS_LS) || '{}'); } catch(e){ return {}; } })(),
  save(){ try { localStorage.setItem(WS_LS, JSON.stringify(this.saved)); } catch(e){} }};
function applyWorkspace(){
  const s = WS.saved[WS.cur];
  if (s){ (s.closed || []).forEach(id => { if (P.has(id)) P.close(id); }); (s.open || []).forEach(id => { if (P.has(id)){ const m = s.pos && s.pos[id]; if (m) P._mem.pos = Object.assign(P._mem.pos || {}, {[id]:m}); P.close(id); P.open(id); } });
    if (s.shortcuts && has('ps.edit.keyboardShortcuts')) CMD.map['ps.edit.keyboardShortcuts'].run({reset:true, set:s.shortcuts, allowUnknown:true, removeConflicts:false}); return; }
  const [nav, color, layers, history, props] = ({Photography:[1, 0, 1, 1, 1], Painting:[0, 1, 1, 0, 0], 'Graphic and Web':[0, 1, 1, 0, 1]})[WS.cur] || [0, 1, 1, 0, 1];
  P.toggle('navigator', !!nav); P.toggle('color', !!color); P.toggle('layers', !!layers); P.toggle('history', !!history); P.toggle('properties', !!props);
  if (window.PsType && PsType.Panels) PsType.Panels.group('char', false);
}
Object.keys(PRESETS).forEach(k => regW('window.workspace.' + k, `{} 窗口 ▸ 工作区 ▸ ${PRESETS[k]}：照预设开关导航器／颜色／图层／历史记录／属性 → {ok, workspace}`, () => { WS.cur = PRESETS[k]; applyWorkspace(); refreshWsMenu(); return {ok:true, workspace:WS.cur}; }));
regW('window.workspace.resetWorkspace', '{} 窗口 ▸ 工作区 ▸ 复位工作区：重新套用目前的工作区 → {ok, workspace}', () => { applyWorkspace(); return {ok:true, workspace:WS.cur}; });
regW('window.workspace.newWorkspace', '{name, keyboardShortcuts?:bool, menus?:bool, toolbar?:bool, dialog?:true} 窗口 ▸ 工作区 ▸ 新建工作区…：存下面板的开关与位置（可选连键盘快捷键）并设为目前 → {ok, workspace, replaced}', p => {
  if (p.dialog){ P.dialog({id:'psNewWs', title:L3('新增工作區', '新建工作区', 'New Workspace'), fields:[{k:'name', type:'text', label:L3('名稱：', '名称：', 'Name:'), value:''},
    {type:'note', label:L3('面板位置會儲存在工作區中。鍵盤快速鍵、選單與工具列為選用。', '面板位置将存储在此工作区中。键盘快捷键、菜单和工具栏是可选的。', 'Panel locations are saved in the workspace. Keyboard shortcuts, menus and toolbar are optional.')},
    {k:'keyboardShortcuts', type:'check', label:L3('鍵盤快速鍵', '键盘快捷键', 'Keyboard Shortcuts'), value:false}, {k:'menus', type:'check', label:L3('選單', '菜单', 'Menus'), value:false}, {k:'toolbar', type:'check', label:L3('工具列', '工具栏', 'Toolbar'), value:false}],
    ok:v => CMD.run('ps.window.workspace.newWorkspace', v)}); return {ok:true, dialog:'newWorkspace'}; }
  const name = String(p.name || '').trim(); if (!name) return {ok:false, error:'a workspace needs a name'};
  if (Object.values(PRESETS).includes(name)) return {ok:false, error:`"${name}" is a built-in workspace`};
  P._remember();
  const ws = {open:Object.keys(P.els), closed:Object.keys(P.defs).filter(id => !P.isOpen(id)), pos:JSON.parse(JSON.stringify(P._mem.pos || {}))};
  ws.closed.push(...Object.keys(P.defs).filter(id => P.defs[id].dock && !P.isOpen(id))); ws.open.push(...Object.keys(P.defs).filter(id => P.defs[id].dock && P.isOpen(id)));
  if (p.keyboardShortcuts === true && has('ps.edit.keyboardShortcuts')){ const r = CMD.map['ps.edit.keyboardShortcuts'].run({list:true}); if (r && r.overrides) ws.shortcuts = r.overrides; }
  const replaced = !!WS.saved[name]; WS.saved[name] = ws; WS.save(); WS.cur = name; refreshWsMenu();
  return {ok:true, workspace:name, replaced};
});
regW('window.workspace.deleteWorkspace', '{name, dialog?:true} 窗口 ▸ 工作区 ▸ 删除工作区…（目前的工作区不能删）→ {ok, deleted}', p => {
  if (p.dialog){ const names = Object.keys(WS.saved); if (!names.length) return {ok:false, error:'no saved workspaces'};
    P.dialog({id:'psDelWs', title:L3('刪除工作區', '删除工作区', 'Delete Workspace'), okLabel:L3('刪除', '删除', 'Delete'), fields:[{k:'name', type:'select', label:L3('工作區：', '工作区：', 'Workspace:'), value:names[0], options:names}],
      ok:v => CMD.run('ps.window.workspace.deleteWorkspace', v)}); return {ok:true, dialog:'deleteWorkspace'}; }
  const name = String(p.name || ''); if (!WS.saved[name]) return {ok:false, error:`no saved workspace "${name}"`};
  if (WS.cur === name) return {ok:false, error:`"${name}" is the current workspace; switch to another first`};
  delete WS.saved[name]; WS.save(); refreshWsMenu(); return {ok:true, deleted:name};
});
regW('window.workspace.select', '{name} 切到一个工作区（内建或存下来的）→ {ok, workspace}', p => {
  const name = String(p.name || ''); const k = Object.keys(PRESETS).find(x => PRESETS[x] === name);
  if (!k && !WS.saved[name]) return {ok:false, error:`no workspace "${name}"`};
  WS.cur = name; applyWorkspace(); refreshWsMenu(); return {ok:true, workspace:name};
});
regW('window.workspace.lockWorkspace', '{on?} 窗口 ▸ 工作区 ▸ 锁定工作区：面板不能拖动、拉大小 → {ok, locked}', p => { WS.locked = typeof p.on === 'boolean' ? p.on : !WS.locked; document.body.classList.toggle('dlp-locked', WS.locked); return {ok:true, locked:WS.locked}; });
regW('window.workspace.list', '{} → {ok, current, builtin, saved, locked}', () => ({ok:true, current:WS.cur, builtin:Object.values(PRESETS), saved:Object.keys(WS.saved), locked:WS.locked}));
if (!document.getElementById('psWinStyle')){ const st = document.createElement('style'); st.id = 'psWinStyle'; st.textContent = 'body.dlp-locked .dlp{resize:none}body.dlp-locked .dlp-h{cursor:default}'; document.head.appendChild(st); }
if (P._drag && !P.__lockHook){ P.__lockHook = true; const d = P._drag; P._drag = function(id, head){ d.call(this, id, head); head.addEventListener('pointerdown', e => { if (WS.locked) e.stopImmediatePropagation(); }, true); }; }
/* 存下来的工作区接进工作区子菜单（照原码 window.workspace.select；放在「动感」后面） */
function refreshWsMenu(){
  const t = window.MenuTrees && MenuTrees.ps && MenuTrees.ps.window; if (!t) return;
  const sub = t.items.find(it => it.sub && it.sub.some(x => x.id === 'window.workspace.essentials')); if (!sub) return;
  sub.sub = sub.sub.filter(x => !x._saved);
  const at = sub.sub.findIndex(x => x.id === 'window.workspace.motion') + 1;
  const extra = Object.keys(WS.saved).map(n => ({n:{'zh-Hant':n, 'zh-Hans':n, en:n}, id:'window.workspace.select.' + n, radio:'workspace', _saved:true, impl:{cmd:'ps.window.workspace.select', params:{name:n}, checked:() => WS.cur === n}}));
  sub.sub.splice(at, 0, ...extra);
}
PsWindow.refreshWsMenu = refreshWsMenu;
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', refreshWsMenu); else refreshWsMenu();
})();
