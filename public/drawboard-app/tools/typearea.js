/* 区域文字工具（AI ai.type-area）＋ 五颗文字工具的共用核心 window.AiTypeKit
   照 ArtCraft VectorCraft 原码逐段翻译：
     vectorcraft/crates/tools/src/text.rs 1-602（TypeTool：Type／Area／OnPath × 横排／直排 六颗共用一个状态机，按 id 分 mode 与 vertical）
       :66  new(id)           areaType|verticalAreaType ⇒ Area；typeOnPath|verticalTypeOnPath ⇒ OnPath；id 以 vertical 开头 ⇒ 直排
       :121 finish            结束编辑：收掉打字会话；点出来的点文字若还是空的 ⇒ text.discardEmpty（连同点下去之后的步骤一起丢）
       :138 replace           用 insert 换掉选取；一段打字＝一步历史（文件被别人改过 ⇒ 另起一段）
       :174 move_to           移动插入点（Shift 留着锚点）＝结束这段打字
       :193 hit_edited        点在编辑中那段字里？（区域文字＝框、其余＝版面外框，各放大 4 萤幕像素）
       :205 select_word_or_para  双击选词、三连击选段落
       :213 path_at           区域文字／路径文字工具：点下去那条路径（区域文字要闭合；4 萤幕像素、只认轮廓）
       :221 on_up             放开：先 finish；点到现有文字＝放插入点；区域／路径工具没拖＝点路径变文字（text.createInPath）；
                              否则拖够大（两边都 > 6 萤幕像素）＝区域文字框、不然＝点文字
       :259 overflow_marker   溢出：框右下角（路径文字＝路径终点）画红框＋加号
       :317 pointer           按下：点在编辑中的字上＝放插入点（4 萤幕像素内连点算第 n 下；三连击＝段落；其余开始拖选）；不然记下按下点
                              拖曳：拖选（插入点跟着走）或记下拖到哪；放开：拖选结束或 on_up；双击＝选词
       :369 text_input        打字：滤掉控制字（\n \t 留着、\r→\n）；文件设定「使用弯引号」⇒ 单打一个直引号换成开／关引号（看前一个字）
       :396 key               Esc＝结束；Enter＝换行；Tab＝跳格；⌫⌦（有选取删选取；⌘／⌥＝删词）；←→（有选取先收到那一头；⌘／⌥＝按词）；
                              ↑↓（保持横向位置；⌘＝段首／段尾）；Home/End（⌘＝全文头尾）；直排：↑→← 、↓→→、→→↑、←→↓；⇧＝延伸选取
       :493 after_command     编辑中的字被取消选取／删掉 ⇒ 结束编辑
       :505 notify            建好新字（text.create／createInPath）＝开始编辑它；只有点文字记成 fresh
       :514 options/set_option  {editing,start,end,caret,anchor,typing}；select／selectAll／commitTyping／stopEditing
       :552 overlays          拖框＝虚线框；编辑中：框／路径（蓝 79,128,255）、插入点（黑线）或选取（蓝 60,120,255,90）、溢出记号
       :592 cursor            区域／路径工具指到能用的路径＝十字，不然＝文字游标
     vectorcraft/crates/text/src/edit.rs 165-253  prev_char／next_char／prev_word／next_word（字＝字母数字 _ ' ’）／word_at／paragraph_at
     vectorcraft/crates/text/src/lib.rs 193-360   caret_position／hit_byte（路径文字＝最近的字、过半＝字后）／byte_in_line／line_end（软折行停在行尾空白前）／
                                                  line_home／line_end_of／caret_vertical／selection_quads
     vectorcraft/crates/doc/src/setup.rs 90-136   Quotes::apply（前面是空白／开括号／破折号／开引号 ⇒ 开引号，否则关引号）
     vectorcraft/crates/tools/src/text_tests.rs 1-229  测试照着它们写（tests/自测-typearea.py 等）
   我们这边的对应：
     ■ AI 的「文字物件」＝文字层（kind:'text'）；AI 工具栏只在矢量层上出现 ⇒ 建字、编辑时「当前层」一律留在原来那层矢量层，
       编辑中的文字放进 AiSel.text（AI 选择菜单的文字物件选取，menus/impl/ai-select.js）＝原码的 select.set。
       编辑那段的会话（插入点、选取、IME 组字、复制贴上）借 tools/text.js 露出的 window.TypeTool（⛔ 不改它），几何与按键语意照 text.rs 自己做。
     ■ 版面（插入点、点到第几个字、选取框）全用 menus/impl/ai-type.js 露出的 AiType.layoutOf（跟画出来的同一份）；直排用 tools/typev.js 的 TypeVKit.vGeom。
     ■ 改文件的事全走 CMD：
         <id>.place（＝放开滑鼠 on_up）／<id>.type（打字）／<id>.key（按键）／<id>.select／<id>.state／<id>.finish／<id>.discardEmpty，
         底下叫 text.create／typev.create（直排）／ai.text.createInPath（点路径）／text.edit（改字，带 coalesce＝一段打字一步）。
     ■ 五颗（typearea typepath vtype vtypearea vtypepath）都用 AiTypeKit.reg(id, mode, vertical) 登记；touchtype 另写（原码没有）。 */
