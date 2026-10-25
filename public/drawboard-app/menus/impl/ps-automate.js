/* 堤麟画板 · Photoshop ▸ 文件 ▸ 自动：合并到 HDR Pro…／Photomerge…／镜头校正…
   命令（agent 走命令＝人点菜单＋对话框按确定；{ui:true}＝开对话框，同点菜单）：
     ps.file.automate.mergeToHdrPro   多张不同曝光 → 辐射图 → 32 位（线性）或色调映射成 16/8 位，一层「背景」
     ps.file.automate.photomerge      全景接图：特征点配准（Harris＋BRIEF、RANSAC、光束平差）→ 投影变形 → 增益／晕影补偿、接缝、多频段混合，每张一层带蒙版
     ps.file.automate.lensCorrection  批次镜头校正：每张来源图套「滤镜 ▸ 镜头校正」（ps.filter.lensCorrection 同一套算法），一张交一个档
   对照源（photocraft/crates/…，各段注释再标 档:行）：
     engine/src/photo_cmds.rs   1-797   Source／load_sources 55-101、luma_alpha 104、register 131、exif_focal 151、warp_placed 159、plane_matrix 168、
                                         roi_of 176、seam_blend 205-371（含增益＋晕影那段）、seam_order 378、photomerge 395-486、content_aware_fill 490-549、
                                         shift_rgba 553、merge_to_hdr 562-697、specs 763-790
     engine/src/lens_cmds.rs    1-420   LENS_BATCH 27、lens_batch 352-371（process_files：拼合→跑镜头校正→存档）、specs 412-421
     algo/src/hdr.rs            1-424   luma 27、hat 32、estimate_exposures 39、shrink／bitmaps／mtb_offset 66-127、sample_pixels 134、response_curve 167、
                                         g_at 199、MergeOptions／Merged 207-233、merge 237-330、ToneMethod／tone_map 334-424
     algo/src/tone.rs           317-364 hdr_toning（局部适应）
     algo/src/panorama.rs       746-870 Geometry、Photometric、photometric（增益＋共用晕影模型 log V = a·r² + b·r⁴）
     algo/src/photo_util.rs     1-61, 187-194  solve_dense、Normal（法方程）、srgb_to_linear／linear_to_srgb
     algo/src/fxutil.rs         110-181 box_rows_n／box_cols_n／gauss_box_radii／gauss_blur_n
     algo/src/exif.rs           1-131   CameraInfo、exposure_factor、read（TIFF IFD 走 0x8769 子 IFD）
     ui-egui/src/view_cmds.rs   877-895 三个对话框的栏位与预设值（原码是通用表单；版面照 PS 2020 的对话框排）
   直接借用（不重抄）：menus/impl/ps-edit.js 的 PsEdit._alignAlgo（＝panorama.rs／features.rs 的 register、Pl、Hm、warpSurface、warpMeshSurface、
     seamLabels、multiband，「自动对齐图层」已逐段翻过）、PsEdit._algo.caFill（内容识别填充）、menus/impl/ps-filter.js 的 PsFilter.run('filter.lensCorrection')、
     menus/impl/ps-file.js 的 PsFile.encodeAs（编档）。
   我们的差异：
     · 原码每条都「开一份新文件」；画板只有一份文件 ⇒ 结果＝换掉目前这份（一步历史，Ctrl+Z 退回原来那份）。
     · 来源：原码给档案路径／资料夹或「使用打开的文件」；这里＝多选 <input type=file>（或资料夹）、网址／dataURL、云盘 file_id（问宿主 resolveRef），
       或目前文件里的图层（＝「添加打开的文件」：每层一张来源图，按文件大小摆好）。
     · 32 位：我们的画布永远 8 位 ⇒ 「32 位」结果＝线性辐射图照曝光 0 显示（同 PS 32 位文件在曝光 0 的样子）编成 8 位；Doc.depth 不改（不在历史快照里，退不回去）。
     · 镜头校正批次的「存储」一律经 CMD.run('file.exportData')（网站版覆写＝存进云盘）；没有 PSD／DNG 编码器 ⇒ 档案类型只给 相同／PNG／JPEG／WebP／TIFF。
   🔴 改文件全走 CMD；坐标铁律：新像素层都是文件大小、原点 (0,0)。 */
