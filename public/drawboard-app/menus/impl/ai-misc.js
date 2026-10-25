/* 堤麟画板 · Illustrator 杂项菜单实作
   本档把 AI 那几支菜单（文件／编辑／对象／文字／选择／视图／窗口）里还灰着、零零散散的项一次补齐，全部登记成 ai.<原码 id> 命令（agent 跟人点菜单走同一条）。
   原码对照（行号以 vectorcraft/crates 为根）：
     ui-egui/src/io.rs:538-551                     file.reveal（桌面版交给档案管理员；网页版没有 ⇒ 我们开「文件位置」资讯框，宿主有 revealDoc 钩子就交给宿主）
     ui-egui/src/panels/links.rs:162-175           links.editOriginal（open_file：已链接的图用系统程式开；嵌入的图没有档 ⇒ 回错）
     ui-egui/src/menus.rs:756-761、862-867、871     edit.colorSettings／assignProfile（没参数＝开色彩面板）、view.rotateReset、window.toolbarAdvanced
     ui-egui/src/menus.rs:990-1100                 ui.flattenerPresetsDialog／pdfPresetsDialog／printPresetsDialog／perspectivePresetsDialog
     ui-egui/src/dialogs/flattener_presets.rs 1-195、pdf_presets.rs 1-200、print_presets.rs 1-163、perspective_presets.rs 1-224（四个预设管理器：清单＋右边细节＋新建／编辑／删除／汇入／汇出）
     engine/src/cmd/colormgmt.rs:25-60、140-225     edit.colorSettings {rgb, cmyk, intent, bpc}、edit.assignProfile {rgb|null, cmyk|null}
     engine/src/cmd/plugin.rs:139-173              plugin.reload（重载增效工具资料夹；网页版原码回「plug-in folders are not available on the web」）
     ui-egui/src/menus.rs:912                      window.newWindow（原码只回「multiple windows land with M11.5」）
   原码无（todo）、照 Illustrator 2020 行为在浏览器里做的：
     其它脚本…、间隙选项…、图表 设计…／柱形图…／标记…、视觉边距对齐方式、启动全局编辑、显示视频标尺、对齐字形、排列四项、SVG 交互面板、变量面板。
   做法：
     ■ 文件级的新资料（图表设计、变量与资料组、SVG 链接脚本、CMYK 配置文件）放 Doc.aiMisc：随历史（包 History.snap／restore）、随工程档（包 Project.serialize／load）、进内容签名（SiteHooks.extraSigs）。
     ■ 物件上的新栏位（s.svgEvents、文字层 data.opticalMargin、实时上色组 gapOptions、图表 graph.columnDesign／markerDesign）本来就在图层资料里，历史与存档自然带着。
     ■ 对话框 DOM 与样式都在本档（.aim-*）；浮动面板用 DlPanels。
   🔴 共用层（engine.js、ui.js、toolbar.js、index.html）一律不改：要挂的都在本档包一层接上。 */
(function(){
'use strict';
if (window.AiMisc && window.AiMisc.__loaded) return;

/* ═══════════ 小工具 ═══════════ */
const L3 = (h, s, e) => ({'zh-Hant':h, 'zh-Hans':s, en:e});
const T = o => !o ? '' : typeof o === 'string' ? o : (o[(window.Lang && Lang.cur) || 'zh-Hans'] || o.en || o['zh-Hans'] || '');
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => (v === undefined || v === null || v === '' || !isFinite(+v)) ? d : +v;
const err = (C, m) => ({ok:false, error:`${C}: ${m}`});
const isP = v => !!v && typeof v.then === 'function';
const reg = (id, params, fn, extra) => CMD.reg(id, Object.assign({i18n:'', params}, extra || {}), p => fn(p || {}));
const refresh = () => { try { if (window.UI){ UI.refresh && UI.refresh(); UI.draw && UI.draw(); } } catch(e){ console.error(e); } };
const el = (tag, a, kids) => {
  const e = document.createElement(tag);
  for (const k in (a || {})){ const v = a[k]; if (v === undefined || v === null) continue;
    if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v; else if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v;
    else if (k === 'dataset') Object.assign(e.dataset, v); else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k in e && typeof v !== 'string') e[k] = v; else e.setAttribute(k, v); }
  (kids || []).forEach(c => { if (c !== null && c !== undefined && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return e;
};
const AiMisc = window.AiMisc = {__loaded:true};

/* ═══════════ 样式与通用对话框（.aim-*） ═══════════ */
function ensureStyle(){
  if (document.getElementById('aimStyle')) return;
  const st = document.createElement('style'); st.id = 'aimStyle';
  st.textContent = `.aim-back{position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center}
.aim-dlg{background:#2b2b2b;color:#ddd;border:1px solid #555;border-radius:6px;box-shadow:0 10px 40px #000a;padding:14px 16px;min-width:340px;max-width:94vw;max-height:92vh;overflow:auto;font:12px/1.5 system-ui,sans-serif}
.aim-dlg .t{font-weight:600;font-size:13px;margin-bottom:10px;color:#fff}
.aim-dlg .row{display:flex;align-items:center;gap:8px;margin:5px 0}.aim-dlg .row>span:first-child{min-width:150px;color:#aaa}
.aim-dlg input[type=text],.aim-dlg input[type=number],.aim-dlg select,.aim-dlg textarea{background:#1e1e1e;color:#eee;border:1px solid #555;border-radius:3px;padding:3px 5px;font:inherit}
.aim-dlg input[type=number]{width:80px}.aim-dlg textarea{width:100%;box-sizing:border-box;min-height:70px;font-family:monospace}
.aim-dlg .ck{display:flex;align-items:center;gap:6px;margin:4px 0}.aim-dlg .sec{margin:12px 0 4px;font-weight:600;color:#bbb;border-bottom:1px solid #444}
.aim-dlg .note{color:#999;font-size:11px;margin:4px 0;max-width:460px}.aim-dlg .er{color:#ff8a7a;margin-top:6px;min-height:0}
.aim-dlg .bar{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.aim-dlg button{background:#3d3d3d;color:#eee;border:1px solid #666;border-radius:3px;padding:4px 12px;font:inherit;cursor:pointer}
.aim-dlg button.pri{background:#2d6cdf;border-color:#2d6cdf}.aim-dlg button:disabled{opacity:.45;cursor:default}
.aim-split{display:flex;gap:16px}.aim-list{width:240px;height:260px;overflow:auto;border:1px solid #444;background:#1e1e1e;border-radius:3px}
.aim-list .li{padding:3px 8px;cursor:pointer;white-space:nowrap}.aim-list .li.on{background:#2d6cdf;color:#fff}.aim-list .li:hover:not(.on){background:#333}
.aim-detail{flex:1;min-width:280px}.aim-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;color:#ccc}.aim-kv b{color:#999;font-weight:normal}
#aimToast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%);background:#222;color:#eee;border:1px solid #555;border-radius:4px;padding:6px 14px;z-index:10060;transition:opacity .3s;font:12px system-ui,sans-serif;pointer-events:none}
.aim-pn{font:12px/1.45 system-ui,sans-serif;color:#ddd}.aim-pn .row{display:flex;align-items:center;gap:6px;margin:4px 0}.aim-pn select,.aim-pn input,.aim-pn textarea{background:#1e1e1e;color:#eee;border:1px solid #555;border-radius:3px;padding:2px 4px;font:inherit}
.aim-pn textarea{width:100%;box-sizing:border-box;min-height:54px;font-family:monospace}.aim-pn button{background:#3d3d3d;color:#eee;border:1px solid #666;border-radius:3px;padding:2px 8px;font:inherit;cursor:pointer}
.aim-pn button:disabled{opacity:.45}.aim-pn .lst{border:1px solid #444;background:#1e1e1e;min-height:60px;max-height:170px;overflow:auto;border-radius:3px}
.aim-pn .lst .li{padding:2px 6px;cursor:pointer;display:flex;gap:6px}.aim-pn .lst .li.on{background:#2d6cdf;color:#fff}.aim-pn .hint{color:#888;font-size:11px}`;
  document.head.appendChild(st);
}
let _toastT = 0;
function toast(m){
  if (!document.body || !m) return; ensureStyle();
  let t = document.getElementById('aimToast'); if (!t){ t = el('div', {id:'aimToast'}); document.body.appendChild(t); }
  t.textContent = m; t.style.opacity = '1'; clearTimeout(_toastT); _toastT = setTimeout(() => { t.style.opacity = '0'; }, 2600);
}
AiMisc.toast = toast;
/* 一个模态框：build(body, api) 画内容；buttons＝[{label, pri?, act, run(api) 回 false＝不关}] */
function modal(id, title, build, buttons){
  ensureStyle();
  document.querySelectorAll('.aim-back').forEach(x => x.remove());
  const back = el('div', {class:'aim-back'}), box = el('div', {class:'aim-dlg', dataset:{dlg:id}});
  const body = el('div'), er = el('div', {class:'er'});
  box.appendChild(el('div', {class:'t', text:T(title)})); box.appendChild(body); box.appendChild(er);
  const api = {back, box, body, close(){ back.remove(); }, error(m){ er.textContent = m || ''; }, redraw(){ body.innerHTML = ''; build(body, api); }};
  const bar = el('div', {class:'bar'});
  (buttons || [{label:L3('確定', '确定', 'OK'), pri:true, act:'ok'}]).forEach(b => bar.appendChild(el('button', {class:b.pri ? 'pri' : '', text:T(b.label), dataset:{act:b.act || ''},
    onclick:() => { let r; try { r = b.run ? b.run(api) : true; } catch(e){ r = {ok:false, error:e.message}; } if (r === false) return; if (r && r.ok === false){ api.error(r.error); return; } api.close(); }})));
  box.appendChild(bar);
  box.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); api.close(); } });
  back.addEventListener('pointerdown', e => e.stopPropagation());
  back.appendChild(box); document.body.appendChild(back);
  build(body, api);
  return api;
}
AiMisc.modal = modal;
/* 表单列 */
function field(f, onChange){
  let inp;
  if (f.type === 'select'){ inp = el('select'); (f.options || []).forEach(o => { const [v, n] = Array.isArray(o) ? o : [o, o]; inp.appendChild(el('option', {value:v, text:T(n)})); }); inp.value = f.value === undefined ? '' : String(f.value); }
  else if (f.type === 'check'){ inp = el('input', {type:'checkbox'}); inp.checked = !!f.value; }
  else if (f.type === 'textarea'){ inp = el('textarea'); inp.value = f.value === undefined ? '' : f.value; }
  else { inp = el('input', {type:f.type === 'number' ? 'number' : f.type === 'color' ? 'color' : 'text'}); if (f.min !== undefined) inp.min = f.min; if (f.max !== undefined) inp.max = f.max; if (f.step !== undefined) inp.step = f.step; inp.value = f.value === undefined || f.value === null ? '' : f.value; }
  inp.dataset.k = f.k; if (f.disabled) inp.disabled = true;
  const val = () => f.type === 'check' ? inp.checked : f.type === 'number' ? (inp.value === '' ? null : +inp.value) : inp.value;
  if (onChange) inp.addEventListener('change', () => onChange(f.k, val()));
  const row = f.type === 'check' ? el('label', {class:'ck'}, [inp, el('span', {text:T(f.label)})]) : el('label', {class:'row'}, [el('span', {text:T(f.label)}), inp]);
  return {row, inp, val};
}
function form(body, fields, onChange){
  const F = {};
  fields.forEach(f => { if (f.type === 'sec'){ body.appendChild(el('div', {class:'sec', text:T(f.label)})); return; } if (f.type === 'note'){ body.appendChild(el('div', {class:'note', text:T(f.label)})); return; }
    const x = field(f, onChange); body.appendChild(x.row); F[f.k] = x; });
  return {F, values(){ const v = {}; for (const k in F) v[k] = F[k].val(); return v; }};
}
/* 档案挑选器（回 Promise<File|null>） */
function pick(accept, multiple){
  return new Promise(res => {
    const inp = el('input', {type:'file', accept, style:'display:none', dataset:{aimPick:'1'}}); if (multiple) inp.multiple = true;
    inp.onchange = () => { const f = multiple ? [...(inp.files || [])] : (inp.files && inp.files[0]); inp.remove(); res(f || null); };
    document.body.appendChild(inp); inp.click();
  });
}
const readText = f => f.text ? f.text() : new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); });
/* 出档一律经 file.exportData（网站版覆写成存进云盘） */
function deliver(name, data, mime){ const r = CMD.run('file.exportData', {name, data, mime}); return isP(r) ? r : Promise.resolve(r); }

/* ═══════════ 文件级资料 Doc.aiMisc（历史／工程档／签名） ═══════════ */
const MISC0 = () => ({designs:[], vars:[], sets:[], setCur:-1, svgScripts:[], cmykProfile:null});
const M = () => { if (!Doc.aiMisc || typeof Doc.aiMisc !== 'object') Doc.aiMisc = MISC0(); const m = Doc.aiMisc, d = MISC0(); for (const k in d) if (m[k] === undefined) m[k] = d[k]; return m; };
AiMisc.state = M;
const miscEmpty = m => !m || (!m.designs.length && !m.vars.length && !m.sets.length && !m.svgScripts.length && !m.cmykProfile);
if (!History._aiMiscShim){
  History._aiMiscShim = true;
  const snap0 = History.snap, restore0 = History.restore, rip0 = History.restoreInPlace;
  const put = s => { if (s && 'aiMisc' in s) Doc.aiMisc = s.aiMisc ? clone(s.aiMisc) : null; };
  History.snap = function(){ const s = snap0.apply(this, arguments); s.aiMisc = Doc.aiMisc ? clone(Doc.aiMisc) : null; return s; };
  History.restore = function(s){ const r = restore0.apply(this, arguments); put(s); return r; };
  History.restoreInPlace = function(s){ const r = rip0.apply(this, arguments); put(s); return r; };
  const reset0 = Doc.reset;
  Doc.reset = function(){ Doc.aiMisc = null; GE.stop(true); return reset0.apply(this, arguments); };
  const ser0 = Project.serialize, load0 = Project.load;
  Project.serialize = function(){ const j = ser0.apply(this, arguments); if (j && Doc.aiMisc && !miscEmpty(M())) j.aiMisc = clone(Doc.aiMisc); return j; };
  Project.load = function(json){ Doc.aiMisc = (json && json.aiMisc && typeof json.aiMisc === 'object') ? clone(json.aiMisc) : null; GE.stop(true); return load0.apply(this, arguments); };
  if (window.SiteHooks && Array.isArray(SiteHooks.extraSigs)) SiteHooks.extraSigs.push(() => 'aiMisc:' + (Doc.aiMisc && !miscEmpty(M()) ? JSON.stringify(Doc.aiMisc) : ''));
}

/* ═══════════════════════════════════════════════════════════════════
   文件 ▸ 在文件夹中显示（io.rs:538 reveal）
   ═══════════════════════════════════════════════════════════════════ */
function docLocation(){
  const AF = window.AiFile, saved = AF && AF.saved;
  if (!saved) return null;
  const rec = (AF.recent || []).find(r => r.name === saved.name);
  const host = window.__dlSiteHooks && typeof window.__dlSiteHooks.revealDoc === 'function';
  return {path:saved.name, location:host ? 'site' : (rec ? 'browser' : 'download'), format:AF.format || 'dlcanvas', bytes:saved.json ? saved.json.length : null,
    savedAt:rec ? new Date(rec.time).toISOString() : (Doc.aiInfo && Doc.aiInfo.modified) || null};
}
const LOC_NAME = {site:L3('網站雲端硬碟', '网站云盘', 'Site cloud drive'), browser:L3('這個瀏覽器（最近開啟的檔案）', '这个浏览器（最近打开的文件）', 'This browser (Recent Files)'), download:L3('下載資料夾', '下载文件夹', 'Downloads folder')};
reg('ai.file.reveal', '{dialog?: true} 文件 ▸ 在文件夹中显示（io.rs:538 reveal → {path}）：浏览器打不开本机档案管理员 ⇒ 开「文件位置」资讯框（档名、存在哪里〔网站云盘／这个浏览器的最近打开／下载夹〕、格式、大小、存档时间）；宿主设了 __dlSiteHooks.revealDoc 就交给宿主去显示；从没存过 ⇒ 回错（原码同），资讯框给「存储为…」钮 → {ok, path, location, format, bytes, savedAt}', p => {
  const C = 'ai.file.reveal', info = docLocation(), show = p.dialog !== false;
  if (!info){
    if (show) modal('reveal', L3('在資料夾中顯示', '在文件夹中显示', 'Show in Folder'), b => b.appendChild(el('div', {class:'note', text:T(L3('這份文件還沒儲存過，沒有檔案可以顯示。', '这份文件还没存储过，没有文件可以显示。', 'This document has never been saved, so there is no file to show.'))})),
      [{label:L3('取消', '取消', 'Cancel'), act:'cancel'}, {label:L3('儲存為…', '存储为…', 'Save As…'), pri:true, act:'saveAs', run:() => { CMD.run('ai.file.saveAs', {}); return true; }}]);
    return err(C, 'the document has never been saved');
  }
  if (info.location === 'site'){ try { window.__dlSiteHooks.revealDoc({name:info.path}); } catch(e){ console.error(e); } }
  if (show) modal('reveal', L3('在資料夾中顯示', '在文件夹中显示', 'Show in Folder'), b => {
    const kv = el('div', {class:'aim-kv'});
    [[L3('檔名', '文件名', 'File'), info.path], [L3('位置', '位置', 'Location'), T(LOC_NAME[info.location])], [L3('格式', '格式', 'Format'), info.format],
     [L3('大小', '大小', 'Size'), info.bytes === null ? '—' : (info.bytes / 1024).toFixed(1) + ' KB'], [L3('儲存時間', '存储时间', 'Saved'), info.savedAt ? new Date(info.savedAt).toLocaleString() : '—']]
      .forEach(([k, v]) => { kv.appendChild(el('b', {text:T(k)})); kv.appendChild(el('span', {text:String(v), dataset:{k:T(k)}})); });
    b.appendChild(kv);
    b.appendChild(el('div', {class:'note', text:T(L3('網頁版沒有系統的檔案總管；這裡列出檔案存在哪裡。', '网页版没有系统的档案管理员；这里列出文件存在哪里。', 'The web version has no system file manager; this shows where the file is kept.'))}));
  }, [{label:L3('關閉', '关闭', 'Close'), pri:true, act:'ok'}]);
  return Object.assign({ok:true}, info);
});

/* ═══════════════════════════════════════════════════════════════════
   文件 ▸ 脚本 ▸ 其它脚本…（原码 menus.rs:1499 todo ⇒ 照 AI：挑一个脚本档执行）
   脚本格式：① JSON：[["命令", {参数}], …] 或 {steps:[…]}；② 一行一条「命令 {json}」（# 或 // 开头＝注解）；③ 其余当 JavaScript（async 函式体），拿得到 DilinCanvas、CMD、app。
   命令名可写原码 id（例 shape.rect、object.group），找不到就试 ai.<id>。
   ═══════════════════════════════════════════════════════════════════ */
