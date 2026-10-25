/* 堤麟画板 · 旋转工具（R）—— 照 ArtCraft VectorCraft 原码逐段翻译
   主体：vectorcraft/crates/tools/src/xform/transform.rs（TransformTool，TransformKind::Rotate 那一支）
   命令正文：engine/src/cmd/object.rs（object.transform／object.rotate／object.transformAgain、apply_transform、origin_of、about）
             engine/src/cmd/edit.rs（selected_roots 按绘制顺序、duplicate_in：复制品插在原物件正上方、选取换成复制品）
             doc/src/node.rs（Node::transform_scaled：路径锚点与把手全套矩阵、活形状只改 xf、Scaling::factor）
             geom/src/path.rs:135（Anchor::transform：p、h_in、h_out 三点都乘矩阵，kind 不变）
             doc/src/orient.rs（bbox_angle／transformed_angle／oriented_bounds：转过的物件外框跟着转）
   几何：    tools/src/bbox.rs:95 rotate_for_drag（绕参考点由按下点转到游标；Shift 锁 45°）
             tools/src/guides.rs:176 snap_pick（点下的参考点吸到选中物件或游标下物件的锚点／中心，容差 5 屏幕像素）
             tools/src/xform.rs:48-60（CYAN、target_overlays：参考点靶心＝圆＋十字）
             tools/src/select.rs:51-66（matrix_json、selection_bounds、selection_box）
   对话框：  ui-egui/src/dialogs/tools.rs:35-49（rotate 预设 angle 0，并入工具给的 origin）、dialogs/transform.rs（Angle＋Copy；确定＝object.rotate {angle, copy, origin}）
   提示：    ui-egui/src/chrome.rs:467-474
   行为（transform.rs:165-283）：
     没选东西：按下什么都不做、游标＝禁止（Cursor::NotAllowed）
     按下：Alt ＝ 参考点设在点下处（吸附后）并开数值对话框；否则记下参考点（自订的或选取外框中心）
     拖：离按下点 tol(3) 才开始（Begin）；之后每一下 Preview object.transform {matrix, copy:Alt}；Shift ＝ 角度锁 45° 倍数
     放开：拖过 ⇒ 用放开那一刻的 Alt 决定是否复制，Commit（一步历史）；没拖 ⇒ 这一下＝设参考点（吸附后），绑定当时的选取
     双击／Enter ＝ 开数值对话框；拖时 Esc ＝ 取消；换工具时拖到一半 ＝ 取消
     停着不按：游标靠近选中物件或游标下物件的锚点／中心 ⇒ 洋红标签「anchor」「center」
   坐标：Pointer 给文件坐标；矩阵一律是文件坐标的矩阵；形状存图层坐标 ⇒ 套之前把矩阵换成图层坐标（T(-L)·M·T(L)）。 */

const ROT_CYAN = '#00a8ff', ROT_MAGENTA = '#ff3dfc';

/* ───────── 仿射矩阵（kurbo Affine：[a,b,c,d,e,f]，x' = a·x + c·y + e，y' = b·x + d·y + f）───────── */
const RotAff = {
  I: [1, 0, 0, 1, 0, 0],
  mul(m, n){            // m * n（先 n 后 m）
    return [m[0]*n[0] + m[2]*n[1], m[1]*n[0] + m[3]*n[1], m[0]*n[2] + m[2]*n[3], m[1]*n[2] + m[3]*n[3],
            m[0]*n[4] + m[2]*n[5] + m[4], m[1]*n[4] + m[3]*n[5] + m[5]];
  },
  translate(x, y){ return [1, 0, 0, 1, x, y]; },
  rotate(th){ const c = Math.cos(th), s = Math.sin(th); return [c, s, -s, c, 0, 0]; },     // kurbo Affine::rotate
  apply(m, p){ return [m[0]*p[0] + m[2]*p[1] + m[4], m[1]*p[0] + m[3]*p[1] + m[5]]; },
  det(m){ return m[0]*m[3] - m[1]*m[2]; },
  inverse(m){
    const d = this.det(m), ia = m[3]/d, ib = -m[1]/d, ic = -m[2]/d, id = m[0]/d;
    return [ia, ib, ic, id, -(ia*m[4] + ic*m[5]), -(ib*m[4] + id*m[5])];
  },
  /* object.rs:252 about(o, a) ＝ T(o) · a · T(−o) */
  about(o, a){ return this.mul(this.translate(o[0], o[1]), this.mul(a, this.translate(-o[0], -o[1]))); },
  /* node.rs:182 Scaling::factor：平均缩放 √|det|，不是 1 才算 */
  factor(m){ const k = Math.sqrt(Math.abs(this.det(m))); return Math.abs(k - 1) > 1e-9 ? k : null; },
  finite(m){ return Array.isArray(m) && m.length === 6 && m.every(v => typeof v === 'number' && isFinite(v)); }
};

/* geom/lib.rs:36 normalize_deg → (-180, 180] */
function rotNormDeg(a){ a %= 360; if (a <= -180) a += 360; else if (a > 180) a -= 360; return a; }

