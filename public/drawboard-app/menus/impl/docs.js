/* 堤麟画板 · 多文件（分页标签列）
   照 photocraft 原码 engine/src/lib.rs Session：docs:Vec<DocState>＋active（add_document 加到最后并设为当前、close(index) 关掉后当前＝同位置或最后一份、
   set_active＝document.activate）；file_cmds.rs:206 close_all／214 close_others；smart_cmds.rs:592 edit_contents（智能对象「编辑内容」＝开成新文件、
   smart_links 记母文件＋那一层）、commit_child（存储＝写回母文件那层、一步历史、子文件算存过）、on_close（改过的子文件关掉时自动写回）。
   我们的引擎只有一份全域 Doc／History ⇒ 分页＝把「目前这份」收起来（Doc 的栏位、历史快照、上一步／下一步、文件名与存档基准、视角），换上另一份。
   原码没有、照 PS 2020 补的：分页标签列（名字＊＝改过、×＝关）、把图层拖到别的分页标签（停一下就切过去）放进那份文件（复制层）、
   移动工具把画面内容拖到别的分页、窗口 ▸ 排列（每份文件各一个浮动视窗、并排）、未存的分页关前问要不要存。
   网站宿主：宿主开的那份＝第一个分页（host）。宿主钩子（DilinCanvas.serialize／dl:change）永远对着它：切到别的分页时不报改动、serialize 回宿主那份。
   其他分页是临时文件，关前提示另存（.dlcanvas 下载）。
   照 PS 存回原档：浏览器有 File System Access（本地版）⇒「打开」用 showOpenFilePicker 拿档案句柄（跟着分页收起／换上），「存储」照原格式写回；
   新建的分页第一次「存储」跳 showSaveFilePicker（ps-file.js saveInPlace／saveViaPicker）；没有这个 API ⇒ 照旧挑档＋存储为下载。 */
