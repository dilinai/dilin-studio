/**
 * slide-kit · 组件化简报的资料契约
 *
 * 一页简报＝一堆组件叠成·每个组件被一个矩形框住；
 * 画布上只动框（长宽／移动／旋转／叠层）·组件内部（字体、颜色、图片、视频…）在下方清单改；给 agent 的工具同样组件导向。
 *
 * 存法：仍是 deck_data version:2（写路／生成／恢复的 WHERE 都钉 version='2'），每页只**加**可选栏：
 *   page.components   有这栏＝本页已物化；数组顺序＝叠层（0 最底·最后一个最顶）·⛔ 另存 z 值
 *   page.animations   本页动画序列（播放顺序）
 *   page.background   页底（缺省＝主题色板 bg）
 * 没物化的页＝读时按版式蓝图派生（纯函数·服务端与浏览器同一份）·首次被组件／动画操作动到才写进 components。
 *
 * 纯类型＋常量·零依赖（除 slide-kit/types 的 CropRect）⇒ 客户端／服务端／单测三方同一份。
 */

import type { CropRect } from '../types'
import type { Frame, ZMove } from '../../../shared/frame-kit/types'
import type { MediaAnimEffect, MediaAnimFields, ProgramAnimFields, ProgramFields } from './program-types'

/** 组件资料栏位的版本（将来不兼容改动时 +1；deck_data 顶层不写·读侧按形状判） */
export const COMPONENTS_SCHEMA_VERSION = 1

/* ------------------------------------------------------------------ */
/* 颜色 · 字体（可存「主题记号」：换模板时照主题走的自动换）             */
/* ------------------------------------------------------------------ */

/** 主题色记号（前 8 个＝resolvePalette 的页色板·按本页页型解析；primary／secondary＝主题原值） */
export const THEME_COLOR_TOKENS = [
  'bg', 'surface', 'border', 'text', 'muted', 'accent', 'onAccent', 'figureBg', 'primary', 'secondary',
] as const
export type ThemeColorToken = (typeof THEME_COLOR_TOKENS)[number]

/** 颜色：'#RRGGBB'／'#RRGGBBAA'（大小写不拘·落库正规成大写）或 'theme:<记号>' */
export type ColorValue = `#${string}` | `theme:${ThemeColorToken}`

/** 字体：'theme:heading'／'theme:body'（跟主题的标题／正文字体）或 lib/fonts/catalog 的 id */
export type FontValue = 'theme:heading' | 'theme:body' | string

/* ------------------------------------------------------------------ */
/* 框（逻辑画布 1000×562.5·原点左上·旋转以框中心为轴顺时针·单位度）       */
/* ------------------------------------------------------------------ */

// Frame／ZMove 本体在 lib/frame-kit/types（简报／云文档／云表格共用）·这里原名转出
export type { Frame, ZMove }

/* ------------------------------------------------------------------ */
/* 文字（段落＋片段·⛔ HTML 串：逐栏白名单校验·渲染一律转义）            */
/* ------------------------------------------------------------------ */

export type TextAlign = 'left' | 'center' | 'right' | 'justify' | 'distribute'
export type VAlign = 'top' | 'middle' | 'bottom'

export type TextRun = {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  sup?: boolean
  sub?: boolean
  color?: ColorValue
  /** 高亮（字底色） */
  highlight?: ColorValue
  font?: FontValue
  /** 字号（逻辑像素） */
  size?: number
  shadow?: boolean
}

export type ListStyle =
  | { kind: 'ul'; style: 'disc' | 'circle' | 'square' }
  | { kind: 'ol'; style: 'decimal' | 'lower-alpha' | 'lower-roman' }

export type TextParagraph = {
  runs: TextRun[]
  /** 不给＝用 box.align */
  align?: TextAlign
  list?: ListStyle
  /** 缩进层级 0–8 */
  indent?: number
  /** 行距倍数（不给＝box.lineHeight） */
  lineHeight?: number
}

export type Stroke = { color: ColorValue; width: number; dash?: 'solid' | 'dashed' | 'dotted' }

