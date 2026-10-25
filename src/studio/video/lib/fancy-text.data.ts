// 花字库（56 款 15 类·CSS／Canvas 两种画法结果一致）·接法在 text.pure.ts 与 video-edit/VeditAssetTabs.tsx。
// 堤麟剪辑页「花字库」——自设计。不引外部字体、不外链图片，纹理只用 CSS 渐层拼。
// 同一笔 style 两种画法：fancyToCss(style) → 播放器叠字（层叠 span）；drawFancyText(ctx, text, style, box) → Canvas 2D 汇出成片。
// 单位约定：描边粗、阴影位移／模糊、字距、背景内距与圆角都以「字号 em」为单位，所以任何字号画出来比例一致。

export type FancyCat =
  | 'hot' | 'new' | 'autumn' | 'variety' | 'guofeng' | 'glow' | 'gradient' | 'texture'
  | 'red' | 'yellow' | 'mono' | 'blue' | 'pink' | 'green' | 'purple'

export const FANCY_CATS: { id: FancyCat; tw: string; cn: string; en: string }[] = [
  { id: 'hot', tw: '熱門', cn: '热门', en: 'Popular' },
  { id: 'new', tw: '最新', cn: '最新', en: 'New' },
  { id: 'autumn', tw: '秋日', cn: '秋日', en: 'Autumn' },
  { id: 'variety', tw: '綜藝感', cn: '综艺感', en: 'Variety' },
  { id: 'guofeng', tw: '國風', cn: '国风', en: 'Chinese' },
  { id: 'glow', tw: '發光', cn: '发光', en: 'Glow' },
  { id: 'gradient', tw: '漸變', cn: '渐变', en: 'Gradient' },
  { id: 'texture', tw: '紋理', cn: '纹理', en: 'Texture' },
  { id: 'red', tw: '紅色', cn: '红色', en: 'Red' },
  { id: 'yellow', tw: '黃色', cn: '黄色', en: 'Yellow' },
  { id: 'mono', tw: '黑白', cn: '黑白', en: 'Mono' },
  { id: 'blue', tw: '藍色', cn: '蓝色', en: 'Blue' },
  { id: 'pink', tw: '粉色', cn: '粉色', en: 'Pink' },
  { id: 'green', tw: '綠色', cn: '绿色', en: 'Green' },
  { id: 'purple', tw: '紫色', cn: '紫色', en: 'Purple' },
]

export type ColorStop = { at: number; color: string } // at 0~1
export type Fill =
  | { type: 'solid'; color: string }
  | { type: 'linear'; angle: number; stops: ColorStop[] } // angle 同 CSS：0＝往上，90＝往右
  | { type: 'radial'; stops: ColorStop[] } // 以字框中心、到最远角为半径（同 CSS farthest-corner）
export type Stroke = { color: string; width: number } // 由内往外排，width＝这一圈往外多出的 em
export type Shadow = { color: string; blur: number; x: number; y: number } // em；x=y=0 即发光
export type Texture =
  | { kind: 'stripes'; color: string; angle: number; size: number } // 条纹，size＝一组条纹宽 em（色条占一半）
  | { kind: 'dots'; color: string; size: number; radius: number } // 波点：格宽 em、点半径 em
  | { kind: 'grid'; color: string; size: number; line: number } // 网格：格宽 em、线粗 em
  | { kind: 'sheen'; color: string; angle: number } // 一道斜向高光带
export type FancyStyle = {
  family: 'sans' | 'serif' | 'mono' // mono＝文字栏的字体选项（等宽·浏览器一定有）·花字款式本身不用
  weight: number
  italic?: boolean
  letterSpacing?: number // em
  fill: Fill // 'transparent' 实心色可做空心字
  texture?: Texture // 叠在字面上（只盖字面，不盖描边）
  strokes?: Stroke[]
  shadows?: Shadow[] // 作用在最外圈轮廓上（含描边）
  bg?: { color: string; radius: number; padX: number; padY: number; shape?: BgShape } // 背景块（shape＝气泡形状）
  /** 站上字体（core/lib/fonts 那 12 款）的 CSS 字体栈·有 ⇒ 盖掉 family */
  stack?: string
}
/** 背景形状（「气泡」）：rect＝圆角方块（原样）·pill＝胶囊·speech＝对话框（左下一个尾巴）·thought＝想法泡泡（左下两颗小圆） */
export type BgShape = 'rect' | 'pill' | 'speech' | 'thought'
export type TailPart = { kind: 'tri'; pts: [number, number][] } | { kind: 'dot'; x: number; y: number; r: number }
/** 气泡的尾巴（em·原点＝背景块左下角·y 往下为正＝伸出块外）：CSS（fancyToCss tails）与 Canvas（drawBubbleTail）照同一份画 */
export const BUBBLE_TAIL: Record<'speech' | 'thought', readonly TailPart[]> = {
  speech: [{ kind: 'tri', pts: [[0.45, 0], [1.15, 0], [0.3, 0.6]] }],
  thought: [{ kind: 'dot', x: 0.75, y: 0.24, r: 0.17 }, { kind: 'dot', x: 0.42, y: 0.58, r: 0.1 }],
}
/** 胶囊的圆角（em·大到一定会被夹成半圆：CSS 照规范夹、Canvas roundRect 照规范等比缩） */
export const PILL_RADIUS = 99
export const tailOf = (shape: BgShape | undefined): readonly TailPart[] => (shape === 'speech' || shape === 'thought' ? BUBBLE_TAIL[shape] : [])
/** Canvas 画尾巴：(x0, bottom)＝背景块左下角像素·px＝字号 */
export function drawBubbleTail(ctx: CanvasRenderingContext2D, shape: BgShape | undefined, color: string, x0: number, bottom: number, px: number) {
  const parts = tailOf(shape)
  if (!parts.length) return
  ctx.save(); ctx.fillStyle = color
  for (const p of parts) {
    ctx.beginPath()
    if (p.kind === 'tri') p.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x0 + x * px, bottom + y * px) : ctx.moveTo(x0 + x * px, bottom + y * px)))
    else ctx.arc(x0 + p.x * px, bottom + p.y * px, p.r * px, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}
