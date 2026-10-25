/* 油漆桶（G）：点一下，把「跟按下那一点颜色相近」的区域填成前景色。
   🔴 逐段照抄 ArtCraft／PhotoCraft 的 Rust 原始码（只把 Rust 换成 JS），不是凭 PS 印象另写：
     · ui-egui/src/canvas.rs:2068-2073      按下＝叫一次 paint.bucket（不看修饰键、不拖、不预览）
     · ui-egui/src/panels.rs:623-636, 810   选项栏：填充来源／不透明度／容差／消除锯齿／连续／所有图层；提示字
     · ui-egui/src/state.rs:416-426         选项预设：容差 32、连续 开、消除锯齿 开、不透明度 100
     · engine/src/paint_cmds.rs:9-72,118    命令参数解析、颜色解析、bucket()
     · algo/src/paint.rs:58-111,149-190     bucket_fill / bucket_fill_src / composite_area
     · algo/src/selection.rs:205-361        rgba8_image / Region / wand_region（扫描线填充＋3×3 消除锯齿）
     · color/src/blend.rs:322-342           composite（Normal 混合）
   命令：bucket.fill（参数同 PhotoCraft 的 paint.bucket）。界面只是叫它，agent 走同一条路。 */

/* 选项（照 state.rs:416-426 的预设；anti_alias／contiguous／fill_opacity 在原码里是几颗工具共用的，所以挂在 ToolState 上） */
if (ToolState.fillOpacity === undefined) ToolState.fillOpacity = 100;   // fill_opacity: 100.0
if (ToolState.antiAlias   === undefined) ToolState.antiAlias   = true;  // anti_alias: true
if (ToolState.contiguous  === undefined) ToolState.contiguous  = true;  // contiguous: true

