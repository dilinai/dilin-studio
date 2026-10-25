/**
 * slide-kit · 组件化 · 入参白名单校验与正规化（服务端硬闸·客户端同一份）
 *
 * 一切写进 deck_data 的组件栏位都过这里：逐栏白名单、数值钳制、颜色只收 #RRGGBB／#RRGGBBAA／theme:<记号>、
 * 字体只收主题记号或字体表 id、网址只收 http(s)（⛔ javascript:／data:）、文字只是字（渲染一律转义）。
 * 失败回可读的错误码＋栏位名（route 落 400·工具回 isError）。纯函数·客户端安全。
 */

import { isFontId } from '../../../shared/fonts/catalog'
import { isColorValue } from './resolve'
import {
  ANIM_EFFECTS,
  CHART_KINDS,
  COMPONENT_ID_RE,
  COMPONENT_LIMITS as L,
  COMPONENT_ROLES,
  SHAPE_FILL_MODES,
  SHAPE_KINDS,
  TRANSITION_TYPES,
  type ArcAngles,
  type CalloutTail,
  type LinearGradient,
  type PageTransition,
  type ShapeShadow,
  type AnimDirection,
  type AnimPhase,
  type AnimSpec,
  type ChartSeries,
  type ColorValue,
  type ComponentPatch,
  type FontValue,
  type Frame,
  type ListStyle,
  type PageBackground,
  type ShapeComponent,
  type SlideComponent,
  type Stroke,
  type TableCell,
  type TableStyle,
  type TextBox,
  type TextParagraph,
  type TextRun,
} from './types'
import type { CropRect } from '../types'
import {
  MEDIA_ANIM_EFFECTS,
  PROGRAM_ACTION_KINDS,
  type ProgramAction,
  type ProgramCue,
  type ProgramDecompose,
  type ProgramPart,
} from './program-types'
import type { MediaStepSpec, ProgramStepSpec } from './types'

export class ComponentInputError extends Error {
  constructor(public code: string, public field: string) {
    super(`${code}:${field}`)
  }
}
const bad = (field: string, code = 'bad_field'): never => { throw new ComponentInputError(code, field) }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown, field: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(field)
  return Math.round(Math.min(max, Math.max(min, v as number)) * 100) / 100
}
const bool = (v: unknown, field: string): boolean => (typeof v === 'boolean' ? v : bad(field))

export function normColor(v: unknown, field: string): ColorValue {
  if (!isColorValue(v)) bad(field)
  const s = v as string
  return (s.startsWith('#') ? s.toUpperCase() : s) as ColorValue
}
export function normFont(v: unknown, field: string): FontValue {
  if (v === 'theme:heading' || v === 'theme:body') return v
  if (isFontId(v)) return v
  return bad(field)
}
/**
 * 宿主另收的媒体网址（缺省没有）：本机工程版的编辑器挂着时登记「assets/<档名>」这种工程内素材，卸载时撤掉。
 *   ⛔ 伺服器端从不登记（存档口照旧只收 http(s)）。
 */
let extraMediaUrl: ((s: string) => boolean) | null = null
export function setExtraMediaUrlAcceptor(fn: ((s: string) => boolean) | null): void { extraMediaUrl = fn }
export function getExtraMediaUrlAcceptor(): ((s: string) => boolean) | null { return extraMediaUrl }

/** 图／影片网址：只收 http(s)（空串＝占位）·⛔ javascript:／data:／相对路径（宿主登记的另收规则除外） */
export function normUrl(v: unknown, field: string, allowEmpty = true): string {
  if (typeof v !== 'string') bad(field)
  const s = (v as string).trim()
  if (!s) return allowEmpty ? '' : bad(field)
  if (s.length > L.urlChars) bad(field)
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(s) && !(extraMediaUrl && extraMediaUrl(s))) bad(field)
  return s
}
function normText(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string') bad(field)
  // 去控制字（\n 与 \t 保留）
  const s = (v as string).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  if (s.length > max) bad(field, 'text_too_long')
  return s
}
const oneOf = <T extends string>(v: unknown, list: readonly T[], field: string): T => (list.includes(v as T) ? (v as T) : bad(field))

/* ------------------------------------------------------------------ */
/* 框                                                                  */
/* ------------------------------------------------------------------ */

export function normRotate(v: unknown, field = 'rotate'): number {
  const r = num(v, field, -36000, 36000) % 360
  return Math.round((r < 0 ? r + 360 : r) * 100) / 100
}

/** 部分框 ⇒ 套到 base 上（只改给了的键） */
export function applyFramePatch(base: Frame, patch: unknown): Frame {
  if (!isObj(patch)) bad('frame')
  const p = patch as Record<string, unknown>
  const out: Frame = { ...base }
  if ('x' in p) out.x = num(p.x, 'x', L.posMin, L.posMax)
  if ('y' in p) out.y = num(p.y, 'y', L.posMin, L.posMax)
  if ('w' in p) out.w = num(p.w, 'w', L.sizeMin, L.sizeMax)
  if ('h' in p) out.h = num(p.h, 'h', L.sizeMin, L.sizeMax)
  if ('rotate' in p) out.rotate = normRotate(p.rotate)
  return out
}

/* ------------------------------------------------------------------ */
/* 文字                                                                */
/* ------------------------------------------------------------------ */

export function normRun(v: unknown, field: string): TextRun {
  if (!isObj(v)) bad(field)
  const r = v as Record<string, unknown>
  const out: TextRun = { text: normText(r.text ?? '', `${field}.text`, L.textChars) }
  for (const k of ['bold', 'italic', 'underline', 'strike', 'sup', 'sub', 'shadow'] as const) if (r[k] !== undefined && r[k] !== null) out[k] = bool(r[k], `${field}.${k}`)
  if (r.color != null) out.color = normColor(r.color, `${field}.color`)
  if (r.highlight != null) out.highlight = normColor(r.highlight, `${field}.highlight`)
  if (r.font != null) out.font = normFont(r.font, `${field}.font`)
  if (r.size != null) out.size = num(r.size, `${field}.size`, L.fontSizeMin, L.fontSizeMax)
  return out
}

const TEXT_ALIGNS = ['left', 'center', 'right', 'justify', 'distribute'] as const
const UL_STYLES = ['disc', 'circle', 'square'] as const
const OL_STYLES = ['decimal', 'lower-alpha', 'lower-roman'] as const

