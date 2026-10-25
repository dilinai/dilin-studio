/* 历史记录画笔（PS Y）：拖曳＝把「某一步历史状态」里这一层的像素照笔尖覆盖图画回来；放开时一次落定（一步历史）。
   🔴 这支档是把 ArtCraft／PhotoCraft 的 Rust 原始码逐段翻译成 JS（算法照搬，不是凭 PS 印象另写）：
   - engine/src/retouch_cmds.rs 316-347   history_brush：取哪一步当来源（state 缺省＝最旧那一步，通常是「打开」；=past_len＝当前文件；超出＝报错）、
                                          来源层要在那一步里存在且是像素（不然报错）、stroke_coverage → Region::read(来源) → apply_coverage
   - engine/src/retouch_cmds.rs 63-121    parse_brush（size／hardness／opacity／flow／spacing 的范围与缺省）、run_stroke（一步历史）
   - engine/src/retouch_cmds.rs 214-219   blend_param（mode 缺省 normal）
   - ops/src/lib.rs                       History：state(i)＝entries 第 i 列（0＝最旧），past_len＝当前那列（不在历史里，就是文件本身）
   - paint/src/retouch.rs 99-217          dab_rect、footprint、stroke_coverage、over_native（锁透明像素＝alpha 不变）、apply_coverage（k＝覆盖×不透明度×选区；锁透明时 alpha 0 的像素跳过）
   - paint/src/lib.rs、dynamics.rs、render.rs（经 tools/clone.js 97-167 已翻好的那份照抄）：dab_coverage（smoothstep 硬度）、PathWalker 间距、覆盖累积
   - ui-egui/src/retouch_ui.rs 42、193     收笔叫 paint.historyBrush（UI 不带 state ⇒ 永远从「打开」那一步画）、选项栏只一句「Paints from the document's opening state」
   - ui-egui/src/canvas.rs 266-286、1601-1625、1878-1890、2040-2160   freehand 工具、笔尖圆圈游标、拖曳时白色足迹、Down/Move/Up（Shift 点连直线、放开补最后一点）
   - ui-egui/src/stroke_constraint.rs（connects＝is_brushlike）、brush_resize.rs（applies＝is_brushlike）、stroke_trail.rs
   我们多做的（原码没有，照 PS）：
   - 选项栏可选「来源」那一步（PS 在历史记录面板点左边那格设来源；原码 UI 固定画「打开」）、模式／不透明度／流量（PS 选项栏有，原码命令收、UI 没露）
   - 边拖边显示真像素（同 clone.js 的 Live）
   命令（agent 与人同一条路）：historybrush.paint / historybrush.setOptions / historybrush.states */
