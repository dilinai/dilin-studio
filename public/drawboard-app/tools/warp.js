/* 堤麟画板 · 变形工具 warp（AI 版面 ai.warp，Shift+R）＋ 液化家族共用核 window.Liquify
   🔴 液化家族七颗（warp／twirl／pucker／bloat／scallop／crystallize／wrinkle）共用这支档的 Liquify：
      twirl.js、pucker.js、bloat.js、scallop.js、crystallize.js、wrinkle.js 各只叫 Liquify.makeTool('<id>')。
   逐段翻自 ArtCraft VectorCraft：
     crates/tools/src/distort/liquify.rs（911 行）  LiquifyKind／LiquifyParams（from_json、to_json、options_json、dab_spacing、detail_spacing、
                                                   simplify_tolerance、brush_bounds、falloff）、Dabber（重取样成笔印、按住不动＝多一印）、
                                                   hash／noise（splitmix64）、subdivide（笔刷碰到的线段细分、直线先变曲线）、displace（七种位移场）、
                                                   apply_dab、simplify（移掉平的多余锚点）、PathStroke（增量套用；finish＝收尾印＋简化）、
                                                   LiquifyTool（按下／拖／放开、Alt 拖改笔刷大小（Shift 等比）、tick 按住不动每 0.1 秒多一印、叠画笔刷椭圆）
     crates/tools/src/distort.rs:32-42           create：七个 id 都是 LiquifyTool::new(id)
     crates/tools/src/settings.rs:22-23          全域笔刷尺寸（width／height／angle／intensity／usePressure／showBrush）七颗共用；其余选项各颗自己的
     crates/engine/src/cmd/distortcmds.rs:384-620 object.liquify：参数、Targets（选取，或没选取＝全部可见物件；隐藏／锁住的不动；
                                                   文字／符号／图像／网格／封套／重复／混合／图表＝留着不动、回 skipped＋warning）、LiquifyStroke（增量）
   我们这边：
     命令 <id>.apply（七颗各一条，tool 固定）＝他们的 object.liquify；<id>.options＝tool 的 options()/set_option()。
     形状：bezier 原样改锚点；活形状（rect／ellipse／star／polygon／path／line）被碰到且真的动了才转成 bezier（＝他们 *live = None）。
     编组／复合路径：往里面找成员路径（他们 visit children）。
     坐标：命令收文件坐标，进每一层时减 L.x／L.y（铁律④）；每层各算一份笔划（笔印间距与平移无关，结果一样）。 */
(function(){
const KINDS = ['warp', 'twirl', 'pucker', 'bloat', 'scallop', 'crystallize', 'wrinkle'];
const LABEL = {warp:'Warp', twirl:'Twirl', pucker:'Pucker', bloat:'Bloat', scallop:'Scallop', crystallize:'Crystallize', wrinkle:'Wrinkle'};
const holds = k => k === 'twirl' || k === 'pucker' || k === 'bloat';                    // liquify.rs:71-73
const simplifies = k => k === 'warp' || k === 'twirl' || k === 'pucker' || k === 'bloat';   // liquify.rs:75-77
const noisy = k => k === 'scallop' || k === 'crystallize' || k === 'wrinkle';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ── 二维小工具（Point／Vec2／kurbo Rect）── */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const rect = (x0, y0, x1, y1) => ({x0, y0, x1, y1});
const rectPts = (a, b) => rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]));
const rw = r => r.x1 - r.x0, rh = r => r.y1 - r.y0;
/* kurbo Rect::intersect(...).area()：重叠部分的面积（不重叠＝0） */
const interArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const inflate = (r, d) => rect(r.x0 - d, r.y0 - d, r.x1 + d, r.y1 + d);
const union = (a, b) => rect(Math.min(a.x0, b.x0), Math.min(a.y0, b.y0), Math.max(a.x1, b.x1), Math.max(a.y1, b.y1));
const unionPt = (r, p) => rect(Math.min(r.x0, p[0]), Math.min(r.y0, p[1]), Math.max(r.x1, p[0]), Math.max(r.y1, p[1]));
/* kurbo Rect::contains：左上含、右下不含 */
const contains = (r, p) => p[0] >= r.x0 && p[0] < r.x1 && p[1] >= r.y0 && p[1] < r.y1;

/* ── 三次贝兹（kurbo CubicBez）── c = {p0, p1, p2, p3} */
function evalCubic(c, t){
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return [a * c.p0[0] + b * c.p1[0] + d * c.p2[0] + e * c.p3[0], a * c.p0[1] + b * c.p1[1] + d * c.p2[1] + e * c.p3[1]];
}
/* de Casteljau：subsegment(0..t)、subsegment(t..1) */
function splitCubic(c, t){
  const p01 = lerp(c.p0, c.p1, t), p12 = lerp(c.p1, c.p2, t), p23 = lerp(c.p2, c.p3, t), p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t), m = lerp(p012, p123, t);
  return [{p0:c.p0, p1:p01, p2:p012, p3:m}, {p0:m, p1:p123, p2:p23, p3:c.p3}];
}
/* ParamCurveExtrema::bounding_box：端点＋导数为零处 */
function cubicBBox(c){
  let r = rectPts(c.p0, c.p3);
  for (let ax = 0; ax < 2; ax++){
    const p0 = c.p0[ax], p1 = c.p1[ax], p2 = c.p2[ax], p3 = c.p3[ax];
    const A = -p0 + 3 * p1 - 3 * p2 + p3, B = 2 * (p0 - 2 * p1 + p2), C = p1 - p0, ts = [];
    if (Math.abs(A) < 1e-12){ if (Math.abs(B) > 1e-12) ts.push(-C / B); }
    else { const D = B * B - 4 * A * C; if (D >= 0){ const s = Math.sqrt(D); ts.push((-B + s) / (2 * A), (-B - s) / (2 * A)); } }
    ts.forEach(t => { if (t > 0 && t < 1) r = unionPt(r, evalCubic(c, t)); });
  }
  return r;
}
/* ParamCurveArclen::arclen(accuracy)：控制多边形与弦长差在容差内就用 (弦＋多边形)/2（Gravesen），否则对半切 */
function arclen(c, acc, depth){
  depth = depth || 0;
  const chord = dist(c.p0, c.p3), poly = dist(c.p0, c.p1) + dist(c.p1, c.p2) + dist(c.p2, c.p3);
  if (poly - chord <= acc || depth >= 16) return (chord + poly) / 2;
  const [l, r] = splitCubic(c, 0.5);
  return arclen(l, acc / 2, depth + 1) + arclen(r, acc / 2, depth + 1);
}

