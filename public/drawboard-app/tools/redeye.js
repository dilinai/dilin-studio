/* 红眼工具（PS J，ps.red-eye）——🔴 原码没有·照 PS 2020 写（ArtCraft／PhotoCraft 没有红眼：grep red.?eye 于 photocraft/crates 没有结果）。
   PS 2020 的行为（我们照做）：
   - 在红眼上点一下：从点到的地方找出那一团「偏红」的瞳孔（相连的红色像素），把红去掉、压暗
   - 拖一个框框住眼睛：框里所有偏红的像素一起处理（PS 也可以拖框）
   - 选项栏：瞳孔大小 1–100%（预设 50：越大，判成瞳孔的红色门槛越低、范围往外扩越多）、变暗量 1–100%（预设 50）
   - 有选区就只改选区里（照 PS 一般规矩）；锁像素挡、锁透明像素＝alpha 不变
   算法（我们定的，PS 没公开）：红度 score＝(R−max(G,B))/R（R≥40 才算）；门槛 thr＝0.6−0.3×瞳孔大小（皮肤约 0.25 不会被当成瞳孔）；
   点一下＝点附近 8px 内红度×R 最高那格当种子、8 连通长出红度≥thr 的一团（限 160px 方框）；拖框＝框内红度≥thr 全部；
   再往外扩 round(瞳孔大小/34) 格（扩出来那圈要求红度≥0.7×thr）、遮罩 3×3 模糊一次（边缘柔）；
   修正：R'=(G+B)/2，三通道再乘 (1−0.85×变暗量)，按遮罩混回去。
   命令：redeye.fix / redeye.setOptions */
(function(){
const asNum = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const L3 = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, 'en':c});
const C = 'redeye.fix';
const CLICK_DIST = 6, SEED_R = 8, MAX_BOX = 160;

const score = (r, g, b) => r < 40 ? 0 : Math.max(0, (r - Math.max(g, b)) / r);

