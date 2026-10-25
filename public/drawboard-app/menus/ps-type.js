/* 堤麟画板 · 菜单树 · Photoshop ▸ 文字（照 photocraft menu_catalog.rs 抄；三语照 PS 2020 繁／简中介面）
   实作在 menus/impl/ps-type.js，命令一律 ps.<原码 id>（照 engine/src/type_extra_cmds.rs、ui-egui/src/view_cmds.rs、type_panels_ui.rs）。
   - 栅格化文字图层 → layer.rasterize（原码 type.rasterizeTypeLayer 也是转叫 type.rasterize）
   - 带「…」的项对到 ps.<原码 id>.dialog（开对话框，确定才跑命令）
   - 单选／勾选项的 ● ✓ 由 impl.checked() 问 PsType.checked（原码 view_cmds.rs checked／type_checked） */
(function(){
const ck = (cmd, id) => ({cmd, checked:() => !!(window.PsType && PsType.checked(id))});
MenuTrees.add('ps', 'type', {
  n:{'zh-Hant':'文字', 'zh-Hans':'文字', en:'Type'},
  items:[
    {n:{'zh-Hant':'面板', 'zh-Hans':'面板', en:'Panels'}, sub:[
      {n:{'zh-Hant':'字元面板', 'zh-Hans':'字符面板', en:'Character Panel'}, id:'type.panels.character', impl:'ps.type.panels.character'},
      {n:{'zh-Hant':'段落面板', 'zh-Hans':'段落面板', en:'Paragraph Panel'}, id:'type.panels.paragraph', impl:'ps.type.panels.paragraph'},
      {n:{'zh-Hant':'字符面板', 'zh-Hans':'字形面板', en:'Glyphs Panel'}, id:'type.panels.glyphs', impl:'ps.type.panels.glyphs'},
      {n:{'zh-Hant':'字元樣式面板', 'zh-Hans':'字符样式面板', en:'Character Styles Panel'}, id:'type.panels.characterStyles', impl:'ps.type.panels.characterStyles'},
      {n:{'zh-Hant':'段落樣式面板', 'zh-Hans':'段落样式面板', en:'Paragraph Styles Panel'}, id:'type.panels.paragraphStyles', impl:'ps.type.panels.paragraphStyles'},
    ]},
    {sep:true},
    {n:{'zh-Hant':'消除鋸齒', 'zh-Hans':'消除锯齿', en:'Anti-Alias'}, sub:[
      {n:{'zh-Hant':'銳利', 'zh-Hans':'锐利', en:'Sharp'}, id:'type.antiAlias.sharp', radio:'antiAlias', impl:ck('ps.type.antiAlias.sharp', 'type.antiAlias.sharp')},
      {n:{'zh-Hant':'鮮明', 'zh-Hans':'犀利', en:'Crisp'}, id:'type.antiAlias.crisp', radio:'antiAlias', impl:ck('ps.type.antiAlias.crisp', 'type.antiAlias.crisp')},
      {n:{'zh-Hant':'強烈', 'zh-Hans':'浑厚', en:'Strong'}, id:'type.antiAlias.strong', radio:'antiAlias', impl:ck('ps.type.antiAlias.strong', 'type.antiAlias.strong')},
      {n:{'zh-Hant':'平滑', 'zh-Hans':'平滑', en:'Smooth'}, id:'type.antiAlias.smooth', radio:'antiAlias', impl:ck('ps.type.antiAlias.smooth', 'type.antiAlias.smooth')},
      {sep:true},
      {n:{'zh-Hant':'Windows LCD', 'zh-Hans':'Windows LCD', en:'Windows LCD'}, id:'type.antiAlias.windowsLcd', radio:'antiAlias', impl:ck('ps.type.antiAlias.windowsLcd', 'type.antiAlias.windowsLcd')},
      {n:{'zh-Hant':'Windows', 'zh-Hans':'Windows', en:'Windows'}, id:'type.antiAlias.windows', radio:'antiAlias', impl:ck('ps.type.antiAlias.windows', 'type.antiAlias.windows')},
    ]},
    {n:{'zh-Hant':'方向', 'zh-Hans':'文本排列方向', en:'Orientation'}, sub:[
      {n:{'zh-Hant':'水平', 'zh-Hans':'横排', en:'Horizontal'}, id:'type.orientation.horizontal', radio:'orientation', impl:ck('ps.type.orientation.horizontal', 'type.orientation.horizontal')},
      {n:{'zh-Hant':'垂直', 'zh-Hans':'竖排', en:'Vertical'}, id:'type.orientation.vertical', radio:'orientation', impl:ck('ps.type.orientation.vertical', 'type.orientation.vertical')},
    ]},
    {n:{'zh-Hant':'OpenType', 'zh-Hans':'OpenType', en:'OpenType'}, sub:[
      {n:{'zh-Hant':'標準連字', 'zh-Hans':'标准连字', en:'Standard Ligatures'}, id:'type.openType.standardLigatures', check:true, impl:ck('ps.type.openType.standardLigatures', 'type.openType.standardLigatures')},
      {n:{'zh-Hant':'上下文替代字', 'zh-Hans':'上下文替代字', en:'Contextual Alternates'}, id:'type.openType.contextualAlternates', check:true, impl:ck('ps.type.openType.contextualAlternates', 'type.openType.contextualAlternates')},
      {n:{'zh-Hant':'自由連字', 'zh-Hans':'自由连字', en:'Discretionary Ligatures'}, id:'type.openType.discretionaryLigatures', check:true, impl:ck('ps.type.openType.discretionaryLigatures', 'type.openType.discretionaryLigatures')},
      {n:{'zh-Hant':'花飾字', 'zh-Hans':'花饰字', en:'Swash'}, id:'type.openType.swash', check:true, impl:ck('ps.type.openType.swash', 'type.openType.swash')},
      {n:{'zh-Hant':'舊式', 'zh-Hans':'旧式标准', en:'Oldstyle'}, id:'type.openType.oldstyle', check:true, impl:ck('ps.type.openType.oldstyle', 'type.openType.oldstyle')},
      {n:{'zh-Hant':'風格替代字', 'zh-Hans':'文体替代字', en:'Stylistic Alternates'}, id:'type.openType.stylisticAlternates', check:true, impl:ck('ps.type.openType.stylisticAlternates', 'type.openType.stylisticAlternates')},
      {n:{'zh-Hant':'標題替代字', 'zh-Hans':'标题替代字', en:'Titling Alternates'}, id:'type.openType.titlingAlternates', check:true, impl:ck('ps.type.openType.titlingAlternates', 'type.openType.titlingAlternates')},
      {n:{'zh-Hant':'裝飾字', 'zh-Hans':'装饰字', en:'Ornaments'}, id:'type.openType.ornaments', check:true, impl:ck('ps.type.openType.ornaments', 'type.openType.ornaments')},
      {n:{'zh-Hant':'序數字', 'zh-Hans':'序数字', en:'Ordinals'}, id:'type.openType.ordinals', check:true, impl:ck('ps.type.openType.ordinals', 'type.openType.ordinals')},
      {n:{'zh-Hant':'分數字', 'zh-Hans':'分数字', en:'Fractions'}, id:'type.openType.fractions', check:true, impl:ck('ps.type.openType.fractions', 'type.openType.fractions')},
    ]},
    {sep:true},
    {n:{'zh-Hant':'建立工作路徑', 'zh-Hans':'创建工作路径', en:'Create Work Path'}, id:'type.createWorkPath', impl:'ps.type.createWorkPath'},
    {n:{'zh-Hant':'轉換為形狀', 'zh-Hans':'转换为形状', en:'Convert to Shape'}, id:'type.convertToShape', impl:'ps.type.convertToShape'},
    {sep:true},
    {n:{'zh-Hant':'點陣化文字圖層', 'zh-Hans':'栅格化文字图层', en:'Rasterize Type Layer'}, id:'type.rasterizeTypeLayer', impl:'layer.rasterize'},
    {sep:true},
    {n:{'zh-Hant':'轉換為段落文字', 'zh-Hans':'转换为段落文本', en:'Convert to Paragraph Text'}, id:'type.convertToParagraphText', impl:'ps.type.convertToParagraphText'},
    {n:{'zh-Hant':'轉換為點文字', 'zh-Hans':'转换为点文本', en:'Convert to Point Text'}, id:'type.convertToPointText', impl:'ps.type.convertToPointText'},
    {n:{'zh-Hant':'彎曲文字…', 'zh-Hans':'文字变形…', en:'Warp Text…'}, id:'type.warpText', impl:'ps.type.warpText.dialog'},
    {sep:true},
    {n:{'zh-Hant':'字體預視大小', 'zh-Hans':'字体预览大小', en:'Font Preview Size'}, sub:[
      {n:{'zh-Hant':'小', 'zh-Hans':'小', en:'Small'}, id:'type.fontPreviewSize.small', radio:'fontPreviewSize', impl:ck('ps.type.fontPreviewSize.small', 'type.fontPreviewSize.small')},
      {n:{'zh-Hant':'中', 'zh-Hans':'中', en:'Medium'}, id:'type.fontPreviewSize.medium', radio:'fontPreviewSize', impl:ck('ps.type.fontPreviewSize.medium', 'type.fontPreviewSize.medium')},
      {n:{'zh-Hant':'大', 'zh-Hans':'大', en:'Large'}, id:'type.fontPreviewSize.large', radio:'fontPreviewSize', impl:ck('ps.type.fontPreviewSize.large', 'type.fontPreviewSize.large')},
      {n:{'zh-Hant':'特大', 'zh-Hans':'特大', en:'Extra Large'}, id:'type.fontPreviewSize.extraLarge', radio:'fontPreviewSize', impl:ck('ps.type.fontPreviewSize.extraLarge', 'type.fontPreviewSize.extraLarge')},
      {n:{'zh-Hant':'極大', 'zh-Hans':'超大', en:'Huge'}, id:'type.fontPreviewSize.huge', radio:'fontPreviewSize', impl:ck('ps.type.fontPreviewSize.huge', 'type.fontPreviewSize.huge')},
    ]},
    {n:{'zh-Hant':'語言選項', 'zh-Hans':'语言选项', en:'Language Options'}, sub:[
      {n:{'zh-Hant':'預設功能', 'zh-Hans':'默认功能', en:'Default Features'}, id:'type.languageOptions.defaultFeatures', radio:'languageFeatures', impl:ck('ps.type.languageOptions.defaultFeatures', 'type.languageOptions.defaultFeatures')},
      {n:{'zh-Hant':'東亞語言功能', 'zh-Hans':'东亚语言功能', en:'East Asian Features'}, id:'type.languageOptions.eastAsianFeatures', radio:'languageFeatures', impl:ck('ps.type.languageOptions.eastAsianFeatures', 'type.languageOptions.eastAsianFeatures')},
      {n:{'zh-Hant':'中東語言功能', 'zh-Hans':'中东语言功能', en:'Middle Eastern Features'}, id:'type.languageOptions.middleEasternFeatures', radio:'languageFeatures', impl:ck('ps.type.languageOptions.middleEasternFeatures', 'type.languageOptions.middleEasternFeatures')},
      {sep:true},
      {n:{'zh-Hant':'中東及南亞視覺調整', 'zh-Hans':'中东和南亚书写器', en:'Middle Eastern & South Asian Composer'}, id:'type.languageOptions.middleEasternAndSouthAsianComposer', check:true, impl:ck('ps.type.languageOptions.middleEasternAndSouthAsianComposer', 'type.languageOptions.middleEasternAndSouthAsianComposer')},
    ]},
    {sep:true},
    {n:{'zh-Hant':'更新所有文字圖層', 'zh-Hans':'更新所有文字图层', en:'Update All Text Layers'}, id:'type.updateAllTextLayers', impl:'ps.type.updateAllTextLayers'},
    {n:{'zh-Hant':'取代所有遺失字體', 'zh-Hans':'替换所有缺失字体', en:'Replace All Missing Fonts'}, id:'type.replaceAllMissingFonts', impl:'ps.type.replaceAllMissingFonts'},
    {n:{'zh-Hant':'解決遺失字體…', 'zh-Hans':'解析缺失字体…', en:'Resolve Missing Fonts…'}, id:'type.resolveMissingFonts', impl:'ps.type.resolveMissingFonts.dialog'},
    {sep:true},
    {n:{'zh-Hant':'貼上 Lorem Ipsum', 'zh-Hans':'粘贴 Lorem Ipsum', en:'Paste Lorem Ipsum'}, id:'type.pasteLoremIpsum', impl:'ps.type.pasteLoremIpsum'},
    {sep:true},
    {n:{'zh-Hant':'載入預設文字樣式', 'zh-Hans':'载入默认文字样式', en:'Load Default Type Styles'}, id:'type.loadDefaultTypeStyles', impl:'ps.type.loadDefaultTypeStyles'},
    {n:{'zh-Hant':'儲存預設文字樣式', 'zh-Hans':'存储默认文字样式', en:'Save Default Type Styles'}, id:'type.saveDefaultTypeStyles', impl:'ps.type.saveDefaultTypeStyles'},
  ]
});
})();
