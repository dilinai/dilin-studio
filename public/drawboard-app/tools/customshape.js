/* 自定形状工具（PS U 那格最后一项 ps.custom-shape）——照 PhotoCraft 原码逐段翻：
   photocraft/crates/
   - ui-egui/src/vector_ui.rs:24-26 is_shape_tool、:45-78 shape_geometry（⇧ 等比＝取较长边各保留方向、⌥ 从中心、四舍五入、<1px 不画；
       自定形状给的是一个 rect）、:81-98 finish_shape（填色＝选项「填色」勾着用前景色、描边＝描边宽>0 用背景色）、
       :102-116 draw_shape_preview（自定形状只画外框轮廓：accent 线压暗边、不填不描）、:403-438 options_bar（模式只有「形状」、填色勾选＋前景色块、描边宽 0..288 px、形状挑选器）
   - ui-egui/src/preset_panels.rs:38-48 PresetUi.custom_shape（缺省「Heart」）、:738-790 shape_picker（按组列 32×32 缩图、点一下换形状）、
       :793-799 finish_custom_shape（shape.presets.place；找不到形状时状态列提示）、:705-723 形状面板选一个＝换成这颗工具
   - engine/src/presets/shapes.rs 全档：parse（小路径语言 M L C Q Z O !）、circle（κ=0.5523 四段）、star／sun／flower／shout 产生器、
       builtin 五组 34 个形状、all_groups（内建＋「Custom Shapes」组＝编辑 ▸ 定义自定形状存的）、fit（控制点外框映到 rect，keep＝保比例置中）、
       place（rect 负宽高翻正、<1 报错、缺省＝画布正中短边一半；名字＝形状名；fill／stroke／addTo 透传 shape.create）、list、new、edit、reset
   - engine/src/vector_cmds.rs:490-535 shape_create（新形状层插在当前层上面、成为当前层；addTo＝加进既有形状层）
   - engine/src/presets/tests.rs:262-288（Heart 进 [10,10,40,20] 保比例＝高 20、宽 20×100/92 置中；Arrow Right 负 rect 不保比例＝控制框正好 [10,20,50,40]）
   我们这边的对应：
   - 形状层＝我们的矢量层（每画一个新建一层，名字＝形状名，跟 PS 一样）；一个子路径＝一个 bezier 形状，多个子路径＝一个复合路径
     （type:'compound'，menus/impl/ai-object.js 的 ObjRender 画）。PathOp：combine 各块转成同向（非零绕数＝联集），subtract 反向（＝挖洞）；
     减去的圆伸出主体外（只有「Crescent Moon」）时非零绕数会把伸出去那块也填上 ⇒ 圆减圆直接算成两段弧（circleMinusCircle），结果跟原码的路径运算一样。
   - 「Custom Shapes」组＝ps-edit.js 的自定形状库（PsEdit.customShapes，编辑 ▸ 定义自定形状存的），读它、不改它。
   - 前景色＝我们的填色（UI.fill）、背景色＝描边色块（#strokeColor）。
   ── 原码没有、我们加的 ──
   - 选项栏「描边宽」我们自己存（不跟右面板的描边宽连动，原码也是工具选项）；拖曳中按 Esc 取消。
   - 预览除了外框，再画一条跟落定后一样的形状虚线轮廓（原码只画外框）。 */

/* ───────── shapes.rs:37-51 circle：四段三次贝兹（κ = 0.5523），上→右→下→左 ───────── */
const CS_KAPPA = 0.55228475;
function csCircle(cx, cy, r){
  const k = r * CS_KAPPA;
  const kn = (x, y, ix, iy, ox, oy) => ({x, y, in:[ix, iy], out:[ox, oy]});
  return {closed:true, op:'combine', circle:[cx, cy, r], anchors:[
    kn(cx, cy - r, cx - k, cy - r, cx + k, cy - r),
    kn(cx + r, cy, cx + r, cy - k, cx + r, cy + k),
    kn(cx, cy + r, cx + k, cy + r, cx - k, cy + r),
    kn(cx - r, cy, cx - r, cy + k, cx - r, cy - k)]};
}

/* ───────── shapes.rs:53-140 parse：M x y／L x y…／C x1 y1 x2 y2 x y…／Q x1 y1 x y…／Z／O cx cy r／!（下一个 M 或 O 是「减去」） ─────────
   knot 存成 {x, y, in:[x,y], out:[x,y]}（把手等于锚点也照存，最后 csClean 才换成我们的 null） */
const csIsNum = t => typeof t === 'string' && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t);
function csParse(src){
  const toks = String(src).replace(/,/g, ' ').replace(/!/g, ' ! ').split(/\s+/).filter(Boolean);
  let i = 0;
  const num = () => {
    if (i >= toks.length) throw new Error('unexpected end');
    if (!csIsNum(toks[i])) throw new Error('expected a number at `' + toks[i] + '`');
    return +toks[i++];
  };
  const subs = []; let cur = null, op = 'combine';
  const corner = (x, y) => ({x, y, in:[x, y], out:[x, y]});
  const finish = closed => {
    if (!cur) return;
    const s = cur; cur = null; s.closed = closed;
    if (closed && s.anchors.length > 1){
      const f = s.anchors[0], l = s.anchors[s.anchors.length - 1];
      if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9){ s.anchors.pop(); f.in = l.in; }   // 回到起点的那一点并进起点（它的进把手给起点）
    }
    if (s.anchors.length) subs.push(s);
  };
  while (i < toks.length){
    const t = toks[i++];
    if (t === '!') op = 'subtract';
    else if (t === 'M'){
      finish(true);
      const x = num(), y = num();
      cur = {closed:true, op, anchors:[corner(x, y)]}; op = 'combine';
    } else if (t === 'L'){
      if (!cur) throw new Error('L before M');
      while (csIsNum(toks[i])){ const x = num(), y = num(); cur.anchors.push(corner(x, y)); }
    } else if (t === 'C' || t === 'Q'){
      if (!cur) throw new Error('curve before M');
      while (csIsNum(toks[i])){
        const last = cur.anchors[cur.anchors.length - 1];
        let c1, c2, p;
        if (t === 'C'){ c1 = [num(), num()]; c2 = [num(), num()]; p = [num(), num()]; }
        else {                                                       // 二次转三次：控制点各往两端 2/3
          const q = [num(), num()]; p = [num(), num()];
          c1 = [last.x + (q[0] - last.x) * 2 / 3, last.y + (q[1] - last.y) * 2 / 3];
          c2 = [p[0] + (q[0] - p[0]) * 2 / 3, p[1] + (q[1] - p[1]) * 2 / 3];
        }
        last.out = c1;
        cur.anchors.push({x:p[0], y:p[1], in:c2, out:[p[0], p[1]]});
      }
    } else if (t === 'Z') finish(true);
    else if (t === 'O'){
      finish(true);
      const c = csCircle(num(), num(), num()); c.op = op; op = 'combine';
      subs.push(c);
    } else throw new Error('unknown command `' + t + '`');
  }
  finish(true);
  if (!subs.length) throw new Error('empty path');
  return subs;
}

