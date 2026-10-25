/* 吸管（I）—— 逐段翻译自 ArtCraft 原始码（不是照 PS 印象写）：
   ① photocraft/crates/ui-egui/src/canvas.rs
        :2002-2010  tool_event 吸管段：Down 与 Move（拖曳）都取样；Up 什么也不做
        :1929-1937  sample_eyedropper：document.pixel(floor(x), floor(y)) 读合成像素；alpha>0 才写；
                    Alt ⇒ background，否则 foreground；写进去的 alpha 一律是 1（tools.setColors）
      photocraft/crates/engine/src/commands.rs:819-834 document.pixel（合成后、直通 alpha）、:746-750 tools.setColors
      photocraft/crates/ui-egui/src/panels.rs:763-769 选项栏提示字
   ② vectorcraft/crates/tools/src/xform/eyedropper.rs:69-93 pointer：只在按下时作用
        点到物件 ⇒ appearance.copyFrom（吸外观：填色、描边、描边宽 → 绘图预设）
        Alt ⇒ reverse（把「来源外观」套到被点的物件上）；Shift+Alt ⇒ append；Shift ⇒ 只吸颜色（paint.sampleColor）
        没点到 ⇒ 什么也不做
      vectorcraft/crates/doc/src/hit.rs:60-180 hit_test（由上往下、先描边后填色、容差 3 屏幕像素）
      vectorcraft/crates/engine/src/cmd/appearance.rs:689-770 copy_from / Picked.to_defaults
      vectorcraft/crates/doc/src/pixels.rs:79-101 sample_pixels（取样大小：alpha 加权平均、夹在图内）
   合并规则（我们一颗吸管三种层共用）：当前层是矢量层、且按下点打中某个矢量形状 ⇒ 走②；其余一律走①。
   色槽对照：我们没有「前景／背景色」，前景 ＝ 右栏「填色」（笔刷、形状都读它），背景 ＝ 右栏「描边色」。 */
