/* 堤麟画板 · 菜单树 · Photoshop ▸ 视图（照 photocraft menu_catalog.rs 抄；三语照 PS 2020 繁／简中介面）
 * 对上我们命令的：放大／缩小／按屏幕大小缩放／实际像素（view.*），200%（zoom.set）。
 * check:true＝勾选式开关；radio＝单选组（校样预设、像素长宽比、屏幕模式）。
 * 其余项照 photocraft ui-egui/src/view_cmds.rs、menus.rs、workspace_ui.rs、rulers.rs、snap_ui.rs、engine/src/{edit,file,color,slice}_cmds.rs、proof_sim.rs 抄成 ps.view.*，
 *   实作在 menus/impl/ps-view.js（勾选照 view_cmds.rs:323-377 checked、menus.rs:518-550）。
 *   还是 null 的：32 位预览选项（原码只给 32 位文件，我们只有 8 位）、清除所选画板参考线（按屏幕大小缩放画板接 artboard.fit、清除切片接 slice.clear）。
 */
(function(){
const PV = () => window.PsView;
const on = f => () => { try { return !!PV() && !!f(PV()); } catch(e){ return false; } };
const tog = (cmd, f) => ({cmd, checked:on(f)});
const show = k => tog('ps.view.show.' + k, v => v.show[k]);
const snapTo = k => tog('ps.view.snapTo.' + k, v => v.snapTo[k]);
const proof = k => ({cmd:'ps.view.proofSetup.' + k, checked:on(v => v.proof.enabled && v.proof.setup.preset === k)});
const par = k => ({cmd:'ps.view.pixelAspectRatio.' + k, checked:on(v => v.pixelAspect === k)});
const scr = (k, tb) => ({cmd:'ps.view.screenMode.' + k, checked:() => !!window.Toolbar && Toolbar.screen === tb});

MenuTrees.add('ps', 'view', {
  n:{'zh-Hant':'檢視', 'zh-Hans':'视图', en:'View'},
  items:[
    {n:{'zh-Hant':'校樣設定', 'zh-Hans':'校样设置', en:'Proof Setup'}, sub:[
      {n:{'zh-Hant':'自訂…', 'zh-Hans':'自定…', en:'Custom…'}, id:'view.proofSetup.custom', impl:{cmd:'ps.view.proofSetup', params:{dialog:true}, checked:on(v => v.proof.enabled && v.proof.setup.preset === 'custom')}},
      {sep:true},
      {n:{'zh-Hant':'工作中的 CMYK', 'zh-Hans':'工作中的 CMYK', en:'Working CMYK'}, id:'view.proofSetup.workingCmyk', radio:'proofSetup', impl:proof('workingCmyk')},
      {n:{'zh-Hant':'工作中的青色版', 'zh-Hans':'工作中的青版', en:'Working Cyan Plate'}, id:'view.proofSetup.workingCyanPlate', radio:'proofSetup', impl:proof('workingCyanPlate')},
      {n:{'zh-Hant':'工作中的洋紅色版', 'zh-Hans':'工作中的洋红版', en:'Working Magenta Plate'}, id:'view.proofSetup.workingMagentaPlate', radio:'proofSetup', impl:proof('workingMagentaPlate')},
      {n:{'zh-Hant':'工作中的黃色版', 'zh-Hans':'工作中的黄版', en:'Working Yellow Plate'}, id:'view.proofSetup.workingYellowPlate', radio:'proofSetup', impl:proof('workingYellowPlate')},
      {n:{'zh-Hant':'工作中的黑色版', 'zh-Hans':'工作中的黑版', en:'Working Black Plate'}, id:'view.proofSetup.workingBlackPlate', radio:'proofSetup', impl:proof('workingBlackPlate')},
      {n:{'zh-Hant':'工作中的 CMY 色版', 'zh-Hans':'工作中的 CMY 版', en:'Working CMY Plate'}, id:'view.proofSetup.workingCmyPlate', radio:'proofSetup', impl:proof('workingCmyPlate')},
      {sep:true},
      {n:{'zh-Hant':'舊版 Macintosh RGB', 'zh-Hans':'旧版 Macintosh RGB', en:'Legacy Macintosh RGB'}, id:'view.proofSetup.legacyMacintoshRgb', radio:'proofSetup', impl:proof('legacyMacintoshRgb')},
      {n:{'zh-Hant':'網際網路標準 RGB', 'zh-Hans':'互联网标准 RGB', en:'Internet Standard RGB'}, id:'view.proofSetup.internetStandardRgb', radio:'proofSetup', impl:proof('internetStandardRgb')},
      {n:{'zh-Hant':'顯示器 RGB', 'zh-Hans':'显示器 RGB', en:'Monitor RGB'}, id:'view.proofSetup.monitorRgb', radio:'proofSetup', impl:proof('monitorRgb')},
      {sep:true},
      {n:{'zh-Hant':'色盲 - 紅色盲類型', 'zh-Hans':'色盲 - 红色盲型', en:'Color Blindness — Protanopia-type'}, id:'view.proofSetup.colorBlindnessProtanopia', radio:'proofSetup', impl:proof('colorBlindnessProtanopia')},
      {n:{'zh-Hant':'色盲 - 綠色盲類型', 'zh-Hans':'色盲 - 绿色盲型', en:'Color Blindness — Deuteranopia-type'}, id:'view.proofSetup.colorBlindnessDeuteranopia', radio:'proofSetup', impl:proof('colorBlindnessDeuteranopia')},
    ]},
    {n:{'zh-Hant':'校樣色彩', 'zh-Hans':'校样颜色', en:'Proof Colors'}, id:'view.proofColors', key:'Ctrl+Y', check:true, impl:tog('ps.view.proofColors', v => v.proof.enabled)},
    {n:{'zh-Hant':'色域警告', 'zh-Hans':'色域警告', en:'Gamut Warning'}, id:'view.gamutWarning', key:'Ctrl+Shift+Y', check:true, impl:tog('ps.view.gamutWarning', v => v.proof.gamutWarning)},
    {sep:true},
    {n:{'zh-Hant':'像素外觀比例', 'zh-Hans':'像素长宽比', en:'Pixel Aspect Ratio'}, sub:[
      {n:{'zh-Hant':'自訂像素外觀比例…', 'zh-Hans':'自定像素长宽比…', en:'Custom Pixel Aspect Ratio…'}, id:'view.pixelAspectRatio.custom', check:true, impl:{cmd:'ps.view.pixelAspectRatio.custom', params:{dialog:true}, checked:on(v => /^custom:/.test(v.pixelAspect))}},
      {sep:true},
      {n:{'zh-Hant':'正方形', 'zh-Hans':'方形', en:'Square'}, id:'view.pixelAspectRatio.square', radio:'pixelAspect', impl:par('square')},
      {n:{'zh-Hant':'D1/DV NTSC (0.91)', 'zh-Hans':'D1/DV NTSC (0.91)', en:'D1/DV NTSC (0.91)'}, id:'view.pixelAspectRatio.d1DvNtsc', radio:'pixelAspect', impl:par('d1DvNtsc')},
      {n:{'zh-Hant':'D1/DV PAL (1.09)', 'zh-Hans':'D1/DV PAL (1.09)', en:'D1/DV PAL (1.09)'}, id:'view.pixelAspectRatio.d1DvPal', radio:'pixelAspect', impl:par('d1DvPal')},
      {n:{'zh-Hant':'D1/DV NTSC 寬螢幕 (1.21)', 'zh-Hans':'D1/DV NTSC 宽银幕 (1.21)', en:'D1/DV NTSC Widescreen (1.21)'}, id:'view.pixelAspectRatio.d1DvNtscWidescreen', radio:'pixelAspect', impl:par('d1DvNtscWidescreen')},
      {n:{'zh-Hant':'HDV 1080/DVCPRO HD 720 (1.33)', 'zh-Hans':'HDV 1080/DVCPRO HD 720 (1.33)', en:'HDV 1080/DVCPRO HD 720 (1.33)'}, id:'view.pixelAspectRatio.hdv1080', radio:'pixelAspect', impl:par('hdv1080')},
      {n:{'zh-Hant':'D1/DV PAL 寬螢幕 (1.46)', 'zh-Hans':'D1/DV PAL 宽银幕 (1.46)', en:'D1/DV PAL Widescreen (1.46)'}, id:'view.pixelAspectRatio.d1DvPalWidescreen', radio:'pixelAspect', impl:par('d1DvPalWidescreen')},
      {n:{'zh-Hant':'DVCPRO HD 1080/HDV 1080 (1.5)', 'zh-Hans':'DVCPRO HD 1080/HDV 1080 (1.5)', en:'DVCPRO HD 1080/HDV 1080 (1.5)'}, id:'view.pixelAspectRatio.dvcproHd1080', radio:'pixelAspect', impl:par('dvcproHd1080')},
      {n:{'zh-Hant':'變形 2:1 (2)', 'zh-Hans':'变形 2:1 (2)', en:'Anamorphic 2:1 (2)'}, id:'view.pixelAspectRatio.anamorphic2To1', radio:'pixelAspect', impl:par('anamorphic2To1')},
    ]},
    {n:{'zh-Hant':'像素外觀比例校正', 'zh-Hans':'像素长宽比校正', en:'Pixel Aspect Ratio Correction'}, id:'view.pixelAspectRatioCorrection', check:true, impl:tog('ps.view.pixelAspectRatioCorrection', v => v.pixelAspectCorrection)},
    {sep:true},
    {n:{'zh-Hant':'32 位元預視選項…', 'zh-Hans':'32 位预览选项…', en:'32-bit Preview Options…'}, id:'view.thirtyTwoBitPreviewOptions', impl:{cmd:'ps.view.thirtyTwoBitPreviewOptions', params:{dialog:true}}},   // 原码 is_32：只给 32 位文件（实作 menus/impl/ps-file2.js）
    {sep:true},
    // 下面四项走 engine.js 的 view.*（PS 级距表踏一级／适合屏幕并置中／缩放设 1）
    {n:{'zh-Hant':'放大顯示', 'zh-Hans':'放大', en:'Zoom In'}, id:'view.zoomIn', key:'Ctrl+=', impl:'view.zoomIn'},
    {n:{'zh-Hant':'縮小顯示', 'zh-Hans':'缩小', en:'Zoom Out'}, id:'view.zoomOut', key:'Ctrl+-', impl:'view.zoomOut'},
    {n:{'zh-Hant':'顯示全頁', 'zh-Hans':'按屏幕大小缩放', en:'Fit on Screen'}, id:'view.fitOnScreen', key:'Ctrl+0', impl:'view.fit'},
    {n:{'zh-Hant':'依螢幕大小顯示圖層', 'zh-Hans':'按屏幕大小缩放图层', en:'Fit Layer(s) on Screen'}, id:'view.fitLayersOnScreen', impl:'ps.view.fitLayersOnScreen'},
    {n:{'zh-Hant':'依螢幕大小顯示工作區域', 'zh-Hans':'按屏幕大小缩放画板', en:'Fit Artboard on Screen'}, id:'view.fitArtboardOnScreen', impl:'artboard.fit'},   // tools/artboard.js
    {n:{'zh-Hant':'實際像素', 'zh-Hans':'实际像素', en:'100%'}, id:'view.actualPixels', key:'Ctrl+1', impl:'view.actual'},
    // 200%：zoom.set 只改倍率、视窗正中不动＝PS 菜单 200% 的行为
    {n:{'zh-Hant':'200%', 'zh-Hans':'200%', en:'200%'}, id:'view.twoHundredPercent', impl:{cmd:'zoom.set', params:{zoom:2}}},
    {n:{'zh-Hant':'列印尺寸', 'zh-Hans':'打印尺寸', en:'Print Size'}, id:'view.printSize', impl:'ps.view.printSize'},
    {sep:true},
    {n:{'zh-Hant':'水平翻轉', 'zh-Hans':'水平翻转', en:'Flip Horizontal'}, id:'view.flipHorizontal', check:true, impl:tog('ps.view.flipHorizontal', v => v.flip)},
    {n:{'zh-Hant':'螢幕模式', 'zh-Hans':'屏幕模式', en:'Screen Mode'}, sub:[
      {n:{'zh-Hant':'標準螢幕模式', 'zh-Hans':'标准屏幕模式', en:'Standard Screen Mode'}, id:'view.screenMode.standard', radio:'screenMode', impl:scr('standard', 'standard')},
      {n:{'zh-Hant':'含選單列的全螢幕模式', 'zh-Hans':'带有菜单栏的全屏模式', en:'Full Screen Mode With Menu Bar'}, id:'view.screenMode.fullScreenWithMenuBar', radio:'screenMode', impl:scr('fullScreenWithMenuBar', 'fullmenu')},
      {n:{'zh-Hant':'全螢幕模式', 'zh-Hans':'全屏模式', en:'Full Screen Mode'}, id:'view.screenMode.fullScreen', radio:'screenMode', impl:scr('fullScreen', 'full')},
      // 全屏锁定快捷键（KbLock）PS 2020 视图菜单没有这项 ⇒ 不上菜单，预设开、照 PS 全屏时 Ctrl+T／N／W 归画板；开关只留命令 ps.view.lockShortcutsInFullScreen
    ]},
    {sep:true},
    {n:{'zh-Hant':'顯示額外內容', 'zh-Hans':'显示额外内容', en:'Extras'}, id:'view.extras', key:'Ctrl+H', check:true, impl:tog('ps.view.extras', v => v.extras)},
    {n:{'zh-Hant':'顯示', 'zh-Hans':'显示', en:'Show'}, sub:[
      {n:{'zh-Hant':'圖層邊緣', 'zh-Hans':'图层边缘', en:'Layer Edges'}, id:'view.show.layerEdges', check:true, impl:show('layerEdges')},
      {n:{'zh-Hant':'選取範圍邊緣', 'zh-Hans':'选区边缘', en:'Selection Edges'}, id:'view.show.selectionEdges', check:true, impl:show('selectionEdges')},
      {n:{'zh-Hant':'目標路徑', 'zh-Hans':'目标路径', en:'Target Path'}, id:'view.show.targetPath', key:'Ctrl+Shift+H', check:true, impl:show('targetPath')},
      {n:{'zh-Hant':'格點', 'zh-Hans':'网格', en:'Grid'}, id:'view.show.grid', key:"Ctrl+'", check:true, impl:tog('ps.view.show.grid', v => v.e.grid)},
      {n:{'zh-Hant':'參考線', 'zh-Hans':'参考线', en:'Guides'}, id:'view.show.guides', key:'Ctrl+;', check:true, impl:tog('ps.view.show.guides', v => v.e.guides)},
      {n:{'zh-Hant':'版面參考線', 'zh-Hans':'画布参考线', en:'Canvas Guides'}, id:'view.show.canvasGuides', check:true, impl:show('canvasGuides')},
      {n:{'zh-Hant':'工作區域參考線', 'zh-Hans':'画板参考线', en:'Artboard Guides'}, id:'view.show.artboardGuides', check:true, impl:show('artboardGuides')},
      {n:{'zh-Hant':'計數', 'zh-Hans':'计数', en:'Count'}, id:'view.show.count', check:true, impl:show('count')},
      {n:{'zh-Hant':'智慧型參考線', 'zh-Hans':'智能参考线', en:'Smart Guides'}, id:'view.show.smartGuides', check:true, impl:show('smartGuides')},
      {n:{'zh-Hant':'切片', 'zh-Hans':'切片', en:'Slices'}, id:'view.show.slices', check:true, impl:show('slices')},
      {n:{'zh-Hant':'備忘稿', 'zh-Hans':'注释', en:'Notes'}, id:'view.show.notes', check:true, impl:show('notes')},
      {n:{'zh-Hant':'像素格點', 'zh-Hans':'像素网格', en:'Pixel Grid'}, id:'view.show.pixelGrid', check:true, impl:show('pixelGrid')},
      {n:{'zh-Hant':'筆刷預視', 'zh-Hans':'画笔预览', en:'Brush Preview'}, id:'view.show.brushPreview', check:true, impl:show('brushPreview')},
      {n:{'zh-Hant':'網紋', 'zh-Hans':'网格', en:'Mesh'}, id:'view.show.mesh', check:true, impl:show('mesh')},
      {n:{'zh-Hant':'編輯圖釘', 'zh-Hans':'编辑图钉', en:'Edit Pins'}, id:'view.show.editPins', check:true, impl:show('editPins')},
      {sep:true},
      {n:{'zh-Hant':'全部', 'zh-Hans':'全部', en:'All'}, id:'view.show.all', impl:'ps.view.show.all'},
      {n:{'zh-Hant':'顯示額外內容選項…', 'zh-Hans':'显示额外选项…', en:'Show Extras Options…'}, id:'view.show.showExtrasOptions', impl:{cmd:'ps.view.show.showExtrasOptions', params:{dialog:true}}},
    ]},
    {sep:true},
    {n:{'zh-Hant':'尺標', 'zh-Hans':'标尺', en:'Rulers'}, id:'view.rulers', key:'Ctrl+R', check:true, impl:tog('ps.view.rulers', v => v.e.rulers)},
    {sep:true},
    {n:{'zh-Hant':'靠齊', 'zh-Hans':'对齐', en:'Snap'}, id:'view.snap', key:'Ctrl+Shift+;', check:true, impl:tog('ps.view.snap', v => v.e.snap)},
    {n:{'zh-Hant':'靠齊至', 'zh-Hans':'对齐到', en:'Snap To'}, sub:[
      {n:{'zh-Hant':'參考線', 'zh-Hans':'参考线', en:'Guides'}, id:'view.snapTo.guides', check:true, impl:snapTo('guides')},
      {n:{'zh-Hant':'格點', 'zh-Hans':'网格', en:'Grid'}, id:'view.snapTo.grid', check:true, impl:snapTo('grid')},
      {n:{'zh-Hant':'圖層', 'zh-Hans':'图层', en:'Layers'}, id:'view.snapTo.layers', check:true, impl:snapTo('layers')},
      {n:{'zh-Hant':'切片', 'zh-Hans':'切片', en:'Slices'}, id:'view.snapTo.slices', check:true, impl:snapTo('slices')},
      {n:{'zh-Hant':'文件邊界', 'zh-Hans':'文档边界', en:'Document Bounds'}, id:'view.snapTo.documentBounds', check:true, impl:snapTo('documentBounds')},
      {sep:true},
      {n:{'zh-Hant':'全部', 'zh-Hans':'全部', en:'All'}, id:'view.snapTo.all', impl:'ps.view.snapTo.all'},
    ]},
    {sep:true},
    {n:{'zh-Hant':'鎖定參考線', 'zh-Hans':'锁定参考线', en:'Lock Guides'}, id:'view.lockGuides', key:'Ctrl+Alt+;', check:true, impl:tog('ps.view.lockGuides', v => v.locked())},
    {n:{'zh-Hant':'清除參考線', 'zh-Hans':'清除参考线', en:'Clear Guides'}, id:'view.clearGuides', impl:'ps.view.clearGuides'},
    {n:{'zh-Hant':'清除選取的工作區域參考線', 'zh-Hans':'清除所选画板参考线', en:'Clear Selected Artboard Guides'}, id:'view.clearSelectedArtboardGuides', impl:'ps.view.clearSelectedArtboardGuides'},   // 原码要先选画板（实作 menus/impl/ps-file2.js）
    {n:{'zh-Hant':'清除版面參考線', 'zh-Hans':'清除画布参考线', en:'Clear Canvas Guides'}, id:'view.clearCanvasGuides', impl:'ps.view.clearCanvasGuides'},
    {n:{'zh-Hant':'新增參考線…', 'zh-Hans':'新建参考线…', en:'New Guide…'}, id:'view.newGuide', impl:{cmd:'ps.view.newGuide', params:{dialog:true}}},
    {n:{'zh-Hant':'新增參考線配置…', 'zh-Hans':'新建参考线版面…', en:'New Guide Layout…'}, id:'view.newGuideLayout', impl:{cmd:'ps.view.newGuideLayout', params:{dialog:true}}},
    {n:{'zh-Hant':'從形狀新增參考線', 'zh-Hans':'通过形状新建参考线', en:'New Guides From Shape'}, id:'view.newGuidesFromShape', impl:'ps.view.newGuidesFromShape'},
    {sep:true},
    {n:{'zh-Hant':'鎖定切片', 'zh-Hans':'锁定切片', en:'Lock Slices'}, id:'view.lockSlices', check:true, impl:tog('ps.view.lockSlices', v => v.lockSlices)},
    {n:{'zh-Hant':'清除切片', 'zh-Hans':'清除切片', en:'Clear Slices'}, id:'view.clearSlices', impl:'slice.clear'},   // tools/slice.js
    {sep:true},
    {n:{'zh-Hant':'圖樣預視', 'zh-Hans':'图案预览', en:'Pattern Preview'}, id:'view.patternPreview', check:true, impl:tog('ps.view.patternPreview', v => v.patternPreview)},
    {n:{'zh-Hant':'像素藝術預視', 'zh-Hans':'像素画预览', en:'Pixel Art Preview'}, id:'view.pixelArtPreview', check:true, impl:tog('ps.view.pixelArtPreview', v => v.pixelArtPreview)},
  ]
});
})();
