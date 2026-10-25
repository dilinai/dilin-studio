// 组件版简报 ⇒ .pptx「按组件直出」（pptx 与 html 导出都读组件清单）
//
//   不再量 DOM：直接读 deck_data 的组件清单，每个组件＝PowerPoint 里一个对象（objectName＝组件编号·验收按它一一配对），
//   按组件数组顺序加进投影片（＝网页的叠层）。单位：1000px＝10 英寸（1px＝0.01"＝0.72pt）。
//     文字   ⇒ addText（文字框·字可改）：片段的粗斜底线删除线、上下标、颜色、高亮、字体、字号逐段带；段落对齐／项目符号／编号／缩进；
//               框的垂直对齐、行距倍数、字距、内距、底色、边框、旋转。
//     形状   ⇒ addShape（rect／roundRect／ellipse／triangle／diamond／rightArrow／line）；形状里的字＝同一个对象上 addText({shape})·字可改。
//     图片   ⇒ addImage：裁切、圆角、翻转、透明度、边框先在 canvas 里烤好（与整页量测导出同一套取图：lib/aislides-pptx fetchExportBitmap）；空图＝主题占位块。
//     表格   ⇒ addTable（字可改）：列宽照百分比；标题列与颜色带过去（PowerPoint 表格不能转 ⇒ 旋转丢掉·记进报告）。
//     图表   ⇒ addChart：原生图表（数据在 PowerPoint 里可改）；旋转丢掉·记进报告。
//     影片   ⇒ 起真嵌进 pptx（PowerPoint 里能播·封面＝封面图或第一格·cover 用裁切、contain 缩框）；
//               超过大小上限／取不到／WebM 等格式 ⇒ 退回旧做法：封面图（没封面＝▶ 占位块）＋超链接（原因记进报告）。
//     html   ⇒（旧整页／手动排版层）回退到整页量测那条路（lib/aislides-pptx measureDocOntoSlide）放进组件的框里。
//   动画：页动画表 ⇒ PowerPoint 原生动画（进场／强调／退场·单击／同时／之后·时长延迟方向）；
//         影片步骤 ⇒ 媒体命令（playFrom／togglePause）；排法与 XML 见 aislides-pptx-timing.ts·出档后由 aislides-pptx-xml finishPptxZip 补进去。
//   组合 ⇒ 拆平（子件按组的旋转／位置换成页面坐标逐个放·⛔ grpSp：pptxgenjs 不会写组合）；
//         新形状 ⇒ 原生预设（donut／blockArc／arc／wedgeRoundRectCallout／flowChartSummingJunction·调整值出档后补 XML）；
//         幻灯片背景填充＝原生 useBgFill；渐层＝原生 gradFill；阴影＝原生外阴影；毛玻璃 ⇒ 没有对应·只留半透明填色（记进报告）；
//         页底影片 ⇒ 封面图（没封面＝底图／底色·记进报告）；换页切换 ⇒ 原生 <p:transition>（平滑＝p159:morph·旧版退回淡化）。
//   程序动画组件：拆得开（decompose）⇒ 元件＋原生动画（aislides-pptx-program）；
//         拆不开 ⇒ 每步录成小影片（aislides-pptx-record·浏览器里录 canvas＝MP4·垫底色）放原位、单击播放、cues＝影片书签 On Bookmark。
//   只在浏览器跑（页面「pptx」钮动态载入本档·pptxgenjs 跟着懒载入）。pptxgenjs 3.12.0（MIT）整包调用。

import type PptxGenJSType from 'pptxgenjs'
import { createExportFrame, fetchExportBitmap, measureDocOntoSlide, newMeasureBudget, type ExportMediaProxy, type MeasureBudget } from './pptx'
import type { DeckDataV2 } from '../deck-edit'
import { deckThemeOf } from '../deck-components'
import { pageComponents } from '../kit/components/derive'
import { htmlComponentDoc } from '../kit/components/render'
import { resolveColor, resolveCtx, resolveFontStack, type ResolveCtx } from '../kit/components/resolve'
import type {
  ChartComponent, HtmlComponent, ImageComponent, ShapeComponent, SlideComponent, Stroke, TableComponent, TextBody, TextParagraph, VideoComponent,
} from '../kit/components/types'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../kit/types'
import { childToPage } from '../kit/components/geom'
import { finishPptxZip, fitVideoBox, gradFillXml, videoFormatOf, type ShapeXmlPatch, type SlideTimingPatch } from './pptx-xml'
import { planSlideTimeline, type AnimLike, type ProgramPlan, type SlideMediaSpec } from './pptx-timing'
import { decomposedProgramPlan, isProgramComponent, partBox, partEverShown, partName, programBgName, programClipName, programEndName, programLayout, programPosterName, programVideoBox, recordedProgramPlan, type ProgramComponentLike } from './pptx-program'
import { recordProgramSteps } from './pptx-record'
import { readBoundedBytes } from '../../shared/read-bounded-bytes'

type Pptx = InstanceType<typeof PptxGenJSType>
type Slide = ReturnType<Pptx['addSlide']>
type Run = { text: string; options?: Record<string, unknown> }

const IN = 0.01          // 1 逻辑 px ＝ 0.01 英寸
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const PT = 0.72          // 1 逻辑 px ＝ 0.72 pt

