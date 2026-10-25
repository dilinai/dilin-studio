/* 堤麟画板 · 菜单树 · Illustrator ▸ 文件（照 vectorcraft menus.rs menu_tree() 抄；三语照 AI 2020 繁／简中介面）
   各项照原码实作在 menus/impl/ai-file.js（命令名 ai.<原码 id>）。快捷键照原码 menus.rs UI_COMMANDS／cmd! 表补齐
   （存储 Cmd+S、导出为多种屏幕 Cmd+Alt+E、文档设置 Cmd+Alt+P、打包 Cmd+Alt+Shift+P、存储为 Web 所用格式 Cmd+Alt+Shift+S）。 */
MenuTrees.add('ai', 'file', {
  n:{'zh-Hant':'檔案', 'zh-Hans':'文件', en:'File'},
  items:[
    // 我们的 file.new ＝ 开新文件（可给宽高／背景）
    {n:{'zh-Hant':'新增…', 'zh-Hans':'新建…', en:'New…'}, id:'file.newDialog', impl:'file.new'},
    // save.rs:562 file.newFromTemplate：开一份模板（或任何读得懂的档）成为新的未命名文件
    {n:{'zh-Hant':'從範本新增…', 'zh-Hans':'从模板新建…', en:'New from Template…'}, id:'file.newFromTemplate', key:'Ctrl+Shift+N', impl:'ai.file.newFromTemplate'},
    // AI 的「开启旧档」开的是本家文件；我们本家文件是 .dlcanvas ⇒ file.openProject（我们的 file.open 是挑一张图放进来当新层，对的是下面的「置入」）
    {n:{'zh-Hant':'開啟舊檔…', 'zh-Hans':'打开…', en:'Open…'}, id:'file.open', impl:'file.openProject'},
    {n:{'zh-Hant':'最近使用的檔案', 'zh-Hans':'最近打开的文件', en:'Open Recent Files'}, sub:[
      // 原码 menus.rs:1466 程式生成 file.openRecent1…20；impl 档载入后按浏览器里记的最近档案（IndexedDB）重建这一串
      {n:{'zh-Hant':'最近的檔案', 'zh-Hans':'最近的文件', en:'Recent File'}, id:'file.recent', impl:{cmd:'ai.file.openRecent', params:{index:1}}},
      {sep:true},
      {n:{'zh-Hant':'清除最近使用的檔案', 'zh-Hans':'清除最近打开的文件', en:'Clear Recent Files'}, id:'file.clearRecent', impl:'ai.file.clearRecent'},
    ]},
    // 原码 io.rs:538 reveal 要桌面版的档案管理员；网页版改成开「文件位置」资讯框（menus/impl/ai-misc.js）
    {n:{'zh-Hant':'在資料夾中顯示', 'zh-Hans':'在文件夹中显示', en:'Show in Folder'}, id:'file.reveal', get impl(){ return window.CMD && CMD.map['ai.file.reveal'] ? 'ai.file.reveal' : null; }},
    {sep:true},
    {n:{'zh-Hant':'關閉', 'zh-Hans':'关闭', en:'Close'}, id:'file.close', key:'Ctrl+W', impl:'ai.file.close'},
    {n:{'zh-Hant':'全部關閉', 'zh-Hans':'全部关闭', en:'Close All'}, id:'file.closeAll', key:'Ctrl+Alt+W', impl:'ai.file.closeAll'},
    // 存储：照原码 file.save（写回本文件自己的格式与名字；从没存过＝先问存储为）；最后还是透过 file.saveProject 出档（网站版存进云盘）
    {n:{'zh-Hant':'儲存', 'zh-Hans':'存储', en:'Save'}, id:'file.save', key:'Ctrl+S', impl:'ai.file.save'},
    {n:{'zh-Hant':'另存新檔…', 'zh-Hans':'存储为…', en:'Save As…'}, id:'file.saveAs', key:'Ctrl+Shift+S', impl:'ai.file.saveAs'},
    {n:{'zh-Hant':'儲存拷貝…', 'zh-Hans':'存储副本…', en:'Save a Copy…'}, id:'file.saveCopy', key:'Ctrl+Alt+S', impl:'ai.file.saveCopy'},
    {n:{'zh-Hant':'另存範本…', 'zh-Hans':'存储为模板…', en:'Save as Template…'}, id:'file.saveAsTemplate', impl:'ai.file.saveAsTemplate'},
    {n:{'zh-Hant':'儲存為 PDF…', 'zh-Hans':'存储为 PDF…', en:'Save as PDF…'}, id:'file.export.pdf', impl:'ai.file.export.pdf'},
    {n:{'zh-Hant':'儲存為 Microsoft Office 適用格式…', 'zh-Hans':'存储为 Microsoft Office 所用格式…', en:'Save for Office Documents…'}, id:'document.exportForOffice', impl:'ai.document.exportForOffice'},
    {n:{'zh-Hant':'回復', 'zh-Hans':'恢复', en:'Revert'}, id:'file.revert', key:'F12', impl:'ai.file.revert'},
    {sep:true},
    // 我们的 file.open ＝ 开档案挑选器挑一张图、成为新的像素层（engine.js／ui.js），即 AI 的「置入」
    {n:{'zh-Hant':'置入…', 'zh-Hans':'置入…', en:'Place…'}, id:'file.place', key:'Ctrl+Shift+P', impl:'file.open'},
    {sep:true},
    {n:{'zh-Hant':'轉存', 'zh-Hans':'导出', en:'Export'}, sub:[
      {n:{'zh-Hant':'轉存為螢幕適用…', 'zh-Hans':'导出为多种屏幕所用格式…', en:'Export for Screens…'}, id:'file.exportForScreens', key:'Ctrl+Alt+E', impl:'ai.file.exportForScreens'},
      {n:{'zh-Hant':'轉存為…', 'zh-Hans':'导出为…', en:'Export As…'}, id:'file.exportAs', impl:'ai.file.exportAs'},
      {n:{'zh-Hant':'轉存為 SVG…', 'zh-Hans':'导出为 SVG…', en:'Export As SVG…'}, id:'file.export.svg', impl:'file.exportSVG'},
      {n:{'zh-Hant':'轉存為 PNG…', 'zh-Hans':'导出为 PNG…', en:'Export As PNG…'}, id:'file.export.png', impl:'file.exportPNG'},
      {n:{'zh-Hant':'儲存為網頁用 (舊版)…', 'zh-Hans':'存储为 Web 所用格式（旧版）…', en:'Save for Web (Legacy)…'}, id:'file.saveForWeb', key:'Ctrl+Alt+Shift+S', impl:'ai.file.saveForWeb'},
    ]},
    {n:{'zh-Hant':'轉存選取範圍…', 'zh-Hans':'导出所选项目…', en:'Export Selection…'}, id:'file.exportSelection', impl:'ai.file.exportSelection'},
    {sep:true},
    {n:{'zh-Hant':'封裝…', 'zh-Hans':'打包…', en:'Package…'}, id:'ui.packageDialog', key:'Ctrl+Alt+Shift+P', impl:'ai.ui.packageDialog'},
    {n:{'zh-Hant':'指令碼', 'zh-Hans':'脚本', en:'Scripts'}, sub:[
      // 原码 menus.rs:1499 todos("Other Script…")；这里照 AI：挑脚本档来跑（menus/impl/ai-misc.js）
      {n:{'zh-Hant':'其他指令碼…', 'zh-Hans':'其它脚本…', en:'Other Script…'}, id:'file.scripts.other', key:'Ctrl+F12', get impl(){ return window.CMD && CMD.map['ai.file.scripts.other'] ? 'ai.file.scripts.other' : null; }},
    ]},
    {sep:true},
    {n:{'zh-Hant':'文件設定…', 'zh-Hans':'文档设置…', en:'Document Setup…'}, id:'file.documentSetup', key:'Ctrl+Alt+P', impl:'ai.file.documentSetup'},
    {n:{'zh-Hant':'文件色彩模式', 'zh-Hans':'文档颜色模式', en:'Document Color Mode'}, sub:[
      // 原码两项同为 file.documentColorMode，参数 {mode:"cmyk"|"rgb"}；这里拆成两个 id 免得重复；勾选照 menus.rs:1165 checked()
      {n:{'zh-Hant':'CMYK 色彩', 'zh-Hans':'CMYK 颜色', en:'CMYK Color'}, id:'file.documentColorMode.cmyk', radio:'docColorMode',
       impl:{cmd:'ai.file.documentColorMode', params:{mode:'cmyk'}, checked:() => !!(window.AiFile && AiFile.colorMode() === 'cmyk')}},
      {n:{'zh-Hant':'RGB 色彩', 'zh-Hans':'RGB 颜色', en:'RGB Color'}, id:'file.documentColorMode.rgb', radio:'docColorMode',
       impl:{cmd:'ai.file.documentColorMode', params:{mode:'rgb'}, checked:() => !!(window.AiFile && AiFile.colorMode() === 'rgb')}},
    ]},
    // 菜单开「文件信息」对话框（menus.rs:2295：file.info 不带参数＝开框）；agent 走 ai.file.info 读写
    {n:{'zh-Hant':'檔案資訊…', 'zh-Hans':'文件信息…', en:'File Info…'}, id:'file.info', key:'Ctrl+Alt+Shift+I', impl:{cmd:'ai.file.info', params:{dialog:true}}},
    {sep:true},
    {n:{'zh-Hant':'列印…', 'zh-Hans':'打印…', en:'Print…'}, id:'file.print', key:'Ctrl+P', impl:'ai.file.print'},
  ]
});
/* impl 档由 index.html 统一挂（整合）*/
