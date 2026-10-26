/* 堤麟画板 · 生成式 AI：生成式填充／生成式扩展／生成式移除、文字转向量、AI 去背／选择主体（AI）
   一、生成式那三样＋文字转向量要用网站的生图服务（会扣点数）——画板本体不打网络，全经宿主挂的 window.__dlGenAI：
       {version:1, signedIn, caps(q), quote(q), run(ticket, o), segment}
         caps({prompt, refImages})       ⇒ {ok, model, modelLabel, ratios:['16:9'…], sizes:['1024x1536'…], refLimit}（只问不扣）
         quote({prompt, images:[Blob], spec:{ratio|size}}) ⇒ {ok, ticket, credits（一张的点数）, billingMode:'precharge'|'postcharge', model, modelLabel}
                                         （图先传上去、再照真下单同一份内容问价；⛔ 扣点）
         run(ticket, {count, onProgress}) ⇒ {ok, results:[{ok:true, blob, fileId} | {ok:false, error, refunded}]}（这一步才扣点：每张一笔）
       登入版网站才挂得上；免登入版／单机版 signedIn:false（或没挂）⇒ 一律出「需登入堤麟」的说明、不送任何东西。
       扣点前一定先确认：人按的＝对话框先「估算点数」再按「确认生成（扣 N 点）」；agent 叫的＝不带 confirm:true 只回报价不下单（可再给 maxCredits 上限）。
       遮罩：模型不收遮罩参数 ⇒ 送两张参考图（第 1 张＝选区附近那块画面、第 2 张＝同尺寸黑白遮罩·白＝要改的地方），
             结果回来后只取遮罩里那块（边缘羽化）放成新图层——选区外的像素一格不动。
       候选：一次可要 1～4 张（每张各扣一次）；新图层记着全部候选，genai.variant 切换、genai.more 再多要几张。候选只在这次开着时记得（重开档只剩当下那张；每张图在云端硬碟里都有一份）。
       画面比例：先问 caps 拿模型认得的比例／尺寸，挑最接近选区那块的、再把取样框撑成刚好那个比例（结果才能一格对齐贴回去）。
   二、AI 去背／选择主体（AI）：在浏览器本地跑去背模型（onnxruntime-web·先显卡 WebGPU、没有退回 wasm·在 Worker 里），
       模型档不进包：宿主给 segment:{ort, model, bytes, name}（网址），第一次用时下载并存进浏览器快取（dilin-paint-seg），之后不再下载；
       宿主没给、下载失败、跑不起来 ⇒ 退回原本的传统演算法（ps.select.subject：显著性＋GrabCut），回传里照实标 engine:'classic' 与原因。
   三、文字转向量：现有生图模型都只出点阵图 ⇒ 先照提示生一张扁平插画（白底），再用现有「图像描摹」（ai.imageTrace.trace）描成新矢量层，暂存的像素层删掉。 */

/* ── 纯函数（不碰 DOM／画板·node 单测直接载）── */
(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  /** '16:9'／'1536x1024'／'1536*1024' ⇒ 宽÷高；认不得 ⇒ null */
  function parseAspect(s) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*[:x×*]\s*(\d+(?:\.\d+)?)\s*$/i.exec(String(s || ''));
    if (!m) return null;
    const a = +m[1], b = +m[2];
    return a > 0 && b > 0 ? a / b : null;
  }
  /** 模型认得的比例／尺寸里挑最接近 aspect 的（按对数比）⇒ {ratio}|{size}|null（模型两样都没列＝不指定） */
  function pickSpec(aspect, caps) {
    const c = caps || {}, cand = [];
    (c.ratios || []).forEach(v => { const a = parseAspect(v); if (a) cand.push({key:'ratio', value:v, aspect:a}); });
    if (!cand.length) (c.sizes || []).forEach(v => { const a = parseAspect(v); if (a) cand.push({key:'size', value:v, aspect:a}); });
    if (!cand.length || !(aspect > 0)) return null;
    let best = null;
    for (const x of cand) { const d = Math.abs(Math.log(x.aspect / aspect)); if (!best || d < best.d - 1e-9) best = Object.assign({d}, x); }
    return {key:best.key, value:best.value, aspect:best.aspect};
  }
  /** 选区外框 ⇒ 取样框（四边各加 pad 比例的边·至少 minPad px·夹在文件里） */
  function contextRect(b, W, H, pad, minPad) {
    const p = pad === undefined ? 0.35 : pad, mp = minPad === undefined ? 48 : minPad;
    const px = Math.max(mp, Math.round(b.w * p)), py = Math.max(mp, Math.round(b.h * p));
    const x0 = clamp(Math.floor(b.x - px), 0, W), y0 = clamp(Math.floor(b.y - py), 0, H);
    const x1 = clamp(Math.ceil(b.x + b.w + px), 0, W), y1 = clamp(Math.ceil(b.y + b.h + py), 0, H);
    return {x:x0, y:y0, w:Math.max(1, x1 - x0), h:Math.max(1, y1 - y0)};
  }
  /** 把框撑成刚好 aspect（只放大不缩）·以原框中心为准、尽量挪进文件里；文件放不下 ⇒ 允许超出（超出处送灰底、遮罩＝不改） */
  function fitRect(r, aspect, W, H) {
    if (!(aspect > 0)) return {x:r.x, y:r.y, w:r.w, h:r.h};
    let w = r.w, h = r.h;
    if (w / h < aspect) w = Math.round(h * aspect); else h = Math.round(w / aspect);
    w = Math.max(w, r.w); h = Math.max(h, r.h);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const place = (c, len, max) => { let a = Math.round(c - len / 2); if (len <= max) a = clamp(a, 0, max - len); else a = Math.round((max - len) / 2); return a; };
    return {x:place(cx, w, W), y:place(cy, h, H), w, h};
  }
  /** 送上去的图多大：长边落在 lo..hi（小块放大到 lo、大块缩到 hi） ⇒ 缩放比 */
  function uploadScale(w, h, lo, hi) {
    const L = Math.max(w, h), a = lo || 1024, b = hi || 1536;
    return L < a ? a / L : L > b ? b / L : 1;
  }
  /** 文件大小的 8 位遮罩 ⇒ 框里那块（框外＝0） */
  function cropMask(bytes, W, H, r) {
    const out = new Uint8Array(r.w * r.h);
    if (!bytes) return out;
    for (let y = 0; y < r.h; y++) {
      const Y = r.y + y; if (Y < 0 || Y >= H) continue;
      for (let x = 0; x < r.w; x++) { const X = r.x + x; if (X >= 0 && X < W) out[y * r.w + x] = bytes[Y * W + X]; }
    }
    return out;
  }
  /** 遮罩外扩 g px（方形最大值·两趟可分离）；g≤0 原样 */
  function grow(m, w, h, g) {
    if (!(g > 0)) return Uint8Array.from(m);
    const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let k = Math.max(0, x - g); k <= Math.min(w - 1, x + g); k++) { const q = m[y * w + k]; if (q > v) { v = q; if (v === 255) break; } } t[y * w + x] = v; }
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { let v = 0; for (let k = Math.max(0, y - g); k <= Math.min(h - 1, y + g); k++) { const q = t[k * w + x]; if (q > v) { v = q; if (v === 255) break; } } o[y * w + x] = v; }
    return o;
  }
  /** 方框模糊 r px（两趟·积分和） */
  function blur(m, w, h, r) {
    if (!(r > 0)) return Uint8Array.from(m);
    const t = new Float32Array(w * h), o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) { let s = 0; const row = y * w; const P = new Float64Array(w + 1); for (let x = 0; x < w; x++) { s += m[row + x]; P[x + 1] = s; }
      for (let x = 0; x < w; x++) { const a = Math.max(0, x - r), b = Math.min(w, x + r + 1); t[row + x] = (P[b] - P[a]) / (b - a); } }
    for (let x = 0; x < w; x++) { let s = 0; const P = new Float64Array(h + 1); for (let y = 0; y < h; y++) { s += t[y * w + x]; P[y + 1] = s; }
      for (let y = 0; y < h; y++) { const a = Math.max(0, y - r), b = Math.min(h, y + r + 1); o[y * w + x] = Math.round((P[b] - P[a]) / (b - a)); } }
    return o;
  }
  /** 贴回去用的遮罩：先外扩再羽化（g＝长边 1%·至少 2px）——结果边缘跟原图融在一起 */
  function featherMask(m, w, h, g) { const k = g === undefined ? Math.max(2, Math.round(Math.max(w, h) * 0.01)) : g; return blur(grow(m, w, h, k), w, h, k); }
  /** RGBA（就地）透明度 × 遮罩 */
  function applyMaskAlpha(rgba, m) { for (let i = 0, j = 3; i < m.length; i++, j += 4) rgba[j] = Math.round(rgba[j] * m[i] / 255); return rgba; }
  /** 生成式扩展：新画布多大、原图落在哪（照 ps.image.canvasSize 同一个锚点算法） */
  const ANCHORS = {topLeft:[0, 0], top:[0.5, 0], topRight:[1, 0], left:[0, 0.5], center:[0.5, 0.5], right:[1, 0.5], bottomLeft:[0, 1], bottom:[0.5, 1], bottomRight:[1, 1]};
  const rround = v => Math.sign(v) * Math.round(Math.abs(v));
  function expandPlan(W, H, p) {
    const q = p || {}, num = v => typeof v === 'number' && isFinite(v) && v > 0;
    let nw = num(q.width) ? Math.round(q.width) : 0, nh = num(q.height) ? Math.round(q.height) : 0;
    if (!nw && !nh) { const s = num(q.scale) ? q.scale : 1.25; nw = Math.round(W * s); nh = Math.round(H * s); }
    if (!nw) nw = W; if (!nh) nh = H;
    nw = clamp(nw, W, 300000); nh = clamp(nh, H, 300000);
    const a = ANCHORS[q.anchor] || ANCHORS.center;
    return {width:nw, height:nh, anchor:ANCHORS[q.anchor] ? q.anchor : 'center', dx:rround((nw - W) * a[0]), dy:rround((nh - H) * a[1]), grew:nw > W || nh > H};
  }
  /** 给模型的指令（英文写给模型看·⛔ 给人看） */
  function buildPrompt(kind, user, style) {
    const u = String(user || '').trim().replace(/\s+/g, ' ').slice(0, 800);
    const keep = 'Keep every pixel outside the white area unchanged. Return the whole image with exactly the same framing and aspect ratio as image 1, with no mask, border, watermark or added text.';
    if (kind === 'remove') return 'Image 1 is a picture; image 2 is a black-and-white mask of the same size. Remove everything inside the white area of the mask from image 1 and rebuild the background behind it so that nothing of the removed object, its shadow or its reflection remains. Match the surrounding texture, lighting and perspective so the edit is invisible. ' + keep;
    if (kind === 'expand') return 'Image 1 is a picture whose canvas has been extended; the flat grey area is new empty canvas and the white area of the mask in image 2 marks it. Outpaint the white area by continuing the existing scene naturally' + (u ? ' (' + u + ')' : '') + ', matching perspective, lighting, colours and style, with no visible seam. ' + keep;
    if (kind === 'vector') {
      const s = style === 'line' ? 'Black line-art drawing of ' + (u || 'a simple object') + ', thick clean uniform black strokes, no fill, no shading'
        : style === 'icon' ? 'Bold solid black silhouette icon of ' + (u || 'a simple object') + ', simple geometric shapes, no outline details, no shading'
        : 'Flat vector illustration of ' + (u || 'a simple object') + ', clean bold shapes in a few solid flat colours, no gradients, no texture, no shading noise';
      return s + ', centered, isolated on a plain pure white background, no text, no frame.';
    }
    return 'Image 1 is a picture; image 2 is a black-and-white mask of the same size. Repaint only the white area of the mask in image 1' + (u ? ' so that it shows: ' + u : ' with content that fits naturally') + '. Match the lighting, perspective, colours and style of the surroundings and blend the edges seamlessly. ' + keep;
  }
  /** 去背模型输出（任意数值）⇒ 0..255（最小最大拉开·rembg 同法） */
  function segAlpha(out) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < out.length; i++) { const v = out[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const r = new Uint8Array(out.length), d = hi - lo;
    if (!(d > 1e-6)) return r;
    for (let i = 0; i < out.length; i++) r[i] = Math.round((out[i] - lo) / d * 255);
    return r;
  }
  /** RGBA（size×size）⇒ CHW float32（÷255·不做 normalize：ormbg 的前处理设定） */
  function packCHW(rgba, n) {
    const t = new Float32Array(3 * n), k = 1 / 255;
    for (let i = 0; i < n; i++) { t[i] = rgba[i * 4] * k; t[n + i] = rgba[i * 4 + 1] * k; t[2 * n + i] = rgba[i * 4 + 2] * k; }
    return t;
  }
  /** 合选区（replace／add／subtract／intersect）·全空＝null */
  function combineSel(old, nw, mode) {
    const n = nw.length, any = a => { for (let i = 0; i < a.length; i++) if (a[i]) return true; return false; };
    if (mode === 'replace' || (mode === 'add' && !old)) return any(nw) ? Uint8Array.from(nw) : null;
    if (!old) return null;
    const o = new Uint8Array(n);
    for (let i = 0; i < n; i++) o[i] = mode === 'add' ? Math.max(old[i], nw[i]) : mode === 'intersect' ? Math.min(old[i], nw[i]) : Math.max(0, old[i] - nw[i]);
    return any(o) ? o : null;
  }
  /** 总点数：一张 credits × count */
  const total = (credits, count) => Math.max(0, Math.round(+credits || 0)) * Math.max(1, Math.round(+count || 1));
  const api = {parseAspect, pickSpec, contextRect, fitRect, uploadScale, cropMask, grow, blur, featherMask, applyMaskAlpha, expandPlan, buildPrompt, segAlpha, packCHW, combineSel, total, ANCHORS};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__dlGenAIPure = api;
})(typeof window !== 'undefined' ? window : this);