/* orient.rs:56-85 transformed_angle：物件自己的轴在套了 a 之后的角度（逆时针度）；镜像时取离旧角度近的那个 */
function rotTransformedAngle(angle, a){
  const [m0, m1, m2, m3] = a;
  if (m0 === 1 && m1 === 0 && m2 === 0 && m3 === 1) return angle;
  const r = -angle * Math.PI / 180, s = Math.sin(r), c = Math.cos(r);
  const v = [m0*c + m2*s, m1*c + m3*s], len = Math.hypot(v[0], v[1]);
  if (!isFinite(len) || len <= 1e-12) return angle;
  let out = rotNormDeg(-Math.atan2(v[1], v[0]) * 180 / Math.PI);
  const dist = x => Math.abs(rotNormDeg(x - angle)), EPS = 1e-6;
  if (RotAff.det(a) < 0){
    const alt = rotNormDeg(out + 180), d0 = dist(out), d1 = dist(alt);
    if (d1 < d0 - EPS || (Math.abs(d1 - d0) <= EPS && Math.abs(alt) < Math.abs(out))) out = alt;
  }
  if (dist(out) <= EPS) return angle;
  if (Math.abs(out) <= EPS) return 0;
  return out;
}

/* ───────── 几何：外框（kurbo BezPath::bounding_box ＝ 曲线的紧外框，不是控制点外框）───────── */
/* 一维三次贝兹在 (0,1) 内的极值参数 */
function rotCubicExtrema(p0, p1, p2, p3){
  const a = -p0 + 3*p1 - 3*p2 + p3, b = 2*(p0 - 2*p1 + p2), c = p1 - p0, out = [];
  if (Math.abs(a) < 1e-12){ if (Math.abs(b) > 1e-12){ const t = -c / b; if (t > 0 && t < 1) out.push(t); } return out; }
  const D = b*b - 4*a*c; if (D < 0) return out;
  const q = Math.sqrt(D);
  [(-b + q) / (2*a), (-b - q) / (2*a)].forEach(t => { if (t > 0 && t < 1) out.push(t); });
  return out;
}
/* 一个形状的几何（asBezier 视图），每个点先过 f（图层坐标 → 想要的坐标系）→ {anchors:[[x,y]…], segs:[{p0,c1,c2,p3}…]} */
function rotShapeGeo(s, f){
  const v = VecSel.asBezier(s); if (!v || !v.anchors || !v.anchors.length) return null;
  const anchors = v.anchors.map(a => f([a.x, a.y]));
  const segs = VecSel.segments(v).map(c => ({p0:f(c.p0), c1:f(c.c1), c2:f(c.c2), p3:f(c.p3)}));
  return {anchors, segs};
}
/* path.rs:366-379 PathData::bounds：只有一个锚点＝那一点；否则 bezpath 紧外框 → {x0,y0,x1,y1} */
function rotGeoBounds(g){
  if (!g) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = p => { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; };
  g.anchors.forEach(add);
  for (const c of g.segs){
    add(c.p0); add(c.p3);
    for (const k of [0, 1]) rotCubicExtrema(c.p0[k], c.c1[k], c.c2[k], c.p3[k]).forEach(t => add(VecSel.evalCubic(c, t)));
  }
  return isFinite(x0) ? {x0, y0, x1, y1} : null;
}
function rotUnion(a, b){ return !a ? b : !b ? a : {x0:Math.min(a.x0, b.x0), y0:Math.min(a.y0, b.y0), x1:Math.max(a.x1, b.x1), y1:Math.max(a.y1, b.y1)}; }
function rotCenter(r){ return [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2]; }
/* 形状的几何外框（文件坐标） */
function rotShapeBounds(L, s, m){
  const f = m ? (p => RotAff.apply(m, [p[0] + L.x, p[1] + L.y])) : (p => [p[0] + L.x, p[1] + L.y]);
  return rotGeoBounds(rotShapeGeo(s, f));
}

/* ───────── 选取（selected_roots：选中的物件、按绘制顺序）───────── */
function rotLayer(p){
  p = p || {};
  const L = p.layerId ? Doc.byId(p.layerId) : (VecSel.layer() || Doc.active());
  return (L && L.kind === 'vector') ? L : null;
}
function rotIds(L, ids){
  const want = ids || ((VecSel.layerId === L.id) ? VecSel.shapes : []);
  return L.data.shapes.filter(s => want.includes(s.id)).map(s => s.id);      // 绘制顺序（edit.rs:155 in_paint_order）
}
/* orient.rs:114-118 bbox_angle：这些物件共有的外框角度，不一致就 0 */
function rotBboxAngle(L, ids){
  const A = ids.map(id => L.data.shapes.find(s => s.id === id)).filter(Boolean).map(s => +s.bboxAngle || 0);
  if (!A.length) return 0;
  return A.every(a => Math.abs(rotNormDeg(a - A[0])) <= 1e-6) ? A[0] : 0;
}
/* lib.rs:849 bounds_of（几何外框联集，文件坐标） */
function rotBoundsOf(L, ids){
  let r = null;
  for (const id of ids){ const s = L.data.shapes.find(x => x.id === id); if (s) r = rotUnion(r, rotShapeBounds(L, s)); }
  return r;
}
/* orient.rs:121-129 oriented_bounds → {angle, rect, center}：角度不是 0 就在转过的框里量，中心再转回页面 */
function rotOrientedBox(L, ids){
  const angle = rotBboxAngle(L, ids);
  if (angle === 0){ const r = rotBoundsOf(L, ids); return r ? {angle:0, rect:r, center:rotCenter(r)} : null; }
  const toDoc = RotAff.rotate(-angle * Math.PI / 180), toLocal = RotAff.inverse(toDoc);
  let r = null;
  for (const id of ids){ const s = L.data.shapes.find(x => x.id === id); if (s) r = rotUnion(r, rotShapeBounds(L, s, toLocal)); }
  return r ? {angle, rect:r, center:RotAff.apply(toDoc, rotCenter(r))} : null;
}