const Eyedropper = {
  sampleSize: 1,        // eyedropper.setOptions sampleSize：1 ＝ 点（photocraft 的行为），3 ＝ 3×3，5 ＝ 5×5
  _comp: null,          // 一次拖曳内重用的合成画面（拖曳中文件不会变，免得每动一下重合成）
  _mode: null,          // 这一下按下走的是 'pixel'（①）还是 'vector'（②）

  /* 任何 CSS 颜色 → '#rrggbb'；认不得回 null */
  _nc: null,
  cssToHex(c){
    if (Array.isArray(c)){                                    // photocraft 的 [r,g,b,a]（0..1 浮点）
      const v = c.slice(0, 3).map(x => Math.max(0, Math.min(255, Math.round(+x * 255))));
      return '#' + v.map(x => x.toString(16).padStart(2, '0')).join('');
    }
    if (typeof c !== 'string' || !c || c === 'none') return null;
    const x = this._nc || (this._nc = document.createElement('canvas').getContext('2d'));
    x.fillStyle = '#000000'; x.fillStyle = c; const a = x.fillStyle;
    x.fillStyle = '#ffffff'; x.fillStyle = c; const b = x.fillStyle;
    if (a !== b) return null;                                 // 两次不一样 ⇒ 字串不是颜色，没被吃进去
    if (a[0] === '#') return a.toLowerCase();
    const m = a.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    return '#' + m[1].split(',').slice(0, 3).map(s => Math.round(parseFloat(s)).toString(16).padStart(2, '0')).join('');
  },

  /* pixels.rs:79-101 sample_pixels：以 floor(x),floor(y) 为中心的 size×size 格、夹在图内，
     alpha 加权平均成直通 RGBA；中心在图外或整格全透明 ⇒ null */
  samplePixels(img, x, y, size){
    const w = img.width, h = img.height;
    const cx = Math.floor(x), cy = Math.floor(y);
    if (!(cx >= 0 && cx < w) || !(cy >= 0 && cy < h)) return null;
    const r = Math.floor(Math.max(1, size | 0) / 2);
    const x0 = Math.max(cx - r, 0), x1 = Math.min(cx + r, w - 1);
    const y0 = Math.max(cy - r, 0), y1 = Math.min(cy + r, h - 1);
    const d = img.getContext('2d').getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;   // 2D canvas 读出来就是直通 alpha
    let s0 = 0, s1 = 0, s2 = 0, alpha = 0, n = 0;
    for (let i = 0; i < d.length; i += 4){
      const a = d[i+3];
      s0 += d[i] * a; s1 += d[i+1] * a; s2 += d[i+2] * a;
      alpha += a; n++;
    }
    if (alpha === 0) return null;
    const c = v => Math.floor((v + Math.floor(alpha / 2)) / alpha);
    return [c(s0), c(s1), c(s2), Math.floor((alpha + Math.floor(n / 2)) / n)];
  },

  /* document.pixel：合成后（含不透明度、混合模式、遮罩、图层位移）那一点的颜色 */
  pixel(x, y, size){
    const comp = this._comp || composite(1);
    return this.samplePixels(comp, x, y, size || this.sampleSize);
  },

  /* 形状的路径：直接借 engine 的 drawShape（渲染与点选同一支几何，免得点到的和画出来的不一样） */
  shapePath(s){
    const P = new Path2D();
    const shim = {
      save(){}, restore(){}, beginPath(){}, fill(){}, stroke(){},
      moveTo:(...a) => P.moveTo(...a), lineTo:(...a) => P.lineTo(...a), closePath:() => P.closePath(),
      rect:(...a) => P.rect(...a), roundRect:(...a) => P.roundRect(...a), ellipse:(...a) => P.ellipse(...a),
      bezierCurveTo:(...a) => P.bezierCurveTo(...a)
    };
    drawShape(shim, Object.assign({}, s, {fill:'none', stroke:'none'}), 1);
    return P;
  },
  _hx: null,
  /* hit.rs:60-180 hit_test：由最上层往下、每层由最上面的形状往下；
     先看「画出来的描边」（Stroke），再看路径轮廓容差内（Outline），最后有填色才看填色内（Fill） */
  hitTest(pt, tol){
    const hx = this._hx || (this._hx = document.createElement('canvas').getContext('2d'));
    hx.setTransform(1, 0, 0, 1, 0, 0); hx.lineJoin = 'round'; hx.lineCap = 'round';
    for (let i = Doc.layers.length - 1; i >= 0; i--){
      const L = Doc.layers[i];
      if (!L.visible || L.kind !== 'vector') continue;
      const x = pt[0] - L.x, y = pt[1] - L.y;                 // 铁律④：矢量层被移动过，形状坐标是图层坐标
      const S = L.data.shapes;
      for (let j = S.length - 1; j >= 0; j--){
        const s = S[j], P = this.shapePath(s);
        const stroked = s.stroke && s.stroke !== 'none' && (s.strokeWidth || 0) > 0;
        let kind = null;
        if (stroked){ hx.lineWidth = s.strokeWidth + 2 * tol; if (hx.isPointInStroke(P, x, y)) kind = 'stroke'; }
        if (!kind){ hx.lineWidth = 2 * tol; if (hx.isPointInStroke(P, x, y)) kind = 'outline'; }
        if (!kind && s.fill && s.fill !== 'none' && hx.isPointInPath(P, x, y, 'nonzero')) kind = 'fill';
        if (kind) return {layerId:L.id, shapeId:s.id, kind};
      }
    }
    return null;
  },
  findShape(layerId, shapeId){
    const L = Doc.byId(layerId);
    if (!L || L.kind !== 'vector') return {};
    return {L, s:L.data.shapes.find(x => x.id === shapeId)};
  },

  /* tools.setColors：foreground → 填色；background → 描边色 */
  setColor(id, hex){
    const el = document.getElementById(id);
    if (!el || !hex) return;
    el.value = hex;
    el.dispatchEvent(new Event('input', {bubbles:true}));
  }
};
window.Eyedropper = Eyedropper;