(function(){
'use strict';
if (window.PsAutomate) return;                      // 防双载

/* ═══════════ 小工具 ═══════════ */
const L3 = (hant, hans, en) => Lang.cur === 'en' ? en : Lang.cur === 'zh-Hans' ? hans : hant;
const T3 = a => Array.isArray(a) ? L3(a[0], a[1], a[2]) : String(a);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isNum = v => typeof v === 'number' && isFinite(v);
const num = (p, k, d) => (p && p[k] !== undefined && p[k] !== null && p[k] !== '' && isFinite(+p[k])) ? +p[k] : d;
const flag = (p, k, d) => (p && typeof p[k] === 'boolean') ? p[k] : d;
class AutoBad extends Error {}
const bad = (cmd, msg) => { throw new AutoBad('ps.' + cmd + ': ' + msg); };
const other = msg => { throw new AutoBad(msg); };
function mkCanvas(w, h){ const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
const ctx2d = c => c.getContext('2d', {willReadFrequently:true});
const stem = n => { const s = String(n || '').split(/[?#]/)[0].split(/[\\/]/).pop(); const i = s.lastIndexOf('.'); return i > 0 ? s.slice(0, i) : s; };
const extOf = n => { const s = String(n || '').split(/[?#]/)[0]; const i = s.lastIndexOf('.'); return i > 0 ? s.slice(i + 1).toLowerCase() : ''; };
const ALG = () => (window.PsEdit && PsEdit._alignAlgo) || null;
function toast(msg, err){
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:50%;top:60px;transform:translateX(-50%);z-index:10001;color:#fff;padding:6px 14px;border-radius:4px;font:12px sans-serif;max-width:70vw;background:' + (err ? '#5a2a2a' : '#2a4a5a');
  d.dataset.psaToast = '1'; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 3500);
}
const now = () => (window.performance ? performance.now() : Date.now());

/* photo_util.rs:187-194 sRGB 曲线 */
const srgbToLinear = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const linearToSrgb = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
/* hdr.rs:27 luma（Rec.709） */
const lumaOf = (px, i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];

/* ═══════════ fxutil.rs:110-181 近似高斯（三趟方框，边缘夹住） ═══════════ */
function gaussBoxRadii(sigma){
  const n = 3, wIdeal = Math.sqrt(12 * sigma * sigma / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl -= 1; wl = Math.max(wl, 1);
  const wu = wl + 2;
  const m = clamp(Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)), 0, n);
  return [0, 1, 2].map(i => i < m ? (wl - 1) / 2 : (wu - 1) / 2);
}
function boxPass(buf, w, h, n, r, rows){
  if (r === 0) return;
  const len = rows ? w : h, lines = rows ? h : w, norm = 1 / (2 * r + 1), sc = new Float64Array(len * n);
  for (let line = 0; line < lines; line++){
    const idx = k => rows ? (line * w + k) * n : (k * w + line) * n;
    for (let k = 0; k < len; k++){ const o = idx(k); for (let c = 0; c < n; c++) sc[k * n + c] = buf[o + c]; }
    const at = (k, c) => sc[(k < 0 ? 0 : k >= len ? len - 1 : k) * n + c];
    for (let c = 0; c < n; c++){
      let acc = 0; for (let k = -r; k <= r; k++) acc += at(k, c);
      for (let k = 0; k < len; k++){ buf[idx(k) + c] = acc * norm; acc += at(k + r + 1, c) - at(k - r, c); }
    }
  }
}
function gaussBlurN(buf, w, h, n, sigma){
  if (sigma < 0.3 || !w || !h) return;
  const rr = gaussBoxRadii(sigma);
  for (const r of rr) boxPass(buf, w, h, n, r, true);
  for (const r of rr) boxPass(buf, w, h, n, r, false);
}

/* ═══════════ photo_util.rs:6-61 solve_dense／Normal ═══════════ */
function solveDense(n, a, b){
  for (let col = 0; col < n; col++){
    let piv = col; for (let i = col + 1; i < n; i++) if (Math.abs(a[i * n + col]) > Math.abs(a[piv * n + col])) piv = i;
    if (Math.abs(a[piv * n + col]) < 1e-14) return null;
    if (piv !== col){ for (let k = 0; k < n; k++){ const t = a[col * n + k]; a[col * n + k] = a[piv * n + k]; a[piv * n + k] = t; } const t = b[col]; b[col] = b[piv]; b[piv] = t; }
    const d = a[col * n + col];
    for (let r = col + 1; r < n; r++){
      const f = a[r * n + col] / d; if (f === 0) continue;
      for (let k = col; k < n; k++) a[r * n + k] -= f * a[col * n + k];
      b[r] -= f * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--){ let s = 0; for (let k = r + 1; k < n; k++) s += a[r * n + k] * x[k]; x[r] = (b[r] - s) / a[r * n + r]; }
  for (let i = 0; i < n; i++) if (!isFinite(x[i])) return null;
  return x;
}
class Normal {
  constructor(n){ this.n = n; this.ata = new Float64Array(n * n); this.atb = new Float64Array(n); }
  /* 稀疏一列 Σ coef·x[idx] = rhs，权重 w（平方后加） */
  add(row, rhs, w){
    const w2 = w * w, n = this.n;
    for (const [i, a] of row){ this.atb[i] += w2 * a * rhs; for (const [j, b] of row) this.ata[i * n + j] += w2 * a * b; }
  }
  solve(){ return solveDense(this.n, this.ata, this.atb); }
}

/* ═══════════ exif.rs：相机资讯（曝光时间、光圈、ISO、焦距、35mm 等效焦距） ═══════════ */
function readExif(bytes){
  const info = {};
  if (!bytes || bytes.length < 4) return info;
  let tiff = null;
  if (bytes[0] === 0xFF && bytes[1] === 0xD8){                       // JPEG：找 APP1「Exif\0\0」
    let o = 2;
    while (o + 4 < bytes.length && bytes[o] === 0xFF){
      const mk = bytes[o + 1], len = (bytes[o + 2] << 8) | bytes[o + 3];
      if (mk === 0xDA || mk === 0xD9) break;
      if (mk === 0xE1 && bytes[o + 4] === 0x45 && bytes[o + 5] === 0x78 && bytes[o + 6] === 0x69 && bytes[o + 7] === 0x66){ tiff = bytes.subarray(o + 10, o + 2 + len); break; }
      o += 2 + len;
    }
  } else if ((bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4D && bytes[1] === 0x4D)) tiff = bytes;   // TIFF 本身
  if (!tiff || tiff.length < 8) return info;
  const le = tiff[0] === 0x49;
  if (!((le && tiff[2] === 42 && tiff[3] === 0) || (!le && tiff[2] === 0 && tiff[3] === 42))) return info;
  const u16 = o => o + 2 <= tiff.length ? (le ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1]) : null;
  const u32 = o => o + 4 <= tiff.length ? (le ? (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16) | (tiff[o + 3] << 24)) >>> 0 : ((tiff[o] << 24) | (tiff[o + 1] << 16) | (tiff[o + 2] << 8) | tiff[o + 3]) >>> 0) : null;
  const size = {1:1, 2:1, 6:1, 7:1, 3:2, 8:2, 4:4, 9:4, 11:4, 5:8, 10:8, 12:8};
  const dataAt = (typ, count, field) => { const s = size[typ]; if (!s) return null; return s * count <= 4 ? field : u32(field); };
  const number = (typ, count, field) => {
    const at = dataAt(typ, count, field); if (at === null) return null;
    if (typ === 3) return u16(at); if (typ === 4) return u32(at);
    if (typ === 5){ const n = u32(at), d = u32(at + 4); return d ? n / d : null; }
    if (typ === 10){ const n = u32(at) | 0, d = u32(at + 4) | 0; return d ? n / d : null; }
    return null;
  };
  const text = (typ, count, field) => { if (typ !== 2) return null; const at = dataAt(typ, count, field); if (at === null) return null; let s = ''; for (let i = 0; i < count && at + i < tiff.length; i++) s += String.fromCharCode(tiff[at + i]); s = s.replace(/\0+$/, '').trim(); return s || null; };
  const queue = [u32(4)], seen = [];
  while (queue.length){
    const off = queue.pop(); if (off === null || seen.includes(off) || seen.length > 8) continue; seen.push(off);
    const n = u16(off); if (n === null) continue;
    for (let k = 0; k < n; k++){
      const e = off + 2 + k * 12, tag = u16(e), typ = u16(e + 2), count = u32(e + 4), field = e + 8;
      if (tag === null || typ === null || count === null) continue;
      if (tag === 0x010F) info.make = text(typ, count, field);
      else if (tag === 0x0110) info.model = text(typ, count, field);
      else if (tag === 0x829A) info.exposureTime = number(typ, count, field);
      else if (tag === 0x829D) info.fNumber = number(typ, count, field);
      else if (tag === 0x8827) info.iso = number(typ, count, field);
      else if (tag === 0x920A) info.focalLength = number(typ, count, field);
      else if (tag === 0xA405){ const v = number(typ, count, field); if (v > 0) info.focalLength35 = v; }
      else if (tag === 0xA434) info.lens = text(typ, count, field);
      else if (tag === 0x8769){ const p = u32(field); if (p !== null) queue.push(p); }
    }
  }
  return info;
}
/* exif.rs:24 exposure_factor：t · ISO/100 / N² */
function exposureFactor(info){
  if (!info || !isNum(info.exposureTime)) return null;
  const n = Math.max(isNum(info.fNumber) ? info.fNumber : 1, 0.1);
  return info.exposureTime * (isNum(info.iso) ? info.iso : 100) / 100 / (n * n);
}

/* ═══════════ 来源（photo_cmds.rs:67 load_sources） ═══════════
   p.files（File[]，界面挑的）／p.urls|paths|input|url（网址、dataURL、blob:）／p.fileIds（云盘 file_id，问宿主 resolveRef）／
   p.useOpenDocuments:true 或 p.layers:[图层 id]（目前文件的图层＝「添加打开的文件」）→ [{name, canvas, w, h, exif}] */
async function bytesAndBitmap(src){
  let blob;
  if (src instanceof Blob) blob = src;
  else { const r = await fetch(src); if (!r.ok) throw new Error('HTTP ' + r.status); blob = await r.blob(); }
  const buf = new Uint8Array(await blob.arrayBuffer());
  const bm = await createImageBitmap(blob);
  return {bytes:buf, bm};
}
async function resolveFileId(id){
  const H = window.__dlSiteHooks;
  if (!H || typeof H.resolveRef !== 'function') throw new Error(`file_id=${id}：宿主没提供 window.__dlSiteHooks.resolveRef`);
  let u = await H.resolveRef({file_id:String(id)}); if (u && typeof u === 'object') u = u.url;
  if (!u) throw new Error(`resolveRef 没给 file_id=${id} 的网址`);
  return u;
}
/* 选了哪些图层当来源：p.layers；没给＝多选（≥2）；再没有＝全部看得见、有内容的层（组的子层算在组里） */
function sourceLayerIds(p){
  if (Array.isArray(p.layers) && p.layers.length) return p.layers.filter(id => Doc.byId(id));
  if (Array.isArray(Doc.selectedIds) && Doc.selectedIds.length >= 2 && Doc.selectedIds.includes(Doc.activeId)) return Doc.selectedIds.filter(id => Doc.byId(id));
  return Doc.layers.filter(L => L.visible && !L.parent && hasContent(L)).map(L => L.id);
}
function hasContent(L){
  if (L.kind === 'raster'){
    const c = L.data.canvas; if (!c.width || !c.height) return false;
    const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
    return false;
  }
  if (L.kind === 'vector') return !!(L.data && L.data.shapes && L.data.shapes.length);
  if (L.kind === 'text') return !!(L.data && String(L.data.text || '').trim());
  return L.kind === 'group' || L.kind === 'smart';
}
/* 一层画成文件大小的一张图（像素层照 L.x/L.y 摆；其余 renderLayer 本来就是文件大小） */
function layerCanvas(L){
  const c = mkCanvas(Doc.width, Doc.height), x = ctx2d(c);
  if (L.kind === 'raster') x.drawImage(L.data.canvas, L.x || 0, L.y || 0);
  else x.drawImage(renderLayer(L, 1), 0, 0, Doc.width, Doc.height);
  return c;
}
function inputList(p){
  const out = [], names = Array.isArray(p.names) ? p.names : [];
  const nameOf = (s, i) => names[i] || (s instanceof Blob ? (s.name || 'image ' + (i + 1)) : /^(data|blob):/.test(s) ? 'image ' + (i + 1) : decodeURIComponent(String(s).split(/[?#]/)[0].split('/').pop()) || 'image ' + (i + 1));
  [p.files, p.urls, p.paths, p.input, p.url].forEach(v => { (Array.isArray(v) ? v : v ? [v] : []).forEach(s => { if (s) out.push({kind:'src', src:s, name:nameOf(s, out.length)}); }); });
  (Array.isArray(p.fileIds) ? p.fileIds : p.fileId ? [p.fileId] : []).forEach(id => out.push({kind:'fid', id, name:names[out.length] || String(id)}));
  return out;
}
async function loadSources(p, cmd){
  const srcs = [];
  if (p.useOpenDocuments === true || (Array.isArray(p.layers) && p.layers.length)){
    for (const id of sourceLayerIds(p)){ const L = Doc.byId(id); const c = layerCanvas(L); srcs.push({name:L.name, canvas:c, w:c.width, h:c.height, exif:{}}); }
  }
  for (const it of inputList(p)){
    let r;
    try { r = await bytesAndBitmap(it.kind === 'fid' ? await resolveFileId(it.id) : it.src); }
    catch (e){ bad(cmd, `can't read ${it.name}: ${e.message || e}`); }
    const c = mkCanvas(r.bm.width, r.bm.height); ctx2d(c).drawImage(r.bm, 0, 0); if (r.bm.close) r.bm.close();
    srcs.push({name:it.name, canvas:c, w:c.width, h:c.height, exif:readExif(r.bytes)});
  }
  if (!srcs.length) bad(cmd, 'pass "files"/"urls"/"fileIds" or "useOpenDocuments": true (or "layers")');
  return srcs;
}
/* 画布 → 直通 RGBA 浮点（0..1） */
function floatOf(c){
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data, px = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) px[i] = d[i] / 255;
  return px;
}
function canvasOfFloat(px, w, h){
  const c = mkCanvas(w, h), x = ctx2d(c), img = x.createImageData(w, h), d = img.data;
  for (let i = 0; i < w * h * 4; i++) d[i] = Math.round(clamp(px[i], 0, 1) * 255);
  x.putImageData(img, 0, 0);
  return c;
}

/* ── 换掉目前这份文件（一步历史；原码＝开一份新文件 s.add_document） ── */
function replaceDoc(w, h, layers){
  History.push();
  Doc.width = w; Doc.height = h; Doc.layers = layers; Doc.sel = null; Doc.selectedIds = null;
  Doc.activeId = layers.length ? layers[layers.length - 1].id : null;
  if (window.VecSel && VecSel.clear) try { VecSel.clear(); } catch (e){}
  layers.forEach(L => Layer.invalidate(L));
  if (window.UI){ UI.fit(); UI.refresh(); }
  if (window.HandView) HandView.reset();
}
let _mseq = 0;
/* 蒙版（engine 与 ps-layer.js 同一格式）：文件大小的画布，白＋alpha＝露出多少 */
const maskObj = c => ({id:'Mpa' + (++_mseq), kind:'raster', name:'mask', visible:true, opacity:1, blend:'normal', mask:null, x:0, y:0, _cache:null, _cacheScale:0, data:{canvas:c, ctx:ctx2d(c)}});

/* ═══════════════════════════ 合并到 HDR Pro（hdr.rs） ═══════════════════════════ */
const hat = z => Math.max(z <= 127.5 ? z : 255 - z, 0);                 // hdr.rs:32
/* hdr.rs:39 estimate_exposures：按平均亮度排序，相邻两张在都曝光良好的像素上比线性亮度（中位数） */
function estimateExposures(imgs){
  const n = imgs.length;
  const mean = imgs.map(im => { let s = 0; const N = im.length / 4; for (let i = 0; i < N; i++) s += lumaOf(im, i * 4); return s / Math.max(N, 1); });
  const order = imgs.map((_, i) => i).sort((a, b) => mean[a] - mean[b]);
  const ex = new Array(n).fill(1);
  for (let k = 1; k < n; k++){
    const a = order[k - 1], b = order[k], A = imgs[a], B = imgs[b], N = A.length / 4, ratios = [];
    for (let i = 0; i < N; i += 7){
      const la = lumaOf(A, i * 4), lb = lumaOf(B, i * 4);
      if (la >= 0.08 && la < 0.92 && lb >= 0.08 && lb < 0.92) ratios.push(srgbToLinear(lb) / Math.max(srgbToLinear(la), 1e-6));
    }
    ratios.sort((x, y) => x - y);
    const r = ratios.length ? Math.max(ratios[ratios.length >> 1], 1) : 2;
    ex[b] = ex[a] * r;
  }
  return ex;
}
/* hdr.rs:66 shrink（2×2 平均） */
function shrink(w, h, g){
  const nw = Math.max(w >> 1, 1), nh = Math.max(h >> 1, 1), out = new Float32Array(nw * nh);
  const p = (x, y) => g[Math.min(y, h - 1) * w + Math.min(x, w - 1)];
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) out[y * nw + x] = 0.25 * (p(2 * x, 2 * y) + p(2 * x + 1, 2 * y) + p(2 * x, 2 * y + 1) + p(2 * x + 1, 2 * y + 1));
  return [nw, nh, out];
}
/* hdr.rs:78 bitmaps：中位数阈值图＋排除带（离中位数 > 4/255） */
function bitmaps(g){
  const s = Float32Array.from(g).sort(), med = s[s.length >> 1];
  const t = new Uint8Array(g.length), e = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++){ t[i] = g[i] > med ? 1 : 0; e[i] = Math.abs(g[i] - med) > 4 / 255 ? 1 : 0; }
  return [t, e];
}
/* hdr.rs:87 mtb_offset：金字塔由粗到细，每层在 ±1 里找 XOR 最少的位移 */
function mtbOffset(w, h, ref, img, levels){
  if (levels === 0 || w < 16 || h < 16) return [0, 0];
  const [sw, sh, sr] = shrink(w, h, ref), [, , si] = shrink(w, h, img);
  const [px, py] = mtbOffset(sw, sh, sr, si, levels - 1), curX = px * 2, curY = py * 2;
  const [tr, er] = bitmaps(ref), [ti, ei] = bitmaps(img);
  let best = [Infinity, 0, 0];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
    const ox = curX + dx, oy = curY + dy; let err = 0;
    for (let y = 0; y < h; y++){
      const sy = y - oy; if (sy < 0 || sy >= h) continue;
      for (let x = 0; x < w; x++){
        const sx = x - ox; if (sx < 0 || sx >= w) continue;
        const a = y * w + x, b = sy * w + sx;
        if (tr[a] !== ti[b] && er[a] && ei[b]) err++;
      }
    }
    if (err < best[0]) best = [err, ox, oy];
  }
  return [best[1], best[2]];
}
/* hdr.rs:134 sample_pixels：网格上取「中间曝光里邻域平坦」的像素，按亮度分 32 格轮流取 */
function samplePixels(w, h, middle, count){
  const byBin = Array.from({length:32}, () => []);
  const step = Math.max(Math.floor(Math.sqrt(Math.floor(w * h / Math.max(count * 40, 1)))), 1);
  for (let y = 2; y < h - 2; y += step) for (let x = 2; x < w - 2; x += step){
    const i = y * w + x, l = lumaOf(middle, i * 4);
    const flat = [i - 2, i + 2, i - 2 * w, i + 2 * w].every(j => Math.abs(lumaOf(middle, j * 4) - l) < 0.04);
    if (flat) byBin[Math.min(Math.floor(l * 31.99), 31)].push(i);
  }
  const out = []; let k = 0;
  while (out.length < count && byBin.some(b => k < b.length)){
    for (const b of byBin){
      if (k < b.length){ out.push(b[(k * 7) % Math.max(b.length, 1)]); if (out.length >= count) break; }
    }
    k++;
  }
  return [...new Set(out)].sort((a, b) => a - b);
}
/* hdr.rs:167 response_curve（Debevec–Malik）：g(Z) = ln E + ln Δt，加权最小二乘＋平滑项，g(128)=0；解不出就退回 sRGB 曲线；最后强制单调 */
function responseCurve(z, logDt, lambda){
  const P = z.length, n = P ? z[0].length : 0, ne = new Normal(256 + n);
  for (let j = 0; j < P; j++) for (let i = 0; i < n; i++){ const zz = z[j][i]; ne.add([[zz, 1], [256 + i, -1]], logDt[j], hat(zz) + 1); }
  ne.add([[128, 1]], 0, 100);
  for (let k = 1; k < 255; k++) ne.add([[k - 1, 1], [k, -2], [k + 1, 1]], 0, Math.sqrt(lambda) * (hat(k) + 1));
  const x = ne.solve();
  if (!x){ const r = Math.log(srgbToLinear(128 / 255)); return Float64Array.from({length:256}, (_, k) => Math.log(Math.max(srgbToLinear(k / 255), 1e-5)) - r); }
  const g = Float64Array.from(x.subarray(0, 256));
  for (let k = 127; k >= 0; k--) g[k] = Math.min(g[k], g[k + 1] - 1e-4);
  for (let k = 129; k < 256; k++) g[k] = Math.max(g[k], g[k - 1] + 1e-4);
  return g;
}
/* hdr.rs:199 g_at：0..255 上线性插值 */
function gAt(g, v){ const x = clamp(v, 0, 1) * 255, i = Math.min(Math.floor(x), 254), t = x - i; return g[i] * (1 - t) + g[i + 1] * t; }
/* hdr.rs:237 merge：帽形加权平均 g(Z) − ln Δt；去鬼影＝各曝光估的辐射差太大的地方只用基准那张（遮罩羽化）；最后按基准曝光的良好像素定比例 */
function hdrMerge(w, h, imgs, opts){
  const P = imgs.length, N = w * h, logDt = opts.exposures.map(e => Math.log(Math.max(e, 1e-12)));
  const well = im => { let c = 0; for (let i = 0; i < N; i += 3){ const l = lumaOf(im, i * 4); if (l >= 0.1 && l < 0.9) c++; } return c; };
  let base = (isNum(opts.ghostBase) && opts.ghostBase < P) ? opts.ghostBase : null;
  if (base === null){ base = 0; let bw = -1; for (let j = 0; j < P; j++){ const v = well(imgs[j]); if (v >= bw){ bw = v; base = j; } } }   // Rust max_by_key：同分取后面的
  let response = opts.response;
  if (!response){
    const order = imgs.map((_, i) => i).sort((a, b) => opts.exposures[a] - opts.exposures[b]), mid = order[P >> 1];
    const samples = samplePixels(w, h, imgs[mid], 160);
    response = [0, 1, 2].map(c => responseCurve(imgs.map(im => samples.map(i => Math.round(clamp(im[i * 4 + c], 0, 1) * 255))), logDt, 40));
  }
  const px = new Float32Array(N * 4);
  for (let i = 0; i < N; i++){
    let alpha = 0;
    for (let c = 0; c < 3; c++){
      let numr = 0, den = 0;
      for (let j = 0; j < P; j++){ const v = imgs[j][i * 4 + c], wt = hat(clamp(v, 0, 1) * 255); numr += wt * (gAt(response[c], v) - logDt[j]); den += wt; }
      let le;
      if (den > 1e-6) le = numr / den;
      else {
        // 每张都饱和：亮的取最暗那张、暗的取最亮那张
        let s = 0; for (let j = 0; j < P; j++) s += imgs[j][i * 4 + c];
        const bright = s / P > 0.5;
        let jj = 0; for (let j = 1; j < P; j++) if (bright ? logDt[j] < logDt[jj] : logDt[j] > logDt[jj]) jj = j;
        le = gAt(response[c], imgs[jj][i * 4 + c]) - logDt[jj];
      }
      px[i * 4 + c] = Math.exp(le);
    }
    for (let j = 0; j < P; j++) alpha = Math.max(alpha, imgs[j][i * 4 + 3]);
    px[i * 4 + 3] = alpha;
  }
  let ghostFraction = 0;
  if (opts.removeGhosts && P > 1){
    const ghost = new Float32Array(N);
    for (let i = 0; i < N; i++){
      let s = 0, s2 = 0, sw = 0;
      for (let j = 0; j < P; j++){
        const q = imgs[j], l = lumaOf(q, i * 4), wt = hat(l * 255); if (wt < 20) continue;
        let lr = 0; for (let c = 0; c < 3; c++) lr += 0.33 * (gAt(response[c], q[i * 4 + c]) - logDt[j]);
        s += wt * lr; s2 += wt * lr * lr; sw += wt;
      }
      if (sw <= 0) continue;
      const m = s / sw; ghost[i] = Math.sqrt(Math.max(s2 / sw - m * m, 0)) > 0.35 ? 1 : 0;
    }
    gaussBlurN(ghost, w, h, 1, Math.max(Math.max(w, h) / 200, 2));
    let cnt = 0; for (let i = 0; i < N; i++){ ghost[i] = Math.min(ghost[i] * 3, 1); if (ghost[i] > 0.5) cnt++; }
    ghostFraction = cnt / Math.max(N, 1);
    const ld = logDt[base], B = imgs[base];
    for (let i = 0; i < N; i++){
      if (ghost[i] <= 0) continue;
      for (let c = 0; c < 3; c++){ const e = Math.exp(gAt(response[c], B[i * 4 + c]) - ld); px[i * 4 + c] = px[i * 4 + c] * (1 - ghost[i]) + e * ghost[i]; }
    }
  }
  for (let c = 0; c < 3; c++){
    const r = [], B = imgs[base];
    for (let i = 0; i < N; i += 37){ const v = B[i * 4 + c]; if (v >= 0.15 && v < 0.85 && px[i * 4 + c] > 0) r.push(srgbToLinear(v) / (px[i * 4 + c] * opts.exposures[base])); }
    r.sort((a, b) => a - b);
    const k = (r.length ? r[r.length >> 1] : 1) * opts.exposures[base];
    for (let i = 0; i < N; i++) px[i * 4 + c] *= k;
  }
  const l = []; for (let i = 0; i < N; i += 13) if (px[i * 4 + 3] > 0) l.push(Math.max(lumaOf(px, i * 4), 1e-9));
  l.sort((a, b) => a - b);
  const stops = l.length ? Math.log2(l[Math.floor(l.length * 0.999) % l.length] / l[Math.floor(l.length / 100)]) : 0;
  return {px, response, ghostBase:base, ghostFraction, stops};
}
/* tone.rs:317 hdr_toning（局部适应：对数亮度拆底层＋细节，底层压缩、细节放大，再调阴影／高光／自然饱和度／饱和度） */
function hdrToning(px, w, h, p){
  const N = w * h; if (!N) return;
  const EPS = 1e-4, logl = new Float32Array(N);
  for (let i = 0; i < N; i++) logl[i] = Math.log(Math.max(lumaOf(px, i * 4), 0) + EPS);
  const base = Float32Array.from(logl); gaussBlurN(base, w, h, 1, Math.max(p.radius, 1) / 2);
  let n = 0, s = 0; for (let i = 0; i < N; i++) if (px[i * 4 + 3] > 0){ n++; s += base[i]; }
  const mean = s / Math.max(n, 1), compress = 1 / (1 + Math.max(p.strength, 0)), detail = 1 + p.detail / 100, exposure = Math.pow(2, p.exposure), gamma = clamp(p.gamma, 0.1, 4);
  for (let i = 0; i < N; i++){
    const j = i * 4; if (px[j + 3] <= 0) continue;
    const c0 = px[j], c1 = px[j + 1], c2 = px[j + 2], l0 = Math.max(0.2126 * c0 + 0.7152 * c1 + 0.0722 * c2, 0) + EPS;
    const nl = mean + (base[i] - mean) * compress + (logl[i] - base[i]) * detail;
    let l1 = Math.pow(Math.max(Math.exp(nl) * exposure, 0), gamma);
    l1 += p.shadow / 100 * Math.pow(1 - l1, 3) * 0.5 - p.highlight / 100 * Math.pow(l1, 3) * 0.5;
    l1 = clamp(l1, 0, 1);                                          // 曲线空 ⇒ curve_eval 原样
    const ratio = l1 / l0;
    let o0 = c0 * ratio, o1 = c1 * ratio, o2 = c2 * ratio;
    const ll = 0.2126 * o0 + 0.7152 * o1 + 0.0722 * o2, mx = Math.max(o0, o1, o2), mn = Math.min(o0, o1, o2), satNow = mx > 0 ? (mx - mn) / mx : 0;
    const sf = Math.max(1 + p.saturation / 100 + p.vibrance / 100 * (1 - satNow), 0);
    o0 = ll + (o0 - ll) * sf; o1 = ll + (o1 - ll) * sf; o2 = ll + (o2 - ll) * sf;
    px[j] = clamp(o0, 0, 1); px[j + 1] = clamp(o1, 0, 1); px[j + 2] = clamp(o2, 0, 1);
  }
}
/* hdr.rs:345 tone_map：线性辐射 → 显示编码（sRGB 曲线）0..1 */
function toneMap(px, w, h, m){
  const N = w * h; let n = 0, sl = 0;
  for (let i = 0; i < N; i++) if (px[i * 4 + 3] > 0){ n++; sl += Math.log(Math.max(lumaOf(px, i * 4), 1e-6)); }
  const logMean = Math.exp(sl / Math.max(n, 1));
  if (m.method === 'localAdaptation'){
    const k = 0.18 / Math.max(logMean, 1e-6);
    for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) px[i * 4 + c] *= k;
    hdrToning(px, w, h, m.toning);
    for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) px[i * 4 + c] = linearToSrgb(clamp(px[i * 4 + c], 0, 1));
  } else if (m.method === 'exposureGamma'){
    const k = Math.pow(2, m.exposure), g = clamp(m.gamma, 0.1, 10);
    for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.pow(linearToSrgb(clamp(px[i * 4 + c] * k, 0, 1)), 1 / g);
  } else if (m.method === 'highlightCompression'){
    const k = 0.18 / Math.max(logMean, 1e-6);
    for (let i = 0; i < N; i++){
      const l = lumaOf(px, i * 4) * k, ld = l / (1 + l), r = l > 1e-9 ? ld / l * k : 0;
      for (let c = 0; c < 3; c++) px[i * 4 + c] = linearToSrgb(clamp(px[i * 4 + c] * r, 0, 1));
    }
  } else if (m.method === 'equalizeHistogram'){
    const BINS = 1024, lv = new Float32Array(N);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < N; i++){ lv[i] = Math.log(Math.max(lumaOf(px, i * 4), 1e-7)); if (px[i * 4 + 3] > 0){ lo = Math.min(lo, lv[i]); hi = Math.max(hi, lv[i]); } }
    const span = Math.max(hi - lo, 1e-6), hist = new Float64Array(BINS);
    for (let i = 0; i < N; i++) if (px[i * 4 + 3] > 0) hist[Math.floor((lv[i] - lo) / span * (BINS - 1))] += 1;
    let total = 0; for (let b = 0; b < BINS; b++) total += hist[b]; total = Math.max(total, 1);
    const cdf = new Float32Array(BINS); let acc = 0; for (let b = 0; b < BINS; b++){ acc += hist[b]; cdf[b] = acc / total; }
    for (let i = 0; i < N; i++){
      const target = cdf[Math.floor(clamp((lv[i] - lo) / span, 0, 1) * (BINS - 1))], tl = srgbToLinear(target), l = Math.max(lumaOf(px, i * 4), 1e-7);
      for (let c = 0; c < 3; c++) px[i * 4 + c] = linearToSrgb(clamp(px[i * 4 + c] / l * tl, 0, 1));
    }
  }
}
/* photo_cmds.rs:553 shift_rgba（边缘夹住） */
function shiftRgba(px, w, h, dx, dy){
  const out = new Float32Array(px.length);
  for (let y = 0; y < h; y++){ const sy = clamp(y - dy, 0, h - 1); for (let x = 0; x < w; x++){ const sx = clamp(x - dx, 0, w - 1), s = (sy * w + sx) * 4, d = (y * w + x) * 4; out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3]; } }
  return out;
}
const HDR_METHODS = ['localAdaptation', 'exposureGamma', 'highlightCompression', 'equalizeHistogram'];
const HDR_DEFAULT = {align:true, removeGhosts:false, mode:'32', method:'localAdaptation', radius:7, strength:0.52, gamma:1, exposure:0, detail:30, shadow:0, highlight:0, vibrance:0, saturation:20};
/* photo_cmds.rs:648-680：参数 → 色调映射方法（夹在原码的范围里） */
function toneOf(p, cmd){
  const method = typeof p.method === 'string' ? p.method : 'localAdaptation';
  const f = (k, d) => num(p, k, d);
  if (method === 'localAdaptation') return {method, toning:{radius:clamp(f('radius', 7), 1, 500), strength:clamp(f('strength', 0.52), 0.1, 4), gamma:clamp(f('gamma', 1), 0.1, 2), exposure:clamp(f('exposure', 0), -5, 5),
    detail:clamp(f('detail', 30), -100, 300), shadow:clamp(f('shadow', 0), -100, 100), highlight:clamp(f('highlight', 0), -100, 100), vibrance:clamp(f('vibrance', 0), -100, 100), saturation:clamp(f('saturation', 20), -100, 100)}};
  if (method === 'exposureGamma') return {method, exposure:f('exposure', 0), gamma:f('gamma', 1)};
  if (method === 'highlightCompression' || method === 'equalizeHistogram') return {method};
  bad(cmd, `unknown method \`${method}\` (localAdaptation|exposureGamma|highlightCompression|equalizeHistogram)`);
}
const modeOf = p => p.mode === undefined || p.mode === null ? '32' : String(p.mode);
/* photo_cmds.rs:562 merge_to_hdr 的计算部分（不碰文件；对话框预览也用这条） */
function hdrCompute(srcs, p, cmd){
  if (srcs.length < 2) bad(cmd, 'Merge to HDR Pro needs two or more exposures');
  const w = srcs[0].w, h = srcs[0].h;
  if (srcs.some(s => s.w !== w || s.h !== h)) other('the exposures must have the same pixel dimensions');
  let imgs = srcs.map(s => s.px || floatOf(s.canvas));
  // 曝光：参数给的 EV、EXIF、或从图估
  let exposures, source;
  if (Array.isArray(p.exposures)){
    if (p.exposures.length !== srcs.length) bad(cmd, '`exposures` needs one EV value per image');
    exposures = p.exposures.map(v => Math.pow(2, isNum(+v) ? +v : 0)); source = 'params';
  } else {
    const ex = srcs.map(s => exposureFactor(s.exif));
    if (ex.every(v => v !== null)){ exposures = ex; source = 'exif'; }
    else { exposures = estimateExposures(imgs); source = 'estimated'; }
  }
  if (exposures.some(e => !(isFinite(e) && e > 0))) bad(cmd, 'exposures must be positive');
  // 对齐（Ward MTB）到中间那张曝光，在降采样的灰阶上
  const order = imgs.map((_, i) => i).sort((a, b) => exposures[a] - exposures[b]), mid = order[order.length >> 1];
  const offsets = srcs.map(() => [0, 0]);
  if (flag(p, 'align', true)){
    const k = Math.max(Math.ceil(Math.max(w, h) / 1536), 1), sw = Math.ceil(w / k), sh = Math.ceil(h / k);
    const grey = im => {
      const g = new Float32Array(sw * sh), c = new Float32Array(sw * sh);
      for (let i = 0; i < w * h; i++){ const j = Math.floor(Math.floor(i / w) / k) * sw + Math.floor((i % w) / k); g[j] += (54 * im[i * 4] + 183 * im[i * 4 + 1] + 19 * im[i * 4 + 2]) / 256; c[j] += 1; }
      for (let j = 0; j < g.length; j++) g[j] /= Math.max(c[j], 1);
      return g;
    };
    const gref = grey(imgs[mid]);
    for (let i = 0; i < srcs.length; i++){
      if (i === mid) continue;
      const [dx, dy] = mtbOffset(sw, sh, gref, grey(imgs[i]), 5);
      offsets[i] = [dx * k, dy * k];
      if (dx || dy) imgs[i] = shiftRgba(imgs[i], w, h, offsets[i][0], offsets[i][1]);
    }
  }
  let ghostBase = null;
  if (p.ghostBase !== undefined && p.ghostBase !== null){ ghostBase = Math.floor(+p.ghostBase); if (!(ghostBase >= 0 && ghostBase < srcs.length)) bad(cmd, '`ghostBase` is an image index'); }
  const merged = hdrMerge(w, h, imgs, {exposures, removeGhosts:flag(p, 'removeGhosts', false), ghostBase, response:null});
  const ev0 = exposures[order[0]];
  return {w, h, merged, exposures, source, offsets, ev:exposures.map(e => Math.log2(e / ev0))};
}
/* 合并后的辐射图 → 显示用的 8 位 RGBA（32 位＝曝光 0 的样子；16/8 位＝色调映射） */
function hdrRender(merged, w, h, p, cmd){
  const mode = modeOf(p);
  const px = Float32Array.from(merged.px);
  if (mode === '32'){ for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) px[i * 4 + c] = linearToSrgb(clamp(px[i * 4 + c], 0, 1)); }
  else if (mode === '16' || mode === '8') toneMap(px, w, h, toneOf(p, cmd));
  else bad(cmd, `\`mode\` must be 32|16|8, not ${mode}`);
  for (let i = 0; i < w * h; i++) px[i * 4 + 3] = 1;
  return px;
}
async function mergeToHdr(p){
  const cmd = 'file.automate.mergeToHdrPro', t0 = now();
  const mode = modeOf(p); if (!['32', '16', '8'].includes(mode)) bad(cmd, `\`mode\` must be 32|16|8, not ${mode}`);
  toneOf(p, cmd);                                                   // 先验参数（别算了半天才报错）
  const srcs = await loadSources(p, cmd);
  const r = hdrCompute(srcs, p, cmd);
  const out = hdrRender(r.merged, r.w, r.h, p, cmd);
  const L = Layer.raster(Lang.t('layer.bg'), r.w, r.h);
  L.data.ctx.drawImage(canvasOfFloat(out, r.w, r.h), 0, 0);
  replaceDoc(r.w, r.h, [L]);
  return {ok:true, document:L.id, width:r.w, height:r.h, mode, exposureSource:r.source, ev:r.ev, offsets:r.offsets,
          ghostBase:r.merged.ghostBase, ghostFraction:r.merged.ghostFraction, stops:r.merged.stops, ms:now() - t0};
}

/* ═══════════════════════════ Photomerge（photo_cmds.rs 395） ═══════════════════════════ */
const LAYOUTS = ['auto', 'perspective', 'cylindrical', 'spherical', 'collage', 'reposition'];
const Rc = {
  w: r => r[2] - r[0], h: r => r[3] - r[1],
  inter(a, b){ if (!a || !b) return null; const r = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]; return (r[2] > r[0] && r[3] > r[1]) ? r : null; },
};
/* Surface 替身 {r:[x0,y0,x1,y1], px}（同 ps-edit.js align 的格式） */
function readRegion(S, r){
  const w = Rc.w(r), h = Rc.h(r), out = new Float32Array(w * h * 4);
  const lr = Rc.inter(S.r, r); if (!lr) return out;
  const sw = Rc.w(S.r), lw = Rc.w(lr);
  for (let y = lr[1]; y < lr[3]; y++){ const so = ((y - S.r[1]) * sw + (lr[0] - S.r[0])) * 4; out.set(S.px.subarray(so, so + lw * 4), ((y - r[1]) * w + (lr[0] - r[0])) * 4); }
  return out;
}
function contentBounds(S){
  const w = Rc.w(S.r), h = Rc.h(S.r); let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (S.px[(y * w + x) * 4 + 3] > 0){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  return x1 < 0 ? null : [S.r[0] + x0, S.r[1] + y0, S.r[0] + x1 + 1, S.r[1] + y1 + 1];
}
/* photo_cmds.rs:176 roi_of：颜色三通道＋覆盖度 */
function roiOf(S, area){
  const raw = readRegion(S, area), w = Rc.w(area), h = Rc.h(area), px = new Float32Array(w * h * 3), alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++){ px[i * 3] = raw[i * 4]; px[i * 3 + 1] = raw[i * 4 + 1]; px[i * 3 + 2] = raw[i * 4 + 2]; alpha[i] = raw[i * 4 + 3]; }
  return {x0:area[0], y0:area[1], w, h, ch:3, px, alpha};
}
const roiAt = (im, x, y) => { const lx = x - im.x0, ly = y - im.y0; return (lx >= 0 && ly >= 0 && lx < im.w && ly < im.h) ? ly * im.w + lx : -1; };   // panorama.rs:740
/* photo_cmds.rs:159 warp_placed／168 plane_matrix */
function warpPlaced(A, S, rect, pl, offset){
  pl = A.Pl.translated(pl, offset[0], offset[1]);
  if (pl.projection === 'plane' && pl.k1 === 0) return A.warpSurface(S, rect, A.Hm.mul(pl.h, [1, 0, -pl.center[0], 0, 1, -pl.center[1], 0, 0, 1]), 'bicubic');
  return A.warpMeshSurface(S, rect, (x, y) => A.Pl.forward(pl, x, y), 'bicubic');
}
/* photo_cmds.rs:378 seam_order：参考图先，其余照中心离参考中心的距离 */
function seamOrder(warped, reference){
  const centre = S => { const b = contentBounds(S) || [0, 0, 0, 0]; return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
  const rc = centre(warped[Math.min(reference, warped.length - 1)]);
  const d = warped.map(S => { const c = centre(S); return Math.hypot(c[0] - rc[0], c[1] - rc[1]); });
  return warped.map((_, i) => i).sort((a, b) => ((a !== reference) - (b !== reference)) || (d[a] - d[b]) || (a - b));
}
/* panorama.rs:775 photometric：重叠区抽样，联立解每张的增益（log，每通道）与共用的晕影 a·r² + b·r⁴ */
function photometric(A, imgs, geo, gain, vignette){
  vignette = vignette && !!geo;
  const n = imgs.length, ch = n ? imgs[0].ch : 1;
  const identity = () => ({gains:imgs.map(() => new Array(ch).fill(1)), vignette:[0, 0]});
  if (!n || (!gain && !vignette)) return identity();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const im of imgs){ x0 = Math.min(x0, im.x0); y0 = Math.min(y0, im.y0); x1 = Math.max(x1, im.x0 + im.w); y1 = Math.max(y1, im.y0 + im.h); }
  const step = Math.ceil(Math.sqrt(Math.max(Math.floor((x1 - x0) * (y1 - y0) / 40000), 1)));
  const r2Of = (i, u, v) => {
    if (!geo) return 0;
    const q = A.Pl.inverse(geo.pl[i], u + 0.5, v + 0.5); if (!q) return null;
    const w = geo.sizes[i][0], h = geo.sizes[i][1], dx = q[0] - w / 2, dy = q[1] - h / 2;
    return (dx * dx + dy * dy) / (w * w / 4 + h * h / 4);
  };
  const samples = [];
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step){
    const cover = [];
    for (let i = 0; i < n; i++){ const k = roiAt(imgs[i], x, y); if (k >= 0 && imgs[i].alpha[k] > 0.999) cover.push([i, k]); }
    for (let pi = 0; pi < cover.length; pi++) for (let qi = pi + 1; qi < cover.length; qi++){
      const [a, ka] = cover[pi], [b, kb] = cover[qi];
      const ca = Array.from(imgs[a].px.subarray(ka * ch, ka * ch + ch)), cb = Array.from(imgs[b].px.subarray(kb * ch, kb * ch + ch));
      if (ca.concat(cb).some(v => !(v >= 0.02 && v <= 0.98))) continue;
      if (ca.some((v, c) => Math.abs(Math.log(v / cb[c])) > 1)) continue;   // 内容对不上（视差、移动物）不能拿来估曝光
      const ra = r2Of(a, x, y), rb = r2Of(b, x, y); if (ra === null || rb === null) continue;
      samples.push([a, b, ca, cb, ra, rb]);
    }
  }
  if (samples.length < 20) return identity();
  const sigmaN = 0.05, sigmaG = gain ? 0.15 : 1e-4, out = identity(), nv = vignette ? 2 : 0;
  const ne = new Normal(n + nv);
  for (const [a, b, ca, cb, ra, rb] of samples){
    const la = ca.reduce((s, v) => s + Math.log(v), 0) / ch, lb = cb.reduce((s, v) => s + Math.log(v), 0) / ch;
    const row = [[a, 1], [b, -1]];
    if (vignette){ row.push([n, ra - rb]); row.push([n + 1, ra * ra - rb * rb]); }
    ne.add(row, la - lb, 1 / sigmaN);
  }
  for (let i = 0; i < n; i++) ne.add([[i, 1]], 0, 1 / sigmaG);
  if (vignette){ ne.add([[n, 1]], 0, 0.5); ne.add([[n + 1, 1]], 0, 0.5); }
  const sol = ne.solve(); if (!sol) return out;
  if (vignette) out.vignette = [clamp(sol[n], -2, 0.5), clamp(sol[n + 1], -2, 2)];   // 晕影只会变暗：夹住往亮的失控解
  if (gain){
    for (let c = 0; c < ch; c++){
      const ng = new Normal(n);
      for (const [a, b, ca, cb, ra, rb] of samples){
        const va = out.vignette[0] * ra + out.vignette[1] * ra * ra, vb = out.vignette[0] * rb + out.vignette[1] * rb * rb;
        ng.add([[a, 1], [b, -1]], (Math.log(ca[c]) - va) - (Math.log(cb[c]) - vb), 1 / sigmaN);
      }
      for (let i = 0; i < n; i++) ng.add([[i, 1]], 0, 1 / sigmaG);
      const g = ng.solve();
      if (g) for (let i = 0; i < n; i++) out.gains[i][c] = clamp(Math.exp(g[i]), 0.2, 5);
    }
  }
  return out;
}
const photoFactor = (ph, i, c, r2) => 1 / (ph.gains[i][c] * Math.exp(ph.vignette[0] * r2 + ph.vignette[1] * r2 * r2));   // panorama.rs:766
/* photo_cmds.rs:205 seam_blend（Photomerge 用法：增益＋可选晕影）→ 每张：接缝内换成混合色的像素＋接缝遮罩；以及合成图 */
function seamBlend(A, warped, canvas, order, seamless, gains, geometry){
  const n = warped.length;
  const rois = warped.map(S => { const b = Rc.inter(contentBounds(S), canvas); return b ? roiOf(S, b) : {x0:0, y0:0, w:0, h:0, ch:3, px:new Float32Array(0), alpha:new Float32Array(0)}; });
  const geo = geometry ? {pl:geometry.pl.map(p => A.Pl.translated(p, geometry.offset[0], geometry.offset[1])), sizes:geometry.sizes} : null;
  const photo = photometric(A, rois, geo, seamless && gains, !!geo);
  const vig = photo.vignette[0] !== 0 || photo.vignette[1] !== 0;
  rois.forEach((roi, i) => {
    if (photo.gains[i].every(g => Math.abs(g - 1) < 1e-6) && !vig) return;
    for (let y = 0; y < roi.h; y++) for (let x = 0; x < roi.w; x++){
      let r2 = 0;
      if (vig && geo){
        const q = A.Pl.inverse(geo.pl[i], roi.x0 + x + 0.5, roi.y0 + y + 0.5);
        if (q){ const w = geo.sizes[i][0], h = geo.sizes[i][1], dx = q[0] - w / 2, dy = q[1] - h / 2; r2 = (dx * dx + dy * dy) / (w * w / 4 + h * h / 4); }
      }
      const k = y * roi.w + x;
      for (let c = 0; c < roi.ch; c++) roi.px[k * roi.ch + c] = clamp(roi.px[k * roi.ch + c] * photoFactor(photo, i, c, r2), 0, 1);
    }
  });
  // 接缝在 ≤ 1000 px 的格子上找
  const cw = Math.max(Rc.w(canvas), 1), chh = Math.max(Rc.h(canvas), 1);
  const s = Math.max(Math.ceil(Math.max(cw, chh) / 1000), 1), gw = Math.ceil(cw / s), gh = Math.ceil(chh / s);
  const luma = [], cover = [];
  rois.forEach(roi => {
    const a0 = new Float64Array(gw * gh), a1 = new Float64Array(gw * gh), a2 = new Uint32Array(gw * gh);
    for (let y = 0; y < roi.h; y++) for (let x = 0; x < roi.w; x++){
      const u = roi.x0 - canvas[0] + x, v = roi.y0 - canvas[1] + y, g = Math.min(Math.floor(v / s), gh - 1) * gw + Math.min(Math.floor(u / s), gw - 1), k = y * roi.w + x;
      let l = 0; for (let c = 0; c < roi.ch; c++) l += roi.px[k * roi.ch + c];
      a0[g] += l / roi.ch; a1[g] += roi.alpha[k]; a2[g]++;
    }
    const lu = new Float32Array(gw * gh), cv = new Uint8Array(gw * gh);
    for (let g = 0; g < gw * gh; g++) if (a2[g] > 0){ lu[g] = a0[g] / a2[g]; cv[g] = a1[g] / (s * s) > 0.98 ? 1 : 0; }
    luma.push(lu); cover.push(cv);
  });
  const labels = A.seamLabels(gw, gh, luma, cover, order);
  const rank = new Array(n).fill(Infinity); order.forEach((i, k) => { rank[i] = k; });
  const alphaAt = (j, x, y) => { const k = roiAt(rois[j], x, y); return k < 0 ? 0 : rois[j].alpha[k]; };
  const weights = rois.map((roi, i) => {
    const wt = new Float32Array(roi.w * roi.h);
    for (let k = 0; k < roi.w * roi.h; k++){
      if (roi.alpha[k] < 0.5) continue;
      const x = roi.x0 + k % roi.w, y = roi.y0 + Math.floor(k / roi.w), u = x - canvas[0], v = y - canvas[1];
      const lab = labels[Math.min(Math.floor(v / s), gh - 1) * gw + Math.min(Math.floor(u / s), gw - 1)];
      if (lab === i){ wt[k] = 1; continue; }
      if (lab >= 0 && alphaAt(lab, x, y) >= 0.5) continue;
      let first = -1; for (let j = 0; j < n; j++) if (alphaAt(j, x, y) >= 0.5 && (first < 0 || rank[j] < rank[first])) first = j;   // 退回 order 里最早覆盖的那张
      if (first === i) wt[k] = 1;
    }
    return wt;
  });
  const local = rois.map(r => Object.assign({}, r, {x0:r.x0 - canvas[0], y0:r.y0 - canvas[1]}));
  let levels = 1; if (seamless){ let q = Math.min(cw, chh); levels = 1; while (q > 16 && levels < 7){ q = Math.floor(q / 2); levels++; } }   // panorama.rs:989 blend_levels
  const [blend, cov] = A.multiband(cw, chh, local, weights, levels);
  const composite = new Float32Array(cw * chh * 4);
  for (let i = 0; i < cw * chh; i++){ for (let c = 0; c < 3; c++) composite[i * 4 + c] = clamp(blend[i * 3 + c], 0, 1); composite[i * 4 + 3] = cov[i]; }
  // 每张的像素：接缝内（权重 > 0.5）换成混合色；遮罩＝权重
  const layers = rois.map((roi, i) => {
    const px = new Float32Array(roi.w * roi.h * 4), wt = weights[i];
    for (let k = 0; k < roi.w * roi.h; k++){
      const u = roi.x0 - canvas[0] + k % roi.w, v = roi.y0 - canvas[1] + Math.floor(k / roi.w), g = v * cw + u, inside = wt[k] > 0.5;
      for (let c = 0; c < 3; c++) px[k * 4 + c] = inside && seamless ? clamp(blend[g * 3 + c], 0, 1) : roi.px[k * 3 + c];
      px[k * 4 + 3] = roi.alpha[k];
    }
    return {roi, px, mask:wt};
  });
  return {layers, composite, gains:photo.gains, vignette:photo.vignette};
}
/* photo_cmds.rs:490 content_aware_fill：合成图外框里的透明处用内容识别填（大图先缩） */
function contentAwareFill(comp, cw, ch){
  const k = Math.max(Math.ceil(Math.sqrt(cw * ch / 3e5)), 1);          // 原码 1.5e6；浏览器里 PatchMatch 慢 ⇒ 缩到 ≤ 30 万像素再填
  const sw = Math.ceil(cw / k), sh = Math.ceil(ch / k);
  const small = new Float32Array(sw * sh * 3), hole = new Uint8Array(sw * sh), accA = new Float32Array(sw * sh), cnt = new Float32Array(sw * sh);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++){
    const i = Math.floor(y / k) * sw + Math.floor(x / k), o = (y * cw + x) * 4, a = comp[o + 3];
    for (let c = 0; c < 3; c++) small[i * 3 + c] += comp[o + c] * a;
    accA[i] += a; cnt[i] += 1;
  }
  for (let i = 0; i < sw * sh; i++){ const a = accA[i]; for (let c = 0; c < 3; c++) small[i * 3 + c] = a > 0 ? small[i * 3 + c] / a : 0; hole[i] = a / Math.max(cnt[i], 1) < 0.99 ? 1 : 0; }
  const source = new Uint8Array(sw * sh); for (let i = 0; i < sw * sh; i++) source[i] = hole[i] ? 0 : 1;
  const PA = window.PsEdit && PsEdit._algo;
  let filled = null;
  if (PA && PA.caFill) try { filled = PA.caFill(sw, sh, 3, small, hole, source, {colorAdaptation:0.35, rotations:[], scale:false, mirror:false, seed:1}); } catch (e){ console.error(e); }
  if (!filled && PA && PA.membraneFill) filled = PA.membraneFill(sw, sh, 3, small, hole);
  if (!filled) filled = small;
  const out = new Float32Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++){
    const o = (y * cw + x) * 4, a = comp[o + 3];
    const fx = clamp((x + 0.5) / k - 0.5, 0, sw - 1), fy = clamp((y + 0.5) / k - 0.5, 0, sh - 1), xi = Math.floor(fx), yi = Math.floor(fy), x2 = Math.min(xi + 1, sw - 1), y2 = Math.min(yi + 1, sh - 1), tx = fx - xi, ty = fy - yi;
    for (let c = 0; c < 3; c++){
      const at = (xx, yy) => filled[(yy * sw + xx) * 3 + c];
      const fv = (at(xi, yi) * (1 - tx) + at(x2, yi) * tx) * (1 - ty) + (at(xi, y2) * (1 - tx) + at(x2, y2) * tx) * ty;
      out[o + c] = comp[o + c] * a + fv * (1 - a);
    }
    out[o + 3] = 1;
  }
  return out;
}
const MAX_PANO_PX = 4e7;                                             // 原码 6e8；浏览器记忆体撑不住 ⇒ 4000 万像素
async function photomerge(p){
  const cmd = 'file.automate.photomerge', t0 = now(), A = ALG();
  if (!A) other('Photomerge needs menus/impl/ps-edit.js (PsEdit._alignAlgo) loaded');
  const layout = typeof p.layout === 'string' ? p.layout : 'auto';
  if (!LAYOUTS.includes(layout)) bad(cmd, `unknown layout \`${layout}\` (auto|perspective|cylindrical|spherical|collage|reposition)`);
  const blend = flag(p, 'blend', true), vignette = flag(p, 'vignetteRemoval', false), geometric = flag(p, 'geometricCorrection', false), fill = flag(p, 'contentAwareFill', false);
  const srcs = await loadSources(p, cmd);
  if (srcs.length < 2) bad(cmd, 'Photomerge needs two or more images');
  // 35mm 等效焦距：参数 ＞ EXIF 中位数
  let focal35 = num(p, 'focalLength', 0) > 0 ? num(p, 'focalLength', 0) : null;
  if (focal35 === null){ const f = srcs.map(s => s.exif && s.exif.focalLength35).filter(isNum).sort((a, b) => a - b); if (f.length) focal35 = f[f.length >> 1]; }
  const surfs = srcs.map(s => ({r:[0, 0, s.w, s.h], px:floatOf(s.canvas)}));
  const al = A.register(surfs.map(S => [S, S.r]), layout, null, geometric, focal35);
  if (!al) other("Photomerge couldn't find enough matching detail between the images");
  const tReg = now();
  const placed = srcs.map((_, i) => i).filter(i => al.placements[i]);
  const failed = srcs.map((_, i) => i).filter(i => !al.placements[i]).map(i => srcs[i].name);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of placed){ const b = A.Pl.bounds(al.placements[i], srcs[i].w, srcs[i].h); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
  const cw = Math.ceil(x1 - x0), ch = Math.ceil(y1 - y0);
  if (!(isFinite(cw) && isFinite(ch)) || cw > 30000 || ch > 30000 || cw * ch > MAX_PANO_PX) other(`the panorama would be ${cw}×${ch} px; try another layout`);
  const canvas = [0, 0, cw, ch], offset = [-Math.floor(x0), -Math.floor(y0)];
  const warped = placed.map(i => warpPlaced(A, surfs[i], surfs[i].r, al.placements[i], offset));
  const tWarp = now();
  const layers = [];
  let info = {};
  const refPos = Math.max(placed.indexOf(al.reference), 0);
  if (blend){
    const order = seamOrder(warped, refPos);
    const geometry = vignette ? {pl:placed.map(i => al.placements[i]), sizes:placed.map(i => [srcs[i].w, srcs[i].h]), offset} : null;
    const b = seamBlend(A, warped, canvas, order, true, true, geometry);
    b.layers.forEach(({roi, px, mask}, k) => {
      const L = Layer.raster(srcs[placed[k]].name, cw, ch);
      if (roi.w && roi.h) L.data.ctx.drawImage(canvasOfFloat(px, roi.w, roi.h), roi.x0, roi.y0);
      // 蒙版：全藏，接缝区写权重（LayerMask::hide_all＋surface＝mask）
      const mc = mkCanvas(cw, ch), mx = ctx2d(mc);
      if (roi.w && roi.h){ const img = mx.createImageData(roi.w, roi.h), d = img.data; for (let i = 0; i < roi.w * roi.h; i++){ d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = Math.round(clamp(mask[i], 0, 1) * 255); } mx.putImageData(img, roi.x0, roi.y0); }
      L.mask = maskObj(mc);
      layers.push(L);
    });
    info = {gains:b.gains, vignette:b.vignette};
    if (fill){
      const filled = contentAwareFill(b.composite, cw, ch);
      const F = Layer.raster(L3('內容感知填色', '内容识别填充', 'Content-Aware Fill'), cw, ch);
      F.data.ctx.drawImage(canvasOfFloat(filled, cw, ch), 0, 0);
      layers.push(F);
    }
  } else {
    warped.forEach((S, k) => {
      const L = Layer.raster(srcs[placed[k]].name, cw, ch), r = Rc.inter(S.r, canvas);
      if (r) L.data.ctx.drawImage(canvasOfFloat(readRegion(S, r), Rc.w(r), Rc.h(r)), r[0], r[1]);
      layers.push(L);
    });
  }
  replaceDoc(cw, ch, layers);
  const side = Math.max(1, ...srcs.map(s => Math.max(s.w, s.h)));
  return {ok:true, layout:al.layout, reference:srcs[al.reference] ? srcs[al.reference].name : null, focalLength35:al.focal / side * 36, geometricK1:al.k1 || 0, rms:al.rms,
          pairs:al.pairs, placed:placed.map(i => srcs[i].name), failed, width:cw, height:ch, layers:layers.map(L => L.id), photometric:info,
          ms:{register:tReg - t0, warp:tWarp - tReg, total:now() - t0}};
}

