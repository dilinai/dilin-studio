/* 颜色替换（PS 的 B 组）：沿笔画取样一个颜色，把笔尖底下跟它相近的像素，用「色相／饱和度／颜色／明度」不可分离混合换成前景色。
   🔴 这支档是把 ArtCraft／PhotoCraft 的 Rust 原始码逐段翻译成 JS（算法照搬，不是凭 PS 印象另写）：
   - paint/src/replace.rs:13-74     ReplaceMode（hue/saturation/color=预设/luminosity）、Sampling（continuous=预设/once/backgroundSwatch）、
                                     Limits（discontiguous/contiguous=预设/findEdges）、容差 0.3、消除锯齿开
   - paint/src/replace.rs:76-191    dist（RGB 各通道差的最大值）、match_w（超过容差＝0；消除锯齿且不是「查找边缘」⇒ 容差最后 1/4 软化）、
                                     apply_color_replacement：比对一律拿「下笔前」的像素（同一笔前面换过色的仍算原色）、透明像素不换、
                                     连续／查找边缘＝只留跟笔印中心四连通的那片、换色＝c + (blend(c, fg) − c)·k，alpha 不动
   - paint/src/replace.rs:193-283   测试：四种模式守不可分离定义、连续取样跟着游标／背景色板白色不换、连续会被隔开的岛挡住（我们的自测照这几条量）
   - color/src/blend.rs:245-297     lum（0.3/0.59/0.11）、clip_color、set_lum、sat、set_sat、blend_rgb 的 Hue/Saturation/Color/Luminosity
   - engine/src/brush_cmds.rs:413-439,692-698   paint.colorReplacement：mode／sampling／limits 认不得就报错、tolerance 0..100=30、antiAlias=true、
                                     颜色＝笔刷色（color 参数，缺省前景色）、背景色板＝工具箱背景色、锁透明像素＝lock_transparency
   - engine/src/brush_cmds/tests.rs:121-136   color_replacement_modes（颜色模式保明度、明度模式＝前景明度 0.3、坏 mode 报错）
   - paint/src/retouch.rs、render.rs、lib.rs、dynamics.rs   逐笔印笔画 apply_dab_stroke、footprint、dab_coverage、间距——这几件跟混合器画笔同一份，
                                     放在 mixer.js 挂的 window.MixerKit（两颗工具共用，index.html 里 mixer.js 先载入）
   PhotoCraft 的 ui-egui 没有「颜色替换」这颗工具（enum Tool 里没有），滑鼠手感用 clone.js／eraser.js 那套（Shift 直线、Shift＋点接上一笔、
   Ctrl+Alt 拖改大小硬度、[ ]、笔尖圈＋中心十字＝取样热点、边拖边显示）；选项栏照 PS（模式、取样三颗、限制、容差、消除锯齿）。
   命令（agent 与人同一条路）：colorreplace.stroke / colorreplace.setOptions */
(function(){
'use strict';
const K = window.MixerKit;
if (!K){ console.error('colorreplace.js：要先载入 tools/mixer.js（window.MixerKit）'); return; }
const { clamp, isNum, flag, applyDabStroke, dabs, ri, inter, parsePoints, resolveBrush, parseColor, hexOf, fgHex, bgHex, targetLayer, Gesture, bar, syncBar, setSizeHardness } = K;

const MODES = ['hue', 'saturation', 'color', 'luminosity'];
const SAMPLINGS = ['continuous', 'once', 'backgroundSwatch'];
const LIMITS = ['discontiguous', 'contiguous', 'findEdges'];

/* ───────── color/src/blend.rs:245-297：不可分离混合 ───────── */
const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c){
  const l = lum(c), n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]);
  let out = c.slice();
  if (n < 0){ const d = l - n; out = out.map(v => Math.abs(d) < 1e-12 ? l : l + (v - l) * l / d); }
  if (x > 1){ const d = x - l; out = out.map(v => Math.abs(d) < 1e-12 ? l : l + (v - l) * (1 - l) / d); }
  return out;
}
const setLum = (c, l) => { const d = l - lum(c); return clipColor([c[0] + d, c[1] + d, c[2] + d]); };
const sat = c => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
function setSat(c, s){
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);                 // 稳定排序，同 sort_by
  const [imin, imid, imax] = idx, out = [0, 0, 0];
  if (c[imax] > c[imin]){ out[imid] = (c[imid] - c[imin]) * s / (c[imax] - c[imin]); out[imax] = s; }
  out[imin] = 0;
  return out;
}
function blendRGB(mode, cb, cs){
  switch (mode){
    case 'hue':        return setLum(setSat(cs, sat(cb)), lum(cb));
    case 'saturation': return setLum(setSat(cb, sat(cs)), lum(cb));
    case 'color':      return setLum(cs, lum(cb));
    case 'luminosity': return setLum(cb, lum(cs));
  }
  return cs;
}