/* ───────── Node::transform_scaled（node.rs:589-678）照我们的形状种类翻 ─────────
   m 是「图层坐标」的矩阵。他们的活形状（矩形／椭圆／多边形）存 xf、只改 xf 就一直是活的；我们的活形状没有 xf：
     平移 ⇒ engine 的 shiftShape（仍是活形状）；
     矩形／椭圆：矩阵把两轴映到两轴（无旋转或 90° 倍数旋转、可含缩放／镜像）⇒ 换算 x,y,w,h 仍是活的（圆角矩形还要两轴缩放相同）；
     星形／多边形：相似变换（旋转＋等比缩放、不镜像）⇒ 中心过矩阵、半径×k、rotation 加上转角，仍是活的；
     其余 ⇒ VecSel.ensureBezier 换成路径（＝他们 path_mut 的 live=None），再把锚点与把手全套乘矩阵（Anchor::transform）。
   折线（path／line）每个点乘矩阵（LiveShape::Line 两端各乘）。 */
function rotTransformShape(L, s, m, sc){
  const k = RotAff.factor(m);
  // node.rs:593-595：物件自己的外框角度跟着转
  const ang = rotTransformedAngle(+s.bboxAngle || 0, m);
  // node.rs:603-610：Scale Strokes & Effects 开着才缩描边
  if (k && sc.strokes && typeof s.strokeWidth === 'number') s.strokeWidth *= k;
  if (window.GradientFill){ GradientFill.transform(s.fill, m); GradientFill.transform(s.stroke, m); }   // 渐变向量跟着转（GradientGeom::transform）
  const ap = p => RotAff.apply(m, p), E = 1e-9;
  const isMove = Math.abs(m[0] - 1) < E && Math.abs(m[1]) < E && Math.abs(m[2]) < E && Math.abs(m[3] - 1) < E;
  if (isMove && s.type !== 'bezier') shiftShape(s, m[4], m[5]);
  else if ((s.type === 'rect' || s.type === 'ellipse') && rotAxisMap(m) && rotRectOk(s, m)){
    const p0 = ap([s.x, s.y]), p1 = ap([s.x + s.w, s.y + s.h]);
    const kx = Math.hypot(m[0], m[1]);
    if (s.type === 'rect' && (s.radius || 0) > 0 && sc.corners) s.radius *= kx;      // Scale Corners 关着＝圆角保持原大小（node.rs:617-622 keep_corners）
    s.x = Math.min(p0[0], p1[0]); s.y = Math.min(p0[1], p1[1]); s.w = Math.abs(p1[0] - p0[0]); s.h = Math.abs(p1[1] - p0[1]);
  } else if ((s.type === 'star' || s.type === 'polygon') && rotSimilar(m)){
    const kk = Math.hypot(m[0], m[1]), c = ap([s.cx, s.cy]);
    s.cx = c[0]; s.cy = c[1];
    if (typeof s.r1 === 'number') s.r1 *= kk;
    if (typeof s.r2 === 'number') s.r2 *= kk;
    let r = (s.rotation || 0) + Math.atan2(m[1], m[0]) * 180 / Math.PI;           // drawShape 的 rotation 是 y 朝下的顺时针度数，跟矩阵转角同向
    r = ((r % 360) + 360) % 360; if (Math.abs(r - 360) < 1e-9 || Math.abs(r) < 1e-9) r = 0;
    s.rotation = r;
  } else if (s.type === 'path' || s.type === 'line'){
    s.points = (s.points || []).map(ap);
  } else {
    if (s.type !== 'bezier' && !VecSel.ensureBezier(L, s)) return false;
    // geom path.rs:386-392 PathData::transform → 每个 Anchor::transform（p、h_in、h_out 都乘；kind 不变）
    s.anchors = (s.anchors || []).map(a => {
      const p = ap([a.x, a.y]);
      return Object.assign({}, a, {x:p[0], y:p[1], in:a.in ? ap(a.in) : null, out:a.out ? ap(a.out) : null});
    });
  }
  if (ang) s.bboxAngle = ang; else delete s.bboxAngle;
  return true;
}
/* 矩阵线性部分把 x 轴映到 x 轴或 y 轴（无旋转、或 90° 倍数旋转；可含缩放与镜像） */
function rotAxisMap(m){ const E = 1e-9; return (Math.abs(m[1]) < E && Math.abs(m[2]) < E) || (Math.abs(m[0]) < E && Math.abs(m[3]) < E); }
/* 圆角矩形要两轴缩放一样，圆角才仍是圆的 */
function rotRectOk(s, m){
  if (s.type !== 'rect' || !((s.radius || 0) > 0)) return true;
  return Math.abs(Math.hypot(m[0], m[1]) - Math.hypot(m[2], m[3])) < 1e-9;
}
/* 相似变换（旋转＋等比缩放，不镜像） */
function rotSimilar(m){ const E = 1e-9; return Math.abs(m[0] - m[3]) < E && Math.abs(m[1] + m[2]) < E && RotAff.det(m) > 0; }
function rotShapeFinite(s){
  const nums = [];
  const push = v => { if (Array.isArray(v)) v.forEach(push); else if (typeof v === 'number') nums.push(v); };
  ['x', 'y', 'w', 'h', 'cx', 'cy', 'r1', 'r2', 'rotation', 'radius', 'strokeWidth'].forEach(k => push(s[k]));
  (s.points && Array.isArray(s.points) ? s.points : []).forEach(push);
  (s.anchors || []).forEach(a => { push(a.x); push(a.y); push(a.in); push(a.out); });
  return nums.every(v => isFinite(v));
}

