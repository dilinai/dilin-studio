/* 单行选框（PS 版面 ps.marquee-row）——原码没有·照 PS 2020 写
   ArtCraft／PhotoCraft 的 enum Tool 只有矩形／椭圆选框，没有单行／单列 ⇒ 照 Photoshop 2020 的实际行为：
     · 在画布上按下＝选出「整张文件宽、1 像素高」的一行（行＝按下点所在的那一列像素）；按着拖动＝那一行跟着游标上下走，放开才定案
     · 模式：选项栏四钮（新选区／添加／减去／交叉），按下那一刻 Shift＝添加、Alt＝减去、Shift+Alt＝交叉（同矩形选框）
     · 选项栏：模式、羽化（PS 允许填；羽化过的单行几乎全 <50%，PS 会警告「任何像素都不大于 50% 选择」，我们照样做出选区）；消除锯齿灰掉、样式灰掉（PS 同）
     · 游标在文件外上下：PS 不做选区 ⇒ 我们也不动
     · 跟矩形选框共用一份选项（MarqueeTool.opt 的 mode／feather；PS 的选取工具各有一份，但选框这一组的选项栏同一个样子——我们跟 lasso.js 一样共用）
   单列（marqueecol.js）跟这支是同一套，只差横竖 ⇒ 本档把做法写成 window.SingleMarquee.make(axis) 给它读。
   🔴 改文件的事全走 CMD：marqueerow.select {y, mode, feather}（进历史；内部叫选框的 marquee.select 合成，跟矩形选框同一套模式合成与羽化）、marqueerow.options、marqueerow.pointer。 */
