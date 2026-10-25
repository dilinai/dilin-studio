/* 堤麟画板 · 顶菜单实作 · Illustrator ▸ 帮助（命令名 ai.<原码 id>）
   照 ArtCraft VectorCraft 原码逐段翻译：
     engine/src/cmd/help.rs 8-33          help.discord／website／appPage／github／links：回 {url}；菜单点下去＝开那个网址（lib.rs:470-486 open_url）
     ui-egui/src/menus.rs 938-946, 2089-2102  help.about 开「关于」、help.commandPalette 开关命令面板（Cmd+Shift+/）；「VectorCraft 帮助…」原码 todo（没有 F1）
     ui-egui/src/dialogs/about.rs         关于：图示、名字、「Version x — …」、社群连结、页尾授权
     ui-egui/src/palette.rs 9-67          命令面板：所有命令（含菜单路径 › 名字）＋工具（tool:<id>）；查询切成字、每个字都要是名字或 id 的子字串（不是模糊比对）；
                                          只列前 14 个；Enter＝跑第一个、点一列＝跑那一列；Esc 关；开着时别的快捷键不作用
   我们这边（不沿用原码的品牌与连结）：
     ■ 原码四个网址（ArtCraft 的 Discord／网站／GitHub）整组拿掉；「关于」只显示堤麟画板、版本、命令数与「第三方授权…」。
     ■ 说明（F1）＝内建三语使用者说明（说明.md 是开发笔记，不给使用者看）；第三方授权（ai.help.licenses）列 PhotoCraft／VectorCraft MIT 版权行与全文、SCOWL 字典授权，原文另放 licenses/。
     ■ PS、AI 两套菜单都有这支帮助；F1、Ctrl+Shift+/ 两套都作用。 */
(function(){
if (window.AiHelp && window.AiHelp.__loaded) return;
const T3 = o => (window.DlPanels ? DlPanels.t(o) : o.en);
const L3 = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, en:c});
/* 原码 help.rs 的 Discord／网站／应用页／GitHub 四个网址命令是 ArtCraft 自家连结 ⇒ 整组拿掉 */
const AiHelp = window.AiHelp = {__loaded:true, opened:[]};

/* ── 关于（dialogs/about.rs） ── */
const VERSION = () => (window.DilinCanvas && DilinCanvas.version) || '0.1';
CMD.reg('ai.help.about', {i18n:'', params:'{} 帮助 ▸ 关于：开「关于」视窗（版本＝堤麟画板 DilinCanvas.version）→ {ok, version}'}, () => {
  document.querySelectorAll('.aihelp-back').forEach(x => x.remove());
  const back = document.createElement('div'); back.className = 'aihelp-back';
  const box = document.createElement('div'); box.className = 'aihelp-about';
  const cmds = CMD.list().length;
  box.innerHTML = `<div class="logo">堤</div><div class="nm">堤麟画板</div>
    <div class="ver">${T3(L3('版本', '版本', 'Version'))} ${VERSION()} — ${T3(L3('網頁版像素＋向量繪圖板', '网页版像素＋矢量画板', 'web pixel + vector drawing board'))}</div>
    <div class="ver">${T3(L3('命令數', '命令数', 'Commands'))}: ${cmds}</div>
    <div class="links"></div>
    <div class="foot">© 堤麟AI</div>`;
  const links = box.querySelector('.links');
  const lk = document.createElement('div'); lk.className = 'lk'; lk.dataset.id = 'help.licenses';
  lk.textContent = T3(L3('第三方授權…', '第三方授权…', 'Third-Party Licenses…')); lk.onclick = () => CMD.run('ai.help.licenses'); links.appendChild(lk);
  const x = document.createElement('button'); x.textContent = T3(L3('關閉', '关闭', 'Close')); x.dataset.act = 'close'; x.onclick = () => back.remove(); box.appendChild(x);
  back.addEventListener('pointerdown', e => { if (e.target === back) back.remove(); });
  back.appendChild(box); document.body.appendChild(back);
  return {ok:true, version:VERSION(), dialog:'about'};
});

