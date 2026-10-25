/* 堤麟画板 · Illustrator ▸ 效果 ▸ 3D（凸出和斜角／绕转／旋转）
   原码：VectorCraft ui-egui/src/menus.rs:2562 这一组全是 todo（"Extrude & Bevel…"、"Revolve…"、"Rotate…" 只登记了菜单名，engine 没有任何 3D 命令）
     ⇒ 原码无·照 Illustrator 2020 的实际行为做：
   · 对话框照 AI 2020「3D 凸出和斜角选项／3D 绕转选项／3D 旋转选项」：位置预设（前方…等角-下方、自定旋转）、X／Y／Z 旋转、透视、
     凸出厚度、端点（实心／空心）、斜角（12 款剖面）＋高度＋斜角外扩／内缩、绕转角度＋位移＋自左边／右边、
     表面（线框／无底纹／扩散底纹／塑料效果底纹）＋更多选项（光源位置、光源强度、环境光、高光强度、高光大小、混合步骤、底纹颜色、绘制隐藏表面）。
   · 作为「外观效果」挂在物件上：s.effects 里加 {id:'3d.extrudeBevel'|'3d.revolve'|'3d.rotate', params, visible}（跟 ai-effect.js 的活效果同一个堆叠，
     历史快照、工程档、外观面板、ai.effect.remove／setParams／move 全部照用）。非破坏性：渲染时才算。
   · 渲染：物件（先套堆叠里排在 3D 前面的效果）的每条子路径拉平成多边形 → 建 3D 网格（凸出＝前后端点＋侧面＋斜角环；绕转＝剖面绕垂直轴转；旋转＝平面）
     → 照 Y→X→Z 旋转 → 透视投影 → 背面剔除（凸出）／双面（绕转、旋转）→ 按深度由远到近排（画家演算法）→ 每面照光照着色（兰伯特漫射＋Blinn 高光）
     → 产出一个「编组」的 2D 路径（每面一条闭合路径）；堆叠里 3D 后面的效果套在这个编组上（例：3D 后再加投影）。
   · 可再编辑：外观面板点那一项／再点菜单（先问「编辑／新增」）就带着现值开对话框；可扩展外观：对象 ▸ 扩展外观 把 3D 烘成真的路径编组。
   接法（不改 ai-effect.js）：包 ObjRender（同 ai-effect.js 的作法，本档要在 ai-effect.js／ai-window.js 之后载）；
     CMD.redirects 把 ai.effect.apply／dialog／list／expandAppearance／applyLast／last 遇到 3D 时改走本档。
   命令：ai.effect.3d.extrudeBevel／revolve／rotate（直接套）、同名 .dialog（开对话框，菜单项接这条）、ai.effect.3d.art（看算出来的 2D 图稿，给测试与 agent）。 */