(function(){
'use strict';

const TT = () => window.TypeTool;            // tools/text.js 比本档晚载入 ⇒ 用时才取
const KV = () => window.TypeVKit;            // tools/typev.js
const AT = () => window.AiType;              // menus/impl/ai-type.js（更晚载入）
const chars = s => Array.from(String(s == null ? '' : s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const zoom = () => Math.max((window.UI && UI.zoom) || 1, 0.01);
const tol = px => px / zoom();                                     // ToolContext::tol
const isText = L => !!L && L.kind === 'text';
const isVert = L => !!(L && L.data && L.data.orientation === 'vertical');
const BLUE = 'rgb(79,128,255)', SEL = 'rgba(60,120,255,' + (90 / 255).toFixed(3) + ')', RED = 'rgb(230,30,30)';

/* ═══════════ edit.rs：纯文字上的移动（字元索引） ═══════════ */
const isWordChar = c => /[\p{Alphabetic}\p{N}_'’]/u.test(c);          // edit.rs:175 is_word_char
const prevChar = (cs, i) => Math.max(0, Math.min(i, cs.length) - 1);
const nextChar = (cs, i) => Math.min(cs.length, i + 1);
function prevWord(cs, i){                                              // edit.rs:180
  let k = Math.min(i, cs.length);
  while (k > 0 && !isWordChar(cs[k - 1])) k--;
  while (k > 0 && isWordChar(cs[k - 1])) k--;
  return k;
}
function nextWord(cs, i){                                              // edit.rs:194
  let k = Math.min(i, cs.length);
  while (k < cs.length && !isWordChar(cs[k])) k++;
  while (k < cs.length && isWordChar(cs[k])) k++;
  return k;
}
function wordAt(cs, i){                                                // edit.rs:207（字的尾巴上：字赢过后面的空白／标点）
  i = clamp(i, 0, cs.length);
  const next = cs[i], prev = i > 0 ? cs[i - 1] : undefined;
  let c, at;
  if (next !== undefined && prev !== undefined && !isWordChar(next) && isWordChar(prev)){ c = prev; at = i - 1; }
  else if (next !== undefined){ c = next; at = i; }
  else if (prev !== undefined){ c = prev; at = i - 1; }
  else return [i, i];
  const cls = ch => isWordChar(ch) ? 0 : (/\s/.test(ch) && ch !== '\n') ? 1 : 2;
  const k = cls(c);
  if (k === 2) return [at, at + 1];
  let a = at; while (a > 0 && cls(cs[a - 1]) === k) a--;
  let b = at; while (b < cs.length && cls(cs[b]) === k) b++;
  return [a, b];
}
function paragraphAt(cs, i){                                           // edit.rs:248
  i = clamp(i, 0, cs.length);
  let a = i; while (a > 0 && cs[a - 1] !== '\n') a--;
  let b = i; while (b < cs.length && cs[b] !== '\n') b++;
  return [a, b];
}
/* setup.rs:116-136 Quotes::apply（文件设定在 Doc.aiSetup：quotes {double:'“”', single:'‘’'}、typographersQuotes 缺省 true） */
function quotesSetup(){
  const s = Object.assign({typographersQuotes:true, quotes:{double:'“”', single:'‘’'}}, Doc.aiSetup || {});
  const q = s.quotes || {};
  const two = (v, d) => { const a = Array.isArray(v) ? v : chars(v || ''); return a.length >= 2 ? [a[0], a[1]] : d; };
  return {on:!!s.typographersQuotes, double:two(q.double, ['“', '”']), single:two(q.single, ['‘', '’'])};
}
function applyQuotes(q, text, prev){
  const isOpen = c => c === q.double[0] || c === q.single[0];
  const opens = p => p === undefined || p === null || /\s/.test(p) || '([{—–'.includes(p) || isOpen(p);
  let out = '';
  for (const c of chars(text)){
    const r = c === '"' ? q.double[opens(prev) ? 0 : 1] : c === "'" ? q.single[opens(prev) ? 0 : 1] : c;
    out += r; prev = r;
  }
  return out;
}

/* ═══════════ 版面几何（文件坐标）：text/src/lib.rs 的 caret_position／hit_byte／line_end／caret_vertical／selection_quads ═══════════
   一个几何物件 G：{n, lines:[{start,end}], lineOf(i), caret(i)→[上,下], hit(p)→i, goal(i), inLine(li,goal), lineEnd(li), quads(a,b), bounds, overflow} */
const Af = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
function lineOfIn(lines, i){                                           // TextLayout::line_of：软折行的交界算下一行
  for (let k = 0; k < lines.length; k++){
    const l = lines[k], nx = lines[k + 1];
    if (i < l.end || (i === l.end && !(nx && nx.start === l.end))) return k;
  }
  return Math.max(0, lines.length - 1);
}
/* 横排（点文字／区域文字）：AiType.layoutOf 的每个字是一个平移矩阵 m=[1,0,0,1,x,基线] */
function horzGeo(L, lay, n){
  const asc = lay.asc, desc = lay.desc, cs = chars(L.data.text);
  const lines = lay.lines.map(l => {
    const gs = lay.glyphs.filter(g => g.i >= l.start && g.i < l.end).map(g => ({i:g.i, x:g.m[4], adv:g.adv}));
    const x1 = l.end_pt[0] - 1, base = l.end_pt[1];
    return {start:l.start, end:l.end, gs, base, x0:gs.length ? Math.min(gs[0].x, x1) : x1, x1};
  });
  if (!lines.length) lines.push({start:0, end:n, gs:[], base:L.data.y + L.y, x0:L.data.x + L.x, x1:L.data.x + L.x});
  const lineOf = i => lineOfIn(lines, i);
  const xIn = (li, i) => {                                             // lib.rs:288 x_in_line
    const l = lines[li], g = l.gs.find(g => g.i + 1 > i);
    if (g) return g.x;
    const e = l.gs[l.gs.length - 1]; return e ? e.x + e.adv : l.x0;
  };
  const lineEnd = li => {                                              // lib.rs:266 line_end
    const l = lines[li], soft = lines[li + 1] && lines[li + 1].start === l.end;
    const g = l.gs[l.gs.length - 1];
    return (g && soft && g.i + 1 === l.end) ? g.i : l.end;
  };
  const inLine = (li, x) => {                                          // lib.rs:257 byte_in_line
    const l = lines[li]; if (!l) return 0;
    const g = l.gs.find(g => x < g.x + g.adv * 0.5);
    return g ? g.i : lineEnd(li);
  };
  const box = L.data.box && !L.data.path ? [L.data.box.x + L.x, L.data.box.x + L.x + L.data.box.w] : null;
  return {n, lines, lineOf, lineEnd, inLine, vertical:false, asc, desc, overflow:lay.overflow,
    caret(i){ const li = lineOf(i), l = lines[li], x = xIn(li, i); return [[x, l.base - asc], [x, l.base + desc]]; },
    goal(i){ return xIn(lineOf(i), i); },
    hit(p){                                                            // lib.rs:213 hit_byte：先比上下距离（到 1/100），再比左右
      let best = 0, bd = null;
      lines.forEach((l, k) => {
        const top = l.base - asc, bot = l.base + desc;
        const dy = p[1] < top ? top - p[1] : p[1] > bot ? p[1] - bot : 0;
        const a = box ? Math.min(box[0], l.x0) : l.x0, b = box ? Math.max(box[1], l.x1) : l.x1;
        const dx = p[0] < a ? a - p[0] : p[0] > b ? p[0] - b : 0;
        const d = [Math.round(dy * 100), dx];
        if (!bd || d[0] < bd[0] || (d[0] === bd[0] && d[1] < bd[1])){ bd = d; best = k; }
      });
      return inLine(best, p[0]);
    },
    quads(a, b){                                                       // lib.rs:334 selection_quads
      if (a > b) [a, b] = [b, a];
      const out = []; if (a === b) return out;
      lines.forEach((l, li) => {
        if (l.start > b || l.end < a || (l.end === a && l.start < a && lines[li + 1] && lines[li + 1].start === l.end)) return;
        const xa = a <= l.start ? Math.min(l.x0, xIn(li, l.start)) : xIn(li, a);
        let xb = xIn(li, Math.min(b, l.end));
        if (b > l.end){ const g = l.gs[l.gs.length - 1]; xb = Math.max(g ? g.x + g.adv : l.x1, l.x1) + (asc + desc) * 0.25; }
        if (xb > xa) out.push([[xa, l.base - asc], [xb, l.base - asc], [xb, l.base + desc], [xa, l.base + desc]]);
      });
      return out;
    },
    bounds(){
      let r = null;
      lines.forEach(l => { const q = [l.x0, l.base - asc, l.x1, l.base + desc]; r = r ? [Math.min(r[0], q[0]), Math.min(r[1], q[1]), Math.max(r[2], q[2]), Math.max(r[3], q[3])] : q; });
      return r;
    }
  };
}
/* 直排（点文字／区域文字）：TypeVKit.vGeom 的栏 {start,end,cx,u0,u1,us}（每栏＝一行，沿栏的 y＝行内的 x；行空间转 90°） */
function vertGeo(L, lay, n){
  const g = KV().vGeom(L), half = g.half, cols = g.cols, cs = chars(L.data.text);
  const lineOf = i => lineOfIn(cols, i);
  const yIn = (li, i) => { const c = cols[li]; return c.us[clamp(i - c.start, 0, c.us.length - 1)]; };
  const lineEnd = li => {
    const c = cols[li], soft = cols[li + 1] && cols[li + 1].start === c.end;
    return (soft && c.end > c.start && /\s/.test(cs[c.end - 1])) ? c.end - 1 : c.end;
  };
  const inLine = (li, y) => {
    const c = cols[li]; if (!c) return 0;
    for (let k = 0; k < c.end - c.start; k++){ const u0 = c.us[k], u1 = c.us[Math.min(k + 1, c.us.length - 1)]; if (u1 > u0 && y < (u0 + u1) / 2) return c.start + k; }
    return lineEnd(li);
  };
  return {n, lines:cols, lineOf, lineEnd, inLine, vertical:true, overflow:lay.overflow,
    caret(i){ const li = lineOf(i), c = cols[li], y = yIn(li, i); return [[c.cx + half, y], [c.cx - half, y]]; },  // 行空间的「上」转 90° ⇒ 右边
    goal(i){ return yIn(lineOf(i), i); },
    hit(p){
      let best = 0, bd = null;
      cols.forEach((c, k) => {
        const dx = p[0] < c.cx - half ? c.cx - half - p[0] : p[0] > c.cx + half ? p[0] - c.cx - half : 0;
        const dy = p[1] < c.u0 ? c.u0 - p[1] : p[1] > c.u1 ? p[1] - c.u1 : 0;
        const d = [Math.round(dx * 100), dy];
        if (!bd || d[0] < bd[0] || (d[0] === bd[0] && d[1] < bd[1])){ bd = d; best = k; }
      });
      return inLine(best, p[1]);
    },
    quads(a, b){
      if (a > b) [a, b] = [b, a];
      const out = []; if (a === b) return out;
      cols.forEach((c, li) => {
        if (c.start > b || c.end < a || (c.end === a && c.start < a && cols[li + 1] && cols[li + 1].start === c.end)) return;
        const ya = a <= c.start ? Math.min(c.u0, yIn(li, c.start)) : yIn(li, a);
        let yb = yIn(li, Math.min(b, c.end));
        if (b > c.end) yb = Math.max(c.us[c.us.length - 1], c.u1) + g.size * 0.25;
        if (yb > ya) out.push([[c.cx + half, ya], [c.cx + half, yb], [c.cx - half, yb], [c.cx - half, ya]]);
      });
      return out;
    },
    bounds(){ return KV().textBounds(L); }
  };
}
/* 路径文字：每个字有自己的原点与方向（lib.rs on_path 那几支） */
function pathGeo(L, lay, n){
  const asc = lay.asc, desc = lay.desc, V = isVert(L), d = L.data;
  const G = lay.glyphs.map(g => {
    let dx = g.m[0], dy = g.m[1];
    if (V){ const t = dx; dx = dy; dy = -t; }                          // 直排路径文字整个字转了 90°（layout.rs:47）⇒ 转回沿路径的方向
    const l = Math.hypot(dx, dy) || 1;
    return {i:g.i, o:Af(g.m, [0, 0]), d:[dx / l, dy / l], adv:g.adv};
  });
  const lines = [{start:0, end:n}];
  const seg = (pos, dir) => { const up = [dir[1], -dir[0]]; return [[pos[0] + up[0] * asc, pos[1] + up[1] * asc], [pos[0] - up[0] * desc, pos[1] - up[1] * desc]]; };
  const start = [d.x + L.x, d.y + L.y];
  const quad = g => { const up = [g.d[1], -g.d[0]], p1 = [g.o[0] + g.d[0] * g.adv, g.o[1] + g.d[1] * g.adv];
    return [[g.o[0] + up[0] * asc, g.o[1] + up[1] * asc], [p1[0] + up[0] * asc, p1[1] + up[1] * asc], [p1[0] - up[0] * desc, p1[1] - up[1] * desc], [g.o[0] - up[0] * desc, g.o[1] - up[1] * desc]]; };
  return {n, lines, lineOf:() => 0, lineEnd:() => n, inLine:() => n, vertical:V, onPath:true, overflow:lay.overflow,
    caret(i){
      const g = G.find(g => g.i + 1 > i);
      if (g) return seg(g.o, g.d);
      const e = G[G.length - 1];
      return e ? seg([e.o[0] + e.d[0] * e.adv, e.o[1] + e.d[1] * e.adv], e.d) : seg(start, [1, 0]);
    },
    goal(){ return 0; },
    hit(p){                                                            // lib.rs:214 路径文字：最近的字（字中心），过半＝字后
      let best = null, bd = Infinity;
      G.forEach(g => { const c = [g.o[0] + g.d[0] * g.adv / 2, g.o[1] + g.d[1] * g.adv / 2], dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2; if (dd < bd){ bd = dd; best = g; } });
      if (!best) return 0;
      return ((p[0] - best.o[0]) * best.d[0] + (p[1] - best.o[1]) * best.d[1]) < best.adv * 0.5 ? best.i : best.i + 1;
    },
    quads(a, b){ if (a > b) [a, b] = [b, a]; return G.filter(g => g.i >= a && g.i < b).map(quad); },
    bounds(){
      const pts = G.length ? [].concat(...G.map(quad)) : seg(start, [1, 0]);
      return [Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))];
    }
  };
}
function geo(L){
  const lay = AT().layoutOf(L), n = chars(L.data.text).length;
  if (lay.onPath || L.data.path) return pathGeo(L, lay, n);
  if (isVert(L) && KV()) return vertGeo(L, lay, n);
  return horzGeo(L, lay, n);
}
const inflate = (r, t) => [r[0] - t, r[1] - t, r[2] + t, r[3] + t];
const inside = (r, p) => !!r && p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3];
const boxRect = L => { const b = L.data.box; return [b.x + L.x, b.y + L.y, b.x + L.x + b.w, b.y + L.y + b.h]; };

/* 文件里点到哪一层文字（hit_test 的文字那一段：最上面、看得见、没锁、不是文字蒙版暂存层；区域文字连框算） */
function textAt(p, t){
  for (let i = Doc.layers.length - 1; i >= 0; i--){
    const L = Doc.layers[i];
    if (!isText(L) || !L.visible || (L.data && L.data.typeMask) || Locks.blocks(L, 'pixels')) continue;
    let r;
    try {
      const b = AT().boundsOf(L); r = [b.x0, b.y0, b.x1, b.y1];
      if (L.data.box && !L.data.path){ const f = boxRect(L); r = [Math.min(r[0], f[0]), Math.min(r[1], f[1]), Math.max(r[2], f[2]), Math.max(r[3], f[3])]; }
    } catch (e){ continue; }
    if (inside(inflate(r, t), p)) return L;
  }
  return null;
}
/* text.rs:213 path_at：最上面那个命中的物件要是路径（closed＝要闭合）；只认轮廓、容差 4 萤幕像素 */
function pathAt(p, closed){
  const t = tol(4);
  for (let i = Doc.layers.length - 1; i >= 0; i--){
    const V = Doc.layers[i];
    if (!V || V.kind !== 'vector' || !V.visible || Locks.blocks(V, 'pixels')) continue;
    const lp = [p[0] - V.x, p[1] - V.y];
    for (let k = V.data.shapes.length - 1; k >= 0; k--){
      const s = V.data.shapes[k];
      if (s.locked || s.visible === false) continue;
      const g = VecSel.asBezier(s);
      if (!g || !g.anchors || g.anchors.length < 2) continue;
      const nn = VecSel.nearestOnShape(s, lp);
      if (!nn || nn.d > t) continue;
      if (closed && !g.closed) return null;                            // 最上面的物件不合用 ⇒ 不算（原码 hit 只取一个）
      return {layer:V, shape:s};
    }
  }
  return null;
}

/* ═══════════ 状态（text.rs:42 TypeTool 的栏位；editing／caret／anchor 放在 TypeTool.ed，其余在这里） ═══════════ */
const K = {
  edRef: null,           // 这段编辑是我们开的（TypeTool.ed 同一个物件）
  host: null,            // 编辑时的当前层（矢量层）：被换走＝after_command 结束编辑
  fresh: null,           // {id, snap}：点出来的点文字（snap＝建它之前那张历史快照，discardEmpty 用）
  typing: false,         // 一段打字会话进行中（text.rs:54 typing）
  goal: null,            // ↑↓ 保持的横向位置（text.rs:53 goal_x）
  press: null, drag: null, selecting: false,
  clicks: {pos:null, n:0},
  _pending: false
};
const ed = () => { const T = TT(); return (T && T.ed && T.ed === K.edRef) ? T.ed : null; };
const edLayer = () => { const e = ed(); if (!e) return null; const L = Doc.byId(e.layer); return isText(L) ? L : null; };
function rebuild(){ const cur = Tools.current(); if (cur && cur._aiTypeKit && window.UI) UI.buildOptions(cur.id); }

/* text.rs:183 start_editing */
function startEditing(id, caret){
  const T = TT();
  K.host = Doc.activeId;
  T.begin({layer:id, caret, anchor:caret, session:T.newKey(), created:false, dragging:false, preedit:null});
  K.edRef = T.ed; K.fresh = null; K.typing = false; K.goal = null; K.selecting = false;
  if (window.AiSel) AiSel.text = [id];                                  // select.set {ids:[id]}
  if (window.VecSel) VecSel.clear();
  rebuild();
}
/* text.rs:121 finish（回 {ok, discarded}） */
function finish(cfgId){
  const e = ed(); if (!e) return {ok:false, editing:false};
  const id = e.layer, fresh = K.fresh;
  TT().end();
  K.edRef = null; K.typing = false; K.selecting = false; K.goal = null; K.fresh = null;
  let discarded = false;
  const L = Doc.byId(id);
  if (fresh && fresh.id === id && isText(L) && !L.data.box && !L.data.path && chars(L.data.text).length === 0){
    CMD.run((cfgId || 'typearea') + '.discardEmpty', {id, snap:fresh.snap});
    discarded = true;
  }
  rebuild();
  return {ok:true, id, discarded};
}
/* text.rs:174 move_to：移动插入点＝结束这段打字 */
function moveTo(i, extend){ const e = ed(); K.typing = false; e.caret = i; if (!extend) e.anchor = i; }
/* text.rs:138 replace */
function replace(s){
  const e = ed(), L = edLayer(); if (!e || !L){ if (e) finish(); return {ok:false, error:'not editing'}; }
  const n = chars(L.data.text).length, a = Math.min(e.caret, e.anchor, n), b = Math.min(Math.max(e.caret, e.anchor), n);
  if (a === b && !s) return {ok:true, caret:a};
  if (!K.typing){ e.session = TT().newKey(); K.typing = true; }      // 新的一段打字＝新的一步（text.js historyStep：最上面那步换了也另起）
  const r = CMD.run('text.edit', {layerId:L.id, replace:{start:a, end:b, text:s}, coalesce:e.session});
  if (r && r.ok === false) return r;
  e.caret = e.anchor = a + chars(s).length; K.goal = null;
  return {ok:true, caret:e.caret};
}
/* text.rs:205 select_word_or_para */
function selectWordOrPara(para){
  const e = ed(), L = edLayer(); if (!e || !L) return;
  const cs = chars(L.data.text), r = para ? paragraphAt(cs, e.caret) : wordAt(cs, e.caret);
  e.anchor = r[0]; e.caret = r[1];
}
/* text.rs:193 hit_edited：p 在编辑中那段字里 ⇒ 那一点的字元索引，不然 null */
function hitEdited(p){
  const L = edLayer(); if (!L) return null;
  const G = geo(L), t = tol(4);
  const r = (L.data.box && !L.data.path) ? boxRect(L) : G.bounds();
  return inside(inflate(r, t), p) ? G.hit(p) : null;
}
/* text.rs:369 text_input */
function typeText(s){
  const e = ed(), L = edLayer(); if (!e || !L) return {ok:false, error:'not editing'};
  s = chars(String(s == null ? '' : s)).filter(c => !/\p{Cc}/u.test(c) || c === '\n' || c === '\t' || c === '\r').map(c => c === '\r' ? '\n' : c).join('');
  if (!s) return {ok:true, caret:e.caret};
  const q = quotesSetup();
  if (q.on && (s === '"' || s === "'")){
    const cs = chars(L.data.text), at = Math.min(e.caret, e.anchor, cs.length);
    s = applyQuotes(q, s, at > 0 ? cs[at - 1] : undefined);
  }
  K.clicks = {pos:null, n:0};
  return replace(s);
}
/* text.rs:396 key —— k＝{key:'ArrowLeft'…, shift, alt, cmd}；回 {ok, handled} */
function keyStep(k){
  const e = ed(), L = edLayer();
  if (!e || !L){ if (e) finish(); return {ok:false, handled:false, error:'not editing'}; }
  const cs = chars(L.data.text), len = cs.length;
  e.caret = Math.min(e.caret, len); e.anchor = Math.min(e.anchor, len);
  const a = Math.min(e.caret, e.anchor), b = Math.max(e.caret, e.anchor);
  const word = !!(k.cmd || k.alt), shift = !!k.shift;
  let key = k.key;
  if (isVert(L)) key = {ArrowUp:'ArrowLeft', ArrowDown:'ArrowRight', ArrowRight:'ArrowUp', ArrowLeft:'ArrowDown'}[key] || key;   // :408
  const vertical = key === 'ArrowUp' || key === 'ArrowDown';
  if (!vertical) K.goal = null;
  const done = () => ({ok:true, handled:true, caret:e.caret, anchor:e.anchor});
  switch (key){
    case 'Escape': finish(k.cfgId); return {ok:true, handled:true, finished:true};
    case 'Enter': replace('\n'); return done();
    case 'Tab': replace('\t'); return done();
    case 'Backspace': case 'Delete':
      if (a !== b){ replace(''); return done(); }
      if (key === 'Backspace' && e.caret > 0){ e.anchor = word ? prevWord(cs, e.caret) : prevChar(cs, e.caret); replace(''); }
      else if (key === 'Delete' && e.caret < len){ e.anchor = word ? nextWord(cs, e.caret) : nextChar(cs, e.caret); replace(''); }
      return done();
    case 'ArrowLeft': moveTo((a !== b && !shift) ? a : word ? prevWord(cs, e.caret) : prevChar(cs, e.caret), shift); return done();
    case 'ArrowRight': moveTo((a !== b && !shift) ? b : word ? nextWord(cs, e.caret) : nextChar(cs, e.caret), shift); return done();
    case 'ArrowUp': case 'ArrowDown': {
      const d = key === 'ArrowUp' ? -1 : 1, G = geo(L);
      const from = (a !== b && !shift) ? (d < 0 ? a : b) : e.caret;
      const x = K.goal !== null ? K.goal : G.goal(from);
      let to;
      if (k.cmd){                                                      // ⌘↑↓＝段首／段尾（已在段首／段尾就到上一段／下一段）
        const p = paragraphAt(cs, from);
        if (d < 0) to = from === p[0] ? paragraphAt(cs, Math.max(0, p[0] - 1))[0] : p[0];
        else to = from === p[1] ? paragraphAt(cs, Math.min(len, p[1] + 1))[1] : p[1];
      } else {                                                         // lib.rs:301 caret_vertical
        const li = G.lineOf(from) + d;
        to = li < 0 ? G.lines[0].start : li >= G.lines.length ? G.lines[G.lines.length - 1].end : G.inLine(li, x);
      }
      moveTo(to, shift); K.goal = x; return done();
    }
    case 'Home': { const G = geo(L); moveTo(k.cmd ? 0 : G.lines[G.lineOf(e.caret)].start, shift); return done(); }
    case 'End': { const G = geo(L); moveTo(k.cmd ? len : G.lineEnd(G.lineOf(e.caret)), shift); return done(); }
  }
  if (k.cmd && String(key).toLowerCase() === 'a'){ e.anchor = 0; e.caret = len; K.typing = false; return done(); }   // set_option selectAll
  return {ok:true, handled:false};
}
/* text.rs:221 on_up —— cfg＝{id, mode:'type'|'area'|'onPath', vertical}；at＝按下点、to＝拖到哪（没拖＝null） */
function place(cfg, at, to){
  const out = {ok:true};
  const fin = finish(cfg.id); if (fin.discarded) out.discarded = fin.id;
  // 点到现有文字：放插入点
  const T0 = textAt(at, tol(3));
  if (T0){
    const byte = geo(T0).hit(at);
    startEditing(T0.id, byte);
    K.clicks = {pos:at.slice(), n:1};
    return Object.assign(out, {action:'edit', id:T0.id, caret:byte});
  }
  // 区域文字／路径文字工具、没拖：点路径变文字
  if (cfg.mode !== 'type' && !to){
    const onPath = cfg.mode === 'onPath';
    const hp = pathAt(at, !onPath);
    if (hp){
      const r = CMD.run('ai.text.createInPath', {path:hp.shape.id, layerId:hp.layer.id, mode:onPath ? 'onPath' : 'area', text:'', at:at.slice(), vertical:!!cfg.vertical,
        size:ToolState.fontSize, font:TT().opt.font});
      if (!r || r.ok === false) return r || {ok:false, error:'createInPath failed'};
      startEditing(r.id, 0);                                           // notify text.editNew：不是点文字 ⇒ 不记 fresh
      return Object.assign(out, {action:'createInPath', id:r.id, path:hp.shape.id});
    }
  }
  // 拖够大＝区域文字框（两边都 > 6 萤幕像素），不然＝点文字
  const area = to && Math.abs(to[0] - at[0]) > tol(6) && Math.abs(to[1] - at[1]) > tol(6);
  const T = TT();
  // keepActive：当前层留在原矢量层（换成文字层工具栏就会把这颗工具换走）；新字成为选中的文字物件
  const p = {text:'', font:T.opt.font, fontStyle:T.opt.style, size:ToolState.fontSize, align:T.opt.align, color:UI.fill(), coalesce:T.newKey(), keepActive:true};
  if (area) p.box = [Math.min(at[0], to[0]), Math.min(at[1], to[1]), Math.abs(to[0] - at[0]), Math.abs(to[1] - at[1])];
  else { p.x = at[0]; p.y = at[1]; }
  const before = History.past.length;
  const r = CMD.run(cfg.vertical ? 'typev.create' : 'text.create', p);
  if (!r || !r.id) return r || {ok:false, error:'create failed'};
  const snap = History.past.length > before ? History.past[History.past.length - 1] : null;
  startEditing(r.id, 0);
  if (!area) K.fresh = {id:r.id, snap};                                // notify：点文字记成 fresh
  return Object.assign(out, {action:'create', id:r.id, area:!!area});
}
/* text.rs:514 options */
function state(){
  const e = ed();
  if (!e) return {editing:null};
  return {editing:e.layer, start:Math.min(e.caret, e.anchor), end:Math.max(e.caret, e.anchor), caret:e.caret, anchor:e.anchor, typing:K.typing};
}

/* ═══════════ 叠画（text.rs:552 overlays） ═══════════ */
function poly(ctx, s, pts){ ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q[0] * s, q[1] * s) : ctx.moveTo(q[0] * s, q[1] * s)); ctx.closePath(); }
function overflowMarker(ctx, s, L, G){                                // text.rs:259
  if (!G.overflow) return;
  const d = L.data; let c = null;
  if (d.box && !d.path) c = [d.box.x + d.box.w + L.x, d.box.y + d.box.h + L.y];
  else if (d.path && d.path.anchors && d.path.anchors.length){ const A = d.path.anchors, a = d.path.closed ? A[0] : A[A.length - 1]; c = [a.x + L.x, a.y + L.y]; }
  if (!c) return;
  const dpr = s / zoom(), h = tol(4.5), k = tol(2.5);
  ctx.save(); ctx.strokeStyle = RED; ctx.lineWidth = dpr; ctx.setLineDash([]);
  ctx.strokeRect((c[0] - h) * s, (c[1] - h) * s, 2 * h * s, 2 * h * s);
  ctx.beginPath(); ctx.moveTo((c[0] - k) * s, c[1] * s); ctx.lineTo((c[0] + k) * s, c[1] * s); ctx.moveTo(c[0] * s, (c[1] - k) * s); ctx.lineTo(c[0] * s, (c[1] + k) * s); ctx.stroke();
  ctx.restore();
}
function pathOutline(ctx, s, L){
  const P = L.data.path; if (!P || !P.anchors || !P.anchors.length) return;
  const A = P.anchors, X = q => (q[0] + L.x) * s, Y = q => (q[1] + L.y) * s;
  ctx.beginPath(); ctx.moveTo((A[0].x + L.x) * s, (A[0].y + L.y) * s);
  const seg = (p, q) => { const c1 = p.out || [p.x, p.y], c2 = q.in || [q.x, q.y]; ctx.bezierCurveTo(X(c1), Y(c1), X(c2), Y(c2), (q.x + L.x) * s, (q.y + L.y) * s); };
  for (let i = 1; i < A.length; i++) seg(A[i - 1], A[i]);
  if (P.closed) seg(A[A.length - 1], A[0]);
  ctx.stroke();
}
function drawOverlay(ctx, s){
  const dpr = s / zoom();
  // after_command：编辑中的字不在选取里了、或当前层被换走 ⇒ 结束编辑（下一拍做，别在画的时候改文件）
  const e = ed();
  if (e){
    const L = edLayer();
    if (!L){ TT().end(); K.edRef = null; K.typing = false; K.fresh = null; rebuild(); }
    else if (!K._pending && ((window.AiSel && !AiSel.text.includes(L.id)) || (K.host && Doc.activeId !== K.host && Doc.activeId !== L.id))){
      K._pending = true;
      setTimeout(() => { K._pending = false; const L2 = edLayer(); if (L2 && ((window.AiSel && !AiSel.text.includes(L2.id)) || (K.host && Doc.activeId !== K.host && Doc.activeId !== L2.id))){ finish(Tools.current().id); UI.draw(); } }, 0);
    }
  }
  ctx.save(); ctx.setLineDash([]);
  if (K.press && K.drag){                                              // Overlay::Marquee
    const a = K.press, b = K.drag;
    ctx.strokeStyle = '#000'; ctx.lineWidth = dpr; ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.strokeRect(Math.min(a[0], b[0]) * s, Math.min(a[1], b[1]) * s, Math.abs(b[0] - a[0]) * s, Math.abs(b[1] - a[1]) * s);
    ctx.setLineDash([]);
  }
  const L = edLayer();
  // 选取里其它文字的溢出记号
  for (const id of (window.AiSel ? AiSel.text : [])){
    if (L && id === L.id) continue;
    const T = Doc.byId(id); if (!isText(T) || !T.visible) continue;
    try { overflowMarker(ctx, s, T, geo(T)); } catch (err){}
  }
  if (L){
    const G = geo(L), x = ed();
    const n = G.n; x.caret = Math.min(x.caret, n); x.anchor = Math.min(x.anchor, n);
    ctx.strokeStyle = BLUE; ctx.lineWidth = dpr;
    if (L.data.box && !L.data.path){ const f = boxRect(L); ctx.strokeRect(f[0] * s, f[1] * s, (f[2] - f[0]) * s, (f[3] - f[1]) * s); }
    else if (L.data.path) pathOutline(ctx, s, L);
    const a = Math.min(x.caret, x.anchor), b = Math.max(x.caret, x.anchor);
    const c = G.caret(x.caret);
    if (TT().placeIme) TT().placeIme(Math.min(c[0][0], c[1][0]), Math.min(c[0][1], c[1][1]), Math.max(c[0][1], c[1][1]));
    if (a === b){
      ctx.strokeStyle = '#000'; ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.moveTo(c[0][0] * s, c[0][1] * s); ctx.lineTo(c[1][0] * s, c[1][1] * s); ctx.stroke();
    } else {
      ctx.fillStyle = SEL;
      for (const q of G.quads(a, b)){ poly(ctx, s, q); ctx.fill(); }
    }
    overflowMarker(ctx, s, L, G);
  }
  ctx.restore();
}

