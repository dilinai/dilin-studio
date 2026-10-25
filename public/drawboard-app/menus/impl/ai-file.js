/* 堤麟画板 · 顶菜单实作 · Illustrator ▸ 文件（命令名 ai.<原码 id>）
   照 ArtCraft VectorCraft 原码逐段翻译：
     engine/src/cmd/fileio/save.rs 1-591     存储／存储为／存储副本／存储为模板（SaveMode、save_plan 的名字「<名> copy／<名> template」、retargets、
                                              stamp_save_dates）、file.newFromTemplate、file.revert（can_revert：从没存过／存过后没改 ⇒ 不能）
     engine/src/cmd/fileio/mod.rs 86-560     document.export／exportForOffice／exportForScreens 的参数、FORMATS 表（各格式的选项与预设）
     engine/src/cmd/fileio/screens.rs 1-469  ScreenSize（2x／100w／100h／72ppi）、后缀、子资料夹、preset mobile／density、safe_name、zip
     engine/src/cmd/fileio/export.rs 148-200 exportSelection（选取物件裁到外框）、exportForOffice（ppi、透明／白底）
     engine/src/cmd/edit.rs 25, 93-99        file.close；cmd/docmenu.rs 145-163, 439-445 file.closeAll／documentColorMode／file.info
     engine/src/cmd/fileinfo.rs 1-143        文件信息栏位、检查（标题不可空、关键字去重、评分 0–5、版权状态、URL 不可有空白）
     engine/src/cmd/docsetup.rs 1-296        document.setup 栏位、bleed_param、grid_colors、语言连引号
     doc/src/setup.rs 1-256                  DocSetup 预设、GRID_COLOR_PRESETS、LANGUAGES、MAX_BLEED 72
     engine/src/cmd/colormgmt.rs 235-302     convert_mode／set_color_mode（同模式＝不算编辑；颜色经色彩设定转换）
     color/src/cms/generic.rs 1-454          「VectorCraft Generic CMYK (SWOP-like)」参数式印刷模型（正向、LM 反解、GCR/UCR、TAC、色域映射）
     color/src/cms/lab.rs 1-171、cms/mod.rs 133-135, 339-438   Lab／XYZ（D50、Bradford sRGB 矩阵）、预设相对比色＋黑场补偿
     engine/src/cmd/webexport.rs 330-485     存储为 Web 所用格式的设定与预设
     render/src/encode/quantize.rs 1-469     调色盘缩减（中位切割＋k-means、可选择式贴近 Web 色、Web、黑白、灰阶）与仿色（扩散／图案／杂色）
     ui-egui/src/menus.rs 692-1108, 1382-1423 各项的派送（不带参数＝开对话框、带参数＝直接做）与可用条件
     ui-egui/src/io.rs 100-596               web 版存档＝下载、ask_revert、export、run_to_file、export_for_screens（web 多档打成一个 zip）
     ui-egui/src/unsaved.rs 1-93             关闭／全部关闭前问「存储／不存储／取消」
     ui-egui/src/dialogs/{save_options,export_as,png_options,save_pdf,office_export,export_for_screens,save_for_web,
                          package,document_setup,file_info,print,confirm,save_changes}.rs   各对话框的栏位与预设
     pdf/src/presets.rs 1-104                Adobe PDF 预设
   我们这边的对应：
     ■ 一页只有一份文件、一个画板（＝整张画布）：关闭／全部关闭＝问完存不存，换成一份新的空白未命名文件并盖上「没有打开的文档」首页。
     ■ 「路径」＝上次存档的名字＋当时的工程 JSON（存在记忆体）；恢复＝把那份 JSON 载回来。最近打开的文件存在浏览器 IndexedDB。
     ■ 🔴 存档一律透过 CMD.run('file.saveProject'|'file.exportPNG'|'file.exportSVG')（网站版覆写成存进云盘）；
        这几条做不到的新格式（JPEG／WebP／GIF／PNG-8／TIFF／BMP／TGA／PSD／PDF／SVGZ／EPS／DXF／TXT／ZIP）统一走 AiFile.deliver(blob, 档名)
        （预设＝engine.js 的 download()；网站版覆写这一个函式即可）。
     ■ 文件层资料（文件信息、文档设置、颜色模式、导出设定、打印设定）挂在 Doc.aiInfo／aiSetup／aiColorMode／aiExport／aiPrint；
        过渡钩子把前三个接进 History 快照，五个都接进工程档。 */
(function(){
if (window.AiFile && window.AiFile.__loaded) return;

/* ═══════════ 三语字串（繁照 AI 2020 繁中、简照简中） ═══════════ */
const S = (h, s, e) => ({'zh-Hant':h, 'zh-Hans':s, en:e});
const STR = {
  ok:S('確定', '确定', 'OK'), cancel:S('取消', '取消', 'Cancel'), done:S('完成', '完成', 'Done'),
  save:S('儲存', '存储', 'Save'), dontSave:S('不儲存', '不存储', "Don't Save"),
  saveAsT:S('另存新檔', '存储为', 'Save As'), saveCopyT:S('儲存拷貝', '存储副本', 'Save a Copy'), saveTplT:S('另存範本', '存储为模板', 'Save as Template'),
  fileName:S('檔案名稱：', '文件名：', 'File Name:'), format:S('格式：', '格式：', 'Format:'),
  fmtNative:S('堤麟畫板 (*.DLCANVAS)', '堤麟画板 (*.DLCANVAS)', 'Dilin Canvas (*.dlcanvas)'), fmtTpl:S('堤麟畫板範本', '堤麟画板模板', 'Dilin Canvas Template'),
  fmtPdf:S('Adobe PDF (*.PDF)', 'Adobe PDF (*.PDF)', 'Adobe PDF (*.pdf)'), fmtSvg:S('SVG (*.SVG)', 'SVG (*.SVG)', 'SVG (*.svg)'),
  fmtSvgz:S('SVG 壓縮 (*.SVGZ)', 'SVG 压缩 (*.SVGZ)', 'SVG Compressed (*.svgz)'),
  saveChangesQ:S('要儲存對「{name}」所做的變更嗎？', '要存储对“{name}”所做的更改吗？', 'Do you want to save the changes you made to “{name}”?'),
  saveChangesD:S('如果不儲存，您的變更將會遺失。', '如果不存储，您所做的更改将会丢失。', "Your changes will be lost if you don't save them."),
  revertQ:S('要回復到「{name}」的已儲存版本嗎？', '要恢复到“{name}”的存储版本吗？', 'Revert to the saved version of “{name}”?'),
  revertD:S('自上次儲存以來所做的變更將會遺失。', '自上次存储以来所做的更改将会丢失。', 'Changes made since it was last saved will be lost.'),
  untitled:S('未命名', '未标题', 'Untitled'), copySuffix:S(' 拷貝', ' 拷贝', ' copy'), tplSuffix:S(' 範本', ' 模板', ' template'),
  artboard:S('工作區域', '画板', 'Artboard'), asset:S('資產', '资源', 'Asset'),
  noDoc:S('沒有開啟的文件', '没有打开的文档', 'No open documents'), homeNew:S('新增…', '新建…', 'New…'), homeOpen:S('開啟舊檔…', '打开…', 'Open…'),
  homeTpl:S('從範本新增…', '从模板新建…', 'New from Template…'), homeBlank:S('使用空白文件', '使用空白文档', 'Use a Blank Document'),
  noRecent:S('(沒有最近使用的檔案)', '（没有最近打开的文件）', '(No Recent Files)'),
  exportAsT:S('轉存為', '导出为', 'Export As'), useArtboards:S('使用工作區域', '使用画板', 'Use Artboards'), all:S('全部', '全部', 'All'), range:S('範圍：', '范围：', 'Range:'),
  hintPage:S('每個工作區域一頁。', '每个画板一页。', 'One page per artboard.'), hintFile:S('每個工作區域一個檔案：<名稱>-<工作區域>.{ext}', '每个画板一个文件：<名称>-<画板>.{ext}', 'One file per artboard: <name>-<artboard>.{ext}'),
  hintArt:S('可見圖稿的邊界。', '可见图稿的边界。', 'The bounds of the visible art.'), exportBtn:S('轉存…', '导出…', 'Export…'), exportGo:S('轉存', '导出', 'Export'),
  unavail:S('（瀏覽器版未做）', '（浏览器版未做）', '(not in the browser version)'),
  noArt:S('沒有可轉存的內容：文件沒有可見的圖稿（或勾選「使用工作區域」）', '没有可导出的内容：文档没有可见的图稿（或勾选“使用画板”）', 'nothing to export: the document has no visible art (or turn on Use Artboards)'),
  optsT:S('{fmt} 選項', '{fmt} 选项', '{fmt} Options'), resolution:S('解析度：', '分辨率：', 'Resolution:'),
  resScreen:S('螢幕 (72 ppi)', '屏幕 (72 ppi)', 'Screen (72 ppi)'), resMed:S('中 (150 ppi)', '中 (150 ppi)', 'Medium (150 ppi)'), resHigh:S('高 (300 ppi)', '高 (300 ppi)', 'High (300 ppi)'), other:S('其他', '其他', 'Other'),
  bg:S('背景顏色：', '背景色：', 'Background Color:'), bgT:S('透明', '透明', 'Transparent'), bgW:S('白色', '白色', 'White'), bgB:S('黑色', '黑色', 'Black'),
  aa:S('消除鋸齒：', '消除锯齿：', 'Anti-aliasing:'), aaNone:S('無', '无', 'None'), aaArt:S('最佳化線條圖 (超級取樣)', '优化图稿（超像素取样）', 'Art Optimized (Supersampling)'), aaType:S('最佳化文字 (提示)', '优化文字（提示）', 'Type Optimized (Hinted)'),
  interlaced:S('交錯', '交错', 'Interlaced'), size:S('尺寸：', '大小：', 'Size:'), quality:S('品質：', '品质：', 'Quality:'),
  colorModel:S('色彩模式：', '颜色模型：', 'Color Model:'), method:S('方法：', '方法：', 'Method:'), mBaseline:S('基線 (標準)', '基线（标准）', 'Baseline (Standard)'),
  mOptimized:S('基線 (最佳化)', '基线（优化）', 'Baseline Optimized'), mProgressive:S('連續', '连续', 'Progressive'), embedIcc:S('內嵌 ICC 描述檔', '嵌入 ICC 配置文件', 'Embed ICC Profile'),
  reduction:S('減少色彩：', '颜色缩减：', 'Color Reduction:'), colors:S('顏色：', '颜色：', 'Colors:'), dither:S('混色：', '仿色：', 'Dither:'), ditherAmt:S('混色量：', '仿色量：', 'Amount:'),
  transparency:S('透明度', '透明度', 'Transparency'), matte:S('邊緣調合色：', '杂边：', 'Matte:'),
  redPerceptual:S('感應式', '可感知', 'Perceptual'), redSelective:S('選擇式', '可选择', 'Selective'), redAdaptive:S('最適化', '随样性', 'Adaptive'), redWeb:S('網頁', 'Web', 'Web'),
  redBW:S('黑白', '黑白', 'Black & White'), redGray:S('灰階', '灰度', 'Grayscale'),
  dNone:S('無混色', '无仿色', 'No Dither'), dDiff:S('擴散', '扩散', 'Diffusion'), dPat:S('圖樣', '图案', 'Pattern'), dNoise:S('雜色', '杂色', 'Noise'),
  depth:S('色彩深度：', '颜色深度：', 'Depth:'), writeLayers:S('寫入圖層', '写入图层', 'Write Layers'), hiddenLayers:S('包含隱藏圖層', '包含隐藏图层', 'Include Hidden Layers'),
  lossless:S('無失真 (瀏覽器編碼器)', '无损（浏览器编码器）', 'Lossless (browser encoder)'), encoding:S('編碼：', '编码：', 'Encoding:'), lineEnd:S('換行：', '换行：', 'Line Endings:'),
  txtT:S('文字轉存選項', '文本导出选项', 'Text Export Options'),
  savePdfT:S('儲存 Adobe PDF', '存储 Adobe PDF', 'Save Adobe PDF'), pdfPreset:S('Adobe PDF 預設集：', 'Adobe PDF 预设：', 'Adobe PDF Preset:'), standard:S('標準：', '标准：', 'Standard:'),
  compat:S('相容性：', '兼容性：', 'Compatibility:'), general:S('一般', '常规', 'General'), description:S('說明：', '说明：', 'Description:'),
  viewAfter:S('儲存後檢視 PDF', '存储后查看 PDF', 'View PDF after Saving'), compression:S('壓縮', '压缩', 'Compression'), imgRes:S('影像解析度：', '图像分辨率：', 'Image Resolution:'),
  imgComp:S('壓縮：', '压缩：', 'Compression:'), compAuto:S('自動', '自动', 'Automatic'), jpegQ:S('影像品質：', '图像品质：', 'Image Quality:'),
  qMin:S('最低', '最低', 'Minimum'), qLow:S('低', '低', 'Low'), qMed:S('中', '中', 'Medium'), qHigh:S('高', '高', 'High'), qMax:S('最高', '最高', 'Maximum'),
  marks:S('標記和出血', '标记和出血', 'Marks and Bleeds'), useDocBleed:S('使用文件出血設定', '使用文档出血设置', 'Use Document Bleed Settings'), savePdfBtn:S('儲存 PDF', '存储 PDF', 'Save PDF'),
  none:S('無', '无', 'None'), pdfNote:S('瀏覽器版把每個工作區域依影像解析度點陣化成一頁（向量 PDF 未做）。', '浏览器版把每个画板按图像分辨率栅格化成一页（矢量 PDF 未做）。', 'The browser version rasterizes each artboard to a page at the image resolution (vector PDF not done).'),
  officeT:S('儲存為 Microsoft Office 適用格式', '存储为 Microsoft Office 所用格式', 'Save for Office Documents'), transparentBg:S('透明背景', '透明背景', 'Transparent Background'),
  screensT:S('轉存為螢幕適用', '导出为多种屏幕所用格式', 'Export for Screens'), tabArtboards:S('工作區域', '画板', 'Artboards'), tabAssets:S('資產', '资源', 'Assets'),
  select:S('選取：', '选择：', 'Select:'), full:S('完整文件', '整篇文档', 'Full Document'), includeBleed:S('包括出血', '包含出血', 'Include Bleed'),
  subfolders:S('建立子資料夾', '创建子文件夹', 'Create Sub-folders'), prefix:S('前置詞：', '前缀：', 'Prefix:'), formatsH:S('格式', '格式', 'Formats'),
  scale:S('縮放', '缩放', 'Scale'), suffix:S('尾碼', '后缀', 'Suffix'), addScale:S('+ 加入縮放', '+ 添加缩放', '+ Add Scale'), presetL:S('預設集：', '预设：', 'Preset:'),
  pMobile:S('行動裝置 1x/2x/3x', '移动设备 1x/2x/3x', 'Mobile 1x/2x/3x'), pDensity:S('密度 (0.75x–4x)', '密度（0.75x–4x）', 'Density buckets (0.75x–4x)'),
  download:S('下載', '下载', 'Download'), noAssets:S('請勾選要轉存的資產', '请勾选要导出的资源', 'check an asset to export'), addFormat:S('請加入要轉存的格式', '请添加要导出的格式', 'add a format to export'),
  noAssetList:S('沒有資產：先選取物件再用「轉存選取範圍…」', '没有资源：先选取对象再用“导出所选项目…”', 'No assets: select objects, then use Export Selection…'),
  sfwT:S('儲存為網頁用', '存储为 Web 所用格式', 'Save for Web'), vOriginal:S('原稿', '原稿', 'Original'), vOptimized:S('最佳化', '优化', 'Optimized'),
  imgSize:S('影像尺寸', '图像大小', 'Image Size'), width:S('寬：', '宽：', 'W:'), height:S('高：', '高：', 'H:'), percent:S('百分比：', '百分比：', 'Percent:'),
  clipAb:S('剪裁至工作區域', '剪切到画板', 'Clip to Artboard'), secs:S('{n} 秒 @ {k} Kbps', '{n} 秒 @ {k} Kbps', '{n} sec @ {k} Kbps'), progressive:S('連續', '连续', 'Progressive'),
  pkgT:S('封裝', '打包', 'Package'), folderName:S('資料夾名稱：', '文件夹名称：', 'Folder Name:'), options:S('選項', '选项', 'Options'),
  copyLinks:S('拷貝連結', '复制链接', 'Copy Links'), linksFolder:S('收集不同資料夾中的連結', '收集不同文件夹中的链接', 'Collect Links in a Separate Folder'),
  relink:S('將連結檔案重新連結至文件', '将已链接的文件重新链接到文档', 'Relink Linked Files to the Document'), copyFonts:S('拷貝文件中使用的字體', '复制文档中使用的字体', 'Copy Fonts Used in the Document'),
  report:S('建立報告', '创建报告', 'Create Report'), fontNote:S('授權不允許內嵌的字體不會被拷貝；瀏覽器讀不到字體檔，只列在報告裡。', '授权不允许嵌入的字体不会被复制；浏览器读不到字体文件，只列在报告里。', "Fonts whose licence doesn't allow embedding are not copied; the browser can't read font files, so they are listed in the report."),
  saveFirstQ:S('要先儲存文件嗎？', '要先存储文档吗？', 'Save the document first?'), saveFirstD:S('封裝會收集已儲存的文件及其連結檔案和字體。', '打包会收集已存储的文档及其链接文件和字体。', 'Package collects a saved document with its linked files and fonts.'),
  folderSuffix:S(' 資料夾', ' 文件夹', ' Folder'), linksDir:S('Links', 'Links', 'Links'),
  dsT:S('文件設定', '文档设置', 'Document Setup'), tabGeneral:S('一般', '常规', 'General'), tabTransp:S('透明度', '透明度', 'Transparency'), tabType:S('文字', '文字', 'Type'),
  units:S('單位：', '单位：', 'Units:'), bleed:S('出血：', '出血：', 'Bleed:'), top:S('上', '上方', 'Top'), bottom:S('下', '下方', 'Bottom'), left:S('左', '左方', 'Left'), right:S('右', '右方', 'Right'),
  linkBleed:S('連結', '链接', 'Link'), editArtboards:S('編輯工作區域', '编辑画板', 'Edit Artboards'), outlineImages:S('以外框模式顯示影像', '以轮廓模式显示图像', 'Show Images in Outline Mode'),
  hlFonts:S('標示替代字體', '突出显示替代的字体', 'Highlight Substituted Fonts'), hlGlyphs:S('標示替代字符', '突出显示替代的字形', 'Highlight Substituted Glyphs'),
  gridH:S('透明度格點', '透明度网格', 'Transparency Grid'), gridSize:S('格點大小：', '网格大小：', 'Grid Size:'), gsSmall:S('小', '小', 'Small'), gsMedium:S('中', '中', 'Medium'), gsLarge:S('大', '大', 'Large'),
  gridColors:S('格點顏色：', '网格颜色：', 'Grid Colors:'), gcLight:S('亮', '淡色', 'Light'), gcMedium:S('中', '中色', 'Medium'), gcDark:S('暗', '暗色', 'Dark'), gcRed:S('紅色', '红色', 'Red'),
  gcOrange:S('橘色', '橙色', 'Orange'), gcGreen:S('綠色', '绿色', 'Green'), gcBlue:S('藍色', '蓝色', 'Blue'), gcPurple:S('紫色', '紫色', 'Purple'), gcCustom:S('自訂', '自定', 'Custom'),
  simPaper:S('模擬彩色紙張', '模拟彩纸', 'Simulate Colored Paper'), flatH:S('轉存和剪貼簿透明度平面化設定', '导出和剪贴板透明度拼合器设置', 'Export and Clipboard Transparency Flattener Settings'),
  flatPreset:S('預設集：', '预设：', 'Preset:'), flatHigh:S('[高解析度]', '[高分辨率]', '[High Resolution]'), flatMed:S('[中解析度]', '[中分辨率]', '[Medium Resolution]'), flatLow:S('[低解析度]', '[低分辨率]', '[Low Resolution]'),
  discardWhite:S('放棄輸出時的白色疊印', '放弃输出中的白色叠印', 'Discard White Overprint in Output'), language:S('語言：', '语言：', 'Language:'),
  dquotes:S('雙引號：', '双引号：', 'Double Quotes:'), squotes:S('單引號：', '单引号：', 'Single Quotes:'), typoQuotes:S('使用印刷引號', '使用弯引号', "Use Typographer's Quotes"),
  superscript:S('上標字：', '上标字：', 'Superscript:'), subscript:S('下標字：', '下标字：', 'Subscript:'), smallCaps:S('小型大寫字：', '小型大写字母：', 'Small Caps:'),
  sizeCol:S('尺寸', '大小', 'Size'), posCol:S('位置', '位置', 'Position'), exportTextL:S('轉存：', '导出：', 'Export:'),
  etEditable:S('保留文字可編輯性', '保留文本可编辑性', 'Preserve Text Editability'), etAppearance:S('保留文字外觀', '保留文本外观', 'Preserve Text Appearance'),
  bgContents:S('背景內容：', '背景内容：', 'Background Contents:'),
  fiT:S('檔案資訊', '文件信息', 'File Info'), docTitle:S('文件標題：', '文档标题：', 'Document Title:'), author:S('作者：', '作者：', 'Author:'), authorTitle:S('作者職稱：', '作者头衔：', 'Author Title:'),
  descr:S('描述：', '说明：', 'Description:'), rating:S('分級：', '分级：', 'Rating:'), keywords:S('關鍵字：', '关键字：', 'Keywords:'), add:S('加入', '添加', 'Add'),
  kwHint:S('請以逗號分隔多個關鍵字。', '使用逗号分隔多个关键字。', 'Separate several keywords with commas.'), copyright:S('版權', '版权', 'Copyright'),
  crStatus:S('版權狀態：', '版权状态：', 'Copyright Status:'), crUnknown:S('未知', '未知', 'Unknown'), crCopyrighted:S('版權所有', '受版权保护', 'Copyrighted'), crPublic:S('公共網域', '公共域', 'Public Domain'),
  crNotice:S('版權注意事項：', '版权公告：', 'Copyright Notice:'), crUrl:S('版權資訊 URL：', '版权信息 URL：', 'Copyright Info URL:'), dates:S('日期', '日期', 'Dates'),
  created:S('建立日期：', '创建日期：', 'Created:'), modified:S('修改日期：', '修改日期：', 'Modified:'),
  printT:S('列印', '打印', 'Print'), printer:S('印表機：', '打印机：', 'Printer:'), printerBrowser:S('瀏覽器列印對話框', '浏览器打印对话框', 'Browser Print Dialog'),
  copies:S('份數：', '份数：', 'Copies:'), copiesNote:S('（在瀏覽器列印對話框選）', '（在浏览器打印对话框选）', '(choose in the browser print dialog)'),
  media:S('尺寸：', '大小：', 'Size:'), mDriver:S('由驅動程式定義', '由驱动程序定义', 'Defined by Driver'), orientation:S('方向：', '取向：', 'Orientation:'),
  oAuto:S('自動旋轉', '自动旋转', 'Auto-Rotate'), oPortrait:S('縱向', '纵向', 'Portrait'), oLandscape:S('橫向', '横向', 'Landscape'), scaling:S('縮放：', '缩放：', 'Scaling:'),
  sNone:S('不要縮放', '不要缩放', 'Do Not Scale'), sFit:S('符合頁面大小', '调整到页面大小', 'Fit to Page'), sCustom:S('自訂', '自定', 'Custom'),
  printRes:S('點陣化解析度：', '栅格化分辨率：', 'Rasterize Resolution:'), printBtn:S('列印', '打印', 'Print'),
  popupBlocked:S('瀏覽器擋下了新視窗', '浏览器挡下了新窗口', 'the browser blocked the new window'),
  neverSaved:S('文件從未儲存過', '文档从未存储过', 'the document has never been saved'), noChanges:S('自上次儲存後沒有變更', '自上次存储以来没有更改', 'no changes since the last save'),
  badRange:S('範圍只能是 1 或 all（本文件只有一個工作區域）', '范围只能是 1 或 all（本文档只有一个画板）', 'range: this document has one artboard ("1" or "all")'),
  saved:S('已儲存 {name}', '已存储 {name}', 'Saved {name}'), exported:S('已轉存 {name}', '已导出 {name}', 'Exported {name}'), nothingSel:S('沒有選取物件', '没有选中的对象', 'nothing is selected'),
};
(function(){
  const out = {'zh-Hant':{}, 'zh-Hans':{}, en:{}};
  for (const k in STR) for (const l in out) out[l]['aif.' + k] = STR[k][l];
  if (typeof Lang !== 'undefined') Lang.add(out);
})();
const tr = (k, vars) => {
  let s = (typeof Lang !== 'undefined') ? Lang.t('aif.' + k) : (STR[k] ? STR[k].en : k);
  if (vars) for (const v in vars) s = s.split('{' + v + '}').join(vars[v]);
  return s;
};
const lang3 = s => ({'zh-Hant':s, 'zh-Hans':s, en:s});

/* ═══════════ 小工具 ═══════════ */
const err = (cmd, m) => ({ok:false, error:`${cmd}: ${m}`});
const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v)) ? +v : d;
const isPromise = r => !!r && typeof r.then === 'function';
const nowISO = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
const typing = t => !!t && (/input|select|textarea/i.test(t.tagName || '') || t.isContentEditable);
const blendCss = b => (typeof BLEND_CSS !== 'undefined' && BLEND_CSS[b]) || 'source-over';
/* screens.rs:139 safe_name：字母、数字、-_. 留着，其余换 -（只剩点＝null） */
const safeName = s => { const n = String(s || '').trim().replace(/[^\p{L}\p{N}\-_.]/gu, '-'); return n.replace(/\./g, '') ? n : null; };
const stripExt = n => String(n || '').replace(/\.(dlcanvas|dltemplate|json|svgz?|pdf|png|jpe?g|webp|gif|tiff?|bmp|tga|psd|txt|dxf|eps)$/i, '');

/* ═══════════ 文件层资料的预设（setup.rs Default、fileinfo.rs） ═══════════ */
const GRID_PRESETS = [['Light', ['#ffffff', '#cccccc']], ['Medium', ['#b3b3b3', '#8c8c8c']], ['Dark', ['#666666', '#4d4d4d']], ['Red', ['#ffffff', '#ffc7c7']],
  ['Orange', ['#ffffff', '#ffdcb8']], ['Green', ['#ffffff', '#c6efc6']], ['Blue', ['#ffffff', '#c4dcff']], ['Purple', ['#ffffff', '#e2c9ff']]];
const GRID_CELL = {small:4, medium:8, large:16};
const LANGUAGES = [['English: USA', '“”', '‘’'], ['English: UK', '“”', '‘’'], ['German', '„“', '‚‘'], ['German: Swiss', '«»', '‹›'], ['French', '«»', '‹›'],
  ['Italian', '«»', '‘’'], ['Spanish', '«»', '‘’'], ['Portuguese', '«»', '‘’'], ['Dutch', '“”', '‘’'], ['Danish', '»«', '›‹'], ['Swedish', '””', '’’'],
  ['Finnish', '””', '’’'], ['Norwegian', '«»', '‘’'], ['Polish', '„”', '‚’'], ['Czech', '„“', '‚‘'], ['Russian', '«»', '„“'], ['Japanese', '「」', '『』'], ['Chinese', '“”', '‘’']];
