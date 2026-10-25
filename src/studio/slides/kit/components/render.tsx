/**
 * slide-kit · 组件化 · 渲染器（一页组件 ⇒ React）
 *
 * 同一个组件在三处渲：服务端出整份 html_content（deck-html·react-dom/server）／编辑器画布／缩略图——三处同一份码。
 *   mode='deck'   放映产物：带动画壳（data-step＋.visible）·html 组件内联（整份 deck 本来就在沙盒 iframe 里渲）
 *   mode='editor' 编辑器画布：不带动画·空文字框显提示字·影片不自动播；
 *                 🔴 html 组件一律放进 sandbox="allow-scripts" 的 iframe（与现在的简报预览同一种沙盒·opaque origin）·
 *                 ⛔ 把那段 HTML 塞进编辑器页面 DOM（可能是 AI 写的·可能带脚本）
 *   mode='thumb'  缩略：同 editor 但不显提示字
 * program 组件三种模式一律进 sandbox iframe（放映产物也是）；影片／程序步骤渲成隐形记号（deck／editor·执行器 steps.ts）。
 *   只有编辑画布（runPrograms）与放映当下那页真跑作者码；缩图／各种预览只画静态；一页最多 programsPerPage 个（含组合里的）。
 * 文字一律经 React 转义（资料是段落＋片段·不是 HTML 串）。
 */

import * as React from 'react'
import type { PageType, Theme } from '../types'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../types'
import { cropInsetStyle, isRenderableCrop } from '../layouts/shared'
import { fontStack as themeFontStack } from '../themes'
import { animationCss, planPageAnimations, type AnimWrap, type ProgramStepPlan, type StepMarker } from './anim'
import { plainTextOf, resolveColor, resolveCtx, resolveFontStack, type ResolveCtx } from './resolve'
import { bgFillMatrix, cssMatrix, mul } from './geom'
import { PROGRAM_SANDBOX_RUN, PROGRAM_SANDBOX_STATIC, programComponentDoc, programDesignSize } from './program'
import { hardenProgramFramesHtml } from './program-harden'
import { PROGRAM_ALIVE_WAIT_MS, injectProgramAliveProbe, programAliveNonce, type ProgramStopWhy } from '../../../shared/program-sandbox'
import { ProgramWatchdog, PROGRAM_WATCH_PING_MS, programWatchdogSupported, programWatchNonce } from './program-watchdog'
import type { ProgramCue } from './program-types'
import { assembleProgramDoc, programNoticeText, type ProgramFrameProps, type ProgramNotStarted, type ProgramNoticeLang } from './program-assemble'
export { programNoticeText, type ProgramNotStarted } from './program-assemble'
import { PROGRAM_COMPILED_V, tryProgramSourceKey, type CompiledProgram } from './program-source'
import { COMPONENT_LIMITS } from './types'
import type {
  ArcAngles,
  ColorValue,
  Frame,
  ChartComponent,
  HtmlComponent,
  ImageComponent,
  PageBackground,
  ProgramComponent,
  ShapeComponent,
  SlideAnimation,
  SlideComponent,
  Stroke,
  TableComponent,
  TextBody,
  TextParagraph,
  TextRun,
  VideoComponent,
} from './types'

export type ComponentRenderMode = 'deck' | 'editor' | 'thumb'

export type ComponentSlideViewProps = {
  components: readonly SlideComponent[]
  animations?: readonly SlideAnimation[]
  background?: PageBackground
  theme: Theme
  /** 页型（决定色板深浅） */
  pageType: PageType
  mode: ComponentRenderMode
  /** 目标宽度（px）·不给＝1000（deck-html 用逻辑尺寸·由舞台脚本缩放） */
  width?: number
  /** 编辑器：空文字框的提示字（按 role 取·不给＝不显） */
  placeholderFor?: (c: SlideComponent) => string | undefined
  /** 编辑器：图片／影片的显示用网址（私密媒体换签名链）·不给＝原样 */
  mediaUrl?: (src: string) => string
  /** 编辑器的动画预览：editor 模式也套动画壳（html 组件照旧进沙盒 iframe）·只放动画对话框的预览用 */
  playAnimations?: boolean
  /** editor 模式的程序动画真跑（只给编辑画布「当下编辑中那页」）；不给＝只画静态（缩图／版式／动画／转场预览都不跑作者码）。
   *  deck 模式不看这栏（一律 lazy：进到那页才由放映执行器跑）；thumb 一律静态。 */
  runPrograms?: boolean
  /** 计时闸：程序框「为什么没在跑」那句提示的语言（不给＝繁中） */
  lang?: 'zh-TW' | 'zh-CN' | 'en'
}

/* ------------------------------------------------------------------ */
/* 文字                                                                */
/* ------------------------------------------------------------------ */

const UL_MARK: Record<string, string> = { disc: '•', circle: '◦', square: '▪' }

function toAlpha(n: number): string {
  let s = ''
  let x = n
  do { s = String.fromCharCode(97 + ((x - 1) % 26)) + s; x = Math.floor((x - 1) / 26) } while (x > 0)
  return s
}
function toRoman(n: number): string {
  const t: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
  let x = Math.max(1, Math.min(3999, n)); let s = ''
  for (const [v, r] of t) while (x >= v) { s += r; x -= v }
  return s
}

/** 段落的编号标记（ol 按「同一缩进连续的 ol 段」计数） */
function markers(paragraphs: readonly TextParagraph[]): Array<string | null> {
  const out: Array<string | null> = []
  const counters = new Map<number, number>()
  for (const p of paragraphs) {
    const ind = p.indent ?? 0
    if (!p.list) { counters.clear(); out.push(null); continue }
    if (p.list.kind === 'ul') { out.push(UL_MARK[p.list.style] ?? '•'); continue }
    const n = (counters.get(ind) ?? 0) + 1
    counters.set(ind, n)
    for (const k of [...counters.keys()]) if (k > ind) counters.delete(k)
    out.push(p.list.style === 'lower-alpha' ? `${toAlpha(n)}.` : p.list.style === 'lower-roman' ? `${toRoman(n)}.` : `${n}.`)
  }
  return out
}

function runStyle(r: TextRun, ctx: ResolveCtx): React.CSSProperties {
  const deco = [r.underline ? 'underline' : '', r.strike ? 'line-through' : ''].filter(Boolean).join(' ')
  return {
    ...(r.bold !== undefined ? { fontWeight: r.bold ? 700 : 400 } : {}),
    ...(r.italic !== undefined ? { fontStyle: r.italic ? 'italic' : 'normal' } : {}),
    ...(deco ? { textDecoration: deco } : {}),
    ...(r.sup ? { verticalAlign: 'super', fontSize: '0.7em' } : r.sub ? { verticalAlign: 'sub', fontSize: '0.7em' } : {}),
    ...(r.color ? { color: resolveColor(r.color, ctx, 'inherit') } : {}),
    ...(r.highlight ? { backgroundColor: resolveColor(r.highlight, ctx, 'transparent') } : {}),
    ...(r.font ? { fontFamily: resolveFontStack(r.font, ctx) } : {}),
    ...(typeof r.size === 'number' && !r.sup && !r.sub ? { fontSize: r.size } : {}),
    ...(r.shadow ? { textShadow: '1px 1px 2px rgba(0,0,0,.35)' } : {}),
  }
}

function strokeCss(s: Stroke | null | undefined, ctx: ResolveCtx): string | undefined {
  if (!s || !(s.width > 0)) return undefined
  return `${s.width}px ${s.dash ?? 'solid'} ${resolveColor(s.color, ctx, 'transparent')}`
}