/** 文字框（整框的默认样式·片段上的样式盖过它） */
export type TextBox = {
  font: FontValue
  size: number
  color: ColorValue
  bold?: boolean
  italic?: boolean
  align: TextAlign
  valign: VAlign
  /** 行距倍数 */
  lineHeight: number
  /** 字距（逻辑像素） */
  letterSpacing?: number
  /** 内距（逻辑像素） */
  padding: number
  fill?: ColorValue
  border?: Stroke
  radius?: number
  /** 超出按行截断加省略号（版式派生的框默认开·与旧版式 clamp 同效） */
  clamp?: boolean
  /** clamp 的行数上限（给了＝最多这么多行·字可以超出框底往下长·与旧版式同效；不给＝按框高能放几行算） */
  maxLines?: number
}

export type TextBody = { paragraphs: TextParagraph[]; box: TextBox }

/* ------------------------------------------------------------------ */
/* 组件                                                               */
/* ------------------------------------------------------------------ */

/** 第一版组件种类（先按常用拟一版·看成品再增删）；html＝内部用（只包旧页／手动排版层）；
 *  group＝组合（平滑切换·只一层：子件不能再是 group／html·不进「新增」菜单·由 component_group 合成）；
 *  program＝程序动画（HTML＋JS／canvas·一律进 sandbox iframe·能吃「下一步」·栏位见 program-types.ts） */
export const COMPONENT_TYPES = ['text', 'image', 'video', 'shape', 'table', 'chart', 'html', 'group', 'program'] as const
export type ComponentType = (typeof COMPONENT_TYPES)[number]
/** 新增菜单与 AI 工具能建的种类（⛔ html） */
export const CREATABLE_COMPONENT_TYPES = ['text', 'image', 'video', 'shape', 'table', 'chart', 'program'] as const
export type CreatableComponentType = (typeof CREATABLE_COMPONENT_TYPES)[number]

/** 语义角色（清单显示名／标题回写 draft／工具回报给 AI 看） */
export const COMPONENT_ROLES = [
  'title', 'subtitle', 'lead', 'eyebrow', 'item', 'itemNumber', 'partNumber',
  'contentsTitle', 'contentsItem', 'footer', 'decor', 'card',
  'background', 'backgroundMask', 'pageFigure', 'itemFigure', 'legacyHtml',
] as const
export type ComponentRole = (typeof COMPONENT_ROLES)[number]

type ComponentBase<T extends ComponentType> = {
  /** deck 内唯一·见 COMPONENT_ID_RE */
  id: string
  type: T
  /** 用户起的名字（清单显示·不给＝按 role／type 给默认名） */
  name?: string
  role?: ComponentRole
  /** 条目序（role=item／itemNumber／contentsItem／itemFigure／card 时有） */
  roleIndex?: number
  frame: Frame
  /** 0–1（不给＝1） */
  opacity?: number
  /** 锁定：画布上只能选中、不能拖动缩放旋转（清单里解锁） */
  locked?: boolean
  hidden?: boolean
  /** 平滑切换（morph）配对键：复制页时子页组件记「来源组件的键」（来源没有＝来源编号）·两页同键＝同一个物件补间；
   *  不给＝用自己的编号。名称以 !! 开头（PowerPoint 同款）另按名称配对（优先） */
  morphKey?: string
}

export type TextComponent = ComponentBase<'text'> & TextBody

export type ImageComponent = ComponentBase<'image'> & {
  /** 空串＝主题占位块（不裂图） */
  src: string
  /** 百分比裁剪窗（相对原图） */
  crop?: CropRect
  fit: 'cover' | 'contain'
  radius?: number
  border?: Stroke
  flipX?: boolean
  flipY?: boolean
}

export type VideoComponent = ComponentBase<'video'> & {
  src: string
  poster?: string
  autoplay?: boolean
  loop?: boolean
  muted?: boolean
  /** 不给＝显示控制列 */
  controls?: boolean
  fit: 'cover' | 'contain'
}