export type FancyItem = { id: string; name: { tw: string; cn: string; en: string }; cats: FancyCat[]; style: FancyStyle }

export const FANCY_FONTS = {
  sans: '"Noto Sans CJK SC","Noto Sans CJK TC","PingFang SC","PingFang TC","Microsoft YaHei","Microsoft JhengHei",sans-serif',
  serif: '"Noto Serif CJK SC","Noto Serif CJK TC","Songti SC","Songti TC","SimSun","PMingLiU",serif',
  mono: '"Noto Sans Mono CJK SC","Noto Sans Mono CJK TC","Menlo","Consolas","Courier New",monospace',
}
export const FANCY_LINE_HEIGHT = 1.25

// ── 小帮手 ──
const solid = (color: string): Fill => ({ type: 'solid', color })
const lin = (angle: number, ...colors: string[]): Fill => ({
  type: 'linear', angle, stops: colors.map((color, i) => ({ at: colors.length === 1 ? 0 : i / (colors.length - 1), color })),
})
const rad = (...colors: string[]): Fill => ({ type: 'radial', stops: colors.map((color, i) => ({ at: i / (colors.length - 1), color })) })
const st = (color: string, width: number): Stroke => ({ color, width })
const glow = (color: string, blur: number): Shadow => ({ color, blur, x: 0, y: 0 })
const drop = (color: string, x: number, y: number, blur = 0): Shadow => ({ color, blur, x, y })
const S = (o: Partial<FancyStyle> & { fill: Fill }): FancyStyle => ({ family: 'sans', weight: 900, ...o })
const item = (id: string, tw: string, cn: string, en: string, cats: FancyCat[], style: FancyStyle): FancyItem =>
  ({ id, name: { tw, cn, en }, cats, style })

