/* 堤麟画板 · 顶菜单实作 · Illustrator ▸ 文字（命令名 ai.<原码 id>）
   照 ArtCraft VectorCraft 原码逐段翻译（vectorcraft/crates/）：
     engine/src/cmd/typemenu.rs 1-473   type.changeCase／smartPunctuation／convertToAreaType／convertToPointType／pathOptions／fillPlaceholder／insert（special_char 表）
     engine/src/cmd/typecmd.rs  1-417   type.orientation.*／type.createOutlines／text.setStyle／text.areaOptions／text.fitHeadline（headline_fit 二分）
     engine/src/cmd/threads.rs  1-220   text.thread.create／releaseSelection／remove／info、reflow（一篇文章依序流过几个区域文字框）
     engine/src/cmd/fonts.rs    1-186   text.fonts（文件用到的字体、缺字体标出）／text.replaceFont／select.font
     engine/src/cmd/textedit.rs 338-395 text.createInPath（把路径变成路径文字的基线）
     doc/src/text.rs 292-385            FirstBaseline、PathEffect、AreaOptions（预设 rows 1 columns 1 gutter 18 inset 0 ascent 0）
     doc/src/setup.rs 90-136            Quotes::apply（直引号 → 弯引号，按前一个字决定开或关）
     text/src/layout.rs 39-158, 270-397, 828-926  直排（writing＝[0,1,-1,0]、中日韩字直立）、区域文字格子（先往下再往右）、第一条基线、路径文字五种效果
     ui-egui/src/menus.rs 87-98, 722-725, 791, 805-811, 1110-1137, 1179-1196, 1397-1399, 2203-2213, 2257-2263, 2427-2508
                                        最近使用的字体（十格、套 text.setStyle {font}）、显示隐藏字符（翻标签）、「…」项开参数对话框、区域文字选项对话框带目前值
     ui-egui/src/lib.rs 456-463          text.setStyle 带 font ⇒ 记进最近使用的字体（最新的在前、最多 10 个）
     ui-egui/src/canvas.rs 902-939       显示隐藏字符的叠画（空格＝点、段落尾＝¶、全文尾＝#，颜色 #4f9dff）
     ui-egui/src/panels/glyphs.rs 1-220  字形面板（七个子集、双击插入：在编辑就插在插入点，否则 type.insert {text}）
     ui-egui/src/find_font.rs 1-127      查找字体对话框（文件里的字体清单、查找／更改／全部更改／完成）
   我们这边的对应：
     ■ 「文字物件」＝文字层（kind:'text'）。目标：给了 ids／layerId 就用；否则正在编辑的那层（文字工具）；否则 AiSel.text（AI 选择菜单选的文字物件）；
       否则当前层若是文字层。原码 texts／text_targets 选不到就报「no text objects selected」，我们一样。
     ■ 文字层资料（tools/text.js）只有 {x,y,text,size,font,color,align,weight,box?}。原码有、我们没有的栏位，这支档加在 L.data 上（跟着历史快照与工程档走）：
         orientation:'vertical'             直排（type.orientation；跟 PS 文字 menus/impl/ps-type.js 同一个栏位）
         area:{rows,columns,gutter,inset,firstBaseline,firstBaselineMin}   区域文字选项（只对有 box 的段落文字）
         tracking / headTracking            字距（1/1000 em；headTracking＝只套第一段，适合标题 text.fitHeadline 用）
         path:{anchors,closed}, pathStart, pathEffect      路径文字（图层坐标的钢笔锚点，同矢量层的 bezier）
         thread:'TH…', threadIndex          串接文本（同一个 thread 的框依 threadIndex 排）
       engine.js 的 renderLayer 只认原本那几栏 ⇒ 带了上面任一栏的文字层，由本档的 AiType.render 照原码版面逐字画（下面「过渡钩子」包一层 renderLayer；之后可接进 engine）。
     ■ 改文件的命令一律 undoable（CMD.run 推历史；失败回 {ok:false} 自动退）；只有 ai.type.insert 在编辑中时走文字工具的打字那条路（并进同一段打字的历史）。 */
