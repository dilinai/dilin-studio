/* 堤麟画板 · 界面
   界面只做三件事：把常用命令摆成按钮、把画布画出来、把图层列出来。
   凡是「做事」一律转交 CMD —— 界面没有自己的逻辑，所以 agent 与人同一条路。 */

/* 画缩图前后要原样放回的层缓存栏（ui.js 图层面板缩图） */
const THUMB_KEEP = ['_cache', '_cacheScale', '_cacheBase', '_ppOut', '_ppKey', '_r3patKey', '_r3wrapKey', '_boldSrc', '_boldScale', '_boldR', '_boldIt', '_boldOut', '_xfSrc', '_xfKey', '_xfOut'];
const UI = {
  zoom: 1, canvas: null, ctx: null, wrap: null,

  init(){
    this.canvas = document.getElementById('view');
    this.ctx = this.canvas.getContext('2d');
    this.wrap = document.getElementById('canvasWrap');

    Lang.cur = Lang.detect();
    document.getElementById('langSel').value = Lang.cur;
    document.documentElement.lang = Lang.cur;

    this.buildToolbar();
    this.buildBlendSelect();
    this.bindMenus();
    this.bindPanels();
    this.bindCanvas();
    this.bindKeys();
    this.bindFiles();
    Lang.apply();

    CMD.run('file.new', {width:1200, height:675, background:'#ffffff'});
    SiteHooks.markSaved();       // 开机那份空白新档当基准：没动过就不算「改了没存」
    this.setTool('brush');
    this.fit();
    this.refresh();
    console.log('%c堤麟画板 0.1','color:#2f7fd8;font-weight:bold',
      '\nAI 入口： DilinCanvas.run(id, params) / DilinCanvas.listCommands() / DilinCanvas.inspect()',
      '\n命令数：', CMD.list().length);
  },

  /* ── 左工具栏：跟着当前图层的种类换 ── */
  _tbKind: null,
  /* 像素层 ⇒ Photoshop 的工具栏；矢量层 ⇒ Illustrator 的（toolbar.js／toolbar-layout.js；照抄） */
  buildToolbar(kind){
    const k = kind || ((Doc.active()||{}).kind) || 'raster';
    this._tbKind = k;
    Toolbar.build(k);
    if (window.Menubar) Menubar.build(k);   // 顶菜单同一条规矩：像素层＝PS 的、矢量层＝AI 的（menubar.js）
    // 手上这颗在这种层用不了 ⇒ 自动换成第一个能用的，不留「按了没反应」的工具
    if (!toolsFor(k).some(t => t.id === ToolState.cur)){
      // 只挑工具栏表面露着的（单行选框这类藏在格里的别被挑中、把格子翻过去）
      const faces = new Set((Toolbar.groups || []).map(g => Toolbar.surfaced(g).impl));
      const ok = t => !t.sep && faces.has(t.id);
      const first = toolsFor(k).find(t => ok(t) && t.for === k) || toolsFor(k).find(ok) || toolsFor(k).find(t => !t.sep && t.for === k) || toolsFor(k).find(t => !t.sep);
      if (first) this.setTool(first.id);
    }
  },
  /* 测试与 agent：按工具 id 选（＝人在小箭头选单里点那一项） */
  pick(id){ return Toolbar.pick(id); },
  setTool(id){
    const prev = Tools.current();
    if (prev.id && prev.id !== id && prev.onDeactivate) prev.onDeactivate();   // 例如钢笔画到一半换工具要先收笔
    ToolState.cur = id;
    Toolbar.sync(id);
    this.buildOptions(id);
    const T = Tools.get(id) || {};
    this.canvas.style.cursor = T.cursor || 'crosshair';
    // 换工具后马上重画叠画：前一颗工具的笔尖圈、取样十字不能留在画面上
    if (prev.id !== id && this.ctx){ if (this.drawView) this.drawView(); else this.draw(); }
  },
  buildOptions(id){
    const T = Tools.get(id) || {opts:[]};
    document.getElementById('optToolName').textContent = Lang.t('tool.'+id);
    const box = document.getElementById('optBody'); box.innerHTML = '';
    const add = (key, el) => {
      const l = document.createElement('label');
      l.innerHTML = `<span>${Lang.t('opt.'+key)}</span>`; l.appendChild(el); box.appendChild(l);
    };
    (T.opts||[]).forEach(o => {
      if (o === 'size'){
        const r = mk('range',{min:1,max:400,value:ToolState.size});
        const v = document.createElement('span'); v.textContent = ToolState.size;
        r.oninput = () => { ToolState.size = +r.value; v.textContent = r.value; };
        add('size', r); box.appendChild(v);
      } else if (o === 'hardness'){
        const r = mk('range',{min:0,max:100,value:ToolState.hardness*100});
        r.oninput = () => ToolState.hardness = +r.value/100;
        add('hardness', r);
      } else if (o === 'tolerance'){
        const n = mk('number',{min:0,max:255,value:ToolState.tolerance});
        n.oninput = () => ToolState.tolerance = +n.value; add('tolerance', n);
      } else if (o === 'radius'){
        const n = mk('number',{min:0,max:400,value:ToolState.radius});
        n.oninput = () => ToolState.radius = +n.value; add('radius', n);
      } else if (o === 'points'){
        const n = mk('number',{min:3,max:60,value:ToolState.points});
        n.oninput = () => ToolState.points = +n.value; add('points', n);
      } else if (o === 'fontSize'){
        const n = mk('number',{min:6,max:600,value:ToolState.fontSize});
        n.oninput = () => ToolState.fontSize = +n.value; add('fontSize', n);
      } else if (o === 'text'){
        const t = mk('text',{value:ToolState.text});
        t.oninput = () => ToolState.text = t.value; add('text', t);
      }
    });
    if (T.buildOptions) T.buildOptions(box, add, mk);     // 工具自订的控件
    if (T.hint){
      const h = document.createElement('span');
      h.style.cssText = 'color:#7a8290'; h.textContent = Lang.t(T.hint);
      box.appendChild(h);
    }
  },

  /* ── 菜单 ── */
  bindMenus(){
    document.querySelectorAll('.menu').forEach(m => {
      m.addEventListener('click', e => {
        const open = m.classList.contains('open');
        document.querySelectorAll('.menu').forEach(x => x.classList.remove('open'));
        if (!open) m.classList.add('open');
        e.stopPropagation();
      });
    });
    document.addEventListener('click', () => document.querySelectorAll('.menu').forEach(m => m.classList.remove('open')));
    document.querySelectorAll('[data-cmd]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        document.querySelectorAll('.menu').forEach(m => m.classList.remove('open'));
        try { CMD.run(el.dataset.cmd); } catch(err){ console.error(err); }
      });
    });
    document.getElementById('langSel').onchange = e => Lang.set(e.target.value);
  },

  /* ── 右面板 ── */
  buildBlendSelect(){
    const s = document.getElementById('blendSel'); s.innerHTML = '';
    // 「穿透」只有组有（PS 的图层组混合模式预设；photocraft BlendMode::PassThrough）——选到组才露出来（refresh 里切）
    ['passThrough', ...BLENDS].forEach(b => { const o=document.createElement('option'); o.value=b; o.dataset.i18n='blend.'+b; o.textContent=Lang.t('blend.'+b); if (b === 'passThrough') o.hidden = true; s.appendChild(o); });
    s.onchange = () => CMD.run('layer.set', {blend:s.value});
  },
  bindPanels(){
    const r = document.getElementById('opacityRange');
    r.oninput = () => {
      const L = Doc.active();
      if (L && Locks.blocks(L, 'all')) return;            // 全部锁定：不透明度不能改（控件也灰掉了）
      document.getElementById('opacityVal').textContent = r.value;
      if (L){ if (r._op0 === undefined) r._op0 = [L.id, L.opacity]; L.opacity = +r.value/100; this.draw(); }
    };
    // 拖的时候是即时改；放开才进历史——先放回拖之前的值，不然快照记到的是新值、Ctrl+Z 退不回去
    r.onchange = () => { const o = r._op0; r._op0 = undefined; const L = o && Doc.byId(o[0]); if (L) L.opacity = o[1]; CMD.run('layer.set', {opacity:+r.value/100}); };
    // 锁定：四颗钮都只叫 ps.layer.lockLayers（多选就多层，idsOf 处理）；按下态＝当前层那把锁开着没
    document.querySelectorAll('#lockRow .lockbtn').forEach(b => {
      const k = b.dataset.lock;
      b.innerHTML = Icons.svg('lock-' + k, 15);
      b.onclick = e => {
        e.stopPropagation();
        const L = Doc.active(); if (!L) return;
        CMD.run('ps.layer.lockLayers', {[k]: !(L.locks && L.locks[k])});
      };
    });
  },
  /* 锁定那排的按下态、全锁时其余三颗与不透明度／混合模式灰掉（PS） */
  syncLocks(L){
    const k = Locks.of(L);
    document.querySelectorAll('#lockRow .lockbtn').forEach(b => {
      const key = b.dataset.lock;
      b.classList.toggle('on', !!(L && k[key]));
      b.setAttribute('aria-pressed', L && k[key] ? 'true' : 'false');
      b.disabled = !L || (key !== 'all' && k.all);
    });
    const dis = !L || k.all;
    document.getElementById('opacityRange').disabled = !!dis;
    document.getElementById('blendSel').disabled = !!dis;
  },

  /* ── 画布事件 ── */
  bindCanvas(){
    const toDoc = e => {
      const b = this.canvas.getBoundingClientRect();
      return [ (e.clientX-b.left)/this.zoom, (e.clientY-b.top)/this.zoom ];
    };
    this.canvas.addEventListener('pointerdown', e => { this.canvas.setPointerCapture(e.pointerId); this._dragGen = (this._dragGen || 0) + 1; this._ptrId = e.pointerId; this._ptrLast = e; Pointer.onDown(e, toDoc(e)); });
    this.canvas.addEventListener('pointermove', e => { if (e.pointerId === this._ptrId) this._ptrLast = e; Pointer.onMove(e, toDoc(e)); });
    this.canvas.addEventListener('pointerup',   e => Pointer.onUp(e, toDoc(e)));
    // 触控／笔被系统收走（多指、系统手势、掌压）：浏览器发 pointercancel，坐标是 0,0 不能当收笔点。
    // 照放开收尾、收在最后一个真实落点，工具的拖曳／预览状态照常清掉、这一笔照常进历史（不会卡在「按着」）
    this.canvas.addEventListener('pointercancel', e => {
      if (e.pointerId !== this._ptrId || !Pointer.down) return;
      const l = this._ptrLast || e;
      const ev = { type:'pointercancel', cancelled:true, button:0, buttons:0, pointerId:e.pointerId, pointerType:l.pointerType,
                   clientX:l.clientX, clientY:l.clientY, pressure:l.pressure, tiltX:l.tiltX, tiltY:l.tiltY,
                   shiftKey:l.shiftKey, ctrlKey:l.ctrlKey, altKey:l.altKey, metaKey:l.metaKey, target:e.target,
                   preventDefault(){}, stopPropagation(){}, getCoalescedEvents(){ return []; } };
      this._ptrId = null; this._ptrLast = null;
      Pointer.onUp(ev, Pointer.hover || toDoc(l));
    });
    this.canvas.addEventListener('dblclick',    e => Pointer.onDblClick(e, toDoc(e)));
    this.wrap.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.wheelZoom(e);
    }, {passive:false});
  },
  bindKeys(){
    // 放开键也分派给当前工具（onKeyUp）：修饰键放开要换回游标的工具（钢笔、加／删锚点）可以不用各自挂 document 监听
    document.addEventListener('keyup', e => { const cur = Tools.current(); if (cur.onKeyUp) cur.onKeyUp(e); });
    document.addEventListener('keydown', e => {
      if (/input|select|textarea/i.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      // 工具可先接 Ctrl+Z／Shift+Z（例如钢笔画到一半退一个锚点）：onUndoKey 回 true 就吃掉
      const cur0 = Tools.current(); if ((e.ctrlKey||e.metaKey) && k==='z' && cur0.onUndoKey && cur0.onUndoKey(e)) { e.preventDefault(); return; }
      if ((e.ctrlKey||e.metaKey) && !e.altKey && k === 'z'){ e.preventDefault(); CMD.run(e.shiftKey ? 'edit.redo' : 'edit.undo'); return; } // Ctrl+Alt+Z＝切换最终状态（菜单兜底接）
      // Ctrl+Y 不当重做（照 PS 原版，Ctrl+Y＝视图 ▸ 校样颜色；重做＝Ctrl+Shift+Z）
      // PS：编辑智能对象内容（开成的分页）时 Ctrl+S＝存回那个智能对象（母文件跟着更新、分页留着），不是另存整份文件
      if ((e.ctrlKey||e.metaKey) && k === 's'){ e.preventDefault(); if (window.Smart && Smart.session && window.Docs && Docs.saveChild) Docs.saveChild(); else CMD.run(window.Smart && Smart.session && CMD.map['ps.layer.smartObjects.saveContents'] ? 'ps.layer.smartObjects.saveContents' : 'file.saveProject'); return; }
      // Ctrl+D 取消选取也清节点选取（vectorcraft select.none 清的是物件选取）；Ctrl+Shift+D 归「选择 ▸ 重新选择」（选择菜单）
      if ((e.ctrlKey||e.metaKey) && !e.shiftKey && k === 'd'){ e.preventDefault(); CMD.run('select.none'); if (window.VecSel) VecSel.clear(); this.draw(); return; }
      if ((e.ctrlKey||e.metaKey) && k === 'a'){ e.preventDefault(); CMD.run('select.all'); this.draw(); return; }
      // 当前工具要吃这颗键就先给它（钢笔的 Enter／Esc／Backspace、移动工具的 ⌥＋方向键……）——放在修饰键过滤之前
      const cur = Tools.current();
      if (cur.onKey && cur.onKey(e)) return;
      if (e.ctrlKey||e.metaKey||e.altKey) return;
      if (k === 'delete' || k === 'backspace'){ CMD.run('edit.delete'); return; }
      // 工具快捷键归工具栏管（照 PS／AI 版面上的键：同键轮换一格里的几项、X 互换前后景色、F 屏幕模式；
      // 版面上没有或对到的还没做 ⇒ 退回各工具自己登记的键：只认当前这种层看得到的那几颗，字母比 Shift、符号不比）
      if (Toolbar.onKey(e)) return;
    });
  },
  bindFiles(){
    // 本机档进画板的入口一律走 importLocalFile：有网站宿主就先问它（上传云盘／工程档交给宿主开），没有就照旧
    document.getElementById('fileInput').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      this.importLocalFile(f, 'image').catch(err => console.error(err));
      e.target.value = '';
    };
    document.getElementById('projInput').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      this.importLocalFile(f, 'project').catch(err => alert(err.message));
      e.target.value = '';
    };
    // 直接把图拖进来
    this.wrap.addEventListener('dragover', e => e.preventDefault());
    this.wrap.addEventListener('drop', e => {
      e.preventDefault();
      const f = e.dataTransfer.files[0]; if (!f) return;
      // PS：图片档拖进已开的文件＝置入嵌入对象（智能对象＋自由变换，menus/impl/ps-file.js placeDrop）；其余（.dlcanvas 等）照旧
      // 放开点（屏幕）→ 文件坐标（同 bindCanvas toDoc）：智能对象中心落在放开点（PS CC 2018 起的拖放行为）
      if (window.PsFile && PsFile.canPlaceDrop && PsFile.canPlaceDrop(f)){ const b = this.canvas.getBoundingClientRect(); PsFile.placeDrop(f, [(e.clientX - b.left) / this.zoom, (e.clientY - b.top) / this.zoom]); return; }
      this.importLocalFile(f).catch(err => console.error(err));
    });
  },
  /* 一份本机档进画板（kind 缺省看副档名：.dlcanvas＝project，其余＝image）。
     🔴 先问宿主 __dlSiteHooks.onLocalFile：回 {handled:true} 就停（例如 .dlcanvas 交给网站开，免得本机直接 Project.load 之后覆盖当前云盘档）；
        回 {handled:false, fileId?} 照旧放图，fileId（字串或 Promise）＝新像素层记成云盘素材引用。没有宿主＝行为不变。
     回 {handled:true} ／ {kind:'project'} ／ addImageFromURL 的结果。 */
  async importLocalFile(f, kind){
    const k = kind || (/\.dlcanvas$/i.test(f.name || '') ? 'project' : 'image');
    const ans = await SiteHooks.askLocal(f, k);
    if (ans.handled) return {handled:true, error:ans.error};
    if (k === 'project'){ await Project.load(JSON.parse(await f.text())); return {kind:'project'}; }
    const url = URL.createObjectURL(f);
    try {
      const r = await CMD.run('layer.addImageFromURL', {url, name:f.name, localAsked:true});
      if (r && r.id) SiteHooks.applyFileId(r.id, ans.fileId);
      return r;
    } finally { URL.revokeObjectURL(url); }
  },

  /* 滚轮／捏合缩放（ui.js 的 Ctrl＋滚轮、ps-edit.js「用滚轮缩放」共用）：绕游标点缩放（canvas.rs:1400-1404 zoom_about）
     原本每滚一格就整张重合成一次（大图一次数百毫秒），连滚几格就卡住。
     改成滚动中只用 CSS 把现有画面放大缩小（立即跟手），停手 120ms 后才照新倍率整张重画一次（PS 也是先粗后精） */
  wheelZoom(e){
    const nz = this.zoom * Math.pow(1.12, Math.max(-3, Math.min(3, -e.deltaY / (e.deltaMode ? 3 : 100))));
    this._lazyZoom = true;
    try { if (window.ZoomView) ZoomView.zoomAbout([e.clientX, e.clientY], nz); else this.setZoom(nz); }
    finally { this._lazyZoom = false; }
  },
  /* ── 画 ── */
  setZoom(z){
    this.zoom = Math.max(0.05, Math.min(64, z));   // 上限照 PS 6400%（tools/zoom.js ZOOM_MAX）
    this.canvas.style.width  = (Doc.width*this.zoom)+'px';
    this.canvas.style.height = (Doc.height*this.zoom)+'px';
    document.getElementById('stZoom').textContent = Math.round(this.zoom*100)+'%';
    clearTimeout(this._zoomTimer);
    // 放大模式里换倍率不用重合成（画面一律是 1:1 文件像素再放大）⇒ 快取还对就只重画叠画层，放多大都一样快
    const c = this._compCache;
    if (this.magnified() && c && c.key === this.compKey(1)){ this.drawView(); return; }
    if (this._lazyZoom){ this._zoomTimer = setTimeout(() => this.draw(), 120); return; }
    this.draw();
  },
  fit(){
    const pad = 48;
    const z = Math.min((this.wrap.clientWidth-pad)/Doc.width, (this.wrap.clientHeight-pad)/Doc.height, 1);
    this.setZoom(z);
  },
  draw(){
    // 画布的像素尺寸跟着缩放走：向量层因此在每个缩放级别都重算（铁律①的日常体现）
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    const s = this.zoom * dpr;
    /* 放大模式（画面倍率 s > 1）：
       原本整张图照 s 合成（16 倍＝几万像素宽，又糊又卡，所以上限只到 1600%）。
       改成照 PS：放大超过 1:1 时只合成一张 1:1 文件像素的画面，靠 CSS「像素化」放大显示 ⇒ 看得到一格一格的像素、放到 6400% 也不变慢；
       锚点、选区虚线、笔尖圈这些叠画另画在一张跟视窗一样大的透明叠画层上，照 s 画，所以线条照样细、照样清楚。 */
    const mag = s > 1, cs = mag ? 1 : s;
    /* 只是滑鼠悬停（笔刷／仿制图章／橡皮擦的笔尖圈、套索橡皮筋…）⇒ 文件没变，沿用上次合成好的画面、只重画叠画。
       1920×1280 六层带蒙版的图整张合成一次约 0.4 秒，原本每动一下滑鼠就合成一次。
       只有 Pointer.onMove 在没按着时会设 _hoverDraw；其余任何 draw（命令、按下拖动、历史…）照旧整张重合成并更新快取。 */
    const cache = this._compCache, key = this.compKey(cs);
    if (this._hoverDraw && cache && cache.key === key && cache.c.width === this.canvas.width && cache.c.height === this.canvas.height){
      if (!mag){   // 放大模式的主画布上只有合成结果、没有叠画 ⇒ 不用动
      this.ctx.save(); this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.globalAlpha = 1; this.ctx.globalCompositeOperation = 'copy';
      this.ctx.drawImage(cache.c, 0, 0); this.ctx.restore();
      }
    } else {
      this._splitLive = this.splitLayer();   // 按着拖时只有一层在变 ⇒ engine.js composite 画 #view 时沿用底下各层的快取（见 splitLayer）
      try { if (this.viewComposite) this.viewComposite(cs, this.canvas); else composite(cs, this.canvas); }
      finally { this._splitLive = null; }   // 画面合成挂点（AI 视图：轮廓／像素预览／校样…，menus/impl/ai-view.js）
      const c = (cache && cache.c) || document.createElement('canvas');
      if (c.width !== this.canvas.width || c.height !== this.canvas.height){ c.width = this.canvas.width; c.height = this.canvas.height; }
      const cx = c.getContext('2d'); cx.globalCompositeOperation = 'copy'; cx.drawImage(this.canvas, 0, 0);
      this._compCache = {c, key};
    }
    this.canvas.style.width  = (Doc.width*this.zoom)+'px';
    this.canvas.style.height = (Doc.height*this.zoom)+'px';
    this.canvas.classList.toggle('dl-pixel', mag);

    const ctx = this.octx = mag ? this.overlayCtx(s) : this.ctx;   // 叠画一律画在 UI.octx（菜单实作要另画叠画也用它）
    if (!mag) this.overlayCtx(0);
    // 选区与拖拽预览的虚线
    const dash = (x,y,w,h) => {
      ctx.save(); ctx.setLineDash([5,4]); ctx.lineWidth = 1;
      ctx.strokeStyle = '#fff'; ctx.strokeRect(x*s+.5,y*s+.5,w*s,h*s);
      ctx.strokeStyle = '#000'; ctx.setLineDash([0,4,5,0]); ctx.strokeRect(x*s+.5,y*s+.5,w*s,h*s);
      ctx.restore();
    };
    if (Doc.sel && !(window.QuickSelectTool && QuickSelectTool.live && QuickSelectTool.live.runs)) dash(Doc.sel.x, Doc.sel.y, Doc.sel.w, Doc.sel.h); // 快速选择边拖边长时旧选区框不画
    const p = Pointer.preview;
    if (p){
      const x=Math.min(p.a[0],p.b[0]), y=Math.min(p.a[1],p.b[1]);
      dash(x, y, Math.abs(p.b[0]-p.a[0]), Math.abs(p.b[1]-p.a[1]));
    }
    // 当前工具自己的叠画（钢笔的锚点把手、图章的取样十字……各在自己的档里）
    const cur = Tools.current();
    if (cur.drawOverlay && !(this.toolOverlayHidden && this.toolOverlayHidden(cur))) cur.drawOverlay(ctx, s);   // AI 视图 ▸ 隐藏渐变批注者
    // 全局叠画挂点（菜单实作用：遮罩选区行军蚁、快速蒙版红罩、AI 的参考线／网格……）：UI.overlays.push((ctx, s) => …)
    (this.overlays || []).forEach(f => { try { f(ctx, s); } catch(err){ console.error(err); } });
  },
  overlays: [],
  compKey(cs){ return cs + '|' + Doc.width + 'x' + Doc.height; },
  magnified(){ return this.zoom * Math.min(window.devicePixelRatio||1, 2) > 1; },
  /* 叠画里「把某层暂时藏起来、重画底图」用（自由变换、操控变形／液化等的预览：先藏层合成一次、再把预览画在上面）。
     一般模式 ctx 就是主画布的 context ⇒ 照旧合成进 ctx.canvas（倍率 s）；
     放大模式（画面倍率 > 1，Retina 屏放大过 50% 就是）叠画 ctx 是 overlayCtx 的代理、ctx.canvas 只是带宽高的假物件（没有 getContext）
     ⇒ 底图改合成进主画布（跟 draw 一样 1:1 文件像素、CSS 像素化放大），预览照旧画在叠画层上。
     （放大模式下自由变换一开，每次重画都在 composite 抛「out.getContext is not a function」，之后 newRaster／变形…每条命令都报错） */
  redrawBase(ctx, s){
    const c = ctx && ctx.canvas;
    if (c && typeof c.getContext === 'function') return composite(s, c);
    if (this.canvas) return composite(this.magnified() ? 1 : s, this.canvas);
    return null;
  },
  /* 只是视角变了（放大模式里平移／换倍率）：文件没变 ⇒ 当悬停画（沿用合成、只重画叠画） */
  drawView(){
    const h = this._hoverDraw; this._hoverDraw = true;
    try { this.draw(); } finally { this._hoverDraw = h; }
  },
  /* 叠画层：盖满画布区的透明画布（不接滑鼠）。s=0 ⇒ 清空收起。
     回一个 2D context 的代理：各工具照旧用「文件坐标 × s」画、照旧读 ctx.canvas.width（＝文件 × s），
     代理在底下补一个位移（画布在视窗里的位置），setTransform／resetTransform／getTransform 也都相对这个位移 ⇒ 工具的叠画码一行不用改 */
  overlayCtx(s){
    let oc = this._ov;
    if (!oc){
      if (!s) return null;
      oc = this._ov = document.createElement('canvas'); oc.className = 'dl-overlay';
      this.wrap.appendChild(oc);
    }
    const dpr = Math.min(window.devicePixelRatio||1, 2), real = oc.getContext('2d');
    if (!s){ if (oc.width > 1){ oc.width = 1; oc.height = 1; } oc.style.display = 'none'; return null; }
    oc.style.display = '';
    const W = Math.max(1, Math.round(this.wrap.clientWidth * dpr)), H = Math.max(1, Math.round(this.wrap.clientHeight * dpr));
    if (oc.width !== W || oc.height !== H){ oc.width = W; oc.height = H; }
    real.setTransform(1, 0, 0, 1, 0, 0); real.clearRect(0, 0, W, H);
    const wr = this.wrap.getBoundingClientRect(), cr = this.canvas.getBoundingClientRect();
    const flip = /scaleX\(-1\)/.test(this.canvas.style.transform || '');   // 视图 ▸ 水平翻转
    const B = flip ? new DOMMatrix([-1, 0, 0, 1, (cr.right - wr.left - this.wrap.clientLeft) * dpr, (cr.top - wr.top - this.wrap.clientTop) * dpr])
                   : new DOMMatrix([1, 0, 0, 1, (cr.left - wr.left - this.wrap.clientLeft) * dpr, (cr.top - wr.top - this.wrap.clientTop) * dpr]);
    real.setTransform(B);
    const self = this, fake = {width: Math.round(Doc.width * s), height: Math.round(Doc.height * s), style: oc.style,
      getBoundingClientRect: () => self.canvas.getBoundingClientRect()};
    const toM = a => a.length === 1 ? DOMMatrix.fromMatrix(a[0]) : (a.length ? new DOMMatrix(a) : new DOMMatrix());
    return new Proxy(real, {
      get(t, k){
        if (k === 'canvas') return fake;
        if (k === 'setTransform') return (...a) => t.setTransform(B.multiply(toM(a)));
        if (k === 'resetTransform') return () => t.setTransform(B);
        if (k === 'getTransform') return () => B.inverse().multiply(t.getTransform());
        const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
      },
      set(t, k, v){ t[k] = v; return true; }
    });
  },
  /* 按着拖（笔刷／仿制／橡皮擦画一笔、钢笔／直接选取拖锚点把手）时只有一层在变：
     ——原本每动一下整张重合成（每张像素层缩小一次约 30ms）。
     改成：这一笔按下时把「那一层底下的所有层」合成一次存起来，拖动中只叠「那一层＋它上面的层」。底下的层拖动中不会变（这几颗工具只写那一层）。
     这里只挑出「正在变的那一层」；真正的分段合成在 engine.js composite（画 #view 时），校样／分色等视图挂钩照样套在结果上。
     有组、双色调／多通道模式时回 null＝照旧整张合成 */
  splitLayer(){
    if (!Pointer.down || Doc.mode === 'duotone' || Doc.mode === 'multichannel') return null;
    if (window.Groups && Groups.any && Groups.any()) return null;
    const tool = Tools.current(), id = tool && tool.id;
    let live = null;
    if (id === 'brush' || id === 'clone' || id === 'eraser') live = Doc.active();
    else if (id === 'direct' || id === 'pen') live = (window.VecSel && VecSel.layer && VecSel.layer()) || Doc.active();
    return live && Doc.layers.includes(live) ? live : null;
  },

  refresh(){
    const L0 = Doc.active();
    // 换到另一种图层 ⇒ 工具栏跟着换
    if (L0 && L0.kind !== this._tbKind) this.buildToolbar(L0.kind);
    this.drawLayerList();
    const L = Doc.active();
    if (L){
      const bs = document.getElementById('blendSel'), pt = bs.querySelector('option[value="passThrough"]');
      if (pt) pt.hidden = L.kind !== 'group';
      bs.value = L.blend;
      const r = document.getElementById('opacityRange');
      r.value = Math.round(L.opacity*100);
      document.getElementById('opacityVal').textContent = r.value;
      document.getElementById('stLayer').textContent = `${L.name} · ${Lang.t('layer.'+L.kind)}`;
    } else document.getElementById('stLayer').textContent = '—';
    this.syncLocks(L);
    document.getElementById('stSize').textContent = `${Doc.width} × ${Doc.height}`;
    this.draw();
  },
  /* 图层面板（由上到下）：图层组是树状——组下面缩排列出子层、点小三角展开／收合（layer.setExpanded）、
     拖一列到另一列的上半／下半＝搬到它上面／下面，拖到组那列的中间＝搬进组里（layer.moveTo，photocraft layer_tree_ui.rs 的拖放）；
     Ctrl／⌘＋点＝多选（Doc.selectedIds，图层编组／转换为智能对象等多层命令用），Shift＋点＝连选；智能对象下面列出它的智能滤镜 */
  drawLayerList(){
    const box = document.getElementById('layerList'); box.innerHTML = '';
    this.layerListCSS();
    const T = Groups.tree(), rows = [];
    const walk = (list, depth) => {
      for (let i = list.length - 1; i >= 0; i--){
        const L = list[i];
        if (L.data && L.data.typeMask) continue;                 // 文字蒙版的暂存层（tools/typemaskh.js）不列
        rows.push({L, depth});
        if (L.kind === 'smart' && L.data && (L.data.filters || []).length) rows.push({L, depth:depth + 1, sf:'head'}, ...L.data.filters.map((f, k) => ({L, depth:depth + 2, sf:k})).reverse());
        if (L.kind === 'group' && L.data && L.data.expanded !== false) walk(T.of(L.id), depth + 1);
      }
    };
    walk(T.of(null), 0);
    const multi = Array.isArray(Doc.selectedIds) && Doc.selectedIds.includes(Doc.activeId) ? new Set(Doc.selectedIds) : null;
    this._layerRows = rows.filter(r => r.sf === undefined).map(r => r.L.id);
    rows.forEach(r => {
      if (r.sf !== undefined){ box.appendChild(this.smartFilterRow(r)); return; }
      const L = r.L;
      const row = document.createElement('div');
      row.className = 'lrow' + (L.id === Doc.activeId ? ' on' : '') + (multi && multi.has(L.id) && L.id !== Doc.activeId ? ' sel' : '') + (L.kind === 'group' ? ' grp' : '');
      row.dataset.id = L.id;   // 图层列带 id（菜单实作：隔离图层过滤、多选）
      row.dataset.depth = r.depth;
      if (r.depth) row.style.paddingLeft = (6 + r.depth * 16) + 'px';
      const th = document.createElement('canvas'); th.className='thumb'; th.width=30; th.height=24;
      try {
        if (L.kind === 'group') this.folderIcon(th.getContext('2d'), !!(L.data && L.data.artboard));
        else if (L.adjust){ this.adjIcon(th.getContext('2d'), L.adjust.kind); th.dataset.adj = L.adjust.kind; }   // PS：调整层缩图＝该调整的图示
        else if (L.fillLayer && L.data && L.data.canvas){ this.fillThumb(th.getContext('2d'), L); th.dataset.fill = L.fillLayer.type; }   // PS：填充层缩图＝填的颜色／渐变／图案本身（不套蒙版，蒙版另一格）
        else {
          // 缩图用的小倍率⛔ 挤掉画面那份缓存——各层缓存只留一种倍率，原本每次刷面板都把文字／像素层
          // 画面倍率那张换成 30×24 那张，下一次重画全部重渲（70 层的档一次 7～8 秒）。画完缩图把原本那份放回去（层改过的话缓存早被清空、不会放回旧的）
          // 各层包装靠「_cache 是不是我那张」认身份的记号（透视文字 _ppOut／_ppKey、拼贴 _r3patKey、绕排 _r3wrapKey、
          // 仿粗体 _bold*、文字变形 _xf*）要跟 _cache 一起放回——只放回 _cache 时透视文字认不出自己扭过的图、再扭一次（双重投影）
          const keep = {}, kr = L._scaled;
          THUMB_KEEP.forEach(k => { keep[k] = L[k]; });
          const ts = Math.min(30/Doc.width, 24/Doc.height), src = renderLayer(L, ts);
          // 像素层画布只有内容那块（engine.js LayerBox）⇒ 照位移与自己的大小摆进缩图（文件→缩图 30×24 的比例跟其他层一样）
          if (L.kind === 'raster'){ const kx = 30 / (Doc.width * ts), ky = 24 / (Doc.height * ts); th.getContext('2d').drawImage(src, L.x * ts * kx, L.y * ts * ky, L.data.canvas.width * ts * kx, L.data.canvas.height * ts * ky); }
          else th.getContext('2d').drawImage(src, 0, 0, 30, 24);
          if (keep._cache) THUMB_KEEP.forEach(k => { L[k] = keep[k]; });
          if (kr) L._scaled = kr;
          if (L.kind === 'smart') this.smartBadge(th.getContext('2d'));
        }
      } catch(e){}
      row.innerHTML = `<span class="eye">${L.visible?'◉':'○'}</span>`;
      if (L.kind === 'group'){
        const tw = document.createElement('span'); tw.className = 'tw'; tw.dataset.tw = L.id;
        tw.textContent = L.data && L.data.expanded !== false ? '▾' : '▸';
        tw.onclick = e => { e.stopPropagation(); CMD.run('layer.setExpanded', {id:L.id, all:e.altKey}); };   // ⌥＋点＝全部的组一起（group_view_cmds.rs）
        row.appendChild(tw);
      }
      // Ctrl／⌘＋点缩图＝载入这层透明度为选区（PS）；＋Shift＝加、＋Alt＝减、＋Shift＋Alt＝交集；不切当前层、不动多选。点列的其他地方 Ctrl 仍是多选
      th.onclick = e => {
        if (!(e.ctrlKey || e.metaKey)){
          // 双击缩图（PS）：单击会重画整个面板（缩图换成新元素，浏览器的 dblclick 可能接不上）⇒ 自己认「同一层缩图 450ms 内点两下」
          const now = performance.now(), k = UI._thumbClick;
          if (k && k.id === L.id && now - k.t < 450 && Math.abs(e.clientX - k.x) < 6 && Math.abs(e.clientY - k.y) < 6){
            UI._thumbClick = null; UI._thumbDbl = now; e.stopPropagation(); e.preventDefault(); this.thumbDblClick(L); return;
          }
          UI._thumbClick = {id:L.id, t:now, x:e.clientX, y:e.clientY};
          return;
        }
        e.stopPropagation(); e.preventDefault();
        this.thumbLoadSelection(L, e);
      };
      th.ondblclick = e => { e.stopPropagation(); e.preventDefault(); if (performance.now() - (UI._thumbDbl || -1e9) < 600) return; UI._thumbClick = null; this.thumbDblClick(L); };
      row.appendChild(th);
      if (window.PsLayer && PsLayer.maskThumb) PsLayer.maskThumb(L, row);   // 有图层蒙版：缩图右边多一格蒙版缩图（点它＝编辑蒙版，menus/impl/ps-layer.js）
      const nm = document.createElement('span'); nm.className='nm'; nm.textContent = L.name;
      const kk = L.kind === 'group' && L.data && L.data.artboard ? 'artboard' : L.kind;
      const kd = document.createElement('span'); kd.className='kind '+kk; kd.textContent = Lang.t('layer.'+kk);
      row.appendChild(nm); row.appendChild(kd);
      const ls = Locks.state(L);                      // 被锁的层右边一个小锁：全部锁定＝实心、部分锁＝空心（PS）
      if (ls){
        const lk = document.createElement('span');
        lk.className = 'lk lk-' + ls; lk.dataset.lock = ls;
        lk.title = ls === 'all' ? Lang.t('lock.all') : Lang.t('lock.partial');
        lk.innerHTML = Icons.svg(ls === 'all' ? 'lock-all' : 'lock-hollow', 13);
        row.appendChild(lk);
      }
      row.querySelector('.eye').onclick = e => { e.stopPropagation(); CMD.run('layer.set',{id:L.id, visible:!L.visible}); };
      nm.ondblclick = e => {
        e.stopPropagation();
        const v = prompt('', L.name); if (v) CMD.run('layer.set', {id:L.id, name:v});
      };
      row.onclick = e => this.layerRowClick(L, e);
      this.layerRowDrag(row, L);
      box.appendChild(row);
    });
  },
  /* 双击图层缩图（PS 行为；photocraft panels.rs:1702 双击整列＝改名，缩图没分开——名称区双击改名照旧）：
     智能对象＝编辑内容；文字层＝文字工具、全选文字进入编辑；调整层＝开属性面板；填充层＝开填充设定；背景层＝转成普通层；其余（像素／组／矢量）＝图层样式 */
  thumbDblClick(L){
    if (!L || !Doc.byId(L.id)) return null;
    const run = (id, p) => CMD.map[id] ? CMD.run(id, p) : {ok:false, error:'missing ' + id};
    let r;
    if (L.kind === 'smart') r = run('ps.layer.smartObjects.editContents', {id:L.id});
    else if (L.kind === 'text'){
      if (Doc.activeId !== L.id) CMD.run('layer.select', {id:L.id});
      if (ToolState.cur !== 'text'){ try { this.pick('text'); } catch (e){} if (ToolState.cur !== 'text') this.setTool('text'); }
      r = run('text.select', {layerId:L.id, all:true});
    } else if (L.adjust){
      if (Doc.activeId !== L.id) CMD.run('layer.select', {id:L.id});
      if (window.DlPanels && DlPanels.open){ DlPanels.open('properties'); r = {ok:true, panel:'properties'}; }
      else r = run('ps.layer.layerContentOptions', {id:L.id, ui:true});
    } else if (L.fillLayer) r = run('ps.layer.layerContentOptions', {id:L.id, ui:true});
    else if (L.isBackground || (window.PsLayer && PsLayer.isBackground && PsLayer.isBackground(L))){ CMD.run('layer.select', {id:L.id}); r = run('ps.layer.new.layerFromBackground', {}); }
    else r = run('ps.layer.layerStyle.blendingOptions', {id:L.id, ui:true});
    if (r && r.ok === false && r.error && window.Locks && Locks.notify) Locks.notify(r.error);
    return r;
  },
  /* 图层缩图 Ctrl／⌘＋点：走 ps.select.loadSelection（channel:'transparency', layer:那层 id），跟 agent 同一条命令、进历史一步 */
  thumbLoadSelection(L, e){
    const operation = e.shiftKey && e.altKey ? 'intersect' : e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'new';
    const r = CMD.run('ps.select.loadSelection', {channel:'transparency', layer:L.id, operation});
    if (r && r.ok === false && r.error && window.Locks && Locks.notify) Locks.notify(r.error);
    return r;
  },
  /* 点一列：一般＝选这层（清掉多选）；Ctrl／⌘＝加减多选；Shift＝从当前层连选到这层（面板上看得到的那几列）。多选写进 Doc.selectedIds（由下到上，图层菜单的 idsOf 认这个） */
  layerRowClick(L, e){
    const ids0 = Array.isArray(Doc.selectedIds) && Doc.selectedIds.includes(Doc.activeId) ? Doc.selectedIds.slice() : (Doc.activeId ? [Doc.activeId] : []);
    let ids = null;
    if (e && (e.ctrlKey || e.metaKey)){
      ids = ids0.includes(L.id) ? ids0.filter(x => x !== L.id) : ids0.concat(L.id);
      if (!ids.length) ids = [L.id];
    } else if (e && e.shiftKey && Doc.activeId){
      const vis = this._layerRows || [], a = vis.indexOf(Doc.activeId), b = vis.indexOf(L.id);
      if (a >= 0 && b >= 0) ids = vis.slice(Math.min(a, b), Math.max(a, b) + 1);
    }
    const target = ids && !ids.includes(L.id) ? ids[ids.length - 1] : L.id;
    CMD.run('layer.select', {id:target});
    Doc.selectedIds = ids && ids.length > 1 ? ids.sort((p, q) => Doc.index(p) - Doc.index(q)) : null;
    this.drawLayerList();
  },
  /* 拖放：列的上 1/4＝搬到它上面、下 1/4＝下面；组那列的中间＝搬进组里（其余层的中间按上下半） */
  layerRowDrag(row, L){
    row.draggable = true;
    const where = e => {
      const b = row.getBoundingClientRect(), t = (e.clientY - b.top) / Math.max(1, b.height);
      if (L.kind === 'group' && t > 0.25 && t < 0.75) return 'into';
      return t < 0.5 ? 'above' : 'below';
    };
    const clear = () => row.classList.remove('dropAbove', 'dropBelow', 'dropInto');
    row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'dl-layer:' + L.id); e.dataTransfer.effectAllowed = 'copyMove'; UI._dragLayer = L.id; });
    row.addEventListener('dragend', () => { UI._dragLayer = null; document.querySelectorAll('#layerList .lrow').forEach(r => r.classList.remove('dropAbove', 'dropBelow', 'dropInto')); });
    row.addEventListener('dragover', e => {
      if (!UI._dragLayer) return;
      e.preventDefault(); e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';   // 按住 Alt＝复制（游标带 +）
      clear(); const w = where(e); row.classList.add(w === 'into' ? 'dropInto' : w === 'above' ? 'dropAbove' : 'dropBelow');
    });
    row.addEventListener('dragleave', clear);
    row.addEventListener('drop', e => {
      e.preventDefault(); clear();
      const raw = (e.dataTransfer.getData('text/plain') || '');
      const id = raw.startsWith('dl-layer:') ? raw.slice(9) : UI._dragLayer;
      UI._dragLayer = null;
      if (!id || (id === L.id && !e.altKey)) return;
      // PS：按住 Alt 拖＝复制一份放到那里（原层不动）；没按＝搬
      const r = CMD.run(e.altKey && CMD.map['layer.duplicateTo'] ? 'layer.duplicateTo' : 'layer.moveTo', {id, target:L.id, position:where(e)});
      if (r && r.ok === false && r.error) Locks.notify(r.error);
    });
  },
  /* 智能对象下面的智能滤镜列（PS：「智能滤镜」一列＋每个滤镜一列，眼睛＝开关；双击滤镜名＝混合选项） */
  smartFilterRow(r){
    const L = r.L, d = L.data, row = document.createElement('div');
    row.className = 'lrow sfrow'; row.dataset.sf = r.sf === 'head' ? 'head' : String(r.sf); row.dataset.of = L.id;
    row.style.paddingLeft = (6 + r.depth * 16) + 'px';
    const eye = document.createElement('span'); eye.className = 'eye';
    const nm = document.createElement('span'); nm.className = 'nm';
    if (r.sf === 'head'){
      eye.textContent = d.filtersEnabled !== false ? '◉' : '○';
      eye.onclick = e => { e.stopPropagation(); if (CMD.map['ps.layer.smartFilter.disableSmartFilters']) CMD.run('ps.layer.smartFilter.disableSmartFilters', {id:L.id}); };
      nm.textContent = Lang.t('smart.filters');
      if (L.filterMask){ const m = document.createElement('canvas'); m.className = 'thumb'; m.width = 30; m.height = 24; try { const x = m.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 30, 24); x.drawImage(L.filterMask.data.canvas, 0, 0, 30, 24); } catch (e){} row.appendChild(eye); row.appendChild(m); row.appendChild(nm); return row; }
    } else {
      const f = d.filters[r.sf];
      eye.textContent = f.visible !== false ? '◉' : '○';
      eye.onclick = e => { e.stopPropagation(); if (CMD.map['ps.layer.smartFilter.setVisible']) CMD.run('ps.layer.smartFilter.setVisible', {id:L.id, index:r.sf}); };
      let label = null;
      try { MenuTrees.walk('ps', it => { if (!label && it.id === f.command && it.n) label = (it.n[Lang.cur] || it.n.en).replace(/…$/, ''); }); } catch (e){}
      nm.textContent = label || f.command;
      nm.ondblclick = e => { e.stopPropagation();
        // PS：双击操控变形／透视变形的滤镜名＝带着原参数再编辑；其余滤镜＝混合选项
        if ((f.command === 'layer.smartObjects.puppetWarp' || f.command === 'layer.smartObjects.perspectiveWarp') && CMD.map['ps.' + f.command]){ const x = CMD.run('ps.' + f.command, {id:L.id, index:r.sf}); if (x && x.ok === false && window.Locks && Locks.notify) Locks.notify(x.error); return; }
        // 其余 filter.* 滤镜（照 PS）：用原参数重开滤镜对话框、确定＝改参数；没对话框的才退回混合选项
        if (CMD.map['ps.layer.smartFilter.edit']) CMD.run('ps.layer.smartFilter.edit', {id:L.id, index:r.sf});
        else if (CMD.map['ps.layer.smartFilter.blendingOptions']) CMD.run('ps.layer.smartFilter.blendingOptions', {id:L.id, index:r.sf, ui:true}); };
      // PS：滤镜列右边的 ≡ 图示，双击＝这个滤镜的混合选项
      const bo = document.createElement('span'); bo.className = 'sfblend'; bo.textContent = '≡'; bo.title = Lang.cur === 'en' ? 'Double-click to edit the filter blending options' : Lang.cur === 'zh-Hans' ? '双击以编辑滤镜混合选项' : '按兩下以編輯濾鏡混合選項';
      bo.style.cssText = 'margin-left:auto;padding:0 6px;cursor:pointer;opacity:.75';
      bo.ondblclick = e => { e.stopPropagation(); if (CMD.map['ps.layer.smartFilter.blendingOptions']) CMD.run('ps.layer.smartFilter.blendingOptions', {id:L.id, index:r.sf, ui:true}); };
      row.appendChild(eye); row.appendChild(nm); row.appendChild(bo);
      row.onclick = () => CMD.run('layer.select', {id:L.id});
      return row;
    }
    row.appendChild(eye); row.appendChild(nm);
    row.onclick = () => CMD.run('layer.select', {id:L.id});
    return row;
  },
  folderIcon(x, artboard){
    x.clearRect(0, 0, 30, 24);
    x.fillStyle = artboard ? '#6c8fb8' : '#c9a35a';
    x.beginPath(); x.moveTo(4, 6); x.lineTo(12, 6); x.lineTo(14, 8); x.lineTo(26, 8); x.lineTo(26, 20); x.lineTo(4, 20); x.closePath(); x.fill();
    x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(4, 10, 22, 2);
  },
  /* 调整层缩图（PS 2020 暗色版面：整格深灰底、中间一个白线条图示，每种调整一个样子；单色，不上彩） */
  adjIcon(x, kind){
    const cw = x.canvas.width || 30, ch = x.canvas.height || 24, s = Math.min(cw / 30, ch / 24);
    x.save(); x.clearRect(0, 0, cw, ch);
    x.fillStyle = '#323232'; x.fillRect(0, 0, cw, ch); x.strokeStyle = '#5a5a5a'; x.lineWidth = 1; x.strokeRect(0.5, 0.5, cw - 1, ch - 1);
    x.translate((cw - 30 * s) / 2, (ch - 24 * s) / 2); x.scale(s, s);
    const W = '#e8e8e8', D = '#323232', G = '#8a8a8a';
    const path = (pts, close) => { x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); if (close) x.closePath(); };
    const ln = (pts, w, c) => { x.strokeStyle = c || W; x.lineWidth = w || 1.2; path(pts); x.stroke(); };
    const fillP = (pts, c) => { x.fillStyle = c || W; path(pts, true); x.fill(); };
    const circ = (cx, cy, r, fill, stroke, w) => { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); if (fill){ x.fillStyle = fill; x.fill(); } if (stroke){ x.strokeStyle = stroke; x.lineWidth = w || 1.2; x.stroke(); } };
    const box = (c) => { x.strokeStyle = c || W; x.lineWidth = 1; x.strokeRect(8.5, 4.5, 13, 15); };
    const grad = (c0, c1) => { const g = x.createLinearGradient(8, 0, 22, 0); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; };
    switch (kind){
      case 'brightnessContrast':   // 半黑半白的圆（太阳）
        circ(15, 12, 6.5, D, W); x.fillStyle = W; x.beginPath(); x.arc(15, 12, 6.5, -Math.PI / 2, Math.PI / 2); x.fill(); break;
      case 'levels':               // 直方图＋底下三个小三角
        x.fillStyle = W; [2, 4, 7, 10, 12, 9, 6, 8, 11, 5].forEach((h, i) => x.fillRect(8 + i * 1.4, 16 - h, 1.2, h));
        ln([[7.5, 16.5], [22.5, 16.5]], 1, G); fillP([[8, 21], [9.5, 18], [11, 21]], '#111'); fillP([[13.5, 21], [15, 18], [16.5, 21]], G); fillP([[19, 21], [20.5, 18], [22, 21]], W); break;
      case 'curves':               // 格线＋S 曲线
        x.strokeStyle = '#666'; x.lineWidth = 0.8; for (let i = 1; i < 4; i++){ ln([[8 + i * 3.5, 5], [8 + i * 3.5, 19]], 0.8, '#666'); ln([[8, 5 + i * 3.5], [22, 5 + i * 3.5]], 0.8, '#666'); }
        x.strokeStyle = G; x.lineWidth = 1; x.strokeRect(8, 5, 14, 14);
        x.strokeStyle = W; x.lineWidth = 1.5; x.beginPath(); x.moveTo(8, 19); x.bezierCurveTo(14, 19, 16, 5, 22, 5); x.stroke(); break;
      case 'exposure':             // 方框切对角：左上 ＋、右下 −
        box(); fillP([[22, 4], [22, 20], [8, 20]]); ln([[10, 8], [14, 8]], 1.2); ln([[12, 6], [12, 10]], 1.2); ln([[16, 16], [20, 16]], 1.4, D); break;
      case 'vibrance':             // 倒三角（V）
        x.strokeStyle = W; x.lineWidth = 1.3; path([[8, 6], [22, 6], [15, 19]], true); x.stroke(); fillP([[11.5, 8], [18.5, 8], [15, 14.5]]); break;
      case 'hueSaturation':        // 两条长条＋滑块（色相／饱和度）
        x.fillStyle = grad('#555', '#eee'); x.fillRect(7, 6, 16, 4); x.fillStyle = grad('#eee', '#555'); x.fillRect(7, 14, 16, 4);
        fillP([[11, 12.5], [12.5, 10], [14, 12.5]]); fillP([[17, 20.5], [18.5, 18], [20, 20.5]]); break;
      case 'colorBalance':         // 天平
        ln([[15, 5], [15, 19]]); ln([[9, 19], [21, 19]]); ln([[8, 8], [22, 8]]); circ(15, 5.5, 1.2, W);
        ln([[8, 8], [6.5, 13], [11.5, 13], [8, 8]], 1); ln([[22, 8], [18.5, 13], [23.5, 13], [22, 8]], 1);
        x.fillStyle = W; x.beginPath(); x.arc(9, 13, 2.5, 0, Math.PI); x.fill(); x.beginPath(); x.arc(21, 13, 2.5, 0, Math.PI); x.fill(); break;
      case 'blackWhite':           // 半黑半白的方块（对角切）
        x.fillStyle = W; x.fillRect(8, 5, 14, 14); fillP([[22, 5], [22, 19], [8, 19]], '#111'); x.strokeStyle = W; x.lineWidth = 1; x.strokeRect(8.5, 5.5, 13, 13); break;
      case 'photoFilter':          // 相机
        x.strokeStyle = W; x.lineWidth = 1.2; x.strokeRect(7.5, 8.5, 15, 10); x.fillStyle = W; x.fillRect(11, 6, 5, 2.5); x.fillRect(19, 9.5, 2, 1.5); circ(15, 13.5, 3.3, null, W, 1.2); circ(15, 13.5, 1.4, W); break;
      case 'channelMixer':         // 三个交叠的圆（RGB 混合，单色线条）
        circ(12.5, 10, 4, null, W, 1.1); circ(17.5, 10, 4, null, W, 1.1); circ(15, 14.5, 4, null, W, 1.1); break;
      case 'colorLookup':          // 格子表（3×3，深浅不一）
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++){ const v = 90 + ((i + j * 3) * 19) % 150; x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(8.3 + i * 4.6, 5.3 + j * 4.6, 3.8, 3.8); } break;
      case 'invert':               // 方块左半实、右半空
        box(); x.fillStyle = W; x.fillRect(8, 4, 7, 16); break;
      case 'posterize':            // 阶梯
        fillP([[8, 19], [8, 15], [11.5, 15], [11.5, 11.5], [15, 11.5], [15, 8], [18.5, 8], [18.5, 4.5], [22, 4.5], [22, 19]]); break;
      case 'threshold':            // 方块黑白斜切（边界锐利）
        x.fillStyle = '#111'; x.fillRect(8, 5, 14, 14); fillP([[8, 5], [22, 5], [14, 19], [8, 19]]); x.strokeStyle = W; x.lineWidth = 1; x.strokeRect(8.5, 5.5, 13, 13); break;
      case 'gradientMap':          // 黑到白的渐变条＋两个色标
        x.fillStyle = grad('#000', '#fff'); x.fillRect(7, 7, 16, 7); x.strokeStyle = W; x.lineWidth = 1; x.strokeRect(7.5, 7.5, 15, 6);
        fillP([[7.5, 19], [9, 16], [10.5, 19]], '#111'); ln([[7.5, 19], [9, 16], [10.5, 19], [7.5, 19]], 0.8); fillP([[19.5, 19], [21, 16], [22.5, 19]]); break;
      case 'selectiveColor':       // 圆分四格（深浅），外框
        [[-Math.PI / 2, 0, '#bbb'], [0, Math.PI / 2, '#777'], [Math.PI / 2, Math.PI, '#444'], [Math.PI, Math.PI * 1.5, W]].forEach(([a0, a1, c]) => { x.fillStyle = c; x.beginPath(); x.moveTo(15, 12); x.arc(15, 12, 6.5, a0, a1); x.closePath(); x.fill(); });
        circ(15, 12, 6.5, null, W, 1); break;
      default: circ(15, 12, 6.5, D, W); x.fillStyle = W; x.beginPath(); x.arc(15, 12, 6.5, -Math.PI / 2, Math.PI / 2); x.fill();
    }
    x.restore();
  },
  /* 填充层缩图（PS）：纯色＝整格色块；渐变／图案＝把填的内容缩进格子（只画填充本身，蒙版在旁边那格） */
  fillThumb(x, L){
    const cw = x.canvas.width || 30, ch = x.canvas.height || 24;
    try { if (window.PsLayer2 && PsLayer2.ensureFill) PsLayer2.ensureFill(L); } catch (e){}
    x.clearRect(0, 0, cw, ch);
    const f = L.fillLayer;
    if (f.type === 'solid'){ x.fillStyle = f.color || '#000000'; x.globalAlpha = f.alpha === undefined ? 1 : f.alpha; x.fillRect(0, 0, cw, ch); x.globalAlpha = 1; }
    else x.drawImage(L.data.canvas, 0, 0, cw, ch);
    x.strokeStyle = '#5a5a5a'; x.lineWidth = 1; x.strokeRect(0.5, 0.5, cw - 1, ch - 1);
  },
  smartBadge(x){
    x.fillStyle = 'rgba(0,0,0,.65)'; x.fillRect(19, 13, 11, 11);
    x.strokeStyle = '#fff'; x.lineWidth = 1; x.strokeRect(21.5, 15.5, 6, 6); x.beginPath(); x.moveTo(23.5, 17.5); x.lineTo(25.5, 19.5); x.stroke();
  },
  layerListCSS(){
    if (document.getElementById('dlLayerTreeCSS')) return;
    const s = document.createElement('style'); s.id = 'dlLayerTreeCSS';
    s.textContent = '#layerList .lrow .tw{width:12px;flex:0 0 12px;text-align:center;font-size:10px;opacity:.8;cursor:pointer}' +
      '#layerList .lrow.sel{background:#3b4c66}' +
      '#layerList .lrow.dropAbove{box-shadow:inset 0 2px 0 #4aa3ff}#layerList .lrow.dropBelow{box-shadow:inset 0 -2px 0 #4aa3ff}#layerList .lrow.dropInto{outline:2px solid #4aa3ff;outline-offset:-2px}' +
      '#layerList .lrow.sfrow{font-size:11px;opacity:.85;padding-top:2px;padding-bottom:2px}#layerList .lrow .kind.group{background:#6b5a2e}#layerList .lrow .kind.smart{background:#2e566b}#layerList .lrow .kind.artboard{background:#2e456b}';
    document.head.appendChild(s);
  },
  setPos(pt){ document.getElementById('stPos').textContent = `${Math.round(pt[0])}, ${Math.round(pt[1])}`; },
  fill(){ return (window.Toolbar && Toolbar.fillNone) ? 'none' : document.getElementById('fillColor').value; },
  stroke(){ return UI.strokeW() > 0 ? document.getElementById('strokeColor').value : 'none'; },
  strokeW(){ return +document.getElementById('strokeW').value || 0; },

  onLangChanged(){
    this.buildToolbar();
    this.setTool(ToolState.cur);
    this.buildBlendSelect();
    document.getElementById('blendSel').value = (Doc.active()||{}).blend || 'normal';
    this.refresh();
  }
};

