// 网页剪辑页·文字片段的「人工」属性（附图＝剪映专业版右侧文本属性面板；）。
// 这里管：属性的范围与默认（缺＝跟花字款式·没花字＝素白字）、读档验值（parseTextLook·工程档／角色写回都过）、面板改动怎么并进文字（applyTextPatch／patchTexts）、
//   以及「这段字最后画成什么样」（resolveTextLook）——画面叠字（VeditFancyText·CSS）与汇出（text-draw.ts·Canvas）都只认这一份，两边一致。
// 本档只放纯函数（题直接跑）。⛔ 碰 DOM。
import { FANCY_LINE_HEIGHT, type FancyStyle } from './fancy-text.data'
import type { TextAlign, TextBody, TextFont, TextLookFields, Tracks } from './timeline.pure'
import { TEXT_SIZE_MAX, TEXT_SIZE_MIN, editableTextIds, fancyById, patchText, textStyleOf } from './text.pure'
import { mergeTextAnim, parseTextAnim, type TextAnimPatch } from './text-anim.pure'
import { FONT_CATALOG, fontStack, isFontId } from '../../shared/fonts/catalog' // 站上字体（同云文档／表格／简报那 12 款·切片按需载）

/** 字体选项（只列浏览器一定有的：黑体／明体（宋体）／等宽·不引外部字体档） */
export const TEXT_FONTS: readonly TextFont[] = ['sans', 'serif', 'mono']
export const TEXT_ALIGNS: readonly TextAlign[] = ['left', 'center', 'right']
/** 缩放倍数（界面 10%～500%） */
export const SCALE_MIN = 0.1
export const SCALE_MAX = 5
/** 字间距（em·加在款式原本的上面）；行间距（em·加在行高 1.25 上面） */
export const LETTER_SPACING_MIN = -1
export const LETTER_SPACING_MAX = 2
export const LINE_SPACING_MAX = 2
/** 描边粗（em）：界面 1～100 对到 STROKE_W_MIN～STROKE_W_MAX */
export const STROKE_W_MIN = 0.003
export const STROKE_W_MAX = 0.3
/** 勾上「描边」／「背景」时先给的样子 */
export const STROKE_DEFAULT = { color: '#000000', width: 0.08 }
export const BG_DEFAULT = { color: '#000000', opacity: 0.6 }
/** 勾上「阴影」／「发光」时先给的样子；范围 */
export const SHADOW_DEFAULT = { color: '#000000', opacity: 0.6, angle: 45, dist: 0.08, blur: 0.12 }
export const GLOW_DEFAULT = { color: '#ffe066', strength: 0.5 }
export const SHADOW_DIST_MAX = 0.5
export const SHADOW_BLUR_MAX = 0.6
/** 发光强度 1 ⇒ 最外圈模糊半径几 em（贴身一层、中圈外圈各叠两层·单层太淡·细笔画一糊就看不见） */
export const GLOW_BLUR_MAX = 0.6
export const BG_SHAPES = ['pill', 'speech', 'thought'] as const
/** 气泡的圆角与内距（em·比方块大一点） */
export const BUBBLE_BOX = { pill: { radius: 99, padX: 0.5, padY: 0.12 }, speech: { radius: 0.45, padX: 0.45, padY: 0.2 }, thought: { radius: 0.7, padX: 0.55, padY: 0.25 } } as const
/** 字体下拉：系统三款＋站上字体（中文的排前面） */
export const WEB_FONTS = FONT_CATALOG.map((f) => ({ id: f.id, zh: f.zh, label: f.label, group: f.group }))
/** 背景块的圆角与内距（em） */
export const BG_BOX = { radius: 0.12, padX: 0.25, padY: 0.06 }
/** 底线：离基线多远、多粗（em）；BASELINE＝基线在一行正中往下多少（em·Canvas 用 textBaseline middle 画·要换算到基线） */
export const UNDERLINE = { offset: 0.1, thickness: 0.06 }
export const BASELINE_BELOW_MIDDLE = 0.38
export const TEXT_CONTENT_MAX = 2000
/** 字号：界面的数字＝size（字高占画面高）× 150（缺省 0.1 ⇒ 15·同剪映缺省字号） */
export const FONT_SIZE_UNIT = 150

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const r4 = (v: number) => Math.round(v * 1e4) / 1e4
const HEX_RE = /^#[0-9a-f]{6}$/i
const hex = (v: unknown): string | null => (typeof v === 'string' && HEX_RE.test(v) ? v.toLowerCase() : null)
/** 角度收进 (-180, 180]（到 0.01 度） */
export function normRotate(deg: number): number {
  const r = Math.round(((((deg + 180) % 360) + 360) % 360 - 180) * 100) / 100
  return r === -180 ? 180 : r === 0 ? 0 : r
}
/** #rrggbb＋不透明度 ⇒ rgba(…) */
export function rgba(color: string, a: number): string {
  const h = hex(color) ?? '#000000'
  return `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${r4(clamp(a, 0, 1))})`
}