(function(){
'use strict';
if (window.AiType && window.AiType.__loaded) return;

/* ═══════════ 小工具 ═══════════ */
const LINE_H = 1.25;                         // 我们渲染器的行距（engine.js renderLayer：size×1.25）
const chars = s => Array.from(String(s == null ? '' : s));
const normText = s => String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => { if (v === undefined || v === null || v === '') return d; const n = +v; return isFinite(n) ? n : d; };
const bool = (v, d) => (v === undefined || v === null) ? d : !!v;
const err = (c, m) => ({ok:false, error:`${c}: ${m}`});
const isText = L => !!L && L.kind === 'text';
const T3 = o => (o && (o[(window.Lang && Lang.cur) || 'zh-Hans'] || o.en)) || '';
const _mc = document.createElement('canvas').getContext('2d');
const fontOf = d => `${d.weight || 'normal'} ${d.size}px ${d.font}`;          // 跟 engine.js renderLayer 同一个字型串
function metrics(d){ _mc.font = fontOf(d); const m = _mc.measureText('Mg'); return [m.fontBoundingBoxAscent || d.size * 0.8, m.fontBoundingBoxDescent || d.size * 0.2]; }
function inkAscent(d, ch, fb){ _mc.font = fontOf(d); const h = _mc.measureText(ch).actualBoundingBoxAscent; return h > 0 ? h : fb; }
/* tools/text.js placeInBox 的同一套：段落文字的锚点跟对齐落在框左／中／右，第一条基线＝框顶＋小写 d 的高度 */
function placeInBox(d){
  const b = d.box; if (!b) return;
  d.x = b.x + (d.align === 'center' ? b.w / 2 : d.align === 'right' ? b.w : 0);
  d.y = b.y + inkAscent(d, 'd', metrics(d)[0] * 0.75);
}
const TT = () => window.TypeTool || null;
const editingLayer = () => { const t = TT(); if (!t || !t.ed) return null; const L = t.layer(); return isText(L) ? L : null; };
const locked = L => !!(window.Locks && Locks.blocks && Locks.blocks(L, 'pixels'));
/* 目标文字层（见档头） */
function textTargets(p){
  p = p || {};
  let out;
  if (Array.isArray(p.ids)) out = p.ids.map(id => Doc.byId(id)).filter(isText);
  else if (p.layerId) out = [Doc.byId(p.layerId)].filter(isText);
  else {
    const E = editingLayer();
    if (E) out = [E];
    else {
      const s = (window.AiSel && Array.isArray(AiSel.text)) ? AiSel.text.map(id => Doc.byId(id)).filter(isText) : [];
      out = s.length ? s : [Doc.active()].filter(isText);
    }
  }
  return out.filter(L => !locked(L));
}
function targetsOr(p, C){ const t = textTargets(p); return t.length ? {t} : {e:err(C, 'no text objects selected')}; }
function touch(L){ if (L.data.box) placeInBox(L.data); Layer.invalidate(L); }

/* ═══════════ 版面（照 vectorcraft text/layout.rs；只给带了扩充栏位的文字层用，一般文字层沿用 tools/text.js 的版面） ═══════════ */
const AREA_DEF = {rows:1, columns:1, gutter:18, inset:0, firstBaseline:'ascent', firstBaselineMin:0};
const FIRST_BASELINES = ['ascent', 'capHeight', 'xHeight', 'leading', 'fixed'];
const areaOpts = d => Object.assign({}, AREA_DEF, (d && d.area) || {});
const areaDefault = a => a.rows === 1 && a.columns === 1 && a.inset === 0 && a.firstBaseline === 'ascent' && a.firstBaselineMin === 0;
const isV = d => !!d && d.orientation === 'vertical';
/* 只有 AI 这边才有的栏位（路径文字、字距、区域文字选项） */
function aiOnly(d){ return !!(d && (d.path || +d.tracking || +d.headTracking || (d.box && d.area && !areaDefault(areaOpts(d))))); }
/* 本档自己画的文字层：带 AI 栏位的；单纯直排的交给 PS 文字的直排（PsTypeRender，两边同一个样子），它没载入才自己画 */
function isExt(d){ return !!(d && (aiOnly(d) || (isV(d) && !window.PsTypeRender))); }

/* 折行规则抄 tools/text.js（UAX#14 常用部分＋行首行尾禁则），量宽多算字距 */
const isWS = c => /\s/.test(c) && c !== ' ';
const isCJK = c => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u.test(c);
const NO_START = new Set(Array.from('、。，．・：；？！ー’”）〕］｝〉》」』】〙〗〟｠»ヽヾゝゞ々〻ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ…‥,.;:!?)]}%'));
const NO_END = new Set(Array.from('‘“（〔［｛〈《「『【〘〖〝｟«([{$'));
function canBreakBefore(cs, i){
  const a = cs[i - 1], b = cs[i];
  if (isWS(b)) return false;
  if (NO_START.has(b) || NO_END.has(a)) return false;
  if (isWS(a)) return true;
  if (a === '-' && i >= 2 && !isWS(cs[i - 2])) return true;
  return isCJK(a) || isCJK(b);
}
/* 量宽：字距照原码加在每个字的步进上（style.tracking／1000 em） */
function measurer(d, cs){
  const font = fontOf(d), n = cs.length, size = d.size;
  let headEnd = 0;
  if (+d.headTracking){ headEnd = cs.indexOf('\n'); if (headEnd < 0) headEnd = n; }
  const trk = i => ((+d.tracking || 0) + (i < headEnd ? +d.headTracking : 0)) * size / 1000;
  return {
    trk,
    w(s, e){ _mc.font = font; let v = _mc.measureText(cs.slice(s, e).join('')).width; for (let k = s; k < e; k++) v += trk(k); return v; },
    xs(s, e){ _mc.font = font; const out = [0]; let acc = '', t = 0; for (let k = s; k < e; k++){ acc += cs[k]; t += trk(k); out.push(_mc.measureText(acc).width + t); } return out; },
    adv(k){ _mc.font = font; return _mc.measureText(cs[k]).width + trk(k); }
  };
}
function wrap(cs, M, avail){
  const n = cs.length, out = [];
  let ps = 0;
  while (true){
    let pe = ps; while (pe < n && cs[pe] !== '\n') pe++;
    let s = ps;
    while (true){
      let lastBreak = -1, cut = -1;
      if (avail !== Infinity){
        for (let i = s; i < pe; i++){
          if (i > s && canBreakBefore(cs, i)) lastBreak = i;
          if (isWS(cs[i])) continue;
          if (M.w(s, i + 1) > avail){ cut = lastBreak > s ? lastBreak : (i > s ? i : i + 1); break; }
        }
      }
      if (cut < 0 || cut >= pe){ out.push({start:s, end:pe, soft:false}); break; }
      out.push({start:s, end:cut, soft:true}); s = cut;
    }
    if (pe >= n) break;
    ps = pe + 1;
  }
  return out;
}

/* 仿射 [a,b,c,d,e,f]：x' = a·x + c·y + e，y' = b·x + d·y + f（kurbo 同序） */
const Af = {
  mul(m, n){ return [m[0]*n[0] + m[2]*n[1], m[1]*n[0] + m[3]*n[1], m[0]*n[2] + m[2]*n[3], m[1]*n[2] + m[3]*n[3], m[0]*n[4] + m[2]*n[5] + m[4], m[1]*n[4] + m[3]*n[5] + m[5]]; },
  t(x, y){ return [1, 0, 0, 1, x, y]; },
  rot(a){ const c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; },
  ap(m, p){ return [m[0]*p[0] + m[2]*p[1] + m[4], m[1]*p[0] + m[3]*p[1] + m[5]]; }
};
/* layout.rs:52 直排时直立的字（中日韩） */
const upright = ch => { const c = ch.codePointAt(0); return (c >= 0x3000 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe10 && c <= 0xfe4f) || (c >= 0xff01 && c <= 0xff60) || (c >= 0x20000 && c <= 0x3134f); };

/* 路径（钢笔锚点，图层坐标）拉平成折线（文件坐标）＋弧长查表（layout.rs ArcPath） */
function arcPath(path, ox, oy){
  const A = (path && path.anchors) || [], pts = [];
  if (!A.length) return null;
  const P = a => [a.x + ox, a.y + oy];
  pts.push(P(A[0]));
  const seg = (p, q) => {
    if (!p.out && !q.in){ pts.push(P(q)); return; }
    const p0 = P(p), c1 = p.out ? [p.out[0] + ox, p.out[1] + oy] : p0, q0 = P(q), c2 = q.in ? [q.in[0] + ox, q.in[1] + oy] : q0;
    const len = Math.hypot(c1[0]-p0[0], c1[1]-p0[1]) + Math.hypot(c2[0]-c1[0], c2[1]-c1[1]) + Math.hypot(q0[0]-c2[0], q0[1]-c2[1]);
    const N = clamp(Math.ceil(len / 2), 8, 256);
    for (let i = 1; i <= N; i++){ const t = i / N, s = 1 - t;
      pts.push([s*s*s*p0[0] + 3*s*s*t*c1[0] + 3*s*t*t*c2[0] + t*t*t*q0[0], s*s*s*p0[1] + 3*s*s*t*c1[1] + 3*s*t*t*c2[1] + t*t*t*q0[1]]); }
  };
  for (let i = 1; i < A.length; i++) seg(A[i - 1], A[i]);
  if (path.closed && A.length >= 2) seg(A[A.length - 1], A[0]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]));
  const len = cum[cum.length - 1];
  if (!(len > 0)) return null;
  return {len, closed:!!path.closed, pts,
    at(s){
      s = clamp(s, 0, len);
      let lo = 0, hi = cum.length - 1;
      while (hi - lo > 1){ const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
      const a = pts[lo], b = pts[hi], L0 = cum[hi] - cum[lo], t = L0 > 0 ? (s - cum[lo]) / L0 : 0;
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
      return [[a[0] + dx * t, a[1] + dy * t], l > 1e-12 ? [dx / l, dy / l] : [1, 0]];
    }};
}
/* 路径文字（layout.rs:828-926 on_path）：每个字放在它中点那里的切线上，五种效果 */
function pathLayout(L){
  const d = L.data, cs = chars(d.text), M = measurer(d, cs);
  const [asc, desc] = metrics(d);
  const out = {glyphs:[], lines:[], frames:[], onPath:true, asc, desc, overflow:false, vis:cs.length};
  const ap = arcPath(d.path, L.x, L.y);
  if (!ap) { out.overflow = cs.length > 0; return out; }
  const idx = []; for (let k = 0; k < cs.length; k++) if (cs[k] !== '\n') idx.push(k);   // 各段的字接在一起（shape_para 不含 \n）
  const adv = idx.map(k => M.adv(k));
  const sStart = clamp(num(d.pathStart, 0), 0, 1) * ap.len;
  const avail = ap.closed ? ap.len : ap.len - sStart;
  const w = adv.reduce((a, b) => a + b, 0);
  const s0 = d.align === 'center' ? sStart + Math.max(0, (avail - w) * 0.5) : d.align === 'right' ? sStart + Math.max(0, avail - w) : sStart;
  const bb = ap.pts.reduce((r, p) => [Math.min(r[0], p[0]), Math.min(r[1], p[1]), Math.max(r[2], p[0]), Math.max(r[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
  const centre = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
  const effect = d.pathEffect || 'rainbow';
  let x = 0;
  for (let j = 0; j < idx.length; j++){
    const k = idx[j], a = adv[j], s = s0 + x;
    if (s + a - sStart > avail + 1e-6){ out.overflow = true; out.vis = k; break; }
    let mid = s + a * 0.5; if (ap.closed) mid = ((mid % ap.len) + ap.len) % ap.len;
    const [p, dir] = ap.at(mid), angle = Math.atan2(dir[1], dir[0]);
    const half = Af.t(-a * 0.5, 0);
    let pre;
    if (effect === 'skew') pre = Af.mul(Af.t(p[0], p[1]), Af.mul([dir[0], dir[1], 0, 1, 0, 0], half));
    else if (effect === '3dRibbon'){ const sx = dir[0] < 0 ? -1 : 1; pre = Af.mul(Af.t(p[0], p[1]), Af.mul([sx, 0, -dir[1] * sx, dir[0] * sx, 0, 0], half)); }
    else if (effect === 'stairStep'){ const sl = ap.closed ? ((s % ap.len) + ap.len) % ap.len : s; const q = ap.at(sl)[0]; pre = Af.t(q[0], q[1]); }
    else if (effect === 'gravity'){
      const nrm = [dir[1], -dir[0]];
      let up = [p[0] - centre[0], p[1] - centre[1]]; const ul = Math.hypot(up[0], up[1]);
      up = ul < 1e-9 ? nrm : [up[0] / ul, up[1] / ul];
      if (up[0]*nrm[0] + up[1]*nrm[1] < 0) up = [-up[0], -up[1]];
      const dn = up[0]*nrm[0] + up[1]*nrm[1];
      if (dn < 0.3){ const t = [up[0] - nrm[0]*dn, up[1] - nrm[1]*dn], tl = Math.max(Math.hypot(t[0], t[1]), 1e-9), r = Math.sqrt(1 - 0.09);
        up = [nrm[0]*0.3 + t[0]/tl*r, nrm[1]*0.3 + t[1]/tl*r]; }
      pre = Af.mul(Af.t(p[0], p[1]), Af.mul([dir[0], dir[1], -up[0], -up[1], 0, 0], half));
    } else pre = Af.mul(Af.t(p[0], p[1]), Af.mul(Af.rot(angle), half));          // rainbow（预设）
    let m = pre;
    if (isV(d)){ const o = [p[0] - dir[0] * a * 0.5, p[1] - dir[1] * a * 0.5]; m = Af.mul(Af.t(o[0], o[1]), Af.mul(Af.rot(Math.PI / 2), Af.mul(Af.t(-o[0], -o[1]), m))); }   // layout.rs:47-49
    out.glyphs.push({ch:cs[k], i:k, m, adv:a});
    x += a;
  }
  return out;
}
/* 点文字／区域文字（含直排、区域文字选项、字距）：先在「逻辑」横排空间排，再照 writing 转成直排（layout.rs:39-57、133-155） */
function flowLayout(L){
  const d = L.data, cs = chars(d.text), n = cs.length, M = measurer(d, cs);
  const [asc, desc] = metrics(d), lead = d.size * LINE_H, V = isV(d);
  const out = {glyphs:[], lines:[], frames:[], onPath:false, asc, desc, overflow:false, vis:n, vertical:V};
  const alignX = (x0, x1, w) => d.align === 'center' ? (x0 + x1) / 2 - w / 2 : d.align === 'right' ? x1 - w : x0;
  const lineW = r => { let e = r.end; while (e > r.start && isWS(cs[e - 1])) e--; return M.w(r.start, e); };
  const lines = [];
  let origin = [0, 0];
  if (d.box){
    const b = {x0:d.box.x + L.x, y0:d.box.y + L.y, x1:d.box.x + L.x + d.box.w, y1:d.box.y + L.y + d.box.h};
    const lf = V ? {x0:b.y0, x1:b.y1, y0:-b.x1, y1:-b.x0} : b;                  // 直排：框先转进逻辑空间（inverse＝[0,-1,1,0]）
    const a = areaOpts(d), rows = Math.max(1, a.rows | 0), cols = Math.max(1, a.columns | 0), g = Math.max(0, a.gutter), inset = Math.max(0, a.inset);
    const cw = Math.max(0, (lf.x1 - lf.x0 - g * (cols - 1)) / cols), rh = Math.max(0, (lf.y1 - lf.y0 - g * (rows - 1)) / rows);
    const cells = [];
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++){               // 先往下、再往右（Region::cells）
      const x0 = lf.x0 + c * (cw + g), y0 = lf.y0 + r * (rh + g);
      cells.push(rows * cols === 1 ? lf : {x0, y0, x1:x0 + cw, y1:y0 + rh});
    }
    out.frames = cells;
    const fbm = {ascent:inkAscent(d, 'd', asc * 0.75), capHeight:inkAscent(d, 'H', asc * 0.7), xHeight:inkAscent(d, 'x', asc * 0.5), leading:lead, fixed:0}[a.firstBaseline];
    const fbOff = Math.max(fbm === undefined ? asc : fbm, Math.max(0, num(a.firstBaselineMin, 0)));
    const R = wrap(cs, M, Math.max(1, (rows * cols === 1 ? lf.x1 - lf.x0 : cw) - 2 * inset));
    let ci = 0, prev = null;
    for (const r of R){
      let placed = false;
      while (ci < cells.length){
        const c = cells[ci], base = prev === null ? c.y0 + inset + fbOff : prev + lead;
        if (base + desc > c.y1 - inset + 0.5 && lines.length){ ci++; prev = null; continue; }   // 放不下：下一格（第一行一定留，同 tools/text.js）
        const w = lineW(r);
        lines.push({start:r.start, end:r.end, soft:r.soft, baseline:base, x:alignX(c.x0 + inset, c.x1 - inset, w), w, xs:M.xs(r.start, r.end)});
        prev = base; placed = true; break;
      }
      if (!placed){ out.overflow = true; out.vis = r.start; break; }
    }
  } else {
    origin = [d.x + L.x, d.y + L.y];
    wrap(cs, M, Infinity).forEach((r, k) => { const w = lineW(r); lines.push({start:r.start, end:r.end, soft:false, baseline:k * lead, x:alignX(0, 0, w), w, xs:M.xs(r.start, r.end)}); });
  }
  const toDoc = (lx, ly) => V ? [origin[0] - ly, origin[1] + lx] : [origin[0] + lx, origin[1] + ly];
  lines.forEach((l, li) => {
    for (let k = l.start; k < l.end; k++){
      const ch = cs[k]; if (ch === '\n') continue;
      const gx = l.x + l.xs[k - l.start], adv = l.xs[k - l.start + 1] - l.xs[k - l.start], P = toDoc(gx, l.baseline);
      const m = !V ? [1, 0, 0, 1, P[0], P[1]] : upright(ch) ? [1, 0, 0, 1, P[0] - desc, P[1] + asc] : [0, 1, -1, 0, P[0], P[1]];
      out.glyphs.push({ch, i:k, m, adv});
    }
    const last = li === lines.length - 1;
    out.lines.push({start:l.start, end:l.end, baseline:l.baseline, end_pt:toDoc(l.x + l.w + 1, l.baseline), rot:V,
      brk: (last && l.end >= n) ? '#' : cs[l.end] === '\n' ? '¶' : ''});
  });
  if (V) out.frames = out.frames.map(f => ({x0:-f.y1, y0:f.x0, x1:-f.y0, y1:f.x1}));
  return out;
}
/* 一般文字层：直接用 tools/text.js 的版面（跟 engine.js 画出来的一样） */
function stdLayout(L){
  const d = L.data, cs = chars(d.text), n = cs.length;
  const [asc, desc] = metrics(d);
  const out = {glyphs:[], lines:[], frames:[], onPath:false, asc, desc, overflow:false, vis:n};
  const t = TT();
  if (!t || !t.layout){ return flowLayout(L); }
  const lay = t.layout(L);
  lay.lines.forEach((l, li) => {
    for (let k = l.start; k < l.end; k++){ const ch = cs[k]; if (ch === '\n') continue; out.glyphs.push({ch, i:k, m:[1, 0, 0, 1, l.xs[k - l.start], l.baseline], adv:l.xs[k - l.start + 1] - l.xs[k - l.start]}); }
    const last = li === lay.lines.length - 1;
    out.lines.push({start:l.start, end:l.end, baseline:l.baseline, end_pt:[l.x1 + 1, l.baseline], brk:(last && l.end >= n) ? '#' : cs[l.end] === '\n' ? '¶' : ''});
  });
  const lastL = lay.lines[lay.lines.length - 1];
  if (lastL && lastL.end < n){ out.overflow = true; out.vis = lastL.end; }
  return out;
}
/* 单纯直排、由 PS 文字（ps-type.js）画的层：把它的 vLayout（栏、直立／转 90° 的字串）拆成一个个字，位置跟它画的一样 */
function psVLayout(L){
  const d = L.data, v = PsTypeRender.vLayout(L), cs = chars(d.text), [asc, desc] = metrics(d);
  const out = {glyphs:[], lines:[], frames:[], onPath:false, asc, desc, overflow:false, vis:cs.length, vertical:true};
  _mc.font = fontOf(d);
  v.cols.forEach((col, ci) => {
    let i = col.start;
    for (const rn of col.runs){
      const rc = chars(rn.text);
      if (rn.rot){                                                             // 顺时针 90°、基线在栏中线左边 centre
        let pre = 0;
        rc.forEach((ch, j) => { const w = _mc.measureText(rc.slice(0, j + 1).join('')).width; out.glyphs.push({ch, i:i + j, m:[0, 1, -1, 0, col.cx - v.centre + L.x, rn.u + pre + L.y], adv:w - pre}); pre = w; });
      } else {                                                                 // 直立：字身居中、表意字框底＝这一格的底（textBaseline ideographic → 换成 alphabetic 原点）
        const ib = _mc.measureText(rn.text).ideographicBaseline;
        let x = col.cx - rn.adv / 2, y = rn.u + rn.adv;
        if (rn.punct){ x += rn.adv * 0.55; y -= rn.adv * 0.55; }
        out.glyphs.push({ch:rn.text, i, m:[1, 0, 0, 1, x + L.x, y + (isFinite(ib) ? ib : -desc) + L.y], adv:rn.adv});
      }
      i += rc.length;
    }
    const last = ci === v.cols.length - 1;
    out.lines.push({start:col.start, end:col.end, end_pt:[col.cx - v.half + L.x, col.u1 + v.size + L.y], brk:(last && col.end >= cs.length) ? '#' : cs[col.end] === '\n' ? '¶' : ''});
  });
  const lc = v.cols[v.cols.length - 1];
  if (lc && lc.end < cs.length){ out.overflow = true; out.vis = lc.end; }
  return out;
}
const layoutOf = L => isExt(L.data) ? (L.data.path ? pathLayout(L) : flowLayout(L))
  : (isV(L.data) && window.PsTypeRender && PsTypeRender.vLayout) ? psVLayout(L) : stdLayout(L);
/* 外框（文件坐标）：每个字的 [0,-asc]～[adv,desc] 转过去取联集；区域文字连框一起 */
function boundsOf(L){
  const lay = layoutOf(L);
  let r = null;
  const add = p => { r = r ? [Math.min(r[0], p[0]), Math.min(r[1], p[1]), Math.max(r[2], p[0]), Math.max(r[3], p[1])] : [p[0], p[1], p[0], p[1]]; };
  lay.glyphs.forEach(g => [[0, -lay.asc], [g.adv, -lay.asc], [g.adv, lay.desc], [0, lay.desc]].forEach(q => add(Af.ap(g.m, q))));
  const d = L.data;
  if (d.box && !d.path){ add([d.box.x + L.x, d.box.y + L.y]); add([d.box.x + L.x + d.box.w, d.box.y + L.y + d.box.h]); }
  if (!r) add([d.x + L.x, d.y + L.y]);
  return {x0:r[0], y0:r[1], x1:r[2], y1:r[3]};
}
/* 画带扩充栏位的文字层（铁律①：按 scale 重画；铁律③：按视角缓存） */
function renderExt(L, scale){
  if (L._cache && L._cacheScale === scale) return L._cache;
  const W = Math.max(1, Math.round(Doc.width * scale)), H = Math.max(1, Math.round(Doc.height * scale));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), d = L.data;
  x.font = fontOf(d); x.fillStyle = d.color; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  for (const g of layoutOf(L).glyphs){
    if (isWS(g.ch) || /\p{Cc}/u.test(g.ch) || g.ch === '­') continue;          // 控制字（Tab）与选择性连字号不画（layout.rs:58-60）
    const m = g.m; x.setTransform(m[0] * scale, m[1] * scale, m[2] * scale, m[3] * scale, m[4] * scale, m[5] * scale);
    x.fillText(g.ch, 0, 0);
  }
  L._cache = c; L._cacheScale = scale;
  return c;
}

/* ═══════════ 状态 ═══════════ */
const LS_RECENT = 'dlcanvas.ai.recentFonts';
const AiType = window.AiType = {
  __loaded: true,
  hiddenChars: false,
  _recent: (() => { try { const v = JSON.parse(localStorage.getItem(LS_RECENT) || '[]'); return Array.isArray(v) ? v.slice(0, 10) : []; } catch(e){ return []; } })(),
  recentFonts(){ return this._recent.slice(); },
  /* lib.rs:456-463：最新的在前、去重、最多 10 个 */
  noteFont(f){
    if (!f) return;
    f = String(f);
    this._recent = [f].concat(this._recent.filter(x => x !== f)).slice(0, 10);
    try { localStorage.setItem(LS_RECENT, JSON.stringify(this._recent)); } catch(e){}
  },
  textTargets, isExt, layoutOf, boundsOf, render:renderExt, areaOpts,
  glyphsOpen(){ return window.DlPanels && DlPanels.has('glyphs') ? DlPanels.isOpen('glyphs') : !!document.getElementById('aiGlyphsPanel'); },
  /* menus.rs:1117-1124／1130-1137：勾选状态看选取里第一个文字物件 */
  orientationOf(){ const L = textTargets({})[0]; return L ? (isV(L.data) ? 'vertical' : 'horizontal') : null; },
  pathEffectOf(){ const L = textTargets({}).find(x => x.data.path); return L ? (L.data.pathEffect || 'rainbow') : null; }
};

/* ═══════════ 字体／大小（text.setStyle 的 AI 版：套在 AI 的文字物件上；字体记进最近使用的字体） ═══════════ */
const ALIGNS = ['left', 'center', 'right'];
function styleToWeight(s){ const t = TT(); return t && t.styleToWeight ? t.styleToWeight(s) : (/bold/i.test(s) ? '700' : 'normal'); }
CMD.reg('ai.text.setStyle', {i18n:'', undoable:true,
  params:'{ids?|layerId?（缺省＝编辑中的文字层→AI 选的文字物件→当前文字层）, font?, fontStyle?:"Regular|Bold|Italic|…", size?:pt(=px), color?, align?:"left|center|right", tracking?:1/1000 em} 文字 ▸ 字体／大小：改整层样式（typecmd.rs set_style）；给了 font 就记进「最近使用的字体」 → {ok, ids}'}, p => {
  const C = 'ai.text.setStyle', x = targetsOr(p, C); if (x.e) return x.e;
  if (p.size !== undefined && !(+p.size > 0)) return err(C, 'size must be positive');
  if (!p.font && !p.fontStyle && p.size === undefined && !p.color && !p.align && p.tracking === undefined) return err(C, 'nothing to change');
  for (const L of x.t){
    const d = L.data;
    if (p.font) d.font = String(p.font);
    if (p.fontStyle) d.weight = styleToWeight(p.fontStyle);
    if (p.size !== undefined) d.size = clamp(+p.size, 0.1, 1296);
    if (p.color) d.color = String(p.color);
    if (ALIGNS.includes(p.align)) d.align = p.align;
    if (p.tracking !== undefined) d.tracking = clamp(num(p.tracking, 0), -1000, 10000);
    touch(L);
  }
  if (p.font) AiType.noteFont(p.font);
  reflowThreads(x.t);
  return {ok:true, ids:x.t.map(L => L.id)};
});
/* 一般的 text.setStyle（选项栏改字体那条）也记最近使用的字体（lib.rs:456 是在 app.run 里对所有 text.setStyle 记的）——过渡包装 */
function hookSetStyle(){
  const c = CMD.map['text.setStyle'];
  if (!c || c.__aiTypeFont) return;
  const o = c.run;
  c.run = function(p){ const r = o.apply(this, arguments); if (p && p.font && !(r && r.ok === false)) AiType.noteFont(p.font); return r; };
  c.__aiTypeFont = true;
}
hookSetStyle();
for (let k = 1; k <= 10; k++){
  CMD.reg('ai.type.recentFont' + k, {i18n:'', undoable:true, params:`{ids?|layerId?} 文字 ▸ 最近使用的字体 ▸ 第 ${k} 个：把那个字体套到文字物件上（menus.rs:805-811 ＝ text.setStyle {font}）`}, p => {
    const f = AiType.recentFonts()[k - 1];
    if (!f) return err('ai.type.recentFont' + k, 'no such recent font');
    return CMD.map['ai.text.setStyle'].run(Object.assign({}, p, {font:f}));
  });
}
CMD.reg('ai.type.recentFonts', {i18n:'', params:'{} 最近使用的字体清单（最新的在前）→ {ok, fonts}'}, () => ({ok:true, fonts:AiType.recentFonts()}));

/* ═══════════ 插入字元（typemenu.rs:419-473） ═══════════ */
const SPECIAL = {bullet:'•', copyright:'©', ellipsis:'…', paragraph:'¶', registered:'®', section:'§', trademark:'™', emDash:'—', enDash:'–',
  discretionaryHyphen:'­', nonBreakingHyphen:'‑', doubleLeftQuote:'“', doubleRightQuote:'”', singleLeftQuote:'‘', singleRightQuote:'’',
  emSpace:' ', enSpace:' ', hairSpace:' ', sixthSpace:' ', thinSpace:' ', nonBreakingSpace:' ', figureSpace:' ',
  punctuationSpace:' ', thirdSpace:' ', quarterSpace:' ', tab:'\t', forcedLineBreak:'\n', paragraphReturn:'\n'};   // 「我们的文字只在段落换行处断行」⇒ 强制换行＝\n（原码同）
AiType.SPECIAL = SPECIAL;
CMD.reg('ai.type.insert', {i18n:'',
  params:'{char:"' + Object.keys(SPECIAL).join('"|"') + '" | text:str, ids?|layerId?} 文字 ▸ 插入特殊字符／空白字符／分隔符：正在用文字工具编辑 ⇒ 换掉插入点上的选取（跟打字同一步历史，同字形面板）；' +
         '没在编辑 ⇒ 接在目标文字物件的最后（typemenu.rs insert_char；可 Ctrl+Z） → {ok, ids, at?}'}, p => {
  const C = 'ai.type.insert';
  let s;
  if (typeof p.char === 'string'){ s = SPECIAL[p.char]; if (s === undefined) return err(C, `unknown character \`${p.char}\``); }
  else if (typeof p.text === 'string') s = normText(p.text);
  else return err(C, 'give `char` or `text`');
  const E = editingLayer(), t = TT();
  if (E && !Array.isArray(p.ids) && (!p.layerId || p.layerId === E.id)){
    if (locked(E)) return err(C, 'the layer is locked');
    t.insert(s);
    reflowThreads([E]);
    return {ok:true, ids:[E.id], at:t.ed ? t.ed.caret : null};
  }
  const x = targetsOr(p, C); if (x.e) return x.e;
  History.push();
  for (const L of x.t){ L.data.text = String(L.data.text) + s; touch(L); }
  reflowThreads(x.t);
  return {ok:true, ids:x.t.map(L => L.id)};
});

/* ═══════════ 更改大小写（typemenu.rs:159-211）：状态跨整层 ═══════════ */
const isAlpha = c => /\p{Alphabetic}/u.test(c);
function changeCase(text, kase){
  let prev = null, sentence = true, out = '';
  for (const c of text){
    if (kase === 'upper') out += c.toUpperCase();
    else if (kase === 'lower') out += c.toLowerCase();
    else if (kase === 'title') out += (prev === null || /\s/.test(prev) || '-("“/'.includes(prev)) ? c.toUpperCase() : c.toLowerCase();
    else {
      if (isAlpha(c) && sentence){ out += c.toUpperCase(); sentence = false; } else out += c.toLowerCase();
      if ('.!?\n'.includes(c)) sentence = true;
    }
    prev = c;
  }
  return out;
}
CMD.reg('ai.type.changeCase', {i18n:'', undoable:true, params:'{case:"upper"|"lower"|"title"|"sentence", ids?} 文字 ▸ 更改大小写：整个文字物件改大写／小写／词首大写／句首大写 → {ok, ids}'}, p => {
  const C = 'ai.type.changeCase';
  let k = String(p.case || '').toLowerCase();
  if (!k) return err(C, 'missing case');
  if (k === 'uppercase') k = 'upper'; if (k === 'lowercase') k = 'lower';
  if (!['upper', 'lower', 'title', 'sentence'].includes(k)) return err(C, 'case must be upper|lower|title|sentence');
  const x = targetsOr(p, C); if (x.e) return x.e;
  for (const L of x.t){ const v = changeCase(L.data.text, k); if (v !== L.data.text){ L.data.text = v; touch(L); } }
  reflowThreads(x.t);
  return {ok:true, ids:x.t.map(L => L.id)};
});

/* ═══════════ 智能标点（typemenu.rs:213-256、setup.rs Quotes::apply） ═══════════ */
const QUOTES_EN = {double:['“', '”'], single:['‘', '’']};
function smarten(text, quotes, dashes, ellipsis){
  let s = text;
  if (dashes) s = s.split('---').join('—').split('--').join('–');
  if (ellipsis) s = s.split('...').join('…');
  if (!quotes) return s;
  const isOpen = c => c === quotes.double[0] || c === quotes.single[0];
  const opens = p => p === null || /\s/.test(p) || '([{—–'.includes(p) || isOpen(p);
  let prev = null, out = '';
  for (const c of s){ const r = c === '"' ? quotes.double[opens(prev) ? 0 : 1] : c === "'" ? quotes.single[opens(prev) ? 0 : 1] : c; out += r; prev = r; }
  return out;
}
CMD.reg('ai.type.smartPunctuation', {i18n:'', undoable:true,
  params:'{quotes?:true（直引号换成文件设定的弯引号；没有文件设定＝英文 “” ‘’）, dashes?:true（-- → 半角破折号、--- → 全角破折号）, ellipsis?:true（... → …）, scope?:"selection"|"document"（没选文字物件也算全文件）} 文字 ▸ 智能标点 → {ok, changed}'}, p => {
  const q = bool(p.quotes, true) ? ((Doc.setup && Doc.setup.quotes) || QUOTES_EN) : null, dsh = bool(p.dashes, true), el = bool(p.ellipsis, true);
  let list = p.scope === 'document' ? [] : textTargets(p);
  if (p.scope === 'document' || !list.length) list = Doc.layers.filter(isText).filter(L => !locked(L));
  let changed = 0;
  for (const L of list){ const v = smarten(L.data.text, q, dsh, el); if (v !== L.data.text){ L.data.text = v; touch(L); changed++; } }
  reflowThreads(list);
  return {ok:true, changed};
});
CMD.reg('ai.type.smartPunctuation.dialog', {i18n:'', params:'{} 开「智能标点」对话框（menus.rs:2203 「…」项开参数对话框，栏位＝菜单带的预设 quotes/dashes/ellipsis/scope），确定＝ai.type.smartPunctuation'}, () => {
  Dlg.form('aiTypeSmartDlg', 'aitype.smartTitle', [
    {k:'quotes', label:'aitype.quotes', type:'check', value:true}, {k:'dashes', label:'aitype.dashes', type:'check', value:true},
    {k:'ellipsis', label:'aitype.ellipsis', type:'check', value:true},
    {k:'scope', label:'aitype.scope', type:'select', value:'selection', options:[['selection', 'aitype.scopeSel'], ['document', 'aitype.scopeDoc']]}],
    v => CMD.run('ai.type.smartPunctuation', v));
  return {ok:true, dialog:true};
});

/* ═══════════ 转换为区域文字／点状文字（typemenu.rs:258-342） ═══════════ */
CMD.reg('ai.type.convertToAreaType', {i18n:'', undoable:true, params:'{ids?} 点状文字 → 区域文字：框＝目前版面的外框（对齐那一边多留半个字宽，免得重新折行），第一条基线不动 → {ok, ids}'}, p => {
  const C = 'ai.type.convertToAreaType', x = targetsOr(p, C); if (x.e) return x.e;
  for (const L of x.t){
    const d = L.data;
    if (d.box || d.path) continue;
    const b = boundsOf(L), slack = d.size * 0.5;
    const [sl, sr] = d.align === 'center' ? [slack * 0.5, slack * 0.5] : d.align === 'right' ? [slack, 0] : [0, slack];
    const top = d.y - inkAscent(d, 'd', metrics(d)[0] * 0.75);                  // 框顶＝基线－d 的高度 ⇒ placeInBox 算回同一条基线（文字不动）
    d.box = {x:b.x0 - L.x - sl, y:top, w:Math.max(1, b.x1 - b.x0 + sl + sr), h:Math.max(1, b.y1 - L.y - top)};
    touch(L);
  }
  return {ok:true, ids:x.t.map(L => L.id)};
});
CMD.reg('ai.type.convertToPointType', {i18n:'', undoable:true, params:'{ids?} 区域文字 → 点状文字：自动折行处变成换行（折行前是空格就换掉那个空格），锚点留在第一行对齐的那一点 → {ok, ids}'}, p => {
  const C = 'ai.type.convertToPointType', x = targetsOr(p, C); if (x.e) return x.e;
  for (const L of x.t){
    const d = L.data; if (!d.box) continue;
    const lay = layoutOf(L), cs = chars(d.text);
    let breaks = lay.lines.slice(1).map(l => l.start).filter(b => b > 0 && cs[b - 1] !== '\n');
    breaks = [...new Set(breaks)].sort((a, b) => b - a);
    for (const b of breaks){ if (cs[b - 1] === ' ') cs[b - 1] = '\n'; else cs.splice(b, 0, '\n'); }
    // 锚点：tools/text.js 的点文字锚点＝d.x（对齐点）、基线 d.y——placeInBox 已经放好；直排／有区域选项的照第一行
    if (isExt(d) && lay.lines.length && !isV(d)){
      const l0 = lay.lines[0];
      d.y = l0.baseline - L.y;
      const fr = lay.frames[0], ins = areaOpts(d).inset;
      if (fr) d.x = (d.align === 'center' ? (fr.x0 + fr.x1) / 2 : d.align === 'right' ? fr.x1 - ins : fr.x0 + ins) - L.x;
    }
    d.text = cs.join('');
    delete d.box;
    Layer.invalidate(L);
  }
  reflowThreads(x.t, true);
  return {ok:true, ids:x.t.map(L => L.id)};
});

/* ═══════════ 区域文字选项（typecmd.rs:268-312） ═══════════ */
CMD.reg('ai.text.areaOptions', {i18n:'',
  params:'{ids?, rows?:1..100, columns?:1..100, gutter?:pt(0..10000), inset?:pt, firstBaseline?:"ascent"|"capHeight"|"xHeight"|"leading"|"fixed", firstBaselineMin?:pt} 区域文字选项：设定选取里区域文字（段落文字）的行／列、间距、内边距、首行基线；什么都没给＝查询 → 第一个物件的选项'}, p => {
  const C = 'ai.text.areaOptions';
  const t = textTargets(p).filter(L => L.data.box && !L.data.path);
  if (!t.length) return err(C, 'select area type (text in a frame)');
  const cur = areaOpts(t[0].data), keys = Object.keys(AREA_DEF);
  const given = keys.filter(k => p[k] !== undefined && p[k] !== null);
  if (!given.length) return Object.assign({ok:true}, cur);
  const o = Object.assign({}, cur);
  given.forEach(k => { o[k] = p[k]; });
  if (!FIRST_BASELINES.includes(o.firstBaseline)) return err(C, `unknown variant \`${o.firstBaseline}\``);
  o.rows = clamp(Math.round(num(o.rows, 1)), 1, 100); o.columns = clamp(Math.round(num(o.columns, 1)), 1, 100);
  o.gutter = clamp(num(o.gutter, 18), 0, 10000); o.inset = clamp(num(o.inset, 0), 0, 10000); o.firstBaselineMin = clamp(num(o.firstBaselineMin, 0), 0, 10000);
  History.push();                                                          // 只有真的改才进历史（查询不留空的一步）
  for (const L of t){ L.data.area = Object.assign({}, o); Layer.invalidate(L); }
  reflowThreads(t);
  return Object.assign({ok:true}, o);
});
CMD.reg('ai.text.areaOptions.dialog', {i18n:'', params:'{} 开「区域文字选项」对话框，栏位带选取里第一个区域文字的目前值（menus.rs:2257-2263），确定＝ai.text.areaOptions'}, () => {
  const q = CMD.run('ai.text.areaOptions', {});
  if (!q || q.ok === false) return q;
  Dlg.form('aiTypeAreaDlg', 'aitype.areaTitle', [
    {k:'rows', label:'aitype.rows', type:'number', value:q.rows, min:1, max:100}, {k:'columns', label:'aitype.columns', type:'number', value:q.columns, min:1, max:100},
    {k:'gutter', label:'aitype.gutter', type:'number', value:q.gutter, min:0}, {k:'inset', label:'aitype.inset', type:'number', value:q.inset, min:0},
    {k:'firstBaseline', label:'aitype.firstBaseline', type:'select', value:q.firstBaseline, options:FIRST_BASELINES.map(k => [k, 'aitype.fb.' + k])},
    {k:'firstBaselineMin', label:'aitype.firstBaselineMin', type:'number', value:q.firstBaselineMin, min:0}],
    v => CMD.run('ai.text.areaOptions', v));
  return {ok:true, dialog:true};
});

/* ═══════════ 路径文字（typemenu.rs:344-376；textedit.rs:338-395 createInPath） ═══════════ */
const EFFECTS = ['rainbow', 'skew', '3dRibbon', 'stairStep', 'gravity'];
const parseEffect = e => { const k = String(e).toLowerCase().replace(/[ \-_]/g, ''); return EFFECTS.find(x => x.toLowerCase() === k) || (k === 'ribbon3d' ? '3dRibbon' : null); };
function reverseView(v){
  const A = v.anchors.slice().reverse().map(a => ({x:a.x, y:a.y, in:a.out ? a.out.slice() : null, out:a.in ? a.in.slice() : null}));
  return {anchors:A, closed:v.closed};
}
CMD.reg('ai.type.pathOptions', {i18n:'', undoable:true,
  params:'{start?:0..1（路径长度的比例）, flip?:bool（把路径反过来）, effect?:"rainbow"|"skew"|"3dRibbon"|"stairStep"|"gravity", ids?} 路径文字选项／路径文字效果：只改选取里的路径文字 → {ok, changed}'}, p => {
  const C = 'ai.type.pathOptions';
  let eff = null;
  if (p.effect !== undefined){ eff = parseEffect(p.effect); if (!eff) return err(C, `unknown effect \`${p.effect}\``); }
  const t = textTargets(p).filter(L => L.data.path);
  if (!t.length) return err(C, 'select type on a path');
  for (const L of t){
    const d = L.data;
    if (p.start !== undefined && p.start !== null) d.pathStart = clamp(num(p.start, 0), 0, 1);
    if (p.flip) d.path = reverseView(d.path);
    if (eff) d.pathEffect = eff;
    Layer.invalidate(L);
  }
  return {ok:true, changed:t.length};
});
CMD.reg('ai.type.pathOptions.dialog', {i18n:'', params:'{} 开「路径文字选项」对话框（效果、起点、翻转），确定＝ai.type.pathOptions'}, () => {
  const L = textTargets({}).find(x => x.data.path);
  if (!L) return err('ai.type.pathOptions', 'select type on a path');
  Dlg.form('aiTypePathDlg', 'aitype.pathTitle', [
    {k:'effect', label:'aitype.effect', type:'select', value:L.data.pathEffect || 'rainbow', options:EFFECTS.map(k => [k, 'aitype.eff.' + k])},
    {k:'start', label:'aitype.start', type:'number', value:num(L.data.pathStart, 0), min:0, max:1, step:0.01},
    {k:'flip', label:'aitype.flip', type:'check', value:false}],
    v => CMD.run('ai.type.pathOptions', v));
  return {ok:true, dialog:true};
});
/* 路径变成路径文字（或区域文字）的基线：路径从矢量层拿掉，换成一个新的文字层（插在那个矢量层上面） */
CMD.reg('ai.text.createInPath', {i18n:'', undoable:true,
  params:'{path:形状 id, layerId?:矢量层（缺省＝当前／节点选取那层）, mode:"onPath"|"area"="onPath", text?:"", size?, font?, vertical?:false, at?:[x,y] 文件坐标（路径文字起点＝路径上最近的点）} 把路径变成路径文字的基线或区域文字框（路径的外观丢掉；区域文字我们只有矩形框 ⇒ 用路径外框） → {ok, id}'}, p => {
  const C = 'ai.text.createInPath';
  const V = p.layerId ? Doc.byId(p.layerId) : (Doc.active() && Doc.active().kind === 'vector' ? Doc.active() : (window.VecSel ? VecSel.layer() : null));
  if (!V || V.kind !== 'vector') return err(C, 'not a vector layer');
  const sid = p.path !== undefined ? p.path : (window.VecSel && VecSel.layerId === V.id ? VecSel.shapes[0] : null);
  const i = V.data.shapes.findIndex(s => s.id === sid);
  if (i < 0) return err(C, 'missing `path` (a path object id)');
  const view = VecSel.asBezier(V.data.shapes[i]);
  if (!view || !view.anchors || view.anchors.length < 2) return err(C, '`path` must be a path object');
  const onPath = (p.mode || 'onPath') !== 'area';
  if (p.mode && !['area', 'onPath', 'path'].includes(p.mode)) return err(C, `mode must be area|onPath, got ${p.mode}`);
  const pathDoc = {anchors:view.anchors.map(a => ({x:a.x + V.x, y:a.y + V.y, in:a.in ? [a.in[0] + V.x, a.in[1] + V.y] : null, out:a.out ? [a.out[0] + V.x, a.out[1] + V.y] : null})), closed:!!view.closed};
  const ap = arcPath(pathDoc, 0, 0);
  if (!ap) return err(C, 'the path is empty');
  const xs = ap.pts.map(q => q[0]), ys = ap.pts.map(q => q[1]);
  const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  if (!onPath && (bb[2] - bb[0] < 1 || bb[3] - bb[1] < 1)) return err(C, 'area type needs a path that encloses an area');
  let start = 0;
  if (onPath && Array.isArray(p.at)){                                        // path_fraction_at：最近点的弧长比例
    let best = Infinity, acc = 0;
    for (let k = 1; k < ap.pts.length; k++){
      const a = ap.pts[k - 1], b = ap.pts[k], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx*dx + dy*dy, l = Math.sqrt(l2);
      const t = l2 > 0 ? clamp(((p.at[0] - a[0]) * dx + (p.at[1] - a[1]) * dy) / l2, 0, 1) : 0;
      const dd = Math.hypot(a[0] + dx * t - p.at[0], a[1] + dy * t - p.at[1]);
      if (dd < best){ best = dd; start = (acc + l * t) / ap.len; }
      acc += l;
    }
  }
  const fill = window.UI && UI.fill ? UI.fill() : '#000000';
  const d = {text:normText(p.text || ''), size: +p.size > 0 ? +p.size : (window.ToolState ? ToolState.fontSize : 24), font:p.font || 'sans-serif',
    color:(fill && fill !== 'none' && fill.toLowerCase() !== '#ffffff') ? fill : '#000000', align:'left', weight:'normal'};
  if (p.vertical) d.orientation = 'vertical';
  if (onPath){ d.path = pathDoc; d.pathStart = start; d.pathEffect = 'rainbow'; const q = ap.at(start * ap.len)[0]; d.x = q[0]; d.y = q[1]; }
  else { d.box = {x:bb[0], y:bb[1], w:bb[2] - bb[0], h:bb[3] - bb[1]}; placeInBox(d); }
  const src = V.data.shapes[i];
  V.data.shapes.splice(i, 1); Layer.invalidate(V);
  if (window.VecSel && VecSel.layerId === V.id) VecSel.removeShape(src.id);
  const T = Layer.text(src.name || (d.text.split('\n')[0] || Lang.t('layer.text')), d);
  T.opacity = typeof src.opacity === 'number' ? src.opacity : 1;
  Doc.add(T, Doc.index(V.id) + 1);
  Doc.activeId = V.id;                                                      // 留在矢量层（AI 菜单）；新的路径文字成为选中的文字物件
  if (window.AiSel) AiSel.text = [T.id];
  if (window.UI && UI.refresh) setTimeout(() => UI.refresh(), 0);
  return {ok:true, id:T.id};
});

/* ═══════════ 用占位符文本填充（typemenu.rs:378-417） ═══════════ */
const PLACEHOLDER = 'Sample copy flows here while the layout takes shape. Swap these words for real text once the design is settled. Every line is only a stand-in that shows size, rhythm and colour. Headlines, captions and body text all start as rough drafts like this one. Keep going until the frame is full and the page feels balanced.';
AiType.PLACEHOLDER = PLACEHOLDER;
CMD.reg('ai.type.fillPlaceholder', {i18n:'', undoable:true, params:'{ids?} 用占位符文本填充：区域文字填满它的框（每行字数≈框宽÷半个字号，行数≈框高÷行距），点状文字放一句 → {ok, ids}'}, p => {
  const C = 'ai.type.fillPlaceholder', x = targetsOr(p, C); if (x.e) return x.e;
  for (const L of x.t){
    const d = L.data;
    if (d.box){
      const perLine = Math.max(1, d.box.w / (d.size * 0.5)), lines = Math.max(1, d.box.h / (d.size * LINE_H));
      const want = Math.floor(perLine * lines), words = PLACEHOLDER.split(' ');
      let out = '', i = 0;
      while (out.length < want && i < 10000){ if (out) out += ' '; out += words[i % words.length]; i++; }
      d.text = out;
    } else d.text = PLACEHOLDER.split('. ')[0] + '.';
    touch(L);
  }
  return {ok:true, ids:x.t.map(L => L.id)};
});

/* ═══════════ 文字方向（typecmd.rs:76-89） ═══════════ */
['vertical', 'horizontal'].forEach(k => {
  CMD.reg('ai.type.orientation.' + k, {i18n:'', undoable:true, params:`{ids?} 文字 ▸ 文字方向 ▸ ${k === 'vertical' ? '垂直（直排：由上而下、由右而左；中日韩字直立，其余字转 90°）' : '水平'} → {ok, vertical, ids}`}, p => {
    const x = targetsOr(p, 'Text Orientation'); if (x.e) return x.e;
    for (const L of x.t){ L.data.orientation = k; Layer.invalidate(L); }
    reflowThreads(x.t);
    return {ok:true, vertical:k === 'vertical', ids:x.t.map(L => L.id)};
  });
});

/* ═══════════ 适合标题（typecmd.rs:347-393）：第一段的字距调到「刚好还是一行」的最大值 ═══════════ */
function headlineFit(L, tr){
  const d = Object.assign({}, L.data, {headTracking:tr});
  const cs = chars(d.text), M = measurer(d, cs), a = areaOpts(d);
  const cols = Math.max(1, a.columns | 0), g = Math.max(0, a.gutter);
  const fw = isV(d) ? d.box.h : d.box.w;
  const cw = cols === 1 && a.rows === 1 ? fw : (fw - g * (cols - 1)) / cols;
  const avail = Math.max(1, cw - 2 * a.inset);
  let pe = cs.indexOf('\n'); if (pe < 0) pe = cs.length;
  return wrap(cs.slice(0, pe), M, avail).length;
}
CMD.reg('ai.text.fitHeadline', {i18n:'', undoable:true, params:'{ids?} 适合标题：区域文字第一段的字距调大（或调小）到刚好填满框宽、仍是一行（-200～2000 二分 24 次，取到 0.1）；其余段落不动 → {ok, tracking}'}, p => {
  const C = 'ai.text.fitHeadline';
  const plans = [];
  for (const L of textTargets(p)){
    if (!L.data.box || L.data.path) continue;
    let lo = -200, hi = 2000;
    if (headlineFit(L, lo) !== 1) continue;
    for (let i = 0; i < 24; i++){ const mid = (lo + hi) / 2; if (headlineFit(L, mid) === 1) lo = mid; else hi = mid; }
    plans.push([L, Math.floor(lo * 10) / 10]);
  }
  if (!plans.length) return err(C, 'select area type whose first line can fit its frame');
  plans.forEach(([L, tr]) => { L.data.headTracking = tr; Layer.invalidate(L); });
  reflowThreads(plans.map(x => x[0]));
  return {ok:true, tracking:plans[0][1]};
});

/* ═══════════ 串接文本（threads.rs）：thread＝同一个 id 的区域文字框，依 threadIndex 排 ═══════════ */
const threadsOf = () => {
  const m = new Map();
  Doc.layers.forEach(L => { if (isText(L) && L.data.thread) { if (!m.has(L.data.thread)) m.set(L.data.thread, []); m.get(L.data.thread).push(L); } });
  m.forEach(v => v.sort((a, b) => (a.data.threadIndex || 0) - (b.data.threadIndex || 0)));
  return m;
};
/* 一个框排得下故事的前几个字（一般框照 tools/text.js 的折行与「超出框底不排」，扩充框照本档版面） */
function fitCount(L, story){
  const d0 = L.data, saved = d0.text;
  d0.text = story;
  let n;
  try {
    const lay = layoutOf(L);
    if (!lay.overflow) n = chars(story).length;
    else n = lay.vis;
  } finally { d0.text = saved; }
  return n;
}
/* threads.rs reflow 的 distribute：故事＝依序接起来的全部字，前面的框装满了才往下一个流；最后一框收剩下的 */
function reflowThread(frames){
  const story = frames.map(L => String(L.data.text)).join('');
  const cs = chars(story);
  let pos = 0;
  frames.forEach((L, i) => {
    const rest = cs.slice(pos).join('');
    let k = i === frames.length - 1 ? chars(rest).length : fitCount(L, rest);
    if (i < frames.length - 1 && cs[pos + k] === '\n') k++;                 // 段落换行留在前一框尾，下一框不会以空行开头
    const part = cs.slice(pos, pos + k).join('');
    pos += k;
    if (L.data.text !== part){ L.data.text = part; Layer.invalidate(L); }
  });
}
/* 改过 list 里任一个框 ⇒ 它那串重流（clean＝顺便把只剩一框的串拆掉） */
function reflowThreads(list, clean){
  const ids = new Set((list || []).map(L => L && L.data && L.data.thread).filter(Boolean));
  if (!ids.size && !clean) return;
  threadsOf().forEach((frames, id) => {
    const live = frames.filter(L => L.data.box && !L.data.path);
    if (live.length < 2){ frames.forEach(L => { delete L.data.thread; delete L.data.threadIndex; }); return; }
    if (ids.has(id)) reflowThread(live);
  });
}
AiType.reflowThreads = reflowThreads;
let _thN = 0;
CMD.reg('ai.text.thread.create', {i18n:'', undoable:true,
  params:'{} 串接文本 ▸ 创建：把选取里的区域文字（AiSel.text）与闭合路径（节点选取那层，变成空的文字框）依图层上下顺序串成一篇（原本已串的并进来、顺序不变），故事从第一框流到最后 → {ok, ids}'}, () => {
  const C = 'ai.text.thread.create';
  const texts = textTargets({}).filter(L => L.data.box && !L.data.path);
  const V = window.VecSel ? VecSel.layer() : null;
  const shapes = (V && V.kind === 'vector') ? V.data.shapes.filter(s => VecSel.shapes.includes(s.id)) : [];
  const closedOk = shapes.every(s => { const v = VecSel.asBezier(s); return v && v.closed && v.anchors && v.anchors.length >= 2; });
  if (texts.length + shapes.length < 2 || !closedOk || !texts.length) return err(C, 'select area type and closed paths (at least one area type object)');
  const style = texts[0].data;
  // 闭合路径 → 空的区域文字框（frame_from_path；我们的框只有矩形 ⇒ 路径外框）
  const made = [];
  for (const s of shapes){
    const v = VecSel.asBezier(s), ap = arcPath(v, V.x, V.y);
    const xs = ap.pts.map(q => q[0]), ys = ap.pts.map(q => q[1]);
    const d = {text:'', size:style.size, font:style.font, color:style.color, align:style.align, weight:style.weight,
      box:{x:Math.min(...xs), y:Math.min(...ys), w:Math.max(1, Math.max(...xs) - Math.min(...xs)), h:Math.max(1, Math.max(...ys) - Math.min(...ys))}};
    placeInBox(d);
    const T = Layer.text(s.name || Lang.t('layer.text'), d);
    Doc.layers.splice(Doc.index(V.id) + 1, 0, T);
    made.push(T);
  }
  if (shapes.length){ V.data.shapes = V.data.shapes.filter(s => !shapes.includes(s)); Layer.invalidate(V); VecSel.clear(); }
  // 依图层顺序（下到上＝绘制顺序）；已有的串整串并进来、保持原顺序
  const sel = texts.concat(made).sort((a, b) => Doc.index(a.id) - Doc.index(b.id));
  const th = threadsOf(), order = [];
  sel.forEach(L => {
    const t = L.data.thread && th.get(L.data.thread);
    (t || [L]).forEach(x => { if (!order.includes(x)) order.push(x); });
  });
  const id = 'TH' + Date.now().toString(36) + (++_thN);
  order.forEach((L, i) => { L.data.thread = id; L.data.threadIndex = i; });
  reflowThread(order);
  if (window.AiSel) AiSel.text = order.map(L => L.id);
  return {ok:true, ids:order.map(L => L.id)};
});
const threadedSel = () => textTargets({}).filter(L => L.data.thread);
CMD.reg('ai.text.thread.releaseSelection', {i18n:'', undoable:true, params:'{} 串接文本 ▸ 释放所选文字：选到的框退出串接、变空，故事回到其余的框里 → {ok, ids}'}, () => {
  const sel = threadedSel(); if (!sel.length) return err('ai.text.thread.releaseSelection', 'no threaded text selected');
  const th = threadsOf();
  new Set(sel.map(L => L.data.thread)).forEach(id => {
    const frames = th.get(id) || [], out = frames.filter(L => sel.includes(L)), keep = frames.filter(L => !sel.includes(L));
    const story = frames.map(L => L.data.text).join('');
    out.forEach(L => { L.data.text = ''; delete L.data.thread; delete L.data.threadIndex; Layer.invalidate(L); });
    if (keep.length){ keep[0].data.text = story; keep.slice(1).forEach(L => { L.data.text = ''; }); keep.forEach((L, i) => { L.data.threadIndex = i; Layer.invalidate(L); }); }
    if (keep.length >= 2) reflowThread(keep); else keep.forEach(L => { delete L.data.thread; delete L.data.threadIndex; });
  });
  return {ok:true, ids:sel.map(L => L.id)};
});
CMD.reg('ai.text.thread.remove', {i18n:'', undoable:true, params:'{} 串接文本 ▸ 移去串接文字：选到的框所在的串整串拆开，每个框留着它现在显示的字 → {ok}'}, () => {
  const sel = threadedSel(); if (!sel.length) return err('ai.text.thread.remove', 'no threaded text selected');
  const ids = new Set(sel.map(L => L.data.thread));
  Doc.layers.forEach(L => { if (isText(L) && ids.has(L.data.thread)){ delete L.data.thread; delete L.data.threadIndex; } });
  return {ok:true};
});
CMD.reg('ai.text.thread.info', {i18n:'', params:'{} 全部串接：[[层 id…]…]（依序）'}, () => {
  const out = []; threadsOf().forEach(v => out.push(v.map(L => L.id))); return {ok:true, threads:out};
});
/* 编辑后重流（原码 engine 每次 edit 后都 reflow）：文字工具／选项栏走的 text.edit、text.setStyle 包一层（过渡钩子） */
function hookReflow(id){
  const c = CMD.map[id];
  if (!c || c['__aiTypeReflow']) return;
  const o = c.run;
  c.run = function(p){
    const r = o.apply(this, arguments);
    try { if (!(r && r.ok === false)){ const L = (p && p.layerId) ? Doc.byId(p.layerId) : (r && r.id ? Doc.byId(r.id) : Doc.active()); if (isText(L) && L.data.thread) reflowThreads([L]); } } catch(e){ console.error(e); }
    return r;
  };
  c['__aiTypeReflow'] = true;
}
['text.edit', 'text.setStyle'].forEach(hookReflow);

/* ═══════════ 查找字体（fonts.rs；find_font.rs 对话框） ═══════════ */
const W2S = w => { const t = TT(); return t && t.weightToStyle ? t.weightToStyle(w) : 'Regular'; };
function families(){ try { return (CMD.map['text.fonts'].run({}) || {}).families || []; } catch(e){ return []; } }
function fontAvail(f){
  if (/^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/i.test(f)) return true;
  if (families().some(x => x.toLowerCase() === String(f).toLowerCase())) return true;
  const probe = 'mmmmmmmmmmlli一二三ABC';
  return ['monospace', 'serif', 'sans-serif'].some(base => { _mc.font = `72px ${base}`; const w0 = _mc.measureText(probe).width; _mc.font = `72px "${f}", ${base}`; return _mc.measureText(probe).width !== w0; });
}
function scope(selOnly){ return (selOnly ? textTargets({}) : Doc.layers.filter(isText)); }
CMD.reg('ai.text.fonts', {i18n:'', params:'{selectionOnly?} 文件里用到的字体 → {ok, fonts:[{family, style, runs, objects, missing}]}（按名字排；我们一层一种样式 ⇒ runs＝层数）'}, p => {
  const m = new Map();
  scope(!!p.selectionOnly).forEach(L => { const k = L.data.font + '\u0001' + W2S(L.data.weight); m.set(k, (m.get(k) || 0) + 1); });
  const fonts = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => { const [family, style] = k.split('\u0001'); return {family, style, runs:n, objects:n, missing:!fontAvail(family)}; });
  return {ok:true, fonts};
});
CMD.reg('ai.text.replaceFont', {i18n:'', undoable:true, params:'{from:{family, style?}, to:{family, style?}, selectionOnly?} 把文件（或选取）里用 from 字体的文字换成 to（style 省略：from＝那个家族的所有样式／to＝保留原样式） → {ok, runs}'}, p => {
  const C = 'ai.text.replaceFont';
  const fp = k => { const v = p[k]; if (!v || typeof v !== 'object') return null; const f = String(v.family || '').trim(); return f ? {family:f, style:v.style ? String(v.style) : null} : null; };
  const from = fp('from'), to = fp('to');
  if (!from) return err(C, '`from.family` is required'); if (!to) return err(C, '`to.family` is required');
  if (!fontAvail(to.family)) return err(C, `font family \`${to.family}\` is not available`);
  let n = 0;
  scope(!!p.selectionOnly).forEach(L => {
    const d = L.data;
    if (String(d.font).toLowerCase() !== from.family.toLowerCase()) return;
    if (from.style && W2S(d.weight).toLowerCase() !== from.style.toLowerCase()) return;
    d.font = to.family; if (to.style) d.weight = styleToWeight(to.style);
    touch(L); n++;
  });
  return {ok:true, runs:n};
});
CMD.reg('ai.select.font', {i18n:'', params:'{family, style?} 选取用这个字体的文字物件（放进 AiSel.text） → {ok, count}'}, p => {
  if (!p.family) return err('ai.select.font', 'missing `family`');
  const hits = Doc.layers.filter(isText).filter(L => String(L.data.font).toLowerCase() === String(p.family).toLowerCase() && (!p.style || W2S(L.data.weight).toLowerCase() === String(p.style).toLowerCase()));
  if (window.VecSel) VecSel.clear();
  if (window.AiSel) AiSel.text = hits.map(L => L.id);
  return {ok:true, count:hits.length, ids:hits.map(L => L.id)};
});
CMD.reg('ai.type.findFont', {i18n:'', params:'{} 开「查找字体」对话框（文件里的字体、缺的标红；查找＝ai.select.font、更改／全部更改＝ai.text.replaceFont）'}, () => { Dlg.findFont(); return {ok:true, dialog:true}; });

/* ═══════════ 创建轮廓（typecmd.rs:112-156）：文字层 → 矢量层里一个编组、每个字一个复合路径 ═══════════
   浏览器拿不到字体的轮廓资料 ⇒ 每个字照它在版面上的位置／变形，在高解析度画布上画出来，0.5 等值线（marching squares）描边、
   拉直（RDP）后在转角处断开、用 ai-object.js 的 fit_cubics（AIObj.Fit）拟合回三次贝兹；洞用 evenodd。 */
function marching(v, W, H){
  const nodes = new Map(), segs = [];
  const P = (k, x, y) => { if (!nodes.has(k)) nodes.set(k, {p:[x, y], n:[]}); return k; };
  const lerp = (a, b) => (0.5 - a) / ((b - a) || 1e-9);
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++){
    const tl = v[j*W + i], tr = v[j*W + i + 1], br = v[(j+1)*W + i + 1], bl = v[(j+1)*W + i];
    const c = (tl >= .5 ? 8 : 0) | (tr >= .5 ? 4 : 0) | (br >= .5 ? 2 : 0) | (bl >= .5 ? 1 : 0);
    if (c === 0 || c === 15) continue;
    const x = i + .5, y = j + .5;
    const T = () => P('h' + i + ',' + j, x + lerp(tl, tr), y), B = () => P('h' + i + ',' + (j + 1), x + lerp(bl, br), y + 1);
    const Lf = () => P('v' + i + ',' + j, x, y + lerp(tl, bl)), R = () => P('v' + (i + 1) + ',' + j, x + 1, y + lerp(tr, br));
    const ctr = (tl + tr + br + bl) / 4 >= .5;
    const add = (a, b) => segs.push([a, b]);
    switch (c){
      case 1: add(Lf(), B()); break;   case 2: add(B(), R()); break;   case 3: add(Lf(), R()); break;
      case 4: add(T(), R()); break;    case 5: if (ctr){ add(T(), Lf()); add(B(), R()); } else { add(T(), R()); add(Lf(), B()); } break;
      case 6: add(T(), B()); break;    case 7: add(T(), Lf()); break;  case 8: add(T(), Lf()); break;
      case 9: add(T(), B()); break;    case 10: if (ctr){ add(T(), R()); add(Lf(), B()); } else { add(T(), Lf()); add(B(), R()); } break;
      case 11: add(T(), R()); break;   case 12: add(Lf(), R()); break; case 13: add(B(), R()); break; case 14: add(Lf(), B()); break;
    }
  }
  segs.forEach(([a, b]) => { nodes.get(a).n.push(b); nodes.get(b).n.push(a); });
  const seen = new Set(), loops = [];
  nodes.forEach((nd, k) => {
    if (seen.has(k) || nd.n.length < 2) return;
    const loop = []; let prev = null, cur = k;
    while (cur && !seen.has(cur)){
      seen.add(cur); loop.push(nodes.get(cur).p);
      const nb = nodes.get(cur).n, nx = nb[0] !== prev && !seen.has(nb[0]) ? nb[0] : (nb[1] !== prev && !seen.has(nb[1]) ? nb[1] : null);
      prev = cur; cur = nx;
    }
    if (loop.length >= 3) loops.push(loop);
  });
  return loops;
}
function rdpClosed(P, tol){
  if (P.length < 4) return P.slice();
  // 从离第一点最远的点切开成两段开放折线，各自 RDP
  let far = 0, fd = -1; P.forEach((q, i) => { const d = Math.hypot(q[0] - P[0][0], q[1] - P[0][1]); if (d > fd){ fd = d; far = i; } });
  const rdp = Q => {
    if (Q.length < 3) return Q.slice();
    const keep = Q.map(() => false); keep[0] = keep[Q.length - 1] = true;
    const st = [[0, Q.length - 1]];
    while (st.length){
      const [a, b] = st.pop(), dx = Q[b][0] - Q[a][0], dy = Q[b][1] - Q[a][1], l = Math.hypot(dx, dy);
      let best = 0, bi = -1;
      for (let i = a + 1; i < b; i++){ const d = l < 1e-12 ? Math.hypot(Q[i][0] - Q[a][0], Q[i][1] - Q[a][1]) : Math.abs((Q[i][0] - Q[a][0]) * dy - (Q[i][1] - Q[a][1]) * dx) / l; if (d > best){ best = d; bi = i; } }
      if (best > tol){ keep[bi] = true; st.push([a, bi], [bi, b]); }
    }
    return Q.filter((_, i) => keep[i]);
  };
  const A = rdp(P.slice(0, far + 1)), B = rdp(P.slice(far).concat([P[0]]));
  return A.concat(B.slice(1, -1));
}
/* 折线环（像素坐标）→ 钢笔锚点（f 把像素坐标换成文件坐标；仿射，所以贝兹控制点直接换） */
function loopToAnchors(P, f){
  const n = P.length; if (n < 3) return null;
  const Fit = window.AIObj && AIObj.Fit;
  const unit = v => { const l = Math.hypot(v[0], v[1]); return l > 1e-12 ? [v[0] / l, v[1] / l] : null; };
  const turn = i => { const a = unit([P[i][0] - P[(i - 1 + n) % n][0], P[i][1] - P[(i - 1 + n) % n][1]]), b = unit([P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]]);
    return (!a || !b) ? 0 : Math.acos(clamp(a[0]*b[0] + a[1]*b[1], -1, 1)) * 180 / Math.PI; };
  const segs = [];
  if (!Fit){ for (let i = 0; i < n; i++) segs.push({line:true, p0:P[i]}); }
  else {
    let cs = []; for (let i = 0; i < n; i++) if (turn(i) > 40) cs.push(i);
    const rot = cs.length ? cs[0] : 0, Q = P.slice(rot).concat(P.slice(0, rot));
    cs = cs.length ? cs.map(c => (c - rot + n) % n).sort((a, b) => a - b) : [0];
    cs.push(n);
    for (let w = 0; w + 1 < cs.length; w++){
      const run = []; for (let i = cs[w]; i <= cs[w + 1]; i++) run.push(Q[i % n]);
      if (run.length === 2){ segs.push({line:true, p0:run[0]}); continue; }
      const pts = [run[0]];
      for (let i = 1; i < run.length; i++){ const a = run[i - 1], b = run[i], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.5)); for (let j = 1; j <= k; j++) pts.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]); }
      const t0 = unit([run[1][0] - run[0][0], run[1][1] - run[0][1]]) || [1, 0], m = run.length;
      const t1 = unit([run[m - 1][0] - run[m - 2][0], run[m - 1][1] - run[m - 2][1]]) || [1, 0];
      for (const c of Fit.fitCubics(pts, t0, t1, 0.35)) segs.push(Fit.isStraight(c, 0.02) ? {line:true, p0:c.p0} : {line:false, p0:c.p0, c1:c.c1, c2:c.c2});
    }
  }
  const N = segs.length; if (N < 2) return null;
  const pt = q => { const r = f(q); return [r[0], r[1]]; };
  return segs.map((s, i) => {
    const pv = segs[(i - 1 + N) % N], a = pt(s.p0);
    return {x:a[0], y:a[1], in:pv.line ? null : pt(pv.c2), out:s.line ? null : pt(s.c1)};
  });
}
function glyphOutline(g, d, asc, desc){
  if (isWS(g.ch) || /\p{Cc}/u.test(g.ch) || g.ch === '­') return [];
  _mc.font = fontOf(d);
  const tm = _mc.measureText(g.ch);
  const l = Math.ceil(tm.actualBoundingBoxLeft || 0) + 2, r = Math.ceil(tm.actualBoundingBoxRight || g.adv) + 2;
  const a = Math.ceil(tm.actualBoundingBoxAscent || asc) + 2, b = Math.ceil(tm.actualBoundingBoxDescent || desc) + 2;
  let R = clamp(160 / d.size, 1, 16);
  while ((l + r) * (a + b) * R * R > 3e6 && R > 0.25) R /= 2;
  const pad = 2, W = Math.ceil((l + r) * R) + 2 * pad, H = Math.ceil((a + b) * R) + 2 * pad;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d', {willReadFrequently:true});
  x.setTransform(R, 0, 0, R, pad + l * R, pad + a * R);
  x.font = fontOf(d); x.fillStyle = '#000'; x.textBaseline = 'alphabetic'; x.textAlign = 'left';
  x.fillText(g.ch, 0, 0);
  const px = x.getImageData(0, 0, W, H).data, v = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) v[i] = px[i * 4 + 3] / 255;
  const toDoc = q => Af.ap(g.m, [(q[0] - pad - l * R) / R, (q[1] - pad - a * R) / R]);
  return marching(v, W, H).map(lp => loopToAnchors(rdpClosed(lp, 0.3), toDoc)).filter(Boolean);
}
CMD.reg('ai.type.createOutlines', {i18n:'', undoable:true,
  params:'{ids?} 文字 ▸ 创建轮廓：每个文字层换成同位置的矢量层，里面一个编组、每个字一个复合路径（evenodd，填色＝文字颜色）；图层名／不透明度／混合模式照搬；选中新编组 → {ok, ids:[编组 id…], layers:[新矢量层 id…]}'}, p => {
  const C = 'ai.type.createOutlines', x = targetsOr(p, C); if (x.e) return x.e;
  if (TT() && TT().ed) TT().commit();
  const gids = [], lids = [];
  let lastL = null, lastG = null;
  for (const L of x.t){
    if (!Doc.byId(L.id)) continue;
    const d = L.data, lay = layoutOf(L), kids = [];
    for (const g of lay.glyphs){
      const subs = glyphOutline(g, d, lay.asc, lay.desc);
      if (!subs.length) continue;
      const style = {fill:d.color, stroke:'none', strokeWidth:0};
      if (subs.length === 1) kids.push(Object.assign({id:uid('S'), type:'bezier', anchors:subs[0], closed:true}, style));
      else kids.push(Object.assign({id:uid('S'), type:'compound', rule:'evenodd', children:subs.map(a => ({id:uid('S'), type:'bezier', anchors:a, closed:true, fill:'none', stroke:'none', strokeWidth:0}))}, style));
    }
    const i = Doc.index(L.id);
    Doc.layers.splice(i, 1);
    if (!kids.length) continue;                                             // 原码：没有字形就只删掉文字
    const V = Layer.vector(L.name);
    ['opacity', 'blend', 'visible'].forEach(k => { V[k] = L[k]; });
    const G = {id:uid('S'), type:'group', name:L.name, children:kids};
    V.data.shapes.push(G);
    Doc.layers.splice(i, 0, V);
    gids.push(G.id); lids.push(V.id); lastL = V; lastG = G;
  }
  if (window.AiSel) AiSel.text = [];
  if (lastL){ Doc.activeId = lastL.id; if (window.VecSel) VecSel.setShapes(lastL.id, [lastG.id]); }
  else if (!Doc.byId(Doc.activeId)) Doc.activeId = Doc.layers.length ? Doc.layers[Doc.layers.length - 1].id : null;
  if (window.UI && UI.refresh) setTimeout(() => UI.refresh(), 0);
  return {ok:true, ids:gids, layers:lids};
});

