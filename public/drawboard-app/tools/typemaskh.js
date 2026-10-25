/* 横排文字蒙版（PS「横排文字蒙版工具」ps.type-mask-h）
   🔴 原码没有·照 PS 2020 写：PhotoCraft 只有 Tool::Type（type_tool.rs），没有文字蒙版工具，也没有「文字→选区」的命令。
   PS 2020 的行为（逐条做进来）：
     · 点一下＝点文字、拖框＝段落文字（跟文字工具同一套手势：type_tool.rs pointer_down／move／up，经 TypeVKit.makeTool）
     · 编辑中整张图盖上快速蒙版的红色（50% 红），打出来的字是「挖空」的（看得到底下的图）——字就是将来的选区
     · 打字／IME／选取／方向键／删字／双击选词／三连击选段落／字体字号样式对齐，全部跟文字工具一样（借 tools/text.js 的 TypeTool 会话）
     · 提交（Ctrl+Enter、选项栏 ✓、点在字外面、换工具、换当前层）＝字形变成选区，落在「原本的当前层」上；⛔ 不新增任何图层
     · Esc／选项栏 ⊘＝取消（PS：文字蒙版的 Esc 是放弃，不是提交），什么都不留；空字提交＝什么都不发生
     · 选区边缘照文字的消除锯齿（半透明边＝部分选取）
     · 编辑中 Ctrl 拖＝搬动这段字（PS 编辑时按 Ctrl 暂变移动）
     · 选项栏第一颗「切换文本取向」：编辑中＝把这段字转直排（并进同一步）；没在编辑＝换到直排文字蒙版工具
   我们加的（PS 选区工具的惯例，PS 文字蒙版本身没有）：按下时 ⇧＝加到选区、⌥＝从选区减去、⇧⌥＝与选区交叉；命令也收 mode。
   做法：编辑期间在文件里放一层「藏起来的暂存文字层」（data.typeMask = {prev 原当前层, mode}），让 TypeTool 的编辑会话照常运作；
         提交时把它（按 PsTypeRender／renderLayer 渲出来的）alpha 当覆盖度，跟原选区照 marquee.js 的 combine 合成，再删掉暂存层、当前层还原。
         整段（建暂存层＋打字＋提交成选区）＝一步历史，Ctrl+Z 一下退回原选区。
   共用：本档挂 window.TypeMaskKit（make(ns, orientation) 登记命令＋工具），typemaskv.js 用它；几何／滑鼠／按键用 typev.js 的 window.TypeVKit。
   🔴 改文件的事全走 CMD：typemaskh.begin（放暂存层）／typemaskh.commit（暂存层→选区，或任一文字层→选区）／typemaskh.create（agent 一次到位）。 */