export const FANCY_TEXTS: FancyItem[] = [
  // ── 红色 ──
  item('blaze', '烈焰', '烈焰', 'Blaze', ['red', 'gradient', 'glow', 'hot'],
    S({ fill: lin(180, '#FFF3A0', '#FFB020', '#E8261C'), strokes: [st('#7A0F0A', 0.06)], shadows: [glow('rgba(255,90,20,.85)', 0.22)] })),
  item('lantern', '燈籠紅', '灯笼红', 'Lantern', ['red', 'guofeng'],
    S({ family: 'serif', fill: solid('#D7261E'), strokes: [st('#F5C451', 0.05), st('#5A0C08', 0.05)], shadows: [drop('rgba(0,0,0,.45)', 0.03, 0.05, 0.04)] })),
  item('seal', '朱印', '朱印', 'Seal', ['red', 'guofeng'],
    S({ family: 'serif', fill: solid('#FFF6E6'), letterSpacing: 0.08, bg: { color: '#B8231B', radius: 0.08, padX: 0.28, padY: 0.12 } })),
  item('red-neon', '霓虹紅', '霓虹红', 'Red Neon', ['red', 'glow'],
    S({ weight: 700, fill: solid('#FFE3E3'), strokes: [st('#FF3B4A', 0.02)], shadows: [glow('#FF2A3A', 0.1), glow('rgba(255,40,60,.7)', 0.35)] })),
  item('laugh-red', '爆笑紅', '爆笑红', 'Big Laugh', ['red', 'variety', 'hot'],
    S({ fill: solid('#FFFFFF'), strokes: [st('#E8202A', 0.09), st('#1A0606', 0.04)], shadows: [drop('#1A0606', 0.06, 0.08)] })),
  item('candy-stripe', '糖果條紋', '糖果条纹', 'Candy Stripe', ['red', 'texture'],
    S({ fill: solid('#E6303C'), texture: { kind: 'stripes', color: 'rgba(255,255,255,.55)', angle: 45, size: 0.22 }, strokes: [st('#FFFFFF', 0.05), st('#7D1016', 0.04)] })),
  item('maple', '楓紅', '枫红', 'Maple', ['red', 'autumn', 'gradient'],
    S({ family: 'serif', fill: lin(160, '#FF9A3C', '#D93A1E', '#8E1B12'), strokes: [st('#FFE9C7', 0.035), st('#4A1A0C', 0.04)] })),
  item('alert', '警示', '警示', 'Alert', ['red', 'variety'],
    S({ italic: true, fill: solid('#FFFFFF'), letterSpacing: 0.04, bg: { color: '#E11D2A', radius: 0.12, padX: 0.3, padY: 0.1 }, shadows: [drop('rgba(0,0,0,.35)', 0.04, 0.05, 0.03)] })),

  // ── 黄色 ──
  item('gilded', '鎏金', '鎏金', 'Gilded', ['yellow', 'gradient', 'guofeng', 'texture', 'hot'],
    S({ family: 'serif', fill: lin(180, '#FFF4C2', '#F2C14E', '#B8801E', '#F7DA7A'), texture: { kind: 'sheen', color: 'rgba(255,255,255,.75)', angle: 120 },
      strokes: [st('#5B3A0E', 0.05)], shadows: [drop('rgba(40,20,0,.55)', 0.03, 0.05, 0.05)] })),
  item('variety-yellow', '綜藝黃', '综艺黄', 'Show Yellow', ['yellow', 'variety', 'hot'],
    S({ fill: solid('#FFD62E'), strokes: [st('#111111', 0.08)], shadows: [drop('#111111', 0.07, 0.09)] })),
  item('warm-sun', '暖陽', '暖阳', 'Warm Sun', ['yellow', 'gradient', 'autumn'],
    S({ fill: lin(180, '#FFE76A', '#FF9F2E'), strokes: [st('#FFFFFF', 0.06)], shadows: [glow('rgba(255,170,40,.7)', 0.25)] })),
  item('ginkgo', '銀杏', '银杏', 'Ginkgo', ['yellow', 'autumn'],
    S({ family: 'serif', fill: solid('#F3C623'), strokes: [st('#6B4310', 0.05)], shadows: [drop('rgba(80,45,0,.4)', 0.04, 0.06, 0.03)] })),
  item('yellow-dots', '波點黃', '波点黄', 'Yellow Dots', ['yellow', 'texture'],
    S({ fill: solid('#FFD43B'), texture: { kind: 'dots', color: 'rgba(230,120,0,.55)', size: 0.16, radius: 0.04 }, strokes: [st('#1C1C1C', 0.06)] })),
  item('golden-light', '金光', '金光', 'Golden Light', ['yellow', 'glow'],
    S({ weight: 800, fill: solid('#FFFBEA'), strokes: [st('#FFC93A', 0.02)], shadows: [glow('#FFB800', 0.12), glow('rgba(255,190,30,.6)', 0.4)] })),
  item('tape', '封箱膠帶', '封箱胶带', 'Caution Tape', ['yellow', 'mono', 'variety'],
    S({ fill: solid('#111111'), letterSpacing: 0.06, bg: { color: '#FFD000', radius: 0.03, padX: 0.26, padY: 0.08 } })),
  item('honey', '蜂蜜', '蜂蜜', 'Honey', ['yellow', 'gradient', 'autumn'],
    S({ italic: true, fill: rad('#FFE58A', '#F2A81D', '#B7680A'), strokes: [st('#5A3006', 0.05)], shadows: [drop('rgba(0,0,0,.3)', 0.03, 0.05, 0.04)] })),

  // ── 黑白 ──
  item('classic', '經典描邊', '经典描边', 'Classic', ['mono', 'hot'],
    S({ fill: solid('#FFFFFF'), strokes: [st('#000000', 0.07)] })),
  item('long-shadow', '長投影', '长投影', 'Long Shadow', ['mono'],
    S({ fill: solid('#FFFFFF'), strokes: [st('#222222', 0.03)], shadows: [drop('rgba(0,0,0,.85)', 0.08, 0.1, 0.02), drop('rgba(0,0,0,.4)', 0.16, 0.2, 0.06)] })),
  item('ink', '墨韻', '墨韵', 'Ink', ['mono', 'guofeng'],
    S({ family: 'serif', fill: solid('#141414'), strokes: [st('#F4EFE4', 0.04)], shadows: [glow('rgba(255,255,255,.35)', 0.15)] })),
  item('newsprint', '報刊', '报刊', 'Newsprint', ['mono'],
    S({ family: 'serif', fill: solid('#111111'), letterSpacing: 0.04, bg: { color: '#F2EFE8', radius: 0.02, padX: 0.24, padY: 0.08 } })),
  item('silver', '鏡面銀', '镜面银', 'Silver', ['mono', 'gradient'],
    S({ fill: lin(180, '#FFFFFF', '#B9BEC6', '#6C727C', '#E8EBEF'), strokes: [st('#2A2D33', 0.05)], shadows: [drop('rgba(0,0,0,.5)', 0.03, 0.05, 0.04)] })),
  item('blueprint-grid', '方格紙', '方格纸', 'Grid Paper', ['mono', 'texture'],
    S({ fill: solid('#FFFFFF'), texture: { kind: 'grid', color: 'rgba(0,0,0,.28)', size: 0.12, line: 0.012 }, strokes: [st('#000000', 0.06)] })),
  item('white-glow', '白光', '白光', 'White Glow', ['mono', 'glow'],
    S({ weight: 800, fill: solid('#FFFFFF'), shadows: [glow('rgba(255,255,255,.9)', 0.1), glow('rgba(255,255,255,.55)', 0.35)] })),
  item('hollow', '空心', '空心', 'Hollow', ['mono', 'new'],
    S({ fill: solid('rgba(0,0,0,0)'), strokes: [st('#FFFFFF', 0.035)] })),

  // ── 蓝色 ──
  item('ice', '冰晶', '冰晶', 'Ice', ['blue', 'gradient', 'glow'],
    S({ fill: lin(180, '#FFFFFF', '#BDEBFF', '#5CC2F2'), strokes: [st('#0E4E8A', 0.05)], shadows: [glow('rgba(110,210,255,.8)', 0.22)] })),
  item('blue-neon', '霓虹藍', '霓虹蓝', 'Blue Neon', ['blue', 'glow', 'hot'],
    S({ weight: 700, fill: solid('#E6FBFF'), strokes: [st('#2FD3FF', 0.02)], shadows: [glow('#00B7FF', 0.1), glow('rgba(0,170,255,.7)', 0.38)] })),
  item('ocean', '深海', '深海', 'Ocean', ['blue', 'gradient'],
    S({ fill: lin(180, '#6FD4FF', '#1E6FD9', '#0A2E7A'), strokes: [st('#FFFFFF', 0.05)], shadows: [drop('rgba(0,20,60,.5)', 0.03, 0.06, 0.05)] })),
  item('tech-scan', '科技掃描', '科技扫描', 'Tech Scan', ['blue', 'texture', 'new'],
    S({ italic: true, fill: lin(90, '#7BF1FF', '#2A8CFF'), texture: { kind: 'stripes', color: 'rgba(0,20,60,.45)', angle: 0, size: 0.08 },
      strokes: [st('#04203F', 0.04)], shadows: [glow('rgba(60,200,255,.6)', 0.18)] })),
  item('variety-blue', '綜藝藍', '综艺蓝', 'Show Blue', ['blue', 'variety'],
    S({ fill: solid('#FFFFFF'), strokes: [st('#1F6BFF', 0.09), st('#FFFFFF', 0.04)], shadows: [drop('rgba(0,30,90,.55)', 0.05, 0.08, 0.02)] })),
  item('blue-porcelain', '青花', '青花', 'Porcelain', ['blue', 'guofeng'],
    S({ family: 'serif', fill: solid('#1D3F94'), strokes: [st('#FFFFFF', 0.045), st('#8FB2E8', 0.03)] })),
  item('denim', '牛仔', '牛仔', 'Denim', ['blue', 'texture'],
    S({ fill: solid('#2F5F9E'), texture: { kind: 'stripes', color: 'rgba(255,255,255,.18)', angle: -35, size: 0.05 },
      strokes: [st('#E8C77A', 0.02), st('#162D4E', 0.05)] })),
  item('autumn-sky', '秋空', '秋空', 'Autumn Sky', ['blue', 'autumn'],
    S({ family: 'serif', weight: 800, fill: lin(180, '#E9F6FF', '#8CCBF2'), strokes: [st('#3A6E99', 0.04)], shadows: [drop('rgba(30,60,90,.35)', 0.03, 0.05, 0.05)] })),

  // ── 粉色 ──
  item('candy-pop', '糖果', '糖果', 'Candy Pop', ['pink', 'variety', 'hot'],
    S({ fill: solid('#FF6FB1'), strokes: [st('#FFFFFF', 0.08), st('#D13A82', 0.03)], shadows: [drop('rgba(160,30,90,.45)', 0.04, 0.07, 0.02)] })),
  item('sakura', '櫻花', '樱花', 'Sakura', ['pink', 'gradient'],
    S({ fill: lin(180, '#FFFFFF', '#FFC6DC', '#FF86B4'), strokes: [st('#B83A6E', 0.045)] })),
  item('pink-neon', '霓虹粉', '霓虹粉', 'Pink Neon', ['pink', 'glow'],
    S({ weight: 700, fill: solid('#FFEAF6'), strokes: [st('#FF4FB3', 0.02)], shadows: [glow('#FF3DAE', 0.1), glow('rgba(255,60,170,.65)', 0.38)] })),
  item('girl-dots', '少女波點', '少女波点', 'Polka Pink', ['pink', 'texture'],
    S({ fill: solid('#FF8EC0'), texture: { kind: 'dots', color: 'rgba(255,255,255,.75)', size: 0.15, radius: 0.035 }, strokes: [st('#A42A63', 0.05)] })),
  item('blush', '腮紅', '腮红', 'Blush', ['pink', 'gradient', 'new'],
    S({ fill: rad('#FFF0F5', '#FFA3C4', '#F25B95'), strokes: [st('#FFFFFF', 0.04), st('#C23E77', 0.03)] })),
  item('peach-blossom', '桃花', '桃花', 'Peach Blossom', ['pink', 'guofeng'],
    S({ family: 'serif', fill: solid('#F7A6BE'), strokes: [st('#8C1B3E', 0.045)], shadows: [glow('rgba(255,180,200,.6)', 0.15)] })),
  item('bubble', '泡泡', '泡泡', 'Bubble', ['pink', 'variety'],
    S({ fill: solid('#FFFFFF'), strokes: [st('#FF5CA8', 0.05)], bg: { color: '#FFD6EA', radius: 0.5, padX: 0.32, padY: 0.1 } })),
  item('sunset-pink', '晚霞', '晚霞', 'Afterglow', ['pink', 'autumn', 'gradient'],
    S({ fill: lin(90, '#FF7EB3', '#FF9E6B', '#FFC857'), strokes: [st('#6E2340', 0.045)], shadows: [glow('rgba(255,130,120,.55)', 0.2)] })),

  // ── 绿色 ──
  item('matcha', '抹茶', '抹茶', 'Matcha', ['green', 'new'],
    S({ fill: solid('#7DAA3F'), strokes: [st('#FFF7E1', 0.06), st('#3B5418', 0.03)] })),
  item('lime-neon', '螢光綠', '荧光绿', 'Lime Neon', ['green', 'glow'],
    S({ weight: 700, fill: solid('#F1FFE3'), strokes: [st('#7CFF4E', 0.02)], shadows: [glow('#4CFF3A', 0.1), glow('rgba(80,255,60,.6)', 0.36)] })),
  item('jade', '翡翠', '翡翠', 'Jade', ['green', 'guofeng', 'gradient'],
    S({ family: 'serif', fill: lin(180, '#C9F4D6', '#3FAE73', '#0F5C3A'), strokes: [st('#E8C569', 0.04), st('#123326', 0.03)] })),
  item('leaf-vein', '葉脈', '叶脉', 'Leaf Vein', ['green', 'texture'],
    S({ fill: solid('#3DAA4F'), texture: { kind: 'stripes', color: 'rgba(220,255,200,.35)', angle: 60, size: 0.1 }, strokes: [st('#14381B', 0.05)] })),
  item('variety-green', '綜藝綠', '综艺绿', 'Show Green', ['green', 'variety'],
    S({ fill: solid('#9BF03C'), strokes: [st('#0E1A06', 0.08)], shadows: [drop('#0E1A06', 0.07, 0.09)] })),
  item('mint', '薄荷', '薄荷', 'Mint', ['green', 'gradient'],
    S({ fill: lin(180, '#E8FFF6', '#7FE3C0'), strokes: [st('#FFFFFF', 0.05), st('#1E8C6A', 0.03)] })),
  item('olive-autumn', '橄欖秋', '橄榄秋', 'Olive Autumn', ['green', 'autumn', 'gradient'],
    S({ family: 'serif', fill: lin(180, '#C9C25A', '#8A8A2E', '#C77A2A'), strokes: [st('#3D2A10', 0.045)] })),
  item('terminal', '終端', '终端', 'Terminal', ['green', 'new'],
    S({ weight: 700, fill: solid('#39FF7A'), letterSpacing: 0.06, shadows: [glow('rgba(57,255,122,.6)', 0.12)], bg: { color: '#0B1410', radius: 0.08, padX: 0.26, padY: 0.1 } })),

  // ── 紫色 ──
  item('galaxy', '星河', '星河', 'Galaxy', ['purple', 'gradient', 'texture', 'glow', 'hot'],
    S({ fill: lin(120, '#4B2BBF', '#9B3BE0', '#FF6FC8'), texture: { kind: 'dots', color: 'rgba(255,255,255,.85)', size: 0.21, radius: 0.016 },
      strokes: [st('#FFFFFF', 0.03)], shadows: [glow('rgba(160,90,255,.75)', 0.25)] })),
  item('purple-neon', '霓虹紫', '霓虹紫', 'Purple Neon', ['purple', 'glow'],
    S({ weight: 700, fill: solid('#F4E8FF'), strokes: [st('#B45CFF', 0.02)], shadows: [glow('#A23BFF', 0.1), glow('rgba(160,60,255,.65)', 0.38)] })),
  item('grape', '葡萄', '葡萄', 'Grape', ['purple', 'variety'],
    S({ fill: solid('#8E44D9'), strokes: [st('#FFFFFF', 0.08), st('#4A1580', 0.03)], shadows: [drop('rgba(60,10,110,.5)', 0.05, 0.07, 0.02)] })),
  item('lavender', '薰衣草', '薰衣草', 'Lavender', ['purple', 'gradient', 'new'],
    S({ fill: lin(180, '#F6EEFF', '#C9A7F5', '#9370DB'), strokes: [st('#4F2E85', 0.04)] })),
  item('royal-purple', '紫金', '紫金', 'Royal', ['purple', 'guofeng'],
    S({ family: 'serif', fill: solid('#5B2A86'), strokes: [st('#F0C75E', 0.05), st('#2A0F42', 0.03)], shadows: [drop('rgba(0,0,0,.4)', 0.03, 0.05, 0.04)] })),
  item('dusk', '暮色', '暮色', 'Dusk', ['purple', 'autumn', 'gradient'],
    S({ fill: lin(180, '#FFB86B', '#E0607E', '#6B3FA0'), strokes: [st('#2B1238', 0.045)], shadows: [glow('rgba(230,110,120,.45)', 0.18)] })),
  item('vapor', '蒸汽波', '蒸汽波', 'Vaporwave', ['purple', 'texture', 'new'],
    S({ italic: true, fill: lin(180, '#FF71CE', '#B967FF', '#01CDFE'), texture: { kind: 'grid', color: 'rgba(255,255,255,.35)', size: 0.13, line: 0.012 },
      strokes: [st('#24123F', 0.045)], shadows: [drop('#01CDFE', 0.05, 0.06)] })),
  item('plum-tag', '梅紫標籤', '梅紫标签', 'Plum Tag', ['purple', 'new'],
    S({ fill: solid('#FFFFFF'), letterSpacing: 0.04, bg: { color: '#7B2D7F', radius: 0.18, padX: 0.3, padY: 0.1 }, shadows: [drop('rgba(0,0,0,.3)', 0.03, 0.05, 0.04)] })),
]