/* ───────── 命令（agent 与滑鼠同一条路）───────── */
CMD.reg('eyedropper.setOptions', {i18n:'', params:'{sampleSize?: 1|3|5} 取样大小（1 点、3 ＝ 3×3、5 ＝ 5×5 的 alpha 加权平均）；{} 读回目前选项'}, p => {
  if (p.sampleSize !== undefined){
    const n = +p.sampleSize;
    if (![1, 3, 5].includes(n)) return {ok:false, error:'sampleSize must be 1, 3 or 5'};
    Eyedropper.sampleSize = n;
  }
  return {sampleSize:Eyedropper.sampleSize};
});

CMD.reg('eyedropper.pixel', {i18n:'', params:'{x, y, sampleSize?} 文件坐标；读合成后那一点的颜色 → {rgba:[r,g,b,a] 0..255 直通 alpha | null（画布外／全透明）}'}, p => {
  return {rgba:Eyedropper.pixel(+p.x, +p.y, p.sampleSize)};
});

CMD.reg('eyedropper.setColors', {i18n:'', params:'{foreground?:"#rrggbb"|[r,g,b,a]0..1, background?:同} 前景＝填色、背景＝描边色（不进历史，跟 PS／photocraft 一样换色不算一步）'}, p => {
  const out = {};
  if (p.foreground !== undefined){ const h = Eyedropper.cssToHex(p.foreground); if (h){ Eyedropper.setColor('fillColor', h); out.foreground = h; } }
  if (p.background !== undefined){ const h = Eyedropper.cssToHex(p.background); if (h){ Eyedropper.setColor('strokeColor', h); out.background = h; } }
  return out;
});

/* canvas.rs:1929-1937 sample_eyedropper */
CMD.reg('eyedropper.sample', {i18n:'', params:'{x, y, background=false, sampleSize?} 文件坐标；取合成后那一点的颜色写进填色（background=true 写进描边色）；透明或画布外不改 → {ok, color?, target?}'}, p => {
  const c = Eyedropper.pixel(+p.x, +p.y, p.sampleSize);
  if (!c || !(c[3] > 0)) return {ok:false, reason:'transparent'};
  const hex = Eyedropper.cssToHex([c[0]/255, c[1]/255, c[2]/255, 1]);     // alpha 一律写成 1
  const key = p.background ? 'background' : 'foreground';
  CMD.map['eyedropper.setColors'].run({[key]:hex});
  return {ok:true, color:hex, target:key};
});

CMD.reg('eyedropper.hitTest', {i18n:'', params:'{x, y, tol=3/缩放} 文件坐标；最上面被点到的矢量形状 → {hit:{layerId, shapeId, kind:"stroke"|"outline"|"fill"} | null}'}, p => {
  const tol = p.tol !== undefined ? +p.tol : 3 / (window.UI ? UI.zoom : 1);
  return {hit:Eyedropper.hitTest([+p.x, +p.y], tol)};
});

/* appearance.copyFrom（不带 reverse）：被点物件的填色／描边／描边宽 → 绘图预设（Picked.to_defaults）。
   我们没有「选取中的物件」，所以 vectorcraft 那半「同时套到选取物件上」没有对象，只做预设这半；不进历史。 */
