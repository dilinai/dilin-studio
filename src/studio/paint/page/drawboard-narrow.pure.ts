// 画板窄窗排版——纯函数＋注入画板 iframe 的样式·isomorphic（sucrase 单测直载·⛔ @/ 别名）。
//   毛病：视窗约 900 宽（右边对话栏 380）时画板 iframe 只剩约 520 宽 ⇒ 菜单列「檔案／編輯…」挤成两字竖排、
//     「AI 可操控（完整命令集）」折行、底部状态栏（缩放／尺寸／座标／图层／回复档）文字叠在一起。
//   ⇒ 菜单列各项一律不折行；放不下时依序：① 「AI 可操控（完整命令集）」缩成「⌁ AI」（整句放 title）
//     ② 藏「堤麟画板」字样（左边已有站方 logo＋名字）③ 从最右边的菜单起收进一个「⋯」更多选单。
//   状态栏不折行；窄时藏座标与回复档那句（还原／舍弃两个钮留着·整句放 title），再窄连图层名也藏；剩下的放不下就省略号。
//   上游画板本体（public/drawboard-app/）一字不改：样式与收纳逻辑全由网站这层（drawboard-host.ts）注入。

/** 负控开关（只在 node 测试跑·正式页面恒 false）：环境变量 DILIN_NEG 含处名 ⇒ 退回修前行为 */
function neg(site: string): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return !!env?.DILIN_NEG && env.DILIN_NEG.split(',').includes(site) && typeof window === 'undefined'
}

export type MenubarMeasure = {
  /** 菜单列可用宽（clientWidth） */
  avail: number
  /** 一定留着的那几格总宽（站方 logo、存档状态句保留宽、语言选单…） */
  fixed: number
  /** 「堤麟画板」字样宽 */
  brand: number
  /** 「AI 可操控（完整命令集）」整句宽／缩短后宽 */
  hintFull: number
  hintShort: number
  /** 各顶菜单宽（照显示顺序） */
  menus: number[]
  /** 「⋯」更多钮宽 */
  more: number
}
export type MenubarPlan = { hintShort: boolean; hideBrand: boolean; visible: number }

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)

/** 菜单列怎么排：都放得下就照原样；不然依序缩 AI 那句、藏品牌字、从右边起把菜单收进「⋯」 */
export function planMenubar(m: MenubarMeasure): MenubarPlan {
  const n = m.menus.length
  if (neg('drawboard_narrow_no_fold')) return { hintShort: false, hideBrand: false, visible: n }
  const all = sum(m.menus)
  if (m.fixed + m.brand + m.hintFull + all <= m.avail) return { hintShort: false, hideBrand: false, visible: n }
  if (m.fixed + m.brand + m.hintShort + all <= m.avail) return { hintShort: true, hideBrand: false, visible: n }
  if (m.fixed + m.hintShort + all <= m.avail) return { hintShort: true, hideBrand: true, visible: n }
  let used = m.fixed + m.hintShort + m.more, k = 0
  while (k < n && used + m.menus[k] <= m.avail) used += m.menus[k++]
  return { hintShort: true, hideBrand: true, visible: k }
}

export type StatusTier = 'full' | 'narrow' | 'tiny'
/** 状态栏宽到多少算窄：< 520 藏座标与回复档那句；< 300 连图层名也藏（只留缩放、尺寸、回复档的两个钮） */
export const STATUS_NARROW = 520
export const STATUS_TINY = 300
export function statusTier(width: number): StatusTier {
  if (neg('drawboard_narrow_status_full')) return 'full'
  if (!(width > 0)) return 'full'   // 还没排版（量到 0）⇒ 先不动
  return width < STATUS_TINY ? 'tiny' : width < STATUS_NARROW ? 'narrow' : 'full'
}

/** 收进「⋯」的那几格加这个 class；「⋯」本身在全放得下时也加 */
export const FOLD_CLASS = 'dl-fold'
export const MORE_ID = 'dlMenuMore'
/** 「⋯」打开时 Menubar.openKey 记成这个（不跟上游任何菜单 key 撞） */
export const MORE_KEY = '__dlMore'
export const NARROW_STYLE_ID = 'dlNarrowStyle'

/** 注入画板 iframe 的样式：菜单列与状态栏都不折行；窄时的藏法看 class（dl-short／dl-fold／dl-narrow／dl-tiny） */
export const NARROW_CSS = [
  '#menubar{overflow:hidden;min-width:0}',
  '#menubar>*{flex-shrink:0;white-space:nowrap}',
  '#menubar .mb,#menubar .mbt,#menubar .brand,#agentHint{white-space:nowrap}',
  '#menubar .spacer{flex:1 1 0;min-width:0}',
  `#menubar .${FOLD_CLASS}{display:none!important}`,
  `#${MORE_ID} .mbt{font-size:15px;letter-spacing:1px}`,
  '#agentHint.dl-short>span{display:none}',
  "#agentHint.dl-short::after{content:'AI';margin-left:3px}",
  '#statusbar{white-space:nowrap;overflow:hidden;min-width:0}',
  '#statusbar>*{flex-shrink:0}',
  '#statusbar #stLayer,#statusbar #pse3Recover{flex-shrink:1;min-width:0;overflow:hidden;text-overflow:ellipsis}',
  '#statusbar #pse3Recover{display:flex;align-items:center}',
  '#statusbar #pse3Recover>span{min-width:0;overflow:hidden;text-overflow:ellipsis}',
  '#statusbar #pse3Recover>a{flex-shrink:0}',
  '#statusbar.dl-narrow,#statusbar.dl-tiny{gap:10px;padding:0 8px}',
  '#statusbar.dl-narrow #stPos,#statusbar.dl-tiny #stPos,#statusbar.dl-narrow #pse3Recover>span,#statusbar.dl-tiny #pse3Recover>span{display:none}',
  '#statusbar.dl-tiny #stLayer{display:none}',
].join('\n')

/** 「⋯」钮的提示字（三语） */
export function moreTitle(lang: string): string {
  return lang === 'en' ? 'More menus' : lang === 'zh-Hans' ? '更多菜单' : '更多選單'
}