/* ═══════════════════════════ 镜头校正（批次）（lens_cmds.rs:352 lens_batch） ═══════════════════════════ */
const LENS_KEYS = ['profile', 'focalLength', 'correctDistortion', 'correctVignette', 'correctCA', 'autoScale', 'distortion', 'redCyan', 'blueYellow', 'vignetteAmount', 'vignetteMidpoint', 'vertical', 'horizontal', 'angle', 'scale', 'edge', 'straighten'];
const LENS_FORMATS = ['same', 'png', 'jpg', 'webp', 'tif'];
/* 在一份暂时的文件上跑「滤镜 ▸ 镜头校正」：目前这份原封不动（不进历史、不报改动） */
function lensOnCanvas(c, params){
  if (!window.PsFilter || !PsFilter.run) other('Lens Correction needs menus/impl/ps-filter.js loaded');
  const keep = {w:Doc.width, h:Doc.height, layers:Doc.layers, activeId:Doc.activeId, sel:Doc.sel, selectedIds:Doc.selectedIds};
  try {
    Doc.width = c.width; Doc.height = c.height; Doc.sel = null; Doc.selectedIds = null;
    const L = Layer.raster('Background', c.width, c.height); L.data.ctx.drawImage(c, 0, 0);
    Doc.layers = [L]; Doc.activeId = L.id;
    const r = PsFilter.run('filter.lensCorrection', params);
    if (r && r.ok === false) throw new AutoBad(r.error || 'lens correction failed');
    const out = mkCanvas(c.width, c.height); ctx2d(out).drawImage(L.data.canvas, L.x || 0, L.y || 0);
    return {canvas:out, result:r};
  } finally {
    Doc.width = keep.w; Doc.height = keep.h; Doc.layers = keep.layers; Doc.activeId = keep.activeId; Doc.sel = keep.sel; Doc.selectedIds = keep.selectedIds;
  }
}
async function lensBatch(p){
  const cmd = 'file.automate.lensCorrection';
  const format = String(p.format || 'same').toLowerCase().replace('jpeg', 'jpg').replace('tiff', 'tif');
  if (!LENS_FORMATS.includes(format)) bad(cmd, '`format` is same|png|jpg|webp|tif');
  const output = String(p.output === undefined || p.output === null ? 'corrected' : p.output).replace(/[\\/]+$/, '');
  const params = {}; LENS_KEYS.forEach(k => { if (p[k] !== undefined) params[k] = p[k]; });
  if (params.profile === undefined) params.profile = 'auto';           // 批次缺省：照 EXIF 配描述档（同 PS 对话框）
  const q = num(p, 'quality', 10);
  const items = [];
  if (p.useOpenDocuments === true || (Array.isArray(p.layers) && p.layers.length))
    for (const id of sourceLayerIds(p)){ const L = Doc.byId(id); items.push({name:L.name + '.png', layer:L}); }
  inputList(p).forEach(it => items.push(it));
  if (!items.length) bad(cmd, 'pass "files"/"urls"/"fileIds" or "useOpenDocuments": true (or "layers")');
  const files = [], errors = [];
  for (const it of items){
    try {
      let c, exif = {};
      if (it.layer) c = layerCanvas(it.layer);
      else {
        const r = await bytesAndBitmap(it.kind === 'fid' ? await resolveFileId(it.id) : it.src);
        c = mkCanvas(r.bm.width, r.bm.height); ctx2d(c).drawImage(r.bm, 0, 0); if (r.bm.close) r.bm.close(); exif = readExif(r.bytes);
      }
      const pp = Object.assign({}, params);
      // profile:auto：原码看 EXIF 的 35mm 等效焦距配描述档；我们的滤镜读不到 EXIF ⇒ 这里先读出来当 focalLength 给它
      if (pp.profile === 'auto' && !(num(pp, 'focalLength', 0) > 0) && isNum(exif.focalLength35)) pp.focalLength = exif.focalLength35;
      const {canvas:out} = lensOnCanvas(c, pp);
      let fmt = format;
      if (fmt === 'same'){ const e = extOf(it.name); fmt = e === 'jpg' || e === 'jpeg' ? 'jpg' : e === 'webp' ? 'webp' : e === 'tif' || e === 'tiff' ? 'tif' : 'png'; }
      const enc = window.PsFile && PsFile.encodeAs ? await PsFile.encodeAs(out, fmt, {quality:fmt === 'jpg' ? clamp(q, 0, 12) / 12 : undefined})
        : {blob:await new Promise(res => out.toBlob(res, 'image/png')), ext:'png'};
      const name = (output ? output + '/' : '') + stem(it.name) + '.' + enc.ext;
      const r = await CMD.run('file.exportData', {name, data:enc.blob, mime:enc.blob.type});
      if (r && r.ok === false) throw new Error(r.error || 'export failed');
      files.push(name);
    } catch (e){ errors.push({file:it.name, error:String(e && e.message || e)}); }
  }
  return {ok:true, files, errors};
}

