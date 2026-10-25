/* 堤麟画板 · 菜单树 · Illustrator ▸ 窗口（照 vectorcraft menus.rs menu_tree 抄；三语照 AI 2020 繁／简中介面）
 * 面板项一律 check:true（打开＝打勾）。原码面板项都是 window.panel {panel}，这里 id 拆成 window.panel.<panel>，原 id 与参数记在 orig。
 * 原码 <dynamic> 的项：工作区＝workspaces.rs 九个内建工作区＋重置／新建／管理；
 *   图形样式库＝panels/graphic_styles.rs:775-799（6 个内建库＋用户定义＋其它库＋存储）；色板库＝panels/swatches.rs:1130-1156（默认色板、9 个库、渐变 ›、用户定义、其它库、存储）。
 * impl 照 menus.rs／workspaces.rs／panels/*.rs 抄成 ai.window.*，实作在 menus/impl/ai-window.js（面板外壳 menus/impl/panels.js）。
 *   还是 null 的（原码就是 todo／空壳／只回错误）：新建窗口（menus.rs:912 只回「multiple windows land with M11.5」）、排列四项、SVG 交互、变量、画笔库、符号库（menus.rs:45-48、2028、2064、2081、2083、2086 都是 todo）；
 *   工具栏 ▸ 高级（我们只有高级工具栏一种版面）；图形样式库除「阴影和发光」以外 5 个（多层填色／描边堆叠，我们的物件只有一层）；
 *   用户定义库（色板、图形样式两处；原码要使用者资料夹，网页版没有）、图形样式库的「其它库…」「存储图形样式…」（样式档格式跟着多层外观走，没做）。
 *   色板库的「其它库…」（读 .vcswatches／.gpl：开档案挑选器）与「存储色板…」（存成 .vcswatches／.gpl／.css 下载）已做：照 color/src/palette_io.rs。
 * 面板项各自开关（有勾＝开着＝看得到；不再一次只开一个，属性／图层／库也能关）；各面板照 panels/*.rs 补深（见 impl 档头）。图像描摹面板在 menus/impl/ai-trace.js。
 * 测试：tests/自测-menu-ai-window.py、tests/自测-panels-ai.py。
 */
