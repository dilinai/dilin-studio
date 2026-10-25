/* 修饰文字工具（AI ai.touch-type，Shift+T）——原码没有·照 AI 2020 写
   ArtCraft VectorCraft 的 tools/src/catalog.rs:42 只登记了 touchType 这一项（名字、图示、Shift+T），tools/src 里没有它的实作（text.rs 只有 Type／Area／OnPath 三种），
   所以这颗照 Illustrator 2020 的「修饰文字工具」行为写：
     · 点文字里的一个字＝选中那个字（字外面一个框）；点空白处＝取消
     · 框上的把手（AI 2020）：左上＝垂直缩放、右上＝等比缩放、右下＝水平缩放、左下（空心点）与框里面＝移动（水平＝字距、垂直＝基线偏移）、
       框上方的圆点＝旋转；缩放以字的基线左端为准、旋转绕字框中心
     · 拖曳时 Shift：移动只走水平或垂直、旋转每 45° 一格、缩放（左上／右下）照常；Esc＝取消选取
     · 改的只是那一个字：前后的字不动（AI 的移动会同时改这个字前后的字距）；水平缩放让后面的字跟着让位（字变宽）
   资料：文字层 L.data.touch = {"<字元索引>": {dx, dy（字的本地坐标，y 往下）, sx, sy, rot（度，逆时针为正）}}（跟着历史快照与工程档走）。
   画：带 touch 的文字层由本档逐字照 menus/impl/ai-type.js 的版面（AiType.layoutOf）乘上各字的变形画出来——engine.js renderLayer／Project.toSVG 认 TouchType.touched 交给本档。
   🔴 改文件全走 CMD：touchtype.select（选字，不进历史）／touchtype.set（设一个字的变形，可并成一步）／touchtype.reset／touchtype.info／touchtype.deselect。 */
