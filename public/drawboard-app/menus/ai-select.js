/* 堤麟画板 · 菜单树 · Illustrator ▸ 选择（照 vectorcraft menus.rs menu_tree() 抄；三语照 AI 2020 繁／简中介面）
 * impl：照 vectorcraft engine/src/cmd/select.rs、docmenu.rs 抄成 ai.select.*，实作在 menus/impl/ai-select.js。
 * 还是 null 的：启动全局编辑（原码 todo）。另补上图形样式／符号实例／画笔描边／毛刷画笔描边／剪切蒙版／切片（实作在 impl/ai-select.js 档尾）。
 * 存起来的选取（存储所选对象…）照 AI 接在菜单最底下（items 是 getter：每次打开菜单现算）。
 */
(function(){
const ITEMS = [
    {n:{'zh-Hant':'全部', 'zh-Hans':'全部', en:'All'}, id:'select.all', key:'Ctrl+A', impl:'ai.select.all'},
    {n:{'zh-Hant':'現用工作區域上的全部物件', 'zh-Hans':'现用画板上的全部对象', en:'All on Active Artboard'}, id:'select.allOnArtboard', key:'Ctrl+Alt+A', impl:'ai.select.allOnArtboard'},
    {n:{'zh-Hant':'取消選取', 'zh-Hans':'取消选择', en:'Deselect'}, id:'select.none', key:'Ctrl+Shift+A', impl:'ai.select.none'},
    {n:{'zh-Hant':'重新選取', 'zh-Hans':'重新选择', en:'Reselect'}, id:'select.reselect', key:'Ctrl+6', impl:'ai.select.reselect'},
    {sep:true},
    {n:{'zh-Hant':'反轉', 'zh-Hans':'反向', en:'Inverse'}, id:'select.inverse', impl:'ai.select.inverse'},
    {sep:true},
    {n:{'zh-Hant':'上方的下一個物件', 'zh-Hans':'上方的下一个对象', en:'Next Object Above'}, id:'select.nextAbove', key:'Ctrl+Alt+]', impl:'ai.select.nextAbove'},
    {n:{'zh-Hant':'下方的下一個物件', 'zh-Hans':'下方的下一个对象', en:'Next Object Below'}, id:'select.nextBelow', key:'Ctrl+Alt+[', impl:'ai.select.nextBelow'},
    {sep:true},
    {n:{'zh-Hant':'相同', 'zh-Hans':'相同', en:'Same'}, sub:[
      {n:{'zh-Hant':'外觀', 'zh-Hans':'外观', en:'Appearance'}, id:'select.same.appearance', impl:'ai.select.same.appearance'},
      {n:{'zh-Hant':'外觀屬性', 'zh-Hans':'外观属性', en:'Appearance Attribute'}, id:'select.same.appearanceAttribute', impl:'ai.select.same.appearanceAttribute'},
      {n:{'zh-Hant':'漸變模式', 'zh-Hans':'混合模式', en:'Blending Mode'}, id:'select.same.blendingMode', impl:'ai.select.same.blendingMode'},
      {n:{'zh-Hant':'填色和筆畫', 'zh-Hans':'填色和描边', en:'Fill & Stroke'}, id:'select.same.fillAndStroke', impl:'ai.select.same.fillAndStroke'},
      {n:{'zh-Hant':'填色', 'zh-Hans':'填充颜色', en:'Fill Color'}, id:'select.same.fillColor', impl:'ai.select.same.fillColor'},
      {n:{'zh-Hant':'不透明度', 'zh-Hans':'不透明度', en:'Opacity'}, id:'select.same.opacity', impl:'ai.select.same.opacity'},
      {n:{'zh-Hant':'筆畫顏色', 'zh-Hans':'描边颜色', en:'Stroke Color'}, id:'select.same.strokeColor', impl:'ai.select.same.strokeColor'},
      {n:{'zh-Hant':'筆畫寬度', 'zh-Hans':'描边粗细', en:'Stroke Weight'}, id:'select.same.strokeWeight', impl:'ai.select.same.strokeWeight'},
      {n:{'zh-Hant':'繪圖樣式', 'zh-Hans':'图形样式', en:'Graphic Style'}, id:'select.same.graphicStyle', impl:'ai.select.same.graphicStyle'},
      {n:{'zh-Hant':'形狀', 'zh-Hans':'形状', en:'Shape'}, id:'select.same.shapeType', impl:'ai.select.same.shapeType'},
      {n:{'zh-Hant':'符號實體', 'zh-Hans':'符号实例', en:'Symbol Instance'}, id:'select.same.symbolInstance', impl:'ai.select.same.symbolInstance'},
      {sep:true},
      {n:{'zh-Hant':'字體系列', 'zh-Hans':'字体系列', en:'Font Family'}, id:'select.same.fontFamily', impl:'ai.select.same.fontFamily'},
      {n:{'zh-Hant':'字體系列和樣式', 'zh-Hans':'字体系列和样式', en:'Font Family & Style'}, id:'select.same.fontFamilyStyle', impl:'ai.select.same.fontFamilyStyle'},
      {n:{'zh-Hant':'字體系列、樣式和大小', 'zh-Hans':'字体系列、样式和大小', en:'Font Family, Style & Size'}, id:'select.same.fontFamilyStyleSize', impl:'ai.select.same.fontFamilyStyleSize'},
      {n:{'zh-Hant':'字體大小', 'zh-Hans':'字体大小', en:'Font Size'}, id:'select.same.fontSize', impl:'ai.select.same.fontSize'},
      {n:{'zh-Hant':'文字填色', 'zh-Hans':'文本填充颜色', en:'Text Fill Color'}, id:'select.same.textFillColor', impl:'ai.select.same.textFillColor'},
      {n:{'zh-Hant':'文字筆畫顏色', 'zh-Hans':'文本描边颜色', en:'Text Stroke Color'}, id:'select.same.textStrokeColor', impl:'ai.select.same.textStrokeColor'},
    ]},
    {n:{'zh-Hant':'物件', 'zh-Hans':'对象', en:'Object'}, sub:[
      {n:{'zh-Hant':'相同圖層上的全部物件', 'zh-Hans':'同一图层上的所有对象', en:'All on Same Layers'}, id:'select.object.allOnSameLayers', impl:'ai.select.object.allOnSameLayers'},
      {n:{'zh-Hant':'方向控制把手', 'zh-Hans':'方向手柄', en:'Direction Handles'}, id:'select.object.directionHandles', impl:'ai.select.object.directionHandles'},
      {sep:true},
      {n:{'zh-Hant':'筆刷筆觸', 'zh-Hans':'画笔描边', en:'Brush Strokes'}, id:'select.object.brushStrokes', impl:'ai.select.object.brushStrokes'},
      {n:{'zh-Hant':'毛刷筆刷筆觸', 'zh-Hans':'毛刷画笔描边', en:'Bristle Brush Strokes'}, id:'select.object.bristleBrushStrokes', impl:'ai.select.object.bristleBrushStrokes'},
      {n:{'zh-Hant':'剪裁遮色片', 'zh-Hans':'剪切蒙版', en:'Clipping Masks'}, id:'select.object.clippingMasks', impl:'ai.select.object.clippingMasks'},
      {n:{'zh-Hant':'切片', 'zh-Hans':'切片', en:'Slices'}, id:'select.object.slices', impl:'ai.select.object.slices'},
      {n:{'zh-Hant':'游離控制點', 'zh-Hans':'游离点', en:'Stray Points'}, id:'select.object.strayPoints', impl:'ai.select.object.strayPoints'},
      {n:{'zh-Hant':'開放路徑', 'zh-Hans':'开放路径', en:'Open Paths'}, id:'select.object.openPaths', impl:'ai.select.object.openPaths'},
      {sep:true},
      {n:{'zh-Hant':'所有文字物件', 'zh-Hans':'所有文本对象', en:'All Text Objects'}, id:'select.object.textObjects', impl:'ai.select.object.textObjects'},
      {n:{'zh-Hant':'點狀文字物件', 'zh-Hans':'点状文字对象', en:'Point Text Objects'}, id:'select.object.pointText', impl:'ai.select.object.pointText'},
      {n:{'zh-Hant':'區域文字物件', 'zh-Hans':'区域文字对象', en:'Area Text Objects'}, id:'select.object.areaText', impl:'ai.select.object.areaText'},
    ]},
    // 原码 todo；照 AI 2020（menus/impl/ai-misc.js）：全局编辑中标签换成「停止全局编辑」
    {n:(() => { const on = () => !!window.AiMisc && AiMisc.globalEdit.on; const pick = (a, b) => on() ? b : a; return {get 'zh-Hant'(){ return pick('開始全域編輯', '停止全域編輯'); }, get 'zh-Hans'(){ return pick('启动全局编辑', '停止全局编辑'); }, get en(){ return pick('Start Global Edit', 'Stop Global Edit'); }}; })(), id:'select.startGlobalEdit', get impl(){ return window.CMD && CMD.map['ai.select.startGlobalEdit'] ? 'ai.select.startGlobalEdit' : null; }},
    {sep:true},
    {n:{'zh-Hant':'儲存選取範圍…', 'zh-Hans':'存储所选对象…', en:'Save Selection…'}, id:'select.save', impl:{cmd:'ai.select.save', params:{dialog:true}}},
    {n:{'zh-Hant':'編輯選取範圍…', 'zh-Hans':'编辑所选对象…', en:'Edit Selection…'}, id:'select.editSelection', impl:'ai.select.editSelection'},   // 原码 todo；照 select.editSaved 做
];
MenuTrees.add('ai', 'select', {
  n:{'zh-Hant':'選取', 'zh-Hans':'选择', en:'Select'},
  /* 存起来的选取接在最底下（AI 照存的顺序列名字；点了＝载回） */
  get items(){
    const sv = (window.AiSel && window.Doc) ? AiSel.saved.filter(x => x.doc === Doc.serial) : [];
    if (!sv.length) return ITEMS;
    return ITEMS.concat([{sep:true}], sv.map((x, i) => ({n:{'zh-Hant':x.name, 'zh-Hans':x.name, en:x.name}, id:'select.recall.' + (i + 1), impl:{cmd:'ai.select.recall', params:{name:x.name}}})));
  }
});
})();
