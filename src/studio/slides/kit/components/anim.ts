/**
 * slide-kit · 组件化 · 基础动画（放映／分享页／html 下载都走现成的 data-step＋.visible 步进协议·导航脚本一字不改）
 *
 *   - 单击触发 ⇒ 开新一组（data-step＝组号 1、2、3…）；与上一项同时／上一项之后 ⇒ 并进同一组，用 animation-delay 排时间；
 *   - 第 0 组（页一出现就自动播的）⛔ 用 data-step：CSS 动画在投影片从 display:none 变成显示时自己会重播，免得撞上
 *     「页里只有一组步值时逐个元素拆步」的导航特例（aislides-utils getGroups：unique.length<=1）；
 *   - 有单击组的页补一个隐形锚 <i data-step="0">，保证步值至少两种（同一个特例）。
 * 关键帧自写（很短·没抄别人的码）。
 */

import { COMPONENT_LIMITS, DIRECTIONAL_EFFECTS, isBasicAnimation, type AnimDirection, type AnimPhase, type SlideAnimation } from './types'
import type { MediaAnimEffect, ProgramCue } from './program-types'

/** animId＝给书签（cues）点名用的那几条才带（data-sk-anim） */
export type AnimWrap = { className: string; step?: number; durationMs: number; delayMs: number; animId?: string }

/**
 * 影片步骤／程序步骤不是 CSS 动画 ⇒ 渲成页里一个隐形记号 <i data-sk-act>（放映执行器 steps.ts 盯着它亮不亮）：
 *   step＝第几组单击（≥1·与 CSS 动画同一套 data-step 组号·导航脚本照常点亮）；auto＝页一出现就做（第 0 组）；
 *   cue＝被书签点名（不等单击·程序播到那一秒才点亮）；delayMs＝点亮后几毫秒才做（与上一项同时／之后的接续时间）。
 *   程序步骤 index＝这个程序组件的第几步（1 起·照页动画表里的先后数）。
 */
export type StepMarker = {
  animId: string
  componentId: string
  kind: 'media' | 'program'
  step?: number
  auto?: boolean
  cue?: boolean
  delayMs: number
  effect?: MediaAnimEffect
  seekSec?: number
  index?: number
}

/** 一个程序组件在本页的排步结果：explicit＝页动画表里有几条程序步骤（放映端拿它算隐式步数 N−explicit）；cues＝书签解到哪几条动画 */
export type ProgramStepPlan = { explicit: number; cues: Array<{ step: number; atSec: number; anims: string[] }> }

export type PlanOptions = {
  /** 本页的程序组件（叠层由下而上）·书签在这里 */
  programs?: ReadonlyMap<string, { cues?: readonly ProgramCue[] }>
  /** 本页的影片组件编号（影片步骤只认挂在影片上的） */
  videos?: ReadonlySet<string>
}

export type PagePlan = {
  byComponent: Map<string, AnimWrap[]>
  hasClickSteps: boolean
  markers: StepMarker[]
  programs: Map<string, ProgramStepPlan>
}

/** 每个方向效果的缺省方向（PowerPoint 同款：飞入自下·擦除自左·飞出往下） */
function dirOf(phase: AnimPhase, effect: string, d?: AnimDirection): AnimDirection | undefined {
  if (!DIRECTIONAL_EFFECTS.includes(effect)) return undefined
  if (d) return d
  return effect === 'wipe' ? 'left' : 'down'
}

export function animClassName(phase: AnimPhase, effect: string, direction?: AnimDirection): string {
  const d = dirOf(phase, effect, direction)
  return `sk-a sk-a-${phase} sk-e-${phase}-${effect}${d ? `-${d}` : ''}`
}

/**
 * 页动画序列 ⇒ 每个组件要包几层动画壳（按序列顺序由外到内）＋影片／程序步骤的记号。
 * 挂在不存在（或已隐藏）组件上的条目跳过；影片步骤只认挂在影片上的、程序步骤只认挂在程序组件上的（种类对不上＝跳过）。
 * 程序步骤每个组件最多 programStepsMax 条（多的跳过）。
 * 书签（程序组件 cues）：点名的那条动画（animationId·不给＝那个组件第一条还没被点名的基础／影片动画）不再排进单击组，
 *   改成程序播到那一秒才点亮（基础动画壳带 sk-cue＋data-sk-anim；影片步骤记号带 cue）。
 */
