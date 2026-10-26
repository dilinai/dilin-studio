/* 堤麟画板 · 菜单树 · Photoshop ▸ 选择（照 photocraft menu_catalog.rs 抄；三语照 PS 2020 繁／简中介面）
   impl 为 null 的项照原码实作在 menus/impl/ps-select.js（命令 ps.<原码 id>；要弹对话框的项对到 ps.<原码 id>.dialog） */
MenuTrees.add('ps', 'select', {
  n:{'zh-Hant':'選取', 'zh-Hans':'选择', en:'Select'},
  items:[
    // select.all ＝ 选区设为整张画布
    {n:{'zh-Hant':'全部', 'zh-Hans':'全部', en:'All'}, id:'select.all', key:'Ctrl+A', impl:'select.all'},
    // select.none ＝ 清掉选区（Ctrl+D 在 ui.js 也是这条）
    {n:{'zh-Hant':'取消選取', 'zh-Hans':'取消选择', en:'Deselect'}, id:'select.deselect', key:'Ctrl+D', impl:'select.none'},
    {n:{'zh-Hant':'重新選取', 'zh-Hans':'重新选择', en:'Reselect'}, id:'select.reselect', key:'Ctrl+Shift+D', impl:'ps.select.reselect'},
    {n:{'zh-Hant':'反轉', 'zh-Hans':'反选', en:'Inverse Selection'}, id:'select.inverse', key:'Ctrl+Shift+I', impl:'ps.select.inverse'},
    // Convert to Shape 是 photocraft 自加的项（PS 2020 选取菜单没有），中文照字面译
    {n:{'zh-Hant':'轉換為形狀', 'zh-Hans':'转换为形状', en:'Convert to Shape'}, id:'select.convertToShape', impl:'ps.select.convertToShape'},
    {sep:true},
    // 所有图层：写进 Doc.selectedIds（多选；照 layer_multi_cmds.rs:120 select_all_layers）
    {n:{'zh-Hant':'所有圖層', 'zh-Hans':'所有图层', en:'All Layers'}, id:'select.allLayers', key:'Ctrl+Alt+A', impl:'ps.select.allLayers'},
    {n:{'zh-Hant':'取消選取圖層', 'zh-Hans':'取消选择图层', en:'Deselect Layers'}, id:'select.deselectLayers', impl:'ps.select.deselectLayers'},
    {n:{'zh-Hant':'尋找圖層', 'zh-Hans':'查找图层', en:'Find Layers'}, id:'select.findLayers', key:'Ctrl+Alt+Shift+F', impl:'ps.select.findLayers.dialog'},
    {n:{'zh-Hant':'隔離圖層', 'zh-Hans':'隔离图层', en:'Isolate Layers'}, id:'select.isolateLayers', check:true,
      impl:{cmd:'ps.select.isolateLayers', checked:() => !!(window.PsSelect && PsSelect.isolated())}},
    {sep:true},
    {n:{'zh-Hant':'顏色範圍…', 'zh-Hans':'色彩范围…', en:'Color Range…'}, id:'select.colorRange', impl:'ps.select.colorRange.dialog'},
    {n:{'zh-Hant':'焦點區域…', 'zh-Hans':'焦点区域…', en:'Focus Area…'}, id:'select.focusArea', impl:'ps.select.focusArea.dialog'},
    {n:{'zh-Hant':'主體', 'zh-Hans':'主体', en:'Subject'}, id:'select.subject', impl:'ps.select.subject'},
    {n:{'zh-Hant':'主體（AI）', 'zh-Hans':'主体（AI）', en:'Subject (AI)'}, id:'select.subjectAI', impl:'genai.selectSubject.ui'},
    {n:{'zh-Hant':'天空', 'zh-Hans':'天空', en:'Sky'}, id:'select.sky', impl:'ps.select.sky'},
    {n:{'zh-Hant':'選取並遮住…', 'zh-Hans':'选择并遮住…', en:'Select and Mask…'}, id:'select.selectAndMask', key:'Ctrl+Alt+R', impl:'ps.select.selectAndMask.dialog'},
    {sep:true},
    {n:{'zh-Hant':'修改', 'zh-Hans':'修改', en:'Modify'}, sub:[
      {n:{'zh-Hant':'邊界…', 'zh-Hans':'边界…', en:'Border…'}, id:'select.modify.border', impl:'ps.select.modify.border.dialog'},
      {n:{'zh-Hant':'平滑…', 'zh-Hans':'平滑…', en:'Smooth…'}, id:'select.modify.smooth', impl:'ps.select.modify.smooth.dialog'},
      {n:{'zh-Hant':'擴張…', 'zh-Hans':'扩展…', en:'Expand…'}, id:'select.modify.expand', impl:'ps.select.modify.expand.dialog'},
      {n:{'zh-Hant':'縮減…', 'zh-Hans':'收缩…', en:'Contract…'}, id:'select.modify.contract', impl:'ps.select.modify.contract.dialog'},
      {n:{'zh-Hant':'羽化…', 'zh-Hans':'羽化…', en:'Feather…'}, id:'select.modify.feather', key:'Shift+F6', impl:'ps.select.modify.feather.dialog'},
    ]},
    {sep:true},
    {n:{'zh-Hant':'連續相近', 'zh-Hans':'扩大选取', en:'Grow'}, id:'select.grow', impl:'ps.select.grow'},
    {n:{'zh-Hant':'相似色彩', 'zh-Hans':'选取相似', en:'Similar'}, id:'select.similar', impl:'ps.select.similar'},
    {sep:true},
    {n:{'zh-Hant':'變形選取範圍', 'zh-Hans':'变换选区', en:'Transform Selection'}, id:'select.transformSelection', impl:'ps.select.transformSelection.dialog'},
    // 变换选区里的「变形」（PS：变换选区时 编辑 ▸ 变换 ▸ 变形）：样式／弯曲／扭曲，只变选区轮廓（menus/impl/ps-edit.js）
    {n:{'zh-Hant':'變形選取範圍：彎曲…', 'zh-Hans':'变换选区：变形…', en:'Transform Selection: Warp…'}, id:'select.transformSelection.warp', impl:'ps.select.transformSelection.warp.dialog'},
    {sep:true},
    {n:{'zh-Hant':'以快速遮色片模式編輯', 'zh-Hans':'在快速蒙版模式下编辑', en:'Edit in Quick Mask Mode'}, id:'select.editInQuickMaskMode', key:'Q', check:true,
      impl:{cmd:'ps.select.editInQuickMaskMode', checked:() => !!(window.PsSelect && PsSelect.quickMaskOn())}},
    {sep:true},
    {n:{'zh-Hant':'載入選取範圍…', 'zh-Hans':'载入选区…', en:'Load Selection…'}, id:'select.loadSelection', impl:'ps.select.loadSelection.dialog'},
    {n:{'zh-Hant':'儲存選取範圍…', 'zh-Hans':'存储选区…', en:'Save Selection…'}, id:'select.saveSelection', impl:'ps.select.saveSelection.dialog'},
  ]
});