/* ═══════════════════════════ 对话框（版面照 PS 2020） ═══════════════════════════ */
function ensureStyle(){
  if (document.getElementById('psa-style')) return;
  const st = document.createElement('style'); st.id = 'psa-style';
  st.textContent = `
.psa-bg{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:10000;display:flex;align-items:center;justify-content:center}
.psa-dlg{background:#3c3c3c;color:#ddd;font:12px sans-serif;border:1px solid #222;border-radius:4px;box-shadow:0 8px 30px rgba(0,0,0,.5);padding:12px 14px;min-width:420px;max-width:92vw;max-height:90vh;overflow:auto}
.psa-dlg h3{margin:0 0 10px;font-size:13px;font-weight:600;color:#eee}
.psa-row{display:flex;gap:14px}
.psa-col{display:flex;flex-direction:column;gap:6px}
.psa-grp{border:1px solid #555;border-radius:3px;padding:8px 10px;margin:0 0 8px}
.psa-grp>legend{padding:0 4px;color:#bbb}
.psa-dlg label{display:flex;align-items:center;gap:6px;margin:2px 0}
.psa-dlg select,.psa-dlg input[type=number],.psa-dlg input[type=text]{background:#2b2b2b;color:#eee;border:1px solid #555;border-radius:2px;padding:2px 4px;font:12px sans-serif}
.psa-dlg input[type=number]{width:64px}
.psa-dlg input[type=range]{width:150px}
.psa-list{background:#2b2b2b;border:1px solid #555;min-height:110px;max-height:170px;overflow:auto;width:300px}
.psa-list div{padding:2px 6px;cursor:default;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.psa-list div.on{background:#4a6a9a;color:#fff}
.psa-btns{display:flex;flex-direction:column;gap:6px}
.psa-dlg button{background:#535353;color:#eee;border:1px solid #2a2a2a;border-radius:3px;padding:4px 12px;font:12px sans-serif;cursor:pointer;min-width:84px}
.psa-dlg button.pri{background:#2f6fd6;border-color:#1d4fa0}
.psa-dlg button:disabled{opacity:.5;cursor:default}
.psa-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
.psa-lay{display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:3px;cursor:pointer}
.psa-lay.on{background:#4a4a4a;outline:1px solid #777}
.psa-lay svg{width:46px;height:30px;flex:none}
.psa-prev{background:repeating-conic-gradient(#555 0 25%,#666 0 50%) 0 0/16px 16px;display:block;max-width:520px;max-height:360px}
.psa-thumbs{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}
.psa-thumbs div{display:flex;flex-direction:column;align-items:center;gap:2px;padding:3px;border:2px solid transparent;border-radius:3px;cursor:pointer}
.psa-thumbs div.base{border-color:#3c9a3c}
.psa-thumbs canvas{width:72px;height:auto}
.psa-busy{color:#9cf;margin-left:8px}
.psa-hide{display:none!important}`;
  document.head.appendChild(st);
}
const Dlg = {
  cur:null,
  open(id, title, build){
    this.close(); ensureStyle();
    const bg = document.createElement('div'); bg.className = 'psa-bg';
    const box = document.createElement('div'); box.className = 'psa-dlg'; box.id = 'psaDlg'; box.dataset.cmd = id;
    const h = document.createElement('h3'); h.textContent = T3(title); box.appendChild(h);
    bg.appendChild(box); document.body.appendChild(bg);
    this.cur = {id, bg, box, vals:{}};
    build(box, this.cur);
    return this.cur;
  },
  close(){ const c = this.cur; if (!c) return; c.bg.remove(); this.cur = null; }
};
window.addEventListener('keydown', e => {
  const c = Dlg.cur; if (!c) return;
  if (e.key === 'Escape'){ Dlg.close(); e.preventDefault(); e.stopPropagation(); return; }
  if (!c.box.contains(e.target)){ e.preventDefault(); e.stopPropagation(); }
}, true);
const el = (tag, attrs, kids) => { const e = document.createElement(tag); if (attrs) for (const k in attrs){ if (k === 'text') e.textContent = attrs[k]; else if (k === 'cls') e.className = attrs[k]; else if (k.startsWith('on')) e[k] = attrs[k]; else if (k === 'data') Object.assign(e.dataset, attrs[k]); else e.setAttribute(k, attrs[k]); } (kids || []).forEach(k => k && e.appendChild(k)); return e; };
function group(title, kids){ const f = el('fieldset', {cls:'psa-grp'}, [el('legend', {text:T3(title)})]); kids.forEach(k => k && f.appendChild(k)); return f; }
function check(vals, k, label, value, onchange){
  vals[k] = !!value;
  const inp = el('input', {type:'checkbox', data:{k}}); inp.checked = !!value;
  inp.onchange = () => { vals[k] = inp.checked; if (onchange) onchange(); };
  return el('label', null, [inp, el('span', {text:T3(label)})]);
}
function select(vals, k, label, value, options, onchange){
  vals[k] = value;
  const s = el('select', {data:{k}});
  options.forEach(([v, t]) => { const o = el('option', {value:v, text:T3(t)}); if (v === value) o.selected = true; s.appendChild(o); });
  s.onchange = () => { vals[k] = s.value; if (onchange) onchange(); };
  return el('label', null, [el('span', {text:T3(label)}), s]);
}
function slider(vals, k, label, value, min, max, step, onchange){
  vals[k] = value;
  const r = el('input', {type:'range', min, max, step, value, data:{k:k + '_r'}}), n = el('input', {type:'number', min, max, step, value, data:{k}});
  const set = v => { v = clamp(+v, min, max); if (!isFinite(v)) return; vals[k] = v; r.value = v; n.value = v; if (onchange) onchange(); };
  r.oninput = () => set(r.value); n.onchange = () => set(n.value);
  const lab = el('label', null, [el('span', {text:T3(label), style:'min-width:72px'}), r, n]);
  lab._set = set;
  return lab;
}
function footer(box, okLabel, onOK){
  const busy = el('span', {cls:'psa-busy'});
  const cancel = el('button', {text:L3('取消', '取消', 'Cancel'), data:{act:'cancel'}, onclick:() => Dlg.close()});
  const ok = el('button', {cls:'pri', text:T3(okLabel || ['確定', '确定', 'OK']), data:{act:'ok'}});
  ok.onclick = async () => {
    ok.disabled = true; busy.textContent = L3('處理中…', '处理中…', 'Working…');
    await new Promise(r => setTimeout(r, 30));
    let r;
    try { r = await onOK(); }
    catch (e){ console.error(e); r = {ok:false, error:String(e && e.message || e)}; }
    ok.disabled = false; busy.textContent = '';
    if (r && r.ok === false){ if (!r.cancelled) toast(r.error || 'failed', true); return; }
    Dlg.close();
    if (window.UI) UI.refresh();
  };
  box.appendChild(el('div', {cls:'psa-foot'}, [busy, cancel, ok]));
  return ok;
}
/* 来源档案区（PS：使用 檔案／資料夾 ＋ 清单 ＋ 瀏覽…／移除／加入開啟的檔案）。清单项＝{file}（本机档）或 {layer:id}（目前文件的图层） */
function sourcePicker(state, onChange){
  state.items = state.items || [];
  const list = el('div', {cls:'psa-list', data:{list:'1'}});
  const multi = el('input', {type:'file', accept:'image/*', multiple:'', style:'display:none', data:{psaFiles:'1'}});
  const dir = el('input', {type:'file', multiple:'', style:'display:none', data:{psaFolder:'1'}}); dir.webkitdirectory = true;
  let use = 'files', sel = -1;
  const render = () => {
    list.innerHTML = '';
    state.items.forEach((it, i) => {
      const d = el('div', {text:it.file ? it.file.name : '◧ ' + (Doc.byId(it.layer) ? Doc.byId(it.layer).name : it.layer), data:{i:String(i)}});
      if (i === sel) d.className = 'on';
      d.onclick = () => { sel = i; render(); };
      list.appendChild(d);
    });
    if (onChange) onChange();
  };
  const addFiles = fl => { Array.from(fl || []).filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)$/i.test(f.name)).forEach(f => state.items.push({file:f})); render(); };
  multi.onchange = () => { addFiles(multi.files); multi.value = ''; };
  dir.onchange = () => { addFiles(Array.from(dir.files || []).sort((a, b) => a.name.localeCompare(b.name))); dir.value = ''; };
  const useSel = el('select', {data:{k:'use'}}, [el('option', {value:'files', text:L3('檔案', '文件', 'Files')}), el('option', {value:'folder', text:L3('資料夾', '文件夹', 'Folder')})]);
  useSel.onchange = () => { use = useSel.value; };
  const browse = el('button', {text:L3('瀏覽…', '浏览…', 'Browse…'), data:{act:'browse'}, onclick:() => { if (PsAutomate._pickHook){ addFiles(PsAutomate._pickHook(use)); return; } (use === 'folder' ? dir : multi).click(); }});
  const remove = el('button', {text:L3('移除', '移去', 'Remove'), data:{act:'remove'}, onclick:() => { if (sel >= 0){ state.items.splice(sel, 1); sel = Math.min(sel, state.items.length - 1); render(); } }});
  const addOpen = el('button', {text:L3('加入開啟的檔案', '添加打开的文件', 'Add Open Files'), data:{act:'addOpen'}, onclick:() => {
    const have = new Set(state.items.filter(i => i.layer).map(i => i.layer));
    sourceLayerIds({}).forEach(id => { if (!have.has(id)) state.items.push({layer:id}); }); render(); }});
  const wrap = el('div', null, [
    el('label', null, [el('span', {text:L3('使用：', '使用：', 'Use:')}), useSel]),
    el('div', {cls:'psa-row'}, [list, el('div', {cls:'psa-btns'}, [browse, remove, addOpen])]), multi, dir]);
  render();
  return wrap;
}
/* 清单 → 命令参数（本机档进 files、图层进 layers） */
function itemsToParams(items){
  const files = items.filter(i => i.file).map(i => i.file), layers = items.filter(i => i.layer).map(i => i.layer);
  const o = {}; if (layers.length) o.layers = layers; if (files.length) o.files = files; return o;
}

