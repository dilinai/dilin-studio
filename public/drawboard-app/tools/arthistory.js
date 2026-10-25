/* 历史记录艺术画笔工具（PS Y，ps.art-history-brush）——🔴 原码没有·照 PS 2020 写（ArtCraft／PhotoCraft 只有历史记录画笔 paint.historyBrush，没有艺术画笔）。
   来源借 window.HistoryBrush（tools/historybrush.js：resolveSource＝retouch_cmds.rs history_brush 取哪一步当来源、那一步要有这层且是像素；
   来源那一步跟历史记录画笔共用一份——PS 历史记录面板上只有一个「来源」标记）；Ctrl+Alt 改大小、笔尖圈借 window.HealCore。
   PS 2020 的行为（我们照做）：
   - 拖曳＝在游标四周「区域」那么大的范围里，撒出许多短笔触；每一笔的颜色取「来源历史状态」那一点的颜色，
     方向顺着来源影像的边（等亮度线，垂直于梯度）走，画出油画／素描感
   - 样式（10 种）：绷紧短／中／长、松散中等／长、轻涂、绷紧卷曲、绷紧卷曲长、松散卷曲、松散卷曲长
       绷紧＝紧跟边的方向；松散＝每步加随机偏转；卷曲＝每步固定转一个角度绕圈；轻涂＝只点一下；短／中／长＝笔触长 1.5／3／6 倍笔尖
   - 区域（0–500 px，预设 50）：撒笔触的范围直径，越大笔触越多
   - 容差（0–100%，预设 0）：只在「现在的颜色跟来源颜色差得够多」的地方下笔（0＝哪里都画）
   - 模式、不透明度；有选区只画选区里；锁像素挡、锁透明像素 alpha 不变；放开一次落定（一步历史），拖的时候看得到
   乱数用固定种子（seed）⇒ 同一串点、同一个种子，结果一样（agent 可重现）。
   命令：arthistory.paint / arthistory.setOptions */
(function(){
const H = window.HealCore;
const asNum = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const L3 = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, 'en':c});
const C = 'arthistory.paint';

/* 样式：len＝笔触长（笔尖倍数）；loose＝每步随机偏转（弧度）；curl＝每步固定转角（弧度）；dab＝只点一下 */
const STYLES = {
  tightShort:    {len:1.5, loose:0,    curl:0},
  tightMedium:   {len:3,   loose:0,    curl:0},
  tightLong:     {len:6,   loose:0,    curl:0},
  looseMedium:   {len:3,   loose:0.55, curl:0},
  looseLong:     {len:6,   loose:0.55, curl:0},
  dab:           {len:0,   loose:0,    curl:0, dab:true},
  tightCurl:     {len:3,   loose:0,    curl:0.5},
  tightCurlLong: {len:6,   loose:0,    curl:0.5},
  looseCurl:     {len:3,   loose:0.4,  curl:0.5},
  looseCurlLong: {len:6,   loose:0.4,  curl:0.5}
};
const STYLE_IDS = Object.keys(STYLES);