(function(){

/* ───────── 小工具 ───────── */
const roundAway = v => v < 0 ? -Math.round(-v) : Math.round(v);     // Rust f64::round
const asBool = (v, d) => typeof v === 'boolean' ? v : d;
const asNum  = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
const C01 = v => Math.min(Math.max(v, 0), 1);

/* ───────── paint/src/lib.rs、dynamics.rs、retouch.rs：dab 与整笔覆盖图（照 tools/clone.js 97-167 抄一份） ───────── */
function dabCoverage(d, radius, hardness){
  if (d >= radius + 0.5) return 0;
  const edge = Math.min(Math.max(radius + 0.5 - d, 0), 1);
  const h = Math.min(Math.max(hardness, 0), 1);
  const inner = radius * h;
  let falloff;
  if (d <= inner || radius - inner < 1e-3) falloff = 1;
  else {
    const t = Math.min(Math.max((d - inner) / (radius - inner), 0), 1);
    falloff = 1 - t*t*(3 - 2*t);
  }
  return edge * falloff;
}
const baseDiameter = (brush, q) => brush.size * Math.min(Math.max(q[2], 0), 1);
const stepLen = (brush, q) => Math.max(Math.max(baseDiameter(brush, q), 1) * Math.max(brush.spacing, 0.01), 0.5);
function walkDabs(points, brush){
  const out = [];
  let last = null, pending = null, nextAt = 0;
  for (const q of points){
    if (!last){ last = q; pending = q; nextAt = stepLen(brush, q); continue; }
    const dx = q[0]-last[0], dy = q[1]-last[1], len = Math.sqrt(dx*dx + dy*dy);
    if (pending){ out.push(pending); pending = null; }
    if (len > 1e-9){
      while (nextAt <= len + 1e-9){
        const t = Math.min(nextAt/len, 1);
        const p = [last[0] + dx*t, last[1] + dy*t, last[2] + (q[2]-last[2])*t];
        out.push(p);
        nextAt += Math.max(stepLen(brush, p), 0.25);
      }
      nextAt -= len;
    }
    last = q;
  }
  if (pending) out.push(pending);
  return out;
}
function dabRect(c, radius){
  const rr = Math.ceil(radius) + 1, cx = Math.floor(c[0]), cy = Math.floor(c[1]);
  return [cx-rr, cy-rr, cx+rr+1, cy+rr+1];
}
function strokeCoverage(points, brush){
  const pts = points.map(q => [q[0], q[1], (typeof q[2] === 'number' && isFinite(q[2])) ? q[2] : 1]);
  const dabs = walkDabs(pts, brush);
  if (!dabs.length) return { rect:[0,0,0,0], cov:new Float32Array(0) };
  const radiusOf = d => Math.max(baseDiameter(brush, d)/2, 0.5);
  let R = null;
  for (const d of dabs){
    const r = dabRect(d, radiusOf(d));
    R = R ? [Math.min(R[0],r[0]), Math.min(R[1],r[1]), Math.max(R[2],r[2]), Math.max(R[3],r[3])] : r;
  }
  const W = R[2]-R[0], H = R[3]-R[1], cov = new Float32Array(W*H), ceil = 1;
  for (const d of dabs){
    const radius = radiusOf(d), r = dabRect(d, radius);
    for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++){
      const v = dabCoverage(Math.hypot(x + 0.5 - d[0], y + 0.5 - d[1]), radius, brush.hardness) * brush.flow;
      if (v <= 0) continue;
      const i = (y - R[1])*W + (x - R[0]), c = cov[i];
      if (ceil > c) cov[i] = c + v*(ceil - c);
    }
  }
  return { rect:R, cov };
}

/* ───────── retouch.rs apply_coverage（含 over_native 的锁透明像素） ─────────
   k = min(覆盖 × 不透明度 × 选区, 1)；锁透明：目的 alpha 为 0 的像素跳过、其余 alpha 不变 */
function applyCoverage(L, rect, cov, opacity, paint, mode, lockT){
  const W = rect[2]-rect[0];
  const cw = L.data.canvas.width, ch = L.data.canvas.height;
  const cx0 = Math.max(rect[0], L.x), cy0 = Math.max(rect[1], L.y);
  const cx1 = Math.min(rect[2], L.x + cw), cy1 = Math.min(rect[3], L.y + ch);
  if (cx1 <= cx0 || cy1 <= cy0) return;
  const s = Doc.sel;
  const selAt = (x, y) => {
    if (!s) return 1;
    if (window.SelMask) return SelMask.coverage(x, y, s);
    const sx0 = Math.min(s.x, s.x+s.w), sy0 = Math.min(s.y, s.y+s.h), sx1 = Math.max(s.x, s.x+s.w), sy1 = Math.max(s.y, s.y+s.h);
    return (x >= sx0 && x < sx1 && y >= sy0 && y < sy1) ? 1 : 0;
  };
  const rw = cx1-cx0, rh = cy1-cy0, ctx = L.data.ctx;
  if (mode === 'normal'){
    const img = ctx.getImageData(cx0 - L.x, cy0 - L.y, rw, rh), d = img.data;
    for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++){
      const i = (y - rect[1])*W + (x - rect[0]);
      const k = Math.min(cov[i] * opacity * selAt(x, y), 1);
      if (k <= 0) continue;
      const o = ((y - cy0)*rw + (x - cx0))*4, pi = i*4;
      if (lockT && d[o+3] <= 0) continue;
      const da = d[o+3]/255, sa = paint[pi+3]/255 * k, oa = sa + da*(1 - sa);
      if (oa > 0) for (let c = 0; c < 3; c++) d[o+c] = (paint[pi+c]*sa + d[o+c]*da*(1 - sa)) / oa;
      if (!lockT) d[o+3] = oa*255;
    }
    ctx.putImageData(img, cx0 - L.x, cy0 - L.y);
    return;
  }
  // 非 normal：paint 的 alpha 乘上 k，用画布的 W3C 混合叠上去；锁透明时事后把 alpha（与原本透明的像素）写回
  const before = lockT ? ctx.getImageData(cx0 - L.x, cy0 - L.y, rw, rh) : null;
  const t = document.createElement('canvas'); t.width = rw; t.height = rh;
  const tx = t.getContext('2d'), img = tx.createImageData(rw, rh), d = img.data;
  for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++){
    const i = (y - rect[1])*W + (x - rect[0]);
    const k = Math.min(cov[i] * opacity * selAt(x, y), 1);
    if (k <= 0) continue;
    const o = ((y - cy0)*rw + (x - cx0))*4, pi = i*4;
    d[o]=paint[pi]; d[o+1]=paint[pi+1]; d[o+2]=paint[pi+2]; d[o+3]=paint[pi+3]*k;
  }
  tx.putImageData(img, 0, 0);
  blendDraw(ctx, t, cx0 - L.x, cy0 - L.y, mode, 1);
  if (lockT){
    const after = ctx.getImageData(cx0 - L.x, cy0 - L.y, rw, rh), a = after.data, b = before.data;
    for (let o = 0; o < a.length; o += 4){
      if (b[o+3] <= 0){ a[o]=b[o]; a[o+1]=b[o+1]; a[o+2]=b[o+2]; a[o+3]=0; }
      else a[o+3] = b[o+3];
    }
    ctx.putImageData(after, cx0 - L.x, cy0 - L.y);
  }
}