/* object.rs:207-225 apply_transform：copy ⇒ duplicate_in 先复制（插在原物件正上方、选取换成复制品），再对目标逐个 Node::transform；
   不在预览中 ⇒ 记下 Transform Again（last_transform）。m 是文件坐标的矩阵。 */
function rotApplyTransform(L, ids, m, p){
  const copy = !!p.copy;
  // object.rs:197-203 scaling：strokes／corners 缺省照偏好（engine lib.rs:526-527 两个都是 false）
  const sc = {strokes:p.strokes === undefined ? false : !!p.strokes, corners:p.corners === undefined ? false : !!p.corners};
  let targets = ids;
  if (copy){
    targets = [];
    for (const id of ids){
      const i = L.data.shapes.findIndex(x => x.id === id); if (i < 0) continue;
      const c = JSON.parse(JSON.stringify(L.data.shapes[i])); c.id = uid('S');
      L.data.shapes.splice(i + 1, 0, c); targets.push(c.id);
    }
    VecSel.setShapes(L.id, targets);
  }
  // 文件坐标矩阵 → 图层坐标矩阵：T(−L)·M·T(L)
  const ml = RotAff.mul(RotAff.translate(-L.x, -L.y), RotAff.mul(m, RotAff.translate(L.x, L.y)));
  for (const id of targets){
    const s = L.data.shapes.find(x => x.id === id); if (!s) continue;
    if (!rotTransformShape(L, s, ml, sc)) return {ok:false, error:'cannot transform shape ' + id};
    if (!rotShapeFinite(s)) return {ok:false, error:'transform gives non-finite coordinates'};
  }
  Layer.invalidate(L);
  if (!RotTool.previewing) RotTool.lastTransform = {matrix:m.slice(), copy};
  return {ok:true, ids:targets.slice(), layerId:L.id};
}

