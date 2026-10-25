/* 直排路径文字工具（AI ai.type-v-path）——vectorcraft/crates/tools/src/text.rs TypeTool::new("verticalTypeOnPath")：Mode::OnPath、vertical
   共用核心在 tools/typearea.js（window.AiTypeKit）。点一下路径＝直排路径文字（ai.text.createInPath mode:"onPath" vertical:true；每个字绕路径上的点转 90°，layout.rs:47）；
   其余同直排文字工具 vtype。命令：vtypepath.place／type／key／select／state／finish／discardEmpty。 */
(function(){
'use strict';
const K = window.AiTypeKit;
K.reg('vtypepath', 'onPath', true, {order:905, strings:K.strings('vtypepath',
  ['直式路徑文字工具', '直排路径文字工具', 'Vertical Type on a Path Tool'],
  ['點一下路徑＝直排文字沿路徑排 · 拖框＝直排區域文字 · 點空白處＝直排點文字 · Esc 結束',
   '点一下路径＝直排文字沿路径排 · 拖框＝直排区域文字 · 点空白处＝直排点文字 · Esc 结束',
   'Click a path: vertical type along it · drag: vertical area type · click elsewhere: vertical point type · Esc ends'])});
})();