/* ── Photomerge 对话框：左＝版面（自动／透视／圆柱／球面／拼贴／重新定位），右＝来源档案；底下四个勾选 ── */
const LAYOUT_NAMES = {auto:['自動', '自动', 'Auto'], perspective:['透視', '透视', 'Perspective'], cylindrical:['圓筒', '圆柱', 'Cylindrical'], spherical:['球面', '球面', 'Spherical'], collage:['拼貼', '拼贴', 'Collage'], reposition:['重新定位', '调整位置', 'Reposition']};
const LAYOUT_ICON = {
  auto:'<rect x="4" y="8" width="14" height="14" fill="#8ab"/><rect x="16" y="6" width="14" height="16" fill="#9bc"/><rect x="28" y="8" width="14" height="14" fill="#8ab"/><text x="23" y="28" font-size="7" fill="#ddd" text-anchor="middle">A</text>',
  perspective:'<path d="M3 4 L15 8 L15 22 L3 26Z" fill="#8ab"/><rect x="15" y="8" width="16" height="14" fill="#9bc"/><path d="M31 8 L43 4 L43 26 L31 22Z" fill="#8ab"/>',
  cylindrical:'<path d="M3 7 Q23 3 43 7 L43 23 Q23 27 3 23Z" fill="#9bc"/><path d="M17 5 L17 25 M29 5 L29 25" stroke="#577" />',
  spherical:'<path d="M3 9 Q23 0 43 9 L43 21 Q23 30 3 21Z" fill="#9bc"/><path d="M17 5 Q15 15 17 25 M29 5 Q31 15 29 25" stroke="#577" fill="none"/>',
  collage:'<rect x="4" y="9" width="14" height="12" fill="#8ab" transform="rotate(-8 11 15)"/><rect x="16" y="7" width="14" height="14" fill="#9bc"/><rect x="28" y="9" width="14" height="12" fill="#8ab" transform="rotate(6 35 15)"/>',
  reposition:'<rect x="4" y="9" width="14" height="12" fill="#8ab"/><rect x="16" y="7" width="14" height="14" fill="#9bc"/><rect x="28" y="9" width="14" height="12" fill="#8ab"/>'
};
function openPhotomergeDialog(init){
  init = init || {};
  Dlg.open('ps.file.automate.photomerge', ['Photomerge', 'Photomerge', 'Photomerge'], (box, cur) => {
    const v = cur.vals, st = {items:[]};
    v.layout = LAYOUTS.includes(init.layout) ? init.layout : 'auto';
    const lays = el('div', {cls:'psa-col'});
    const paint = () => lays.querySelectorAll('.psa-lay').forEach(d => d.classList.toggle('on', d.dataset.layout === v.layout));
    LAYOUTS.forEach(k => {
      const d = el('div', {cls:'psa-lay', data:{layout:k}});
      d.innerHTML = `<svg viewBox="0 0 46 30">${LAYOUT_ICON[k]}</svg>`;
      const rb = el('input', {type:'radio', name:'psaLayout', value:k}); rb.checked = k === v.layout;
      d.prepend(rb); d.appendChild(el('span', {text:T3(LAYOUT_NAMES[k])}));
      d.onclick = () => { v.layout = k; rb.checked = true; paint(); };
      lays.appendChild(d);
    });
    paint();
    let ok;
    const src = sourcePicker(st, () => { if (ok) ok.disabled = st.items.length < 2; });
    const opts = el('div', null, [
      check(v, 'blend', ['將影像混合在一起', '混合图像', 'Blend Images Together'], flag(init, 'blend', true)),
      check(v, 'vignetteRemoval', ['暈映移除', '晕影去除', 'Vignette Removal'], flag(init, 'vignetteRemoval', false)),
      check(v, 'geometricCorrection', ['幾何扭曲校正', '几何扭曲校正', 'Geometric Distortion Correction'], flag(init, 'geometricCorrection', false)),
      check(v, 'contentAwareFill', ['內容感知填色透明區域', '内容识别填充透明区域', 'Content Aware Fill Transparent Areas'], flag(init, 'contentAwareFill', false))]);
    box.appendChild(el('div', {cls:'psa-row'}, [group(['版面', '版面', 'Layout'], [lays]), el('div', {cls:'psa-col'}, [group(['來源檔案', '源文件', 'Source Files'], [src]), opts])]));
    ok = footer(box, null, () => {
      if (st.items.length < 2) return {ok:false, error:L3('至少要兩個來源檔案', '至少需要两个源文件', 'Photomerge needs two or more images')};
      return CMD.run('ps.file.automate.photomerge', Object.assign({layout:v.layout, blend:v.blend, vignetteRemoval:v.vignetteRemoval, geometricCorrection:v.geometricCorrection, contentAwareFill:v.contentAwareFill}, itemsToParams(st.items)));
    });
    ok.disabled = true;
  });
  return {ok:true, dialog:'opened'};
}