function redEye(p){
  const lid = p.layerId !== undefined ? p.layerId : p.layer;
  const L = lid !== undefined ? Doc.byId(lid) : Doc.active();
  if (!L) return {ok:false, error:`${C}: no active layer`};
  if (L.kind !== 'raster') return {ok:false, error:`${C}: active layer is a ${L.kind} layer, not a pixel layer`};
  const pupil = clamp(asNum(p.pupilSize, 50), 1, 100) / 100, dark = clamp(asNum(p.darken, 50), 1, 100) / 100;
  let area, seed = null;
  if (Array.isArray(p.rect) && p.rect.length === 4 && p.rect.every(v => typeof v === 'number' && isFinite(v))){
    const [x, y, w, h] = p.rect;
    area = [Math.floor(Math.min(x, x+w)), Math.floor(Math.min(y, y+h)), Math.ceil(Math.max(x, x+w)), Math.ceil(Math.max(y, y+h))];
  } else if (typeof p.x === 'number' && typeof p.y === 'number' && isFinite(p.x) && isFinite(p.y)){
    seed = [Math.floor(p.x), Math.floor(p.y)];
    area = [seed[0] - MAX_BOX/2, seed[1] - MAX_BOX/2, seed[0] + MAX_BOX/2, seed[1] + MAX_BOX/2];
  } else return {ok:false, error:`${C}: give {x,y} (click) or {rect:[x,y,w,h]} (drag a box)`};
  if (window.Locks && CMD._depth <= 1){
    const k = Locks.blocks(L, 'pixels');
    if (k){ Locks.notify(Locks.message(L, k)); return Locks.fail(L, k, C); }
  }
  const lock = !!(window.Locks && Locks.alpha(L));
  // 文件坐标的工作框（多留 3 格给外扩与模糊），裁到这层画布
  const cw = L.data.canvas.width, ch = L.data.canvas.height;
  const ax0 = Math.max(area[0] - 3, L.x), ay0 = Math.max(area[1] - 3, L.y), ax1 = Math.min(area[2] + 3, L.x + cw), ay1 = Math.min(area[3] + 3, L.y + ch);
  if (ax1 <= ax0 || ay1 <= ay0) return {ok:false, error:`${C}: outside the layer`};
  const w = ax1 - ax0, h = ay1 - ay0;
  const img = L.data.ctx.getImageData(ax0 - L.x, ay0 - L.y, w, h), d = img.data;
  const sc = new Float32Array(w*h);
  for (let i = 0; i < w*h; i++) sc[i] = d[i*4+3] > 0 ? score(d[i*4], d[i*4+1], d[i*4+2]) : 0;
  const thr = 0.6 - 0.3*pupil;
  const inArea = (x, y) => x + ax0 >= area[0] && x + ax0 < area[2] && y + ay0 >= area[1] && y + ay0 < area[3];
  const m = new Uint8Array(w*h);
  if (seed){
    // 种子：点附近最红的那格
    let best = -1, bi = -1;
    const sx = seed[0] - ax0, sy = seed[1] - ay0;
    for (let y = Math.max(0, sy - SEED_R); y <= Math.min(h - 1, sy + SEED_R); y++)
      for (let x = Math.max(0, sx - SEED_R); x <= Math.min(w - 1, sx + SEED_R); x++){
        if (Math.hypot(x - sx, y - sy) > SEED_R) continue;
        const i = y*w + x, v = sc[i] * d[i*4];
        if (sc[i] >= thr && v > best){ best = v; bi = i; }
      }
    if (bi < 0) return {ok:false, error:`${C}: no red eye found near (${seed[0]}, ${seed[1]})`, found:0};
    const st = [bi]; m[bi] = 1;
    while (st.length){
      const i = st.pop(), x = i % w, y = (i / w) | 0;
      for (let ddy = -1; ddy <= 1; ddy++) for (let ddx = -1; ddx <= 1; ddx++){
        const X = x + ddx, Y = y + ddy; if (X < 0 || Y < 0 || X >= w || Y >= h || !inArea(X, Y)) continue;
        const j = Y*w + X; if (m[j] || sc[j] < thr) continue;
        m[j] = 1; st.push(j);
      }
    }
  } else {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inArea(x, y) && sc[y*w + x] >= thr) m[y*w + x] = 1;
  }
  let found = 0; for (let i = 0; i < w*h; i++) found += m[i];
  if (!found) return {ok:false, error:`${C}: no red pixels found`, found:0};
  // 往外扩（瞳孔大小）：扩出来的格子也要带点红
  const grow = Math.round(pupil * 100 / 34);
  for (let g = 0; g < grow; g++){
    const add = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const i = y*w + x; if (m[i] || sc[i] < thr*0.7) continue;
      if ((x > 0 && m[i-1]) || (x+1 < w && m[i+1]) || (y > 0 && m[i-w]) || (y+1 < h && m[i+w])) add.push(i);
    }
    add.forEach(i => m[i] = 1);
  }
  // 遮罩柔边：3×3 平均，但只留在「有红」的格子上（不会把旁边的皮肤也压暗）
  const k = new Float32Array(w*h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y*w + x; if (!(m[i] || sc[i] > 0)) continue;
    let s = 0, n = 0;
    for (let ddy = -1; ddy <= 1; ddy++) for (let ddx = -1; ddx <= 1; ddx++){
      const X = x + ddx, Y = y + ddy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; s += m[Y*w + X]; n++;
    }
    k[i] = m[i] ? Math.max(s / n, 0.75) : (sc[i] >= thr*0.7 ? (s / n) * Math.min(sc[i] / Math.max(thr, 1e-3), 1) : 0);
  }
  const sel = Doc.sel, f = 1 - 0.85*dark;
  let bb = null, changed = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y*w + x; let a = k[i]; if (!(a > 0)) continue;
    if (sel) a *= window.SelMask ? SelMask.coverage(x + ax0, y + ay0, sel) : 1;
    if (!(a > 0)) continue;
    if (lock && d[i*4+3] <= 0) continue;
    const r = d[i*4], g = d[i*4+1], b = d[i*4+2];
    const nr = (g + b) / 2 * f, ng = g * f, nb = b * f;
    d[i*4] = r + (nr - r)*a; d[i*4+1] = g + (ng - g)*a; d[i*4+2] = b + (nb - b)*a;
    changed++;
    const X = x + ax0, Y = y + ay0;
    if (!bb) bb = [X, Y, X+1, Y+1]; else { bb[0] = Math.min(bb[0], X); bb[1] = Math.min(bb[1], Y); bb[2] = Math.max(bb[2], X+1); bb[3] = Math.max(bb[3], Y+1); }
  }
  if (!changed) return {ok:false, error:`${C}: nothing to change (outside the selection?)`, found};
  L.data.ctx.putImageData(img, ax0 - L.x, ay0 - L.y);
  return { ok:true, found, changed, damage:[bb[0], bb[1], bb[2]-bb[0], bb[3]-bb[1]] };
}
CMD.reg(C, {i18n:'tool.redeye', undoable:true,
  params:'{x, y:点一下的文件坐标（找点附近相连的那团红）| rect:[x,y,w,h] 拖的框（框内偏红全部处理）, pupilSize=1..100=50（瞳孔大小 %）, darken=1..100=50（变暗量 %）, layerId?=当前层} '
       + '有选区只改选区里；找不到红色回 ok:false（不留空步）→ {ok, found:判成瞳孔的格数, changed, damage:[x,y,w,h]}'},
  redEye);

