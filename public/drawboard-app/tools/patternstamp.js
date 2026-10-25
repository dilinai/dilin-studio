/* 图案图章工具（PS S，ps.pattern-stamp）——🔴 原码没有·照 PS 2020 写（ArtCraft／PhotoCraft 没有图案图章；图案库与平铺有：
   engine/src/pattern_cmds.rs、compose/src/pattern.rs，已由 menus/impl/ps-edit.js 翻好成 PsEdit.patterns，这里读它）。
   笔尖／覆盖图／贴回图层借 window.HealCore（tools/spotheal.js 照 paint/src/lib.rs、dynamics.rs、retouch.rs 翻的 dab_coverage、walk_dabs、
   stroke_coverage、apply_coverage）；Shift 拉直线、Ctrl+Alt 拖改大小与硬度、笔尖圈照 clone.js／spotheal.js 那套（HealCore.constrain／resized／drawCommon）。
   PS 2020 的行为（我们照做）：
   - 拖曳＝用笔刷把图案画进当前像素层；选项栏：模式、不透明度、流量、图案挑选器、对齐、印象派效果
   - 对齐（预设开）：图案对着文件原点铺，停笔再画也接得上；不对齐：每一笔图案从这一笔的起点重新开始铺
   - 印象派效果：每个笔印取图案在笔印那块的平均色、位置稍微抖动，画成一点一点的色块
   - 边拖边看得到（同 historybrush.js 的 Live），放开一次落定（一步历史）；有选区只画选区里；锁像素挡、锁透明像素 alpha 不变
   命令：patternstamp.paint / patternstamp.setOptions */
(function(){
const H = window.HealCore;
if (!H){ console.error('patternstamp.js: window.HealCore（tools/spotheal.js）没载入'); return; }
const RC = H.RC;
const asNum = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const L3 = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, 'en':c});
const C = 'patternstamp.paint';

