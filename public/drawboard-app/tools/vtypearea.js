/* 直排区域文字工具（AI ai.type-v-area）——vectorcraft/crates/tools/src/text.rs TypeTool::new("verticalAreaType")：Mode::Area、vertical
   共用核心在 tools/typearea.js（window.AiTypeKit）。点一下闭合路径＝变成直排区域文字（ai.text.createInPath mode:"area" vertical:true；我们的框只有矩形 ⇒ 路径外框）；
   其余（拖框、点文字、编辑、按键）同直排文字工具 vtype。命令：vtypearea.place／type／key／select／state／finish／discardEmpty。 */
(function(){
'use strict';
const K = window.AiTypeKit;
K.reg('vtypearea', 'area', true, {order:904, strings:K.strings('vtypearea',
  ['直式區域文字工具', '直排区域文字工具', 'Vertical Area Type Tool'],
  ['點一下閉合路徑＝變成直排區域文字 · 拖框＝直排區域文字 · 點空白處＝直排點文字 · ↑↓ 沿欄、←→ 換欄 · Esc 結束',
   '点一下闭合路径＝变成直排区域文字 · 拖框＝直排区域文字 · 点空白处＝直排点文字 · ↑↓ 沿栏、←→ 换栏 · Esc 结束',
   'Click a closed path: vertical area type · drag: vertical area type frame · click elsewhere: vertical point type · ↑↓ along the column, ←→ across columns · Esc ends'])});
})();