(function(){
'use strict';

const TT = () => window.TypeTool;
const K = () => window.TypeVKit;
const MODES = ['replace', 'add', 'subtract', 'intersect'];
const coverage8 = v => Math.floor(Math.min(1, Math.max(0, v)) * 255 + 0.5);   // marquee.js（selection.rs:78）
const RUBY = 'rgba(255,0,0,0.5)';                                               // PS 快速蒙版预设色：红、不透明度 50%
const L3 = (hant, hans, en) => (window.Lang && Lang.cur === 'en') ? en : (window.Lang && Lang.cur === 'zh-Hans') ? hans : hant;
const modeOf = m => !m ? 'replace' : (m.shift && m.alt) ? 'intersect' : m.shift ? 'add' : m.alt ? 'subtract' : 'replace';

/* 文字层 → 文件大小的 8 位覆盖度（文字的 alpha；含 L.x/L.y 位移、直排／弯曲／消除锯齿都由 renderLayer 那条路负责） */
function textCoverage(L){
  const W = Doc.width, H = Doc.height;
  const c = window.renderLayer(L, 1);
  const px = c.getContext('2d').getImageData(0, 0, W, H).data, out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4 + 3];
  return out;
}
/* 跟原选区合成（marquee.js selectRect 的 combine：add＝max、subtract＝a×(1−b)、intersect＝min；原本没选区＝直接用新的） */
function combine(shape, mode){
  const old = window.SelMask ? SelMask.bytes() : null;
  if (!old || !['add', 'subtract', 'intersect'].includes(mode)) return shape;
  const out = new Uint8Array(shape.length);
  for (let i = 0; i < out.length; i++){
    const a = old[i] / 255, b = shape[i] / 255;
    out[i] = coverage8(mode === 'add' ? Math.max(a, b) : mode === 'subtract' ? a * (1 - b) : Math.min(a, b));
  }
  return out;
}

function make(ns, orientation){
  const vertical = orientation === 'vertical';
  const POS = '{x,y 文件坐标（' + (vertical ? '直排：第一栏中线在 x、从 y 往下排' : '横排：基线锚点') + '）| box:[x,y,w,h] 文件坐标（段落文字框）, text="", size=字号px, font="sans-serif", fontStyle="Regular|Bold|…" 或 weight, align="left|center|right"';

  /* 放暂存层（藏起来、黑字，只拿 alpha；记住原当前层与模式） */
  CMD.reg(ns + '.begin', {i18n:'', params:POS + ', mode="replace|add|subtract|intersect"="replace", coalesce?} 开始一段文字蒙版：放一层藏起来的暂存文字层（data.typeMask），之后用 text.edit／text.setStyle 改它，' + ns + '.commit 变成选区 → {id}'}, p => {
    const prev = Doc.activeId;
    const mode = MODES.includes(p.mode) ? p.mode : modeOf(p.mods);
    const q = Object.assign({}, p, {color:'#000000', name:L3('文字遮色片', '文字蒙版', 'Type Mask'), coalesce:p.coalesce || TT().newKey()});
    delete q.mods; delete q.mode;
    const r = CMD.run('text.create', q);
    if (!r || !r.id) return r || {ok:false, error:'text.create failed'};
    const L = Doc.byId(r.id);
    L.visible = false;
    L.data.orientation = orientation;
    L.data.typeMask = {prev, mode};
    Layer.invalidate(L);
    return {id:L.id};
  });

  /* 文字 → 选区。暂存层：用完删掉、当前层还原；一般文字层：留着（＝PS Ctrl 点文字层缩图载入选区） */
  CMD.reg(ns + '.commit', {i18n:'', params:'{layerId?(缺省＝当前文字层), mode?="replace|add|subtract|intersect"(缺省＝begin 时记的), discard?:bool(只收掉暂存层、不改选区), coalesce?} 文字的字形变成选区（覆盖度＝文字的 alpha，边缘照消除锯齿）；暂存层删掉、当前层回到原本那层 → {ok, selection:{x,y,w,h,shape?}|null}'}, p => {
    const id = p.layerId || Doc.activeId, L = Doc.byId(id);
    if (!L || L.kind !== 'text') return {ok:false, error:'not a text layer'};
    CMD.run('text.edit', {layerId:L.id, coalesce:p.coalesce || TT().newKey()});   // 推（或并进那段编辑的）一步历史
    const tm = L.data.typeMask;
    const mode = MODES.includes(p.mode) ? p.mode : (tm && tm.mode) || 'replace';
    if (p.discard !== true && String(L.data.text).trim()){
      Layer.invalidate(L);
      Doc.sel = SelMask.fromBytes(combine(textCoverage(L), mode));
    }
    if (tm){
      Doc.remove(L.id);
      const back = tm.prev && Doc.byId(tm.prev) ? tm.prev : (Doc.layers.length ? Doc.layers[Doc.layers.length - 1].id : null);
      Doc.activeId = back;
    }
    return {ok:true, selection:Doc.sel || null};
  });

  /* agent 一次到位：放暂存层＋提交成选区，一步历史 */
  CMD.reg(ns + '.create', {i18n:'', params:POS + ', mode="replace|add|subtract|intersect"="replace"} ' + (vertical ? '直排' : '横排') + '文字蒙版一次到位：打好的字直接变成选区（不建图层；一步历史）→ {ok, selection}'}, p => {
    if (!String(p.text || '').trim()) return {ok:false, error:'text is empty'};
    const key = TT().newKey();
    const r = CMD.run(ns + '.begin', Object.assign({}, p, {coalesce:key}));
    if (!r || !r.id) return r;
    return CMD.run(ns + '.commit', {layerId:r.id, mode:p.mode, coalesce:key});
  });

  const mine = () => { const T = TT(), L = T && T.ed && T.layer(); return L && L.data.typeMask ? L : null; };
  const cfg = {
    id:ns, orientation, hint:'ui.' + ns + 'Hint', editOthers:false,
    create: p => CMD.run(ns + '.begin', p),
    /* 提交：空字＝当作取消；否则结束会话、暂存层→选区（并进同一步） */
    commit(){
      const T = TT(), ed = T.ed; if (!ed) return;
      const L = T.layer();
      if (!L || !L.data.typeMask){ T.commit(); return; }
      if (!String(L.data.text).trim()){ cfg.cancel(); return; }
      T.end();
      CMD.run(ns + '.commit', {layerId:L.id, coalesce:ed.session});
      cfg._kit && cfg._kit.rebuild();
      UI.draw();
    },
    /* 取消（PS Esc）：整段编辑还在历史最上面就整步退掉；不在（中间夹了别的步骤）就只收掉暂存层 */
    cancel(){
      const T = TT(), ed = T.ed; if (!ed) return;
      const id = ed.layer, key = ed.session;
      T.cancel();
      const L = Doc.byId(id);
      if (L && L.data.typeMask) CMD.run(ns + '.commit', {layerId:id, discard:true, coalesce:key});
      cfg._kit && cfg._kit.rebuild();
      UI.draw();
    },
    /* 蒙版会话自己的键：Esc＝取消、Ctrl+Enter＝提交（TypeTool.key 会把它们当文字层提交，所以先拦） */
    key(e){
      if (!mine()) return false;
      if (e.key === 'Escape'){ cfg.cancel(); return true; }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ cfg.commit(); return true; }
      return false;
    },
    /* 红色蒙版：整张盖 50% 红，字挖空（字的 alpha 用 destination-out 扣掉） */
    drawBelow(ctx, s){
      const L = mine(); if (!L) return;
      const k = Math.min(s, 1), W = Math.max(1, Math.round(Doc.width * k)), H = Math.max(1, Math.round(Doc.height * k));
      const off = cfg._off || (cfg._off = document.createElement('canvas'));
      if (off.width !== W || off.height !== H){ off.width = W; off.height = H; }
      const o = off.getContext('2d');
      o.globalCompositeOperation = 'copy'; o.fillStyle = RUBY; o.fillRect(0, 0, W, H);
      o.globalCompositeOperation = 'destination-out'; o.drawImage(window.renderLayer(L, k), 0, 0);
      o.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, Doc.width * s, Doc.height * s);
      ctx.restore();
    },
    /* 编辑中＝切这段字的取向；没在编辑＝换到另一颗文字蒙版工具 */
    toggle(){
      const T = TT(), L = mine();
      if (L){ CMD.run('typev.orientation', {layerId:L.id, coalesce:T.ed.session}); T.focus(); UI.buildOptions(ns); UI.draw(); }
      else UI.pick(vertical ? 'typemaskh' : 'typemaskv');
    }
  };
  const tool = K().makeTool(cfg);
  cfg._kit = tool._typeKit;
  return {cfg, tool, coverage:textCoverage};
}