/* shapes.rs:142-151 star：n 角（ratio＝内径／外径）在 100 方格里 */
function csStar(n, ratio, rot){
  let s = '';
  for (let k = 0; k < 2 * n; k++){
    const r = k % 2 === 0 ? 50 : 50 * ratio, a = rot + Math.PI * k / n - Math.PI / 2;
    s += `${k === 0 ? 'M' : 'L'} ${(50 + r * Math.cos(a)).toFixed(3)} ${(50 + r * Math.sin(a)).toFixed(3)} `;
  }
  return s + 'Z';
}
/* :153-162 sun */
function csSun(){
  let s = 'O 50 50 22 ';
  for (let k = 0; k < 12; k++){
    const a = Math.PI * 2 * k / 12, p = (r, da) => [50 + r * Math.cos(a + da), 50 + r * Math.sin(a + da)];
    const b1 = p(28, -0.12), b2 = p(28, 0.12), tip = p(50, 0), f = v => v.toFixed(3);
    s += `M ${f(b1[0])} ${f(b1[1])} L ${f(tip[0])} ${f(tip[1])} L ${f(b2[0])} ${f(b2[1])} Z `;
  }
  return s;
}
/* :164-171 flower */
function csFlower(){
  let s = '';
  for (let k = 0; k < 6; k++){
    const a = Math.PI * 2 * k / 6 - Math.PI / 2;
    s += `O ${(50 + 30 * Math.cos(a)).toFixed(3)} ${(50 + 30 * Math.sin(a)).toFixed(3)} 18 `;
  }
  return s + 'O 50 50 20 ! O 50 50 9';
}
/* :173-183 shout：锯齿爆炸拉成对话框、带尾巴 */
function csShout(){
  let s = ''; const n = 14;
  for (let k = 0; k < 2 * n; k++){
    const r = k % 2 === 0 ? 1 : 0.78, a = Math.PI * k / n;
    s += `${k === 0 ? 'M' : 'L'} ${(50 + 50 * r * Math.cos(a)).toFixed(3)} ${(40 + 40 * r * Math.sin(a)).toFixed(3)} `;
  }
  return s + 'Z M 30 70 L 14 100 L 46 74 Z';
}

