// 台版整站美化色板
// 集中「首页色调」token：暖米 + 淡粉紫渐变 + 深棕黑。各处 import 套色用·别再散落硬编码。
// 🔴 只给 UI 元件（顶栏/侧栏/工具栏/按钮/面板/卡片/背景）用色——
//    别动文本内容彩色。
// 注：tier-theme.ts（等级徽章色）是独立语义·不并入此处。
//
// 取色出处 = 现状高频硬编码（page.tsx / LeftSidebar.tsx grep）+ 首页 hp-aurora 渐变（globals.css 243-251）。

export const palette = {
  // ── 暖米系（侧栏 / 面板 / 卡片 / 输入框底·学飞书元件质感但配暖米） ──
  warm: {
    bg:         '#F4F1EA', // 侧栏 / 面板底
    panel:      '#FAF9F5', // 首页右侧流式面板底·编辑页右栏整栏同它
    bgSoft:     '#F7F1DF', // 更浅暖米
    surface:    '#F0E8D6', // 卡片 / 切换器暖B 面
    surfaceAlt: '#ECE2CD',
    border:     '#E7E0D2', // 暖米描边
    borderSoft: '#E3D7BB',
    hover:      '#EBE5D7', // 暖米 hover
    hoverDeep:  '#EAE0CC',
  },
  // ── 淡粉紫渐变系 ──
  aurora: {
    violet:     '#C4B5FD',
    pink:       '#F9C4E8',
    blue:       '#BFDBFE',
    violetBlue: '#DDD6FE',
    tintBg:     '#FBFAFE', // 近白带紫铺底（画布 / conv 干净底）
    tintBgAlt:  '#F7F5FC',
  },
  // ── 深棕黑（UI 元件文字 / 标签 / 图标·非内容彩色） ──
  ink: {
    primary:  '#4A3528', // 深棕（主标签）
    icon:     '#8A6D3B', // 暖棕图标
    muted:    '#9C917F', // 柔灰棕（次要）
    mutedAlt: '#6B6459',
  },
  // ── 品牌强调（橙棕·克制点缀·别滥用） ──
  accent: {
    brand:     '#C96442',
    brandDeep: '#9A5B3B',
  },
  // ── 咖啡色：钮字／描边／悬停底三档·组件里只引 token（⛔ 写死十六进制） ──
  // 顶栏 dock 圆角图标的底色渐层（左上亮→右下深·白色图示）；
  // drive＝最左「雲端硬碟」颗·取左栏「我的雲端硬碟」入口同一品牌陶土色（brand #C96442）上下各一档
  dock: {
    drive:  ['#E08F6B', '#B05433'],
    doc:    ['#6E9BFF', '#2F5FE0'],
    sheet:  ['#4FD69A', '#11A36A'],
    slides: ['#FFC24D', '#F08A1C'],
    site:   ['#B78A62', '#7A5236'],
    video:  ['#FF7A8C', '#E0344F'],
    board:  ['#6FCBFF', '#1E96E0'],
  },
  coffee: {
    text:   '#6F4E37', // 咖啡字
    border: '#C9AE95', // 咖啡描边（淡）
    hover:  '#F3ECE4', // 咖啡悬停底（极淡）
  },
  // ── 插画线稿（网站页空白态插画 `components/MySiteEmptyState.tsx` 写死的四个值收成 token·编辑页载入插画共用） ──
  illo: {
    ink:  '#6B5CA5', // 深紫轮廓／外框／眼睛
    base: '#E9E5F5', // 底座／地影／格线
    line: '#D6D0EE', // 骨架字条
    soft: '#F3F0FA', // 导航条／表头浅面
  },
  white: '#FFFFFF',
} as const;

// 淡粉紫渐变背景（conv 对话区 / 无限画布 inline style 复用·= globals.css `.hp-lavender` 同款）。
// 四角极淡 radial（紫·粉·蓝·紫蓝·比 idle hp-aurora 再调淡）+ 近白带紫线性铺底——
// 低饱和·氛围感·不搶内容（「淡淡的」「干净的」淡粉紫渐变）。
export const lavenderAuroraBg =
  'radial-gradient(58% 50% at 16% 6%,  rgba(196,181,253,0.18) 0%, rgba(196,181,253,0) 70%),' +
  'radial-gradient(56% 48% at 86% 10%, rgba(249,196,232,0.14) 0%, rgba(249,196,232,0) 68%),' +
  'radial-gradient(64% 56% at 80% 90%, rgba(191,219,254,0.14) 0%, rgba(191,219,254,0) 70%),' +
  'radial-gradient(52% 46% at 10% 86%, rgba(221,214,254,0.12) 0%, rgba(221,214,254,0) 70%),' +
  'linear-gradient(180deg, #FBFAFE 0%, #F7F5FC 100%)';

export type Palette = typeof palette;