// ════════════════ 画法一：CSS（层叠 span） ════════════════
// 回传：box＝外框样式；layers＝由下往上几层，每层放同一段字、全部叠在同一格（display:grid; 每层 grid-area:1/1）。
// 用法：<span style={box}>{layers.map((l,i)=><span key={i} style={l} aria-hidden={i<layers.length-1}>{text}</span>)}</span>
// fontSize 由外层给（px），本函数全用 em。
type Css = Record<string, string>

const stopsCss = (s: ColorStop[]) => s.map(x => `${x.color} ${(x.at * 100).toFixed(1)}%`).join(',')
export function fillToCss(f: Fill): string {
  if (f.type === 'solid') return `linear-gradient(${f.color},${f.color})`
  if (f.type === 'linear') return `linear-gradient(${f.angle}deg,${stopsCss(f.stops)})`
  return `radial-gradient(farthest-corner at 50% 50%,${stopsCss(f.stops)})`
}
export function textureToCss(t: Texture): { image: string; size: string } {
  switch (t.kind) {
    case 'stripes': return { image: `repeating-linear-gradient(${t.angle}deg,${t.color} 0 ${t.size / 2}em,transparent ${t.size / 2}em ${t.size}em)`, size: 'auto' }
    case 'dots': return { image: `radial-gradient(circle at 50% 50%,${t.color} 0 ${t.radius}em,transparent ${t.radius + 0.004}em)`, size: `${t.size}em ${t.size}em` }
    case 'grid': return { image: `linear-gradient(0deg,${t.color} 0 ${t.line}em,transparent ${t.line}em),linear-gradient(90deg,${t.color} 0 ${t.line}em,transparent ${t.line}em)`, size: `${t.size}em ${t.size}em` }
    case 'sheen': return { image: `linear-gradient(${t.angle}deg,transparent 30%,${t.color} 45%,transparent 60%)`, size: 'auto' }
  }
}