(function(){
'use strict';
if (window.Ai3D) return;
const FX = () => { if (!window.AiFx) throw new Error('ai.effect.3d: menus/impl/ai-effect.js（AiFx）没载入'); return window.AiFx; };
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const T = k => (window.Lang ? Lang.t(k) : k);
const numv = (v, d) => { const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN); return isFinite(n) ? n : d; };
const painted = p => !!p && p !== 'none' && p !== '';

/* ═════════════ 效果目录（预设＝AI 2020 对话框预设）═════════════ */
const POS = {position:'offAxisFront', rotX:-18, rotY:-26, rotZ:8, perspective:0};
const SURF = {lightX:-0.45, lightY:0.45, lightIntensity:100, ambient:50, highlightIntensity:60, highlightSize:90, blendSteps:25, shadingColor:'#000000', drawHiddenFaces:false};
const CAT3 = {
  '3d.extrudeBevel':{label:'Extrude & Bevel…', defaults:Object.assign({}, POS, {depth:50, cap:true, bevel:'none', bevelHeight:4, bevelExtent:'in', surface:'plastic'}, SURF)},
  '3d.revolve':{label:'Revolve…', defaults:Object.assign({}, POS, {angle:360, cap:true, offset:0, offsetFrom:'left', surface:'plastic'}, SURF)},
  '3d.rotate':{label:'Rotate…', defaults:Object.assign({}, POS, {surface:'diffuse'}, SURF)}
};
const DOC_POS = 'position?: 预设名（front|back|left|right|top|bottom|offAxisFront|offAxisBack|offAxisLeft|offAxisRight|offAxisTop|offAxisBottom|isometricLeft|isometricRight|isometricTop|isometricBottom|custom；给了预设且没给 rotX/Y/Z 就用预设角度）, rotX?/rotY?/rotZ?: 度 -180..180（先绕 Y、再绕 X、再绕 Z）, perspective?: 度 0..160';
const DOC_SURF = 'lightX?/lightY?: 光源在球面上的位置 -1..1（预设左上 -0.45/0.45）, lightIntensity?: % 0..100 (100), ambient?: 环境光 % 0..100 (50), highlightIntensity?: 高光强度 % (60), highlightSize?: 高光大小 % (90), blendSteps?: 1..256 (25，存着；我们每面单色), shadingColor?: 底纹颜色 (#000000), drawHiddenFaces?: bool';
const DOCS = {
  '3d.extrudeBevel':`{${DOC_POS}, depth?: 凸出厚度 pt 0..2000 (50), cap?: bool 端点（true＝实心、false＝空心）, bevel?: none|classic|complex1|complex2|concave|conical|cove|frame|jumping|pointed|rolling|round|tiered, bevelHeight?: pt 1..100 (4), bevelExtent?: in|out（斜角内缩／外扩）, surface?: wireframe|none|diffuse|plastic (plastic), ${DOC_SURF}}`,
  '3d.revolve':`{${DOC_POS}, angle?: 绕转角度 0..360 (360), cap?: bool, offset?: 位移 pt 0..1000 (0), offsetFrom?: left|right（绕转轴在物件外框的左边／右边，再往外移 offset）, surface?: wireframe|none|diffuse|plastic (plastic), ${DOC_SURF}}`,
  '3d.rotate':`{${DOC_POS}, surface?: none|diffuse (diffuse), ${DOC_SURF}}`
};
const IDS = Object.keys(CAT3);
const is3dId = id => IDS.includes(id);
/* 位置预设（X、Y、Z 度；本档的转法：先绕 Y、再绕 X、再绕 Z；X 负＝看得到顶面、Y 负＝看得到右侧面） */
const PRESETS = {
  front:[0, 0, 0], back:[0, 180, 0], left:[0, 90, 0], right:[0, -90, 0], top:[-90, 0, 0], bottom:[90, 0, 0],
  offAxisFront:[-18, -26, 8], offAxisBack:[-18, 154, -8], offAxisLeft:[-18, 64, -8], offAxisRight:[-18, -116, 8], offAxisTop:[-72, -26, 8], offAxisBottom:[72, -26, -8],
  isometricLeft:[-35.26, 45, 0], isometricRight:[-35.26, -45, 0], isometricTop:[-54.74, 45, 0], isometricBottom:[54.74, 45, 0]
};
const BEVELS = {    // 斜角剖面：[t（从端点往里的深度比例 0..1）, u（往内缩的比例 0..1）]，由端点往侧面；外观照 AI 2020 斜角库的样子取近似
  classic:[[0, 1], [1, 0]],
  complex1:[[0, 1], [0.3, 0.6], [0.5, 0.6], [1, 0]],
  complex2:[[0, 1], [0.25, 0.75], [0.5, 0.75], [0.75, 0.25], [1, 0]],
  concave:arc((a) => [Math.sin(a), Math.cos(a)]),
  conical:[[0, 1], [0.3, 0.25], [1, 0]],
  cove:[[0, 1], [0.15, 1], [0.15, 0.7]].concat(arc(a => [0.15 + 0.85*Math.sin(a), 0.7*Math.cos(a)]).slice(1)),
  frame:[[0, 1], [0.2, 1], [0.2, 0.5], [0.8, 0.5], [0.8, 0], [1, 0]],
  jumping:[[0, 1], [0.3, 1], [0.3, 0.4], [1, 0.4], [1, 0]],
  pointed:[[0, 1], [0.8, 0.6], [1, 0]],
  rolling:Array.from({length:9}, (_, i) => { const t = i / 8; return [t, (1 - t) + 0.12*Math.sin(t*Math.PI*2)]; }),
  round:arc(a => [1 - Math.cos(a), 1 - Math.sin(a)]),
  tiered:[[0, 1], [0.33, 1], [0.33, 0.66], [0.66, 0.66], [0.66, 0.33], [1, 0.33], [1, 0]]
};
function arc(f){ const o = []; for (let i = 0; i <= 8; i++) o.push(f(i / 8 * Math.PI / 2)); return o; }
const SURFACES = {'3d.extrudeBevel':['wireframe', 'none', 'diffuse', 'plastic'], '3d.revolve':['wireframe', 'none', 'diffuse', 'plastic'], '3d.rotate':['none', 'diffuse']};

/* 参数整理：缺的取预设、范围夹住；给了位置预设而没给角度＝用预设角度 */
function norm(id, p){
  const d = CAT3[id].defaults, q = Object.assign({}, d), src = (p && typeof p === 'object') ? p : {};
  for (const k of Object.keys(d)) if (src[k] !== undefined && src[k] !== null) q[k] = src[k];
  if (src.position && PRESETS[src.position] && src.rotX === undefined && src.rotY === undefined && src.rotZ === undefined) [q.rotX, q.rotY, q.rotZ] = PRESETS[src.position];
  else if (src.position === undefined && (src.rotX !== undefined || src.rotY !== undefined || src.rotZ !== undefined)) q.position = 'custom';
  if (q.position !== 'custom' && !PRESETS[q.position]) q.position = 'custom';
  const wrap = a => { a = numv(a, 0) % 360; if (a > 180) a -= 360; if (a < -180) a += 360; return a; };
  q.rotX = wrap(q.rotX); q.rotY = wrap(q.rotY); q.rotZ = wrap(q.rotZ);
  q.perspective = clamp(numv(q.perspective, 0), 0, 160);
  if ('depth' in d) q.depth = clamp(numv(q.depth, d.depth), 0, 2000);
  if ('bevelHeight' in d) q.bevelHeight = clamp(numv(q.bevelHeight, d.bevelHeight), 1, 100);
  if ('bevel' in d && q.bevel !== 'none' && !BEVELS[q.bevel]) q.bevel = 'none';
  if ('bevelExtent' in d) q.bevelExtent = q.bevelExtent === 'out' ? 'out' : 'in';
  if ('angle' in d) q.angle = clamp(numv(q.angle, 360), 0, 360);
  if ('offset' in d) q.offset = clamp(numv(q.offset, 0), 0, 1000);
  if ('offsetFrom' in d) q.offsetFrom = q.offsetFrom === 'right' ? 'right' : 'left';
  if ('cap' in d) q.cap = q.cap !== false && q.cap !== 0 && q.cap !== 'false';
  if (!SURFACES[id].includes(q.surface)) q.surface = d.surface;
  q.lightX = clamp(numv(q.lightX, d.lightX), -1, 1); q.lightY = clamp(numv(q.lightY, d.lightY), -1, 1);
  ['lightIntensity', 'ambient', 'highlightIntensity', 'highlightSize'].forEach(k => { q[k] = clamp(numv(q[k], d[k]), 0, 100); });
  q.blendSteps = Math.round(clamp(numv(q.blendSteps, 25), 1, 256));
  q.shadingColor = /^#[0-9a-f]{6}$/i.test(q.shadingColor) ? q.shadingColor.toLowerCase() : '#000000';
  q.drawHiddenFaces = !!q.drawHiddenFaces && q.drawHiddenFaces !== 'false';
  return q;
}
const merged = (id, p) => norm(id, p);

/* ═════════════ 颜色 ═════════════ */
let _cx = null;
function rgbOf(c){
  if (c && typeof c === 'object'){ const st = Array.isArray(c.stops) ? c.stops : []; c = st.length ? (st[0].color || (Array.isArray(st[0]) ? st[0][1] : null)) : null; }   // 渐变＝取第一个色标
  if (!painted(c)) return null;
  if (!_cx) _cx = document.createElement('canvas').getContext('2d');
  _cx.fillStyle = '#000000'; _cx.fillStyle = String(c);
  const v = _cx.fillStyle;
  if (v[0] === '#') return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
  const m = v.match(/[\d.]+/g); return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
}
const hex = c => '#' + c.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, a[2] + (b[2]-a[2])*t];

