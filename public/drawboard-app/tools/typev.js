/* 直排文字（PS「直排文字工具」ps.type-v）
   原码怎么做的：PhotoCraft 没有单独的「直排文字工具」，它只有一颗 Tool::Type，直排是文字层的 orientation（type.orientation.vertical）；
   type_tool.rs 里跟直排有关的每一条都照翻进来：
     type_tool.rs:290 line_step      上一栏／下一栏（直排的「行」＝栏），保持沿栏的位置；越过头一栏＝0、越过末栏＝全文长
     type_tool.rs:307 is_vertical    看编辑中那层的 orientation
     type_tool.rs:314 flow_key       直排时方向键跟着文字流：↑/↓＝沿栏上一字／下一字（＝横排的 ←/→）、←＝下一栏、→＝上一栏（＝横排的 ↓/↑）
                                     ⇒ 其它按键语意全不变（⌘／⌥ 按词、⇧ 延伸、⌥ 在收合插入点＝字距（我们没字距 ⇒ 不动）、⌘↑↓＝全文头尾）
     type_tool.rs:386               handle_keys 先过 flow_key 再走横排那套
     type_tool.rs:495-571 draw_overlay  行空间转 90°：点文字每栏画中线、段落文字画框＋八把手、插入点是横线、选取是每栏一段、组字底线
     type_tool.rs:700-708 options_bar  第一颗「切换文本取向」钮：有目标层就 type.orientation.<另一个>；（没有目标层原码不动——PS 2020 是换到横排文字工具，照 PS 加）
     type_tool_tests.rs:292-359      vertical_type_caret_selection_and_arrows_follow_the_columns：点字上半＝字前、下半＝字后；拖跨栏选取；↓↑←→ 的结果
   点一下／拖框／点进现有文字／拖选／⇧点延伸／双击选词／三连击选段／打字／IME／贴上／提交取消……全部跟横排同一套（type_tool.rs pointer_down/move/up），
   我们直接用 tools/text.js 露出来的 window.TypeTool（编辑会话、插入、IME、提交、历史合并），⛔ 不改它；只把「几何」换成直排的：
     直排版面用 menus/impl/ps-type.js 露出的 PsTypeRender.vLayout（跟它画出来的一模一样：栏宽＝字号、栏距＝字号×1.25、往左换栏、
     汉字假名直立、拉丁字转 90°；点文字第一栏中线在锚点 x、沿栏从锚点 y 起；段落文字第一栏右缘贴框右缘）。
   照 PS 2020 加的（原码没有）：编辑中 Ctrl 拖曳＝搬动这段字（PS 编辑时按 Ctrl 暂变移动）；⇧ 点在现有文字上＝不进编辑、另起新字（PS）。
   共用给 typemaskh.js／typemaskv.js：window.TypeVKit（直排几何、命中、叠画、按键、整颗工具的滑鼠／键盘处理 makeTool）。
   🔴 改文件的事全走 CMD：typev.create（建直排文字层）、typev.orientation（切换取向，能并进编辑那一步）、typev.layout（读直排版面）；
      打字／改字／样式／提交／取消照旧走 text.edit／text.setStyle／text.commit／text.cancel。 */