/* ── 合并到 HDR Pro：①挑来源（＋「尝试自动对齐源图像」）②色调对话框（预览、移除重影、模式、边缘光／色调和细节／高级、来源缩图＋EV） ── */
function openHdrDialog(init){
  init = init || {};
  Dlg.open('ps.file.automate.mergeToHdrPro', ['合併為 HDR Pro', '合并到 HDR Pro', 'Merge to HDR Pro'], (box, cur) => {
    const v = cur.vals, st = {items:[]};
    let ok;
    const src = sourcePicker(st, () => { if (ok) ok.disabled = st.items.length < 2; });
    box.appendChild(el('div', {cls:'psa-col'}, [
      el('div', {text:L3('選擇兩個或更多檔案以合併並建立高動態範圍影像。', '选择两个或两个以上的文件以合并和创建高动态范围图像。', 'Select two or more files to merge and create a high dynamic range image.')}),
      group(['來源檔案', '源文件', 'Source Files'], [src]),
      check(v, 'align', ['嘗試自動對齊來源影像', '尝试自动对齐源图像', 'Attempt to Automatically Align Source Images'], flag(init, 'align', true))]));
    ok = footer(box, null, async () => {
      if (st.items.length < 2) return {ok:false, error:L3('至少要兩個曝光', '至少需要两个曝光', 'Merge to HDR Pro needs two or more exposures')};
      const srcP = itemsToParams(st.items);
      const srcs = await loadSources(srcP, 'file.automate.mergeToHdrPro');
      setTimeout(() => openHdrToneDialog(srcs, srcP, Object.assign({}, init, {align:v.align})), 0);
      return {ok:true};
    });
    ok.disabled = true;
  });
  return {ok:true, dialog:'opened'};
}
function openHdrToneDialog(srcs, srcP, init){
  // 预览：来源缩到最长边 ≤ 420 先合一次，之后改栏位只重做色调映射
  const W = srcs[0].w, H = srcs[0].h, k = Math.min(1, 420 / Math.max(W, H)), pw = Math.max(1, Math.round(W * k)), ph = Math.max(1, Math.round(H * k));
  const small = srcs.map(s => { const c = mkCanvas(pw, ph); ctx2d(c).drawImage(s.canvas, 0, 0, pw, ph); return {name:s.name, canvas:c, w:pw, h:ph, exif:s.exif}; });
  let pre = null, preErr = null;
  const preKey = {align:null, removeGhosts:null, ghostBase:null};
  Dlg.open('ps.file.automate.mergeToHdrPro', ['合併為 HDR Pro', '合并到 HDR Pro', 'Merge to HDR Pro'], (box, cur) => {
    const v = cur.vals; Object.assign(v, HDR_DEFAULT, init);
    v.ghostBase = isNum(init.ghostBase) ? init.ghostBase : null;
    const prev = el('canvas', {cls:'psa-prev', data:{psaPreview:'1'}}); prev.width = pw; prev.height = ph;
    const thumbs = el('div', {cls:'psa-thumbs'});
    const redraw = () => {
      if (preKey.align !== v.align || preKey.removeGhosts !== v.removeGhosts || preKey.ghostBase !== v.ghostBase){
        try { pre = hdrCompute(small, {align:v.align, removeGhosts:v.removeGhosts, ghostBase:v.ghostBase, exposures:init.exposures}, 'file.automate.mergeToHdrPro'); preErr = null; }
        catch (e){ pre = null; preErr = e.message; }
        Object.assign(preKey, {align:v.align, removeGhosts:v.removeGhosts, ghostBase:v.ghostBase});
        drawThumbs();
      }
      if (!pre){ if (preErr) toast(preErr, true); return; }
      try { const px = hdrRender(pre.merged, pw, ph, v, 'file.automate.mergeToHdrPro'); ctx2d(prev).drawImage(canvasOfFloat(px, pw, ph), 0, 0); } catch (e){ toast(e.message, true); }
    };
    const drawThumbs = () => {
      thumbs.innerHTML = '';
      small.forEach((s, i) => {
        const c = mkCanvas(s.w, s.h); ctx2d(c).drawImage(s.canvas, 0, 0);
        const ev = pre ? pre.ev[i] : 0, base = pre ? pre.merged.ghostBase : -1;
        const d = el('div', {data:{i:String(i)}}, [c, el('span', {text:(ev >= 0 ? '+' : '') + ev.toFixed(2) + ' EV'})]);
        if (v.removeGhosts && i === base) d.className = 'base';
        d.onclick = () => { if (!v.removeGhosts) return; v.ghostBase = i; redraw(); };
        thumbs.appendChild(d);
      });
    };
    const rows = {};
    const sync = () => {
      const tm = v.mode !== '32';
      rows.method.classList.toggle('psa-hide', !tm);
      const la = tm && v.method === 'localAdaptation', eg = tm && v.method === 'exposureGamma';
      rows.edge.classList.toggle('psa-hide', !la); rows.adv.classList.toggle('psa-hide', !la);
      rows.tone.classList.toggle('psa-hide', !(la || eg));
      rows.detail.classList.toggle('psa-hide', !la);
      redraw();
    };
    rows.method = select(v, 'method', ['', '', ''], v.method, [['localAdaptation', ['局部適應', '局部适应', 'Local Adaptation']], ['equalizeHistogram', ['均勻分配色階分佈圖', '色调均化直方图', 'Equalize Histogram']], ['exposureGamma', ['曝光度和 Gamma', '曝光度和灰度系数', 'Exposure and Gamma']], ['highlightCompression', ['亮部壓縮', '高光压缩', 'Highlight Compression']]], sync);
    const mode = select(v, 'mode', ['模式：', '模式：', 'Mode:'], String(v.mode), [['32', ['32 位元', '32 位', '32 Bit']], ['16', ['16 位元', '16 位', '16 Bit']], ['8', ['8 位元', '8 位', '8 Bit']]], sync);
    const preset = select(v, 'preset', ['預設集：', '预设：', 'Preset:'], 'default', [['default', ['預設', '默认值', 'Default']], ['custom', ['自訂', '自定', 'Custom']]], () => {
      if (v.preset !== 'default') return;
      resetting = true;
      ['radius', 'strength', 'gamma', 'exposure', 'detail', 'shadow', 'highlight', 'vibrance', 'saturation'].forEach(key => { const r = box.querySelector(`[data-k="${key}"]`); if (r && r.parentNode._set) r.parentNode._set(HDR_DEFAULT[key]); });
      resetting = false; redraw();
    });
    let resetting = false;
    const ch = () => { if (resetting) return; v.preset = 'custom'; box.querySelector('[data-k="preset"]').value = 'custom'; redraw(); };
    rows.edge = group(['邊緣光', '边缘光', 'Edge Glow'], [slider(v, 'radius', ['半徑', '半径', 'Radius'], v.radius, 1, 500, 1, ch), slider(v, 'strength', ['強度', '强度', 'Strength'], v.strength, 0.1, 4, 0.01, ch)]);
    rows.gammaRow = slider(v, 'gamma', ['Gamma', '灰度系数', 'Gamma'], v.gamma, 0.1, 2, 0.01, ch);
    rows.exposureRow = slider(v, 'exposure', ['曝光度', '曝光度', 'Exposure'], v.exposure, -5, 5, 0.01, ch);
    rows.detail = slider(v, 'detail', ['細節', '细节', 'Detail'], v.detail, -100, 300, 1, ch);
    rows.tone = group(['色調和細節', '色调和细节', 'Tone and Detail'], [rows.gammaRow, rows.exposureRow, rows.detail]);
    rows.adv = group(['進階', '高级', 'Advanced'], [slider(v, 'shadow', ['陰影', '阴影', 'Shadow'], v.shadow, -100, 100, 1, ch), slider(v, 'highlight', ['亮部', '高光', 'Highlight'], v.highlight, -100, 100, 1, ch),
      slider(v, 'vibrance', ['細節飽和度', '自然饱和度', 'Vibrance'], v.vibrance, -100, 100, 1, ch), slider(v, 'saturation', ['飽和度', '饱和度', 'Saturation'], v.saturation, -100, 100, 1, ch)]);
    const ghosts = check(v, 'removeGhosts', ['移除鬼影', '移去重影', 'Remove ghosts'], v.removeGhosts, () => { if (!v.removeGhosts) v.ghostBase = null; redraw(); });
    box.appendChild(el('div', {cls:'psa-row'}, [el('div', {cls:'psa-col'}, [prev, thumbs]), el('div', {cls:'psa-col', style:'min-width:300px'}, [preset, ghosts, el('div', {cls:'psa-row'}, [mode, rows.method]), rows.edge, rows.tone, rows.adv])]));
    footer(box, null, () => {
      const o = Object.assign({}, srcP, {align:v.align, removeGhosts:v.removeGhosts, mode:v.mode, method:v.method});
      if (v.removeGhosts && isNum(v.ghostBase)) o.ghostBase = v.ghostBase;
      if (Array.isArray(init.exposures)) o.exposures = init.exposures;
      ['radius', 'strength', 'gamma', 'exposure', 'detail', 'shadow', 'highlight', 'vibrance', 'saturation'].forEach(key => { o[key] = v[key]; });
      return CMD.run('ps.file.automate.mergeToHdrPro', o);
    });
    sync();
  });
}