/* ── SubPath（geom/src/path.rs）── sp = {anchors:[{p, hi, ho, kind}], closed}；没把手＝把手等于 p ── */
const segCount = sp => { const n = sp.anchors.length; return n < 2 ? 0 : (sp.closed ? n : n - 1); };
const segment = (sp, i) => { const n = sp.anchors.length, a = sp.anchors[i % n], b = sp.anchors[(i + 1) % n]; return {p0:a.p, p1:a.ho, p2:b.hi, p3:b.p}; };
const segIsLine = (sp, i) => { const n = sp.anchors.length, a = sp.anchors[i % n], b = sp.anchors[(i + 1) % n]; return eq(a.ho, a.p) && eq(b.hi, b.p); };
/* path.rs:254-270 insert_anchor：直线段插直角点；曲线段切开、两边把手改成切出来的、中间点 Smooth → 新点的索引 */
function insertAnchor(sp, seg, t){
  const n = sp.anchors.length, c = segment(sp, seg), line = segIsLine(sp, seg);
  const [l, r] = splitCubic(c, t), i0 = seg % n, i1 = (seg + 1) % n;
  let mid;
  if (line) mid = {p:l.p3.slice(), hi:l.p3.slice(), ho:l.p3.slice(), kind:'corner'};
  else {
    sp.anchors[i0].ho = l.p1; sp.anchors[i1].hi = r.p2;
    mid = {p:l.p3, hi:l.p2, ho:r.p1, kind:'smooth'};
  }
  sp.anchors.splice(seg + 1, 0, mid);
  return seg + 1;
}
const cloneSp = sp => ({closed:sp.closed, anchors:sp.anchors.map(a => ({p:a.p.slice(), hi:a.hi.slice(), ho:a.ho.slice(), kind:a.kind}))});
const clonePath = path => path.map(cloneSp);

/* ── 参数（liquify.rs:84-259 LiquifyParams）── */
function defaults(kind){
  return {kind, width:100, height:100, angle:0, intensity:0.5, usePressure:false, detail:2, simplify:50, simplifyOn:true,
          rate:40, complexity:1, horizontal:0, vertical:1, affectAnchors:true, affectIn:true, affectOut:true};
}
/* from_json：百分比（>1）也收（intensity／horizontal／vertical）；diameter＝宽高一起 */
function fromJson(p){
  if (!p || !KINDS.includes(p.tool)) return null;
  const s = defaults(p.tool);
  const f = k => (typeof p[k] === 'number' && isFinite(p[k])) ? p[k] : undefined;
  const or = (v, d) => v === undefined ? d : v;
  const pct = v => v > 1 ? v / 100 : v;
  if (f('diameter') !== undefined){ s.width = f('diameter'); s.height = f('diameter'); }
  s.width = clamp(or(f('width'), s.width), 0.5, 10000);
  s.height = clamp(or(f('height'), s.height), 0.5, 10000);
  s.angle = or(f('angle'), 0);
  s.intensity = clamp(pct(or(f('intensity'), 0.5)), 0, 1);
  s.detail = clamp(or(f('detail'), 2), 1, 10);
  s.simplify = clamp(or(f('simplify'), 50), 0, 100);
  s.rate = clamp(or(f('rate'), 40), -180, 180);
  s.complexity = clamp(or(f('complexity'), 1), 0, 15);
  s.horizontal = clamp(pct(or(f('horizontal'), 0)), 0, 1);
  s.vertical = clamp(pct(or(f('vertical'), 1)), 0, 1);
  const b = (k, d) => typeof p[k] === 'boolean' ? p[k] : d;
  s.affectAnchors = b('affectAnchors', true); s.affectIn = b('affectIn', true); s.affectOut = b('affectOut', true);
  s.usePressure = b('usePressure', false); s.simplifyOn = b('simplifyOn', true);
  return s;
}
/* to_json：这一种用得到的参数 */
function toJson(s){
  const v = {tool:s.kind, width:s.width, height:s.height, angle:s.angle, intensity:s.intensity, detail:s.detail};
  if (s.usePressure) v.usePressure = true;
  if (simplifies(s.kind)){ v.simplify = s.simplify; v.simplifyOn = s.simplifyOn; }
  else { v.complexity = s.complexity; v.affectAnchors = s.affectAnchors; v.affectIn = s.affectIn; v.affectOut = s.affectOut; }
  if (s.kind === 'twirl') v.rate = s.rate;
  if (s.kind === 'wrinkle'){ v.horizontal = s.horizontal; v.vertical = s.vertical; }
  return v;
}
/* options_json：全部选项 */
function optionsJson(s){
  return Object.assign(toJson(s), {simplify:s.simplify, rate:s.rate, complexity:s.complexity, horizontal:s.horizontal, vertical:s.vertical,
    usePressure:s.usePressure, simplifyOn:s.simplifyOn, affectAnchors:s.affectAnchors, affectIn:s.affectIn, affectOut:s.affectOut});
}
const radii = s => [s.width / 2, s.height / 2];
const dabSpacing = s => { const [rx, ry] = radii(s); return Math.max(Math.min(rx, ry) * 0.2, 0.5); };
function detailSpacing(s){
  const [rx, ry] = radii(s), extra = noisy(s.kind) ? 1 + s.complexity * 0.5 : 1;
  return Math.max(Math.min(rx, ry) * 2 / (s.detail * 2 + 1) / extra, 0.5);
}
const simplifyTolerance = s => (simplifies(s.kind) && s.simplifyOn) ? s.simplify / 100 * detailSpacing(s) * 0.02 : 0;
const brushBounds = (s, c) => { const r = Math.max(s.width, s.height) / 2; return rect(c[0] - r, c[1] - r, c[0] + r, c[1] + r); };
/* falloff：椭圆（转 angle 度）里 (1 − r²)²，外面 0 */
function falloff(s, c, q){
  const [rx, ry] = radii(s), a = -s.angle * Math.PI / 180, sn = Math.sin(a), co = Math.cos(a), d = sub(q, c);
  const u = [d[0] * co - d[1] * sn, d[0] * sn + d[1] * co], r2 = (u[0] / rx) ** 2 + (u[1] / ry) ** 2;
  return r2 >= 1 ? 0 : (1 - r2) ** 2;
}

