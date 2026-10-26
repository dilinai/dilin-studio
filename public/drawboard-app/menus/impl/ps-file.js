/* 堤麟画板 · Photoshop ▸ 文件（File）菜单的实作
   命令一律登记成 ps.<原码命令 id>（agent 走命令＝人点菜单＋对话框按确定）；{ui:true}＝开对话框／提示（同点菜单）。
   对照源（photocraft/crates/…）：
     engine/src/file_cmds.rs        1-1141  关闭全部／关闭其它、回复、存储副本、打开为、置入（place_bytes）、文件简介（INFO_FIELDS）、
                                            限制图像（fit_image）、条件模式更改、批处理、图像处理器、载入堆栈、拼合所有效果／蒙版（bake）、
                                            图层导出到文件（layers_to_files）、颜色查找表
     engine/src/commands.rs         262-266 file.close
     engine/src/extra_cmds.rs       388-421, 669-673  删除所有空图层（delete_where、is_empty_layer）
     engine/src/photo_cmds.rs       700-797 裁剪并拉直照片；algo/src/scancrop.rs 1-299（find_photos：边框中位数背景、Otsu、形态学、8 连通、凸包最小外接矩形）
     engine/src/automate_cmds.rs    1-570   脚本（parse_script、browse）、脚本事件管理器（EVENTS、fire_event）、创建快捷批处理、统计、联系表 II
     algo/src/stack.rs              1-145   统计的堆栈模式（stat、combine）
     engine/src/web_cmds.rs         1-1207  存储为 Web 所用格式（WebSettings、presets、web_document、optimize、quantize_band、InverseMap）、
                                            导出首选项、快速导出、生成 ▸ 图像资源（parse_asset_name、parse_defaults、generate_assets）
     algo/src/quantize.rs           1-560   调色板（web／mac／windows／uniform、median_cut、kmeans、build_palette）、bayer8、to_bitmap
     engine/src/artboard_cmds.rs    320-500 画板至文件／PDF（raster_pdf：一页一张 JPEG 的最小 PDF）
     engine/src/print_cmds.rs       1-587   打印（PAPERS、layout、marks_ops、print_one_copy）、打包、路径到 Illustrator（paths_to_ai：AI3 PostScript）
     engine/src/video_cmds.rs       160-190, 268-290  视频帧到图层（load_frames：图片序列）
     engine/src/variables_cmds.rs   250-435 导入变量数据组（import_data_sets、split_csv）、数据组作为文件（export_as_files）——变量本身在图像菜单（ps.image.variables.*）
     engine/src/wia_cmds.rs 1-48、notes_cmds.rs 150-240、comps_cmds.rs 340-440、lens_cmds.rs 20-420、photo_cmds.rs 392-700（没抄）
     ui-egui/src/discard_ui.rs      1-320   关闭／回复／退出前「要不要存」提示（存储／不存储／取消；回复＝回复／取消）
     ui-egui/src/export_dialog.rs   1-254   导出为…对话框（格式 png/jpg/webp/tif、品质、透明、缩放、预览＋估计大小）
     ui-egui/src/file_ui.rs         1-775   存储为 Web 对话框栏位预设、打印对话框、联系表／脚本事件／打包／路径到 AI 的表单
     ui-egui/src/view_cmds.rs       780-992 打开为、存储副本、置入、文件简介／限制图像／图层导出／画板导出的表单栏位
     ui-egui/src/menus.rs 215-260, 435-438；lib.rs 652-684  存储（就地存只认分层格式）、存储为（任何格式都算存过）
   我们的差异（照做的方式写在各函数旁）：
     · 画板只有一份文件 ⇒「关闭」＝问完要不要存再换成一份空白新文件；「关闭其它」没有别的可关；会开新文件的项（打开为、联系表、载入堆栈、统计）＝换掉目前这份（界面走一样先问要不要存）。
     · 没有档案系统 ⇒ 路径参数换成「挑档」（界面）或 urls／files（agent）；输出一律交给命令：工程档走 file.saveProject、整份 PNG 走 file.exportPNG、
       其余格式／多档／文字档走本档登记的 file.exportData（🔴 网站版要覆写这三条才存得进云盘）。
     · 没有智能对象／通道／路径面板／画板 ⇒ 置入＝像素层；「路径到 Illustrator」拿矢量层的形状当路径；「画板至文件／PDF」把整张画布当唯一一块画板（同 ai-select 的做法）。
   🔴 改文件全走 CMD；会改文件的命令都只记一步历史（Ctrl+Z 可退）；坐标铁律：像素层写入前换算成图层坐标。 */
(function(){
'use strict';
if (window.PsFile) return;                      // 防双载

/* ═══════════ 小工具 ═══════════ */
const L3 = (hant, hans, en) => Lang.cur === 'en' ? en : Lang.cur === 'zh-Hans' ? hans : hant;
const T3 = a => Array.isArray(a) ? L3(a[0], a[1], a[2]) : String(a);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isNum = v => typeof v === 'number' && isFinite(v);
const num = (p, k, d) => (p && p[k] !== undefined && p[k] !== null && p[k] !== '' && isFinite(+p[k])) ? +p[k] : d;
const bool = (p, k, d) => (p && typeof p[k] === 'boolean') ? p[k] : d;
const strp = (p, k, d) => (p && typeof p[k] === 'string' && p[k] !== '') ? p[k] : d;
class PsBad extends Error {}
const bad = (cmd, msg) => { throw new PsBad('ps.' + cmd + ': ' + msg); };
function mkCanvas(w, h){ const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
const ctx2d = c => c.getContext('2d', {willReadFrequently:true});
const stem = n => { const s = String(n || '').split(/[\\/]/).pop(); const i = s.lastIndexOf('.'); return i > 0 ? s.slice(0, i) : s; };
const extOf = n => { const s = String(n || '').split(/[?#]/)[0]; const i = s.lastIndexOf('.'); return i > 0 ? s.slice(i + 1).toLowerCase() : ''; };
const fileName = n => String(n || '').split(/[?#]/)[0].split(/[\\/]/).pop();
/* file_cmds.rs:144 sanitize：档名安全 */
function sanitize(name){
  let s = Array.from(String(name || '')).map(c => /[\p{L}\p{N}\-_ .]/u.test(c) ? c : '_').join('');
  s = s.trim().replace(/^\.+|\.+$/g, '');
  return s || 'layer';
}
const pad4 = i => String(i).padStart(4, '0');
function menuName(id){
  let hit = null; if (window.MenuTrees) MenuTrees.walk('ps', it => { if (!hit && it.id === id) hit = it; });
  return hit ? (hit.n[Lang.cur] || hit.n.en) : id;
}
function toast(msg, err){
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:50%;top:60px;transform:translateX(-50%);z-index:10001;color:#fff;padding:6px 14px;border-radius:4px;font:12px sans-serif;max-width:70vw;background:' + (err ? '#5a2a2a' : '#2a4a5a');
  d.dataset.psfToast = '1'; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 3500);
}
function refresh(){ if (window.UI){ UI.refresh(); } }

/* ═══════════ 文件状态：名字、存过没、改过没（discard_ui.rs 的 is_dirty；lib.rs:669 saved_revision） ═══════════
   我们没有 revision 计数 ⇒ 用「存档那一刻历史最上面那张快照是哪一张」判：之后有新的一步（或退到更早）就是改过了。 */
const St = {
  name:'', ext:null,                 // 文件名（不含扩展名）、上次存的格式（dlcanvas＝能就地存）
  mark:{serial:-1, top:null},        // 存档那一刻：Doc.serial＋History.past 最上面那张
  savedSnap:null,                    // 「回复」要回到的样子（存档／打开那一刻的快照）
  untitled:0, assets:false, noMark:0, lastPrint:null, lastWeb:null, jpegOpts:null, opening:null, firing:false, eventLog:[]
};
const topOf = () => History.past.length ? History.past[History.past.length - 1] : null;
function markSaved(){ St.mark = {serial:Doc.serial, top:topOf()}; }
function isDirty(){ return St.mark.serial !== Doc.serial ? History.past.length > 0 : topOf() !== St.mark.top; }
const untitledName = n => L3('未命名-', '未标题-', 'Untitled-') + n;
/* 快照深拷一份（回复用）：画布 restore 时会重画一份；样式／锁定等物件 restore 会直接接过去 ⇒ 这里先拷，存的那张不被之后的编辑改到 */
function cloneSnap(s){
  const o = Object.assign({}, s);
  const jc = v => { try { return JSON.parse(JSON.stringify(v)); } catch(e){ return v; } };
  ['vsel', 'aiDoc', 'globalLight', 'psGlobalLight', 'fileInfo'].forEach(k => { if (o[k] && typeof o[k] === 'object') o[k] = jc(o[k]); });
  if (Array.isArray(o.psExtra)) o.psExtra = o.psExtra.map(e => { const c = {}; Object.keys(e || {}).forEach(k => { c[k] = (k === 'mask' || k === 'maskOff') ? e[k] : jc(e[k]); }); return c; });
  o.layers = s.layers.map(l => {
    const c = Object.assign({}, l);
    Object.keys(c).forEach(k => { if (k !== 'data' && k !== 'mask' && k !== 'maskOff' && c[k] && typeof c[k] === 'object') c[k] = jc(c[k]); });
    if (l.kind !== 'raster') c.data = jc(l.data);
    return c;
  });
  return o;
}

/* ── 垫片（只包一次，可与其它包装串接；并进 engine.js 后可删）：文件简介跟文件名进历史与工程档、开新档重设、存档后标「存过」 ── */
if (!History.__psFileHook){
  History.__psFileHook = true;
  const snap0 = History.snap;
  History.snap = function(){ const s = snap0.apply(this, arguments); s.fileInfo = Doc.fileInfo ? JSON.parse(JSON.stringify(Doc.fileInfo)) : null; return s; };
  ['restore', 'restoreInPlace'].forEach(k => {
    const o = History[k];
    History[k] = function(s){ const r = o.apply(this, arguments); if (s && 'fileInfo' in s) Doc.fileInfo = s.fileInfo ? JSON.parse(JSON.stringify(s.fileInfo)) : null; return r; };
  });
}
function onNewDoc(){
  St.name = untitledName(++St.untitled); St.ext = null; St.savedSnap = null; St.assets = false; St.fileHandle = null; St.jpegOpts = null;
  Doc.fileInfo = null; markSaved();
}
if (!Doc.__psFileHook){
  Doc.__psFileHook = true;
  const reset0 = Doc.reset;
  Doc.reset = function(){ const r = reset0.apply(this, arguments); onNewDoc(); return r; };
}
if (!Project.__psFileHook){
  Project.__psFileHook = true;
  const ser0 = Project.serialize, load0 = Project.load;
  Project.serialize = function(){ const o = ser0.apply(this, arguments); o.docName = St.name; if (Doc.fileInfo) o.fileInfo = JSON.parse(JSON.stringify(Doc.fileInfo)); return o; };
  Project.load = async function(json){
    const r = await load0.apply(this, arguments);
    Doc.fileInfo = json && json.fileInfo ? JSON.parse(JSON.stringify(json.fileInfo)) : null;
    St.name = St.opening || (json && json.docName) || St.name; St.opening = null;
    St.ext = 'dlcanvas'; St.assets = false; St.savedSnap = History.snap(); markSaved();
    fireEvent('openDocument');
    return r;
  };
}
/* 存档完成（同步或网站版回 Promise 都接）：标「存过」、记回复点、生成图像资源、发「存储文档」事件（lib.rs:669-679） */
function afterSaved(r, ext, name){
  if (St.noMark) return r;
  const mark = {serial:Doc.serial, top:topOf()}, snap = History.snap();
  const done = () => { St.mark = mark; St.savedSnap = snap; if (name) St.name = name; St.ext = ext; if (St.assets) generateAssets().catch(e => console.warn(e)); fireEvent('saveDocument'); };
  if (r && typeof r.then === 'function') return r.then(v => { if (!(v && v.ok === false)) done(); return v; });
  if (!(r && r.ok === false)) done();
  return r;
}
/* CMD.run 外面包一层：file.saveProject（Ctrl+S、agent 直接叫）缺名字就补现在的文件名、跑完标「存过」；file.new／导出发脚本事件 */
if (!CMD.__psFileHook){
  CMD.__psFileHook = true;
  const run0 = CMD.run;
  CMD.run = function(id, params){
    if (id === 'file.saveProject'){ params = Object.assign({}, params || {}); if (!params.name) params.name = St.name; }
    const r = run0.call(this, id, params);
    if (id === 'file.saveProject') return afterSaved(r, 'dlcanvas', params.name);
    if (id === 'file.new') fireEvent('newDocument');
    else if (/^file\.(exportPNG|exportPNG2x|exportSVG)$/.test(id)) fireEvent('export');
    return r;
  };
}
/* 有没存的改动时关分页：浏览器自己的提示（discard_ui.rs:82 guard_window_close）；自动化测试（navigator.webdriver）不挂，免得卡住换页 */
if (!navigator.webdriver) window.addEventListener('beforeunload', e => { if (isDirty()){ e.preventDefault(); e.returnValue = ''; } });

/* ═══════════ 出口：一份产好的档交出去（🔴 网站版覆写 file.exportData＝存进云盘） ═══════════ */
function blobOf(data, mime){
  if (data instanceof Blob) return data;
  if (typeof data === 'string' && /^data:/.test(data)){
    const i = data.indexOf(','), head = data.slice(5, i), body = data.slice(i + 1);
    const type = head.split(';')[0] || mime || 'application/octet-stream';
    if (/;base64/.test(head)){ const bin = atob(body), u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); return new Blob([u], {type}); }
    return new Blob([decodeURIComponent(body)], {type});
  }
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) return new Blob([data], {type:mime || 'application/octet-stream'});
  return new Blob([String(data == null ? '' : data)], {type:mime || 'text/plain'});
}
const OWN_EXPORT = !CMD.map['file.exportData'];
if (!CMD.map['file.exportData']){
  CMD.reg('file.exportData', {i18n:'', params:'{name 档名（含扩展名，可带「资料夹/」）, data: Blob|dataURL|文字|Uint8Array, mime?} 把一份产好的档交出去：本地版＝浏览器下载；🔴 网站版覆写这条＝存进云盘（文件菜单的转存／存储副本／图层导出／打印成 PDF…都走这条）→ {name, bytes}'},
    p => { const b = blobOf(p.data, p.mime); download(b, String(p.name || 'untitled').replace(/[\\/]+/g, '_')); return {name:p.name, bytes:b.size, mime:b.type}; });
}
const LOCAL_EXPORT = OWN_EXPORT ? CMD.map['file.exportData'] : null;                    // 本地版的交档（下载）；网站版覆写后就不是它 ⇒ 不用 File System Access
function sink(name, data, mime){
  const r = CMD.run('file.exportData', {name, data, mime});
  fireEvent('export');
  return r;
}

/* ═══════════ 渲染：整份／几层／修边／垫底色 ═══════════
   o: {scale=1, width?, height?（只给一边＝等比）, only?:[ids]（只渲这几层；别的同步藏起来、渲完马上还原）, normalBlend?（单层导出照 layer_document 用正常模式）,
       trim?（修到不透明像素外框）, matte?:'#rrggbb'（垫底色＝不要透明）} */
function renderDoc(o){
  o = o || {};
  const saved = [];
  if (o.only){
    const keep = new Set(o.only);
    Doc.layers.forEach(L => { saved.push([L, L.visible, L.blend]); if (keep.has(L.id)){ L.visible = true; if (o.normalBlend) L.blend = 'normal'; } else L.visible = false; });
  }
  let c;
  try {
    const W0 = Doc.width, H0 = Doc.height;
    let tw, th;
    if (isNum(o.width) && o.width > 0 && isNum(o.height) && o.height > 0){ tw = o.width; th = o.height; }
    else if (isNum(o.width) && o.width > 0){ tw = o.width; th = H0 * o.width / W0; }
    else if (isNum(o.height) && o.height > 0){ th = o.height; tw = W0 * o.height / H0; }
    else { const k = isNum(o.scale) && o.scale > 0 ? o.scale : 1; tw = W0 * k; th = H0 * k; }
    tw = Math.max(1, Math.round(tw)); th = Math.max(1, Math.round(th));
    const kx = tw / W0, ky = th / H0;
    if (Math.abs(kx - ky) < 1e-3){ c = composite(kx); }               // 等比：矢量层按倍率重画（铁律①）
    else { const big = composite(Math.max(kx, ky)); c = mkCanvas(tw, th); const x = ctx2d(c); x.imageSmoothingQuality = 'high'; x.drawImage(big, 0, 0, tw, th); }
    if (c.width !== tw || c.height !== th){ const d = mkCanvas(tw, th); ctx2d(d).drawImage(c, 0, 0, tw, th); c = d; }
  } finally { saved.forEach(([L, v, b]) => { L.visible = v; L.blend = b; }); }
  if (o.trim){ const b = alphaBox(c); if (!b) return null; c = cropCanvas(c, b.x, b.y, b.w, b.h); }
  if (o.matte) c = overColor(c, o.matte);
  return c;
}
function alphaBox(c){
  const W = c.width, H = c.height, d = ctx2d(c).getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0, i = 3; y < H; y++) for (let x = 0; x < W; x++, i += 4) if (d[i]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  return x1 < 0 ? null : {x:x0, y:y0, w:x1 + 1 - x0, h:y1 + 1 - y0};
}
function cropCanvas(c, x, y, w, h){ const d = mkCanvas(w, h); ctx2d(d).drawImage(c, -x, -y); return d; }
function overColor(c, color){ const d = mkCanvas(c.width, c.height), x = ctx2d(d); x.fillStyle = color; x.fillRect(0, 0, d.width, d.height); x.drawImage(c, 0, 0); return d; }
function hasTransparency(c){ const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true; return false; }
function resizeCanvas(c, w, h){ w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h)); if (w === c.width && h === c.height) return c; const d = mkCanvas(w, h), x = ctx2d(d); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, w, h); return d; }

/* ═══════════ 编码器 ═══════════ */
const canvasBlob = (c, type, q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('encode failed: ' + type)), type, q));
const q12 = q => (clamp(q, 0, 12) / 12 * 99 + 1) / 100;                 // file_cmds.rs:158 Photoshop 0–12 → 1–100
const blobBytes = async b => new Uint8Array(await b.arrayBuffer());
/* TIFF：基线、未压缩、RGBA 8 位（ExtraSamples＝非预乘 alpha） */
function encodeTIFF(c, dpi){
  const W = c.width, H = c.height, px = ctx2d(c).getImageData(0, 0, W, H).data;
  const N = 15, ifd = 8, after = ifd + 2 + N * 12 + 4, bpsAt = after, xresAt = after + 8, yresAt = after + 16, dataAt = after + 24;
  const buf = new ArrayBuffer(dataAt + W * H * 4), v = new DataView(buf), u = new Uint8Array(buf);
  v.setUint8(0, 0x49); v.setUint8(1, 0x49); v.setUint16(2, 42, true); v.setUint32(4, ifd, true);
  v.setUint16(ifd, N, true);
  let e = ifd + 2;
  const ent = (tag, type, count, val) => { v.setUint16(e, tag, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, count, true); if (type === 3 && count === 1) v.setUint16(e + 8, val, true); else v.setUint32(e + 8, val, true); e += 12; };
  ent(256, 4, 1, W); ent(257, 4, 1, H); ent(258, 3, 4, bpsAt); ent(259, 3, 1, 1); ent(262, 3, 1, 2); ent(273, 4, 1, dataAt);
  ent(277, 3, 1, 4); ent(278, 4, 1, H); ent(279, 4, 1, W * H * 4); ent(282, 5, 1, xresAt); ent(283, 5, 1, yresAt);
  ent(284, 3, 1, 1); ent(296, 3, 1, 2); ent(305, 2, 1, 0); ent(338, 3, 1, 2);
  v.setUint32(e, 0, true);
  for (let k = 0; k < 4; k++) v.setUint16(bpsAt + k * 2, 8, true);
  const r = Math.round(dpi || 72);
  v.setUint32(xresAt, r, true); v.setUint32(xresAt + 4, 1, true); v.setUint32(yresAt, r, true); v.setUint32(yresAt + 4, 1, true);
  u.set(px, dataAt);
  return new Blob([buf], {type:'image/tiff'});
}
/* artboard_cmds.rs:359 raster_pdf：一页一张 JPEG（DCTDecode），页面大小让图按分辨率印出来 */
function rasterPDF(pages){
  const enc = new TextEncoder(), parts = [], offsets = [];
  let len = 0;
  const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  put(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const obj = (...body) => { offsets.push(len); put(`${offsets.length} 0 obj\n`); body.forEach(put); put('\nendobj\n'); };
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`);
  obj('<< /Type /Catalog /Pages 2 0 R >>');
  obj(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((pg, i) => {
    const k = 72 / Math.max(1, pg.dpi || 72), pw = (pg.w * k).toFixed(3), ph = (pg.h * k).toFixed(3);
    const contents = 4 + i * 3, image = 5 + i * 3;
    obj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${contents} 0 R >>`);
    const stream = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    obj(`<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`, pg.jpeg, '\nendstream');
  });
  const xref = len;
  put(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
  offsets.forEach(o => put(String(o).padStart(10, '0') + ' 00000 n \n'));
  put(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, {type:'application/pdf'});
}
/* PNG-8（索引色）：IHDR＋PLTE＋tRNS＋IDAT（zlib，浏览器 CompressionStream）＋IEND */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes){ let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_T[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function zlibDeflate(bytes){
  const cs = new CompressionStream('deflate'), w = cs.writable.getWriter();
  w.write(bytes); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function encodePNG8(W, H, idx, pal, t){
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
    v.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8); v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out;
  };
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer); hv.setUint32(0, W); hv.setUint32(4, H); ihdr[8] = 8; ihdr[9] = 3;
  const plte = new Uint8Array(pal.length * 3); pal.forEach((c, i) => plte.set(c, i * 3));
  const raw = new Uint8Array(H * (W + 1)); for (let y = 0; y < H; y++) raw.set(idx.subarray(y * W, y * W + W), y * (W + 1) + 1);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', plte)];
  if (t !== null && t !== undefined){ const tr = new Uint8Array(t + 1).fill(255); tr[t] = 0; parts.push(chunk('tRNS', tr)); }
  parts.push(chunk('IDAT', await zlibDeflate(raw)), chunk('IEND', new Uint8Array(0)));
  return new Blob(parts, {type:'image/png'});
}
/* GIF89a：全域色表＋（透明）图形控制延伸＋LZW（编码时机照 omggif 的写法：表满 4096 发清除码） */
function encodeGIF(W, H, idx, pal, t){
  let bits = 1; while ((1 << bits) < pal.length) bits++;
  const size = 1 << bits, out = [];
  const b8 = v => out.push(v & 255), b16 = v => { out.push(v & 255, (v >> 8) & 255); };
  'GIF89a'.split('').forEach(ch => b8(ch.charCodeAt(0)));
  b16(W); b16(H); b8(0x80 | ((bits - 1) << 4) | (bits - 1)); b8(0); b8(0);
  for (let i = 0; i < size; i++){ const c = pal[i] || [0, 0, 0]; b8(c[0]); b8(c[1]); b8(c[2]); }
  if (t !== null && t !== undefined){ b8(0x21); b8(0xf9); b8(4); b8(1); b16(0); b8(t); b8(0); }
  b8(0x2c); b16(0); b16(0); b16(W); b16(H); b8(0);
  const minCode = Math.max(2, bits); b8(minCode);
  const data = []; let cur = 0, shift = 0;
  const emit = (code, sz) => { cur |= code << shift; shift += sz; while (shift >= 8){ data.push(cur & 255); cur >>>= 8; shift -= 8; } };
  const clear = 1 << minCode, eoi = clear + 1;
  let next = eoi + 1, codeSize = minCode + 1, table = new Map();
  emit(clear, codeSize);
  let code = idx.length ? idx[0] : 0;
  for (let i = 1; i < idx.length; i++){
    const k = idx[i], key = (code << 8) | k, hit = table.get(key);
    if (hit !== undefined){ code = hit; continue; }
    emit(code, codeSize);
    if (next === 4096){ emit(clear, codeSize); next = eoi + 1; codeSize = minCode + 1; table = new Map(); }
    else { if (next >= (1 << codeSize)) codeSize++; table.set(key, next++); }
    code = k;
  }
  emit(code, codeSize); emit(eoi, codeSize);
  if (shift > 0) data.push(cur & 255);
  for (let i = 0; i < data.length; i += 255){ const n = Math.min(255, data.length - i); b8(n); for (let k = 0; k < n; k++) out.push(data[i + k]); }
  b8(0); b8(0x3b);
  return new Blob([new Uint8Array(out)], {type:'image/gif'});
}
/* WBMP：type 0，宽高 uintvar，每列 1 位（1＝白） */
function encodeWBMP(W, H, white){
  const out = [0, 0];
  const uv = v => { const s = []; do { s.unshift(v & 127); v >>= 7; } while (v); s.forEach((x, i) => out.push(x | (i < s.length - 1 ? 128 : 0))); };
  uv(W); uv(H);
  const rowB = Math.ceil(W / 8);
  for (let y = 0; y < H; y++){ const row = new Uint8Array(rowB); for (let x = 0; x < W; x++) if (white[y * W + x]) row[x >> 3] |= 128 >> (x & 7); out.push(...row); }
  return new Blob([new Uint8Array(out)], {type:'image/vnd.wap.wbmp'});
}

/* ═══════════ 调色板与仿色（algo/src/quantize.rs、web_cmds.rs:500-625） ═══════════ */
function webPalette(){ const v = []; for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) v.push([r * 51, g * 51, b * 51]); return v; }
function macPalette(){
  const v = webPalette(), steps = []; for (let k = 1; k <= 15; k++){ const s = k * 17; if (s % 51) steps.push(s); }
  const r = steps.slice().reverse();
  r.forEach(s => v.push([s, 0, 0])); r.forEach(s => v.push([0, s, 0])); r.forEach(s => v.push([0, 0, s])); r.forEach(s => v.push([s, s, s]));
  return v.slice(0, 256);
}
function windowsPalette(){
  const v = [[0,0,0],[128,0,0],[0,128,0],[128,128,0],[0,0,128],[128,0,128],[0,128,128],[192,192,192],[192,220,192],[166,202,240],[255,251,240],[160,160,164],[128,128,128],[255,0,0],[0,255,0],[255,255,0],[0,0,255],[255,0,255],[0,255,255],[255,255,255]];
  const has = c => v.some(e => e[0] === c[0] && e[1] === c[1] && e[2] === c[2]);
  webPalette().forEach(c => { if (!has(c)) v.push(c); });
  let g = 8; while (v.length < 256){ if (!has([g, g, g])) v.push([g, g, g]); g = (g + 12) & 255; }
  return v;
}
function uniformPalette(n){
  const k = Math.max(2, Math.floor(Math.cbrt(n))), lv = i => Math.round(i / (k - 1) * 255), v = [];
  for (let r = 0; r < k; r++) for (let g = 0; g < k; g++) for (let b = 0; b < k; b++) v.push([lv(r), lv(g), lv(b)]);
  return v;
}
/* sRGB ↔ Lab（D50；color/src/convert.rs，与 ps-image.js 同一套） */
const s2l = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const l2s = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
const D50 = [0.96422, 1.0, 0.82521];
function srgbToLab(r, g, b){
  const lin = [s2l(r), s2l(g), s2l(b)], m = [[0.436074, 0.385064, 0.143080], [0.222504, 0.716878, 0.060618], [0.013932, 0.097104, 0.714173]];
  const xyz = [0, 1, 2].map(i => (m[i][0] * lin[0] + m[i][1] * lin[1] + m[i][2] * lin[2]) / D50[i]);
  const e = Math.pow(6 / 29, 3), k = 3 * Math.pow(6 / 29, 2), f = t => t > e ? Math.cbrt(t) : t / k + 4 / 29;
  const fx = f(xyz[0]), fy = f(xyz[1]), fz = f(xyz[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function labToRgb8(l, a, b){
  const fy = (l + 16) / 116, fx = fy + a / 500, fz = fy - b / 200, fi = t => t > 6 / 29 ? t * t * t : 3 * Math.pow(6 / 29, 2) * (t - 4 / 29);
  const xyz = [fi(fx) * D50[0], fi(fy) * D50[1], fi(fz) * D50[2]];
  const m = [[3.133856, -1.616867, -0.490615], [-0.978768, 1.916142, 0.033454], [0.071945, -0.228991, 1.405243]];
  return [0, 1, 2].map(i => Math.round(clamp(l2s(clamp(m[i][0] * xyz[0] + m[i][1] * xyz[1] + m[i][2] * xyz[2], 0, 1)), 0, 1) * 255));
}
/* quantize.rs:167 histogram：不透明像素（alpha ≥ ½）的 8 位颜色与次数 */
function histogram(px){
  const m = new Map();
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] >= 0.5){ const key = (Math.round(clamp(px[i], 0, 1) * 255) << 16) | (Math.round(clamp(px[i + 1], 0, 1) * 255) << 8) | Math.round(clamp(px[i + 2], 0, 1) * 255); m.set(key, (m.get(key) || 0) + 1); }
  return Array.from(m.entries()).sort((a, b) => a[0] - b[0]).map(([k, n]) => [[k >> 16, (k >> 8) & 255, k & 255], n]);
}
/* quantize.rs:178 median_cut：挑「加权跨度」最大的盒子沿最长轴在加权中位数切开 */
function medianCut(pts, n){
  if (!pts.length || !n) return [];
  let boxes = [pts.slice()];
  while (boxes.length < n){
    let bi = -1, axis = 0, score = -1;
    boxes.forEach((b, i) => {
      if (b.length <= 1) return;
      let best = [0, -1];
      for (let a = 0; a < 3; a++){ let lo = Infinity, hi = -Infinity; for (const p of b){ if (p[0][a] < lo) lo = p[0][a]; if (p[0][a] > hi) hi = p[0][a]; } if (hi - lo > best[1]) best = [a, hi - lo]; }
      let w = 0; for (const p of b) w += p[1];
      const sc = best[1] * Math.sqrt(w);
      if (sc > score){ bi = i; axis = best[0]; score = sc; }
    });
    if (bi < 0 || score <= 0) break;
    const b = boxes[bi]; boxes[bi] = boxes[boxes.length - 1]; boxes.pop();      // swap_remove
    b.sort((p, q) => p[0][axis] - q[0][axis]);
    let total = 0; for (const p of b) total += p[1];
    let acc = 0, cut = 1;
    for (let i = 0; i < b.length; i++){ acc += b[i][1]; if (acc * 2 >= total){ cut = clamp(i + 1, 1, b.length - 1); break; } }
    boxes.push(b.slice(0, cut), b.slice(cut));
  }
  return boxes.map(b => { let w = 0; const s = [0, 0, 0]; for (const p of b){ w += p[1]; for (let a = 0; a < 3; a++) s[a] += p[0][a] * p[1]; } return s.map(v => v / w); });
}
function nearestF(cs, p){ let best = Infinity, bi = 0; for (let i = 0; i < cs.length; i++){ const c = cs[i], d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (d < best){ best = d; bi = i; } } return bi; }
function kmeans(pts, cs, iters){
  if (!cs.length) return;
  for (let it = 0; it < iters; it++){
    const sum = cs.map(() => [0, 0, 0]), cnt = cs.map(() => 0);
    for (const [p, w] of pts){ const i = nearestF(cs, p); for (let a = 0; a < 3; a++) sum[i][a] += p[a] * w; cnt[i] += w; }
    cs.forEach((c, i) => { if (cnt[i] > 0) cs[i] = sum[i].map(v => v / cnt[i]); });
  }
}
/* quantize.rs:270 build_palette */
function buildPalette(px, kind, colors){
  colors = clamp(Math.round(colors), 2, 256);
  const room = colors, hist = histogram(px);
  let computed;
  if (kind === 'exact'){ if (hist.length > 256) throw new PsBad(`the image has ${hist.length} colours; Exact needs 256 or fewer`); computed = hist.map(h => h[0]); }
  else if (kind === 'systemMac') computed = macPalette();
  else if (kind === 'systemWindows') computed = windowsPalette();
  else if (kind === 'restrictive' || kind === 'web') computed = webPalette();
  else if (kind === 'uniform') computed = uniformPalette(Math.max(room, 8));
  else if (kind === 'adaptive'){
    if (hist.length <= room) computed = hist.map(h => h[0]);
    else { const pts = hist.map(([c, n]) => [c.slice(), n]); const cs = medianCut(pts, room); kmeans(pts, cs, 2); computed = cs.map(c => c.map(v => clamp(Math.round(v), 0, 255))); }
  } else {                                                          // perceptual／selective：Lab 空间里切
    if (hist.length <= room) computed = hist.map(h => h[0]);
    else {
      const pts = hist.map(([c, n]) => [srgbToLab(c[0] / 255, c[1] / 255, c[2] / 255), n]);
      const cs = medianCut(pts, room); kmeans(pts, cs, 4);
      computed = cs.map(c => labToRgb8(c[0], c[1], c[2]));
      if (kind === 'selective') computed = computed.map(c => { const s = c.map(x => Math.round(x / 51) * 51); return c.every((a, i) => Math.abs(a - s[i]) <= 10) ? s : c; });   // 偏向网页安全色
    }
  }
  const pal = [];
  for (const c of computed){ if (pal.length >= 256) break; if (!pal.some(e => e[0] === c[0] && e[1] === c[1] && e[2] === c[2])) pal.push(c); }
  if (['adaptive', 'perceptual', 'selective', 'uniform'].includes(kind)) pal.length = Math.min(pal.length, colors);
  if (!pal.length) pal.push([0, 0, 0]);
  return pal;
}
const BAYER = [0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21];
const bayer8 = (x, y) => (BAYER[(y % 8) * 8 + x % 8] + 0.5) / 64 - 0.5;
function hash01(x, y){ let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ 0x2545f491) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15; return (h & 0xffff) / 65535; }
/* web_cmds.rs:549 quantize_band：6 位逆色表（每格算一次中心）＋ Floyd–Steinberg／8×8 Bayer／杂色；alpha < ½ ⇒ 透明索引 t */
function quantizeRows(px, W, pal, dither, amount, t){
  const H = px.length / 4 / W, idx = new Uint8Array(W * H), lut = new Int16Array(1 << 18).fill(-1);
  const get = (r, g, b) => {
    const q = [r, g, b].map(v => Math.round(clamp(v, 0, 1) * 255) >> 2), key = (q[0] << 12) | (q[1] << 6) | q[2];
    if (lut[key] >= 0) return lut[key];
    const c = q.map(v => v * 4 + 2); let best = Infinity, bi = 0;
    for (let i = 0; i < pal.length; i++){ if (i === t) continue; const e = pal[i], d = (c[0] - e[0]) ** 2 + (c[1] - e[1]) ** 2 + (c[2] - e[2]) ** 2; if (d < best){ best = d; bi = i; } }
    lut[key] = bi; return bi;
  };
  const opaqueN = pal.length - (t !== null && t !== undefined ? 1 : 0);
  const a = clamp(amount, 0, 1), spread = Math.min(1 / Math.max(Math.cbrt(opaqueN), 1), 0.5) * a;
  let cur = dither === 'diffusion' ? new Float32Array((W + 2) * 3) : null, next = cur ? new Float32Array((W + 2) * 3) : null;
  for (let y = 0; y < H; y++){
    if (cur){ const tmp = cur; cur = next; next = tmp; next.fill(0); }
    for (let x = 0; x < W; x++){
      const i = y * W + x, o = i * 4;
      if (px[o + 3] < 0.5 && t !== null && t !== undefined){ idx[i] = t; continue; }
      let c = [px[o], px[o + 1], px[o + 2]];
      if (dither === 'diffusion') for (let k = 0; k < 3; k++) c[k] += cur[(x + 1) * 3 + k];
      else if (dither === 'pattern'){ const d = bayer8(x, y) * spread; c = c.map(v => v + d); }
      else if (dither === 'noise'){ const d = (hash01(x, y) - 0.5) * spread; c = c.map(v => v + d); }
      c = c.map(v => clamp(v, 0, 1));
      const k = get(c[0], c[1], c[2]); idx[i] = k;
      if (cur){
        const e = pal[k];
        for (let q = 0; q < 3; q++){ const d = (c[q] - e[q] / 255) * a; cur[(x + 2) * 3 + q] += d * 7 / 16; next[x * 3 + q] += d * 3 / 16; next[(x + 1) * 3 + q] += d * 5 / 16; next[(x + 2) * 3 + q] += d / 16; }
      }
    }
  }
  return idx;
}
/* quantize.rs:511 to_bitmap（WBMP 用：门槛／Bayer／扩散） */
function toBitmap(gray, W, method){
  const H = gray.length / W;
  if (method === 'threshold') for (let i = 0; i < gray.length; i++) gray[i] = gray[i] >= 0.5 ? 1 : 0;
  else if (method === 'pattern') for (let i = 0; i < gray.length; i++) gray[i] = gray[i] > bayer8(i % W, (i / W) | 0) + 0.5 ? 1 : 0;
  else {
    const buf = Float32Array.from(gray);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
      const i = y * W + x, old = buf[i], nw = old >= 0.5 ? 1 : 0, e = old - nw; gray[i] = nw;
      if (x + 1 < W) buf[i + 1] += e * 7 / 16;
      if (y + 1 < H){ if (x > 0) buf[i + W - 1] += e * 3 / 16; buf[i + W] += e * 5 / 16; if (x + 1 < W) buf[i + W + 1] += e / 16; }
    }
  }
}