export type ComponentPptxReport = {
  slides: number
  objects: number
  /** 真嵌进 pptx 的影片（PowerPoint 里能播） */
  videosEmbedded: number
  /** 退回「封面图＋连结」的影片（＝下面三种原因之和） */
  videosAsLink: number
  /** 退回原因：超过单支／整份大小上限 */
  videoTooBig: number
  /** 退回原因：取不到影片档（网址失效、没权限、跨站不给） */
  videoFetchFailed: number
  /** 退回原因：格式 PowerPoint 放不了（WebM 等·只嵌 MP4／MOV） */
  videoFormat: number
  /** 转成 PowerPoint 原生动画的效果数（组合拆平后按物件算） */
  animEffects: number
  /** 对不上物件而丢掉的动画（旧整页内容量不出来的那种） */
  animMissing: number
  /** 影片步骤（播放／暂停／跳秒）转成媒体命令的条数 */
  mediaSteps: number
  /** 影片没嵌进去 ⇒ 它的影片步骤丢掉 */
  mediaStepsDropped: number
  /** 暂停时的跳秒 ⇒ 并进下一次播放（从那一秒开始播） */
  mediaSeekFolded: number
  /** 拆成元件＋原生动画的程序组件 */
  programsDecomposed: number
  /** 没导出的程序组件（拆不开、也没录成影片） */
  programsNotExported: number
  /** 程序步骤排进 PowerPoint 动画顺序的步数 */
  programSteps: number
  /** 页动画表里的程序步骤比程序步数多 ⇒ 多出的忽略 */
  programStepsIgnored: number
  /** 做不出来而跳过的程序步骤 */
  programStepsFailed: number
  /** 书签改成「与那一步同时＋延迟」（拆开的程序没影片可挂书签） */
  cuesAsDelay: number
  /** 书签真挂在录好的影片上（On Bookmark） */
  cuesAsBookmark: number
  /** 书签对不到页上的动画 ⇒ 忽略 */
  cuesDropped: number
  /** 拆不开 ⇒ 每步录成影片的程序组件 */
  programsRecorded: number
  /** 录好放进去的影片段数 */
  clipsRecorded: number
  /** 录失败（或太大）的步数 */
  clipsFailed: number
  /** 程序没回报这一步做完 ⇒ 按上限秒数录的段数 */
  clipsTimedOut: number
  /** 透明背景的程序录片时垫了本页底色（PowerPoint for Windows 不吃透明影片·浏览器录不出透明格式） */
  clipsOpaqueBg: number
  /** 录不了：程序不是画在 canvas 上 */
  recordNoCanvas: number
  /** 录不了：这个浏览器不能录 MP4 */
  recordNoMp4: number
  /** 录不了：程序载不起来／没有步数 */
  recordFailed: number
  rotationDropped: number
  clampedTexts: number
  imagesSkipped: number
  htmlMeasured: number
  /** 页底影片退成封面图的页数 */
  videoBackgrounds: number
  /** 毛玻璃退成半透明填色的形状数 */
  blurDropped: number
  /** 拆平的组合数 */
  groupsFlattened: number
}