export function fancyToCss(style: FancyStyle): { box: Css; layers: Css[]; tails: Css[] } {
  const font: Css = {
    fontFamily: style.stack ?? FANCY_FONTS[style.family], fontWeight: String(style.weight), fontStyle: style.italic ? 'italic' : 'normal',
    letterSpacing: `${style.letterSpacing ?? 0}em`, lineHeight: String(FANCY_LINE_HEIGHT), whiteSpace: 'pre',
  }
  // 每层都 position:relative，否则带 filter 的阴影层会被浏览器提到普通层之上（盖住描边和字面）
  const cell: Css = { gridArea: '1 / 1', position: 'relative', ...font }
  const box: Css = { display: 'inline-grid', ...font }
  if (style.bg) Object.assign(box, { background: style.bg.color, borderRadius: `${style.bg.radius}em`, padding: `${style.bg.padY}em ${style.bg.padX}em` })
  // 气泡尾巴：贴在背景块左下·伸出块外（box 要 relative 才定得住）
  const tails: Css[] = []
  if (style.bg) for (const p of tailOf(style.bg.shape)) {
    if (p.kind === 'tri') {
      const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1])
      const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0
      tails.push({ position: 'absolute', left: `${x0}em`, top: `calc(100% + ${y0}em)`, width: `${w}em`, height: `${h}em`, background: style.bg.color,
        clipPath: `polygon(${p.pts.map(([x, y]) => `${(((x - x0) / w) * 100).toFixed(2)}% ${(((y - y0) / h) * 100).toFixed(2)}%`).join(',')})` })
    } else tails.push({ position: 'absolute', left: `${p.x - p.r}em`, top: `calc(100% + ${p.y - p.r}em)`, width: `${p.r * 2}em`, height: `${p.r * 2}em`, borderRadius: '50%', background: style.bg.color })
  }
  if (tails.length) box.position = 'relative'
  const strokes = style.strokes ?? []
  const cum = strokes.map((_, i) => strokes.slice(0, i + 1).reduce((a, s) => a + s.width, 0))
  const layers: Css[] = []
  const outerColor = strokes.length ? strokes[strokes.length - 1].color : (style.fill.type === 'solid' ? style.fill.color : style.fill.stops[0].color)
  // 阴影层：最外圈轮廓画一次，挂 drop-shadow（canvas 那边也是对最外圈轮廓下阴影）
  for (const sh of style.shadows ?? []) {
    layers.push({ ...cell, color: outerColor, WebkitTextStroke: strokes.length ? `${cum[cum.length - 1] * 2}em ${outerColor}` : '0',
      filter: `drop-shadow(${sh.x}em ${sh.y}em ${sh.blur / 2}em ${sh.color})` })
  }
  // 描边层：由外往内，每层笔画宽＝累计宽×2（一半落在字面内，会被上一层盖掉）
  for (let i = strokes.length - 1; i >= 0; i--) {
    layers.push({ ...cell, color: 'transparent', WebkitTextStroke: `${cum[i] * 2}em ${strokes[i].color}`, strokeLinejoin: 'round' })
  }
  // 字面层：渐层（＋纹理）以 background-clip:text 裁成字形
  const images = [fillToCss(style.fill)]
  const sizes = ['100% 100%']
  if (style.texture) { const t = textureToCss(style.texture); images.unshift(t.image); sizes.unshift(t.size) }
  layers.push({ ...cell, color: 'transparent', backgroundImage: images.join(','), backgroundSize: sizes.join(','),
    WebkitBackgroundClip: 'text', backgroundClip: 'text' })
  return { box, layers, tails }
}