/* ───────── 工具本体（transform.rs:68-283）───────── */
const RotTool = {
  origin: null,        // 自订参考点 {p:[x,y], layerId, ids:[…]}（transform.rs:71 origin: Option<(Point, Vec<NodeId>)>）
  drag: null,          // {start, pick, origin, began, last}（transform.rs:57-66 Drag）
  measure: null,       // {p, text}（Overlay::Measure）
  hover: [],           // 吸附回馈 [{p, text}]（"anchor"／"center" 标签）
  snap: true,          // Snap to Point／Smart Guides（ToolContext 预设都开，tools/lib.rs:477-481）
  lastTransform: null, // Transform Again（object.rs:220-223 last_transform）
  previewing: false,
  base: null,          // Begin 时的底稿 {L, shapes, vsel}
  last: null,          // 最后一次 Preview 的命令参数
  _hctx: null,

  selIds(){ const L = VecSel.layer(); return (L && L.kind === 'vector') ? rotIds(L, null) : []; },
  selLayer(){ const L = VecSel.layer(); return (L && L.kind === 'vector' && this.selIds().length) ? L : null; },
  sameIds(a, b){ return a.length === b.length && a.every((x, i) => x === b[i]); },
  /* transform.rs:94-102 reference_point：自订的参考点属于目前的选取就用它；否则选取外框（跟着转过的角度）的中心 */
  referencePoint(){
    VecSel.prune();
    const L = this.selLayer(); if (!L) return null;
    const ids = this.selIds();
    if (this.origin && this.origin.layerId === L.id && ids.length && this.sameIds(this.origin.ids, ids)) return this.origin.p.slice();
    const b = rotOrientedBox(L, ids); return b ? b.center : null;
  },

  /* doc/hit.rs hit_test（容差内描边／轮廓，或在填色里面）：所有看得见的矢量层由上往下、形状由上往下 → {L, s} */
  hitTest(pt, tol){
    const c = this._hctx || (this._hctx = document.createElement('canvas').getContext('2d'));
    for (let li = Doc.layers.length - 1; li >= 0; li--){
      const L = Doc.layers[li]; if (L.kind !== 'vector' || !L.visible) continue;
      const p = [pt[0] - L.x, pt[1] - L.y], S = L.data.shapes;
      for (let k = S.length - 1; k >= 0; k--){
        const s = S[k], v = VecSel.asBezier(s); if (!v || !v.anchors || !v.anchors.length) continue;
        c.beginPath(); bezierPath(c, v, 1);
        const sw = (s.stroke && s.stroke !== 'none') ? (s.strokeWidth || 0) : 0;
        c.lineWidth = sw + 2*tol; c.lineJoin = 'round'; c.lineCap = 'round';
        if (c.isPointInStroke(p[0], p[1])) return {L, s};
        if (s.fill && s.fill !== 'none' && c.isPointInPath(p[0], p[1], 'nonzero')) return {L, s};
      }
    }
    return null;
  },
  /* guides.rs:176-185 snap_pick：选中的物件＋游标下的物件，外框碰到 p±tol 的，收它们的锚点与外框中心；容差内最近的一个 → [点, 标签们] */
  snapPick(pt){
    if (!this.snap) return {p:pt.slice(), ov:[]};
    const tol = VecSel.tol(5);
    const roots = [];
    const SL = this.selLayer();
    if (SL) this.selIds().forEach(id => { const s = SL.data.shapes.find(x => x.id === id); if (s) roots.push({L:SL, s}); });
    const h = this.hitTest(pt, tol); if (h && !roots.some(r => r.s === h.s)) roots.push(h);
    const pts = [];
    for (const {L, s} of roots){
      const g = rotShapeGeo(s, p => [p[0] + L.x, p[1] + L.y]), b = rotGeoBounds(g); if (!b) continue;
      if (b.x0 > pt[0] + tol || b.x1 < pt[0] - tol || b.y0 > pt[1] + tol || b.y1 < pt[1] - tol) continue;   // guides.rs:89
      g.anchors.forEach(q => pts.push({q, kind:'anchor'}));
      pts.push({q:rotCenter(b), kind:'center'});
    }
    // guides.rs:102-105 snap_point：容差内最近的点
    let best = null;
    for (const t of pts){ const d = Math.hypot(t.q[0] - pt[0], t.q[1] - pt[1]); if (d <= tol && (!best || d < best.d)) best = {q:t.q, kind:t.kind, d}; }
    if (best) return {p:best.q.slice(), ov:[{p:best.q.slice(), text:best.kind}]};
    return {p:pt.slice(), ov:[]};
  },

  /* bbox.rs:95-104 rotate_for_drag：a = atan2(to−c) − atan2(from−c)，Shift ＝ 四舍五入到 45° 倍数 → {m, deg}（deg ＝ −a 的度数＝逆时针度） */
  rotateForDrag(c, from, to, snap){
    const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]), a1 = Math.atan2(to[1] - c[1], to[0] - c[0]);
    let a = a1 - a0;
    if (snap){ const step = Math.PI / 4; a = Math.round(a / step) * step; }
    return {m:RotAff.about(c, RotAff.rotate(a)), deg:-a * 180 / Math.PI};
  },
  /* transform.rs:105-110 matrix_for（Rotate）：读数 format!("{:.1}°", -deg) */
  matrixFor(o, start, p, shift){
    const r = this.rotateForDrag(o, start, p, shift);
    return {m:r.m, text:(-r.deg).toFixed(1) + '°', deg:r.deg};
  },

  /* ── Begin／Preview／Commit（tools/lib.rs Action；engine lib.rs:1073 begin_interaction）── */
  begin(){
    const L = VecSel.layer() || Doc.active();
    this.base = {L, shapes:JSON.parse(JSON.stringify(L.data.shapes)), vsel:VecSel.snapshot()};
    this.last = null;
  },
  resetToBase(){
    const b = this.base; if (!b) return;
    b.L.data.shapes = JSON.parse(JSON.stringify(b.shapes)); VecSel.restore(b.vsel); Layer.invalidate(b.L);
  },
  preview(params){
    if (!this.base) return;
    this.resetToBase();
    this.previewing = true;
    try { CMD.map['rotate.transform'].run(params); } catch (err){ console.error(err); }
    finally { this.previewing = false; }
    this.last = params;
    UI.draw();
  },
  commit(params){
    if (this.base) this.resetToBase();
    this.base = null; this.last = null;
    if (params) CMD.run('rotate.transform', params);
  },
  cancel(){ if (this.base) this.resetToBase(); this.base = null; this.last = null; this.drag = null; this.measure = null; },
  busy(){ return !!(this.drag && this.drag.began); },

  /* ── 滑鼠（transform.rs:165-222）── */
  down(e, pt){
    VecSel.prune();
    const L = this.selLayer();
    const ids = this.selIds();
    const bounds = L ? rotBoundsOf(L, ids) : null;                // selection_bounds
    if (!bounds) return;                                          // 没选东西：什么都不做
    this.hover = [];
    const pick = this.snapPick(pt).p;
    if (e.altKey){
      // Alt 按下：参考点设在这里（绑定目前的选取）并开数值对话框
      this.origin = {p:pick, layerId:L.id, ids:ids.slice()};
      this.drag = null;
      this.openDialog(pick);
      return;
    }
    const origin = this.referencePoint() || rotCenter(bounds);
    this.drag = {start:pt.slice(), pick, origin, began:false, last:RotAff.I.slice()};
  },
  move(e, pt){
    const d = this.drag;
    if (!d){
      // PointerKind::Move：没在拖、有选取 ⇒ 吸附回馈
      this.hover = (!VecSel.isEmpty() && this.selLayer()) ? this.snapPick(pt).ov : [];
      return;
    }
    if (!d.began){
      if (Math.hypot(pt[0] - d.start[0], pt[1] - d.start[1]) < VecSel.tol(3)) return;
      d.began = true; this.begin();                               // Action::Begin("Rotate")
    }
    const r = this.matrixFor(d.origin, d.start, pt, !!e.shiftKey);
    d.last = r.m;
    this.measure = {p:pt.slice(), text:r.text};
    this.preview({matrix:r.m, copy:!!e.altKey});                  // Action::Preview("object.transform", {matrix, copy: alt})
  },
  up(e, pt){
    const d = this.drag; this.drag = null;
    if (!d) return;
    this.measure = null;
    if (d.began){
      // 放开那一刻的 Alt 决定是不是复制（transform.rs:201-203）
      this.commit({matrix:d.last, copy:!!e.altKey});
    } else {
      // 点一下＝设参考点（transform.rs:205-207）
      const L = this.selLayer();
      this.origin = L ? {p:d.pick, layerId:L.id, ids:this.selIds()} : null;
    }
  },
  dblClick(){
    this.cancel();
    const o = this.referencePoint();
    if (o) this.openDialog(o);
  },
  key(e){
    if (e.key === 'Escape' && this.busy()){ e.preventDefault(); this.cancel(); return true; }         // transform.rs:226-230
    if (e.key === 'Enter' && !this.drag){
      const o = this.referencePoint(); if (!o) return false;
      e.preventDefault(); this.openDialog(o); return true;                                           // transform.rs:231
    }
    return false;
  },
  /* transform.rs:258-266 cursor：没选取＝禁止；拖着＝旋转游标；其余十字 */
  cursor(){ return this.selLayer() ? (this.busy() ? ROT_CURSOR : 'crosshair') : 'not-allowed'; },
  syncCursor(){ if (window.UI && UI.canvas && ToolState.cur === 'rotate') UI.canvas.style.cursor = this.cursor(); },

  /* ── 数值对话框（dialogs/tools.rs:35-49 → dialogs/transform.rs：Angle、Copy；确定＝object.rotate {angle, copy, origin}）── */
  dialogOpen(){ return !!document.getElementById('rotateDialog'); },
  closeDialog(){ const d = document.getElementById('rotateDialog'); if (d) d.remove(); },
  openDialog(origin){
    this.closeDialog();
    const T = k => Lang.t(k);
    const bg = document.createElement('div');
    bg.id = 'rotateDialog';
    bg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999';
    const box = document.createElement('div');
    box.style.cssText = 'background:#2b2f36;color:#e6e8eb;padding:14px 18px;border-radius:6px;min-width:240px;font:13px sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)';
    const h = document.createElement('div'); h.textContent = T('tool.rotate'); h.style.cssText = 'font-weight:bold;margin-bottom:10px';
    box.appendChild(h);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:auto 110px;gap:8px 10px;align-items:center';
    const l = document.createElement('span'); l.textContent = T('ui.rotAngle'); l.style.color = '#aab0ba';
    const inp = document.createElement('input'); inp.type = 'number'; inp.value = 0; inp.name = 'angle'; inp.step = 'any';
    inp.style.cssText = 'width:100%;box-sizing:border-box;background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:3px 6px';
    grid.appendChild(l); grid.appendChild(inp);
    box.appendChild(grid);
    const cl = document.createElement('label'); cl.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:10px';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.name = 'copy';
    const ct = document.createElement('span'); ct.textContent = T('ui.rotCopy');
    cl.appendChild(cb); cl.appendChild(ct); box.appendChild(cl);
    const row = document.createElement('div'); row.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px';
    const bNo = document.createElement('button'); bNo.textContent = T('ui.rotCancel'); bNo.dataset.act = 'cancel';
    const bOk = document.createElement('button'); bOk.textContent = T('ui.rotOk'); bOk.dataset.act = 'ok';
    row.appendChild(bNo); row.appendChild(bOk); box.appendChild(row);
    bg.appendChild(box); document.body.appendChild(bg);
    const o = origin ? origin.slice() : null;
    const ok = () => {
      const v = parseFloat(inp.value), angle = isFinite(v) ? v : 0;          // Dialog::f64("angle", 0)
      const copy = cb.checked;
      this.closeDialog();
      const p = {angle, copy}; if (o) p.origin = o;
      try { CMD.run('rotate.apply', p); } catch (err){ console.error(err); }
      UI.draw();
    };
    const no = () => { this.closeDialog(); UI.draw(); };
    bOk.onclick = ok; bNo.onclick = no;
    bg.addEventListener('pointerdown', e => { if (e.target === bg) no(); });
    bg.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter'){ e.preventDefault(); ok(); }
      else if (e.key === 'Escape'){ e.preventDefault(); no(); }
    });
    // Alt＋按下时开的：按下的预设动作（把焦点移走）还没跑完，晚一拍再聚焦
    inp.focus(); inp.select();
    setTimeout(() => { if (document.getElementById('rotateDialog') === bg){ inp.focus(); inp.select(); } }, 0);
  }
};
window.RotTool = RotTool;