(function(){
'use strict';

const MODES = ['replace', 'add', 'subtract', 'intersect'];
const DASH = 4;
const own = {mode:0, feather:0};
const shared = () => (window.MarqueeTool && MarqueeTool.opt) || own;
function selectionMode(bar, m){
  if (m.shift && m.alt) return 'intersect';
  if (m.shift) return 'add';
  if (m.alt) return 'subtract';
  return MODES[Math.min(3, Math.max(0, bar | 0))];
}
function ants(ctx, pts, dpr){
  ctx.save(); ctx.lineWidth = 1; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
  ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([DASH * dpr, DASH * dpr]); ctx.strokeStyle = '#000'; ctx.stroke(); ctx.restore();
}
function drawBadge(ctx, p, mode, dpr){
  if (mode === 'replace') return;
  const c = [p[0] + 30 * dpr, p[1] + 11 * dpr], h = 3.5 * dpr;
  let segs;
  if (mode === 'add') segs = [[[c[0] - h, c[1]], [c[0] + h, c[1]]], [[c[0], c[1] - h], [c[0], c[1] + h]]];
  else if (mode === 'subtract') segs = [[[c[0] - h, c[1]], [c[0] + h, c[1]]]];
  else { const k = h * 0.8; segs = [[[c[0] - k, c[1] - k], [c[0] + k, c[1] + k]], [[c[0] - k, c[1] + k], [c[0] + k, c[1] - k]]]; }
  ctx.save();
  for (const [w, col] of [[3, 'rgba(0,0,0,0.78)'], [1.2, '#fff']]){ ctx.lineWidth = w * dpr; ctx.strokeStyle = col; ctx.beginPath(); segs.forEach(([a, b]) => { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }); ctx.stroke(); }
  ctx.restore();
}

/* axis：'row'（单行，量 y）| 'col'（单列，量 x） */
function make(axis, id, order, icon, STRINGS){
  const row = axis === 'row', K = row ? 'y' : 'x';
  const T = {
    drag: null,          // {at, press}
    hover: null, held: {shift:false, alt:false},
    /* 文件坐标 → 那一行／列的整数索引；在文件外＝null */
    index(pt){ const v = Math.floor(row ? pt[1] : pt[0]), n = row ? Doc.height : Doc.width; return (v >= 0 && v < n) ? v : null; },
    badge(){ return selectionMode(shared().mode, this.drag ? this.drag.press : this.held); },
    down(pt, m){ this.drag = {at:this.index(pt), press:{shift:!!m.shift, alt:!!m.alt}}; },
    move(pt){ if (this.drag) this.drag.at = this.index(pt); },
    up(pt){
      const d = this.drag; if (!d) return null;
      this.drag = null; d.at = this.index(pt);
      if (d.at === null) return null;                                    // 放在文件外上下：不做选区
      const o = shared();
      return CMD.run(id + '.select', {[K]:d.at, mode:selectionMode(o.mode, d.press), feather:o.feather || 0});
    }
  };
  CMD.reg(id + '.select', {i18n:'tool.' + id, undoable:true,
    params:`{${K}: 整数（文件像素的${row ? '列（y）' : '行（x）'}，0..${row ? '高' : '宽'}−1）, mode="replace|add|subtract|intersect"="replace", feather=0..1000 px} ` +
           `${row ? '单行' : '单列'}选框（照 PS 2020）：选出${row ? '整张文件宽、1 像素高的一行' : '整张文件高、1 像素宽的一列'}，跟现有选区合成（同 marquee.select）；超出文件＝失败 → {ok, selection}`},
    p => {
      const v = Number(p[K]), n = row ? Doc.height : Doc.width;
      if (!isFinite(v)) return {ok:false, error:`${id}.select: missing \`${K}\``};
      const i = Math.floor(v);
      if (i < 0 || i >= n) return {ok:false, error:`${id}.select: \`${K}\` is outside the document`};
      const mode = MODES.includes(p.mode) ? p.mode : 'replace';
      const fe = Math.min(1000, Math.max(0, Number(p.feather) || 0));
      const rect = row ? {x:0, y:i, width:Doc.width, height:1} : {x:i, y:0, width:1, height:Doc.height};
      return CMD.map['marquee.select'].run(Object.assign(rect, {mode, ellipse:false, antiAlias:false, feather:fe}));
    });
  CMD.reg(id + '.options', {i18n:'',
    params:'{mode?=0..3 或 "replace|add|subtract|intersect", feather?=0..1000 px} 跟矩形选框共用（MarqueeTool.opt）→ 目前选项'},
    p => {
      const o = shared();
      if (p.mode !== undefined){ const i = typeof p.mode === 'string' ? MODES.indexOf(p.mode) : (p.mode | 0); if (i >= 0 && i <= 3) o.mode = i; }
      if (p.feather !== undefined && isFinite(+p.feather)) o.feather = Math.min(1000, Math.max(0, +p.feather));
      if (window.UI && ToolState.cur === id) UI.buildOptions(id);
      return {mode:MODES[o.mode | 0], feather:o.feather || 0};
    });
  CMD.reg(id + '.pointer', {i18n:'',
    params:'{events:[{kind:"down"|"move"|"up", x, y 文件坐标, shift?, alt?}…]} 跟人拿滑鼠同一组手势：down 的 shift/alt 定模式、拖着时那一' + (row ? '行' : '列') + '跟着走、up 定案 → {ok, selection}'},
    p => {
      for (const e of (Array.isArray(p.events) ? p.events : [])){
        const pt = [Number(e.x) || 0, Number(e.y) || 0];
        if (e.kind === 'down') T.down(pt, {shift:!!e.shift, alt:!!e.alt});
        else if (e.kind === 'move') T.move(pt);
        else if (e.kind === 'up') T.up(pt);
      }
      if (window.UI) UI.draw();
      return {ok:true, selection:Doc.sel};
    });

  Tools.reg({
    id, icon, group:'select', order, for:'raster', opts:[], strings:STRINGS, st:T,
    onDown(e, pt){
      if (e.button !== undefined && e.button !== 0){ T.drag = null; return; }
      T.hover = pt; T.held = {shift:e.shiftKey, alt:e.altKey};
      T.down(pt, {shift:e.shiftKey, alt:e.altKey}); UI.draw();
    },
    onMove(e, pt, P){
      T.hover = pt; T.held = {shift:e.shiftKey, alt:e.altKey};
      if (P.down) T.move(pt);
      UI.draw();
    },
    onUp(e, pt){ T.up(pt); UI.draw(); },
    onKey(e){ if (e.key === 'Escape' && T.drag){ T.drag = null; UI.draw(); return true; } return false; },
    onDeactivate(){ T.drag = null; T.hover = null; },
    drawOverlay(ctx, s){
      const dpr = s / Math.max(UI.zoom || 1, 0.01), sc = p => [Math.round(p[0] * s) + 0.5, Math.round(p[1] * s) + 0.5];
      const sel = Doc.sel;
      if (sel && sel.mask && window.SelMask){
        ctx.save(); ctx.lineWidth = 1; ctx.beginPath();
        SelMask.outline(sel).forEach(([a, b]) => { const A = sc(a), B = sc(b); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); });
        ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([DASH * dpr, DASH * dpr]); ctx.strokeStyle = '#000'; ctx.stroke(); ctx.restore();
      }
      // 按着时：预览那一行／列（行军蚁框）
      if (T.drag && T.drag.at !== null){
        const i = T.drag.at, W = Doc.width, H = Doc.height;
        const r = row ? [0, i, W, i + 1] : [i, 0, i + 1, H], A = sc([r[0], r[1]]), B = sc([r[2], r[3]]);
        ants(ctx, [[A[0], A[1]], [B[0], A[1]], [B[0], B[1]], [A[0], B[1]]], dpr);
      }
      if (T.hover) drawBadge(ctx, [T.hover[0] * s, T.hover[1] * s], T.badge(), dpr);
    },
    /* 选项栏照 PS：四个模式钮、羽化；消除锯齿、样式灰掉 */
    buildOptions(box, add, mk){
      const o = shared(), set = p => { CMD.run(id + '.options', p); UI.draw(); };
      const btn = (txt, tipKey, on, fn, data) => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.title = Lang.t(tipKey);
        b.style.cssText = `margin:0 1px;min-width:24px;cursor:pointer;${on ? 'background:#2f7fd8;color:#fff;' : ''}`;
        Object.assign(b.dataset, data || {}); b.onclick = fn; box.appendChild(b); return b;
      };
      [['□', 'ui.slNew'], ['＋', 'ui.slAdd'], ['−', 'ui.slSub'], ['⧉', 'ui.slInt']].forEach(([t, k], i) => btn(t, k, (o.mode | 0) === i, () => set({mode:i}), {mode:MODES[i]}));
      const fe = mk('number', {min:0, max:1000, step:1, value:o.feather || 0}); fe.style.width = '56px'; fe.dataset.opt = 'feather';
      fe.onchange = () => set({feather:+fe.value}); add('slFeather', fe);
      const aa = mk('checkbox', {checked:false}); aa.disabled = true; aa.dataset.opt = 'antiAlias'; add('slAntiAlias', aa);
      const st = document.createElement('select'); st.disabled = true; st.dataset.opt = 'style'; st.innerHTML = `<option>${Lang.t('ui.slStyleNormal')}</option>`; add('slStyle', st);
      const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t(row ? 'ui.srHint' : 'ui.scHint'); box.appendChild(h);
    }
  });

  /* 修饰键：游标旁 ＋／−／× 即时换（ui.js 按着 Alt 时不把键交给工具） */
  const mod = e => {
    if (e.key !== 'Shift' && e.key !== 'Alt') return;
    T.held = {shift:e.shiftKey, alt:e.altKey};
    if (ToolState.cur !== id) return;
    if (e.type === 'keydown' && e.key === 'Alt') e.preventDefault();
    if (window.UI) UI.draw();
  };
  window.addEventListener('keydown', mod, true); window.addEventListener('keyup', mod, true);
  window.addEventListener('blur', () => { T.held = {shift:false, alt:false}; });
  return T;
}