/* ── 说明（原码 todo ⇒ 本地说明视窗，读 说明.md） ── */
function mdToHtml(md){
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inl = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  let out = '', inCode = false, inList = false, inTable = false;
  String(md).split('\n').forEach(l => {
    if (/^```/.test(l)){ out += inCode ? '</pre>' : '<pre>'; inCode = !inCode; return; }
    if (inCode){ out += esc(l) + '\n'; return; }
    if (inList && !/^\s*[-*]\s/.test(l)){ out += '</ul>'; inList = false; }
    if (inTable && !/^\|/.test(l)){ out += '</table>'; inTable = false; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)/.exec(l))) out += `<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`;
    else if ((m = /^\s*[-*]\s+(.*)/.exec(l))){ if (!inList){ out += '<ul>'; inList = true; } out += `<li>${inl(m[1])}</li>`; }
    else if (/^\|/.test(l)){ if (/^\|[\s|:-]+\|$/.test(l)) return; if (!inTable){ out += '<table>'; inTable = true; } out += '<tr>' + l.split('|').slice(1, -1).map(c => `<td>${inl(c.trim())}</td>`).join('') + '</tr>'; }
    else if (/^>\s?/.test(l)) out += `<blockquote>${inl(l.replace(/^>\s?/, ''))}</blockquote>`;
    else if (l.trim()) out += `<p>${inl(l)}</p>`;
  });
  return out + (inList ? '</ul>' : '') + (inTable ? '</table>' : '') + (inCode ? '</pre>' : '');
}
AiHelp.mdToHtml = mdToHtml;
const HELP = () => T3({
  'zh-Hant':`# 堤麟畫板 ${VERSION()}

## 基本
- 像素圖層、文字圖層用 Photoshop 的工具列與選單；選到向量圖層時換成 Illustrator 的。
- 右鍵：圖層面板的圖層、畫布上（依目前工具）都有右鍵選單。
- 儲存：檔案 ▸ 儲存（Ctrl+S）存進雲端硬碟；畫板也會定時在這台瀏覽器留一份回復檔。

## 找功能
- 說明 ▸ 搜尋指令…（Ctrl+Shift+/）：打幾個字就能找到任何選單項目或工具。
- 工具列按鈕懸停會顯示名稱與快速鍵。

## 跟 AI 一起畫
- 在對話裡直接說要畫什麼、改哪裡；AI 跑的每一步都跟你手動按的是同一個指令，可以 Ctrl+Z 還原。
`,
  'zh-Hans':`# 堤麟画板 ${VERSION()}

## 基本
- 像素图层、文字图层用 Photoshop 的工具栏与菜单；选到矢量图层时换成 Illustrator 的。
- 右键：图层面板的图层、画布上（依当前工具）都有右键菜单。
- 存储：文件 ▸ 存储（Ctrl+S）存进云盘；画板也会定时在这台浏览器留一份恢复档。

## 找功能
- 帮助 ▸ 搜索命令…（Ctrl+Shift+/）：打几个字就能找到任何菜单项或工具。
- 工具栏按钮悬停会显示名称与快捷键。

## 跟 AI 一起画
- 在对话里直接说要画什么、改哪里；AI 跑的每一步都跟你手动按的是同一条命令，可以 Ctrl+Z 撤销。
`,
  en:`# Dilin Canvas ${VERSION()}

## Basics
- Pixel and type layers use the Photoshop toolbar and menus; selecting a vector layer switches to Illustrator's.
- Right-click layers in the Layers panel, or the canvas (depends on the current tool), for a context menu.
- Save: File ▸ Save (Ctrl+S) saves to your cloud drive; the board also keeps a recovery copy in this browser.

## Finding things
- Help ▸ Search Commands… (Ctrl+Shift+/): type a few letters to find any menu item or tool.
- Hover a toolbar button to see its name and shortcut.

## Drawing with AI
- Tell the AI what to draw or change in the chat; every step it takes is the same command you would click, so Ctrl+Z undoes it.
`});
CMD.reg('ai.help.appHelp', {i18n:'', params:'{} 帮助 ▸ 堤麟画板帮助（F1）：开说明视窗（使用者说明，三语）→ {ok, source:"builtin"}'}, () => {
  document.querySelectorAll('.aihelp-back').forEach(x => x.remove());
  const back = document.createElement('div'); back.className = 'aihelp-back';
  const box = document.createElement('div'); box.className = 'aihelp-doc'; box.dataset.source = 'builtin';
  box.innerHTML = `<div class="hd"><b>${T3(L3('堤麟畫板 說明', '堤麟画板 帮助', 'Dilin Canvas Help'))}</b><span class="x" title="close">×</span></div><div class="bd">${mdToHtml(HELP())}</div>`;
  box.querySelector('.x').onclick = () => back.remove();
  back.addEventListener('pointerdown', e => { if (e.target === back) back.remove(); });
  back.appendChild(box); document.body.appendChild(back);
  return {ok:true, source:'builtin'};
});

/* ── 第三方授权（MIT：保留原版权与授权声明；原文另放 licenses/） ── */
const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
const LICENSES = AiHelp.licenses = [
  {name:'PhotoCraft', license:'MIT License', copyright:'Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors', text:MIT_BODY},
  {name:'VectorCraft', license:'MIT License', copyright:'Copyright (c) 2026 ArtCraft Team and the VectorCraft contributors', text:MIT_BODY},
  {name:'SCOWL (English word list, spell check)', license:'SCOWL license', copyright:'Copyright 2000-2019 by Kevin Atkinson and others', file:'licenses/SCOWL-LICENSE.txt'},
];
CMD.reg('ai.help.licenses', {i18n:'', params:'{} 帮助 ▸ 第三方授权：开视窗列出本画板用到的开源专案、版权行与授权全文 → {ok, items:[{name, license}]}'}, () => {
  document.querySelectorAll('.aihelp-back').forEach(x => x.remove());
  const back = document.createElement('div'); back.className = 'aihelp-back';
  const box = document.createElement('div'); box.className = 'aihelp-doc aihelp-lic';
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  box.innerHTML = `<div class="hd"><b>${T3(L3('第三方授權', '第三方授权', 'Third-Party Licenses'))}</b><span class="x" title="close">×</span></div><div class="bd">
    <p>${T3(L3('本畫板部分功能改寫自下列開源專案，依其授權保留原版權與授權聲明。', '本画板部分功能改写自下列开源项目，依其授权保留原版权与授权声明。', 'Parts of this board are adapted from the open-source projects below; their copyright and license notices are retained as required.'))}</p>
    ${LICENSES.map(l => `<h3>${esc(l.name)} — ${esc(l.license)}</h3><pre data-lic="${esc(l.name)}">${esc(l.copyright)}${l.text ? '\n\n' + esc(l.text) : ''}</pre>`).join('')}</div>`;
  box.querySelector('.x').onclick = () => back.remove();
  back.addEventListener('pointerdown', e => { if (e.target === back) back.remove(); });
  back.appendChild(box); document.body.appendChild(back);
  LICENSES.forEach(l => { if (!l.file) return; fetch(new URL(l.file, document.baseURI).href).then(r => r.ok ? r.text() : null).then(t => { const pre = box.querySelector(`pre[data-lic="${esc(l.name)}"]`); if (t && pre) pre.textContent = t; }).catch(() => {}); });
  return {ok:true, items:LICENSES.map(l => ({name:l.name, license:l.license}))};
});
window.addEventListener('keydown', e => {
  if (e.key === 'F1' && window.Menubar){ e.preventDefault(); CMD.run('ai.help.appHelp'); }
}, true);

/* ── 命令面板（palette.rs） ── */
const Pal = AiHelp.palette = {el:null,
  items(){
    const out = [];
    if (window.MenuTrees && window.Menubar){
      MenuTrees.walk(Menubar.app, (it, path) => { if (it.sep || it.sub || !it.impl) return;
        const names = path.slice(1).map(p => Menubar.name(p)); const top = MenuTrees[Menubar.app][path[0]];
        out.push({label:[Menubar.name(top)].concat(names, [Menubar.name(it)]).join(' › '), id:typeof it.impl === 'string' ? it.impl : it.impl.cmd, item:it, key:it.key || ''}); });
    }
    const seen = new Set(out.map(o => o.id));
    CMD.list().forEach(c => { if (!seen.has(c.id)) out.push({label:c.label || (c.i18n && Lang.t(c.i18n) !== c.i18n ? Lang.t(c.i18n) : c.id), id:c.id}); });
    if (typeof TOOLS !== 'undefined' && Array.isArray(TOOLS)) TOOLS.forEach(t => { if (t && t.id && !t.sep) out.push({label:Lang.t('tool.' + t.id), id:'tool:' + t.id, key:t.key || ''}); });
    return out;
  },
  /* palette.rs:31-37：小写、空白切字，每个字都要是名字或 id 的子字串；前 14 个 */
  search(q){ const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean); return this.items().filter(o => words.every(w => o.label.toLowerCase().includes(w) || o.id.toLowerCase().includes(w))).slice(0, 14); },
  run(o){
    this.close();
    if (o.id.startsWith('tool:')){ if (window.UI) UI.pick(o.id.slice(5)); return {ok:true, tool:o.id.slice(5)}; }
    if (o.item && window.Menubar){ Menubar.run(o.item); return {ok:true, id:o.id}; }
    try { return CMD.run(o.id, {}); } catch(e){ return {ok:false, error:String(e)}; }
  },
  open(){
    this.close();
    const back = document.createElement('div'); back.className = 'aipal-back';
    const box = document.createElement('div'); box.className = 'aipal';
    const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = T3(L3('搜尋指令與工具…', '搜索命令和工具…', 'Search commands and tools…'));
    const list = document.createElement('div'); list.className = 'aipal-list';
    const render = () => { list.innerHTML = ''; this.hits = this.search(inp.value);
      this.hits.forEach((h, i) => { const r = document.createElement('div'); r.className = 'aipal-row' + (i === 0 ? ' on' : ''); r.dataset.id = h.id;
        r.innerHTML = `<span class="l"></span><span class="k"></span>`; r.querySelector('.l').textContent = h.label; r.querySelector('.k').textContent = h.key || ''; r.onclick = () => this.run(h); list.appendChild(r); }); };
    inp.addEventListener('input', render);
    inp.addEventListener('keydown', e => { e.stopPropagation();
      if (e.key === 'Enter'){ e.preventDefault(); if (this.hits && this.hits[0]) this.run(this.hits[0]); }
      else if (e.key === 'Escape'){ e.preventDefault(); this.close(); } });
    back.addEventListener('pointerdown', e => { if (e.target === back) this.close(); });
    box.appendChild(inp); box.appendChild(list); back.appendChild(box); document.body.appendChild(back);
    this.el = back; render(); inp.focus();
  },
  close(){ if (this.el){ this.el.remove(); this.el = null; } },
  toggle(){ if (this.el) this.close(); else this.open(); return !!this.el; }
};
CMD.reg('ai.help.commandPalette', {i18n:'', params:'{query?}：给 query＝只回前 14 个结果 [{id,label}]；不给＝开／关命令面板（Ctrl+Shift+/；每个字都要是名字或 id 的子字串，Enter 跑第一个）'}, p => {
  if (typeof p.query === 'string') return {ok:true, hits:Pal.search(p.query).map(h => ({id:h.id, label:h.label}))};
  return {ok:true, open:Pal.toggle()};
});
window.addEventListener('keydown', e => {
  if (!window.Menubar) return;
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === 'Slash' || e.key === '?' || e.key === '/')){ e.preventDefault(); e.stopImmediatePropagation(); CMD.run('ai.help.commandPalette'); }
}, true);
/* 面板开着时，别的快捷键不作用（shortcuts.rs:135-143） */
window.addEventListener('keydown', e => { if (Pal.el && !Pal.el.contains(e.target)){ if (e.key === 'Escape') Pal.close(); e.stopImmediatePropagation(); e.preventDefault(); } }, true);

if (!document.getElementById('aiHelpStyle')){
  const st = document.createElement('style'); st.id = 'aiHelpStyle';
  st.textContent = `.aihelp-back,.aipal-back{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center}
.aipal-back{align-items:flex-start;padding-top:90px}
.aihelp-about{width:380px;background:#2b2f36;color:#e6e8ec;border:1px solid #444a55;border-radius:8px;padding:18px;text-align:center;font:13px sans-serif;box-shadow:0 10px 32px #0008}
.aihelp-about .logo{width:44px;height:44px;margin:0 auto 6px;border-radius:10px;background:#2f7fd8;color:#fff;font-size:26px;line-height:44px;font-weight:700}
.aihelp-about .nm{font-size:22px;font-weight:600;margin-bottom:6px}.aihelp-about .ver{color:#aab2bf;margin:3px 0}
.aihelp-about .links{margin:12px 0;display:flex;flex-direction:column;gap:6px}.aihelp-about .lk{cursor:pointer;color:#8ab4ff}/*pill*/.aihelp-about .lk.pill{background:#5865F2;color:#fff;border-radius:16px;padding:6px}
.aihelp-about .foot{color:#7c8594;font-size:11px;margin:8px 0}.aihelp-about button{background:#3a404b;color:#e6e8ec;border:1px solid #4a515e;border-radius:3px;padding:4px 16px;cursor:pointer}
.aihelp-doc{width:min(760px,90vw);height:min(80vh,800px);display:flex;flex-direction:column;background:#23262c;color:#dde1e7;border:1px solid #444a55;border-radius:6px;font:13px/1.6 sans-serif;box-shadow:0 10px 32px #0008}
.aihelp-doc .hd{display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #3a3f48}.aihelp-doc .x{cursor:pointer;font-size:18px}
.aihelp-doc .bd{flex:1;overflow:auto;padding:4px 18px 18px}.aihelp-doc code{background:#1a1c20;padding:0 3px;border-radius:3px}.aihelp-doc pre{background:#1a1c20;padding:8px;overflow:auto}
.aihelp-doc table{border-collapse:collapse;margin:6px 0}.aihelp-doc td{border:1px solid #3a3f48;padding:2px 6px}.aihelp-doc blockquote{border-left:3px solid #2f7fd8;margin:4px 0;padding-left:8px;color:#aab2bf}
.aipal{width:520px;background:#2b2f36;border:1px solid #444a55;border-radius:6px;box-shadow:0 10px 32px #0008;font:13px sans-serif;color:#e6e8ec}
.aipal input{width:100%;box-sizing:border-box;background:#1d2026;color:#e6e8ec;border:0;border-bottom:1px solid #444a55;padding:9px 12px;font-size:14px;outline:none}
.aipal-row{display:flex;justify-content:space-between;padding:5px 12px;cursor:pointer}.aipal-row.on,.aipal-row:hover{background:#2f7fd8;color:#fff}.aipal-row .k{color:#9aa3b0}`;
  document.head.appendChild(st);
}
})();