/** 文字本体（text 组件／形状内文字共用） */
function TextBodyView(props: { body: TextBody; ctx: ResolveCtx; frameH: number; placeholder?: string }): React.JSX.Element {
  const { body, ctx, frameH, placeholder } = props
  const box = body.box
  const paragraphs = Array.isArray(body.paragraphs) ? body.paragraphs : []
  const empty = paragraphs.every((p) => (p.runs ?? []).every((r) => !r.text))
  const lh = box.lineHeight > 0 ? box.lineHeight : 1.45
  const lineH = box.size * lh
  const clampLines = box.clamp
    ? Math.max(1, box.maxLines ?? Math.floor((frameH - 2 * (box.padding ?? 0)) / lineH + 0.001))
    : undefined
  const single = paragraphs.length === 1
  const marks = markers(paragraphs)
  const justify = box.valign === 'middle' ? 'center' : box.valign === 'bottom' ? 'flex-end' : 'flex-start'
  const container: React.CSSProperties = {
    position: 'absolute', inset: 0, boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', justifyContent: justify,
    padding: box.padding ?? 0,
    fontFamily: resolveFontStack(box.font, ctx),
    fontSize: box.size,
    color: resolveColor(box.color, ctx, ctx.palette.text),
    fontWeight: box.bold ? 700 : 400,
    fontStyle: box.italic ? 'italic' : 'normal',
    lineHeight: lh,
    ...(box.letterSpacing ? { letterSpacing: box.letterSpacing } : {}),
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
    ...(box.fill ? { background: resolveColor(box.fill, ctx) } : {}),
    ...(box.border ? { border: strokeCss(box.border, ctx) } : {}),
    ...(box.radius ? { borderRadius: box.radius } : {}),
    // 给了 maxLines（版式派生）＝字可以超出框底往下长（与旧版式同效）；没给＝框就是边界
    overflow: box.clamp && !box.maxLines ? 'hidden' : 'visible',
  }
  if (empty && placeholder) {
    return (
      <div style={container}>
        <div style={{ opacity: 0.4, textAlign: box.align === 'center' ? 'center' : box.align === 'right' ? 'right' : 'left' }}>{placeholder}</div>
      </div>
    )
  }
  return (
    <div style={container}>
      {paragraphs.map((p, i) => {
        const align = p.align ?? box.align
        const ind = Math.max(0, Math.min(8, p.indent ?? 0))
        const mark = marks[i]
        const padLeft = ind * 1.5 + (mark ? 1.4 : 0)
        const style: React.CSSProperties = {
          margin: 0,
          textAlign: align === 'distribute' ? 'justify' : align,
          ...(align === 'distribute' ? { textAlignLast: 'justify' } : {}),
          ...(p.lineHeight ? { lineHeight: p.lineHeight } : {}),
          ...(padLeft ? { paddingLeft: `${padLeft}em`, position: 'relative' } : {}),
          ...(clampLines && single
            ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: clampLines, overflow: 'hidden' }
            : {}),
        }
        const runs = (p.runs ?? []).filter((r) => typeof r?.text === 'string')
        return (
          <div key={i} style={style}>
            {mark ? <span style={{ position: 'absolute', left: `${ind * 1.5}em`, width: '1.4em' }}>{mark}</span> : null}
            {runs.length === 0 || runs.every((r) => !r.text)
              ? '​'
              : runs.map((r, j) => {
                  const st = runStyle(r, ctx)
                  return Object.keys(st).length ? <span key={j} style={st}>{r.text}</span> : <React.Fragment key={j}>{r.text}</React.Fragment>
                })}
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 图片 · 影片                                                         */
/* ------------------------------------------------------------------ */

/** 缺图占位（与旧版式 Figure 占位同一画法：主题渐层＋圆点母题） */
function MediaPlaceholder(props: { ctx: ResolveCtx; radius: number; play?: boolean }): React.JSX.Element {
  const p = props.ctx.palette
  return (
    <div style={{ position: 'absolute', inset: 0, borderRadius: props.radius, overflow: 'hidden', boxSizing: 'border-box', background: `linear-gradient(135deg, ${p.figureBg} 0%, ${p.surface} 100%)`, border: `1px solid ${p.border}` }}>
      <div style={{ position: 'absolute', right: '-12%', bottom: '-22%', width: '55%', aspectRatio: '1', borderRadius: '50%', background: p.accent, opacity: 0.16 }} />
      <div style={{ position: 'absolute', left: '8%', top: '10%', width: 14, height: 14, borderRadius: '50%', background: p.accent, opacity: 0.55 }} />
      {props.play ? (
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 0, height: 0, borderTop: '18px solid transparent', borderBottom: '18px solid transparent', borderLeft: `30px solid ${p.accent}`, opacity: 0.7 }} />
      ) : null}
    </div>
  )
}

function ImageView(props: { c: ImageComponent; ctx: ResolveCtx; mediaUrl?: (s: string) => string }): React.JSX.Element {
  const { c, ctx } = props
  const radius = c.radius ?? 0
  if (!c.src) return <MediaPlaceholder ctx={ctx} radius={radius} />
  const url = props.mediaUrl ? props.mediaUrl(c.src) : c.src
  const flip = [c.flipX ? 'scaleX(-1)' : '', c.flipY ? 'scaleY(-1)' : ''].filter(Boolean).join(' ')
  const imgStyle: React.CSSProperties = isRenderableCrop(c.crop)
    ? cropInsetStyle(c.crop)
    : { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: c.fit === 'contain' ? 'contain' : 'cover', display: 'block' }
  return (
    <div style={{ position: 'absolute', inset: 0, borderRadius: radius, overflow: 'hidden', boxSizing: 'border-box', ...(c.border ? { border: strokeCss(c.border, ctx) } : {}), ...(flip ? { transform: flip } : {}) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {/* data-src＝库里的裸链：编辑页显示层按它把 src 换成签名链（私密云盘·与手动排版层插图同一口径） */}
      <img src={url} data-src={c.src} alt="" draggable={false} style={imgStyle} />
    </div>
  )
}

function VideoView(props: { c: VideoComponent; ctx: ResolveCtx; mode: ComponentRenderMode; mediaUrl?: (s: string) => string }): React.JSX.Element {
  const { c, ctx, mode } = props
  if (!c.src) return <MediaPlaceholder ctx={ctx} radius={0} play />
  const url = props.mediaUrl ? props.mediaUrl(c.src) : c.src
  const poster = c.poster ? (props.mediaUrl ? props.mediaUrl(c.poster) : c.poster) : undefined
  const style: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: c.fit === 'contain' ? 'contain' : 'cover', display: 'block', background: '#000' }
  if (mode !== 'deck') {
    return <video src={url} poster={poster} muted playsInline preload="metadata" style={{ ...style, pointerEvents: 'none' }} />
  }
  return (
    <video src={url} data-src={c.src} poster={poster} playsInline
      controls={c.controls !== false} autoPlay={!!c.autoplay} loop={!!c.loop} muted={!!c.muted || !!c.autoplay}
      style={style} />
  )
}

/* ------------------------------------------------------------------ */
/* 形状                                                                */
/* ------------------------------------------------------------------ */

/** 页底的「画」（底色＋底图；只有底片时拿封面当底图）——页底层与幻灯片背景填充共用 */
function bgPaintStyle(bg: PageBackground | undefined, ctx: ResolveCtx, mediaUrl?: (s: string) => string): React.CSSProperties {
  const color = bg?.color ? resolveColor(bg.color, ctx, ctx.palette.bg) : ctx.palette.bg
  const raw = bg?.imageUrl || bg?.poster
  const img = raw ? (mediaUrl ? mediaUrl(raw) : raw) : undefined
  return {
    background: color,
    ...(img ? { backgroundImage: `url("${img.replace(/"/g, '%22')}")`, backgroundSize: bg?.fit === 'contain' ? 'contain' : 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' } : {}),
  }
}

/** 弧角正规（ring 不给＝整圈·arc 不给＝0→270） */
function arcSweep(a: ArcAngles | undefined, dflt: ArcAngles | null): { start: number; sweep: number } | null {
  const v = a ?? dflt
  if (!v) return null
  const sweep = ((v.end - v.start) % 360 + 360) % 360
  return { start: v.start, sweep: sweep === 0 ? 360 : sweep }
}

const fx = (n: number) => Math.round(n * 100) / 100

/**
 * 形状的外轮廓 path（填色／裁切用·原点＝框左上·ox,oy＝整体位移）＋外接框（对话框尾巴会伸出框外）。
 * rect／roundRect／ellipse 不走这里（照旧 div＋圆角·边线照旧画在框内）；line／arc 只描边。
 */
export function shapeOutline(c: ShapeComponent, ox = 0, oy = 0): { d: string; evenodd: boolean; box: { x: number; y: number; w: number; h: number } } | null {
  const { w, h } = c.frame
  const P = (x: number, y: number) => `${fx(x + ox)},${fx(y + oy)}`
  const full = { x: 0, y: 0, w, h }
  const rx = w / 2, ry = h / 2
  const ell = (cx: number, cy: number, a: number, b: number) => `M${P(cx - a, cy)} A${fx(a)} ${fx(b)} 0 1 0 ${P(cx + a, cy)} A${fx(a)} ${fx(b)} 0 1 0 ${P(cx - a, cy)} Z`
  const onEll = (a: number, b: number, deg: number) => { const r = (deg * Math.PI) / 180; return [rx + a * Math.cos(r), ry + b * Math.sin(r)] as const }
  switch (c.shape) {
    case 'triangle': return { d: `M${P(w / 2, 0)} L${P(w, h)} L${P(0, h)} Z`, evenodd: false, box: full }
    case 'diamond': return { d: `M${P(w / 2, 0)} L${P(w, h / 2)} L${P(w / 2, h)} L${P(0, h / 2)} Z`, evenodd: false, box: full }
    case 'arrow': return { d: `M${P(0, h * 0.3)} L${P(w * 0.6, h * 0.3)} L${P(w * 0.6, 0)} L${P(w, h / 2)} L${P(w * 0.6, h)} L${P(w * 0.6, h * 0.7)} L${P(0, h * 0.7)} Z`, evenodd: false, box: full }
    case 'summingJunction': return { d: ell(rx, ry, rx, ry), evenodd: false, box: full }
    case 'ring': {
      const t = Math.max(1, (c.thickness ?? 0.2) * Math.min(w, h))
      const ia = Math.max(0.5, rx - t), ib = Math.max(0.5, ry - t)
      const s = arcSweep(c.arc, null)
      if (!s || s.sweep >= 360) return { d: `${ell(rx, ry, rx, ry)} ${ell(rx, ry, ia, ib)}`, evenodd: true, box: full }
      const large = s.sweep > 180 ? 1 : 0
      const [x0, y0] = onEll(rx, ry, s.start), [x1, y1] = onEll(rx, ry, s.start + s.sweep)
      const [x2, y2] = onEll(ia, ib, s.start + s.sweep), [x3, y3] = onEll(ia, ib, s.start)
      return { d: `M${P(x0, y0)} A${fx(rx)} ${fx(ry)} 0 ${large} 1 ${P(x1, y1)} L${P(x2, y2)} A${fx(ia)} ${fx(ib)} 0 ${large} 0 ${P(x3, y3)} Z`, evenodd: false, box: full }
    }
    case 'callout': {
      const tail = c.callout ?? { side: 'bottom', pos: 25, len: 40 }
      const r = Math.max(0, Math.min(c.radius ?? 12, w / 2, h / 2))
      const L = tail.side === 'top' || tail.side === 'bottom' ? w : h
      const b = Math.max(4, Math.min(w, h) * 0.08)
      const at = Math.max(r + b, Math.min(L - r - b, (L * tail.pos) / 100))
      const tipAt = (L * tail.pos) / 100
      const pts: string[] = []
      const arc = (x: number, y: number) => (r > 0 ? `A${fx(r)} ${fx(r)} 0 0 1 ${P(x, y)}` : `L${P(x, y)}`)
      pts.push(`M${P(r, 0)}`)
      if (tail.side === 'top') pts.push(`L${P(at - b, 0)} L${P(tipAt - b, -tail.len)} L${P(at + b, 0)}`)
      pts.push(`L${P(w - r, 0)}`, arc(w, r))
      if (tail.side === 'right') pts.push(`L${P(w, at - b)} L${P(w + tail.len, tipAt - b)} L${P(w, at + b)}`)
      pts.push(`L${P(w, h - r)}`, arc(w - r, h))
      if (tail.side === 'bottom') pts.push(`L${P(at + b, h)} L${P(tipAt - b, h + tail.len)} L${P(at - b, h)}`)
      pts.push(`L${P(r, h)}`, arc(0, h - r))
      if (tail.side === 'left') pts.push(`L${P(0, at + b)} L${P(-tail.len, tipAt + b)} L${P(0, at - b)}`)
      pts.push(`L${P(0, r)}`, arc(r, 0), 'Z')
      const box = tail.side === 'top' ? { x: 0, y: -tail.len, w, h: h + tail.len }
        : tail.side === 'bottom' ? { x: 0, y: 0, w, h: h + tail.len }
          : tail.side === 'left' ? { x: -tail.len, y: 0, w: w + tail.len, h } : { x: 0, y: 0, w: w + tail.len, h }
      // 尾尖若斜出框外（pos 靠边）也包进来
      return { d: pts.join(' '), evenodd: false, box: { x: box.x - b, y: box.y - b, w: box.w + 2 * b, h: box.h + 2 * b } }
    }
    default: return null
  }
}

/** 一个箭头三角（尖在 x,y·朝 ang 弧度方向） */
function arrowHead(x: number, y: number, ang: number, sw: number): string {
  const L = Math.max(8, sw * 4), W = Math.max(5, sw * 2.5)
  const bx = x - L * Math.cos(ang), by = y - L * Math.sin(ang)
  const nx = -Math.sin(ang) * W, ny = Math.cos(ang) * W
  return `${fx(x)},${fx(y)} ${fx(bx + nx)},${fx(by + ny)} ${fx(bx - nx)},${fx(by - ny)}`
}

function ShapeView(props: { c: ShapeComponent; ctx: ResolveCtx; placeholder?: string; chain: readonly Frame[]; bg?: PageBackground; mediaUrl?: (s: string) => string; mode: ComponentRenderMode }): React.JSX.Element {
  const { c, ctx } = props
  const { w, h } = c.frame
  const fill = c.fill ? resolveColor(c.fill, ctx) : 'none'
  const sw = c.stroke && c.stroke.width > 0 ? c.stroke.width : 0
  const sc = c.stroke ? resolveColor(c.stroke.color, ctx, 'transparent') : 'transparent'
  const dash = c.stroke?.dash === 'dashed' ? `${sw * 3} ${sw * 2}` : c.stroke?.dash === 'dotted' ? `${sw} ${sw * 1.5}` : undefined
  const boxy = c.shape === 'rect' || c.shape === 'roundRect' || c.shape === 'ellipse'
  const radius = c.shape === 'ellipse' ? '50%' : c.shape === 'roundRect' ? (c.radius ?? Math.min(w, h) * 0.15) : 0
  // 填色那一层（纯色／渐层／幻灯片背景填充）·boxy＝圆角裁·其余＝clip-path 按外轮廓裁
  const outline = boxy ? null : shapeOutline(c)
  const clipBox = outline ? shapeOutline(c, -outline.box.x, -outline.box.y)! : null
  const clipStyle: React.CSSProperties = boxy
    ? { position: 'absolute', inset: 0, borderRadius: radius, overflow: 'hidden' }
    : clipBox
      ? { position: 'absolute', left: outline!.box.x, top: outline!.box.y, width: outline!.box.w, height: outline!.box.h, clipPath: `path(${clipBox.evenodd ? 'evenodd, ' : ''}'${clipBox.d}')`, overflow: 'hidden' }
      : { display: 'none' }
  const fillable = c.shape !== 'line' && c.shape !== 'arc'
  let fillLayer: React.ReactNode = null
  if (fillable && c.fillMode === 'pageBackground') {
    // 背景那层＝整页大小·套「页面 ⇒ 本形状局部」矩阵（组里的、转过的都对齐页面）；clip 层若有位移（对话框尾巴）先补回去
    const m = bgFillMatrix(props.chain)
    const off = clipBox ? mul([1, 0, 0, 1, -outline!.box.x, -outline!.box.y], m) : m
    // 页底是影片 ⇒ 形状里也放一支同片（放映时由执行器跟着页底那支同步时间·缩图只画封面）
    const v = props.bg?.videoUrl && props.mode !== 'thumb' ? (props.mediaUrl ? props.mediaUrl(props.bg.videoUrl) : props.bg.videoUrl) : undefined
    fillLayer = (
      <div style={clipStyle}>
        <div data-sk-bgf="" style={{ position: 'absolute', left: 0, top: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transformOrigin: '0 0', transform: cssMatrix(off), ...bgPaintStyle(props.bg, ctx, props.mediaUrl) }}>
          {v ? <video data-sk-bgfv="" src={v} muted playsInline preload="auto" {...(props.mode === 'editor' ? { autoPlay: true, loop: !!props.bg?.loop } : {})}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: props.bg?.fit === 'contain' ? 'contain' : 'cover', display: 'block', pointerEvents: 'none' }} /> : null}
        </div>
      </div>
    )
  } else if (fillable && c.fillMode === 'gradient' && c.gradient && c.gradient.stops.length >= 2) {
    const stops = c.gradient.stops.map((s) => `${resolveColor(s.color, ctx, 'transparent')} ${s.pos}%`).join(', ')
    fillLayer = <div style={{ ...clipStyle, background: `linear-gradient(${(c.gradient.angle + 90) % 360}deg, ${stops})` }} />
  } else if (fillable && c.fill) {
    fillLayer = <div style={{ ...clipStyle, background: fill }} />
  }
  let strokeLayer: React.ReactNode = null
  if (boxy) {
    if (sw) strokeLayer = <div style={{ position: 'absolute', inset: 0, boxSizing: 'border-box', border: strokeCss(c.stroke, ctx), borderRadius: radius }} />
  } else if (c.shape === 'line') {
    const y = h / 2
    const head = (x: number, dir: 1 | -1) => {
      const L = Math.max(8, sw * 4), Wd = Math.max(5, sw * 2.5)
      return `${x},${y} ${x - dir * L},${y - Wd} ${x - dir * L},${y + Wd}`
    }
    const inset = (end?: string) => (end === 'arrow' ? Math.max(8, sw * 4) * 0.8 : 0)
    strokeLayer = (
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <line x1={inset(c.lineEnds?.start)} y1={y} x2={w - inset(c.lineEnds?.end)} y2={y} stroke={sc} strokeWidth={sw || 1} strokeDasharray={dash} />
        {c.lineEnds?.start === 'arrow' ? <polygon points={head(0, -1)} fill={sc} /> : null}
        {c.lineEnds?.end === 'arrow' ? <polygon points={head(w, 1)} fill={sc} /> : null}
      </svg>
    )
  } else if (c.shape === 'arc') {
    const s = arcSweep(c.arc, { start: 0, end: 270 })!
    const rx = w / 2, ry = h / 2
    const at = (deg: number) => { const r = (deg * Math.PI) / 180; return [rx + rx * Math.cos(r), ry + ry * Math.sin(r)] as const }
    const tang = (deg: number) => { const r = (deg * Math.PI) / 180; return Math.atan2(ry * Math.cos(r), -rx * Math.sin(r)) }
    const e = s.start + Math.min(359.9, s.sweep)
    const [x0, y0] = at(s.start), [x1, y1] = at(e)
    const lw = sw || 2
    strokeLayer = (
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <path d={`M${fx(x0)},${fx(y0)} A${fx(rx)} ${fx(ry)} 0 ${s.sweep > 180 ? 1 : 0} 1 ${fx(x1)},${fx(y1)}`} fill="none" stroke={sc === 'transparent' ? ctx.palette.text : sc} strokeWidth={lw} strokeDasharray={dash} strokeLinecap="round" />
        {c.lineEnds?.start === 'arrow' ? <polygon points={arrowHead(x0, y0, tang(s.start) + Math.PI, lw)} fill={sc === 'transparent' ? ctx.palette.text : sc} /> : null}
        {c.lineEnds?.end === 'arrow' ? <polygon points={arrowHead(x1, y1, tang(e), lw)} fill={sc === 'transparent' ? ctx.palette.text : sc} /> : null}
      </svg>
    )
  } else if (outline) {
    const rx = w / 2, ry = h / 2
    const onE = (deg: number) => { const r = (deg * Math.PI) / 180; return `${fx(rx + rx * Math.cos(r))},${fx(ry + ry * Math.sin(r))}` }
    strokeLayer = (sw || c.shape === 'summingJunction') ? (
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {sw ? <path d={outline.d} fill="none" fillRule={outline.evenodd ? 'evenodd' : undefined} stroke={sc} strokeWidth={sw} strokeDasharray={dash} strokeLinejoin="round" /> : null}
        {/* 流程图「或者」：圆里一个 X（线跟边线同色同粗·没边线＝细线用字色） */}
        {c.shape === 'summingJunction' ? <path d={`M${onE(225)} L${onE(45)} M${onE(135)} L${onE(315)}`} stroke={sw ? sc : ctx.palette.text} strokeWidth={sw || 1.5} strokeDasharray={dash} /> : null}
      </svg>
    ) : null
  }
  const sh = c.shadow
  const shadowCss = sh ? (() => {
    const a = (sh.angle * Math.PI) / 180
    return `drop-shadow(${fx(sh.distance * Math.cos(a))}px ${fx(sh.distance * Math.sin(a))}px ${fx(sh.blur / 2)}px ${resolveColor(sh.color, ctx, 'rgba(0,0,0,.35)')})`
  })() : undefined
  return (
    <>
      {/* 毛玻璃：模糊形状后面的东西（⛔ 放进有 filter 的层里：那样只模糊得到自己） */}
      {fillable && c.backdropBlur ? <div style={{ ...clipStyle, backdropFilter: `blur(${c.backdropBlur}px)`, WebkitBackdropFilter: `blur(${c.backdropBlur}px)` }} /> : null}
      {shadowCss
        ? <div style={{ position: 'absolute', inset: 0, filter: shadowCss }}>{fillLayer}{strokeLayer}</div>
        : <>{fillLayer}{strokeLayer}</>}
      {c.text && c.shape !== 'line' && c.shape !== 'arc' ? <TextBodyView body={c.text} ctx={ctx} frameH={h} placeholder={props.placeholder} /> : null}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 表格                                                                */
/* ------------------------------------------------------------------ */

function TableView(props: { c: TableComponent; ctx: ResolveCtx }): React.JSX.Element {
  const { c, ctx } = props
  const st = c.style
  const border = `1px solid ${resolveColor(st.borderColor, ctx, ctx.palette.border)}`
  const rows = Array.isArray(c.cells) ? c.cells : []
  return (
    <table style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontFamily: resolveFontStack(st.font, ctx), fontSize: st.size, color: resolveColor(st.color, ctx, ctx.palette.text), lineHeight: 1.35 }}>
      <colgroup>
        {(c.colWidths ?? []).map((wd, i) => <col key={i} style={{ width: `${wd}%` }} />)}
      </colgroup>
      <tbody>
        {rows.map((row, ri) => {
          const isHead = c.header && ri === 0
          const band = !isHead && st.bandFill && (c.header ? ri - 1 : ri) % 2 === 1
          return (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  border, padding: '4px 8px', verticalAlign: 'middle', overflow: 'hidden', wordBreak: 'break-word', whiteSpace: 'pre-wrap',
                  ...(isHead ? { background: resolveColor(st.headerFill, ctx), color: resolveColor(st.headerColor, ctx), fontWeight: 700 } : {}),
                  ...(band ? { background: resolveColor(st.bandFill, ctx) } : {}),
                  ...(cell.fill ? { background: resolveColor(cell.fill, ctx) } : {}),
                }}>
                  {(cell.paragraphs ?? []).map((p, pi) => (
                    <div key={pi} style={{ textAlign: p.align === 'distribute' ? 'justify' : p.align ?? 'left' }}>
                      {(p.runs ?? []).length === 0 ? '​' : (p.runs ?? []).map((r, j) => <span key={j} style={runStyle(r, ctx)}>{r.text}</span>)}
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/* ------------------------------------------------------------------ */
/* 图表（自写 SVG：直条／横条／折线／圆饼／环形）                        */
/* ------------------------------------------------------------------ */

const FALLBACK_SERIES = ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC']

function chartColors(c: ChartComponent, ctx: ResolveCtx, n: number): string[] {
  const base = (c.colors && c.colors.length ? c.colors.map((v) => resolveColor(v, ctx, '#888')) : [ctx.palette.accent, ctx.theme.primary, ctx.theme.secondary, ...FALLBACK_SERIES])
  return Array.from({ length: Math.max(1, n) }, (_, i) => base[i % base.length])
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return ''
  return Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : String(Math.round(v * 100) / 100)
}

function ChartView(props: { c: ChartComponent; ctx: ResolveCtx }): React.JSX.Element {
  const { c, ctx } = props
  const { w, h } = c.frame
  const fontFamily = resolveFontStack(c.font ?? 'theme:body', ctx)
  const textColor = resolveColor(c.textColor ?? 'theme:muted', ctx, ctx.palette.muted)
  const fs = Math.max(9, Math.min(16, h / 24))
  const labels = Array.isArray(c.labels) ? c.labels : []
  const series = (Array.isArray(c.series) ? c.series : []).filter((s) => Array.isArray(s?.values))
  const legendH = c.legend ? fs * 2 : 0
  const pie = c.chart === 'pie' || c.chart === 'doughnut'
  const cols = chartColors(c, ctx, pie ? labels.length : series.length)
  const parts: React.ReactNode[] = []

  if (pie) {
    const vals = (series[0]?.values ?? []).map((v) => (Number.isFinite(v) && v > 0 ? v : 0))
    const sum = vals.reduce((a, b) => a + b, 0) || 1
    const cx = w / 2, cy = (h - legendH) / 2, R = Math.max(1, Math.min(w, h - legendH) / 2 - 4)
    const r0 = c.chart === 'doughnut' ? R * 0.55 : 0
    let a0 = -Math.PI / 2
    vals.forEach((v, i) => {
      const a1 = a0 + (v / sum) * Math.PI * 2
      const large = a1 - a0 > Math.PI ? 1 : 0
      const p = (r: number, a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
      const d = v >= sum - 1e-9
        ? `M ${p(R, 0)} A ${R} ${R} 0 1 1 ${p(R, Math.PI)} A ${R} ${R} 0 1 1 ${p(R, 0)} Z`
        : r0 > 0
          ? `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`
          : `M ${cx},${cy} L ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} Z`
      parts.push(<path key={`s${i}`} d={d} fill={cols[i]} stroke={ctx.palette.bg} strokeWidth={1} />)
      if (c.showValues && v > 0) {
        const am = (a0 + a1) / 2, rm = r0 > 0 ? (R + r0) / 2 : R * 0.62
        parts.push(<text key={`v${i}`} x={cx + rm * Math.cos(am)} y={cy + rm * Math.sin(am)} fontSize={fs} fill="#fff" textAnchor="middle" dominantBaseline="middle">{fmt(v)}</text>)
      }
      a0 = a1
    })
  } else {
    const all = series.flatMap((s) => s.values.filter((v) => Number.isFinite(v)))
    const max = Math.max(0, ...all), min = Math.min(0, ...all)
    const span = max - min || 1
    const padL = c.chart === 'bar' ? Math.min(w * 0.3, fs * 6) : fs * 3.2
    const padB = c.chart === 'bar' ? fs * 1.6 : fs * 2
    const x0 = padL, y0 = 4, pw = Math.max(1, w - padL - 8), ph = Math.max(1, h - legendH - padB - y0)
    const n = Math.max(1, labels.length)
    // 格线＋刻度（4 格）
    for (let t = 0; t <= 4; t++) {
      const v = min + (span * t) / 4
      if (c.chart === 'bar') {
        const x = x0 + (pw * t) / 4
        parts.push(<line key={`g${t}`} x1={x} y1={y0} x2={x} y2={y0 + ph} stroke={ctx.palette.border} strokeWidth={1} />)
        parts.push(<text key={`gt${t}`} x={x} y={y0 + ph + fs * 1.2} fontSize={fs * 0.9} fill={textColor} textAnchor="middle">{fmt(v)}</text>)
      } else {
        const y = y0 + ph - (ph * t) / 4
        parts.push(<line key={`g${t}`} x1={x0} y1={y} x2={x0 + pw} y2={y} stroke={ctx.palette.border} strokeWidth={1} />)
        parts.push(<text key={`gt${t}`} x={x0 - 6} y={y} fontSize={fs * 0.9} fill={textColor} textAnchor="end" dominantBaseline="middle">{fmt(v)}</text>)
      }
    }
    const zeroY = y0 + ph - ((0 - min) / span) * ph
    const zeroX = x0 + ((0 - min) / span) * pw
    labels.forEach((lb, i) => {
      if (c.chart === 'bar') {
        const band = ph / n
        parts.push(<text key={`l${i}`} x={x0 - 6} y={y0 + band * (i + 0.5)} fontSize={fs * 0.9} fill={textColor} textAnchor="end" dominantBaseline="middle">{lb}</text>)
      } else {
        const band = pw / n
        parts.push(<text key={`l${i}`} x={x0 + band * (i + 0.5)} y={y0 + ph + fs * 1.3} fontSize={fs * 0.9} fill={textColor} textAnchor="middle">{lb}</text>)
      }
    })
    if (c.chart === 'line') {
      series.forEach((s, si) => {
        const band = pw / n
        const pts = s.values.slice(0, n).map((v, i) => [x0 + band * (i + 0.5), y0 + ph - (((Number.isFinite(v) ? v : 0) - min) / span) * ph] as const)
        parts.push(<polyline key={`p${si}`} points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={cols[si]} strokeWidth={2.5} strokeLinejoin="round" />)
        pts.forEach((p, i) => {
          parts.push(<circle key={`d${si}-${i}`} cx={p[0]} cy={p[1]} r={3.5} fill={cols[si]} />)
          if (c.showValues) parts.push(<text key={`v${si}-${i}`} x={p[0]} y={p[1] - 8} fontSize={fs * 0.85} fill={textColor} textAnchor="middle">{fmt(s.values[i])}</text>)
        })
      })
    } else {
      const k = Math.max(1, series.length)
      series.forEach((s, si) => {
        s.values.slice(0, n).forEach((raw, i) => {
          const v = Number.isFinite(raw) ? raw : 0
          if (c.chart === 'bar') {
            const band = ph / n, bh = (band * 0.7) / k, by = y0 + band * i + band * 0.15 + bh * si
            const xv = x0 + ((v - min) / span) * pw
            parts.push(<rect key={`b${si}-${i}`} x={Math.min(zeroX, xv)} y={by} width={Math.abs(xv - zeroX)} height={bh} fill={cols[si]} />)
            if (c.showValues) parts.push(<text key={`v${si}-${i}`} x={Math.max(zeroX, xv) + 4} y={by + bh / 2} fontSize={fs * 0.85} fill={textColor} dominantBaseline="middle">{fmt(raw)}</text>)
          } else {
            const band = pw / n, bw = (band * 0.7) / k, bx = x0 + band * i + band * 0.15 + bw * si
            const yv = y0 + ph - ((v - min) / span) * ph
            parts.push(<rect key={`b${si}-${i}`} x={bx} y={Math.min(zeroY, yv)} width={bw} height={Math.abs(zeroY - yv)} fill={cols[si]} />)
            if (c.showValues) parts.push(<text key={`v${si}-${i}`} x={bx + bw / 2} y={Math.min(zeroY, yv) - 4} fontSize={fs * 0.85} fill={textColor} textAnchor="middle">{fmt(raw)}</text>)
          }
        })
      })
    }
  }
  if (c.legend) {
    const names = pie ? labels : series.map((s) => s.name)
    const itemW = w / Math.max(1, names.length)
    names.forEach((nm, i) => {
      const x = itemW * i + 6, y = h - legendH / 2
      parts.push(<rect key={`lg${i}`} x={x} y={y - fs * 0.4} width={fs * 0.8} height={fs * 0.8} fill={cols[i]} />)
      parts.push(<text key={`lgt${i}`} x={x + fs * 1.1} y={y} fontSize={fs * 0.9} fill={textColor} dominantBaseline="middle">{nm}</text>)
    })
  }
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0, overflow: 'visible', fontFamily }}>
      {parts}
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* html（旧页包装）                                                    */
/* ------------------------------------------------------------------ */

/** 隔离 iframe 的文件（基础重置＝与 deck-html 同一套·字体跟主题正文） */
export function htmlComponentDoc(c: HtmlComponent, theme: Theme): string {
  const dw = c.designW ?? CANVAS_WIDTH, dh = c.designH ?? CANVAS_HEIGHT
  // 手动排版层（htmlOverride）里可能带着旧存稿的程序框（allow-scripts·没守卫）⇒ 进沙盒框前一律补成静态＋守卫
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}html,body{width:${dw}px;height:${dh}px;overflow:hidden;background:transparent}body{font-family:${themeFontStack(theme.fontPair.body)}}</style>${c.head ?? ''}</head><body>${hardenProgramFramesHtml(c.html)}</body></html>`
}

function HtmlView(props: { c: HtmlComponent; theme: Theme; mode: ComponentRenderMode }): React.JSX.Element {
  const { c, theme, mode } = props
  const dw = c.designW ?? CANVAS_WIDTH, dh = c.designH ?? CANVAS_HEIGHT
  const scale: React.CSSProperties = { position: 'absolute', left: 0, top: 0, width: dw, height: dh, transform: `scale(${c.frame.w / dw}, ${c.frame.h / dh})`, transformOrigin: '0 0' }
  if (mode === 'deck' && !c.head) {
    // 放映产物：整份 deck 本来就在 sandbox 的 iframe 里渲（与手动排版层 htmlOverride 同一信任口径）
    return <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}><div style={scale} dangerouslySetInnerHTML={{ __html: c.html }} /></div>
  }
  // 编辑器画布／缩略／带旧 head 的：一律进沙盒 iframe（opaque origin·读不到父页 cookie 与 DOM）
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <iframe title="html" sandbox="allow-scripts" srcDoc={htmlComponentDoc(c, theme)} scrolling="no" tabIndex={-1}
        style={{ ...scale, border: 0, pointerEvents: mode === 'deck' ? 'auto' : 'none', background: 'transparent' }} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* program（程序动画）                                             */
/* ------------------------------------------------------------------ */

/**
 * 程序组件：一律进 sandbox 的 iframe（放映产物也是·⛔ 内联）·按设计尺寸等比缩进框里。
 * iframe 上带放映执行器（steps.ts）要的属性：data-sk-prog（组件编号）／data-sk-steps（声明步数）／data-sk-explicit（页动画表里的显式步数）／data-sk-cues（书签解到的动画）。
 * 放映时可点（程序自己的互动）；编辑器／缩略不吃鼠标（拖框归画布）。
 * 跑不跑作者码（run）：
 *   'live'  ＝sandbox="allow-scripts"（编辑画布当下那页）；
 *   'lazy'  ＝放映产物：先 sandbox=""（静态）＋data-sk-lazy·进到这页才由 steps.ts 换成 allow-scripts 重载、离页换回静态；
 *   'static'＝sandbox=""（缩图、版式预览、动画预览、转场预览）：只画作者 html／css·脚本不跑；
 *   'off'   ＝超过一页上限（programsPerPage·含组合里的）：不建 iframe·只画占位框。
 */
type ProgramRun = 'live' | 'lazy' | 'static' | 'off'

/**
 * （自身导航）：网站页面里直接画的程序 iframe（编辑画布、缩图、各种预览）怎么认「它把自己导走了」：
 *   一个 iframe 元素只载一次文件（srcdoc 或 sandbox 变了就换新元素·见 ProgramView 的 key）⇒ 同一个元素第二次 load＝自己导航。
 *   回 true＝这次是自己导航（呼叫方当场换回静态＋记一笔）。放映产物（整份 deck 在外层沙盒里）走 PROGRAM_FRAME_WATCH_SCRIPT。
 */
export function programFrameNavigated(el: { __skLoaded?: boolean } | null | undefined): boolean {
  if (!el) return false
  if (!el.__skLoaded) { el.__skLoaded = true; return false }
  return true
}

/**
 * （载完前就导走）：编辑画布的程序框也要「载完回暗号」（见 program-sandbox.ts PROGRAM_ALIVE_*）——
 *   作者在 srcdoc 载完之前就导走 ⇒ 这个元素唯一一次 load 是导过去那页的，「第二次 load」认不出。
 *   状态记在模块里（键＝组件编号:文件签）：元素卸载再挂回（翻页回来）也认得——
 *     'wait'＝载完了还没等到暗号（判定没出来·这段时间新挂的元素先画静态）；'blocked'＝导走过 ⇒ 这次开页里留在静态（作者改了程序＝签变了才重新放行）。
 */
// 计时闸：另加 'hang'（守卫判连续占用太久）／'guard'（守卫没装上、2 秒内没 guard_ready）／'stuck'（B 层 3 秒没心跳）——都留静态＋一句原因
type ProgramViewSt = 'wait' | 'blocked' | ProgramStopWhy
const PROGRAM_VIEW_STATE = new Map<string, ProgramViewSt>()
/** 'wait' 在等哪一个暗号（状态键 ⇒ 暗号）：正在等判定的那个元素重画时照旧 live（见 programViewIsLive） */
const PROGRAM_VIEW_WAIT = new Map<string, string>()
/** 守卫回的 guard_ready{g}（g＝暗号）⇒ 发信的框 */
const PROGRAM_VIEW_READY = new Map<string, Set<unknown>>()
/** 现在放成 allow-scripts 的框：暗号 ⇒ { 状态键, 元素 }（hang／guard_failed 只认这框当前世代；B 层也从这里取要盯的框） */
const PROGRAM_VIEW_LIVE = new Map<string, { stKey: string; el: HTMLIFrameElement }>()
/** 收到的暗号 ⇒ 发信的那个框（e.source）·认的时候核是不是载入那一刻那个框（不只看暗号形状） */
// ②：同一暗号可能有好几个来源回（真框＋持同暗号的错框）⇒ 全记下来（⛔ 后到的盖掉先到的）；认时只看载入那刻的框在不在里面
const PROGRAM_VIEW_ALIVE = new Map<string, Set<unknown>>()
function addProgramViewAlive(k: string, src: unknown) { let s = PROGRAM_VIEW_ALIVE.get(k); if (!s) { s = new Set(); PROGRAM_VIEW_ALIVE.set(k, s) } s.add(src) }
const PROGRAM_VIEW_SUBS = new Set<() => void>()
let programViewListening = false
function programViewNotify() { for (const f of Array.from(PROGRAM_VIEW_SUBS)) f() }
function programViewListen() {
  if (programViewListening || typeof window === 'undefined') return
  programViewListening = true
  window.addEventListener('message', (e: MessageEvent) => {
    programViewOnMessage(e.data, e.source)
    programEditorWatch?.onMessage(e.source, e.data)
  })
}
/** 收信判读（导出给单测）：alive{k}／guard_ready{g} 记来源；hang／guard_failed{g} 只认当前世代那框（e.source＝它的 contentWindow）⇒ 留静态＋原因 */
export function programViewOnMessage(data: unknown, source: unknown): void {
  const d = data as { __dlp?: unknown; type?: unknown; k?: unknown; g?: unknown } | null
  if (!d || d.__dlp !== 1) return
  if (d.type === 'alive' && typeof d.k === 'string') { addProgramViewAlive(d.k, source); return }
  if (typeof d.g !== 'string') return
  if (d.type === 'guard_ready') { let s = PROGRAM_VIEW_READY.get(d.g); if (!s) { s = new Set(); PROGRAM_VIEW_READY.set(d.g, s) } s.add(source); return }
  if (d.type === 'hang' || d.type === 'guard_failed') {
    const x = PROGRAM_VIEW_LIVE.get(d.g)
    if (!x || x.el.contentWindow !== source) return
    const st = PROGRAM_VIEW_STATE.get(x.stKey)
    if (st && st !== 'wait') return
    programViewStop(x.stKey, d.type === 'hang' ? 'hang' : 'guard')
  }
}
function programViewStop(stKey: string, why: ProgramStopWhy) {
  PROGRAM_VIEW_STATE.set(stKey, why)
  try { console.warn(`[dilinai] program animation "${stKey.split(':')[0]}" stopped (${why}); switched to static`) } catch { /* */ }
  programViewNotify()
}

/**
 * 计时闸 B 层·编辑画布（顶层＝网站页面·程序框是它的直系子框）：盯 PROGRAM_VIEW_LIVE 里的框；3 秒没心跳 ⇒ 'stuck'（换新元素＝原框被拿掉·留静态）。
 * 盯的框组变了（翻页、换文件）＝新世代。只在 Chrome／Edge 桌面 127 起启；没有 live 框就停表。
 */
let programEditorWatch: ProgramWatchdog | null = null
let programEditorWatchTimer: ReturnType<typeof setInterval> | null = null
function programEditorWatchSync() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !programWatchdogSupported(navigator.userAgent)) return
  if (PROGRAM_VIEW_LIVE.size && !programEditorWatch) {
    programEditorWatch = new ProgramWatchdog({
      targets: () => [...PROGRAM_VIEW_LIVE.values()].filter((x) => x.el.isConnected && x.el.contentWindow).map((x) => ({ id: x.stKey, win: x.el.contentWindow })),
      now: () => performance.now(),
      rand: programWatchNonce,
      post: (w, m) => { (w as Window).postMessage(m, '*') },
      onStuck: (ids) => { for (const id of ids) programViewStop(id, 'stuck'); programEditorWatch?.revive() },
    })
    programEditorWatchTimer = setInterval(() => programEditorWatch?.tick(), PROGRAM_WATCH_PING_MS)
    const vis = () => programEditorWatch?.lifecycle(document.visibilityState === 'visible' ? 'show' : 'hide')
    document.addEventListener('visibilitychange', vis)
  } else if (!PROGRAM_VIEW_LIVE.size && programEditorWatch) {
    if (programEditorWatchTimer) clearInterval(programEditorWatchTimer)
    programEditorWatch = null; programEditorWatchTimer = null
  }
}
/** 一次 load 之后的判定（导出给单测）：navigated＝同一元素第二次 load；不然 live 那次等暗号——等不到＝载完前就导走 */
export function programViewOnLoad(o: { el: { __skLoaded?: boolean }; key: string; live: boolean; k: string | null; warn: () => void; wait?: (f: () => void, ms: number) => void }): void {
  const block = () => { PROGRAM_VIEW_STATE.set(o.key, 'blocked'); o.warn(); programViewNotify() }
  if (programFrameNavigated(o.el)) { block(); return }
  const k = o.k
  if (!o.live || !k) return
  // 载入这一刻的框（之后等判定时元素会被换掉·⛔ 到时再取）
  const w = (o.el as { contentWindow?: unknown }).contentWindow
  // 计时闸：两样都要到——前置脚本的暗号（载完·没导走）＋守卫的 guard_ready（守卫装上了）
  const has = (m: Map<string, Set<unknown>>) => !!m.get(k)?.has(w)
  const take = () => { if (!has(PROGRAM_VIEW_ALIVE) || !has(PROGRAM_VIEW_READY)) return false; PROGRAM_VIEW_ALIVE.delete(k); PROGRAM_VIEW_READY.delete(k); return true }
  // 暗号只认这一个元素这一次载入——用过就从集合拿掉（⛔ 留着让后来的元素沿用旧暗号过关）
  if (take()) return
  PROGRAM_VIEW_STATE.set(o.key, 'wait')
  PROGRAM_VIEW_WAIT.set(o.key, k)
  ;(o.wait ?? ((f, ms) => { setTimeout(f, ms) }))(() => {
    // 只判自己这一次（同一状态键上一轮的计时不碰这一轮）
    if (PROGRAM_VIEW_STATE.get(o.key) !== 'wait' || PROGRAM_VIEW_WAIT.get(o.key) !== k) return
    PROGRAM_VIEW_WAIT.delete(o.key)
    if (take()) { PROGRAM_VIEW_STATE.delete(o.key); programViewNotify() }
    else if (has(PROGRAM_VIEW_ALIVE)) { PROGRAM_VIEW_ALIVE.delete(k); programViewStop(o.key, 'guard') }
    else block()
  }, PROGRAM_ALIVE_WAIT_MS)
}
/**
 * 这一框此刻放不放成 allow-scripts（导出给单测·ProgramViewLive 只认这里）。
 * Chrome 里回暗号常在宿主那次 load 之后几毫秒才到 ⇒ 每次都进 'wait'；
 *   旧写法「st 有值就不 live」⇒ 等判定那 2 秒里画布随便重画一次（约 0.7 秒就会有一次）就把正在核的那框换成静态新元素，
 *   2 秒到点暗号其实到了 ⇒ 放回 live 又换新元素新暗号 ⇒ 又进 'wait'……画布上的正常程序每 2 秒重启一次、约六成时间是静态；
 *   慢机上暗号赶不及在旧框被拿掉前送到 ⇒ 到点判成「载完前就导走」＝正常程序被误封（console 记 navigated itself away）。
 * ⇒ 'wait' 只挡新挂的元素（翻页回来、换了暗号）；正在等判定的那个元素（这一实例手上的暗号＝等的那个）重画照旧 live、key 不变。
 *   ⛔ 改回「st === undefined 才 live」。
 */
export function programViewIsLive(o: { run: ProgramRun; ok: boolean; vst: 'ok' | 'bad' | undefined; st: ProgramViewSt | undefined; waitK: string | null; probeK: string | null }): boolean {
  if (o.run !== 'live' || !o.ok || o.vst !== 'ok') return false
  if (o.st === undefined) return true
  return o.st === 'wait' && !!o.probeK && o.waitK === o.probeK
}
/** 单测用：模块状态 */
export const programViewInternals = { state: PROGRAM_VIEW_STATE, alive: PROGRAM_VIEW_ALIVE, ready: PROGRAM_VIEW_READY, live: PROGRAM_VIEW_LIVE, wait: PROGRAM_VIEW_WAIT, addAlive: addProgramViewAlive }

type ProgramViewProps = { c: ProgramComponent; ctx: ResolveCtx; mode: ComponentRenderMode; plan?: ProgramStepPlan; run: ProgramRun; lang?: ProgramLang }

/** 计时闸：静态那份文件的占位世代（放成 allow-scripts 时一律换成一次性暗号·见 rearm／injectProgramAliveProbe） */
export const PROGRAM_STATIC_GEN = '0000000000000000'

type ProgramLang = ProgramNoticeLang

/**
 * 计时闸：这一框能不能跑（纯函数·服务端渲染同一口径）——只认 compiled.v 现行且 compiled.key＝按 共用规范编码当场算出的 key；
 *   原文型别不对（算不出 key）／没有 compiled／key 对不上（乐观套用后服务端还没回）／组装参数不合 ⇒ 不能跑（静态＋一句原因）。⛔ 退回跑原文。
 */
export type ProgramRunnable =
  | { ok: true; compiled: CompiledProgram; props: ProgramFrameProps; doc: string }
  | { ok: false; why: ProgramNotStarted; detail?: string }
export function programRunnable(c: ProgramComponent, theme: Theme, bg: string): ProgramRunnable {
  const cp = c.compiled
  if (!cp || typeof cp !== 'object' || cp.v !== PROGRAM_COMPILED_V) {
    return typeof c.compileError === 'string' && c.compileError ? { ok: false, why: 'error', detail: c.compileError } : { ok: false, why: 'uncompiled' }
  }
  const key = tryProgramSourceKey({ html: c.html, css: c.css, steps: c.steps })
  if (!key || cp.key !== key) return { ok: false, why: 'pending' }
  const { w, h } = programDesignSize(c)
  const props: ProgramFrameProps = { w, h, bg, font: themeFontStack(theme.fontPair.body), steps: c.steps ?? 0 }
  try { return { ok: true, compiled: cp, props, doc: assembleProgramDoc(cp, props, PROGRAM_STATIC_GEN) } }
  catch { return { ok: false, why: 'frame' } }
}

/** 框的尺寸与文件（两支共用·无 hook）：能跑＝组装文件；不能跑＝旧式静态文件（只给 sandbox="" 用） */
function programFrameParts(c: ProgramComponent, ctx: ResolveCtx) {
  const { w: dw, h: dh } = programDesignSize(c)
  const bg = c.transparent === false ? resolveColor((c.bgColor ?? 'theme:bg') as ColorValue, ctx, ctx.palette.bg) : 'transparent'
  // 等比缩进、置中（与导出 pptx 的 programLayout 同一算法·框比例跟设计尺寸不同时不拉扁）
  const s = Math.min(c.frame.w / dw, c.frame.h / dh)
  const scale: React.CSSProperties = { position: 'absolute', left: (c.frame.w - dw * s) / 2, top: (c.frame.h - dh * s) / 2, width: dw, height: dh, transform: `scale(${s})`, transformOrigin: '0 0' }
  const r = programRunnable(c, ctx.theme, bg)
  return { scale, r, doc: r.ok ? r.doc : programComponentDoc(c, ctx.theme, bg) }
}

/** 不能跑的那框盖一句原因（只在本该跑的地方：编辑画布当下那页、放映；缩图／预览不盖） */
function ProgramNotice(props: { why: ProgramNotStarted; detail?: string; lang?: ProgramLang }): React.JSX.Element {
  return (
    <div data-sk-prog-notice={props.why} style={{ position: 'absolute', left: 6, bottom: 6, maxWidth: 'calc(100% - 12px)', padding: '3px 8px', borderRadius: 6, background: 'rgba(15,23,42,0.78)', color: '#F8FAFC', font: '500 12px/1.4 system-ui,sans-serif', pointerEvents: 'none', whiteSpace: 'normal' }}>
      {programNoticeText(props.why, props.lang, props.detail)}
    </div>
  )
}

/** 客户端读回核（program-verify·会带 parse5 ⇒ 动态载入·不进首包）：每份 compiled 物件×外观签记一次结果 */
const PROGRAM_VERIFIED = new WeakMap<CompiledProgram, Map<string, 'ok' | 'bad'>>()
function programVerifiedState(r: Extract<ProgramRunnable, { ok: true }>): 'ok' | 'bad' | undefined {
  return PROGRAM_VERIFIED.get(r.compiled)?.get(JSON.stringify(r.props))
}
function programVerifyStart(r: Extract<ProgramRunnable, { ok: true }>): void {
  let m = PROGRAM_VERIFIED.get(r.compiled)
  if (!m) { m = new Map(); PROGRAM_VERIFIED.set(r.compiled, m) }
  const sig = JSON.stringify(r.props)
  if (m.has(sig) || PROGRAM_VERIFYING.has(r.doc)) return
  PROGRAM_VERIFYING.add(r.doc)
  const done = (v: 'ok' | 'bad') => { m!.set(sig, v); PROGRAM_VERIFYING.delete(r.doc); programViewNotify() }
  import('./program-verify').then((mod) => done(mod.verifyProgramDoc(r.doc, r.compiled, r.props).ok ? 'ok' : 'bad'), () => done('bad'))
}
const PROGRAM_VERIFYING = new Set<string>()
/** 单测用：直接记一笔核验结果 */
export function programVerifiedForTest(compiled: CompiledProgram, props: ProgramFrameProps, v: 'ok' | 'bad') {
  let m = PROGRAM_VERIFIED.get(compiled)
  if (!m) { m = new Map(); PROGRAM_VERIFIED.set(compiled, m) }
  m.set(JSON.stringify(props), v)
}

/**
 * 🔴 热修：本组件在服务端也渲（buildDeckHtml·API 路由里 React 是 react-server 版——没有 useState／useReducer／useEffect／useRef，
 *   调了就抛 ⇒ 带程序的简报存档／加组件全 500）。⇒ 这一层⛔ 用任何 hook：只有编辑画布真跑（live·只在浏览器）才进有状态的 ProgramViewLive；
 *   放映产物（lazy·执行器＋盯 load 脚本管导航）、缩图／预览（static·sandbox="" 跑不了作者码、也导不走）走无 hook 那支。
 */
function ProgramView(props: ProgramViewProps): React.JSX.Element {
  const { c, ctx, mode, plan, run } = props
  if (run === 'off') {
    return <div data-sk-prog-off={c.id} style={{ position: 'absolute', inset: 0, boxSizing: 'border-box', border: '2px dashed rgba(100,116,139,0.6)', background: 'rgba(148,163,184,0.12)' }} />
  }
  if (run === 'live') return <ProgramViewLive {...props} />
  const { scale, doc, r } = programFrameParts(c, ctx)
  // 计时闸：放映产物只有能跑的框带 data-sk-lazy（执行器只会把带它的放成 allow-scripts）；不能跑的留静态＋一句原因
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <iframe key={`${shortHash(doc)}:${run}`}
        title="program" sandbox={PROGRAM_SANDBOX_STATIC} srcDoc={doc} scrolling="no" tabIndex={-1}
        {...(run === 'lazy' && r.ok ? { 'data-sk-lazy': '' } : {})}
        {...(!r.ok ? { 'data-sk-prog-static': r.why } : {})}
        data-sk-prog={c.id} data-sk-steps={String(c.steps ?? 0)} data-sk-explicit={String(plan?.explicit ?? 0)}
        {...(plan && plan.cues.length ? { 'data-sk-cues': JSON.stringify(plan.cues) } : {})}
        style={{ ...scale, border: 0, pointerEvents: mode === 'deck' ? 'auto' : 'none', background: 'transparent', colorScheme: 'light' }} />
      {!r.ok && run === 'lazy' ? <ProgramNotice why={r.why} detail={r.detail} lang={props.lang} /> : null}
    </div>
  )
}

/** 编辑画布真跑的那框（只在浏览器·有 hook）：载完回暗号、第二次 load＝导走 ⇒ 换回静态 */
function ProgramViewLive(props: ProgramViewProps): React.JSX.Element {
  const { c, ctx, mode, plan, run } = props
  const [, bump] = React.useReducer((x: number) => x + 1, 0)
  React.useEffect(() => { programViewListen(); PROGRAM_VIEW_SUBS.add(bump); return () => { PROGRAM_VIEW_SUBS.delete(bump) } }, [])
  const probe = React.useRef<{ sig: string; k: string } | null>(null)
  const { scale, doc, r } = programFrameParts(c, ctx)
  // 计时闸：能跑（compiled 对得上原文）且客户端读回核过才放成 allow-scripts；核验模组还没到＝先静态
  const vst = r.ok ? programVerifiedState(r) : undefined
  React.useEffect(() => { if (r.ok && vst === undefined) programVerifyStart(r) })
  const sig = `${shortHash(doc)}:${run}`
  const stKey = `${c.id}:${sig}`
  const st = PROGRAM_VIEW_STATE.get(stKey)
  const stopped = st === 'hang' || st === 'guard' || st === 'stuck' ? st : null
  const why: ProgramNotStarted | null = !r.ok ? r.why : vst === 'bad' ? 'unverified' : stopped
  // 等判定（'wait'）的正是手上这个暗号的元素 ⇒ 照旧 live、key 不变（⛔ 换成静态元素·见 programViewIsLive）
  const live = programViewIsLive({ run, ok: r.ok, vst, st, waitK: PROGRAM_VIEW_WAIT.get(stKey) ?? null, probeK: probe.current && probe.current.sig === sig ? probe.current.k : null })
  // 放成 allow-scripts 的元素带一次性暗号（换元素＝换暗号）。
  // 一离开 live（导走／判停／翻页回来新挂的元素等判定）就把暗号作废——重新放回 live 一定换新元素＋新暗号（⛔ 沿用上一世代的暗号）
  if (!live) probe.current = null
  else if (!probe.current || probe.current.sig !== sig) probe.current = { sig, k: programAliveNonce() }
  const k = live ? probe.current!.k : null
  const key = `${sig}:${live ? 'ok' : st ?? 'ok'}:${vst ?? '-'}:${k ?? '-'}`
  // 计时闸：放成 allow-scripts 的这个元素登记到暗号下（hang／guard_failed 认它·B 层盯它）；元素卸下就拿掉（回调随暗号定·⛔ 每次重画都换）
  const liveRef = React.useCallback((el: HTMLIFrameElement | null) => {
    if (!k) return
    if (el) PROGRAM_VIEW_LIVE.set(k, { stKey, el })
    else if (PROGRAM_VIEW_LIVE.get(k)?.stKey === stKey) PROGRAM_VIEW_LIVE.delete(k)
    programEditorWatchSync()
  }, [k, stKey])
  const onLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    programViewOnLoad({
      el: e.currentTarget as unknown as { __skLoaded?: boolean }, key: stKey, live, k,
      warn: () => { try { console.warn(`[dilinai] program animation "${c.id}" navigated itself away; switched back to static`) } catch { /* */ } },
    })
  }
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <iframe key={key} onLoad={onLoad} ref={liveRef}
        title="program" sandbox={live ? PROGRAM_SANDBOX_RUN : PROGRAM_SANDBOX_STATIC} srcDoc={k ? injectProgramAliveProbe(doc, k) : doc} scrolling="no" tabIndex={-1}
        {...(why ? { 'data-sk-prog-static': why } : {})}
        data-sk-prog={c.id} data-sk-steps={String(c.steps ?? 0)} data-sk-explicit={String(plan?.explicit ?? 0)}
        {...(plan && plan.cues.length ? { 'data-sk-cues': JSON.stringify(plan.cues) } : {})}
        style={{ ...scale, border: 0, pointerEvents: mode === 'deck' ? 'auto' : 'none', background: 'transparent', colorScheme: 'light' }} />
      {why ? <ProgramNotice why={why} detail={!r.ok ? r.detail : undefined} lang={props.lang} /> : null}
    </div>
  )
}

/** 影片／程序步骤的隐形记号（放映执行器盯着它亮不亮·契约见 steps.ts 头注） */
function StepMarkers(props: { markers: readonly StepMarker[] }): React.JSX.Element | null {
  if (!props.markers.length) return null
  return (
    <div data-sk-steps="" hidden style={{ display: 'none' }}>
      {props.markers.map((m) => (
        <i key={m.animId} data-sk-act={m.kind} data-sk-target={m.componentId} data-sk-anim={m.animId}
          {...(m.step !== undefined ? { 'data-step': String(m.step) } : {})}
          {...(m.auto ? { 'data-sk-auto': '' } : {})}
          {...(m.cue ? { 'data-sk-cue': '' } : {})}
          data-sk-delay={String(Math.round(m.delayMs))}
          {...(m.index !== undefined ? { 'data-sk-idx': String(m.index) } : {})}
          {...(m.effect ? { 'data-sk-effect': m.effect } : {})}
          {...(typeof m.seekSec === 'number' ? { 'data-sk-seek': String(m.seekSec) } : {})} />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 一个组件 · 一页                                                      */
/* ------------------------------------------------------------------ */

function ComponentContent(props: { c: SlideComponent; ctx: ResolveCtx; mode: ComponentRenderMode; placeholder?: string; mediaUrl?: (s: string) => string; chain: readonly Frame[]; bg?: PageBackground; progPlan?: ProgramStepPlan; progRun?: ProgramRun; lang?: ProgramLang }): React.JSX.Element | null {
  const { c, ctx, mode } = props
  switch (c.type) {
    case 'text': return <TextBodyView body={c} ctx={ctx} frameH={c.frame.h} placeholder={props.placeholder} />
    case 'image': return <ImageView c={c} ctx={ctx} mediaUrl={props.mediaUrl} />
    case 'video': return <VideoView c={c} ctx={ctx} mode={mode} mediaUrl={props.mediaUrl} />
    case 'shape': return <ShapeView c={c} ctx={ctx} placeholder={props.placeholder} chain={props.chain} bg={props.bg} mediaUrl={props.mediaUrl} mode={mode} />
    case 'table': return <TableView c={c} ctx={ctx} />
    case 'chart': return <ChartView c={c} ctx={ctx} />
    case 'html': return <HtmlView c={c} theme={ctx.theme} mode={mode} />
    case 'program': return <ProgramView c={c} ctx={ctx} mode={mode} plan={props.progPlan} run={props.progRun ?? 'static'} lang={props.lang} />
    default: return null
  }
}

/** 组件外框的定位样式（画布与编辑器叠加层共用同一套算法） */
export function frameStyle(c: SlideComponent): React.CSSProperties {
  const f = c.frame
  return {
    position: 'absolute', left: f.x, top: f.y, width: f.w, height: f.h,
    ...(f.rotate ? { transform: `rotate(${f.rotate}deg)` } : {}),
    ...(typeof c.opacity === 'number' && c.opacity < 1 ? { opacity: Math.max(0, c.opacity) } : {}),
  }
}

/** 短指纹（FNV-1a 32·base36）：平滑切换判「两页这件内容一不一样」用 */
export function shortHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(36)
}

const SIG_SKIP = new Set(['id', 'name', 'role', 'roleIndex', 'frame', 'opacity', 'locked', 'hidden', 'morphKey', 'children'])
/** 内容指纹（框／名字／透明度不算）·幻灯片背景填充的形状连页底一起算（换了底图＝内容变了＝要交叉淡化） */
export function contentSig(c: SlideComponent, bg?: PageBackground): string {
  const o: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(c)) if (!SIG_SKIP.has(k)) o[k] = v
  if (c.type === 'shape' && c.fillMode === 'pageBackground') o.__bg = bg ?? null
  return shortHash(JSON.stringify(o))
}

/** 平滑切换要的外框属性（契约见 transition.ts 头注） */
export function morphAttrs(c: SlideComponent, bg?: PageBackground): Record<string, string> {
  const f = c.frame
  const out: Record<string, string> = {
    'data-sk-f': `${f.x},${f.y},${f.w},${f.h},${f.rotate || 0}`,
    'data-sk-mk': c.morphKey ?? c.id,
    'data-sk-type': c.type,
    'data-sk-sig': contentSig(c, bg),
  }
  if (c.name && c.name.startsWith('!!')) out['data-sk-nm'] = c.name
  if (typeof c.opacity === 'number' && c.opacity < 1) out['data-sk-op'] = String(Math.max(0, c.opacity))
  if (c.type === 'text') out['data-sk-th'] = shortHash(plainTextOf(c.paragraphs))
  if (c.type === 'group') out['data-sk-grp'] = ''
  return out
}

function wrapAnims(inner: React.ReactNode, wraps: readonly AnimWrap[] | undefined): React.ReactNode {
  if (!wraps || wraps.length === 0) return inner
  let node = inner
  for (let i = wraps.length - 1; i >= 0; i--) {
    const a = wraps[i]
    node = (
      <div className={a.className} {...(a.step !== undefined ? { 'data-step': String(a.step) } : {})} {...(a.animId ? { 'data-sk-anim': a.animId } : {})}
        style={{ animationDuration: `${a.durationMs}ms`, animationDelay: `${a.delayMs}ms` }}>
        {node}
      </div>
    )
  }
  return node
}

/**
 * 页底层（[data-sk-bg]）：底色＋底图；有底片 ⇒ 叠一支静音 <video data-sk-bgv>。
 *   deck：不自己播（transition.ts 进页才开播·loop／startSec／endSec 写在 data-*）；editor：静音自动播（照 loop 设定）；thumb：只画封面（没封面＝影片第一格）。
 */
function PageBgLayer(props: { bg?: PageBackground; ctx: ResolveCtx; mode: ComponentRenderMode; mediaUrl?: (s: string) => string }): React.JSX.Element {
  const { bg, ctx, mode, mediaUrl } = props
  const v = bg?.videoUrl
  const vurl = v ? (mediaUrl ? mediaUrl(v) : v) : undefined
  const poster = bg?.poster ? (mediaUrl ? mediaUrl(bg.poster) : bg.poster) : undefined
  const vStyle: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: bg?.fit === 'contain' ? 'contain' : 'cover', display: 'block', pointerEvents: 'none' }
  let video: React.ReactNode = null
  if (vurl && mode === 'deck') {
    video = <video data-sk-bgv="" src={vurl} data-src={v} poster={poster} muted playsInline preload="auto" style={vStyle}
      {...(bg?.loop ? { 'data-loop': '' } : {})}
      {...(typeof bg?.startSec === 'number' ? { 'data-start': String(bg.startSec) } : {})}
      {...(typeof bg?.endSec === 'number' ? { 'data-end': String(bg.endSec) } : {})} />
  } else if (vurl && mode === 'editor') {
    video = <video data-sk-bgv="" src={vurl} data-src={v} poster={poster} muted playsInline autoPlay loop={!!bg?.loop} preload="auto" style={vStyle} />
  } else if (vurl && !poster) {
    const t = typeof bg?.startSec === 'number' ? `#t=${bg.startSec}` : '#t=0.1'
    video = <video src={`${vurl}${t}`} muted playsInline preload="metadata" style={vStyle} />
  }
  return <div data-sk-bg="" style={{ position: 'absolute', inset: 0, ...bgPaintStyle(bg, ctx, mediaUrl) }}>{video}</div>
}

/** 这个模式下程序动画跑不跑（见 ProgramView 头注）：deck＝lazy（放映执行器进页才跑）·editor 只有 runPrograms 才 live·其余静态 */
export function programRunFor(mode: ComponentRenderMode, runPrograms?: boolean): 'live' | 'lazy' | 'static' {
  if (mode === 'deck') return 'lazy'
  if (mode === 'editor' && runPrograms) return 'live'
  return 'static'
}

export function ComponentSlideView(props: ComponentSlideViewProps): React.JSX.Element {
  const { components, animations, background, theme, pageType, mode, placeholderFor, mediaUrl } = props
  const ctx = resolveCtx(theme, pageType)
  const visible = components.filter((c) => !c.hidden)
  const liveIds = new Set<string>()
  // 程序组件（叠层由下而上·书签在它身上）与影片组件：排影片／程序步骤用
  const programs = new Map<string, { cues?: readonly ProgramCue[] }>()
  const videos = new Set<string>()
  const progOrder: SlideComponent[] = []   // 认物件不认编号（编号重复的旧资料也照个数算）
  const note = (c: SlideComponent) => {
    liveIds.add(c.id)
    if (c.type === 'program') { programs.set(c.id, { cues: c.cues }); progOrder.push(c) }
    else if (c.type === 'video') videos.add(c.id)
  }
  for (const c of visible) { note(c); if (c.type === 'group') for (const ch of c.children) if (!ch.hidden) note(ch) }
  // 跑不跑作者码＋一页上限（programs 照叠层由下而上·含组合里的·前 programsPerPage 个才建 iframe）
  const runAs = programRunFor(mode, props.runPrograms)
  const progRun = new Map<SlideComponent, ProgramRun>()
  progOrder.forEach((c, k) => progRun.set(c, k < COMPONENT_LIMITS.programsPerPage ? runAs : 'off'))
  // 排步：放映与编辑画布都排（编辑画布只用影片／程序记号·编辑页预览按 → 走）；CSS 动画壳照旧只放映（与动画对话框预览）才套
  const plan = mode === 'deck' || mode === 'editor' ? planPageAnimations(animations, liveIds, { programs, videos }) : null
  const cssPlan = mode === 'deck' || (mode === 'editor' && props.playAnimations) ? plan : null
  // 一个组件：外框（定位＋平滑属性）＞动画壳＞内容；组合＝外框里再放子件外框（子件框是组内局部坐标·跟着组一起转）
  const item = (c: SlideComponent, chain: readonly Frame[]): React.ReactNode => {
    const here = [...chain, c.frame]
    const inner = c.type === 'group'
      ? <>{c.children.filter((ch) => !ch.hidden).map((ch) => item(ch, here))}</>
      : <ComponentContent c={c} ctx={ctx} mode={mode} placeholder={mode === 'editor' ? placeholderFor?.(c) : undefined} mediaUrl={mediaUrl} chain={here} bg={background} progPlan={plan?.programs.get(c.id)} progRun={progRun.get(c)} lang={props.lang} />
    return (
      <div key={c.id} {...morphAttrs(c, background)} data-sk-id={c.id} style={frameStyle(c)}>
        {wrapAnims(inner, cssPlan?.byComponent.get(c.id))}
      </div>
    )
  }
  const canvas = (
    <div data-sk-canvas="" style={{
      position: 'relative', width: CANVAS_WIDTH, height: CANVAS_HEIGHT, overflow: 'hidden', boxSizing: 'border-box',
      color: ctx.palette.text, fontFamily: themeFontStack(theme.fontPair.body),
    }}>
      <PageBgLayer bg={background} ctx={ctx} mode={mode} mediaUrl={mediaUrl} />
      {cssPlan?.hasClickSteps ? <i data-step="0" hidden /> : null}
      {visible.map((c) => item(c, []))}
      {plan ? <StepMarkers markers={plan.markers} /> : null}
    </div>
  )
  const width = props.width
  if (!width || width === CANVAS_WIDTH) return canvas
  const scale = width / CANVAS_WIDTH
  return (
    <div style={{ width, height: width * (CANVAS_HEIGHT / CANVAS_WIDTH), position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }}>{canvas}</div>
    </div>
  )
}

/** deck-html 要挂的动画样式（整份一次） */
export const COMPONENT_ANIMATION_CSS = animationCss()
