/**
 * 程序动画组件·影片步骤·可拆动画声明的共用格式。
 *
 * 这一档只放格式与讯号常量，不放渲染、不放导出：
 *   放映／编辑预览／画布小窗（A＋B）照这里收发讯号、排步骤；
 *   导出 pptx照这里把影片步骤、程序步骤、可拆元件、书签转成 PowerPoint 动画。
 * 改栏位要两边一起改（⛔ 单边加栏）。
 */

import type { CompiledProgram } from './program-source'

/* ------------------------------------------------------------------ */
/* 程序动画组件（type＝'program'）                                     */
/* ------------------------------------------------------------------ */

/**
 * 程序组件的内容栏（组件本体＝ComponentBase<'program'> & ProgramFields·由 types.ts 拼）。
 * 渲染：一律进 sandbox="allow-scripts" 的 iframe（opaque origin·与 HtmlComponent 同一套沙盒）·放映产物也不内联。
 */
export type ProgramFields = {
  /** body 内容（HTML＋<script>·可用 canvas）·运行时会另注入 window.dilinProgram（见 PROGRAM_RUNTIME_API） */
  html: string
  /** 额外样式（放进 <head><style>） */
  css?: string
  /** 设计尺寸（程序里的坐标系）·渲染时等比缩进组件框·不给＝组件框原尺寸 */
  designW?: number
  designH?: number
  /** 声明的步数（程序载入后也可用讯号 steps 回报·以回报为准）·不给＝0（只自己播、不吃「下一步」） */
  steps?: number
  /** 背景透明（不给＝true）·false＝垫 bgColor */
  transparent?: boolean
  bgColor?: string
  /** 可拆动画声明：给了＝导出 pptx 拆成元件＋原生动画；不给＝拆不开 ⇒ 每步录成一小段影片 */
  decompose?: ProgramDecompose
  /** 播到第几秒触发页上某个组件的动画（导出 pptx 成影片书签 On Bookmark 触发） */
  cues?: ProgramCue[]
  /**
   * 计时闸：服务端编译产物（插过检查的作者片段＋CSP 名单＋逐段记录）。
   * ⛔ 客户端／op／模板／导入送进来的一律不认：每个服务端写路由 compileDeckPrograms（program-deck.server.ts）剥掉重算。
   * 客户端只在 compiled.v 现行且 compiled.key＝tryProgramSourceKey({html,css,steps}) 时才跑它；否则静态（⛔ 退回跑原文）。
   */
  compiled?: CompiledProgram
  /** 只出现在读回包（GET／渲染时当场编译失败的白话原因）·⛔ 落库：写路先剥 */
  compileError?: string
}

/* ------------------------------------------------------------------ */
/* iframe 往返讯号（postMessage·都带 __dlp: 1）                         */
/* ------------------------------------------------------------------ */

export const PROGRAM_MSG_TAG = '__dlp' as const

/** 程序 → 外层 */
export type ProgramToHostMsg =
  /** 载入好了（外层收到后才送 step） */
  | { __dlp: 1; type: 'ready' }
  /** 回报总步数 N（0＝不吃下一步） */
  | { __dlp: 1; type: 'steps'; steps: number }
  /** 第 index 步播完（可选·外层不靠它推进） */
  | { __dlp: 1; type: 'stepDone'; index: number }

/** 外层 → 程序 */
export type HostToProgramMsg =
  /**
   * 走到「已做完 index 步」的状态（0＝初始·N＝全部做完）。
   * animate=true＝从 index-1 播到 index（下一步）；false＝直接跳到那个状态（上一步、换页回来、录片前摆位）。
   */
  | { __dlp: 1; type: 'step'; index: number; animate: boolean }

/**
 * 注入 iframe 的小运行时（作者／AI 写程序时用）：
 *   dilinProgram.setSteps(n)          ⇒ 送 steps
 *   dilinProgram.onStep(fn)           ⇒ fn(index, animate) 在收到 step 时调用
 *   dilinProgram.done(index)          ⇒ 送 stepDone
 * 载入完自动送 ready；html 里没调 setSteps 时，按组件 steps 栏自动回报。
 */
export const PROGRAM_RUNTIME_API = ['setSteps', 'onStep', 'done'] as const