function mk(type, attrs){
  const e = document.createElement('input'); e.type = type;
  Object.entries(attrs||{}).forEach(([k,v]) => e[k] = v);
  return e;
}

/* 🔴 const 宣告不会挂到 window 上，而 engine.js 里用 `window.UI` 判断要不要刷新界面。
   不挂这几个，命令跑完界面就不会更新（画得出来但看不到）。 */
window.UI = UI;
window.CMD = CMD;
window.Doc = Doc;
window.Layer = Layer;
window.Lang = Lang;
window.History = History;
window.Paint = Paint;
window.Project = Project;
window.composite = composite;
window.renderLayer = renderLayer;
window.bezierPath = bezierPath;

/* ── 给网站宿主的钩子（engine.js SiteHooks）：要等菜单档都包完 Project.load 才能包最外层 ⇒ 放在 ui.js（最后载入） ── */
if (!Project.__siteHooksLoad){
  Project.__siteHooksLoad = true;
  const load0 = Project.load;
  // 整份载完（含菜单档的后处理）才报：rev++ 发 dl:change{cmd:'project.load'}、记成已存基准、发 dl:loaded{rev, errors}
  Project.load = async function(json){
    SiteHooks._loading++;
    let r;
    try { r = await load0.apply(this, arguments); }
    finally { SiteHooks._loading--; }
    SiteHooks.force('project.load');
    SiteHooks.markSaved(SiteHooks.rev);
    const detail = {rev:SiteHooks.rev, errors:(Project.lastLoadErrors || []).slice()};
    try { window.dispatchEvent(new CustomEvent('dl:loaded', {detail})); } catch (e){ console.error(e); }
    return r;
  };
}
if (!Pointer.__siteHooks){
  Pointer.__siteHooks = true;
  const up0 = Pointer.onUp;
  Pointer.onUp = function(){ const r = up0.apply(this, arguments); SiteHooks.flushPointer(); return r; };   // 工具笔画结束才报（拖动中不报）
}
// 不走 CMD 的改动（滑杆即时改不透明度、键盘、对话框直接叫 History…）：延后一拍比对签名，没变就不发
['keyup', 'change', 'input'].forEach(t => document.addEventListener(t, () => SiteHooks.later('ui.' + t), true));
window.addEventListener('pointerup', () => { if (!Pointer.down) SiteHooks.later('ui.pointerup'); }, true);

window.addEventListener('DOMContentLoaded', () => UI.init());
window.addEventListener('resize', () => UI.draw());
