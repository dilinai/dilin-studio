/* 堤麟画板 · 菜单树 · Illustrator ▸ 文字（照 vectorcraft menus.rs menu_tree() 抄；三语照 AI 2020 繁／简中介面）
 * 原码 <dynamic> 的子菜单：
 *   字体＝本机可用的字型家族（原码 font_items()：每个家族一项 → text.setStyle {font}；我们叫 text.fonts 拿清单，开菜单时才生成）；
 *   最近使用的字体＝十个槽位 type.recentFont1…10（标签＝那个字体名，空槽显示「—」并灰掉，照 menus.rs 1193-1198、1397-1399）；
 *   大小＝6～72 pt 十四档（原码 TYPE_SIZES，同 AI）；
 *   插入特殊字元／空白字元／分隔字元＝原码 INSERT_SPECIAL／INSERT_WHITESPACE／INSERT_BREAK 全部项（menus.rs 2444-2473），
 *   特殊字元照 AI 2020 分三组（符号／连字符和破折号／引号）。
 * 原码多项共用一个 id（window.panel、type.pathOptions、type.changeCase、text.setStyle、type.insert）的，
 * 这里 id 加后缀拆开，原 id 与参数记在 orig。
 * 实作在 menus/impl/ai-type.js（命令 ai.*）。项目写 live:{cmd, params} ⇒ 档尾把它变成 impl 的 getter：
 * 那条命令登记了才亮（impl 档还没挂进 index.html 时照旧灰着、不会让总表核到「impl 对不上命令」）。
 */
