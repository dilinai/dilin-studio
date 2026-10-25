// 组件版 pptx 导出 · 程序动画组件
//
//   格式照 slide-kit/components/program-types.ts（⛔ 本档改栏位）。程序组件（type＝'program'）两种导出：
//     拆得开（有 decompose）＝每个元件 ⇒ 一张图／一个形状（物件名「程序编号::元件编号」）；
//         每一步的动作 ⇒ 原生动画（appear／disappear＝出现／消失·fadeIn／fadeOut＝淡入／淡出·move＝动作路径·scale＝放大缩小·rotate＝陀螺旋）；
//         一步之内：第一个动作跟着这一步的触发、后面的 with＝与上一个同时、after＝上一个之后（照 program-types ProgramAction.trigger）。
//     拆不开（没 decompose）＝每一步录成一小段影片（aislides-pptx-record）放在原位·见 recordedProgramPlan。
//   设计坐标 ⇒ 页坐标：等比缩进组件框、置中（同 html 组件 designW／designH 的放法）·动作路径是投影片宽高的比例。
//   纯函数（单测直接喂资料）·客户端安全。

import type { ProgramAction, ProgramCue, ProgramDecompose, ProgramFields, ProgramPart } from '../kit/components/program-types'
import type { Fx, FxNode, ProgramPlan } from './pptx-timing'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../kit/types'

/** 程序组件（合码前 types.ts 还没把 'program' 拼进联合型别 ⇒ 这里先自己拼一个够用的） */
export type ProgramComponentLike = {
  id: string
  type: 'program'
  frame: { x: number; y: number; w: number; h: number; rotate?: number }
  hidden?: boolean
  opacity?: number
} & ProgramFields

export const isProgramComponent = (c: unknown): c is ProgramComponentLike =>
  !!c && typeof c === 'object' && (c as { type?: unknown }).type === 'program' && typeof (c as { html?: unknown }).html === 'string'

/** 程序里的元件 ⇒ PowerPoint 物件名 */
export const partName = (programId: string, partId: string) => `${programId}::${partId}`
/** 程序底色块（transparent=false）的物件名 */
export const programBgName = (programId: string) => `${programId}::bg`

export type ProgramLayout = { s: number; ox: number; oy: number }

/** 设计尺寸 ⇒ 组件框（等比缩进、置中）·没给设计尺寸＝组件框原尺寸（s=1） */
export function programLayout(p: Pick<ProgramComponentLike, 'frame' | 'designW' | 'designH'>): ProgramLayout {
  const dw = p.designW && p.designW > 0 ? p.designW : p.frame.w
  const dh = p.designH && p.designH > 0 ? p.designH : p.frame.h
  const s = Math.min(p.frame.w / dw, p.frame.h / dh)
  return { s, ox: p.frame.x + (p.frame.w - dw * s) / 2, oy: p.frame.y + (p.frame.h - dh * s) / 2 }
}

/** 元件起始框（设计坐标）⇒ 页坐标（逻辑 px） */
export function partBox(part: ProgramPart, L: ProgramLayout): { x: number; y: number; w: number; h: number; rotate: number } {
  const f = part.frame
  return { x: L.ox + f.x * L.s, y: L.oy + f.y * L.s, w: Math.max(1, f.w * L.s), h: Math.max(1, f.h * L.s), rotate: f.rotate ?? 0 }
}

/** 可拆声明大致合法（元件编号不重、步里指到的元件都在）·不合法 ⇒ 当拆不开 */
export function validDecompose(d: ProgramDecompose | undefined | null): d is ProgramDecompose {
  if (!d || !Array.isArray(d.parts) || !Array.isArray(d.steps) || !d.parts.length) return false
  const ids = new Set<string>()
  for (const p of d.parts) {
    if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id) || !p.frame || ![p.frame.x, p.frame.y, p.frame.w, p.frame.h].every(Number.isFinite)) return false
    ids.add(p.id)
  }
  return d.steps.every((s) => s && Array.isArray(s.actions) && s.actions.every((a) => a && ids.has(a.part)))
}

const ENTER = new Set(['appear', 'fadeIn'])

/** 一个动作 ⇒ 效果（L＝缩放比例·动作路径换成投影片宽高的比例） */
export function actionFx(a: ProgramAction, L: ProgramLayout): Fx | null {
  const dur = Math.max(1, Number(a.durationMs) || 0)
  switch (a.kind) {
    case 'appear': return { cls: 'entr', effect: 'appear', dur }
    case 'disappear': return { cls: 'exit', effect: 'disappear', dur }
    case 'fadeIn': return { cls: 'entr', effect: 'fade', dur }
    case 'fadeOut': return { cls: 'exit', effect: 'fade', dur }
    case 'move': {
      const pts: Array<[number, number]> = Array.isArray(a.path) && a.path.length
        ? a.path.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([x, y]) => [(x * L.s) / CANVAS_WIDTH, (y * L.s) / CANVAS_HEIGHT])
        : [[((a.dx ?? 0) * L.s) / CANVAS_WIDTH, ((a.dy ?? 0) * L.s) / CANVAS_HEIGHT]]
      return pts.length ? { cls: 'path', pts, dur } : null
    }
    case 'scale': return Number.isFinite(a.scale) && (a.scale as number) > 0 ? { cls: 'emph', effect: 'scale', by: a.scale as number, dur } : null
    case 'rotate': return Number.isFinite(a.deg) ? { cls: 'emph', effect: 'rotate', deg: a.deg as number, dur } : null
  }
  return null
}