/** 读档验值（照 project.pure 的做法：认不得的栏丢掉·数字夹进范围）：只回合规、且不是默认值的栏（默认值不存＝跟旧档一个样） */
export function parseTextLook(v: Record<string, unknown>): TextLookFields {
  const o: TextLookFields = {}
  if (TEXT_FONTS.includes(v.font as TextFont) || isFontId(v.font)) o.font = v.font as string
  if (typeof v.bold === 'boolean') o.bold = v.bold
  if (typeof v.italic === 'boolean') o.italic = v.italic
  if (v.underline === true) o.underline = true
  const color = hex(v.color)
  if (color) o.color = color
  const ls = num(v.letterSpacing)
  if (ls !== null && r4(clamp(ls, LETTER_SPACING_MIN, LETTER_SPACING_MAX)) !== 0) o.letterSpacing = r4(clamp(ls, LETTER_SPACING_MIN, LETTER_SPACING_MAX))
  const lh = num(v.lineSpacing)
  if (lh !== null && r4(clamp(lh, 0, LINE_SPACING_MAX)) !== 0) o.lineSpacing = r4(clamp(lh, 0, LINE_SPACING_MAX))
  if (TEXT_ALIGNS.includes(v.align as TextAlign) && v.align !== 'center') o.align = v.align as TextAlign
  const sc = num(v.scale)
  if (sc !== null && r4(clamp(sc, SCALE_MIN, SCALE_MAX)) !== 1) o.scale = r4(clamp(sc, SCALE_MIN, SCALE_MAX))
  const rot = num(v.rotate)
  if (rot !== null && normRotate(rot) !== 0) o.rotate = normRotate(rot)
  const op = num(v.opacity)
  if (op !== null && r4(clamp(op, 0, 1)) !== 1) o.opacity = r4(clamp(op, 0, 1))
  if (isObj(v.stroke)) {
    const c = hex(v.stroke.color), w = num(v.stroke.width)
    if (c && w !== null && w > 0) o.stroke = { color: c, width: r4(clamp(w, STROKE_W_MIN, STROKE_W_MAX)) }
  }
  if (isObj(v.bg)) {
    const c = hex(v.bg.color)
    if (c) o.bg = { color: c, opacity: r4(clamp(num(v.bg.opacity) ?? BG_DEFAULT.opacity, 0, 1)), ...((BG_SHAPES as readonly string[]).includes(String(v.bg.shape)) ? { shape: v.bg.shape as (typeof BG_SHAPES)[number] } : {}) }
  }
  // 阴影／发光／竖排
  if (isObj(v.shadow)) {
    const c = hex(v.shadow.color)
    if (c) o.shadow = { color: c, opacity: r4(clamp(num(v.shadow.opacity) ?? SHADOW_DEFAULT.opacity, 0, 1)), angle: Math.round(((((num(v.shadow.angle) ?? SHADOW_DEFAULT.angle) % 360) + 360) % 360)),
      dist: r4(clamp(num(v.shadow.dist) ?? SHADOW_DEFAULT.dist, 0, SHADOW_DIST_MAX)), blur: r4(clamp(num(v.shadow.blur) ?? SHADOW_DEFAULT.blur, 0, SHADOW_BLUR_MAX)) }
  }
  if (isObj(v.glow)) {
    const c = hex(v.glow.color), s = num(v.glow.strength)
    if (c && s !== null && s > 0) o.glow = { color: c, strength: r4(clamp(s, 0.01, 1)) }
  }
  if (v.vertical === true) o.vertical = true
  // 动画：编号认得才留·秒数夹进范围（text-anim.pure）
  const anim = parseTextAnim(v.anim)
  if (anim) o.anim = anim
  return o
}

// ── 面板改动 ──
type Nullable<T> = { [K in keyof T]?: T[K] | null }
/** 一笔面板改动：给值＝改成这个；null＝拿掉（回款式默认）；没写＝不动。content 去头尾空白·改成空的不改（同双击改字）。
 *  anim 一格一格改（{ in: 某款 } 只换入场·出场循环不动；{ in: null } 拿掉入场；anim: null 全拿掉）——多选时各段原本别格的动画留着 */