const cmdId = id => CMD.map[id] ? id : CMD.map['ai.' + id] ? 'ai.' + id : null;
function parseSteps(t){
  try { const j = JSON.parse(t); const a = Array.isArray(j) ? j : (j && Array.isArray(j.steps)) ? j.steps : null; if (a) return a.map(x => Array.isArray(x) ? [x[0], x[1] || {}] : [x.id || x.cmd, x.params || {}]); } catch(e){}
  const lines = t.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#') && !s.startsWith('//'));
  if (!lines.length || !lines.every(l => /^[A-Za-z][\w.]*(\s+[{[].*)?$/.test(l))) return null;
  try { return lines.map(l => { const i = l.search(/\s/); return i < 0 ? [l, {}] : [l.slice(0, i), JSON.parse(l.slice(i + 1))]; }); } catch(e){ return null; }
}
async function runScript(src, name){
  const t = String(src || '').trim(), steps = parseSteps(t);
  if (steps){
    const results = [];
    for (const [id, params] of steps){
      const c = cmdId(String(id)); if (!c){ results.push({ok:false, error:`unknown command \`${id}\``}); break; }
      let r; try { r = CMD.run(c, params || {}); if (isP(r)) r = await r; } catch(e){ r = {ok:false, error:e.message}; }
      results.push(r === undefined ? null : r); if (r && r.ok === false) break;
    }
    refresh();
    const ok = results.length === steps.length && !results.some(r => r && r.ok === false);
    return {ok, mode:'steps', name:name || null, steps:results.length, results};
  }
  const AF = Object.getPrototypeOf(async function(){}).constructor;
  const app = {run:(id, p) => CMD.run(cmdId(id) || id, p || {}), inspect:() => window.DilinCanvas ? DilinCanvas.inspect() : null, alert:m => toast(String(m)), refresh};
  let v; try { v = await new AF('DilinCanvas', 'CMD', 'app', t)(window.DilinCanvas, CMD, app); } catch(e){ refresh(); return {ok:false, mode:'js', name:name || null, error:String(e && e.message || e)}; }
  refresh();
  let out = null; try { out = v === undefined ? null : JSON.parse(JSON.stringify(v)); } catch(e){ out = String(v); }
  return {ok:true, mode:'js', name:name || null, value:out};
}
AiMisc.runScript = runScript;
reg('ai.file.scripts.other', '{script?: 脚本文字, steps?: [[命令, 参数]…], name?} 文件 ▸ 脚本 ▸ 其它脚本…（Ctrl+F12；原码 todo，照 AI：挑一个脚本档来跑）：不给 script／steps ＝开档案挑选器（.js .jsx .json .txt）。' +
  '脚本＝JSON 步骤、一行一条「命令 {json}」，或 JavaScript（async 函式体，可用 DilinCanvas／CMD／app.run）；命令名可写原码 id（找不到自动试 ai.<id>）；每条命令各自一步历史 → Promise<{ok, mode:"steps"|"js", steps?, results?, value?, error?}>', p => {
  if (Array.isArray(p.steps)) return (AiMisc.lastScript = runScript(JSON.stringify(p.steps), p.name));
  if (typeof p.script === 'string') return (AiMisc.lastScript = runScript(p.script, p.name));
  AiMisc.lastScript = pick('.js,.jsx,.json,.txt,.dlscript,text/plain,application/json').then(async f => {
    if (!f) return {ok:false, error:'cancelled'};
    const r = await runScript(await readText(f), f.name);
    toast(r.ok ? T(L3('指令碼已執行：', '脚本已执行：', 'Script ran: ')) + f.name : (r.error || (r.results && (r.results.find(x => x && x.ok === false) || {}).error) || 'script failed'));
    return r;
  });
  return {ok:true, pending:'picker'};
});

/* ═══════════════════════════════════════════════════════════════════
   编辑 ▸ 编辑原稿（panels/links.rs:162 open_file）
   ═══════════════════════════════════════════════════════════════════ */
function linkTarget(p){
  if (p.id){ const L = Doc.byId(p.id); return L && (L.kind === 'raster' || L.kind === 'smart') ? L : null; }
  const A = Doc.active(); if (A && (A.kind === 'smart' || (A.kind === 'raster' && A.src))) return A;
  const r = CMD.map['ai.links.list'] ? CMD.map['ai.links.list'].run({}) : null;
  const first = r && r.links && r.links.find(x => x.status !== 'embedded');
  return first ? Doc.byId(first.id) : (A && A.kind === 'raster' ? A : null);
}
reg('ai.links.editOriginal', '{id?: 图层（缺省＝目前层，否则链接面板第一个已链接的）} 编辑 ▸ 编辑原稿（links.rs:162 open_file：用原本的程式开链接档）：' +
  '智能对象＝ps.layer.smartObjects.editContents（在画板里打开它的来源编辑，完成就写回）；云盘链接的像素层＝向宿主 resolveRef 要网址、开新分页看原档；嵌入的图没有原档 ⇒ 回错（原码同）→ {ok, opened:"contents"|"tab", url?}', p => {
  const C = 'ai.links.editOriginal', L = linkTarget(p);
  if (!L) return err(C, 'select a linked image');
  if (L.kind === 'smart'){
    const c = CMD.map['ps.layer.smartObjects.editContents']; if (!c) return err(C, 'smart-object editing is not loaded');
    const r = CMD.run('ps.layer.smartObjects.editContents', {id:L.id}); if (r && r.ok === false) return r;
    return {ok:true, opened:'contents', id:L.id};
  }
  const src = L.src; if (!src || (!src.file_id && !src.url)) return err(C, 'select a linked image: an embedded one has no file');
  const open = u => { const url = typeof u === 'string' ? u : u && u.url; if (!url) throw new Error('the link has no address'); AiMisc.lastOpened = url; const w = window.open(url, '_blank'); return {ok:true, opened:'tab', url, window:!!w}; };
  if (src.url) return open(src.url);
  const h = window.__dlSiteHooks; if (!h || typeof h.resolveRef !== 'function') return err(C, 'no host resolveRef hook to find the original file');
  return Promise.resolve(h.resolveRef({file_id:src.file_id})).then(open, e => err(C, String(e && e.message || e)));
});

/* ═══════════════════════════════════════════════════════════════════
   视图 ▸ 重置旋转视图（menus.rs:862）
   ═══════════════════════════════════════════════════════════════════ */
reg('ai.view.rotateReset', '{} 视图 ▸ 重置旋转视图（Shift+Ctrl+1；menus.rs:862 rotation = 0）：视图角度回 0（＝旋转视图工具的复位）→ {ok, angle}', () => {
  const c = CMD.map['rotateview.reset']; if (!c) return err('ai.view.rotateReset', 'the rotate-view tool is not loaded');
  const r = CMD.run('rotateview.reset', {}); refresh(); return Object.assign({ok:true}, r || {});
});

/* ═══════════════════════════════════════════════════════════════════
   窗口 ▸ 新建窗口、排列（原码只回错误／todo；我们一页一份文件 ⇒ 另开的「文件视窗」就是 PsWindow 的浮动文件视窗）
   ═══════════════════════════════════════════════════════════════════ */
const Wins = () => (window.PsWindow && PsWindow.windows) || null;
function placeWin(id, x, y, w, h){
  const P = window.DlPanels, b = P && P.els[id]; if (!b) return;
  if (w) b.style.width = Math.round(w) + 'px'; if (h) b.style.height = Math.round(h) + 'px';
  if (P._place) P._place(b, Math.round(x), Math.round(y)); else { b.style.left = Math.round(x) + 'px'; b.style.top = Math.round(y) + 'px'; }
  if (P.refresh) P.refresh(id);
}
function viewRect(){ const v = document.getElementById('view'); const host = (v && (v.closest('#stage') || v.parentElement)) || document.body; const r = host.getBoundingClientRect(); return {x:r.left, y:r.top, w:Math.max(200, r.width), h:Math.max(160, r.height)}; }
function needWins(C){ if (!Wins() || !CMD.map['ps.window.arrange.newWindowForDocument']) return err(C, 'document windows are not loaded (menus/impl/ps-window.js)'); return null; }
reg('ai.window.newWindow', '{} 窗口 ▸ 新建窗口：另开一个视窗看这份文件（自己的缩放与位置、跟着文件即时更新；滚轮缩放、拖曳平移）→ {ok, window}', () => {
  const e = needWins('ai.window.newWindow'); if (e) return e;
  return CMD.run('ps.window.arrange.newWindowForDocument', {});
});
reg('ai.window.arrange.cascade', '{} 窗口 ▸ 排列 ▸ 层叠：所有另开的文件视窗（没有就先开一个）由左上往右下错开叠好 → {ok, windows}', () => {
  const e = needWins('ai.window.arrange.cascade'); if (e) return e;
  if (!Wins().list.length) CMD.run('ps.window.arrange.newWindowForDocument', {});
  const R = viewRect(), L = Wins().list;
  L.forEach((w, i) => placeWin(w.id, R.x + 24 + i * 28, R.y + 24 + i * 28, Math.min(480, R.w * 0.6), Math.min(360, R.h * 0.6)));
  return {ok:true, windows:L.map(w => w.id)};
});
reg('ai.window.arrange.tile', '{} 窗口 ▸ 排列 ▸ 平铺：所有另开的文件视窗（没有就先开一个）在画布区排成格子 → {ok, windows, cols, rows}', () => {
  const e = needWins('ai.window.arrange.tile'); if (e) return e;
  if (!Wins().list.length) CMD.run('ps.window.arrange.newWindowForDocument', {});
  const R = viewRect(), L = Wins().list, n = L.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), W = R.w / cols, H = R.h / rows;
  L.forEach((w, i) => placeWin(w.id, R.x + (i % cols) * W, R.y + Math.floor(i / cols) * H, W - 4, H - 4));
  return {ok:true, windows:L.map(w => w.id), cols, rows};
});
reg('ai.window.arrange.floatInWindow', '{} 窗口 ▸ 排列 ▸ 在窗口中浮动：这份文件另开一个浮动视窗 → {ok, window}', () => {
  const e = needWins('ai.window.arrange.floatInWindow'); if (e) return e;
  return CMD.run('ps.window.arrange.floatInWindow', {});
});
reg('ai.window.arrange.consolidateAll', '{} 窗口 ▸ 排列 ▸ 合并所有窗口：关掉所有另开的文件视窗、回到分页 → {ok, closed}', () => {
  const e = needWins('ai.window.arrange.consolidateAll'); if (e) return e;
  const n = Wins().list.length; CMD.run('ps.window.arrange.consolidateAllToTabs', {}); return {ok:true, closed:n};
});

/* ═══════════════════════════════════════════════════════════════════
   窗口 ▸ 工具栏 ▸ 高级（menus.rs:871 flag(toolbar_advanced)）：关掉＝AI 2020「基本」工具栏
   基本版面照 参考/PS-AI工具栏截图/AI/AI-00-全景.png（AI 2020 v24.3 基本工具栏 16 格）；其余工具在「⋯ 编辑工具栏」抽屉里照样找得到。
   ═══════════════════════════════════════════════════════════════════ */
const TB_KEY = 'dlcanvas.ai.toolbarBasic';
const tbLayouts = () => { try { return TOOLBAR_LAYOUTS; } catch(e){ return null; } };   // toolbar-layout.js 顶层 const（不在 window 上）
let _basic = null;
function basicLayout(){
  if (_basic) return _basic;
  const TL = tbLayouts(); if (!TL || !TL.ai) return null;
  const A = TL.ai, S = i => A.slots[i].items, slot = (...ix) => ({items:[].concat(...ix.map(S))});
  _basic = Object.assign({}, A, {id:'ai.basic', gapAfter:[3, 8],
    slots:[slot(0), slot(1), slot(4), slot(5), slot(8, 7), slot(9, 10), slot(6), slot(12, 13), slot(11), slot(16), slot(19, 18), slot(20), slot(14), slot(21), slot(24), slot(27, 26)],
    drawer:[{n:'所有工具|所有工具|All Tools', slots:'all'}]});
  return _basic;
}
AiMisc.basicLayout = basicLayout;
const isBasic = () => { try { return localStorage.getItem(TB_KEY) === '1'; } catch(e){ return false; } };
function hookToolbar(){
  const TL = tbLayouts(); if (!TL || TL.__aiMisc || !window.Toolbar) return;
  TL.__aiMisc = true;
  const f0 = TL.forKind;
  TL.forKind = function(kind){ const L = f0.call(this, kind); return (L === TL.ai && isBasic() && basicLayout()) ? basicLayout() : L; };
  // 基本版面的抽屉列 AI 全部工具（照 AI：没放在工具栏上的工具在「编辑工具栏」抽屉里）
  const od = Toolbar.openDrawer, ch = Toolbar.choose;
  Toolbar.openDrawer = function(){
    if (!(this.layout && this.layout.id === 'ai.basic')) return od.apply(this, arguments);
    const keep = {layout:this.layout, groups:this.groups};
    this.layout = TL.ai; this.groups = TL.ai.slots.map((s, i) => ({key:'s' + i, kind:'slot', items:s.items}));
    try { return od.apply(this, arguments); } finally { this.layout = keep.layout; this.groups = keep.groups; }
  };
  Toolbar.choose = function(itemId, o){
    if (this.layout && this.layout.id === 'ai.basic' && !this.groupOf(itemId)){
      let item = null; TL.ai.slots.forEach(s => s.items.forEach(x => { if (x.id === itemId) item = x; }));
      if (!item || !item.impl || !Tools.get(item.impl)) return false;
      UI.setTool(item.impl); if (o && o.user && item.set && CMD.map[item.set.cmd]) CMD.run(item.set.cmd, item.set.params);
      return true;
    }
    return ch.apply(this, arguments);
  };
}
hookToolbar();
reg('ai.window.toolbarAdvanced', '{on?: bool（缺省＝切换）} 窗口 ▸ 工具栏 ▸ 高级（menus.rs:871）：打勾＝高级工具栏（28 格）；取消＝基本工具栏（AI 2020 的 16 格，其余工具在「⋯」抽屉）；记在浏览器 → {ok, advanced}', p => {
  hookToolbar();
  if (!basicLayout()) return err('ai.window.toolbarAdvanced', 'toolbar layouts are not loaded');
  const adv = typeof p.on === 'boolean' ? p.on : isBasic();
  try { if (adv) localStorage.removeItem(TB_KEY); else localStorage.setItem(TB_KEY, '1'); } catch(e){}
  if (window.Toolbar && Toolbar.kind === 'vector' && UI.buildToolbar) UI.buildToolbar('vector');
  return {ok:true, advanced:adv};
});
AiMisc.toolbarAdvanced = () => !isBasic();

/* ═══════════════════════════════════════════════════════════════════
   文字 ▸ 最近使用的字体：凡是带了字体的文字命令都记一笔（lib.rs:456-463 是在 app.run 里对 text.setStyle 记；我们另外补「新建文字」与「替换字体」）
   ═══════════════════════════════════════════════════════════════════ */
function hookRecentFonts(){
  const wrap = (id, fontOf) => {
    const c = CMD.map[id]; if (!c || c.__aiMiscFont) return;
    const o = c.run;
    c.run = function(p){
      const r = o.apply(this, arguments);
      const note = x => { if (x && x.ok === false) return; const f = fontOf(p || {}); if (f && window.AiType && AiType.noteFont) AiType.noteFont(f); };
      if (isP(r)) r.then(note, () => {}); else note(r);
      return r;
    };
    c.__aiMiscFont = true;
  };
  ['layer.newText', 'text.create', 'typev.create', 'typemaskh.create', 'typemaskv.create', 'ai.text.createInPath'].forEach(id => wrap(id, p => p.font));
  wrap('ai.text.replaceFont', p => p.to && p.to.family);
}
hookRecentFonts();

/* ═══════════════════════════════════════════════════════════════════
   对象 ▸ 增效工具 ▸ 重新载入增效工具（plugin.rs:153 reload：重读增效工具资料夹）
   浏览器没有资料夹 ⇒ 「增效工具资料夹」＝这个浏览器的 IndexedDB：装过的 .wasm 存在那里，开画板时自动载入（照 AI 启动时载入增效工具），
   「重新载入」＝卸下全部、照资料夹重装一遍，回 {folder, loaded, failed}（同原码 load_folder 的报告）。
   ═══════════════════════════════════════════════════════════════════ */
const PlugDB = {
  _p:null,
  db(){ if (this._p) return this._p; this._p = new Promise((res, rej) => { if (!window.indexedDB) return rej(new Error('no IndexedDB')); const r = indexedDB.open('dilin-canvas-plugins', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('mods')) r.result.createObjectStore('mods', {keyPath:'id'}); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); return this._p; },
  async req(mode, fn){ const db = await this.db(); return new Promise((res, rej) => { const t = db.transaction('mods', mode), q = fn(t.objectStore('mods')); let v; if (q) q.onsuccess = () => { v = q.result; }; t.oncomplete = () => res(v); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); },
  put(e){ return this.req('readwrite', s => s.put(e)); }, all(){ return this.req('readonly', s => s.getAll()); }, del(id){ return this.req('readwrite', s => s.delete(id)); }
};
const b64of = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
let _pendingWasm = null;
document.addEventListener('change', e => {
  const t = e.target; if (!t || t.tagName !== 'INPUT' || t.type !== 'file' || !/wasm/.test(t.accept || '') || !t.files || !t.files[0]) return;
  const f = t.files[0]; _pendingWasm = f.arrayBuffer().then(b => ({name:f.name, b64:b64of(new Uint8Array(b))}));
}, true);
function hookPlugins(){
  const ins = CMD.map['ai.plugin.install'], ui = CMD.map['ai.ui.installPlugin'], rm = CMD.map['ai.plugin.remove'];
  if (!ins || ins.__aiMisc) return; ins.__aiMisc = true;
  const save = (r, name, b64) => { if (r && r.ok && r.id && b64) PlugDB.put({id:r.id, name:name || r.source || r.id, b64, time:Date.now()}).catch(() => {}); };
  const i0 = ins.run; ins.run = function(p){ const r = i0.apply(this, arguments); if (p && typeof p.dataBase64 === 'string' && !AiMisc._reloading) Promise.resolve(r).then(x => save(x, p.name, p.dataBase64), () => {}); return r; };
  if (ui){ const u0 = ui.run; ui.run = function(p){ _pendingWasm = null; const r = u0.apply(this, arguments);
    if (!(p && p.dataBase64)) Promise.resolve(r).then(async x => { const w = await _pendingWasm; if (w) save(x, w.name, w.b64); }, () => {}); return r; }; }
  if (rm){ const r0 = rm.run; rm.run = function(p){ const r = r0.apply(this, arguments); if (r && r.ok && !AiMisc._reloading) PlugDB.del(p.id).catch(() => {}); return r; }; }
}
hookPlugins();
async function reloadPlugins(){
  AiMisc._reloading = true;
  try {
    const lst = CMD.run('ai.plugin.list', {});
    for (const pl of (lst && lst.plugins) || []) CMD.run('ai.plugin.remove', {id:pl.id});
    let all = []; try { all = (await PlugDB.all()) || []; } catch(e){ return {ok:false, error:'plugin.reload: ' + e.message}; }
    const loaded = [], failed = [];
    for (const m of all){ let r; try { r = await CMD.run('ai.plugin.install', {dataBase64:m.b64, name:m.name, replace:true}); } catch(e){ r = {ok:false, error:e.message}; }
      if (r && r.ok) loaded.push(r.id); else failed.push({file:m.name, error:(r && r.error) || 'failed'}); }
    return {ok:true, folder:'browser:IndexedDB/dilin-canvas-plugins', loaded, failed};
  } finally { AiMisc._reloading = false; }
}
reg('ai.plugin.reload', '{} 对象 ▸ 增效工具 ▸ 重新载入增效工具（plugin.rs:153 reload）：浏览器的「增效工具资料夹」＝IndexedDB（装过的 .wasm 都存在那里、开画板自动载入）；卸下全部、照资料夹重装 → Promise<{ok, folder, loaded:[id], failed:[{file, error}]}>', () => {
  if (!CMD.map['ai.plugin.install']) return err('ai.plugin.reload', 'plug-ins are not loaded');
  return (AiMisc.lastReload = reloadPlugins().then(r => { toast(r.ok ? T(L3('已重新載入增效模組：', '已重新载入增效工具：', 'Plug-ins reloaded: ')) + r.loaded.length : r.error); return r; }));
});
/* 开画板：资料夹里有就自动载入（AI 启动时载入增效工具） */
setTimeout(() => { if (!CMD.map['ai.plugin.install']) return; PlugDB.all().then(a => { if (a && a.length){ AiMisc._reloading = true;
  Promise.all(a.map(m => Promise.resolve(CMD.run('ai.plugin.install', {dataBase64:m.b64, name:m.name, replace:true})).catch(() => null))).finally(() => { AiMisc._reloading = false; }); } }).catch(() => {}); }, 0);
/* 菜单里没有 id 的分组标题（对象 ▸ 增效工具「未安装滤镜增效工具」是 ai-object.js syncMenu 动态生成的占位标题）：补一个 id，测试与 agent 才找得到它 */
function fixHeaders(){
  if (!window.MenuTrees || !MenuTrees.ai) return;
  try { MenuTrees.walk('ai', (it, path) => { if (it && it.header && !it.id){ const p = path[path.length - 1]; it.id = (p && p.sub && p.sub.some(x => x.id === 'plugin.reload')) ? 'plugin.none' : 'header.' + String((it.n && it.n.en) || '').replace(/\W+/g, ''); } }); } catch(e){}
}
fixHeaders();
document.addEventListener('mousedown', e => { if (e.target && e.target.closest && e.target.closest('#menubar')) fixHeaders(); }, true);
if (window.Menubar && !Menubar.__aiMiscFind){ Menubar.__aiMiscFind = true; const f0 = Menubar.find; Menubar.find = function(){ fixHeaders(); return f0.apply(this, arguments); }; }

/* ═══════════════════════════════════════════════════════════════════
   编辑 ▸ 颜色设置…／指定配置文件…（colormgmt.rs color_settings／assign_profile）
   工作空间与意图跟 PS 那边同一份颜色设置（ps.edit.colorSettings，存浏览器）；RGB 配置文件指定＝ps.edit.assignProfile（文件标记、画面照新配置文件解读，一步历史）；
   CMYK 只有一个内建（AiFile.cms 的 Generic CMYK，文件颜色模式转换用），指定记在 Doc.aiMisc.cmykProfile。意图／黑场补偿是「文件颜色模式」转换的预设。
   ═══════════════════════════════════════════════════════════════════ */
const RGB_PROFILES = [['srgb', 'sRGB IEC61966-2.1'], ['display-p3', 'Display P3'], ['adobe-rgb-compat', 'Adobe RGB (1998) compatible'], ['prophoto-compat', 'ProPhoto RGB compatible'], ['linear-srgb', 'Linear sRGB'], ['rec2020', 'Rec. ITU-R BT.2020']];
const cmykName = () => (window.AiFile && AiFile.cms && AiFile.cms.name) || 'Dilin Generic CMYK';
const CMYK_PROFILES = () => [['generic-cmyk', cmykName()]];
const INTENTS = [['perceptual', L3('感應式', '可感知', 'Perceptual')], ['relative', L3('相對公制色度', '相对比色', 'Relative Colorimetric')], ['saturation', L3('飽和度', '饱和度', 'Saturation')], ['absolute', L3('絕對公制色度', '绝对比色', 'Absolute Colorimetric')]];
const LS_AICS = 'dlcanvas.ai.colorSettings';
const aiCS = () => { try { return JSON.parse(localStorage.getItem(LS_AICS) || '{}') || {}; } catch(e){ return {}; } };
const profId = (list, v) => { if (v === undefined || v === null) return v; const s = String(v).toLowerCase(); const h = list.find(([id, n]) => id === s || n.toLowerCase() === s); return h ? h[0] : undefined; };
function psCS(p){ const c = CMD.map['ps.edit.colorSettings']; return c ? c.run(p) : null; }
function settingsJson(){
  const g = psCS({get:true}), s = (g && g.settings) || {}, a = aiCS();
  return {ok:true, rgb:s.workingRgb || 'srgb', rgbName:(RGB_PROFILES.find(x => x[0] === (s.workingRgb || 'srgb')) || [0, 'sRGB'])[1], cmyk:a.cmyk || 'generic-cmyk', cmykName:cmykName(),
    intent:s.intent || 'relative', bpc:s.bpc !== false, profiles:RGB_PROFILES.map(([id, name]) => ({id, name, kind:'rgb', builtin:true})).concat(CMYK_PROFILES().map(([id, name]) => ({id, name, kind:'cmyk', builtin:true})))};
}
function setColorSettings(p){
  const C = 'ai.edit.colorSettings', ps = {};
  if (p.rgb !== undefined){ const id = profId(RGB_PROFILES, p.rgb); if (!id) return err(C, `unknown rgb profile \`${p.rgb}\``); ps.workingRgb = id; }
  if (p.cmyk !== undefined){ const id = profId(CMYK_PROFILES(), p.cmyk); if (!id) return err(C, `unknown cmyk profile \`${p.cmyk}\``); const a = aiCS(); a.cmyk = id; try { localStorage.setItem(LS_AICS, JSON.stringify(a)); } catch(e){} }
  if (p.intent !== undefined){ const i = String(p.intent).replace(/Colorimetric$/i, '').toLowerCase(); if (!INTENTS.some(x => x[0] === i)) return err(C, `unknown intent \`${p.intent}\``); ps.intent = i; }
  if (typeof p.bpc === 'boolean') ps.bpc = p.bpc;
  if (Object.keys(ps).length){ const r = psCS(ps); if (r && r.ok === false) return r; }
  refresh();
  return settingsJson();
}
function colorSettingsDialog(){
  const s = settingsJson();
  let fm;
  modal('colorSettings', L3('色彩設定', '颜色设置', 'Color Settings'), b => {
    fm = form(b, [{type:'sec', label:L3('工作空間', '工作空间', 'Working Spaces')},
      {k:'rgb', label:'RGB：', type:'select', value:s.rgb, options:RGB_PROFILES.map(([id, n]) => [id, n])},
      {k:'cmyk', label:'CMYK：', type:'select', value:s.cmyk, options:CMYK_PROFILES()},
      {type:'sec', label:L3('轉換選項', '转换选项', 'Conversion Options')},
      {k:'intent', label:L3('方式：', '意图：', 'Intent:'), type:'select', value:s.intent, options:INTENTS},
      {k:'bpc', label:L3('使用黑場補償', '使用黑场补偿', 'Use Black Point Compensation'), type:'check', value:s.bpc},
      {type:'note', label:L3('RGB 工作空間與 Photoshop 那邊共用；方式與黑場補償是「文件色彩模式」轉換的預設。', 'RGB 工作空间与 Photoshop 那边共用；意图与黑场补偿是「文档颜色模式」转换的默认值。', 'The RGB working space is shared with the Photoshop side; the intent and black point compensation are the defaults for Document Color Mode conversions.')}]);
  }, [{label:L3('取消', '取消', 'Cancel'), act:'cancel'}, {label:L3('確定', '确定', 'OK'), pri:true, act:'ok', run:() => CMD.run('ai.edit.colorSettings', fm.values())}]);
}
reg('ai.edit.colorSettings', '{rgb?: srgb|display-p3|adobe-rgb-compat|prophoto-compat|linear-srgb|rec2020（或名字）, cmyk?: generic-cmyk, intent?: perceptual|relative|saturation|absolute, bpc?: bool} 编辑 ▸ 颜色设置…（Shift+Ctrl+K；colormgmt.rs color_settings）：' +
  '不给参数＝开对话框；给了＝设工作空间（存浏览器、不进历史；RGB 跟 PS 共用）→ {ok, rgb, cmyk, intent, bpc, profiles:[{id, name, kind, builtin}]}', p => {
  const keys = ['rgb', 'cmyk', 'intent', 'bpc'].filter(k => p[k] !== undefined);
  if (!keys.length){ if (p.dialog !== false) colorSettingsDialog(); return Object.assign(settingsJson(), {dialog:p.dialog !== false ? 'colorSettings' : undefined}); }
  return setColorSettings(p);
});
/* 文档颜色模式转换没给意图 ⇒ 用颜色设置的意图 */
(function(){ const c = CMD.map['ai.file.documentColorMode']; if (!c || c.__aiMisc) return; c.__aiMisc = true; const o = c.run;
  c.run = function(p){ p = Object.assign({}, p || {}); if (p.intent === undefined && p.mode){ const s = settingsJson(); p.intent = s.intent === 'relative' ? 'relativeColorimetric' : s.intent === 'absolute' ? 'absoluteColorimetric' : s.intent; } return o.call(this, p); }; })();
function docProfiles(){ return {rgb:Doc.iccProfile || null, cmyk:(Doc.aiMisc && Doc.aiMisc.cmykProfile) || null}; }
reg('ai.edit.assignProfile', '{rgb?: 配置文件 id|名字|null（null＝不要色彩管理）, cmyk?: generic-cmyk|null} 编辑 ▸ 指定配置文件…（colormgmt.rs assign_profile：只换标记、颜色数值不动；画面照新 RGB 配置文件解读）：不给参数＝开对话框；给了＝一步历史 → {ok, rgb, cmyk}', p => {
  const C = 'ai.edit.assignProfile';
  if (p.rgb === undefined && p.cmyk === undefined){
    if (p.dialog === false) return Object.assign({ok:true}, docProfiles());
    const cur = docProfiles(); let fm;
    modal('assignProfile', L3('指定描述檔', '指定配置文件', 'Assign Profile'), b => {
      fm = form(b, [{k:'rgb', label:L3('RGB 描述檔：', 'RGB 配置文件：', 'RGB Profile:'), type:'select', value:cur.rgb || 'none',
          options:[['none', L3('不要對此文件進行色彩管理', '不对此文档进行色彩管理', "Don't Color Manage This Document")]].concat(RGB_PROFILES)},
        {k:'cmyk', label:L3('CMYK 描述檔：', 'CMYK 配置文件：', 'CMYK Profile:'), type:'select', value:cur.cmyk || 'none', options:[['none', L3('工作中的 CMYK', '工作中的 CMYK', 'Working CMYK')]].concat(CMYK_PROFILES())}]);
    }, [{label:L3('取消', '取消', 'Cancel'), act:'cancel'}, {label:L3('確定', '确定', 'OK'), pri:true, act:'ok', run:() => { const v = fm.values(); return CMD.run(C, {rgb:v.rgb === 'none' ? null : v.rgb, cmyk:v.cmyk === 'none' ? null : v.cmyk}); }}]);
    return Object.assign({ok:true, dialog:'assignProfile'}, cur);
  }
  let rgb, cmyk;
  if (p.rgb !== undefined){ rgb = p.rgb === null ? null : profId(RGB_PROFILES, p.rgb); if (rgb === undefined) return err(C, `unknown rgb profile \`${p.rgb}\``); }
  if (p.cmyk !== undefined){ cmyk = p.cmyk === null ? null : profId(CMYK_PROFILES(), p.cmyk); if (cmyk === undefined) return err(C, `unknown cmyk profile \`${p.cmyk}\``); }
  const cur = docProfiles(), chR = rgb !== undefined && rgb !== cur.rgb, chC = cmyk !== undefined && cmyk !== cur.cmyk;
  if (!chR && !chC) return Object.assign({ok:true}, cur);
  History.push();
  if (chR){ if (!CMD.map['ps.edit.assignProfile']) { History.past.pop(); return err(C, 'profile assignment is not loaded (menus/impl/ps-edit.js)'); }
    const r = CMD.map['ps.edit.assignProfile'].run({profile:rgb || 'none'}); if (r && r.ok === false){ History.restoreInPlace(History.past.pop()); return r; } }
  if (chC) M().cmykProfile = cmyk;
  if (window.SiteHooks && SiteHooks.later) SiteHooks.later('ai.edit.assignProfile');
  refresh();
  return Object.assign({ok:true}, docProfiles());
});

/* ═══════════════════════════════════════════════════════════════════
   编辑 ▸ 四个预设管理器（dialogs/flattener_presets.rs、pdf_presets.rs、print_presets.rs、perspective_presets.rs）
   清单（内建的加方括号、受保护）＋右边细节；新建（从选中的复制一份）／编辑（存的才能改，栏位就地改就地存）／删除／汇入…／汇出…（选中那个）。
   透视网格、拼合器用原本的 ai.perspective.presets.*／ai.flattener.presets.*；PDF、打印的「存的预设」本来没有 ⇒ 本档补 ai.pdf.presets.*／ai.print.presets.*（存浏览器），
   并包 ai.file.export.pdf／ai.file.print 认得存的预设名。
   ═══════════════════════════════════════════════════════════════════ */
function userStore(key){
  return {
    get(){ try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch(e){ return []; } },
    set(a){ try { localStorage.setItem(key, JSON.stringify(a)); } catch(e){} }
  };
}
function uniqueName(base, taken){ if (!taken.some(n => n.toLowerCase() === base.toLowerCase())) return base; let i = 2; while (taken.some(n => n.toLowerCase() === (base + ' ' + i).toLowerCase())) i++; return base + ' ' + i; }
/* 一组「存的预设」命令（list／save／delete／export／import），PDF 与打印共用这个写法（照 flattener.presets.* 的规矩） */
function presetFamily(ns, label, builtins, keys, store, fmt, ext, defName, validate){
  const all = () => builtins.map(b => Object.assign({builtIn:true}, clone(b))).concat(store.get().map(u => Object.assign({builtIn:false}, clone(u))));
  const find = n => all().find(x => x.name.toLowerCase() === String(n || '').trim().toLowerCase());
  const pickOpts = o => { const v = {}; keys.forEach(k => { if (o && o[k] !== undefined) v[k] = clone(o[k]); }); return v; };
  reg(ns + '.list', `{} ${label}：先内建的（受保护）再存的 → {ok, presets:[{name, builtIn, options}]}`, () => ({ok:true, presets:all().map(x => ({name:x.name, builtIn:x.builtIn, options:pickOpts(x.options)}))}));
  reg(ns + '.save', `{name?: 缺省＝新的「${defName} N」, newName?: 改名, preset?: 从哪个预设开始（缺省＝存过的同名，否则第一个内建）, options?|…选项（${keys.join(', ')}）} ${label}：新建或改一个存的预设（内建的不能改）→ {ok, name, options, created}`, p => {
    const C = ns + '.save', U = store.get(), names = all().map(x => x.name);
    let i = p.name ? U.findIndex(u => u.name.toLowerCase() === String(p.name).trim().toLowerCase()) : -1;
    if (p.name && i < 0 && builtins.some(b => b.name.toLowerCase() === String(p.name).trim().toLowerCase())) return err(C, `\`${p.name}\` is a built-in preset and can't change`);
    const created = i < 0;
    const base = created ? (find(p.preset) || builtins[0]) : U[i];
    if (created && p.preset && !find(p.preset)) return err(C, `no preset \`${p.preset}\``);
    const opts = Object.assign(pickOpts(base.options), pickOpts(p.options || {}), pickOpts(p));
    if (validate){ const v = validate(opts); if (v) return err(C, v); }
    let name = created ? String(p.name || '').trim() : U[i].name;
    if (created && !name){ let n = 1; while (names.some(x => x.toLowerCase() === (defName + ' ' + n).toLowerCase())) n++; name = defName + ' ' + n; }
    if (p.newName !== undefined){ const nn = String(p.newName).trim(); if (!nn) return err(C, 'the name is empty'); if (nn.toLowerCase() !== name.toLowerCase() && names.some(x => x.toLowerCase() === nn.toLowerCase())) return err(C, `a preset named \`${nn}\` already exists`); name = nn; }
    const rec = {name, options:opts};
    if (created) U.push(rec); else U[i] = rec;
    store.set(U);
    return {ok:true, name, options:opts, created};
  });
  reg(ns + '.delete', `{name} ${label}：删一个存的预设（内建的留着）→ {ok, deleted}`, p => {
    const U = store.get(), i = U.findIndex(u => u.name.toLowerCase() === String(p.name || '').trim().toLowerCase());
    if (i < 0) return err(ns + '.delete', builtins.some(b => b.name === p.name) ? 'built-in presets stay' : `no saved preset \`${p.name}\``);
    U.splice(i, 1); store.set(U); return {ok:true, deleted:p.name};
  });
  reg(ns + '.export', `{names?: [预设名，内建的也可以]（缺省＝全部存的）} ${label}：→ {ok, data: .${ext} 档的文字（JSON）, count}`, p => {
    const list = Array.isArray(p.names) ? p.names.map(find).filter(Boolean) : store.get();
    return {ok:true, data:JSON.stringify({format:fmt, version:1, presets:list.map(x => ({name:x.name, options:pickOpts(x.options)}))}, null, 1), count:list.length};
  });
  reg(ns + '.import', `{data: .${ext} 档的文字, replace?: false（同名的存的预设换掉；否则名字被占就加编号）} ${label}：→ {ok, imported:[名字]}`, p => {
    const C = ns + '.import'; let j; try { j = typeof p.data === 'string' ? JSON.parse(p.data) : p.data; } catch(e){ return err(C, 'not a preset file: ' + e.message); }
    if (!j || j.format !== fmt || !Array.isArray(j.presets)) return err(C, `not a ${fmt} file`);
    const U = store.get(), out = [];
    for (const x of j.presets){ if (!x || typeof x.name !== 'string') continue;
      const opts = pickOpts(x.options || {}); if (validate && validate(opts)) continue;
      let name = x.name.trim(); const k = U.findIndex(u => u.name.toLowerCase() === name.toLowerCase());
      if (k >= 0 && p.replace){ U[k] = {name, options:opts}; out.push(name); continue; }
      name = uniqueName(name, builtins.map(b => b.name).concat(U.map(u => u.name))); U.push({name, options:opts}); out.push(name); }
    store.set(U); return {ok:true, imported:out};
  });
  return {all, find, pickOpts};
}
/* PDF 预设（pdf/src/presets.rs；内建同 ai-file.js 的 PDF_PRESETS） */
const PDF_KEYS = ['compatibility', 'standard', 'ppi', 'compression', 'quality', 'useDocumentBleed', 'preserveEditing'];
const PDF_BUILTINS = [
  {name:'VectorCraft Default', options:{compatibility:'1.7', standard:'none', ppi:300, compression:'zip', quality:'maximum', useDocumentBleed:false, preserveEditing:true}},
  {name:'High Quality Print', options:{compatibility:'1.6', standard:'none', ppi:300, compression:'auto', quality:'maximum', useDocumentBleed:false, preserveEditing:false}},
  {name:'Press Quality', options:{compatibility:'1.6', standard:'none', ppi:300, compression:'zip', quality:'maximum', useDocumentBleed:true, preserveEditing:false}},
  {name:'Smallest File Size', options:{compatibility:'1.6', standard:'none', ppi:100, compression:'jpeg', quality:'medium', useDocumentBleed:false, preserveEditing:false}},
  {name:'PDF/X-1a:2001', options:{compatibility:'1.3', standard:'pdfX1a', ppi:300, compression:'auto', quality:'maximum', useDocumentBleed:true, preserveEditing:false}},
  {name:'PDF/X-3:2002', options:{compatibility:'1.3', standard:'pdfX3', ppi:300, compression:'auto', quality:'maximum', useDocumentBleed:true, preserveEditing:false}},
  {name:'PDF/X-4:2010', options:{compatibility:'1.6', standard:'pdfX4', ppi:300, compression:'auto', quality:'maximum', useDocumentBleed:true, preserveEditing:false}}];
const pdfValidate = o => {
  if (o.compatibility !== undefined && !['1.3', '1.4', '1.5', '1.6', '1.7', '2.0'].includes(String(o.compatibility))) return 'compatibility must be 1.3…1.7 or 2.0';
  if (o.ppi !== undefined && !(+o.ppi >= 9 && +o.ppi <= 2400)) return 'ppi must be 9…2400';
  if (o.compression !== undefined && !['auto', 'zip', 'jpeg', 'none'].includes(o.compression)) return 'compression must be auto|zip|jpeg|none';
  return null;
};
const PdfP = presetFamily('ai.pdf.presets', 'Adobe PDF 预设（pdf_presets.rs）', PDF_BUILTINS, PDF_KEYS, userStore('dlcanvas.ai.pdfPresets'), 'dilin-pdf-presets', 'dlpdfpresets', 'PDF Preset', pdfValidate);
(function(){ const c = CMD.map['ai.file.export.pdf']; if (!c || c.__aiMisc) return; c.__aiMisc = true; const o = c.run;
  c.run = function(p){ p = p || {}; const u = p.preset && store0().find(x => x.name.toLowerCase() === String(p.preset).toLowerCase());
    if (u){ const base = (PDF_BUILTINS.find(b => b.options.standard === u.options.standard) || PDF_BUILTINS[0]).name; p = Object.assign({}, u.options, p, {preset:base}); delete p.standard; delete p.preserveEditing; }
    return o.call(this, p); };
  function store0(){ return userStore('dlcanvas.ai.pdfPresets').get(); } })();
/* 打印预设（printpresets.rs：[Default] 受保护） */
const PRINT_KEYS = ['media', 'orientation', 'scaling', 'scale', 'ppi'];
const PRINT_BUILTINS = [{name:'[Default]'.replace(/^\[|\]$/g, ''), options:{media:'driver', orientation:'auto', scaling:'none', scale:100, ppi:300}}];
const printValidate = o => {
  if (o.media !== undefined && !['driver', 'letter', 'legal', 'tabloid', 'a4', 'a3', 'a5'].includes(o.media)) return 'media must be driver|letter|legal|tabloid|a4|a3|a5';
  if (o.orientation !== undefined && !['auto', 'portrait', 'landscape'].includes(o.orientation)) return 'orientation must be auto|portrait|landscape';
  if (o.scaling !== undefined && !['none', 'fit', 'custom'].includes(o.scaling)) return 'scaling must be none|fit|custom';
  if (o.scale !== undefined && !(+o.scale >= 1 && +o.scale <= 1000)) return 'scale must be 1…1000';
  if (o.ppi !== undefined && !(+o.ppi >= 36 && +o.ppi <= 2400)) return 'ppi must be 36…2400';
  return null;
};
const PrintP = presetFamily('ai.print.presets', '打印预设（print_presets.rs）', PRINT_BUILTINS, PRINT_KEYS, userStore('dlcanvas.ai.printPresets'), 'dilin-print-presets', 'dlprintpresets', 'Print Preset', printValidate);
(function(){ const c = CMD.map['ai.file.print']; if (!c || c.__aiMisc) return; c.__aiMisc = true; const o = c.run;
  c.run = function(p){ p = p || {}; if (p.preset){ const x = PrintP.find(p.preset); if (!x) return err('ai.file.print', `no print preset \`${p.preset}\``); p = Object.assign({}, x.options, p); delete p.preset; } return o.call(this, p); }; })();
/* 拼合器预设补汇出／汇入（flatten.rs PRESET_FORMAT＝.vcflattener） */
const FL_KEYS = ['balance', 'lineArtPpi', 'gradientPpi', 'textToOutlines', 'strokesToOutlines', 'clipComplexRegions', 'antiAlias', 'preserveAlpha', 'preserveOverprints'];
reg('ai.flattener.presets.export', '{names?: [预设名，内建的也可以]（缺省＝全部存的）} 透明度拼合器预设 ▸ 导出…（flatten.rs PRESET_FORMAT）→ {ok, data: .vcflattener 档的文字（JSON）, count}', p => {
  const L = (CMD.run('ai.flattener.presets.list', {}).presets || []);
  const list = Array.isArray(p.names) ? L.filter(x => p.names.some(n => String(n).toLowerCase() === x.name.toLowerCase())) : L.filter(x => !x.builtIn);
  return {ok:true, data:JSON.stringify({format:'vectorcraft-flattener-presets', version:1, presets:list.map(x => ({name:x.name, options:x.options}))}, null, 1), count:list.length};
});
reg('ai.flattener.presets.import', '{data: .vcflattener 档的文字, replace?: false} 透明度拼合器预设 ▸ 导入…：加进存的预设（名字被占就加编号）→ {ok, imported:[名字]}', p => {
  const C = 'ai.flattener.presets.import'; let j; try { j = typeof p.data === 'string' ? JSON.parse(p.data) : p.data; } catch(e){ return err(C, 'not a preset file: ' + e.message); }
  if (!j || !/flattener-presets$/.test(j.format || '') || !Array.isArray(j.presets)) return err(C, 'not a flattener presets file');
  const out = [];
  for (const x of j.presets){ if (!x || typeof x.name !== 'string') continue;
    const names = (CMD.run('ai.flattener.presets.list', {}).presets || []).map(y => y.name), exists = names.some(n => n.toLowerCase() === x.name.trim().toLowerCase());
    const name = exists && p.replace ? x.name.trim() : uniqueName(x.name.trim(), names);
    const opts = {}; FL_KEYS.forEach(k => { if (x.options && x.options[k] !== undefined) opts[k] = x.options[k]; });
    const r = CMD.run('ai.flattener.presets.save', Object.assign({name}, opts)); if (r && r.ok) out.push(r.name); }
  return {ok:true, imported:out};
});

/* 管理器的四种：清单来源、细节栏位、新建／删除／存／汇入汇出 */
const BOOL = {type:'check'};
const PM = {
  flattener:{title:L3('透明度平面化預設集', '透明度拼合器预设', 'Transparency Flattener Presets'), ext:'.vcflattener', mime:'application/json',
    list:() => (CMD.run('ai.flattener.presets.list', {}).presets || []).map(x => ({name:x.name, builtIn:x.builtIn, v:x.options})),
    fields:[{k:'balance', label:L3('點陣/向量平衡', '栅格/矢量平衡', 'Raster/Vector Balance'), type:'number', min:0, max:100},
      {k:'lineArtPpi', label:L3('線條圖和文字解析度 (ppi)', '线稿图和文本分辨率 (ppi)', 'Line Art and Text Resolution (ppi)'), type:'number', min:1, max:9600},
      {k:'gradientPpi', label:L3('漸層和網格解析度 (ppi)', '渐变和网格分辨率 (ppi)', 'Gradient and Mesh Resolution (ppi)'), type:'number', min:1, max:1200},
      Object.assign({k:'textToOutlines', label:L3('將所有文字轉換為外框', '将所有文本转换为轮廓', 'Convert All Text to Outlines')}, BOOL),
      Object.assign({k:'strokesToOutlines', label:L3('將所有線條轉換為外框', '将所有描边转换为轮廓', 'Convert All Strokes to Outlines')}, BOOL),
      Object.assign({k:'clipComplexRegions', label:L3('裁剪複雜區域', '剪切复杂区域', 'Clip Complex Regions')}, BOOL),
      Object.assign({k:'antiAlias', label:L3('消除點陣圖鋸齒', '消除栅格锯齿', 'Anti-alias Rasters')}, BOOL),
      Object.assign({k:'preserveAlpha', label:L3('保留 Alpha 透明度', '保留 Alpha 透明度', 'Preserve Alpha Transparency')}, BOOL),
      Object.assign({k:'preserveOverprints', label:L3('保留特別色和疊印', '保留叠印和专色', 'Preserve Overprints and Spot Colors')}, BOOL)],
    create:cur => CMD.run('ai.flattener.presets.save', {preset:cur}), del:n => CMD.run('ai.flattener.presets.delete', {name:n}),
    save:(n, v) => CMD.run('ai.flattener.presets.save', Object.assign({name:n}, v)), rename:(n, nn) => CMD.run('ai.flattener.presets.save', {name:n, newName:nn}),
    exp:n => CMD.run('ai.flattener.presets.export', {names:[n]}), imp:d => CMD.run('ai.flattener.presets.import', {data:d})},
  pdf:{title:L3('Adobe PDF 預設集', 'Adobe PDF 预设', 'Adobe PDF Presets'), ext:'.dlpdfpresets', mime:'application/json',
    list:() => PdfP.all().map(x => ({name:x.name, builtIn:x.builtIn, v:x.options})),
    fields:[{k:'compatibility', label:L3('相容性', '兼容性', 'Compatibility'), type:'select', options:[['1.3', 'Acrobat 4 (PDF 1.3)'], ['1.4', 'Acrobat 5 (PDF 1.4)'], ['1.5', 'Acrobat 6 (PDF 1.5)'], ['1.6', 'Acrobat 7 (PDF 1.6)'], ['1.7', 'Acrobat 8 (PDF 1.7)'], ['2.0', 'PDF 2.0']]},
      {k:'standard', label:L3('標準', '标准', 'Standard'), type:'select', options:[['none', L3('無', '无', 'None')], ['pdfX1a', 'PDF/X-1a:2001'], ['pdfX3', 'PDF/X-3:2002'], ['pdfX4', 'PDF/X-4:2010'], ['pdfA2b', 'PDF/A-2b']]},
      {k:'ppi', label:L3('影像解析度 (ppi)', '图像分辨率 (ppi)', 'Image Resolution (ppi)'), type:'number', min:9, max:2400},
      {k:'compression', label:L3('壓縮', '压缩', 'Compression'), type:'select', options:[['auto', L3('自動', '自动', 'Automatic')], ['zip', 'ZIP'], ['jpeg', 'JPEG'], ['none', L3('無', '无', 'None')]]},
      {k:'quality', label:L3('影像品質', '图像品质', 'Image Quality'), type:'select', options:['minimum', 'low', 'medium', 'high', 'maximum']},
      Object.assign({k:'useDocumentBleed', label:L3('使用文件出血設定', '使用文档出血设置', 'Use Document Bleed Settings')}, BOOL),
      Object.assign({k:'preserveEditing', label:L3('保留 Illustrator 編輯能力', '保留 Illustrator 编辑功能', 'Preserve Illustrator Editing Capabilities')}, BOOL)],
    create:cur => CMD.run('ai.pdf.presets.save', {preset:cur}), del:n => CMD.run('ai.pdf.presets.delete', {name:n}),
    save:(n, v) => CMD.run('ai.pdf.presets.save', {name:n, options:v}), rename:(n, nn) => CMD.run('ai.pdf.presets.save', {name:n, newName:nn}),
    exp:n => CMD.run('ai.pdf.presets.export', {names:[n]}), imp:d => CMD.run('ai.pdf.presets.import', {data:d})},
  print:{title:L3('列印預設集', '打印预设', 'Print Presets'), ext:'.dlprintpresets', mime:'application/json',
    list:() => PrintP.all().map(x => ({name:x.name, builtIn:x.builtIn, v:x.options})),
    fields:[{k:'media', label:L3('尺寸', '大小', 'Size'), type:'select', options:[['driver', L3('由驅動程式定義', '由驱动程序定义', 'Defined by Driver')], ['letter', 'Letter'], ['legal', 'Legal'], ['tabloid', 'Tabloid'], ['a4', 'A4'], ['a3', 'A3'], ['a5', 'A5']]},
      {k:'orientation', label:L3('方向', '取向', 'Orientation'), type:'select', options:[['auto', L3('自動旋轉', '自动旋转', 'Auto-Rotate')], ['portrait', L3('縱向', '纵向', 'Portrait')], ['landscape', L3('橫向', '横向', 'Landscape')]]},
      {k:'scaling', label:L3('縮放', '缩放', 'Scaling'), type:'select', options:[['none', L3('不要縮放', '不要缩放', 'Do Not Scale')], ['fit', L3('符合頁面大小', '调整到页面大小', 'Fit to Page')], ['custom', L3('自訂縮放', '自定缩放', 'Custom Scale')]]},
      {k:'scale', label:L3('縮放 (%)', '缩放 (%)', 'Scale (%)'), type:'number', min:1, max:1000},
      {k:'ppi', label:L3('解析度 (ppi)', '分辨率 (ppi)', 'Resolution (ppi)'), type:'number', min:36, max:2400}],
    create:cur => CMD.run('ai.print.presets.save', {preset:cur}), del:n => CMD.run('ai.print.presets.delete', {name:n}),
    save:(n, v) => CMD.run('ai.print.presets.save', {name:n, options:v}), rename:(n, nn) => CMD.run('ai.print.presets.save', {name:n, newName:nn}),
    exp:n => CMD.run('ai.print.presets.export', {names:[n]}), imp:d => CMD.run('ai.print.presets.import', {data:d})},
  perspective:{title:L3('透視格點預設集', '透视网格预设', 'Perspective Grid Presets'), ext:'.vcperspective', mime:'application/json',
    list:() => (CMD.run('ai.perspective.presets.list', {}).presets || []).map(x => { const v = clone(x); delete v.name; delete v.builtIn; return {name:x.name, builtIn:x.builtIn, v}; }),
    fields:[{k:'kind', label:L3('類型', '类型', 'Type'), type:'select', options:[[1, L3('一點透視', '一点透视', 'One Point Perspective')], [2, L3('兩點透視', '两点透视', 'Two Point Perspective')], [3, L3('三點透視', '三点透视', 'Three Point Perspective')]]},
      {k:'units', label:L3('單位', '单位', 'Units'), type:'select', options:['points', 'pixels', 'inches', 'centimeters', 'millimeters', 'picas']},
      {k:'gridline', label:L3('格點線間隔', '网格线间隔', 'Gridline every'), type:'number', min:0.1},
      {k:'angle', label:L3('視角', '视角', 'Viewing Angle'), type:'number', min:0, max:90},
      {k:'distance', label:L3('視距', '视距', 'Viewing Distance'), type:'number', min:1},
      {k:'horizonHeight', label:L3('水平高度', '水平高度', 'Horizon Height'), type:'number'},
      {k:'leftColor', label:L3('左側格點', '左侧网格', 'Left Grid'), type:'color'}, {k:'rightColor', label:L3('右側格點', '右侧网格', 'Right Grid'), type:'color'},
      {k:'groundColor', label:L3('水平格點', '水平网格', 'Horizontal Grid'), type:'color'}, {k:'opacity', label:L3('不透明度 (%)', '不透明度 (%)', 'Opacity (%)'), type:'number', min:0, max:100}],
    create:cur => CMD.run('ai.perspective.presets.save', {preset:cur}), del:n => CMD.run('ai.perspective.presets.delete', {name:n}),
    save:(n, v) => { v = Object.assign({}, v); if (v.kind !== undefined) v.kind = +v.kind; return CMD.run('ai.perspective.presets.save', Object.assign({name:n}, v)); },
    rename:(n, nn) => CMD.run('ai.perspective.presets.save', {name:n, newName:nn}),
    exp:n => CMD.run('ai.perspective.presets.export', {names:[n]}), imp:d => CMD.run('ai.perspective.presets.import', {data:d})}
};
AiMisc.presetKinds = PM;
function presetsDialog(kind, selected){
  const K = PM[kind]; let sel = selected || null;
  const api = modal('presets.' + kind, K.title, (b, api) => {
    const list = K.list(); if (!list.length) return;
    let cur = list.find(x => x.name.toLowerCase() === String(sel || '').toLowerCase()) || list[0]; sel = cur.name;
    const left = el('div'), right = el('div', {class:'aim-detail'});
    left.appendChild(el('div', {class:'note', text:T(L3('預設集：', '预设：', 'Presets:'))}));
    const lb = el('div', {class:'aim-list'});
    list.forEach(x => lb.appendChild(el('div', {class:'li' + (x === cur ? ' on' : ''), dataset:{preset:x.name}, text:x.builtIn ? `[${x.name}]` : x.name, onclick:() => { sel = x.name; api.error(''); api.redraw(); }})));
    left.appendChild(lb);
    const run = (r, then) => { if (r && r.ok === false){ api.error(r.error); return; } api.error(''); if (then) then(r); api.redraw(); };
    const bar = el('div', {class:'row', style:'gap:4px;margin-top:6px'}, [
      el('button', {text:T(L3('新增', '新建', 'New')), dataset:{act:'new'}, title:T(L3('選取的預設集存一份可以編輯的副本', '选中的预设存一份可以编辑的副本', 'A saved copy of the selected preset')), onclick:() => run(K.create(cur.name), r => { sel = r.name; })}),
      el('button', {text:T(L3('刪除', '删除', 'Delete')), dataset:{act:'delete'}, disabled:cur.builtIn, onclick:() => { const i = list.indexOf(cur); run(K.del(cur.name), () => { const nl = K.list(); sel = (nl[Math.max(0, i - 1)] || nl[0] || {}).name; }); }}),
      el('button', {text:T(L3('讀入…', '导入…', 'Import…')), dataset:{act:'import'}, onclick:() => pick(K.ext + ',.json,application/json').then(async f => { if (!f) return; const r = K.imp(await readText(f)); run(r, x => { if (x.imported && x.imported[0]) sel = x.imported[0]; }); AiMisc.lastImport = r; })}),
      el('button', {text:T(L3('轉存…', '导出…', 'Export…')), dataset:{act:'export'}, onclick:() => { const r = K.exp(cur.name); if (r && r.ok) AiMisc.lastExport = deliver(cur.name.replace(/[\\/:*?"<>|\[\]]/g, '_') + K.ext, r.data, K.mime); else run(r); }})]);
    left.appendChild(bar);
    const nameRow = el('label', {class:'row'}, [el('span', {text:T(L3('名稱：', '名称：', 'Name:'))})]);
    if (cur.builtIn) nameRow.appendChild(el('b', {text:cur.name, style:'color:#fff;font-weight:600'}));
    else { const ni = el('input', {type:'text', value:cur.name, dataset:{k:'name'}}); ni.addEventListener('change', () => run(K.rename(cur.name, ni.value), r => { sel = r.name; })); nameRow.appendChild(ni); }
    right.appendChild(nameRow);
    const fs = K.fields.map(f => Object.assign({}, f, {value:cur.v[f.k], disabled:cur.builtIn}));
    form(right, fs, (k, v) => run(K.save(cur.name, {[k]:v})));
    if (cur.builtIn) right.appendChild(el('div', {class:'note', text:T(L3('內建的預設集不能修改：按「新增」做一份可以編輯的副本。', '内建的预设不能修改：按「新建」做一份可以编辑的副本。', "Built-in presets don't change: New makes a copy you can edit."))}));
    b.appendChild(el('div', {class:'aim-split'}, [left, right]));
  }, [{label:L3('完成', '完成', 'Done'), pri:true, act:'ok'}]);
  return api;
}
[['ai.ui.flattenerPresetsDialog', 'flattener', '透明度拼合器预设…（flattener_presets.rs）'], ['ai.ui.pdfPresetsDialog', 'pdf', 'Adobe PDF 预设…（pdf_presets.rs）'],
 ['ai.ui.printPresetsDialog', 'print', '打印预设…（print_presets.rs）'], ['ai.ui.perspectivePresetsDialog', 'perspective', '透视网格预设…（perspective_presets.rs）']].forEach(([id, kind, label]) =>
  reg(id, `{selected?: 预设名} 编辑 ▸ ${label}：开预设管理器（清单＋细节；新建＝复制选中的、存的预设栏位就地改就地存、删除、导入…、导出…；内建的受保护）；资料命令见 ${kind === 'flattener' ? 'ai.flattener.presets.*' : kind === 'perspective' ? 'ai.perspective.presets.*' : 'ai.' + kind + '.presets.*'} → {ok, dialog, presets}`, p => {
    const K = PM[kind]; if (kind === 'flattener' && !CMD.map['ai.flattener.presets.list']) return err(id, 'flattener presets are not loaded');
    if (kind === 'perspective' && !CMD.map['ai.perspective.presets.list']) return err(id, 'perspective grid is not loaded');
    presetsDialog(kind, p.selected); return {ok:true, dialog:'presets.' + kind, presets:K.list().map(x => x.name)};
  }));

AiMisc.__partA = true;

/* ═══════════════════════════════════════════════════════════════════
   对象 ▸ 实时上色 ▸ 间隙选项…（原码 menus.rs:1749 todo ⇒ 照 AI 2020）
   AI：「间隙检测」打开时，路径围出来的区域都算面；路径之间小于「上色停止在」的空隙当作封闭（小／中／大＝3／6／12 pt，或自定）；
   预览颜色把找到的间隙画出来；「用路径封闭间隙」＝真的补上没上色的路径。
   我们的实时上色（ai-object.js buildChildren）只把「在某个来源里面」的区域当面 ⇒ 间隙检测打开的组，另外把「路径（含补上的间隙）围出来、还不是面」的区域补成面（gapFace），
   油漆桶（ai.livePaint.fill）点得到它们。设定记在组上（g.gapOptions），新建的组用浏览器记的预设。
   ═══════════════════════════════════════════════════════════════════ */
const GAP_SIZES = {small:3, medium:6, large:12};
const GAP_COLORS = [['#ff6464', L3('淺紅色', '淡红色', 'Light Red')], ['#ff0000', L3('紅色', '红色', 'Red')], ['#00a0ff', L3('淺藍色', '淡蓝色', 'Light Blue')], ['#00c800', L3('綠色', '绿色', 'Green')], ['#ff00ff', L3('洋紅色', '洋红色', 'Magenta')]];
const LS_GAP = 'dlcanvas.ai.lpGap';
const gapDefault = () => { try { return Object.assign({detect:false, paintStops:'small', custom:3, color:'#ff6464'}, JSON.parse(localStorage.getItem(LS_GAP) || '{}')); } catch(e){ return {detect:false, paintStops:'small', custom:3, color:'#ff6464'}; } };
const gapSize = o => o.paintStops === 'custom' ? clamp(num(o.custom, 3), 0.01, 1000) : (GAP_SIZES[o.paintStops] || 3);
const R3 = () => window.AiR3 || null;
const isLP = n => !!(R3() && R3().livePaint && R3().livePaint.isLP(n));
const lpSources = g => { const s = (g.children || []).find(c => c.name === 'Live Paint Sources'); return s ? s.children : []; };
/* 来源的折线（图层坐标）：[{P, closed, leaf}] */
function lpPolys(g){
  const out = [];
  lpSources(g).forEach(src => R3().leavesOf(src).forEach(leaf => R3().subviews(leaf).forEach(v => { const P = AIObj.flatten(v); if (P.length >= 2) out.push({P, closed:!!v.closed, leaf}); })));
  return out;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function nearestOn(P, closed, q){
  let best = null;
  const n = closed ? P.length : P.length - 1;
  for (let i = 0; i < n; i++){ const a = P[i], b = P[(i + 1) % P.length], d = [b[0] - a[0], b[1] - a[1]], L2 = d[0] * d[0] + d[1] * d[1];
    const t = L2 > 0 ? clamp(((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / L2, 0, 1) : 0, p = [a[0] + d[0] * t, a[1] + d[1] * t], dd = dist(p, q);
    if (!best || dd < best[0]) best = [dd, p]; }
  return best;
}
/* 找间隙：开放路径的端点 → 最近的别的路径（或自己另一端），0 < 距离 ≤ size */
function findGaps(g, size){
  const polys = lpPolys(g), gaps = [];
  polys.forEach((o, i) => {
    if (o.closed) return;
    [o.P[0], o.P[o.P.length - 1]].forEach((e, k) => {
      let best = null;
      polys.forEach((q, j) => {
        if (j === i){ const other = k === 0 ? o.P[o.P.length - 1] : o.P[0], d = dist(e, other); if (o.P.length > 2 && d > 1e-6 && (!best || d < best[0])) best = [d, other]; return; }
        const h = nearestOn(q.P, q.closed, e); if (h && (!best || h[0] < best[0])) best = h;
      });
      if (best && best[0] > 1e-3 && best[0] <= size + 1e-9) gaps.push([e.slice(), best[1].slice()]);
    });
  });
  // 两端互相找到的同一条间隙只留一条
  return gaps.filter((a, i) => !gaps.slice(0, i).some(b => (dist(a[0], b[1]) < 1e-6 && dist(a[1], b[0]) < 1e-6) || (dist(a[0], b[0]) < 1e-6 && dist(a[1], b[1]) < 1e-6)));
}
const polyArea = P => { let s = 0; for (let i = 0; i < P.length; i++){ const p = P[i], q = P[(i + 1) % P.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
function insidePoly(P, p){ let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++){ const a = P[i], b = P[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function innerPoint(P){
  let y0 = Infinity, y1 = -Infinity; P.forEach(p => { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
  let best = null;
  for (const f of [0.5, 0.3, 0.7, 0.15, 0.85, 0.4, 0.6]){
    const y = y0 + (y1 - y0) * f, xs = [];
    for (let i = 0; i < P.length; i++){ const a = P[i], b = P[(i + 1) % P.length]; if ((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2){ const w = xs[i + 1] - xs[i]; if (w > (best ? best[0] : 1e-6)) best = [w, [(xs[i] + xs[i + 1]) / 2, y]]; }
  }
  return best ? best[1] : null;
}
/* 补面：路径（开放的当来回一趟、不自动闭合）＋间隙围出来、还没被面盖住的区域 */
function augmentGapFaces(g){
  const o = g.gapOptions; if (!o || !o.detect || !R3() || !R3().livePaint) return 0;
  const LP = R3().livePaint;
  g.children = g.children.filter(c => !(c.gapFace && !(c.fill && c.fill !== 'none')));            // 没上色的旧补面先拿掉（重新算）
  const polys = lpPolys(g), gaps = findGaps(g, gapSize(o));
  const shapes = polys.map(x => ({polys:[x.closed ? x.P : x.P.concat(x.P.slice(1, -1).reverse())], rule:'nonzero', fill:'none', stroke:'none', w:0}))
    .concat(gaps.map(([a, b]) => ({polys:[[a, b]], rule:'nonzero', fill:'none', stroke:'none', w:0})));
  if (!shapes.length) return 0;
  const pl = LP.planar(shapes); if (!pl) return 0;
  let maxA = 0, outer = 1; pl.faces.forEach(F => { const a = polyArea(F); if (Math.abs(a) > maxA){ maxA = Math.abs(a); outer = Math.sign(a); } });
  const add = [];
  for (const F of pl.faces){
    const a = polyArea(F); if (Math.sign(a) === outer || Math.abs(a) < 1e-3) continue;
    const P = a < 0 ? F.slice().reverse() : F, ip = innerPoint(P); if (!ip) continue;
    if (LP.faceAt(g, ip)) continue;
    const v = AIObj.tidyLoop(P); if (!v) continue;
    add.push({area:Math.abs(a), node:{id:R3().newId(), type:'bezier', name:'Face', gapFace:true, anchors:v.anchors, closed:true, fill:'none', stroke:'none', strokeWidth:0}});
  }
  add.sort((x, y) => y.area - x.area);
  const firstEdge = g.children.findIndex(c => c.name === 'Edge');
  g.children.splice(firstEdge < 0 ? g.children.length : firstEdge, 0, ...add.map(x => x.node));
  return add.length;
}
/* 用路径封闭间隙：补进来源组、重建（原本上的颜色照合并的方式找回来） */
function closeGapsWithPaths(L, g){
  const o = g.gapOptions || gapDefault(), gaps = findGaps(g, gapSize(o)); if (!gaps.length) return 0;
  const LP = R3().livePaint, src = lpSources(g);
  const keepF = (g.children || []).filter(c => c.name === 'Face' && c.fill && c.fill !== 'none').map(f => { const P = R3().subviews(f).map(v => AIObj.flatten(v))[0]; return P ? [innerPoint(P), clone(f.fill)] : null; }).filter(x => x && x[0]);
  const keepE = (g.children || []).filter(c => c.name === 'Edge').map(e => { const P = e.points; if (!P || P.length < 2) return null; return [[(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2], {stroke:clone(e.stroke), strokeWidth:e.strokeWidth}]; }).filter(Boolean);
  gaps.forEach(([a, b]) => src.push({id:R3().newId(), type:'path', name:'Gap', points:[a, b], closed:false, fill:'none', stroke:'none', strokeWidth:0}));
  const b = LP.buildChildren(src); if (b.err) return 0;
  g.children = b.children;
  augmentGapFaces(g);
  for (const [pt, f] of keepF){ const fc = LP.faceAt(g, pt); if (fc) fc.fill = f; }
  for (const [pt, a] of keepE){ const e = LP.edgeNear(g, pt, 0.5); if (e) Object.assign(e, a); }
  Layer.invalidate(L);
  return gaps.length;
}
function lpTargets(p){
  if (!R3()) return [];
  if (p.group){ const h = R3().findDeep(p.group); return h && isLP(h.s) ? [{L:h.L, g:h.s}] : []; }
  const L = R3().vLayer(p); if (!L) return [];
  const ids = Array.isArray(p.ids) ? p.ids : (VecSel.layerId === L.id ? VecSel.shapes : []);
  return L.data.shapes.filter(s => ids.includes(s.id) && isLP(s)).map(g => ({L, g}));
}
AiMisc.gap = {find:findGaps, augment:augmentGapFaces, size:gapSize, defaults:gapDefault};
/* 建立／合并之后：组带上预设（检测开着就补面）；油漆桶之前：检测开着的组先补面 */
(function(){
  const after = id => { const c = CMD.map[id]; if (!c || c.__aiMiscGap) return; c.__aiMiscGap = true; const o = c.run;
    c.run = function(p){ const r = o.apply(this, arguments); if (r && r.ok && r.id){ const h = R3() && R3().findDeep(r.id); if (h && isLP(h.s)){ if (!h.s.gapOptions){ const d = gapDefault(); if (d.detect) h.s.gapOptions = {detect:true, paintStops:d.paintStops, custom:d.custom, color:d.color}; } if (augmentGapFaces(h.s)) Layer.invalidate(h.L); } } return r; }; };
  after('ai.livePaint.make'); after('ai.livePaint.merge');
  const f = CMD.map['ai.livePaint.fill']; if (f && !f.__aiMiscGap){ f.__aiMiscGap = true; const o = f.run;
    f.run = function(p){ try { (p && p.group ? lpTargets({group:p.group}) : lpTargets(p || {})).forEach(t => { if (t.g.gapOptions && t.g.gapOptions.detect) augmentGapFaces(t.g); }); } catch(e){ console.error(e); } return o.apply(this, arguments); }; }
})();
reg('ai.livePaint.gapOptions', '{detect?: bool（间隙检测）, paintStops?: "small"|"medium"|"large"|"custom"（上色停止在：小 3／中 6／大 12 pt）, custom?: pt, color?: 预览颜色, closeGaps?: true（用路径封闭间隙）, group?|ids?: 实时上色组（缺省＝选中的；都没有＝只改新组的预设）, preview?: bool} ' +
  '对象 ▸ 实时上色 ▸ 间隙选项…（原码 todo，照 AI 2020）：不给参数＝开对话框；检测开着的组：路径与小于间隙的空隙围出来的区域都变成可上色的面 → {ok, groups, gaps, faces}', p => {
  const C = 'ai.livePaint.gapOptions', T0 = lpTargets(p);
  const keys = ['detect', 'paintStops', 'custom', 'color', 'closeGaps'].filter(k => p[k] !== undefined);
  if (!keys.length && p.dialog !== false){ gapDialog(T0); return {ok:true, dialog:'gapOptions', groups:T0.map(t => t.g.id)}; }
  if (p.paintStops !== undefined && !['small', 'medium', 'large', 'custom'].includes(p.paintStops)) return err(C, 'paintStops must be small|medium|large|custom');
  if (p.custom !== undefined && !(+p.custom > 0 && +p.custom <= 1000)) return err(C, 'custom must be 0…1000 pt');
  const pickO = base => { const o = Object.assign({}, base); ['detect', 'paintStops', 'custom', 'color'].forEach(k => { if (p[k] !== undefined) o[k] = k === 'custom' ? +p[k] : k === 'detect' ? !!p[k] : p[k]; }); return o; };
  const def = pickO(gapDefault()); try { localStorage.setItem(LS_GAP, JSON.stringify(def)); } catch(e){}
  if (!T0.length) return {ok:true, groups:[], gaps:0, faces:0, defaults:def};
  if (p.preview !== undefined) AiMisc.gapPreview = !!p.preview;
  let gaps = 0, faces = 0;
  History.push();
  T0.forEach(t => {
    t.g.gapOptions = pickO(t.g.gapOptions || gapDefault());
    if (!t.g.gapOptions.detect){ t.g.children = t.g.children.filter(c => !(c.gapFace && !(c.fill && c.fill !== 'none'))); }
    if (p.closeGaps) gaps += closeGapsWithPaths(t.L, t.g);
    else { gaps += findGaps(t.g, gapSize(t.g.gapOptions)).length; faces += augmentGapFaces(t.g); }
    Layer.invalidate(t.L);
  });
  if (window.SiteHooks && SiteHooks.later) SiteHooks.later(C);
  refresh();
  return {ok:true, groups:T0.map(t => t.g.id), gaps, faces};
});
function gapDialog(T0){
  const base = T0.length ? Object.assign(gapDefault(), T0[0].g.gapOptions || {}) : gapDefault();
  let fm, cnt;
  const count = v => T0.reduce((n, t) => n + findGaps(t.g, gapSize(v)).length, 0);
  modal('gapOptions', L3('間隙選項', '间隙选项', 'Gap Options'), b => {
    fm = form(b, [{k:'detect', label:L3('間隙偵測', '间隙检测', 'Gap Detection'), type:'check', value:base.detect},
      {k:'paintStops', label:L3('上色停止在：', '上色停止在：', 'Paint stops at:'), type:'select', value:base.paintStops, options:[['small', L3('小間隙', '小间隙', 'Small Gaps')], ['medium', L3('中間隙', '中等间隙', 'Medium Gaps')], ['large', L3('大間隙', '大间隙', 'Large Gaps')], ['custom', L3('自訂', '自定', 'Custom')]]},
      {k:'custom', label:L3('自訂 (pt)：', '自定 (pt)：', 'Custom (pt):'), type:'number', value:base.custom, min:0.01, max:1000, step:0.5},
      {k:'color', label:L3('間隙預視顏色：', '间隙预览颜色：', 'Gap Preview Color:'), type:'select', value:base.color, options:GAP_COLORS},
      {k:'preview', label:L3('預視', '预览', 'Preview'), type:'check', value:AiMisc.gapPreview !== false}], () => { cnt.textContent = T(L3('找到的間隙：', '找到的间隙：', 'Gaps Found: ')) + count(fm.values()); AiMisc.gapPreview = fm.values().preview; AiMisc._gapLive = fm.values(); refresh(); });
    cnt = el('div', {class:'note', dataset:{k:'gapsFound'}, text:T(L3('找到的間隙：', '找到的间隙：', 'Gaps Found: ')) + count(base)}); b.appendChild(cnt);
    if (!T0.length) b.appendChild(el('div', {class:'note', text:T(L3('沒有選取即時上色群組：設定成為新群組的預設值。', '没有选中实时上色组：设置成为新组的默认值。', 'No Live Paint group selected: the settings become the default for new groups.'))}));
  }, [{label:L3('重設', '重置', 'Reset'), act:'reset', run:api => { Object.entries({detect:false, paintStops:'small', custom:3, color:'#ff6464'}).forEach(([k, v]) => { const f = fm.F[k]; if (!f) return; if (f.inp.type === 'checkbox') f.inp.checked = v; else f.inp.value = v; }); return false; }},
      {label:L3('用路徑封閉間隙', '用路径封闭间隙', 'Close gaps with paths'), act:'close', run:() => { const v = fm.values(); AiMisc._gapLive = null; return CMD.run('ai.livePaint.gapOptions', {detect:v.detect, paintStops:v.paintStops, custom:v.custom, color:v.color, closeGaps:true, ids:T0.map(t => t.g.id), layerId:T0[0] && T0[0].L.id}); }},
      {label:L3('取消', '取消', 'Cancel'), act:'cancel', run:() => { AiMisc._gapLive = null; refresh(); return true; }},
      {label:L3('確定', '确定', 'OK'), pri:true, act:'ok', run:() => { const v = fm.values(); AiMisc._gapLive = null; return CMD.run('ai.livePaint.gapOptions', {detect:v.detect, paintStops:v.paintStops, custom:v.custom, color:v.color, preview:v.preview, ids:T0.map(t => t.g.id), layerId:T0[0] && T0[0].L.id}); }}]);
}
/* 预览：选中的实时上色组（检测开着，或对话框正开着）把间隙画成预览色 */
function gapOverlay(ctx, s){
  if (AiMisc.gapPreview === false || !window.VecSel || !R3()) return;
  const L = VecSel.layer(); if (!L || L.kind !== 'vector') return;
  L.data.shapes.filter(g => VecSel.shapes.includes(g.id) && isLP(g)).forEach(g => {
    const o = AiMisc._gapLive || g.gapOptions; if (!o || !o.detect) return;
    const gaps = findGaps(g, gapSize(o)); if (!gaps.length) return;
    ctx.save(); ctx.strokeStyle = o.color || '#ff6464'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    gaps.forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo((a[0] + L.x) * s, (a[1] + L.y) * s); ctx.lineTo((b[0] + L.x) * s, (b[1] + L.y) * s); ctx.stroke(); });
    ctx.restore();
  });
}

/* ═══════════════════════════════════════════════════════════════════
   对象 ▸ 图表 ▸ 设计…／柱形图…／标记…（原码 menus.rs:2267-2275 todo ⇒ 照 AI 2020）
   设计：选中的图稿存成「图表设计」（文件级，Doc.aiMisc.designs）；新建／重命名／删除／粘贴设计／选择未使用的设计。
   柱形图：选中的图表（或其中一组系列）的长条换成设计——垂直缩放／一致缩放／重复堆叠（每个设计代表 N 单位；分数：缩放或截断）／局部缩放（设计中线以上滑动）；可旋转图例设计。
   标记：折线图／散点图／雷达图的标记点换成设计。
   做法：设定记在图表规格上（graph.columnDesign／markerDesign），图表每次重新生成（建立／数据／类型）后都再套一次。
   ═══════════════════════════════════════════════════════════════════ */
const COLUMN_KINDS = ['column', 'stackedColumn', 'bar', 'stackedBar'], MARKER_KINDS = ['line', 'scatter', 'radar'];
function graphTarget(p){
  const r = R3(); if (!r) return null;
  const L = p.layerId ? Doc.byId(p.layerId) : VecSel.layer(); if (!L || L.kind !== 'vector') return null;
  for (const id of (p.id ? [p.id] : []).concat(VecSel.layerId === L.id ? VecSel.shapes : [])){
    let h = r.findDeep(id, L); while (h){ if (h.s.graph) return {L, g:h.s}; h = h.parent ? r.findDeep(h.parent.id, L) : null; }
  }
  return null;
}
const designByName = n => M().designs.find(d => d.name === n) || null;
function designFit(d, m){ return (d.shapes || []).map(s => R3().cloneXf(s, m)); }
/* 局部缩放：y（往下为正）在滑动线以上的点贴着顶、以下的贴着底，横向 sx */
function slidePoint(p, d, b, sx, sy){
  const slide = d.h * 0.5, x = b.x0 + (p[0]) * sx;
  const y = p[1] <= slide ? b.y0 + p[1] * sy : b.y1 - (d.h - p[1]) * sy;
  return [x, y];
}
function slideCopy(d, b){
  const sx = (b.x1 - b.x0) / Math.max(d.w, 1e-9), sy = sx, out = [];
  (d.shapes || []).forEach(s => {
    const c = R3().reid(s);
    R3().walk([c], n => { if (R3().isLeaf(n)) R3().toBezier(n); });
    R3().walk([c], n => { if (n.type === 'bezier' && Array.isArray(n.anchors)) n.anchors.forEach(a => {
      const q = slidePoint([a.x, a.y], d, b, sx, sy), dx = q[0] - a.x, dy = q[1] - a.y;
      if (a.in) a.in = slidePoint(a.in, d, b, sx, sy); if (a.out) a.out = slidePoint(a.out, d, b, sx, sy); a.x = q[0]; a.y = q[1]; void dx; void dy; }); });
    out.push(c);
  });
  return out;
}
/* 一根长条 b（图层坐标）换成设计；horizontal＝条形图（长度在 x） */
function columnArt(d, b, cfg, value, unitLen, horizontal){
  const R = R3(), dw = Math.max(d.w, 1e-9), dh = Math.max(d.h, 1e-9);
  // 横的先在「转 90°」的座标里做：设计的高对到长条的长
  const W = horizontal ? b.y1 - b.y0 : b.x1 - b.x0, H = horizontal ? b.x1 - b.x0 : b.y1 - b.y0;
  // 竖条的局部座标 (x 横、y 往下，y=H 是基线)；横条：局部 y=H → 左缘、y=0 → 右缘，局部 x → 往下
  const mOf = (sx, sy, tx, ty) => { // 设计的 (u,v) → 局部 (u*sx+tx, v*sy+ty) → 图层座标
    if (!horizontal) return [sx, 0, 0, sy, b.x0 + tx, b.y0 + ty];
    return [0, sx, -sy, 0, b.x0 + H - ty, b.y0 + tx];      // x' = b.x0 + H - (v*sy+ty)，y' = b.y0 + u*sx + tx
  };
  const t = cfg.type || 'vertical';
  if (t === 'uniform'){ const s = H / dh, w = dw * s; return designFit(d, mOf(s, s, (W - w) / 2, 0)); }
  if (t === 'repeating'){
    const unit = Math.max(num(cfg.unit, 10), 1e-9), n = Math.abs(value) / unit, whole = Math.floor(n + 1e-9), frac = n - whole, cell = unitLen * unit;
    const sx = W / dw, sy = cell / dh, out = [];
    for (let i = 0; i < whole; i++) out.push(...designFit(d, mOf(sx, sy, 0, H - (i + 1) * cell)));
    if (frac > 1e-6){
      const top = H - whole * cell - frac * cell;
      if ((cfg.fraction || 'scale') === 'chop'){
        // 截断：整格设计底对齐在下一格上面，剪切路径只留下面 frac 那段（顶被切掉）
        const clipLocal = [[0, top], [W, top], [W, top + frac * cell], [0, top + frac * cell]].map(([x, y]) => horizontal ? [b.x0 + H - y, b.y0 + x] : [b.x0 + x, b.y0 + y]);
        const art = designFit(d, mOf(sx, sy, 0, top + frac * cell - cell));
        out.push({id:R.newId(), type:'group', clip:true, name:'Chopped Design', children:[{id:R.newId(), type:'path', points:clipLocal, closed:true, fill:'none', stroke:'none', strokeWidth:0}].concat(art)});
      } else out.push(...designFit(d, mOf(sx, sy * frac, 0, top)));
    }
    return out;
  }
  if (t === 'sliding'){
    if (horizontal){ const s = H / dh; return designFit(d, mOf(W / dw, s, 0, 0)); }
    return slideCopy(d, b);
  }
  return designFit(d, mOf(W / dw, H / dh, 0, 0));                                       // vertical：整个撑满长条
}
const isRectPath = s => s && s.type === 'path' && s.closed && Array.isArray(s.points) && s.points.length === 4;
const rectOf = s => { const xs = s.points.map(p => p[0]), ys = s.points.map(p => p[1]); return {x0:Math.min(...xs), y0:Math.min(...ys), x1:Math.max(...xs), y1:Math.max(...ys)}; };
function applyDesigns(node){
  const spec = node && node.graph; if (!spec || !R3()) return 0;
  let n = 0;
  const groups = (node.children || []).filter(c => c.type === 'group' && c.name !== 'Axes' && c.name !== 'Legend');
  const cd = spec.columnDesign && designByName(spec.columnDesign.name), md = spec.markerDesign && designByName(spec.markerDesign.name);
  if (cd && COLUMN_KINDS.includes(spec.kind)){
    const horizontal = spec.kind === 'bar' || spec.kind === 'stackedBar';
    // 每单位长度：拿资料最大的那根推回去
    let unitLen = null;
    groups.forEach((g, si) => { let c = 0; g.children.forEach(it => { if (!isRectPath(it)) return; const b = rectOf(it); if (b.x0 >= spec.rect[2] - 1e-6) return; const v = (spec.rows[c] || [])[si]; c++;
      const len = horizontal ? b.x1 - b.x0 : b.y1 - b.y0; if (v && Math.abs(v) > 1e-12 && len > 0){ const u = len / Math.abs(v); if (unitLen === null || u > 0) unitLen = u; } }); });
    groups.forEach((g, si) => {
      let c = 0; const kids = [];
      g.children.forEach(it => {
        if (!isRectPath(it)){ kids.push(it); return; }
        const b = rectOf(it), legend = b.x0 >= spec.rect[2] - 1e-6;
        if (legend){
          const s = Math.min((b.x1 - b.x0) / Math.max(cd.w, 1e-9), (b.y1 - b.y0) / Math.max(cd.h, 1e-9)), rot = !!spec.columnDesign.rotateLegend;
          const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, m = rot ? [0, s, -s, 0, cx + cd.h * s / 2, cy - cd.w * s / 2] : [s, 0, 0, s, cx - cd.w * s / 2, cy - cd.h * s / 2];
          kids.push({id:R3().newId(), type:'group', name:'Legend Design', children:designFit(cd, m)}); n++; return;
        }
        const v = (spec.rows[c] || [])[si] || 0; c++;
        if ((horizontal ? b.x1 - b.x0 : b.y1 - b.y0) < 1e-6){ kids.push(it); return; }
        kids.push({id:R3().newId(), type:'group', name:'Column Design', children:columnArt(cd, b, spec.columnDesign, v, unitLen || 1, horizontal)}); n++;
      });
      g.children = kids;
    });
  }
  if (md && MARKER_KINDS.includes(spec.kind)){
    groups.forEach(g => { g.children = g.children.map(it => {
      if (!isRectPath(it)) return it; const b = rectOf(it), side = b.x1 - b.x0; if (side > 6.5 || Math.abs((b.y1 - b.y0) - side) > 1e-6 || b.x0 >= spec.rect[2] - 1e-6) return it;
      const box = side * 2.5, s = box / Math.max(md.w, md.h, 1e-9), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      n++; return {id:R3().newId(), type:'group', name:'Marker Design', children:designFit(md, [s, 0, 0, s, cx - md.w * s / 2, cy - md.h * s / 2])};
    }); });
  }
  return n;
}
/* 重新生成（graph.rs:477 regenerate 的翻版：移过／缩放过就把绘图区跟着调）再套设计 */
function regenGraph(node){
  const spec = node.graph, R = R3(), now = R.geoBounds(node.children || []), pl = spec.placed;
  if (pl && now && pl[2] - pl[0] > 1e-9 && pl[3] - pl[1] > 1e-9 && Math.abs(pl[0] - now.x0) + Math.abs(pl[1] - now.y0) + Math.abs(pl[2] - now.x1) + Math.abs(pl[3] - now.y1) > 1e-6){
    const sx = (now.x1 - now.x0) / (pl[2] - pl[0]), sy = (now.y1 - now.y0) / (pl[3] - pl[1]), f = (x, y) => [now.x0 + (x - pl[0]) * sx, now.y0 + (y - pl[1]) * sy];
    const a = f(spec.rect[0], spec.rect[1]), b = f(spec.rect[2], spec.rect[3]); spec.rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  }
  node.children = R.graphGenerate(spec);
  const pb = R.geoBounds(node.children); spec.placed = pb ? [pb.x0, pb.y0, pb.x1, pb.y1] : null;
  applyDesigns(node);
  spec.placed = pb ? [pb.x0, pb.y0, pb.x1, pb.y1] : null;     // placed 记的是没套设计的外框（下次比对位移用同一把尺）
}
(function(){
  ['ai.graph.create', 'ai.graph.setData', 'ai.graph.setType'].forEach(id => { const c = CMD.map[id]; if (!c || c.__aiMiscDesign) return; c.__aiMiscDesign = true; const o = c.run;
    c.run = function(){ const r = o.apply(this, arguments); if (r && r.ok && r.id && R3()){ const h = R3().findDeep(r.id); if (h && h.s.graph && (h.s.graph.columnDesign || h.s.graph.markerDesign)){ applyDesigns(h.s); Layer.invalidate(h.L); } } return r; }; });
})();
AiMisc.graph = {applyDesigns, regen:regenGraph, designs:() => M().designs};
reg('ai.graph.design', '{action?: "new"|"rename"|"delete"|"paste"|"selectUnused"|"list", name?, newName?, ids?} 对象 ▸ 图表 ▸ 设计…（原码 todo，照 AI 2020）：不给 action＝开对话框；' +
  'new＝把选中的图稿存成设计（名字缺省「新建设计 N」）；rename；delete（用到它的图表恢复成长条）；paste＝把设计贴进当前矢量层（选中）；selectUnused＝回没被任何图表用到的设计；list → {ok, designs:[{name, w, h, shapes}], name?, unused?}', p => {
  const C = 'ai.graph.design', D = M().designs, a = p.action;
  if (!a){ if (p.dialog !== false) designDialog(); return {ok:true, dialog:'graphDesign', designs:D.map(d => d.name)}; }
  if (a === 'list') return {ok:true, designs:D.map(d => ({name:d.name, w:d.w, h:d.h, shapes:d.shapes.length}))};
  if (a === 'new'){
    const L = R3() && R3().vLayer(p); if (!L) return err(C, 'select artwork on a vector layer');
    const R = R3().roots(L, Array.isArray(p.ids) ? p.ids : null).filter(s => !s.graph); if (!R.length) return err(C, 'select the artwork for the design');
    const b = R3().geoBounds(R); if (!b) return err(C, 'the selection has no size');
    let name = p.name ? String(p.name).trim() : ''; if (!name){ let i = 1; while (D.some(d => d.name === T(L3('新增設計 ', '新建设计 ', 'New Design ')) + i)) i++; name = T(L3('新增設計 ', '新建设计 ', 'New Design ')) + i; }
    if (D.some(d => d.name === name)) return err(C, `a design named \`${name}\` already exists`);
    History.push();
    D.push({name, w:b.x1 - b.x0, h:b.y1 - b.y0, shapes:R.map(s => R3().cloneXf(s, [1, 0, 0, 1, -b.x0, -b.y0]))});
    SiteHooks.later && SiteHooks.later(C);
    return {ok:true, name, designs:D.map(d => d.name)};
  }
  const d = designByName(p.name); if (!d) return err(C, `no design \`${p.name}\``);
  const usersOf = n => { const out = []; Doc.layers.forEach(L => { if (L.kind === 'vector') R3().walk(L.data.shapes, s => { if (s.graph && ((s.graph.columnDesign && s.graph.columnDesign.name === n) || (s.graph.markerDesign && s.graph.markerDesign.name === n))) out.push({L, s}); }); }); return out; };
  if (a === 'rename'){
    const nn = String(p.newName || '').trim(); if (!nn) return err(C, 'the name is empty'); if (nn !== d.name && D.some(x => x.name === nn)) return err(C, `a design named \`${nn}\` already exists`);
    History.push(); usersOf(d.name).forEach(u => { if (u.s.graph.columnDesign && u.s.graph.columnDesign.name === d.name) u.s.graph.columnDesign.name = nn; if (u.s.graph.markerDesign && u.s.graph.markerDesign.name === d.name) u.s.graph.markerDesign.name = nn; });
    d.name = nn; SiteHooks.later && SiteHooks.later(C); return {ok:true, name:nn};
  }
  if (a === 'delete'){
    History.push(); const users = usersOf(d.name);
    users.forEach(u => { if (u.s.graph.columnDesign && u.s.graph.columnDesign.name === d.name) delete u.s.graph.columnDesign; if (u.s.graph.markerDesign && u.s.graph.markerDesign.name === d.name) delete u.s.graph.markerDesign; });
    D.splice(D.indexOf(d), 1); users.forEach(u => { regenGraph(u.s); Layer.invalidate(u.L); }); refresh(); return {ok:true, deleted:p.name, graphs:users.length};
  }
  if (a === 'paste'){
    const L = R3().vLayer(p); if (!L) return err(C, 'select a vector layer');
    History.push();
    const cx = Doc.width / 2 - L.x - d.w / 2, cy = Doc.height / 2 - L.y - d.h / 2, art = designFit(d, [1, 0, 0, 1, cx, cy]);
    L.data.shapes.push(...art); VecSel.setShapes(L.id, art.map(s => s.id)); Layer.invalidate(L); refresh(); return {ok:true, ids:art.map(s => s.id)};
  }
  if (a === 'selectUnused') return {ok:true, unused:D.filter(x => !usersOf(x.name).length).map(x => x.name)};
  return err(C, `unknown action \`${a}\``);
});
function designPreview(d, W, H){
  const c = el('canvas', {width:W, height:H, style:`width:${W}px;height:${H}px;background:#fff;border:1px solid #444;border-radius:3px`}), x = c.getContext('2d');
  if (d && d.w > 0 && d.h > 0){ const s = Math.min((W - 10) / d.w, (H - 10) / d.h); x.save(); x.translate((W - d.w * s) / 2, (H - d.h * s) / 2); (d.shapes || []).forEach(sh => { try { window.drawShape(x, sh, s); } catch(e){} }); x.restore(); }
  return c;
}
function designDialog(){
  let sel = (M().designs[0] || {}).name || null, unused = [];
  modal('graphDesign', L3('圖表設計', '图表设计', 'Graph Design'), (b, api) => {
    const D = M().designs, lb = el('div', {class:'aim-list', style:'height:180px'});
    D.forEach(d => lb.appendChild(el('div', {class:'li' + (d.name === sel ? ' on' : ''), dataset:{design:d.name}, text:d.name + (unused.includes(d.name) ? '  •' : ''), onclick:() => { sel = d.name; api.redraw(); }})));
    const run = (r, then) => { if (r && r.ok === false){ api.error(r.error); return; } api.error(''); if (then) then(r); api.redraw(); };
    const btns = el('div', {style:'display:flex;flex-direction:column;gap:5px'}, [
      el('button', {text:T(L3('新增設計', '新建设计', 'New Design')), dataset:{act:'new'}, onclick:() => run(CMD.run('ai.graph.design', {action:'new'}), r => { sel = r.name; })}),
      el('button', {text:T(L3('重新命名…', '重命名…', 'Rename…')), dataset:{act:'rename'}, disabled:!sel, onclick:() => { const nn = prompt(T(L3('名稱：', '名称：', 'Name:')), sel); if (nn) run(CMD.run('ai.graph.design', {action:'rename', name:sel, newName:nn}), r => { sel = r.name; }); }}),
      el('button', {text:T(L3('刪除設計', '删除设计', 'Delete Design')), dataset:{act:'delete'}, disabled:!sel, onclick:() => run(CMD.run('ai.graph.design', {action:'delete', name:sel}), () => { sel = (M().designs[0] || {}).name || null; })}),
      el('button', {text:T(L3('貼上設計', '粘贴设计', 'Paste Design')), dataset:{act:'paste'}, disabled:!sel, onclick:() => run(CMD.run('ai.graph.design', {action:'paste', name:sel}))}),
      el('button', {text:T(L3('選取未使用的設計', '选择未使用的设计', 'Select Unused')), dataset:{act:'unused'}, onclick:() => run(CMD.run('ai.graph.design', {action:'selectUnused'}), r => { unused = r.unused; if (unused[0]) sel = unused[0]; })})]);
    b.appendChild(el('div', {class:'aim-split'}, [el('div', {}, [lb, el('div', {style:'margin-top:6px'}, [designPreview(designByName(sel), 240, 110)])]), btns]));
    b.appendChild(el('div', {class:'note', text:T(L3('先選取圖稿再按「新增設計」。', '先选中图稿再按「新建设计」。', 'Select artwork, then click New Design.'))}));
  }, [{label:L3('確定', '确定', 'OK'), pri:true, act:'ok'}]);
}
const COL_TYPES = [['vertical', L3('垂直縮放', '垂直缩放', 'Vertically Scaled')], ['uniform', L3('一致縮放', '一致缩放', 'Uniformly Scaled')], ['repeating', L3('重複堆疊', '重复堆叠', 'Repeating')], ['sliding', L3('滑動', '局部缩放', 'Sliding')]];
reg('ai.graph.column', '{id?: 图表, design?: 设计名|null（null＝换回长条）, type?: "vertical"|"uniform"|"repeating"|"sliding", unit?: 每个设计代表几单位 (10), fraction?: "scale"|"chop", rotateLegend?: bool} 对象 ▸ 图表 ▸ 柱形图…（原码 todo，照 AI 2020）：柱形／堆积柱形／条形／堆积条形图的长条换成设计；不给参数＝开对话框；一步历史 → {ok, id, replaced}', p => {
  const C = 'ai.graph.column', t = graphTarget(p); if (!t) return err(C, 'select a graph');
  if (p.design === undefined && p.type === undefined){ if (p.dialog !== false) columnDialog(t); return {ok:true, dialog:'graphColumn', current:clone(t.g.graph.columnDesign || null)}; }
  if (!COLUMN_KINDS.includes(t.g.graph.kind)) return err(C, 'column designs apply to column and bar graphs');
  const spec = t.g.graph, cur = spec.columnDesign || {};
  if (p.design === null || p.design === '' || p.design === 'none'){ delete spec.columnDesign; }
  else {
    const name = p.design !== undefined ? String(p.design) : cur.name; if (!designByName(name)) return err(C, `no design \`${name}\``);
    const type = p.type !== undefined ? p.type : (cur.type || 'vertical'); if (!COL_TYPES.some(x => x[0] === type)) return err(C, 'type must be vertical|uniform|repeating|sliding');
    const fraction = p.fraction !== undefined ? p.fraction : (cur.fraction || 'scale'); if (!['scale', 'chop'].includes(fraction)) return err(C, 'fraction must be scale|chop');
    spec.columnDesign = {name, type, unit:Math.max(1e-6, num(p.unit, cur.unit === undefined ? 10 : cur.unit)), fraction, rotateLegend:p.rotateLegend !== undefined ? !!p.rotateLegend : !!cur.rotateLegend};
  }
  regenGraph(t.g); Layer.invalidate(t.L);
  const replaced = JSON.stringify(t.g.children).split('"Column Design"').length - 1;
  return {ok:true, id:t.g.id, replaced};
}, {undoable:true});
function columnDialog(t){
  const cur = t.g.graph.columnDesign || {}; let fm;
  modal('graphColumn', L3('圖表直條', '图表列', 'Graph Column'), b => {
    fm = form(b, [{k:'design', label:L3('選擇直條設計：', '选取列设计：', 'Choose Column Design:'), type:'select', value:cur.name || 'none', options:[['none', L3('無', '无', 'None')]].concat(M().designs.map(d => [d.name, d.name]))},
      {k:'type', label:L3('直條類型：', '列类型：', 'Column Type:'), type:'select', value:cur.type || 'vertical', options:COL_TYPES},
      {k:'rotateLegend', label:L3('旋轉圖例設計', '旋转图例设计', 'Rotate Legend Design'), type:'check', value:!!cur.rotateLegend},
      {k:'unit', label:L3('每個設計表示：', '每个设计表示：', 'Each Design Represents:'), type:'number', value:cur.unit === undefined ? 10 : cur.unit, min:0.001},
      {k:'fraction', label:L3('分數：', '对于分数：', 'For Fractions:'), type:'select', value:cur.fraction || 'scale', options:[['scale', L3('縮放設計', '缩放设计', 'Scale Design')], ['chop', L3('截斷設計', '截断设计', 'Chop Design')]]}]);
    if (!M().designs.length) b.appendChild(el('div', {class:'note', text:T(L3('還沒有設計：先用「物件 ▸ 圖表 ▸ 設計…」建立。', '还没有设计：先用「对象 ▸ 图表 ▸ 设计…」建立。', 'No designs yet: make one with Object ▸ Graph ▸ Design….'))}));
  }, [{label:L3('取消', '取消', 'Cancel'), act:'cancel'}, {label:L3('確定', '确定', 'OK'), pri:true, act:'ok', run:() => { const v = fm.values(); return CMD.run('ai.graph.column', {id:t.g.id, layerId:t.L.id, design:v.design === 'none' ? null : v.design, type:v.type, unit:v.unit, fraction:v.fraction, rotateLegend:v.rotateLegend}); }}]);
}
reg('ai.graph.marker', '{id?: 图表, design?: 设计名|null（null＝换回方块）} 对象 ▸ 图表 ▸ 标记…（原码 todo，照 AI 2020）：折线／散点／雷达图的标记点换成设计（设计缩到标记方块的 2.5 倍、置中）；不给参数＝开对话框；一步历史 → {ok, id, replaced}', p => {
  const C = 'ai.graph.marker', t = graphTarget(p); if (!t) return err(C, 'select a graph');
  if (p.design === undefined){ if (p.dialog !== false){ let fm; modal('graphMarker', L3('圖表標記', '图表标记', 'Graph Marker'), b => { fm = form(b, [{k:'design', label:L3('選擇標記設計：', '选取标记设计：', 'Choose Marker Design:'), type:'select', value:(t.g.graph.markerDesign || {}).name || 'none', options:[['none', L3('無', '无', 'None')]].concat(M().designs.map(d => [d.name, d.name]))}]); },
    [{label:L3('取消', '取消', 'Cancel'), act:'cancel'}, {label:L3('確定', '确定', 'OK'), pri:true, act:'ok', run:() => { const v = fm.values(); return CMD.run(C, {id:t.g.id, layerId:t.L.id, design:v.design === 'none' ? null : v.design}); }}]); }
    return {ok:true, dialog:'graphMarker', current:clone(t.g.graph.markerDesign || null)}; }
  if (!MARKER_KINDS.includes(t.g.graph.kind)) return err(C, 'marker designs apply to line, scatter and radar graphs');
  if (p.design === null || p.design === '' || p.design === 'none') delete t.g.graph.markerDesign;
  else { if (!designByName(p.design)) return err(C, `no design \`${p.design}\``); t.g.graph.markerDesign = {name:String(p.design)}; }
  regenGraph(t.g); Layer.invalidate(t.L);
  return {ok:true, id:t.g.id, replaced:JSON.stringify(t.g.children).split('"Marker Design"').length - 1};
}, {undoable:true});

/* ═══════════════════════════════════════════════════════════════════
   文字 ▸ 视觉边距对齐方式（原码 todo ⇒ 照 AI：标点〔引号、连字号、句逗点…〕整个吊到边界外、某些字母〔A T V W Y…〕稍微凸出，让边缘「看起来」齐）
   设定记在文字层 data.opticalMargin；画的时候本档接手（包 renderLayer），用 AiType.layoutOf 的字位、每行头尾按吊出量平移。
   ═══════════════════════════════════════════════════════════════════ */
const HANG = Object.assign(Object.fromEntries(Array.from('"\'“”‘’«»‹›「」『』、。，．,.-‐‑').map(c => [c, 1])), Object.fromEntries(Array.from(':;!?–—…（）()').map(c => [c, 0.5])),
  Object.fromEntries(Array.from('AJTVWYvwy').map(c => [c, 0.1])), Object.fromEntries(Array.from('OQCGo').map(c => [c, 0.04])));
const hangOf = ch => HANG[ch] || 0;
function opticalLayout(L){
  const lay = AiType.layoutOf(L), d = L.data;
  if (!d.opticalMargin || lay.onPath || lay.vertical) return lay;
  const byLine = lay.lines.map(l => lay.glyphs.filter(g => g.i >= l.start && g.i < l.end && !/\s/.test(g.ch)));
  const shift = new Map();
  byLine.forEach(gs => {
    if (!gs.length) return;
    const first = gs[0], last = gs[gs.length - 1];
    const left = first.adv * hangOf(first.ch), right = last.adv * hangOf(last.ch);
    const dx = d.align === 'right' ? right : d.align === 'center' ? (right - left) / 2 : -left;
    if (Math.abs(dx) > 1e-9) gs.forEach(g => shift.set(g, dx));
  });
  return Object.assign({}, lay, {glyphs:lay.glyphs.map(g => shift.has(g) ? Object.assign({}, g, {m:[g.m[0], g.m[1], g.m[2], g.m[3], g.m[4] + shift.get(g), g.m[5]]}) : g)});
}
AiMisc.opticalLayout = opticalLayout;
function renderOptical(L, scale){
  if (L._cache && L._cacheScale === scale) return L._cache;
  const W = Math.max(1, Math.round(Doc.width * scale)), H = Math.max(1, Math.round(Doc.height * scale));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), d = L.data;
  x.font = `${d.weight || 'normal'} ${d.size}px ${d.font}`; x.fillStyle = d.color; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  for (const g of opticalLayout(L).glyphs){
    if (/\s/.test(g.ch) || /\p{Cc}/u.test(g.ch) || g.ch === '­') continue;
    const m = g.m; x.setTransform(m[0] * scale, m[1] * scale, m[2] * scale, m[3] * scale, m[4] * scale, m[5] * scale); x.fillText(g.ch, 0, 0);
  }
  L._cache = c; L._cacheScale = scale;
  return c;
}
(function hookOpticalRender(){
  const o = window.renderLayer; if (typeof o !== 'function' || o.__aiMiscOptical) return;
  const w = function(L, scale){
    if (L && L.kind === 'text' && L.data && L.data.opticalMargin && window.AiType && AiType.layoutOf && !(window.TouchType && TouchType.touched && TouchType.touched(L))) return renderOptical(L, scale);
    return o.apply(this, arguments);
  };
  w.__aiMiscOptical = true; w.__aiType = o.__aiType;
  window.renderLayer = w;
})();
const textTargets = p => (window.AiType && AiType.textTargets) ? AiType.textTargets(p || {}) : [Doc.active()].filter(L => L && L.kind === 'text');
reg('ai.type.opticalMarginAlignment', '{on?: bool（缺省＝切换）, ids?|layerId?} 文字 ▸ 视觉边距对齐方式（原码 todo，照 AI）：标点整个吊到边界外、A T V W Y 等字母稍微凸出；记在文字层 data.opticalMargin、一步历史 → {ok, ids, on}', p => {
  const C = 'ai.type.opticalMarginAlignment', t = textTargets(p); if (!t.length) return err(C, 'no text objects selected');
  const on = typeof p.on === 'boolean' ? p.on : !t[0].data.opticalMargin;
  t.forEach(L => { if (on) L.data.opticalMargin = true; else delete L.data.opticalMargin; Layer.invalidate(L); });
  return {ok:true, ids:t.map(L => L.id), on};
}, {undoable:true});
AiMisc.opticalOn = () => { const t = textTargets({}); return !!(t[0] && t[0].data.opticalMargin); };

/* ═══════════════════════════════════════════════════════════════════
   选择 ▸ 启动全局编辑（原码 todo ⇒ 照 AI 2020「全局编辑」）
   选一个物件 → 文件里「长得一样」的物件（同种类、同几何；选项：外观相同／大小相同）一起框起来；之后改其中那一个（主物件），
   改的外观与几何（相对它原本外框的变化）同步套到其它的；再点一次菜单（停止全局编辑）结束。
   ═══════════════════════════════════════════════════════════════════ */
const STYLE_SYNC = ['fill', 'stroke', 'strokeWidth', 'opacity', 'blend', 'dash', 'lineCap', 'lineJoin', 'miterLimit', 'strokeAlign', 'effects', 'appearance', 'graphicStyle', 'arrowStart', 'arrowEnd', 'widthProfile', 'brush'];
function geomSig(s, sizeToo){
  const R = R3(); const b = AIObj.shapeBounds(s, p => p, false); if (!b) return null;
  const w = Math.max(b.x1 - b.x0, 1e-9), h = Math.max(b.y1 - b.y0, 1e-9);
  const pts = []; R.walk([s], n => { const v = R.isLeaf(n) && VecSel.asBezier(n); if (v && v.anchors) v.anchors.forEach(a => pts.push([(a.x - b.x0) / w, (a.y - b.y0) / h])); });
  const q = v => Math.round(v * 200) / 200;
  return s.type + '|' + pts.map(p => q(p[0]) + ',' + q(p[1])).join(';') + (sizeToo ? `|${q(w)}x${q(h)}` : `|r${q(w / h)}`);
}
const styleSig = s => JSON.stringify(STYLE_SYNC.map(k => s[k] === undefined ? null : s[k]));
const GE = {
  on:false, master:null, others:[], base:null,
  stop(silent){ this.on = false; this.master = null; this.others = []; this.base = null; if (!silent) refresh(); },
  find(id){ const h = R3() && R3().findDeep(id); return h ? h : null; }
};
AiMisc.globalEdit = GE;
function bbox(s){ return AIObj.shapeBounds(s, p => p, false); }
function geStart(p){
  const C = 'ai.select.startGlobalEdit', L = R3() && R3().vLayer(p); if (!L) return err(C, 'select an object on a vector layer');
  const ids = Array.isArray(p.ids) ? p.ids : (VecSel.layerId === L.id ? VecSel.shapes : []);
  const m = L.data.shapes.find(s => ids.includes(s.id)); if (!m) return err(C, 'select an object');
  const appearance = !!p.appearance, size = !!p.size, sig = geomSig(m, size), st = styleSig(m);
  const others = [];
  Doc.layers.forEach(Ly => { if (Ly.kind !== 'vector' || Ly.locked) return; Ly.data.shapes.forEach(s => { if (s === m || s.locked || s.graph) return; if (geomSig(s, size) === sig && (!appearance || styleSig(s) === st)) others.push({L:Ly.id, id:s.id}); }); });
  GE.on = true; GE.master = {L:L.id, id:m.id}; GE.others = others; GE.base = {m:clone(m), o:others.map(o => clone(GE.find(o.id).s))}; GE.opts = {appearance, size};
  VecSel.setShapes(L.id, [m.id].concat(others.filter(o => o.L === L.id).map(o => o.id)));
  refresh();
  return {ok:true, master:m.id, similar:others.map(o => o.id)};
}
/* 主物件改了 ⇒ 套到其它：外观照抄；几何＝新主物件经「原外框 → 各自原外框」的仿射 */
function geSync(){
  if (!GE.on || GE._busy) return 0;
  const hm = GE.find(GE.master.id); if (!hm){ GE.stop(true); return 0; }
  const m = hm.s, before = GE.base.m;
  if (JSON.stringify(m) === JSON.stringify(before)) return 0;
  GE._busy = true; let n = 0;
  try {
    const b0 = bbox(before), styleChanged = styleSig(m) !== styleSig(before);
    GE.others.forEach((o, i) => {
      const h = GE.find(o.id); if (!h) return; const ob = GE.base.o[i], bo = bbox(ob); if (!b0 || !bo) return;
      const sx = (bo.x1 - bo.x0) / Math.max(b0.x1 - b0.x0, 1e-9), sy = (bo.y1 - bo.y0) / Math.max(b0.y1 - b0.y0, 1e-9);
      const mtx = [sx, 0, 0, sy, bo.x0 - b0.x0 * sx, bo.y0 - b0.y0 * sy];     // 主物件原外框 → 这个物件原外框（各自的图层坐标）
      const geomChanged = JSON.stringify(Object.assign({}, m, Object.fromEntries(STYLE_SYNC.map(k => [k, null])))) !== JSON.stringify(Object.assign({}, before, Object.fromEntries(STYLE_SYNC.map(k => [k, null]))));
      const keepId = h.s.id, keepStyle = Object.fromEntries(STYLE_SYNC.map(k => [k, h.s[k]]));
      let next = h.s;
      if (geomChanged){ next = R3().xformDeep(R3().reid(m), mtx); next.id = keepId; if (!styleChanged) STYLE_SYNC.forEach(k => { if (keepStyle[k] === undefined) delete next[k]; else next[k] = keepStyle[k]; }); }
      if (styleChanged) STYLE_SYNC.forEach(k => { if (m[k] === undefined) delete next[k]; else next[k] = clone(m[k]); });
      if (next !== h.s){ h.arr[h.idx] = next; }
      Layer.invalidate(h.L); n++;
      GE.base.o[i] = clone(next);
    });
    GE.base.m = clone(m);
  } finally { GE._busy = false; }
  return n;
}
AiMisc.geSync = geSync;
window.addEventListener('dl:change', e => {
  if (!GE.on) return;
  const c = e.detail && e.detail.cmd;
  if (c === 'edit.undo' || c === 'edit.redo' || c === 'project.load' || c === 'file.new'){   // 退回／重做：照现在的样子重新当基准
    const hm = GE.find(GE.master.id); if (!hm){ GE.stop(true); return; }
    GE.base = {m:clone(hm.s), o:GE.others.map(o => { const h = GE.find(o.id); return h ? clone(h.s) : null; })}; return;
  }
  if (geSync()) refresh();
});
reg('ai.select.startGlobalEdit', '{ids?: 主物件（缺省＝选中的第一个）, appearance?: bool（外观也要相同）, size?: bool（大小也要相同）| stop?: true} 选择 ▸ 启动全局编辑（原码 todo，照 AI 2020）：' +
  '找出文件里同种类、同几何的物件一起选中；之后改主物件（外观、锚点、变形）会同步套到它们（同一步历史）；已在全局编辑中再叫一次（或 stop:true）＝停止 → {ok, master, similar} | {ok, stopped:true}', p => {
  if (p.stop || (GE.on && p.ids === undefined && p.appearance === undefined && p.size === undefined)){ GE.stop(); return {ok:true, stopped:true}; }
  return geStart(p);
});
reg('ai.select.globalEditState', '{} 全局编辑状态 → {ok, on, master, similar}', () => ({ok:true, on:GE.on, master:GE.master && GE.master.id, similar:GE.others.map(o => o.id)}));
/* 全局编辑中：其它物件画一圈蓝框（照 AI 的提示框） */
function geOverlay(ctx, s){
  if (!GE.on) return;
  ctx.save(); ctx.strokeStyle = '#2d9bff'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
  GE.others.forEach(o => { const h = GE.find(o.id); if (!h) return; const b = bbox(h.s); if (!b) return; ctx.strokeRect((b.x0 + h.L.x) * s - 2, (b.y0 + h.L.y) * s - 2, (b.x1 - b.x0) * s + 4, (b.y1 - b.y0) * s + 4); });
  ctx.restore();
}

/* ═══════════════════════════════════════════════════════════════════
   视图 ▸ 标尺 ▸ 显示视频标尺（原码 todo ⇒ 照 AI：沿画板上缘与左缘的像素标尺〔视频裁切区〕＋动作安全区 90%／标题安全区 80%＋中心十字）
   视图 ▸ 对齐字形（原码 todo ⇒ 照 AI 2020「对齐字形」：画东西时吸到文字的基线、x 高度、大写高度、上缘、下缘、字的左右边）
   ═══════════════════════════════════════════════════════════════════ */
const LS_VIEW = 'dlcanvas.ai.miscView';
const VIEW = (() => { try { return Object.assign({videoRulers:false, snapToGlyph:false}, JSON.parse(localStorage.getItem(LS_VIEW) || '{}')); } catch(e){ return {videoRulers:false, snapToGlyph:false}; } })();
const saveView = () => { try { localStorage.setItem(LS_VIEW, JSON.stringify(VIEW)); } catch(e){} };
AiMisc.view = VIEW;
function videoOverlay(ctx, s){
  if (!VIEW.videoRulers || !window.Menubar || Menubar.app !== 'ai') return;
  const W = Doc.width, H = Doc.height, dpr = 1;
  ctx.save();
  const band = 14;
  ctx.fillStyle = 'rgba(30,30,30,.82)'; ctx.fillRect(0, 0, W * s, band); ctx.fillRect(0, 0, band, H * s);
  ctx.strokeStyle = '#ccc'; ctx.fillStyle = '#ddd'; ctx.lineWidth = 1; ctx.font = '9px sans-serif'; ctx.textBaseline = 'top';
  const step = [10, 20, 50, 100, 200, 500, 1000].find(v => v * s >= 50) || 1000;
  for (let x = 0; x <= W + 1e-6; x += step / 5){ const X = Math.round(x * s) + 0.5, major = Math.abs(x / step - Math.round(x / step)) < 1e-9; ctx.beginPath(); ctx.moveTo(X, band); ctx.lineTo(X, major ? 0 : band - 4); ctx.stroke(); if (major && x > 0) ctx.fillText(String(Math.round(x)), X + 2, 1); }
  for (let y = 0; y <= H + 1e-6; y += step / 5){ const Y = Math.round(y * s) + 0.5, major = Math.abs(y / step - Math.round(y / step)) < 1e-9; ctx.beginPath(); ctx.moveTo(band, Y); ctx.lineTo(major ? 0 : band - 4, Y); ctx.stroke(); if (major && y > 0){ ctx.save(); ctx.translate(1, Y + 2); ctx.rotate(Math.PI / 2); ctx.fillText(String(Math.round(y)), 0, -10); ctx.restore(); } }
  ctx.setLineDash([6, 4]);
  [[0.9, 'rgba(0,200,255,.9)'], [0.8, 'rgba(255,160,0,.9)']].forEach(([k, col]) => { ctx.strokeStyle = col; ctx.strokeRect(W * (1 - k) / 2 * s + 0.5, H * (1 - k) / 2 * s + 0.5, W * k * s, H * k * s); });
  ctx.setLineDash([]); ctx.strokeStyle = 'rgba(0,200,255,.9)';
  const cx = W / 2 * s, cy = H / 2 * s; ctx.beginPath(); ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10); ctx.stroke();
  void dpr; ctx.restore();
}
reg('ai.view.rulers.video', '{on?: bool（缺省＝切换）} 视图 ▸ 标尺 ▸ 显示／隐藏视频标尺（原码 todo，照 AI）：画板上缘与左缘的像素标尺、动作安全区（90%）与标题安全区（80%）框、中心十字；记在浏览器 → {ok, on}', p => {
  VIEW.videoRulers = typeof p.on === 'boolean' ? p.on : !VIEW.videoRulers; saveView(); refresh(); return {ok:true, on:VIEW.videoRulers};
});
/* 字形参考线（文件坐标）：每行的基线／x 高／大写高／上缘／下缘（横线）＋每个字的左右边（直线） */
const _mc = document.createElement('canvas').getContext('2d');
function glyphGuides(L){
  if (!L || L.kind !== 'text' || !window.AiType || !AiType.layoutOf) return null;
  const d = L.data, lay = AiType.layoutOf(L); if (lay.onPath || lay.vertical) return {xs:[], ys:[], points:[]};
  _mc.font = `${d.weight || 'normal'} ${d.size}px ${d.font}`;
  const mx = _mc.measureText('x'), mH = _mc.measureText('H');
  const xh = mx.actualBoundingBoxAscent || d.size * 0.5, cap = mH.actualBoundingBoxAscent || d.size * 0.7;
  const ys = [], xs = [], points = [];
  lay.lines.forEach(l => {
    const gs = lay.glyphs.filter(g => g.i >= l.start && g.i < l.end); if (!gs.length) return;
    const base = gs[0].m[5];
    [['baseline', base], ['xHeight', base - xh], ['capHeight', base - cap], ['ascender', base - lay.asc], ['descender', base + lay.desc]].forEach(([k, y]) => ys.push([y, k]));
    gs.forEach(g => { if (/\s/.test(g.ch)) return; const x0 = g.m[4], x1 = g.m[4] + g.adv; xs.push([x0, 'glyph']); xs.push([x1, 'glyph']); points.push([[x0, base], 'glyph']); points.push([[x1, base], 'glyph']); });
  });
  return {xs, ys, points};
}
reg('ai.view.snapToGlyph', '{on?: bool（缺省＝切换）} 视图 ▸ 对齐字形（原码 todo，照 AI 2020）：打勾时画形状／画板（吸附走智能参考线的工具）会吸到文字的基线、x 高度、大写高度、上缘、下缘与每个字的左右边；记在浏览器 → {ok, on}', p => {
  VIEW.snapToGlyph = typeof p.on === 'boolean' ? p.on : !VIEW.snapToGlyph; saveView(); return {ok:true, on:VIEW.snapToGlyph};
});
reg('ai.view.glyphGuides', '{layerId?: 文字层（缺省＝全部文字层）} 对齐字形用的参考线（文件坐标）→ {ok, guides:[{layerId, xs:[[x, kind]], ys:[[y, kind]]}]}', p => {
  const Ls = p.layerId ? [Doc.byId(p.layerId)] : Doc.layers.filter(L => L.kind === 'text' && L.visible !== false);
  return {ok:true, guides:Ls.map(L => { const g = glyphGuides(L); return g ? {layerId:L.id, xs:g.xs, ys:g.ys} : null; }).filter(Boolean)};
});
(function hookGlyphSnap(){
  const R = window.RectTool; if (!R || R.__aiMiscGlyph) return; R.__aiMiscGlyph = true;
  const c0 = R.collectTargets;
  R.collectTargets = function(){
    const t = c0.apply(this, arguments);
    if (!VIEW.snapToGlyph) return t;
    Doc.layers.forEach(L => { if (L.kind !== 'text' || L.visible === false) return; const g = glyphGuides(L); if (!g) return;
      g.points.forEach(([p, k]) => t.points.push([p, k]));
      g.ys.forEach(([y, k]) => t.ys.push([y, [g.xs.length ? g.xs[0][0] : 0, y], k]));
      g.xs.forEach(([x, k]) => t.xs.push([x, [x, g.ys.length ? g.ys[0][0] : 0], k])); });
    return t;
  };
})();

/* ═══════════════════════════════════════════════════════════════════
   窗口 ▸ SVG 交互（原码 todo ⇒ 照 AI 2020 的「SVG 互动」面板）：给选中的物件挂 JavaScript 事件（onclick、onmouseover…）、文件链接 JS 档；导出 SVG 时写进去
   ═══════════════════════════════════════════════════════════════════ */
const SVG_EVENTS = ['onfocusin', 'onfocusout', 'onactivate', 'onmousedown', 'onmouseup', 'onclick', 'onmouseover', 'onmousemove', 'onmouseout', 'onkeydown', 'onkeypress', 'onkeyup', 'onload', 'onerror', 'onabort', 'onunload', 'onzoom', 'onresize', 'onscroll'];
function svgTargets(p){
  const L = R3() && R3().vLayer(p); if (!L) return {L:null, S:[]};
  const ids = Array.isArray(p.ids) ? p.ids : p.id ? [p.id] : (VecSel.layerId === L.id ? VecSel.shapes : []);
  const S = ids.map(id => { const h = R3().findDeep(id, L); return h && h.s; }).filter(Boolean);
  return {L, S};
}
reg('ai.svgInteractivity.set', '{event: onclick|onmouseover|…, script: JavaScript（""＝拿掉这个事件）, ids?|id?|layerId?} SVG 交互面板：给选中的物件挂事件（导出 SVG 时写成属性）；一步历史 → {ok, ids, events}', p => {
  const C = 'ai.svgInteractivity.set', t = svgTargets(p); if (!t.S.length) return err(C, 'select an object');
  if (!SVG_EVENTS.includes(p.event)) return err(C, `event must be one of ${SVG_EVENTS.join(', ')}`);
  const js = String(p.script === undefined ? '' : p.script);
  t.S.forEach(s => { const e = Object.assign({}, s.svgEvents || {}); if (js.trim()) e[p.event] = js; else delete e[p.event]; if (Object.keys(e).length) s.svgEvents = e; else delete s.svgEvents; });
  Layer.invalidate(t.L);
  return {ok:true, ids:t.S.map(s => s.id), events:clone(t.S[0].svgEvents || {})};
}, {undoable:true});
reg('ai.svgInteractivity.clear', '{ids?|id?|layerId?} SVG 交互面板 ▸ 清除事件：拿掉选中物件的全部事件；一步历史 → {ok, ids}', p => {
  const t = svgTargets(p); if (!t.S.length) return err('ai.svgInteractivity.clear', 'select an object');
  t.S.forEach(s => delete s.svgEvents); return {ok:true, ids:t.S.map(s => s.id)};
}, {undoable:true});
reg('ai.svgInteractivity.get', '{id?|layerId?} 选中物件的事件 → {ok, id, events, scripts:[文件链接的 JS]}', p => {
  const t = svgTargets(p); const s = t.S[0]; return {ok:true, id:s ? s.id : null, events:clone((s && s.svgEvents) || {}), scripts:M().svgScripts.slice()};
});
reg('ai.svgInteractivity.scripts', '{add?: JS 档网址, remove?: 网址, clear?: true} SVG 交互面板 ▸ 链接 JavaScript 文件…：文件级的 JS 档清单（导出 SVG 写成 <script xlink:href>）；一步历史 → {ok, scripts}', p => {
  const C = 'ai.svgInteractivity.scripts', S = M().svgScripts;
  if (p.add === undefined && p.remove === undefined && !p.clear) return {ok:true, scripts:S.slice()};
  History.push();
  if (p.clear) S.length = 0;
  if (typeof p.add === 'string' && p.add.trim()){ const u = p.add.trim(); if (/^\s*javascript:/i.test(u)){ History.past.pop(); return err(C, 'give a file address, not javascript:'); } if (!S.includes(u)) S.push(u); }
  if (typeof p.remove === 'string'){ const i = S.indexOf(p.remove); if (i >= 0) S.splice(i, 1); }
  SiteHooks.later && SiteHooks.later(C);
  return {ok:true, scripts:S.slice()};
});
/* 导出 SVG：有事件的物件包一层 <g id 事件…>；文件链接的 JS 写在开头 */
const escA = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
let _svgOut = false;
(function hookSvg(){
  const OR = window.ObjRender; if (!OR || OR.__aiMiscSvg) return; OR.__aiMiscSvg = true;
  const h0 = OR.handles, t0 = OR.toSVG;
  const has = s => !!(s && s.svgEvents && Object.keys(s.svgEvents).length);
  OR.handles = function(s){ return (_svgOut && has(s)) || h0.apply(this, arguments); };
  OR.toSVG = function(s){
    if (!has(s)) return t0.apply(this, arguments);
    const ev = s.svgEvents; let inner;
    const keep = s.svgEvents; delete s.svgEvents;
    try { inner = t0.call(this, s); } finally { s.svgEvents = keep; }
    return `<g id="${escA(s.id)}"${Object.keys(ev).filter(k => SVG_EVENTS.includes(k)).map(k => ` ${k}="${escA(ev[k])}"`).join('')}>${inner}</g>`;
  };
  if (window.Project && !Project.__aiMiscSvg){ Project.__aiMiscSvg = true; const s0 = Project.toSVG;
    Project.toSVG = function(){ _svgOut = true; let out; try { out = s0.apply(this, arguments); } finally { _svgOut = false; }
      const S = (Doc.aiMisc && Doc.aiMisc.svgScripts) || [];
      if (S.length && typeof out === 'string'){ out = out.replace(/<svg\b([^>]*)>/, (m, a) => `<svg${/xmlns:xlink=/.test(a) ? a : a + ' xmlns:xlink="http://www.w3.org/1999/xlink"'}>\n` + S.map(u => `<script type="text/ecmascript" xlink:href="${escA(u)}"/>`).join('\n')); }
      return out; }; }
})();
function svgPanel(){
  const P = window.DlPanels; if (!P || P.has('aiSvgInteractivity')) return;
  P.define('aiSvgInteractivity', {title:L3('SVG 互動', 'SVG 交互', 'SVG Interactivity'), w:300, h:330, only:'vector',
    refresh(b){
      if (P.typing && P.typing(b)) return;
      ensureStyle(); b.innerHTML = ''; b.classList.add('aim-pn');
      const g = CMD.run('ai.svgInteractivity.get', {}), st = AiMisc.svgUI = AiMisc.svgUI || {event:'onclick'};
      const evSel = el('select', {dataset:{k:'event'}}); SVG_EVENTS.forEach(e => evSel.appendChild(el('option', {value:e, text:e}))); evSel.value = st.event;
      const js = el('input', {type:'text', dataset:{k:'script'}, placeholder:'alert("hi")', style:'flex:1', disabled:!g.id});
      js.value = (g.events && g.events[st.event]) || '';
      evSel.onchange = () => { st.event = evSel.value; js.value = (g.events && g.events[st.event]) || ''; };
      js.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); const r = CMD.run('ai.svgInteractivity.set', {event:evSel.value, script:js.value}); if (r && r.ok === false) toast(r.error); refresh(); } });
      b.appendChild(el('div', {class:'row'}, [el('span', {text:T(L3('事件：', '事件：', 'Event:'))}), evSel]));
      b.appendChild(el('div', {class:'row'}, [el('span', {text:'JavaScript：'}), js]));
      b.appendChild(el('div', {class:'row'}, [el('button', {text:T(L3('套用', '应用', 'Apply')), dataset:{act:'apply'}, disabled:!g.id, onclick:() => { const r = CMD.run('ai.svgInteractivity.set', {event:evSel.value, script:js.value}); if (r && r.ok === false) toast(r.error); refresh(); }}),
        el('button', {text:T(L3('清除事件', '清除事件', 'Clear Events')), dataset:{act:'clear'}, disabled:!g.id, onclick:() => { CMD.run('ai.svgInteractivity.clear', {}); refresh(); }})]));
      const lst = el('div', {class:'lst', dataset:{k:'events'}});
      Object.entries(g.events || {}).forEach(([k, v]) => lst.appendChild(el('div', {class:'li', dataset:{event:k}, onclick:() => { st.event = k; P.refresh('aiSvgInteractivity'); }}, [el('b', {text:k}), el('span', {text:v})])));
      if (!g.id) lst.appendChild(el('div', {class:'hint', text:T(L3('選取一個物件來加上事件。', '选中一个对象来添加事件。', 'Select an object to add events.'))}));
      b.appendChild(lst);
      b.appendChild(el('div', {class:'hint', style:'margin-top:8px', text:T(L3('連結的 JavaScript 檔案：', '链接的 JavaScript 文件：', 'Linked JavaScript files:'))}));
      const sl = el('div', {class:'lst', dataset:{k:'scripts'}, style:'min-height:30px'});
      (g.scripts || []).forEach(u => sl.appendChild(el('div', {class:'li', dataset:{script:u}}, [el('span', {text:u, style:'flex:1;overflow:hidden;text-overflow:ellipsis'}), el('button', {text:'✕', onclick:() => { CMD.run('ai.svgInteractivity.scripts', {remove:u}); refresh(); }})])));
      b.appendChild(sl);
      const url = el('input', {type:'text', placeholder:'https://…/script.js', dataset:{k:'scriptUrl'}, style:'flex:1'});
      b.appendChild(el('div', {class:'row'}, [url, el('button', {text:T(L3('加入', '添加', 'Add')), dataset:{act:'addScript'}, onclick:() => { const r = CMD.run('ai.svgInteractivity.scripts', {add:url.value}); if (r && r.ok === false) toast(r.error); refresh(); }})]));
    }});
}
reg('ai.window.panel.svgInteractivity', '{on?: bool} 窗口 ▸ SVG 交互（原码 todo，照 AI 2020）：开关浮动面板（事件＋JavaScript、清除事件、链接 JavaScript 文件）；资料命令 ai.svgInteractivity.* → {ok, open}', p => {
  svgPanel(); const P = window.DlPanels; if (!P) return err('ai.window.panel.svgInteractivity', 'panels are not loaded');
  const on = typeof p.on === 'boolean' ? p.on : !P.isOpen('aiSvgInteractivity'); if (on) P.open('aiSvgInteractivity'); else P.close('aiSvgInteractivity'); return {ok:true, open:P.isOpen('aiSvgInteractivity')};
});

/* ═══════════════════════════════════════════════════════════════════
   窗口 ▸ 变量（原码 todo ⇒ 照 AI 2020「变量」面板）：变量（文字字串／可见度／链接文件／图表数据）绑到物件；拍「资料组」；切资料组＝把每个变量的值套回物件。
   资料存 Doc.aiMisc.vars／sets／setCur；变量库汇出／汇入＝AI 的 XML（variableSets，trait：textcontent／visibility／fileref／graphdata）。
   ═══════════════════════════════════════════════════════════════════ */
const VAR_TYPES = {text:{trait:'textcontent', n:L3('文字字串', '文本字符串', 'Text String')}, visibility:{trait:'visibility', n:L3('可見度', '可见度', 'Visibility')},
  linkedFile:{trait:'fileref', n:L3('連結檔案', '链接文件', 'Linked File')}, graph:{trait:'graphdata', n:L3('圖表資料', '图表数据', 'Graph Data')}, none:{trait:'', n:L3('無類型（未繫結）', '无类型（未绑定）', 'No Type (Unbound)')}};
function bindTarget(type, p){
  if (type === 'text'){ const t = textTargets(p); return t[0] ? {layerId:t[0].id} : null; }
  if (type === 'linkedFile'){ const L = p.layerId ? Doc.byId(p.layerId) : Doc.active(); return L && (L.kind === 'raster' || L.kind === 'smart') ? {layerId:L.id} : null; }
  if (type === 'graph'){ const t = graphTarget(p); return t ? {layerId:t.L.id, shapeId:t.g.id} : null; }
  if (type === 'visibility'){
    const L = p.layerId ? Doc.byId(p.layerId) : (VecSel.layer() || Doc.active()); if (!L) return null;
    if (L.kind === 'vector'){ const id = (Array.isArray(p.ids) ? p.ids : VecSel.layerId === L.id ? VecSel.shapes : [])[0]; return id ? {layerId:L.id, shapeId:id} : {layerId:L.id}; }
    return {layerId:L.id};
  }
  return null;
}
function boundObj(v){
  if (!v || !v.bind) return null;
  const L = Doc.byId(v.bind.layerId); if (!L) return null;
  if (v.bind.shapeId){ const h = R3() && R3().findDeep(v.bind.shapeId, L); return h ? {L, s:h.s, h} : null; }
  return {L};
}
function readVar(v){
  const o = boundObj(v); if (!o) return null;
  if (v.type === 'text') return o.L.kind === 'text' ? String(o.L.data.text) : null;
  if (v.type === 'visibility') return o.s ? o.s.visible !== false : o.L.visible !== false;
  if (v.type === 'linkedFile'){ const s = o.L.src; return s ? (s.url || (s.file_id ? 'file_id:' + s.file_id : '')) : ''; }
  if (v.type === 'graph'){ if (!o.s || !o.s.graph) return null; const g = o.s.graph; return {series:clone(g.series), categories:clone(g.categories), rows:clone(g.rows)}; }
  return null;
}
async function writeVar(v, val){
  const o = boundObj(v); if (!o || val === null || val === undefined) return false;
  if (v.type === 'text'){ if (o.L.kind !== 'text') return false; o.L.data.text = String(val); Layer.invalidate(o.L); return true; }
  if (v.type === 'visibility'){ const on = val === true || val === 'true'; if (o.s){ if (on) delete o.s.visible; else o.s.visible = false; } else o.L.visible = on; Layer.invalidate(o.L); return true; }
  if (v.type === 'graph'){ if (!o.s || !o.s.graph) return false; Object.assign(o.s.graph, {series:clone(val.series || []), categories:clone(val.categories || []), rows:clone(val.rows || [])}); regenGraph(o.s); Layer.invalidate(o.L); return true; }
  if (v.type === 'linkedFile'){
    const s = String(val || ''); if (!s) return false;
    if (s.startsWith('file_id:')){ const fid = s.slice(8), h = window.__dlSiteHooks; if (!h || !h.resolveRef) return false; const u = await h.resolveRef({file_id:fid}); const url = typeof u === 'string' ? u : u && u.url; if (!url) return false; const r = CMD.map['ai.links.relink'].run({id:o.L.id, url, file_id:fid}); if (window.AiWindow && AiWindow.lastRelink) await AiWindow.lastRelink; return !(r && r.ok === false); }
    const r = CMD.map['ai.links.relink'] ? CMD.map['ai.links.relink'].run({id:o.L.id, url:s}) : {ok:false}; if (window.AiWindow && AiWindow.lastRelink) await AiWindow.lastRelink; return !(r && r.ok === false);
  }
  return false;
}
const varsJson = () => { const m = M(); return {ok:true, vars:m.vars.map(v => ({name:v.name, type:v.type, bind:clone(v.bind || null), value:readVar(v)})), sets:m.sets.map(s => s.name), current:m.setCur}; };
const varByName = n => M().vars.find(v => v.name === n) || null;
const newVarName = () => { let i = 1; while (varByName('Variable' + i)) i++; return 'Variable' + i; };
reg('ai.variables.list', '{} 变量面板：变量（名字、类型、绑到哪个物件、目前的值）、资料组名、目前资料组 → {ok, vars, sets, current}', () => varsJson());
reg('ai.variables.new', '{name?（缺省 VariableN）, type?: "none"|"text"|"visibility"|"linkedFile"|"graph"} 变量面板 ▸ 新建变量（不绑定）→ {ok, name}', p => {
  const C = 'ai.variables.new', type = p.type || 'none'; if (!VAR_TYPES[type]) return err(C, 'type must be none|text|visibility|linkedFile|graph');
  const name = p.name ? String(p.name).trim() : newVarName(); if (!/^[A-Za-z_][\w.-]*$/.test(name)) return err(C, 'a variable name starts with a letter or _ and has no spaces (XML name)'); if (varByName(name)) return err(C, `a variable named \`${name}\` already exists`);
  History.push(); M().vars.push({name, type, bind:null}); SiteHooks.later && SiteHooks.later(C); return {ok:true, name};
});
reg('ai.variables.bind', '{type: "text"|"visibility"|"linkedFile"|"graph", name?: 变量（缺省＝新建一个；存在就改绑）, ids?|layerId?|id?: 物件（缺省＝选中的）} 变量面板 ▸ 建立文字／可见度／链接文件／图表的动态（把选中的物件绑到变量）→ {ok, name, bind}', p => {
  const C = 'ai.variables.bind', type = p.type; if (!['text', 'visibility', 'linkedFile', 'graph'].includes(type)) return err(C, 'type must be text|visibility|linkedFile|graph');
  const bind = bindTarget(type, p); if (!bind) return err(C, type === 'text' ? 'select a text object' : type === 'graph' ? 'select a graph' : type === 'linkedFile' ? 'select a placed image' : 'select an object');
  History.push();
  let v = p.name ? varByName(p.name) : null;
  if (!v){ const name = p.name ? String(p.name).trim() : newVarName(); if (!/^[A-Za-z_][\w.-]*$/.test(name)){ History.past.pop(); return err(C, 'bad variable name'); } v = {name, type, bind:null}; M().vars.push(v); }
  M().vars.forEach(o => { if (o !== v && o.bind && JSON.stringify(o.bind) === JSON.stringify(bind) && o.type === type) o.bind = null; });   // 一个物件的同一种特性只绑一个变量
  v.type = type; v.bind = bind;
  SiteHooks.later && SiteHooks.later(C);
  return {ok:true, name:v.name, bind:clone(bind)};
});
reg('ai.variables.unbind', '{name} 变量面板 ▸ 解除绑定变量 → {ok}', p => { const v = varByName(p.name); if (!v) return err('ai.variables.unbind', `no variable \`${p.name}\``); History.push(); v.bind = null; v.type = 'none'; SiteHooks.later && SiteHooks.later('ai.variables.unbind'); return {ok:true}; });
reg('ai.variables.delete', '{name} 变量面板 ▸ 删除变量（资料组里它的值一起拿掉）→ {ok}', p => {
  const m = M(), i = m.vars.findIndex(v => v.name === p.name); if (i < 0) return err('ai.variables.delete', `no variable \`${p.name}\``);
  History.push(); m.vars.splice(i, 1); m.sets.forEach(s => delete s.values[p.name]); SiteHooks.later && SiteHooks.later('ai.variables.delete'); return {ok:true};
});
reg('ai.variables.rename', '{name, to} 变量选项：改名（资料组跟着）→ {ok}', p => {
  const v = varByName(p.name), to = String(p.to || '').trim(); if (!v) return err('ai.variables.rename', `no variable \`${p.name}\``);
  if (!/^[A-Za-z_][\w.-]*$/.test(to) || (to !== v.name && varByName(to))) return err('ai.variables.rename', 'bad or taken name');
  History.push(); M().sets.forEach(s => { if (p.name in s.values){ s.values[to] = s.values[p.name]; delete s.values[p.name]; } }); v.name = to; SiteHooks.later && SiteHooks.later('ai.variables.rename'); return {ok:true};
});
reg('ai.variables.capture', '{name?: 资料组名（缺省「资料组 N」）} 变量面板 ▸ 拍摄资料组：记下每个已绑定变量的目前值 → {ok, name, index}', p => {
  const m = M(); if (!m.vars.some(v => v.bind)) return err('ai.variables.capture', 'bind some variables first');
  let name = p.name ? String(p.name).trim() : ''; if (!name){ let i = m.sets.length + 1; while (m.sets.some(s => s.name === T(L3('資料組 ', '数据组 ', 'Data Set ')) + i)) i++; name = T(L3('資料組 ', '数据组 ', 'Data Set ')) + i; }
  if (m.sets.some(s => s.name === name)) return err('ai.variables.capture', `a data set named \`${name}\` already exists`);
  History.push();
  const values = {}; m.vars.forEach(v => { if (v.bind){ const x = readVar(v); if (x !== null) values[v.name] = x; } });
  m.sets.push({name, values}); m.setCur = m.sets.length - 1;
  SiteHooks.later && SiteHooks.later('ai.variables.capture');
  return {ok:true, name, index:m.setCur};
});
async function applySet(i){
  const m = M(), s = m.sets[i]; if (!s) return {ok:false, error:'ai.variables.apply: no such data set'};
  History.push();
  let n = 0; for (const v of m.vars) if (v.bind && (v.name in s.values)) if (await writeVar(v, s.values[v.name])) n++;
  m.setCur = i; refresh(); SiteHooks.later && SiteHooks.later('ai.variables.apply');
  return {ok:true, name:s.name, index:i, applied:n};
}
const setIndex = p => { const m = M(); if (typeof p.set === 'number') return p.set; if (typeof p.set === 'string') return m.sets.findIndex(s => s.name === p.set); return -1; };
reg('ai.variables.apply', '{set: 资料组名或索引（0 起）} 变量面板 ▸ 切到资料组：把每个变量的值套回绑定的物件（文字、可见度、链接文件、图表数据）；一步历史 → Promise<{ok, name, index, applied}>', p => {
  const i = setIndex(p); if (i < 0) return err('ai.variables.apply', `no data set \`${p.set}\``); return (AiMisc.lastApply = applySet(i));
});
reg('ai.variables.next', '{} 变量面板 ▸ 下一个资料组 → Promise<{ok, name, index}>', () => { const m = M(); if (!m.sets.length) return err('ai.variables.next', 'no data sets'); return (AiMisc.lastApply = applySet((m.setCur + 1 + m.sets.length) % m.sets.length)); });
reg('ai.variables.prev', '{} 变量面板 ▸ 上一个资料组 → Promise<{ok, name, index}>', () => { const m = M(); if (!m.sets.length) return err('ai.variables.prev', 'no data sets'); return (AiMisc.lastApply = applySet((m.setCur - 1 + m.sets.length) % m.sets.length)); });
reg('ai.variables.deleteSet', '{set} 变量面板 ▸ 删除资料组 → {ok}', p => { const m = M(), i = setIndex(p); if (i < 0) return err('ai.variables.deleteSet', 'no such data set'); History.push(); m.sets.splice(i, 1); m.setCur = Math.min(m.setCur, m.sets.length - 1); return {ok:true}; });
reg('ai.variables.selectBound', '{name?（缺省＝全部已绑定的）} 变量面板 ▸ 选择绑定的对象／选择所有绑定的对象 → {ok, ids}', p => {
  const vs = p.name ? [varByName(p.name)].filter(Boolean) : M().vars.filter(v => v.bind), ids = [];
  let firstL = null;
  vs.forEach(v => { const o = boundObj(v); if (!o) return; if (o.s){ if (!firstL) firstL = o.L; if (o.L === firstL) ids.push(o.s.id); } else if (!firstL){ firstL = o.L; } });
  if (!firstL) return err('ai.variables.selectBound', 'nothing bound');
  CMD.run('layer.select', {id:firstL.id}); if (ids.length) VecSel.setShapes(firstL.id, ids); refresh();
  return {ok:true, layerId:firstL.id, ids};
});
/* 变量库 XML（AI：变量面板 ▸ 存储变量库…／载入变量库…） */
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function varsToXml(){
  const m = M(), cat = t => t === 'textcontent' ? '&ns_flows;' : t === 'graphdata' ? '&ns_graphs;' : '&ns_vars;';
  const val = (v, x) => v.type === 'text' ? String(x).split('\n').map(l => `<p>${xmlEsc(l)}</p>`).join('') : v.type === 'graph' ? `<data>${xmlEsc(JSON.stringify(x))}</data>` : xmlEsc(String(x));
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 20001102//EN" "http://www.w3.org/TR/2000/CR-SVG-20001102/DTD/svg-20001102.dtd" [
\t<!ENTITY ns_graphs "http://ns.adobe.com/Graphs/1.0/">
\t<!ENTITY ns_vars "http://ns.adobe.com/Variables/1.0/">
\t<!ENTITY ns_flows "http://ns.adobe.com/Flows/1.0/">
]>
<svg>
<variableSets xmlns="&ns_vars;">
\t<variableSet locked="none" varSetName="binding1">
\t\t<variables>
${m.vars.map(v => `\t\t\t<variable varName="${xmlEsc(v.name)}" trait="${(VAR_TYPES[v.type] || VAR_TYPES.none).trait}" category="${cat((VAR_TYPES[v.type] || VAR_TYPES.none).trait)}"></variable>`).join('\n')}
\t\t</variables>
\t\t<v:sampleDataSets xmlns:v="http://ns.adobe.com/Variables/1.0/" xmlns="http://ns.adobe.com/GenericCustomNamespace/1.0/">
${m.sets.map(s => `\t\t\t<v:sampleDataSet dataSetName="${xmlEsc(s.name)}">\n${m.vars.filter(v => v.name in s.values).map(v => `\t\t\t\t<${v.name}>${val(v, s.values[v.name])}</${v.name}>`).join('\n')}\n\t\t\t</v:sampleDataSet>`).join('\n')}
\t\t</v:sampleDataSets>
\t</variableSet>
</variableSets>
</svg>
`;
}
function xmlToVars(text){
  const clean = String(text).replace(/<!DOCTYPE[\s\S]*?\]>/, '').replace(/&ns_\w+;/g, 'http://ns.adobe.com/x/');
  const doc = new DOMParser().parseFromString(clean, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('not an XML variable library');
  const TR = {textcontent:'text', visibility:'visibility', fileref:'linkedFile', graphdata:'graph'};
  const vars = [...doc.getElementsByTagNameNS('*', 'variable')].map(e => ({name:e.getAttribute('varName'), type:TR[e.getAttribute('trait')] || 'none'})).filter(v => v.name);
  const sets = [...doc.getElementsByTagNameNS('*', 'sampleDataSet')].map(e => {
    const values = {};
    [...e.children].forEach(c => { const v = vars.find(x => x.name === c.localName); if (!v) return;
      values[v.name] = v.type === 'text' ? ([...c.getElementsByTagName('p')].map(p => p.textContent).join('\n') || c.textContent) : v.type === 'visibility' ? c.textContent.trim() === 'true'
        : v.type === 'graph' ? (() => { try { return JSON.parse(c.textContent); } catch(e){ return null; } })() : c.textContent.trim(); });
    return {name:e.getAttribute('dataSetName') || 'Data Set', values};
  });
  return {vars, sets};
}
reg('ai.variables.export', '{name?: 档名} 变量面板 ▸ 存储变量库…：AI 的 XML 变量库（经 file.exportData 交出去）→ Promise<{ok, name, bytes, data}>', p => {
  const data = varsToXml(), name = (p.name || 'variables') .replace(/\.xml$/i, '') + '.xml';
  return deliver(name, data, 'application/xml').then(r => Object.assign({ok:true, data}, r || {}));
});
reg('ai.variables.import', '{data?: XML 文字（不给＝开档案挑选器）} 变量面板 ▸ 载入变量库…：加进变量（同名的换掉类型）与资料组（绑定留着）；一步历史 → {ok, vars, sets}', p => {
  const go = text => { let x; try { x = xmlToVars(text); } catch(e){ return err('ai.variables.import', e.message); }
    History.push(); const m = M();
    x.vars.forEach(v => { const o = varByName(v.name); if (o){ if (o.type !== v.type){ o.type = v.type; o.bind = null; } } else m.vars.push({name:v.name, type:v.type, bind:null}); });
    x.sets.forEach(s => { const o = m.sets.find(y => y.name === s.name); if (o) o.values = s.values; else m.sets.push(s); });
    SiteHooks.later && SiteHooks.later('ai.variables.import'); refreshVars();
    return {ok:true, vars:x.vars.map(v => v.name), sets:x.sets.map(s => s.name)}; };
  if (typeof p.data === 'string') return go(p.data);
  return (AiMisc.lastVarImport = pick('.xml,application/xml,text/xml').then(async f => f ? go(await readText(f)) : {ok:false, error:'cancelled'}));
});
function refreshVars(){ if (window.DlPanels && DlPanels.isOpen('aiVariables')) DlPanels.refresh('aiVariables'); }
const VAR_ICON = {text:'T', visibility:'👁', linkedFile:'🖼', graph:'📊', none:'○'};
function varsPanel(){
  const P = window.DlPanels; if (!P || P.has('aiVariables')) return;
  P.define('aiVariables', {title:L3('變數', '变量', 'Variables'), w:300, h:360, only:'vector',
    refresh(b){
      if (P.typing && P.typing(b)) return;
      ensureStyle(); b.innerHTML = ''; b.classList.add('aim-pn');
      const r = varsJson(), st = AiMisc.varUI = AiMisc.varUI || {sel:null};
      const run = (id, q) => { const x = CMD.run(id, q || {}); Promise.resolve(x).then(y => { if (y && y.ok === false) toast(y.error); P.refresh('aiVariables'); refresh(); }); return x; };
      const setSel = el('select', {dataset:{k:'dataSet'}, style:'flex:1'}); r.sets.forEach((n, i) => setSel.appendChild(el('option', {value:i, text:n}))); if (!r.sets.length) setSel.appendChild(el('option', {value:-1, text:T(L3('（沒有資料組）', '（没有数据组）', '(no data sets)'))}));
      setSel.value = r.current; setSel.onchange = () => run('ai.variables.apply', {set:+setSel.value});
      b.appendChild(el('div', {class:'row'}, [el('span', {text:T(L3('資料組：', '数据组：', 'Data Set:'))}), el('button', {text:'◀', dataset:{act:'prev'}, disabled:!r.sets.length, onclick:() => run('ai.variables.prev')}), setSel,
        el('button', {text:'▶', dataset:{act:'next'}, disabled:!r.sets.length, onclick:() => run('ai.variables.next')}), el('button', {text:'📷', title:T(L3('擷取資料組', '捕捉数据组', 'Capture Data Set')), dataset:{act:'capture'}, onclick:() => run('ai.variables.capture')})]));
      const lst = el('div', {class:'lst', dataset:{k:'vars'}});
      r.vars.forEach(v => lst.appendChild(el('div', {class:'li' + (st.sel === v.name ? ' on' : ''), dataset:{var:v.name}, onclick:() => { st.sel = v.name; P.refresh('aiVariables'); }, ondblclick:() => { const nn = prompt(T(L3('變數名稱：', '变量名称：', 'Variable name:')), v.name); if (nn) run('ai.variables.rename', {name:v.name, to:nn}); }},
        [el('span', {text:VAR_ICON[v.type] || '○', style:'width:18px;text-align:center'}), el('span', {text:v.name, style:'flex:1'}), el('span', {class:'hint', text:v.bind ? (v.bind.shapeId || v.bind.layerId) : ''})])));
      if (!r.vars.length) lst.appendChild(el('div', {class:'hint', text:T(L3('選取物件後按下面的按鈕建立動態。', '选中对象后按下面的按钮建立动态。', 'Select an object and use the buttons below to make it dynamic.'))}));
      b.appendChild(lst);
      const bt = (t, act, f, dis) => el('button', {text:T(t), dataset:{act}, disabled:!!dis, onclick:f});
      b.appendChild(el('div', {class:'row', style:'flex-wrap:wrap'}, [
        bt(L3('建立可見度動態', '建立动态可见性', 'Make Visibility Dynamic'), 'makeVisibility', () => { const v = st.sel && varByName(st.sel); run('ai.variables.bind', {type:'visibility', name:v && !v.bind ? v.name : undefined}); }),
        bt(L3('建立文字動態', '建立动态文本', 'Make Text Dynamic'), 'makeText', () => run('ai.variables.bind', {type:'text'})),
        bt(L3('建立圖表動態', '建立动态图表', 'Make Graph Dynamic'), 'makeGraph', () => run('ai.variables.bind', {type:'graph'})),
        bt(L3('建立連結檔案動態', '建立动态链接文件', 'Make Linked File Dynamic'), 'makeLinked', () => run('ai.variables.bind', {type:'linkedFile'}))]));
      b.appendChild(el('div', {class:'row', style:'flex-wrap:wrap'}, [
        bt(L3('解除繫結', '取消绑定', 'Unbind'), 'unbind', () => run('ai.variables.unbind', {name:st.sel}), !st.sel),
        bt(L3('新增變數', '新建变量', 'New Variable'), 'new', () => run('ai.variables.new', {})),
        bt(L3('刪除變數', '删除变量', 'Delete Variable'), 'delete', () => { run('ai.variables.delete', {name:st.sel}); st.sel = null; }, !st.sel),
        bt(L3('選取繫結的物件', '选择绑定的对象', 'Select Bound Object'), 'selectBound', () => run('ai.variables.selectBound', st.sel ? {name:st.sel} : {})),
        bt(L3('載入變數庫…', '载入变量库…', 'Load Variable Library…'), 'import', () => run('ai.variables.import', {})),
        bt(L3('儲存變數庫…', '存储变量库…', 'Save Variable Library…'), 'export', () => run('ai.variables.export', {}))]));
    }});
}
reg('ai.window.panel.variables', '{on?: bool} 窗口 ▸ 变量（原码 todo，照 AI 2020）：开关浮动面板（资料组切换／拍摄、变量清单、建立文字／可见度／图表／链接文件动态、解除绑定、新建／删除变量、选择绑定的对象、载入／存储变量库）；资料命令 ai.variables.* → {ok, open}', p => {
  varsPanel(); const P = window.DlPanels; if (!P) return err('ai.window.panel.variables', 'panels are not loaded');
  const on = typeof p.on === 'boolean' ? p.on : !P.isOpen('aiVariables'); if (on) P.open('aiVariables'); else P.close('aiVariables'); return {ok:true, open:P.isOpen('aiVariables')};
});
svgPanel(); varsPanel();

/* ═══════════ 叠画挂点（UI.overlays：间隙预览、全局编辑框、视频标尺） ═══════════ */
(function hookOverlays(){
  if (!window.UI || !Array.isArray(UI.overlays) || UI.__aiMiscOv) return; UI.__aiMiscOv = true;
  UI.overlays.push((ctx, s) => { gapOverlay(ctx, s); geOverlay(ctx, s); videoOverlay(ctx, s); });
})();
if (!window.UI || !UI.overlays) window.addEventListener('DOMContentLoaded', () => { if (window.UI && Array.isArray(UI.overlays) && !UI.__aiMiscOv){ UI.__aiMiscOv = true; UI.overlays.push((ctx, s) => { gapOverlay(ctx, s); geOverlay(ctx, s); videoOverlay(ctx, s); }); } });

/* ═══════════ 三语字串（菜单标签用：停止全局编辑、隐藏视频标尺） ═══════════ */
AiMisc.L = {geStart:L3('開始全域編輯', '启动全局编辑', 'Start Global Edit'), geStop:L3('停止全域編輯', '停止全局编辑', 'Stop Global Edit'),
  vrShow:L3('顯示視訊尺標', '显示视频标尺', 'Show Video Rulers'), vrHide:L3('隱藏視訊尺標', '隐藏视频标尺', 'Hide Video Rulers')};
})();
