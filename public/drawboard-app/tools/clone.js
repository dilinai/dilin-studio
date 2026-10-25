/* 仿制图章（C）：Alt＋点＝设取样点；拖曳＝把取样点那一带照「整笔固定的映射」复制过来，放开时一次贴上（一步历史）。
   🔴 这支档是把 ArtCraft／PhotoCraft 的 Rust 原始码逐段翻译成 JS（算法照搬，不是凭 PS 印象另写）：
   - engine/src/presets/clone_source.rs   五个取样槽、变换矩阵 transform_matrix、mapping()、双线性 resample()、cloneSource.* 命令
   - engine/src/retouch_cmds.rs           paint.cloneStamp：取样层（current/currentAndBelow/all）、clone_sample、clone_result
   - paint/src/retouch.rs、lib.rs、dynamics.rs、render.rs   dab_coverage（smoothstep 硬度）、PathWalker 间距、覆盖累积、apply_coverage／over_native
   - ui-egui/src/retouch_ui.rs            Alt 点设取样、收笔叫命令（slot／offset／source 三条路）、取样十字、选项栏
   - ui-egui/src/canvas.rs                Tool::CloneStamp 段：Alt 点只设取样、笔尖圆圈游标（Alt 才显中心十字）、拖曳预览
   - ui-egui/src/stroke_trail.rs          拖曳时半透明的笔尖足迹
   - ui-egui/src/stroke_constraint.rs     Shift 拖曳锁 0/45/90°、Shift 点一下从上一笔终点连直线、橡皮筋预览
   - ui-egui/src/brush_resize.rs          Ctrl+Alt 拖曳：左右改直径、上下改硬度
   - ui-egui/src/preset_panels.rs         clone_sample_point()：取样十字跟着笔尖走
   命令（agent 与人同一条路）：clone.stamp / clone.sourceList / clone.sourceSelect / clone.sourceSet /
                              clone.sourceResetTransform / clone.setOptions */
