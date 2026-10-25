/* 直排文字蒙版（PS「直排文字蒙版工具」ps.type-mask-v）
   🔴 原码没有·照 PS 2020 写：PhotoCraft 只有 Tool::Type（type_tool.rs）；直排的版面／按键照它的 orientation=vertical 那几支（见 typev.js 档头）。
   PS 2020 的行为跟横排文字蒙版一样，只是字直排（一栏由上往下、往左换栏；汉字假名直立、拉丁字转 90°）：
     · 点一下＝直排点文字（第一栏中线在按下点、从按下点往下排）、拖框＝直排段落文字（第一栏贴框右缘、往左换栏）
     · 编辑中整张图盖 50% 红，字挖空；↑↓ 沿栏移动、←→ 换栏（type_tool.rs:314 flow_key）、Home/End 栏头栏尾
     · Ctrl+Enter／✓／点在字外面／换工具＝字形变成选区（不建图层、落在原本的当前层）；Esc／⊘＝取消；空字＝什么都不发生
     · 编辑中 Ctrl 拖＝搬动这段字；选项栏「切换文本取向」：编辑中＝转横排，没在编辑＝换到横排文字蒙版工具
     · 我们加的：按下时 ⇧ 加／⌥ 减／⇧⌥ 交叉
   全部实作在 typemaskh.js 的 window.TypeMaskKit（暂存层→选区、红色蒙版叠画、Esc 取消）与 typev.js 的 window.TypeVKit（直排几何／按键／叠画）；
   本档只登记直排那一份命令与工具：
   🔴 命令：typemaskv.begin（放藏起来的直排暂存文字层）／typemaskv.commit（→ 选区）／typemaskv.create（agent 一次到位）。 */
(function(){
'use strict';

const STRINGS = {
  'zh-Hant':{'ui.typemaskvHint':'點一下／拖框開始直排打字（紅色遮色片上挖空的字＝選取範圍）· ↑↓ 沿欄、←→ 換欄 · 按下時 ⇧ 增加／⌥ 減去／⇧⌥ 交集 · Ctrl+Enter／✓ 確定成選取範圍 · Esc 取消'},
  'zh-Hans':{'ui.typemaskvHint':'点一下／拖框开始直排打字（红色蒙版上挖空的字＝选区）· ↑↓ 沿栏、←→ 换栏 · 按下时 ⇧ 添加／⌥ 减去／⇧⌥ 交叉 · Ctrl+Enter／✓ 提交成选区 · Esc 取消'},
  'en':{'ui.typemaskvHint':'Click or drag a box and type vertically (the text cut out of the red mask becomes the selection) · ↑↓ along the column, ←→ to the next/previous column · Shift add / Alt subtract / Shift+Alt intersect at press · Ctrl+Enter / ✓ commits to a selection · Esc cancels'}
};
const m = window.TypeMaskKit.make('typemaskv', 'vertical');
Tools.reg(Object.assign(m.tool, {
  id:'typemaskv', icon:'T', group:'misc', order:13, for:'common', needs:'text', opts:[], cursor:'vertical-text',
  strings:STRINGS,
  buildOptions(box, add, mk){ window.TypeVKit.buildOptions(m.cfg, box, add, mk); }
}));

})();
