/* 堤麟画板 · 工具登记处
   🔴 一颗工具一支档（tools/<id>.js），各自用 Tools.reg({...}) 登记；这里只管登记、排序、分派滑鼠事件。
   这样一颗按钮一支档、多人并行改各自的档，谁也盖不到谁。

   一颗工具能声明的栏位：
     id        工具 id（＝按钮的 data-tool、i18n 的 'tool.<id>'）
     icon key  图示、单键快捷键（key 比对 e.key，'+'／'-' 这种符号键也行）
     shift     true ＝ 快捷键要按着 Shift（例如锚点工具 Shift+C）；不写＝只认不按 Shift 的那下
     group     'select' | 'raster' | 'vector' | 'misc'   工具栏按这个分组、组间画分隔线
     order     组内排序（小的在前）
     for       'common' | 'raster' | 'vector'            在哪种图层上出现（定）
     needs     'raster' | 'vector' | 'text'              画东西时要哪种层（没有就自动建）
     opts      选项栏要哪几个现成控件：size hardness tolerance radius points fontSize text
     hint      选项栏尾巴的提示字串 key（走 Lang）
     cursor    画布游标（预设 crosshair）
     strings   自带的三语字串 { 'zh-Hant':{…}, 'zh-Hans':{…}, 'en':{…} }，登记时并进字典
     onDown(e, pt, P) / onMove(e, pt, P) / onUp(e, pt, P) / onDblClick(e, pt, P)
               pt = 文件坐标 [x,y]；P = Pointer（P.down 是否按着、P.start 按下点、P.preview 虚线预览框）
     onKey(e)  → true 表示这颗键我吃掉了
     drawOverlay(ctx, s)   在画布上叠画预览（s = 文件坐标→画布像素的倍率）
     buildOptions(box, add, mk)  要自订选项栏控件时用
     onDeactivate        换到别的工具前被叫一次
   🔴 规矩：工具做的每一件「改文件」的事都要走 CMD.run(...)，不许自己直接改 Doc——agent 才能走同一条路。 */

const ToolState = {
  cur: 'brush',
  size: 24, hardness: 1, tolerance: 32, radius: 0, points: 5, fontSize: 64, text: 'Text'
};

const GROUP_ORDER = ['select', 'raster', 'vector', 'misc'];
const TOOLS = [];                       // 登记过的全部工具（不含分隔线），按组与 order 排好
const Tools = {
  map: {},
  reg(t){
    if (!t || !t.id) throw new Error('tool needs id');
    t.group = t.group || 'misc';
    t.order = (t.order === undefined) ? 100 : t.order;
    t.for   = t.for || 'common';
    t.opts  = t.opts || [];
    this.map[t.id] = t;
    const i = TOOLS.findIndex(x => x.id === t.id); if (i >= 0) TOOLS.splice(i, 1);
    TOOLS.push(t);
    TOOLS.sort((a, b) => (GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)) || (a.order - b.order));
    // Lang 是 const，ui.js 载入前还没挂上 window ⇒ 用 typeof 判，不然工具自带的字串全进不了字典
    if (t.strings && typeof Lang !== 'undefined') Lang.add(t.strings);
    return t;
  },
  get(id){ return this.map[id]; },
  // modal：整个画面暂时归一个工作区管（PS 选择并遮住：画布上刷的是调整边缘画笔、键盘是工作区的键），关掉工作区再设回 null
  modal: null,
  current(){ return this.modal || this.map[ToolState.cur] || {}; }
};

/* 这种层现在该看到哪些工具（含组间分隔线） */
function toolsFor(kind){
  // 文字层：能改的就是那串字与版面，所以给它看共用那组（画东西要先新建一层）
  // 组／画板／图框（group）与智能对象（smart）：工具栏、菜单都走 PS 那套 ⇒ 给它看像素那组工具
  const k = (kind === 'text') ? 'common' : (kind === 'group' || kind === 'smart') ? 'raster' : kind;
  const out = []; let g = null;
  for (const t of TOOLS){
    if (t.for !== 'common' && t.for !== k) continue;
    if (g && t.group !== g) out.push({sep:true});
    out.push(t); g = t.group;
  }
  return out;
}

/* 图层锁定（engine.js Locks）：这几颗工具一按下就要改当前层的内容 ⇒ 当前层锁了像素（或全锁）就整个手势不给、画面上提示一句。
   键＝工具 id，值＝当前层是哪种才算（像素工具在矢量层上会自己新建像素层、形状工具在像素层上会新建矢量层，那就不挡）。
   移动工具（先自动选层才知道动哪层）、文字工具（点到哪层文字才算）在各自档里挡；其余矢量节点工具由命令那道门（CMD.run → Locks.guard）挡。 */