/* ═════════════ 3D 小工具 ═════════════ */
const v3 = {
  sub:(a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]], add:(a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]], mul:(a, k) => [a[0]*k, a[1]*k, a[2]*k],
  dot:(a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2], cross:(a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]],
  len:a => Math.hypot(a[0], a[1], a[2]), norm:a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; }
};
/* 旋转矩阵（3×3 列优先阵列 m[r][c]）：先绕 Y（rotY）、再绕 X（-rotX：X 负＝顶面朝向观看者）、再绕 Z（rotZ：正＝画面上逆时针） */
function rotMatrix(rx, ry, rz){
  const r = Math.PI / 180, a = -rx*r, b = ry*r, c = rz*r;
  const X = [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
  const Y = [[Math.cos(b), 0, Math.sin(b)], [0, 1, 0], [-Math.sin(b), 0, Math.cos(b)]];
  const Z = [[Math.cos(c), -Math.sin(c), 0], [Math.sin(c), Math.cos(c), 0], [0, 0, 1]];
  const mm = (A, B) => A.map((row, i) => [0, 1, 2].map(j => row[0]*B[0][j] + row[1]*B[1][j] + row[2]*B[2][j]));
  return mm(Z, mm(X, Y));
}
const apply3 = (M, p) => [M[0][0]*p[0] + M[0][1]*p[1] + M[0][2]*p[2], M[1][0]*p[0] + M[1][1]*p[1] + M[1][2]*p[2], M[2][0]*p[0] + M[2][1]*p[1] + M[2][2]*p[2]];

/* ═════════════ 2D 轮廓 ═════════════ */
function inside(q, loops, rule){
  let w = 0, c = false;
  for (const P of loops){
    for (let i = 0, j = P.length - 1; i < P.length; j = i++){
      const a = P[j], b = P[i];
      if ((a[1] > q[1]) !== (b[1] > q[1])){
        const x = (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0];
        if (q[0] < x){ c = !c; w += b[1] > a[1] ? 1 : -1; }
      }
    }
  }
  return rule === 'evenodd' ? c : w !== 0;
}
/* 一条闭合轮廓的「往外」是右法线（y 朝下的画面座标）的几倍号：+1 或 -1 */
function outwardSign(C, loops, rule, size){
  let bi = 0, bl = -1;
  for (let i = 0; i < C.length; i++){ const a = C[i], b = C[(i + 1) % C.length], l = Math.hypot(b[0]-a[0], b[1]-a[1]); if (l > bl){ bl = l; bi = i; } }
  const a = C[bi], b = C[(bi + 1) % C.length], l = bl || 1, n = [(b[1]-a[1])/l, -(b[0]-a[0])/l], m = [(a[0]+b[0])/2, (a[1]+b[1])/2], e = Math.max(size * 1e-4, 1e-3);
  return inside([m[0] + n[0]*e, m[1] + n[1]*e], loops, rule) ? -1 : 1;
}
/* 轮廓往内缩 o（负＝往外扩）：顶点沿角平分线移，斜接长度夹在 4 倍内 */
function offsetLoop(C, sg, o){
  if (!o) return C.map(p => p.slice());
  const n = C.length, out = [];
  const rn = (a, b) => { const dx = b[0]-a[0], dy = b[1]-a[1], l = Math.hypot(dx, dy) || 1; return [dy/l*sg, -dx/l*sg]; };   // 往外的单位法线
  for (let i = 0; i < n; i++){
    const p = C[(i - 1 + n) % n], c = C[i], q = C[(i + 1) % n];
    const n1 = rn(p, c), n2 = rn(c, q); let b = [n1[0] + n2[0], n1[1] + n2[1]]; const bl = Math.hypot(b[0], b[1]);
    b = bl < 1e-9 ? n1 : [b[0]/bl, b[1]/bl];
    const k = 1 / Math.max(0.25, b[0]*n1[0] + b[1]*n1[1]);
    out.push([c[0] - b[0]*o*k, c[1] - b[1]*o*k]);
  }
  return out;
}
function dedupe(P, closed){
  const o = [];
  for (const p of P) if (!o.length || Math.hypot(p[0] - o[o.length-1][0], p[1] - o[o.length-1][1]) > 1e-6) o.push(p);
  if (closed && o.length > 1 && Math.hypot(o[0][0] - o[o.length-1][0], o[0][1] - o[o.length-1][1]) <= 1e-6) o.pop();
  return o;
}

/* 物件 → 叶子：[{loops:[[x,y]…], closed:[bool], rule, color:[r,g,b], solid}] */
function leavesOf(art){
  const out = [], A = FX();
  const walk = s => {
    if (!s || s.visible === false || s.clipping) return;
    if (s.type === 'group'){ (s.children || []).forEach(walk); return; }
    const gm = A.geomOf(s); if (!gm) return;
    const fillC = rgbOf(s.fill), strokeC = (painted(s.stroke) && (s.strokeWidth || 0) > 0) ? rgbOf(s.stroke) : null;
    const color = fillC || strokeC; if (!color) return;
    const solid = !!fillC;
    const b = A.boundsG(gm.G), size = Math.max(Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0), 1);
    const tol = Math.max(0.15, size / 500);
    const loops = [], closed = [];
    gm.G.forEach(sp => {
      const cl = solid || !!sp.closed;
      const P = dedupe(window.AIObj ? AIObj.flatten(sp, tol) : sp.anchors.map(a => [a.x, a.y]), cl);
      if (P.length >= (cl ? 3 : 2)){ loops.push(P); closed.push(cl); }
    });
    if (loops.length) out.push({loops, closed, rule:gm.rule, color, solid, size});
  };
  walk(art);
  return out;
}
function boundsOfLeaves(L){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  L.forEach(l => l.loops.forEach(P => P.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); })));
  return isFinite(x0) ? {x0, y0, x1, y1} : null;
}

