/* 堤麟画板 · 三语字典（繁體／简体／English）
   规矩：界面上每一个字都从这里取，禁止写死在版面或程式里。
   工具名按各语言的习惯叫法，不硬译。 */
const I18N = {
  'zh-Hant': {
    'ui.brand':'堤麟畫板',
    'menu.file':'檔案', 'menu.edit':'編輯', 'menu.layer':'圖層', 'menu.view':'檢視',

    'cmd.file.new':'新增文件…', 'cmd.file.open':'開啟影像…',
    'cmd.file.saveProject':'儲存專案（.dlcanvas）', 'cmd.file.openProject':'開啟專案…',
    'cmd.file.exportPNG':'匯出 PNG', 'cmd.file.exportPNG2x':'匯出 PNG（2 倍）', 'cmd.file.exportSVG':'匯出 SVG（僅向量層）',
    'cmd.edit.undo':'還原', 'cmd.edit.redo':'重做', 'cmd.edit.delete':'刪除', 'cmd.edit.duplicate':'複製圖層',
    'cmd.layer.newRaster':'新增像素圖層', 'cmd.layer.newVector':'新增向量圖層',
    'cmd.layer.bringForward':'上移一層', 'cmd.layer.sendBackward':'下移一層',
    'cmd.layer.rasterize':'點陣化向量圖層', 'cmd.layer.delete':'刪除圖層',
    'cmd.view.fit':'符合視窗', 'cmd.view.actual':'實際大小', 'cmd.view.zoomIn':'放大', 'cmd.view.zoomOut':'縮小',

    'tool.move':'移動工具', 'tool.marquee':'矩形選取', 'tool.lasso':'套索',
    'tool.brush':'筆刷', 'tool.eraser':'橡皮擦', 'tool.bucket':'油漆桶', 'tool.clone':'仿製印章',
    'ui.cloneHint':'按住 Alt 點一下取樣，再拖曳就複製過來',
    'ui.toolbarFollows':'工具列跟著你選的圖層種類換',
    'ui.penHint':'點一下＝直角點，按住拖＝曲線（Alt 只拉一邊、Shift 鎖 45°）；點回起點收合，Enter 收筆，Esc 取消，Backspace 退一點',
    'tool.pen':'鋼筆', 'tool.rect':'矩形', 'tool.ellipse':'橢圓', 'tool.star':'星形',
    'tool.text':'文字', 'tool.eyedropper':'滴管', 'tool.hand':'手形', 'tool.zoom':'縮放',

    'panel.layers':'圖層', 'panel.opacity':'不透明度', 'panel.color':'顏色',
    'panel.fill':'填色', 'panel.stroke':'筆畫', 'panel.strokeW':'筆畫寬',
    'opt.size':'筆尖大小', 'opt.hardness':'硬度', 'opt.fontSize':'字級', 'opt.text':'文字內容',
    'opt.points':'角數', 'opt.radius':'圓角', 'opt.tolerance':'容許度',

    'ui.agentReady':'AI 可操控（完整命令集）',
    'ui.onlyRaster':'像素專用', 'ui.onlyVector':'向量專用', 'ui.panelOffRaster':'像素專用：目前圖層不是像素圖層，選像素圖層才能用', 'ui.panelOffVector':'向量專用：目前圖層不是向量圖層，選向量圖層才能用',
    'ui.newDocW':'寬（像素）', 'ui.newDocH':'高（像素）',
    'layer.raster':'像素', 'layer.vector':'向量', 'layer.text':'文字',
    'layer.bg':'背景', 'layer.untitled':'圖層',
    'blend.normal':'正常', 'blend.multiply':'色彩增值', 'blend.screen':'濾色', 'blend.overlay':'覆蓋',
    'blend.darken':'變暗', 'blend.lighten':'變亮', 'blend.difference':'差異化', 'blend.hue':'色相',
    'blend.saturation':'飽和度', 'blend.color':'顏色', 'blend.luminosity':'明度',
    'blend.colorBurn':'加深顏色', 'blend.colorDodge':'加亮顏色', 'blend.linearDodge':'線性加亮 (增加)', 'blend.softLight':'柔光', 'blend.hardLight':'實光', 'blend.exclusion':'排除',
    'blend.dissolve':'溶解', 'blend.linearBurn':'線性加深', 'blend.darkerColor':'顏色變暗', 'blend.lighterColor':'顏色變亮', 'blend.vividLight':'強烈光源', 'blend.linearLight':'線性光源', 'blend.pinLight':'小光源', 'blend.hardMix':'實色疊印混合', 'blend.subtract':'減去', 'blend.divide':'分割',
    'panel.lock':'鎖定：', 'lock.transparency':'鎖定透明像素', 'lock.pixels':'鎖定影像像素', 'lock.position':'鎖定位置', 'lock.all':'全部鎖定',
    'lock.artboard':'防止自動嵌套', 'lock.partial':'部分鎖定', 'lock.denied':'無法完成要求，因為圖層「{name}」已鎖定（{lock}）。',
  },
  'zh-Hans': {
    'ui.brand':'堤麟画板',
    'menu.file':'文件', 'menu.edit':'编辑', 'menu.layer':'图层', 'menu.view':'视图',

    'cmd.file.new':'新建文档…', 'cmd.file.open':'打开图像…',
    'cmd.file.saveProject':'保存工程（.dlcanvas）', 'cmd.file.openProject':'打开工程…',
    'cmd.file.exportPNG':'导出 PNG', 'cmd.file.exportPNG2x':'导出 PNG（2 倍）', 'cmd.file.exportSVG':'导出 SVG（仅矢量层）',
    'cmd.edit.undo':'撤销', 'cmd.edit.redo':'重做', 'cmd.edit.delete':'删除', 'cmd.edit.duplicate':'复制图层',
    'cmd.layer.newRaster':'新建像素图层', 'cmd.layer.newVector':'新建矢量图层',
    'cmd.layer.bringForward':'上移一层', 'cmd.layer.sendBackward':'下移一层',
    'cmd.layer.rasterize':'栅格化矢量图层', 'cmd.layer.delete':'删除图层',
    'cmd.view.fit':'适合窗口', 'cmd.view.actual':'实际大小', 'cmd.view.zoomIn':'放大', 'cmd.view.zoomOut':'缩小',

    'tool.move':'移动工具', 'tool.marquee':'矩形选框', 'tool.lasso':'套索',
    'tool.brush':'画笔', 'tool.eraser':'橡皮擦', 'tool.bucket':'油漆桶', 'tool.clone':'仿制图章',
    'ui.cloneHint':'按住 Alt 点一下取样，再拖动就复制过来',
    'ui.toolbarFollows':'工具栏跟着你选的图层种类换',
    'ui.penHint':'点一下＝直角点，按住拖＝曲线（Alt 只拉一边、Shift 锁 45°）；点回起点闭合，Enter 收笔，Esc 取消，Backspace 退一点',
    'tool.pen':'钢笔', 'tool.rect':'矩形', 'tool.ellipse':'椭圆', 'tool.star':'星形',
    'tool.text':'文字', 'tool.eyedropper':'吸管', 'tool.hand':'抓手', 'tool.zoom':'缩放',

    'panel.layers':'图层', 'panel.opacity':'不透明度', 'panel.color':'颜色',
    'panel.fill':'填充', 'panel.stroke':'描边', 'panel.strokeW':'描边宽',
    'opt.size':'笔尖大小', 'opt.hardness':'硬度', 'opt.fontSize':'字号', 'opt.text':'文字内容',
    'opt.points':'角数', 'opt.radius':'圆角', 'opt.tolerance':'容差',

    'ui.agentReady':'AI 可操控（完整命令集）',
    'ui.onlyRaster':'像素专用', 'ui.onlyVector':'向量专用', 'ui.panelOffRaster':'像素专用：当前图层不是像素图层，选像素图层才能用', 'ui.panelOffVector':'向量专用：当前图层不是向量图层，选向量图层才能用',
    'ui.newDocW':'宽（像素）', 'ui.newDocH':'高（像素）',
    'layer.raster':'像素', 'layer.vector':'矢量', 'layer.text':'文字',
    'layer.bg':'背景', 'layer.untitled':'图层',
    'blend.normal':'正常', 'blend.multiply':'正片叠底', 'blend.screen':'滤色', 'blend.overlay':'叠加',
    'blend.darken':'变暗', 'blend.lighten':'变亮', 'blend.difference':'差值', 'blend.hue':'色相',
    'blend.saturation':'饱和度', 'blend.color':'颜色', 'blend.luminosity':'明度',
    'blend.colorBurn':'颜色加深', 'blend.colorDodge':'颜色减淡', 'blend.linearDodge':'线性减淡（添加）', 'blend.softLight':'柔光', 'blend.hardLight':'强光', 'blend.exclusion':'排除',
    'blend.dissolve':'溶解', 'blend.linearBurn':'线性加深', 'blend.darkerColor':'深色', 'blend.lighterColor':'浅色', 'blend.vividLight':'亮光', 'blend.linearLight':'线性光', 'blend.pinLight':'点光', 'blend.hardMix':'实色混合', 'blend.subtract':'减去', 'blend.divide':'划分',
    'panel.lock':'锁定：', 'lock.transparency':'锁定透明像素', 'lock.pixels':'锁定图像像素', 'lock.position':'锁定位置', 'lock.all':'锁定全部',
    'lock.artboard':'防止自动嵌套', 'lock.partial':'部分锁定', 'lock.denied':'无法完成请求，因为图层“{name}”已锁定（{lock}）。',
  },
  'en': {
    'ui.brand':'Dilin Canvas',
    'menu.file':'File', 'menu.edit':'Edit', 'menu.layer':'Layer', 'menu.view':'View',

    'cmd.file.new':'New Document…', 'cmd.file.open':'Open Image…',
    'cmd.file.saveProject':'Save Project (.dlcanvas)', 'cmd.file.openProject':'Open Project…',
    'cmd.file.exportPNG':'Export PNG', 'cmd.file.exportPNG2x':'Export PNG (2×)', 'cmd.file.exportSVG':'Export SVG (vector layers)',
    'cmd.edit.undo':'Undo', 'cmd.edit.redo':'Redo', 'cmd.edit.delete':'Delete', 'cmd.edit.duplicate':'Duplicate Layer',
    'cmd.layer.newRaster':'New Pixel Layer', 'cmd.layer.newVector':'New Vector Layer',
    'cmd.layer.bringForward':'Bring Forward', 'cmd.layer.sendBackward':'Send Backward',
    'cmd.layer.rasterize':'Rasterize Vector Layer', 'cmd.layer.delete':'Delete Layer',
    'cmd.view.fit':'Fit on Screen', 'cmd.view.actual':'Actual Size', 'cmd.view.zoomIn':'Zoom In', 'cmd.view.zoomOut':'Zoom Out',

    'tool.move':'Move', 'tool.marquee':'Rectangular Marquee', 'tool.lasso':'Lasso',
    'tool.brush':'Brush', 'tool.eraser':'Eraser', 'tool.bucket':'Paint Bucket', 'tool.clone':'Clone Stamp',
    'ui.cloneHint':'Alt-click to sample, then drag to clone',
    'ui.toolbarFollows':'The toolbar follows the selected layer kind',
    'ui.penHint':'Click = corner, drag = curve (Alt: one handle, Shift: 45°); click the first point to close, Enter to finish, Esc to cancel, Backspace to undo a point',
    'tool.pen':'Pen', 'tool.rect':'Rectangle', 'tool.ellipse':'Ellipse', 'tool.star':'Star',
    'tool.text':'Type', 'tool.eyedropper':'Eyedropper', 'tool.hand':'Hand', 'tool.zoom':'Zoom',

    'panel.layers':'Layers', 'panel.opacity':'Opacity', 'panel.color':'Color',
    'panel.fill':'Fill', 'panel.stroke':'Stroke', 'panel.strokeW':'Weight',
    'opt.size':'Size', 'opt.hardness':'Hardness', 'opt.fontSize':'Size', 'opt.text':'Text',
    'opt.points':'Points', 'opt.radius':'Radius', 'opt.tolerance':'Tolerance',

    'ui.agentReady':'Agent-ready (full command set)',
    'ui.onlyRaster':'Raster only', 'ui.onlyVector':'Vector only', 'ui.panelOffRaster':'Raster only: the active layer is not a raster layer — select one to use this panel', 'ui.panelOffVector':'Vector only: the active layer is not a vector layer — select one to use this panel',
    'ui.newDocW':'Width (px)', 'ui.newDocH':'Height (px)',
    'layer.raster':'Pixel', 'layer.vector':'Vector', 'layer.text':'Text',
    'layer.bg':'Background', 'layer.untitled':'Layer',
    'blend.normal':'Normal', 'blend.multiply':'Multiply', 'blend.screen':'Screen', 'blend.overlay':'Overlay',
    'blend.darken':'Darken', 'blend.lighten':'Lighten', 'blend.difference':'Difference', 'blend.hue':'Hue',
    'blend.saturation':'Saturation', 'blend.color':'Color', 'blend.luminosity':'Luminosity',
    'blend.colorBurn':'Color Burn', 'blend.colorDodge':'Color Dodge', 'blend.linearDodge':'Linear Dodge (Add)', 'blend.softLight':'Soft Light', 'blend.hardLight':'Hard Light', 'blend.exclusion':'Exclusion',
    'blend.dissolve':'Dissolve', 'blend.linearBurn':'Linear Burn', 'blend.darkerColor':'Darker Color', 'blend.lighterColor':'Lighter Color', 'blend.vividLight':'Vivid Light', 'blend.linearLight':'Linear Light', 'blend.pinLight':'Pin Light', 'blend.hardMix':'Hard Mix', 'blend.subtract':'Subtract', 'blend.divide':'Divide',
    'panel.lock':'Lock:', 'lock.transparency':'Lock transparent pixels', 'lock.pixels':'Lock image pixels', 'lock.position':'Lock position', 'lock.all':'Lock all',
    'lock.artboard':'Prevent auto-nesting', 'lock.partial':'Partially locked', 'lock.denied':'Could not complete your request because the layer "{name}" is locked ({lock}).',
  }
};

