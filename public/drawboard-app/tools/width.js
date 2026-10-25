/* 堤麟画板 · 宽度工具 width（AI 版面 ai.width，Shift+W）
   逐段翻自 ArtCraft VectorCraft：
     crates/tools/src/distort/width.rs（702 行）       WidthTool：悬停描边显示空心菱形＋该处宽度；从路径往外拖＝新增宽度点（预设两侧对称，Alt＝只改拖的那一侧）；
                                                      拖宽度点把手端＝改宽（Alt 单侧）；拖中心＝沿路径滑（Alt＝滑一份拷贝）；滑到别的宽度点 5 像素内＝落在那里成「不连续点」；
                                                      Shift 点＝加入／移出选取；选了几个一起拖＝一起滑或一起加宽（stroke.widthProfile.set）；
                                                      双击宽度点＝开「宽度点数编辑」；Delete／Backspace 删选中的宽度点；复合路径的描边是复合路径的（成员都经它改）；
                                                      叠画（蓝 #4a7cff：宽度线、菱形（选中 2.5 粗）、两端把手、拖时 W: 读数、悬停虚线）；游标三态
     crates/tools/src/distort/pathutil.rs（84 行）    fraction_at／eval_fraction／left_normal（y 朝下的左法线 (t.y, −t.x)）／nearest_fraction
     crates/engine/src/cmd/distortcmds.rs:197-382     stroke.widthPoint.set（place 不连续点、adjust_adjoining、没配置文件先建均匀的）、.copy、.remove、stroke.widthProfile.set
     crates/ui-egui/src/dialogs/width_point.rs        宽度点数编辑：边线 1／边线 2（连结＝两边一样）、总宽度（两边按比例）、调整邻近宽度点、删除
     crates/doc/src/appearance.rs:225-245             WidthProfile::at（点之间线性）
   我们这边：
     宽度配置文件存在形状的 s.profile = [[t, 左, 右]…]（宽度倍数，1＝描边粗细；跟 描边面板 menus/impl/ai-window.js 同一份资料、它负责画（profileFill））。
     沿路径的比例 t 用 AiWindow.flat（画的时候用的同一条折线）的弧长算——画出来的宽度点跟工具看到的落在同一处。
     命令：width.setPoint／width.copyPoint／width.removePoints／width.setProfile／width.points（读）／width.editPoint（开对话框）。 */