/* ───────── replace.rs:76-191 apply_color_replacement ───────── */
const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
/* rs＝{mode, sampling, limits, tolerance 0..1, antiAlias, color:[r,g,b], background:[r,g,b]}；回伤害 [x0,y0,x1,y1) 或 null */
function applyColorReplacement(L, pts, b, rs, lock){
  const fg = [rs.color[0], rs.color[1], rs.color[2]];
  const tol = clamp(rs.tolerance, 0, 1);
  const soft = rs.antiAlias && rs.limits !== 'findEdges';
  let once = null;
  const matchW = d => d > tol ? 0 : (soft && tol > 0) ? clamp((tol - d) / (tol * 0.25), 0, 1) : 1;   // 容差最后 1/4 软化
  const c = [0, 0, 0, 0];
  return applyDabStroke(L, dabs(pts, b), b.hardness, b.opacity, lock, (work, fp, pre) => {
    const cx = Math.floor(fp.dab.x), cy = Math.floor(fp.dab.y);
    // pre＝下笔前的像素（工作副本的原件）；中心在范围外＝透明 [0,0,0]
    const preAt = (x, y, out) => {
      if (x < pre.rect[0] || y < pre.rect[1] || x >= pre.rect[2] || y >= pre.rect[3]){ out[0] = out[1] = out[2] = out[3] = 0; return out; }
      const i = ri(pre, x, y); out[0] = pre.d[i]; out[1] = pre.d[i + 1]; out[2] = pre.d[i + 2]; out[3] = pre.d[i + 3]; return out;
    };
    let sampled;
    if (rs.sampling === 'continuous'){ preAt(cx, cy, c); sampled = [c[0], c[1], c[2]]; }
    else if (rs.sampling === 'once'){ if (!once){ preAt(cx, cy, c); once = [c[0], c[1], c[2]]; } sampled = once; }
    else sampled = [rs.background[0], rs.background[1], rs.background[2]];
    const r = inter(fp.rect, work.rect);
    if (!(r[2] > r[0] && r[3] > r[1])) return;
    const w = r[2] - r[0], h = r[3] - r[1], weight = new Float32Array(w * h);
    for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++){
      if (fp.at(x, y) <= 0) continue;
      preAt(x, y, c);                                    // 比对下笔前的颜色
      if (c[3] <= 0) continue;                           // 透明像素不换
      weight[(y - r[1]) * w + (x - r[0])] = matchW(dist(c, sampled));
    }
    if (rs.limits !== 'discontiguous'){
      // 只留跟中心四连通的那片（深度优先填充）
      const keep = new Uint8Array(w * h);
      const sx = clamp(cx, r[0], r[2] - 1) - r[0], sy = clamp(cy, r[1], r[3] - 1) - r[1], si = sy * w + sx;
      if (weight[si] > 0){
        const stack = [si]; keep[si] = 1;
        while (stack.length){
          const i = stack.pop(), x = i % w, y = (i / w) | 0;
          const nb = j => { if (!keep[j] && weight[j] > 0){ keep[j] = 1; stack.push(j); } };
          if (x > 0) nb(i - 1);
          if (x + 1 < w) nb(i + 1);
          if (y > 0) nb(i - w);
          if (y + 1 < h) nb(i + w);
        }
      }
      for (let i = 0; i < weight.length; i++) if (!keep[i]) weight[i] = 0;
    }
    for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++){
      const k = fp.at(x, y) * weight[(y - r[1]) * w + (x - r[0])];
      if (k <= 0) continue;
      const i = ri(work, x, y), cc = [work.d[i], work.d[i + 1], work.d[i + 2]];
      const bl = blendRGB(rs.mode, cc, fg);
      for (let ch = 0; ch < 3; ch++) work.d[i + ch] = cc[ch] + (bl[ch] - cc[ch]) * k;   // alpha 不动
    }
  });
}