/**
 * 形状种类（清单下拉按这个顺序）。加：
 *   ring            圆环（甜甜圈）·给 arc＝块弧（只画 start→end 那一段环带）·环带厚度 thickness
 *   arc             弧线（只描边·不填色）：沿框内椭圆从 arc.start 画到 arc.end·线宽＝stroke.width·两端箭头＝lineEnds
 *   callout         对话框（圆角框＋尾巴）·尾巴＝callout {side,pos,len}
 *   summingJunction 流程图「或者」（圆里一个 X）
 */
export const SHAPE_KINDS = ['rect', 'roundRect', 'ellipse', 'ring', 'arc', 'triangle', 'diamond', 'arrow', 'callout', 'summingJunction', 'line'] as const
export type ShapeKind = (typeof SHAPE_KINDS)[number]
export type LineEnd = 'none' | 'arrow'

/** 填色方式：不给＝纯色 fill；gradient＝线性渐层；pageBackground＝「幻灯片背景填充」（透出本页底图／底色·按页面坐标对齐·旋转也对齐） */
export const SHAPE_FILL_MODES = ['gradient', 'pageBackground'] as const
export type ShapeFillMode = (typeof SHAPE_FILL_MODES)[number]

/** 线性渐层：angle＝方向（度·0＝由左到右·90＝由上到下·顺时针）；stops 2–8 个（pos 0–100·颜色可带透明度 #RRGGBBAA） */
export type GradientStop = { pos: number; color: ColorValue }
export type LinearGradient = { angle: number; stops: GradientStop[] }

/** 外阴影（PowerPoint 外部阴影同参）：angle 度（0＝往右·90＝往下）·distance／blur 逻辑像素 */
export type ShapeShadow = { color: ColorValue; blur: number; distance: number; angle: number }

/** 弧角（度·0＝三点钟方向·顺时针·与 PowerPoint 同） */
export type ArcAngles = { start: number; end: number }

/** 对话框尾巴：side＝尾巴长在哪一边；pos＝沿那一边的位置（0–100%）；len＝伸出去多长（逻辑像素） */
export type CalloutTail = { side: 'top' | 'right' | 'bottom' | 'left'; pos: number; len: number }

export type ShapeComponent = ComponentBase<'shape'> & {
  shape: ShapeKind
  /** null／不给＝无填色（line／arc 忽略） */
  fill?: ColorValue | null
  stroke?: Stroke | null
  /** roundRect／callout 圆角（逻辑像素） */
  radius?: number
  /** line／arc 两端（不给＝none） */
  lineEnds?: { start?: LineEnd; end?: LineEnd }
  /** 形状里的字（可改字） */
  text?: TextBody
  /** 填色方式（不给＝纯色 fill） */
  fillMode?: ShapeFillMode
  /** fillMode=gradient 用的渐层（没给就退回 fill） */
  gradient?: LinearGradient
  shadow?: ShapeShadow
  /** ring（块弧）／arc 的起讫角（不给：ring＝整圈·arc＝0→270） */
  arc?: ArcAngles
  /** ring 环带厚度（占短边的比例 0.02–0.5·不给＝0.2） */
  thickness?: number
  /** callout 尾巴（不给＝下边 25%·伸 40） */
  callout?: CalloutTail
  /** 毛玻璃：把形状后面的东西模糊（逻辑像素 1–40）·pptx 没有对应 ⇒ 只留半透明填色 */
  backdropBlur?: number
}

/** 组合：children 的 frame＝组框内的局部坐标（组未旋转时·原点＝组框左上）；组的旋转／移动带着子件一起绕组中心转；
 *  组框改宽高 ⇒ 子件框按比例缩放（写操作当场换算·存的永远是现尺寸下的局部坐标） */
export type GroupComponent = ComponentBase<'group'> & { children: SlideComponent[] }

