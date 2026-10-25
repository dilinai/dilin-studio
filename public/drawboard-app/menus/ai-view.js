/* 堤麟画板 · 菜单树 · Illustrator ▸ 视图（照 vectorcraft menus.rs menu_tree() 抄；三语照 AI 2020 繁／简中介面）
 * 原码 <dynamic> 的透视预设（一点／两点／三点透视）照 AI 2020 补成内建的「[nP-正常视图]」各一项。
 * 原码多项共用一个 id（view.screenMode、view.proofSetup、window.panel）的，这里 id 加后缀拆开，原 id 与参数记在 orig。
 * impl 照 vectorcraft ui-egui/src/menus.rs、engine/src/cmd/views.rs、docmenu.rs（参考线）、colormgmt.rs（校样）抄成 ai.view.*，实作在 menus/impl/ai-view.js。
 *   「隐藏／显示 …」「轮廓／预览」等会翻的名字照 menus.rs:1178-1211 dynamic_label 做成 getter；勾选照 menus.rs:1110-1171 checked。
 *   放大／缩小仍对 view.zoomIn／zoomOut（自测-menubar 第 4 段认这一条）；AI 级距的版本是 ai.view.zoomIn／zoomOut，给 agent 用。
 *   还是 null 的：重置旋转视图（我们没有旋转视图）、视频标尺、对齐字形（原码 todo）。另补上工作中的 CMYK／自定、打印拼贴、切片、文本串接、边角构件、透视网格整组（impl/ai-view.js 档尾）。
 */