(function(){
const L3 = (h, s, e) => ({'zh-Hant':h, 'zh-Hans':s, en:e});
const AT = () => window.AiType || null;
const ins = (h, s, e, ch) => ({n:L3(h, s, e), id:'type.insert.' + ch, live:{cmd:'ai.type.insert', params:{char:ch}}, orig:{id:'type.insert', params:{char:ch}}});
const size = v => ({n:L3(v + ' pt', v + ' pt', v + ' pt'), id:'type.size.' + v, live:{cmd:'ai.text.setStyle', params:{size:v}}, orig:{id:'text.setStyle', params:{size:v}}});
/* 最近使用的字体：第 k 个槽位（标签与亮不亮都看当下的清单） */
function recentSlot(k){
  const name = () => { const a = AT(); const f = a && a.recentFonts()[k - 1]; return f || '—'; };
  const it = {n:{get 'zh-Hant'(){ return name(); }, get 'zh-Hans'(){ return name(); }, get en(){ return name(); }}, id:'type.recentFont' + k};
  Object.defineProperty(it, 'impl', {enumerable:true, configurable:true, get(){
    const a = AT(), c = 'ai.type.recentFont' + k;
    return (a && window.CMD && CMD.map[c] && a.recentFonts()[k - 1]) ? {cmd:c} : null;
  }});
  return it;
}
/* 字体：每个家族一项（开菜单时才问 text.fonts；清单没变就沿用同一批项） */
let _fontKey = null, _fontItems = [];
function fontItems(){
  let fams = [];
  try { if (window.CMD && CMD.map['text.fonts']) fams = (CMD.map['text.fonts'].run({}) || {}).families || []; } catch(e){}
  const key = fams.join('\u0001');
  if (key !== _fontKey){
    _fontKey = key;
    _fontItems = fams.map(f => liveify({n:L3(f, f, f), id:'type.font.' + f, live:{cmd:'ai.text.setStyle', params:{font:f}}, orig:{id:'text.setStyle', params:{font:f}}}));
    if (!_fontItems.length) _fontItems = [{n:L3('（沒有可用字體）', '（没有可用字体）', '(No fonts)'), id:'type.font.none', impl:null}];
  }
  return _fontItems;
}
/* live → impl getter（递回进子菜单；sub 是 getter 的不碰） */
function liveify(it){
  if (it.live){
    const L = it.live;
    Object.defineProperty(it, 'impl', {enumerable:true, configurable:true, get(){ return (window.CMD && CMD.map[L.cmd]) ? L : null; }});
  }
  const d = Object.getOwnPropertyDescriptor(it, 'sub');
  if (d && !d.get && Array.isArray(it.sub)) it.sub.forEach(liveify);
  return it;
}
/* 勾选／单选的状态与会翻的标签：问 impl 档（没载入就当没勾） */
const chk = f => function(){ const a = AT(); try { return !!(a && f(a)); } catch(e){ return false; } };

const tree = {
  n:L3('文字', '文字', 'Type'),
  items:[
    {n:L3('字體', '字体', 'Font'), get sub(){ return fontItems(); }},
    {n:L3('最近使用的字體', '最近使用的字体', 'Recent Fonts'), sub:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(recentSlot)},
    {n:L3('大小', '大小', 'Size'), sub:[6, 8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72].map(size)},
    {sep:true},
    {n:L3('字符', '字形', 'Glyphs'), id:'type.glyphs', check:true,
      live:{cmd:'ai.window.panel.glyphs', checked:chk(a => a.glyphsOpen())}, orig:{id:'window.panel', params:{panel:'glyphs'}}},
    {n:L3('插入特殊字元', '插入特殊字符', 'Insert Special Character'), sub:[
      {n:L3('符號', '符号', 'Symbols'), sub:[
        ins('項目符號', '项目符号', 'Bullet', 'bullet'),
        ins('版權符號', '版权符号', 'Copyright Symbol', 'copyright'),
        ins('省略符號', '省略号', 'Ellipsis', 'ellipsis'),
        ins('段落符號', '段落符号', 'Paragraph Symbol', 'paragraph'),
        ins('註冊商標符號', '注册商标符号', 'Registered Trademark Symbol', 'registered'),
        ins('章節符號', '章节符号', 'Section Symbol', 'section'),
        ins('商標符號', '商标符号', 'Trademark Symbol', 'trademark'),
      ]},
      {n:L3('連字號和破折號', '连字符和破折号', 'Hyphens And Dashes'), sub:[
        ins('全形破折號', '全角破折号', 'Em Dash', 'emDash'),
        ins('半形破折號', '半角破折号', 'En Dash', 'enDash'),
        ins('選擇性連字號', '自由连字符', 'Discretionary Hyphen', 'discretionaryHyphen'),
        ins('不斷字連字號', '不间断连字符', 'Nonbreaking Hyphen', 'nonBreakingHyphen'),          // 原码 INSERT_SPECIAL 有，AI 2020 中文版没列
      ]},
      {n:L3('引號', '引号', 'Quotation Marks'), sub:[
        ins('左雙引號', '双左引号', 'Double Left Quotation Marks', 'doubleLeftQuote'),
        ins('右雙引號', '双右引号', 'Double Right Quotation Marks', 'doubleRightQuote'),
        ins('左單引號', '单左引号', 'Single Left Quotation Mark', 'singleLeftQuote'),
        ins('右單引號', '单右引号', 'Single Right Quotation Mark', 'singleRightQuote'),
      ]},
    ]},
    {n:L3('插入空白字元', '插入空白字符', 'Insert Whitespace Character'), sub:[
      ins('全形空格', '全角空格', 'Em Space', 'emSpace'),
      ins('半形空格', '半角空格', 'En Space', 'enSpace'),
      ins('極細空格', '细线空格', 'Hair Space', 'hairSpace'),
      ins('六分之一空格', '六分之一空格', 'Sixth Space', 'sixthSpace'),
      ins('細空格', '窄空格', 'Thin Space', 'thinSpace'),
      // 下面五种原码 INSERT_WHITESPACE 有（AI 2020 中文版只列上面五种）
      ins('不斷行空格', '不间断空格', 'Nonbreaking Space', 'nonBreakingSpace'),
      ins('數字空格', '数字空格', 'Figure Space', 'figureSpace'),
      ins('標點空格', '标点空格', 'Punctuation Space', 'punctuationSpace'),
      ins('三分之一空格', '三分之一空格', 'Third Space', 'thirdSpace'),
      ins('四分之一空格', '四分之一空格', 'Quarter Space', 'quarterSpace'),
    ]},
    {n:L3('插入分隔字元', '插入分隔符', 'Insert Break Character'), sub:[
      ins('強制換行', '强制换行', 'Forced Line Break', 'forcedLineBreak'),
      ins('定位點', '制表符', 'Tab', 'tab'),
    ]},
    {sep:true},
    {n:L3('轉換為區域文字', '转换为区域文字', 'Convert To Area Type'), id:'type.convertToAreaType', live:{cmd:'ai.type.convertToAreaType'}},
    {n:L3('轉換為點狀文字', '转换为点状文字', 'Convert To Point Type'), id:'type.convertToPointType', live:{cmd:'ai.type.convertToPointType'}},
    {n:L3('區域文字選項…', '区域文字选项…', 'Area Type Options…'), id:'text.areaOptions', live:{cmd:'ai.text.areaOptions.dialog'}},
    {n:L3('路徑文字', '路径文字', 'Type on a Path'), sub:[
      ...[['彩虹效果', '彩虹效果', 'Rainbow', 'rainbow'], ['傾斜', '倾斜', 'Skew', 'skew'], ['3D 緞帶效果', '3D 带状效果', '3D Ribbon', '3dRibbon'],
          ['階梯效果', '阶梯效果', 'Stair Step', 'stairStep'], ['重力效果', '重力效果', 'Gravity', 'gravity']].map(([h, s, e, k]) =>
        ({n:L3(h, s, e), id:'type.pathOptions.' + k, radio:'pathEffect',
          live:{cmd:'ai.type.pathOptions', params:{effect:k}, checked:chk(a => a.pathEffectOf() === k)}, orig:{id:'type.pathOptions', params:{effect:k}}})),
      {sep:true},
      {n:L3('路徑文字選項…', '路径文字选项…', 'Type on a Path Options…'), id:'type.pathOptions', live:{cmd:'ai.type.pathOptions.dialog'}, orig:{id:'type.pathOptions', params:{start:0}}},
    ]},
    {n:L3('文字緒', '串接文本', 'Threaded Text'), sub:[
      {n:L3('建立', '创建', 'Create'), id:'text.thread.create', live:{cmd:'ai.text.thread.create'}},
      {n:L3('釋放選取文字', '释放所选文字', 'Release Selection'), id:'text.thread.releaseSelection', live:{cmd:'ai.text.thread.releaseSelection'}},
      {n:L3('移除文字緒', '移去串接文字', 'Remove Threading'), id:'text.thread.remove', live:{cmd:'ai.text.thread.remove'}},
    ]},
    {n:L3('調整標題', '适合标题', 'Fit Headline'), id:'text.fitHeadline', live:{cmd:'ai.text.fitHeadline'}},
    {sep:true},
    {n:L3('尋找字體…', '查找字体…', 'Find Font…'), id:'type.findFont', live:{cmd:'ai.type.findFont'}},
    {n:L3('變更大小寫', '更改大小写', 'Change Case'), sub:[
      {n:L3('大寫', '大写', 'UPPERCASE'), id:'type.changeCase.upper', live:{cmd:'ai.type.changeCase', params:{case:'upper'}}, orig:{id:'type.changeCase', params:{case:'upper'}}},
      {n:L3('小寫', '小写', 'lowercase'), id:'type.changeCase.lower', live:{cmd:'ai.type.changeCase', params:{case:'lower'}}, orig:{id:'type.changeCase', params:{case:'lower'}}},
      {n:L3('字首大寫', '词首大写', 'Title Case'), id:'type.changeCase.title', live:{cmd:'ai.type.changeCase', params:{case:'title'}}, orig:{id:'type.changeCase', params:{case:'title'}}},
      {n:L3('句首大寫', '句首大写', 'Sentence case'), id:'type.changeCase.sentence', live:{cmd:'ai.type.changeCase', params:{case:'sentence'}}, orig:{id:'type.changeCase', params:{case:'sentence'}}},
    ]},
    {n:L3('智慧型標點符號…', '智能标点…', 'Smart Punctuation…'), id:'type.smartPunctuation', live:{cmd:'ai.type.smartPunctuation.dialog'},
      orig:{id:'type.smartPunctuation', params:{quotes:true, dashes:true, ellipsis:true, scope:'selection'}}},
    {sep:true},
    {n:L3('建立外框', '创建轮廓', 'Create Outlines'), id:'type.createOutlines', key:'Ctrl+Shift+O', live:{cmd:'ai.type.createOutlines'}},
    {n:L3('視覺邊界對齊方式', '视觉边距对齐方式', 'Optical Margin Alignment'), id:'type.opticalMarginAlignment', check:true, get impl(){ return window.CMD && CMD.map['ai.type.opticalMarginAlignment'] ? {cmd:'ai.type.opticalMarginAlignment', checked:() => !!window.AiMisc && AiMisc.opticalOn()} : null; }},   // 原码 todo；照 AI 补（menus/impl/ai-misc.js）
    {sep:true},
    {n:L3('以預留位置文字填滿', '用占位符文本填充', 'Fill with Placeholder Text'), id:'type.fillPlaceholder', live:{cmd:'ai.type.fillPlaceholder'}},
    {sep:true},
    // 原码 dynamic_label（menus.rs:1187）：开着叫「隐藏隐藏字符」、关着叫「显示隐藏字符」
    {n:(() => { const on = () => { const a = AT(); return !!(a && a.hiddenChars); };
        return {get 'zh-Hant'(){ return on() ? '隱藏隱藏字元' : '顯示隱藏字元'; }, get 'zh-Hans'(){ return on() ? '隐藏隐藏字符' : '显示隐藏字符'; },
                get en(){ return on() ? 'Hide Hidden Characters' : 'Show Hidden Characters'; }}; })(),
      id:'type.hiddenCharacters', live:{cmd:'ai.type.hiddenCharacters'}},
    {n:L3('文字方向', '文字方向', 'Type Orientation'), sub:[
      {n:L3('水平', '水平', 'Horizontal'), id:'type.orientation.horizontal', radio:'typeOrientation', live:{cmd:'ai.type.orientation.horizontal', checked:chk(a => a.orientationOf() === 'horizontal')}},
      {n:L3('垂直', '垂直', 'Vertical'), id:'type.orientation.vertical', radio:'typeOrientation', live:{cmd:'ai.type.orientation.vertical', checked:chk(a => a.orientationOf() === 'vertical')}},
    ]},
  ]
};
tree.items.forEach(liveify);
MenuTrees.add('ai', 'type', tree);
})();
