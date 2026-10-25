/**
 * slide-kit engine · 字号自适应
 *
 * 算法思想出处：参考 PPTist（canvas 量宽 → 超框逐级降号·转述思路自研）。
 *   - 浏览器：真 canvas 2D measureText 量得像素宽（字体真实 metrics）。
 *   - node（SSR/单测/生成管线）：近似字宽表兜底——CJK 全宽 1em、ASCII 按窄宽分档。
 *   - 降号步长：大字 2px 一步（> STEP_THRESHOLD）、小字 1px 一步、下限 10px 钉死。
 *
 * 纯同步函数（浏览器路径也同步·canvas measureText 本身同步）。
 * 供渲染/生成侧（S3/S4·或版式内部）对超长文案定字号·composeDeck 不隐式调用。
 */

/** 字号下限（px·钉死·再长也不降穿） */
export const MIN_FONT_SIZE = 10
/** 大小字分界：> 此值步长 2px·≤ 此值步长 1px */
export const STEP_THRESHOLD = 20

export type FitTextOptions = {
  /** 待排文本 */
  text: string
  /** 可用宽度（与字号同单位·逻辑 px） */
  maxWidth: number
  /** 允许行数（默认 1·>1 表示可折行） */
  maxLines?: number
  /** 起始字号（版式声明的设计字号） */
  fontSize: number
  /** 字体栈（浏览器真测时生效·node 近似表忽略） */
  fontFamily?: string
  /**
   * 字号下限覆盖（默认 MIN_FONT_SIZE）。
   * 🔴 只允许上调不允许下穿：传入值 < MIN_FONT_SIZE（10px）时按 MIN_FONT_SIZE 钳制
   * （原 Math.max(1,…) 允许 minFontSize:1 降穿 10px 下限·违反契约）。
   */
  minFontSize?: number
}

/* ------------------------------------------------------------------ */
/* 文本宽度测量（浏览器真 canvas / node 近似字宽表）                       */
/* ------------------------------------------------------------------ */

let cachedCtx: CanvasRenderingContext2D | null | undefined

/** 浏览器环境拿共享 canvas 2D 上下文；node/失败返回 null → 走近似表 */
function browserCanvasCtx(): CanvasRenderingContext2D | null {
  if (cachedCtx !== undefined) return cachedCtx
  try {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      cachedCtx = document.createElement('canvas').getContext('2d')
    } else {
      cachedCtx = null
    }
  } catch {
    cachedCtx = null
  }
  return cachedCtx
}