window.TypeMaskKit = {make, textCoverage, combine, modeOf};

const STRINGS = {
  'zh-Hant':{'ui.typemaskhHint':'點一下／拖框開始打字（紅色遮色片上挖空的字＝選取範圍）· 按下時 ⇧ 增加／⌥ 減去／⇧⌥ 交集 · Ctrl+Enter／✓ 確定成選取範圍 · Esc 取消'},
  'zh-Hans':{'ui.typemaskhHint':'点一下／拖框开始打字（红色蒙版上挖空的字＝选区）· 按下时 ⇧ 添加／⌥ 减去／⇧⌥ 交叉 · Ctrl+Enter／✓ 提交成选区 · Esc 取消'},
  'en':{'ui.typemaskhHint':'Click or drag a box and type (the text cut out of the red mask becomes the selection) · Shift add / Alt subtract / Shift+Alt intersect at press · Ctrl+Enter / ✓ commits to a selection · Esc cancels'}
};
const m = make('typemaskh', 'horizontal');
Tools.reg(Object.assign(m.tool, {
  id:'typemaskh', icon:'T', group:'misc', order:12, for:'common', needs:'text', opts:[], cursor:'text',
  strings:STRINGS,
  buildOptions(box, add, mk){ K().buildOptions(m.cfg, box, add, mk); }
}));

})();