/* ═════════════ 建网格：面 = {loops:[[[x,y,z]…]…], n:[x,y,z]|null（物件空间往外的法线；null＝用叉积）, two:bool（双面）, color, rule} ═════════════ */
function meshExtrude(leaves, q, B){
  const cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1) / 2, faces = [];
  const to3 = (p, z) => [p[0] - cx, cy - p[1], z];
  const d = q.depth, half = d / 2;
  for (const lf of leaves){
    const rule = lf.rule, closedLoops = lf.loops.filter((_, i) => lf.closed[i]);
    if (d < 1e-6){   // 厚度 0＝平面（双面）
      if (closedLoops.length) faces.push({loops:closedLoops.map(P => P.map(p => to3(p, 0))), n:[0, 0, 1], two:true, color:lf.color, rule});
      continue;
    }
    // 环：[{o（往内缩）, z}]，由前到后
    let rings = [{o:0, z:half}, {o:0, z:-half}];
    if (q.cap && q.bevel !== 'none' && BEVELS[q.bevel] && closedLoops.length){
      const h = Math.min(q.bevelHeight, half), prof = BEVELS[q.bevel];
      const off = u => q.bevelExtent === 'out' ? -(1 - u) * h : u * h;
      const front = prof.map(([t, u]) => ({o:off(u), z:half - t*h})), back = prof.slice().reverse().map(([t, u]) => ({o:off(u), z:-half + t*h}));
      rings = front.concat(back).filter((r, i, a) => i === 0 || Math.abs(r.o - a[i-1].o) > 1e-6 || Math.abs(r.z - a[i-1].z) > 1e-6);
    }
    lf.loops.forEach((P, li) => {
      const cl = lf.closed[li];
      const sg = cl ? outwardSign(P, closedLoops, rule, lf.size) : 1;
      const R = rings.map(r => (cl ? offsetLoop(P, sg, r.o) : P).map(p => to3(p, r.z)));
      const n = P.length, segs = cl ? n : n - 1;
      for (let k = 0; k + 1 < R.length; k++){
        for (let i = 0; i < segs; i++){
          const j = (i + 1) % n, A = R[k][i], Bp = R[k][j], C = R[k+1][j], D = R[k+1][i];
          const nn = v3.cross(v3.sub(Bp, A), v3.sub(D, A)), nn2 = v3.cross(v3.sub(D, C), v3.sub(Bp, C)), N = v3.add(nn, nn2);
          if (v3.len(N) < 1e-9) continue;
          let nv = v3.norm(N);
          if (cl){
            // 往外：画面右法线 × sg（换成 y 朝上），再按环在前半／后半给一点 z
            const dx = P[j][0] - P[i][0], dy = P[j][1] - P[i][1], l = Math.hypot(dx, dy) || 1, zm = (rings[k].z + rings[k+1].z) / 2;
            const ref = [dy/l*sg, dx/l*sg, zm > 0 ? 0.5 : zm < 0 ? -0.5 : 0];
            if (v3.dot(nv, ref) < 0) nv = v3.mul(nv, -1);
          }
          faces.push({loops:[[A, Bp, C, D]], n:nv, two:!cl, color:lf.color, rule:'nonzero'});
        }
      }
    });
    if (q.cap && closedLoops.length){
      const r0 = rings[0], r1 = rings[rings.length - 1];
      const cap = (r, nz) => ({loops:lf.loops.map((P, li) => lf.closed[li] ? offsetLoop(P, outwardSign(P, closedLoops, rule, lf.size), r.o).map(p => to3(p, r.z)) : null).filter(Boolean), n:[0, 0, nz], two:false, color:lf.color, rule});
      faces.push(cap(r0, 1), cap(r1, -1));
    }
  }
  return {faces, origin:[cx, cy]};
}
function meshRevolve(leaves, q, B){
  const right = q.offsetFrom === 'right', ax = right ? B.x1 + q.offset : B.x0 - q.offset, cy = (B.y0 + B.y1) / 2, sx = right ? -1 : 1, faces = [];
  const ang = q.angle * Math.PI / 180, steps = Math.max(2, Math.ceil(q.angle / 7.5)), full = q.angle >= 360 - 1e-9;
  const at = (p, a) => { const r = Math.abs(p[0] - ax); return [sx * r * Math.cos(a), cy - p[1], -r * Math.sin(a)]; };
  for (const lf of leaves){
    lf.loops.forEach((P, li) => {
      const cl = lf.closed[li], n = P.length, segs = cl ? n : n - 1;
      const ring = s => P.map(p => at(p, ang * s / steps));
      const R = []; for (let s = 0; s <= steps; s++) R.push(ring(s));
      for (let s = 0; s < steps; s++){
        for (let i = 0; i < segs; i++){
          const j = (i + 1) % n, A = R[s][i], Bp = R[s][j], C = R[s+1][j], D = R[s+1][i];
          const N = v3.add(v3.cross(v3.sub(Bp, A), v3.sub(D, A)), v3.cross(v3.sub(D, C), v3.sub(Bp, C)));
          if (v3.len(N) < 1e-9) continue;
          faces.push({loops:[[A, Bp, C, D]], n:v3.norm(N), two:true, color:lf.color, rule:'nonzero'});
        }
      }
      if (cl && q.cap && !full){
        faces.push({loops:[R[0]], n:null, two:true, color:lf.color, rule:'nonzero'}, {loops:[R[steps]], n:null, two:true, color:lf.color, rule:'nonzero'});
      }
    });
  }
  return {faces, origin:[ax, cy]};
}
function meshRotate(leaves, q, B){
  const cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1) / 2, faces = [];
  for (const lf of leaves){
    const cl = lf.loops.filter((_, i) => lf.closed[i]);
    if (cl.length) faces.push({loops:cl.map(P => P.map(p => [p[0] - cx, cy - p[1], 0])), n:[0, 0, 1], two:true, color:lf.color, rule:lf.rule});
    lf.loops.forEach((P, i) => { if (!lf.closed[i]) faces.push({loops:[P.map(p => [p[0] - cx, cy - p[1], 0])], n:[0, 0, 1], two:true, color:lf.color, rule:'nonzero', open:true}); });
  }
  return {faces, origin:[cx, cy]};
}