/* transform.rs 的 Cursor::Rotate：弯箭头 */
const ROT_CURSOR = 'url("data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22'><g fill='none' stroke-linecap='round' stroke-linejoin='round'>" +
  "<path d='M18 11a7 7 0 1 1-2.8-5.6' stroke='white' stroke-width='4'/><path d='M15.5 2.5v3.5H19' stroke='white' stroke-width='4'/>" +
  "<path d='M18 11a7 7 0 1 1-2.8-5.6' stroke='black' stroke-width='1.6'/><path d='M15.5 2.5v3.5H19' stroke='black' stroke-width='1.6'/></g></svg>"
) + '") 11 11, crosshair';

/* ───────── 命令（agent 走这几条做得到跟滑鼠一样的事）───────── */
function rotTargets(p){
  const L = rotLayer(p); if (!L) return {err:'not a vector layer'};
  const ids = rotIds(L, Array.isArray(p.ids) ? p.ids : null);
  if (!ids.length) return {err:'nothing selected'};
  return {L, ids};
}
function rotPoint(v){ return (Array.isArray(v) && v.length >= 2 && isFinite(+v[0]) && isFinite(+v[1])) ? [+v[0], +v[1]] : null; }

CMD.reg('rotate.transform', {i18n:'', undoable:true,
  params:'{matrix:[a,b,c,d,e,f] 文件坐标的仿射（x\'=a·x+c·y+e, y\'=b·x+d·y+f）, copy?:bool, ids?:[shapeId…], layerId?, strokes?:bool=false, corners?:bool=false} ' +
         '照 object.transform：把矩阵套到选中的形状（ids 缺省＝矢量节点选取）。路径的锚点与把手全套乘矩阵；矩形／椭圆遇到非两轴对两轴的矩阵、星形／多边形遇到非相似变换会先转成钢笔路径（type:"bezier"）；' +
         'copy＝先在原形状正上方复制、选取换成复制品，再套复制品；strokes＝描边宽跟着平均缩放；corners＝圆角跟着缩放。→ {ok, ids, layerId}'}, p => {
  p = p || {};
  if (!RotAff.finite(p.matrix)) return {ok:false, error:'rotate.transform: missing matrix [a,b,c,d,e,f]'};
  const t = rotTargets(p); if (t.err) return {ok:false, error:'rotate.transform: ' + t.err};
  return rotApplyTransform(t.L, t.ids, p.matrix.map(Number), p);
});