(function(){

/* ───────── clone_source.rs：取样槽 ───────── */
const SLOTS = 5;
const newSlot = () => ({ source:null, anchor:null, layer:null, scale:[100,100], rotation:0, flipH:false, flipV:false });
/* CloneOverlay：面板上的「显示叠加」选项（他们只存不画：ui-egui 里没有任何地方读它来画叠加，照抄） */
const newOverlay = () => ({ show:true, opacity:100, clipped:true, autoHide:true, invert:false, blend:'normal' });
const CS = { slots: Array.from({length:SLOTS}, newSlot), active: 0, overlay: newOverlay() };   // CloneSources（跟 session 走，换文件也保留）
const activeSlot = () => CS.slots[Math.min(CS.active, SLOTS-1)];
/* Rust f64::round：.5 远离 0（JS 的 Math.round 是往 +∞） */
const roundAway = v => v < 0 ? -Math.round(-v) : Math.round(v);
const remEuclid = (a, b) => ((a % b) + b) % b;

/* 面板上的 Offset X/Y：source − anchor（要等一笔把两者配成对才有） */
function slotOffset(s){ return (s.source && s.anchor) ? [s.source[0]-s.anchor[0], s.source[1]-s.anchor[1]] : null; }
function slotJSON(s, i){
  return { index:i, source:s.source, anchor:s.anchor, offset:slotOffset(s), layer:s.layer,
           width:s.scale[0], height:s.scale[1], rotation:s.rotation, flipH:s.flipH, flipV:s.flipV };
}

/* Mapping：目的点 d 读取源 source + m·(d − anchor)（m 为 2×2 行优先） */
function Mapping(source, anchor, m){ this.source = source; this.anchor = anchor; this.m = m; }
Mapping.prototype.isTranslation = function(){
  const m = this.m;
  return Math.abs(m[0]-1) < 1e-12 && Math.abs(m[1]) < 1e-12 && Math.abs(m[2]) < 1e-12 && Math.abs(m[3]-1) < 1e-12;
};
/* 整数位移（恒等变换时用） */
Mapping.prototype.offset = function(){
  return [roundAway(this.source[0]-this.anchor[0]), roundAway(this.source[1]-this.anchor[1])];
};
Mapping.prototype.map = function(x, y){
  const dx = x - this.anchor[0], dy = y - this.anchor[1], m = this.m;
  return [this.source[0] + m[0]*dx + m[1]*dy, this.source[1] + m[2]*dx + m[3]*dy];
};

/* 槽的 W/H、旋转、翻转 → 把「目的位移」变成「源位移」的矩阵 */
function transformMatrix(scale, rotationDeg, flipH, flipV){
  const sx = Math.max(scale[0]/100, 1e-3) * (flipH ? -1 : 1);
  const sy = Math.max(scale[1]/100, 1e-3) * (flipV ? -1 : 1);
  // 正向（源→目的）：先缩放再旋转。画面上逆时针＝y 朝下数学里的顺时针
  const a = -rotationDeg * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
  const f = [c*sx, -s*sy, s*sx, c*sy];
  const det = f[0]*f[3] - f[1]*f[2];
  return [f[3]/det, -f[1]/det, -f[2]/det, f[0]/det];
}

/* 取 [x,y] 参数（两个数字才算） */
function pt(p, k){
  const a = p[k];
  if (!Array.isArray(a) || typeof a[0] !== 'number' || typeof a[1] !== 'number') return null;
  return [a[0], a[1]];
}
const has = (p, k) => Object.prototype.hasOwnProperty.call(p, k) && p[k] !== undefined;
const asBool = (v, d) => typeof v === 'boolean' ? v : d;
const asNum  = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;

/* mapping()：一笔怎么取样。aligned 时槽记住 anchor，后面的笔都对着原本那一对配对取样 */
function mapping(p, first){
  const aligned = asBool(p.aligned, true);
  const slot = activeSlot();
  const explicitTf = ['scale','rotation','flipH','flipV'].some(k => has(p, k));
  let m;
  if (explicitTf){
    const a = Array.isArray(p.scale) ? p.scale : null;
    const sc = a ? [asNum(a[0], 100), asNum(a[1], 100)] : [100, 100];
    m = transformMatrix(sc, asNum(p.rotation, 0), asBool(p.flipH, false), asBool(p.flipV, false));
  } else {
    m = transformMatrix(slot.scale, slot.rotation, slot.flipH, slot.flipV);
  }
  const anchorParam = pt(p, 'anchor');
  const off = pt(p, 'offset');
  if (off){
    const a = anchorParam || first;
    return { map: new Mapping([a[0]+off[0], a[1]+off[1]], a, m) };
  }
  const src = pt(p, 'source');
  if (src) return { map: new Mapping(src, anchorParam || first, m) };
  if (!slot.source) return { error: 'clone.stamp: missing `source` ([x,y]) or `offset` ([dx,dy]); or set one with clone.sourceSet' };
  const anchor = (aligned && slot.anchor) ? slot.anchor.slice() : first;
  if (aligned) activeSlot().anchor = [anchor[0], anchor[1]];
  return { map: new Mapping(slot.source.slice(), anchor, m) };
}

/* ───────── paint/src/lib.rs、dynamics.rs、retouch.rs：dab 与整笔覆盖图 ───────── */
/* 圆 dab 在距圆心 d 处的覆盖率（边缘 1px 反锯齿 × smoothstep 硬度衰减） */
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
/* dynamics.rs base_diameter：pressure_size 预设开 ⇒ 直径＝size × 压力（滑鼠压力＝1） */
const baseDiameter = (brush, q) => brush.size * Math.min(Math.max(q[2], 0), 1);
/* DabBuilder::step_len：max(直径,1) × spacing（至少 0.01），再至少 0.5 像素 */
const stepLen = (brush, q) => Math.max(Math.max(baseDiameter(brush, q), 1) * Math.max(brush.spacing, 0.01), 0.5);
/* PathWalker：沿折线每隔 step_len 像素落一个 dab；第一点等第二点来（知道方向）才吐出，整笔只有一点就收笔时吐 */
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
        const p = [last[0] + dx*t, last[1] + dy*t, last[2] + (q[2]-last[2])*t];     // lerp_pt：压力也内插
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
/* dab 的外框（含 1px 反锯齿余量） [x0,y0,x1,y1) */
function dabRect(c, radius){
  const rr = Math.ceil(radius) + 1, cx = Math.floor(c[0]), cy = Math.floor(c[1]);
  return [cx-rr, cy-rr, cx+rr+1, cy+rr+1];
}
/* stroke_coverage：整笔覆盖图。dab 一个个累积：c ← c + v·(ceil − c)（flow 往上叠、封顶在 dab 不透明度 1） */
function strokeCoverage(points, brush){
  // 点可带第三个数＝压力（缺省 1，同 StrokePoint 的滑鼠预设）
  const pts = points.map(q => [q[0], q[1], (typeof q[2] === 'number' && isFinite(q[2])) ? q[2] : 1]);
  const dabs = walkDabs(pts, brush);
  if (!dabs.length) return { rect:[0,0,0,0], cov:new Float32Array(0) };
  // DabBuilder::build：radius ＝ max(直径/2, 0.5)；圆笔尖 rm ＝ max(r×roundness(=1), 0.5)
  const radiusOf = d => Math.max(baseDiameter(brush, d)/2, 0.5);
  let R = null;
  for (const d of dabs){
    const r = dabRect(d, radiusOf(d));
    R = R ? [Math.min(R[0],r[0]), Math.min(R[1],r[1]), Math.max(R[2],r[2]), Math.max(R[3],r[3])] : r;
  }
  const W = R[2]-R[0], H = R[3]-R[1], cov = new Float32Array(W*H), ceil = 1;   // pressure_opacity 预设关 ⇒ 每个 dab 的不透明度上限＝1
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

/* ───────── retouch_cmds.rs：取样来源 ───────── */
/* 要取样的那一份像素（文件坐标 X,Y → 缓冲 (X−ox, Y−oy)） */
function sourceBuffer(L, which){
  if (which === 'current'){
    const c = L.data.canvas;
    return { d: L.data.ctx.getImageData(0, 0, c.width, c.height).data, w:c.width, h:c.height, ox:L.x, oy:L.y };
  }
  // currentAndBelow：把目标层上面的全部藏起来再合成（同他们 clone 一份文件、把上面的层 visible=false）
  const idx = Doc.index(L.id), hidden = [];
  if (which === 'currentAndBelow') Doc.layers.forEach((l, i) => { if (i > idx && l.visible){ l.visible = false; hidden.push(l); } });
  let c;
  try { c = composite(1); } finally { hidden.forEach(l => l.visible = true); }
  return { d: c.getContext('2d').getImageData(0, 0, c.width, c.height).data, w:c.width, h:c.height, ox:0, oy:0 };
}
/* 读一个像素（缓冲外＝透明） */
function fetchPx(S, x, y, out){
  const bx = x - S.ox, by = y - S.oy;
  if (bx < 0 || by < 0 || bx >= S.w || by >= S.h){ out[0]=out[1]=out[2]=out[3]=0; return; }
  const i = (by*S.w + bx)*4;
  out[0]=S.d[i]; out[1]=S.d[i+1]; out[2]=S.d[i+2]; out[3]=S.d[i+3];
}
/* clone_sample：恒等变换＝整数平移直读；有缩放／旋转／翻转＝双线性重采样（按 alpha 预乘内插） */
function cloneSample(S, rect, map){
  const W = rect[2]-rect[0], H = rect[3]-rect[1], out = new Float32Array(W*H*4), q = [0,0,0,0];
  if (map.isTranslation()){
    const off = map.offset();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
      fetchPx(S, rect[0]+x+off[0], rect[1]+y+off[1], q);
      out.set(q, (y*W+x)*4);
    }
    return out;
  }
  const Q = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  const pre = b => { const a = b[3]/255; b[0]*=a; b[1]*=a; b[2]*=a; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const [sx, sy] = map.map(rect[0]+x+0.5, rect[1]+y+0.5);
    const fx = sx - 0.5, fy = sy - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    fetchPx(S, x0, y0, Q[0]); fetchPx(S, x0+1, y0, Q[1]); fetchPx(S, x0, y0+1, Q[2]); fetchPx(S, x0+1, y0+1, Q[3]);
    Q.forEach(pre);
    const o = (y*W+x)*4;
    for (let c = 0; c < 4; c++){
      const top = Q[0][c] + (Q[1][c]-Q[0][c])*tx, bot = Q[2][c] + (Q[3][c]-Q[2][c])*tx;
      out[o+c] = top + (bot-top)*ty;
    }
    const av = out[o+3]/255;
    for (let c = 0; c < 3; c++) out[o+c] = av > 1e-6 ? out[o+c]/av : 0;
  }
  return out;
}

/* ───────── retouch.rs apply_coverage：把 paint 经过覆盖图贴到图层 ─────────
   每像素权重 k = min(覆盖 × 不透明度 × 选区, 1)；normal 走 over_native，其他混合模式交给画布的 W3C 合成。 */
function applyCoverage(L, rect, cov, opacity, paint, mode){
  const W = rect[2]-rect[0];
  // 只写得进图层画布里的那一块（文件坐标）
  const cw = L.data.canvas.width, ch = L.data.canvas.height;
  const cx0 = Math.max(rect[0], L.x), cy0 = Math.max(rect[1], L.y);
  const cx1 = Math.min(rect[2], L.x + cw), cy1 = Math.min(rect[3], L.y + ch);
  if (cx1 <= cx0 || cy1 <= cy0) return;
  const s = Doc.sel;
  // 照选区的真形状（路径／套索／羽化的遮罩覆盖度）挡，不再只看外框矩形
  const selAt = (x, y) => {
    if (!s) return 1;
    if (window.SelMask) return SelMask.coverage(x, y, s);
    const sx0 = Math.min(s.x, s.x+s.w), sy0 = Math.min(s.y, s.y+s.h), sx1 = Math.max(s.x, s.x+s.w), sy1 = Math.max(s.y, s.y+s.h);
    return (x >= sx0 && x < sx1 && y >= sy0 && y < sy1) ? 1 : 0;
  };
  const rw = cx1-cx0, rh = cy1-cy0;
  const ctx = L.data.ctx;
  if (mode === 'normal'){
    const img = ctx.getImageData(cx0 - L.x, cy0 - L.y, rw, rh), d = img.data;
    for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++){
      const i = (y - rect[1])*W + (x - rect[0]);
      const k = Math.min(cov[i] * opacity * selAt(x, y), 1);
      if (k <= 0) continue;
      const o = ((y - cy0)*rw + (x - cx0))*4, pi = i*4;
      const da = d[o+3]/255, sa = paint[pi+3]/255 * k, oa = sa + da*(1 - sa);
      if (oa > 0) for (let c = 0; c < 3; c++) d[o+c] = (paint[pi+c]*sa + d[o+c]*da*(1 - sa)) / oa;
      d[o+3] = oa*255;
    }
    ctx.putImageData(img, cx0 - L.x, cy0 - L.y);
    return;
  }
  // 非 normal：paint 的 alpha 乘上 k，再用该混合模式叠上去（k=0 的像素 alpha=0，不动原图）
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
}

/* ───────── retouch_cmds.rs clone_stamp() ───────── */
const SAMPLES = ['current', 'currentAndBelow', 'all'];
function cloneStamp(p){
  const C = 'clone.stamp';
  if (!Array.isArray(p.points)) return {ok:false, error:`${C}: missing \`points\``};
  const pts = p.points.filter(a => Array.isArray(a) && typeof a[0] === 'number' && typeof a[1] === 'number')
                      .map(a => [a[0], a[1], typeof a[2] === 'number' ? a[2] : 1]);
  if (!pts.length) return {ok:false, error:`${C}: \`points\` is empty`};
  const lid = p.layerId !== undefined ? p.layerId : p.layer;
  const L = lid !== undefined ? Doc.byId(lid) : Doc.active();
  if (!L) return {ok:false, error:'no active layer'};
  if (L.kind !== 'raster') return {ok:false, error:`active layer is a ${L.kind} layer, not a pixel layer`};
  const pct = (k, d, lo, hi) => Math.min(Math.max(asNum(p[k], d), lo), hi) / 100;
  const brush = {
    size: Math.max(asNum(p.size, ToolState.size), 1),
    hardness: pct('hardness', ToolState.hardness*100, 0, 100),
    opacity: pct('opacity', 100, 1, 100),
    flow: pct('flow', 100, 1, 100),
    spacing: pct('spacing', 25, 1, 1000)
  };
  const which = typeof p.sampleLayer === 'string' ? p.sampleLayer : 'current';
  if (!SAMPLES.includes(which)) return {ok:false, error:`${C}: unknown sampleLayer \`${which}\` (current|currentAndBelow|all)`};
  const mode = typeof p.mode === 'string' ? p.mode : 'normal';
  if (!BLENDS.includes(mode)) return {ok:false, error:`${C}: unknown blend mode \`${mode}\``};
  const aligned = asBool(p.aligned, true);
  const r = mapping(p, pts[0]);
  if (r.error) return {ok:false, error:r.error};
  const map = r.map, off = map.offset();
  const { rect, cov } = strokeCoverage(pts, brush);
  // 取样全部来自落笔前的状态 ⇒ 这一笔前面贴上去的像素不会被后面再复制一次
  const paint = cloneSample(sourceBuffer(L, which), rect, map);
  applyCoverage(L, rect, cov, brush.opacity, paint, mode);
  // clone_result：aligned 时位移延续（下一笔＝它自己的第一点＋位移）；非 aligned 每笔都回到原取样点
  const f = pts[0], src = pt(p, 'source') || [f[0] + off[0], f[1] + off[1]];
  return { ok:true, damage:[rect[0], rect[1], rect[2]-rect[0], rect[3]-rect[1]], offset:off, aligned, nextSource: aligned ? null : src };
}

/* ───────── clone_source.rs 的命令 ───────── */
function slotIndex(p, cmd){
  if (p.index === undefined || p.index === null) return {i:CS.active};
  const i = p.index;
  if (!Number.isInteger(i) || i < 0) return {i:CS.active};          // as_u64 失败＝当作没给
  if (i >= SLOTS) return {error:`${cmd}: index ${i} out of range (0..${SLOTS})`};
  return {i};
}
function sourceSet(p){
  const C = 'clone.sourceSet';
  const r = slotIndex(p, C); if (r.error) return {ok:false, error:r.error};
  const i = r.i, slot = CS.slots[i];
  const src = pt(p, 'source');
  if (src){
    // 新取样点：跟下一笔重新配对
    slot.source = src; slot.anchor = null;
    slot.layer = p.layer !== undefined ? p.layer : (Doc.activeId || null);
  }
  const off = pt(p, 'offset');
  if (off){
    // 面板的 Offset X/Y：保留 anchor（没有就拿 source 当 anchor），移动 source
    const a = slot.anchor || slot.source;
    if (!a) return {ok:false, error:`${C}: set a \`source\` before an offset`};
    slot.anchor = a.slice(); slot.source = [a[0]+off[0], a[1]+off[1]];
  }
  if (Array.isArray(p.scale)) slot.scale = [asNum(p.scale[0], 100), asNum(p.scale[1], 100)];
  if (typeof p.width === 'number') slot.scale[0] = p.width;
  if (typeof p.height === 'number') slot.scale[1] = p.height;
  if (slot.scale.some(v => !(Math.abs(v) >= 1 && Math.abs(v) <= 1000))) slot.scale = slot.scale.map(v => Math.min(Math.max(v, 1), 1000));
  if (typeof p.rotation === 'number') slot.rotation = remEuclid(p.rotation + 180, 360) - 180;
  if (typeof p.flipH === 'boolean') slot.flipH = p.flipH;
  if (typeof p.flipV === 'boolean') slot.flipV = p.flipV;
  if (p.clear === true) CS.slots[i] = newSlot();
  if (asBool(p.select, true)) CS.active = i;
  return slotJSON(CS.slots[i], i);
}

CMD.reg('clone.stamp', {i18n:'', undoable:true,
  params:'{points:[[x,y],…] 文件坐标（必填）, source?:[sx,sy] 取样点（对准第一点）| offset?:[dx,dy] 源−目的, anchor?:[x,y], '
       + 'aligned=true（true＝整笔固定位移且记进取样槽，后续笔延续；false＝每笔都从取样点重来）, '
       + 'sampleLayer="current"|"currentAndBelow"|"all", size=工具大小 px, hardness=0..100（工具硬度）, opacity=1..100=100, flow=1..100=100, spacing=1..1000（% of size）=25, '
       + 'mode="normal"|"multiply"|…=normal, scale?:[w%,h%], rotation?:度（逆时针）, flipH?, flipV?（给了就盖过取样槽的变换）, layerId?} '
       + '没给 source/offset 就用 clone.sourceSet 设好的作用中取样槽 → {damage:[x,y,w,h], offset:[dx,dy], aligned, nextSource}'},
  // 他们出错时根本没进 s.edit()，不留历史；我们这边由共用层 CMD.run 在回 {ok:false} 时自己弹掉那格快照（这里别再弹，会多退一步）
  p => cloneStamp(p));
CMD.reg('clone.sourceList', {i18n:'', params:'{} → {active, sources:[{index,source,anchor,offset,layer,width,height,rotation,flipH,flipV}], overlay}'},
  () => ({ active:CS.active, sources: CS.slots.map(slotJSON), overlay: Object.assign({}, CS.overlay) }));
CMD.reg('clone.sourceSelect', {i18n:'', params:'{index:0..4} 切换作用中的取样槽'}, p => {
  // as_u64：不是非负整数就当作没给
  if (!Number.isInteger(p.index) || p.index < 0) return {ok:false, error:'clone.sourceSelect: missing `index`'};
  if (p.index >= SLOTS) return {ok:false, error:`clone.sourceSelect: index ${p.index} out of range (0..${SLOTS})`};
  CS.active = p.index; return slotJSON(activeSlot(), p.index);
});
CMD.reg('clone.sourceSet', {i18n:'',
  params:'{index?:0..4=作用中, source?:[x,y]（＝Alt 点；跟下一笔重新配对）, offset?:[dx,dy], width?:%, height?:% | scale?:[w%,h%]（1..1000）, '
       + 'rotation?:度（化到 -180..180）, flipH?, flipV?, layer?, clear?, select=true}'},
  p => sourceSet(p));
CMD.reg('clone.sourceResetTransform', {i18n:'', params:'{index?:0..4=作用中} W/H 回 100%、角度 0、取消翻转'}, p => {
  const r = slotIndex(p, 'clone.sourceResetTransform'); if (r.error) return {ok:false, error:r.error};
  const s = CS.slots[r.i]; s.scale = [100,100]; s.rotation = 0; s.flipH = false; s.flipV = false;
  return slotJSON(s, r.i);
});
/* clone_source.rs overlay()：逐项改叠加选项；opacity 夹到 0..100；blend 只认四种 */
CMD.reg('clone.sourceOverlay', {i18n:'', params:'{show?:bool, opacity?:0..100, clipped?:bool, autoHide?:bool, invert?:bool, blend?:"normal"|"darken"|"lighten"|"difference"} 仿制源叠加选项（只记状态）'}, p => {
  const o = CS.overlay;
  if (typeof p.show === 'boolean') o.show = p.show;
  if (typeof p.opacity === 'number' && isFinite(p.opacity)) o.opacity = Math.min(Math.max(p.opacity, 0), 100);
  if (typeof p.clipped === 'boolean') o.clipped = p.clipped;
  if (typeof p.autoHide === 'boolean') o.autoHide = p.autoHide;
  if (typeof p.invert === 'boolean') o.invert = p.invert;
  if (typeof p.blend === 'string'){
    if (!['normal','darken','lighten','difference'].includes(p.blend))
      return {ok:false, error:`clone.sourceOverlay: unknown overlay mode \`${p.blend}\` (normal|darken|lighten|difference)`};
    o.blend = p.blend;
  }
  return Object.assign({}, o);
});
CMD.reg('clone.setOptions', {i18n:'', params:'{aligned?:bool, sampleLayer?:"current"|"currentAndBelow"|"all", size?:px, hardness?:0..100} 滑鼠作画用的选项（＝选项栏）'}, p => {
  if (typeof p.aligned === 'boolean') U.aligned = p.aligned;
  if (SAMPLES.includes(p.sampleLayer)) U.sample = p.sampleLayer;
  if (typeof p.size === 'number') ToolState.size = Math.min(Math.max(Math.round(p.size), 1), 5000);
  if (typeof p.hardness === 'number') ToolState.hardness = Math.min(Math.max(p.hardness, 0), 100) / 100;
  if (window.UI && ToolState.cur === 'clone') UI.buildOptions('clone');
  return { aligned:U.aligned, sampleLayer:U.sample, size:ToolState.size, hardness:Math.round(ToolState.hardness*100) };
});

/* ───────── 界面这一侧（retouch_ui.rs / canvas.rs）的状态 ───────── */
const U = {
  source:null, offset:null,          // app.ui.clone_source / clone_offset
  aligned:true, sample:'current',    // tool_options.clone_aligned / clone_sample
  drag:null,                         // {start, points, axis}
  lastEnd:null,                      // app.last_stroke_end（Shift 点一下从这里连直线）
  trail:null,                        // stroke_trail
  resize:null,                       // brush_resize：{anchor, start:[size, hardness]}
  hover:null, alt:false, shift:false,
  status:null, statusError:false
};
/* 压力：笔才有；滑鼠一律 1（StrokePoint 预设）——浏览器给滑鼠按下时的 pressure 是 0.5，不能照收 */
const pressure = e => (e && e.pointerType === 'pen' && typeof e.pressure === 'number') ? e.pressure : 1;
const fmt = (s, kv) => s.replace(/\{(\w+)\}/g, (m, k) => kv[k] !== undefined ? kv[k] : m);

/* 状态字：存 i18n key＋参数（或引擎回来的原文），显示时才翻 ⇒ 换语言后跟着换，不会卡在旧语言 */
function statusText(st){
  if (!st) return '';
  return st.key ? fmt(Lang.t(st.key), st.args || {}) : String(st.text || '');
}
function setStatus(st, error){
  U.status = st; U.statusError = !!error;
  showStatus();
}
function showStatus(){
  const el = document.getElementById('cloneStatus'); if (!el) return;
  // 还没设过取样点、也没别的消息 ⇒ 选项栏尾巴提示「Alt 点设取样」（retouch_ui.rs:165-168）
  const st = U.status || (U.source ? null : {key:'ui.cloneSetSource'});
  el.textContent = statusText(st); el.style.color = (U.status && U.statusError) ? '#e8573f' : '#7a8290';
}

/* ⌥/Alt 点：设取样点（同时写进作用中的取样槽） */
function setSource(x, y){
  U.source = [roundAway(x), roundAway(y)];
  U.offset = null;
  CMD.run('clone.sourceSet', {source:[roundAway(x), roundAway(y)]});
  if (ToolState.cur === 'clone') UI.buildOptions('clone');     // 「Alt 点设取样」的提示只在没取样点时出现
  setStatus({key:'ui.cloneSourceAt', args:{x:x.toFixed(0), y:y.toFixed(0)}}, false);
}

/* finish_stroke：收笔叫命令。作用中的槽有取样点就交给引擎；否则 offset（aligned）或 source；都没有就报错不画 */
function strokeParams(points){
  const p = { aligned:U.aligned, sampleLayer:U.sample };
  const slot = !!activeSlot().source;
  if (!slot){
    if (U.offset && U.aligned) p.offset = U.offset.slice();
    else if (U.source) p.source = U.source.slice();
    else return null;
  }
  p.points = points.map(q => [q[0], q[1], q[2]]);
  return p;
}
/* 边拖边显示（照 PS）：
   按下时备份这一层；拖动中每帧把上一帧画过的那块还原成备份，再用到目前为止的点整笔重算一次（不进历史）。
   取样照旧来自落笔前的像素（备份已还原）。放开时整层还原，再走 CMD clone.stamp 正式落一次（进历史，Ctrl+Z 一步退） */
const Live = {
  begin(){
    const L = Doc.active(); this.L = null; this.dmg = null;
    if (!L || L.kind !== 'raster' || !L.data || !L.data.canvas) return;
    const cv = L.data.canvas, b = document.createElement('canvas'); b.width = cv.width; b.height = cv.height;
    b.getContext('2d').drawImage(cv, 0, 0); this.L = L; this.bak = b;
  },
  restore(){
    const L = this.L, d = this.dmg; if (!L || !d) return;
    const x = Math.max(0, Math.floor(d[0] - L.x)), y = Math.max(0, Math.floor(d[1] - L.y));
    const w = Math.min(L.data.canvas.width - x, Math.ceil(d[2]) + 2), h = Math.min(L.data.canvas.height - y, Math.ceil(d[3]) + 2);
    if (w > 0 && h > 0){ const c = L.data.ctx; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      c.clearRect(x, y, w, h); c.drawImage(this.bak, x, y, w, h, x, y, w, h); c.restore(); } // ⛔ 别用 copy：会把这块以外整层清掉
    this.dmg = null;
  },
  update(points){
    if (!this.L || Doc.active() !== this.L) return;
    const p = strokeParams(points); if (!p) return;
    this.restore(); p.layerId = this.L.id;
    const r = cloneStamp(p); if (r && r.ok) this.dmg = r.damage;
  },
  end(){ this.restore(); this.L = null; this.bak = null; }
};
function finishStroke(points){
  Live.end();
  const p = strokeParams(points);
  if (!p){ setStatus({key:'ui.cloneNoSource'}, true); return; }
  const r = CMD.run('clone.stamp', p);
  if (r && r.ok === false){ setStatus({text:r.error}, true); return; }
  // aligned：记住位移给下一笔；非 aligned：每笔都从取样点重来
  U.offset = (U.aligned && r && r.offset) ? r.offset.slice() : null;
}

/* ───────── stroke_constraint.rs ───────── */
const LOCK_DISTANCE = 3;     // 屏幕点：Shift 拖这么远才锁方向
function snappedDir(o, p, step){
  const dx = p[0]-o[0], dy = p[1]-o[1];
  if (!(isFinite(dx) && isFinite(dy)) || Math.hypot(dx, dy) < 1e-9 || step <= 0) return null;
  const a = roundAway(Math.atan2(dy, dx) / step) * step;      // f64::round：.5 远离 0
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

/* ───────── stroke_trail.rs：拖曳时的半透明足迹（覆盖取最大，重叠不加深） ───────── */
const MAX_SIDE = 1024;
const TRAIL_ALPHA = 60;            // canvas.rs draw_drag_preview：Color32::from_white_alpha(60)
function trailNew(){
  // Trail::new：k ＝ ceil(最长边 / 1024)，大文件就降采样
  const k = Math.max(1, Math.ceil(Math.max(Doc.width, Doc.height) / MAX_SIDE));
  const w = Math.max(1, Math.ceil(Doc.width / k)), h = Math.max(1, Math.ceil(Doc.height / k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { c, x:c.getContext('2d'), k, w, h, cov:new Uint8Array(w*h), fed:0, dirty:null };
}
/* Trail::capsule：一段 a→b 的胶囊覆盖（边缘 1 个遮罩像素反锯齿），取最大值，重叠不加深 */
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
/* Trail::feed：只盖还没盖过的拖曳点；半径＝max(直径,1)/2 ÷ k */
function trailFeed(t, points, diameter){
  if (t.fed >= points.length) return;
  const r = (Math.max(diameter, 1) / 2) / t.k, m = q => [q[0]/t.k, q[1]/t.k];
  for (let i = t.fed; i < points.length; i++){
    const b = m(points[i]), a = i > 0 ? m(points[i-1]) : b;
    trailCapsule(t, a, b, r);
  }
  t.fed = points.length;
  // Trail::image ＋ set_partial：只把变了的那块传上去；alpha ＝ 覆盖 × 60 / 255
  if (t.dirty){
    const [x0, y0, x1, y1] = t.dirty, w = x1-x0, h = y1-y0, img = t.x.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const o = (y*w + x)*4;
      d[o] = d[o+1] = d[o+2] = 255; d[o+3] = Math.floor(t.cov[(y0+y)*t.w + x0 + x] * TRAIL_ALPHA / 255);
    }
    t.x.putImageData(img, x0, y0); t.dirty = null;
  }
}

/* ───────── brush_resize.rs：Ctrl+Alt 拖曳改笔刷 ───────── */
const HARDNESS_TRAVEL = 200;       // 屏幕点：垂直拖这么多＝硬度 0→100%
function resized(start, dx, dy, zoom){
  dx = isFinite(dx) ? dx : 0; dy = isFinite(dy) ? dy : 0;
  zoom = (isFinite(zoom) && zoom > 0) ? zoom : 1;
  const size = Math.min(Math.max(Math.round(start[0] + 2*dx), 1), 5000);
  const hardness = Math.min(Math.max(start[1] + dy*zoom/HARDNESS_TRAVEL, 0), 1);
  return [size, Math.round(hardness*100)/100];         // 整数百分比，同读数与选项栏
}
function resizeUpdate(x, y){
  const r = U.resize;
  const [size, hardness] = resized(r.start, x - r.anchor[0], y - r.anchor[1], UI.zoom);
  if (ToolState.size === size && ToolState.hardness === hardness) return;
  CMD.map['clone.setOptions'].run({size, hardness:hardness*100});   // 拖曳中只改值不刷整个界面；放开再刷
}

/* preset_panels.rs clone_sample_point() ＋ retouch_ui.rs draw_source_marker()：笔尖此刻对应的取样点 */
function markerPoint(){
  const at = (U.drag && U.drag.points.length) ? U.drag.points[U.drag.points.length-1] : U.hover;
  const s = activeSlot();
  if (s.source){
    const stroking = U.drag ? U.drag.start : null;
    const anchor = U.aligned ? (s.anchor || stroking) : stroking;
    if (anchor && at) return new Mapping(s.source, anchor, transformMatrix(s.scale, s.rotation, s.flipH, s.flipV)).map(at[0], at[1]);
    return s.source;
  }
  if (U.offset && at) return [at[0]+U.offset[0], at[1]+U.offset[1]];
  if (!U.offset && U.source) return U.source;
  return null;
}

const tool = Tools.reg({
  id:'clone', icon:'❖', key:'C', group:'raster', order:40, for:'raster', needs:'raster', opts:['size','hardness'],
  cursor:'none',                       // canvas.rs：画笔类工具藏起系统游标、自己画笔尖圆圈
  cs:CS, ui:U,                         // 给测试与 agent 看的状态
  mapping, transformMatrix, strokeCoverage, markerPoint, trailCoverage: (x, y) => U.trail ? U.trail.cov[y*U.trail.w + x] : 0,

  strings:{
    'zh-Hant':{ 'opt.aligned':'對齊', 'opt.sample':'樣本',
      'opt.sample.current':'目前圖層', 'opt.sample.currentAndBelow':'目前及下方圖層', 'opt.sample.all':'所有圖層',
      'ui.cloneSetSource':'按住 Alt 點一下設定取樣點', 'ui.cloneNoSource':'請先按住 Alt 點一下，設定要仿製的取樣點',
      'ui.cloneSourceAt':'取樣點已設在 {x}, {y}', 'ui.cloneDiameter':'直徑：', 'ui.cloneHardness':'硬度：' },
    'zh-Hans':{ 'opt.aligned':'对齐', 'opt.sample':'样本',
      'opt.sample.current':'当前图层', 'opt.sample.currentAndBelow':'当前和下方图层', 'opt.sample.all':'所有图层',
      'ui.cloneSetSource':'按住 Alt 点一下设置取样点', 'ui.cloneNoSource':'请先按住 Alt 点一下，设置要仿制的取样点',
      'ui.cloneSourceAt':'取样点已设在 {x}, {y}', 'ui.cloneDiameter':'直径：', 'ui.cloneHardness':'硬度：' },
    'en':{ 'opt.aligned':'Aligned', 'opt.sample':'Sample',
      'opt.sample.current':'Current Layer', 'opt.sample.currentAndBelow':'Current & Below', 'opt.sample.all':'All Layers',
      'ui.cloneSetSource':'Alt-click to set the source', 'ui.cloneNoSource':'Alt-click to define a source point to clone from',
      'ui.cloneSourceAt':'Clone source set at {x}, {y}', 'ui.cloneDiameter':'Diameter:', 'ui.cloneHardness':'Hardness:' }
  },

  /* retouch_ui.rs options_bar：对齐勾选、样本下拉；还没取样点时提示「Alt 点设取样」 */
  buildOptions(box, add, mk){
    const cb = mk('checkbox', {checked:U.aligned});
    cb.dataset.opt = 'aligned';
    cb.onchange = () => CMD.run('clone.setOptions', {aligned:cb.checked});
    add('aligned', cb);
    const sel = document.createElement('select');
    sel.dataset.opt = 'sample';
    SAMPLES.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = Lang.t('opt.sample.'+v); sel.appendChild(o); });
    sel.value = U.sample;
    sel.onchange = () => CMD.run('clone.setOptions', {sampleLayer:sel.value});
    add('sample', sel);
    const st = document.createElement('span'); st.id = 'cloneStatus'; st.style.color = '#7a8290';
    box.appendChild(st);
    showStatus();
  },

  onDown(e, pt, P){
    U.alt = e.altKey; U.shift = e.shiftKey; U.hover = pt;
    // brush_resize::pointer：Control+Alt 按下＝改笔刷，不作画
    if (e.ctrlKey && e.altKey && !U.drag){
      U.resize = { anchor:pt.slice(), start:[ToolState.size, ToolState.hardness] };
      UI.draw(); return;
    }
    // canvas.rs：Alt 点只设取样点（也不问要不要点阵化）
    if (e.altKey){ setSource(pt[0], pt[1]); P.down = false; UI.draw(); return; }
    P.ensureRaster();
    // Shift 点一下（上一笔之后）：从上一笔终点连一条直线，算同一笔、同一步历史
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
      // tool_move：离上一点超过 0.25 像素（曼哈顿）才收一点
      if (!d.points.length || Math.abs(last[0]-q[0]) + Math.abs(last[1]-q[1]) > 0.25) d.points.push([q[0], q[1], pressure(e)]);
      trailFeed(U.trail, d.points, ToolState.size);
      Live.update(d.points);
    }
    UI.draw();                           // 悬停也重画：笔尖圆圈、取样十字、Shift 橡皮筋都跟着走
  },
  onUp(e, pt){
    U.alt = e.altKey; U.shift = e.shiftKey;
    if (U.resize){
      resizeUpdate(pt[0], pt[1]); U.resize = null;
      CMD.run('clone.setOptions', {});   // 放开：选项栏的大小／硬度跟上
      return;
    }
    const d = U.drag; U.drag = null; U.trail = null;
    if (!d){ UI.draw(); return; }
    const last = d.points.length ? d.points[d.points.length-1] : d.start;
    const q = constrain(d, last, pt, e.shiftKey);
    // 放开点跟最后一点不同才补上，压力沿用最后一点的（canvas.rs ToolEvent::Up）
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
    // 1 拖曳中的足迹（白色，alpha 已在遮罩里乘过 60/255；TextureOptions::LINEAR ⇒ 平滑放大）
    // 边拖边显示（Live）已经把真像素画上去 ⇒ 不再叠白色足迹；没取样点等画不出来时才留足迹
    if (U.trail && !Live.dmg){
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(U.trail.c, 0, 0, U.trail.w*U.trail.k*s, U.trail.h*U.trail.k*s);
    }
    const line = (a, b, w, col) => { ctx.lineWidth = w*dpr; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
    const cross = (c, len, layers) => layers.forEach(([w, col]) => {
      line([c[0]-len*dpr, c[1]], [c[0]+len*dpr, c[1]], w, col);
      line([c[0], c[1]-len*dpr], [c[0], c[1]+len*dpr], w, col);
    });
    // 2 取样十字（黑底 3px＋白 1px，±7 点）
    const m = markerPoint();
    if (m) cross(scr(m), 7, [[3, 'rgba(0,0,0,0.63)'], [1, '#fff']]);
    // 3 Shift 橡皮筋：上一笔终点 → 游标（没在画时）
    if (U.shift && U.lastEnd && !U.drag && U.hover && !U.resize){
      const a = scr(U.lastEnd), b = scr(U.hover);
      line(a, b, 2.5, 'rgba(0,0,0,0.47)'); line(a, b, 1, 'rgba(255,255,255,0.9)');
    }
    // 4 Ctrl+Alt 改笔刷：圆圈钉在起点、红色笔尖预览（实心到硬度那一圈再淡出）、旁边读数
    if (U.resize){
      const c = scr(U.resize.anchor), R = Math.max(ToolState.size/2*z, 1)*dpr, inner = R*Math.min(Math.max(ToolState.hardness, 0), 1);
      const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], R);
      g.addColorStop(0, 'rgba(255,0,0,0.43)'); g.addColorStop(inner/R, 'rgba(255,0,0,0.43)'); g.addColorStop(1, 'rgba(255,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, Math.PI*2); ctx.fill();
      ctx.lineWidth = dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(c[0], c[1], R + 0.5*dpr, 0, Math.PI*2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.86)'; ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, Math.PI*2); ctx.stroke();
      if (U.hover){
        const h = scr(U.hover), t1 = `${Lang.t('ui.cloneDiameter')} ${Math.round(ToolState.size)} px`, t2 = `${Lang.t('ui.cloneHardness')} ${Math.round(ToolState.hardness*100)}%`;
        ctx.font = `${12*dpr}px sans-serif`;
        const w = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 12*dpr;
        ctx.fillStyle = 'rgba(30,32,36,0.9)'; ctx.fillRect(h[0]+14*dpr, h[1]+14*dpr, w, 38*dpr);
        ctx.fillStyle = '#e6e8eb'; ctx.fillText(t1, h[0]+20*dpr, h[1]+29*dpr); ctx.fillText(t2, h[0]+20*dpr, h[1]+45*dpr);
      }
    } else if (U.hover && U.alt && !U.drag){
      // 5a 按住 Alt（还没在拖）：照 PS 换成取样用的瞄准圈——小圆＋穿出圆外的十字，不画笔尖圈
      const c = scr(U.hover), R = 7*dpr, L = 11*dpr;
      [[3, 'rgba(0,0,0,0.6)'], [1, 'rgba(255,255,255,0.95)']].forEach(([w, col]) => {
        ctx.lineWidth = w*dpr; ctx.strokeStyle = col;
        ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(c[0]-L, c[1]); ctx.lineTo(c[0]+L, c[1]); ctx.moveTo(c[0], c[1]-L); ctx.lineTo(c[0], c[1]+L); ctx.stroke();
      });
    } else if (U.hover){
      // 5 笔尖圆圈（NormalTip：完整半径 ×(0.5＋0.5×硬度)）；仿制图章只有按住 Alt 才画中心十字
      const c = scr(U.hover), full = Math.max(ToolState.size/2*z, 1);
      const r = Math.max(full*(0.5 + 0.5*Math.min(Math.max(ToolState.hardness, 0), 1)), 1)*dpr;
      ctx.lineWidth = dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(c[0], c[1], r + 0.5*dpr, 0, Math.PI*2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.86)'; ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI*2); ctx.stroke();
      if (U.alt) cross(c, 3, [[2.5, 'rgba(0,0,0,0.55)'], [1, 'rgba(255,255,255,0.86)']]);
    }
    ctx.restore();
  }
});