/* ───────── retouch_cmds.rs history_brush()：来源 ─────────
   History.past[i]＝历史面板第 i 列（0＝最旧，通常是「打开」）；i＝past.length＝当前文件（不在历史里）。
   缺省：最旧那一步（历史是空的＝当前文件，等于画了没变化）。 */
const C = 'historybrush.paint';
function targetLayer(p){
  const lid = p.layerId !== undefined ? p.layerId : p.layer;
  return lid !== undefined ? Doc.byId(lid) : Doc.active();
}
/* 读一张画布成像素缓冲（文件坐标 X,Y → 缓冲 (X−ox, Y−oy)） */
function bufOf(canvas, ox, oy){
  const w = canvas.width, h = canvas.height;
  const d = (w && h) ? canvas.getContext('2d').getImageData(0, 0, w, h).data : new Uint8ClampedArray(0);
  return { d, w, h, ox, oy };
}
/* 解析 state ＋ 来源层；必须在 CMD.run 推历史「之前」叫（推了以后索引会多一格，满 50 步还会挤掉最旧那步） */
function resolveSource(p){
  const L = targetLayer(p);
  if (!L) return {error:'no active layer'};
  if (L.kind !== 'raster') return {error:`active layer is a ${L.kind} layer, not a pixel layer`};
  const n = History.past.length;
  let st = null;                                         // null＝当前文件
  if (p.state !== undefined && p.state !== null){
    const i = p.state;
    if (!Number.isInteger(i) || i < 0) return {error:`${C}: \`state\` must be a history index (0..=${n})`};
    if (i > n) return {error:`${C}: no history state ${i} (0..=${n})`};
    if (i < n) st = History.past[i];
  } else if (n > 0) st = History.past[0];
  if (!st) return {L, state: p.state === undefined || p.state === null ? (n > 0 ? 0 : n) : p.state, buf: bufOf(L.data.canvas, L.x, L.y)};
  // 同一个目标（这一层）在那一步时的样子；那一步没有这层、或那时不是像素层 ⇒ 报错
  const o = (st.layers || []).find(l => l.id === L.id);
  if (!o || o.kind !== 'raster' || !o.data || !o.data.canvas)
    return {error:`${C}: the target did not exist (as pixels) in that history state`};
  return {L, state: History.past.indexOf(st), buf: bufOf(o.data.canvas, o.x || 0, o.y || 0)};
}
/* 来源像素 → 覆盖图外框那一块（Region::read：缓冲外＝透明） */
function readRegion(S, rect){
  const W = rect[2]-rect[0], H = rect[3]-rect[1], out = new Float32Array(W*H*4);
  for (let y = 0; y < H; y++){
    const by = rect[1] + y - S.oy; if (by < 0 || by >= S.h) continue;
    for (let x = 0; x < W; x++){
      const bx = rect[0] + x - S.ox; if (bx < 0 || bx >= S.w) continue;
      const i = (by*S.w + bx)*4, o = (y*W + x)*4;
      out[o] = S.d[i]; out[o+1] = S.d[i+1]; out[o+2] = S.d[i+2]; out[o+3] = S.d[i+3];
    }
  }
  return out;
}

/* parse_brush（retouch_cmds.rs:65-98）：size 缺省工具大小、hardness／opacity／flow／spacing 是百分比 */
function parseBrush(p){
  if (!Array.isArray(p.points)) return {error:`${C}: missing \`points\``};
  const pts = p.points.filter(a => Array.isArray(a) && typeof a[0] === 'number' && typeof a[1] === 'number')
                      .map(a => [a[0], a[1], typeof a[2] === 'number' ? a[2] : 1]);
  if (!pts.length) return {error:`${C}: \`points\` is empty`};
  const pct = (k, d, lo, hi) => Math.min(Math.max(asNum(p[k], d), lo), hi) / 100;
  return { pts, brush:{
    size: Math.max(asNum(p.size, ToolState.size), 1),
    hardness: pct('hardness', ToolState.hardness*100, 0, 100),
    opacity: pct('opacity', 100, 1, 100),
    flow: pct('flow', 100, 1, 100),
    spacing: pct('spacing', 25, 1, 1000)
  }};
}