function rng(seed){ let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* 来源（historybrush.js resolveSource；错误字串换成本命令名） */
function resolveSource(p){
  if (!window.HistoryBrush || !HistoryBrush.resolveSource) return {error:`${C}: tools/historybrush.js not loaded`};
  const r = HistoryBrush.resolveSource(p);
  if (r.error) r.error = r.error.replace('historybrush.paint', C);
  return r;
}
/* 缓冲读（文件坐标；缓冲外＝透明） */
function px(S, X, Y, out){
  const x = Math.floor(X) - S.ox, y = Math.floor(Y) - S.oy;
  if (x < 0 || y < 0 || x >= S.w || y >= S.h){ out[0] = out[1] = out[2] = out[3] = 0; return out; }
  const i = (y*S.w + x)*4; out[0] = S.d[i]; out[1] = S.d[i+1]; out[2] = S.d[i+2]; out[3] = S.d[i+3]; return out;
}
const lum = (S, X, Y, q) => { px(S, X, Y, q); return (0.299*q[0] + 0.587*q[1] + 0.114*q[2]) * q[3] / 255; };

function parse(p){
  if (!Array.isArray(p.points)) return {error:`${C}: missing \`points\``};
  const pts = p.points.filter(a => Array.isArray(a) && typeof a[0] === 'number' && typeof a[1] === 'number' && isFinite(a[0]) && isFinite(a[1])).map(a => [a[0], a[1], 1]);
  if (!pts.length) return {error:`${C}: \`points\` is empty`};
  const style = p.style === undefined ? 'tightShort' : p.style;
  if (!STYLES[style]) return {error:`${C}: unknown style \`${style}\` (${STYLE_IDS.join('|')})`};
  const mode = typeof p.mode === 'string' ? p.mode : 'normal';
  if (!BLENDS.includes(mode)) return {error:`${C}: unknown blend mode \`${mode}\``};
  return { pts, style, mode,
    size: Math.max(asNum(p.size, ToolState.size), 1),
    hardness: clamp(asNum(p.hardness, ToolState.hardness*100), 0, 100) / 100,
    opacity: clamp(asNum(p.opacity, 100), 1, 100) / 100,
    area: clamp(asNum(p.area, 50), 0, 500),
    tolerance: clamp(asNum(p.tolerance, 0), 0, 100),
    seed: Math.floor(asNum(p.seed, 1)) };
}

/* 撒笔触：回 [{pts:[[x,y]…], color:[r,g,b,a]}]（文件坐标） */
function strokesFor(o, S, cur){
  const st = STYLES[o.style], out = [], q = [0,0,0,0], q2 = [0,0,0,0];
  // 撒点中心：沿路径每 max(区域/2, 笔尖/2) 一个（第一点必有）
  const spacing = Math.max(o.area / 2, o.size / 2, 1), centres = [o.pts[0]];
  let carry = 0;
  for (let i = 1; i < o.pts.length; i++){
    const a = o.pts[i-1], b = o.pts[i], len = Math.hypot(b[0]-a[0], b[1]-a[1]);
    let t = spacing - carry;
    while (t <= len){ centres.push([a[0] + (b[0]-a[0])*t/len, a[1] + (b[1]-a[1])*t/len]); t += spacing; }
    carry = (carry + len) % spacing;
  }
  const R = o.area / 2;
  const per = clamp(Math.round((o.area*o.area) / (o.size*o.size) * 0.6) * (st.dab ? 2 : 1), 1, 80);
  const step = Math.max(1, o.size*0.5), nSteps = st.dab ? 0 : Math.max(1, Math.round(st.len*o.size / step));
  const iso = (x, y) => {                                         // 等亮度线方向（垂直于梯度）；平坦处回 null
    const gx = lum(S, x+1, y, q2) - lum(S, x-1, y, q2), gy = lum(S, x, y+1, q2) - lum(S, x, y-1, q2), m = Math.hypot(gx, gy);
    return m < 1 ? null : [-gy/m, gx/m];
  };
  centres.forEach((c, ci) => {
    const rnd = rng((o.seed * 7919 + ci * 104729) >>> 0);
    for (let k = 0; k < per; k++){
      const ang = rnd()*Math.PI*2, rr = Math.sqrt(rnd())*R;
      const sx = c[0] + Math.cos(ang)*rr, sy = c[1] + Math.sin(ang)*rr;
      const col = px(S, sx, sy, [0,0,0,0]);
      const j0 = rnd(), j1 = rnd();                               // 先抽好（不管下不下笔，后面的乱数序列都不变）
      if (col[3] <= 0) continue;
      if (o.tolerance > 0 && cur){
        px(cur, sx, sy, q);
        const diff = Math.max(Math.abs(q[0]-col[0]), Math.abs(q[1]-col[1]), Math.abs(q[2]-col[2]), Math.abs(q[3]-col[3])) / 255 * 100;
        if (diff < o.tolerance) continue;
      }
      const pts = [[sx, sy]];
      let dir = iso(sx, sy) || [Math.cos(j0*Math.PI*2), Math.sin(j0*Math.PI*2)];
      if (j1 < 0.5) dir = [-dir[0], -dir[1]];
      let x = sx, y = sy;
      for (let n = 0; n < nSteps; n++){
        if (st.curl){
          const a = st.curl + (st.loose ? (rnd() - 0.5)*2*st.loose : 0), ca = Math.cos(a), sa = Math.sin(a);
          dir = [dir[0]*ca - dir[1]*sa, dir[0]*sa + dir[1]*ca];
        } else {
          const d2 = iso(x, y);
          if (d2) dir = (d2[0]*dir[0] + d2[1]*dir[1] < 0) ? [-d2[0], -d2[1]] : d2;
          if (st.loose){ const a = (rnd() - 0.5)*2*st.loose, ca = Math.cos(a), sa = Math.sin(a); dir = [dir[0]*ca - dir[1]*sa, dir[0]*sa + dir[1]*ca]; }
        }
        x += dir[0]*step; y += dir[1]*step; pts.push([x, y]);
      }
      out.push({ pts, color:col });
    }
  });
  return out;
}

/* 一笔（命令正文；src＝resolveSource 的结果；preview＝拖着看的那次，不报锁） */
function artHistory(p, src, preview){
  const o = parse(p); if (o.error) return {ok:false, error:o.error};
  if (src.error) return {ok:false, error:src.error};
  const L = src.L;
  if (!preview && window.Locks){
    const k = Locks.blocks(L, 'pixels');
    if (k){ Locks.notify(Locks.message(L, k)); return Locks.fail(L, k, C); }
  }
  const lockT = !!(window.Locks && Locks.alpha(L));
  const cw = L.data.canvas.width, chh = L.data.canvas.height;
  const cur = { d:L.data.ctx.getImageData(0, 0, cw, chh).data, w:cw, h:chh, ox:L.x, oy:L.y };
  const strokes = strokesFor(o, src.buf, cur);
  if (!strokes.length) return {ok:true, strokes:0, damage:[0,0,0,0], state:src.state};
  // 笔触画进一张跟这层一样大的画布（图层坐标），再按选区裁、照模式与不透明度叠上去
  const pc = document.createElement('canvas'); pc.width = cw; pc.height = chh;
  const x = pc.getContext('2d');
  x.lineCap = 'round'; x.lineJoin = 'round'; x.lineWidth = o.size;
  if (o.hardness < 1) x.filter = `blur(${(o.size*(1 - o.hardness)/4).toFixed(2)}px)`;
  let bb = null;
  for (const s of strokes){
    const c = s.color; x.strokeStyle = x.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(c[3]/255).toFixed(4)})`;
    x.beginPath();
    if (s.pts.length === 1){ x.arc(s.pts[0][0] - L.x, s.pts[0][1] - L.y, o.size/2, 0, Math.PI*2); x.fill(); }
    else { s.pts.forEach((q, i) => i ? x.lineTo(q[0] - L.x, q[1] - L.y) : x.moveTo(q[0] - L.x, q[1] - L.y)); x.stroke(); }
    for (const q of s.pts){
      const r = o.size/2 + 2, b = [q[0]-r, q[1]-r, q[0]+r, q[1]+r];
      bb = bb ? [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])] : b;
    }
  }
  x.filter = 'none';
  if (Doc.sel && window.SelMask){ const m = SelMask.maskCanvas(L); if (m){ x.globalCompositeOperation = 'destination-in'; x.drawImage(m, 0, 0); } }
  const ctx = L.data.ctx;
  const before = lockT ? ctx.getImageData(0, 0, cw, chh) : null;
  ctx.save(); ctx.setTransform(1,0,0,1,0,0); blendDraw(ctx, pc, 0, 0, o.mode, o.opacity); ctx.restore();
  if (lockT){
    const after = ctx.getImageData(0, 0, cw, chh), a = after.data, b = before.data;
    for (let i = 0; i < a.length; i += 4){ if (b[i+3] <= 0){ a[i] = b[i]; a[i+1] = b[i+1]; a[i+2] = b[i+2]; a[i+3] = 0; } else a[i+3] = b[i+3]; }
    ctx.putImageData(after, 0, 0);
  }
  const d = [Math.floor(bb[0]), Math.floor(bb[1]), Math.ceil(bb[2]), Math.ceil(bb[3])];
  return { ok:true, strokes:strokes.length, style:o.style, state:src.state, damage:[d[0], d[1], d[2]-d[0], d[3]-d[1]] };
}
CMD.reg(C, {i18n:'tool.arthistory', undoable:true,
  params:'{points:[[x,y],…] 文件坐标（必填）, state?:历史索引（同 historybrush.paint：0＝最旧那一步（通常是「打开」）、=步数＝当前文件；缺省 0）, '
       + `style="${STYLE_IDS.join('|')}"="tightShort", area=0..500=50（撒笔触的范围直径 px）, tolerance=0..100=0（%：只在现在颜色跟来源差这么多的地方下笔）, `
       + 'size=工具大小 px, hardness=0..100, opacity=1..100=100, mode="normal"|…=normal, seed=1（乱数种子，同种子同结果）, layerId?=当前层} '
       + '在路径四周撒短笔触，颜色取来源那一步、方向顺着来源影像的边 → {ok, strokes:画了几笔, damage:[x,y,w,h], state}'},
  p => artHistory(p, resolveSource(p)));
/* 同 historybrush.js：CMD.run 推历史在执行之前 ⇒ 先把来源解析好（state 索引才对得上历史面板） */
if (Array.isArray(CMD.redirects)) CMD.redirects.push((id, p) => {
  if (id !== C) return null;
  const src = resolveSource(p || {});
  return { undoable:true, i18n:'tool.arthistory', run: q => artHistory(q, src) };
});

/* ───────── 界面 ───────── */
const U = { style:'tightShort', area:50, tolerance:0, opacity:100, mode:'normal',
            drag:null, resize:null, hover:null, alt:false, shift:false, status:null, seed:1 };
const srcState = () => (window.HistoryBrush && HistoryBrush.ui) ? HistoryBrush.ui.state : null;
CMD.reg('arthistory.setOptions', {i18n:'',
  params:`{style?:"${STYLE_IDS.join('|')}", area?:0..500, tolerance?:0..100, opacity?:1..100, mode?:"normal"|…, state?:历史索引|null（来源；跟历史记录画笔共用）, size?:px, hardness?:0..100} 滑鼠作画用的选项（＝选项栏）`}, p => {
  if (p.style !== undefined){ if (!STYLES[p.style]) return {ok:false, error:`arthistory.setOptions: unknown style \`${p.style}\``}; U.style = p.style; }
  if (typeof p.area === 'number') U.area = clamp(Math.round(p.area), 0, 500);
  if (typeof p.tolerance === 'number') U.tolerance = clamp(Math.round(p.tolerance), 0, 100);
  if (typeof p.opacity === 'number') U.opacity = clamp(Math.round(p.opacity), 1, 100);
  if (typeof p.mode === 'string' && BLENDS.includes(p.mode)) U.mode = p.mode;
  if ((p.state === null || (Number.isInteger(p.state) && p.state >= 0)) && CMD.map['historybrush.setOptions']) CMD.map['historybrush.setOptions'].run({state:p.state});
  if (typeof p.size === 'number') ToolState.size = clamp(Math.round(p.size), 1, 5000);
  if (typeof p.hardness === 'number') ToolState.hardness = clamp(p.hardness, 0, 100) / 100;
  if (window.UI && ToolState.cur === 'arthistory' && !U.resize) UI.buildOptions('arthistory');
  return { ok:true, style:U.style, area:U.area, tolerance:U.tolerance, opacity:U.opacity, mode:U.mode, state:srcState(), size:ToolState.size, hardness:Math.round(ToolState.hardness*100) };
});
function strokeParams(points){
  const p = { points:points.map(q => [q[0], q[1]]), style:U.style, area:U.area, tolerance:U.tolerance, opacity:U.opacity, mode:U.mode, seed:U.seed };
  const st = srcState(); if (st !== null && st !== undefined) p.state = st;
  return p;
}
function setStatus(st){
  U.status = st;
  const el = document.getElementById('ahStatus'); if (el) el.textContent = st ? (st.key ? Lang.t(st.key) : String(st.text || '')) : '';
}
const Live = {
  begin(){ const L = Doc.active(); this.L = null; this.dmg = null; this.src = null;
    if (!L || L.kind !== 'raster') return;
    const src = resolveSource({state:srcState()}); if (src.error) return;
    const cv = L.data.canvas, b = document.createElement('canvas'); b.width = cv.width; b.height = cv.height; b.getContext('2d').drawImage(cv, 0, 0);
    this.L = L; this.bak = b; this.src = src; },
  restore(){ const L = this.L; if (!L || !this.dmg) return;
    const c = L.data.ctx; c.save(); c.setTransform(1,0,0,1,0,0); c.globalAlpha = 1; c.globalCompositeOperation = 'copy'; c.drawImage(this.bak, 0, 0); c.restore();
    this.dmg = null; },
  update(points){
    if (!this.L || Doc.active() !== this.L || (window.Locks && Locks.blocks(this.L, 'pixels'))) return;
    this.restore();
    const r = artHistory(Object.assign(strokeParams(points), {layerId:this.L.id}), this.src, true);
    if (r && r.ok && r.strokes) this.dmg = r.damage;
  },
  end(){ this.restore(); this.L = null; this.bak = null; this.src = null; }
};
function resizeUpdate(x, y){
  const r = U.resize, [size, hardness] = H.resized(r.start, x - r.anchor[0], y - r.anchor[1], UI.zoom);
  if (ToolState.size === size && ToolState.hardness === hardness) return;
  CMD.map['arthistory.setOptions'].run({size, hardness:hardness*100});
}