(function(){
'use strict';
if (window.Docs) return;
const L3 = (a, b, c) => Lang.cur === 'en' ? c : Lang.cur === 'zh-Hans' ? b : a;
const fail = e => ({ok:false, error:e});
const St = () => (window.PsFile && PsFile._st) || null;

const Docs = window.Docs = {
  list:[], cur:0, seq:0, _susp:false, drag:null,
  active(){ return this.list[this.cur]; },
  activeId(){ return this.active() ? this.active().id : null; },
  isHostActive(){ const d = this.active(); return !!(d && d.host); },
  byId(id){ return this.list.find(d => d.id === id) || null; },
  indexOf(id){ return this.list.findIndex(d => d.id === id); },
  count(){ return this.list.length; }
};

/* ── 收起／换上 ── */
function docProps(){ const o = {}; Object.keys(Doc).forEach(k => { if (typeof Doc[k] !== 'function' && !k.startsWith('__')) o[k] = Doc[k]; }); return o; }
function capture(d){
  const st = St();
  d.state = {
    props:docProps(), snap:History.snap(), past:History.past.slice(), future:History.future.slice(), uid:_uid,
    st:st ? {name:st.name, ext:st.ext, mark:st.mark, savedSnap:st.savedSnap, assets:st.assets, fileHandle:st.fileHandle || null, jpegOpts:st.jpegOpts ? Object.assign({}, st.jpegOpts) : null} : null,
    session:window.Smart ? Smart.session : null,
    view:{zoom:UI.zoom, sl:UI.wrap ? UI.wrap.scrollLeft : 0, stp:UI.wrap ? UI.wrap.scrollTop : 0}
  };
  try { d.thumb = composite(1); } catch (e){ d.thumb = null; }       // 浮动视窗看不在前面的文件用
  d.name = st ? st.name : d.name; d.w = Doc.width; d.h = Doc.height;
  d.dirty = window.PsFile ? PsFile.isDirty() : false;
  if (d.host) d.hostJSON = safeSerialize();
}
function safeSerialize(){ try { return Project.serialize({reuse:true}); } catch (e){ console.error(e); return null; } }
function apply(d){
  const s = d.state; d.state = null;
  if (window.Smart) Smart.session = null;
  Smart._opening = true;
  try { History.restore(s.snap); } finally { Smart._opening = false; }
  Object.keys(Doc).forEach(k => { if (typeof Doc[k] !== 'function' && !k.startsWith('__')) delete Doc[k]; });
  Object.assign(Doc, s.props);
  History.past.length = 0; History.past.push(...s.past); History.future.length = 0; History.future.push(...s.future);
  _uid = Math.max(_uid, s.uid);
  const st = St(); if (st && s.st) Object.assign(st, s.st);
  if (window.Smart){ Smart.session = s.session; Smart.banner(); }
  syncSuspend();
  if (window.UI && UI.canvas){
    UI._compCache = null;
    UI.setZoom(s.view.zoom);
    if (UI.wrap){ UI.wrap.scrollLeft = s.view.sl; UI.wrap.scrollTop = s.view.stp; }
    UI.refresh(); UI.draw();
  }
}
/* 宿主钩子：只有宿主那份在前面时才报改动 */
function syncSuspend(){
  const want = !Docs.isHostActive();
  if (want && !Docs._susp){ SiteHooks._suspend++; Docs._susp = true; }
  else if (!want && Docs._susp){ SiteHooks._suspend = Math.max(0, SiteHooks._suspend - 1); Docs._susp = false; }
}
/* 切到第 i 份（document.activate） */
function activate(i){
  if (!(i >= 0 && i < Docs.list.length)) return fail('no document ' + i);
  if (i === Docs.cur) return {ok:true, document:i, id:Docs.list[i].id};
  if (window.Dlg && Dlg.cur) return fail('a dialog is open');
  capture(Docs.active());
  Docs.cur = i;
  apply(Docs.active());
  Docs.render();
  fire();
  return {ok:true, document:i, id:Docs.active().id};
}
/* 开一份新的分页：先收起目前这份、清掉历史，再跑 build()（建内容；里头可以叫 file.new／Project.load…） */
/* build 同步回结果 ⇒ newTab 也同步回（编辑内容、agent 跑完马上要看 Doc）；build 回 Promise ⇒ newTab 回 Promise */
function newTab(build, extra){
  capture(Docs.active());
  if (window.Smart) Smart.session = null;
  History.past.length = 0; History.future.length = 0;
  const d = Object.assign({id:'D' + (++Docs.seq), host:false, state:null}, extra || {});
  Docs.list.push(d); Docs.cur = Docs.list.length - 1;
  syncSuspend();
  const finish = r => {
    if (r && r.ok === false && !r.keep){ if (Docs.active() === d) dropCurrent(); return r; }
    if (window.Smart && Smart.banner) Smart.banner();
    Docs.render(); fire();
    return Object.assign({ok:true}, r && typeof r === 'object' ? r : {}, {document:Docs.indexOf(d.id), id:d.id});
  };
  let r;
  try { r = build(); }
  catch (e){ console.error(e); return finish(fail(String(e && e.message || e))); }
  if (r && typeof r.then === 'function') return r.then(finish, e => { console.error(e); return finish(fail(String(e && e.message || e))); });
  return finish(r);
}
/* 把目前这份整个丢掉（不问），换上旁边那份（lib.rs:313 close：同位置或最后一份） */
function dropCurrent(){
  const i = Docs.cur, d = Docs.list[i];
  Docs.list.splice(i, 1);
  Docs.cur = Math.min(i, Docs.list.length - 1);
  apply(Docs.active());
  Docs.render(); fire();
  return d;
}
const fire = () => { try { window.dispatchEvent(new CustomEvent('dl:docs', {detail:Docs.info()})); } catch (e){} };

Docs.info = () => ({active:Docs.cur, documents:Docs.list.map((d, i) => {
  const on = i === Docs.cur, st = St();
  return {index:i, id:d.id, name:on && st ? st.name : d.name, host:!!d.host, child:!!d.child,
    width:on ? Doc.width : d.w, height:on ? Doc.height : d.h, dirty:on ? (window.PsFile ? PsFile.isDirty() : false) : !!d.dirty};
})});

/* ── 分页标签列（PS：名字 @ 缩放、＊＝改过、× 关） ── */
Docs.render = function(){
  let bar = document.getElementById('docTabs');
  const stage = document.getElementById('stage'), wrap = document.getElementById('canvasWrap');
  if (!stage || !wrap) return;
  if (!bar){
    bar = document.createElement('div'); bar.id = 'docTabs';
    bar.style.cssText = 'display:flex;gap:1px;background:#202020;border-bottom:1px solid #111;min-height:24px;overflow-x:auto;flex:0 0 auto;font:12px sans-serif;user-select:none';
    stage.insertBefore(bar, wrap);
  }
  const info = Docs.info();
  bar.innerHTML = '';
  info.documents.forEach(d => {
    const t = document.createElement('div'); t.className = 'doctab' + (d.index === info.active ? ' on' : ''); t.dataset.doc = d.id; t.dataset.index = d.index;
    t.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 8px 3px 10px;cursor:default;white-space:nowrap;color:' + (d.index === info.active ? '#eee;background:#383838' : '#9a9a9a;background:#262626');
    const nm = document.createElement('span'); nm.className = 'nm';
    const zoom = d.index === info.active ? Math.round(UI.zoom * 100) : null;
    nm.textContent = d.name + (zoom ? ` @ ${zoom}%` : '') + (d.dirty ? ' *' : '');
    t.title = d.name + (d.host ? '' : L3('（暫存分頁：關閉前請另存）', '（临时分页：关闭前请另存）', ' (temporary tab: save a copy before closing)'));
    const x = document.createElement('span'); x.className = 'x'; x.textContent = '×'; x.title = L3('關閉', '关闭', 'Close'); x.style.cssText = 'opacity:.7;cursor:pointer;padding:0 2px';
    x.onclick = e => { e.stopPropagation(); CMD.run('ps.document.close', {document:d.index, ui:true}); };
    t.onclick = () => { if (d.index !== Docs.cur) CMD.run('ps.document.activate', {document:d.index}); };
    // 拖图层／移动工具拖内容停在标签上 ⇒ 切到那份（PS）
    t.addEventListener('dragover', e => { if (!Docs.drag) return; e.preventDefault(); hoverTab(d.index); });
    t.addEventListener('dragleave', () => { clearTimeout(Docs._hoverT); Docs._hoverI = -1; });
    t.addEventListener('drop', e => { if (!Docs.drag) return; e.preventDefault(); e.stopPropagation(); if (d.index !== Docs.cur) activate(d.index); dropPayload(null, e.shiftKey); });
    t.appendChild(nm); t.appendChild(x); bar.appendChild(t);
  });
};
function hoverTab(i){
  if (i === Docs.cur || Docs._hoverI === i) return;
  Docs._hoverI = i; clearTimeout(Docs._hoverT);
  Docs._hoverT = setTimeout(() => { Docs._hoverI = -1; if (Docs.drag) activate(i); }, 350);
}

/* ── 把图层（连组的子孙）复制一份带走 ── */
function payloadOf(ids, grab){
  const set = new Set();
  ids.forEach(id => { const L = Doc.byId(id); if (!L) return; set.add(L.id); if (L.kind === 'group' && window.Groups) Groups.descendants(L).forEach(c => set.add(c.id)); });
  const block = Doc.layers.filter(L => set.has(L.id) && !L._sigSkip);
  if (!block.length) return null;
  const inner = Smart.cloneLayers(block);
  // 内容外框（来源文件坐标）：照 Smart.fromLayer 的量法——这几层单独合成一次
  const e = {type:'layers', w:Doc.width, h:Doc.height, layers:Smart.cloneLayers(block)};
  e.layers.forEach(C => { C.visible = true; });
  let rect = [0, 0, Doc.width, Doc.height];
  try {
    const full = Smart.withSubDoc(e, () => compositeBase(1)), d = full.getContext('2d').getImageData(0, 0, full.width, full.height).data, W = full.width;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let i = 3, k = 0; i < d.length; i += 4, k++) if (d[i]){ const x = k % W, y = (k / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 >= 0) rect = [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
  } catch (err){ console.error(err); }
  return {layers:inner, rect, from:Docs.activeId(), grab:grab || null, srcSize:[Doc.width, Doc.height]};
}
/* 放进目前这份（一步历史）：at＝落点（文件坐标）；没给＝置中（PS：拖到分页标签上放＝置中）；same＝照原座标（Shift） */
function placePayload(P, at, same){
  const [x0, y0, w, h] = P.rect;
  let dx, dy;
  if (same){ dx = 0; dy = 0; }
  else if (at && P.grab){ dx = Math.round(at[0] - P.grab[0]); dy = Math.round(at[1] - P.grab[1]); }
  else if (at){ dx = Math.round(at[0] - (x0 + w / 2)); dy = Math.round(at[1] - (y0 + h / 2)); }
  else { dx = Math.round((Doc.width - w) / 2 - x0); dy = Math.round((Doc.height - h) / 2 - y0); }
  const fresh = Smart.cloneLayers(P.layers), remap = new Map();
  fresh.forEach(C => { const n = uid('L'); remap.set(C.id, n); C.id = n; });
  fresh.forEach(C => {
    if (C.parent) C.parent = remap.has(C.parent) ? remap.get(C.parent) : null;
    if (!C.parent) delete C.parent;
    delete C.isBackground; if (C.locks){ C.locks = Object.assign({}, C.locks, {position:false, all:false}); }
    if (C.kind !== 'group'){ C.x = (C.x || 0) + dx; C.y = (C.y || 0) + dy; }
    if (C.mask && C.kind !== 'raster'){ C.mask.x = (C.mask.x || 0) + dx; C.mask.y = (C.mask.y || 0) + dy; }
    if (C.name && /^(背景|Background)$/.test(C.name)) C.name = Lang.t('layer.untitled') + ' 0';
    Layer.invalidate(C);
  });
  const at0 = Doc.activeId ? Doc.index(Doc.activeId) + 1 : Doc.layers.length;
  Doc.layers.splice(at0, 0, ...fresh);
  Doc.activeId = fresh[fresh.length - 1].id;
  return {layers:fresh.map(C => C.id), offset:[dx, dy]};
}
function dropPayload(at, same){
  const P = Docs.drag; Docs.drag = null; clearTimeout(Docs._hoverT);
  if (!P || P.from === Docs.activeId()) return null;
  Docs._payload = P;
  const r = CMD.run('ps.document.dropLayers', {at:at || undefined, same:!!same});
  Docs._payload = null;
  return r;
}

/* ── 智能对象「编辑内容」＝开成新分页（smart_cmds.rs:592 edit_contents） ── */
function openChild(L){
  const e = Smart.sourceOf(L);
  if (!Smart.available(e)) return fail("the smart object's contents are unavailable");
  const parent = Docs.activeId(), name = e.name;
  return newTab(() => {
    let layers;
    if (e.type === 'layers') layers = Smart.cloneLayers(e.layers);
    else { const R = Layer.raster(e.name.replace(/\.[^.]*$/, ''), e.w, e.h); R.data.ctx.drawImage(e.image, 0, 0); layers = [R]; }
    Smart._opening = true;
    try { Doc.reset(e.w, e.h, null, false); } finally { Smart._opening = false; }
    const remap = new Map(); layers.forEach(C => { const n = uid('L'); remap.set(C.id, n); C.id = n; });
    layers.forEach(C => { if (C.parent && remap.has(C.parent)) C.parent = remap.get(C.parent); });
    Doc.layers.push(...layers); Doc.activeId = layers.length ? layers[layers.length - 1].id : null;
    const st = St(); if (st){ st.name = String(name).replace(/\.[^.]*$/, ''); st.ext = null; st.savedSnap = null; }
    if (window.PsFile) PsFile.markSaved();
    Smart.session = {layerId:L.id, entryId:e.id, name, layerName:L.name, docId:Docs.active().id, tab:true};
    if (window.UI){ UI.fit(); UI.refresh(); }
    return {editing:L.id, document:{width:Doc.width, height:Doc.height, layers:Doc.layers.length}};
  }, {child:{parent, layer:L.id}, name:String(name).replace(/\.[^.]*$/, '')});
}
/* commit_child：目前这份（子文件）写回母文件那层（母文件一步历史），子文件算存过；keepOpen＝留在子文件（Ctrl+S）；否则关掉子文件回母文件 */
function commitChild(keepOpen){
  const d = Docs.active(); if (!d || !d.child) return fail("this document isn't smart object contents");
  const pi = Docs.indexOf(d.child.parent); if (pi < 0) return fail("the smart object's document was closed");
  const stem = String(d.name || 'contents').replace(/\.[^.]*$/, '');
  const entry = SmartStore.put({type:'layers', name:stem + '.dlcanvas', w:Doc.width, h:Doc.height, layers:Smart.cloneLayers(Doc.layers.filter(X => !X._sigSkip))});
  const shift = d.child.shift || null;
  if (window.PsFile) PsFile.markSaved();
  const ci = Docs.cur;
  activate(pi);
  const L = Doc.byId(d.child.layer);
  if (!L || L.kind !== 'smart'){ activate(Docs.indexOf(d.id)); return fail('the smart object layer is gone'); }
  History.push();
  L.data.source = {id:entry.id, name:entry.name, type:entry.type};
  if (shift && L.data.transform){                                  // 内容画布用「画布大小」改过、内容挪了 ⇒ 平移往回补（外面原来的部分不动、比例不变）
    const t = L.data.transform, [sx, sy] = shift;
    L.data.transform = [t[0], t[1], t[2], t[3], t[4] - (t[0] * sx + t[2] * sy), t[5] - (t[1] * sx + t[3] * sy)];
  }
  d.child.shift = null;
  Layer.invalidate(L);
  if (window.UI) UI.refresh();
  SiteHooks.check('layer.smartObjects.saveContents');
  if (keepOpen){ activate(Docs.indexOf(d.id)); return {ok:true, updated:true, layer:L.id, source:entry.id, open:true}; }
  // 关掉子文件：它已经不在前面（state 收着）⇒ 直接拿掉
  const k = Docs.indexOf(d.id); if (k >= 0){ Docs.list.splice(k, 1); if (Docs.cur > k) Docs.cur--; }
  Docs.render(); fire();
  return {ok:true, updated:true, layer:L.id, source:entry.id};
}
Docs.saveChild = () => commitChild(true);
function discardChild(){
  const d = Docs.active(); if (!d || !d.child) return fail("this document isn't smart object contents");
  const pi = Docs.indexOf(d.child.parent);
  Docs.list.splice(Docs.cur, 1);
  Docs.cur = pi >= 0 ? (pi > Docs.cur ? pi - 1 : pi) : Math.min(Docs.cur, Docs.list.length - 1);
  apply(Docs.active()); Docs.render(); fire();
  return {ok:true, updated:false, layer:d.child.layer, source:null};
}

/* ── 关闭一份（问要不要存：照 ps-file 的对话框；子文件：存储＝写回母文件） ── */
async function closeDoc(i, ui, save){
  if (!(i >= 0 && i < Docs.list.length)) return fail('no document ' + i);
  if (i !== Docs.cur){ const r = activate(i); if (r.ok === false) return r; }
  const d = Docs.active();
  if (Docs.list.length === 1 || d.host){
    // 只剩这一份或宿主那份：照原本（换成空白新文件；宿主那份不能真的拿掉）
    const c = CMD.map['ps.file.close'];
    return c ? c.run({ui, save, _single:true}) : fail('no close command');
  }
  if (d.child){
    const dirty = window.PsFile && PsFile.isDirty();
    if (ui && dirty){
      if (!await PsFile.confirmDiscard('close')) return {ok:false, cancelled:true};
      if (Docs.active() !== d) return {ok:true, closed:1};           // 「存储」已经写回并关掉
    }
    else if (dirty && save !== false) return Object.assign(commitChild(false), {closed:1});   // on_close：改过的子文件关掉时自动写回
    return Object.assign(discardChild(), {closed:1});
  }
  if (ui){ if (!await PsFile.confirmDiscard('close')) return {ok:false, cancelled:true}; }
  else if (save === true){ const r = await CMD.run('ps.file.save', {}); if (r && r.ok === false) return r; }
  if (Docs.active() !== d) return {ok:true, closed:1};
  dropCurrent();
  return {ok:true, closed:1};
}

/* ── 新建（PS：开新文件对话框） ── */
function newDialog(){
  return new Promise(res => {
    const bg = document.createElement('div'); bg.id = 'docNewDlg';
    bg.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font:13px sans-serif';
    const box = document.createElement('div'); box.style.cssText = 'background:#2b2b2b;color:#ddd;padding:14px 16px;border-radius:6px;min-width:280px;box-shadow:0 6px 30px rgba(0,0,0,.5)';
    const st = St(), nm = L3('未命名-', '未标题-', 'Untitled-') + ((st && st.untitled || 0) + 1);
    box.innerHTML = `<div style="font-weight:600;margin-bottom:10px">${L3('開新檔案', '新建文档', 'New Document')}</div>
      <label style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="width:70px">${L3('名稱', '名称', 'Name')}</span><input data-k="name" value="${nm}" style="flex:1"></label>
      <label style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="width:70px">${L3('寬度', '宽度', 'Width')}</span><input data-k="width" type="number" min="1" max="30000" value="${Doc.width}" style="width:90px"> px</label>
      <label style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="width:70px">${L3('高度', '高度', 'Height')}</span><input data-k="height" type="number" min="1" max="30000" value="${Doc.height}" style="width:90px"> px</label>
      <label style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="width:70px">${L3('背景內容', '背景内容', 'Background')}</span><select data-k="background">
        <option value="#ffffff">${L3('白色', '白色', 'White')}</option><option value="bg">${L3('背景色', '背景色', 'Background Color')}</option><option value="transparent">${L3('透明', '透明', 'Transparent')}</option></select></label>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button data-act="cancel">${L3('取消', '取消', 'Cancel')}</button><button data-act="ok" style="font-weight:600">${L3('建立', '创建', 'Create')}</button></div>`;
    bg.appendChild(box); document.body.appendChild(bg);
    const q = k => box.querySelector(`[data-k="${k}"]`);
    const done = v => { bg.remove(); res(v); };
    box.querySelector('[data-act="cancel"]').onclick = () => done(null);
    box.querySelector('[data-act="ok"]').onclick = () => {
      const b = q('background').value, sc = document.getElementById('strokeColor');
      done({name:q('name').value, width:+q('width').value || 1, height:+q('height').value || 1, background:b === 'transparent' ? null : b === 'bg' ? (sc ? sc.value : '#ffffff') : b});
    };
    box.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); box.querySelector('[data-act="ok"]').click(); } else if (e.key === 'Escape') done(null); e.stopPropagation(); });
    q('width').focus();
  });
}
async function newDoc(p){
  let v = p;
  if (p.ui){ v = await newDialog(); if (!v) return {ok:false, cancelled:true}; }
  const w = Math.max(1, Math.min(30000, Math.round(+v.width || 1200))), h = Math.max(1, Math.min(30000, Math.round(+v.height || 675)));
  return newTab(() => {
    CMD.run('file.new', {width:w, height:h, background:v.background === undefined ? '#ffffff' : v.background});
    if (v.name){ const st = St(); if (st) st.name = String(v.name); }
    if (window.PsFile) PsFile.markSaved();
    History.clear();
    return {width:Doc.width, height:Doc.height};
  });
}
/* 打开（PS：每个档各开一个分页）：files（界面挑的）或 url／urls（agent） */
async function openDocs(p){
  let items = [];
  if (Array.isArray(p.files) && p.files.length) items = p.files.map((f, i) => ({files:[f], handle:Array.isArray(p.handles) ? p.handles[i] : undefined}));
  else if (p.ui && typeof window.showOpenFilePicker === 'function' && window.PsFile && PsFile.fsaOK && PsFile.fsaOK() && !PsFile._pickHook){
    // 照 PS：浏览器有 File System Access ⇒ 用系统开档拿档案句柄，之后「存储」直接写回原档（ps-file.js saveInPlace）
    let hs = [];
    try { hs = await window.showOpenFilePicker({multiple:true, types:[{description:L3('影像／PSD／工程檔／Krita／GIMP／Procreate', '图像／PSD／工程档／Krita／GIMP／Procreate', 'Images / PSD / Projects / Krita / GIMP / Procreate'),
      accept:{'image/*':['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff'], 'image/vnd.adobe.photoshop':['.psd', '.psb'], 'application/pdf':['.pdf', '.ai'], 'image/svg+xml':['.svg', '.svgz'], 'application/octet-stream':['.kra', '.ora', '.xcf', '.procreate'], 'application/json':['.dlcanvas', '.json']}}]}); }
    catch (e){ if (!(e && e.name === 'AbortError')) console.error(e); hs = []; }
    for (const h of hs) items.push({files:[await h.getFile()], handle:h});
  }
  else if (p.ui){ const fs =await (window.PsFile && PsFile.pickFiles ? PsFile.pickFiles('image/*,.dlcanvas,.psd,.psb,.json,.ai,.pdf,.svg,.svgz,.kra,.ora,.xcf,.procreate', true) : Promise.resolve([])); items = (fs || []).map(f => ({files:[f]})); }
  else if (Array.isArray(p.urls)) items = p.urls.map((u, i) => ({url:u, name:Array.isArray(p.names) ? p.names[i] : undefined}));
  else if (p.url) items = [{url:p.url, name:p.name}];
  if (!items.length) return {ok:false, cancelled:true};
  const out = [];
  for (const it of items){
    const {handle, ...arg} = it;
    const r = await newTab(async () => {
      const x = await CMD.run('ps.file.openAs', arg);
      if (x && x.ok === false) return x;
      if (window.PsFile) PsFile.markSaved();
      if (handle && window.PsFile && PsFile.setFileHandle) PsFile.setFileHandle(handle);
      History.clear();
      return x;
    });
    out.push(r);
  }
  return {ok:out.every(r => r.ok !== false), opened:out.filter(r => r.ok !== false).length, documents:out.map(r => r.document)};
}