export type TableCell = { paragraphs: TextParagraph[]; fill?: ColorValue }
export type TableStyle = {
  font: FontValue
  size: number
  color: ColorValue
  headerFill: ColorValue
  headerColor: ColorValue
  bandFill?: ColorValue
  borderColor: ColorValue
}
export type TableComponent = ComponentBase<'table'> & {
  /** cells[行][列]·每行等长 */
  cells: TableCell[][]
  /** 各列占总宽的百分比（和＝100） */
  colWidths: number[]
  /** 第一行当标题列 */
  header: boolean
  style: TableStyle
}

export const CHART_KINDS = ['column', 'bar', 'line', 'pie', 'doughnut'] as const
export type ChartKind = (typeof CHART_KINDS)[number]
export type ChartSeries = { name: string; values: number[] }
export type ChartComponent = ComponentBase<'chart'> & {
  chart: ChartKind
  labels: string[]
  /** pie／doughnut 只取第一组 */
  series: ChartSeries[]
  /** 不给＝按主题色轮换 */
  colors?: ColorValue[]
  legend: boolean
  showValues: boolean
  font?: FontValue
  textColor?: ColorValue
}

/** 内部用：已净化的旧页 HTML（整页 section 内容·含 .sk-stage 壳或旧 AI 整页片段）·⛔ AI／新增菜单建它 */
export type HtmlComponent = ComponentBase<'html'> & {
  html: string
  /** 旧整页简报另存组件版时带的 <head> 内样式（有它＝一律在隔离 iframe 里渲·免得旧 CSS 串到别页） */
  head?: string
  /** 内容的设计尺寸（手动排版层＝1000×562.5；旧整页简报＝1024×768）·渲染时等比缩进框里 */
  designW?: number
  designH?: number
}

/** 程序动画：内容栏照 program-types.ts·渲染一律进 sandbox="allow-scripts" iframe（放映产物也是·⛔ 内联） */
export type ProgramComponent = ComponentBase<'program'> & ProgramFields

export type SlideComponent =
  | TextComponent
  | ImageComponent
  | VideoComponent
  | ShapeComponent
  | TableComponent
  | ChartComponent
  | HtmlComponent
  | GroupComponent
  | ProgramComponent

/* ------------------------------------------------------------------ */
/* 动画（页级有序数组·挂组件 id·与组件解耦）                             */
/* ------------------------------------------------------------------ */

export type AnimPhase = 'enter' | 'emphasis' | 'exit'
export type AnimDirection = 'left' | 'right' | 'up' | 'down'
export type AnimTrigger = 'click' | 'with' | 'after'

/** 第一版基础动画（授权先拟）：进场 8／强调 3／退场 4 */
export const ANIM_EFFECTS = {
  enter: ['appear', 'fade', 'fly', 'float', 'wipe', 'zoom', 'spin', 'bounce'],
  emphasis: ['pulse', 'teeter', 'grow'],
  exit: ['disappear', 'fade', 'fly', 'zoom'],
} as const
export type AnimEffect = (typeof ANIM_EFFECTS)[AnimPhase][number]
/** 要方向的效果（其余忽略 direction） */
export const DIRECTIONAL_EFFECTS: readonly string[] = ['fly', 'wipe']

export type AnimSpec = {
  effect: AnimEffect
  direction?: AnimDirection
  trigger: AnimTrigger
  durationMs: number
  delayMs: number
}

/** 基础动画（进场／强调／退场·CSS 关键帧） */
export type BasicSlideAnimation = AnimSpec & {
  id: string
  componentId: string
  phase: AnimPhase
}

/** 影片步骤／程序步骤共有的栏（trigger／delayMs 与基础动画同义） */
type StepAnimBase = { id: string; componentId: string; trigger: AnimTrigger; durationMs: number; delayMs: number }
/** 影片步骤（挂 video 组件·durationMs 存 0） */
export type MediaSlideAnimation = StepAnimBase & MediaAnimFields
/** 程序步骤（挂 program 组件·每条＝程序往前一步·durationMs＝给「上一项之后」接续用的估计长度·不给＝0） */
export type ProgramSlideAnimation = StepAnimBase & ProgramAnimFields

