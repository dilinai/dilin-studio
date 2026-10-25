/* 堤麟画板 · 挡人手（AI 正在画时）
   罩与「〈角色〉正在畫…」提示条由网站宿主画（照搬 EditorAIShield）；
   宿主挡不到 iframe 里的滑鼠和键盘（整个 iframe inert 会连看都不能看），所以画板自己给一个开关：
     DilinCanvas.humanLock(true|false, {by?})  ／ HumanLock.set(on, {by})  ／ HumanLock.state
   规矩同网站其他编辑页：只挡改、不挡看——
     挡：画布上的编辑手势、改内容的快捷键、顶菜单里会改内容的项、选项栏、图层面板（选层也挡：角色正对着当前层下命令）、颜色、拖放与贴上；
     放行：抓手／缩放（工具、Space、中键、滚轮）、切换工具、打开菜单看、检视／视窗类菜单项、Ctrl+C、缩放快捷键。
   🔴 只挡「人」的事件（isTrusted）：角色走 CMD.run，不经事件，照跑。被挡时画板里提示一句（宿主另有提示条）。 */
const HumanLock = {
  on: false, by: '', since: 0, _tipAt: 0,
  set(on, o){
    this.on = !!on; this.by = (o && o.by) || ''; this.since = this.on ? Date.now() : 0;
    document.body.classList.toggle('dl-humanlock', this.on);
    if (this.on){
      if (window.Menubar && Menubar.close) Menubar.close();
      const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur();   // 罩落那刻把焦点挪出输入框（文字层编辑框、选项栏）
    }
    return this.state();
  },
  state(){ return {on:this.on, by:this.by, since:this.since}; },

  /* 检视类命令：罩期照样能点 */
  VIEW_CMD: /^(zoom\.|hand\.|view\.|ps\.view\.(zoom|fit|actual|print|screen|show|rulers|extras)|ai\.view\.(zoom|fit|actual|setZoom|fitArtboard|fitAll|screen|show|hide|rulers|outline|preview|pixel)|ps\.window\.|ai\.window\.|ai\.help\.|ps\.help\.)/,
  viewCmd(impl){ const id = typeof impl === 'string' ? impl : impl && impl.cmd; return !!(id && this.VIEW_CMD.test(id)); },

  /* 这一下人手要不要放行 */
  allowPointer(e){
    const t = e.target; if (!t || !t.closest) return false;
    if (t.closest('#canvasWrap')){
      if (e.button === 1) return true;                                            // 中键＝抓手
      if (window.HandTemp && HandTemp.space) return true;                         // Space＋拖
      return ToolState.cur === 'hand' || ToolState.cur === 'zoom';
    }
    if (t.closest('#statusbar')) return true;
    if (t.closest('#toolbar')) return !t.closest('.tbcolors, .tbpaint, .tbwidgets');   // 换工具算看·改前景背景色不行
    if (t.closest('.tbfly, .tbdlg')) return true;
    if (t.closest('#menubar')){
      if (t.closest('#langSel')) return true;
      return !!t.closest('.mb, .brand, .spacer, #agentHint');                     // 打开顶菜单看
    }
    const row = t.closest('.mbdd .mbi');
    if (row){
      if (row.classList.contains('has-sub') || row.classList.contains('hdr')) return true;   // 子菜单那一项只是展开
      return this.viewCmd(row.dataset.impl);
    }
    if (t.closest('.mbdd')) return true;
    if (t.closest('.dlpanel-head, .dlpanel .close')) return true;                 // 浮动面板：拖动与关闭
    return false;
  },
  allowKey(e){
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (k === ' ' || k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta') return true;
    if (mod && !e.altKey && (k === 'c' || k === 'C')) return true;               // 拷贝
    if (mod && ['=', '+', '-', '_', '0', '1'].includes(k)) return true;          // 缩放
    if (!mod && !e.altKey && ['h', 'H', 'z', 'Z', 'Tab', 'F', 'f'].includes(k)) return true;   // 抓手／缩放工具／隐藏面板／屏幕模式
    if (['PageUp', 'PageDown', 'Home', 'End'].includes(k)) return true;
    return false;
  },
  deny(e){
    e.preventDefault(); e.stopImmediatePropagation();
    const now = Date.now(); if (now - this._tipAt < 1500) return;
    this._tipAt = now;
    const msg = this.by ? Lang.t('humanlock.blockedBy').replace('{name}', this.by) : Lang.t('humanlock.blocked');
    if (window.Locks && Locks.notify) Locks.notify(msg);
  },
};
window.HumanLock = HumanLock;

Lang.add({
  'zh-Hant': {'humanlock.blocked':'AI 正在畫，這個動作先不能做。', 'humanlock.blockedBy':'{name} 正在畫，這個動作先不能做。'},
  'zh-Hans': {'humanlock.blocked':'AI 正在画，这个动作先不能做。', 'humanlock.blockedBy':'{name} 正在画，这个动作先不能做。'},
  en: {'humanlock.blocked':'AI is drawing — this action is paused for now.', 'humanlock.blockedBy':'{name} is drawing — this action is paused for now.'},
});

/* 挂在 window 的捕获阶段＝最先拿到；只看人手（isTrusted） */
for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'touchstart']){
  window.addEventListener(type, e => {
    if (!HumanLock.on || !e.isTrusted) return;
    if (!HumanLock.allowPointer(e)) HumanLock.deny(e);
  }, true);
}
for (const type of ['pointerup', 'mouseup', 'pointermove']){            // 放行的那一下照常跑完；被挡的手势后续也别交给工具
  window.addEventListener(type, e => {
    if (!HumanLock.on || !e.isTrusted) return;
    if (e.buttons && !HumanLock.allowPointer(e) && e.target && e.target.closest && e.target.closest('#canvasWrap')) e.stopImmediatePropagation();
  }, true);
}
window.addEventListener('keydown', e => { if (HumanLock.on && e.isTrusted && !HumanLock.allowKey(e)) HumanLock.deny(e); }, true);
for (const type of ['paste', 'cut', 'drop', 'dragover', 'input', 'change', 'beforeinput']){
  window.addEventListener(type, e => {
    if (!HumanLock.on || !e.isTrusted) return;
    if (e.target && e.target.closest && e.target.closest('#langSel')) return;
    HumanLock.deny(e);
  }, true);
}