// ════════════════ 画法二：Canvas 2D ════════════════
// box：{ x, y, fontSize }，(x,y)＝整块（含背景块）左上角。回传实际画出的宽高（含背景内距），给排版用。
export type FancyBox = { x: number; y: number; fontSize: number }

function fontStr(style: FancyStyle, px: number) {
  return `${style.italic ? 'italic ' : ''}${style.weight} ${px}px ${style.stack ?? FANCY_FONTS[style.family]}`
}
function setSpacing(ctx: CanvasRenderingContext2D, style: FancyStyle, px: number) {
  ;(ctx as any).letterSpacing = `${(style.letterSpacing ?? 0) * px}px`
}
export function measureFancy(ctx: CanvasRenderingContext2D, text: string, style: FancyStyle, fontSize: number) {
  ctx.save(); ctx.font = fontStr(style, fontSize); setSpacing(ctx, style, fontSize)
  const w = ctx.measureText(text).width; ctx.restore()
  const h = fontSize * FANCY_LINE_HEIGHT
  const padX = style.bg ? style.bg.padX * fontSize : 0, padY = style.bg ? style.bg.padY * fontSize : 0
  return { textW: w, textH: h, w: w + padX * 2, h: h + padY * 2, padX, padY }
}
function fillToCanvas(ctx: CanvasRenderingContext2D, f: Fill, x: number, y: number, w: number, h: number): string | CanvasGradient {
  if (f.type === 'solid') return f.color
  if (f.type === 'linear') {
    const a = (f.angle * Math.PI) / 180, dx = Math.sin(a), dy = -Math.cos(a)
    const half = Math.abs((w / 2) * dx) + Math.abs((h / 2) * dy), cx = x + w / 2, cy = y + h / 2
    const g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half)
    f.stops.forEach(s => g.addColorStop(s.at, s.color)); return g
  }
  const cx = x + w / 2, cy = y + h / 2, r = Math.hypot(w / 2, h / 2)
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  f.stops.forEach(s => g.addColorStop(s.at, s.color)); return g
}
function paintTexture(ctx: CanvasRenderingContext2D, t: Texture, x: number, y: number, w: number, h: number, px: number) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
  if (t.kind === 'sheen') {
    const a = (t.angle * Math.PI) / 180, dx = Math.sin(a), dy = -Math.cos(a)
    const half = Math.abs((w / 2) * dx) + Math.abs((h / 2) * dy), cx = x + w / 2, cy = y + h / 2
    const g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half)
    g.addColorStop(0.3, 'rgba(0,0,0,0)'); g.addColorStop(0.45, t.color); g.addColorStop(0.6, 'rgba(0,0,0,0)')
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h)
  } else if (t.kind === 'stripes') {
    // 同 CSS repeating-linear-gradient：沿 angle 方向每 size 一组，前半段上色；起点在框中心往回 half
    const a = (t.angle * Math.PI) / 180, dx = Math.sin(a), dy = -Math.cos(a)
    const half = Math.abs((w / 2) * dx) + Math.abs((h / 2) * dy), cx = x + w / 2, cy = y + h / 2
    const sx = cx - dx * half, sy = cy - dy * half, size = t.size * px, n = Math.ceil((half * 2) / size) + 1
    ctx.fillStyle = t.color
    for (let i = 0; i < n; i++) {
      const o0 = i * size, o1 = o0 + size / 2, L = w + h
      ctx.beginPath()
      ctx.moveTo(sx + dx * o0 - dy * L, sy + dy * o0 + dx * L); ctx.lineTo(sx + dx * o1 - dy * L, sy + dy * o1 + dx * L)
      ctx.lineTo(sx + dx * o1 + dy * L, sy + dy * o1 - dx * L); ctx.lineTo(sx + dx * o0 + dy * L, sy + dy * o0 - dx * L)
      ctx.fill()
    }
  } else {
    const size = t.size * px; ctx.fillStyle = t.color
    for (let gx = x; gx < x + w; gx += size) for (let gy = y; gy < y + h; gy += size) {
      if (t.kind === 'dots') { ctx.beginPath(); ctx.arc(gx + size / 2, gy + size / 2, t.radius * px, 0, Math.PI * 2); ctx.fill() }
      else { ctx.fillRect(gx, gy + size - t.line * px, size, t.line * px); ctx.fillRect(gx, gy, t.line * px, size) }
    }
  }
  ctx.restore()
}