(function(){
'use strict';

const TT = () => window.TypeTool;                       // tools/text.js 比本档晚载入 ⇒ 一律用时才取
const PR = () => window.PsTypeRender;                   // menus/impl/ps-type.js 也比本档晚载入
const BLINK_MS = 530;                                   // type_tool.rs:351 插入点闪烁
const SLOP_PX = 6;                                      // type_tool.rs:60 点中文字层的容差（萤幕像素）
const MIN_BOX_PX = 4;                                   // type_tool.rs:158 拖框两边都 ≥4 萤幕像素才算段落文字
const SAME_CLICK_PX = 4;                                // vectorcraft text.rs:321 连击要落在 4 萤幕像素内
const PLACEHOLDER = 'Lorem Ipsum';                      // type_tool.rs:19
const ACCENT = '#2f7fd8';
const rround = v => Math.sign(v) * Math.round(Math.abs(v));   // Rust f64::round
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const chars = s => Array.from(String(s == null ? '' : s));
const zoom = () => Math.max((window.UI && UI.zoom) || 1, 0.01);
const fontOf = d => `${d.weight || 'normal'} ${d.size}px ${d.font}`;   // 跟 renderLayer／PsTypeRender 同一个字型串
const _mc = document.createElement('canvas').getContext('2d');
const isV = L => !!(L && L.kind === 'text' && L.data && L.data.orientation === 'vertical');

/* ═══════════ 直排几何（文件坐标） ═══════════
   vLayout 的每栏 {start,end,cx,u0,u1,runs}（图层坐标）→ 每个字界沿栏的位置 us（直立字一格一个；转 90° 的一串逐字量前缀，跟 vLayout 量整串同一个量法）。
   栏尾空白：vLayout 不排（同横排行尾空白「挂」着），插入点停在栏尾。 */
function vGeom(L){
  const d = L.data, cs = chars(d.text);
  const v = PR().vLayout(L);
  _mc.font = fontOf(d);
  const liga = !(d.features && d.features.liga === false);
  const meas = s => _mc.measureText(liga ? s : chars(s).join('‌')).width;   // ps-type.js shapeText 同法
  let cols = v.cols.map(col => {
    const us = [col.u0];
    for (const rn of col.runs){
      if (!rn.rot) us.push(rn.u + rn.adv);
      else { let acc = ''; for (const c of chars(rn.text)){ acc += c; us.push(rn.u + meas(acc)); } }
    }
    while (us.length < col.end - col.start + 1) us.push(us[us.length - 1]);
    return {start:col.start, end:col.end, soft:col.soft, cx:col.cx + L.x, u0:col.u0 + L.y, u1:col.u1 + L.y, us:us.map(u => u + L.y)};
  });
  if (!cols.length){                                    // 防呆：没排出任何栏（不该发生）
    const cx = (d.box ? d.box.x + d.box.w - d.size / 2 : d.x) + L.x, u = (d.box ? d.box.y : d.y) + L.y;
    cols = [{start:0, end:cs.length, soft:false, cx, u0:u, u1:u, us:new Array(cs.length + 1).fill(u)}];
  }
  return {cols, half:v.half, size:v.size, n:cs.length, anchor:[d.x + L.x, d.y + L.y], lh:+d.leading > 0 ? +d.leading : d.size * 1.25};
}
const colOf = (g, i) => g.cols.find(c => i >= c.start && i <= c.end) || g.cols[g.cols.length - 1];
/* TextLayout::caret（直排）：插入点是一条横线 [cx−half, cx+half] 在 y */
function vCaret(g, i){
  const c = colOf(g, i);
  return {col:c, y:c.us[clamp(i - c.start, 0, c.us.length - 1)], x0:c.cx - g.half, x1:c.cx + g.half};
}
function nearestIn(c, y){
  let best = 0, bd = Infinity;
  c.us.forEach((u, k) => { const dd = Math.abs(u - y); if (dd < bd){ bd = dd; best = k; } });
  return c.start + best;
}
/* TextLayout::hit_test（直排＝行空间转 90°）：先按 x 找栏（中线最近），再找沿栏最近的字界 */
function vHit(g, x, y){
  let k = 0, bd = Infinity;
  g.cols.forEach((c, i) => { const dd = Math.abs(c.cx - x); if (dd < bd){ bd = dd; k = i; } });
  return nearestIn(g.cols[k], y);
}
/* type_tool.rs:292 line_step（直排：dir>0＝下一栏＝往左） */
function vLineStep(L, caret, dir){
  const g = vGeom(L), cur = vCaret(g, caret), k = g.cols.indexOf(cur.col) + dir;
  if (k < 0) return 0;
  if (k >= g.cols.length) return g.n;
  return nearestIn(g.cols[k], cur.y);
}
/* type_tool.rs:329 line_edge（直排：栏头／栏尾） */
function vLineEdge(L, caret, end){ const c = colOf(vGeom(L), caret); return end ? c.end : c.start; }

/* 文字层在文件里的外框（type_tool.rs:73 l.bounds()；段落文字连框，vectorcraft text.rs:198） */
function textBounds(L){
  const d = L.data; let b;
  if (isV(L)){
    const lb = PR().logicalBounds(L);
    if (lb) b = [lb[0] + L.x, lb[1] + L.y, lb[2] + L.x, lb[3] + L.y];
    else {
      const half = d.size / 2, cx = (d.box ? d.box.x + d.box.w - half : d.x) + L.x, u = (d.box ? d.box.y : d.y) + L.y;
      b = [cx - half, u, cx + half, u + d.size];
    }
  } else {
    const lay = TT().layout(L), ls = lay.lines;
    b = [Math.min(...ls.map(l => l.x0)), ls[0].baseline - lay.asc, Math.max(...ls.map(l => l.x1)), ls[ls.length - 1].baseline + lay.desc];
  }
  const bx = d.box;
  if (bx) b = [Math.min(b[0], bx.x + L.x), Math.min(b[1], bx.y + L.y), Math.max(b[2], bx.x + L.x + bx.w), Math.max(b[3], bx.y + L.y + bx.h)];
  return b;
}
/* type_tool.rs:58 hit_layer —— 最上面、看得见的文字层；also＝额外算进去的那层（文字蒙版的暂存层是藏起来的） */
function hitLayer(x, y, also){
  const slop = SLOP_PX / zoom();
  for (let i = Doc.layers.length - 1; i >= 0; i--){
    const L = Doc.layers[i];
    if (L.kind !== 'text' || !(L.visible || L.id === also)) continue;
    if (L.data && L.data.typeMask && L.id !== also) continue;     // 别人的文字蒙版暂存层不算
    const r = textBounds(L);
    if (x >= r[0] - slop && x <= r[2] + slop && y >= r[1] - slop && y <= r[3] + slop) return L.id;
  }
  return null;
}
/* type_tool.rs:101 hit_offset：直排用直排几何，横排交给 text.js */
function hitOffset(id, x, y){
  const L = Doc.byId(id); if (!L || L.kind !== 'text') return 0;
  return isV(L) ? vHit(vGeom(L), x, y) : TT().hitOffset(id, x, y);
}

/* ═══════════ 按键（type_tool.rs:338 handle_keys，直排先过 flow_key） ═══════════ */
/* type_tool.rs:314 flow_key */
function flowKey(key, vertical){
  if (!vertical) return key;
  return {ArrowUp:'ArrowLeft', ArrowDown:'ArrowRight', ArrowLeft:'ArrowDown', ArrowRight:'ArrowUp'}[key] || key;
}
/* 直排时要换几何的那几颗（方向键、Home/End、⌘⌫ 删到栏头）在这里做；其余（打字、⌫⌦、⌥⌫、Enter、Esc、⌘A…）照旧交给 TypeTool.key。回 true＝吃掉 */
function vKey(e){
  const T = TT(), ed = T && T.ed; if (!ed) return false;
  const L = T.layer(); if (!L || !isV(L)) return false;
  const text = L.data.text, n = chars(text).length;
  ed.caret = Math.min(ed.caret, n); ed.anchor = Math.min(ed.anchor, n);     // :345 还原可能把字变短
  const a = Math.min(ed.caret, ed.anchor), b = Math.max(ed.caret, ed.anchor);
  const cmd = e.ctrlKey || e.metaKey, alt = e.altKey, shift = e.shiftKey;
  const set = (c, extend) => { ed.caret = clamp(c, 0, n); if (!extend) ed.anchor = ed.caret; };
  const key = flowKey(e.key, true);
  switch (key){
    case 'ArrowLeft': case 'ArrowRight': {
      const fwd = key === 'ArrowRight';
      if (alt && !shift && a === b) return true;                         // :410 ⌥＝字距微调（我们的文字层没有字距 ⇒ 不动，同 text.js）
      let to;
      if (cmd || alt) to = T.wordBoundary(text, ed.caret, fwd);          // :418
      else if (a !== b && !shift) to = fwd ? b : a;
      else to = fwd ? ed.caret + 1 : Math.max(0, ed.caret - 1);
      set(to, shift); return true;
    }
    case 'ArrowUp': case 'ArrowDown': {                                   // :429
      const up = key === 'ArrowUp';
      set(cmd ? (up ? 0 : n) : vLineStep(L, ed.caret, up ? -1 : 1), shift); return true;
    }
    case 'Home': case 'End':                                              // :437
      set(vLineEdge(L, ed.caret, key === 'End'), shift); return true;
    case 'Backspace':
      if (cmd && a === b){                                                // :392 ⌘⌫＝删到栏头
        const to = vLineEdge(L, a, false);
        if (to !== a){ ed.anchor = to; T.insert(''); }
        return true;
      }
  }
  return false;
}

/* ═══════════ 叠画（type_tool.rs:485 draw_overlay，直排那一支） ═══════════ */
function drawVertical(ctx, s, L, ed){
  const g = vGeom(L), n = g.n, d = L.data, half = g.half;
  ed.caret = Math.min(ed.caret, n); ed.anchor = Math.min(ed.anchor, n);
  const dpr = s / zoom();
  const cc = vCaret(g, ed.caret);
  TT().placeIme(cc.x0, cc.y, cc.y + g.size);                              // :500 告诉输入法插入点在哪
  ctx.save();
  if (d.box){                                                              // :513 段落文字：框＋八把手
    const x0 = (d.box.x + L.x) * s, y0 = (d.box.y + L.y) * s, w = d.box.w * s, h = d.box.h * s;
    ctx.strokeStyle = ACCENT; ctx.lineWidth = dpr; ctx.strokeRect(x0, y0, w, h);
    const hw = 3.5 * dpr, pts = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h], [x0 + w / 2, y0], [x0 + w, y0 + h / 2], [x0 + w / 2, y0 + h], [x0, y0 + h / 2]];
    ctx.fillStyle = '#fff';
    pts.forEach(p => { ctx.fillRect(p[0] - hw, p[1] - hw, 2 * hw, 2 * hw); ctx.strokeRect(p[0] - hw + dpr / 2, p[1] - hw + dpr / 2, 2 * hw - dpr, 2 * hw - dpr); });
  } else {                                                                 // :526 点文字：每栏的中线（行空间的基线转 90°）
    ctx.strokeStyle = ACCENT; ctx.globalAlpha = 0.8; ctx.lineWidth = dpr; ctx.beginPath();
    for (const c of g.cols){ ctx.moveTo(c.cx * s, Math.min(c.u0, g.anchor[1]) * s); ctx.lineTo(c.cx * s, Math.max(c.u1, c.u0 + 1) * s); }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (ed.preedit){                                                         // :532 组字底线（行空间基线下方＝栏中线左边）
    const [ps, pl] = ed.preedit;
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5 * dpr; ctx.beginPath();
    for (const c of g.cols){
      const lo = Math.max(ps, c.start), hi = Math.min(ps + pl, c.end); if (lo >= hi) continue;
      const x = (c.cx - half * 0.5) * s;
      ctx.moveTo(x, c.us[lo - c.start] * s); ctx.lineTo(x, c.us[hi - c.start] * s);
    }
    ctx.stroke();
  }
  const a = Math.min(ed.caret, ed.anchor), b = Math.max(ed.caret, ed.anchor);
  if (a < b){                                                              // :545 选取：每栏把 [a,b) 涂底；选到换行在栏尾多一小截
    ctx.fillStyle = 'rgba(47,127,216,' + (110 / 255).toFixed(3) + ')';
    for (const c of g.cols){
      let y0 = Infinity, y1 = -Infinity;
      const lo = Math.max(a, c.start), hi = Math.min(b, c.end);
      if (lo < hi){ y0 = c.us[lo - c.start]; y1 = c.us[hi - c.start]; }
      const endU = c.us[c.us.length - 1];
      if (b > c.end && a <= c.end){ y1 = Math.max(y1, endU + g.size * 0.25); y0 = Math.min(y0, endU); }
      if (y0 < y1) ctx.fillRect((c.cx - half) * s, y0 * s, 2 * half * s, (y1 - y0) * s);
    }
  } else if (ed.dragging || Math.floor(performance.now() / BLINK_MS) % 2 === 0){   // :563 闪烁插入点（直排是横线）
    const Y = Math.round(cc.y * s) + 0.5;
    ctx.beginPath(); ctx.moveTo(cc.x0 * s, Y); ctx.lineTo(cc.x1 * s, Y);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 0.75 * dpr; ctx.stroke();
  }
  ctx.restore();
}
/* 编辑中的叠画：直排自己画，横排交给 text.js（TypeTool.draw） */
function drawEdit(ctx, s){
  const T = TT(), ed = T && T.ed; if (!ed) return;
  const L = T.layer();
  if (!L){ T.end(); return; }                                              // 层被还原掉 ⇒ 结束
  if (isV(L)) drawVertical(ctx, s, L, ed); else T.draw(ctx, s);
}

/* ═══════════ 整颗工具的滑鼠／键盘（type_tool.rs pointer_down／move／up；三颗直排／文字蒙版共用）═══════════
   cfg = {id, create(p) → {id}（放开时建字；p 已含占位文字、样式、box 或 x/y、coalesce、按下时的修饰键 mods）,
          commit(), cancel()（结束会话）, editOthers:bool（点到现有文字层就编辑它）, owns(ed)（这段会话是不是我的）,
          key(e)（额外按键，回 true 吃掉）, drawBelow(ctx,s)（编辑叠画之前先画）} */
function makeTool(cfg){
  const st = {press:null, mods:null, move:null};
  const sessLayer = () => { const T = TT(); return T && T.ed ? T.ed.layer : null; };
  const rebuild = () => { if (ToolState.cur === cfg.id && window.UI) UI.buildOptions(cfg.id); };
  const begin = ed => { TT().begin(ed); rebuild(); };
  const kit = {
    key(e){
      const T = TT(); if (!T || !T.ed) return false;
      if (cfg.key && cfg.key(e)) return true;
      return false;                                                        // 直排的方向键等（vKey）由 text.js 的 TypeTool.key 开头叫，这里不再重复
    },
    rebuild
  };
  const tool = {
    _typeKit: kit,
    onDown(e, pt, P){
      const T = TT(), [x, y] = pt;
      st.press = null; st.move = null;
      if (T.ed){
        const id = T.ed.layer;
        if (hitLayer(x, y, id) === id){                                    // :116 点在编辑中那层：放插入点／⇧延伸／连击
          const off = hitOffset(id, x, y);
          const c = T.clicks, now = performance.now();
          const same = c.pos && Math.hypot(c.pos[0] - x, c.pos[1] - y) * zoom() <= SAME_CLICK_PX && now - c.t < 600;
          const nClicks = same ? c.n + 1 : 1;
          T.clicks = {pos:[x, y], n:nClicks, t:now};
          T.ed.caret = off; if (!e.shiftKey) T.ed.anchor = off;
          T.ed.dragging = true;
          if (nClicks >= 3){ T.selectPara(); T.clicks.n = 0; T.ed.dragging = false; }
          UI.draw(); return;
        }
        if (e.ctrlKey || e.metaKey){ st.move = {last:pt.slice()}; return; }  // PS：编辑中 Ctrl 拖＝搬动这段字
        cfg.commit(); rebuild();                                           // :127 点在外面＝提交，不另起新字
        return;
      }
      const id = cfg.editOthers && !e.shiftKey ? hitLayer(x, y) : null;
      if (id){                                                             // :130 点进现有文字 ⇒ 选层、放插入点、开始编辑
        if (window.Locks && Locks.deny(Doc.byId(id), 'pixels')) return;
        CMD.run('layer.select', {id});
        const off = hitOffset(id, x, y);
        T.clicks = {pos:[x, y], n:1, t:performance.now()};
        begin({layer:id, caret:off, anchor:off, session:T.newKey(), created:false, dragging:true});
        UI.draw(); return;
      }
      st.press = pt.slice();
      st.mods = {shift:e.shiftKey, alt:e.altKey, ctrl:e.ctrlKey || e.metaKey};
    },
    onMove(e, pt, P){
      if (!P.down) return;
      const T = TT();
      if (st.move && T.ed){                                                // Ctrl 拖：整段字跟着走（并进同一步历史）
        const dx = pt[0] - st.move.last[0], dy = pt[1] - st.move.last[1];
        if (dx || dy){ CMD.run('text.edit', {layerId:T.ed.layer, move:[dx, dy], coalesce:T.ed.session}); st.move.last = pt.slice(); }
        UI.draw(); return;
      }
      if (T.ed && T.ed.dragging){                                          // :141 拖选
        T.ed.caret = hitOffset(T.ed.layer, pt[0], pt[1]);
        if (Math.hypot(pt[0] - P.start[0], pt[1] - P.start[1]) * zoom() > SAME_CLICK_PX) T.clicks.n = 0;
        UI.draw(); return;
      }
      if (st.press){ P.preview = {a:st.press, b:pt}; UI.draw(); }
    },
    onUp(e, pt, P){
      const T = TT();
      if (st.move){ st.move = null; T.focus(); UI.draw(); return; }
      if (T.ed){ T.ed.dragging = false; T.focus(); UI.draw(); return; }    // :153
      const start = st.press; st.press = null;
      if (!start){ UI.draw(); return; }
      const w = Math.abs(pt[0] - start[0]), h = Math.abs(pt[1] - start[1]), min = MIN_BOX_PX / zoom();
      const key = T.newKey();
      const p = {text:PLACEHOLDER, font:T.opt.font, fontStyle:T.opt.style, size:ToolState.fontSize, align:T.opt.align, color:UI.fill(), coalesce:key, mods:st.mods};
      if (w >= min && h >= min) p.box = [rround(Math.min(start[0], pt[0])), rround(Math.min(start[1], pt[1])), rround(w), rround(h)];
      else { p.x = rround(start[0]); p.y = rround(start[1]); }
      const r = cfg.create(p);
      if (r && r.id) begin({layer:r.id, caret:chars(PLACEHOLDER).length, anchor:0, session:key, created:true, dragging:false});   // :184 占位文字整段选取
      UI.draw();
    },
    onDblClick(e, pt){                                                     // canvas.rs:1559 双击＝选词
      const T = TT(); if (!T.ed || hitLayer(pt[0], pt[1], T.ed.layer) !== T.ed.layer) return;
      T.selectWord(); T.clicks = {pos:pt.slice(), n:2, t:performance.now()}; UI.draw();
    },
    /* 焦点不在隐藏输入框时键从 ui.js 进来：先过直排／蒙版那几颗，其余照 text.js 的 onKey */
    onKey(e){
      const T = TT(); if (!T || !T.ed || !e.isTrusted) return false;
      if (kit.key(e)){ e.preventDefault(); UI.draw(); T.focus(); return true; }
      return Tools.get('text').onKey(e);
    },
    onDeactivate(){ if (TT() && TT().ed) cfg.commit(); st.press = null; st.move = null; },   // lib.rs:790 换工具＝提交
    drawOverlay(ctx, s){
      const T = TT();
      if (T && T.ed && Doc.activeId !== T.ed.layer && !kit._pending){      // vectorcraft text.rs:493 当前层被换走 ⇒ 结束编辑
        kit._pending = true;
        setTimeout(() => { kit._pending = false; const T2 = TT(); if (T2.ed && Doc.activeId !== T2.ed.layer){ cfg.commit(); rebuild(); UI.draw(); } }, 0);
        return;
      }
      if (cfg.drawBelow) cfg.drawBelow(ctx, s);
      drawEdit(ctx, s);
    }
  };
  return tool;
}

/* 插入点闪烁（text.js 的计时器只在文字工具时重画）：手上是这三颗、正在编辑才重画；沿用合成快取只重画叠画 */
setInterval(() => {
  const T = TT(), cur = window.Tools && Tools.current();
  if (!T || !T.ed || !cur || !cur._typeKit || (window.Pointer && Pointer.down) || !window.UI) return;
  UI._hoverDraw = true; try { UI.draw(); } finally { UI._hoverDraw = false; }
}, BLINK_MS);
/* 焦点在隐藏输入框时（平常打字的情形）键先到这里：手上是这三颗就先过直排／蒙版那几颗（捕获阶段，比 text.js 的输入框监听先） */
window.addEventListener('keydown', e => {
  const T = TT(); if (!T || !T.ed || e.target !== T.ta) return;
  if (e.isComposing || e.keyCode === 229) return;                         // 组字中的键归输入法
  const cur = Tools.current(); if (!cur || !cur._typeKit) return;
  if (cur._typeKit.key(e)){ e.preventDefault(); e.stopImmediatePropagation(); UI.draw(); }
}, true);

/* ═══════════ 选项栏（type_tool.rs:684 options_bar）═══════════
   第一颗「切换文本取向」（:700），其余借 text 工具的（字体、样式、字号、对齐、颜色），再把会切回文字工具选项栏的钮接回自己 */
function buildOptions(cfg, box, add, mk){
  const T = TT();
  const tg = document.createElement('button'); tg.type = 'button'; tg.dataset.typeOpt = 'orientation';
  tg.title = Lang.t('ui.typeToggleOrient');
  tg.innerHTML = '<svg width="16" height="14" viewBox="0 0 16 14" style="vertical-align:middle"><path d="M1 2h6M4 2v8M10 4l3-3 3 3M13 1v9M10 13h6" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>';
  tg.style.cssText = 'margin:0 6px 0 0;min-width:26px;cursor:pointer';
  tg.onclick = () => { cfg.toggle(); };
  box.appendChild(tg);
  Tools.get('text').buildOptions(box, add, mk);
  const L = T.target() ? Doc.byId(T.target()) : null;
  const vert = L ? isV(L) : cfg.orientation === 'vertical';
  box.querySelectorAll('[data-text-align]').forEach(b => {
    const a = b.dataset.textAlign;
    if (vert) b.title = Lang.t({left:'ui.vAlignTop', center:'ui.vAlignCenter', right:'ui.vAlignBottom'}[a]);
    b.onclick = () => { T.opt.align = a; T.apply({align:a}); UI.buildOptions(cfg.id); };
  });
  box.querySelectorAll('[data-text-cmd]').forEach(b => b.remove());
  [...box.children].filter(x => x.tagName === 'SPAN' && x.textContent === Lang.t('ui.textHint')).forEach(x => x.remove());
  if (T.ed){
    const btn = (txt, tip, fn, k) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.title = Lang.t(tip);
      b.dataset.typeCmd = k; b.style.cssText = 'margin:0 2px;min-width:26px;cursor:pointer';
      b.onclick = () => { fn(); UI.buildOptions(cfg.id); UI.draw(); }; box.appendChild(b);
    };
    btn('✓', 'ui.textCommit', cfg.commit, 'commit');
    btn('⊘', 'ui.textCancel', cfg.cancel, 'cancel');
  }
  const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t(cfg.hint); box.appendChild(h);
}