(function(){
const V = (k, d) => () => window.AiView ? !!AiView.flags[k] : d;
/* 会翻的名字：f() 为真用 on，否则 off（三语各一） */
const flip = (on, off, f) => ({get 'zh-Hant'(){ return (f() ? on : off)[0]; }, get 'zh-Hans'(){ return (f() ? on : off)[1]; }, get en(){ return (f() ? on : off)[2]; }});
/* 存下来的视图 n 的名字（没存就「—」） */
const slot = n => { const nm = () => { const v = window.AiView && AiView.views()[n - 1]; return v ? v.name : '—'; };
  return {get 'zh-Hant'(){ return nm(); }, get 'zh-Hans'(){ return nm(); }, get en(){ return nm(); }}; };
const scr = (m, mode) => ({cmd:'ai.view.screenMode', params:{mode}, checked:() => !!window.Toolbar && Toolbar.screen === m});
const proof = t => ({cmd:'ai.view.proofSetup', params:{target:t, proof:true}, checked:() => !!window.AiView && AiView.proof.target === t});
const chk = (cmd, k) => ({cmd, checked:V(k, false)});
/* 透视网格的状态（persp 段 window.AiPersp） */
const PG = k => () => !!window.AiPersp && !!AiPersp.current()[k];

MenuTrees.add('ai', 'view', {
  n:{'zh-Hant':'檢視', 'zh-Hans':'视图', en:'View'},
  items:[
    {n:flip(['預視', '预览', 'Preview'], ['外框', '轮廓', 'Outline'], V('outline', false)), id:'view.outline', impl:'ai.view.outline'},   // 与「预览」互换标签，不是勾选式
    {n:{'zh-Hant':'疊印預視', 'zh-Hans':'叠印预览', en:'Overprint Preview'}, id:'view.overprintPreview', key:'Ctrl+Alt+Shift+Y', check:true, impl:chk('ai.view.overprintPreview', 'overprint')},
    {n:{'zh-Hant':'像素預視', 'zh-Hans':'像素预览', en:'Pixel Preview'}, id:'view.pixelPreview', check:true, impl:chk('ai.view.pixelPreview', 'pixelPreview')},
    {n:{'zh-Hant':'修剪檢視', 'zh-Hans':'裁切视图', en:'Trim View'}, id:'view.trimView', check:true, impl:chk('ai.view.trimView', 'trimView')},
    {n:{'zh-Hant':'簡報模式', 'zh-Hans':'演示文稿模式', en:'Presentation Mode'}, id:'view.presentation', impl:'ai.view.presentation'},
    {n:{'zh-Hant':'螢幕模式', 'zh-Hans':'屏幕模式', en:'Screen Mode'}, sub:[
      {n:{'zh-Hant':'標準螢幕模式', 'zh-Hans':'正常屏幕模式', en:'Normal Screen Mode'}, id:'view.screenMode.normal', radio:'screen', impl:scr('standard', 0), orig:{id:'view.screenMode', params:{mode:0}}},
      {n:{'zh-Hant':'含選單列的全螢幕模式', 'zh-Hans':'带有菜单栏的全屏模式', en:'Full Screen Mode with Menu Bar'}, id:'view.screenMode.fullWithMenu', radio:'screen', impl:scr('fullmenu', 1), orig:{id:'view.screenMode', params:{mode:1}}},
      {n:{'zh-Hant':'全螢幕模式', 'zh-Hans':'全屏模式', en:'Full Screen Mode'}, id:'view.screenMode.full', radio:'screen', impl:scr('full', 2), orig:{id:'view.screenMode', params:{mode:2}}},
    ]},
    {sep:true},
    {n:{'zh-Hant':'校樣設定', 'zh-Hans':'校样设置', en:'Proof Setup'}, sub:[
      {n:{'zh-Hant':'工作中的 CMYK', 'zh-Hans':'工作中的 CMYK', en:'Working CMYK'}, id:'view.proofSetup.workingCmyk', radio:'proof', impl:proof('workingCmyk'), orig:{id:'view.proofSetup', params:{target:'workingCmyk', proof:true}}},   // 没有 CMYK 描述档
      {n:{'zh-Hant':'舊版 Macintosh RGB (Gamma 1.8)', 'zh-Hans':'旧版 Macintosh RGB (Gamma 1.8)', en:'Legacy Macintosh RGB (Gamma 1.8)'}, id:'view.proofSetup.legacyMacRgb', radio:'proof', impl:proof('legacyMacRgb'), orig:{id:'view.proofSetup', params:{target:'legacyMacRgb', proof:true}}},
      {n:{'zh-Hant':'網際網路標準 RGB (sRGB)', 'zh-Hans':'Internet 标准 RGB (sRGB)', en:'Internet Standard RGB (sRGB)'}, id:'view.proofSetup.srgb', radio:'proof', impl:proof('srgb'), orig:{id:'view.proofSetup', params:{target:'srgb', proof:true}}},
      {n:{'zh-Hant':'顯示器 RGB', 'zh-Hans':'显示器 RGB', en:'Monitor RGB'}, id:'view.proofSetup.monitorRgb', radio:'proof', impl:proof('monitorRgb'), orig:{id:'view.proofSetup', params:{target:'monitorRgb', proof:true}}},
      {n:{'zh-Hant':'色盲 - 紅色盲類型', 'zh-Hans':'色盲 - 红色盲类型', en:'Color blindness – Protanopia-type'}, id:'view.proofSetup.protanopia', radio:'proof', impl:proof('protanopia'), orig:{id:'view.proofSetup', params:{target:'protanopia', proof:true}}},
      {n:{'zh-Hant':'色盲 - 綠色盲類型', 'zh-Hans':'色盲 - 绿色盲类型', en:'Color blindness – Deuteranopia-type'}, id:'view.proofSetup.deuteranopia', radio:'proof', impl:proof('deuteranopia'), orig:{id:'view.proofSetup', params:{target:'deuteranopia', proof:true}}},
      {n:{'zh-Hant':'自訂…', 'zh-Hans':'自定…', en:'Customize…'}, id:'view.proofSetup.customize', impl:'ai.view.separations.panel', orig:{id:'window.panel', params:{panel:'separations'}}},
    ]},
    {n:{'zh-Hant':'校樣色彩', 'zh-Hans':'校样颜色', en:'Proof Colors'}, id:'view.proofColors', check:true, impl:chk('ai.view.proofColors', 'proofColors')},
    {sep:true},
    {n:{'zh-Hant':'放大顯示', 'zh-Hans':'放大', en:'Zoom In'}, id:'view.zoomIn', impl:'view.zoomIn'},
    {n:{'zh-Hant':'縮小顯示', 'zh-Hans':'缩小', en:'Zoom Out'}, id:'view.zoomOut', impl:'view.zoomOut'},
    {n:{'zh-Hant':'使工作區域符合視窗', 'zh-Hans':'画板适合窗口大小', en:'Fit Artboard in Window'}, id:'view.fitArtboard', impl:'ai.view.fitArtboard'},
    {n:{'zh-Hant':'全部符合視窗大小', 'zh-Hans':'全部适合窗口大小', en:'Fit All in Window'}, id:'view.fitAll', impl:'ai.view.fitAll'},
    {n:{'zh-Hant':'實際尺寸', 'zh-Hans':'实际大小', en:'Actual Size'}, id:'view.actualSize', impl:'ai.view.actualSize'},
    {sep:true},
    {n:{'zh-Hant':'重設旋轉檢視', 'zh-Hans':'重置旋转视图', en:'Reset Rotate View'}, id:'view.rotateReset', key:'Ctrl+Shift+1', get impl(){ return window.CMD && CMD.map['ai.view.rotateReset'] ? 'ai.view.rotateReset' : null; }},   // 接旋转视图工具的复位（rotateview.reset）
    {sep:true},
    {n:flip(['隱藏邊緣', '隐藏边缘', 'Hide Edges'], ['顯示邊緣', '显示边缘', 'Show Edges'], V('edges', true)), id:'view.edges', impl:'ai.view.edges'},
    {n:flip(['隱藏工作區域', '隐藏画板', 'Hide Artboards'], ['顯示工作區域', '显示画板', 'Show Artboards'], V('artboards', true)), id:'view.artboards', impl:'ai.view.artboards'},
    {n:flip(['隱藏列印並排', '隐藏打印拼贴', 'Hide Print Tiling'], ['顯示列印並排', '显示打印拼贴', 'Show Print Tiling'], V('printTiling', false)), id:'view.printTiling', impl:'ai.view.printTiling'},
    {n:flip(['顯示切片', '显示切片', 'Show Slices'], ['隱藏切片', '隐藏切片', 'Hide Slices'], V('slicesHidden', false)), id:'view.slices.hide', impl:'ai.view.slices.hide'},
    {n:{'zh-Hant':'鎖定切片', 'zh-Hans':'锁定切片', en:'Lock Slices'}, id:'view.slices.lock', check:true, impl:chk('ai.view.slices.lock', 'slicesLocked')},
    {sep:true},
    {n:{'zh-Hant':'尺標', 'zh-Hans':'标尺', en:'Rulers'}, sub:[
      {n:flip(['隱藏尺標', '隐藏标尺', 'Hide Rulers'], ['顯示尺標', '显示标尺', 'Show Rulers'], V('rulers', false)), id:'view.rulers', key:'Ctrl+R', impl:'ai.view.rulers'},
      {n:flip(['變更為工作區域尺標', '更改为画板标尺', 'Change to Artboard Rulers'], ['變更為全域尺標', '更改为全局标尺', 'Change to Global Rulers'], V('globalRulers', false)), id:'view.rulers.global', key:'Ctrl+Alt+R', impl:'ai.view.rulers.global'},   // 原码 todo
      {n:flip(['隱藏視訊尺標', '隐藏视频标尺', 'Hide Video Rulers'], ['顯示視訊尺標', '显示视频标尺', 'Show Video Rulers'], () => !!window.AiMisc && !!AiMisc.view.videoRulers), id:'view.rulers.video', get impl(){ return window.CMD && CMD.map['ai.view.rulers.video'] ? 'ai.view.rulers.video' : null; }},   // 原码 todo；这里照 AI（menus/impl/ai-misc.js）
    ]},
    {n:flip(['隱藏邊框', '隐藏定界框', 'Hide Bounding Box'], ['顯示邊框', '显示定界框', 'Show Bounding Box'], () => !!window.AiView && AiView.boundingBox()), id:'view.boundingBox', key:'Ctrl+Shift+B', impl:'ai.view.boundingBox'},
    {n:flip(['隱藏透明度格點', '隐藏透明度网格', 'Hide Transparency Grid'], ['顯示透明度格點', '显示透明度网格', 'Show Transparency Grid'], V('transparencyGrid', false)), id:'view.transparencyGrid', key:'Ctrl+Shift+D', impl:'ai.view.transparencyGrid'},
    {n:flip(['隱藏文字緒', '隐藏文本串接', 'Hide Text Threads'], ['顯示文字緒', '显示文本串接', 'Show Text Threads'], V('textThreads', true)), id:'view.textThreads', impl:'ai.view.textThreads'},
    {n:flip(['隱藏漸層註釋者', '隐藏渐变批注者', 'Hide Gradient Annotator'], ['顯示漸層註釋者', '显示渐变批注者', 'Show Gradient Annotator'], V('gradientAnnotator', true)), id:'view.gradientAnnotator', impl:'ai.view.gradientAnnotator'},
    {n:flip(['隱藏邊角 Widget', '隐藏边角构件', 'Hide Corner Widget'], ['顯示邊角 Widget', '显示边角构件', 'Show Corner Widget'], V('cornerWidgets', true)), id:'view.cornerWidget', impl:'ai.view.cornerWidget'},
    {sep:true},
    {n:{'zh-Hant':'參考線', 'zh-Hans':'参考线', en:'Guides'}, sub:[
      {n:flip(['隱藏參考線', '隐藏参考线', 'Hide Guides'], ['顯示參考線', '显示参考线', 'Show Guides'], V('guides', true)), id:'view.guides', impl:'ai.view.guides'},
      {n:flip(['解除鎖定參考線', '解锁参考线', 'Unlock Guides'], ['鎖定參考線', '锁定参考线', 'Lock Guides'], V('guidesLocked', false)), id:'view.guides.lock', key:'Ctrl+Alt+;', impl:'ai.view.guides.lock'},
      {n:{'zh-Hant':'製作參考線', 'zh-Hans':'建立参考线', en:'Make Guides'}, id:'view.guides.make', key:'Ctrl+5', impl:'ai.view.guides.make'},
      {n:{'zh-Hant':'釋放參考線', 'zh-Hans':'释放参考线', en:'Release Guides'}, id:'view.guides.release', key:'Ctrl+Alt+5', impl:'ai.view.guides.release'},
      {n:{'zh-Hant':'清除參考線', 'zh-Hans':'清除参考线', en:'Clear Guides'}, id:'view.guides.clear', impl:'ai.view.guides.clear'},
    ]},
    {n:{'zh-Hant':'智慧型參考線', 'zh-Hans':'智能参考线', en:'Smart Guides'}, id:'view.smartGuides', check:true, impl:chk('ai.view.smartGuides', 'smartGuides')},
    {n:{'zh-Hant':'透視格點', 'zh-Hans':'透视网格', en:'Perspective Grid'}, sub:[
      {n:flip(['隱藏格點', '隐藏网格', 'Hide Grid'], ['顯示格點', '显示网格', 'Show Grid'], PG('visible')), id:'perspective.grid.show', key:'Ctrl+Shift+I', impl:'ai.perspective.grid.show'},
      {n:flip(['隱藏尺標', '隐藏标尺', 'Hide Rulers'], ['顯示尺標', '显示标尺', 'Show Rulers'], PG('rulers')), id:'perspective.grid.rulers', impl:'ai.perspective.grid.rulers'},
      {n:{'zh-Hant':'靠齊格點', 'zh-Hans':'对齐网格', en:'Snap to Grid'}, id:'perspective.grid.snap', check:true, impl:{cmd:'ai.perspective.grid.snap', checked:PG('snap')}},
      {n:flip(['解除鎖定格點', '解锁网格', 'Unlock Grid'], ['鎖定格點', '锁定网格', 'Lock Grid'], PG('locked')), id:'perspective.grid.lock', impl:'ai.perspective.grid.lock'},   // 原码换名字不打勾（menus.rs:1239）
      {n:{'zh-Hant':'鎖定站點', 'zh-Hans':'锁定站点', en:'Lock Station Point'}, id:'perspective.grid.lockStation', check:true, impl:{cmd:'ai.perspective.grid.lockStation', checked:PG('lockStation')}},
      {sep:true},
      {n:{'zh-Hant':'定義格點…', 'zh-Hans':'定义网格…', en:'Define Grid…'}, id:'ui.perspectiveGridDialog', impl:'ai.ui.perspectiveGridDialog'},
      {n:{'zh-Hant':'單點透視', 'zh-Hans':'一点透视', en:'One Point Perspective'}, sub:[
        // <dynamic> perspective_presets::menu(1, …)：AI 2020 内建一项，使用者存的预设接在后面
        {n:{'zh-Hant':'[1P-標準檢視]', 'zh-Hans':'[1P-正常视图]', en:'[1P-Normal View]'}, id:'perspective.grid.preset.1P', radio:'perspectivePreset', impl:{cmd:'ai.perspective.grid.preset', params:{kind:1}, checked:() => !!window.AiPersp && AiPersp.defined() && AiPersp.current().name === '[1P-Normal View]'}, orig:{id:'perspective.grid.preset', params:{kind:1}}},
      ]},
      {n:{'zh-Hant':'兩點透視', 'zh-Hans':'两点透视', en:'Two Point Perspective'}, sub:[
        {n:{'zh-Hant':'[2P-標準檢視]', 'zh-Hans':'[2P-正常视图]', en:'[2P-Normal View]'}, id:'perspective.grid.preset.2P', radio:'perspectivePreset', impl:{cmd:'ai.perspective.grid.preset', params:{kind:2}, checked:() => !!window.AiPersp && AiPersp.defined() && AiPersp.current().name === '[2P-Normal View]'}, orig:{id:'perspective.grid.preset', params:{kind:2}}},
      ]},
      {n:{'zh-Hant':'三點透視', 'zh-Hans':'三点透视', en:'Three Point Perspective'}, sub:[
        {n:{'zh-Hant':'[3P-標準檢視]', 'zh-Hans':'[3P-正常视图]', en:'[3P-Normal View]'}, id:'perspective.grid.preset.3P', radio:'perspectivePreset', impl:{cmd:'ai.perspective.grid.preset', params:{kind:3}, checked:() => !!window.AiPersp && AiPersp.defined() && AiPersp.current().name === '[3P-Normal View]'}, orig:{id:'perspective.grid.preset', params:{kind:3}}},
      ]},
      {sep:true},
      {n:{'zh-Hant':'將格點儲存為預設集…', 'zh-Hans':'将网格存储为预设…', en:'Save Grid as Preset…'}, id:'ui.savePerspectivePreset', impl:'ai.ui.savePerspectivePreset'},
    ]},
    {n:flip(['隱藏格點', '隐藏网格', 'Hide Grid'], ['顯示格點', '显示网格', 'Show Grid'], V('grid', false)), id:'view.grid', impl:'ai.view.grid'},
    {n:{'zh-Hant':'靠齊格點', 'zh-Hans':'对齐网格', en:'Snap to Grid'}, id:'view.snapToGrid', check:true, impl:chk('ai.view.snapToGrid', 'snapToGrid')},
    {n:{'zh-Hant':'靠齊像素', 'zh-Hans':'对齐像素', en:'Snap to Pixel'}, id:'view.snapToPixel', check:true, impl:chk('ai.view.snapToPixel', 'snapToPixel')},
    {n:{'zh-Hant':'靠齊控制點', 'zh-Hans':'对齐点', en:'Snap to Point'}, id:'view.snapToPoint', check:true, impl:chk('ai.view.snapToPoint', 'snapToPoint')},
    {n:{'zh-Hant':'靠齊字符', 'zh-Hans':'对齐字形', en:'Snap to Glyph'}, id:'view.snapToGlyph', check:true, get impl(){ return window.CMD && CMD.map['ai.view.snapToGlyph'] ? {cmd:'ai.view.snapToGlyph', checked:() => !!window.AiMisc && !!AiMisc.view.snapToGlyph} : null; }},   // 原码 todo；这里照 AI 2020（menus/impl/ai-misc.js）
    {sep:true},
    {n:{'zh-Hant':'新增檢視…', 'zh-Hans':'新建视图…', en:'New View…'}, id:'view.saved.new', impl:{cmd:'ai.view.saved.new', params:{dialog:true}}},
    {n:{'zh-Hant':'編輯檢視…', 'zh-Hans':'编辑视图…', en:'Edit Views…'}, id:'view.saved.edit', impl:{cmd:'ai.view.saved.edit', params:{dialog:true}}},
    {sep:true},
    // 存下来的视图槽位：名字是存的那个视图的名（没存＝「—」；menus.rs:1197-1200）；AI 新建视图的预设名是「檢視 n／视图 n」
    {n:slot(1), id:'view.goto1', impl:{cmd:'ai.view.goto', params:{n:1}}},
    {n:slot(2), id:'view.goto2', impl:{cmd:'ai.view.goto', params:{n:2}}},
    {n:slot(3), id:'view.goto3', impl:{cmd:'ai.view.goto', params:{n:3}}},
    {n:slot(4), id:'view.goto4', impl:{cmd:'ai.view.goto', params:{n:4}}},
    {n:slot(5), id:'view.goto5', impl:{cmd:'ai.view.goto', params:{n:5}}},
    {n:slot(6), id:'view.goto6', impl:{cmd:'ai.view.goto', params:{n:6}}},
    {n:slot(7), id:'view.goto7', impl:{cmd:'ai.view.goto', params:{n:7}}},
    {n:slot(8), id:'view.goto8', impl:{cmd:'ai.view.goto', params:{n:8}}},
    {n:slot(9), id:'view.goto9', impl:{cmd:'ai.view.goto', params:{n:9}}},
    {n:slot(10), id:'view.goto10', impl:{cmd:'ai.view.goto', params:{n:10}}},
  ]
});
})();
