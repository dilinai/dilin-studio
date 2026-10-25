/* 光晕工具（AI 版面 ai.flare）——逐段照 VectorCraft 原码翻：
     vectorcraft/crates/tools/src/extra.rs 23-145          FlareTool：按下＝中心、拖（超过 3 屏幕像素才算）＝中心大小（直径＝2×拖的距离）；
                                                           放开后不结束：游标移动＝预览光环终点、再点一下（或按着拖）＝定终点并落地；
                                                           拖时与等终点时 ↑／↓＝射线数 ±1（0..50，留在工具上、Esc 才清）；Esc＝整个取消；换工具时已拖过中心＝照目前预览落地；
                                                           点一下不拖＝「光晕工具选项」对话框；叠画：拖中心时蓝圈、等终点时中心到游标的蓝虚线
     vectorcraft/crates/engine/src/cmd/create.rs 16-24, 198-295   shape.flare：参数／预设／夹限、xorshift 伪乱数（同参数＝同光晕）、
                                                           光圈 Halo、射线 Rays（一个复合路径）、中心 Center（不透明度＝opacity）、光环 Ring×rings；
                                                           每块＝白色径向渐变填色、无描边、混合模式「滤色」；整组叫 Flare、选中它
     vectorcraft/crates/ui-egui/src/dialogs/tools.rs 29-34  对话框栏位与预设（diameter 100、opacity 50、brightness 30、growth 20、fuzziness 50、rays 15、
                                                           longest 300、rayFuzziness 100、pathLength 300、rings 10、largest 50、direction 45）
     vectorcraft/crates/ui-egui/src/dialogs/command.rs     通用参数对话框：diameter／pathLength 是长度栏，按确定＝跑 shape.flare
     vectorcraft/crates/geom/src/shapes.rs 41-57           圆＝ellipse（4 平滑点）
   资料结构：编组 {type:'group', name:'Flare', children:[…]}（menus/impl/ai-object.js 那份）；每块的「滤色／不透明度」＝shape.blend／shape.opacity
             （menus/impl/ai-window.js 透明度面板那份，drawShape 已包好）；径向渐变＝tools/gradient.js 的 GradientFill 格式（stops 带 opacity）。
   改文件只走 CMD：flare.create（＝shape.flare，滑鼠与对话框与 agent 同一条）。 */
