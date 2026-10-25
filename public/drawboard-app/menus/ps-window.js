/* 堤麟画板 · 菜单树 · Photoshop ▸ 窗口（照 photocraft menu_catalog.rs 抄；三语照 PS 2020 繁／简中介面）
 * 面板项一律 check:true（勾＝面板开着）；工作区预设是单选组 radio:'workspace'。
 * 注意：「键盘快捷键…」原码 id 是 edit.keyboardShortcuts，和 编辑 菜单那一项同 id（同一条命令挂两处），照抄不改。
 * 照 photocraft view_cmds.rs（面板切换、排列）、menus.rs（面板别名、工作区）、workspace_ui.rs（新建／删除／锁定工作区、修改键）抄成 ps.window.*，
 *   实作在 menus/impl/ps-window.js（面板外壳 menus/impl/panels.js＝window.DlPanels）；字符／段落／字形／样式面板走 ps-type 的 ps.type.panels.*。
 *   面板全部能开关；内容照原码各面板的栏位（看 impl 档头的对照表）。
 */
(function(){
const W = () => window.PsWindow;
const pan = k => ({cmd:'ps.window.panel', params:{panel:k}, checked:() => !!W() && W().isOpen(k)});
const ws = k => ({cmd:'ps.window.workspace.' + k, checked:() => !!W() && W().workspace.cur === ({essentials:'Essentials', photography:'Photography', painting:'Painting', pixelArt:'Pixel Art', graphicAndWeb:'Graphic and Web', motion:'Motion'})[k]});
const ar = k => ({cmd:'ps.window.arrange.' + k, checked:() => !!W() && W().windows.arrange === k});
const arr = k => 'ps.window.arrange.' + k;

MenuTrees.add('ps', 'window', {
  n:{'zh-Hant':'視窗', 'zh-Hans':'窗口', en:'Window'},
  items:[
    {n:{'zh-Hant':'排列順序', 'zh-Hans':'排列', en:'Arrange'}, sub:[
      {n:{'zh-Hant':'全部垂直並排', 'zh-Hans':'全部垂直拼贴', en:'Tile All Vertically'}, id:'window.arrange.tileAllVertically', check:true, impl:ar('tileAllVertically')},
      {n:{'zh-Hant':'全部水平並排', 'zh-Hans':'全部水平拼贴', en:'Tile All Horizontally'}, id:'window.arrange.tileAllHorizontally', check:true, impl:ar('tileAllHorizontally')},
      {n:{'zh-Hant':'雙欄垂直', 'zh-Hans':'双联垂直', en:'2-up Vertical'}, id:'window.arrange.twoUpVertical', check:true, impl:ar('twoUpVertical')},
      {n:{'zh-Hant':'雙欄水平', 'zh-Hans':'双联水平', en:'2-up Horizontal'}, id:'window.arrange.twoUpHorizontal', check:true, impl:ar('twoUpHorizontal')},
      {n:{'zh-Hant':'三欄垂直', 'zh-Hans':'三联垂直', en:'3-up Vertical'}, id:'window.arrange.threeUpVertical', check:true, impl:ar('threeUpVertical')},
      {n:{'zh-Hant':'三欄水平', 'zh-Hans':'三联水平', en:'3-up Horizontal'}, id:'window.arrange.threeUpHorizontal', check:true, impl:ar('threeUpHorizontal')},
      {n:{'zh-Hant':'三欄堆疊', 'zh-Hans':'三联堆积', en:'3-up Stacked'}, id:'window.arrange.threeUpStacked', check:true, impl:ar('threeUpStacked')},
      {n:{'zh-Hant':'四欄', 'zh-Hans':'四联', en:'4-up'}, id:'window.arrange.fourUp', check:true, impl:ar('fourUp')},
      {n:{'zh-Hant':'六欄', 'zh-Hans':'六联', en:'6-up'}, id:'window.arrange.sixUp', check:true, impl:ar('sixUp')},
      {sep:true},
      {n:{'zh-Hant':'將全部合併至標籤', 'zh-Hans':'将所有内容合并到选项卡中', en:'Consolidate All to Tabs'}, id:'window.arrange.consolidateAllToTabs', impl:{cmd:arr('consolidateAllToTabs'), checked:() => !!W() && W().windows.arrange === 'tabs'}},
      {n:{'zh-Hant':'重疊顯示', 'zh-Hans':'层叠', en:'Cascade'}, id:'window.arrange.cascade', impl:arr('cascade')},
      {n:{'zh-Hant':'並排顯示', 'zh-Hans':'平铺', en:'Tile'}, id:'window.arrange.tile', check:true, impl:ar('tile')},
      {sep:true},
      {n:{'zh-Hant':'浮動於視窗', 'zh-Hans':'在窗口中浮动', en:'Float in Window'}, id:'window.arrange.floatInWindow', impl:arr('floatInWindow')},
      {n:{'zh-Hant':'全部浮動於視窗', 'zh-Hans':'使所有内容在窗口中浮动', en:'Float All in Windows'}, id:'window.arrange.floatAllInWindows', impl:arr('floatAllInWindows')},
      {sep:true},
      {n:{'zh-Hant':'新增文件視窗', 'zh-Hans':'为文档新建窗口', en:'New Window for Document'}, id:'window.arrange.newWindowForDocument', impl:arr('newWindowForDocument')},
      {sep:true},
      {n:{'zh-Hant':'符合縮放', 'zh-Hans':'匹配缩放', en:'Match Zoom'}, id:'window.arrange.matchZoom', impl:arr('matchZoom')},
      {n:{'zh-Hant':'符合位置', 'zh-Hans':'匹配位置', en:'Match Location'}, id:'window.arrange.matchLocation', impl:arr('matchLocation')},
      {n:{'zh-Hant':'符合旋轉', 'zh-Hans':'匹配旋转', en:'Match Rotation'}, id:'window.arrange.matchRotation', impl:arr('matchRotation')},
      {n:{'zh-Hant':'全部符合', 'zh-Hans':'全部匹配', en:'Match All'}, id:'window.arrange.matchAll', impl:arr('matchAll')},
    ]},
    {n:{'zh-Hant':'工作區', 'zh-Hans':'工作区', en:'Workspace'}, sub:[
      {n:{'zh-Hant':'基本功能', 'zh-Hans':'基本功能', en:'Essentials'}, id:'window.workspace.essentials', radio:'workspace', impl:ws('essentials')},
      {n:{'zh-Hant':'攝影', 'zh-Hans':'摄影', en:'Photography'}, id:'window.workspace.photography', radio:'workspace', impl:ws('photography')},
      {n:{'zh-Hant':'繪畫', 'zh-Hans':'绘画', en:'Painting'}, id:'window.workspace.painting', radio:'workspace', impl:ws('painting')},
      {n:{'zh-Hant':'像素藝術', 'zh-Hans':'像素画', en:'Pixel Art'}, id:'window.workspace.pixelArt', radio:'workspace', impl:ws('pixelArt')},
      {n:{'zh-Hant':'圖形和網頁', 'zh-Hans':'图形和 Web', en:'Graphic and Web'}, id:'window.workspace.graphicAndWeb', radio:'workspace', impl:ws('graphicAndWeb')},
      {n:{'zh-Hant':'動態', 'zh-Hans':'动感', en:'Motion'}, id:'window.workspace.motion', radio:'workspace', impl:ws('motion')},
      // 存下来的工作区由 impl 在这里插进来（window.workspace.select）
      {sep:true},
      {n:{'zh-Hant':'重設工作區', 'zh-Hans':'复位工作区', en:'Reset Workspace'}, id:'window.workspace.resetWorkspace', impl:'ps.window.workspace.resetWorkspace'},
      {n:{'zh-Hant':'新增工作區…', 'zh-Hans':'新建工作区…', en:'New Workspace…'}, id:'window.workspace.newWorkspace', impl:{cmd:'ps.window.workspace.newWorkspace', params:{dialog:true}}},
      {n:{'zh-Hant':'刪除工作區…', 'zh-Hans':'删除工作区…', en:'Delete Workspace…'}, id:'window.workspace.deleteWorkspace', impl:{cmd:'ps.window.workspace.deleteWorkspace', params:{dialog:true}}},
      {sep:true},
      {n:{'zh-Hant':'鍵盤快速鍵…', 'zh-Hans':'键盘快捷键…', en:'Keyboard Shortcuts…'}, id:'edit.keyboardShortcuts', key:'Ctrl+Alt+Shift+K', impl:{cmd:'ps.edit.keyboardShortcuts', params:{dialog:true}}},
      {n:{'zh-Hant':'鎖定工作區', 'zh-Hans':'锁定工作区', en:'Lock Workspace'}, id:'window.workspace.lockWorkspace', check:true, impl:{cmd:'ps.window.workspace.lockWorkspace', checked:() => !!W() && W().workspace.locked}},
    ]},
    {sep:true},
    {n:{'zh-Hant':'動作', 'zh-Hans':'动作', en:'Actions'}, id:'window.panel.actions', key:'Alt+F9', check:true, impl:pan('actions')},
    {n:{'zh-Hant':'調整', 'zh-Hans':'调整', en:'Adjustments'}, id:'window.panel.adjustments', check:true, impl:pan('adjustments')},
    {n:{'zh-Hant':'筆刷設定', 'zh-Hans':'画笔设置', en:'Brush Settings'}, id:'window.panel.brushSettings', key:'F5', check:true, impl:pan('brushSettings')},
    {n:{'zh-Hant':'筆刷', 'zh-Hans':'画笔', en:'Brushes'}, id:'window.panel.brushes', check:true, impl:pan('brushes')},
    {n:{'zh-Hant':'色版', 'zh-Hans':'通道', en:'Channels'}, id:'window.panel.channels', check:true, impl:pan('channels')},
    {n:{'zh-Hant':'字元', 'zh-Hans':'字符', en:'Character'}, id:'window.panel.character', check:true, impl:pan('character')},
    {n:{'zh-Hant':'字元樣式', 'zh-Hans':'字符样式', en:'Character Styles'}, id:'window.panel.characterStyles', check:true, impl:pan('characterStyles')},
    {n:{'zh-Hant':'仿製來源', 'zh-Hans':'仿制源', en:'Clone Source'}, id:'window.panel.cloneSource', check:true, impl:pan('cloneSource')},
    {n:{'zh-Hant':'顏色', 'zh-Hans':'颜色', en:'Color'}, id:'window.panel.color', key:'F6', check:true, impl:pan('color')},
    {n:{'zh-Hant':'字符', 'zh-Hans':'字形', en:'Glyphs'}, id:'window.panel.glyphs', check:true, impl:pan('glyphs')},
    {n:{'zh-Hant':'漸層', 'zh-Hans':'渐变', en:'Gradients'}, id:'window.panel.gradients', check:true, impl:pan('gradients')},
    {n:{'zh-Hant':'色階分佈圖', 'zh-Hans':'直方图', en:'Histogram'}, id:'window.panel.histogram', check:true, impl:pan('histogram')},
    {n:{'zh-Hant':'步驟記錄', 'zh-Hans':'历史记录', en:'History'}, id:'window.panel.history', check:true, impl:pan('history')},
    {n:{'zh-Hant':'資訊', 'zh-Hans':'信息', en:'Info'}, id:'window.panel.info', key:'F8', check:true, impl:pan('info')},
    {n:{'zh-Hant':'圖層構圖', 'zh-Hans':'图层复合', en:'Layer Comps'}, id:'window.panel.layerComps', check:true, impl:pan('layerComps')},
    {n:{'zh-Hant':'圖層', 'zh-Hans':'图层', en:'Layers'}, id:'window.panel.layers', key:'F7', check:true, impl:pan('layers')},
    {n:{'zh-Hant':'測量記錄', 'zh-Hans':'测量记录', en:'Measurement Log'}, id:'window.panel.measurementLog', check:true, impl:pan('measurementLog')},
    {n:{'zh-Hant':'輔助按鍵', 'zh-Hans':'修改键', en:'Modifier Keys'}, id:'window.panel.modifierKeys', check:true, impl:pan('modifierKeys')},
    {n:{'zh-Hant':'導覽器', 'zh-Hans':'导航器', en:'Navigator'}, id:'window.panel.navigator', check:true, impl:pan('navigator')},
    {n:{'zh-Hant':'備忘稿', 'zh-Hans':'注释', en:'Notes'}, id:'window.panel.notes', check:true, impl:pan('notes')},
    {n:{'zh-Hant':'段落', 'zh-Hans':'段落', en:'Paragraph'}, id:'window.panel.paragraph', check:true, impl:pan('paragraph')},
    {n:{'zh-Hant':'段落樣式', 'zh-Hans':'段落样式', en:'Paragraph Styles'}, id:'window.panel.paragraphStyles', check:true, impl:pan('paragraphStyles')},
    {n:{'zh-Hant':'路徑', 'zh-Hans':'路径', en:'Paths'}, id:'window.panel.paths', check:true, impl:pan('paths')},
    {n:{'zh-Hant':'圖樣', 'zh-Hans':'图案', en:'Patterns'}, id:'window.panel.patterns', check:true, impl:pan('patterns')},
    {n:{'zh-Hant':'內容', 'zh-Hans':'属性', en:'Properties'}, id:'window.panel.properties', check:true, impl:pan('properties')},
    {n:{'zh-Hant':'形狀', 'zh-Hans':'形状', en:'Shapes'}, id:'window.panel.shapes', check:true, impl:pan('shapes')},
    {n:{'zh-Hant':'樣式', 'zh-Hans':'样式', en:'Styles'}, id:'window.panel.styles', check:true, impl:pan('styles')},
    {n:{'zh-Hant':'色票', 'zh-Hans':'色板', en:'Swatches'}, id:'window.panel.swatches', check:true, impl:pan('swatches')},
    {n:{'zh-Hant':'時間軸', 'zh-Hans':'时间轴', en:'Timeline'}, id:'window.panel.timeline', check:true, impl:pan('timeline')},
    {n:{'zh-Hant':'工具預設集', 'zh-Hans':'工具预设', en:'Tool Presets'}, id:'window.panel.toolPresets', check:true, impl:pan('toolPresets')},
    {sep:true},
    {n:{'zh-Hant':'選項', 'zh-Hans':'选项', en:'Options'}, id:'window.panel.options', check:true, impl:pan('options')},
    {n:{'zh-Hant':'工具', 'zh-Hans':'工具', en:'Tools'}, id:'window.panel.tools', check:true, impl:pan('tools')},
  ]
});
})();