/* ═════════════ 投影＋着色 → 2D 形状 ═════════════ */
function render(kind, q, leaves, idf){
  const B = boundsOfLeaves(leaves); if (!B) return [];
  const mesh = kind === '3d.revolve' ? meshRevolve(leaves, q, B) : kind === '3d.rotate' ? meshRotate(leaves, q, B) : meshExtrude(leaves, q, B);
  const M = rotMatrix(q.rotX, q.rotY, q.rotZ);
  let Rb = 1; mesh.faces.forEach(f => f.loops.forEach(L => L.forEach(p => { Rb = Math.max(Rb, v3.len(p)); })));
  const fov = q.perspective * Math.PI / 180, cam = fov > 1e-6 ? Rb + Rb / Math.tan(fov / 2) : Infinity;
  const [ox, oy] = mesh.origin;
  const proj = p => { const k = isFinite(cam) ? cam / Math.max(cam - p[2], 1e-3) : 1; return [ox + p[0]*k, oy - p[1]*k]; };
  const lx = q.lightX, ly = q.lightY, lz = Math.sqrt(Math.max(0, 1 - lx*lx - ly*ly)), Lv = v3.norm([lx, ly, lz || 1e-3]);
  const Hv = v3.norm(v3.add(Lv, [0, 0, 1])), shade = rgbOf(q.shadingColor) || [0, 0, 0];
  const amb = q.ambient / 100, inten = q.lightIntensity / 100, hi = q.highlightIntensity / 100, ex = 4 + (100 - q.highlightSize);
  const wire = q.surface === 'wireframe', cull = kind === '3d.extrudeBevel' && !wire && !q.drawHiddenFaces;
  const out = [];
  for (const f of mesh.faces){
    const L3 = f.loops.map(L => L.map(p => apply3(M, p)));
    let n = f.n ? apply3(M, f.n) : null;
    if (!n){ const P = L3[0]; let N = [0, 0, 0]; for (let i = 0; i < P.length; i++){ const a = P[i], b = P[(i + 1) % P.length]; N = v3.add(N, [(a[1]-b[1])*(a[2]+b[2]), (a[2]-b[2])*(a[0]+b[0]), (a[0]-b[0])*(a[1]+b[1])]); } n = v3.norm(N); }
    let zs = 0, cnt = 0; L3[0].forEach(p => { zs += p[2]; cnt++; });
    const cz = zs / Math.max(cnt, 1), c0 = L3[0][0];
    const view = isFinite(cam) ? v3.norm(v3.sub([0, 0, cam], [L3[0].reduce((s, p) => s + p[0], 0)/cnt, L3[0].reduce((s, p) => s + p[1], 0)/cnt, cz])) : [0, 0, 1];
    let facing = v3.dot(n, view);
    if (cull && !f.two && facing < -1e-6) continue;
    if (f.two && facing < 0){ n = v3.mul(n, -1); facing = -facing; }
    let col = f.color;
    if (q.surface === 'diffuse' || q.surface === 'plastic'){
      const dd = Math.max(0, v3.dot(n, Lv)), k = clamp(amb + (1 - amb) * inten * dd, 0, 1);
      col = mix(shade, f.color, k);
      if (q.surface === 'plastic'){ const sp = hi * Math.pow(Math.max(0, v3.dot(n, Hv)), ex); col = mix(col, [255, 255, 255], clamp(sp, 0, 1)); }
    }
    const P2 = L3.map(L => L.map(proj));
    out.push({P2, z:cz, color:hex(col), rule:f.rule, open:!!f.open});
    void c0;
  }
  if (!wire) out.sort((a, b) => a.z - b.z);                   // 画家演算法：远的先画
  return out.map((f, i) => {
    const anchors = P => P.map(p => ({x:p[0], y:p[1], in:null, out:null}));
    const base = wire ? {fill:'none', stroke:f.color, strokeWidth:0.5} : f.open ? {fill:'none', stroke:f.color, strokeWidth:1} : {fill:f.color, stroke:f.color, strokeWidth:0.35};   // 细描边同色：盖住相邻面之间的反锯齿缝
    if (f.P2.length > 1) return Object.assign({id:idf('f' + i), type:'compound', rule:f.rule === 'evenodd' ? 'evenodd' : 'nonzero', children:f.P2.map((P, k) => ({id:idf('f' + i + '_' + k), type:'bezier', anchors:anchors(P), closed:true, fill:'none', stroke:'none', strokeWidth:0}))}, base);
    return Object.assign({id:idf('f' + i), type:'bezier', anchors:anchors(f.P2[0]), closed:!f.open}, base);
  });
}

/* 一个带 3D 效果的物件 → 成品编组（堆叠里 3D 前面的效果先求值；后面的效果挂在编组上） */
const first3d = s => (Array.isArray(s.effects) ? s.effects.findIndex(e => e && e.visible !== false && is3dId(e.id)) : -1);
const has3d = s => !!s && s.visible !== false && first3d(s) >= 0;
function buildArt(s, idf){
  const A = FX(), k = first3d(s), e = s.effects[k];
  const pre = s.effects.slice(0, k), post = s.effects.slice(k + 1).filter(x => !(x && is3dId(x.id)));   // 只认第一个 3D（再叠一个 3D 不重算）
  const s0 = clone(s); s0.effects = pre; if (!pre.length) delete s0.effects;
  const art0 = (s0.effects && A.hasFx(s0)) ? A.artOf(s0, x => idf('pre' + x)) : (() => { const b = clone(s0); delete b.effects; return b; })();
  const q = norm(e.id, e.params), leaves = leavesOf(art0);
  const kids = leaves.length ? render(e.id, q, leaves, idf) : [];
  const g = {id:s.id, type:'group', children:kids.length ? kids : [art0]};
  if (s.name) g.name = s.name;
  if (post.length) g.effects = clone(post);
  return g;
}
const cache = new Map();
function cachedArt(s){
  const key = JSON.stringify(s) + '|' + (window.AIObj ? 1 : 0), hit = cache.get(s.id);
  if (hit && hit.key === key) return hit.art;
  const art = buildArt(s, k => s.id + '_3d_' + k);
  if (cache.size > 400) cache.clear();
  cache.set(s.id, {key, art});
  return art;
}

/* ═════════════ 接到渲染：包 ObjRender（engine drawShape／Project.toSVG 都先问它） ═════════════ */
function installHook(){
  const R = window.ObjRender;
  if (!R || R.__ai3d) return;
  R.__ai3d = true;
  const h0 = R.handles, d0 = R.draw, s0 = R.toSVG;
  R.handles = function(s){ return has3d(s) || h0.call(this, s); };
  R.draw = function(ctx, s, S){
    if (has3d(s)){ let a; try { a = cachedArt(s); } catch (er){ console.error('ai.effect.3d', er); const b = clone(s); b.effects = (b.effects || []).filter(x => !is3dId(x.id)); return window.drawShape(ctx, b, S); } return window.drawShape(ctx, a, S); }
    return d0.call(this, ctx, s, S);
  };
  R.toSVG = function(s){ if (has3d(s)) return R.toSVG(cachedArt(s)); return s0.call(this, s); };
}
installHook();
if (window.Doc && !Doc.__ai3dHook){ Doc.__ai3dHook = true; const reset = Doc.reset; Doc.reset = function(){ cache.clear(); return reset.apply(this, arguments); }; }

