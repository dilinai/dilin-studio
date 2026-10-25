/* 堤麟画板 · 菜单树 · 帮助（Photoshop、Illustrator 两套共用这一棵）
 * 原码（vectorcraft menus.rs menu_tree）这支是 ArtCraft 自家的 Discord／网站／GitHub 连结与「关于 VectorCraft」；
 * 这里把他们的连结全拿掉，换成堤麟画板自己的四项，
 * 另加「第三方授权…」（MIT 要求保留原版权与授权声明，放这里）。实作在 menus/impl/ai-help.js（命令名沿用 ai.help.*）。
 */
(function(){
const items = () => [
  {n:{'zh-Hant':'堤麟畫板說明…', 'zh-Hans':'堤麟画板帮助…', en:'Dilin Canvas Help…'}, id:'help.appHelp', key:'F1', impl:'ai.help.appHelp'},
  {n:{'zh-Hant':'搜尋指令…', 'zh-Hans':'搜索命令…', en:'Search Commands…'}, id:'help.commandPalette', key:'Ctrl+Shift+/', impl:'ai.help.commandPalette'},
  {sep:true},
  {n:{'zh-Hant':'第三方授權…', 'zh-Hans':'第三方授权…', en:'Third-Party Licenses…'}, id:'help.licenses', impl:'ai.help.licenses'},
  {n:{'zh-Hant':'關於堤麟畫板', 'zh-Hans':'关于堤麟画板', en:'About Dilin Canvas'}, id:'help.about', impl:'ai.help.about'},
];
['ps', 'ai'].forEach(app => MenuTrees.add(app, 'help', {n:{'zh-Hant':'說明', 'zh-Hans':'帮助', en:'Help'}, items:items()}));
})();