const Bucket = {
  /* paint_cmds.rs:15-31 color()：[r,g,b,a?]（0..1 浮点）或 "#rrggbb[aa]"；解析不了就用预设（前景色）。
     多收一种 "#rgb" 简写（我们这边的 CSS 习惯），他们的码会把它当成解析失败。 */
  color(v, d){
    if (Array.isArray(v) && v.length >= 3){
      const c = v.map(x => +x || 0);
      return [c[0], c[1], c[2], c[3] === undefined ? 1 : c[3]];
    }
    if (typeof v === 'string'){
      let h = v.replace(/^#+/, '');
      if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('');
      const c = i => { const s = h.slice(i, i + 2); return /^[0-9a-f]{2}$/i.test(s) ? parseInt(s, 16) / 255 : null; };
      const r = c(0), g = c(2), b = c(4);
      if (r !== null && g !== null && b !== null){ const a = c(6); return [r, g, b, a === null ? 1 : a]; }
    }
    return d;
  },

  /* selection.rs:248-361 wand_region：在 area 这块 RGBA8 上找「跟种子点相近」的像素。
     img＝area 的 straight RGBA 位元组（w×h）；seed 是 area 内的局部座标。
     回 {bbox:{x0,y0,x1,y1}（area 局部座标、含消除锯齿那一圈）, mask:Uint8Array(0..255)}；种子不在 area 内回 null。 */
  wandRegion(img, w, h, seed, tolerance, contiguous, antiAlias){
    if (seed[0] < 0 || seed[1] < 0 || seed[0] >= w || seed[1] >= h) return null;
    const si = (seed[1] * w + seed[0]) * 4;
    const t0 = img[si], t1 = img[si + 1], t2 = img[si + 2], t3 = img[si + 3];
    const tol = Math.max(0, Math.floor(tolerance + 1e-3));
    // 四个通道（含 alpha）各自差 ≤ 容差 才算相近
    const similar = k => {
      const j = k * 4;
      return Math.abs(img[j] - t0) <= tol && Math.abs(img[j + 1] - t1) <= tol &&
             Math.abs(img[j + 2] - t2) <= tol && Math.abs(img[j + 3] - t3) <= tol;
    };
    const marks = new Uint8Array(w * h);
    let bx0 = Infinity, by0 = Infinity, bx1 = 0, by1 = 0;
    if (contiguous){
      // 扫描线填充：填满一整段，再看上下两列有没有新的种子
      const stack = [seed[0], seed[1]];
      while (stack.length){
        const y = stack.pop(), x = stack.pop();
        const row = y * w;
        if (marks[row + x] !== 0) continue;
        let l = x, r = x;
        while (l > 0 && marks[row + l - 1] === 0 && similar(row + l - 1)) l--;
        while (r + 1 < w && marks[row + r + 1] === 0 && similar(row + r + 1)) r++;
        marks.fill(255, row + l, row + r + 1);
        bx0 = Math.min(bx0, l); bx1 = Math.max(bx1, r); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
        for (const ny of [y - 1, y + 1]){
          if (ny < 0 || ny >= h) continue;
          const nrow = ny * w;
          let inRun = false;
          for (let nx = l; nx <= r; nx++){
            const ok = marks[nrow + nx] === 0 && similar(nrow + nx);
            if (ok && !inRun) stack.push(nx, ny);
            inRun = ok;
          }
        }
      }
    } else {
      // 不连续：整块里所有相近的像素都算
      for (let y = 0; y < h; y++){
        let a = -1, b = -1;
        for (let x = 0; x < w; x++){
          if (similar(y * w + x)){ marks[y * w + x] = 255; if (a < 0) a = x; b = x; }
        }
        if (a >= 0){ bx0 = Math.min(bx0, a); bx1 = Math.max(bx1, b); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
      }
    }
    if (bx0 === Infinity) return null;
    // 消除锯齿多留一圈，夹在 area 内
    const pad = antiAlias ? 1 : 0;
    const x0 = Math.max(0, bx0 - pad), y0 = Math.max(0, by0 - pad);
    const x1 = Math.min(w, bx1 + 1 + pad), y1 = Math.min(h, by1 + 1 + pad);
    const bw = x1 - x0;
    const mask = new Uint8Array(bw * (y1 - y0));
    for (let y = y0; y < y1; y++){
      for (let x = x0; x < x1; x++){
        const v = marks[y * w + x];
        let o = v;
        if (antiAlias){
          // 边缘像素跟 3×3 邻居取平均；area 外的邻居当成自己
          let sum = 0, edge = false;
          for (let dy = -1; dy <= 1; dy++){
            for (let dx = -1; dx <= 1; dx++){
              const nx = x + dx, ny = y + dy;
              const n = (nx < 0 || ny < 0 || nx >= w || ny >= h) ? v : marks[ny * w + nx];
              if (n !== v) edge = true;
              sum += n;
            }
          }
          if (edge){
            const avg = sum / (9 * 255);
            const f = v > 127 ? 0.5 + 0.5 * avg : 0.5 * avg;
            o = Math.round(f * 255);
          }
        }
        mask[(y - y0) * bw + (x - x0)] = o;
      }
    }
    return {bbox:{x0, y0, x1, y1}, mask};
  },

  /* 选区在「文件像素 (X,Y)」的覆盖度 0..1（他们是 selection.sample_channel(x,y,0)）。
     我们的选区目前只有矩形 {x,y,w,h}（文件座标）：算像素格与矩形的重叠比例，整数矩形就是 0／1。 */
  selCoverage(sel, X, Y){
    if (!sel) return 1;
    if (window.SelMask) return SelMask.coverage(X, Y, sel);   // 路径／套索／羽化选区照真形状（同 clone.js）
    const sx0 = Math.min(sel.x, sel.x + sel.w), sx1 = Math.max(sel.x, sel.x + sel.w);
    const sy0 = Math.min(sel.y, sel.y + sel.h), sy1 = Math.max(sel.y, sel.y + sel.h);
    const ox = Math.max(0, Math.min(X + 1, sx1) - Math.max(X, sx0));
    const oy = Math.max(0, Math.min(Y + 1, sy1) - Math.max(Y, sy0));
    return ox * oy;
  },

  /* paint.rs:169-190 bucket_fill_src ＋ paint.rs:58-111 composite_area ＋ blend.rs:322-342 composite(Normal)
     L＝像素层；seedDoc＝文件像素座标（已 floor）；回 true＝有填。 */
  fill(L, seedDoc, o){
    const cv = L.data.canvas, ctx = L.data.ctx;
    // area＝文件范围（他们是 doc.bounds()）。🔴 铁律④：换算成这一层自己的座标＝文件座标 − 图层位移
    const ox = L.x || 0, oy = L.y || 0;
    const ax0 = Math.max(0, Math.ceil(-ox)), ay0 = Math.max(0, Math.ceil(-oy));
    const ax1 = Math.min(cv.width, Math.floor(Doc.width - ox)), ay1 = Math.min(cv.height, Math.floor(Doc.height - oy));
    const aw = ax1 - ax0, ah = ay1 - ay0;
    const sx = Math.floor(seedDoc[0] - ox), sy = Math.floor(seedDoc[1] - oy);
    // area.contains(seed)，不在就不填
    if (aw <= 0 || ah <= 0 || sx < ax0 || sy < ay0 || sx >= ax1 || sy >= ay1) return false;
    // rgba8_image(s, area)：只取这一层自己的像素（不看别层）
    const imgData = ctx.getImageData(ax0, ay0, aw, ah), d = imgData.data;
    const region = this.wandRegion(d, aw, ah, [sx - ax0, sy - ay0], o.tolerance, o.contiguous, o.antiAlias);
    if (!region) return false;
    // 只在填到的那块框里合成：覆盖度＝区域遮罩 × 不透明度 × 选区
    const b = region.bbox, bw = b.x1 - b.x0, c = o.color, opacity = o.opacity, sel = o.selection;
    for (let y = b.y0; y < b.y1; y++){
      for (let x = b.x0; x < b.x1; x++){
        const m = region.mask[(y - b.y0) * bw + (x - b.x0)];
        if (!m) continue;
        const k = (m / 255) * opacity * this.selCoverage(sel, ax0 + x + ox, ay0 + y + oy);
        if (k <= 0) continue;
        const i = (y * aw + x) * 4;
        // blend.rs composite(Normal, backdrop, source, k)
        const ab = d[i + 3] / 255, as = c[3] * k;
        if (as <= 0) continue;
        const ao = as + ab * (1 - as);
        if (ao <= 0){ d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; continue; }
        for (let ch = 0; ch < 3; ch++){
          const cb = d[i + ch] / 255, cs = c[ch];
          const premul = (1 - as) * ab * cb + (1 - ab) * as * cs + as * ab * cs;   // Normal：B(cb,cs)＝cs
          d[i + ch] = Math.round(Math.max(0, Math.min(1, premul / ao)) * 255);
        }
        d[i + 3] = Math.round(Math.max(0, Math.min(1, ao)) * 255);
      }
    }
    // 只写回那块框（框外原样不动）
    ctx.putImageData(imgData, ax0, ay0, b.x0, b.y0, bw, b.y1 - b.y0);
    return true;
  }
};
window.Bucket = Bucket;

/* engine/src/paint_cmds.rs:37-72 bucket() 与 :113-121 的参数说明 */
CMD.reg('bucket.fill', {
  i18n:'', undoable:true,
  params:'{x,y 文件坐标(px，会 floor), tolerance=32 (0..255，四通道各自差≤容差), contiguous=true (只填跟落点相连的), '
       + 'antiAlias=true (边缘 3×3 柔化一圈), color="#rrggbb[aa]"|[r,g,b,a](0..1)=前景色, opacity=100 (1..100 %), '
       + 'contents="foreground" ("pattern" 尚未支持), layerId?} → {ok, filled} 只取当前层自己的像素判相近；有选区时只填选区内；'
       + '照 PhotoCraft paint.bucket'
}, p => {
  const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  if (!L || L.kind !== 'raster') return {ok:false, error:'not a pixel layer'};
  // 填充来源：前景色（预设）或图样（paint_cmds.rs:43）——我们还没有图样库
  const source = p.contents || p.source || 'foreground';
  if (source === 'pattern') return {ok:false, error:'pattern fill not supported yet'};
  const fg = Bucket.color(window.UI ? UI.fill() : '#000000', [0, 0, 0, 1]);
  const color = Bucket.color(p.color, fg);
  const num = (k, dv) => (p[k] === undefined || p[k] === null || isNaN(+p[k])) ? dv : +p[k];
  const bool = (k, dv) => (typeof p[k] === 'boolean') ? p[k] : dv;
  const x = Math.floor(num('x', 0)), y = Math.floor(num('y', 0));
  const filled = Bucket.fill(L, [x, y], {
    tolerance: num('tolerance', 32),
    contiguous: bool('contiguous', true),
    antiAlias: bool('antiAlias', true),
    opacity: Math.max(0, Math.min(100, num('opacity', 100))) / 100,
    color, selection: Doc.sel
  });
  return {ok:true, filled};
});

Tools.reg({
  id:'bucket', icon:'🪣', key:'G', group:'raster', order:30, for:'raster', needs:'raster', opts:[],
  hint:'ui.bucketHint',
  strings:{
    'zh-Hant':{'opt.fillOpacity':'不透明', 'opt.antiAlias':'消除鋸齒', 'opt.contiguous':'連續的', 'ui.bucketHint':'點一下，填滿相近的顏色'},
    'zh-Hans':{'opt.fillOpacity':'不透明度', 'opt.antiAlias':'消除锯齿', 'opt.contiguous':'连续的', 'ui.bucketHint':'点一下，填满相近的颜色'},
    'en':{'opt.fillOpacity':'Opacity', 'opt.antiAlias':'Anti-alias', 'opt.contiguous':'Contiguous', 'ui.bucketHint':'Click to fill similar colours'}
  },
  /* panels.rs:623-636 的顺序：不透明度、容差、消除锯齿、连续 */
  buildOptions(box, add, mk){
    const op = mk('number', {min:1, max:100, value:ToolState.fillOpacity});
    op.dataset.opt = 'fillOpacity';
    op.oninput = () => { const v = +op.value; if (!isNaN(v) && op.value !== '') ToolState.fillOpacity = Math.max(1, Math.min(100, v)); };
    add('fillOpacity', op);
    const tl = mk('number', {min:0, max:255, value:ToolState.tolerance});
    tl.dataset.opt = 'tolerance';
    tl.oninput = () => { const v = +tl.value; if (!isNaN(v) && tl.value !== '') ToolState.tolerance = Math.max(0, Math.min(255, v)); };
    add('tolerance', tl);
    const aa = mk('checkbox', {checked:ToolState.antiAlias});
    aa.dataset.opt = 'antiAlias';
    aa.onchange = () => { ToolState.antiAlias = aa.checked; };
    add('antiAlias', aa);
    const ct = mk('checkbox', {checked:ToolState.contiguous});
    ct.dataset.opt = 'contiguous';
    ct.onchange = () => { ToolState.contiguous = ct.checked; };
    add('contiguous', ct);
  },
  /* canvas.rs:2068-2073：按下就填一次，不看 Shift／Alt／Ctrl，也没有拖曳与预览 */
  onDown(e, pt, P){
    P.ensureRaster();
    CMD.run('bucket.fill', {
      x:Math.floor(pt[0]), y:Math.floor(pt[1]),
      tolerance:ToolState.tolerance, contiguous:ToolState.contiguous, antiAlias:ToolState.antiAlias,
      opacity:ToolState.fillOpacity, contents:'foreground', color:UI.fill()
    });
    P.down = false;
  }
});