/* 一笔（命令正文；src＝resolveSource 的结果） */
function historyBrush(p, src){
  const b = parseBrush(p); if (b.error) return {ok:false, error:b.error};
  const mode = typeof p.mode === 'string' ? p.mode : 'normal';
  if (!BLENDS.includes(mode)) return {ok:false, error:`${C}: unknown blend mode \`${mode}\``};
  if (src.error) return {ok:false, error:src.error};
  const L = src.L;
  // 图层锁（共用的 Locks 规则表没列这条命令 ⇒ 这里自己挡：锁像素／全锁不给画；锁透明像素＝alpha 不变）
  if (window.Locks && CMD._depth <= 1){
    const k = Locks.blocks(L, 'pixels');
    if (k){ Locks.notify(Locks.message(L, k)); return Locks.fail(L, k, C); }
  }
  const lockT = !!(window.Locks && Locks.alpha(L));
  const { rect, cov } = strokeCoverage(b.pts, b.brush);
  const paint = readRegion(src.buf, rect);
  applyCoverage(L, rect, cov, b.brush.opacity, paint, mode, lockT);
  return { ok:true, damage:[rect[0], rect[1], rect[2]-rect[0], rect[3]-rect[1]], state:src.state };
}

CMD.reg(C, {i18n:'tool.historybrush', undoable:true,
  params:'{points:[[x,y,pressure?],…] 文件坐标（必填）, state?:历史索引（＝历史记录面板第几列，0＝最旧那一步，通常是「打开」；=步数＝当前文件；缺省 0）, '
       + 'size=工具大小 px, hardness=0..100（工具硬度）, opacity=1..100=100, flow=1..100=100, spacing=1..1000（% of size）=25, '
       + 'mode="normal"|"multiply"|…=normal, layerId?=当前层} 把那一步时这一层的像素照笔尖画回来（文件坐标对文件坐标；那一步没有这层或不是像素层＝报错）'
       + ' → {ok, damage:[x,y,w,h], state}'},
  p => historyBrush(p, resolveSource(p)));
/* CMD.run 推历史在执行命令之前 ⇒ 用共用的改道挂点（engine.js CMD.redirects，在推历史前叫）先把来源解析好，state 索引才跟历史面板一致 */
if (Array.isArray(CMD.redirects)) CMD.redirects.push((id, p) => {
  if (id !== C) return null;
  const src = resolveSource(p || {});
  return { undoable:true, i18n:'tool.historybrush', run: q => historyBrush(q, src) };
});

/* ───────── 界面这一侧的状态 ───────── */
const U = {
  state:null,                        // 来源：null＝缺省（最旧那步／打开）；整数＝历史面板第几列（我们加的，照 PS）
  opacity:100, flow:100, mode:'normal',
  drag:null, lastEnd:null, trail:null, resize:null,
  hover:null, alt:false, shift:false,
  status:null, statusError:false
};
const pressure = e => (e && e.pointerType === 'pen' && typeof e.pressure === 'number') ? e.pressure : 1;
const fmt = (s, kv) => s.replace(/\{(\w+)\}/g, (m, k) => kv[k] !== undefined ? kv[k] : m);
function statusText(st){ if (!st) return ''; return st.key ? fmt(Lang.t(st.key), st.args || {}) : String(st.text || ''); }
function setStatus(st, error){ U.status = st; U.statusError = !!error; showStatus(); }
function showStatus(){
  const el = document.getElementById('hbStatus'); if (!el) return;
  const st = U.status || {key:'ui.hbHint'};
  el.textContent = statusText(st); el.style.color = (U.status && U.statusError) ? '#e8573f' : '#7a8290';
}

/* 历史各列的名字（有历史记录面板就借它的步名，没有就写编号） */
function stateRows(){
  const H = window.PsWindow && PsWindow.history;
  if (H && H.rows) return H.rows().rows.filter(r => !r.redo).map(r => ({index:r.at, label:r.label}));
  const out = [];
  for (let i = 0; i <= History.past.length; i++) out.push({index:i, label: i === 0 ? Lang.t('ui.hbOpen') : '#' + i});
  return out;
}