/** '#RRGGBB'／'#RRGGBBAA'／rgb() ⇒ { hex:'RRGGBB', transparency 0–100 }（透明 ⇒ null） */
function colorOf(css: string | null | undefined): { hex: string; transparency: number } | null {
  if (!css) return null
  const s = css.trim()
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s)
  if (m) {
    const a = m[2] ? parseInt(m[2], 16) / 255 : 1
    return a <= 0 ? null : { hex: m[1].toUpperCase(), transparency: Math.round((1 - a) * 100) }
  }
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s)
  if (m) return { hex: `${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase(), transparency: 0 }
  const r = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s)
  if (r) {
    const a = r[4] === undefined ? 1 : Number(r[4])
    if (!(a > 0)) return null
    const h = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')
    return { hex: `${h(r[1])}${h(r[2])}${h(r[3])}`.toUpperCase(), transparency: Math.round((1 - a) * 100) }
  }
  return null
}

const firstFamily = (stack: string) => (stack.split(',')[0] ?? '').replace(/["']/g, '').trim() || 'Arial'

function lineOf(s: Stroke | null | undefined, ctx: ResolveCtx): Record<string, unknown> | undefined {
  if (!s || !(s.width > 0)) return undefined
  const c = colorOf(resolveColor(s.color, ctx, 'transparent'))
  if (!c) return undefined
  return { color: c.hex, transparency: c.transparency, width: s.width * PT, dashType: s.dash === 'dashed' ? 'dash' : s.dash === 'dotted' ? 'sysDot' : 'solid' }
}

const pos = (c: SlideComponent) => ({ x: c.frame.x * IN, y: c.frame.y * IN, w: c.frame.w * IN, h: c.frame.h * IN, ...(c.frame.rotate ? { rotate: c.frame.rotate } : {}) })

/* ------------------------------------------------------------------ */
/* 文字                                                                */
/* ------------------------------------------------------------------ */

function textRuns(paragraphs: readonly TextParagraph[], ctx: ResolveCtx): Run[] {
  const out: Run[] = []
  paragraphs.forEach((p, pi) => {
    const last = pi === paragraphs.length - 1
    const para: Record<string, unknown> = {}
    if (p.align) para.align = p.align === 'distribute' ? 'justify' : p.align
    if (p.indent) para.indentLevel = Math.min(8, p.indent)
    if (p.list?.kind === 'ul') para.bullet = p.list.style === 'square' ? { characterCode: '25AA' } : p.list.style === 'circle' ? { characterCode: '25E6' } : true
    else if (p.list?.kind === 'ol') para.bullet = { type: 'number', style: p.list.style === 'lower-alpha' ? 'alphaLcPeriod' : p.list.style === 'lower-roman' ? 'romanLcPeriod' : 'arabicPeriod' }
    if (p.lineHeight) para.lineSpacingMultiple = p.lineHeight
    const runs = (p.runs ?? []).filter((r) => typeof r?.text === 'string')
    const list = runs.length ? runs : [{ text: '' }]
    list.forEach((r, ri) => {
      const o: Record<string, unknown> = { ...para }
      if (r.bold !== undefined) o.bold = r.bold
      if (r.italic !== undefined) o.italic = r.italic
      if (r.underline) o.underline = { style: 'sng' }
      if (r.strike) o.strike = 'sngStrike'
      if (r.sup) o.superscript = true
      if (r.sub) o.subscript = true
      if (r.color) { const c = colorOf(resolveColor(r.color, ctx, 'transparent')); if (c) o.color = c.hex }
      if (r.highlight) { const c = colorOf(resolveColor(r.highlight, ctx, 'transparent')); if (c) o.highlight = c.hex }
      if (r.font) o.fontFace = firstFamily(resolveFontStack(r.font, ctx))
      if (typeof r.size === 'number') o.fontSize = Math.round(r.size * PT * 10) / 10
      if (r.shadow) o.shadow = { type: 'outer', color: '000000', opacity: 0.35, blur: 2, offset: 1, angle: 45 }
      if (!last && ri === list.length - 1) o.breakLine = true
      // 片段里的换行（\n）＝段内换行（PowerPoint 的软换行）
      const parts = r.text.split('\n')
      parts.forEach((part, k) => {
        const opts = { ...o }
        if (k < parts.length - 1) opts.breakLine = true
        out.push({ text: part, options: opts })
      })
    })
  })
  return out
}

function textBoxOpts(body: TextBody, ctx: ResolveCtx): Record<string, unknown> {
  const b = body.box
  const color = colorOf(resolveColor(b.color, ctx, ctx.palette.text))
  const fill = b.fill ? colorOf(resolveColor(b.fill, ctx, 'transparent')) : null
  return {
    fontFace: firstFamily(resolveFontStack(b.font, ctx)),
    fontSize: Math.round(b.size * PT * 10) / 10,
    ...(color ? { color: color.hex } : {}),
    bold: !!b.bold, italic: !!b.italic,
    align: b.align === 'distribute' ? 'justify' : b.align,
    valign: b.valign,
    lineSpacingMultiple: b.lineHeight > 0 ? b.lineHeight : 1.45,
    ...(b.letterSpacing ? { charSpacing: b.letterSpacing * PT } : {}),
    margin: Math.round((b.padding ?? 0) * PT * 10) / 10,
    ...(fill ? { fill: { color: fill.hex, transparency: fill.transparency } } : {}),
    ...(b.border ? { line: lineOf(b.border, ctx) } : {}),
    fit: 'none', isTextBox: true,
  }
}

/* ------------------------------------------------------------------ */
/* 图片烤图                                                             */
/* ------------------------------------------------------------------ */

/** missing＝有网址但取不到图（画了占位块·记进报告） */
type Baked = { data: string; missing: boolean } | null

/** 按组件的样子把图画进 canvas（裁切／适配／圆角／翻转／透明度／边框）⇒ pptxgenjs 的 data 串 */
async function bakeImage(src: string, c: ImageComponent | VideoComponent, ctx: ResolveCtx, budget: MeasureBudget, mediaUrl: (u: string) => string, play = false): Promise<Baked> {
  const scale = 2
  const W = Math.max(1, Math.round(c.frame.w * scale)), H = Math.max(1, Math.round(c.frame.h * scale))
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const g = cv.getContext('2d')
  if (!g) return null
  const img = c.type === 'image' ? c : null
  const radius = (img?.radius ?? 0) * scale
  if (radius > 0) { g.beginPath(); g.roundRect(0, 0, W, H, Math.min(radius, W / 2, H / 2)); g.clip() }
  if (typeof c.opacity === 'number' && c.opacity < 1) g.globalAlpha = Math.max(0, c.opacity)
  let drew = false
  if (src) {
    const got = await fetchExportBitmap(mediaUrl(src), budget)
    if (got) {
      const bmp = got.bmp
      const crop = img?.crop
      const sx = crop ? (crop.x / 100) * bmp.width : 0
      const sy = crop ? (crop.y / 100) * bmp.height : 0
      const sw = crop ? (crop.w / 100) * bmp.width : bmp.width
      const sh = crop ? (crop.h / 100) * bmp.height : bmp.height
      // 有裁切窗＝裁切窗铺满整个框（与画布 cropInsetStyle 同效）；没有＝按 cover／contain
      const s = c.fit === 'contain' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh)
      const dw = crop ? W : sw * s, dh = crop ? H : sh * s
      g.save()
      if (img?.flipX || img?.flipY) { g.translate(img.flipX ? W : 0, img.flipY ? H : 0); g.scale(img.flipX ? -1 : 1, img.flipY ? -1 : 1) }
      g.drawImage(bmp, sx, sy, sw, sh, (W - dw) / 2, (H - dh) / 2, dw, dh)
      g.restore()
      drew = true
    }
  }
  if (!drew) {
    // 主题占位块（与画布上缺图的画法同调）
    const grad = g.createLinearGradient(0, 0, W, H)
    grad.addColorStop(0, ctx.palette.figureBg); grad.addColorStop(1, ctx.palette.surface)
    g.fillStyle = grad; g.fillRect(0, 0, W, H)
    if (play) {
      g.fillStyle = ctx.palette.accent; g.globalAlpha = 0.7
      g.beginPath(); g.moveTo(W / 2 - 22, H / 2 - 26); g.lineTo(W / 2 - 22, H / 2 + 26); g.lineTo(W / 2 + 30, H / 2); g.closePath(); g.fill()
    }
  }
  if (img?.border && img.border.width > 0) {
    g.globalAlpha = 1
    g.strokeStyle = resolveColor(img.border.color, ctx, 'transparent')
    g.lineWidth = img.border.width * scale * 2
    g.beginPath(); g.roundRect(0, 0, W, H, Math.min(radius, W / 2, H / 2)); g.stroke()
  }
  return { data: cv.toDataURL('image/png').replace(/^data:/, ''), missing: !!src && !drew }
}

/* ------------------------------------------------------------------ */
/* 嵌入影片                                                     */
/* ------------------------------------------------------------------ */

/** 单支／整份的影片大小上限（浏览器里整份 pptx 在记忆体里组·太大会卡死分页） */
export const MAX_VIDEO_BYTES = 150 * 1024 * 1024
export const MAX_TOTAL_VIDEO_BYTES = 400 * 1024 * 1024

type VideoGot = { bytes: Uint8Array; ext: 'mp4' | 'mov'; mime: string } | { fail: 'tooBig' | 'fetch' | 'format' }

async function fetchVideoFrom(url: string, limit: number): Promise<VideoGot | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' })
    if (!res.ok) return null
    const declared = Number(res.headers.get('content-length') || '')
    if (Number.isFinite(declared) && declared > limit) { void res.body?.cancel().catch(() => {}); return { fail: 'tooBig' } }
    const bytes = await readBoundedBytes(res, limit)
    if (!bytes) return { fail: 'tooBig' }
    const f = videoFormatOf(bytes.subarray(0, 16), res.headers.get('content-type') || '')
    if (!f) return { fail: 'format' }
    return { bytes, ...f }
  } catch { return null }
}

/** 取影片档（直取不行＝宿主有代理才走·同取图那条路）·超过上限当场停 */
async function fetchVideo(url: string, limit: number, proxy?: ExportMediaProxy): Promise<VideoGot> {
  if (!url || limit <= 0) return { fail: limit <= 0 ? 'tooBig' : 'fetch' }
  const direct = await fetchVideoFrom(url, limit)
  if (direct) return direct
  if (!proxy) return { fail: 'fetch' }
  let sameOrigin = false
  try { sameOrigin = new URL(url, location.href).origin === location.origin } catch { return { fail: 'fetch' } }
  if (sameOrigin || !/^https?:/i.test(url)) return { fail: 'fetch' }
  return (await fetchVideoFrom(proxy(url, 'video'), limit)) ?? { fail: 'fetch' }
}

/** 读片长、宽高、第一格画面（当 PowerPoint 里的封面·没给封面图时用）·浏览器解不了的编码＝都给 null（照样嵌） */
async function probeVideo(bytes: Uint8Array, mime: string): Promise<{ durationMs: number | null; w: number; h: number; frame: string | null }> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  const v = document.createElement('video')
  v.muted = true; v.playsInline = true; v.preload = 'auto'
  const wait = (ev: string, ms: number) => new Promise<boolean>((resolve) => {
    const t = setTimeout(() => { cleanup(); resolve(false) }, ms)
    const ok = () => { cleanup(); resolve(true) }
    const bad = () => { cleanup(); resolve(false) }
    const cleanup = () => { clearTimeout(t); v.removeEventListener(ev, ok); v.removeEventListener('error', bad) }
    v.addEventListener(ev, ok); v.addEventListener('error', bad)
  })
  try {
    v.src = url
    if (!(await wait('loadeddata', 8000))) return { durationMs: null, w: 0, h: 0, frame: null }
    const durationMs = Number.isFinite(v.duration) && v.duration > 0 ? Math.round(v.duration * 1000) : null
    const w = v.videoWidth, h = v.videoHeight
    let frame: string | null = null
    if (w > 0 && h > 0) {
      v.currentTime = Math.min(0.1, (v.duration || 0.2) / 2)
      await wait('seeked', 4000)
      const s = Math.min(1, 1280 / Math.max(w, h))
      const cv = document.createElement('canvas'); cv.width = Math.round(w * s); cv.height = Math.round(h * s)
      const g = cv.getContext('2d')
      if (g) { g.drawImage(v, 0, 0, cv.width, cv.height); frame = cv.toDataURL('image/png') }
    }
    return { durationMs, w, h, frame }
  } catch {
    return { durationMs: null, w: 0, h: 0, frame: null }
  } finally {
    v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url)
  }
}

/** 影片封面（PowerPoint 播放前显示的那张·物件框比例）：给了封面图＝照 cover 铺；否则第一格画面；都没有＝▶ 占位块 */
async function videoCover(v: VideoComponent, box: { w: number; h: number }, frameData: string | null, ctx: ResolveCtx, budget: MeasureBudget, mediaUrl: (u: string) => string): Promise<string | null> {
  const src = v.poster ? mediaUrl(v.poster) : frameData ?? ''
  const baked = await bakeImage(src, { ...v, poster: undefined, frame: { ...v.frame, w: box.w, h: box.h, rotate: 0 }, fit: 'cover' } as VideoComponent, ctx, budget, (u) => u, true)
  return baked ? baked.data : null
}

/* ------------------------------------------------------------------ */
/* 程序动画组件·拆得开的（C2）                                           */
/* ------------------------------------------------------------------ */

/** 元件 ⇒ 图片／形状（物件名＝程序编号::元件编号）·透明底以外先垫一块底色·回放进去的物件名（程序本身的动画挂在这几个上） */
async function addProgramParts(slide: Slide, pc: ProgramComponentLike, ctx: ResolveCtx, budget: MeasureBudget, mediaUrl: (u: string) => string, S: Pptx['ShapeType'], report: ComponentPptxReport): Promise<string[]> {
  const d = pc.decompose!
  const L = programLayout(pc)
  const names: string[] = []
  if (pc.transparent === false) {
    const bg = colorOf(pc.bgColor ?? '#000000')
    if (bg) {
      slide.addShape(S.rect, { x: pc.frame.x * IN, y: pc.frame.y * IN, w: pc.frame.w * IN, h: pc.frame.h * IN, fill: { color: bg.hex, transparency: bg.transparency }, line: { type: 'none' }, objectName: programBgName(pc.id) } as Parameters<Slide['addShape']>[1])
      names.push(programBgName(pc.id))
    }
  }
  for (const part of d.parts) {
    if (!partEverShown(d, part.id)) continue
    const b = partBox(part, L)
    const name = partName(pc.id, part.id)
    const at = { x: b.x * IN, y: b.y * IN, w: b.w * IN, h: b.h * IN, ...(b.rotate ? { rotate: b.rotate } : {}), objectName: name }
    if (part.src) {
      const baked = await bakeImage(part.src, { id: name, type: 'image', frame: { x: b.x, y: b.y, w: b.w, h: b.h, rotate: 0 }, src: part.src, fit: 'contain' }, ctx, budget, mediaUrl)
      if (!baked) { report.imagesSkipped++; continue }
      if (baked.missing) report.imagesSkipped++
      slide.addImage({ data: baked.data, ...at })
    } else {
      const sh = part.shape ?? { kind: 'rect' as const }
      const kind = sh.kind === 'ellipse' ? S.ellipse : sh.kind === 'roundRect' ? S.roundRect : S.rect
      const fill = colorOf(sh.fill)
      const stroke = colorOf(sh.stroke)
      const opts: Record<string, unknown> = {
        ...at,
        ...(fill ? { fill: { color: fill.hex, transparency: fill.transparency } } : { fill: { type: 'none' } }),
        ...(stroke ? { line: { color: stroke.hex, width: Math.max(0.5, L.s * PT) } } : { line: { type: 'none' } }),
      }
      if (sh.text) {
        const color = colorOf(sh.color ?? '#000000')
        slide.addText(sh.text, { ...opts, shape: kind, align: 'center', valign: 'middle', margin: 0, fontSize: Math.max(4, Math.round((sh.size ?? 16) * L.s * PT * 10) / 10), ...(color ? { color: color.hex } : {}) } as Parameters<Slide['addText']>[1])
      } else {
        slide.addShape(kind, opts as Parameters<Slide['addShape']>[1])
      }
    }
    names.push(name)
  }
  return names
}

/** pptxgenjs 的影片资料先放 1 个字节的占位（免得整支影片转 base64 吃两倍记忆体）·写完档再把真档换进包里 */
const MEDIA_PLACEHOLDER = 'AA=='

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

/** proxy：外站图／影片直取失败时的同源代理（宿主给·见 ExportMediaProxy）；不给＝不走代理 */
export async function buildComponentPptx(opts: { deck: DeckDataV2; title: string; mediaUrl?: (u: string) => string; proxy?: ExportMediaProxy }): Promise<{ blob: Blob; report: ComponentPptxReport }> {
  const { deck } = opts
  const mediaUrl = opts.mediaUrl ?? ((u: string) => u)
  const mod = await import('pptxgenjs')
  const PptxGenJS = (mod as unknown as { default: typeof PptxGenJSType }).default
  const pptx: Pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'   // 10 × 5.625 英寸 ＝ 1000 × 562.5 逻辑 px
  pptx.title = opts.title
  const theme = deckThemeOf(deck)
  const lang = deck.lang === 'zh-CN' ? 'zh-CN' : 'zh-TW'
  const budget = newMeasureBudget('16x9', opts.proxy)
  const report: ComponentPptxReport = {
    slides: 0, objects: 0, videosEmbedded: 0, videosAsLink: 0, videoTooBig: 0, videoFetchFailed: 0, videoFormat: 0,
    animEffects: 0, animMissing: 0, mediaSteps: 0, mediaStepsDropped: 0, mediaSeekFolded: 0,
    programsDecomposed: 0, programsNotExported: 0, programSteps: 0, programStepsIgnored: 0, programStepsFailed: 0, cuesAsDelay: 0, cuesAsBookmark: 0, cuesDropped: 0,
    programsRecorded: 0, clipsRecorded: 0, clipsFailed: 0, clipsTimedOut: 0, clipsOpaqueBg: 0, recordNoCanvas: 0, recordNoMp4: 0, recordFailed: 0,
    rotationDropped: 0, clampedTexts: 0, imagesSkipped: 0, htmlMeasured: 0, videoBackgrounds: 0, blurDropped: 0, groupsFlattened: 0,
  }
  const xmlPatches: Array<Record<string, ShapeXmlPatch>> = []
  /** 每页的动画补丁（时间线＋嵌入影片＋书签）·影片裁切 */
  const timingPatches: Array<SlideTimingPatch | null> = []
  const cropPatches: Array<Record<string, { l: number; t: number; r: number; b: number }>> = []
  /** 写完档要换进包里的影片真档（页序·物件名） */
  const mediaFiles: Array<{ page: number; name: string; bytes: Uint8Array; mime: string; ext: string }> = []
  let videoBytesLeft = MAX_TOTAL_VIDEO_BYTES
  let frame: HTMLIFrameElement | null = null
  const S = pptx.ShapeType

  try {
    for (let pi = 0; pi < deck.pages.length; pi++) {
      const page = deck.pages[pi]
      const ctx = resolveCtx(theme, page.draft.type)
      const slide: Slide = pptx.addSlide()
      const bg = colorOf(page.background?.color ? resolveColor(page.background.color, ctx, ctx.palette.bg) : ctx.palette.bg)
      slide.background = { color: bg?.hex ?? 'FFFFFF' }
      const shapePatches: Record<string, ShapeXmlPatch> = {}
      xmlPatches.push(shapePatches)
      // 页底影片 ⇒ 封面图（没封面＝底图）
      if (page.background?.videoUrl) report.videoBackgrounds++
      const bgImage = page.background?.videoUrl ? (page.background.poster || page.background.imageUrl) : page.background?.imageUrl
      if (bgImage) {
        const baked = await bakeImage(bgImage, { id: 'bg', type: 'image', frame: { x: 0, y: 0, w: CANVAS_WIDTH, h: CANVAS_HEIGHT, rotate: 0 }, src: bgImage, fit: page.background?.fit === 'contain' ? 'contain' : 'cover' }, ctx, budget, mediaUrl)
        // 底图放进投影片背景（不是图片物件）⇒「投影片背景填滿」的形状透得出来；烤成 data 不行时退回铺一张图
        if (baked) slide.background = { data: baked.data }
      }
      // 组合拆平：子件换成页面坐标（角度相加）·透明度相乘·组隐藏＝子件隐藏
      const flat: SlideComponent[] = []
      /** 动画用：组合编号 ⇒ 拆平后看得见的子件名；放映看得见的组件编号（同 render liveIds） */
      const groupKids = new Map<string, string[]>()
      const live = new Set<string>()
      for (const c of pageComponents(page, pi, lang)) {
        if (!c.hidden) live.add(c.id)
        if (c.type !== 'group') { flat.push(c); continue }
        report.groupsFlattened++
        const gop = typeof c.opacity === 'number' ? c.opacity : 1
        groupKids.set(c.id, c.children.filter((ch) => !ch.hidden).map((ch) => ch.id))
        for (const ch of c.children) {
          if (!c.hidden && !ch.hidden) live.add(ch.id)
          const o = (typeof ch.opacity === 'number' ? ch.opacity : 1) * gop
          flat.push({ ...ch, frame: childToPage(c.frame, ch.frame), ...(o < 1 ? { opacity: o } : {}), ...(c.hidden ? { hidden: true } : {}) } as SlideComponent)
        }
      }
      const pageMedia = new Map<string, { autoplay?: boolean; durationMs?: number | null }>()
      const mediaSpecs: SlideMediaSpec[] = []
      const crops: Record<string, { l: number; t: number; r: number; b: number }> = {}
      cropPatches.push(crops)
      /** 程序组件（编号 ⇒ 排步资料·Map 顺序＝叠层由下而上）·程序编号 ⇒ 它在 PowerPoint 里的物件名（元件／录片） */
      const programs = new Map<string, ProgramPlan>()
      const programNames = new Map<string, string[]>()
      for (const c of flat) {
        if (c.hidden) continue
        const name = c.id
        // 程序动画组件（type＝'program'·合码前联合型别里还没有 ⇒ 先按字串判）
        if (isProgramComponent(c as unknown)) {
          const pc = c as unknown as ProgramComponentLike
          if (pc.frame.rotate) report.rotationDropped++
          const plan = decomposedProgramPlan(pc)
          if (plan) {
            programNames.set(pc.id, await addProgramParts(slide, pc, ctx, budget, mediaUrl, S, report))
            programs.set(pc.id, plan)
            report.programsDecomposed++
          } else {
            // 拆不开 ⇒ 每一步录成一小段影片放在原位（垫底色：程序自己的底色；透明的垫本页底色·记报告）
            const opaque = pc.transparent === false && !!pc.bgColor
            const rec = await recordProgramSteps(pc, { bg: opaque ? pc.bgColor! : `#${bg?.hex ?? 'FFFFFF'}` })
            if (!rec.ok) {
              if (rec.reason === 'noCanvas') report.recordNoCanvas++
              else if (rec.reason === 'noMp4') report.recordNoMp4++
              else report.recordFailed++
              report.programsNotExported++
            } else {
              if (!opaque) report.clipsOpaqueBg++
              const vb = programVideoBox(pc)
              const at = { x: vb.x * IN, y: vb.y * IN, w: vb.w * IN, h: vb.h * IN }
              const names: string[] = []
              if (rec.poster) {
                slide.addImage({ data: rec.poster.replace(/^data:/, ''), ...at, objectName: programPosterName(pc.id) })
                names.push(programPosterName(pc.id))
              }
              const metas: Array<{ durationMs: number; end?: boolean } | null> = []
              for (let k = 1; k <= rec.clips.length; k++) {
                const clip = rec.clips[k - 1]
                if (!clip || clip.bytes.byteLength > Math.min(MAX_VIDEO_BYTES, videoBytesLeft)) { metas.push(null); report.clipsFailed++; continue }
                videoBytesLeft -= clip.bytes.byteLength
                const probe = await probeVideo(clip.bytes, clip.mime)
                const cname = programClipName(pc.id, k)
                slide.addMedia({
                  type: 'video', data: `${clip.mime};base64,${MEDIA_PLACEHOLDER}`, extn: clip.ext,
                  ...(probe.frame ? { cover: probe.frame.replace(/^data:/, '') } : rec.poster ? { cover: rec.poster.replace(/^data:/, '') } : {}),
                  ...at, objectName: cname,
                } as Parameters<Slide['addMedia']>[0])
                mediaFiles.push({ page: pi, name: cname, bytes: clip.bytes, mime: clip.mime, ext: clip.ext })
                mediaSpecs.push({ name: cname, muted: true })
                names.push(cname)
                // 终点画面紧接着放（叠在这一段上、下一段之下）·播完那一刻现身（见 recordedProgramPlan）
                const end = rec.ends[k - 1]
                if (end) {
                  slide.addImage({ data: end.replace(/^data:/, ''), ...at, objectName: programEndName(pc.id, k) })
                  names.push(programEndName(pc.id, k))
                }
                metas.push({ durationMs: probe.durationMs ?? clip.durationMs, end: !!end })
                report.clipsRecorded++
                if (clip.timedOut) report.clipsTimedOut++
              }
              programNames.set(pc.id, names)
              programs.set(pc.id, recordedProgramPlan(pc, metas))
              report.programsRecorded++
            }
          }
          report.objects++
          continue
        }
        switch (c.type) {
          case 'text': {
            if (c.box.clamp) report.clampedTexts++
            slide.addText(textRuns(c.paragraphs, ctx) as Parameters<Slide['addText']>[0], { ...pos(c), ...textBoxOpts(c, ctx), objectName: name } as Parameters<Slide['addText']>[1])
            break
          }
          case 'shape': {
            const sc = c as ShapeComponent
            const blockArc = sc.shape === 'ring' && !!sc.arc && ((sc.arc.end - sc.arc.start) % 360 + 360) % 360 !== 0
            const kind = sc.shape === 'roundRect' ? S.roundRect : sc.shape === 'ellipse' ? S.ellipse : sc.shape === 'triangle' ? S.triangle
              : sc.shape === 'diamond' ? S.diamond : sc.shape === 'arrow' ? S.rightArrow : sc.shape === 'line' ? S.line
                : sc.shape === 'ring' ? (blockArc ? S.blockArc : S.donut) : sc.shape === 'arc' ? S.arc
                  : sc.shape === 'callout' ? S.wedgeRoundRectCallout : sc.shape === 'summingJunction' ? S.flowChartSummingJunction : S.rect
            const strokeOnly = sc.shape === 'line' || sc.shape === 'arc'
            const fill = !strokeOnly && sc.fill ? colorOf(resolveColor(sc.fill, ctx, 'transparent')) : null
            const op = typeof sc.opacity === 'number' && sc.opacity < 1 ? sc.opacity : 1
            const line = lineOf(sc.stroke, ctx)
            const ends = { ...(sc.lineEnds?.start === 'arrow' ? { beginArrowType: 'triangle' } : {}), ...(sc.lineEnds?.end === 'arrow' ? { endArrowType: 'triangle' } : {}) }
            const sh = sc.shadow
            const shc = sh ? colorOf(resolveColor(sh.color, ctx, '#00000066')) : null
            const shapeOpts: Record<string, unknown> = {
              ...pos(sc), objectName: name,
              ...(fill ? { fill: { color: fill.hex, transparency: Math.min(100, Math.round(fill.transparency + (1 - op) * 100)) } } : { fill: { type: 'none' } }),
              ...(line ? { line: strokeOnly ? { ...line, ...ends } : line } : { line: { type: 'none' } }),
              ...(sc.shape === 'roundRect' ? { rectRadius: Math.min(0.5, (sc.radius ?? 16) / Math.max(1, Math.min(sc.frame.w, sc.frame.h))) } : {}),
              ...(sc.shape === 'arc' ? { angleRange: [sc.arc?.start ?? 0, sc.arc?.end ?? 270] } : {}),
              ...(blockArc ? { angleRange: [sc.arc!.start, sc.arc!.end], arcThicknessRatio: Math.min(1, (sc.thickness ?? 0.2) * 2) } : {}),
              ...(sh && shc ? { shadow: { type: 'outer', blur: Math.round(sh.blur * PT * 10) / 10, offset: Math.round(sh.distance * PT * 10) / 10, angle: Math.round(sh.angle), color: shc.hex, opacity: Math.round((1 - shc.transparency / 100) * 100) / 100 } } : {}),
            }
            // 出档后补的 XML：幻灯片背景填充／渐层／调整值
            const patch: ShapeXmlPatch = {}
            if (!strokeOnly && sc.fillMode === 'pageBackground') patch.useBgFill = true
            else if (!strokeOnly && sc.fillMode === 'gradient' && sc.gradient) patch.gradFill = gradFillXml(sc.gradient, (v) => {
              const css = resolveColor(v as never, ctx, '#000000')
              const k = colorOf(css)
              return k ? `#${k.hex}${k.transparency ? Math.round((1 - k.transparency / 100) * 255).toString(16).padStart(2, '0') : ''}` : '#000000'
            })
            if (sc.shape === 'ring' && !blockArc) patch.avLst = `<a:gd name="adj" fmla="val ${Math.round(Math.min(0.5, sc.thickness ?? 0.2) * 100000)}"/>`
            if (sc.shape === 'callout') {
              const t = sc.callout ?? { side: 'bottom', pos: 25, len: 40 }
              const { w, h } = sc.frame
              const b = Math.max(4, Math.min(w, h) * 0.08)
              const along = (t.side === 'top' || t.side === 'bottom' ? w : h) * t.pos / 100
              const tip = t.side === 'bottom' ? [along - b, h + t.len] : t.side === 'top' ? [along - b, -t.len] : t.side === 'right' ? [w + t.len, along - b] : [-t.len, along + b]
              const r = Math.max(0, Math.min(sc.radius ?? 12, w / 2, h / 2))
              patch.avLst = `<a:gd name="adj1" fmla="val ${Math.round(((tip[0] - w / 2) / w) * 100000)}"/><a:gd name="adj2" fmla="val ${Math.round(((tip[1] - h / 2) / h) * 100000)}"/><a:gd name="adj3" fmla="val ${Math.round((r / Math.max(1, Math.min(w, h))) * 100000)}"/>`
            }
            if (Object.keys(patch).length) shapePatches[name] = patch
            if (sc.backdropBlur) report.blurDropped++
            if (sc.shape === 'line') {
              // 线条：以框的中线画（高度只是点选范围）
              Object.assign(shapeOpts, { y: (sc.frame.y + sc.frame.h / 2) * IN, h: 0 })
            }
            if (sc.text && !strokeOnly) {
              slide.addText(textRuns(sc.text.paragraphs, ctx) as Parameters<Slide['addText']>[0], { ...textBoxOpts(sc.text, ctx), ...shapeOpts, shape: kind, isTextBox: false } as Parameters<Slide['addText']>[1])
            } else {
              slide.addShape(kind, shapeOpts as Parameters<Slide['addShape']>[1])
            }
            break
          }
          case 'image': {
            const baked = await bakeImage((c as ImageComponent).src, c as ImageComponent, ctx, budget, mediaUrl)
            if (!baked) { report.imagesSkipped++; break }
            if (baked.missing) report.imagesSkipped++
            slide.addImage({ data: baked.data, ...pos(c), objectName: name })
            break
          }
          case 'video': {
            const v = c as VideoComponent
            // 真嵌进去（PowerPoint 里能播）·超过上限／取不到／格式不行 ⇒ 退回旧做法（封面图＋连结）并记原因
            const got = await fetchVideo(v.src ? mediaUrl(v.src) : '', Math.min(MAX_VIDEO_BYTES, videoBytesLeft), opts.proxy)
            if ('bytes' in got) {
              videoBytesLeft -= got.bytes.byteLength
              const probe = await probeVideo(got.bytes, got.mime)
              const fit = fitVideoBox(v.frame, probe.w, probe.h, v.fit === 'contain' ? 'contain' : 'cover')
              const coverBox = fit.crop && probe.w > 0 ? { w: v.frame.w, h: (v.frame.w * probe.h) / probe.w } : fit.box
              const cover = await videoCover(v, coverBox, probe.frame, ctx, budget, mediaUrl)
              if (v.frame.rotate) report.rotationDropped++   // pptxgenjs 的影片物件不带旋转
              slide.addMedia({
                type: 'video', data: `${got.mime};base64,${MEDIA_PLACEHOLDER}`, extn: got.ext,
                ...(cover ? { cover: cover } : {}),
                x: fit.box.x * IN, y: fit.box.y * IN, w: fit.box.w * IN, h: fit.box.h * IN, objectName: name,
              } as Parameters<Slide['addMedia']>[0])
              if (fit.crop) crops[name] = fit.crop
              mediaFiles.push({ page: pi, name, bytes: got.bytes, mime: got.mime, ext: got.ext })
              pageMedia.set(v.id, { autoplay: !!v.autoplay, durationMs: probe.durationMs })
              mediaSpecs.push({ name, loop: !!v.loop, muted: !!v.muted, toggleOnClick: v.controls !== false })
              report.videosEmbedded++
              break
            }
            if (got.fail === 'tooBig') report.videoTooBig++
            else if (got.fail === 'format') report.videoFormat++
            else report.videoFetchFailed++
            const baked = await bakeImage(v.poster ?? '', v, ctx, budget, mediaUrl, true)
            report.videosAsLink++
            if (baked) slide.addImage({ data: baked.data, ...pos(v), objectName: name, ...(/^https?:\/\//.test(v.src) ? { hyperlink: { url: v.src, tooltip: 'video' } } : {}) })
            break
          }
          case 'table': {
            const tc = c as TableComponent
            if (tc.frame.rotate) report.rotationDropped++
            const st = tc.style
            const col = (v: string | undefined, fb: string) => colorOf(v ? resolveColor(v as never, ctx, fb) : fb)
            const txt = col(st.color, ctx.palette.text)
            const hf = col(st.headerFill, ctx.palette.accent)
            const hc = col(st.headerColor, ctx.palette.onAccent)
            const band = st.bandFill ? col(st.bandFill, 'transparent') : null
            const border = col(st.borderColor, ctx.palette.border)
            const rows = tc.cells.map((row, r) => row.map((cell) => {
              const head = tc.header && r === 0
              const fillC = cell.fill ? col(cell.fill, 'transparent') : head ? hf : band && r % 2 === (tc.header ? 0 : 1) ? band : null
              return {
                text: textRuns(cell.paragraphs, ctx) as unknown as string,
                options: {
                  ...(head ? { bold: true, ...(hc ? { color: hc.hex } : {}) } : txt ? { color: txt.hex } : {}),
                  ...(fillC ? { fill: { color: fillC.hex } } : {}),
                },
              }
            }))
            const totalW = tc.frame.w * IN
            const totalH = tc.frame.h * IN
            // 画布上表格撑满框高（各列等分）⇒ 这里同样给总高＋逐列等高；不给的话 PowerPoint 按字高算·整张表只剩一半高
            slide.addTable(rows as Parameters<Slide['addTable']>[0], {
              x: tc.frame.x * IN, y: tc.frame.y * IN, w: totalW, h: totalH,
              ...(rows.length ? { rowH: rows.map(() => totalH / rows.length) } : {}),
              valign: 'middle',
              colW: tc.colWidths.map((p) => (p / 100) * totalW),
              fontFace: firstFamily(resolveFontStack(st.font, ctx)), fontSize: Math.round(st.size * PT * 10) / 10,
              ...(border ? { border: { type: 'solid', pt: 0.75, color: border.hex } } : {}),
              objectName: name,
            } as Parameters<Slide['addTable']>[1])
            break
          }
          case 'chart': {
            const ch = c as ChartComponent
            if (ch.frame.rotate) report.rotationDropped++
            const type = ch.chart === 'line' ? pptx.ChartType.line : ch.chart === 'pie' ? pptx.ChartType.pie : ch.chart === 'doughnut' ? pptx.ChartType.doughnut : pptx.ChartType.bar
            const pie = ch.chart === 'pie' || ch.chart === 'doughnut'
            const series = pie ? ch.series.slice(0, 1) : ch.series
            const data = series.map((s) => ({ name: s.name, labels: ch.labels, values: ch.labels.map((_, i) => s.values[i] ?? 0) }))
            const palette = (ch.colors && ch.colors.length ? ch.colors : [theme.primary, theme.secondary, ctx.palette.accent, ctx.palette.muted, ctx.palette.text])
              .map((x) => colorOf(resolveColor(x as never, ctx, '#888888'))?.hex ?? '888888')
            const textC = colorOf(resolveColor(ch.textColor ?? 'theme:text', ctx, ctx.palette.text))?.hex
            slide.addChart(type, data, {
              x: ch.frame.x * IN, y: ch.frame.y * IN, w: ch.frame.w * IN, h: ch.frame.h * IN,
              ...(ch.chart === 'bar' ? { barDir: 'bar' } : ch.chart === 'column' ? { barDir: 'col' } : {}),
              chartColors: palette, showLegend: ch.legend, legendPos: 'b', showValue: ch.showValues,
              ...(textC ? { catAxisLabelColor: textC, valAxisLabelColor: textC, legendColor: textC, dataLabelColor: textC } : {}),
              ...(ch.font ? { legendFontFace: firstFamily(resolveFontStack(ch.font, ctx)) } : {}),
              objectName: name,
            } as Parameters<Slide['addChart']>[2])
            break
          }
          case 'html': {
            const hc = c as HtmlComponent
            if (hc.frame.rotate) report.rotationDropped++
            const box = { w: hc.designW ?? CANVAS_WIDTH, h: hc.designH ?? CANVAS_HEIGHT }
            frame = frame ?? createExportFrame(box)
            const objs = (slide as unknown as { _slideObjects?: Array<{ options?: { objectName?: string } }> })._slideObjects
            const before = objs?.length ?? 0
            await measureDocOntoSlide(pptx, slide, frame, htmlComponentDoc(hc, theme), {
              box, v2: false, place: { x: hc.frame.x * IN, y: hc.frame.y * IN, w: hc.frame.w * IN }, setBackground: false, ...budget,
            })
            // 量出来的一堆物件命名成「编号#序」⇒ 挂在这个组件上的动画对得到（aislides-pptx-xml shapeLookup 认前缀）
            objs?.slice(before).forEach((o, k) => { if (o.options) o.options.objectName = `${name}#${k + 1}` })
            report.htmlMeasured++
            break
          }
        }
        report.objects++
      }
      // 页动画表 ⇒ PowerPoint 原生动画（基础动画＋影片步骤；程序步骤见下）
      const plan = planSlideTimeline(page.animations as unknown as AnimLike[] | undefined, {
        live, media: pageMedia, programs,
        alias: (id) => groupKids.get(id)?.flatMap((k) => programNames.get(k) ?? [k]) ?? programNames.get(id) ?? [id],
      })
      report.mediaSteps += plan.stats.mediaSteps
      report.mediaStepsDropped += plan.stats.mediaDropped
      report.mediaSeekFolded += plan.stats.seekFolded
      report.programSteps += plan.stats.programSteps
      report.programStepsIgnored += plan.stats.programStepsIgnored
      report.programStepsFailed += plan.stats.programStepsFailed
      report.cuesAsDelay += plan.stats.cuesAsDelay
      report.cuesAsBookmark += plan.stats.cuesAsBookmark
      report.cuesDropped += plan.stats.cuesDropped
      timingPatches.push(plan.items.length || mediaSpecs.length ? { items: plan.items, media: mediaSpecs, bookmarks: plan.bookmarks } : null)
      report.slides++
    }
  } finally {
    frame?.remove()
  }
  report.imagesSkipped += budget.stats.imagesSkipped   // html 组件量测那条路抓不到的图
  const buf = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer
  // 出档后补 XML（切换／背景填充／渐层／调整值／动画／影片真档）·没东西可补就原样
  const needXml = deck.pages.some((p) => p.transition && p.transition.type !== 'none') || xmlPatches.some((x) => Object.keys(x).length)
    || timingPatches.some(Boolean) || mediaFiles.length > 0
  if (!needXml) return { blob: new Blob([buf], { type: PPTX_MIME }), report }
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buf)
  await finishPptxZip(zip, {
    pages: deck.pages.map((p, i) => ({ transition: p.transition, shapes: xmlPatches[i], timing: timingPatches[i] ?? null, mediaCrop: cropPatches[i] })),
    mediaFiles, report,
  })
  const blob = await zip.generateAsync({ type: 'blob', mimeType: PPTX_MIME, compression: 'DEFLATE' })
  return { blob, report }
}