/* ═════════════ 命令 ═════════════ */
const reg = (id, meta, fn) => CMD.reg(id, Object.assign({i18n:''}, meta), p => fn(p || {}));
const PKEYS = new Set(); IDS.forEach(id => Object.keys(CAT3[id].defaults).forEach(k => PKEYS.add(k)));
function paramsFrom(p){ const o = {}; for (const k of Object.keys(p)) if (PKEYS.has(k)) o[k] = p[k]; return Object.assign(o, (p.params && typeof p.params === 'object') ? p.params : {}); }
function apply3d(id, p){
  const C = 'ai.effect.' + id;
  if (p.params != null && typeof p.params !== 'object') return {ok:false, error:C + ': `params` must be an object'};
  const t = FX().targets(p, C); if (t.err) return t.err;
  const e = {id, params:norm(id, paramsFrom(p)), visible:true};
  t.R.forEach(s => { (s.effects = Array.isArray(s.effects) ? s.effects : []).push(clone(e)); });
  Layer.invalidate(t.L);
  return {ok:true, ids:t.R.map(s => s.id), index:t.R[0].effects.length - 1, params:clone(e.params)};
}
IDS.forEach(id => {
  reg('ai.effect.' + id, {undoable:true, params:`{params?: ${DOCS[id]}（也可平铺写）, ids?: [形状 id…]（缺省＝目前选取）, layerId?} 3D ${CAT3[id].label.replace('…', '')}（原码无·照 AI 2020）：在选中物件的外观效果堆叠最后加一个活的 3D 效果（ai.effect.setParams／remove 可改；对象 ▸ 扩展外观 烘成路径）→ {ok, ids, index, params}`},
    p => apply3d(id, p));
  reg('ai.effect.' + id + '.dialog', {params:`{index?: int（编辑已套用的那个）, params?: {…}（预填）, fresh?: bool（不问编辑／新增）} 开「3D ${CAT3[id].label.replace('…', '')}选项」对话框（勾预览即时看；确定＝ai.effect.${id} 或 ai.effect.setParams）→ {ok, dialog}`},
    p => openDialog(id, p));
});
reg('ai.effect.3d.art', {params:'{id?: 形状 id（缺省＝选取的第一个）, layerId?} 回 3D 效果算出来的 2D 图稿（编组：每面一条路径，已按深度排好、已着色）→ {ok, art, faces, bounds}'}, p => {
  const t = FX().targets(p.id ? Object.assign({}, p, {ids:[p.id]}) : p, 'ai.effect.3d.art'); if (t.err) return t.err;
  const s = t.R[0]; if (!has3d(s)) return {ok:false, error:'ai.effect.3d.art: object has no visible 3D effect'};
  const art = clone(cachedArt(s));
  const b = window.AIObj ? AIObj.shapeBounds(art, q => q, false) : null;
  return {ok:true, art, faces:(art.children || []).length, bounds:b};
});

/* 别的效果命令遇到 3D：改道到这里（不改 ai-effect.js） */
const effOf = p => p && (p.effect || p.id);
CMD.redirects.push((id, p) => {
  if (id === 'ai.effect.apply' && is3dId(effOf(p))) return {undoable:true, run:q => apply3d(effOf(q), Object.assign({}, q, {params:q.params || {}}))};
  if (id === 'ai.effect.dialog' && is3dId(effOf(p))) return {undoable:false, run:q => openDialog(effOf(q), q)};
  if (id === 'ai.effect.applyLast' && window.AiFx && AiFx.last && is3dId(AiFx.last.effect)) return {undoable:true, run:q => apply3d(AiFx.last.effect, Object.assign({}, q, {params:clone(AiFx.last.params)}))};
  if (id === 'ai.effect.last' && window.AiFx && AiFx.last && is3dId(AiFx.last.effect)) return {undoable:false, run:q => openDialog(AiFx.last.effect, Object.assign({}, q, {params:AiFx.last.params, fresh:true}))};
  if (id === 'ai.effect.list') return {undoable:false, run:q => {
    const r = CMD.map['ai.effect.list'].run(q) || {};
    if (Array.isArray(r.catalog)) IDS.forEach(k => r.catalog.push({id:k, label:CAT3[k].label, menu:'3D', params:DOCS[k], defaults:clone(CAT3[k].defaults), raster:false}));
    return r;
  }};
  if (id === 'ai.effect.expandAppearance'){
    let t; try { t = FX().targets(p, id); } catch (e){ return null; }
    if (t.err || !t.R.some(has3d)) return null;
    return {undoable:true, run:q => expand3d(q)};
  }
  return null;
});
/* 扩展外观：3D 烘成路径编组（面＝真路径、新 id），3D 后面的效果留在编组上、再交给原本的扩展外观一起烘 */
function expand3d(p){
  const t = FX().targets(p, 'ai.effect.expandAppearance'); if (t.err) return t.err;
  const S = t.L.data.shapes, done = [];
  for (const s of t.R){
    if (!has3d(s)) continue;
    const g = buildArt(clone(s), () => uid('S'));
    g.id = s.id;
    S[S.indexOf(s)] = g; done.push(s.id);
  }
  const ids = t.R.map(s => s.id);
  let r = null;
  try { r = CMD.map['ai.effect.expandAppearance'].run(Object.assign({}, p, {ids, layerId:t.L.id})); } catch (e){ console.error(e); }
  if (window.VecSel) VecSel.setShapes(t.L.id, ids);
  Layer.invalidate(t.L); cache.clear();
  return {ok:true, ids:Array.from(new Set(done.concat((r && r.ids) || [])))};
}

/* ═════════════ 对话框（借 ai-effect.js 的 AiFx.Dlg） ═════════════ */
const PRESET_OPTS = ['front', 'back', 'left', 'right', 'top', 'bottom', 'offAxisFront', 'offAxisBack', 'offAxisLeft', 'offAxisRight', 'offAxisTop', 'offAxisBottom',
  'isometricLeft', 'isometricRight', 'isometricTop', 'isometricBottom', 'custom'].map(k => [k, 'ai3d.pos.' + k]);