CMD.reg('eyedropper.copyFrom', {i18n:'', params:'{layerId, shapeId} 吸外观：把该形状的填色、描边色、描边宽写进右栏预设（没有描边 ⇒ 描边宽设 0）'}, p => {
  const {s} = Eyedropper.findShape(p.layerId, p.shapeId);
  if (!s) return {ok:false, error:'no such shape'};
  const out = {ok:true};
  const f = Eyedropper.cssToHex(s.fill);
  if (f){ Eyedropper.setColor('fillColor', f); out.fill = f; }                // 填色是 none：我们的填色栏没有「无」，留原值
  const stroked = s.stroke && s.stroke !== 'none' && (s.strokeWidth || 0) > 0;
  const w = document.getElementById('strokeW');
  if (stroked){
    const h = Eyedropper.cssToHex(s.stroke);
    if (h){ Eyedropper.setColor('strokeColor', h); out.stroke = h; }
    if (w){ w.value = s.strokeWidth; out.strokeWidth = s.strokeWidth; }
  } else if (w){ w.value = 0; out.stroke = 'none'; out.strokeWidth = 0; }   // 我们「描边＝无」只能用宽 0 表示
  return out;
});

/* appearance.copyFrom {reverse:true}：把来源外观套到被点的物件上（Picked.apply，非 append：整组替换）。
   来源：vectorcraft 用「第一个选取物件」；我们没有物件选取，来源＝右栏目前的预设。会改文件 ⇒ 进历史。 */
CMD.reg('eyedropper.reverse', {i18n:'', params:'{layerId, shapeId, fill?, stroke?, strokeWidth?} 把外观套到该形状上；没给的取右栏目前的填色／描边／描边宽', undoable:true}, p => {
  const {L, s} = Eyedropper.findShape(p.layerId, p.shapeId);
  if (!s) return {ok:false, error:'no such shape'};
  const fill = p.fill !== undefined ? p.fill : UI.fill();
  const strokeWidth = p.strokeWidth !== undefined ? +p.strokeWidth : UI.strokeW();
  const stroke = p.stroke !== undefined ? p.stroke : (strokeWidth > 0 ? document.getElementById('strokeColor').value : 'none');
  s.fill = fill; s.stroke = stroke; s.strokeWidth = strokeWidth;
  Layer.invalidate(L);
  return {ok:true, ids:[s.id], fill, stroke, strokeWidth};
});

/* paint.sampleColor：只吸颜色，写进作用中的填色／描边（我们没有填色／描边哪个在前的切换，预设填色） */
CMD.reg('eyedropper.sampleColor', {i18n:'', params:'{color:"#rrggbb", stroke=false} 把颜色写进填色（stroke=true 写进描边色）'}, p => {
  const h = Eyedropper.cssToHex(p.color);
  if (!h) return {ok:false, error:'bad color'};
  Eyedropper.setColor(p.stroke ? 'strokeColor' : 'fillColor', h);
  return {ok:true, color:h, stroke:!!p.stroke};
});

/* 按下那一下的整套判断（滑鼠的 onDown 只叫这一条；agent 叫它就跟人点一下完全一样）
   eyedropper.rs:69-93 ＋ canvas.rs:2002-2010 */
CMD.reg('eyedropper.click', {i18n:'', params:'{x, y, alt=false, shift=false, tol=3/缩放, sampleSize?} 文件坐标；吸管点一下：当前层是矢量层且点到形状 ⇒ 吸外观（shift 只吸颜色、alt 套用预设、shift+alt 不动作）；否则取合成像素进填色（alt 进描边色） → {mode:"vector"|"pixel", …}'}, p => {
  const x = +p.x, y = +p.y;
  const A = Doc.active();
  if (A && A.kind === 'vector'){
    const tol = p.tol !== undefined ? +p.tol : 3 / (window.UI ? UI.zoom : 1);
    const h = Eyedropper.hitTest([x, y], tol);
    if (h){
      const {s} = Eyedropper.findShape(h.layerId, h.shapeId);
      // eyedropper.rs:78-81 Alt：reverse；Shift+Alt：append
      if (p.alt){
        if (p.shift) return {mode:'vector', action:'append', ok:false, reason:'no appearance stack'};
        return Object.assign({mode:'vector', action:'reverse'}, CMD.run('eyedropper.reverse', {layerId:h.layerId, shapeId:h.shapeId}));
      }
      // eyedropper.rs:83-85 没按 Shift：吸外观
      if (!p.shift) return Object.assign({mode:'vector', action:'copyFrom'}, CMD.map['eyedropper.copyFrom'].run({layerId:h.layerId, shapeId:h.shapeId}));
      // eyedropper.rs:46-51 paint_sample：点到描边、或没有填色 ⇒ 取描边色，否则取填色
      const fillNone = !s.fill || s.fill === 'none';
      const paint = (h.kind === 'stroke' || fillNone) ? ((s.stroke && s.stroke !== 'none' && (s.strokeWidth||0) > 0) ? s.stroke : null) : s.fill;
      const c = Eyedropper.cssToHex(paint);
      if (!c) return {mode:'vector', action:'sampleColor', ok:false, reason:'no paint'};
      return Object.assign({mode:'vector', action:'sampleColor'}, CMD.map['eyedropper.sampleColor'].run({color:c}));
    }
  }
  return Object.assign({mode:'pixel'}, CMD.map['eyedropper.sample'].run({x, y, background:!!p.alt, sampleSize:p.sampleSize}));
});