export function drawFancyText(ctx: CanvasRenderingContext2D, text: string, style: FancyStyle, box: FancyBox) {
  const px = box.fontSize, m = measureFancy(ctx, text, style, px)
  const tx = box.x + m.padX, ty = box.y + m.padY // 字框左上
  ctx.save()
  if (style.bg) {
    ctx.fillStyle = style.bg.color; ctx.beginPath()
    ;(ctx as any).roundRect(box.x, box.y, m.w, m.h, style.bg.radius * px); ctx.fill()
    drawBubbleTail(ctx, style.bg.shape, style.bg.color, box.x, box.y + m.h, px)
  }
  ctx.font = fontStr(style, px); setSpacing(ctx, style, px)
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.miterLimit = 2
  const by = ty + m.textH / 2
  const strokes = style.strokes ?? []
  const cum = strokes.map((_, i) => strokes.slice(0, i + 1).reduce((a, s) => a + s.width, 0))
  const outerColor = strokes.length ? strokes[strokes.length - 1].color : (style.fill.type === 'solid' ? style.fill.color : style.fill.stops[0].color)
  for (const sh of style.shadows ?? []) {
    ctx.save()
    ctx.shadowColor = sh.color; ctx.shadowBlur = sh.blur * px; ctx.shadowOffsetX = sh.x * px; ctx.shadowOffsetY = sh.y * px
    ctx.fillStyle = outerColor; ctx.strokeStyle = outerColor
    if (strokes.length) { ctx.lineWidth = cum[cum.length - 1] * 2 * px; ctx.strokeText(text, tx, by) }
    ctx.fillText(text, tx, by)
    ctx.restore()
  }
  for (let i = strokes.length - 1; i >= 0; i--) {
    ctx.strokeStyle = strokes[i].color; ctx.lineWidth = cum[i] * 2 * px; ctx.strokeText(text, tx, by)
  }
  // 字面：先在离屏画布画字形，再 source-in 填渐层、source-atop 叠纹理，最后贴回
  const W = Math.ceil(m.textW + px), H = Math.ceil(m.textH + px), ox = px / 2, oy = px / 2
  const off = (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H })) as any
  const o: CanvasRenderingContext2D = off.getContext('2d')
  o.font = fontStr(style, px); setSpacing(o, style, px); o.textBaseline = 'middle'; o.textAlign = 'left'
  o.fillStyle = '#000'; o.fillText(text, ox, oy + m.textH / 2)
  o.globalCompositeOperation = 'source-in'
  o.fillStyle = fillToCanvas(o, style.fill, ox, oy, m.textW, m.textH); o.fillRect(0, 0, W, H)
  if (style.texture) { o.globalCompositeOperation = 'source-atop'; paintTexture(o, style.texture, ox, oy, m.textW, m.textH, px) }
  ctx.drawImage(off, tx - ox, ty - oy)
  ctx.restore()
  return { w: m.w, h: m.h }
}