/** 页动画表的一条（播放顺序＝数组顺序） */
export type SlideAnimation = BasicSlideAnimation | MediaSlideAnimation | ProgramSlideAnimation

export const isBasicAnimation = (a: SlideAnimation): a is BasicSlideAnimation => a.phase === 'enter' || a.phase === 'emphasis' || a.phase === 'exit'

/** 影片步骤一条的设定（animation_set 的 media 栏·数组＝这个影片组件的全部影片步骤·照页动画表里的先后） */
export type MediaStepSpec = { effect: MediaAnimEffect; seekSec?: number; trigger: AnimTrigger; delayMs: number }
/** 程序步骤一条的设定（animation_set 的 program 栏） */
export type ProgramStepSpec = { trigger: AnimTrigger; delayMs: number; durationMs?: number }

/* ------------------------------------------------------------------ */
/* 页的新栏                                                            */
/* ------------------------------------------------------------------ */

/**
 * 页底三层：color 垫底·imageUrl 底图·videoUrl 底片（底片一律静音·poster＝封面，缩图与 pptx 退化时用）。
 * 底片与底图都给 ⇒ 底片盖在底图上（底片还没载入时露底图）。fit 两者共用。
 * 底片播放：
 *   loop 不给／false＝进页从 startSec 播一次·停在最后一格（或 endSec）；true＝在 startSec–endSec 之间循环。
 *   进页那一刻开播（与换页切换同步）；连着几页同一支底片＋平滑切换 ⇒ 接着现在的时间播不重来（下一页自己给了 startSec 才跳）。
 */
export type PageBackground = {
  color?: ColorValue
  imageUrl?: string
  fit?: 'cover' | 'contain'
  videoUrl?: string
  poster?: string
  loop?: boolean
  /** 播放区段（秒·endSec 要大于 startSec） */
  startSec?: number
  endSec?: number
}

/**
 * 换页切换：设定挂在「换到这一页」的那一页上（语义对齐 PowerPoint 的「切換」）。
 *   morph＝平滑：两页同键组件（morphKey／编号／!!名称）补间位置、大小、旋转（照字面角度差·同 PowerPoint）、透明度；内容不同的叠着淡入；
 *         只在一页有的淡出／淡入；页底交叉淡化。
 *   push／wipe 用 direction（＝新页从哪一边进来·不给＝right：由右往左推）。
 */
export const TRANSITION_TYPES = ['none', 'fade', 'push', 'wipe', 'zoom', 'morph'] as const
export type TransitionType = (typeof TRANSITION_TYPES)[number]
export type PageTransition = { type: TransitionType; durationMs: number; direction?: AnimDirection }

/** DeckPageV2 新增的几栏（aislides-deck-edit 的 DeckPageV2 交叉这个型） */
export type PageComponentFields = {
  components?: SlideComponent[]
  animations?: SlideAnimation[]
  background?: PageBackground
  transition?: PageTransition
}

/* ------------------------------------------------------------------ */
/* 上限（服务端硬闸·客户端同一份）                                       */
/* ------------------------------------------------------------------ */