CMD.reg('historybrush.setOptions', {i18n:'',
  params:'{state?:历史索引|null（null＝缺省最旧那一步）, opacity?:1..100, flow?:1..100, mode?:"normal"|…, size?:px, hardness?:0..100} 滑鼠作画用的选项（＝选项栏）'}, p => {
  if (p.state === null) U.state = null;
  else if (Number.isInteger(p.state) && p.state >= 0) U.state = p.state;
  if (typeof p.opacity === 'number') U.opacity = Math.min(Math.max(p.opacity, 1), 100);
  if (typeof p.flow === 'number') U.flow = Math.min(Math.max(p.flow, 1), 100);
  if (typeof p.mode === 'string' && BLENDS.includes(p.mode)) U.mode = p.mode;
  if (typeof p.size === 'number') ToolState.size = Math.min(Math.max(Math.round(p.size), 1), 5000);
  if (typeof p.hardness === 'number') ToolState.hardness = Math.min(Math.max(p.hardness, 0), 100) / 100;
  if (window.UI && ToolState.cur === 'historybrush' && !U.resize) UI.buildOptions('historybrush');
  return { ok:true, state:U.state, opacity:U.opacity, flow:U.flow, mode:U.mode, size:ToolState.size, hardness:Math.round(ToolState.hardness*100) };
});
CMD.reg('historybrush.states', {i18n:'', params:'{} → {ok, states:[{index,label}], current:当前那列, source:选项栏选的来源（null＝缺省 0）}'},
  () => ({ ok:true, states:stateRows(), current:History.past.length, source:U.state }));

/* 收笔：叫命令（retouch_ui.rs:42 只带 points；我们多带选项栏的来源／模式／不透明度／流量） */
function strokeParams(points){
  const p = { points: points.map(q => [q[0], q[1], q[2]]), opacity:U.opacity, flow:U.flow, mode:U.mode };
  if (U.state !== null) p.state = U.state;
  return p;
}
/* 边拖边显示（同 clone.js 的 Live）：按下时备份这一层、解析好来源；每帧把上一帧画过的那块还原，再整笔重算；放开整层还原、走 CMD 正式落一次 */
const Live = {
  begin(){
    const L = Doc.active(); this.L = null; this.dmg = null; this.src = null;
    if (!L || L.kind !== 'raster' || !L.data || !L.data.canvas) return;
    const src = resolveSource({state:U.state});
    if (src.error) return;
    const cv = L.data.canvas, b = document.createElement('canvas'); b.width = cv.width; b.height = cv.height;
    b.getContext('2d').drawImage(cv, 0, 0); this.L = L; this.bak = b; this.src = src;
  },
  restore(){
    const L = this.L, d = this.dmg; if (!L || !d) return;
    const x = Math.max(0, Math.floor(d[0] - L.x)), y = Math.max(0, Math.floor(d[1] - L.y));
    const w = Math.min(L.data.canvas.width - x, Math.ceil(d[2]) + 2), h = Math.min(L.data.canvas.height - y, Math.ceil(d[3]) + 2);
    if (w > 0 && h > 0){ const c = L.data.ctx; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      c.clearRect(x, y, w, h); c.drawImage(this.bak, x, y, w, h, x, y, w, h); c.restore(); }
    this.dmg = null;
  },
  update(points){
    if (!this.L || Doc.active() !== this.L) return;
    if (window.Locks && Locks.blocks(this.L, 'pixels')) return;
    this.restore();
    const r = historyBrush(Object.assign(strokeParams(points), {layerId:this.L.id}), this.src);
    if (r && r.ok) this.dmg = r.damage;
  },
  end(){ this.restore(); this.L = null; this.bak = null; this.src = null; }
};
function finishStroke(points){
  Live.end();
  const r = CMD.run(C, strokeParams(points));
  if (r && r.ok === false){ setStatus({text:r.error}, true); return; }
  if (U.status) setStatus(null, false);
}

/* ───────── stroke_constraint.rs（同 clone.js） ───────── */
const LOCK_DISTANCE = 3;
function snappedDir(o, p, step){
  const dx = p[0]-o[0], dy = p[1]-o[1];
  if (!(isFinite(dx) && isFinite(dy)) || Math.hypot(dx, dy) < 1e-9 || step <= 0) return null;
  const a = roundAway(Math.atan2(dy, dx) / step) * step;
  return [Math.cos(a), Math.sin(a)];
}
function project(o, dir, p){
  const t = (p[0]-o[0])*dir[0] + (p[1]-o[1])*dir[1];
  return [o[0] + dir[0]*t, o[1] + dir[1]*t];
}
function constrain(d, last, p, shift){
  if (!shift){ d.axis = null; return p; }
  if (!d.axis) d.axis = { origin:last.slice(), dir:null };
  const a = d.axis;
  if (!a.dir){
    const reach = LOCK_DISTANCE / Math.max(UI.zoom, 1e-3);
    if (Math.hypot(p[0]-a.origin[0], p[1]-a.origin[1]) < reach) return a.origin.slice();
    a.dir = snappedDir(a.origin, p, Math.PI/4);
  }
  return a.dir ? project(a.origin, a.dir, p) : a.origin.slice();
}