(function(){
'use strict';
const AF = window.AiFamily;
const fin = v => typeof v === 'number' && isFinite(v);
const num = (p, k, d) => fin(p[k]) ? p[k] : d;                 // f64_or
const asU64 = v => (typeof v === 'number' && Number.isInteger(v) && v >= 0) ? v : null;
const BLUE = '#4f9dff';                                         // distort.rs BLUE（叠画）

/* create.rs:221-228 xorshift64：seed 缺省 0x2545_f491_4f6c_dd1d，|1；回 [0,1) */
function rng(seed){
  const M = (1n << 64n) - 1n;
  let s = ((typeof seed === 'number' && Number.isInteger(seed) && seed >= 0) ? BigInt(seed) : 0x2545f4914f6cdd1dn) | 1n;
  return () => {
    s = (s ^ (s << 13n)) & M;
    s = s ^ (s >> 7n);
    s = (s ^ (s << 17n)) & M;
    return Number(s >> 11n) / 9007199254740992;               // (1<<53)
  };
}
const circle = (c, r) => AF.Geom.ellipse({x0:c[0] - r, y0:c[1] - r, x1:c[0] + r, y1:c[1] + r});
const stop = (offset, opacity) => ({offset, color:'#ffffff', opacity});
/* radial(centre, radius, stops)：GradientGeom start＝圆心、end＝圆心＋(radius, 0)、aspect 1 */
const radial = (c, r, stops) => ({type:'radial', stops, x1:c[0], y1:c[1], x2:c[0] + r, y2:c[1], r, aspect:1});

/* create.rs:200-295 flare：参数 → 编组（文件坐标） */
function build(p){
  if (!fin(p.cx) || !fin(p.cy)) return {ok:false, error:'flare.create: cx, cy are required numbers'};
  const c = [p.cx, p.cy];
  const pct = (k, d) => Math.min(10, Math.max(0, num(p, k, d) / 100));
  const r = Math.max(num(p, 'diameter', 100) / 2, 0.5);
  const opacity = Math.min(pct('opacity', 50), 1);
  const brightness = Math.min(pct('brightness', 30), 1);
  const growth = pct('growth', 20);
  const fuzz = Math.min(pct('fuzziness', 50), 1);
  const rays = Math.min(asU64(p.rays) === null ? 15 : p.rays, 50);
  const longest = pct('longest', 300);
  const rayFuzz = Math.min(pct('rayFuzziness', 100), 1);
  const rings = Math.min(asU64(p.rings) === null ? 10 : p.rings, 50);
  const largest = pct('largest', 50);
  let end;
  if (fin(p.x2) && fin(p.y2)) end = [p.x2, p.y2];
  else { const a = num(p, 'direction', 45) * Math.PI / 180, L = num(p, 'pathLength', 300); end = [c[0] + Math.cos(a) * L, c[1] - Math.sin(a) * L]; }
  const rnd = rng(p.seed);
  const parts = [];
  // 光圈：中心外一圈柔光
  const haloR = r * (1 + growth) * 1.6;
  const inner = Math.min(0.95, Math.max(0.05, 1 - fuzz * 0.6));
  parts.push(['Halo', circle(c, haloR), radial(c, haloR, [stop(0, 0), stop(inner * 0.75, 0), stop(inner, 0.5), stop(1, 0)]), 1]);
  // 射线：细长尖刺、长度随机（最长＝中心半径的 longest 倍），一个复合路径
  if (rays > 0){
    const kids = [];
    let reach = 0;
    for (let i = 0; i < rays; i++){
      const a = 2 * Math.PI * (i + rnd() * 0.6) / rays;
      const len = r * longest * Math.max(1 - rayFuzz * 0.75 * rnd(), 0.1);
      reach = Math.max(reach, len);
      const w = r * 0.035, d = [Math.cos(a), Math.sin(a)], n = [-d[1] * w, d[0] * w];
      const pts = [[c[0] + n[0], c[1] + n[1]], [c[0] + d[0] * len, c[1] + d[1] * len], [c[0] - n[0], c[1] - n[1]], [c[0] - d[0] * w * 4, c[1] - d[1] * w * 4]];
      kids.push({type:'bezier', anchors:pts.map(q => ({x:q[0], y:q[1], in:null, out:null, kind:'corner'})), closed:true, fill:'none', stroke:'none', strokeWidth:0});
    }
    parts.push(['Rays', {type:'compound', rule:'nonzero', children:kids}, radial(c, reach, [stop(0, 0.9), stop(0.25, 0.35), stop(1, 0)]), 1]);
  }
  // 中心：亮核往外淡掉（不透明度＝opacity）
  parts.push(['Center', circle(c, r), radial(c, r, [stop(0, 1), stop(0.25 + brightness * 0.5, 0.6), stop(1, 0)]), opacity]);
  // 光环：沿中心→终点散布（大小＝中心半径 × largest × 0.25..1）
  for (let i = 0; i < rings; i++){
    const t = rnd();
    const at = [c[0] + (end[0] - c[0]) * t, c[1] + (end[1] - c[1]) * t];
    const rr = Math.max(r * largest * (0.25 + rnd() * 0.75), 0.5);
    const solid = rnd() < 0.5;
    const stops = solid ? [stop(0, 0.25), stop(0.8, 0.2), stop(1, 0)] : [stop(0, 0), stop(0.7, 0.05), stop(0.92, 0.35), stop(1, 0)];
    parts.push(['Ring', circle(at, rr), radial(at, rr, stops), 1]);
  }
  const children = parts.map(([name, sh, paint, op]) => {
    const n = Object.assign(sh, {name, fill:paint, stroke:'none', strokeWidth:0, blend:'screen'});
    if (op < 1) n.opacity = op;
    if (n.type === 'compound') n.children.forEach(k => { k.id = uid('S'); });
    return n;
  });
  const g = AF.group(children, 'Flare');
  g.flare = {cx:c[0], cy:c[1], diameter:r * 2, rays, rings, end};   // 给 agent／测试看的摘要（不影响渲染）
  return g;
}

/* ── 工具状态（extra.rs:24-34） ── */
const Flare = {
  drag: null,          // [中心, 目前拖点]
  placed: null,        // [中心, 直径]：等终点那一下
  hover: [0, 0],
  began: false,
  rays: null,          // 拖时 ↑↓ 改过的射线数（null＝命令预设 15）
  preview: null,       // 最后一次 Action::Preview 的参数

  /* extra.rs:37-47 params */
  params(c, diameter, end){
    const v = {cx:c[0], cy:c[1], diameter:Math.max(diameter, 1)};
    if (this.rays !== null) v.rays = this.rays;
    if (end){ v.x2 = end[0]; v.y2 = end[1]; }
    return v;
  },
  busy(){ return !!(this.drag || this.placed); },
  dist(a, b){ return Math.hypot(a[0] - b[0], a[1] - b[1]); },
  commit(p){ this.preview = null; if (p) CMD.run('flare.create', p); },

  /* extra.rs:57-106 pointer */
  down(e, pt){
    this.hover = [pt[0], pt[1]];
    if (!this.placed) this.drag = [[pt[0], pt[1]], [pt[0], pt[1]]];
  },
  move(e, pt, pressed){
    this.hover = [pt[0], pt[1]];
    if (pressed && this.drag){
      const c = this.drag[0];
      this.drag = [c, [pt[0], pt[1]]];
      if (!this.began && this.dist(pt, c) >= AF.tol(3)){ this.began = true; }   // Action::Begin("Flare")
      if (this.began){ this.preview = this.params(c, 2 * this.dist(pt, c), null); return true; }
      return false;
    }
    if (this.placed){                                            // Drag 或 Move：预览终点
      const [c, d] = this.placed;
      this.preview = this.params(c, d, this.hover);
      return true;
    }
    return false;
  },
  up(e, pt){
    this.hover = [pt[0], pt[1]];
    if (this.placed){
      const [c, d] = this.placed; this.placed = null;
      this.began = false;
      const p = this.params(c, d, this.hover);
      // rays 照原码留在工具上（下一个光晕沿用 ↑↓ 改过的射线数；Esc／换工具才清）
      this.commit(p);                                           // Preview(终点)＋Commit
      return;
    }
    const dr = this.drag; this.drag = null;
    if (!dr) return;
    const [c, p] = dr;
    if (this.began){ this.placed = [c, 2 * this.dist(p, c)]; this.preview = this.params(c, this.placed[1], null); }   // 留着等终点
    else this.openDialog(c[0], c[1]);                            // Action::Dialog("flare", {x, y})
  },
  /* extra.rs:107-127 key */
  key(e){
    const k = e.key;
    if ((k === 'ArrowUp' || k === 'ArrowDown') && this.began){
      e.preventDefault();
      const r = this.rays === null ? 15 : this.rays;
      this.rays = k === 'ArrowUp' ? Math.min(r + 1, 50) : Math.max(r - 1, 0);
      if (this.drag){ const [c, p] = this.drag; this.preview = this.params(c, 2 * this.dist(p, c), null); }
      else if (this.placed){ const [c, d] = this.placed; this.preview = this.params(c, d, this.hover); }
      return true;
    }
    if (k === 'Escape' && this.busy()){ this.cancel(); return true; }
    return false;
  },
  cancel(){ this.rays = null; this.drag = null; this.placed = null; this.began = false; this.preview = null; },
  /* extra.rs:128-132 deactivate：中心已拖好、还在等终点 ⇒ 照目前预览落地 */
  deactivate(){
    this.drag = null;
    const was = this.placed && this.began, p = this.preview;
    this.placed = null; this.began = false;
    if (was) this.commit(p); else this.preview = null;
    AF.Dialog.close();
  },

  /* dialogs/tools.rs:29-34「光晕工具选项」→ shape.flare（command.rs 通用对话框：栏位照原样排、diameter／pathLength 是长度） */
  openDialog(x, y){
    const F = (key, value) => ({key, label:'ui.fl_' + key, value});
    AF.Dialog.open(Lang.t('ui.flTitle'), [
      F('diameter', 100), F('opacity', 50), F('brightness', 30), F('growth', 20), F('fuzziness', 50),
      F('rays', 15), F('longest', 300), F('rayFuzziness', 100), F('pathLength', 300), F('rings', 10), F('largest', 50), F('direction', 45)
    ], v => {
      const p = Object.assign({cx:x, cy:y}, v);
      ['rays', 'rings'].forEach(k => { p[k] = AF.toU(p[k]); });
      CMD.run('flare.create', p);
    });
  },
  overlay(ctx, s){
    const dpr = s / Math.max(UI.zoom, 1e-9);
    if (this.preview && this.began){ const g = build(Object.assign({}, this.preview)); if (g && g.ok !== false){ try { drawShape(ctx, g, s); } catch(e){} } }
    ctx.save(); ctx.strokeStyle = BLUE; ctx.lineWidth = dpr;
    if (this.drag){                                             // extra.rs:136 拖中心：蓝圈（半径＝拖的距离）
      const [c, p] = this.drag, r = this.dist(p, c);
      ctx.beginPath(); ctx.arc(c[0] * s, c[1] * s, r * s, 0, Math.PI * 2); ctx.stroke();
    } else if (this.placed){                                    // :138 等终点：中心到游标的蓝虚线
      const c = this.placed[0];
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath(); ctx.moveTo(c[0] * s, c[1] * s); ctx.lineTo(this.hover[0] * s, this.hover[1] * s); ctx.stroke();
    }
    ctx.restore();
  }
};
window.Flare = Flare;
Flare.build = build;

CMD.reg('flare.create', {i18n:'', undoable:true,
  params:'{cx, cy 中心（文件坐标）, diameter=100 中心直径, opacity=50 (%) 中心不透明度, brightness=30 (%), growth=20 (%) 光圈增大, fuzziness=50 (%) 光圈模糊, rays=15 射线数 (0..50), ' +
         'longest=300 (%) 最长射线＝中心半径的倍数, rayFuzziness=100 (%), x2?, y2? 光环终点（没给＝从中心朝 direction 度走 pathLength）, pathLength=300, rings=10 光环数 (0..50), ' +
         'largest=50 (%) 最大光环, direction=45 (度，逆时针、0＝向右), seed? 伪乱数种子（同参数＝同光晕）, layerId?} ' +
         '＝VectorCraft shape.flare：编组「Flare」＝光圈＋射线＋中心＋光环，每块白色径向渐变、滤色混合；落进当前矢量层并选中 → {ok, id, layerId}'},
  p => {
    p = p || {};
    const g = build(p);
    if (!g || g.ok === false) return g;
    return AF.place(g, p);
  });

const STRINGS = {
  'zh-Hant':{
    'tool.flare':'反光工具', 'ui.flTitle':'反光工具選項',
    'ui.flHint':'拖＝中心與大小 · 放開後移動游標再點一下＝光環終點 · ↑↓ 增減光線 · Esc 取消 · 點一下＝輸入數值',
    'ui.fl_diameter':'直徑', 'ui.fl_opacity':'不透明度 %', 'ui.fl_brightness':'亮度 %', 'ui.fl_growth':'光暈 增大 %', 'ui.fl_fuzziness':'光暈 模糊度 %',
    'ui.fl_rays':'光線 數量', 'ui.fl_longest':'最長 %', 'ui.fl_rayFuzziness':'光線 模糊度 %', 'ui.fl_pathLength':'環形 路徑', 'ui.fl_rings':'環形 數量',
    'ui.fl_largest':'最大 %', 'ui.fl_direction':'方向 °'
  },
  'zh-Hans':{
    'tool.flare':'光晕工具', 'ui.flTitle':'光晕工具选项',
    'ui.flHint':'拖＝中心与大小 · 放开后移动光标再点一下＝光环终点 · ↑↓ 增减射线 · Esc 取消 · 点一下＝输入数值',
    'ui.fl_diameter':'直径', 'ui.fl_opacity':'不透明度 %', 'ui.fl_brightness':'亮度 %', 'ui.fl_growth':'光晕 增大 %', 'ui.fl_fuzziness':'光晕 模糊度 %',
    'ui.fl_rays':'射线 数量', 'ui.fl_longest':'最长 %', 'ui.fl_rayFuzziness':'射线 模糊度 %', 'ui.fl_pathLength':'环形 路径', 'ui.fl_rings':'环形 数量',
    'ui.fl_largest':'最大 %', 'ui.fl_direction':'方向 °'
  },
  'en':{
    'tool.flare':'Flare Tool', 'ui.flTitle':'Flare Tool Options',
    'ui.flHint':'Drag: centre and size · then move and click: end of the rings · ↑↓ change rays · Esc cancels · Click for exact values',
    'ui.fl_diameter':'Diameter', 'ui.fl_opacity':'Opacity %', 'ui.fl_brightness':'Brightness %', 'ui.fl_growth':'Halo Growth %', 'ui.fl_fuzziness':'Halo Fuzziness %',
    'ui.fl_rays':'Rays Number', 'ui.fl_longest':'Longest %', 'ui.fl_rayFuzziness':'Rays Fuzziness %', 'ui.fl_pathLength':'Rings Path', 'ui.fl_rings':'Rings Number',
    'ui.fl_largest':'Largest %', 'ui.fl_direction':'Direction °'
  }
};
if (typeof Lang !== 'undefined') Lang.add(STRINGS);

Tools.reg({
  id:'flare', icon:'✺', group:'vector', order:58, for:'vector', needs:'vector', opts:[], cursor:'crosshair',
  hint:'ui.flHint', strings:STRINGS,
  onDown(e, pt){ if (e.button !== undefined && e.button !== 0) return; Flare.down(e, pt); UI.draw(); },
  onMove(e, pt, P){ if (Flare.move(e, pt, P.down)) UI.draw(); },
  onUp(e, pt){ Flare.up(e, pt); UI.draw(); },
  onKey(e){ const r = Flare.key(e); if (r) UI.draw(); return r; },
  onDeactivate(){ Flare.deactivate(); },
  drawOverlay(ctx, s){ Flare.overlay(ctx, s); }
});
})();
