/* 文字（T）——照 ArtCraft 的 Rust 原码逐段翻译
   对照源（…）：
     photocraft/crates/ui-egui/src/type_tool.rs   点一下＝点文字、拖框＝段落文字；点进文字放插入点、拖选、⇧点延伸；
                                                  键盘（删字／删词／删到行首、方向键／词／行、Home/End、Enter、Esc、⌘Enter、⌘A）；
                                                  IME 组字；复制／剪下／贴上；提交（新层空就删、否则以内文命名）／取消；叠画；选项栏
     photocraft/crates/engine/src/type_cmds.rs    type.create / type.edit / type.setStyle / type.info 的参数与行为
     photocraft/crates/ui-egui/src/canvas.rs      双击＝选词（:1559）、按下被文字吃掉就不拖框（:2086）、放开才建字（:2159）
     photocraft/crates/ui-egui/src/lib.rs:790     换工具＝提交
     vectorcraft/crates/tools/src/text.rs         三连击选段落、编辑中被换层就结束、空点文字连同步骤一起放弃（discardEmpty）
     vectorcraft/crates/text/src/edit.rs          paragraph_at
   🔴 改文件的事全走 CMD：text.create / text.edit / text.setStyle（＋ text.commit / text.cancel / text.select / text.info / text.fonts）。
      同一次编辑带同一个 coalesce 键 ⇒ 整段打字只算一步历史（type_tool.rs 顶注），跟 PhotoCraft 一样。
   🔴 版面（插入点、选取、点击落在第几个字）必须跟 engine.js renderLayer 画出来的一模一样：
      同一个字型串、行距 size×1.25、textAlign 以 data.x 为锚点、基线在 data.y、整层再平移 L.x/L.y。 */