/* ═══════════ 显示隐藏字符（menus.rs:791 flag；canvas.rs:902-939 叠画） ═══════════ */
CMD.reg('ai.type.hiddenCharacters', {i18n:'', params:'{show?:bool（缺省＝切换）} 文字 ▸ 显示／隐藏隐藏字符：画布上空格画点、段落尾画 ¶、全文尾画 #（蓝 #4f9dff；路径文字不画，同原码） → {ok, show}'}, p => {
  AiType.hiddenChars = typeof p.show === 'boolean' ? p.show : !AiType.hiddenChars;
  if (window.UI && UI.draw) UI.draw();
  return {ok:true, show:AiType.hiddenChars};
});
AiType.drawHidden = function(ctx, s){
  if (!this.hiddenChars) return;
  const z = Math.max((window.UI && UI.zoom) || 1, 0.01), dpr = s / z;
  ctx.save(); ctx.fillStyle = '#4f9dff';
  ctx.font = `${clamp(10 * z, 7, 18) * dpr}px sans-serif`; ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
  for (const L of Doc.layers){
    if (!isText(L) || !L.visible) continue;
    let lay; try { lay = layoutOf(L); } catch(e){ continue; }
    if (lay.onPath) continue;
    for (const g of lay.glyphs){
      if (g.ch !== ' ' && g.ch !== '　') continue;
      const q = Af.ap(g.m, [g.adv / 2, -3]);
      ctx.beginPath(); ctx.arc(q[0] * s, q[1] * s, 1.2 * dpr, 0, Math.PI * 2); ctx.fill();
    }
    for (const l of lay.lines) if (l.brk) ctx.fillText(l.brk, l.end_pt[0] * s, l.end_pt[1] * s);
  }
  ctx.restore();
};
AiType.hiddenMarks = function(id){        // 给测试与 agent：某层要画的记号（文件坐标）
  const L = Doc.byId(id); if (!isText(L)) return null;
  const lay = layoutOf(L);
  return {dots:lay.glyphs.filter(g => g.ch === ' ' || g.ch === '　').map(g => Af.ap(g.m, [g.adv / 2, -3])), marks:lay.lines.filter(l => l.brk).map(l => ({ch:l.brk, at:l.end_pt}))};
};