const TOOL_LOCKS = {
  brush:['raster'], eraser:['raster'], bucket:['raster'], clone:['raster'], gradient:['raster'],
  // 修图工具
  pencil:['raster'], spotheal:['raster'], heal:['raster'], historybrush:['raster'], blur:['raster'], sharpen:['raster'], smudge:['raster'],
  dodge:['raster'], burn:['raster'], sponge:['raster'], mixer:['raster'], colorreplace:['raster'],
 // 修图工具（续）、自由钢笔／弯度钢笔
 redeye:['raster'], patternstamp:['raster'], arthistory:['raster'], drop3d:['raster'], freeformpen:['vector'], curvaturepen:['vector'],
  // AI 版面
  arc:['vector'], spiral:['vector'], rectgrid:['vector'], polargrid:['vector'], flare:['vector'], aicurvature:['vector'],
  blobbrush:['vector'], shaper:['vector'], aipencil:['vector'], knife:['vector'], smooth:['vector'], patheraser:['vector'], join:['vector'],
  shapebuilder:['vector'], livepaint:['vector'],
  graphcolumn:['vector'], graphstackcolumn:['vector'], graphbar:['vector'], graphstackbar:['vector'], graphline:['vector'], grapharea:['vector'], graphscatter:['vector'], graphpie:['vector'], graphradar:['vector'],
  pen:['vector'], rect:['vector'], ellipse:['vector'], star:['vector'], line:['vector']
};
function toolLocked(t, e){
  const kinds = TOOL_LOCKS[t.id]; if (!kinds || !window.Locks) return false;
  if (e.button !== undefined && e.button !== 0) return false;              // 右键（笔刷挑选器）不算
  if (e.ctrlKey && e.altKey) return false;                                 // Ctrl+Alt 拖＝改笔尖大小／硬度
  if ((t.id === 'clone' || t.id === 'heal' || t.id === 'mixer') && e.altKey) return false;   // 仿制图章／修复画笔 Alt 点＝取样、混合器 Alt 点＝装色，不改这层                          // 仿制图章 Alt 点＝取样，不改这层
  if (typeof HandTemp !== 'undefined' && HandTemp.space) return false;     // Space 暂时抓手
  const L = Doc.active();
  if (!L || !kinds.includes(L.kind)) return false;
  return Locks.deny(L, 'pixels');
}

/* 指针分派：把画布上的滑鼠事件交给当前工具 */
const Pointer = {
  down: false, start: null, hover: null, preview: null, blocked: false,

  onDown(e, pt){
    if (window.AiView) pt = AiView.snapPt(pt);   // AI 视图 ▸ 对齐网格／像素（四个入口都过一遍）
    this.down = true; this.start = pt; this.hover = pt; this.preview = null;
    const t = Tools.current();
    this.blocked = toolLocked(t, e);              // 当前层锁住：这一下按到放开都不交给工具
    if (this.blocked) return;
    // 像素层按内容大小：会往层上加像素的工具，按下就让当前像素层盖住整份文件（放开时 LayerBox.settle 收回内容外框），
    // 画到原本画布外面的笔画才不会被截掉；锁透明像素的不长（画布外本来就不能画）
    if (window.LayerBox && LayerBox.GROW_TOOLS.has(t.id) && !(e.button !== undefined && e.button !== 0)){
      const L = Doc.active();
      if (L && L.kind === 'raster' && !(window.Locks && Locks.alpha(L))) LayerBox.grow(L);
    }
    if (t.onDown) t.onDown(e, pt, this);
  },
  onMove(e, pt){
    if (window.AiView) pt = AiView.snapPt(pt);
    UI.setPos(pt); this.hover = pt;
    if (this.blocked && this.down) return;
    const t = Tools.current(); if (!t.onMove) return;
    // 没按着＝只是悬停：这期间的 UI.draw 沿用上次合成好的画面（ui.js draw 的 _hoverDraw），不整张重合成
    const hover = !this.down && !(e.buttons & 1);
    if (hover) UI._hoverDraw = true;
    try { t.onMove(e, pt, this); } finally { if (hover) UI._hoverDraw = false; }
  },
  onUp(e, pt){
    if (window.AiView) pt = AiView.snapPt(pt);
    const was = this.down; this.down = false; this.preview = null;
    if (this.blocked){ this.blocked = false; UI.draw(); return; }
    const t = Tools.current();
    try { if (was && t.onUp) t.onUp(e, pt, this); else UI.draw(); }
    finally { if (window.LayerBox) LayerBox.settle(); }   // 按下时长大过的层：写过就裁回内容外框、没写就换回原画布（engine.js LayerBox）
  },
  onDblClick(e, pt){
    if (window.AiView) pt = AiView.snapPt(pt);
    const t = Tools.current(); if (t.onDblClick) t.onDblClick(e, pt, this);
  },

  /* ── 给各工具共用的小帮手 ── */
  rectFrom(a, b){
    return {x:Math.min(a[0],b[0]), y:Math.min(a[1],b[1]), w:Math.abs(b[0]-a[0]), h:Math.abs(b[1]-a[1])};
  },
  ensureRaster(){
    const L = Doc.active();
    if (!L || L.kind !== 'raster') CMD.map['layer.newRaster'].run({});     // 直接叫，不另推历史
  },
  /* 文件坐标 → 当前像素层自己的坐标（图层被移动过就要减掉位移；铁律④） */
  toLayer(L, pt){ return [pt[0]-L.x, pt[1]-L.y]; }
};

window.ToolState = ToolState;
window.TOOLS = TOOLS;
window.Tools = Tools;
window.toolsFor = toolsFor;
window.Pointer = Pointer;