export function planPageAnimations(
  anims: readonly SlideAnimation[] | undefined,
  liveIds: ReadonlySet<string>,
  opts: PlanOptions = {},
): PagePlan {
  const byComponent = new Map<string, AnimWrap[]>()
  const markers: StepMarker[] = []
  const programs = new Map<string, ProgramStepPlan>()
  const progs = opts.programs ?? new Map<string, { cues?: readonly ProgramCue[] }>()
  const videos = opts.videos ?? new Set<string>()
  const perProg = new Map<string, number>()
  // ① 先筛：活着的、种类对得上的、程序步骤不超量
  const list: SlideAnimation[] = []
  for (const a of anims ?? []) {
    if (!a || !liveIds.has(a.componentId)) continue
    if (a.phase === 'media' && !videos.has(a.componentId)) continue
    if (a.phase === 'program') {
      if (!progs.has(a.componentId)) continue
      const n = (perProg.get(a.componentId) ?? 0) + 1
      if (n > COMPONENT_LIMITS.programStepsMax) continue
      perProg.set(a.componentId, n)
    }
    list.push(a)
  }
  // ② 书签认领（叠层由下而上·同一条只被认领一次·程序步骤不收）
  const claimed = new Set<string>()
  for (const [pid, p] of progs) {
    const out: ProgramStepPlan = { explicit: perProg.get(pid) ?? 0, cues: [] }
    for (const cue of p.cues ?? []) {
      const ok = (a: SlideAnimation) => a.componentId === cue.componentId && a.phase !== 'program' && !claimed.has(a.id)
      const hit = cue.animationId ? list.find((a) => a.id === cue.animationId && ok(a)) : list.find(ok)
      if (!hit) continue
      claimed.add(hit.id)
      out.cues.push({ step: cue.step, atSec: cue.atSec, anims: [hit.id] })
    }
    programs.set(pid, out)
  }
  // ③ 排组（与原口径同：单击开新组·同时＝同起点·之后＝接在上一项结束）
  let group = 0
  let prevStart = 0
  let prevEnd = 0
  let hasClickSteps = false
  const progIdx = new Map<string, number>()
  const push = (id: string, w: AnimWrap) => {
    const l = byComponent.get(id) ?? []
    l.push(w)
    byComponent.set(id, l)
  }
  for (const a of list) {
    if (claimed.has(a.id)) {
      // 书签点名的：不占单击·点亮时间由程序决定（delayMs＝点亮后再等多久）
      if (isBasicAnimation(a)) {
        push(a.componentId, { className: `${animClassName(a.phase, a.effect, a.direction)} sk-cue`, durationMs: Math.max(1, a.durationMs || 0), delayMs: Math.max(0, a.delayMs || 0), animId: a.id })
      } else if (a.phase === 'media') {
        markers.push({ animId: a.id, componentId: a.componentId, kind: 'media', cue: true, delayMs: Math.max(0, a.delayMs || 0), effect: a.effect, ...(typeof a.seekSec === 'number' ? { seekSec: a.seekSec } : {}) })
      }
      continue
    }
    let start: number
    if (a.trigger === 'click') {
      group++
      hasClickSteps = true
      start = 0
    } else if (a.trigger === 'with') {
      start = prevStart
    } else {
      start = prevEnd
    }
    const delay = start + Math.max(0, a.delayMs || 0)
    prevStart = start
    if (isBasicAnimation(a)) {
      const dur = Math.max(1, a.durationMs || 0)
      prevEnd = delay + dur
      push(a.componentId, {
        className: `${animClassName(a.phase, a.effect, a.direction)}${group === 0 ? ' sk-auto' : ''}`,
        ...(group > 0 ? { step: group } : {}),
        durationMs: dur,
        delayMs: delay,
      })
      continue
    }
    // 影片步骤 durationMs 不算（存 0）；程序步骤用它当「之后」的接续估计
    prevEnd = delay + (a.phase === 'program' ? Math.max(0, a.durationMs || 0) : 0)
    const where = group > 0 ? { step: group } : { auto: true }
    if (a.phase === 'media') {
      markers.push({ animId: a.id, componentId: a.componentId, kind: 'media', ...where, delayMs: delay, effect: a.effect, ...(typeof a.seekSec === 'number' ? { seekSec: a.seekSec } : {}) })
    } else {
      const index = (progIdx.get(a.componentId) ?? 0) + 1
      progIdx.set(a.componentId, index)
      markers.push({ animId: a.id, componentId: a.componentId, kind: 'program', ...where, delayMs: delay, index })
    }
  }
  return { byComponent, hasClickSteps, markers, programs }
}

const FLY: Record<AnimDirection, string> = {
  left: 'translateX(-1200px)',
  right: 'translateX(1200px)',
  up: 'translateY(-800px)',
  down: 'translateY(800px)',
}
const WIPE: Record<AnimDirection, string> = {
  left: 'inset(0 100% 0 0)',
  right: 'inset(0 0 0 100%)',
  up: 'inset(0 0 100% 0)',
  down: 'inset(100% 0 0 0)',
}
const DIRS: AnimDirection[] = ['left', 'right', 'up', 'down']