/* ═══════════ 字形面板（panels/glyphs.rs） ═══════════ */
const SUBSETS = [['entire', 0, 0x10FFFF], ['basicLatin', 0x20, 0x7F], ['latin1', 0xA0, 0xFF], ['latinExt', 0x100, 0x24F], ['punct', 0x2000, 0x206F], ['symbols', 0x20A0, 0x2BFF], ['greekCyr', 0x370, 0x52F]];
const GP = {subset:1, font:null};             // font：面板里另外挑的 {family, style}；null＝跟着选取文字的字体
function glyphChars(si){
  // 浏览器读不到字体的 cmap ⇒ 列子集范围里 Unicode 有指定、不是控制字或空白的字（整个字体＝其余六个子集合起来）
  const ranges = si === 0 ? SUBSETS.slice(1).map(x => [x[1], x[2]]) : [[SUBSETS[si][1], SUBSETS[si][2]]];
  const out = [];
  ranges.forEach(([a, b]) => { for (let c = a; c <= b; c++){ const ch = String.fromCodePoint(c); if (/[\p{Cn}\p{Cc}\p{Cs}\p{Co}\p{Cf}\s]/u.test(ch)) continue; out.push(ch); } });
  return out;
}
function glyphFont(){
  if (GP.font) return GP.font;
  const L = textTargets({})[0];
  return L ? {family:L.data.font, style:W2S(L.data.weight)} : {family:'sans-serif', style:'Regular'};
}
/* glyphs.rs:121 insert：在编辑就插在插入点，否则接到选取的文字后面；都没有就在状态列提示 */
function glyphInsert(ch, body){
  const r = (editingLayer() || textTargets({}).length) ? CMD.run('ai.type.insert', {text:ch}) : null;
  if (window.UI && UI.draw) UI.draw();
  const st = body && body.querySelector('.agl-st');
  if ((!r || r.ok === false) && st) st.textContent = Lang.t('aitype.glyphNoText');
  return r;
}
function buildGlyphs(body){
  body.innerHTML = '';
  body.classList.add('agl');
  const f = glyphFont();
  const top = document.createElement('div'); top.className = 'agl-top';
  const lb = document.createElement('span'); lb.textContent = Lang.t('aitype.show');
  const sel = document.createElement('select'); sel.className = 'agl-subset';
  SUBSETS.forEach((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = Lang.t('aitype.sub.' + s[0]); sel.appendChild(o); });
  sel.value = GP.subset; sel.onchange = () => { GP.subset = +sel.value; buildGlyphs(body); };
  const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = '⟲'; reset.title = Lang.t('aitype.useSel'); reset.className = 'agl-reset';
  reset.onclick = () => { GP.font = null; buildGlyphs(body); };
  top.append(lb, sel, reset); body.appendChild(top);
  const list = glyphChars(GP.subset);
  const grid = document.createElement('div'); grid.className = 'agl-grid';
  grid.style.fontFamily = /^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/.test(f.family) ? f.family : `"${f.family}"`;
  grid.style.fontWeight = /bold/i.test(f.style) ? '700' : /light|thin/i.test(f.style) ? '300' : '400';
  grid.style.fontStyle = /italic/i.test(f.style) ? 'italic' : 'normal';
  const st = document.createElement('div'); st.className = 'agl-st'; st.textContent = Lang.t('aitype.glyphCount').replace('{n}', list.length);
  const frag = document.createDocumentFragment();
  list.forEach(ch => {
    const c = document.createElement('div'); c.className = 'agl-c'; c.textContent = ch; c.dataset.ch = ch;
    const cp = 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    c.title = `${cp}  ${ch}\n${Lang.t('aitype.dblInsert')}`;
    c.onmouseenter = () => { st.textContent = `${cp}  ·  ` + Lang.t('aitype.glyphCount').replace('{n}', list.length); };
    c.ondblclick = e => { e.preventDefault(); glyphInsert(ch, body); };
    frag.appendChild(c);
  });
  grid.appendChild(frag); body.appendChild(grid); body.appendChild(st);
  const bot = document.createElement('div'); bot.className = 'agl-bot';
  const fam = document.createElement('select'); fam.className = 'agl-fam';
  const fl = families(); if (!fl.includes(f.family)) fl.unshift(f.family);
  fl.forEach(x => { const o = document.createElement('option'); o.value = x; o.textContent = x; fam.appendChild(o); });
  fam.value = f.family; fam.onchange = () => { GP.font = {family:fam.value, style:f.style}; buildGlyphs(body); };
  const sty = document.createElement('select'); sty.className = 'agl-sty';
  let styles = []; try { styles = (CMD.map['text.fonts'].run({}) || {}).styles || ['Regular']; } catch(e){ styles = ['Regular']; }
  if (!styles.includes(f.style)) styles.unshift(f.style);
  styles.forEach(x => { const o = document.createElement('option'); o.value = x; o.textContent = x; sty.appendChild(o); });
  sty.value = f.style; sty.onchange = () => { GP.font = {family:f.family, style:sty.value}; buildGlyphs(body); };
  bot.append(fam, sty); body.appendChild(bot);
}
const GLYPH_TITLE = {'zh-Hant':'字符', 'zh-Hans':'字形', en:'Glyphs'};
function ensureGlyphPanelDef(){
  if (window.DlPanels && !DlPanels.has('glyphs')){
    DlPanels.define('glyphs', {title:GLYPH_TITLE, w:300, h:360,
      build(body){ buildGlyphs(body); },
      refresh(body, api, why){                                              // 文件一改只在字体换了才重排（整个字体有四千多格）
        const f = glyphFont(), key = f.family + '\u0001' + f.style + '\u0001' + GP.subset + '\u0001' + Lang.cur;
        if (why === 'open' || body._aglKey !== key){ body._aglKey = key; buildGlyphs(body); }
      },
      menu(){ return [{label:{'zh-Hant':'使用所選文字的字體', 'zh-Hans':'使用所选文本的字体', en:"Use the Selected Text's Font"}, run:() => { GP.font = null; DlPanels.refresh('glyphs', 'open'); }}]
        .concat([{sep:true}], SUBSETS.map((s, i) => ({label:{'zh-Hant':Lang.t('aitype.sub.' + s[0]), 'zh-Hans':Lang.t('aitype.sub.' + s[0]), en:Lang.t('aitype.sub.' + s[0])}, checked:GP.subset === i, run:() => { GP.subset = i; DlPanels.refresh('glyphs', 'open'); }}))); }});
  }
}
CMD.reg('ai.window.panel.glyphs', {i18n:'', params:'{show?:bool（缺省＝切换）} 文字 ▸ 字形（＝窗口 ▸ 文字 ▸ 字形，原码 window.panel {panel:"glyphs"}）：开关字形面板；双击一格＝插入那个字（在编辑就插在插入点，否则接在选取的文字后面＝ai.type.insert {text}） → {ok, open}'}, p => {
  ensureGlyphPanelDef();
  const want = typeof p.show === 'boolean' ? p.show : !AiType.glyphsOpen();
  if (window.DlPanels && DlPanels.has('glyphs')) DlPanels.toggle('glyphs', want);
  else {                                                                   // 没有共用面板外壳（menus/impl/panels.js）时的简易浮窗
    let el = document.getElementById('aiGlyphsPanel');
    if (want && !el){
      el = document.createElement('div'); el.id = 'aiGlyphsPanel'; el.className = 'agl-float';
      const h = document.createElement('div'); h.className = 'agl-h'; h.innerHTML = `<span>${T3(GLYPH_TITLE)}</span><span class="agl-x">×</span>`;
      h.querySelector('.agl-x').onclick = () => CMD.run('ai.window.panel.glyphs', {show:false});
      const b = document.createElement('div'); b.className = 'agl-body';
      el.append(h, b); document.body.appendChild(el); buildGlyphs(b);
    } else if (!want && el) el.remove();
  }
  return {ok:true, open:AiType.glyphsOpen()};
});
AiType.glyphInsert = glyphInsert;

