/* 加深工具（O）：在像素层上拖曳＝把笔刷扫过的地方调暗（范围 阴影／中间调／高光、曝光度、保护色调）。
   🔴 照 ArtCraft／PhotoCraft 原码翻译：engine/src/retouch_cmds.rs 498–511 dodge_burn_cmd（burn=true）、algo/src/retouch.rs tone_curve 的 burn 分支、
      ui-egui/src/retouch_ui.rs 46–49、170–176（跟减淡共用同一组选项：tool_options.tone_range／exposure／protect_tones）。
   算法、手势、选项栏全在 tools/dodge.js 的 window.Toning（三颗工具共用一份）；这里只登记加深这一颗与它的命令。
   命令：burn.stroke / burn.setOptions */
(function(){
const T = window.Toning;
if (!T){ console.error('burn.js: tools/dodge.js（window.Toning）没先载入'); return; }

CMD.reg('burn.stroke', {i18n:'', undoable:true,
  params:'{' + T.BRUSH_PARAMS + ', range="shadows"|"midtones"|"highlights"=midtones, exposure=1..100=50, protectTones=true} '
       + '加深（paint.burn）：逐 dab 把扫过的像素调暗；保护色调＝只改亮度、色相饱和度不变 → {damage:[x,y,w,h]}'},
  p => T.toneStroke(p, true));
CMD.reg('burn.setOptions', {i18n:'',
  params:'{range?:"shadows"|"midtones"|"highlights", exposure?:1..100, protectTones?:bool, size?:px, hardness?:0..100} 滑鼠作画用的选项（＝选项栏；减淡与加深共用一份）'},
  p => T.setToneOptions(p, 'burn'));

window.BurnTool = T.makeTool({
  id:'burn', icon:'◑', order:61, setOptions:'burn.setOptions',
  cmd: e => (e && e.altKey) ? 'dodge.stroke' : 'burn.stroke',           // Alt＝暂时变减淡（PS 行为，原码没有，我们加的）
  params: () => ({ range:T.toneOpts.range, exposure:T.toneOpts.exposure, protectTones:T.toneOpts.protectTones }),
  altLabel:'ui.altDodge',
  strings:T.TONE_STRINGS,
  buildOptions: T.buildToneOptions('burn')
});
})();