const BEVEL_OPTS = [['none', 'ai3d.bevel.none']].concat(Object.keys(BEVELS).map(k => [k, 'ai3d.bevel.' + k]));
const TITLE = {'3d.extrudeBevel':'ai3d.title.extrude', '3d.revolve':'ai3d.title.revolve', '3d.rotate':'ai3d.title.rotate'};
function fieldsFor(id, v){
  const F = [{label:'ai3d.h.position', type:'head'},
    {key:'position', label:'ai3d.position', type:'select', value:v.position, options:PRESET_OPTS},
    {key:'rotX', label:'ai3d.rotX', type:'number', value:v.rotX}, {key:'rotY', label:'ai3d.rotY', type:'number', value:v.rotY}, {key:'rotZ', label:'ai3d.rotZ', type:'number', value:v.rotZ},
    {key:'perspective', label:'ai3d.perspective', type:'number', value:v.perspective}];
  if (id === '3d.extrudeBevel') F.push({label:'ai3d.h.extrude', type:'head'},
    {key:'depth', label:'ai3d.depth', type:'number', value:v.depth},
    {key:'bevel', label:'ai3d.bevel', type:'select', value:v.bevel, options:BEVEL_OPTS},
    {key:'bevelHeight', label:'ai3d.bevelHeight', type:'number', value:v.bevelHeight},
    {key:'bevelExtent', label:'ai3d.bevelExtent', type:'select', value:v.bevelExtent, options:[['out', 'ai3d.extent.out'], ['in', 'ai3d.extent.in']]},
    {key:'cap', label:'ai3d.cap', type:'check', value:v.cap});
  if (id === '3d.revolve') F.push({label:'ai3d.h.revolve', type:'head'},
    {key:'angle', label:'ai3d.angle', type:'number', value:v.angle},
    {key:'offset', label:'ai3d.offset', type:'number', value:v.offset},
    {key:'offsetFrom', label:'ai3d.offsetFrom', type:'select', value:v.offsetFrom, options:[['left', 'ai3d.from.left'], ['right', 'ai3d.from.right']]},
    {key:'cap', label:'ai3d.cap', type:'check', value:v.cap});
  F.push({label:'ai3d.h.surface', type:'head'},
    {key:'surface', label:'ai3d.surface', type:'select', value:v.surface, options:SURFACES[id].map(k => [k, 'ai3d.surf.' + k])},
    {key:'lightX', label:'ai3d.lightX', type:'number', value:v.lightX}, {key:'lightY', label:'ai3d.lightY', type:'number', value:v.lightY},
    {key:'lightIntensity', label:'ai3d.lightIntensity', type:'number', value:v.lightIntensity}, {key:'ambient', label:'ai3d.ambient', type:'number', value:v.ambient});
  if (id !== '3d.rotate') F.push({key:'highlightIntensity', label:'ai3d.highlightIntensity', type:'number', value:v.highlightIntensity}, {key:'highlightSize', label:'ai3d.highlightSize', type:'number', value:v.highlightSize});
  F.push({key:'blendSteps', label:'ai3d.blendSteps', type:'number', value:v.blendSteps}, {key:'shadingColor', label:'ai3d.shadingColor', type:'color', value:v.shadingColor});
  if (id !== '3d.rotate') F.push({key:'drawHiddenFaces', label:'ai3d.drawHidden', type:'check', value:v.drawHiddenFaces});
  return F;
}
function openDialog(id, o){
  o = o || {};
  if (!is3dId(id)) return {ok:false, error:'ai.effect.3d.dialog: unknown effect `' + id + '`'};
  const A = FX(), t = A.targets(o, 'ai.effect.dialog'); if (t.err) return t.err;
  const first = t.R[0], applied = Array.isArray(first.effects) ? first.effects : [];
  let index = Number.isInteger(o.index) ? o.index : null;
  if (index !== null && (!applied[index] || applied[index].id !== id)) return {ok:false, error:`ai.effect.dialog: effect ${index} is not \`${id}\``};
  if (index === null && !o.fresh){
    const k = applied.map(e => e && e.id).lastIndexOf(id);
    if (k >= 0){      // 同 AI：已套过同一个效果 ⇒ 先问「编辑／新增」
      A.Dlg.open({kind:'effectExists', title:T('aifx.exists').replace('{name}', T(TITLE[id])), msg:T('aifx.existsMsg'), fields:[], okLabel:'aifx.edit', altLabel:'aifx.addNew',
        onOk:() => { setTimeout(() => openDialog(id, Object.assign({}, o, {index:k})), 0); return {ok:true}; },
        onAlt:() => { setTimeout(() => openDialog(id, Object.assign({}, o, {fresh:true})), 0); return {ok:true}; }});
      return {ok:true, dialog:'effectExists', pending:'effectExists'};
    }
  }
  const vals = index !== null ? norm(id, applied[index].params) : norm(id, o.params || null);
  const snap = t.R.map(s => (Array.isArray(s.effects) ? clone(s.effects) : null));
  const restore = () => { t.R.forEach((s, i) => { if (snap[i]) s.effects = clone(snap[i]); else delete s.effects; }); Layer.invalidate(t.L); };
  const toParams = v => { const q = {}; Object.keys(CAT3[id].defaults).forEach(k => { if (v[k] !== undefined) q[k] = v[k]; }); return norm(id, q); };
  const setField = (k, val) => { const el = document.querySelector(`#aiFxDialog [name="${k}"]`); if (el) el.value = String(val); };
  const preview = (v, key) => {
    // 选位置预设 ⇒ 角度栏填预设值；改角度 ⇒ 位置变「自定旋转」
    if (key === 'position' && PRESETS[v.position]){ const [x, y, z] = PRESETS[v.position]; setField('rotX', x); setField('rotY', y); setField('rotZ', z); v.rotX = x; v.rotY = y; v.rotZ = z; }
    else if (key === 'rotX' || key === 'rotY' || key === 'rotZ'){ setField('position', 'custom'); v.position = 'custom'; }
    restore();
    if (v.preview === false){ if (window.UI) UI.draw(); return; }
    const params = toParams(v);
    t.R.forEach(s => {
      if (index !== null){ if (s.effects && s.effects[index] && s.effects[index].id === id) s.effects[index].params = params; }
      else (s.effects = s.effects || []).push({id, params, visible:true});
    });
    Layer.invalidate(t.L); if (window.UI) UI.draw();
  };
  const bg = A.Dlg.open({kind:'3d', title:T(TITLE[id]), fields:fieldsFor(id, vals), preview:true, onChange:preview, onCancel:restore,
    onOk:v => {
      restore();
      const params = toParams(v), ids = t.R.map(s => s.id);
      if (index !== null) return CMD.run('ai.effect.setParams', {index, params, ids, layerId:t.L.id});
      const r = CMD.run('ai.effect.' + id, {params, ids, layerId:t.L.id});
      if (r && r.ok !== false) A.last = {effect:id, params:clone(params)};     // 应用上一个效果／上一个效果… 用得到
      return r;
    }});
  if (bg){ bg.dataset.effect = id; const box = bg.querySelector('.box'); if (box){ box.style.maxHeight = '86vh'; box.style.overflowY = 'auto'; } }
  return {ok:true, dialog:'3d', effect:id, index};
}