export function normParagraphs(v: unknown, field = 'paragraphs'): TextParagraph[] {
  if (!Array.isArray(v)) bad(field)
  const arr = v as unknown[]
  if (arr.length > L.paragraphs) bad(field, 'text_too_long')
  let total = 0
  const out = arr.map((p, i) => {
    const f = `${field}[${i}]`
    if (!isObj(p)) bad(f)
    const q = p as Record<string, unknown>
    const runsIn = q.runs ?? []
    if (!Array.isArray(runsIn) || runsIn.length > L.runsPerParagraph) bad(`${f}.runs`)
    const runs = (runsIn as unknown[]).map((r, j) => normRun(r, `${f}.runs[${j}]`))
    for (const r of runs) total += r.text.length
    const para: TextParagraph = { runs }
    if (q.align != null) para.align = oneOf(q.align, TEXT_ALIGNS, `${f}.align`)
    if (q.list != null) {
      if (!isObj(q.list)) bad(`${f}.list`)
      const l = q.list as Record<string, unknown>
      para.list = (l.kind === 'ul'
        ? { kind: 'ul', style: oneOf(l.style ?? 'disc', UL_STYLES, `${f}.list.style`) }
        : l.kind === 'ol'
          ? { kind: 'ol', style: oneOf(l.style ?? 'decimal', OL_STYLES, `${f}.list.style`) }
          : bad(`${f}.list.kind`)) as ListStyle
    }
    if (q.indent != null) para.indent = Math.round(num(q.indent, `${f}.indent`, 0, 8))
    if (q.lineHeight != null) para.lineHeight = num(q.lineHeight, `${f}.lineHeight`, 0.8, 4)
    return para
  })
  if (total > L.textChars) bad(field, 'text_too_long')
  return out
}

export function normStroke(v: unknown, field: string): Stroke {
  if (!isObj(v)) bad(field)
  const s = v as Record<string, unknown>
  return {
    color: normColor(s.color, `${field}.color`),
    width: num(s.width ?? 1, `${field}.width`, 0, L.strokeMax),
    ...(s.dash != null ? { dash: oneOf(s.dash, ['solid', 'dashed', 'dotted'] as const, `${field}.dash`) } : {}),
  }
}

/** 文字框部分改 ⇒ 套到 base（给 null 移除可选键；必填键给 null 视为坏值） */
export function applyBoxPatch(base: TextBox, patch: unknown, field = 'box'): TextBox {
  if (!isObj(patch)) bad(field)
  const p = patch as Record<string, unknown>
  const out: TextBox = { ...base }
  const f = (k: string) => `${field}.${k}`
  if ('font' in p) out.font = normFont(p.font, f('font'))
  if ('size' in p) out.size = num(p.size, f('size'), L.fontSizeMin, L.fontSizeMax)
  if ('color' in p) out.color = normColor(p.color, f('color'))
  if ('align' in p) out.align = oneOf(p.align, TEXT_ALIGNS, f('align'))
  if ('valign' in p) out.valign = oneOf(p.valign, ['top', 'middle', 'bottom'] as const, f('valign'))
  if ('lineHeight' in p) out.lineHeight = num(p.lineHeight, f('lineHeight'), 0.8, 4)
  if ('padding' in p) out.padding = num(p.padding, f('padding'), 0, L.paddingMax)
  for (const k of ['bold', 'italic', 'clamp'] as const) if (k in p) { if (p[k] === null) delete out[k]; else out[k] = bool(p[k], f(k)) }
  if ('letterSpacing' in p) { if (p.letterSpacing === null) delete out.letterSpacing; else out.letterSpacing = num(p.letterSpacing, f('letterSpacing'), -10, 60) }
  if ('fill' in p) { if (p.fill === null) delete out.fill; else out.fill = normColor(p.fill, f('fill')) }
  if ('border' in p) { if (p.border === null) delete out.border; else out.border = normStroke(p.border, f('border')) }
  if ('radius' in p) { if (p.radius === null) delete out.radius; else out.radius = num(p.radius, f('radius'), 0, L.radiusMax) }
  if ('maxLines' in p) { if (p.maxLines === null) delete out.maxLines; else out.maxLines = Math.round(num(p.maxLines, f('maxLines'), 1, 200)) }
  return out
}

export function normCrop(v: unknown, field = 'crop'): CropRect {
  if (!isObj(v)) bad(field)
  const c = v as Record<string, unknown>
  const r = { x: num(c.x, `${field}.x`, 0, 100), y: num(c.y, `${field}.y`, 0, 100), w: num(c.w, `${field}.w`, 0.1, 100), h: num(c.h, `${field}.h`, 0.1, 100) }
  if (r.x + r.w > 100.001 || r.y + r.h > 100.001) bad(field)
  return r
}

/* ------------------------------------------------------------------ */
/* 表格 · 图表                                                          */
/* ------------------------------------------------------------------ */

function normCells(v: unknown): TableCell[][] {
  if (!Array.isArray(v) || v.length === 0 || v.length > L.tableRows) bad('cells')
  const rows = v as unknown[]
  const cols = Array.isArray(rows[0]) ? (rows[0] as unknown[]).length : 0
  if (cols === 0 || cols > L.tableCols) bad('cells')
  return rows.map((row, ri) => {
    if (!Array.isArray(row) || row.length !== cols) bad(`cells[${ri}]`)
    return (row as unknown[]).map((cell, ci) => {
      const f = `cells[${ri}][${ci}]`
      if (typeof cell === 'string' || typeof cell === 'number') {
        const t = normText(String(cell), f, L.cellChars)
        return { paragraphs: t.split('\n').map((x) => ({ runs: x ? [{ text: x }] : [] })) }
      }
      if (!isObj(cell)) bad(f)
      const c = cell as Record<string, unknown>
      const paragraphs = normParagraphs(c.paragraphs ?? [], `${f}.paragraphs`)
      if (paragraphs.reduce((a, p) => a + p.runs.reduce((b, r) => b + r.text.length, 0), 0) > L.cellChars) bad(f, 'text_too_long')
      return { paragraphs, ...(c.fill != null ? { fill: normColor(c.fill, `${f}.fill`) } : {}) }
    })
  })
}

function normColWidths(v: unknown, cols: number): number[] {
  if (!Array.isArray(v) || v.length !== cols) bad('colWidths')
  const ws = (v as unknown[]).map((w, i) => num(w, `colWidths[${i}]`, 1, 100))
  const sum = ws.reduce((a, b) => a + b, 0)
  return ws.map((w) => Math.round((w / sum) * 10000) / 100)
}
export const evenColWidths = (cols: number): number[] => Array.from({ length: cols }, () => Math.round((100 / cols) * 100) / 100)