/* ── 镜头校正（批次）：来源档案、目的地、档案类型、描述档、校正项、边缘 ── */
function openLensDialog(init){
  init = init || {};
  Dlg.open('ps.file.automate.lensCorrection', ['鏡頭校正', '镜头校正', 'Lens Correction'], (box, cur) => {
    const v = cur.vals, st = {items:[]};
    let ok;
    const src = sourcePicker(st, () => { if (ok) ok.disabled = !st.items.length; });
    const out = el('input', {type:'text', value:init.output || 'corrected', data:{k:'output'}}); v.output = out.value; out.onchange = () => { v.output = out.value; };
    const qRow = el('label', null, [el('span', {text:L3('品質 (0–12)', '品质 (0–12)', 'Quality (0–12)')})]);
    const q = el('input', {type:'number', min:0, max:12, step:1, value:10, data:{k:'quality'}}); v.quality = 10; q.onchange = () => { v.quality = clamp(+q.value, 0, 12); }; qRow.appendChild(q);
    const fmt = select(v, 'format', ['檔案類型：', '文件类型：', 'File Type:'], LENS_FORMATS.includes(init.format) ? init.format : 'same',
      [['same', ['與來源相同', '与源相同', 'Same as Source']], ['jpg', 'JPEG'], ['png', 'PNG'], ['webp', 'WebP'], ['tif', 'TIFF']], () => qRow.classList.toggle('psa-hide', v.format !== 'jpg'));
    qRow.classList.toggle('psa-hide', v.format !== 'jpg');
    const fl = el('label', null, [el('span', {text:L3('焦距 (mm，35mm 等效)', '焦距 (mm，35mm 等效)', 'Focal length (mm, 35mm equiv.)')})]);
    const fi = el('input', {type:'number', min:0, max:2000, step:1, value:num(init, 'focalLength', 0), data:{k:'focalLength'}}); v.focalLength = +fi.value; fi.onchange = () => { v.focalLength = Math.max(0, +fi.value || 0); }; fl.appendChild(fi);
    box.appendChild(el('div', {cls:'psa-col'}, [
      group(['來源檔案', '源文件', 'Source Files'], [src]),
      group(['目的地資料夾', '目标文件夹', 'Destination Folder'], [out, fmt, qRow]),
      group(['鏡頭校正描述檔', '镜头校正配置文件', 'Lens Correction Profiles'], [
        select(v, 'profile', ['', '', ''], ['auto', 'generic', 'none'].includes(init.profile) ? init.profile : 'auto', [['auto', ['符合最佳描述檔', '匹配最佳配置文件', 'Match Best Profile']], ['generic', ['一般描述檔', '通用配置文件', 'Generic Profile']], ['none', ['不使用描述檔', '不使用配置文件', 'No Profile']]]), fl]),
      group(['校正', '校正', 'Corrections'], [
        check(v, 'correctDistortion', ['幾何扭曲', '几何扭曲', 'Geometric Distortion'], flag(init, 'correctDistortion', true)),
        check(v, 'correctCA', ['色差', '色差', 'Chromatic Aberration'], flag(init, 'correctCA', true)),
        check(v, 'correctVignette', ['暈映', '晕影', 'Vignette'], flag(init, 'correctVignette', true)),
        check(v, 'autoScale', ['自動縮放影像', '自动缩放图像', 'Auto Scale Image'], flag(init, 'autoScale', true)),
        select(v, 'edge', ['邊緣：', '边缘：', 'Edge:'], ['transparency', 'edgeExtension', 'black', 'white'].includes(init.edge) ? init.edge : 'transparency',
          [['transparency', ['透明', '透明度', 'Transparency']], ['edgeExtension', ['邊緣延伸', '边缘扩展', 'Edge Extension']], ['black', ['黑色', '黑色', 'Black Color']], ['white', ['白色', '白色', 'White Color']]])])]));
    ok = footer(box, null, () => {
      if (!st.items.length) return {ok:false, error:L3('請先選擇檔案', '请先选择文件', 'Choose files first')};
      const o = Object.assign({output:v.output, format:v.format, profile:v.profile, correctDistortion:v.correctDistortion, correctCA:v.correctCA, correctVignette:v.correctVignette, autoScale:v.autoScale, edge:v.edge}, itemsToParams(st.items));
      if (v.format === 'jpg') o.quality = v.quality;
      if (v.focalLength > 0) o.focalLength = v.focalLength;
      ['distortion', 'vignetteAmount', 'redCyan', 'blueYellow'].forEach(key => { if (init[key] !== undefined) o[key] = init[key]; });
      return CMD.run('ps.file.automate.lensCorrection', o);
    });
    ok.disabled = true;
  });
  return {ok:true, dialog:'opened'};
}