/* ------------------------------------------------------------------ */
/* 页动画表里的两种新动画                                               */
/* ------------------------------------------------------------------ */

/**
 * 影片步骤（挂在 video 组件上）：phase='media'。
 *   play  从当前位置播（给 seekSec ＝先跳到那秒再播）
 *   pause 暂停
 *   seek  跳到 seekSec 秒（不改播放／暂停状态）
 * trigger／delayMs 与基础动画同义；durationMs 忽略（存 0）。
 */
export const MEDIA_ANIM_EFFECTS = ['play', 'pause', 'seek'] as const
export type MediaAnimEffect = (typeof MEDIA_ANIM_EFFECTS)[number]

/**
 * 程序步骤（挂在 program 组件上）：phase='program'·effect='step'·每条＝程序往前走一步。
 * 页动画表里有某个程序组件的程序步骤 ⇒ 照表里的位置与触发（click／with／after）走；
 * 没有 ⇒ 隐式：它的 N 步排在本页所有动画之后、每步一次单击（多个程序组件按叠层由下而上）。
 * 程序步骤条数多于 N ⇒ 多出的忽略；少于 N ⇒ 剩下的照隐式规则补在本页最后。
 */
export const PROGRAM_ANIM_EFFECTS = ['step'] as const
export type ProgramAnimEffect = (typeof PROGRAM_ANIM_EFFECTS)[number]

/** 页动画表的新栏（与 SlideAnimation 并列·types.ts 拼进联合型别） */
export type MediaAnimFields = { phase: 'media'; effect: MediaAnimEffect; seekSec?: number }
export type ProgramAnimFields = { phase: 'program'; effect: ProgramAnimEffect }

/* ------------------------------------------------------------------ */
/* 可拆动画声明（导出 pptx 拆成元件＋原生动画）                          */
/* ------------------------------------------------------------------ */

/** 程序里的一个元件（DOM 上标 data-part="id"·方便对位） */
export type ProgramPart = {
  id: string
  /** 起始框 */
  frame: { x: number; y: number; w: number; h: number; rotate?: number }
  /** 外观之一：图片（https／data:image png·jpeg·svg+xml） */
  src?: string
  /** 外观之二：简单形状（可带字） */
  shape?: { kind: 'rect' | 'roundRect' | 'ellipse'; fill?: string; stroke?: string; text?: string; color?: string; size?: number }
  /** 起始看不看得见（不给＝true·第一步才出现的给 false） */
  visible?: boolean
}

export const PROGRAM_ACTION_KINDS = ['appear', 'disappear', 'fadeIn', 'fadeOut', 'move', 'scale', 'rotate'] as const
export type ProgramActionKind = (typeof PROGRAM_ACTION_KINDS)[number]

/** 一步里的一个动作 */
export type ProgramAction = {
  part: string
  kind: ProgramActionKind
  /** move：相对当前位置的位移·给 path＝折线路径（相对起点的点列·含终点）·二者择一 */
  dx?: number
  dy?: number
  path?: Array<[number, number]>
  /** scale：相对当前大小的倍数 */
  scale?: number
  /** rotate：顺时针度数（相对当前） */
  deg?: number
  durationMs: number
  delayMs?: number
  /** 一步之内：第一个动作永远跟着这一步的触发；后面的 with＝与上一个同时·after＝上一个之后（不给＝with） */
  trigger?: 'with' | 'after'
}

/** steps[k]＝第 k+1 步（「依序出现」＝几个 appear 用 after 串起来） */
export type ProgramDecompose = { parts: ProgramPart[]; steps: Array<{ actions: ProgramAction[] }> }

/* ------------------------------------------------------------------ */
/* 书签（程序播到第几秒触发页上某组件）                                  */
/* ------------------------------------------------------------------ */

/**
 * step＝第几步（1 起）·atSec＝那一步开始后几秒·componentId＝页上要动的组件；
 * animationId＝触发哪一条动画（不给＝那个组件在页动画表里第一条还没播的）。
 * 放映：到点直接播那条动画（它在页动画表里原本的触发就不再等单击）；
 * pptx：那一步录成的影片在 atSec 加书签，那条动画改成 On Bookmark 触发。
 */
export type ProgramCue = { step: number; atSec: number; componentId: string; animationId?: string }