export type TextPatch = Nullable<Omit<TextLookFields, 'anim'>> & { anim?: TextAnimPatch | null; content?: string; fancy?: string | null; size?: number; x?: number; y?: number }
const canon = (b: TextBody) => JSON.stringify(Object.keys(b).sort().map((k) => [k, (b as Record<string, unknown>)[k]]))
/** 改动并进一段文字（值都过 parseTextLook 夹范围）；结果跟原本一样 ⇒ 回原物件 */
export function applyTextPatch(b: TextBody, p: TextPatch): TextBody {
  const merged: Record<string, unknown> = { ...b }
  for (const [k, v] of Object.entries(p)) { if (v === undefined || k === 'anim') continue; if (v === null) delete merged[k]; else merged[k] = v }
  if (p.anim === null) delete merged.anim
  else if (p.anim) { const a = mergeTextAnim(b.anim, p.anim); if (a) merged.anim = a; else delete merged.anim }
  let content = b.content
  if (typeof p.content === 'string') { const c = p.content.replace(/^\s+|\s+$/g, '').slice(0, TEXT_CONTENT_MAX); if (c) content = c }
  const fancy = p.fancy === null ? undefined : typeof p.fancy === 'string' && fancyById(p.fancy) ? p.fancy : b.fancy
  const next: TextBody = {
    content, ...(fancy ? { fancy } : {}),
    x: clamp(num(merged.x) ?? b.x, 0, 1), y: clamp(num(merged.y) ?? b.y, 0, 1), size: clamp(num(merged.size) ?? b.size, TEXT_SIZE_MIN, TEXT_SIZE_MAX),
    ...parseTextLook(merged),
  }
  return canon(next) === canon(b) ? b : next
}
/** 选中的文字片段（锁了的轨不算）一起改（多选时套到全部选中的）；都没变 ⇒ 原物件 */
export function patchTexts(tr: Tracks, sel: readonly string[], p: TextPatch): Tracks {
  const ids = editableTextIds(tr, sel)
  if (!ids.length) return tr
  return patchText(tr, new Set(ids), (b) => applyTextPatch(b, p))
}

// ── 画成什么样（画面叠字与汇出共用）──
/** style＝套完人工属性后的花字款式（fancyToCss／drawFancyText 直接吃）；fontScale＝字高占画面高；lineHeight＝行高（em）；underline＝底线颜色（没底线 ⇒ null） */
export type TextLook = { style: FancyStyle; fontScale: number; lineHeight: number; align: TextAlign; underline: string | null; opacity: number; rotate: number }
/** 底线用的颜色：字面实色 ⇒ 那个色；渐层 ⇒ 第一个色；空心字（transparent）⇒ 最外圈描边色（没有 ⇒ 白） */
function underlineColor(s: FancyStyle): string {
  const c = s.fill.type === 'solid' ? s.fill.color : s.fill.stops[0]?.color ?? '#ffffff'
  if (c !== 'transparent') return c
  const st = s.strokes ?? []
  return st.length ? st[st.length - 1].color : '#ffffff'
}
export function resolveTextLook(b: TextBody): TextLook {
  const base = textStyleOf(b)
  const web = b.font && !TEXT_FONTS.includes(b.font as TextFont) ? fontStack(b.font) : undefined
  const style: FancyStyle = {
    ...base,
    family: b.font && TEXT_FONTS.includes(b.font as TextFont) ? (b.font as TextFont) : base.family,
    weight: b.bold === undefined ? base.weight : b.bold ? Math.max(700, base.weight) : 400,
    fill: b.color ? { type: 'solid', color: b.color } : base.fill,
  }
  if (b.italic !== undefined) style.italic = b.italic
  if (web) style.stack = web; else delete style.stack
  const ls = r4((base.letterSpacing ?? 0) + (b.letterSpacing ?? 0))
  if (ls) style.letterSpacing = ls; else delete style.letterSpacing
  if (b.stroke) style.strokes = [...(base.strokes ?? []), { color: b.stroke.color, width: b.stroke.width }]
  if (b.bg) style.bg = { color: rgba(b.bg.color, b.bg.opacity), ...(b.bg.shape ? { ...BUBBLE_BOX[b.bg.shape], shape: b.bg.shape } : BG_BOX) }
  // 阴影、发光都叠在款式原本的阴影后面（画法：最外圈轮廓下 drop-shadow·CSS 与 Canvas 同一份）
  const sh = [...(base.shadows ?? [])]
  if (b.glow) { const g = b.glow.strength * GLOW_BLUR_MAX; for (const k of [0.2, 0.5, 0.5, 1, 1]) sh.push({ color: b.glow.color, blur: r4(g * k), x: 0, y: 0 }) }
  if (b.shadow) { const a = (b.shadow.angle * Math.PI) / 180; sh.push({ color: rgba(b.shadow.color, b.shadow.opacity), blur: b.shadow.blur, x: r4(Math.cos(a) * b.shadow.dist), y: r4(Math.sin(a) * b.shadow.dist) }) }
  if (sh.length) style.shadows = sh; else delete style.shadows
  return {
    style, fontScale: b.size * (b.scale ?? 1), lineHeight: FANCY_LINE_HEIGHT + (b.lineSpacing ?? 0), align: b.vertical ? 'center' : b.align ?? 'center',
    underline: b.underline ? underlineColor(style) : null, opacity: b.opacity ?? 1, rotate: b.rotate ?? 0,
  }
}
export const lookBold = (l: TextLook) => l.style.weight >= 600
/** 竖排：一字一行·原本的每一行变成一直行、由右往左排（短的那行底下补全形空白）·直行之间空半个字。
 *  画面叠字与汇出都吃这串字（排版、打字机露字照它算）·横排原样回 */
