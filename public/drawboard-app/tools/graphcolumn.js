/* 图表工具家族（AI 版面第 23 格，九颗共一套）——逐段照抄 VectorCraft 的 GraphTool
   本档＝柱形图（columnGraph，AI 快捷键 J 由工具栏管）＋九颗共用的 window.GraphToolKit；
   另外八颗（graphstackcolumn／graphbar／graphstackbar／graphline／grapharea／graphscatter／graphpie／graphradar）
   各自一支档只叫 GraphToolKit.make(...)。
   对照源（行号以 vectorcraft/crates 为根）：
   - tools/src/extra.rs:13-21          create：id 以 Graph 结尾且 GraphKind::parse 认得 ⇒ GraphTool
   - tools/src/extra.rs:298-376        GraphTool：按下记起点；拖超过 3 屏幕像素才 Begin("Graph")；拖曳中 Preview("graph.create", params)；
                                        放开：有拖＝Preview(放开点与放开时的修饰键)＋Commit＋Dialog("graphData")，没拖＝Dialog("graph", {x, y, type})；
                                        params：Shift＝正方形（取两边较长、各保留方向）、Alt＝从中心；width／height 至少 1；
                                        Esc：拖曳中取消（按着没拖时按 Esc 只清掉起点，放开就什么都不做）；游标十字
   - tools/src/catalog.rs:116-124      九颗的 id 与名字（columnGraph 的快捷键 J）
   - tools/src/lib.rs:261-263          tol(px)＝屏幕像素换文件单位
   - ui-egui/src/dialogs/tools.rs:19-28  "graph"＝通用命令对话框 graph.create {type, x, y, width:200, height:150}；
                                        "graphData"＝先跑 graph.setData {} 读 csv，再开 graph.setData 的命令对话框（csv 一栏）
   - ui-egui/src/dialogs/command.rs:24   graph.create 对话框只露 width、height 两栏（x、y、type 藏着照带）
   - ui-egui/src/shortcuts.rs           工具忙着（按着滑鼠）时只有 Esc 进工具，其余快捷键不响应
   - engine/src/cmd/graph.rs、doc/src/graph.rs  图表本体（资料、九种生成、范例资料、选中）——已由 menus/impl/ai-object.js 翻好
                                        （ai.graph.create／ai.graph.setData(.dialog)／AiR3.graphGenerate），本工具接同一份、不另起一套。 */