const DQ = ['“”', '„“', '„”', '””', '«»', '»«', '「」', '""'], SQ = ['‘’', '‚‘', '‚’', '’’', '‹›', '›‹', '『』', "''"];
const UNITS = ['Points', 'Picas', 'Inches', 'Millimeters', 'Centimeters', 'Pixels', 'Feet & Inches', 'Meters', 'Yards', 'Feet'];
const UNIT_ZH = {Points:S('點', '点', 'Points'), Picas:S('派卡', '派卡', 'Picas'), Inches:S('英寸', '英寸', 'Inches'), Millimeters:S('公釐', '毫米', 'Millimeters'),
  Centimeters:S('公分', '厘米', 'Centimeters'), Pixels:S('像素', '像素', 'Pixels'), 'Feet & Inches':S('呎和吋', '英尺和英寸', 'Feet & Inches'), Meters:S('公尺', '米', 'Meters'), Yards:S('碼', '码', 'Yards'), Feet:S('呎', '英尺', 'Feet')};
const FLATTENERS = ['High Resolution', 'Medium Resolution', 'Low Resolution'];
const SETUP0 = () => ({units:'Pixels', bleed:[0, 0, 0, 0], outlineImages:false, highlightSubstitutedFonts:true, highlightSubstitutedGlyphs:false,
  gridSize:'medium', gridColors:['#ffffff', '#cccccc'], simulatePaper:false, flattenerPreset:'Medium Resolution', discardWhiteOverprint:true,
  language:'English: USA', quotes:{double:'“”', single:'‘’'}, typographersQuotes:true, superscript:{size:58.3, position:33.3}, subscript:{size:58.3, position:33.3},
  smallCapsSize:70, exportText:'editable', backgroundContents:'transparent'});
const INFO0 = () => ({title:'', author:'', authorTitle:'', description:'', keywords:[], rating:0, copyrightStatus:'unknown', copyrightNotice:'', copyrightUrl:'', created:null, modified:null});
const setup = () => Object.assign(SETUP0(), Doc.aiSetup || {});
const info = () => Object.assign(INFO0(), Doc.aiInfo || {});

/* ═══════════ 状态 ═══════════ */
const AiFile = window.AiFile = {
  __loaded: true,
  untitledN: 0,          // 未标题-N 的 N
  title: null,           // 这份文件没存过时的名字（未标题-N）
  saved: null,           // 「路径」：{name: 存档名（含副档名）, json: 存档当下的工程 JSON 字串}；null＝从没存过
  format: 'dlcanvas',    // 存储写的格式（save.rs：存为 SVG／PDF 之后再存储还是写那个格式）
  cleanTop: undefined,   // 存档那一刻 History.past 的最上一笔（「没改过」＝现在最上一笔还是它）
  recent: [],            // 最近打开的文件 [{name, time}]（新到旧；资料在 IndexedDB）
  assets: [],            // 资源（导出所选项目收的）：[{id, name, items:[{layerId, shapeId?}]}]
  web: null,             // 存储为 Web 所用格式上次的设定（session，同原码 last_web_settings）
  homeShown: false,
  _assetN: 0, _pendingName: null, _tpl: false, _cap: null, _capOn: false, _reverting: false,
  colorMode(){ return Doc.aiColorMode === 'cmyk' ? 'cmyk' : 'rgb'; },
  /* 文件名：存过＝存档名去副档名；没存过＝文件信息的标题或未标题-N */
  name(){ return this.saved ? stripExt(this.saved.name) : (info().title || this.title || tr('untitled') + '-1'); },
  isDirty(){ return History.past[History.past.length - 1] !== this.cleanTop; },
  markClean(top){ this.cleanTop = arguments.length ? top : History.past[History.past.length - 1]; },
  /* 网站版覆写这一支：所有新格式出档都经过它（预设＝engine.js 的 download()） */
  deliver(data, name, mime){
    const blob = data instanceof Blob ? data : new Blob([data], {type:mime || 'application/octet-stream'});
    download(blob, name);
    return {name, bytes:blob.size};
  },
  status(){
    return {name:this.name(), untitled:!this.saved, savedName:this.saved ? this.saved.name : null, format:this.format, dirty:this.isDirty(),
      colorMode:this.colorMode(), info:info(), setup:setup(), recent:this.recent.map(r => r.name), home:this.homeShown, assets:this.assets.map(a => ({id:a.id, name:a.name}))};
  }
};
async function deliver(data, name, mime){ let r = AiFile.deliver(data, name, mime); if (isPromise(r)) r = await r; return r || {name}; }
function setTitle(){ try { document.title = AiFile.name() + ' — ' + Lang.t('ui.brand'); } catch (_){} }
function newUntitled(){
  AiFile.untitledN++;
  AiFile.title = tr('untitled') + '-' + AiFile.untitledN;
  return AiFile.title;
}
function freshMeta(){
  Doc.aiInfo = Object.assign(INFO0(), {title:AiFile.title, created:nowISO()});
  Doc.aiSetup = null; Doc.aiColorMode = 'rgb'; Doc.aiExport = null; Doc.aiPrint = null;
}

/* ═══════════ 色彩：VectorCraft Generic CMYK（generic.rs 整支照抄；lab.rs 的 Lab／XYZ） ═══════════ */
const CMS = (() => {
  const D50 = [0.96422, 1.0, 0.82521], EPS = 216 / 24389, KAPPA = 24389 / 27;
  const xyz2lab = x => { const f = t => t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116; const fx = f(x[0] / D50[0]), fy = f(x[1] / D50[1]), fz = f(x[2] / D50[2]);
    return {l:116 * fy - 16, a:500 * (fx - fy), b:200 * (fy - fz)}; };
  const lab2xyz = lab => { const fy = (lab.l + 16) / 116, fx = fy + lab.a / 500, fz = fy - lab.b / 200;
    const inv = f => { const f3 = f * f * f; return f3 > EPS ? f3 : (116 * f - 16) / KAPPA; };
    const y = lab.l > KAPPA * EPS ? fy * fy * fy : lab.l / KAPPA; return [inv(fx) * D50[0], y * D50[1], inv(fz) * D50[2]]; };
  const s2l = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const l2s = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
  const M1 = [[0.4360747, 0.3850649, 0.1430804], [0.2225045, 0.7168786, 0.0606169], [0.0139322, 0.0971045, 0.7141733]];
  const M2 = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
  const mul = (m, v) => [0, 1, 2].map(i => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);
  const srgb2xyz = rgb => mul(M1, rgb.map(s2l));
  const xyz2srgb = xyz => mul(M2, xyz).map(v => { const e = l2s(clamp(v, 0, 1)); return e > 0.99999 ? 1 : e < 1e-6 ? 0 : e; });
  const srgb2lab = rgb => xyz2lab(srgb2xyz(rgb)), lab2srgb = l => xyz2srgb(lab2xyz(l));
  const chroma = l => Math.hypot(l.a, l.b), hue = l => ((Math.atan2(l.b, l.a) * 180 / Math.PI) % 360 + 360) % 360;
  const fromLch = (l, c, h) => { const r = h * Math.PI / 180; return {l, a:c * Math.cos(r), b:c * Math.sin(r)}; };
  /* generic.rs:54-72 swop_like() */
  const L = (l, a, b) => ({l, a, b});
  const P = {paper:L(93, -0.5, 2.5), solids:[L(55, -37, -50), L(48, 74, -3), L(24, 22, -46), L(89, -5, 93), L(50, -65, 27), L(47, 68, 48), L(24, 1, 0)],
             black:L(19, 0.5, 0.5), dot:[0.2, 0.2, 0.2, 0.22], tac:3.0, bg:{start:0.1, maxK:0.95, gamma:1.25}};
  const paper = lab2xyz(P.paper), prim = [paper].concat(P.solids.map(lab2xyz)), kx = lab2xyz(P.black);
  const DMAX = 2.0, sat = d => DMAX * (1 - Math.exp(-d / DMAX));
  const primK = prim.map(p => [0, 1, 2].map(ch => {                        // generic.rs:108-116 黑叠在其他墨上：光学密度相加但往最大密度饱和
    const di = -Math.log10(Math.max(p[ch] / paper[ch], 1e-6)), dk = -Math.log10(Math.max(kx[ch] / paper[ch], 1e-6));
    const d = sat(di + dk) * dk / Math.max(sat(dk), 1e-6);
    return paper[ch] * Math.pow(10, -Math.max(d, di));
  }));
  const gain = (a, g) => clamp(clamp(a, 0, 1) + 4 * g * clamp(a, 0, 1) * (1 - clamp(a, 0, 1)), 0, 1);
  function toXYZ(cmyk){                                                    // generic.rs:142-159 Demichel 权重混 8 个原色（有／无 K）
    const dg = P.dot, c = gain(cmyk[0], dg[0]), m = gain(cmyk[1], dg[1]), y = gain(cmyk[2], dg[2]), k = gain(cmyk[3], dg[3]);
    const out = [0, 0, 0];
    for (let i = 0; i < 8; i++){
      const w = (i & 1 ? c : 1 - c) * (i & 2 ? m : 1 - m) * (i & 4 ? y : 1 - y); if (w === 0) continue;
      for (let ch = 0; ch < 3; ch++) out[ch] += w * ((1 - k) * prim[i][ch] + k * primK[i][ch]);
    }
    return out;
  }
  const toXYZrel = cmyk => { const x = toXYZ(cmyk); return [x[0] * D50[0] / paper[0], x[1] * D50[1] / paper[1], x[2] * D50[2] / paper[2]]; };
  const toLabRel = cmyk => xyz2lab(toXYZrel(cmyk));
  let blackRel = [1, 1, 1];                                                // generic.rs:118-128 TAC 内最暗的黑
  for (const k of [0.8, 0.9, 1.0]){ const cmy = Math.min(Math.max(P.tac - k, 0) / 3, 1); const x = toXYZrel([cmy, cmy, cmy, k]); if (x[1] < blackRel[1]) blackRel = x; }
  function solve3(a, b){
    const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const d = det(a); if (Math.abs(d) < 1e-12) return null;
    return [0, 1, 2].map(i => { const m = a.map(r => r.slice()); for (let r = 0; r < 3; r++) m[r][i] = b[r]; return det(m) / d; });
  }
  function solveCmy(target, k, init){                                      // generic.rs:185-247 有界 Levenberg–Marquardt
    let x = init.map(v => clamp(v, 0, 1));
    const f = x => { const l = toLabRel([x[0], x[1], x[2], k]); return [l.l - target.l, l.a - target.a, l.b - target.b]; };
    let r = f(x), e = r.reduce((s, v) => s + v * v, 0), lambda = 1e-3;
    for (let it = 0; it < 40; it++){
      if (e < 1e-4) break;
      const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let col = 0; col < 3; col++){
        const h = x[col] > 0.5 ? -1e-3 : 1e-3, xp = x.slice(); xp[col] += h; const rp = f(xp);
        for (let row = 0; row < 3; row++) J[row][col] = (rp[row] - r[row]) / h;
      }
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0];
      for (let p = 0; p < 3; p++){ for (let q = 0; q < 3; q++) A[p][q] = J[0][p] * J[0][q] + J[1][p] * J[1][q] + J[2][p] * J[2][q]; g[p] = -(J[0][p] * r[0] + J[1][p] * r[1] + J[2][p] * r[2]); }
      let improved = false;
      for (let t = 0; t < 8; t++){
        const Al = A.map((row, p) => row.map((v, q) => p === q ? v + lambda * (A[p][p] + 1e-3) : v));
        const d = solve3(Al, g); if (!d){ lambda *= 10; continue; }
        const xn = [clamp(x[0] + d[0], 0, 1), clamp(x[1] + d[1], 0, 1), clamp(x[2] + d[2], 0, 1)], rn = f(xn), en = rn.reduce((s, v) => s + v * v, 0);
        if (en < e){
          const step = Math.max(Math.abs(xn[0] - x[0]), Math.abs(xn[1] - x[1]), Math.abs(xn[2] - x[2]));
          x = xn; r = rn; e = en; lambda = Math.max(lambda * 0.3, 1e-7); improved = step > 1e-6; break;
        }
        lambda *= 10;
      }
      if (!improved) break;
    }
    return x;
  }
  const initialCmy = (target, k) => { const rgb = lab2srgb(target), d = Math.max(1 - k, 0.05); return rgb.map(v => clamp((1 - v - k) / d, 0, 1)); };
  const blackForGrey = grey => grey <= P.bg.start ? 0 : clamp(Math.pow(clamp((grey - P.bg.start) / (1 - P.bg.start), 0, 1), P.bg.gamma) * P.bg.maxK, 0, 1);
  function separate(target){                                               // generic.rs:264-292 GCR／UCR／TAC
    if (target.l >= 99.99 && Math.abs(target.a) < 0.01 && Math.abs(target.b) < 0.01) return [0, 0, 0, 0];
    const cmy0 = solveCmy(target, 0, initialCmy(target, 0));
    let k = blackForGrey(Math.min(cmy0[0], cmy0[1], cmy0[2]));
    const l0 = toLabRel([cmy0[0], cmy0[1], cmy0[2], 0]).l;
    if (l0 > target.l + 1) k = Math.max(k, clamp((l0 - target.l) / Math.max(l0, 1), 0, 1));
    let cmy = k > 0 ? solveCmy(target, k, initialCmy(target, k)) : cmy0;
    for (let i = 0; i < 6; i++){
      const sum = cmy[0] + cmy[1] + cmy[2] + k;
      if (sum <= P.tac + 1e-3 || k >= 1) break;
      k = Math.min(k + (sum - P.tac) * 0.5, 1); cmy = solveCmy(target, k, cmy);
    }
    const sum = cmy[0] + cmy[1] + cmy[2] + k;
    if (sum > P.tac){ const s = clamp((P.tac - k) / Math.max(cmy[0] + cmy[1] + cmy[2], 1e-6), 0, 1); cmy = cmy.map(v => v * s); }
    return [cmy[0], cmy[1], cmy[2], k].map(v => v < 1e-4 ? 0 : Math.min(v, 1));
  }
  let gbd = null;                                                          // generic.rs:294-346 色域边界（感知／饱和意图才用）
  function getGbd(){
    if (gbd) return gbd;
    const GL = 51, GH = 72, cmax = new Float32Array(GL * GH), cusp = Array.from({length:GH}, () => [0, 50]), n = 16;
    for (let ki = 0; ki <= 5; ki++){ const k = ki / 5;
      for (let ci = 0; ci <= n; ci++) for (let mi = 0; mi <= n; mi++) for (let yi = 0; yi <= n; yi++){
        const c = ci / n, m = mi / n, y = yi / n; if (c + m + y + k > P.tac + 1e-3) continue;
        const lab = toLabRel([c, m, y, k]), li = Math.min(Math.round(lab.l / 2), GL - 1), hi = Math.min(Math.floor(hue(lab) / 5), GH - 1), ch = chroma(lab);
        const at = li * GH + hi; if (ch > cmax[at]) cmax[at] = ch; if (ch > cusp[hi][0]) cusp[hi] = [ch, lab.l];
      } }
    const smooth = Float32Array.from(cmax);
    for (let li = 0; li < GL; li++) for (let hi = 0; hi < GH; hi++){ const g = h => cmax[li * GH + h % GH]; smooth[li * GH + hi] = Math.max(g(hi), g(hi + 1), g(hi + GH - 1)); }
    for (let hi = 0; hi < GH; hi++){
      const col = []; for (let li = 0; li < GL; li++) col.push(smooth[li * GH + hi]);
      const known = col.map((v, i) => v > 0 ? i : -1).filter(i => i >= 0);
      for (let li = 0; li < GL; li++){ if (col[li] > 0) continue;
        const below = known.filter(k => k < li).pop(), above = known.find(k => k > li);
        smooth[li * GH + hi] = (below !== undefined && above !== undefined) ? col[below] + (col[above] - col[below]) * (li - below) / (above - below) : 0; }
    }
    return (gbd = {cmax:smooth, cusp:cusp.map(c => c[1]), GL, GH});
  }
  function maxChroma(l, h){
    const g = getGbd(), lf = Math.min(clamp(l, 0, 100) / 2, g.GL - 1), hf = ((h % 360) + 360) % 360 / 5;
    const l0 = Math.floor(lf), h0 = Math.floor(hf), l1 = Math.min(l0 + 1, g.GL - 1), h1 = (h0 + 1) % g.GH, tl = lf - l0, th = hf - h0;
    const at = (li, hi) => g.cmax[li * g.GH + hi % g.GH];
    return (at(l0, h0) * (1 - th) + at(l0, h1) * th) * (1 - tl) + (at(l1, h0) * (1 - th) + at(l1, h1) * th) * tl;
  }
  const cuspL = h => getGbd().cusp[Math.min(Math.floor(((h % 360) + 360) % 360 / 5), 71)];
  function gamutMap(src, intent, bpc){                                     // generic.rs:367-417
    if (intent === 'absoluteColorimetric'){ const x = lab2xyz(src); return xyz2lab([x[0] * D50[0] / paper[0], x[1] * D50[1] / paper[1], x[2] * D50[2] / paper[2]]); }
    let lab = src;
    if (bpc || intent === 'perceptual' || intent === 'saturation'){
      const x = lab2xyz(lab); lab = xyz2lab([0, 1, 2].map(i => blackRel[i] + x[i] * (1 - blackRel[i] / D50[i])));
    }
    if (intent === 'perceptual'){
      const c = chroma(lab);
      if (c > 1e-3){
        const h = hue(lab), cmax0 = Math.max(maxChroma(lab.l, h), 1);
        if (c > cmax0){ const w = clamp((c - cmax0) / c, 0, 1) * 0.9; lab = {l:lab.l + (cuspL(h) - lab.l) * w, a:lab.a, b:lab.b}; }
        const cmax = Math.max(maxChroma(lab.l, h), 1), r = c / cmax, KNEE = 0.75;
        const r2 = r > KNEE ? KNEE + (1 - KNEE) * (1 - Math.exp(-(r - KNEE) / (1 - KNEE))) : r;
        lab = fromLch(lab.l, r2 * cmax * 0.995, hue(lab));
      }
    } else if (intent === 'saturation'){
      const c = chroma(lab), h = hue(lab);
      if (c > 1e-3){ let l = lab.l; const cm = maxChroma(l, h); if (c > cm) l += (cuspL(h) - l) * clamp((c - cm) / Math.max(c, 1), 0, 1); lab = fromLch(l, Math.min(c * 1.1, maxChroma(l, h) * 0.995), h); }
    }
    return lab;
  }
  const fromSrgb = (rgb, intent, bpc) => separate(gamutMap(srgb2lab(rgb), intent || 'relativeColorimetric', bpc !== false));
  const toSrgb = (cmyk, absolute) => xyz2srgb(absolute ? toXYZ(cmyk) : toXYZrel(cmyk.map(v => clamp(v, 0, 1))));
  return {fromSrgb, toSrgb, srgb2lab, name:'Dilin Generic CMYK (SWOP-like)'};
})();
AiFile.cms = CMS;

/* 颜色字串 ⇄ RGB（认 CSS 颜色；'none' 等认不得的原样回传） */
const _cc = document.createElement('canvas').getContext('2d');
function parseColor(s){
  if (typeof s !== 'string' || !s || s === 'none' || s === 'transparent') return null;
  _cc.fillStyle = '#010203'; _cc.fillStyle = s; const v = _cc.fillStyle;
  if (v === '#010203' && s.toLowerCase().replace(/\s/g, '') !== '#010203') return null;
  if (v[0] === '#') return {rgb:[1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16)), a:1};
  const m = /rgba?\(([^)]+)\)/.exec(v); if (!m) return null;
  const p = m[1].split(',').map(x => parseFloat(x));
  return {rgb:[p[0], p[1], p[2]], a:p.length > 3 ? p[3] : 1};
}
const hex2 = v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
const toCss = (rgb, a) => a >= 1 ? '#' + rgb.map(hex2).join('') : `rgba(${rgb.map(v => Math.round(v)).join(', ')}, ${+a.toFixed(3)})`;
/* colormgmt.rs:264-302 set_color_mode：把图稿每个颜色经色彩设定转到 CMYK（显示仍是 sRGB：存转过去再看回来的颜色） */
function convertColorString(s, mode, intent, memo){
  const c = parseColor(s); if (!c) return s;
  if (mode !== 'cmyk') return s;                                           // 转回 RGB：CMYK 颜色的显示值就是 sRGB，不变
  const key = s + '|' + intent; if (memo.has(key)) return memo.get(key);
  const cmyk = CMS.fromSrgb(c.rgb.map(v => v / 255), intent, true), back = CMS.toSrgb(cmyk, false).map(v => v * 255);
  const out = toCss(back, c.a); memo.set(key, out); return out;
}
function convertDocColors(mode, intent){
  const memo = new Map(); let changed = 0;
  const conv = s => { const n = convertColorString(s, mode, intent, memo); if (n !== s) changed++; return n; };
  const walk = o => {
    if (Array.isArray(o)){ o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)){
      const v = o[k];
      if ((k === 'fill' || k === 'stroke' || k === 'color') && typeof v === 'string') o[k] = conv(v);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  for (const L of Doc.layers){
    if (L.kind === 'vector'){ walk(L.data.shapes); Layer.invalidate(L); }
    else if (L.kind === 'text'){ if (typeof L.data.color === 'string') L.data.color = conv(L.data.color); Layer.invalidate(L); }
  }
  return changed;
}

/* ═══════════ 共用层过渡钩子（之后可正式接进 engine.js；接上了这里就不重复包） ═══════════ */
const has = (f, re) => typeof f === 'function' && re.test(String(f));
const metaSnap = () => ({info:clone(Doc.aiInfo || null), setup:clone(Doc.aiSetup || null), mode:Doc.aiColorMode || 'rgb'});
const metaRestore = m => { if (!m) return; Doc.aiInfo = clone(m.info); Doc.aiSetup = clone(m.setup); Doc.aiColorMode = m.mode || 'rgb'; applyViewBg(); };
if (!History.__aiFileHook && !has(History.snap, /aiFileMeta/)){
  History.__aiFileHook = true;
  const snap = History.snap;
  History.snap = function(){ const s = snap.apply(this, arguments); s.aiFileMeta = metaSnap(); return s; };
  ['restore', 'restoreInPlace'].forEach(k => { const o = History[k]; History[k] = function(s){ const r = o.apply(this, arguments); if (s && s.aiFileMeta) metaRestore(s.aiFileMeta); return r; }; });
  const push = History.push;
  History.push = function(){ if (AiFile.homeShown) hideHome(); return push.apply(this, arguments); };   // 首页盖着时 agent 一画东西就收掉
}
if (!Doc.__aiFileHook && !has(Doc.reset, /aiInfo/)){
  Doc.__aiFileHook = true;
  const reset = Doc.reset;
  Doc.reset = function(){
    const r = reset.apply(this, arguments);
    newUntitled(); freshMeta(); AiFile.saved = null; AiFile.format = 'dlcanvas'; AiFile.markClean(); hideHome(); setTitle(); applyViewBg();
    return r;
  };
}
if (!Project.__aiFileHook && !has(Project.serialize, /aiInfo/)){
  Project.__aiFileHook = true;
  const ser = Project.serialize, load = Project.load;
  Project.serialize = function(){
    const o = ser.apply(this, arguments);
    if (Doc.aiInfo) o.aiInfo = clone(Doc.aiInfo);
    if (Doc.aiSetup) o.aiSetup = clone(Doc.aiSetup);
    if (Doc.aiColorMode === 'cmyk') o.aiColorMode = 'cmyk';
    if (Doc.aiExport) o.aiExport = clone(Doc.aiExport);
    if (Doc.aiPrint) o.aiPrint = clone(Doc.aiPrint);
    if (AiFile._tpl) o.template = true;                                    // 存储为模板：开起来是新的未命名文件
    if (AiFile._capOn) AiFile._cap = JSON.stringify(o);                    // 存档当下的内容（恢复用）
    return o;
  };
  Project.load = async function(json){
    const keep = (AiFile._reverting || !json) ? null : JSON.stringify(json);   // load 会跟 json 共用矢量资料 ⇒ 先拷一份字串
    const r = await load.apply(this, arguments);
    if (json){
      Doc.aiInfo = json.aiInfo ? Object.assign(INFO0(), clone(json.aiInfo)) : Object.assign(INFO0(), {title:''});
      Doc.aiSetup = clone(json.aiSetup || null); Doc.aiColorMode = json.aiColorMode === 'cmyk' ? 'cmyk' : 'rgb';
      Doc.aiExport = clone(json.aiExport || null); Doc.aiPrint = clone(json.aiPrint || null);
    }
    if (AiFile._reverting){ /* 恢复：名字、路径不变 */ }
    else if (json && json.template){                                       // load.rs:281 new_from_template：模板开成新的未命名文件
      newUntitled(); AiFile.saved = null; AiFile.format = 'dlcanvas';
      Doc.aiInfo = Object.assign(info(), {title:AiFile.title, created:nowISO(), modified:null});
    } else {
      const picked = AiFile._pendingName;                                  // 从档案开的才记进最近打开（复制到新视窗之类不算）
      const nm = picked || ((json && json.aiInfo && json.aiInfo.title) ? json.aiInfo.title + '.dlcanvas' : tr('untitled') + '.dlcanvas');
      AiFile._pendingName = null;
      AiFile.saved = {name:nm, json:keep}; AiFile.format = 'dlcanvas';
      if (keep && picked) noteRecent(nm, keep);
    }
    AiFile._pendingName = null;
    AiFile.markClean(); hideHome(); setTitle(); applyViewBg();
    return r;
  };
}
/* 开档挑选器／拖进来的 .dlcanvas：记下档名（ui.js 的 onchange 会清掉 files ⇒ 在捕获阶段先拿） */
document.addEventListener('change', e => {
  const t = e.target; if (!t || t.id !== 'projInput' || !t.files || !t.files[0]) return;
  AiFile._pendingName = t.files[0].name;
}, true);
document.addEventListener('drop', e => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f && /\.dlcanvas$/i.test(f.name)) AiFile._pendingName = f.name;
}, true);