function applyTableStyle(base: TableStyle, v: unknown): TableStyle {
  if (!isObj(v)) bad('tableStyle')
  const p = v as Record<string, unknown>
  const out: TableStyle = { ...base }
  if ('font' in p) out.font = normFont(p.font, 'tableStyle.font')
  if ('size' in p) out.size = num(p.size, 'tableStyle.size', L.fontSizeMin, 72)
  for (const k of ['color', 'headerFill', 'headerColor', 'borderColor'] as const) if (k in p) out[k] = normColor(p[k], `tableStyle.${k}`)
  if ('bandFill' in p) { if (p.bandFill === null) delete out.bandFill; else out.bandFill = normColor(p.bandFill, 'tableStyle.bandFill') }
  return out
}

function normLabels(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > L.chartPoints) bad('labels')
  return (v as unknown[]).map((x, i) => normText(String(x ?? ''), `labels[${i}]`, L.chartLabelChars))
}
function normSeries(v: unknown): ChartSeries[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > L.chartSeries) bad('series')
  return (v as unknown[]).map((s, i) => {
    if (!isObj(s)) bad(`series[${i}]`)
    const o = s as Record<string, unknown>
    if (!Array.isArray(o.values) || o.values.length > L.chartPoints) bad(`series[${i}].values`)
    return {
      name: normText(String(o.name ?? ''), `series[${i}].name`, L.chartLabelChars),
      values: (o.values as unknown[]).map((x, j) => (x === null ? 0 : num(typeof x === 'string' ? Number(x) : x, `series[${i}].values[${j}]`, -1e12, 1e12))),
    }
  })
}

/* ------------------------------------------------------------------ */
/* 套一个 patch 到组件（按种类收键·不属于该种类的键＝坏值）               */
/* ------------------------------------------------------------------ */

const COMMON_KEYS = ['name', 'locked', 'hidden', 'opacity', 'morphKey'] as const
const TEXTBODY_KEYS = ['text', 'paragraphs', 'box'] as const
/** 形状新栏（填色方式／渐层／阴影／弧角／环厚／对话框尾巴／毛玻璃） */
const SHAPE_EXTRA_KEYS = ['fillMode', 'gradient', 'shadow', 'arc', 'thickness', 'callout', 'backdropBlur'] as const
const KEYS_BY_TYPE: Record<SlideComponent['type'], readonly string[]> = {
  text: [...COMMON_KEYS, ...TEXTBODY_KEYS],
  image: [...COMMON_KEYS, 'src', 'crop', 'fit', 'radius', 'border', 'flipX', 'flipY'],
  video: [...COMMON_KEYS, 'src', 'poster', 'autoplay', 'loop', 'muted', 'controls', 'fit'],
  shape: [...COMMON_KEYS, ...TEXTBODY_KEYS, 'shape', 'fill', 'stroke', 'radius', 'lineEnds', ...SHAPE_EXTRA_KEYS],
  table: [...COMMON_KEYS, 'cells', 'colWidths', 'header', 'tableStyle'],
  chart: [...COMMON_KEYS, 'chart', 'labels', 'series', 'colors', 'legend', 'showValues', 'chartFont', 'chartTextColor'],
  html: [...COMMON_KEYS],
  group: [...COMMON_KEYS],
  program: [...COMMON_KEYS, 'html', 'css', 'designW', 'designH', 'steps', 'transparent', 'bgColor', 'decompose', 'cues', 'compiled', 'compileError'],   // 计时闸：认得、不收（见 program 那段）
}

/* ------------------------------------------------------------------ */
/* 程序动画（格式见 program-types.ts）                             */
/* ------------------------------------------------------------------ */

const PART_ID_RE = /^[A-Za-z0-9_-]{1,40}$/
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/

/** 可拆元件的图：https 或 data:image（png／jpeg／svg+xml·base64）·⛔ 别的 */
function normPartSrc(v: unknown, field: string): string {
  if (typeof v === 'string' && v.startsWith('data:')) {
    if (v.length > L.decomposeDataUrlChars) bad(field, 'text_too_long')
    if (!DATA_IMAGE_RE.test(v)) bad(field)
    return v
  }
  return normUrl(v, field, false)
}

function normPart(v: unknown, field: string): ProgramPart {
  if (!isObj(v)) bad(field)
  const o = v as Record<string, unknown>
  for (const k of Object.keys(o)) if (o[k] !== undefined && !['id', 'frame', 'src', 'shape', 'visible'].includes(k)) bad(`${field}.${k}`, 'field_not_for_type')
  if (typeof o.id !== 'string' || !PART_ID_RE.test(o.id)) bad(`${field}.id`)
  if (!isObj(o.frame)) bad(`${field}.frame`, 'missing_field')
  const f = o.frame as Record<string, unknown>
  const D = L.programDesignMax
  const frame: ProgramPart['frame'] = {
    x: num(f.x, `${field}.frame.x`, -D, 2 * D), y: num(f.y, `${field}.frame.y`, -D, 2 * D),
    w: num(f.w, `${field}.frame.w`, 0, 2 * D), h: num(f.h, `${field}.frame.h`, 0, 2 * D),
    ...(f.rotate != null ? { rotate: normRotate(f.rotate, `${field}.frame.rotate`) } : {}),
  }
  const out: ProgramPart = { id: o.id as string, frame }
  if (o.src != null) out.src = normPartSrc(o.src, `${field}.src`)
  if (o.shape != null) {
    if (!isObj(o.shape)) bad(`${field}.shape`)
    const s = o.shape as Record<string, unknown>
    out.shape = {
      kind: oneOf(s.kind ?? 'rect', ['rect', 'roundRect', 'ellipse'] as const, `${field}.shape.kind`),
      ...(s.fill != null ? { fill: normColor(s.fill, `${field}.shape.fill`) } : {}),
      ...(s.stroke != null ? { stroke: normColor(s.stroke, `${field}.shape.stroke`) } : {}),
      ...(s.text != null ? { text: normText(s.text, `${field}.shape.text`, 500) } : {}),
      ...(s.color != null ? { color: normColor(s.color, `${field}.shape.color`) } : {}),
      ...(s.size != null ? { size: num(s.size, `${field}.shape.size`, L.fontSizeMin, L.fontSizeMax) } : {}),
    }
  }
  if (!out.src && !out.shape) bad(`${field}.src`, 'missing_field')
  if (o.visible != null) out.visible = bool(o.visible, `${field}.visible`)
  return out
}