export const COMPONENT_LIMITS = {
  perPage: 150,
  textChars: 4000,
  paragraphs: 200,
  runsPerParagraph: 200,
  nameChars: 60,
  urlChars: 2048,
  tableRows: 20,
  tableCols: 12,
  cellChars: 500,
  chartSeries: 12,
  chartPoints: 50,
  chartLabelChars: 60,
  animationsPerPage: 60,
  /** 框坐标范围（可部分出画布） */
  posMin: -1000,
  posMax: 2000,
  sizeMin: 1,
  sizeMax: 3000,
  fontSizeMin: 6,
  fontSizeMax: 200,
  strokeMax: 40,
  radiusMax: 1000,
  paddingMax: 200,
  durationMinMs: 100,
  durationMaxMs: 5000,
  delayMaxMs: 10000,
  /** 组合里最多几个子件 */
  groupChildren: 60,
  gradientStopsMin: 2,
  gradientStopsMax: 8,
  shadowMax: 100,
  blurMax: 40,
  calloutLenMax: 400,
  transitionMinMs: 100,
  transitionMaxMs: 10000,
  /** 程序动画：html／css 字数上限（存进 deck_data·整份 html_content 也会带一份）·设计尺寸·步数 */
  programHtmlChars: 60000,
  programCssChars: 20000,
  programDesignMin: 10,
  programDesignMax: 4000,
  programStepsMax: 50,
  /** 一页的程序动画总数（含组合里的）——新增时拒；
   *  旧资料超过的：渲染时照叠层由下而上前这么多个才建 iframe·多的只画占位框 */
  programsPerPage: 8,
  /** 可拆声明：元件数／步数／每步动作数／路径点数 */
  decomposeParts: 60,
  decomposeSteps: 50,
  decomposeActions: 30,
  decomposePathPoints: 50,
  /** 可拆元件图片 data: 串上限（字数） */
  decomposeDataUrlChars: 200000,
  /** 书签条数 */
  programCues: 50,
  /** 影片步骤跳秒上限（秒） */
  seekMaxSec: 86400,
} as const

/** 组件编号：派生＝`<页 pid>.<版式内键>`；新增＝`c` + 随机 10 位 */
export const COMPONENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:~-]{0,99}$/

/* ------------------------------------------------------------------ */
/* 写操作（编辑器 PATCH /api/aislides/v2/deck 与工具 POST /api/aislides/v2/components 共用一组纯函数） */
/* ------------------------------------------------------------------ */

/**
 * 改组件内部：只改给了的键；可选键给 null ＝移除。
 * text／paragraphs／box 作用在「文字本体」：text 组件本身，或 shape 的形状内文字。
 * text（纯文字·\n 分段）整段替换并清掉片段格式；paragraphs 是富格式整组替换；两者都给以 paragraphs 为准。
 */
export type ComponentPatch = {
  name?: string | null
  locked?: boolean
  hidden?: boolean
  opacity?: number | null
  /** 平滑切换配对键（null＝清掉·回到用编号配对） */
  morphKey?: string | null
  text?: string
  paragraphs?: TextParagraph[]
  box?: Partial<{ [K in keyof TextBox]: TextBox[K] | null }>
  // image / video
  src?: string
  crop?: CropRect | null
  fit?: 'cover' | 'contain'
  radius?: number | null
  border?: Stroke | null
  flipX?: boolean
  flipY?: boolean
  poster?: string | null
  autoplay?: boolean
  loop?: boolean
  muted?: boolean
  controls?: boolean
  // shape
  shape?: ShapeKind
  fill?: ColorValue | null
  stroke?: Stroke | null
  lineEnds?: { start?: LineEnd; end?: LineEnd } | null
  fillMode?: ShapeFillMode | null
  gradient?: LinearGradient | null
  shadow?: ShapeShadow | null
  arc?: ArcAngles | null
  thickness?: number | null
  callout?: CalloutTail | null
  backdropBlur?: number | null
  // table
  cells?: Array<Array<string | TableCell>>
  colWidths?: number[]
  header?: boolean
  tableStyle?: Partial<TableStyle>
  // chart
  chart?: ChartKind
  labels?: string[]
  series?: ChartSeries[]
  colors?: ColorValue[] | null
  legend?: boolean
  showValues?: boolean
  chartFont?: FontValue | null
  chartTextColor?: ColorValue | null
  // program（栏位同 ProgramFields）
  html?: string
  css?: string | null
  designW?: number | null
  designH?: number | null
  steps?: number | null
  transparent?: boolean | null
  bgColor?: ColorValue | null
  decompose?: ProgramFields['decompose'] | null
  cues?: ProgramFields['cues'] | null
}

/** 新增组件的入参：type＋可选框（不给＝按种类给默认大小·居中）＋内部栏位（同 ComponentPatch） */
export type NewComponentInput =
  | ({ type: CreatableComponentType; frame?: Partial<Frame> } & ComponentPatch)
  /** 整组新增（贴上／撤销删除组合用）：children 的框＝组内局部坐标 */
  | { type: 'group'; frame?: Partial<Frame>; children: NewComponentInput[]; name?: string | null; locked?: boolean; hidden?: boolean; opacity?: number | null; morphKey?: string | null }