/* ───────── stroke_trail.rs（同 clone.js）：画不出 Live 时留白色足迹 ───────── */
const MAX_SIDE = 1024, TRAIL_ALPHA = 60;
function trailNew(){
  const k = Math.max(1, Math.ceil(Math.max(Doc.width, Doc.height) / MAX_SIDE));
  const w = Math.max(1, Math.ceil(Doc.width / k)), h = Math.max(1, Math.ceil(Doc.height / k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { c, x:c.getContext('2d'), k, w, h, cov:new Uint8Array(w*h), fed:0, dirty:null };
}
function trailCapsule(t, a, b, r){
  if (![a[0],a[1],b[0],b[1],r].every(isFinite)) return;
  const x0 = Math.max(Math.floor(Math.min(a[0], b[0]) - r - 1), 0), y0 = Math.max(Math.floor(Math.min(a[1], b[1]) - r - 1), 0);
  const x1 = Math.min(Math.ceil(Math.max(a[0], b[0]) + r + 1), t.w), y1 = Math.min(Math.ceil(Math.max(a[1], b[1]) + r + 1), t.h);
  if (x1 <= x0 || y1 <= y0) return;
  const dx = b[0]-a[0], dy = b[1]-a[1], len2 = dx*dx + dy*dy;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++){
    const px = x + 0.5 - a[0], py = y + 0.5 - a[1];
    const s = len2 > 0 ? Math.min(Math.max((px*dx + py*dy) / len2, 0), 1) : 0;
    const d = Math.hypot(px - s*dx, py - s*dy);
    const c = Math.round(Math.min(Math.max(r + 0.5 - d, 0), 1) * 255);
    const i = y*t.w + x;
    if (c > t.cov[i]) t.cov[i] = c;
  }
  const D = t.dirty || (t.dirty = [x0, y0, x1, y1]);
  t.dirty = [Math.min(D[0], x0), Math.min(D[1], y0), Math.max(D[2], x1), Math.max(D[3], y1)];
}
function trailFeed(t, points, diameter){
  if (t.fed >= points.length) return;
  const r = (Math.max(diameter, 1) / 2) / t.k, m = q => [q[0]/t.k, q[1]/t.k];
  for (let i = t.fed; i < points.length; i++){
    const b = m(points[i]), a = i > 0 ? m(points[i-1]) : b;
    trailCapsule(t, a, b, r);
  }
  t.fed = points.length;
  if (t.dirty){
    const [x0, y0, x1, y1] = t.dirty, w = x1-x0, h = y1-y0, img = t.x.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const o = (y*w + x)*4;
      d[o] = d[o+1] = d[o+2] = 255; d[o+3] = Math.floor(t.cov[(y0+y)*t.w + x0 + x] * TRAIL_ALPHA / 255);
    }
    t.x.putImageData(img, x0, y0); t.dirty = null;
  }
}

/* ───────── brush_resize.rs：Ctrl+Alt 拖曳（左右改直径、上下改硬度） ───────── */
const HARDNESS_TRAVEL = 200;
function resized(start, dx, dy, zoom){
  dx = isFinite(dx) ? dx : 0; dy = isFinite(dy) ? dy : 0;
  zoom = (isFinite(zoom) && zoom > 0) ? zoom : 1;
  const size = Math.min(Math.max(Math.round(start[0] + 2*dx), 1), 5000);
  const hardness = Math.min(Math.max(start[1] + dy*zoom/HARDNESS_TRAVEL, 0), 1);
  return [size, Math.round(hardness*100)/100];
}
function resizeUpdate(x, y){
  const r = U.resize;
  const [size, hardness] = resized(r.start, x - r.anchor[0], y - r.anchor[1], UI.zoom);
  if (ToolState.size === size && ToolState.hardness === hardness) return;
  CMD.map['historybrush.setOptions'].run({size, hardness:hardness*100});
}

const L3 = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, 'en':c});
const S = {
  'tool.historybrush': L3('步驟記錄筆刷工具', '历史记录画笔工具', 'History Brush Tool'),
  'opt.hb.source':     L3('來源', '来源', 'Source'),
  'opt.hb.mode':       L3('模式', '模式', 'Mode'),
  'opt.hb.opacity':    L3('不透明', '不透明度', 'Opacity'),
  'opt.hb.flow':       L3('流量', '流量', 'Flow'),
  'ui.hbDefault':      L3('最舊的狀態（打開）', '最早的状态（打开）', 'Oldest state (Open)'),
  'ui.hbOpen':         L3('打開', '打开', 'Open'),
  'ui.hbCurrent':      L3('（目前）', '（当前）', '(current)'),
  'ui.hbHint':         L3('從所選的步驟記錄狀態畫回像素', '从所选的历史记录状态画回像素', 'Paints from the chosen history state'),
  'ui.hbDiameter':     L3('直徑：', '直径：', 'Diameter:'),
  'ui.hbHardness':     L3('硬度：', '硬度：', 'Hardness:')
};
const strings = {'zh-Hant':{}, 'zh-Hans':{}, 'en':{}};
Object.keys(S).forEach(k => Object.keys(strings).forEach(l => strings[l][k] = S[k][l]));