/* 选项现值（PS 选项栏；预设照 ReplaceSettings::default） */
const O = { mode:'color', sampling:'continuous', limits:'contiguous', tolerance:30, antiAlias:true };

/* brush_cmds.rs:413-439 color_replacement */
function enumParam(p, k, def, allowed, C){
  const v = p[k];
  if (v === undefined || v === null) return { v:def };
  return allowed.includes(v) ? { v } : { error:`${C}: \`${k}\`: unknown variant \`${v}\`, expected one of ${allowed.join('|')}` };
}
function colorReplace(p, opts){
  const C = 'colorreplace.stroke';
  const pr = parsePoints(p.points); if (pr.error) return { ok:false, error:`${C}: ${pr.error}` };
  const mo = enumParam(p, 'mode', 'color', MODES, C); if (mo.error) return { ok:false, error:mo.error };
  const sa = enumParam(p, 'sampling', 'continuous', SAMPLINGS, C); if (sa.error) return { ok:false, error:sa.error };
  const li = enumParam(p, 'limits', 'contiguous', LIMITS, C); if (li.error) return { ok:false, error:li.error };
  const t = targetLayer(p, C); if (t.fail) return t.fail; if (t.error) return { ok:false, error:`${C}: ${t.error}` };
  const b = resolveBrush(p);
  const rs = { mode:mo.v, sampling:sa.v, limits:li.v,
               tolerance: clamp(isNum(p.tolerance) ? p.tolerance : 30, 0, 100) / 100,
               antiAlias: flag(p, 'antiAlias', true),
               color: parseColor(p.color, parseColor(fgHex(), [0, 0, 0, 1])),
               background: parseColor(p.background, parseColor(bgHex(), [1, 1, 1, 1])) };
  const B = applyColorReplacement(t.L, pr.pts, b, rs, t.lock);
  return { ok:true, damage: B ? [B[0], B[1], B[2] - B[0], B[3] - B[1]] : [0, 0, 0, 0], rect:B };
}

CMD.reg('colorreplace.stroke', {i18n:'', undoable:true,
  params:'{points:[[x,y,pressure?],…] 文件坐标（必填）, size?:px=工具大小, hardness?:0..1=工具硬度, spacing?:0.01..10（直径倍数）=0.1, '
       + 'brush?:{size,hardness,spacing,flow,opacity,pressureSize}, mode:"hue|saturation|color|luminosity"="color", '
       + 'sampling:"continuous|once|backgroundSwatch"="continuous", limits:"contiguous|discontiguous|findEdges"="contiguous", '
       + 'tolerance:0..100=30, antiAlias:bool=true, color?:"#rrggbb"=前景色（替换成的颜色）, background?:"#rrggbb"=背景色（backgroundSwatch 用）, layerId?} '
       + '颜色替换一笔（一步历史；透明像素与 alpha 都不动）→ {damage:[x,y,w,h]}'},
  p => colorReplace(p));