(function(){
'use strict';

/* Rust f64::signum：+0 也算 1 */
const sgn = v => (v > 0 || Object.is(v, 0)) ? 1 : -1;

/* extra.rs:314-322 params()：起点 s、目前点 p、修饰键 m → graph.create 参数（文件坐标） */
function graphParams(kind, s, p, m){
  let dx = p[0] - s[0], dy = p[1] - s[1];
  if (m && m.shift){ const k = Math.max(Math.abs(dx), Math.abs(dy)); dx = k * sgn(dx); dy = k * sgn(dy); }
  const a = (m && m.alt) ? [s[0] - dx, s[1] - dy] : [s[0], s[1]], b = [s[0] + dx, s[1] + dy];
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  return {type:kind, x:x0, y:y0, width:Math.max(x1 - x0, 1), height:Math.max(y1 - y0, 1)};
}

/* graph.rs:505-509 范例资料＋doc/graph.rs GraphSpec 预设：预览用（Rust 的 Preview 是真跑 graph.create，长得跟落定一模一样） */
function previewSpec(c){
  return {kind:c.type, rect:[c.x, c.y, c.x + c.width, c.y + c.height],
    series:['Series 1', 'Series 2'], categories:['A', 'B', 'C', 'D'], rows:[[3, 2], [5, 4], [4, 6], [7, 5]],
    columnWidth:90, clusterWidth:80, legend:true, ticks:0, axisMin:null, axisMax:null, markPoints:true, connectPoints:true, placed:null};
}

const STR = {
  'zh-Hant':{'ui.graphHint':'拖曳＝畫圖表範圍（放開後開「圖表資料」）｜Shift＋拖＝正方形｜Alt＋拖＝從中心｜點一下＝輸入寬高｜拖時 Esc 取消',
             'ui.graphDlg':'圖表', 'ui.graphW':'寬度', 'ui.graphH':'高度'},
  'zh-Hans':{'ui.graphHint':'拖曳＝画图表范围（放开后开「图表数据」）｜Shift＋拖＝正方形｜Alt＋拖＝从中心｜点一下＝输入宽高｜拖时 Esc 取消',
             'ui.graphDlg':'图表', 'ui.graphW':'宽度', 'ui.graphH':'高度'},
  'en':{'ui.graphHint':'Drag to set the graph area (then Graph Data opens) | Shift+Drag: square | Alt+Drag: from center | Click: enter width/height | Esc cancels a drag',
        'ui.graphDlg':'Graph', 'ui.graphW':'Width', 'ui.graphH':'Height'}
};

/* 一颗图表工具的状态机（extra.rs:300-376） */
function makeState(id, kind){
  const T = {
    id, kind,
    start: null,                 // 按下点（文件坐标）
    began: false,                // 拖超过 3 屏幕像素才算开始
    cur: null,                   // 目前的 Preview 参数
    tol(px){ return px / Math.max(UI.zoom, 1e-9); },          // lib.rs:261-263
    busy(){ return !!this.start; },                            // extra.rs:329-331
    mods(e){ return {shift:!!(e && e.shiftKey), alt:!!(e && e.altKey)}; },
    down(e, pt){ this.start = [pt[0], pt[1]]; this.began = false; this.cur = null; },
    drag(e, pt){
      const s = this.start; if (!s) return;
      if (!this.began){
        if (Math.hypot(pt[0] - s[0], pt[1] - s[1]) < this.tol(3)) return;
        this.began = true;                                     // Action::Begin("Graph")
      }
      this.cur = graphParams(kind, s, pt, this.mods(e));       // Action::Preview("graph.create", …)
    },
    up(e, pt){
      const s = this.start; if (!s) return;
      this.start = null; this.cur = null;
      if (this.began){
        this.began = false;
        // Preview(放开点、放开时修饰键)＋Commit ⇒ 一条命令一步历史；然后 Dialog("graphData")
        const m = this.mods(e), L = Doc.active();
        const r = CMD.run(id + '.drag', {x1:s[0], y1:s[1], x2:pt[0], y2:pt[1], shift:m.shift, alt:m.alt, layerId:L && L.id});
        if (r && r.ok !== false && CMD.map['ai.graph.setData.dialog']) CMD.run('ai.graph.setData.dialog', {});
      } else {
        this.openSizeDialog(s[0], s[1]);                       // Dialog("graph", {x, y, type})
      }
    },
    /* extra.rs:367-372：Esc 一律把起点拿掉；已经开始拖的才回 Cancel */
    key(e){
      if (e.key !== 'Escape') return false;
      const had = !!this.start, began = this.began;
      this.start = null; this.began = false; this.cur = null;
      if (had && began){ e.preventDefault(); UI.draw(); return true; }
      return false;
    },
    cancel(){ this.start = null; this.began = false; this.cur = null; },
    /* dialogs/tools.rs:20-23 ＋ command.rs:24：只露宽、高（200×150），x、y、type 照带；确定＝graph.create */
    openSizeDialog(x, y){
      const R3 = window.AiR3; if (!R3 || !R3.form) return;
      const L = Doc.active();
      R3.form('graph', 'ui.graphDlg', [
        {key:'width', label:'ui.graphW', type:'number', value:200},
        {key:'height', label:'ui.graphH', type:'number', value:150}
      ], v => CMD.run('ai.graph.create', {type:kind, x, y, width:v.width, height:v.height, layerId:L && L.id}));
    },
    /* Rust 的 Preview 把图表真的放进文件；我们画同一支 AiR3.graphGenerate 生成的东西当叠画（文件坐标，不受图层位移影响） */
    overlay(ctx, s){
      if (!(this.start && this.began && this.cur) || !window.AiR3 || !AiR3.graphGenerate) return;
      const L = Doc.active();
      ctx.save();
      if (L && L.kind === 'vector') ctx.globalAlpha = L.opacity;
      drawShape(ctx, {id:'graphPreview', type:'group', name:'Graph', children:AiR3.graphGenerate(previewSpec(this.cur))}, s);
      ctx.restore();
    }
  };
  return T;
}

const GraphToolKit = {
  states: {},
  params: graphParams,
  /* 登记一颗：工具 id、GraphKind id、工具栏序（九颗挤在同一格，order 只决定 toolsFor 的次序） */
  make(id, kind, order){
    const T = this.states[id] = makeState(id, kind);
    /* 命令：工具拖一下（agent 与滑鼠同一条路）——内部直接跑 ai.graph.create，算一步历史 */
    CMD.reg(id + '.drag', {i18n:'', undoable:true,
      params:`{x1,y1 按下点, x2,y2 放开点（文件坐标）, shift?=false 正方形（取较长边）, alt?=false 以按下点为中心, layerId?, series?, categories?, rows?, csv?} → {ok, id}  ＝ ${kind} 图表工具拖一下（extra.rs:314-357：宽高至少 1；没给资料＝范例资料；之后滑鼠那条会接着开「图表数据」＝ai.graph.setData.dialog）。点一下＝ai.graph.create {type:"${kind}", x, y, width:200, height:150}`},
      p => {
        const c = CMD.map['ai.graph.create']; if (!c) return {ok:false, error:id + '.drag: ai.graph.create not loaded'};
        const nums = [p.x1, p.y1, p.x2, p.y2].map(Number);
        if (!nums.every(Number.isFinite)) return {ok:false, error:id + '.drag: missing x1 / y1 / x2 / y2'};
        const q = Object.assign(graphParams(kind, [nums[0], nums[1]], [nums[2], nums[3]], {shift:!!p.shift, alt:!!p.alt}),
          p.layerId !== undefined ? {layerId:p.layerId} : {});
        ['series', 'categories', 'rows', 'csv'].forEach(k => { if (p[k] !== undefined) q[k] = p[k]; });
        return c.run(q);
      });
    Tools.reg({
      id, icon:'📊', group:'vector', order, for:'vector', needs:'vector', opts:[],
      cursor:'crosshair', hint:'ui.graphHint', strings:STR,
      onDown(e, pt){ if (e.button !== undefined && e.button !== 0) return; T.down(e, pt); },
      onMove(e, pt, P){ if (!P.down || !T.start) return; T.drag(e, pt); UI.draw(); },
      onUp(e, pt){ T.up(e, pt); UI.draw(); },
      onKey(e){ return T.key(e); },
      onDeactivate(){ T.cancel(); },
      drawOverlay(ctx, s){ T.overlay(ctx, s); }
    });
    return T;
  }
};
window.GraphToolKit = GraphToolKit;

/* shortcuts.rs：工具忙着时只有 Esc 进工具，其余快捷键（Ctrl+Z、单键换工具…）一律不响应，直到放开 */
document.addEventListener('keydown', e => {
  const T = GraphToolKit.states[ToolState.cur];
  if (!T || !T.busy()) return;
  if (/input|select|textarea/i.test(e.target.tagName)) return;
  T.key(e);
  e.stopPropagation();
  if (e.ctrlKey || e.metaKey) e.preventDefault();
}, true);

GraphToolKit.make('graphcolumn', 'column', 300);
})();