window.TypeVKit = {vGeom, vCaret, vHit, vLineStep, vLineEdge, flowKey, vKey, textBounds, hitLayer, hitOffset, drawVertical, drawEdit, makeTool, buildOptions, isV};

/* ═══════════ 命令 ═══════════ */
const textOf = id => { const L = id ? Doc.byId(id) : Doc.active(); return L && L.kind === 'text' ? L : null; };
CMD.reg('typev.create', {i18n:'', params:'{x,y 文件坐标＝直排点文字第一栏的顶点（栏中线在 x、从 y 往下排）| box:[x,y,w,h] 文件坐标＝直排段落文字框（第一栏贴框右缘、往左换栏）, text="", size=字号px, font="sans-serif", fontStyle="Regular|Bold|…" 或 weight, color="#rrggbb"(缺省＝前景色), align="left|center|right"(直排＝顶／中／底), name?, coalesce?:str(同一个键的连续 text.* 编辑并成一步历史), keepActive?:bool(透传 text.create)} 新增直排文字层（插在当前层上面）→ {id}'}, p => {
  const key = p.coalesce || TT().newKey();
  const q = Object.assign({}, p, {coalesce:key}); delete q.mods;
  const r = CMD.run('text.create', q);                       // text.create 自己推（或并进）那一步历史
  if (!r || !r.id) return r || {ok:false, error:'text.create failed'};
  const L = Doc.byId(r.id);
  L.data.orientation = 'vertical'; Layer.invalidate(L);      // 同 ps.type.orientation.vertical，但并在建字这一步里（不另占一步）
  return {id:L.id};
});
CMD.reg('typev.orientation', {i18n:'', params:'{layerId?(缺省＝当前文字层), orientation?:"vertical|horizontal"(缺省＝切换), coalesce?} 切换文字层取向（选项栏第一颗钮；type_tool.rs:700）；给 coalesce＝并进那段编辑的同一步历史 → {orientation}'}, p => {
  const L = textOf(p.layerId); if (!L) return {ok:false, error:'not a text layer'};
  const to = p.orientation === 'vertical' || p.orientation === 'horizontal' ? p.orientation : (isV(L) ? 'horizontal' : 'vertical');
  CMD.run('text.edit', {layerId:L.id, coalesce:p.coalesce || TT().newKey()});   // 推（或并进）一步历史
  L.data.orientation = to;                                    // 同 ps.type.orientation.<to> 写的栏位
  Layer.invalidate(L);
  return {orientation:to};
});
CMD.reg('typev.layout', {i18n:'', params:'{layerId?} 直排文字层的版面（文件坐标）：每栏 {start,end（字元索引）, cx 栏中线, u0,u1 沿栏起讫, us 每个字界的 y} 与栏宽 half×2、外框 bounds'}, p => {
  const L = textOf(p.layerId); if (!L) return {ok:false, error:'not a text layer'};
  if (!isV(L)) return {ok:false, error:'not vertical type'};
  const g = vGeom(L);
  return {ok:true, id:L.id, half:g.half, cols:g.cols.map(c => ({start:c.start, end:c.end, soft:c.soft, cx:c.cx, u0:c.u0, u1:c.u1, us:c.us.slice()})), bounds:textBounds(L)};
});