CMD.reg('colorreplace.setOptions', {i18n:'',
  params:'{mode?, sampling?, limits?, tolerance?:0..100, antiAlias?:bool, size?:px（与笔刷共用）, hardness?:0..1} 改颜色替换选项（不进历史）；传 {} 只读现值'},
  p => {
    const oldSampling = O.sampling;
    if (MODES.includes(p.mode)) O.mode = p.mode;
    if (SAMPLINGS.includes(p.sampling)) O.sampling = p.sampling;
    if (LIMITS.includes(p.limits)) O.limits = p.limits;
    if (isNum(p.tolerance)) O.tolerance = clamp(Math.round(p.tolerance), 0, 100);
    if (typeof p.antiAlias === 'boolean') O.antiAlias = p.antiAlias;
    setSizeHardness(p);
    if (O.sampling !== oldSampling && ToolState.cur === 'colorreplace' && window.UI) UI.buildOptions('colorreplace');   // 取样按钮的亮灯跟着换
    else T._sync();
    return { ok:true, mode:O.mode, sampling:O.sampling, limits:O.limits, tolerance:O.tolerance, antiAlias:O.antiAlias, size:ToolState.size, hardness:ToolState.hardness };
  });

function strokeParams(L, points){
  return { points, layerId:L.id, size:ToolState.size, hardness:ToolState.hardness, mode:O.mode, sampling:O.sampling, limits:O.limits,
           tolerance:O.tolerance, antiAlias:O.antiAlias, color:fgHex(), background:bgHex() };
}
const gesture = Gesture({
  id:'colorreplace', key:'colorreplace', cross:true,              // 中心十字＝取样热点（PS 颜色替换的游标）
  setOpts: o => CMD.run('colorreplace.setOptions', o),
  live(L, points){ const r = colorReplace(strokeParams(L, points)); return r.ok ? r.rect : null; },
  commit(L, points){ const p = strokeParams(L, points); T.lastParams = p; CMD.run('colorreplace.stroke', p); }
});

const STR = {
  'zh-Hant':{ 'tool.colorreplace':'顏色取代工具', 'opt.cr.mode':'模式', 'opt.cr.sampling':'取樣', 'opt.cr.limits':'限制', 'opt.cr.tolerance':'容許度 %', 'opt.cr.antiAlias':'消除鋸齒',
              'ui.cr.mode.hue':'色相', 'ui.cr.mode.saturation':'飽和度', 'ui.cr.mode.color':'顏色', 'ui.cr.mode.luminosity':'明度',
              'ui.cr.sampling.continuous':'連續', 'ui.cr.sampling.once':'一次', 'ui.cr.sampling.backgroundSwatch':'背景色票',
              'ui.cr.limits.discontiguous':'不連續', 'ui.cr.limits.contiguous':'連續', 'ui.cr.limits.findEdges':'尋找邊緣',
              'ui.colorreplace.diameter':'直徑：', 'ui.colorreplace.hardness':'硬度：',
              'ui.cr.hint':'拖曳＝把筆尖中心相近的顏色換成前景色；Shift 拖曳＝直線；Shift＋點＝接上一筆；Ctrl+Alt 拖曳＝改大小／硬度；[ ]＝縮放筆尖' },
  'zh-Hans':{ 'tool.colorreplace':'颜色替换工具', 'opt.cr.mode':'模式', 'opt.cr.sampling':'取样', 'opt.cr.limits':'限制', 'opt.cr.tolerance':'容差 %', 'opt.cr.antiAlias':'消除锯齿',
              'ui.cr.mode.hue':'色相', 'ui.cr.mode.saturation':'饱和度', 'ui.cr.mode.color':'颜色', 'ui.cr.mode.luminosity':'明度',
              'ui.cr.sampling.continuous':'连续', 'ui.cr.sampling.once':'一次', 'ui.cr.sampling.backgroundSwatch':'背景色板',
              'ui.cr.limits.discontiguous':'不连续', 'ui.cr.limits.contiguous':'连续', 'ui.cr.limits.findEdges':'查找边缘',
              'ui.colorreplace.diameter':'直径：', 'ui.colorreplace.hardness':'硬度：',
              'ui.cr.hint':'拖动＝把笔尖中心相近的颜色换成前景色；Shift 拖动＝直线；Shift＋点＝接上一笔；Ctrl+Alt 拖动＝改大小／硬度；[ ]＝缩放笔尖' },
  'en':     { 'tool.colorreplace':'Color Replacement Tool', 'opt.cr.mode':'Mode', 'opt.cr.sampling':'Sampling', 'opt.cr.limits':'Limits', 'opt.cr.tolerance':'Tolerance %', 'opt.cr.antiAlias':'Anti-alias',
              'ui.cr.mode.hue':'Hue', 'ui.cr.mode.saturation':'Saturation', 'ui.cr.mode.color':'Color', 'ui.cr.mode.luminosity':'Luminosity',
              'ui.cr.sampling.continuous':'Continuous', 'ui.cr.sampling.once':'Once', 'ui.cr.sampling.backgroundSwatch':'Background Swatch',
              'ui.cr.limits.discontiguous':'Discontiguous', 'ui.cr.limits.contiguous':'Contiguous', 'ui.cr.limits.findEdges':'Find Edges',
              'ui.colorreplace.diameter':'Diameter:', 'ui.colorreplace.hardness':'Hardness:',
              'ui.cr.hint':'Drag to replace colours like the one under the brush centre with the foreground colour · Shift-drag: straight line · Shift-click: line from last stroke · Ctrl+Alt-drag: size/hardness · [ ]: brush size' }
};

