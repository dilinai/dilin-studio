/* 右面板分页
 「图层」｜「历史记录」两颗分页钮：历史记录那页直接借 ps-window.js 定义的历史记录面板（DlPanels.defs.history）的 build／refresh 画进来，
   点一列＝跳到那一步（同浮动的历史记录面板）。文件一改（UI.refresh）且这页开着就重画。 */
(function(){
  const tabs = document.getElementById('rpTabs'), paneL = document.getElementById('rpLayers'), paneH = document.getElementById('rpHistory');
  if (!tabs || !paneL || !paneH || !window.DlPanels) return;
  const T3 = o => { const l = (window.Lang && Lang.cur) || 'zh-Hans'; return l === 'zh-Hans' ? o[1] : l === 'en' ? o[2] : o[0]; };
  const hb = tabs.querySelector('[data-tab="history"]');
  const relabel = () => { hb.textContent = T3(['步驟記錄', '历史记录', 'History']); };   // 跟着界面语言（PS 繁中叫「步驟記錄」）
  relabel();
  let built = false, cur = 'layers';
  const def = () => DlPanels.defs && DlPanels.defs.history;
  const api = () => ({id:'history', body:paneH, refresh(){ draw(); }, close(){}, el:DlPanels.el ? DlPanels.el.bind(DlPanels) : null, t:T3});
  function draw(){
    const d = def(); if (!d) return;
    try { if (!built){ d.build(paneH, api()); built = true; } d.refresh(paneH, api(), 'refresh'); } catch(e){ console.error('[rp-tabs] history', e); }
  }
  function show(k){
    cur = k;
    tabs.querySelectorAll('.rptab').forEach(b => b.classList.toggle('on', b.dataset.tab === k));
    paneL.style.display = k === 'layers' ? '' : 'none';
    paneH.style.display = k === 'history' ? '' : 'none';
    if (k === 'history') draw();
  }
  tabs.addEventListener('click', e => { const b = e.target.closest('.rptab'); if (b) show(b.dataset.tab); });
  /* 别包 UI.refresh：后面载入的档会整支换掉它。改挂画面叠画（每画一次画面都走）：历史的步数／位置／语言变了才重画这一页 */
  let sig = '', lang = '';
  const tick = () => {
    const L = (window.Lang && Lang.cur) || ''; if (L !== lang){ lang = L; relabel(); if (cur === 'history') built && draw(); }
    if (cur !== 'history') return;
    const H = (typeof History !== 'undefined' && History.past) ? History : null, s = H ? H.past.length + '/' + H.future.length + '/' + (H.past.length ? H.past[H.past.length - 1]._next : '') : '';
    if (s !== sig){ sig = s; requestAnimationFrame(draw); }
  };
  if (window.UI && Array.isArray(UI.overlays)) UI.overlays.push(tick);
  // 命令跑完不一定重画画面（AI 送命令时）⇒ 历史一动也排一次检查
  if (typeof History !== 'undefined' && History.push) ['push', 'undo', 'redo', 'clear'].forEach(k => { const f = History[k]; if (typeof f !== 'function') return;
    History[k] = function(){ const o = f.apply(this, arguments); if (cur === 'history') setTimeout(tick, 0); return o; }; });
  window.addEventListener('load', () => { lang = ''; tick(); });
  window.RpTabs = {show, current:() => cur};
  if (window.CMD) CMD.reg('panel.rightTab', {i18n:'', params:'{tab:"layers"|"history"} 右面板切分页（图层｜历史记录）；不给＝只查 → {ok, tab}'}, p => { if (p && p.tab) show(p.tab === 'history' ? 'history' : 'layers'); return {ok:true, tab:cur}; });
})();