/* ═══════════ 存储为 Web 所用格式（web_cmds.rs:76-330 WebSettings／presets、361 optimize） ═══════════ */
const WEB_DEFAULT = {format:'png24', palette:'selective', colors:256, dither:'diffusion', ditherAmount:88, transparency:true, matte:'#ffffff', interlaced:false, webSnap:0, quality:60, progressive:false, optimized:true, embedIcc:false, metadata:'copyright', convertToSrgb:true};
const WEB_PRESETS = {
  'GIF 128 Dithered':{format:'gif', colors:128, dither:'diffusion'}, 'GIF 128 No Dither':{format:'gif', colors:128, dither:'none'},
  'GIF 32 Dithered':{format:'gif', colors:32, dither:'diffusion'}, 'GIF 32 No Dither':{format:'gif', colors:32, dither:'none'},
  'GIF 64 Dithered':{format:'gif', colors:64, dither:'diffusion'}, 'GIF 64 No Dither':{format:'gif', colors:64, dither:'none'},
  'GIF Restrictive':{format:'gif', colors:256, dither:'diffusion', palette:'restrictive'},
  'JPEG High':{format:'jpeg', quality:60}, 'JPEG Low':{format:'jpeg', quality:10}, 'JPEG Medium':{format:'jpeg', quality:30},
  'JPEG Maximum':{format:'jpeg', quality:100}, 'JPEG Very High':{format:'jpeg', quality:80},
  'PNG-24':{format:'png24'}, 'PNG-8 128 Dithered':{format:'png8', colors:128}
};
const WEB_FORMATS = {gif:'gif', png8:'png8', 'png-8':'png8', png24:'png24', 'png-24':'png24', png:'png24', png32:'png24', jpeg:'jpeg', jpg:'jpeg', wbmp:'wbmp'};
const PALETTES = ['perceptual', 'selective', 'adaptive', 'restrictive', 'exact', 'systemMac', 'systemWindows', 'uniform'];
const DITHERS = ['none', 'diffusion', 'pattern', 'noise'];
function webSettings(p, cmd){
  let st = Object.assign({}, WEB_DEFAULT);
  if (p.preset){ const pr = WEB_PRESETS[p.preset]; if (!pr) bad(cmd, `unknown preset \`${p.preset}\``); st = Object.assign(st, pr); }
  if (p.format !== undefined){ const f = WEB_FORMATS[String(p.format).toLowerCase()]; if (!f) bad(cmd, `unknown format \`${p.format}\` (gif|png8|png24|jpeg|wbmp)`); st.format = f; }
  if (p.palette !== undefined){ const k = p.palette === 'web' ? 'restrictive' : String(p.palette).replace(/^local/, '').replace(/^./, c => c.toLowerCase()); if (!PALETTES.includes(k)) bad(cmd, `unknown palette \`${p.palette}\` (${PALETTES.join('|')})`); st.palette = k; }
  if (isNum(+p.colors) && +p.colors > 0) st.colors = clamp(Math.round(+p.colors), 2, 256);
  if (p.dither !== undefined){ const d = p.dither === 'noDither' ? 'none' : p.dither; if (!DITHERS.includes(d)) bad(cmd, `unknown dither \`${p.dither}\` (none|diffusion|pattern|noise)`); st.dither = d; }
  if (isNum(+p.ditherAmount) && p.ditherAmount !== '') st.ditherAmount = clamp(+p.ditherAmount, 0, 100);
  ['transparency', 'interlaced', 'progressive', 'optimized', 'embedIcc', 'convertToSrgb'].forEach(k => { if (typeof p[k] === 'boolean') st[k] = p[k]; });
  if (p.matte !== undefined){ if (p.matte === 'none' || p.matte === null) st.matte = null; else if (/^#?[0-9a-f]{6}$/i.test(p.matte)) st.matte = '#' + String(p.matte).replace('#', ''); else bad(cmd, 'matte is "none" or "#rrggbb"'); }
  if (isNum(+p.webSnap) && p.webSnap !== '') st.webSnap = clamp(+p.webSnap, 0, 100);
  if (isNum(+p.quality) && p.quality !== '') st.quality = clamp(Math.round(+p.quality), 0, 100);
  if (p.metadata !== undefined) st.metadata = p.metadata;
  return st;
}
const hex3 = h => { const s = String(h || '#ffffff').replace('#', ''); return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16) / 255); };
/* web_cmds.rs:361 optimize：canvas（直通 RGBA）→ {blob, ext, width, height, colors, preview(画出来的样子)} */
async function optimize(c, st){
  const W = c.width, H = c.height, d8 = ctx2d(c).getImageData(0, 0, W, H).data, n = W * H;
  const px = new Float32Array(n * 4); for (let i = 0; i < px.length; i++) px[i] = d8[i] / 255;
  const m = st.matte ? hex3(st.matte) : [1, 1, 1];
  const over = (o) => { const a = px[o + 3]; return [px[o] * a + m[0] * (1 - a), px[o + 1] * a + m[1] * (1 - a), px[o + 2] * a + m[2] * (1 - a)]; };
  const look = new Uint8ClampedArray(n * 4);
  if (st.format === 'png24'){
    let alpha = false; if (st.transparency) for (let i = 3; i < px.length; i += 4) if (px[i] < 1){ alpha = true; break; }
    for (let i = 0; i < n; i++){ const o = i * 4; if (alpha){ look[o] = d8[o]; look[o + 1] = d8[o + 1]; look[o + 2] = d8[o + 2]; look[o + 3] = d8[o + 3]; } else { const q = over(o); look[o] = q[0] * 255; look[o + 1] = q[1] * 255; look[o + 2] = q[2] * 255; look[o + 3] = 255; } }
    const lc = mkCanvas(W, H); ctx2d(lc).putImageData(new ImageData(look, W, H), 0, 0);
    return {blob:await canvasBlob(lc, 'image/png'), ext:'png', width:W, height:H, colors:null, preview:lc};
  }
  if (st.format === 'jpeg'){
    for (let i = 0; i < n; i++){ const o = i * 4, q = over(o); look[o] = q[0] * 255; look[o + 1] = q[1] * 255; look[o + 2] = q[2] * 255; look[o + 3] = 255; }
    const lc = mkCanvas(W, H); ctx2d(lc).putImageData(new ImageData(look, W, H), 0, 0);
    const blob = await canvasBlob(lc, 'image/jpeg', Math.max(1, st.quality) / 100);
    return {blob, ext:'jpg', width:W, height:H, colors:null, preview:lc};
  }
  if (st.format === 'wbmp'){
    const gray = new Float32Array(n); for (let i = 0; i < n; i++){ const q = over(i * 4); gray[i] = 0.299 * q[0] + 0.587 * q[1] + 0.114 * q[2]; }
    toBitmap(gray, W, st.dither === 'none' ? 'threshold' : st.dither === 'pattern' ? 'pattern' : 'diffusion');
    const white = new Uint8Array(n); for (let i = 0; i < n; i++){ white[i] = gray[i] > 0.5 ? 1 : 0; const v = white[i] ? 255 : 0; look.set([v, v, v, 255], i * 4); }
    const lc = mkCanvas(W, H); ctx2d(lc).putImageData(new ImageData(look, W, H), 0, 0);
    return {blob:encodeWBMP(W, H, white), ext:'wbmp', width:W, height:H, colors:2, preview:lc};
  }
  // gif／png8
  let transparent = false; if (st.transparency) for (let i = 3; i < px.length; i += 4) if (px[i] < 0.5){ transparent = true; break; }
  const work = new Float32Array(n * 4);
  for (let i = 0; i < n; i++){
    const o = i * 4;
    if (st.transparency && px[o + 3] < 0.5){ work[o + 3] = 0; }
    else if (st.transparency && !st.matte){ work[o] = px[o]; work[o + 1] = px[o + 1]; work[o + 2] = px[o + 2]; work[o + 3] = 1; }
    else { const q = over(o); work[o] = q[0]; work[o + 1] = q[1]; work[o + 2] = q[2]; work[o + 3] = 1; }
  }
  const room = transparent ? Math.max(st.colors - 1, 2) : st.colors;
  let nOpaque = 0; for (let i = 3; i < work.length; i += 4) if (work[i] >= 0.5) nOpaque++;
  const step = nOpaque > (1 << 20) && st.palette !== 'exact' ? Math.floor(nOpaque / (1 << 20)) + 1 : 1;
  let src;
  if (step > 1){ const a = []; let k = 0; for (let i = 0; i < n; i++){ const o = i * 4; if (work[o + 3] >= 0.5){ if (k % step === 0) a.push(work[o], work[o + 1], work[o + 2], 1); k++; } } src = Float32Array.from(a); }
  else src = work;
  const pal = buildPalette(src, st.palette, room);
  if (st.webSnap > 0){ const tol = Math.floor(st.webSnap / 100 * 255); pal.forEach((c, i) => { const s = c.map(x => Math.round(x / 51) * 51); if (c.every((a, k) => Math.abs(a - s[k]) <= tol)) pal[i] = s; }); }
  if (transparent && pal.length > 255) pal.length = 255;
  let t = null; if (transparent){ pal.push(pal[0].slice()); t = pal.length - 1; }
  const idx = quantizeRows(work, W, pal, st.dither, st.ditherAmount / 100, t);
  for (let i = 0; i < n; i++){ const c = pal[idx[i]]; look[i * 4] = c[0]; look[i * 4 + 1] = c[1]; look[i * 4 + 2] = c[2]; look[i * 4 + 3] = idx[i] === t ? 0 : 255; }
  const lc = mkCanvas(W, H); ctx2d(lc).putImageData(new ImageData(look, W, H), 0, 0);
  const blob = st.format === 'gif' ? encodeGIF(W, H, idx, pal, t) : await encodePNG8(W, H, idx, pal, t);
  return {blob, ext:st.format === 'gif' ? 'gif' : 'png', width:W, height:H, colors:pal.length, preview:lc};
}
/* 一般格式编码（转存为／存储副本／图层导出／图像处理器）：png jpg webp tif gif png8 → Blob */
async function encodeAs(c, fmt, o){
  o = o || {};
  fmt = String(fmt || 'png').toLowerCase().replace(/^\./, '');
  if (fmt === 'jpeg') fmt = 'jpg'; if (fmt === 'tiff') fmt = 'tif';
  if (fmt === 'png') return {blob:await canvasBlob(c, 'image/png'), ext:'png'};
  if (fmt === 'jpg') return {blob:await canvasBlob(overColor(c, o.matte || '#ffffff'), 'image/jpeg', o.quality !== undefined ? o.quality : 0.85), ext:'jpg'};
  if (fmt === 'webp'){ const b = await canvasBlob(c, 'image/webp', o.quality !== undefined ? o.quality : 1); return {blob:b, ext:b.type === 'image/webp' ? 'webp' : 'png'}; }
  if (fmt === 'tif') return {blob:encodeTIFF(c, Doc.dpi || 72), ext:'tif'};
  if (fmt === 'gif' || fmt === 'png8'){ const r = await optimize(c, Object.assign({}, WEB_DEFAULT, {format:fmt, dither:'none', matte:null})); return {blob:r.blob, ext:r.ext}; }
  if (fmt === 'pdf'){ const j = await blobBytes(await canvasBlob(overColor(c, '#ffffff'), 'image/jpeg', o.quality !== undefined ? o.quality : q12(10))); return {blob:rasterPDF([{w:c.width, h:c.height, dpi:Doc.dpi || 72, jpeg:j}]), ext:'pdf'}; }
  throw new PsBad('unsupported format `' + fmt + '` (png|jpg|webp|tif|gif|png8|pdf)');
}

/* ═══════════ 对话框（DOM＋样式都在本档注入，不碰 style.css） ═══════════ */
(function injectCSS(){
  if (document.getElementById('psf-css')) return;
  const st = document.createElement('style'); st.id = 'psf-css';
  st.textContent = `
.psf-bg{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:10000}
.psf-dlg{background:#2b2f36;color:#e6e8eb;padding:14px 18px;border-radius:6px;min-width:300px;max-width:92vw;max-height:88vh;overflow:auto;font:13px sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)}
.psf-dlg h3{margin:0 0 10px;font-size:14px}
.psf-dlg .psf-msg{margin:4px 0 10px;max-width:420px;line-height:1.5}
.psf-wrap{display:flex;gap:16px;align-items:flex-start}
.psf-grid{display:grid;grid-template-columns:auto minmax(170px,240px);gap:7px 10px;align-items:center}
.psf-grid>span{color:#aab0ba}
.psf-grid input[type=number],.psf-grid input[type=text],.psf-grid select,.psf-grid textarea{width:100%;box-sizing:border-box;background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:3px 6px;font:12px sans-serif}
.psf-grid textarea{min-height:70px;font-family:monospace}
.psf-grid input[type=color]{width:60px;height:22px;padding:0;border:1px solid #444a54;background:none}
.psf-grid .psf-files{display:flex;gap:6px;align-items:center}
.psf-row{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.psf-row button,.psf-grid button{background:#3a404a;color:#e6e8eb;border:1px solid #555c68;border-radius:3px;padding:4px 14px;cursor:pointer}
.psf-row button.pri{background:#2f7fd8;border-color:#2f7fd8;color:#fff}
.psf-extra canvas{display:block;background:repeating-conic-gradient(#3a3f47 0 25%,#2d3138 0 50%) 0 0/12px 12px;border:1px solid #444a54}
.psf-extra .psf-note{color:#8a919c;font-size:11px;margin-top:4px}
.psf-list{max-height:120px;overflow:auto;border:1px solid #444a54;border-radius:3px;padding:4px 6px;margin-top:6px;font-size:12px}
.psf-list div{display:flex;justify-content:space-between;gap:8px;padding:2px 0}`;
  document.head.appendChild(st);
})();
/* fields：[{k, label:[繁,简,英], type:'number'|'text'|'textarea'|'check'|'select'|'color'|'files', min, max, step, value, options:[[值,[繁,简,英]|字]], accept, multiple, when:vals=>bool}] */
const Dlg = {
  cur:null,
  open(o){
    this.close();
    const bg = document.createElement('div'); bg.className = 'psf-bg';
    const box = document.createElement('div'); box.className = 'psf-dlg'; box.id = 'psFileDlg'; box.dataset.cmd = o.cmd || '';
    const h = document.createElement('h3'); h.textContent = o.title ? T3(o.title) : menuName(o.id); box.appendChild(h);
    if (o.message){ const m = document.createElement('div'); m.className = 'psf-msg'; m.textContent = o.message; box.appendChild(m); }
    const wrap = document.createElement('div'); wrap.className = 'psf-wrap'; box.appendChild(wrap);
    const grid = document.createElement('div'); grid.className = 'psf-grid';
    const vals = {}, rows = [];
    (o.fields || []).forEach(f => {
      vals[f.k] = f.value;
      const lab = document.createElement('span'); lab.textContent = f.label ? T3(f.label) : '';
      let inp;
      if (f.type === 'select'){
        inp = document.createElement('select');
        f.options.forEach(op => { const [v, l] = Array.isArray(op) ? op : [op, op]; const e = document.createElement('option'); e.value = v; e.textContent = Array.isArray(l) ? T3(l) : l; inp.appendChild(e); });
        inp.value = f.value; inp.onchange = () => { vals[f.k] = inp.value; this.changed(); };
      } else if (f.type === 'textarea'){
        inp = document.createElement('textarea'); inp.value = f.value || ''; inp.oninput = () => { vals[f.k] = inp.value; this.changed(); };
      } else if (f.type === 'files'){
        inp = document.createElement('div'); inp.className = 'psf-files';
        const b = document.createElement('button'); b.type = 'button'; b.textContent = L3('選擇…', '选择…', 'Choose…'); b.dataset.k = f.k;
        const cnt = document.createElement('span'); cnt.textContent = '0';
        b.onclick = async () => { const fs = await pickFiles(f.accept, f.multiple !== false); if (fs.length){ vals[f.k] = fs; cnt.textContent = fs.length === 1 ? fs[0].name : String(fs.length); this.changed(); } };
        inp.appendChild(b); inp.appendChild(cnt); vals[f.k] = f.value || [];
      } else {
        inp = document.createElement('input');
        inp.type = f.type === 'check' ? 'checkbox' : (f.type || 'number');
        if (f.type === 'check'){ inp.checked = !!f.value; inp.onchange = () => { vals[f.k] = inp.checked; this.changed(); }; }
        else {
          if (f.min !== undefined) inp.min = f.min; if (f.max !== undefined) inp.max = f.max; if (inp.type === 'number') inp.step = f.step || 'any';
          inp.value = f.value === undefined || f.value === null ? '' : f.value;
          const rd = () => { if (inp.type === 'number'){ let v = +inp.value; if (inp.value === '' || !isFinite(v)) return; if (f.min !== undefined) v = Math.max(f.min, v); if (f.max !== undefined) v = Math.min(f.max, v); vals[f.k] = v; } else vals[f.k] = inp.value; this.changed(); };
          inp.oninput = rd; inp.onchange = rd;
        }
      }
      if (inp.dataset && f.type !== 'files') inp.dataset.k = f.k;
      grid.appendChild(lab); grid.appendChild(inp); rows.push([f, lab, inp]);
    });
    wrap.appendChild(grid);
    const extra = document.createElement('div'); extra.className = 'psf-extra'; wrap.appendChild(extra);
    const row = document.createElement('div'); row.className = 'psf-row'; box.appendChild(row);
    const buttons = o.buttons || [{act:'cancel', label:['取消', '取消', 'Cancel']}, {act:'ok', label:o.okLabel || ['確定', '确定', 'OK'], pri:true}];
    const cur = this.cur = {o, box, bg, vals, rows, extra};
    buttons.forEach(b => {
      const e = document.createElement('button'); e.type = 'button'; e.dataset.act = b.act; e.textContent = T3(b.label); if (b.pri) e.className = 'pri';
      e.onclick = () => this.click(b.act); row.appendChild(e);
    });
    box.addEventListener('keydown', e => {
      if (e.key === 'Escape'){ e.preventDefault(); this.click('cancel'); }
      else if (e.key === 'Enter' && !/textarea|button/i.test(e.target.tagName)){ e.preventDefault(); const p = buttons.find(b => b.pri); if (p) this.click(p.act); }
      e.stopPropagation();
    });
    bg.appendChild(box); document.body.appendChild(bg);
    this.changed();
    const first = box.querySelector('input,select,textarea,button'); if (first) first.focus();
    return box;
  },
  changed(){
    const c = this.cur; if (!c) return;
    c.rows.forEach(([f, lab, inp]) => { const on = !f.when || f.when(c.vals); lab.style.display = on ? '' : 'none'; inp.style.display = on ? '' : 'none'; });
    if (c.o.render){ try { c.o.render(c.extra, c.vals); } catch(e){ console.warn(e); } }
  },
  set(k, v){
    const c = this.cur; if (!c) return false;
    c.vals[k] = v;
    const r = c.rows.find(x => x[0].k === k);
    if (r && r[0].type !== 'files'){ if (r[0].type === 'check') r[2].checked = !!v; else r[2].value = v; }
    this.changed(); return true;
  },
  click(act){
    const c = this.cur; if (!c) return null;
    const vals = Object.assign({}, c.vals);
    this.close();
    const b = (c.o.buttons || []).find(x => x.act === act);
    let r = null;
    try {
      if (b && b.fn) r = b.fn(vals);
      else if (act === 'ok' && c.o.onOK) r = c.o.onOK(vals);
      else if (act === 'cancel' && c.o.onCancel) r = c.o.onCancel();
    } catch(err){ console.error(err); toast(String(err.message || err), true); }
    const report = v => { if (v && v.ok === false && v.error) toast(v.error, true); if (window.UI) UI.refresh(); return v; };
    if (r && typeof r.then === 'function') return r.then(report, err => { console.error(err); toast(String(err.message || err), true); });
    return report(r);
  },
  close(){ const c = this.cur; if (!c) return; c.bg.remove(); this.cur = null; }
};
/* 对话框开着时框外的键一律不给（Esc＝取消） */
window.addEventListener('keydown', e => {
  const c = Dlg.cur; if (!c || c.box.contains(e.target)) return;
  if (e.key === 'Escape') Dlg.click('cancel');
  e.preventDefault(); e.stopPropagation();
}, true);
function pickFiles(accept, multiple){
  if (PsFile._pickHook) return Promise.resolve(PsFile._pickHook(accept, multiple));   // 测试用
  return new Promise(res => {
    const inp = document.createElement('input'); inp.type = 'file'; if (accept) inp.accept = accept; inp.multiple = !!multiple; inp.style.display = 'none';
    inp.dataset.psfPicker = '1';
    let done = false; const fin = v => { if (done) return; done = true; inp.remove(); res(v); };
    inp.onchange = () => fin(Array.from(inp.files || []));
    inp.addEventListener('cancel', () => fin([]));
    document.body.appendChild(inp); inp.click();
  });
}
/* 输入档：files（File[]，界面挑的）或 urls／url／input（网址、dataURL、blob:） → [{src, name}] */
function inputsOf(p){
  const out = [], names = Array.isArray(p.names) ? p.names : (typeof p.name === 'string' ? [p.name] : []);
  // 名字：names[i] ＞ File.name ＞ 网址最后一段；dataURL／blob: 没有档名 ⇒「image n」
  const add = s => { if (!s) return; const i = out.length;
    const n = names[i] || (s instanceof Blob ? (s.name || 'image ' + (i + 1)) : /^(data|blob):/.test(s) ? 'image ' + (i + 1) : decodeURIComponent(fileName(s)) || 'image ' + (i + 1));
    out.push({src:s, name:n, anon:!names[i] && !(s instanceof Blob && s.name) && typeof s === 'string' && /^(data|blob):/.test(s)}); };
  [p.files, p.urls, p.url, p.input, p.paths].forEach(v => { if (Array.isArray(v)) v.forEach(x => add(x)); else if (v) add(v); });
  return out;
}
const srcURL = s => s instanceof Blob ? URL.createObjectURL(s) : s;
function loadImage(src){
  return new Promise((res, rej) => {
    const url = srcURL(src), img = new Image();
    if (typeof src === 'string' && /^https?:/.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => { if (src instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 1000); res(img); };
    img.onerror = () => rej(new Error('load failed: ' + (src && src.name || String(src).slice(0, 80))));
    img.src = url;
  });
}
async function readText(src){ if (src instanceof Blob) return await src.text(); const r = await fetch(src); return await r.text(); }
const isVideo = it => (it.src instanceof Blob && /^video\//.test(it.src.type)) || /\.(mp4|webm|ogv|mov|m4v)$/i.test(it.name);
function imageCanvas(img){ const c = mkCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height); ctx2d(c).drawImage(img, 0, 0); return c; }

/* ═══════════ 命令登记 ═══════════ */
function wrap(fn){ return p => { try { const r = fn(p || {}); return r && typeof r.then === 'function' ? r.catch(e => { if (e instanceof PsBad) return {ok:false, error:e.message}; throw e; }) : r; } catch(e){ if (e instanceof PsBad) return {ok:false, error:e.message}; throw e; } }; }
function withHistory(fn){
  return p => {
    History.push(); let r;
    try { r = fn(p); }
    catch(e){ History.restoreInPlace(History.past.pop()); throw e; }
    if (r && r.ok === false) History.restoreInPlace(History.past.pop());
    return r;
  };
}
const UIP = ' · ui:true＝开对话框／提示（同点菜单）';
/* opt.dialog(p)：ui:true 时开对话框；opt.history：同步改文件、记一步历史 */
function reg(id, params, fn, opt){
  opt = opt || {};
  const run = opt.history ? withHistory(fn) : fn;
  CMD.reg('ps.' + id, {i18n:'', params:params + (opt.dialog ? UIP : ''), undoable:false},
    wrap(p => { if (p.ui && opt.dialog) return opt.dialog(p); return run(p); }));
}
const opened = () => ({ok:true, dialog:'opened'});

/* ── 要不要存（discard_ui.rs:133 show）：存储／不存储／取消；回复＝回复／取消 ── */
function confirmDiscard(kind){
  if (kind !== 'revert' && !isDirty()) return Promise.resolve(true);
  return new Promise(res => {
    const name = St.name;
    const msg = kind === 'revert' ? L3(`要將「${name}」回復到上次儲存的版本嗎？你的變更將會遺失。`, `要将“${name}”恢复到上次存储的版本吗？你的更改将会丢失。`, `Revert “${name}” to the last saved version? Your changes will be lost.`)
      : kind === 'exit' ? L3(`結束前要儲存對「${name}」所做的變更嗎？`, `退出之前要存储对“${name}”所做的更改吗？`, `Do you want to save the changes you made to “${name}” before quitting?`)
      : L3(`關閉前要儲存對「${name}」所做的變更嗎？`, `关闭之前要存储对“${name}”所做的更改吗？`, `Do you want to save the changes you made to “${name}” before closing?`);
    const buttons = kind === 'revert'
      ? [{act:'cancel', label:['取消', '取消', 'Cancel'], fn:() => res(false)}, {act:'revert', label:['回復', '恢复', 'Revert'], pri:true, fn:() => res(true)}]
      : [{act:'dontsave', label:['不儲存', '不存储', "Don't Save"], fn:() => res(true)}, {act:'cancel', label:['取消', '取消', 'Cancel'], fn:() => res(false)},
         {act:'save', label:['儲存', '存储', 'Save'], pri:true, fn:() => { const r = saveBeforeClose(); Promise.resolve(r).then(v => res(!(v && v.ok === false)), () => res(false)); }}];
    Dlg.open({id:'discard', title:kind === 'revert' ? ['回復', '恢复', 'Revert'] : ['未儲存的變更', '未存储的更改', 'Unsaved changes'], message:msg, buttons, cmd:'discard'});
    Dlg.cur.box.dataset.discard = kind;
  });
}

/* ── 关闭（commands.rs:262；file_cmds.rs:206 close_all、214 close_others） ── */
const DEFAULT_DOC = {width:1200, height:675, background:'#ffffff'};
function closeNow(){
  fireEvent('closeDocument');
  CMD.run('file.new', Object.assign({}, DEFAULT_DOC));
  return {closed:1, name:St.name};
}
async function closeFlow(p){
  if (p.ui){ if (!await confirmDiscard('close')) return {ok:false, cancelled:true}; }
  else if (p.save === true){ const r = await CMD.run('ps.file.save', {}); if (r && r.ok === false) return r; }
  return closeNow();
}
reg('file.close', '{save?:bool（先存再关）} 关闭：只有一份文件 ⇒ 关掉后换成一份空白新文件（1200×675 白底）；agent 不给 save 就不存直接关（同原码 engine 的 file.close）→ {closed}', closeFlow, {dialog:p => closeFlow(p)});
reg('file.closeAll', '{save?:bool} 关闭全部（我们只有一份文件，同「关闭」）→ {closed}', closeFlow, {dialog:p => closeFlow(p)});
reg('file.closeOthers', '{} 关闭其它：只有一份文件，没有别的可关 → {closed:0}', () => ({closed:0}));
/* 退出：问完要不要存就关分页（浏览器只让脚本开的窗被脚本关；关不掉就提示自己关） */
async function exitFlow(p){
  if (p.ui && !await confirmDiscard('exit')) return {ok:false, cancelled:true};
  if (!p.ui && p.save === true){ const r = await CMD.run('ps.file.save', {}); if (r && r.ok === false) return r; }
  const closed = PsFile.closeWindow();
  setTimeout(() => { if (!window.closed) toast(L3('瀏覽器不讓網頁自己關掉分頁，請手動關閉。', '浏览器不让网页自己关掉分页，请手动关闭。', 'The browser does not let the page close its own tab; please close it yourself.')); }, 300);
  return {exit:true, closeRequested:closed !== false};
}
reg('file.exit', '{save?:bool} 退出：关掉画板分页（浏览器不准就提示手动关）', exitFlow, {dialog:p => exitFlow(p)});

/* ── 存储／存储为／存储副本（menus.rs:227、lib.rs:652 save_as、file_cmds.rs:249 save_a_copy） ── */
const SAVE_FORMATS = [['dlcanvas', ['堤麟畫板工程檔 (.dlcanvas)', '堤麟画板工程档 (.dlcanvas)', 'Dilin Canvas (.dlcanvas)']], ['psd', 'Photoshop (.psd)'], ['psb', ['大型文件格式 (.psb)', '大型文档格式 (.psb)', 'Large Document Format (.psb)']], ['ai', 'Illustrator (.ai)'], ['ora', 'OpenRaster (.ora)'], ['png', 'PNG (.png)'], ['jpg', 'JPEG (.jpg)'], ['webp', 'WebP (.webp)'], ['tif', 'TIFF (.tif)'], ['svg', 'SVG (.svg)'], ['pdf', 'PDF (.pdf)']];
const SAVE_EXTS = SAVE_FORMATS.map(f => f[0]);
/* ── PSD（PS 2020 存储为第一个格式；原码 crates/psd；编解码在 menus/impl/psd-io.js）──
   写：每层像素＋图层蒙版＋剪贴＋混合模式＋不透明度／填充＋组（含组蒙版）＋合成图；文字层另写能改的文字、纯色矢量层写成形状图层、
       PS 也有的图层样式（投影、内阴影、外发光、内发光、描边、颜色叠加）写成样式，别的样式连同那层画成像素（见 psdTextOf／psdShapeOf／psdFxOf）。
   读：还原分层（像素层、组、不透明度、混合模式、可见性、图层蒙版、剪贴）；文字层（没变形没旋转、一种样式）接成文字层、纯色形状图层接成矢量层、
   画板也有的图层样式接成图层样式，其余照旧当像素（psdTextLayer／psdShapeLayer／psdApplyFx）；合成图给置换图／置入用。 */
const rgbaOfCanvas = c => ctx2d(c).getImageData(0, 0, c.width, c.height).data;
/* 这层自己的像素／蒙版（文件坐标、文件大小；不含蒙版、不透明度、混合、剪贴、样式） */
function docSpace(src, L){
  const c = mkCanvas(Doc.width, Doc.height), x = ctx2d(c);
  if (L.kind === 'raster') x.drawImage(src, L.x || 0, L.y || 0); else x.drawImage(src, 0, 0, Doc.width, Doc.height);
  return c;
}
function psdMaskOf(L){
  const M = L.mask || L.maskOff; if (!M) return null;
  const a = rgbaOfCanvas(docSpace(renderLayer(M, 1), L)), n = Doc.width * Doc.height, alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) alpha[i] = a[i * 4 + 3];
  // 蒙版预设色（PS：显示全部＝255、隐藏全部＝0；menus/impl/ps-image.js PsMaskFill.white）
  const def = typeof M.defaultColor === 'number' ? M.defaultColor : (window.PsMaskFill && PsMaskFill.white && !PsMaskFill.white(M) ? 0 : 255);
  return {alpha, enabled:!!L.mask, defaultColor:def >= 128 ? 255 : 0};
}
/* PSD 活图层（PsdIO.encode 的 text／fx／shape）：照引擎图层算——
   文字层（没修饰、没变形）⇒ 能改的文字；矢量层（纯色填色／描边一致、没编组剪切）⇒ 形状图层；
   图层样式只有 PS 也有的那几种（投影、内阴影、外发光、内发光、描边、颜色叠加，每种一个）⇒ 写成样式；
   有别的样式 ⇒ 这层连样式照画面画成像素（不再另写样式，免得叠两次）。 */
const PSD_FX = ['dropShadow', 'innerShadow', 'outerGlow', 'innerGlow', 'stroke', 'colorOverlay', 'gradientOverlay', 'satin', 'patternOverlay', 'bevelEmboss'];
const psdRgbCtx = () => psdRgbCtx.c || (psdRgbCtx.c = ctx2d(mkCanvas(1, 1)));
function psdRgb(c){
  if (Array.isArray(c)) return c.slice(0, 3);
  const x = psdRgbCtx(); x.fillStyle = '#000'; x.fillStyle = String(c || '#000'); const s = x.fillStyle;
  if (s[0] === '#') return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
  const m = s.match(/[\d.]+/g) || [0, 0, 0]; return [+m[0], +m[1], +m[2]];
}
const psdAlpha = c => { const x = psdRgbCtx(); x.fillStyle = '#000'; x.fillStyle = String(c || '#000'); const m = x.fillStyle.match(/rgba\([^)]*,\s*([\d.]+)\)/); return m ? +m[1] : 1; };
function psdFxOf(L, bakePat){
  // 只看图层自己的样式（PsLayerStyle.has 还把调整层、剪贴组、矢量蒙版算进去，那些另外写）
  if (!(L && L.style && L.style.enabled !== false && Array.isArray(L.style.items))) return null;
  const items = L.style.items.filter(e => e.enabled !== false);
  if (!items.length) return null;
  const seen = new Set();
  for (const e of items){ if (!PSD_FX.includes(e.kind) || seen.has(e.kind)) return 'bake'; seen.add(e.kind); }
  // 保底（psdPatterns:'bake'）：图案叠加、斜面浮雕纹理连同那层画成像素，文件里就没有 Patt
  if (bakePat && items.some(e => e.kind === 'patternOverlay' || (e.kind === 'bevelEmboss' && e.texture))) return 'bake';
  const gl = Doc.globalLight && typeof Doc.globalLight.angle === 'number' ? Doc.globalLight.angle : 120;
  const ga = Doc.globalLight && typeof Doc.globalLight.altitude === 'number' ? Doc.globalLight.altitude : 30;
  // 引擎存 0..1（不透明度、扩展／收缩都在 spread、范围、缩放、深度）⇒ PSD 用百分比
  const pc = v => (typeof v === 'number' ? v * 100 : undefined);
  const grad = g => ({from:psdRgb(g.from), to:psdRgb(g.to), style:g.style, angle:g.angle, scale:pc(g.scale), reverse:!!g.reverse});
  const pat = id => { const P = window.PsEdit && PsEdit.patterns && PsEdit.patterns.resolve(id || ''); return P && P.px ? {id:P.id, name:P.name, width:P.width, height:P.height, px:P.px} : null; };
  const out = [];
  for (const e of items){
    const o = {kind:e.kind, enabled:true, blend:e.blend, opacity:pc(e.opacity)};
    if (e.kind === 'gradientOverlay') Object.assign(o, grad(e));
    else if (e.kind === 'satin') Object.assign(o, {color:psdRgb(e.color), angle:e.angle, distance:e.distance, size:e.size, invert:e.invert !== false});
    else if (e.kind === 'patternOverlay'){ const P = pat(e.pattern) || pat(e.name); if (!P) return 'bake'; Object.assign(o, {pattern:P, scale:pc(e.scale), angle:e.angle || 0, link:e.link !== false, phase:e.phase || [0, 0]}); }
    else if (e.kind === 'bevelEmboss'){
      Object.assign(o, {style:e.style, technique:e.technique, depth:pc(e.depth), up:e.up !== false, size:e.size, soften:e.soften, angle:e.useGlobalLight ? gl : e.angle, altitude:e.useGlobalLight ? ga : e.altitude,
        highlightColor:psdRgb(e.highlightColor), highlightBlend:e.highlightBlend, highlightOpacity:pc(e.highlightOpacity), shadowColor:psdRgb(e.shadowColor), shadowBlend:e.shadowBlend, shadowOpacity:pc(e.shadowOpacity),
        contour:e.contour ? {range:e.contour.range} : null});
      if (e.texture){ const P = pat(e.texture.pattern); if (!P) return 'bake'; o.texture = {pattern:P, scale:e.texture.scale, depth:e.texture.depth, invert:!!e.texture.invert, link:e.texture.link !== false}; }
    }
    else Object.assign(o, {color:psdRgb(e.color), angle:e.useGlobalLight ? gl : e.angle, distance:e.distance, spread:pc(e.spread), choke:pc(e.spread), size:e.size, range:pc(e.range),
      technique:e.technique, source:e.source, position:e.position, knocksOut:e.knocksOut}, e.kind === 'stroke' && e.gradient ? {gradient:grad(e.gradient)} : {});
    out.push(o);
  }
  return out;
}
/* 调整图层 ⇒ {kind, params, cube?}（颜色查找另带 .cube 文字：PS 的颜色查找层存的是 LUT 档本身） */
function psdAdjOf(L){
  const A = L.adjust; if (!A || !window.PsdIO || !PsdIO.ADJ_KEY[A.kind]) return null;
  const params = JSON.parse(JSON.stringify(A.params || {})), out = {kind:A.kind, params};
  if (A.kind === 'colorLookup' && window.PsImage) try {
    const a = PsImage.fromParams('colorLookup', params, null);
    if (a && a.lut && a.size >= 2){
      const n = a.size, lines = ['TITLE "' + String(a.name || 'Look').replace(/"/g, '') + '"', 'LUT_3D_SIZE ' + n];
      for (let i = 0; i < n * n * n; i++) lines.push(`${a.lut[i * 3].toFixed(6)} ${a.lut[i * 3 + 1].toFixed(6)} ${a.lut[i * 3 + 2].toFixed(6)}`);   // 红最快（.cube 的顺序）
      const t = lines.join('\n') + '\n', u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i) & 255;
      const base = typeof params.lut === 'string' && params.lut ? params.lut : String(params.fileName || a.name || 'look').replace(/\.cube$/i, '');
      out.cube = {name:base + '.cube', data:u};
    }
  } catch (e){ console.warn('psd color lookup', e); }
  return out;
}
/* 智能对象 ⇒ {id, w, h, corners}（内嵌档推进 ctx.linked）；载不到来源、有智能滤镜或变形／透视（PS 的智能对象写不出我们的这些）⇒ null＝照画面写成像素 */
function psdSmartOf(L, ctx){
  if (!ctx || !window.Smart || !Smart.is(L)) return null;
  const e = Smart.sourceOf(L), d = L.data || {};
  if (!e || !Smart.available(e) || d.stackMode) return null;
  if (d.filtersEnabled !== false && (d.filters || []).some(f => f && f.visible !== false)) return null;
  const t0 = d.transform || [1, 0, 0, 1, 0, 0];
  let t = [t0[0], t0[1], t0[2], t0[3], t0[4] + (L.x || 0), t0[5] + (L.y || 0)];   // 来源像素 → 文件坐标
  for (const op of d.ops || []){
    if (op.type !== 'affine') return null;
    // 自由变换（文件坐标、记下当时的位移；层后来移了就跟着平移）：同 Smart.applyOp 的式子，套在 t 外面
    const M = op.m, at = op.at || [0, 0], dx = (L.x || 0) - at[0], dy = (L.y || 0) - at[1];
    const m = [M[0], M[1], M[2], M[3], M[4] + dx - (M[0] * dx + M[2] * dy), M[5] + dy - (M[1] * dx + M[3] * dy)];
    t = [m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1], m[0] * t[2] + m[2] * t[3], m[1] * t[2] + m[3] * t[3], m[0] * t[4] + m[2] * t[5] + m[4], m[1] * t[4] + m[3] * t[5] + m[5]];
  }
  if (!ctx.ids) ctx.ids = new Map();
  let f = ctx.ids.get(e.id);
  if (!f){
    let data = null, type = 'png ', name = String(e.name || 'image');
    if (e.type === 'image'){
      const u = e.image.toDataURL('image/png'), b = atob(u.slice(u.indexOf(',') + 1)); data = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) data[i] = b.charCodeAt(i);
      if (!/\.png$/i.test(name)) name = name.replace(/\.[a-z0-9]+$/i, '') + '.png';
    } else {                                                             // 内嵌文件（分层）⇒ 内嵌一份 PSD（里面照样分层、可再有智能对象）
      data = Smart.withSubDoc(e, () => psdEncodeDoc(true, {nested:true, patterns:ctx.bakePatterns ? 'bake' : undefined})); type = '8BPS'; name = name.replace(/\.[a-z0-9]+$/i, '') + '.psd';
    }
    const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16));
    f = {id, name, type, data, w:e.w, h:e.h}; ctx.ids.set(e.id, f); (ctx.linked = ctx.linked || []).push(f);
  }
  const P = (x, y) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
  return {id:f.id, w:f.w, h:f.h, corners:[...P(0, 0), ...P(f.w, 0), ...P(f.w, f.h), ...P(0, f.h)]};
}
/* 像素层（文字层…）的矢量蒙版 ⇒ {paths:[{closed, knots}]（文件坐标）, inverted, enabled, linked}；画不成贝兹的形状 ⇒ null */
function psdVmaskOf(L){
  const vm = L.vmask; if (!vm || !window.VecSel) return null;
  const off = vm.linked !== false ? [(L.x || 0) - (vm.ax || 0), (L.y || 0) - (vm.ay || 0)] : [0, 0], paths = [];
  const leaf = s => {
    if (s.type === 'group' || s.type === 'compound'){ for (const c of s.children || []) if (!leaf(c)) return false; return true; }
    const g = VecSel.asBezier(s); if (!g || !g.anchors || g.anchors.length < 2) return false;
    paths.push(psdKnots(g, off)); return true;
  };
  for (const s of (vm.shapes || []).filter(s => s && s.visible !== false)) if (!leaf(s)) return null;
  return {paths, evenOdd:false, inverted:!!vm.inverted, enabled:vm.enabled !== false, linked:vm.linked !== false};
}
/* 贝兹（VecSel.asBezier 那份）⇒ PSD 路径的锚点（前控制点、锚点、后控制点；加位移） */
function psdKnots(g, off){
  const segs = VecSel.segments(g), n = g.anchors.length, P = p => [p[0] + off[0], p[1] + off[1]];
  return {closed:!!g.closed, knots:g.anchors.map((a, k) => {
    const A = [a.x, a.y], post = segs[k] ? segs[k].c1 : A, pre = g.closed ? segs[(k - 1 + n) % n].c2 : (k > 0 && segs[k - 1] ? segs[k - 1].c2 : A);
    return {pre:P(pre), a:P(A), post:P(post)};
  })};
}
/* 文件的工作路径（Doc.workPath）⇒ PSD 存储路径 */
function psdPathsOf(){
  const wp = Doc.workPath; if (!wp || !Array.isArray(wp.subpaths) || !wp.subpaths.length || !window.VecSel) return [];
  const paths = [];
  for (const sp of wp.subpaths){ if (!sp || !Array.isArray(sp.anchors) || sp.anchors.length < 2) continue; const g = VecSel.asBezier({type:'bezier', closed:!!sp.closed, anchors:sp.anchors}); if (g && g.anchors && g.anchors.length >= 2) paths.push(psdKnots(g, [0, 0])); }
  // 资源名是 Pascal 字串（PS 照系统码页读，没有 Unicode 版）⇒ 只写 ASCII，免得中文 Windows 上成乱码
  return paths.length ? [{name:'Work Path', evenOdd:false, paths}] : [];
}
/* 档内配置文件（Doc.iccProfile＝内建 id）⇒ ICC v4 位元组（矩阵＋TRC 的 RGB 显示器配置文件：desc、cprt、wtpt、r/g/bXYZ、r/g/bTRC·para）；
   灰度／Lab／CMYK 的配置文件不进 RGB 的 PSD ⇒ null */