CMD.reg('rotate.apply', {i18n:'', undoable:true,
  params:'{angle:度（逆时针为正）, absolute?:bool（angle 是外框的新角度而非转多少）, origin?:[x,y] 文件坐标（缺省＝选取外框中心，转过的物件按它自己的角度量）, copy?:bool, ids?, layerId?} ' +
         '照 object.rotate（＝旋转工具的数值对话框按确定）→ {ok, ids, origin, angle(实际转的逆时针度数)}'}, p => {
  p = p || {};
  const t = rotTargets(p); if (t.err) return {ok:false, error:'rotate.apply: ' + t.err};
  // object.rs:187-192 origin_of：给了就用，否则 transform_box 的中心
  let o = rotPoint(p.origin);
  if (!o){ const b = rotOrientedBox(t.L, t.ids); if (!b) return {ok:false, error:'selection has no bounds'}; o = b.center; }
  let angle = +p.angle; if (!isFinite(angle)) angle = 0;
  if (p.absolute) angle = rotNormDeg(angle - rotBboxAngle(t.L, t.ids));
  // 角度逆时针、y 朝下 ⇒ 取负（object.rs:263-264）
  const m = RotAff.about(o, RotAff.rotate(-angle * Math.PI / 180));
  const r = rotApplyTransform(t.L, t.ids, m, p);
  return r.ok ? Object.assign(r, {origin:o, angle}) : r;
});

CMD.reg('rotate.drag', {i18n:'', undoable:true,
  params:'{x0, y0 按下点, x1, y1 放开点（文件坐标）, shift?:bool（锁 45°）, alt?:bool（放开时按着 Alt＝复制）, origin?:[x,y]（缺省＝工具的参考点：点过的那点或选取外框中心）, ids?, layerId?} ' +
         '＝用旋转工具从 (x0,y0) 拖到 (x1,y1)：绕参考点转 atan2(终点)−atan2(起点) → {ok, ids, origin, angle(逆时针度数), matrix}'}, p => {
  p = p || {};
  if (![p.x0, p.y0, p.x1, p.y1].every(v => typeof v === 'number' && isFinite(v))) return {ok:false, error:'rotate.drag: x0,y0,x1,y1 are required numbers'};
  const t = rotTargets(p); if (t.err) return {ok:false, error:'rotate.drag: ' + t.err};
  let o = rotPoint(p.origin);
  if (!o){
    const useTool = !Array.isArray(p.ids) && (!p.layerId || p.layerId === VecSel.layerId);
    o = useTool ? RotTool.referencePoint() : null;
    if (!o){ const b = rotOrientedBox(t.L, t.ids); if (!b) return {ok:false, error:'selection has no bounds'}; o = b.center; }
  }
  const r = RotTool.rotateForDrag(o, [p.x0, p.y0], [p.x1, p.y1], !!p.shift);
  const res = rotApplyTransform(t.L, t.ids, r.m, {copy:!!p.alt});
  return res.ok ? Object.assign(res, {origin:o, angle:r.deg, matrix:r.m}) : res;
});

CMD.reg('rotate.again', {i18n:'', undoable:true,
  params:'{} 再套一次上一回的变换（照 object.transformAgain：同一个矩阵、同样复不复制）到目前的选取 → {ok, ids}'}, () => {
  const lt = RotTool.lastTransform; if (!lt) return {ok:false, error:'no previous transform'};
  const t = rotTargets({}); if (t.err) return {ok:false, error:'rotate.again: ' + t.err};
  return rotApplyTransform(t.L, t.ids, lt.matrix, {copy:lt.copy});
});

CMD.reg('rotate.setOrigin', {i18n:'',
  params:'{origin:[x,y]|null} 设旋转工具的参考点（文件坐标；绑定目前的选取，选取一换就回到外框中心）；null＝回到外框中心。＝用旋转工具点一下（不吸附）→ {origin}'}, p => {
  p = p || {};
  const o = rotPoint(p.origin), L = RotTool.selLayer();
  RotTool.origin = (o && L) ? {p:o, layerId:L.id, ids:RotTool.selIds()} : null;
  if (window.UI) UI.draw();
  return {origin:RotTool.origin ? RotTool.origin.p.slice() : null};
});

CMD.reg('rotate.options', {i18n:'',
  params:'{snap?:bool} 旋转工具选项（snap＝参考点吸到锚点／中心，预设开）；不给参数＝只读 → {origin（自订的，没有＝null）, reference（实际会用的参考点）, snap}'}, p => {
  p = p || {};
  if (p.snap !== undefined) RotTool.snap = !!p.snap;
  return {origin:RotTool.origin ? RotTool.origin.p.slice() : null, reference:RotTool.referencePoint(), snap:RotTool.snap};
});

