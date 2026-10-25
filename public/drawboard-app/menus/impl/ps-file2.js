/* 堤麟画板 · Photoshop ▸ 文件／视图 其余各项的实作
   命令一律 ps.<原码 id>；{ui:true}（文件菜单）／{dialog:true}（视图菜单）＝开对话框（同点菜单）。
   对照源（photocraft/crates/…）：
     engine/src/comps_cmds.rs     343-375, 430-437  图层复合导出到文件（comps_to_files：<prefix>_<序号4位>_<复合名>.<格式>、selectedOnly、comps）
     engine/src/file_cmds.rs      49-56 has_adjustments；826-880 颜色查找表（bake_cube：单位格点＋可见的调整层合成、.cube 红最快）
                                  290-332 置入（place_bytes：scale/fit/center、Linked 来源）；569-660 批处理（parse_steps、batch_inputs、process_files、batch）
     engine/src/video_cmds.rs     292-345 渲染视频（render_video：每格设时间轴 current → 合成 → 图片序列／GIF）
     engine/src/automate_cmds.rs  275-350 创建快捷批处理（create_droplet：photocraftDroplet JSON＋shim）、run_droplet
     engine/src/notes_cmds.rs     150-195 导入注释（import_notes_from：别的档的注释接在后面、画布外的拉进来 w-16／h-20）
     engine/src/wia_cmds.rs       1-48    WIA 支持（只回装置清单，Windows 以外 available:false）
     engine/src/proof_sim.rs      80-100, 264-284, 310-318  32 位预览选项（HdrPreview：线性光里乘 2^曝光、再 1/γ；只给 32 位文件）
     engine/src/artboard_cmds.rs  283-300, 470-478  清除所选画板参考线（严格在画板框内的参考线）
   跟原码／PS 不同处（浏览器版）：
     · 没有档案系统 ⇒ 路径参数换成「挑档」（界面）或 url/urls/files/file_id（agent）；输出一律交给 file.exportPNG／file.exportData（🔴 网站版覆写这两条＝存进云盘），dir＝档名前加「资料夹/」。
     · 只有一份文件 ⇒ 批处理／快捷批处理每个档在「暂存文件」里跑（文件暂时换成那张图、跑完换回来，历史与改动事件都不受影响）。
     · 快捷批处理：PS 产出一支可执行档（把档拖上去就跑）；我们产出 .dldroplet（JSON：动作＋输出设定）——把它连同图片一起拖进画板＝跑，或用 ps.file.automate.runDroplet。
     · WIA：浏览器摸不到扫描仪 ⇒ 装置清单＝浏览器看得到的相机（getUserMedia）＋「影像档（扫描图／相片）」挑档；取得的图照 PS 开成文件（或置入成图层／只存进资料夹）。
     · 渲染视频：MediaRecorder 录成 WebM（PS 的 H.264 改 VP8/VP9）；或照原码出 PNG 图片序列。
     · 颜色查找表：.cube／.3dl／.csp 三种文字格式（ICC 描述档没做）；调整层的混合模式不算（只算不透明度）。
   🔴 改文件全走 CMD、一步历史（Ctrl+Z 可退）；坐标铁律：本档不直接写像素层画布（置入走智能对象的 transform）。 */
