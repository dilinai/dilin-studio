/* 堤麟画板 · 度量工具（AI：度量工具，id measure）—— 照 ArtCraft VectorCraft 原码逐段翻译
   主体：vectorcraft/crates/tools/src/xform/measure.rs（1-83）
     measure(a, b)＝(距离, 角度（逆时针为正、度）, dX, dY)
     按下：起点＝snap_draw(按下点)（智能参考线吸附）、开始拖
     拖／放开：终点＝Shift ? 起点＋constrain_angle(游标−起点, 45°)（长度不变、锁 45° 倍数） : snap_draw(游标)；放开就停（读数留着）
     叠画：起终点不同才画——青色实线＋终点右下 (12,12) 萤幕像素处的读数「D: 距离 / Angle: 角度° / dX / dY」
     options()：{x, y（起点）, distance, angle, dx, dy}（给 agent）；文件永远不改（不进历史）
   吸附：tools/src/guides.rs snap_draw（对齐像素／对齐网格＝AI 视图选项；智能参考线＝锚点、中心、物件边、画板边，容差 5 萤幕像素）——照 tools/line.js 已翻的那份抄进来。
   读数单位：AI 首选项 ▸ 单位 ▸ 常规（Unit::readout 两位小数＋缩写；文件 1 px ＝ 1 pt）。 */