(function(){

/* ── 常数（原码出处写在旁边） ── */
const PLACEHOLDER = 'Lorem Ipsum';         // type_tool.rs:19  新字的占位文字（建好就整段选取，一打字就换掉）
const BLINK_MS = 530;                      // type_tool.rs:351/563  插入点闪烁节奏（PS 约 0.53 秒）
const SLOP_PX = 6;                         // type_tool.rs:60  点中文字层的容差＝6 个萤幕像素
const MIN_BOX_PX = 4;                      // type_tool.rs:158  拖框两边都 ≥4 萤幕像素才算段落文字
const SAME_CLICK_PX = 4;                   // vectorcraft text.rs:321  连击要落在 4 萤幕像素内
const NAME_MAX = 40;                       // type_tool.rs:479  新层以内文第一行命名，最多 40 字
const LINE_H = 1.25;                       // engine.js renderLayer 的行距（我们的渲染器；版面跟它走）
const lineH = d => +d.leading > 0 ? +d.leading : d.size * LINE_H;   // 图层有 data.leading（基线到基线）就用它（engine.js textLineH）
const ACCENT = '#2f7fd8';
const ALIGNS = ['left', 'center', 'right'];
// type_tool.rs:581 weight_name 的表（字重 → 样式名）
const WEIGHTS = [['Thin',100], ['ExtraLight',200], ['Light',300], ['Regular',400], ['Medium',500], ['SemiBold',600], ['Bold',700], ['ExtraBold',800], ['Black',900]];
const STYLES = ['Thin', 'Light', 'Regular', 'Italic', 'Medium', 'SemiBold', 'Bold', 'Bold Italic', 'ExtraBold', 'Black'];
const FONT_CANDIDATES = ['sans-serif', 'serif', 'monospace', 'Inter', 'Arial', 'Helvetica', 'Verdana', 'Georgia', 'Times New Roman',
  'Courier New', 'DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Noto Serif', 'Noto Sans CJK SC', 'Noto Sans CJK TC', 'Noto Serif CJK SC',
  'Source Han Sans SC', 'Microsoft YaHei', 'Microsoft JhengHei', 'PingFang SC', 'PingFang TC', 'SimSun', 'SimHei', 'KaiTi'];

/* Rust 的 f64::round 是「.5 远离零」 */
const rround = v => Math.sign(v) * Math.round(Math.abs(v));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/* PhotoCraft 的偏移是「字元索引」（type_tool.rs 顶注）；JS 字串是 UTF-16，用码位阵列才不会把一个中文／表情拆半 */
const chars = s => Array.from(String(s == null ? '' : s));
const isAlnum = c => /[\p{L}\p{N}]/u.test(c);                        // char::is_alphanumeric
const normText = s => String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');   // type_tool.rs:200

/* ── 样式名 ⇄ 字重（type_tool.rs:581 weight_name、:596 styles）。我们的 data.weight 是 CSS 的 font-weight（可带 italic） ── */
function weightName(w){
  const r = Math.round(w);
  if (r <= 150) return 'Thin'; if (r <= 250) return 'ExtraLight'; if (r <= 350) return 'Light';
  if (r <= 450) return 'Regular'; if (r <= 550) return 'Medium'; if (r <= 650) return 'SemiBold';
  if (r <= 750) return 'Bold'; if (r <= 850) return 'ExtraBold'; return 'Black';
}
function styleToWeight(name){
  let s = String(name || 'Regular').trim(), it = false;
  if (/Italic$/i.test(s)){ it = true; s = s.replace(/\s*Italic$/i, '') || 'Regular'; }
  const hit = WEIGHTS.find(w => w[0].toLowerCase() === s.toLowerCase());
  const w = hit ? hit[1] : 400;
  if (!it) return w === 400 ? 'normal' : String(w);
  return 'italic ' + w;
}
function weightToStyle(weight){
  const s = String(weight || 'normal').toLowerCase();
  const it = /italic|oblique/.test(s);
  const m = s.match(/\d+/);
  const w = m ? +m[0] : /bold/.test(s) ? 700 : /light/.test(s) ? 300 : 400;
  const n = weightName(w);
  return it ? (n === 'Regular' ? 'Italic' : n + ' Italic') : n;
}

/* ── 版面（照 renderLayer 一模一样地量；renderLayer 画哪几行由下面的 wrapLines 决定，两边同一套折行）── */
const _mc = document.createElement('canvas').getContext('2d');
const fontOf = d => `${d.weight || 'normal'} ${d.size}px ${d.font}`;     // 跟 renderLayer 同一个字型串
function metrics(d){
  _mc.font = fontOf(d);
  const m = _mc.measureText('Mg');
  return [m.fontBoundingBoxAscent || d.size * 0.8, m.fontBoundingBoxDescent || d.size * 0.2];
}
/* photocraft text/layout.rs:1038 first_ascent —— 小写 d 的高度（PS 段落文字「第一条基线＝上伸」：d 的顶碰框顶）；量不到就用 ascent×0.75 */
function dAscent(d){
  _mc.font = fontOf(d);
  const h = _mc.measureText('d').actualBoundingBoxAscent;
  return h > 0 ? h : metrics(d)[0] * 0.75;
}
/* 「上到上」行距（PS 段落 LeadingType 1）：第一行的字框顶贴框顶 ⇒ 第一条基线＝框顶＋字框在基线上的那段
   （字框＝一个字号高，按字型 ascent:descent 分上下；量得到 emHeightAscent 就用它） */
function emAscent(d){
  _mc.font = fontOf(d);
  const e = _mc.measureText('永').emHeightAscent;
  if (e > 0) return e;
  const [a, ds] = metrics(d);
  return a + ds > 0 ? d.size * a / (a + ds) : dAscent(d);
}

/* ── 折行（photocraft text/layout.rs:430-504：parley break_all_lines(avail) ＝ UAX#14 断行机会上的贪心折行）──
   · 可用宽＝框宽（我们没有缩排），至少 1（:437）
   · 行尾空白「挂」在行尾：不算进宽度、也不拿来对齐（:504 adv = advance − trailing_whitespace）
   · 断行机会（UAX#14 的常用部分）：空白之后；中日韩字之间与它们前后（逐字可断）；连字号之后；
     行首禁则（、。，！？）」』…不放行首）与行尾禁则（（「『…不放行尾）
   · 整个词比一行还宽就在字上硬断（每行至少一个字）
   · 点文字没有框 ⇒ 只按 \n 切 */
const isSpace = c => /\s/.test(c) && c !== ' ';
const isCJK = c => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u.test(c);
const NO_START = new Set(Array.from('、。，．・：；？！ー’”）〕］｝〉》」』】〙〗〟｠»ヽヾゝゞ々〻ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ…‥,.;:!?)]}%'));
const NO_END = new Set(Array.from('‘“（〔［｛〈《「『【〘〖〝｟«([{$'));
function canBreakBefore(cs, i){            // cs[i-1] 与 cs[i] 之间能不能断
  const a = cs[i - 1], b = cs[i];
  if (isSpace(b)) return false;            // 不在空白前断（空白挂在上一行尾）
  if (NO_START.has(b) || NO_END.has(a)) return false;
  if (isSpace(a)) return true;
  if (a === '-' && i >= 2 && !isSpace(cs[i - 2])) return true;
  return isCJK(a) || isCJK(b);
}
const _wrapCache = new Map();
/* 全部的行（不管框高）：[{start,end 字元索引（end＝下一行开头，或 \n 的位置）, soft:是不是折出来的}] */
function wrapRanges(d){
  const avail = d.box ? Math.max(1, d.box.w) : Infinity;
  const key = [d.font, d.weight, d.size, avail, d.text].join('\u0001');
  const hit = _wrapCache.get(key); if (hit) return hit;
  const cs = chars(d.text), n = cs.length, out = [];
  _mc.font = fontOf(d);
  let ps = 0;
  while (true){
    let pe = ps; while (pe < n && cs[pe] !== '\n') pe++;            // 这一段 [ps, pe)
    let s = ps;
    while (true){
      let lastBreak = -1, cut = -1;
      if (avail !== Infinity){
        for (let i = s; i < pe; i++){
          if (i > s && canBreakBefore(cs, i)) lastBreak = i;
          if (isSpace(cs[i])) continue;                                // 空白不会把行撑破
          if (_mc.measureText(cs.slice(s, i + 1).join('')).width > avail){
            cut = lastBreak > s ? lastBreak : (i > s ? i : i + 1);     // 没有断行机会就在字上硬断
            break;
          }
        }
      }
      if (cut < 0 || cut >= pe){ out.push({start:s, end:pe, soft:false}); break; }
      out.push({start:s, end:cut, soft:true}); s = cut;
    }
    if (pe >= n) break;
    ps = pe + 1;
  }
  if (_wrapCache.size > 300) _wrapCache.clear();
  _wrapCache.set(key, out);
  return out;
}
/* 真正排出来的行：段落文字超出框底（基线＋下伸 > 框底＋0.5）的行不排（layout.rs:497 overflow ⇒ stop）；第一行一定留 */
function visibleRanges(d){
  const R = wrapRanges(d);
  if (!d.box) return R;
  const desc = metrics(d)[1], lh = lineH(d), bottom = d.box.y + d.box.h + 0.5;
  let k = 1; while (k < R.length && d.y + k * lh + desc <= bottom) k++;
  return R.slice(0, k);
}
/* 给 engine.js renderLayer 用：要画的每一行字串（行尾空白去掉，对齐才跟版面一致） */
function wrapLines(d){
  const cs = chars(d.text);
  return visibleRanges(d).map(r => { let e = r.end; while (e > r.start && isSpace(cs[e - 1])) e--; return cs.slice(r.start, e).join(''); });
}

/* 一层文字的版面（文件坐标）：每行 {start,end, soft, baseline, x0, x1（不含行尾空白）, ascent, descent, xs:每个字界的 x（含行尾空白）} */
function layout(L){
  const d = L.data, cs = chars(d.text);
  const [asc, desc] = metrics(d);
  const R = visibleRanges(d);
  _mc.font = fontOf(d);
  const ax = d.x + L.x, ay = d.y + L.y, lh = lineH(d);
  const lines = R.map((r, li) => {
    const xs = [0]; let acc = '', w = 0;
    for (let k = r.start; k < r.end; k++){
      acc += cs[k]; const v = _mc.measureText(acc).width; xs.push(v);
      if (!isSpace(cs[k])) w = v;                                       // 对齐宽不含行尾空白
    }
    const x0 = ax - (d.align === 'center' ? w / 2 : d.align === 'right' ? w : 0);
    return {start:r.start, end:r.end, soft:r.soft, baseline: ay + li * lh, x0, x1: x0 + w, ascent:asc, descent:desc, xs: xs.map(v => x0 + v)};
  });
  return {lines, n:cs.length, anchor:[ax, ay], lineH:lh, asc, desc};
}
const lineOf = (lay, i) => lay.lines.find(l => i >= l.start && i <= l.end) || lay.lines[lay.lines.length - 1];
/* TextLayout::caret → (x, top, bottom) */
function caretAt(lay, i){
  const l = lineOf(lay, i);
  return [l.xs[clamp(i - l.start, 0, l.xs.length - 1)], l.baseline - l.ascent, l.baseline + l.descent];
}
/* TextLayout::line_bounds（上下）与 bounds（外框） */
const lineBounds = lay => [lay.lines[0].baseline - lay.asc, lay.lines[lay.lines.length - 1].baseline + lay.desc];
function bounds(lay){
  const [t, b] = lineBounds(lay);
  return [Math.min(...lay.lines.map(l => l.x0)), t, Math.max(...lay.lines.map(l => l.x1)), b];
}
/* TextLayout::hit_test / hit_test_line：先按 y 找行，再找最近的字界 */
function hitTest(lay, x, y){
  const top = lay.lines[0].baseline - lay.asc;
  const li = clamp(Math.floor((y - top) / lay.lineH), 0, lay.lines.length - 1);
  const l = lay.lines[li];
  let best = 0, bd = Infinity;
  l.xs.forEach((v, k) => { const dd = Math.abs(v - x); if (dd < bd){ bd = dd; best = k; } });
  return l.start + best;
}
/* 段落文字：框在图层坐标；锚点跟着对齐方式落在框的左／中／右，第一条基线＝框顶＋d 的高度（layout.rs:492）；
   data.leadingType＝1（上到上）＝框顶＋字框上段（emAscent） */
function placeInBox(d){
  const b = d.box; if (!b) return;
  d.x = b.x + (d.align === 'center' ? b.w / 2 : d.align === 'right' ? b.w : 0);
  d.y = b.y + (d.leadingType === 1 ? emAscent(d) : dAscent(d));
}
/* 文字层在文件里的外框（段落文字连框一起算，vectorcraft text.rs:198 hit_edited） */
function layerBounds(L){
  const b0 = bounds(layout(L)), bx = L.data.box;
  const b = !bx ? b0 : [Math.min(b0[0], bx.x + L.x), Math.min(b0[1], bx.y + L.y), Math.max(b0[2], bx.x + L.x + bx.w), Math.max(b0[3], bx.y + L.y + bx.h)];
  // 有变形（斜切／旋转）的文字层＝四角套变形后的外框
  const M = window.TextXform && TextXform.doc(L); if (!M) return b;
  const q = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(([x, y]) => TextXform.apply(M, x, y));
  return [Math.min(...q.map(v => v[0])), Math.min(...q.map(v => v[1])), Math.max(...q.map(v => v[0])), Math.max(...q.map(v => v[1]))];
}
const zoom = () => Math.max((window.UI && UI.zoom) || 1, 0.01);

/* type_tool.rs:58 hit_layer —— 点下去那一点是哪一层文字（最上面、看得见的先） */
function hitLayer(x, y){
  const slop = SLOP_PX / zoom();
  for (let i = Doc.layers.length - 1; i >= 0; i--){
    const L = Doc.layers[i];
    if (!L.visible || L.kind !== 'text') continue;
    const r = layerBounds(L);
    if (x >= r[0] - slop && x <= r[2] + slop && y >= r[1] - slop && y <= r[3] + slop) return L.id;
  }
  return null;
}
/* type_tool.rs:101 hit_offset */
function hitOffset(id, x, y){
  const L = Doc.byId(id); if (!L || L.kind !== 'text') return 0;
  const M = window.TextXform && TextXform.doc(L), V = M && TextXform.inv(M);   // 变形过的层＝点到的位置先反算回平的字上再找第几个字
  if (V) [x, y] = TextXform.apply(V, x, y);
  return hitTest(layout(L), x, y);
}
/* 工具的滑鼠命中：有 tools/typev.js 的 TypeVKit 就用它（直排层用直排几何、横排层回头叫上面这两支；文字蒙版暂存层不算），
   ⇒ 文字工具点到直排文字层也能进去改字 */
const KIT = () => window.TypeVKit || null;
const toolHitLayer = (x, y, also) => KIT() ? KIT().hitLayer(x, y, also) : hitLayer(x, y);
const toolHitOffset = (id, x, y) => KIT() ? KIT().hitOffset(id, x, y) : hitOffset(id, x, y);
/* type_tool.rs:252 word_boundary —— 上一个／下一个词界（字母数字为词） */
function wordBoundary(text, from, forward){
  const cs = chars(text); let i = Math.min(from, cs.length);
  if (forward){
    while (i < cs.length && !isAlnum(cs[i])) i++;
    while (i < cs.length && isAlnum(cs[i])) i++;
  } else {
    while (i > 0 && !isAlnum(cs[i - 1])) i--;
    while (i > 0 && isAlnum(cs[i - 1])) i--;
  }
  return i;
}
/* vectorcraft edit.rs:248 paragraph_at —— 含 i 的那一段（不含 \n） */
function paragraphAt(text, i){
  const cs = chars(text); i = clamp(i, 0, cs.length);
  let a = i; while (a > 0 && cs[a - 1] !== '\n') a--;
  let b = i; while (b < cs.length && cs[b] !== '\n') b++;
  return [a, b];
}

/* ── 历史合并（type_tool.rs 顶注：整段打字＝一步「编辑文字」）──
   我们的历史是整份快照：同一个 coalesce 键、而且历史最上面那步还是它推的 ⇒ 不再推新快照。
   中间有别的命令推过历史、或被还原／重做过 ⇒ 最上面那步换了 ⇒ 另起一步（vectorcraft text.rs:146 同理） */
const Coal = {key:null, top:null};
function historyStep(key){
  const top = History.past[History.past.length - 1];
  if (key && key === Coal.key && top && top === Coal.top) return;
  History.push();
  Coal.key = key || null; Coal.top = History.past[History.past.length - 1];
}
function sessionOnTop(key){
  return !!key && Coal.key === key && History.past.length > 0 && History.past[History.past.length - 1] === Coal.top;
}
function textLayer(id){
  const L = id ? Doc.byId(id) : Doc.active();
  return L && L.kind === 'text' ? L : null;
}
function layerName(text){                    // type_cmds.rs:411 layer_name
  const first = (normText(text).split('\n')[0] || '').trim();
  const name = chars(first).slice(0, NAME_MAX).join('');
  return name || Lang.t('layer.text');
}
/* 新建的层以内文命名（type_tool.rs:479）：第一个非空行、去头尾空白、最多 40 字；全空回 '' */
function createdName(text){
  const first = normText(text).split('\n').find(l => l.trim()) || '';
  return chars(first.trim()).slice(0, NAME_MAX).join('');
}
function info(L){                            // type_cmds.rs:417 info（文件坐标）
  const lay = layout(L), d = L.data;
  return {ok:true, id:L.id, name:L.name, text:d.text, x:d.x + L.x, y:d.y + L.y, size:d.size, font:d.font, weight:d.weight,
    fontStyle:weightToStyle(d.weight), color:d.color, align:d.align,
    tracking:+d.tracking || 0, fauxBold:!!d.fauxBold, fauxItalic:!!d.fauxItalic, antialias:d.antialias || 'smooth',
    box: d.box ? [d.box.x + L.x, d.box.y + L.y, d.box.w, d.box.h] : null, shape: d.box ? 'box' : 'point',
    lines: lay.lines.map(l => ({start:l.start, end:l.end, soft:l.soft, baseline:l.baseline, x0:l.x0, x1:l.x1, ascent:l.ascent, descent:l.descent})),
    bounds: bounds(lay)};
}
function fontAvailable(f){
  if (/^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/.test(f)) return true;
  const probe = 'mmmmmmmmmmlli一二三ABC';
  return ['monospace', 'serif', 'sans-serif'].some(base => {
    _mc.font = `72px ${base}`; const w0 = _mc.measureText(probe).width;
    _mc.font = `72px "${f}", ${base}`; return _mc.measureText(probe).width !== w0;
  });
}
let _fonts = null;
const families = () => _fonts || (_fonts = FONT_CANDIDATES.filter(fontAvailable));   // type_tool.rs:576 families（整个程序只算一次）

/* ═══════════════ 命令（agent 与滑鼠／键盘走同一条路） ═══════════════ */

/* type_cmds.rs:473 type.create */
CMD.reg('text.create', {i18n:'', params:'{x,y 文件坐标＝点文字的基线锚点 | box:[x,y,w,h] 文件坐标＝段落文字框, text="", size=字号px, font="sans-serif", fontStyle="Regular|Bold|Italic|Bold Italic|Light|…" 或 weight, color="#rrggbb"(缺省＝前景色), align="left|center|right", name?(缺省＝内文第一行), coalesce?:str(同一个键的连续 text.* 编辑并成一步历史), keepActive?:bool(true＝当前层不换成新文字层)} 新增文字层（插在当前层上面）→ {id}'}, p => {
  let box = null;
  if (Array.isArray(p.box) && p.box.length === 4){
    box = p.box.map(Number);
    if (!(box[2] > 0 && box[3] > 0)) return {ok:false, error:'box width and height must be positive'};
  }
  historyStep(p.coalesce);
  const d = {text:normText(p.text || ''), size: +p.size > 0 ? +p.size : ToolState.fontSize, font: p.font || 'sans-serif',
    color: p.color || (window.UI ? UI.fill() : '#000000'), align: ALIGNS.includes(p.align) ? p.align : 'left',
    weight: p.weight !== undefined ? String(p.weight) : styleToWeight(p.fontStyle)};
  if (box){ d.box = {x:box[0], y:box[1], w:box[2], h:box[3]}; placeInBox(d); }
  else { d.x = +p.x || 0; d.y = +p.y || 0; }
  const L = Layer.text(p.name || layerName(d.text), d);
  const host = Doc.activeId, i = Doc.index(host);
  Doc.add(L, i >= 0 ? i + 1 : undefined);                 // insert_above(active)，并设为当前层
  if (p.keepActive && Doc.byId(host)) Doc.activeId = host;   // AI 区域／路径文字工具：留在原矢量层（工具栏不换走）
  return {id:L.id};
});

/* type_cmds.rs:520 type.edit（没有字元样式段，所以没有 runs／kerning） */
CMD.reg('text.edit', {i18n:'', params:'{layerId?, text?:str 整串换掉, replace?:{start,end,text} 字元索引（换掉 [start,end)）, name?, point?:[x,y] 文件坐标（转成点文字）, box?:[x,y,w,h] 文件坐标（转成段落文字）, move?:[dx,dy], coalesce?} 改文字层 → 该层资讯（同 text.info）'}, p => {
  const L = textLayer(p.layerId); if (!L) return {ok:false, error:'not a text layer'};
  historyStep(p.coalesce);
  const d = L.data;
  if (typeof p.text === 'string') d.text = normText(p.text);
  if (p.replace){
    const cs = chars(d.text), n = cs.length;
    const a = clamp(+p.replace.start || 0, 0, n);
    const b = Math.max(a, p.replace.end == null ? n : clamp(+p.replace.end, 0, n));
    cs.splice(a, b - a, ...chars(normText(p.replace.text || '')));
    d.text = cs.join('');
  }
  if (Array.isArray(p.box) && p.box.length === 4){
    const v = p.box.map(Number);
    d.box = {x:v[0] - L.x, y:v[1] - L.y, w:Math.max(1, v[2]), h:Math.max(1, v[3])}; placeInBox(d);
  }
  if (Array.isArray(p.point) && p.point.length === 2){ delete d.box; d.x = +p.point[0] - L.x; d.y = +p.point[1] - L.y; }
  if (Array.isArray(p.move) && p.move.length === 2){
    const dx = +p.move[0] || 0, dy = +p.move[1] || 0;
    d.x += dx; d.y += dy; if (d.box){ d.box.x += dx; d.box.y += dy; }
  }
  if (typeof p.name === 'string') L.name = p.name;
  Layer.invalidate(L);
  return info(L);
});

/* type_cmds.rs:635 type.setStyle（我们的文字层只有一种样式 ⇒ 套在整层；range 收下但不分段） */
CMD.reg('text.setStyle', {i18n:'', params:'{layerId?, font?, fontStyle?:"Regular|Bold|Italic|…", weight?, size?:px, color?:"#rrggbb", align?:"left|center|right", tracking?:1/1000 em（字距）, fauxBold?:bool（仿粗体）, fauxItalic?:bool（仿斜体，右倾 12°）, antialias?:"none|sharp|crisp|strong|smooth|windowsLcd|windows", coalesce?} 改整层的字型／样式／字号／颜色／对齐／字距／仿粗体／消除锯齿'}, p => {
  const L = textLayer(p.layerId); if (!L) return {ok:false, error:'not a text layer'};
  historyStep(p.coalesce);
  const d = L.data;
  if (p.font) d.font = String(p.font);
  if (p.weight !== undefined) d.weight = String(p.weight);
  else if (p.fontStyle) d.weight = styleToWeight(p.fontStyle);
  if (+p.size > 0) d.size = +p.size;
  if (p.color) d.color = String(p.color);
  if (ALIGNS.includes(p.align)) d.align = p.align;
  // type_cmds.rs:140 tracking（1/1000 em，-1000..10000；画由 menus/impl/ai-type.js 接手）、:168 fauxBold／fauxItalic（画由 ps-type.js 接手）
  if (p.tracking !== undefined && isFinite(+p.tracking)){ const v = Math.max(-1000, Math.min(10000, +p.tracking)); if (v) d.tracking = v; else delete d.tracking; }
  if (typeof p.fauxBold === 'boolean'){ if (p.fauxBold) d.fauxBold = true; else delete d.fauxBold; }
  if (typeof p.fauxItalic === 'boolean'){ if (p.fauxItalic) d.fauxItalic = true; else delete d.fauxItalic; }
  if (typeof p.antialias === 'string' && /^(none|sharp|crisp|strong|smooth|windowsLcd|windows)$/.test(p.antialias)) d.antialias = p.antialias;   // type_tool.rs:740 选项栏改消除锯齿
  if (d.box) placeInBox(d);                     // 段落文字：锚点与第一条基线跟着框重算
  Layer.invalidate(L);
  return info(L);
});

/* type_cmds.rs:417 type.info */
CMD.reg('text.info', {i18n:'', params:'{layerId?} 文字层资讯：text、样式、box、排好的每一行 {start,end,baseline,x0,x1}（文件坐标）、外框'}, p => {
  const L = textLayer(p.layerId); return L ? info(L) : {ok:false, error:'not a text layer'};
});
/* type.fonts */
CMD.reg('text.fonts', {i18n:'', params:'{} 这台机器上可用的字型家族（含 sans-serif/serif/monospace）与样式名'}, () => ({families:families(), styles:STYLES.slice()}));

/* 编辑阶段的命令（type_tool.rs commit / cancel；vectorcraft text.rs set_option select / selectAll） */
CMD.reg('text.commit', {i18n:'', params:'{} 结束目前的文字编辑：新建的层若留空就删掉，否则以内文第一行命名（同 Esc／Ctrl+Enter／选项栏 ✓）'}, () => {
  const had = !!TT.ed; TT.commit(); return {ok:had};
});
CMD.reg('text.cancel', {i18n:'', params:'{} 取消目前的文字编辑：把这段编辑整步退掉（新建的层就没了）（同选项栏 ⊘）'}, () => {
  const had = !!TT.ed; TT.cancel(); return {ok:had};
});
CMD.reg('text.select', {i18n:'', params:'{start?, end?, all?:bool, layerId?} 编辑中设定选取范围（字元索引）；没在编辑而给了 layerId（或当前层是文字层）就先进入编辑 → {caret, anchor}'}, p => {
  if (!TT.ed){
    const L = textLayer(p.layerId); if (!L) return {ok:false, error:'not editing'};
    Doc.activeId = L.id;
    TT.begin({layer:L.id, caret:0, anchor:0, session:TT.newKey(), created:false, dragging:false, preedit:null});
  }
  const L = TT.layer(); if (!L) return {ok:false, error:'not editing'};
  const n = chars(L.data.text).length;
  if (p.all){ TT.ed.anchor = 0; TT.ed.caret = n; }
  else {
    const a = clamp(+p.start || 0, 0, n), b = p.end == null ? a : clamp(+p.end, 0, n);
    TT.ed.anchor = a; TT.ed.caret = b;
  }
  return {caret:TT.ed.caret, anchor:TT.ed.anchor};
});

/* ═══════════════ 工具本体 ═══════════════ */
let _keyN = 0;
const TT = window.TypeTool = {
  /* state.rs:494 TextEdit：{layer, caret, anchor, session, created, dragging, preedit:[start,len]|null} */
  ed: null,
  press: null,                 // 没被文字吃掉的按下点（要拖框／点出新字）
  clicks: {pos:null, n:0, t:0},
  opt: {font:'sans-serif', style:'Regular', align:'left'},   // state.rs:427 type_font／type_style／type_align（字号用 ToolState.fontSize）
  timer: null, ta: null, _pending: false,
  layout, hitLayer, hitOffset, wordBoundary, paragraphAt, styleToWeight, weightToStyle,
  wrapLines, wrapRanges, placeInBox,       // engine.js renderLayer 用 wrapLines(d) 决定画哪几行（跟上面的版面同一套折行）

  newKey(){ return 'type-' + (++_keyN) + '-' + Date.now(); },          // type_tool.rs:188 session_key
  layer(){ const ed = this.ed; if (!ed) return null; const L = Doc.byId(ed.layer); return L && L.kind === 'text' ? L : null; },
  text(){ const L = this.layer(); return L ? L.data.text : null; },

  /* ── 隐藏的输入框：收键盘、IME 组字、贴上（type_tool.rs:500「告诉作业系统插入点在哪」才叫得出输入法） ── */
  input(){
    if (this.ta) return this.ta;
    const ta = document.createElement('textarea');
    ta.id = 'textToolInput'; ta.setAttribute('autocomplete', 'off'); ta.setAttribute('autocorrect', 'off'); ta.spellcheck = false;
    ta.setAttribute('aria-hidden', 'true');
    ta.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:16px;opacity:0;padding:0;margin:0;border:0;outline:0;resize:none;overflow:hidden;pointer-events:none;white-space:pre;z-index:0';
    document.body.appendChild(ta);
    ta.addEventListener('keydown', e => {
      if (!this.ed) return;
      if (e.isComposing || e.keyCode === 229) return;                       // 组字中的键归输入法
      if (this.key(e)){ e.preventDefault(); e.stopPropagation(); UI.draw(); return; }
      const cmd = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      // 其它 ⌘ 快捷键（⌘Z、⌘S…）交给菜单（type_tool.rs:450）。ui.js 不收输入框里的键 ⇒ 转一颗合成键给它
      if (cmd && !['c', 'x', 'v', 'control', 'meta', 'shift', 'alt'].includes(k)){
        e.preventDefault();
        document.dispatchEvent(new KeyboardEvent('keydown', {key:e.key, code:e.code, ctrlKey:e.ctrlKey, metaKey:e.metaKey, shiftKey:e.shiftKey, altKey:e.altKey, bubbles:true, cancelable:true}));
        return;
      }
      if (e.key === 'Tab') e.preventDefault();                               // PhotoCraft 不插 Tab；也别让焦点跑掉
    });
    // Event::Text（type_tool.rs:370）
    ta.addEventListener('input', e => {
      if (!this.ed){ ta.value = ''; return; }
      if (e.isComposing || e.inputType === 'insertCompositionText') return;  // 组字走下面的 composition 事件
      if (e.inputType === 'insertText' && e.data) this.insert(e.data);
      else if (e.inputType === 'insertLineBreak') this.insert('\n');
      ta.value = ''; UI.draw();
    });
    // Event::Ime（type_tool.rs:372-374）
    ta.addEventListener('compositionupdate', e => { if (this.ed){ this.ime(e.data || '', false); UI.draw(); } });
    ta.addEventListener('compositionend', e => { if (this.ed){ this.ime(e.data || '', true); UI.draw(); } ta.value = ''; });
    // Event::Paste／Copy／Cut（type_tool.rs:370、376）
    ta.addEventListener('paste', e => {
      if (!this.ed) return;
      e.preventDefault();
      let s = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      if (!s && this.clip) s = this.clip;                                    // 系统剪贴簿读不到（无头浏览器）就用自己记的那份
      this.insert(s); UI.draw();
    });
    const copy = (e, cut) => {
      const ed = this.ed, text = this.text(); if (!ed || text == null) return;
      const a = Math.min(ed.caret, ed.anchor), b = Math.max(ed.caret, ed.anchor);
      if (a >= b) return;
      const s = chars(text).slice(a, b).join('');
      e.preventDefault();
      if (e.clipboardData) e.clipboardData.setData('text/plain', s);
      this.clip = s;
      if (cut){ this.insert(''); UI.draw(); }
    };
    ta.addEventListener('copy', e => copy(e, false));
    ta.addEventListener('cut', e => copy(e, true));
    this.ta = ta; return ta;
  },
  clip: '',
  focus(){ if (this.ed){ const ta = this.input(); if (document.activeElement !== ta) ta.focus({preventScroll:true}); } },
  /* 把输入框摆到插入点上（输入法候选窗才会出现在字旁边） */
  placeIme(x, top, bot){
    const ta = this.ta; if (!ta || !UI.canvas) return;
    const r = UI.canvas.getBoundingClientRect(), z = zoom();
    ta.style.left = (r.left + x * z) + 'px'; ta.style.top = (r.top + top * z) + 'px';
    ta.style.height = Math.max(8, (bot - top) * z) + 'px'; ta.style.fontSize = Math.max(8, (bot - top) * z * 0.8) + 'px';
  },

  /* ── 进入／离开编辑 ── */
  begin(ed){
    this.ed = Object.assign({preedit:null, dragging:false}, ed);
    this._pending = false;
    if (!this.timer) this.timer = setInterval(() => { if (this.ed && ToolState.cur === 'text' && !Pointer.down) UI.draw(); }, BLINK_MS);
    this.focus();
    if (ToolState.cur === 'text') UI.buildOptions('text');
  },
  end(){
    this.ed = null; this._pending = false;
    if (this.timer){ clearInterval(this.timer); this.timer = null; }
    if (this.ta){ this.ta.value = ''; if (document.activeElement === this.ta) this.ta.blur(); }
    if (window.UI && ToolState.cur === 'text') UI.buildOptions('text');
  },

  /* type_tool.rs:473 commit —— 新建的层留空就删，新建的层以内文命名 */
  commit(){
    const ed = this.ed; if (!ed) return;
    this.end();
    const L = Doc.byId(ed.layer); if (!L || L.kind !== 'text'){ UI.draw(); return; }
    const text = L.data.text;
    if (!text.trim() && ed.created){
      // 整段编辑还是历史最上面那一步 ⇒ 连步骤一起退掉（vectorcraft text.rs:123 discardEmpty）；否则删层（type_tool.rs:477）
      if (sessionOnTop(ed.session)) CMD.run('edit.undo'); else CMD.run('layer.delete', {id:ed.layer});
    } else if (ed.created){
      const name = createdName(text);
      if (name !== L.name) CMD.run('text.edit', {layerId:ed.layer, name, coalesce:ed.session});
    }
    UI.draw();
  },
  /* type_tool.rs:1263 cancel —— 这段编辑若还是历史最上面那一步就整步退掉 */
  cancel(){
    const ed = this.ed; if (!ed) return;
    this.end();
    if (sessionOnTop(ed.session)) CMD.run('edit.undo');
    UI.draw();
  },

  /* type_tool.rs:197 insert —— 用 s 换掉选取 */
  insert(s){
    const ed = this.ed; if (!ed) return;
    const a = Math.min(ed.caret, ed.anchor), b = Math.max(ed.caret, ed.anchor);
    s = normText(s);
    if (a === b && !s) return;
    const r = CMD.run('text.edit', {layerId:ed.layer, replace:{start:a, end:b, text:s}, coalesce:ed.session});
    if (r && r.ok !== false && this.ed){ this.ed.caret = a + chars(s).length; this.ed.anchor = this.ed.caret; this.syncName(); }
    this.clicks.n = 0;                                                      // vectorcraft text.rs:387 打字后连击重算
  },
  /* 新建的层打字当下就以内文命名（PS 打字时图层面板的名字跟着变），不等提交：
     图层面板／状态列／agent 读图层清单时不会还看到占位的「Lorem Ipsum」。删到全空先留原名（提交时空层整个删掉）；并进同一步历史 */
  syncName(){
    const ed = this.ed, L = this.layer(); if (!ed || !ed.created || !L) return;
    const name = createdName(L.data.text);
    if (name && name !== L.name) CMD.run('text.edit', {layerId:ed.layer, name, coalesce:ed.session});
  },
  /* type_tool.rs:226 ime_update —— 组字中的字直接写进层里（跟打字一样排版），每次更新换掉上一次的；commit 定案 */
  ime(s, commit){
    const ed = this.ed, text = this.text(); if (!ed || text == null) return;
    s = normText(s);
    if (s === '\n') return;                                                 // :372 输入法单独送的换行就是 Enter 键，由键盘那边处理
    const n = chars(text).length;
    let start, end;
    if (ed.preedit && ed.preedit[0] + ed.preedit[1] <= n){ start = ed.preedit[0]; end = start + ed.preedit[1]; }
    else { start = Math.min(ed.caret, ed.anchor, n); end = Math.min(Math.max(ed.caret, ed.anchor), n); }
    if (start === end && !s){ ed.preedit = null; return; }
    const len = chars(s).length;
    const r = CMD.run('text.edit', {layerId:ed.layer, replace:{start, end, text:s}, coalesce:ed.session});
    if (r && r.ok !== false && this.ed){
      this.ed.caret = start + len; this.ed.anchor = this.ed.caret;
      this.ed.preedit = (commit || len === 0) ? null : [start, len];
      if (commit) this.syncName();                                          // 组字中的字还没定案，定案了才改名
    }
  },
  /* type_tool.rs:274 select_word（双击）—— 插入点两边连续的字母数字 */
  selectWord(){
    const ed = this.ed, text = this.text(); if (!ed || text == null) return;
    const cs = chars(text);
    let a = Math.min(ed.caret, cs.length), b = a;
    while (a > 0 && isAlnum(cs[a - 1])) a--;
    while (b < cs.length && isAlnum(cs[b])) b++;
    ed.anchor = a; ed.caret = b;
  },
  /* vectorcraft text.rs:205 select_word_or_para(para=true)（三连击） */
  selectPara(){
    const ed = this.ed, text = this.text(); if (!ed || text == null) return;
    const [a, b] = paragraphAt(text, ed.caret);
    ed.anchor = a; ed.caret = b;
  },
  /* type_tool.rs:292 line_step —— 上一行／下一行，保持横向位置 */
  lineStep(caret, dir){
    const L = this.layer(); if (!L) return caret;
    const lay = layout(L);
    const [x, top, bottom] = caretAt(lay, caret);
    const h = Math.max(bottom - top, 1);
    const y = dir < 0 ? top - h * 0.5 : bottom + h * 0.5;
    const [b0, b1] = lineBounds(lay);
    if (y < b0) return 0;
    if (y > b1) return lay.n;
    return hitTest(lay, x, y);
  },
  /* type_tool.rs:329 line_edge —— 插入点所在行的行首／行尾 */
  lineEdge(caret, end){
    const L = this.layer(); if (!L) return caret;
    const lay = layout(L), l = lineOf(lay, caret);
    return end ? l.end : l.start;
  },

  /* type_tool.rs:338 handle_keys 的「Key」那一支 —— 回 true＝吃掉 */
  key(e){
    const ed = this.ed; if (!ed) return false;
    const text = this.text();
    if (text == null){ this.end(); return false; }                         // :341 层不见了（被还原掉）⇒ 结束编辑
    if (KIT() && KIT().vKey(e)) return true;                               // :386 直排层：方向键／Home/End／⌘⌫ 先过 flow_key（typev.js）
    const n = chars(text).length;
    ed.caret = Math.min(ed.caret, n); ed.anchor = Math.min(ed.anchor, n);  // :345 还原可能把字变短
    const a = Math.min(ed.caret, ed.anchor), b = Math.max(ed.caret, ed.anchor);
    const cmd = e.ctrlKey || e.metaKey, alt = e.altKey, shift = e.shiftKey;
    const set = (c, extend) => { ed.caret = clamp(c, 0, n); if (!extend) ed.anchor = ed.caret; };
    switch (e.key){
      case 'Backspace': case 'Delete': {                                    // :388
        if (a === b){
          const fwd = e.key === 'Delete';
          let to;
          if (!fwd && cmd) to = this.lineEdge(a, false);                   // ⌘⌫＝删到行首
          else if (!fwd && alt) to = wordBoundary(text, a, false);         // ⌥⌫＝删前一个词
          else if (!fwd) to = Math.max(0, a - 1);
          else if (alt) to = wordBoundary(text, a, true);                  // ⌥⌦＝删后一个词
          else to = Math.min(n, a + 1);
          if (to !== a){ ed.anchor = to; this.insert(''); }
        } else this.insert('');
        return true;
      }
      case 'ArrowLeft': case 'ArrowRight': {
        const fwd = e.key === 'ArrowRight';
        if (alt && !shift && a === b) return true;                          // :408 ⌥←/→＝字距微调（我们的文字层没有字距 ⇒ 不动）
        let to;
        if (cmd || alt) to = wordBoundary(text, ed.caret, fwd);            // :418 ⌘（或 ⌥⇧）＝按词
        else if (a !== b && !shift) to = fwd ? b : a;                       // 有选取：收到那一头
        else to = fwd ? ed.caret + 1 : Math.max(0, ed.caret - 1);
        set(to, shift); return true;
      }
      case 'ArrowUp': case 'ArrowDown': {                                   // :429
        const up = e.key === 'ArrowUp';
        const to = cmd ? (up ? 0 : n) : this.lineStep(ed.caret, up ? -1 : 1);
        set(to, shift); return true;
      }
      case 'Home': case 'End':                                              // :437
        set(this.lineEdge(ed.caret, e.key === 'End'), shift); return true;
      case 'Enter':                                                          // :441-442
        if (cmd) this.commit(); else this.insert('\n');
        return true;
      case 'Escape':                                                         // :443 PhotoCraft 的 Esc 是提交
        this.commit(); return true;
    }
    if (cmd && e.key.toLowerCase() === 'a'){ ed.anchor = 0; ed.caret = n; return true; }   // :444 ⌘A＝全选文字
    return false;
  },

  /* ── 叠画（type_tool.rs:485 draw_overlay） ── */
  draw(ctx, s){
    const ed = this.ed; if (!ed) return;
    const L = this.layer();
    if (!L){ this.end(); return; }                                          // 层被还原掉／换了文件 ⇒ 结束（不再动文件）
    // vectorcraft text.rs:493 after_command：当前层被换走（图层面板点了别层）⇒ 编辑结束
    if (Doc.activeId !== ed.layer && !this._pending){
      this._pending = true;
      setTimeout(() => { this._pending = false; if (this.ed && Doc.activeId !== this.ed.layer) this.commit(); }, 0);
    }
    if (KIT() && KIT().isV(L)) return KIT().drawVertical(ctx, s, L, ed);   // 直排层：叠画转 90°（type_tool.rs:495-571，typev.js）
    const lay = layout(L), n = lay.n;
    ed.caret = Math.min(ed.caret, n); ed.anchor = Math.min(ed.anchor, n);
    const dpr = s / zoom();
    const [cx, ctop, cbot] = caretAt(lay, ed.caret);
    this.placeIme(cx, ctop, cbot);
    ctx.save();
    // 框：段落文字画框＋八个把手；点文字每行底下一条线
    const d = L.data;
    if (d.box){
      const x0 = (d.box.x + L.x) * s, y0 = (d.box.y + L.y) * s, w = d.box.w * s, h = d.box.h * s;
      ctx.strokeStyle = ACCENT; ctx.lineWidth = dpr; ctx.strokeRect(x0, y0, w, h);
      const hw = 3.5 * dpr, pts = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h], [x0 + w / 2, y0], [x0 + w, y0 + h / 2], [x0 + w / 2, y0 + h], [x0, y0 + h / 2]];
      ctx.fillStyle = '#fff';
      pts.forEach(p => { ctx.fillRect(p[0] - hw, p[1] - hw, 2 * hw, 2 * hw); ctx.strokeRect(p[0] - hw + dpr / 2, p[1] - hw + dpr / 2, 2 * hw - dpr, 2 * hw - dpr); });
    } else {
      ctx.strokeStyle = ACCENT; ctx.globalAlpha = 0.8; ctx.lineWidth = dpr; ctx.beginPath();
      for (const l of lay.lines){
        const y = (l.baseline + l.descent * 0.25) * s;
        ctx.moveTo(Math.min(l.x0, lay.anchor[0]) * s, y); ctx.lineTo(Math.max(l.x1, l.x0 + 1) * s, y);
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    // 组字中（还没定案）的字底下画粗线
    if (ed.preedit){
      const [ps, pl] = ed.preedit;
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5 * dpr; ctx.beginPath();
      for (const l of lay.lines){
        const lo = Math.max(ps, l.start), hi = Math.min(ps + pl, l.end);
        if (lo >= hi) continue;
        const y = (l.baseline + l.descent * 0.5) * s;
        ctx.moveTo(l.xs[lo - l.start] * s, y); ctx.lineTo(l.xs[hi - l.start] * s, y);
      }
      ctx.stroke();
    }
    const a = Math.min(ed.caret, ed.anchor), b = Math.max(ed.caret, ed.anchor);
    if (a < b){
      // 选取：每行把 [a,b) 里的字涂底；选到换行就在行尾多一小截
      ctx.fillStyle = 'rgba(47,127,216,' + (110 / 255).toFixed(3) + ')';
      for (const l of lay.lines){
        let x0 = Infinity, x1 = -Infinity;
        const lo = Math.max(a, l.start), hi = Math.min(b, l.end);
        if (lo < hi){ x0 = l.xs[lo - l.start]; x1 = l.xs[hi - l.start]; }
        if (b > l.end && a <= l.end){ x1 = Math.max(x1, l.x1 + (l.ascent + l.descent) * 0.25); x0 = Math.min(x0, l.x1); }
        if (x0 < x1) ctx.fillRect(x0 * s, (l.baseline - l.ascent) * s, (x1 - x0) * s, (l.ascent + l.descent) * s);
      }
    } else if (ed.dragging || Math.floor(performance.now() / BLINK_MS) % 2 === 0){
      // 闪烁的插入点（拖选时常亮）：白 1.5 底、黑 0.75 上
      const X = Math.round(cx * s) + 0.5;
      ctx.beginPath(); ctx.moveTo(X, ctop * s); ctx.lineTo(X, cbot * s);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 0.75 * dpr; ctx.stroke();
    }
    ctx.restore();
  },

  /* type_tool.rs:640 target —— 选项栏改的是哪一层：编辑中的那层，否则当前层（若是文字层） */
  target(){ if (this.ed) return this.ed.layer; const L = Doc.active(); return L && L.kind === 'text' ? L.id : null; },
  /* type_tool.rs:670 apply —— 套到目标层（编辑中就并进同一步历史） */
  apply(props){
    const id = this.target(); if (!id) return;
    const p = Object.assign({layerId:id}, props);
    if (this.ed) p.coalesce = this.ed.session;
    CMD.run('text.setStyle', p);
    this.focus(); UI.draw();
  }
};

const AA_KEYS = ['none', 'sharp', 'crisp', 'strong', 'smooth', 'windowsLcd', 'windows'];
const STRINGS = {
  'zh-Hant':{'opt.font':'字體', 'opt.style':'樣式', 'opt.color':'顏色', 'opt.textAA':'ªa', 'ui.textAA':'設定消除鋸齒方法',
    'ui.textAA.none':'無', 'ui.textAA.sharp':'銳利', 'ui.textAA.crisp':'鮮明', 'ui.textAA.strong':'強烈', 'ui.textAA.smooth':'平滑', 'ui.textAA.windowsLcd':'Windows LCD', 'ui.textAA.windows':'Windows',
    'ui.textAlignLeft':'文字靠左', 'ui.textAlignCenter':'文字置中', 'ui.textAlignRight':'文字靠右',
    'ui.textCommit':'確定目前的編輯 (Ctrl+Enter)', 'ui.textCancel':'取消目前的編輯',
    'ui.textHint':'點一下＝點文字 · 拖框＝段落文字 · 點進文字放插入點、拖曳選取、Shift 點延伸 · 雙擊選字、三連擊選段落 · Esc／Ctrl+Enter 確定',
    'ui.fs.Thin':'極細', 'ui.fs.Light':'細', 'ui.fs.Regular':'標準', 'ui.fs.Italic':'斜體', 'ui.fs.Medium':'中等', 'ui.fs.SemiBold':'半粗',
    'ui.fs.Bold':'粗體', 'ui.fs.Bold Italic':'粗斜體', 'ui.fs.ExtraBold':'特粗', 'ui.fs.Black':'極粗'},
  'zh-Hans':{'opt.font':'字体', 'opt.style':'样式', 'opt.color':'颜色', 'opt.textAA':'ªa', 'ui.textAA':'设置消除锯齿的方法',
    'ui.textAA.none':'无', 'ui.textAA.sharp':'锐利', 'ui.textAA.crisp':'犀利', 'ui.textAA.strong':'浑厚', 'ui.textAA.smooth':'平滑', 'ui.textAA.windowsLcd':'Windows LCD', 'ui.textAA.windows':'Windows',
    'ui.textAlignLeft':'左对齐文本', 'ui.textAlignCenter':'居中对齐文本', 'ui.textAlignRight':'右对齐文本',
    'ui.textCommit':'提交当前编辑 (Ctrl+Enter)', 'ui.textCancel':'取消当前编辑',
    'ui.textHint':'点一下＝点文字 · 拖框＝段落文字 · 点进文字放插入点、拖动选取、Shift 点延伸 · 双击选词、三连击选段落 · Esc／Ctrl+Enter 提交',
    'ui.fs.Thin':'极细', 'ui.fs.Light':'细', 'ui.fs.Regular':'常规', 'ui.fs.Italic':'斜体', 'ui.fs.Medium':'中等', 'ui.fs.SemiBold':'半粗',
    'ui.fs.Bold':'粗体', 'ui.fs.Bold Italic':'粗斜体', 'ui.fs.ExtraBold':'特粗', 'ui.fs.Black':'极粗'},
  'en':{'opt.font':'Font', 'opt.style':'Style', 'opt.color':'Color', 'opt.textAA':'ªa', 'ui.textAA':'Set the anti-aliasing method',
    'ui.textAA.none':'None', 'ui.textAA.sharp':'Sharp', 'ui.textAA.crisp':'Crisp', 'ui.textAA.strong':'Strong', 'ui.textAA.smooth':'Smooth', 'ui.textAA.windowsLcd':'Windows LCD', 'ui.textAA.windows':'Windows',
    'ui.textAlignLeft':'Left align text', 'ui.textAlignCenter':'Center text', 'ui.textAlignRight':'Right align text',
    'ui.textCommit':'Commit any current edits (Ctrl+Enter)', 'ui.textCancel':'Cancel any current edits',
    'ui.textHint':'Click: point text · drag: paragraph text · click into text for a caret, drag to select, Shift-click extends · double-click a word, triple-click a paragraph · Esc / Ctrl+Enter commits',
    'ui.fs.Thin':'Thin', 'ui.fs.Light':'Light', 'ui.fs.Regular':'Regular', 'ui.fs.Italic':'Italic', 'ui.fs.Medium':'Medium', 'ui.fs.SemiBold':'SemiBold',
    'ui.fs.Bold':'Bold', 'ui.fs.Bold Italic':'Bold Italic', 'ui.fs.ExtraBold':'ExtraBold', 'ui.fs.Black':'Black'}
};

/* 对齐钮的小图（type_tool.rs:928 align_glyph：四条线，长短与位置表示对齐方式） */
function alignIcon(a){
  const W = [1, 0.62, 1, 0.62], full = 12;
  return `<svg width="14" height="12" viewBox="0 0 14 12" style="vertical-align:middle">` + W.map((w, i) => {
    const len = full * w, x0 = a === 'left' ? 1 : a === 'center' ? 1 + (full - len) / 2 : 1 + full - len, y = 1.5 + i * 3;
    return `<line x1="${x0}" y1="${y}" x2="${x0 + len}" y2="${y}" stroke="currentColor" stroke-width="1.5"/>`;
  }).join('') + `</svg>`;
}

Tools.reg({
  id:'text', icon:'T', key:'T', group:'misc', order:10, for:'common', needs:'text', opts:[], cursor:'text',
  strings:STRINGS,

  /* type_tool.rs:113 pointer_down —— 回 true（被吃掉）就不拖框 */
  onDown(e, pt, P){
    const [x, y] = pt;
    TT.press = null;
    if (TT.ed){
      const id = TT.ed.layer;
      if (toolHitLayer(x, y, id) === id){
        const off = toolHitOffset(id, x, y);
        // vectorcraft text.rs:321 连击计数：同一点 4 萤幕像素内再按＝第 n 下
        const c = TT.clicks, now = performance.now();
        const same = c.pos && Math.hypot(c.pos[0] - x, c.pos[1] - y) * zoom() <= SAME_CLICK_PX && now - c.t < 600;
        const nClicks = same ? c.n + 1 : 1;
        TT.clicks = {pos:[x, y], n:nClicks, t:now};
        TT.ed.caret = off;
        if (!e.shiftKey) TT.ed.anchor = off;
        TT.ed.dragging = true;
        if (nClicks >= 3){ TT.selectPara(); TT.clicks.n = 0; TT.ed.dragging = false; }   // 三连击＝选段落
        UI.draw(); return;
      }
      TT.commit();                                // :127 PS：点在外面＝提交，不另起新字
      return;
    }
    const id = toolHitLayer(x, y);
    if (id){                                      // :130 点进一层现有文字 ⇒ 选那层、放插入点、开始编辑
      if (window.Locks && Locks.deny(Doc.byId(id), 'pixels')) return;   // 锁像素／全锁的文字层不能改字（提示一句，不进编辑）
      CMD.run('layer.select', {id});
      const off = toolHitOffset(id, x, y);
      TT.clicks = {pos:[x, y], n:1, t:performance.now()};
      TT.begin({layer:id, caret:off, anchor:off, session:TT.newKey(), created:false, dragging:true});
      UI.draw(); return;
    }
    TT.press = pt.slice();                        // 没吃掉：等放开决定是点文字还是段落框
  },
  /* type_tool.rs:141 pointer_move —— 拖选；没在编辑就画拖框预览（vectorcraft text.rs:554 Marquee） */
  onMove(e, pt, P){
    if (!P.down) return;
    if (TT.ed && TT.ed.dragging){
      TT.ed.caret = toolHitOffset(TT.ed.layer, pt[0], pt[1]);
      if (Math.hypot(pt[0] - P.start[0], pt[1] - P.start[1]) * zoom() > SAME_CLICK_PX) TT.clicks.n = 0;   // text.rs:344 拖了就不算连击
      UI.draw(); return;
    }
    if (TT.press){ P.preview = {a:TT.press, b:pt}; UI.draw(); }
  },
  /* type_tool.rs:152 pointer_up —— 编辑中只是结束拖选；否则在按下点建字（拖够大＝段落框） */
  onUp(e, pt, P){
    if (TT.ed){ TT.ed.dragging = false; TT.focus(); UI.draw(); return; }
    const start = TT.press; TT.press = null;
    if (!start){ UI.draw(); return; }             // 这次按下被吃掉了（例如点外面提交）
    const w = Math.abs(pt[0] - start[0]), h = Math.abs(pt[1] - start[1]);
    const min = MIN_BOX_PX / zoom();
    const key = TT.newKey();
    const p = {text:PLACEHOLDER, font:TT.opt.font, fontStyle:TT.opt.style, size:ToolState.fontSize, align:TT.opt.align, color:UI.fill(), coalesce:key};
    if (w >= min && h >= min) p.box = [rround(Math.min(start[0], pt[0])), rround(Math.min(start[1], pt[1])), rround(w), rround(h)];
    else { p.x = rround(start[0]); p.y = rround(start[1]); }
    const r = CMD.run('text.create', p);
    if (r && r.id && TT.opt.antialias && TT.opt.antialias !== 'smooth') CMD.run('text.setStyle', {layerId:r.id, antialias:TT.opt.antialias, coalesce:key});   // type_tool.rs:729 选项栏的消除锯齿＝新字也用
    if (r && r.id){
      // PS：占位文字整段选取，一打字就换掉
      TT.begin({layer:r.id, caret:chars(PLACEHOLDER).length, anchor:0, session:key, created:true, dragging:false});
    }
    UI.draw();
  },
  /* canvas.rs:1559 双击＝选词 */
  onDblClick(e, pt){
    if (!TT.ed || toolHitLayer(pt[0], pt[1], TT.ed.layer) !== TT.ed.layer) return;
    TT.selectWord();
    TT.clicks = {pos:pt.slice(), n:2, t:performance.now()};
    UI.draw();
  },
  /* 焦点不在隐藏输入框时（例如点过面板）键从 ui.js 进来：一样照 handle_keys 处理，并把焦点拉回来 */
  onKey(e){
    if (!TT.ed || !e.isTrusted) return false;    // 自己转给菜单的合成键不要再吃回来
    if (TT.key(e)){ e.preventDefault(); UI.draw(); TT.focus(); return true; }
    if (e.ctrlKey || e.metaKey) return false;     // ⌘ 快捷键交给菜单
    if (e.key.length === 1){ e.preventDefault(); TT.insert(e.key); UI.draw(); TT.focus(); return true; }
    return true;                                  // :336 编辑中单键不切工具
  },
  onDeactivate(){ TT.commit(); TT.press = null; },   // lib.rs:790 换工具＝提交
  drawOverlay(ctx, s){ TT.draw(ctx, s); },
  /* type_tool.rs:684 options_bar：字体 · 样式 · 字号 · 对齐三钮 · 颜色 ·（编辑中）✓ ⊘ */
  buildOptions(box, add, mk){
    // 显示目标层的样式，否则工具预设（:687 shown）
    const L = TT.target() ? Doc.byId(TT.target()) : null, d = L && L.data;
    const fam = d ? d.font : TT.opt.font, style = d ? weightToStyle(d.weight) : TT.opt.style;
    const size = d ? d.size : ToolState.fontSize, align = d ? d.align : TT.opt.align, color = d ? d.color : UI.fill();

    const f = mk('text', {value:fam}); f.style.width = '130px'; f.dataset.textOpt = 'font';
    const dl = document.createElement('datalist'); dl.id = 'textFontList';
    dl.innerHTML = families().map(x => `<option value="${x.replace(/"/g, '&quot;')}"></option>`).join('');
    f.setAttribute('list', 'textFontList');
    f.onchange = () => { const v = f.value.trim(); if (!v) return; TT.opt.font = v; TT.apply({font:v, fontStyle:TT.opt.style}); };
    add('font', f); box.appendChild(dl);

    const st = document.createElement('select'); st.dataset.textOpt = 'style';
    st.innerHTML = STYLES.map(x => `<option value="${x}"${x === style ? ' selected' : ''}>${Lang.t('ui.fs.' + x)}</option>`).join('');
    if (!STYLES.includes(style)){ const o = document.createElement('option'); o.value = style; o.textContent = style; o.selected = true; st.appendChild(o); }
    st.onchange = () => { TT.opt.style = st.value; TT.apply({fontStyle:st.value}); };
    add('style', st);

    const n = mk('number', {min:1, max:1296, value:Math.round(size * 100) / 100}); n.style.width = '64px'; n.dataset.textOpt = 'size';
    n.onchange = () => { const v = +n.value; if (!(v > 0)) return; ToolState.fontSize = v; TT.apply({size:v}); };
    add('fontSize', n);

    // type_tool.rs:729 消除锯齿下拉（无／锐利／犀利／浑厚／平滑…）：有目标层＝改那层，否则记成新字的预设
    const aaNow = d ? (d.antialias || 'smooth') : (TT.opt.antialias || 'smooth');
    const aa = document.createElement('select'); aa.dataset.textOpt = 'antialias'; aa.title = Lang.t('ui.textAA');
    aa.innerHTML = AA_KEYS.map(k => `<option value="${k}"${k === aaNow ? ' selected' : ''}>${Lang.t('ui.textAA.' + k)}</option>`).join('');
    aa.onchange = () => { TT.opt.antialias = aa.value; TT.apply({antialias:aa.value}); };
    add('textAA', aa);

    const sep = () => { const x = document.createElement('span'); x.style.cssText = 'display:inline-block;width:1px;height:18px;background:#555;margin:0 6px;vertical-align:middle'; box.appendChild(x); };
    sep();
    [['left', 'ui.textAlignLeft'], ['center', 'ui.textAlignCenter'], ['right', 'ui.textAlignRight']].forEach(([a, tip]) => {
      const b = document.createElement('button'); b.type = 'button'; b.innerHTML = alignIcon(a); b.title = Lang.t(tip);
      b.dataset.textAlign = a;
      b.style.cssText = 'margin:0 1px;min-width:26px;cursor:pointer' + (a === align ? ';outline:1px solid ' + ACCENT : '');
      b.onclick = () => { TT.opt.align = a; TT.apply({align:a}); UI.buildOptions('text'); };
      box.appendChild(b);
    });
    sep();
    const c = mk('color', {value:/^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'}); c.dataset.textOpt = 'color';
    c.onchange = () => TT.apply({color:c.value});
    add('color', c);

    if (TT.ed){
      const btn = (txt, tip, cmd) => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.title = Lang.t(tip);
        b.dataset.textCmd = cmd; b.style.cssText = 'margin:0 2px;min-width:26px;cursor:pointer';
        b.onclick = () => CMD.run(cmd); box.appendChild(b);
      };
      btn('✓', 'ui.textCommit', 'text.commit');
      btn('⊘', 'ui.textCancel', 'text.cancel');
    }
    const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t('ui.textHint'); box.appendChild(h);
  }
});

})();