const S = {
  'tool.arthistory':   L3('藝術步驟記錄筆刷工具', '历史记录艺术画笔工具', 'Art History Brush Tool'),
  'opt.ah.mode':       L3('模式：', '模式：', 'Mode:'),
  'opt.ah.opacity':    L3('不透明：', '不透明度：', 'Opacity:'),
  'opt.ah.style':      L3('樣式：', '样式：', 'Style:'),
  'opt.ah.area':       L3('區域：', '区域：', 'Area:'),
  'opt.ah.tolerance':  L3('容許度：', '容差：', 'Tolerance:'),
  'opt.ah.source':     L3('來源：', '来源：', 'Source:'),
  'ui.ah.default':     L3('最舊的狀態（打開）', '最早的状态（打开）', 'Oldest state (Open)'),
  'ui.ah.diameter':    L3('直徑：', '直径：', 'Diameter:'),
  'ui.ah.hardness':    L3('硬度：', '硬度：', 'Hardness:'),
  'ui.ah.s.tightShort':    L3('緊密短', '绷紧短', 'Tight Short'),
  'ui.ah.s.tightMedium':   L3('緊密中', '绷紧中', 'Tight Medium'),
  'ui.ah.s.tightLong':     L3('緊密長', '绷紧长', 'Tight Long'),
  'ui.ah.s.looseMedium':   L3('鬆散中', '松散中等', 'Loose Medium'),
  'ui.ah.s.looseLong':     L3('鬆散長', '松散长', 'Loose Long'),
  'ui.ah.s.dab':           L3('輕擦', '轻涂', 'Dab'),
  'ui.ah.s.tightCurl':     L3('緊密捲曲', '绷紧卷曲', 'Tight Curl'),
  'ui.ah.s.tightCurlLong': L3('緊密捲曲長', '绷紧卷曲长', 'Tight Curl Long'),
  'ui.ah.s.looseCurl':     L3('鬆散捲曲', '松散卷曲', 'Loose Curl'),
  'ui.ah.s.looseCurlLong': L3('鬆散捲曲長', '松散卷曲长', 'Loose Curl Long'),
};
const strings = {'zh-Hant':{}, 'zh-Hans':{}, 'en':{}};
Object.keys(S).forEach(k => Object.keys(strings).forEach(l => strings[l][k] = S[k][l]));