/* 图案库（menus/impl/ps-edit.js PsEdit.patterns；它在工具档之后才载入 ⇒ 用的时候再读） */
const lib = () => (window.PsEdit && PsEdit.patterns) || null;
/* 预乘的图案瓦片（照 compose/src/pattern.rs Tile） */
const tileCache = new Map();
function tileOf(pat){
  let t = tileCache.get(pat.id); if (t) return t;
  const n = pat.width * pat.height, tp = new Float32Array(n*4);
  for (let i = 0; i < n; i++){ const a = pat.px[i*4+3]/255; tp[i*4] = pat.px[i*4]/255*a; tp[i*4+1] = pat.px[i*4+1]/255*a; tp[i*4+2] = pat.px[i*4+2]/255*a; tp[i*4+3] = a; }
  t = { w:pat.width, h:pat.height, tp }; tileCache.set(pat.id, t); return t;
}
/* pattern.rs Tile.sample：环绕双线性（像素中心 i+0.5），回直通 RGBA 0..1 */
function sample(t, u, v, out){
  const mod = (a, n) => ((a % n) + n) % n;
  u -= 0.5; v -= 0.5;
  const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
  let r = 0, g = 0, b = 0, a = 0;
  for (const [dy, wy] of [[0, 1-fy], [1, fy]]){ if (!wy) continue;
    for (const [dx, wx] of [[0, 1-fx], [1, fx]]){ if (!wx) continue;
      const j = (mod(y0+dy, t.h)*t.w + mod(x0+dx, t.w))*4, k = wx*wy;
      r += t.tp[j]*k; g += t.tp[j+1]*k; b += t.tp[j+2]*k; a += t.tp[j+3]*k; } }
  if (a > 0){ out[0] = r/a; out[1] = g/a; out[2] = b/a; out[3] = Math.min(a, 1); } else out[0] = out[1] = out[2] = out[3] = 0;
}
/* 小乱数（印象派效果的抖动；种子固定 ⇒ 命令可重现） */
function rng(seed){ let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function patternStamp(p, preview){
  const b = H.parseBrush(p, C); if (b.error) return {ok:false, error:b.error};
  const L = lib(); if (!L) return {ok:false, error:`${C}: pattern library (menus/impl/ps-edit.js) not loaded`};
  const pat = L.resolve(typeof p.pattern === 'string' ? p.pattern : '');
  if (!pat) return {ok:false, error:`${C}: no pattern "${p.pattern || ''}" (see ps.pattern.list)`};
  const mode = typeof p.mode === 'string' ? p.mode : 'normal';
  if (!BLENDS.includes(mode)) return {ok:false, error:`${C}: unknown blend mode \`${mode}\``};
  if (!preview){ const lf = H.lockFail(b.L, C); if (lf) return lf; }
  const aligned = p.aligned !== false, impressionist = p.impressionist === true;
  const scale = clamp(asNum(p.scale, 100), 1, 1000) / 100;
  const origin = aligned ? [0, 0] : [b.pts[0][0], b.pts[0][1]];
  const t = tileOf(pat), q = [0,0,0,0];
  const at = (X, Y) => sample(t, (X - origin[0]) / scale, (Y - origin[1]) / scale, q);
  let rect, cov, paint;
  if (!impressionist){
    ({ rect, cov } = H.strokeCoverage(b.pts, b.brush));
    if (RC.empty(rect)) return {ok:true, damage:[0,0,0,0]};
    const w = RC.w(rect), h = RC.h(rect), data = new Float32Array(w*h*4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      if (!(cov[y*w + x] > 0)) continue;
      at(rect[0] + x + 0.5, rect[1] + y + 0.5); data.set(q, (y*w + x)*4);
    }
    paint = { rect, ch:4, data };
  } else {
    // 印象派：每个笔印＝图案在笔印范围的平均色（预乘平均），中心抖动半径的一半
    const dabs = H.walkDabs(b.pts, b.brush), rnd = rng(asNum(p.seed, 1));
    if (!dabs.length) return {ok:true, damage:[0,0,0,0]};
    const rad = d => Math.max(b.brush.size * clamp(d[2], 0, 1) / 2, 0.5);
    const cs = dabs.map(d => { const r = rad(d); return [d[0] + (rnd()*2 - 1)*r*0.5, d[1] + (rnd()*2 - 1)*r*0.5, r]; });
    rect = null;
    for (const c of cs){ const rr = Math.ceil(c[2]) + 1, r = [Math.floor(c[0]) - rr, Math.floor(c[1]) - rr, Math.floor(c[0]) + rr + 1, Math.floor(c[1]) + rr + 1];
      rect = rect ? [Math.min(rect[0], r[0]), Math.min(rect[1], r[1]), Math.max(rect[2], r[2]), Math.max(rect[3], r[3])] : r; }
    const w = RC.w(rect), h = RC.h(rect), pre = new Float32Array(w*h*4);
    cov = new Float32Array(w*h);
    for (const c of cs){
      let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
      for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++){
        if (i*i + j*j > 9) continue;
        at(c[0] + i*c[2]/3, c[1] + j*c[2]/3); sr += q[0]*q[3]; sg += q[1]*q[3]; sb += q[2]*q[3]; sa += q[3]; n++;
      }
      const col = sa > 0 ? [sr/sa, sg/sa, sb/sa, sa/n] : [0, 0, 0, 0];
      const rr = Math.ceil(c[2]) + 1, cx = Math.floor(c[0]), cy = Math.floor(c[1]);
      for (let y = cy - rr; y <= cy + rr; y++) for (let x = cx - rr; x <= cx + rr; x++){
        const v = H.dabCoverage(Math.hypot(x + 0.5 - c[0], y + 0.5 - c[1]), c[2], b.brush.hardness) * b.brush.flow;
        if (!(v > 0)) continue;
        const i = (y - rect[1])*w + (x - rect[0]);
        // 后来的笔印盖在前面的上面（预乘 over），覆盖度照 stroke_coverage 累积
        for (let k = 0; k < 3; k++) pre[i*4+k] = col[k]*col[3]*v + pre[i*4+k]*(1 - col[3]*v);
        pre[i*4+3] = col[3]*v + pre[i*4+3]*(1 - col[3]*v);
        cov[i] = cov[i] + v*(1 - cov[i]);
      }
    }
    const data = new Float32Array(w*h*4);
    for (let i = 0; i < w*h; i++){ const a = pre[i*4+3]; if (a > 0){ data[i*4] = pre[i*4]/a; data[i*4+1] = pre[i*4+1]/a; data[i*4+2] = pre[i*4+2]/a; data[i*4+3] = Math.min(a / Math.max(cov[i], 1e-6), 1); } }
    paint = { rect, ch:4, data };
  }
  const r = H.applyCoverage(b.L, rect, cov, b.brush.opacity, paint, mode, H.lockAlpha(b.L));
  return { ok:true, pattern:pat.id, aligned, impressionist, damage:[r[0], r[1], r[2]-r[0], r[3]-r[1]] };
}
CMD.reg(C, {i18n:'tool.patternstamp', undoable:true,
  params:'{points:[[x,y,pressure?],…] 文件坐标（必填）, pattern?:图案 id|名字（缺省＝图案库第一个；见 ps.pattern.list）, aligned=true（对着文件原点铺；false＝从这一笔起点开始铺）, '
       + 'impressionist=false（印象派：每个笔印取图案平均色、位置抖动）, scale=1..1000=100（图案缩放 %）, seed=1（印象派抖动的种子）, '
       + 'size=工具大小 px, hardness=0..100, opacity=1..100=100, flow=1..100=100, spacing=1..1000（% of size）=25, mode="normal"|"multiply"|…=normal, layerId?=当前层} '
       + '用笔刷把图案画进像素层（有选区只画选区里）→ {ok, pattern, damage:[x,y,w,h]}'},
  p => patternStamp(p));