/* ═══════════ 工具 ═══════════ */
const STRINGS = {
  'zh-Hant':{'ui.typeToggleOrient':'切換文字方向', 'ui.vAlignTop':'頂端對齊文字', 'ui.vAlignCenter':'置中對齊文字', 'ui.vAlignBottom':'底部對齊文字',
    'ui.typevHint':'點一下＝直排點文字 · 拖框＝直排段落文字 · ↑↓ 沿欄移動、←→ 換欄 · 編輯中 Ctrl 拖＝移動文字 · Esc／Ctrl+Enter 確定'},
  'zh-Hans':{'ui.typeToggleOrient':'切换文本取向', 'ui.vAlignTop':'顶对齐文本', 'ui.vAlignCenter':'居中对齐文本', 'ui.vAlignBottom':'底对齐文本',
    'ui.typevHint':'点一下＝直排点文字 · 拖框＝直排段落文字 · ↑↓ 沿栏移动、←→ 换栏 · 编辑中 Ctrl 拖＝移动文字 · Esc／Ctrl+Enter 提交'},
  'en':{'ui.typeToggleOrient':'Toggle text orientation', 'ui.vAlignTop':'Top align text', 'ui.vAlignCenter':'Center text', 'ui.vAlignBottom':'Bottom align text',
    'ui.typevHint':'Click: vertical point text · drag: vertical paragraph text · ↑↓ along the column, ←→ to the next/previous column · Ctrl-drag while editing moves the text · Esc / Ctrl+Enter commits'}
};

const cfg = {
  id:'typev', orientation:'vertical', hint:'ui.typevHint', editOthers:true,
  create: p => CMD.run('typev.create', p),
  commit: () => { TT().commit(); },
  cancel: () => { TT().cancel(); },
  /* :700 有目标层＝切那层的取向（编辑中并进同一步）；没有＝换到横排文字工具（PS 2020） */
  toggle(){
    const T = TT(), id = T.target();
    if (id){ CMD.run('typev.orientation', {layerId:id, coalesce:T.ed ? T.ed.session : undefined}); T.focus(); UI.buildOptions('typev'); UI.draw(); }
    else UI.pick('text');
  }
};
const tool = makeTool(cfg);
Tools.reg(Object.assign(tool, {
  id:'typev', icon:'T', group:'misc', order:11, for:'common', needs:'text', opts:[], cursor:'vertical-text',
  strings:STRINGS,
  buildOptions(box, add, mk){ buildOptions(cfg, box, add, mk); }
}));

})();