const tool = Tools.reg({
  id:'arthistory', icon:'✎', group:'raster', order:46, for:'raster', needs:'raster', opts:['size','hardness'],
  cursor:'none', ui:U, strings, STYLES, strokesFor,

  /* 选项栏照 PS 2020：笔刷｜模式｜不透明度｜样式▾｜区域｜容差（＋来源：PS 在历史记录面板设，我们这里也露一个，跟历史记录画笔同一份） */
  buildOptions(box, add, mk){
    const sel = (key, list, val, lab, f) => { const s = document.createElement('select'); s.dataset.opt = key;
      list.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; s.appendChild(o); });
      s.value = val; s.onchange = () => f(s.value); add(lab, s); return s; };
    sel('ahMode', BLENDS.map(v => [v, Lang.t('blend.' + v)]), U.mode, 'ah.mode', v => CMD.run('arthistory.setOptions', {mode:v}));
    const num = (key, lo, hi, val, lab) => { const n = mk('number', {min:lo, max:hi, value:val}); n.dataset.opt = 'ah' + key; n.style.width = '52px';
      n.onchange = () => { if (n.value !== '' && isFinite(+n.value)) CMD.run('arthistory.setOptions', {[key]: +n.value}); }; add(lab, n); };
    num('opacity', 1, 100, U.opacity, 'ah.opacity');
    sel('ahStyle', STYLE_IDS.map(v => [v, Lang.t('ui.ah.s.' + v)]), U.style, 'ah.style', v => CMD.run('arthistory.setOptions', {style:v}));
    num('area', 0, 500, U.area, 'ah.area');
    num('tolerance', 0, 100, U.tolerance, 'ah.tolerance');
    const rows = (window.HistoryBrush && HistoryBrush.stateRows) ? HistoryBrush.stateRows() : [];
    const st = srcState();
    sel('ahSource', [['', Lang.t('ui.ah.default')]].concat(rows.map(r => [String(r.index), `${r.index}  ${r.label}`])), st === null || st === undefined ? '' : String(st), 'ah.source',
      v => CMD.run('arthistory.setOptions', {state: v === '' ? null : +v}));
    const s2 = document.createElement('span'); s2.id = 'ahStatus'; s2.style.color = '#e8573f'; box.appendChild(s2);
    setStatus(U.status);
  },

  onDown(e, pt, P){
    U.alt = e.altKey; U.shift = e.shiftKey; U.hover = pt;
    if (e.ctrlKey && e.altKey && !U.drag){ U.resize = { anchor:pt.slice(), start:[ToolState.size, ToolState.hardness] }; UI.draw(); return; }
    const L = Doc.active();
    // 同历史记录画笔：不是像素层就不能用（新建一层也没东西可画：那一步没有这层）
    if (!L || L.kind !== 'raster'){ setStatus({text:`${C}: active layer is a ${L ? L.kind : 'missing'} layer, not a pixel layer`}); P.down = false; return; }
    if (window.Locks && Locks.deny(L, 'pixels')){ P.down = false; return; }
    U.seed = (U.seed % 100000) + 1;
    U.drag = { points:[[pt[0], pt[1], 1]] };
    Live.begin(); Live.update(U.drag.points);
    UI.draw();
  },
  onMove(e, pt, P){
    U.alt = e.altKey; U.shift = e.shiftKey; U.hover = pt;
    if (U.resize){ resizeUpdate(pt[0], pt[1]); UI.draw(); return; }
    const d = U.drag;
    if (d && P.down){
      const last = d.points[d.points.length-1];
      if (Math.abs(last[0]-pt[0]) + Math.abs(last[1]-pt[1]) > 0.25){ d.points.push([pt[0], pt[1], 1]); Live.update(d.points); }
    }
    UI.draw();
  },
  onUp(e, pt){
    if (U.resize){ resizeUpdate(pt[0], pt[1]); U.resize = null; CMD.run('arthistory.setOptions', {}); return; }
    const d = U.drag; U.drag = null;
    if (!d){ UI.draw(); return; }
    const last = d.points[d.points.length-1];
    if (last[0] !== pt[0] || last[1] !== pt[1]) d.points.push([pt[0], pt[1], 1]);
    Live.end();
    const r = CMD.run(C, strokeParams(d.points));
    setStatus(r && r.ok === false ? {text:r.error} : null);
    UI.refresh();
  },
  onDeactivate(){ if (U.drag) Live.end(); U.drag = null; U.resize = null; U.hover = null; },
  /* 笔尖圈＋外面一圈虚线标「区域」 */
  drawOverlay(ctx, s){
    if (H) H.drawCommon(ctx, s, U, { trail:false, centre: r => r > 6, readout:['ui.ah.diameter', 'ui.ah.hardness'] });
    if (U.hover && !U.resize && U.area > 0){
      const dpr = s / UI.zoom;
      ctx.save(); ctx.lineWidth = dpr; ctx.setLineDash([3*dpr, 3*dpr]); ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath(); ctx.arc(U.hover[0]*s, U.hover[1]*s, U.area/2*s, 0, Math.PI*2); ctx.stroke(); ctx.restore();
    }
  }
});
window.ArtHistoryTool = tool;
/* 描边路径（PS 路径面板 ▸ 描边路径 ▸ 历史记录艺术画笔）：同滑鼠收笔那包参数（样式／区域／容差／来源） */
tool.pathParams = (L, points) => Object.assign(strokeParams(points), { layerId:L.id });
})();