/* ═══════════ 键盘：焦点在 TypeTool 的隐藏输入框时（平常打字）键先到这里（捕获阶段，比 text.js 的输入框监听早） ═══════════ */
function keyFromEvent(e, cfgId){
  if (!ed()) return false;
  const cmd = e.ctrlKey || e.metaKey;
  const NAV = ['Escape', 'Enter', 'Tab', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (NAV.includes(e.key) || (cmd && e.key.toLowerCase() === 'a' && !e.shiftKey && !e.altKey)){
    CMD.run(cfgId + '.key', {key:e.key, shift:e.shiftKey, alt:e.altKey, cmd});
    return true;
  }
  if (e.key.length === 1 && !cmd){ CMD.run(cfgId + '.type', {text:e.key}); return true; }
  return false;
}
window.addEventListener('keydown', e => {
  const T = TT(); if (!T || !T.ta || e.target !== T.ta) return;
  if (e.isComposing || e.keyCode === 229) return;                     // 组字中的键归输入法（TypeTool 收 composition 事件）
  const cur = Tools.current(); if (!cur || !cur._aiTypeKit || !ed()) return;
  if (keyFromEvent(e, cur.id)){ e.preventDefault(); e.stopImmediatePropagation(); UI.draw(); }
}, true);

/* ═══════════ 选项栏：借 TypeVKit.buildOptions（字体、样式、字号、对齐、颜色），拿掉取向钮与 ⊘（原码没有取消，只有结束） ═══════════ */
function buildOptions(cfg, box, add, mk){
  const vk = {id:cfg.id, orientation:cfg.vertical ? 'vertical' : 'horizontal', hint:cfg.hint,
    commit:() => CMD.run(cfg.id + '.finish', {}), cancel:() => CMD.run(cfg.id + '.finish', {}), toggle(){}};
  if (KV() && KV().buildOptions) KV().buildOptions(vk, box, add, mk);
  else if (Tools.get('text')) Tools.get('text').buildOptions(box, add, mk);
  box.querySelectorAll('[data-type-opt="orientation"],[data-type-cmd="cancel"]').forEach(b => b.remove());
}

/* ═══════════ 登记一颗（命令＋工具） ═══════════ */
const MODE_NAME = {type:'点文字', area:'区域文字', onPath:'路径文字'};
function reg(id, mode, vertical, extra){
  const cfg = {id, mode, vertical:!!vertical, hint:'ui.aitype.hint.' + id};
  const D = (vertical ? '直排' : '横排') + (mode === 'type' ? '文字工具' : mode === 'area' ? '区域文字工具' : '路径文字工具');
  CMD.reg(id + '.place', {i18n:'', params:`{x,y 文件坐标＝按下点, to?:[x,y]＝拖到哪（没拖就别给）} ${D}放开滑鼠那一下（vectorcraft text.rs:221 on_up）：先结束目前的编辑；` +
    `点到现有文字＝进去编辑、插入点放在那一点；` + (mode === 'type' ? '' : `没拖且点在${mode === 'area' ? '闭合' : ''}路径上（4 萤幕像素内）＝把路径变成${vertical ? '直排' : ''}${MODE_NAME[mode]}（ai.text.createInPath，路径从矢量层拿掉）；`) +
    `拖的框两边都 > 6 萤幕像素＝新的${vertical ? '直排' : ''}区域文字框，不然＝在按下点放${vertical ? '直排' : ''}点文字（空的；结束编辑时还空着就整个丢掉）。当前层留在原矢量层、新字放进 AiSel.text → {ok, action:"edit"|"createInPath"|"create", id, caret?, area?}`},
    p => {
      if (!isFinite(+p.x) || !isFinite(+p.y)) return {ok:false, error:id + '.place: x, y required'};
      const to = Array.isArray(p.to) && p.to.length === 2 && isFinite(+p.to[0]) && isFinite(+p.to[1]) ? [+p.to[0], +p.to[1]] : null;
      return place(cfg, [+p.x, +p.y], to);
    });
  CMD.reg(id + '.type', {i18n:'', params:'{text} 编辑中打字（text.rs:369 text_input）：换掉选取；控制字滤掉（\\n \\t 留着）；文件设定「使用弯引号」时单打 " 或 \' 换成开／关引号；同一段打字（中间没移动插入点）只算一步历史 → {ok, caret}'},
    p => typeText(p.text));
  CMD.reg(id + '.key', {i18n:'', params:'{key:"Escape|Enter|Tab|Backspace|Delete|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|a", shift?, alt?, cmd?} 编辑中按键（text.rs:396）：Esc＝结束；Enter 换行；Tab 跳格；⌫⌦ 删选取或一个字（⌘/⌥＝一个词）；←→（有选取先收到那头；⌘/⌥＝按词）；↑↓（保持横向位置；⌘＝段首/段尾）；Home/End（⌘＝全文头尾）；直排时方向键跟着文字流转 90°；shift＝延伸选取；cmd+a＝全选 → {ok, handled, caret, anchor}'},
    p => keyStep(Object.assign({}, p, {cfgId:id})));
  CMD.reg(id + '.select', {i18n:'', params:'{start?, end?（字元索引）| all?:true} 编辑中设定选取（text.rs:526 set_option select／selectAll；anchor＝start、caret＝end） → 同 .state'}, p => {
    const e = ed(), L = edLayer(); if (!e || !L) return {ok:false, error:'not editing'};
    const n = chars(L.data.text).length;
    if (p.all){ e.anchor = 0; e.caret = n; }
    else { e.anchor = clamp(+p.start || 0, 0, n); e.caret = p.end == null ? e.anchor : clamp(+p.end, 0, n); }
    K.typing = false; K.goal = null;
    return Object.assign({ok:true}, state());
  });
  CMD.reg(id + '.state', {i18n:'', params:'{} 编辑状态（text.rs:514 options）→ {editing:层 id|null, start, end, caret, anchor, typing}'}, () => Object.assign({ok:true}, state()));
  CMD.reg(id + '.finish', {i18n:'', params:'{} 结束编辑（＝Esc、换工具；text.rs:121 finish）：点出来的点文字还空着就连同那几步一起丢掉 → {ok, id, discarded}'}, () => finish(id));
  CMD.reg(id + '.discardEmpty', {i18n:'', params:'{id, snap?} 丢掉一个空的点文字（text.discardEmpty）：历史里还留着建它之前那一步 ⇒ 退回那一步、连后面的步骤一起拿掉（不留 Ctrl+Z）；不然删掉那层（一步历史）'}, p => {
    const L = Doc.byId(p.id); if (!isText(L)) return {ok:false, error:'not a text layer'};
    if (chars(L.data.text).length) return {ok:false, error:'text is not empty'};
    const k = p.snap ? History.past.lastIndexOf(p.snap) : -1;
    if (k >= 0 && !p.snap.layers.some(o => o.id === p.id)){
      History.restoreInPlace(p.snap); History.past.length = k; History.future.length = 0;
      if (window.AiSel) AiSel.text = AiSel.text.filter(x => Doc.byId(x));
      return {ok:true, unwound:true};
    }
    return CMD.run('layer.delete', {id:p.id});
  });

  const tool = {
    id, icon:'T', group:'vector', order:900, for:'vector', opts:[], cursor:vertical ? 'vertical-text' : 'text',
    _aiTypeKit:true,
    strings:extra && extra.strings,
    /* text.rs:319 Down */
    onDown(e, pt){
      if (e.button !== undefined && e.button !== 0) return;
      if (ed()){
        const byte = hitEdited(pt);
        if (byte !== null){
          const c = K.clicks, same = c.pos && Math.hypot(c.pos[0] - pt[0], c.pos[1] - pt[1]) <= tol(4);
          const n = same ? c.n + 1 : 1;
          K.clicks = {pos:pt.slice(), n};
          moveTo(byte, e.shiftKey); K.goal = null;
          if (n >= 3){ selectWordOrPara(true); K.clicks.n = 0; }
          else K.selecting = true;
          TT().focus(); UI.draw(); return;
        }
      }
      K.clicks = {pos:null, n:0}; K.press = pt.slice(); K.drag = null;
    },
    /* text.rs:339 Drag；没按着＝游标（text.rs:592 cursor） */
    onMove(e, pt, P){
      if (!P.down){
        const c = (mode !== 'type' && pathAt(pt, mode === 'area')) ? 'crosshair' : (vertical ? 'vertical-text' : 'text');
        if (UI.canvas && UI.canvas.style.cursor !== c) UI.canvas.style.cursor = c;
        return;
      }
      if (K.selecting){
        const L = edLayer(); if (L){ ed().caret = geo(L).hit(pt); K.clicks = {pos:null, n:0}; }
        UI.draw(); return;
      }
      if (K.press){ K.drag = pt.slice(); UI.draw(); }
    },
    /* text.rs:351 Up */
    onUp(){
      if (K.selecting){ K.selecting = false; if (ed()) TT().focus(); UI.draw(); return; }
      const start = K.press, to = K.drag; K.press = null; K.drag = null;
      if (!start){ UI.draw(); return; }
      CMD.run(id + '.place', to ? {x:start[0], y:start[1], to} : {x:start[0], y:start[1]});
      UI.draw();
    },
    /* text.rs:359 DoubleClick */
    onDblClick(e, pt){
      if (ed() && hitEdited(pt) !== null){ selectWordOrPara(false); K.clicks = {pos:pt.slice(), n:2}; UI.draw(); }
    },
    /* 焦点不在隐藏输入框时（点过面板）键从 ui.js 进来；编辑中单键不切工具（wants_text） */
    onKey(e){
      if (!ed() || !e.isTrusted) return false;
      if (keyFromEvent(e, id)){ e.preventDefault(); UI.draw(); if (ed()) TT().focus(); return true; }
      if (e.ctrlKey || e.metaKey) return false;
      return true;
    },
    onDeactivate(){ if (ed()) CMD.run(id + '.finish', {}); K.press = null; K.drag = null; K.selecting = false; },   // text.rs:488 deactivate＝finish
    drawOverlay,
    buildOptions(box, add, mk){ buildOptions(cfg, box, add, mk); }
  };
  if (extra && extra.order !== undefined) tool.order = extra.order;
  return Tools.reg(tool);
}

/* 三语字串：工具名与选项栏提示 */
function strings(id, names, hints){
  const o = {};
  ['zh-Hant', 'zh-Hans', 'en'].forEach((lg, i) => { o[lg] = {['tool.' + id]:names[i], ['ui.aitype.hint.' + id]:hints[i]}; });
  return o;
}

window.AiTypeKit = {reg, strings, geo, textAt, pathAt, finish, place, state, typeText, keyStep, ed, edLayer, K,
  wordAt, paragraphAt, prevWord, nextWord, applyQuotes, quotesSetup, tol, chars};

reg('typearea', 'area', false, {order:901, strings:strings('typearea',
  ['區域文字工具', '区域文字工具', 'Area Type Tool'],
  ['點一下閉合路徑＝變成區域文字 · 拖框＝區域文字 · 點空白處＝點文字 · 點進文字放插入點、拖曳選取、Shift 延伸、雙擊選字、三連擊選段落 · Esc 結束',
   '点一下闭合路径＝变成区域文字 · 拖框＝区域文字 · 点空白处＝点文字 · 点进文字放插入点、拖动选取、Shift 延伸、双击选词、三连击选段落 · Esc 结束',
   'Click a closed path: area type · drag: area type frame · click elsewhere: point type · click into text for a caret, drag to select, Shift extends, double-click a word, triple-click a paragraph · Esc ends'])});

})();