/** 页设定（页底／换页切换）：给 null＝清掉；不给＝不动 */
export type PagePatch = { background?: PageBackground | null; transition?: PageTransition | null }

/** 一组动画设定：给 null ＝删掉该阶段；不给＝不动。
 *  media／program＝这个组件的影片步骤／程序步骤整组：数组照先后·已有的按序原位换掉（页动画表里的位置不变）·多的接在本页最后·少的删掉；null／[]＝全删 */
export type AnimationSetInput = {
  enter?: AnimSpec | null
  emphasis?: AnimSpec | null
  exit?: AnimSpec | null
  media?: MediaStepSpec[] | null
  program?: ProgramStepSpec[] | null
}

export type NewPageKind = 'blank' | 'content' | 'transition' | 'duplicate'

/** 页定位：pageId（pid·优先）＋ pageIndex（兜底／消歧提示·0 起） */
export type PageRef = { pageIndex: number; pageId?: string }

/**
 * animation_order 的一项：动画编号，或按「组件＋阶段＋同组件同阶段的第几条（0 起·基础三阶段只有一条可省）」点名。
 * 点名形式给撤销用：刚重新新增回来的组件，动画编号是服务端新发的，撤销栈只认得它挂在谁身上。
 */
export type AnimOrderRef = string | { componentId: string; phase: AnimPhase | 'media' | 'program'; index?: number }

export type ComponentOp =
  | { kind: 'component_update'; componentId: string; patch: ComponentPatch }
  | { kind: 'component_frame'; componentId: string; frame: Partial<Frame>; z?: ZMove }
  | { kind: 'component_order'; componentId: string; z: ZMove }
  /** parentId＝加进这个组合里（z＝组内叠层）·撤销「删组内子件」用 */
  | ({ kind: 'component_add'; component: NewComponentInput; z?: ZMove; parentId?: string } & PageRef)
  /** 组合：同一页≥2 个顶层组件（不含 group／html）⇒ 一个 group·放在最上面那个成员的叠层位置；
   *  groupId 可指定（撤销重做要同一个编号）；frame 可指定（撤销「取消组合」时还原原组框·不给＝成员外接框·不转） */
  | { kind: 'component_group'; componentIds: string[]; groupId?: string; frame?: Frame }
  /** 取消组合：子件换回页面坐标（组的旋转／透明度／隐藏并进子件）·放回组的叠层位置；组自己的动画一并删 */
  | { kind: 'component_ungroup'; componentId: string }
  | ({ kind: 'page_update'; patch: PagePatch } & PageRef)
  /** 切换套用到全部页（PageRef＝发起的那页·只给撤销栈认页） */
  | ({ kind: 'transition_all'; transition: PageTransition | null } & PageRef)
  | { kind: 'component_delete'; componentId: string }
  | ({ kind: 'animation_set'; componentId: string } & AnimationSetInput)
  /** 整页动画重排：order＝全部动画各一次·每项动画编号或按组件＋阶段点名（AnimOrderRef） */
  | ({ kind: 'animation_order'; order: AnimOrderRef[] } & PageRef)
  /** layoutId＝点名版式：页型跟着版式走（pageKind content／transition 要与它一致·blank＝跟版式）·duplicate 不收 */
  | { kind: 'page_add'; afterIndex: number; afterPageId?: string; pageKind: NewPageKind; sourceIndex?: number; sourcePageId?: string; layoutId?: string }
  /** 换当页版式：文字留着（已物化的页按 role 把字搬进新版式·自己加的组件原样留在最上层） */
  | ({ kind: 'page_set_layout'; layoutId: string } & PageRef)
  | ({ kind: 'page_move'; to: number } & PageRef)
  | ({ kind: 'page_restore_layout' } & PageRef)
  | ({ kind: 'toc_rebuild' } & PageRef)