(function(){
'use strict';

const AT = () => window.AiType;
const chars = s => Array.from(String(s == null ? '' : s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const zoom = () => Math.max((window.UI && UI.zoom) || 1, 0.01);
const tol = px => px / zoom();
const isText = L => !!L && L.kind === 'text';
const ID = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [m[0]*n[0] + m[2]*n[1], m[1]*n[0] + m[3]*n[1], m[0]*n[2] + m[2]*n[3], m[1]*n[2] + m[3]*n[3], m[0]*n[4] + m[2]*n[5] + m[4], m[1]*n[4] + m[3]*n[5] + m[5]];
const ap = (m, p) => [m[0]*p[0] + m[2]*p[1] + m[4], m[1]*p[0] + m[3]*p[1] + m[5]];
const T = (x, y) => [1, 0, 0, 1, x, y];
const R = a => { const c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; };
const S = (x, y) => [x, 0, 0, y, 0, 0];
function inv(m){ const d = m[0]*m[3] - m[1]*m[2] || 1e-12; return [m[3]/d, -m[1]/d, -m[2]/d, m[0]/d, (m[2]*m[5] - m[3]*m[4])/d, (m[1]*m[4] - m[0]*m[5])/d]; }
const DEF = {dx:0, dy:0, sx:1, sy:1, rot:0};
const touchOf = (d, i) => Object.assign({}, DEF, (d.touch && d.touch[i]) || {});
const hasTouch = L => isText(L) && L.data && L.data.touch && Object.keys(L.data.touch).length > 0;

/* 一个字自己的变形（字的本地坐标：原点＝基线左端、x 沿字前进方向）：先以原点缩放，再绕缩放后的字框中心转，再平移 */
function local(t, adv, asc, desc){
  const c = [adv * t.sx / 2, (desc - asc) * t.sy / 2];
  return mul(T(t.dx, t.dy), mul(T(c[0], c[1]), mul(R(-t.rot * Math.PI / 180), mul(T(-c[0], -c[1]), S(t.sx, t.sy)))));
}
/* 套上修饰后的每个字：{ch, i, base（不含自身变形、含前面的字让位）, m（最终矩阵）, adv, t} */
function glyphs(L){
  const lay = AT().layoutOf(L), d = L.data, out = [];
  const lineOfI = i => { const k = lay.lines.findIndex(l => i >= l.start && i < l.end); return k < 0 ? 0 : k; };
  let shift = 0, li = -1;
  for (const g of lay.glyphs){
    const l = lay.onPath ? 0 : lineOfI(g.i);
    if (l !== li){ shift = 0; li = l; }
    const t = touchOf(d, g.i);
    const base = mul(g.m, T(shift, 0));
    out.push({ch:g.ch, i:g.i, base, m:mul(base, local(t, g.adv, lay.asc, lay.desc)), adv:g.adv, t});
    shift += (t.sx - 1) * g.adv;
  }
  return {list:out, asc:lay.asc, desc:lay.desc};
}
const quadOf = (g, asc, desc) => [[0, -asc], [g.adv, -asc], [g.adv, desc], [0, desc]].map(p => ap(g.m, p));
function inQuad(q, p){
  let s = 0;
  for (let k = 0; k < 4; k++){ const a = q[k], b = q[(k + 1) % 4], c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); if (c !== 0){ if (s && Math.sign(c) !== s) return false; s = Math.sign(c); } }
  return true;
}

/* 画带修饰的文字层（铁律①：按 scale 重画；铁律③：按视角缓存） */
function renderTouch(L, scale){
  if (L._cache && L._cacheScale === scale) return L._cache;
  const W = Math.max(1, Math.round(Doc.width * scale)), H = Math.max(1, Math.round(Doc.height * scale));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), d = L.data;
  x.font = `${d.weight || 'normal'} ${d.size}px ${d.font}`; x.fillStyle = d.color; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  for (const g of glyphs(L).list){
    if (/\s/.test(g.ch) || /\p{Cc}/u.test(g.ch) || g.ch === '­') continue;
    const m = g.m; x.setTransform(m[0] * scale, m[1] * scale, m[2] * scale, m[3] * scale, m[4] * scale, m[5] * scale);
    x.fillText(g.ch, 0, 0);
  }
  L._cache = c; L._cacheScale = scale;
  return c;
}
function useTouch(L){ try { return hasTouch(L) && !!AT(); } catch (e){ return false; } }
/* SVG 导出：跟 renderTouch 同一套字形矩阵，一个字一个 <text> */
const escX = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function toSVG(L, op){
  const d = L.data, n = v => +v.toFixed(4);
  let out = `<g${op || ''}>\n`;
  for (const g of glyphs(L).list){
    if (/\s/.test(g.ch) || /\p{Cc}/u.test(g.ch) || g.ch === '­') continue;
    out += `  <text transform="matrix(${g.m.map(n).join(' ')})" font-size="${d.size}" font-family="${escX(d.font)}" font-weight="${d.weight || 'normal'}" fill="${d.color}">${escX(g.ch)}</text>\n`;
  }
  return out + `</g>\n`;
}
// engine.js renderLayer／Project.toSVG 认 TouchType.touched 就交给本档画；ai-type、ps-type、绕排那几层包法看到 touched 也让路（修饰优先）

/* ═══════════ 状态与命中 ═══════════ */
const TS = {layer:null, index:null, drag:null};
function selected(){
  const L = TS.layer ? Doc.byId(TS.layer) : null;
  if (!isText(L) || TS.index === null || TS.index >= chars(L.data.text).length){ TS.layer = null; TS.index = null; return null; }
  return L;
}
/* 点到哪个字：最上面、看得见、没锁的文字层里，套过修饰的字框包住这一点（后排的字先） */
function charAt(p){
  for (let k = Doc.layers.length - 1; k >= 0; k--){
    const L = Doc.layers[k];
    if (!isText(L) || !L.visible || (L.data && L.data.typeMask) || Locks.blocks(L, 'pixels')) continue;
    let G; try { G = glyphs(L); } catch (e){ continue; }
    for (let j = G.list.length - 1; j >= 0; j--){
      const g = G.list[j]; if (g.ch === '\n') continue;
      if (inQuad(quadOf(g, G.asc, G.desc), p)) return {layer:L, i:g.i};
    }
  }
  return null;
}
/* 选中那个字的框与把手（文件坐标） */
function handles(L, i){
  const G = glyphs(L), g = G.list.find(x => x.i === i); if (!g) return null;
  const q = quadOf(g, G.asc, G.desc);                                   // 左上、右上、右下、左下
  const top = [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2], cen = [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];
  const up = [top[0] - cen[0], top[1] - cen[1]], ul = Math.hypot(up[0], up[1]) || 1;
  const rot = [top[0] + up[0] / ul * tol(18), top[1] + up[1] / ul * tol(18)];
  return {g, G, q, tl:q[0], tr:q[1], br:q[2], bl:q[3], top, rot, cen};
}

/* ═══════════ 命令 ═══════════ */
const Coal = {key:null, top:null};
function historyStep(key){
  const top = History.past[History.past.length - 1];
  if (key && key === Coal.key && top && top === Coal.top) return;
  History.push();
  Coal.key = key || null; Coal.top = History.past[History.past.length - 1];
}
const textLayer = id => { const L = id ? Doc.byId(id) : selected(); return isText(L) ? L : null; };
function info(L, i){
  const G = glyphs(L);
  return {ok:true, layerId:L.id, index:i, touch:JSON.parse(JSON.stringify(L.data.touch || {})),
    glyphs:G.list.filter(g => i === undefined || i === null || g.i === i).map(g => ({i:g.i, ch:g.ch, t:g.t, quad:quadOf(g, G.asc, G.desc)}))};
}
CMD.reg('touchtype.select', {i18n:'', params:'{layerId, index（字元索引）| x,y 文件坐标（选那一点上的字）} 选中一个字（不进历史；画面上出现修饰框）→ {ok, layerId, index, touch, glyphs:[{i,ch,t,quad}]}'}, p => {
  let L, i;
  if (isFinite(+p.x) && isFinite(+p.y) && p.index === undefined){ const h = charAt([+p.x, +p.y]); if (!h){ TS.layer = TS.index = null; return {ok:false, error:'no character there'}; } L = h.layer; i = h.i; }
  else { L = textLayer(p.layerId); i = +p.index; }
  if (!L) return {ok:false, error:'not a text layer'};
  const cs = chars(L.data.text);
  if (!(i >= 0 && i < cs.length) || cs[i] === '\n') return {ok:false, error:'index out of range'};
  if (Locks.blocks(L, 'pixels')) return Locks.fail(L, Locks.blocks(L, 'pixels'), 'touchtype.select');
  TS.layer = L.id; TS.index = i;
  if (window.AiSel) AiSel.text = [];
  return info(L, i);
});
CMD.reg('touchtype.deselect', {i18n:'', params:'{} 取消选中的字（Esc）'}, () => { TS.layer = TS.index = null; return {ok:true}; });
CMD.reg('touchtype.set', {i18n:'', params:'{layerId?, index?（缺省＝选中的字）, dx?, dy?（字的本地坐标位移，x 沿字前进、y 往下；dx＝字距、dy＝基线偏移的反向）, sx?, sy?（水平／垂直缩放，0.01～100）, rot?（度，逆时针为正）, coalesce?:str（同一个键连续设只算一步历史，拖曳用）} 设一个字的修饰（给的栏位换掉、没给的留着） → 同 touchtype.info'}, p => {
  const L = textLayer(p.layerId); if (!L) return {ok:false, error:'not a text layer'};
  const i = p.index !== undefined ? +p.index : (L.id === TS.layer ? TS.index : null);
  const cs = chars(L.data.text);
  if (!(i >= 0 && i < cs.length)) return {ok:false, error:'index out of range'};
  if (Locks.blocks(L, 'pixels')) return Locks.fail(L, Locks.blocks(L, 'pixels'), 'touchtype.set');
  const t = touchOf(L.data, i), num = (v, d) => (v === undefined || v === null || !isFinite(+v)) ? d : +v;
  const n = {dx:num(p.dx, t.dx), dy:num(p.dy, t.dy), sx:clamp(num(p.sx, t.sx), 0.01, 100), sy:clamp(num(p.sy, t.sy), 0.01, 100), rot:num(p.rot, t.rot)};
  historyStep(p.coalesce);
  const touch = Object.assign({}, L.data.touch || {});
  if (n.dx === 0 && n.dy === 0 && n.sx === 1 && n.sy === 1 && n.rot === 0) delete touch[i]; else touch[i] = n;
  if (Object.keys(touch).length) L.data.touch = touch; else delete L.data.touch;
  Layer.invalidate(L);
  return info(L, i);
});
CMD.reg('touchtype.reset', {i18n:'', params:'{layerId?, index?（缺省＝整层所有字）} 清掉修饰（一步历史）'}, p => {
  const L = textLayer(p.layerId); if (!L) return {ok:false, error:'not a text layer'};
  if (!L.data.touch) return {ok:true, changed:false};
  History.push();
  if (p.index !== undefined){ const t = Object.assign({}, L.data.touch); delete t[+p.index]; if (Object.keys(t).length) L.data.touch = t; else delete L.data.touch; }
  else delete L.data.touch;
  Layer.invalidate(L);
  return {ok:true, changed:true};
});
CMD.reg('touchtype.info', {i18n:'', params:'{layerId?, index?, all?:bool} 文字层每个字套过修饰的框（文件坐标四角）与修饰值；没给 layerId＝选中那个字所在的层；没给 index 又不是 all＝只回选中的那个字'}, p => {
  const L = textLayer(p.layerId); if (!L) return {ok:false, error:'not a text layer'};
  return info(L, p.all ? undefined : p.index !== undefined ? +p.index : (L.id === TS.layer ? TS.index : undefined));
});

/* ═══════════ 工具 ═══════════ */
let _n = 0;
const STRINGS = {
  'zh-Hant':{'tool.touchtype':'觸控文字工具', 'ui.touchtypeHint':'點一個字＝選取 · 拖框內＝移動（字距／基線偏移）· 左上＝垂直縮放、右上＝等比、右下＝水平 · 上方圓點＝旋轉 · Shift 限制方向／45° · Esc 取消'},
  'zh-Hans':{'tool.touchtype':'修饰文字工具', 'ui.touchtypeHint':'点一个字＝选中 · 拖框内＝移动（字距／基线偏移）· 左上＝垂直缩放、右上＝等比、右下＝水平 · 上方圆点＝旋转 · Shift 限制方向／45° · Esc 取消'},
  'en':{'tool.touchtype':'Touch Type Tool', 'ui.touchtypeHint':'Click a character to select it · drag inside: move (kerning / baseline shift) · top-left: vertical scale, top-right: uniform, bottom-right: horizontal · dot above: rotate · Shift constrains / 45° · Esc deselects'}
};
const near = (a, b, t) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= t;
Tools.reg({
  id:'touchtype', icon:'T', group:'vector', order:906, for:'vector', opts:[], cursor:'default', strings:STRINGS, hint:'ui.touchtypeHint',
  onDown(e, pt){
    if (e.button !== undefined && e.button !== 0) return;
    TS.drag = null;
    const L = selected();
    if (L){
      const h = handles(L, TS.index), t = tol(5);
      let kind = null;
      if (h){
        if (near(pt, h.rot, t)) kind = 'rot';
        else if (near(pt, h.tl, t)) kind = 'sy';
        else if (near(pt, h.tr, t)) kind = 'uni';
        else if (near(pt, h.br, t)) kind = 'sx';
        else if (near(pt, h.bl, t) || inQuad(h.q, pt)) kind = 'move';
      }
      if (kind){
        const g = h.g, t0 = g.t;
        // 拖曳开始时的参考框：字的基线框（含前面的字让位、不含自身变形）
        TS.drag = {kind, L:L.id, i:TS.index, start:pt.slice(), t0, key:'touch-' + (++_n), base:g.base, adv:g.adv, asc:h.G.asc, desc:h.G.desc, cen:h.cen};
        UI.draw(); return;
      }
    }
    const hit = charAt(pt);
    if (hit){
      CMD.run('touchtype.select', {layerId:hit.layer.id, index:hit.i});
      const g = glyphs(hit.layer), gg = g.list.find(x => x.i === hit.i);
      TS.drag = {kind:'move', L:hit.layer.id, i:hit.i, start:pt.slice(), t0:gg.t, key:'touch-' + (++_n), base:gg.base, adv:gg.adv, asc:g.asc, desc:g.desc};
    } else CMD.run('touchtype.deselect', {});
    UI.draw();
  },
  onMove(e, pt, P){
    const D = TS.drag;
    if (!P.down || !D){
      const L = selected(); let c = 'default';
      if (L){ const h = handles(L, TS.index), t = tol(5);
        if (h) c = near(pt, h.rot, t) ? 'grab' : near(pt, h.tl, t) ? 'ns-resize' : near(pt, h.tr, t) ? 'nesw-resize' : near(pt, h.br, t) ? 'ew-resize' : (near(pt, h.bl, t) || inQuad(h.q, pt)) ? 'move' : 'default'; }
      if (c === 'default' && charAt(pt)) c = 'pointer';
      if (UI.canvas && UI.canvas.style.cursor !== c) UI.canvas.style.cursor = c;
      return;
    }
    const t0 = D.t0, Bi = inv(D.base);
    const lp = ap(Bi, pt), ls = ap(Bi, D.start);                       // 指标在字的本地坐标（不含自身变形）
    const p = {layerId:D.L, index:D.i, coalesce:D.key};
    if (D.kind === 'move'){
      let dx = lp[0] - ls[0], dy = lp[1] - ls[1];
      if (e.shiftKey){ if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
      p.dx = t0.dx + dx; p.dy = t0.dy + dy;
    } else {
      const q = [lp[0] - t0.dx, lp[1] - t0.dy];                         // 去掉平移；缩放以基线左端为准（转角不大时近似）
      if (D.kind === 'sy') p.sy = clamp(-q[1] / D.asc, 0.01, 100);
      else if (D.kind === 'sx') p.sx = clamp(q[0] / D.adv, 0.01, 100);
      else if (D.kind === 'uni'){
        const f = (q[0] * D.adv + (-q[1]) * D.asc) / (D.adv * D.adv + D.asc * D.asc), f0 = (t0.sx * D.adv * D.adv + t0.sy * D.asc * D.asc) / (D.adv * D.adv + D.asc * D.asc);
        const k = clamp(f / (f0 || 1), 0.01, 100); p.sx = clamp(t0.sx * k, 0.01, 100); p.sy = clamp(t0.sy * k, 0.01, 100);
      } else if (D.kind === 'rot'){
        const c = D.cen;
        const a0 = Math.atan2(D.start[1] - c[1], D.start[0] - c[0]), a1 = Math.atan2(pt[1] - c[1], pt[0] - c[0]);
        let r = t0.rot - (a1 - a0) * 180 / Math.PI;                    // 画面上逆时针＝角度变大
        r = ((r + 180) % 360 + 360) % 360 - 180;
        if (e.shiftKey) r = Math.round(r / 45) * 45;
        p.rot = r;
      }
    }
    CMD.run('touchtype.set', p);
    UI.draw();
  },
  onUp(){ TS.drag = null; UI.draw(); },
  onKey(e){
    if (e.key === 'Escape' && selected()){ CMD.run('touchtype.deselect', {}); UI.draw(); return true; }
    return false;
  },
  onDeactivate(){ TS.drag = null; TS.layer = TS.index = null; },
  drawOverlay(ctx, s){
    const L = selected(); if (!L) return;
    const h = handles(L, TS.index); if (!h) return;
    const dpr = s / zoom(), r = 3.5 * dpr;
    ctx.save(); ctx.setLineDash([]); ctx.strokeStyle = '#2f7fd8'; ctx.lineWidth = dpr;
    ctx.beginPath(); h.q.forEach((p, k) => k ? ctx.lineTo(p[0] * s, p[1] * s) : ctx.moveTo(p[0] * s, p[1] * s)); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(h.top[0] * s, h.top[1] * s); ctx.lineTo(h.rot[0] * s, h.rot[1] * s); ctx.stroke();
    ctx.fillStyle = '#2f7fd8'; ctx.beginPath(); ctx.arc(h.rot[0] * s, h.rot[1] * s, r, 0, Math.PI * 2); ctx.fill();
    [h.tl, h.tr, h.br].forEach(p => { ctx.fillStyle = '#fff'; ctx.fillRect(p[0] * s - r, p[1] * s - r, 2 * r, 2 * r); ctx.strokeRect(p[0] * s - r, p[1] * s - r, 2 * r, 2 * r); });
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(h.bl[0] * s, h.bl[1] * s, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();   // 左下空心点＝移动
    ctx.restore();
  }
});

window.TouchType = {glyphs, charAt, handles, touched:useTouch, renderTouch, toSVG, state:TS};
})();
