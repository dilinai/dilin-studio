/**
 * slide-kit · 组件化 · 程序动画组件——iframe 文件、注入的小运行时、新增时的默认范例。
 *
 *   程序组件一律渲进 sandbox 的 iframe（opaque origin·与 HtmlComponent 同一套沙盒·放映产物也不内联）：
 *   只有当下播放／编辑中那页才 sandbox="allow-scripts"；其余（缩图、预览、非当前页）sandbox=""＝只画静态、不跑作者码。
 *   iframe 文件＝基础重置＋作者 css＋运行时 window.dilinProgram（在作者 html 之前载入）＋作者 html。
 *   运行时（讯号格式见 program-types.ts·都带 __dlp:1）：
 *     dilinProgram.setSteps(n)   ⇒ 送 {type:'steps', steps:n}
 *     dilinProgram.onStep(fn)    ⇒ 收到外层 {type:'step', index, animate} 时 fn(index, animate)（注册晚了也会补叫一次最后那步）
 *     dilinProgram.done(index)   ⇒ 送 {type:'stepDone', index}
 *     载入完（window load）：没调过 setSteps ⇒ 按组件 steps 栏回报；再送 ready。
 *   只收「外层（window.parent）」送来的讯号（e.source 核对）。
 * 纯函数·客户端／服务端共用。
 */

import type { Theme } from '../types'
import { fontStack as themeFontStack } from '../themes'
import { COMPONENT_LIMITS, type ProgramComponent } from './types'
import { SLIDES_PROGRAM_HEAD_GUARD } from '../../../shared/program-sandbox'

/**
 * 程序 iframe 的 sandbox 值（原题加固：钉死这两个值·⛔ 加 allow-same-origin 等任何别的 token）：
 *   PROGRAM_SANDBOX_RUN＝真在跑（当下播放／编辑中那页）；PROGRAM_SANDBOX_STATIC＝不跑作者码（缩图、预览、非当前页：只画静态 html／css）。
 */
export const PROGRAM_SANDBOX_RUN = 'allow-scripts'
export const PROGRAM_SANDBOX_STATIC = ''

/** 注入 iframe 的运行时（declared＝组件 steps 栏·程序没自己 setSteps 时回报它） */
export function programRuntimeJs(declared: number): string {
  const max = COMPONENT_LIMITS.programStepsMax
  const n = Math.max(0, Math.min(max, Math.round(Number(declared) || 0)))
  return [
    '(function(){',
    'var P=window.parent,sent=false,hs=[],last=null;',
    "function send(m){m.__dlp=1;try{P.postMessage(m,'*')}catch(e){}}",
    'window.dilinProgram={',
    `setSteps:function(n){n=Math.max(0,Math.min(${max},Math.floor(Number(n)||0)));sent=true;send({type:'steps',steps:n})},`,
    'onStep:function(fn){if(typeof fn!=="function")return;hs.push(fn);if(last){try{fn(last.index,last.animate)}catch(e){console.error(e)}}},',
    "done:function(i){send({type:'stepDone',index:Math.max(0,Math.floor(Number(i)||0))})},",
    'get index(){return last?last.index:0}',
    '};',
    "window.addEventListener('message',function(e){if(e.source!==P)return;var d=e.data;if(!d||d.__dlp!==1||d.type!=='step')return;",
    'var i=Math.max(0,Math.floor(Number(d.index)||0)),a=!!d.animate;last={index:i,animate:a};',
    'for(var k=0;k<hs.length;k++){try{hs[k](i,a)}catch(err){console.error(err)}}});',
    `window.addEventListener('load',function(){if(!sent)send({type:'steps',steps:${n}});send({type:'ready'})});`,
    '})();',
  ].join('')
}

/** 设计尺寸（程序里的坐标系）·不给＝组件框原尺寸 */
export function programDesignSize(c: Pick<ProgramComponent, 'designW' | 'designH' | 'frame'>): { w: number; h: number } {
  return { w: c.designW ?? Math.max(1, c.frame.w), h: c.designH ?? Math.max(1, c.frame.h) }
}