(function(){
'use strict';
if (window.PsFile2) return;                      // 防双载（测试 add_script_tag＋index.html 都挂时）

/* ═══════════ 小工具 ═══════════ */
const L3 = (hant, hans, en) => Lang.cur === 'en' ? en : Lang.cur === 'zh-Hans' ? hans : hant;
const T3 = a => Array.isArray(a) ? L3(a[0], a[1], a[2]) : String(a == null ? '' : a);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isNum = v => typeof v === 'number' && isFinite(v);
const num = (p, k, d) => (p && p[k] !== undefined && p[k] !== null && p[k] !== '' && isFinite(+p[k])) ? +p[k] : d;
const strp = (p, k, d) => (p && typeof p[k] === 'string' && p[k] !== '') ? p[k] : d;
const fail = error => ({ok:false, error});
const clone = v => JSON.parse(JSON.stringify(v));
const pad4 = i => String(i).padStart(4, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function mkCanvas(w, h){ const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
const ctx2d = c => c.getContext('2d', {willReadFrequently:true});
const fileName = n => String(n || '').split(/[?#]/)[0].split(/[\\/]/).pop();
const stem = n => { const s = fileName(n); const i = s.lastIndexOf('.'); return i > 0 ? s.slice(0, i) : s; };
const extOf = n => { const s = fileName(n); const i = s.lastIndexOf('.'); return i > 0 ? s.slice(i + 1).toLowerCase() : ''; };
/* file_cmds.rs:144 sanitize：档名安全 */
function sanitize(name){
  let s = Array.from(String(name || '')).map(c => /[\p{L}\p{N}\-_ .]/u.test(c) ? c : '_').join('');
  s = s.trim().replace(/^\.+|\.+$/g, '');
  return s || 'layer';
}
const dirPrefix = d => d ? String(d).replace(/[\\/]+$/, '') + '/' : '';
const docName = () => (window.PsFile && PsFile.state().name) || 'untitled';
const q12 = q => (clamp(q, 0, 12) / 12 * 99 + 1) / 100;            // Photoshop 0–12 → 0.01–1
function toast(msg, err){
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:50%;top:60px;transform:translateX(-50%);z-index:10001;color:#fff;padding:6px 14px;border-radius:4px;font:12px sans-serif;max-width:70vw;background:' + (err ? '#5a2a2a' : '#2a4a5a');
  d.dataset.pf2Toast = '1'; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 3500);
}
const refresh = () => { if (window.UI) UI.refresh(); };
const panelRefresh = id => { try { if (window.DlPanels && DlPanels.isOpen(id)) DlPanels.refresh(id); } catch(e){} };
function menuName(id){
  let hit = null; if (window.MenuTrees) MenuTrees.walk('ps', it => { if (!hit && it.id === id) hit = it; });
  return hit ? (hit.n[Lang.cur] || hit.n.en) : id;
}
/* 出口：🔴 一律经命令（网站版覆写 file.exportData／file.exportPNG 就进云盘） */
const sink = (name, data, mime) => CMD.run('file.exportData', {name, data, mime});
const exportPNG = (name, scale) => CMD.run('file.exportPNG', {scale:scale || 1, name});
function renderNow(scale){ return window.PsFile ? PsFile.renderDoc({scale:scale || 1}) : composite(scale || 1); }
async function encode(c, fmt, quality){
  if (!window.PsFile) throw new Error('needs menus/impl/ps-file.js');
  return PsFile.encodeAs(c, fmt, {quality});
}
const FORMATS = ['png', 'jpg', 'webp', 'tif', 'gif', 'png8', 'pdf'];
const normFmt = f => { f = String(f || 'png').toLowerCase().replace(/^\./, ''); return f === 'jpeg' ? 'jpg' : f === 'tiff' ? 'tif' : f; };
/* 产一份当前文件的档：png 走 file.exportPNG，其余编码后走 file.exportData → 档名 */
async function exportCurrent(base, fmt, quality, scale){
  fmt = normFmt(fmt);
  if (fmt === 'png' && (!scale || scale === 1)){ await exportPNG(base, 1); return base + '.png'; }
  const e = await encode(renderNow(scale), fmt, fmt === 'jpg' || fmt === 'pdf' ? q12(isNum(quality) ? quality : 10) : undefined);
  await sink(base + '.' + e.ext, e.blob);
  return base + '.' + e.ext;
}

/* ── 输入档：files（File[]）或 url／urls／input（网址、dataURL、blob:） → [{src, name}] ── */
function inputsOf(p){
  const out = [], names = Array.isArray(p.names) ? p.names : [];
  const add = s => { if (!s) return; const i = out.length;
    const n = names[i] || (s instanceof Blob ? (s.name || 'image ' + (i + 1)) : /^(data|blob):/.test(s) ? 'image ' + (i + 1) : decodeURIComponent(fileName(s)) || 'image ' + (i + 1));
    out.push({src:s, name:n}); };
  [p.files, p.urls, p.url, p.input].forEach(v => { if (Array.isArray(v)) v.forEach(add); else if (v) add(v); });
  return out;
}
const srcURL = s => s instanceof Blob ? URL.createObjectURL(s) : s;
function loadImage(src){
  return new Promise((res, rej) => {
    const url = srcURL(src), img = new Image();
    if (typeof src === 'string' && /^https?:/.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => { if (src instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 1000); res(img); };
    img.onerror = () => rej(new Error('load failed: ' + (src && src.name || String(src).slice(0, 80))));
    img.src = url;
  });
}
async function readText(src){ if (src instanceof Blob) return await src.text(); const r = await fetch(src); return await r.text(); }
function imageCanvas(img){ const c = mkCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height); ctx2d(c).drawImage(img, 0, 0); return c; }
function pickFiles(accept, multiple){
  if (PsFile2._pickHook) return Promise.resolve(PsFile2._pickHook(accept, multiple));   // 测试用
  return new Promise(res => {
    const inp = document.createElement('input'); inp.type = 'file'; if (accept) inp.accept = accept; inp.multiple = !!multiple; inp.style.display = 'none';
    let done = false; const fin = v => { if (done) return; done = true; inp.remove(); res(v); };
    inp.onchange = () => fin(Array.from(inp.files || []));
    inp.addEventListener('cancel', () => fin([]));
    document.body.appendChild(inp); inp.click();
  });
}

/* ═══════════ 对话框（DOM＋样式都在本档注入，不碰 style.css） ═══════════ */
(function injectCSS(){
  if (document.getElementById('pf2-css')) return;
  const st = document.createElement('style'); st.id = 'pf2-css';
  st.textContent = `
.pf2-bg{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:10000}
.pf2-dlg{background:#2b2f36;color:#e6e8eb;padding:14px 18px;border-radius:6px;min-width:320px;max-width:92vw;max-height:88vh;overflow:auto;font:13px sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)}
.pf2-dlg h3{margin:0 0 10px;font-size:14px}
.pf2-dlg .pf2-msg{margin:4px 0 10px;max-width:440px;line-height:1.5;color:#c8ccd2}
.pf2-sec{color:#8fb8e8;font-size:12px;margin:8px 0 2px;grid-column:1/-1;border-bottom:1px solid #3a404a}
.pf2-grid{display:grid;grid-template-columns:auto minmax(180px,250px);gap:7px 10px;align-items:center}
.pf2-grid>span{color:#aab0ba}
.pf2-grid input[type=number],.pf2-grid input[type=text],.pf2-grid select,.pf2-grid textarea{width:100%;box-sizing:border-box;background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:3px 6px;font:12px sans-serif}
.pf2-grid input[type=range]{width:100%}
.pf2-grid textarea{min-height:60px;font-family:monospace}
.pf2-files{display:flex;gap:6px;align-items:center}
.pf2-row{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.pf2-row button,.pf2-grid button{background:#3a404a;color:#e6e8eb;border:1px solid #555c68;border-radius:3px;padding:4px 14px;cursor:pointer}
.pf2-row button.pri{background:#2f7fd8;border-color:#2f7fd8;color:#fff}
.pf2-extra{margin-top:8px}
.pf2-extra video,.pf2-extra canvas{display:block;max-width:360px;max-height:240px;background:#111;border:1px solid #444a54}
.pf2-note{color:#8a919c;font-size:11px;margin-top:6px;max-width:440px;line-height:1.4}`;
  document.head.appendChild(st);
})();
/* o: {id（菜单原码 id，标题用）, cmd, title?, message?, fields:[{k, label:[繁,简,英], type:'number'|'text'|'textarea'|'check'|'select'|'files'|'range'|'sec', min,max,step,value, options:[[值,[繁,简,英]|字]], accept, multiple, when:vals=>bool}],
       note?, extra?(box, vals, api), okLabel?, onOK(vals) → 结果（{ok:false,error} 就留着对话框显示错误）, onCancel?(), onChange?(vals, k)} */
const Dlg = {
  cur:null,
  open(o){
    this.close(true);
    const bg = document.createElement('div'); bg.className = 'pf2-bg';
    const box = document.createElement('div'); box.className = 'pf2-dlg'; box.id = 'pf2Dlg'; box.dataset.cmd = o.cmd || ''; box.dataset.id = o.id || '';
    const h = document.createElement('h3'); h.textContent = o.title ? T3(o.title) : menuName(o.id); box.appendChild(h);
    if (o.message){ const m = document.createElement('div'); m.className = 'pf2-msg'; m.textContent = T3(o.message); box.appendChild(m); }
    const grid = document.createElement('div'); grid.className = 'pf2-grid'; box.appendChild(grid);
    const vals = {}, rows = [];
    (o.fields || []).forEach(f => {
      if (f.type === 'sec'){ const s = document.createElement('div'); s.className = 'pf2-sec'; s.textContent = T3(f.label); grid.appendChild(s); rows.push({f, els:[s]}); return; }
      vals[f.k] = f.value;
      const lab = document.createElement('span'); lab.textContent = f.label ? T3(f.label) : '';
      let inp;
      if (f.type === 'select'){
        inp = document.createElement('select');
        f.options.forEach(op => { const [v, l] = Array.isArray(op) ? op : [op, op]; const e = document.createElement('option'); e.value = v; e.textContent = T3(l); inp.appendChild(e); });
        inp.value = f.value; inp.onchange = () => { vals[f.k] = inp.value; this.changed(f.k); };
      } else if (f.type === 'textarea'){
        inp = document.createElement('textarea'); inp.value = f.value || ''; inp.oninput = () => { vals[f.k] = inp.value; this.changed(f.k); };
      } else if (f.type === 'files'){
        inp = document.createElement('div'); inp.className = 'pf2-files';
        const b = document.createElement('button'); b.type = 'button'; b.textContent = L3('選擇…', '选择…', 'Choose…'); b.dataset.k = f.k;
        const cnt = document.createElement('span'); cnt.dataset.cnt = f.k; cnt.textContent = '0';
        b.onclick = async () => { const fs = await pickFiles(f.accept, f.multiple !== false); if (fs.length){ vals[f.k] = fs; cnt.textContent = fs.length === 1 ? fs[0].name : String(fs.length); this.changed(f.k); } };
        inp.appendChild(b); inp.appendChild(cnt); vals[f.k] = f.value || [];
      } else {
        inp = document.createElement('input');
        inp.type = f.type === 'check' ? 'checkbox' : (f.type || 'number');
        if (f.type === 'check'){ inp.checked = !!f.value; inp.onchange = () => { vals[f.k] = inp.checked; this.changed(f.k); }; }
        else {
          if (f.min !== undefined) inp.min = f.min; if (f.max !== undefined) inp.max = f.max; if (inp.type === 'number' || inp.type === 'range') inp.step = f.step || 'any';
          inp.value = f.value === undefined || f.value === null ? '' : f.value;
          const rd = () => { vals[f.k] = inp.type === 'text' ? inp.value : (inp.value === '' ? null : +inp.value); this.changed(f.k); };
          inp.oninput = rd; inp.onchange = rd;
        }
      }
      inp.dataset.k = f.k;
      grid.appendChild(lab); grid.appendChild(inp); rows.push({f, els:[lab, inp], inp});
    });
    const extra = document.createElement('div'); extra.className = 'pf2-extra'; box.appendChild(extra);
    if (o.note){ const n = document.createElement('div'); n.className = 'pf2-note'; n.textContent = T3(o.note); box.appendChild(n); }
    const err = document.createElement('div'); err.className = 'pf2-note'; err.style.color = '#ff8a7a'; err.dataset.err = '1'; box.appendChild(err);
    const row = document.createElement('div'); row.className = 'pf2-row';
    const mk = (act, label, pri) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.act = act; b.textContent = T3(label); if (pri) b.className = 'pri'; b.onclick = () => this.click(act); row.appendChild(b); return b; };
    mk('cancel', ['取消', '取消', 'Cancel']);
    mk('ok', o.okLabel || ['確定', '确定', 'OK'], true);
    box.appendChild(row);
    bg.appendChild(box); document.body.appendChild(bg);
    box.addEventListener('keydown', e => {
      if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); this.click('cancel'); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA'){ e.preventDefault(); e.stopPropagation(); this.click('ok'); }
    });
    this.cur = {o, bg, box, vals, rows, extra, err, busy:false};
    if (o.extra) try { o.extra(extra, vals, this); } catch(e){ console.error(e); }
    this.layout();
    const first = box.querySelector('input,select,textarea'); if (first) first.focus(); else box.tabIndex = -1, box.focus();
    return this.cur;
  },
  layout(){ const c = this.cur; if (!c) return; c.rows.forEach(r => { const show = !r.f.when || r.f.when(c.vals); r.els.forEach(e => { e.style.display = show ? '' : 'none'; }); }); },
  changed(k){ const c = this.cur; if (!c) return; this.layout(); if (c.o.onChange) try { c.o.onChange(c.vals, k, this); } catch(e){ console.error(e); } },
  set(k, v){
    const c = this.cur; if (!c) return false; c.vals[k] = v;
    const r = c.rows.find(r => r.f.k === k);
    if (r && r.inp){ if (r.f.type === 'check') r.inp.checked = !!v; else if (r.f.type === 'files'){ const cnt = r.inp.querySelector('[data-cnt]'); if (cnt) cnt.textContent = String((v || []).length); } else r.inp.value = v === null || v === undefined ? '' : v; }
    this.changed(k); return true;
  },
  async click(act){
    const c = this.cur; if (!c || c.busy) return null;
    if (act === 'cancel'){ if (c.o.onCancel) try { c.o.onCancel(c.vals); } catch(e){ console.error(e); } this.close(); return {ok:false, cancelled:true}; }
    c.busy = true; c.err.textContent = '';
    let r;
    try { r = await c.o.onOK(Object.assign({}, c.vals)); }
    catch(e){ r = {ok:false, error:String(e && e.message || e)}; }
    c.busy = false;
    if (r && r.ok === false && !r.cancelled){ if (this.cur === c) c.err.textContent = r.error || 'failed'; toast(r.error || 'failed', true); return r; }
    if (this.cur === c) this.close();
    return r;
  },
  close(silent){ const c = this.cur; if (!c) return; this.cur = null; if (c.o.onClose) try { c.o.onClose(); } catch(e){} c.bg.remove(); void silent; }
};
const opened = () => ({ok:true, dialog:'opened'});

/* ═══════════ 命令登记 ═══════════ */
const UIP = ' · ui:true＝开对话框（同点菜单）';
/* opt.dialog(p)：ui／dialog 为 true 时开对话框；命令本身 undoable:false——会改文件的在函式里自己 History.push（非同步的要等载完才推） */
function reg(id, params, fn, opt){
  opt = opt || {};
  CMD.reg('ps.' + id, {i18n:'', params:params + (opt.dialog ? UIP : ''), undoable:false}, p => {
    p = p || {};
    if ((p.ui || p.dialog) && opt.dialog) return opt.dialog(p);
    try {
      const r = fn(p);
      return r && typeof r.then === 'function' ? r.catch(e => fail(String(e && e.message || e))) : r;
    } catch(e){ return fail(String(e && e.message || e)); }
  });
}
/* 暂时改了文件又会还原的活（套图层复合导出、逐格渲染）：期间不报改动事件、动作面板不录，做完把原来的图层物件放回去再还原内容 */
async function quiet(fn){
  const A = (window.PsWindow && PsWindow.actions) || null, playing0 = A ? A._playing : false;
  const snap = History.snap(), past = History.past.slice(), future = History.future.slice();
  const keep = {layers:Doc.layers, w:Doc.width, h:Doc.height, active:Doc.activeId, sel:Doc.sel, ids:Doc.selectedIds};
  SiteHooks._suspend++; if (A) A._playing = true;
  try { return await fn(snap); }
  finally {
    Doc.layers = keep.layers; Doc.width = keep.w; Doc.height = keep.h;
    History.restoreInPlace(snap); History.past = past; History.future = future;
    Doc.activeId = keep.active; Doc.sel = keep.sel; Doc.selectedIds = keep.ids;
    Doc.layers.forEach(L => Layer.invalidate(L));
    SiteHooks._suspend--; if (A) A._playing = playing0;
    refresh();
  }
}
/* 同步改文件：推一步历史，失败就退回 */
function step(fn){
  History.push(); let r;
  try { r = fn(); } catch(e){ History.restoreInPlace(History.past.pop()); throw e; }
  if (r && r.ok === false) History.restoreInPlace(History.past.pop());
  return r;
}

/* ═══════════ ① 图层复合导出到文件（comps_cmds.rs:343 comps_to_files） ═══════════ */
const Comps = () => (window.PsWindow && PsWindow.comps) || null;
async function layerCompsToFiles(p){
  const C = Comps(); if (!C || !CMD.map['ps.layerComp.new']) return fail('needs the Layer Comps panel (menus/impl/ps-window.js)');
  const list = C.get(); if (!list.length) return fail('the document has no layer comps (Window ▸ Layer Comps ▸ ＋)');
  const fmt = normFmt(p.format || 'png'); if (!FORMATS.includes(fmt)) return fail('format is ' + FORMATS.join('|'));
  const prefix = p.prefix === '' ? '' : strp(p, 'prefix', docName());
  let chosen;
  if (Array.isArray(p.comps)) chosen = p.comps.map(v => typeof v === 'string' ? list.findIndex(c => c.name === v) : +v).filter(i => list[i]);
  else if (p.selectedOnly){ const t = C.target(); chosen = t === null ? [] : [t]; }
  else chosen = list.map((_, i) => i);
  if (!chosen.length) return fail('no matching layer comps');
  const files = [];
  await quiet(async snap => {
    for (const i of chosen){
      const c = list[i];
      C.restore(c.state, c);                                     // apply_comp（不改「最后套用的」那个标记）
      const base = dirPrefix(p.dir) + (prefix ? sanitize(prefix) + '_' : '') + pad4(i) + '_' + sanitize(c.name);
      files.push(await exportCurrent(base, fmt, num(p, 'quality', 10)));
      History.restoreInPlace(snap);                              // 每个复合做完回到原样
    }
  });
  return {ok:true, files};
}
reg('file.export.layerCompsToFiles', '{format:"png|jpg|webp|tif|gif|png8|pdf"="png", prefix=文件名（""＝不加）, selectedOnly:bool=false（只导选中的／最后套用的那个）, comps?:[序号|名字], quality:0..12=10（jpg/pdf）, dir?（档名前加「资料夹/」）} 图层复合导出到文件：每个复合套上去拼合导出一档 <prefix>_<序号4位>_<复合名>，做完文件回到原样 → {files}', layerCompsToFiles, {dialog:() => {
  const C = Comps(); if (!C || !C.get().length){ toast(L3('文件沒有圖層構圖（視窗 ▸ 圖層構圖 ▸ ＋）', '文件没有图层复合（窗口 ▸ 图层复合 ▸ ＋）', 'The document has no layer comps (Window ▸ Layer Comps ▸ ＋)'), true); return fail('no layer comps'); }
  Dlg.open({id:'file.export.layerCompsToFiles', cmd:'ps.file.export.layerCompsToFiles', fields:[
    {k:'dir', type:'text', label:['目的地（資料夾）', '目标（文件夹）', 'Destination (folder)'], value:''},
    {k:'prefix', type:'text', label:['檔案名稱字首', '文件名前缀', 'File Name Prefix'], value:docName()},
    {k:'selectedOnly', type:'check', label:['僅限選取的圖層構圖', '仅限选中的图层复合', 'Selected Layer Comps Only'], value:false},
    {k:'format', type:'select', label:['檔案類型', '文件类型', 'File Type'], value:'png', options:[['png', 'PNG-24'], ['png8', 'PNG-8'], ['jpg', 'JPEG'], ['webp', 'WebP'], ['tif', 'TIFF'], ['gif', 'GIF'], ['pdf', 'PDF']]},
    {k:'quality', type:'number', label:['品質（0–12）', '品质（0–12）', 'Quality (0–12)'], value:10, min:0, max:12, step:1, when:v => v.format === 'jpg' || v.format === 'pdf'}
  ], okLabel:['執行', '运行', 'Run'], onOK:v => CMD.run('ps.file.export.layerCompsToFiles', v)});
  return opened();
}});

/* ═══════════ ② 颜色查找表（file_cmds.rs:826 bake_cube：格点×可见的顶层调整层 → 3D LUT） ═══════════ */
const adjLayers = () => Doc.layers.filter(L => L.visible && L.adjust && !L.parent);
function bakeLattice(n){
  n = clamp(Math.round(n), 2, 256);
  const N = n * n * n, px = new Float32Array(N * 4), s = 1 / (n - 1);
  for (let b = 0, i = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++, i++){ const j = i * 4; px[j] = r * s; px[j + 1] = g * s; px[j + 2] = b * s; px[j + 3] = 1; }   // 红最快
  for (const L of adjLayers()){
    let a; try { a = PsImage.fromParams(L.adjust.kind, L.adjust.params || {}, null); } catch(e){ continue; }
    const orig = px.slice(), k = clamp(L.opacity === undefined ? 1 : L.opacity, 0, 1);
    PsImage.applyAdjustment(a, px, n * n, 0, 0);
    if (k < 1) for (let i = 0; i < px.length; i++) if ((i & 3) !== 3) px[i] = orig[i] + (px[i] - orig[i]) * k;
  }
  for (let i = 0; i < px.length; i++) px[i] = clamp(px[i], 0, 1);
  return {n, px};
}
const lutAt = (L, r, g, b) => { const j = (r + L.n * (g + L.n * b)) * 4; return [L.px[j], L.px[j + 1], L.px[j + 2]]; };
function lutCube(L, title, copyright){
  let s = `TITLE "${String(title).replace(/"/g, "'")}"\n# Created by 堤麟画板\n` + (copyright ? `# Copyright: ${copyright}\n` : '') + `LUT_3D_SIZE ${L.n}\nDOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n`;
  const out = [];
  for (let b = 0; b < L.n; b++) for (let g = 0; g < L.n; g++) for (let r = 0; r < L.n; r++){ const v = lutAt(L, r, g, b); out.push(v.map(x => x.toFixed(6)).join(' ')); }
  return s + out.join('\n') + '\n';
}
/* Autodesk .3dl：第一行输入格点（0–1023），之后 12 位整数 R G B、蓝最快 */
function lut3dl(L, title, copyright){
  const head = [];
  for (let i = 0; i < L.n; i++) head.push(Math.round(i * 1023 / (L.n - 1)));
  const out = [`# ${title}`, '# Created by 堤麟画板'].concat(copyright ? [`# Copyright: ${copyright}`] : []).concat([head.join(' ')]);
  for (let r = 0; r < L.n; r++) for (let g = 0; g < L.n; g++) for (let b = 0; b < L.n; b++){ const v = lutAt(L, r, g, b); out.push(v.map(x => Math.round(x * 4095)).join(' ')); }
  return out.join('\n') + '\n';
}
/* Rising Sun .csp：三条恒等前置曲线＋3D 立方体（红最快） */
function lutCsp(L, title, copyright){
  const out = ['CSPLUTV100', '3D', '', 'BEGIN METADATA', title, copyright ? 'Copyright: ' + copyright : 'Created by 堤麟画板', 'END METADATA', ''];
  for (let c = 0; c < 3; c++) out.push('2', '0.0 1.0', '0.0 1.0', '');
  out.push(`${L.n} ${L.n} ${L.n}`);
  for (let b = 0; b < L.n; b++) for (let g = 0; g < L.n; g++) for (let r = 0; r < L.n; r++){ const v = lutAt(L, r, g, b); out.push(v.map(x => x.toFixed(6)).join(' ')); }
  return out.join('\n') + '\n';
}
const LUT_FMT = {cube:lutCube, '3dl':lut3dl, csp:lutCsp};
async function colorLookupTables(p){
  if (!window.PsImage || !PsImage.applyAdjustment) return fail('needs Image ▸ Adjustments (menus/impl/ps-image.js)');
  if (!adjLayers().length) return fail('the document has no visible adjustment layers to export');
  const size = clamp(Math.round(num(p, 'size', 33)), 2, 256);
  const title = strp(p, 'title', strp(p, 'description', docName())), copyright = strp(p, 'copyright', '');
  let formats = Array.isArray(p.formats) ? p.formats.map(f => String(f).toLowerCase().replace(/^\./, '')) : [String(p.format || 'cube').toLowerCase().replace(/^\./, '')];
  const unk = formats.find(f => !LUT_FMT[f]); if (unk) return fail(`format \`${unk}\` (cube|3dl|csp)`);
  formats = [...new Set(formats)]; if (!formats.length) return fail('choose at least one format');
  const L = bakeLattice(size), texts = {};
  formats.forEach(f => { texts[f] = LUT_FMT[f](L, title, copyright); });
  if (p.return) return {ok:true, size, cube:texts.cube, texts};
  const base = dirPrefix(p.dir) + sanitize(strp(p, 'name', title)), files = [];
  for (const f of formats){ const ext = p.uppercase ? f.toUpperCase() : f; await sink(base + '.' + ext, texts[f], 'text/plain'); files.push(base + '.' + ext); }
  return {ok:true, size, files};
}
reg('file.export.colorLookupTables', '{size:格点 2..256=33, title|description?=文件名, copyright?, formats:["cube","3dl","csp"]=["cube"]（或 format）, name?（档名）, dir?, uppercase:bool=false（扩展名大写）, return:bool（只回文字不存档）} 颜色查找表：文件里可见的顶层调整层（按不透明度，不算混合模式）烤成 3D LUT（.cube 红最快、0–1；.3dl 12 位；.csp）→ {size, files}|{cube, texts}', colorLookupTables, {dialog:() => {
  if (!adjLayers().length){ toast(L3('文件沒有可見的調整圖層可轉存', '文件没有可见的调整图层可导出', 'The document has no visible adjustment layers to export'), true); return fail('no adjustment layers'); }
  Dlg.open({id:'file.export.colorLookupTables', cmd:'ps.file.export.colorLookupTables', fields:[
    {k:'description', type:'text', label:['說明', '说明', 'Description'], value:docName()},
    {k:'copyright', type:'text', label:['版權', '版权', 'Copyright'], value:''},
    {k:'uppercase', type:'check', label:['副檔名使用大寫', '文件扩展名使用大写', 'Use uppercase file extensions'], value:false},
    {type:'sec', label:['品質', '品质', 'Quality']},
    {k:'size', type:'select', label:['格點', '网格点', 'Grid Points'], value:'33', options:[['8', ['8（差）', '8（差）', '8 (Poor)']], ['16', ['16（低）', '16（低）', '16 (Low)']], ['32', ['32（中）', '32（中）', '32 (Medium)']], ['33', ['33（高）', '33（高）', '33 (High)']], ['64', ['64（最高）', '64（最高）', '64 (Maximum)']]]},
    {type:'sec', label:['格式', '格式', 'Formats']},
    {k:'f3dl', type:'check', label:['3DL', '3DL', '3DL'], value:true},
    {k:'fcube', type:'check', label:['CUBE', 'CUBE', 'CUBE'], value:true},
    {k:'fcsp', type:'check', label:['CSP', 'CSP', 'CSP'], value:true}
  ], note:['ICC 描述檔格式沒有做（瀏覽器版只出文字格式的查詢表）。', 'ICC 描述文件格式没有做（浏览器版只出文字格式的查找表）。', 'ICC Profile format is not available (text LUT formats only).'],
  onOK:v => CMD.run('ps.file.export.colorLookupTables', {description:v.description, copyright:v.copyright, uppercase:v.uppercase, size:+v.size,
    formats:[v.f3dl && '3dl', v.fcube && 'cube', v.fcsp && 'csp'].filter(Boolean)})});
  return opened();
}});

/* ═══════════ ③ 渲染视频（video_cmds.rs:292 render_video：每格设时间轴 current → 合成；我们用 MediaRecorder 录 WebM，或出 PNG 序列） ═══════════ */
function pickMime(){
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) if (MediaRecorder.isTypeSupported(m)) return m;
  return null;
}
async function renderVideo(p){
  const tl = Doc.timeline || null;
  const fmt = String(p.format || 'webm').toLowerCase();
  if (!['webm', 'png'].includes(fmt)) return fail('format is webm|png (image sequence)');
  const fps = clamp(num(p, 'fps', tl ? tl.fps : 30), 1, 120);
  const scale = clamp(num(p, 'scale', 100), 1, 400) / 100;
  let a = 0, b = 0;                                                         // 影格范围 [a, b]（含）
  if (tl){
    const range = String(p.range || 'all');
    if (range === 'work'){ a = tl.workStart || 0; b = (tl.workEnd === undefined ? tl.duration : tl.workEnd) - 1; }
    else if (range === 'custom'){ a = Math.round(num(p, 'start', 0)); b = Math.round(num(p, 'end', tl.duration - 1)); }
    else { a = 0; b = tl.duration - 1; }
    a = clamp(a, 0, tl.duration - 1); b = clamp(b, a, tl.duration - 1);
  }
  const base = dirPrefix(p.dir) + sanitize(strp(p, 'name', docName()));
  const setFrame = f => { if (tl && CMD.map['ps.timeline.setFrame']) CMD.run('ps.timeline.setFrame', {frame:f}); };
  const n = b - a + 1;
  return quiet(async () => {                                              // 播放头逐格走：不报改动、做完回原位（历史快照带时间轴）
    if (fmt === 'png'){
      const files = [];
      for (let f = a; f <= b; f++){ setFrame(f); const nm = base + '_' + pad4(f); await exportPNG(nm, scale); files.push(nm + '.png'); }
      return {ok:true, frames:n, files};
    }
    const mime = pickMime(); if (!mime) return fail('this browser has no MediaRecorder for WebM; use format "png" (image sequence)');
    const first = renderNow(scale), W = first.width, H = first.height;
    const cv = mkCanvas(W, H), cx = cv.getContext('2d');
    const stream = cv.captureStream(0), track = stream.getVideoTracks()[0];
    const rec = new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond:clamp(num(p, 'bitrate', 8), 1, 100) * 1e6});
    const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(res => { rec.onstop = res; });
    rec.start();
    const dt = 1000 / fps;
    for (let f = a; f <= b; f++){
      setFrame(f);
      const c = f === a && !tl ? first : renderNow(scale);
      cx.clearRect(0, 0, W, H); cx.fillStyle = '#000'; cx.fillRect(0, 0, W, H); cx.drawImage(c, 0, 0, W, H);   // 视频没有透明：垫黑（PS 渲染 H.264 同）
      if (track.requestFrame) track.requestFrame();
      await sleep(Math.max(dt, n === 1 ? 120 : 0));
    }
    if (track.requestFrame) track.requestFrame();
    await sleep(Math.min(dt, 60));
    rec.stop(); await stopped; track.stop();
    const blob = new Blob(chunks, {type:'video/webm'});
    await sink(base + '.webm', blob, 'video/webm');
    return {ok:true, frames:n, file:base + '.webm', width:W, height:H, fps, bytes:blob.size, mime};
  });
}
reg('file.export.renderVideo', '{format:"webm|png"="webm"（png＝图片序列 <name>_NNNN.png）, name=文件名, dir?, fps=时间轴的（没有＝30）, scale:%=100, range:"all|work|custom"="all", start?/end?（custom，影格 0 起）, bitrate:Mbps=8} 渲染视频：有时间轴就每一格设播放头→合成→录进去；没有时间轴＝单帧 WebM（MediaRecorder：VP9/VP8，背景垫黑）；做完播放头回原位 → {frames, file|files, width, height}', renderVideo, {dialog:() => {
  const tl = Doc.timeline;
  Dlg.open({id:'file.export.renderVideo', cmd:'ps.file.export.renderVideo', fields:[
    {type:'sec', label:['位置', '位置', 'Location']},
    {k:'name', type:'text', label:['名稱', '名称', 'Name'], value:docName()},
    {k:'dir', type:'text', label:['資料夾', '文件夹', 'Folder'], value:''},
    {type:'sec', label:['格式', '格式', 'Format']},
    {k:'format', type:'select', label:['格式', '格式', 'Format'], value:'webm', options:[['webm', ['WebM 視訊（VP9／VP8）', 'WebM 视频（VP9／VP8）', 'WebM Video (VP9/VP8)']], ['png', ['Photoshop 影像序列（PNG）', 'Photoshop 图像序列（PNG）', 'Photoshop Image Sequence (PNG)']]]},
    {k:'scale', type:'number', label:['大小（%）', '大小（%）', 'Size (%)'], value:100, min:1, max:400, step:1},
    {k:'fps', type:'number', label:['影格速率（fps）', '帧速率（fps）', 'Frame Rate (fps)'], value:tl ? tl.fps : 30, min:1, max:120, step:1},
    {k:'bitrate', type:'number', label:['位元速率（Mbps）', '比特率（Mbps）', 'Bitrate (Mbps)'], value:8, min:1, max:100, step:1, when:v => v.format === 'webm'},
    {type:'sec', label:['範圍', '范围', 'Range']},
    {k:'range', type:'select', label:['範圍', '范围', 'Range'], value:'all', options:[['all', ['所有影格', '所有帧', 'All Frames']], ['work', ['工作區域', '工作区域', 'Work Area']], ['custom', ['開始／結束影格', '开始／结束帧', 'Start/End Frames']]], when:() => !!tl},
    {k:'start', type:'number', label:['開始影格', '开始帧', 'Start Frame'], value:0, min:0, step:1, when:v => !!tl && v.range === 'custom'},
    {k:'end', type:'number', label:['結束影格', '结束帧', 'End Frame'], value:tl ? tl.duration - 1 : 0, min:0, step:1, when:v => !!tl && v.range === 'custom'}
  ], note:tl ? null : ['文件沒有時間軸：演算成單一影格的視訊。', '文件没有时间轴：渲染成单帧视频。', 'No timeline: renders a single-frame video.'],
  okLabel:['演算', '渲染', 'Render'], onOK:v => CMD.run('ps.file.export.renderVideo', v)});
  return opened();
}});

