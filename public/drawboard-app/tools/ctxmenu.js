/* 堤麟画板 · 右键选单
   两处：
   ① 图层面板一列按右键 ⇒ 照 PhotoCraft ui-egui/src/layer_menu_ui.rs entries 逐项翻（PS 的顺序；按图层种类换「栅格化」那项、有蒙版／剪贴蒙版换对应项、多选换「合并图层」），
      末尾「重命名图层…」（layer_menu_ui.rs show）。点了先选那一层再跑（同原码 layer.select → 命令）。
   ② 画布上按右键 ⇒ 原码没有（canvas.rs 只有画笔的挑选器），照 Photoshop 2020 依当前工具给：
      选框／套索／魔棒（有选区、没选区两份）、移动工具（列出游标底下的图层，点了选那层）、钢笔／路径类、文字、缩放（抓手右键拖是平移，不弹）；
      当前是矢量层（顶菜单是 Illustrator）⇒ 照 Illustrator 2020 画布右键（还原重做、编组、连接、剪切蒙版、复合路径、变换／排列／选择子菜单）。
      画笔照旧开它自己的挑选器（brush.js）；其他工具没有 PS 对应的就不弹浏览器那个选单。
   每一项都直接拿顶菜单树里那一项（名字、快捷键、对应的命令一模一样），右键只是换个地方叫同一条命令——命令本身不动。
   给测试与 agent：CtxMenu.canvasItems(docPt) ／ CtxMenu.layerItems(L) 回这次会出的项；CtxMenu.open(items, x, y)。 */