/* ═══════════ 最近打开的文件（io.rs:388-404 note_recent／recent_files；浏览器里存 IndexedDB） ═══════════ */
const MAX_RECENT = 30, SHOW_RECENT = 20;                                   // io.rs:390 MAX_RECENT_FILES、lib.rs:606 recent_files_count
const RecentDB = {
  _p: null,
  db(){
    if (this._p) return this._p;
    this._p = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('no IndexedDB'));
      const r = indexedDB.open('dilin-canvas-recent', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('files')) r.result.createObjectStore('files', {keyPath:'name'}); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this._p;
  },
  async req(mode, fn){
    const db = await this.db();
    return new Promise((res, rej) => { const t = db.transaction('files', mode), st = t.objectStore('files'), q = fn(st); let v;
      if (q) q.onsuccess = () => { v = q.result; }; t.oncomplete = () => res(v); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  },
  put(e){ return this.req('readwrite', st => st.put(e)); },
  get(name){ return this.req('readonly', st => st.get(name)); },
  all(){ return this.req('readonly', st => st.getAll()); },
  del(name){ return this.req('readwrite', st => st.delete(name)); },
  clear(){ return this.req('readwrite', st => st.clear()); }
};
async function refreshRecent(){
  try {
    const all = (await RecentDB.all()) || [];
    all.sort((a, b) => b.time - a.time);
    for (const x of all.slice(MAX_RECENT)) await RecentDB.del(x.name);
    AiFile.recent = all.slice(0, MAX_RECENT).map(x => ({name:x.name, time:x.time}));
  } catch (e){ /* 没有 IndexedDB：只留记忆体里的 */ }
  syncRecentMenu();
}
function noteRecent(name, json){
  AiFile.recent = [{name, time:Date.now()}].concat(AiFile.recent.filter(r => r.name !== name)).slice(0, MAX_RECENT);
  syncRecentMenu();
  AiFile._recentP = RecentDB.put({name, time:Date.now(), json}).then(refreshRecent).catch(() => {});
}
let _recentItem = null, _clearItem = null;
function syncRecentMenu(){
  const T = window.MenuTrees && MenuTrees.ai && MenuTrees.ai.file; if (!T) return;
  if (!_recentItem){
    _recentItem = T.items.find(it => it.sub && it.sub.some(x => x.id === 'file.recent' || x.id === 'file.clearRecent'));
    if (!_recentItem) return;
    _clearItem = _recentItem.sub.find(x => x.id === 'file.clearRecent');
  }
  const list = AiFile.recent.slice(0, SHOW_RECENT);
  const rows = list.length ? list.map((r, i) => ({n:lang3(r.name), id:i ? 'file.openRecent' + (i + 1) : 'file.recent', impl:{cmd:'ai.file.openRecent', params:{index:i + 1}}}))
                           : [{n:STR.noRecent, id:'file.recent', header:true}];
  _recentItem.sub.splice(0, _recentItem.sub.length, ...rows, {sep:true}, _clearItem);
}

/* ═══════════ 外框与区域合成 ═══════════ */
const ARTBOARD = () => ({x:0, y:0, w:Doc.width, h:Doc.height});
const union = (a, b) => !a ? b : !b ? a : {x0:Math.min(a.x0, b.x0), y0:Math.min(a.y0, b.y0), x1:Math.max(a.x1, b.x1), y1:Math.max(a.y1, b.y1)};
const toRect = b => b ? {x:Math.floor(b.x0), y:Math.floor(b.y0), w:Math.max(1, Math.ceil(b.x1) - Math.floor(b.x0)), h:Math.max(1, Math.ceil(b.y1) - Math.floor(b.y0))} : null;
function shapeBox(L, s){                                                   // 含描边的可见外框（visual_bounds），文件坐标
  let b = null;
  try { if (window.AIObj && AIObj.shapeBounds) b = AIObj.shapeBounds(s, p => [p[0] + L.x, p[1] + L.y], true); } catch (_){ b = null; }
  if (!b && window.AiSel && AiSel.shapeBounds){ try { b = AiSel.shapeBounds(L, s); } catch (_){ b = null; } if (b && s.stroke && s.stroke !== 'none' && s.strokeWidth > 0) b = {x0:b.x0 - s.strokeWidth / 2, y0:b.y0 - s.strokeWidth / 2, x1:b.x1 + s.strokeWidth / 2, y1:b.y1 + s.strokeWidth / 2}; }
  if (!b){
    let r = null;
    if ('w' in s && 'x' in s) r = {x0:s.x, y0:s.y, x1:s.x + s.w, y1:s.y + s.h};
    else if ('cx' in s) r = {x0:s.cx - s.r1, y0:s.cy - s.r1, x1:s.cx + s.r1, y1:s.cy + s.r1};
    else if (s.points && s.points.length) s.points.forEach(p => { r = union(r, {x0:p[0], y0:p[1], x1:p[0], y1:p[1]}); });
    else if (s.anchors && s.anchors.length) s.anchors.forEach(a => { r = union(r, {x0:a.x, y0:a.y, x1:a.x, y1:a.y}); });
    else if (s.children) s.children.forEach(k => { const kb = shapeBox({x:0, y:0}, k); if (kb) r = union(r, kb); });
    if (r){ const sw = (s.stroke && s.stroke !== 'none') ? (s.strokeWidth || 0) / 2 : 0; b = {x0:r.x0 + L.x - sw, y0:r.y0 + L.y - sw, x1:r.x1 + L.x + sw, y1:r.y1 + L.y + sw}; }
  }
  return b;
}
function textBox(L){
  if (window.AiSel && AiSel.textBounds){ try { return AiSel.textBounds(L); } catch (_){} }
  const d = L.data, n = String(d.text).split('\n').length;
  return {x0:d.x + L.x, y0:d.y + L.y - d.size, x1:d.x + L.x + d.size * String(d.text).length * 0.6, y1:d.y + L.y + d.size * 1.25 * (n - 1) + d.size * 0.25};
}
function rasterBox(L){                                                     // 像素层：不透明像素的外框
  const cv = L.data.canvas, W = cv.width, H = cv.height; if (!W || !H) return null;
  const d = L.data.ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : {x0:x0 + L.x, y0:y0 + L.y, x1:x1 + 1 + L.x, y1:y1 + 1 + L.y};
}
/* render/encode art_bounds：看得见的图稿外框（参考线不算） */
function artBounds(filter){
  let b = null;
  for (const L of Doc.layers){
    if (!L.visible || (filter && !filter.layer(L))) continue;
    if (L.kind === 'vector') L.data.shapes.forEach(s => { if (s.visible !== false && !s.guide && (!filter || !filter.shapes || filter.shapes(L, s))) b = union(b, shapeBox(L, s)); });
    else if (L.kind === 'text') b = union(b, textBox(L));
    else b = union(b, rasterBox(L));
  }
  return toRect(b);
}
/* 一层渲进区域 R（文件坐标）、倍率 s。矢量／文字层借 engine 的 renderLayer：暂时把文件尺寸换成区域、图层位移减区域原点 */
function layerInRegion(L, R, s, filter){
  const W = Math.max(1, Math.round(R.w * s)), H = Math.max(1, Math.round(R.h * s));
  const c = mk(W, H), x = c.getContext('2d');
  if (L.kind === 'raster'){
    const cv = L.data.canvas; x.imageSmoothingQuality = 'high';
    x.drawImage(cv, (L.x - R.x) * s, (L.y - R.y) * s, cv.width * s, cv.height * s);
  } else {
    const keep = {w:Doc.width, h:Doc.height, x:L.x, y:L.y, c:L._cache, cs:L._cacheScale, shapes:L.kind === 'vector' ? L.data.shapes : null};
    try {
      Doc.width = R.w; Doc.height = R.h; L.x = keep.x - R.x; L.y = keep.y - R.y; L._cache = null; L._cacheScale = 0;
      if (keep.shapes && filter && filter.shapes) L.data.shapes = keep.shapes.filter(sh => filter.shapes(L, sh));
      x.drawImage(renderLayer(L, s), 0, 0);
    } finally {
      Doc.width = keep.w; Doc.height = keep.h; L.x = keep.x; L.y = keep.y; L._cache = keep.c; L._cacheScale = keep.cs;
      if (keep.shapes) L.data.shapes = keep.shapes;
    }
  }
  if (L.mask){                                                             // 遮罩对两种层一视同仁（铁律②）
    const M = L.mask, mc = mk(W, H);
    mc.getContext('2d').drawImage(M.data.canvas, ((M.x || 0) - R.x) * s, ((M.y || 0) - R.y) * s, M.data.canvas.width * s, M.data.canvas.height * s);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(mc, 0, 0); x.globalCompositeOperation = 'source-over';
  }
  return c;
}
function renderRegion(R, s, filter){
  if (!filter && R.x === 0 && R.y === 0 && R.w === Doc.width && R.h === Doc.height) return composite(s);   // 整张画板：用引擎的合成（图层样式也在）
  const out = mk(R.w * s, R.h * s), ctx = out.getContext('2d');
  for (const L of Doc.layers){
    if (!L.visible || L.opacity <= 0 || (filter && !filter.layer(L))) continue;
    const src = layerInRegion(L, R, s, filter);
    ctx.save(); ctx.globalAlpha = L.opacity * (L.fillOpacity === undefined ? 1 : L.fillOpacity); ctx.globalCompositeOperation = blendCss(L.blend);
    ctx.drawImage(src, 0, 0); ctx.restore();
  }
  return out;
}
const cssBg = b => b === 'white' ? '#ffffff' : b === 'black' ? '#000000' : b;
/* 背景色、消除锯齿（none＝硬边：alpha 一刀切在 128） */
function finishCanvas(c, bg, aa){
  if (aa === 'none'){
    const x = c.getContext('2d'), img = x.getImageData(0, 0, c.width, c.height), d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0;
    x.putImageData(img, 0, 0);
  }
  if (bg && bg !== 'transparent'){ const o = mk(c.width, c.height), x = o.getContext('2d'); x.fillStyle = cssBg(bg); x.fillRect(0, 0, o.width, o.height); x.drawImage(c, 0, 0); return o; }
  return c;
}
const rgbaOf = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
const luma = (r, g, b) => Math.round((r * 299 + g * 587 + b * 114 + 500) / 1000);

/* ═══════════ 位元组小工具：CRC32、deflate／gzip、写入器、zip（store） ═══════════ */
const te = new TextEncoder();
function concat(parts){ let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let at = 0; for (const p of parts){ o.set(p, at); at += p.length; } return o; }
class Wr {
  constructor(le){ this.le = !!le; this.parts = []; this.len = 0; }
  raw(b){ this.parts.push(b); this.len += b.length; return this; }
  str(s){ return this.raw(te.encode(s)); }
  latin(s){ return this.raw(Uint8Array.from(s, ch => ch.charCodeAt(0) & 255)); }
  u8(v){ return this.raw(Uint8Array.of(v & 255)); }
  _n(sz, fn, v){ const b = new Uint8Array(sz); new DataView(b.buffer)[fn](0, v, this.le); return this.raw(b); }
  u16(v){ return this._n(2, 'setUint16', v); } i16(v){ return this._n(2, 'setInt16', v); }
  u32(v){ return this._n(4, 'setUint32', v >>> 0); } i32(v){ return this._n(4, 'setInt32', v); }
  bytes(){ return concat(this.parts); }
}
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8){ let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function compress(u8, fmt){
  if (typeof CompressionStream === 'undefined') throw new Error('this browser has no CompressionStream');
  const st = new Blob([u8]).stream().pipeThrough(new CompressionStream(fmt));
  return new Uint8Array(await new Response(st).arrayBuffer());
}
const blobU8 = async b => new Uint8Array(await b.arrayBuffer());
const canvasBlob = (c, type, q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('encode failed: ' + type)), type, q));
/* fileio/zip.rs store：只存不压的 zip（UTF-8 档名） */
function zipStore(files){
  const local = [], central = []; let off = 0;
  const d = new Date(), dt = ((d.getFullYear() - 1980) << 9 | (d.getMonth() + 1) << 5 | d.getDate()) & 0xFFFF, tm = (d.getHours() << 11 | d.getMinutes() << 5 | (d.getSeconds() >> 1)) & 0xFFFF;
  for (const f of files){
    const name = te.encode(f.name), data = f.data, crc = crc32(data);
    const h = new Wr(true).u32(0x04034b50).u16(20).u16(0x0800).u16(0).u16(tm).u16(dt).u32(crc).u32(data.length).u32(data.length).u16(name.length).u16(0).raw(name).bytes();
    local.push(h, data);
    central.push(new Wr(true).u32(0x02014b50).u16(20).u16(20).u16(0x0800).u16(0).u16(tm).u16(dt).u32(crc).u32(data.length).u32(data.length)
      .u16(name.length).u16(0).u16(0).u16(0).u16(0).u32(0).u32(off).raw(name).bytes());
    off += h.length + data.length;
  }
  const cd = concat(central);
  return concat([...local, cd, new Wr(true).u32(0x06054b50).u16(0).u16(0).u16(files.length).u16(files.length).u32(cd.length).u32(off).u16(0).bytes()]);
}

/* ═══════════ 调色盘（quantize.rs 整支照抄） ═══════════ */
const RED_W = r => (r === 'perceptual' || r === 'selective') ? [0.55, 0.77, 0.34] : [1, 1, 1];
const webSafe = c => c.map(v => Math.floor((v + 25) / 51) * 51);
const pdist = (a, b, w) => (w[0] * (a[0] - b[0])) ** 2 + (w[1] * (a[1] - b[1])) ** 2 + (w[2] * (a[2] - b[2])) ** 2;
function nearest(pal, c, w){ let bi = 0, bd = Infinity; for (let i = 0; i < pal.length; i++){ const d = pdist(pal[i], c, w); if (d < bd){ bd = d; bi = i; } } return bi; }
function medianCut(colors, k, red){
  const hist = new Map();
  for (const c of colors){ const key = (c[0] >> 3) << 10 | (c[1] >> 3) << 5 | c[2] >> 3; let h = hist.get(key); if (!h){ h = [0, 0, 0, 0]; hist.set(key, h); } h[0]++; h[1] += c[0]; h[2] += c[1]; h[3] += c[2]; }
  const cells = Array.from(hist.values(), h => ({mean:[h[1] / h[0], h[2] / h[0], h[3] / h[0]], count:h[0]}));
  const w = RED_W(red);
  const score = (a, b) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; let n = 0;
    for (let i = a; i < b; i++){ const m = cells[i].mean; for (let j = 0; j < 3; j++){ lo[j] = Math.min(lo[j], m[j]); hi[j] = Math.max(hi[j], m[j]); } n += cells[i].count; }
    let axis = 0; for (let j = 1; j < 3; j++) if (w[j] * (hi[j] - lo[j]) > w[axis] * (hi[axis] - lo[axis])) axis = j;
    const range = w[axis] * (hi[axis] - lo[axis]), weight = red === 'adaptive' ? n : red === 'perceptual' ? Math.sqrt(n) : Math.sqrt(Math.sqrt(n));
    return [b - a < 2 ? 0 : range * weight, axis];
  };
  const boxes = [[0, cells.length, ...score(0, cells.length)]];
  while (boxes.length < k){
    let at = -1, best = -Infinity; boxes.forEach((bx, i) => { if (bx[2] > best){ best = bx[2]; at = i; } });
    if (at < 0) break;
    const [a, b, s, axis] = boxes[at]; if (s <= 0) break;
    const part = cells.slice(a, b).sort((x, y) => x.mean[axis] - y.mean[axis]); for (let i = 0; i < part.length; i++) cells[a + i] = part[i];
    let total = 0; for (const c of part) total += c.count;
    let acc = 0, mid = 1; for (let i = 0; i < part.length; i++){ acc += part[i].count; if (acc * 2 >= total){ mid = clamp(i + 1, 1, part.length - 1); break; } }
    boxes[at] = [a, a + mid, ...score(a, a + mid)]; boxes.push([a + mid, b, ...score(a + mid, b)]);
  }
  const mean = (a, b) => { let n = 0; const s = [0, 0, 0]; for (let i = a; i < b; i++){ n += cells[i].count; for (let j = 0; j < 3; j++) s[j] += cells[i].mean[j] * cells[i].count; } return s.map(v => v / Math.max(n, 1)); };
  let pal = boxes.map(([a, b]) => mean(a, b));
  for (let it = 0; it < 3; it++){                                         // k-means 三轮
    const sums = pal.map(() => [0, 0, 0, 0]);
    for (const c of cells){ const i = nearest(pal, c.mean, w); for (let j = 0; j < 3; j++) sums[i][j] += c.mean[j] * c.count; sums[i][3] += c.count; }
    pal = pal.map((p, i) => sums[i][3] > 0 ? [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]] : p);
  }
  let out = pal.map(p => p.map(v => clamp(Math.round(v), 0, 255)));
  if (red === 'selective') out = out.map(c => { const s = webSafe(c); return [0, 1, 2].every(i => Math.abs(c[i] - s[i]) <= 6) ? s : c; });
  const seen = new Set(); return out.filter(c => { const k2 = c.join(','); if (seen.has(k2)) return false; seen.add(k2); return true; }).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}
function bayer(x, y){ let v = 0; for (let i = 0; i < 3; i++){ const xb = (x >> i) & 1, yb = (y >> i) & 1; v |= (((xb ^ yb) << 1) | yb) << (2 * (2 - i)); } return (v + 0.5) / 64; }
function noiseT(x, y){ let h = (Math.imul(x, 0x9E3779B1) ^ Math.imul(y, 0x85EBCA77)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D) >>> 0; h ^= h >>> 12; return (h >>> 8) / (1 << 24); }
/* o: {colors, reduction, dither, ditherAmount, transparency, matte:[r,g,b]|null} → {width, height, palette, transparent, indices} */
function quantize(rgba, W, H, o){
  const n = W * H, clear = i => o.transparency && rgba[i * 4 + 3] < 128;
  const gray = o.reduction === 'gray' || o.reduction === 'blackWhite', matte = o.matte || [255, 255, 255], blend = !!o.matte || !o.transparency;
  const colors = new Array(n);
  for (let i = 0; i < n; i++){
    const a = blend ? rgba[i * 4 + 3] : 255;
    let c = [0, 1, 2].map(j => Math.floor((rgba[i * 4 + j] * a + matte[j] * (255 - a) + 127) / 255));
    if (gray){ const g = luma(c[0], c[1], c[2]); c = [g, g, g]; }
    colors[i] = c;
  }
  let hasClear = false; for (let i = 0; i < n; i++) if (clear(i)){ hasClear = true; break; }
  const k = Math.max(clamp(Math.round(num(o.colors, 256)), 2, 256) - (hasClear ? 1 : 0), 1);
  const opaque = () => colors.filter((c, i) => !clear(i));
  let pal, exact = false;
  if (o.reduction === 'blackWhite') pal = [[0, 0, 0], [255, 255, 255]];
  else if (o.reduction === 'gray') pal = Array.from({length:k}, (_, i) => { const v = Math.floor(i * 255 / Math.max(k - 1, 1)); return [v, v, v]; });
  else if (o.reduction === 'web'){ const cnt = new Map(); for (const c of opaque()){ const s = webSafe(c).join(','); cnt.set(s, (cnt.get(s) || 0) + 1); } pal = Array.from(cnt).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, k).map(e => e[0].split(',').map(Number)); }
  else {
    const cnt = new Map(); let over = false;
    for (const c of opaque()){ const s = c.join(','); cnt.set(s, (cnt.get(s) || 0) + 1); if (cnt.size > k){ over = true; break; } }
    if (!over){ exact = true; pal = Array.from(cnt).sort((a, b) => b[1] - a[1]).map(e => e[0].split(',').map(Number)); }
    else pal = medianCut(opaque(), k, o.reduction || 'selective');
  }
  if (!pal.length) pal = [matte.slice()];
  const w = RED_W(o.reduction), dither = exact ? 'none' : (o.dither || 'diffusion'), amount = clamp(num(o.ditherAmount, 100), 0, 100) / 100;
  /* map()：最近色（不仿色＝精确色快取；仿色＝6 位格快取） */
  const idx = new Uint8Array(n), cache = new Map(), step = 255 / Math.max(Math.cbrt(pal.length), 1) * amount;
  const look = v => { const q = v.map(x => clamp(Math.round(x), 0, 255)); const key = dither === 'none' ? (q[0] << 16 | q[1] << 8 | q[2]) : ((q[0] >> 2) << 12 | (q[1] >> 2) << 6 | q[2] >> 2);
    let r = cache.get(key); if (r === undefined){ r = nearest(pal, v, w); cache.set(key, r); } return r; };
  let cur = new Float32Array((W + 2) * 3), next = new Float32Array((W + 2) * 3);
  for (let y = 0; y < H; y++){
    if (dither === 'diffusion') next.fill(0);
    for (let x = 0; x < W; x++){
      const i = y * W + x; if (clear(i)) continue;
      let v = colors[i].slice();
      if (dither === 'diffusion') for (let ch = 0; ch < 3; ch++) v[ch] = clamp(v[ch] + cur[(x + 1) * 3 + ch], 0, 255);
      else if (dither === 'pattern' || dither === 'noise'){ const t = dither === 'pattern' ? bayer(x % 8, y % 8) : noiseT(x, y); v = v.map(ch => clamp(ch + (t - 0.5) * step, 0, 255)); }
      const ix = look(v); idx[i] = ix;
      if (dither === 'diffusion'){
        const p = pal[ix];
        for (let ch = 0; ch < 3; ch++){ const e = (v[ch] - p[ch]) * amount;
          cur[(x + 2) * 3 + ch] += e * 7 / 16; next[x * 3 + ch] += e * 3 / 16; next[(x + 1) * 3 + ch] += e * 5 / 16; next[(x + 2) * 3 + ch] += e / 16; }
      }
    }
    if (dither === 'diffusion'){ const t = cur; cur = next; next = t; }
  }
  const used = new Uint8Array(256); for (let i = 0; i < n; i++) if (!clear(i)) used[idx[i]] = 1;   // 丢掉没用到的色（顺序不变），透明＝第 0 格
  const remap = new Uint8Array(256), kept = hasClear ? [matte.slice()] : [];
  pal.forEach((c, i) => { if (used[i]){ remap[i] = kept.length; kept.push(c); } });
  for (let i = 0; i < n; i++) idx[i] = clear(i) ? 0 : remap[idx[i]];
  if (!kept.length) kept.push(matte.slice());
  return {width:W, height:H, palette:kept, transparent:hasClear ? 0 : null, indices:idx};
}

