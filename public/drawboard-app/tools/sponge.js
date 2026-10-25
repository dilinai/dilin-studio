/* 海绵工具（O）：在像素层上拖曳＝把笔刷扫过的地方去色或加色（模式 去色／加色、自然饱和度）。
   🔴 照 ArtCraft／PhotoCraft 原码翻译：engine/src/retouch_cmds.rs 513–529 sponge_cmd（每个 dab 强度 0.5、flow＝海绵强度）、
      algo/src/retouch.rs 86–110 saturation／sponge（自然饱和度：加色时已饱和的少动、去色时近灰的少动；超色域朝亮度压回）、
      ui-egui/src/retouch_ui.rs 50、177–182（模式下拉、自然饱和度勾选）、state.rs 438–439（预设 去色／自然饱和度开）。
   算法与手势在 tools/dodge.js 的 window.Toning（三颗工具共用一份）。
   我们多的：选项栏多一格「流量」（PS 有；原码界面没给 ⇒ 命令一律 flow=100，我们预设也是 100，不动就跟原码一样）。
   命令：sponge.stroke / sponge.setOptions */
(function(){
const T = window.Toning;
if (!T){ console.error('sponge.js: tools/dodge.js（window.Toning）没先载入'); return; }
const O = T.spongeOpts;

CMD.reg('sponge.stroke', {i18n:'', undoable:true,
  params:'{' + T.BRUSH_PARAMS + ', mode="desaturate"|"saturate"=desaturate, vibrance=true}（flow＝海绵强度） '
       + '海绵（paint.sponge）：逐 dab 把扫过的像素拉向或推离它的亮度灰 → {damage:[x,y,w,h]}'},
  p => T.spongeStroke(p));
CMD.reg('sponge.setOptions', {i18n:'',
  params:'{mode?:"desaturate"|"saturate", vibrance?:bool, flow?:1..100, size?:px, hardness?:0..100} 滑鼠作画用的选项（＝选项栏）'},
  p => {
    if (p.mode === 'desaturate' || p.mode === 'saturate') O.mode = p.mode;
    if (typeof p.vibrance === 'boolean') O.vibrance = p.vibrance;
    if (typeof p.flow === 'number' && isFinite(p.flow)) O.flow = Math.min(Math.max(Math.round(p.flow), 1), 100);
    T.commonOptions(p);
    if (window.UI && ToolState.cur === 'sponge') UI.buildOptions('sponge');
    return Object.assign({}, O, { size:ToolState.size, hardness:Math.round(ToolState.hardness*100) });
  });

window.SpongeTool = T.makeTool({
  id:'sponge', icon:'◍', order:62, setOptions:'sponge.setOptions',
  cmd: () => 'sponge.stroke',
  params: () => ({ mode:O.mode, vibrance:O.vibrance, flow:O.flow }),
  strings:{
    'zh-Hant':{ 'opt.spongeMode':'模式：', 'opt.spongeMode.desaturate':'去除飽和度', 'opt.spongeMode.saturate':'飽和', 'opt.spongeFlow':'流量：', 'opt.vibrance':'自然飽和度' },
    'zh-Hans':{ 'opt.spongeMode':'模式：', 'opt.spongeMode.desaturate':'去色', 'opt.spongeMode.saturate':'加色', 'opt.spongeFlow':'流量：', 'opt.vibrance':'自然饱和度' },
    'en':{ 'opt.spongeMode':'Mode:', 'opt.spongeMode.desaturate':'Desaturate', 'opt.spongeMode.saturate':'Saturate', 'opt.spongeFlow':'Flow:', 'opt.vibrance':'Vibrance' }
  },
  buildOptions(box, add, mk){
    add('spongeMode', T.mkSelect('mode', [['desaturate', 'opt.spongeMode.desaturate'], ['saturate', 'opt.spongeMode.saturate']], O.mode,
        v => CMD.run('sponge.setOptions', {mode:v})));
    add('spongeFlow', T.mkPct(mk, 'flow', O.flow, v => CMD.run('sponge.setOptions', {flow:v})));
    box.appendChild(document.createTextNode('%'));
    const cb = mk('checkbox', {checked:O.vibrance}); cb.dataset.opt = 'vibrance';
    cb.onchange = () => CMD.run('sponge.setOptions', {vibrance:cb.checked});
    add('vibrance', cb);
  }
});
})();