function psdIccOf(){
  const id = Doc.iccProfile; if (!id || !window.PsEdit || !PsEdit.color || !PsEdit.color.builtin) return null;
  let P; try { P = PsEdit.color.builtin(id); } catch (e){ return null; }
  if (!P || P.space !== 'rgb' || !Array.isArray(P.matrix) || !Array.isArray(P.trc)) return null;
  const s15 = v => { const x = Math.round(v * 65536); return x < 0 ? x + 0x100000000 : x; };
  const be = (n, v) => { const a = []; for (let i = n - 1; i >= 0; i--) a.push(Math.floor(v / Math.pow(256, i)) & 255); return a; };
  const asc = s => Array.from(s).map(c => c.charCodeAt(0) & 255);
  const mluc = s => { const u = []; for (const c of String(s)) u.push(c.charCodeAt(0) >> 8, c.charCodeAt(0) & 255); return [...asc('mluc'), 0, 0, 0, 0, ...be(4, 1), ...be(4, 12), ...asc('enUS'), ...be(4, u.length), ...be(4, 28), ...u]; };
  const xyz = v => [...asc('XYZ '), 0, 0, 0, 0, ...v.flatMap(x => be(4, s15(x)))];
  const para = c => {
    if (c.t === 'para'){ const n = c.kind === 0 ? 1 : c.kind === 1 ? 3 : c.kind === 2 ? 4 : c.kind === 3 ? 5 : 7; return [...asc('para'), 0, 0, 0, 0, ...be(2, c.kind), 0, 0, ...c.p.slice(0, n).flatMap(x => be(4, s15(x)))]; }
    return [...asc('para'), 0, 0, 0, 0, 0, 0, 0, 0, ...be(4, s15(c.t === 'gamma' ? c.g : 1))];
  };
  const M = P.matrix, col = j => [M[0][j], M[1][j], M[2][j]];
  const tags = [['desc', mluc(P.description)], ['cprt', mluc('No copyright, use freely')], ['wtpt', xyz(P.white || [0.9642, 1, 0.8249])],
    ['rXYZ', xyz(col(0))], ['gXYZ', xyz(col(1))], ['bXYZ', xyz(col(2))], ['rTRC', para(P.trc[0])], ['gTRC', para(P.trc[1])], ['bTRC', para(P.trc[2])]];
  let off = 128 + 4 + tags.length * 12; const table = [], body = [];
  for (const [sig, d] of tags){ table.push(...asc(sig), ...be(4, off), ...be(4, d.length)); const pd = (4 - d.length % 4) % 4; body.push(...d, ...new Array(pd).fill(0)); off += d.length + pd; }
  const size = off, now = new Date();
  const hdr = [...be(4, size), 0, 0, 0, 0, 0x04, 0x30, 0, 0, ...asc('mntrRGB XYZ '), ...[now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()].flatMap(v => be(2, v)),
    ...asc('acsp'), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...[0.9642, 1, 0.8249].flatMap(x => be(4, s15(x))), 0, 0, 0, 0];
  while (hdr.length < 128) hdr.push(0);
  return new Uint8Array([...hdr, ...be(4, tags.length), ...table, ...body]);
}
const PSD_FONTS = {'arial':['ArialMT', 'Arial-BoldMT'], 'helvetica':['Helvetica', 'Helvetica-Bold'], 'times new roman':['TimesNewRomanPSMT', 'TimesNewRomanPS-BoldMT'],
  'courier new':['CourierNewPSMT', 'CourierNewPS-BoldMT'], 'georgia':['Georgia', 'Georgia-Bold'], 'verdana':['Verdana', 'Verdana-Bold'],
  'microsoft jhenghei':['MicrosoftJhengHeiRegular', 'MicrosoftJhengHeiBold'], 'microsoft yahei':['MicrosoftYaHei', 'MicrosoftYaHei-Bold'],
  'pingfang tc':['PingFangTC-Regular', 'PingFangTC-Semibold'], 'pingfang sc':['PingFangSC-Regular', 'PingFangSC-Semibold']};