const T = Tools.reg({
  id:'colorreplace', icon:'⇄', group:'raster', order:46, for:'raster', needs:'raster', opts:['size', 'hardness'],
  cursor:'none', hint:'ui.cr.hint', strings:STR,
  opt:O, blendRGB, lum, applyColorReplacement, lastParams:null, _gesture:gesture,
  onDown:gesture.onDown, onMove:gesture.onMove, onUp:gesture.onUp, onKey:gesture.onKey,
  onDeactivate:gesture.onDeactivate, drawOverlay:gesture.drawOverlay,
  _sync(){ syncBar('colorreplace', 'cr', { mode:O.mode, limits:O.limits, tolerance:O.tolerance, antiAlias:O.antiAlias }); },
  /* 选项栏（PS 颜色替换：模式、取样 连续／一次／背景色板、限制、容差、消除锯齿） */
  buildOptions(box, add, mk){
    const B = bar(box, add, mk, 'colorreplace.setOptions', 'cr');
    add('cr.mode', B.sel('mode', MODES.map(m => [m, 'ui.cr.mode.' + m]), O.mode, v => ({ mode:v })));
    const wrap = document.createElement('span');
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:2px;margin-right:8px';
    const lab = document.createElement('span'); lab.textContent = Lang.t('opt.cr.sampling'); lab.style.marginRight = '4px'; wrap.appendChild(lab);
    for (const s of SAMPLINGS){
      const bt = document.createElement('button'); bt.type = 'button'; bt.dataset.crSampling = s; bt.textContent = Lang.t('ui.cr.sampling.' + s);
      const on = s === O.sampling;
      bt.style.cssText = 'padding:1px 6px;border-radius:3px;cursor:pointer;border:1px solid ' + (on ? '#5b8def' : '#555') + ';background:' + (on ? '#2f4f8a' : 'transparent') + ';color:inherit;font:inherit';
      bt.onclick = () => CMD.run('colorreplace.setOptions', { sampling:s });
      wrap.appendChild(bt);
    }
    box.appendChild(wrap);
    add('cr.limits', B.sel('limits', LIMITS.map(l => [l, 'ui.cr.limits.' + l]), O.limits, v => ({ limits:v })));
    add('cr.tolerance', B.num('tolerance', O.tolerance, 0, 100, v => ({ tolerance:v })));
    add('cr.antiAlias', B.chk('antiAlias', O.antiAlias, v => ({ antiAlias:v })));
  }
});

window.ColorReplace = T;
/* 描边路径（PS 路径面板 ▸ 描边路径 ▸ 颜色替换）：同滑鼠收笔那包参数 */
T.pathParams = (L, points) => strokeParams(L, points.map(q => [q[0], q[1], q.length > 2 ? q[2] : 1]));
})();