/* ═══════════ 对话框（样式写在这里注入） ═══════════ */
const STR = {
  'zh-Hant':{'aitype.ok':'確定', 'aitype.cancel':'取消', 'aitype.done':'完成',
    'aitype.smartTitle':'智慧型標點符號', 'aitype.quotes':'智慧型引號（" " → “ ”）', 'aitype.dashes':'破折號（-- → –、--- → —）', 'aitype.ellipsis':'省略符號（... → …）',
    'aitype.scope':'範圍：', 'aitype.scopeSel':'僅限選取的文字', 'aitype.scopeDoc':'整份文件',
    'aitype.areaTitle':'區域文字選項', 'aitype.rows':'列數：', 'aitype.columns':'欄數：', 'aitype.gutter':'間距：', 'aitype.inset':'內縮間距：',
    'aitype.firstBaseline':'首行基線：', 'aitype.firstBaselineMin':'最小值：',
    'aitype.fb.ascent':'全形字框上緣', 'aitype.fb.capHeight':'大寫字高', 'aitype.fb.xHeight':'x 高度', 'aitype.fb.leading':'行距', 'aitype.fb.fixed':'固定',
    'aitype.pathTitle':'路徑文字選項', 'aitype.effect':'效果：', 'aitype.start':'起點（0～1）：', 'aitype.flip':'翻轉',
    'aitype.eff.rainbow':'彩虹效果', 'aitype.eff.skew':'傾斜', 'aitype.eff.3dRibbon':'3D 緞帶效果', 'aitype.eff.stairStep':'階梯效果', 'aitype.eff.gravity':'重力效果',
    'aitype.ffTitle':'尋找字體', 'aitype.ffInDoc':'文件中的字體：', 'aitype.ffReplace':'取代為字體：', 'aitype.ffMissing':'— 缺少', 'aitype.closest':'（最接近）',
    'aitype.find':'尋找', 'aitype.change':'變更', 'aitype.changeAll':'全部變更',
    'aitype.show':'顯示：', 'aitype.useSel':'使用所選文字的字體', 'aitype.glyphCount':'{n} 個字符', 'aitype.dblInsert':'按兩下插入',
    'aitype.glyphNoText':'請先選取文字物件，或用文字工具點進文字再插入字符',
    'aitype.sub.entire':'整個字體', 'aitype.sub.basicLatin':'基本拉丁文', 'aitype.sub.latin1':'Latin-1 補充', 'aitype.sub.latinExt':'拉丁文擴充', 'aitype.sub.punct':'標點符號', 'aitype.sub.symbols':'貨幣與符號', 'aitype.sub.greekCyr':'希臘文與斯拉夫文'},
  'zh-Hans':{'aitype.ok':'确定', 'aitype.cancel':'取消', 'aitype.done':'完成',
    'aitype.smartTitle':'智能标点', 'aitype.quotes':'智能引号（" " → “ ”）', 'aitype.dashes':'破折号（-- → –、--- → —）', 'aitype.ellipsis':'省略号（... → …）',
    'aitype.scope':'范围：', 'aitype.scopeSel':'仅所选文本', 'aitype.scopeDoc':'整个文档',
    'aitype.areaTitle':'区域文字选项', 'aitype.rows':'行数：', 'aitype.columns':'列数：', 'aitype.gutter':'间距：', 'aitype.inset':'内边距：',
    'aitype.firstBaseline':'首行基线：', 'aitype.firstBaselineMin':'最小值：',
    'aitype.fb.ascent':'字母上缘', 'aitype.fb.capHeight':'大写字母高度', 'aitype.fb.xHeight':'x 高度', 'aitype.fb.leading':'行距', 'aitype.fb.fixed':'固定',
    'aitype.pathTitle':'路径文字选项', 'aitype.effect':'效果：', 'aitype.start':'起点（0～1）：', 'aitype.flip':'翻转',
    'aitype.eff.rainbow':'彩虹效果', 'aitype.eff.skew':'倾斜', 'aitype.eff.3dRibbon':'3D 带状效果', 'aitype.eff.stairStep':'阶梯效果', 'aitype.eff.gravity':'重力效果',
    'aitype.ffTitle':'查找字体', 'aitype.ffInDoc':'文档中的字体：', 'aitype.ffReplace':'替换字体来自：', 'aitype.ffMissing':'— 缺失', 'aitype.closest':'（最接近）',
    'aitype.find':'查找', 'aitype.change':'更改', 'aitype.changeAll':'全部更改',
    'aitype.show':'显示：', 'aitype.useSel':'使用所选文本的字体', 'aitype.glyphCount':'{n} 个字形', 'aitype.dblInsert':'双击插入',
    'aitype.glyphNoText':'请先选择文字对象，或用文字工具点进文字再插入字形',
    'aitype.sub.entire':'整个字体', 'aitype.sub.basicLatin':'基本拉丁文', 'aitype.sub.latin1':'Latin-1 补充', 'aitype.sub.latinExt':'拉丁文扩展', 'aitype.sub.punct':'标点', 'aitype.sub.symbols':'货币与符号', 'aitype.sub.greekCyr':'希腊文与西里尔文'},
  'en':{'aitype.ok':'OK', 'aitype.cancel':'Cancel', 'aitype.done':'Done',
    'aitype.smartTitle':'Smart Punctuation', 'aitype.quotes':'Smart Quotes (" " → “ ”)', 'aitype.dashes':'Dashes (-- → –, --- → —)', 'aitype.ellipsis':'Ellipses (... → …)',
    'aitype.scope':'Scope:', 'aitype.scopeSel':'Selected Text Only', 'aitype.scopeDoc':'Entire Document',
    'aitype.areaTitle':'Area Type Options', 'aitype.rows':'Rows:', 'aitype.columns':'Columns:', 'aitype.gutter':'Gutter:', 'aitype.inset':'Inset Spacing:',
    'aitype.firstBaseline':'First Baseline:', 'aitype.firstBaselineMin':'Min:',
    'aitype.fb.ascent':'Ascent', 'aitype.fb.capHeight':'Cap Height', 'aitype.fb.xHeight':'x Height', 'aitype.fb.leading':'Leading', 'aitype.fb.fixed':'Fixed',
    'aitype.pathTitle':'Type on a Path Options', 'aitype.effect':'Effect:', 'aitype.start':'Start (0–1):', 'aitype.flip':'Flip',
    'aitype.eff.rainbow':'Rainbow', 'aitype.eff.skew':'Skew', 'aitype.eff.3dRibbon':'3D Ribbon', 'aitype.eff.stairStep':'Stair Step', 'aitype.eff.gravity':'Gravity',
    'aitype.ffTitle':'Find Font', 'aitype.ffInDoc':'Fonts in Document:', 'aitype.ffReplace':'Replace With Font:', 'aitype.ffMissing':'— missing', 'aitype.closest':'(closest)',
    'aitype.find':'Find', 'aitype.change':'Change', 'aitype.changeAll':'Change All',
    'aitype.show':'Show:', 'aitype.useSel':"Use the Selected Text's Font", 'aitype.glyphCount':'{n} glyphs', 'aitype.dblInsert':'Double-click to insert',
    'aitype.glyphNoText':'Select text or click into text with the Type tool to insert glyphs',
    'aitype.sub.entire':'Entire Font', 'aitype.sub.basicLatin':'Basic Latin', 'aitype.sub.latin1':'Latin-1 Supplement', 'aitype.sub.latinExt':'Latin Extended', 'aitype.sub.punct':'Punctuation', 'aitype.sub.symbols':'Currency & Symbols', 'aitype.sub.greekCyr':'Greek & Cyrillic'}
};
if (typeof Lang !== 'undefined') Lang.add(STR);
if (!document.getElementById('aiTypeStyle')){
  const st = document.createElement('style'); st.id = 'aiTypeStyle';
  st.textContent = `.aitdlg-back{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}
.aitdlg{background:#2b2f36;color:#e6e8ec;border:1px solid #444a55;border-radius:6px;padding:14px 16px;min-width:300px;font:13px sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4)}
.aitdlg .t{font-weight:600;margin-bottom:10px}
.aitdlg label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0}
.aitdlg label.ck{justify-content:flex-start}
.aitdlg input[type=text],.aitdlg input[type=number],.aitdlg select{width:150px;background:#1d2026;color:#e6e8ec;border:1px solid #444a55;border-radius:3px;padding:3px 6px}
.aitdlg .bar{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.aitdlg .msg{color:#ff8a80;min-height:1em;margin-top:6px}
.aitdlg .ff-list{background:#1d2026;border:1px solid #444a55;min-height:110px;max-height:160px;overflow:auto;margin:4px 0 10px}
.aitdlg .ff-i{padding:3px 6px;cursor:default}.aitdlg .ff-i.on{background:#2f7fd8}.aitdlg .ff-i.miss{color:#e65a5a}
.agl{display:flex;flex-direction:column;height:100%;box-sizing:border-box;font:12px sans-serif;color:#e6e8ec}
.agl-top,.agl-bot{display:flex;gap:6px;align-items:center;padding:4px}
.agl-top select{flex:1}.agl-bot select{flex:1;min-width:0}
.agl-grid{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,30px);grid-auto-rows:30px;align-content:start;background:#1d2026;min-height:120px}
.agl-c{width:30px;height:30px;box-sizing:border-box;border:.5px solid #3a3f48;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:default;user-select:none}
.agl-c:hover{background:#3a4250}
.agl-st{font-size:11px;color:#9aa3b0;padding:3px 4px}
.agl-float{position:fixed;right:250px;top:90px;width:300px;height:380px;z-index:950;background:#2b2f36;border:1px solid #444a55;border-radius:4px;display:flex;flex-direction:column;resize:both;overflow:hidden}
.agl-h{display:flex;justify-content:space-between;padding:4px 8px;background:#23262c;font:12px sans-serif;color:#e6e8ec}.agl-x{cursor:pointer}
.agl-body{flex:1;min-height:0}`;
  document.head.appendChild(st);
}
const Dlg = AiType.dialogs = {
  /* 通用参数对话框（ui.paramDialog）：rows＝[{k, label, type:'number'|'text'|'check'|'select', value, options:[[值, 字串键]], min, max, step}]；ok(values) 回 {ok:false} 就不关、显示错误 */
  form(id, title, rows, ok){
    const old = document.getElementById(id); if (old) old.remove();
    const back = document.createElement('div'); back.className = 'aitdlg-back'; back.id = id;
    const box = document.createElement('div'); box.className = 'aitdlg';
    box.innerHTML = `<div class="t">${Lang.t(title)}</div>`;
    const F = {};
    rows.forEach(r => {
      const l = document.createElement('label'); if (r.type === 'check') l.className = 'ck';
      const sp = document.createElement('span'); sp.textContent = Lang.t(r.label);
      let el;
      if (r.type === 'select'){ el = document.createElement('select'); r.options.forEach(([v, k]) => { const o = document.createElement('option'); o.value = v; o.textContent = Lang.t(k); el.appendChild(o); }); el.value = r.value; }
      else { el = document.createElement('input'); el.type = r.type === 'check' ? 'checkbox' : r.type === 'number' ? 'number' : 'text';
        if (r.type === 'check') el.checked = !!r.value; else el.value = r.value; ['min', 'max', 'step'].forEach(k => { if (r[k] !== undefined) el[k] = r[k]; }); }
      el.dataset.k = r.k; F[r.k] = el;
      if (r.type === 'check'){ l.append(el, sp); } else l.append(sp, el);
      box.appendChild(l);
    });
    const msg = document.createElement('div'); msg.className = 'msg'; box.appendChild(msg);
    const bar = document.createElement('div'); bar.className = 'bar';
    const close = () => { back.remove(); if (window.UI) UI.draw(); };
    const done = () => {
      const v = {}; for (const k in F) v[k] = F[k].type === 'checkbox' ? F[k].checked : F[k].type === 'number' ? +F[k].value : F[k].value;
      let r; try { r = ok(v); } catch(e){ r = {ok:false, error:e.message}; }
      if (r && r.ok === false){ msg.textContent = r.error || ''; return; }
      close();
    };
    const b1 = document.createElement('button'); b1.textContent = Lang.t('aitype.cancel'); b1.dataset.act = 'cancel'; b1.onclick = close;
    const b2 = document.createElement('button'); b2.textContent = Lang.t('aitype.ok'); b2.dataset.act = 'ok'; b2.onclick = done;
    bar.append(b1, b2); box.appendChild(bar);
    box.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); done(); } else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); } });
    back.addEventListener('pointerdown', e => e.stopPropagation());
    back.appendChild(box); document.body.appendChild(back);
    const first = box.querySelector('input,select'); if (first) first.focus();
    return back;
  },
  /* find_font.rs show */
  findFont(){
    const id = 'aiTypeFindFontDlg', old = document.getElementById(id); if (old) old.remove();
    const back = document.createElement('div'); back.className = 'aitdlg-back'; back.id = id;
    const box = document.createElement('div'); box.className = 'aitdlg'; box.style.width = '400px';
    const S = {selected:0, family:families()[0] || 'sans-serif', style:''};
    const msg = document.createElement('div'); msg.className = 'msg';
    const draw = () => {
      const list = CMD.run('ai.text.fonts', {}).fonts;
      box.innerHTML = `<div class="t">${Lang.t('aitype.ffTitle')}</div><div>${Lang.t('aitype.ffInDoc')} ${list.length}</div>`;
      const ul = document.createElement('div'); ul.className = 'ff-list';
      list.forEach((f, i) => {
        const it = document.createElement('div'); it.className = 'ff-i' + (i === S.selected ? ' on' : '') + (f.missing ? ' miss' : ''); it.dataset.i = i;
        it.textContent = `${f.family} ${f.style}${f.missing ? '  ' + Lang.t('aitype.ffMissing') : ''}  (${f.runs})`;
        it.onclick = () => { S.selected = i; draw(); };
        ul.appendChild(it);
      });
      box.appendChild(ul);
      box.appendChild(Object.assign(document.createElement('div'), {textContent:Lang.t('aitype.ffReplace')}));
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px';
      const fam = document.createElement('select'); fam.dataset.k = 'family'; families().forEach(x => { const o = document.createElement('option'); o.value = x; o.textContent = x; fam.appendChild(o); }); fam.value = S.family;
      fam.onchange = () => { S.family = fam.value; S.style = ''; };
      const sty = document.createElement('select'); sty.dataset.k = 'style';
      [['', Lang.t('aitype.closest')]].concat(((CMD.map['text.fonts'].run({}) || {}).styles || []).map(x => [x, x])).forEach(([v, n]) => { const o = document.createElement('option'); o.value = v; o.textContent = n; sty.appendChild(o); });
      sty.value = S.style; sty.onchange = () => { S.style = sty.value; };
      row.append(fam, sty); box.appendChild(row);
      const bar = document.createElement('div'); bar.className = 'bar';
      const from = list[S.selected];
      const act = (k, fn) => { const b = document.createElement('button'); b.textContent = Lang.t(k); b.dataset.act = k.split('.')[1]; b.disabled = !from && k !== 'aitype.done'; b.onclick = fn; bar.appendChild(b); };
      const change = all => { const to = S.style ? {family:S.family, style:S.style} : {family:S.family};
        const r = CMD.run('ai.text.replaceFont', {from:{family:from.family, style:from.style}, to, selectionOnly:!all});
        msg.textContent = r && r.ok === false ? r.error : ''; if (window.UI){ UI.draw(); } draw(); };
      act('aitype.find', () => { CMD.run('ai.select.font', {family:from.family, style:from.style}); if (window.UI) UI.draw(); });
      act('aitype.change', () => change(false));
      act('aitype.changeAll', () => change(true));
      act('aitype.done', () => { back.remove(); if (window.UI) UI.draw(); });
      box.appendChild(bar); box.appendChild(msg);
    };
    draw();
    box.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); back.remove(); } });
    back.addEventListener('pointerdown', e => e.stopPropagation());
    back.appendChild(box); document.body.appendChild(back);
    return back;
  }
};