function normAction(v: unknown, field: string, partIds: ReadonlySet<string>): ProgramAction {
  if (!isObj(v)) bad(field)
  const o = v as Record<string, unknown>
  for (const k of Object.keys(o)) if (o[k] !== undefined && !['part', 'kind', 'dx', 'dy', 'path', 'scale', 'deg', 'durationMs', 'delayMs', 'trigger'].includes(k)) bad(`${field}.${k}`, 'field_not_for_type')
  if (typeof o.part !== 'string' || !partIds.has(o.part)) bad(`${field}.part`)
  const D = L.programDesignMax
  const out: ProgramAction = {
    part: o.part as string,
    kind: oneOf(o.kind, PROGRAM_ACTION_KINDS, `${field}.kind`),
    durationMs: Math.round(num(o.durationMs ?? 500, `${field}.durationMs`, 0, 60000)),
  }
  if (o.dx != null) out.dx = num(o.dx, `${field}.dx`, -2 * D, 2 * D)
  if (o.dy != null) out.dy = num(o.dy, `${field}.dy`, -2 * D, 2 * D)
  if (o.path != null) {
    if (!Array.isArray(o.path) || o.path.length === 0 || o.path.length > L.decomposePathPoints) bad(`${field}.path`)
    out.path = (o.path as unknown[]).map((pt, i) => {
      if (!Array.isArray(pt) || pt.length !== 2) bad(`${field}.path[${i}]`)
      const p = pt as unknown[]
      return [num(p[0], `${field}.path[${i}][0]`, -2 * D, 2 * D), num(p[1], `${field}.path[${i}][1]`, -2 * D, 2 * D)] as [number, number]
    })
  }
  if (o.scale != null) out.scale = num(o.scale, `${field}.scale`, 0.01, 100)
  if (o.deg != null) out.deg = num(o.deg, `${field}.deg`, -36000, 36000)
  if (o.delayMs != null) out.delayMs = Math.round(num(o.delayMs, `${field}.delayMs`, 0, L.delayMaxMs))
  if (o.trigger != null) out.trigger = oneOf(o.trigger, ['with', 'after'] as const, `${field}.trigger`)
  return out
}

/** 可拆动画声明（导出 pptx 用·放映不看）：元件编号不重·动作只能指本声明里的元件 */
export function normDecompose(v: unknown, field = 'decompose'): ProgramDecompose {
  if (!isObj(v)) bad(field)
  const o = v as Record<string, unknown>
  for (const k of Object.keys(o)) if (o[k] !== undefined && k !== 'parts' && k !== 'steps') bad(`${field}.${k}`, 'field_not_for_type')
  if (!Array.isArray(o.parts) || o.parts.length === 0 || o.parts.length > L.decomposeParts) bad(`${field}.parts`)
  const parts = (o.parts as unknown[]).map((p, i) => normPart(p, `${field}.parts[${i}]`))
  const ids = new Set<string>()
  parts.forEach((p, i) => { if (ids.has(p.id)) bad(`${field}.parts[${i}].id`); ids.add(p.id) })
  const stepsIn = o.steps ?? []
  if (!Array.isArray(stepsIn) || stepsIn.length > L.decomposeSteps) bad(`${field}.steps`)
  const steps = (stepsIn as unknown[]).map((s, i) => {
    if (!isObj(s)) bad(`${field}.steps[${i}]`)
    const acts = (s as Record<string, unknown>).actions
    if (!Array.isArray(acts) || acts.length > L.decomposeActions) bad(`${field}.steps[${i}].actions`)
    return { actions: (acts as unknown[]).map((a, j) => normAction(a, `${field}.steps[${i}].actions[${j}]`, ids)) }
  })
  return { parts, steps }
}

/** 书签：step 1 起·atSec 秒·componentId 指页上组件（存在与否由放映端判·不在＝不动） */
export function normCues(v: unknown, field = 'cues'): ProgramCue[] {
  if (!Array.isArray(v) || v.length > L.programCues) bad(field)
  return (v as unknown[]).map((c, i) => {
    const f = `${field}[${i}]`
    if (!isObj(c)) bad(f)
    const o = c as Record<string, unknown>
    for (const k of Object.keys(o)) if (o[k] !== undefined && !['step', 'atSec', 'componentId', 'animationId'].includes(k)) bad(`${f}.${k}`, 'field_not_for_type')
    if (typeof o.componentId !== 'string' || !COMPONENT_ID_RE.test(o.componentId)) bad(`${f}.componentId`)
    const out: ProgramCue = {
      step: Math.round(num(o.step, `${f}.step`, 1, L.programStepsMax)),
      atSec: num(o.atSec ?? 0, `${f}.atSec`, 0, 3600),
      componentId: o.componentId as string,
    }
    if (o.animationId != null) {
      if (typeof o.animationId !== 'string' || !COMPONENT_ID_RE.test(o.animationId)) bad(`${f}.animationId`)
      out.animationId = o.animationId as string
    }
    return out
  })
}

/** 影片步骤一条（animation_set.media[i]）：seek 一定要给 seekSec；pause 不收 seekSec */
export function normMediaStep(v: unknown, field: string): MediaStepSpec {
  if (!isObj(v)) bad(field)
  const a = v as Record<string, unknown>
  for (const k of Object.keys(a)) if (a[k] !== undefined && !['effect', 'seekSec', 'trigger', 'delayMs'].includes(k)) bad(`${field}.${k}`, 'field_not_for_type')
  const effect = oneOf(a.effect, MEDIA_ANIM_EFFECTS, `${field}.effect`)
  const out: MediaStepSpec = {
    effect,
    trigger: oneOf(a.trigger ?? 'click', ['click', 'with', 'after'] as const, `${field}.trigger`),
    delayMs: Math.round(num(a.delayMs ?? 0, `${field}.delayMs`, 0, L.delayMaxMs)),
  }
  if (effect === 'seek' && a.seekSec == null) bad(`${field}.seekSec`, 'missing_field')
  if (a.seekSec != null && effect !== 'pause') out.seekSec = num(a.seekSec, `${field}.seekSec`, 0, L.seekMaxSec)
  return out
}