/* ── Dabber（liquify.rs:283-353）── 样本 [p, pressure]；笔印 {c, intensity} */
const MAX_DABS = 20000;
class Dabber {
  constructor(spacing, intensity, hold){ this.spacing = spacing; this.intensity = intensity; this.holds = hold; this.samples = []; this.carry = 0; this.dabs = []; }
  static of(s){ return new Dabber(dabSpacing(s), s.usePressure ? null : s.intensity, holds(s.kind)); }
  dab(c, pressure){ return {c, intensity:this.intensity === null ? clamp(pressure, 0, 1) : this.intensity}; }
  push([b, pb]){
    const prev = this.samples[this.samples.length - 1];
    this.samples.push([b, pb]);
    if (!prev){ this.dabs.push(this.dab(b, pb)); return; }
    const [a, pa] = prev;
    if (this.dabs.length > MAX_DABS) return;
    const len = dist(a, b);
    if (len < 1e-12){ if (this.holds){ this.dabs.push(this.dab(b, pb)); this.carry = 0; } return; }
    let s = this.spacing - this.carry;
    while (s <= len){ const t = s / len; this.dabs.push(this.dab(lerp(a, b, t), pa + (pb - pa) * t)); s += this.spacing; }
    this.carry = len - (s - this.spacing);
  }
  tail(){
    const last = this.samples[this.samples.length - 1], d = this.dabs[this.dabs.length - 1];
    if (!last || !d) return null;
    return dist(last[0], d.c) > this.spacing * 0.25 ? this.dab(last[0], last[1]) : null;
  }
}
/* dabs(points, spacing)：折线重取样成笔印中心（第一点必是一印） */
function dabs(points, spacing){
  const d = new Dabber(spacing, 1, false); points.forEach(p => d.push([p, 1]));
  const t = d.tail(); return d.dabs.concat(t ? [t] : []).map(x => x.c);
}