/* ═══════════ ④ 置入链接的智能对象（file_cmds.rs:290 place_bytes，来源＝SmartSource::Linked） ═══════════ */
async function placeLinked(p){
  if (!window.Smart || !Layer.smart) return fail('needs smart objects (engine.js Smart)');
  let url = null, name = p.name || null, linked = null, note = null, revoke = null;
  if (p.file_id){
    const r = await Smart.resolve({file_id:p.file_id}); if (!r.url) return fail(r.error);
    url = r.url; linked = {file_id:String(p.file_id)}; name = name || String(p.file_id);
  } else {
    const it = inputsOf(p)[0]; if (!it) return fail('pass `url`, `file_id` or `files`');
    name = name || it.name;
    if (it.src instanceof Blob){
      const file = it.src instanceof File ? it.src : new File([it.src], name, {type:it.src.type || 'image/png'});
      const ans = await SiteHooks.askLocal(file, 'image');
      if (ans.handled) return {ok:true, handled:true, by:'host'};
      if (ans.fileId){ const fid = await Promise.resolve(ans.fileId).catch(() => null); if (fid) linked = {file_id:String(fid)}; }
      if (!linked) note = '没有网站宿主可链接（本机档浏览器只读得到一次）：内容改成嵌入';
      url = URL.createObjectURL(file); revoke = url;
    } else { url = String(it.src); linked = /^https?:/i.test(url) || /^\//.test(url) ? {url} : null; if (!linked) note = 'dataURL／blob 没有可回读的位置：内容改成嵌入'; }
  }
  let e;
  try { e = await Smart.imageEntry(url, fileName(name) || 'image.png', linked ? {linked} : undefined); }
  finally { if (revoke) URL.revokeObjectURL(revoke); }
  const cw = Doc.width, ch = Doc.height, w = e.w, h = e.h;
  const k = isNum(+p.scale) && p.scale !== undefined && p.scale !== null && p.scale !== '' ? Math.max(1e-4, +p.scale / 100)
    : (p.fit !== false && (w > cw || h > ch)) ? Math.min(cw / w, ch / h) : 1;
  const c = Array.isArray(p.center) && p.center.length === 2 ? [num({v:p.center[0]}, 'v', cw / 2), num({v:p.center[1]}, 'v', ch / 2)] : [cw / 2, ch / 2];
  const dx = Math.round(c[0] - w * k / 2), dy = Math.round(c[1] - h * k / 2);
  History.push();
  const S = Layer.smart(stem(name) || 'image', {source:{id:e.id, name:e.name, type:e.type}, transform:[k, 0, 0, k, dx, dy]});
  const at = Doc.activeId && Doc.index(Doc.activeId) >= 0 ? Doc.index(Doc.activeId) + 1 : Doc.layers.length;
  Doc.add(S, at); Doc.selectedIds = null; Layer.invalidate(S);
  refresh();
  const r = {ok:true, layer:S.id, id:S.id, scale:k * 100, bounds:[dx, dy, dx + w * k, dy + h * k], linked:e.linked ? clone(e.linked) : null};
  if (note) r.note = note;
  return r;
}
reg('file.placeLinked', '{url（http 网址＝链接）| file_id（云盘档，经宿主 resolveRef；存档只存引用）| files（本机档：宿主 onLocalFile 回 fileId 才能链接，否则改嵌入）, scale?:%（缺省：比画布大才缩进画布）, fit:bool=true, center?:[x,y]（缺省画布中心）, name?} 置入链接的智能对象：插在当前层之上（一步历史）；之后可用「更新修改的内容」重读 → {layer, scale, bounds, linked}', placeLinked, {dialog:async () => {
  const fs = await pickFiles('image/*', false); if (!fs.length) return {ok:false, cancelled:true};
  const r = await CMD.run('ps.file.placeLinked', {files:fs});
  if (r && r.note) toast(L3('沒有網站宿主可連結：內容改成嵌入', '没有网站宿主可链接：内容改成嵌入', 'No site host to link to: the contents were embedded'));
  return r;
}});

/* ═══════════ ⑤ 批处理（file_cmds.rs:569-660）＋ ⑥ 创建快捷批处理（automate_cmds.rs:275） ═══════════ */
const Act = () => (window.PsWindow && PsWindow.actions) || null;
const resolveCmd = id => CMD.map[id] ? id : CMD.map['ps.' + id] ? 'ps.' + id : null;
function parseSteps(v, cmd){
  if (!Array.isArray(v)) throw new Error(cmd + ': "steps" must be an array');
  return v.map(st => {
    if (Array.isArray(st) && st.length){ if (typeof st[0] !== 'string') throw new Error(cmd + ': step id must be a string'); return [st[0], st[1] || {}]; }
    if (st && typeof st === 'object'){ const id = st.command || st.id; if (typeof id !== 'string') throw new Error(cmd + ': step needs "command"'); return [id, st.params || {}]; }
    if (typeof st === 'string') return [st, {}];
    throw new Error(cmd + ': each step is [id, params] or {"command", "params"}');
  });
}
/* 动作：steps 直接给；或 action＝动作面板的序号／名字 → {name, steps} */
function actionOf(p, cmd){
  if (Array.isArray(p.steps)) return {name:strp(p, 'actionName', 'Action'), steps:parseSteps(p.steps, cmd)};
  if (p.action && typeof p.action === 'object' && !Array.isArray(p.action)) return {name:p.action.name || 'Action', steps:parseSteps(p.action.steps || [], cmd)};
  if (Array.isArray(p.action)) return {name:'Action', steps:parseSteps(p.action, cmd)};
  const A = Act(); if (!A) throw new Error(cmd + ': needs the Actions panel (menus/impl/ps-window.js) or pass "steps"');
  const i = typeof p.action === 'string' ? A.list.findIndex(a => a.name === p.action) : p.action !== undefined ? +p.action : A.selected;
  const a = A.list[i]; if (!a) throw new Error(cmd + ': no such action (record one in the Actions panel, or pass "steps")');
  return {name:a.name, steps:parseSteps(a.steps, cmd)};
}
function checkKnown(steps, cmd){ const u = steps.find(([id]) => !resolveCmd(id)); if (u) throw new Error(`${cmd}: unknown command \`${u[0]}\` in the action`); }
const SAME_EXT = {png:'png', jpg:'jpg', jpeg:'jpg', webp:'webp', tif:'tif', tiff:'tif', gif:'gif', bmp:'png'};
async function runSteps(steps){
  for (const [id, prm] of steps){
    let r; try { r = await CMD.run(resolveCmd(id), clone(prm || {})); } catch(e){ r = fail(String(e && e.message || e)); }
    if (r && r.ok === false) throw new Error(`${id}: ${r.error || 'failed'}`);
  }
}
/* 暂存文件：文件暂时换成这张图（一层「背景」），fn 跑完一律换回来——历史、改动事件、动作录制都不受影响（process_files 的 scratch session） */
async function withScratch(list, fn){
  return quiet(async snap => {
    for (const it of list){
      History.restoreInPlace(snap);                                  // 文件级的栏位（参考线、注释…）每张都从原样开始
      Doc.width = it.canvas.width; Doc.height = it.canvas.height; Doc.sel = null;
      const L = Layer.raster(L3('背景', '背景', 'Background'), it.canvas.width, it.canvas.height);
      L.data.ctx.drawImage(it.canvas, 0, 0);
      Doc.layers = [L]; Doc.activeId = L.id; Doc.selectedIds = null;
      await fn(it);
    }
  });
}
async function batch(p, cmd){
  cmd = cmd || 'ps.file.automate.batch';
  const act = actionOf(p, cmd); checkKnown(act.steps, cmd);
  if (p.source === 'opened'){                                       // 来源＝已打开的文件：动作套在目前这份上（每步一格历史，同动作面板 ▶）
    const A = Act(), playing0 = A ? A._playing : false; if (A) A._playing = true;
    try { await runSteps(act.steps); } catch(e){ return fail(String(e.message || e)); } finally { if (A) A._playing = playing0; }
    return {ok:true, files:[], errors:[], action:act.name, source:'opened'};
  }
  const items = inputsOf(p); if (!items.length) return fail(cmd + ': missing input (files / urls)');
  const format = String(p.format || 'same').toLowerCase(), dir = strp(p, 'dir', strp(p, 'output', 'batch')), suffix = strp(p, 'suffix', '');
  const naming = strp(p, 'naming', '{name}{suffix}'), stopOnError = p.errors !== 'log';
  const files = [], errors = [];
  const loaded = [];
  for (const it of items){
    try { loaded.push({it, canvas:imageCanvas(await loadImage(it.src))}); }
    catch(e){ errors.push({file:it.name, error:String(e.message || e)}); if (stopOnError) return {ok:false, error:`${it.name}: ${e.message || e}`, files, errors, stopped:true}; }
  }
  let stopped = false, serial = 0;
  await withScratch(loaded, async ({it}) => {
    if (stopped) return;
    serial++;
    try {
      await runSteps(act.steps);
      const ext = format === 'same' ? (SAME_EXT[extOf(it.name)] || 'png') : normFmt(format);
      if (!FORMATS.includes(ext)) throw new Error('format is same|' + FORMATS.join('|'));
      const nm = naming.replace('{name}', sanitize(stem(it.name))).replace('{suffix}', suffix).replace('{n}', String(serial).padStart(3, '0')).replace('{document}', sanitize(docName()));
      files.push(await exportCurrent(dirPrefix(dir) + nm, ext, num(p, 'quality', 10)));
    } catch(e){ errors.push({file:it.name, error:String(e.message || e)}); if (stopOnError) stopped = true; }
  });
  if (errors.length && !stopOnError){                                // 「将错误记录到文件」
    const log = errors.map(e => `${e.file}\t${e.error}`).join('\n') + '\n';
    await sink(dirPrefix(dir) + 'batch-errors.txt', log, 'text/plain');
  }
  const r = {ok:!stopped, files, errors, action:act.name};
  if (stopped){ r.stopped = true; r.error = `${errors[errors.length - 1].file}: ${errors[errors.length - 1].error}`; }
  return r;
}
const actOptions = () => { const A = Act(); return A && A.list.length ? A.list.map((a, i) => [String(i), a.name + ` (${a.steps.length})`]) : [['', ['（沒有動作：先在動作面板錄一個）', '（没有动作：先在动作面板录一个）', '(No actions: record one in the Actions panel)']]]; };
const SET_NAME = ['預設動作', '默认动作', 'Default Actions'];
const FMT_OPTS = [['same', ['跟原檔相同', '跟原文件相同', 'Same as source']], ['png', 'PNG'], ['jpg', 'JPEG'], ['webp', 'WebP'], ['tif', 'TIFF'], ['gif', 'GIF'], ['png8', 'PNG-8'], ['pdf', 'PDF']];
reg('file.automate.batch', '{action:动作面板序号|名字（缺省＝选中的）| steps:[[命令id,参数]…], source:"files|opened"="files"（opened＝套在目前这份文件）, files|urls（图片）, format:"same|png|jpg|webp|tif|gif|png8|pdf"="same", quality:0..12=10, dir="batch"（档名前的资料夹）, suffix?, naming:"{name}{suffix}"（还认 {n} 序号、{document}）, errors:"stop|log"="stop"（log＝继续做、最后出 batch-errors.txt）} 批处理：每张图在暂存文件里跑一遍动作、照格式交出一档；不动目前的文件与历史 → {files, errors}', p => batch(p), {dialog:() => {
  const A = Act(), sel = A && A.selected !== null && A.list[A.selected] ? String(A.selected) : (A && A.list.length ? '0' : '');
  Dlg.open({id:'file.automate.batch', cmd:'ps.file.automate.batch', fields:[
    {type:'sec', label:['播放', '播放', 'Play']},
    {k:'set', type:'select', label:['組合', '组', 'Set'], value:'default', options:[['default', SET_NAME]]},
    {k:'action', type:'select', label:['動作', '动作', 'Action'], value:sel, options:actOptions()},
    {type:'sec', label:['來源', '源', 'Source']},
    {k:'source', type:'select', label:['來源', '源', 'Source'], value:'files', options:[['files', ['檔案', '文件', 'Files']], ['opened', ['開啟的檔案', '打开的文件', 'Opened Files']]]},
    {k:'files', type:'files', label:['選擇…', '选择…', 'Choose…'], accept:'image/*', when:v => v.source === 'files'},
    {type:'sec', label:['目的地', '目标', 'Destination']},
    {k:'dir', type:'text', label:['資料夾', '文件夹', 'Folder'], value:'batch', when:v => v.source === 'files'},
    {k:'format', type:'select', label:['檔案類型', '文件类型', 'File Type'], value:'same', options:FMT_OPTS, when:v => v.source === 'files'},
    {k:'quality', type:'number', label:['品質（0–12）', '品质（0–12）', 'Quality (0–12)'], value:10, min:0, max:12, step:1, when:v => v.source === 'files' && (v.format === 'jpg' || v.format === 'pdf')},
    {k:'suffix', type:'text', label:['檔名字尾', '文件名后缀', 'File Name Suffix'], value:'', when:v => v.source === 'files'},
    {type:'sec', label:['錯誤', '错误', 'Errors']},
    {k:'errors', type:'select', label:['錯誤', '错误', 'Errors'], value:'stop', options:[['stop', ['錯誤時停止', '由于错误而停止', 'Stop for Errors']], ['log', ['將錯誤記錄到檔案', '将错误记录到文件', 'Log Errors to File']]]}
  ], okLabel:['確定', '确定', 'OK'], onOK:v => {
    if (v.action === '') return fail(L3('沒有動作可播放', '没有动作可播放', 'No action to play'));
    if (v.source === 'files' && (!v.files || !v.files.length)) return fail(L3('請先選擇檔案', '请先选择文件', 'Choose files first'));
    const q = {action:+v.action, source:v.source, errors:v.errors};
    if (v.source === 'files') Object.assign(q, {files:v.files, dir:v.dir, format:v.format, quality:v.quality, suffix:v.suffix});
    return CMD.run('ps.file.automate.batch', q);
  }});
  return opened();
}});

async function createDroplet(p){
  const cmd = 'ps.file.automate.createDroplet';
  const act = actionOf(p, cmd); checkKnown(act.steps, cmd);
  let name = strp(p, 'name', strp(p, 'path', act.name)); name = stem(name) || 'droplet';
  const options = {};
  ['dir', 'format', 'quality', 'suffix', 'naming', 'errors'].forEach(k => { if (p[k] !== undefined && p[k] !== null && p[k] !== '') options[k] = p[k]; });
  const droplet = {dilinDroplet:1, name, action:{name:act.name, steps:act.steps.map(([id, pr]) => [id, pr])}, options};
  const text = JSON.stringify(droplet, null, 2);
  if (p.return) return {ok:true, droplet};
  await sink(name + '.dldroplet', text, 'application/json');
  return {ok:true, file:name + '.dldroplet', steps:act.steps.length, droplet};
}
reg('file.automate.createDroplet', '{name（档名，不含扩展名）, action:序号|名字 | steps:[[id,参数]…], dir?, format?:"same|png|jpg|…", quality?, suffix?, naming?, errors?:"stop|log", return:bool（只回物件不存档）} 创建快捷批处理：把动作与输出设定存成 <name>.dldroplet（JSON；可再用 ps.file.automate.runDroplet，或连同图片拖进画板就跑）→ {file, steps, droplet}', createDroplet, {dialog:() => {
  const A = Act(), sel = A && A.selected !== null && A.list[A.selected] ? String(A.selected) : (A && A.list.length ? '0' : '');
  Dlg.open({id:'file.automate.createDroplet', cmd:'ps.file.automate.createDroplet', fields:[
    {type:'sec', label:['儲存快捷批次處理於', '将快捷批处理存储为', 'Save Droplet In']},
    {k:'name', type:'text', label:['名稱', '名称', 'Name'], value:A && A.list[+sel] ? A.list[+sel].name : 'Droplet'},
    {type:'sec', label:['播放', '播放', 'Play']},
    {k:'set', type:'select', label:['組合', '组', 'Set'], value:'default', options:[['default', SET_NAME]]},
    {k:'action', type:'select', label:['動作', '动作', 'Action'], value:sel, options:actOptions()},
    {type:'sec', label:['目的地', '目标', 'Destination']},
    {k:'dir', type:'text', label:['資料夾', '文件夹', 'Folder'], value:'droplet-output'},
    {k:'format', type:'select', label:['檔案類型', '文件类型', 'File Type'], value:'same', options:FMT_OPTS},
    {k:'suffix', type:'text', label:['檔名字尾', '文件名后缀', 'File Name Suffix'], value:''},
    {k:'errors', type:'select', label:['錯誤', '错误', 'Errors'], value:'stop', options:[['stop', ['錯誤時停止', '由于错误而停止', 'Stop for Errors']], ['log', ['將錯誤記錄到檔案', '将错误记录到文件', 'Log Errors to File']]]}
  ], note:['產出的 .dldroplet 連同影像一起拖進畫板就會執行（瀏覽器版沒有可執行檔）。', '产出的 .dldroplet 连同图像一起拖进画板就会运行（浏览器版没有可执行文件）。', 'Drop the .dldroplet together with images onto the canvas to run it (no executables in the browser).'],
  onOK:v => { if (v.action === '') return fail(L3('沒有動作', '没有动作', 'No action')); return CMD.run('ps.file.automate.createDroplet', {name:v.name, action:+v.action, dir:v.dir, format:v.format, suffix:v.suffix, errors:v.errors}); }});
  return opened();
}});
/* 跑快捷批处理（automate_cmds.rs:330 run_droplet） */
async function parseDroplet(p){
  let d = p.droplet;
  if (d instanceof Blob) d = JSON.parse(await d.text());
  else if (typeof d === 'string') d = /^\s*\{/.test(d) ? JSON.parse(d) : JSON.parse(await readText(d));
  if (!d || typeof d !== 'object' || !(d.dilinDroplet || d.photocraftDroplet)) throw new Error('not a droplet (.dldroplet)');
  if (!d.action || !Array.isArray(d.action.steps)) throw new Error('droplet has no action');
  return d;
}
reg('file.automate.runDroplet', '{droplet: .dldroplet 物件|JSON 文字|网址|File, files|urls（图片）, dir?（缺省＝快捷批处理里的，没有就 droplet-output）} 跑快捷批处理（＝把图拖到快捷批处理上）→ {files, errors}', async p => {
  const d = await parseDroplet(p), o = d.options || {};
  const q = Object.assign({}, o, {steps:d.action.steps, actionName:d.action.name || d.name, files:p.files, urls:p.urls, url:p.url, names:p.names});
  q.dir = strp(p, 'dir', o.dir || o.output || 'droplet-output');
  const r = await batch(q, 'ps.file.automate.runDroplet');
  return Object.assign({droplet:d.name}, r);
});
/* 把 .dldroplet 连同图片拖进画板＝跑（PS：把档拖到快捷批处理图示上）；只拦带 .dldroplet 的拖放，其余照旧 */
window.addEventListener('drop', e => {
  const fs = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
  const dr = fs.find(f => /\.(dldroplet|pcdroplet)$/i.test(f.name)); if (!dr) return;
  e.preventDefault(); e.stopPropagation();
  const imgs = fs.filter(f => f !== dr && /^image\//.test(f.type));
  (async () => {
    const files = imgs.length ? imgs : await pickFiles('image/*', true); if (!files.length) return;
    const r = await CMD.run('ps.file.automate.runDroplet', {droplet:dr, files});
    toast(r && r.ok !== false ? L3(`快捷批次處理完成：${r.files.length} 個檔案`, `快捷批处理完成：${r.files.length} 个文件`, `Droplet done: ${r.files.length} file(s)`) : (r && r.error) || 'failed', !(r && r.ok !== false));
  })();
}, true);

/* ═══════════ ⑦ 导入 ▸ 注释（notes_cmds.rs:167 import_notes_from） ═══════════ */
const pdfDate = () => 'D:' + new Date().toISOString().slice(0, 19).replace(/\D/g, '') + 'Z';
const hex2 = v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
/* PDF 字串（(…) 跳脱、八进位，或 <hex>；FE FF 开头＝UTF-16BE） */
function pdfString(raw){
  let bytes = [];
  if (raw[0] === '<'){ const h = raw.slice(1, -1).replace(/\s+/g, ''); for (let i = 0; i < h.length; i += 2) bytes.push(parseInt((h.slice(i, i + 2) + '0').slice(0, 2), 16)); }
  else {
    const s = raw.slice(1, -1);
    for (let i = 0; i < s.length; i++){
      const c = s[i];
      if (c !== '\\'){ bytes.push(s.charCodeAt(i) & 255); continue; }
      const n = s[++i];
      if (/[0-7]/.test(n)){ let o = n; while (o.length < 3 && /[0-7]/.test(s[i + 1])) o += s[++i]; bytes.push(parseInt(o, 8) & 255); }
      else if (n === 'n') bytes.push(10); else if (n === 'r') bytes.push(13); else if (n === 't') bytes.push(9); else if (n === 'b') bytes.push(8); else if (n === 'f') bytes.push(12);
      else if (n === '\r' || n === '\n'){ if (n === '\r' && s[i + 1] === '\n') i++; }
      else bytes.push(n.charCodeAt(0) & 255);
    }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff){ let o = ''; for (let i = 2; i + 1 < bytes.length; i += 2) o += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]); return o; }
  try { return new TextDecoder('utf-8', {fatal:true}).decode(new Uint8Array(bytes)); } catch(e){ return bytes.map(b => String.fromCharCode(b)).join(''); }
}
/* 一个 PDF 字典里某个键的字串值（括号要配对） */
function dictString(d, key){
  const m = new RegExp('/' + key + '\\s*([(<])').exec(d); if (!m) return null;
  let i = m.index + m[0].length - 1;
  if (d[i] === '<'){ const j = d.indexOf('>', i); return j > 0 ? pdfString(d.slice(i, j + 1)) : null; }
  let depth = 0, j = i;
  for (; j < d.length; j++){ const c = d[j]; if (c === '\\'){ j++; continue; } if (c === '(') depth++; else if (c === ')' && --depth === 0) break; }
  return pdfString(d.slice(i, j + 1));
}
const dictNums = (d, key) => { const m = new RegExp('/' + key + '\\s*\\[([^\\]]*)\\]').exec(d); return m ? m[1].trim().split(/\s+/).map(Number).filter(isFinite) : null; };
/* FDF／（没压缩的）PDF：/Subtype /Text 的注释；PDF 坐标（点、原点左下）→ 文件像素 */
function notesFromPdf(text){
  const out = [], k = Math.max(1, +Doc.dpi || 72) / 72, H = Doc.height;
  const re = /\/Subtype\s*\/Text\b/g; let m;
  while ((m = re.exec(text))){
    let a = -1, depth = 0;                                            // 往回找包住它的那层 <<（略过里面的子字典）
    for (let i = m.index - 1; i >= 1; i--){
      if (text[i] === '>' && text[i - 1] === '>'){ depth++; i--; }
      else if (text[i] === '<' && text[i - 1] === '<'){ if (depth === 0){ a = i - 1; break; } depth--; i--; }
    }
    if (a < 0) continue;
    depth = 0; let b = a;
    for (let i = a; i < text.length - 1; i++){ if (text[i] === '<' && text[i + 1] === '<'){ depth++; i++; } else if (text[i] === '>' && text[i + 1] === '>'){ depth--; i++; if (depth === 0){ b = i + 1; break; } } }
    const d = text.slice(a, b);
    const rect = dictNums(d, 'Rect') || [0, 0, 16, 20], col = dictNums(d, 'C');
    out.push({author:dictString(d, 'T') || '', text:dictString(d, 'Contents') || '', color:col && col.length >= 3 ? '#' + col.slice(0, 3).map(hex2).join('') : '#ffff82',
      position:[Math.min(rect[0], rect[2]) * k, H - Math.max(rect[1], rect[3]) * k], open:/\/Open\s*true/.test(d), modified:(dictString(d, 'M') || pdfDate())});
  }
  return out;
}
/* XFDF（XML）：<text rect="x1,y1,x2,y2" color="#rrggbb" title="作者"><contents>…</contents></text> */
function notesFromXfdf(text){
  const doc = new DOMParser().parseFromString(text, 'application/xml'), k = Math.max(1, +Doc.dpi || 72) / 72, H = Doc.height;
  return Array.from(doc.getElementsByTagName('text')).map(t => {
    const r = String(t.getAttribute('rect') || '0,0,16,20').split(',').map(Number), c = t.getElementsByTagName('contents')[0];
    return {author:t.getAttribute('title') || '', text:c ? c.textContent : '', color:/^#[0-9a-f]{6}$/i.test(t.getAttribute('color') || '') ? t.getAttribute('color').toLowerCase() : '#ffff82',
      position:[Math.min(r[0], r[2]) * k, H - Math.max(r[1], r[3]) * k], open:t.getAttribute('open') === 'yes', modified:t.getAttribute('date') || pdfDate()};
  });
}
function notesFromProject(json){
  if (!json || !Array.isArray(json.notes)) return [];
  return json.notes.filter(n => n && Array.isArray(n.position)).map(n => ({author:String(n.author || ''), text:String(n.text || ''), color:/^#[0-9a-f]{6}$/i.test(n.color || '') ? n.color : '#ffff82',
    position:[+n.position[0] || 0, +n.position[1] || 0], open:n.open !== false, modified:n.modified || pdfDate()}));
}
async function importNotes(p){
  let list = [], src = 'notes';
  if (p.project) list = notesFromProject(typeof p.project === 'string' ? JSON.parse(p.project) : p.project);
  else if (typeof p.xfdf === 'string') list = notesFromXfdf(p.xfdf);
  else if (typeof p.fdf === 'string') list = notesFromPdf(p.fdf);
  else {
    const it = inputsOf(p)[0]; if (!it) return fail('pass url/files (.dlcanvas, .pdf, .fdf, .xfdf), project, xfdf or fdf');
    src = it.name;
    const text = await readText(it.src), t = text.replace(/^﻿/, '').trimStart(), ext = extOf(it.name);
    if (t[0] === '{') list = notesFromProject(JSON.parse(t));
    else if (ext === 'xfdf' || /^<\?xml|^<xfdf/i.test(t)) list = notesFromXfdf(t);
    else list = notesFromPdf(text);
  }
  if (!list.length) return fail(`${src} has no notes`);
  const w = Doc.width, h = Doc.height;                              // 画布外的拉进来（notes_cmds.rs:178）
  list.forEach(n => { n.position = [clamp(n.position[0], 0, Math.max(0, w - 16)), clamp(n.position[1], 0, Math.max(0, h - 20))]; });
  History.push();
  Doc.notes = (Array.isArray(Doc.notes) ? Doc.notes : []).concat(list);
  if (window.PsWindow && PsWindow.notes) PsWindow.notes.sel = Doc.notes.length - list.length;
  panelRefresh('notes'); refresh();
  return {ok:true, imported:list.length, total:Doc.notes.length, notes:Doc.notes.map((n, i) => ({index:i, author:n.author, text:n.text, color:n.color, position:n.position.slice(), open:n.open}))};
}
reg('file.import.notes', '{url|files（.dlcanvas 工程档的注释、.xfdf、.fdf 或没压缩的 .pdf 的「文字注释」）| project:{.dlcanvas JSON} | xfdf:文字 | fdf:文字} 导入注释：接在目前的注释后面（PDF 点数按文件分辨率换成像素、原点换成左上；画布外的拉进来）一步历史 → {imported, total, notes}', importNotes, {dialog:async () => {
  const fs = await pickFiles('.dlcanvas,.json,.pdf,.fdf,.xfdf,application/pdf', false); if (!fs.length) return {ok:false, cancelled:true};
  const r = await CMD.run('ps.file.import.notes', {files:fs});
  if (r && r.ok === false) toast(r.error, true); else if (r){ toast(L3(`已讀入 ${r.imported} 個備忘稿`, `已导入 ${r.imported} 个注释`, `Imported ${r.imported} note(s)`)); if (window.DlPanels && !DlPanels.isOpen('notes') && CMD.map['panel.toggle']) CMD.run('panel.toggle', {id:'notes', on:true}); }
  return r;
}});

/* ═══════════ ⑧ 导入 ▸ WIA 支持（wia_cmds.rs：装置清单）——浏览器版：相机（getUserMedia）＋影像档 ═══════════ */
async function devices(){
  const out = [{id:'file', kind:'file', label:L3('影像檔（掃描圖／相片）', '图像文件（扫描图／照片）', 'Image Files (scans/photos)')}];
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices){
      const ds = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      ds.forEach((d, i) => out.push({id:d.deviceId || 'camera', kind:'camera', label:d.label || L3(`相機 ${i + 1}`, `相机 ${i + 1}`, `Camera ${i + 1}`)}));
    }
  } catch(e){}
  return out;
}
async function openCamera(deviceId){
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('this browser cannot reach cameras');
  const v = {width:{ideal:1920}, height:{ideal:1080}};
  if (deviceId && deviceId !== 'camera') v.deviceId = {exact:deviceId};
  const stream = await navigator.mediaDevices.getUserMedia({video:v, audio:false});
  const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) await new Promise(r => { video.onloadeddata = r; setTimeout(r, 1500); });
  return {video, stream, stop:() => stream.getTracks().forEach(t => t.stop())};
}
function grabFrame(video){ const c = mkCanvas(video.videoWidth || 640, video.videoHeight || 480); ctx2d(c).drawImage(video, 0, 0, c.width, c.height); return c; }
const stamp = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`; };
async function wia(p){
  if (p.list) { const ds = await devices(); return {ok:true, available:true, devices:ds, note:'WIA scanners are not reachable from a browser: cameras (getUserMedia) and image files instead'}; }
  const as = String(p.as || 'document');
  if (!['document', 'layer', 'folder'].includes(as)) return fail('as is document|layer|folder');
  let canvases = [], names = [];
  const items = inputsOf(p);
  if (items.length){ for (const it of items){ canvases.push(imageCanvas(await loadImage(it.src))); names.push(stem(it.name)); } }
  else if (p.device && p.device !== 'file'){
    const cam = await openCamera(p.device);
    try { await sleep(clamp(num(p, 'delay', 300), 0, 5000)); canvases.push(grabFrame(cam.video)); names.push('WIA ' + stamp()); } finally { cam.stop(); }
  } else return fail('pass url/urls/files, or device (a camera id from {list:true})');
  if (as === 'folder'){                                               // 只存进资料夹（PS 不勾「在 Photoshop 中开启」）
    const dir = dirPrefix(strp(p, 'folder', 'WIA')) + (p.uniqueSubfolder ? stamp() + '/' : ''), files = [];
    for (let i = 0; i < canvases.length; i++){ const b = await new Promise(r => canvases[i].toBlob(r, 'image/png')); const nm = dir + `IMG_${pad4(i + 1)}.png`; await sink(nm, b, 'image/png'); files.push(nm); }
    return {ok:true, acquired:canvases.length, files};
  }
  if (as === 'document'){                                             // 照 PS：开成文件（我们只有一份 ⇒ 换掉目前这份；多张＝第一张当文件、其余成层）
    const r = await CMD.run('ps.file.openAs', {url:canvases[0].toDataURL('image/png'), names:[names[0] + '.png']});
    if (r && r.ok === false) return r;
    if (canvases.length > 1){ History.push(); canvases.slice(1).forEach((c, i) => { const L = Layer.raster(names[i + 1], c.width, c.height); L.data.ctx.drawImage(c, 0, 0); Doc.add(L); }); refresh(); }
    return {ok:true, acquired:canvases.length, as, width:Doc.width, height:Doc.height};
  }
  History.push();                                                      // 置入成图层（一步历史）
  const ids = [];
  let at = Doc.activeId && Doc.index(Doc.activeId) >= 0 ? Doc.index(Doc.activeId) + 1 : Doc.layers.length;
  canvases.forEach((c, i) => { const L = Layer.raster(names[i], Doc.width, Doc.height); const k = Math.min(1, Doc.width / c.width, Doc.height / c.height), w = c.width * k, h = c.height * k;
    L.data.ctx.drawImage(c, Math.round((Doc.width - w) / 2), Math.round((Doc.height - h) / 2), Math.round(w), Math.round(h)); Doc.add(L, at++); ids.push(L.id); });
  refresh();
  return {ok:true, acquired:canvases.length, as, layers:ids};
}
reg('file.import.wiaSupport', '{list:true（只列装置）| device?:"file"|相机 deviceId|"camera"（缺省相机）, url|urls|files（直接给图＝扫描好的档）, as:"document|layer|folder"="document"（document＝照 PS 开成文件：换掉目前这份；layer＝置入成图层、缩进画布置中；folder＝只交档 IMG_NNNN.png）, folder="WIA", uniqueSubfolder:bool, delay:ms=300（相机暖机）} WIA 支持：浏览器摸不到扫描仪 ⇒ 从相机拍一张或挑影像档 → {acquired, …}', wia, {dialog:async () => {
  const ds = await devices();
  let cam = null;
  const stopCam = () => { if (cam){ cam.stop(); cam = null; } };
  const showPreview = async (box, id) => {
    stopCam(); box.innerHTML = '';
    const d = ds.find(x => x.id === id);
    if (!d || d.kind !== 'camera') return;
    try { cam = await openCamera(id); cam.video.dataset.wiaPreview = '1'; box.appendChild(cam.video); }
    catch(e){ const n = document.createElement('div'); n.className = 'pf2-note'; n.textContent = String(e.message || e); box.appendChild(n); }
  };
  let extraBox = null;
  Dlg.open({id:'file.import.wiaSupport', cmd:'ps.file.import.wiaSupport', fields:[
    {k:'device', type:'select', label:['裝置', '设备', 'Device'], value:ds[ds.length > 1 ? 1 : 0].id, options:ds.map(d => [d.id, d.label])},
    {type:'sec', label:['選項', '选项', 'Options']},
    {k:'as', type:'select', label:['取得後', '获取后', 'After Acquiring'], value:'document', options:[['document', ['在 Photoshop 中開啟取得的影像', '在 Photoshop 中打开获取的图像', 'Open Acquired Images in Photoshop']], ['layer', ['置入成新圖層', '置入为新图层', 'Place as New Layer']], ['folder', ['只存入目的地資料夾', '只存入目标文件夹', 'Save to Destination Folder Only']]]},
    {k:'folder', type:'text', label:['目的地資料夾', '目标文件夹', 'Destination Folder'], value:'WIA', when:v => v.as === 'folder'},
    {k:'uniqueSubfolder', type:'check', label:['唯一的子資料夾', '唯一的子文件夹', 'Unique Subfolder'], value:true, when:v => v.as === 'folder'}
  ], note:['瀏覽器碰不到 WIA 掃描器：裝置清單是瀏覽器看得到的相機，或選「影像檔」挑掃描好的檔案。', '浏览器碰不到 WIA 扫描仪：设备列表是浏览器看得到的相机，或选「图像文件」挑扫描好的文件。', 'Browsers cannot reach WIA scanners: the device list shows cameras, or choose “Image Files” to pick scanned files.'],
  okLabel:['開始', '开始', 'Start'],
  extra:(box, vals) => { extraBox = box; showPreview(box, vals.device); },
  onChange:(vals, k) => { if (k === 'device' && extraBox) showPreview(extraBox, vals.device); },
  onClose:stopCam,
  onOK:async v => {
    const q = {as:v.as, folder:v.folder, uniqueSubfolder:v.uniqueSubfolder};
    if (v.device === 'file' || !cam){
      const fs = await pickFiles('image/*', true); if (!fs.length) return {ok:false, cancelled:true};
      q.files = fs;
    } else q.url = grabFrame(cam.video).toDataURL('image/png'), q.names = ['WIA ' + stamp() + '.png'];
    if (v.as === 'document' && window.PsFile && !(await PsFile.confirmDiscard('close'))) return {ok:false, cancelled:true};
    return CMD.run('ps.file.import.wiaSupport', q);
  }});
  return opened();
}});

/* ═══════════ ⑨ 视图 ▸ 32 位预览选项（proof_sim.rs:80-100 HdrPreview、264 preview_32；只给 32 位文件） ═══════════ */
const HDR = {serial:-1, v:{method:'exposureGamma', exposure:0, gamma:1}, lut:null, key:''};
const hdrState = () => { if (HDR.serial !== Doc.serial){ HDR.serial = Doc.serial; HDR.v = {method:'exposureGamma', exposure:0, gamma:1}; } return HDR.v; };
const is32 = () => (+Doc.depth || 8) === 32;
const hdrIdentity = h => h.method === 'highlightCompression' || (h.exposure === 0 && h.gamma === 1);
const sdec = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const senc = v => { v = clamp(v, 0, 1); return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };
function hdrLut(h){
  const key = h.exposure + '|' + h.gamma; if (HDR.key === key && HDR.lut) return HDR.lut;
  const L = new Uint8ClampedArray(256), m = Math.pow(2, h.exposure);
  for (let i = 0; i < 256; i++) L[i] = Math.round(senc(Math.pow(Math.max(0, sdec(i / 255) * m), 1 / h.gamma)) * 255);   // HdrPreview::apply
  HDR.key = key; HDR.lut = L; return L;
}
function applyHdr(target){
  if (!is32()) return;
  const h = hdrState(); if (hdrIdentity(h)) return;
  const L = hdrLut(h), x = target.getContext('2d'), img = x.getImageData(0, 0, target.width, target.height), d = img.data;
  for (let i = 0; i < d.length; i += 4){ d[i] = L[d[i]]; d[i + 1] = L[d[i + 1]]; d[i + 2] = L[d[i + 2]]; }
  x.putImageData(img, 0, 0);
}
/* 接在 PsView.post 前面：先套 32 位预览、再校样、再画参考线（原码顺序：HDR 在显示转换之前） */
function hookView(){
  if (!window.PsView || PsView.__pf2Hdr || typeof PsView.post !== 'function') return !!(window.PsView && PsView.__pf2Hdr);
  PsView.__pf2Hdr = true;
  const post0 = PsView.post;
  PsView.post = function(target, s){ try { applyHdr(target); } catch(e){ console.error('[PsFile2] 32-bit preview', e); } return post0.apply(this, arguments); };
  return true;
}
if (!hookView()) setTimeout(hookView, 0);
const redraw = () => { if (window.UI){ if (UI.draw) UI.draw(); else UI.refresh(); } };
function preview32(p){
  if (!is32()) return fail('32-bit Preview Options is for 32-bit documents (Image ▸ Mode ▸ 32 Bits/Channel)');
  const h = hdrState();
  if (p.method !== undefined){
    const m = String(p.method);
    if (m === 'exposureGamma' || m === 'exposureAndGamma') h.method = 'exposureGamma';
    else if (m === 'highlightCompression') h.method = 'highlightCompression';
    else return fail(`method \`${m}\` (exposureGamma|highlightCompression)`);
  }
  if (isNum(+p.exposure) && p.exposure !== null && p.exposure !== '') h.exposure = clamp(+p.exposure, -20, 20);
  if (isNum(+p.gamma) && p.gamma !== null && p.gamma !== '') h.gamma = clamp(+p.gamma, 0.1, 9.99);
  redraw();
  return {ok:true, method:h.method, exposure:h.exposure, gamma:h.gamma};
}
CMD.reg('ps.view.thirtyTwoBitPreviewOptions', {i18n:'', undoable:false, params:'{method:"exposureGamma|highlightCompression"="exposureGamma", exposure:-20..20=0（级）, gamma:0.1..9.99=1, dialog?:true（开对话框＝点菜单）} 视图 ▸ 32 位预览选项：只改画面显示（线性光里乘 2^曝光、再 1/γ；高光压缩＝原样），不改像素、不进历史、每份文件各记各的；只给 32 位文件 → {method, exposure, gamma}'}, p => {
  p = p || {};
  if (!p.dialog) return preview32(p);
  if (!is32()){ toast(L3('只有 32 位元文件能用（影像 ▸ 模式 ▸ 32 位元/色版）', '只有 32 位文件能用（图像 ▸ 模式 ▸ 32 位/通道）', 'Only for 32-bit documents (Image ▸ Mode ▸ 32 Bits/Channel)'), true); return fail('not a 32-bit document'); }
  const old = Object.assign({}, hdrState());
  Dlg.open({id:'view.thirtyTwoBitPreviewOptions', cmd:'ps.view.thirtyTwoBitPreviewOptions', fields:[
    {k:'method', type:'select', label:['方法', '方法', 'Method'], value:old.method, options:[['exposureGamma', ['曝光度和 Gamma', '曝光度和灰度系数', 'Exposure and Gamma']], ['highlightCompression', ['亮部壓縮', '高光压缩', 'Highlight Compression']]]},
    {k:'exposure', type:'range', label:['曝光度', '曝光度', 'Exposure'], value:old.exposure, min:-20, max:20, step:0.01, when:v => v.method === 'exposureGamma'},
    {k:'exposureN', type:'number', label:['', '', ''], value:old.exposure, min:-20, max:20, step:0.01, when:v => v.method === 'exposureGamma'},
    {k:'gamma', type:'range', label:['Gamma', '灰度系数', 'Gamma'], value:old.gamma, min:0.1, max:9.99, step:0.01, when:v => v.method === 'exposureGamma'},
    {k:'gammaN', type:'number', label:['', '', ''], value:old.gamma, min:0.1, max:9.99, step:0.01, when:v => v.method === 'exposureGamma'}
  ], onChange:(v, k, D) => {                                            // 拉杆与数字框连动、即时预视
    if (k === 'exposure') D.cur.rows.find(r => r.f.k === 'exposureN').inp.value = v.exposureN = v.exposure;
    if (k === 'exposureN') D.cur.rows.find(r => r.f.k === 'exposure').inp.value = v.exposure = v.exposureN;
    if (k === 'gamma') D.cur.rows.find(r => r.f.k === 'gammaN').inp.value = v.gammaN = v.gamma;
    if (k === 'gammaN') D.cur.rows.find(r => r.f.k === 'gamma').inp.value = v.gamma = v.gammaN;
    preview32({method:v.method, exposure:v.exposure, gamma:v.gamma});
  }, onCancel:() => preview32(old),
  onOK:v => CMD.run('ps.view.thirtyTwoBitPreviewOptions', {method:v.method, exposure:v.exposure, gamma:v.gamma})});
  return opened();
});

