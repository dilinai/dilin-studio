/* 3D 材质拖放（PS：G，与渐变／油漆桶同一格）—— 原码没有·照 PS 2020 写
   ArtCraft PhotoCraft 没有 3D（没有 3D 图层、网格、材质）。
   PS 2020 的这颗：在 3D 物件上点一下＝把「载入的材质」套到点到的那块网格表面（整个材质槽）；按住 Alt 点＝临时变成材质吸管、把点到的材质载进来；
   选项栏是材质挑选器（色块＋材质库）＋「载入所选」。在非 3D 图层上 PS 什么都不做。
   在非 3D 图层上 ⇒ 我们做它的「2D 版」：
     · 点一下＝把载入的材质（tools/material3d.js 的 window.Material3D.current：颜色或平铺贴图）填进「点到的相连区域」——
       区域判定照油漆桶（tools/bucket.js 的 window.Bucket.wandRegion：四通道各差 ≤ 容差、扫描线连续填充、消除锯齿一圈）；
       「表面」＝跟点到那一点颜色相近且相连的一块（PS 3D 的「点到的网格表面」在 2D 上最接近的东西）
     · Alt＋点＝临时材质吸管（同 material3d.sample）
     · 选项栏：材质挑选器（同材质吸管）、不透明度、容差、消除锯齿、连续的、所有图层（取样所有图层判区域）
     · 有选区就只填选区内；图层被移动过照样对（文件坐标 − 图层位移）；锁像素／全锁的层不给填
   改文件只走 drop3d.fill（undoable，一下一步历史）。
   当前层是真的 3D 图层（tools/material3d.js 的 Scene3D）⇒ 照 PS 本行：点网格＝把载入的材质套到点到的那个表面（整个材质槽）；
     在网格上拖＝照选项栏 3D 模式动物件、空处拖＝动相机（material3d.transform）。 */