/** 第 k 步（1 起）的效果节点：第一个动作 offset＝它自己的 delay；后面 with＝从上一个的开始、after＝从上一个的结束 */
export function decomposedStepNodes(programId: string, d: ProgramDecompose, k: number, L: ProgramLayout): FxNode[] {
  const step = d.steps[k - 1]
  if (!step) return []
  const out: FxNode[] = []
  let prevStart = 0
  let prevEnd = 0
  step.actions.forEach((a, i) => {
    const fx = actionFx(a, L)
    const dur = Math.max(1, Number(a.durationMs) || 0)
    const start = i === 0 ? 0 : a.trigger === 'after' ? prevEnd : prevStart
    const off = start + Math.max(0, Number(a.delayMs) || 0)
    prevStart = start
    prevEnd = off + dur
    if (fx) out.push({ target: partName(programId, a.part), fx, offsetMs: off })
  })
  return out
}

/**
 * 进页先摆好：起始看不见（visible=false）但第一个动作不是出现／淡入 ⇒ 先藏（PowerPoint 只会自动藏「第一个效果是进场」的物件）；
 * 起始看得见但第一个动作是出现／淡入 ⇒ 先现（不然 PowerPoint 会把它藏到那一步）。
 */
export function preludeNodes(programId: string, d: ProgramDecompose): FxNode[] {
  const first = new Map<string, string>()
  for (const s of d.steps) for (const a of s.actions) if (!first.has(a.part)) first.set(a.part, a.kind)
  const out: FxNode[] = []
  for (const p of d.parts) {
    const k = first.get(p.id)
    const vis = p.visible !== false
    if (!vis && k && !ENTER.has(k)) out.push({ target: partName(programId, p.id), fx: { cls: 'exit', effect: 'disappear', dur: 1 } })
    if (vis && k && ENTER.has(k)) out.push({ target: partName(programId, p.id), fx: { cls: 'entr', effect: 'appear', dur: 1 } })
  }
  return out
}

/** 元件要不要放进投影片：起始看不见、之后也从没出现过 ⇒ 不放 */
export function partEverShown(d: ProgramDecompose, partId: string): boolean {
  const p = d.parts.find((x) => x.id === partId)
  if (!p) return false
  if (p.visible !== false) return true
  return d.steps.some((s) => s.actions.some((a) => a.part === partId && ENTER.has(a.kind)))
}

/** 拆得开的程序 ⇒ 排步资料（给 planSlideTimeline） */
export function decomposedProgramPlan(p: ProgramComponentLike): ProgramPlan | null {
  if (!validDecompose(p.decompose)) return null
  const d = p.decompose
  const L = programLayout(p)
  return {
    steps: d.steps.length,
    step: (k) => { const nodes = decomposedStepNodes(p.id, d, k, L); return nodes.length ? { nodes } : null },
    cues: (p.cues ?? []) as ProgramCue[],
    prelude: preludeNodes(p.id, d),
  }
}

/* ------------------------------------------------------------------ */
/* 拆不开的：每步录成一小段影片（C3）                                     */
/* ------------------------------------------------------------------ */

/** 录片版的物件名：起始画面（第 0 步的样子）＝::s0·第 k 步的影片＝::clipK */
export const programPosterName = (programId: string) => `${programId}::s0`
export const programClipName = (programId: string, k: number) => `${programId}::clip${k}`
/** 第 k 段影片播完那一刻盖上的终点画面（静态图） */
export const programEndName = (programId: string, k: number) => `${programId}::end${k}`

/** 药（只在 node 题里设·DILIN_NEG=pptx_clip_end_frame）：不盖终点画面（题要红）。 */
function endFrameNeg(): boolean {
  const v = typeof process !== 'undefined' ? process.env.DILIN_NEG : undefined
  return !!v && v.split(',').map((x) => x.trim()).includes('pptx_clip_end_frame')
}

/** 录好的画面放哪（设计比例·等比缩进组件框置中） */
export function programVideoBox(p: Pick<ProgramComponentLike, 'frame' | 'designW' | 'designH'>): { x: number; y: number; w: number; h: number } {
  const L = programLayout(p)
  const dw = p.designW && p.designW > 0 ? p.designW : p.frame.w
  const dh = p.designH && p.designH > 0 ? p.designH : p.frame.h
  return { x: L.ox, y: L.oy, w: dw * L.s, h: dh * L.s }
}

/**
 * 录片版排步：第 k 步＝那段影片出现＋从头播（命令时长＝片长·「之后」等它播完）；录失败的那步＝null（跳过·记报告）。
 * 影片一段叠一段（后录的在上）·前一段停在最后一格 ⇒ 不用另外藏。
 * end＝有终点画面（::endK·叠在第 k 段上、下一段之下）⇒ 播完那一刻现身：WPS（Mac）播下一段会把同页别的影片打回首帧·
 *   有它盖着，前一段被打回也看不见；这一段在 WPS 播不动也至少停在终点。PowerPoint 里它与影片最后一格同画面。
 */
export function recordedProgramPlan(p: Pick<ProgramComponentLike, 'id' | 'cues'>, clips: ReadonlyArray<{ durationMs: number; end?: boolean } | null>): ProgramPlan {
  return {
    steps: clips.length,
    step: (k) => {
      const c = clips[k - 1]
      if (!c) return null
      const media = programClipName(p.id, k)
      const dur = Math.max(1, Math.round(c.durationMs))
      return {
        nodes: [
          { target: media, fx: { cls: 'entr', effect: 'appear', dur: 1 }, lenMs: 0 },
          { target: media, fx: { cls: 'media', cmd: 'play', fromSec: 0, dur }, lenMs: dur },
          ...(c.end && !endFrameNeg() ? [{ target: programEndName(p.id, k), fx: { cls: 'entr' as const, effect: 'appear', dur: 1 }, offsetMs: dur, lenMs: 0 }] : []),
        ],
        clip: { media, durationMs: dur },
      }
    },
    cues: (p.cues ?? []) as ProgramCue[],
  }
}