/* ═══════════ 编码器 ═══════════ */
function pngChunk(type, data){ const td = concat([te.encode(type), data]); return new Wr(false).u32(data.length).raw(td).u32(crc32(td)).bytes(); }
const physData = ppi => { const ppm = Math.round(ppi / 0.0254); return new Wr(false).u32(ppm).u32(ppm).u8(1).bytes(); };
/* PNG：浏览器编码后在 IHDR 后面插 pHYs（ppi 存进档案，原码 PPI 选项「stored in the file」） */
function pngWithPhys(u8, ppi){ return concat([u8.slice(0, 33), pngChunk('pHYs', physData(ppi)), u8.slice(33)]); }
async function encodePng8(ix, ppi){
  const {width:W, height:H} = ix, raw = new Uint8Array((W + 1) * H);
  for (let y = 0; y < H; y++){ raw[y * (W + 1)] = 0; raw.set(ix.indices.subarray(y * W, y * W + W), y * (W + 1) + 1); }
  const plte = new Uint8Array(ix.palette.length * 3); ix.palette.forEach((c, i) => plte.set(c, i * 3));
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), pngChunk('IHDR', new Wr(false).u32(W).u32(H).u8(8).u8(3).u8(0).u8(0).u8(0).bytes()), pngChunk('PLTE', plte)];
  if (ix.transparent !== null) parts.push(pngChunk('tRNS', Uint8Array.of(0)));
  parts.push(pngChunk('pHYs', physData(ppi)), pngChunk('IDAT', await compress(raw, 'deflate')), pngChunk('IEND', new Uint8Array(0)));
  return concat(parts);
}
function lzw(idx, min){                                                    // GIF LZW（变长码、满 4096 发 clear）
  const out = []; let cur = 0, shift = 0;
  const clr = 1 << min, eoi = clr + 1; let size = min + 1, next = eoi + 1, table = new Map();
  const emit = c => { cur |= c << shift; shift += size; while (shift >= 8){ out.push(cur & 255); cur >>>= 8; shift -= 8; } };
  emit(clr);
  if (idx.length){
    let code = idx[0];
    for (let i = 1; i < idx.length; i++){
      const k = idx[i], key = code << 8 | k, v = table.get(key);
      if (v === undefined){
        emit(code);
        if (next === 4096){ emit(clr); next = eoi + 1; size = min + 1; table = new Map(); }
        else { if (next >= (1 << size)) size++; table.set(key, next++); }
        code = k;
      } else code = v;
    }
    emit(code);
  }
  emit(eoi); if (shift > 0) out.push(cur & 255);
  return Uint8Array.from(out);
}
function encodeGif(ix, interlaced){
  const {width:W, height:H} = ix; const pal = ix.palette.slice(); let bits = 1; while ((1 << bits) < pal.length) bits++;
  while (pal.length < (1 << bits)) pal.push([0, 0, 0]);
  const w = new Wr(true).latin('GIF89a').u16(W).u16(H).u8(0x80 | ((bits - 1) << 4) | (bits - 1)).u8(0).u8(0);
  pal.forEach(c => w.u8(c[0]).u8(c[1]).u8(c[2]));
  if (ix.transparent !== null) w.u8(0x21).u8(0xF9).u8(4).u8(1).u16(0).u8(ix.transparent).u8(0);
  w.u8(0x2C).u16(0).u16(0).u16(W).u16(H).u8(interlaced ? 0x40 : 0);
  let px = ix.indices;
  if (interlaced){ const rows = []; for (const [s, st] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = s; y < H; y += st) rows.push(y);
    px = new Uint8Array(W * H); rows.forEach((y, i) => px.set(ix.indices.subarray(y * W, y * W + W), i * W)); }
  const min = Math.max(2, bits), data = lzw(px, min);
  w.u8(min);
  for (let i = 0; i < data.length; i += 255){ const blk = data.subarray(i, i + 255); w.u8(blk.length).raw(blk); }
  return w.u8(0).u8(0x3B).bytes();
}
function encodeBmp(rgba, W, H, depth, ppi){
  const bpp = depth === 32 ? 4 : 3, stride = (W * bpp + 3) & ~3, size = stride * H, off = 54, o = new Uint8Array(off + size), dv = new DataView(o.buffer), ppm = Math.round(ppi / 0.0254);
  o[0] = 66; o[1] = 77; dv.setUint32(2, off + size, true); dv.setUint32(10, off, true); dv.setUint32(14, 40, true); dv.setInt32(18, W, true); dv.setInt32(22, H, true);
  dv.setUint16(26, 1, true); dv.setUint16(28, bpp * 8, true); dv.setUint32(34, size, true); dv.setInt32(38, ppm, true); dv.setInt32(42, ppm, true);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const i = (y * W + x) * 4, p = off + (H - 1 - y) * stride + x * bpp;
    o[p] = rgba[i + 2]; o[p + 1] = rgba[i + 1]; o[p + 2] = rgba[i]; if (bpp === 4) o[p + 3] = rgba[i + 3];
  }
  return o;
}
function encodeTiff(rgba, W, H, mode, ppi){                                // mode: rgba｜rgb｜gray（未压缩、单条带、little-endian）
  const spp = mode === 'rgba' ? 4 : mode === 'rgb' ? 3 : 1, n = W * H, img = new Uint8Array(n * spp);
  for (let i = 0; i < n; i++){
    if (spp === 1) img[i] = luma(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    else for (let j = 0; j < spp; j++) img[i * spp + j] = rgba[i * 4 + j];
  }
  const pad = img.length % 2, bpsOff = 8 + img.length + pad, resOff = bpsOff + spp * 2, ifdOff = resOff + 16;   // IFD 要落在偶数位址
  const tags = [[256, 4, 1, W], [257, 4, 1, H], [258, 3, spp, spp > 2 ? bpsOff : 8], [259, 3, 1, 1], [262, 3, 1, spp === 1 ? 1 : 2], [273, 4, 1, 8],
    [277, 3, 1, spp], [278, 4, 1, H], [279, 4, 1, img.length], [282, 5, 1, resOff], [283, 5, 1, resOff + 8], [284, 3, 1, 1], [296, 3, 1, 2]];
  if (spp === 4) tags.push([338, 3, 1, 2]);
  const w = new Wr(true).latin('II').u16(42).u32(ifdOff).raw(img); if (pad) w.u8(0);
  for (let i = 0; i < spp; i++) w.u16(8);
  const rp = Math.round(ppi * 100); w.u32(rp).u32(100).u32(rp).u32(100);
  w.u16(tags.length); for (const [t, ty, c, v] of tags){ w.u16(t).u16(ty).u32(c); if (ty === 3 && c === 1) w.u16(v).u16(0); else w.u32(v); }
  return w.u32(0).bytes();
}
function encodeTga(rgba, W, H, depth){
  const bpp = depth === 32 ? 4 : 3, w = new Wr(true).u8(0).u8(0).u8(2).u16(0).u16(0).u8(0).u16(0).u16(0).u16(W).u16(H).u8(bpp * 8).u8((bpp === 4 ? 8 : 0) | 0x20);
  const px = new Uint8Array(W * H * bpp);
  for (let i = 0; i < W * H; i++){ px[i * bpp] = rgba[i * 4 + 2]; px[i * bpp + 1] = rgba[i * 4 + 1]; px[i * bpp + 2] = rgba[i * 4]; if (bpp === 4) px[i * bpp + 3] = rgba[i * 4 + 3]; }
  return w.raw(px).u32(0).u32(0).latin('TRUEVISION-XFILE.').u8(0).bytes();
}
const PSD_BLEND = {normal:'norm', multiply:'mul ', screen:'scrn', overlay:'over', darken:'dark', lighten:'lite', difference:'diff', hue:'hue ', saturation:'sat ', color:'colr', luminosity:'lum '};
/* PSD：layers＝[{name, rgba(全幅), opacity, blend, hidden}]（下到上），merged＝合成图 */
function encodePsd(W, H, layers, merged, ppi){
  const w = new Wr(false).latin('8BPS').u16(1).raw(new Uint8Array(6)).u16(4).u32(H).u32(W).u16(8).u16(3).u32(0);
  const res = new Wr(false).latin('8BIM').u16(0x03ED).u16(0).u32(16).u32(Math.round(ppi * 65536)).u16(1).u16(1).u32(Math.round(ppi * 65536)).u16(1).u16(1).bytes();
  w.u32(res.length).raw(res);
  if (!layers || !layers.length) w.u32(0);
  else {
    const li = new Wr(false).i16(-layers.length), chans = [];
    for (const L of layers){
      const d = L.rgba; let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0){ x0 = 0; y0 = 0; x1 = -1; y1 = -1; }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1, planes = [3, 0, 1, 2].map(ch => { const p = new Uint8Array(Math.max(bw * bh, 0)); for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) p[y * bw + x] = d[((y0 + y) * W + x0 + x) * 4 + ch]; return p; });
      li.i32(y0).i32(x0).i32(y1 + 1).i32(x1 + 1).u16(4);
      [-1, 0, 1, 2].forEach((id, k) => li.i16(id).u32(2 + planes[k].length));
      li.latin('8BIM').latin(PSD_BLEND[L.blend] || 'norm').u8(Math.round(clamp(L.opacity, 0, 1) * 255)).u8(0).u8(L.hidden ? 2 : 0).u8(0);
      const ascii = String(L.name || 'Layer').replace(/[^\x20-\x7e]/g, '_').slice(0, 255);
      const pas = new Uint8Array(Math.ceil((ascii.length + 1) / 4) * 4); pas[0] = ascii.length; for (let i = 0; i < ascii.length; i++) pas[i + 1] = ascii.charCodeAt(i);
      const uname = String(L.name || 'Layer'), ub = new Wr(false).u32(uname.length); for (let i = 0; i < uname.length; i++) ub.u16(uname.charCodeAt(i));
      let ud = ub.bytes(); if (ud.length % 4) ud = concat([ud, new Uint8Array(4 - ud.length % 4)]);
      const extra = new Wr(false).u32(0).u32(0).raw(pas).latin('8BIM').latin('luni').u32(ud.length).raw(ud).bytes();
      li.u32(extra.length).raw(extra);
      chans.push(planes);
    }
    for (const planes of chans) for (const p of planes) li.u16(0).raw(p);
    let lib = li.bytes(); if (lib.length % 2) lib = concat([lib, new Uint8Array(1)]);
    const sec = new Wr(false).u32(lib.length).raw(lib).u32(0).bytes();
    w.u32(sec.length).raw(sec);
  }
  w.u16(0);
  for (const ch of [0, 1, 2, 3]){ const p = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) p[i] = merged[i * 4 + ch]; w.raw(p); }
  return w.bytes();
}
/* PDF：每页一张图（Flate 或 JPEG）＋ alpha SMask（1.4 以上）；Info 带文件信息 */
const pdfText = s => '<FEFF' + Array.from(String(s), ch => { let h = ''; for (let i = 0; i < ch.length; i++) h += ch.charCodeAt(i).toString(16).padStart(4, '0'); return h; }).join('').toUpperCase() + '>';
const pdfDate = d => { const p = v => String(v).padStart(2, '0'); return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`; };
async function encodePdf(pages, o){
  const ver = o.version || '1.6', alphaOk = parseFloat(ver) >= 1.4, objs = [];
  const add = parts => { objs.push(parts); return objs.length; };
  const catalog = add(null), pagesObj = add(null), kids = [];
  for (const pg of pages){
    const c = alphaOk ? pg.canvas : finishCanvas(pg.canvas, 'white'), W = c.width, H = c.height, d = rgbaOf(c);
    const rgb = new Uint8Array(W * H * 3), a = new Uint8Array(W * H); let hasA = false;
    for (let i = 0; i < W * H; i++){ rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2]; a[i] = d[i * 4 + 3]; if (a[i] !== 255) hasA = true; }
    let smask = null;
    if (hasA && alphaOk){ const z = await compress(a, 'deflate'); smask = add([te.encode(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${z.length} >>\nstream\n`), z, te.encode('\nendstream')]); }
    let data, filter;
    if (o.jpeg){ data = await blobU8(await canvasBlob(finishCanvas(c, 'white'), 'image/jpeg', o.quality || 0.8)); filter = '/DCTDecode'; }
    else { data = await compress(rgb, 'deflate'); filter = '/FlateDecode'; }
    const im = add([te.encode(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${filter} /Length ${data.length}${smask ? ` /SMask ${smask} 0 R` : ''} >>\nstream\n`), data, te.encode('\nendstream')]);
    const f = v => +v.toFixed(3), wp = f(pg.w), hp = f(pg.h), cs = te.encode(`q ${wp} 0 0 ${hp} 0 0 cm /Im0 Do Q`);
    const content = add([te.encode(`<< /Length ${cs.length} >>\nstream\n`), cs, te.encode('\nendstream')]);
    const b = pg.bleed || [0, 0, 0, 0], trim = (b[0] || b[1] || b[2] || b[3]) ? ` /TrimBox [${f(b[2])} ${f(b[1])} ${f(pg.w - b[3])} ${f(pg.h - b[0])}] /BleedBox [0 0 ${wp} ${hp}]` : '';
    kids.push(add([te.encode(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${wp} ${hp}]${trim} /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${content} 0 R >>`)]));
  }
  objs[catalog - 1] = [te.encode(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`)];
  objs[pagesObj - 1] = [te.encode(`<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`)];
  const I = o.info || {}, kv = [['Title', I.title], ['Author', I.author], ['Subject', I.description], ['Keywords', (I.keywords || []).join(', ')]].filter(x => x[1]);
  const infoObj = add([te.encode(`<< ${kv.map(([k, v]) => `/${k} ${pdfText(v)}`).join(' ')} /Creator ${pdfText('堤麟画板')} /Producer ${pdfText('堤麟画板 · ai-file')} /CreationDate ${pdfDate(new Date())} >>`)]);
  const out = [te.encode(`%PDF-${ver}\n%\xE2\xE3\xCF\xD3\n`)]; let at = out[0].length; const offs = [];
  objs.forEach((parts, i) => { offs.push(at); const head = te.encode(`${i + 1} 0 obj\n`), tail = te.encode('\nendobj\n'); out.push(head, ...parts, tail); at += head.length + tail.length + parts.reduce((s, p) => s + p.length, 0); });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(v => String(v).padStart(10, '0') + ' 00000 n \n').join('');
  out.push(te.encode(xref + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${infoObj} 0 R >>\nstartxref\n${at}\n%%EOF\n`));
  return concat(out);
}
function ascii85(u8){
  let out = '', line = 0;
  const put = s => { out += s; line += s.length; if (line >= 75){ out += '\n'; line = 0; } };
  for (let i = 0; i < u8.length; i += 4){
    const n = Math.min(4, u8.length - i), b = [0, 0, 0, 0]; for (let j = 0; j < n; j++) b[j] = u8[i + j];
    let v = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    if (v === 0 && n === 4){ put('z'); continue; }
    const c = []; for (let j = 4; j >= 0; j--){ c[j] = String.fromCharCode(33 + v % 85); v = Math.floor(v / 85); }
    put(c.join('').slice(0, n + 1));
  }
  return out + '~>';
}
/* EPS：PostScript 3 影像（Flate＋ASCII85，白底）——原码是矢量 EPS，浏览器版先做点阵 */
async function encodeEps(c, wPt, hPt, title){
  const W = c.width, H = c.height, d = rgbaOf(finishCanvas(c, 'white')), rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++){ rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2]; }
  const z = await compress(rgb, 'deflate');
  const head = `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 ${Math.ceil(wPt)} ${Math.ceil(hPt)}\n%%HiResBoundingBox: 0 0 ${wPt.toFixed(3)} ${hPt.toFixed(3)}\n%%Title: (${String(title).replace(/[()\\]/g, '_')})\n%%Creator: Dilin Canvas\n%%LanguageLevel: 3\n%%Pages: 1\n%%EndComments\n%%Page: 1 1\ngsave\n${wPt.toFixed(3)} ${hPt.toFixed(3)} scale\n/DeviceRGB setcolorspace\n<< /ImageType 1 /Width ${W} /Height ${H} /BitsPerComponent 8 /Decode [0 1 0 1 0 1] /ImageMatrix [${W} 0 0 -${H} 0 ${H}] /DataSource currentfile /ASCII85Decode filter /FlateDecode filter >> image\n`;
  return te.encode(head + ascii85(z) + '\ngrestore\nshowpage\n%%Trailer\n%%EOF\n');
}
/* DXF（R12 ASCII）：矢量路径压成 POLYLINE、文字层 TEXT；Y 轴朝上 */
function encodeDxf(R, filter){
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$EXTMIN', '10', '0', '20', '0', '9', '$EXTMAX', '10', String(R.w), '20', String(R.h), '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const warnings = [], X = x => +(x - R.x).toFixed(4), Y = y => +(R.y + R.h - y).toFixed(4);
  const lname = L => (String(L.name || 'Layer').replace(/[<>\/\\":;?*|=,`]/g, '_').slice(0, 31) || 'Layer');
  const poly = (L, pts, closed) => { if (pts.length < 2) return; out.push('0', 'POLYLINE', '8', lname(L), '66', '1', '70', closed ? '1' : '0');
    pts.forEach(p => out.push('0', 'VERTEX', '8', lname(L), '10', String(X(p[0] + L.x)), '20', String(Y(p[1] + L.y)))); out.push('0', 'SEQEND', '8', lname(L)); };
  const flat = s => {
    if (!window.VecSel) return null;
    const g = VecSel.asBezier(s); if (!g || !g.anchors || !g.anchors.length) return null;
    const pts = [[g.anchors[0].x, g.anchors[0].y]];
    for (const c of VecSel.segments(g)){ const straight = (c.c1[0] === c.p0[0] && c.c1[1] === c.p0[1] && c.c2[0] === c.p3[0] && c.c2[1] === c.p3[1]);
      if (straight) pts.push([c.p3[0], c.p3[1]]); else for (let i = 1; i <= 16; i++){ const q = VecSel.evalCubic(c, i / 16); pts.push([q[0], q[1]]); } }
    if (g.closed && pts.length > 1){ const a = pts[0], b = pts[pts.length - 1]; if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) pts.pop(); }
    return {pts, closed:!!g.closed};
  };
  const shape = (L, s) => {
    if (s.visible === false || s.guide) return;
    if (Array.isArray(s.children)){ s.children.forEach(k => { if (!k.clipping) shape(L, k); }); return; }
    if (s.type === 'mesh'){ warnings.push('gradient meshes are left out of DXF'); return; }
    const f = flat(s); if (f) poly(L, f.pts, f.closed);
  };
  for (const L of Doc.layers){
    if (!L.visible || (filter && !filter.layer(L))) continue;
    if (L.kind === 'vector') L.data.shapes.forEach(s => { if (!filter || !filter.shapes || filter.shapes(L, s)) shape(L, s); });
    else if (L.kind === 'text'){ const d = L.data; String(d.text).split('\n').forEach((ln, i) => out.push('0', 'TEXT', '8', lname(L), '10', String(X(d.x + L.x)), '20', String(Y(d.y + L.y + i * d.size * 1.25)), '40', String(d.size), '1', ln)); }
    else warnings.push(`pixel layer “${L.name}” is left out of DXF`);
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return {data:te.encode(out.join('\r\n') + '\r\n'), warnings};
}
/* TXT（fileio/text.rs）：文字层由后到前，一段一个 */
function encodeTxt(o, filter){
  const nl = o.lineEndings === 'crlf' ? '\r\n' : '\n';
  const stories = Doc.layers.filter(L => L.kind === 'text' && (!filter || filter.layer(L)) && (!o.selectionOnly || (window.AiSel && AiSel.text.includes(L.id)))).map(L => String(L.data.text).replace(/\r?\n/g, nl));
  const s = stories.join(nl);
  if (o.encoding === 'utf16'){ const b = new Uint8Array(2 + s.length * 2); b[0] = 0xFF; b[1] = 0xFE; for (let i = 0; i < s.length; i++){ const c = s.charCodeAt(i); b[2 + i * 2] = c & 255; b[3 + i * 2] = c >> 8; } return b; }
  return te.encode(s);
}
/* SVG：引擎的 toSVG，区域不是整张画板就改根节点的 viewBox；有文件信息就带 <title>／<desc>（原码 metadata 选项） */
function svgText(R, filter){
  const hidden = [], kept = [];
  try {
    if (filter) for (const L of Doc.layers){
      if (!filter.layer(L)){ if (L.visible){ hidden.push(L); L.visible = false; } }
      else if (L.kind === 'vector' && filter.shapes){ kept.push([L, L.data.shapes]); L.data.shapes = L.data.shapes.filter(s => filter.shapes(L, s)); }
    }
    let svg = Project.toSVG();
    svg = svg.replace(/<svg\b[^>]*>/, m => m.replace(/\swidth="[^"]*"/, ` width="${R.w}"`).replace(/\sheight="[^"]*"/, ` height="${R.h}"`).replace(/\sviewBox="[^"]*"/, ` viewBox="${R.x} ${R.y} ${R.w} ${R.h}"`));
    const I = info();
    if (I.title || I.description) svg = svg.replace(/(<svg\b[^>]*>)/, `$1\n${I.title ? `<title>${esc(I.title)}</title>` : ''}${I.description ? `<desc>${esc(I.description)}</desc>` : ''}`);
    return svg;
  } finally {
    hidden.forEach(L => { L.visible = true; }); kept.forEach(([L, s]) => { L.data.shapes = s; });
  }
}

/* ═══════════ 格式表（fileio/mod.rs FORMATS；我们写得出来的） ═══════════ */
const FORMATS = {
  svg:{label:'SVG', ext:'svg', mime:'image/svg+xml'}, svgz:{label:'SVG Compressed', ext:'svgz', mime:'image/svg+xml'}, pdf:{label:'PDF', ext:'pdf', mime:'application/pdf'},
  png:{label:'PNG', ext:'png', mime:'image/png', raster:true}, jpg:{label:'JPEG', ext:'jpg', mime:'image/jpeg', raster:true}, gif:{label:'GIF', ext:'gif', mime:'image/gif', raster:true},
  webp:{label:'WebP', ext:'webp', mime:'image/webp', raster:true}, tiff:{label:'TIFF', ext:'tif', mime:'image/tiff', raster:true}, bmp:{label:'BMP', ext:'bmp', mime:'image/bmp', raster:true},
  png8:{label:'PNG-8', ext:'png', mime:'image/png', raster:true}, txt:{label:'Text', ext:'txt', mime:'text/plain'}, dxf:{label:'DXF', ext:'dxf', mime:'image/vnd.dxf'},
  eps:{label:'EPS', ext:'eps', mime:'application/postscript'}, tga:{label:'Targa', ext:'tga', mime:'image/x-tga', raster:true}, psd:{label:'PSD', ext:'psd', mime:'image/vnd.adobe.photoshop', raster:true},
};
const EXPORT_ORDER = ['svg', 'svgz', 'pdf', 'png', 'jpg', 'gif', 'webp', 'tiff', 'bmp', 'png8', 'txt', 'dxf', 'eps', 'emf', 'wmf', 'tga', 'psd', 'dwg'];
/* 写不出来的：照原码 export_as.rs UNAVAILABLE 灰着列出来、附上改用什么 */
const UNAVAIL = {emf:['EMF', 'EMF isn\'t written by the browser version: use SVG or PDF'], wmf:['WMF', 'WMF isn\'t written by the browser version: use SVG or PDF'], dwg:['DWG (use DXF)', 'DWG can\'t be written: use DXF']};
const FORMAT_ALIAS = {jpeg:'jpg', tif:'tiff', 'png-8':'png8', png24:'png', 'png-24':'png', targa:'tga'};
function formatOf(f, name){
  let id = f ? String(f).toLowerCase().replace(/^\./, '') : null;
  if (!id && name){ const m = /\.([a-z0-9]+)$/i.exec(String(name)); if (m) id = m[1].toLowerCase(); }
  if (!id) return null;
  id = FORMAT_ALIAS[id] || id;
  return (FORMATS[id] || UNAVAIL[id]) ? id : null;
}
const docStem = () => AiFile.name();
const baseOf = p => { const n = (p && (p.name || p.path)) ? String(p.name || p.path).split(/[\\/]/).pop() : ''; return stripExt(n).trim(); };
/* ArtboardPick：我们只有一个画板 ⇒ range 只认 "all"／"1"（"1-1"、"1, 1"） */
function rangeOk(r){
  if (r == null || r === '') return true;
  const s = String(r).trim().toLowerCase(); if (s === 'all') return true;
  return s.split(/[,;]/).every(part => { const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part); return m && +m[1] === 1 && (!m[2] || +m[2] === 1); });
}
/* 选取：VecSel 那一层选中的形状＋AiSel 的文字物件 */
function selectionItems(){
  const out = [];
  if (window.VecSel){ try { VecSel.prune && VecSel.prune(); } catch (_){}
    const L = VecSel.layer(); if (L && L.kind === 'vector') VecSel.shapes.forEach(id => { if (L.data.shapes.some(s => s.id === id)) out.push({layerId:L.id, shapeId:id}); }); }
  if (window.AiSel && Array.isArray(AiSel.text)) AiSel.text.forEach(id => { const L = Doc.byId(id); if (L && L.kind === 'text') out.push({layerId:id}); });
  return out;
}
const itemsFilter = items => ({layer:L => items.some(i => i.layerId === L.id), shapes:(L, s) => items.some(i => i.layerId === L.id && (!i.shapeId || i.shapeId === s.id))});
function regionFor(p, C){
  if (p.selectedOnly){
    const items = selectionItems(); if (!items.length) return {error:err(C, tr('nothingSel'))};
    const f = itemsFilter(items), R = artBounds(f); if (!R) return {error:err(C, tr('noArt'))};
    return {R, filter:f};
  }
  if (p.useArtboards === false){ const R = artBounds(); return R ? {R} : {error:err(C, tr('noArt'))}; }
  if (!rangeOk(p.range) || (p.artboard != null && +p.artboard !== 0) || (Array.isArray(p.artboards) && p.artboards.some(i => +i !== 0))) return {error:err(C, tr('badRange'))};
  return {R:ARTBOARD(), full:true};
}
const scaleOf = p => p.ppi != null ? clamp(num(p.ppi, 72), 1, 4608) / 72 : clamp(num(p.scale, 1), 0.01, 64);
const defaultBg = fmt => fmt === 'jpg' ? 'white' : (setup().backgroundContents === 'white' ? 'white' : 'transparent');

/* 一个区域编码成某格式 → {data, ext, mime, width, height, warnings} */
async function encodeRegion(fmt, R, o, filter){
  const F = FORMATS[fmt], warnings = [], scale = scaleOf(o), ppi = scale * 72;
  if (F.raster){
    const depth = num(o.depth, fmt === 'tga' || fmt === 'bmp' ? 24 : 0), cm = o.colorModel || (Doc.aiColorMode === 'cmyk' && /^(jpg|tiff|psd)$/.test(fmt) ? 'cmyk' : 'rgb');
    const keepsAlpha = fmt === 'png' || fmt === 'webp' || fmt === 'gif' || fmt === 'png8' || fmt === 'psd' || (fmt === 'tiff' && cm === 'rgb') || ((fmt === 'bmp' || fmt === 'tga') && depth === 32);
    let bg = o.background || defaultBg(fmt); if (!keepsAlpha && bg === 'transparent') bg = 'white';
    if (o.antiAlias === 'type') warnings.push('type hinting isn\'t available in the browser: text is anti-aliased like art');
    if (cm === 'cmyk' && /^(jpg|tiff|psd)$/.test(fmt)) warnings.push(`${F.label}: CMYK files aren't written by the browser version: written as RGB`);
    const base = renderRegion(R, scale, filter);
    const c = finishCanvas(fmt === 'gif' || fmt === 'png8' ? base : base, (fmt === 'gif' || fmt === 'png8') ? 'transparent' : bg, o.antiAlias);
    const W = c.width, H = c.height;
    let data;
    if (fmt === 'png'){ data = pngWithPhys(await blobU8(await canvasBlob(c, 'image/png')), ppi); if (o.interlaced) warnings.push('interlaced PNG isn\'t available in the browser: written non-interlaced'); }
    else if (fmt === 'jpg'){
      let src = c;
      if (cm === 'gray'){ src = mk(W, H); const x = src.getContext('2d'), img = c.getContext('2d').getImageData(0, 0, W, H), d = img.data; for (let i = 0; i < d.length; i += 4){ const g = luma(d[i], d[i + 1], d[i + 2]); d[i] = d[i + 1] = d[i + 2] = g; } x.putImageData(img, 0, 0); }
      data = await blobU8(await canvasBlob(src, 'image/jpeg', clamp(num(o.quality, 90), 0, 100) / 100));
      if (o.method === 'progressive') warnings.push('progressive JPEG isn\'t available in the browser: written baseline');
      if (o.imageMap && o.imageMap !== 'none') warnings.push('image maps aren\'t written by the browser version');
    }
    else if (fmt === 'webp'){ data = await blobU8(await canvasBlob(c, 'image/webp', o.lossless === false ? clamp(num(o.quality, 90), 0, 100) / 100 : 1)); }
    else if (fmt === 'gif' || fmt === 'png8'){
      const matte = o.matte === 'none' ? null : (parseColor(cssBg(o.matte || (bg !== 'transparent' ? bg : 'white'))) || {rgb:[255, 255, 255]}).rgb;
      const ix = quantize(rgbaOf(c), W, H, {colors:num(o.colors, 256), reduction:o.reduction || 'selective', dither:o.dither || 'diffusion', ditherAmount:num(o.ditherAmount, 100),
        transparency:bg === 'transparent' ? o.transparency !== false : false, matte});
      data = fmt === 'gif' ? encodeGif(ix, !!o.interlaced) : await encodePng8(ix, ppi);
      if (fmt === 'png8' && o.interlaced) warnings.push('interlaced PNG-8 isn\'t written by the browser version');
    }
    else if (fmt === 'tiff'){ data = encodeTiff(rgbaOf(c), W, H, cm === 'gray' ? 'gray' : 'rgba', ppi); if (o.lzw !== false) warnings.push('TIFF is written uncompressed by the browser version'); }
    else if (fmt === 'bmp'){ let d = depth; if (![24, 32].includes(d)){ warnings.push(`BMP depth ${d} isn't written by the browser version: written 24-bit`); d = 24; }
      let px = rgbaOf(c); if (o.colorModel === 'gray'){ px = Uint8ClampedArray.from(px); for (let i = 0; i < px.length; i += 4){ const g = luma(px[i], px[i + 1], px[i + 2]); px[i] = px[i + 1] = px[i + 2] = g; } }
      data = encodeBmp(px, W, H, d, ppi); }
    else if (fmt === 'tga'){ let d = depth; if (![24, 32].includes(d)){ warnings.push(`Targa depth ${d} isn't written by the browser version: written 32-bit`); d = 32; } data = encodeTga(rgbaOf(c), W, H, d); }
    else if (fmt === 'psd'){
      const layers = [];
      if (o.layers !== false){
        for (const L of Doc.layers){
          if (filter && !filter.layer(L)) continue;
          if (!L.visible && !o.hiddenLayers) continue;
          layers.push({name:L.name, rgba:rgbaOf(finishCanvas(layerInRegion(L, R, scale, filter), 'transparent', o.antiAlias)), opacity:L.opacity * (L.fillOpacity === undefined ? 1 : L.fillOpacity), blend:L.blend, hidden:!L.visible});
        }
      }
      data = encodePsd(W, H, layers, rgbaOf(o.layers === false ? finishCanvas(c, bg === 'transparent' ? 'white' : bg) : c), ppi);
    }
    return {data, ext:F.ext, mime:F.mime, width:W, height:H, warnings};
  }
  if (fmt === 'svg' || fmt === 'svgz'){
    const t = svgText(R, filter);
    return {data:fmt === 'svgz' ? await compress(te.encode(t), 'gzip') : te.encode(t), ext:F.ext, mime:F.mime, width:R.w, height:R.h, warnings};
  }
  if (fmt === 'pdf'){
    const pr = pdfPresetOf(o.preset), ppiP = clamp(num(o.ppi, pr.ppi), 9, 2400), codec = o.compression || pr.codec;
    const useBleed = o.useDocumentBleed != null ? !!o.useDocumentBleed : pr.bleed;
    const b = useBleed ? setup().bleed : [0, 0, 0, 0], RR = (useBleed && R.x === 0 && R.y === 0 && R.w === Doc.width && R.h === Doc.height && !filter)
      ? {x:-b[2], y:-b[0], w:Doc.width + b[2] + b[3], h:Doc.height + b[0] + b[1]} : R;
    const page = renderRegion(RR, ppiP / 72, filter);
    const q = typeof o.quality === 'number' ? clamp(o.quality, 0, 100) / 100 : ({minimum:0.15, low:0.3, medium:0.5, high:0.75, maximum:0.92})[o.quality || pr.quality] || 0.92;
    const data = await encodePdf([{canvas:page, w:RR.w, h:RR.h, bleed:RR === R ? null : b}], {version:o.compatibility || pr.compat, jpeg:codec === 'jpeg', quality:q, info:info()});
    warnings.push('the browser version writes each artboard as an image at ' + ppiP + ' ppi (vector PDF not done)');
    return {data, ext:'pdf', mime:F.mime, width:RR.w, height:RR.h, warnings};
  }
  if (fmt === 'eps'){
    const s = clamp(num(o.ppi, 300), 9, 1200) / 72, c = renderRegion(R, s, filter);
    warnings.push('the browser version writes EPS as an image (vector EPS not done)');
    return {data:await encodeEps(c, R.w, R.h, docStem()), ext:'eps', mime:F.mime, width:R.w, height:R.h, warnings};
  }
  if (fmt === 'dxf'){ const r = encodeDxf(R, filter); return {data:r.data, ext:'dxf', mime:F.mime, width:R.w, height:R.h, warnings:r.warnings}; }
  if (fmt === 'txt') return {data:encodeTxt(o, filter), ext:'txt', mime:F.mime, width:0, height:0, warnings};
  throw new Error('unknown format ' + fmt);
}
/* document.export：{format, name?, …选项} → 出档 */
async function exportFile(p, C){
  const fmt = formatOf(p.format, p.name || p.path);
  if (!fmt) return err(C, `unknown format \`${p.format || ''}\` (${Object.keys(FORMATS).join(', ')})`);
  if (UNAVAIL[fmt]) return err(C, UNAVAIL[fmt][1]);
  const g = regionFor(p, C); if (g.error) return g.error;
  const base = baseOf(p) || docStem(), scale = scaleOf(p);
  /* 🔴 整张画板的预设 PNG／SVG 走引擎的原生命令（网站版覆写成存进云盘） */
  if (fmt === 'png' && g.full && (p.background || defaultBg('png')) === 'transparent' && (!p.antiAlias || p.antiAlias === 'art') && !p.interlaced){
    let r = CMD.run('file.exportPNG', {scale, name:base}); if (isPromise(r)) r = await r;
    return Object.assign({ok:true, format:'png', name:base + (scale !== 1 ? `@${scale}x` : '') + '.png', via:'file.exportPNG', warnings:[]}, r || {});
  }
  if (fmt === 'svg' && g.full){
    let r = CMD.run('file.exportSVG', {name:base}); if (isPromise(r)) r = await r;
    return Object.assign({ok:true, format:'svg', name:base + '.svg', via:'file.exportSVG', warnings:[]}, r || {});
  }
  const e = await encodeRegion(fmt, g.R, p, g.filter);
  const name = base + '.' + e.ext, d = await deliver(e.data, name, e.mime);
  if (p.viewAfterSaving){ try { AiFile._lastBlobUrl = URL.createObjectURL(new Blob([e.data], {type:e.mime})); } catch (_){} }   // 存储后查看 PDF：开新分页看
  toast(tr('exported', {name}));
  return {ok:true, format:fmt, name, bytes:d.bytes != null ? d.bytes : (e.data.length || e.data.size), width:e.width, height:e.height, warnings:e.warnings};
}

/* ═══════════ 存储（save.rs） ═══════════ */
const SAVE_FORMATS = ['dlcanvas', 'template', 'pdf', 'svg', 'svgz'];
const fidelity = f => (f === 'dlcanvas' || f === 'template') ? null
  : `${FORMATS[f] ? FORMATS[f].label : f} keeps the artwork but not everything a Dilin Canvas document holds: save as .dlcanvas to keep it all editable`;
const top = () => History.past[History.past.length - 1];
/* 透过 file.saveProject 写本家档（网站版＝存进云盘）；顺手拿到写出去的那份 JSON（恢复用） */
async function writeNative(base, tpl){
  AiFile._tpl = !!tpl; AiFile._capOn = true; AiFile._cap = null;
  let r;
  try { r = CMD.run('file.saveProject', {name:base}); if (isPromise(r)) r = await r; }
  finally { AiFile._tpl = false; AiFile._capOn = false; }
  const json = AiFile._cap || JSON.stringify(Project.serialize()); AiFile._cap = null;
  return {json, bytes:r && r.bytes};
}
/* mode：save｜saveAs｜copy｜template；p：{name?, format?, options?} */
async function doSave(mode, p, C){
  p = p || {};
  let fmt = mode === 'template' ? 'template' : String(p.format || (mode === 'save' ? AiFile.format : (formatOf(null, p.name) && SAVE_FORMATS.includes(formatOf(null, p.name)) ? formatOf(null, p.name) : 'dlcanvas'))).toLowerCase();
  if (fmt === 'vectorcraft' || fmt === 'native') fmt = 'dlcanvas';
  if (!SAVE_FORMATS.includes(fmt)) return err(C, `Save writes ${SAVE_FORMATS.join(', ')}, not ${fmt}: use ai.document.export for other formats`);
  const stem = docStem();
  const base = baseOf(p) || (mode === 'copy' ? stem + tr('copySuffix') : mode === 'template' ? stem + tr('tplSuffix') : stem);
  const retargets = (mode === 'save' || mode === 'saveAs') && fmt !== 'template';
  if (retargets){ Doc.aiInfo = Object.assign(info(), {modified:nowISO(), title:base}); if (!Doc.aiInfo.created) Doc.aiInfo.created = Doc.aiInfo.modified; }   // stamp_save_dates；文件改用新名字
  const marker = top();
  let json, r;
  if (fmt === 'dlcanvas' || fmt === 'template'){
    const w = await writeNative(base, fmt === 'template'); json = w.json;
    r = {ok:true, name:base + '.dlcanvas', format:fmt, bytes:w.bytes, warnings:[]};
  } else {
    json = JSON.stringify(Project.serialize());
    const o = Object.assign({}, p.options || {}, {format:fmt, name:base, useArtboards:true});
    ['preset', 'ppi', 'compression', 'quality', 'compatibility', 'useDocumentBleed'].forEach(k => { if (p[k] !== undefined && o[k] === undefined) o[k] = p[k]; });
    r = await exportFile(o, C); if (r.ok === false) return r;
    r.warnings = [fidelity(fmt)].concat(r.warnings || []);
  }
  if (retargets){
    AiFile.saved = {name:r.name, json}; AiFile.format = fmt; AiFile.markClean(marker);
    noteRecent(r.name, json);
  }
  setTitle(); toast(tr('saved', {name:r.name}));
  return r;
}

/* ═══════════ 关闭（unsaved.rs）、首页 ═══════════ */
function closeNow(){
  CMD.run('file.new', {});
  showHome();
  return {ok:true, closed:1};
}
/* 存完再做 then（从没存过＝先开存储为对话框；agent 给了 name 就直接存） */
async function saveThen(p, then, C){
  if (AiFile.saved && !p.name){ const r = await doSave('save', {}, C); if (r.ok === false) return r; return then(); }
  if (p.name){ const r = await doSave('saveAs', {name:p.name, format:p.format}, C); if (r.ok === false) return r; return then(); }
  Dialogs.saveAs('saveAs', {}, then);
  return {pending:'saveAs'};
}
function closeCmd(C, p){
  if (AiFile.isDirty()){
    if (p.save === true) return saveThen(p, closeNow, C);
    if (p.save !== false){ Dialogs.saveChanges(C); return {pending:'saveChanges', name:AiFile.name()}; }
  }
  return closeNow();
}

/* ═══════════ 命令 ═══════════ */
const reg = (id, params, fn, extra) => CMD.reg(id, Object.assign({i18n:'', params}, extra || {}), fn);

reg('ai.file.status', '{} 查询：文件名、是否没存过、存档名、存储格式、有没有改过（dirty）、颜色模式、文件信息、文档设置、最近打开的文件、资源 → {…}', () => AiFile.status());

reg('ai.file.newFromTemplate', '{data?: 工程 JSON（物件或字串）, name?} 从模板新建（save.rs:562）：开一份模板（或任何 .dlcanvas）成为新的未命名文件；不给 data＝开档案挑选器 → {ok, name}', p => {
  const C = 'ai.file.newFromTemplate';
  if (p.data == null){ tplInput().click(); return {ok:true, pending:'picker'}; }
  let json; try { json = typeof p.data === 'string' ? JSON.parse(p.data) : clone(p.data); } catch (e){ return err(C, 'data is not JSON: ' + e.message); }
  if (!json || json.format !== 'dilin-canvas') return err(C, 'not a Dilin Canvas document');
  json.template = true;
  return Project.load(json).then(() => ({ok:true, name:AiFile.name()}));
});
reg('ai.file.openRecent', '{index: 1..20} 打开「最近打开的文件」第 index 个（io.rs open_path；资料在浏览器 IndexedDB）→ {ok, name}', async p => {
  const C = 'ai.file.openRecent', i = Math.round(num(p.index, 1)) - 1, r = AiFile.recent[i];
  if (!r) return err(C, 'no such recent file');
  let e = null; try { e = await RecentDB.get(r.name); } catch (_){}
  if (!e || !e.json) return err(C, 'the recent file is gone from this browser');
  AiFile._pendingName = r.name;
  await Project.load(JSON.parse(e.json));
  return {ok:true, name:r.name};
});
reg('ai.file.recentFiles', '{} 查询：最近打开的文件（新到旧）→ [名字…]', () => AiFile.recent.slice(0, SHOW_RECENT).map(r => r.name));
reg('ai.file.clearRecent', '{} 清除最近打开的文件', async () => { AiFile.recent = []; syncRecentMenu(); try { await RecentDB.clear(); } catch (_){} return {ok:true}; });

reg('ai.file.close', '{save?: true（先存再关；从没存过要给 name）| false（不存直接关）} 关闭（unsaved.rs）：改过又没给 save ⇒ 弹「存储／不存储／取消」→ {pending:"saveChanges"}；关掉后换成新的空白未命名文件、盖上首页 → {ok, closed}', p => closeCmd('ai.file.close', p));
reg('ai.file.closeAll', '{save?, name?} 全部关闭（docmenu.rs close_all）：我们一页一份文件 ⇒ 同「关闭」→ {ok, closed}', p => closeCmd('ai.file.closeAll', p));
reg('ai.file.save', '{name?, format?} 存储（file.save）：写回这份文件自己的格式与名字；从没存过 ⇒ 不给 name 就开「存储为」对话框 → {ok, name, format, bytes, warnings}', p => {
  if (!AiFile.saved && !p.name){ Dialogs.saveAs('saveAs', {}); return {pending:'saveAs'}; }
  return doSave(AiFile.saved && !p.name ? 'save' : 'saveAs', p, 'ai.file.save');
});
reg('ai.file.saveAs', '{name?, format?: dlcanvas|template|pdf|svg|svgz（缺省＝名字的副档名，否则 dlcanvas）, options?: PDF／SVG 选项} 存储为（save.rs SaveAs）：文件改用新名字与格式；不给 name ＝开对话框（web 版：档名＋格式）→ {ok, name, format, bytes, warnings}', p => {
  if (!p.name && !p.path){ Dialogs.saveAs('saveAs', p); return {pending:'saveAs'}; }
  return doSave('saveAs', p, 'ai.file.saveAs');
});
reg('ai.file.saveCopy', '{name?（缺省「<名> 拷贝」）, format?, options?} 存储副本（save.rs Copy）：写一份拷贝，文件的名字、格式、改过与否都不变；不给 name 开对话框 → {ok, name, …}', p => {
  if (!p.name && !p.path){ Dialogs.saveAs('copy', p); return {pending:'saveCopy'}; }
  return doSave('copy', p, 'ai.file.saveCopy');
});
reg('ai.file.saveAsTemplate', '{name?（缺省「<名> 模板」）} 存储为模板（save.rs Template）：写一份带 template 标记的工程档，开起来是新的未命名文件；文件本身不变 → {ok, name}', p => {
  if (!p.name && !p.path){ Dialogs.saveAs('template', p); return {pending:'saveAsTemplate'}; }
  return doSave('template', p, 'ai.file.saveAsTemplate');
});
reg('ai.file.revert', '{confirmed?: true} 恢复（save.rs:489）：丢掉改动、载回上次存档的内容（历史清空）。从没存过／存过后没改 ⇒ 不能；不给 confirmed ⇒ 先问 → {ok, name}', p => {
  const C = 'ai.file.revert';
  if (!AiFile.saved) return err(C, tr('neverSaved'));
  if (!AiFile.isDirty()) return err(C, tr('noChanges'));
  if (p.confirmed !== true){ Dialogs.confirm(tr('revertQ', {name:AiFile.name()}), tr('revertD'), () => CMD.run('ai.file.revert', {confirmed:true})); return {pending:'confirm'}; }
  AiFile._reverting = true;
  return Project.load(JSON.parse(AiFile.saved.json)).then(() => ({ok:true, name:AiFile.saved.name})).finally(() => { AiFile._reverting = false; AiFile.markClean(); setTitle(); });
});

/* 导出 */
const EXPORT_PARAMS = 'format: svg|svgz|pdf|png|jpg|gif|webp|tiff|bmp|png8|txt|dxf|eps|tga|psd（缺省＝name 的副档名）, name?（不含副档名也行）, useArtboards?: true（整个画板）| false（可见图稿的外框）, selectedOnly?, range?: "all"|"1", '
  + 'ppi?: 72 | scale?: 1, background?: transparent|white|black|"#rrggbb", antiAlias?: none|art|type, interlaced?, jpg: quality?: 0–100, colorModel?: rgb|gray, gif/png8: colors?: 2–256, reduction?: perceptual|selective|adaptive|web|blackWhite|gray, '
  + 'dither?: none|diffusion|pattern|noise, ditherAmount?, transparency?, matte?, bmp/tga: depth?: 24|32, tiff: colorModel?: rgb|gray, psd: layers?: true, hiddenLayers?, pdf: preset?, ppi?, compression?: auto|zip|jpeg, quality?, compatibility?: 1.3–1.7, useDocumentBleed?, txt: encoding?: utf8|utf16, lineEndings?: lf|crlf';
reg('ai.document.export', `{${EXPORT_PARAMS}} 导出（document.export）：整张画板的预设 PNG／SVG 走 file.exportPNG／file.exportSVG，其余格式自己编码后 AiFile.deliver → {ok, format, name, bytes, width, height, warnings}`, p => exportFile(p, 'ai.document.export'));
reg('ai.file.exportAs', `{} 开「导出为」对话框（格式、使用画板、范围 → 下一步各格式选项）；带 name 或 format＝直接导出 {${EXPORT_PARAMS}} → {ok, name, …}`, p => {
  if (!p.name && !p.path && !p.format){ Dialogs.exportAs(p); return {pending:'exportAs'}; }
  return exportFile(p, 'ai.file.exportAs');
});
reg('ai.file.export.pdf', '{} 开「存储 Adobe PDF」对话框；带参数＝直接存：{name?, preset?: "VectorCraft Default"|"High Quality Print"|"Press Quality"|"Smallest File Size"|"PDF/X-1a:2001"|"PDF/X-3:2002"|"PDF/X-4:2010", ppi?, compression?: auto|zip|jpeg, quality?: minimum|low|medium|high|maximum|0–100, compatibility?: "1.3"…"1.7", useDocumentBleed?, range?, useArtboards?, viewAfterSaving?} → {ok, name, bytes, warnings}', p => {
  if (!Object.keys(p).length){ Dialogs.savePdf({}); return {pending:'savePdf'}; }
  return exportPdf(p, 'ai.file.export.pdf');
});
async function exportPdf(p, C){
  const r = await exportFile(Object.assign({}, p, {format:'pdf'}), C);
  if (r.ok !== false && p.viewAfterSaving && AiFile._lastBlobUrl) window.open(AiFile._lastBlobUrl, '_blank');
  return r;
}
reg('ai.document.exportForOffice', '{} 开「存储为 Microsoft Office 所用格式」对话框；带参数＝直接存：{ppi?: 150（72／150／300…）, transparent?: false（否则白底）, artboard?: 0, name?} 画板存成 PNG（透明＝走 file.exportPNG）→ {ok, name, bytes, width, height}', async p => {
  const C = 'ai.document.exportForOffice';
  if (!Object.keys(p).length){ Dialogs.office(); return {pending:'saveForOffice'}; }
  const ppi = num(p.ppi, 150); if (!(ppi > 0)) return err(C, 'ppi must be a positive number');
  if (p.artboard != null && +p.artboard !== 0) return err(C, tr('badRange'));
  const r = await exportFile({format:'png', name:p.name, ppi, background:p.transparent ? 'transparent' : 'white', useArtboards:true}, C);
  if (r.ok !== false && r.width == null){ r.width = Math.round(Doc.width * ppi / 72); r.height = Math.round(Doc.height * ppi / 72); }
  return r;
});

/* 导出为多种屏幕所用格式（screens.rs） */
const DENSITY = [['ldpi', 0.75], ['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]];
const r3 = v => Math.round(v * 1000) / 1000;
function sizeOf(row){                                                      // ScreenSize::of_row
  const pos = k => { const v = row[k]; return (v != null && typeof v === 'number' && isFinite(v) && v > 0) ? v : null; };
  if (pos('width')) return {kind:'w', v:row.width}; if (pos('height')) return {kind:'h', v:row.height}; if (pos('ppi')) return {kind:'ppi', v:row.ppi};
  const s = row.scale;
  if (s == null) return {kind:'x', v:1};
  if (typeof s === 'number') return s > 0 ? {kind:'x', v:s} : {kind:'x', v:1};
  const t = String(s).trim().toLowerCase(), n = x => { const v = parseFloat(x); return isFinite(v) && v > 0 && /^\s*[\d.]+\s*$/.test(x) ? v : null; };
  if (t.endsWith('ppi')) { const v = n(t.slice(0, -3)); return v ? {kind:'ppi', v} : null; }
  if (t.endsWith('w')) { const v = n(t.slice(0, -1)); return v ? {kind:'w', v} : null; }
  if (t.endsWith('h')) { const v = n(t.slice(0, -1)); return v ? {kind:'h', v} : null; }
  const v = n(t.endsWith('x') ? t.slice(0, -1) : t); return v ? {kind:'x', v} : null;
}
const factor = sz => sz.kind === 'x' ? sz.v : sz.kind === 'ppi' ? sz.v / 72 : null;
const sizeLabel = sz => sz.kind === 'w' ? `${r3(sz.v)}w` : sz.kind === 'h' ? `${r3(sz.v)}h` : `${r3(factor(sz))}x`;
const sizeSuffix = sz => { const f = factor(sz); return (f !== null && Math.abs(f - 1) < 1e-9) ? '' : '@' + sizeLabel(sz); };
const isSizeSuffix = s => /^@/.test(s) && /[a-z]$/i.test(s) && !!sizeOf({scale:s.slice(1)});
function presetRows(id){
  if (id === 'mobile') return [1, 2, 3].map(s => ({format:'png', scale:`${s}x`, suffix:s === 1 ? '' : `@${s}x`}));
  if (id === 'density') return DENSITY.map(([f, s]) => ({format:'png', scale:`${r3(s)}x`, suffix:'', folder:f}));
  return null;
}
async function exportForScreens(p, C){
  if (p.preset && p.formats) return err(C, 'give formats or a preset, not both');
  let rows = p.preset ? presetRows(p.preset) : Array.isArray(p.formats) ? p.formats : (p.formats == null ? [{}] : null);
  if (!rows) return err(C, p.preset ? `preset \`${p.preset}\`: mobile or density` : 'formats must be an array of rows');
  if (!rows.length) return err(C, tr('addFormat'));
  const parsed = [];
  for (const row of rows){
    if (!row || typeof row !== 'object') return err(C, 'each format is an object {format, scale?, suffix?}');
    const fmt = formatOf(row.format || 'png'); if (!fmt || !['png', 'png8', 'jpg', 'webp', 'gif', 'svg', 'svgz', 'pdf'].includes(fmt)) return err(C, 'Export for Screens writes png, png8, jpg, webp, gif, svg, svgz or pdf');
    const raster = !!FORMATS[fmt].raster, sz = raster ? sizeOf(row) : {kind:'x', v:1};
    if (!sz) return err(C, `scale \`${row.scale}\`: a factor such as 2x, a width (100w), a height (100h) or a resolution (72ppi)`);
    const suffix = row.suffix != null ? ((!raster && isSizeSuffix(String(row.suffix))) ? '' : String(row.suffix)) : sizeSuffix(sz);
    const folder = (row.folder && safeName(row.folder)) || (raster ? sizeLabel(sz) : fmt.toUpperCase());
    const opts = Object.assign({}, (p.settings && p.settings[fmt]) || {}, row); ['format', 'scale', 'ppi', 'width', 'height', 'suffix', 'folder', 'useArtboards', 'range', 'artboard', 'artboards'].forEach(k => delete opts[k]);
    if (p.antiAlias && opts.antiAlias == null) opts.antiAlias = p.antiAlias;
    parsed.push({fmt, sz, suffix, folder, opts});
  }
  const subfolders = !!p.subfolders || !!p.preset, prefix = String(p.prefix || '').replace(/[\/\\:]/g, '-');
  const docSafe = safeName(docStem()) || 'Untitled';
  const pieces = [];                                                       // [{stem, R, filter}]
  if (p.fullDocument && p.assets) return err(C, 'give assets or fullDocument, not both');
  if (p.fullDocument) pieces.push({stem:docSafe, R:null, full:true});
  else if (p.assets){
    const list = p.assets.map(id => AiFile.assets.find(a => a.id === +id));
    if (list.some(a => !a)) return err(C, 'no such asset (see ai.file.status assets)');
    if (!list.length) return err(C, tr('noAssets'));
    const used = new Map();
    for (const a of list){ const f = itemsFilter(a.items), R = artBounds(f); if (!R) return err(C, `asset \`${a.name}\` has no art to export`);
      let stem = safeName(a.name) || tr('asset'); const k = stem.toLowerCase(), n = (used.get(k) || 0) + 1; used.set(k, n); if (n > 1) stem += '-' + n;
      pieces.push({stem, R, filter:f}); }
  } else {
    if (!rangeOk(p.range) || (Array.isArray(p.artboards) && p.artboards.some(i => +i !== 0))) return err(C, tr('badRange'));
    const b = setup().bleed, bleed = p.includeBleed && b.some(v => v > 0);
    pieces.push({stem:safeName(tr('artboard') + ' 1') || 'Artboard-1', R:bleed ? {x:-b[2], y:-b[0], w:Doc.width + b[2] + b[3], h:Doc.height + b[0] + b[1]} : ARTBOARD()});
  }
  const files = [], taken = new Set();
  for (const pc of pieces) for (const r of parsed){
    const file = `${prefix}${pc.stem}${r.suffix}.${FORMATS[r.fmt].ext}`, name = subfolders ? `${r.folder}/${file}` : file;
    if (taken.has(name.toLowerCase())) continue; taken.add(name.toLowerCase());
    let R = pc.R;
    if (pc.full) R = r.fmt === 'pdf' ? ARTBOARD() : artBounds();
    if (!R) return err(C, tr('noArt'));
    const o = Object.assign({}, r.opts);
    if (FORMATS[r.fmt].raster){
      if (r.sz.kind === 'ppi') o.ppi = r.sz.v;
      else { delete o.ppi; o.scale = r.sz.kind === 'w' ? r.sz.v / R.w : r.sz.kind === 'h' ? r.sz.v / R.h : r.sz.v; }
    }
    if (r.fmt === 'jpg' && o.quality == null && r.opts.quality == null) o.quality = 100;
    const e = await encodeRegion(r.fmt, R, o, pc.filter);
    files.push({name, data:e.data instanceof Blob ? await blobU8(e.data) : e.data, mime:e.mime});
  }
  /* 记进文件（document.exportSettings；不进历史） */
  const keep = Object.assign({}, p); delete keep.zip; delete keep.assets; Doc.aiExport = clone(keep);
  const names = files.map(f => f.name);
  if (p.zip !== false && (p.zip === true || files.length > 1)){             // web：多档打成一个 zip（export_for_screens.rs:233-234）
    const zip = zipStore(files), zname = `${prefix}${docSafe}.zip`, d = await deliver(zip, zname, 'application/zip');
    toast(tr('exported', {name:zname}));
    return {ok:true, name:zname, bytes:d.bytes != null ? d.bytes : zip.length, files:names};
  }
  for (const f of files) await deliver(f.data, f.name.split('/').pop(), f.mime);
  toast(tr('exported', {name:names.join(', ')}));
  return {ok:true, files:names};
}
reg('ai.file.exportForScreens', '{} 开「导出为多种屏幕所用格式」对话框（上次的设定）；带参数＝直接导出（document.exportForScreens）：{range?: "all"|"1", fullDocument?, assets?: [资源 id…], includeBleed?, subfolders?, prefix?, '
  + 'preset?: mobile|density | formats?: [{format: png|png8|jpg|webp|gif|svg|svgz|pdf, scale?: 1|"2x"|"100w"|"100h"|"72ppi", width?, height?, ppi?, suffix?, folder?, quality?, …}], settings?: {png|jpg|…: {…}}, antiAlias?, zip?: 多档时缺省 true} → {ok, name?(zip), files}', p => {
  if (!Object.keys(p).length){ Dialogs.screens(); return {pending:'exportForScreens'}; }
  return exportForScreens(p, 'ai.file.exportForScreens');
});
reg('ai.document.exportSettings', '{} 查询：「导出为多种屏幕所用格式」上次的设定（存在文件里）→ {settings}', () => ({settings:clone(Doc.aiExport || {})}));
/* 导出所选项目（menus.rs:1068）：选中的物件收成资源（一个物件一个；multiple:false＝合成一个），开对话框的「资源」页 */
reg('ai.file.exportSelection', '{multiple?: true, open?: true} 导出所选项目：把选中的物件（矢量形状、文字物件）收成资源，开「导出为多种屏幕所用格式」的资源页并勾上 → {ok, assets:[id…]}；要一次导出选取用 ai.document.exportSelection', p => {
  const C = 'ai.file.exportSelection', items = selectionItems();
  if (!items.length) return err(C, tr('nothingSel'));
  const groups = p.multiple === false ? [items] : items.map(i => [i]), ids = [];
  for (const g of groups){
    const id = ++AiFile._assetN, first = g[0], L = Doc.byId(first.layerId), s = first.shapeId && L ? L.data.shapes.find(x => x.id === first.shapeId) : null;
    const nm = (s && s.name) || (L && L.kind === 'text' ? String(L.data.text).split('\n')[0].slice(0, 30) : '') || `${tr('asset')} ${id}`;
    AiFile.assets.push({id, name:nm, items:clone(g)}); ids.push(id);
  }
  if (p.open !== false) Dialogs.screens({tab:'assets', checked:ids});
  return {ok:true, assets:ids};
});
reg('ai.document.exportSelection', '{format?: png|jpg|webp|svg|svgz|pdf（缺省 png）, name?, scale?: 1, …格式选项} 把选中的物件裁到外框一次导出（export.rs:148）→ {ok, name, bytes, width, height}', p => exportFile(Object.assign({format:'png'}, p, {selectedOnly:true}), 'ai.document.exportSelection'));

/* 存储为 Web 所用格式（webexport.rs） */
const WEB0 = () => ({format:'gif', reduction:'selective', colors:128, dither:'diffusion', ditherAmount:100, transparency:true, matte:'white', interlaced:false,
  quality:60, progressive:false, optimized:true, width:null, height:null, percent:null, antiAlias:'art', clipToArtboard:true});
const WEB_PRESETS = [['GIF, 128 colours', {}], ['GIF, 32 colours, no dither', {colors:32, dither:'none'}], ['GIF, web-safe colours', {reduction:'web', colors:256, dither:'none'}],
  ['JPEG, quality 80', {format:'jpg', quality:80}], ['JPEG, quality 50', {format:'jpg', quality:50}], ['JPEG, quality 25', {format:'jpg', quality:25}],
  ['PNG-8, 64 colours', {format:'png8', colors:64}], ['PNG-24', {format:'png24'}]];
function webSettings(p){
  const base = Object.assign(WEB0(), AiFile.web || {});
  if (p && p.preset){ const pr = WEB_PRESETS.find(x => x[0].toLowerCase() === String(p.preset).toLowerCase()); if (!pr) throw new Error(`no Save for Web preset \`${p.preset}\``); Object.assign(base, WEB0(), pr[1]); }
  for (const k in (p || {})) if (k in base && k !== 'preset') base[k] = p[k];
  base.format = ({jpeg:'jpg', 'png-8':'png8', 'png-24':'png24'})[String(base.format).toLowerCase()] || String(base.format).toLowerCase();
  if (!['gif', 'jpg', 'png8', 'png24'].includes(base.format)) throw new Error('format must be gif, jpg, png8 or png24');
  base.colors = clamp(Math.round(num(base.colors, 128)), 2, 256); base.quality = clamp(num(base.quality, 60), 0, 100); base.ditherAmount = clamp(num(base.ditherAmount, 100), 0, 100);
  if (base.percent != null && !(base.percent > 0 && base.percent <= 6400)) throw new Error(`percent must be above 0 and at most 6400, not ${base.percent}`);
  if (base.width === 0 || base.height === 0) throw new Error('width and height are at least 1 pixel');
  return base;
}
async function webEncode(st){
  const R = st.clipToArtboard ? ARTBOARD() : artBounds(); if (!R) throw new Error(tr('noArt'));
  const s = st.width ? st.width / R.w : st.height ? st.height / R.h : st.percent ? st.percent / 100 : 1;
  const c = finishCanvas(renderRegion(R, s), 'transparent', st.antiAlias), W = c.width, H = c.height;
  const matte = st.matte === 'none' ? null : (parseColor(cssBg(st.matte)) || {rgb:[255, 255, 255]}).rgb;
  let data, ext, mime;
  if (st.format === 'gif' || st.format === 'png8'){
    const ix = quantize(rgbaOf(c), W, H, {colors:st.colors, reduction:st.reduction, dither:st.dither, ditherAmount:st.ditherAmount, transparency:st.transparency, matte});
    data = st.format === 'gif' ? encodeGif(ix, st.interlaced) : await encodePng8(ix, 72); ext = st.format === 'gif' ? 'gif' : 'png'; mime = st.format === 'gif' ? 'image/gif' : 'image/png';
  } else if (st.format === 'jpg'){
    data = await blobU8(await canvasBlob(finishCanvas(c, matte ? toCss(matte, 1) : 'white'), 'image/jpeg', st.quality / 100)); ext = 'jpg'; mime = 'image/jpeg';
  } else {
    const cc = st.transparency ? c : finishCanvas(c, matte ? toCss(matte, 1) : 'white');
    data = pngWithPhys(await blobU8(await canvasBlob(cc, 'image/png')), 72); ext = 'png'; mime = 'image/png';
  }
  return {data, ext, mime, width:W, height:H, original:c};
}
reg('ai.file.saveForWeb', '{} 开「存储为 Web 所用格式（旧版）」对话框（原稿／优化双联预览、大小与下载时间）；带设定＝直接存：{preset?, format?: gif|jpg|png8|png24, reduction?, colors?, dither?, ditherAmount?, transparency?, matte?, interlaced?, quality?, width?|height?|percent?, antiAlias?, clipToArtboard?, name?} → {ok, files, bytes}', async p => {
  const C = 'ai.file.saveForWeb';
  if (!Object.keys(p).length){ Dialogs.saveForWeb(); return {pending:'saveForWeb'}; }
  let st; try { st = webSettings(p); } catch (e){ return err(C, e.message); }
  const keep = Object.assign({}, st); AiFile.web = keep;                   // Save… 也会记住设定
  const e = await webEncode(st), name = (baseOf(p) || docStem()) + '.' + e.ext, d = await deliver(e.data, name, e.mime);
  toast(tr('exported', {name}));
  return {ok:true, files:[name], bytes:d.bytes != null ? d.bytes : e.data.length, width:e.width, height:e.height};
});

/* 打包（package.rs）：web 版下载一个 zip：工程档＋Links（像素层 PNG）＋报告 */
async function packageNow(p, C){
  const stem = docStem(), folder = (safeName(p.name) || safeName(stem + tr('folderSuffix')) || 'Package').replace(/\//g, '-');
  const files = [], links = [], fonts = new Set();
  files.push({name:`${folder}/${stem}.dlcanvas`, data:te.encode(JSON.stringify(Project.serialize()))});
  if (p.copyLinks !== false){
    for (const L of Doc.layers) if (L.kind === 'raster'){
      const nm = (safeName(L.name) || 'Link') + '.png', u8 = await blobU8(await canvasBlob(L.data.canvas, 'image/png'));
      files.push({name:p.linksFolder !== false ? `${folder}/${tr('linksDir')}/${nm}` : `${folder}/${nm}`, data:u8}); links.push(nm);
    }
  }
  for (const L of Doc.layers) if (L.kind === 'text') fonts.add(L.data.font || 'sans-serif');
  if (p.report !== false){
    const I = info(), lines = [`${tr('pkgT')} — ${stem}`, '', `Document: ${stem}.dlcanvas`, `Size: ${Doc.width} × ${Doc.height} px`, `Color mode: ${AiFile.colorMode().toUpperCase()}`, `Layers: ${Doc.layers.length}`,
      `Author: ${I.author || '—'}`, '', `Links (${links.length}):`, ...links.map(n => '  ' + n), p.relink ? '  (images are embedded in the document; nothing to relink)' : '',
      '', `Fonts (${fonts.size}):`, ...Array.from(fonts).map(f => '  ' + f), p.copyFonts !== false ? "  (not copied: the browser can't read font files)" : '', '', `Created: ${nowISO()}`];
    files.push({name:`${folder}/${stem} Report.txt`, data:te.encode(lines.filter(x => x !== null).join('\r\n'))});
  }
  const zip = zipStore(files), zname = folder + '.zip', d = await deliver(zip, zname, 'application/zip');
  toast(tr('exported', {name:zname}));
  return {ok:true, name:zname, bytes:d.bytes != null ? d.bytes : zip.length, files:files.map(f => f.name), missingLinks:[]};
}
reg('ai.ui.packageDialog', '{} 开「打包」对话框（从没存过＝先问要不要存储为）', () => {
  if (!AiFile.saved){ Dialogs.confirm(tr('saveFirstQ'), tr('saveFirstD'), () => CMD.run('ai.file.saveAs', {})); return {pending:'confirm'}; }
  Dialogs.pkg(); return {pending:'package'};
});
reg('ai.file.package', '{name?: 文件夹名, copyLinks?: true, linksFolder?: true, relink?: true, copyFonts?: true, report?: true} 打包（file.package；web 版下载 zip）：有未存的改动先存储；没存过要先存 → {ok, name, files}', async p => {
  const C = 'ai.file.package';
  if (!AiFile.saved) return err(C, tr('neverSaved'));
  if (AiFile.isDirty()){ const r = await doSave('save', {}, C); if (r.ok === false) return r; }
  return packageNow(p, C);
});

/* 文档设置（docsetup.rs） */
function setupApply(p, C){
  const s = setup(), o = p || {};
  const flag = (k, v) => { if (typeof v !== 'boolean') throw new Error(`${k} must be true or false`); return v; };
  const pct = (k, v, a, b) => { const n = num(v, NaN); if (!(n >= a && n <= b)) throw new Error(`${k} must be a number from ${a} to ${b}`); return n; };
  const keys = Object.keys(o).filter(k => k !== 'language').concat(o.language !== undefined ? ['language'] : []).reverse();   // 语言先（带它的引号），引号再盖
  for (const k of keys){
    const v = o[k];
    switch (k){
      case 'units': { const u = UNITS.find(x => x.toLowerCase() === String(v).toLowerCase()); if (!u) throw new Error('unknown units'); s.units = u; break; }
      case 'bleed': {
        const side = x => { const n = num(x, NaN); if (!(n >= 0 && n <= 72)) throw new Error('bleed must be 0–72 pt: a number, [top, bottom, left, right] or {top, bottom, left, right}'); return n; };
        if (typeof v === 'number' || typeof v === 'string') { const b = side(v); s.bleed = [b, b, b, b]; }
        else if (Array.isArray(v) && v.length === 4) s.bleed = v.map(side);
        else if (v && typeof v === 'object'){ const b = s.bleed.slice(); for (const kk in v){ const i = ['top', 'bottom', 'left', 'right'].indexOf(kk); if (i < 0) throw new Error('bleed keys: top, bottom, left, right'); b[i] = side(v[kk]); } s.bleed = b; }
        else throw new Error('bleed must be 0–72 pt: a number, [top, bottom, left, right] or {top, bottom, left, right}');
        break; }
      case 'outlineImages': case 'highlightSubstitutedFonts': case 'highlightSubstitutedGlyphs': case 'simulatePaper': case 'discardWhiteOverprint': case 'typographersQuotes': s[k] = flag(k, v); break;
      case 'gridSize': { const g = String(v).toLowerCase(); if (!GRID_CELL[g]) throw new Error('gridSize must be small, medium or large'); s.gridSize = g; break; }
      case 'gridColors': {
        if (typeof v === 'string'){ const pr = GRID_PRESETS.find(x => x[0].toLowerCase() === v.toLowerCase()); if (!pr) throw new Error(`unknown grid colours \`${v}\` (one of ${GRID_PRESETS.map(x => x[0]).join(', ')})`); s.gridColors = pr[1].slice(); }
        else if (Array.isArray(v) && v.length === 2 && v.every(c => parseColor(c))) s.gridColors = v.map(c => toCss(parseColor(c).rgb, 1));
        else throw new Error('gridColors must be a preset name or two colours');
        break; }
      case 'flattenerPreset': { const f = FLATTENERS.find(x => x.toLowerCase() === String(v).toLowerCase().replace(/^\[|\]$/g, '')); if (!f) throw new Error(`unknown flattenerPreset \`${v}\` (High Resolution, Medium Resolution, Low Resolution)`); s.flattenerPreset = f; break; }
      case 'language': { const l = LANGUAGES.find(x => x[0].toLowerCase() === String(v).toLowerCase()); if (!l) throw new Error(`unknown language \`${v}\``); s.language = l[0]; s.quotes = {double:l[1], single:l[2]}; break; }
      case 'quotes': {
        if (!v || typeof v !== 'object') throw new Error('quotes must be {double?, single?}');
        for (const kk in v){ const q = Array.isArray(v[kk]) ? v[kk].join('') : String(v[kk]); if (Array.from(q).length !== 2 || /\s/.test(q)) throw new Error(`quotes.${kk} must be an opening and a closing quote, e.g. "“”"`);
          if (kk !== 'double' && kk !== 'single') throw new Error(`unknown quotes key \`${kk}\` (double, single)`); s.quotes = Object.assign({}, s.quotes, {[kk]:q}); }
        break; }
      case 'superscript': case 'subscript': {
        if (!v || typeof v !== 'object') throw new Error(`${k} must be {size?, position?}`);
        const m = Object.assign({}, s[k]); for (const kk in v){ if (kk === 'size') m.size = pct(`${k}.size`, v[kk], 1, 500); else if (kk === 'position') m.position = pct(`${k}.position`, v[kk], -500, 500); else throw new Error(`unknown ${k} key \`${kk}\` (size, position)`); }
        s[k] = m; break; }
      case 'smallCapsSize': s.smallCapsSize = pct(k, v, 1, 200); break;
      case 'exportText': { const e = String(v).toLowerCase(); if (e !== 'editable' && e !== 'appearance') throw new Error('exportText must be editable or appearance'); s.exportText = e; break; }
      case 'backgroundContents': { const b = String(v).toLowerCase(); if (b !== 'transparent' && b !== 'white') throw new Error('backgroundContents must be transparent or white'); s.backgroundContents = b; break; }
      case 'gridColorsName': break;
      default: throw new Error(`unknown setting \`${k}\``);
    }
  }
  return s;
}
const setupReport = s => Object.assign(clone(s), {gridColorsName:(GRID_PRESETS.find(x => x[1][0] === s.gridColors[0] && x[1][1] === s.gridColors[1]) || ['Custom'])[0]});
reg('ai.document.setup', '{units?, bleed?: pt|[上,下,左,右]|{top?,…}（0–72）, outlineImages?, highlightSubstitutedFonts?, highlightSubstitutedGlyphs?, gridSize?: small|medium|large, gridColors?: Light|Medium|Dark|Red|Orange|Green|Blue|Purple|[色, 色], simulatePaper?, flattenerPreset?, discardWhiteOverprint?, language?, quotes?: {double?, single?}, typographersQuotes?, superscript?: {size?, position?}, subscript?, smallCapsSize?, exportText?: editable|appearance, backgroundContents?: transparent|white} 改文档设置（一步可还原）；不给参数＝回报目前的设置', p => {
  const C = 'ai.document.setup';
  if (!p || !Object.keys(p).length) return setupReport(setup());
  let s; try { s = setupApply(p, C); } catch (e){ return err(C, e.message); }
  if (JSON.stringify(s) === JSON.stringify(setup())) return setupReport(s);
  History.push(); Doc.aiSetup = s; applyViewBg();
  return setupReport(s);
});
reg('ai.file.documentSetup', '{} 开「文档设置」对话框（常规／透明度／文字三页；确定＝ai.document.setup）', () => { Dialogs.setup(); return {pending:'documentSetup'}; });

/* 文档颜色模式（colormgmt.rs convert_mode） */
reg('ai.file.documentColorMode', '{mode: "cmyk"|"rgb", convert?: true（把图稿的颜色经色彩设定〔VectorCraft Generic CMYK〕转过去）, intent?: relativeColorimetric|perceptual|saturation|absoluteColorimetric} 文档颜色模式（一步可还原；选现在的模式＝不算编辑）→ {changed}', p => {
  const C = 'ai.file.documentColorMode', m = String(p.mode || '').toLowerCase();
  if (m !== 'cmyk' && m !== 'rgb') return err(C, 'mode must be "cmyk" or "rgb"');
  const intent = p.intent || 'relativeColorimetric';
  if (!['relativeColorimetric', 'perceptual', 'saturation', 'absoluteColorimetric'].includes(intent)) return err(C, 'intent must be relativeColorimetric, perceptual, saturation or absoluteColorimetric');
  if (AiFile.colorMode() === m) return {changed:0};
  History.push();
  Doc.aiColorMode = m;
  const changed = p.convert === false ? 0 : convertDocColors(m, intent);
  if (window.UI && UI.draw) UI.draw();
  return {changed};
});

/* 文件信息（fileinfo.rs） */
const READ_ONLY = ['created', 'modified', 'colorMode', 'units', 'artboards', 'objects'];
function infoReport(){
  const I = info();
  let objects = 0; for (const L of Doc.layers) objects += 1 + (L.kind === 'vector' ? L.data.shapes.length : 0);
  return {title:I.title || AiFile.name(), author:I.author, authorTitle:I.authorTitle, description:I.description, keywords:I.keywords.slice(), rating:I.rating, copyrightStatus:I.copyrightStatus,
    copyrightNotice:I.copyrightNotice, copyrightUrl:I.copyrightUrl, created:I.created, modified:I.modified, colorMode:AiFile.colorMode(), units:setup().units, artboards:1, objects};
}
function infoApply(o){
  const I = info(); I.title = I.title || AiFile.name();
  const text = (k, v, multi) => { if (v === null) return ''; if (typeof v !== 'string') throw new Error(`${k} must be text`); const s = v.trim();
    if (Array.from(s).length > 65536) throw new Error(`${k} is too long (at most 65536 characters)`);
    if (/[\u0000-\u001f\u007f]/.test(multi ? s.replace(/[\n\r\t]/g, '') : s)) throw new Error(`${k} has control characters${multi ? '' : ' or line breaks'}`); return s; };
  for (const k of Object.keys(o)){
    const v = o[k];
    switch (k){
      case 'title': I.title = text(k, v, false); if (!I.title) throw new Error('title can\'t be empty'); break;
      case 'author': case 'authorTitle': case 'copyrightUrl': I[k] = text(k, v, false);
        if (k === 'copyrightUrl' && (/\s/.test(I[k]) || I[k].length > 2048)) throw new Error('copyrightUrl must be a URL (no spaces, at most 2048 characters)'); break;
      case 'description': case 'copyrightNotice': I[k] = text(k, v, true); break;
      case 'keywords': {
        const parts = v === null ? [] : typeof v === 'string' ? v.split(/[,;]/) : Array.isArray(v) ? v.map(x => text('keywords', x, false)) : null;
        if (!parts) throw new Error('keywords must be a list of words or a comma-separated string');
        const seen = new Set(), out = [];
        for (const w of parts.map(x => String(x).trim()).filter(Boolean)){ if (w.length > 256 || /[\u0000-\u001f]/.test(w)) throw new Error('keywords must be at most 256 characters, without control characters');
          if (!seen.has(w.toLowerCase())){ seen.add(w.toLowerCase()); out.push(w); } if (out.length > 1000) throw new Error('at most 1000 keywords'); }
        I.keywords = out; break; }
      case 'rating': if (!(Number.isInteger(v) && v >= 0 && v <= 5)) throw new Error('rating must be a whole number from 0 to 5'); I.rating = v; break;
      case 'copyrightStatus': if (!['unknown', 'copyrighted', 'publicDomain'].includes(v)) throw new Error('copyrightStatus must be unknown, copyrighted or publicDomain'); I.copyrightStatus = v; break;
      case 'dialog': break;
      default: if (!READ_ONLY.includes(k)) throw new Error(`unknown File Info field \`${k}\``);
    }
  }
  return I;
}
reg('ai.file.info', '{title?, author?, authorTitle?, description?, keywords?: [字…]|"a, b", rating?: 0–5, copyrightStatus?: unknown|copyrighted|publicDomain, copyrightNotice?, copyrightUrl?} 改文件信息（一步可还原；SVG／PDF 导出会带上）；不给参数＝回报 {…, created, modified, colorMode, units, artboards, objects}；{dialog:true}＝开对话框（菜单走这个）', p => {
  const C = 'ai.file.info';
  if (p.dialog === true){ Dialogs.fileInfo(); return Object.assign({pending:'fileInfo'}, infoReport()); }
  const keys = Object.keys(p).filter(k => !READ_ONLY.includes(k));
  if (!keys.length) return infoReport();
  let I; try { I = infoApply(p); } catch (e){ return err(C, e.message); }
  const cur = Object.assign(info(), {title:info().title || AiFile.name()});
  if (JSON.stringify(I) === JSON.stringify(cur)) return infoReport();
  History.push(); Doc.aiInfo = I; setTitle();
  return infoReport();
});

/* 打印（print.rs）：开一个打印预览窗（画面依栅格化分辨率算成一张图），叫浏览器的打印对话框 */
const MEDIA = {driver:null, letter:[612, 792], legal:[612, 1008], tabloid:[792, 1224], a4:[595.28, 841.89], a3:[841.89, 1190.55], a5:[419.53, 595.28]};
const PRINT0 = () => ({media:'driver', orientation:'auto', scaling:'none', scale:100, ppi:300});
function printNow(p){
  const C = 'ai.file.print', st = Object.assign(PRINT0(), Doc.aiPrint || {}, p || {});
  if (!(st.media in MEDIA)) return err(C, `media must be one of ${Object.keys(MEDIA).join(', ')}`);
  if (!['auto', 'portrait', 'landscape'].includes(st.orientation)) return err(C, 'orientation must be auto, portrait or landscape');
  if (!['none', 'fit', 'custom'].includes(st.scaling)) return err(C, 'scaling must be none, fit or custom');
  const ppi = clamp(num(st.ppi, 300), 36, 1200), keep = Object.assign({}, st); delete keep.preview; Doc.aiPrint = keep;
  const R = ARTBOARD(), url = renderRegion(R, ppi / 72).toDataURL('image/png');
  const land = st.orientation === 'landscape' || (st.orientation === 'auto' && R.w > R.h);
  let page = MEDIA[st.media]; if (page && land) page = [page[1], page[0]];
  const pct = st.scaling === 'custom' ? clamp(num(st.scale, 100), 1, 1000) : 100;
  const w = window.open('', '_blank'); if (!w) return err(C, tr('popupBlocked'));
  const size = page ? `${page[0]}pt ${page[1]}pt` : (land ? 'landscape' : 'portrait');
  const img = st.scaling === 'fit' ? 'max-width:100%;max-height:100vh;object-fit:contain' : `width:${R.w * pct / 100}pt;height:${R.h * pct / 100}pt`;
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(AiFile.name())}</title><style>@page{size:${size};margin:0}html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}img{${img}}</style></head>`
    + `<body><img id="art" src="${url}"></body></html>`);
  w.document.close();
  if (!st.preview){ const go = () => { try { w.focus(); w.print(); } catch (_){} }; const im = w.document.getElementById('art'); if (im && !im.complete) im.onload = () => setTimeout(go, 50); else setTimeout(go, 50); }
  AiFile._printWindow = w;
  return {ok:true, window:true, media:st.media, orientation:land ? 'landscape' : 'portrait', scaling:st.scaling, ppi};
}
reg('ai.file.print', '{} 开「打印」对话框；带设定＝直接开打印预览窗并叫浏览器打印：{media?: driver|letter|legal|tabloid|a4|a3|a5, orientation?: auto|portrait|landscape, scaling?: none|fit|custom, scale?: 100（custom 的百分比）, ppi?: 300（栅格化分辨率）, preview?: true（只开预览窗、不叫打印）} → {ok, window}', p => {
  if (!Object.keys(p).length){ Dialogs.print(); return {pending:'print'}; }
  return printNow(p);
});

/* ═══════════ PDF 预设（pdf/src/presets.rs） ═══════════ */
const PDF_PRESETS = [
  {id:'VectorCraft Default', label:S('[堤麟畫板預設]', '[堤麟画板默认]', '[Dilin Canvas Default]'), ppi:300, codec:'zip', quality:'maximum', compat:'1.7', bleed:false, std:'none',
   desc:S('保留可編輯性（瀏覽器版：工作區域點陣化成影像）。', '保留可编辑性（浏览器版：画板栅格化成图像）。', 'Keeps the document editable (browser version: artboards rasterized).')},
  {id:'High Quality Print', label:S('[高品質列印]', '[高质量打印]', '[High Quality Print]'), ppi:300, codec:'auto', quality:'maximum', compat:'1.6', bleed:false, std:'none',
   desc:S('桌上型印表機與校樣：影像保持列印解析度。', '用于桌面打印机和校样：图像保持打印分辨率。', 'For desktop printers and proofs: images stay at print resolution.')},
  {id:'Press Quality', label:S('[印刷品質]', '[印刷质量]', '[Press Quality]'), ppi:300, codec:'zip', quality:'maximum', compat:'1.6', bleed:true, std:'none',
   desc:S('商業印刷：高解析度無失真壓縮，含文件出血。', '用于商业印刷：高分辨率无损压缩，含文档出血。', "For commercial printing: high-resolution images compressed losslessly, the document's bleed.")},
  {id:'Smallest File Size', label:S('[最小檔案大小]', '[最小文件大小]', '[Smallest File Size]'), ppi:100, codec:'jpeg', quality:'medium', compat:'1.6', bleed:false, std:'none',
   desc:S('螢幕、電子郵件與網頁：影像重新取樣到 100 ppi 並壓縮。', '用于屏幕、电子邮件和网页：图像重新采样到 100 ppi 并压缩。', 'For screens, email and the web: images resampled to 100 ppi and compressed.')},
  {id:'PDF/X-1a:2001', label:lang3('[PDF/X-1a:2001]'), ppi:300, codec:'auto', quality:'maximum', compat:'1.3', bleed:true, std:'PDF/X-1a:2001', desc:lang3('Print exchange with CMYK and spot colours only.')},
  {id:'PDF/X-3:2002', label:lang3('[PDF/X-3:2002]'), ppi:300, codec:'auto', quality:'maximum', compat:'1.3', bleed:true, std:'PDF/X-3:2002', desc:lang3('Print exchange allowing colour-managed colours.')},
  {id:'PDF/X-4:2010', label:lang3('[PDF/X-4:2010]'), ppi:300, codec:'auto', quality:'maximum', compat:'1.6', bleed:true, std:'PDF/X-4', desc:lang3('Print exchange keeping live transparency.')},
];
const pdfPresetOf = id => PDF_PRESETS.find(x => !id ? x.id === 'VectorCraft Default' : x.id.toLowerCase() === String(id).toLowerCase() || (String(id).toLowerCase() === 'default' && x.id === 'VectorCraft Default')) || PDF_PRESETS[0];

/* ═══════════ 对话框（DOM 与样式都在这支档里） ═══════════ */
function ensureStyle(){
  if (document.getElementById('aifStyle')) return;
  const st = document.createElement('style'); st.id = 'aifStyle';
  st.textContent = `.aifdlg-back{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center}
.aifdlg{background:#2b2b2b;color:#ddd;border:1px solid #555;border-radius:6px;box-shadow:0 10px 40px #000a;padding:14px 16px;min-width:340px;max-width:94vw;max-height:92vh;overflow:auto;font:12px/1.5 system-ui,sans-serif}
.aifdlg .t{font-weight:600;font-size:13px;margin-bottom:10px;color:#fff}
.aifdlg .row{display:flex;align-items:center;gap:8px;margin:5px 0}.aifdlg .row>span:first-child{min-width:128px;color:#aaa}
.aifdlg input[type=text],.aifdlg input[type=number],.aifdlg select,.aifdlg textarea{background:#1e1e1e;color:#eee;border:1px solid #555;border-radius:3px;padding:3px 5px;font:inherit}
.aifdlg input[type=number]{width:72px}.aifdlg textarea{width:300px}.aifdlg input[type=text]{min-width:200px}
.aifdlg .chk{display:flex;align-items:center;gap:6px;margin:4px 0}.aifdlg .sec{margin:12px 0 4px;font-weight:600;color:#bbb;border-bottom:1px solid #444}
.aifdlg .note{color:#999;font-size:11px;margin:4px 0}.aifdlg .er{color:#ff8a7a;min-height:0;margin-top:6px}
.aifdlg .bar{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.aifdlg button{background:#3d3d3d;color:#eee;border:1px solid #666;border-radius:3px;padding:4px 14px;font:inherit;cursor:pointer}
.aifdlg button.pri{background:#2f6fd0;border-color:#2f6fd0}.aifdlg .tabs{display:flex;gap:2px;margin-bottom:8px}.aifdlg .tabs button{border-radius:3px 3px 0 0;padding:3px 12px}.aifdlg .tabs button.on{background:#555}
.aifdlg table{border-collapse:collapse}.aifdlg td{padding:2px 4px}.aifdlg .chips span{display:inline-block;background:#444;border-radius:9px;padding:0 6px;margin:2px}.aifdlg .chips b{cursor:pointer;margin-left:4px}
.aifdlg .stars span{cursor:pointer;font-size:16px;color:#777}.aifdlg .stars span.on{color:#f0b429}.aifdlg .pv{display:flex;gap:8px}.aifdlg .pv>div{flex:1;background:#1a1a1a;border:1px solid #444;display:flex;flex-direction:column;align-items:center}
.aifdlg .pv img,.aifdlg .pv canvas{max-width:300px;max-height:240px;margin:6px;background:repeating-conic-gradient(#888 0 25%,#aaa 0 50%) 0 0/12px 12px}.aifdlg .pv .cap{font-size:11px;color:#aaa;padding:2px 6px}
#aiHome{position:absolute;inset:0;z-index:50;display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(23,23,23,.92);color:#ddd;font:14px system-ui,sans-serif}
#aiHome .h{font-size:18px;color:#fff}#aiHome .b{display:flex;gap:10px}#aiHome button{background:#3d3d3d;color:#eee;border:1px solid #666;border-radius:4px;padding:6px 16px;cursor:pointer;font:inherit}
#aifToast{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);z-index:10001;background:#000c;color:#fff;padding:5px 14px;border-radius:14px;font:12px system-ui,sans-serif;pointer-events:none;transition:opacity .3s}`;
  document.head.appendChild(st);
}
const Dlg = {
  cur: null,
  /* o：{id, title, width, body(bd, api), buttons:[{act, label, pri}], ok(api)→false|字串(错误)|{ok:false,error}|Promise, discard(api), cancel()} */
  open(o){
    this.close(true); ensureStyle();
    const back = document.createElement('div'); back.className = 'aifdlg-back'; back.id = 'aifDlg'; back.dataset.dlg = o.id;
    const box = document.createElement('div'); box.className = 'aifdlg'; if (o.width) box.style.width = o.width + 'px';
    box.innerHTML = `<div class="t">${esc(o.title)}</div><div class="bd"></div><div class="er"></div><div class="bar"></div>`;
    const bd = box.querySelector('.bd'), bar = box.querySelector('.bar');
    const api = {o, box, F:{}, id:o.id,
      get(k){ const e = this.F[k]; if (!e) return undefined; if (e._radio) { const c = e._radio.find(r => r.checked); return c ? c.value : null; }
        if (e.type === 'checkbox') return e.checked; if (e.type === 'number') return e.value === '' ? null : +e.value; return e.value; },
      set(k, v){ const e = this.F[k]; if (!e) return; if (e._radio) e._radio.forEach(r => { r.checked = r.value === String(v); }); else if (e.type === 'checkbox') e.checked = !!v; else e.value = v == null ? '' : v; },
      error(m){ box.querySelector('.er').textContent = m ? String(m) : ''; },
      close:() => Dlg.close()};
    this.cur = {o, api, back};
    o.body(bd, api);
    (o.buttons || [{act:'cancel', label:tr('cancel')}, {act:'ok', label:tr('ok'), pri:true}]).forEach(b => {
      const btn = document.createElement('button'); btn.textContent = b.label; btn.dataset.act = b.act; if (b.pri) btn.className = 'pri';
      btn.onclick = () => b.act === 'ok' ? Dlg.ok() : b.act === 'discard' ? Dlg.discard() : Dlg.close();
      bar.appendChild(btn);
    });
    box.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape'){ e.preventDefault(); Dlg.close(); }
      else if (e.key === 'Enter' && !/textarea|button/i.test(e.target.tagName) && !(e.target.dataset && e.target.dataset.noenter)){ e.preventDefault(); Dlg.ok(); }
    });
    back.addEventListener('pointerdown', e => e.stopPropagation()); back.addEventListener('mousedown', e => e.stopPropagation());
    back.appendChild(box); document.body.appendChild(back);
    const first = box.querySelector('input:not([type=checkbox]):not([type=radio]),select'); if (first){ first.focus(); if (first.select) first.select(); }
    return api;
  },
  close(silent){
    const c = this.cur; if (!c) return;
    this.cur = null; c.back.remove();
    if (!silent && c.o.cancel) try { c.o.cancel(); } catch (_){}
    if (window.UI && UI.draw) UI.draw();
  },
  async run(fn){
    const c = this.cur; if (!c || !fn) return;
    try {
      const r = await fn(c.api);
      if (r === false) return;
      if (typeof r === 'string'){ c.api.error(r); return; }
      if (r && r.ok === false){ c.api.error(r.error); return; }
      if (this.cur === c){ this.cur = null; c.back.remove(); if (window.UI && UI.draw) UI.draw(); }
      return r;
    } catch (e){ c.api.error(e && e.message ? e.message : String(e)); }
  },
  ok(){ return this.run(this.cur && this.cur.o.ok); },
  discard(){ return this.run(this.cur && this.cur.o.discard); }
};
AiFile.dialog = () => Dlg.cur ? Dlg.cur.o.id : null;
AiFile.dlg = Dlg;
/* 栏位小工具：rows＝[{k, label, type:text|number|select|check|textarea|radio|note|sec, value, options:[[值, 文字, disabled?]], min, max, step, change}] */
function addRows(bd, api, rows){
  rows.forEach(r => {
    if (!r) return;
    if (r.type === 'sec'){ const d = document.createElement('div'); d.className = 'sec'; d.textContent = r.label; bd.appendChild(d); return; }
    if (r.type === 'note'){ const d = document.createElement('div'); d.className = 'note'; d.textContent = r.label; if (r.k) d.dataset.k = r.k; bd.appendChild(d); if (r.k) api.F[r.k] = d; return; }
    if (r.type === 'check'){
      const l = document.createElement('label'); l.className = 'chk'; const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!r.value; i.dataset.k = r.k;
      if (r.disabled) i.disabled = true; l.appendChild(i); l.appendChild(document.createTextNode(r.label)); bd.appendChild(l); api.F[r.k] = i;
      if (r.change) i.addEventListener('change', () => r.change(i.checked, api)); return;
    }
    const l = document.createElement('div'); l.className = 'row'; const sp = document.createElement('span'); sp.textContent = r.label || ''; l.appendChild(sp);
    let e;
    if (r.type === 'select'){ e = document.createElement('select'); r.options.forEach(([v, t, dis]) => { const op = document.createElement('option'); op.value = v; op.textContent = t; if (dis) op.disabled = true; e.appendChild(op); }); e.value = r.value; }
    else if (r.type === 'textarea'){ e = document.createElement('textarea'); e.rows = r.rows || 3; e.value = r.value || ''; }
    else if (r.type === 'radio'){
      e = document.createElement('span'); e._radio = [];
      r.options.forEach(([v, t]) => { const lab = document.createElement('label'); lab.style.marginRight = '10px'; const ri = document.createElement('input'); ri.type = 'radio'; ri.name = 'aif_' + r.k; ri.value = v; ri.checked = String(r.value) === String(v); ri.dataset.k = r.k + ':' + v;
        lab.appendChild(ri); lab.appendChild(document.createTextNode(' ' + t)); e.appendChild(lab); e._radio.push(ri); if (r.change) ri.addEventListener('change', () => r.change(v, api)); });
    }
    else { e = document.createElement('input'); e.type = r.type === 'number' ? 'number' : 'text'; if (r.min != null) e.min = r.min; if (r.max != null) e.max = r.max; if (r.step != null) e.step = r.step; e.value = r.value == null ? '' : r.value; }
    if (!e._radio) e.dataset.k = r.k;
    if (r.disabled) e.disabled = true;
    if (r.change && !e._radio) e.addEventListener(r.type === 'select' ? 'change' : 'input', () => r.change(api.get(r.k), api));
    l.appendChild(e); if (r.after) { const a = document.createElement('span'); a.className = 'note'; a.textContent = r.after; if (r.afterK) { a.dataset.k = r.afterK; api.F[r.afterK] = a; } l.appendChild(a); }
    bd.appendChild(l); api.F[r.k] = e;
  });
}
const opt = (pairs) => pairs.map(([v, k]) => [v, tr(k)]);

const Dialogs = {
  /* 存储为／存储副本／存储为模板（save_options.rs __pick：档名＋格式） */
  saveAs(mode, p, then){
    const title = mode === 'copy' ? tr('saveCopyT') : mode === 'template' ? tr('saveTplT') : tr('saveAsT');
    const stem = docStem(), def = mode === 'copy' ? stem + tr('copySuffix') : mode === 'template' ? stem + tr('tplSuffix') : stem;
    const C = mode === 'copy' ? 'ai.file.saveCopy' : mode === 'template' ? 'ai.file.saveAsTemplate' : 'ai.file.saveAs';
    Dlg.open({id:mode === 'copy' ? 'saveCopy' : mode === 'template' ? 'saveAsTemplate' : 'saveAs', title, width:420,
      body:(bd, api) => addRows(bd, api, [{k:'name', label:tr('fileName'), type:'text', value:(p && p.name) || def},
        mode === 'template' ? null : {k:'format', label:tr('format'), type:'select', value:(p && p.format) || (mode === 'saveAs' ? AiFile.format : 'dlcanvas'),
          options:[['dlcanvas', tr('fmtNative')], ['template', tr('fmtTpl')], ['pdf', tr('fmtPdf')], ['svg', tr('fmtSvg')], ['svgz', tr('fmtSvgz')]]}]),
      ok:async api => {
        const name = String(api.get('name') || '').trim(); if (!name) return 'File Name?';
        const fmt = mode === 'template' ? 'template' : api.get('format');
        if (fmt === 'pdf'){ Dialogs.savePdf({name:stripExt(name), __save:mode, __then:then}); return {ok:true}; }
        const r = await doSave(fmt === 'template' && mode === 'saveAs' ? 'template' : mode, {name:stripExt(name), format:fmt}, C);
        if (r.ok !== false && then) setTimeout(then, 0);
        return r;
      }});
  },
  saveChanges(C){
    Dlg.open({id:'saveChanges', title:tr('saveChangesQ', {name:AiFile.name()}), width:440,
      body:(bd) => { const d = document.createElement('div'); d.className = 'note'; d.textContent = tr('saveChangesD'); bd.appendChild(d); },
      buttons:[{act:'discard', label:tr('dontSave')}, {act:'cancel', label:tr('cancel')}, {act:'ok', label:tr('save'), pri:true}],
      ok:async () => { const r = await saveThen({}, closeNow, C); return r && r.pending ? {ok:true} : r; },
      discard:() => closeNow()});
  },
  confirm(msg, detail, then){
    Dlg.open({id:'confirm', title:msg, width:440, body:(bd) => { const d = document.createElement('div'); d.className = 'note'; d.textContent = detail; bd.appendChild(d); },
      ok:() => { Dlg.close(true); return Promise.resolve(then()).then(r => (r && r.ok === false) ? (toast(r.error), {ok:true}) : {ok:true}); }});
  },
  /* 导出为（export_as.rs） */
  exportAs(p){
    const opts = EXPORT_ORDER.map(id => UNAVAIL[id] ? [id, UNAVAIL[id][0] + ' ' + tr('unavail'), true] : [id, FORMATS[id].label]);
    const hint = api => { const f = api.get('format'), use = api.get('useArtboards'); api.F.hint.textContent = use ? (f === 'pdf' ? tr('hintPage') : tr('hintFile', {ext:FORMATS[f] ? FORMATS[f].ext : f})) : tr('hintArt'); };
    Dlg.open({id:'exportAs', title:tr('exportAsT'), width:420,
      body:(bd, api) => { addRows(bd, api, [{k:'format', label:tr('format'), type:'select', value:formatOf(p.format) || 'png', options:opts, change:(v, a) => hint(a)},
        {k:'useArtboards', label:tr('useArtboards'), type:'check', value:!!p.useArtboards, change:(v, a) => hint(a)},
        {k:'all', label:'', type:'radio', value:p.range ? 'range' : 'all', options:[['all', tr('all')], ['range', tr('range')]]},
        {k:'range', label:'', type:'text', value:p.range || '1'}, {k:'hint', type:'note', label:''}]); hint(api); },
      buttons:[{act:'cancel', label:tr('cancel')}, {act:'ok', label:tr('exportBtn'), pri:true}],
      ok:api => {
        const fmt = api.get('format'), use = api.get('useArtboards'), range = api.get('all') === 'all' ? 'all' : api.get('range');
        if (UNAVAIL[fmt]) return UNAVAIL[fmt][1];
        if (use && !rangeOk(range)) return tr('badRange');
        if (!use && !artBounds()) return tr('noArt');
        const q = {format:fmt, useArtboards:use, range:use ? range : undefined, name:docStem()};
        if (FORMATS[fmt].raster){ Dialogs.raster(fmt, q); return {ok:true}; }
        if (fmt === 'pdf' && use){ Dialogs.savePdf({name:q.name, range}); return {ok:true}; }
        if (fmt === 'txt'){ Dialogs.txt(q); return {ok:true}; }
        return exportFile(q, 'ai.file.exportAs');
      }});
  },
  /* PNG／JPEG／GIF…选项（png_options.rs、tiff_bmp_tga、psd_options） */
  raster(fmt, q){
    const R0 = q.useArtboards === false ? artBounds() : ARTBOARD();
    const sizeTxt = api => { const ppi = api.get('ppiSel') === 'other' ? num(api.get('ppi'), 72) : +api.get('ppiSel'); if (api.F.sz && R0) api.F.sz.textContent = `${Math.round(R0.w * ppi / 72)} × ${Math.round(R0.h * ppi / 72)} px`; };
    const bg0 = defaultBg(fmt), keepsA = ['png', 'webp', 'gif', 'png8', 'psd', 'tiff'].includes(fmt);
    const rows = [{k:'ppiSel', label:tr('resolution'), type:'select', value:'72', options:[['72', tr('resScreen')], ['150', tr('resMed')], ['300', tr('resHigh')], ['other', tr('other')]], change:(v, a) => sizeTxt(a)},
      {k:'ppi', label:'', type:'number', value:72, min:1, max:4608, change:(v, a) => sizeTxt(a)},
      {k:'background', label:tr('bg'), type:'select', value:keepsA ? bg0 : 'white', options:(keepsA ? [['transparent', tr('bgT')]] : []).concat([['white', tr('bgW')], ['black', tr('bgB')]])},
      {k:'antiAlias', label:tr('aa'), type:'select', value:'art', options:opt([['none', 'aaNone'], ['art', 'aaArt'], ['type', 'aaType']])}];
    if (fmt === 'png') rows.push({k:'interlaced', label:tr('interlaced'), type:'check', value:false});
    if (fmt === 'jpg') rows.push({k:'colorModel', label:tr('colorModel'), type:'select', value:AiFile.colorMode() === 'cmyk' ? 'cmyk' : 'rgb', options:[['rgb', 'RGB'], ['cmyk', 'CMYK'], ['gray', 'Grayscale']]},
      {k:'quality', label:tr('quality'), type:'number', value:9, min:0, max:10, step:1, after:'(0–10)'},
      {k:'method', label:tr('method'), type:'select', value:'baseline', options:opt([['baseline', 'mBaseline'], ['optimized', 'mOptimized'], ['progressive', 'mProgressive']])},
      {k:'embedIcc', label:tr('embedIcc'), type:'check', value:true});
    if (fmt === 'gif' || fmt === 'png8') rows.push({k:'reduction', label:tr('reduction'), type:'select', value:'selective', options:opt([['perceptual', 'redPerceptual'], ['selective', 'redSelective'], ['adaptive', 'redAdaptive'], ['web', 'redWeb'], ['blackWhite', 'redBW'], ['gray', 'redGray']])},
      {k:'colors', label:tr('colors'), type:'number', value:256, min:2, max:256}, {k:'dither', label:tr('dither'), type:'select', value:'diffusion', options:opt([['none', 'dNone'], ['diffusion', 'dDiff'], ['pattern', 'dPat'], ['noise', 'dNoise']])},
      {k:'ditherAmount', label:tr('ditherAmt'), type:'number', value:100, min:0, max:100}, {k:'transparency', label:tr('transparency'), type:'check', value:true},
      {k:'matte', label:tr('matte'), type:'select', value:'white', options:[['none', tr('none')], ['white', tr('bgW')], ['black', tr('bgB')]]}, {k:'interlaced', label:tr('interlaced'), type:'check', value:false});
    if (fmt === 'webp') rows.push({type:'note', label:tr('lossless')});
    if (fmt === 'tiff') rows.push({k:'colorModel', label:tr('colorModel'), type:'select', value:'rgb', options:[['rgb', 'RGB'], ['gray', 'Grayscale']]});
    if (fmt === 'bmp' || fmt === 'tga') rows.push({k:'depth', label:tr('depth'), type:'select', value:'24', options:[['24', '24 bit'], ['32', '32 bit']]});
    if (fmt === 'psd') rows.push({k:'colorModel', label:tr('colorModel'), type:'select', value:'rgb', options:[['rgb', 'RGB']]}, {k:'layers', label:tr('writeLayers'), type:'check', value:true}, {k:'hiddenLayers', label:tr('hiddenLayers'), type:'check', value:false});
    rows.push({k:'sz', type:'note', label:''});
    Dlg.open({id:fmt + 'Options', title:tr('optsT', {fmt:FORMATS[fmt].label}), width:400, body:(bd, api) => { addRows(bd, api, rows); sizeTxt(api); },
      buttons:[{act:'cancel', label:tr('cancel')}, {act:'ok', label:tr('exportGo'), pri:true}],
      ok:api => {
        const o = Object.assign({}, q, {ppi:api.get('ppiSel') === 'other' ? num(api.get('ppi'), 72) : +api.get('ppiSel')});
        ['background', 'antiAlias', 'interlaced', 'colorModel', 'method', 'embedIcc', 'reduction', 'colors', 'dither', 'ditherAmount', 'transparency', 'matte', 'layers', 'hiddenLayers'].forEach(k => { if (api.F[k]) o[k] = api.get(k); });
        if (api.F.quality) o.quality = clamp(Math.round(num(api.get('quality'), 9)), 0, 10) * 10;
        if (api.F.depth) o.depth = +api.get('depth');
        return exportFile(o, 'ai.file.exportAs');
      }});
  },
  txt(q){
    Dlg.open({id:'textExport', title:tr('txtT'), body:(bd, api) => addRows(bd, api, [{k:'encoding', label:tr('encoding'), type:'select', value:'utf8', options:[['utf8', 'UTF-8'], ['utf16', 'UTF-16']]},
      {k:'lineEndings', label:tr('lineEnd'), type:'select', value:'lf', options:[['lf', 'LF (macOS / Linux)'], ['crlf', 'CRLF (Windows)']]}]),
      ok:api => exportFile(Object.assign({}, q, {encoding:api.get('encoding'), lineEndings:api.get('lineEndings')}), 'ai.file.exportAs')});
  },
  /* 存储 Adobe PDF（save_pdf.rs 精简：预设、标准、兼容性、常规、压缩、标记和出血） */
  savePdf(p){
    const fill = (api, id) => { const pr = pdfPresetOf(id); api.set('compatibility', pr.compat); api.set('ppi', pr.ppi); api.set('compression', pr.codec); api.set('quality', pr.quality); api.set('useDocumentBleed', pr.bleed);
      api.F.std.textContent = pr.std === 'none' ? tr('none') : pr.std; api.F.desc.textContent = pr.desc[Lang.cur] || pr.desc.en; };
    Dlg.open({id:'savePdf', title:tr('savePdfT'), width:480,
      body:(bd, api) => { addRows(bd, api, [
        {k:'preset', label:tr('pdfPreset'), type:'select', value:'VectorCraft Default', options:PDF_PRESETS.map(x => [x.id, x.label[Lang.cur] || x.label.en]), change:(v, a) => fill(a, v)},
        {k:'stdLbl', label:tr('standard'), type:'note'}, {k:'compatibility', label:tr('compat'), type:'select', value:'1.7', options:[['1.3', 'Acrobat 4 (PDF 1.3)'], ['1.4', 'Acrobat 5 (PDF 1.4)'], ['1.5', 'Acrobat 6 (PDF 1.5)'], ['1.6', 'Acrobat 7 (PDF 1.6)'], ['1.7', 'Acrobat 8 (PDF 1.7)']]},
        {type:'sec', label:tr('general')}, {k:'desc', type:'note', label:''}, {k:'viewAfterSaving', label:tr('viewAfter'), type:'check', value:false},
        {k:'all', label:tr('artboard') + '：', type:'radio', value:p.range && p.range !== 'all' ? 'range' : 'all', options:[['all', tr('all')], ['range', tr('range')]]}, {k:'range', label:'', type:'text', value:p.range && p.range !== 'all' ? p.range : '1'},
        {type:'sec', label:tr('compression')}, {k:'ppi', label:tr('imgRes'), type:'number', value:300, min:9, max:2400, after:'ppi'},
        {k:'compression', label:tr('imgComp'), type:'select', value:'zip', options:[['auto', tr('compAuto')], ['zip', 'ZIP'], ['jpeg', 'JPEG']]},
        {k:'quality', label:tr('jpegQ'), type:'select', value:'maximum', options:opt([['minimum', 'qMin'], ['low', 'qLow'], ['medium', 'qMed'], ['high', 'qHigh'], ['maximum', 'qMax']])},
        {type:'sec', label:tr('marks')}, {k:'useDocumentBleed', label:tr('useDocBleed'), type:'check', value:false}, {type:'note', label:tr('pdfNote')}]);
        const sl = api.F.stdLbl; sl.textContent = ''; api.F.std = document.createElement('span'); sl.appendChild(document.createTextNode(tr('standard') + ' ')); sl.appendChild(api.F.std);
        api.F.std.dataset.k = 'std'; fill(api, 'VectorCraft Default'); },
      buttons:[{act:'cancel', label:tr('cancel')}, {act:'ok', label:tr('savePdfBtn'), pri:true}],
      ok:async api => {
        const o = {preset:api.get('preset'), compatibility:api.get('compatibility'), ppi:num(api.get('ppi'), 300), compression:api.get('compression'), quality:api.get('quality'),
          useDocumentBleed:api.get('useDocumentBleed'), viewAfterSaving:api.get('viewAfterSaving'), range:api.get('all') === 'all' ? 'all' : api.get('range'), name:p.name || docStem()};
        if (!rangeOk(o.range)) return tr('badRange');
        if (p.__save){ const r = await doSave(p.__save, {name:o.name, format:'pdf', options:o}, 'ai.file.saveAs'); if (r.ok !== false && p.__then) setTimeout(p.__then, 0); return r; }
        return exportPdf(o, 'ai.file.export.pdf');
      }});
  },
  office(){
    const sz = api => { const ppi = +api.get('ppi'); api.F.sz.textContent = `${tr('size')} ${Math.round(Doc.width * ppi / 72)} × ${Math.round(Doc.height * ppi / 72)} px`; };
    Dlg.open({id:'saveForOffice', title:tr('officeT'), width:380,
      body:(bd, api) => { addRows(bd, api, [{k:'ppi', label:tr('resolution'), type:'select', value:'150', options:[['72', tr('resScreen')], ['150', tr('resMed')], ['300', tr('resHigh')]], change:(v, a) => sz(a)},
        {k:'sz', type:'note', label:''}, {k:'transparent', label:tr('transparentBg'), type:'check', value:false}]); sz(api); },
      buttons:[{act:'cancel', label:tr('cancel')}, {act:'ok', label:tr('save') + '…', pri:true}],
      ok:api => CMD.run('ai.document.exportForOffice', {ppi:+api.get('ppi'), transparent:api.get('transparent'), artboard:0})});
  },
  /* 导出为多种屏幕所用格式（export_for_screens.rs） */
  screens(o){
    o = o || {};
    const saved = Doc.aiExport || {}, rows0 = (Array.isArray(saved.formats) && saved.formats.length) ? clone(saved.formats).map(r => Object.assign({format:'png'}, r))
      : saved.preset ? presetRows(saved.preset) : [{format:'png', scale:'1x', suffix:''}];
    const FMT = [['png', 'PNG'], ['png8', 'PNG 8'], ['jpg100', 'JPG 100'], ['jpg80', 'JPG 80'], ['jpg50', 'JPG 50'], ['webp', 'WebP'], ['gif', 'GIF'], ['svg', 'SVG'], ['pdf', 'PDF']];
    const fmtKey = r => r.format === 'jpg' ? 'jpg' + (r.quality === 80 ? 80 : r.quality === 50 ? 50 : 100) : r.format;
    // 没写后缀的行：照 ScreenSize::suffix 补（1x 没有、其余 @2x／@100w…）
    let tab = o.tab || 'artboards', rows = rows0.map(r => ({scale:typeof r.scale === 'number' ? r.scale + 'x' : (r.scale || '1x'), suffix:r.suffix != null ? r.suffix : (sizeOf(r) ? sizeSuffix(sizeOf(r)) : ''), key:fmtKey(r), folder:r.folder}));
    const checked = new Set(o.checked || AiFile.assets.map(a => a.id));
    Dlg.open({id:'exportForScreens', title:tr('screensT'), width:600,
      body:(bd, api) => {
        const tabs = document.createElement('div'); tabs.className = 'tabs'; bd.appendChild(tabs);
        const pa = document.createElement('div'), pb = document.createElement('div'), right = document.createElement('div'); bd.appendChild(pa); bd.appendChild(pb);
        [['artboards', tr('tabArtboards')], ['assets', tr('tabAssets')]].forEach(([k, t]) => { const b = document.createElement('button'); b.textContent = t; b.dataset.tab = k;
          b.onclick = () => { tab = k; show(); }; tabs.appendChild(b); });
        const show = () => { tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab)); pa.style.display = tab === 'artboards' ? '' : 'none'; pb.style.display = tab === 'assets' ? '' : 'none'; };
        api.tab = () => tab;
        addRows(pa, api, [{k:'select', label:tr('select'), type:'radio', value:saved.fullDocument ? 'full' : 'all', options:[['all', tr('all')], ['range', tr('range')], ['full', tr('full')]]},
          {k:'range', label:'', type:'text', value:'1'}, {k:'includeBleed', label:tr('includeBleed'), type:'check', value:!!saved.includeBleed}]);
        if (!AiFile.assets.length){ const n = document.createElement('div'); n.className = 'note'; n.textContent = tr('noAssetList'); pb.appendChild(n); }
        AiFile.assets.forEach(a => { const l = document.createElement('label'); l.className = 'chk'; const i = document.createElement('input'); i.type = 'checkbox'; i.checked = checked.has(a.id); i.dataset.asset = a.id;
          i.onchange = () => { if (i.checked) checked.add(a.id); else checked.delete(a.id); }; l.appendChild(i); l.appendChild(document.createTextNode(a.name)); pb.appendChild(l); });
        bd.appendChild(right);
        addRows(right, api, [{type:'sec', label:tr('formatsH')}, {k:'preset', label:tr('presetL'), type:'select', value:saved.preset || '', options:[['', tr('none')], ['mobile', tr('pMobile')], ['density', tr('pDensity')]],
          change:(v) => { if (v){ rows = presetRows(v).map(r => ({scale:r.scale, suffix:r.suffix, key:'png', folder:r.folder})); drawRows(); api.set('subfolders', true); } }}]);
        const tb = document.createElement('table'); right.appendChild(tb);
        const drawRows = () => {
          tb.innerHTML = `<tr><td class="note">${esc(tr('scale'))}</td><td class="note">${esc(tr('suffix'))}</td><td class="note">${esc(tr('format').replace(/：|:/, ''))}</td><td></td></tr>`;
          rows.forEach((r, i) => {
            const tr_ = document.createElement('tr');
            const sc = document.createElement('input'); sc.type = 'text'; sc.value = r.scale; sc.style.minWidth = '70px'; sc.style.width = '70px'; sc.dataset.row = i; sc.dataset.f = 'scale'; sc.oninput = () => { r.scale = sc.value; };
            const sf = document.createElement('input'); sf.type = 'text'; sf.value = r.suffix; sf.style.minWidth = '70px'; sf.style.width = '70px'; sf.dataset.row = i; sf.dataset.f = 'suffix'; sf.oninput = () => { r.suffix = sf.value; };
            const fm = document.createElement('select'); FMT.forEach(([v, t]) => { const op = document.createElement('option'); op.value = v; op.textContent = t; fm.appendChild(op); }); fm.value = r.key; fm.dataset.row = i; fm.dataset.f = 'format'; fm.onchange = () => { r.key = fm.value; };
            const x = document.createElement('button'); x.textContent = '×'; x.onclick = () => { rows.splice(i, 1); drawRows(); };
            [sc, sf, fm, x].forEach(e => { const td = document.createElement('td'); td.appendChild(e); tr_.appendChild(td); }); tb.appendChild(tr_);
          });
        };
        drawRows();
        const add = document.createElement('button'); add.textContent = tr('addScale'); add.dataset.act = 'addScale';
        add.onclick = () => { const n = rows.length + 1; rows.push({scale:n + 'x', suffix:'@' + n + 'x', key:'png'}); drawRows(); }; right.appendChild(add);
        addRows(right, api, [{k:'subfolders', label:tr('subfolders'), type:'check', value:!!saved.subfolders}, {k:'prefix', label:tr('prefix'), type:'text', value:saved.prefix || ''}]);
        api.rows = () => rows; show();
      },
      buttons:[{act:'cancel', label:tr('cancel')}, {act:'ok', label:tr('download'), pri:true}],
      ok:api => {
        if (!rows.length) return tr('addFormat');
        const formats = rows.map(r => { const m = /^jpg(\d+)$/.exec(r.key), row = {format:m ? 'jpg' : r.key, scale:r.scale, suffix:r.suffix}; if (m) row.quality = +m[1]; if (r.folder) row.folder = r.folder; return row; });
        const p = {formats, subfolders:api.get('subfolders'), prefix:api.get('prefix')};
        if (tab === 'assets'){ if (!checked.size) return tr('noAssets'); p.assets = Array.from(checked); }
        else { const s = api.get('select'); if (s === 'full') p.fullDocument = true; else if (s === 'range'){ if (!rangeOk(api.get('range'))) return tr('badRange'); p.range = api.get('range'); } p.includeBleed = api.get('includeBleed'); }
        const pr = api.get('preset'); if (pr && formats.every((f, i) => { const pp = presetRows(pr)[i]; return pp && pp.scale === f.scale; }) && formats.length === presetRows(pr).length){ /* 照预设记 */ }
        return exportForScreens(p, 'ai.file.exportForScreens');
      }});
  },
  /* 存储为 Web 所用格式（save_for_web.rs）：双联预览＋设定栏 */
  saveForWeb(){
    let st = Object.assign(WEB0(), AiFile.web || {}), seq = 0, url = null;
    const preview = async api => {
      const my = ++seq; let e;
      try { e = await webEncode(st); } catch (x){ api.error(x.message); return; }
      if (my !== seq) return; api.error('');
      const oc = api.F.orig; oc.width = e.original.width; oc.height = e.original.height; oc.getContext('2d').clearRect(0, 0, oc.width, oc.height); oc.getContext('2d').drawImage(e.original, 0, 0);
      if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(new Blob([e.data], {type:e.mime})); api.F.opt.src = url;
      const kb = (e.data.length / 1024).toFixed(1), sec = Math.max(1, Math.ceil(e.data.length * 8 / 1000 / 56.6));
      api.F.optCap.textContent = `${({gif:'GIF', jpg:'JPEG', png8:'PNG-8', png24:'PNG-24'})[st.format]}  ${kb}K  ${tr('secs', {n:sec, k:'56.6'})}`;
      api.F.optCap.dataset.bytes = e.data.length;
    };
    const sync = api => { ['format', 'reduction', 'colors', 'dither', 'ditherAmount', 'matte', 'quality', 'percent'].forEach(k => { if (api.F[k]){ const v = api.get(k); st[k] = (k === 'colors' || k === 'ditherAmount' || k === 'quality') ? num(v, st[k]) : k === 'percent' ? (v ? num(v, null) : null) : v; } });
      ['transparency', 'interlaced', 'clipToArtboard'].forEach(k => { if (api.F[k]) st[k] = api.get(k); }); st.antiAlias = api.get('antiAlias'); preview(api); };
    Dlg.open({id:'saveForWeb', title:tr('sfwT'), width:860,
      body:(bd, api) => {
        const wrap = document.createElement('div'); wrap.style.display = 'flex'; wrap.style.gap = '14px'; bd.appendChild(wrap);
        const pv = document.createElement('div'); pv.className = 'pv'; pv.style.flex = '1'; wrap.appendChild(pv);
        const p1 = document.createElement('div'), p2 = document.createElement('div'); pv.appendChild(p1); pv.appendChild(p2);
        p1.innerHTML = `<div class="cap">${esc(tr('vOriginal'))}</div>`; p2.innerHTML = `<div class="cap">${esc(tr('vOptimized'))}</div>`;
        api.F.orig = document.createElement('canvas'); p1.appendChild(api.F.orig); api.F.opt = document.createElement('img'); api.F.opt.dataset.k = 'optimized'; p2.appendChild(api.F.opt);
        api.F.optCap = document.createElement('div'); api.F.optCap.className = 'cap'; api.F.optCap.dataset.k = 'optCap'; p2.appendChild(api.F.optCap);
        const side = document.createElement('div'); side.style.width = '300px'; wrap.appendChild(side);
        const ch = () => sync(api);
        addRows(side, api, [{k:'preset', label:tr('presetL'), type:'select', value:'', options:[['', '—']].concat(WEB_PRESETS.map(x => [x[0], x[0]])),
            change:(v, a) => { if (!v) return; st = Object.assign(WEB0(), WEB_PRESETS.find(x => x[0] === v)[1]); ['format', 'reduction', 'colors', 'dither', 'ditherAmount', 'matte', 'quality', 'transparency', 'interlaced'].forEach(k => a.set(k, st[k])); preview(a); }},
          {k:'format', label:tr('format'), type:'select', value:st.format, options:[['gif', 'GIF'], ['jpg', 'JPEG'], ['png8', 'PNG-8'], ['png24', 'PNG-24']], change:ch},
          {k:'reduction', label:tr('reduction'), type:'select', value:st.reduction, options:opt([['perceptual', 'redPerceptual'], ['selective', 'redSelective'], ['adaptive', 'redAdaptive'], ['web', 'redWeb'], ['blackWhite', 'redBW'], ['gray', 'redGray']]), change:ch},
          {k:'colors', label:tr('colors'), type:'number', value:st.colors, min:2, max:256, change:ch},
          {k:'dither', label:tr('dither'), type:'select', value:st.dither, options:opt([['none', 'dNone'], ['diffusion', 'dDiff'], ['pattern', 'dPat'], ['noise', 'dNoise']]), change:ch},
          {k:'ditherAmount', label:tr('ditherAmt'), type:'number', value:st.ditherAmount, min:0, max:100, change:ch},
          {k:'transparency', label:tr('transparency'), type:'check', value:st.transparency, change:ch},
          {k:'matte', label:tr('matte'), type:'select', value:st.matte, options:[['none', tr('none')], ['white', tr('bgW')], ['black', tr('bgB')]], change:ch},
          {k:'interlaced', label:tr('interlaced'), type:'check', value:st.interlaced, change:ch},
          {k:'quality', label:tr('quality'), type:'number', value:st.quality, min:0, max:100, change:ch},
          {type:'sec', label:tr('imgSize')}, {k:'percent', label:tr('percent'), type:'number', value:st.percent || 100, min:1, max:6400, change:ch},
          {k:'antiAlias', label:tr('aa'), type:'select', value:st.antiAlias, options:opt([['none', 'aaNone'], ['art', 'aaArt'], ['type', 'aaType']]), change:ch},
          {k:'clipToArtboard', label:tr('clipAb'), type:'check', value:st.clipToArtboard, change:ch}]);
        api.st = () => st;
        preview(api);
      },
      buttons:[{act:'cancel', label:tr('cancel')}, {act:'discard', label:tr('done')}, {act:'ok', label:tr('download'), pri:true}],
      ok:() => CMD.run('ai.file.saveForWeb', Object.assign({}, st)),
      discard:() => { AiFile.web = Object.assign({}, st); return {ok:true}; },
      cancel:() => { if (url) URL.revokeObjectURL(url); }});
  },
  pkg(){
    Dlg.open({id:'package', title:tr('pkgT'), width:440,
      body:(bd, api) => addRows(bd, api, [{k:'name', label:tr('folderName'), type:'text', value:docStem() + tr('folderSuffix')}, {type:'sec', label:tr('options')},
        {k:'copyLinks', label:tr('copyLinks'), type:'check', value:true}, {k:'linksFolder', label:tr('linksFolder'), type:'check', value:true}, {k:'relink', label:tr('relink'), type:'check', value:true},
        {k:'copyFonts', label:tr('copyFonts'), type:'check', value:true}, {k:'report', label:tr('report'), type:'check', value:true}, {type:'note', label:tr('fontNote')}]),
      buttons:[{act:'cancel', label:tr('cancel')}, {act:'ok', label:tr('pkgT'), pri:true}],
      ok:api => CMD.run('ai.file.package', {name:api.get('name'), copyLinks:api.get('copyLinks'), linksFolder:api.get('linksFolder'), relink:api.get('relink'), copyFonts:api.get('copyFonts'), report:api.get('report')})});
  },
  /* 文档设置（document_setup.rs 三页） */
  setup(){
    const s = setup();
    Dlg.open({id:'documentSetup', title:tr('dsT'), width:560,
      body:(bd, api) => {
        const tabs = document.createElement('div'); tabs.className = 'tabs'; bd.appendChild(tabs);
        const panes = {general:document.createElement('div'), transparency:document.createElement('div'), type:document.createElement('div')};
        [['general', 'tabGeneral'], ['transparency', 'tabTransp'], ['type', 'tabType']].forEach(([k, t]) => { const b = document.createElement('button'); b.textContent = tr(t); b.dataset.tab = k;
          b.onclick = () => { Object.keys(panes).forEach(x => { panes[x].style.display = x === k ? '' : 'none'; }); tabs.querySelectorAll('button').forEach(z => z.classList.toggle('on', z === b)); };
          tabs.appendChild(b); bd.appendChild(panes[k]); });
        const gp = GRID_PRESETS.find(x => x[1][0] === s.gridColors[0] && x[1][1] === s.gridColors[1]);
        addRows(panes.general, api, [{k:'units', label:tr('units'), type:'select', value:s.units, options:UNITS.map(u => [u, UNIT_ZH[u][Lang.cur] || u])},
          {k:'bleedTop', label:tr('bleed') + ' ' + tr('top'), type:'number', value:s.bleed[0], min:0, max:72, after:'pt'}, {k:'bleedBottom', label:tr('bottom'), type:'number', value:s.bleed[1], min:0, max:72, after:'pt'},
          {k:'bleedLeft', label:tr('left'), type:'number', value:s.bleed[2], min:0, max:72, after:'pt'}, {k:'bleedRight', label:tr('right'), type:'number', value:s.bleed[3], min:0, max:72, after:'pt'},
          {k:'outlineImages', label:tr('outlineImages'), type:'check', value:s.outlineImages}, {k:'highlightSubstitutedFonts', label:tr('hlFonts'), type:'check', value:s.highlightSubstitutedFonts},
          {k:'highlightSubstitutedGlyphs', label:tr('hlGlyphs'), type:'check', value:s.highlightSubstitutedGlyphs},
          {k:'backgroundContents', label:tr('bgContents'), type:'select', value:s.backgroundContents, options:[['transparent', tr('bgT')], ['white', tr('bgW')]]}]);
        const eb = document.createElement('button'); eb.textContent = tr('editArtboards'); eb.dataset.act = 'editArtboards';
        eb.onclick = () => { Dlg.ok().then(() => { try { if (!Dlg.cur && window.UI && UI.pick) UI.pick('crop'); } catch (_){} }); }; panes.general.appendChild(eb);   // 先套设定，再换「画板」工具（我们用裁剪工具改画布）
        addRows(panes.transparency, api, [{type:'sec', label:tr('gridH')}, {k:'gridSize', label:tr('gridSize'), type:'select', value:s.gridSize, options:opt([['small', 'gsSmall'], ['medium', 'gsMedium'], ['large', 'gsLarge']])},
          {k:'gridColors', label:tr('gridColors'), type:'select', value:gp ? gp[0] : 'Custom', options:GRID_PRESETS.map(x => [x[0], tr('gc' + x[0])]).concat([['Custom', tr('gcCustom')]])},
          {k:'simulatePaper', label:tr('simPaper'), type:'check', value:s.simulatePaper}, {type:'sec', label:tr('flatH')},
          {k:'flattenerPreset', label:tr('flatPreset'), type:'select', value:s.flattenerPreset, options:[['High Resolution', tr('flatHigh')], ['Medium Resolution', tr('flatMed')], ['Low Resolution', tr('flatLow')]]},
          {k:'discardWhiteOverprint', label:tr('discardWhite'), type:'check', value:s.discardWhiteOverprint}]);
        addRows(panes.type, api, [{k:'language', label:tr('language'), type:'select', value:s.language, options:LANGUAGES.map(l => [l[0], l[0]]),
            change:(v, a) => { const l = LANGUAGES.find(x => x[0] === v); if (l){ a.set('dq', l[1]); a.set('sq', l[2]); } }},
          {k:'dq', label:tr('dquotes'), type:'select', value:s.quotes.double, options:DQ.map(q => [q, q])}, {k:'sq', label:tr('squotes'), type:'select', value:s.quotes.single, options:SQ.map(q => [q, q])},
          {k:'typographersQuotes', label:tr('typoQuotes'), type:'check', value:s.typographersQuotes}, {type:'sec', label:tr('options')},
          {k:'supSize', label:tr('superscript') + ' ' + tr('sizeCol'), type:'number', value:s.superscript.size, after:'%'}, {k:'supPos', label:tr('posCol'), type:'number', value:s.superscript.position, after:'%'},
          {k:'subSize', label:tr('subscript') + ' ' + tr('sizeCol'), type:'number', value:s.subscript.size, after:'%'}, {k:'subPos', label:tr('posCol'), type:'number', value:s.subscript.position, after:'%'},
          {k:'smallCapsSize', label:tr('smallCaps'), type:'number', value:s.smallCapsSize, after:'%'},
          {k:'exportText', label:tr('exportTextL'), type:'select', value:s.exportText, options:opt([['editable', 'etEditable'], ['appearance', 'etAppearance']])}]);
        tabs.querySelector('button').click();
      },
      ok:api => {
        const gc = api.get('gridColors'), p = {units:api.get('units'), bleed:[api.get('bleedTop'), api.get('bleedBottom'), api.get('bleedLeft'), api.get('bleedRight')].map(v => num(v, 0)),
          outlineImages:api.get('outlineImages'), highlightSubstitutedFonts:api.get('highlightSubstitutedFonts'), highlightSubstitutedGlyphs:api.get('highlightSubstitutedGlyphs'),
          backgroundContents:api.get('backgroundContents'), gridSize:api.get('gridSize'), simulatePaper:api.get('simulatePaper'), flattenerPreset:api.get('flattenerPreset'),
          discardWhiteOverprint:api.get('discardWhiteOverprint'), language:api.get('language'), quotes:{double:api.get('dq'), single:api.get('sq')}, typographersQuotes:api.get('typographersQuotes'),
          superscript:{size:num(api.get('supSize'), 58.3), position:num(api.get('supPos'), 33.3)}, subscript:{size:num(api.get('subSize'), 58.3), position:num(api.get('subPos'), 33.3)},
          smallCapsSize:num(api.get('smallCapsSize'), 70), exportText:api.get('exportText')};
        if (gc !== 'Custom') p.gridColors = gc;
        return CMD.run('ai.document.setup', p);
      }});
  },
  /* 文件信息（file_info.rs：评分星星、关键字小牌） */
  fileInfo(){
    const I = infoReport(); let kws = I.keywords.slice(), rating = I.rating;
    const fmtD = v => v ? v.replace('T', ' ').replace(/Z$/, '') + ' UTC' : '—';
    Dlg.open({id:'fileInfo', title:tr('fiT'), width:520,
      body:(bd, api) => {
        addRows(bd, api, [{k:'title', label:tr('docTitle'), type:'text', value:I.title}, {k:'author', label:tr('author'), type:'text', value:I.author}, {k:'authorTitle', label:tr('authorTitle'), type:'text', value:I.authorTitle},
          {k:'description', label:tr('descr'), type:'textarea', value:I.description}]);
        const rr = document.createElement('div'); rr.className = 'row'; rr.innerHTML = `<span>${esc(tr('rating'))}</span><span class="stars"></span>`; bd.appendChild(rr);
        const stars = rr.querySelector('.stars'); const draw = () => { stars.innerHTML = ''; for (let i = 1; i <= 5; i++){ const sp = document.createElement('span'); sp.textContent = '★'; sp.dataset.star = i; if (i <= rating) sp.className = 'on';
          sp.onclick = () => { rating = rating === i ? 0 : i; draw(); }; stars.appendChild(sp); } }; draw();
        const kr = document.createElement('div'); kr.className = 'row'; kr.innerHTML = `<span>${esc(tr('keywords'))}</span><span class="chips"></span>`; bd.appendChild(kr);
        const chips = kr.querySelector('.chips'), drawK = () => { chips.innerHTML = ''; kws.forEach((k, i) => { const c = document.createElement('span'); c.textContent = k; const x = document.createElement('b'); x.textContent = '×'; x.onclick = () => { kws.splice(i, 1); drawK(); }; c.appendChild(x); chips.appendChild(c); }); }; drawK();
        const addK = () => { const v = api.get('__keyword'); String(v || '').split(/[,;]/).map(s => s.trim()).filter(Boolean).forEach(w => { if (!kws.some(o => o.toLowerCase() === w.toLowerCase())) kws.push(w); }); api.set('__keyword', ''); drawK(); };
        addRows(bd, api, [{k:'__keyword', label:'', type:'text', value:''}]);
        const kin = api.F.__keyword; kin.dataset.noenter = '1'; kin.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); addK(); } });
        const ab = document.createElement('button'); ab.textContent = tr('add'); ab.dataset.act = 'addKeyword'; ab.onclick = addK; kin.parentNode.appendChild(ab);
        addRows(bd, api, [{type:'note', label:tr('kwHint')}, {type:'sec', label:tr('copyright')},
          {k:'copyrightStatus', label:tr('crStatus'), type:'select', value:I.copyrightStatus, options:opt([['unknown', 'crUnknown'], ['copyrighted', 'crCopyrighted'], ['publicDomain', 'crPublic']])},
          {k:'copyrightNotice', label:tr('crNotice'), type:'textarea', value:I.copyrightNotice, rows:2}, {k:'copyrightUrl', label:tr('crUrl'), type:'text', value:I.copyrightUrl},
          {type:'sec', label:tr('dates')}, {type:'note', label:tr('created') + ' ' + fmtD(I.created)}, {type:'note', label:tr('modified') + ' ' + fmtD(I.modified)}]);
        api.addK = addK; api.kws = () => kws;
      },
      ok:api => { api.addK();                                              // 打了没按「添加」的关键字也留着
        return CMD.run('ai.file.info', {title:api.get('title'), author:api.get('author'), authorTitle:api.get('authorTitle'), description:api.get('description'), keywords:kws.slice(), rating,
          copyrightStatus:api.get('copyrightStatus'), copyrightNotice:api.get('copyrightNotice'), copyrightUrl:api.get('copyrightUrl')}); }});
  },
  print(){
    const st = Object.assign(PRINT0(), Doc.aiPrint || {}), keep = api => ({media:api.get('media'), orientation:api.get('orientation'), scaling:api.get('scaling'), scale:num(api.get('scale'), 100), ppi:num(api.get('ppi'), 300)});
    Dlg.open({id:'print', title:tr('printT'), width:440,
      body:(bd, api) => addRows(bd, api, [{k:'printer', label:tr('printer'), type:'select', value:'browser', options:[['browser', tr('printerBrowser')]]},
        {k:'copies', label:tr('copies'), type:'number', value:1, min:1, disabled:true, after:tr('copiesNote')},
        {k:'all', label:tr('artboard') + '：', type:'radio', value:'all', options:[['all', tr('all')], ['range', tr('range')]]}, {k:'range', label:'', type:'text', value:'1'},
        {k:'media', label:tr('media'), type:'select', value:st.media, options:[['driver', tr('mDriver')], ['letter', 'Letter'], ['legal', 'Legal'], ['tabloid', 'Tabloid'], ['a4', 'A4'], ['a3', 'A3'], ['a5', 'A5']]},
        {k:'orientation', label:tr('orientation'), type:'select', value:st.orientation, options:opt([['auto', 'oAuto'], ['portrait', 'oPortrait'], ['landscape', 'oLandscape']])},
        {k:'scaling', label:tr('scaling'), type:'select', value:st.scaling, options:opt([['none', 'sNone'], ['fit', 'sFit'], ['custom', 'sCustom']])},
        {k:'scale', label:'', type:'number', value:st.scale, min:1, max:1000, after:'%'}, {k:'ppi', label:tr('printRes'), type:'number', value:st.ppi, min:36, max:1200, after:'ppi'}]),
      buttons:[{act:'cancel', label:tr('cancel')}, {act:'discard', label:tr('done')}, {act:'ok', label:tr('printBtn'), pri:true}],
      ok:api => { if (api.get('all') === 'range' && !rangeOk(api.get('range'))) return tr('badRange'); return CMD.run('ai.file.print', keep(api)); },
      discard:api => { Doc.aiPrint = keep(api); return {ok:true}; }});
  }
};
AiFile.dialogs = Dialogs;

/* ═══════════ 首页、提示、画布底色（文档设置的透明度网格／模拟彩纸） ═══════════ */
function tplInput(){
  let i = document.getElementById('aiTplInput');
  if (!i){
    i = document.createElement('input'); i.type = 'file'; i.id = 'aiTplInput'; i.accept = '.dlcanvas,.dltemplate,.json,application/json'; i.style.display = 'none'; document.body.appendChild(i);
    i.onchange = () => { const f = i.files[0]; if (!f) return; f.text().then(t => CMD.run('ai.file.newFromTemplate', {data:t})).catch(e => toast(e.message)); i.value = ''; };
  }
  return i;
}
function showHome(){
  const wrap = document.getElementById('canvasWrap'); if (!wrap) return;
  ensureStyle();
  let h = document.getElementById('aiHome');
  if (!h){
    h = document.createElement('div'); h.id = 'aiHome'; wrap.appendChild(h);
    h.addEventListener('pointerdown', e => e.stopPropagation());
  }
  h.innerHTML = `<div class="h">${esc(tr('noDoc'))}</div><div class="b"><button data-act="new">${esc(tr('homeNew'))}</button><button data-act="open">${esc(tr('homeOpen'))}</button>`
    + `<button data-act="tpl">${esc(tr('homeTpl'))}</button><button data-act="blank">${esc(tr('homeBlank'))}</button></div>`;
  h.querySelectorAll('button').forEach(b => b.onclick = () => {
    const a = b.dataset.act; hideHome();
    if (a === 'new') CMD.run('file.new', {}); else if (a === 'open') CMD.run('file.openProject'); else if (a === 'tpl') CMD.run('ai.file.newFromTemplate');
    if (window.UI && UI.draw) UI.draw();
  });
  h.style.display = 'flex'; AiFile.homeShown = true;
}
function hideHome(){ const h = document.getElementById('aiHome'); if (h) h.style.display = 'none'; AiFile.homeShown = false; }
let _toastT = null;
function toast(m){
  if (!document.body) return; ensureStyle();
  let t = document.getElementById('aifToast'); if (!t){ t = document.createElement('div'); t.id = 'aifToast'; document.body.appendChild(t); }
  t.textContent = m; t.style.opacity = '1'; clearTimeout(_toastT); _toastT = setTimeout(() => { t.style.opacity = '0'; }, 2400);
}
/* 文档设置的透明度网格（格子大小、两色）与模拟彩纸：只在 AI 模式、而且这份文件设过文档设置时换掉 #view 的底 */
function applyViewBg(){
  const v = document.getElementById('view'); if (!v) return;
  const ai = window.Menubar ? Menubar.app === 'ai' : false;
  if (!ai || !Doc.aiSetup){ if (v.dataset.aiBg){ v.style.background = ''; delete v.dataset.aiBg; } return; }
  const s = setup(), c = GRID_CELL[s.gridSize] || 8, [a, b] = s.gridColors;
  v.style.background = s.simulatePaper ? a : `repeating-conic-gradient(${a} 0 25%, ${b} 0 50%) 0 0 / ${c * 2}px ${c * 2}px`;
  v.dataset.aiBg = s.simulatePaper ? 'paper' : 'grid';
}
AiFile.applyViewBg = applyViewBg;

/* ═══════════ 本菜单的快捷键（AI 模式＝当前层是矢量层时；照菜单树上写的 key） ═══════════ */
const CODE = c => /^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5)
  : ({BracketLeft:'[', BracketRight:']', Semicolon:';', Quote:"'", Equal:'=', Minus:'-', Comma:',', Period:'.', Slash:'/', Backslash:'\\'})[c] || null;
const comboOf = e => [(e.ctrlKey || e.metaKey) ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '',
  CODE(e.code) || (e.key && e.key.length === 1 ? e.key.toUpperCase() : e.key)].filter(Boolean).join('+');
const normKey = k => { const p = k.split('+'), key = p.pop(); return ['Ctrl', 'Alt', 'Shift'].filter(m => p.includes(m)).concat([key.length === 1 ? key.toUpperCase() : key]).join('+'); };
window.addEventListener('keydown', e => {
  if (!window.Menubar || Menubar.app !== 'ai' || !MenuTrees.ai || !MenuTrees.ai.file) return;
  if (typing(e.target)) return;
  if (document.querySelector('.aifdlg-back,.aidlg-back,.aivdlg-back')) return;
  const c = comboOf(e); let hit = null;
  const go = items => items.forEach(it => { if (hit || it.sep) return; if (it.key && normKey(it.key) === c && Menubar.enabled(it)) hit = it; if (it.sub) go(it.sub); });
  go(MenuTrees.ai.file.items);
  if (!hit) return;
  e.preventDefault(); e.stopImmediatePropagation();
  Menubar.run(hit);
}, true);

/* ═══════════ 起始 ═══════════ */
if (!AiFile.title && Doc.layers.length){ newUntitled(); if (!Doc.aiInfo) freshMeta(); AiFile.markClean(); }   // 页面已开好才补；还在载入（ui.js 待会 file.new）就交给 Doc.reset 钩子
syncRecentMenu();
refreshRecent();
function lateHooks(){
  if (window.Menubar && !Menubar.__aiFileHook){ Menubar.__aiFileHook = true; const b = Menubar.build; Menubar.build = function(){ const r = b.apply(this, arguments); applyViewBg(); return r; }; }
  setTitle(); applyViewBg();
}
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', lateHooks); else lateHooks();

})();