/* ───────── 界面 ───────── */
const U = { pattern:'', aligned:true, impressionist:false, opacity:100, flow:100, mode:'normal', scale:100,
            drag:null, lastEnd:null, resize:null, hover:null, alt:false, shift:false, status:null, seed:1 };
CMD.reg('patternstamp.setOptions', {i18n:'',
  params:'{pattern?:图案 id|名字, aligned?:bool, impressionist?:bool, opacity?:1..100, flow?:1..100, mode?:"normal"|…, scale?:1..1000, size?:px, hardness?:0..100} 滑鼠作画用的选项（＝选项栏）'}, p => {
  if (typeof p.pattern === 'string'){
    const l = lib(), q = l && l.resolve(p.pattern);
    if (p.pattern && !q) return {ok:false, error:`patternstamp.setOptions: no pattern "${p.pattern}"`};
    U.pattern = q ? q.id : '';
  }
  if (typeof p.aligned === 'boolean') U.aligned = p.aligned;
  if (typeof p.impressionist === 'boolean') U.impressionist = p.impressionist;
  if (typeof p.opacity === 'number') U.opacity = clamp(Math.round(p.opacity), 1, 100);
  if (typeof p.flow === 'number') U.flow = clamp(Math.round(p.flow), 1, 100);
  if (typeof p.mode === 'string' && BLENDS.includes(p.mode)) U.mode = p.mode;
  if (typeof p.scale === 'number') U.scale = clamp(p.scale, 1, 1000);
  if (typeof p.size === 'number') ToolState.size = clamp(Math.round(p.size), 1, 5000);
  if (typeof p.hardness === 'number') ToolState.hardness = clamp(p.hardness, 0, 100) / 100;
  if (window.UI && ToolState.cur === 'patternstamp' && !U.resize) UI.buildOptions('patternstamp');
  return { ok:true, pattern:U.pattern, aligned:U.aligned, impressionist:U.impressionist, opacity:U.opacity, flow:U.flow, mode:U.mode, scale:U.scale,
           size:ToolState.size, hardness:Math.round(ToolState.hardness*100) };
});
function strokeParams(points){
  return { points:points.map(q => [q[0], q[1], q[2]]), pattern:U.pattern, aligned:U.aligned, impressionist:U.impressionist,
           opacity:U.opacity, flow:U.flow, mode:U.mode, scale:U.scale, seed:U.seed };
}
function setStatus(st){
  U.status = st;
  const el = document.getElementById('psStatus'); if (el) el.textContent = st ? (st.key ? Lang.t(st.key) : String(st.text || '')) : '';
}
/* 边拖边看（同 historybrush.js Live）：按下备份这层；每帧还原上一帧画过的那块、整笔重算；放开还原、走 CMD 正式落一次 */
const Live = {
  begin(){ const L = Doc.active(); this.L = null; this.dmg = null;
    if (!L || L.kind !== 'raster') return;
    const cv = L.data.canvas, b = document.createElement('canvas'); b.width = cv.width; b.height = cv.height; b.getContext('2d').drawImage(cv, 0, 0);
    this.L = L; this.bak = b; },
  restore(){ const L = this.L, d = this.dmg; if (!L || !d) return;
    const x = Math.max(0, Math.floor(d[0] - L.x)), y = Math.max(0, Math.floor(d[1] - L.y));
    const w = Math.min(L.data.canvas.width - x, Math.ceil(d[2]) + 2), h = Math.min(L.data.canvas.height - y, Math.ceil(d[3]) + 2);
    if (w > 0 && h > 0){ const c = L.data.ctx; c.save(); c.setTransform(1,0,0,1,0,0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      c.clearRect(x, y, w, h); c.drawImage(this.bak, x, y, w, h, x, y, w, h); c.restore(); }
    this.dmg = null; },
  update(points){
    if (!this.L || Doc.active() !== this.L || (window.Locks && Locks.blocks(this.L, 'pixels'))) return;
    this.restore();
    const r = patternStamp(Object.assign(strokeParams(points), {layerId:this.L.id}), true);   // 预览不报锁（按下时已挡）
    if (r && r.ok) this.dmg = r.damage;
  },
  end(){ this.restore(); this.L = null; this.bak = null; }
};
function resizeUpdate(x, y){
  const r = U.resize, [size, hardness] = H.resized(r.start, x - r.anchor[0], y - r.anchor[1], UI.zoom);
  if (ToolState.size === size && ToolState.hardness === hardness) return;
  CMD.map['patternstamp.setOptions'].run({size, hardness:hardness*100});
}

const S = {
  'tool.patternstamp':  L3('圖樣印章工具', '图案图章工具', 'Pattern Stamp Tool'),
  'opt.ps.mode':        L3('模式：', '模式：', 'Mode:'),
  'opt.ps.opacity':     L3('不透明：', '不透明度：', 'Opacity:'),
  'opt.ps.flow':        L3('流量：', '流量：', 'Flow:'),
  'opt.ps.pattern':     L3('圖樣：', '图案：', 'Pattern:'),
  'ui.ps.aligned':      L3('對齊', '对齐', 'Aligned'),
  'ui.ps.impressionist':L3('印象派效果', '印象派效果', 'Impressionist'),
  'ui.ps.diameter':     L3('直徑：', '直径：', 'Diameter:'),
  'ui.ps.hardness':     L3('硬度：', '硬度：', 'Hardness:'),
};
const strings = {'zh-Hant':{}, 'zh-Hans':{}, 'en':{}};
Object.keys(S).forEach(k => Object.keys(strings).forEach(l => strings[l][k] = S[k][l]));

const tool = Tools.reg({
  id:'patternstamp', icon:'▦', group:'raster', order:47, for:'raster', needs:'raster', opts:['size','hardness'],
  cursor:'none', ui:U, strings, patternStamp,

  /* 选项栏照 PS 2020：笔刷（大小／硬度）｜模式｜不透明度｜流量｜图案▾｜对齐｜印象派效果 */
  buildOptions(box, add, mk){
    const mode = document.createElement('select'); mode.dataset.opt = 'psMode';
    BLENDS.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = Lang.t('blend.' + v); mode.appendChild(o); });
    mode.value = U.mode; mode.onchange = () => CMD.run('patternstamp.setOptions', {mode:mode.value});
    add('ps.mode', mode);
    const num = (key, val) => { const n = mk('number', {min:1, max:100, value:val}); n.dataset.opt = 'ps' + key; n.style.width = '52px';
      n.onchange = () => { if (n.value !== '' && isFinite(+n.value)) CMD.run('patternstamp.setOptions', {[key]: +n.value}); }; return n; };
    add('ps.opacity', num('opacity', U.opacity));
    add('ps.flow', num('flow', U.flow));
    const ps = document.createElement('select'); ps.dataset.opt = 'psPattern';
    const items = lib() ? lib().load() : [];
    items.forEach(q => { const o = document.createElement('option'); o.value = q.id; o.textContent = q.name; ps.appendChild(o); });
    ps.value = U.pattern || (items[0] && items[0].id) || '';
    ps.onchange = () => CMD.run('patternstamp.setOptions', {pattern:ps.value});
    add('ps.pattern', ps);
    const chk = (key, on) => { const l = document.createElement('label'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on; cb.dataset.opt = key;
      cb.onchange = () => CMD.run('patternstamp.setOptions', {[key]: cb.checked});
      l.appendChild(cb); const t = document.createElement('span'); t.textContent = Lang.t('ui.ps.' + key); l.appendChild(t); box.appendChild(l); };
    chk('aligned', U.aligned);
    chk('impressionist', U.impressionist);
    const st = document.createElement('span'); st.id = 'psStatus'; st.style.color = '#e8573f'; box.appendChild(st);
    setStatus(U.status);
  },

  onDown(e, pt, P){
    U.alt = e.altKey; U.shift = e.shiftKey; U.hover = pt;
    if (e.ctrlKey && e.altKey && !U.drag){ U.resize = { anchor:pt.slice(), start:[ToolState.size, ToolState.hardness] }; UI.draw(); return; }
    const L0 = Doc.active();
    if (L0 && L0.kind === 'raster' && window.Locks && Locks.deny(L0, 'pixels')){ P.down = false; return; }
    P.ensureRaster();
    const from = (e.shiftKey && U.lastEnd) ? U.lastEnd.slice() : null, pr = H.pressure(e);
    const points = [[pt[0], pt[1], pr]]; if (from) points.unshift([from[0], from[1], pr]);
    U.seed = (U.seed % 100000) + 1;                     // 每笔换一个印象派种子（预览与落定同一个）
    U.drag = { start: from || pt.slice(), points, axis:null };
    Live.begin(); Live.update(points);
    UI.draw();
  },
  onMove(e, pt, P){
    U.alt = e.altKey; U.shift = e.shiftKey; U.hover = pt;
    if (U.resize){ resizeUpdate(pt[0], pt[1]); UI.draw(); return; }
    const d = U.drag;
    if (d && P.down){
      const last = d.points[d.points.length-1], q = H.constrain(d, last, pt, e.shiftKey);
      if (Math.abs(last[0]-q[0]) + Math.abs(last[1]-q[1]) > 0.25){ d.points.push([q[0], q[1], H.pressure(e)]); Live.update(d.points); }
    }
    UI.draw();
  },
  onUp(e, pt){
    U.alt = e.altKey; U.shift = e.shiftKey;
    if (U.resize){ resizeUpdate(pt[0], pt[1]); U.resize = null; CMD.run('patternstamp.setOptions', {}); return; }
    const d = U.drag; U.drag = null;
    if (!d){ UI.draw(); return; }
    const last = d.points[d.points.length-1], q = H.constrain(d, last, pt, e.shiftKey);
    if (last[0] !== q[0] || last[1] !== q[1]) d.points.push([q[0], q[1], last[2]]);
    U.lastEnd = d.points[d.points.length-1].slice(0, 2);
    Live.end();
    const r = CMD.run(C, strokeParams(d.points));
    setStatus(r && r.ok === false ? {text:r.error} : null);
    UI.refresh();
  },
  onDeactivate(){ if (U.drag) Live.end(); U.drag = null; U.resize = null; U.hover = null; },
  drawOverlay(ctx, s){ H.drawCommon(ctx, s, U, { trail:false, centre: r => r > 6, readout:['ui.ps.diameter', 'ui.ps.hardness'] }); }
});

function modKey(e){
  if (ToolState.cur !== 'patternstamp' || !window.UI || !UI.canvas) return;
  if ((e.key === 'Alt' || e.key === 'Shift') && (e.altKey !== U.alt || e.shiftKey !== U.shift)){ U.alt = e.altKey; U.shift = e.shiftKey; UI.draw(); }
}
document.addEventListener('keydown', modKey);
document.addEventListener('keyup', modKey);
window.PatternStampTool = tool;
/* 描边路径（PS 路径面板 ▸ 描边路径 ▸ 图案图章）：同滑鼠收笔那包参数（图案／对齐／印象派…） */
tool.pathParams = (L, points) => Object.assign(strokeParams(points), { layerId:L.id });
})();