/* ── 画板里：命令、对话框、候选列、本地去背 ── */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.DlGenAI && DlGenAI.__loaded) return;
  if (!window.CMD || !window.DlPanels) { console.warn('[genai] 需要 engine.js 的 CMD 与 menus/impl/panels.js'); return; }
  const G = window.__dlGenAIPure, P = window.DlPanels, el = P.el.bind(P), T = P.t;
  const L3 = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, en:c});
  const fail = (code, message, extra) => Object.assign({ok:false, error:code, message}, extra || {});
  const lang = () => (window.Lang && Lang.cur) || 'zh-Hant';
  let toastT = 0;
  function say(o, ms) {
    if (!document.body) return;
    let t = document.getElementById('dlGenAIToast');
    if (!t) { t = el('div', {id:'dlGenAIToast', style:'position:fixed;left:50%;top:56px;transform:translateX(-50%);z-index:10050;max-width:520px;background:#2b2f36;color:#e6e8ec;border:1px solid #444a55;border-radius:6px;padding:6px 12px;font:12px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);pointer-events:none;transition:opacity .3s'}); document.body.appendChild(t); }
    t.textContent = typeof o === 'string' ? o : T(o); t.style.opacity = '1';
    clearTimeout(toastT); toastT = setTimeout(() => { t.style.opacity = '0'; }, ms || 4000);
  }
  const host = () => window.__dlGenAI || null;
  const MAX_COUNT = 4;
  const countOf = v => Math.max(1, Math.min(MAX_COUNT, Math.round(+v || 1)));

  /* ═════ 需登入堤麟 ═════ */
  const LOGIN = L3('這個功能要用堤麟AI的生圖服務（會扣點數），只能在登入後的堤麟AI網站畫板裡使用。請登入堤麟AI後再從網站開畫板。',
                   '这个功能要用堤麟AI的生图服务（会扣点数），只能在登录后的堤麟AI网站画板里使用。请登录堤麟AI后再从网站打开画板。',
                   'This feature uses the Dilin AI image service (it costs credits), so it only works in the drawboard on the Dilin AI website while signed in. Sign in to Dilin AI and open the drawboard there.');
  function signedIn() { const h = host(); return !!(h && h.signedIn && typeof h.quote === 'function' && typeof h.run === 'function' && typeof h.caps === 'function'); }
  function loginRequired(p) {
    if (p && p.ui) openLoginNote();
    return fail('login_required', 'Sign in to Dilin AI: generative features use the website image service and are only available in the signed-in drawboard on the Dilin AI website.', {loginRequired:true});
  }
  function openLoginNote() {
    const d = P.dialog({id:'genaiLogin', title:L3('需要登入堤麟', '需要登录堤麟', 'Sign in to Dilin AI'), fields:[{type:'note', label:LOGIN}], ok:() => ({ok:true}),
      okLabel:L3('知道了', '知道了', 'OK')});
    if (d && d.box) { d.box.dataset.genai = 'login'; const c = d.box.querySelector('[data-act=cancel]'); if (c) c.style.display = 'none'; }
    return d;
  }

  /* ═════ 画面、选区 ═════ */
  const docOpen = () => !!(window.Doc && Doc.width && Doc.height);
  function selBytes() { return window.SelMask && Doc.sel ? SelMask.bytes() : null; }
  function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  /** 取样框那块画面（白底压平；框超出文件的地方＝灰）·缩到 s 倍 */
  function cropImage(src, r, s, fill) {
    const c = canvasOf(r.w * s, r.h * s), x = c.getContext('2d');
    x.fillStyle = fill || '#808080'; x.fillRect(0, 0, c.width, c.height);
    x.save(); x.scale(s, s);
    x.fillStyle = '#ffffff'; x.fillRect(-r.x, -r.y, src.width, src.height);
    x.drawImage(src, -r.x, -r.y); x.restore();
    return c;
  }
  /** 8 位遮罩 ⇒ 黑白图（白＝要改）·缩到 w×h */
  function maskImage(m, mw, mh, w, h) {
    const a = canvasOf(mw, mh), ax = a.getContext('2d'), id = ax.createImageData(mw, mh);
    for (let i = 0; i < m.length; i++) { const v = m[i] >= 128 ? 255 : 0; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    ax.putImageData(id, 0, 0);
    const c = canvasOf(w, h), x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(a, 0, 0, c.width, c.height);
    return c;
  }
  const toBlob = c => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
  async function blobImage(b) {
    if (window.createImageBitmap) { try { return await createImageBitmap(b); } catch (e) {} }
    const u = URL.createObjectURL(b);
    try { return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image decode failed')); i.src = u; }); }
    finally { setTimeout(() => URL.revokeObjectURL(u), 1000); }
  }
  /** 结果图 ⇒ 框大小的像素（拉到框的尺寸）×羽化遮罩 ⇒ canvas */
  function fitResult(img, r, feather) {
    const c = canvasOf(r.w, r.h), x = c.getContext('2d', {willReadFrequently:true});
    x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, r.w, r.h);
    const id = x.getImageData(0, 0, r.w, r.h); G.applyMaskAlpha(id.data, feather); x.putImageData(id, 0, 0);
    return c;
  }

  /* ═════ 候选（只记在这次开着的画板里） ═════ */
  // 审 116180 F3：键＝文件序号＋层 id（换档后图层编号从头算·新档的 L3 ≠ 旧档的 L3）；查／切／追加都只认现在这份文件的
  const CANDS = new Map();      // `${serial}:${layerId}` ⇒ {kind, prompt, rect, feather, images:[ImageBitmap|canvas], fileIds:[], index, qq, p, serial}
  const candKey = id => Doc.serial + ':' + id;
  function candOf(id) { const k = id || (Doc && Doc.activeId); const c = k ? CANDS.get(candKey(k)) : null; return c && c.serial === Doc.serial ? c : null; }
  function candSet(id, c) {
    for (const [k, v] of CANDS) if (v.serial !== Doc.serial) CANDS.delete(k);   // 别份文件的候选（已换档）丢掉
    c.serial = Doc.serial; CANDS.set(candKey(id), c);
  }
  const candDel = id => CANDS.delete(candKey(id));
  /* 审 116180 F2：生成要过好几段等待（问能力、做图、问价、下单、解码）·每段之后都核「还是开始时那份文件」，换了就停（下单前停＝不扣点） */
  const docChanged = () => Object.assign(new Error('the document changed while generating; nothing was placed'), {code:'document_changed'});
  const sameDoc = serial => { if (Doc.serial !== serial) throw docChanged(); };
  /* 审 116180 F7（画板页这层的第二道）：网站说这件中继活的角色没有生图权限（job.imageDenied ⇒ __dlSite.genaiDenied）⇒ 扣点的命令一律不跑（第一道在网站 _drawboard 中继前） */
  const relayDenied = () => !!(window.__dlSite && window.__dlSite.genaiDenied > 0);
  const deniedOut = () => fail('image_not_allowed', 'This role is not allowed to generate images (no image permission), so nothing was sent or charged. Ask the user to allow image generation for this role, or let the user do it in the drawboard.');
  function drawCandidate(L, c, i) {
    const r = c.rect, src = c.images[i];
    const out = c.kind === 'vector' ? null : fitResult(src, {x:0, y:0, w:r.w, h:r.h}, c.feather);
    L.data.ctx.clearRect(-1e5, -1e5, 2e5, 2e5);
    L.data.ctx.drawImage(out, r.x - (L.x || 0), r.y - (L.y || 0));
    if (window.Layer && Layer.invalidate) Layer.invalidate(L);
    c.index = i;
  }
  /** 放成新像素层（一步历史）：框在文件里那块 */
  function placeLayer(c, name, pushed) {
    if (!pushed) History.push();
    const r = c.rect, x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(Doc.width, r.x + r.w), y1 = Math.min(Doc.height, r.y + r.h);
    const L = Layer.raster(name, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    L.x = x0; L.y = y0;
    const at = Doc.activeId ? Doc.index(Doc.activeId) + 1 : undefined;
    Doc.add(L, at);
    candSet(L.id, c);
    drawCandidate(L, c, 0);
    if (window.UI) UI.refresh();
    bar();
    return L;
  }

  /* ═════ 下单（共用）：问价 ⇒ 确认 ⇒ 生成 ═════ */
  async function capsFor(prompt, refImages) {
    const r = await host().caps({prompt, refImages});
    if (!r || r.ok === false) throw Object.assign(new Error((r && (r.message || r.error)) || 'caps failed'), {code:(r && r.code) || 'caps_failed', detail:r});
    if (refImages > 0 && typeof r.refLimit === 'number' && r.refLimit < refImages) throw Object.assign(new Error('model_no_reference'), {code:'model_no_reference', detail:r});
    return r;
  }
  /** 照请求做好要送的图 ⇒ {images:[Blob], spec, rect, feather, kind}（rect＝文件坐标的取样框） */
  async function buildRequest(kind, p, caps) {
    const W = Doc.width, H = Doc.height;
    if (kind === 'vector') {
      const spec = G.pickSpec(1, caps);
      return {kind, images:[], spec:spec ? {[spec.key]:spec.value} : {}, aspect:spec ? spec.aspect : 1};
    }
    if (kind === 'expand') {
      const plan = G.expandPlan(W, H, p);
      if (!plan.grew) throw Object.assign(new Error('the new canvas must be larger than the current one'), {code:'bad_size'});
      const spec = G.pickSpec(plan.width / plan.height, caps);
      const box = G.fitRect({x:0, y:0, w:plan.width, h:plan.height}, spec ? spec.aspect : 0, plan.width, plan.height);
      // 新画布坐标：原图在 (dx,dy)·框外与新长出来的地方＝灰
      const src = composite(1), big = canvasOf(plan.width, plan.height), bx = big.getContext('2d');
      bx.fillStyle = '#808080'; bx.fillRect(0, 0, plan.width, plan.height); bx.fillStyle = '#ffffff'; bx.fillRect(plan.dx, plan.dy, W, H); bx.drawImage(src, plan.dx, plan.dy);
      const m = new Uint8Array(plan.width * plan.height).fill(255);
      for (let y = 0; y < H; y++) { const Y = y + plan.dy; if (Y < 0 || Y >= plan.height) continue; for (let x = 0; x < W; x++) { const X = x + plan.dx; if (X >= 0 && X < plan.width) m[Y * plan.width + X] = 0; } }
      const cm = G.cropMask(m, plan.width, plan.height, box);
      const s = G.uploadScale(box.w, box.h);
      const cv = [cropImage(big, box, s), maskImage(G.grow(cm, box.w, box.h, Math.max(2, Math.round(Math.max(box.w, box.h) * 0.01))), box.w, box.h, box.w * s, box.h * s)];
      return {kind, plan, spec:spec ? {[spec.key]:spec.value} : {}, rect:box, mask:cm, feather:G.featherMask(cm, box.w, box.h),
        refDims:cv.map(c => [c.width, c.height]), images:[await toBlob(cv[0]), await toBlob(cv[1])]};
    }
    const bytes = selBytes();
    if (!bytes || !Doc.sel) throw Object.assign(new Error('make a selection first'), {code:'no_selection'});
    const b = {x:Doc.sel.x, y:Doc.sel.y, w:Doc.sel.w, h:Doc.sel.h};
    const ctx = G.contextRect(b, W, H);
    const spec = G.pickSpec(ctx.w / ctx.h, caps);
    const box = G.fitRect(ctx, spec ? spec.aspect : 0, W, H);
    const cm = G.cropMask(bytes, W, H, box);
    const s = G.uploadScale(box.w, box.h);
    const g = Math.max(2, Math.round(Math.max(box.w, box.h) * 0.01));
    const cv = [cropImage(composite(1), box, s), maskImage(G.grow(cm, box.w, box.h, g), box.w, box.h, box.w * s, box.h * s)];
    return {kind, spec:spec ? {[spec.key]:spec.value} : {}, rect:box, mask:cm, feather:G.featherMask(cm, box.w, box.h, g),
      refDims:cv.map(c => [c.width, c.height]), images:[await toBlob(cv[0]), await toBlob(cv[1])]};
  }
  /** 问价（⛔ 扣点）：票绑这份文件（serial）、张数 count 与全套规格（宿主回的 q.spec）；中途换档 ⇒ document_changed */
  async function quoteFor(kind, p, count, serial) {
    const prompt = G.buildPrompt(kind, p.prompt, p.style);
    const refs = kind === 'vector' ? 0 : 2;
    const caps = await capsFor(prompt, refs);
    sameDoc(serial);
    const req = await buildRequest(kind, p, caps);
    sameDoc(serial);
    return requote({req, prompt, caps, serial}, count);
  }
  /** 同一份请求（同几张图、同规格）照 count 张再问一次价 ⇒ 新票（「再生成」也走这里：⛔ 沿用旧票旧价） */
  async function requote(base, count) {
    const q = await host().quote({prompt:base.prompt, images:base.req.images, spec:base.req.spec, count, refDims:base.req.refDims || []});
    if (!q || q.ok === false) throw Object.assign(new Error((q && (q.message || q.error)) || 'quote failed'), {code:(q && q.code) || 'quote_failed', detail:q});
    sameDoc(base.serial);
    return {req:base.req, q, prompt:base.prompt, caps:base.caps, serial:base.serial, count};
  }
  const errOut = e => fail(e.code || 'error', String(e.message || e), Object.assign({}, e.detail && e.detail.credits !== undefined ? {credits:e.detail.credits} : {}, e.extra || {}));
  const quoteInfo = (q, count) => ({credits:q.credits, count, total:G.total(q.credits, count), billingMode:q.billingMode || 'precharge', model:q.model, modelLabel:q.modelLabel, spec:q.spec || null});
  /** 失败那张的点数现况（审 116180 F5·宿主没标的旧回包：refunded:true＝已退，其余＝不确定） */
  const CREDIT_STATES = ['refunded', 'not_charged', 'pending', 'refund_pending', 'charged', 'unknown'];
  const creditOf = x => (x && CREDIT_STATES.includes(x.credit) ? x.credit : x && x.refunded ? 'refunded' : 'unknown');
  /** 跑：送 count 张、收结果（每张各扣一次）；下单前、下单后、每张解码后都核还是同一份文件（换了 ⇒ 下单前＝不送；下单后＝不贴·图在云盘） */
  async function runTicket(q, count, onProgress, serial) {
    sameDoc(serial);
    const out = await host().run(q.ticket, {count, onProgress});
    if (!out || out.ok === false) throw Object.assign(new Error((out && (out.message || out.error)) || 'generation failed'), {code:(out && out.code) || 'generation_failed', detail:out});
    const good = out.results.filter(x => x && x.ok && x.blob), bad = out.results.filter(x => !x || !x.ok);
    const fileIds = good.map(g => g.fileId || null);
    const failed = bad.map(x => ({error:(x && x.error) || 'failed', refunded:creditOf(x) === 'refunded', credit:creditOf(x)}));
    const changed = () => Object.assign(new Error('the document changed while generating; the images were not placed (they are saved in your drive)'), {code:'document_changed', extra:{fileIds, failed}});
    if (Doc.serial !== serial) throw changed();
    const images = [];
    for (const g of good) { images.push(await blobImage(g.blob)); if (Doc.serial !== serial) throw changed(); }
    return {images, fileIds, failed};
  }
  const NAMES = {fill:L3('生成式填色', '生成式填充', 'Generative Fill'), expand:L3('生成式擴展', '生成式扩展', 'Generative Expand'), remove:L3('生成式移除', '生成式移除', 'Generative Remove'), vector:L3('AI 向量', 'AI 矢量', 'AI Vector')};
  const layerName = (kind, prompt) => { const n = T(NAMES[kind]); const s = String(prompt || '').trim().slice(0, 24); return s ? n + '：' + s : n; };

  /** 一条生成命令的整段（agent／对话框共用）：先问价；没 confirm ⇒ 回报价；有 ⇒ 下单、贴回 */
  async function generate(kind, p, ui) {
    if (relayDenied()) return deniedOut();   // 同步判（第一个 await 之前）：动作播放等没 await 的叫法也拦得到
    if (!docOpen()) return fail('no_document', 'no document is open');
    if (!signedIn()) return loginRequired(p);
    const count = countOf(p.count), serial = Doc.serial;
    let qq;
    try { qq = await quoteFor(kind, p, count, serial); } catch (e) { return errOut(e); }
    const info = quoteInfo(qq.q, count);
    if (!p.confirm) return fail('confirm_required', `This will charge about ${info.total} credits (${info.credits} × ${count}${info.billingMode === 'postcharge' ? ', charged after the image is made by its actual quality' : ''}). Call again with confirm:true to generate.`, info);
    if (typeof p.maxCredits === 'number' && info.total > p.maxCredits) return fail('over_budget', `This would charge ${info.total} credits, more than maxCredits ${p.maxCredits}; nothing was charged.`, info);
    return finish(kind, p, qq, count, ui);
  }
  async function finish(kind, p, qq, count, ui) {
    const info = quoteInfo(qq.q, count);
    // 票是问价那份文件、那个张数的：换了档 ⇒ 不送（⛔ 扣点）；张数跟票不同 ⇒ 要重新问价
    if (Doc.serial !== qq.serial) return fail('document_changed', 'the document changed after the estimate; nothing was sent or charged', info);
    if (count !== qq.count) return fail('quote_changed', 'the number of variations changed after the estimate; estimate again', info);
    let got;
    try { got = await runTicket(qq.q, count, ui && ui.progress, qq.serial); } catch (e) { return errOut(e); }
    if (Doc.serial !== qq.serial) return errOut(Object.assign(docChanged(), {extra:{fileIds:got.fileIds, failed:got.failed}}));
    if (!got.images.length) return fail('generation_failed', got.failed.map(f => f.error).join('; ') || 'no image came back', Object.assign(info, {failed:got.failed}));
    const c = {kind, prompt:p.prompt || '', rect:qq.req.rect, feather:qq.req.feather, images:got.images, fileIds:got.fileIds, index:0, qq, p};
    if (kind === 'vector') return placeVector(c, info, got);
    let pushed = false;
    if (kind === 'expand') {
      // 扩画布与放新图层算同一步历史（一次 Ctrl+Z 两样都退）：先拍快照、再直接跑 canvasSize（不另进历史）
      if (!CMD.map['ps.image.canvasSize']) return fail('no_canvas_size', 'canvas size is not available', info);
      History.push(); pushed = true;
      const r = CMD.map['ps.image.canvasSize'].run({width:qq.req.plan.width, height:qq.req.plan.height, anchor:qq.req.plan.anchor, extensionColor:'transparent'});
      if (!r || r.ok === false) { History.restoreInPlace(History.past.pop()); return fail('canvas_size_failed', (r && r.error) || 'canvas size failed', info); }
      // 画板自己算的原图位移若跟这边不同（不该发生）⇒ 结果框跟着挪
      if (r.offset) c.rect = Object.assign({}, c.rect, {x:c.rect.x + r.offset[0] - qq.req.plan.dx, y:c.rect.y + r.offset[1] - qq.req.plan.dy});
    }
    const L = placeLayer(c, layerName(kind, p.prompt), pushed);
    return Object.assign({ok:true, layerId:L.id, candidates:got.images.length, index:0, fileIds:got.fileIds, failed:got.failed, rect:[c.rect.x, c.rect.y, c.rect.w, c.rect.h]}, info);
  }

  /* ═════ 文字转向量：生图 ⇒ 暂存像素层 ⇒ 图像描摹成新矢量层 ⇒ 删暂存层 ═════ */
  const VSTYLE = {flat:{preset:'6 Colors', params:{ignoreWhite:true}}, line:{preset:'Line Art', params:{ignoreWhite:true}}, icon:{preset:'Black and White Logo', params:{ignoreWhite:true}}};
  function traceInto(c, i, at) {
    const img = c.images[i], side = Math.round(Math.min(Doc.width, Doc.height) * 0.6);
    const k = Math.min(side / img.width, side / img.height), w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
    const tmp = Layer.raster('genai-trace-source', w, h);
    tmp.x = Math.round((Doc.width - w) / 2); tmp.y = Math.round((Doc.height - h) / 2);
    tmp.data.ctx.imageSmoothingQuality = 'high'; tmp.data.ctx.drawImage(img, 0, 0, w, h);
    Doc.add(tmp, at);
    const st = VSTYLE[c.p.style] || VSTYLE.flat;
    const params = Object.assign({}, st.params, typeof c.p.colors === 'number' && (c.p.style || 'flat') === 'flat' ? {colors:Math.max(2, Math.min(16, Math.round(c.p.colors)))} : {});
    let r;
    try { r = CMD.map['ai.imageTrace.trace'].run({sourceLayerId:tmp.id, preset:st.preset, params, name:layerName('vector', c.prompt)}); }
    finally { CMD.map['layer.delete'].run({id:tmp.id}); }
    return r;
  }
  function placeVector(c, info, got) {
    if (!CMD.map['ai.imageTrace.trace']) return fail('trace_missing', 'image trace is not available in this drawboard');
    History.push();
    const at = Doc.activeId ? Doc.index(Doc.activeId) + 1 : undefined;
    const r = traceInto(c, 0, at);
    if (!r || r.ok === false) { History.restoreInPlace(History.past.pop()); return fail('trace_failed', (r && r.error) || 'trace failed', info); }
    c.index = 0; c.layerId = r.layerId; candSet(r.layerId, c);
    if (window.UI) UI.refresh();
    bar();
    return Object.assign({ok:true, layerId:r.layerId, paths:r.paths, colors:r.colors, candidates:got.images.length, index:0, fileIds:got.fileIds, failed:got.failed, via:'image+trace'}, info);
  }

  /* ═════ 候选切换、再多要几张 ═════ */
  function variant(p) {
    const id = p.layerId || Doc.activeId, c = candOf(id), L = id && Doc.byId(id);
    if (!c || !L) return fail('no_candidates', 'this layer has no generated candidates (only kept while this drawboard stays open)');
    const n = c.images.length, i = typeof p.index === 'number' ? Math.round(p.index) : (c.index + (p.step === -1 ? n - 1 : 1)) % n;
    if (i < 0 || i >= n) return fail('bad_index', `index must be 0..${n - 1}`);
    if (c.kind === 'vector') {
      const at = Doc.index(L.id);
      CMD.map['layer.delete'].run({id:L.id}); candDel(L.id);
      const r = traceInto(c, i, at);
      if (!r || r.ok === false) return fail('trace_failed', (r && r.error) || 'trace failed');
      c.index = i; candSet(r.layerId, c);
      bar();
      return {ok:true, layerId:r.layerId, index:i, candidates:n};
    }
    drawCandidate(L, c, i);
    bar();
    return {ok:true, layerId:L.id, index:i, candidates:n, fileId:c.fileIds[i] || null};
  }
  /** 再多要几张：同一份请求重新问价（⛔ 沿用第一次的旧票旧价）·pre＝对话框刚问好的那张票（人看过价才按的） */
  async function more(p, ui, pre) {
    if (relayDenied()) return deniedOut();
    const id = p.layerId || Doc.activeId, c = candOf(id);
    if (!c) return fail('no_candidates', 'this layer has no generated candidates');
    if (!signedIn()) return loginRequired(p);
    const count = countOf(p.count), serial = Doc.serial;
    let qq = pre && pre.c === c && pre.qq.serial === serial && pre.qq.count === count ? pre.qq : null;
    if (!qq) { try { qq = await requote(Object.assign({}, c.qq, {serial}), count); } catch (e) { return errOut(e); } }
    const info = quoteInfo(qq.q, count);
    if (!p.confirm) return fail('confirm_required', `This will charge about ${info.total} credits (${info.credits} × ${count}). Call again with confirm:true.`, info);
    if (typeof p.maxCredits === 'number' && info.total > p.maxCredits) return fail('over_budget', `This would charge ${info.total} credits, more than maxCredits ${p.maxCredits}; nothing was charged.`, info);
    if (candOf(id) !== c) return fail('document_changed', 'the document or layer changed before ordering; nothing was sent or charged', info);
    let got;
    try { got = await runTicket(qq.q, count, ui && ui.progress, serial); } catch (e) { return errOut(e); }
    if (candOf(id) !== c) return errOut(Object.assign(docChanged(), {extra:{fileIds:got.fileIds, failed:got.failed}}));
    if (!got.images.length) return fail('generation_failed', got.failed.map(f => f.error).join('; ') || 'no image came back', Object.assign(info, {failed:got.failed}));
    c.images.push(...got.images); c.fileIds.push(...got.fileIds);
    bar();
    return Object.assign({ok:true, layerId:id, candidates:c.images.length, added:got.images.length, failed:got.failed}, info);
  }

  /* ═════ 本地去背（Worker·onnxruntime-web） ═════ */
  const SEG_SIZE = 1024, SEG_CACHE = 'dilin-paint-seg';
  const SEG_WORKER = `
let sess = null, ort = null
self.onmessage = async (e) => {
  const m = e.data
  try {
    if (m.type === 'load') {
      ort = await import(m.ort)
      let bytes = null, cache = null
      try { cache = await caches.open(m.cache); const hit = await cache.match(m.model); if (hit) bytes = new Uint8Array(await hit.arrayBuffer()) } catch (err) { cache = null }
      if (!bytes) {
        const r = await fetch(m.model)
        if (!r.ok || !r.body) throw new Error('model ' + r.status)
        const total = Number(r.headers.get('content-length')) || 0
        const rd = r.body.getReader(); const parts = []; let loaded = 0
        for (;;) { const x = await rd.read(); if (x.done) break; parts.push(x.value); loaded += x.value.length; self.postMessage({ type: 'progress', loaded, total }) }
        bytes = new Uint8Array(loaded); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length }
        if (cache) { try { await cache.put(m.model, new Response(bytes)) } catch (err) {} }
      }
      let device = 'webgpu'
      try { sess = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] }) }
      catch (err) { device = 'wasm'; sess = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }) }
      self.postMessage({ type: 'ready', device })
    } else if (m.type === 'run') {
      const feeds = {}; feeds[sess.inputNames[0]] = new ort.Tensor('float32', m.input, [1, 3, m.size, m.size])
      const out = await sess.run(feeds)
      const data = new Float32Array(out[sess.outputNames[0]].data)
      self.postMessage({ type: 'result', id: m.id, output: data }, [data.buffer])
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err).slice(0, 300) })
  }
}
`;
  const Seg = {worker:null, ready:null, device:null, seq:0, pending:new Map()};
  function segConfig() { const h = host(); const s = h && h.segment; return s && (typeof s.runner === 'function' || (s.ort && s.model)) ? s : null; }
  async function segCached(cfg) { try { const c = await caches.open(SEG_CACHE); return !!(await c.match(cfg.model)); } catch (e) { return false; } }
  function segLoad(cfg, onProgress) {
    if (Seg.ready) return Seg.ready;
    Seg.ready = new Promise((res, rej) => {
      let w;
      try { w = new Worker(URL.createObjectURL(new Blob([SEG_WORKER], {type:'text/javascript'})), {type:'module'}); } catch (e) { rej(e); return; }
      Seg.worker = w;
      w.onmessage = e => {
        const m = e.data;
        if (m.type === 'progress') { if (onProgress) onProgress(m.loaded, m.total || cfg.bytes || 0); return; }
        if (m.type === 'ready') { Seg.device = m.device; res(m.device); return; }
        if (m.type === 'result' || m.type === 'error') {
          const pend = m.id !== undefined && Seg.pending.get(m.id);
          if (pend) { Seg.pending.delete(m.id); m.type === 'result' ? pend.res(m.output) : pend.rej(new Error(m.message)); }
          else if (m.type === 'error') rej(new Error(m.message));
        }
      };
      w.onerror = e => rej(new Error(e.message || 'worker failed'));
      w.postMessage({type:'load', ort:cfg.ort, model:cfg.model, cache:SEG_CACHE});
    });
    Seg.ready.catch(() => { if (Seg.worker) Seg.worker.terminate(); Seg.worker = null; Seg.ready = null; });
    return Seg.ready;
  }
  function segRunWorker(input) {
    const id = ++Seg.seq;
    return new Promise((res, rej) => { Seg.pending.set(id, {res, rej}); Seg.worker.postMessage({type:'run', id, input, size:SEG_SIZE}, [input.buffer]); });
  }
  /** 画面（W×H 的 RGBA canvas）⇒ 文件大小的 8 位前景遮罩；宿主给 runner ⇒ 交它跑（例如单机版走本机） */
  async function segment(src, cfg, onProgress) {
    const s = canvasOf(SEG_SIZE, SEG_SIZE), sx = s.getContext('2d', {willReadFrequently:true});
    sx.imageSmoothingQuality = 'high'; sx.drawImage(src, 0, 0, SEG_SIZE, SEG_SIZE);
    const input = G.packCHW(sx.getImageData(0, 0, SEG_SIZE, SEG_SIZE).data, SEG_SIZE * SEG_SIZE);
    let out;
    if (typeof cfg.runner === 'function') out = await cfg.runner(input, SEG_SIZE);
    else { await segLoad(cfg, onProgress); out = await segRunWorker(input); }
    const a = G.segAlpha(out instanceof Float32Array ? out : Float32Array.from(out || []));
    if (a.length !== SEG_SIZE * SEG_SIZE) throw new Error('segmentation output has the wrong size');
    const g = canvasOf(SEG_SIZE, SEG_SIZE), gx = g.getContext('2d'), id = gx.createImageData(SEG_SIZE, SEG_SIZE);
    for (let i = 0; i < a.length; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = a[i]; id.data[i * 4 + 3] = 255; }
    gx.putImageData(id, 0, 0);
    const W = src.width, H = src.height, f = canvasOf(W, H), fx = f.getContext('2d', {willReadFrequently:true});
    fx.imageSmoothingQuality = 'high'; fx.drawImage(g, 0, 0, W, H);
    const d = fx.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4];
    return m;
  }
  /** 要不要先问一声下载（人按的、模型还没在浏览器快取里）：回 true＝继续 */
  async function askDownload(cfg, p) {
    if (!p.ui || typeof cfg.runner === 'function' || await segCached(cfg)) return true;
    const mb = cfg.bytes ? Math.round(cfg.bytes / 1048576) : null;
    return new Promise(res => {
      const d = P.dialog({id:'genaiSegDownload', title:L3('第一次使用 AI 去背', '第一次使用 AI 抠图', 'First use of AI background removal'), fields:[{type:'note', label:L3(
        `要先下載去背模型${mb ? `（約 ${mb} MB）` : ''}到這台瀏覽器，之後就存在瀏覽器裡、不用再下載；圖不會上傳。按「取消」改用傳統演算法。`,
        `要先下载抠图模型${mb ? `（约 ${mb} MB）` : ''}到这台浏览器，之后就存在浏览器里、不用再下载；图片不会上传。按「取消」改用传统算法。`,
        `The background-removal model${mb ? ` (about ${mb} MB)` : ''} is downloaded into this browser once and kept there; your picture is not uploaded. Cancel uses the classic algorithm instead.`)}],
        okLabel:L3('下載並使用', '下载并使用', 'Download and use'), ok:() => { res(true); return {ok:true}; }, onClose:() => res(false)});
      if (!d) res(false);
    });
  }
  /** 取画面：全部图层合成，或现用像素层（文件坐标·层外透明） */
  function samplePixels(all, L) {
    // 单一像素层：层外与透明处垫白（去背模型与传统演算法都看 RGB·透明当黑会把整片空白看成物件）
    if (!all && L && L.kind === 'raster') { const c = canvasOf(Doc.width, Doc.height), x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(L.data.canvas, Math.round(L.x || 0), Math.round(L.y || 0)); return c; }
    return composite(1);
  }
  /** AI 主体遮罩；拿不到 ⇒ {mask:null, reason} */
  async function aiMask(src, p) {
    const cfg = segConfig();
    if (!cfg) return {mask:null, reason:'no_model'};
    if (!(await askDownload(cfg, p))) return {mask:null, reason:'declined'};
    try { return {mask:await segment(src, cfg, p.ui ? (l, t) => say(L3(`下載去背模型 ${t ? Math.round(l / t * 100) + '%' : Math.round(l / 1048576) + ' MB'}`, `下载抠图模型 ${t ? Math.round(l / t * 100) + '%' : Math.round(l / 1048576) + ' MB'}`, `Downloading model ${t ? Math.round(l / t * 100) + '%' : Math.round(l / 1048576) + ' MB'}`), 1500) : null), device:Seg.device || 'host'}; }
    catch (e) { console.warn('[genai] 本地去背跑不起来·退回传统演算法', e); return {mask:null, reason:'failed: ' + String(e && e.message || e).slice(0, 200)}; }
  }
  const CLASSIC_NOTE = L3('AI 去背沒法用（沒有模型或跑不起來），已改用傳統演算法。', 'AI 抠图用不了（没有模型或跑不起来），已改用传统算法。', 'AI background removal is unavailable here (no model, or it could not run), so the classic algorithm was used.');
  async function selectSubject(p) {
    if (!docOpen()) return fail('no_document', 'no document is open');
    const mode = ['add', 'subtract', 'intersect'].includes(p.mode) ? p.mode : 'replace', engine = p.engine === 'classic' || p.engine === 'ai' ? p.engine : 'auto';
    const all = typeof p.sampleAllLayers === 'boolean' ? p.sampleAllLayers : true;
    const classic = reason => {
      if (!CMD.map['ps.select.subject']) return fail('no_engine', 'select subject is not available');
      const r = CMD.run('ps.select.subject', {mode, sampleAllLayers:all});
      if (reason && p.ui) say(CLASSIC_NOTE, 5000);
      return Object.assign({}, r, {engine:'classic'}, reason ? {fallback:reason} : {});
    };
    if (engine === 'classic') return classic(null);
    const serial = Doc.serial;
    const got = await aiMask(samplePixels(all, Doc.active()), p);
    // 审 116180 F6：先核文件再决定退回传统——等模型的中间换了档 ⇒ 什么都不选（⛔ 替新档建立选区）
    if (Doc.serial !== serial) return fail('document_changed', 'the document changed while selecting');
    if (!got.mask) return engine === 'ai' ? fail('ai_unavailable', 'AI segmentation is unavailable: ' + got.reason, {engine:'none', fallback:got.reason}) : classic(got.reason);
    History.push();
    const out = G.combineSel(Doc.sel ? SelMask.bytes() : null, got.mask, mode);
    Doc.sel = out ? SelMask.fromBytes(out) : null;
    if (window.UI) UI.refresh();
    return {ok:true, engine:'ai', device:got.device, selected:!!Doc.sel, bounds:Doc.sel ? [Doc.sel.x, Doc.sel.y, Doc.sel.w, Doc.sel.h] : null};
  }
  /** 移除背景：主体遮罩 ⇒ 这层的图层遮罩（原像素都留着·照 PS） */
  async function removeBackground(p) {
    if (!docOpen()) return fail('no_document', 'no document is open');
    const L = Doc.byId(p.layerId || Doc.activeId);
    if (!L || L.kind !== 'raster') return fail('not_raster', 'remove background works on a pixel layer');
    if (L.mask) return fail('has_mask', 'the layer already has a layer mask; delete or apply it first');
    if (!CMD.map['ps.layer.layerMask.revealSelection']) return fail('no_mask_engine', 'layer masks are not available');
    const engine = p.engine === 'classic' || p.engine === 'ai' ? p.engine : 'auto', serial = Doc.serial;
    let mask = null, used = 'classic', reason = null;
    if (engine !== 'classic') { const got = await aiMask(samplePixels(false, L), p); mask = got.mask; reason = got.reason || null; if (mask) used = 'ai'; else if (engine === 'ai') return fail('ai_unavailable', 'AI segmentation is unavailable: ' + got.reason, {engine:'none', fallback:got.reason}); }
    if (Doc.serial !== serial || !Doc.byId(L.id)) return fail('document_changed', 'the document changed while removing the background');
    const keep = Doc.sel;
    History.push();
    try {
      if (!mask) {
        const r = window.PsSelect && PsSelect.selectSubject ? PsSelect.selectSubject(samplePixels(false, L).getContext('2d').getImageData(0, 0, Doc.width, Doc.height).data, Doc.width, Doc.height) : null;
        if (!r) { History.restoreInPlace(History.past.pop()); return fail('no_subject', 'no subject was found on this layer', Object.assign({engine:'classic'}, reason ? {fallback:reason} : {})); }
        // 传统演算法只保证外框里那块对（同 ps.select.subject 的 combineRegion）⇒ 框外清零
        const W = Doc.width, b = r.bbox; mask = new Uint8Array(W * Doc.height);
        for (let y = b[1]; y < b[1] + b[3]; y++) for (let x = b[0]; x < b[0] + b[2]; x++) mask[y * W + x] = r.mask[y * W + x];
      }
      Doc.sel = SelMask.fromBytes(mask);
      if (!Doc.sel) { History.restoreInPlace(History.past.pop()); return fail('no_subject', 'no subject was found on this layer', {engine:used}); }
      const r = CMD.map['ps.layer.layerMask.revealSelection'].run({id:L.id});
      if (r && r.ok === false) { History.restoreInPlace(History.past.pop()); return Object.assign({}, r, {engine:used}); }
    } finally { Doc.sel = keep; }
    if (window.UI) UI.refresh();
    if (used === 'classic' && reason && p.ui) say(CLASSIC_NOTE, 5000);
    return Object.assign({ok:true, layerId:L.id, engine:used}, used === 'ai' ? {device:Seg.device || 'host'} : {}, reason && used === 'classic' ? {fallback:reason} : {});
  }

  /* ═════ 对话框：填栏位 ⇒ 估算点数 ⇒ 确认生成（扣 N 点） ═════ */
  const TITLES = {fill:L3('生成式填色', '生成式填充', 'Generative Fill'), expand:L3('生成式擴展', '生成式扩展', 'Generative Expand'), remove:L3('生成式移除', '生成式移除', 'Generative Remove'), vector:L3('文字轉向量圖形', '文字转矢量图形', 'Text to Vector Graphic')};
  const ERRS = {
    no_selection:L3('請先建立選取範圍。', '请先建立选区。', 'Make a selection first.'),
    model_no_reference:L3('你目前選的生圖模型不收參考圖，沒法做這件事；請到網站設定換一個能用參考圖的生圖模型。', '你目前选的生图模型不收参考图，没法做这件事；请到网站设置换一个能用参考图的生图模型。', 'Your current image model does not take reference images; pick one that does in the website settings.'),
    bad_size:L3('新的版面要比現在大。', '新的画布要比现在大。', 'The new canvas must be larger than the current one.'),
    document_changed:L3('生成時換了文件，結果沒貼上（已生成的圖都存在雲端硬碟裡）。', '生成时换了文件，结果没贴上（已生成的图都存在云盘里）。', 'The document changed while generating; nothing was placed (any images already made are in your drive).'),
    quote_changed:L3('估算之後模型、規格或點數變了，沒有扣點；請重新估算。', '估算之后模型、规格或点数变了，没有扣点；请重新估算。', 'The model, spec or price changed after the estimate; nothing was charged. Estimate again.'),
    image_not_allowed:L3('這個角色沒有生圖權限，沒有送出、沒有扣點。', '这个角色没有生图权限，没有送出、没有扣点。', 'This role has no image-generation permission; nothing was sent or charged.'),
  };
  const errText = r => ERRS[r.error] ? T(ERRS[r.error]) : (r.message || r.error || '');
  /** 没成的那几张按点数现况分开说（审 116180 F5：⛔ 一律说「已退回」） */
  const CREDIT_TEXT = {
    refunded:L3('點數已退回', '点数已退回', 'credits refunded'),
    not_charged:L3('沒有扣點', '没有扣点', 'not charged'),
    pending:L3('還在生成，好了會出現在雲端硬碟（點數照扣）', '还在生成，好了会出现在云盘（点数照扣）', 'still generating; it will appear in your drive (charged)'),
    refund_pending:L3('失敗了，退點還沒確認（會自動退，請稍後看點數紀錄）', '失败了，退点还没确认（会自动退，请稍后看点数记录）', 'failed; the refund is not confirmed yet (it is automatic, check your credit history later)'),
    charged:L3('已扣點，圖在雲端硬碟（沒能載入畫板）', '已扣点，图在云盘（没能载入画板）', 'charged; the picture is in your drive (could not be loaded here)'),
    unknown:L3('不確定是否已扣點，可能仍在生成（好了會出現在雲端硬碟）；請先看點數紀錄與雲端硬碟再決定要不要重試', '不确定是否已扣点，可能仍在生成（好了会出现在云盘）；请先看点数记录与云盘再决定要不要重试', 'not sure whether it was charged — it may still be generating (it will appear in your drive); check your credit history and drive before retrying'),
  };
  function failedNote(failed) {
    const n = {};
    for (const f of failed) { const k = CREDIT_TEXT[f.credit] ? f.credit : 'unknown'; n[k] = (n[k] || 0) + 1; }
    const part = (lg, k) => (lg === 'en' ? `${n[k]}: ` : lg === 'zh-Hans' ? `${n[k]} 张：` : `${n[k]} 張：`) + CREDIT_TEXT[k][lg];
    const keys = Object.keys(CREDIT_TEXT).filter(k => n[k]);
    const line = lg => (lg === 'en' ? `${failed.length} variation(s) did not come back — ` : lg === 'zh-Hans' ? `有 ${failed.length} 张没生成成功——` : `有 ${failed.length} 張沒生成成功——`) + keys.map(k => part(lg, k)).join(lg === 'en' ? '; ' : '；');
    return {'zh-Hant':line('zh-Hant'), 'zh-Hans':line('zh-Hans'), en:line('en')};
  }
  function costLine(info) {
    const pc = info.billingMode === 'postcharge';
    return T(L3(`每張約 ${info.credits} 點 × ${info.count} 張＝共 ${info.total} 點${pc ? '（這個模型照實際畫質出圖後扣，可能略多）' : ''}；失敗會自動退回。${info.modelLabel ? '模型：' + info.modelLabel : ''}`,
               `每张约 ${info.credits} 点 × ${info.count} 张＝共 ${info.total} 点${pc ? '（这个模型按实际画质出图后扣，可能略多）' : ''}；失败会自动退回。${info.modelLabel ? '模型：' + info.modelLabel : ''}`,
               `About ${info.credits} credits × ${info.count} = ${info.total} credits${pc ? ' (this model charges after the image is made, by its actual quality)' : ''}; failures are refunded automatically.${info.modelLabel ? ' Model: ' + info.modelLabel : ''}`));
  }
  function openDialog(kind, init) {
    if (!docOpen()) return fail('no_document', 'no document is open');
    if (!signedIn()) { openLoginNote(); return {ok:true, opened:'login'}; }
    if ((kind === 'fill' || kind === 'remove') && !Doc.sel) { say(ERRS.no_selection); return fail('no_selection', 'make a selection first'); }
    const i0 = init || {};
    const fields = [];
    if (kind === 'fill' || kind === 'expand') fields.push({k:'prompt', type:'text', label:L3('提示（可留空）', '提示（可留空）', 'Prompt (optional)'), value:i0.prompt || ''});
    if (kind === 'vector') fields.push({k:'prompt', type:'text', label:L3('要畫什麼', '要画什么', 'Describe it'), value:i0.prompt || ''},
      {k:'style', type:'select', label:L3('樣式', '样式', 'Style'), value:i0.style || 'flat', options:[['flat', L3('扁平插畫', '扁平插画', 'Flat illustration')], ['line', L3('線條', '线条', 'Line art')], ['icon', L3('剪影圖示', '剪影图标', 'Silhouette icon')]]});
    if (kind === 'expand') {
      const e = G.expandPlan(Doc.width, Doc.height, {scale:1.25});
      fields.push({k:'width', type:'number', min:Doc.width, label:L3('新寬度（像素）', '新宽度（像素）', 'New width (px)'), value:i0.width || e.width},
        {k:'height', type:'number', min:Doc.height, label:L3('新高度（像素）', '新高度（像素）', 'New height (px)'), value:i0.height || e.height},
        {k:'anchor', type:'select', label:L3('原圖位置', '原图位置', 'Anchor'), value:i0.anchor || 'center', options:Object.keys(G.ANCHORS).map(a => [a, a])});
    }
    fields.push({k:'count', type:'select', label:L3('候選張數', '候选张数', 'Variations'), value:String(i0.count || 1), options:[1, 2, 3, 4].map(n => [String(n), String(n)])},
      {type:'note', label:L3('會用堤麟AI的生圖服務、扣你的點數；先按「估算點數」看要扣多少，再按確認才會生成。', '会用堤麟AI的生图服务、扣你的点数；先按「估算点数」看要扣多少，再按确认才会生成。', 'This uses the Dilin AI image service and your credits: press "Estimate" first to see the cost; nothing is generated until you confirm.')});
    let quoted = null, busy = false;
    const d = P.dialog({id:'genai.' + kind, title:TITLES[kind], fields, okLabel:L3('估算點數', '估算点数', 'Estimate'), ok:() => { void step(); return false; }});
    if (!d) return fail('no_dialog', 'dialog unavailable');
    d.box.dataset.genai = kind;
    const okBtn = d.box.querySelector('[data-act=ok]'), msg = d.box.querySelector('.msg');
    const cost = el('div', {class:'note', dataset:{k:'cost'}}); msg.parentNode.insertBefore(cost, msg);
    const params = () => { const v = d.values(); const q = {prompt:v.prompt || '', count:countOf(v.count)}; if (kind === 'vector') q.style = v.style; if (kind === 'expand') Object.assign(q, {width:v.width, height:v.height, anchor:v.anchor}); return q; };
    const reset = () => { if (busy) return; quoted = null; cost.textContent = ''; okBtn.textContent = T(L3('估算點數', '估算点数', 'Estimate')); delete okBtn.dataset.stage; };
    d.box.querySelectorAll('input,select').forEach(x => x.addEventListener('input', reset));
    // 票绑了张数（审 116180 F1）⇒ 改张数也要重新估算
    d.box.querySelectorAll('select').forEach(x => x.addEventListener('change', reset));
    async function step() {
      if (busy) return;
      const q = params();
      if (kind === 'vector' && !q.prompt.trim()) { msg.textContent = T(L3('請描述要畫什麼。', '请描述要画什么。', 'Describe what to draw.')); return; }
      busy = true; okBtn.disabled = true; msg.textContent = '';
      try {
        if (!quoted) {
          cost.textContent = T(L3('估算中…', '估算中…', 'Estimating…'));
          try { const qq = await quoteFor(kind, q, q.count, Doc.serial); quoted = {qq, info:quoteInfo(qq.q, q.count)}; }
          catch (e) { cost.textContent = ''; msg.textContent = errText(errOut(e)); return; }
          cost.textContent = costLine(quoted.info);
          okBtn.textContent = T(L3(`確認生成（扣 ${quoted.info.total} 點）`, `确认生成（扣 ${quoted.info.total} 点）`, `Generate (${quoted.info.total} credits)`));
          okBtn.dataset.stage = 'confirm';
          return;
        }
        cost.textContent = T(L3('生成中…（可能要一兩分鐘）', '生成中…（可能要一两分钟）', 'Generating… (this can take a minute or two)'));
        const r = await finish(kind, q, quoted.qq, quoted.info.count, {progress:(done, of) => { cost.textContent = T(L3(`生成中… ${done}/${of}`, `生成中… ${done}/${of}`, `Generating… ${done}/${of}`)); }});
        // 一张都没回：按每张点数现况说（⛔ 拿 client 回的原句当提示·不确定的那张不能说成「被拒／没扣」）
        if (!r || r.ok === false) { msg.textContent = r && r.error === 'generation_failed' && r.failed && r.failed.length ? T(failedNote(r.failed)) : errText(r || {}); cost.textContent = ''; quoted = null; okBtn.textContent = T(L3('估算點數', '估算点数', 'Estimate')); delete okBtn.dataset.stage; return; }
        if (r.failed && r.failed.length) say(failedNote(r.failed), 8000);
        d.close();
      } finally { busy = false; okBtn.disabled = false; }
    }
    return {ok:true, opened:kind};
  }

  /* ═════ 候选列（现用层有候选才出现）：‹ 1/3 ›＋再生成 ═════ */
  function bar() {
    let b = document.getElementById('dlGenAIBar');
    const c = window.Doc && Doc.activeId ? candOf(Doc.activeId) : null;
    if (!c) { if (b) b.style.display = 'none'; return; }
    if (!b) {
      b = el('div', {id:'dlGenAIBar', style:'position:fixed;left:50%;bottom:44px;transform:translateX(-50%);z-index:950;display:flex;gap:8px;align-items:center;background:#2b2f36;color:#e6e8ec;border:1px solid #444a55;border-radius:16px;padding:4px 12px;font:12px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)'});
      document.body.appendChild(b);
    }
    b.style.display = 'flex'; b.innerHTML = '';
    const btn = (t, f, k) => el('button', {text:t, dataset:{act:k}, style:'background:#3a404b;color:#e6e8ec;border:1px solid #4a515e;border-radius:10px;padding:1px 9px;cursor:pointer', onclick:f});
    b.appendChild(el('span', {text:T(NAMES[c.kind])}));
    b.appendChild(btn('‹', () => { CMD.run('genai.variant', {step:-1}); }, 'prev'));
    b.appendChild(el('span', {dataset:{k:'index'}, text:(c.index + 1) + ' / ' + c.images.length}));
    b.appendChild(btn('›', () => { CMD.run('genai.variant', {}); }, 'next'));
    b.appendChild(btn(T(L3('再生成…', '再生成…', 'More…')), () => openMore(), 'more'));
  }
  /** 「再生成…」：先照同一份请求重新问价、显示这次的价，按确认才用这张新票下单（⛔ 拿第一次的旧价） */
  async function openMore() {
    const c = candOf(Doc.activeId); if (!c) return;
    if (!signedIn()) { openLoginNote(); return; }
    const sayErr = r => say({'zh-Hant':errText(r), 'zh-Hans':errText(r), en:errText(r)}, 6000);
    say(L3('估算中…', '估算中…', 'Estimating…'), 3000);
    let qq;
    try { qq = await requote(Object.assign({}, c.qq, {serial:Doc.serial}), 1); } catch (e) { sayErr(errOut(e)); return; }
    if (candOf(Doc.activeId) !== c) return;
    const info = quoteInfo(qq.q, 1);
    const d = P.dialog({id:'genai.more', title:L3('再生成一張候選', '再生成一张候选', 'One more variation'), fields:[{type:'note', label:{'zh-Hant':costLine(info), 'zh-Hans':costLine(info), en:costLine(info)}}],
      okLabel:L3(`確認生成（扣 ${info.total} 點）`, `确认生成（扣 ${info.total} 点）`, `Generate (${info.total} credits)`),
      ok:() => { void more({layerId:Doc.activeId, count:1, confirm:true, maxCredits:info.total, ui:true}, null, {c, qq}).then(r => { if (r && r.ok === false && r.error !== 'generation_failed') sayErr(r); else if (r && r.failed && r.failed.length) say(failedNote(r.failed), 8000); else if (r && r.ok === false) sayErr(r); }); return {ok:true}; }});
    if (d && d.box) d.box.dataset.genai = 'more';
  }
  if (window.UI && UI.refresh && !UI.__genaiBar) {
    UI.__genaiBar = true;
    const r0 = UI.refresh;
    UI.refresh = function () { const r = r0.apply(this, arguments); try { bar(); } catch (e) {} return r; };
  }

  /* ═════ 命令 ═════ */
  const GEN_P = 'count?: 1..4=1（候选张数·每张各扣一次点）, confirm?: bool=false（没给＝只回报价 {error:"confirm_required", credits, count, total, billingMode, model}·⛔ 扣点；true＝照价下单）, maxCredits?: number（总点数超过就不下单）, ui?: bool';
  const GEN_R = '→ {ok, layerId, candidates, index, credits（一张）, count, total, billingMode, model, fileIds, failed:[{error, refunded, credit:"refunded|not_charged|pending|refund_pending|charged|unknown"（这张点数现况）}]}；没登入堤麟＝{ok:false, error:"login_required"}（免登入版／单机版都是）；问价后规格或价变了＝quote_changed（没扣·再问一次价）；角色没有生图权限＝image_not_allowed';
  CMD.reg('genai.fill', {i18n:'', params:`{prompt?: string（要在选区里生出什么·留空＝照周围补）, ${GEN_P}} 生成式填充：选区附近那块画面＋选区遮罩送网站的生图服务（参考图编辑），结果只取选区里那块（边缘羽化）放成新像素层；要先有选区 ${GEN_R}`}, ({prompt, count, confirm, maxCredits, ui}) => generate('fill', {prompt, count, confirm, maxCredits, ui}, null));
  CMD.reg('genai.remove', {i18n:'', params:`{${GEN_P}} 生成式移除：把选区里的东西去掉、补上背景（同生成式填充的送法），结果放成新像素层；要先有选区 ${GEN_R}`}, ({count, confirm, maxCredits, ui}) => generate('remove', {count, confirm, maxCredits, ui}, null));
  CMD.reg('genai.expand', {i18n:'', params:`{width?: number（新画布宽 px·不小于现在）, height?: number（新画布高 px）, scale?: number=1.25（没给宽高时四边一起放大的倍数）, anchor?: "topLeft|top|topRight|left|center|right|bottomLeft|bottom|bottomRight"="center"（原图落在哪）, prompt?: string, ${GEN_P}} 生成式扩展：画布放大（新长出来的地方透明·同 ps.image.canvasSize），新地方由生图服务接着画、放成新像素层；成功才改画布，失败不动 ${GEN_R}`}, ({width, height, scale, anchor, prompt, count, confirm, maxCredits, ui}) => generate('expand', {width, height, scale, anchor, prompt, count, confirm, maxCredits, ui}, null));
  CMD.reg('genai.textToVector', {i18n:'', params:`{prompt: string（要画什么）, style?: "flat|line|icon"="flat", colors?: 2..16=6（flat 用几色）, ${GEN_P}} 文字转矢量图形：现有生图模型只出点阵图 ⇒ 先生一张白底扁平插画，再用「图像描摹」（ai.imageTrace.trace）描成新矢量层（暂存的像素层删掉） → {ok, layerId, paths, colors, via:"image+trace", candidates, credits, count, total, …}；没登入＝login_required`}, ({prompt, style, colors, count, confirm, maxCredits, ui}) => {
    if (!String(prompt || '').trim()) return fail('prompt_required', 'prompt is required'); return generate('vector', {prompt, style, colors, count, confirm, maxCredits, ui}, null);
  });
  CMD.reg('genai.variant', {i18n:'', undoable:true, params:'{layerId?: 生成出来的那层（缺省现用层）, index?: number（第几张·从 0 起）, step?: number（-1＝上一张；不给 index 时缺省下一张）} 换成另一张候选（只在这次开着的画板里记得候选） → {ok, layerId, index, candidates}'}, ({layerId, index, step}) => variant({layerId, index, step}));
  CMD.reg('genai.more', {i18n:'', params:`{layerId?: 生成出来的那层（缺省现用层）, ${GEN_P}} 同一个请求再多要几张候选（每张各扣一次点） → {ok, layerId, candidates, added, credits, count, total, failed}`}, ({layerId, count, confirm, maxCredits, ui}) => more({layerId, count, confirm, maxCredits, ui}, null));
  CMD.reg('genai.candidates', {i18n:'', params:'{layerId?: 层 id（缺省现用层）} 这层的候选：{ok, kind, prompt, index, candidates, fileIds}（没有＝{ok:false, error:"no_candidates"}）'}, ({layerId}) => {
    const c = candOf(layerId); if (!c) return fail('no_candidates', 'this layer has no generated candidates');
    return {ok:true, kind:c.kind, prompt:c.prompt, index:c.index, candidates:c.images.length, fileIds:c.fileIds.slice()};
  });
  CMD.reg('genai.status', {i18n:'', params:'{} 生成式功能能不能用：{ok, signedIn（登入堤麟网站＝true·生成式填充／扩展／移除、文字转向量才能用）, localSegment（AI 去背模型来源有没有设好）, segmentDevice}'}, () => ({ok:true, signedIn:signedIn(), localSegment:!!segConfig(), segmentDevice:Seg.device || null}));
  CMD.reg('genai.selectSubject', {i18n:'', params:'{mode?: "replace|add|subtract|intersect"="replace", sampleAllLayers?: bool=true, engine?: "auto|ai|classic"="auto"（auto＝本地 AI 去背模型能用就用、不能用退回传统演算法 ps.select.subject）, ui?: bool} 选择主体（AI）：在浏览器本地跑去背模型（第一次要下载模型、之后存在浏览器里·图不上传·不扣点） → {ok, engine:"ai"|"classic", fallback?: 退回传统的原因, device?, selected, bounds}'}, ({mode, sampleAllLayers, engine, ui}) => selectSubject({mode, sampleAllLayers, engine, ui}));
  CMD.reg('ps.layer.removeBackground', {i18n:'', params:'{layerId?: 像素层 id（缺省现用层）, engine?: "auto|ai|classic"="auto", ui?: bool} 移除背景：主体以外遮掉（加图层遮罩·原像素都留着）；本地 AI 去背模型能用就用、不能用退回传统演算法（选择主体）·不扣点 → {ok, layerId, engine, fallback?}'}, ({layerId, engine, ui}) => removeBackground({layerId, engine, ui}));
  CMD.reg('genai.fill.dialog', {i18n:'', params:'{} 开「生成式填充」对话框（要有选区·没登入出「需登入堤麟」说明）'}, () => openDialog('fill'));
  CMD.reg('genai.remove.dialog', {i18n:'', params:'{} 开「生成式移除」对话框（要有选区）'}, () => openDialog('remove'));
  CMD.reg('genai.expand.dialog', {i18n:'', params:'{} 开「生成式扩展」对话框'}, () => openDialog('expand'));
  CMD.reg('genai.textToVector.dialog', {i18n:'', params:'{} 开「文字转矢量图形」对话框'}, () => openDialog('vector'));
  CMD.reg('genai.selectSubject.ui', {i18n:'', params:'{} 菜单用：选择主体（AI）＝genai.selectSubject {ui:true}'}, () => selectSubject({ui:true}));

  window.DlGenAI = {__loaded:true, pure:G, signedIn, segConfig, Seg, CANDS, openDialog};
})();