const Lang = {
  cur: 'zh-Hant',
  /* 工具档自己带字串用这支登记：{ 'zh-Hant':{key:…}, 'zh-Hans':{…}, 'en':{…} }，不必回来改这份字典 */
  add(strings){
    for (const [lang, kv] of Object.entries(strings || {})){
      I18N[lang] = Object.assign(I18N[lang] || {}, kv);
    }
  },
  detect(){
    const saved = localStorage.getItem('dlcanvas.lang');
    if (saved && I18N[saved]) return saved;
    const n = (navigator.language || 'en').toLowerCase();
    if (n.startsWith('zh')) return /(cn|hans|sg)/.test(n) ? 'zh-Hans' : 'zh-Hant';
    return 'en';
  },
  t(key){ return (I18N[this.cur] && I18N[this.cur][key]) || (I18N.en[key]) || key; },
  set(l){
    if (!I18N[l]) return;
    this.cur = l;
    localStorage.setItem('dlcanvas.lang', l);
    document.documentElement.lang = l;
    this.apply();
    if (window.UI) UI.onLangChanged();
  },
  apply(){
    document.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = Lang.t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach(el=>{ el.title = Lang.t(el.dataset.i18nTitle); });
    // 分页标题跟着界面语言：「档名 — 品牌」只换品牌那段，档名留着（docName 靠它取档名）
    { const i = document.title.lastIndexOf(' — ');
      document.title = i >= 0 ? document.title.slice(0, i) + ' — ' + Lang.t('ui.brand') : Lang.t('ui.brand'); }
  }
};
/* const 不会挂到 window；菜单实作档载入时用 `if (window.Lang) Lang.add(…)` 登记字串，
   等 ui.js 档尾才挂就全落空（各档字串变成键名）⇒ 这里一定义就挂上 */
window.Lang = Lang;