/** 程序步骤一条（animation_set.program[i]） */
export function normProgramStep(v: unknown, field: string): ProgramStepSpec {
  if (!isObj(v)) bad(field)
  const a = v as Record<string, unknown>
  for (const k of Object.keys(a)) if (a[k] !== undefined && !['effect', 'trigger', 'delayMs', 'durationMs'].includes(k)) bad(`${field}.${k}`, 'field_not_for_type')
  if (a.effect != null && a.effect !== 'step') bad(`${field}.effect`)
  const out: ProgramStepSpec = {
    trigger: oneOf(a.trigger ?? 'click', ['click', 'with', 'after'] as const, `${field}.trigger`),
    delayMs: Math.round(num(a.delayMs ?? 0, `${field}.delayMs`, 0, L.delayMaxMs)),
  }
  if (a.durationMs != null) out.durationMs = Math.round(num(a.durationMs, `${field}.durationMs`, 0, L.durationMaxMs))
  return out
}

/** 平滑配对键：同组件编号字形（⛔ 空白／符号） */
export function normMorphKey(v: unknown, field = 'morphKey'): string {
  if (typeof v !== 'string' || !COMPONENT_ID_RE.test(v)) bad(field)
  return v as string
}

export function normGradient(v: unknown, field = 'gradient'): LinearGradient {
  if (!isObj(v)) bad(field)
  const g = v as Record<string, unknown>
  if (!Array.isArray(g.stops) || g.stops.length < L.gradientStopsMin || g.stops.length > L.gradientStopsMax) bad(`${field}.stops`)
  const stops = (g.stops as unknown[]).map((s, i) => {
    if (!isObj(s)) bad(`${field}.stops[${i}]`)
    const o = s as Record<string, unknown>
    return { pos: num(o.pos, `${field}.stops[${i}].pos`, 0, 100), color: normColor(o.color, `${field}.stops[${i}].color`) }
  }).sort((a, b) => a.pos - b.pos)
  return { angle: normRotate(g.angle ?? 0, `${field}.angle`), stops }
}

export function normShadow(v: unknown, field = 'shadow'): ShapeShadow {
  if (!isObj(v)) bad(field)
  const s = v as Record<string, unknown>
  return {
    color: normColor(s.color ?? '#00000066', `${field}.color`),
    blur: num(s.blur ?? 8, `${field}.blur`, 0, L.shadowMax),
    distance: num(s.distance ?? 6, `${field}.distance`, 0, L.shadowMax),
    angle: normRotate(s.angle ?? 0, `${field}.angle`),
  }
}

export function normArc(v: unknown, field = 'arc'): ArcAngles {
  if (!isObj(v)) bad(field)
  const a = v as Record<string, unknown>
  return { start: normRotate(a.start, `${field}.start`), end: normRotate(a.end, `${field}.end`) }
}

export function normCallout(v: unknown, field = 'callout'): CalloutTail {
  if (!isObj(v)) bad(field)
  const c = v as Record<string, unknown>
  return {
    side: oneOf(c.side ?? 'bottom', ['top', 'right', 'bottom', 'left'] as const, `${field}.side`),
    pos: num(c.pos ?? 25, `${field}.pos`, 0, 100),
    len: num(c.len ?? 40, `${field}.len`, 0, L.calloutLenMax),
  }
}

/** 形状里的文字框缺省（加字时用） */
export function defaultShapeTextBox(): TextBox {
  return { font: 'theme:body', size: 18, color: 'theme:onAccent', align: 'center', valign: 'middle', lineHeight: 1.4, padding: 8 }
}

/**
 * 把 patch 套到组件上（不改入参·回新组件）。坏值抛 ComponentInputError。
 * @returns 新组件
 */