/* ═══════════ ⑩ 视图 ▸ 清除所选画板参考线（artboard_cmds.rs:283：严格在当前画板框内的参考线） ═══════════ */
CMD.reg('ps.view.clearSelectedArtboardGuides', {i18n:'', undoable:false, params:'{id?（画板或里面的层；缺省＝当前层所在的画板）} 视图 ▸ 清除所选画板参考线：删掉落在这块画板框内（不含边上）的标尺参考线，一步历史 → {ok, cleared}'}, p => {
  p = p || {};
  const L = p.id ? Doc.byId(p.id) : Doc.active();
  const G = L && window.Groups && Groups.artboardOf ? Groups.artboardOf(L) : null;
  if (!G) return fail('no artboard selected');
  const [x, y, w, h] = G.data.artboard.rect;
  const guides = window.PsView ? PsView.guides() : (Doc.aiGuides || []);
  const inside = g => g.vertical ? (g.pos > x && g.pos < x + w) : (g.pos > y && g.pos < y + h);
  const n = guides.filter(inside).length;
  if (!n) return {ok:true, cleared:0};
  return step(() => { Doc.aiGuides = guides.filter(g => !inside(g)); redraw(); return {ok:true, cleared:n, artboard:G.id}; });
});

/* ═══════════ 给测试与 agent ═══════════ */
const PsFile2 = window.PsFile2 = {
  version:'1',
  _pickHook:null,
  bakeLattice, lut:{cube:lutCube, '3dl':lut3dl, csp:lutCsp}, notesFromPdf, notesFromXfdf, devices, hdr:() => Object.assign({}, hdrState()), hdrLut,
  dlg:{
    isOpen:() => !!Dlg.cur, id:() => Dlg.cur ? Dlg.cur.o.id : null,
    vals:() => Dlg.cur ? Object.assign({}, Dlg.cur.vals) : null,
    set:(k, v) => Dlg.set(k, v), click:act => Dlg.click(act), ok:() => Dlg.click('ok'), cancel:() => Dlg.click('cancel')
  }
};
})();
