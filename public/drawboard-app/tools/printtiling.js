/* 打印拼贴工具（AI 版面 ai.print-tiling）——照 VectorCraft 原码逐段翻译
   对照源（vectorcraft/crates/…）：
     tools/src/printtiling.rs 1-97     PrintTilingTool：按下记下点在哪块画板上（第一块含它的）；拖＝指针是第一页可印区的左上角
                                       （吸那块画板的四边，5 屏幕点内）→ 预览 print.tiling.set {origin, artboard}；放开＝提交一步；
                                       只点一下不改；双击＝print.tiling.set {reset:true}（回到版面配置放的位置）；Esc 拖到一半取消；
                                       叠画＝「dX/dY」量测牌（离画板左上角多远）；工具开着时画面显示页面（同 视图 ▸ 显示打印拼贴）
     engine/src/cmd/printtiling.rs 1-109  print.tiling.set：origin 换成「相对挑中那块画板左上角」的 tileOrigin {placed, x, y}（挑：给 artboard 就用它，
                                       否则含 origin 的那块，再不然第一块）；reset＝TileOrigin::default；有变才进历史；检查 ±14400 pt
     pdf/src/print/layout.rs 166-262   不拼贴（不缩放）时：放了 tileOrigin ⇒ 印出区左上角＝可印区左上角 − tileOrigin；否则照版面配置（置中）
     pdf/src/print/tiling.rs 32-80     页面换回文件坐标：纸边＝page、可印区＝内缩边距
     pdf/src/print/settings.rs 408-438 TileOrigin {placed, x, y}、check（±14400）
   我们这边：打印设置照 ai-view.js 的预设（Letter 612×792、不缩放、自动旋转、置中、边距 0；我们没有完整的打印设置资料）；
            tileOrigin 存 Doc.aiR3.printTiling（进历史、进工程档）。本档登记 printtiling.set／printtiling.pages，
            并把 AiR3.tilingPages 换成认 tileOrigin 的版本、ai.view.printTiling 回的 pages 也照它。 */