/* ── 命令 ── */
const reg = (id, params, fn, undoable) => CMD.reg('ps.' + id, {i18n:'', params, undoable:!!undoable}, fn);
reg('document.list', '{} 打开着的文件（分页）：{active, documents:[{index, id, name, host, child, width, height, dirty}]}', () => Docs.info());
reg('document.activate', '{document:index|id} 切到那一份（点分页标签；原码 commands.rs:786 document.activate）→ {document, id}', p => {
  const i = typeof p.document === 'string' ? Docs.indexOf(p.document) : +p.document;
  return activate(i);
});
reg('document.new', '{width=1200, height=675, background="#ffffff"|null（透明）, name?} 开新文件（新分页，PS 档案 ▸ 新建）；ui:true＝开「新建文档」对话框 → {document, id}', p => newDoc(p || {}));
reg('document.open', '{url|urls:[…], name?|names?} 打开（每个档各开一个分页，PS 档案 ▸ 打开）；ui:true＝挑档 → {opened, documents}', p => openDocs(p || {}));
reg('document.close', '{document?:index|id（缺省＝目前）, save?:bool} 关闭一份（暂存分页：问要不要存，存＝下载工程档；智能对象内容：存＝写回母文件；宿主那份／最后一份＝换成空白新文件）→ {closed}', p => {
  p = p || {}; const i = p.document === undefined ? Docs.cur : typeof p.document === 'string' ? Docs.indexOf(p.document) : +p.document;
  return closeDoc(i, !!p.ui, p.save);
});
reg('document.dropLayers', '{at?:[x,y] 文件坐标（缺省＝置中）, same?:bool（照原座标）} 把拖过来的图层（Docs.drag／agent 用 ps.document.copyLayers）放进目前这份；一步历史 → {layers, offset}', p => {
  const P = Docs._payload; if (!P) return fail('nothing is being dragged');
  return Object.assign({ok:true}, placePayload(P, p.at, !!p.same));
}, true);
reg('document.copyLayers', '{ids?|layerId?（缺省＝选中的层／目前层）, to:index|id（目标分页）, at?:[x,y], same?:bool} 把图层复制到另一份文件（PS：把图层拖到别的分页标签上）；切到那一份 → {document, layers, offset}', p => {
  p = p || {};
  const ids = Array.isArray(p.ids) && p.ids.length ? p.ids : p.layerId ? [p.layerId] : (Array.isArray(Doc.selectedIds) && Doc.selectedIds.length ? Doc.selectedIds : [Doc.activeId]);
  const ti = typeof p.to === 'string' ? Docs.indexOf(p.to) : +p.to;
  if (!(ti >= 0 && ti < Docs.list.length) || ti === Docs.cur) return fail('`to` must be another open document');
  const P = payloadOf(ids); if (!P) return fail('no such layer');
  activate(ti);
  Docs._payload = P;
  const r = CMD.run('ps.document.dropLayers', {at:p.at, same:!!p.same});
  Docs._payload = null;
  return Object.assign({document:ti}, r);
});