export function applyComponentPatch(c: SlideComponent, patchIn: unknown): SlideComponent {
  if (!isObj(patchIn)) bad('patch')
  const patch = patchIn as ComponentPatch & Record<string, unknown>
  const allowed = KEYS_BY_TYPE[c.type]
  for (const k of Object.keys(patch)) if (patch[k] !== undefined && !allowed.includes(k)) bad(k, 'field_not_for_type')
  const out = structuredClone(c) as SlideComponent & Record<string, unknown>
  if ('name' in patch && patch.name !== undefined) {
    if (patch.name === null || patch.name === '') delete out.name
    else out.name = normText(patch.name, 'name', L.nameChars).trim() || undefined
    if (out.name === undefined) delete out.name
  }
  if (patch.locked !== undefined) { if (bool(patch.locked, 'locked')) out.locked = true; else delete out.locked }
  if (patch.hidden !== undefined) { if (bool(patch.hidden, 'hidden')) out.hidden = true; else delete out.hidden }
  if ('opacity' in patch && patch.opacity !== undefined) {
    if (patch.opacity === null) delete out.opacity
    else { const o = num(patch.opacity, 'opacity', 0, 1); if (o >= 1) delete out.opacity; else out.opacity = o }
  }
  if ('morphKey' in patch && patch.morphKey !== undefined) {
    if (patch.morphKey === null || patch.morphKey === '') delete out.morphKey
    else out.morphKey = normMorphKey(patch.morphKey)
  }
  // 文字本体（text 组件本身／shape 的形状内文字）
  if (out.type === 'text' || out.type === 'shape') {
    const hasText = patch.text !== undefined || patch.paragraphs !== undefined || patch.box !== undefined
    if (hasText) {
      const cur = out.type === 'text' ? { paragraphs: out.paragraphs, box: out.box } : (out.text ?? { paragraphs: [], box: defaultShapeTextBox() })
      let paragraphs = cur.paragraphs
      let box = cur.box
      if (patch.box !== undefined) box = applyBoxPatch(box, patch.box)
      if (patch.paragraphs !== undefined) paragraphs = normParagraphs(patch.paragraphs)
      else if (patch.text !== undefined) {
        const t = normText(patch.text, 'text', L.textChars)
        paragraphs = t.split('\n').map((x) => ({ runs: x ? [{ text: x }] : [] }))
      }
      if (out.type === 'text') { out.paragraphs = paragraphs; out.box = box }
      else if (paragraphs.every((p) => p.runs.every((r) => !r.text)) && patch.box === undefined) delete out.text
      else out.text = { paragraphs, box }
    }
  }
  switch (out.type) {
    case 'image': {
      if (patch.src !== undefined) { out.src = normUrl(patch.src, 'src'); if (patch.crop === undefined) delete out.crop }
      if ('crop' in patch && patch.crop !== undefined) { if (patch.crop === null) delete out.crop; else out.crop = normCrop(patch.crop) }
      if (patch.fit !== undefined) out.fit = oneOf(patch.fit, ['cover', 'contain'] as const, 'fit')
      if ('radius' in patch && patch.radius !== undefined) { if (patch.radius === null) delete out.radius; else out.radius = num(patch.radius, 'radius', 0, L.radiusMax) }
      if ('border' in patch && patch.border !== undefined) { if (patch.border === null) delete out.border; else out.border = normStroke(patch.border, 'border') }
      for (const k of ['flipX', 'flipY'] as const) if (patch[k] !== undefined) { if (bool(patch[k], k)) out[k] = true; else delete out[k] }
      break
    }
    case 'video': {
      if (patch.src !== undefined) out.src = normUrl(patch.src, 'src')
      if ('poster' in patch && patch.poster !== undefined) { if (patch.poster === null || patch.poster === '') delete out.poster; else out.poster = normUrl(patch.poster, 'poster', false) }
      for (const k of ['autoplay', 'loop', 'muted', 'controls'] as const) if (patch[k] !== undefined) out[k] = bool(patch[k], k)
      if (patch.fit !== undefined) out.fit = oneOf(patch.fit, ['cover', 'contain'] as const, 'fit')
      break
    }
    case 'shape': {
      if (patch.shape !== undefined) out.shape = oneOf(patch.shape, SHAPE_KINDS, 'shape')
      if ('fill' in patch && patch.fill !== undefined) out.fill = patch.fill === null ? null : normColor(patch.fill, 'fill')
      if ('stroke' in patch && patch.stroke !== undefined) out.stroke = patch.stroke === null ? null : normStroke(patch.stroke, 'stroke')
      if ('radius' in patch && patch.radius !== undefined) { if (patch.radius === null) delete out.radius; else out.radius = num(patch.radius, 'radius', 0, L.radiusMax) }
      if ('lineEnds' in patch && patch.lineEnds !== undefined) {
        if (patch.lineEnds === null) delete out.lineEnds
        else {
          if (!isObj(patch.lineEnds)) bad('lineEnds')
          const le = patch.lineEnds as Record<string, unknown>
          out.lineEnds = {
            ...(le.start != null ? { start: oneOf(le.start, ['none', 'arrow'] as const, 'lineEnds.start') } : {}),
            ...(le.end != null ? { end: oneOf(le.end, ['none', 'arrow'] as const, 'lineEnds.end') } : {}),
          }
        }
      }
      // 可选栏一律「给 null＝摘掉」
      const opt = <K extends 'fillMode' | 'gradient' | 'shadow' | 'arc' | 'thickness' | 'callout' | 'backdropBlur'>(k: K, norm: (v: unknown) => NonNullable<ShapeComponent[K]>) => {
        if (!(k in patch) || patch[k] === undefined) return
        if (patch[k] === null) delete out[k]
        else out[k] = norm(patch[k])
      }
      opt('fillMode', (v) => oneOf(v, SHAPE_FILL_MODES, 'fillMode'))
      opt('gradient', (v) => normGradient(v))
      opt('shadow', (v) => normShadow(v))
      opt('arc', (v) => normArc(v))
      opt('thickness', (v) => num(v, 'thickness', 0.02, 0.5))
      opt('callout', (v) => normCallout(v))
      opt('backdropBlur', (v) => num(v, 'backdropBlur', 0, L.blurMax))
      if (out.backdropBlur === 0) delete out.backdropBlur
      break
    }
    case 'table': {
      if (patch.cells !== undefined) {
        out.cells = normCells(patch.cells)
        if (patch.colWidths === undefined && (out.colWidths?.length ?? 0) !== out.cells[0].length) out.colWidths = evenColWidths(out.cells[0].length)
      }
      if (patch.colWidths !== undefined) out.colWidths = normColWidths(patch.colWidths, out.cells[0]?.length ?? 0)
      if (patch.header !== undefined) out.header = bool(patch.header, 'header')
      if (patch.tableStyle !== undefined) out.style = applyTableStyle(out.style, patch.tableStyle)
      break
    }
    case 'chart': {
      if (patch.chart !== undefined) out.chart = oneOf(patch.chart, CHART_KINDS, 'chart')
      if (patch.labels !== undefined) out.labels = normLabels(patch.labels)
      if (patch.series !== undefined) out.series = normSeries(patch.series)
      if ('colors' in patch && patch.colors !== undefined) {
        if (patch.colors === null) delete out.colors
        else { if (!Array.isArray(patch.colors) || patch.colors.length > 20) bad('colors'); out.colors = (patch.colors as unknown[]).map((c, i) => normColor(c, `colors[${i}]`)) }
      }
      if (patch.legend !== undefined) out.legend = bool(patch.legend, 'legend')
      if (patch.showValues !== undefined) out.showValues = bool(patch.showValues, 'showValues')
      if ('chartFont' in patch && patch.chartFont !== undefined) { if (patch.chartFont === null) delete out.font; else out.font = normFont(patch.chartFont, 'chartFont') }
      if ('chartTextColor' in patch && patch.chartTextColor !== undefined) { if (patch.chartTextColor === null) delete out.textColor; else out.textColor = normColor(patch.chartTextColor, 'chartTextColor') }
      break
    }
    case 'program': {
      // html 必填（给 null／非字串＝坏值）·超长拒（⛔ 静默截断：截了程序就坏了）
      if (patch.html !== undefined) out.html = normText(patch.html, 'html', L.programHtmlChars)
      const opt = <K extends 'css' | 'designW' | 'designH' | 'steps' | 'transparent' | 'bgColor' | 'decompose' | 'cues'>(k: K, norm: (v: unknown) => unknown) => {
        if (!(k in patch) || patch[k] === undefined) return
        if (patch[k] === null) delete out[k]
        else (out as Record<string, unknown>)[k] = norm(patch[k])
      }
      opt('css', (v) => normText(v, 'css', L.programCssChars))
      opt('designW', (v) => num(v, 'designW', L.programDesignMin, L.programDesignMax))
      opt('designH', (v) => num(v, 'designH', L.programDesignMin, L.programDesignMax))
      opt('steps', (v) => Math.round(num(v, 'steps', 0, L.programStepsMax)))
      opt('transparent', (v) => bool(v, 'transparent'))
      opt('bgColor', (v) => normColor(v, 'bgColor'))
      opt('decompose', (v) => normDecompose(v))
      opt('cues', (v) => normCues(v))
      if (out.css === '') delete out.css
      break
    }
  }
  return out as SlideComponent
}