function psdFontName(d, text){
  const fam = String(d.font || 'sans-serif').split(',')[0].trim().replace(/^["']|["']$/g, ''), low = fam.toLowerCase();
  const bold = /bold|^[6-9]00$/i.test(String(d.weight || ''));
  if (PSD_FONTS[low]) return {name:PSD_FONTS[low][bold ? 1 : 0], faux:false};
  if (/^(sans-serif|system-ui|ui-sans-serif|-apple-system)$/.test(low)){
    if (/[　-鿿豈-﫿]/.test(text)) return {name:window.Lang && Lang.cur === 'zh-Hans' ? 'MicrosoftYaHei' : 'MicrosoftJhengHeiRegular', faux:bold};
    return {name:bold ? 'Arial-BoldMT' : 'ArialMT', faux:false};
  }
  if (/^(serif|ui-serif)$/.test(low)) return {name:bold ? 'TimesNewRomanPS-BoldMT' : 'TimesNewRomanPSMT', faux:false};
  if (/^(monospace|ui-monospace)$/.test(low)) return {name:bold ? 'CourierNewPS-BoldMT' : 'CourierNewPSMT', faux:false};
  return {name:fam.replace(/\s+/g, '') + (bold ? '-Bold' : '-Regular'), faux:false};
}
function psdTextOf(L){
  const d = L.data;
  if (!d || d.warp || (window.TouchType && TouchType.touched(L)) || psdAlpha(d.color) < 1) return null;
  // 段落文字（data.box）照原字写、框交给 PS 折行；点文字照画面的行（硬换行）
  const bx = d.box && +d.box.w > 0 && +d.box.h > 0 ? d.box : null;
  const lines = bx ? String(d.text).split('\n') : (window.TypeTool && TypeTool.wrapLines) ? TypeTool.wrapLines(d) : String(d.text).split('\n');
  const text = lines.join('\n'); if (!text.trim()) return null;
  const f = psdFontName(d, text), al = String(d.align || 'left'), size = +d.size || 12;
  // 行距：没设 ⇒ 自动行距（多行照我们渲染器的 1.25 倍）；设了且等于读入时记下的自动比例×字号 ⇒ 仍是自动；其余固定
  const lead = +d.leading > 0 ? +d.leading : 0, ar = +d.autoLeading > 0 ? +d.autoLeading : 0;
  const autoLeading = !lead ? (bx || lines.length > 1 ? 1.25 : 0) : ar && Math.abs(lead - ar * size) < 0.01 ? ar : 0;
  const t = {text, font:f.name, size, color:psdRgb(d.color), just:al === 'center' ? 2 : (al === 'right' || al === 'end') ? 1 : 0,
    x:(bx ? +bx.x : +d.x || 0) + (L.x || 0), y:(bx ? +bx.y : +d.y || 0) + (L.y || 0), leading:lead, leadingType:d.leadingType === 1 ? 1 : 0,
    fauxBold:!!d.fauxBold || f.faux, fauxItalic:!!d.fauxItalic, tracking:+d.tracking || 0};
  if (autoLeading) t.autoLeading = autoLeading;
  if (bx) t.box = {w:+bx.w, h:+bx.h};
  // TySh 的 bounds（排版框：点文字＝各行前进宽×首行上伸到末行下伸；段落文字＝框）与 boundingBox（字墨框），相对原点、未经仿射
  const lay = window.TypeTool && TypeTool.layout ? TypeTool.layout(L) : null;
  if (lay && lay.lines.length){
    const ox = t.x, oy = t.y, cs = Array.from(String(d.text)), mc = mkCanvas(1, 1).getContext('2d');
    mc.font = `${d.weight || 'normal'} ${size}px ${d.font}`;   // 跟 TypeTool 量字用的同一个字型串
    const first = lay.lines[0], last = lay.lines[lay.lines.length - 1];
    t.bounds = bx ? [0, 0, +bx.w, +bx.h] : [Math.min(...lay.lines.map(l => l.x0)) - ox, first.baseline - lay.asc - oy, Math.max(...lay.lines.map(l => l.x1)) - ox, last.baseline + lay.desc - oy];
    let ink = null;
    for (const l of lay.lines){
      const s = cs.slice(l.start, l.end).join('').replace(/\s+$/, ''); if (!s.trim()) continue;
      const m = mc.measureText(s), r = [l.x0 - m.actualBoundingBoxLeft - ox, l.baseline - m.actualBoundingBoxAscent - oy, l.x0 + m.actualBoundingBoxRight - ox, l.baseline + m.actualBoundingBoxDescent - oy];
      ink = ink ? [Math.min(ink[0], r[0]), Math.min(ink[1], r[1]), Math.max(ink[2], r[2]), Math.max(ink[3], r[3])] : r;
    }
    if (ink) t.boundingBox = ink;
  }
  // 旋转／斜切（data.xform）⇒ TySh 的仿射：线性部分照搬，位移＝基线起点（段落文字：框左上）变形后的位置（psdTextLayer 读回的逆算）
  const M = window.TextXform && TextXform.doc(L);
  if (M){ [t.x, t.y] = TextXform.apply(M, t.x, t.y); t.transform = [M[0], M[1], M[2], M[3], t.x, t.y]; }
  return t;
}
function psdShapeOf(L){
  const shapes = (L.data && L.data.shapes || []).filter(s => s && s.visible !== false);
  if (!shapes.length || !window.VecSel) return null;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let fill, stroke, evenOdd = null; const paths = [];
  const leaf = (s, owner) => {
    const g = VecSel.asBezier(s); if (!g || !g.anchors || g.anchors.length < 2) return false;
    const segs = VecSel.segments(g), n = g.anchors.length, ox = L.x || 0, oy = L.y || 0, P = p => [p[0] + ox, p[1] + oy];
    const knots = g.anchors.map((a, k) => {
      const A = [a.x, a.y];
      const post = segs[k] ? segs[k].c1 : A, pre = g.closed ? segs[(k - 1 + n) % n].c2 : (k > 0 && segs[k - 1] ? segs[k - 1].c2 : A);
      return {pre:P(pre), a:P(A), post:P(post)};
    });
    paths.push({closed:!!g.closed, knots}); return true;
  };
  for (const s of shapes){
    if (s.type === 'group' || (s.opacity !== undefined && +s.opacity !== 1)) return null;
    if ((s.fill && typeof s.fill === 'object') || (s.stroke && typeof s.stroke === 'object')) return null;
    const f = s.fill && !/^(none|transparent)$/i.test(s.fill) ? s.fill : null, sw = +s.strokeWidth || 0;
    const st = sw > 0 && s.stroke && !/^(none|transparent)$/i.test(s.stroke) ? {color:s.stroke, width:sw} : null;
    if (st){                                                             // 描边的对齐、端点、转角、虚线（像素）：有设才带
      if (s.strokeAlign === 'inside' || s.strokeAlign === 'outside') st.align = s.strokeAlign;
      if (s.cap) st.cap = s.cap; if (s.join) st.join = s.join;
      if (Array.isArray(s.dash) && s.dash.some(v => +v > 0)) st.dash = s.dash.map(Number);
    }
    if ((f && psdAlpha(f) < 1) || (st && psdAlpha(st.color) < 1)) return null;
    if (fill === undefined){ fill = f; stroke = st; } else if (!same(f, fill) || !same(st, stroke)) return null;
    const eo = s.type === 'compound' && s.rule === 'evenodd';
    if (evenOdd === null) evenOdd = eo; else if (evenOdd !== eo) return null;
    const ok = s.type === 'compound' ? (s.children || []).every(c => c.type !== 'group' && c.type !== 'compound' && leaf(c)) : leaf(s);
    if (!ok) return null;
  }
  if (!fill && !stroke) return null;
  return {fill:fill ? psdRgb(fill) : null, stroke:stroke ? Object.assign({}, stroke, {color:psdRgb(stroke.color)}) : null, evenOdd:!!evenOdd, paths};
}
/* 这层连样式、蒙版照画面画（文件大小）：不透明度与混合另记在层上 */
function psdBaked(L){
  const c = mkCanvas(Doc.width, Doc.height), keep = [L.visible, L.opacity, L.blend];
  L.visible = true; L.opacity = 1; L.blend = 'normal';
  try { compositeOne(ctx2d(c), L, 1); } finally { L.visible = keep[0]; L.opacity = keep[1]; L.blend = keep[2]; }
  return c;
}
/* o.nested＝智能对象里的内嵌文件（参考线、路径、配置文件是母文件的，不写）；o.patterns:'bake'＝图案叠加／纹理画成像素、不写文件级 Patt（保底）；o.pattLayout 只给复测样品换 Patt 写法 */
function psdEncodeDoc(withLayers, o){
  if (!window.PsdIO) throw new PsBad('PSD codec not loaded');
  const nested = !!(o && o.nested), ctx = {linked:[], bakePatterns:!!(o && o.patterns === 'bake')};
  const items = withLayers ? psdItemsOf(ctx) : [];
  const guides = nested ? [] : (Array.isArray(Doc.aiGuides) ? Doc.aiGuides : []).map(g => ({vertical:!!g.vertical, pos:+g.pos}));
  return PsdIO.encode({width:Doc.width, height:Doc.height, dpi:Doc.dpi || 72, merged:rgbaOfCanvas(renderDoc({})), items, psb:!!(o && o.psb),
    guides, paths:nested ? [] : psdPathsOf(), icc:nested ? null : psdIccOf(), linked:ctx.linked, pattLayout:o && o.pattLayout});
}
/* 文件 ⇒ PSD 图层清单（下→上·组照 PSD：组结束、子层、组）：每层像素（文件大小）＋文字／形状／样式／调整／智能对象／矢量蒙版的活资料；ORA 也照这份写（不给 ctx＝不做智能对象） */
function psdItemsOf(ctx){
  const W = Doc.width, H = Doc.height, items = [];
  const base = L => ({name:L.name, opacity:L.opacity === undefined ? 1 : L.opacity, blend:L.blend || 'normal', hidden:!L.visible, mask:psdMaskOf(L), blendIf:BlendIf.isDefault(L.blendIf) ? null : L.blendIf});
  const walk = list => { for (const L of list){
    if (L._sigSkip) continue;
    if (L.kind === 'group'){ items.push({kind:'groupEnd'}); walk(Groups.children(L)); const fx = psdFxOf(L, ctx && ctx.bakePatterns); items.push(Object.assign(base(L), {kind:'group', open:!(L.data && L.data.expanded === false)}, Array.isArray(fx) ? {fx} : {})); continue; }
    // 调整图层：没像素、写调整资源块（蒙版、不透明度、混合、剪贴照写）
    if (L.adjust){ const a = psdAdjOf(L); if (a){ const it = Object.assign(base(L), {kind:'layer', rgba:null, clipped:!!L.clipped, fillOpacity:L.fillOpacity, adjust:a}); const vm = psdVmaskOf(L); if (vm) it.vmask = vm; items.push(it); continue; } }
    const fx = psdFxOf(L, ctx && ctx.bakePatterns), bake = fx === 'bake';
    let rgba = null; try { rgba = rgbaOfCanvas(bake ? psdBaked(L) : docSpace(renderLayer(L, 1), L)); } catch (e){ console.warn('psd layer', L.name, e); }
    const it = Object.assign(base(L), {kind:'layer', rgba, clipped:!!L.clipped, fillOpacity:bake ? 1 : L.fillOpacity});
    if (bake) it.mask = null;   // 蒙版已画进像素
    else {
      if (fx) it.fx = fx;
      try { if (L.kind === 'text'){ const t = psdTextOf(L); if (t) it.text = t; } else if (L.kind === 'vector'){ const s = psdShapeOf(L); if (s) it.shape = s; }
        else if (L.kind === 'smart'){ const s = psdSmartOf(L, ctx); if (s) it.smart = s; } }
      catch (e){ console.warn('psd live layer', L.name, e); }
      try { if (L.vmask && !it.shape){ const vm = psdVmaskOf(L); if (vm) it.vmask = vm; } } catch (e){ console.warn('psd vector mask', L.name, e); }
    }
    items.push(it);
  } };
  walk(Groups.any() ? Groups.topLevel() : Doc.layers);
  return items;
}
/* ── OpenRaster（.ora·Krita、GIMP、MyPaint 都开得了；写在 menus/impl/raster-io.js）──
   组＝巢状 stack、可见性、不透明度、混合模式（ORA 有的那几种；其余存成一般）；文字、矢量、样式照画面成像素；
   图层蒙版画进那层的透明度（ORA 没有蒙版）；剪贴蒙版照像素存（ORA 没有剪贴）。→ {bytes, notes} */
async function oraEncodeDoc(){
  if (!window.RasterIO) throw new PsBad('OpenRaster writer (raster-io.js) not loaded');
  const W = Doc.width, H = Doc.height, items = psdItemsOf(), notes = new Set(), root = [], stack = [root];
  for (const it of items){
    if (it.kind === 'groupEnd'){ stack.push([]); continue; }
    if (it.kind === 'group'){ const kids = stack.length > 1 ? stack.pop() : []; stack[stack.length - 1].push({kind:'group', name:it.name, hidden:it.hidden, opacity:it.opacity, blend:it.blend, children:kids}); if (it.mask) notes.add(L3('組蒙版沒存進去（ORA 沒有蒙版）', '组蒙版没存进去（ORA 没有蒙版）', 'group masks were dropped (ORA has no masks)')); continue; }
    let rgba = it.rgba || new Uint8ClampedArray(W * H * 4);
    if (it.mask && it.mask.alpha && it.mask.enabled !== false){ rgba = new Uint8ClampedArray(rgba); const a = it.mask.alpha; for (let i = 0; i < W * H; i++) rgba[i * 4 + 3] = Math.round(rgba[i * 4 + 3] * a[i] / 255); notes.add(L3('圖層蒙版已畫進透明度', '图层蒙版已画进透明度', 'layer masks were merged into the layer')); }
    if (it.clipped) notes.add(L3('剪貼蒙版照像素存（ORA 沒有剪貼）', '剪贴蒙版照像素存（ORA 没有剪贴）', 'clipping masks were saved as plain layers'));
    const box = cropBox(rgba, W, H);
    stack[stack.length - 1].push(Object.assign({kind:'raster', name:it.name, hidden:it.hidden, opacity:it.opacity, blend:it.blend}, box));
  }
  const r = await RasterIO.encodeOra({width:W, height:H, dpi:Doc.dpi || 72, layers:root, merged:rgbaOfCanvas(renderDoc({}))});
  return {bytes:r.bytes, notes:[...notes, ...r.notes]};
}
function cropBox(rgba, W, H){
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++){ const r = y * W; for (let x = 0; x < W; x++) if (rgba[(r + x) * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  if (x1 < 0) return {x:0, y:0, w:1, h:1, rgba:new Uint8ClampedArray(4)};
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(rgba.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4);
  return {x:x0, y:y0, w, h, rgba:out};
}
/* ── Illustrator 分层档（.ai）：一个档里两份资料──
   ① PDF 外观（PDF 阅读器与别的软件看这份）：每个图层一个 PDF 图层（OCG·名字照图层名·藏起来的层预设关着）；组＝嵌套图层（组本身有不透明度／混合模式／蒙版／样式 ⇒ 整组照画面嵌成一张图）。
      向量层（纯色填色／描边、编组、复合路径、剪切组）⇒ 真路径；文字层（没修饰、没样式、没蒙版）⇒ 文字（字体只写名字、不内嵌）；
      其余（像素层、带样式／蒙版的层、渐变填色、智能对象…）⇒ 照画面嵌成一张图（只留有像素的那一块·带透明）。不透明度、混合模式写进图形状态。
   ② Illustrator 原生资料（页面 /PieceInfo /Illustrator /Private 的 AIMetaData＋AIPrivateData1…N）：Illustrator 打开 .ai 时读这份、不读 PDF。
      内容是 Illustrator 的文字型档格式（Adobe Illustrator File Format Specification 7.0：图层 Lb/Ln/LB、编组 u/U、复合路径 *u/*U、剪切组 q/Q、
      路径 m/l/c＋f/s/b/S/B/F、点文字 To/Tp/Tx/TO、字体 TZ/Tf、点阵 XI；加 9 版以后的 Xy〔混合模式 不透明度 隔离 挖空 形状〕、XR〔奇偶填色〕、
      子图层＝Lb…LB 嵌套、XI 的 alpha 通道），一层对一个 Illustrator 图层（名字照原样·藏起来的层 visible＝0）、组＝子图层；
      向量层 ⇒ 可编辑路径（不透明度＝图层×形状×填色 alpha，混合模式照图层）；文字层 ⇒ 点文字（Illustrator 当旧版文字读进来、会问要不要更新；
      非 ASCII 字：字全在 GB2312 里且字体是简体字体或有简体专有字 ⇒ 整串一段 GB2312（复合字体 <字名>-GB-EUC-H）；
      否则逐字挑字码分段：Big5 编得了的字走 Big5 段（微软正黑、字体名不带 CMap）、只有 GB2312 编得了的走 GB2312 段，
      两段 TZ 的 script 码都写 2，本机没这字体就照缺字体替换）；
      PDF 那份嵌图的层 ⇒ 嵌入点阵（RGB；带透明的 RGB 后接一面 alpha，色彩空间码标明带 alpha）。
      版本戳 CreatorVersion 15／ContainerVersion 9（CS5 相容档）：图层名照 UTF-8 读；画板＝%AI3_Cropmarks（照写的数读，左上角在原点、y 往下为负）。
      档里没有文件字典的尺规原点时，Illustrator 读物件坐标会整体往上加一个画板高（跟 %%PageOrigin 无关）⇒ 物件 y 写成 -(y+H)，读进来正好落在画板里。
      o.native：'cs'（预设）／'none'＝只写 PDF 外观。
   1 px＝1 pt（72 ppi）：画板尺寸跟文件像素一样。 → {bytes, notes:[带不过去的项]} */
async function aiEncodeDoc(o){
  const W = Doc.width, H = Doc.height, te = new TextEncoder(), f = v => +(+v).toFixed(3);
  const objs = [], add = parts => { objs.push(parts); return objs.length; }, reserve = () => add(null);
  const catalog = reserve(), pagesObj = reserve(), pageObj = reserve();
  const notes = new Set(), UNSUP = {};
  const pdfStr = s => { s = String(s); let h = 'FEFF'; for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0'); return `<${h}>`; };
  const pdfName = s => '/' + [...te.encode(s)].map(b => b > 0x20 && b < 0x7f && !'#()<>[]{}/%'.includes(String.fromCharCode(b)) ? String.fromCharCode(b) : '#' + b.toString(16).padStart(2, '0')).join('');
  const deflate = async u8 => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const stream = (dict, data) => add([te.encode(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, te.encode('\nendstream')]);
  const obj = s => add([te.encode(s)]);
  // 原生资料的坐标：画板 y∈[-H,0]、物件 y 写 -y-H（读进来加一个画板高后落在 [-H,0]）
  const NV = o && o.native !== undefined ? o.native : 'cs';
  if (!['cs', 'none'].includes(NV)) throw new PsBad(`unknown native variant ${NV}`);
  const nat = NV === 'none' ? null : {};
  const NY = y => -y - H;
  // 颜色：任何 CSS 色 ⇒ [r, g, b, a]（0..1）
  const cx = ctx2d(mkCanvas(1, 1)), mx = ctx2d(mkCanvas(1, 1));
  const rgba = c => { cx.fillStyle = '#000'; cx.fillStyle = String(c); const s = cx.fillStyle;
    if (s[0] === '#') return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255).concat([1]);
    const m = s.match(/[\d.]+/g) || [0, 0, 0, 1]; return [m[0] / 255, m[1] / 255, m[2] / 255, m[3] === undefined ? 1 : +m[3]]; };
  const noPaint = p => p === undefined || p === null || p === '' || /^(none|transparent)$/i.test(String(p));
  // 图形状态：不透明度＋混合模式
  const BM = {normal:'Normal', multiply:'Multiply', screen:'Screen', overlay:'Overlay', darken:'Darken', lighten:'Lighten', colordodge:'ColorDodge', colorburn:'ColorBurn',
    hardlight:'HardLight', softlight:'SoftLight', difference:'Difference', exclusion:'Exclusion', hue:'Hue', saturation:'Saturation', color:'Color', luminosity:'Luminosity'};
  const bmOf = b => { b = String(b || 'normal'); if (b === 'passThrough') return 'Normal'; const v = BM[b.toLowerCase().replace(/[^a-z]/g, '')]; if (!v){ notes.add(`blend mode ${b} written as Normal`); return 'Normal'; } return v; };
  const gsMap = new Map(), gsRes = [];
  const gs = (ca, CA, bm) => { const k = `${f(ca)}|${f(CA)}|${bm}`;
    if (!gsMap.has(k)){ const n = 'GS' + gsMap.size; gsMap.set(k, n); gsRes.push(`/${n} ${obj(`<< /Type /ExtGState /ca ${f(ca)} /CA ${f(CA)} /BM /${bm} >>`)} 0 R`); }
    return `/${gsMap.get(k)} gs`; };
  // 字体：纯 ASCII＋通用字族 ⇒ 标准 14 字；其余 ⇒ Type0（UniGB-UTF16-H·不内嵌·字名照图层字体）＋ToUnicode
  const fonts = new Map(), fontRes = [];
  const GENERIC = /^(sans-serif|serif|monospace|system-ui|cursive|fantasy|ui-sans-serif|ui-serif|ui-monospace|-apple-system)$/i;
  const famOf = font => String(font || 'sans-serif').split(',')[0].trim().replace(/^["']|["']$/g, '');
  let toUni = 0;
  const toUnicode = () => { if (toUni) return toUni; const r = [];
    for (let h = 0; h < 256; h++){ if (h >= 0xd8 && h <= 0xdf) continue; const x = h.toString(16).padStart(2, '0'); r.push(`<${x}00> <${x}ff> <${x}00>`); }
    let body = ''; for (let i = 0; i < r.length; i += 100){ const part = r.slice(i, i + 100); body += `${part.length} beginbfrange\n${part.join('\n')}\nendbfrange\n`; }
    const cm = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n${body}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
    return (toUni = stream('', te.encode(cm))); };
  const font = (k, mk, enc) => { if (!fonts.has(k)){ const n = 'F' + fonts.size, id = obj(mk()); fontRes.push(`/${n} ${id} 0 R`); fonts.set(k, {n, enc}); } return fonts.get(k); };
  const hex16 = s => { let h = '<'; for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0'); return h + '>'; };
  const fontFor = (d, ascii) => {
    const fam = famOf(d.font), bold = /bold|^[6-9]00$/i.test(String(d.weight || '')), generic = GENERIC.test(fam);
    if (generic && ascii){
      const base = /mono/i.test(fam) ? (bold ? 'Courier-Bold' : 'Courier') : /^(ui-)?serif$/i.test(fam) ? (bold ? 'Times-Bold' : 'Times-Roman') : (bold ? 'Helvetica-Bold' : 'Helvetica');
      return font(base, () => `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`, s => '(' + s.replace(/[\\()]/g, m => '\\' + m) + ')');
    }
    const ps = generic ? (bold ? 'AdobeHeitiStd-Regular' : 'AdobeSongStd-Light') : fam.replace(/\s+/g, '') + (bold ? '-Bold' : '-Regular');
    return font('T0|' + ps + '|' + d.font + '|' + (d.weight || ''), () => {
      mx.font = `${d.weight || 'normal'} 1000px ${d.font || 'sans-serif'}`;
      const w = []; for (let c = 32; c < 127; c++) w.push(Math.round(mx.measureText(String.fromCharCode(c)).width));
      const desc = obj(`<< /Type /FontDescriptor /FontName ${pdfName(ps)} /Flags 4 /FontBBox [-200 -200 1200 1000] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>`);
      const cid = obj(`<< /Type /Font /Subtype /CIDFontType0 /BaseFont ${pdfName(ps)} /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 5 >> /FontDescriptor ${desc} 0 R /DW 1000 /W [1 [${w.join(' ')}]] >>`);
      return `<< /Type /Font /Subtype /Type0 /BaseFont ${pdfName(ps)} /Encoding /UniGB-UTF16-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUnicode()} 0 R >>`;
    }, hex16);
  };
  // 向量：VecSel 把每种形状转成贝兹锚点（DXF 汇出同一支）；y 轴翻成 PDF 的朝上
  const pathOf = (s, ox, oy) => {
    if (s.type === 'group' || s.type === 'compound') return (s.children || []).map(k => pathOf(k, ox, oy)).join(' ');
    const g = window.VecSel && VecSel.asBezier(s); if (!g || !g.anchors || !g.anchors.length) throw UNSUP;
    const P = (x, y) => `${f(x + ox)} ${f(H - (y + oy))}`;
    let o = `${P(g.anchors[0].x, g.anchors[0].y)} m`;
    for (const c of VecSel.segments(g)){
      const straight = c.c1[0] === c.p0[0] && c.c1[1] === c.p0[1] && c.c2[0] === c.p3[0] && c.c2[1] === c.p3[1];
      o += straight ? ` ${P(c.p3[0], c.p3[1])} l` : ` ${P(c.c1[0], c.c1[1])} ${P(c.c2[0], c.c2[1])} ${P(c.p3[0], c.p3[1])} c`;
    }
    return g.closed ? o + ' h' : o;
  };
  const paintOps = (s, ox, oy, op, bm) => {
    if ((s.fill && typeof s.fill === 'object') || (s.stroke && typeof s.stroke === 'object')) throw UNSUP;   // 渐变／图样 ⇒ 整层嵌图
    const fc = noPaint(s.fill) ? null : rgba(s.fill), sw = +s.strokeWidth || 0, sc = sw > 0 && !noPaint(s.stroke) ? rgba(s.stroke) : null;
    if ((!fc || !fc[3]) && (!sc || !sc[3])) return '';
    const ev = s.type === 'compound' && s.rule === 'evenodd', so = op * (s.opacity === undefined ? 1 : +s.opacity);
    let o = `q ${gs(so * (fc ? fc[3] : 1), so * (sc ? sc[3] : 1), bm)}`;
    if (fc) o += ` ${f(fc[0])} ${f(fc[1])} ${f(fc[2])} rg`;
    if (sc) o += ` ${f(sc[0])} ${f(sc[1])} ${f(sc[2])} RG ${f(sw)} w 1 J 1 j`;
    return o + ` ${pathOf(s, ox, oy)} ${fc && sc ? (ev ? 'B*' : 'B') : fc ? (ev ? 'f*' : 'f') : 'S'} Q`;
  };
  const shapeOps = (s, ox, oy, op, bm) => {
    if (!s || s.visible === false) return '';
    if (s.type !== 'group') return paintOps(s, ox, oy, op, bm);
    const kids = s.children || [];
    if (!s.clip || !kids.length) return kids.map(k => shapeOps(k, ox, oy, op, bm)).join(' ');
    const c = kids[0], ev = c.type === 'compound' && c.rule === 'evenodd';                 // 剪切组：第一个形状剪住其余
    return `q ${pathOf(c, ox, oy)} ${ev ? 'W*' : 'W'} n ${kids.slice(1).map(k => shapeOps(k, ox, oy, op, bm)).join(' ')} Q`;
  };
  const textOps = (L, op, bm) => {
    const d = L.data, size = +d.size || 12, lines = (window.TypeTool && TypeTool.wrapLines) ? TypeTool.wrapLines(d) : String(d.text).split('\n');
    const c = rgba(d.color || '#000'), al = String(d.align || 'left');
    mx.font = `${d.weight || 'normal'} ${size}px ${d.font || 'sans-serif'}`;
    let o = `q ${gs(op * c[3], op * c[3], bm)} ${f(c[0])} ${f(c[1])} ${f(c[2])} rg BT`;
    lines.forEach((line, i) => {
      if (!line) return;
      const F = fontFor(d, /^[\x20-\x7e]*$/.test(line)), w = mx.measureText(line).width;
      const dx = al === 'center' ? -w / 2 : (al === 'right' || al === 'end') ? -w : 0;
      o += ` /${F.n} ${f(size)} Tf 1 0 0 1 ${f(d.x + (L.x || 0) + dx)} ${f(H - (d.y + (L.y || 0) + i * (+d.leading > 0 ? +d.leading : size * 1.25)))} Tm ${F.enc(line)} Tj`;
    });
    return o + ' ET Q';
  };
  // 照画面嵌图：只留有像素的外框（RGB＋透明）；PDF 用 SMask，原生资料用 XI 的 alpha 通道
  const cropOf = c => {
    const d = rgbaOfCanvas(c), cw = c.width, ch = c.height;
    let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (d[(y * cw + x) * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, rgb = new Uint8Array(w * h * 3), a = new Uint8Array(w * h); let hasA = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const i = ((y + y0) * cw + x + x0) * 4, j = y * w + x;
      rgb[j * 3] = d[i]; rgb[j * 3 + 1] = d[i + 1]; rgb[j * 3 + 2] = d[i + 2]; a[j] = d[i + 3]; if (d[i + 3] !== 255) hasA = true;
    }
    return {x0, y0, w, h, rgb, a, hasA};
  };
  let imN = 0; const xo = [];
  const imageOps = async cr => {
    if (!cr) return '';
    const {x0, y0, w, h, rgb, a, hasA} = cr;
    const sm = hasA ? stream(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, await deflate(a)) : 0;
    const im = stream(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${sm ? ` /SMask ${sm} 0 R` : ''}`, await deflate(rgb));
    const n = 'Im' + (imN++); xo.push(`/${n} ${im} 0 R`);
    return `q ${w} 0 0 ${h} ${x0} ${H - y0 - h} cm /${n} Do Q`;
  };
  // 这层照画面画出来（不透明度、混合另写进图形状态 ⇒ 这里先当 100%、正常）
  const seen = L => {
    const c = mkCanvas(W, H), keep = [L.visible, L.opacity, L.blend];
    L.visible = true; L.opacity = 1; L.blend = 'normal';
    try { compositeOne(ctx2d(c), L, 1); } finally { L.visible = keep[0]; L.opacity = keep[1]; L.blend = keep[2]; }
    return c;
  };
  /* 原生资料的写法（字串是一个字元一个位元组；图层名写 UTF-8 位元组，中文字写 Big5／GB2312 位元组） */
  const AIBM = {Normal:0, Multiply:1, Screen:2, Overlay:3, SoftLight:4, HardLight:5, ColorDodge:6, ColorBurn:7, Darken:8, Lighten:9, Difference:10, Exclusion:11,
    Hue:12, Saturation:13, Color:14, Luminosity:15};
  const psStr = bytes => { let s = '('; for (const b of bytes){
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += '\\' + String.fromCharCode(b);
    else if (b < 0x20 || b === 0x7f) s += '\\' + b.toString(8).padStart(3, '0');
    else s += String.fromCharCode(b);
  } return s + ')'; };
  const xy = (bm, op) => `${AIBM[bm] || 0} ${f(Math.max(0, Math.min(1, op)))} 0 0 0 Xy\n`;
  // 填色 Xa／描边 XA：r g b（0..1）
  const colOp = (c, opr) => `${f(c[0])} ${f(c[1])} ${f(c[2])} ${opr}\n`;
  const natPaths = (s, ox, oy) => {
    if (s.type === 'group' || s.type === 'compound') return [].concat(...(s.children || []).map(k => natPaths(k, ox, oy)));
    const g = window.VecSel && VecSel.asBezier(s); if (!g || !g.anchors || !g.anchors.length) throw UNSUP;
    const P = (x, y) => `${f(x + ox)} ${f(NY(y + oy))}`;
    let d = `${P(g.anchors[0].x, g.anchors[0].y)} m\n`;
    for (const c of VecSel.segments(g)){
      const straight = c.c1[0] === c.p0[0] && c.c1[1] === c.p0[1] && c.c2[0] === c.p3[0] && c.c2[1] === c.p3[1];
      d += straight ? `${P(c.p3[0], c.p3[1])} l\n` : `${P(c.c1[0], c.c1[1])} ${P(c.c2[0], c.c2[1])} ${P(c.p3[0], c.p3[1])} c\n`;
    }
    return [{d, closed:!!g.closed}];
  };
  const natPaint = (s, ox, oy, op, bm) => {
    const fc = noPaint(s.fill) ? null : rgba(s.fill), sw = +s.strokeWidth || 0, sc = sw > 0 && !noPaint(s.stroke) ? rgba(s.stroke) : null;
    if ((!fc || !fc[3]) && (!sc || !sc[3])) return '';
    if (fc && sc && Math.abs(fc[3] - sc[3]) > 1e-3) notes.add('a shape with different fill and stroke alpha uses the fill alpha as its Illustrator opacity');
    const ev = s.type === 'compound' && s.rule === 'evenodd', so = op * (s.opacity === undefined ? 1 : +s.opacity) * (fc ? fc[3] : sc[3]);
    let o = xy(bm, so) + '0 O\n' + (fc ? colOp(fc, 'Xa') : '') + '0 R\n';
    if (sc) o += colOp(sc, 'XA') + `${f(sw)} w\n1 J\n1 j\n4 M\n[]0 d\n`;
    o += `${ev ? 1 : 0} XR\n`;
    const paint = closed => fc && sc ? (closed ? 'b' : 'B') : fc ? (closed ? 'f' : 'F') : (closed ? 's' : 'S');
    const subs = natPaths(s, ox, oy);
    if (subs.length === 1) return o + subs[0].d + paint(subs[0].closed) + '\n';
    return o + '*u\n' + subs.map(p => p.d + paint(p.closed) + '\n').join('') + '*U\n';
  };
  const natShape = (s, ox, oy, op, bm) => {
    if (!s || s.visible === false) return '';
    if (s.type !== 'group') return natPaint(s, ox, oy, op, bm);
    const kids = s.children || [];
    if (!s.clip || !kids.length) return 'u\n' + kids.map(k => natShape(k, ox, oy, op, bm)).join('') + 'U\n';
    // 剪切组：内容在前、剪切路径在最上面（q … h W n Q）
    const c = kids[0], ev = c.type === 'compound' && c.rule === 'evenodd', ms = natPaths(c, ox, oy);
    const mask = `${ev ? 1 : 0} XR\n` + (ms.length === 1 ? ms[0].d + 'h\nW\nn\n' : '*u\n' + ms.map(p => p.d + 'h\nW\nn\n').join('') + '*U\n');
    return 'q\n' + kids.slice(1).map(k => natShape(k, ox, oy, op, bm)).join('') + mask + 'Q\n';
  };
  // 字体：ASCII ⇒ 那个字体本身（TZ 重新编码）；有非 ASCII 字 ⇒ 字串写双位元组字码，一段一种字码、各段各用自己的字体。
  // 旧版文字的读法：字体名只写字体本身（微软正黑、不带 CMap）且 script 码 2 时整段照 Big5 解；<字名>-GB-EUC-H 且 script 码 2 照 GB2312 解；
  // 字体名带 -ETen-B5-H 时找不到字体、换成简体预设字体并照 GB2312 解；不认 UCS-2（Uni…-UCS2-H 读进来是空字串）。
  // 所以一层先定一次主字码：字全在 GB2312 里，且字体是简体字体（雅黑、等线、宋体、黑体、苹方 SC、Noto／思源 SC…）或有 Big5 没有的简体专有字
  // ⇒ 整串一段 GB2312（<字名>-GB-EUC-H，正黑换成雅黑）；否则以 Big5 为主逐字挑：Big5 编得了的字（繁体字与 Big5 也有的简繁共用字）写 Big5、
  // 放微软正黑那段；Big5 没有、GB2312 有的字（简体专有字）写 GB2312、放微软雅黑-GB-EUC-H 那段；两样都没有的字写成 ?（并进前一段，列进 notes）。
  // ASCII 跟着前一段（开头的跟着第一个中文字那段）。连续同段的字合成一段。
  // 字码表用浏览器的解码器（TextDecoder big5／gbk）把每个双位元组解一次反查出来（私用区的不算）。
  const CJK = {big5:{cmap:null, script:2, dec:'big5', lead:[0xa1, 0xf9], trail:[0x40, 0xfe]},
    gb:{cmap:'GB-EUC-H', script:2, dec:'gbk', lead:[0xa1, 0xf7], trail:[0xa1, 0xfe]}};
  const CJK_FACE = {big5:'MicrosoftJhengHeiRegular', gb:'MicrosoftYaHei'};
  const cjkTab = cs => { const e = CJK[cs]; if (e.map) return e.map;
    const m = new Map(), dec = new TextDecoder(e.dec);
    for (let a = e.lead[0]; a <= e.lead[1]; a++) for (let b = e.trail[0]; b <= e.trail[1]; b++){
      if (b === 0x7f) continue;
      const ch = dec.decode(new Uint8Array([a, b])), c = ch.charCodeAt(0);
      if (ch.length === 1 && ch !== '�' && c >= 0x80 && !(c >= 0xe000 && c <= 0xf8ff) && !m.has(ch)) m.set(ch, [a, b]);
    }
    return (e.map = m); };
  const cjkEnc = (cs, t) => { const m = cjkTab(cs), out = []; let miss = 0;
    for (const ch of t){ const c = ch.codePointAt(0), b = c < 0x80 ? [c] : m.get(ch); if (b) out.push(...b); else { out.push(0x3f); miss++; } }
    return {out, miss}; };
  // 字名 ⇒ TZ；同一个字名先给了 ASCII 的写法、后来又用来写中文时换成中文那种（ASCII 字照样读）
  const natFonts = new Map();
  const natFont = (n, tz, cjk) => { const o = natFonts.get(n); if (!o || (cjk && !o.cjk)) natFonts.set(n, {tz, cjk}); return '_' + n; };
  const SC_FACE = /YaHei|DengXian|SimSun|SimHei|KaiTi|FangSong|PingFangSC|NotoSans(CJK)?SC|NotoSerif(CJK)?SC|SourceHan(Sans|Serif)(SC|CN)|HiraginoSansGB|^ST(Heiti|Song|Kaiti)/i;
  const LATIN_PS = new Set([].concat(...Object.values(PSD_FONTS)).filter(n => !/JhengHei|YaHei|PingFang/.test(n)));
  const cjkFont = (base, cs) => {
    if (Object.values(CJK_FACE).includes(base) && base !== CJK_FACE[cs]){ notes.add(`text set in ${base} uses ${CJK_FACE[cs]} in Illustrator`); base = CJK_FACE[cs]; }
    const e = CJK[cs], n = e.cmap ? `${base}-${e.cmap}` : base;
    return natFont(n, `%AI3_BeginEncoding: _${n} ${n}\n[/_${n}/${n} 0 ${e.script} 0 TZ\n%AI3_EndEncoding TrueType\n`, true);
  };
  // 一段文字 ⇒ [{font, bytes}]，一段一种字体
  const natRuns = (d, text) => {
    const ps = psdFontName(d, text).name.replace(/[^\x21-\x7e]|[()<>[\]{}/%]/g, '');
    if (/^[\x20-\x7e\r]*$/.test(text))
      return [{font:natFont(ps, `%AI3_BeginEncoding: _${ps} ${ps}\n[/_${ps}/${ps} 0 0 1 TZ\n%AI3_EndEncoding TrueType\n`, false), bytes:[...text].map(c => c.charCodeAt(0))}];
    let base = ps;
    if (LATIN_PS.has(ps)){ base = window.Lang && Lang.cur === 'zh-Hans' ? 'MicrosoftYaHei' : 'MicrosoftJhengHeiRegular'; notes.add(`text set in ${ps} with non-Latin characters uses ${base} in Illustrator`); }
    const kind = ch => ch.codePointAt(0) < 0x80 ? null : cjkTab('big5').has(ch) ? 'big5' : cjkTab('gb').has(ch) ? 'gb' : null;
    const chars = [...text], runs = [], wide = chars.filter(ch => ch.codePointAt(0) >= 0x80);
    if (wide.every(ch => cjkTab('gb').has(ch)) && (SC_FACE.test(base) || wide.some(ch => !cjkTab('big5').has(ch)))) runs.push({cs:'gb', t:text});
    else {
      let cur = chars.map(kind).find(k => k) || 'big5';
      for (const ch of chars){ cur = kind(ch) || cur; const r = runs[runs.length - 1]; if (r && r.cs === cur) r.t += ch; else runs.push({cs:cur, t:ch}); }
    }
    if (runs.some(r => cjkEnc(r.cs, r.t).miss)) notes.add('characters without a Big5 or GB2312 code are written as ? in Illustrator text');
    const out = [];
    for (const r of runs){
      const font = cjkFont(base, r.cs), bytes = cjkEnc(r.cs, r.t).out, last = out[out.length - 1];
      if (last && last.font === font) last.bytes.push(...bytes); else out.push({font, bytes});
    }
    return out;
  };
  const natText = (L, op, bm) => {
    const d = L.data, size = +d.size || 12, lines = (window.TypeTool && TypeTool.wrapLines) ? TypeTool.wrapLines(d) : String(d.text).split('\n');
    const text = lines.join('\r'), c = rgba(d.color || '#000'), al = String(d.align || 'left'), R = natRuns(d, text);
    const ta = al === 'center' ? 1 : (al === 'right' || al === 'end') ? 2 : 0, tf = font => `/${font} ${f(size)} ${f(size)} ${f(-size * 0.25)} Tf\n`;
    return xy(bm, op * c[3]) + `0 To\n1 0 0 1 ${f(d.x + (L.x || 0))} ${f(NY(d.y + (L.y || 0)))} 0 Tp\n0 Tv\nTP\n0 Tr\n0 O\n` + colOp(c, 'Xa') +
      tf(R[0].font) + `0 Ts\n100 100 Tz\n0 Tt\n${ta} Ta\n${f(size * 1.25)} 0 Tl\n0 Tc\n0 Tw\n` +
      R.map((r, i) => (i ? tf(r.font) : '') + `${psStr(r.bytes)} Tx\n`).join('') + `${psStr([13])} TX\nTO\n`;
  };
  // 点阵 XI（… 位深 8、通道 3、alpha 数、色彩空间码、0＝十六进位、0 XI）：RGB 逐像素交错。
  // 色彩空间码照 Illustrator 点阵的色彩空间（0 灰、1 RGB、2 CMYK；加 16＝带 alpha），不带透明的写 0（照通道数读）；
  // 18＝带 alpha 的 CMYK，跟 3 通道对不上。带透明的写 17（带 alpha 的 RGB）：RGB 逐像素在前、整面 alpha 接在后面
  // （逐像素 RGBA 读进来会错位成斜纹）。alpha 不预乘。
  const natImage = (cr, op, bm) => {
    if (!cr) return '';
    const {x0, y0, w, h, rgb, a, hasA} = cr, HX = '0123456789ABCDEF', out = [];
    const put = u8 => { for (let i = 0; i < u8.length; i += 30){ let s = '%'; const e = Math.min(u8.length, i + 30); for (let j = i; j < e; j++) s += HX[u8[j] >> 4] + HX[u8[j] & 15]; out.push(s); } };
    put(rgb); if (hasA) put(a);
    return xy(bm, op) + `%AI5_File:\n%AI5_BeginRaster\n[ 1 0 0 1 ${x0} ${f(NY(y0))} ] 0 0 ${w} ${h} ${w} ${h} 8 3 ${hasA ? 1 : 0} ${hasA ? 17 : 0} 0 0 XI\n${out.join('\n')}\n%AI5_EndRaster\n`;
  };
  const LCOL = [[79, 128, 255], [255, 79, 79], [79, 255, 79], [79, 79, 255], [255, 255, 79], [255, 79, 255], [79, 255, 255], [128, 128, 128]];
  let lcN = 0;
  const natLayer = (L, inner) => {
    const k = lcN++ % LCOL.length, [r, g, b] = LCOL[k], vis = L.visible ? 1 : 0, ed = L.locked ? 0 : 1;
    return `%AI5_BeginLayer\n${vis} 1 ${ed} 1 0 0 -1 ${r} ${g} ${b} Lb\n${psStr(te.encode(L.name || 'Layer'))} Ln\n0 A\n${inner}LB\n%AI5_EndLayer--\n`;
  };
  const plain = L => !L.mask && !L.clipped && !(L.blendIf && !BlendIf.isDefault(L.blendIf)) && !(window.PsLayerStyle && PsLayerStyle.has(L));
  const ocgs = [], off = [], props = [];
  const walk = async list => {
    const body = [], order = [], nbody = [];
    for (const L of list){
      if (L._sigSkip) continue;
      const id = obj(`<< /Type /OCG /Name ${pdfStr(L.name || 'Layer')} >>`), n = 'OC' + props.length;
      ocgs.push(id); props.push(`/${n} ${id} 0 R`); if (!L.visible) off.push(id);
      const op = L.opacity === undefined ? 1 : L.opacity, fop = L.fillOpacity === undefined ? 1 : L.fillOpacity, bm = bmOf(L.blend);
      if (L.clipped) notes.add('clipping masks are baked into the layer picture');
      if (L.kind === 'group' && plain(L) && op === 1 && bm === 'Normal'){
        const r = await walk(Groups.children(L));
        body.push(`/OC /${n} BDC ${r.body} EMC`); order.push({id, kids:r.order});
        if (nat) nbody.push(natLayer(L, r.nbody));
        continue;
      }
      let ops = '', nops = '';
      try {
        if (L.kind === 'vector' && plain(L)){
          const shapes = L.data.shapes || [];
          ops = shapes.map(s => shapeOps(s, L.x || 0, L.y || 0, op * fop, bm)).join(' ');
          if (nat) nops = shapes.map(s => natShape(s, L.x || 0, L.y || 0, op * fop, bm)).join('');
        } else if (L.kind === 'text' && plain(L) && !(window.TouchType && TouchType.touched(L)) && !L.data.warp){
          ops = textOps(L, op * fop, bm);
          if (nat) nops = natText(L, op * fop, bm);
        } else throw UNSUP;
      } catch (e){
        if (e !== UNSUP) console.warn('ai layer', L.name, e);
        if (L.kind === 'text' || L.kind === 'vector') notes.add(`${L.kind} layer "${L.name}" written as a picture`);
        const cr = cropOf(seen(L)), img = await imageOps(cr);
        ops = img ? `q ${gs(op, op, bm)} ${img} Q` : '';
        if (nat) nops = natImage(cr, op, bm);
      }
      body.push(`/OC /${n} BDC ${ops} EMC`); order.push({id, kids:null});
      if (nat) nbody.push(natLayer(L, nops));
    }
    return {body:body.join('\n'), order, nbody:nbody.join('')};
  };
  const topList = Groups.any() ? Groups.topLevel() : Doc.layers;
  const top = await walk(topList);
  const orderStr = list => list.slice().reverse().map(e => e.kids ? `${e.id} 0 R [${orderStr(e.kids)}]` : `${e.id} 0 R`).join(' ');   // 面板由上往下
  const cs = stream('/Filter /FlateDecode', await deflate(te.encode(top.body)));
  const now = new Date(), p2 = v => String(v).padStart(2, '0');
  const lastMod = `(D:${now.getUTCFullYear()}${p2(now.getUTCMonth() + 1)}${p2(now.getUTCDate())}${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}${p2(now.getUTCSeconds())}Z)`;
  let piece = '';
  if (nat){
    const title = psStr(te.encode((St.name || 'Untitled') + '.ai'));
    const date = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()} ${(now.getHours() % 12) || 12}:${p2(now.getMinutes())} ${now.getHours() < 12 ? 'AM' : 'PM'}`;
    const box = `0 ${-H} ${W} 0`, cy = -H / 2;
    const head = `%!PS-Adobe-3.0 \n%%Creator: Adobe Illustrator(R) 15.0\n%%AI8_CreatorVersion: 15.0.0\n%%For: (Dilin Studio) ()\n%%Title: ${title}\n%%CreationDate: ${date}\n%%Canvassize: 16383\n` +
        `%%BoundingBox: ${box}\n%%HiResBoundingBox: ${box}\n%%DocumentProcessColors: Cyan Magenta Yellow Black\n%AI5_FileFormat 2.0\n%AI3_ColorUsage: Color\n%AI7_ImageSettings: 0\n` +
        `%AI3_Cropmarks: ${box}\n%AI3_TemplateBox: ${f(W / 2)} ${f(cy)} ${f(W / 2)} ${f(cy)}\n%AI3_TileBox: ${box}\n%AI3_DocumentPreview: None\n%AI5_ArtSize: ${W} ${H}\n` +
        `%AI5_RulerUnits: 6\n%AI9_ColorModel: 1\n%AI5_ArtFlags: 0 0 0 1 0 0 1 0 0\n%AI5_TargetResolution: 800\n%AI5_NumLayers: ${top.order.length}\n%AI5_OpenViewLayers: 7\n` +
        `%%PageOrigin:0 0\n%AI7_GridSettings: 72 8 72 8 1 0 0.8 0.8 0.8 0.9 0.9 0.9\n%AI9_Flatten: 1\n%AI12_CMSettings: 00.MS\n%%EndComments\n`;
    const TE = '[\n39/quotesingle 96/grave 128/Adieresis/Aring/Ccedilla/Eacute/Ntilde/Odieresis\n/Udieresis/aacute/agrave/acircumflex/adieresis/atilde/aring/ccedilla/eacute\n' +
      '/egrave/ecircumflex/edieresis/iacute/igrave/icircumflex/idieresis/ntilde\n/oacute/ograve/ocircumflex/odieresis/otilde/uacute/ugrave/ucircumflex\n' +
      '/udieresis/dagger/degree/cent/sterling/section/bullet/paragraph/germandbls\n/registered/copyright/trademark/acute/dieresis/.notdef/AE/Oslash\n' +
      '/.notdef/plusminus/.notdef/.notdef/yen/mu/.notdef/.notdef\n/.notdef/.notdef/.notdef/ordfeminine/ordmasculine/.notdef/ae/oslash\n' +
      '/questiondown/exclamdown/logicalnot/.notdef/florin/.notdef/.notdef\n/guillemotleft/guillemotright/ellipsis/space/Agrave/Atilde/Otilde/OE/oe\n' +
      '/endash/emdash/quotedblleft/quotedblright/quoteleft/quoteright/divide\n/.notdef/ydieresis/Ydieresis/fraction/currency/guilsinglleft/guilsinglright\n' +
      '/fi/fl/daggerdbl/periodcentered/quotesinglbase/quotedblbase/perthousand\n/Acircumflex/Ecircumflex/Aacute/Edieresis/Egrave/Iacute/Icircumflex\n' +
      '/Idieresis/Igrave/Oacute/Ocircumflex/.notdef/Ograve/Uacute/Ucircumflex\n/Ugrave/dotlessi/circumflex/tilde/macron/breve/dotaccent/ring/cedilla\n' +
      '/hungarumlaut/ogonek/caron\nTE\n';
    const text = head + '%%BeginProlog\n%%EndProlog\n%%BeginSetup\n' + TE + [...natFonts.values()].map(v => v.tz).join('') + '%%EndSetup\n' + top.nbody +
      '%%PageTrailer\ngsave annotatepage grestore showpage\n%%Trailer\n%%EOF\n';
    const all = Uint8Array.from(text, ch => ch.charCodeAt(0)), BLK = 65536, blocks = [];
    for (let i = 0; i < all.length; i += BLK) blocks.push(stream('/Filter /FlateDecode', await deflate(all.subarray(i, i + BLK))));
    const ver = 15;
    const meta = stream('', Uint8Array.from(head, ch => ch.charCodeAt(0)));
    const priv = obj(`<< /CreatorVersion ${ver} /ContainerVersion 9 /RoundtripVersion ${ver} /AIMetaData ${meta} 0 R ${blocks.map((b, i) => `/AIPrivateData${i + 1} ${b} 0 R`).join(' ')} /NumBlock ${blocks.length} >>`);
    const ill = obj(`<< /LastModified ${lastMod} /Private ${priv} 0 R >>`);
    piece = ` /LastModified ${lastMod} /PieceInfo << /Illustrator ${ill} 0 R >>`;
  }
  objs[pageObj - 1] = [te.encode(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /TrimBox [0 0 ${W} ${H}] /ArtBox [0 0 ${W} ${H}]${piece} /Resources << /ExtGState << ${gsRes.join(' ')} >> /Font << ${fontRes.join(' ')} >> /XObject << ${xo.join(' ')} >> /Properties << ${props.join(' ')} >> >> /Contents ${cs} 0 R >>`)];
  objs[pagesObj - 1] = [te.encode(`<< /Type /Pages /Kids [${pageObj} 0 R] /Count 1 >>`)];
  objs[catalog - 1] = [te.encode(`<< /Type /Catalog /Pages ${pagesObj} 0 R /PageMode /UseOC /OCProperties << /OCGs [${ocgs.map(i => i + ' 0 R').join(' ')}] /D << /Name ${pdfStr('Layers')} /BaseState /ON /Order [${orderStr(top.order)}] /OFF [${off.map(i => i + ' 0 R').join(' ')}] >> >> >>`)];
  // /Producer 是本程式写的档的标记：读入端（vec-io.js）认出来就不提「子图层只在 Illustrator 私有资料里」
  const info = obj(`<< /Title ${pdfStr(St.name || 'Untitled')} /Creator ${pdfStr('Dilin Studio')} /Producer ${pdfStr('Dilin Studio · drawboard')} >>`);
  const out = [te.encode('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n')]; let at = out[0].length; const offs = [];
  objs.forEach((parts, i) => { offs.push(at); const head = te.encode(`${i + 1} 0 obj\n`), tail = te.encode('\nendobj\n'); out.push(head, ...parts, tail); at += head.length + tail.length + parts.reduce((s, p) => s + p.length, 0); });
  out.push(te.encode(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(v => String(v).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${at}\n%%EOF\n`));
  const len = out.reduce((s, p) => s + p.length, 0), bytes = new Uint8Array(len); let k = 0; for (const p of out){ bytes.set(p, k); k += p.length; }
  return {bytes, notes:[...notes]};
}
async function bytesOf(src){ if (src instanceof Blob) return new Uint8Array(await src.arrayBuffer()); if (src instanceof Uint8Array) return src; const r = await fetch(src); return new Uint8Array(await r.arrayBuffer()); }
const isPsd = it => /\.ps[db]$/i.test(it.name || '') || (it.src instanceof Blob && /photoshop|psd/i.test(it.src.type || '')) || (typeof it.src === 'string' && /^data:image\/(vnd\.adobe\.photoshop|x-photoshop|psd)/i.test(it.src));
async function psdDecode(src){ try { return await PsdIO.decode(await bytesOf(src)); } catch (e){ if (e instanceof PsdIO.Bad) throw new PsBad(e.message); throw e; } }
/* 合成图 → 画布（没合成图就自己把图层叠出来：一般模式、可见的） */
async function psdCanvas(src){
  const p = await psdDecode(src), c = mkCanvas(p.width, p.height);
  if (p.merged) ctx2d(c).putImageData(new ImageData(p.merged, p.width, p.height), 0, 0);
  return c;
}
/* PSD 活图层读回（PsdIO.decode 给的 rec.liveText／rec.shape／rec.fx）：
   文字（没变形、没旋转、一种样式）⇒ 文字层；纯色形状图层 ⇒ 矢量层（贝兹路径，多条＝复合路径）；
   图层样式里画板也有的那几种（投影、内阴影、外发光、内发光、描边、颜色叠加）⇒ 引擎图层样式；其余照旧用像素（另列 skipped）。 */
const PSD_FONT_OF = {};
const PSD_FAMILY = {'microsoft jhenghei':'Microsoft JhengHei', 'microsoft yahei':'Microsoft YaHei', 'pingfang tc':'PingFang TC', 'pingfang sc':'PingFang SC'};
Object.keys(PSD_FONTS).forEach(k => { const fam = PSD_FAMILY[k] || k.replace(/\b\w/g, c => c.toUpperCase()); PSD_FONTS[k].forEach((ps, i) => { PSD_FONT_OF[ps] = {family:fam, bold:i === 1}; }); });
function psdCssFont(ps){
  const hit = PSD_FONT_OF[ps]; if (hit) return {font:`'${hit.family}', sans-serif`, bold:hit.bold};
  const bold = /[-_ ]?(Bold|Black|Heavy|Semibold|SemiBold|Demibold)$/i.test(ps);
  const fam = String(ps || 'sans-serif').replace(/[-_ ]?(Regular|Roman|Book|Medium|Light|Bold|Black|Heavy|Semibold|SemiBold|Demibold|Italic|Oblique|BoldItalic)+$/i, '').replace(/(PS)?MT$/, '') || 'sans-serif';
  return {font:`'${fam.replace(/'/g, '')}', sans-serif`, bold};
}
const psdHex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function psdTextLayer(r){
  const t = r.liveText; if (!t || t.mixed || t.warp || !t.text.trim()) return null;
  const [a, b, c, d, tx, ty] = t.transform;
  if (!(Math.abs(a * d - b * c) > 1e-9)) return null;                   // 压成一条线的变形
  // 只有位移＋等比缩放：折进字号与位置；旋转／斜切／不等比／翻转：字照原字号排，变形记进 data.xform（tools/move.js TextXform）
  const plain = Math.abs(b) <= 1e-4 && Math.abs(c) <= 1e-4 && a > 0 && Math.abs(a - d) <= 1e-4, k = plain ? a : 1;
  const f = psdCssFont(t.font), size = t.size * k;
  const D = {text:t.text, size, font:f.font, color:psdHex(t.color), align:t.just === 2 ? 'center' : t.just === 1 ? 'right' : 'left',
    weight:f.bold || t.fauxBold ? 'bold' : 'normal'};
  if (t.fauxItalic) D.fauxItalic = true;
  if (t.tracking) D.tracking = t.tracking;
  if (t.leading > 0) D.leading = t.leading * k;
  if (t.leading > 0 && t.autoLeading > 0) D.autoLeading = t.autoLeading;   // PS 的自动行距比例（存 PSD 时照写自动行距，见 psdTextOf）
  if (t.leadingType === 1) D.leadingType = 1;
  D.x = tx; D.y = ty;
  if (t.box){
    const [l, tp, rr, bb] = t.box, bx = {x:tx + l * k, y:ty + tp * k, w:(rr - l) * k, h:(bb - tp) * k};
    if (bx.w > 0 && bx.h > 0){
      D.box = bx;
      if (window.TypeTool && TypeTool.placeInBox) TypeTool.placeInBox(D);
      else {
        const m = ctx2d(mkCanvas(1, 1)); m.font = `${D.weight} ${size}px ${D.font}`;
        const asc = m.measureText('d').actualBoundingBoxAscent || size * 0.6;   // PS 段落文字第一条基线：小写 d 的顶碰框顶（同 text.js placeInBox）
        D.x = bx.x + (D.align === 'center' ? bx.w / 2 : D.align === 'right' ? bx.w : 0); D.y = bx.y + asc;
      }
    }
  }
  // 图层坐标的仿射（新层 L.x＝L.y＝0）：PS 的 [a b c d] 绕文字原点 (tx,ty) 套——原点不动，原点之外照 PS 转
  if (!plain) D.xform = [a, b, c, d, tx - a * tx - c * ty, ty - b * tx - d * ty].map(v => Math.abs(v) < 1e-12 ? 0 : +v.toPrecision(12));
  return Layer.text(r.name, D);
}
function psdShapeLayer(r){
  const s = r.shape; if (!s || !s.paths || !s.paths.length) return null;
  const fill = s.fill && s.fillEnabled !== false ? psdHex(s.fill) : 'none';
  const stroke = s.stroke ? psdHex(s.stroke.color) : 'none', strokeWidth = s.stroke ? s.stroke.width : 0;
  if (fill === 'none' && stroke === 'none') return null;
  const near = (p, q) => Math.abs(p[0] - q[0]) < 1e-3 && Math.abs(p[1] - q[1]) < 1e-3;
  const bez = p => ({id:uid('S'), type:'bezier', closed:p.closed, fill, stroke, strokeWidth,
    anchors:p.knots.map(k => ({x:k.a[0], y:k.a[1], in:near(k.pre, k.a) ? null : k.pre.slice(), out:near(k.post, k.a) ? null : k.post.slice()}))});
  // 描边的对齐（内侧／居中／外侧）、端点、转角、虚线（像素）：带描边的那个形状上（menus/impl/ai-window.js 画）
  const strokeOpts = o => { const k = s.stroke; if (!k) return o;
    if (k.align) o.strokeAlign = k.align; if (k.cap) o.cap = k.cap; if (k.join) o.join = k.join; if (k.dash) o.dash = k.dash.slice(); return o; };
  const L = Layer.vector(r.name);
  if (s.paths.length === 1) L.data.shapes.push(strokeOpts(bez(s.paths[0])));
  else L.data.shapes.push(strokeOpts({id:uid('S'), type:'compound', fill, stroke, strokeWidth, rule:s.evenOdd ? 'evenodd' : 'nonzero',
    children:s.paths.map(p => Object.assign(bez(p), {fill:'none', stroke:'none', strokeWidth:0}))}));
  return L;
}
function psdApplyFx(L, r){
  if (!r.fx || !r.fx.items.length || !(window.PsLayerStyle && PsLayerStyle.fromParams)) return;
  // 图案：照唯一 ID（我们写的是图案库 id 杂凑成的 UUID：PsdIO.patId）或名字在图案库里找；找不到 ⇒ 这一项不接（照像素）
  const pat = (id, name) => { const lib = window.PsEdit && PsEdit.patterns; return lib ? (id && (lib.resolve(id) || lib.load().find(q => PsdIO.patId(q.id) === id))) || (name && lib.resolve(name)) || null : null; };
  const one = p => {
    if (p.kind === 'bevelEmboss'){
      const X = window.PsLayer && PsLayer.fxExt && PsLayer.fxExt.bevelEmboss; if (!X) return null;
      const q = Object.assign({}, p); if (q.texture){ const P = pat(q.texture, q.textureName); if (P) q.texture = P.id; else delete q.texture; }
      return X.fromParams(q);
    }
    if (p.kind === 'patternOverlay'){
      const P = pat(p.pattern, p.patternName); if (!P) return null;
      return {kind:'patternOverlay', enabled:true, blend:p.blend || 'normal', opacity:Math.max(0, Math.min(100, p.opacity === undefined ? 100 : p.opacity)) / 100, pattern:P.id, name:P.name,
        scale:Math.max(0.01, Math.min(10, (p.scale === undefined ? 100 : p.scale) / 100)), angle:p.angle || 0, link:p.link !== false, phase:[p.phaseX || 0, p.phaseY || 0]};
    }
    return PsLayerStyle.fromParams(p.kind, p);
  };
  const items = r.fx.items.map(p => { try { return one(p); } catch (_){ return null; } }).filter(Boolean);
  if (items.length) L.style = {enabled:r.fx.enabled !== false, items};
}
/* PSD 路径（文件坐标的 pre／a／post）⇒ 我们的贝兹形状（白填色：矢量蒙版只看形状） */
function psdBezier(p, extra){
  const near = (a, b) => Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3;
  return Object.assign({id:uid('S'), type:'bezier', closed:p.closed, fill:'#ffffff', stroke:'none', strokeWidth:0,
    anchors:p.knots.map(k => ({x:k.a[0], y:k.a[1], in:near(k.pre, k.a) ? null : k.pre.slice(), out:near(k.post, k.a) ? null : k.post.slice()}))}, extra || {});
}
/* 调整图层（rec.adjust）⇒ 像素层＋L.adjust（参数照 ps.layer.setAdjustment 的规矩正规化）；读不懂 ⇒ null */
function psdAdjustLayer(r, W, H){
  const A = r.adjust; if (!A || !window.PsImage) return null;
  let params;
  if (A.kind === 'colorLookup'){
    // 我们的内建 look（写出时档名＝id.cube）⇒ {lut:id}；别的 .cube ⇒ {data, fileName}；都不行 ⇒ 空的颜色查找
    const ok = q => { try { PsImage.fromParams('colorLookup', q, null); return true; } catch (_){ return false; } };
    const look = String(A.lutName || '').replace(/\.cube$/i, ''), d = A.params.dither ? {dither:true} : {};
    params = look && ok({lut:look}) ? Object.assign(d, {lut:look}) : A.params.data && ok({data:A.params.data, fileName:A.params.fileName}) ? Object.assign(d, {data:A.params.data, fileName:A.params.fileName}) : d;
  } else { try { params = PsImage.toParams(PsImage.fromParams(A.kind, A.params, null)); } catch (e){ console.warn('psd adjustment', r.name, e); return null; } }
  const L = Layer.raster(r.name, W, H);
  L.adjust = {kind:A.kind, params};
  return L;
}
/* 智能对象（rec.placed＋文件级内嵌档）⇒ 智能对象层（来源＝内嵌档解出来的图；四角 ⇒ transform） */
function psdSmartLayer(r, src){
  const pl = r.placed; if (!pl || pl.plain === false || !src || !window.Smart || !Layer.smart) return null;   // 变形／透视／智能滤镜 ⇒ 照像素
  const w = src.canvas.width, h = src.canvas.height, c = pl.corners; if (!c || c.length !== 8 || !(w > 0 && h > 0)) return null;
  const T = [(c[2] - c[0]) / w, (c[3] - c[1]) / w, (c[6] - c[0]) / h, (c[7] - c[1]) / h, c[0], c[1]].map(v => Math.abs(v) < 1e-12 ? 0 : +v.toPrecision(12));
  if (!src.entry) src.entry = Smart.fromImage(src.canvas, src.name);                  // 同一个内嵌档的几个实例共用一份来源
  return Layer.smart(r.name, {source:{id:src.entry.id, name:src.entry.name, type:src.entry.type}, transform:T});
}
/* 解好的 PSD → 图层（下→上，组照我们的样子：子层在前、组在后、子层 parent＝组 id）；文字、形状、图层样式读得懂就接成活的（见上） */
function psdLayers(p){
  const W = p.width, H = p.height, out = [], stack = [];
  const maskLayer = (m, id) => {
    const c = mkCanvas(W, H), x = ctx2d(c), img = x.createImageData(W, H), d = img.data;
    for (let i = 0; i < W * H; i++){ d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = m.defaultColor; }
    const [t, l, b, r] = m.rect, mw = r - l;
    for (let y = Math.max(0, t); y < Math.min(H, b); y++) for (let X = Math.max(0, l); X < Math.min(W, r); X++) d[(y * W + X) * 4 + 3] = m.alpha[(y - t) * mw + (X - l)];
    x.putImageData(img, 0, 0);
    return {id, kind:'raster', name:'mask', visible:true, opacity:1, blend:'normal', mask:null, x:0, y:0, data:{canvas:c, ctx:x}, _cache:null, _cacheScale:0, defaultColor:m.defaultColor >= 128 ? 255 : 0};
  };
  const common = (L, r) => {
    L.visible = !r.hidden; L.opacity = r.opacity; L.blend = r.blend;
    if (r.fillOpacity < 1) L.fillOpacity = r.fillOpacity;
    if (r.blendIf && !BlendIf.isDefault(r.blendIf)) L.blendIf = JSON.parse(JSON.stringify(r.blendIf));
    if (r.mask && r.mask.alpha){ const M = maskLayer(r.mask, 'M' + L.id); if (r.mask.enabled) L.mask = M; else L.maskOff = M; }
    if (stack.length) L.parent = stack[stack.length - 1].id; else L.parent = null;
    psdApplyFx(L, r);
  };
  for (const r of p.records){
    if (r.section === 3){ const G = Layer.group('group'); stack.push(G); continue; }        // 组结束记录＝组开头（下→上）
    if (r.section === 1 || r.section === 2){
      const G = stack.pop() || Layer.group(r.name);
      G.name = r.name; G.data.expanded = r.section === 1;
      common(G, r);
      out.push(G); continue;
    }
    let L = null;
    try { L = r.liveText ? psdTextLayer(r) : r.shape ? psdShapeLayer(r) : r.adjust ? psdAdjustLayer(r, W, H) : r.placed ? psdSmartLayer(r, (p.smartSrc || {})[r.placed.id]) : null; }
    catch (e){ console.warn('psd live layer', r.name, e); L = null; }
    if (!L){ L = Layer.raster(r.name, W, H);
    if (r.rgba){ const [t, l, b, rr] = r.rect, w = rr - l, h = b - t, tmp = mkCanvas(w, h); ctx2d(tmp).putImageData(new ImageData(r.rgba, w, h), 0, 0); L.data.ctx.drawImage(tmp, l, t); } }
    common(L, r);
    if (r.clipped) L.clipped = true;
    // 像素层／调整层／智能对象的矢量蒙版（文件坐标的贝兹；反相、停用、链接照档）
    if (r.vmask && L.kind !== 'vector') L.vmask = {shapes:r.vmask.paths.map(q => psdBezier(q)), inverted:!!r.vmask.inverted, enabled:r.vmask.enabled !== false, linked:r.vmask.linked !== false, density:1, feather:0, ax:L.x || 0, ay:L.y || 0};
    out.push(L);
  }
  while (stack.length){ const G = stack.pop(); G.parent = null; out.push(G); }            // 坏档：组没收尾
  return out;
}
/* PSD → 换掉目前这份文件（分层；没有图层记录＝合成图开成背景层） */
/* 文件级内嵌档（lnk2）⇒ {唯一 ID: {canvas, name}}：图片照解、内嵌的 PSD／PSB 用它的合成图（智能对象来源） */
async function psdSmartSources(p){
  const out = {};
  for (const f of p.linked || []){
    if (!f.data || !f.data.length) continue;
    try {
      let c;
      if (f.data[0] === 0x38 && f.data[1] === 0x42 && f.data[2] === 0x50 && f.data[3] === 0x53) c = await psdCanvas(f.data);
      else { const bm = await createImageBitmap(new Blob([f.data])); c = mkCanvas(bm.width, bm.height); ctx2d(c).drawImage(bm, 0, 0); if (bm.close) bm.close(); }
      out[f.id] = {canvas:c, name:f.name || 'image'};
    } catch (e){ console.warn('psd embedded file', f.name, e); }
  }
  return out;
}
/* 档里的配置文件描述 ⇒ 内建 id（对不上 ⇒ null：照旧不标记） */
function psdIccId(desc){
  if (!desc || !window.PsEdit || !PsEdit.color || !Array.isArray(PsEdit.color.BUILTINS)) return null;
  const b = PsEdit.color.BUILTINS.find(x => x.space === 'rgb' && x.description.toLowerCase() === String(desc).toLowerCase());
  return b ? b.id : null;
}
async function openPsdAsDoc(src, name){
  const p = await psdDecode(src), W = p.width, H = p.height;
  p.smartSrc = await psdSmartSources(p);
  let layers = psdLayers(p);
  Doc.reset(W, H, null, false);
  if (typeof p.globalAngle === 'number') Doc.globalLight = {angle:p.globalAngle, altitude:typeof p.globalAltitude === 'number' ? p.globalAltitude : 30};   // 图层样式「使用全局光」照档里的
  // 文件级：参考线（Doc.aiGuides）、路径（第一条存储路径／工作路径 ⇒ Doc.workPath）、配置文件（描述对得上内建的 ⇒ Doc.iccProfile）
  if (p.guides && p.guides.length) Doc.aiGuides = p.guides.map(g => ({vertical:!!g.vertical, pos:g.pos}));
  const wp = (p.paths || []).find(q => !q.work) || (p.paths || [])[0];
  if (wp) Doc.workPath = {layerId:null, subpaths:wp.paths.map(q => { const b = psdBezier(q); return {closed:b.closed, anchors:b.anchors}; })};
  const iccId = psdIccId(p.iccDescription); if (iccId) Doc.iccProfile = iccId;
  if (!layers.length){
    const L = Layer.raster(Lang.t('layer.bg'), W, H);
    if (p.merged){ const t = mkCanvas(W, H); ctx2d(t).putImageData(new ImageData(p.merged, W, H), 0, 0); L.data.ctx.drawImage(t, 0, 0); }
    if (!p.merged || !hasTransparency(L.data.canvas)){ L.isBackground = true; L.locks = {transparency:true, pixels:false, position:true, artboard:false, all:false}; }
    layers = [L];
  } else {
    const B = layers[0];                                                   // 最底下一层不透明、没蒙版、在顶层 ⇒ 当背景层（PS 存的「背景」）
    if (B.kind === 'raster' && !B.parent && !B.mask && B.blend === 'normal' && B.opacity === 1 && /^(背景|Background)$/i.test(B.name) && !hasTransparency(B.data.canvas)){ B.isBackground = true; B.locks = {transparency:true, pixels:false, position:true, artboard:false, all:false}; }
  }
  Doc.layers = layers; Doc.activeId = layers[layers.length - 1].id;
  if (window.Groups && Groups.normalize) Groups.normalize();
  History.clear();
  St.name = stem(name); St.ext = extOf(name) === 'psb' ? 'psb' : 'psd'; St.fileHandle = null; St.savedSnap = History.snap(); markSaved();
  if (window.UI){ UI.fit(); UI.refresh(); } if (window.HandView) HandView.reset();
  fireEvent('openDocument');
  return {width:W, height:H, name:St.name, layers:Doc.layers.length};
}
/* ── 矢量档（SVG／PDF／Illustrator .ai 的 PDF 相容内容）照分层开（解析在 menus/impl/vec-io.js）──
   PDF 图层、SVG 图层组 ⇒ 图层组；路径 ⇒ 矢量层；文字 ⇒ 文字层；图与画板接不起来的部分 ⇒ 像素层；带不过来的列在回包 notes（也提示一句）。 */
const VEC_EXTS = ['svg', 'svgz', 'pdf', 'ai'];
const isVec = it => /\.(svgz?|pdf|ai)$/i.test(it.name || '') || (it.src instanceof Blob && /svg|pdf|illustrator|postscript/i.test(it.src.type || ''))
  || (typeof it.src === 'string' && /^data:(image\/svg|application\/(pdf|illustrator|postscript))/i.test(it.src));
async function vecDecode(src, o){
  if (!window.VecIO) throw new PsBad('vector importer (vec-io.js) not loaded');
  let u8 = await bytesOf(src);
  try {
    if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());   // .svgz
    if (VecIO.isPdf(u8)) return await VecIO.pdf(u8, o || {});
    return await VecIO.svg(new TextDecoder().decode(u8));
  } catch (e){ if (e instanceof VecIO.Bad) throw new PsBad(e.message); throw e; }
}
/* SVG 的 font-family ⇒ CSS 字体：PostScript 名（MicrosoftJhengHeiRegular、ArialMT…）或内嵌字型名照 psdCssFont 换成家族名；其余补通用字体兜底 */
const VEC_GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system)$/i;
function vecCssFont(d){
  const s = String(d.font || '').trim(), fams = s.split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  if (!fams.length) return {font:'sans-serif', bold:false};
  const ps = fams.length === 1 && !/\s/.test(fams[0]) && (PSD_FONT_OF[fams[0]] || d.embeddedFont || /([-_]?(Regular|Roman|Book|Medium|Light|Bold|Black|Heavy|Semibold|SemiBold|Demibold|Italic|Oblique))$|PSMT$|MT$/.test(fams[0]));
  if (ps) return psdCssFont(fams[0]);
  return {font:VEC_GENERIC.test(fams[fams.length - 1]) ? s : s + ', sans-serif', bold:false};
}
/* 模型 ⇒ 图层（下→上，组照我们的样子：子层在前、组在后、子层 parent＝组 id） */
function vecLayers(m){
  const W = m.width, H = m.height, out = [];
  const reid = s => { s.id = uid('S'); if (Array.isArray(s.children)) s.children.forEach(reid); return s; };
  const build = (n, parent, i) => {
    let L;
    if (n.kind === 'group'){ L = Layer.group(n.name || (Lang.t('layer.group') + ' ' + (i + 1))); L.data.expanded = true; L.parent = parent ? parent.id : null; n.children.forEach((c, k) => build(c, L, k)); }
    else if (n.kind === 'vector'){ L = Layer.vector(n.name || Lang.t('layer.vector')); L.data.shapes = (n.shapes || []).map(reid); }
    else if (n.kind === 'text'){
      const d = n.data, f = d.psFont ? psdCssFont(d.psFont) : vecCssFont(d);
      const D = {text:d.text, x:d.x, y:d.y, size:d.size, font:f.font, color:d.color || '#000000', align:d.align || 'left', weight:(f.bold || d.bold) ? 'bold' : 'normal'};
      if (d.italic) D.fauxItalic = true;
      if (Array.isArray(d.box) && d.box[2] > 0 && d.box[3] > 0){   // 段落文字：锚点落在框的左／中／右，基线照档里的
        D.box = {x:d.box[0], y:d.box[1], w:d.box[2], h:d.box[3]};
        D.x = D.box.x + (D.align === 'center' ? D.box.w / 2 : D.align === 'right' ? D.box.w : 0);
      }
      L = Layer.text(n.name || d.text.split('\n')[0].slice(0, 40), D);
      if (Array.isArray(d.xform)) L.data.xform = d.xform.slice();
    } else { L = Layer.raster(n.name || Lang.t('layer.untitled'), W, H); if (n.canvas) L.data.ctx.drawImage(n.canvas, 0, 0); }
    L.visible = !n.hidden; L.opacity = n.opacity === undefined ? 1 : n.opacity;
    L.blend = n.blend || (n.kind === 'group' ? 'passThrough' : 'normal');
    L.parent = parent ? parent.id : null;
    out.push(L);
  };
  (m.layers || []).forEach((n, i) => build(n, null, i));
  return out;
}
/* SVG／PDF／.ai → 换掉目前这份文件（分层） */
async function openVectorAsDoc(src, name, o){
  const m = await vecDecode(src, o), W = m.width, H = m.height;
  let layers = vecLayers(m);
  Doc.reset(W, H, null, false);
  if (!layers.length) layers = [Layer.raster(Lang.t('layer.untitled'), W, H)];
  Doc.layers = layers; Doc.activeId = layers[layers.length - 1].id;
  if (window.Groups && Groups.normalize) Groups.normalize();
  History.clear();
  St.name = stem(name); St.ext = extOf(name) || 'svg'; St.fileHandle = null; St.savedSnap = History.snap(); markSaved();
  if (window.UI){ UI.fit(); UI.refresh(); } if (window.HandView) HandView.reset();
  fireEvent('openDocument');
  if (m.notes.length && window.UI) try { toast(m.notes.join(' · ')); } catch (_){ }
  return {width:W, height:H, name:St.name, layers:Doc.layers.length, pages:m.pages || 1, notes:m.notes};
}
/* ── 别家绘图软件的分层档（Krita .kra、OpenRaster .ora、GIMP .xcf、Procreate .procreate；解析在 menus/impl/raster-io.js）──
   组 ⇒ 图层组；像素层 ⇒ 像素层（偏移、可见性、不透明度、混合模式、剪贴照档）；图层蒙版 ⇒ 图层蒙版；画板接不起来的（矢量层、滤镜层…）列在回包 notes（也提示一句）。 */
const RAS_EXTS = ['kra', 'ora', 'xcf', 'procreate'];
const isRas = it => /\.(kra|ora|xcf|procreate)$/i.test(it.name || '') || (typeof it.src === 'string' && /^data:(application\/x-krita|image\/openraster|image\/x-xcf)/i.test(it.src));
async function rasDecode(src, name){
  if (!window.RasterIO) throw new PsBad('importer for Krita / GIMP / Procreate files (raster-io.js) not loaded');
  try { return await RasterIO.decode(await bytesOf(src), name); } catch (e){ if (e instanceof RasterIO.Bad) throw new PsBad(e.message); throw e; }
}
function rasLayers(m){
  const W = m.width, H = m.height, out = [];
  const maskOf = (mk, L) => {
    const c = mkCanvas(W, H), x = ctx2d(c), img = x.createImageData(W, H), d = img.data;
    for (let i = 0; i < W * H; i++){ d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = mk.alpha[i]; }
    x.putImageData(img, 0, 0);
    return {id:'M' + L.id, kind:'raster', name:'mask', visible:true, opacity:1, blend:'normal', mask:null, x:0, y:0, data:{canvas:c, ctx:x}, _cache:null, _cacheScale:0, defaultColor:0};
  };
  const build = (n, parent) => {
    let L;
    if (n.kind === 'group'){ L = Layer.group(n.name || Lang.t('layer.group')); L.data.expanded = true; L.parent = parent ? parent.id : null; n.children.forEach(c => build(c, L)); }
    else {
      L = Layer.raster(n.name || Lang.t('layer.untitled'), W, H);
      if (n.w && n.h){ const t = mkCanvas(n.w, n.h); ctx2d(t).putImageData(new ImageData(n.rgba, n.w, n.h), 0, 0); L.data.ctx.drawImage(t, n.x, n.y); }
      if (n.clipped) L.clipped = true;
      if (n.mask){ const M = maskOf(n.mask, L); if (n.mask.enabled !== false) L.mask = M; else L.maskOff = M; }
      if (n.lockAlpha) L.locks = Object.assign({transparency:false, pixels:false, position:false, artboard:false, all:false}, L.locks || {}, {transparency:true});
    }
    L.visible = !n.hidden; L.opacity = n.opacity === undefined ? 1 : n.opacity;
    L.blend = n.blend || (n.kind === 'group' ? 'passThrough' : 'normal');
    L.parent = parent ? parent.id : null;
    out.push(L);
  };
  (m.layers || []).forEach(n => build(n, null));
  return out;
}
/* Krita／OpenRaster／GIMP／Procreate → 换掉目前这份文件（分层） */
async function openRasterAsDoc(src, name){
  const m = await rasDecode(src, name), W = m.width, H = m.height;
  let layers = rasLayers(m);
  Doc.reset(W, H, null, false);
  if (!layers.length) layers = [Layer.raster(Lang.t('layer.untitled'), W, H)];
  Doc.layers = layers; Doc.activeId = layers[layers.length - 1].id;
  if (window.Groups && Groups.normalize) Groups.normalize();
  History.clear();
  St.name = stem(name); St.ext = extOf(name) || m.format; St.fileHandle = null; St.savedSnap = History.snap(); markSaved();
  if (window.UI){ UI.fit(); UI.refresh(); } if (window.HandView) HandView.reset();
  fireEvent('openDocument');
  if (m.notes.length && window.UI) try { toast(m.notes.join(' · ')); } catch (_){ }
  return {width:W, height:H, name:St.name, layers:Doc.layers.length, format:m.format, notes:m.notes};
}
/* 已存成 PSD 的文件：浏览器有 File System Access API ⇒「存储为」用 showSaveFilePicker 拿 handle，之后「存储」直接覆盖；
   没有这个 API、或网站版（file.exportData 被宿主接手＝存云盘）⇒ 照旧交给 file.exportData */
const fsaOK = () => typeof window.showSaveFilePicker === 'function' && CMD.map['file.exportData'] === LOCAL_EXPORT && !!LOCAL_EXPORT;
async function writeHandle(h, bytes){ const w = await h.createWritable(); await w.write(bytes); await w.close(); }
async function pickPsdHandle(name){
  try { return await window.showSaveFilePicker({suggestedName:name + '.psd', types:[{description:'Photoshop (.psd)', accept:{'image/vnd.adobe.photoshop':['.psd']}}]}); }
  catch (e){ if (e && e.name === 'AbortError') return null; throw e; }
}
/* 照格式把整份文件交出去：工程档 file.saveProject、PNG file.exportPNG、SVG file.exportSVG，其余 file.exportData */
async function writeDoc(name, format, p){
  format = String(format || 'dlcanvas').toLowerCase().replace(/^\./, ''); if (format === 'jpeg') format = 'jpg'; if (format === 'tiff') format = 'tif';
  if (!SAVE_EXTS.includes(format)) throw new PsBad(`unknown format \`${format}\` (${SAVE_EXTS.join('|')})`);
  if (p._handle && !['psd', 'psb', 'ai', 'ora'].includes(format) && p.layers !== false){          // 照 PS 存回原档（File System Access 拿到的档案位置；工程档／图片照原格式写进去）
    const q = format === 'pdf' ? q12(num(p, 'quality', 10)) : undefined;
    const data = format === 'dlcanvas' ? JSON.stringify(Project.serialize()) : format === 'svg' ? Project.toSVG() : format === 'jpg' ? encodeJpeg(renderDoc({}), jpegOptsOf(p)) : (await encodeAs(renderDoc({}), format, {quality:q})).blob;
    await writeHandle(p._handle, data);
    return {file:p._handle.name || name + '.' + format, bytes:data.size !== undefined ? data.size : data.length, inPlace:true};
  }
  if (format === 'dlcanvas'){
    if (p.layers === false){                                           // 存储副本取消「图层」⇒ 写拼合后的一层（file_cmds.rs:253）
      const keep = Doc.layers, act = Doc.activeId, flat = Layer.raster(Lang.t('layer.bg'));
      flat.data.ctx.drawImage(renderDoc({}), 0, 0);
      Doc.layers = [flat]; Doc.activeId = flat.id;
      try { return await CMD.run('file.saveProject', {name}); } finally { Doc.layers = keep; Doc.activeId = act; }
    }
    return await CMD.run('file.saveProject', {name});
  }
  if (format === 'png') return await CMD.run('file.exportPNG', {scale:1, name});
  if (format === 'svg') return await CMD.run('file.exportSVG', {name});
  if (format === 'psd' || format === 'psb'){                          // psb＝大型文件（同一套写法·长度栏放大）
    const pp = p.psdPatterns === undefined ? 'native' : String(p.psdPatterns);
    if (pp !== 'native' && pp !== 'bake') throw new PsBad(`unknown psdPatterns \`${pp}\` (native|bake)`);
    const bytes = psdEncodeDoc(p.layers !== false, {psb:format === 'psb', patterns:pp});
    if (p._handle){ await writeHandle(p._handle, bytes); return {file:name + '.' + format, bytes:bytes.length, inPlace:true}; }   // 「存储为」挑了位置／「存储」覆盖原档
    return await sink(name + '.' + format, bytes, 'image/vnd.adobe.photoshop');
  }
  if (format === 'ora'){                                              // OpenRaster（oraEncodeDoc）：带不过去的项随结果回 notes
    const r = await oraEncodeDoc();
    if (p._handle){ await writeHandle(p._handle, r.bytes); return {file:name + '.ora', bytes:r.bytes.length, inPlace:true, notes:r.notes}; }
    return Object.assign({}, await sink(name + '.ora', r.bytes, 'image/openraster'), {notes:r.notes});
  }
  if (format === 'ai'){                                               // Illustrator 分层档（aiEncodeDoc）：带不过去的项随结果回 notes
    const r = await aiEncodeDoc();
    if (p._handle){ await writeHandle(p._handle, r.bytes); return {file:name + '.ai', bytes:r.bytes.length, inPlace:true, notes:r.notes}; }
    return Object.assign({}, await sink(name + '.ai', r.bytes, 'application/postscript'), {notes:r.notes});
  }
  if (format === 'jpg') return await sink(name + '.jpg', encodeJpeg(renderDoc({}), jpegOptsOf(p)), 'image/jpeg');
  const q = format === 'pdf' ? q12(num(p, 'quality', 10)) : undefined;
  const e = await encodeAs(renderDoc({}), format, {quality:q});
  return await sink(name + '.' + e.ext, e.blob);
}
async function saveAs(p, copy){
  const cmd = copy ? 'file.saveACopy' : 'file.saveAs';
  const name = strp(p, 'name', copy ? St.name + L3(' 拷貝', ' 拷贝', ' copy') : St.name).replace(/\.(dlcanvas|ps[db]|ai|ora|png|jpe?g|webp|tiff?|svg|pdf)$/i, '');
  const ex = extOf(p.name), format = strp(p, 'format', SAVE_EXTS.concat(['jpeg', 'tiff']).includes(ex) ? ex : 'dlcanvas');
  if (copy){ St.noMark++; try { const r = await writeDoc(name, format, p); return Object.assign({name, format}, r || {}); } finally { St.noMark--; } }
  // 存储为：任何格式都算存过（lib.rs:669 path＝新档、saved_revision＝现在）；工程档已由 CMD.run 包装标好
  St.noMark++; let r;
  try { r = await writeDoc(name, format, p); } finally { St.noMark--; }
  if (r && r.ok === false) return r;
  afterSaved(r, format === 'jpeg' ? 'jpg' : format, name);
  St.fileHandle = p._handle ? {h:p._handle, serial:Doc.serial} : null;   // 之后「存储」覆盖这个档
  if (fmtOf(format) === 'jpg') St.jpegOpts = jpegOptsOf(p);            // 确实写入才记住；取消选项／位置不改文件的设定
  const out = Object.assign({name, format}, r || {}); delete out._handle; return out;
}
/* 已存成 PSD：「存储」就地覆盖（有 handle）；agent 没 handle ⇒ 照名字再交一次档 */
async function savePsdInPlace(){ return saveInPlace('psd'); }
/* 有档案位置（打开时 showOpenFilePicker／存储为时 showSaveFilePicker 拿到的）：「存储」照原格式直接写回原档（PS） */
async function saveInPlace(fmt){
  fmt = fmtOf(fmt || St.ext);
  const hv = St.fileHandle && St.fileHandle.serial === Doc.serial ? St.fileHandle.h : null;
  St.noMark++; let r;
  try { r = await writeDoc(St.name, fmt, hv ? {_handle:hv} : {}); } finally { St.noMark--; }
  if (r && r.ok === false) return r;
  afterSaved(r, fmt, St.name);
  return Object.assign({name:St.name, format:fmt, inPlace:!!hv}, r || {});
}
const fmtOf = x => { x = String(x || '').toLowerCase(); return x === 'jpeg' ? 'jpg' : x === 'tiff' ? 'tif' : x === 'json' ? 'dlcanvas' : x; };
const handleOK = () => !!(St.fileHandle && St.fileHandle.serial === Doc.serial && SAVE_EXTS.includes(fmtOf(St.ext)));
/* 新文件先选名字／格式，再设 JPEG 选项，最后打开系统存档框。
   真实磁盘句柄不一定有 remove()；先问 JPEG 再挑位置，取消选项就不会创建或误删任何文件（包含原本已有的空档）。 */
const SAVE_TYPES = [['dlcanvas', 'application/json'], ['psd', 'image/vnd.adobe.photoshop'], ['psb', 'image/vnd.adobe.photoshop'], ['ai', 'application/postscript'], ['ora', 'image/openraster'], ['png', 'image/png'], ['jpg', 'image/jpeg'], ['webp', 'image/webp'], ['tif', 'image/tiff'], ['svg', 'image/svg+xml'], ['pdf', 'application/pdf']];
function pickAndWrite(p){
  const fmt = fmtOf(p.format || 'psd'), type = SAVE_TYPES.find(x => x[0] === fmt);
  const f = SAVE_FORMATS.find(x => x[0] === fmt);
  const label = Array.isArray(f[1]) ? L3(...f[1]) : f[1];
  let pr;
  try { pr = window.showSaveFilePicker({suggestedName:stem(p.name || St.name) + '.' + fmt, excludeAcceptAllOption:true,
    types:[{description:label, accept:{[type[1]]:['.' + fmt].concat(fmt === 'jpg' ? ['.jpeg'] : [])}}]}); }
  catch (e){ return Promise.resolve(e && e.name === 'AbortError' ? {ok:false, cancelled:true} : {ok:false, error:String(e && e.message || e)}); }
  return Promise.resolve(pr).then(h => CMD.run('ps.file.saveAs', Object.assign({}, p, {name:stem(h.name), format:fmt, _handle:h, ui:false})),
    e => e && e.name === 'AbortError' ? {ok:false, cancelled:true} : {ok:false, error:String(e && e.message || e)});
}
function saveViaPicker(p){
  const first = SAVE_EXTS.includes(fmtOf(St.ext)) ? fmtOf(St.ext) : 'psd';
  return new Promise(res => saveAsDialog(Object.assign({}, p, {format:fmtOf(p.format) || first}), false, res));
}
/* JPEG 选项（PS 2020）：杂边、品质 0–12（低／中／高／最佳）、格式选项（基线标准／基线已优化／连续 3–5 扫描）、文件大小预估；上次的设定记在 St.jpegOpts，之后「存储」写回原档沿用。
   编码走 menus/impl/jpeg-enc.js（canvas.toBlob 只出基线）：品质照 file_cmds.rs:158 换成 1–100 的 IJG 量化表；本编码器品质 0–6 用 4:2:0 色度抽样、7–12 不抽样（量化／扫描安排不宣称逐位元等同 PS） */
const JPEG_GRADES = [[3, ['低', '低', 'Low']], [5, ['中', '中', 'Medium']], [8, ['高', '高', 'High']], [10, ['最佳', '最佳', 'Maximum']]];
const jpegGrade = q => (JPEG_GRADES.find(g => q <= g[0]) || JPEG_GRADES[3])[0];
const JPEG_FORMATS = ['standard', 'optimized', 'progressive'];
const JPEG_MATTES = [['none', ['無', '无', 'None']], ['foreground', ['前景色', '前景色', 'Foreground Color']], ['background', ['背景色', '背景色', 'Background Color']], ['white', ['白色', '白色', 'White']], ['black', ['黑色', '黑色', 'Black']], ['gray50', ['50% 灰色', '50% 灰色', '50% Gray']], ['other', ['其他…', '其它…', 'Other…']]];
function matteHex(m, other){
  const sw = id => { const e = document.getElementById(id); return e && /^#[0-9a-f]{6}$/i.test(e.value) ? e.value : null; };
  if (/^#[0-9a-f]{6}$/i.test(m)) return m;
  return m === 'foreground' ? sw('fillColor') || '#000000' : m === 'background' ? sw('strokeColor') || '#ffffff' : m === 'black' ? '#000000' : m === 'gray50' ? '#808080'
    : m === 'other' && /^#[0-9a-f]{6}$/i.test(other) ? other : '#ffffff';                       // 无＝JPEG 没有透明，垫白（PS 同）
}
function jpegOptsOf(p){
  const o = Object.assign({quality:10, jpegFormat:'standard', scans:3, matte:'none'}, St.jpegOpts || {});
  if (p.quality !== undefined && p.quality !== '') o.quality = num(p, 'quality', o.quality);
  if (p.jpegFormat !== undefined){ if (!JPEG_FORMATS.includes(p.jpegFormat)) throw new PsBad('jpegFormat is ' + JPEG_FORMATS.join('|')); o.jpegFormat = p.jpegFormat; }
  if (p.scans !== undefined) o.scans = +p.scans;
  if (p.matte !== undefined) o.matte = String(p.matte);
  if (p.matteColor !== undefined) o.matteColor = String(p.matteColor);
  o.quality = Math.round(clamp(+o.quality, 0, 12)); o.scans = [3, 4, 5].includes(o.scans) ? o.scans : 3;
  return o;
}
function jpegBytes(c, o){
  const flat = overColor(c, matteHex(o.matte, o.matteColor));
  return JpegEnc.encode(ctx2d(flat).getImageData(0, 0, flat.width, flat.height), {quality:q12(o.quality) * 100, mode:o.jpegFormat, scans:o.scans, subsample:o.quality < 7, dpi:Doc.dpi || 72});
}
const encodeJpeg = (c, o) => new Blob([jpegBytes(c, o)], {type:'image/jpeg'});
const kSize = n => (n / 1024).toFixed(1) + 'K';
function jpegOptions(){
  const last = Object.assign({quality:10, jpegFormat:'standard', scans:3, matte:'none', matteColor:'#ffffff'}, St.jpegOpts || {});
  let pq = last.quality, pg = String(jpegGrade(pq)), timer = 0, tick = 0;
  const src = renderDoc({}), alpha = hasTransparency(src);                // 对话框开着文件不会变：渲一次就好
  return new Promise(res => {
    Dlg.open({id:'file.jpegOptions', title:['JPEG 選項', 'JPEG 选项', 'JPEG Options'], cmd:'jpegOptions', fields:[
      {k:'matte', type:'select', label:['邊緣調合', '杂边', 'Matte'], value:last.matte, options:JPEG_MATTES},
      {k:'matteColor', type:'color', label:['', '', ''], value:last.matteColor || '#ffffff', when:v => v.matte === 'other'},
      {k:'quality', type:'number', label:['品質 (0–12)', '品质 (0–12)', 'Quality (0–12)'], value:last.quality, min:0, max:12, step:1},
      {k:'grade', type:'select', label:['', '', ''], value:String(jpegGrade(last.quality)), options:JPEG_GRADES.map(g => [String(g[0]), g[1]])},
      {k:'jpegFormat', type:'select', label:['格式選項', '格式选项', 'Format Options'], value:last.jpegFormat, options:[['standard', ['基線（標準）', '基线（"标准"）', 'Baseline ("Standard")']], ['optimized', ['基線已最佳化', '基线已优化', 'Baseline Optimized']], ['progressive', ['漸進式', '连续', 'Progressive']]]},
      {k:'scans', type:'select', label:['掃描', '扫描', 'Scans'], value:String(last.scans), options:[['3', '3'], ['4', '4'], ['5', '5']], when:v => v.jpegFormat === 'progressive'}
    ], render:(el, v) => {
      // 品质数字跟「低／中／高／最佳」互相带（PS 同）：改了等级 ⇒ 品质跳到那级；改了品质 ⇒ 等级跟着
      if (v.grade !== pg){ pg = v.grade; pq = +v.grade; Dlg.set('quality', pq); return; }
      else if (+v.quality !== pq){ pq = +v.quality; pg = String(jpegGrade(pq)); Dlg.set('grade', pg); return; }
      // 杂边只在文件有透明时能选（PS 没透明＝灰掉）
      const row = Dlg.cur && Dlg.cur.rows.find(r => r[0].k === 'matte'); if (row) row[2].disabled = !alpha;
      // 文件大小：照目前设定真的编一次（PS 对话框下方「预览」那格的 K 数）
      let note = el.querySelector('.psf-note');
      if (!note){ note = document.createElement('div'); note.className = 'psf-note'; note.dataset.jpegSize = ''; el.appendChild(note); }
      note.textContent = L3('計算中…', '计算中…', 'Calculating…');
      const my = ++tick; clearTimeout(timer);
      timer = setTimeout(() => {
        if (my !== tick || !Dlg.cur || Dlg.cur.o.id !== 'file.jpegOptions') return;
        const o = jpegOptsOf({quality:v.quality, jpegFormat:v.jpegFormat, scans:+v.scans, matte:v.matte, matteColor:v.matteColor});
        const n = jpegBytes(src, o).length;
        note.dataset.jpegSize = String(n); note.textContent = L3('檔案大小：', '文件大小：', 'File size: ') + kSize(n);
      }, 120);
    }, onOK:v => { const o = {quality:Math.round(clamp(+v.quality, 0, 12)), jpegFormat:v.jpegFormat, scans:+v.scans || 3, matte:v.matte, matteColor:v.matteColor}; clearTimeout(timer); res(o); return {ok:true}; },
      onCancel:() => { clearTimeout(timer); res(null); return {ok:false, cancelled:true}; }});
  });
}
/* 关闭前问要不要存 ⇒「存储」：走 ps.file.save 的界面分支（跟 Ctrl+S 同一条命令，网站宿主包这条命令就接得住、存回云盘）；
   beforeClose：没有系统存档框时不开「存储为」（对话框是非同步的、会先回 opened 让关闭直接往下走），照原样直接存 */
function saveBeforeClose(){
  return CMD.run('ps.file.save', {ui:true, beforeClose:true});
}
function saveAsDialog(p, copy, done){
  const id = copy ? 'file.saveACopy' : 'file.saveAs';
  Dlg.open({id, cmd:'ps.' + id, fields:[
    {k:'name', type:'text', label:['檔案名稱', '文件名', 'File Name'], value:p.name || (copy ? St.name + L3(' 拷貝', ' 拷贝', ' copy') : St.name)},
    {k:'format', type:'select', label:['格式', '格式', 'Format'], value:p.format || (St.ext && SAVE_EXTS.includes(St.ext) ? St.ext : 'dlcanvas'), options:SAVE_FORMATS},
    {k:'quality', type:'number', label:['品質 (0–12)', '品质 (0–12)', 'Quality (0–12)'], value:10, min:0, max:12, step:1, when:v => v.format === 'pdf'},
    ...(copy ? [{k:'layers', type:'check', label:['圖層', '图层', 'Layers'], value:true, when:v => v.format === 'dlcanvas' || v.format === 'psd' || v.format === 'psb'}] : [])
  ], okLabel:['儲存', '存储', 'Save'], onOK:v => {
    const write = o => {
      const arg = Object.assign({}, v, o || {});
      return !copy && fsaOK() ? pickAndWrite(arg) : CMD.run('ps.' + id, arg);
    };
    let r;
    if (v.format === 'jpg'){ delete v.quality; r = jpegOptions().then(o => o ? write(o) : {ok:false, cancelled:true}); }
    else r = write();                                                  // 按钮这一轮先挑位置，再编码，保留浏览器的使用者手势
    if (!done) return r;
    return Promise.resolve(r).then(x => { done(x); return x; }, e => { const x = {ok:false, error:String(e && e.message || e)}; done(x); return x; });
  }, onCancel:() => { const x = {ok:false, cancelled:true}; if (done) done(x); return x; }});
  return opened();
}
reg('file.saveAs', '{name 文件名（不含扩展名也行）, format:"dlcanvas|psd|ai|png|jpg|webp|tif|svg|pdf"="dlcanvas", quality:0..12=10（jpg/pdf）, psdPatterns:"native|bake"="native"（PSD：bake＝图案叠加／纹理画成像素、不写档内图案）} 存储为：存成指定名字与格式，之后「存储」就用这个名字；任何格式都算存过 → {name, format}', p => saveAs(p, false), {dialog:p => saveAsDialog(p, false)});
reg('file.saveACopy', '{name, format:"dlcanvas|psd|ai|png|jpg|webp|tif|svg|pdf"="dlcanvas", quality:0..12=10, layers:bool=true（false＝工程档／PSD 只存拼合后的一层）, psdPatterns:"native|bake"="native"} 存储副本：另存一份，不改文件名、不算存过 → {name, format}', p => saveAs(p, true), {dialog:p => saveAsDialog(p, true)});
/* 存储：存过工程档 ⇒ 就地存；没存过或上次存的是不分层格式 ⇒ 界面开「存储为」，agent 直接存成工程档（menus.rs:227 saves_in_place） */
/* PS：正在编辑智能对象内容时「存储」＝把内容存回那个智能对象（母文件跟着更新） */
// 编辑内容开成的分页（menus/impl/docs.js）：存储＝更新母文件的智能对象、分页留着（PS）；没载入多文件档才退回「完成并更新」
const smartSave = () => window.Smart && Smart.session ? (window.Docs && Docs.saveChild ? Docs.saveChild() : CMD.map['ps.layer.smartObjects.saveContents'] ? CMD.run('ps.layer.smartObjects.saveContents', {}) : null) : null;
reg('file.save', '{name?, beforeClose?（关闭前问存不存按「存储」用：不开「存储为」）} 存储：存成工程档 .dlcanvas（没存过而且是界面 ⇒ 开「存储为」）；已存成 PSD ⇒ 就地覆盖 PSD（界面：有「存储为」拿到的档案位置就直接写回，没有就开「存储为」）；编辑智能对象内容中＝存回智能对象 → {bytes}', p => {
  const sm = smartSave(); if (sm) return sm;
  if (!p.name && handleOK()) return saveInPlace();
  if ((St.ext === 'psd' || St.ext === 'psb') && !p.name) return saveInPlace(St.ext);
  if (p.name) St.name = String(p.name).replace(/\.dlcanvas$/i, '');
  return CMD.run('file.saveProject', {name:St.name});
}, {dialog:p => {
  const sm = smartSave(); if (sm) return sm;
  if (handleOK()) return saveInPlace();                              // 有原档位置 ⇒ 照原格式写回（PS）
  if (fsaOK()) return saveViaPicker(p.beforeClose ? {} : p);         // 有本地系统存档框、没有档案位置：宿主／唯一一份也先选格式再挑位置
  if (p.beforeClose) return CMD.run('ps.file.save', {});             // 关闭前「存储」：存完才关，不开非同步的「存储为」
  if (St.ext === 'dlcanvas') return CMD.run('file.saveProject', {name:St.name});
  return saveAsDialog(p, false);                                     // 没有 File System Access（或网站版）⇒ 开「存储为」走下载
}});

/* ── 恢复（file_cmds.rs:231 revert：读回存过的档、一步历史可退、之后算没改过） ── */
function revertNow(){
  if (!St.savedSnap) throw new PsBad('ps.file.revert: the document has never been saved');
  const w0 = Doc.width, h0 = Doc.height;
  History.push(); History.restore(cloneSnap(St.savedSnap)); markSaved();
  if ((Doc.width !== w0 || Doc.height !== h0) && window.UI){ UI.fit(); if (window.HandView) HandView.reset(); }
  return {layers:Doc.layers.length, name:St.name};
}
reg('file.revert', '{} 恢复：回到上次存储（或打开）时的样子，一步历史可退；没存过 ⇒ 报错', revertNow, {dialog:async () => {
  if (!St.savedSnap) return {ok:false, error:L3('這份文件還沒儲存過', '这份文件还没存储过', 'The document has never been saved')};
  if (isDirty() && !await confirmDiscard('revert')) return {ok:false, cancelled:true};
  return revertNow();
}});

/* ── 打开为（file_cmds.rs:264 open_bytes_as：按指定格式解；我们是 dlcanvas 或图片）── 只有一份文件 ⇒ 换掉目前这份 */
async function openImageAsDoc(src, name){
  const img = await loadImage(src), W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const c = imageCanvas(img), clear = hasTransparency(c);
  Doc.reset(W, H, null, false);
  const L = Layer.raster(clear ? Lang.t('layer.untitled') + ' 0' : Lang.t('layer.bg'), W, H);
  L.data.ctx.drawImage(c, 0, 0);
  if (!clear){ L.isBackground = true; L.locks = {transparency:true, pixels:false, position:true, artboard:false, all:false}; }   // PS：不透明图打开＝锁住的背景层
  Doc.layers = [L]; Doc.activeId = L.id; History.clear();
  St.name = stem(name); St.ext = extOf(name) || 'png'; St.savedSnap = History.snap(); markSaved();
  if (window.UI){ UI.fit(); UI.refresh(); } if (window.HandView) HandView.reset();
  fireEvent('openDocument');
  return {width:W, height:H, name:St.name, layers:1};
}
async function openAs(p){
  const it = inputsOf(p)[0]; if (!it) throw new PsBad('ps.file.openAs: need url (or files)');
  const as = String(p.as || p.format || extOf(it.name)).toLowerCase();
  if (as === 'dlcanvas' || as === 'json'){
    const json = JSON.parse(await readText(it.src));
    St.opening = it.anon ? null : stem(it.name); await Project.load(json);   // 没档名（dataURL）⇒ 用工程档里的 docName
    return {name:St.name, layers:Doc.layers.length, width:Doc.width, height:Doc.height};
  }
  if (as === 'psd' || as === 'psb' || isPsd(it)) return await openPsdAsDoc(it.src, it.name);   // PSD 照分层开
  if (VEC_EXTS.includes(as) || (!as && isVec(it))) return await openVectorAsDoc(it.src, it.name, {page:p.page});   // SVG／PDF／.ai 照分层开
  if (RAS_EXTS.includes(as) || isRas(it)) return await openRasterAsDoc(it.src, it.name);   // Krita／OpenRaster／GIMP／Procreate 照分层开
  return await openImageAsDoc(it.src, it.name);
}
reg('file.openAs', '{url（或 files）, as?:"dlcanvas|psd|psb|kra|ora|xcf|procreate|png|jpg|…"（照这个格式解；缺省看扩展名）, name?, page?（PDF／.ai 第几页·0 起）} 打开为：换掉目前这份文件（工程档照工程档开、PSD／SVG／PDF／.ai 照分层开、图片开成一层背景）→ {name, width, height, notes?}', openAs, {dialog:async p => {
  const fs = await pickFiles('', false); if (!fs.length) return {ok:false, cancelled:true};
  if (!await confirmDiscard('close')) return {ok:false, cancelled:true};
  return openAs(Object.assign({}, p, {files:fs, ui:false}));
}});

/* ── 置入嵌入对象（file_cmds.rs:290 place_bytes：比画布大就缩进来、置中；我们没有智能对象 ⇒ 一层像素层） ── */
async function place(p){
  const it = inputsOf(p)[0]; if (!it) throw new PsBad('ps.file.placeEmbedded: need url (or files)');
  if (!window.Smart || !Layer.smart) throw new PsBad('ps.file.placeEmbedded: smart objects are not loaded');
  // PS：置入嵌入的对象＝智能对象（内容嵌在文件里；之后滤镜＝智能滤镜、可回头改）；PSD 置入＝它的合成图当内容
  let extra;
  if (it.src instanceof Blob && SiteHooks.hasLocalHook && SiteHooks.hasLocalHook()){             // 网站版：本机档先问宿主（上传云盘＝之后存档只存引用）
    const file = it.src instanceof File ? it.src : new File([it.src], it.name, {type:it.src.type || 'image/png'});
    const ans = await SiteHooks.askLocal(file, 'image');
    if (ans.handled) return {ok:true, handled:true, by:'host'};
    const fid = ans.fileId ? await Promise.resolve(ans.fileId).catch(() => null) : null;
    if (fid) extra = {src:{file_id:String(fid)}};
  }
  const name = p.name || stem(it.name), cname = fileName(it.name) || 'image.png';
  let e;
  if (isPsd(it)) e = Smart.fromImage(await psdCanvas(it.src), cname, extra);
  else { const url = srcURL(it.src); try { e = await Smart.imageEntry(url, cname, extra); } finally { if (it.src instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 1000); } }
  const w = e.w, h = e.h, cw = Doc.width, ch = Doc.height;
  let k = 1;
  if (isNum(+p.scale) && p.scale !== '' && p.scale !== undefined) k = Math.max(+p.scale / 100, 1e-4);
  else if (p.fit !== false && (w > cw || h > ch)) k = Math.min(cw / w, ch / h);
  const c = Array.isArray(p.center) && p.center.length === 2 ? [isNum(+p.center[0]) ? +p.center[0] : cw / 2, isNum(+p.center[1]) ? +p.center[1] : ch / 2] : [cw / 2, ch / 2];
  const dx = Math.round(c[0] - w * k / 2), dy = Math.round(c[1] - h * k / 2);
  History.push();
  const S = Layer.smart(name || 'image', {source:{id:e.id, name:e.name, type:e.type}, transform:[k, 0, 0, k, dx, dy]});
  const at = Doc.activeId && Doc.index(Doc.activeId) >= 0 ? Doc.index(Doc.activeId) + 1 : Doc.layers.length;
  Doc.add(S, at); Doc.activeId = S.id; Doc.selectedIds = null; Layer.invalidate(S);
  if (window.UI) UI.refresh();
  return {layer:S.id, id:S.id, kind:'smart', scale:k * 100, bounds:[dx, dy, dx + w * k, dy + h * k]};
}
reg('file.placeEmbedded', '{url（或 files）, scale?:%（缺省：比画布大才缩进画布）, fit:bool=true, center?:[x,y]（缺省画布中心）, name?} 置入嵌入对象：图片（或 PSD 的合成图）成一个嵌入的智能对象、插在当前层上面（一步历史；之后滤镜＝智能滤镜）→ {layer, kind:"smart", scale, bounds}', place, {dialog:async p => {
  const fs = await pickFiles('image/*,.psd', false); if (!fs.length) return {ok:false, cancelled:true};
  const r = await place(Object.assign({}, p, {files:fs}));
  placeTransform(r);
  return r;
}});
/* PS：界面置入后直接进自由变换框（拖角缩放、框外拖旋转）；Enter／✓＝确定，Esc＝连置入一起取消（那层拿掉、历史退回） */
function placeTransform(r){
  if (!r || r.ok === false || !r.layer || !CMD.map['ps.edit.freeTransform'] || !window.MoveTool) return;
  const h = History.past.length;
  const t = CMD.run('ps.edit.freeTransform', {});
  if (!(t && t.ok !== false && MoveTool.xf)) return;
  MoveTool.xf.onCancel = () => { if (History.past.length === h && Doc.byId(r.layer)){ History.undo(); if (window.UI) UI.refresh(); } };
}
if (!window.FreeTransform) window.FreeTransform = {active:() => !!(window.MoveTool && MoveTool.xf)};   // 测试／宿主问「变形框开着没」
/* PS：从系统把图片档拖进已开的文件＝置入（成智能对象、进自由变换，Enter 确认）——跟 文件▸置入嵌入对象 同一条路（ui.js 画布 drop 叫这支） */
const canPlaceDrop = f => !!(f && CMD.map['ps.file.placeEmbedded'] && window.Smart && Layer.smart && (/^image\//.test(f.type || '') || /\.(psd|png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(f.name || '')));
/* at＝放开点的文件坐标 [x,y]（PS CC 2018 起：拖进来的图以滑鼠放开点为中心；AI 同）；没给＝画布中心 */
async function placeDrop(f, at){
  try {
    const q = {files:[f]};
    if (Array.isArray(at) && at.length === 2 && isFinite(at[0]) && isFinite(at[1])) q.center = [at[0], at[1]];
    const r = await CMD.run('ps.file.placeEmbedded', q);
    if (r && r.ok !== false && !r.handled){ placeTransform(r); if (window.UI) UI.draw(); }
    return r;
  } catch (e){ toast(String(e && e.message || e), true); return {ok:false, error:String(e && e.message || e)}; }
}

/* ── 文件简介（file_cmds.rs:336 INFO_FIELDS、498 file_info：给栏位＝改（一步历史）；不给＝读） ── */
const INFO_KEYS = ['title', 'author', 'authorTitle', 'description', 'keywords', 'copyright', 'copyrightStatus', 'copyrightUrl'];
function readInfo(){
  const f = Doc.fileInfo || {};
  return {title:f.title || '', author:f.author || '', authorTitle:f.authorTitle || '', description:f.description || '', keywords:Array.isArray(f.keywords) ? f.keywords.slice() : [],
    copyright:f.copyright || '', copyrightStatus:f.copyrightStatus || 'unknown', copyrightUrl:f.copyrightUrl || ''};
}
function fileInfo(p){
  const edits = INFO_KEYS.some(k => p[k] !== undefined);
  if (edits){
    const cur = readInfo();
    INFO_KEYS.forEach(k => { if (p[k] === undefined) return;
      if (k === 'keywords') cur.keywords = Array.isArray(p[k]) ? p[k].map(String).map(s => s.trim()).filter(Boolean) : String(p[k]).split(/[;,]/).map(s => s.trim()).filter(Boolean);
      else if (k === 'author' && Array.isArray(p[k])) cur.author = p[k].join('; ');
      else cur[k] = String(p[k]); });
    if (!['unknown', 'copyrighted', 'publicDomain'].includes(cur.copyrightStatus)) throw new PsBad('ps.file.fileInfo: copyrightStatus is unknown|copyrighted|publicDomain');
    History.push(); Doc.fileInfo = cur;
  }
  return readInfo();
}
reg('file.fileInfo', '{title?, author?, authorTitle?, description?, keywords?:[字]|"a; b", copyright?, copyrightStatus?:"unknown|copyrighted|publicDomain", copyrightUrl?}（不给栏位＝读）文件简介：存进文件（进历史、进工程档）→ 全部栏位', fileInfo, {dialog:() => {
  const f = readInfo();
  Dlg.open({id:'file.fileInfo', cmd:'ps.file.fileInfo', fields:[
    {k:'title', type:'text', label:['文件標題', '文档标题', 'Document Title'], value:f.title},
    {k:'author', type:'text', label:['作者', '作者', 'Author'], value:f.author},
    {k:'authorTitle', type:'text', label:['作者職稱', '作者职务', "Author's Position"], value:f.authorTitle},
    {k:'description', type:'textarea', label:['描述', '说明', 'Description'], value:f.description},
    {k:'keywords', type:'text', label:['關鍵字（; 分隔）', '关键字（; 分隔）', 'Keywords (; separated)'], value:f.keywords.join('; ')},
    {k:'copyrightStatus', type:'select', label:['版權狀態', '版权状态', 'Copyright Status'], value:f.copyrightStatus, options:[['unknown', ['未知', '未知', 'Unknown']], ['copyrighted', ['受版權保護', '受版权保护', 'Copyrighted']], ['publicDomain', ['公共領域', '公共域', 'Public Domain']]]},
    {k:'copyright', type:'text', label:['版權聲明', '版权公告', 'Copyright Notice'], value:f.copyright},
    {k:'copyrightUrl', type:'text', label:['版權資訊 URL', '版权信息 URL', 'Copyright Info URL'], value:f.copyrightUrl}
  ], onOK:v => CMD.run('ps.file.fileInfo', v)});
  return opened();
}});

/* ═══════════ 导出 ═══════════ */
/* 导出首选项（web_cmds.rs:802、prefs.rs:353 Export 预设 png／85／copyright／转 sRGB）：存浏览器 localStorage */
const PREF_KEY = 'dl.ps.exportPrefs';
const PREF_DEF = {quickExportFormat:'png', quickExportLocation:'ask', jpegQuality:85, metadata:'copyright', convertToSrgb:true};
function prefs(){ try { return Object.assign({}, PREF_DEF, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch(e){ return Object.assign({}, PREF_DEF); } }
reg('file.export.exportPreferences', '{quickExportFormat?:"png|jpg|gif|webp", jpegQuality?:1..100, metadata?:"none|copyright|all", convertToSrgb?:bool}（quickExportLocation 只有「每次问」：浏览器没有「同一资料夹」）→ {section, values}', p => {
  const v = prefs(), cmd = 'file.export.exportPreferences';
  if (p.quickExportFormat !== undefined){ const f = String(p.quickExportFormat).toLowerCase().replace('jpeg', 'jpg'); if (!['png', 'jpg', 'gif', 'webp'].includes(f)) bad(cmd, 'quickExportFormat is png|jpg|gif|webp'); v.quickExportFormat = f; }
  if (p.jpegQuality !== undefined) v.jpegQuality = clamp(Math.round(num(p, 'jpegQuality', 85)), 1, 100);
  if (p.metadata !== undefined){ if (!['none', 'copyright', 'all'].includes(p.metadata)) bad(cmd, 'metadata is none|copyright|all'); v.metadata = p.metadata; }
  if (typeof p.convertToSrgb === 'boolean') v.convertToSrgb = p.convertToSrgb;
  try { localStorage.setItem(PREF_KEY, JSON.stringify(v)); } catch(e){}
  return {section:'export', values:v};
}, {dialog:() => {
  const v = prefs();
  Dlg.open({id:'file.export.exportPreferences', cmd:'ps.file.export.exportPreferences', fields:[
    {k:'quickExportFormat', type:'select', label:['快速轉存格式', '快速导出格式', 'Quick Export Format'], value:v.quickExportFormat, options:[['png', 'PNG'], ['jpg', 'JPG'], ['gif', 'GIF'], ['webp', 'WebP']]},
    {k:'jpegQuality', type:'number', label:['JPG 品質', 'JPG 品质', 'JPG Quality'], value:v.jpegQuality, min:1, max:100, step:1, when:x => x.quickExportFormat === 'jpg'},
    {k:'metadata', type:'select', label:['中繼資料', '元数据', 'Metadata'], value:v.metadata, options:[['none', ['無', '无', 'None']], ['copyright', ['版權和聯絡資訊', '版权和联系信息', 'Copyright and Contact Info']], ['all', ['全部', '全部', 'All']]]},
    {k:'convertToSrgb', type:'check', label:['轉換為 sRGB', '转换为 sRGB', 'Convert to sRGB'], value:v.convertToSrgb}
  ], onOK:x => CMD.run('ps.file.export.exportPreferences', x)});
  return opened();
}});
/* 快速导出（web_cmds.rs:824 quick_export；export_dialog.rs:206）：照导出首选项的格式；PNG 走 file.exportPNG */
async function quickExport(p){
  const v = prefs(), f = v.quickExportFormat, name = strp(p, 'name', St.name);
  if (f === 'png') return Object.assign({format:'png'}, await CMD.run('file.exportPNG', {scale:1, name}));
  const c = renderDoc({});
  let e;
  if (f === 'jpg') e = {blob:(await optimize(c, webSettings({format:'jpeg', quality:Math.min(v.jpegQuality, 100)}, 'file.export.quickExport'))).blob, ext:'jpg'};
  else if (f === 'gif') e = await (async () => { const o = await optimize(c, webSettings({format:'gif'}, 'file.export.quickExport')); return {blob:o.blob, ext:'gif'}; })();
  else e = await encodeAs(c, 'webp');
  return Object.assign({format:f}, await sink(name + '.' + e.ext, e.blob));
}
reg('file.export.quickExport', '{name?} 快速导出：照「导出首选项」的格式（缺省 PNG＝file.exportPNG）→ {format, bytes}', quickExport);

/* 导出为（export_dialog.rs:16-201）：格式 png/jpg/webp/tif、品质 1..100（jpg）、透明（非 jpg）、缩放 %；layer＝只导这一层（修到像素外框） */
const EXPORT_FORMATS = [['png', 'PNG'], ['jpg', 'JPG'], ['webp', ['WebP（無損）', 'WebP（无损）', 'WebP (lossless)']], ['tif', 'TIFF']];
function exportCanvas(p){
  const k = num(p, 'scale', 100) / 100;
  if (p.layer){
    const L = Doc.byId(p.layer); if (!L) throw new PsBad('ps.file.export.exportAs: no layer ' + p.layer);
    const c = renderDoc({only:[L.id], normalBlend:true, trim:true}); if (!c) throw new PsBad('ps.file.export.exportAs: the layer is empty');
    return k !== 1 ? resizeCanvas(c, c.width * k, c.height * k) : c;
  }
  return renderDoc({scale:k});
}
async function exportAs(p){
  const fmt = String(p.format || 'png').toLowerCase().replace('jpeg', 'jpg').replace('tiff', 'tif');
  if (!['png', 'jpg', 'webp', 'tif'].includes(fmt)) bad('file.export.exportAs', 'format is png|jpg|webp|tif');
  const scale = clamp(num(p, 'scale', 100), 1, 1000), transparency = fmt !== 'jpg' && p.transparency !== false;
  const name = strp(p, 'name', p.layer && Doc.byId(p.layer) ? Doc.byId(p.layer).name : St.name);
  if (fmt === 'png' && transparency && !p.layer) return Object.assign({format:'png'}, await CMD.run('file.exportPNG', {scale:scale / 100, name}));
  let c = exportCanvas(Object.assign({}, p, {scale}));
  if (!transparency) c = overColor(c, '#ffffff');                    // 不透明＝拼合到白底（export_document 的 flattenImage）
  const e = await encodeAs(c, fmt, {quality:clamp(num(p, 'quality', 85), 1, 100) / 100});
  return Object.assign({format:fmt, width:c.width, height:c.height}, await sink(name + '.' + e.ext, e.blob));
}
function exportAsDialog(p){
  const W = Doc.width, H = Doc.height;
  let tick = 0;
  Dlg.open({id:'file.export.exportAs', cmd:'ps.file.export.exportAs', fields:[
    {k:'format', type:'select', label:['格式', '格式', 'Format'], value:'png', options:EXPORT_FORMATS},
    {k:'quality', type:'number', label:['品質 %', '品质 %', 'Quality %'], value:85, min:1, max:100, step:1, when:v => v.format === 'jpg'},
    {k:'transparency', type:'check', label:['透明度', '透明度', 'Transparency'], value:true, when:v => v.format !== 'jpg'},
    {k:'scale', type:'number', label:['縮放 %', '缩放 %', 'Scale %'], value:100, min:1, max:1000, step:1}
  ], okLabel:['轉存', '导出', 'Export'], onOK:v => CMD.run('ps.file.export.exportAs', Object.assign({}, p, v, {ui:false})),
  render:(box, v) => {
    const my = ++tick;
    const sc = num(v, 'scale', 100) / 100;
    // 右边：预览＋估计大小（≤360 的代理图编码，按像素数比例放大，export_dialog.rs:103 estimate）
    const prox = renderDoc({scale:Math.min(1, 360 / Math.max(W, H))});
    const pc = v.format === 'jpg' || v.transparency === false ? overColor(prox, '#ffffff') : prox;
    encodeAs(pc, v.format, {quality:num(v, 'quality', 85) / 100}).then(e => {
      if (my !== tick || !Dlg.cur) return;
      box.innerHTML = '';
      const cv = mkCanvas(pc.width, pc.height); ctx2d(cv).drawImage(pc, 0, 0); cv.style.maxWidth = '300px'; box.appendChild(cv);
      const est = e.blob.size * (W * sc * H * sc) / (pc.width * pc.height);
      const n = document.createElement('div'); n.className = 'psf-note'; n.dataset.est = String(Math.round(est));
      n.textContent = `${Math.round(W * sc)} × ${Math.round(H * sc)} px · ${String(v.format).toUpperCase()} ≈ ${humanBytes(est)}`; box.appendChild(n);
    }).catch(() => {});
  }});
  return opened();
}
const humanBytes = b => b < 1024 ? Math.round(b) + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB';
reg('file.export.exportAs', '{format:"png|jpg|webp|tif"="png", quality:1..100=85（jpg）, transparency:bool=true（非 jpg；false＝垫白）, scale:%=100（矢量层按倍率重画）, layer?:id（只导这一层、修到像素外框）, name?} 导出为（整份透明 PNG 走 file.exportPNG）→ {format, width, height, bytes}', exportAs, {dialog:p => exportAsDialog(p)});

/* 存储为 Web 所用格式（旧版）（web_cmds.rs:709 save_for_web；file_ui.rs:182 对话框预设：jpeg／60…）：estimate:true＝只估大小 */
async function saveForWeb(p){
  const cmd = 'file.export.saveForWebLegacy', st = webSettings(p, cmd);
  const W0 = Doc.width, H0 = Doc.height;
  let tw = W0, th = H0;
  const pct = num(p, 'percent', 0), w = num(p, 'width', 0), h = num(p, 'height', 0);
  if (pct > 0){ tw = W0 * pct / 100; th = H0 * pct / 100; } else if (w > 0 && h > 0){ tw = w; th = h; } else if (w > 0){ tw = w; th = H0 * w / W0; } else if (h > 0){ th = h; tw = W0 * h / H0; }
  tw = Math.max(1, Math.round(tw)); th = Math.max(1, Math.round(th));
  const c = renderDoc({width:tw, height:th});
  St.lastWeb = Object.assign({}, p); delete St.lastWeb.estimate; delete St.lastWeb.ui;
  const o = await optimize(c, st);
  if (p.estimate) return {format:o.ext, bytes:o.blob.size, width:o.width, height:o.height, colors:o.colors};
  const name = strp(p, 'name', St.name);
  // PNG-24 带透明、等比 ⇒ 跟 file.exportPNG 出来的是同一张图，走它（网站版存云盘）
  if (st.format === 'png24' && Math.abs(tw / W0 - th / H0) < 1e-3 && (st.transparency || !hasTransparency(c)))
    return Object.assign({format:'png', width:tw, height:th, colors:null}, await CMD.run('file.exportPNG', {scale:tw / W0, name}));
  return Object.assign({format:o.ext, width:o.width, height:o.height, colors:o.colors}, await sink(name + '.' + o.ext, o.blob));
}
function saveForWebDialog(p){
  const last = Object.assign({format:'jpeg', quality:60}, St.lastWeb || {});
  const d = Object.assign({}, WEB_DEFAULT, {colors:128, percent:100}, last, p); delete d.ui;
  const idx = v => v.format === 'gif' || v.format === 'png8';
  let tick = 0;
  Dlg.open({id:'file.export.saveForWebLegacy', cmd:'ps.file.export.saveForWebLegacy', fields:[
    {k:'preset', type:'select', label:['預設集', '预设', 'Preset'], value:'', options:[['', ['〔自訂〕', '〔自定〕', '[Custom]']]].concat(Object.keys(WEB_PRESETS).map(k => [k, k]))},
    {k:'format', type:'select', label:['格式', '格式', 'Format'], value:WEB_FORMATS[d.format] || 'jpeg', options:[['gif', 'GIF'], ['png8', 'PNG-8'], ['png24', 'PNG-24'], ['jpeg', 'JPEG'], ['wbmp', 'WBMP']]},
    {k:'quality', type:'number', label:['品質', '品质', 'Quality'], value:d.quality, min:0, max:100, step:1, when:v => v.format === 'jpeg'},
    {k:'palette', type:'select', label:['減低色彩深度', '减低颜色深度算法', 'Color Reduction'], value:d.palette, options:[['perceptual', ['知覺', '可感知', 'Perceptual']], ['selective', ['選擇性', '可选择', 'Selective']], ['adaptive', ['最適化', '随样性', 'Adaptive']], ['restrictive', ['限制 (網頁)', '受限 (Web)', 'Restrictive']], ['exact', ['正確', '精确', 'Exact']], ['systemMac', 'Mac OS'], ['systemWindows', 'Windows'], ['uniform', ['一致', '平均', 'Uniform']]], when:idx},
    {k:'colors', type:'number', label:['顏色', '颜色', 'Colors'], value:d.colors, min:2, max:256, step:1, when:idx},
    {k:'dither', type:'select', label:['混色', '仿色', 'Dither'], value:d.dither, options:[['none', ['無混色', '无仿色', 'No Dither']], ['diffusion', ['擴散', '扩散', 'Diffusion']], ['pattern', ['圖樣', '图案', 'Pattern']], ['noise', ['雜訊', '杂色', 'Noise']]], when:v => idx(v) || v.format === 'wbmp'},
    {k:'ditherAmount', type:'number', label:['混色 %', '仿色 %', 'Dither %'], value:d.ditherAmount, min:0, max:100, step:1, when:v => idx(v) && v.dither !== 'none'},
    {k:'transparency', type:'check', label:['透明度', '透明度', 'Transparency'], value:d.transparency, when:v => v.format !== 'jpeg' && v.format !== 'wbmp'},
    {k:'matte', type:'color', label:['邊緣調合', '杂边', 'Matte'], value:d.matte || '#ffffff'},
    {k:'webSnap', type:'number', label:['網頁靠齊 %', 'Web 靠色 %', 'Web Snap %'], value:d.webSnap, min:0, max:100, step:1, when:idx},
    {k:'percent', type:'number', label:['百分比', '百分比', 'Percent'], value:d.percent || 100, min:1, max:1000, step:1}
  ], okLabel:['儲存…', '存储…', 'Save…'], onOK:v => { const q = Object.assign({}, v); if (!q.preset) delete q.preset; return CMD.run('ps.file.export.saveForWebLegacy', q); },
  render:(box, v) => {
    const my = ++tick;
    if (v.preset && WEB_PRESETS[v.preset]){                          // 选预设＝把它的栏位填进来（先清掉预设，免得 set 又叫回这里）
      const pr = Object.assign({}, WEB_DEFAULT, {colors:128, palette:'selective', dither:'diffusion'}, WEB_PRESETS[v.preset]);
      Dlg.set('preset', '');
      ['format', 'quality', 'colors', 'dither', 'palette'].forEach(k => { if (Dlg.cur && Dlg.cur.vals[k] !== pr[k]) Dlg.set(k, pr[k]); });
      return;
    }
    const W = Doc.width, H = Doc.height, k = num(v, 'percent', 100) / 100, pk = Math.min(k, 300 / Math.max(W, H));
    const q = Object.assign({}, v); delete q.preset;
    let st; try { st = webSettings(q, 'file.export.saveForWebLegacy'); } catch(e){ return; }
    optimize(renderDoc({scale:pk}), st).then(o => {
      if (my !== tick || !Dlg.cur) return;
      box.innerHTML = ''; o.preview.style.maxWidth = '320px'; box.appendChild(o.preview);
      const est = o.blob.size * (W * k * H * k) / (o.width * o.height);
      const n = document.createElement('div'); n.className = 'psf-note'; n.dataset.est = String(Math.round(est));
      n.textContent = `${String(v.format).toUpperCase()} · ${Math.round(W * k)} × ${Math.round(H * k)} · ≈ ${humanBytes(est)}` + (o.colors ? ` · ${o.colors} ${L3('色', '色', 'colors')}` : '');
      box.appendChild(n);
    }).catch(e => { if (my === tick) box.textContent = String(e.message || e); });
  }});
  return opened();
}
reg('file.export.saveForWebLegacy', '{preset?:"GIF 128 Dithered|JPEG High|PNG-24|…", format:"gif|png8|png24|jpeg|wbmp"="png24", palette:"perceptual|selective|adaptive|restrictive|exact|systemMac|systemWindows|uniform"="selective", colors:2..256=256, dither:"none|diffusion|pattern|noise"="diffusion", ditherAmount:0..100=88, transparency:bool=true, matte:"#rrggbb"|"none"="#ffffff", webSnap:0..100=0, quality:0..100=60, percent?|width?|height?（尺寸）, estimate:bool（只估大小不存）, name?} 存储为 Web 所用格式（没有切片、不嵌中继资料、不做交错／渐进）→ {format, bytes, width, height, colors}', saveForWeb, {dialog:p => saveForWebDialog(p)});

/* 图层导出到文件（file_cmds.rs:798 layers_to_files）：顶层每一层一个档（由上到下编号；整张画布大小、只有那一层、可见与否看 visibleOnly） */
async function layersToFiles(p){
  const cmd = 'file.export.layersToFiles';
  const format = String(p.format || 'png').toLowerCase().replace(/^\./, '').replace('jpeg', 'jpg').replace('tiff', 'tif');
  if (!['png', 'jpg', 'webp', 'tif', 'gif', 'png8', 'pdf'].includes(format)) bad(cmd, 'format is png|jpg|webp|tif|gif|png8|pdf');
  const visibleOnly = p.visibleOnly !== false, prefix = strp(p, 'prefix', St.name);
  const layers = Doc.layers.slice().reverse().filter(L => L.visible || !visibleOnly);
  const files = [];
  for (let i = 0; i < layers.length; i++){
    const L = layers[i];
    const c = renderDoc({only:[L.id]});
    const e = await encodeAs(c, format, {quality:format === 'jpg' || format === 'pdf' ? q12(num(p, 'quality', 10)) : undefined});
    const name = `${sanitize(prefix)}_${pad4(i)}_${sanitize(L.name)}.${e.ext}`;
    await sink((p.dir ? String(p.dir).replace(/[\\/]+$/, '') + '/' : '') + name, e.blob);
    files.push(name);
  }
  return {files};
}
reg('file.export.layersToFiles', '{format:"png|jpg|webp|tif|gif|png8|pdf"="png", prefix=文件名, visibleOnly:bool=true, quality:0..12?（jpg）, dir?（档名前加「资料夹/」）} 将图层导出到文件：顶层每层一档 <prefix>_0000_<层名>（由上到下）→ {files}', layersToFiles, {dialog:p => {
  Dlg.open({id:'file.export.layersToFiles', cmd:'ps.file.export.layersToFiles', fields:[
    {k:'prefix', type:'text', label:['檔案名稱字首', '文件名前缀', 'File Name Prefix'], value:St.name},
    {k:'format', type:'select', label:['檔案類型', '文件类型', 'File Type'], value:'png', options:[['png', 'PNG'], ['jpg', 'JPEG'], ['webp', 'WebP'], ['tif', 'TIFF'], ['gif', 'GIF'], ['png8', 'PNG-8'], ['pdf', 'PDF']]},
    {k:'quality', type:'number', label:['品質 (0–12)', '品质 (0–12)', 'Quality (0–12)'], value:10, min:0, max:12, step:1, when:v => v.format === 'jpg' || v.format === 'pdf'},
    {k:'visibleOnly', type:'check', label:['僅限可見圖層', '仅限可见图层', 'Visible Layers Only'], value:true}
  ], okLabel:['執行', '运行', 'Run'], onOK:v => CMD.run('ps.file.export.layersToFiles', v)});
  return opened();
}});

/* 画板至文件／PDF（artboard_cmds.rs:338、406）：我们没有画板 ⇒ 整张画布算唯一一块（名字「画板 1」） */
const boardName = () => L3('工作區域 1', '画板 1', 'Artboard 1');
async function artboardsToFiles(p){
  const format = String(p.format || 'png').toLowerCase().replace('jpeg', 'jpg').replace('tiff', 'tif');
  if (!['png', 'jpg', 'webp', 'tif', 'gif', 'png8'].includes(format)) bad('file.export.artboardsToFiles', 'format is png|jpg|webp|tif|gif|png8');
  const prefix = p.prefix === '' ? '' : strp(p, 'prefix', St.name);
  const nm = prefix ? `${sanitize(prefix)}_${sanitize(boardName())}` : sanitize(boardName());
  if (format === 'png') { await CMD.run('file.exportPNG', {scale:1, name:nm}); return {files:[nm + '.png']}; }
  const e = await encodeAs(renderDoc({}), format, {quality:format === 'jpg' ? q12(num(p, 'quality', 10)) : undefined});
  await sink(nm + '.' + e.ext, e.blob);
  return {files:[nm + '.' + e.ext]};
}
reg('file.export.artboardsToFiles', '{format:"png|jpg|webp|tif|gif|png8"="png", prefix=文件名（""＝不加）, quality:0..12?} 画板至文件：整张画布当唯一一块画板 → {files}', artboardsToFiles, {dialog:() => {
  Dlg.open({id:'file.export.artboardsToFiles', cmd:'ps.file.export.artboardsToFiles', fields:[
    {k:'prefix', type:'text', label:['檔案名稱字首', '文件名前缀', 'File Name Prefix'], value:St.name},
    {k:'format', type:'select', label:['檔案類型', '文件类型', 'File Type'], value:'png', options:[['png', 'PNG'], ['jpg', 'JPEG'], ['webp', 'WebP'], ['tif', 'TIFF'], ['gif', 'GIF'], ['png8', 'PNG-8']]},
    {k:'quality', type:'number', label:['品質 (0–12)', '品质 (0–12)', 'Quality (0–12)'], value:10, min:0, max:12, step:1, when:v => v.format === 'jpg'}
  ], okLabel:['執行', '运行', 'Run'], onOK:v => CMD.run('ps.file.export.artboardsToFiles', v)});
  return opened();
}});
async function artboardsToPdf(p){
  const quality = num(p, 'quality', 10), name = strp(p, 'name', St.name).replace(/\.pdf$/i, '');
  const c = overColor(renderDoc({}), '#ffffff');                     // 拼合到白底、JPEG
  const jpeg = await blobBytes(await canvasBlob(c, 'image/jpeg', q12(quality)));
  const pdf = rasterPDF([{w:c.width, h:c.height, dpi:Doc.dpi || 72, jpeg}]);
  const r = await sink(name + '.pdf', pdf);
  return Object.assign({pages:1}, r);
}
reg('file.export.artboardsToPdf', '{name?, quality:0..12=10} 画板至 PDF：整张画布一页（白底 JPEG，页面大小按分辨率）→ {pages, bytes}', artboardsToPdf, {dialog:() => {
  Dlg.open({id:'file.export.artboardsToPdf', cmd:'ps.file.export.artboardsToPdf', fields:[
    {k:'name', type:'text', label:['檔案名稱', '文件名', 'File Name'], value:St.name},
    {k:'quality', type:'number', label:['品質 (0–12)', '品质 (0–12)', 'Quality (0–12)'], value:10, min:0, max:12, step:1}
  ], okLabel:['執行', '运行', 'Run'], onOK:v => CMD.run('ps.file.export.artboardsToPdf', v)});
  return opened();
}});

/* 路径到 Illustrator（print_cmds.rs:461 paths_to_ai：AI3 相容 PostScript，m/L/C、n 闭合 N 开放、*u *U 复合）：我们没有路径面板 ⇒ 用矢量层的形状（每层一条路径） */
function vectorPaths(which){
  const out = [];
  Doc.layers.forEach(L => {
    if (L.kind !== 'vector') return;
    if (which !== 'all' && L.name !== which) return;
    const subs = [];
    (L.data.shapes || []).forEach(s => {
      const v = s.type === 'bezier' ? s : (window.VecSel && VecSel.asBezier ? VecSel.asBezier(s) : null);
      if (!v || !v.anchors || !v.anchors.length) return;
      subs.push({anchors:v.anchors.map(a => ({x:a.x + L.x, y:a.y + L.y, in:a.in ? [a.in[0] + L.x, a.in[1] + L.y] : null, out:a.out ? [a.out[0] + L.x, a.out[1] + L.y] : null})), closed:!!v.closed});
    });
    if (subs.length) out.push({name:L.name, subs});
  });
  return out;
}
function pathsToAI(which){
  const dpi = Math.max(1, Doc.dpi || 72), k = 72 / dpi, w = Doc.width * k, h = Doc.height * k;
  const f4 = v => v.toFixed(4), pt = (x, y) => [x * k, h - y * k];
  let s = '%!PS-Adobe-2.0 EPSF-1.2\n%%Creator: Dilin Canvas\n';
  s += `%%Title: (${String(St.name).replace(/[()]/g, '_')})\n`;
  s += `%%BoundingBox: 0 0 ${Math.ceil(w)} ${Math.ceil(h)}\n%%HiResBoundingBox: 0 0 ${f4(w)} ${f4(h)}\n%AI3_Cropmarks: 0 0 ${f4(w)} ${f4(h)}\n`;
  s += '%%DocumentProcessColors: Black\n%%EndComments\n%%EndProlog\n%%BeginSetup\n%%EndSetup\n';
  const paths = vectorPaths(which);
  paths.forEach(({name, subs}) => {
    s += `%%Note: ${name}\n`;
    const compound = subs.length > 1; if (compound) s += '*u\n';
    subs.forEach(sp => {
      const A = sp.anchors, [x0, y0] = pt(A[0].x, A[0].y); s += `${f4(x0)} ${f4(y0)} m\n`;
      const seg = (a, b) => {
        const [bx, by] = pt(b.x, b.y);
        if (!a.out && !b.in){ s += `${f4(bx)} ${f4(by)} L\n`; return; }
        const c1 = a.out || [a.x, a.y], c2 = b.in || [b.x, b.y], [x1, y1] = pt(c1[0], c1[1]), [x2, y2] = pt(c2[0], c2[1]);
        s += `${f4(x1)} ${f4(y1)} ${f4(x2)} ${f4(y2)} ${f4(bx)} ${f4(by)} C\n`;
      };
      for (let i = 1; i < A.length; i++) seg(A[i - 1], A[i]);
      if (sp.closed && A.length >= 2) seg(A[A.length - 1], A[0]);
      s += sp.closed ? 'n\n' : 'N\n';
    });
    if (compound) s += '*U\n';
  });
  s += '%%PageTrailer\n%%Trailer\n%%EOF\n';
  return {text:s, n:paths.length};
}
reg('file.export.pathsToIllustrator', '{paths:"all"|矢量层名="all", name?, return?:bool（true＝只回文字不存档）} 路径到 Illustrator：矢量层的形状写成 AI3 PostScript（.ai）→ {paths, bytes}|{ai, paths}', async p => {
  const which = strp(p, 'paths', 'all'), r = pathsToAI(which);
  if (!r.n) bad('file.export.pathsToIllustrator', `no paths match \`${which}\` (we use vector layers as paths)`);
  if (p.return) return {ai:r.text, paths:r.n};
  return Object.assign({paths:r.n}, await sink(strp(p, 'name', St.name).replace(/\.ai$/i, '') + '.ai', new Blob([r.text], {type:'application/postscript'})));
}, {dialog:() => {
  const names = Doc.layers.filter(L => L.kind === 'vector').map(L => [L.name, L.name]);
  if (!names.length) return {ok:false, error:L3('文件裡沒有向量圖層可當路徑', '文件里没有矢量图层可当路径', 'The document has no vector layers to use as paths')};
  Dlg.open({id:'file.export.pathsToIllustrator', cmd:'ps.file.export.pathsToIllustrator', fields:[
    {k:'paths', type:'select', label:['路徑', '路径', 'Paths'], value:'all', options:[['all', ['全部路徑', '所有路径', 'All Paths']]].concat(names)},
    {k:'name', type:'text', label:['檔案名稱', '文件名', 'File Name'], value:St.name}
  ], onOK:v => CMD.run('ps.file.export.pathsToIllustrator', v)});
  return opened();
}});

/* 生成 ▸ 图像资源（web_cmds.rs:924-1145 Generator 命名语法）：开着时每次存储，把名字像「foo.png」「200% foo@2x.png, 48x48 icons/a.png8」「photo.jpg80%」的层导出成 <文件名>-assets/… */
function unitPx(tok, dpi){
  if (tok === '?') return {v:null};
  let n = tok, k = 1;
  if (/px$/.test(tok)){ n = tok.slice(0, -2); } else if (/in$/.test(tok)){ n = tok.slice(0, -2); k = dpi; } else if (/cm$/.test(tok)){ n = tok.slice(0, -2); k = dpi / 2.54; } else if (/mm$/.test(tok)){ n = tok.slice(0, -2); k = dpi / 25.4; }
  const v = parseFloat(n.trim()); return isFinite(v) && v > 0 && /^\s*[\d.]+\s*$/.test(n) ? {v:v * k} : null;
}
function parseSize(item, dpi){
  item = item.trim();
  const sp = item.search(/\s/), first = sp < 0 ? item : item.slice(0, sp), rest = sp < 0 ? '' : item.slice(sp).trim();
  const pc = /^([\d.]+)%$/.exec(first); if (pc && +pc[1] > 0) return {scale:+pc[1] / 100, w:null, h:null, rest};
  const xi = first.search(/[xX]/);
  if (xi > 0 && xi < first.length - 1){ const a = unitPx(first.slice(0, xi), dpi), b = unitPx(first.slice(xi + 1), dpi); if (a && b) return {scale:null, w:a.v, h:b.v, rest}; }
  const toks = item.split(/\s+/);
  if (toks.length >= 4 && /^x$/i.test(toks[1])){ const a = unitPx(toks[0], dpi), b = unitPx(toks[2], dpi); if (a && b){ const pos = item.indexOf(toks[3]); return {scale:null, w:a.v, h:b.v, rest:item.slice(pos)}; } }
  return {scale:null, w:null, h:null, rest:item};
}
function parseAssetName(name, dpi){
  const out = [];
  String(name).split(/[,+]/).forEach(item => {
    const {scale, w, h, rest} = parseSize(item, dpi), file = rest.trim(), dot = file.lastIndexOf('.');
    if (dot <= 0) return;
    const st = file.slice(0, dot), ext = file.slice(dot + 1).toLowerCase();
    let format, quality = null, outExt;
    const jm = /^(jpe?g)(.*)$/.exec(ext);
    if (jm){
      const q = jm[2].trim();
      if (q){ const pm = /^(\d+)%$/.exec(q); if (pm) quality = clamp(+pm[1], 1, 100); else if (/^\d+$/.test(q)) quality = clamp(+q, 1, 10) * 10; else return; }
      format = 'jpg'; outExt = jm[1] === 'jpeg' ? 'jpeg' : 'jpg';
    } else if (ext === 'png' || ext === 'png32'){ format = 'png32'; outExt = 'png'; }
    else if (ext === 'png24'){ format = 'png24'; outExt = 'png'; } else if (ext === 'png8'){ format = 'png8'; outExt = 'png'; }
    else if (ext === 'gif' || ext === 'webp'){ format = ext; outExt = ext; } else return;
    out.push({file:`${st}.${outExt}`, format, quality, scale, width:w, height:h});
  });
  return out;
}
function parseDefaults(name, dpi){
  const t = String(name).trim(); if (!/^default(\s|$)/.test(t)) return null;
  const v = [];
  t.slice(7).split(/[,+]/).forEach(item => {
    const {scale, w, h, rest} = parseSize(item, dpi), tail = rest.trim(), i = tail.lastIndexOf('/');
    const folder = i >= 0 ? tail.slice(0, i + 1) : '', suffix = i >= 0 ? tail.slice(i + 1) : tail;
    if (scale === null && w === null && h === null && !folder && !suffix) return;
    v.push({scale, width:w, height:h, folder, suffix});
  });
  return v;
}
async function generateAssets(){
  const dpi = Math.max(1, Doc.dpi || 72), jobs = [];
  let defaults = null;
  Doc.layers.slice().reverse().forEach(L => { const d = parseDefaults(L.name, dpi); if (d){ defaults = d; return; } parseAssetName(L.name, dpi).forEach(spec => jobs.push([L, spec])); });
  const variants = defaults && defaults.length ? defaults : [{scale:null, width:null, height:null, folder:'', suffix:''}];
  const files = [], errors = [], dir = sanitize(St.name) + '-assets';
  for (const [L, spec] of jobs) for (const v of variants){
    try {
      const one = renderDoc({only:[L.id], normalBlend:true, trim:true}); if (!one) throw new Error('the layer is empty');
      const w0 = one.width, h0 = one.height;
      let k = spec.scale || 1, tw = w0 * k, th = h0 * k;
      if (spec.width && spec.height){ tw = spec.width; th = spec.height; } else if (spec.width){ tw = spec.width; th = h0 * spec.width / w0; } else if (spec.height){ th = spec.height; tw = w0 * spec.height / h0; }
      k = v.scale || 1; tw *= k; th *= k;
      if (v.width && v.height){ tw = v.width; th = v.height; } else if (v.width){ th = th * v.width / tw; tw = v.width; } else if (v.height){ tw = tw * v.height / th; th = v.height; }
      const c = resizeCanvas(one, Math.max(1, Math.round(tw)), Math.max(1, Math.round(th)));
      const base = {transparency:true, matte:null, metadata:'none'};
      const st = spec.format === 'jpg' ? Object.assign({}, WEB_DEFAULT, base, {format:'jpeg', quality:spec.quality || 90, matte:'#ffffff'})
        : spec.format === 'png8' ? Object.assign({}, WEB_DEFAULT, base, {format:'png8', dither:'none'})
        : spec.format === 'png24' ? Object.assign({}, WEB_DEFAULT, base, {format:'png24', transparency:false, matte:'#ffffff'})
        : spec.format === 'gif' ? Object.assign({}, WEB_DEFAULT, base, {format:'gif', dither:'none'})
        : Object.assign({}, WEB_DEFAULT, base, {format:'png24'});
      const di = spec.file.lastIndexOf('.'), rel = `${v.folder}${spec.file.slice(0, di)}${v.suffix}.${spec.file.slice(di + 1)}`;
      const blob = spec.format === 'webp' ? (await encodeAs(c, 'webp')).blob : (await optimize(c, st)).blob;
      await sink(dir + '/' + rel, blob); files.push(dir + '/' + rel);
    } catch(e){ errors.push({asset:spec.file, error:String(e.message || e)}); }
  }
  return {dir, files, errors};
}
reg('file.generate.imageAssets', '{on?:bool（缺省＝切换）, now?:bool（马上产一次）} 生成 ▸ 图像资源：开着时每次存储都把名字带档名的层（foo.png、200% a@2x.png、48x48 icons/b.png8、c.jpg80%、default 50% low/）导出成 <文件名>-assets/… → {enabled, files?}', async p => {
  St.assets = typeof p.on === 'boolean' ? p.on : !St.assets;
  if (St.assets && p.now) return Object.assign({enabled:true}, await generateAssets());
  return {enabled:St.assets, note:St.assets ? 'assets are written when the document is saved' : undefined};
}, {dialog:() => CMD.run('ps.file.generate.imageAssets', {})});

/* ═══════════ 打印（print_cmds.rs:30 PAPERS、257 paper、287 layout、97 marks_ops、388 print_one_copy）：开浏览器打印预览 ═══════════ */
const PAPERS = [['letter', 612, 792], ['legal', 612, 1008], ['tabloid', 792, 1224], ['a3', 841.89, 1190.55], ['a4', 595.28, 841.89], ['a5', 419.53, 595.28], ['4x6', 288, 432], ['5x7', 360, 504]];
function printLayout(p, cmd){
  let pw, ph;
  if (p.paper === undefined){ pw = 612; ph = 792; }
  else if (typeof p.paper === 'string'){ const f = PAPERS.find(x => x[0] === p.paper.toLowerCase()); if (!f) bad(cmd, `unknown paper \`${p.paper}\` (${PAPERS.map(x => x[0]).join('|')})`); pw = f[1]; ph = f[2]; }
  else if (Array.isArray(p.paper) && p.paper.length === 2){ pw = +p.paper[0] || 0; ph = +p.paper[1] || 0; }
  else bad(cmd, 'paper is a name or [width, height] in points');
  if (!(pw > 36 && ph > 36)) bad(cmd, 'paper is too small');
  if (p.orientation === 'landscape'){ const a = Math.max(pw, ph), b = Math.min(pw, ph); pw = a; ph = b; }
  const dpi = Math.max(1, Doc.dpi || 72), iw = Doc.width * 72 / dpi, ih = Doc.height * 72 / dpi;
  const marks = {cornerCrop:!!p.cornerCropMarks, centerCrop:!!p.centerCropMarks, registration:!!p.registrationMarks};
  const margin = marks.cornerCrop || marks.centerCrop || marks.registration ? 36 : 18;
  const scale = p.scaleToFit ? Math.min((pw - 2 * margin) / iw, (ph - 2 * margin) / ih) : (num(p, 'scale', 100) > 0 ? num(p, 'scale', 100) : 100) / 100;
  const w = iw * scale, h = ih * scale;
  let x, y;
  if (p.center !== false){ x = (pw - w) / 2; y = (ph - h) / 2; }
  else { const top = num(p, 'top', 0) * 72, left = num(p, 'left', 0) * 72; x = left; y = ph - top - h; }
  return {paper:[pw, ph], rect:[x, y, w, h], scale, marks};
}
/* 标记（marks_ops 的线段，换成 SVG：pt、原点左上） */
function marksSVG(m, [x, y, w, h], ph){
  const gap = 6, len = 18, Y = v => ph - v; let s = '';
  const line = (x0, y0, x1, y1) => { s += `<line x1="${x0.toFixed(2)}" y1="${Y(y0).toFixed(2)}" x2="${x1.toFixed(2)}" y2="${Y(y1).toFixed(2)}"/>`; };
  if (m.cornerCrop) [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]].forEach(([cx, cy, dx, dy]) => { line(cx + dx * gap, cy, cx + dx * (gap + len), cy); line(cx, cy + dy * gap, cx, cy + dy * (gap + len)); });
  if (m.centerCrop){ const mx = x + w / 2, my = y + h / 2; line(mx, y - gap, mx, y - gap - len); line(mx, y + h + gap, mx, y + h + gap + len); line(x - gap, my, x - gap - len, my); line(x + w + gap, my, x + w + gap + len, my); }
  if (m.registration){ const r = 5, off = gap + len / 2; [[x + w / 2, y - off], [x + w / 2, y + h + off], [x - off, y + h / 2], [x + w + off, y + h / 2]].forEach(([cx, cy]) => { s += `<circle cx="${cx.toFixed(2)}" cy="${Y(cy).toFixed(2)}" r="${r}" fill="none"/>`; line(cx - r * 1.6, cy, cx + r * 1.6, cy); line(cx, cy - r * 1.6, cx, cy + r * 1.6); }); }
  return s;
}
function printHTML(p, lay){
  const [pw, ph] = lay.paper, [x, y, w, h] = lay.rect;
  const img = overColor(renderDoc({}), '#ffffff').toDataURL('image/png');
  const esc = t => String(t).replace(/[<>&]/g, c => ({'<':'&lt;', '>':'&gt;', '&':'&amp;'}[c]));
  const desc = p.description ? esc(readInfo().description) : '', label = p.labels ? esc(St.name) : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(St.name)}</title><style>@page{size:${pw}pt ${ph}pt;margin:0}html,body{margin:0;padding:0}
.page{position:relative;width:${pw}pt;height:${ph}pt;overflow:hidden}.page img{position:absolute;left:${x}pt;top:${ph - y - h}pt;width:${w}pt;height:${h}pt}
.page svg{position:absolute;left:0;top:0}.page svg *{stroke:#000;stroke-width:.3pt}.t{position:absolute;font:9pt Helvetica,Arial,sans-serif}</style></head>
<body><div class="page"><img src="${img}"><svg width="${pw}pt" height="${ph}pt" viewBox="0 0 ${pw} ${ph}">${marksSVG(lay.marks, lay.rect, ph)}</svg>
${label ? `<div class="t" data-k="label" style="left:${x}pt;top:${Math.max(4, ph - y - h - 16)}pt">${label}</div>` : ''}${desc ? `<div class="t" data-k="description" style="left:${x}pt;top:${Math.min(ph - 14, ph - y + 6)}pt">${desc}</div>` : ''}</div></body></html>`;
}
function openPrintFrame(html){
  if (PsFile._printHook) return PsFile._printHook(html);              // 测试用
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; f.dataset.psfPrint = '1';
  document.body.appendChild(f);
  const d = f.contentWindow.document; d.open(); d.write(html); d.close();
  const go = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch(e){ console.warn(e); } setTimeout(() => f.remove(), 60000); };
  const im = d.querySelector('img'); if (im && !im.complete) im.onload = go; else setTimeout(go, 50);
  return true;
}
function doPrint(p, cmd){
  const lay = printLayout(p, cmd);
  const copies = clamp(Math.round(num(p, 'copies', 1)), 1, 999);
  const remembered = Object.assign({}, p); delete remembered.ui; delete remembered.dryRun; St.lastPrint = remembered;
  const out = {paper:lay.paper, imageRect:lay.rect, scale:lay.scale * 100, copies, sent:false};
  if (p.dryRun) return out;
  openPrintFrame(printHTML(p, lay)); out.sent = true;
  fireEvent('print');
  return out;
}
function printDialog(init){
  const d = Object.assign({paper:'letter', orientation:'portrait', scale:100, scaleToFit:false, center:true, top:0, left:0, cornerCropMarks:false, centerCropMarks:false, registrationMarks:false, description:false, labels:false, copies:1}, St.lastPrint || {}, init || {});
  delete d.ui;
  Dlg.open({id:'file.print', cmd:'ps.file.print', fields:[
    {k:'copies', type:'number', label:['份數', '份数', 'Copies'], value:d.copies, min:1, max:999, step:1},
    {k:'paper', type:'select', label:['紙張大小', '纸张大小', 'Paper'], value:d.paper, options:PAPERS.map(x => [x[0], x[0].toUpperCase()])},
    {k:'orientation', type:'select', label:['方向', '方向', 'Orientation'], value:d.orientation, options:[['portrait', ['直式', '纵向', 'Portrait']], ['landscape', ['橫式', '横向', 'Landscape']]]},
    {k:'center', type:'check', label:['居中', '居中', 'Center'], value:d.center},
    {k:'top', type:'number', label:['上 (英吋)', '顶 (英寸)', 'Top (in)'], value:d.top, min:0, max:100, step:0.01, when:v => !v.center},
    {k:'left', type:'number', label:['左 (英吋)', '左 (英寸)', 'Left (in)'], value:d.left, min:0, max:100, step:0.01, when:v => !v.center},
    {k:'scaleToFit', type:'check', label:['縮放至符合媒體', '缩放以适合介质', 'Scale to Fit Media'], value:d.scaleToFit},
    {k:'scale', type:'number', label:['縮放 %', '缩放 %', 'Scale %'], value:d.scale, min:1, max:1000, step:1, when:v => !v.scaleToFit},
    {k:'cornerCropMarks', type:'check', label:['角落裁切標記', '角裁剪标志', 'Corner Crop Marks'], value:d.cornerCropMarks},
    {k:'centerCropMarks', type:'check', label:['中央裁切標記', '中心裁剪标志', 'Center Crop Marks'], value:d.centerCropMarks},
    {k:'registrationMarks', type:'check', label:['對齊標記', '套准标记', 'Registration Marks'], value:d.registrationMarks},
    {k:'description', type:'check', label:['說明', '说明', 'Description'], value:d.description},
    {k:'labels', type:'check', label:['標籤', '标签', 'Labels'], value:d.labels}
  ], okLabel:['列印', '打印', 'Print'], onOK:v => CMD.run('ps.file.print', v),
  render:(box, v) => {                                                 // 左边一张缩小的纸＋图的位置（print_body 的预览）
    let lay; try { lay = printLayout(v, 'file.print'); } catch(e){ box.textContent = e.message; return; }
    const [pw, ph] = lay.paper, k = 220 / Math.max(pw, ph), cv = mkCanvas(pw * k, ph * k), x = ctx2d(cv);
    x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height);
    const [rx, ry, rw, rh] = lay.rect; x.drawImage(renderDoc({scale:Math.min(1, 300 / Math.max(Doc.width, Doc.height))}), rx * k, (ph - ry - rh) * k, rw * k, rh * k);
    x.strokeStyle = '#888'; x.strokeRect(0.5, 0.5, cv.width - 1, cv.height - 1);
    box.innerHTML = ''; box.appendChild(cv);
    const n = document.createElement('div'); n.className = 'psf-note'; n.textContent = `${Math.round(lay.scale * 100)}% · ${(rw / 72).toFixed(2)} × ${(rh / 72).toFixed(2)} in`; box.appendChild(n);
  }});
  return opened();
}
const PRINT_PARAMS = '{copies:1..999=1, paper:"letter|legal|tabloid|a3|a4|a5|4x6|5x7"|[w,h]pt="letter", orientation:"portrait|landscape", center:bool=true, top?/left?:英寸, scale:%=100, scaleToFit:bool=false, cornerCropMarks, centerCropMarks, registrationMarks, description, labels:bool, dryRun:bool（只排版不开打印）}';
reg('file.print', PRINT_PARAMS + ' 打印：排好版开浏览器的打印预览（打印机与份数在那里选；没有色彩管理／分色）→ {paper, imageRect(pt，原点左下), scale, sent}', p => doPrint(p, 'file.print'), {dialog:p => printDialog(p)});
reg('file.printOneCopy', '{…任何打印参数覆盖} 打印一份拷贝：用上次的打印设定、一份（没打印过 ⇒ 界面开打印对话框）', p => {
  const q = Object.assign({}, St.lastPrint || {}, p); delete q.ui; q.copies = 1;
  return doPrint(q, 'file.printOneCopy');
}, {dialog:p => St.lastPrint ? CMD.run('ps.file.printOneCopy', {}) : printDialog(p)});

/* 打包（print_cmds.rs:401 package）：文件＋连结档拷进 <名字>/ 并重连到 Links/；我们的工程档本来就把图嵌在里面、没有连结档 ⇒ 只存一份工程档（不算存过） */
reg('file.package', '{name?} 打包：存一份工程档到「<名字>/」（没有连结的智能对象，Links 是空的）→ {document, links:[], missing:[]}', async p => {
  const name = sanitize(strp(p, 'name', St.name));
  St.noMark++;
  try { const r = await CMD.run('file.saveProject', {name:name + '/' + name}); return Object.assign({folder:name, document:name + '/' + name + '.dlcanvas', links:[], missing:[]}, r || {}); }
  finally { St.noMark--; }
}, {dialog:() => {
  Dlg.open({id:'file.package', cmd:'ps.file.package', fields:[{k:'name', type:'text', label:['資料夾名稱', '文件夹名称', 'Folder Name'], value:St.name}], onOK:v => CMD.run('ps.file.package', v)});
  return opened();
}});

/* ═══════════ 自动 ═══════════ */
/* 限制图像（file_cmds.rs:515 fit_image）：等比缩进 width×height 方框；dontEnlarge 时不放大；走图像大小（ps.image.imageSize，一步历史） */
function fitImage(p){
  const w = Doc.width, h = Doc.height;
  const bw = Math.max(1, num(p, 'width', w)), bh = Math.max(1, num(p, 'height', h)), k = Math.min(bw / w, bh / h);
  if ((k > 1 && p.dontEnlarge === true) || (Math.round(w * k) === w && Math.round(h * k) === h)) return {width:w, height:h, changed:false};
  const nw = Math.max(1, Math.round(w * k)), nh = Math.max(1, Math.round(h * k));
  if (!CMD.map['ps.image.imageSize']) bad('file.automate.fitImage', 'needs ps.image.imageSize (menus/impl/ps-image.js)');
  const r = CMD.run('ps.image.imageSize', {width:nw, height:nh, resample:strp(p, 'resample', 'bicubic')});
  if (r && r.ok === false) return r;
  return {width:nw, height:nh, changed:true};
}
reg('file.automate.fitImage', '{width:px, height:px, dontEnlarge:bool=false, resample:"bicubic|bilinear|nearest|lanczos|preserveDetails"="bicubic"} 限制图像：等比缩到放得进这个方框（走图像大小、一步历史）→ {width, height, changed}', fitImage, {dialog:() => {
  Dlg.open({id:'file.automate.fitImage', cmd:'ps.file.automate.fitImage', fields:[
    {k:'width', type:'number', label:['寬度 (像素)', '宽度 (像素)', 'Width (px)'], value:Doc.width, min:1, max:300000, step:1},
    {k:'height', type:'number', label:['高度 (像素)', '高度 (像素)', 'Height (px)'], value:Doc.height, min:1, max:300000, step:1},
    {k:'dontEnlarge', type:'check', label:['不要放大', '不放大', "Don't Enlarge"], value:false}
  ], onOK:v => CMD.run('ps.file.automate.fitImage', v)});
  return opened();
}});

/* 条件模式更改（file_cmds.rs:543 conditional_mode_change）：目前模式在「来源模式」里、又不是目标模式 ⇒ 走图像 ▸ 模式（ps.image.mode.*，在图像菜单） */
const MODES_FROM = ['rgb', 'grayscale', 'cmyk', 'lab', 'indexed', 'bitmap', 'duotone', 'multichannel'];
function conditionalModeChange(p){
  const cmd = 'file.automate.conditionalModeChange';
  const to0 = String(strp(p, 'to', '')).toLowerCase(); if (!to0) bad(cmd, 'missing "to"');
  const to = to0 === 'gray' ? 'grayscale' : to0;
  if (!['rgb', 'grayscale', 'cmyk', 'lab'].includes(to)) bad(cmd, `unsupported target mode "${to0}" (rgb, grayscale, cmyk, lab)`);
  const cur0 = Doc.mode || 'rgb', cur = cur0 === 'indexedColor' ? 'indexed' : cur0;
  const norm = v => { v = String(v).toLowerCase(); return v === 'gray' ? 'grayscale' : v === 'indexedcolor' ? 'indexed' : v; };
  const from = Array.isArray(p.from) ? p.from.map(norm) : (typeof p.from === 'string' && p.from !== 'any') ? [norm(p.from)] : ['any'];
  if (cur === to || !from.some(f => f === 'any' || f === cur)) return {changed:false, mode:cur};
  if (!CMD.map['ps.image.mode.' + to]) bad(cmd, 'needs ps.image.mode.' + to + ' (menus/impl/ps-image.js)');
  const r = CMD.run('ps.image.mode.' + to, {});
  if (r && r.ok === false) return r;
  return {changed:true, mode:to};
}
reg('file.automate.conditionalModeChange', '{from:["rgb","grayscale","cmyk","lab","indexed","bitmap","duotone","multichannel"…]|"any"="any", to:"rgb|grayscale|cmyk|lab"} 条件模式更改：目前模式在来源里才转（走图像 ▸ 模式，一步历史）→ {changed, mode}', conditionalModeChange, {dialog:() => {
  Dlg.open({id:'file.automate.conditionalModeChange', cmd:'ps.file.automate.conditionalModeChange', fields:[
    {k:'from', type:'select', label:['來源模式', '源模式', 'Source Mode'], value:'any', options:[['any', ['全部', '全部', 'All']]].concat(MODES_FROM.map(m => [m, m]))},
    {k:'to', type:'select', label:['目標模式', '目标模式', 'Target Mode'], value:'rgb', options:[['rgb', 'RGB'], ['grayscale', ['灰階', '灰度', 'Grayscale']], ['cmyk', 'CMYK'], ['lab', 'Lab']]}
  ], onOK:v => CMD.run('ps.file.automate.conditionalModeChange', v)});
  return opened();
}});

/* 裁剪并拉直照片（photo_cmds.rs:702；algo/src/scancrop.rs find_photos） */
function otsu(v){
  const B = 256, hist = new Float64Array(B);
  for (const x of v) hist[Math.floor(clamp(x, 0, 1) * (B - 1))] += 1;
  let total = 0, sum = 0; for (let i = 0; i < B; i++){ total += hist[i]; sum += i * hist[i]; }
  let wb = 0, sb = 0, best = 0, thr = 0;
  for (let i = 0; i < B; i++){
    wb += hist[i]; if (wb === 0) continue;
    const wf = total - wb; if (wf === 0) break;
    sb += i * hist[i];
    const mb = sb / wb, mf = (sum - sb) / wf, between = wb * wf * (mb - mf) * (mb - mf);
    if (between > best){ best = between; thr = i; }
  }
  return (thr + 0.5) / (B - 1);
}
function morph(w, h, m, r, dilate){
  const pass = (src, horiz) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      let acc = !dilate;
      for (let d = -r; d <= r; d++){
        const xx = horiz ? x + d : x, yy = horiz ? y : y + d;
        const v = xx < 0 || yy < 0 || xx >= w || yy >= h ? false : !!src[yy * w + xx];
        if (dilate) acc = acc || v; else acc = acc && v;
      }
      out[y * w + x] = acc ? 1 : 0;
    }
    return out;
  };
  return pass(pass(m, true), false);
}
function convexHull(pts){
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  pts = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = []; for (const p of pts){ while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = []; for (let i = pts.length - 1; i >= 0; i--){ const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop(); return lower.concat(upper);
}
function minRect(hull){
  let best = [Infinity, [0, 0], 0, 0, 0];
  const n = hull.length;
  for (let i = 0; i < n; i++){
    const a = hull[i], b = hull[(i + 1) % n], th = Math.atan2(b[1] - a[1], b[0] - a[0]), s = Math.sin(th), c = Math.cos(th);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of hull){ const u = c * p[0] + s * p[1], v = -s * p[0] + c * p[1]; x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
    const area = (x1 - x0) * (y1 - y0);
    if (area < best[0]){ const cu = (x0 + x1) / 2, cv = (y0 + y1) / 2; best = [area, [c * cu - s * cv, s * cu + c * cv], x1 - x0, y1 - y0, th * 180 / Math.PI]; }
  }
  let [, center, w, h, ang] = best;
  while (ang > 45){ ang -= 90; [w, h] = [h, w]; }
  while (ang < -45){ ang += 90; [w, h] = [h, w]; }
  return [center, w, h, ang];
}
function findPhotos(w, h, rgba){
  if (w < 8 || h < 8) return [];
  const k = Math.max(1, Math.ceil(Math.max(w, h) / 800)), sw = Math.ceil(w / k), sh = Math.ceil(h / k);
  const small = new Float32Array(sw * sh * 3), cnt = new Uint32Array(sw * sh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const i = Math.floor(y / k) * sw + Math.floor(x / k), o = (y * w + x) * 4; small[i * 3] += rgba[o]; small[i * 3 + 1] += rgba[o + 1]; small[i * 3 + 2] += rgba[o + 2]; cnt[i]++; }
  for (let i = 0; i < sw * sh; i++){ const c = Math.max(1, cnt[i]); small[i * 3] /= c; small[i * 3 + 1] /= c; small[i * 3 + 2] /= c; }
  const border = [], at = i => [small[i * 3], small[i * 3 + 1], small[i * 3 + 2]];
  for (let x = 0; x < sw; x++){ border.push(at(x)); border.push(at((sh - 1) * sw + x)); }
  for (let y = 0; y < sh; y++){ border.push(at(y * sw)); border.push(at(y * sw + sw - 1)); }
  const bg = [0, 1, 2].map(c => { const v = border.map(p => p[c]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; });
  const dist = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) dist[i] = Math.sqrt((small[i * 3] - bg[0]) ** 2 + (small[i * 3 + 1] - bg[1]) ** 2 + (small[i * 3 + 2] - bg[2]) ** 2) / Math.sqrt(3);
  const thr = Math.max(otsu(dist), 0.04);
  let mask = new Uint8Array(sw * sh); for (let i = 0; i < mask.length; i++) mask[i] = dist[i] > thr ? 1 : 0;
  const r = Math.max(1, Math.floor(Math.max(sw, sh) / 200));
  mask = morph(sw, sh, morph(sw, sh, mask, r, true), r, false);           // 闭：补照片里的小洞
  mask = morph(sw, sh, morph(sw, sh, mask, 1, false), 1, true);           // 开：去灰尘
  const label = new Int32Array(sw * sh).fill(-1), comps = [];
  for (let s = 0; s < sw * sh; s++){
    if (!mask[s] || label[s] !== -1) continue;
    const id = comps.length, stack = [s], px = []; label[s] = id;
    while (stack.length){
      const i = stack.pop(); px.push(i);
      const x = i % sw, y = (i / sw) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue;
        const j = yy * sw + xx; if (mask[j] && label[j] === -1){ label[j] = id; stack.push(j); }
      }
    }
    comps.push(px);
  }
  const total = sw * sh;
  const out = comps.filter(c => c.length > total * 0.01).map(c => {
    const pts = [];
    c.forEach(i => {
      const x = i % sw, y = (i / sw) | 0;
      if (x === 0 || y === 0 || x + 1 === sw || y + 1 === sh || !mask[i - 1] || !mask[i + 1] || !mask[i - sw] || !mask[i + sw])
        [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].forEach(p => pts.push([p[0] * k, p[1] * k]));
    });
    const [center, wd, ht, ang] = minRect(convexHull(pts)), inset = k;
    return {center, width:Math.max(1, wd - 2 * inset), height:Math.max(1, ht - 2 * inset), angle:ang, area:c.length / total};
  });
  const band = Math.max(1, out.reduce((m, p) => Math.min(m, Math.min(p.height, p.width)), Infinity)) / 3;
  out.sort((a, b) => Math.floor(a.center[1] / band) - Math.floor(b.center[1] / band) || a.center[0] - b.center[0]);
  return out;
}
reg('file.automate.cropAndStraightenPhotos', '{} 裁剪并拉直照片：在均匀底色的扫描图里找每张照片、量歪斜角、转正切出来；原码每张开一份新文件，我们只有一份 ⇒ 每张成一层新像素层（摆在原位置、名字「<文件名> 拷贝 n」）→ {photos:[{layer,width,height,angle,center}]}', () => {
  const flat = renderDoc({}), W = flat.width, H = flat.height, d = ctx2d(flat).getImageData(0, 0, W, H).data;
  const rgba = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H; i++){ const a = d[i * 4 + 3] / 255; for (let c = 0; c < 3; c++) rgba[i * 4 + c] = (d[i * 4 + c] / 255) * a + (1 - a); rgba[i * 4 + 3] = 1; }   // 透明当底色（白）
  const found = findPhotos(W, H, rgba);
  if (!found.length) throw new PsBad('ps.file.automate.cropAndStraightenPhotos: no photos found on a uniform background');
  const out = [];
  found.forEach((f, k) => {
    const pw = Math.max(1, Math.round(f.width)), ph = Math.max(1, Math.round(f.height));
    const L = Layer.raster(`${St.name} ${L3('拷貝', '拷贝', 'copy')} ${k + 1}`, pw, ph), x = L.data.ctx;
    x.imageSmoothingQuality = 'high';
    x.translate(pw / 2, ph / 2); x.rotate(-f.angle * Math.PI / 180); x.translate(-f.center[0], -f.center[1]);   // rect_to_quad 的反变换＝转正
    x.drawImage(flat, 0, 0); x.setTransform(1, 0, 0, 1, 0, 0);
    const im = x.getImageData(0, 0, pw, ph); for (let i = 3; i < im.data.length; i += 4) im.data[i] = 255; x.putImageData(im, 0, 0);   // 像扫描的相片：不透明
    L.x = Math.round(f.center[0] - pw / 2); L.y = Math.round(f.center[1] - ph / 2);
    Doc.add(L, Doc.layers.length);
    out.push({layer:L.id, width:pw, height:ph, angle:f.angle, center:f.center});
  });
  return {photos:out};
}, {history:true});

/* 联系表 II（automate_cmds.rs:404 contact_sheet）：原码每页开一份新文件；我们换掉目前这份成第 1 页（界面先问要不要存），第 2 页起导出成 PNG（file.exportData） */
const unitsPx = (v, unit, res) => unit === 'cm' ? v * res / 2.54 : unit === 'mm' ? v * res / 25.4 : (unit === 'px' || unit === 'pixels') ? v : v * res;
async function contactSheet(p){
  const cmd = 'file.automate.contactSheetII', items = inputsOf(p);
  if (!items.length) bad(cmd, 'missing input (urls or files)');
  const f = (k, d) => { const v = num(p, k, NaN); return isFinite(v) && v > 0 ? v : d; };
  const unit = strp(p, 'units', 'inches'), res = clamp(f('resolution', 300), 1, 10000);
  const pw = Math.round(clamp(unitsPx(f('width', 8), unit, res), 16, 30000)), ph = Math.round(clamp(unitsPx(f('height', 10), unit, res), 16, 30000));
  const cols = Math.round(clamp(f('columns', 5), 1, 100)), rows = Math.round(clamp(f('rows', 6), 1, 100));
  const auto = p.autoSpacing !== false, gap = Math.max(Math.min(pw, ph) * 0.014, 2);
  const hs = auto ? gap : (isFinite(+p.horizontal) && p.horizontal !== '' && p.horizontal !== undefined ? unitsPx(+p.horizontal, unit, res) : gap);
  const vs = auto ? gap : (isFinite(+p.vertical) && p.vertical !== '' && p.vertical !== undefined ? unitsPx(+p.vertical, unit, res) : gap);
  const across = p.placeAcrossFirst !== false, rotate = p.rotateForBestFit === true, caption = p.caption !== false;
  const fontPt = f('fontSize', 12), font = strp(p, 'font', 'sans-serif');
  const captionPx = caption ? fontPt * res / 72 * 1.5 : 0;
  const cellW = Math.max(1, (pw - (cols + 1) * hs) / cols), cellH = Math.max(1, (ph - (rows + 1) * vs) / rows), boxH = Math.max(1, cellH - captionPx);
  const perPage = cols * rows, pages = Math.ceil(items.length / perPage);
  const errors = [], exported = [];
  let placed = 0;
  const thumbs = async chunk => {
    const out = [];
    for (let k = 0; k < chunk.length; k++){
      const it = chunk[k], c0 = across ? k % cols : Math.floor(k / rows), r0 = across ? Math.floor(k / cols) : k % rows;
      const x0 = hs + c0 * (cellW + hs), y0 = vs + r0 * (cellH + vs);
      try {
        let src = imageCanvas(await loadImage(it.src));
        const fit = (w, h) => Math.min(cellW / w, boxH / h);
        if (rotate && fit(src.height, src.width) > fit(src.width, src.height) * 1.001){ const r = mkCanvas(src.height, src.width), x = ctx2d(r); x.translate(r.width, 0); x.rotate(Math.PI / 2); x.drawImage(src, 0, 0); src = r; }   // 90° 顺时针
        const k2 = fit(src.width, src.height), tw = Math.max(1, Math.round(src.width * k2)), th = Math.max(1, Math.round(src.height * k2));
        out.push({name:stem(it.name), canvas:resizeCanvas(src, tw, th), ox:Math.round(x0 + (cellW - tw) / 2), oy:Math.round(y0 + (boxH - th) / 2), cx:x0 + cellW / 2, base:y0 + boxH + captionPx * 0.72});
      } catch(e){ errors.push({file:it.name, error:String(e.message || e)}); }
    }
    return out;
  };
  for (let pg = 0; pg < pages; pg++){
    const chunk = items.slice(pg * perPage, (pg + 1) * perPage), list = await thumbs(chunk);
    const pageName = `ContactSheet-${String(pg + 1).padStart(3, '0')}`;
    if (pg === 0){
      CMD.run('file.new', {width:pw, height:ph, background:'#ffffff'});
      Doc.dpi = res; St.name = pageName;
      list.forEach(t => {
        const L = Layer.raster(t.name); L.data.ctx.drawImage(t.canvas, t.ox, t.oy); Doc.add(L);
        if (caption){ const T = Layer.text(t.name, {x:t.cx, y:t.base, text:t.name, size:fontPt * res / 72, font, color:'#000000', align:'center'}); Doc.add(T); }
      });
      if (p.flatten === true){
        const flat = Layer.raster(Lang.t('layer.bg')); flat.data.ctx.drawImage(renderDoc({}), 0, 0); flat.isBackground = true;
        Doc.layers = [flat]; Doc.activeId = flat.id;
      }
      History.clear(); markSaved();
    } else {                                                           // 第 2 页起：直接画成一张 PNG 交出去
      const c = mkCanvas(pw, ph), x = ctx2d(c); x.fillStyle = '#fff'; x.fillRect(0, 0, pw, ph);
      list.forEach(t => { x.drawImage(t.canvas, t.ox, t.oy); if (caption){ x.fillStyle = '#000'; x.font = `${fontPt * res / 72}px ${font}`; x.textAlign = 'center'; x.fillText(t.name, t.cx, t.base); } });
      await sink(pageName + '.png', await canvasBlob(c, 'image/png')); exported.push(pageName + '.png');
    }
    placed += list.length;
  }
  if (window.UI){ UI.fit(); UI.refresh(); } if (window.HandView) HandView.reset();
  return {pages, images:placed, errors, width:pw, height:ph, exported};
}
reg('file.automate.contactSheetII', '{urls|files（＋names?:[档名]，dataURL 没档名时用）（图片）, units:"inches|cm|mm|pixels"="inches", width=8, height=10, resolution:ppi=300, columns=5, rows=6, placeAcrossFirst:bool=true, autoSpacing:bool=true, horizontal?/vertical?（单位）, rotateForBestFit:bool=false, caption:bool=true（档名当标题）, font?, fontSize:pt=12, flatten:bool=false} 联系表 II：换掉目前这份成第 1 页（一张图一层＋标题文字层），多出来的页导出成 PNG → {pages, images, errors, exported}', contactSheet, {dialog:() => {
  Dlg.open({id:'file.automate.contactSheetII', cmd:'ps.file.automate.contactSheetII', fields:[
    {k:'files', type:'files', label:['來源影像', '源图像', 'Source Images'], accept:'image/*'},
    {k:'units', type:'select', label:['單位', '单位', 'Units'], value:'inches', options:[['inches', ['英吋', '英寸', 'inches']], ['cm', ['公分', '厘米', 'cm']], ['pixels', ['像素', '像素', 'pixels']]]},
    {k:'width', type:'number', label:['寬度', '宽度', 'Width'], value:8, min:0.01, step:0.01},
    {k:'height', type:'number', label:['高度', '高度', 'Height'], value:10, min:0.01, step:0.01},
    {k:'resolution', type:'number', label:['解析度 (ppi)', '分辨率 (ppi)', 'Resolution (ppi)'], value:300, min:1, max:10000, step:1},
    {k:'columns', type:'number', label:['欄數', '列数', 'Columns'], value:5, min:1, max:100, step:1},
    {k:'rows', type:'number', label:['列數', '行数', 'Rows'], value:6, min:1, max:100, step:1},
    {k:'placeAcrossFirst', type:'check', label:['先橫向置入', '先横向', 'Place Across First'], value:true},
    {k:'rotateForBestFit', type:'check', label:['旋轉以取得最佳符合', '旋转以调整到最佳位置', 'Rotate For Best Fit'], value:false},
    {k:'caption', type:'check', label:['使用檔名作為說明', '使用文件名作题注', 'Use Filename as Caption'], value:true},
    {k:'fontSize', type:'number', label:['字體大小 (pt)', '字体大小 (pt)', 'Font Size (pt)'], value:12, min:1, max:200, step:1, when:v => v.caption},
    {k:'flatten', type:'check', label:['影像平面化', '拼合所有图层', 'Flatten All Layers'], value:false}
  ], onOK:async v => { if (!v.files || !v.files.length) return {ok:false, error:L3('請先選擇影像', '请先选择图像', 'Choose images first')}; if (!await confirmDiscard('close')) return {ok:false, cancelled:true}; return CMD.run('ps.file.automate.contactSheetII', v); }});
  return opened();
}});

/* ═══════════ 脚本 ═══════════ */
/* 图像处理器（file_cmds.rs:652 image_processor）：每个输入档 → （限制尺寸、不放大）→ 存成指定格式；不碰目前的文件 */
async function imageProcessor(p){
  const cmd = 'file.scripts.imageProcessor', items = inputsOf(p);
  if (!items.length) bad(cmd, 'missing input (urls or files)');
  const format = String(p.format || 'jpg').toLowerCase().replace('jpeg', 'jpg').replace('tiff', 'tif');
  if (!['jpg', 'png', 'webp', 'tif', 'gif', 'png8'].includes(format)) bad(cmd, 'format is jpg|png|webp|tif|gif|png8');
  const W = num(p, 'width', 0), H = num(p, 'height', 0), q = num(p, 'quality', 8), out = strp(p, 'output', '');
  const files = [], errors = [];
  for (const it of items){
    try {
      let c = imageCanvas(await loadImage(it.src));
      if (W > 0 || H > 0){ const bw = W > 0 ? W : 1e9, bh = H > 0 ? H : 1e9, k = Math.min(bw / c.width, bh / c.height); if (k < 1) c = resizeCanvas(c, c.width * k, c.height * k); }   // fit_image dontEnlarge
      const e = await encodeAs(c, format, {quality:format === 'jpg' ? q12(q) : undefined});
      const name = (out ? out.replace(/[\\/]+$/, '') + '/' : '') + stem(it.name) + '.' + e.ext;
      await sink(name, e.blob); files.push(name);
    } catch(e){ errors.push({file:it.name, error:String(e.message || e)}); }
  }
  return {files, errors};
}
reg('file.scripts.imageProcessor', '{urls|files（＋names?:[档名]，dataURL 没档名时用）, format:"jpg|png|webp|tif|gif|png8"="jpg", quality:0..12=8, width?/height?（限制尺寸，不放大）, output?（档名前加「资料夹/」）, convertToSrgb?（我们本来就是 sRGB）} 图像处理器：一批图转格式／缩尺寸，每张交一个档；不动目前的文件 → {files, errors}', imageProcessor, {dialog:() => {
  Dlg.open({id:'file.scripts.imageProcessor', cmd:'ps.file.scripts.imageProcessor', fields:[
    {k:'files', type:'files', label:['要處理的影像', '要处理的图像', 'Images to Process'], accept:'image/*'},
    {k:'format', type:'select', label:['存成', '存储为', 'Save as'], value:'jpg', options:[['jpg', 'JPEG'], ['png', 'PNG'], ['webp', 'WebP'], ['tif', 'TIFF'], ['gif', 'GIF'], ['png8', 'PNG-8']]},
    {k:'quality', type:'number', label:['品質 (0–12)', '品质 (0–12)', 'Quality (0–12)'], value:8, min:0, max:12, step:1, when:v => v.format === 'jpg'},
    {k:'width', type:'number', label:['寬度 (像素，0＝不限)', '宽度 (像素，0＝不限)', 'W (px, 0 = any)'], value:0, min:0, step:1},
    {k:'height', type:'number', label:['高度 (像素，0＝不限)', '高度 (像素，0＝不限)', 'H (px, 0 = any)'], value:0, min:0, step:1},
    {k:'output', type:'text', label:['資料夾', '文件夹', 'Folder'], value:''}
  ], okLabel:['執行', '运行', 'Run'], onOK:v => { if (!v.files || !v.files.length) return {ok:false, error:L3('請先選擇影像', '请先选择图像', 'Choose images first')}; return CMD.run('ps.file.scripts.imageProcessor', v); }});
  return opened();
}});

/* 删除所有空图层（extra_cmds.rs:388 delete_where、415 is_empty_layer：没像素、没蒙版、没效果的像素层；至少留一层）
   我们的矢量层／文字层可以是空的（PS 的不会）⇒ 没形状的矢量层、空字的文字层也算空 */
function isEmptyLayer(L){
  if (L.kind === 'raster'){
    if (L.mask || L.maskOff || (L.style && Array.isArray(L.style.items) && L.style.items.length)) return false;
    const c = L.data.canvas, d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
    return true;
  }
  if (L.kind === 'vector') return !(L.data.shapes && L.data.shapes.length);
  if (L.kind === 'text') return !String(L.data.text || '').trim();
  return false;
}
reg('file.scripts.deleteAllEmptyLayers', '{} 删除所有空图层（至少留一层）→ {deleted}', () => {
  const keep = Doc.layers.filter(L => !isEmptyLayer(L)), n = Doc.layers.length - keep.length;
  if (!keep.length) throw new PsBad('ps.file.scripts.deleteAllEmptyLayers: a document must keep at least one layer');
  if (!n) return {deleted:0};
  Doc.layers = keep;
  if (!Doc.byId(Doc.activeId)) Doc.activeId = keep[keep.length - 1].id;
  return {deleted:n};
}, {history:true});

/* 拼合所有图层效果／蒙版（file_cmds.rs:720 bake、740、766） */
function bakeLayer(L, keepEffects){
  const src = renderLayer(L, 1);                                       // 像素层＝自己的画布（图层坐标）；矢量／文字＝文件大小重画
  let content = src;
  if (L.mask){ content = mkCanvas(src.width, src.height); const x = ctx2d(content); x.drawImage(src, 0, 0); x.globalCompositeOperation = 'destination-in'; x.drawImage(renderLayer(L.mask, 1), 0, 0, src.width, src.height); }
  const ox = L.kind === 'raster' ? L.x : 0, oy = L.kind === 'raster' ? L.y : 0;
  // 渲染范围＝画布 ∪ 内容（画布外的像素不丢）；有效果时再外扩 256
  let ax0 = Math.min(0, ox), ay0 = Math.min(0, oy), ax1 = Math.max(Doc.width, ox + src.width), ay1 = Math.max(Doc.height, oy + src.height);
  if (keepEffects){ ax0 -= 256; ay0 -= 256; ax1 += 256; ay1 += 256; }
  const out = mkCanvas(ax1 - ax0, ay1 - ay0), x = ctx2d(out);
  if (keepEffects && window.PsLayerStyle && PsLayerStyle.has(L)){
    const F = {id:L.id, kind:'raster', x:ox - ax0, y:oy - ay0, style:L.style, opacity:1, blend:'normal', fillOpacity:L.fillOpacity, visible:true, data:{canvas:content}};
    PsLayerStyle.draw(x, F, content, 1);
  } else x.drawImage(content, ox - ax0, oy - ay0);
  const b = alphaBox(out);
  // 修到「内容 ∪ 文件范围」
  const bx0 = Math.min(b ? b.x : Infinity, -ax0), by0 = Math.min(b ? b.y : Infinity, -ay0), bx1 = Math.max(b ? b.x + b.w : -Infinity, -ax0 + Doc.width), by1 = Math.max(b ? b.y + b.h : -Infinity, -ay0 + Doc.height);
  return {canvas:cropCanvas(out, bx0, by0, bx1 - bx0, by1 - by0), x:ax0 + bx0, y:ay0 + by0};
}
function toRaster(L, baked){
  L.kind = 'raster'; L.data = {canvas:baked.canvas, ctx:ctx2d(baked.canvas)}; L.x = baked.x; L.y = baked.y;
  if (window.VecSel && VecSel.clear) try { VecSel.clear(); } catch(e){}
  Layer.invalidate(L);
}
reg('file.scripts.flattenAllLayerEffects', '{} 拼合所有图层效果：有效果的层连效果烤成像素（蒙版一起烤进去、去掉效果与填充不透明度；不透明度与混合模式留着）→ {flattened}', () => {
  let n = 0;
  Doc.layers.forEach(L => {
    if (!(window.PsLayerStyle && PsLayerStyle.has(L))) return;
    const b = bakeLayer(L, true);
    toRaster(L, b); delete L.style; L.mask = null; delete L.maskOff; delete L.fillOpacity;
    n++;
  });
  return {flattened:n};
}, {history:true});
reg('file.scripts.flattenAllMasks', '{} 拼合所有蒙版：像素层的（启用中）蒙版乘进像素后删掉；别种层的蒙版留着（同 PS 的脚本）→ {flattened, skipped}', () => {
  let n = 0, skipped = 0;
  Doc.layers.forEach(L => {
    if (!L.mask) return;
    if (L.kind !== 'raster'){ skipped++; return; }
    const c = L.data.canvas, x = L.data.ctx;
    x.save(); x.globalCompositeOperation = 'destination-in'; x.drawImage(renderLayer(L.mask, 1), 0, 0, c.width, c.height); x.restore();
    L.mask = null; Layer.invalidate(L); n++;
  });
  return {flattened:n, skipped};
}, {history:true});

/* 脚本：把步骤叫成命令（automate_cmds.rs:47 parse_script：JSON 步骤，或一行一个「命令 {json}」，# 注释） */
function parseScript(text){
  const t = String(text).replace(/^﻿/, '').trim();
  if (t[0] === '[' || t[0] === '{'){
    let v; try { v = JSON.parse(t); } catch(e){ throw new PsBad('ps.file.scripts.browse: script JSON: ' + e.message); }
    const steps = Array.isArray(v) ? v : (v.steps || (v.action && (v.action.steps || v.action)));
    if (!steps) throw new PsBad('ps.file.scripts.browse: script object needs "steps"');
    return parseSteps(steps);
  }
  const out = [];
  t.split(/\r?\n/).forEach((line, n) => {
    line = line.trim(); if (!line || line[0] === '#' || line.startsWith('//')) return;
    const sp = line.search(/\s/), id = sp < 0 ? line : line.slice(0, sp), rest = sp < 0 ? '' : line.slice(sp).trim();
    let params = {}; if (rest){ try { params = JSON.parse(rest); } catch(e){ throw new PsBad(`ps.file.scripts.browse: line ${n + 1}: ${e.message}`); } }
    out.push([id, params]);
  });
  return out;
}
function parseSteps(v){
  if (!Array.isArray(v)) throw new PsBad('ps.file.scripts.browse: steps must be an array');
  return v.map(st => {
    if (Array.isArray(st) && st.length){ if (typeof st[0] !== 'string') throw new PsBad('step id must be a string'); return [st[0], st[1] || {}]; }
    if (st && typeof st === 'object'){ const id = st.command || st.id; if (typeof id !== 'string') throw new PsBad('step needs "command"'); return [id, st.params || {}]; }
    if (typeof st === 'string') return [st, {}];
    throw new PsBad('each step is [id, params], {"command", "params"} or an id');
  });
}
/* 原码 id 我们登记成 ps.<id> ⇒ 找不到就试 ps. 前缀（脚本可以写原码的命令名） */
const resolveCmd = id => CMD.map[id] ? id : CMD.map['ps.' + id] ? 'ps.' + id : null;
function checkKnown(steps){ const u = steps.find(([id]) => !resolveCmd(id)); if (u) throw new PsBad(`ps.file.scripts.browse: unknown command \`${u[0]}\` in the script`); }
async function runSteps(steps){
  const results = [];
  for (const [id, params] of steps){
    try { const r = await CMD.run(resolveCmd(id), params); if (r && r.ok === false){ results.push({command:id, error:r.error || 'failed'}); break; } results.push({command:id, result:r}); }
    catch(e){ results.push({command:id, error:String(e.message || e)}); break; }
  }
  return results;
}
async function browse(p){
  let steps;
  if (typeof p.script === 'string') steps = parseScript(p.script);
  else if (p.steps) steps = parseSteps(p.steps);
  else { const it = inputsOf(p)[0]; if (!it) throw new PsBad('ps.file.scripts.browse: give "script" (text), "steps" or url/files (a script file)'); steps = parseScript(await readText(it.src)); }
  checkKnown(steps);
  const results = await runSteps(steps);
  return {steps:steps.length, ok:results.every(r => !r.error), results};
}
reg('file.scripts.browse', '{script:文字（JSON 步骤或一行一个「命令 {json}」）| steps:[[id,params]…] | url/files（脚本档）} 浏览：跑一个脚本（原码命令名会自动对到 ps.<id>）→ {steps, ok, results}', browse, {dialog:async () => {
  const fs = await pickFiles('.json,.txt,.jsx,.js,.pcscript,text/plain,application/json', false); if (!fs.length) return {ok:false, cancelled:true};
  return browse({files:fs});
}});

/* 脚本事件管理器（automate_cmds.rs:139-252 EVENTS、script_events、fire_event）：设定存浏览器 localStorage */
const EVENTS = [['startApplication', ['啟動應用程式', '启动应用程序', 'Start Application']], ['newDocument', ['新增文件', '新建文档', 'New Document']], ['openDocument', ['開啟文件', '打开文档', 'Open Document']], ['saveDocument', ['儲存文件', '存储文档', 'Save Document']], ['closeDocument', ['關閉文件', '关闭文档', 'Close Document']], ['print', ['列印文件', '打印文档', 'Print Document']], ['export', ['轉存文件', '导出文档', 'Export Document']], ['everything', ['所有事件', '所有内容', 'Everything']]];
const EV_KEY = 'dl.ps.scriptEvents';
function evPrefs(){ try { const v = JSON.parse(localStorage.getItem(EV_KEY) || 'null'); if (v && Array.isArray(v.bindings)) return v; } catch(e){} return {enabled:false, bindings:[]}; }
function fireEvent(event){
  if (St.firing) return 0;
  const ev = evPrefs(); if (!ev.enabled) return 0;
  const jobs = ev.bindings.filter(b => b.event === event || b.event === 'everything'); if (!jobs.length) return 0;
  St.firing = true;
  const all = jobs.map(async b => {
    let entry;
    try { const steps = b.steps ? parseSteps(b.steps) : parseScript(b.script || ''); entry = {event, binding:b.name, results:await runSteps(steps)}; }
    catch(e){ entry = {event, binding:b.name, error:String(e.message || e)}; }
    St.eventLog.push(entry); if (St.eventLog.length > 32) St.eventLog.splice(0, St.eventLog.length - 32);
  });
  Promise.all(all).finally(() => { St.firing = false; });
  return jobs.length;
}
reg('file.scripts.scriptEventsManager', '{enabled?:bool, add?:{event:"startApplication|newDocument|openDocument|saveDocument|closeDocument|print|export|everything", script?:文字（同「浏览」的脚本）| steps?:[…], name?, enable:bool=true}, event?+script?（对话框的平铺写法＝新增）, remove?:index, removeAll?:bool} 脚本事件管理器 → {enabled, bindings, events}', p => {
  const cmd = 'file.scripts.scriptEventsManager', ev = evPrefs();
  if (typeof p.enabled === 'boolean') ev.enabled = p.enabled;
  if (p.removeAll === true) ev.bindings = [];
  if (p.remove !== undefined){ const i = Math.round(+p.remove); if (!(i >= 0 && i < ev.bindings.length)) bad(cmd, `no binding ${p.remove}`); ev.bindings.splice(i, 1); }
  const flat = typeof p.event === 'string' && typeof p.script === 'string' && p.script.trim() ? {event:p.event, script:p.script, name:p.name} : null;
  const a = p.add || flat;
  if (a){
    if (!EVENTS.some(e => e[0] === a.event)) bad(cmd, `unknown event \`${a.event}\` (${EVENTS.map(e => e[0]).join('|')})`);
    if (a.script === undefined && a.steps === undefined) bad(cmd, 'add needs "script" (text) or "steps" (an action)');
    const steps = a.steps !== undefined ? parseSteps(a.steps) : parseScript(a.script); checkKnown(steps);
    ev.bindings.push({event:a.event, script:a.script !== undefined ? String(a.script) : undefined, steps:a.steps, name:a.name || (a.script !== undefined ? L3('指令碼', '脚本', 'Script') : L3('動作', '动作', 'Action'))});
    if (a.enable !== false) ev.enabled = true;
  }
  try { localStorage.setItem(EV_KEY, JSON.stringify(ev)); } catch(e){}
  return {enabled:ev.enabled, bindings:ev.bindings, events:EVENTS.map(e => ({id:e[0], label:e[1][2]}))};
}, {dialog:() => {
  const ev = evPrefs();
  Dlg.open({id:'file.scripts.scriptEventsManager', cmd:'ps.file.scripts.scriptEventsManager', fields:[
    {k:'enabled', type:'check', label:['啟動事件以執行指令碼/動作', '启用事件以运行脚本/动作', 'Enable Events to Run Scripts/Actions'], value:ev.enabled},
    {k:'event', type:'select', label:['Photoshop 事件', 'Photoshop 事件', 'Photoshop Event'], value:'openDocument', options:EVENTS},
    {k:'name', type:'text', label:['名稱', '名称', 'Name'], value:''},
    {k:'script', type:'textarea', label:['指令碼（一行一個命令 {json}）', '脚本（一行一个命令 {json}）', 'Script (one command {json} per line)'], value:''}
  ], okLabel:['加入／完成', '添加／完成', 'Add / Done'], onOK:v => CMD.run('ps.file.scripts.scriptEventsManager', v),
  render:box => {
    const cur = evPrefs(); box.innerHTML = '';
    const list = document.createElement('div'); list.className = 'psf-list'; list.dataset.k = 'bindings';
    if (!cur.bindings.length) list.textContent = L3('（尚未設定）', '（尚未设置）', '(none)');
    cur.bindings.forEach((b, i) => {
      const row = document.createElement('div'); const ev0 = EVENTS.find(e => e[0] === b.event);
      row.textContent = `${ev0 ? T3(ev0[1]) : b.event} → ${b.name}`;
      const x = document.createElement('button'); x.type = 'button'; x.textContent = L3('移除', '移去', 'Remove'); x.dataset.remove = String(i);
      x.onclick = () => { CMD.run('ps.file.scripts.scriptEventsManager', {remove:i}); Dlg.changed(); };
      row.appendChild(x); list.appendChild(row);
    });
    box.appendChild(list);
  }});
  return opened();
}});

/* 载入堆栈（file_cmds.rs:674 load_files_into_stack）：一份新文件（取最大宽高），一个档一层，第一个在最底；我们没有智能对象 ⇒ 不包成智能对象 */
async function loadStack(p, cmd){
  const items = inputsOf(p); if (!items.length) bad(cmd, 'no files to load');
  const imgs = [];
  for (const it of items) imgs.push([fileName(it.name) || it.name, imageCanvas(await loadImage(it.src))]);
  const W = Math.max(...imgs.map(i => i[1].width)), H = Math.max(...imgs.map(i => i[1].height));
  Doc.reset(W, H, null, false);
  imgs.forEach(([n, c]) => { const L = Layer.raster(n, W, H); L.data.ctx.drawImage(c, 0, 0); Doc.layers.push(L); Doc.activeId = L.id; });
  History.clear(); St.name = stem(items[0].name); markSaved();
  if (window.UI){ UI.fit(); UI.refresh(); } if (window.HandView) HandView.reset();
  return {layers:imgs.length, width:W, height:H};
}
const filesDialog = (id, extra, title) => () => {
  Dlg.open({id, cmd:'ps.' + id, fields:[{k:'files', type:'files', label:['來源檔案', '源文件', 'Source Files'], accept:'image/*'}].concat(extra || []),
    onOK:async v => { if (!v.files || !v.files.length) return {ok:false, error:L3('請先選擇檔案', '请先选择文件', 'Choose files first')}; if (!await confirmDiscard('close')) return {ok:false, cancelled:true}; return CMD.run('ps.' + id, v); }});
  return opened();
};
reg('file.scripts.loadFilesIntoStack', '{urls|files（＋names?:[档名]，dataURL 没档名时用）} 将文件载入堆栈：换掉目前这份成新文件（取最大宽高），一个档一层、第一个在最底（不包智能对象）→ {layers, width, height}', p => loadStack(p, 'file.scripts.loadFilesIntoStack'), {dialog:filesDialog('file.scripts.loadFilesIntoStack')});
/* 统计（automate_cmds.rs:358 statistics；algo/src/stack.rs stat／combine）：载入堆栈后按堆栈模式逐像素算成一层 */
const STACK_MODES = ['entropy', 'kurtosis', 'maximum', 'mean', 'median', 'minimum', 'range', 'skewness', 'standardDeviation', 'summation', 'variance'];
function stat(v, s){
  const n = v.length; if (!n) return 0;
  let mean = 0; for (const x of v) mean += x; mean /= n;
  const m = k => { let t = 0; for (const x of v) t += Math.pow(x - mean, k); return t / n; };
  switch (s){
    case 'mean': return mean;
    case 'summation': return v.reduce((a, b) => a + b, 0);
    case 'minimum': return Math.min(...v);
    case 'maximum': return Math.max(...v);
    case 'range': return Math.max(...v) - Math.min(...v);
    case 'median': { v.sort((a, b) => a - b); return n % 2 ? v[n >> 1] : (v[n / 2 - 1] + v[n / 2]) / 2; }
    case 'variance': return m(2);
    case 'standardDeviation': return Math.sqrt(m(2));
    case 'skewness': { const sd = Math.sqrt(m(2)); return sd < 1e-6 ? 0.5 : clamp(m(3) / Math.pow(sd, 3) / 4 + 0.5, 0, 1); }
    case 'kurtosis': { const va = m(2); return va < 1e-12 ? 0 : clamp(m(4) / (va * va) / 10, 0, 1); }
    case 'entropy': {
      if (n < 2) return 0;
      const cnt = new Map(); for (const x of v){ const k = Math.round(clamp(x, 0, 1) * 255); cnt.set(k, (cnt.get(k) || 0) + 1); }
      let h = 0; cnt.forEach(c => { const q = c / n; h -= q * Math.log2(q); }); return h / Math.log2(n);
    }
  }
  return 0;
}
async function statistics(p){
  const cmd = 'file.scripts.statistics', mode = strp(p, 'mode', strp(p, 'stackMode', 'median'));
  const sm = STACK_MODES.find(m => m.toLowerCase() === String(mode).toLowerCase()); if (!sm) bad(cmd, `unknown stack mode \`${mode}\``);
  const r = await loadStack(p, cmd);
  const W = Doc.width, H = Doc.height, frames = Doc.layers.filter(L => L.visible).map(L => L.data.ctx.getImageData(0, 0, W, H).data);
  const out = new ImageData(W, H), o = out.data, s = [[], [], []];
  for (let i = 0; i < W * H; i++){
    s[0].length = s[1].length = s[2].length = 0; let alpha = 0;
    for (const f of frames){ const a = f[i * 4 + 3]; if (a > 0){ for (let c = 0; c < 3; c++) s[c].push(f[i * 4 + c] / 255); alpha = Math.max(alpha, a); } }
    if (alpha <= 0) continue;
    for (let c = 0; c < 3; c++) o[i * 4 + c] = Math.round(clamp(stat(s[c], sm), 0, 1) * 255);
    o[i * 4 + 3] = alpha;
  }
  const L = Layer.raster(St.name, W, H); L.data.ctx.putImageData(out, 0, 0);
  Doc.layers = [L]; Doc.activeId = L.id; History.clear(); markSaved();
  refresh();
  return {images:r.layers, mode:sm, layer:L.id};
}
reg('file.scripts.statistics', '{mode:"mean|median|maximum|minimum|range|summation|variance|standardDeviation|skewness|kurtosis|entropy"="median", urls|files} 统计：载入堆栈后逐像素按堆栈模式算成一层（没有智能对象 ⇒ 直接是像素结果）→ {images, mode, layer}', statistics,
  {dialog:filesDialog('file.scripts.statistics', [{k:'mode', type:'select', label:['選擇堆疊模式', '选择堆栈模式', 'Choose Stack Mode'], value:'median', options:STACK_MODES.map(m => [m, m])}])});

/* 视频帧到图层（video_cmds.rs:160 load_frames：一个档或一串图片序列，每帧一层「Frame n」插在当前层上面）；我们另外认视频档（照 fps 取帧） */
async function videoFrames(it, fps, maxFrames){
  const url = srcURL(it.src), v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = url;
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video load failed: ' + it.name)); });
  const out = [], dur = isFinite(v.duration) ? v.duration : 0, n = Math.max(1, Math.min(maxFrames, Math.floor(dur * fps) + 1));
  for (let i = 0; i < n; i++){
    const t = Math.min(dur, i / fps);
    await new Promise(res => { v.onseeked = res; v.currentTime = t; if (i === 0 && t === 0 && v.readyState >= 2) setTimeout(res, 0); });
    const c = mkCanvas(v.videoWidth, v.videoHeight); ctx2d(c).drawImage(v, 0, 0); out.push(c);
  }
  if (it.src instanceof Blob) URL.revokeObjectURL(url);
  return out;
}
async function framesToLayers(p){
  const items = inputsOf(p); if (!items.length) bad('file.import.videoFramesToLayers', 'need url (or files)');
  const frames = [];
  for (const it of items){
    if (isVideo(it)) frames.push(...await videoFrames(it, clamp(num(p, 'fps', 10), 0.1, 60), clamp(Math.round(num(p, 'maxFrames', 100)), 1, 1000)));
    else frames.push(imageCanvas(await loadImage(it.src)));
  }
  History.push();
  let at = Doc.activeId ? Doc.index(Doc.activeId) + 1 : Doc.layers.length;
  frames.forEach((c, i) => { const L = Layer.raster(`Frame ${i + 1}`, c.width, c.height); L.data.ctx.drawImage(c, 0, 0); Doc.add(L, at++); });
  refresh();
  return {layers:frames.length};
}
reg('file.import.videoFramesToLayers', '{urls|files（＋names?:[档名]，dataURL 没档名时用）（图片序列；或视频档）, fps=10（视频取帧率）, maxFrames=100} 视频帧到图层：每帧一层「Frame n」插在当前层上面（一步历史）→ {layers}', framesToLayers, {dialog:() => {
  Dlg.open({id:'file.import.videoFramesToLayers', cmd:'ps.file.import.videoFramesToLayers', fields:[
    {k:'files', type:'files', label:['視訊或影像序列', '视频或图像序列', 'Video or Image Sequence'], accept:'image/*,video/*'},
    {k:'fps', type:'number', label:['每秒取幾格（視訊）', '每秒取几帧（视频）', 'Frames per Second (video)'], value:10, min:0.1, max:60, step:0.1},
    {k:'maxFrames', type:'number', label:['最多幾格', '最多几帧', 'Limit Frames'], value:100, min:1, max:1000, step:1}
  ], onOK:v => { if (!v.files || !v.files.length) return {ok:false, error:L3('請先選擇檔案', '请先选择文件', 'Choose files first')}; return CMD.run('ps.file.import.videoFramesToLayers', v); }});
  return opened();
}});

/* 导入 ▸ 变量数据组（variables_cmds.rs:259 import_data_sets、288 split_csv）：CSV 表头＝变量名、每列一组；第一栏表头空白或 DataSet ⇒ 那栏是组名
   变量定义与数据组本身是图像 ▸ 变量（ps.image.variables.*）管的；这里只解 CSV 再交给它 */
function splitCSV(line, delim){
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++){
    const c = line[i];
    if (inQ){ if (c === '"'){ if (line[i + 1] === '"'){ cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true; else if (c === delim){ out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
async function importDataSets(p){
  const cmd = 'file.import.variableDataSets';
  if (!CMD.map['ps.variables.list'] || !CMD.map['ps.image.variables.dataSets']) bad(cmd, 'needs Image ▸ Variables (menus/impl/ps-image.js)');
  let text = typeof p.csv === 'string' ? p.csv : null;
  if (text === null){ const it = inputsOf(p)[0]; if (!it) bad(cmd, 'need `csv` (text) or url/files'); text = await readText(it.src); }
  const delim = (strp(p, 'delimiter', ',') || ',')[0];
  const defs = CMD.run('ps.variables.list').defs || [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const header = lines.length ? splitCSV(lines[0], delim) : [];
  if (!header.length || (header.length === 1 && !header[0].trim())) bad(cmd, 'empty CSV');
  const named = !header[0].trim() || header[0].trim().toLowerCase() === 'dataset';
  const sets = lines.slice(1).map((line, row) => {
    const cells = splitCSV(line, delim), name = named && cells[0] && cells[0].trim() ? cells[0] : `Data Set ${row + 1}`, values = [];
    header.forEach((v, ci) => {
      if (named && ci === 0) return;
      const cell = cells[ci]; if (cell === undefined) return;
      const def = defs.find(d => d.name === v); if (!def) return;
      if (def.type === 'visibility') values.push({variable:v, kind:'visibility', value:['true', '1', 'yes', 'visible', 'on'].includes(cell.trim().toLowerCase())});
      else if (def.type === 'pixelReplacement') values.push({variable:v, kind:'pixels', value:cell});
      else values.push({variable:v, kind:'text', value:cell});
    });
    return {name, values};
  });
  const r = CMD.run('ps.image.variables.dataSets', {dataSets:sets});
  if (r && r.ok === false) return r;
  return {imported:sets.length, dataSets:sets.map(s => s.name)};
}
reg('file.import.variableDataSets', '{csv:文字 | url/files（.csv/.txt）, delimiter=","} 导入变量数据组：表头＝变量名（第一栏空白或 DataSet＝组名），每列一组；可见性认 true/1/yes/visible/on，像素替换的格是图片网址（整批换掉现有数据组）→ {imported, dataSets}', importDataSets, {dialog:async () => {
  const fs = await pickFiles('.csv,.txt,text/csv,text/plain', false); if (!fs.length) return {ok:false, cancelled:true};
  return importDataSets({files:fs});
}});
/* 导出 ▸ 数据组作为文件（variables_cmds.rs:320 export_as_files）：每组套上去、整份拼合导出，做完回到原样（不留历史） */
async function dataSetsAsFiles(p){
  const cmd = 'file.export.dataSetsAsFiles';
  if (!CMD.map['ps.variables.list'] || !CMD.map['ps.image.applyDataSet']) bad(cmd, 'needs Image ▸ Variables (menus/impl/ps-image.js)');
  const all = CMD.run('ps.variables.list').dataSets || [], want = Array.isArray(p.dataSets) ? p.dataSets : null;
  const sets = all.filter(s => !want || want.includes(s.name));
  if (!sets.length) bad(cmd, 'no data sets to export');
  const format = String(p.format || 'png').toLowerCase().replace('jpeg', 'jpg').replace('tiff', 'tif'), template = strp(p, 'naming', '{name}');
  const snap = History.snap(), past = History.past.length, future = History.future.slice(), vars0 = Doc.variables ? JSON.parse(JSON.stringify(Doc.variables)) : Doc.variables;
  const files = [];
  try {
    for (let n = 0; n < sets.length; n++){
      const r = await CMD.run('ps.image.applyDataSet', {name:sets[n].name});
      if (r && r.ok === false) throw new PsBad(`${cmd}: ${r.error}`);
      const safe = Array.from(sets[n].name).map(c => /[\p{L}\p{N}\-_]/u.test(c) ? c : '_').join('');
      const st = template.replace('{name}', safe).replace('{index}', String(n + 1).padStart(3, '0')).replace('{document}', St.name);
      const name = (p.dir ? String(p.dir).replace(/[\\/]+$/, '') + '/' : '') + st;
      if (format === 'png') await CMD.run('file.exportPNG', {scale:1, name});
      else { const e = await encodeAs(renderDoc({}), format, {quality:format === 'jpg' ? q12(num(p, 'quality', 10)) : undefined}); await sink(name + '.' + e.ext, e.blob); }
      files.push(name + '.' + (format === 'jpeg' ? 'jpg' : format));
      History.restoreInPlace(snap); History.past.length = past;           // 每组做完回到原样
    }
  } finally { History.restoreInPlace(snap); History.past.length = past; History.future = future; Doc.variables = vars0; refresh(); }
  return {files, count:files.length};
}
reg('file.export.dataSetsAsFiles', '{format:"png|jpg|webp|tif|gif|png8|pdf"="png", dataSets?:[组名], naming:"{name}|{index}|{document}"="{name}", dir?, quality:0..12?} 数据组作为文件：每组套上去拼合导出一档，做完文件回到原样 → {files, count}', dataSetsAsFiles, {dialog:() => {
  const list = CMD.map['ps.variables.list'] ? (CMD.run('ps.variables.list').dataSets || []) : [];
  if (!list.length) return {ok:false, error:L3('沒有資料組（影像 ▸ 變數 ▸ 資料組）', '没有数据组（图像 ▸ 变量 ▸ 数据组）', 'No data sets (Image ▸ Variables ▸ Data Sets)')};
  Dlg.open({id:'file.export.dataSetsAsFiles', cmd:'ps.file.export.dataSetsAsFiles', fields:[
    {k:'naming', type:'text', label:['檔案命名（{name} {index} {document}）', '文件命名（{name} {index} {document}）', 'File Naming ({name} {index} {document})'], value:'{name}'},
    {k:'format', type:'select', label:['檔案類型', '文件类型', 'File Type'], value:'png', options:[['png', 'PNG'], ['jpg', 'JPEG'], ['webp', 'WebP'], ['tif', 'TIFF'], ['gif', 'GIF'], ['pdf', 'PDF']]}
  ], okLabel:['執行', '运行', 'Run'], onOK:v => CMD.run('ps.file.export.dataSetsAsFiles', v)});
  return opened();
}});

/* ═══════════ 快捷键（照菜单树上本菜单的 key；只接我们这支档登记的 ps.file.* 项；只在 PS 菜单〔像素／文字层〕时生效）
   浏览器保留、网页拦不到的：Ctrl+W、Ctrl+N、Ctrl+T（关闭的 Ctrl+W 只能点菜单）。F12 多半被开发者工具吃掉。 ═══════════ */
const comboOf = e => { const p = []; if (e.ctrlKey || e.metaKey) p.push('Ctrl'); if (e.altKey) p.push('Alt'); if (e.shiftKey) p.push('Shift');
  const k = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key; p.push(k); return p.join('+'); };
const normCombo = s => { const parts = String(s).split('+'), key = parts.pop(); return ['Ctrl', 'Alt', 'Shift'].filter(m => parts.includes(m)).concat(key.toUpperCase()).join('+'); };
window.addEventListener('keydown', e => {
  if (Dlg.cur || e.defaultPrevented) return;
  if (!(e.ctrlKey || e.metaKey) && !/^F\d+$/.test(e.key)) return;
  const tg = e.target; if (tg && (tg.isContentEditable || /^(input|select|textarea)$/i.test(tg.tagName))) return;
  if (document.getElementById('psImgDlg') || document.querySelector('.psl-bg')) return;   // 别的对话框开着
  if (!window.Menubar || Menubar.app !== 'ps' || !window.MenuTrees || !MenuTrees.ps.file) return;
  const want = normCombo(comboOf(e));
  let hit = null;
  MenuTrees.walk('ps', (it, path) => { if (!hit && path[0] === 'file' && it.key && it.impl && typeof it.impl === 'object' && /^ps\.file\./.test(it.impl.cmd) && normCombo(it.key) === want) hit = it; });
  if (!hit || !Menubar.enabled(hit)) return;
  e.preventDefault(); e.stopPropagation();
  Menubar.run(hit);
}, true);

/* ═══════════ 给测试与 agent ═══════════ */
const PsFile = window.PsFile = {
  version:'1',
  state:() => ({name:St.name, ext:St.ext, dirty:isDirty(), saved:!!St.savedSnap, assets:St.assets, lastPrint:St.lastPrint, eventLog:St.eventLog.slice()}),
  isDirty, markSaved, confirmDiscard, renderDoc, encodeAs, optimize, webSettings, buildPalette, findPhotos, parseAssetName, parseDefaults, parseScript, printLayout, pathsToAI, generateAssets, stat,
  encode:{tiff:encodeTIFF, pdf:rasterPDF, gif:encodeGIF, png8:encodePNG8, wbmp:encodeWBMP, jpeg:(c, o) => jpegBytes(c, jpegOptsOf(o || {}))},
  ai:{encodeDoc:aiEncodeDoc},                                        // Illustrator 分层档（PDF 外观＋Illustrator 原生资料；{native:'cs'|'none'}）
  vec:{decode:vecDecode, open:openVectorAsDoc, layersOf:vecLayers, isVec},
  ras:{decode:rasDecode, open:openRasterAsDoc, layersOf:rasLayers, isRas}, ora:{encodeDoc:oraEncodeDoc},
  psd:{encodeDoc:psdEncodeDoc, itemsOf:psdItemsOf, decode:psdDecode, canvas:psdCanvas, isPsd, bytesOf, open:openPsdAsDoc, layersOf:psdLayers}, pickFiles:(accept, multiple) => pickFiles(accept, multiple),
  fsaOK:() => fsaOK(), setFileHandle:h => { St.fileHandle = h ? {h, serial:Doc.serial} : null; }, hasFileHandle:() => handleOK(),
  canPlaceDrop, placeDrop,
  bakeLayer, toRaster,                                               // 图层 ▸ 栅格化 ▸ 图层样式（ps-layer.js）共用同一支烤法
  closeWindow:() => { window.close(); return true; },               // 测试可换掉
  _pickHook:null, _printHook:null,
  dlg:{
    isOpen:() => !!Dlg.cur, id:() => Dlg.cur ? Dlg.cur.o.id : null,
    vals:() => Dlg.cur ? Object.assign({}, Dlg.cur.vals) : null,
    set:(k, v) => Dlg.set(k, v), click:act => Dlg.click(act), ok:() => Dlg.click('ok'), cancel:() => Dlg.click('cancel')
  }
};PsFile._st = St;                                                   // 多文件（menus/impl/docs.js）切换分页时换掉文件名／存档基准

/* PSD 进画板：文件▸打开（#fileInput）挑到 .psd ⇒ 照分层开成文件（先问要不要存）；拖进画布 ⇒ 置入成智能对象（PS 拖档进文件＝置入）。
   ui.js 在本档之后才载（setTimeout 0 可能在 ui.js 之前就跑）⇒ 等 load 再包 UI.importLocalFile（只接 .psd，其余原样交回） */
const wrapPsdImport = () => {
  const fi = document.getElementById('fileInput'); if (fi && !/\.psd/.test(fi.accept || '')) fi.accept = (fi.accept ? fi.accept + ',' : '') + '.psd,.psb,.ai,.pdf,.svg,.svgz,.kra,.ora,.xcf,.procreate';
  if (!window.UI || !UI.importLocalFile || UI.importLocalFile.__psd) return;
  const orig = UI.importLocalFile;
  const wrapped = async function(f, kind){
    const nm_ = (f && f.name) || '', vec = /\.(ai|pdf|svgz?)$/i.test(nm_), ras = /\.(kra|ora|xcf|procreate)$/i.test(nm_);
    if (!(f && (/\.ps[db]$/i.test(nm_) || vec || ras))) return orig.apply(this, arguments);
    if (vec && kind && kind !== 'image' && /\.svgz?$/i.test(nm_)) return orig.apply(this, arguments);   // SVG 拖进画布：照旧置入
    const ans = await SiteHooks.askLocal(f, kind || 'image'); if (ans.handled) return {handled:true, error:ans.error};
    try {
      if (kind === 'image'){
        if (window.Docs && CMD.map['ps.document.open']) return await CMD.run('ps.document.open', {files:[f]});   // 多文件：照 PS 开成新分页
        if (!await confirmDiscard('close')) return {ok:false, cancelled:true}; return vec ? await openVectorAsDoc(f, f.name) : ras ? await openRasterAsDoc(f, f.name) : await openPsdAsDoc(f, f.name);
      }
      if (vec || ras){   // .ai／PDF、Krita／GIMP／Procreate 拖进画布：开成一份新文件（分层）
        if (window.Docs && CMD.map['ps.document.open']) return await CMD.run('ps.document.open', {files:[f]});
        if (!await confirmDiscard('close')) return {ok:false, cancelled:true}; return ras ? await openRasterAsDoc(f, f.name) : await openVectorAsDoc(f, f.name);
      }
      return await CMD.run('ps.file.placeEmbedded', {files:[f]});
    } catch (e){ toast(String(e && e.message || e), true); return {ok:false, error:String(e && e.message || e)}; }
  };
  wrapped.__psd = true; UI.importLocalFile = wrapped;
};
if (document.readyState === 'complete') setTimeout(wrapPsdImport, 0); else window.addEventListener('load', wrapPsdImport);
/* 开新档垫片装上之前就已经有文件了（测试后挂）：补一个名字 */
if (!St.name){ St.name = untitledName(++St.untitled); }
setTimeout(() => fireEvent('startApplication'), 0);
})();