/**
 * 程序组件的 iframe 文件（srcdoc）。bg＝已解出的背景色（transparent 不是 false ⇒ 'transparent'）。
 * 作者的 css／html 原样放（它只在自己的沙盒里跑·读不到父页 cookie 与 DOM）。
 * <head> 最前面先放断网规则（lib/program-sandbox.ts·与剪辑程序片段同一套）——
 *   强制 CSP（作者后面再写一张只会更严）＋RTC／子框／Worker 守卫（比作者码先跑）。⛔ 往 SLIDES_PROGRAM_HEAD_GUARD 前面塞东西。
 */
export function programComponentDoc(c: ProgramComponent, theme: Theme, bg: string): string {
  const { w, h } = programDesignSize(c)
  const head = `<meta charset="UTF-8">${SLIDES_PROGRAM_HEAD_GUARD}<meta name="color-scheme" content="light"><style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}:root{color-scheme:light}html,body{width:${w}px;height:${h}px;overflow:hidden;background:${bg}}body{font-family:${themeFontStack(theme.fontPair.body)}}</style>`
  return `<!DOCTYPE html><html><head>${head}${c.css ? `<style>${c.css}</style>` : ''}<script>${programRuntimeJs(c.steps ?? 0)}</script></head><body>${c.html}</body></html>`
}

/* ------------------------------------------------------------------ */
/* 新增时的默认范例（三步小火箭·能动·示范 dilinProgram 怎么用）           */
/* ------------------------------------------------------------------ */

export const DEFAULT_PROGRAM_DESIGN = { w: 480, h: 270 } as const

export const DEFAULT_PROGRAM_CSS = [
  '#sky{position:relative;width:480px;height:270px}',
  '#pad{position:absolute;left:28px;bottom:10px;width:96px;height:6px;border-radius:3px;background:#94A3B8}',
  '#rocket{position:absolute;left:0;top:0;font-size:52px;line-height:1;will-change:transform}',
  '#trail{position:absolute;left:0;top:0;width:0;height:4px;border-radius:2px;background:linear-gradient(90deg,rgba(251,146,60,0),#FB923C);transform-origin:0 50%}',
  '#label{position:absolute;right:14px;bottom:8px;font-size:18px;color:#64748B}',
].join('\n')

export const DEFAULT_PROGRAM_HTML = [
  '<div id="sky"><div id="pad"></div><div id="trail"></div><div id="rocket">🚀</div><div id="label">0 / 3</div></div>',
  '<script>',
  '// 三步小火箭：每按一次「下一步」往右上飞一段（上一步＝直接跳回上一个位置）',
  'var rocket = document.getElementById("rocket"), trail = document.getElementById("trail"), label = document.getElementById("label");',
  'var spots = [{x: 40, y: 196}, {x: 150, y: 140}, {x: 270, y: 84}, {x: 390, y: 14}];',
  'function show(i, animate) {',
  '  var p = spots[i], ease = animate ? "transform .9s cubic-bezier(.3,.7,.3,1)" : "none";',
  '  rocket.style.transition = ease; trail.style.transition = animate ? "width .9s cubic-bezier(.3,.7,.3,1)" : "none";',
  '  rocket.style.transform = "translate(" + p.x + "px," + p.y + "px)";',
  '  var dx = p.x - spots[0].x, dy = p.y - spots[0].y;',
  '  trail.style.transform = "translate(" + (spots[0].x + 26) + "px," + (spots[0].y + 26) + "px) rotate(" + Math.atan2(dy, dx) + "rad)";',
  '  trail.style.width = Math.sqrt(dx * dx + dy * dy) + "px";',
  '  label.textContent = i + " / 3";',
  '}',
  'show(0, false);',
  'dilinProgram.setSteps(3);',
  'dilinProgram.onStep(function (i, animate) { show(Math.min(3, i), animate); });',
  '</script>',
].join('\n')
