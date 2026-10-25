/* 直排文字工具（AI ai.type-v）——vectorcraft/crates/tools/src/text.rs TypeTool::new("verticalType")：Mode::Type、vertical
   共用核心在 tools/typearea.js（window.AiTypeKit，逐段翻 text.rs；对照行号写在那支档头）。直排：text.create 带 vertical（我们走 typev.create＝文字层 orientation:vertical），
   方向键跟着文字流转 90°（text.rs:408：↑＝前一字、↓＝后一字、→＝上一栏、←＝下一栏），插入点是横线、选取每栏一段（直排几何借 tools/typev.js 的 TypeVKit）。
   与 PS 的直排文字工具（typev）不同：这颗照 AI 原码——点一下放空的点文字（不放占位字）、点在外面＝结束并在那里另起新字、Tab 插跳格、⌥＝按词、当前层留在矢量层。
   命令：vtype.place／type／key／select／state／finish／discardEmpty。 */
(function(){
'use strict';
const K = window.AiTypeKit;
K.reg('vtype', 'type', true, {order:903, strings:K.strings('vtype',
  ['直式文字工具', '直排文字工具', 'Vertical Type Tool'],
  ['點一下＝直排點文字 · 拖框＝直排區域文字 · 點進文字放插入點、拖曳選取、雙擊選字、三連擊選段落 · ↑↓ 沿欄、←→ 換欄 · Esc 結束',
   '点一下＝直排点文字 · 拖框＝直排区域文字 · 点进文字放插入点、拖动选取、双击选词、三连击选段落 · ↑↓ 沿栏、←→ 换栏 · Esc 结束',
   'Click: vertical point type · drag: vertical area type · click into text for a caret, drag to select, double-click a word, triple-click a paragraph · ↑↓ along the column, ←→ across columns · Esc ends'])});
})();