/* ── 接到原有的命令上 ── */
function hookCommands(){
  // 档案 ▸ 关闭／关闭全部／关闭其它
  const c0 = CMD.map['ps.file.close'], ca = CMD.map['ps.file.closeAll'], co = CMD.map['ps.file.closeOthers'];
  if (c0 && !c0.__docs){ const run0 = c0.run; c0.run = function(p){ p = p || {}; if (p._single || Docs.list.length === 1) return run0.call(this, p); return closeDoc(Docs.cur, !!p.ui, p.save); }; c0.__docs = true; }
  if (ca && !ca.__docs){ const run0 = ca.run; ca.run = async function(p){ p = p || {};
    if (Docs.list.length === 1) return run0.call(this, p);
    let n = 0;
    for (let i = Docs.list.length - 1; i >= 0; i--){ if (Docs.list[i].host) continue; const r = await closeDoc(i, !!p.ui, p.save); if (r && r.cancelled) return r; n++; }
    const hi = Docs.list.findIndex(d => d.host); if (hi >= 0) activate(hi);
    const r = await run0.call(this, p); return Object.assign({}, r, {closed:(r && r.closed || 0) + n}); }; ca.__docs = true; }
  if (co && !co.__docs){ const run0 = co.run; co.run = async function(p){ p = p || {};
    if (Docs.list.length === 1) return run0.call(this, p);
    const keep = Docs.active(); let n = 0;
    for (let i = Docs.list.length - 1; i >= 0; i--){ const d = Docs.list[i]; if (d === keep || d.host) continue; const r = await closeDoc(i, !!p.ui, p.save); if (r && r.cancelled) return r; n++; }
    activate(Docs.list.indexOf(keep));
    return {ok:true, closed:n}; }; co.__docs = true; }
  // 智能对象「编辑内容」：开成新分页；完成＝写回并关、取消＝丢掉并关
  if (window.Smart && !Smart.__docs){
    Smart.beginSession = L => { const r = openChild(L); return r; };
    Smart.endSession = commit => (commit ? commitChild(false) : discardChild());
    Smart.dropSession = () => { Smart.session = null; Smart.banner(); };
    Smart.__docs = true;
  }
  // 画布大小（编辑内容的分页里）：记下内容挪了多少，写回时母文件那层的平移跟着补
  const cs = CMD.map['ps.image.canvasSize'];
  if (cs && !cs.__docs){ const run0 = cs.run; cs.run = function(p){ const r = run0.apply(this, arguments);
    const d = Docs.active(), off = r && Array.isArray(r.offset) ? r.offset : null;
    if (d && d.child && off && r.ok !== false){ const s = d.child.shift || [0, 0]; d.child.shift = [s[0] + off[0], s[1] + off[1]]; }
    return r; }; cs.__docs = true; }
  // 宿主：serialize 永远是宿主那份
  if (window.DilinCanvas && !DilinCanvas.__docs){
    const s0 = DilinCanvas.serialize, a0 = DilinCanvas.serializeAsync;
    const host = () => Docs.list.find(d => d.host);
    DilinCanvas.serialize = opts => { if (Docs.isHostActive()) return s0(opts); const h = host(); return h && h.hostJSON ? JSON.parse(JSON.stringify(h.hostJSON)) : s0(opts); };
    DilinCanvas.serializeAsync = async opts => { if (Docs.isHostActive()) return a0(opts); return DilinCanvas.serialize(opts); };
    DilinCanvas.documents = () => Docs.info();
    DilinCanvas.__docs = true;
  }
  // 菜单：档案 ▸ 新建／打开 ＝ 开新分页（PS）
  if (window.MenuTrees){
    MenuTrees.walk('ps', it => {
      if (it.id === 'file.new' && it.impl === 'file.new') it.impl = {cmd:'ps.document.new', params:{ui:true}};
      if (it.id === 'file.open' && it.impl === 'file.open') it.impl = {cmd:'ps.document.open', params:{ui:true}};
    });
  }
}