/* ------------------------------------------------------------------ */
/* 动画                                                                */
/* ------------------------------------------------------------------ */

export function normAnimSpec(v: unknown, phase: AnimPhase, field: string): AnimSpec {
  if (!isObj(v)) bad(field)
  const a = v as Record<string, unknown>
  const effect = oneOf(a.effect, ANIM_EFFECTS[phase] as readonly string[], `${field}.effect`) as AnimSpec['effect']
  return {
    effect,
    ...(a.direction != null ? { direction: oneOf(a.direction, ['left', 'right', 'up', 'down'] as const, `${field}.direction`) as AnimDirection } : {}),
    trigger: oneOf(a.trigger ?? 'click', ['click', 'with', 'after'] as const, `${field}.trigger`),
    durationMs: Math.round(num(a.durationMs ?? 500, `${field}.durationMs`, L.durationMinMs, L.durationMaxMs)),
    delayMs: Math.round(num(a.delayMs ?? 0, `${field}.delayMs`, 0, L.delayMaxMs)),
  }
}

/* ------------------------------------------------------------------ */
/* 整颗组件校验（模板本体／外来整份 deck 进库前用· 上架堤麟原創模板）  */
/* ------------------------------------------------------------------ */

const BASE_KEYS = ['id', 'type', 'name', 'role', 'roleIndex', 'frame', 'opacity', 'locked', 'hidden', 'morphKey'] as const
/** 各种类整颗组件允许出现的栏（多一个＝坏值·免得拼错的栏静默丢掉） */
const WHOLE_KEYS_BY_TYPE: Record<Exclude<SlideComponent['type'], 'html'>, readonly string[]> = {
  text: [...BASE_KEYS, 'paragraphs', 'box'],
  image: [...BASE_KEYS, 'src', 'crop', 'fit', 'radius', 'border', 'flipX', 'flipY'],
  video: [...BASE_KEYS, 'src', 'poster', 'autoplay', 'loop', 'muted', 'controls', 'fit'],
  shape: [...BASE_KEYS, 'shape', 'fill', 'stroke', 'radius', 'lineEnds', 'text', ...SHAPE_EXTRA_KEYS],
  table: [...BASE_KEYS, 'cells', 'colWidths', 'header', 'style'],
  chart: [...BASE_KEYS, 'chart', 'labels', 'series', 'colors', 'legend', 'showValues', 'font', 'textColor'],
  group: [...BASE_KEYS, 'children'],
  program: [...BASE_KEYS, 'html', 'css', 'designW', 'designH', 'steps', 'transparent', 'bgColor', 'decompose', 'cues', 'compiled', 'compileError'],   // 计时闸：复制／贴上带着的编译产物与原因认得、但一律丢掉（服务端写路重编·⛔ 认外来）
}
const BOX_REQUIRED = ['font', 'size', 'color', 'align', 'valign', 'lineHeight', 'padding'] as const
const TABLE_STYLE_REQUIRED = ['font', 'size', 'color', 'headerFill', 'headerColor', 'borderColor'] as const
const need = (o: Record<string, unknown>, keys: readonly string[], field: string) => { for (const k of keys) if (o[k] === undefined || o[k] === null) bad(`${field}.${k}`, 'missing_field') }

/** 文字本体（text 组件本身／shape.text）：box 必填键齐＋逐栏白名单 */
function normWholeTextBody(o: Record<string, unknown>, field: string): { paragraphs: TextParagraph[]; box: TextBox } {
  if (!Array.isArray(o.paragraphs)) bad(`${field}.paragraphs`, 'missing_field')
  if (!isObj(o.box)) bad(`${field}.box`, 'missing_field')
  need(o.box as Record<string, unknown>, BOX_REQUIRED, `${field}.box`)
  const skeleton: TextBox = { font: 'theme:body', size: 18, color: 'theme:text', align: 'left', valign: 'top', lineHeight: 1.4, padding: 0 }
  return { paragraphs: normParagraphs(o.paragraphs, `${field}.paragraphs`), box: applyBoxPatch(skeleton, o.box, `${field}.box`) }
}

/**
 * 整颗组件（入参＝不可信 JSON）⇒ 正规化后的组件；不合契约抛 ComponentInputError（code＋栏位名）。
 *   与 applyComponentPatch 同一套逐栏白名单／钳制／颜色字体网址口径；多出的栏、缺必填栏、html 种类（内部用）一律拒。
 */
