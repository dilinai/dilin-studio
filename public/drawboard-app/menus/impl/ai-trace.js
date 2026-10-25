/* 堤麟画板 · 视窗 ▸ 图像描摹面板（aiImageTrace）＋ 描摹成「新矢量层」的命令（window.AiTrace）
   描摹引擎不在这支档：menus/impl/ai-object.js（「对象 ▸ 图像描摹」那段，约 4587-5102 行）已照原码抄好
     trace/src/lib.rs 1-328、quantize.rs 1-339、contour.rs 1-185、fit.rs 1-156 ⇒ 命令 ai.imageTrace.make／makeAndExpand／presets／release／expand。
   这支档照原码补的：
     ui-egui/src/panels/image_trace.rs 1-164   面板栏位：预设（:78-86 换预设＝参数整份换掉）、模式（:87-97）、阈值／颜色（灰度叫「灰阶」）滑杆（:98-110，放开才算）、
                                               高级（:112-146：路径、边角、杂色、方法 邻接／重叠、贴齐曲线到直线、忽略白色）、结果「路径／锚点／颜色」（:148-150）、
                                               描摹钮＋扩展钮（:151-159）；选中描摹物件时改设定＝立刻重描（:160-162，一次改动一步历史）。
     ui-egui/src/panels/image_trace.rs 166-178 面板菜单：释放、扩展、重设为默认值。
     engine/src/cmd/buildcmds.rs 118-157, 631-641  命令参数（preset＋params 覆写）、presets 列表。
   我们加的（这个面板像素层／矢量层都能用）：
     ■ 「来源」下拉＝文件里所有像素层（缺省：现用层是像素层就它，否则最上面的像素层）。
     ■ 描摹钮＝ai.imageTrace.trace：在来源层正上方开一个「新」矢量层（layer.newVector）放结果；缺省 expand:true＝直接是一般路径（bezier／有洞的是 compound），
       来源像素层原样留着、不藏；expand:false＝留成可重描的描摹物件（原码行为：来源层藏起来，释放才放回来）。region＝只描文件坐标里的一块。
     ■ 整个描摹＝一步历史（本命令 undoable；里面的子步骤直接叫 CMD.map[..].run，不再各自进历史）。 */
(function(){
'use strict';
if (window.AiTrace && AiTrace.__loaded) return;
if (!window.DlPanels || !window.CMD){ console.warn('[ai-trace] 需要 menus/impl/panels.js 与 engine.js 的 CMD'); return; }
const P = window.DlPanels, el = P.el.bind(P), T = P.t;
const L3 = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, en:c});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clone = v => JSON.parse(JSON.stringify(v));
const err = (c, m) => ({ok:false, error:`${c}: ${m}`});
const LT = (k, fb) => { const v = window.Lang ? Lang.t(k) : k; return v && v !== k ? v : fb; };
const has = id => !!CMD.map[id];
const TRACE_NAME = 'Image Trace';
const AiTrace = window.AiTrace = {__loaded:true};

/* ═════ 来源像素层 ═════ */
function rasters(){ return Doc.layers.filter(L => L.kind === 'raster').slice().reverse(); }     // 由上到下
function defaultSource(){ const A = Doc.active && Doc.active(); if (A && A.kind === 'raster') return A; return rasters()[0] || null; }
function presets(){ const r = has('ai.imageTrace.presets') ? CMD.map['ai.imageTrace.presets'].run({}) : null; return (r && r.presets) || []; }
const presetParams = n => { const p = presets().find(x => x.name === n); return p ? clone(p.params) : null; };

/* 选中的描摹物件（矢量层里 name='Image Trace' 且带 trace 的编组） */
const isTraceGroup = s => !!s && s.type === 'group' && s.name === TRACE_NAME && !!s.trace && Array.isArray(s.children);
function selectedTrace(){
  const V = window.VecSel && VecSel.layer && VecSel.layer();
  if (!V || V.kind !== 'vector') return null;
  const s = V.data.shapes.find(x => VecSel.shapes.includes(x.id) && isTraceGroup(x));
  return s ? {L:V, s} : null;
}