(function(){
'use strict';
const fin = v => typeof v === 'number' && isFinite(v);
const zoom = () => Math.max((window.UI && UI.zoom) || 1, 1e-6);
const CYAN = '#00a8ff';                                               // xform.rs CYAN

/* measure.rs:18-21 measure */
function measure(a, b){
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return {distance:Math.hypot(dx, dy), angle:Math.atan2(-dy, dx) * 180 / Math.PI, dx, dy};
}
/* geom/lib.rs constrain_angle(v, 45)：长度不变、方向锁到最近的 45° 倍数 */
function constrain45(v){
  const l = Math.hypot(v[0], v[1]); if (l < 1e-12) return [0, 0];
  const q = Math.PI / 4, a = Math.round(Math.atan2(v[1], v[0]) / q) * q;
  return [l * Math.cos(a), l * Math.sin(a)];
}

/* ── guides.rs snap_draw（照 tools/line.js lineCollectTargets／lineSnapPoint 抄）── */
function geomOf(s, ox, oy){
  const v = window.VecSel ? VecSel.asBezier(s) : null;
  if (v && v.anchors && v.anchors.length){
    const A = v.anchors.map(a => [a.x + ox, a.y + oy]);
    const b = window.AIObj && AIObj.shapeBounds ? AIObj.shapeBounds(s, q => [q[0] + ox, q[1] + oy], false) : null;
    let bb = b;
    if (!bb){ const xs = A.map(p => p[0]), ys = A.map(p => p[1]); bb = {x0:Math.min(...xs), y0:Math.min(...ys), x1:Math.max(...xs), y1:Math.max(...ys)}; }
    return {anchors:A, bounds:bb};
  }
  const b = window.AIObj && AIObj.shapeBounds ? AIObj.shapeBounds(s, q => [q[0] + ox, q[1] + oy], false) : null;
  return b ? {anchors:[], bounds:b} : null;
}
function collectTargets(){
  const T = {points:[], xs:[], ys:[]};
  const addRect = (r, kind) => {
    const c = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
    for (const p of [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]){ T.xs.push([p[0], p, kind]); T.ys.push([p[1], p, kind]); }
    T.points.push([c, 'center']); T.xs.push([c[0], c, 'center']); T.ys.push([c[1], c, 'center']);
  };
  addRect({x0:0, y0:0, x1:Doc.width, y1:Doc.height}, 'artboard');
  let budget = 20000;
  for (const L of Doc.layers){
    const ox = L.x || 0, oy = L.y || 0;
    if (L.kind === 'vector'){
      for (const s of (L.data.shapes || [])){
        if (budget === 0) break;
        const g = geomOf(s, ox, oy); if (!g) continue;
        g.anchors.forEach(a => { T.points.push([a, 'anchor']); budget = Math.max(0, budget - 1); });
        addRect(g.bounds, 'edge');
      }
    } else if (budget > 0 && L.kind === 'raster' && L.data && L.data.canvas) addRect({x0:ox, y0:oy, x1:ox + L.data.canvas.width, y1:oy + L.data.canvas.height}, 'edge');
  }
  return T;
}
function snapPoint(T, p, tol){
  let best = null, bd = Infinity;
  for (const [q, k] of T.points){ const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d <= tol && d < bd){ best = [q, k]; bd = d; } }
  if (best) return {p:[best[0][0], best[0][1]], guides:[{label:best[1], p:best[0]}]};
  const out = [p[0], p[1]], guides = [];
  let bx = null, dx = Infinity;
  for (const e of T.xs){ const d = Math.abs(e[0] - p[0]); if (d <= tol && d < dx){ bx = e; dx = d; } }
  if (bx){ out[0] = bx[0]; guides.push({a:bx[1], b:[bx[0], p[1]]}); }
  let by = null, dy = Infinity;
  for (const e of T.ys){ const d = Math.abs(e[0] - p[1]); if (d <= tol && d < dy){ by = e; dy = d; } }
  if (by){ out[1] = by[0]; guides.push({a:by[1], b:[p[0], by[0]]}); }
  if (guides.length) guides.push({label:'align', p:[out[0], out[1]]});
  return {p:out, guides};
}
/* snap_draw：对齐像素／对齐网格（AI 视图）→ 智能参考线（AI 视图 ▸ 智能参考线，缺省开） */
function snapDraw(p, smart){
  const V = window.AiView;
  if (V && V.flags){
    if (V.flags.snapToPixel) return {p:[Math.round(p[0]), Math.round(p[1])], guides:[]};
    if (V.flags.snapToGrid && V.gridSet){ const g = V.gridSet.spacing / Math.max(1, V.gridSet.subdivisions); return {p:[Math.round(p[0] / g) * g, Math.round(p[1] / g) * g], guides:[]}; }
  }
  const on = smart === undefined ? !(V && V.flags && V.flags.smartGuides === false) : !!smart;
  if (!on) return {p:[p[0], p[1]], guides:[]};
  return snapPoint(collectTargets(), p, 5 / zoom());
}
const lenOf = v => window.PerspKit ? PerspKit.len(v) : `${v.toFixed(2)} pt`;

const MT = window.MeasureTool = {
  line: null,          // [a, b]
  dragging: false,
  guides: [],
  bar: null,
  measure, constrain45, snapDraw,
  busy(){ return this.dragging; },
  /* options()：给 agent 的读数（没量过＝null） */
  options(){ if (!this.line) return null; const [a, b] = this.line, m = measure(a, b); return {x:a[0], y:a[1], distance:m.distance, angle:m.angle, dx:m.dx, dy:m.dy}; },
  text(){ if (!this.line) return ''; const m = measure(this.line[0], this.line[1]); return `D: ${lenOf(m.distance)}\nAngle: ${m.angle.toFixed(1)}°\ndX: ${lenOf(m.dx)}\ndY: ${lenOf(m.dy)}`; },
  down(e, pt){ const r = snapDraw(pt); this.line = [r.p, r.p.slice()]; this.guides = r.guides; this.dragging = true; },
  drag(e, pt, up){
    if (!this.dragging || !this.line) return;
    const a = this.line[0];
    let b;
    if (e.shiftKey){ const v = constrain45([pt[0] - a[0], pt[1] - a[1]]); b = [a[0] + v[0], a[1] + v[1]]; this.guides = []; }
    else { const r = snapDraw(pt); b = r.p; this.guides = r.guides; }
    this.line = [a, b];
    this.dragging = !up;
    if (up) this.guides = [];
    this.refreshBar();
  },
  refreshBar(){ if (this.bar) this.bar.textContent = this.line ? this.text().replace(/\n/g, '　') : Lang.t('ui.msNone'); },
  /* measure.rs:55-68 overlays */
  drawOverlay(ctx, s){
    if (!this.line) return;
    const [a, b] = this.line; if (a[0] === b[0] && a[1] === b[1]) return;
    const dpr = s / zoom();
    ctx.save(); ctx.setLineDash([]); ctx.strokeStyle = CYAN; ctx.lineWidth = 1 * dpr;
    ctx.beginPath(); ctx.moveTo(a[0] * s, a[1] * s); ctx.lineTo(b[0] * s, b[1] * s); ctx.stroke();
    for (const g of this.guides){ if (g.a){ ctx.strokeStyle = '#ff3dfc'; ctx.beginPath(); ctx.moveTo(g.a[0] * s, g.a[1] * s); ctx.lineTo(g.b[0] * s, g.b[1] * s); ctx.stroke(); } }
    ctx.restore();
    const t = 12 / zoom(), p = [b[0] + t, b[1] + t];
    if (window.PerspKit) PerspKit.drawLabel(ctx, s, p, this.text());
  }
};

/* ── 命令（量测不改文件、不进历史）── */
const reg = (id, meta, fn) => CMD.reg(id, Object.assign({i18n:''}, meta), p => fn(p || {}));
reg('measure.measure', {params:'{x1, y1 起点, x2, y2 终点（文件坐标）, shift?: 锁 45°（长度不变）, snap?: 两点先套吸附（缺省＝AI 视图的智能参考线设定；false＝不吸）} ＝拿度量工具从 (x1,y1) 拖到 (x2,y2)：读数留在画面上 → {ok, x, y, distance, angle（逆时针为正、度）, dx, dy, text}'}, p => {
  if (![p.x1, p.y1, p.x2, p.y2].every(fin)) return {ok:false, error:'measure.measure: x1,y1,x2,y2 are required numbers'};
  const sm = p.snap === false ? false : undefined;
  const a = snapDraw([p.x1, p.y1], sm).p;
  let b;
  if (p.shift){ const v = constrain45([p.x2 - a[0], p.y2 - a[1]]); b = [a[0] + v[0], a[1] + v[1]]; }
  else b = snapDraw([p.x2, p.y2], sm).p;
  MT.line = [a, b]; MT.dragging = false; MT.guides = []; MT.refreshBar();
  if (window.UI) UI.draw();
  return Object.assign({ok:true}, MT.options(), {text:MT.text()});
});
reg('measure.info', {params:'{} 度量工具目前的读数（measure.rs options）→ {ok, measure:{x, y, distance, angle, dx, dy} | null, text}'}, () => ({ok:true, measure:MT.options(), text:MT.text()}));
reg('measure.clear', {params:'{} 清掉度量工具的量线与读数 → {ok}'}, () => { MT.line = null; MT.dragging = false; MT.refreshBar(); if (window.UI) UI.draw(); return {ok:true}; });

const STR = {
  'zh-Hant':{'ui.msHint':'拖曳＝量兩點的距離、角度、dX、dY（Shift＝鎖 45°；吸附智慧型參考線）｜讀數留在畫面上直到下次拖曳｜不改檔案', 'ui.msNone':'（尚未量測）', 'opt.msInfo':'資訊'},
  'zh-Hans':{'ui.msHint':'拖曳＝量两点的距离、角度、dX、dY（Shift＝锁 45°；吸附智能参考线）｜读数留在画面上直到下次拖曳｜不改文件', 'ui.msNone':'（尚未度量）', 'opt.msInfo':'信息'},
  'en':{'ui.msHint':'Drag to measure distance, angle, dX and dY (Shift constrains to 45°; snaps to smart guides) | The reading stays until the next drag | The document never changes', 'ui.msNone':'(not measured)', 'opt.msInfo':'Info'}
};
Tools.reg({
  id:'measure', icon:'📏', group:'vector', order:302, for:'vector', opts:[],
  cursor:'crosshair', hint:'ui.msHint', strings:STR,
  onDown(e, pt){ MT.down(e, pt); UI.draw(); },
  onMove(e, pt){ if (MT.dragging){ MT.drag(e, pt, false); UI.draw(); } },
  onUp(e, pt){ MT.drag(e, pt, true); UI.draw(); },
  onDeactivate(){ MT.dragging = false; MT.guides = []; },
  /* 选项栏：读数（＝AI 资讯面板；agent 用 measure.info） */
  buildOptions(box, add){
    const sp = document.createElement('span'); sp.className = 'msInfo'; sp.style.cssText = 'font:12px monospace;white-space:pre';
    add('msInfo', sp); MT.bar = sp; MT.refreshBar();
  },
  drawOverlay(ctx, s){ MT.drawOverlay(ctx, s); }
});
})();