/* ───────── 子路径的几何小工具（预设的 100 方格坐标；把手是绝对坐标） ───────── */
function csFlatten(sp, n){
  const A = sp.anchors, out = [];
  if (!A.length) return out;
  const seg = (p, q) => {
    const c1 = p.out || [p.x, p.y], c2 = q.in || [q.x, q.y];
    for (let k = 1; k <= n; k++){
      const t = k / n, u = 1 - t;
      out.push([u*u*u*p.x + 3*u*u*t*c1[0] + 3*u*t*t*c2[0] + t*t*t*q.x, u*u*u*p.y + 3*u*u*t*c1[1] + 3*u*t*t*c2[1] + t*t*t*q.y]);
    }
  };
  out.push([A[0].x, A[0].y]);
  for (let i = 1; i < A.length; i++) seg(A[i-1], A[i]);
  if (sp.closed && A.length > 1) seg(A[A.length-1], A[0]);
  return out;
}
/* 有号面积（y 朝下的画面里正值＝顺时针） */
function csArea(sp){
  const P = csFlatten(sp, 8); let s = 0;
  for (let i = 0; i < P.length; i++){ const p = P[i], q = P[(i + 1) % P.length]; s += p[0] * q[1] - q[0] * p[1]; }
  return s / 2;
}
const csReverse = sp => Object.assign({}, sp, {anchors:sp.anchors.slice().reverse().map(a => ({x:a.x, y:a.y, in:a.out, out:a.in}))});
function csInside(poly, p){
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
    const a = poly[i], b = poly[j];
    if (((a[1] > p[1]) !== (b[1] > p[1])) && (p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1] + 1e-300) + a[0])) c = !c;
  }
  return c;
}
/* 一段圆弧（圆心 c、半径 r，从角 a0 扫 sweep 弧度）→ 锚点（每段 ≤90°，把手长 4/3·tan(δ/4)·r） */
function csArc(c, r, a0, sweep){
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9)), d = sweep / n, L = 4 / 3 * Math.tan(d / 4) * r;
  const pts = [];
  for (let j = 0; j <= n; j++){
    const a = a0 + d * j, p = [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)], t = [-Math.sin(a), Math.cos(a)];
    pts.push({x:p[0], y:p[1], in:j > 0 ? [p[0] - L * t[0], p[1] - L * t[1]] : null, out:j < n ? [p[0] + L * t[0], p[1] + L * t[1]] : null});
  }
  return pts;
}
/* 圆 C1 减圆 C2（两圆相交时）＝ C1 在 C2 外那段弧 ＋ C2 在 C1 里那段弧（反着走）→ 一条闭合子路径；不相交回 null */
function circleMinusCircle(C1, C2){
  const [x1, y1, r1] = C1, [x2, y2, r2] = C2, dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
  if (!(d > 1e-9) || d >= r1 + r2 || d <= Math.abs(r1 - r2)) return null;
  const a = (r1*r1 - r2*r2 + d*d) / (2 * d), h = Math.sqrt(Math.max(r1*r1 - a*a, 0));
  const mx = x1 + a * dx / d, my = y1 + a * dy / d;
  const P = [mx + h * dy / d, my - h * dx / d], Q = [mx - h * dy / d, my + h * dx / d];
  const ang = (c, p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  const norm = v => { while (v <= -Math.PI) v += 2*Math.PI; while (v > Math.PI) v -= 2*Math.PI; return v; };
  // C1：从 P 到 Q，选中点不在 C2 里的那一边
  const p1 = ang([x1, y1], P), q1 = ang([x1, y1], Q);
  let s1 = norm(q1 - p1);
  const mid1 = p1 + s1 / 2;
  if (Math.hypot(x1 + r1 * Math.cos(mid1) - x2, y1 + r1 * Math.sin(mid1) - y2) < r2) s1 = s1 > 0 ? s1 - 2*Math.PI : s1 + 2*Math.PI;
  // C2：从 Q 回到 P，选中点在 C1 里的那一边
  const q2 = ang([x2, y2], Q), p2 = ang([x2, y2], P);
  let s2 = norm(p2 - q2);
  const mid2 = q2 + s2 / 2;
  if (Math.hypot(x2 + r2 * Math.cos(mid2) - x1, y2 + r2 * Math.sin(mid2) - y1) > r1) s2 = s2 > 0 ? s2 - 2*Math.PI : s2 + 2*Math.PI;
  const A1 = csArc([x1, y1], r1, p1, s1), A2 = csArc([x2, y2], r2, q2, s2);
  const anchors = A1.slice(0, -1);
  anchors.push({x:Q[0], y:Q[1], in:A1[A1.length-1].in, out:A2[0].out});
  for (let j = 1; j < A2.length - 1; j++) anchors.push(A2[j]);
  anchors[0] = Object.assign({}, anchors[0], {in:A2[A2.length-1].in});
  return {closed:true, op:'combine', anchors};
}
/* PathOp 换成我们能画的：combine 各块转顺时针（非零绕数＝联集）、subtract 转逆时针（＝挖洞）；join 不动。
   减去的块伸出主体外：两个都是圆就算成圆减圆，不然照旧反向（近似） */
function csNormalize(subs){
  let out = subs.map(sp => Object.assign({}, sp));
  for (let i = 0; i < out.length; i++){
    const S = out[i]; if (S.op !== 'subtract') continue;
    const pts = csFlatten(S, 6), adds = out.filter(x => x.op !== 'subtract');
    const polys = adds.map(x => csFlatten(x, 8));
    if (pts.every(p => polys.some(P => csInside(P, p)))) continue;   // 整个落在主体里：反向就是洞
    if (S.circle){
      const hit = adds.filter(x => x.circle && circleMinusCircle(x.circle, S.circle));
      if (hit.length === 1){
        const k = out.indexOf(hit[0]), cm = circleMinusCircle(hit[0].circle, S.circle);
        out[k] = cm; out.splice(i, 1); i--;
      }
    }
  }
  return out.map(sp => {
    if (sp.op === 'join') return sp;
    const a = csArea(sp);
    return (sp.op === 'subtract' ? a > 0 : a < 0) ? Object.assign(csReverse(sp), {op:sp.op}) : sp;
  });
}
/* 把手等于锚点（1e-9 内）＝我们的 null */
function csClean(subs){
  const h = (a, q) => (q && Math.hypot(q[0] - a.x, q[1] - a.y) > 1e-9) ? [q[0], q[1]] : null;
  return subs.map(sp => ({closed:!!sp.closed, op:sp.op || 'combine', anchors:sp.anchors.map(a => ({x:a.x, y:a.y, in:h(a, a.in), out:h(a, a.out)}))}));
}

/* ───────── shapes.rs:185-275 builtin：五组（我们自己画的，100×100 方格） ───────── */
const CS_NAMES = {   // 三语显示名（命令用英文名，也认中文名）
  'Symbols':['符號','符号'], 'Arrows':['箭頭','箭头'], 'Speech Bubbles':['對話框','对话框'], 'Nature':['自然','自然'], 'Animals':['動物','动物'], 'Custom Shapes':['自訂形狀','自定形状'],
  'Heart':['心形','心形'], 'Star':['星形','星形'], 'Six-Point Star':['六角星','六角星'], 'Burst':['爆炸星','爆炸星'], 'Check Mark':['勾號','勾号'], 'Cross':['叉號','叉号'],
  'Plus':['加號','加号'], 'Ring':['圓環','圆环'], 'Lightning':['閃電','闪电'], 'Diamond':['菱形','菱形'],
  'Arrow Right':['右箭頭','右箭头'], 'Arrow Left':['左箭頭','左箭头'], 'Arrow Up':['上箭頭','上箭头'], 'Arrow Down':['下箭頭','下箭头'], 'Double Arrow':['雙向箭頭','双向箭头'],
  'Chevron':['V 形箭頭','V 形箭头'], 'Curved Arrow':['彎箭頭','弯箭头'],
  'Speech Bubble':['對話框','对话框'], 'Round Bubble':['圓形對話框','圆形对话框'], 'Thought Bubble':['思考泡泡','思考泡泡'], 'Shout Bubble':['爆炸對話框','爆炸对话框'],
  'Leaf':['葉子','叶子'], 'Sun':['太陽','太阳'], 'Crescent Moon':['新月','新月'], 'Cloud':['雲朵','云朵'], 'Raindrop':['雨滴','雨滴'], 'Flower':['花朵','花朵'], 'Tree':['樹','树'],
  'Fish':['魚','鱼'], 'Cat':['貓','猫'], 'Bird':['鳥','鸟'], 'Butterfly':['蝴蝶','蝴蝶'], 'Paw Print':['腳印','脚印'], 'Rabbit':['兔子','兔子']
};
const CS_SRC = [
  ['Symbols', [
    ['Heart', 'M 50 92 C 20 70 0 52 0 30 C 0 12 14 0 28 0 C 40 0 47 8 50 16 C 53 8 60 0 72 0 C 86 0 100 12 100 30 C 100 52 80 70 50 92 Z'],
    ['Star', csStar(5, 0.4, 0)],
    ['Six-Point Star', csStar(6, 0.55, 0)],
    ['Burst', csStar(16, 0.72, 0)],
    ['Check Mark', 'M 5 55 L 20 40 L 38 58 L 82 12 L 97 27 L 38 88 Z'],
    ['Cross', 'M 20 5 L 50 35 L 80 5 L 95 20 L 65 50 L 95 80 L 80 95 L 50 65 L 20 95 L 5 80 L 35 50 L 5 20 Z'],
    ['Plus', 'M 38 0 L 62 0 L 62 38 L 100 38 L 100 62 L 62 62 L 62 100 L 38 100 L 38 62 L 0 62 L 0 38 L 38 38 Z'],
    ['Ring', 'O 50 50 50 ! O 50 50 32'],
    ['Lightning', 'M 58 0 L 18 56 L 44 56 L 34 100 L 82 38 L 55 38 L 70 0 Z'],
    ['Diamond', 'M 50 0 L 90 50 L 50 100 L 10 50 Z']]],
  ['Arrows', [
    ['Arrow Right', 'M 0 35 L 55 35 L 55 15 L 100 50 L 55 85 L 55 65 L 0 65 Z'],
    ['Arrow Left', 'M 100 35 L 45 35 L 45 15 L 0 50 L 45 85 L 45 65 L 100 65 Z'],
    ['Arrow Up', 'M 35 100 L 35 45 L 15 45 L 50 0 L 85 45 L 65 45 L 65 100 Z'],
    ['Arrow Down', 'M 35 0 L 35 55 L 15 55 L 50 100 L 85 55 L 65 55 L 65 0 Z'],
    ['Double Arrow', 'M 0 50 L 25 20 L 25 38 L 75 38 L 75 20 L 100 50 L 75 80 L 75 62 L 25 62 L 25 80 Z'],
    ['Chevron', 'M 10 0 L 45 0 L 95 50 L 45 100 L 10 100 L 60 50 Z'],
    ['Curved Arrow', 'M 8 92 C 8 45 35 22 68 22 L 68 4 L 98 34 L 68 64 L 68 44 C 48 44 30 58 30 92 Z']]],
  ['Speech Bubbles', [
    ['Speech Bubble', 'M 15 5 L 85 5 C 93 5 100 12 100 20 L 100 60 C 100 68 93 75 85 75 L 45 75 L 20 98 L 25 75 L 15 75 C 7 75 0 68 0 60 L 0 20 C 0 12 7 5 15 5 Z'],
    ['Round Bubble', 'M 50 5 C 78 5 100 22 100 42 C 100 62 78 79 50 79 C 44 79 38 78 33 77 L 12 95 L 18 72 C 7 65 0 54 0 42 C 0 22 22 5 50 5 Z'],
    ['Thought Bubble', 'M 50 5 C 78 5 100 20 100 38 C 100 56 78 71 50 71 C 22 71 0 56 0 38 C 0 20 22 5 50 5 Z O 22 82 8 O 9 95 5'],
    ['Shout Bubble', csShout()]]],
  ['Nature', [
    ['Leaf', 'M 50 0 C 80 20 95 50 80 75 C 72 88 60 92 53 92 L 53 100 L 47 100 L 47 92 C 40 92 28 88 20 75 C 5 50 20 20 50 0 Z ! M 48.5 22 L 51.5 22 L 51.5 88 L 48.5 88 Z'],
    ['Sun', csSun()],
    ['Crescent Moon', 'O 45 50 45 ! O 66 40 38'],
    ['Cloud', 'M 25 80 C 10 80 0 70 0 58 C 0 46 10 37 22 37 C 24 20 38 10 54 10 C 70 10 82 20 85 34 C 95 35 100 45 100 57 C 100 70 90 80 78 80 Z'],
    ['Raindrop', 'M 50 0 C 60 25 85 45 85 68 C 85 87 69 100 50 100 C 31 100 15 87 15 68 C 15 45 40 25 50 0 Z'],
    ['Flower', csFlower()],
    ['Tree', 'M 50 0 L 85 45 L 68 45 L 92 75 L 56 75 L 56 100 L 44 100 L 44 75 L 8 75 L 32 45 L 15 45 Z']]],
  ['Animals', [
    ['Fish', 'M 0 50 C 15 25 45 15 70 32 L 96 12 L 88 50 L 96 88 L 70 68 C 45 85 15 75 0 50 Z ! O 20 45 4'],
    ['Cat', 'M 15 10 L 35 30 C 45 27 55 27 65 30 L 85 10 L 88 50 C 92 75 72 95 50 95 C 28 95 8 75 12 50 Z ! O 36 58 6 ! O 64 58 6'],
    ['Bird', 'M 0 40 C 15 30 35 32 50 50 C 65 32 85 30 100 40 C 85 40 65 48 50 70 C 35 48 15 40 0 40 Z'],
    ['Butterfly', 'M 50 30 C 40 5 5 0 5 25 C 5 45 30 50 45 50 C 25 55 10 75 25 90 C 38 100 48 80 50 65 C 52 80 62 100 75 90 C 90 75 75 55 55 50 C 70 50 95 45 95 25 C 95 0 60 5 50 30 Z'],
    ['Paw Print', 'M 50 50 C 68 50 82 66 82 80 C 82 92 70 96 60 94 C 55 93 52 91 50 91 C 48 91 45 93 40 94 C 30 96 18 92 18 80 C 18 66 32 50 50 50 Z O 18 42 10 O 37 22 11 O 63 22 11 O 82 42 10'],
    ['Rabbit', 'O 50 72 26 M 34 52 C 22 30 24 2 34 2 C 44 2 46 30 44 50 Z M 66 52 C 78 30 76 2 66 2 C 56 2 54 30 56 50 Z']]]
];
const CS_CUSTOM_GROUP = 'Custom Shapes';                              // shapes.rs:20 CUSTOM_GROUP

const CustomShapeKit = {
  _builtin: null,
  /* shapes.rs:186-189 mk：解析失败的跳过（filter_map） */
  builtin(){
    if (this._builtin) return this._builtin;
    this._builtin = CS_SRC.map(([g, list]) => ({name:g, builtin:true, items:list.map(([n, src]) => {
      // box＝原始路径（两个圆都算）的控制点外框：fit 照它映，圆减圆算过之后放出来的大小位置才跟原码一样
      try { const raw = csParse(src); return {name:n, box:this.controlBounds(raw), subpaths:csClean(csNormalize(raw)), fillRule:'nonzero'}; } catch (e){ return null; }
    }).filter(Boolean)}));
    return this._builtin;
  },
  /* shapes.rs:278-285 all_groups：内建＋「Custom Shapes」（编辑 ▸ 定义自定形状存的；ps-edit.js 的库） */
  groups(){
    const g = this.builtin().slice();
    const lib = (window.PsEdit && PsEdit.customShapes) ? PsEdit.customShapes.list() : [];
    if (lib.length) g.push({name:CS_CUSTOM_GROUP, builtin:false, items:lib.map(c => ({name:c.name, group:c.group, fillRule:c.fillRule || 'nonzero', box:this.controlBounds(c.subpaths),
      subpaths:csClean(c.fillRule === 'evenodd' || c.subpaths.some(sp => sp.op === 'exclude') ? c.subpaths : csNormalize(c.subpaths))}))});
    return g;
  },
  /* 显示名（三语） */
  label(name){
    const n = CS_NAMES[name], l = (window.Lang && Lang.cur) || 'en';
    if (!n) return name;
    return l === 'zh-Hant' ? n[0] : l === 'zh-Hans' ? n[1] : name;
  },
  /* shapes.rs:287-291 lookup（presets::find：名字对、组给了就也要对）；也认三语名 */
  lookup(name, group){
    for (const g of this.groups()){
      if (group !== undefined && group !== null && g.name !== group && this.label(g.name) !== group) continue;
      const it = g.items.find(s => s.name === name) || g.items.find(s => CS_NAMES[s.name] && CS_NAMES[s.name].includes(name));
      if (it) return Object.assign({group:g.name}, it);
    }
    return null;
  },
  /* vector.rs:162 control_bounds：锚点与把手全算 */
  controlBounds(subs){
    let b = null;
    const add = q => { if (!q) return; if (!b) b = [q[0], q[1], q[0], q[1]]; else { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); } };
    subs.forEach(sp => sp.anchors.forEach(a => { add([a.x, a.y]); add(a.in); add(a.out); }));
    return b;
  },
  /* shapes.rs:303-315 fit：控制点外框映到 rect=[x,y,w,h]；keep＝保比例（取小的倍率）并在 rect 里置中 */
  fit(subs, rect, keep, box){
    const b = box || this.controlBounds(subs); if (!b) return subs;
    const bw = Math.max(b[2] - b[0], 1e-9), bh = Math.max(b[3] - b[1], 1e-9);
    let sx = rect[2] / bw, sy = rect[3] / bh, ox = rect[0], oy = rect[1];
    if (keep){ const k = Math.min(sx, sy); ox += (rect[2] - bw * k) / 2; oy += (rect[3] - bh * k) / 2; sx = sy = k; }
    const f = (x, y) => [sx * x + ox - b[0] * sx, sy * y + oy - b[1] * sy], m = q => q ? f(q[0], q[1]) : null;
    return subs.map(sp => ({closed:sp.closed, op:sp.op, anchors:sp.anchors.map(a => { const p = f(a.x, a.y); return {x:p[0], y:p[1], in:m(a.in), out:m(a.out)}; })}));
  },
  /* 子路径 → 我们的一个形状（文件坐标；addShape 会换成图层坐标）：一条＝bezier，多条＝复合路径 */
  toShape(subs, fillRule){
    const bz = sp => ({type:'bezier', anchors:sp.anchors.map(a => ({x:a.x, y:a.y, in:a.in, out:a.out})), closed:!!sp.closed});
    if (subs.length === 1) return bz(subs[0]);
    const NO = {fill:'none', stroke:'none', strokeWidth:0};
    return {type:'compound', rule:fillRule === 'evenodd' ? 'evenodd' : 'nonzero', children:subs.map(sp => Object.assign({id:uid('S')}, bz(sp), NO))};
  },
  /* 一个形状的缩图（shapes.rs:293 thumbnail：边距 8%、保比例） */
  thumb(it, size, color){
    const c = document.createElement('canvas'); c.width = c.height = size;
    const m = Math.max(size * 0.08, 1), subs = this.fit(it.subpaths, [m, m, size - 2*m, size - 2*m], true, it.box), x = c.getContext('2d');
    x.beginPath(); subs.forEach(sp => bezierPath(x, sp, 1));
    x.fillStyle = color || '#d6d6d6'; x.fill(it.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
    return c;
  }
};
window.CustomShapeKit = CustomShapeKit;

/* ───────── 工具状态 ───────── */
const CustomShapeTool = {
  shape: 'Heart',        // PresetUi.custom_shape（缺省 Heart，preset_panels.rs:47）
  fill: true,            // ToolOptions.shape_fill（state.rs:445 缺省 true）
  strokeWidth: 0,        // ToolOptions.stroke_width（state.rs:446 缺省 0）
  start: null, last: null, mods: {shift:false, alt:false}, picker: null,

  /* vector_ui.rs:45-78 shape_geometry（自定形状那支）：⇧＝取较长边、两边各保留自己的方向；⌥＝以按下点为中心；四舍五入；<1 ⇒ null */
  geometry(start, end, m){
    let w = end[0] - start[0], h = end[1] - start[1];
    const sg = v => (v > 0 || Object.is(v, 0)) ? 1 : -1;              // Rust f64::signum：+0 也算 1
    if (m.shift){ const k = Math.max(Math.abs(w), Math.abs(h)); w = k * sg(w); h = k * sg(h); }
    const x0 = m.alt ? start[0] - w : start[0], y0 = m.alt ? start[1] - h : start[1];
    if (m.alt){ w *= 2; h *= 2; }
    const rect = [Math.round(Math.min(x0, x0 + w)), Math.round(Math.min(y0, y0 + h)), Math.round(Math.abs(w)), Math.round(Math.abs(h))];
    return (rect[2] < 1 || rect[3] < 1) ? null : rect;
  },
  /* vector_ui.rs:83-84 填色＝勾着用前景色；:38-41 stroke_param＝描边宽>0 用背景色 */
  fillParam(){ const f = UI.fill(); return (this.fill && f && f !== 'none') ? f : null; },
  strokeParam(){
    if (!(this.strokeWidth > 0)) return null;
    const el = document.getElementById('strokeColor');
    return {width:this.strokeWidth, color:(el && el.value) || '#000000'};
  },
  down(e, pt){ this.start = [pt[0], pt[1]]; this.last = [pt[0], pt[1]]; this.mods = {shift:!!e.shiftKey, alt:!!e.altKey}; },
  move(e, pt){ if (!this.start) return; this.last = [pt[0], pt[1]]; this.mods = {shift:!!e.shiftKey, alt:!!e.altKey}; },
  /* canvas.rs:2157 finish_gesture → vector_ui.rs:81 finish_shape → preset_panels.rs:793 finish_custom_shape */
  up(e, pt){
    const s = this.start; if (!s) return;
    this.start = null;
    const m = {shift:!!e.shiftKey, alt:!!e.altKey};
    const rect = this.geometry(s, pt, m); if (!rect) return;
    const r = CMD.run('customshape.place', {preset:this.shape, rect, keepAspect:m.shift, fill:this.fillParam(), stroke:this.strokeParam()});
    if (r && r.ok === false && !CustomShapeKit.lookup(this.shape) && window.Locks)
      Locks.notify(Lang.t('ui.csNoShape').replace('{name}', this.shape));   // :796-798 找不到形状：状态列提示
  },
  cancel(){ this.start = null; },

  /* vector_ui.rs:102-116 预览：自定形状只画外框（accent 压暗边，tool_feedback::contrast_path）；我们再加一条形状虚线轮廓 */
  overlay(ctx, s){
    if (!this.start || !this.last) return;
    const rect = this.geometry(this.start, this.last, this.mods); if (!rect) return;
    const dpr = s / Math.max(UI.zoom, 1e-9);
    const [x, y, w, h] = rect.map(v => v * s);
    ctx.save(); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3 * dpr; ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = '#2f7fd8'; ctx.lineWidth = 1.5 * dpr; ctx.strokeRect(x, y, w, h);
    const it = CustomShapeKit.lookup(this.shape);
    if (it){
      const subs = CustomShapeKit.fit(it.subpaths, rect, this.mods.shift, it.box);
      ctx.beginPath(); subs.forEach(sp => bezierPath(ctx, sp, s));
      ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.lineWidth = dpr; ctx.strokeStyle = '#2f7fd8'; ctx.stroke();
    }
    ctx.restore();
  },

  /* preset_panels.rs:738-790 shape_picker：选项栏一格缩图＋▾，点开按组列 32×32 缩图，点一下换形状 */
  openPicker(anchor){
    this.closePicker();
    const pop = document.createElement('div'); pop.id = 'csPicker';
    const r = anchor.getBoundingClientRect();
    pop.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom + 4}px;z-index:10000;width:232px;max-height:320px;overflow:auto;background:#2b2f36;border:1px solid #444a55;border-radius:4px;padding:6px;box-shadow:0 6px 20px rgba(0,0,0,.4);font:11px sans-serif;color:#9aa3ae`;
    for (const g of CustomShapeKit.groups()){
      const h = document.createElement('div'); h.textContent = CustomShapeKit.label(g.name); h.style.cssText = 'margin:4px 0 3px'; pop.appendChild(h);
      const row = document.createElement('div'); row.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px';
      for (const it of g.items){
        const b = document.createElement('div'); b.dataset.shape = it.name; b.title = CustomShapeKit.label(it.name);
        b.style.cssText = `width:32px;height:32px;border-radius:2px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:${it.name === this.shape ? '#3d5f8f' : '#1d2026'}`;
        const t = CustomShapeKit.thumb(it, 24, '#e6e8ec'); b.appendChild(t);
        b.onclick = e => { e.stopPropagation(); CMD.run('customshape.options', {shape:it.name}); this.closePicker(); };
        row.appendChild(b);
      }
      pop.appendChild(row);
    }
    pop.addEventListener('pointerdown', e => e.stopPropagation());
    document.body.appendChild(pop);
    this.picker = pop;
    setTimeout(() => document.addEventListener('pointerdown', this._outside = () => this.closePicker(), {once:true}), 0);
  },
  closePicker(){ if (this.picker){ this.picker.remove(); this.picker = null; } if (this._outside){ document.removeEventListener('pointerdown', this._outside); this._outside = null; } }
};
window.CustomShapeTool = CustomShapeTool;