const ROT_STRINGS = {
  'zh-Hant':{'tool.rotate':'旋轉', 'ui.rotHint':'點一下＝設參考點（吸到錨點／中心）· 拖＝繞參考點旋轉（Shift 鎖 45°、放開時按 Alt＝複製）· Alt＋點／雙擊／Enter＝輸入精確角度 · 拖時 Esc 取消',
             'ui.rotAngle':'角度', 'ui.rotCopy':'複製（轉出一份複本）', 'ui.rotOk':'確定', 'ui.rotCancel':'取消', 'opt.rotSnap':'吸附錨點', 'ui.rotDialogBtn':'數值…'},
  'zh-Hans':{'tool.rotate':'旋转', 'ui.rotHint':'点一下＝设参考点（吸到锚点／中心）· 拖＝绕参考点旋转（Shift 锁 45°、放开时按 Alt＝复制）· Alt＋点／双击／Enter＝输入精确角度 · 拖时 Esc 取消',
             'ui.rotAngle':'角度', 'ui.rotCopy':'复制（转出一份副本）', 'ui.rotOk':'确定', 'ui.rotCancel':'取消', 'opt.rotSnap':'吸附锚点', 'ui.rotDialogBtn':'数值…'},
  'en':{'tool.rotate':'Rotate', 'ui.rotHint':'Click to set the reference point (snaps to anchors / centres) · Drag to rotate (Shift: 45°, Alt at release: copy) · Alt+Click / double-click / Enter for exact values · Esc cancels a drag',
        'ui.rotAngle':'Angle', 'ui.rotCopy':'Copy (make a transformed copy)', 'ui.rotOk':'OK', 'ui.rotCancel':'Cancel', 'opt.rotSnap':'Snap to point', 'ui.rotDialogBtn':'Values…'}
};
if (typeof Lang !== 'undefined') Lang.add(ROT_STRINGS);

Tools.reg({
  id:'rotate', icon:'⟳', key:'R', group:'vector', order:60, for:'vector', opts:[],
  cursor:'crosshair',
  hint:'ui.rotHint',
  strings: ROT_STRINGS,
  onDown(e, pt){ RotTool.down(e, pt); RotTool.syncCursor(); UI.draw(); },
  onMove(e, pt){ RotTool.move(e, pt); RotTool.syncCursor(); if (!RotTool.busy()) UI.draw(); },
  onUp(e, pt){ RotTool.up(e, pt); RotTool.syncCursor(); UI.draw(); },
  onDblClick(e, pt){ RotTool.dblClick(e, pt); UI.draw(); },
  onKey(e){ const r = RotTool.key(e); if (r){ RotTool.syncCursor(); UI.draw(); } return r; },
  onDeactivate(){ RotTool.cancel(); RotTool.hover = []; RotTool.closeDialog(); },   // transform.rs:281-283：拖到一半换工具＝取消
  /* 选项栏：吸附开关（ToolContext snap_to_point／smart_guides）＋「数值…」（＝Enter 开对话框） */
  buildOptions(box, add, mk){
    const cb = mk('checkbox', {checked:RotTool.snap});
    cb.onchange = () => CMD.run('rotate.options', {snap:cb.checked});
    add('rotSnap', cb);
    const b = document.createElement('button'); b.textContent = Lang.t('ui.rotDialogBtn');
    b.onclick = () => { const o = RotTool.referencePoint(); if (o) RotTool.openDialog(o); };
    box.appendChild(b);
    setTimeout(() => RotTool.syncCursor(), 0);
  },
  /* transform.rs:236-256 overlays：参考点靶心（拖时用拖曳的原点）、吸附标签、拖时参考点→游标的青色虚线、角度读数 */
  drawOverlay(ctx, s){
    VecSel.drawOverlay(ctx, s);                       // 选中物件的轮廓与锚点
    const dpr = s / UI.zoom;
    const r = RotTool.drag ? RotTool.drag.origin : RotTool.referencePoint();
    ctx.save(); ctx.setLineDash([]);
    if (r){
      // xform.rs:53-60 target_overlays(p, tol(8))：半径 0.6r 的圆＋长 r 的十字
      const x = r[0]*s, y = r[1]*s, R = 8*dpr;
      ctx.strokeStyle = ROT_CYAN; ctx.lineWidth = 1*dpr;
      ctx.beginPath(); ctx.arc(x, y, R*0.6, 0, Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - R, y); ctx.lineTo(x + R, y); ctx.moveTo(x, y - R); ctx.lineTo(x, y + R); ctx.stroke();
    }
    // 吸附标签（Overlay::Label，洋红）
    for (const h of RotTool.hover){
      const x = h.p[0]*s, y = h.p[1]*s;
      ctx.fillStyle = ROT_MAGENTA; ctx.beginPath(); ctx.arc(x, y, 2.5*dpr, 0, Math.PI*2); ctx.fill();
      ctx.font = `${11*dpr}px sans-serif`; ctx.textBaseline = 'bottom'; ctx.fillText(h.text, x + 5*dpr, y - 3*dpr);
    }
    const d = RotTool.drag, m = RotTool.measure;
    if (d && d.began && m){
      ctx.strokeStyle = ROT_CYAN; ctx.lineWidth = 1*dpr; ctx.setLineDash([4*dpr, 3*dpr]);
      ctx.beginPath(); ctx.moveTo(d.origin[0]*s, d.origin[1]*s); ctx.lineTo(m.p[0]*s, m.p[1]*s); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (m){
      // Overlay::Measure：在游标右下 tol(12) 处
      const x = m.p[0]*s + 12*dpr, y = m.p[1]*s + 12*dpr;
      ctx.font = `${11*dpr}px sans-serif`; ctx.textBaseline = 'top';
      const w = ctx.measureText(m.text).width + 12*dpr, h = 13*dpr + 8*dpr;
      ctx.fillStyle = 'rgba(64,64,64,0.92)';
      if (ctx.roundRect){ ctx.beginPath(); ctx.roundRect(x, y, w, h, 3*dpr); ctx.fill(); } else ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#fff'; ctx.fillText(m.text, x + 6*dpr, y + 4*dpr);
    }
    ctx.restore();
  }
});