/** 一个效果类选中「被点亮（.visible）或自动播（.sk-auto）」的那一刻才套上关键帧 */
const on = (cls: string) => `.${cls}.visible,.${cls}.sk-auto`

/** 动画样式表（整份 deck 一次）·编辑器预览也用同一份 */
export function animationCss(): string {
  const kf: string[] = [
    '@keyframes sk-appear{0%,99.9%{opacity:0}100%{opacity:1}}',
    '@keyframes sk-fade-in{from{opacity:0}to{opacity:1}}',
    '@keyframes sk-float-in{from{opacity:0;transform:translateY(60px)}to{opacity:1;transform:none}}',
    '@keyframes sk-zoom-in{from{opacity:0;transform:scale(.3)}to{opacity:1;transform:none}}',
    '@keyframes sk-spin-in{from{opacity:0;transform:rotate(-360deg) scale(.3)}to{opacity:1;transform:none}}',
    '@keyframes sk-bounce-in{0%{transform:translateY(-600px)}60%{transform:translateY(0)}75%{transform:translateY(-40px)}90%{transform:translateY(0)}95%{transform:translateY(-10px)}100%{transform:none}}',
    '@keyframes sk-pulse{0%,100%{transform:none}50%{transform:scale(1.08)}}',
    '@keyframes sk-teeter{0%,100%{transform:none}20%{transform:rotate(-6deg)}40%{transform:rotate(6deg)}60%{transform:rotate(-4deg)}80%{transform:rotate(4deg)}}',
    '@keyframes sk-grow{from{transform:none}to{transform:scale(1.15)}}',
    '@keyframes sk-disappear{0%,99.9%{opacity:1}100%{opacity:0}}',
    '@keyframes sk-fade-out{from{opacity:1}to{opacity:0}}',
    '@keyframes sk-zoom-out{from{opacity:1;transform:none}to{opacity:0;transform:scale(.3)}}',
  ]
  for (const d of DIRS) {
    kf.push(`@keyframes sk-fly-in-${d}{from{transform:${FLY[d]}}to{transform:none}}`)
    kf.push(`@keyframes sk-fly-out-${d}{from{transform:none}to{transform:${FLY[d]}}}`)
    kf.push(`@keyframes sk-wipe-in-${d}{from{clip-path:${WIPE[d]}}to{clip-path:inset(0 0 0 0)}}`)
  }
  const rules: string[] = [
    '.sk-a{position:absolute;inset:0;animation-fill-mode:both;animation-timing-function:ease-out}',
    // 单击组的进场：点亮之前不可见（用 opacity·左栏缩略图与 pptx 导出的「[data-step]{opacity:1!important}」能照常全显）
    '.sk-a-enter[data-step]:not(.visible){opacity:0}',
    // 书签点名的进场：程序播到那一秒才点亮（之前不可见）
    '.sk-a-enter.sk-cue:not(.visible){opacity:0}',
    `${on('sk-e-enter-appear')}{animation-name:sk-appear;animation-timing-function:linear}`,
    `${on('sk-e-enter-fade')}{animation-name:sk-fade-in}`,
    `${on('sk-e-enter-float')}{animation-name:sk-float-in}`,
    `${on('sk-e-enter-zoom')}{animation-name:sk-zoom-in}`,
    `${on('sk-e-enter-spin')}{animation-name:sk-spin-in}`,
    `${on('sk-e-enter-bounce')}{animation-name:sk-bounce-in}`,
    `${on('sk-e-emphasis-pulse')}{animation-name:sk-pulse}`,
    `${on('sk-e-emphasis-teeter')}{animation-name:sk-teeter}`,
    `${on('sk-e-emphasis-grow')}{animation-name:sk-grow}`,
    `${on('sk-e-exit-disappear')}{animation-name:sk-disappear;animation-timing-function:linear}`,
    `${on('sk-e-exit-fade')}{animation-name:sk-fade-out}`,
    `${on('sk-e-exit-zoom')}{animation-name:sk-zoom-out;animation-timing-function:ease-in}`,
  ]
  for (const d of DIRS) {
    rules.push(`${on(`sk-e-enter-fly-${d}`)}{animation-name:sk-fly-in-${d}}`)
    rules.push(`${on(`sk-e-enter-wipe-${d}`)}{animation-name:sk-wipe-in-${d};animation-timing-function:linear}`)
    rules.push(`${on(`sk-e-exit-fly-${d}`)}{animation-name:sk-fly-out-${d};animation-timing-function:ease-in}`)
  }
  return kf.join('\n') + '\n' + rules.join('\n')
}
