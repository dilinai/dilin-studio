/* 单列选框（PS 版面 ps.marquee-col）——原码没有·照 PS 2020 写
   PhotoCraft 的 enum Tool 没有单列选框 ⇒ 照 Photoshop 2020：按下＝选出「整张文件高、1 像素宽」的一列，按着拖动左右跟着走、放开定案；
   模式（选项栏四钮；按下时 Shift 添加、Alt 减去、Shift+Alt 交叉）、羽化；消除锯齿与样式灰掉。
   做法跟单行同一套，写在 tools/marqueerow.js（window.SingleMarquee.make）；这里只是换成竖的。
   🔴 命令：marqueecol.select {x, mode, feather}（进历史）、marqueecol.options、marqueecol.pointer。 */
(function(){
'use strict';
if (!window.SingleMarquee){ console.error('marqueecol: tools/marqueerow.js (SingleMarquee) not loaded'); return; }
SingleMarquee.make('col', 'marqueecol', 20.2, '║', SingleMarquee.BASE);
})();