const U = { pupilSize:50, darken:50, drag:null, hover:null, status:null };
CMD.reg('redeye.setOptions', {i18n:'', params:'{pupilSize?:1..100, darken?:1..100} 滑鼠用的选项（＝选项栏）'}, p => {
  if (typeof p.pupilSize === 'number') U.pupilSize = Math.round(clamp(p.pupilSize, 1, 100));
  if (typeof p.darken === 'number') U.darken = Math.round(clamp(p.darken, 1, 100));
  if (window.UI && ToolState.cur === 'redeye') UI.buildOptions('redeye');
  return { ok:true, pupilSize:U.pupilSize, darken:U.darken };
});
function setStatus(st){
  U.status = st;
  const el = document.getElementById('reStatus'); if (el) el.textContent = st ? (st.key ? Lang.t(st.key) : String(st.text || '')) : '';
}

const S = {
  'tool.redeye':   L3('紅眼工具', '红眼工具', 'Red Eye Tool'),
  'opt.re.pupil':  L3('瞳孔大小：', '瞳孔大小：', 'Pupil Size:'),
  'opt.re.darken': L3('變暗量：', '变暗量：', 'Darken Amount:'),
  'ui.re.none':    L3('找不到紅眼', '找不到红眼', 'No red eye found'),
};
const strings = {'zh-Hant':{}, 'zh-Hans':{}, 'en':{}};
Object.keys(S).forEach(k => Object.keys(strings).forEach(l => strings[l][k] = S[k][l]));

const tool = Tools.reg({
  id:'redeye', icon:'◉', group:'raster', order:44, for:'raster', needs:'raster',
  ui:U, strings,
  buildOptions(box, add, mk){
    const num = (key, lab, v) => { const n = mk('number', {min:1, max:100, value:v}); n.dataset.opt = key; n.style.width = '52px';
      n.onchange = () => { if (n.value !== '' && isFinite(+n.value)) CMD.run('redeye.setOptions', {[key]: +n.value}); };
      add(lab, n); const pc = document.createElement('span'); pc.textContent = '%'; box.appendChild(pc); };
    num('pupilSize', 're.pupil', U.pupilSize);
    num('darken', 're.darken', U.darken);
    const st = document.createElement('span'); st.id = 'reStatus'; st.style.color = '#e8573f'; box.appendChild(st);
    setStatus(U.status);
  },
  onDown(e, pt, P){
    U.hover = pt;
    const L = Doc.active();
    if (!L || L.kind !== 'raster'){ P.down = false; return; }
    if (window.Locks && Locks.deny(L, 'pixels')){ P.down = false; return; }
    U.drag = { start:pt.slice(), cur:pt.slice(), client0:[e.clientX, e.clientY], moved:false };
  },
  onMove(e, pt, P){
    U.hover = pt;
    const d = U.drag;
    if (d && P.down){
      d.cur = pt.slice();
      if (!d.moved && Math.hypot(e.clientX - d.client0[0], e.clientY - d.client0[1]) > CLICK_DIST) d.moved = true;
      UI.draw();
    }
  },
  onUp(e, pt){
    const d = U.drag; U.drag = null;
    if (!d){ UI.draw(); return; }
    const params = { pupilSize:U.pupilSize, darken:U.darken };
    if (d.moved) params.rect = [Math.min(d.start[0], pt[0]), Math.min(d.start[1], pt[1]), Math.abs(pt[0] - d.start[0]), Math.abs(pt[1] - d.start[1])];
    else { params.x = d.start[0]; params.y = d.start[1]; }
    const r = CMD.run(C, params);
    setStatus(r && r.ok === false ? (r.found === 0 ? {key:'ui.re.none'} : {text:r.error}) : null);
    UI.refresh();
  },
  onKey(e){ if (e.key === 'Escape' && U.drag){ U.drag = null; UI.draw(); return true; } return false; },
  onDeactivate(){ U.drag = null; U.hover = null; },
  drawOverlay(ctx, s){
    const d = U.drag; if (!d || !d.moved) return;
    const dpr = s / UI.zoom, x = Math.min(d.start[0], d.cur[0])*s, y = Math.min(d.start[1], d.cur[1])*s;
    const w = Math.abs(d.cur[0] - d.start[0])*s, h = Math.abs(d.cur[1] - d.start[1])*s;
    ctx.save(); ctx.lineWidth = dpr; ctx.strokeStyle = '#fff'; ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([4*dpr, 4*dpr]); ctx.strokeStyle = '#000'; ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.restore();
  }
});
window.RedEyeTool = tool;
})();