export const VERTICAL_GAP = '\u2002'
export function displayText(b: Pick<TextBody, 'content' | 'vertical'>): string {
  if (!b.vertical) return b.content
  const cols = b.content.split('\n').map((l) => Array.from(l)).reverse()
  const rows = Math.max(1, ...cols.map((c) => c.length))
  return Array.from({ length: rows }, (_, i) => cols.map((c) => c[i] ?? '\u3000').join(VERTICAL_GAP)).join('\n')
}
/** 这几段字用到哪些站上字体（页面先载·汇出前等载好） */
export function webFontsIn(bodies: Iterable<Pick<TextBody, 'font'> | undefined>): string[] {
  const out = new Set<string>()
  for (const b of bodies) if (b?.font && isFontId(b.font)) out.add(b.font)
  return [...out]
}
export const lookItalic = (l: TextLook) => !!l.style.italic

/** 汇出排版（Canvas）：字拆成行·每行量宽·算整块（含背景内距）多大、每行左边在哪、行中心在哪（同 CSS：每行高＝lineHeight·字在行里垂直置中）。measure＝量一行宽（px） */
export type TextLine = { text: string; x: number; cy: number; w: number }
export function layoutText(content: string, look: TextLook, px: number, measure: (line: string) => number): { w: number; h: number; lines: TextLine[] } {
  const raw = content.split('\n')
  const ws = raw.map((s) => (s ? measure(s) : 0))
  const inner = Math.max(0, ...ws)
  const padX = look.style.bg ? look.style.bg.padX * px : 0, padY = look.style.bg ? look.style.bg.padY * px : 0
  const lh = look.lineHeight * px
  const lines = raw.map((text, i) => ({
    text, w: ws[i], cy: padY + (i + 0.5) * lh,
    x: padX + (look.align === 'left' ? 0 : look.align === 'right' ? inner - ws[i] : (inner - ws[i]) / 2),
  }))
  return { w: inner + padX * 2, h: raw.length * lh + padY * 2, lines }
}

// ── 预设样式（照剪映那排：字色＋描边／背景的组合）──
export type TextPreset = { id: string; color: string; stroke?: { color: string; width: number }; bg?: { color: string; opacity: number } }
export const TEXT_PRESETS: readonly TextPreset[] = [
  { id: 'p-white-black', color: '#ffffff', stroke: { color: '#000000', width: 0.08 } },
  { id: 'p-black-white', color: '#111111', stroke: { color: '#ffffff', width: 0.08 } },
  { id: 'p-yellow-black', color: '#ffd60a', stroke: { color: '#000000', width: 0.08 } },
  { id: 'p-white-red', color: '#ffffff', stroke: { color: '#e8483b', width: 0.08 } },
  { id: 'p-white-blue', color: '#ffffff', stroke: { color: '#2f80ed', width: 0.08 } },
  { id: 'p-pink-white', color: '#ff7fae', stroke: { color: '#ffffff', width: 0.08 } },
  { id: 'p-sky-white', color: '#5ab8ff', stroke: { color: '#ffffff', width: 0.08 } },
  { id: 'p-lime-dark', color: '#c6e86b', stroke: { color: '#2c3e1a', width: 0.08 } },
  { id: 'p-bg-black', color: '#ffffff', bg: { color: '#000000', opacity: 0.7 } },
  { id: 'p-bg-white', color: '#111111', bg: { color: '#ffffff', opacity: 0.9 } },
  { id: 'p-bg-yellow', color: '#111111', bg: { color: '#ffd60a', opacity: 1 } },
  { id: 'p-bg-red', color: '#ffffff', bg: { color: '#d64545', opacity: 1 } },
]
/** 点一款预设 ⇒ 字色／描边／背景换成它的（没有的那项拿掉）；null＝「无」⇒ 三项都拿掉（回款式） */
export function presetPatch(p: TextPreset | null): TextPatch {
  return p ? { color: p.color, stroke: p.stroke ?? null, bg: p.bg ?? null } : { color: null, stroke: null, bg: null }
}
/** 这段字现在是哪款预设（三项都没设 ⇒ 'none'；对不上任何一款 ⇒ null） */
export function activePreset(b: TextBody): string | null {
  if (!b.color && !b.stroke && !b.bg) return 'none'
  const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null)
  return TEXT_PRESETS.find((p) => p.color === b.color && same(p.stroke, b.stroke) && same(p.bg, b.bg))?.id ?? null
}