/* ───────── 命令（shapes.rs:429-482 specs；命名空间用工具 id） ───────── */
const csFail = e => ({ok:false, error:e});
CMD.reg('customshape.list', {i18n:'',
  params:'{} → {groups:[{name, label, builtin, shapes:[{name, label, subpaths}]}]}  ＝ shape.presets.list：内建五组（符号／箭头／对话框／自然／动物）＋「Custom Shapes」（编辑 ▸ 定义自定形状存的）'},
  () => ({ok:true, current:CustomShapeTool.shape, groups:CustomShapeKit.groups().map(g => ({name:g.name, label:CustomShapeKit.label(g.name), builtin:g.builtin,
    shapes:g.items.map(i => ({name:i.name, label:CustomShapeKit.label(i.name), subpaths:i.subpaths.length}))}))}));

/* shapes.rs:328-361 place ＋ vector_cmds.rs:490-535 shape_create */
CMD.reg('customshape.place', {i18n:'', undoable:true,
  params:'{preset:形状名（英文名或三语名，见 customshape.list）, group?, rect?:[x,y,w,h] 文件坐标（缺省＝画布正中、短边一半的正方形；负宽高＝往左上拖，翻成正的；<1 报错）, ' +
         'keepAspect?:bool=true 保比例置中（工具：拖时按 ⇧）, fill?:"#rrggbb"|null（缺省＝填色/前景色；null＝不填）, stroke?:{color, width}|"#rrggbb"|null（缺省无）, strokeWidth?, ' +
         'name?:图层名（缺省＝形状名）, addTo?:矢量层 id（加进那层、不新建）} → {ok, id, layerId, preset, rect}  ＝ 自定形状工具拖一下（shape.presets.place）：每次新建一个矢量层（＝PS 形状层）插在当前层上面'}, p => {
  const C = 'customshape.place';
  const name = typeof p.preset === 'string' ? p.preset : '';
  if (!name) return csFail(C + ': missing `preset`');
  const it = CustomShapeKit.lookup(name, p.group);
  if (!it) return csFail(`${C}: no shape "${name}" (see customshape.list)`);
  let rect;
  if (Array.isArray(p.rect) && p.rect.length === 4){
    const v = p.rect.map(x => +x || 0);
    const [x, w] = v[2] < 0 ? [v[0] + v[2], -v[2]] : [v[0], v[2]];
    const [y, h] = v[3] < 0 ? [v[1] + v[3], -v[3]] : [v[1], v[3]];
    if (w < 1 || h < 1) return csFail(C + ': the shape rect is empty');
    rect = [x, y, w, h];
  } else { const side = Math.min(Doc.width, Doc.height) * 0.5; rect = [(Doc.width - side) / 2, (Doc.height - side) / 2, side, side]; }
  const keep = p.keepAspect === undefined ? true : !!p.keepAspect;
  const sh = CustomShapeKit.toShape(CustomShapeKit.fit(it.subpaths, rect, keep, it.box), it.fillRule);
  // shape_create：fill 缺省＝前景色、null＝不填；stroke 缺省无
  const fill = p.fill === undefined ? UI.fill() : (p.fill === null || p.fill === false ? 'none' : p.fill);
  let stroke = 'none', sw = 0;
  if (p.stroke && typeof p.stroke === 'object'){ stroke = p.stroke.color || '#000000'; sw = +p.stroke.width || 1; }
  else if (typeof p.stroke === 'string' && p.stroke !== 'none'){ stroke = p.stroke; sw = +p.strokeWidth || 1; }
  if (p.strokeWidth !== undefined && stroke !== 'none') sw = +p.strokeWidth || 0;
  Object.assign(sh, {fill, stroke, strokeWidth:sw});
  let L;
  if (p.addTo !== undefined){
    L = Doc.byId(p.addTo); if (!L || L.kind !== 'vector') return csFail(`${C}: layer ${p.addTo} is not a vector layer`);
    if (window.Locks && Locks.blocks(L, 'pixels')) return Locks.fail(L, Locks.blocks(L, 'pixels'), C);
  } else {
    L = Layer.vector(typeof p.name === 'string' && p.name.trim() ? p.name.trim() : it.name);
    const i = Doc.index(Doc.activeId);
    Doc.add(L, i >= 0 ? i + 1 : undefined);                            // insert_above(active)、成为当前层
  }
  const r = addShape(Object.assign(sh, {layerId:L.id}));
  if (!r || r.ok === false) return r || csFail(C + ': could not place the shape');
  return {ok:true, id:r.id, layerId:L.id, preset:it.name, rect};
});

