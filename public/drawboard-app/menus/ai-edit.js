/* 堤麟画板 · 菜单树 · Illustrator ▸ 编辑（照 vectorcraft menus.rs menu_tree() 抄；三语照 AI 2020 繁／简中介面）
   实作在 menus/impl/ai-edit.js（剪贴簿六种粘贴、查找和替换、拼写、编辑颜色整个子菜单、键盘快捷键、首选项）；共用剪贴簿在 menus/impl/clipboard.js。
   还灰着的：编辑原稿（没有链接的档）、四个预设管理（透明度拼合／打印／PDF／透视网格——那几个子系统画板没有）、颜色设置／指定配置文件（没有色彩管理）。 */
MenuTrees.add('ai', 'edit', {
  n:{'zh-Hant':'編輯', 'zh-Hans':'编辑', en:'Edit'},
  items:[
    {n:{'zh-Hant':'還原', 'zh-Hans':'还原', en:'Undo'}, id:'edit.undo', key:'Ctrl+Z', impl:'edit.undo'},
    {n:{'zh-Hant':'重做', 'zh-Hans':'重做', en:'Redo'}, id:'edit.redo', key:'Ctrl+Shift+Z', impl:'edit.redo'},
    {sep:true},
    {n:{'zh-Hant':'剪下', 'zh-Hans':'剪切', en:'Cut'}, id:'edit.cut', key:'Ctrl+X', impl:'ai.edit.cut'},
    {n:{'zh-Hant':'拷貝', 'zh-Hans':'复制', en:'Copy'}, id:'edit.copy', key:'Ctrl+C', impl:'ai.edit.copy'},
    {n:{'zh-Hant':'貼上', 'zh-Hans':'粘贴', en:'Paste'}, id:'edit.paste', key:'Ctrl+V', impl:'ai.edit.paste'},
    {n:{'zh-Hant':'貼至上層', 'zh-Hans':'贴在前面', en:'Paste in Front'}, id:'edit.pasteInFront', key:'Ctrl+F', impl:'ai.edit.pasteInFront'},
    {n:{'zh-Hant':'貼至下層', 'zh-Hans':'贴在后面', en:'Paste in Back'}, id:'edit.pasteInBack', key:'Ctrl+B', impl:'ai.edit.pasteInBack'},
    {n:{'zh-Hant':'就地貼上', 'zh-Hans':'就地粘贴', en:'Paste in Place'}, id:'edit.pasteInPlace', key:'Ctrl+Shift+V', impl:'ai.edit.pasteInPlace'},
    {n:{'zh-Hant':'在所有工作區域上貼上', 'zh-Hans':'在所有画板上粘贴', en:'Paste on All Artboards'}, id:'edit.pasteOnAllArtboards', key:'Ctrl+Alt+Shift+V', impl:'ai.edit.pasteOnAllArtboards'},
    {n:{'zh-Hant':'貼上但不套用格式', 'zh-Hans':'粘贴时不包含格式', en:'Paste without Formatting'}, id:'edit.pasteWithoutFormatting', key:'Ctrl+Alt+V', impl:'ai.edit.pasteWithoutFormatting'},
    // 原码 edit.clear：直接选到锚点＝删锚点，否则删选中物件（direct.clear 已照做）；ai.edit.clear 再加上删选中的文字物件
    {n:{'zh-Hant':'清除', 'zh-Hans':'清除', en:'Clear'}, id:'edit.clear', key:'Delete', impl:'ai.edit.clear'},
    {sep:true},
    {n:{'zh-Hant':'尋找及取代…', 'zh-Hans':'查找和替换…', en:'Find and Replace…'}, id:'edit.findReplace', impl:'ai.edit.findReplace.dialog'},
    // 原码带 {find:""}：空字串＝用上一次「查找和替换」找的字
    {n:{'zh-Hant':'尋找下一個', 'zh-Hans':'查找下一个', en:'Find Next'}, id:'edit.findNext', impl:{cmd:'ai.edit.findNext', params:{find:''}}},
    {n:{'zh-Hant':'拼字', 'zh-Hans':'拼写', en:'Spelling'}, sub:[
      // 原码三项都没命令 id（todo），自取 id；照 Illustrator 行为做
      {n:{'zh-Hant':'自動拼字檢查', 'zh-Hans':'自动拼写检查', en:'Auto Spell Check'}, id:'edit.spelling.auto', check:true, impl:{cmd:'ai.edit.spelling.auto', checked:() => !!(window.AiEdit && AiEdit.spell && AiEdit.spell.auto)}},
      {n:{'zh-Hant':'拼字檢查…', 'zh-Hans':'拼写检查…', en:'Check Spelling…'}, id:'edit.spelling.check', key:'Ctrl+I', impl:'ai.edit.spelling.check'},
      {n:{'zh-Hant':'編輯自訂字典…', 'zh-Hans':'编辑自定词典…', en:'Edit Custom Dictionary…'}, id:'edit.spelling.editDictionary', impl:'ai.edit.spelling.editDictionary'},
    ]},
    {sep:true},
    {n:{'zh-Hant':'編輯色彩', 'zh-Hans':'编辑颜色', en:'Edit Colors'}, sub:[
      {n:{'zh-Hant':'重新上色圖稿…', 'zh-Hans':'重新着色图稿…', en:'Recolor Artwork…'}, id:'ui.recolorDialog', impl:'ai.ui.recolorDialog'},
      // 原码这四项同为 ui.recolorDialog，参数依次 {colors:1}／{colors:2}／{colors:3}／{library:""}；拆成不同 id 免得重复
      {n:{'zh-Hant':'以預設集重新上色', 'zh-Hans':'使用预设值重新着色', en:'Recolor with Preset'}, sub:[
        {n:{'zh-Hant':'1 色作業…', 'zh-Hans':'1 色作业…', en:'1 Color Job…'}, id:'ui.recolorDialog.color1', impl:{cmd:'ai.ui.recolorDialog', params:{colors:1}}},
        {n:{'zh-Hant':'2 色作業…', 'zh-Hans':'2 色作业…', en:'2 Color Job…'}, id:'ui.recolorDialog.color2', impl:{cmd:'ai.ui.recolorDialog', params:{colors:2}}},
        {n:{'zh-Hant':'3 色作業…', 'zh-Hans':'3 色作业…', en:'3 Color Job…'}, id:'ui.recolorDialog.color3', impl:{cmd:'ai.ui.recolorDialog', params:{colors:3}}},
        {n:{'zh-Hant':'色彩庫…', 'zh-Hans':'颜色库…', en:'Color Library…'}, id:'ui.recolorDialog.library', impl:{cmd:'ai.ui.recolorDialog', params:{library:''}}},
      ]},
      {n:{'zh-Hant':'調整色彩平衡…', 'zh-Hans':'调整色彩平衡…', en:'Adjust Color Balance…'}, id:'ui.colorBalanceDialog', impl:'ai.ui.colorBalanceDialog'},
      {n:{'zh-Hant':'前後混合', 'zh-Hans':'前后混合', en:'Blend Front to Back'}, id:'edit.colors.blendFrontToBack', impl:'ai.edit.colors.blendFrontToBack'},
      {n:{'zh-Hant':'水平混合', 'zh-Hans':'水平混合', en:'Blend Horizontally'}, id:'edit.colors.blendHorizontally', impl:'ai.edit.colors.blendHorizontally'},
      {n:{'zh-Hant':'垂直混合', 'zh-Hans':'垂直混合', en:'Blend Vertically'}, id:'edit.colors.blendVertically', impl:'ai.edit.colors.blendVertically'},
      {n:{'zh-Hant':'轉換為 CMYK', 'zh-Hans':'转换为 CMYK', en:'Convert to CMYK'}, id:'edit.colors.toCMYK', impl:'ai.edit.colors.toCMYK'},
      {n:{'zh-Hant':'轉換為灰階', 'zh-Hans':'转换为灰度', en:'Convert to Grayscale'}, id:'edit.colors.toGrayscale', impl:'ai.edit.colors.toGrayscale'},
      {n:{'zh-Hant':'轉換為 RGB', 'zh-Hans':'转换为 RGB', en:'Convert to RGB'}, id:'edit.colors.toRGB', impl:'ai.edit.colors.toRGB'},
      {n:{'zh-Hant':'反轉色彩', 'zh-Hans':'反相颜色', en:'Invert Colors'}, id:'edit.colors.invert', impl:'ai.edit.colors.invert'},
      {n:{'zh-Hant':'套印黑色…', 'zh-Hans':'叠印黑色…', en:'Overprint Black…'}, id:'edit.colors.overprintBlack', impl:'ai.edit.colors.overprintBlack.dialog'},
      {n:{'zh-Hant':'飽和度…', 'zh-Hans':'调整饱和度…', en:'Saturate…'}, id:'ui.saturateDialog', impl:'ai.ui.saturateDialog'},
    ]},
    // 原码 links.editOriginal＝用系统程式开链接的原档（panels/links.rs open_file）；这里：智能对象＝编辑内容、云盘链接＝开新分页（menus/impl/ai-misc.js）
    {n:{'zh-Hant':'編輯原稿', 'zh-Hans':'编辑原稿', en:'Edit Original'}, id:'links.editOriginal', get impl(){ return window.CMD && CMD.map['ai.links.editOriginal'] ? 'ai.links.editOriginal' : null; }},
    {sep:true},
    // 四个预设管理器（dialogs/flattener_presets.rs、print_presets.rs、pdf_presets.rs、perspective_presets.rs）；做在 menus/impl/ai-misc.js
    {n:{'zh-Hant':'透明度平面化預設集…', 'zh-Hans':'透明度拼合器预设…', en:'Transparency Flattener Presets…'}, id:'ui.flattenerPresetsDialog', get impl(){ return window.CMD && CMD.map['ai.ui.flattenerPresetsDialog'] ? 'ai.ui.flattenerPresetsDialog' : null; }},
    {n:{'zh-Hant':'列印預設集…', 'zh-Hans':'打印预设…', en:'Print Presets…'}, id:'ui.printPresetsDialog', get impl(){ return window.CMD && CMD.map['ai.ui.printPresetsDialog'] ? 'ai.ui.printPresetsDialog' : null; }},
    {n:{'zh-Hant':'Adobe PDF 預設集…', 'zh-Hans':'Adobe PDF 预设…', en:'PDF Presets…'}, id:'ui.pdfPresetsDialog', get impl(){ return window.CMD && CMD.map['ai.ui.pdfPresetsDialog'] ? 'ai.ui.pdfPresetsDialog' : null; }},
    {n:{'zh-Hant':'透視格點預設集…', 'zh-Hans':'透视网格预设…', en:'Perspective Grid Presets…'}, id:'ui.perspectivePresetsDialog', get impl(){ return window.CMD && CMD.map['ai.ui.perspectivePresetsDialog'] ? 'ai.ui.perspectivePresetsDialog' : null; }},
    {sep:true},
    // 原码 colormgmt.rs：设工作空间／给文件挂描述档；这里接 PS 那边的颜色设置与指定配置文件（menus/impl/ai-misc.js）
    {n:{'zh-Hant':'色彩設定…', 'zh-Hans':'颜色设置…', en:'Color Settings…'}, id:'edit.colorSettings', key:'Ctrl+Shift+K', get impl(){ return window.CMD && CMD.map['ai.edit.colorSettings'] ? 'ai.edit.colorSettings' : null; }},
    {n:{'zh-Hant':'指定描述檔…', 'zh-Hans':'指定配置文件…', en:'Assign Profile…'}, id:'edit.assignProfile', get impl(){ return window.CMD && CMD.map['ai.edit.assignProfile'] ? 'ai.edit.assignProfile' : null; }},
    {sep:true},
    {n:{'zh-Hant':'鍵盤快速鍵…', 'zh-Hans':'键盘快捷键…', en:'Keyboard Shortcuts…'}, id:'edit.keyboardShortcuts', impl:'ai.edit.keyboardShortcuts'},
    {n:{'zh-Hant':'偏好設定…', 'zh-Hans':'首选项…', en:'Preferences…'}, id:'edit.preferences', impl:'ai.edit.preferences'},
  ]
});
