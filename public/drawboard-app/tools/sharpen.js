/* 锐化工具：拖曳＝沿笔画逐 dab 做反锐化遮罩（v＋(v−高斯模糊σ1)），「保护细节」开时结果夹在 3×3 邻域的最小最大之间。
   🔴 照 ArtCraft／PhotoCraft 原码翻译：engine/src/retouch_cmds.rs focus_cmd（sharpen=true，571–614）、paint.sharpen 参数（726–735）、
      algo/src/retouch.rs local_sharpen（176–221）、paint/src/retouch.rs apply_dab_stroke、ui-egui/src/retouch_ui.rs 44／186–188。
   算法与手感跟模糊、涂抹共用，放在 tools/blur.js 的 window.RetouchDab（blur.js 在 index.html 里排在这支前面）。
   命令：sharpen.stroke / sharpen.setOptions */
(function(){
  if (!window.RetouchDab){ console.error('sharpen.js: tools/blur.js (RetouchDab) not loaded'); return; }
  window.SharpenTool = RetouchDab.makeTool('sharpen', 61, '△');
})();