// ── 面板上的数字 ⇔ 存的值 ──
export const fontSizeOf = (size: number) => Math.round(size * FONT_SIZE_UNIT)
export const sizeFromFontSize = (n: number) => clamp(n / FONT_SIZE_UNIT, TEXT_SIZE_MIN, TEXT_SIZE_MAX)
/** 字间距／行间距：界面一格＝0.1em */
export const spacingOf = (em: number | undefined) => Math.round((em ?? 0) * 10)
export const spacingFrom = (n: number) => n / 10
/** 位置：界面 X／Y＝离画面中心多少（画面宽／高的 %·Y 往上为正·照剪映） */
export const posOf = (b: Pick<TextBody, 'x' | 'y'>) => ({ x: Math.round((b.x - 0.5) * 1000) / 10, y: Math.round((0.5 - b.y) * 1000) / 10 })
export const posFrom = (x: number, y: number) => ({ x: clamp(0.5 + x / 100, 0, 1), y: clamp(0.5 - y / 100, 0, 1) })
/** 描边粗：界面 1～100 */
export const strokeWOf = (w: number) => Math.round((w / STROKE_W_MAX) * 100)
export const strokeWFrom = (n: number) => clamp((n / 100) * STROKE_W_MAX, STROKE_W_MIN, STROKE_W_MAX)

// ── 气泡（剪映「文本 › 气泡」）：字色＋有形状的背景（胶囊／对话框／想法泡泡）──
export type TextBubble = { id: string; shape: (typeof BG_SHAPES)[number]; color: string; bg: string }
export const TEXT_BUBBLES: readonly TextBubble[] = [
  { id: 'b-speech-white', shape: 'speech', color: '#111111', bg: '#ffffff' },
  { id: 'b-speech-black', shape: 'speech', color: '#ffffff', bg: '#111111' },
  { id: 'b-speech-yellow', shape: 'speech', color: '#111111', bg: '#ffd60a' },
  { id: 'b-speech-pink', shape: 'speech', color: '#ffffff', bg: '#ff6f9f' },
  { id: 'b-speech-blue', shape: 'speech', color: '#ffffff', bg: '#2f80ed' },
  { id: 'b-thought-white', shape: 'thought', color: '#111111', bg: '#ffffff' },
  { id: 'b-thought-sky', shape: 'thought', color: '#1f3b57', bg: '#cfe8ff' },
  { id: 'b-thought-lilac', shape: 'thought', color: '#3d2a5c', bg: '#e6dcff' },
  { id: 'b-pill-white', shape: 'pill', color: '#111111', bg: '#ffffff' },
  { id: 'b-pill-black', shape: 'pill', color: '#ffffff', bg: '#111111' },
  { id: 'b-pill-red', shape: 'pill', color: '#ffffff', bg: '#e8483b' },
  { id: 'b-pill-green', shape: 'pill', color: '#ffffff', bg: '#27ae60' },
]
/** 点一款气泡 ⇒ 字色＋背景换成它的、描边拿掉；null＝「无」⇒ 背景、字色拿掉 */
export function bubblePatch(p: TextBubble | null): TextPatch {
  return p ? { color: p.color, stroke: null, bg: { color: p.bg, opacity: 1, shape: p.shape } } : { color: null, bg: null }
}
/** 这段字现在是哪款气泡（没有形状背景 ⇒ 'none'；有但对不上 ⇒ null） */
export function activeBubble(b: TextBody): string | null {
  if (!b.bg?.shape) return 'none'
  return TEXT_BUBBLES.find((p) => p.shape === b.bg!.shape && p.bg === b.bg!.color && b.bg!.opacity === 1 && p.color === b.color)?.id ?? null
}