const tool = Tools.reg({
  id:'historybrush', icon:'⟲', group:'raster', order:45, for:'raster', needs:'raster', opts:['size','hardness'],
  cursor:'none',
  ui:U, strokeCoverage, resolveSource, stateRows,
  strings,

  /* 选项栏：来源（我们加的）、模式、不透明度、流量；尾巴是提示／错误 */
  buildOptions(box, add, mk){
    const src = document.createElement('select'); src.dataset.opt = 'hbSource';
    const fill = () => {
      src.innerHTML = '';
      const o0 = document.createElement('option'); o0.value = ''; o0.textContent = Lang.t('ui.hbDefault'); src.appendChild(o0);
      const cur = History.past.length;
      stateRows().forEach(r => { const o = document.createElement('option'); o.value = String(r.index);
        o.textContent = `${r.index}  ${r.label}${r.index === cur ? ' ' + Lang.t('ui.hbCurrent') : ''}`; src.appendChild(o); });
      if (U.state !== null && U.state > cur){ const o = document.createElement('option'); o.value = String(U.state); o.textContent = '#' + U.state; src.appendChild(o); }
      src.value = U.state === null ? '' : String(U.state);
    };
    fill();
    src.onmousedown = src.onfocus = () => { if (src.dataset.filling) return; src.dataset.filling = '1'; fill(); delete src.dataset.filling; };
    src.onchange = () => CMD.run('historybrush.setOptions', {state: src.value === '' ? null : +src.value});
    add('hb.source', src);
    const mode = document.createElement('select'); mode.dataset.opt = 'hbMode';
    BLENDS.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = Lang.t('blend.' + v); mode.appendChild(o); });
    mode.value = U.mode; mode.onchange = () => CMD.run('historybrush.setOptions', {mode:mode.value});
    add('hb.mode', mode);
    const num = (key, val) => { const n = mk('number', {min:1, max:100, value:val}); n.dataset.opt = 'hb' + key; n.style.width = '56px';
      n.onchange = () => { if (n.value !== '' && isFinite(+n.value)) CMD.run('historybrush.setOptions', {[key]: +n.value}); }; return n; };
    add('hb.opacity', num('opacity', U.opacity));
    add('hb.flow', num('flow', U.flow));
    const st = document.createElement('span'); st.id = 'hbStatus'; st.style.color = '#7a8290';
    box.appendChild(st);
    showStatus();
  },

  onDown(e, pt, P){
    U.alt = e.altKey; U.shift = e.shiftKey; U.hover = pt;
    if (e.ctrlKey && e.altKey && !U.drag){
      U.resize = { anchor:pt.slice(), start:[ToolState.size, ToolState.hardness] };
      UI.draw(); return;
    }
    const L = Doc.active();
    // 他们：不是像素层就不能用（has_pixel_layer）；新建一层也画不出东西（那一步没有这层），所以不像笔刷那样自动建层
    if (!L || L.kind !== 'raster'){ setStatus({text:`${C}: active layer is a ${L ? L.kind : 'missing'} layer, not a pixel layer`}, true); P.down = false; return; }
    if (window.Locks && Locks.deny(L, 'pixels')){ P.down = false; return; }
    // Shift 点一下（上一笔之后）：从上一笔终点连直线
    const from = (e.shiftKey && U.lastEnd) ? U.lastEnd.slice() : null;
    const pr = pressure(e);
    const points = [[pt[0], pt[1], pr]];
    if (from) points.unshift([from[0], from[1], pr]);
    U.drag = { start: from || pt.slice(), points, axis:null };
    U.trail = trailNew();
    trailFeed(U.trail, U.drag.points, ToolState.size);
    Live.begin(); Live.update(U.drag.points);
    UI.draw();
  },
  onMove(e, pt, P){
    U.alt = e.altKey; U.shift = e.shiftKey; U.hover = pt;
    if (U.resize){ resizeUpdate(pt[0], pt[1]); UI.draw(); return; }
    const d = U.drag;
    if (d && P.down){
      const last = d.points.length ? d.points[d.points.length-1] : d.start;
      const q = constrain(d, last, pt, e.shiftKey);
      if (!d.points.length || Math.abs(last[0]-q[0]) + Math.abs(last[1]-q[1]) > 0.25) d.points.push([q[0], q[1], pressure(e)]);
      trailFeed(U.trail, d.points, ToolState.size);
      Live.update(d.points);
    }
    UI.draw();
  },
  onUp(e, pt){
    U.alt = e.altKey; U.shift = e.shiftKey;
    if (U.resize){ resizeUpdate(pt[0], pt[1]); U.resize = null; CMD.run('historybrush.setOptions', {}); return; }
    const d = U.drag; U.drag = null; U.trail = null;
    if (!d){ UI.draw(); return; }
    const last = d.points.length ? d.points[d.points.length-1] : d.start;
    const q = constrain(d, last, pt, e.shiftKey);
    if (!d.points.length || last[0] !== q[0] || last[1] !== q[1]) d.points.push([q[0], q[1], d.points.length ? last[2] : 1]);
    U.lastEnd = d.points[d.points.length-1].slice(0, 2);
    finishStroke(d.points);
    UI.refresh();
  },
  onDeactivate(){ if (U.drag) Live.end(); U.drag = null; U.trail = null; U.resize = null; U.hover = null; },

  drawOverlay(ctx, s){
    const z = UI.zoom, dpr = s / z;
    const scr = q => [q[0]*s, q[1]*s];
    ctx.save();
    if (U.trail && !Live.dmg){
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(U.trail.c, 0, 0, U.trail.w*U.trail.k*s, U.trail.h*U.trail.k*s);
    }
    const line = (a, b, w, col) => { ctx.lineWidth = w*dpr; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
    // Shift 橡皮筋：上一笔终点 → 游标
    if (U.shift && U.lastEnd && !U.drag && U.hover && !U.resize){
      const a = scr(U.lastEnd), b = scr(U.hover);
      line(a, b, 2.5, 'rgba(0,0,0,0.47)'); line(a, b, 1, 'rgba(255,255,255,0.9)');
    }
    if (U.resize){
      const c = scr(U.resize.anchor), R = Math.max(ToolState.size/2*z, 1)*dpr, inner = R*C01(ToolState.hardness);
      const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], R);
      g.addColorStop(0, 'rgba(255,0,0,0.43)'); g.addColorStop(inner/R, 'rgba(255,0,0,0.43)'); g.addColorStop(1, 'rgba(255,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, Math.PI*2); ctx.fill();
      ctx.lineWidth = dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(c[0], c[1], R + 0.5*dpr, 0, Math.PI*2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.86)'; ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, Math.PI*2); ctx.stroke();
      if (U.hover){
        const h = scr(U.hover), t1 = `${Lang.t('ui.hbDiameter')} ${Math.round(ToolState.size)} px`, t2 = `${Lang.t('ui.hbHardness')} ${Math.round(ToolState.hardness*100)}%`;
        ctx.font = `${12*dpr}px sans-serif`;
        const w = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 12*dpr;
        ctx.fillStyle = 'rgba(30,32,36,0.9)'; ctx.fillRect(h[0]+14*dpr, h[1]+14*dpr, w, 38*dpr);
        ctx.fillStyle = '#e6e8eb'; ctx.fillText(t1, h[0]+20*dpr, h[1]+29*dpr); ctx.fillText(t2, h[0]+20*dpr, h[1]+45*dpr);
      }
    } else if (U.hover){
      // canvas.rs 1601-1625：笔尖圆圈（NormalTip：完整半径 ×(0.5＋0.5×硬度)）
      const c = scr(U.hover), full = Math.max(ToolState.size/2*z, 1);
      const r = Math.max(full*(0.5 + 0.5*C01(ToolState.hardness)), 1)*dpr;
      ctx.lineWidth = dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(c[0], c[1], r + 0.5*dpr, 0, Math.PI*2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.86)'; ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI*2); ctx.stroke();
    }
    ctx.restore();
  }
});

/* Shift 按下放开即时重画橡皮筋（ui.js 按着修饰键时不把键交给工具） */
function modKey(e){
  if (ToolState.cur !== 'historybrush' || !window.UI || !UI.canvas) return;
  if (e.key === 'Alt' || e.key === 'Shift'){
    if (e.altKey !== U.alt || e.shiftKey !== U.shift){ U.alt = e.altKey; U.shift = e.shiftKey; UI.draw(); }
  }
}
document.addEventListener('keydown', modKey);
document.addEventListener('keyup', modKey);
window.addEventListener('DOMContentLoaded', () => {
  const v = document.getElementById('view');
  if (v) v.addEventListener('pointerleave', () => { if (ToolState.cur === 'historybrush' && !U.drag){ U.hover = null; UI.draw(); } });
});

window.HistoryBrush = tool;
/* 描边路径（PS 路径面板 ▸ 描边路径 ▸ 历史记录画笔）：同滑鼠收笔那包参数（来源／不透明度／流量／模式） */
tool.pathParams = (L, points) => Object.assign(strokeParams(points), { layerId:L.id });
})();