(function(){
'use strict';
const K = window.AiBoxKit;
let R3 = null;                                                                   // menus/impl/ai-object.js 在工具之后才载入 ⇒ init() 时再接
const PW = 612, PH = 792, MARGIN = 0, LIMIT = 14400;                            // ai-view.js 预设；settings.rs:437 ±14400
const TO = () => R3.doc('printTiling');
const boards = () => R3 ? R3.artboards() : [{index:0, id:1, name:'', rect:{x0:0, y0:0, x1:Doc.width, y1:Doc.height}}];
const fail = error => ({ok:false, error});

/* layout.rs:166 layout（不缩放、不拼贴）＋ tiling.rs:60（每页一次）：origin＝{x,y} 或 null（照版面配置置中） */
function pagesWith(origin){
  const out = [];
  boards().forEach((a, i) => {
    const r = a.rect, w = r.x1 - r.x0, h = r.y1 - r.y0; if (!(w > 0 && h > 0)) return;
    const land = (w > h) !== (PW > PH);                                          // auto_rotate
    const pw = land ? PH : PW, ph = land ? PW : PH;
    // 印出区（＝画板，不缩放、没出血／标记）在纸上的左上角
    const tx = origin ? MARGIN - origin.x : MARGIN + (pw - 2 * MARGIN - w) / 2;
    const ty = origin ? MARGIN - origin.y : MARGIN + (ph - 2 * MARGIN - h) / 2;
    const x0 = r.x0 - tx, y0 = r.y0 - ty;                                        // 纸的左上角（文件坐标）
    out.push({artboard:i, number:out.length + 1, printed:true, page:[x0, y0, x0 + pw, y0 + ph], imageable:[x0 + MARGIN, y0 + MARGIN, x0 + pw - MARGIN, y0 + ph - MARGIN]});
  });
  return out;
}
const curOrigin = () => { if (!R3) return null; const t = TO(); return t && t.placed ? {x:t.x, y:t.y} : null; };
const pages = () => pagesWith(curOrigin());

/* printtiling.rs:set_origin：算新的 tileOrigin（不改文件） */
function originFor(p){
  if (p.reset === true) return {placed:false, x:0, y:0};
  const at = Array.isArray(p.origin) ? [+p.origin[0], +p.origin[1]] : null;
  if (!at || !isFinite(at[0]) || !isFinite(at[1])) return {error:'printtiling.set: give origin: [x, y], or reset: true'};
  const all = boards(); let pick;
  if (p.artboard !== undefined && p.artboard !== null){
    const i = +p.artboard;
    if (!Number.isInteger(i) || i < 0) return {error:'printtiling.set: artboard must be a 0-based index'};
    pick = all[i]; if (!pick) return {error:`printtiling.set: artboard ${i} doesn't print`};
  } else pick = all.find(a => K.contains(a.rect, at)) || all[0];
  if (!pick) return {error:'printtiling.set: nothing prints'};
  const o = {placed:true, x:at[0] - pick.rect.x0, y:at[1] - pick.rect.y0};
  if (Math.abs(o.x) > LIMIT || Math.abs(o.y) > LIMIT) return {error:`printtiling.set: tileOrigin must be within ±${LIMIT} pt of the artboard`};
  return o;
}
function init(){
  R3 = window.AiR3; if (!R3 || CMD.map['printtiling.set']) return;
  R3.docDefaults.printTiling = () => ({placed:false, x:0, y:0});                 // settings.rs:408 TileOrigin::default
  R3.tilingPages = pages;                                                        // 认 tileOrigin 的版本（ai-view.js 叠画也叫它）
  R3.regEdit('printtiling.set', {params:'{origin:[x, y]（文件坐标：第一页可印区的左上角）, artboard?（0 起：从哪块画板量；缺省＝含 origin 的那块，否则第一块）} | {reset:true} 打印拼贴工具放页面（printtiling.rs print.tiling.set）：存成相对画板左上角的 tileOrigin，跟着文件存；reset＝回到版面配置（置中）；有变才进历史 → {ok, tileOrigin:{placed,x,y}}'}, (p, touch) => {
    const o = originFor(p); if (o.error) return fail(o.error);
    const t = TO();
    if (t.placed !== o.placed || t.x !== o.x || t.y !== o.y){ touch(); Object.assign(TO(), o); }
    return {ok:true, tileOrigin:Object.assign({}, TO())};
  });
  CMD.reg('printtiling.pages', {i18n:'', params:'{} 打印拼贴的页面（printtiling.rs print.tiling；照 tileOrigin）→ {ok, tileOrigin, pages:[{artboard, number, printed, page:[x0,y0,x1,y1], imageable:[x0,y0,x1,y1]}]}'}, () =>
    ({ok:true, tileOrigin:Object.assign({}, TO()), pages:pages()}));
  /* 视图 ▸ 显示打印拼贴回的 pages 也认 tileOrigin */
  const c = CMD.map['ai.view.printTiling'];
  if (c && !c.__tiling){ const run = c.run; c.__tiling = true; c.run = function(){ const r = run.apply(this, arguments); if (r && r.ok !== false) r.pages = pages(); return r; }; }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

/* ═══════════ 手势（printtiling.rs:39-97） ═══════════ */
const snap1 = (v, edges, t) => { let best = v, bd = Infinity; for (const e of edges){ const d = Math.abs(e - v); if (d <= t && d < bd){ best = e; bd = d; } } return best; };   // printtiling.rs:26
const PT = window.AiPrintTilingTool = {drag:null, began:false, last:[0, 0]};
function down(e, p){
  if (e.button !== undefined && e.button !== 0) return;
  const all = boards(), i = all.findIndex(a => K.contains(a.rect, p));          // position：第一块含它的
  PT.drag = {artboard:i >= 0 ? i : null, rect:i >= 0 ? Object.assign({}, all[i].rect) : null};
  PT.began = false; PT.last = p.slice();
}
function drag(p){
  const d = PT.drag; if (!d) return;
  const t = K.tol(5);
  PT.last = d.rect ? [snap1(p[0], [d.rect.x0, d.rect.x1], t), snap1(p[1], [d.rect.y0, d.rect.y1], t)] : p.slice();
  PT.began = true;                                                               // Begin("Print Tiling")
  UI.draw();
}
function up(){
  const d = PT.drag, began = PT.began; PT.drag = null; PT.began = false;
  if (d && began){ const r = CMD.run('printtiling.set', {origin:PT.last.slice(), artboard:d.artboard}); if (r && r.ok === false) console.warn(r.error); }   // Commit
  UI.draw();
}
function cancel(){ const b = PT.began; PT.drag = null; PT.began = false; if (window.UI) UI.draw(); return b; }

/* 页面画法照 ai-view.js 打印拼贴叠画（canvas.rs:1013-1042：灰 96、纸边 0.75 实线、可印区虚线、左上角页码） */
function drawPages(ctx, s, list){
  ctx.save(); ctx.strokeStyle = 'rgb(96,96,96)'; ctx.fillStyle = 'rgb(96,96,96)'; ctx.font = '10px sans-serif'; ctx.textBaseline = 'top';
  for (const pg of list){
    const [a, b, c, d] = pg.page.map(v => v * s);
    ctx.lineWidth = 0.75; ctx.setLineDash([]); ctx.strokeRect(a, b, c - a, d - b);
    const [e, f, g, h] = pg.imageable.map(v => v * s);
    ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.strokeRect(e, f, g - e, h - f);
    ctx.fillText(String(pg.number), e + 3, f + 2);
  }
  ctx.restore();
}
/* 拖曳中的页面＝预览那个 tileOrigin 的样子 */
function previewPages(){
  const d = PT.drag; if (!(d && PT.began)) return pages();
  const o = originFor({origin:PT.last, artboard:d.artboard});
  return o.error ? pages() : pagesWith(o.placed ? o : null);
}
function overlay(ctx, s){
  // 工具开着时画面显示页面（视图 ▸ 显示打印拼贴开着时 ai-view.js 已经画了，拖曳中才再画预览）
  if (!(window.AiView && AiView.flags.printTiling) || (PT.drag && PT.began)) drawPages(ctx, s, previewPages());
  const d = PT.drag;
  if (d && d.rect && PT.began) K.drawMeasure(ctx, s, PT.last, K.offsetLabel(PT.last[0] - d.rect.x0, PT.last[1] - d.rect.y0));   // printtiling.rs:83
}
window.PrintTilingKit = {pages, pagesWith, originFor, drawPages};

const STRINGS = {
  'zh-Hant':{'ui.ptHint':'拖曳＝把第一頁可列印區域的左上角放到指標處（貼齊工作區域邊緣）· 雙擊＝重設 · Esc 取消'},
  'zh-Hans':{'ui.ptHint':'拖动＝把第一页可打印区域的左上角放到指针处（吸附画板边缘）· 双击＝复位 · Esc 取消'},
  'en':{'ui.ptHint':'Drag to put the top-left corner of the first page\'s imageable area at the pointer (snaps to the artboard\'s edges) · double-click resets · Esc cancels'}
};
Tools.reg({
  id:'printtiling', icon:'⎙', group:'misc', order:60, for:'vector', cursor:'crosshair', opts:[], strings:STRINGS,
  hint:'ui.ptHint',
  onDown(e, pt){ down(e, pt); },
  onMove(e, pt, P){ if (P.down && PT.drag) drag(pt); },
  onUp(){ up(); },
  onDblClick(){ PT.drag = null; PT.began = false; const r = CMD.run('printtiling.set', {reset:true}); if (r && r.ok === false) console.warn(r.error); UI.draw(); },
  onKey(e){ if (e.key === 'Escape') return cancel(); return false; },
  onDeactivate(){ cancel(); },
  drawOverlay(ctx, s){ overlay(ctx, s); }
});
})();