/* shapes.rs:363-385 new_preset：从路径存成新形状（正规化进 100 方格）——存进 ps-edit.js 的自定形状库（同「编辑 ▸ 定义自定形状」） */
CMD.reg('customshape.define', {i18n:'',
  params:'{name?="Shape N", path?:"M x y L …"（预设路径语言：M L C Q Z O，! 放在 M／O 前＝减去）, layerId?:矢量层（缺省＝当前矢量层；它选中的形状或整层）} ' +
         '→ {ok, name}  ＝ shape.presets.new：存进「Custom Shapes」组（浏览器 dlcanvas.ps.customShapes，跟编辑 ▸ 定义自定形状同一个库）；不进历史'}, p => {
  if (typeof p.path === 'string' && /^\s*[MO!]/.test(p.path)){
    if (!window.PsEdit || !PsEdit.customShapes) return csFail('customshape.define: no custom shape library');
    let subs; try { subs = csParse(p.path); } catch (e){ return csFail('customshape.define: ' + e.message); }
    subs = CustomShapeKit.fit(csClean(subs), [0, 0, 100, 100], true);
    const lib = PsEdit.customShapes.list();
    const name = (typeof p.name === 'string' && p.name.trim()) ? p.name.trim() : `Shape ${lib.length + 1}`;
    const it = {name, fillRule:'nonzero', subpaths:subs}, i = lib.findIndex(c => c.name === name);
    if (i >= 0) lib[i] = Object.assign({}, lib[i], it); else lib.push(it);
    PsEdit.customShapes.save(lib);
    return {ok:true, name, count:lib.length};
  }
  if (!CMD.map['ps.edit.defineCustomShape']) return csFail('customshape.define: no Edit ▸ Define Custom Shape');
  const q = {}; if (p.name !== undefined) q.name = p.name; if (p.layerId !== undefined) q.layerId = p.layerId;
  return CMD.map['ps.edit.defineCustomShape'].run(q);
});