(function(){
const N = (h, s, e) => ({'zh-Hant':h, 'zh-Hans':s, en:e});
/* 照 id 到顶菜单树里拿那一项（先找当前那套 ps／ai，找不到再找另一套）；rename 时复制一份换名字 */
function pick(id, rename, app){
  let hit = null;
  for (const a of app ? [app] : [Menubar.app, Menubar.app === 'ps' ? 'ai' : 'ps']){
    MenuTrees.walk(a, it => { if (!hit && it.id === id) hit = it; });
    if (hit) break;
  }
  if (!hit) return null;
  return rename ? Object.assign({}, hit, {n:rename}) : hit;
}
/* 自己组的一项（不在顶菜单树里的，例如「选这一层」） */
const own = (n, cmd, params, extra) => Object.assign({n, id:'ctx.' + cmd, impl:params ? {cmd, params} : cmd}, extra || {});
const SEP = {sep:true};
/* 去掉开头／结尾／连续的分隔线、去掉 null（原码 last_sep 那套） */
function tidy(items){
  const out = [];
  for (const it of items){
    if (!it) continue;
    if (it.sep){ if (out.length && !out[out.length - 1].sep) out.push(it); continue; }
    out.push(it);
  }
  while (out.length && out[out.length - 1].sep) out.pop();
  return out;
}

const CtxMenu = window.CtxMenu = {
  /* ── ① 图层面板（layer_menu_ui.rs entries） ── */
  layerItems(L){
    if (!L) return [];
    const multi = Array.isArray(Doc.selectedIds) && Doc.selectedIds.length > 1 && Doc.selectedIds.includes(L.id);
    const hasSel = !!Doc.sel;
    const rast = L.kind === 'text' ? pick('layer.rasterize.type', N('點陣化文字', '栅格化文字', 'Rasterize Type'), 'ps')
      : L.kind === 'vector' ? pick('layer.rasterize.shape', N('點陣化圖層', '栅格化图层', 'Rasterize Layer'), 'ps')
      : L.kind === 'smart' ? pick('layer.rasterize.smartObject', N('點陣化圖層', '栅格化图层', 'Rasterize Layer'), 'ps')
      : L.kind === 'fill' ? pick('layer.rasterize.fillContent', N('點陣化圖層', '栅格化图层', 'Rasterize Layer'), 'ps')
      : L.kind === 'raster' ? null   // 像素层本来就是像素，原码照列但 PS 灰掉；我们直接不列
      : pick('layer.rasterize.layer', N('點陣化圖層', '栅格化图层', 'Rasterize Layer'), 'ps');
    const mask = L.mask ? [
      pick('layer.layerMask.enabled', L.maskEnabled === false ? N('啟用圖層遮色片', '启用图层蒙版', 'Enable Layer Mask') : N('停用圖層遮色片', '停用图层蒙版', 'Disable Layer Mask'), 'ps'),
      pick('layer.layerMask.apply', N('套用圖層遮色片', '应用图层蒙版', 'Apply Layer Mask'), 'ps'),
      pick('layer.layerMask.delete', N('刪除圖層遮色片', '删除图层蒙版', 'Delete Layer Mask'), 'ps'),
    ] : [pick(hasSel ? 'layer.layerMask.revealSelection' : 'layer.layerMask.revealAll', N('增加圖層遮色片', '添加图层蒙版', 'Add Layer Mask'), 'ps')];
    const clip = L.clipped
      ? (CMD.map['layer.releaseClippingMask'] ? own(N('釋放剪裁遮色片', '释放剪贴蒙版', 'Release Clipping Mask'), 'layer.releaseClippingMask', {id:L.id}) : null)
      : pick('layer.createClippingMask', N('建立剪裁遮色片', '创建剪贴蒙版', 'Create Clipping Mask'), 'ps');
    const merge = multi ? pick('layer.mergeLayers', null, 'ps')
      : (CMD.map['ps.layer.mergeDown'] ? own(N('向下合併', '向下合并', 'Merge Down'), 'ps.layer.mergeDown', {id:L.id}, {key:'Ctrl+E'}) : pick('layer.mergeLayers', null, 'ps'));
    // AI 2020 图层面板菜单「进入隔离模式／退出隔离模式」（tools/aiselect.js ai.isolate.*；只有矢量层）
    const iso = window.AiSelectTool && AiSelectTool.iso;
    const isoItem = (L.kind === 'vector' && CMD.map['ai.isolate.enter'])
      ? (iso ? own(N('結束隔離模式', '退出隔离模式', 'Exit Isolation Mode'), 'ai.isolate.exit', {all:true}) : own(N('進入隔離模式', '进入隔离模式', 'Enter Isolation Mode'), 'ai.isolate.enter', {layer:true, layerId:L.id})) : null;
    return tidy([
      isoItem, isoItem ? SEP : null,
      pick('layer.layerStyle.blendingOptions', N('混合選項…', '混合选项…', 'Blending Options…'), 'ps'),
      SEP,
      pick('layer.duplicate', multi ? N('複製圖層…', '复制图层…', 'Duplicate Layers…') : N('複製圖層…', '复制图层…', 'Duplicate Layer…'), 'ps'),
      own(multi ? N('刪除圖層', '删除图层', 'Delete Layers') : N('刪除圖層', '删除图层', 'Delete Layer'), 'layer.delete', {id:L.id}),
      multi ? null : pick('layer.groupLayers', N('從圖層建立群組…', '从图层建立组…', 'Group from Layers…'), 'ps'),
      SEP,
      pick('layer.quickExportAsPng', N('快速轉存為 PNG', '快速导出为 PNG', 'Quick Export As PNG'), 'ps'),
      pick('layer.exportAs', N('轉存為…', '导出为…', 'Export As…'), 'ps'),
      SEP,
      pick('layer.new.artboardFromLayers', N('來自圖層的工作區域…', '来自图层的画板…', 'Artboard from Layers…'), 'ps'),
      pick('layer.new.frameFromLayers', N('來自圖層的框架…', '来自图层的画框…', 'Frame from Layers…'), 'ps'),
      SEP,
      L.kind === 'smart' ? null : pick('layer.smartObjects.convertToSmartObject', N('轉換為智慧型物件', '转换为智能对象', 'Convert to Smart Object'), 'ps'),
      rast,
      // PS 2020：有效果（fx）的层多一项「栅格化图层样式」（紧接栅格化图层）
      (window.PsLayerStyle && PsLayerStyle.has(L) && L.kind !== 'group' && !L.adjust) ? pick('layer.rasterize.layerStyle', N('點陣化圖層樣式', '栅格化图层样式', 'Rasterize Layer Style'), 'ps') : null,
      SEP,
      ...mask,
      clip,
      SEP,
      pick('layer.linkLayers', N('連結圖層', '链接图层', 'Link Layers'), 'ps'),
      pick('layer.selectLinkedLayers', N('選取連結圖層', '选择链接图层', 'Select Linked Layers'), 'ps'),
      SEP,
      pick('layer.layerStyle.copyLayerStyle', N('拷貝圖層樣式', '拷贝图层样式', 'Copy Layer Style'), 'ps'),
      pick('layer.layerStyle.pasteLayerStyle', N('貼上圖層樣式', '粘贴图层样式', 'Paste Layer Style'), 'ps'),
      pick('layer.layerStyle.clear', N('清除圖層樣式', '清除图层样式', 'Clear Layer Style'), 'ps'),
      SEP,
      merge,
      pick('layer.mergeVisible', N('合併可見圖層', '合并可见图层', 'Merge Visible'), 'ps'),
      pick('layer.flattenImage', N('影像平面化', '拼合图像', 'Flatten Image'), 'ps'),
      SEP,
      {n:N('重新命名圖層…', '重命名图层…', 'Rename Layer…'), id:'ctx.layer.rename', impl:{cmd:'ctx.layer.rename', params:{id:L.id}}},
    ]);
  },

  /* ── ② 画布（照 PS 2020／AI 2020，依工具） ── */
  canvasItems(pt){
    const tool = ToolState.cur, L = Doc.active();
    // 变形模式／自由变换框进行中（PS 2020：框上按右键＝变换选单；变形模式多「拆分变形」四项，拆在按右键那一点）
    if (window.PsEdit && PsEdit.warp && PsEdit.warp.state && PsEdit.warp.state()) return this.warpItems(pt);
    if (window.MoveTool && MoveTool.xf) return this.xfItems();
    if (Menubar.app === 'ai') return this.aiItems();
    if (['marquee', 'lasso', 'wand', 'objectselect', 'quickselect'].includes(tool)) return Doc.sel ? tidy([   // PS 2020：对象选择／快速选择工具的画布右键跟选框同一份
      pick('select.deselect', N('取消選取', '取消选择', 'Deselect')),
      pick('select.inverse', N('反轉選取', '选择反向', 'Select Inverse')),
      pick('select.modify.feather', N('羽化…', '羽化…', 'Feather…')),
      pick('select.selectAndMask', N('選取並遮住…', '选择并遮住…', 'Select and Mask…')),
      SEP,
      pick('select.saveSelection', N('儲存選取範圍…', '存储选区…', 'Save Selection…')),
      CMD.map['ps.path.fromSelection.dialog'] ? own(N('製作工作路徑…', '建立工作路径…', 'Make Work Path…'), 'ps.path.fromSelection.dialog', {})   // 「…」＝先开容差小框
        : CMD.map['ps.path.fromSelection'] ? own(N('製作工作路徑…', '建立工作路径…', 'Make Work Path…'), 'ps.path.fromSelection', {}) : null,
      SEP,
      pick('layer.new.layerViaCopy', N('拷貝的圖層', '通过拷贝的图层', 'Layer via Copy')),
      pick('layer.new.layerViaCut', N('剪下的圖層', '通过剪切的图层', 'Layer via Cut')),
      pick('layer.new.layer', N('新增圖層…', '新建图层…', 'New Layer…')),
      SEP,
      pick('edit.freeTransform', N('任意變形', '自由变换', 'Free Transform')),
      pick('select.transformSelection', N('變形選取範圍', '变换选区', 'Transform Selection')),
      SEP,
      pick('edit.fill', N('填滿…', '填充…', 'Fill…')),
      pick('edit.stroke', N('筆畫…', '描边…', 'Stroke…')),
      SEP,
      pick('filter.lastFilter', N('上次濾鏡', '上次滤镜操作', 'Last Filter')),
      pick('edit.fade', N('淡化…', '渐隐…', 'Fade…')),
    ]) : tidy([
      pick('select.all', N('全部', '全部选择', 'Select All')),
      pick('select.reselect', N('重新選取', '重新选择', 'Reselect')),
      pick('select.colorRange', N('顏色範圍…', '色彩范围…', 'Color Range…')),
      pick('select.loadSelection', N('載入選取範圍…', '载入选区…', 'Load Selection…')),
      SEP,
      pick('layer.new.layer', N('新增圖層…', '新建图层…', 'New Layer…')),
      SEP,
      pick('edit.freeTransform', N('任意變形', '自由变换', 'Free Transform')),
      SEP,
      pick('edit.fill', N('填滿…', '填充…', 'Fill…')),
      pick('edit.stroke', N('筆畫…', '描边…', 'Stroke…')),
    ]);
    if (tool === 'move') return this.layersAt(pt);
    if (['pen', 'penAutoAD', 'direct', 'addanchor', 'delanchor', 'anchorpoint'].includes(tool)){
      const path = L && L.kind === 'vector' ? {path:L.id} : {};
      const has = c => !!CMD.map[c];
      return tidy([
        has('ps.path.delete') ? own(N('刪除路徑', '删除路径', 'Delete Path'), 'ps.path.delete', path) : null,
        pick('edit.defineCustomShape', N('定義自訂形狀…', '定义自定形状…', 'Define Custom Shape…')),
        SEP,
        has('ps.path.toSelection') ? own(N('製作選取範圍…', '建立选区…', 'Make Selection…'), 'ps.path.toSelection', path) : null,
        has('ps.path.fill') ? own(N('填滿路徑…', '填充路径…', 'Fill Path…'), 'ps.path.fill', path) : null,
        has('ps.path.stroke.dialog') ? own(N('筆畫路徑…', '描边路径…', 'Stroke Path…'), 'ps.path.stroke.dialog', path)
          : has('ps.path.stroke') ? own(N('筆畫路徑…', '描边路径…', 'Stroke Path…'), 'ps.path.stroke', path) : null,
        SEP,
        pick('edit.freeTransform', N('任意變形路徑', '自由变换路径', 'Free Transform Path')),
      ]);
    }
    if (tool === 'text') return !L || L.kind !== 'text' ? [] : tidy([   // 文字层才有（栅格化文字、方向、消除锯齿都只对文字层）
      pick('layer.rasterize.type', N('點陣化文字', '栅格化文字', 'Rasterize Type'), 'ps'),
      pick('type.createWorkPath', N('建立工作路徑', '创建工作路径', 'Create Work Path'), 'ps'),
      SEP,
      pick('type.orientation.horizontal', N('水平', '水平', 'Horizontal'), 'ps'),
      pick('type.orientation.vertical', N('垂直', '垂直', 'Vertical'), 'ps'),
      SEP,
      pick('type.antiAlias.sharp', null, 'ps'), pick('type.antiAlias.crisp', null, 'ps'),
      pick('type.antiAlias.strong', null, 'ps'), pick('type.antiAlias.smooth', null, 'ps'),
    ]);
    if (tool === 'zoom') return tidy([   // 抓手的右键拖＝平移（hand.js·egui dragged() 不分键）⇒ 不弹选单
      pick('view.fitOnScreen', N('顯示全頁', '按屏幕大小缩放', 'Fit on Screen')),
      pick('view.actualPixels', N('100%', '100%', '100%')),
      pick('view.zoomIn', N('放大顯示', '放大', 'Zoom In')),
      pick('view.zoomOut', N('縮小顯示', '缩小', 'Zoom Out')),
      pick('view.printSize', N('列印尺寸', '打印尺寸', 'Print Size')),
    ]);
    return [];
  },
  /* 自由变换框的右键选单（PS 2020 顺序；模式项打勾＝目前的拖曳模式） */
  xfItems(){
    const t = MoveTool.xf, cur = t.mode || 'free';
    const mode = (k, m, n) => own(n, 'move.xfMode', {mode:m}, {id:'ctx.xf.' + k, check:true, impl:{cmd:'move.xfMode', params:{mode:m}, checked:() => !!MoveTool.xf && (MoveTool.xf.mode || 'free') === m && k !== 'scale' && k !== 'rotate'}});
    const box = (op, n) => own(n, 'move.xfBox', {op}, {id:'ctx.xf.' + op});
    return tidy([
      mode('free', 'free', N('任意變形', '自由变换', 'Free Transform')),
      mode('scale', 'free', N('縮放', '缩放', 'Scale')),
      mode('rotate', 'free', N('旋轉', '旋转', 'Rotate')),
      mode('skew', 'skew', N('傾斜', '斜切', 'Skew')),
      mode('distort', 'distort', N('扭曲', '扭曲', 'Distort')),
      mode('perspective', 'perspective', N('透視', '透视', 'Perspective')),
      CMD.map['ps.edit.transform.warp'] ? own(N('彎曲', '变形', 'Warp'), 'ps.edit.transform.warp', {}, {id:'ctx.xf.warp'}) : null,
      SEP,
      box('rotate180', N('旋轉 180°', '旋转 180 度', 'Rotate 180°')),
      box('rotate90Cw', N('順時針旋轉 90°', '顺时针旋转 90 度', 'Rotate 90° Clockwise')),
      box('rotate90Ccw', N('逆時針旋轉 90°', '逆时针旋转 90 度', 'Rotate 90° Counter Clockwise')),
      SEP,
      box('flipHorizontal', N('水平翻轉', '水平翻转', 'Flip Horizontal')),
      box('flipVertical', N('垂直翻轉', '垂直翻转', 'Flip Vertical')),
    ]);
  },
  /* 变形模式的右键选单：拆分（在按右键那一点切；PS 2020 Split Warp Crosswise／Vertically／Horizontally、Remove Warp Split） */
  warpItems(pt){
    const at = pt ? [pt[0], pt[1]] : undefined;
    const sp = (id, n) => CMD.map['ps.edit.transform.' + id] ? own(n, 'ps.edit.transform.' + id, at ? {at} : {}, {id:'ctx.warp.' + id}) : null;
    return tidy([
      sp('splitWarpCrosswise', N('交叉分割彎曲', '交叉拆分变形', 'Split Warp Crosswise')),
      sp('splitWarpVertically', N('垂直分割彎曲', '垂直拆分变形', 'Split Warp Vertically')),
      sp('splitWarpHorizontally', N('水平分割彎曲', '水平拆分变形', 'Split Warp Horizontally')),
      sp('removeWarpSplit', N('移除彎曲分割', '移去变形拆分', 'Remove Warp Split')),
    ]);
  },
  /* 移动工具：PS 右键列出游标底下有像素的图层（由上到下），点了选那层 */
  layersAt(pt){
    if (!pt) return [];
    const x = Math.floor(pt[0]), y = Math.floor(pt[1]), out = [];
    [...Doc.layers].reverse().forEach(L => {
      if (!L.visible || L.kind === 'group' || L._proxyHide) return;
      try {
        const c = renderLayer(L, 1), lx = L.kind === 'raster' ? x - (L.x || 0) : x, ly = L.kind === 'raster' ? y - (L.y || 0) : y;
        if (lx < 0 || ly < 0 || lx >= c.width || ly >= c.height) return;
        if (c.getContext('2d').getImageData(lx, ly, 1, 1).data[3] > 0)
          out.push(Object.assign(own(N(L.name, L.name, L.name), 'layer.select', {id:L.id}), {id:'ctx.layerAt.' + L.id, check:true, impl:{cmd:'layer.select', params:{id:L.id}, checked:() => Doc.activeId === L.id}}));
      } catch(e){}
    });
    return out;
  },
  /* Illustrator 2020 画布右键（选取工具一份，各工具大致相同） */
  aiItems(){
    const sub = (n, ids) => { const s = ids.map(id => pick(id, null, 'ai')).filter(Boolean); return s.length ? {n, sub:s} : null; };
    return tidy([
      pick('edit.undo', N('還原', '还原', 'Undo'), 'ai'),
      pick('edit.redo', N('重做', '重做', 'Redo'), 'ai'),
      SEP,
      pick('object.group', N('群組', '编组', 'Group'), 'ai'),
      pick('object.ungroup', N('解散群組', '取消编组', 'Ungroup'), 'ai'),
      // AI 2020：选了一个编组＝「隔离选定的组」；隔离模式中＝「退出隔离组」（tools/aiselect.js）
      (window.AiSelectTool && AiSelectTool.iso && CMD.map['ai.isolate.exit']) ? own(N('結束隔離群組', '退出隔离组', 'Exit Isolated Group'), 'ai.isolate.exit', {all:false}) : null,
      (window.AiSelectTool && !AiSelectTool.iso && CMD.map['ai.isolate.enter'] && window.XformKit && (S => S && S.list.length === 1 && S.list[0].type === 'group')(XformKit.selection()))
        ? own(N('隔離選取的群組', '隔离选定的组', 'Isolate Selected Group'), 'ai.isolate.enter', {}) : null,
      pick('path.join', N('合併', '连接', 'Join'), 'ai'),
      pick('path.average', N('平均…', '平均…', 'Average…'), 'ai'),
      pick('object.clippingMask.make', N('製作剪裁遮色片', '建立剪切蒙版', 'Make Clipping Mask'), 'ai'),
      pick('object.compoundPath.make', N('製作複合路徑', '建立复合路径', 'Make Compound Path'), 'ai'),
      SEP,
      sub(N('變形', '变换', 'Transform'), ['object.transformAgain', 'object.transformEach']),
      sub(N('排列順序', '排列', 'Arrange'), ['object.arrange.bringToFront', 'object.arrange.bringForward', 'object.arrange.sendBackward', 'object.arrange.sendToBack', 'object.arrange.sendToCurrentLayer']),
      sub(N('選取', '选择', 'Select'), ['select.all', 'select.reselect', 'select.inverse']),
    ]);
  },

  /* ── 画出来：用顶菜单同一套下拉（.mbdd），子菜单、灰项、快捷键、点外面关都一样 ── */
  open(items, x, y){
    Menubar.close();
    if (!items || !items.length) return null;
    const dd = Menubar.panel(items, 1); dd.classList.add('dl-ctx');
    dd.style.left = x + 'px'; dd.style.top = y + 'px';
    document.body.appendChild(dd);
    const r = dd.getBoundingClientRect();
    if (r.right > innerWidth - 4) dd.style.left = Math.max(2, x - r.width) + 'px';
    if (r.bottom > innerHeight - 4) dd.style.top = Math.max(2, innerHeight - 4 - r.height) + 'px';
    Menubar.fit(dd);
    Menubar.openKey = '__ctx';
    setTimeout(() => document.addEventListener('mousedown', Menubar._outside, true), 0);
    return dd;
  }
};

/* 重命名（原码在面板列上就地改名；我们同双击名字那条：小输入框） */
CMD.reg('ctx.layer.rename', {i18n:'', params:'{id, name?} 重命名图层：给 name 直接改；不给就弹输入框（同双击名字）'}, p => {
  const L = Doc.byId(p.id || Doc.activeId); if (!L) return {ok:false, error:'no layer'};
  const v = p.name !== undefined ? String(p.name) : prompt('', L.name);
  if (!v) return {ok:true, renamed:false};
  return CMD.run('layer.set', {id:L.id, name:v});
});

/* 图层面板：右键一列 */
document.addEventListener('contextmenu', e => {
  const row = e.target.closest && e.target.closest('#layerList .lrow');
  if (!row || row.classList.contains('sfrow') || !row.dataset.id) return;
  e.preventDefault();
  if (window.HumanLock && HumanLock.on && e.isTrusted) return;   // AI 正在画：人手不改图层
  const id = row.dataset.id;
  const inSet = Array.isArray(Doc.selectedIds) && Doc.selectedIds.length > 1 && Doc.selectedIds.includes(id);
  if (!inSet && Doc.activeId !== id) CMD.run('layer.select', {id});   // 原码：点到别列先选那列；多选里按右键保留多选
  const L = Doc.byId(id); if (!L) return;
  CtxMenu.open(CtxMenu.layerItems(L), e.clientX, e.clientY);
}, true);

/* 画布：右键（画笔有自己的挑选器 ⇒ 让它；抓手正在拖 ⇒ hand.js 处理） */
document.addEventListener('contextmenu', e => {
  if (!UI.canvas || !(e.target === UI.canvas || (e.target.closest && e.target.closest('#canvasWrap') && !e.target.closest('.dl-sb')))) return;
  e.preventDefault();
  if (ToolState.cur === 'brush' || ToolState.cur === 'hand' || (window.HandTemp && HandTemp.drag)) return;
  if (window.HumanLock && HumanLock.on && e.isTrusted && ToolState.cur !== 'zoom') return;
  CtxMenu.open(CtxMenu.canvasItems(CtxMenu.docAt(e.clientX, e.clientY)), e.clientX, e.clientY);
}, true);
/* 画面点 → 文件点：旋转视图转过时 getBoundingClientRect 是外接框 ⇒ 用 RotView 的反转（含翻转） */
CtxMenu.docAt = (cx, cy) => {
  if (window.RotView && RotView.angle) return RotView.toDoc(cx, cy);
  const c = UI.canvas.getBoundingClientRect(), flip = /scaleX\(-1\)/.test(UI.canvas.style.transform || '');
  return [(flip ? c.right - cx : cx - c.left) / UI.zoom, (cy - c.top) / UI.zoom];
};
document.addEventListener('keydown', e => { if (e.key === 'Escape' && Menubar.openKey === '__ctx') Menubar.close(); }, true);
/* 有右键选单的工具：右键按下／放开不交给工具（PS 右键不画、不拉框、不动锚点；选框／套索／魔棒／缩放本来就只认左键） */
const MENU_TOOLS = ['move', 'pen', 'penAutoAD', 'direct', 'addanchor', 'delanchor', 'anchorpoint', 'text'];
['pointerdown', 'pointerup'].forEach(t => document.addEventListener(t, e => {
  if (e.button !== 2 || !UI.canvas || e.target !== UI.canvas) return;
  if (Menubar.app === 'ai' || MENU_TOOLS.includes(ToolState.cur)) e.stopImmediatePropagation();
}, true));
})();