/* ── 图层面板拖曳：记下带走的层；放在画布上＝放进目前这份 ── */
document.addEventListener('dragstart', e => {
  const row = e.target && e.target.closest && e.target.closest('#layerList .lrow[data-id]');
  if (!row || Docs.list.length < 2) return;
  const id = row.dataset.id;
  const ids = Array.isArray(Doc.selectedIds) && Doc.selectedIds.includes(id) ? Doc.selectedIds.slice() : [id];
  Docs.drag = payloadOf(ids);
}, true);
document.addEventListener('dragend', () => { setTimeout(() => { Docs.drag = null; }, 0); }, true);
function canvasPt(e){ const r = UI.canvas.getBoundingClientRect(); return [(e.clientX - r.left) / UI.zoom, (e.clientY - r.top) / UI.zoom]; }
function bindCanvasDrop(){
  const w = document.getElementById('canvasWrap'); if (!w || w.__docs) return; w.__docs = true;
  w.addEventListener('dragover', e => { if (Docs.drag){ e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }, true);
  w.addEventListener('drop', e => {
    if (!Docs.drag) return;
    e.preventDefault(); e.stopPropagation();
    dropPayload(canvasPt(e), e.shiftKey);
  }, true);
}

/* ── 移动工具把画面内容拖到别的分页：按着拖到分页标签上停一下 ⇒ 来源那份不动、切过去；在画布上放开 ⇒ 放在放开的位置 ── */
let mv = null;                                                       // {payload, down}
window.addEventListener('pointerdown', e => {
  mv = null;
  if (Docs.list.length < 2 || !(window.Tools && Tools.current() && Tools.current().id === 'move') || e.target !== UI.canvas || e.button !== 0) return;
  const L = Doc.active(); if (!L) return;
  const pt = canvasPt(e);
  mv = {start:pt, hist:History.past.length, layerId:L.id, payload:null, switched:false};
}, true);
window.addEventListener('pointermove', e => {
  if (!mv || mv.switched) return;
  const el = document.elementFromPoint(e.clientX, e.clientY), tab = el && el.closest && el.closest('#docTabs .doctab');
  if (!tab){ clearTimeout(Docs._hoverT); Docs._hoverI = -1; return; }
  const i = +tab.dataset.index; if (i === Docs.cur) return;
  if (Docs._hoverI === i) return;
  Docs._hoverI = i; clearTimeout(Docs._hoverT);
  Docs._hoverT = setTimeout(() => {
    Docs._hoverI = -1; if (!mv || mv.switched) return;
    // 先让移动工具收尾（它会记一步移动），再撤回 ⇒ 来源那份不动；带走移动前那层
    try { Pointer.onUp(e, canvasPt(e)); } catch (err){}
    if (History.past.length > mv.hist) CMD.run('edit.undo');
    const P = payloadOf([mv.layerId], mv.start);
    mv.switched = true; activate(i);
    Docs.drag = P;
  }, 350);
}, true);
window.addEventListener('pointerup', e => {
  const m = mv; mv = null; clearTimeout(Docs._hoverT); Docs._hoverI = -1;
  if (!m || !m.switched || !Docs.drag) return;
  e.stopPropagation(); e.preventDefault();
  const r = UI.canvas.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (inside) dropPayload(canvasPt(e), e.shiftKey); else Docs.drag = null;
}, true);

/* ── 窗口 ▸ 排列：每份文件各一个浮动视窗（ps-window.js 的文件视窗看 Docs.view 画不在前面的那份） ── */
Docs.view = id => {                                                  // 不在前面的那份：收起时留的合成图
  const d = Docs.byId(id); if (!d || d === Docs.active()) return null;
  return d.thumb ? {canvas:d.thumb, width:d.w, height:d.h, name:d.name} : null;
};

/* ── 开始 ── */
function init(){
  if (Docs.list.length) return;
  const st = St();
  Docs.list.push({id:'D' + (++Docs.seq), host:true, state:null, name:st ? st.name : 'Untitled-1'});
  Docs.cur = 0;
  hookCommands(); bindCanvasDrop(); Docs.render();
  // 名字／改过的星号／缩放：命令跑完、视图变了就刷一下标签
  const run0 = CMD.run;
  if (!CMD.__docsTabs){ CMD.__docsTabs = true; CMD.run = function(){ const r = run0.apply(this, arguments); if (CMD._depth === 0) Docs._schedule(); return r; }; }
  window.addEventListener('wheel', () => Docs._schedule(), true);
}
Docs._schedule = () => { if (Docs._rt) return; Docs._rt = setTimeout(() => { Docs._rt = 0; Docs.render(); }, 60); };
if (document.readyState === 'complete') init(); else window.addEventListener('load', init);
})();