/* ───────── 工具 ───────── */
Tools.reg({
  id:'eyedropper', icon:'⌖', key:'I', group:'misc', order:20, for:'common', opts:[],
  hint:'ui.eyedropperHint',
  strings:{
    'zh-Hant':{ 'opt.sampleSize':'取樣大小', 'opt.sampleSize.1':'點', 'opt.sampleSize.3':'3×3 平均', 'opt.sampleSize.5':'5×5 平均',
                'ui.eyedropperHint':'點按（可拖曳）取填色 · Alt＋點按取筆畫色 · 向量層點物件：吸外觀，Shift 只吸顏色，Alt 套上目前外觀' },
    'zh-Hans':{ 'opt.sampleSize':'取样大小', 'opt.sampleSize.1':'点', 'opt.sampleSize.3':'3×3 平均', 'opt.sampleSize.5':'5×5 平均',
                'ui.eyedropperHint':'点按（可拖曳）取填充色 · Alt＋点按取描边色 · 矢量层点物件：吸外观，Shift 只吸颜色，Alt 套上当前外观' },
    'en':     { 'opt.sampleSize':'Sample Size', 'opt.sampleSize.1':'Point Sample', 'opt.sampleSize.3':'3 by 3 Average', 'opt.sampleSize.5':'5 by 5 Average',
                'ui.eyedropperHint':'Click (or drag) to sample the fill · Alt-click for the stroke · On a vector layer, click an object to copy its appearance; Shift samples the colour only, Alt applies the current appearance' }
  },
  buildOptions(box, add){
    const sel = document.createElement('select'); sel.id = 'eyedropperSampleSize';
    [1, 3, 5].forEach(n => {
      const o = document.createElement('option'); o.value = n; o.textContent = Lang.t('opt.sampleSize.' + n);
      if (n === Eyedropper.sampleSize) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => CMD.run('eyedropper.setOptions', {sampleSize:+sel.value});
    add('sampleSize', sel);
  },
  onDown(e, pt, P){
    Eyedropper._comp = composite(1);                 // 这一次拖曳都用这张
    const r = CMD.run('eyedropper.click', {x:pt[0], y:pt[1], alt:e.altKey, shift:e.shiftKey, tol:3 / UI.zoom});
    Eyedropper._mode = r.mode;
  },
  onMove(e, pt, P){
    // canvas.rs:2004：拖曳中每一步都重新取样（Alt 看当下这一步有没有按）；vectorcraft 那条只认按下
    if (!P.down || Eyedropper._mode !== 'pixel') return;
    CMD.run('eyedropper.sample', {x:pt[0], y:pt[1], background:e.altKey});
  },
  onUp(){                                            // canvas.rs:2008：放开什么也不做
    Eyedropper._comp = null; Eyedropper._mode = null; UI.draw();
  },
  onDeactivate(){ Eyedropper._comp = null; Eyedropper._mode = null; }
});