/* ═══════════ 本菜单的快捷键（AI 模式：建立外框 Ctrl+Shift+O） ═══════════ */
window.addEventListener('keydown', e => {
  if (!window.Menubar || Menubar.app !== 'ai' || !MenuTrees.ai || !MenuTrees.ai.type) return;
  if (/input|select|textarea/i.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable)) return;
  if (document.querySelector('.aitdlg-back,.aidlg-back,.aivdlg-back')) return;
  if (!((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === 'KeyO')) return;
  const f = Menubar.find('type.createOutlines'); if (!f || !Menubar.enabled(f.item)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  Menubar.run(f.item);
}, true);

/* ═══════════════════════════════════════════════════════════════════════════
   过渡钩子（这几件之后可接进共用层；接上之后这里看到已接就不再包）：
   ① engine.js renderLayer：文字层 AiType.isExt(L.data) ⇒ return AiType.render(L, scale)
   ② ui.js：UI.overlays.push((ctx, s) => AiType.drawHidden(ctx, s))
   ③ AiSel.textBounds：扩充文字层与直排文字层用 AiType.boundsOf(L)（直排／路径文字的选取框才对）
   ═══════════════════════════════════════════════════════════════════════════ */
function hookRender(){
  const o = window.renderLayer;
  if (typeof o !== 'function' || o.__aiType || /AiType/.test(String(o))) return;
  const w = function(L, scale){ if (L && L.kind === 'text' && isExt(L.data) && !(window.TouchType && TouchType.touched(L))) return renderExt(L, scale); return o.apply(this, arguments); };
  w.__aiType = true;
  window.renderLayer = w;
}
function hookOverlay(){
  if (!window.UI || !Array.isArray(UI.overlays) || UI.__aiTypeHidden) return;
  UI.__aiTypeHidden = true;
  UI.overlays.push((ctx, s) => AiType.drawHidden(ctx, s));
}
function hookSelBounds(){
  if (!window.AiSel || AiSel.__aiTypeBounds || typeof AiSel.textBounds !== 'function') return;
  AiSel.__aiTypeBounds = true;
  const o = AiSel.textBounds;
  AiSel.textBounds = function(L){ return (L && L.data && (isExt(L.data) || isV(L.data))) ? boundsOf(L) : o.apply(this, arguments); };
}
function hookAll(){ hookRender(); hookOverlay(); hookSelBounds(); hookSetStyle(); ['text.edit', 'text.setStyle'].forEach(hookReflow); ensureGlyphPanelDef(); }
hookAll();
window.addEventListener('DOMContentLoaded', () => { hookAll(); if (window.UI && UI.canvas) UI.draw(); });
if (window.UI && UI.canvas) UI.draw();
})();