/* 两颗共用的三语（选项栏标签） */
const BASE = {
  'zh-Hant':{'ui.slNew':'新增選取範圍', 'ui.slAdd':'增加至選取範圍  (Shift)', 'ui.slSub':'從選取範圍中減去  (Alt)', 'ui.slInt':'與選取範圍相交  (Shift+Alt)',
    'opt.slFeather':'羽化', 'opt.slAntiAlias':'消除鋸齒', 'opt.slStyle':'樣式', 'ui.slStyleNormal':'正常',
    'ui.srHint':'按一下選取 1 像素高的整列 · 按住拖曳可上下移動 · Shift 增加 · Alt 減去 · Shift+Alt 相交',
    'ui.scHint':'按一下選取 1 像素寬的整欄 · 按住拖曳可左右移動 · Shift 增加 · Alt 減去 · Shift+Alt 相交'},
  'zh-Hans':{'ui.slNew':'新选区', 'ui.slAdd':'添加到选区  (Shift)', 'ui.slSub':'从选区减去  (Alt)', 'ui.slInt':'与选区交叉  (Shift+Alt)',
    'opt.slFeather':'羽化', 'opt.slAntiAlias':'消除锯齿', 'opt.slStyle':'样式', 'ui.slStyleNormal':'正常',
    'ui.srHint':'单击选出 1 像素高的整行 · 按住拖动可上下移动 · Shift 添加 · Alt 减去 · Shift+Alt 交叉',
    'ui.scHint':'单击选出 1 像素宽的整列 · 按住拖动可左右移动 · Shift 添加 · Alt 减去 · Shift+Alt 交叉'},
  'en':{'ui.slNew':'New selection', 'ui.slAdd':'Add to selection  (Shift)', 'ui.slSub':'Subtract from selection  (Alt)', 'ui.slInt':'Intersect with selection  (Shift+Alt)',
    'opt.slFeather':'Feather', 'opt.slAntiAlias':'Anti-alias', 'opt.slStyle':'Style', 'ui.slStyleNormal':'Normal',
    'ui.srHint':'Click to select a 1-pixel-high row  ·  drag to move it up/down  ·  Shift add  ·  Alt subtract  ·  Shift+Alt intersect',
    'ui.scHint':'Click to select a 1-pixel-wide column  ·  drag to move it left/right  ·  Shift add  ·  Alt subtract  ·  Shift+Alt intersect'}
};
window.SingleMarquee = {make, BASE};
make('row', 'marqueerow', 20.1, '═', BASE);

})();