/* 工具选项（不进历史）：agent 做得到跟选项栏一样的事 */
CMD.reg('customshape.options', {i18n:'',
  params:'{shape?:形状名, fill?:bool 填色（前景色）, strokeWidth?:0..288 px（描边用背景色/描边色块）} → 目前选项；不给参数＝只读'}, p => {
  if (p.shape !== undefined){
    const it = CustomShapeKit.lookup(String(p.shape));
    if (!it) return csFail(`customshape.options: no shape "${p.shape}" (see customshape.list)`);
    CustomShapeTool.shape = it.name;
  }
  if (p.fill !== undefined) CustomShapeTool.fill = !!p.fill;
  if (p.strokeWidth !== undefined){ const v = +p.strokeWidth; CustomShapeTool.strokeWidth = Math.max(0, Math.min(288, Number.isFinite(v) ? v : 0)); }
  if (ToolState.cur === 'customshape' && window.UI) UI.buildOptions('customshape');
  return {ok:true, shape:CustomShapeTool.shape, fill:CustomShapeTool.fill, strokeWidth:CustomShapeTool.strokeWidth};
});

Tools.reg({
  id:'customshape', icon:'✿', group:'vector', order:60, for:'common', needs:'vector', opts:[],
  hint:'ui.csHint', cursor:'crosshair',
  strings:{
    'zh-Hant':{'tool.customshape':'自訂形狀工具', 'ui.csHint':'拖曳＝畫出所選形狀（新增一個形狀圖層）｜Shift＋拖＝保持比例｜Alt＋拖＝從中心｜拖時 Esc 取消',
               'opt.csMode':'模式', 'opt.csShapeMode':'形狀', 'opt.csFill':'填色：', 'opt.csStroke':'筆畫：', 'opt.csShape':'形狀：',
               'ui.csNoShape':'沒有自訂形狀「{name}」：請在選項列或 視窗 ▸ 形狀 挑一個'},
    'zh-Hans':{'tool.customshape':'自定形状工具', 'ui.csHint':'拖曳＝画出所选形状（新建一个形状图层）｜Shift＋拖＝保持比例｜Alt＋拖＝从中心｜拖时 Esc 取消',
               'opt.csMode':'模式', 'opt.csShapeMode':'形状', 'opt.csFill':'填充：', 'opt.csStroke':'描边：', 'opt.csShape':'形状：',
               'ui.csNoShape':'没有自定形状“{name}”：请在选项栏或 窗口 ▸ 形状 挑一个'},
    'en':{'tool.customshape':'Custom Shape Tool', 'ui.csHint':'Drag to draw the picked shape (a new shape layer) | Shift+Drag: keep proportions | Alt+Drag: from center | Esc while dragging: cancel',
          'opt.csMode':'Mode', 'opt.csShapeMode':'Shape', 'opt.csFill':'Fill:', 'opt.csStroke':'Stroke:', 'opt.csShape':'Shape:',
          'ui.csNoShape':'No custom shape "{name}": pick one in the options bar or Window › Shapes'}
  },
  /* vector_ui.rs:403-437 options_bar */
  buildOptions(box, add, mk){
    const mode = document.createElement('select'); const o = document.createElement('option'); o.value = 'shape'; o.textContent = Lang.t('opt.csShapeMode'); mode.appendChild(o);
    add('csMode', mode);
    const f = mk('checkbox', {checked:CustomShapeTool.fill, id:'csFill'});
    f.onchange = () => { CMD.run('customshape.options', {fill:f.checked}); f.blur(); };
    add('csFill', f);
    const sw = document.createElement('span'); sw.style.cssText = `display:inline-block;width:22px;height:16px;border:1px solid #666;border-radius:2px;vertical-align:middle;background:${UI.fill() === 'none' ? 'transparent' : UI.fill()}`;
    box.appendChild(sw);
    const st = mk('number', {min:0, max:288, value:CustomShapeTool.strokeWidth, id:'csStroke'});
    st.style.width = '58px';
    st.onchange = () => { CMD.run('customshape.options', {strokeWidth:+st.value}); };
    add('csStroke', st);
    const pick = document.createElement('button'); pick.id = 'csPick'; pick.type = 'button'; pick.title = CustomShapeKit.label(CustomShapeTool.shape);
    pick.style.cssText = 'display:inline-flex;align-items:center;gap:3px;height:22px;padding:0 4px;background:#1d2026;border:1px solid #444a55;border-radius:3px;cursor:pointer';
    const it = CustomShapeKit.lookup(CustomShapeTool.shape);
    if (it) pick.appendChild(CustomShapeKit.thumb(it, 18, '#e6e8ec'));
    const ch = document.createElement('span'); ch.textContent = '▾'; ch.style.cssText = 'color:#9aa3ae;font-size:10px'; pick.appendChild(ch);
    pick.onclick = e => { e.stopPropagation(); if (CustomShapeTool.picker) CustomShapeTool.closePicker(); else CustomShapeTool.openPicker(pick); };
    add('csShape', pick);
  },
  onDown(e, pt){ if (e.button !== undefined && e.button !== 0) return; CustomShapeTool.down(e, pt); UI.draw(); },
  onMove(e, pt, P){ if (!P.down || !CustomShapeTool.start) return; CustomShapeTool.move(e, pt); UI.draw(); },
  onUp(e, pt){ CustomShapeTool.up(e, pt); UI.draw(); },
  onKey(e){
    if (e.key === 'Escape' && CustomShapeTool.start){ CustomShapeTool.cancel(); UI.draw(); return true; }
    if (e.key === 'Escape' && CustomShapeTool.picker){ CustomShapeTool.closePicker(); return true; }
    return false;
  },
  onDeactivate(){ CustomShapeTool.cancel(); CustomShapeTool.closePicker(); },
  drawOverlay(ctx, s){ CustomShapeTool.overlay(ctx, s); }
});