export function normalizeComponent(raw: unknown, field = 'component'): SlideComponent {
  if (!isObj(raw)) bad(field)
  const o = raw as Record<string, unknown>
  const type = o.type as SlideComponent['type']
  if (!(type in WHOLE_KEYS_BY_TYPE)) bad(`${field}.type`, 'bad_component_type')
  const allowed = WHOLE_KEYS_BY_TYPE[type as Exclude<SlideComponent['type'], 'html'>]
  for (const k of Object.keys(o)) if (o[k] !== undefined && !allowed.includes(k)) bad(`${field}.${k}`, 'field_not_for_type')
  if (typeof o.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:~-]{0,99}$/.test(o.id)) bad(`${field}.id`)
  if (!isObj(o.frame)) bad(`${field}.frame`, 'missing_field')
  need(o.frame as Record<string, unknown>, ['x', 'y', 'w', 'h'], `${field}.frame`)
  const frame = applyFramePatch({ x: 0, y: 0, w: 1, h: 1, rotate: 0 }, o.frame)
  const base = { id: o.id as string, frame } as Record<string, unknown>
  if (o.role != null) base.role = oneOf(o.role, COMPONENT_ROLES, `${field}.role`)
  if (o.roleIndex != null) base.roleIndex = Math.round(num(o.roleIndex, `${field}.roleIndex`, 0, 999))
  let skeleton: SlideComponent
  const patch: Record<string, unknown> = {}
  for (const k of ['name', 'locked', 'hidden', 'opacity', 'morphKey'] as const) if (o[k] !== undefined) patch[k] = o[k]
  switch (type) {
    case 'group': {
      // 只一层：子件不能再是 group（html 本来就不收）·组内编号不重
      if (!Array.isArray(o.children) || o.children.length === 0 || o.children.length > L.groupChildren) bad(`${field}.children`, o.children === undefined ? 'missing_field' : 'bad_field')
      const seen = new Set<string>()
      const children = (o.children as unknown[]).map((ch, i) => {
        if (isObj(ch) && (ch as Record<string, unknown>).type === 'group') bad(`${field}.children[${i}].type`, 'bad_component_type')
        const n = normalizeComponent(ch, `${field}.children[${i}]`)
        if (seen.has(n.id) || n.id === o.id) bad(`${field}.children[${i}].id`)
        seen.add(n.id)
        return n
      })
      skeleton = { ...base, type, children } as unknown as SlideComponent
      break
    }
    case 'text': {
      const body = normWholeTextBody(o, field)
      skeleton = { ...base, type, ...body } as unknown as SlideComponent
      break
    }
    case 'image':
    case 'video': {
      need(o, ['src', 'fit'], field)
      skeleton = { ...base, type, src: '', fit: 'cover' } as unknown as SlideComponent
      for (const k of (type === 'image' ? ['src', 'crop', 'fit', 'radius', 'border', 'flipX', 'flipY'] : ['src', 'poster', 'autoplay', 'loop', 'muted', 'controls', 'fit'])) if (o[k] !== undefined) patch[k] = o[k]
      break
    }
    case 'shape': {
      need(o, ['shape'], field)
      skeleton = { ...base, type, shape: 'rect', fill: null, stroke: null } as unknown as SlideComponent
      for (const k of ['shape', 'fill', 'stroke', 'radius', 'lineEnds', ...SHAPE_EXTRA_KEYS] as const) if (o[k] !== undefined) patch[k] = o[k]
      if (o.text != null) {
        if (!isObj(o.text)) bad(`${field}.text`)
        ;(skeleton as Record<string, unknown>).text = normWholeTextBody(o.text as Record<string, unknown>, `${field}.text`)
      }
      break
    }
    case 'table': {
      need(o, ['cells', 'colWidths', 'header', 'style'], field)
      if (!isObj(o.style)) bad(`${field}.style`)
      need(o.style as Record<string, unknown>, TABLE_STYLE_REQUIRED, `${field}.style`)
      skeleton = { ...base, type, cells: [[{ paragraphs: [] }]], colWidths: [100], header: false, style: { font: 'theme:body', size: 16, color: 'theme:text', headerFill: 'theme:accent', headerColor: 'theme:onAccent', borderColor: 'theme:border' } } as unknown as SlideComponent
      patch.cells = o.cells; patch.colWidths = o.colWidths; patch.header = o.header; patch.tableStyle = o.style
      break
    }
    case 'chart': {
      need(o, ['chart', 'labels', 'series', 'legend', 'showValues'], field)
      skeleton = { ...base, type, chart: 'column', labels: [], series: [{ name: '', values: [] }], legend: false, showValues: false } as unknown as SlideComponent
      for (const k of ['chart', 'labels', 'series', 'colors', 'legend', 'showValues'] as const) if (o[k] !== undefined) patch[k] = o[k]
      if (o.font !== undefined) patch.chartFont = o.font
      if (o.textColor !== undefined) patch.chartTextColor = o.textColor
      break
    }
    case 'program': {
      need(o, ['html'], field)
      skeleton = { ...base, type, html: '' } as unknown as SlideComponent
      for (const k of ['html', 'css', 'designW', 'designH', 'steps', 'transparent', 'bgColor', 'decompose', 'cues'] as const) if (o[k] !== undefined) patch[k] = o[k]
      break
    }
    default:
      return bad(`${field}.type`, 'bad_component_type')
  }
  try {
    return applyComponentPatch(skeleton, patch)
  } catch (e) {
    if (e instanceof ComponentInputError) throw new ComponentInputError(e.code, `${field}.${e.field}`)
    throw e
  }
}

/** 页底（整颗）：color／imageUrl／fit／videoUrl／poster 逐栏收 */
export function normalizePageBackground(raw: unknown, field = 'background'): PageBackground {
  if (!isObj(raw)) bad(field)
  const o = raw as Record<string, unknown>
  for (const k of Object.keys(o)) if (!['color', 'imageUrl', 'fit', 'videoUrl', 'poster', 'loop', 'startSec', 'endSec'].includes(k)) bad(`${field}.${k}`, 'field_not_for_type')
  const out: PageBackground = {}
  if (o.color != null) out.color = normColor(o.color, `${field}.color`)
  if (o.imageUrl != null && o.imageUrl !== '') out.imageUrl = normUrl(o.imageUrl, `${field}.imageUrl`, false)
  if (o.fit != null) out.fit = oneOf(o.fit, ['cover', 'contain'] as const, `${field}.fit`)
  if (o.videoUrl != null && o.videoUrl !== '') out.videoUrl = normUrl(o.videoUrl, `${field}.videoUrl`, false)
  if (o.poster != null && o.poster !== '') out.poster = normUrl(o.poster, `${field}.poster`, false)
  if (o.loop != null) { if (bool(o.loop, `${field}.loop`)) out.loop = true }
  // startSec 给了（连 0）＝这页自己定起点：同一支底片接续播时也跳过去
  if (o.startSec != null) out.startSec = num(o.startSec, `${field}.startSec`, 0, 86400)
  if (o.endSec != null) {
    const e = num(o.endSec, `${field}.endSec`, 0, 86400)
    if (e <= (out.startSec ?? 0)) bad(`${field}.endSec`)
    out.endSec = e
  }
  return out
}

/** 换页切换（整颗）：type 白名单·时长钳在 0.1–10 秒·direction 只给 push／wipe 留 */
export function normalizePageTransition(raw: unknown, field = 'transition'): PageTransition {
  if (!isObj(raw)) bad(field)
  const o = raw as Record<string, unknown>
  for (const k of Object.keys(o)) if (!['type', 'durationMs', 'direction'].includes(k)) bad(`${field}.${k}`, 'field_not_for_type')
  const type = oneOf(o.type, TRANSITION_TYPES, `${field}.type`)
  const out: PageTransition = { type, durationMs: Math.round(num(o.durationMs ?? (type === 'morph' ? 2000 : 700), `${field}.durationMs`, L.transitionMinMs, L.transitionMaxMs)) }
  if (o.direction != null) {
    const d = oneOf(o.direction, ['left', 'right', 'up', 'down'] as const, `${field}.direction`)
    if (type === 'push' || type === 'wipe') out.direction = d
  }
  return out
}
