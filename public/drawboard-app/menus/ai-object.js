/* 堤麟画板 · 菜单树 · Illustrator ▸ 对象（照 vectorcraft menus.rs menu_tree() 抄；三语照 AI 2020 繁／简中介面）*/
MenuTrees.add('ai', 'object', {
  n:{'zh-Hant':'物件', 'zh-Hans':'对象', en:'Object'},
  items:[
    {n:{'zh-Hant':'變形', 'zh-Hans':'变换', en:'Transform'}, sub:[
      {n:{'zh-Hant':'再次變形', 'zh-Hans':'再次变换', en:'Transform Again'}, id:'object.transformAgain', key:'Ctrl+D', impl:'ai.object.transformAgain'},
      {sep:true},
      // 变换五项走对话框（menus/impl/ai-object.js，照 vectorcraft dialogs/transform.rs），确定＝ai.object.move／rotate／reflect／scale／shear（作用在选中的物件，不是整层）
      {n:{'zh-Hant':'移動…', 'zh-Hans':'移动…', en:'Move…'}, id:'object.move', key:'Ctrl+Shift+M', impl:'ai.object.move.dialog'},
      {n:{'zh-Hant':'旋轉…', 'zh-Hans':'旋转…', en:'Rotate…'}, id:'object.rotate', impl:'ai.object.rotate.dialog'},
      {n:{'zh-Hant':'鏡射…', 'zh-Hans':'对称…', en:'Reflect…'}, id:'object.reflect', impl:'ai.object.reflect.dialog'},
      {n:{'zh-Hant':'縮放…', 'zh-Hans':'缩放…', en:'Scale…'}, id:'object.scale', impl:'ai.object.scale.dialog'},
      {n:{'zh-Hant':'傾斜…', 'zh-Hans':'倾斜…', en:'Shear…'}, id:'object.shear', impl:'ai.object.shear.dialog'},
      {sep:true},
      {n:{'zh-Hant':'個別變形…', 'zh-Hans':'分别变换…', en:'Transform Each…'}, id:'object.transformEach', key:'Ctrl+Alt+Shift+D', impl:'ai.object.transformEach.dialog'},
      {sep:true},
      {n:{'zh-Hant':'重設邊框', 'zh-Hans':'重置定界框', en:'Reset Bounding Box'}, id:'object.resetBoundingBox', impl:'ai.object.resetBoundingBox'},
    ]},
    {n:{'zh-Hant':'排列順序', 'zh-Hans':'排列', en:'Arrange'}, sub:[
      {n:{'zh-Hant':'移至最前', 'zh-Hans':'置于顶层', en:'Bring to Front'}, id:'object.arrange.bringToFront', key:'Ctrl+Shift+]', impl:'ai.object.arrange.bringToFront'},
      // 作用在层内物件的前后序（ai.object.arrange.*，照 object.rs:318 arrange）
      {n:{'zh-Hant':'向前移', 'zh-Hans':'前移一层', en:'Bring Forward'}, id:'object.arrange.bringForward', key:'Ctrl+]', impl:'ai.object.arrange.bringForward'},
      {n:{'zh-Hant':'向後移', 'zh-Hans':'后移一层', en:'Send Backward'}, id:'object.arrange.sendBackward', key:'Ctrl+[', impl:'ai.object.arrange.sendBackward'},
      {n:{'zh-Hant':'移至最後', 'zh-Hans':'置于底层', en:'Send to Back'}, id:'object.arrange.sendToBack', key:'Ctrl+Shift+[', impl:'ai.object.arrange.sendToBack'},
      {sep:true},
      {n:{'zh-Hant':'傳送至目前圖層', 'zh-Hans':'发送至当前图层', en:'Send to Current Layer'}, id:'object.arrange.sendToCurrentLayer', impl:'ai.object.arrange.sendToCurrentLayer'},
    ]},
    // 原码六项同为 object.align，参数 {horizontal:"left|center|right"}／{vertical:"top|center|bottom"}；拆成不同 id 免得重复；对到 ai.object.align（选中物件互相对齐）
    {n:{'zh-Hant':'對齊', 'zh-Hans':'对齐', en:'Align'}, sub:[
      {n:{'zh-Hant':'水平齊左', 'zh-Hans':'水平左对齐', en:'Horizontal Align Left'}, id:'object.align.left', impl:{cmd:'ai.object.align', params:{horizontal:'left'}}},
      {n:{'zh-Hant':'水平居中', 'zh-Hans':'水平居中对齐', en:'Horizontal Align Center'}, id:'object.align.hcenter', impl:{cmd:'ai.object.align', params:{horizontal:'center'}}},
      {n:{'zh-Hant':'水平齊右', 'zh-Hans':'水平右对齐', en:'Horizontal Align Right'}, id:'object.align.right', impl:{cmd:'ai.object.align', params:{horizontal:'right'}}},
      {n:{'zh-Hant':'垂直齊上', 'zh-Hans':'垂直顶对齐', en:'Vertical Align Top'}, id:'object.align.top', impl:{cmd:'ai.object.align', params:{vertical:'top'}}},
      {n:{'zh-Hant':'垂直居中', 'zh-Hans':'垂直居中对齐', en:'Vertical Align Center'}, id:'object.align.vcenter', impl:{cmd:'ai.object.align', params:{vertical:'center'}}},
      {n:{'zh-Hant':'垂直齊下', 'zh-Hans':'垂直底对齐', en:'Vertical Align Bottom'}, id:'object.align.bottom', impl:{cmd:'ai.object.align', params:{vertical:'bottom'}}},
    ]},
    {sep:true},
    {n:{'zh-Hant':'組成群組', 'zh-Hans':'编组', en:'Group'}, id:'object.group', key:'Ctrl+G', impl:'ai.object.group'},
    {n:{'zh-Hant':'解散群組', 'zh-Hans':'取消编组', en:'Ungroup'}, id:'object.ungroup', key:'Ctrl+Shift+G', impl:'ai.object.ungroup'},
    {n:{'zh-Hant':'鎖定', 'zh-Hans':'锁定', en:'Lock'}, sub:[
      {n:{'zh-Hant':'選取範圍', 'zh-Hans':'所选对象', en:'Selection'}, id:'object.lock', key:'Ctrl+2', impl:'ai.object.lock'},
      {n:{'zh-Hant':'上方所有圖稿', 'zh-Hans':'上方所有图稿', en:'All Artwork Above'}, id:'object.lock.above', impl:'ai.object.lock.above'},
      {n:{'zh-Hant':'其他圖層', 'zh-Hans':'其它图层', en:'Other Layers'}, id:'object.lock.otherLayers', impl:'ai.object.lock.otherLayers'},
    ]},
    {n:{'zh-Hant':'全部解除鎖定', 'zh-Hans':'全部解锁', en:'Unlock All'}, id:'object.unlockAll', key:'Ctrl+Alt+2', impl:'ai.object.unlockAll'},
    {n:{'zh-Hant':'隱藏', 'zh-Hans':'隐藏', en:'Hide'}, sub:[
      {n:{'zh-Hant':'選取範圍', 'zh-Hans':'所选对象', en:'Selection'}, id:'object.hide', key:'Ctrl+3', impl:'ai.object.hide'},
      {n:{'zh-Hant':'上方所有圖稿', 'zh-Hans':'上方所有图稿', en:'All Artwork Above'}, id:'object.hide.above', impl:'ai.object.hide.above'},
      {n:{'zh-Hant':'其他圖層', 'zh-Hans':'其它图层', en:'Other Layers'}, id:'object.hide.otherLayers', impl:'ai.object.hide.otherLayers'},
    ]},
    {n:{'zh-Hant':'顯示全部', 'zh-Hans':'显示全部', en:'Show All'}, id:'object.showAll', key:'Ctrl+Alt+3', impl:'ai.object.showAll'},
    {sep:true},
    {n:{'zh-Hant':'展開…', 'zh-Hans':'扩展…', en:'Expand…'}, id:'ui.expandDialog', impl:'ai.object.expand.dialog'},
    {n:{'zh-Hant':'擴充外觀', 'zh-Hans':'扩展外观', en:'Expand Appearance'}, id:'effect.expandAppearance', impl:'ai.effect.expandAppearance'},
    {n:{'zh-Hant':'裁切影像', 'zh-Hans':'裁剪图像', en:'Crop Image'}, id:'object.cropImage', impl:'ai.object.cropImage'},
    // layer.rasterize：向量／文字层算成像素层（整层，非单个形状）
    {n:{'zh-Hant':'點陣化…', 'zh-Hans':'栅格化…', en:'Rasterize…'}, id:'object.rasterize', impl:'layer.rasterize'},
    {n:{'zh-Hant':'建立漸層網格…', 'zh-Hans':'创建渐变网格…', en:'Create Gradient Mesh…'}, id:'object.mesh.create', impl:'ai.object.mesh.create.dialog'},
    {n:{'zh-Hant':'建立物件馬賽克…', 'zh-Hans':'创建对象马赛克…', en:'Create Object Mosaic…'}, id:'object.createObjectMosaic', impl:'ai.object.createObjectMosaic.dialog'},
    {n:{'zh-Hant':'向量網屏…', 'zh-Hans':'矢量半调…', en:'Vector Halftone…'}, id:'object.vectorHalftone', impl:'ai.object.vectorHalftone.dialog'},
    {n:{'zh-Hant':'建立剪裁標記', 'zh-Hans':'创建裁切标记', en:'Create Trim Marks'}, id:'object.createTrimMarks', impl:'ai.object.createTrimMarks'},
    {n:{'zh-Hant':'透明度平面化…', 'zh-Hans':'拼合透明度…', en:'Flatten Transparency…'}, id:'ui.flattenTransparencyDialog', impl:'ai.ui.flattenTransparencyDialog'},
    {sep:true},
    {n:{'zh-Hant':'設為像素完美', 'zh-Hans':'使像素完美', en:'Make Pixel Perfect'}, id:'object.makePixelPerfect', impl:'ai.object.makePixelPerfect'},
    {sep:true},
    {n:{'zh-Hant':'切片', 'zh-Hans':'切片', en:'Slice'}, sub:[
      {n:{'zh-Hant':'製作', 'zh-Hans':'建立', en:'Make'}, id:'object.slice.make', impl:'ai.object.slice.make'},
      {n:{'zh-Hant':'釋放', 'zh-Hans':'释放', en:'Release'}, id:'object.slice.release', impl:'ai.object.slice.release'},
      {n:{'zh-Hant':'從參考線建立', 'zh-Hans':'从参考线创建', en:'Create from Guides'}, id:'object.slice.fromGuides', impl:'ai.object.slice.fromGuides'},
      {n:{'zh-Hant':'從選取範圍建立', 'zh-Hans':'从所选对象创建', en:'Create from Selection'}, id:'object.slice.fromSelection', impl:'ai.object.slice.fromSelection'},
      {sep:true},
      {n:{'zh-Hant':'複製切片', 'zh-Hans':'复制切片', en:'Duplicate Slice'}, id:'object.slice.duplicate', impl:'ai.object.slice.duplicate'},
      {n:{'zh-Hant':'組合切片', 'zh-Hans':'组合切片', en:'Combine Slices'}, id:'object.slice.combine', impl:'ai.object.slice.combine'},
      {n:{'zh-Hant':'分割切片…', 'zh-Hans':'划分切片…', en:'Divide Slices…'}, id:'object.slice.divide', impl:'ai.object.slice.divide.dialog'},
      {sep:true},
      {n:{'zh-Hant':'全部刪除', 'zh-Hans':'全部删除', en:'Delete All'}, id:'object.slice.deleteAll', impl:'ai.object.slice.deleteAll'},
      {n:{'zh-Hant':'切片選項…', 'zh-Hans':'切片选项…', en:'Slice Options…'}, id:'object.slice.options', impl:'ai.object.slice.options.dialog'},
      {n:{'zh-Hant':'剪裁至工作區域', 'zh-Hans':'剪切到画板', en:'Clip to Artboard'}, id:'object.slice.clipToArtboard', check:true, impl:{cmd:'ai.object.slice.clipToArtboard', checked:() => !!(window.AiR3 && AiR3.doc('slices').clip)}},
    ]},
    {sep:true},
    {n:{'zh-Hant':'路徑', 'zh-Hans':'路径', en:'Path'}, sub:[
      {n:{'zh-Hant':'合併', 'zh-Hans':'连接', en:'Join'}, id:'path.join', key:'Ctrl+J', impl:'ai.path.join'},
      {n:{'zh-Hant':'平均…', 'zh-Hans':'平均…', en:'Average…'}, id:'path.average', key:'Ctrl+Alt+J', impl:'ai.path.average.dialog'},
      {sep:true},
      {n:{'zh-Hant':'外框筆畫', 'zh-Hans':'轮廓化描边', en:'Outline Stroke'}, id:'object.path.outlineStroke', impl:'ai.object.path.outlineStroke'},
      {n:{'zh-Hant':'位移路徑…', 'zh-Hans':'偏移路径…', en:'Offset Path…'}, id:'object.path.offsetPath', impl:'ai.object.path.offsetPath.dialog'},
      // ai.path.reverse 照选取做（pen.reverse 要带 shapeId，菜单点了没参数会失败）
      {n:{'zh-Hant':'反轉路徑方向', 'zh-Hans':'反转路径方向', en:'Reverse Path Direction'}, id:'path.reverse', impl:'ai.path.reverse'},
      {sep:true},
      {n:{'zh-Hant':'簡化…', 'zh-Hans':'简化…', en:'Simplify…'}, id:'object.path.simplify', impl:'ai.object.path.simplify.dialog'},
      {n:{'zh-Hant':'增加錨點', 'zh-Hans':'添加锚点', en:'Add Anchor Points'}, id:'object.path.addAnchorPoints', impl:'ai.object.path.addAnchorPoints'},
      // direct.deleteAnchors 注明「照 path.deleteAnchors」
      {n:{'zh-Hant':'移除錨點', 'zh-Hans':'移去锚点', en:'Remove Anchor Points'}, id:'path.deleteAnchors', impl:'direct.deleteAnchors'},
      {n:{'zh-Hant':'分割下方物件', 'zh-Hans':'分割下方对象', en:'Divide Objects Below'}, id:'object.path.divideObjectsBelow', impl:'ai.object.path.divideObjectsBelow'},
      {n:{'zh-Hant':'分割為網格…', 'zh-Hans':'分割为网格…', en:'Split Into Grid…'}, id:'object.path.splitIntoGrid', impl:'ai.object.path.splitIntoGrid.dialog'},
      {sep:true},
      {n:{'zh-Hant':'清除…', 'zh-Hans':'清理…', en:'Clean Up…'}, id:'object.path.cleanUp', impl:'ai.object.path.cleanUp.dialog'},
    ]},
    {n:{'zh-Hant':'形狀', 'zh-Hans':'形状', en:'Shape'}, sub:[
      {n:{'zh-Hant':'轉換為形狀', 'zh-Hans':'转换为形状', en:'Convert to Shape'}, id:'object.shape.convertToShape', impl:'ai.object.shape.convertToShape'},
      // ai.object.expandShape 照选取做（vsel.toBezier 要带 shapeId）
      {n:{'zh-Hant':'展開形狀', 'zh-Hans':'扩展形状', en:'Expand Shape'}, id:'object.expandShape', impl:'ai.object.expandShape'},
    ]},
    {n:{'zh-Hant':'圖樣', 'zh-Hans':'图案', en:'Pattern'}, sub:[
      {n:{'zh-Hant':'製作', 'zh-Hans':'建立', en:'Make'}, id:'object.pattern.make', impl:'ai.object.pattern.make'},
      {n:{'zh-Hant':'編輯圖樣', 'zh-Hans':'编辑图案', en:'Edit Pattern'}, id:'object.pattern.edit', key:'Ctrl+Shift+F8', impl:'ai.object.pattern.edit'},
      {n:{'zh-Hant':'拼貼邊緣色彩…', 'zh-Hans':'拼贴边缘颜色…', en:'Tile Edge Color…'}, id:'ui.tileEdgeColor', impl:'ai.ui.tileEdgeColor.dialog'},
    ]},
    {n:{'zh-Hant':'重複', 'zh-Hans':'重复', en:'Repeat'}, sub:[
      {n:{'zh-Hant':'放射狀', 'zh-Hans':'径向', en:'Radial'}, id:'object.repeat.radial', impl:'ai.object.repeat.radial'},
      {n:{'zh-Hant':'格點', 'zh-Hans':'网格', en:'Grid'}, id:'object.repeat.grid', impl:'ai.object.repeat.grid'},
      {n:{'zh-Hant':'鏡像', 'zh-Hans':'镜像', en:'Mirror'}, id:'object.repeat.mirror', impl:'ai.object.repeat.mirror'},
      {sep:true},
      {n:{'zh-Hant':'釋放', 'zh-Hans':'释放', en:'Release'}, id:'object.repeat.release', impl:'ai.object.repeat.release'},
      {n:{'zh-Hant':'選項…', 'zh-Hans':'选项…', en:'Options…'}, id:'object.repeat.options', impl:'ai.object.repeat.options.dialog'},
    ]},
    {n:{'zh-Hant':'漸變', 'zh-Hans':'混合', en:'Blend'}, sub:[
      {n:{'zh-Hant':'製作', 'zh-Hans':'建立', en:'Make'}, id:'object.blend.make', key:'Ctrl+Alt+B', impl:'ai.object.blend.make'},
      {n:{'zh-Hant':'釋放', 'zh-Hans':'释放', en:'Release'}, id:'object.blend.release', key:'Ctrl+Alt+Shift+B', impl:'ai.object.blend.release'},
      {sep:true},
      {n:{'zh-Hant':'漸變選項…', 'zh-Hans':'混合选项…', en:'Blend Options…'}, id:'object.blend.options', impl:'ai.object.blend.options.dialog'},
      {sep:true},
      {n:{'zh-Hant':'展開', 'zh-Hans':'扩展', en:'Expand'}, id:'object.blend.expand', impl:'ai.object.blend.expand'},
      {sep:true},
      {n:{'zh-Hant':'取代旋轉軸', 'zh-Hans':'替换混合轴', en:'Replace Spine'}, id:'object.blend.replaceSpine', impl:'ai.object.blend.replaceSpine'},
      {n:{'zh-Hant':'反轉旋轉軸', 'zh-Hans':'反向混合轴', en:'Reverse Spine'}, id:'object.blend.reverseSpine', impl:'ai.object.blend.reverseSpine'},
      {n:{'zh-Hant':'反轉前後順序', 'zh-Hans':'反向堆叠', en:'Reverse Front to Back'}, id:'object.blend.reverseFrontToBack', impl:'ai.object.blend.reverseFrontToBack'},
    ]},
    {n:{'zh-Hant':'封套扭曲', 'zh-Hans':'封套扭曲', en:'Envelope Distort'}, sub:[
      // 原码 JSON 抽出两个 <dynamic>：第一个其实是一行注解（选中封套时「重设」取代「制作」），不是菜单项，删掉；
      // 第二个是「Make with Warp…」(object.envelope.makeWithWarp)，照 AI 2020 补上，快捷键 Alt+Shift+Ctrl+W
      {n:{'zh-Hant':'以彎曲製作…', 'zh-Hans':'用变形建立…', en:'Make with Warp…'}, id:'object.envelope.makeWithWarp', key:'Ctrl+Alt+Shift+W', impl:'ai.object.envelope.makeWithWarp.dialog'},
      {n:{'zh-Hant':'以彎曲重設…', 'zh-Hans':'用变形重置…', en:'Reset with Warp…'}, id:'object.envelope.resetWithWarp', impl:'ai.object.envelope.resetWithWarp.dialog'},
      {n:{'zh-Hant':'以網格製作…', 'zh-Hans':'用网格建立…', en:'Make with Mesh…'}, id:'object.envelope.makeWithMesh', key:'Ctrl+Alt+M', impl:'ai.object.envelope.makeWithMesh.dialog'},
      {n:{'zh-Hant':'以網格重設…', 'zh-Hans':'用网格重置…', en:'Reset with Mesh…'}, id:'object.envelope.resetWithMesh', impl:'ai.object.envelope.resetWithMesh.dialog'},
      {n:{'zh-Hant':'以上層物件製作', 'zh-Hans':'用顶层对象建立', en:'Make with Top Object'}, id:'object.envelope.makeWithTopObject', key:'Ctrl+Alt+C', impl:'ai.object.envelope.makeWithTopObject'},
      {sep:true},
      {n:{'zh-Hant':'釋放', 'zh-Hans':'释放', en:'Release'}, id:'object.envelope.release', impl:'ai.object.envelope.release'},
      {n:{'zh-Hant':'封套選項…', 'zh-Hans':'封套选项…', en:'Envelope Options…'}, id:'object.envelope.options', impl:'ai.object.envelope.options.dialog'},
      {n:{'zh-Hant':'展開', 'zh-Hans':'扩展', en:'Expand'}, id:'object.envelope.expand', impl:'ai.object.envelope.expand'},
      {sep:true},
      {n:{'zh-Hant':'編輯內容', 'zh-Hans':'编辑内容', en:'Edit Contents'}, id:'object.envelope.editContents', impl:'ai.object.envelope.editContents'},
    ]},
    {n:{'zh-Hant':'透視', 'zh-Hans':'透视', en:'Perspective'}, sub:[
      {n:{'zh-Hant':'附加至使用中平面', 'zh-Hans':'附加到现用平面', en:'Attach to Active Plane'}, id:'perspective.attach', impl:'ai.perspective.attach'},
      {n:{'zh-Hant':'與透視一起釋放', 'zh-Hans':'通过透视释放', en:'Release with Perspective'}, id:'perspective.release', impl:'ai.perspective.release'},
      {n:{'zh-Hant':'移動平面以符合物件', 'zh-Hans':'移动平面以匹配对象', en:'Move Plane to Match Object'}, id:'perspective.plane.matchObject', impl:'ai.perspective.plane.matchObject'},
      {n:{'zh-Hant':'編輯文字', 'zh-Hans':'编辑文本', en:'Edit Text'}, id:'perspective.editText', impl:'ai.perspective.editText'},
    ]},
    {n:{'zh-Hant':'即時上色', 'zh-Hans':'实时上色', en:'Live Paint'}, sub:[
      {n:{'zh-Hant':'製作', 'zh-Hans':'建立', en:'Make'}, id:'livePaint.make', key:'Ctrl+Alt+X', impl:'ai.livePaint.make'},
      {n:{'zh-Hant':'合併', 'zh-Hans':'合并', en:'Merge'}, id:'livePaint.merge', impl:'ai.livePaint.merge'},
      {n:{'zh-Hant':'釋放', 'zh-Hans':'释放', en:'Release'}, id:'livePaint.release', impl:'ai.livePaint.release'},
      {sep:true},
      // 原码无命令 id（todo），自取 id
      {n:{'zh-Hant':'間隙選項…', 'zh-Hans':'间隙选项…', en:'Gap Options…'}, id:'livePaint.gapOptions', get impl(){ return window.CMD && CMD.map['ai.livePaint.gapOptions'] ? 'ai.livePaint.gapOptions' : null; }},
      {sep:true},
      {n:{'zh-Hant':'展開', 'zh-Hans':'扩展', en:'Expand'}, id:'livePaint.expand', impl:'ai.livePaint.expand'},
    ]},
    {n:{'zh-Hant':'影像描圖', 'zh-Hans':'图像描摹', en:'Image Trace'}, sub:[
      {n:{'zh-Hant':'製作…', 'zh-Hans':'建立…', en:'Make…'}, id:'imageTrace.make', impl:'ai.imageTrace.make.dialog'},
      {n:{'zh-Hant':'製作並展開…', 'zh-Hans':'建立并扩展…', en:'Make and Expand…'}, id:'imageTrace.makeAndExpand', impl:'ai.imageTrace.makeAndExpand.dialog'},
      {n:{'zh-Hant':'釋放', 'zh-Hans':'释放', en:'Release'}, id:'imageTrace.release', impl:'ai.imageTrace.release'},
      {n:{'zh-Hant':'展開', 'zh-Hans':'扩展', en:'Expand'}, id:'imageTrace.expand', impl:'ai.imageTrace.expand'},
    ]},
    // 文字转矢量：生图（扣点·登入版才有）后用上面的图像描摹描成新矢量层·menus/impl/genai.js
    {n:{'zh-Hant':'文字轉向量圖形…', 'zh-Hans':'文字转矢量图形…', en:'Text to Vector Graphic…'}, id:'object.textToVector', impl:'genai.textToVector.dialog'},
    {n:{'zh-Hant':'繞圖排文', 'zh-Hans':'文本绕排', en:'Text Wrap'}, sub:[
      {n:{'zh-Hant':'製作', 'zh-Hans':'建立', en:'Make'}, id:'object.textWrap.make', impl:'ai.object.textWrap.make'},
      {n:{'zh-Hant':'釋放', 'zh-Hans':'释放', en:'Release'}, id:'object.textWrap.release', impl:'ai.object.textWrap.release'},
      {n:{'zh-Hant':'繞圖排文選項…', 'zh-Hans':'文本绕排选项…', en:'Text Wrap Options…'}, id:'object.textWrap.options', impl:'ai.object.textWrap.options.dialog'},
    ]},
    {sep:true},
    {n:{'zh-Hant':'剪裁遮色片', 'zh-Hans':'剪切蒙版', en:'Clipping Mask'}, sub:[
      {n:{'zh-Hant':'製作', 'zh-Hans':'建立', en:'Make'}, id:'object.clippingMask.make', key:'Ctrl+7', impl:'ai.object.clippingMask.make'},
      {n:{'zh-Hant':'釋放', 'zh-Hans':'释放', en:'Release'}, id:'object.clippingMask.release', key:'Ctrl+Alt+7', impl:'ai.object.clippingMask.release'},
      {n:{'zh-Hant':'編輯內容', 'zh-Hans':'编辑内容', en:'Edit Contents'}, id:'object.clippingMask.editContents', impl:'ai.object.clippingMask.editContents'},
      {n:{'zh-Hant':'編輯剪裁路徑', 'zh-Hans':'编辑剪切路径', en:'Edit Clipping Path'}, id:'object.clippingMask.editMask', impl:'ai.object.clippingMask.editMask'},
    ]},
    {n:{'zh-Hant':'複合路徑', 'zh-Hans':'复合路径', en:'Compound Path'}, sub:[
      {n:{'zh-Hant':'製作', 'zh-Hans':'建立', en:'Make'}, id:'object.compoundPath.make', key:'Ctrl+8', impl:'ai.object.compoundPath.make'},
      {n:{'zh-Hant':'釋放', 'zh-Hans':'释放', en:'Release'}, id:'object.compoundPath.release', key:'Ctrl+Alt+Shift+8', impl:'ai.object.compoundPath.release'},
    ]},
    {n:{'zh-Hant':'工作區域', 'zh-Hans':'画板', en:'Artboards'}, sub:[
      {n:{'zh-Hant':'轉換為工作區域', 'zh-Hans':'转换为画板', en:'Convert to Artboards'}, id:'artboard.convertToArtboards', impl:'ai.artboard.convertToArtboards'},
      {n:{'zh-Hant':'重新排列所有工作區域…', 'zh-Hans':'重新排列所有画板…', en:'Rearrange All Artboards…'}, id:'artboard.rearrange', impl:'ai.artboard.rearrange.dialog'},
      {sep:true},
      {n:{'zh-Hant':'符合圖稿範圍', 'zh-Hans':'适合图稿边界', en:'Fit to Artwork Bounds'}, id:'artboard.fitToArt', impl:'ai.artboard.fitToArt'},
      {n:{'zh-Hant':'符合選取的圖稿', 'zh-Hans':'适合选中的图稿', en:'Fit to Selected Art'}, id:'artboard.fitToSelection', impl:'ai.artboard.fitToSelection'},
    ]},
    {n:{'zh-Hant':'圖表', 'zh-Hans':'图表', en:'Graph'}, sub:[
      {n:{'zh-Hant':'類型…', 'zh-Hans':'类型…', en:'Type…'}, id:'graph.setType', impl:'ai.graph.setType.dialog'},
      {n:{'zh-Hant':'資料…', 'zh-Hans':'数据…', en:'Data…'}, id:'graph.setData', impl:'ai.graph.setData.dialog'},
      // 下面三项原码无命令 id（todo），自取 id；照 AI 做（menus/impl/ai-misc.js）
      {n:{'zh-Hant':'設計…', 'zh-Hans':'设计…', en:'Design…'}, id:'graph.design', get impl(){ return window.CMD && CMD.map['ai.graph.design'] ? 'ai.graph.design' : null; }},
      {n:{'zh-Hant':'直條…', 'zh-Hans':'柱形图…', en:'Column…'}, id:'graph.column', get impl(){ return window.CMD && CMD.map['ai.graph.column'] ? 'ai.graph.column' : null; }},
      {n:{'zh-Hant':'標記…', 'zh-Hans':'标记…', en:'Marker…'}, id:'graph.marker', get impl(){ return window.CMD && CMD.map['ai.graph.marker'] ? 'ai.graph.marker' : null; }},
    ]},
    // 原码两项同为 assets.add，参数 {multiple:false|true}；拆成不同 id 免得重复
    {n:{'zh-Hant':'收集以供轉存', 'zh-Hans':'收集以导出', en:'Collect for Export'}, sub:[
      {n:{'zh-Hant':'作為單一資產', 'zh-Hans':'作为单个资源', en:'As Single Asset'}, id:'assets.add.single', impl:{cmd:'ai.assets.add', params:{multiple:false}}},
      {n:{'zh-Hant':'作為多個資產', 'zh-Hans':'作为多个资源', en:'As Multiple Assets'}, id:'assets.add.multiple', impl:{cmd:'ai.assets.add', params:{multiple:true}}},
    ]},
    {sep:true},
    // AI 2020 没有这个子菜单，是 VectorCraft 自家的增效模组入口；原码 <dynamic>＝已装的滤镜插件清单＋分隔线＋下面两项（plugin.rs object_menu()）
    // 已装插件清单是执行期才有的，静态只补固定的两项
    {n:{'zh-Hant':'增效模組', 'zh-Hans':'增效工具', en:'Plug-ins'}, sub:[
      {n:{'zh-Hant':'安裝增效模組…', 'zh-Hans':'安装增效工具…', en:'Install Plug-in…'}, id:'ui.installPlugin', impl:'ai.ui.installPlugin'},
      {n:{'zh-Hant':'重新載入增效模組', 'zh-Hans':'重新载入增效工具', en:'Reload Plug-ins'}, id:'plugin.reload', get impl(){ return window.CMD && CMD.map['ai.plugin.reload'] ? 'ai.plugin.reload' : null; }},
    ]},
  ]
});