/* ═════════════ 三语（照 AI 2020 繁／简中 3D 对话框用语） ═════════════ */
const STR = {'zh-Hant':{}, 'zh-Hans':{}, en:{}};
const L3 = (k, a, b, c) => { STR['zh-Hant'][k] = a; STR['zh-Hans'][k] = b; STR.en[k] = c; };
[['ai3d.title.extrude', '3D 突出與斜角選項', '3D 凸出和斜角选项', '3D Extrude & Bevel Options'], ['ai3d.title.revolve', '3D 迴轉選項', '3D 绕转选项', '3D Revolve Options'],
 ['ai3d.title.rotate', '3D 旋轉選項', '3D 旋转选项', '3D Rotate Options'],
 ['ai3d.h.position', '位置', '位置', 'Position'], ['ai3d.position', '位置', '位置', 'Position'],
 ['ai3d.rotX', '指定繞 X 軸旋轉 (°)', '指定绕 X 轴旋转 (°)', 'Rotate around X axis (°)'], ['ai3d.rotY', '指定繞 Y 軸旋轉 (°)', '指定绕 Y 轴旋转 (°)', 'Rotate around Y axis (°)'],
 ['ai3d.rotZ', '指定繞 Z 軸旋轉 (°)', '指定绕 Z 轴旋转 (°)', 'Rotate around Z axis (°)'], ['ai3d.perspective', '透視 (°)', '透视 (°)', 'Perspective (°)'],
 ['ai3d.h.extrude', '突出與斜角', '凸出与斜角', 'Extrude & Bevel'], ['ai3d.depth', '突出深度 (pt)', '凸出厚度 (pt)', 'Extrude Depth (pt)'],
 ['ai3d.cap', '端點：開啟端點以建立實心外觀', '端点：开启端点以建立实心外观', 'Cap: turn cap on for solid appearance'],
 ['ai3d.bevel', '斜角', '斜角', 'Bevel'], ['ai3d.bevelHeight', '高度 (pt)', '高度 (pt)', 'Height (pt)'], ['ai3d.bevelExtent', '斜角方式', '斜角方式', 'Bevel Extent'],
 ['ai3d.extent.out', '斜角外擴至原始物件', '斜角外扩至原始对象', 'Bevel Extent Out'], ['ai3d.extent.in', '斜角內縮至原始物件', '斜角内缩至原始对象', 'Bevel Extent In'],
 ['ai3d.h.revolve', '迴轉', '绕转', 'Revolve'], ['ai3d.angle', '角度 (°)', '角度 (°)', 'Angle (°)'], ['ai3d.offset', '位移 (pt)', '位移 (pt)', 'Offset (pt)'],
 ['ai3d.offsetFrom', '自', '自', 'from'], ['ai3d.from.left', '左邊', '左边', 'Left Edge'], ['ai3d.from.right', '右邊', '右边', 'Right Edge'],
 ['ai3d.h.surface', '表面', '表面', 'Surface'], ['ai3d.surface', '表面', '表面', 'Surface'],
 ['ai3d.surf.wireframe', '線框', '线框', 'Wireframe'], ['ai3d.surf.none', '無網底', '无底纹', 'No Shading'], ['ai3d.surf.diffuse', '漫射網底', '扩散底纹', 'Diffuse Shading'], ['ai3d.surf.plastic', '塑膠網底', '塑料效果底纹', 'Plastic Shading'],
 ['ai3d.lightX', '光源位置 水平 (-1..1)', '光源位置 水平 (-1..1)', 'Light Position X (-1..1)'], ['ai3d.lightY', '光源位置 垂直 (-1..1)', '光源位置 垂直 (-1..1)', 'Light Position Y (-1..1)'],
 ['ai3d.lightIntensity', '光源強度 (%)', '光源强度 (%)', 'Light Intensity (%)'], ['ai3d.ambient', '環境光 (%)', '环境光 (%)', 'Ambient Light (%)'],
 ['ai3d.highlightIntensity', '亮部強度 (%)', '高光强度 (%)', 'Highlight Intensity (%)'], ['ai3d.highlightSize', '亮部尺寸 (%)', '高光大小 (%)', 'Highlight Size (%)'],
 ['ai3d.blendSteps', '漸變階數', '混合步骤', 'Blend Steps'], ['ai3d.shadingColor', '網底顏色', '底纹颜色', 'Shading Color'], ['ai3d.drawHidden', '繪製隱藏表面', '绘制隐藏表面', 'Draw Hidden Faces'],
 ['ai3d.pos.front', '前', '前方', 'Front'], ['ai3d.pos.back', '後', '后方', 'Back'], ['ai3d.pos.left', '左', '左方', 'Left'], ['ai3d.pos.right', '右', '右方', 'Right'],
 ['ai3d.pos.top', '上', '上方', 'Top'], ['ai3d.pos.bottom', '下', '下方', 'Bottom'],
 ['ai3d.pos.offAxisFront', '離軸 - 前', '离轴 - 前方', 'Off-Axis Front'], ['ai3d.pos.offAxisBack', '離軸 - 後', '离轴 - 后方', 'Off-Axis Back'],
 ['ai3d.pos.offAxisLeft', '離軸 - 左', '离轴 - 左方', 'Off-Axis Left'], ['ai3d.pos.offAxisRight', '離軸 - 右', '离轴 - 右方', 'Off-Axis Right'],
 ['ai3d.pos.offAxisTop', '離軸 - 上', '离轴 - 上方', 'Off-Axis Top'], ['ai3d.pos.offAxisBottom', '離軸 - 下', '离轴 - 下方', 'Off-Axis Bottom'],
 ['ai3d.pos.isometricLeft', '等角 - 左', '等角 - 左方', 'Isometric Left'], ['ai3d.pos.isometricRight', '等角 - 右', '等角 - 右方', 'Isometric Right'],
 ['ai3d.pos.isometricTop', '等角 - 上', '等角 - 上方', 'Isometric Top'], ['ai3d.pos.isometricBottom', '等角 - 下', '等角 - 下方', 'Isometric Bottom'], ['ai3d.pos.custom', '自訂旋轉', '自定旋转', 'Custom Rotation'],
 ['ai3d.bevel.none', '無', '无', 'None'], ['ai3d.bevel.classic', '經典', '经典', 'Classic'], ['ai3d.bevel.complex1', '複雜 1', '复杂 1', 'Complex 1'], ['ai3d.bevel.complex2', '複雜 2', '复杂 2', 'Complex 2'],
 ['ai3d.bevel.concave', '凹面', '凹入', 'Concave'], ['ai3d.bevel.conical', '圓錐', '圆锥', 'Conical'], ['ai3d.bevel.cove', '凹槽', '凹槽', 'Cove'], ['ai3d.bevel.frame', '框架', '框架', 'Frame'],
 ['ai3d.bevel.jumping', '跳躍', '跳跃', 'Jumping'], ['ai3d.bevel.pointed', '尖頭', '尖头', 'Pointed'], ['ai3d.bevel.rolling', '滾動', '滚动', 'Rolling'], ['ai3d.bevel.round', '圓形', '圆形', 'Round'],
 ['ai3d.bevel.tiered', '階梯', '阶梯', 'Tiered']
].forEach(r => L3(...r));
if (window.Lang) Lang.add(STR);

window.Ai3D = {CAT:CAT3, PRESETS, BEVELS, norm, merged, buildArt, cachedArt, has3d, openDialog, apply:apply3d, installHook};
if (window.UI && UI.draw) UI.draw();
})();