(function(){
const A = () => window.AiWindow;
const pan = (k, orig) => ({cmd:'ai.window.panel', params:{panel:k}, checked:() => !!A() && A().isOpen(k)});
const wsp = name => ({cmd:'ai.window.workspace', params:{name}, checked:() => !!A() && A().workspace.cur === name});
const lib = id => ({cmd:'ai.window.swatchLibrary', params:{library:id}, checked:() => !!A() && A().libOpen === id && !!window.DlPanels && DlPanels.isOpen('aiSwatchLib')});
const N = (t, s, e) => ({'zh-Hant':t, 'zh-Hans':s, en:e});

MenuTrees.add('ai', 'window', {
  n:{'zh-Hant':'視窗', 'zh-Hans':'窗口', en:'Window'},
  items:[
    {n:{'zh-Hant':'新增視窗', 'zh-Hans':'新建窗口', en:'New Window'}, id:'window.newWindow', get impl(){ return window.CMD && CMD.map['ai.window.newWindow'] ? 'ai.window.newWindow' : null; }},   // menus.rs:912 只回错误；这里改成另开文件视窗（menus/impl/ai-misc.js）
    {n:{'zh-Hant':'排列', 'zh-Hans':'排列', en:'Arrange'}, sub:[
      // 原码四项都是 todo、没有 id，自己取
      {n:{'zh-Hant':'重疊顯示', 'zh-Hans':'层叠', en:'Cascade'}, id:'window.arrange.cascade', get impl(){ return window.CMD && CMD.map['ai.window.arrange.cascade'] ? 'ai.window.arrange.cascade' : null; }},
      {n:{'zh-Hant':'並排顯示', 'zh-Hans':'平铺', en:'Tile'}, id:'window.arrange.tile', get impl(){ return window.CMD && CMD.map['ai.window.arrange.tile'] ? 'ai.window.arrange.tile' : null; }},
      {n:{'zh-Hant':'浮動於視窗中', 'zh-Hans':'在窗口中浮动', en:'Float in Window'}, id:'window.arrange.floatInWindow', get impl(){ return window.CMD && CMD.map['ai.window.arrange.floatInWindow'] ? 'ai.window.arrange.floatInWindow' : null; }},
      {n:{'zh-Hant':'合併所有視窗', 'zh-Hans':'合并所有窗口', en:'Consolidate All Windows'}, id:'window.arrange.consolidateAll', get impl(){ return window.CMD && CMD.map['ai.window.arrange.consolidateAll'] ? 'ai.window.arrange.consolidateAll' : null; }},
    ]},
    {n:{'zh-Hant':'工作區', 'zh-Hans':'工作区', en:'Workspace'}, sub:[
      // workspaces.rs:40-99 内建顺序；存下来的工作区由 impl 插在分隔线前
      {n:{'zh-Hant':'基本功能', 'zh-Hans':'基本功能', en:'Essentials'}, id:'window.workspace.essentials', radio:'workspace', impl:wsp('Essentials'), orig:{id:'window.workspace', params:{name:'Essentials'}}},
      {n:{'zh-Hant':'傳統基本功能', 'zh-Hans':'传统基本功能', en:'Essentials Classic'}, id:'window.workspace.essentialsClassic', radio:'workspace', impl:wsp('Essentials Classic'), orig:{id:'window.workspace', params:{name:'Essentials Classic'}}},
      {n:{'zh-Hant':'自動化', 'zh-Hans':'自动', en:'Automation'}, id:'window.workspace.automation', radio:'workspace', impl:wsp('Automation'), orig:{id:'window.workspace', params:{name:'Automation'}}},
      {n:{'zh-Hant':'版面', 'zh-Hans':'版面', en:'Layout'}, id:'window.workspace.layout', radio:'workspace', impl:wsp('Layout'), orig:{id:'window.workspace', params:{name:'Layout'}}},
      {n:{'zh-Hant':'上色', 'zh-Hans':'上色', en:'Painting'}, id:'window.workspace.painting', radio:'workspace', impl:wsp('Painting'), orig:{id:'window.workspace', params:{name:'Painting'}}},
      {n:{'zh-Hant':'列印和校樣', 'zh-Hans':'打印和校样', en:'Printing and Proofing'}, id:'window.workspace.printingProofing', radio:'workspace', impl:wsp('Printing and Proofing'), orig:{id:'window.workspace', params:{name:'Printing and Proofing'}}},
      {n:{'zh-Hant':'描圖', 'zh-Hans':'描摹', en:'Tracing'}, id:'window.workspace.tracing', radio:'workspace', impl:wsp('Tracing'), orig:{id:'window.workspace', params:{name:'Tracing'}}},
      {n:{'zh-Hant':'字體排印', 'zh-Hans':'文字排版', en:'Typography'}, id:'window.workspace.typography', radio:'workspace', impl:wsp('Typography'), orig:{id:'window.workspace', params:{name:'Typography'}}},
      {n:{'zh-Hant':'網頁', 'zh-Hans':'Web', en:'Web'}, id:'window.workspace.web', radio:'workspace', impl:wsp('Web'), orig:{id:'window.workspace', params:{name:'Web'}}},
      {sep:true},
      // menus.rs:1183「重置 <目前工作区>」
      {n:{get 'zh-Hant'(){ return '重設' + (A() ? A().workspace.cur : '基本功能'); }, get 'zh-Hans'(){ return '重置' + (A() ? A().workspace.cur : '基本功能'); }, get en(){ return 'Reset ' + (A() ? A().workspace.cur : 'Essentials'); }}, id:'window.workspace.reset', impl:'ai.window.workspace.reset'},
      {n:{'zh-Hant':'新增工作區…', 'zh-Hans':'新建工作区…', en:'New Workspace…'}, id:'window.workspace.new', impl:'ai.window.workspace.new'},
      {n:{'zh-Hant':'管理工作區…', 'zh-Hans':'管理工作区…', en:'Manage Workspaces…'}, id:'window.workspace.manage', impl:'ai.window.workspace.manage'},
    ]},
    {sep:true},
    {n:{'zh-Hant':'控制', 'zh-Hans':'控制', en:'Control'}, id:'window.control', check:true, impl:{cmd:'ai.window.control', checked:() => !!window.DlPanels && DlPanels.isOpen('options')}},
    {n:{'zh-Hant':'內容相關任務列', 'zh-Hans':'上下文任务栏', en:'Contextual Task Bar'}, id:'window.taskBar', check:true, impl:{cmd:'ai.window.taskBar', checked:() => !!window.DlPanels && DlPanels.isOpen('aiTaskBar')}},
    {n:{'zh-Hant':'工具', 'zh-Hans':'工具', en:'Tools'}, id:'window.toolbar', check:true, impl:{cmd:'ai.window.toolbar', checked:() => !!window.DlPanels && DlPanels.isOpen('tools')}},
    {n:{'zh-Hant':'工具列', 'zh-Hans':'工具栏', en:'Toolbars'}, sub:[
      {n:{'zh-Hant':'進階', 'zh-Hans':'高级', en:'Advanced'}, id:'window.toolbarAdvanced', check:true, get impl(){ return window.CMD && CMD.map['ai.window.toolbarAdvanced'] ? {cmd:'ai.window.toolbarAdvanced', checked:() => !window.AiMisc || AiMisc.toolbarAdvanced()} : null; }},   // 取消勾＝基本工具栏（menus/impl/ai-misc.js）
      {n:{'zh-Hant':'單欄／雙欄', 'zh-Hans':'单栏／双栏', en:'Single / Double Column'}, id:'window.toolbarColumns', impl:'ai.window.toolbarColumns'},
    ]},
    {sep:true},
    {n:{'zh-Hant':'動作', 'zh-Hans':'动作', en:'Actions'}, id:'window.panel.actions', check:true, impl:pan('actions'), orig:{id:'window.panel', params:{panel:'actions'}}},
    {n:{'zh-Hant':'對齊', 'zh-Hans':'对齐', en:'Align'}, id:'window.panel.align', check:true, impl:pan('align'), orig:{id:'window.panel', params:{panel:'align'}}},
    {n:{'zh-Hant':'外觀', 'zh-Hans':'外观', en:'Appearance'}, id:'window.panel.appearance', check:true, impl:pan('appearance'), orig:{id:'window.panel', params:{panel:'appearance'}}},
    {n:{'zh-Hant':'工作區域', 'zh-Hans':'画板', en:'Artboards'}, id:'window.panel.artboards', check:true, impl:pan('artboards'), orig:{id:'window.panel', params:{panel:'artboards'}}},
    {n:{'zh-Hant':'資產轉存', 'zh-Hans':'资源导出', en:'Asset Export'}, id:'window.panel.assetExport', check:true, impl:pan('assetExport'), orig:{id:'window.panel', params:{panel:'assetExport'}}},
    {n:{'zh-Hant':'屬性', 'zh-Hans':'属性', en:'Attributes'}, id:'window.panel.attributes', check:true, impl:pan('attributes'), orig:{id:'window.panel', params:{panel:'attributes'}}},
    {n:{'zh-Hant':'筆刷', 'zh-Hans':'画笔', en:'Brushes'}, id:'window.panel.brushes', check:true, impl:pan('brushes'), orig:{id:'window.panel', params:{panel:'brushes'}}},
    {n:{'zh-Hant':'顏色', 'zh-Hans':'颜色', en:'Color'}, id:'window.panel.color', key:'F6', check:true, impl:pan('color'), orig:{id:'window.panel', params:{panel:'color'}}},
    {n:{'zh-Hant':'色彩參考', 'zh-Hans':'颜色参考', en:'Color Guide'}, id:'window.panel.colorGuide', key:'Shift+F3', check:true, impl:pan('colorGuide'), orig:{id:'window.panel', params:{panel:'colorGuide'}}},
    {n:{'zh-Hant':'色彩主題', 'zh-Hans':'颜色主题', en:'Color Themes'}, id:'window.panel.colorThemes', check:true, impl:pan('colorThemes'), orig:{id:'window.panel', params:{panel:'colorThemes'}}},
    {n:{'zh-Hant':'CSS 內容', 'zh-Hans':'CSS 属性', en:'CSS Properties'}, id:'window.panel.cssProperties', check:true, impl:pan('cssProperties'), orig:{id:'window.panel', params:{panel:'cssProperties'}}},
    {n:{'zh-Hant':'文件資訊', 'zh-Hans':'文档信息', en:'Document Info'}, id:'window.panel.docInfo', check:true, impl:pan('docInfo'), orig:{id:'window.panel', params:{panel:'docInfo'}}},
    {n:{'zh-Hant':'平面化預視', 'zh-Hans':'拼合器预览', en:'Flattener Preview'}, id:'window.panel.flattenerPreview', check:true, impl:pan('flattenerPreview'), orig:{id:'window.panel', params:{panel:'flattenerPreview'}}},
    {n:{'zh-Hant':'漸層', 'zh-Hans':'渐变', en:'Gradient'}, id:'window.panel.gradient', key:'Ctrl+F9', check:true, impl:pan('gradient'), orig:{id:'window.panel', params:{panel:'gradient'}}},
    {n:{'zh-Hant':'繪圖樣式', 'zh-Hans':'图形样式', en:'Graphic Styles'}, id:'window.panel.graphicStyles', key:'Shift+F5', check:true, impl:pan('graphicStyles'), orig:{id:'window.panel', params:{panel:'graphicStyles'}}},
    {n:{'zh-Hant':'歷史記錄', 'zh-Hans':'历史记录', en:'History'}, id:'window.panel.history', check:true, impl:pan('history'), orig:{id:'window.panel', params:{panel:'history'}}},
    {n:{'zh-Hant':'影像描圖', 'zh-Hans':'图像描摹', en:'Image Trace'}, id:'window.panel.imageTrace', check:true, impl:pan('imageTrace'), orig:{id:'window.panel', params:{panel:'imageTrace'}}},
    {n:{'zh-Hant':'資訊', 'zh-Hans':'信息', en:'Info'}, id:'window.panel.info', check:true, impl:pan('info'), orig:{id:'window.panel', params:{panel:'info'}}},
    {n:{'zh-Hant':'圖層', 'zh-Hans':'图层', en:'Layers'}, id:'window.panel.layers', check:true, impl:pan('layers'), orig:{id:'window.panel', params:{panel:'layers'}}},
    {n:{'zh-Hant':'資料庫', 'zh-Hans':'库', en:'Libraries'}, id:'window.panel.libraries', check:true, impl:pan('libraries'), orig:{id:'window.panel', params:{panel:'libraries'}}},
    {n:{'zh-Hant':'連結', 'zh-Hans':'链接', en:'Links'}, id:'window.panel.links', check:true, impl:pan('links'), orig:{id:'window.panel', params:{panel:'links'}}},
    {n:{'zh-Hant':'魔術棒', 'zh-Hans':'魔棒', en:'Magic Wand'}, id:'window.panel.magicWand', check:true, impl:pan('magicWand'), orig:{id:'window.panel', params:{panel:'magicWand'}}},
    {n:{'zh-Hant':'導覽器', 'zh-Hans':'导航器', en:'Navigator'}, id:'window.panel.navigator', check:true, impl:pan('navigator'), orig:{id:'window.panel', params:{panel:'navigator'}}},
    {n:{'zh-Hant':'路徑管理員', 'zh-Hans':'路径查找器', en:'Pathfinder'}, id:'window.panel.pathfinder', check:true, impl:pan('pathfinder'), orig:{id:'window.panel', params:{panel:'pathfinder'}}},
    {n:{'zh-Hant':'圖樣選項', 'zh-Hans':'图案选项', en:'Pattern Options'}, id:'window.panel.patternOptions', check:true, impl:pan('patternOptions'), orig:{id:'window.panel', params:{panel:'patternOptions'}}},
    {n:{'zh-Hant':'內容', 'zh-Hans':'属性', en:'Properties'}, id:'window.panel.properties', check:true, impl:pan('properties'), orig:{id:'window.panel', params:{panel:'properties'}}},
    {n:{'zh-Hant':'分色預視', 'zh-Hans':'分色预览', en:'Separations Preview'}, id:'window.panel.separations', check:true, impl:pan('separations'), orig:{id:'window.panel', params:{panel:'separations'}}},
    {n:{'zh-Hant':'筆畫', 'zh-Hans':'描边', en:'Stroke'}, id:'window.panel.stroke', key:'Ctrl+F10', check:true, impl:pan('stroke'), orig:{id:'window.panel', params:{panel:'stroke'}}},
    {n:{'zh-Hant':'SVG 互動', 'zh-Hans':'SVG 交互', en:'SVG Interactivity'}, id:'window.panel.svgInteractivity', check:true, get impl(){ return window.CMD && CMD.map['ai.window.panel.svgInteractivity'] ? {cmd:'ai.window.panel.svgInteractivity', checked:() => !!window.DlPanels && DlPanels.isOpen('aiSvgInteractivity')} : null; }},   // 原码 todo；照 AI 2020 补
    {n:{'zh-Hant':'色票', 'zh-Hans':'色板', en:'Swatches'}, id:'window.panel.swatches', check:true, impl:pan('swatches'), orig:{id:'window.panel', params:{panel:'swatches'}}},
    {n:{'zh-Hant':'符號', 'zh-Hans':'符号', en:'Symbols'}, id:'window.panel.symbols', check:true, impl:pan('symbols'), orig:{id:'window.panel', params:{panel:'symbols'}}},
    {n:{'zh-Hant':'變形', 'zh-Hans':'变换', en:'Transform'}, id:'window.panel.transform', check:true, impl:pan('transform'), orig:{id:'window.panel', params:{panel:'transform'}}},
    {n:{'zh-Hant':'透明度', 'zh-Hans':'透明度', en:'Transparency'}, id:'window.panel.transparency', key:'Ctrl+Shift+F10', check:true, impl:pan('transparency'), orig:{id:'window.panel', params:{panel:'transparency'}}},
    {n:{'zh-Hant':'文字', 'zh-Hans':'文字', en:'Type'}, sub:[
      {n:{'zh-Hant':'字元', 'zh-Hans':'字符', en:'Character'}, id:'window.panel.character', check:true, impl:pan('character'), orig:{id:'window.panel', params:{panel:'character'}}},
      {n:{'zh-Hant':'字元樣式', 'zh-Hans':'字符样式', en:'Character Styles'}, id:'window.panel.charStyles', check:true, impl:pan('charStyles'), orig:{id:'window.panel', params:{panel:'charStyles'}}},
      {n:{'zh-Hant':'字符', 'zh-Hans':'字形', en:'Glyphs'}, id:'window.panel.glyphs', check:true, impl:pan('glyphs'), orig:{id:'window.panel', params:{panel:'glyphs'}}},
      {n:{'zh-Hant':'OpenType', 'zh-Hans':'OpenType', en:'OpenType'}, id:'window.panel.openType', check:true, impl:pan('openType'), orig:{id:'window.panel', params:{panel:'openType'}}},
      {n:{'zh-Hant':'段落', 'zh-Hans':'段落', en:'Paragraph'}, id:'window.panel.paragraph', check:true, impl:pan('paragraph'), orig:{id:'window.panel', params:{panel:'paragraph'}}},
      {n:{'zh-Hant':'段落樣式', 'zh-Hans':'段落样式', en:'Paragraph Styles'}, id:'window.panel.paraStyles', check:true, impl:pan('paraStyles'), orig:{id:'window.panel', params:{panel:'paraStyles'}}},
      {n:{'zh-Hant':'定位點', 'zh-Hans':'制表符', en:'Tabs'}, id:'window.panel.tabs', check:true, impl:pan('tabs'), orig:{id:'window.panel', params:{panel:'tabs'}}},
    ]},
    {n:{'zh-Hant':'變數', 'zh-Hans':'变量', en:'Variables'}, id:'window.panel.variables', check:true, get impl(){ return window.CMD && CMD.map['ai.window.panel.variables'] ? {cmd:'ai.window.panel.variables', checked:() => !!window.DlPanels && DlPanels.isOpen('aiVariables')} : null; }},   // 原码 todo；照 AI 2020 补
    {sep:true},
    {n:{'zh-Hant':'筆刷資料庫', 'zh-Hans':'画笔库', en:'Brush Libraries'}, sub:[
      // 原码三项都是 todo（menus.rs:45-48 library_placeholders）
      {n:{'zh-Hant':'內建資料庫', 'zh-Hans':'内置库', en:'Built-in Libraries'}, id:'window.brushLibrary.builtin', only:'vector', impl:{cmd:'ai.window.brushLibrary', checked:() => !!window.AiLibraries && !!window.DlPanels && DlPanels.isOpen('aiLibBrush') && !/^(user|file):/.test(AiLibraries.state.brush.open || '')}},
      {n:{'zh-Hant':'使用者定義', 'zh-Hans':'用户定义', en:'User Defined'}, id:'window.brushLibrary.user', only:'vector', impl:{cmd:'ai.window.brushLibrary.user', checked:() => !!window.AiLibraries && !!window.DlPanels && DlPanels.isOpen('aiLibBrush') && /^user:/.test(AiLibraries.state.brush.open || '')}},
      {sep:true},
      {n:{'zh-Hant':'其他資料庫…', 'zh-Hans':'其它库…', en:'Other Library…'}, id:'window.brushLibrary.other', impl:'ai.window.brushLibrary.other'},
    ]},
    {n:{'zh-Hant':'繪圖樣式資料庫', 'zh-Hans':'图形样式库', en:'Graphic Style Libraries'}, sub:[
      // panels/graphic_styles.rs:775-799 graphic_styles::window_menu（doc/src/style_libs.rs:146-153 六个内建库）
      {n:N('陰影與光暈', '阴影和发光', 'Shadows and Glows'), id:'window.graphicStyleLibrary.shadowsGlows', impl:{cmd:'ai.window.graphicStyleLibrary', params:{library:'shadows-glows'}}},
      {n:N('外框與線條', '轮廓和线条', 'Outlines and Rules'), id:'window.graphicStyleLibrary.outlinesRules', only:'vector', impl:{cmd:'ai.window.graphicStyleLibrary.open', params:{library:'outlines-rules'}, checked:() => !!window.AiLibraries && !!window.DlPanels && DlPanels.isOpen('aiLibStyle') && AiLibraries.state.graphicStyle.open === 'outlines-rules'}},
      {n:N('手繪', '手绘', 'Hand-Drawn'), id:'window.graphicStyleLibrary.handDrawn', only:'vector', impl:{cmd:'ai.window.graphicStyleLibrary.open', params:{library:'hand-drawn'}, checked:() => !!window.AiLibraries && !!window.DlPanels && DlPanels.isOpen('aiLibStyle') && AiLibraries.state.graphicStyle.open === 'hand-drawn'}},
      {n:N('漸層表面', '渐变表面', 'Gradient Finishes'), id:'window.graphicStyleLibrary.gradientFinishes', only:'vector', impl:{cmd:'ai.window.graphicStyleLibrary.open', params:{library:'gradient-finishes'}, checked:() => !!window.AiLibraries && !!window.DlPanels && DlPanels.isOpen('aiLibStyle') && AiLibraries.state.graphicStyle.open === 'gradient-finishes'}},
      {n:N('形狀效果', '形状效果', 'Shape Effects'), id:'window.graphicStyleLibrary.shapeEffects', only:'vector', impl:{cmd:'ai.window.graphicStyleLibrary.open', params:{library:'shape-effects'}, checked:() => !!window.AiLibraries && !!window.DlPanels && DlPanels.isOpen('aiLibStyle') && AiLibraries.state.graphicStyle.open === 'shape-effects'}},
      {n:N('混合與透明度', '混合和透明度', 'Blends and Transparency'), id:'window.graphicStyleLibrary.blendsTransparency', only:'vector', impl:{cmd:'ai.window.graphicStyleLibrary.open', params:{library:'blends-transparency'}, checked:() => !!window.AiLibraries && !!window.DlPanels && DlPanels.isOpen('aiLibStyle') && AiLibraries.state.graphicStyle.open === 'blends-transparency'}},
      {sep:true},
      {n:{'zh-Hant':'使用者定義', 'zh-Hans':'用户定义', en:'User Defined'}, id:'window.graphicStyleLibrary.user', only:'vector', impl:{cmd:'ai.window.graphicStyleLibrary.user', checked:() => !!window.AiLibraries && !!window.DlPanels && DlPanels.isOpen('aiLibStyle') && /^user:/.test(AiLibraries.state.graphicStyle.open || '')}},
      {sep:true},
      {n:{'zh-Hant':'其他資料庫…', 'zh-Hans':'其它库…', en:'Other Library…'}, id:'window.graphicStyleLibrary.other', impl:'ai.window.graphicStyleLibrary.other'},
      {n:{'zh-Hant':'儲存繪圖樣式…', 'zh-Hans':'存储图形样式…', en:'Save Graphic Styles…'}, id:'ui.saveGraphicStyleLibrary', impl:{cmd:'ai.ui.saveGraphicStyleLibrary', params:{dialog:true}}},
    ]},
    {n:{'zh-Hant':'色票資料庫', 'zh-Hans':'色板库', en:'Swatch Libraries'}, sub:[
      // panels/swatches.rs:1130-1156 swatches::window_menu（color/src/libraries.rs:58-77）
      {n:N('預設色票', '默认色板', 'Default Swatches'), id:'swatch.resetDefaults', impl:'ai.swatch.resetDefaults'},
      {sep:true},
      {n:N('網頁安全 216', 'Web 安全 216', 'Web Safe 216'), id:'window.swatchLibrary.webSafe216', impl:lib('web-safe-216')},
      {n:N('灰色與中間色', '灰色和中性色', 'Grays and Neutrals'), id:'window.swatchLibrary.graysNeutrals', impl:lib('grays-neutrals')},
      {n:N('大地色調', '大地色调', 'Earth Tones'), id:'window.swatchLibrary.earthTones', impl:lib('earth-tones')},
      {n:N('膚色漸層', '肤色阶', 'Skin Tone Ramps'), id:'window.swatchLibrary.skinToneRamps', impl:lib('skin-tone-ramps')},
      {n:N('粉彩', '粉彩', 'Pastels'), id:'window.swatchLibrary.pastels', impl:lib('pastels')},
      {n:N('鮮豔色', '鲜艳色', 'Brights'), id:'window.swatchLibrary.brights', impl:lib('brights')},
      {n:N('金屬漸層', '金属渐变', 'Metallic Gradients'), id:'window.swatchLibrary.metallicGradients', impl:lib('metallic-gradients')},
      {n:N('感知色階', '感知色阶', 'Perceptual Scales'), id:'window.swatchLibrary.perceptualScales', impl:lib('perceptual-scales')},
      {n:N('和諧組', '和谐组', 'Harmony Sets'), id:'window.swatchLibrary.harmonySets', impl:lib('harmony-sets')},
      {n:N('漸層', '渐变', 'Gradients'), sub:[
        {n:N('光譜漸層', '光谱渐变', 'Spectrum Gradients'), id:'window.swatchLibrary.spectrumGradients', impl:lib('spectrum-gradients')},
        {n:N('天空漸層', '天空渐变', 'Sky Gradients'), id:'window.swatchLibrary.skyGradients', impl:lib('sky-gradients')},
        {n:N('中間色漸層', '中性色渐变', 'Neutral Gradients'), id:'window.swatchLibrary.neutralGradients', impl:lib('neutral-gradients')},
        {n:N('雙色調漸層', '双色调渐变', 'Duotone Gradients'), id:'window.swatchLibrary.duotoneGradients', impl:lib('duotone-gradients')},
        {n:N('放射光暈', '径向光晕', 'Radial Glows'), id:'window.swatchLibrary.radialGlows', impl:lib('radial-glows')},
      ]},
      {sep:true},
      {n:{'zh-Hant':'使用者定義', 'zh-Hans':'用户定义', en:'User Defined'}, id:'window.swatchLibrary.user', impl:{cmd:'ai.window.swatchLibrary.user', checked:() => !!window.AiLibraries && !!window.DlPanels && DlPanels.isOpen('aiLibSwatch') && /^user:/.test(AiLibraries.state.swatch.open || '')}},
      {sep:true},
      {n:{'zh-Hant':'其他資料庫…', 'zh-Hans':'其它库…', en:'Other Library…'}, id:'window.swatchLibrary.other', impl:'ai.window.swatchLibrary.other'},
      {n:{'zh-Hant':'儲存色票…', 'zh-Hans':'存储色板…', en:'Save Swatches…'}, id:'ui.saveSwatchLibrary', impl:{cmd:'ai.ui.saveSwatchLibrary', params:{dialog:true}}},
    ]},
    {n:{'zh-Hant':'符號資料庫', 'zh-Hans':'符号库', en:'Symbol Libraries'}, sub:[
      // 原码三项都是 todo（menus.rs:2086 library_placeholders）
      {n:{'zh-Hant':'內建資料庫', 'zh-Hans':'内置库', en:'Built-in Libraries'}, id:'window.symbolLibrary.builtin', only:'vector', impl:{cmd:'ai.window.symbolLibrary', checked:() => !!window.AiLibraries && !!window.DlPanels && DlPanels.isOpen('aiLibSymbol') && !/^(user|file):/.test(AiLibraries.state.symbol.open || '')}},
      {n:{'zh-Hant':'使用者定義', 'zh-Hans':'用户定义', en:'User Defined'}, id:'window.symbolLibrary.user', only:'vector', impl:{cmd:'ai.window.symbolLibrary.user', checked:() => !!window.AiLibraries && !!window.DlPanels && DlPanels.isOpen('aiLibSymbol') && /^user:/.test(AiLibraries.state.symbol.open || '')}},
      {sep:true},
      {n:{'zh-Hant':'其他資料庫…', 'zh-Hans':'其它库…', en:'Other Library…'}, id:'window.symbolLibrary.other', impl:'ai.window.symbolLibrary.other'},
    ]},
  ]
});
})();
