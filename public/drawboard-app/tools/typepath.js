/* 路径文字工具（AI ai.type-path）——vectorcraft/crates/tools/src/text.rs TypeTool::new("typeOnPath")：Mode::OnPath、横排
   共用核心在 tools/typearea.js（window.AiTypeKit，逐段翻 text.rs；对照行号写在那支档头）。这颗跟区域文字工具只差 path_at 不要求闭合、
   点到的路径变成路径文字的基线（ai.text.createInPath mode:"onPath"，起点＝路径上离按下点最近的那一点）。
   命令：typepath.place／type／key／select／state／finish／discardEmpty（参数见 DilinCanvas.listCommands('typepath')）。 */
(function(){
'use strict';
const K = window.AiTypeKit;
K.reg('typepath', 'onPath', false, {order:902, strings:K.strings('typepath',
  ['路徑文字工具', '路径文字工具', 'Type on a Path Tool'],
  ['點一下路徑＝文字沿路徑排（從點的位置開始）· 拖框＝區域文字 · 點空白處＝點文字 · 點進文字放插入點、拖曳選取、雙擊選字、三連擊選段落 · Esc 結束',
   '点一下路径＝文字沿路径排（从点的位置开始）· 拖框＝区域文字 · 点空白处＝点文字 · 点进文字放插入点、拖动选取、双击选词、三连击选段落 · Esc 结束',
   'Click a path: type flows along it (from where you clicked) · drag: area type · click elsewhere: point type · click into text for a caret, drag to select, double-click a word, triple-click a paragraph · Esc ends'])});
})();