/* ui.js 在按住 Alt／Ctrl 时不把键盘事件交给工具，所以这里自己听 Alt／Shift 的按下放开，好即时重画中心十字与橡皮筋 */
function modKey(e){
  if (ToolState.cur !== 'clone' || !window.UI || !UI.canvas) return;
  if (e.key === 'Alt' || e.key === 'Shift'){
    const a = e.altKey, sh = e.shiftKey;
    if (a !== U.alt || sh !== U.shift){ U.alt = a; U.shift = sh; UI.draw(); }
  }
}
document.addEventListener('keydown', modKey);
document.addEventListener('keyup', modKey);
/* 游标离开画布：笔尖圆圈跟着收掉 */
window.addEventListener('DOMContentLoaded', () => {
  const v = document.getElementById('view');
  if (v) v.addEventListener('pointerleave', () => { if (ToolState.cur === 'clone' && !U.drag){ U.hover = null; UI.draw(); } });
});

window.CloneStamp = tool;
/* 描边路径（PS 路径面板 ▸ 描边路径 ▸ 仿制图章）：同滑鼠收笔那包参数（选项栏对齐／样本＋作用中取样槽）；没取样点回 null */
tool.pathParams = (L, points) => { const p = strokeParams(points); if (p) p.layerId = L.id; return p; };
})();
