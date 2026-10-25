/* 右面板版面（1025·平板与网页同吃这页）
   ① 右面板左缘拖拉条：拖动改宽（夹 200–480·触控也能拖）·记在 localStorage·双击回 252
   ② 分页列右端小箭头：把图层／历史记录区块收成只剩分页列，再点展开·记在 localStorage
   ③ 选项栏灰色提示字：放不下就省略号（CSS 管），滑过看全文（这里补 title） */
(function(){
  const rp = document.getElementById('rightpanel'), tabs = document.getElementById('rpTabs');
  if (!rp) return;
  const KW = 'dl.rp.width', KC = 'dl.rp.collapsed', DEF = 252, MIN = 200, MAX = 480;
  const get = k => { try { return localStorage.getItem(k); } catch(e){ return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch(e){} };
  const T3 = o => { const l = (window.Lang && Lang.cur) || 'zh-Hans'; return l === 'zh-Hans' ? o[1] : l === 'en' ? o[2] : o[0]; };
  const clamp = w => Math.max(MIN, Math.min(MAX, Math.round(w)));
  // 画布量的是 #main 里剩下的宽 ⇒ 改宽后发一次 resize 让它重排
  const relayout = () => window.dispatchEvent(new Event('resize'));
  function width(w, save){
    w = clamp(w);
    rp.style.width = w + 'px'; rp.style.flexBasis = w + 'px';
    if (save) set(KW, w === DEF ? null : String(w));
    return w;
  }
  const saved = +get(KW); if (saved) width(saved, false);

  const grip = document.createElement('div');
  grip.id = 'rpGrip'; grip.title = T3(['拖動調整寬度・雙擊還原', '拖动调整宽度・双击还原', 'Drag to resize · double-click to reset']);
  rp.parentNode.insertBefore(grip, rp);
  let drag = null;
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    drag = {x:e.clientX, w:rp.getBoundingClientRect().width, id:e.pointerId};
    try { grip.setPointerCapture(e.pointerId); } catch(_){}
    grip.classList.add('on'); document.body.classList.add('rp-resizing');
  });
  grip.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    width(drag.w + (drag.x - e.clientX), false); relayout();   // 往左拖＝变宽
  });
  const end = e => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    width(rp.getBoundingClientRect().width, true); drag = null;
    grip.classList.remove('on'); document.body.classList.remove('rp-resizing'); relayout();
  };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end); grip.addEventListener('lostpointercapture', end);
  grip.addEventListener('dblclick', () => { width(DEF, true); relayout(); });

  if (tabs){
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'rpfold'; btn.id = 'rpFold';
    const paint = () => {
      const c = rp.classList.contains('rp-collapsed');
      btn.textContent = c ? '▸' : '▾';
      btn.title = c ? T3(['展開', '展开', 'Expand']) : T3(['收起', '收起', 'Collapse']);
      btn.setAttribute('aria-expanded', c ? 'false' : 'true');
    };
    const fold = c => { rp.classList.toggle('rp-collapsed', c); set(KC, c ? '1' : null); paint(); relayout(); };
    btn.addEventListener('click', e => { e.stopPropagation(); fold(!rp.classList.contains('rp-collapsed')); });
    tabs.appendChild(btn);
    // 收着时点分页钮 ⇒ 顺手展开（点了却什么都没出来会以为坏了）
    tabs.addEventListener('click', e => { if (e.target.closest('.rptab') && rp.classList.contains('rp-collapsed')) fold(false); });
    if (get(KC) === '1') rp.classList.add('rp-collapsed');
    paint();
    window.RpLayout = {fold, width:w => width(w, true), collapsed:() => rp.classList.contains('rp-collapsed')};
  }

  const ob = document.getElementById('optBody');
  if (ob && window.MutationObserver){
    const tip = () => ob.querySelectorAll('span[style*="122, 130, 144"], span[style*="7a8290"]').forEach(s => { const t = (s.textContent || '').trim(); if (t && s.title !== t) s.title = t; });
    new MutationObserver(tip).observe(ob, {childList:true, subtree:true, characterData:true}); tip();
  }
})();
