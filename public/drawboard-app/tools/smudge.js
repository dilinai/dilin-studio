/* 涂抹工具：拖曳＝手指沾起第一个 dab 底下的颜色、一路往前推（每个 dab 先按强度铺下手上的颜色，再重新沾色、手上留强度那么多）。
   「手指绘画」＝一开始手上沾的是前景色。预乘混色，往透明处推不会拖出黑边。
   🔴 照 ArtCraft／PhotoCraft 原码翻译：engine/src/retouch_cmds.rs smudge_cmd（616–636）、paint.smudge 参数（736–745）、
      paint/src/retouch.rs Smudge（294–415）、apply_dab_stroke（halo 0）、mix_premultiplied、ui-egui/src/retouch_ui.rs 45／189–191。
   算法与手感跟模糊、锐化共用，放在 tools/blur.js 的 window.RetouchDab（blur.js 在 index.html 里排在这支前面）。
   命令：smudge.stroke / smudge.setOptions */
(function(){
  if (!window.RetouchDab){ console.error('smudge.js: tools/blur.js (RetouchDab) not loaded'); return; }
  window.SmudgeTool = RetouchDab.makeTool('smudge', 62, '☝');
})();