(function(){
const BLUE = '#4a7cff', SAME_T = 1e-6;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const V = {add:(a, b) => [a[0] + b[0], a[1] + b[1]], sub:(a, b) => [a[0] - b[0], a[1] - b[1]], mul:(a, k) => [a[0] * k, a[1] * k], dot:(a, b) => a[0] * b[0] + a[1] * b[1],
  len:a => Math.hypot(a[0], a[1]), unit:a => { const l = Math.hypot(a[0], a[1]); return l > 1e-12 ? [a[0] / l, a[1] / l] : [1, 0]; }};
const leftNormal = t => [t[1], -t[0]];                                     // pathutil.rs:57-60

/* WidthProfile::at（appearance.rs:227-245） */
function profAt(p, t){
  if (!p || !p.length) return [1, 1];
  if (t <= p[0][0]) return [p[0][1], p[0][2]];
  for (let i = 1; i < p.length; i++) if (t <= p[i][0]){ const a = p[i - 1], b = p[i], u = (t - a[0]) / Math.max(1e-9, b[0] - a[0]); return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; }
  const l = p[p.length - 1]; return [l[1], l[2]];
}

/* ── 折线（图层坐标）：画的时候用 AiWindow.flat；没载到就自己拆 ── */
function localFlat(s){
  if (!s) return [];
  if (s.type === 'compound' || s.type === 'group') return [].concat(...(s.children || []).map(c => localFlat(c).map(x => ({pts:x.pts, closed:s.type === 'compound' ? true : x.closed}))));
  const v = VecSel.asBezier(s); if (!v || !v.anchors || !v.anchors.length) return [];
  const pts = [[v.anchors[0].x, v.anchors[0].y]];
  VecSel.segments(v).forEach(c => { if (!c.c1 || (c.c1[0] === c.p0[0] && c.c1[1] === c.p0[1] && c.c2[0] === c.p3[0] && c.c2[1] === c.p3[1])) pts.push(c.p3.slice()); else for (let i = 1; i <= 24; i++) pts.push(VecSel.evalCubic(c, i / 24)); });
  if (v.closed) pts.pop();
  return pts.length >= 2 ? [{pts, closed:!!v.closed}] : [];
}
const flatOf = s => (window.AiWindow && AiWindow.flat) ? AiWindow.flat(s, 1) : localFlat(s);
function track(sub){
  const P = sub.closed ? sub.pts.concat([sub.pts[0]]) : sub.pts, cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + V.len(V.sub(P[i], P[i - 1])));
  return {P, cum, L:cum[cum.length - 1]};
}
/* nearest_fraction：子路径上最近的点 → {t（弧长比例）, q, tan, d} */
function nearestOnSub(sub, p){
  const T = track(sub); let best = null;
  for (let i = 1; i < T.P.length; i++){
    const a = T.P[i - 1], b = T.P[i], ab = V.sub(b, a), l2 = V.dot(ab, ab);
    const u = l2 > 1e-18 ? clamp(V.dot(V.sub(p, a), ab) / l2, 0, 1) : 0, q = V.add(a, V.mul(ab, u)), d = V.len(V.sub(p, q));
    if (!best || d < best.d) best = {t:T.L > 1e-12 ? clamp((T.cum[i - 1] + u * Math.sqrt(l2)) / T.L, 0, 1) : 0, q, tan:V.unit(ab), d};
  }
  return best;
}
/* eval_fraction：比例 f 处的点与单位切线 */
function evalFraction(sub, f){
  const T = track(sub);
  if (T.P.length < 2) return {p:T.P[0] || [0, 0], tan:[1, 0]};
  let target = clamp(f, 0, 1) * T.L;
  for (let i = 1; i < T.P.length; i++){
    const len = T.cum[i] - T.cum[i - 1];
    if (target <= T.cum[i] || i === T.P.length - 1){
      if (len < 1e-12 && i < T.P.length - 1) continue;
      const u = len > 1e-12 ? clamp((target - T.cum[i - 1]) / len, 0, 1) : 0, a = T.P[i - 1], b = T.P[i];
      return {p:V.add(a, V.mul(V.sub(b, a), u)), tan:V.unit(V.sub(b, a))};
    }
  }
  return {p:T.P[T.P.length - 1], tan:[1, 0]};
}

/* ── 形状查找 ── */
function findWithParent(shapes, id, parent){
  for (const s of shapes){
    if (s.id === id) return {s, parent};
    if (Array.isArray(s.children)){ const r = findWithParent(s.children, id, s); if (r) return r; }
  }
  return null;
}
/* stroke_owner：复合路径的成员 ⇒ 复合路径 */
function ownerOf(shapes, id){
  const r = findWithParent(shapes, id, null); if (!r) return null;
  return (r.parent && r.parent.type === 'compound') ? r.parent : r.s;
}
function layersToSearch(layerId){
  if (layerId){ const L = Doc.byId(layerId); return L && L.kind === 'vector' ? [L] : []; }
  const out = []; [VecSel.layer(), Doc.active()].concat(Doc.layers.slice().reverse()).forEach(L => { if (L && L.kind === 'vector' && !out.includes(L)) out.push(L); });
  return out;
}
function findOwner(id, layerId){
  for (const L of layersToSearch(layerId)){ const s = ownerOf(L.data.shapes, id); if (s) return {L, s}; }
  return null;
}
/* stroke_of：看得见、有粗细的描边 */
const strokeOf = s => !!(s && s.stroke && s.stroke !== 'none' && (s.strokeWidth || 0) > 0);
/* sides_at：t 处两侧宽（pt） */
function sidesAt(s, t){ const [l, r] = profAt(s.profile, t); return [l * s.strokeWidth / 2, r * s.strokeWidth / 2]; }
const uniform = () => [[0, 1, 1], [1, 1, 1]];

/* ── 命令那边（distortcmds.rs:197-382）── */
/* place：照顺序插入；落在别的点的位置上＝不连续点（吸过去、占它来的那一侧，那侧原有的换掉）→ 落点索引 */
function place(points, pt, fromBelow){
  const at = []; points.forEach((q, i) => { if (Math.abs(q[0] - pt[0]) <= SAME_T) at.push(i); });
  if (!at.length){ let pos = points.findIndex(q => q[0] > pt[0]); if (pos < 0) pos = points.length; points.splice(pos, 0, pt); return pos; }
  const first = at[0], last = at[at.length - 1], pair = at.length > 1;
  pt = [points[first][0], pt[1], pt[2]];
  const pos = fromBelow ? first : (pair ? last : last + 1);
  if (pair) points.splice(pos, 1);
  points.splice(pos, 0, pt);
  return pos;
}
/* adjust_adjoining：两边最近（不同位置）的点按同比例改（原本 0 的按差值加） */
function adjustAdjoining(points, i, old, nw){
  const t = points[i][0], scale = (v, o, n) => Math.max(0, o > 1e-9 ? v * n / o : v + n - o);
  let before = null, after = null;
  for (let j = i - 1; j >= 0; j--) if (Math.abs(points[j][0] - t) > SAME_T){ before = j; break; }
  for (let j = i + 1; j < points.length; j++) if (Math.abs(points[j][0] - t) > SAME_T){ after = j; break; }
  [before, after].forEach(j => { if (j === null) return; const q = points[j]; points[j] = [q[0], scale(q[1], old[1], nw[1]), scale(q[2], old[2], nw[2])]; });
}
const num = v => typeof v === 'number' && isFinite(v);
function target(C, p){
  if (!p.id) return {err:{ok:false, error:C + ': missing id'}};
  const f = findOwner(p.id, p.layerId); if (!f) return {err:{ok:false, error:C + ': no such object ' + p.id}};
  const k = Locks.blocks(f.L, 'pixels'); if (k){ Locks.notify(Locks.message(f.L, k)); return {err:Locks.fail(f.L, k, C)}; }
  return f;
}
function indexParam(C, p, prof){
  if (p.index === undefined || p.index === null) return {i:null};
  const i = p.index;
  if (!Number.isInteger(i) || i < 0 || i >= prof.length) return {err:{ok:false, error:C + ': no such width point'}};
  return {i};
}
function widthPointSet(p){
  const C = 'width.setPoint';
  if (!num(p.t)) return {ok:false, error:C + ': missing t'};
  const t = clamp(p.t, 0, 1), left = p.left, right = p.right;
  if (!num(left) || !num(right) || left < 0 || right < 0 || Math.max(left, right) > 1e5) return {ok:false, error:C + ': left/right must be non-negative widths'};
  const f = target(C, p); if (f.err) return f.err;
  const s = f.s; if (!((s.strokeWidth || 0) > 0)) return {ok:false, error:C + ': the stroke has no weight'};
  const half = s.strokeWidth / 2, prof = s.profile ? JSON.parse(JSON.stringify(s.profile)) : uniform(), pt = [t, left / half, right / half];
  const ix = indexParam(C, p, prof); if (ix.err) return ix.err;
  let pos;
  if (ix.i !== null){
    const i = ix.i, old = prof[i].slice();
    if (p.adjustAdjoining === true) adjustAdjoining(prof, i, old, pt);
    if (Math.abs(old[0] - t) <= SAME_T){ prof[i] = [old[0], pt[1], pt[2]]; pos = i; }      // 只改宽：留在原位（不连续点也留在它那一侧）
    else { prof.splice(i, 1); pos = place(prof, pt, old[0] < t); }
  } else {
    const kept = prof.filter(q => Math.abs(q[0] - t) > SAME_T);
    pos = place(kept, pt, true); prof.length = 0; kept.forEach(q => prof.push(q));
  }
  s.profile = prof; Layer.invalidate(f.L);
  return {ok:true, index:pos};
}
function widthPointCopy(p){
  const C = 'width.copyPoint';
  if (!num(p.t)) return {ok:false, error:C + ': missing t'};
  const t = clamp(p.t, 0, 1);
  const f = target(C, p); if (f.err) return f.err;
  const s = f.s; if (!((s.strokeWidth || 0) > 0)) return {ok:false, error:C + ': the stroke has no weight'};
  const prof = s.profile ? JSON.parse(JSON.stringify(s.profile)) : uniform();
  const ix = indexParam(C, p, prof); if (ix.err) return ix.err;
  if (ix.i === null) return {ok:false, error:C + ': missing index'};
  const [from, l, r] = prof[ix.i], pos = place(prof, [t, l, r], from < t);
  s.profile = prof; Layer.invalidate(f.L);
  return {ok:true, index:pos};
}
function widthPointRemove(p){
  const C = 'width.removePoints';
  let idx = Array.isArray(p.indices) ? p.indices.filter(i => Number.isInteger(i) && i >= 0) : (Number.isInteger(p.index) && p.index >= 0 ? [p.index] : null);
  if (!idx) return {ok:false, error:C + ': missing index'};
  idx = Array.from(new Set(idx)).sort((a, b) => a - b);
  const f = target(C, p); if (f.err) return f.err;
  const s = f.s;
  if (!s.profile || !idx.length || idx[idx.length - 1] >= s.profile.length) return {ok:false, error:C + ': no such width point'};
  for (let k = idx.length - 1; k >= 0; k--) s.profile.splice(idx[k], 1);
  if (!s.profile.length){ delete s.profile; delete s.profileFlip; }
  Layer.invalidate(f.L);
  return {ok:true};
}
function widthProfileSet(p){
  const C = 'width.setProfile';
  if (!('points' in p)) return {ok:false, error:C + ': missing points'};
  let prof = null;
  if (p.points === null || (Array.isArray(p.points) && !p.points.length)) prof = null;
  else if (Array.isArray(p.points)){
    prof = [];
    for (const q of p.points){
      const v = Array.isArray(q) ? q.filter(num) : [];
      if (v.length !== 3 || v[1] < 0 || v[2] < 0) return {ok:false, error:C + ': points must be [t, left, right] with non-negative widths'};
      prof.push([clamp(v[0], 0, 1), v[1], v[2]]);
    }
    prof.sort((a, b) => a[0] - b[0]);
  } else return {ok:false, error:C + ': points must be an array or null'};
  const ids = Array.isArray(p.ids) ? p.ids : p.id ? [p.id] : VecSel.shapes.slice();
  const owners = [];
  for (const id of ids){ const f = findOwner(id, p.layerId || (Array.isArray(p.ids) || p.id ? undefined : VecSel.layerId)); if (!f) return {ok:false, error:C + ': no such object ' + id}; if (!owners.some(o => o.s === f.s)) owners.push(f); }
  for (const f of owners){ const k = Locks.blocks(f.L, 'pixels'); if (k){ Locks.notify(Locks.message(f.L, k)); return Locks.fail(f.L, k, C); } }
  owners.forEach(f => { if (prof) f.s.profile = JSON.parse(JSON.stringify(prof)); else { delete f.s.profile; delete f.s.profileFlip; } Layer.invalidate(f.L); });
  return {ok:true, ids:owners.map(f => f.s.id)};
}

CMD.reg('width.setPoint', {i18n:'', undoable:true,
  params:'{id（路径／复合路径；成员 id 会改到它的复合路径）, t: 0..1（沿路径长度的比例）, left, right: 两侧宽（pt）, index?: 要改或要移的宽度点, adjustAdjoining?: bool（带 index：两边最近的点按同比例改）, layerId?} → {ok, index}。' +
         '没给 index：t 处已有的点被换掉；移到别的点的 t 上＝跟它成不连续点（占来的那一侧），宽度在那里断开。没有配置文件先建均匀的（照 vectorcraft stroke.widthPoint.set）'}, widthPointSet);
CMD.reg('width.copyPoint', {i18n:'', undoable:true,
  params:'{id, index: 要拷贝的宽度点, t: 0..1 拷贝放哪, layerId?} → {ok, index}（宽度工具 Alt 拖中心）。落在别的点上＝不连续点'}, widthPointCopy);
CMD.reg('width.removePoints', {i18n:'', undoable:true,
  params:'{id, index | indices:[…], layerId?} 删宽度点（删光＝回到均匀描边）'}, widthPointRemove);
CMD.reg('width.setProfile', {i18n:'', undoable:true,
  params:'{ids?|id?（缺省＝矢量节点选取）, points: [[t, 左, 右]…]（宽度倍数，1＝描边粗细）| null＝均匀, layerId?}'}, widthProfileSet);
CMD.reg('width.points', {i18n:'',
  params:'{id, layerId?} → {ok, id, strokeWidth, points:[{index, t, left, right}]}（两侧宽 pt；没配置文件＝空阵列）'}, p => {
  const f = p.id ? findOwner(p.id, p.layerId) : null; if (!f) return {ok:false, error:'width.points: no such object'};
  const h = (f.s.strokeWidth || 0) / 2;
  return {ok:true, id:f.s.id, layerId:f.L.id, strokeWidth:f.s.strokeWidth || 0, points:(f.s.profile || []).map((q, index) => ({index, t:q[0], left:q[1] * h, right:q[2] * h}))};
});
CMD.reg('width.editPoint', {i18n:'',
  params:'{id, index, layerId?} 开「宽度点数编辑」对话框（边线 1／边线 2（pt）、连结、总宽度、调整邻近宽度点；确定＝width.setPoint，删除＝width.removePoints）；双击宽度点也会开'}, p => {
  const f = p.id ? findOwner(p.id, p.layerId) : null;
  const q = f && f.s.profile && Number.isInteger(p.index) ? f.s.profile[p.index] : null;
  if (!q) return {ok:false, error:'width.editPoint: no such width point'};
  WidthTool.openDialog(f.L.id, f.s.id, p.index);
  return {ok:true};
});

/* ── 工具（width.rs:99-459）── 坐标：p／n 一律文件坐标 */
const WidthTool = window.WidthTool = {
  hover:null, drag:null, selected:null,     // selected = {layerId, owner, ts:[…]}
  base:null,
  tol(px){ return VecSel.tol(px); },
  editable(L, s){ return L && L.kind === 'vector' && L.visible !== false && !Locks.blocks(L, 'pixels') && s && s.visible !== false && !s.locked; },
  /* 一层里能当描边主人的：一般路径（含活形状）、复合路径；编组往里找 */
  ownersIn(shapes, out){
    shapes.forEach(s => {
      if (!s || s.visible === false) return;
      if (s.type === 'group'){ this.ownersIn(s.children || [], out); return; }
      if (s.type === 'compound' || VecSel.asBezier(s)) out.push(s);
    });
    return out;
  },
  subsOf(L, s){ const o = [L.x || 0, L.y || 0]; return flatOf(s).map(x => ({pts:x.pts.map(q => [q[0] + o[0], q[1] + o[1]]), closed:x.closed})); },
  /* 指针附近（描边半宽＋4 像素）最近的有描边路径 */
  spotAt(p){
    const consider = (L, s) => {
      if (!this.editable(L, s) || !strokeOf(s)) return null;
      const widest = (s.profile || []).reduce((m, q) => Math.max(m, q[1], q[2]), 1);
      const reach = widest * s.strokeWidth / 2 + this.tol(4);
      let best = null;
      this.subsOf(L, s).forEach((sub, si) => { const n = nearestOnSub(sub, p); if (n && n.d <= reach && (!best || n.d < best.d)) best = Object.assign({sub:si}, n); });
      if (!best) return null;
      const [left, right] = sidesAt(s, best.t);
      return {d:best.d, spot:{layerId:L.id, owner:s.id, sub:best.sub, t:best.t, p:best.q, n:leftNormal(best.tan), left, right}};
    };
    const bestOf = list => { let b = null; list.forEach(([L, s]) => { const c = consider(L, s); if (c && (!b || c.d < b.d)) b = c; }); return b; };
    const SL = VecSel.layer();
    if (SL && SL.kind === 'vector'){
      const sel = []; VecSel.shapes.forEach(id => { const o = ownerOf(SL.data.shapes, id); if (o && !sel.some(x => x[1] === o)) sel.push([SL, o]); });
      const b = bestOf(sel); if (b) return b.spot;
    }
    const all = [];
    Doc.layers.slice().reverse().forEach(L => { if (L.kind === 'vector') this.ownersIn(L.data.shapes, []).reverse().forEach(s => all.push([L, s])); });
    const b = bestOf(all); return b ? b.spot : null;
  },
  ownerRef(layerId, id){ const L = Doc.byId(layerId); const s = L && L.kind === 'vector' ? ownerOf(L.data.shapes, id) : null; return s ? {L, s} : null; },
  /* 宽度点（某一条子路径上的） */
  pointsOf(layerId, owner, sub){
    const r = this.ownerRef(layerId, owner); if (!r || !strokeOf(r.s) || !r.s.profile) return [];
    const sp = this.subsOf(r.L, r.s)[sub]; if (!sp) return [];
    const h = r.s.strokeWidth / 2;
    return r.s.profile.map((q, index) => { const e = evalFraction(sp, q[0]); return {index, t:q[0], p:e.p, n:leftNormal(e.tan), left:q[1] * h, right:q[2] * h}; });
  },
  allPoints(layerId, owner){
    const r = this.ownerRef(layerId, owner); if (!r) return [];
    const n = this.subsOf(r.L, r.s).length, out = [];
    for (let i = 0; i < n; i++) out.push(...this.pointsOf(layerId, owner, i));
    return out;
  },
  /* 5 像素内最近的宽度点部位：中心（part＝null）、左把手端（true）、右把手端（false） */
  hit(spot, p){
    const tol = this.tol(5); let best = null;
    this.pointsOf(spot.layerId, spot.owner, spot.sub).forEach(w => {
      [[null, w.p], [true, V.add(w.p, V.mul(w.n, w.left))], [false, V.sub(w.p, V.mul(w.n, w.right))]].forEach(([part, q]) => {
        const d = V.len(V.sub(q, p)); if (d <= tol && (!best || d < best.d)) best = {d, w, part};
      });
    });
    return best;
  },
  isSelected(owner, t){ const s = this.selected; return !!s && s.owner === owner && s.ts.some(x => Math.abs(x - t) <= SAME_T); },
  toggle(layerId, owner, t){
    const s = this.selected;
    if (s && s.owner === owner){
      const i = s.ts.findIndex(x => Math.abs(x - t) <= SAME_T);
      if (i >= 0){ s.ts.splice(i, 1); return false; }
      s.ts.push(t); return true;
    }
    this.selected = {layerId, owner, ts:[t]}; return true;
  },
  selectedIndices(){
    const s = this.selected; if (!s) return [];
    const r = this.ownerRef(s.layerId, s.owner); if (!r || !r.s.profile) return [];
    return r.s.profile.map((q, i) => i).filter(i => this.isSelected(s.owner, r.s.profile[i][0]));
  },
  group(spot, mode){
    const r = this.ownerRef(spot.layerId, spot.owner); if (!r || !strokeOf(r.s)) return null;
    const moving = this.selectedIndices();
    const several = mode === 'move' ? moving.length > 1 : mode === 'copy' ? false : !!(this.selected && this.selected.ts.length > 1);
    return several ? {points:JSON.parse(JSON.stringify(r.s.profile || [])), moving, half:r.s.strokeWidth / 2} : null;
  },
  /* 拖曳要预览的命令（width.rs:255-283） */
  previewCmd(d){
    const id = d.spot.owner, layerId = d.spot.layerId;
    if (d.group){
      const g = d.group, dt = d.t - d.spot.t, dl = (d.left - d.spot.left) / g.half, dr = (d.right - d.spot.right) / g.half;
      const pts = g.points.map((q, i) => !g.moving.includes(i) ? q.slice() : d.mode === 'move' ? [clamp(q[0] + dt, 0, 1), q[1], q[2]] : [q[0], Math.max(0, q[1] + dl), Math.max(0, q[2] + dr)]);
      pts.sort((a, b) => a[0] - b[0]);
      return ['width.setProfile', {ids:[id], points:pts, layerId}];
    }
    if (d.mode === 'copy' && d.index !== null) return ['width.copyPoint', {id, index:d.index, t:d.t, layerId}];
    const v = {id, t:d.t, left:d.left, right:d.right, layerId}; if (d.index !== null) v.index = d.index;
    return ['width.setPoint', v];
  },
  /* Begin／Preview／Commit：预览每次从按下时的样子重来；放开走一次命令（一步历史） */
  begin(layerId){ const L = Doc.byId(layerId); this.base = {L, json:JSON.stringify(L.data.shapes)}; },
  resetToBase(){ const b = this.base; if (b){ b.L.data.shapes = JSON.parse(b.json); Layer.invalidate(b.L); } },
  preview(d){
    const [c, p] = this.previewCmd(d); this.resetToBase();
    try { CMD.map[c].run(p); } catch (err){ console.error(err); }
    d.last = [c, p]; UI.draw();
  },
  commit(d){
    this.resetToBase(); this.base = null;
    if (d && d.last){ try { CMD.run(d.last[0], d.last[1]); } catch (err){ console.error(err); } }
  },

  down(e, p){
    const spot = this.spotAt(p);
    if (!spot){ if (!e.shiftKey) this.selected = null; return; }
    const h = this.hit(spot, p);
    let d;
    if (h){
      const w = h.w, mode = h.part === null ? (e.altKey ? 'copy' : 'move') : 'width', side = h.part === null ? null : (e.altKey ? h.part : null);
      if (e.shiftKey){ if (!this.toggle(spot.layerId, spot.owner, w.t)) return; }
      else if (mode === 'copy' || !this.isSelected(spot.owner, w.t)) this.selected = {layerId:spot.layerId, owner:spot.owner, ts:[w.t]};
      const others = this.pointsOf(spot.layerId, spot.owner, spot.sub).filter(o => o.index !== w.index);
      const group = this.group(spot, mode);
      const sp = Object.assign({}, spot, {t:w.t, p:w.p, n:w.n, left:w.left, right:w.right});
      d = {spot:sp, index:w.index, mode, side, left:w.left, right:w.right, t:w.t, group, others, moved:false};
    } else {
      const side = V.dot(V.sub(p, spot.p), spot.n) >= 0;
      this.selected = {layerId:spot.layerId, owner:spot.owner, ts:[spot.t]};
      d = {spot, index:null, mode:'width', side:e.altKey ? side : null, left:spot.left, right:spot.right, t:spot.t, group:null, others:[], moved:false};
    }
    this.drag = d; this.begin(spot.layerId);
  },
  move(e, p){
    const d = this.drag;
    if (!d){ this.hover = this.spotAt(p); return; }
    d.moved = true;
    if (d.mode === 'width'){
      const off = V.dot(V.sub(p, d.spot.p), d.spot.n);
      if (d.side === null){ d.left = Math.abs(off); d.right = Math.abs(off); }
      else if (d.side === true) d.left = Math.max(0, off);
      else d.right = Math.max(0, -off);
    } else {
      // 沿路径滑：按下时那条子路径（从 Begin 的样子量）
      this.resetToBase();
      const r = this.ownerRef(d.spot.layerId, d.spot.owner); if (!r) return;
      const sp = this.subsOf(r.L, r.s)[d.spot.sub]; if (!sp) return;
      const n = nearestOnSub(sp, p); if (!n) return;
      d.t = n.t; d.spot.p = n.q; d.spot.n = leftNormal(n.tan);
      // 落在别的宽度点上（单个点才吸）：正好到那里，成不连续点
      if (!d.group){ const o = d.others.find(o => V.len(V.sub(o.p, n.q)) <= this.tol(5)); if (o){ d.t = o.t; d.spot.p = o.p; d.spot.n = o.n; } }
    }
    this.preview(d);
  },
  up(e){
    const d = this.drag; this.drag = null;
    if (!d) return;
    const dt = d.t - d.spot.t, sel = this.selected;
    if (d.group && !d.moved && !e.shiftKey) this.selected = {layerId:d.spot.layerId, owner:d.spot.owner, ts:[d.spot.t]};     // 点一下选中的几个之一＝只选它
    else if (d.group && d.mode === 'move' && sel) this.selected = {layerId:sel.layerId, owner:sel.owner, ts:sel.ts.map(t => clamp(t + dt, 0, 1))};
    else if (d.group) this.selected = sel;
    else this.selected = {layerId:d.spot.layerId, owner:d.spot.owner, ts:[d.t]};
    this.commit(d);
  },
  dblClick(e, p){
    const spot = this.spotAt(p); if (!spot) return;
    const h = this.hit(spot, p); if (!h) return;
    this.selected = {layerId:spot.layerId, owner:spot.owner, ts:[h.w.t]};
    this.openDialog(spot.layerId, spot.owner, h.w.index);
  },
  key(e){
    if (e.key !== 'Delete' && e.key !== 'Backspace') return false;
    if (this.drag || !this.selected) return false;
    const idx = this.selectedIndices(); if (!idx.length) return false;
    const s = this.selected; this.selected = null;
    e.preventDefault();
    CMD.run('width.removePoints', {id:s.owner, layerId:s.layerId, indices:idx});
    return true;
  },
  cancel(){ if (this.drag){ const d = this.drag; this.drag = null; this.commit(d); } this.hover = null; },
  cursor(p){
    if (this.drag) return 'move';
    const h = this.hover;
    if (h && p && this.hit(h, p)) return 'move';
    return h ? 'copy' : 'crosshair';
  },

  /* 叠画（width.rs:408-440） */
  overlay(ctx, s){
    const dpr = s / UI.zoom, r = this.tol(4) * s, X = q => [q[0] * s, q[1] * s];
    const line = (a, b, dashed) => { ctx.setLineDash(dashed ? [4 * dpr, 3 * dpr] : []); ctx.beginPath(); ctx.moveTo(...X(a)); ctx.lineTo(...X(b)); ctx.stroke(); ctx.setLineDash([]); };
    const diamond = (p, w) => { const [x, y] = X(p); ctx.lineWidth = w * dpr; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.stroke(); ctx.lineWidth = 1 * dpr; };
    const handle = p => { const [x, y] = X(p), k = 2.5 * dpr; ctx.fillRect(x - k, y - k, 2 * k, 2 * k); };
    ctx.save(); ctx.strokeStyle = BLUE; ctx.fillStyle = BLUE; ctx.lineWidth = 1 * dpr;
    const focus = this.drag ? this.drag.spot : this.hover;
    const show = (layerId, owner) => this.allPoints(layerId, owner).forEach(w => {
      const a = V.add(w.p, V.mul(w.n, w.left)), b = V.sub(w.p, V.mul(w.n, w.right));
      line(a, b, false); diamond(w.p, this.isSelected(owner, w.t) ? 2.5 : 1); handle(a); handle(b);
    });
    if (focus) show(focus.layerId, focus.owner);
    if (this.selected && (!focus || focus.owner !== this.selected.owner)) show(this.selected.layerId, this.selected.owner);
    const d = this.drag;
    if (d){
      const q = d.spot.p;
      line(V.add(q, V.mul(d.spot.n, d.left)), V.sub(q, V.mul(d.spot.n, d.right)), false); diamond(q, 2);
      const m = X(V.add(q, V.mul(d.spot.n, d.left + this.tol(4) * 3))), txt = 'W: ' + (+(d.left + d.right).toFixed(2)) + ' pt';
      ctx.font = `${11 * dpr}px sans-serif`; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(txt).width + 10 * dpr;
      ctx.fillStyle = 'rgba(64,64,64,0.92)'; ctx.fillRect(m[0], m[1] - 9 * dpr, tw, 18 * dpr);
      ctx.fillStyle = '#fff'; ctx.fillText(txt, m[0] + 5 * dpr, m[1]);
    } else if (this.hover){
      const h = this.hover;
      line(V.add(h.p, V.mul(h.n, h.left)), V.sub(h.p, V.mul(h.n, h.right)), true); diamond(h.p, 1);
    }
    ctx.restore();
  },

  /* ── 宽度点数编辑（dialogs/width_point.rs）── */
  closeDialog(){ const d = document.getElementById('widthPointDialog'); if (d) d.remove(); },
  openDialog(layerId, owner, index){
    this.closeDialog();
    const r = this.ownerRef(layerId, owner); if (!r || !r.s.profile || !r.s.profile[index]) return;
    const h = r.s.strokeWidth / 2, q = r.s.profile[index], T = k => Lang.t(k);
    const st = {side1:q[1] * h, side2:q[2] * h, linked:Math.abs(q[1] - q[2]) * h < 1e-9, adjust:false};
    const bg = document.createElement('div'); bg.id = 'widthPointDialog';
    bg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999';
    const box = document.createElement('div');
    box.style.cssText = 'background:#2b2f36;color:#e6e8eb;padding:14px 18px;border-radius:6px;min-width:300px;font:13px sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)';
    const title = document.createElement('div'); title.textContent = T('ui.wpTitle'); title.style.cssText = 'font-weight:bold;margin-bottom:10px'; box.appendChild(title);
    const grid = document.createElement('div'); grid.style.cssText = 'display:grid;grid-template-columns:auto 90px auto;gap:8px 10px;align-items:center'; box.appendChild(grid);
    const inp = name => { const i = document.createElement('input'); i.type = 'number'; i.step = 'any'; i.min = 0; i.name = name; i.style.cssText = 'width:100%;box-sizing:border-box;background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:3px 6px'; return i; };
    const lab = k => { const l = document.createElement('span'); l.textContent = T(k); l.style.color = '#aab0ba'; return l; };
    const i1 = inp('side1'), i2 = inp('side2'), it = inp('total');
    const link = document.createElement('button'); link.name = 'linked'; link.title = T('ui.wpLink');
    const fmt = v => +(+v).toFixed(3);
    const sync = () => { i1.value = fmt(st.side1); i2.value = fmt(st.side2); it.value = fmt(st.side1 + st.side2); link.textContent = st.linked ? '🔗' : '⛓'; link.style.opacity = st.linked ? 1 : 0.5; };
    grid.append(lab('ui.wpSide1'), i1, link, lab('ui.wpSide2'), i2, document.createElement('span'), lab('ui.wpTotal'), it, document.createElement('span'));
    i1.onchange = () => { const v = Math.max(0, parseFloat(i1.value) || 0); st.side1 = v; if (st.linked) st.side2 = v; sync(); };
    i2.onchange = () => { const v = Math.max(0, parseFloat(i2.value) || 0); st.side2 = v; if (st.linked) st.side1 = v; sync(); };
    it.onchange = () => { const v = Math.max(0, parseFloat(it.value) || 0), s0 = st.side1 + st.side2, k = s0 > 1e-9 ? v / s0 : 0;
      if (k > 0){ st.side1 *= k; st.side2 *= k; } else { st.side1 = v / 2; st.side2 = v / 2; } sync(); };
    link.onclick = () => { st.linked = !st.linked; if (st.linked) st.side2 = st.side1; sync(); };
    const cl = document.createElement('label'); cl.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:10px';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.name = 'adjustAdjoining'; cb.onchange = () => { st.adjust = cb.checked; };
    const ct = document.createElement('span'); ct.textContent = T('ui.wpAdjust'); cl.append(cb, ct); box.appendChild(cl);
    const row = document.createElement('div'); row.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px';
    const bDel = document.createElement('button'); bDel.textContent = T('ui.wpDelete'); bDel.dataset.act = 'delete'; bDel.style.marginRight = 'auto';
    const bNo = document.createElement('button'); bNo.textContent = T('ui.wpCancel'); bNo.dataset.act = 'cancel';
    const bOk = document.createElement('button'); bOk.textContent = T('ui.wpOk'); bOk.dataset.act = 'ok';
    row.append(bDel, bNo, bOk); box.appendChild(row); bg.appendChild(box); document.body.appendChild(bg);
    sync();
    const close = () => { this.closeDialog(); UI.draw(); };
    bOk.onclick = () => { [i1, i2, it].forEach(x => { if (document.activeElement === x && x.onchange) x.onchange(); }); this.closeDialog();
      CMD.run('width.setPoint', {id:owner, layerId, index, t:q[0], left:st.side1, right:st.side2, adjustAdjoining:st.adjust}); UI.draw(); };
    bDel.onclick = () => { this.closeDialog(); this.selected = null; CMD.run('width.removePoints', {id:owner, layerId, index}); UI.draw(); };
    bNo.onclick = close;
    bg.addEventListener('pointerdown', e => { if (e.target === bg) close(); });
    bg.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter'){ e.preventDefault(); if (e.target && e.target.onchange) e.target.onchange(); bOk.onclick(); } else if (e.key === 'Escape'){ e.preventDefault(); close(); } });
    i1.focus(); i1.select();
  }
};

const STR = {
  'zh-Hant':{'tool.width':'寬度工具', 'ui.widthHint':'拖曳描邊＝加寬度點（Alt 單側）；拖中心＝滑動（Alt 拷貝）；Shift 點＝多選；雙擊＝編輯；Delete 刪除',
    'ui.wpTitle':'寬度點數編輯', 'ui.wpSide1':'邊線 1：', 'ui.wpSide2':'邊線 2：', 'ui.wpTotal':'總寬度：', 'ui.wpLink':'兩邊寬度保持相同', 'ui.wpAdjust':'調整鄰近寬度點',
    'ui.wpDelete':'刪除', 'ui.wpCancel':'取消', 'ui.wpOk':'確定'},
  'zh-Hans':{'tool.width':'宽度工具', 'ui.widthHint':'拖动描边＝加宽度点（Alt 单侧）；拖中心＝滑动（Alt 复制）；Shift 点＝多选；双击＝编辑；Delete 删除',
    'ui.wpTitle':'宽度点数编辑', 'ui.wpSide1':'边线 1：', 'ui.wpSide2':'边线 2：', 'ui.wpTotal':'总宽度：', 'ui.wpLink':'两边宽度保持相同', 'ui.wpAdjust':'调整邻近的宽度点',
    'ui.wpDelete':'删除', 'ui.wpCancel':'取消', 'ui.wpOk':'确定'},
  'en':{'tool.width':'Width Tool', 'ui.widthHint':'Drag a stroke = add a width point (Alt: one side); drag the centre = slide (Alt: copy); Shift-click = select several; double-click = edit; Delete removes',
    'ui.wpTitle':'Width Point Edit', 'ui.wpSide1':'Side 1:', 'ui.wpSide2':'Side 2:', 'ui.wpTotal':'Total Width:', 'ui.wpLink':'Keep both sides the same width', 'ui.wpAdjust':'Adjust Adjoining Width Points',
    'ui.wpDelete':'Delete', 'ui.wpCancel':'Cancel', 'ui.wpOk':'OK'}
};
const syncCursor = p => { if (window.UI && UI.canvas && ToolState.cur === 'width') UI.canvas.style.cursor = WidthTool.cursor(p); };
Tools.reg({
  id:'width', icon:'⟷', group:'vector', order:139, for:'vector', opts:[], cursor:'crosshair', hint:'ui.widthHint', strings:STR,
  onDown(e, pt){ WidthTool.down(e, pt); syncCursor(pt); UI.draw(); },
  onMove(e, pt){ WidthTool.move(e, pt); syncCursor(pt); if (!WidthTool.drag) UI.draw(); },
  onUp(e, pt){ WidthTool.up(e, pt); syncCursor(pt); UI.draw(); },
  onDblClick(e, pt){ WidthTool.dblClick(e, pt); UI.draw(); },
  onKey(e){ const r = WidthTool.key(e); if (r) UI.draw(); return r; },
  onDeactivate(){ WidthTool.cancel(); WidthTool.closeDialog(); },
  drawOverlay(ctx, s){ WidthTool.overlay(ctx, s); }
});
WidthTool._internals = {profAt, place, adjustAdjoining, nearestOnSub, evalFraction, flatOf};
})();