/* ── 噪声（splitmix64；u64 用 BigInt 照算）── */
const M64 = (1n << 64n) - 1n;
function hash(x){
  x = (x + 0x9e3779b97f4a7c15n) & M64;
  x = ((x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
  x = ((x ^ (x >> 27n)) * 0x94d049bb133111ebn) & M64;
  return x ^ (x >> 31n);
}
function noise(a, b, c){
  const h = hash(((a * 0x100000001b3n) & M64) ^ hash(((b * 31n) & M64) ^ hash(c)));
  return Number(h >> 11n) / 9007199254740992 * 2 - 1;
}
/* 他们的 salt 是物件 id（u64）；我们的 id 是字串 ⇒ FNV-1a 64 换成数 */
function saltOf(id){
  let h = 0xcbf29ce484222325n;
  for (const ch of String(id)){ h ^= BigInt(ch.codePointAt(0)); h = (h * 0x100000001b3n) & M64; }
  return h;
}

const MAX_ANCHORS = 20000;
/* liquify.rs:371-408 subdivide */
function subdivide(sp, prm, c, spacing){
  const bb = brushBounds(prm, c);
  let seg = 0;
  while (seg < segCount(sp)){
    if (sp.anchors.length >= MAX_ANCHORS) return;
    const cub = segment(sp, seg), sb = cubicBBox(cub);
    const touched = interArea(sb, bb) > 0 || ((rw(sb) === 0 || rh(sb) === 0) && interArea(inflate(sb, 1e-6), bb) > 0);
    let inside = false;
    if (touched) for (let i = 0; i <= 8; i++) if (falloff(prm, c, evalCubic(cub, i / 8)) > 0){ inside = true; break; }
    if (!touched || !inside){ seg++; continue; }
    const len = arclen(cub, 1e-3), k = Math.ceil(len / spacing);
    if (k <= 1){ seg++; continue; }
    const n = sp.anchors.length;
    if (segIsLine(sp, seg)){
      const i0 = seg % n, i1 = (seg + 1) % n, a = sp.anchors[i0].p, b = sp.anchors[i1].p;
      sp.anchors[i0].ho = lerp(a, b, 1 / 3); sp.anchors[i1].hi = lerp(a, b, 2 / 3);
    }
    let cur = seg;
    for (let j = 0; j < k - 1; j++) cur = insertAnchor(sp, cur, 1 / (k - j));
    seg = cur + 1;
  }
}
/* liquify.rs:410-449 displace：七种位移场（anchorNew＝null 是锚点本身／不是 Scallop、Crystallize 的把手） */
function displace(prm, c, prev, dab, key, q, anchorNew, anchorOld){
  const f = falloff(prm, c, q), i = prm.intensity, [rx, ry] = radii(prm), r = Math.max(rx, ry);
  const d = sub(q, c), len = Math.hypot(d[0], d[1]), dir = len > 1e-9 ? mul(d, 1 / len) : [0, 0];
  const rot = (v, a) => { const s = Math.sin(a), co = Math.cos(a); return [v[0] * co - v[1] * s, v[0] * s + v[1] * co]; };
  switch (prm.kind){
    case 'warp': return add(q, mul(sub(c, prev), i * f));
    case 'twirl': return add(c, rot(d, prm.rate * Math.PI / 180 * i * f * 0.25));
    case 'pucker': return sub(q, mul(d, i * f * 0.2));
    case 'bloat': return add(q, mul(dir, i * f * 0.1 * r));
    case 'scallop':
      if (!anchorNew) return sub(q, mul(d, i * f * 0.12));
      { // 把手往旁边甩（卷）并拉长：轮廓上一圈圈弧形细节
        const h = sub(q, anchorOld), phi = noise(dab, key, 7n) * Math.PI / 2 * i * f * (1 + prm.complexity * 0.2);
        return add(anchorNew, mul(rot(h, phi), 1 + 0.6 * i * f)); }
    case 'crystallize':
      if (!anchorNew) return add(q, mul(dir, i * f * 0.1 * r * (0.5 + 0.5 * Math.abs(noise(dab, key, 3n)))));
      return add(anchorNew, mul(sub(q, anchorOld), 1 - 0.6 * i * f));            // 把手往回收：尖刺
    case 'wrinkle': {
      const amp = i * f * 0.06 * r * (1 + prm.complexity * 0.1);
      return add(q, [noise(dab, key, 11n) * prm.horizontal * amp, noise(dab, key, 13n) * prm.vertical * amp]);
    }
  }
  return q;
}
/* liquify.rs:451-488 apply_dab */
function applyDab(sp, prm, c, prev, dab, salt){
  const bb = brushBounds(prm, c);
  let changed = false;
  sp.anchors.forEach((a, ai) => {
    if (!contains(bb, a.p) && !contains(bb, a.hi) && !contains(bb, a.ho)) return;
    const key = hash(salt ^ ((BigInt(ai) * 0x9e3779b9n) & M64));
    const old = {p:a.p, hi:a.hi, ho:a.ho, kind:a.kind};
    const np = prm.affectAnchors ? displace(prm, c, prev, dab, key, old.p, null, old.p) : old.p;
    const moved = sub(np, old.p);
    const handle = (h, affect, k) => {
      if (dist(h, old.p) < 1e-12) return np;
      if (!affect) return add(h, moved);
      if (prm.kind === 'scallop' || prm.kind === 'crystallize') return displace(prm, c, prev, dab, key ^ k, h, np, old.p);
      return displace(prm, c, prev, dab, key ^ k, h, null, old.p);
    };
    const hi = handle(old.hi, prm.affectIn, 1n), ho = handle(old.ho, prm.affectOut, 2n);
    if (!eq(np, old.p) || !eq(hi, old.hi) || !eq(ho, old.ho)){
      changed = true;
      sp.anchors[ai] = {p:np, hi, ho, kind:(old.kind === 'smooth' && prm.kind === 'crystallize') ? 'corner' : old.kind};
    }
  });
  return changed;
}
function distSeg(p, a, b){
  const ab = sub(b, a), l2 = dot(ab, ab);
  if (l2 < 1e-18) return dist(p, a);
  const t = clamp(dot(sub(p, a), ab) / l2, 0, 1);
  return dist(p, add(a, mul(ab, t)));
}
/* liquify.rs:501-531 simplify：控制点都在弦 tol 内、且方向往前的锚点移掉，邻点把手按弦长比例拉长 */
function simplify(sp, tol, region){
  if (tol <= 0) return;
  let i = 1;
  for (;;){
    const n = sp.anchors.length, min = sp.closed ? 4 : 3;
    if (n < min) return;
    const last = sp.closed ? n : n - 1;
    if (i >= last) return;
    const pa = sp.anchors[i - 1], k = sp.anchors[i], pb = sp.anchors[(i + 1) % n];
    const flat = contains(region, k.p) && [k.p, k.hi, k.ho, pa.ho, pb.hi].every(q => distSeg(q, pa.p, pb.p) <= tol) && dot(sub(k.p, pa.p), sub(pb.p, k.p)) > 0;
    if (flat){
      const lab = dist(pa.p, pb.p), lak = Math.max(dist(pa.p, k.p), 1e-9), lkb = Math.max(dist(k.p, pb.p), 1e-9);
      sp.anchors[i - 1].ho = add(pa.p, mul(sub(pa.ho, pa.p), lab / lak));
      sp.anchors[(i + 1) % n].hi = add(pb.p, mul(sub(pb.hi, pb.p), lab / lkb));
      sp.anchors.splice(i, 1);
    } else i++;
  }
}
function spBounds(sp){
  let r = null;
  sp.anchors.forEach(a => [a.p, a.hi, a.ho].forEach(p => { r = r ? unionPt(r, p) : rect(p[0], p[1], p[0], p[1]); }));
  return r;
}
const touches = (sp, bb) => { const b = spBounds(sp); return !!b && (interArea(b, bb) > 0 || rw(b) === 0 || rh(b) === 0); };
const reachBounds = path => path.map(spBounds).filter(Boolean).reduce((a, b) => a ? union(a, b) : b, null);
/* liquify.rs:557-569 dab_on */
function dabOn(path, di, d, prev, prm, salt){
  const p2 = Object.assign({}, prm, {intensity:d.intensity}), bb = brushBounds(p2, d.c), spacing = detailSpacing(p2);
  let changed = false;
  path.forEach((sp, si) => {
    if (!touches(sp, bb)) return;
    subdivide(sp, p2, d.c, spacing);
    changed = applyDab(sp, p2, d.c, prev, BigInt(di), hash(salt ^ (((BigInt(si) + 1n) * 0x123456789abcdef1n) & M64))) || changed;
  });
  return changed;
}
/* liquify.rs:571-625 PathStroke：分几次套跟一次套完结果一样 */
class PathStroke {
  constructor(path, salt){ this.path = path; this.salt = salt; this.applied = 0; this.region = null; }
  advance(D, prm){
    for (let di = this.applied; di < D.length; di++){
      const d = D[di], prev = di > 0 ? D[di - 1].c : d.c;
      if (dabOn(this.path, di, d, prev, prm, this.salt)){ const bb = brushBounds(prm, d.c); this.region = this.region ? union(this.region, bb) : bb; }
    }
    this.applied = Math.max(this.applied, D.length);
  }
  finish(D, tail, prm){
    let region = this.region, out = null;
    if (tail && this.path.some(sp => touches(sp, brushBounds(prm, tail.c)))){
      const p = clonePath(this.path);
      if (dabOn(p, D.length, tail, D.length ? D[D.length - 1].c : tail.c, prm, this.salt)){ const bb = brushBounds(prm, tail.c); region = region ? union(region, bb) : bb; }
      out = p;
    }
    if (!region) return null;
    const path = out || clonePath(this.path), tol = simplifyTolerance(prm);
    if (tol > 0) path.forEach(sp => simplify(sp, tol, region));
    return path;
  }
}
/* apply_stroke（测试与 agent 直接算一条路径用） */
function applyStroke(path, dabPts, prm, salt){
  const D = dabPts.map(c => ({c, intensity:prm.intensity})), ps = new PathStroke(path, salt);
  ps.advance(D, prm);
  return ps.finish(D, null, prm);
}

/* ── 我们的形状 ⇄ SubPath ── */
function toSp(v){
  return {closed:!!v.closed, anchors:(v.anchors || []).map(a => { const p = [a.x, a.y]; return {p, hi:a.in ? a.in.slice() : p.slice(), ho:a.out ? a.out.slice() : p.slice(), kind:VecSel.anchorKind(a)}; })};
}
const hOrNull = (p, h) => Math.hypot(h[0] - p[0], h[1] - p[1]) > 1e-9 ? [h[0], h[1]] : null;
function fromSp(sp){ return sp.anchors.map(a => ({x:a.p[0], y:a.p[1], in:hOrNull(a.p, a.hi), out:hOrNull(a.p, a.ho), kind:a.kind})); }

/* ── Targets（distortcmds.rs:399-474）── 一层里：能改的路径、留着不动的物件 */
function notLiquified(n){
  if (n.type === 'group' && n.graph) return 'graphs';
  if (n.type === 'group' && n.live === 'blend') return 'blends';
  if (n.type === 'group' && n.live === 'envelope') return 'envelopes';
  if (n.type === 'group' && n.live) return 'repeats';
  if (n.type === 'mesh') return 'meshes';
  if (n.type === 'group' || n.type === 'compound') return null;
  if (VecSel.asBezier(n)) return null;
  return n.type === 'image' ? 'images' : n.type === 'symbol' ? 'symbols' : n.type === 'text' ? 'type' : (n.type || 'objects');
}
function shapeBounds(n){
  const v = VecSel.asBezier(n); if (v) return reachBounds([toSp(v)]);
  if (window.AIObj && AIObj.shapeBounds){ try { const b = AIObj.shapeBounds(n, p => p, false); if (b) return rect(b.x0, b.y0, b.x1, b.y1); } catch (e){} }
  if (typeof n.x === 'number' && typeof n.w === 'number') return rect(n.x, n.y, n.x + n.w, n.y + n.h);
  return null;
}
function targetsOf(shapes, roots){
  const t = {paths:[], blocked:[], seen:new Set()};
  const block = (n, what) => { const b = shapeBounds(n); if (b && !t.seen.has(n.id)){ t.seen.add(n.id); t.blocked.push({id:n.id, b, what}); } };
  const visit = n => {
    if (!n || n.visible === false || n.locked) return;
    const what = notLiquified(n); if (what) return block(n, what);
    if (n.type === 'group' || n.type === 'compound'){ (n.children || []).forEach(visit); return; }
    const v = VecSel.asBezier(n); if (!v || !v.anchors || !v.anchors.length) return;
    const b = reachBounds([toSp(v)]);
    if (b && !t.seen.has(n.id)){ t.seen.add(n.id); t.paths.push({id:n.id, b, sp:toSp(v)}); }
  };
  if (!roots) shapes.forEach(visit);
  else roots.forEach(id => visit(shapes.find(s => s.id === id)));
  return t;
}
const reaches = (bb, b) => interArea(inflate(b, 1e-6), bb) > 0;

/* ── LiquifyStroke（distortcmds.rs:481-572）：一层一份 ── 点都是这一层的图层坐标 */
class LiquifyStroke {
  constructor(shapes, prm, roots){
    this.prm = prm; this.dabs = Dabber.of(prm); this.targets = targetsOf(shapes, roots);
    this.paths = []; this.skipped = [];
    this.reached = [this.targets.paths.map(() => false), this.targets.blocked.map(() => false)];
  }
  reach(bb){
    this.targets.paths.forEach((x, i) => { if (!this.reached[0][i] && reaches(bb, x.b)){ this.reached[0][i] = true; this.paths.push([i, new PathStroke([cloneSp(x.sp)], saltOf(x.id))]); } });
    this.targets.blocked.forEach((x, i) => { if (!this.reached[1][i] && reaches(bb, x.b)){ this.reached[1][i] = true; this.skipped.push(i); } });
  }
  extend(samples){
    const from = this.dabs.dabs.length;
    samples.forEach(s => this.dabs.push(s));
    for (let i = from; i < this.dabs.dabs.length; i++) this.reach(brushBounds(this.prm, this.dabs.dabs[i].c));
    const t = this.dabs.tail(); if (t) this.reach(brushBounds(this.prm, t.c));
    this.paths.forEach(([, ps]) => ps.advance(this.dabs.dabs, this.prm));
  }
  results(){
    const tail = this.dabs.tail(), out = [];
    this.paths.forEach(([i, ps]) => { const p = ps.finish(this.dabs.dabs, tail, this.prm); if (p) out.push([i, this.targets.paths[i].id, p]); });
    out.sort((a, b) => a[0] - b[0]);
    return out.map(([, id, p]) => ({id, anchors:fromSp(p[0])}));
  }
  skippedList(){ return this.skipped.map(i => this.targets.blocked[i]); }
}

/* 一整次液化（跨层）：哪些层、每层一份 LiquifyStroke；样本是文件坐标 */
function findIn(shapes, id){
  for (const s of shapes){ if (s.id === id) return s; if (s.children){ const c = findIn(s.children, id); if (c) return c; } }
  return null;
}
function layersFor(p){
  const vec = L => L && L.kind === 'vector';
  if (p.layerId){ const L = Doc.byId(p.layerId); return vec(L) ? [L] : []; }
  if (p.roots) return [VecSel.layer() || Doc.active()].filter(vec);
  return Doc.layers.filter(L => vec(L) && L.visible !== false && !Locks.blocks(L, 'pixels')).reverse();   // 隐藏／锁住的层：他们 visit 里 !visible || locked 就不动
}
class LiquifyRun {
  constructor(prm, p){
    this.prm = prm; this.done = 0;
    this.per = layersFor(p).map(L => ({L, off:[L.x || 0, L.y || 0], st:new LiquifyStroke(L.data.shapes, prm, p.roots || null)}));
  }
  extend(samples){
    const add = samples.slice(this.done); this.done = samples.length;
    this.per.forEach(x => x.st.extend(add.map(([q, pr]) => [[q[0] - x.off[0], q[1] - x.off[1]], pr])));
  }
  /* 把结果写进各层（活形状先转 bezier）→ {ids, skipped, warning} */
  write(){
    const ids = [], skipped = [], kinds = [];
    this.per.forEach(x => {
      x.st.results().forEach(r => {
        const s = findIn(x.L.data.shapes, r.id); if (!s) return;
        if (!VecSel.ensureBezier(x.L, s)) return;
        s.anchors = r.anchors; Layer.invalidate(x.L); ids.push(r.id);
      });
      x.st.skippedList().forEach(b => { skipped.push(b.id); if (!kinds.includes(b.what)) kinds.push(b.what); });
    });
    const out = {ids, skipped};
    if (skipped.length){ const n = skipped.length;
      out.warning = `${LABEL[this.prm.kind]} left ${n} object${n === 1 ? '' : 's'} under the brush as ${n === 1 ? 'it was' : 'they were'} (${kinds.join(', ')}): it reshapes paths only`; }
    return out;
  }
}
/* "points":[[x,y,pressure?]…] → 样本（pressure 缺省 1） */
function samplesOf(points){
  if (!Array.isArray(points) || !points.length) return null;
  const out = [];
  for (const q of points){
    if (!Array.isArray(q) || typeof q[0] !== 'number' || typeof q[1] !== 'number') return null;
    const pr = q.length > 2 ? q[2] : 1;
    if (typeof pr !== 'number') return null;
    out.push([[q[0], q[1]], pr]);
  }
  return out;
}

/* ── 选项（settings.rs：全域笔刷尺寸七颗共用、其余各颗自己的；存在这台机器）── */
const SHARED_KEYS = ['width', 'height', 'angle', 'intensity', 'usePressure', 'showBrush'];
const STORE = 'dlLiquify.v1';
const opts = {};          // kind -> params（kind 自己的那份；全域键另存 shared）
let shared = {width:100, height:100, angle:0, intensity:0.5, usePressure:false, showBrush:true};
try { const j = JSON.parse(localStorage.getItem(STORE) || 'null'); if (j){ if (j.shared) Object.assign(shared, j.shared); Object.keys(j.tools || {}).forEach(k => { opts[k] = j.tools[k]; }); } } catch (e){}
function save(){ try { localStorage.setItem(STORE, JSON.stringify({shared, tools:opts})); } catch (e){} }
function paramsOf(kind){
  const own = Object.assign(optionsJson(defaults(kind)), opts[kind] || {});
  return fromJson(Object.assign({}, own, shared, {tool:kind}));
}
/* set_option：tool 键不收（别的 kind 是别的工具）；diameter＝宽高 */
function setOptions(kind, p){
  const cur = Object.assign(optionsJson(paramsOf(kind)), {showBrush:shared.showBrush});
  Object.keys(p || {}).forEach(k => {
    if (k === 'tool' || k === 'layerId') return;
    if (k === 'showBrush'){ if (typeof p[k] === 'boolean') cur.showBrush = p[k]; return; }
    cur[k] = p[k];
    if (k === 'diameter'){ cur.width = p[k]; cur.height = p[k]; }
  });
  const prm = fromJson(Object.assign({}, cur, {tool:kind}));
  if (!prm) return;
  SHARED_KEYS.forEach(k => { shared[k] = k === 'showBrush' ? cur.showBrush : prm[k]; });
  const o = optionsJson(prm); SHARED_KEYS.forEach(k => delete o[k]); delete o.tool;
  opts[kind] = o; save();
}
const allOptions = kind => Object.assign(optionsJson(paramsOf(kind)), {showBrush:shared.showBrush});

/* ── 三语 ── */
const STR = {
  'zh-Hant':{'opt.lqWidth':'寬度', 'opt.lqHeight':'高度', 'opt.lqAngle':'角度', 'opt.lqIntensity':'強度 %', 'opt.lqPressure':'使用壓力筆', 'opt.lqDetail':'細節',
    'opt.lqSimplify':'簡化', 'opt.lqRate':'扭轉速率 °', 'opt.lqComplexity':'複雜度', 'opt.lqHorizontal':'水平 %', 'opt.lqVertical':'垂直 %',
    'opt.lqAnchors':'錨點', 'opt.lqIn':'入點方向線', 'opt.lqOut':'出點方向線', 'opt.lqShowBrush':'顯示筆刷大小', 'ui.lqHint':'拖曳＝液化；Alt＋拖曳＝改筆刷大小（Shift 等比）',
    'tool.warp':'彎曲工具', 'tool.twirl':'扭轉工具', 'tool.pucker':'縮攏工具', 'tool.bloat':'膨脹工具', 'tool.scallop':'扇形化工具', 'tool.crystallize':'結晶化工具', 'tool.wrinkle':'皺摺工具'},
  'zh-Hans':{'opt.lqWidth':'宽度', 'opt.lqHeight':'高度', 'opt.lqAngle':'角度', 'opt.lqIntensity':'强度 %', 'opt.lqPressure':'使用压感笔', 'opt.lqDetail':'细节',
    'opt.lqSimplify':'简化', 'opt.lqRate':'旋转扭曲速率 °', 'opt.lqComplexity':'复杂性', 'opt.lqHorizontal':'水平 %', 'opt.lqVertical':'垂直 %',
    'opt.lqAnchors':'锚点', 'opt.lqIn':'内切线手柄', 'opt.lqOut':'外切线手柄', 'opt.lqShowBrush':'显示画笔大小', 'ui.lqHint':'拖动＝液化；Alt＋拖动＝改画笔大小（Shift 等比）',
    'tool.warp':'变形工具', 'tool.twirl':'旋转扭曲工具', 'tool.pucker':'缩拢工具', 'tool.bloat':'膨胀工具', 'tool.scallop':'扇贝工具', 'tool.crystallize':'晶格化工具', 'tool.wrinkle':'皱褶工具'},
  'en':{'opt.lqWidth':'Width', 'opt.lqHeight':'Height', 'opt.lqAngle':'Angle', 'opt.lqIntensity':'Intensity %', 'opt.lqPressure':'Use Pressure Pen', 'opt.lqDetail':'Detail',
    'opt.lqSimplify':'Simplify', 'opt.lqRate':'Twirl Rate °', 'opt.lqComplexity':'Complexity', 'opt.lqHorizontal':'Horizontal %', 'opt.lqVertical':'Vertical %',
    'opt.lqAnchors':'Anchor Points', 'opt.lqIn':'In Tangent Handles', 'opt.lqOut':'Out Tangent Handles', 'opt.lqShowBrush':'Show Brush Size', 'ui.lqHint':'Drag = liquify; Alt-drag = brush size (Shift: proportional)',
    'tool.warp':'Warp Tool', 'tool.twirl':'Twirl Tool', 'tool.pucker':'Pucker Tool', 'tool.bloat':'Bloat Tool', 'tool.scallop':'Scallop Tool', 'tool.crystallize':'Crystallize Tool', 'tool.wrinkle':'Wrinkle Tool'}
};

/* ── 命令（每颗一组：<id>.apply／<id>.options）── */
function regCommands(kind){
  CMD.reg(kind + '.apply', {i18n:'', undoable:true,
    params:'{points:[[x,y,pressure?]…]（笔划，文件坐标；压力 0..1 缺省 1）, diameter?|width?, height?（pt，缺省 100）, angle?（°）, intensity?（0..1 或 %，缺省 0.5）, usePressure?（每点的压力就是那里的强度）, ' +
      'detail?（1..10，缺省 2）' + (simplifies(kind) ? ', simplify?（0..100，缺省 50）, simplifyOn?（缺省 true）' : ', complexity?（0..15，缺省 1）, affectAnchors?, affectIn?, affectOut?（缺省 true）') +
      (kind === 'twirl' ? ', rate?（°，−180..180，缺省 40）' : '') + (kind === 'wrinkle' ? ', horizontal?（缺省 0）, vertical?（缺省 1；0..1 或 %）' : '') +
      ', ids?（形状 id；缺省＝矢量节点选取，没选＝笔刷碰到的每条可见路径）, layerId?} ' + LABEL[kind] + ' 液化（照 vectorcraft object.liquify）：笔划重取样成笔印、碰到的线段细分、锚点与把手照位移场移；' +
      '活形状被改到就转成钢笔路径；文字／图像／网格／封套／混合／图表留着不动（回 skipped＋warning）→ {ok, ids（改到的）, skipped, warning?}'}, p => {
    const C = kind + '.apply';
    const prm = fromJson(Object.assign({}, p, {tool:kind}));
    const S = samplesOf(p.points);
    if (!S) return {ok:false, error:C + ': points must be a non-empty [[x,y,pressure?]…] list'};
    if (S.some(([q, f]) => !isFinite(q[0]) || !isFinite(q[1]) || !isFinite(f))) return {ok:false, error:C + ': points must be finite'};
    let roots = Array.isArray(p.ids) ? p.ids.slice() : (p.id ? [p.id] : (VecSel.isEmpty() ? null : VecSel.shapes.slice()));
    if (p.layerId){ const L = Doc.byId(p.layerId); if (!L || L.kind !== 'vector') return {ok:false, error:C + ': layerId is not a vector layer'};
      const k = Locks.blocks(L, 'pixels'); if (k){ Locks.notify(Locks.message(L, k)); return Locks.fail(L, k, C); } }
    const run = new LiquifyRun(prm, {layerId:p.layerId, roots});
    run.extend(S);
    return Object.assign({ok:true}, run.write());
  });
  CMD.reg(kind + '.options', {i18n:'',
    params:'{width?, height?, diameter?, angle?, intensity?, usePressure?, showBrush?（这六个七颗液化工具共用）, detail?, simplify?, simplifyOn?, rate?, complexity?, horizontal?, vertical?, affectAnchors?, affectIn?, affectOut?} ' +
      LABEL[kind] + ' 工具选项（不给＝只读）→ {ok, options}'}, p => {
    if (p && Object.keys(p).length) setOptions(kind, p);
    if (ToolState.cur === kind && window.UI && UI.buildOptions) UI.buildOptions(kind);
    return {ok:true, options:allOptions(kind)};
  });
}

/* ── 工具（liquify.rs:638-815 LiquifyTool）── */
const HOLD_EVERY = 0.1, MAX_HOLDS_PER_TICK = 600;
function makeTool(kind, extra){
  regCommands(kind);
  const T = {
    kind, points:[], active:false, sizing:null, hover:null, held:0, base:null, run:null, changed:false, timer:null, lastT:0,
    prm(){ return paramsOf(kind); },
    pressure(e){ return (e && e.pointerType === 'pen' && typeof e.pressure === 'number') ? clamp(e.pressure, 0, 1) : 1; },
    command(){
      const prm = this.prm(), v = toJson(prm);
      v.points = this.points.map(([p, f]) => prm.usePressure ? [p[0], p[1], f] : [p[0], p[1]]);
      if (!VecSel.isEmpty()){ v.ids = VecSel.shapes.slice(); v.layerId = VecSel.layerId; }
      return v;
    },
    /* Begin：记下各矢量层的形状（预览每次都从这里重来）＋开一份增量笔划 */
    begin(){
      this.base = Doc.layers.filter(L => L.kind === 'vector').map(L => ({L, json:JSON.stringify(L.data.shapes)}));
      const v = this.command();
      this.run = new LiquifyRun(this.prm(), {layerId:v.layerId, roots:v.ids || null});
      this.changed = false;
    },
    resetToBase(){ (this.base || []).forEach(b => { b.L.data.shapes = JSON.parse(b.json); Layer.invalidate(b.L); }); },
    preview(){
      if (!this.run) return;
      this.resetToBase();
      this.run.extend(this.points);
      const r = this.run.write();
      if (r.ids.length) this.changed = true;
      this.lastResult = r;
      UI.draw();
    },
    /* Commit：退回 Begin 时的样子，再走一次命令（同样的参数＝同样的结果；一步历史） */
    commit(){
      this.stopTimer();
      const had = !!this.base, params = had ? this.command() : null, changed = this.changed;
      this.resetToBase(); this.base = null; this.run = null;
      this.active = false; this.points = [];
      if (had && changed){ try { this.lastResult = CMD.run(kind + '.apply', params); } catch (err){ console.error(err); } }
      UI.draw();
    },
    /* Alt 拖：笔刷边缘跟着游标（宽高从按下时的大小加 2×位移）；Shift 等比 */
    resize(s, p, prop){
      let w = s.width + 2 * (p[0] - s.start[0]), h = s.height + 2 * (p[1] - s.start[1]);
      if (prop){ if (Math.abs(p[0] - s.start[0]) >= Math.abs(p[1] - s.start[1])) h = s.height * w / s.width; else w = s.width * h / s.height; }
      setOptions(kind, {width:clamp(w, 1, 10000), height:clamp(h, 1, 10000)});
    },
    startTimer(){
      if (!holds(kind)) return;
      this.stopTimer(); this.lastT = performance.now();
      this.timer = setInterval(() => this.tick((performance.now() - this.lastT) / 1000), 25);
    },
    stopTimer(){ if (this.timer){ clearInterval(this.timer); this.timer = null; } },
    /* tick：按住不动每 HOLD_EVERY 秒最后一个样本再来一次（多一印） */
    tick(dt){
      this.lastT = performance.now();
      if (!this.active || !holds(kind) || !isFinite(dt) || dt <= 0) return;
      this.held += dt;
      let n = 0;
      while (this.held >= HOLD_EVERY - 1e-9 && n < MAX_HOLDS_PER_TICK){ this.held -= HOLD_EVERY; n++; }
      this.held = clamp(this.held, 0, HOLD_EVERY);
      const last = this.points[this.points.length - 1];
      if (!last || !n) return;
      for (let i = 0; i < n; i++) this.points.push([last[0].slice(), last[1]]);
      this.preview();
    },
    down(e, pt){
      this.hover = pt.slice();
      const sample = [pt.slice(), this.pressure(e)];
      if (e.altKey){ const prm = this.prm(); this.sizing = {start:pt.slice(), width:prm.width, height:prm.height}; UI.draw(); return; }
      if (!VecSel.isEmpty() && Locks.deny(VecSel.layer(), 'pixels')) return;          // 选取那层锁住：提示一句、这下不动手
      this.points = [sample]; this.active = true; this.held = 0;
      this.begin(); this.preview(); this.startTimer();
    },
    move(e, pt, P){
      this.hover = pt.slice();
      if (this.sizing && P && P.down){ this.resize(this.sizing, pt, !!e.shiftKey); this.hover = this.sizing.start.slice(); UI.draw(); return; }
      const last = this.points[this.points.length - 1];
      if (!this.active || (last && dist(last[0], pt) < VecSel.tol(2))){ if (!this.active) UI.draw(); return; }
      this.points.push([pt.slice(), this.pressure(e)]); this.held = 0;
      this.preview();
    },
    up(){
      if (this.sizing){ this.sizing = null; if (window.UI && UI.buildOptions) UI.buildOptions(kind); UI.draw(); return; }
      if (!this.active) return;
      this.commit();
    },
    deactivate(){ this.hover = null; this.sizing = null; if (this.active) this.commit(); },
    overlay(ctx, s){
      const c = this.hover; if (!c || !(shared.showBrush || this.sizing)) return;
      const prm = this.prm(), dpr = s / UI.zoom;
      ctx.save(); ctx.setLineDash([]); ctx.strokeStyle = '#808080'; ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.ellipse(c[0] * s, c[1] * s, Math.max(0.01, prm.width / 2) * s, Math.max(0.01, prm.height / 2) * s, prm.angle * Math.PI / 180, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  };
  /* 选项栏（Warp Tool Options 那张对话框的栏位） */
  const buildOptions = (box, addEl, mk) => {
    const o = allOptions(kind);
    const num = (key, k, attrs, scale) => {
      const n = mk('number', Object.assign({value:+(o[k] * (scale || 1)).toFixed(2), step:'any'}, attrs)); n.style.width = '60px'; n.dataset.lq = k;
      n.onchange = () => { const v = parseFloat(n.value); if (isFinite(v)) CMD.run(kind + '.options', {[k]:v / (scale || 1)}); };
      addEl(key, n);
    };
    const chk = (key, k) => { const c = mk('checkbox', {checked:!!o[k]}); c.checked = !!o[k]; c.dataset.lq = k; c.onchange = () => CMD.run(kind + '.options', {[k]:c.checked}); addEl(key, c); };
    num('lqWidth', 'width', {min:1, max:10000}); num('lqHeight', 'height', {min:1, max:10000}); num('lqAngle', 'angle', {}); num('lqIntensity', 'intensity', {min:1, max:100}, 100);
    chk('lqPressure', 'usePressure');
    num('lqDetail', 'detail', {min:1, max:10});
    if (simplifies(kind)){ chk('lqSimplify', 'simplifyOn'); num('lqSimplify', 'simplify', {min:0.2, max:100}); }
    if (kind === 'twirl') num('lqRate', 'rate', {min:-180, max:180});
    if (noisy(kind)) num('lqComplexity', 'complexity', {min:0, max:15});
    if (kind === 'wrinkle'){ num('lqHorizontal', 'horizontal', {min:0, max:100}, 100); num('lqVertical', 'vertical', {min:0, max:100}, 100); }
    if (noisy(kind)){ chk('lqAnchors', 'affectAnchors'); chk('lqIn', 'affectIn'); chk('lqOut', 'affectOut'); }
    chk('lqShowBrush', 'showBrush');
  };
  const icons = {warp:'≋', twirl:'@', pucker:'⊳', bloat:'⊲', scallop:'❀', crystallize:'✺', wrinkle:'≈'};
  Tools.reg(Object.assign({
    id:kind, icon:icons[kind], group:'vector', order:140 + KINDS.indexOf(kind), for:'vector', opts:[], cursor:'crosshair', hint:'ui.lqHint', strings:STR,
    onDown(e, pt, P){ T.down(e, pt, P); },
    onMove(e, pt, P){ T.move(e, pt, P); },
    onUp(e, pt, P){ T.up(e, pt, P); },
    onDeactivate(){ T.deactivate(); },
    buildOptions,
    drawOverlay(ctx, s){ VecSel.drawOverlay(ctx, s); T.overlay(ctx, s); }
  }, extra || {}));
  Liquify.tools[kind] = T;
  return T;
}

const Liquify = window.Liquify = {
  KINDS, LABEL, holds, simplifies, defaults, fromJson, toJson, optionsJson, dabSpacing, detailSpacing, simplifyTolerance, brushBounds, falloff,
  Dabber, dabs, hash, noise, saltOf, subdivide, displace, applyDab, simplify, PathStroke, applyStroke, toSp, fromSp, targetsOf, LiquifyRun,
  paramsOf, setOptions, allOptions, makeTool, tools:{}, HOLD_EVERY,
  get shared(){ return Object.assign({}, shared); }
};

makeTool('warp');
})();