(function(){
if (window.Drop3D) return;

const STRINGS = {
  'zh-Hant':{'tool.drop3d':'3D 材質拖移', 'opt.d3Opacity':'不透明：', 'opt.d3Tol':'容許度：', 'opt.d3AA':'消除鋸齒', 'opt.d3Cont':'連續的', 'opt.d3All':'所有圖層',
             'ui.d3Hint':'點一下：把材質填進點到的相連區域 · Alt＋點＝吸取材質'},
  'zh-Hans':{'tool.drop3d':'3D 材质拖放', 'opt.d3Opacity':'不透明度：', 'opt.d3Tol':'容差：', 'opt.d3AA':'消除锯齿', 'opt.d3Cont':'连续的', 'opt.d3All':'所有图层',
             'ui.d3Hint':'点一下：把材质填进点到的相连区域 · Alt＋点＝吸取材质'},
  'en':{'tool.drop3d':'3D Material Drop', 'opt.d3Opacity':'Opacity:', 'opt.d3Tol':'Tolerance:', 'opt.d3AA':'Anti-alias', 'opt.d3Cont':'Contiguous', 'opt.d3All':'All Layers',
        'ui.d3Hint':'Click: drop the material into the connected area · Alt-click to load a material'}
};
if (typeof Lang !== 'undefined') Lang.add(STRINGS);

const D3 = window.Drop3D = {
  opt: {opacity:100, tolerance:32, antiAlias:true, contiguous:true, sampleAll:false},
  /* L＝像素层；seed＝文件像素；o＝{tolerance, contiguous, antiAlias, opacity 0..1, sampleAll, material, selection} → 填了几个像素 */
  fill(L, seed, o){
    const W = Doc.width, H = Doc.height, ox = L.x || 0, oy = L.y || 0;
    if (seed[0] < 0 || seed[1] < 0 || seed[0] >= W || seed[1] >= H) return 0;
    // 判区域用的画面：所有图层＝合成；否则只看这一层（画进文件大小的画布，铁律④：贴在 L.x/L.y）
    let src;
    if (o.sampleAll) src = composite(1);
    else { src = document.createElement('canvas'); src.width = W; src.height = H; src.getContext('2d').drawImage(L.data.canvas, ox, oy); }
    const sd = src.getContext('2d', {willReadFrequently:true}).getImageData(0, 0, W, H).data;
    const region = Bucket.wandRegion(sd, W, H, seed, o.tolerance, o.contiguous, o.antiAlias);
    if (!region) return 0;
    const b = region.bbox, bw = b.x1 - b.x0;
    // 写进这一层：区域框（文件坐标）换成图层坐标，夹在图层画布内
    const cv = L.data.canvas, lx0 = Math.max(0, b.x0 - ox), ly0 = Math.max(0, b.y0 - oy), lx1 = Math.min(cv.width, b.x1 - ox), ly1 = Math.min(cv.height, b.y1 - oy);
    if (lx1 <= lx0 || ly1 <= ly0) return 0;
    const img = L.data.ctx.getImageData(lx0, ly0, lx1 - lx0, ly1 - ly0), d = img.data, iw = lx1 - lx0;
    let n = 0;
    for (let ly = ly0; ly < ly1; ly++){
      const Y = ly + oy;
      for (let lx = lx0; lx < lx1; lx++){
        const X = lx + ox, m = region.mask[(Y - b.y0) * bw + (X - b.x0)];
        if (!m) continue;
        const k = (m / 255) * o.opacity * Bucket.selCoverage(o.selection, X, Y);
        if (k <= 0) continue;
        const c = Material3D.pixelAt(X, Y, o.material), i = ((ly - ly0) * iw + (lx - lx0)) * 4;
        // Normal 合成（同 bucket.js）
        const ab = d[i + 3] / 255, as = (c[3] / 255) * k;
        if (as <= 0) continue;
        const ao = as + ab * (1 - as);
        for (let ch = 0; ch < 3; ch++){
          const cb = d[i + ch] / 255, cs = c[ch] / 255;
          d[i + ch] = Math.round(Math.max(0, Math.min(1, ((1 - as) * ab * cb + as * cs) / ao)) * 255);
        }
        d[i + 3] = Math.round(Math.min(1, ao) * 255);
        n++;
      }
    }
    L.data.ctx.putImageData(img, lx0, ly0);
    Layer.invalidate(L);
    return n;
  }
};

const num = (p, k, dv) => (p[k] === undefined || p[k] === null || p[k] === '' || isNaN(+p[k])) ? dv : +p[k];
const bool = (p, k, dv) => typeof p[k] === 'boolean' ? p[k] : dv;
CMD.reg('drop3d.fill', {i18n:'tool.drop3d', undoable:true,
  params:'{x, y 文件坐标, tolerance=32 (0..255), contiguous=true, antiAlias=true, opacity=100 (1..100 %), sampleAll=false（用所有图层的合成判区域）, '
       + 'material?:{color:"#rrggbb[aa]"} | {pattern:图案名或 id}（缺省＝目前载入的材质，见 material3d.*）, layerId?} '
       + '3D 材质拖放的 2D 版：把材质（纯色或以文件原点平铺的贴图）填进跟落点颜色相近的相连区域；有选区只填选区内 → {ok, filled 像素数, material}。'
       + '当前层是 3D 图层（material3d.newMesh 建的）：材质套到 (x,y) 点到的网格表面（或直接给 meshId＋surface），material 另收 opacity/shininess/specular → {ok, filled3d, mesh, surfaces}'},
  p => {
    const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
    if (!L || L.kind !== 'raster') return {ok:false, error:'not a pixel layer'};
    const lk = window.Locks ? Locks.blocks(L, 'pixels') : null; if (lk) return Locks.fail(L, lk, 'drop3d.fill');
    // 3D 图层：材质落在点到的网格表面上（PS 本行）；点在空处＝什么都不做
    if (window.Scene3D && Scene3D.is3D(L)){
      let meshId = p.meshId, surface = p.surface;
      if (!meshId){
        const h = Scene3D.pick(L, +p.x, +p.y);
        if (!h) return {ok:false, error:'no 3D surface there'};
        meshId = h.mesh.id; surface = h.surface;
      }
      const q = {layerId:L.id, meshId, surface};
      if (p.material && typeof p.material === 'object') q.material = p.material;
      const r = CMD.map['material3d.setSurface'].run(q);      // 这条命令已推过历史：直接跑正文
      return r && r.ok === false ? r : Object.assign({ok:true, filled3d:true}, r);
    }
    let mat = Material3D.current;
    if (p.material && typeof p.material === 'object'){
      if (p.material.color !== undefined){ const c = Material3D.parseColor(p.material.color); if (!c) return {ok:false, error:'bad material color'}; mat = {kind:'color', rgba:c, name:'#' + c.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('')}; }
      else if (p.material.pattern !== undefined){
        const P = window.PsEdit && PsEdit.patterns, q = P ? P.resolve(String(p.material.pattern)) : null;
        if (!q) return {ok:false, error:'pattern not found'}; mat = {kind:'pattern', w:q.width, h:q.height, px:q.px, name:q.name};
      }
    }
    const x = Math.floor(num(p, 'x', NaN)), y = Math.floor(num(p, 'y', NaN));
    if (!isFinite(x) || !isFinite(y)) return {ok:false, error:'x,y required'};
    const filled = D3.fill(L, [x, y], {
      tolerance:Math.max(0, Math.min(255, num(p, 'tolerance', 32))), contiguous:bool(p, 'contiguous', true), antiAlias:bool(p, 'antiAlias', true),
      opacity:Math.max(0, Math.min(100, num(p, 'opacity', 100))) / 100, sampleAll:bool(p, 'sampleAll', false), material:mat, selection:Doc.sel
    });
    return {ok:true, filled, material:Material3D.summary(mat)};
  });
CMD.reg('drop3d.options', {i18n:'', params:'{opacity?, tolerance?, antiAlias?, contiguous?, sampleAll?} 3D 材质拖放选项；{} 只读 → 目前选项'},
  p => {
    const o = D3.opt;
    if (p.opacity !== undefined && isFinite(+p.opacity)) o.opacity = Math.max(1, Math.min(100, +p.opacity));
    if (p.tolerance !== undefined && isFinite(+p.tolerance)) o.tolerance = Math.max(0, Math.min(255, +p.tolerance));
    ['antiAlias', 'contiguous', 'sampleAll'].forEach(k => { if (typeof p[k] === 'boolean') o[k] = p[k]; });
    if (window.UI && ToolState.cur === 'drop3d') UI.buildOptions('drop3d');
    return Object.assign({}, o);
  });

Tools.reg({
  id:'drop3d', icon:'🪣', group:'raster', order:97, for:'raster', needs:'raster', opts:[], cursor:'crosshair',
  strings:STRINGS, hint:'ui.d3Hint',
  buildOptions(box, add, mk){
    if (window.Material3DPicker) Material3DPicker(box, add, mk);
    const o = D3.opt, set = q => CMD.run('drop3d.options', q);
    const op = mk('number', {min:1, max:100, value:o.opacity}); op.dataset.opt = 'opacity'; op.style.width = '52px'; op.onchange = () => set({opacity:+op.value}); add('d3Opacity', op);
    const tl = mk('number', {min:0, max:255, value:o.tolerance}); tl.dataset.opt = 'tolerance'; tl.style.width = '52px'; tl.onchange = () => set({tolerance:+tl.value}); add('d3Tol', tl);
    [['antiAlias', 'd3AA'], ['contiguous', 'd3Cont'], ['sampleAll', 'd3All']].forEach(([k, l]) => {
      const cb = mk('checkbox', {checked:o[k]}); cb.dataset.opt = k; cb.onchange = () => set({[k]:cb.checked}); add(l, cb);
    });
    if (window.Scene3D) Scene3D.buildBar(box);
  },
  onDown(e, pt, P){
    if (e.button !== undefined && e.button !== 0){ P.down = false; return; }
    if (e.altKey){ CMD.run('material3d.sample', {x:pt[0], y:pt[1]}); P.down = false; return; }   // Alt＝临时材质吸管
    if (window.Scene3D && Scene3D.down(e, pt)) return;     // 3D 层：拖＝3D 模式动物件／相机，没拖＝放开时把材质落到点到的表面
    P.ensureRaster();
    const L = Doc.active();
    if (L && window.Locks && Locks.deny(L, 'pixels')){ P.down = false; return; }
    const o = D3.opt;
    CMD.run('drop3d.fill', {x:Math.floor(pt[0]), y:Math.floor(pt[1]), tolerance:o.tolerance, contiguous:o.contiguous, antiAlias:o.antiAlias, opacity:o.opacity, sampleAll:o.sampleAll});
    P.down = false;
  },
  onMove(e, pt){ if (window.Scene3D) Scene3D.move(e, pt); },
  onUp(e, pt){
    if (!window.Scene3D) return;
    const r = Scene3D.up(e, pt);
    if (r === 'click'){ const q = CMD.run('drop3d.fill', {x:pt[0], y:pt[1]}); if (q && q.ok === false && q.error) console.warn(q.error); UI.refresh(); }
  },
  onDeactivate(){ if (window.Scene3D) Scene3D.cancel(); },
  drawOverlay(ctx, s){ if (window.Scene3D) Scene3D.overlay(ctx, s); }
});
})();