/* ═══════════ 命令登记 ═══════════ */
function wrap(fn, dialog){
  return p => {
    p = p || {};
    if (p.ui) return dialog(p);
    let r;
    const fail = e => { if (e instanceof AutoBad) return {ok:false, error:e.message}; throw e; };
    try { r = fn(p); } catch (e){ return fail(e); }
    return r && typeof r.then === 'function' ? r.catch(fail) : r;
  };
}
const SRC_DOC = 'files:[File]（多选的本机档）| urls|paths:[网址或 dataURL]（＋names?:[档名]）| fileIds:[云盘 file_id]（问宿主 resolveRef）| useOpenDocuments:bool=false（目前文件的图层当来源：多选≥2 层＝那几层，否则全部看得见、有内容的顶层）| layers:[图层 id]';
CMD.reg('ps.file.automate.mergeToHdrPro', {i18n:'', undoable:false, params:'{' + SRC_DOC + ', exposures?:[EV…]（一张一个；缺省读 EXIF〔曝光时间×ISO/光圈²〕、再没有就从图估）, align:bool=true（Ward MTB 对齐到中间曝光）, removeGhosts:bool=false, ghostBase?:来源序号（去重影的基准；缺省＝曝光良好像素最多那张）, '
  + 'mode:"32|16|8"="32", method:"localAdaptation|exposureGamma|highlightCompression|equalizeHistogram"="localAdaptation", radius:1..500=7, strength:0.1..4=0.52, gamma:0.1..2=1, exposure:-5..5=0, detail:-100..300=30, shadow:-100..100=0, highlight:-100..100=0, vibrance:-100..100=0, saturation:-100..100=20} '
  + '合并到 HDR Pro：多张同尺寸不同曝光 → 还原相机响应曲线（Debevec–Malik）→ 辐射图 →（32 位＝线性辐射照曝光 0 显示；16/8 位＝色调映射）→ 换掉目前这份成一层「背景」（一步历史，Ctrl+Z 退回）→ {width, height, mode, exposureSource:"params|exif|estimated", ev:[…], offsets:[[dx,dy]…], ghostBase, ghostFraction, stops, ms} · ui:true＝开对话框（同点菜单）'},
  wrap(mergeToHdr, p => openHdrDialog(p)));
CMD.reg('ps.file.automate.photomerge', {i18n:'', undoable:false, params:'{' + SRC_DOC + ', layout:"auto|perspective|cylindrical|spherical|collage|reposition"="auto", blend:bool=true（混合图像：增益补偿＋接缝＋多频段混合，每张一层带蒙版）, vignetteRemoval:bool=false（晕影去除）, geometricCorrection:bool=false（几何扭曲校正：多估一个径向畸变 k1）, contentAwareFill:bool=false（内容识别填充透明区域：顶上加一层）, focalLength:mm=0（35mm 等效；0＝EXIF 或估）} '
  + 'Photomerge 全景接图：Harris＋BRIEF 特征点两两配对、RANSAC＋Brown–Lowe 验证、最大生成树串接、LM 光束平差，照版面投影变形 → 换掉目前这份成全景（一张一层；一步历史）→ {layout（自动时实际用的）, reference, focalLength35, geometricK1, rms, pairs, placed, failed, width, height, layers, photometric:{gains, vignette}, ms} · ui:true＝开对话框（同点菜单）'},
  wrap(photomerge, p => openPhotomergeDialog(p)));
CMD.reg('ps.file.automate.lensCorrection', {i18n:'', undoable:false, params:'{' + SRC_DOC + ', output:"资料夹"="corrected"（档名前加「资料夹/」）, format:"same|png|jpg|webp|tif"="same", quality:0..12=10（jpg）, …滤镜 ▸ 镜头校正的参数（profile:"none|auto|generic"="auto"〔auto 读 EXIF 35mm 焦距〕, focalLength, correctDistortion, correctVignette, correctCA, autoScale, distortion, redCyan, blueYellow, vignetteAmount, vignetteMidpoint, vertical, horizontal, angle, scale, edge:"transparency|edgeExtension|black|white"）} '
  + '批次镜头校正：每张来源图在暂时的文件上跑 ps.filter.lensCorrection 同一套算法，编码后一张一档经 file.exportData 交出去（网站版＝存云盘）；目前这份文件不动、不进历史 → {files:[档名], errors:[{file, error}]} · ui:true＝开对话框（同点菜单）'},
  wrap(lensBatch, p => openLensDialog(p)));

/* ═══════════ 给测试与 agent ═══════════ */
const PsAutomate = window.PsAutomate = {
  version:'1',
  readExif, exposureFactor, estimateExposures, mtbOffset, responseCurve, hdrMerge, toneMap, hdrToning, photometric, seamBlend, contentAwareFill,
  _pickHook:null,
  dlg:{
    isOpen:() => !!Dlg.cur, id:() => Dlg.cur ? Dlg.cur.id : null, vals:() => Dlg.cur ? Object.assign({}, Dlg.cur.vals) : null,
    close:() => Dlg.close()
  }
};
})();