/** 单字符近似宽（em·node 兜底表·中文简报以 CJK=1em 为锚） */
function approxCharEm(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  // CJK 统一表意 / 扩展A / 兼容表意 / 日文假名 / CJK 标点 / 全角形式 → 全宽
  if (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3000 && code <= 0x30ff) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0x20000 && code <= 0x2fa1f)
  ) {
    return 1
  }
  if (ch === ' ') return 0.3
  if (/[iIl.,:;'|!()[\]{}]/.test(ch)) return 0.32
  if (/[A-Z@#%&]/.test(ch)) return 0.72
  if (/[0-9a-z_\-+=<>?/\\"$^*~]/.test(ch)) return 0.55
  return 0.6 // 其余（西欧扩展/符号）中档兜底
}

/**
 * 文本单行宽度（逻辑 px）。浏览器真 canvas·node 近似表。
 * 纯同步；同环境同输入结果稳定。
 */
export function measureTextWidth(text: string, fontSize: number, fontFamily?: string): number {
  const ctx = browserCanvasCtx()
  if (ctx) {
    ctx.font = `${fontSize}px ${fontFamily || 'sans-serif'}`
    return ctx.measureText(text).width
  }
  return approxTextWidth(text, fontSize)
}

/**
 * 只走近似字宽表（不碰 canvas）——组件蓝图派生要「服务端与浏览器算出同一个框」，
 * 所以派生一律用它；measureTextWidth 在浏览器会改走真 canvas·两边结果不同。
 */
export function approxTextWidth(text: string, fontSize: number): number {
  let em = 0
  for (const ch of text) em += approxCharEm(ch)
  return em * fontSize
}

type Measure = (text: string, fontSize: number, fontFamily?: string) => number

/* ------------------------------------------------------------------ */
/* 逐级降号                                                            */
/* ------------------------------------------------------------------ */

/** 按显式换行切段（\n / \r\n 都认·渲染侧 pre-wrap 会保留换行） */
function splitHardLines(text: string): string[] {
  return text.split(/\r?\n/)
}

/** 字符是否 CJK（可在任意字间折行）·范围与 approxCharEm 全宽档一致 */
function isCjkChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3000 && code <= 0x30ff) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0x20000 && code <= 0x2fa1f)
  )
}

/**
 * 段内折行 token 化（-07-12 ·词级折行）：
 *   - CJK 字符：单字一 token（CSS 对 CJK 任意字间可断）
 *   - 空白（空格/tab）：独立 token（天然断点·折行时被吸收）
 *   - 其余（英文词/URL/数字串）：连续串整体一 token——**不可断词**·
 *     普通 pre-wrap（非 break-all）渲染下只能整词换行。
 */
function tokenizeSegment(seg: string): string[] {
  const tokens: string[] = []
  let word = ''
  for (const ch of seg) {
    if (ch === ' ' || ch === '\t' || isCjkChar(ch)) {
      if (word) {
        tokens.push(word)
        word = ''
      }
      tokens.push(ch)
    } else {
      word += ch
    }
  }
  if (word) tokens.push(word)
  return tokens
}

/**
 * 单段贪心词级折行所需行数（原实现按「总宽÷maxWidth」等价假设
 * 任意字符可断——长 URL / 英文长词在普通 pre-wrap 渲染下整词换行·被低估）。
 *   - token 塞不进当前行 → 换行放下一行
 *   - token 自身宽过整行（超长不可断词）→ 按 break-anywhere 兜底折算多行
 *     （行数不再低估；横向安全由 fitFontSize 的最宽 token 约束另行保证）
 */
function segmentLines(seg: string, fontSize: number, maxWidth: number, fontFamily?: string, measure: Measure = measureTextWidth): number {
  if (seg.length === 0) return 1 // 空行（连续换行）也真占一行
  let lines = 1
  let cur = 0
  for (const token of tokenizeSegment(seg)) {
    const w = measure(token, fontSize, fontFamily)
    const isSpace = token === ' ' || token === '\t'
    if (cur + w <= maxWidth) {
      cur += w
      continue
    }
    if (isSpace) {
      // 行尾空白吸收为断点·自身不产生新行（段尾纯空白不多计一行·
      // 饱和 cur 让下一个真 token 触发换行）
      cur = maxWidth
      continue
    }
    if (w <= maxWidth) {
      lines++
      cur = w
      continue
    }
    // 超长不可断 token：break-anywhere 兜底折算（余量先填满当前行）
    const remaining = Math.max(0, maxWidth - cur)
    const rest = w - remaining
    const extra = Math.max(1, Math.ceil(rest / maxWidth))
    lines += extra
    cur = rest - (extra - 1) * maxWidth
  }
  return lines
}

/**
 * 某字号下所需行数（词级贪心折行）。
 * 🔴 显式换行逐段计（-07-12：原实现整段总宽÷maxWidth·
 * 「短\n短\n短」被低估成 1 行·pre-wrap 渲染下长文爆框）：
 * 每个 \n 段独立折行·空段（连续换行）也占 1 行·总行数=各段之和。
 */
function linesNeeded(text: string, fontSize: number, maxWidth: number, fontFamily?: string, measure: Measure = measureTextWidth): number {
  if (text.length === 0) return 0
  const denom = Math.max(1, maxWidth)
  let total = 0
  for (const seg of splitHardLines(text)) total += segmentLines(seg, fontSize, denom, fontFamily, measure)
  return total
}

/** 折行行数·只走近似字宽表（确定性：服务端＝浏览器·组件蓝图派生用） */
export function approxLinesNeeded(text: string, fontSize: number, maxWidth: number): number {
  return linesNeeded(text, fontSize, maxWidth, undefined, approxTextWidth)
}

/**
 * 全文最宽不可断 token 的宽度（横向防爆框约束）：
 * 普通 pre-wrap（非 break-all）下超长词不折行会横向爆框——
 * fitFontSize 额外要求最宽 token ≤ maxWidth（降到下限仍超则由渲染层
 * overflow-wrap 兜底·引擎已尽力）。空白 token 不参与。
 */
function widestTokenWidth(text: string, fontSize: number, fontFamily?: string): number {
  let widest = 0
  for (const seg of splitHardLines(text)) {
    for (const token of tokenizeSegment(seg)) {
      if (token === ' ' || token === '\t') continue
      const w = measureTextWidth(token, fontSize, fontFamily)
      if (w > widest) widest = w
    }
  }
  return widest
}

/**
 * 字号自适应主入口：从设计字号逐级降到「maxLines 行内塞得下」为止。
 * 返回最终字号（≥ 下限）。到下限仍塞不下也返回下限（渲染层截断兜底·不 throw）。
 *
 * 边界（显式处理· 连带）：显式换行段数是行数的硬下限——段数已 > maxLines 时
 * 降号永远塞不进（换行不随字号消失），此时目标放宽为「降到无软折行为止」（每段单行），
 * 不无谓降穿到底；剩余垂直溢出由渲染层截断兜底。
 *
 * 横向约束（-07-12）：折行按**词级贪心**估算（长 URL / 英文长词
 * 整词换行·不再假设任意字符可断），且额外要求「最宽不可断 token ≤ maxWidth」——
 * 普通 pre-wrap（非 break-all）渲染下超长词不折行·不降到能塞下就会横向爆框。
 * 降到下限仍塞不下（极端超长 URL）返回下限·由渲染层 overflow-wrap 兜底。
 */
/**
 * 「字面字号（可含小数）下文本是否塞得进盒」的精确判定：
 * 定死字号的版式盒（如 content-cards body 14.5px + clamp(6)）**不降号**——
 * QA 走 fitFontSize 会先 Math.floor(14.5→14) 再比 floor 后的下限，
 * 「14px 塞得下·14.5px 实渲塞不下」的文本被放过（假绿）。本函数按传入
 * 字号原值（不取整）跑同一套词级贪心折行 + 最宽 token 横向约束，与
 * 实渲字号逐字面一致。fitFontSize 的整数逐级降号行为一字未动（既有
 * 自适应槽照旧）。
 */
export function textFitsBox(opts: {
  text: string
  maxWidth: number
  maxLines?: number
  fontSize: number
  fontFamily?: string
}): boolean {
  if (!opts.text || opts.maxWidth <= 0) return true
  const maxLines = Math.max(1, Math.floor(opts.maxLines ?? 1))
  return (
    linesNeeded(opts.text, opts.fontSize, opts.maxWidth, opts.fontFamily) <= maxLines &&
    widestTokenWidth(opts.text, opts.fontSize, opts.fontFamily) <= opts.maxWidth
  )
}

export function fitFontSize(opts: FitTextOptions): number {
  // 🔴 下限只许上调不许下穿 10px（原 Math.max(1,…) 允许 minFontSize:1 降穿）
  const minSize = Math.max(MIN_FONT_SIZE, opts.minFontSize ?? MIN_FONT_SIZE)
  const maxLines = Math.max(1, Math.floor(opts.maxLines ?? 1))
  let size = Math.max(minSize, Math.floor(opts.fontSize))
  if (!opts.text || opts.maxWidth <= 0) return size

  const hardLines = splitHardLines(opts.text).length // 显式换行段数=行数硬下限
  const targetLines = Math.max(maxLines, hardLines)

  while (
    size > minSize &&
    (linesNeeded(opts.text, size, opts.maxWidth, opts.fontFamily) > targetLines ||
      widestTokenWidth(opts.text, size, opts.fontFamily) > opts.maxWidth)
  ) {
    const step = size > STEP_THRESHOLD ? 2 : 1
    size = Math.max(minSize, size - step)
  }
  return size
}