/* ═════ 描摹成新矢量层 ═════ */
function traceToLayer(p){
  const C = 'ai.imageTrace.trace';
  if (!has('ai.imageTrace.make')) return err(C, 'trace engine missing (menus/impl/ai-object.js)');
  p = p || {};
  const src = p.sourceLayerId !== undefined && p.sourceLayerId !== null ? Doc.byId(p.sourceLayerId) : defaultSource();
  if (!src) return err(C, p.sourceLayerId ? `no layer \`${p.sourceLayerId}\`` : 'the document has no raster layer to trace');
  if (src.kind !== 'raster') return err(C, `layer \`${src.id}\` is not a raster layer`);
  let expand = p.expand !== false;
  // region：文件坐标 {x,y,w,h} ⇒ 切一块暂用像素层来描（描完删掉；只能扩展）
  let R = src, tmp = null;
  if (p.region){
    const g = p.region, cw = src.data.canvas.width, ch = src.data.canvas.height;
    const x0 = clamp(Math.floor(+g.x - src.x), 0, cw), y0 = clamp(Math.floor(+g.y - src.y), 0, ch);
    const x1 = clamp(Math.ceil(+g.x + +g.w - src.x), 0, cw), y1 = clamp(Math.ceil(+g.y + +g.h - src.y), 0, ch);
    if (!(x1 > x0 && y1 > y0)) return err(C, 'region is empty or outside the source layer');
    tmp = Layer.raster('__trace_region', x1 - x0, y1 - y0);
    tmp.data.ctx.drawImage(src.data.canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
    tmp.x = src.x + x0; tmp.y = src.y + y0; tmp.parent = src.parent || null;
    R = tmp; expand = true;
  }
  const wasVisible = src.visible;
  // 新矢量层（layer.newVector），搬到来源层正上方、同一个父组
  const nv = CMD.map['layer.newVector'].run({name:p.name || LT('ai3t.traceLayer', 'Image Trace')});
  const V = Doc.byId(nv && nv.id); if (!V) return err(C, 'could not create the vector layer');
  Doc.layers.splice(Doc.index(V.id), 1);
  V.parent = src.parent || null;
  Doc.layers.splice(Doc.index(src.id) + 1, 0, V);
  if (tmp) Doc.layers.splice(Doc.index(V.id), 0, tmp);              // 暂用层夹在来源与新层之间 ⇒ 引擎的 destAbove 挑到 V
  const q = {image:R.id};
  if (p.preset !== undefined) q.preset = p.preset;
  if (p.params !== undefined) q.params = p.params;
  const r = CMD.map['ai.imageTrace.make'].run(q);
  if (tmp){ const i = Doc.index(tmp.id); if (i >= 0) Doc.layers.splice(i, 1); }
  if (!r || r.ok === false) return Object.assign({}, r || {ok:false}, {error:((r && r.error) || 'trace failed').replace('ai.imageTrace.make', C)});   // 外层回滚
  if (r.layerId !== V.id) return err(C, 'trace result landed in an unexpected layer');
  let ids = [r.id];
  if (expand){
    const i = V.data.shapes.findIndex(s => s.id === r.id), g = V.data.shapes[i];
    V.data.shapes.splice(i, 1, ...g.children); ids = g.children.map(s => s.id);
    src.visible = wasVisible;                                        // 来源层原样留着
  }
  Layer.invalidate(V); Layer.invalidate(src);
  Doc.activeId = V.id;
  if (window.VecSel && VecSel.setShapes) VecSel.setShapes(V.id, ids);
  const out = {ok:true, layerId:V.id, sourceLayerId:src.id, paths:r.paths, anchors:r.anchors, colors:r.colors, ids:ids.length > 200 ? ids.slice(0, 200) : ids};
  if (ids.length > 200) out.idsTruncated = true;                     // 照片级描摹会有上千条路径：回传只给前 200 个 id
  if (!expand) out.id = r.id;
  return out;
}

const PARAMS_DOC = 'params?: {mode:"blackAndWhite"|"grayscale"|"color", threshold:0-255, colors:2-256, paths:0-100, corners:0-100, noise:像素, method:"abutting"|"overlapping", ignoreWhite, snapCurvesToLines}（覆写预设）';
CMD.reg('ai.imageTrace.sources', {i18n:'', params:'{} 能描摹的来源＝文件里的像素层（由上到下）→ {ok, layers:[{id, name}], default:缺省来源 id（现用层是像素层就它，否则最上面的像素层）|null}'}, () => {
  const d = defaultSource();
  return {ok:true, layers:rasters().map(L => ({id:L.id, name:L.name})), default:d ? d.id : null};
});
CMD.reg('ai.imageTrace.trace', {i18n:'', undoable:true, params:`{sourceLayerId?: 像素层 id（缺省见 ai.imageTrace.sources）, preset?: 预设名（ai.imageTrace.presets；缺省 Default）, ${PARAMS_DOC}, region?: {x,y,w,h} 文件坐标（只描这一块；一定扩展）, expand?: bool=true（false＝留成可重描的 Image Trace 描摹物件、来源层藏起来＝原码 imageTrace.make）, name?: 新层名} 视窗 ▸ 图像描摹 ▸ 描摹：在来源像素层正上方开一个新矢量层放描摹结果（有洞的是 compound 复合路径）；不管现用层是哪种都能用；一步历史 → {ok, layerId, sourceLayerId, paths, anchors, colors, ids（最多 200 个，多了带 idsTruncated:true）, id?（expand:false 时的描摹物件 id）}`}, traceToLayer);

Object.assign(AiTrace, {
  presets, sources:() => CMD.map['ai.imageTrace.sources'].run({}), defaultSource, selectedTrace,
  trace:p => CMD.run('ai.imageTrace.trace', p || {})
});

/* ═════ 面板（image_trace.rs） ═════ */
const MODES = [['blackAndWhite', L3('黑白', '黑白', 'Black and White')], ['grayscale', L3('灰階', '灰度', 'Grayscale')], ['color', L3('彩色', '颜色', 'Color')]];
const ST = AiTrace.panel = {preset:'Default', params:null, info:null, source:null, advOpen:true, synced:null};
function ensure(){ if (!ST.params){ ST.preset = 'Default'; ST.params = presetParams('Default') || {mode:'blackAndWhite', threshold:128, colors:6, paths:50, corners:75, noise:25, method:'abutting', ignoreWhite:false, snapCurvesToLines:false}; } }
const run = (id, q) => { let r; try { r = CMD.run(id, q); } catch(e){ r = {ok:false, error:String(e && e.message || e)}; } if (r && r.ok === false) console.warn('[ai-trace]', id, r.error); return r; };
const setInfo = r => { if (r && r.ok !== false && r.paths !== undefined) ST.info = [r.paths, r.anchors, r.colors]; else if (r && r.ok === false) ST.info = {error:r.error}; };
/* 描摹钮：选中描摹物件＝重描它（原码）；否则＝从来源层描成新矢量层 */
function doTrace(){
  ensure();
  const preset = ST.preset === 'Custom' ? 'Default' : ST.preset, t = selectedTrace();
  const r = t ? run('ai.imageTrace.make', {id:t.s.id, preset, params:clone(ST.params)})
              : run('ai.imageTrace.trace', {sourceLayerId:ST.source || undefined, preset, params:clone(ST.params)});
  setInfo(r); P.refresh('aiImageTrace'); return r;
}
/* 改了设定：选中描摹物件才重描（image_trace.rs:160） */
function changed(retrace){ if (retrace && selectedTrace()) doTrace(); else P.refresh('aiImageTrace'); }
AiTrace.panelTrace = doTrace;

function slider(k, label, min, max, suffix){
  const v = Math.round(+ST.params[k] || 0);
  const out = el('span', {text:v + (suffix || ''), style:'min-width:38px;text-align:right;font-variant-numeric:tabular-nums'});
  const r = el('input', {type:'range', min, max, step:1, dataset:{k}});
  r.value = v;
  r.addEventListener('input', () => { ST.params[k] = +r.value; ST.preset = 'Custom'; out.textContent = r.value + (suffix || ''); });
  r.addEventListener('change', () => { ST.params[k] = +r.value; ST.preset = 'Custom'; changed(true); });       // 放开才算（slider drag_stopped）
  return el('div', {class:'row'}, [el('span', {text:T(label)}), r, out]);
}

function refresh(b){
  if (P.typing(b)) return;
  ensure();
  const t = selectedTrace();
  // 选中的描摹物件换了 ⇒ 面板换成它存的设定（image_trace.rs:71-75）
  if (t && ST.synced !== t.s.id){ ST.synced = t.s.id; ST.preset = t.s.trace.preset || 'Custom'; ST.params = Object.assign(clone(ST.params), clone(t.s.trace.params || {})); }
  if (!t) ST.synced = null;
  const all = presets(), srcs = rasters();
  if (!ST.source || !srcs.some(L => L.id === ST.source)){ const d = defaultSource(); ST.source = d ? d.id : null; }
  b.innerHTML = '';
  // 来源（我们加的）
  const src = el('select', {dataset:{k:'source'}, style:'flex:1', disabled:!srcs.length});
  if (!srcs.length) src.appendChild(el('option', {value:'', text:T(L3('（沒有像素圖層）', '（没有像素图层）', '(no raster layers)'))}));
  srcs.forEach(L => src.appendChild(el('option', {value:L.id, text:L.name})));
  if (ST.source) src.value = ST.source;
  src.addEventListener('change', () => { ST.source = src.value || null; });
  b.appendChild(el('div', {class:'row'}, [el('span', {text:T(L3('來源：', '来源：', 'Source:'))}), src]));
  // 预设
  const pr = el('select', {dataset:{k:'preset'}, style:'flex:1'});
  if (ST.preset === 'Custom') pr.appendChild(el('option', {value:'Custom', text:T(L3('自訂', '自定', 'Custom'))}));
  all.forEach(x => pr.appendChild(el('option', {value:x.name, text:LT('ai3t.p.' + x.name, x.name)})));
  pr.value = ST.preset;
  pr.addEventListener('change', () => { const q = presetParams(pr.value); if (!q) return; ST.preset = pr.value; ST.params = q; changed(true); });
  b.appendChild(el('div', {class:'row'}, [el('span', {text:T(L3('預設集：', '预设：', 'Preset:'))}), pr]));
  // 模式
  const md = el('select', {dataset:{k:'mode'}, style:'flex:1'});
  MODES.forEach(([v, n]) => md.appendChild(el('option', {value:v, text:T(n)})));
  md.value = ST.params.mode;
  md.addEventListener('change', () => { ST.params.mode = md.value; ST.preset = 'Custom'; changed(true); });
  b.appendChild(el('div', {class:'row'}, [el('span', {text:T(L3('模式：', '模式：', 'Mode:'))}), md]));
  // 阈值／颜色（灰度＝灰阶）
  if (ST.params.mode === 'blackAndWhite') b.appendChild(slider('threshold', L3('臨界值', '阈值', 'Threshold'), 0, 255));
  else b.appendChild(slider('colors', ST.params.mode === 'grayscale' ? L3('灰階', '灰度', 'Grays') : L3('顏色', '颜色', 'Colors'), 2, 256));
  // 高级
  b.appendChild(el('div', {class:'sec', style:'cursor:pointer;user-select:none', dataset:{act:'advanced'}, text:(ST.advOpen ? '▾ ' : '▸ ') + T(L3('進階', '高级', 'Advanced')),
    onclick:() => { ST.advOpen = !ST.advOpen; P.refresh('aiImageTrace'); }}));
  if (ST.advOpen){
    b.appendChild(slider('paths', L3('路徑', '路径', 'Paths'), 0, 100, '%'));
    b.appendChild(slider('corners', L3('轉角', '边角', 'Corners'), 0, 100, '%'));
    b.appendChild(slider('noise', L3('雜點', '杂色', 'Noise'), 1, 100, ' px'));
    const meth = el('div', {class:'grid'}, [['abutting', L3('鄰接', '邻接', 'Abutting')], ['overlapping', L3('重疊', '重叠', 'Overlapping')]].map(([m, n]) =>
      el('button', {text:T(n), class:ST.params.method === m ? 'on' : '', dataset:{k:'method', v:m}, onclick:() => { if (ST.params.method === m) return; ST.params.method = m; ST.preset = 'Custom'; changed(true); }})));
    b.appendChild(el('div', {class:'row'}, [el('span', {text:T(L3('方法：', '方法：', 'Method:'))}), meth]));
    [['snapCurvesToLines', L3('靠齊曲線至線條', '将曲线与线条对齐', 'Snap Curves To Lines')], ['ignoreWhite', L3('忽略白色', '忽略白色', 'Ignore White')]].forEach(([k, n]) => {
      const c = el('input', {type:'checkbox', dataset:{k}}); c.checked = !!ST.params[k];
      c.addEventListener('change', () => { ST.params[k] = c.checked; ST.preset = 'Custom'; changed(true); });
      b.appendChild(el('label', {class:'row'}, [c, el('span', {text:T(n)})]));
    });
  }
  b.appendChild(el('div', {class:'sec'}));
  if (t) b.appendChild(el('div', {class:'hint', text:T(L3('已選取影像描圖物件：改設定會立即重新描圖', '已选中图像描摹对象：改设置会立即重新描摹', 'Image Trace object selected: changing a setting re-traces it'))}));
  const info = ST.info;
  if (info) b.appendChild(el('div', {class:'hint', dataset:{k:'info'}, text:Array.isArray(info)
    ? `${T(L3('路徑', '路径', 'Paths'))}: ${info[0]}    ${T(L3('錨點', '锚点', 'Anchors'))}: ${info[1]}    ${T(L3('顏色', '颜色', 'Colors'))}: ${info[2]}` : String(info.error || '')}));
  const canTrace = !!t || srcs.length > 0;
  b.appendChild(el('div', {class:'bar', style:'justify-content:flex-start'}, [
    el('button', {text:T(L3('描圖', '描摹', 'Trace')), dataset:{act:'trace'}, disabled:!canTrace, style:'min-width:80px',
      title:canTrace ? null : T(L3('文件裡沒有可描圖的像素圖層', '文件里没有可描摹的像素图层', 'No raster layer to trace')), onclick:doTrace}),
    el('button', {text:T(L3('展開', '扩展', 'Expand')), dataset:{act:'expand'}, disabled:!t, style:'min-width:80px',
      onclick:() => { const s = selectedTrace(); if (s) run('ai.imageTrace.expand', {id:s.s.id}); P.refresh('aiImageTrace'); }})
  ]));
}

P.define('aiImageTrace', {title:L3('影像描圖', '图像描摹', 'Image Trace'), w:280,
  menu:() => { const t = selectedTrace(); return [
    {label:L3('釋放', '释放', 'Release'), disabled:!t, run:() => { const s = selectedTrace(); if (s) run('ai.imageTrace.release', {id:s.s.id}); P.refresh('aiImageTrace'); }},
    {label:L3('展開', '扩展', 'Expand'), disabled:!t, run:() => { const s = selectedTrace(); if (s) run('ai.imageTrace.expand', {id:s.s.id}); P.refresh('aiImageTrace'); }},
    {sep:true},
    {label:L3('重設為預設值', '重置为默认值', 'Reset to Default'), run:() => { ST.params = null; ST.info = null; ST.synced = null; ensure(); P.refresh('aiImageTrace'); }}
  ]; },
  refresh});
if (P.isOpen('aiImageTrace')) P.refresh('aiImageTrace');
})();
